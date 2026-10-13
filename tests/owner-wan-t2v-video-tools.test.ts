import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerWanT2vGenerationService } from "../src/application/owner-wan-t2v-generation-service.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthBinding } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { createMcpServer } from "../src/mcp/server.js";

const TOOLS_MODULE_URL = new URL("../src/mcp/owner-wan-t2v-video-tools.js", import.meta.url).href;
const SERVER_MODULE_URL = new URL("../src/mcp/server.js", import.meta.url).href;
const CATALOG_VERSION = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json";
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(CATALOG_VERSION));
const BINDING: AuthBinding = Object.freeze({ tenant_id: "wan-t2v-tools-test-tenant", subject: "wan-t2v-tools-test-subject" });
const EXPECTED_NAMES = [
  "syntx_get_wan_t2v_parameters",
  "syntx_owner_generate_wan_t2v_video",
  "syntx_owner_reconcile_wan_t2v_video",
  "syntx_owner_list_wan_t2v_recoveries",
  "syntx_owner_get_wan_t2v_result_page"
] as const;
const ATTEMPT = "link_wan_t2v_mcp_tools_test_000000000001";

function generationFixture(outputCount = 1, incomplete = false) {
  let now = Date.parse("2026-10-13T00:00:00.000Z");
  let chatIndex = 0;
  const jobs = new Map<string, { ackId: string; modelId: string; messages: Array<{ messageId: string; objects: Array<{ id: string; url: string }> }> }>();
  const events: Array<{ method: string; url: URL; body: unknown }> = [];
  const counts = { posts: 0, historyGets: 0, resultGets: 0 };
  const credentialBroker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return operation("synthetic-wan-t2v-calltool-fixture-credential");
  } };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    events.push({ method, url, body });
    if (url.pathname === "/api/v1/user/balance") return Response.json({ balance: "1000" });
    if (url.pathname === "/api/v1/user/subscription") return Response.json({ active: true, type: "PRO", end_date: "2026-10-14T00:00:00.000Z" });
    if (url.pathname === "/api/v2/get_model_info") return Response.json({ access: true, cost: 2, discount_cost: null,
      free_remaining_generations: null, limit: null, show_warning: null });
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatIndex += 1;
      return Response.json({ uuid: `wan-t2v-tool-chat-${chatIndex}` });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      counts.posts += 1;
      const request = body as { chat_id: string; settings: { model_type: string } };
      const messageCount = Math.ceil(outputCount / 64);
      let remaining = outputCount;
      let outputIndex = 0;
      const messages = Array.from({ length: messageCount }, (_, batchIndex) => {
        const batchCount = Math.min(64, remaining);
        const messageId = `wan-t2v-tool-bot-${counts.posts}-${batchIndex + 1}`;
        const objects = Array.from({ length: batchCount }, () => {
          outputIndex += 1;
          return { id: `wan-t2v-tool-object-${counts.posts}-${outputIndex}`,
            url: `https://r2.syntx.ai/generated/wan-t2v-tool-${counts.posts}-${outputIndex}.mp4` };
        });
        remaining -= batchCount;
        return { messageId, objects };
      });
      jobs.set(request.chat_id, { ackId: `wan-t2v-tool-owner-ack-${counts.posts}`, modelId: request.settings.model_type, messages });
      return Response.json({ id: `wan-t2v-tool-owner-ack-${counts.posts}` });
    }
    const historyMatch = /^\/api\/v1\/chats\/(wan-t2v-tool-chat-\d+)\/messages$/u.exec(url.pathname);
    if (historyMatch) {
      counts.historyGets += 1;
      const job = jobs.get(historyMatch[1]!);
      assert.ok(job, "history must belong to a chat created by the genuine generation service/client");
      const messages = [{ id: job.ackId, chat_id: 9123, author_id: 4123, message_object: [] }, ...job.messages.map((row) => ({
        id: row.messageId, chat_id: 9123, author_id: -1,
        message_object: row.objects.map((object) => ({ id: object.id, message_id: row.messageId, object_type: "video", model_type: job.modelId }))
      }))];
      const page = Number(url.searchParams.get("page"));
      const pageSize = 10;
      const totalPages = Math.ceil(messages.length / pageSize);
      return Response.json({ messages: messages.slice((page - 1) * pageSize, page * pageSize),
        pagination: { page, page_size: pageSize, total_count: messages.length, total_pages: totalPages,
          has_next: page < totalPages, has_previous: page > 1 } });
    }
    const resultMatch = /^\/api\/v1\/chats\/(wan-t2v-tool-chat-\d+)\/(wan-t2v-tool-bot-\d+-\d+)$/u.exec(url.pathname);
    if (resultMatch) {
      counts.resultGets += 1;
      const job = jobs.get(resultMatch[1]!);
      assert.ok(job);
      const row = job.messages.find((entry) => entry.messageId === resultMatch[2]);
      assert.ok(row);
      return Response.json({ id: row.messageId, chat_id: 9123, author_id: -1, message_object: row.objects.map((object) => ({
        id: object.id, message_id: row.messageId, object_type: "video", model_type: job.modelId,
        completed: !incomplete, object_url: object.url
      })) });
    }
    if (/\/inprogress$/u.test(url.pathname)) return Response.json([]);
    throw new Error(`Unexpected synthetic request ${method} ${url.pathname}`);
  };
  const linkService = new PerUserLinkService({} as never, { async getSnapshot(_binding: unknown, attemptId: string) {
    return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
      status: "LINKED" as const, expires_at: null, linked: true };
  } } as never);
  const chatClient = new SyntxChatHttpClient({ credentialBroker, fetchImpl, maxResponseBytes: 1024 * 1024 });
  const generationService = new OwnerWanT2vGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveChatClient: () => chatClient,
    createAccountStatusService: () => new AccountStatusService(new SyntxHttpClient({ credentialBroker, fetchImpl }), () => now),
    createModelAccessService: () => new ModelAccessService(CATALOG, new SyntxHttpClient({ credentialBroker, fetchImpl }), () => now),
    now: () => now, pollDelayMs: 0, maxPollAttempts: 1 });
  return { generationService, events, counts };
}

async function loadToolsModule(): Promise<Record<string, unknown>> {
  try { return await import(TOOLS_MODULE_URL) as Record<string, unknown>; }
  catch (error) { assert.fail(`MISSING_OWNER_WAN_T2V_VIDEO_TOOLS_MODULE: ${String(error)}`); }
}

function actualServiceFixture() {
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => { fetchCalls += 1; throw new Error("No upstream fetch is expected in this fixture."); };
  const credentialBroker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return operation("synthetic-wan-t2v-mcp-test-credential");
  } };
  const linkService = new PerUserLinkService({} as never, { async getSnapshot(_binding: unknown, attemptId: string) {
    return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
      status: "LINKED" as const, expires_at: null, linked: true };
  } } as never);
  const client = new SyntxChatHttpClient({ credentialBroker, fetchImpl });
  const generationService = new OwnerWanT2vGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveChatClient: () => client,
    createAccountStatusService: () => new AccountStatusService(new SyntxHttpClient({ credentialBroker, fetchImpl })),
    createModelAccessService: () => new ModelAccessService(CATALOG, new SyntxHttpClient({ credentialBroker, fetchImpl })) });
  return { generationService, get fetchCalls() { return fetchCalls; } };
}

test("WAN T2V tools export exactly five owner parameter/generation/recovery/page actions", async () => {
  const module = await loadToolsModule();
  assert.deepEqual(module.OWNER_WAN_T2V_TOOL_NAMES, EXPECTED_NAMES);
  for (const name of EXPECTED_NAMES) assert.equal(typeof (module as Record<string, unknown>)[`SYNTX_${name.slice(6).toUpperCase()}_TOOL_NAME`], "string");
  assert.ok(module.OWNER_WAN_T2V_TOOL_INPUT_SCHEMAS);
  assert.ok(module.OWNER_WAN_T2V_TOOL_OUTPUT_SCHEMAS);
  assert.equal(typeof module.registerSyntxOwnerWanT2vVideoTools, "function");
});

test("WAN T2V generation input requires exact complete branch controls and preserves Unicode prompt", async () => {
  const module = await loadToolsModule();
  const schemas = module.OWNER_WAN_T2V_TOOL_INPUT_SCHEMAS as { generate: { safeParse(value: unknown): { success: boolean; data?: unknown } } };
  const shared = { link_attempt_id: ATTEMPT, prompt: "Кинематографичный кадр 🎬", parameters: {
    resolution: "720P", aspect_ratio: "16:9", video_duration: 5, prompt_extend: true, seed: 0
  } };
  const cases = [
    { ...shared, model_id: "wan_26_t2v", parameters: { ...shared.parameters, shot_type: "single" } },
    { ...shared, model_id: "wan_27_t2v", parameters: { ...shared.parameters, native_audio: false } }
  ];
  for (const input of cases) {
    const parsed = schemas.generate.safeParse(input);
    assert.equal(parsed.success, true, JSON.stringify(input));
    assert.deepEqual(parsed.data, input, "prompt and complete explicit settings stay byte-for-byte represented by the tool parser");
  }
  assert.equal(schemas.generate.safeParse({ ...cases[0], parameters: { ...cases[0]!.parameters, native_audio: false } }).success, false);
  assert.equal(schemas.generate.safeParse({ ...cases[1], parameters: { ...cases[1]!.parameters, shot_type: "multi" } }).success, false);
  assert.equal(schemas.generate.safeParse({ ...cases[0], parameters: { ...cases[0]!.parameters, seed: undefined } }).success, false);
  assert.equal(schemas.generate.safeParse({ ...cases[0], prompt: "  \n" }).success, false);
  assert.equal(schemas.generate.safeParse({ ...cases[0], prompt: "😀".repeat(17_000) }).success, false,
    "the local UTF-8 resource bound rejects oversized multibyte input before service entry");
});

test("Stock SDK lists exactly five WAN T2V tools with oneOf input metadata and source parameters do not fetch", async () => {
  const module = await loadToolsModule();
  const fixture = actualServiceFixture();
  const server = new McpServer({ name: "wan-t2v-tool-test", version: "1.0.0" });
  const register = module.registerSyntxOwnerWanT2vVideoTools as (target: McpServer, options: unknown) => void;
  assert.throws(() => register(server, { generationService: {
    async generate() { return {}; }, async reconcile() { return {}; }, async listRecoveries() { return []; }, async getResultPage() { return {}; }
  } }), /WAN_T2V_SERVICE_COMPOSITION_INVALID/u, "a structurally similar service cannot opt in the owner tools");
  register(server, { generationService: fixture.generationService });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "wan-t2v-tool-test-client", version: "1.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = (await client.listTools()).tools;
    assert.deepEqual(listed.map(({ name }) => name), EXPECTED_NAMES);
    const generate = listed.find(({ name }) => name === "syntx_owner_generate_wan_t2v_video");
    assert.ok(generate);
    assert.ok(Array.isArray((generate.inputSchema as { oneOf?: unknown }).oneOf));
    const parameters = await client.callTool({ name: "syntx_get_wan_t2v_parameters", arguments: {} });
    assert.equal(parameters.isError, undefined, JSON.stringify(parameters));
    assert.equal((parameters.structuredContent as { runtime_usable?: unknown }).runtime_usable, false);
    assert.equal((parameters.structuredContent as { dispatch_allowed?: unknown }).dispatch_allowed, false);
    assert.equal((parameters.structuredContent as { backend_acceptance?: unknown }).backend_acceptance, "UNPROVEN");
    assert.equal(fixture.fetchCalls, 0);
  } finally { await Promise.all([client.close(), server.close(), fixture.generationService.close()]); }
});

test("WAN T2V tools remain absent by default and server composition opts in exactly the five-tool group", async () => {
  const module = await import(SERVER_MODULE_URL) as Record<string, unknown>;
  const createMcpServer = module.createMcpServer as (application: unknown, options?: unknown) => McpServer;
  const application = createDefaultApplication({ discoveryCatalog: CATALOG, runtimeCapabilities: null });
  const defaults = createMcpServer(application);
  const generationService = actualServiceFixture().generationService;
  const defaultPair = InMemoryTransport.createLinkedPair();
  const defaultClient = new Client({ name: "wan-t2v-server-default-test", version: "1.0.0" });
  try {
    await defaults.connect(defaultPair[1]);
    await defaultClient.connect(defaultPair[0]);
    const defaultNames = (await defaultClient.listTools()).tools.map(({ name }) => name);
    assert.equal(defaultNames.some((name) => EXPECTED_NAMES.includes(name as never)), false);
  } finally { await Promise.all([defaultClient.close(), defaults.close()]); }

  const owner = createMcpServer(application, { ownerWanT2vVideos: { generationService } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "wan-t2v-server-owner-test", version: "1.0.0" });
  try {
    await owner.connect(serverTransport);
    await client.connect(clientTransport);
    const selected = (await client.listTools()).tools.filter(({ name }) => EXPECTED_NAMES.includes(name as never));
    assert.deepEqual(selected.map(({ name }) => name), EXPECTED_NAMES);
    const generate = selected.find(({ name }) => name === "syntx_owner_generate_wan_t2v_video");
    assert.ok(generate);
    assert.ok(Array.isArray((generate.inputSchema as { oneOf?: unknown }).oneOf));
  } finally { await Promise.all([client.close(), owner.close(), generationService.close()]); }
});

test("MCP callTool dispatches both exact model branches through the genuine service and source-shaped client", async () => {
  const fixture = generationFixture(1);
  const application = createDefaultApplication({ discoveryCatalog: CATALOG, runtimeCapabilities: null });
  const owner = createMcpServer(application, { ownerWanT2vVideos: { generationService: fixture.generationService } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "wan-t2v-branches-calltool-test", version: "1.0.0" });
  try {
    await owner.connect(serverTransport);
    await client.connect(clientTransport);
    const prompt26 = "  Кадр над морем 🎬\n";
    const prompt27 = "Снежное поле 雪";
    const first = await client.callTool({ name: "syntx_owner_generate_wan_t2v_video", arguments: {
      link_attempt_id: ATTEMPT, model_id: "wan_26_t2v", prompt: prompt26,
      parameters: { resolution: "720P", aspect_ratio: "16:9", video_duration: 5, prompt_extend: true, seed: 0, shot_type: "multi" }
    } });
    const second = await client.callTool({ name: "syntx_owner_generate_wan_t2v_video", arguments: {
      link_attempt_id: ATTEMPT, model_id: "wan_27_t2v", prompt: prompt27,
      parameters: { resolution: "1080P", aspect_ratio: "3:4", video_duration: 15, prompt_extend: false, seed: null, native_audio: true }
    } });
    assert.equal(first.isError, undefined, JSON.stringify(first));
    assert.equal(second.isError, undefined, JSON.stringify(second));
    assert.equal((first.structuredContent as { model_id: unknown }).model_id, "wan_26_t2v");
    assert.equal((second.structuredContent as { model_id: unknown }).model_id, "wan_27_t2v");
    assert.equal((first.structuredContent as { backend_acceptance: unknown }).backend_acceptance, "UNPROVEN");
    assert.equal((first.structuredContent as { provider_terminal_status: unknown }).provider_terminal_status, "UNPROVEN");
    const posts = fixture.events.filter((event) => event.method === "POST" && event.url.pathname === "/api/v1/video/generate");
    assert.equal(posts.length, 2);
    assert.deepEqual(posts.map((event) => event.body), [
      { chat_id: "wan-t2v-tool-chat-1", prompt: prompt26, settings: { model_type: "wan_26_t2v", resolution: "720P",
        aspect_ratio: "16:9", video_duration: 5, prompt_extend: true, seed: 0, shot_type: "multi", file_urls: [] } },
      { chat_id: "wan-t2v-tool-chat-2", prompt: prompt27, settings: { model_type: "wan_27_t2v", resolution: "1080P",
        aspect_ratio: "3:4", video_duration: 15, prompt_extend: false, seed: null, native_audio: true, file_urls: [] } }
    ]);
  } finally { await Promise.all([client.close(), owner.close(), fixture.generationService.close()]); }
});

test("MCP generation and local paging preserve 80 native fixture artifacts as 64 plus 16 without a second POST", async () => {
  const fixture = generationFixture(80);
  const application = createDefaultApplication({ discoveryCatalog: CATALOG, runtimeCapabilities: null });
  const owner = createMcpServer(application, { ownerWanT2vVideos: { generationService: fixture.generationService } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "wan-t2v-multi80-calltool-test", version: "1.0.0" });
  try {
    await owner.connect(serverTransport);
    await client.connect(clientTransport);
    const initial = await client.callTool({ name: "syntx_owner_generate_wan_t2v_video", arguments: {
      link_attempt_id: ATTEMPT, model_id: "wan_26_t2v", prompt: "bounded synthetic result aggregation",
      parameters: { resolution: "720P", aspect_ratio: "1:1", video_duration: 5, prompt_extend: true, seed: null, shot_type: "single" }
    } });
    assert.equal(initial.isError, undefined, JSON.stringify(initial));
    const first = initial.structuredContent as { artifacts: unknown[]; has_more: boolean; next_offset: number | null;
      observed_artifact_count: number; recovery_id: string };
    assert.equal(first.artifacts.length, 64);
    assert.equal(first.has_more, true);
    assert.equal(first.next_offset, 64);
    assert.equal(first.observed_artifact_count, 80);
    const page = await client.callTool({ name: "syntx_owner_get_wan_t2v_result_page", arguments: {
      link_attempt_id: ATTEMPT, recovery_id: first.recovery_id, offset: 64
    } });
    assert.equal(page.isError, undefined, JSON.stringify(page));
    const second = page.structuredContent as { artifacts: unknown[]; has_more: boolean; next_offset: number | null;
      observed_artifact_count: number };
    assert.equal(second.artifacts.length, 16);
    assert.equal(second.has_more, false);
    assert.equal(second.next_offset, null);
    assert.equal(second.observed_artifact_count, 80);
    assert.equal(fixture.counts.posts, 1);
    assert.equal(fixture.counts.historyGets, 1);
    assert.equal(fixture.counts.resultGets, 2);
  } finally { await Promise.all([client.close(), owner.close(), fixture.generationService.close()]); }
});

test("unknown generation outcome exposes only safe recovery id; list and reconcile remain GET-only", async () => {
  const fixture = generationFixture(1, true);
  const application = createDefaultApplication({ discoveryCatalog: CATALOG, runtimeCapabilities: null });
  const owner = createMcpServer(application, { ownerWanT2vVideos: { generationService: fixture.generationService } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "wan-t2v-recovery-calltool-test", version: "1.0.0" });
  try {
    await owner.connect(serverTransport);
    await client.connect(clientTransport);
    const unknown = await client.callTool({ name: "syntx_owner_generate_wan_t2v_video", arguments: {
      link_attempt_id: ATTEMPT, model_id: "wan_26_t2v", prompt: "pending result remains unknown",
      parameters: { resolution: "720P", aspect_ratio: "1:1", video_duration: 5, prompt_extend: true, seed: null, shot_type: "single" }
    } });
    assert.equal(unknown.isError, true);
    const errorText = (unknown.content as Array<{ type: string; text?: string }>).find((item) => item.type === "text")?.text ?? "{}";
    const errorPayload = JSON.parse(errorText) as {
      error?: { code?: string; recovery_id?: string; message?: string };
    };
    assert.equal(errorPayload.error?.code, "OUTCOME_UNKNOWN");
    assert.match(errorPayload.error?.recovery_id ?? "", /^wan_t2v_recovery_[0-9a-f-]{36}$/u);
    assert.equal(JSON.stringify(errorPayload).includes("wan-t2v-tool-chat"), false);
    const before = { ...fixture.counts };
    const listed = await client.callTool({ name: "syntx_owner_list_wan_t2v_recoveries", arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(listed.isError, undefined, JSON.stringify(listed));
    const recoveries = (listed.structuredContent as { recoveries: Array<Record<string, unknown>> }).recoveries;
    assert.equal(recoveries.length, 1);
    assert.equal(recoveries[0]?.recovery_id, errorPayload.error?.recovery_id);
    assert.equal(JSON.stringify(recoveries).includes("prompt"), false);
    const reconciled = await client.callTool({ name: "syntx_owner_reconcile_wan_t2v_video", arguments: {
      link_attempt_id: ATTEMPT, recovery_id: errorPayload.error!.recovery_id!
    } });
    assert.equal(reconciled.isError, true);
    assert.equal(fixture.counts.posts, before.posts, "GET-only reconciliation never repeats generation POST");
    assert.equal(fixture.counts.historyGets, before.historyGets + 1);
    assert.equal(fixture.counts.resultGets, before.resultGets + 1);
  } finally { await Promise.all([client.close(), owner.close(), fixture.generationService.close()]); }
});
