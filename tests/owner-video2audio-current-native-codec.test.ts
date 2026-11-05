import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeScriptExecutable } from "./helpers/node-script-executable.js";
import test from "node:test";
import { createOwnerVideo2AudioSourceProfile } from "../src/application/owner-video2audio-source-profile.js";
import { probeOwnerVideo2AudioCurrentOriginal, releaseOwnerVideo2AudioCurrentOriginal } from "../src/application/owner-video2audio-current-original-probe.js";
import { parseOwnerVideo2AudioOriginalUploadReceipt, validateOwnerVideo2AudioOriginalUploadRequest } from "../src/adapter/syntx/video2audio-original-codec.js";

const input={filename:"source.mp4",mime_type:"video/mp4" as const,bytes:Uint8Array.from([0,0,0,20,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109])};
test("current Video2Audio codec binds probe and tolerates only receipt precision", {skip:process.platform==="win32"?"POSIX ffprobe fixture; Windows native probe not run":false},async()=>{
 const dir=await mkdtemp(join(tmpdir(),"v2audio-current-codec-"));
 try {const bin=join(dir,"ffprobe"),profile=createOwnerVideo2AudioSourceProfile(undefined,"CURRENT"),legacy=createOwnerVideo2AudioSourceProfile();
  const metadata={streams:[{codec_type:"video",codec_name:"h264",width:640,height:480,duration:"31.25"}],format:{format_name:"mov,mp4,m4a,3gp,3g2,mj2",duration:"31.25"}};
  await writeFile(bin,nodeScriptExecutable(`#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(JSON.stringify(metadata))});\n`),{mode:0o700});
  const probe=await probeOwnerVideo2AudioCurrentOriginal(input,profile,bin);
  try {const request={...input,current_probe:probe},validated=validateOwnerVideo2AudioOriginalUploadRequest(request,profile);
   assert.equal(validated.duration_seconds,31.25);
   const receipt=(duration:number)=>({files:[{filename:input.filename,url:"https://r2.syntx.ai/owned-video.mp4",status:"success",content_type:"video/mp4",size:input.bytes.byteLength,duration}],total:1,successful:1,failed:0,duplicates:0});
   assert.equal(parseOwnerVideo2AudioOriginalUploadReceipt(receipt(31),validated,profile).duration_seconds,31.25);
   assert.throws(()=>parseOwnerVideo2AudioOriginalUploadReceipt(receipt(30),validated,profile));
   assert.throws(()=>validateOwnerVideo2AudioOriginalUploadRequest({...request,current_probe:{...probe}},profile));
   assert.throws(()=>validateOwnerVideo2AudioOriginalUploadRequest({...request,bytes:new Uint8Array(input.bytes.length)},profile));
   assert.throws(()=>validateOwnerVideo2AudioOriginalUploadRequest(request,legacy));
  } finally {releaseOwnerVideo2AudioCurrentOriginal(probe);}
 } finally {await rm(dir,{recursive:true,force:true});}
});
