import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import * as NativeModule from "../src/adapter/syntx/chat-http-client.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { resolveOwnerReferencePrincipal } from "../src/auth/owner-reference-principal.js";
import { normalizeOwnerSunoGenerationParameters } from "../src/application/owner-suno-generation-parameters.js";
import { OwnerSunoGenerationRequestPreparer } from "../src/application/owner-suno-generation-request-preparer.js";
import { OwnerSunoGenerationOneShotPolicy } from "../src/application/owner-suno-generation-one-shot-policy.js";
import { normalizeOwnerSunoTrackOperationParameters } from "../src/application/owner-suno-track-operation-parameters.js";
import { OwnerSunoTrackOperationRequestPreparer } from "../src/application/owner-suno-track-operation-request-preparer.js";
import { OwnerSunoTrackOperationOneShotPolicy } from "../src/application/owner-suno-track-operation-one-shot-policy.js";
import { OwnerSunoTrackContextStore } from "../src/application/owner-suno-track-context.js";

const ATTEMPT = "link_suno_track_operation_1302_owner_0123456789";
const BINDING = Object.freeze({ tenant_id: "suno-operation-1302-tenant", subject: "suno-operation-1302-owner" });
const CREDENTIAL = "synthetic-suno-operation-credential";
const BASE_PROMPT = "An original instrumental track for native operation tests";
const stores = new Set<InMemoryAuthLinkStore>();

interface NativeApi {
  createOwnerSunoGenerationChat(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  startSunoWithOwnedCandidate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  listOwnedSunoGenerationCandidates(chat: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  getOwnedSunoGenerationResult(context: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  createOwnerSunoTrackOperationChat(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  startSunoTrackOperationWithOwnedCandidate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  listOwnedSunoTrackOperationCandidates(chat: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  getOwnedSunoTrackOperationResult(context: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
}

function api(client: SyntxChatHttpClient): NativeApi { return client as unknown as NativeApi; }
function nativeGuard(name: string): (...args: unknown[]) => boolean {
  return (NativeModule as unknown as Record<string, unknown>)[name] as (...args: unknown[]) => boolean;
}
function code(error: unknown, expected: string): boolean {
  return error instanceof Error && "code" in error && error.code === expected;
}

async function fixture(options: {
  readonly loseOperationAck?: boolean;
  readonly operationHistory?: "error-only" | "mixed" | "irrelevant";
} = {}) {
  let now = Date.parse("2026-10-14T00:00:00.000Z");
  const events: Array<{ method: string; pathname: string; query: string; body: unknown }> = [];
  const chats = new Map<string, { prompt?: string; model: string; ack: string; mode?: string; isOperation: boolean }>();
  let chatCount = 0, operationPosts = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-suno-operation", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: CREDENTIAL });
      return { state: "LINKED" };
    }
  };
  const authStore = new InMemoryAuthLinkStore(() => now);
  stores.add(authStore);
  const linkService = new PerUserLinkService(provider, authStore, { now: () => now, defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: () => ATTEMPT });
  await linkService.createAttempt(BINDING);
  await linkService.issueHandoff(BINDING, ATTEMPT);
  assert.equal((await linkService.checkAttempt(BINDING, ATTEMPT)).status, "LINKED");
  const broker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return linkService.useCredential(BINDING, ATTEMPT, (credential) => operation(credential.value));
    }
  };
  const audio = (messageId: string, objectId: string, model: string, metadata = false) => ({
    id: objectId, message_id: messageId, object_type: "audio", object_url: `https://r2.syntx.ai/generated/${objectId}.mp3`,
    completed: true, model_type: model,
    ...(metadata ? { metadata: { payload: { clip_id: "owned-base-clip-1302", task_id: "owned-base-task-1302" } } } : {})
  });
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    events.push({ method, pathname: url.pathname, query: url.search, body });
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatCount += 1;
      const uuid = `owner-suno-track-operation-chat-${chatCount}`;
      chats.set(uuid, { model: "V6", ack: `owner-suno-track-operation-ack-${chatCount}`, isOperation: false });
      return Response.json({ uuid });
    }
    if (url.pathname === "/api/v1/audio/generate" && method === "POST") {
      const chatUuid = String(body?.chat_uuid ?? "");
      const state = chats.get(chatUuid);
      if (!state) throw new Error("Synthetic fixture rejected unknown chat.");
      const prompt = String(body?.prompt ?? "");
      const settings = body?.settings as Record<string, unknown>;
      state.prompt = prompt;
      state.model = String(settings?.model_type ?? "");
      state.mode = typeof settings?.mode === "string" ? settings.mode : "generate";
      state.isOperation = state.mode === "cover" || state.mode === "extend";
      if (state.isOperation) {
        operationPosts += 1;
        if (options.loseOperationAck) throw new Error("Synthetic lost POST acknowledgement.");
      }
      return Response.json({ id: state.ack });
    }
    if (url.pathname.endsWith("/messages") && method === "GET") {
      const chatUuid = url.pathname.split("/")[4]!;
      const state = chats.get(chatUuid);
      if (!state?.prompt) throw new Error("Synthetic fixture has no sent prompt.");
      const ownerRow = { id: state.ack, chat_id: 91302, author_id: 42,
        message_object: [{ id: `${state.ack}-text`, message_id: state.ack, object_type: "text",
          object_text: state.prompt, model_type: state.model }] };
      const botId = `${state.ack}-bot`;
      const errorObject = (model: string, index: number) => ({ id: `${botId}-error-${index}`,
        message_id: botId, object_type: "error", model_type: model,
        object_text: "Synthetic upstream error body is intentionally inert",
        object_url: "https://example.invalid/synthetic-error", completed: false });
      let botObjects: unknown[] = [audio(botId, `${state.ack}-audio`, state.model)];
      if (state.isOperation && options.operationHistory === "error-only") {
        botObjects = [errorObject(state.model, 1), errorObject(state.model, 2)];
      } else if (state.isOperation && options.operationHistory === "mixed") {
        botObjects = [audio(botId, `${state.ack}-audio`, state.model), errorObject(state.model, 1)];
      } else if (state.isOperation && options.operationHistory === "irrelevant") {
        botObjects = [errorObject("V6_wild", 1)];
      }
      const botRow = { id: botId, chat_id: 91302, author_id: -1, message_object: botObjects };
      const rows = [ownerRow, botRow];
      if (state.isOperation && options.operationHistory === "irrelevant") {
        const ownerErrorId = `${state.ack}-owner-error`;
        rows.push({ id: ownerErrorId, chat_id: 91302, author_id: 42,
          message_object: [{ ...errorObject(state.model, 3), message_id: ownerErrorId }] });
      }
      return Response.json({ messages: rows, pagination: {
        page: 1, page_size: 10, total_count: rows.length, total_pages: 1, has_next: false, has_previous: false
      } });
    }
    const result = /^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (result && method === "GET") {
      const state = chats.get(result[1]!);
      if (!state) throw new Error("Synthetic fixture rejected unknown result chat.");
      return Response.json({ id: result[2], chat_id: 91302, author_id: -1,
        message_object: [audio(result[2]!, `${state.ack}-audio`, state.model, !state.isOperation)],
        created_at: new Date(now).toISOString(), is_favorite: false });
    }
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  };
  const basePreparer = new OwnerSunoGenerationRequestPreparer({ binding: BINDING, linkService, now: () => now });
  const basePolicy = new OwnerSunoGenerationOneShotPolicy({ preparer: basePreparer, now: () => now });
  const baseCandidate = await basePreparer.prepare({ attemptId: ATTEMPT, normalized: normalizeOwnerSunoGenerationParameters({
    model_id: "V6", mode: "generate", prompt: BASE_PROMPT, is_custom_mode: false, is_instrumental: true,
    negative_tags: "", styles: "", title: "Base source track"
  }) });
  const principal = await resolveOwnerReferencePrincipal({ binding: BINDING, attemptId: ATTEMPT, linkService });
  const basePermit = basePolicy.createPermit({ candidate: baseCandidate, attemptId: ATTEMPT, principal });
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const otherClient = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const native = api(client);
  const baseChat = await native.createOwnerSunoGenerationChat({ candidate: baseCandidate, permit: basePermit,
    preparer: basePreparer, oneShotPolicy: basePolicy, principal, attemptId: ATTEMPT });
  await native.startSunoWithOwnedCandidate({ chat: baseChat, candidate: baseCandidate, permit: basePermit,
    preparer: basePreparer, oneShotPolicy: basePolicy, principal, attemptId: ATTEMPT });
  const baseHistory = await native.listOwnedSunoGenerationCandidates(baseChat);
  const baseResultContext = (baseHistory.contexts as unknown[])[0];
  assert.ok(nativeGuard("isOwnerSunoGenerationResultMessageContext")(baseResultContext, client));
  const baseResult = await native.getOwnedSunoGenerationResult(baseResultContext);
  assert.equal(baseResult.message_binding, "BOUND");
  const trackStore = new OwnerSunoTrackContextStore({ now: () => now });
  const handle = trackStore.issue({ binding: BINDING, attemptId: ATTEMPT, principal, client,
    resultContext: baseResultContext, messageObjectId: `${chats.get((baseChat.chat_uuid as string))!.ack}-audio` });
  const operationPreparer = new OwnerSunoTrackOperationRequestPreparer({ binding: BINDING, linkService,
    trackContextStore: trackStore, now: () => now });
  const operationPolicy = new OwnerSunoTrackOperationOneShotPolicy({ preparer: operationPreparer, now: () => now });
  return { client, otherClient, native, basePreparer, basePolicy, trackStore, operationPreparer, operationPolicy,
    principal, handle, events, chats, get operationPosts() { return operationPosts; }, get now() { return now; },
    async operation(mode: "cover" | "extend", attempt = ATTEMPT) {
      const normalized = normalizeOwnerSunoTrackOperationParameters({ model_id: "V6", mode, track_handle: handle,
        prompt: BASE_PROMPT, is_custom_mode: false, is_instrumental: false, negative_tags: "", styles: "",
        title: `Native ${mode}`, ...(mode === "extend" ? { continue_at: 17.3 } : {}) });
      const candidate = await operationPreparer.prepare({ attemptId: attempt, normalized });
      const permit = operationPolicy.createPermit({ candidate, attemptId: attempt, principal });
      return { candidate, permit, input: { candidate, permit, preparer: operationPreparer, oneShotPolicy: operationPolicy,
        principal, attemptId: attempt } };
    },
    async close() { operationPolicy.close(); operationPreparer.close(); trackStore.close(); basePolicy.close(); basePreparer.close(); }
  };
}

afterEach(() => { for (const store of stores) store.close(); stores.clear(); });

test("native track-operation path exposes isolated methods and sends source-bound cover and extend bodies", async () => {
  for (const mode of ["cover", "extend"] as const) {
    const f = await fixture();
    try {
      for (const method of ["createOwnerSunoTrackOperationChat", "startSunoTrackOperationWithOwnedCandidate",
        "listOwnedSunoTrackOperationCandidates", "getOwnedSunoTrackOperationResult"]) {
        assert.equal(typeof (SyntxChatHttpClient.prototype as unknown as Record<string, unknown>)[method], "function");
      }
      const operation = await f.operation(mode);
      const chat = await f.native.createOwnerSunoTrackOperationChat(operation.input);
      assert.equal(chat.mode, mode);
      assert.equal(chat.model_id, "V6");
      assert.equal(chat.dispatch_allowed, false);
      assert.equal(chat.backend_acceptance, "UNPROVEN");
      assert.equal(nativeGuard("isOwnerSunoTrackOperationChatContext")(chat, f.client), true);
      assert.equal(nativeGuard("isOwnerSunoTrackOperationChatContext")(chat, f.otherClient), false);
      const sent = await f.native.startSunoTrackOperationWithOwnedCandidate({ ...operation.input, chat });
      assert.deepEqual(sent, { chat_uuid: chat.chat_uuid, message_id: `owner-suno-track-operation-ack-2` });
      const post = f.events.filter((event) => event.pathname === "/api/v1/audio/generate").at(-1)!;
      assert.equal(post.method, "POST");
      assert.equal(post.query, "?ai_name=suno");
      assert.deepEqual(post.body, { chat_uuid: chat.chat_uuid, prompt: BASE_PROMPT, settings: {
        model_type: "V6", mode, is_custom_mode: false, is_instrumental: false,
        negative_tags: "", styles: "", title: `Native ${mode}`,
        source_clip_id: "owned-base-clip-1302", source_task_id: "owned-base-task-1302",
        file_urls: [],
        ...(mode === "extend" ? { continue_at: 17.3 } : {})
      } });
      assert.equal(JSON.stringify(chat).includes("owned-base-clip-1302"), false);
      assert.equal(JSON.stringify(chat).includes(f.handle), false);
      const history = await f.native.listOwnedSunoTrackOperationCandidates(chat);
      const resultContext = (history.contexts as unknown[])[0];
      assert.equal(nativeGuard("isOwnerSunoTrackOperationResultMessageContext")(resultContext, f.client), true);
      assert.equal(nativeGuard("isOwnerSunoTrackOperationResultMessageContext")(resultContext, f.otherClient), false);
      const result = await f.native.getOwnedSunoTrackOperationResult(resultContext);
      assert.equal(result.message_binding, "BOUND");
      assert.equal(result.model_echo, "MATCHED");
      assert.equal(f.operationPosts, 1);
      assert.equal(f.events.filter(({ pathname, method }) => pathname === "/api/v1/audio/generate" && method === "POST").length, 2);
    } finally { await f.close(); }
  }
});

test("track-operation native contexts reject forged and cross-client capabilities without reads", async () => {
  const f = await fixture();
  try {
    const operation = await f.operation("cover");
    await assert.rejects(f.native.createOwnerSunoTrackOperationChat({ ...operation.input,
      candidate: { ...operation.candidate } }), (error: unknown) => code(error, "CANDIDATE_INVALID"));
    assert.equal(f.events.filter(({ pathname, method }) => pathname === "/api/v1/chats" && method === "POST").length, 1);
    const chat = await f.native.createOwnerSunoTrackOperationChat(operation.input);
    await f.native.startSunoTrackOperationWithOwnedCandidate({ ...operation.input, chat });
    const history = await f.native.listOwnedSunoTrackOperationCandidates(chat);
    const context = (history.contexts as unknown[])[0] as Record<string, unknown>;
    await assert.rejects(f.native.listOwnedSunoTrackOperationCandidates({ ...chat }),
      (error: unknown) => code(error, "CHAT_CONTEXT_INVALID"));
    await assert.rejects(f.native.getOwnedSunoTrackOperationResult({ ...context }),
      (error: unknown) => code(error, "RESULT_CONTEXT_INVALID"));
    const repeatedHistory = await f.native.listOwnedSunoTrackOperationCandidates(chat);
    assert.equal((repeatedHistory.contexts as unknown[])[0], context);
    await assert.rejects(api(f.otherClient).getOwnedSunoTrackOperationResult(context), (error: unknown) => code(error, "RESULT_CONTEXT_INVALID"));
  } finally { await f.close(); }
});

test("an unknown operation POST stays single-use and reconciles from exact owner history by GET", async () => {
  const f = await fixture({ loseOperationAck: true });
  try {
    const operation = await f.operation("extend");
    const chat = await f.native.createOwnerSunoTrackOperationChat(operation.input);
    await assert.rejects(f.native.startSunoTrackOperationWithOwnedCandidate({ ...operation.input, chat }),
      (error: unknown) => code(error, "OUTCOME_UNKNOWN"));
    await assert.rejects(f.native.startSunoTrackOperationWithOwnedCandidate({ ...operation.input, chat }),
      (error: unknown) => code(error, "CHAT_DISPATCH_ALREADY_STARTED"));
    const beforeHistory = f.events.length;
    const history = await f.native.listOwnedSunoTrackOperationCandidates(chat);
    assert.equal(history.owner_ack_status, "MATCHED");
    assert.equal(history.history_binding_status, "BOUND");
    assert.equal(history.history_page_status, "COMPLETE");
    assert.equal(history.backend_acceptance, "UNPROVEN");
    assert.equal((history.contexts as unknown[]).length, 1);
    assert.ok(f.events.slice(beforeHistory).every(({ method }) => method === "GET"));
    assert.equal(f.operationPosts, 1);
  } finally { await f.close(); }
});

test("a pre-aborted start does not consume the operation permit or issue a POST", async () => {
  const f = await fixture();
  try {
    const operation = await f.operation("cover");
    const chat = await f.native.createOwnerSunoTrackOperationChat(operation.input);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(f.native.startSunoTrackOperationWithOwnedCandidate({ ...operation.input, chat }, controller.signal),
      (error: unknown) => code(error, "REQUEST_ABORTED"));
    assert.equal(f.operationPosts, 0);
    await f.native.startSunoTrackOperationWithOwnedCandidate({ ...operation.input, chat });
    assert.equal(f.operationPosts, 1);
  } finally { await f.close(); }
});

test("track operation history reports only same-chat bot errors echoed for the requested model", async () => {
  const errorOnly = await fixture({ operationHistory: "error-only" });
  try {
    const operation = await errorOnly.operation("extend");
    const chat = await errorOnly.native.createOwnerSunoTrackOperationChat(operation.input);
    await errorOnly.native.startSunoTrackOperationWithOwnedCandidate({ ...operation.input, chat });
    const history = await errorOnly.native.listOwnedSunoTrackOperationCandidates(chat);
    assert.equal(history.owner_ack_status, "MATCHED");
    assert.deepEqual(history.gaps, ["BOT_ERROR_OBSERVED"]);
    assert.equal(history.history_binding_status, "BOUND");
    assert.equal(history.history_page_status, "COMPLETE");
    assert.equal(history.status, "INCOMPLETE");
    assert.deepEqual(history.contexts, []);
  } finally { await errorOnly.close(); }

  const mixed = await fixture({ operationHistory: "mixed" });
  try {
    const operation = await mixed.operation("extend");
    const chat = await mixed.native.createOwnerSunoTrackOperationChat(operation.input);
    await mixed.native.startSunoTrackOperationWithOwnedCandidate({ ...operation.input, chat });
    const history = await mixed.native.listOwnedSunoTrackOperationCandidates(chat);
    assert.equal(history.status, "COMPLETE");
    assert.equal(history.history_binding_status, "BOUND");
    assert.deepEqual(history.gaps, ["BOT_ERROR_OBSERVED"]);
    assert.equal((history.contexts as unknown[]).length, 1);
  } finally { await mixed.close(); }

  const irrelevant = await fixture({ operationHistory: "irrelevant" });
  try {
    const operation = await irrelevant.operation("extend");
    const chat = await irrelevant.native.createOwnerSunoTrackOperationChat(operation.input);
    await irrelevant.native.startSunoTrackOperationWithOwnedCandidate({ ...operation.input, chat });
    const history = await irrelevant.native.listOwnedSunoTrackOperationCandidates(chat);
    assert.equal(history.owner_ack_status, "MATCHED");
    assert.equal(history.status, "PENDING");
    assert.deepEqual(history.gaps, ["BOT_RESULT_NOT_OBSERVED"]);
    assert.deepEqual(history.contexts, []);
  } finally { await irrelevant.close(); }
});

test("Cover and Extend preserve the source-observed empty file_urls settings field", async () => {
  for (const mode of ["cover", "extend"] as const) {
    const f = await fixture();
    try {
      const operation = await f.operation(mode);
      const chat = await f.native.createOwnerSunoTrackOperationChat(operation.input);
      await f.native.startSunoTrackOperationWithOwnedCandidate({ ...operation.input, chat });
      const post = f.events.filter(({ pathname, method }) => pathname === "/api/v1/audio/generate" && method === "POST").at(-1)!;
      assert.deepEqual(post.body, { chat_uuid: chat.chat_uuid, prompt: BASE_PROMPT, settings: {
        model_type: "V6", mode, is_custom_mode: false, is_instrumental: false,
        negative_tags: "", styles: "", title: `Native ${mode}`,
        source_clip_id: "owned-base-clip-1302", source_task_id: "owned-base-task-1302",
        file_urls: [], ...(mode === "extend" ? { continue_at: 17.3 } : {})
      } });
    } finally { await f.close(); }
  }
});
