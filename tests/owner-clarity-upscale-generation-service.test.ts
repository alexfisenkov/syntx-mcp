import assert from "node:assert/strict";
import test from "node:test";
import { OwnerClarityUpscaleGenerationService, OwnerClarityUpscaleGenerationServiceError } from "../src/application/owner-clarity-upscale-generation-service.js";
import { OwnerClarityUpscaleUploadService } from "../src/application/owner-clarity-upscale-upload-service.js";
import { consumeOwnerClarityUpscaleOneShotPermit } from "../src/application/owner-clarity-upscale-one-shot-policy.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { SyntxChatHttpClient, type ChatMessageHistorySnapshot, type InProgressMessage, type InternalClarityUpscaleResult } from "../src/adapter/syntx/chat-http-client.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import type { GenerationPrincipalRef } from "../src/domain/generation-operation.js";
import type { AuthBinding } from "../src/auth/types.js";

const ATTEMPT = "link_clarity_generation_test_1234567890";
const AUTH_BINDING = Object.freeze({ tenant_id: "tenant_clarity_gen_test", subject: "subject_clarity_gen_test" });
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
const INPUT_URL = "https://r2.syntx.ai/private/clarity-generation-input.png";
const OUTPUT_URL = "https://r2.syntx.ai/generated/clarity-output.png";
const CATALOG = loadSelectedDiscoveryCatalog().discoveryCatalog;
const NOW = Date.now();
const CHAT_UUID = "clarity-chat-001";
const OWNER_ECHO_ID = "owner-echo-message-1";
const BOT_MESSAGE_ID = "bot-result-message-1";
const RESULT_OBJECT_ID = "clarity-result-object-1";

async function waitForBarrier(barrier: Promise<void>, label: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([barrier, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 10_000);
    })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function linkedAttempt(attemptId: string, status: "LINKED" | "REVOKED" = "LINKED") {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const, status,
    expires_at: new Date(NOW + 3_600_000).toISOString(), linked: status === "LINKED" };
}

function createUploadService() {
  const uploadClient = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-credential"); } },
    fetchImpl: async (input) => String(input).endsWith("/chats/upload-files")
      ? new Response(JSON.stringify({ files: [{ file_id: "private-file-id", url: INPUT_URL }] }),
          { status: 200, headers: { "content-type": "application/json" } })
      : new Response("{}", { status: 404, headers: { "content-type": "application/json" } })
  });
  return new OwnerClarityUpscaleUploadService({
    binding: AUTH_BINDING,
    linkService: { async getStatus(_binding: AuthBinding, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG,
    catalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    now: () => NOW,
    resolveClient: () => uploadClient
  });
}

function preflightSnapshot(overrides: { account?: Record<string, unknown>; model_access?: Record<string, unknown> } = {}) {
  const observedAt = new Date(NOW).toISOString();
  return {
    account: {
      balance: { unit: "tokens", available: "unreported" },
      subscription: { active: true, plan_type: "PAID", end_date: null, end_date_kind: null },
      contract_evidence: "PUBLIC_FRONTEND_OBSERVED", source_build: "1789134564", observed_at: observedAt,
      ...overrides.account
    },
    model_access: {
      catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
      catalog_version: `${CATALOG.fetched_at}.${CATALOG.source_hashes.models.slice(7, 19)}`,
      model_id: "clarity", ai_name: "clarity", model_type: "clarity", account_read_live: true,
      parameter_keys: [], parameters_redacted: true, access: true, cost: 0, discount_cost: null,
      free_remaining_generations: null, limit: null, show_warning: false, observed_at: observedAt,
      ...overrides.model_access
    }
  };
}

function historySnapshot(options: { ownerObjects?: readonly unknown[]; botObjects?: readonly unknown[]; messages?: readonly unknown[]; requestedChat?: string } = {}) {
  const owner = {
    message_id: OWNER_ECHO_ID, provider_chat_id: "91372", author_role: "owner",
    objects: options.ownerObjects ?? [{ message_object_id: "source-object-1", object_type: "image", model_type: null }]
  };
  const bot = {
    message_id: BOT_MESSAGE_ID, provider_chat_id: "91372", author_role: "bot",
    objects: options.botObjects ?? [{ message_object_id: RESULT_OBJECT_ID, object_type: "image", model_type: "clarity" }]
  };
  const messages = options.messages ?? [owner, bot];
  return {
    complete: true, page: 1, page_size: 10, total_count: messages.length, total_pages: 1,
    has_next: false, has_previous: false, requested_chat_uuid: options.requestedChat ?? CHAT_UUID,
    provider_chat_id: "91372", messages
  } as unknown as ChatMessageHistorySnapshot;
}

function resultEnvelope(overrides: Record<string, unknown> = {}): InternalClarityUpscaleResult {
  return {
    status: "COMPLETE", chat_uuid: CHAT_UUID, message_id: BOT_MESSAGE_ID,
    message_object_id: RESULT_OBJECT_ID, object_type: "image", model_type: "clarity", completed: true,
    artifact: { url: OUTPUT_URL, mime_type: "image/png", mime_source: "URL_EXTENSION" },
    ...overrides
  } as InternalClarityUpscaleResult;
}

function fakeClient(options: {
  readonly events: string[];
  readonly post?: (request: Record<string, unknown>) => Promise<{ chat_uuid: string; message_id: string }>;
  readonly history?: () => Promise<ChatMessageHistorySnapshot>;
  readonly result?: () => Promise<InternalClarityUpscaleResult>;
  readonly inProgress?: () => Promise<InProgressMessage[]>;
}) {
  return {
    async createImageUpscalerChat(title: string) {
      options.events.push("create-chat");
      assert.equal(title.startsWith("owner-clarity-upscale-"), true);
      return { chat_uuid: CHAT_UUID };
    },
    async startClarityUpscaleWithOwnedCandidate(request: Record<string, unknown>) {
      options.events.push("post");
      const consumed = consumeOwnerClarityUpscaleOneShotPermit({
        permit: request.permit as never,
        candidate: request.candidate as never,
        principal: request.principal as GenerationPrincipalRef,
        attemptId: request.attemptId as string
      });
      assert.equal(consumed.status, "consumed");
      return options.post ? options.post(request) : { chat_uuid: CHAT_UUID, message_id: OWNER_ECHO_ID };
    },
    async listMessageCandidates(chatUuid: string, ownerEchoMessageId: string) {
      options.events.push("history-get");
      assert.equal(chatUuid, CHAT_UUID);
      assert.equal(ownerEchoMessageId, OWNER_ECHO_ID);
      return options.history ? options.history() : historySnapshot();
    },
    async listInProgress(chatUuid: string) {
      options.events.push("inprogress-get");
      assert.equal(chatUuid, CHAT_UUID);
      return options.inProgress ? options.inProgress() : [];
    },
    async getClarityUpscaleResult(chatUuid: string, messageId: string) {
      options.events.push("result-get");
      assert.equal(chatUuid, CHAT_UUID);
      assert.equal(messageId, BOT_MESSAGE_ID);
      return options.result ? options.result() : resultEnvelope();
    }
  };
}

function setup(options: {
  readonly preflight?: (attemptId: string, principal: GenerationPrincipalRef, signal?: AbortSignal) => Promise<unknown>;
  readonly client?: ReturnType<typeof fakeClient>;
  readonly now?: () => number;
  readonly linkStatus?: () => "LINKED" | "REVOKED";
  readonly pollDelayMs?: number;
  readonly maxPollAttempts?: number;
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly events?: string[];
} = {}) {
  const uploadService = createUploadService();
  const events: string[] = options.events ?? [];
  const calls = { preflight: 0, post: 0, history: 0, result: 0, inprogress: 0 };
  const client = options.client ?? fakeClient({ events,
    post: async (request) => {
      calls.post += 1;
      events.push("post-invoked");
      assert.equal(typeof (request.candidate as { request_fingerprint: unknown }).request_fingerprint, "string");
      return { chat_uuid: CHAT_UUID, message_id: OWNER_ECHO_ID };
    },
    history: async () => { calls.history += 1; return historySnapshot(); },
    result: async () => { calls.result += 1; return resultEnvelope(); },
    inProgress: async () => { calls.inprogress += 1; return []; }
  });
  const service = new OwnerClarityUpscaleGenerationService({
    binding: AUTH_BINDING,
    linkService: { async getStatus(_binding: AuthBinding, attemptId: string) { return linkedAttempt(attemptId, options.linkStatus?.() ?? "LINKED"); } },
    catalog: CATALOG,
    catalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    uploadService,
    resolveChatClient: () => client,
    preflight: async (attemptId, principal, signal) => {
      calls.preflight += 1;
      assert.equal(attemptId, ATTEMPT);
      assert.equal(principal.connection_id, ATTEMPT);
      assert.equal(signal?.aborted, false);
      return await (options.preflight ? options.preflight(attemptId, principal, signal) : Promise.resolve(preflightSnapshot())) as never;
    },
    now: options.now ?? (() => NOW),
    ...(options.pollDelayMs === undefined ? {} : { pollDelayMs: options.pollDelayMs }),
    ...(options.maxPollAttempts === undefined ? {} : { maxPollAttempts: options.maxPollAttempts }),
    ...(options.wait === undefined ? {} : { wait: options.wait })
  });
  return { service, uploadService, events, calls, client };
}

async function upload(setupValue: ReturnType<typeof setup>): Promise<string> {
  const receipt = await setupValue.uploadService.upload({
    attemptId: ATTEMPT, content_base64: PNG, filename: "input.png", mime_type: "image/png"
  });
  return receipt.image_handle;
}

test("Clarity one-shot generation uses fresh preflight, fixed chat scope and strict same-chat result binding", async () => {
  const context = setup({ pollDelayMs: 0 });
  const imageHandle = await upload(context);
  const result = await context.service.generate({ attemptId: ATTEMPT, image_handle: imageHandle,
    prompt: "clean edges", parameters: { professional_mode: false, scale_factor: 1.5, strength: 0.5, cfg: 4, denoise: 0.3 } });
  assert.equal(result.status, "result_observed");
  assert.equal(result.backend_acceptance, "unproven");
  assert.equal(result.model_id, "clarity");
  assert.equal(result.requested_scale_factor, 1.5);
  assert.deepEqual(result.input_image, { mime_type: "image/png", width: 1, height: 1 });
  assert.equal(result.expected_output_geometry, null, "1.5x of 1x1 is not an exact integer geometry");
  assert.equal(result.actual_image.width, null);
  assert.equal(result.actual_image.height, null);
  assert.equal(result.geometry_verified, false);
  assert.equal(result.artifact.mime_type, "image/png");
  assert.equal(result.artifact.mime_confidence, "URL_EXTENSION_ONLY");
  const serialized = JSON.stringify(result);
  for (const privateValue of [INPUT_URL, CHAT_UUID, OWNER_ECHO_ID, BOT_MESSAGE_ID, RESULT_OBJECT_ID, "clean edges"]) {
    assert.equal(serialized.includes(privateValue), false);
  }
  assert.equal(context.calls.preflight, 1);
  assert.equal(context.calls.post, 1);
  assert.equal(context.calls.history, 1);
  assert.equal(context.calls.result, 1);
  assert.equal(context.events.includes("inprogress-get"), false);
  await context.service.close();
  await context.uploadService.close();
});

test("real Clarity generation service uses the native HTTP adapter with one fake upload and one one-shot POST", async () => {
  const fetches: Array<{ url: string; method: string; body: unknown }> = [];
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-credential"); }
  };
  const client = new SyntxChatHttpClient({
    credentialBroker,
    fetchImpl: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const requestBody = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : init?.body;
      fetches.push({ url, method, body: requestBody });
      if (url.endsWith("/chats/upload-files")) {
        const form = init?.body as FormData;
        assert.equal(form.get("destination"), "uploaded");
        assert.equal(form.get("model_type"), "clarity");
        return new Response(JSON.stringify({ files: [{ file_id: "opaque-upload-id", url: INPUT_URL }] }),
          { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/chats") && method === "POST") {
        const chatRequest = requestBody as { title: string; scope: string };
        assert.match(chatRequest.title, /^owner-clarity-upscale-/u);
        assert.equal(chatRequest.scope, "tool_image_upscaler");
        return new Response(JSON.stringify({ uuid: CHAT_UUID }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "https://api.syntx.ai/api/v1/design/generate?ai_name=clarity") {
        const body = requestBody as { chat_uuid: string; prompt: string; settings: Record<string, unknown> };
        assert.equal(body.chat_uuid, CHAT_UUID);
        assert.equal(body.settings.model_type, "clarity");
        assert.deepEqual(body.settings.file_urls, [{ type: "image", url: INPUT_URL }]);
        return new Response(JSON.stringify({ id: OWNER_ECHO_ID }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes(`/chats/${CHAT_UUID}/messages?`)) {
        return new Response(JSON.stringify({
          messages: [
            { id: OWNER_ECHO_ID, chat_id: 91372, author_id: 7,
              message_object: [{ id: "source-image-object", message_id: OWNER_ECHO_ID, object_type: "image", model_type: null }] },
            { id: BOT_MESSAGE_ID, chat_id: 91372, author_id: -1,
              message_object: [{ id: RESULT_OBJECT_ID, message_id: BOT_MESSAGE_ID, object_type: "image", model_type: "clarity" }] }
          ],
          pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith(`/chats/${CHAT_UUID}/${BOT_MESSAGE_ID}`)) {
        return new Response(JSON.stringify({ id: BOT_MESSAGE_ID, author_id: -1,
          message_object: [{ id: RESULT_OBJECT_ID, message_id: BOT_MESSAGE_ID, object_type: "image", model_type: "clarity",
            completed: true, object_url: OUTPUT_URL }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    }
  });
  const uploadService = new OwnerClarityUpscaleUploadService({
    binding: AUTH_BINDING,
    linkService: { async getStatus(_binding: AuthBinding, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => client, now: () => NOW
  });
  const service = new OwnerClarityUpscaleGenerationService({
    binding: AUTH_BINDING,
    linkService: { async getStatus(_binding: AuthBinding, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    uploadService, resolveChatClient: () => client,
    preflight: async () => preflightSnapshot() as never, now: () => NOW, pollDelayMs: 0
  });
  const receipt = await uploadService.upload({ attemptId: ATTEMPT, content_base64: PNG, filename: "input.png", mime_type: "image/png" });
  const result = await service.generate({ attemptId: ATTEMPT, image_handle: receipt.image_handle,
    prompt: "source-bound clarity request", parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } });
  assert.equal(result.status, "result_observed");
  assert.equal(fetches.filter((entry) => entry.url.endsWith("/chats/upload-files")).length, 1);
  assert.equal(fetches.filter((entry) => entry.url === "https://api.syntx.ai/api/v1/design/generate?ai_name=clarity").length, 1);
  assert.equal(fetches.filter((entry) => entry.method === "POST" && entry.url.endsWith("/design/generate?ai_name=clarity")).length, 1);
  assert.equal(fetches.some((entry) => entry.url.includes("/messages/") && entry.method === "POST"), false);
  await service.close();
});

test("native Clarity HTTP adapter preserves only safe diagnostics when history GET fails", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-credential"); } },
    fetchImpl: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ url, method });
      if (url.endsWith("/chats/upload-files")) {
        return new Response(JSON.stringify({ files: [{ file_id: "private-upload-id", url: INPUT_URL }] }),
          { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/chats") && method === "POST") {
        return new Response(JSON.stringify({ uuid: CHAT_UUID }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "https://api.syntx.ai/api/v1/design/generate?ai_name=clarity") {
        return new Response(JSON.stringify({ id: OWNER_ECHO_ID }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes(`/chats/${CHAT_UUID}/messages?`)) {
        return new Response("provider-private-body", { status: 503, headers: { "content-type": "text/plain" } });
      }
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    }
  });
  const uploadService = new OwnerClarityUpscaleUploadService({
    binding: AUTH_BINDING,
    linkService: { async getStatus(_binding: AuthBinding, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => client, now: () => NOW
  });
  const service = new OwnerClarityUpscaleGenerationService({
    binding: AUTH_BINDING,
    linkService: { async getStatus(_binding: AuthBinding, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    uploadService, resolveChatClient: () => client,
    preflight: async () => preflightSnapshot() as never, now: () => NOW, pollDelayMs: 0, maxPollAttempts: 1
  });
  const uploaded = await uploadService.upload({ attemptId: ATTEMPT, content_base64: PNG, filename: "input.png", mime_type: "image/png" });
  let diagnostic: unknown;
  await assert.rejects(() => service.generate({ attemptId: ATTEMPT, image_handle: uploaded.image_handle,
    prompt: "private prompt", parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } }),
  (error: unknown) => {
    if (!(error instanceof OwnerClarityUpscaleGenerationServiceError) || error.code !== "OUTCOME_UNKNOWN") return false;
    diagnostic = error.diagnostic;
    return true;
  });
  assert.deepEqual(diagnostic, {
    phase: "HISTORY_GET", echo_ack_known: true, history_get_eligible: true,
    history_get_performed: true, history_get_count: 1, history_get_count_capped: false,
    history_binding: "NOT_RUN", history_binding_reason: null, result_get_performed: false, result_get_count: 0,
    result_get_count_capped: false, unverified_reason: null, upstream_error_code: "UPSTREAM_UNAVAILABLE"
  });
  const serialized = JSON.stringify(diagnostic);
  for (const value of ["provider-private-body", "private prompt", INPUT_URL, OWNER_ECHO_ID, CHAT_UUID, "private-upload-id"]) {
    assert.equal(serialized.includes(value), false);
  }
  assert.equal(requests.filter((entry) => entry.method === "POST" && entry.url.endsWith("/design/generate?ai_name=clarity")).length, 1);
  assert.equal(requests.filter((entry) => entry.url.includes(`/chats/${CHAT_UUID}/messages?`)).length, 1);
  assert.equal(requests.some((entry) => entry.url.endsWith(`/${BOT_MESSAGE_ID}`)), false);
  await service.close();
});

test("native Clarity fake-fetch keeps duplicate owner images rejected after widening bounded row parsing", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-credential"); } },
    fetchImpl: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ url, method });
      if (url.endsWith("/chats/upload-files")) {
        return new Response(JSON.stringify({ files: [{ file_id: "private-upload-id", url: INPUT_URL }] }),
          { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/chats") && method === "POST") {
        return new Response(JSON.stringify({ uuid: CHAT_UUID }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "https://api.syntx.ai/api/v1/design/generate?ai_name=clarity") {
        return new Response(JSON.stringify({ id: OWNER_ECHO_ID }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes(`/chats/${CHAT_UUID}/messages?`)) {
        return new Response(JSON.stringify({
          messages: [
            { id: OWNER_ECHO_ID, chat_id: 91372, author_id: 7, message_object: [
              { id: "source-object-a", message_id: OWNER_ECHO_ID, object_type: "image", model_type: null },
              { id: "source-object-b", message_id: OWNER_ECHO_ID, object_type: "image", model_type: null }
            ] },
            { id: BOT_MESSAGE_ID, chat_id: 91372, author_id: -1, message_object: [] }
          ],
          pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    }
  });
  const uploadService = new OwnerClarityUpscaleUploadService({
    binding: AUTH_BINDING,
    linkService: { async getStatus(_binding: AuthBinding, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => client, now: () => NOW
  });
  const service = new OwnerClarityUpscaleGenerationService({
    binding: AUTH_BINDING,
    linkService: { async getStatus(_binding: AuthBinding, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    uploadService, resolveChatClient: () => client,
    preflight: async () => preflightSnapshot() as never, now: () => NOW, pollDelayMs: 0, maxPollAttempts: 1
  });
  const uploaded = await uploadService.upload({ attemptId: ATTEMPT, content_base64: PNG, filename: "input.png", mime_type: "image/png" });
  let diagnostic: OwnerClarityUpscaleGenerationServiceError["diagnostic"];
  await assert.rejects(() => service.generate({ attemptId: ATTEMPT, image_handle: uploaded.image_handle,
    parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } }),
  (error: unknown) => {
    if (!(error instanceof OwnerClarityUpscaleGenerationServiceError) || error.code !== "OUTCOME_UNKNOWN") return false;
    diagnostic = error.diagnostic;
    return true;
  });
  assert.equal(diagnostic?.phase, "HISTORY_BINDING");
  assert.equal(diagnostic?.history_binding_reason, "OWNER_ECHO_OBJECT_INVALID");
  assert.equal(requests.filter((item) => item.method === "POST" && item.url.endsWith("/design/generate?ai_name=clarity")).length, 1);
  assert.equal(requests.filter((item) => item.url.includes(`/chats/${CHAT_UUID}/messages?`)).length, 1);
  assert.equal(requests.some((item) => item.url.endsWith(`/${BOT_MESSAGE_ID}`)), false);
  const safeDiagnostic = JSON.stringify(diagnostic);
  for (const privateValue of [INPUT_URL, CHAT_UUID, OWNER_ECHO_ID, BOT_MESSAGE_ID, "source-object-a", "source-object-b"]) {
    assert.equal(safeDiagnostic.includes(privateValue), false);
  }
  await service.close();
});

test("native Clarity generation accepts the exact owner ACK with one image and one text object", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-credential"); } },
    fetchImpl: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ url, method });
      if (url.endsWith("/chats/upload-files")) {
        return new Response(JSON.stringify({ files: [{ file_id: "private-upload-id", url: INPUT_URL }] }),
          { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/chats") && method === "POST") {
        return new Response(JSON.stringify({ uuid: CHAT_UUID }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "https://api.syntx.ai/api/v1/design/generate?ai_name=clarity") {
        return new Response(JSON.stringify({ id: OWNER_ECHO_ID }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes(`/chats/${CHAT_UUID}/messages?`)) {
        return new Response(JSON.stringify({
          messages: [
            { id: OWNER_ECHO_ID, chat_id: 91372, author_id: 7, message_object: [
              { id: "owner-image-object", message_id: OWNER_ECHO_ID, object_type: "image", model_type: null },
              { id: "owner-text-object", message_id: OWNER_ECHO_ID, object_type: "text", model_type: null }
            ] },
            { id: BOT_MESSAGE_ID, chat_id: 91372, author_id: -1,
              message_object: [{ id: RESULT_OBJECT_ID, message_id: BOT_MESSAGE_ID, object_type: "image", model_type: "clarity" }] }
          ],
          pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith(`/chats/${CHAT_UUID}/${BOT_MESSAGE_ID}`)) {
        return new Response(JSON.stringify({ id: BOT_MESSAGE_ID, author_id: -1,
          message_object: [{ id: RESULT_OBJECT_ID, message_id: BOT_MESSAGE_ID, object_type: "image", model_type: "clarity",
            completed: true, object_url: OUTPUT_URL }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    }
  });
  const uploadService = new OwnerClarityUpscaleUploadService({
    binding: AUTH_BINDING,
    linkService: { async getStatus(_binding: AuthBinding, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => client, now: () => NOW
  });
  const service = new OwnerClarityUpscaleGenerationService({
    binding: AUTH_BINDING,
    linkService: { async getStatus(_binding: AuthBinding, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    uploadService, resolveChatClient: () => client,
    preflight: async () => preflightSnapshot() as never, now: () => NOW, pollDelayMs: 0, maxPollAttempts: 1
  });
  const uploaded = await uploadService.upload({ attemptId: ATTEMPT, content_base64: PNG, filename: "input.png", mime_type: "image/png" });
  const result = await service.generate({ attemptId: ATTEMPT, image_handle: uploaded.image_handle,
    prompt: "private prompt", parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } });
  assert.equal(result.status, "result_observed");
  assert.equal(requests.filter((entry) => entry.method === "POST" && entry.url.endsWith("/design/generate?ai_name=clarity")).length, 1);
  assert.equal(requests.filter((entry) => entry.url.includes(`/chats/${CHAT_UUID}/messages?`)).length, 1);
  assert.equal(requests.filter((entry) => entry.url.endsWith(`/${BOT_MESSAGE_ID}`)).length, 1);
  for (const privateValue of [INPUT_URL, CHAT_UUID, OWNER_ECHO_ID, BOT_MESSAGE_ID, "owner-text-object", "private prompt"]) {
    assert.equal(JSON.stringify(result).includes(privateValue), false);
  }
  await service.close();
});

test("Clarity owner echo accepts reverse image/text order and preserves empty and image-only metadata", async () => {
  const supportedOwnerObjects: readonly (readonly unknown[])[] = [
    [{ message_object_id: "owner-text-object", object_type: "text", model_type: "clarity" },
      { message_object_id: "owner-image-object", object_type: "image", model_type: null }],
    [],
    [{ message_object_id: "owner-image-object", object_type: "image", model_type: "clarity" }]
  ];
  for (const ownerObjects of supportedOwnerObjects) {
    const events: string[] = [];
    const context = setup({ client: fakeClient({ events, history: async () => historySnapshot({ ownerObjects }) }),
      events, pollDelayMs: 0, maxPollAttempts: 1 });
    const imageHandle = await upload(context);
    const result = await context.service.generate({ attemptId: ATTEMPT, image_handle: imageHandle,
      parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } });
    assert.equal(result.status, "result_observed");
    assert.equal(events.filter((event) => event === "post").length, 1);
    assert.equal(events.filter((event) => event === "result-get").length, 1);
    await context.service.close();
    await context.uploadService.close();
  }
});

test("Clarity owner and bot history rejects unsupported or plural object combinations before result GET", async () => {
  const ownerObjectsCases: readonly (readonly unknown[])[] = [
    [{ message_object_id: "foreign-image", object_type: "image", model_type: "other-model" }],
    [{ message_object_id: "image-a", object_type: "image", model_type: null },
      { message_object_id: "image-b", object_type: "image", model_type: "clarity" }],
    [{ message_object_id: "text-a", object_type: "text", model_type: null },
      { message_object_id: "text-b", object_type: "text", model_type: "clarity" }],
    [{ message_object_id: "foreign-text", object_type: "text", model_type: "another-model" }],
    [{ message_object_id: "unknown-object", object_type: "audio", model_type: null }]
  ];
  const botObjectsCases: readonly (readonly unknown[])[] = [
    [{ message_object_id: "bot-image-a", object_type: "image", model_type: "clarity" },
      { message_object_id: "bot-image-b", object_type: "image", model_type: "clarity" }],
    [{ message_object_id: "bot-image", object_type: "image", model_type: "clarity" },
      { message_object_id: "bot-text", object_type: "text", model_type: null }],
    [{ message_object_id: "foreign-bot-image", object_type: "image", model_type: "other-model" }]
  ];
  const histories = [
    ...ownerObjectsCases.map((ownerObjects) => ({ history: historySnapshot({ ownerObjects }), reason: "OWNER_ECHO_OBJECT_INVALID" })),
    ...botObjectsCases.map((botObjects) => ({ history: historySnapshot({ botObjects }), reason: "BOT_OBJECT_INVALID" }))
  ];
  for (const { history, reason } of histories) {
    const events: string[] = [];
    const context = setup({ client: fakeClient({ events, history: async () => history }), events, pollDelayMs: 0, maxPollAttempts: 1 });
    const imageHandle = await upload(context);
    let diagnostic: OwnerClarityUpscaleGenerationServiceError["diagnostic"];
    await assert.rejects(() => context.service.generate({ attemptId: ATTEMPT, image_handle: imageHandle,
      parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } }),
    (error: unknown) => {
      if (!(error instanceof OwnerClarityUpscaleGenerationServiceError) || error.code !== "OUTCOME_UNKNOWN") return false;
      diagnostic = error.diagnostic;
      return true;
    });
    assert.equal(diagnostic?.history_binding_reason, reason);
    assert.equal(events.filter((event) => event === "post").length, 1);
    assert.equal(events.filter((event) => event === "result-get").length, 0);
    await context.service.close();
    await context.uploadService.close();
  }
});

test("native Clarity HTTP adapter retries only the history-bound exact result after queue removal", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  let resultReads = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-credential"); } },
    fetchImpl: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ url, method });
      if (url.endsWith("/chats/upload-files")) {
        return new Response(JSON.stringify({ files: [{ file_id: "native-private-upload-id", url: INPUT_URL }] }),
          { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/chats") && method === "POST") {
        return new Response(JSON.stringify({ uuid: CHAT_UUID }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "https://api.syntx.ai/api/v1/design/generate?ai_name=clarity") {
        return new Response(JSON.stringify({ id: OWNER_ECHO_ID }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes(`/chats/${CHAT_UUID}/messages?`)) {
        const messages = [
          { id: OWNER_ECHO_ID, chat_id: 91372, author_id: 7,
            message_object: [{ id: "source-image-object", message_id: OWNER_ECHO_ID, object_type: "image", model_type: null }] },
          { id: BOT_MESSAGE_ID, chat_id: 91372, author_id: -1,
            message_object: [{ id: RESULT_OBJECT_ID, message_id: BOT_MESSAGE_ID, object_type: "image", model_type: "clarity" }] }
        ];
        return new Response(JSON.stringify({ messages, pagination: { page: 1, page_size: 10, total_count: 2,
          total_pages: 1, has_next: false, has_previous: false } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === `https://api.syntx.ai/api/v1/chats/${CHAT_UUID}/inprogress`) {
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === `https://api.syntx.ai/api/v1/chats/${CHAT_UUID}/${BOT_MESSAGE_ID}`) {
        resultReads += 1;
        const body = resultReads === 1
          ? { id: BOT_MESSAGE_ID, author_id: -1, message_object: [] }
          : { id: BOT_MESSAGE_ID, author_id: -1, message_object: [{ id: RESULT_OBJECT_ID, message_id: BOT_MESSAGE_ID,
              object_type: "image", model_type: "clarity", completed: true, object_url: OUTPUT_URL }] };
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    }
  });
  const uploadService = new OwnerClarityUpscaleUploadService({
    binding: AUTH_BINDING,
    linkService: { async getStatus(_binding: AuthBinding, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => client, now: () => NOW
  });
  const service = new OwnerClarityUpscaleGenerationService({
    binding: AUTH_BINDING,
    linkService: { async getStatus(_binding: AuthBinding, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    uploadService, resolveChatClient: () => client,
    preflight: async () => preflightSnapshot() as never, now: () => NOW,
    pollDelayMs: 0, maxPollAttempts: 2
  });
  const uploaded = await uploadService.upload({ attemptId: ATTEMPT, content_base64: PNG, filename: "input.png", mime_type: "image/png" });
  const result = await service.generate({ attemptId: ATTEMPT, image_handle: uploaded.image_handle,
    parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } });
  assert.equal(result.status, "result_observed");
  assert.equal(requests.filter((entry) => entry.method === "POST" && entry.url.endsWith("/design/generate?ai_name=clarity")).length, 1);
  assert.equal(requests.filter((entry) => entry.url.includes(`/chats/${CHAT_UUID}/messages?`)).length, 1);
  assert.equal(requests.filter((entry) => entry.url.endsWith(`/${BOT_MESSAGE_ID}`)).length, 2);
  assert.equal(requests.filter((entry) => entry.url.endsWith(`/chats/${CHAT_UUID}/inprogress`)).length, 1);
  assert.equal(resultReads, 2);
  await service.close();
});

test("expected geometry is reported only when multiplication yields exact integer dimensions", async () => {
  const context = setup({ pollDelayMs: 0 });
  const imageHandle = await upload(context);
  const result = await context.service.generate({ attemptId: ATTEMPT, image_handle: imageHandle,
    parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } });
  assert.deepEqual(result.expected_output_geometry, { width: 2, height: 2 });
  assert.deepEqual(result.actual_image, { mime_type: "image/png", width: null, height: null });
  assert.equal(result.geometry_verified, false);
  await context.service.close();
  await context.uploadService.close();
});

test("preflight failure releases the local upload-handle claim and never creates a chat or POST", async () => {
  let reads = 0;
  const context = setup({ pollDelayMs: 0, preflight: async () => {
    reads += 1;
    if (reads === 1) return preflightSnapshot({ model_access: { access: false } });
    return preflightSnapshot();
  } });
  const imageHandle = await upload(context);
  const request = { attemptId: ATTEMPT, image_handle: imageHandle, parameters: { professional_mode: false, scale_factor: 1.5, strength: 0.5, cfg: 4, denoise: 0.3 } };
  await assert.rejects(() => context.service.generate(request),
    (error: unknown) => error instanceof OwnerClarityUpscaleGenerationServiceError && error.code === "PREFLIGHT_FAILED");
  const result = await context.service.generate(request);
  assert.equal(result.status, "result_observed");
  assert.equal(context.calls.post, 1);
  assert.equal(context.events.filter((entry) => entry === "create-chat").length, 1);
  await context.service.close();
  await context.uploadService.close();
});

test("unverified, stale or unknown-cost preflight denies before chat and POST", async () => {
  const cases = [
    preflightSnapshot({ account: { subscription: { active: null, plan_type: "PAID", end_date: null, end_date_kind: null } } }),
    preflightSnapshot({ account: { subscription: { active: true, plan_type: "FREE", end_date: null, end_date_kind: null } } }),
    preflightSnapshot({ account: { subscription: { active: true, plan_type: "PAID", end_date: "2026-10-09", end_date_kind: "DATE_ONLY" } } }),
    preflightSnapshot({ model_access: { access: null } }),
    preflightSnapshot({ model_access: { cost: null, discount_cost: null } }),
    preflightSnapshot({ model_access: { cost: -1, discount_cost: null } }),
    preflightSnapshot({ model_access: { parameter_keys: ["size"] } }),
    preflightSnapshot({ model_access: { model_type: "banana-2.1" } }),
    preflightSnapshot({ account: { observed_at: new Date(NOW - 31_000).toISOString() } }),
    preflightSnapshot({ model_access: { observed_at: new Date(NOW - 31_000).toISOString() } })
  ];
  for (const snapshot of cases) {
    const context = setup({ pollDelayMs: 0, preflight: async () => snapshot });
    const imageHandle = await upload(context);
    await assert.rejects(() => context.service.generate({ attemptId: ATTEMPT, image_handle: imageHandle,
      parameters: { professional_mode: false, scale_factor: 1.5, strength: 0.5, cfg: 4, denoise: 0.3 } }),
    (error: unknown) => error instanceof OwnerClarityUpscaleGenerationServiceError && error.code === "PREFLIGHT_FAILED");
    assert.equal(context.calls.post, 0);
    assert.equal(context.events.includes("create-chat"), false);
    await context.service.close();
    await context.uploadService.close();
  }
});

test("uncertain POST ACK is never retried and reconciliation without echo performs no GET", async () => {
  const events: string[] = [];
  const client = fakeClient({ events, post: async () => { throw new SyntxHttpError("UPSTREAM_TIMEOUT", "private URL"); } });
  const context = setup({ client, events, pollDelayMs: 0 });
  const imageHandle = await upload(context);
  let recoveryId = "";
  await assert.rejects(() => context.service.generate({ attemptId: ATTEMPT, image_handle: imageHandle,
    parameters: { professional_mode: false, scale_factor: 1.5, strength: 0.5, cfg: 4, denoise: 0.3 } }), (error: unknown) => {
    if (!(error instanceof OwnerClarityUpscaleGenerationServiceError) || error.code !== "OUTCOME_UNKNOWN") return false;
    recoveryId = error.recovery_id ?? "";
    return recoveryId.startsWith("clarity_recovery_") && !String(error).includes(INPUT_URL) && !String(error).includes("private URL");
  });
  await assert.rejects(() => context.service.generate({ attemptId: ATTEMPT, image_handle: imageHandle,
    parameters: { professional_mode: false, scale_factor: 1.5, strength: 0.5, cfg: 4, denoise: 0.3 } }),
  (error: unknown) => error instanceof OwnerClarityUpscaleGenerationServiceError && error.code === "IMAGE_HANDLE_ALREADY_USED");
  await assert.rejects(() => context.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }),
    (error: unknown) => error instanceof OwnerClarityUpscaleGenerationServiceError &&
      error.code === "OUTCOME_UNKNOWN" && error.recovery_id === recoveryId);
  assert.equal(events.filter((entry) => entry === "post").length, 1);
  assert.equal(events.some((entry) => entry === "history-get" || entry === "result-get"), false);
  await context.service.close();
  await context.uploadService.close();
});

test("Clarity unknown diagnostics record lost POST ACK without exposing values or enabling GET", async () => {
  const events: string[] = [];
  const privateMessage = "private URL and provider trace";
  const client = fakeClient({ events, post: async () => { throw new SyntxHttpError("UPSTREAM_TIMEOUT", privateMessage); } });
  const context = setup({ client, events, pollDelayMs: 0 });
  const imageHandle = await upload(context);
  let diagnostic: unknown;
  await assert.rejects(() => context.service.generate({ attemptId: ATTEMPT, image_handle: imageHandle,
    prompt: "private prompt", parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } }),
  (error: unknown) => {
    if (!(error instanceof OwnerClarityUpscaleGenerationServiceError) || error.code !== "OUTCOME_UNKNOWN") return false;
    diagnostic = (error as OwnerClarityUpscaleGenerationServiceError & { diagnostic?: unknown }).diagnostic;
    return true;
  });
  assert.deepEqual(diagnostic, {
    phase: "POST_CALL_STARTED", echo_ack_known: false, history_get_eligible: false,
    history_get_performed: false, history_get_count: 0, history_get_count_capped: false,
    history_binding: "NOT_RUN", history_binding_reason: null, result_get_performed: false, result_get_count: 0,
    result_get_count_capped: false, unverified_reason: null, upstream_error_code: "UPSTREAM_TIMEOUT"
  });
  assert.equal(JSON.stringify(diagnostic).includes(privateMessage), false);
  assert.equal(JSON.stringify(diagnostic).includes("private prompt"), false);
  assert.equal(events.some((event) => event === "history-get" || event === "result-get"), false);
  await context.service.close();
  await context.uploadService.close();
});

test("recovery with a known owner echo is GET-only and never reruns account/cost preflight", async () => {
  let historyCalls = 0;
  let resultCalls = 0;
  const events: string[] = [];
  const client = fakeClient({ events,
    post: async () => ({ chat_uuid: CHAT_UUID, message_id: OWNER_ECHO_ID }),
    history: async () => { historyCalls += 1; return historySnapshot(); },
    result: async () => { resultCalls += 1; if (resultCalls === 1) throw new Error("temporary GET read error"); return resultEnvelope(); }
  });
  const context = setup({ client, events, pollDelayMs: 0, maxPollAttempts: 1 });
  const imageHandle = await upload(context);
  let recoveryId = "";
  await assert.rejects(() => context.service.generate({ attemptId: ATTEMPT, image_handle: imageHandle,
    parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } }), (error: unknown) => {
    if (!(error instanceof OwnerClarityUpscaleGenerationServiceError) || error.code !== "OUTCOME_UNKNOWN") return false;
    recoveryId = error.recovery_id ?? "";
    return Boolean(recoveryId);
  });
  const beforePreflight = context.calls.preflight;
  const recovered = await context.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
  assert.equal(recovered.status, "result_observed");
  assert.equal(context.calls.preflight, beforePreflight);
  assert.equal(events.filter((entry) => entry === "post").length, 1);
  assert.equal(historyCalls, 1);
  assert.equal(resultCalls, 2);
  await context.service.close();
  await context.uploadService.close();
});

test("Clarity permanent decoder reason is closed immediately with the exact bounded result GET only", async () => {
  const events: string[] = [];
  const reason = "RESULT_OBJECT_MISMATCH";
  const client = fakeClient({ events, result: async () => ({ status: "UNVERIFIED", chat_uuid: CHAT_UUID,
    message_id: BOT_MESSAGE_ID, model_type: "clarity", reason, objects: [] }) as InternalClarityUpscaleResult });
  const context = setup({ client, events, pollDelayMs: 0, maxPollAttempts: 1 });
  const imageHandle = await upload(context);
  let diagnostic: unknown;
  await assert.rejects(() => context.service.generate({ attemptId: ATTEMPT, image_handle: imageHandle,
    prompt: "private prompt", parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } }),
  (error: unknown) => {
    if (!(error instanceof OwnerClarityUpscaleGenerationServiceError) || error.code !== "OUTCOME_UNKNOWN") return false;
    diagnostic = error.diagnostic;
    return true;
  });
  assert.deepEqual(diagnostic, {
    phase: "RESULT_BINDING", echo_ack_known: true, history_get_eligible: true,
    history_get_performed: true, history_get_count: 1, history_get_count_capped: false,
    history_binding: "VALID", history_binding_reason: null, result_get_performed: true, result_get_count: 1,
    result_get_count_capped: false, unverified_reason: reason, upstream_error_code: null
  });
  const listed = await context.service.listRecoveries({ attemptId: ATTEMPT, limit: 5 });
  assert.deepEqual(listed[0]?.diagnostic, diagnostic);
  assert.equal(JSON.stringify(listed).includes("private prompt"), false);
  assert.equal(events.some((event) => event === "inprogress-get"), false);
  assert.equal(Object.isFrozen(diagnostic), true);
  await context.service.close();
  await context.uploadService.close();
});

test("Clarity diagnostic snapshot rejects accessors, proxies, and unknown fields without invoking getters", () => {
  const valid = {
    phase: "POST_CALL_STARTED", echo_ack_known: false, history_get_eligible: false,
    history_get_performed: false, history_get_count: 0, history_get_count_capped: false,
    history_binding: "NOT_RUN", history_binding_reason: null, result_get_performed: false, result_get_count: 0,
    result_get_count_capped: false, unverified_reason: null, upstream_error_code: null
  };
  let getterCalls = 0;
  const accessor = { ...valid } as Record<string, unknown>;
  Object.defineProperty(accessor, "private", { enumerable: true, get() { getterCalls += 1; return "secret"; } });
  assert.throws(() => new OwnerClarityUpscaleGenerationServiceError("OUTCOME_UNKNOWN", "clarity_recovery_823e4567-e89b-12d3-a456-426614174000", accessor));
  assert.throws(() => new OwnerClarityUpscaleGenerationServiceError("OUTCOME_UNKNOWN", "clarity_recovery_823e4567-e89b-12d3-a456-426614174000", new Proxy(valid, {})));
  assert.throws(() => new OwnerClarityUpscaleGenerationServiceError("OUTCOME_UNKNOWN", "clarity_recovery_823e4567-e89b-12d3-a456-426614174000", { ...valid, private: "secret" }));
  assert.throws(() => new OwnerClarityUpscaleGenerationServiceError("OUTCOME_UNKNOWN", "clarity_recovery_823e4567-e89b-12d3-a456-426614174000", { ...valid, history_binding_reason: "UNRECOGNIZED" }));
  const { history_binding_reason: _missingRequiredField, ...oldShape } = valid;
  assert.throws(() => new OwnerClarityUpscaleGenerationServiceError("OUTCOME_UNKNOWN", "clarity_recovery_823e4567-e89b-12d3-a456-426614174000", oldShape));
  assert.equal(getterCalls, 0);
});

test("Clarity GET diagnostics accumulate across bounded reconciliations without replaying POST", async () => {
  const events: string[] = [];
  const client = fakeClient({ events,
    history: async () => historySnapshot(),
    result: async () => { throw new SyntxHttpError("UPSTREAM_UNAVAILABLE", "private result response"); }
  });
  const context = setup({ client, events, pollDelayMs: 0, maxPollAttempts: 1 });
  const imageHandle = await upload(context);
  let recoveryId = "";
  await assert.rejects(() => context.service.generate({ attemptId: ATTEMPT, image_handle: imageHandle,
    parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } }),
  (error: unknown) => {
    if (!(error instanceof OwnerClarityUpscaleGenerationServiceError) || error.code !== "OUTCOME_UNKNOWN") return false;
    recoveryId = error.recovery_id ?? "";
    return true;
  });
  for (let index = 0; index < 31; index += 1) {
    await assert.rejects(() => context.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }),
      (error: unknown) => error instanceof OwnerClarityUpscaleGenerationServiceError && error.code === "OUTCOME_UNKNOWN");
  }
  const [listed] = await context.service.listRecoveries({ attemptId: ATTEMPT, limit: 1 });
  assert.deepEqual(listed?.diagnostic, {
    phase: "RESULT_GET", echo_ack_known: true, history_get_eligible: true,
    history_get_performed: true, history_get_count: 1, history_get_count_capped: false,
    history_binding: "VALID", history_binding_reason: null, result_get_performed: true, result_get_count: 32,
    result_get_count_capped: false, unverified_reason: null, upstream_error_code: "UPSTREAM_UNAVAILABLE"
  });
  assert.equal(events.filter((event) => event === "post").length, 1);
  assert.equal(events.filter((event) => event === "history-get").length, 1);
  assert.equal(events.filter((event) => event === "result-get").length, 32);
  await context.service.close();
  await context.uploadService.close();
});

test("Clarity retries only the exact bound result after a pending decode and an empty in-progress queue", async () => {
  const events: string[] = [];
  let resultReads = 0;
  const delays: number[] = [];
  const client = fakeClient({ events, result: async () => {
    resultReads += 1;
    return resultReads === 1
      ? { status: "UNVERIFIED", chat_uuid: CHAT_UUID, message_id: BOT_MESSAGE_ID,
          model_type: "clarity", reason: "NO_IMAGE_OBJECTS", objects: [] } as InternalClarityUpscaleResult
      : resultEnvelope();
  }, inProgress: async () => [] });
  const context = setup({ client, events, pollDelayMs: 0, maxPollAttempts: 3,
    wait: async (milliseconds) => { delays.push(milliseconds); } });
  const imageHandle = await upload(context);
  const result = await context.service.generate({ attemptId: ATTEMPT, image_handle: imageHandle,
    parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } });
  assert.equal(result.status, "result_observed");
  assert.deepEqual(delays, []);
  assert.equal(resultReads, 2);
  assert.equal(events.filter((event) => event === "post").length, 1);
  await context.service.close();
  await context.uploadService.close();
});

test("Clarity waits through two empty queue rounds before binding the exact late bot result", async () => {
  const events: string[] = [];
  const delays: number[] = [];
  let now = NOW;
  let histories = 0;
  const ownerOnly = historySnapshot({ messages: [historySnapshot().messages[0]!] });
  const client = fakeClient({ events,
    history: async () => { histories += 1; return histories <= 2 ? ownerOnly : historySnapshot(); },
    inProgress: async () => []
  });
  const context = setup({ client, events, maxPollAttempts: 4, now: () => now,
    wait: async (milliseconds) => { delays.push(milliseconds); now += milliseconds; } });
  const imageHandle = await upload(context);
  const result = await context.service.generate({ attemptId: ATTEMPT, image_handle: imageHandle,
    parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } });
  assert.equal(result.status, "result_observed");
  assert.deepEqual(delays, [2_000, 2_400]);
  assert.equal(histories, 3);
  assert.equal(events.filter((event) => event === "inprogress-get").length, 2);
  assert.equal(events.filter((event) => event === "result-get").length, 1);
  assert.equal(events.filter((event) => event === "post").length, 1);
  await context.service.close();
  await context.uploadService.close();
});

test("attempt invalidation aborts and drains a bounded completion wait without another GET", async () => {
  const events: string[] = [];
  let enteredWait!: () => void;
  const waitEntered = new Promise<void>((resolve) => { enteredWait = resolve; });
  const client = fakeClient({ events, result: async () => ({ status: "UNVERIFIED", chat_uuid: CHAT_UUID,
    message_id: BOT_MESSAGE_ID, model_type: "clarity", reason: "NO_IMAGE_OBJECTS", objects: [] }) as InternalClarityUpscaleResult });
  const context = setup({ client, events, maxPollAttempts: 4, wait: async (_milliseconds, signal) => {
    enteredWait();
    await new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  } });
  const imageHandle = await upload(context);
  const generating = context.service.generate({ attemptId: ATTEMPT, image_handle: imageHandle,
    parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } });
  try {
    await waitForBarrier(waitEntered, "Clarity completion wait entry");
    await context.service.invalidateAttempt(ATTEMPT);
    await assert.rejects(() => generating,
      (error: unknown) => error instanceof OwnerClarityUpscaleGenerationServiceError && error.code === "OUTCOME_UNKNOWN");
    assert.deepEqual(await context.service.listRecoveries({ attemptId: ATTEMPT, limit: 5 }), []);
    assert.equal(events.filter((event) => event === "post").length, 1);
    assert.equal(events.filter((event) => event === "result-get").length, 1);
  } finally {
    await context.service.close();
    await context.uploadService.close();
  }
});

test("absolute completion deadline stops a late exact-result read even when its recovery handle remains scoped", async () => {
  const events: string[] = [];
  let now = NOW;
  const client = fakeClient({ events, result: async () => ({ status: "UNVERIFIED", chat_uuid: CHAT_UUID,
    message_id: BOT_MESSAGE_ID, model_type: "clarity", reason: "NO_IMAGE_OBJECTS", objects: [] }) as InternalClarityUpscaleResult });
  const context = setup({ client, events, maxPollAttempts: 4, now: () => now,
    wait: async () => { now += 180_000; } });
  const imageHandle = await upload(context);
  let recoveryId = "";
  await assert.rejects(() => context.service.generate({ attemptId: ATTEMPT, image_handle: imageHandle,
    parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } }),
  (error: unknown) => {
    if (!(error instanceof OwnerClarityUpscaleGenerationServiceError) || error.code !== "OUTCOME_UNKNOWN") return false;
    recoveryId = error.recovery_id ?? "";
    return true;
  });
  assert.equal(recoveryId.startsWith("clarity_recovery_"), true);
  assert.equal(events.filter((event) => event === "post").length, 1);
  assert.equal(events.filter((event) => event === "result-get").length, 1);
  const [recovery] = await context.service.listRecoveries({ attemptId: ATTEMPT, limit: 1 });
  assert.equal(recovery?.diagnostic.result_get_count, 1);
  await context.service.close();
  await context.uploadService.close();
});

test("explicit reconcile gets a fresh bounded GET-only budget after an exhausted 180-second generation window", async () => {
  const events: string[] = [];
  let now = NOW;
  let resultAvailable = false;
  let resultReads = 0;
  const client = fakeClient({ events,
    result: async () => {
      resultReads += 1;
      return resultAvailable ? resultEnvelope() : ({ status: "UNVERIFIED", chat_uuid: CHAT_UUID,
        message_id: BOT_MESSAGE_ID, model_type: "clarity", reason: "NO_IMAGE_OBJECTS", objects: [] } as InternalClarityUpscaleResult);
    },
    inProgress: async () => [{ message_id: BOT_MESSAGE_ID, message_object_id: RESULT_OBJECT_ID,
      object_type: "image", model_type: "clarity" }]
  });
  const context = setup({ client, events, now: () => now,
    wait: async (milliseconds) => { now += milliseconds; } });
  const imageHandle = await upload(context);
  let recoveryId = "";
  await assert.rejects(() => context.service.generate({ attemptId: ATTEMPT, image_handle: imageHandle,
    parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } }),
  (error: unknown) => {
    if (!(error instanceof OwnerClarityUpscaleGenerationServiceError) || error.code !== "OUTCOME_UNKNOWN") return false;
    recoveryId = error.recovery_id ?? "";
    return true;
  });
  assert.equal(now - NOW, 180_000);
  assert.equal(resultReads > 1, true);
  const postsBeforeReconcile = events.filter((event) => event === "post").length;
  const readsBeforeReconcile = resultReads;
  resultAvailable = true;
  const recovered = await context.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
  assert.equal(recovered.status, "result_observed");
  assert.equal(events.filter((event) => event === "post").length, postsBeforeReconcile);
  assert.equal(resultReads, readsBeforeReconcile + 1);
  assert.equal(events.filter((event) => event === "result-get").length, resultReads);
  assert.equal((await context.service.listRecoveries({ attemptId: ATTEMPT, limit: 1 })).length, 0);
  await context.service.close();
  await context.uploadService.close();
});

test("Clarity unknown outcome remains GET-only recoverable after 16 minutes and its consumed image claim stays reserved", async () => {
  const events: string[] = [];
  let now = NOW;
  let resultAvailable = false;
  let resultReads = 0;
  const client = fakeClient({ events,
    result: async () => {
      resultReads += 1;
      return resultAvailable ? resultEnvelope() : ({ status: "UNVERIFIED", chat_uuid: CHAT_UUID,
        message_id: BOT_MESSAGE_ID, model_type: "clarity", reason: "NO_IMAGE_OBJECTS", objects: [] } as InternalClarityUpscaleResult);
    }
  });
  const context = setup({ client, events, now: () => now, maxPollAttempts: 1, pollDelayMs: 0 });
  const imageHandle = await upload(context);
  let recoveryId = "";
  await assert.rejects(() => context.service.generate({ attemptId: ATTEMPT, image_handle: imageHandle,
    parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } }),
  (error: unknown) => {
    if (!(error instanceof OwnerClarityUpscaleGenerationServiceError) || error.code !== "OUTCOME_UNKNOWN") return false;
    recoveryId = error.recovery_id ?? "";
    return true;
  });
  assert.equal(events.filter((event) => event === "post").length, 1);
  assert.equal(resultReads, 1);
  const preflightCountBeforeReconcile = context.calls.preflight;

  now += 16 * 60_000;
  resultAvailable = true;
  const recovered = await context.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
  assert.equal(recovered.status, "result_observed");
  assert.equal(events.filter((event) => event === "post").length, 1, "reconciliation must never replay the POST");
  assert.equal(resultReads, 2, "reconciliation performs one new result GET");
  assert.equal(context.calls.preflight, preflightCountBeforeReconcile, "GET-only recovery must not rerun account/model preflight");

  await assert.rejects(() => context.service.generate({ attemptId: ATTEMPT, image_handle: imageHandle,
    parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } }),
  (error: unknown) => error instanceof OwnerClarityUpscaleGenerationServiceError && error.code === "IMAGE_HANDLE_ALREADY_USED");
  assert.equal(events.filter((event) => event === "post").length, 1, "an expired recovery cannot release a consumed image claim");
  await context.service.close();
});

test("Clarity long-job recovery rechecks linked authorization before any GET", async () => {
  const events: string[] = [];
  let now = NOW;
  let status: "LINKED" | "REVOKED" = "LINKED";
  const client = fakeClient({ events,
    result: async () => ({ status: "UNVERIFIED", chat_uuid: CHAT_UUID, message_id: BOT_MESSAGE_ID,
      model_type: "clarity", reason: "NO_IMAGE_OBJECTS", objects: [] } as InternalClarityUpscaleResult)
  });
  const context = setup({ client, events, now: () => now, linkStatus: () => status, maxPollAttempts: 1, pollDelayMs: 0 });
  const imageHandle = await upload(context);
  let recoveryId = "";
  await assert.rejects(() => context.service.generate({ attemptId: ATTEMPT, image_handle: imageHandle,
    parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } }),
  (error: unknown) => {
    if (!(error instanceof OwnerClarityUpscaleGenerationServiceError) || error.code !== "OUTCOME_UNKNOWN") return false;
    recoveryId = error.recovery_id ?? "";
    return true;
  });
  const getCountBefore = events.filter((event) => event === "result-get").length;
  now += 16 * 60_000;
  status = "REVOKED";
  await assert.rejects(() => context.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }),
    (error: unknown) => error instanceof OwnerClarityUpscaleGenerationServiceError && error.code === "PRINCIPAL_NOT_LINKED");
  assert.equal(events.filter((event) => event === "post").length, 1);
  assert.equal(events.filter((event) => event === "result-get").length, getCountBefore, "revoked owner performs no recovery GET");
  await context.service.close();
});

test("wrong chat/history/object/model or plural result fails closed with no generic GET fallback", async () => {
  const badHistories = [
    { history: historySnapshot({ requestedChat: "other-chat" }), reason: "REQUESTED_CHAT_MISMATCH" },
    { history: historySnapshot({ messages: [historySnapshot().messages[0], historySnapshot().messages[1], historySnapshot().messages[1]] }), reason: "MESSAGE_CARDINALITY_INVALID" },
    { history: historySnapshot({ botObjects: [{ message_object_id: RESULT_OBJECT_ID, object_type: "image", model_type: "other-model" }] }), reason: "BOT_OBJECT_INVALID" },
    { history: historySnapshot({ ownerObjects: [{ message_object_id: "first", object_type: "image", model_type: null }, { message_object_id: "second", object_type: "image", model_type: null }] }), reason: "OWNER_ECHO_OBJECT_INVALID" }
  ];
  for (const { history, reason } of badHistories) {
    const events: string[] = [];
    const client = fakeClient({ events, history: async () => history });
    const context = setup({ client, events, pollDelayMs: 0, maxPollAttempts: 1 });
    const imageHandle = await upload(context);
    let diagnostic: unknown;
    await assert.rejects(() => context.service.generate({ attemptId: ATTEMPT, image_handle: imageHandle,
      parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } }),
    (error: unknown) => {
      if (!(error instanceof OwnerClarityUpscaleGenerationServiceError) || error.code !== "OUTCOME_UNKNOWN") return false;
      diagnostic = error.diagnostic;
      return true;
    });
    assert.equal((diagnostic as { history_binding?: unknown } | undefined)?.history_binding, "INVALID");
    assert.equal((diagnostic as { history_binding_reason?: unknown } | undefined)?.history_binding_reason, reason);
    assert.equal((diagnostic as { history_get_count?: unknown } | undefined)?.history_get_count, 1);
    assert.equal(events.filter((entry) => entry === "post").length, 1);
    assert.equal(events.filter((entry) => entry === "result-get").length, 0);
    await context.service.close();
    await context.uploadService.close();
  }
  const events: string[] = [];
  const client = fakeClient({ events, result: async () => resultEnvelope({
    message_object_id: "different-object", artifact: { url: OUTPUT_URL, mime_type: "image/png", mime_source: "URL_EXTENSION" }
  }) });
  const context = setup({ client, events, pollDelayMs: 0, maxPollAttempts: 1 });
  const imageHandle = await upload(context);
  await assert.rejects(() => context.service.generate({ attemptId: ATTEMPT, image_handle: imageHandle,
    parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } }),
  (error: unknown) => error instanceof OwnerClarityUpscaleGenerationServiceError && error.code === "OUTCOME_UNKNOWN");
  assert.equal(events.filter((entry) => entry === "post").length, 1);
  await context.service.close();
  await context.uploadService.close();
});

test("Clarity history diagnostic identifies a requested-chat mismatch without changing recovery behavior", async () => {
  const events: string[] = [];
  const context = setup({ client: fakeClient({ events, history: async () => historySnapshot({ requestedChat: "other-chat" }) }),
    events, pollDelayMs: 0, maxPollAttempts: 1 });
  const imageHandle = await upload(context);
  let diagnostic: unknown;
  await assert.rejects(() => context.service.generate({ attemptId: ATTEMPT, image_handle: imageHandle,
    parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } }),
  (error: unknown) => {
    if (!(error instanceof OwnerClarityUpscaleGenerationServiceError) || error.code !== "OUTCOME_UNKNOWN") return false;
    diagnostic = error.diagnostic;
    return true;
  });
  assert.equal((diagnostic as { history_binding_reason?: unknown }).history_binding_reason, "REQUESTED_CHAT_MISMATCH");
  assert.equal(events.filter((event) => event === "post").length, 1);
  assert.equal(events.filter((event) => event === "result-get").length, 0);
  await context.service.close();
  await context.uploadService.close();
});

test("Clarity history diagnostic maps each reachable closed binding guard to its literal reason", async () => {
  const valid = historySnapshot() as unknown as Record<string, unknown>;
  const [ownerValue, botValue] = valid.messages as readonly Record<string, unknown>[];
  const owner = ownerValue!;
  const bot = botValue!;
  const makeHistory = (rows: readonly Record<string, unknown>[], patch: Record<string, unknown> = {}) => ({
    ...valid, ...patch, total_count: rows.length, total_pages: 1, messages: rows
  } as unknown as ChatMessageHistorySnapshot);
  const cases: ReadonlyArray<{ readonly reason: string; readonly history: ChatMessageHistorySnapshot }> = [
    { reason: "SNAPSHOT_PARSE_FAILED", history: { ...valid, private_field: "must-not-escape" } as unknown as ChatMessageHistorySnapshot },
    { reason: "MESSAGE_LIST_SHAPE_OR_LIMIT_INVALID", history: makeHistory(
      Array.from({ length: 11 }, (_, index) => index === 0 ? owner : { ...bot, message_id: `candidate-${index}` })) },
    { reason: "ROW_OBJECTS_SHAPE_OR_LIMIT_INVALID", history: historySnapshot({ ownerObjects: Array.from({ length: 65 }, (_, index) => ({
      message_object_id: `owner-object-${index}`, object_type: "text", model_type: null
    })) }) },
    { reason: "PAGE_INCOMPLETE", history: { ...valid, page: 2 } as unknown as ChatMessageHistorySnapshot },
    { reason: "PROVIDER_CHAT_ID_INVALID", history: { ...valid, provider_chat_id: "not-numeric" } as unknown as ChatMessageHistorySnapshot },
    { reason: "TOTAL_COUNT_MISMATCH", history: { ...valid, total_count: 99 } as unknown as ChatMessageHistorySnapshot },
    { reason: "TOTAL_PAGES_MISMATCH", history: { ...valid, total_pages: 2 } as unknown as ChatMessageHistorySnapshot },
    { reason: "MESSAGE_ID_INVALID", history: makeHistory([{ ...owner, message_id: "invalid identifier" }, bot]) },
    { reason: "PROVIDER_CHAT_MISMATCH", history: makeHistory([owner, { ...bot, provider_chat_id: "91373" }]) },
    { reason: "AUTHOR_ROLE_INVALID", history: makeHistory([{ ...owner, author_role: "unknown" }, bot]) },
    { reason: "OWNER_ECHO_MISSING", history: makeHistory([{ ...owner, message_id: "another-owner-message" }, bot]) },
    { reason: "OWNER_ECHO_AMBIGUOUS", history: makeHistory([owner, bot, owner]) },
    { reason: "OWNER_ECHO_AUTHOR_MISMATCH", history: makeHistory([{ ...owner, author_role: "other" }, bot]) },
    { reason: "OWNER_ECHO_OBJECT_INVALID", history: makeHistory([
      { ...owner, objects: [{ message_object_id: "source-object-1", object_type: "video", model_type: null }] }, bot
    ]) },
    { reason: "BOT_CANDIDATE_CARDINALITY_INVALID", history: makeHistory([owner, { ...bot, author_role: "other" }]) },
    { reason: "BOT_OBJECT_INVALID", history: makeHistory([owner, { ...bot,
      objects: [{ message_object_id: RESULT_OBJECT_ID, object_type: "image", model_type: "another-model" }] }]) }
  ];
  for (const { history, reason } of cases) {
    const events: string[] = [];
    const context = setup({ client: fakeClient({ events, history: async () => history }), events, pollDelayMs: 0, maxPollAttempts: 1 });
    const imageHandle = await upload(context);
    let diagnostic: OwnerClarityUpscaleGenerationServiceError["diagnostic"];
    await assert.rejects(() => context.service.generate({ attemptId: ATTEMPT, image_handle: imageHandle,
      parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } }),
    (error: unknown) => {
      if (!(error instanceof OwnerClarityUpscaleGenerationServiceError) || error.code !== "OUTCOME_UNKNOWN") return false;
      diagnostic = error.diagnostic;
      return true;
    });
    assert.equal(diagnostic?.history_binding, "INVALID", reason);
    assert.equal(diagnostic?.history_binding_reason, reason);
    assert.equal(JSON.stringify(diagnostic).includes("must-not-escape"), false);
    assert.equal(JSON.stringify(diagnostic).includes(OWNER_ECHO_ID), false);
    assert.equal(events.filter((event) => event === "post").length, 1, reason);
    assert.equal(events.filter((event) => event === "result-get").length, 0, reason);
    await context.service.close();
    await context.uploadService.close();
  }
});

test("foreign attempt cannot reuse a private image handle or reach preflight/chat/POST", async () => {
  const context = setup({ pollDelayMs: 0 });
  const imageHandle = await upload(context);
  const foreignAttempt = "link_foreign_clarity_generation_123456";
  await assert.rejects(() => context.service.generate({ attemptId: foreignAttempt, image_handle: imageHandle,
    parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } }),
  (error: unknown) => error instanceof OwnerClarityUpscaleGenerationServiceError && error.code === "IMAGE_HANDLE_UNAVAILABLE");
  assert.equal(context.calls.preflight, 0);
  assert.equal(context.calls.post, 0);
  assert.equal(context.events.includes("create-chat"), false);
  await context.service.close();
  await context.uploadService.close();
});

test("unsafe artifact URL and unsupported result cardinality remain unknown without generic GET fallback", async () => {
  const cases = [
    { status: "UNVERIFIED", chat_uuid: CHAT_UUID, message_id: BOT_MESSAGE_ID, model_type: "clarity", reason: "RESULT_URL_UNSAFE", objects: [] },
    { status: "UNVERIFIED", chat_uuid: CHAT_UUID, message_id: BOT_MESSAGE_ID, model_type: "clarity", reason: "RESULT_COUNT_OUT_OF_RANGE", objects: [] },
    resultEnvelope({ artifact: { url: "https://evil.invalid/result.png", mime_type: "image/png", mime_source: "URL_EXTENSION" } })
  ];
  for (const envelope of cases) {
    const events: string[] = [];
    const client = fakeClient({ events, result: async () => envelope as InternalClarityUpscaleResult });
    const context = setup({ client, events, pollDelayMs: 0, maxPollAttempts: 1 });
    const imageHandle = await upload(context);
    await assert.rejects(() => context.service.generate({ attemptId: ATTEMPT, image_handle: imageHandle,
      parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } }),
    (error: unknown) => error instanceof OwnerClarityUpscaleGenerationServiceError && error.code === "OUTCOME_UNKNOWN");
    assert.equal(events.filter((entry) => entry === "post").length, 1);
    assert.equal(events.some((entry) => entry === "generic-get"), false);
    await context.service.close();
    await context.uploadService.close();
  }
});

test("concurrent calls for one upload handle allow at most one preflight-to-POST path", async () => {
  let releasePreflight!: () => void;
  let signalPreflight!: () => void;
  const entered = new Promise<void>((resolve) => { signalPreflight = resolve; });
  const gate = new Promise<void>((resolve) => { releasePreflight = resolve; });
  const events: string[] = [];
  const context = setup({ events, pollDelayMs: 0, preflight: async () => { signalPreflight(); await gate; return preflightSnapshot(); } });
  const imageHandle = await upload(context);
  const request = { attemptId: ATTEMPT, image_handle: imageHandle,
    parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } };
  const first = context.service.generate(request);
  try {
    await waitForBarrier(entered, "Clarity first preflight entry");
    await assert.rejects(() => context.service.generate(request),
      (error: unknown) => error instanceof OwnerClarityUpscaleGenerationServiceError && error.code === "IMAGE_HANDLE_ALREADY_USED");
    releasePreflight();
    const result = await first;
    assert.equal(result.status, "result_observed");
    assert.equal(events.filter((entry) => entry === "post").length, 1);
  } finally {
    releasePreflight();
    await context.service.close();
    await context.uploadService.close();
  }
});

test("close aborts and drains an in-flight preflight, clears recovery and closes the owned upload service", async () => {
  let signalPreflight!: () => void;
  const entered = new Promise<void>((resolve) => { signalPreflight = resolve; });
  const events: string[] = [];
  const context = setup({ events, preflight: async (_attemptId, _principal, signal) => {
    signalPreflight();
    await new Promise<never>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  } });
  const imageHandle = await upload(context);
  const generating = context.service.generate({ attemptId: ATTEMPT, image_handle: imageHandle,
    parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } });
  try {
    await waitForBarrier(entered, "Clarity closing preflight entry");
    await context.service.close();
    await assert.rejects(() => generating);
    assert.equal(events.includes("create-chat"), false);
    assert.equal(events.includes("post"), false);
    await assert.rejects(() => context.uploadService.upload({
      attemptId: ATTEMPT, content_base64: PNG, filename: "again.png", mime_type: "image/png"
    }), (error: unknown) => error instanceof Error && "code" in error && error.code === "SERVICE_CLOSED");
  } finally {
    await context.service.close();
    await context.uploadService.close();
  }
});

test("recovery lists expose only opaque scoped handles and invalidate/close clears local state", async () => {
  const events: string[] = [];
  const client = fakeClient({ events, post: async () => { throw new Error("unknown post"); } });
  const context = setup({ client, events, pollDelayMs: 0 });
  const imageHandle = await upload(context);
  await assert.rejects(() => context.service.generate({ attemptId: ATTEMPT, image_handle: imageHandle,
    prompt: "private prompt", parameters: { professional_mode: false, scale_factor: 2, strength: 0.5, cfg: 4, denoise: 0.3 } }));
  const recoveries = await context.service.listRecoveries({ attemptId: ATTEMPT, limit: 5 });
  assert.equal(recoveries.length, 1);
  const serialized = JSON.stringify(recoveries);
  for (const privateValue of [INPUT_URL, OUTPUT_URL, "private prompt", "private-file-id"]) assert.equal(serialized.includes(privateValue), false);
  await context.service.invalidateAttempt(ATTEMPT);
  assert.deepEqual(await context.service.listRecoveries({ attemptId: ATTEMPT, limit: 5 }), []);
  await context.service.close();
  await context.uploadService.close();
  await assert.rejects(() => context.service.listRecoveries({ attemptId: ATTEMPT, limit: 5 }),
    (error: unknown) => error instanceof OwnerClarityUpscaleGenerationServiceError && error.code === "SERVICE_CLOSED");
});
