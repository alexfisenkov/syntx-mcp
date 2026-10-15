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
import { createOwnerKlingMotionControlRequestPreparer, readOwnerKlingMotionControlNativeBindingForClient,
  OwnerKlingMotionControlRequestPreparerError } from "../src/application/owner-kling-motion-control-request-preparer.js";
import { createOwnerKlingMotionControlOneShotPermit, consumeOwnerKlingMotionControlOneShotPermit,
  OwnerKlingMotionControlOneShotPolicyError } from "../src/application/owner-kling-motion-control-one-shot-policy.js";

const ATTEMPT = "link_mcv_owner_0123456789", BINDING = Object.freeze({ tenant_id: "mcv-preparer-test", subject: "owner" });
const NOW = Date.parse("2026-10-15T00:00:00Z"), FFPROBE = process.env.SYNTX_MCV_TEST_FFPROBE ?? "/opt/homebrew/bin/ffprobe";
const FFMPEG = process.env.SYNTX_MCV_TEST_FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
function crc32(bytes: Uint8Array): number { let c=0xffff_ffff; for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb8_8320:0);}return(c^0xffff_ffff)>>>0; }
function png300(): Buffer { const b=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=","base64"); b.writeUInt32BE(300,16);b.writeUInt32BE(300,20);b.writeUInt32BE(crc32(b.subarray(12,29)),29);return b; }
function broker(): SyntxCredentialBroker { return { async useCredential<T>(f:(token:string)=>Promise<T>){return f("synthetic-test-token");} }; }
async function linked() { const provider:AuthLinkProvider={authorizationProfile:"OBSERVED_OWNER_AUTHORIZED",async createChallenge(){return{upstream_attempt_id:"x",approval_url:"https://example.invalid"};},async pollChallenge(_id,receive){await receive({scheme:"Bearer",value:"synthetic-token"});return{state:"LINKED"};}};
  const store=new InMemoryAuthLinkStore(()=>NOW), auth=new PerUserLinkService(provider,store,{now:()=>NOW,defaultTtlMs:30*60_000,attemptIdGenerator:()=>ATTEMPT});
  await auth.createAttempt(BINDING);await auth.issueHandoff(BINDING,ATTEMPT);await auth.checkAttempt(BINDING,ATTEMPT);return auth; }
async function videoFile(seconds=3.2) { const dir=await mkdtemp(join(tmpdir(),"mcv-1622-")),path=join(dir,"motion.mp4");
  execFileSync(FFMPEG,["-hide_banner","-loglevel","error","-f","lavfi","-i",`color=c=blue:s=320x320:r=24:d=${seconds}`,"-vf","setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709","-an","-pix_fmt","yuv420p","-c:v","libx264","-movflags","+faststart","-y",path]);return{dir,bytes:await readFile(path)}; }
function makeClient() { return new SyntxChatHttpClient({credentialBroker:broker(),fetchImpl:async(_url,init)=>{const form=init?.body as FormData,file=form.get("files");assert.ok(file instanceof File);
  const media=String(form.get("model_type"));assert.equal(media,"kling_motion_control");return Response.json({files:[{filename:file.name,url:`https://r2.syntx.ai/owned/${file.name}`,mime_type:file.type,size:file.size}]});},requestTimeoutMs:1_000}); }
function upload(filename:string,mime_type:string,bytes:Buffer){return{attemptId:ATTEMPT,filename,mime_type,content_base64:bytes.toString("base64")};}
async function fixture(seconds=3.2) { let clock=NOW;const auth=await linked(),client=makeClient(),media=await videoFile(seconds),refs=new OwnerKlingMotionControlReferenceService({binding:BINDING,linkService:auth,resolveClient:()=>client,ffprobePath:FFPROBE,now:()=>NOW});
  const image=await refs.uploadImage(upload("motion.png","image/png",png300())),video=await refs.uploadVideo(upload("motion.mp4","video/mp4",media.bytes));
  const preparer=createOwnerKlingMotionControlRequestPreparer({referenceService:refs,now:()=>clock});return{auth,client,media,refs,image,video,preparer,advance:(ms:number)=>{clock+=ms;},close:async()=>{await preparer.close();await refs.close();await rm(media.dir,{recursive:true,force:true});}}; }
function params(duration:number,gen_type:"mcv"|"mci"="mcv") { return {model_id:"kling_motion_control",version:"3.0",mode:"hd",gen_type,native_audio:false,video_duration:duration}; }
const request=(f:Awaited<ReturnType<typeof fixture>>,duration:number,prompt?:string)=>f.preparer.prepare({attempt_id:ATTEMPT,model_id:"kling_motion_control",reference_source:"owned_video",image_handle:f.image.image_handle,video_handle:f.video.video_handle,parameters:params(duration),...(prompt===undefined?{}:{prompt})});

test("actual typed own-pair capture prepares exact wire and consumes a genuine local permit once",async()=>{const f=await fixture();try{
  const duration=Math.round(f.video.duration_seconds),candidate=await request(f,duration,"  raw prompt  "),binding=f.preparer.inspectCandidate(candidate)!;
  assert.ok(binding);const privateRequest=f.preparer.getPrivateRequest(candidate);assert.equal(privateRequest.prompt,"  raw prompt  ");
  assert.equal(Object.isFrozen(privateRequest.settings.file_urls),true);assert.equal(Object.isFrozen(privateRequest.settings.file_urls[0]),true);
  const originalUrl=privateRequest.settings.file_urls[0].url;assert.equal(Reflect.set(privateRequest.settings.file_urls[0],"url","https://attacker.invalid/"),false);
  assert.equal(privateRequest.settings.file_urls[0].url,originalUrl);
  assert.deepEqual(privateRequest.settings.file_urls.map(x=>x.type),["image","video"]);assert.deepEqual(privateRequest.settings.file_urls.map(x=>x.url),[
    `https://r2.syntx.ai/owned/motion.png`,`https://r2.syntx.ai/owned/motion.mp4`]);assert.equal(JSON.stringify(candidate).includes("https://"),false);
  const native=f.preparer.getNativeBindingForClient(f.client,candidate);assert.deepEqual(readOwnerKlingMotionControlNativeBindingForClient(f.client,native)?.map(x=>x.media_type),["image","video"]);
  assert.equal(readOwnerKlingMotionControlNativeBindingForClient(makeClient(),native),null);
  const alternate=await f.preparer.prepare({attempt_id:ATTEMPT,model_id:"kling_motion_control",reference_source:"owned_video",image_handle:f.image.image_handle,
    video_handle:f.video.video_handle,parameters:{...params(duration,"mci"),mode:"standart"}});
  assert.equal(f.preparer.getPrivateRequest(alternate).settings.mode,"standart");assert.equal(f.preparer.getPrivateRequest(alternate).settings.gen_type,"mci");
  const pair=await f.refs.resolveOwnPair({attempt_id:ATTEMPT,image_handle:f.image.image_handle,video_handle:f.video.video_handle});
  await assert.rejects(createOwnerKlingMotionControlOneShotPermit({preparer:f.preparer,candidate,principal:{...pair.principal,subject_id:"foreign"},attemptId:ATTEMPT}),
    (e:unknown)=>e instanceof OwnerKlingMotionControlOneShotPolicyError&&e.code==="PRINCIPAL_MISMATCH");
  const permit=await createOwnerKlingMotionControlOneShotPermit({preparer:f.preparer,candidate,principal:pair.principal,attemptId:ATTEMPT});
  const receipt=consumeOwnerKlingMotionControlOneShotPermit({preparer:f.preparer,candidate,principal:pair.principal,attemptId:ATTEMPT,permit});
  assert.equal(receipt.request_fingerprint,binding.request_fingerprint);assert.deepEqual(receipt.request,privateRequest);
  assert.throws(()=>consumeOwnerKlingMotionControlOneShotPermit({preparer:f.preparer,candidate,principal:pair.principal,attemptId:ATTEMPT,permit}),
    (e:unknown)=>e instanceof OwnerKlingMotionControlOneShotPolicyError&&e.code==="PERMIT_ALREADY_CONSUMED");
}finally{await f.close();}});

test("omitted and empty prompts remain explicit empty raw text; raw 10.1 second MCI is rejected despite duration candidate 10",async()=>{
  const f=await fixture(10.1);try{const empty=await request(f,10,""),omitted=await request(f,10);assert.equal(f.preparer.getPrivateRequest(empty).prompt,"");assert.equal(f.preparer.getPrivateRequest(omitted).prompt,"");
    await assert.rejects(f.preparer.prepare({attempt_id:ATTEMPT,model_id:"kling_motion_control",reference_source:"owned_video",image_handle:f.image.image_handle,
      video_handle:f.video.video_handle,parameters:params(10,"mci"),prompt:"x"}),(e:unknown)=>e instanceof OwnerKlingMotionControlRequestPreparerError&&e.code==="REFERENCE_EXPIRED");
  }finally{await f.close();}});

test("closed parameter accessor and cloned candidate cannot mint authority",async()=>{const f=await fixture();try{const candidate=await request(f,Math.round(f.video.duration_seconds));const pair=await f.refs.resolveOwnPair({attempt_id:ATTEMPT,image_handle:f.image.image_handle,video_handle:f.video.video_handle});
  assert.equal(f.preparer.inspectCandidate({...candidate}),undefined);const cloned=Object.freeze({...candidate});
  await assert.rejects(createOwnerKlingMotionControlOneShotPermit({preparer:f.preparer,candidate:cloned,principal:pair.principal,attemptId:ATTEMPT}));
  const mutable=params(Math.round(f.video.duration_seconds)),pending=f.preparer.prepare({attempt_id:ATTEMPT,model_id:"kling_motion_control",reference_source:"owned_video",image_handle:f.image.image_handle,video_handle:f.video.video_handle,parameters:mutable});
  mutable.video_duration=30;const snap=await pending;assert.notEqual(f.preparer.getPrivateRequest(snap).settings.video_duration,30);
  const bad={model_id:"kling_motion_control",version:"3.0",mode:"hd",gen_type:"mcv",native_audio:false,video_duration:3};Object.defineProperty(bad,"mode",{get(){throw new Error("accessor invoked");}});
  await assert.rejects(f.preparer.prepare({attempt_id:ATTEMPT,model_id:"kling_motion_control",reference_source:"owned_video",image_handle:f.image.image_handle,video_handle:f.video.video_handle,parameters:bad}));
}finally{await f.close();}});

test("candidate input TTL invalidates permit",async()=>{const f=await fixture();try{const candidate=await request(f,Math.round(f.video.duration_seconds),"ttl-intent");const pair=await f.refs.resolveOwnPair({attempt_id:ATTEMPT,image_handle:f.image.image_handle,video_handle:f.video.video_handle});
  const permit=await createOwnerKlingMotionControlOneShotPermit({preparer:f.preparer,candidate,principal:pair.principal,attemptId:ATTEMPT});f.advance(900_000);
  assert.throws(()=>consumeOwnerKlingMotionControlOneShotPermit({preparer:f.preparer,candidate,principal:pair.principal,attemptId:ATTEMPT,permit}));
}finally{await f.close();}});

test("explicit attempt revocation removes candidate binding before permit consumption",async()=>{const f=await fixture();try{const candidate=await request(f,Math.round(f.video.duration_seconds),"revoke-intent");const pair=await f.refs.resolveOwnPair({attempt_id:ATTEMPT,image_handle:f.image.image_handle,video_handle:f.video.video_handle});
  const permit=await createOwnerKlingMotionControlOneShotPermit({preparer:f.preparer,candidate,principal:pair.principal,attemptId:ATTEMPT});await f.preparer.invalidateAttempt(ATTEMPT);
  assert.equal(f.preparer.inspectCandidate(candidate),undefined);assert.throws(()=>consumeOwnerKlingMotionControlOneShotPermit({preparer:f.preparer,candidate,principal:pair.principal,attemptId:ATTEMPT,permit}));
}finally{await f.close();}});

test("close and attempt invalidation abort and drain only the preparer's blocked resolution",async()=>{
  for(const action of ["close","invalidate"] as const){const f=await fixture();let entered=false,release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
    const original=f.auth.getStatus.bind(f.auth);f.auth.getStatus=async(...args:Parameters<typeof f.auth.getStatus>)=>{entered=true;await gate;return original(...args);};
    const work=f.preparer.prepare({attempt_id:ATTEMPT,model_id:"kling_motion_control",reference_source:"owned_video",image_handle:f.image.image_handle,
      video_handle:f.video.video_handle,parameters:params(Math.round(f.video.duration_seconds))});
    while(!entered)await new Promise(resolve=>setImmediate(resolve));let settled=false;
    const barrier=action==="close"?f.preparer.close():f.preparer.invalidateAttempt(ATTEMPT);void barrier.then(()=>{settled=true;});
    await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false,`${action} must wait for its own blocked prepare operation`);
    release();await assert.rejects(work);await barrier;assert.equal(settled,true);await f.close();
  }
});

test("candidate and pending reservations share the 128-entry capacity",async()=>{const f=await fixture();try{
  for(let i=0;i<127;i++)await f.preparer.prepare({attempt_id:ATTEMPT,model_id:"kling_motion_control",reference_source:"owned_video",image_handle:f.image.image_handle,
    video_handle:f.video.video_handle,parameters:params(Math.round(f.video.duration_seconds)),prompt:`capacity-${i}`});
  let entered=false,release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const original=f.auth.getStatus.bind(f.auth);
  f.auth.getStatus=async(...args:Parameters<typeof f.auth.getStatus>)=>{entered=true;await gate;return original(...args);};
  const pending=f.preparer.prepare({attempt_id:ATTEMPT,model_id:"kling_motion_control",reference_source:"owned_video",image_handle:f.image.image_handle,
    video_handle:f.video.video_handle,parameters:params(Math.round(f.video.duration_seconds)),prompt:"capacity-final"});
  while(!entered)await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(f.preparer.prepare({attempt_id:ATTEMPT,model_id:"kling_motion_control",reference_source:"owned_video",image_handle:f.image.image_handle,
    video_handle:f.video.video_handle,parameters:params(Math.round(f.video.duration_seconds)),prompt:"capacity-overflow"}),
    (e:unknown)=>e instanceof OwnerKlingMotionControlRequestPreparerError&&e.code==="CAPACITY_EXCEEDED");
  release();await pending;
}finally{await f.close();}});
