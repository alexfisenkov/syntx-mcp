import assert from "node:assert/strict";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OwnerSoulCharacterCatalogHttpClient } from "../src/adapter/syntx/owner-soul-character-catalog-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OwnerSoulCharacterOptionsService } from "../src/application/owner-soul-character-options-service.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerSoulImageGenerationService } from "../src/application/owner-soul-image-generation-service.js";
import { OwnerSoulImageRequestPreparer } from "../src/application/owner-soul-image-request-preparer.js";
import { OwnerSoulStyleOptionsService } from "../src/application/owner-soul-style-options-service.js";
import { OwnerSoulStyleCatalogHttpClient } from "../src/adapter/syntx/owner-soul-style-catalog-http-client.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient } from "../src/adapter/syntx/http-client.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { syntxPublicCatalogSnapshotSchema } from "../src/catalog/syntx-public-catalog.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuthBinding } from "../src/auth/types.js";
import { loadSelectedDiscoveryCatalog, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import type { RegisterSyntxOwnerSoulImageToolsOptions } from "../src/mcp/owner-soul-image-tools.js";

const TOOLS_URL = new URL("../src/mcp/owner-soul-image-tools.js", import.meta.url).href;
const VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG = loadSelectedDiscoveryCatalog(VERSION).discoveryCatalog;
const REPOSITORY = new DiscoveryCatalogRepository(syntxPublicCatalogSnapshotSchema.parse(JSON.parse(readFileSync(
  join(process.cwd(), "catalog/public", VERSION), "utf8"))));
const BINDING = Object.freeze({ tenant_id: "soul-tools-tenant", subject: "soul-tools-subject" });
const ATTEMPT = "link_soul_tools_00000000000000000001";
const ROWS = [
  { id: "private-record-string", reference_id: "private-reference-string", title: "Completed String", status: "completed" },
  { id: 17, reference_id: 9001, title: "Completed Numeric", status: "completed" },
  { id: "training-row", reference_id: 42, title: "Still Training", status: "in-progress" },
  { id: "missing-row", title: "Missing Reference", status: "queue" }
];

function createGenerationFixture() {
  const binding: AuthBinding = Object.freeze({ tenant_id: "soul-tools-tenant", subject: "soul-tools-subject" });
  let now = Date.parse("2026-10-11T00:00:00.000Z");
  let chats = 0;
  let posts = 0;
  let preflightReads = 0;
  let accountFactories = 0;
  let accessFactories = 0;
  const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return operation("synthetic-soul-generation-credential");
  } };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? "GET";
    if (url.pathname === "/api/v1/user/balance") { preflightReads += 1; return Response.json({ balance: "1000" }); }
    if (url.pathname === "/api/v1/user/subscription") { preflightReads += 1; return Response.json({ active: true, type: "PRO", end_date: "2026-10-12T00:00:00.000Z" }); }
    if (url.pathname === "/api/v2/get_model_info") return Response.json({ access: true, cost: 2, discount_cost: null,
      free_remaining_generations: null, limit: 0.5, show_warning: null });
    if (url.pathname === "/api/v1/chats" && method === "POST") { chats += 1; return Response.json({ uuid: `soul-mcp-chat-${chats}` }); }
    if (url.pathname === "/api/v1/design/generate" && method === "POST") { posts += 1; return Response.json({ id: "soul-mcp-ack" }); }
    if (/^\/api\/v1\/chats\/soul-mcp-chat-\d+\/messages$/u.test(url.pathname)) {
      return Response.json({ messages: [
        { id: "soul-mcp-ack", chat_id: 9001, author_id: 42, message_object: [] },
        { id: "soul-mcp-result", chat_id: 9001, author_id: -1, message_object: [
          { id: 2001, message_id: "soul-mcp-result", object_type: "image", model_type: "higgsfield-soul" }
        ] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    if (/^\/api\/v1\/chats\/soul-mcp-chat-\d+\/soul-mcp-result$/u.test(url.pathname)) {
      return Response.json({ id: "soul-mcp-result", chat_id: 9001, author_id: -1, message_object: [
        { id: 2001, message_id: "soul-mcp-result", object_type: "image", model_type: "higgsfield-soul", completed: true,
          object_url: "https://r2.syntx.ai/soul/mcp-result.png" }
      ] });
    }
    throw new Error(`Unexpected synthetic MCP request: ${method} ${url.pathname}`);
  };
  const links = new PerUserLinkService({} as never, { async getSnapshot(_binding: unknown, attemptId: string) {
    return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
      status: "LINKED" as const, expires_at: null, linked: true };
  } } as never);
  const styleClient = new OwnerSoulStyleCatalogHttpClient({ credentialBroker: broker, fetchImpl });
  const characterClient = new OwnerSoulCharacterCatalogHttpClient({ credentialBroker: broker, fetchImpl });
  const style = new OwnerSoulStyleOptionsService({ binding, linkService: links, catalog: REPOSITORY, catalogVersion: VERSION,
    resolveClient: () => styleClient, now: () => now });
  const character = new OwnerSoulCharacterOptionsService({ binding, linkService: links, catalog: REPOSITORY, catalog_version: VERSION,
    resolveClient: () => characterClient, now: () => now });
  const preparer = new OwnerSoulImageRequestPreparer({ binding, linkService: links, styleOptionsService: style,
    characterOptionsService: character, catalog: REPOSITORY, catalog_version: VERSION, now: () => now });
  const chat = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const readClient = () => new SyntxHttpClient({ credentialBroker: broker, fetchImpl });
  const service = new OwnerSoulImageGenerationService({ binding, linkService: links, catalog: REPOSITORY, catalog_version: VERSION,
    preparer, styleOptionsService: style, characterOptionsService: character, resolveChatClient: () => chat,
    createAccountStatusService: () => { accountFactories += 1; return new AccountStatusService(readClient(), () => now); },
    createModelAccessService: () => { accessFactories += 1; return new ModelAccessService(REPOSITORY, readClient(), () => now); },
    now: () => now, pollDelayMs: 0, maxPollAttempts: 2 });
  return { binding, service, character, get counts() { return { chats, posts, preflightReads, accountFactories, accessFactories }; },
    async close() { await service.close(); } };
}

function createCharacterService(rows: readonly unknown[][] = [ROWS]) {
  let fetchCalls = 0; let credentialCalls = 0;
  const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    credentialCalls += 1; return operation("synthetic-soul-character-tool-credential");
  } };
  const client = new OwnerSoulCharacterCatalogHttpClient({ credentialBroker: broker, fetchImpl: async (input, init) => {
    fetchCalls += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/hf/lora/list");
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    const items = rows[Math.min(fetchCalls - 1, rows.length - 1)] ?? [];
    return Response.json({ items, total: items.length }, { headers: { "content-type": "application/json" } });
  } });
  const linkService = new PerUserLinkService({} as never, { async getSnapshot(_binding: unknown, attemptId: string) {
    return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
      status: "LINKED" as const, expires_at: null, linked: true };
  } } as never);
  const service = new OwnerSoulCharacterOptionsService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: VERSION, resolveClient: () => client, now: () => 10_000 });
  return { service, get fetchCalls() { return fetchCalls; }, get credentialCalls() { return credentialCalls; } };
}

test("exports the strict owner Soul Character-options MCP registration", async () => {
  let module: Record<string, unknown> | undefined;
  try { module = await import(TOOLS_URL) as Record<string, unknown>; } catch { /* Expected initial RED before the tool exists. */ }
  assert.equal(typeof module?.SYNTX_LIST_OWNER_SOUL_CHARACTER_OPTIONS_TOOL_NAME, "string", "MISSING_SOUL_CHARACTER_OPTIONS_TOOL");
  assert.equal(typeof module?.registerSyntxOwnerSoulImageTools, "function", "MISSING_SOUL_IMAGE_TOOL_REGISTRATION");
});

test("lists actual issuer-backed Character handles through one strict SDK read tool without raw IDs", async () => {
  const module = await import(TOOLS_URL) as unknown as {
    SYNTX_LIST_OWNER_SOUL_CHARACTER_OPTIONS_TOOL_NAME: string;
    OWNER_SOUL_IMAGE_TOOL_INPUT_SCHEMAS: { character_options: { safeParse(value: unknown): { success: boolean } } };
    registerSyntxOwnerSoulImageTools(server: McpServer, options: RegisterSyntxOwnerSoulImageToolsOptions): void;
  };
  assert.equal(module.OWNER_SOUL_IMAGE_TOOL_INPUT_SCHEMAS.character_options.safeParse({ link_attempt_id: ATTEMPT }).success, true);
  assert.equal(module.OWNER_SOUL_IMAGE_TOOL_INPUT_SCHEMAS.character_options.safeParse({ link_attempt_id: ATTEMPT,
    reference_id: "private-reference-string" }).success, false);
  const character = createCharacterService();
  const server = new McpServer({ name: "soul-character-tools-test", version: "1.0.0" });
  module.registerSyntxOwnerSoulImageTools(server, { characterOptionsService: character.service });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "soul-character-tools-test", version: "1.0.0" });
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map(({ name }) => name), [module.SYNTX_LIST_OWNER_SOUL_CHARACTER_OPTIONS_TOOL_NAME]);
    assert.equal(tools[0]?.annotations?.readOnlyHint, true);
    const result = await client.callTool({ name: module.SYNTX_LIST_OWNER_SOUL_CHARACTER_OPTIONS_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    const output = result.structuredContent as Record<string, unknown>;
    assert.equal(output.status, "OPTIONS_ISSUED");
    assert.equal(output.model_id, "higgsfield-soul");
    assert.equal(output.generation_allowed, false);
    assert.equal(output.reference_id_type_confidence, "CURRENT_ROW_VALUE_TYPE_ONLY_SERVER_TYPE_UNOBSERVED");
    const options = output.options as Array<Record<string, unknown>>;
    assert.deepEqual(options.map(({ label, status, selectable, reference_id_type }) => [label, status, selectable, reference_id_type]), [
      ["Completed String", "completed", true, "string"], ["Completed Numeric", "completed", true, "number"],
      ["Still Training", "in-progress", false, "number"], ["Missing Reference", "queue", false, "unavailable"]
    ]);
    assert.equal(options.every((option) => option.character_handle === null || /^soul_character_[0-9a-f-]{36}$/u.test(String(option.character_handle))), true);
    const serialized = JSON.stringify(result);
    for (const privateValue of ["private-record-string", "private-reference-string", "9001", "training-row", "missing-row"]) {
      assert.equal(serialized.includes(privateValue), false);
    }
    assert.equal(character.fetchCalls, 1); assert.equal(character.credentialCalls, 1);
  } finally { await Promise.all([client.close(), server.close(), character.service.close()]); }
});

test("an empty actual Character snapshot remains inconclusive and offers no handle", async () => {
  const module = await import(TOOLS_URL) as unknown as {
    SYNTX_LIST_OWNER_SOUL_CHARACTER_OPTIONS_TOOL_NAME: string;
    registerSyntxOwnerSoulImageTools(server: McpServer, options: RegisterSyntxOwnerSoulImageToolsOptions): void;
  };
  const character = createCharacterService([[]]);
  const server = new McpServer({ name: "soul-character-empty-test", version: "1.0.0" });
  module.registerSyntxOwnerSoulImageTools(server, { characterOptionsService: character.service });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "soul-character-empty-test", version: "1.0.0" });
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const result = await client.callTool({ name: module.SYNTX_LIST_OWNER_SOUL_CHARACTER_OPTIONS_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT } });
    const output = result.structuredContent as Record<string, unknown>;
    assert.equal(output.status, "EMPTY_INCONCLUSIVE");
    assert.deepEqual(output.options, []);
    assert.equal(output.generation_allowed, false);
    assert.equal(character.fetchCalls, 1);
  } finally { await Promise.all([client.close(), server.close(), character.service.close()]); }
});

test("registers all four strict tools and routes generation through actual Soul services and two fresh preflights", async () => {
  const module = await import(TOOLS_URL) as unknown as {
    OWNER_SOUL_IMAGE_TOOL_INPUT_SCHEMAS: { generate: { safeParse(value: unknown): { success: boolean } } };
    OWNER_SOUL_IMAGE_TOOL_NAMES: readonly string[];
    registerSyntxOwnerSoulImageTools(server: McpServer, options: RegisterSyntxOwnerSoulImageToolsOptions): void;
  };
  const fixture = createGenerationFixture();
  const server = new McpServer({ name: "soul-generation-tools-test", version: "1.0.0" });
  module.registerSyntxOwnerSoulImageTools(server, { characterOptionsService: fixture.character, generationService: fixture.service });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "soul-generation-tools-test", version: "1.0.0" });
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const listed = (await client.listTools()).tools;
    assert.deepEqual(listed.map(({ name }) => name), module.OWNER_SOUL_IMAGE_TOOL_NAMES);
    assert.equal(module.OWNER_SOUL_IMAGE_TOOL_INPUT_SCHEMAS.generate.safeParse({ link_attempt_id: ATTEMPT,
      prompt: "A portrait", quality: "720p", resolution: "2048x1152", batch_size: 1, enhance_prompt: true, seed: 0,
      style: { kind: "none" }, character: { kind: "none" } }).success, true);
    assert.equal(module.OWNER_SOUL_IMAGE_TOOL_INPUT_SCHEMAS.generate.safeParse({ link_attempt_id: ATTEMPT,
      prompt: "A portrait", quality: "720p", resolution: "2048x1152", batch_size: 1, enhance_prompt: true, seed: 0,
      style: { kind: "none" }, character: { kind: "none" }, n: 4 }).success, false);
    const pairs: readonly (readonly ["720p" | "1080p", string])[] = [
      ["720p", "2048x1152"], ["720p", "1680x1120"], ["720p", "1536x1152"], ["720p", "1536x1536"],
      ["720p", "1152x1536"], ["720p", "1120x1680"], ["720p", "1152x2048"],
      ["1080p", "2048x1152"], ["1080p", "2016x1344"], ["1080p", "2048x1536"], ["1080p", "1536x1536"],
      ["1080p", "1536x2048"], ["1080p", "1344x2016"], ["1080p", "1152x2048"]
    ];
    for (const [quality, resolution] of pairs) for (const batch_size of [1, 4] as const) {
      for (const seed of [null, 0, 2_147_483_647] as const) {
        assert.equal(module.OWNER_SOUL_IMAGE_TOOL_INPUT_SCHEMAS.generate.safeParse({ link_attempt_id: ATTEMPT,
          prompt: "A portrait", quality, resolution, batch_size, enhance_prompt: true, seed,
          style: { kind: "none" }, character: { kind: "none" } }).success, true, `${quality}/${resolution}/${batch_size}/${seed}`);
      }
    }
    for (let step = 0; step <= 10; step += 1) {
      assert.equal(module.OWNER_SOUL_IMAGE_TOOL_INPUT_SCHEMAS.generate.safeParse({ link_attempt_id: ATTEMPT,
        prompt: "A portrait", quality: "720p", resolution: "2048x1152", batch_size: 1, enhance_prompt: false, seed: null,
        style: { kind: "selected", style_handle: "soul_style_00000000-0000-4000-8000-000000000001", strength: step / 10 },
        character: { kind: "selected", character_handle: "soul_character_00000000-0000-4000-8000-000000000002" } }).success, true);
    }
    const result = await client.callTool({ name: "syntx_owner_generate_soul_image", arguments: {
      link_attempt_id: ATTEMPT, prompt: "A quiet portrait in a sunlit room", quality: "720p", resolution: "2048x1152",
      batch_size: 1, enhance_prompt: true, seed: 0, style: { kind: "none" }, character: { kind: "none" }
    } });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    const output = result.structuredContent as Record<string, unknown>;
    assert.equal(output.status, "result_observed");
    assert.equal(output.dispatch_allowed, false);
    assert.equal(output.provider_execution, false);
    assert.equal(output.actual_result_count, 1);
    assert.equal(fixture.counts.accountFactories, 2);
    assert.equal(fixture.counts.accessFactories, 2);
    assert.equal(fixture.counts.preflightReads, 4);
    assert.equal(fixture.counts.chats, 1);
    assert.equal(fixture.counts.posts, 1);
    for (const privateValue of ["soul-mcp-ack", "soul-mcp-chat-1"]) {
      assert.equal(JSON.stringify(result).includes(privateValue), false);
    }
    const recoveries = await client.callTool({ name: "syntx_owner_list_soul_image_recoveries",
      arguments: { link_attempt_id: ATTEMPT, limit: 4 } });
    assert.equal(recoveries.isError, undefined, JSON.stringify(recoveries));
    assert.deepEqual((recoveries.structuredContent as { recoveries: unknown[] }).recoveries, []);
  } finally { await Promise.all([client.close(), server.close(), fixture.close()]); }
});
