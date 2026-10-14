import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE } from "../src/auth/types.js";
import type { AuthBinding, AuthLinkProvider } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { OwnerKlingI2VImageReferenceService } from "../src/application/owner-kling-i2v-reference-service.js";
import {
  OwnerKlingI2vGenerationService,
  OwnerKlingI2vGenerationServiceError
} from "../src/application/owner-kling-i2v-generation-service.js";

const ATTEMPT_A = "link_kling_i2v_generation_service_owner_a_0123456789";
const ATTEMPT_B = "link_kling_i2v_generation_service_owner_b_0123456789";
const FOREIGN_ATTEMPT = "link_kling_i2v_generation_service_foreign_0123456789";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "kling-generation-tenant", subject: "kling-generation-owner" });
const FOREIGN_BINDING: AuthBinding = Object.freeze({ tenant_id: "kling-generation-foreign-tenant", subject: "kling-generation-foreign" });
const IMAGE = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x2c, 0x01, 0x2c, 0x01, 0x01, 0x11, 0,
  0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0, 0xff, 0xd9]);
const UPLOAD_URL = "https://r2.syntx.ai/hidden/kling-owner-frame.jpg";
const VIDEO_URL = "https://r2.syntx.ai/kling/i2v-result.mp4";
const NOW = Date.parse("2026-10-14T00:00:00.000Z");
const PARAMETERS = Object.freeze({ model_id: "kling_image2video", prompt: "A quiet shoreline at sunrise.", reference_count: 1,
  version: "2.6", mode: "hd", video_duration: 5, native_audio: true });
const CONTROLS = Object.freeze({ temperature: 0.6 });
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion("sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json"));
const stores = new Set<InMemoryAuthLinkStore>();
afterEach(() => { for (const store of stores) store.close(); stores.clear(); });

interface RequestRecord { readonly method: string; readonly url: URL; readonly body?: unknown }
interface ServiceApi {
  generate(input: unknown, signal?: AbortSignal): Promise<Record<string, any>>;
  reconcile(input: unknown, signal?: AbortSignal): Promise<Record<string, any>>;
  list(input: unknown, signal?: AbortSignal): Promise<readonly Record<string, any>[]>;
  invalidateAttempt(attemptId: unknown): Promise<void>;
  close(): Promise<void>;
  getParametersSource(): Record<string, any>;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
function brokerFor(links: PerUserLinkService, binding: AuthBinding, attemptId: string): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return links.useCredential(binding, attemptId, (credential) => operation(credential.value));
  } };
}
function jsonResponse(payload: unknown): Response { return Response.json(payload); }

async function setup(options: { readonly historyFailures?: number; readonly generationAckLost?: boolean;
  readonly ready?: boolean; readonly denyModelAccessOnRead?: number; readonly linkForeign?: boolean } = {}) {
  let now = NOW, chatNumber = 0, modelAccessReads = 0, historyGets = 0, resultGets = 0, generationPosts = 0;
  let remainingHistoryFailures = options.historyFailures ?? 0;
  let ready = options.ready ?? true;
  const requests: RequestRecord[] = [];
  const challengeByBinding = new Map<string, string>();
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() {
      const id = `synthetic-kling-challenge-${challengeByBinding.size + 1}`;
      challengeByBinding.set(id, id);
      return { upstream_attempt_id: id, approval_url: "https://example.invalid/approve" };
    },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-kling-owner-credential" }); return { state: "LINKED" }; }
  };
  const linkStore = new InMemoryAuthLinkStore(() => now); stores.add(linkStore);
  const attempts: Array<{ id: string; binding: AuthBinding }> = [
    { id: ATTEMPT_A, binding: BINDING }, { id: ATTEMPT_B, binding: BINDING },
    ...(options.linkForeign ? [{ id: FOREIGN_ATTEMPT, binding: FOREIGN_BINDING }] : [])
  ];
  let attemptIndex = 0;
  const links = new PerUserLinkService(provider, linkStore, { now: () => now, defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: () => attempts[attemptIndex++]!.id });
  for (const { id, binding } of attempts) {
    await links.createAttempt(binding);
    await links.issueHandoff(binding, id);
    await links.checkAttempt(binding, id);
  }
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    requests.push({ method, url, ...(body === undefined ? {} : { body }) });
    if (url.origin !== "https://api.syntx.ai") throw new Error("Unexpected synthetic origin");
    if (url.pathname === "/api/v1/user/balance" && method === "GET") return jsonResponse({ balance: "1000" });
    if (url.pathname === "/api/v1/user/subscription" && method === "GET") {
      return jsonResponse({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00.000Z" });
    }
    if (url.pathname === "/api/v2/get_model_info" && method === "GET") {
      modelAccessReads += 1;
      assert.equal(url.searchParams.get("ai_name"), "kling");
      assert.equal(url.searchParams.get("model_type"), "kling_image2video");
      assert.deepEqual([...url.searchParams.keys()].sort(), ["ai_name", "mode", "model_type", "native_audio", "version", "video_duration"]);
      if (options.denyModelAccessOnRead === modelAccessReads) {
        return jsonResponse({ access: false, cost: 12, discount_cost: null, free_remaining_generations: null,
          limit: null, show_warning: null });
      }
      return jsonResponse({ access: true, cost: 12, discount_cost: null, free_remaining_generations: null,
        limit: null, show_warning: false });
    }
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
      const form = init.body as FormData;
      assert.equal(form.get("model_type"), "kling_image2video");
      const file = form.get("files");
      assert.ok(file instanceof File);
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), IMAGE);
      return jsonResponse({ files: [{ id: "private-kling-upload-id", url: UPLOAD_URL }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatNumber += 1;
      assert.deepEqual(body, { title: "Kling Image-to-Video", scope: "video" });
      return jsonResponse({ uuid: `kling-i2v-chat-${chatNumber}` });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      generationPosts += 1;
      assert.equal(url.search, "?ai_name=kling");
      const request = body as { chat_id: string; prompt: string; settings: Record<string, unknown> };
      assert.equal(request.chat_id, `kling-i2v-chat-${chatNumber}`);
      assert.equal(request.prompt, PARAMETERS.prompt);
      assert.deepEqual(request.settings, { model_type: "kling_image2video", version: "2.6", mode: "hd", video_duration: 5,
        native_audio: true, temperature: 0.6, file_urls: [{ type: "image", url: UPLOAD_URL }] });
      if (options.generationAckLost) throw new Error("synthetic lost POST acknowledgement");
      return jsonResponse({ id: `kling-i2v-ack-${chatNumber}` });
    }
    const history = /^\/api\/v1\/chats\/(kling-i2v-chat-\d+)\/messages$/u.exec(url.pathname);
    if (history && method === "GET") {
      historyGets += 1;
      if (remainingHistoryFailures > 0) { remainingHistoryFailures -= 1; throw new Error("synthetic history unavailable"); }
      const chatId = history[1]!;
      const ack = `kling-i2v-ack-${chatId.slice("kling-i2v-chat-".length)}`;
      const ownerRow = { id: ack, chat_id: 79301, author_id: 4812, message_object: [] };
      const botRow = ready ? [{ id: `kling-i2v-result-${chatId.slice("kling-i2v-chat-".length)}`, chat_id: 79301,
        author_id: -1, message_object: [{ id: "kling-i2v-video-object", message_id: `kling-i2v-result-${chatId.slice("kling-i2v-chat-".length)}`,
          object_type: "video", model_type: "kling_image2video" }] }] : [];
      const messages = [ownerRow, ...botRow];
      return jsonResponse({ messages, pagination: { page: 1, page_size: 10, total_count: messages.length,
        total_pages: 1, has_next: false, has_previous: false } });
    }
    const result = /^\/api\/v1\/chats\/(kling-i2v-chat-\d+)\/(kling-i2v-result-\d+)$/u.exec(url.pathname);
    if (result && method === "GET") {
      resultGets += 1;
      return jsonResponse({ id: result[2], chat_id: 79301, author_id: -1, message_object: [{ id: "kling-i2v-video-object",
        message_id: result[2], object_type: "video", model_type: "kling_image2video", completed: true, object_url: VIDEO_URL }] });
    }
    throw new Error(`Unexpected synthetic route ${method} ${url.pathname}`);
  };
  const clients = new Map<string, SyntxChatHttpClient>();
  const resolveChatClient = (attemptId: string) => {
    const existing = clients.get(attemptId);
    if (existing) return existing;
    const binding = attempts.find((item) => item.id === attemptId)?.binding ?? BINDING;
    const client = new SyntxChatHttpClient({ credentialBroker: brokerFor(links, binding, attemptId), fetchImpl });
    clients.set(attemptId, client);
    return client;
  };
  const referenceService = new OwnerKlingI2VImageReferenceService({ binding: BINDING, linkService: links,
    resolveClient: resolveChatClient, destination: "hidden", now: () => now });
  const httpClient = (attemptId: string) => new SyntxHttpClient({ credentialBroker: brokerFor(links, BINDING, attemptId), fetchImpl });
  const service = new OwnerKlingI2vGenerationService({ binding: BINDING, linkService: links, catalog: CATALOG, referenceService,
    resolveChatClient, createAccountStatusService: (attemptId: string) => new AccountStatusService(httpClient(attemptId), () => now),
    createModelAccessService: (attemptId: string) => new ModelAccessService(CATALOG, httpClient(attemptId), () => now),
    now: () => now, pollDelayMs: 0 });
  async function upload(attemptId = ATTEMPT_A) {
    const receipt = await referenceService.upload({ attemptId, content_base64: IMAGE.toString("base64"), filename: "frame.jpg", mime_type: "image/jpeg" });
    return String(receipt.image_handle);
  }
  return {
    service: service as unknown as ServiceApi, referenceService, links, linkStore, requests,
    counts: () => ({ chatNumber, modelAccessReads, historyGets, resultGets, generationPosts }),
    upload,
    setReady(value: boolean) { ready = value; },
    advance(milliseconds: number) { now += milliseconds; },
    async close() { await service.close(); await referenceService.close(); linkStore.close(); }
  };
}

test("dispatches one source-bound Kling I2V generation and returns only a verified video URL", async () => {
  const f = await setup();
  try {
    const image_handle = await f.upload();
    const result = await f.service.generate({ attemptId: ATTEMPT_A, image_handle, parameters: PARAMETERS, controls: CONTROLS });
    assert.equal(result.status, "completed");
    assert.equal(result.model_id, "kling_image2video");
    assert.equal(result.observed_artifact_count, 1);
    assert.deepEqual(result.artifacts, [{ url: VIDEO_URL, mime_type: "video/mp4" }]);
    assert.equal(f.counts().generationPosts, 1);
    assert.equal(f.counts().modelAccessReads, 2, "both fresh preflights quote the four exact settings keys");
    assert.equal(f.counts().historyGets, 1);
    assert.equal(f.counts().resultGets, 1);
    for (const hidden of [UPLOAD_URL, "private-kling-upload-id", "kling-i2v-chat-1", "kling-i2v-ack-1", image_handle]) {
      assert.equal(JSON.stringify(result).includes(hidden), false);
    }
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.equal(result.provider_terminal_status, "UNPROVEN");
    assert.equal(f.service.getParametersSource().model_id, "kling_image2video");
  } finally { await f.close(); }
});

test("recovers a GET-only unknown and never repeats the generation POST", async () => {
  const f = await setup({ historyFailures: 1 });
  try {
    const image_handle = await f.upload();
    let recoveryId = "";
    await assert.rejects(f.service.generate({ attemptId: ATTEMPT_A, image_handle, parameters: PARAMETERS, controls: CONTROLS }),
      (error: unknown) => {
        assert.ok(error instanceof OwnerKlingI2vGenerationServiceError);
        assert.equal(error.code, "OUTCOME_UNKNOWN");
        recoveryId = error.recovery_id ?? "";
        return true;
      });
    assert.match(recoveryId, /^kling_i2v_generation_recovery_[0-9a-f-]{36}$/u);
    const postsBefore = f.counts().generationPosts;
    f.advance(16 * 60_000);
    const result = await f.service.reconcile({ attemptId: ATTEMPT_A, recovery_id: recoveryId });
    assert.equal(result.status, "completed");
    assert.deepEqual(result.artifacts, [{ url: VIDEO_URL, mime_type: "video/mp4" }]);
    assert.equal(f.counts().generationPosts, postsBefore);
    assert.equal((await f.service.list({ attemptId: ATTEMPT_A })).length, 1);
  } finally { await f.close(); }
});

test("cached completed recovery is hidden after the owner link is revoked", async () => {
  const f = await setup();
  try {
    const image_handle = await f.upload();
    const completed = await f.service.generate({ attemptId: ATTEMPT_A, image_handle, parameters: PARAMETERS, controls: CONTROLS });
    const historyBefore = f.counts().historyGets;
    const resultsBefore = f.counts().resultGets;
    await f.linkStore.revoke(BINDING, ATTEMPT_A);
    await assert.rejects(f.service.reconcile({ attemptId: ATTEMPT_A, recovery_id: completed.recovery_id }),
      (error: unknown) => errorCode(error) === "RECOVERY_NOT_FOUND" && !JSON.stringify(error).includes(VIDEO_URL));
    assert.equal(f.counts().historyGets, historyBefore);
    assert.equal(f.counts().resultGets, resultsBefore);
    assert.equal((await f.service.list({ attemptId: ATTEMPT_A })).length, 0);
    assert.equal(JSON.stringify(completed).includes(VIDEO_URL), true, "the original authorized result was observed before revocation");
  } finally { await f.close(); }
});

test("a foreign attempt cannot use another attempt's opaque Kling image handle", async () => {
  const f = await setup({ linkForeign: true });
  try {
    const image_handle = await f.upload();
    await assert.rejects(f.service.generate({ attemptId: FOREIGN_ATTEMPT, image_handle, parameters: PARAMETERS, controls: CONTROLS }));
    assert.equal(f.counts().generationPosts, 0);
    assert.equal(f.counts().chatNumber, 0);
  } finally { await f.close(); }
});

test("same semantic I2V intent stays claimed across linked-attempt churn", async () => {
  const f = await setup({ historyFailures: 1 });
  try {
    const firstHandle = await f.upload(ATTEMPT_A);
    await assert.rejects(f.service.generate({ attemptId: ATTEMPT_A, image_handle: firstHandle, parameters: PARAMETERS, controls: CONTROLS }),
      (error: unknown) => errorCode(error) === "OUTCOME_UNKNOWN");
    const secondHandle = await f.upload(ATTEMPT_B);
    await assert.rejects(f.service.generate({ attemptId: ATTEMPT_B, image_handle: secondHandle, parameters: PARAMETERS, controls: CONTROLS }),
      (error: unknown) => errorCode(error) === "INTENT_ALREADY_CLAIMED");
    assert.equal(f.counts().generationPosts, 1);
    assert.equal(f.counts().chatNumber, 1);
  } finally { await f.close(); }
});

test("second fresh access denial creates no generation POST", async () => {
  const f = await setup({ denyModelAccessOnRead: 2 });
  try {
    const image_handle = await f.upload();
    await assert.rejects(f.service.generate({ attemptId: ATTEMPT_A, image_handle, parameters: PARAMETERS, controls: CONTROLS }),
      (error: unknown) => errorCode(error) === "PREFLIGHT_FAILED");
    assert.equal(f.counts().modelAccessReads, 2);
    assert.equal(f.counts().generationPosts, 0);
  } finally { await f.close(); }
});
