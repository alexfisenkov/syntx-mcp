import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerKlingMotionControlGenerationService, OwnerKlingMotionControlGenerationServiceError, OWNER_KLING_MOTION_CONTROL_GENERATION_CATALOG_VERSION } from "../src/application/owner-kling-motion-control-generation-service.js";
import { OwnerKlingMotionControlReferenceService } from "../src/application/owner-kling-motion-control-reference-service.js";
import { OwnerKlingMotionControlPresetReferenceService } from "../src/application/owner-kling-motion-control-preset-reference-service.js";
import { createOwnerKlingMotionControlRequestPreparer } from "../src/application/owner-kling-motion-control-request-preparer.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";

const ATTEMPT="link_motion_control_service_1628", BINDING={tenant_id:"motion-control-generation-1628",subject:"owner"}, NOW=Date.parse("2026-10-15T00:00:00Z");
const FFPROBE=process.env.SYNTX_MCV_TEST_FFPROBE??"/opt/homebrew/bin/ffprobe", FFMPEG=process.env.SYNTX_MCV_TEST_FFMPEG??"/opt/homebrew/bin/ffmpeg";
function crc32(b:Uint8Array){let c=0xffffffff;for(const x of b){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function png300(){const b=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=","base64");b.writeUInt32BE(300,16);b.writeUInt32BE(300,20);b.writeUInt32BE(crc32(b.subarray(12,29)),29);return b;}
function broker():SyntxCredentialBroker{return{async useCredential<T>(fn:(token:string)=>Promise<T>){return fn("synthetic-motion-control-1628-token");}};}
function response(v:unknown){return Response.json(v);}
async function clip(){const dir=await mkdtemp(join(tmpdir(),"mcv-generation-1628-")),path=join(dir,"motion.mp4");execFileSync(FFMPEG,["-hide_banner","-loglevel","error","-f","lavfi","-i","color=c=blue:s=320x320:r=24:d=3.4","-vf","setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709","-an","-pix_fmt","yuv420p","-c:v","libx264","-movflags","+faststart","-y",path]);return{dir,bytes:await readFile(path)};}
test("Motion Control service dispatches both owner reference modes once and recovers by GET with exact cost tuple",async()=>{
 const provider:AuthLinkProvider={authorizationProfile:OBSERVED_AUTHORIZATION_PROFILE,async createChallenge(){return{upstream_attempt_id:"synthetic",approval_url:"https://example.invalid/approve"};},async pollChallenge(_id,receive){await receive({scheme:"Bearer",value:"synthetic-link-token"});return{state:"LINKED"};}};
 const links=new PerUserLinkService(provider,new InMemoryAuthLinkStore(()=>NOW),{now:()=>NOW,defaultTtlMs:30*60_000,attemptIdGenerator:()=>ATTEMPT});await links.createAttempt(BINDING);await links.issueHandoff(BINDING,ATTEMPT);await links.checkAttempt(BINDING,ATTEMPT);
 const media=await clip(),png=png300();let now=NOW,expired=false,blockQuote=false,quoteEntered:(()=>void)|undefined,quotes:Record<string,unknown>[]=[],chats=0,posts=0,historyGets=0,resultGets=0,failResultGets=0;
 const prompts=new Map<string,string>();let fetchImpl!:typeof fetch;
 fetchImpl=async(input,init={})=>{
  const url=new URL(input instanceof Request?input.url:String(input)),method=init.method??"GET",body=typeof init.body==="string"?JSON.parse(init.body):undefined;
  if(url.pathname==="/api/v1/user/balance")return response({balance:"1000"});
  if(url.pathname==="/api/v1/user/subscription")return response({active:!expired,type:"PRO",end_date:expired?"2026-10-14T00:00:00Z":"2026-10-16T00:00:00Z"});
  if(url.pathname==="/api/v2/get_model_info"){quotes.push(Object.fromEntries(url.searchParams));if(blockQuote){blockQuote=false;quoteEntered?.();return new Promise<Response>((_resolve,reject)=>{const signal=init.signal??(input instanceof Request?input.signal:undefined);if(signal?.aborted)reject(new Error("fixture quote aborted"));else signal?.addEventListener("abort",()=>reject(new Error("fixture quote aborted")),{once:true});});}return response({access:true,cost:7,discount_cost:null,free_remaining_generations:null,limit:null,show_warning:false});}
  if(url.pathname==="/api/v1/kling/motions")return response([{name:"Preset",audio:"https://r2.syntx.ai/preset/motion.mp4",noaudio:"https://r2.syntx.ai/preset/motion.mp4"}]);
  if(url.pathname.endsWith("/upload-files")){const f=(init.body as FormData).get("files");assert.ok(f instanceof File);return response({files:[{filename:f.name,url:`https://r2.syntx.ai/owned/${f.name}`,mime_type:f.type,size:f.size}]});}
  if(url.pathname==="/api/v1/chats"&&method==="POST")return response({uuid:`motion-chat-${++chats}`});
  if(url.pathname==="/api/v1/video/generate"&&method==="POST"){posts++;assert.equal(url.search,"?ai_name=kling");assert.equal(body.settings.model_type,"kling_motion_control");assert.equal(body.settings.file_urls[0].type,"image");assert.equal(body.settings.file_urls[1].type,"video");prompts.set(`motion-chat-${posts}`,body.prompt);return response({id:`motion-ack-${posts}`});}
  const history=/^\/api\/v1\/chats\/([^/]+)\/messages$/u.exec(url.pathname);if(history){historyGets++;const id=history[1]!,n=Number(id.split("-").at(-1)),ack=`motion-ack-${n}`;return response({messages:[{id:ack,chat_id:421,author_id:27,message_object:[{id:`text-${id}`,message_id:ack,object_type:"text",model_type:"kling_motion_control",object_text:prompts.get(id)??""}]},{id:`bot-${id}`,chat_id:421,author_id:-1,message_object:[{id:`video-${id}`,message_id:`bot-${id}`,object_type:"video",model_type:"kling_motion_control",completed:true,object_url:"https://r2.syntx.ai/generated/motion.mp4"}]}],pagination:{page:1,page_size:10,total_count:2,total_pages:1,has_next:false,has_previous:false}});}
  const result=/^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);if(result){resultGets++;if(failResultGets>0){failResultGets--;throw new Error("fixture result read unavailable");}return response({id:result[2],chat_id:421,author_id:-1,message_object:[{id:`video-${result[1]}`,message_id:result[2],object_type:"video",model_type:"kling_motion_control",completed:true,object_url:"https://r2.syntx.ai/generated/motion.mp4"}]});}
  throw new Error(`unexpected synthetic route ${method} ${url.pathname}`);
 };
 const client=new SyntxChatHttpClient({credentialBroker:broker(),requestTimeoutMs:1_000,fetchImpl});
 const refs=new OwnerKlingMotionControlReferenceService({binding:BINDING,linkService:links,resolveClient:()=>client,ffprobePath:FFPROBE,now:()=>now});
 const presets=new OwnerKlingMotionControlPresetReferenceService({binding:BINDING,linkService:links,resolveClient:()=>client,ffprobePath:FFPROBE,now:()=>now,fetchImpl:(async()=>{const r=new Response(media.bytes as unknown as BodyInit,{status:200,headers:{"content-type":"video/mp4"}});Object.defineProperty(r,"url",{value:"https://r2.syntx.ai/preset/motion.mp4"});return r;}) as typeof fetch});
 const image=await refs.uploadImage({attemptId:ATTEMPT,filename:"motion.png",mime_type:"image/png",content_base64:png.toString("base64")});
 const video=await refs.uploadVideo({attemptId:ATTEMPT,filename:"motion.mp4",mime_type:"video/mp4",content_base64:media.bytes.toString("base64")});
 const library=await presets.listPresets({attemptId:ATTEMPT}),selected=await presets.selectPreset({attemptId:ATTEMPT,preset_handle:library.presets[0]!.preset_handle,variant:"audio"});
 const preparer=createOwnerKlingMotionControlRequestPreparer({referenceService:refs,presetReferenceService:presets,now:()=>now});
 const catalog=new DiscoveryCatalogRepository(loadPublicCatalogVersion(OWNER_KLING_MOTION_CONTROL_GENERATION_CATALOG_VERSION,`${process.cwd()}/catalog`));
 const service=new OwnerKlingMotionControlGenerationService({binding:BINDING,linkService:links,catalog,catalog_version:OWNER_KLING_MOTION_CONTROL_GENERATION_CATALOG_VERSION,preparer,resolveChatClient:()=>client,now:()=>now,
  createAccountStatusService:()=>new AccountStatusService(new SyntxHttpClient({credentialBroker:broker(),fetchImpl}),()=>now),
  createModelAccessService:()=>new ModelAccessService(catalog,new SyntxHttpClient({credentialBroker:broker(),fetchImpl}),()=>now)});
 const request=(source:"owned_video"|"service_preset",prompt:string)=>({attemptId:ATTEMPT,request:{model_id:"kling_motion_control" as const,reference_source:source,image_handle:image.image_handle,...(source==="owned_video"?{video_handle:video.video_handle}:{preset_video_handle:selected.preset_video_handle}),parameters:{model_id:"kling_motion_control",version:"3.0",mode:"hd",gen_type:"mcv",native_audio:false,video_duration:3},prompt}});
 try{
  let getterCalls=0;const unsafeParameters=Object.defineProperties({}, {model_id:{value:"kling_motion_control",enumerable:true},version:{get(){getterCalls++;return"3.0";},enumerable:true},mode:{value:"hd",enumerable:true},gen_type:{value:"mcv",enumerable:true},native_audio:{value:false,enumerable:true},video_duration:{value:3,enumerable:true}});
  assert.throws(()=>service.generate({attemptId:ATTEMPT,request:{model_id:"kling_motion_control",reference_source:"service_preset",image_handle:image.image_handle,preset_video_handle:selected.preset_video_handle,parameters:unsafeParameters}}),(e:unknown)=>e instanceof OwnerKlingMotionControlGenerationServiceError&&e.code==="INVALID_REQUEST");assert.equal(getterCalls,0);
  const owned=await service.generate(request("owned_video","owned intent"));assert.equal(owned.observed_artifact_count,1);assert.equal(posts,1);
  await assert.rejects(service.generate(request("owned_video","owned intent")),(e:unknown)=>e instanceof OwnerKlingMotionControlGenerationServiceError&&e.code==="INTENT_ALREADY_CLAIMED");assert.equal(posts,1);
  failResultGets=1;let recovery="";await assert.rejects(service.generate(request("service_preset","preset intent")),(e:unknown)=>{if(e instanceof OwnerKlingMotionControlGenerationServiceError&&e.code==="OUTCOME_UNKNOWN")recovery=e.recovery_id??"";return recovery.length>0;});assert.equal(posts,2);assert.equal(quotes.length,4);
  assert.deepEqual(quotes.map(x=>Object.keys(x).filter(k=>!["ai_name","model_type"].includes(k)).sort()),Array.from({length:4},()=>["gen_type","mode","native_audio","version","video_duration"].sort()));
  assert.ok(quotes.every(x=>x.mode==="hd"&&x.video_duration==="3"&&x.version==="3.0"&&x.native_audio==="false"&&x.gen_type==="mcv"));
  expired=true;await assert.rejects(service.generate(request("service_preset","expired subscription")),(e:unknown)=>e instanceof OwnerKlingMotionControlGenerationServiceError&&e.code==="PREFLIGHT_FAILED");assert.equal(chats,2);assert.equal(posts,2);
  expired=false;let entered!:()=>void;const quoteStarted=new Promise<void>(resolve=>{entered=resolve;});quoteEntered=entered;blockQuote=true;const pending=service.generate(request("service_preset","invalidate during preflight")).catch((e:unknown)=>e);await quoteStarted;
  const duplicate=(e:unknown)=>e instanceof OwnerKlingMotionControlGenerationServiceError&&e.code==="INTENT_ALREADY_CLAIMED";
  await assert.rejects(service.generate(request("service_preset","invalidate during preflight")),duplicate);await assert.rejects(service.generate(request("service_preset","invalidate during preflight")),duplicate);
  await service.invalidateAttempt(ATTEMPT);assert.ok(await pending instanceof OwnerKlingMotionControlGenerationServiceError);assert.equal(posts,2);quoteEntered=undefined;
  now+=16*60_000;await assert.rejects(preparer.prepare({attempt_id:ATTEMPT,model_id:"kling_motion_control",reference_source:"service_preset",image_handle:image.image_handle,preset_video_handle:selected.preset_video_handle,parameters:{model_id:"kling_motion_control",version:"3.0",mode:"hd",gen_type:"mcv",native_audio:false,video_duration:3}}));const preset=await service.reconcile({attemptId:ATTEMPT,recovery_id:recovery});assert.equal(preset.observed_artifact_count,1);assert.equal(posts,2);
  assert.equal((await service.getResultPage({attemptId:ATTEMPT,recovery_id:recovery})).observed_artifact_count,1);assert.equal(posts,2);
  assert.ok(historyGets>=2&&resultGets>=2);
 }finally{await service.close();await presets.close();await refs.close();await rm(media.dir,{recursive:true,force:true});png.fill(0);}
});
