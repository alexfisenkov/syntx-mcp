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
import * as ownerServiceModule from "../src/application/owner-reviewed-no-reference-t2v-service.js";
import {
  OWNER_VEO_T2V_CONTRACT_VARIANT_IDS,
  createOwnerVeoT2vProfile,
  type OwnerVeoT2vModelId
} from "../src/application/owner-veo-t2v-profile.js";

const ATTEMPT = "link_veo_tools_attempt_00000001";
const AUTH_BINDING: AuthBinding = Object.freeze({ tenant_id: "veo-tools-tenant", subject: "veo-tools-owner" });
const MODEL_IDS: readonly OwnerVeoT2vModelId[] = ["veo3", "veo3fast", "veo3fast_r"];

interface HttpRequestRecord { readonly url: URL; readonly method: string; readonly body: unknown }
interface VeoGenerationService {
  getParametersSource(modelId: OwnerVeoT2vModelId): unknown;
  getReviewedContract(modelId: OwnerVeoT2vModelId): { variant_id: string };
  generate(input: Record<string, unknown>, signal?: AbortSignal): Promise<{ model_id: string; variant_id: string }>;
  reconcile(input: Record<string, unknown>, signal?: AbortSignal): Promise<{ model_id: string; variant_id: string }>;
  listRecoveries(attemptId: string, limit?: number): readonly { recovery_id: string; model_id: string; variant_id: string }[];
  invalidateAttempt(attemptId: string): Promise<void>;
  close(): Promise<void>;
}

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

async function setupTools() {
  let now = Date.now();
  const store = new InMemoryAuthLinkStore(() => now);
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-veo-tools", approval_url: "https://syntx.ai/auth" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-veo-tools-credential" });
      return { state: "LINKED" };
    }
  };
  const linkService = new PerUserLinkService(provider, store, {
    now: () => now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT
  });
  await linkService.createAttempt(AUTH_BINDING);
  await linkService.issueHandoff(AUTH_BINDING, ATTEMPT);
  assert.equal((await linkService.checkAttempt(AUTH_BINDING, ATTEMPT)).linked, true);

  const requests: HttpRequestRecord[] = [];
  const costs: Array<{ readonly modelId: string; readonly parameters: Readonly<Record<string, unknown>> }> = [];
  const ready = new Map<string, boolean>();
  const modelByChat = new Map<string, string>();
  let readyOnCreate = false;
  let chatCount = 0;
  let videoPosts = 0;
  const sourceProfile = createOwnerVeoT2vProfile("veo3", resolve(process.cwd(), "catalog"));
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body === undefined ? null : JSON.parse(String(init.body)) as unknown;
    requests.push({ url, method, body });
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatCount += 1;
      const chatId = `veo-tools-chat-${chatCount}`;
      const settings = (body as { settings?: { model_type?: string } } | null)?.settings;
      modelByChat.set(chatId, settings?.model_type ?? "veo3");
      if (readyOnCreate) ready.set(chatId, true);
      return response({ uuid: chatId });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      videoPosts += 1;
      const generation = body as { chat_id?: string; settings?: { model_type?: string } } | null;
      if (generation?.chat_id && generation.settings?.model_type) modelByChat.set(generation.chat_id, generation.settings.model_type);
      return response({ id: `veo-tools-echo-${videoPosts}` });
    }
    const inProgress = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/inprogress$/u);
    if (inProgress && method === "GET") {
      const chatId = inProgress[1]!;
      const modelId = modelByChat.get(chatId) ?? "veo3";
      return response(ready.get(chatId) ? [{ message_id: `veo-tools-bot-${chatId}`, object_type: "video", model_type: modelId }] : []);
    }
    const history = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/messages$/u);
    if (history && method === "GET") {
      const chatId = history[1]!;
      const modelId = modelByChat.get(chatId) ?? "veo3";
      const rows = [
        { id: `veo-tools-echo-${chatId}`, chat_id: 701, author_id: 12345, message_object: [] },
        ...(ready.get(chatId) ? [{ id: `veo-tools-bot-${chatId}`, chat_id: 701, author_id: -1, message_object: [{
          id: `veo-tools-video-${chatId}`, message_id: `veo-tools-bot-${chatId}`, object_type: "video", model_type: modelId
        }] }] : [])
      ];
      return response({ messages: rows, pagination: { page: 1, page_size: 10, total_count: rows.length,
        total_pages: 1, has_next: false, has_previous: false } });
    }
    const message = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u);
    if (message && method === "GET") {
      const chatId = message[1]!;
      const modelId = modelByChat.get(chatId) ?? "veo3";
      return response({ id: message[2], chat_id: 701, author_id: -1, message_object: ready.get(chatId) ? [{
        id: `veo-tools-video-${chatId}`, message_id: message[2], object_type: "video", model_type: modelId,
        completed: true, object_url: `https://r2.syntx.ai/veo-tools/${chatId}.mp4`
      }] : [] });
    }
    throw new Error(`Unexpected synthetic route ${method} ${url.pathname}`);
  };

  const constructor = (ownerServiceModule as unknown as Record<string, unknown>).OwnerVeoT2vGenerationService;
  assert.equal(typeof constructor, "function", "Veo T2V family service export is missing");
  const service = new (constructor as new (options: Record<string, unknown>) => VeoGenerationService)({
    binding: AUTH_BINDING,
    linkService,
    catalogDirectory: resolve(process.cwd(), "catalog"),
    resolveModelAccess: async (_attemptId: string, modelId: string, parameters: Readonly<Record<string, unknown>>): Promise<ModelAccessResult> => {
      costs.push({ modelId, parameters: Object.freeze({ ...parameters }) });
      return {
        catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
        catalog_version: `${sourceProfile.catalog.fetched_at}.${sourceProfile.catalog.source_hashes.models.slice(7, 19)}`,
        model_id: modelId, ai_name: "veo3", model_type: modelId, account_read_live: true,
        parameter_keys: Object.keys(parameters).sort(), parameters_redacted: true, access: true, cost: null,
        discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false, observed_at: new Date(now).toISOString()
      };
    },
    resolveSubscription: async (): Promise<SyntxSubscription> => ({ active: true, plan_type: "PAID", end_date: null, end_date_kind: null }),
    resolveChatClient: () => new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
      return operation("synthetic-veo-tools-credential");
    } }, fetchImpl, requestTimeoutMs: 1_000 }),
    now: () => now,
    wait: async () => undefined,
    videoTimeoutMs: 10
  });

  const toolsModuleUrl = new URL("../src/mcp/owner-veo-t2v-tools.js", import.meta.url);
  const toolsModule = await import(toolsModuleUrl.href).catch(() => null) as null | Record<string, unknown>;
  assert.ok(toolsModule, "Veo T2V MCP tools module is missing");
  const register = toolsModule.registerSyntxOwnerVeoT2vTools;
  assert.equal(typeof register, "function", "Veo T2V MCP registration function is missing");
  const server = new McpServer({ name: "veo-tools-test", version: "1.0.0" });
  (register as (server: McpServer, options: { service: VeoGenerationService }) => void)(server, { service });
  const client = new Client({ name: "veo-tools-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client, service, server, requests, costs,
    ready(chatId: string) { ready.set(chatId, true); },
    setReadyOnCreate(value: boolean) { readyOnCreate = value; },
    counts: () => ({ chatCount, videoPosts }),
    close: async () => { await client.close(); await server.close(); await service.close(); }
  };
}

test("Veo MCP source and generation tools expose exactly the three model and variant identities", async () => {
  const state = await setupTools();
  try {
    const listed = await state.client.listTools();
    const names = [
      "syntx_owner_get_veo_t2v_source",
      "syntx_owner_generate_veo_t2v",
      "syntx_owner_reconcile_veo_t2v",
      "syntx_owner_list_veo_t2v_recoveries"
    ];
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [...names].sort());
    const sourceTool = listed.tools.find((tool) => tool.name === "syntx_owner_get_veo_t2v_source");
    const sourceSchema = JSON.stringify(sourceTool?.inputSchema);
    assert.doesNotMatch(sourceSchema, /chat_id|uuid|url|recovery_id/u);
    for (const model_id of MODEL_IDS) {
      const source = await state.client.callTool({ name: "syntx_owner_get_veo_t2v_source", arguments: { model_id } });
      assert.equal(source.isError, undefined, JSON.stringify(source));
      const output = source.structuredContent as { identity: { model_id: string; model_type: string }; controls: { upscale: { options: Array<{ value: number; label: string }>; excluded_options: Array<{ value: number }> }; aspect_ratio: { values: string[] }; video_duration: { values: number[] } } };
      assert.equal(output.identity.model_id, model_id);
      assert.equal(output.identity.model_type, model_id);
      assert.deepEqual(output.controls.upscale.options.map(({ value }) => value), [0, 1, 2]);
      assert.deepEqual(output.controls.upscale.options.map(({ label }) => label), ["720p", "1080p", "4K"]);
      assert.deepEqual(output.controls.upscale.excluded_options.map(({ value }) => value), [3]);
      assert.deepEqual(output.controls.aspect_ratio.values, ["16:9", "9:16"]);
      assert.deepEqual(output.controls.video_duration.values, [8]);
    }
    assert.deepEqual(state.counts(), { chatCount: 0, videoPosts: 0 });
  } finally { await state.close(); }
});

test("Veo MCP accepts numeric quality only, seals one no-reference POST per model, and binds output variants", async () => {
  const state = await setupTools();
  try {
    state.setReadyOnCreate(true);
    const inputs = [
      { model_id: "veo3", upscale: 0, aspect_ratio: "16:9" },
      { model_id: "veo3fast", upscale: 1, aspect_ratio: "9:16" },
      { model_id: "veo3fast_r", upscale: 2, aspect_ratio: "16:9" }
    ] as const;
    const outputs: Array<{ model_id: string; variant_id: string }> = [];
    for (const [index, input] of inputs.entries()) {
      const result = await state.client.callTool({ name: "syntx_owner_generate_veo_t2v", arguments: {
        link_attempt_id: ATTEMPT, ...input, prompt: `A quiet mountain village at sunrise ${index}.`, video_duration: 8
      } });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      outputs.push(result.structuredContent as { model_id: string; variant_id: string });
    }
    assert.deepEqual(outputs.map(({ model_id, variant_id }) => ({ model_id, variant_id })),
      inputs.map(({ model_id }) => ({ model_id, variant_id: OWNER_VEO_T2V_CONTRACT_VARIANT_IDS[model_id] })));
    const posts = state.requests.filter((request) => request.method === "POST" && request.url.pathname === "/api/v1/video/generate");
    assert.equal(posts.length, 3);
    assert.deepEqual(posts.map((request) => request.body), inputs.map((input, index) => ({
      chat_id: `veo-tools-chat-${index + 1}`,
      prompt: `A quiet mountain village at sunrise ${index}.`,
      settings: { type: "text", model_type: input.model_id, file_urls: [], upscale: input.upscale,
        aspect_ratio: input.aspect_ratio, video_duration: 8 }
    })));
    assert.equal(state.costs.length, 6);
    assert.ok(state.costs.every(({ parameters }) => Object.keys(parameters).join() === "upscale"));
    assert.deepEqual(state.counts(), { chatCount: 3, videoPosts: 3 });
  } finally { await state.close(); }
});

test("Veo MCP rejects caller wire fields and reconciles unknown outcomes by GET without leaking owner metadata", async () => {
  const state = await setupTools();
  try {
    const valid = { link_attempt_id: ATTEMPT, model_id: "veo3fast_r", prompt: "A kite over a green field.",
      upscale: 2, aspect_ratio: "9:16", video_duration: 8 };
    const invalidInputs = [
      { ...valid, upscale: "4K" }, { ...valid, upscale: 3 }, { ...valid, type: "text" },
      { ...valid, file_urls: [] }, { ...valid, model_type: "veo3fast_r" }, { ...valid, chat_id: "raw-chat" },
      { ...valid, url: "https://r2.syntx.ai/input.mp4" }, { ...valid, uuid: "00000000-0000-4000-8000-000000000000" },
      { ...valid, attemptId: ATTEMPT }, { ...valid, recovery_id: "recovery_00000000-0000-4000-8000-000000000000" }
    ];
    for (const arguments_ of invalidInputs) {
      const invalid = await state.client.callTool({ name: "syntx_owner_generate_veo_t2v", arguments: arguments_ });
      assert.equal(invalid.isError, true);
    }
    assert.deepEqual(state.counts(), { chatCount: 0, videoPosts: 0 });

    const noReplay = await state.client.callTool({ name: "syntx_owner_generate_veo_t2v", arguments: valid });
    assert.equal(noReplay.isError, true);
    const errorText = (noReplay as CallToolResult).content.filter((item) => item.type === "text").map((item) => item.text).join(" ");
    assert.match(errorText, /OUTCOME_UNKNOWN/u);
    assert.match(errorText, /do not retry/u);
    assert.doesNotMatch(errorText, /synthetic-veo-tools-credential|syntx\.ai\/auth|chat_id|tenant|subject|veo-tools-chat/u);
    const recoveryId = (JSON.parse(errorText) as { error: { recovery_id: string } }).error.recovery_id;
    assert.match(recoveryId, /^recovery_[0-9a-f-]{36}$/u);
    const listed = await state.client.callTool({ name: "syntx_owner_list_veo_t2v_recoveries", arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(listed.isError, undefined);
    const recoveries = (listed.structuredContent as { recoveries: Array<{ model_id: string; variant_id: string; recovery_id: string }> }).recoveries;
    assert.deepEqual(recoveries.map(({ model_id, variant_id, recovery_id: listedId }) => ({ model_id, variant_id, recovery_id: listedId })), [{
      model_id: "veo3fast_r", variant_id: OWNER_VEO_T2V_CONTRACT_VARIANT_IDS.veo3fast_r, recovery_id: recoveryId
    }]);
    const postsBeforeReconcile = state.counts().videoPosts;
    state.ready("veo-tools-chat-1");
    const reconciled = await state.client.callTool({ name: "syntx_owner_reconcile_veo_t2v", arguments: {
      link_attempt_id: ATTEMPT, model_id: "veo3fast_r", recovery_id: recoveryId
    } });
    assert.equal(reconciled.isError, undefined, JSON.stringify(reconciled));
    const output = reconciled.structuredContent as { model_id: string; variant_id: string };
    assert.equal(output.model_id, "veo3fast_r");
    assert.equal(output.variant_id, OWNER_VEO_T2V_CONTRACT_VARIANT_IDS.veo3fast_r);
    assert.equal(state.counts().videoPosts, postsBeforeReconcile);
    assert.ok(state.requests.some((request) => request.method === "GET" && request.url.pathname.includes("veo-tools-chat-1")));
  } finally { await state.close(); }
});
