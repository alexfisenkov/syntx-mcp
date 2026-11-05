import assert from "node:assert/strict";
import test from "node:test";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {registerSyntxOwnerWan30ReferenceVideoTools} from "../src/mcp/owner-wan30-reference-video-tools.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthBinding } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import {
  OwnerWan30ReferenceGenerationService,
} from "../src/application/owner-wan30-reference-generation-service.js";
import type { OwnerWan30ReferenceGenerationIntent } from "../src/application/owner-wan30-reference-generation-parameters.js";

const CATALOG_VERSION = "sha256-19c882601bb8ecdba994adf819544ebf06fd2db30374335631bb6078a66e5a76.json";
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(CATALOG_VERSION));
const BINDING: AuthBinding = Object.freeze({ tenant_id: "wan30-reference-tenant", subject: "wan30-reference-subject" });
const ATTEMPT = "link_wan30_reference_test_000000000001";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
function crc32(bytes:Uint8Array):number{let c=0xffffffff;for(const x of bytes){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb88320:0);}return(c^0xffffffff)>>>0;}
PNG.writeUInt32BE(300,16);PNG.writeUInt32BE(300,20);PNG.writeUInt32BE(crc32(PNG.subarray(12,29)),29);
const INTENT: OwnerWan30ReferenceGenerationIntent = Object.freeze({
  model_id: "wan_30_reference",
  prompt: "A red paper boat on a quiet blue lake.",
  parameters: Object.freeze({ aspect_ratio: "16:9", resolution: "480P", video_duration: 2, prompt_extend: true,
    shot_type: "single", audio_setting: "auto", seed: null, native_audio: false, duration: 0, rendering_speed: "basic" })
});

interface FixtureOptions {
  readonly ackText?: string;
  readonly ackImageUrl?: string;
  readonly ackObjects?: readonly { type: string; model: string | null }[];
  readonly historyAckObjects?: readonly { type: string; model: string | null }[];
  readonly failSecondAccess?: boolean;
  readonly losePostAck?: boolean;
  readonly unlinkAfterUpload?: boolean;
  readonly unlinkDuringSecondAccess?: boolean;
  readonly unlinkAfterResult?: boolean;
  readonly additionalOtherAuthor?: boolean;
}
function fixture(options: FixtureOptions = {}) {
  let now = Date.parse("2026-10-16T08:00:00.000Z"), accessCalls = 0, uploadCalls = 0, postCalls = 0, unlinked = false;
  const events: Array<{ method: string; path: string; query: Readonly<Record<string, string>>; body: unknown }> = [];
  const jobs = new Map<string, { ack: string; prompt: string; imageUrl: string; video: string }>();
  const counts = { accountReads: 0, accessReads: 0, uploads: 0, chats: 0, generationPosts: 0, ownerAckGets: 0, historyGets: 0, resultGets: 0 };
  const credentialBroker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-reference-credential"); } };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? "GET";
    let body: unknown = null;
    if (typeof init?.body === "string") body = JSON.parse(init.body);
    if (init?.body instanceof FormData) body = { destination: init.body.get("destination"), check_duplicates: init.body.get("check_duplicates"), model_type: init.body.get("model_type") };
    events.push({ method, path: url.pathname, query: Object.freeze(Object.fromEntries(url.searchParams.entries())), body });
    if (url.pathname === "/api/v1/user/balance") { counts.accountReads += 1; return Response.json({ balance: "1000" }); }
    if (url.pathname === "/api/v1/user/subscription") { counts.accountReads += 1; return Response.json({ active: true, type: "PRO", end_date: "2026-10-17T08:00:00.000Z" }); }
    if (url.pathname === "/api/v2/get_model_info") { counts.accessReads += 1; accessCalls += 1;
      if (options.unlinkDuringSecondAccess && accessCalls === 2) unlinked = true;
      return Response.json({ access: !(options.failSecondAccess && accessCalls === 2), cost: 2, discount_cost: null,
        free_remaining_generations: null, limit: null, show_warning: null }); }
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
      uploadCalls += 1; counts.uploads += 1; if (options.unlinkAfterUpload) unlinked = true;
      return Response.json({ files: [{ id: `reference-file-${uploadCalls}`, url: `https://r2.syntx.ai/reference-${uploadCalls}.png` }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") { counts.chats += 1; return Response.json({ uuid: `reference-chat-${counts.chats}` }); }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      postCalls += 1; counts.generationPosts += 1;
      const request = body as { chat_id: string; prompt: string; settings: { file_urls: readonly { url: string }[] } };
      const job = { ack: String(71000 + postCalls), prompt: request.prompt, imageUrl: request.settings.file_urls[0]!.url,
        video: `https://r2.syntx.ai/reference-output-${postCalls}.mp4` };
      jobs.set(request.chat_id, job);
      if (options.losePostAck) throw new Error("synthetic POST ACK unknown");
      return Response.json({ id: Number(job.ack) });
    }
    const ackMatch = /^\/api\/v1\/chats\/(reference-chat-\d+)\/(\d{1,16})$/u.exec(url.pathname);
    if (ackMatch) {
      counts.ownerAckGets += 1; const job = jobs.get(ackMatch[1]!); assert.ok(job);
      const ackObjects = (options.ackObjects ?? [{ type: "text", model: "wan_30_reference" }, { type: "image", model: "wan_30_reference" }]).map((item, index) => ({
        id: 72000 + index, message_id: Number(ackMatch[2]), object_type: item.type, model_type: item.model,
        object_text: item.type === "text" ? options.ackText ?? job.prompt : null,
        object_url: item.type === "image" ? options.ackImageUrl ?? job.imageUrl : null,
        completed: null, task_id: null
      }));
      return Response.json({ id: Number(ackMatch[2]), chat_id: 4812, author_id: 4123, message_object: ackObjects });
    }
    const historyMatch = /^\/api\/v1\/chats\/(reference-chat-\d+)\/messages$/u.exec(url.pathname);
    if (historyMatch) {
      counts.historyGets += 1; const job = jobs.get(historyMatch[1]!); assert.ok(job);
      const ack = job.ack;
      const ownerObjects = (options.historyAckObjects ?? options.ackObjects ?? [{ type: "text", model: "wan_30_reference" }, { type: "image", model: "wan_30_reference" }]).map((item, i) => ({
        id: `history-owner-object-${i}`, message_id: ack, object_type: item.type, model_type: item.model }));
      const messages: Array<Record<string, unknown>> = [{ id: ack, chat_id: 4812, author_id: 4123, message_object: ownerObjects }];
      if (options.additionalOtherAuthor) messages.push({ id: "reference-unrelated-nonbot", chat_id: 4812, author_id: 9988, message_object: [] });
      messages.push({ id: `reference-bot-message-${historyMatch[1]}`, chat_id: 4812, author_id: -1, message_object: [{
          id: `reference-video-object-${historyMatch[1]}`, message_id: `reference-bot-message-${historyMatch[1]}`,
          object_type: "video", model_type: "wan_30_reference" }] });
      const page = Number(url.searchParams.get("page"));
      return Response.json({ messages, pagination: { page, page_size: 10, total_count: messages.length, total_pages: 1, has_next: false, has_previous: false } });
    }
    const resultMatch = /^\/api\/v1\/chats\/(reference-chat-\d+)\/(reference-bot-message-reference-chat-\d+)$/u.exec(url.pathname);
    if (resultMatch) {
      counts.resultGets += 1; const job = jobs.get(resultMatch[1]!); assert.ok(job);
      const response = Response.json({ id: resultMatch[2], chat_id: 4812, author_id: -1, message_object: [{
        id: `reference-video-object-${resultMatch[1]}`, message_id: resultMatch[2], object_type: "video", model_type: "wan_30_reference",
        completed: true, object_url: job.video }] });
      if (options.unlinkAfterResult) unlinked = true;
      return response;
    }
      if (/\/inprogress$/u.test(url.pathname)) return Response.json([]);
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  };
  const linkService = new PerUserLinkService({} as never, { async getSnapshot(_binding: unknown, attemptId: string) {
    return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
      status: unlinked ? "UNLINKED" as const : "LINKED" as const, expires_at: null, linked: !unlinked };
  } } as never);
  const chatClient = new SyntxChatHttpClient({ credentialBroker, fetchImpl, maxResponseBytes: 1024 * 1024 });
  const createAccountStatusService = () => new AccountStatusService(new SyntxHttpClient({ credentialBroker, fetchImpl }), () => now);
  const createModelAccessService = (_attemptId: string, catalog: DiscoveryCatalogRepository) =>
    new ModelAccessService(catalog, new SyntxHttpClient({ credentialBroker, fetchImpl }), () => now);
  return { binding: BINDING, linkService, chatClient, events, counts, createAccountStatusService, createModelAccessService,
    get now() { return now; }, advance(ms: number) { now += ms; }, setUnlinked() { unlinked = true; } };
}

function service(f: ReturnType<typeof fixture>, resolveClient: (attemptId: string) => unknown = () => f.chatClient) {
  return new OwnerWan30ReferenceGenerationService({ binding: f.binding, linkService: f.linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveClient, createAccountStatusService: f.createAccountStatusService,
    createModelAccessService: f.createModelAccessService, now: () => f.now, timeoutMs: 5_000 });
}
async function upload(target: OwnerWan30ReferenceGenerationService) {
  return target.uploadReferenceImage({ attemptId: ATTEMPT, content_base64: PNG.toString("base64"), filename: "reference.png", mime_type: "image/png" });
}



test("WAN30 Reference current source controls use current quote and one owner-bound image",async()=>{
 const f=fixture(),target=service(f),image=await upload(target),server=new McpServer({name:"wan30-reference-current",version:"1"});registerSyntxOwnerWan30ReferenceVideoTools(server,{generationService:target});
 const [caller,host]=InMemoryTransport.createLinkedPair(),client=new Client({name:"wan30-reference-current",version:"1"});
 try{await server.connect(host);await client.connect(caller);await client.listTools();const source=await client.callTool({name:"syntx_get_wan30_reference_parameters",arguments:{}});assert.equal(source.isError,undefined,JSON.stringify(source));
 const parameters={...INTENT.parameters,aspect_ratio:"adaptive",resolution:"1080P",video_duration:9,prompt_extend:false,seed:42,native_audio:true,rendering_speed:"prime"};
 const result=await client.callTool({name:"syntx_owner_generate_wan30_reference_video",arguments:{link_attempt_id:ATTEMPT,prompt:INTENT.prompt,parameters,image_handle:image.image_handle}});
 assert.equal(result.isError,undefined,JSON.stringify(result));assert.equal((result.structuredContent as {cost_input_confidence:string}).cost_input_confidence,"CURRENT_STATIC_SOURCE_NOT_BILLING");
 const post=f.events.find(e=>e.path==="/api/v1/video/generate")?.body as {settings:Record<string,unknown>};assert.equal(post.settings.aspect_ratio,"adaptive");assert.equal(post.settings.resolution,"1080P");assert.equal(post.settings.video_duration,9);assert.equal(post.settings.seed,42);assert.equal(post.settings.native_audio,true);
 const quote=f.events.filter(e=>e.path==="/api/v2/get_model_info");assert.equal(quote.length,2);for(const q of quote){assert.equal(q.query.resolution,"1080P");assert.equal(q.query.video_duration,"9");assert.equal(q.query.rendering_speed,"prime");}
 assert.equal(f.counts.generationPosts,1);
 }finally{await client.close();await server.close();await target.close();}
});

test("WAN30 Reference current unknown POST is reconciled without replay",async()=>{
 const f=fixture({losePostAck:true}),target=service(f);try{const image=await upload(target);const input={...INTENT,parameters:{...INTENT.parameters,resolution:"720P" as const}};
 const error=await target.generate({attemptId:ATTEMPT,input,image_handle:image.image_handle}).catch(e=>e);assert.equal(error.code,"OUTCOME_UNKNOWN");assert.ok(error.recovery_id);
 const result=await target.reconcile({attemptId:ATTEMPT,recovery_id:error.recovery_id});assert.equal(result.status,"completed");assert.equal(f.counts.generationPosts,1);
 }finally{await target.close();}
});

test("WAN30 Reference current preflight denial or too-small image fails before generation",async()=>{
 const f=fixture({failSecondAccess:true}),target=service(f);try{const image=await upload(target);
 await assert.rejects(target.generate({attemptId:ATTEMPT,input:{...INTENT,parameters:{...INTENT.parameters,resolution:"720P"}},image_handle:image.image_handle}),{code:"PREFLIGHT_FAILED"});assert.equal(f.counts.generationPosts,0);
 }finally{await target.close();}
 const g=fixture(),other=service(g);try{const tiny="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
 const image=await other.uploadReferenceImage({attemptId:ATTEMPT,content_base64:tiny,filename:"reference.png",mime_type:"image/png"});
 await assert.rejects(other.generate({attemptId:ATTEMPT,input:{...INTENT,parameters:{...INTENT.parameters,resolution:"720P"}},image_handle:image.image_handle}),{code:"REFERENCE_UNAVAILABLE"});assert.equal(g.counts.chats,0);assert.equal(g.counts.generationPosts,0);
 }finally{await other.close();}
});
