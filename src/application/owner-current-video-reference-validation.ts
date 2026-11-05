import { prepareLocalMediaWindowsDirectory, assertLocalMediaWindowsFiles } from "./local-media-native-permissions.js";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";
import { probeOwnerCurrentVideoMetadata } from "./owner-current-video-metadata.js";
import type { OwnerCurrentVideoReferenceKind, OwnerCurrentVideoReferenceModelId } from "./owner-current-video-reference-types.js";

export interface OwnerCurrentValidatedVideoReference {
 readonly model_id:OwnerCurrentVideoReferenceModelId;readonly kind:OwnerCurrentVideoReferenceKind;readonly filename:string;readonly mime_type:string;
 readonly size:number;readonly sha256:string;readonly width?:number;readonly height?:number;readonly duration_seconds?:number;
 readonly generation_permit:false;
}
const BYTES=new WeakMap<object,Uint8Array>();
const MODELS=new Set<OwnerCurrentVideoReferenceModelId>(["seedance-2.0","seedance-2.5","seedance_pro","seedance_pro-fast","seedance-1.5-pro","hailuo-3.0","ray-3.14","veo3","veo3fast","veo3fast_r","flux3_t2v","flux3_i2v","flux3_v2v","wan_25_t2v_preview","wan_25_i2v_preview","wan_27_i2v","wan_27_r2v","wan_27_videoedit","wan_30_t2v","wan_30_reference","wan_30_omni","wan_30_edit","wan_30_first_last_frame"]);
/** Local bounded measurement, with no upload or generation authority. */
export async function validateOwnerCurrentVideoReference(input:{readonly model_id:OwnerCurrentVideoReferenceModelId;readonly filename:string;readonly mime_type:string;readonly bytes:Uint8Array},
 ffprobePath:string,signal?:AbortSignal):Promise<Readonly<OwnerCurrentValidatedVideoReference>> {
 if(!input||typeof input!=="object"||types.isProxy(input)||!MODELS.has(input.model_id)||typeof input.filename!=="string"||input.filename!==input.filename.trim()||
   input.filename.length<1||Buffer.byteLength(input.filename)>255||/[\\/\p{Cc}\p{Cf}\p{Cs}]/u.test(input.filename)||typeof input.mime_type!=="string"||
   !input.bytes||types.isProxy(input.bytes)||!(input.bytes instanceof Uint8Array)||![Uint8Array.prototype,Buffer.prototype].includes(Object.getPrototypeOf(input.bytes))||
   ["buffer","byteOffset","byteLength","length"].some(k=>Object.hasOwn(input.bytes,k))||typeof ffprobePath!=="string"||!isAbsolute(ffprobePath)||ffprobePath!==ffprobePath.trim()||/[\u0000-\u001f\u007f]/u.test(ffprobePath))invalid();
 const raw=input.bytes;if(raw.byteLength<1||raw.byteLength>100*1024*1024)invalid();
 let bytes=new Uint8Array(raw),kind:OwnerCurrentVideoReferenceKind,mime=input.mime_type,width:number|undefined,height:number|undefined,duration:number|undefined;
 try {
  const seed=input.model_id.startsWith("seedance"),modernSeed=input.model_id==="seedance-2.0"||input.model_id==="seedance-2.5",frames=input.model_id==="wan_30_first_last_frame",imageOnly=input.model_id==="ray-3.14"||input.model_id.startsWith("veo3")||input.model_id==="flux3_i2v"||seed&&!modernSeed;
  const oldWan=input.model_id==="wan_25_i2v_preview"||input.model_id==="wan_25_t2v_preview"||input.model_id==="wan_27_i2v"||input.model_id==="wan_27_r2v"||input.model_id==="wan_27_videoedit";
  const basicImage=["image/jpeg","image/jpg","image/png","image/webp"].includes(mime);
  const extraImage=(modernSeed&&["image/bmp","image/tiff","image/gif","image/heic","image/heif"].includes(mime)) ||
    ((input.model_id==="seedance-2.0"||imageOnly&&input.model_id!=="flux3_i2v")&&mime==="image/avif") || (input.model_id==="hailuo-3.0"&&["image/bmp","image/gif"].includes(mime)) || oldWan&&mime==="image/bmp";
  if(basicImage||extraImage) {
   if(input.model_id==="wan_25_t2v_preview"||input.model_id==="wan_30_t2v"||input.model_id==="flux3_t2v"||input.model_id==="flux3_v2v")invalid();
   kind="image";const hailuo=input.model_id==="hailuo-3.0",cap=input.model_id==="flux3_i2v"?10*1024*1024:input.model_id==="ray-3.14"?25*1024*1024:input.model_id==="wan_25_i2v_preview"?11_010_048:oldWan?22_020_096:seed||hailuo?27_525_120:20*1024*1024;if(bytes.byteLength>cap)invalid();
   if(basicImage){const image=inspectBoundedOwnerImageBytesWithMax(bytes,cap);if(image.mime!==(mime==="image/jpg"?"image/jpeg":mime))invalid();mime=image.mime;width=image.width;height=image.height;}
   else {const image=await measureImage(bytes,mime,ffprobePath,signal);width=image.width;height=image.height;}
   const min=seed?300:hailuo?256:imageOnly?1:input.model_id==="wan_25_i2v_preview"?384:240,max=seed?6000:hailuo?5760:imageOnly?8400:8000;if(width<min||height<min||width>max||height>max||width*height>52_500_000||
     (modernSeed||hailuo)&&(width/height<0.4||width/height>2.5)||input.model_id==="wan_27_i2v"&&(width/height<0.125||width/height>8))invalid();
  } else if(mime==="video/mp4"||mime==="video/quicktime") {
   if(frames||imageOnly||input.model_id==="wan_25_i2v_preview"||input.model_id==="wan_25_t2v_preview"||input.model_id==="wan_30_t2v"||input.model_id==="flux3_t2v"||input.model_id==="flux3_v2v"&&mime!=="video/mp4")invalid();kind="video";const hailuo=input.model_id==="hailuo-3.0",cap=input.model_id==="seedance-2.0"||hailuo||input.model_id==="flux3_v2v"?50*1024*1024:100*1024*1024;
   const measured=await probeOwnerCurrentVideoMetadata({bytes,mime_type:mime},{ffprobePath,maximumBytes:cap},signal);
   try {width=measured.width;height=measured.height;duration=measured.duration_seconds;const min=seed?300:hailuo||input.model_id==="flux3_v2v"?1:240,max=seed?6000:hailuo||input.model_id==="flux3_v2v"?Number.MAX_SAFE_INTEGER:8000;
    const minDuration=input.model_id==="flux3_v2v"?0:seed||hailuo||input.model_id==="wan_27_i2v"||input.model_id==="wan_27_videoedit"?2:1,maxDuration=input.model_id==="seedance-2.5"?30:input.model_id==="wan_27_i2v"||input.model_id==="wan_27_videoedit"?10:input.model_id==="wan_27_r2v"?5:15,minFps=input.model_id==="seedance-2.0"?24:input.model_id==="seedance-2.5"?23:hailuo||oldWan||input.model_id==="flux3_v2v"?0:16;
    if(width<min||height<min||width>max||height>max||duration<minDuration||duration>maxDuration||
      minFps>0&&(measured.frame_rate===null||measured.frame_rate<minFps)||seed&&measured.frame_rate!==null&&measured.frame_rate>60)invalid();
   } finally {measured.bytes.fill(0);}
  } else if(["audio/mpeg","audio/mp3","audio/wav","audio/x-wav"].includes(mime)) {
   if(frames||imageOnly||input.model_id.startsWith("flux3_")||input.model_id==="wan_27_videoedit"||input.model_id==="wan_30_t2v"||bytes.byteLength>(input.model_id.startsWith("wan_25_")?10:15)*1024*1024)invalid();kind="audio";mime=mime==="audio/mp3"?"audio/mpeg":mime==="audio/x-wav"?"audio/wav":mime;
   duration=await measureAudio(bytes,mime,ffprobePath,signal);const min=input.model_id.startsWith("wan_25_")?3:seed||input.model_id==="hailuo-3.0"||input.model_id==="wan_27_i2v"?2:1,max=input.model_id==="wan_27_r2v"?10:input.model_id==="seedance-2.0"||input.model_id==="hailuo-3.0"?15:30;
   if(duration<min||duration>max)invalid();
  } else if(input.model_id==="wan_30_omni" && ["application/pdf","text/plain","text/markdown","application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"].includes(mime)) {
   kind="file";const signature=Buffer.from(bytes.subarray(0,8));
   if(mime==="application/pdf" ? !signature.subarray(0,5).equals(Buffer.from("%PDF-")) : mime.startsWith("text/") ? !validUtf8(bytes) :
     mime.includes("openxmlformats") ? !(signature[0]===0x50&&signature[1]===0x4b&&signature[2]===0x03&&signature[3]===0x04) :
     !signature.equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]))) invalid();
  } else invalid();
  const sha256=`sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const receipt=Object.freeze({model_id:input.model_id,kind,filename:input.filename,mime_type:mime,size:bytes.byteLength,sha256,
    ...(width===undefined?{}:{width}),...(height===undefined?{}:{height}),...(duration===undefined?{}:{duration_seconds:duration}),generation_permit:false as const});
  BYTES.set(receipt,bytes);bytes=new Uint8Array();return receipt;
 } finally {bytes.fill(0);}
}
export function consumeOwnerCurrentValidatedVideoReference(value:unknown):Uint8Array|null {
 if(!value||typeof value!=="object"||types.isProxy(value)||!Object.isFrozen(value))return null;const bytes=BYTES.get(value);if(!bytes)return null;
 BYTES.delete(value);return bytes;
}
export function releaseOwnerCurrentValidatedVideoReference(value:unknown):void {if(value&&typeof value==="object"){BYTES.get(value)?.fill(0);BYTES.delete(value);}}
async function measureAudio(bytes:Uint8Array,mime:string,ffprobePath:string,signal?:AbortSignal):Promise<number>{
 let directory:string|undefined;
 try {directory=await mkdtemp(join(tmpdir(),"syntx-current-reference-audio-"));await chmod(directory,0o700);await prepareLocalMediaWindowsDirectory(directory,[ffprobePath],signal);const path=join(directory,mime==="audio/wav"?"source.wav":"source.mp3");
  const file=await open(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|(constants.O_NOFOLLOW??0),0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  await assertLocalMediaWindowsFiles([path],signal);
  const stdout=await new Promise<string>((resolve,reject)=>execFile(ffprobePath,["-v","error","-protocol_whitelist","file","-show_entries","stream=codec_type,codec_name,duration:stream_disposition=attached_pic:format=duration,format_name","-of","json",path],
   {encoding:"utf8",timeout:15000,maxBuffer:65536,windowsHide:true,...(signal?{signal}:{})},(error,out)=>error?reject(error):resolve(out)));
  const parsed=JSON.parse(stdout),streams=parsed?.streams;if(!Array.isArray(streams)||streams.length<1||streams.length>32)invalid();
  const audio=streams.filter(stream=>stream?.codec_type==="audio");if(audio.length!==1||streams.some(stream=>stream?.codec_type!=="audio"&&!(stream?.codec_type==="video"&&stream?.disposition?.attached_pic===1)))invalid();
  const format=parsed?.format?.format_name,codec=audio[0]?.codec_name;if(mime==="audio/mpeg"?(format!=="mp3"||codec!=="mp3"):(format!=="wav"||typeof codec!=="string"||!codec.startsWith("pcm_")))invalid();
  const values=[Number(audio[0]?.duration),Number(parsed?.format?.duration)].filter(n=>Number.isFinite(n)&&n>0);if(!values.length)invalid();return Math.max(...values);
 } catch {return invalid();}finally{if(directory)await rm(directory,{recursive:true,force:true});}
}
async function measureImage(bytes:Uint8Array,mime:string,ffprobePath:string,signal?:AbortSignal):Promise<Readonly<{width:number;height:number}>>{
 const b=Buffer.from(bytes.subarray(0,16)),ascii=b.toString("ascii"),ext=mime.split("/")[1]!;
 if(mime==="image/bmp"?!ascii.startsWith("BM"):mime==="image/gif"?!/^GIF8[79]a/u.test(ascii):mime==="image/tiff"?!((b[0]===0x49&&b[1]===0x49&&b[2]===42&&b[3]===0)||(b[0]===0x4d&&b[1]===0x4d&&b[2]===0&&b[3]===42)):
   !(ascii.slice(4,8)==="ftyp" && (mime==="image/avif" ? /^(avif|avis)$/u.test(ascii.slice(8,12)) : /^(heic|heix|hevc|hevx|mif1|msf1)$/u.test(ascii.slice(8,12)))))invalid();
 let directory:string|undefined;
 try{directory=await mkdtemp(join(tmpdir(),"syntx-current-reference-image-"));await chmod(directory,0o700);await prepareLocalMediaWindowsDirectory(directory,[ffprobePath],signal);const path=join(directory,`source.${ext}`);
  const file=await open(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|(constants.O_NOFOLLOW??0),0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  await assertLocalMediaWindowsFiles([path],signal);
  const stdout=await new Promise<string>((resolve,reject)=>execFile(ffprobePath,["-v","error","-protocol_whitelist","file","-show_entries","stream=codec_type,codec_name,width,height","-of","json",path],
   {encoding:"utf8",timeout:15000,maxBuffer:65536,windowsHide:true,...(signal?{signal}:{})},(error,out)=>error?reject(error):resolve(out)));
  const parsed=JSON.parse(stdout),streams=parsed?.streams;if(!Array.isArray(streams)||streams.length!==1||streams[0]?.codec_type!=="video")invalid();
  const codec=streams[0]?.codec_name,expected=mime==="image/bmp"?"bmp":mime==="image/gif"?"gif":mime==="image/tiff"?"tiff":mime==="image/avif"?"av1":"hevc";
  const width=Number(streams[0]?.width),height=Number(streams[0]?.height);if(codec!==expected||!Number.isSafeInteger(width)||width<1||!Number.isSafeInteger(height)||height<1)invalid();
  return Object.freeze({width,height});
 }catch{return invalid();}finally{if(directory)await rm(directory,{recursive:true,force:true});}
}
function invalid():never{throw new Error("OWNER_CURRENT_VIDEO_REFERENCE_INVALID");}
function validUtf8(bytes:Uint8Array):boolean{try{new TextDecoder("utf-8",{fatal:true}).decode(bytes);return true;}catch{return false;}}
