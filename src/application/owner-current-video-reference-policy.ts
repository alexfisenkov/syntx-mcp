import type { OwnerCurrentVideoReferenceKind, OwnerCurrentVideoReferenceMetadata, OwnerCurrentVideoReferenceModelId, OwnerCurrentVideoReferenceRole } from "./owner-current-video-reference-types.js";

/** Source-bound collection policy; this is validation only, never upload or dispatch authority. */
const LIMITS: Readonly<Record<OwnerCurrentVideoReferenceModelId, Readonly<Record<OwnerCurrentVideoReferenceKind,number>>>> = Object.freeze({
  "seedance-2.0":Object.freeze({image:6,video:3,audio:2,file:0}),
  "seedance-2.5":Object.freeze({image:30,video:10,audio:10,file:0}),
  seedance_pro:Object.freeze({image:2,video:0,audio:0,file:0}),"seedance_pro-fast":Object.freeze({image:1,video:0,audio:0,file:0}),"seedance-1.5-pro":Object.freeze({image:2,video:0,audio:0,file:0}),
  "hailuo-3.0":Object.freeze({image:9,video:3,audio:3,file:0}),
  "ray-3.14":Object.freeze({image:2,video:0,audio:0,file:0}),
  veo3:Object.freeze({image:2,video:0,audio:0,file:0}),veo3fast:Object.freeze({image:3,video:0,audio:0,file:0}),veo3fast_r:Object.freeze({image:3,video:0,audio:0,file:0}),
  "omni1.2":Object.freeze({image:7,video:1,audio:0,file:0}),
  flux3_t2v:Object.freeze({image:0,video:0,audio:0,file:0}),flux3_i2v:Object.freeze({image:10,video:0,audio:0,file:0}),flux3_v2v:Object.freeze({image:0,video:1,audio:0,file:0}),
  wan_25_t2v_preview:Object.freeze({image:0,video:0,audio:1,file:0}),wan_25_i2v_preview:Object.freeze({image:1,video:0,audio:1,file:0}),wan_27_i2v:Object.freeze({image:2,video:1,audio:1,file:0}),wan_27_r2v:Object.freeze({image:6,video:5,audio:1,file:0}),
  wan_27_videoedit:Object.freeze({image:4,video:1,audio:0,file:0}),wan_30_t2v:Object.freeze({image:0,video:0,audio:0,file:0}),
  wan_30_reference:Object.freeze({image:10,video:5,audio:5,file:0}),
  wan_30_omni:Object.freeze({image:10,video:5,audio:5,file:1}),
  wan_30_edit:Object.freeze({image:10,video:1,audio:5,file:0}),
  wan_30_first_last_frame:Object.freeze({image:2,video:0,audio:0,file:0})
});
export interface OwnerCurrentVideoSelectionEntry extends OwnerCurrentVideoReferenceMetadata {readonly reference_handle:string}
export function validateOwnerCurrentVideoReferenceSelection(model:OwnerCurrentVideoReferenceModelId, mode:string,
  references:readonly Readonly<OwnerCurrentVideoSelectionEntry>[]):void {
  if(!Object.hasOwn(LIMITS,model)||!Array.isArray(references)||references.length>50)invalid();
  const seed=model==="seedance-2.0"||model==="seedance-2.5", frames=model==="wan_30_first_last_frame"||(seed||model==="hailuo-3.0")&&mode==="frames";
  const allowedModes:Readonly<Record<OwnerCurrentVideoReferenceModelId,readonly string[]>>={"seedance-2.0":["omni-references","frames"],
    "seedance-2.5":["omni-references","frames","extend","edit"],seedance_pro:["images"],"seedance_pro-fast":["images"],"seedance-1.5-pro":["images"],"hailuo-3.0":["omni-references","frames"],"ray-3.14":["text2video","keyframes"],
    veo3:["text","image"],veo3fast:["text","image","references"],veo3fast_r:["text","image","references"],"omni1.2":["text","image","references"],flux3_t2v:["text"],flux3_i2v:["image"],flux3_v2v:["video"],wan_25_t2v_preview:["t2v"],wan_25_i2v_preview:["i2v"],wan_27_i2v:["i2v"],wan_27_r2v:["r2v"],wan_27_videoedit:["videoedit"],wan_30_t2v:["t2v"],
    wan_30_reference:["reference"],wan_30_omni:["omni"],wan_30_edit:["edit"],wan_30_first_last_frame:["frames"]};
  if(!allowedModes[model].includes(mode))invalid();
  const counts:Record<OwnerCurrentVideoReferenceKind,number>={image:0,video:0,audio:0,file:0}, seen=new Set<string>();
  let totalVideo=0,totalAudio=0;
  for(const item of references){
    if(!item||typeof item!=="object"||typeof item.reference_handle!=="string"||!/^current_video_ref_[0-9a-f-]{36}$/u.test(item.reference_handle) ||
      !Object.hasOwn(counts,item.kind) || !(model==="wan_27_i2v"?validWan27I2vRole(item.kind,item.role):model==="omni1.2"?validVeoOmni12Role(item.kind,item.role,mode):validRole(item.kind,item.role,frames)) || !Number.isSafeInteger(item.size)||item.size<1 ||
      typeof item.sha256!=="string"||!/^sha256:[a-f0-9]{64}$/u.test(item.sha256))invalid();
    const key=`${item.role}:${item.reference_handle}`;if(seen.has(key))invalid();seen.add(key);counts[item.kind as OwnerCurrentVideoReferenceKind]++;
    if(item.kind==="video"||item.kind==="audio"){
      if(typeof item.duration_seconds!=="number"||!Number.isFinite(item.duration_seconds)||item.duration_seconds<=0)invalid();
      if(item.kind==="video")totalVideo+=item.duration_seconds;else totalAudio+=item.duration_seconds;
    }
  }
  for(const kind of Object.keys(counts) as OwnerCurrentVideoReferenceKind[])if(counts[kind]>LIMITS[model][kind])invalid();
  if(frames){if(references.length<1||references.length>2||(model==="hailuo-3.0" ? references.length===1&&!['first_frame','last_frame'].includes(references[0]!.role) : references[0]?.role!=="first_frame")||references.length===2&&(references[0]?.role!=="first_frame"||references[1]?.role!=="last_frame"))invalid();}
  if(model==="hailuo-3.0"&&!frames&&references.length>12)invalid();
  if(model==="wan_25_i2v_preview"&&(counts.image!==1||references[0]?.role!=="image"))invalid();
  if(model==="wan_27_i2v"){
   const first=references[0]?.role;if(first!=="first_frame"&&first!=="first_clip")invalid();
   if(first==="first_clip"&&counts.audio>0)invalid();
   const tail=references.slice(1).map(item=>item.role);if(tail.length>2||tail.some(role=>role!=="last_frame"&&role!=="audio")||
     new Set(tail).size!==tail.length||tail.length===2&&(tail[0]!=="last_frame"||tail[1]!=="audio"))invalid();
  }
  if(model==="wan_27_r2v"&&(counts.image+counts.video<1||counts.video>0&&(counts.image+counts.video>5||Math.round(totalVideo*100)/100>5)||counts.audio>0&&references.at(-1)?.role!=="audio"))invalid();
  if(model==="ray-3.14"&&(mode==="text2video"?counts.image!==0:counts.image<1||counts.image>2))invalid();
  if((model==="veo3"||model==="veo3fast"||model==="veo3fast_r")&&(mode==="text"?counts.image!==0:mode==="image"?counts.image<1||counts.image>2:counts.image<1||counts.image>3))invalid();
  if(model==="omni1.2"&&(
    mode==="text"&&references.length!==0 ||
    mode==="image"&&(references.length<1||references.length>2||references[0]?.role!=="first_frame"&&references[0]?.role!=="first_clip"||
      references[0]?.role==="first_clip"&&references.length!==1||references.length===2&&references[1]?.role!=="last_frame") ||
    mode==="references"&&(references.length<1||references.length>7||counts.video>0&&counts.image>5) ||
    counts.video>0&&(totalVideo<2.9||totalVideo>15.1)))invalid();
  if(model==="flux3_i2v"&&counts.image<1||model==="flux3_v2v"&&counts.video!==1)invalid();
  if(model==="seedance-2.0"&&counts.audio>0&&counts.image+counts.video===0)invalid();
  if(model==="seedance-2.5"&&(mode==="extend"||mode==="edit")&&counts.video===0)invalid();
  if(model==="wan_30_edit"&&counts.video!==1)invalid();
  if(model==="wan_27_videoedit"&&counts.video!==1)invalid();
  if(model==="seedance-2.0"&&totalVideo>15.1 || model==="seedance-2.5"&&(totalVideo>30||totalAudio>30) || model==="hailuo-3.0"&&(totalVideo>15||totalAudio>15) ||
     model.startsWith("wan_30_")&&(totalVideo>15.1||totalAudio>15.1||totalAudio>0&&totalAudio<1))invalid();
}
function validRole(kind:OwnerCurrentVideoReferenceKind,role:OwnerCurrentVideoReferenceRole,frames:boolean):boolean {
  return frames ? kind==="image"&&(role==="first_frame"||role==="last_frame") : role===kind;
}
function validWan27I2vRole(kind:OwnerCurrentVideoReferenceKind,role:OwnerCurrentVideoReferenceRole):boolean{return kind==="image"&&(role==="first_frame"||role==="last_frame")||kind==="video"&&role==="first_clip"||kind==="audio"&&role==="audio";}
function validVeoOmni12Role(kind:OwnerCurrentVideoReferenceKind,role:OwnerCurrentVideoReferenceRole,mode:string):boolean{
  return mode==="image" ? kind==="image"&&(role==="first_frame"||role==="last_frame")||kind==="video"&&role==="first_clip" :
    mode==="references" ? kind==="image"&&role==="image"||kind==="video"&&role==="video" : false;
}
function invalid():never {throw new Error("OWNER_CURRENT_VIDEO_REFERENCE_SELECTION_INVALID");}
