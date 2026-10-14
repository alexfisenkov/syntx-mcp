import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider, AuthBinding } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { OWNER_SUNO_GENERATION_PUBLIC_VERSION } from "../src/application/owner-suno-generation-parameters.js";
import { OwnerSunoGenerationService, type OwnerSunoGenerationServiceOptions } from "../src/application/owner-suno-generation-service.js";

const ATTEMPT = "link_suno_existing_service_1328_owner_0123456789";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "suno-existing-service-1328-tenant", subject: "suno-existing-service-1328-owner" });
const CREDENTIAL = "synthetic-suno-existing-service-credential";
const CHAT_UUID = "owner-suno-existing-service-chat";
const ACK_ID = "suno-existing-service-owner-ack";
const RESULT_ID = "suno-existing-service-bot-result";
const objectIds = ["suno-existing-service-object-a", "suno-existing-service-object-b"] as const;
const artifactUrls = ["https://r2.syntx.ai/audio/existing-a.mp3", "https://r2.syntx.ai/audio/existing-b.wav"] as const;
const authStores = new Set<InMemoryAuthLinkStore>();

interface ExistingTrackServiceApi {
  listExistingTracks(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
}

function serviceApi(service: OwnerSunoGenerationService): ExistingTrackServiceApi {
  return service as unknown as ExistingTrackServiceApi;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

async function fixture() {
  let now = Date.parse("2026-10-14T00:00:00.000Z");
  const counts = { indexGets: 0, historyGets: 0, resultGets: 0, posts: 0, accountGets: 0, quoteGets: 0 };
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-existing-track-1328", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: CREDENTIAL });
      return { state: "LINKED" };
    }
  };
  const authStore = new InMemoryAuthLinkStore(() => now);
  authStores.add(authStore);
  const linkService = new PerUserLinkService(provider, authStore, { now: () => now, defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: () => ATTEMPT });
  await linkService.createAttempt(BINDING);
  await linkService.issueHandoff(BINDING, ATTEMPT);
  assert.equal((await linkService.checkAttempt(BINDING, ATTEMPT)).status, "LINKED");
  const credentialBroker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return linkService.useCredential(BINDING, ATTEMPT, (credential) => operation(credential.value));
  } };
  const audioObjects = () => objectIds.map((id, index) => ({ id, message_id: RESULT_ID, object_type: "audio",
    model_type: "V6_wild", object_text: "", object_url: artifactUrls[index], completed: true,
    metadata: { payload: { clip_id: `private-clip-${index}`, task_id: `private-task-${index}` } } }));
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init.method ?? "GET";
    if (method !== "GET") { counts.posts += 1; throw new Error("Unexpected non-GET in read-only fixture"); }
    if (url.pathname === "/api/v1/chats") {
      counts.indexGets += 1;
      assert.equal(url.search, "?scope=audio&page=1&page_size=20");
      return Response.json({ chats: [{ id: 9031, uuid: CHAT_UUID, scope: "audio",
        title: "owner-suno-track-operation-01234567-89ab-4def-8123-456789abcdef",
        created_at: "2026-10-14T00:00:00Z", updated_at: "2026-10-14T00:00:00Z", message_count: 2 }],
        pagination: { page: 1, page_size: 20, total_count: 1, total_pages: 1, has_next: false, has_previous: false } });
    }
    if (url.pathname === `/api/v1/chats/${CHAT_UUID}/messages`) {
      counts.historyGets += 1;
      assert.equal(url.search, "?page=1&page_size=10");
      return Response.json({ messages: [
        { id: ACK_ID, chat_id: 9031, author_id: 42, message_object: [{ id: "suno-existing-service-owner-text",
          message_id: ACK_ID, object_type: "text", object_text: "private source prompt", object_url: "",
          completed: true, model_type: "V6_wild", metadata: { payload: {} } }] },
        { id: RESULT_ID, chat_id: 9031, author_id: -1, message_object: audioObjects() }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    if (url.pathname === `/api/v1/chats/${CHAT_UUID}/${RESULT_ID}`) {
      counts.resultGets += 1;
      return Response.json({ id: RESULT_ID, chat_id: 9031, author_id: -1,
        message_object: audioObjects(), created_at: "2026-10-14T00:00:00Z" });
    }
    if (url.pathname === "/api/v1/user/balance" || url.pathname === "/api/v1/user/subscription") {
      counts.accountGets += 1;
      return Response.json({ balance: "100", subscription: { active: true } });
    }
    if (url.pathname === "/api/v2/get_model_info") {
      counts.quoteGets += 1;
      return Response.json({ access: true, cost: 1 });
    }
    throw new Error(`Unexpected fixture route: ${method} ${url.pathname}`);
  };
  const client = new SyntxChatHttpClient({ credentialBroker, fetchImpl });
  const catalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(OWNER_SUNO_GENERATION_PUBLIC_VERSION));
  const options: OwnerSunoGenerationServiceOptions = {
    binding: BINDING, linkService, catalog, catalog_version: OWNER_SUNO_GENERATION_PUBLIC_VERSION,
    resolveChatClient: (attemptId) => attemptId === ATTEMPT ? client : undefined,
    createAccountStatusService: () => { throw new Error("Browse must not create an account-read client"); },
    createModelAccessService: () => { throw new Error("Browse must not create a quote client"); },
    now: () => now
  };
  const service = new OwnerSunoGenerationService(options);
  return { service, counts };
}

afterEach(() => { for (const store of authStores) store.close(); authStores.clear(); });

test("lists exact own imported tracks with artifact association and no paid or account flow", async () => {
  const f = await fixture();
  try {
    const result = await serviceApi(f.service).listExistingTracks({ attemptId: ATTEMPT, page: 1 });
    assert.equal(result.status, "AVAILABLE");
    assert.equal(result.page, 1);
    assert.equal(result.page_size, 20);
    const tracks = result.tracks as Array<Record<string, unknown>>;
    assert.equal(tracks.length, 2);
    assert.deepEqual(tracks.map((track) => track.artifact), [
      { url: artifactUrls[0], mime_type: "audio/mpeg" },
      { url: artifactUrls[1], mime_type: "audio/wav" }
    ]);
    assert.deepEqual(tracks.map((track) => track.model_id), ["V6_wild", "V6_wild"]);
    assert.ok(tracks.every((track) => typeof track.track_handle === "string" &&
      Number.isInteger(track.expires_in_seconds) && (track.expires_in_seconds as number) > 0));
    const projection = JSON.stringify(result);
    for (const privateValue of [CHAT_UUID, ACK_ID, RESULT_ID, ...objectIds, "private-clip-0", "private-task-0", "private source prompt"]) {
      assert.equal(projection.includes(privateValue), false);
    }
    assert.deepEqual(f.counts, { indexGets: 1, historyGets: 1, resultGets: 1, posts: 0, accountGets: 0, quoteGets: 0 });
  } finally { await f.service.close(); }
});

test("rejects a foreign attempt and blocks reads after parent invalidation", async () => {
  const f = await fixture();
  const api = serviceApi(f.service);
  try {
    await assert.rejects(api.listExistingTracks({ attemptId: "link_suno_existing_service_foreign_0123456789", page: 1 }),
      (error: unknown) => errorCode(error) === "PRINCIPAL_NOT_LINKED");
    assert.deepEqual(f.counts, { indexGets: 0, historyGets: 0, resultGets: 0, posts: 0, accountGets: 0, quoteGets: 0 });

    const listed = await api.listExistingTracks({ attemptId: ATTEMPT, page: 1 });
    assert.equal(listed.status, "AVAILABLE");
    await f.service.invalidateAttempt(ATTEMPT);
    const counts = { ...f.counts };
    await assert.rejects(api.listExistingTracks({ attemptId: ATTEMPT, page: 1 }),
      (error: unknown) => errorCode(error) === "PRINCIPAL_NOT_LINKED");
    assert.deepEqual(f.counts, counts);
  } finally { await f.service.close(); }
});
