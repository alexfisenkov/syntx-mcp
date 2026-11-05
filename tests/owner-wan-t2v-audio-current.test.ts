import assert from "node:assert/strict";
import { existsSync, realpathSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerWanT2vGenerationService } from "../src/application/owner-wan-t2v-generation-service.js";
import { createWanT2vAudioProbe } from "../src/application/owner-wan-t2v-audio-probe.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient } from "../src/adapter/syntx/http-client.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { registerSyntxOwnerWanT2vVideoTools } from "../src/mcp/owner-wan-t2v-video-tools.js";

const ATTEMPT="link_want2v_audio_current_0123456789abcdef", OTHER="link_want2v_audio_other_0123456789abcdef";
const AUDIO="https://r2.syntx.ai/synthetic/want2v-audio.wav", OUTPUT="https://r2.syntx.ai/synthetic/want2v-video.mp4";
const CATALOG="sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json";
const ffprobeCandidates = [process.env.SYNTX_MEDIA_FFPROBE_PATH, process.env.SYNTX_SUNO_TEST_FFPROBE,
  ...((process.env.PATH ?? "").split(delimiter).map(p => join(p, process.platform === "win32" ? "ffprobe.exe" : "ffprobe")))];
const FFPROBE = ffprobeCandidates.find(p => p && isAbsolute(p) && existsSync(p));
function wav(seconds:number) { const rate=8000,n=seconds*rate*2,b=Buffer.alloc(n+44);b.write("RIFF",0);b.writeUInt32LE(n+36,4);b.write("WAVEfmt ",8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write("data",36);b.writeUInt32LE(n,40);return b; }
function setup(loseUpload = false, model: "wan_26_t2v" | "wan_27_t2v" = "wan_26_t2v", loseGen = false, badDuplicate = false, revokeBeforePost = false) {
 if (!FFPROBE) throw new Error("trusted ffprobe is required for WAN T2V audio test");
 let now=Date.parse("2026-11-05T00:00:00Z");const counts={upload:0,chat:0,post:0,quote:0};
 const linkService = new PerUserLinkService({} as never, {async getSnapshot(_binding:unknown,attemptId:string){return {attempt_id:attemptId,authorization_profile:"OBSERVED_OWNER_AUTHORIZED" as const,status:revokeBeforePost&&counts.quote>=2?"REVOKED":"LINKED",expires_at:null,linked:!(revokeBeforePost&&counts.quote>=2)};}} as never);
 let lastBody: any;
 const fetchImpl:typeof fetch=async (input,init={})=>{const u=new URL(String(input));
  if(u.pathname.endsWith("user/balance"))return Response.json({balance:"1000"});
  if(u.pathname.endsWith("user/subscription"))return Response.json({active:true,type:"PRO",end_date:"2099-01-01T00:00:00.000Z"});
  if(u.pathname.endsWith("get_model_info")){counts.quote++;return Response.json({access:true,cost:1,discount_cost:null,free_remaining_generations:null,limit:null,show_warning:false});}
  if(u.pathname.endsWith("chats/upload-files")){counts.upload++;const f=init.body as FormData;assert.equal(f.get("model_type"),model);assert.equal(f.get("destination"),"uploaded");assert.equal(f.get("check_duplicates"),"true");if(loseUpload)throw Error("lost ack");const file=f.get("files") as File;return Response.json({files:[{url:AUDIO,size:file.size,mime_type:file.type,...(badDuplicate?{status:"duplicate"}:{})}]});}
  if(u.pathname==="/api/v1/chats"){counts.chat++;return Response.json({uuid:"wan-audio-chat"});}
  if(u.pathname.endsWith("video/generate")){counts.post++;lastBody=JSON.parse(String(init.body));if(loseGen)throw Error("lost generation ack");return Response.json({id:100});}
  if(u.pathname.endsWith("wan-audio-chat/messages"))return Response.json({messages:[{id:100,chat_id:200,author_id:30,message_object:[{id:101,message_id:100,object_type:"audio",model_type:model}]},{id:102,chat_id:200,author_id:-1,message_object:[{id:103,message_id:102,object_type:"video",model_type:model}]}],pagination:{page:1,page_size:10,total_count:2,total_pages:1,has_next:false,has_previous:false}});
  if(u.pathname.endsWith("wan-audio-chat/102"))return Response.json({id:102,chat_id:200,author_id:-1,message_object:[{id:103,message_id:102,object_type:"video",model_type:model,completed:true,object_url:OUTPUT}]});
  if(u.pathname.endsWith("inprogress"))return Response.json([]);throw Error("unexpected fake request");};
 const broker={async useCredential<T>(use:(s:string)=>Promise<T>){return use("synthetic-credential-long-enough");}};
 const chat=new SyntxChatHttpClient({credentialBroker:broker,fetchImpl}),catalog=new DiscoveryCatalogRepository(loadPublicCatalogVersion(CATALOG));
 const service=new OwnerWanT2vGenerationService({binding:{tenant_id:"synthetic-wan-audio",subject:"synthetic-owner"},linkService,catalog,catalog_version:CATALOG,
  resolveChatClient:()=>chat,createAccountStatusService:()=>new AccountStatusService(new SyntxHttpClient({credentialBroker:broker,fetchImpl}),()=>now),
  createModelAccessService:(_id:string,c=catalog)=>new ModelAccessService(c,new SyntxHttpClient({credentialBroker:broker,fetchImpl}),()=>now),
  now:()=>now,pollDelayMs:0,maxPollAttempts:1,audioProbe:createWanT2vAudioProbe(realpathSync(FFPROBE))});
 return {service,counts,body:()=>lastBody,advance:(ms:number)=>{now+=ms;}};
}
const params={resolution:"720P",aspect_ratio:"1:1",video_duration:5,prompt_extend:true,seed:null,shot_type:"single"};
test("WAN T2V owned audio uses source-bound upload, SDK schema, quote and typed one-shot wire",async()=>{
 const f=setup(),server=new McpServer({name:"wan-audio",version:"1"});registerSyntxOwnerWanT2vVideoTools(server,{generationService:f.service});
 const [caller,host]=InMemoryTransport.createLinkedPair(),client=new Client({name:"wan-audio",version:"1"});
 try {await server.connect(host);await client.connect(caller);const tools=(await client.listTools()).tools;assert.ok(tools.some(x=>x.name==="syntx_owner_upload_wan_t2v_audio"));
 const source=await client.callTool({name:"syntx_get_wan_t2v_parameters",arguments:{model_id:"wan_26_t2v"}});
 assert.equal(source.isError,undefined,JSON.stringify(source));assert.equal((source.structuredContent as {current_audio_reference_source:{build_id:string}}).current_audio_reference_source.build_id,"1793890358");
 const upload=await client.callTool({name:"syntx_owner_upload_wan_t2v_audio",arguments:{link_attempt_id:ATTEMPT,model_id:"wan_26_t2v",filename:"sound.wav",mime_type:"audio/wav",content_base64:wav(4).toString("base64")}});
 assert.equal(upload.isError,undefined,JSON.stringify(upload));assert.equal(JSON.stringify(upload).includes(AUDIO),false);
 const handle=(upload.structuredContent as {audio_handle:string}).audio_handle;
 const foreign=await client.callTool({name:"syntx_owner_generate_wan_t2v_video",arguments:{link_attempt_id:OTHER,model_id:"wan_26_t2v",prompt:"distinct",parameters:params,audio_handle:handle}});
 assert.equal(foreign.isError,true);assert.equal(f.counts.chat,0);
 const wrongModel=await client.callTool({name:"syntx_owner_generate_wan_t2v_video",arguments:{link_attempt_id:ATTEMPT,model_id:"wan_27_t2v",prompt:"distinct",parameters:{resolution:"720P",aspect_ratio:"1:1",video_duration:5,prompt_extend:true,seed:null,native_audio:false},audio_handle:handle}});
 assert.equal(wrongModel.isError,true);assert.equal(f.counts.chat,0);
 const generated=await client.callTool({name:"syntx_owner_generate_wan_t2v_video",arguments:{link_attempt_id:ATTEMPT,model_id:"wan_26_t2v",prompt:"sound-driven scene",parameters:params,audio_handle:handle}});
 assert.equal(generated.isError,undefined,JSON.stringify(generated));assert.equal((generated.structuredContent as {status:string}).status,"completed");
 assert.deepEqual(f.body().settings.file_urls,[{type:"audio",url:AUDIO}]);assert.equal(f.counts.post,1);assert.equal(f.counts.quote,2);
 } finally {await client.close();await server.close();await f.service.close();}
});

test("WAN 2.7 accepts its 2 second audio boundary and retains model binding",async()=>{
 const f=setup(false,"wan_27_t2v");try {const request={model_id:"wan_27_t2v",filename:"sound.wav",mime_type:"audio/wav",content_base64:wav(2).toString("base64")};
  const uploaded=await f.service.uploadAudioReference({attemptId:ATTEMPT,request});assert.equal(uploaded.duration_seconds,2);
  const result=await f.service.generate({attemptId:ATTEMPT,input:{model_id:"wan_27_t2v",prompt:"test",parameters:{resolution:"720P",aspect_ratio:"1:1",video_duration:5,prompt_extend:true,seed:null,native_audio:false}},audio_handle:uploaded.audio_handle});
  assert.equal(result.status,"completed");assert.deepEqual(f.body().settings.file_urls,[{type:"audio",url:AUDIO}]);assert.equal(f.counts.post,1);
 }finally{await f.service.close();}
});

test("WAN T2V audio unknown generation stays GET-only and cannot replay",async()=>{
 const f=setup(false,"wan_26_t2v",true);try {const request={model_id:"wan_26_t2v",filename:"sound.wav",mime_type:"audio/wav",content_base64:wav(4).toString("base64")};
  const uploaded=await f.service.uploadAudioReference({attemptId:ATTEMPT,request});
  const intent={attemptId:ATTEMPT,input:{model_id:"wan_26_t2v",prompt:"sound-driven scene",parameters:params},audio_handle:uploaded.audio_handle};
  const error=await f.service.generate(intent).catch(e=>e);assert.equal(error.code,"OUTCOME_UNKNOWN");assert.ok(error.recovery_id);assert.equal(f.counts.post,1);
  await assert.rejects(f.service.generate(intent),{code:"INTENT_ALREADY_CLAIMED"});
  await assert.rejects(f.service.reconcile({attemptId:ATTEMPT,recovery_id:error.recovery_id}),{code:"OUTCOME_UNKNOWN"});assert.equal(f.counts.post,1);
 }finally{await f.service.close();}
});

test("WAN T2V bad duration and uncertain upload fail without replay",async()=>{
 const f=setup(true);try {const request={model_id:"wan_26_t2v",filename:"sound.wav",mime_type:"audio/wav",content_base64:wav(4).toString("base64")};
 await assert.rejects(f.service.uploadAudioReference({attemptId:ATTEMPT,request:{...request,content_base64:wav(2).toString("base64")}}));assert.equal(f.counts.upload,0);
 await assert.rejects(f.service.uploadAudioReference({attemptId:ATTEMPT,request}),{code:"UPLOAD_OUTCOME_UNKNOWN"});
 await assert.rejects(f.service.uploadAudioReference({attemptId:ATTEMPT,request}),{code:"REFERENCE_UNAVAILABLE"});assert.equal(f.counts.upload,1);assert.equal(f.counts.post,0);
 } finally {await f.service.close();}
});

test("WAN T2V rejects an unbound duplicate acknowledgement and does not retry",async()=>{
 const f=setup(false,"wan_26_t2v",false,true);try{const request={model_id:"wan_26_t2v",filename:"sound.wav",mime_type:"audio/wav",content_base64:wav(4).toString("base64")};
  await assert.rejects(f.service.uploadAudioReference({attemptId:ATTEMPT,request}),{code:"UPLOAD_OUTCOME_UNKNOWN"});
  await assert.rejects(f.service.uploadAudioReference({attemptId:ATTEMPT,request}),{code:"REFERENCE_UNAVAILABLE"});assert.equal(f.counts.upload,1);
 }finally{await f.service.close();}
});

test("WAN T2V expired or revoked audio handle cannot authorize a POST",async()=>{
 const f=setup();try {const request={model_id:"wan_26_t2v",filename:"sound.wav",mime_type:"audio/wav",content_base64:wav(4).toString("base64")};
  const uploaded=await f.service.uploadAudioReference({attemptId:ATTEMPT,request});f.advance(900_001);
  await assert.rejects(f.service.generate({attemptId:ATTEMPT,input:{model_id:"wan_26_t2v",prompt:"test",parameters:params},audio_handle:uploaded.audio_handle}),{code:"REFERENCE_UNAVAILABLE"});
  assert.equal(f.counts.chat,0);assert.equal(f.counts.post,0);
 }finally{await f.service.close();}
 const g=setup();try {const request={model_id:"wan_26_t2v",filename:"sound.wav",mime_type:"audio/wav",content_base64:wav(4).toString("base64")};
  const uploaded=await g.service.uploadAudioReference({attemptId:ATTEMPT,request});await g.service.invalidateAttempt(ATTEMPT);
  await assert.rejects(g.service.generate({attemptId:ATTEMPT,input:{model_id:"wan_26_t2v",prompt:"test",parameters:params},audio_handle:uploaded.audio_handle}));
  assert.equal(g.counts.chat,0);assert.equal(g.counts.post,0);
 }finally{await g.service.close();}
});

test("WAN T2V audio principal revocation before dispatch blocks POST",async()=>{
 const f=setup(false,"wan_26_t2v",false,false,true);try{const request={model_id:"wan_26_t2v",filename:"sound.wav",mime_type:"audio/wav",content_base64:wav(4).toString("base64")};
  const uploaded=await f.service.uploadAudioReference({attemptId:ATTEMPT,request});
  await assert.rejects(f.service.generate({attemptId:ATTEMPT,input:{model_id:"wan_26_t2v",prompt:"test",parameters:params},audio_handle:uploaded.audio_handle}));
  assert.equal(f.counts.chat,1);assert.equal(f.counts.quote,2);assert.equal(f.counts.post,0);
 }finally{await f.service.close();}
});

test("WAN T2V audio native operation rejects a forged token before network",async()=>{
 let calls=0;const client=new SyntxChatHttpClient({credentialBroker:{async useCredential<T>(use:(value:string)=>Promise<T>){return use("synthetic-credential-long-enough");}},
  fetchImpl:async()=>{calls++;throw Error("unexpected network");}});
 await assert.rejects(client.startOwnerWanT2vAudioOperation(Object.freeze({})));assert.equal(calls,0);
});
