import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSyntxOwnerWan25T2vTools } from "../src/mcp/owner-wan25-t2v-tools.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient } from "../src/adapter/syntx/http-client.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { loadOwnerWan25T2vRuntimeCatalog } from "../src/application/owner-wan25-t2v-parameters.js";
import { OwnerWan25T2vGenerationService } from "../src/application/owner-wan25-t2v-generation-service.js";

const ATTEMPT = "link_wan25_2311_0123456789abcdef";
const OUTPUT = "https://r2.syntx.ai/wan25-2311/result.mp4";
let serial = 0;

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" }
});

async function fixture(options: { free?: boolean; secondDenied?: boolean; loseAck?: boolean; pending?: boolean; wrongOwner?: boolean; wrongModel?: boolean } = {}) {
  const binding = { tenant_id: "wan25-2311", subject: `owner-${++serial}` };
  const now = () => Date.parse("2026-10-19T12:00:00.000Z");
  const links = new PerUserLinkService({ authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "wan25-2311", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-wan25-2311-credential" }); return { state: "LINKED" as const }; }
  }, new InMemoryAuthLinkStore(now), { now, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(binding); await links.issueHandoff(binding, ATTEMPT); await links.checkAttempt(binding, ATTEMPT);
  const stats = { chats: 0, posts: 0, quotes: 0, histories: 0, results: 0, balances: 0, subscriptions: 0 };
  let request: Record<string, unknown> | undefined, ready = !options.pending;
  const owner = () => ({ id: "owner-wan25-2311", chat_id: "provider-wan25-2311", author_id: options.wrongOwner ? -1 : 17,
    message_object: [{ id: "prompt-wan25-2311", message_id: "owner-wan25-2311", object_type: "text", object_text: request?.prompt }] });
  const bot = () => ({ id: "bot-wan25-2311", chat_id: "provider-wan25-2311", author_id: -1,
    message_object: [{ id: "video-wan25-2311", message_id: "bot-wan25-2311", object_type: "video", object_url: OUTPUT,
      model_type: options.wrongModel ? "other-model" : "wan_25_t2v_preview", completed: true }] });
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.syntx.ai");
    if (url.pathname.endsWith("user/balance")) { stats.balances++; return json({ balance: "10.25" }); }
    if (url.pathname.endsWith("user/subscription")) { stats.subscriptions++; return json({ active: true, type: options.free ? "FREE" : "PRO", end_date: "2099-01-01" }); }
    if (url.pathname.endsWith("get_model_info")) {
      stats.quotes++;
      assert.equal(url.searchParams.get("model_type"), "wan_25_t2v_preview");
      assert.equal(url.searchParams.get("ai_name"), "wan_video");
      assert.equal(url.searchParams.get("resolution"), "720P");
      assert.equal(url.searchParams.get("video_duration"), "5");
      assert.deepEqual([...url.searchParams.keys()].sort(), ["ai_name", "model_type", "resolution", "video_duration"]);
      return json({ access: !(options.secondDenied && stats.quotes === 2), cost: 0.2, discount_cost: null,
        free_remaining_generations: 0, limit: null, show_warning: false });
    }
    if (url.pathname === "/api/v1/chats") { stats.chats++; assert.equal(JSON.parse(String(init.body)).scope, "video"); return json({ uuid: "wan25chat2311" }); }
    if (url.pathname.endsWith("video/generate")) {
      stats.posts++; request = JSON.parse(String(init.body)) as Record<string, unknown>;
      assert.equal(url.searchParams.get("ai_name"), "wan_video");
      assert.deepEqual(request, { chat_id: "wan25chat2311", prompt: "Synthetic Wan 2.5 test", settings: {
        model_type: "wan_25_t2v_preview", resolution: "720P", aspect_ratio: "16:9", video_duration: 5,
        prompt_extend: true, seed: null, file_urls: []
      } });
      if (options.loseAck) throw new Error("synthetic lost ACK");
      return json({ id: "owner-wan25-2311" });
    }
    if (url.pathname.endsWith("wan25chat2311/messages")) {
      stats.histories++; const messages = [owner(), ...(ready ? [bot()] : [])];
      return json({ messages, pagination: { page: 1, page_size: 10, total_count: messages.length, total_pages: 1, has_next: false, has_previous: false } });
    }
    if (url.pathname.endsWith("wan25chat2311/bot-wan25-2311")) { stats.results++; return json(bot()); }
    throw new Error("Unexpected synthetic route");
  };
  const credentialBroker = { async useCredential<T>(use: (token: string) => Promise<T>): Promise<T> {
    return links.useCredential(binding, ATTEMPT, credential => use(credential.value));
  } };
  const client = new SyntxChatHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 1000 });
  const createReadClient = () => new SyntxHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 1000 });
  const { catalog } = loadOwnerWan25T2vRuntimeCatalog();
  const service = new OwnerWan25T2vGenerationService({ binding, linkService: links, catalog,
    resolveChatClient: () => client, createReadClient, now });
  return { service, stats, ready() { ready = true; }, async close() { await service.close(); } };
}

test("2311 exact Wan 2.5 T2V request performs two quotes, one GEN, owned GET and returns one video", async () => {
  const env = await fixture();
  try {
    const result = await env.service.generate({ attemptId: ATTEMPT, model_id: "wan_25_t2v_preview", prompt: "Synthetic Wan 2.5 test",
      resolution: "720P", aspect_ratio: "16:9", video_duration: 5, prompt_extend: true, seed: null });
    assert.equal(result.status, "completed");
    assert.equal(result.artifacts[0]?.object_url, OUTPUT);
    assert.equal(result.cost_cap_enforced, false);
    assert.deepEqual(env.stats, { chats: 1, posts: 1, quotes: 2, histories: 1, results: 1, balances: 2, subscriptions: 2 });
    await assert.rejects(env.service.generate({ attemptId: ATTEMPT, model_id: "wan_25_t2v_preview", prompt: "Synthetic Wan 2.5 test",
      resolution: "720P", aspect_ratio: "16:9", video_duration: 5, prompt_extend: true, seed: null }), { code: "INTENT_ALREADY_CLAIMED" });
    assert.equal(env.stats.posts, 1);
  } finally { await env.close(); }
});

test("2311 uncertain dispatch and pending/invalid result remain GET-only", async () => {
  for (const options of [{ loseAck: true }, { pending: true }, { wrongOwner: true }, { wrongModel: true }, { secondDenied: true }, { free: true }]) {
    const env = await fixture(options);
    try {
      const input = { attemptId: ATTEMPT, model_id: "wan_25_t2v_preview", prompt: "Synthetic Wan 2.5 test",
        resolution: "720P", aspect_ratio: "16:9", video_duration: 5, prompt_extend: true, seed: null } as const;
      if (options.free || options.secondDenied) {
        await assert.rejects(env.service.generate(input));
        assert.equal(env.stats.posts, 0);
      } else {
        const result = await env.service.generate(input);
        assert.equal(result.status, "outcome_unknown");
        assert.equal(result.artifacts.length, 0);
        env.ready();
        await env.service.reconcile({ attemptId: ATTEMPT, recovery_id: result.recovery_id });
        assert.equal(env.stats.posts, 1);
      }
    } finally { await env.close(); }
  }
});

test("2311 genuine MCP SDK drives the WAN25 service to one video and refuses media extras", async () => {
  const env = await fixture();
  const server = new McpServer({name:"wan25-sdk-2311",version:"1"});
  registerSyntxOwnerWan25T2vTools(server,{generationService:env.service});
  const client = new Client({name:"wan25-sdk-client-2311",version:"1"});
  const [caller,host] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(host); await client.connect(caller);
    assert.equal((await client.listTools()).tools.length,3);
    const args = {link_attempt_id:ATTEMPT,model_id:"wan_25_t2v_preview",prompt:"Synthetic Wan 2.5 test",
      resolution:"720P",aspect_ratio:"16:9",video_duration:5,prompt_extend:true,seed:null};
    const result = await client.callTool({name:"syntx_owner_generate_wan25_t2v_video",arguments:args});
    assert.notEqual(result.isError,true); assert.equal((result.structuredContent as Record<string,unknown> | undefined)?.status,"completed");
    assert.equal(env.stats.posts,1);
    const invalid = await client.callTool({name:"syntx_owner_generate_wan25_t2v_video",arguments:{...args,audio:"forbidden"}});
    assert.equal(invalid.isError,true); assert.equal(env.stats.posts,1);
  } finally { await client.close(); await server.close(); await env.close(); }
});
