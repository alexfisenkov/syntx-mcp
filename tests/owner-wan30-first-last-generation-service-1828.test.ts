import assert from "node:assert/strict";
import test from "node:test";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthBinding } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import {
  OwnerWan30FirstLastGenerationService,
  OwnerWan30FirstLastGenerationServiceError,
  isOwnerWan30FirstLastGenerationService
} from "../src/application/owner-wan30-first-last-generation-service.js";
import type { OwnerWan30FirstLastGenerationIntent } from "../src/application/owner-wan30-first-last-generation-parameters.js";

const CATALOG_VERSION = "sha256-19c882601bb8ecdba994adf819544ebf06fd2db30374335631bb6078a66e5a76.json";
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(CATALOG_VERSION));
const BINDING: AuthBinding = Object.freeze({ tenant_id: "wan30-fl-tenant", subject: "wan30-fl-subject" });
const ATTEMPT = "link_wan30_first_last_test_000000000001";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const PNG_BASE64 = PNG.toString("base64");
const INTENT: OwnerWan30FirstLastGenerationIntent = Object.freeze({
  model_id: "wan_30_first_last_frame",
  prompt: "A blue cube becomes a red paper boat on calm water",
  parameters: Object.freeze({ aspect_ratio: "16:9", resolution: "480P", video_duration: 2,
    prompt_extend: true, seed: null, native_audio: false, rendering_speed: "basic" })
});

interface FixtureOptions {
  readonly ownerAckObjects?: readonly { readonly type: string; readonly model_type: string | null }[];
  readonly otherAuthor?: boolean;
  readonly failSecondAccess?: boolean;
  readonly losePostAck?: boolean;
  readonly unlinkAfterUpload?: boolean;
}

function fixture(options: FixtureOptions = {}) {
  let now = Date.parse("2026-10-15T14:00:00.000Z");
  let chatCount = 0, uploadCount = 0, accessCount = 0, unlinked = false;
  const jobs = new Map<string, { ackId: string; outputs: readonly { id: string; url: string }[] }>();
  const events: Array<{ method: string; url: URL; body: unknown }> = [];
  const counts = { principalReads: 0, uploadPosts: 0, accountReads: 0, accessReads: 0, chatCreates: 0,
    generationPosts: 0, historyGets: 0, resultGets: 0, inProgressGets: 0 };
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation("synthetic-wan30-fl-credential"); }
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? "GET";
    let body: unknown;
    if (typeof init?.body === "string") body = JSON.parse(init.body) as unknown;
    if (typeof FormData !== "undefined" && init?.body instanceof FormData) {
      body = Object.freeze({ destination: init.body.get("destination"), check_duplicates: init.body.get("check_duplicates"),
        model_type: init.body.get("model_type") });
    }
    events.push({ method, url, body });

    if (url.pathname === "/api/v1/user/balance") {
      counts.accountReads += 1; return Response.json({ balance: "1000" });
    }
    if (url.pathname === "/api/v1/user/subscription") {
      counts.accountReads += 1; return Response.json({ active: true, type: "PRO", end_date: "2026-10-16T14:00:00.000Z" });
    }
    if (url.pathname === "/api/v2/get_model_info") {
      counts.accessReads += 1; accessCount += 1;
      return Response.json({ access: options.failSecondAccess && accessCount === 2 ? false : true,
        cost: 2, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: null });
    }
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
      uploadCount += 1; counts.uploadPosts += 1;
      if (options.unlinkAfterUpload) unlinked = true;
      return Response.json({ files: [{ id: `wan30-upload-${uploadCount}`, url: `https://r2.syntx.ai/wan30-frame-${uploadCount}.png` }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatCount += 1; counts.chatCreates += 1;
      return Response.json({ uuid: `wan30-first-last-chat-${chatCount}` });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      counts.generationPosts += 1;
      const request = body as { readonly chat_id: string; readonly prompt: string; readonly settings: Record<string, unknown> };
      const ackId = `wan30-first-last-owner-ack-${counts.generationPosts}`;
      jobs.set(request.chat_id, { ackId, outputs: [{ id: `wan30-first-last-bot-object-${counts.generationPosts}`,
        url: `https://r2.syntx.ai/wan30-generated-${counts.generationPosts}.mp4` }] });
      if (options.losePostAck) throw new Error("synthetic POST ACK unknown");
      return Response.json({ id: ackId });
    }
    const historyMatch = /^\/api\/v1\/chats\/(wan30-first-last-chat-\d+)\/messages$/u.exec(url.pathname);
    if (historyMatch) {
      counts.historyGets += 1;
      const job = jobs.get(historyMatch[1]!); assert.ok(job);
      const ownerObjects = (options.ownerAckObjects ?? [
        { type: "text", model_type: "wan_30_first_last_frame" },
        { type: "image", model_type: "wan_30_first_last_frame" },
        { type: "image", model_type: "wan_30_first_last_frame" }
      ]).map((item, index) => ({ id: `wan30-first-last-owner-object-${index + 1}`, message_id: job.ackId,
        object_type: item.type, model_type: item.model_type }));
      const messages: Array<Record<string, unknown>> = [{ id: job.ackId, chat_id: 9123, author_id: 4123, message_object: ownerObjects }];
      if (options.otherAuthor) messages.push({ id: "wan30-first-last-unrelated-owner", chat_id: 9123, author_id: 7001, message_object: [] });
      for (const output of job.outputs) messages.push({ id: "wan30-first-last-bot-message", chat_id: 9123, author_id: -1,
        message_object: [{ id: output.id, message_id: "wan30-first-last-bot-message", object_type: "video",
          model_type: "wan_30_first_last_frame" }] });
      const page = Number(url.searchParams.get("page"));
      return Response.json({ messages, pagination: { page, page_size: 10, total_count: messages.length, total_pages: 1,
        has_next: false, has_previous: false } });
    }
    const resultMatch = /^\/api\/v1\/chats\/(wan30-first-last-chat-\d+)\/(wan30-first-last-bot-message)$/u.exec(url.pathname);
    if (resultMatch) {
      counts.resultGets += 1;
      const job = jobs.get(resultMatch[1]!); assert.ok(job);
      return Response.json({ id: resultMatch[2], chat_id: 9123, author_id: -1, message_object: job.outputs.map((output) => ({
        id: output.id, message_id: resultMatch[2], object_type: "video", model_type: "wan_30_first_last_frame",
        completed: true, object_url: output.url
      })) });
    }
    if (/\/inprogress$/u.test(url.pathname)) { counts.inProgressGets += 1; return Response.json([]); }
    throw new Error(`Unexpected fixture request: ${method} ${url.pathname}`);
  };
  const linkService = new PerUserLinkService({} as never, {
    async getSnapshot(_binding: unknown, attemptId: string) {
      counts.principalReads += 1;
      return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
        status: unlinked ? "UNLINKED" as const : "LINKED" as const, expires_at: null, linked: !unlinked };
    }
  } as never);
  const chatClient = new SyntxChatHttpClient({ credentialBroker, fetchImpl, maxResponseBytes: 1024 * 1024 });
  const createAccountStatusService = () => new AccountStatusService(new SyntxHttpClient({ credentialBroker, fetchImpl }), () => now);
  const createModelAccessService = (_attemptId: string, catalog: DiscoveryCatalogRepository) =>
    new ModelAccessService(catalog, new SyntxHttpClient({ credentialBroker, fetchImpl }), () => now);
  return { binding: BINDING, linkService, chatClient, fetchImpl, events, counts,
    createAccountStatusService, createModelAccessService, get now() { return now; }, setUnlinked() { unlinked = true; } };
}

function makeService(f: ReturnType<typeof fixture>, resolveClient: (attemptId: string) => unknown = () => f.chatClient) {
  return new OwnerWan30FirstLastGenerationService({ binding: f.binding, linkService: f.linkService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient,
    createAccountStatusService: f.createAccountStatusService, createModelAccessService: f.createModelAccessService,
    now: () => f.now, timeoutMs: 5_000 });
}

async function uploadPair(service: OwnerWan30FirstLastGenerationService) {
  const first = await service.upload({ attemptId: ATTEMPT, role: "first_frame", content_base64: PNG_BASE64,
    filename: "first.png", mime_type: "image/png" });
  const last = await service.upload({ attemptId: ATTEMPT, role: "last_frame", content_base64: PNG_BASE64,
    filename: "last.png", mime_type: "image/png" });
  return { first, last };
}

test("two owner uploads stay URL-free and one generation joins role URLs in the observed order", async () => {
  const f = fixture(), service = makeService(f);
  try {
    assert.equal(isOwnerWan30FirstLastGenerationService(service), true);
    const { first, last } = await uploadPair(service);
    assert.equal(first.role, "first_frame"); assert.equal(last.role, "last_frame");
    assert.equal(first.model_id, "wan_30_first_last_frame");
    assert.equal(first.upload_binding_confidence, "IMPLEMENTATION_INFERENCE_NOT_UI_MULTIPART_OBSERVED");
    assert.equal(Object.hasOwn(first, "url"), false);
    assert.equal(first.size, PNG.byteLength);
    assert.equal(f.counts.uploadPosts, 2);
    const uploadEvents = f.events.filter((event) => event.url.pathname === "/api/v1/chats/upload-files");
    assert.deepEqual(uploadEvents.map((event) => event.body), [
      { destination: "uploaded", check_duplicates: "true", model_type: "wan_30_first_last_frame" },
      { destination: "uploaded", check_duplicates: "true", model_type: "wan_30_first_last_frame" }
    ]);

    const result = await service.generate({ attemptId: ATTEMPT, input: INTENT,
      first_frame_handle: first.frame_handle, last_frame_handle: last.frame_handle });
    assert.equal(result.status, "completed");
    assert.equal(result.model_id, "wan_30_first_last_frame");
    assert.equal(result.status_semantics, "LOCAL_OBSERVED_AVAILABILITY_ONLY");
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.equal(result.provider_terminal_status, "UNPROVEN");
    assert.equal(result.cost_input_confidence, "CATALOG_KEYS_NOT_UI_CALLER_JOINED");
    assert.equal(result.observed_artifact_count, 1);
    assert.equal(f.counts.accountReads, 4);
    assert.equal(f.counts.accessReads, 2);
    assert.equal(f.counts.chatCreates, 1);
    assert.equal(f.counts.generationPosts, 1);
    assert.equal(f.counts.historyGets, 1);
    assert.equal(f.counts.resultGets, 1);
    const quoteReads = f.events.filter((event) => event.url.pathname === "/api/v2/get_model_info");
    assert.deepEqual(quoteReads.map(({ url }) => [url.searchParams.get("model_type"), url.searchParams.get("resolution"),
      url.searchParams.get("video_duration"), url.searchParams.get("duration"), url.searchParams.get("rendering_speed")]), [
      ["wan_30_first_last_frame", "480P", "2", "0", "basic"],
      ["wan_30_first_last_frame", "480P", "2", "0", "basic"]
    ]);
    const post = f.events.find((event) => event.method === "POST" && event.url.pathname === "/api/v1/video/generate");
    assert.ok(post);
    const request = post.body as { chat_id: string; prompt: string; settings: Record<string, unknown> };
    assert.equal(request.prompt, INTENT.prompt);
    assert.deepEqual(request.settings, {
      model_type: "wan_30_first_last_frame", file_urls: [
        { type: "first_frame", url: "https://r2.syntx.ai/wan30-frame-1.png" },
        { type: "last_frame", url: "https://r2.syntx.ai/wan30-frame-2.png" }
      ], aspect_ratio: "16:9", resolution: "480P", video_duration: 2, prompt_extend: true,
      shot_type: "single", audio_setting: "auto", seed: null, native_audio: false, duration: 0, rendering_speed: "basic"
    });
    const beforeDuplicate = { ...f.counts };
    const duplicate = await service.generate({ attemptId: ATTEMPT, input: INTENT,
      first_frame_handle: first.frame_handle, last_frame_handle: last.frame_handle });
    assert.equal(duplicate.recovery_id, result.recovery_id);
    assert.deepEqual({ ...f.counts, principalReads: beforeDuplicate.principalReads }, beforeDuplicate);
    assert.equal(f.counts.generationPosts, 1, "semantic duplicate cannot dispatch a second POST");
  } finally { await service.close(); }
});

test("swapping the frame roles is rejected before chat or generation POST", async () => {
  const f = fixture(), service = makeService(f);
  try {
    const { first, last } = await uploadPair(service);
    await assert.rejects(service.generate({ attemptId: ATTEMPT, input: INTENT,
      first_frame_handle: last.frame_handle, last_frame_handle: first.frame_handle }),
    (error: unknown) => error instanceof OwnerWan30FirstLastGenerationServiceError && error.code === "REFERENCE_ROLE_MISMATCH");
    assert.equal(f.counts.chatCreates, 0);
    assert.equal(f.counts.generationPosts, 0);
  } finally { await service.close(); }
});

test("an owner ACK requires the observed text-plus-two-image model-bound object shape", async (t) => {
  const cases = [
    { name: "one owner ACK object", ownerAckObjects: [{ type: "text", model_type: "wan_30_first_last_frame" }] },
    { name: "wrong first owner ACK object type", ownerAckObjects: [{ type: "image", model_type: "wan_30_first_last_frame" },
      { type: "image", model_type: "wan_30_first_last_frame" }, { type: "image", model_type: "wan_30_first_last_frame" }] },
    { name: "wrong owner ACK model type", ownerAckObjects: [{ type: "text", model_type: "wan_30_t2v" },
      { type: "image", model_type: "wan_30_first_last_frame" }, { type: "image", model_type: "wan_30_first_last_frame" }] },
    { name: "unrelated author after the owner ACK", ownerAckObjects: [
      { type: "text", model_type: "wan_30_first_last_frame" }, { type: "image", model_type: "wan_30_first_last_frame" },
      { type: "image", model_type: "wan_30_first_last_frame" }], otherAuthor: true }
  ] as const;
  for (const entry of cases) await t.test(entry.name, async () => {
    const f = fixture(entry), service = makeService(f);
    try {
      const { first, last } = await uploadPair(service);
      await assert.rejects(service.generate({ attemptId: ATTEMPT, input: INTENT,
        first_frame_handle: first.frame_handle, last_frame_handle: last.frame_handle }),
      (error: unknown) => error instanceof OwnerWan30FirstLastGenerationServiceError && error.code === "OUTCOME_UNKNOWN");
      assert.equal(f.counts.generationPosts, 1);
      assert.equal(f.counts.resultGets, 0);
      const recoveries = await service.listRecoveries({ attemptId: ATTEMPT });
      assert.equal(recoveries.recoveries.length, 1);
      assert.equal(recoveries.recoveries[0]?.status, "outcome_unknown");
    } finally { await service.close(); }
  });
});

test("a late owner-link change after upload yields no handle and blocks upload replay", async () => {
  const f = fixture({ unlinkAfterUpload: true }), service = makeService(f);
  try {
    const input = { attemptId: ATTEMPT, role: "first_frame" as const, content_base64: PNG_BASE64,
      filename: "first.png", mime_type: "image/png" };
    await assert.rejects(service.upload(input), (error: unknown) =>
      error instanceof OwnerWan30FirstLastGenerationServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(f.counts.uploadPosts, 1);
    await assert.rejects(service.upload(input), (error: unknown) =>
      error instanceof OwnerWan30FirstLastGenerationServiceError && error.code === "PRINCIPAL_NOT_LINKED");
    assert.equal(f.counts.uploadPosts, 1, "an unknown upload outcome is never replayed automatically");
  } finally { await service.close(); }
});

test("second live preflight failure leaves a sticky one-shot claim but sends no generation POST", async () => {
  const f = fixture({ failSecondAccess: true }), service = makeService(f);
  try {
    const { first, last } = await uploadPair(service);
    await assert.rejects(service.generate({ attemptId: ATTEMPT, input: INTENT,
      first_frame_handle: first.frame_handle, last_frame_handle: last.frame_handle }),
    (error: unknown) => error instanceof OwnerWan30FirstLastGenerationServiceError && error.code === "PREFLIGHT_FAILED");
    assert.equal(f.counts.chatCreates, 1);
    assert.equal(f.counts.generationPosts, 0);
    await assert.rejects(service.generate({ attemptId: ATTEMPT, input: INTENT,
      first_frame_handle: first.frame_handle, last_frame_handle: last.frame_handle }),
    (error: unknown) => error instanceof OwnerWan30FirstLastGenerationServiceError && error.code === "INTENT_ALREADY_CLAIMED");
    assert.equal(f.counts.chatCreates, 1);
    assert.equal(f.counts.generationPosts, 0);
  } finally { await service.close(); }
});
