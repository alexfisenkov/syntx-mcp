import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerWanT2vGenerationService } from "../src/application/owner-wan-t2v-generation-service.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthBinding } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { OWNER_WAN_T2V_TOOL_INPUT_SCHEMAS, registerSyntxOwnerWanT2vVideoTools } from "../src/mcp/owner-wan-t2v-video-tools.js";

const LEGACY_CATALOG_VERSION = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json";
const CANONICAL_CATALOG_DIRECTORY = fileURLToPath(new URL("../../catalog", import.meta.url));
const LEGACY_CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(LEGACY_CATALOG_VERSION, CANONICAL_CATALOG_DIRECTORY));
const BINDING: AuthBinding = Object.freeze({ tenant_id: "wan30-flow-1809-tenant", subject: "wan30-flow-1809-owner" });
const ATTEMPT = "link_wan30_t2v_flow_1809_000000000001";
const PROMPT = "A blue glass cube rests on a white surface, steady studio light.";
const PARAMETERS = Object.freeze({
  resolution: "480P", aspect_ratio: "16:9", video_duration: 2,
  prompt_extend: true, seed: null, native_audio: false, rendering_speed: "basic"
});

function fixture(catalogDirectory = CANONICAL_CATALOG_DIRECTORY) {
  let now = Date.parse("2026-10-16T00:00:00.000Z");
  const events: Array<{ method: string; url: URL; body: unknown }> = [];
  const counts = { chats: 0, posts: 0, modelInfoReads: 0, accountReads: 0, historyGets: 0, resultGets: 0 };
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("synthetic-wan30-t2v-flow-1809-credential");
    }
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    events.push({ method, url, body });
    if (url.pathname === "/api/v1/user/balance") {
      counts.accountReads += 1;
      return Response.json({ balance: "1000" });
    }
    if (url.pathname === "/api/v1/user/subscription") {
      counts.accountReads += 1;
      return Response.json({ active: true, type: "PRO", end_date: "2026-10-17T00:00:00.000Z" });
    }
    if (url.pathname === "/api/v2/get_model_info") {
      counts.modelInfoReads += 1;
      return Response.json({ access: true, cost: 7, discount_cost: null,
        free_remaining_generations: null, limit: null, show_warning: null });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      counts.chats += 1;
      return Response.json({ uuid: `wan30-flow-1809-chat-${counts.chats}` });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      counts.posts += 1;
      return Response.json({ id: 41001 });
    }
    const history = /^\/api\/v1\/chats\/(wan30-flow-1809-chat-\d+)\/messages$/u.exec(url.pathname);
    if (history) {
      counts.historyGets += 1;
      return Response.json({ messages: [
        { id: 41001, chat_id: 912345, author_id: 8123, message_object: [] },
        { id: 41002, chat_id: 912345, author_id: -1,
          message_object: [{ id: 51002, message_id: 41002, object_type: "video", model_type: "wan_30_t2v" }] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    if (url.pathname === "/api/v1/chats/wan30-flow-1809-chat-1/41002") {
      counts.resultGets += 1;
      return Response.json({ id: 41002, chat_id: 912345, author_id: -1,
        message_object: [{ id: 51002, message_id: 41002, object_type: "video", model_type: "wan_30_t2v",
          completed: true, object_url: "https://r2.syntx.ai/generated/wan30-flow-1809.mp4" }] });
    }
    if (url.pathname.endsWith("/inprogress")) return Response.json([]);
    throw new Error(`Unexpected synthetic HTTP request ${method} ${url.pathname}`);
  };
  const linkService = new PerUserLinkService({} as never, {
    async getSnapshot(_binding: unknown, attemptId: string) {
      return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
        status: "LINKED" as const, expires_at: null, linked: true };
    }
  } as never);
  const chatClient = new SyntxChatHttpClient({ credentialBroker, fetchImpl, maxResponseBytes: 1024 * 1024 });
  const generationService = new OwnerWanT2vGenerationService({
    binding: BINDING, linkService, catalog: LEGACY_CATALOG, catalog_version: LEGACY_CATALOG_VERSION,
    catalogDirectory,
    resolveChatClient: () => chatClient,
    createAccountStatusService: () => new AccountStatusService(new SyntxHttpClient({ credentialBroker, fetchImpl }), () => now),
    createModelAccessService: (_attemptId: string, catalog = LEGACY_CATALOG) =>
      new ModelAccessService(catalog, new SyntxHttpClient({ credentialBroker, fetchImpl }), () => now),
    now: () => now, pollDelayMs: 0, maxPollAttempts: 1
  });
  return { generationService, events, counts, advance(ms: number) { now += ms; } };
}

test("WAN 3.0 T2V tool binds current catalog, performs two fresh preflights, and emits the observed settings once", async () => {
  const generateSchema = OWNER_WAN_T2V_TOOL_INPUT_SCHEMAS.generate;
  const legacy26 = { link_attempt_id: ATTEMPT, model_id: "wan_26_t2v", prompt: PROMPT, parameters: {
    resolution: "720P", aspect_ratio: "16:9", video_duration: 5, prompt_extend: true, seed: null, shot_type: "single"
  } };
  const legacy27 = { link_attempt_id: ATTEMPT, model_id: "wan_27_t2v", prompt: PROMPT, parameters: {
    resolution: "1080P", aspect_ratio: "3:4", video_duration: 15, prompt_extend: true, seed: null, native_audio: false
  } };
  assert.equal(generateSchema.safeParse(legacy26).success, true, "the original explicit 26 branch remains accepted");
  assert.equal(generateSchema.safeParse(legacy27).success, true, "the original explicit 27 branch remains accepted");
  assert.equal(generateSchema.safeParse({ ...legacy26, parameters: { ...legacy26.parameters, resolution: "480P" } }).success, false,
    "adding 30 controls must not widen the exact legacy 26 branch");
  assert.equal(generateSchema.safeParse({ ...legacy27, parameters: { ...legacy27.parameters, video_duration: 16 } }).success, false,
    "adding the 30-second control must not widen the exact legacy 27 duration bound");
  const f = fixture();
  const server = new McpServer({ name: "wan30-t2v-flow-1809", version: "1.0.0" });
  registerSyntxOwnerWanT2vVideoTools(server, { generationService: f.generationService });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "wan30-t2v-flow-1809-client", version: "1.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const source = await client.callTool({ name: "syntx_get_wan_t2v_parameters", arguments: { model_id: "wan_30_t2v" } });
    assert.equal(source.isError, undefined, JSON.stringify(source));
    assert.equal((source.structuredContent as { profile_id?: unknown }).profile_id, "owner-wan30-t2v-web-request-observed-1807");
    assert.equal((source.structuredContent as { dispatch_allowed?: unknown }).dispatch_allowed, false);
    assert.equal(f.events.length, 0, "parameter read is local and performs no request");

    const result = await client.callTool({ name: "syntx_owner_generate_wan_t2v_video", arguments: {
      link_attempt_id: ATTEMPT, model_id: "wan_30_t2v", prompt: PROMPT, parameters: PARAMETERS
    } });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    const output = result.structuredContent as { model_id: string; status: string; backend_acceptance: string;
      provider_terminal_status: string; observed_artifact_count: number; cost_inputs: Record<string, unknown> };
    assert.equal(output.model_id, "wan_30_t2v");
    assert.equal(output.status, "completed");
    assert.equal(output.backend_acceptance, "UNPROVEN");
    assert.equal(output.provider_terminal_status, "UNPROVEN");
    assert.equal(output.observed_artifact_count, 1);
    assert.deepEqual(output.cost_inputs, { resolution: "480P", video_duration: 2, duration: 0, rendering_speed: "basic" });

    assert.equal(f.counts.chats, 1);
    assert.equal(f.counts.posts, 1);
    assert.equal(f.counts.accountReads, 4, "balance and subscription are freshly read before chat and before POST");
    assert.equal(f.counts.modelInfoReads, 2, "current 19C model access and finite quote are freshly read twice");
    assert.equal(f.counts.historyGets, 1);
    assert.equal(f.counts.resultGets, 1);
    const costReads = f.events.filter((event) => event.url.pathname === "/api/v2/get_model_info");
    assert.equal(costReads.length, 2);
    for (const read of costReads) {
      assert.equal(read.url.searchParams.get("ai_name"), "wan_video");
      assert.equal(read.url.searchParams.get("model_type"), "wan_30_t2v");
      assert.equal(read.url.searchParams.get("resolution"), "480P");
      assert.equal(read.url.searchParams.get("video_duration"), "2");
      assert.equal(read.url.searchParams.get("duration"), "0");
      assert.equal(read.url.searchParams.get("rendering_speed"), "basic");
    }
    const posts = f.events.filter((event) => event.method === "POST" && event.url.pathname === "/api/v1/video/generate");
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.url.searchParams.get("ai_name"), "wan_video");
    assert.deepEqual(posts[0]?.body, { chat_id: "wan30-flow-1809-chat-1", prompt: PROMPT, settings: {
      model_type: "wan_30_t2v", file_urls: [], aspect_ratio: "16:9", resolution: "480P", video_duration: 2,
      prompt_extend: true, shot_type: "single", audio_setting: "auto", seed: null, native_audio: false,
      duration: 0, rendering_speed: "basic"
    } });
  } finally {
    await Promise.all([client.close(), server.close(), f.generationService.close()]);
  }
});

test("WAN 3.0 fails closed when the explicit operator catalog directory lacks pinned 19C", async () => {
  const f = fixture(join(CANONICAL_CATALOG_DIRECTORY, "public"));
  try {
    await assert.rejects(f.generationService.generate({ attemptId: ATTEMPT, input: {
      model_id: "wan_30_t2v", prompt: PROMPT, parameters: PARAMETERS
    } }), (error: unknown) => error instanceof Error &&
      (error as { code?: unknown }).code === "MODEL_BINDING_MISMATCH");
    assert.equal(f.events.length, 0, "a missing pinned 19C archive must not fall back to another catalog or access HTTP");
  } finally { await f.generationService.close(); }
});
