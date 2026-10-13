import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { OwnerSunoGenerationService } from "../src/application/owner-suno-generation-service.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthBinding, AuthLinkProvider } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { createMcpServer } from "../src/mcp/server.js";

const TOOLS_MODULE_URL = new URL("../src/mcp/owner-suno-generation-tools.js", import.meta.url).href;
const PUBLIC_INDEX_URL = new URL("../src/index.js", import.meta.url).href;
const CATALOG_VERSION = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json";
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(CATALOG_VERSION));
const BINDING: AuthBinding = Object.freeze({ tenant_id: "suno-tools-test-tenant", subject: "suno-tools-test-owner" });
const ATTEMPT = "link_suno_mcp_owner_0123456789";
const stores = new Set<InMemoryAuthLinkStore>();
afterEach(() => { for (const store of stores) store.close(); stores.clear(); });

async function genuineFixture(options: { outputCount?: number; loseAck?: boolean; pendingFirstResult?: boolean } = {}) {
  let now = Date.parse("2026-10-13T00:00:00.000Z");
  let chatCount = 0;
  let postCount = 0;
  let historyGets = 0;
  let resultGets = 0;
  const events: Array<{ method: string; url: URL; body?: unknown }> = [];
  const jobs = new Map<string, { prompt: string; model: string; ackId: string;
    messages: Array<{ messageId: string; objects: Array<{ id: string; url: string }> }> }>();
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-suno-tools", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-suno-tools-credential" });
      return { state: "LINKED" };
    }
  };
  const store = new InMemoryAuthLinkStore(() => now); stores.add(store);
  const linkService = new PerUserLinkService(provider, store, { now: () => now, defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: () => ATTEMPT });
  await linkService.createAttempt(BINDING);
  await linkService.issueHandoff(BINDING, ATTEMPT);
  assert.equal((await linkService.checkAttempt(BINDING, ATTEMPT)).status, "LINKED");
  const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return linkService.useCredential(BINDING, ATTEMPT, (credential) => operation(credential.value));
  } };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    events.push({ method, url, ...(body === undefined ? {} : { body }) });
    if (url.pathname === "/api/v1/user/balance" && method === "GET") return Response.json({ balance: "1000" });
    if (url.pathname === "/api/v1/user/subscription" && method === "GET") return Response.json({ active: true,
      type: "PRO", end_date: "2026-10-14T00:00:00.000Z" });
    if (url.pathname === "/api/v2/get_model_info" && method === "GET") return Response.json({ access: true, cost: 1,
      discount_cost: null, free_remaining_generations: null, limit: null, show_warning: null });
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatCount += 1; return Response.json({ uuid: `suno-tools-chat-${chatCount}` });
    }
    if (url.pathname === "/api/v1/audio/generate" && method === "POST") {
      postCount += 1;
      const request = body as { chat_uuid: string; prompt: string; settings: { model_type: string } };
      const count = options.outputCount ?? 1;
      let outputIndex = 0;
      let remaining = count;
      const messages = Array.from({ length: Math.ceil(count / 64) }, (_, batch) => {
        const length = Math.min(64, remaining);
        const messageId = `suno-tools-bot-${postCount}-${batch + 1}`;
        const objects = Array.from({ length }, () => {
          outputIndex += 1;
          return { id: `suno-tools-object-${postCount}-${outputIndex}`,
            url: `https://r2.syntx.ai/generated/suno-tools-${postCount}-${outputIndex}.mp3` };
        });
        remaining -= length;
        return { messageId, objects };
      });
      const ackId = `suno-tools-ack-${postCount}`;
      jobs.set(request.chat_uuid, { prompt: request.prompt, model: request.settings.model_type, ackId, messages });
      if (options.loseAck) throw new Error("Synthetic connection lost after the sole POST.");
      return Response.json({ id: ackId });
    }
    const history = /^\/api\/v1\/chats\/([^/]+)\/messages$/u.exec(url.pathname);
    if (history && method === "GET") {
      historyGets += 1;
      const job = jobs.get(history[1]!); assert.ok(job, "history is read only through a genuine newly created chat context");
      const messages: Array<Record<string, unknown>> = [{ id: job.ackId, chat_id: 9001, author_id: 41,
        message_object: [{ id: `suno-tools-ack-object-${job.ackId}`, message_id: job.ackId,
          object_type: "text", object_text: job.prompt, model_type: job.model }] }];
      for (const row of job.messages) messages.push({ id: row.messageId, chat_id: 9001, author_id: -1,
        message_object: row.objects.map((object) => ({ id: object.id, message_id: row.messageId,
          object_type: "audio", model_type: job.model })) });
      const page = Number(url.searchParams.get("page")), pageSize = 10, pages = Math.ceil(messages.length / pageSize);
      return Response.json({ messages: messages.slice((page - 1) * pageSize, page * pageSize), pagination: {
        page, page_size: pageSize, total_count: messages.length, total_pages: pages,
        has_next: page < pages, has_previous: page > 1
      } });
    }
    const result = /^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (result && method === "GET") {
      resultGets += 1;
      const job = jobs.get(result[1]!); assert.ok(job);
      const row = job.messages.find((item) => item.messageId === result[2]); assert.ok(row);
      return Response.json({ id: row.messageId, chat_id: 9001, author_id: -1, message_object: row.objects.map((object) => ({
        id: object.id, message_id: row.messageId, object_type: "audio", object_url: object.url,
        completed: !(options.pendingFirstResult && resultGets === 1), model_type: job.model
      })) });
    }
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  };
  const service = new OwnerSunoGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveChatClient: () => new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl,
      maxResponseBytes: 2 * 1024 * 1024 }),
    createAccountStatusService: () => new AccountStatusService(new SyntxHttpClient({ credentialBroker: broker, fetchImpl }), () => now),
    createModelAccessService: () => new ModelAccessService(CATALOG, new SyntxHttpClient({ credentialBroker: broker, fetchImpl }), () => now),
    now: () => now, pollDelayMs: 0, maxPollAttempts: 1 });
  return { service, linkService, events, get counts() { return { chatCount, postCount, historyGets, resultGets }; },
    close: async () => { await service.close(); } };
}

async function connectTools(module: Record<string, unknown>, fixture: Awaited<ReturnType<typeof genuineFixture>>) {
  const server = new McpServer({ name: "suno-tools-test", version: "1.0.0" });
  const register = module.registerSyntxOwnerSunoGenerationTools as (server: McpServer, options: unknown) => void;
  register(server, { generationService: fixture.service });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "suno-tools-stock-sdk-test", version: "1.0.0" });
  await server.connect(serverTransport); await client.connect(clientTransport);
  return { server, client, close: async () => { await Promise.all([client.close(), server.close()]); } };
}
const EXPECTED_NAMES = [
  "syntx_get_suno_generate_parameters",
  "syntx_owner_generate_suno_audio",
  "syntx_owner_reconcile_suno_audio",
  "syntx_owner_list_suno_recoveries",
  "syntx_owner_get_suno_result_page"
] as const;

test("Suno owner MCP exports exactly the narrow generate and recovery surface", async () => {
  let module: Record<string, unknown> | null = null;
  try { module = await import(TOOLS_MODULE_URL) as Record<string, unknown>; }
  catch (error) { assert.fail(`MISSING_OWNER_SUNO_GENERATION_TOOLS_MODULE: ${String(error)}`); }
  assert.deepEqual(module.OWNER_SUNO_GENERATION_TOOL_NAMES, EXPECTED_NAMES);
  assert.equal(typeof module.registerSyntxOwnerSunoGenerationTools, "function");
  assert.ok(module.OWNER_SUNO_GENERATION_TOOL_INPUT_SCHEMAS);
  assert.ok(module.OWNER_SUNO_GENERATION_TOOL_OUTPUT_SCHEMAS);
  const publicApi = await import(PUBLIC_INDEX_URL) as Record<string, unknown>;
  for (const name of ["OWNER_SUNO_GENERATION_TOOL_NAMES", "SYNTX_OWNER_GENERATE_SUNO_AUDIO_TOOL_NAME",
    "getOwnerSunoGenerationParameterSource", "normalizeOwnerSunoGenerationParameters", "OwnerSunoGenerationServiceError"]) {
    assert.ok(name in publicApi, `MISSING_SAFE_SUNO_PUBLIC_EXPORT_${name}`);
  }
  for (const name of ["OwnerSunoGenerationRequestPreparer", "OwnerSunoGenerationOneShotPolicy",
    "OwnerSunoGenerationPreparedCandidate", "OwnerSunoGenerationOneShotPermit", "OwnerSunoGenerationChatContext"]) {
    assert.equal(name in publicApi, false, `PRIVATE_SUNO_EXPORT_LEAK_${name}`);
  }
});

test("Suno generation schema requires every explicit source-shaped value for both models and mode flags", async () => {
  const module = await import(TOOLS_MODULE_URL) as Record<string, unknown>;
  const schemas = module.OWNER_SUNO_GENERATION_TOOL_INPUT_SCHEMAS as {
    generate: { safeParse(value: unknown): { success: boolean; data?: unknown } };
  };
  const common = { link_attempt_id: "link_suno_mcp_owner_0123456789", mode: "generate",
    prompt: "Дождь над городом 🎵", negative_tags: "noise", styles: "ambient", title: "Ночной город" };
  for (const model_id of ["V6", "V6_wild"] as const) {
    for (const is_custom_mode of [false, true]) {
      for (const is_instrumental of [false, true]) {
        const input = { ...common, model_id, is_custom_mode, is_instrumental };
        const parsed = schemas.generate.safeParse(input);
        assert.equal(parsed.success, true, `${model_id}/${is_custom_mode}/${is_instrumental}`);
        assert.deepEqual(parsed.data, input, "the parser preserves the exact Unicode prompt and explicit controls");
      }
    }
  }
  for (const model_id of ["V6", "V6_wild"] as const) {
    assert.equal(schemas.generate.safeParse({ ...common, model_id, is_custom_mode: false, is_instrumental: true,
      prompt: "😀".repeat(250), negative_tags: "n".repeat(5_000), styles: "s".repeat(1_000), title: "t".repeat(80) }).success, true,
      "all source bounds accept exact UTF-16 boundary lengths");
    assert.equal(schemas.generate.safeParse({ ...common, model_id, is_custom_mode: true, is_instrumental: true,
      prompt: "😀".repeat(2_500) }).success, true, "custom prompt accepts exactly 5000 UTF-16 code units");
    assert.equal(schemas.generate.safeParse({ ...common, model_id, is_custom_mode: false, is_instrumental: false,
      prompt: "😀".repeat(251) }).success, false, "simple mode uses its 500 UTF-16 code-unit source bound");
    assert.equal(schemas.generate.safeParse({ ...common, model_id, is_custom_mode: true, is_instrumental: false,
      prompt: "😀".repeat(2_501) }).success, false, "custom mode uses its 5000 UTF-16 code-unit source bound");
  }
  const base = { ...common, model_id: "V6", is_custom_mode: false, is_instrumental: false };
  for (const invalid of [
    { ...base, mode: "cover" }, { ...base, prompt: "   " }, { ...base, prompt: "\uD800" },
    { ...base, title: "x".repeat(81) }, { ...base, styles: "x".repeat(1_001) },
    { ...base, negative_tags: "x".repeat(5_001) }, { ...base, file_urls: [] },
    { ...base, source_clip_id: "clip-1" }, { ...base, version: 2 }, { ...base, hidden: true }
  ]) assert.equal(schemas.generate.safeParse(invalid).success, false, JSON.stringify(Object.keys(invalid)));
  for (const key of ["is_custom_mode", "is_instrumental", "negative_tags", "styles", "title", "prompt"] as const) {
    const missing = { ...base } as Record<string, unknown>;
    delete missing[key];
    assert.equal(schemas.generate.safeParse(missing).success, false, `missing ${key} is not defaulted`);
  }
});

test("Stock SDK default server omits Suno; the genuine service opts in exactly five read/write tools", async () => {
  const module = await import(TOOLS_MODULE_URL) as Record<string, unknown>;
  const application = createDefaultApplication({ discoveryCatalog: CATALOG, runtimeCapabilities: null });
  const defaultServer = createMcpServer(application);
  const defaultPair = InMemoryTransport.createLinkedPair();
  const defaultClient = new Client({ name: "suno-default-server-test", version: "1.0.0" });
  const fixture = await genuineFixture();
  try {
    await defaultServer.connect(defaultPair[1]); await defaultClient.connect(defaultPair[0]);
    const names = (await defaultClient.listTools()).tools.map(({ name }) => name);
    assert.equal(names.some((name) => EXPECTED_NAMES.includes(name as never)), false);
    assert.throws(() => createMcpServer(application, { ownerSunoGeneration: { generationService: fixture.service },
      ownerDurableGeneration: {} as never }), /OWNER_DURABLE_GENERATION_COMPOSITION_CONFLICT/u);
    const connected = await connectTools(module, fixture);
    try {
      const tools = (await connected.client.listTools()).tools;
      assert.deepEqual(tools.map(({ name }) => name), EXPECTED_NAMES);
      const generate = tools.find(({ name }) => name === EXPECTED_NAMES[1]);
      assert.ok(generate);
      assert.equal(Array.isArray((generate.inputSchema as { oneOf?: unknown }).oneOf), true);
      const metadata = await connected.client.callTool({ name: EXPECTED_NAMES[0], arguments: {} });
      assert.equal(metadata.isError, undefined, JSON.stringify(metadata));
      assert.equal((metadata.structuredContent as { runtime_usable: unknown }).runtime_usable, false);
      assert.equal((metadata.structuredContent as { dispatch_allowed: unknown }).dispatch_allowed, false);
      assert.equal((metadata.structuredContent as { backend_acceptance: unknown }).backend_acceptance, "UNPROVEN");
      assert.deepEqual(fixture.counts, { chatCount: 0, postCount: 0, historyGets: 0, resultGets: 0 });
      const register = module.registerSyntxOwnerSunoGenerationTools as (server: McpServer, options: unknown) => void;
      assert.throws(() => register(new McpServer({ name: "forged-suno-test", version: "1.0.0" }), { generationService: {
        async generate() { return {}; }, async reconcile() { return {}; }, async listRecoveries() { return []; },
        async getResultPage() { return {}; }, async invalidateAttempt() {}, async close() {}
      } }), /SUNO_GENERATION_SERVICE_COMPOSITION_INVALID/u, "a structural imitation cannot enable the owner tools");
    } finally { await connected.close(); }
  } finally { await Promise.all([defaultClient.close(), defaultServer.close(), fixture.close()]); }
});

test("Stock SDK dispatches both exact Suno models across every explicit mode-flag combination", async () => {
  const module = await import(TOOLS_MODULE_URL) as Record<string, unknown>;
  const fixture = await genuineFixture();
  const connected = await connectTools(module, fixture);
  try {
    const rejected = await connected.client.callTool({ name: EXPECTED_NAMES[1], arguments: {
      link_attempt_id: ATTEMPT, model_id: "V6", mode: "cover", prompt: "should not dispatch", is_custom_mode: false,
      is_instrumental: false, negative_tags: "", styles: "", title: "invalid", source_clip_id: "foreign"
    } });
    assert.equal(rejected.isError, true);
    assert.equal(fixture.counts.postCount, 0, "invalid/unlisted mode or extra file source is rejected before service dispatch");
    let call = 0;
    const prompts: string[] = [];
    for (const model_id of ["V6", "V6_wild"] as const) for (const is_custom_mode of [false, true]) {
      for (const is_instrumental of [false, true]) {
        call += 1;
        const prompt = `Exact prompt ${model_id} ${is_custom_mode} ${is_instrumental} 🎵`;
        prompts.push(prompt);
        const response = await connected.client.callTool({ name: EXPECTED_NAMES[1], arguments: {
          link_attempt_id: ATTEMPT, model_id, mode: "generate", prompt, is_custom_mode, is_instrumental,
          negative_tags: "noise", styles: "synth-pop", title: `Track ${call}`
        } });
        assert.equal(response.isError, undefined, JSON.stringify({ response, counts: fixture.counts,
          requests: fixture.events.map(({ method, url }) => `${method} ${url.pathname}`) }));
        const result = response.structuredContent as { model_id: string; status_semantics: string; backend_acceptance: string;
          provider_terminal_status: string; artifacts: readonly { url: string }[] };
        assert.equal(result.model_id, model_id);
        assert.equal(result.status_semantics, "LOCAL_OBSERVED_AVAILABILITY_ONLY");
        assert.equal(result.backend_acceptance, "UNPROVEN");
        assert.equal(result.provider_terminal_status, "UNPROVEN");
        assert.equal(result.artifacts.length, 1);
        assert.equal("prompt" in result, false);
        assert.equal("styles" in result, false);
      }
    }
    const posts = fixture.events.filter((event) => event.method === "POST" && event.url.pathname === "/api/v1/audio/generate");
    assert.equal(posts.length, 8);
    assert.deepEqual(posts.map(({ body }) => (body as { prompt: string }).prompt), prompts, "prompt text is forwarded without rewriting");
    assert.deepEqual(posts.map(({ body }) => (body as { settings: Record<string, unknown> }).settings),
      ["V6", "V6", "V6", "V6", "V6_wild", "V6_wild", "V6_wild", "V6_wild"].map((model_type, index) => ({
        model_type, mode: "generate", is_custom_mode: index % 4 >= 2, is_instrumental: index % 2 === 1,
        negative_tags: "noise", styles: "synth-pop", title: `Track ${index + 1}`, file_urls: []
      })));
  } finally { await connected.close(); await fixture.close(); }
});

test("Suno result pages cache eighty audio objects as 64+16 without another upstream read", async () => {
  const module = await import(TOOLS_MODULE_URL) as Record<string, unknown>;
  const fixture = await genuineFixture({ outputCount: 80 });
  const connected = await connectTools(module, fixture);
  try {
    const generated = await connected.client.callTool({ name: EXPECTED_NAMES[1], arguments: {
      link_attempt_id: ATTEMPT, model_id: "V6", mode: "generate", prompt: "Единый трек 🎵",
      is_custom_mode: true, is_instrumental: false, negative_tags: "", styles: "", title: "80 объектов"
    } });
    assert.equal(generated.isError, undefined, JSON.stringify(generated));
    const first = generated.structuredContent as { recovery_id: string; page_size: number; artifacts: readonly unknown[]; has_more: boolean };
    assert.equal(first.page_size, 64); assert.equal(first.artifacts.length, 64); assert.equal(first.has_more, true);
    const beforePage = fixture.counts;
    const next = await connected.client.callTool({ name: EXPECTED_NAMES[4], arguments: {
      link_attempt_id: ATTEMPT, recovery_id: first.recovery_id, offset: 64
    } });
    assert.equal(next.isError, undefined, JSON.stringify(next));
    const second = next.structuredContent as { offset: number; artifacts: readonly unknown[]; has_more: boolean };
    assert.equal(second.offset, 64); assert.equal(second.artifacts.length, 16); assert.equal(second.has_more, false);
    assert.deepEqual(fixture.counts, beforePage, "local paging must not cause an upstream result read");
    assert.equal(fixture.counts.postCount, 1);
    assert.equal(fixture.counts.resultGets, 2, "one native result GET for each observed audio message context");
  } finally { await connected.close(); await fixture.close(); }
});

test("lost Suno POST acknowledgement produces a recovery and reconcile is GET-only without replay", async () => {
  const module = await import(TOOLS_MODULE_URL) as Record<string, unknown>;
  const fixture = await genuineFixture({ loseAck: true });
  const connected = await connectTools(module, fixture);
  try {
    const request = { link_attempt_id: ATTEMPT, model_id: "V6_wild", mode: "generate", prompt: "Потерянный ответ 🎵",
      is_custom_mode: true, is_instrumental: true, negative_tags: "", styles: "ambient", title: "Без повтора" };
    const uncertain = await connected.client.callTool({ name: EXPECTED_NAMES[1], arguments: request });
    assert.equal(uncertain.isError, true);
    const content = (uncertain as unknown as { content: readonly { type: string; text?: string }[] }).content;
    const errorText = content.find((item) => item.type === "text" && typeof item.text === "string");
    assert.ok(errorText?.text);
    const errorPayload = JSON.parse(errorText.text) as { error?: { code?: string; recovery_id?: string } };
    assert.equal(errorPayload.error?.code, "OUTCOME_UNKNOWN");
    assert.match(errorPayload.error?.recovery_id ?? "", /^suno_generation_recovery_[0-9a-f-]{36}$/u);
    assert.equal(fixture.counts.postCount, 1);
    const beforeReconcile = fixture.counts.postCount;
    const reconciled = await connected.client.callTool({ name: EXPECTED_NAMES[2], arguments: {
      link_attempt_id: ATTEMPT, recovery_id: errorPayload.error!.recovery_id!
    } });
    assert.equal(reconciled.isError, undefined, JSON.stringify(reconciled));
    assert.equal((reconciled.structuredContent as { backend_acceptance: string }).backend_acceptance, "UNPROVEN");
    assert.equal(fixture.counts.postCount, beforeReconcile, "reconcile must never replay the single uncertain POST");
    assert.ok(fixture.counts.historyGets > 0);
    assert.equal(fixture.counts.resultGets, 1);
  } finally { await connected.close(); await fixture.close(); }
});

test("zero-ready OBJECT_INCOMPLETE result stays recoverable; list preserves its gap and later GET completes without replay", async () => {
  const module = await import(TOOLS_MODULE_URL) as Record<string, unknown>;
  const fixture = await genuineFixture({ pendingFirstResult: true });
  const connected = await connectTools(module, fixture);
  try {
    const request = { link_attempt_id: ATTEMPT, model_id: "V6", mode: "generate", prompt: "Pending audio object 🎵",
      is_custom_mode: false, is_instrumental: false, negative_tags: "", styles: "", title: "Incomplete until reconcile" };
    const started = await connected.client.callTool({ name: EXPECTED_NAMES[1], arguments: request });
    assert.equal(started.isError, true);
    const startedText = (started as unknown as { content: readonly { type: string; text?: string }[] }).content
      .find((item) => item.type === "text" && typeof item.text === "string")?.text ?? "";
    const startError = JSON.parse(startedText) as { error?: { code?: string; recovery_id?: string } };
    assert.equal(startError.error?.code, "OUTCOME_UNKNOWN");
    assert.match(startError.error?.recovery_id ?? "", /^suno_generation_recovery_[0-9a-f-]{36}$/u);
    assert.equal(fixture.counts.postCount, 1);
    assert.equal(fixture.counts.resultGets, 1);

    const listed = await connected.client.callTool({ name: EXPECTED_NAMES[3], arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(listed.isError, undefined, JSON.stringify(listed));
    const recovery = (listed.structuredContent as { recoveries: readonly { recovery_id: string; status: string;
      observed_artifact_count: number; diagnostic: { gaps: readonly string[]; result_status: string; result_get_calls: number } }[] }).recoveries[0];
    assert.ok(recovery);
    assert.equal(recovery.recovery_id, startError.error?.recovery_id);
    assert.equal(recovery.status, "outcome_unknown");
    assert.equal(recovery.observed_artifact_count, 0, "an incomplete audio object is not misreported as ready");
    assert.equal(recovery.diagnostic.result_status, "PARTIAL");
    assert.equal(recovery.diagnostic.result_get_calls, 1);
    assert.deepEqual(recovery.diagnostic.gaps, ["OBJECT_INCOMPLETE"]);

    const beforeReconcile = fixture.counts;
    const reconciled = await connected.client.callTool({ name: EXPECTED_NAMES[2], arguments: {
      link_attempt_id: ATTEMPT, recovery_id: recovery.recovery_id
    } });
    assert.equal(reconciled.isError, undefined, JSON.stringify(reconciled));
    const result = reconciled.structuredContent as { status: string; artifacts: readonly unknown[]; diagnostic: { gaps: readonly string[] } };
    assert.equal(result.status, "completed");
    assert.equal(result.artifacts.length, 1);
    assert.deepEqual(result.diagnostic.gaps, []);
    assert.equal(fixture.counts.postCount, beforeReconcile.postCount, "late reconcile does not issue a second generation POST");
    assert.equal(fixture.counts.resultGets, beforeReconcile.resultGets + 1, "late reconcile GETs the previously incomplete audio message again");
    assert.ok(fixture.counts.historyGets > beforeReconcile.historyGets, "reconcile rebinds the result through fresh owned history");
  } finally { await connected.close(); await fixture.close(); }
});

test("revoked attempt cannot read cached audio URLs or dispatch again", async () => {
  const module = await import(TOOLS_MODULE_URL) as Record<string, unknown>;
  const fixture = await genuineFixture();
  const connected = await connectTools(module, fixture);
  try {
    const request = { link_attempt_id: ATTEMPT, model_id: "V6", mode: "generate", prompt: "Проверка отзыва 🎵",
      is_custom_mode: true, is_instrumental: false, negative_tags: "", styles: "", title: "Скрытый результат" };
    const generated = await connected.client.callTool({ name: EXPECTED_NAMES[1], arguments: request });
    assert.equal(generated.isError, undefined, JSON.stringify(generated));
    const result = generated.structuredContent as { recovery_id: string; artifacts: readonly { url: string }[] };
    assert.equal(result.artifacts.length, 1);
    const postsBeforeRevoke = fixture.counts.postCount;
    await fixture.linkService.revoke(BINDING, ATTEMPT);
    const read = await connected.client.callTool({ name: EXPECTED_NAMES[4], arguments: {
      link_attempt_id: ATTEMPT, recovery_id: result.recovery_id
    } });
    assert.equal(read.isError, true);
    const readText = (read as unknown as { content: readonly { type: string; text?: string }[] }).content
      .find((item) => item.type === "text" && typeof item.text === "string")?.text ?? "";
    assert.equal(readText.includes("r2.syntx.ai"), false, "revoked owner cannot retrieve a previously cached media URL");
    const replay = await connected.client.callTool({ name: EXPECTED_NAMES[1], arguments: request });
    assert.equal(replay.isError, true);
    assert.equal(fixture.counts.postCount, postsBeforeRevoke, "revoked attempts do not start a new audio POST");
  } finally { await connected.close(); await fixture.close(); }
});

test("output DTO accepts every closed native/service diagnostic gap without suppressing warnings", async () => {
  const module = await import(TOOLS_MODULE_URL) as Record<string, unknown>;
  const schemas = module.OWNER_SUNO_GENERATION_TOOL_OUTPUT_SCHEMAS as {
    generate: { safeParse(value: unknown): { success: boolean; error?: unknown } };
  };
  const gapCodes = [
    "HISTORY_UNVERIFIED", "HISTORY_INCOMPLETE", "HISTORY_EMPTY", "OWNER_ACK_MISSING", "OWNER_ACK_MISMATCH",
    "OWNER_ACK_AMBIGUOUS", "BOT_RESULT_NOT_OBSERVED", "AUDIO_OBJECT_IDS_INVALID", "AUDIO_MODEL_ECHO_MISMATCH",
    "ENVELOPE_SHAPE_INVALID", "OUTER_MESSAGE_ID_MISMATCH", "NOT_BOT_MESSAGE", "PROVIDER_CHAT_ID_MISMATCH",
    "UNRECOGNIZED_MESSAGE_FIELDS", "MESSAGE_OBJECT_ARRAY_INVALID", "MESSAGE_OBJECT_ARRAY_EMPTY", "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT",
    "UNRECOGNIZED_OBJECT_FIELDS", "OBJECT_ENTRY_INVALID", "OBJECT_ID_UNAVAILABLE", "OBJECT_ID_DUPLICATE", "OBJECT_ID_UNEXPECTED",
    "EXPECTED_OBJECT_ID_MISSING", "OBJECT_MESSAGE_ID_MISMATCH", "OBJECT_TYPE_UNSUPPORTED", "OBJECT_INCOMPLETE",
    "OBJECT_COMPLETION_UNKNOWN", "OBJECT_URL_MISSING", "OBJECT_URL_INVALID", "OBJECT_URL_UNSAFE", "MIME_TYPE_UNKNOWN",
    "MODEL_TYPE_UNAVAILABLE", "MODEL_TYPE_MISMATCH", "AUDIO_RESULT_UNVERIFIED", "RESULT_GET_UNAVAILABLE", "RESULT_LIMIT_EXCEEDED"
  ];
  for (const code of gapCodes) {
    const result = { status: "partial_results", status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", backend_acceptance: "UNPROVEN",
      provider_terminal_status: "UNPROVEN", model_id: "V6", parameters: { mode: "generate", is_custom_mode: false, is_instrumental: false },
      source_binding: { public_catalog_version: "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json",
        settings_inventory_version: "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json",
        form_sha256: "sha256:3b4eb9ade783591aaf8087289e29f09c06ee8d54be827395e9d19613c62574b3" },
      cost_inputs: { version: "V6" }, cost_input_confidence: "PUBLIC_VERSION_KEY_LOCAL_PROJECTION_NOT_UI_QUOTE_OR_CAP",
      recovery_id: "suno_generation_recovery_00000000-0000-4000-8000-000000000001", observed_artifact_count: 0,
      offset: 0, page_size: 64, artifacts: [], has_more: false, next_offset: null,
      diagnostic: { phase: "RESULT_BINDING", post_started: true, ack_known: true, history_status: "COMPLETE", owner_ack_status: "MATCHED",
        history_get_calls: 1, result_get_calls: 1, result_status: "PARTIAL", gaps: [code], counters_saturated: false } };
    const parsed = schemas.generate.safeParse(result);
    assert.equal(parsed.success, true, `diagnostic code ${code} remains visible and valid`);
  }
});

test("post-result output validation failure is always OUTCOME_UNKNOWN and uses only a safe own-data recovery id", async () => {
  const module = await import(TOOLS_MODULE_URL) as Record<string, unknown>;
  const convert = module.postResultValidationError as (value: unknown) => { content: readonly { type: string; text?: string }[] };
  assert.equal(typeof convert, "function");
  const recovery_id = "suno_generation_recovery_00000000-0000-4000-8000-000000000001";
  const result = convert({ recovery_id, prompt: "private request text", title: "private title" });
  const textBlock = result.content.find((item) => item.type === "text");
  assert.ok(textBlock?.text);
  const errorPayload = JSON.parse(textBlock.text) as { error?: { code?: string; recovery_id?: string } };
  assert.equal(errorPayload.error?.code, "OUTCOME_UNKNOWN");
  assert.equal(errorPayload.error?.recovery_id, recovery_id);
  assert.equal(textBlock.text.includes("private request text"), false);
  assert.equal(textBlock.text.includes("private title"), false);

  let getterReads = 0;
  const accessorResult: Record<string, unknown> = {};
  Object.defineProperty(accessorResult, "recovery_id", { enumerable: true, get() { getterReads += 1; return recovery_id; } });
  const withoutOwnData = convert(accessorResult);
  const fallbackText = withoutOwnData.content.find((item) => item.type === "text")?.text ?? "";
  assert.equal(JSON.parse(fallbackText).error.code, "OUTCOME_UNKNOWN");
  assert.equal("recovery_id" in JSON.parse(fallbackText).error, false);
  assert.equal(getterReads, 0);
});
