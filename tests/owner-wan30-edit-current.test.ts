import assert from "node:assert/strict";
import test, { after } from "node:test";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {registerSyntxOwnerWan30EditVideoTools} from "../src/mcp/owner-wan30-edit-video-tools.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeScriptExecutable } from "./helpers/node-script-executable.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { createOwnerWan30EditCurrentOriginalProbe, createOwnerWan30EditOriginalProbe } from "../src/adapter/syntx/owner-wan30-edit-original-probe.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthBinding } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import {
  createOwnerWan30EditGenerationService, OwnerWan30EditGenerationService
} from "../src/application/owner-wan30-edit-generation-service.js";
import type { OwnerWan30EditGenerationIntent } from "../src/application/owner-wan30-edit-generation-parameters.js";

const CATALOG_VERSION = "sha256-19c882601bb8ecdba994adf819544ebf06fd2db30374335631bb6078a66e5a76.json";
const CATALOG_DIRECTORY = join(process.cwd(), "catalog");
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(CATALOG_VERSION, CATALOG_DIRECTORY));
const BINDING: AuthBinding = Object.freeze({ tenant_id: "wan30-edit-tenant", subject: "wan30-edit-subject" });
const ATTEMPT = "link_wan30_edit_test_000000000001";
const INTENT: OwnerWan30EditGenerationIntent = Object.freeze({ model_id: "wan_30_edit", prompt: "A quiet landscape at dusk.",
  parameters: Object.freeze({ aspect_ratio: "16:9", resolution: "480P", video_duration: 2, prompt_extend: true, shot_type: "single",
    audio_setting: "auto", seed: null, native_audio: true, duration: 2, rendering_speed: "basic" }) });
const ROOTS: string[] = [];
after(async () => { await Promise.all(ROOTS.map((root) => rm(root, { recursive: true, force: true }))); });

function sourceBytes(): Buffer { return Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x69, 0x73, 0x6f, 0x6d]); }
function ffprobeJson(duration = "2.000000",fps="30/1"): string { return JSON.stringify({ streams: [{ codec_type: "video", width: 854, height: 480, duration, avg_frame_rate: fps, r_frame_rate: fps, nb_frames: "60" }], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration } }); }
async function makeProbe(duration = "2.000000",fps="30/1",current=false) {
  const root = await mkdtemp(join(tmpdir(), "wan30-edit-service-test-")); ROOTS.push(root);
  const binary = join(root, "ffprobe-fixture");
  const body = `process.stdout.write(${JSON.stringify(ffprobeJson(duration,fps))});`;
  await writeFile(binary, nodeScriptExecutable(`#!${process.execPath}\n${body}\n`), { mode: 0o700, flag: "wx" });
  return (current ? createOwnerWan30EditCurrentOriginalProbe : createOwnerWan30EditOriginalProbe)({ ffprobePath: binary });
}

function fixture(options: { losePostAck?: boolean; failSecondAccess?: boolean; unlinkDuringSecondAccess?: boolean; extraOtherAuthor?: boolean } = {}) {
  let now = Date.parse("2026-10-16T08:00:00.000Z"), accessCalls = 0, unlinked = false, postCalls = 0, uploadCalls = 0;
  let nextPrincipalGate: { readonly entered: () => void; readonly gate: Promise<void> } | undefined;
  const events: Array<{ method: string; path: string; query: Record<string, string>; body: unknown }> = [];
  const counts = { uploads: 0, chats: 0, generationPosts: 0, ownerAckGets: 0, historyGets: 0, resultGets: 0 };
  const jobs = new Map<string, { prompt: string; videoUrl: string; ack: string }>();
  const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-edit-credential"); } };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? "GET"; let body: unknown = null;
    if (typeof init?.body === "string") body = JSON.parse(init.body);
    if (init?.body instanceof FormData) body = { destination: init.body.get("destination"), check_duplicates: init.body.get("check_duplicates"), model_type: init.body.get("model_type") };
    events.push({ method, path: url.pathname, query: Object.fromEntries(url.searchParams.entries()), body });
    if (url.pathname === "/api/v1/user/balance") return Response.json({ balance: "1000" });
    if (url.pathname === "/api/v1/user/subscription") return Response.json({ active: true, type: "PRO", end_date: "2026-10-17T08:00:00.000Z" });
    if (url.pathname === "/api/v2/get_model_info") { accessCalls += 1; if (options.unlinkDuringSecondAccess && accessCalls === 2) unlinked = true;
      return Response.json({ access: !(options.failSecondAccess && accessCalls === 2), cost: 2, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: null }); }
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") { uploadCalls += 1; counts.uploads += 1;
      return Response.json({ files: [{ id: `edit-source-${uploadCalls}`, url: `https://r2.syntx.ai/edit-source-${uploadCalls}.mp4` }] }); }
    if (url.pathname === "/api/v1/chats" && method === "POST") { counts.chats += 1; return Response.json({ uuid: `edit-chat-${counts.chats}` }); }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      postCalls += 1; counts.generationPosts += 1; const req = body as { chat_id: string; prompt: string; settings: { file_urls: readonly { url: string }[] } };
      jobs.set(req.chat_id, { prompt: req.prompt, videoUrl: `https://r2.syntx.ai/edit-result-${postCalls}.mp4`, ack: String(84000 + postCalls) });
      if (options.losePostAck) throw new Error("synthetic lost ACK"); return Response.json({ id: 84000 + postCalls });
    }
    const ack = /^\/api\/v1\/chats\/(edit-chat-\d+)\/(\d{1,16})$/u.exec(url.pathname);
    if (ack) { counts.ownerAckGets += 1; const job = jobs.get(ack[1]!); assert.ok(job);
      return Response.json({ id: Number(ack[2]), chat_id: 5812, author_id: 4123, message_object: [
        { id: 85001, message_id: Number(ack[2]), object_type: "text", model_type: "wan_30_edit", object_text: job.prompt, object_url: null },
        { id: 85002, message_id: Number(ack[2]), object_type: "video", model_type: "wan_30_edit", object_text: null, object_url: `https://r2.syntx.ai/edit-source-1.mp4` }
      ] }); }
    const history = /^\/api\/v1\/chats\/(edit-chat-\d+)\/messages$/u.exec(url.pathname);
    if (history) { counts.historyGets += 1; const job = jobs.get(history[1]!); assert.ok(job);
      const messages: Array<Record<string, unknown>> = [{ id: job.ack, chat_id: 5812, author_id: 4123, message_object: [
        { id: "edit-owner-text", message_id: job.ack, object_type: "text", model_type: "wan_30_edit" },
        { id: "edit-owner-video", message_id: job.ack, object_type: "video", model_type: "wan_30_edit" }
      ] }];
      if (options.extraOtherAuthor) messages.push({ id: "edit-other", chat_id: 5812, author_id: 9999, message_object: [] });
      messages.push({ id: `edit-bot-${history[1]}`, chat_id: 5812, author_id: -1, message_object: [{ id: `edit-output-${history[1]}`, message_id: `edit-bot-${history[1]}`, object_type: "video", model_type: "wan_30_edit" }] });
      return Response.json({ messages, pagination: { page: Number(url.searchParams.get("page")), page_size: 10, total_count: messages.length, total_pages: 1, has_next: false, has_previous: false } }); }
    const result = /^\/api\/v1\/chats\/(edit-chat-\d+)\/(edit-bot-edit-chat-\d+)$/u.exec(url.pathname);
    if (result) { counts.resultGets += 1; const job = jobs.get(result[1]!); assert.ok(job);
      return Response.json({ id: result[2], chat_id: 5812, author_id: -1, message_object: [{ id: `edit-output-${result[1]}`, message_id: result[2], object_type: "video", model_type: "wan_30_edit", completed: true, object_url: job.videoUrl }] }); }
    if (/\/inprogress$/u.test(url.pathname)) return Response.json([]);
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  };
  const linkService = new PerUserLinkService({} as never, { async getSnapshot(_binding: unknown, attemptId: string) {
    const pending = nextPrincipalGate; nextPrincipalGate = undefined; if (pending) { pending.entered(); await pending.gate; }
    return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
      status: unlinked ? "UNLINKED" as const : "LINKED" as const, expires_at: null, linked: !unlinked };
  } } as never);
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl, maxResponseBytes: 1024 * 1024 });
  const createAccountStatusService = () => new AccountStatusService(new SyntxHttpClient({ credentialBroker: broker, fetchImpl }), () => now);
  const createModelAccessService = (_attemptId: string, catalog: DiscoveryCatalogRepository) => new ModelAccessService(catalog, new SyntxHttpClient({ credentialBroker: broker, fetchImpl }), () => now);
  return { client, events, counts, linkService, createAccountStatusService, createModelAccessService,
    delayNextPrincipalRead() { let notify!: () => void, resume!: () => void; const entered = new Promise<void>((resolve) => { notify = resolve; });
      const gate = new Promise<void>((resolve) => { resume = resolve; }); nextPrincipalGate = { entered: notify, gate }; return { entered, release: resume }; },
    get now() { return now; }, setUnlinked() { unlinked = true; }, advance(ms: number) { now += ms; } };
}
function service(f: ReturnType<typeof fixture>, originalProbe: Awaited<ReturnType<typeof makeProbe>>) {
  return createOwnerWan30EditGenerationService({ binding: BINDING, linkService: f.linkService, catalog: CATALOG, catalog_version: CATALOG_VERSION,
    catalogDirectory: CATALOG_DIRECTORY, originalProbe, resolveClient: () => f.client, createAccountStatusService: f.createAccountStatusService,
    createModelAccessService: f.createModelAccessService, now: () => f.now, timeoutMs: 5_000 });
}
async function upload(target: OwnerWan30EditGenerationService) { return target.uploadEditVideo({ attemptId: ATTEMPT, content_base64: sourceBytes().toString("base64"), filename: "owned-source.mp4", mime_type: "video/mp4" }); }

test("WAN30 Edit binds current output and cost to its measured source duration", async () => {
 const f=fixture(),target=service(f,await makeProbe("10.250000","30/1",true)),server=new McpServer({name:"wan30-edit-duration",version:"1"});
 registerSyntxOwnerWan30EditVideoTools(server,{generationService:target});
 const [caller,host]=InMemoryTransport.createLinkedPair(),client=new Client({name:"wan30-edit-duration",version:"1"});
 try {await server.connect(host);await client.connect(caller);await client.listTools();
  const uploadResult=await client.callTool({name:"syntx_owner_upload_wan30_edit_video",arguments:{link_attempt_id:ATTEMPT,content_base64:sourceBytes().toString("base64"),filename:"owned-source.mp4",mime_type:"video/mp4"}});
  assert.equal(uploadResult.isError,undefined,JSON.stringify(uploadResult));const video=uploadResult.structuredContent as {video_handle:string;duration_seconds:number};assert.equal(video.duration_seconds,10.25);
  const args={link_attempt_id:ATTEMPT,prompt:INTENT.prompt,video_handle:video.video_handle,parameters:{...INTENT.parameters,duration:10.25,video_duration:10}};
  const bad=await client.callTool({name:"syntx_owner_generate_wan30_edit_video",arguments:{...args,parameters:{...args.parameters,duration:9}}});
  assert.equal(bad.isError,true);assert.equal(f.counts.generationPosts,0);
  const result=await client.callTool({name:"syntx_owner_generate_wan30_edit_video",arguments:args});assert.equal(result.isError,undefined,JSON.stringify(result));
  const post=f.events.find(e=>e.path==="/api/v1/video/generate")?.body as {settings:Record<string,unknown>};
  assert.equal(post.settings.video_duration,10);assert.equal(post.settings.duration,10.25);
  const quote=f.events.filter(e=>e.path==="/api/v2/get_model_info");assert.equal(quote.length,2);
  for(const q of quote){assert.equal(q.query.video_duration,"10");assert.equal(q.query.duration,"10.25");}
 } finally {await client.close();await server.close();await target.close();}
});

test("current branded two-second source keeps current provenance even with the historical settings", async () => {
 const f=fixture(),target=service(f,await makeProbe("2.000000","30/1",true));
 try {const video=await upload(target);const result=await target.generate({attemptId:ATTEMPT,input:INTENT,video_handle:video.video_handle});
  assert.equal(result.cost_input_confidence,"CURRENT_STATIC_SOURCE_NOT_BILLING");assert.equal(f.counts.generationPosts,1);
 } finally {await target.close();}
});


test("WAN30 Edit current controls use current quote and one owned two-second video",async()=>{
 const f=fixture(),target=service(f,await makeProbe()),video=await upload(target),server=new McpServer({name:"wan30-edit-current",version:"1"});registerSyntxOwnerWan30EditVideoTools(server,{generationService:target});
 const [caller,host]=InMemoryTransport.createLinkedPair(),client=new Client({name:"wan30-edit-current",version:"1"});
 try{await server.connect(host);await client.connect(caller);await client.listTools();const source=await client.callTool({name:"syntx_get_wan30_edit_parameters",arguments:{}});assert.equal(source.isError,undefined,JSON.stringify(source));
 assert.equal((source.structuredContent as {current_controls:{input:{trimming:string}}}).current_controls.input.trimming,"NOT_IMPLEMENTED");
 const parameters={...INTENT.parameters,aspect_ratio:"adaptive",resolution:"1080P",prompt_extend:false,seed:42,native_audio:false,rendering_speed:"prime"};
 const result=await client.callTool({name:"syntx_owner_generate_wan30_edit_video",arguments:{link_attempt_id:ATTEMPT,prompt:INTENT.prompt,parameters,video_handle:video.video_handle}});
 assert.equal(result.isError,undefined,JSON.stringify(result));assert.equal((result.structuredContent as {cost_input_confidence:string}).cost_input_confidence,"CURRENT_STATIC_SOURCE_NOT_BILLING");
 const post=f.events.find(e=>e.path==="/api/v1/video/generate")?.body as {settings:Record<string,unknown>};assert.equal(post.settings.aspect_ratio,"adaptive");assert.equal(post.settings.resolution,"1080P");assert.equal(post.settings.video_duration,2);assert.equal(post.settings.seed,42);assert.equal(post.settings.native_audio,false);
 const quote=f.events.filter(e=>e.path==="/api/v2/get_model_info");assert.equal(quote.length,2);for(const q of quote){assert.equal(q.query.resolution,"1080P");assert.equal(q.query.video_duration,"2");assert.equal(q.query.duration,"2");assert.equal(q.query.rendering_speed,"prime");}assert.equal(f.counts.generationPosts,1);
 }finally{await client.close();await server.close();await target.close();}
});

test("WAN30 Edit current unknown POST is reconciled without replay",async()=>{
 const f=fixture({losePostAck:true}),target=service(f,await makeProbe());try{const video=await upload(target);const input={...INTENT,parameters:{...INTENT.parameters,resolution:"720P" as const}};
 const error=await target.generate({attemptId:ATTEMPT,input,video_handle:video.video_handle}).catch(e=>e);assert.equal(error.code,"OUTCOME_UNKNOWN");assert.ok(error.recovery_id);
 const result=await target.reconcile({attemptId:ATTEMPT,recovery_id:error.recovery_id});assert.equal(result.status,"completed");assert.equal(f.counts.generationPosts,1);
 }finally{await target.close();}
});

test("WAN30 Edit current denies low fps and unavailable model access before generation",async()=>{
 const f=fixture(),target=service(f,await makeProbe("2.000000","15/1"));try{
  await assert.rejects(upload(target),{code:"UPLOAD_REJECTED"});
  assert.equal(f.counts.uploads,0);assert.equal(f.counts.chats,0);assert.equal(f.counts.generationPosts,0);
 }finally{await target.close();}
 const g=fixture({failSecondAccess:true}),other=service(g,await makeProbe());try{const video=await upload(other);
  await assert.rejects(other.generate({attemptId:ATTEMPT,input:{...INTENT,parameters:{...INTENT.parameters,resolution:"720P"}},video_handle:video.video_handle}),{code:"PREFLIGHT_FAILED"});assert.equal(g.counts.generationPosts,0);
 }finally{await other.close();}
});
