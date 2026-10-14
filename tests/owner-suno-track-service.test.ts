import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OWNER_SUNO_GENERATION_PUBLIC_VERSION } from "../src/application/owner-suno-generation-parameters.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthBinding, AuthLinkProvider } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";

const SERVICE_URL = new URL("../src/application/owner-suno-generation-service.js", import.meta.url).href;
const ATTEMPT_A = "link_suno_track_service_1291_0123456789";
const ATTEMPT_B = "link_suno_track_service_1291_other_0123456789";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "suno-track-service-tenant", subject: "suno-track-service-owner" });
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(OWNER_SUNO_GENERATION_PUBLIC_VERSION));
const stores = new Set<InMemoryAuthLinkStore>();
afterEach(() => { for (const store of stores) store.close(); stores.clear(); });

interface TrackInput { readonly track_handle: string; readonly model_id: string; readonly expires_in_seconds: number; }
interface TrackList { readonly recovery_id: string; readonly status: "AVAILABLE" | "UNAVAILABLE";
  readonly unavailable_reason?: "TRACK_METADATA_UNAVAILABLE" | "TRACK_INPUT_CAPACITY_REACHED";
  readonly tracks: readonly TrackInput[]; }
interface ServiceApi {
  generate(input: unknown): Promise<{ readonly recovery_id: string; readonly artifacts: readonly Record<string, unknown>[] }>;
  listTrackInputs(input: unknown): Promise<TrackList>;
  invalidateAttempt(attemptId: unknown): Promise<void>;
  close(): Promise<void>;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

async function fixture(options: { readonly metadata?: boolean; readonly now?: number } = {}) {
  let now = options.now ?? Date.parse("2026-10-14T00:00:00.000Z");
  const counts = { balanceGets: 0, subscriptionGets: 0, modelAccessGets: 0, chats: 0, posts: 0, historyGets: 0, resultGets: 0 };
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-track-service", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-track-service-credential" });
      return { state: "LINKED" };
    }
  };
  const authStore = new InMemoryAuthLinkStore(() => now); stores.add(authStore);
  const attempts = [ATTEMPT_A, ATTEMPT_B];
  const linkService = new PerUserLinkService(provider, authStore, { now: () => now, defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: () => attempts.shift() ?? "link_suno_track_service_extra_0123456789" });
  for (const attemptId of [ATTEMPT_A, ATTEMPT_B]) {
    await linkService.createAttempt(BINDING);
    await linkService.issueHandoff(BINDING, attemptId);
    assert.equal((await linkService.checkAttempt(BINDING, attemptId)).status, "LINKED");
  }
  const brokerFor = (attemptId: string): SyntxCredentialBroker => ({ async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return linkService.useCredential(BINDING, attemptId, (credential) => operation(credential.value));
  } });
  let chatUuid = "";
  let ackId = "";
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    if (url.pathname === "/api/v1/user/balance" && method === "GET") { counts.balanceGets += 1; return Response.json({ balance: "1000" }); }
    if (url.pathname === "/api/v1/user/subscription" && method === "GET") {
      counts.subscriptionGets += 1; return Response.json({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00.000Z" });
    }
    if (url.pathname === "/api/v2/get_model_info" && method === "GET") {
      counts.modelAccessGets += 1; return Response.json({ access: true, cost: 3, discount_cost: null,
        free_remaining_generations: null, limit: null, show_warning: null });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      counts.chats += 1; chatUuid = "suno-track-service-chat-1291"; return Response.json({ uuid: chatUuid });
    }
    if (url.pathname === "/api/v1/audio/generate" && method === "POST") {
      counts.posts += 1; ackId = "suno-track-service-ack-1291"; return Response.json({ id: ackId });
    }
    if (url.pathname.endsWith("/messages") && method === "GET") {
      counts.historyGets += 1;
      return Response.json({ messages: [
        { id: ackId, chat_id: 9123, author_id: 4312, message_object: [{ id: "suno-track-service-text-1291",
          message_id: ackId, object_type: "text", object_text: "Synthetic track service", model_type: "V6" }] },
        { id: "suno-track-service-bot-1291", chat_id: 9123, author_id: -1, message_object: [{ id: "suno-track-service-object-1291",
          message_id: "suno-track-service-bot-1291", object_type: "audio", model_type: "V6" }] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    if (/^\/api\/v1\/chats\/[^/]+\/[^/]+$/u.test(url.pathname) && method === "GET") {
      counts.resultGets += 1;
      return Response.json({ id: "suno-track-service-bot-1291", chat_id: 9123, author_id: -1,
        message_object: [{ id: "suno-track-service-object-1291", message_id: "suno-track-service-bot-1291", object_type: "audio",
          object_url: "https://r2.syntx.ai/audio/suno-track-service-1291.mp3", completed: true, model_type: "V6",
          ...(options.metadata ? { metadata: { payload: { clip_id: "private-clip-1291", task_id: "private-task-1291" } } } : {}) }],
        created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(), is_favorite: false });
    }
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  };
  const client = new SyntxChatHttpClient({ credentialBroker: brokerFor(ATTEMPT_A), fetchImpl, maxResponseBytes: 2 * 1024 * 1024 });
  const serviceModule = await import(SERVICE_URL) as Record<string, unknown>;
  assert.equal(typeof serviceModule.OwnerSunoGenerationService, "function");
  const GenerationService = serviceModule.OwnerSunoGenerationService as new (input: Record<string, unknown>) => ServiceApi;
  const service = new GenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: OWNER_SUNO_GENERATION_PUBLIC_VERSION, resolveChatClient: () => client,
    createAccountStatusService: (attemptId: string) => new AccountStatusService(
      new SyntxHttpClient({ credentialBroker: brokerFor(attemptId), fetchImpl }), () => now),
    createModelAccessService: (attemptId: string) => new ModelAccessService(CATALOG,
      new SyntxHttpClient({ credentialBroker: brokerFor(attemptId), fetchImpl }), () => now), now: () => now, pollDelayMs: 0, maxPollAttempts: 1 });
  const generated = await service.generate({ attemptId: ATTEMPT_A, request: { model_id: "V6", mode: "generate",
    prompt: "Synthetic track service", is_custom_mode: false, is_instrumental: true,
    negative_tags: "", styles: "", title: "Synthetic" } });
  return { service, generated, counts, linkService, get now() { return now; }, advance(ms: number) { now += ms; },
    async close() { await service.close(); } };
}

test("lists cached owner track handles without repeating account, cost, history, or result reads", async () => {
  const f = await fixture({ metadata: true });
  try {
    const before = { ...f.counts };
    const first = await f.service.listTrackInputs({ attemptId: ATTEMPT_A, recovery_id: f.generated.recovery_id });
    const second = await f.service.listTrackInputs({ attemptId: ATTEMPT_A, recovery_id: f.generated.recovery_id });
    assert.deepEqual(first, second);
    assert.equal(first.status, "AVAILABLE");
    assert.equal(first.tracks.length, 1);
    assert.match(first.tracks[0]!.track_handle, /^track_[0-9a-f-]{36}$/u);
    assert.equal(first.tracks[0]!.model_id, "V6");
    assert.ok(first.tracks[0]!.expires_in_seconds > 0 && first.tracks[0]!.expires_in_seconds <= 900);
    const serialized = JSON.stringify(first);
    for (const privateValue of ["private-clip-1291", "private-task-1291", "suno-track-service-chat-1291",
      "suno-track-service-bot-1291", "suno-track-service-object-1291", "syntx.ai", "Synthetic track service"]) {
      assert.equal(serialized.includes(privateValue), false);
    }
    assert.deepEqual(f.counts, before);
  } finally { await f.close(); }
});

test("missing track metadata yields a fixed empty result without changing successful audio generation", async () => {
  const f = await fixture({ metadata: false });
  try {
    assert.equal(f.generated.artifacts.length, 1);
    assert.deepEqual(await f.service.listTrackInputs({ attemptId: ATTEMPT_A, recovery_id: f.generated.recovery_id }), {
      recovery_id: f.generated.recovery_id, status: "UNAVAILABLE", unavailable_reason: "TRACK_METADATA_UNAVAILABLE", tracks: []
    });
  } finally { await f.close(); }
});

test("track handles remain bound to the linked owner and become unavailable after revocation or close", async () => {
  const f = await fixture({ metadata: true });
  try {
    const tracks = await f.service.listTrackInputs({ attemptId: ATTEMPT_A, recovery_id: f.generated.recovery_id });
    await assert.rejects(f.service.listTrackInputs({ attemptId: ATTEMPT_B, recovery_id: f.generated.recovery_id }),
      (error) => errorCode(error) === "RECOVERY_NOT_FOUND");
    await f.linkService.revoke(BINDING, ATTEMPT_A);
    await f.service.invalidateAttempt(ATTEMPT_A);
    await assert.rejects(f.service.listTrackInputs({ attemptId: ATTEMPT_A, recovery_id: f.generated.recovery_id }),
      (error) => errorCode(error) === "PRINCIPAL_NOT_LINKED" || errorCode(error) === "RECOVERY_NOT_FOUND");
    assert.equal(tracks.tracks.length, 1);
  } finally { await f.close(); }
});

test("track handles expire and can be reissued from retained native result contexts without network I/O", async () => {
  const f = await fixture({ metadata: true });
  try {
    const first = await f.service.listTrackInputs({ attemptId: ATTEMPT_A, recovery_id: f.generated.recovery_id });
    f.advance(15 * 60_000);
    const counts = { ...f.counts };
    const second = await f.service.listTrackInputs({ attemptId: ATTEMPT_A, recovery_id: f.generated.recovery_id });
    assert.equal(second.status, "AVAILABLE");
    assert.notEqual(second.tracks[0]!.track_handle, first.tracks[0]!.track_handle);
    assert.ok(second.tracks[0]!.expires_in_seconds > 0);
    assert.deepEqual(f.counts, counts);
  } finally { await f.close(); }
});

test("closing the generation service closes the track-handle store with it", async () => {
  const f = await fixture({ metadata: true });
  try {
    const tracks = await f.service.listTrackInputs({ attemptId: ATTEMPT_A, recovery_id: f.generated.recovery_id });
    assert.equal(tracks.status, "AVAILABLE");
    await f.service.close();
    await assert.rejects(f.service.listTrackInputs({ attemptId: ATTEMPT_A, recovery_id: f.generated.recovery_id }),
      (error) => errorCode(error) === "SERVICE_CLOSED");
  } finally { await f.close(); }
});

