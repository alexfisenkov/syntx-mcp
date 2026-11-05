import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { OwnerCurrentVideoReferenceStore } from "../src/application/owner-current-video-reference-store.js";
const ffmpeg=process.env.SYNTX_MEDIA_FFMPEG_PATH,ffprobe=process.env.SYNTX_MEDIA_FFPROBE_PATH,run=promisify(execFile);
test("current owned video can be trimmed locally before native upload",{skip:!ffmpeg||!ffprobe?"trusted ffmpeg/ffprobe paths are not configured":false},async()=>{
 const dir=await mkdtemp(join(tmpdir(),"current-video-trim-test-"));let calls=0;
 const client=new SyntxChatHttpClient({credentialBroker:{async useCredential<T>(f:(s:string)=>Promise<T>){return f("synthetic-current-reference-credential");}},fetchImpl:async()=>{calls++;return Response.json({files:[{url:"https://r2.syntx.ai/owned-trim.mp4"}]});}});
 const links={async getStatus(_binding:unknown,id:string){return {attempt_id:id,authorization_profile:"OBSERVED_OWNER_AUTHORIZED",status:"LINKED",expires_at:null,linked:true};}};
 const store=new OwnerCurrentVideoReferenceStore({binding:{tenant_id:"tenant",subject:"owner"},linkService:links as never,resolveClient:()=>client,ffprobePath:ffprobe!,ffmpegPath:ffmpeg!});
 try {const path=join(dir,"input.mp4");await run(ffmpeg!,["-v","error","-f","lavfi","-i","color=c=blue:s=640x480:r=24:d=4","-c:v","libx264","-pix_fmt","yuv420p","-y",path]);const bytes=await readFile(path);
  const base={attemptId:"link_current_reference_0000000001",model_id:"seedance-2.0" as const,filename:"input.mp4",mime_type:"video/mp4",content_base64:bytes.toString("base64")};
  await assert.rejects(()=>store.upload({...base,trim:{start_seconds:2,end_seconds:6}}));assert.equal(calls,0);
  const result=await store.upload({...base,trim:{start_seconds:0.25,end_seconds:2.75}});assert.equal(calls,1);assert.equal(result.preparation,"USER_SELECTED_SEGMENT_LOCAL_TRANSCODE");assert.ok(result.duration_seconds!>=2&&result.duration_seconds!<=3);
  const clip=await store.upload({...base,model_id:"wan_27_i2v",trim:{start_seconds:0.25,end_seconds:2.75}});
  const audioPath=join(dir,"audio.wav");await run(ffmpeg!,["-v","error","-f","lavfi","-i","sine=frequency=440:duration=3","-c:a","pcm_s16le","-y",audioPath]);
  const audio=await store.upload({attemptId:base.attemptId,model_id:"wan_27_i2v",filename:"audio.wav",mime_type:"audio/wav",content_base64:(await readFile(audioPath)).toString("base64")});
  const first={reference_handle:clip.reference_handle,role:"first_clip" as const};
  await assert.rejects(()=>store.prepare({attemptId:base.attemptId,model_id:"wan_27_i2v",mode:"i2v",references:[first,{reference_handle:audio.reference_handle,role:"audio"}]}));
  const videoFirst=await store.prepare({attemptId:base.attemptId,model_id:"wan_27_i2v",mode:"i2v",references:[first]});assert.equal(videoFirst.metadata[0]?.role,"first_clip");
 }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});

test("source-listed BMP and GIF images are measured by the trusted local codec",{skip:!ffmpeg||!ffprobe?"trusted ffmpeg/ffprobe paths are not configured":false},async()=>{
 const dir=await mkdtemp(join(tmpdir(),"current-video-image-codec-"));
 try{for(const [extension,mime] of [["bmp","image/bmp"],["gif","image/gif"]] as const){const path=join(dir,`input.${extension}`);
  await run(ffmpeg!,["-v","error","-f","lavfi","-i","color=c=blue:s=320x320:r=1:d=1","-frames:v","1","-y",path]);
  const {validateOwnerCurrentVideoReference,releaseOwnerCurrentValidatedVideoReference}=await import("../src/application/owner-current-video-reference-validation.js");
  const receipt=await validateOwnerCurrentVideoReference({model_id:"hailuo-3.0",filename:`input.${extension}`,mime_type:mime,bytes:await readFile(path)},ffprobe!);
  assert.equal(receipt.width,320);assert.equal(receipt.height,320);releaseOwnerCurrentValidatedVideoReference(receipt);
 }}finally{await rm(dir,{recursive:true,force:true});}
});
