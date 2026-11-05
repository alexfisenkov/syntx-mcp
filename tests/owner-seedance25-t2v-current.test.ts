import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE } from "../src/auth/types.js";
import type { AuthBinding, AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxSubscription } from "../src/adapter/syntx/account-decoder.js";
import type { ModelAccessResult } from "../src/application/model-access.js";
import { OwnerSeedance25T2vGenerationService } from "../src/application/owner-reviewed-no-reference-t2v-service.js";
import { createOwnerSeedance25CurrentProfile, SEEDANCE25_CURRENT_VARIANT } from "../src/application/owner-seedance25-t2v-current-profile.js";
import { createOwnerSeedance25T2vProfile } from "../src/application/owner-seedance25-t2v-profile.js";
import { OWNER_SEEDANCE25_T2V_TOOL_NAMES, registerSyntxOwnerSeedance25T2vTools } from "../src/mcp/owner-seedance25-t2v-tools.js";

const ATTEMPT_ID = "link_seedance25_t2v2348_owner_0123456789abcdef";
const AUTH_BINDING: AuthBinding = Object.freeze({ tenant_id: "seedance25-t2v2348", subject: "source-bound-owner" });
const OUTPUT_URL = "https://r2.syntx.ai/seedance25-t2v2348/result.mp4";
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });

async function fixture(options: { denyCurrent?: boolean; staleCurrent?: boolean; pending?: boolean } = {}) {
  let now = Date.parse("2026-10-19T15:00:00.000Z"), chatCount = 0, postCount = 0, uploadCount = 0;
  let ready = !options.pending;
  const store = new InMemoryAuthLinkStore(() => now);
  const provider: AuthLinkProvider = { authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "seedance25-t2v2348", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-seedance25-t2v2348" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(provider, store, { now: () => now, attemptIdGenerator: () => ATTEMPT_ID });
  await links.createAttempt(AUTH_BINDING); await links.issueHandoff(AUTH_BINDING, ATTEMPT_ID); await links.checkAttempt(AUTH_BINDING, ATTEMPT_ID);
  const requests: Array<{ url: URL; method: string; body: unknown }> = [];
  const accessParameters: Array<Readonly<Record<string, unknown>>> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)), method = init?.method ?? "GET";
    const body = init?.body === undefined ? null : JSON.parse(String(init.body)) as unknown;
    requests.push({ url, method, body });
    if (url.pathname === "/api/v1/chats" && method === "POST") { chatCount++; return json({ uuid: `seedance25-chat-${chatCount}` }); }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") { postCount++; return json({ id: `seedance25-echo-${postCount}` }); }
    if (url.pathname === "/api/v1/chats/seedance25-chat-1/inprogress" && method === "GET") {
      return json(ready ? [{ message_id: "seedance25-bot-1", object_type: "video", model_type: "seedance-2.5" }] : []);
    }
    if (url.pathname === "/api/v1/chats/seedance25-chat-1/messages" && method === "GET") {
      const messages = [
        { id: "seedance25-echo-1", chat_id: 725, author_id: 21_234, message_object: [] },
        { id: "seedance25-bot-1", chat_id: 725, author_id: -1, message_object: [{ id: "seedance25-video-1", message_id: "seedance25-bot-1",
          object_type: "video", model_type: "seedance-2.5", completed: true, object_url: OUTPUT_URL }] }
      ];
      if (!ready) messages.pop();
      return json({ messages, pagination: { page: 1, page_size: 10, total_count: messages.length, total_pages: 1,
        has_next: false, has_previous: false } });
    }
    if (url.pathname === "/api/v1/chats/seedance25-chat-1/seedance25-echo-1" && method === "GET") {
      return json({ id: "seedance25-echo-1", chat_id: 725, author_id: 21_234, message_object: [] });
    }
    if (url.pathname === "/api/v1/chats/seedance25-chat-1/seedance25-bot-1" && method === "GET") {
      return json({ id: "seedance25-bot-1", chat_id: 725, author_id: -1, message_object: [{ id: "seedance25-video-1",
        message_id: "seedance25-bot-1", object_type: "video", model_type: "seedance-2.5", completed: true, object_url: OUTPUT_URL }] });
    }
    if (url.pathname.includes("upload-files")) { uploadCount++; throw new Error("no-media T2V must not upload"); }
    throw new Error(`Unexpected synthetic route ${method} ${url.pathname}`);
  };
  const profile = createOwnerSeedance25T2vProfile(resolve(process.cwd(), "catalog"));
  const service = new OwnerSeedance25T2vGenerationService({ profile, binding: AUTH_BINDING, linkService: links,
    resolveSubscription: async (): Promise<SyntxSubscription> => { now += 1_000; return { active: true, plan_type: "PAID", end_date: null, end_date_kind: null }; },
    resolveModelAccess: async (_attempt, modelId, costParameters): Promise<ModelAccessResult> => {
      now += 1_000; accessParameters.push(Object.freeze({ ...costParameters }));
      return { catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT", catalog_version: `${profile.catalog.fetched_at}.${profile.catalog.source_hashes.models.slice(7, 19)}`,
        model_id: "seedance-2.5", ai_name: "seedance", model_type: modelId, account_read_live: true,
        parameter_keys: Object.keys(costParameters).sort(), parameters_redacted: true, access: true, cost: null,
        discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false, observed_at: new Date(now).toISOString() };
    },
    resolveCurrentModelAccess: async (_attempt, modelId, costParameters): Promise<ModelAccessResult> => {
      const current = createOwnerSeedance25CurrentProfile(); now += 1_000; accessParameters.push(Object.freeze({ ...costParameters }));
      return { catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT", catalog_version: options.staleCurrent ? profile.registry.catalog_version : current.registry.catalog_version,
        model_id: "seedance-2.5", ai_name: "seedance", model_type: modelId, account_read_live: true,
        parameter_keys: Object.keys(costParameters).sort(), parameters_redacted: true, access: !options.denyCurrent, cost: null,
        discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false, observed_at: new Date(now).toISOString() };
    },
    resolveChatClient: () => new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
      return operation("synthetic-seedance25-t2v2348");
    } }, fetchImpl, requestTimeoutMs: 1_000 }), now: () => now, wait: async () => { now += 1000; }, videoTimeoutMs: 20
  });
  return { profile, service, requests, accessParameters, counts: () => ({ chatCount, postCount, uploadCount }), ready: () => {ready = true;}, close: () => service.close() };
}


test("current Seedance 2.5 source exposes finite nondefault controls and preserves old tuple", async () => {
  const state = await fixture(), server = new McpServer({name:"seedance25-current",version:"1"});
  registerSyntxOwnerSeedance25T2vTools(server,{service:state.service});
  const client = new Client({name:"seedance25-current-client",version:"1"}), [caller,host]=InMemoryTransport.createLinkedPair();
  try {
    await server.connect(host); await client.connect(caller);
    const foreign=await client.callTool({name:OWNER_SEEDANCE25_T2V_TOOL_NAMES[1],arguments:{link_attempt_id:ATTEMPT_ID,
      prompt:"Animate <<<https://example.invalid/foreign.png>>>",resolution:"1080p",aspect_ratio:"9:16",video_duration:6,generate_audio:false}});
    assert.equal(foreign.isError,true);assert.deepEqual(state.counts(),{chatCount:0,postCount:0,uploadCount:0});
    const source=await client.callTool({name:OWNER_SEEDANCE25_T2V_TOOL_NAMES[0],arguments:{}});
    const current=(source.structuredContent as {current_controls:{source_build_id:string; backend_acceptance:string}}).current_controls;
    assert.equal(current.source_build_id,"1793890358"); assert.equal(current.backend_acceptance,"UNPROVEN");
    const generated=await client.callTool({name:OWNER_SEEDANCE25_T2V_TOOL_NAMES[1],arguments:{link_attempt_id:ATTEMPT_ID,
      prompt:"A quiet scene.",resolution:"1080p",aspect_ratio:"9:16",video_duration:6,generate_audio:false}});
    assert.equal(generated.isError,undefined,JSON.stringify(generated));
    assert.equal((generated.structuredContent as {variant_id:string}).variant_id,SEEDANCE25_CURRENT_VARIANT);
    assert.deepEqual(state.accessParameters,[{video_duration:6,duration:0,mode:"omni-references",size:"9:16",resolution:"1080p"},
      {video_duration:6,duration:0,mode:"omni-references",size:"9:16",resolution:"1080p"}]);
    const post=state.requests.find(x=>x.method==="POST"&&x.url.pathname==="/api/v1/video/generate");
    assert.deepEqual(post?.body,{chat_id:"seedance25-chat-1",prompt:"A quiet scene.",settings:{file_urls:[],model_type:"seedance-2.5",
      resolution:"1080p",mode:"omni-references",aspect_ratio:"9:16",video_duration:6,generate_audio:false}});
    assert.deepEqual(state.counts(),{chatCount:1,postCount:1,uploadCount:0});
  } finally {await client.close();await server.close();await state.close();}
});

test("current profile recovery uses the correct engine and never repeats POST", async () => {
  const state = await fixture({pending:true});
  try {
    const error = await state.service.generate({attemptId:ATTEMPT_ID,prompt:"test",resolution:"1080p",aspect_ratio:"9:16",video_duration:6,generate_audio:false}).catch(e => e);
    assert.equal(error.code,"OUTCOME_UNKNOWN"); assert.ok(error.recovery_id);
    const list = state.service.listRecoveries(ATTEMPT_ID); assert.equal(list.length,1); assert.equal(list[0]!.variant_id,SEEDANCE25_CURRENT_VARIANT);
    state.ready(); const result = await state.service.reconcile({attemptId:ATTEMPT_ID,recovery_id:error.recovery_id});
    assert.equal(result.variant_id,SEEDANCE25_CURRENT_VARIANT); assert.equal(state.counts().postCount,1);
  } finally { await state.close(); }
});

test("current profile admits source boundaries and rejects other durations", () => {
  const p=createOwnerSeedance25CurrentProfile();
  for(const video_duration of [0,4,30]) assert.equal(p.normalizeGenerationInput({attemptId:ATTEMPT_ID,prompt:"test",resolution:"480p",
    aspect_ratio:"adaptive",video_duration,generate_audio:false}).parameters.video_duration,video_duration);
  for(const video_duration of [1,3,31,4.5]) assert.throws(()=>p.normalizeGenerationInput({attemptId:ATTEMPT_ID,prompt:"test",resolution:"480p",
    aspect_ratio:"adaptive",video_duration,generate_audio:false}));
});

test("current profile denies stale catalog identity or unavailable model access before POST", async () => {
  for (const options of [{denyCurrent:true},{staleCurrent:true}]) {
    const state=await fixture(options);
    try {
      await assert.rejects(state.service.generate({attemptId:ATTEMPT_ID,prompt:"test",resolution:"1080p",aspect_ratio:"9:16",video_duration:6,generate_audio:false}),
        {code:"MODEL_ACCESS_UNAVAILABLE"});
      assert.deepEqual(state.counts(),{chatCount:0,postCount:0,uploadCount:0});
    } finally {await state.close();}
  }
});
