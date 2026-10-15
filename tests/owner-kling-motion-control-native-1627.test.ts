import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { OwnerKlingMotionControlReferenceService } from "../src/application/owner-kling-motion-control-reference-service.js";
import { createOwnerKlingMotionControlRequestPreparer } from "../src/application/owner-kling-motion-control-request-preparer.js";
import { createOwnerKlingMotionControlOneShotPermit } from "../src/application/owner-kling-motion-control-one-shot-policy.js";

const ATTEMPT="link_mcv_native_1627_owner",BINDING={tenant_id:"mcv-native-1627",subject:"owner"},NOW=Date.parse("2026-10-15T00:00:00Z");
function crc32(b:Uint8Array){let c=0xffff_ffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb8_8320:0);}return(c^0xffff_ffff)>>>0;}
function png300(){const b=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=","base64");b.writeUInt32BE(300,16);b.writeUInt32BE(300,20);b.writeUInt32BE(crc32(b.subarray(12,29)),29);return b;}
test("Motion Control native own-pair lifecycle retains result GET after TTL prune without a second POST",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"mcv-native-1627-")),videoPath=join(dir,"motion.mp4"),FFMPEG=process.env.SYNTX_MCV_TEST_FFMPEG??"/opt/homebrew/bin/ffmpeg",FFPROBE=process.env.SYNTX_MCV_TEST_FFPROBE??"/opt/homebrew/bin/ffprobe";
 execFileSync(FFMPEG,["-hide_banner","-loglevel","error","-f","lavfi","-i","color=c=blue:s=320x320:r=24:d=3.2","-vf","setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709","-an","-pix_fmt","yuv420p","-c:v","libx264","-movflags","+faststart","-y",videoPath]);
 const video=await readFile(videoPath);let now=NOW,uploads=0,creates=0,posts=0,gets=0,resultGets=0,wire:Record<string,any>|undefined;
 const videoObjects=[{id:"video-1",message_id:"bot-1",object_type:"video",model_type:"kling_motion_control",completed:true,object_url:"https://r2.syntx.ai/result.mp4"}];
 const auth=new PerUserLinkService({authorizationProfile:"OBSERVED_OWNER_AUTHORIZED",async createChallenge(){return{upstream_attempt_id:"local",approval_url:"https://example.invalid"};},
  async pollChallenge(_id,receive){await receive({scheme:"Bearer",value:"synthetic-link-token"});return{state:"LINKED" as const};}},new InMemoryAuthLinkStore(()=>now),{attemptIdGenerator:()=>ATTEMPT,now:()=>now,defaultTtlMs:30*60_000});
 await auth.createAttempt(BINDING);await auth.issueHandoff(BINDING,ATTEMPT);await auth.checkAttempt(BINDING,ATTEMPT);
 const client=new SyntxChatHttpClient({credentialBroker:{async useCredential<T>(run:(token:string)=>Promise<T>){return run("synthetic-native-token");}},fetchImpl:async(req,init)=>{
  const url=new URL(typeof req==="string"?req:req instanceof URL?req.href:req.url),method=init?.method??(req instanceof Request?req.method:"");
  if(method==="POST"&&uploads<2){uploads++;const f=(init?.body as FormData).get("files") as File;return Response.json({files:[{filename:f.name,url:`https://r2.syntx.ai/native/${f.name}`,mime_type:f.type,size:f.size}]});}
  if(url.pathname.endsWith("/chats")&&method==="POST")return Response.json({uuid:`native-${++creates}`});
  if(url.pathname.endsWith("/video/generate")){posts++;wire=JSON.parse(String(init?.body)) as Record<string,any>;throw new Error("synthetic lost POST acknowledgement");}
  if(url.pathname.endsWith("/messages")&&method==="GET"){gets++;return Response.json({messages:[
   {id:"owner-1",chat_id:421,author_id:27,message_object:[{id:"text-1",message_id:"owner-1",object_type:"text",model_type:"kling_motion_control",object_text:"raw prompt"}]},
   {id:"bot-1",chat_id:421,author_id:-1,message_object:videoObjects}],pagination:{page:1,page_size:10,total_count:2,total_pages:1,has_next:false,has_previous:false}});}
  if(url.pathname.endsWith("/bot-1")){resultGets++;return Response.json({id:"bot-1",chat_id:421,author_id:-1,message_object:videoObjects});}
  throw new Error("unexpected local request");
 }});
 const refs=new OwnerKlingMotionControlReferenceService({binding:BINDING,linkService:auth,resolveClient:()=>client,ffprobePath:FFPROBE,now:()=>now});
 const upload=(filename:string,mime_type:string,bytes:Buffer)=>({attemptId:ATTEMPT,filename,mime_type,content_base64:bytes.toString("base64")});
 const image=await refs.uploadImage(upload("motion.png","image/png",png300())),ownedVideo=await refs.uploadVideo(upload("motion.mp4","video/mp4",video));
 const preparer=createOwnerKlingMotionControlRequestPreparer({referenceService:refs,now:()=>now});
 try{const candidate=await preparer.prepare({attempt_id:ATTEMPT,model_id:"kling_motion_control",reference_source:"owned_video",image_handle:image.image_handle,video_handle:ownedVideo.video_handle,
   parameters:{model_id:"kling_motion_control",version:"3.0",mode:"hd",gen_type:"mcv",native_audio:false,video_duration:3},prompt:"raw prompt"});
  const b=preparer.inspectCandidate(candidate)!,permit=await createOwnerKlingMotionControlOneShotPermit({preparer,candidate,principal:b.principal,attemptId:ATTEMPT});
  const op={preparer,candidate,permit,principal:b.principal,attemptId:ATTEMPT,linkService:auth,binding:BINDING};
  const chat=await client.createOwnerKlingMotionControlChat(op);await assert.rejects(client.startOwnerKlingMotionControlWithOwnedCandidate({...op,chat}),(e:unknown)=>e instanceof Error&&"code"in e&&e.code==="OUTCOME_UNKNOWN");
  assert.equal(posts,1);assert.equal(wire?.settings.file_urls[0]?.type,"image");assert.equal(wire?.settings.file_urls[1]?.type,"video");assert.equal(wire?.prompt,"raw prompt");
  await assert.rejects(client.startOwnerKlingMotionControlWithOwnedCandidate({...op,chat}),(e:unknown)=>e instanceof Error&&"code"in e&&e.code==="CHAT_DISPATCH_ALREADY_STARTED");
  const history=await client.listOwnedKlingMotionControlCandidates({...op,chat});assert.equal(history.owner_ack_status,"MATCHED");assert.equal(history.contexts.length,1);
  const unchanged=await client.listOwnedKlingMotionControlCandidates({...op,chat});assert.equal(unchanged.contexts[0],history.contexts[0]);
  videoObjects.push({id:"video-2",message_id:"bot-1",object_type:"video",model_type:"kling_motion_control",completed:true,object_url:"https://r2.syntx.ai/result-2.mp4"});
  const grown=await client.listOwnedKlingMotionControlCandidates({...op,chat});assert.equal(grown.contexts[0]?.message_object_ids.length,2);
  const second=await preparer.prepare({attempt_id:ATTEMPT,model_id:"kling_motion_control",reference_source:"owned_video",image_handle:image.image_handle,video_handle:ownedVideo.video_handle,
    parameters:{model_id:"kling_motion_control",version:"3.0",mode:"hd",gen_type:"mcv",native_audio:false,video_duration:3},prompt:"force prune"});assert.ok(second);
  await assert.rejects(client.getOwnedKlingMotionControlResult({...op,context:history.contexts[0]}),(e:unknown)=>e instanceof Error&&"code"in e&&e.code==="RESULT_CONTEXT_INVALID");
  now+=16*60_000;const result=await client.getOwnedKlingMotionControlResult({...op,context:grown.contexts[0]});assert.equal(result.ready_videos.length,2);assert.equal(posts,1);assert.equal(gets,3);assert.equal(resultGets,1);
  const clone={...grown.contexts[0]};await assert.rejects(client.getOwnedKlingMotionControlResult({...op,context:clone}),(e:unknown)=>e instanceof Error&&"code"in e&&e.code==="RESULT_CONTEXT_INVALID");
 }finally{await preparer.close();await refs.close();await rm(dir,{recursive:true,force:true});}
});
