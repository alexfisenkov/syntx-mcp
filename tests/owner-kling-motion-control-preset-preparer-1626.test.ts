import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { OwnerKlingMotionControlReferenceService } from "../src/application/owner-kling-motion-control-reference-service.js";
import { OwnerKlingMotionControlPresetReferenceService, readOwnerKlingMotionControlPresetVideoReferenceForClient } from "../src/application/owner-kling-motion-control-preset-reference-service.js";
import { createOwnerKlingMotionControlRequestPreparer, readOwnerKlingMotionControlNativeBindingForClient } from "../src/application/owner-kling-motion-control-request-preparer.js";
import { consumeOwnerKlingMotionControlOneShotPermit, createOwnerKlingMotionControlOneShotPermit } from "../src/application/owner-kling-motion-control-one-shot-policy.js";

const ATTEMPT = "link_mcv_bothowner_0123456789", BINDING = Object.freeze({ tenant_id: "mcv-both-test", subject: "owner" });
const NOW = Date.parse("2026-10-15T00:00:00Z"), FFPROBE = process.env.SYNTX_MCV_TEST_FFPROBE ?? "/opt/homebrew/bin/ffprobe";
const FFMPEG = process.env.SYNTX_MCV_TEST_FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
function crc32(bytes: Uint8Array): number { let c=0xffff_ffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb8_8320:0);}return(c^0xffff_ffff)>>>0; }
function png300(): Buffer { const b=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=","base64");b.writeUInt32BE(300,16);b.writeUInt32BE(300,20);b.writeUInt32BE(crc32(b.subarray(12,29)),29);return b; }
function broker(): SyntxCredentialBroker { return {async useCredential<T>(f:(token:string)=>Promise<T>){return f("synthetic-mcv-test-token");}}; }
async function linked(){const provider:AuthLinkProvider={authorizationProfile:"OBSERVED_OWNER_AUTHORIZED",async createChallenge(){return{upstream_attempt_id:"x",approval_url:"https://example.invalid"};},async pollChallenge(_id,receive){await receive({scheme:"Bearer",value:"synthetic-token"});return{state:"LINKED"};}};
  const auth=new PerUserLinkService(provider,new InMemoryAuthLinkStore(()=>NOW),{now:()=>NOW,defaultTtlMs:30*60_000,attemptIdGenerator:()=>ATTEMPT});await auth.createAttempt(BINDING);await auth.issueHandoff(BINDING,ATTEMPT);await auth.checkAttempt(BINDING,ATTEMPT);return auth;}
async function clip(seconds=3.4){const dir=await mkdtemp(join(tmpdir(),"mcv-both-1626-")),path=join(dir,"preset.mp4");execFileSync(FFMPEG,["-hide_banner","-loglevel","error","-f","lavfi","-i",`color=c=blue:s=320x320:r=24:d=${seconds}`,"-vf","setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709","-an","-pix_fmt","yuv420p","-c:v","libx264","-movflags","+faststart","-y",path]);return{dir,bytes:await readFile(path)};}
function response(status:number,body:unknown,url=""){const r=body instanceof Uint8Array?new Response(Buffer.from(body) as BodyInit,{status}):Response.json(body,{status});if(url)Object.defineProperty(r,"url",{value:url});return r;}
function params(duration:number,gen_type:"mcv"|"mci"="mcv",native_audio=false){return{model_id:"kling_motion_control",version:"3.0",mode:"hd",gen_type,native_audio,video_duration:duration};}
async function fixture(seconds=3.4){const auth=await linked(),media=await clip(seconds),client=new SyntxChatHttpClient({credentialBroker:broker(),requestTimeoutMs:1_000,fetchImpl:async(input,init)=>{
    const path=new URL(String(input)).pathname;if(path==="/api/v1/kling/motions")return response(200,[{name:"Selected",audio:"https://r2.syntx.ai/preset/actual.mp4",noaudio:"https://r2.syntx.ai/preset/actual.mp4",audio_preview:"https://r2.syntx.ai/preset/preview.mp4",noaudio_preview:"https://r2.syntx.ai/preset/preview.mp4"}]);
    const form=init?.body as FormData,file=form.get("files");assert.ok(file instanceof File);return Response.json({files:[{filename:file.name,url:`https://r2.syntx.ai/owned/${file.name}`,mime_type:file.type,size:file.size}]});}});
  const refs=new OwnerKlingMotionControlReferenceService({binding:BINDING,linkService:auth,resolveClient:()=>client,ffprobePath:FFPROBE,now:()=>NOW});
  const presets=new OwnerKlingMotionControlPresetReferenceService({binding:BINDING,linkService:auth,resolveClient:()=>client,ffprobePath:FFPROBE,now:()=>NOW,
    fetchImpl:(async(input,init)=>{assert.equal(String(input),"https://r2.syntx.ai/preset/actual.mp4");assert.equal(init?.credentials,"omit");return response(200,media.bytes,String(input));}) as typeof fetch});
  const image=await refs.uploadImage({attemptId:ATTEMPT,filename:"motion.png",mime_type:"image/png",content_base64:png300().toString("base64")});
  const library=await presets.listPresets({attemptId:ATTEMPT}), preset=library.presets[0]!;
  const selected=await presets.selectPreset({attemptId:ATTEMPT,preset_handle:preset.preset_handle,variant:"audio"});
  const preparer=createOwnerKlingMotionControlRequestPreparer({referenceService:refs,presetReferenceService:presets,now:()=>NOW});
  return{auth,media,client,refs,presets,image,selected,preparer,close:async()=>{await preparer.close();await presets.close();await refs.close();await rm(media.dir,{recursive:true,force:true});}};}
function input(f:Awaited<ReturnType<typeof fixture>>, duration:number, gen_type:"mcv"|"mci"="mcv", native_audio=false, prompt?:string){return{attempt_id:ATTEMPT,model_id:"kling_motion_control",reference_source:"service_preset",image_handle:f.image.image_handle,preset_video_handle:f.selected.preset_video_handle,parameters:params(duration,gen_type,native_audio),...(prompt===undefined?{}:{prompt})};}

test("selected service-preset joins the owned image into a private typed native pair",async()=>{const f=await fixture();try{
  const candidate=await f.preparer.prepare(input(f,Math.round(f.selected.duration_seconds),"mcv",false,"  raw prompt  ")),request=f.preparer.getPrivateRequest(candidate);
  assert.equal(candidate.reference_source,"service_preset");assert.equal(request.prompt,"  raw prompt  ");assert.deepEqual(request.settings.file_urls.map((x)=>x.type),["image","video"]);
  assert.deepEqual(request.settings.file_urls.map((x)=>x.url),["https://r2.syntx.ai/owned/motion.png","https://r2.syntx.ai/preset/actual.mp4"]);
  assert.equal(Object.hasOwn(request.settings,"motion"),false);assert.equal(request.settings.native_audio,false);assert.equal(JSON.stringify(candidate).includes("https://"),false);
  assert.equal(candidate.video.mime_type,"video/mp4");
  const binding=f.preparer.getNativeBindingForClient(f.client,candidate),contexts=readOwnerKlingMotionControlNativeBindingForClient(f.client,binding);
  assert.equal(readOwnerKlingMotionControlNativeBindingForClient(Object.create(SyntxChatHttpClient.prototype) as SyntxChatHttpClient,binding),null);
  assert.deepEqual(contexts?.map((x)=>"media_type" in x?x.media_type:x.status),["image","native_service_preset_video"]);
  assert.deepEqual(readOwnerKlingMotionControlPresetVideoReferenceForClient(f.client,contexts?.[1]),{uri:"https://r2.syntx.ai/preset/actual.mp4",sha256:f.selected.sha256,duration_seconds:f.selected.duration_seconds,variant:"audio"});
  const candidateBinding=f.preparer.inspectCandidate(candidate)!;
  const permit=await createOwnerKlingMotionControlOneShotPermit({preparer:f.preparer,candidate,principal:candidateBinding.principal,attemptId:ATTEMPT});
  const consumed=consumeOwnerKlingMotionControlOneShotPermit({preparer:f.preparer,candidate,principal:candidateBinding.principal,attemptId:ATTEMPT,permit});
  assert.deepEqual(consumed.request,request);
  assert.throws(()=>consumeOwnerKlingMotionControlOneShotPermit({preparer:f.preparer,candidate,principal:candidateBinding.principal,attemptId:ATTEMPT,permit}));
}finally{await f.close();}});

test("preset variant stays independent from native audio and empty prompt is preserved",async()=>{const f=await fixture();try{
  const candidate=await f.preparer.prepare(input(f,Math.round(f.selected.duration_seconds),"mcv",true,"")),request=f.preparer.getPrivateRequest(candidate);
  assert.equal(request.prompt,"");assert.equal(request.settings.native_audio,true);assert.equal(candidate.reference_source,"service_preset");
  await assert.rejects(f.preparer.prepare(input(f,Math.round(f.selected.duration_seconds)+1)),(e:unknown)=>typeof e==="object"&&e!==null&&"code" in e&&(e as {code:string}).code==="PARAMETERS_INVALID");
}finally{await f.close();}});

test("raw MCI duration above ten seconds is rejected even when its rounded value is ten",async()=>{const f=await fixture(10.1);try{
  await assert.rejects(f.preparer.prepare(input(f,10,"mci")),(e:unknown)=>typeof e==="object"&&e!==null&&"code" in e&&(e as {code:string}).code==="REFERENCE_EXPIRED");
}finally{await f.close();}});

test("caller clones and a service-preset resolution cannot stand in for selected handles",async()=>{const f=await fixture();try{
  const cloned=Object.freeze({...f.selected});
  assert.throws(()=>f.presets.withNativePresetVideo(cloned,{attempt_id:ATTEMPT,preset_video_handle:f.selected.preset_video_handle},()=>true));
  const candidate=await f.preparer.prepare(input(f,Math.round(f.selected.duration_seconds)));
  assert.equal(f.preparer.inspectCandidate({...candidate}),undefined);
  await f.preparer.close();assert.equal(f.preparer.inspectCandidate(candidate),undefined);
  assert.equal((await f.presets.resolvePresetVideo({attempt_id:ATTEMPT,preset_video_handle:f.selected.preset_video_handle})).generation_permit,false,"preparer close does not close its borrowed preset service");
  await f.preparer.invalidateAttempt(ATTEMPT);
  await assert.rejects(f.presets.resolvePresetVideo({attempt_id:ATTEMPT,preset_video_handle:f.selected.preset_video_handle}));
}finally{await f.close();}});
