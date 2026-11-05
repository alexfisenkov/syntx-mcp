import assert from "node:assert/strict";
import test from "node:test";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {registerSyntxOwnerWan30FirstLastVideoTools} from "../src/mcp/owner-wan30-first-last-video-tools.js";
import {normalizeOwnerWan30FirstLastGenerationIntent} from "../src/application/owner-wan30-first-last-generation-parameters.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthBinding } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import {
  OwnerWan30FirstLastGenerationService,
} from "../src/application/owner-wan30-first-last-generation-service.js";
import type { OwnerWan30FirstLastGenerationIntent } from "../src/application/owner-wan30-first-last-generation-parameters.js";

const CATALOG_VERSION = "sha256-19c882601bb8ecdba994adf819544ebf06fd2db30374335631bb6078a66e5a76.json";
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(CATALOG_VERSION));
const BINDING: AuthBinding = Object.freeze({ tenant_id: "wan30-fl-tenant", subject: "wan30-fl-subject" });
const ATTEMPT = "link_wan30_first_last_test_000000000001";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
function crc32(bytes:Uint8Array):number{let c=0xffffffff;for(const x of bytes){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb88320:0);}return(c^0xffffffff)>>>0;}
PNG.writeUInt32BE(300,16);PNG.writeUInt32BE(300,20);PNG.writeUInt32BE(crc32(PNG.subarray(12,29)),29);
const PNG_BASE64 = PNG.toString("base64");
const INTENT: OwnerWan30FirstLastGenerationIntent = Object.freeze({
  model_id: "wan_30_first_last_frame",
  prompt: "A blue cube becomes a red paper boat on calm water",
  parameters: Object.freeze({ aspect_ratio: "16:9", resolution: "480P", video_duration: 2,
    prompt_extend: true, seed: null, native_audio: false, rendering_speed: "basic" })
});

interface FixtureOptions {
  readonly ownerAckObjects?: readonly { readonly type: string; readonly model_type: string | null }[];
  readonly otherAuthor?: boolean;
  readonly failSecondAccess?: boolean;
  readonly losePostAck?: boolean;
  readonly unlinkAfterUpload?: boolean;
}

function fixture(options: FixtureOptions = {}) {
  let now = Date.parse("2026-10-15T14:00:00.000Z");
  let chatCount = 0, uploadCount = 0, accessCount = 0, unlinked = false;
  const jobs = new Map<string, { ackId: string; outputs: readonly { id: string; url: string }[] }>();
  const events: Array<{ method: string; url: URL; body: unknown }> = [];
  const counts = { principalReads: 0, uploadPosts: 0, accountReads: 0, accessReads: 0, chatCreates: 0,
    generationPosts: 0, historyGets: 0, resultGets: 0, inProgressGets: 0 };
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation("synthetic-wan30-fl-credential"); }
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? "GET";
    let body: unknown;
    if (typeof init?.body === "string") body = JSON.parse(init.body) as unknown;
    if (typeof FormData !== "undefined" && init?.body instanceof FormData) {
      body = Object.freeze({ destination: init.body.get("destination"), check_duplicates: init.body.get("check_duplicates"),
        model_type: init.body.get("model_type") });
    }
    events.push({ method, url, body });

    if (url.pathname === "/api/v1/user/balance") {
      counts.accountReads += 1; return Response.json({ balance: "1000" });
    }
    if (url.pathname === "/api/v1/user/subscription") {
      counts.accountReads += 1; return Response.json({ active: true, type: "PRO", end_date: "2026-10-16T14:00:00.000Z" });
    }
    if (url.pathname === "/api/v2/get_model_info") {
      counts.accessReads += 1; accessCount += 1;
      return Response.json({ access: options.failSecondAccess && accessCount === 2 ? false : true,
        cost: 2, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: null });
    }
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
      uploadCount += 1; counts.uploadPosts += 1;
      if (options.unlinkAfterUpload) unlinked = true;
      return Response.json({ files: [{ id: `wan30-upload-${uploadCount}`, url: `https://r2.syntx.ai/wan30-frame-${uploadCount}.png` }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatCount += 1; counts.chatCreates += 1;
      return Response.json({ uuid: `wan30-first-last-chat-${chatCount}` });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      counts.generationPosts += 1;
      const request = body as { readonly chat_id: string; readonly prompt: string; readonly settings: Record<string, unknown> };
      const ackId = `wan30-first-last-owner-ack-${counts.generationPosts}`;
      jobs.set(request.chat_id, { ackId, outputs: [{ id: `wan30-first-last-bot-object-${counts.generationPosts}`,
        url: `https://r2.syntx.ai/wan30-generated-${counts.generationPosts}.mp4` }] });
      if (options.losePostAck) throw new Error("synthetic POST ACK unknown");
      return Response.json({ id: ackId });
    }
    const historyMatch = /^\/api\/v1\/chats\/(wan30-first-last-chat-\d+)\/messages$/u.exec(url.pathname);
    if (historyMatch) {
      counts.historyGets += 1;
      const job = jobs.get(historyMatch[1]!); assert.ok(job);
      const ownerObjects = (options.ownerAckObjects ?? [
        { type: "text", model_type: "wan_30_first_last_frame" },
        { type: "image", model_type: "wan_30_first_last_frame" },
        { type: "image", model_type: "wan_30_first_last_frame" }
      ]).map((item, index) => ({ id: `wan30-first-last-owner-object-${index + 1}`, message_id: job.ackId,
        object_type: item.type, model_type: item.model_type }));
      const messages: Array<Record<string, unknown>> = [{ id: job.ackId, chat_id: 9123, author_id: 4123, message_object: ownerObjects }];
      if (options.otherAuthor) messages.push({ id: "wan30-first-last-unrelated-owner", chat_id: 9123, author_id: 7001, message_object: [] });
      for (const output of job.outputs) messages.push({ id: "wan30-first-last-bot-message", chat_id: 9123, author_id: -1,
        message_object: [{ id: output.id, message_id: "wan30-first-last-bot-message", object_type: "video",
          model_type: "wan_30_first_last_frame" }] });
      const page = Number(url.searchParams.get("page"));
      return Response.json({ messages, pagination: { page, page_size: 10, total_count: messages.length, total_pages: 1,
        has_next: false, has_previous: false } });
    }
    const resultMatch = /^\/api\/v1\/chats\/(wan30-first-last-chat-\d+)\/(wan30-first-last-bot-message)$/u.exec(url.pathname);
    if (resultMatch) {
      counts.resultGets += 1;
      const job = jobs.get(resultMatch[1]!); assert.ok(job);
      return Response.json({ id: resultMatch[2], chat_id: 9123, author_id: -1, message_object: job.outputs.map((output) => ({
        id: output.id, message_id: resultMatch[2], object_type: "video", model_type: "wan_30_first_last_frame",
        completed: true, object_url: output.url
      })) });
    }
    if (/\/inprogress$/u.test(url.pathname)) { counts.inProgressGets += 1; return Response.json([]); }
    throw new Error(`Unexpected fixture request: ${method} ${url.pathname}`);
  };
  const linkService = new PerUserLinkService({} as never, {
    async getSnapshot(_binding: unknown, attemptId: string) {
      counts.principalReads += 1;
      return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
        status: unlinked ? "UNLINKED" as const : "LINKED" as const, expires_at: null, linked: !unlinked };
    }
  } as never);
  const chatClient = new SyntxChatHttpClient({ credentialBroker, fetchImpl, maxResponseBytes: 1024 * 1024 });
  const createAccountStatusService = () => new AccountStatusService(new SyntxHttpClient({ credentialBroker, fetchImpl }), () => now);
  const createModelAccessService = (_attemptId: string, catalog: DiscoveryCatalogRepository) =>
    new ModelAccessService(catalog, new SyntxHttpClient({ credentialBroker, fetchImpl }), () => now);
  return { binding: BINDING, linkService, chatClient, fetchImpl, events, counts,
    createAccountStatusService, createModelAccessService, get now() { return now; }, setUnlinked() { unlinked = true; } };
}

function makeService(f: ReturnType<typeof fixture>, resolveClient: (attemptId: string) => unknown = () => f.chatClient) {
  return new OwnerWan30FirstLastGenerationService({ binding: f.binding, linkService: f.linkService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient,
    createAccountStatusService: f.createAccountStatusService, createModelAccessService: f.createModelAccessService,
    now: () => f.now, timeoutMs: 5_000 });
}

async function uploadPair(service: OwnerWan30FirstLastGenerationService) {
  const first = await service.upload({ attemptId: ATTEMPT, role: "first_frame", content_base64: PNG_BASE64,
    filename: "first.png", mime_type: "image/png" });
  const last = await service.upload({ attemptId: ATTEMPT, role: "last_frame", content_base64: PNG_BASE64,
    filename: "last.png", mime_type: "image/png" });
  return { first, last };
}



test("WAN30 First/Last current controls use a829 quote and exact two-frame wire",async()=>{
 const f=fixture(),service=makeService(f),pair=await uploadPair(service),server=new McpServer({name:"wan30-firstlast-current",version:"1"});
 registerSyntxOwnerWan30FirstLastVideoTools(server,{generationService:service});const [caller,host]=InMemoryTransport.createLinkedPair(),client=new Client({name:"wan30-firstlast-current",version:"1"});
 try{await server.connect(host);await client.connect(caller);await client.listTools();const source=await client.callTool({name:"syntx_get_wan30_first_last_parameters",arguments:{}});assert.equal(source.isError,undefined,JSON.stringify(source));
 assert.equal((source.structuredContent as {current_source:{status:string}}).current_source.status,"FORM_SOURCE_REVIEWED_NOT_UI_OR_PROVIDER_OBSERVED");
 const parameters={aspect_ratio:"16:9",resolution:"1080P",video_duration:9,prompt_extend:false,seed:42,native_audio:true,rendering_speed:"prime"};
 assert.equal(normalizeOwnerWan30FirstLastGenerationIntent({prompt:INTENT.prompt,parameters}).status,"FORM_SOURCE_REVIEWED_EXPLICIT_INTENT");
 const result=await client.callTool({name:"syntx_owner_generate_wan30_first_last_video",arguments:{link_attempt_id:ATTEMPT,prompt:INTENT.prompt,parameters,first_frame_handle:pair.first.frame_handle,last_frame_handle:pair.last.frame_handle}});
 assert.equal(result.isError,undefined,JSON.stringify(result));assert.equal((result.structuredContent as {status:string}).status,"completed");
 const post=f.events.find(x=>x.method==="POST"&&x.url.pathname==="/api/v1/video/generate")?.body as {settings:Record<string,unknown>};assert.equal(post.settings.resolution,"1080P");assert.equal(post.settings.video_duration,9);assert.equal(post.settings.seed,42);assert.equal(post.settings.native_audio,true);assert.equal(post.settings.rendering_speed,"prime");
 const quote=f.events.filter(x=>x.url.pathname==="/api/v2/get_model_info");assert.equal(quote.length,2);for(const q of quote){assert.equal(q.url.searchParams.get("resolution"),"1080P");assert.equal(q.url.searchParams.get("video_duration"),"9");assert.equal(q.url.searchParams.get("rendering_speed"),"prime");}
 assert.equal(f.counts.generationPosts,1);
 }finally{await client.close();await server.close();await service.close();}
});

test("WAN30 current controls enforce source image bounds before chat",async()=>{
 const f=fixture(),service=makeService(f),tiny=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=","base64").toString("base64");
 try{const first=await service.upload({attemptId:ATTEMPT,role:"first_frame",content_base64:tiny,filename:"first.png",mime_type:"image/png"});
 const last=await service.upload({attemptId:ATTEMPT,role:"last_frame",content_base64:tiny,filename:"last.png",mime_type:"image/png"});
 await assert.rejects(service.generate({attemptId:ATTEMPT,input:{...INTENT,parameters:{...INTENT.parameters,resolution:"720P"}},first_frame_handle:first.frame_handle,last_frame_handle:last.frame_handle}),{code:"REFERENCE_UNAVAILABLE"});
 assert.equal(f.counts.chatCreates,0);assert.equal(f.counts.generationPosts,0);
 }finally{await service.close();}
});

test("WAN30 current first-only mode sends one role and never infers a last frame",async()=>{
 const f=fixture({ownerAckObjects:[{type:"text",model_type:"wan_30_first_last_frame"},{type:"image",model_type:"wan_30_first_last_frame"}]}),service=makeService(f);
 const first=await service.upload({attemptId:ATTEMPT,role:"first_frame",content_base64:PNG_BASE64,filename:"first.png",mime_type:"image/png"});
 const server=new McpServer({name:"wan30-first-only",version:"1"});registerSyntxOwnerWan30FirstLastVideoTools(server,{generationService:service});
 const [caller,host]=InMemoryTransport.createLinkedPair(),client=new Client({name:"wan30-first-only",version:"1"});
 try {await server.connect(host);await client.connect(caller);await client.listTools();
 const result=await client.callTool({name:"syntx_owner_generate_wan30_first_last_video",arguments:{link_attempt_id:ATTEMPT,prompt:INTENT.prompt,parameters:{},first_frame_handle:first.frame_handle}});
 assert.equal(result.isError,undefined,JSON.stringify(result));assert.equal((result.structuredContent as {status:string}).status,"completed");
 const post=f.events.find(x=>x.method==="POST"&&x.url.pathname==="/api/v1/video/generate")?.body as {settings:{file_urls:Array<{type:string}>}};
 assert.deepEqual(post.settings.file_urls.map(x=>x.type),["first_frame"]);assert.equal(f.counts.generationPosts,1);
 }finally{await client.close();await server.close();await service.close();}
});

test("WAN30 First/Last current unknown acknowledgement remains GET-only",async()=>{
 const f=fixture({losePostAck:true}),service=makeService(f),pair=await uploadPair(service);
 try{const input={...INTENT,parameters:{...INTENT.parameters,resolution:"720P" as const,video_duration:4}};
 const error=await service.generate({attemptId:ATTEMPT,input,first_frame_handle:pair.first.frame_handle,last_frame_handle:pair.last.frame_handle}).catch(e=>e);
 assert.equal(error.code,"OUTCOME_UNKNOWN");assert.ok(error.recovery_id);await assert.rejects(service.reconcile({attemptId:ATTEMPT,recovery_id:error.recovery_id}),{code:"OUTCOME_UNKNOWN"});assert.equal(f.counts.generationPosts,1);
 }finally{await service.close();}
});
