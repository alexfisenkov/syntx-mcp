import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {registerSyntxOwnerSeedance20T2vTools} from "../src/mcp/owner-seedance20-t2v-tools.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE } from "../src/auth/types.js";
import type { AuthBinding, AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxSubscription } from "../src/adapter/syntx/account-decoder.js";
import type { ModelAccessResult } from "../src/application/model-access.js";
import {
  OwnerSeedance20T2vGenerationService
} from "../src/application/owner-reviewed-no-reference-t2v-service.js";
import { createOwnerSeedance20CurrentProfile, SEEDANCE20_CURRENT_VARIANT } from "../src/application/owner-seedance20-t2v-current-profile.js";
import { createOwnerSeedance20T2vProfile } from "../src/application/owner-seedance20-t2v-profile.js";

const ATTEMPT_ID = "link_seedance20_service_test_0001";
const AUTH_BINDING: AuthBinding = Object.freeze({ tenant_id: "seedance20-test-tenant", subject: "seedance20-test-owner" });

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

async function setup(options:{pending?:boolean;denyCurrent?:boolean}={}) {
  let now = Date.now();
  let ready = !options.pending;
  const store = new InMemoryAuthLinkStore(() => now);
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-seedance20-upstream", approval_url: "https://syntx.ai/auth" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-seedance20-credential" });
      return { state: "LINKED" };
    }
  };
  const linkService = new PerUserLinkService(provider, store, {
    now: () => now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT_ID
  });
  await linkService.createAttempt(AUTH_BINDING);
  await linkService.issueHandoff(AUTH_BINDING, ATTEMPT_ID);
  assert.equal((await linkService.checkAttempt(AUTH_BINDING, ATTEMPT_ID)).linked, true);

  const requests: Array<{ readonly url: URL; readonly method: string; readonly body: unknown }> = [];
  const accessParameters: Array<Readonly<Record<string, unknown>>> = [];
  let chatCount = 0;
  let videoPosts = 0;
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body === undefined ? null : JSON.parse(String(init.body)) as unknown;
    requests.push({ url, method, body });
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatCount += 1;
      return response({ uuid: `seedance20-chat-${chatCount}` });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      videoPosts += 1;
      return response({ id: `seedance20-echo-${videoPosts}` });
    }
    const inProgress = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/inprogress$/u);
    if (inProgress && method === "GET") return response(ready?[{ message_id: `seedance20-bot-${videoPosts}`, object_type: "video", model_type: "seedance-2.0" }]:[]);
    const history = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/messages$/u);
    if (history && method === "GET") {
      const rows = [
        { id: `seedance20-echo-${videoPosts}`, chat_id: 701, author_id: 12345, message_object: [] },
        { id: `seedance20-bot-${videoPosts}`, chat_id: 701, author_id: -1, message_object: [{
          id: `video-seedance20-${videoPosts}`, message_id: `seedance20-bot-${videoPosts}`, object_type: "video", model_type: "seedance-2.0"
        }] }
      ];
      if (!ready) rows.pop();
      return response({ messages: rows, pagination: { page: 1, page_size: 10, total_count: rows.length,
        total_pages: 1, has_next: false, has_previous: false } });
    }
    const message = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u);
    if (message && method === "GET" && !ready) return response({ id:message[2],chat_id:701,author_id:-1,message_object:[] });
    if (message && method === "GET") return response({ id: message[2], chat_id: 701, author_id: -1, message_object: [{
      id: `video-seedance20-${videoPosts}`, message_id: `seedance20-bot-${videoPosts}`, object_type: "video", model_type: "seedance-2.0",
      completed: true, object_url: `https://r2.syntx.ai/seedance20/result-${videoPosts}.mp4`
    }] });
    throw new Error(`Unexpected synthetic route ${method} ${url.pathname}`);
  };
  const profile = createOwnerSeedance20T2vProfile(resolve(process.cwd(), "catalog"));
  const service = new OwnerSeedance20T2vGenerationService({
    profile, binding: AUTH_BINDING, linkService,
    resolveSubscription: async (): Promise<SyntxSubscription> => ({ active: true, plan_type: "PAID", end_date: null, end_date_kind: null }),
    resolveModelAccess: async (_attemptId, _modelId, costParameters): Promise<ModelAccessResult> => {
      accessParameters.push(Object.freeze({ ...costParameters }));
      return {
        catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
        catalog_version: `${profile.catalog.fetched_at}.${profile.catalog.source_hashes.models.slice(7, 19)}`,
        model_id: "seedance-2.0", ai_name: "seedance", model_type: "seedance-2.0", account_read_live: true,
        parameter_keys: Object.keys(costParameters).sort(), parameters_redacted: true, access: true, cost: null,
        discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false, observed_at: new Date(now).toISOString()
      };
    },
    resolveCurrentModelAccess: async (_attemptId, _modelId, costParameters): Promise<ModelAccessResult> => {
      const current = createOwnerSeedance20CurrentProfile(); accessParameters.push(Object.freeze({ ...costParameters }));
      return {catalog_kind:"OFFICIAL_PUBLIC_API_SNAPSHOT",catalog_version:current.registry.catalog_version,model_id:"seedance-2.0",ai_name:"seedance",model_type:"seedance-2.0",account_read_live:true,parameter_keys:Object.keys(costParameters).sort(),parameters_redacted:true,access:!options.denyCurrent,cost:null,discount_cost:null,free_remaining_generations:null,limit:null,show_warning:false,observed_at:new Date(now).toISOString()};
    },
    resolveChatClient: () => new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
      return operation("synthetic-seedance20-credential");
    } }, fetchImpl, requestTimeoutMs: 1_000 }),
    now: () => now, wait: async () => {now+=1000;}, videoTimeoutMs: 20
  });
  return { service, profile, requests, accessParameters, counts: () => ({ chatCount, videoPosts }),ready(){ready=true;}, advance(milliseconds: number) { now += milliseconds; } };
}



test("Seedance 2.0 current pro version binds current cost and version to one no-reference wire",async()=>{
 const state=await setup(),server=new McpServer({name:"seedance20-current",version:"1"});registerSyntxOwnerSeedance20T2vTools(server,{service:state.service});
 const [caller,host]=InMemoryTransport.createLinkedPair(),client=new Client({name:"seedance20-current",version:"1"});try{
 await server.connect(host);await client.connect(caller);await client.listTools();
 const output=await client.callTool({name:"syntx_owner_generate_seedance20_t2v",arguments:{link_attempt_id:ATTEMPT_ID,prompt:"Test current pro.",resolution:"4K",aspect_ratio:"9:16",video_duration:7,generate_audio:false,version:"pro"}});
 assert.equal(output.isError,undefined,JSON.stringify(output));assert.equal((output.structuredContent as {variant_id:string}).variant_id,SEEDANCE20_CURRENT_VARIANT);
 const post=state.requests.find(r=>r.method==="POST"&&r.url.pathname==="/api/v1/video/generate");
 assert.deepEqual(post?.body,{chat_id:"seedance20-chat-1",prompt:"Test current pro.",settings:{file_urls:[],mode:"omni-references",version:"pro",model_type:"seedance-2.0",resolution:"4K",aspect_ratio:"9:16",video_duration:7,generate_audio:false}});
 assert.deepEqual(state.accessParameters,[{video_duration:7,duration:0,mode:"omni-references",size:"9:16",resolution:"4K",version:"pro"},{video_duration:7,duration:0,mode:"omni-references",size:"9:16",resolution:"4K",version:"pro"}]);
 assert.deepEqual(state.counts(),{chatCount:1,videoPosts:1});
 }finally{await client.close();await server.close();await state.service.close();}
});

test("Seedance 2.0 current access denial occurs before chat or POST",async()=>{
 const state=await setup({denyCurrent:true});try{await assert.rejects(state.service.generate({attemptId:ATTEMPT_ID,prompt:"test",resolution:"720p",aspect_ratio:"1:1",video_duration:4,generate_audio:true,version:"fast"}),{code:"MODEL_ACCESS_UNAVAILABLE"});assert.equal(state.counts().chatCount,0);assert.equal(state.counts().videoPosts,0);}finally{await state.service.close();}
});

test("Seedance 2.0 MCP omitted version uses the current mini wire",async()=>{
 const state=await setup(),server=new McpServer({name:"seedance20-default",version:"1"});registerSyntxOwnerSeedance20T2vTools(server,{service:state.service});
 const [caller,host]=InMemoryTransport.createLinkedPair(),client=new Client({name:"seedance20-default",version:"1"});try{
 await server.connect(host);await client.connect(caller);await client.listTools();
 const output=await client.callTool({name:"syntx_owner_generate_seedance20_t2v",arguments:{link_attempt_id:ATTEMPT_ID,prompt:"Default current version.",resolution:"720p",aspect_ratio:"16:9",video_duration:5,generate_audio:true}});
 assert.equal(output.isError,undefined,JSON.stringify(output));assert.equal((output.structuredContent as {variant_id:string}).variant_id,SEEDANCE20_CURRENT_VARIANT);
 const post=state.requests.find(r=>r.method==="POST"&&r.url.pathname==="/api/v1/video/generate")?.body as {settings:{mode:string;version:string}};
 assert.equal(post.settings.mode,"omni-references");assert.equal(post.settings.version,"mini");assert.equal(state.counts().videoPosts,1);
 }finally{await client.close();await server.close();await state.service.close();}
});

test("Seedance 2.0 current recovery stays GET-only",async()=>{
 const state=await setup({pending:true});try{const error=await state.service.generate({attemptId:ATTEMPT_ID,prompt:"test",resolution:"720p",aspect_ratio:"1:1",video_duration:4,generate_audio:true,version:"fast"}).catch(e=>e);
 assert.equal(error.code,"OUTCOME_UNKNOWN",JSON.stringify(error));assert.ok(error.recovery_id);state.ready();const recovered=await state.service.reconcile({attemptId:ATTEMPT_ID,recovery_id:error.recovery_id});assert.equal(recovered.variant_id,SEEDANCE20_CURRENT_VARIANT);assert.equal(state.counts().videoPosts,1);
 }finally{await state.service.close();}
});
test("Seedance 2.0 current version-resolution conditions fail before quote or POST",async()=>{
 const state=await setup();try{for(const version of ["mini","fast"])await assert.rejects(Promise.resolve().then(()=>state.service.generate({attemptId:ATTEMPT_ID,prompt:"test",resolution:"1080p",aspect_ratio:"1:1",video_duration:4,generate_audio:true,version:version as "mini"|"fast"})),{code:"INVALID_REQUEST"});
 assert.equal(state.requests.length,0);const profile=createOwnerSeedance20CurrentProfile();assert.equal(profile.normalizeGenerationInput({attemptId:ATTEMPT_ID,prompt:"test",resolution:"4K",aspect_ratio:"1:1",video_duration:15,generate_audio:true,version:"pro"}).parameters.version,"pro");
 }finally{await state.service.close();}
});
