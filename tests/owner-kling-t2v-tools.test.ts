import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE } from "../src/auth/types.js";
import type { AuthBinding, AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxSubscription } from "../src/adapter/syntx/account-decoder.js";
import type { ModelAccessResult } from "../src/application/model-access.js";
import { OwnerKlingT2vGenerationService } from "../src/application/owner-reviewed-no-reference-t2v-service.js";
import { createOwnerKlingT2vProfile, OWNER_KLING_T2V_CONTRACT_VARIANT_IDS } from "../src/application/owner-kling-t2v-profile.js";
import {
  SYNTX_OWNER_KLING_T2V_TOOL_NAMES,
  SYNTX_OWNER_GET_KLING_T2V_SOURCE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_KLING_T2V_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_KLING_T2V_TOOL_NAME,
  SYNTX_OWNER_LIST_KLING_T2V_RECOVERIES_TOOL_NAME,
  registerSyntxOwnerKlingT2vTools
} from "../src/mcp/owner-kling-t2v-tools.js";

const BASE_ATTEMPT = "link_kling_tools_base_0000001";
const O1_ATTEMPT = "link_kling_tools_o1_00000001";
const AUTH_BINDING: AuthBinding = Object.freeze({ tenant_id: "kling-tools-tenant", subject: "kling-tools-owner" });

interface HttpRequestRecord { readonly url: URL; readonly method: string; readonly body: unknown }

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

async function setupTools() {
  let now = Date.now();
  const store = new InMemoryAuthLinkStore(() => now);
  const attempts = [BASE_ATTEMPT, O1_ATTEMPT];
  let attemptIndex = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-kling-tools", approval_url: "https://syntx.ai/auth" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-kling-tools-credential" });
      return { state: "LINKED" };
    }
  };
  const linkService = new PerUserLinkService(provider, store, {
    now: () => now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => attempts[attemptIndex++]!
  });
  for (const attemptId of attempts) {
    await linkService.createAttempt(AUTH_BINDING);
    await linkService.issueHandoff(AUTH_BINDING, attemptId);
    assert.equal((await linkService.checkAttempt(AUTH_BINDING, attemptId)).linked, true);
  }

  const requests: HttpRequestRecord[] = [];
  const ready = new Map<string, boolean>();
  const modelsByChat = new Map<string, string>();
  let readyOnCreate = false;
  let chatCount = 0;
  let videoPosts = 0;
  const sourceProfile = createOwnerKlingT2vProfile("kling_text2video", resolve(process.cwd(), "catalog"));
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body === undefined ? null : JSON.parse(String(init.body)) as unknown;
    requests.push({ url, method, body });
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatCount += 1;
      const chatId = `kling-tools-chat-${chatCount}`;
      const settings = (body as { settings?: { model_type?: string } } | null)?.settings;
      modelsByChat.set(chatId, settings?.model_type ?? "kling_text2video");
      if (readyOnCreate) ready.set(chatId, true);
      return response({ uuid: chatId });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      videoPosts += 1;
      const videoRequest = body as { chat_id?: string; settings?: { model_type?: string } } | null;
      if (videoRequest?.chat_id && videoRequest.settings?.model_type) modelsByChat.set(videoRequest.chat_id, videoRequest.settings.model_type);
      return response({ id: `kling-tools-echo-${videoPosts}` });
    }
    const inProgress = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/inprogress$/u);
    if (inProgress && method === "GET") {
      const chatId = inProgress[1]!;
      const modelId = modelsByChat.get(chatId) ?? "kling_text2video";
      return response(ready.get(chatId) ? [{ message_id: `kling-tools-bot-${chatId}`, object_type: "video", model_type: modelId }] : []);
    }
    const history = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/messages$/u);
    if (history && method === "GET") {
      const chatId = history[1]!;
      const modelId = modelsByChat.get(chatId) ?? "kling_text2video";
      const rows = [
        { id: `kling-tools-echo-${chatId}`, chat_id: 701, author_id: 12345, message_object: [] },
        ...(ready.get(chatId) ? [{ id: `kling-tools-bot-${chatId}`, chat_id: 701, author_id: -1, message_object: [{
          id: `kling-tools-video-${chatId}`, message_id: `kling-tools-bot-${chatId}`, object_type: "video", model_type: modelId
        }] }] : [])
      ];
      return response({ messages: rows, pagination: { page: 1, page_size: 10, total_count: rows.length,
        total_pages: 1, has_next: false, has_previous: false } });
    }
    const message = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u);
    if (message && method === "GET") {
      const chatId = message[1]!;
      const modelId = modelsByChat.get(chatId) ?? "kling_text2video";
      return response({ id: message[2], chat_id: 701, author_id: -1, message_object: ready.get(chatId) ? [{
        id: `kling-tools-video-${chatId}`, message_id: message[2], object_type: "video", model_type: modelId,
        completed: true, object_url: `https://r2.syntx.ai/kling-tools/${chatId}.mp4`
      }] : [] });
    }
    throw new Error(`Unexpected synthetic route ${method} ${url.pathname}`);
  };
  const service = new OwnerKlingT2vGenerationService({
    binding: AUTH_BINDING,
    linkService,
    catalogDirectory: resolve(process.cwd(), "catalog"),
    resolveModelAccess: async (_attemptId, modelId, parameters): Promise<ModelAccessResult> => ({
      catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
      catalog_version: `${sourceProfile.catalog.fetched_at}.${sourceProfile.catalog.source_hashes.models.slice(7, 19)}`,
      model_id: modelId, ai_name: "kling", model_type: modelId, account_read_live: true,
      parameter_keys: Object.keys(parameters).sort(), parameters_redacted: true, access: true, cost: null,
      discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false, observed_at: new Date(now).toISOString()
    }),
    resolveSubscription: async (): Promise<SyntxSubscription> => ({ active: true, plan_type: "PAID", end_date: null, end_date_kind: null }),
    resolveChatClient: () => new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
      return operation("synthetic-kling-tools-credential");
    } }, fetchImpl, requestTimeoutMs: 1_000 }),
    now: () => now,
    wait: async () => undefined,
    videoTimeoutMs: 10
  });
  const server = new McpServer({ name: "kling-tools-test", version: "1.0.0" });
  registerSyntxOwnerKlingT2vTools(server, { service: {
    getParametersSource: (modelId) => service.getParametersSource(modelId),
    generate(input, signal) { return service.generate(input, signal); },
    reconcile(input, signal) { return service.reconcile(input, signal); },
    listRecoveries(attemptId, limit) { return service.listRecoveries(attemptId, limit); }
  } });
  const client = new Client({ name: "kling-tools-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client, service, server, requests,
    ready(chatId: string) { ready.set(chatId, true); },
    setReadyOnCreate(value: boolean) { readyOnCreate = value; },
    counts: () => ({ chatCount, videoPosts }),
    close: async () => { await client.close(); await server.close(); await service.close(); }
  };
}

test("Kling source tool returns both exact model identities and four family tools", async () => {
  const state = await setupTools();
  try {
    const listed = await state.client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [...SYNTX_OWNER_KLING_T2V_TOOL_NAMES].sort());
    for (const model_id of ["kling_text2video", "kling_o1_text2video"] as const) {
      const source = await state.client.callTool({ name: SYNTX_OWNER_GET_KLING_T2V_SOURCE_TOOL_NAME, arguments: { model_id } });
      assert.equal(source.isError, undefined);
      const output = source.structuredContent as { identity: { model_id: string; model_type: string }; controls: { version: { values: string[] }; native_audio: { values: boolean[] } } };
      assert.equal(output.identity.model_id, model_id);
      assert.equal(output.identity.model_type, model_id);
      if (model_id === "kling_text2video") {
        assert.equal(output.controls.version.values.length, 7);
        assert.deepEqual(output.controls.native_audio.values, [false, true]);
      } else {
        assert.deepEqual(output.controls.version.values, []);
        assert.deepEqual(output.controls.native_audio.values, []);
      }
    }
    assert.deepEqual(state.counts(), { chatCount: 0, videoPosts: 0 });
  } finally { await state.close(); }
});

test("Kling SDK generate sends exact base and O1 no-reference settings from discriminated inputs", async () => {
  const state = await setupTools();
  try {
    state.setReadyOnCreate(true);
    const base = await state.client.callTool({ name: SYNTX_OWNER_GENERATE_KLING_T2V_TOOL_NAME, arguments: {
      link_attempt_id: BASE_ATTEMPT, model_id: "kling_text2video", prompt: "A quiet shoreline at sunrise.",
      version: "1.5", mode: "standart", aspect_ratio: "16:9", video_duration: 5, native_audio: false
    } });
    const o1 = await state.client.callTool({ name: SYNTX_OWNER_GENERATE_KLING_T2V_TOOL_NAME, arguments: {
      link_attempt_id: O1_ATTEMPT, model_id: "kling_o1_text2video", prompt: "A silver kite over a field.",
      mode: "hd", aspect_ratio: "9:16", video_duration: 10
    } });
    assert.equal(base.isError, undefined, JSON.stringify(base));
    assert.equal(o1.isError, undefined, JSON.stringify(o1));
    const posts = state.requests.filter((request) => request.method === "POST" && request.url.pathname === "/api/v1/video/generate");
    assert.deepEqual(posts.map((request) => request.body), [
      { chat_id: "kling-tools-chat-1", prompt: "A quiet shoreline at sunrise.", settings: {
        model_type: "kling_text2video", version: "1.5", mode: "standart", aspect_ratio: "16:9", video_duration: 5, native_audio: false, file_urls: []
      } },
      { chat_id: "kling-tools-chat-2", prompt: "A silver kite over a field.", settings: {
        model_type: "kling_o1_text2video", mode: "hd", aspect_ratio: "9:16", video_duration: 10, file_urls: []
      } }
    ]);
    assert.equal((base.structuredContent as { variant_id: string }).variant_id, OWNER_KLING_T2V_CONTRACT_VARIANT_IDS.kling_text2video);
    assert.equal((o1.structuredContent as { variant_id: string }).variant_id, OWNER_KLING_T2V_CONTRACT_VARIANT_IDS.kling_o1_text2video);
  } finally { await state.close(); }
});

test("Kling MCP rejects wrong model-control combinations and unknown recovery errors without metadata leakage", async () => {
  const state = await setupTools();
  try {
    const invalidInputs = [
      { link_attempt_id: BASE_ATTEMPT, model_id: "kling_unknown", prompt: "x", mode: "hd", aspect_ratio: "16:9", video_duration: 5 },
      { link_attempt_id: O1_ATTEMPT, model_id: "kling_o1_text2video", prompt: "x", mode: "standart", aspect_ratio: "16:9", video_duration: 5 },
      { link_attempt_id: O1_ATTEMPT, model_id: "kling_o1_text2video", prompt: "x", version: "3.0", mode: "hd", aspect_ratio: "16:9", video_duration: 5 },
      { link_attempt_id: O1_ATTEMPT, model_id: "kling_o1_text2video", prompt: "x", native_audio: false, mode: "hd", aspect_ratio: "16:9", video_duration: 5 },
      { link_attempt_id: BASE_ATTEMPT, model_id: "kling_text2video", prompt: "x", version: "1.5", mode: "standart", aspect_ratio: "16:9", video_duration: 5, native_audio: false, file_urls: [] },
      { link_attempt_id: BASE_ATTEMPT, model_id: "kling_text2video", prompt: "x", version: "1.5", mode: "standart", aspect_ratio: "16:9", video_duration: 5, native_audio: false, custom_settings_payload: { secret: "no" } },
      { link_attempt_id: BASE_ATTEMPT, model_id: "kling_text2video", prompt: "x", version: "1.5", mode: "standart", aspect_ratio: "16:9", video_duration: 5, native_audio: true }
    ];
    for (const arguments_ of invalidInputs) {
      const invalid = await state.client.callTool({ name: SYNTX_OWNER_GENERATE_KLING_T2V_TOOL_NAME, arguments: arguments_ });
      assert.equal(invalid.isError, true);
    }
    assert.deepEqual(state.counts(), { chatCount: 0, videoPosts: 0 });

    const noReplay = await state.client.callTool({ name: SYNTX_OWNER_GENERATE_KLING_T2V_TOOL_NAME, arguments: {
      link_attempt_id: O1_ATTEMPT, model_id: "kling_o1_text2video", prompt: "A kite in the clouds.",
      mode: "hd", aspect_ratio: "9:16", video_duration: 10
    } });
    assert.equal(noReplay.isError, true);
    const errorText = (noReplay as CallToolResult).content.filter((item) => item.type === "text").map((item) => item.text).join(" ");
    assert.match(errorText, /OUTCOME_UNKNOWN/u);
    assert.match(errorText, /do not retry/u);
    assert.doesNotMatch(errorText, /synthetic-kling-tools-credential|syntx\.ai\/auth|chat_id|owner|tenant|subject/u);
    const recoveryId = (JSON.parse(errorText) as { error: { recovery_id: string } }).error.recovery_id;
    assert.match(recoveryId, /^recovery_[0-9a-f-]{36}$/u);
    const listed = await state.client.callTool({ name: SYNTX_OWNER_LIST_KLING_T2V_RECOVERIES_TOOL_NAME, arguments: { link_attempt_id: O1_ATTEMPT } });
    assert.equal(listed.isError, undefined);
    const recoveries = (listed.structuredContent as { recoveries: Array<{ model_id: string; variant_id: string; recovery_id: string }> }).recoveries;
    assert.deepEqual(recoveries.map(({ model_id, variant_id }) => ({ model_id, variant_id })), [{
      model_id: "kling_o1_text2video", variant_id: OWNER_KLING_T2V_CONTRACT_VARIANT_IDS.kling_o1_text2video
    }]);
    const beforeReconcile = state.counts();
    state.ready("kling-tools-chat-1");
    const reconciled = await state.client.callTool({ name: SYNTX_OWNER_RECONCILE_KLING_T2V_TOOL_NAME, arguments: {
      link_attempt_id: O1_ATTEMPT, model_id: "kling_o1_text2video", recovery_id: recoveryId
    } });
    assert.equal(reconciled.isError, undefined);
    assert.equal(state.counts().videoPosts, beforeReconcile.videoPosts);
    assert.ok(state.requests.some((request) => request.method === "GET" && request.url.pathname.includes("kling-tools-chat-1")));
  } finally { await state.close(); }
});
