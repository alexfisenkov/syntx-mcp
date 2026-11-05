import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerWanT2vGenerationService } from "../src/application/owner-wan-t2v-generation-service.js";
import { normalizeOwnerWan30T2vGenerationIntent, prepareOwnerWan30T2vGenerationWireCandidate } from "../src/application/owner-wan30-t2v-generation-parameters.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthBinding } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { registerSyntxOwnerWanT2vVideoTools } from "../src/mcp/owner-wan-t2v-video-tools.js";

const LEGACY_CATALOG_VERSION = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json";
const CANONICAL_CATALOG_DIRECTORY = fileURLToPath(new URL("../../catalog", import.meta.url));
const LEGACY_CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(LEGACY_CATALOG_VERSION, CANONICAL_CATALOG_DIRECTORY));
const BINDING: AuthBinding = Object.freeze({ tenant_id: "wan30-flow-1809-tenant", subject: "wan30-flow-1809-owner" });
const ATTEMPT = "link_wan30_t2v_flow_1809_000000000001";
const PROMPT = "A blue glass cube rests on a white surface, steady studio light.";
const PARAMETERS = Object.freeze({
  resolution: "480P", aspect_ratio: "adaptive", video_duration: 2,
  prompt_extend: true, seed: null, native_audio: false, rendering_speed: "basic"
});

function fixture(catalogDirectory = CANONICAL_CATALOG_DIRECTORY, pending = false) {
  let now = Date.parse("2026-10-16T00:00:00.000Z");
  let ready = !pending;
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
      const messages = [
        { id: 41001, chat_id: 912345, author_id: 8123, message_object: [] },
        { id: 41002, chat_id: 912345, author_id: -1,
          message_object: [{ id: 51002, message_id: 41002, object_type: "video", model_type: "wan_30_t2v" }] }
      ]; if (!ready) messages.pop();
      return Response.json({ messages, pagination: { page: 1, page_size: 10, total_count: messages.length, total_pages: 1, has_next: false, has_previous: false } });
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
  return { generationService, events, counts, ready() { ready = true; }, advance(ms: number) { now += ms; } };
}


test("current adaptive source is separate and is carried literally through current-catalog quote and wire", async () => {
 const normalized=normalizeOwnerWan30T2vGenerationIntent({prompt:PROMPT,parameters:PARAMETERS});
 assert.equal(normalized.status,"FORM_SOURCE_REVIEWED_EXPLICIT_INTENT");
 assert.equal(normalized.source_profile_id,"owner-wan30-t2v-adaptive-current-source-v1");
 const projected=prepareOwnerWan30T2vGenerationWireCandidate(normalized.intent);
 assert.equal(projected.settings_candidate.aspect_ratio,"adaptive"); assert.equal(projected.profile_id,normalized.source_profile_id);
 const f=fixture(),server=new McpServer({name:"wan30-adaptive",version:"1"});registerSyntxOwnerWanT2vVideoTools(server,{generationService:f.generationService});
 const [caller,host]=InMemoryTransport.createLinkedPair();const client=new Client({name:"wan30-adaptive",version:"1"});
 try {await server.connect(host);await client.connect(caller); await client.listTools();
 const source=await client.callTool({name:"syntx_get_wan_t2v_parameters",arguments:{model_id:"wan_30_t2v"}});
 assert.equal(source.isError,undefined,JSON.stringify(source));const s=source.structuredContent as {profile_id:string;current_adaptive_source:{status:string}};
 assert.equal(s.profile_id,"owner-wan30-t2v-web-request-observed-1807");assert.equal(s.current_adaptive_source.status,"FORM_SOURCE_REVIEWED_NOT_UI_OR_PROVIDER_OBSERVED");
 const result=await client.callTool({name:"syntx_owner_generate_wan_t2v_video",arguments:{link_attempt_id:ATTEMPT,model_id:"wan_30_t2v",prompt:PROMPT,parameters:PARAMETERS}});
 assert.equal(result.isError,undefined,JSON.stringify(result));assert.equal((result.structuredContent as {status:string}).status,"completed");
 const body=f.events.find(x=>x.method==="POST"&&x.url.pathname==="/api/v1/video/generate")?.body as {settings:{aspect_ratio:string}};
 assert.equal(body.settings.aspect_ratio,"adaptive");assert.equal(f.counts.modelInfoReads,2);assert.equal(f.counts.posts,1);
 } finally {await Promise.all([client.close(),server.close(),f.generationService.close()]);}
});

test("adaptive recovery uses GET-only reads and does not replay dispatch", async () => {
 const f=fixture(CANONICAL_CATALOG_DIRECTORY,true);
 try {
   const error=await f.generationService.generate({attemptId:ATTEMPT,input:{model_id:"wan_30_t2v",prompt:PROMPT,parameters:PARAMETERS}}).catch(e=>e);
   assert.equal(error.code,"OUTCOME_UNKNOWN"); assert.ok(error.recovery_id); const posts=f.counts.posts;
   f.ready();const result=await f.generationService.reconcile({attemptId:ATTEMPT,recovery_id:error.recovery_id});
   assert.equal(result.status,"completed"); assert.equal(f.counts.posts,posts); assert.equal(posts,1);
 } finally {await f.generationService.close();}
});
