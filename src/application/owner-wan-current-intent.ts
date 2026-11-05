import {types} from "node:util";
import {z} from "zod/v4";
import {schemaHash} from "../domain/generation-contract.js";
import {validateOwnerCurrentVideoReferenceSelection} from "./owner-current-video-reference-policy.js";
import type {OwnerCurrentVideoFamilyDefinition,OwnerCurrentVideoIntentDescription} from "./owner-current-video-generation-service.js";
import type {OwnerCurrentVideoReferenceMetadata,OwnerCurrentVideoReferenceModelId} from "./owner-current-video-reference-types.js";

const MODELS=Object.freeze(["wan_25_t2v_preview","wan_25_i2v_preview","wan_27_i2v","wan_27_r2v","wan_27_videoedit","wan_30_t2v","wan_30_reference","wan_30_omni","wan_30_edit","wan_30_first_last_frame"] as const);
const pins=Object.freeze({public_catalog_version:"sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json",
 settings_inventory_version:"sha256-4da7d12483291bb632aa21e0deb220142994fe061999d2f246318276964fa187.json",form_id:"wan-video",
 form_sha256:"sha256:2b5d64f6a1f9614987f1ec5efd4bdffee916865f34d87ddd32901db658d9a6e3"});
export const OWNER_WAN_CURRENT_SOURCE=Object.freeze({status:"FORM_SOURCE_REVIEWED",model_ids:MODELS,ai_name:"wan_video",source_pins:pins,
 reference_card_sha256:"sha256:7ec3b3e3ff800d787712f0c4a04bae1bd3c6282a3bb58887d6def8d9a94c15fc",
 sender_sha256:"sha256:b8fab1b729a53f72c815aa88bffca1701db42735d7e57190d9176791263f6684",
 slider_sha256:"sha256:77bef1b40ab7d4bce97d12e360b17961467f7315c0d83d6290a2f0ee1d37ee46",
 prompt_policy:"FRESH_STORE_REQUIRED_NONBLANK; PREVIOUS_SAVED_STATE_UNPROVEN",
 controls:Object.freeze({seed:"null or integer 0..2147483647",prompt_extend:"boolean; required true with document attachment",
  wan25:Object.freeze({resolutions:Object.freeze(["480P","720P","1080P"]),ratios:Object.freeze(["16:9","9:16","1:1","4:3","3:4"]),ratio_480p:Object.freeze(["16:9","9:16","1:1"]),video_duration:Object.freeze([5,10]),audio:"optional one; I2V also requires one image"}),
  wan27_i2v:Object.freeze({resolutions:Object.freeze(["720P","1080P"]),aspect_ratio:"hidden; local compatibility value 1:1",duration:"2..15; first_clip raises minimum to floor(input)+1",references:"first_frame or first_clip; optional last_frame; audio only with image first",native_audio:"hidden; fresh video-first watcher sets true, image-first false"}),
  wan27_r2v:Object.freeze({resolutions:Object.freeze(["720P","1080P"]),ratios:Object.freeze(["16:9","9:16","1:1","4:3","3:4"]),duration:"2..15 without video; 2..10 with video",references:"image/video main, optional audio last; total selected video <=5s"}),
  wan27_videoedit:Object.freeze({duration_mode:Object.freeze(["preserve_input","custom"]),duration:"preserve measured input rounded to 0.01s or custom finite 2..min(10,floor input)",audio_setting:Object.freeze(["auto","origin"]),references:"one video and up to four images",native_audio:"hidden; fresh video upload watcher sets true"}),
  wan30:Object.freeze({resolutions:Object.freeze(["480P","720P","1080P"]),ratios:Object.freeze(["16:9","9:16","1:1","4:3","3:4","adaptive"]),duration:"finite number 2..30; upper bound depends on measured video input",
   native_audio:"boolean",rendering_speed:Object.freeze(["basic","prime"]),frames:"first_frame required, last_frame optional; aspect hidden"})}),
 provider_acceptance:"UNPROVEN_NEW_TUPLES"});
const sourceHash=schemaHash(OWNER_WAN_CURRENT_SOURCE),modelSchema=z.enum(MODELS),ratios=z.enum(["16:9","9:16","1:1","4:3","3:4","adaptive"]);
const inputSchema=z.object({model_id:modelSchema,prompt:z.string().min(1).max(20000),resolution:z.enum(["480P","720P","1080P"]),
 aspect_ratio:ratios.optional(),video_duration:z.number().finite().min(0).max(30).optional(),duration_mode:z.enum(["preserve_input","custom"]).optional(),audio_setting:z.enum(["auto","origin"]).optional(),prompt_extend:z.boolean(),seed:z.number().int().min(0).max(2147483647).nullable(),
 native_audio:z.boolean().optional(),rendering_speed:z.enum(["basic","prime"]).optional()}).strict();
type Model=typeof MODELS[number];export type OwnerWanCurrentNormalized=Readonly<Omit<z.infer<typeof inputSchema>,"video_duration">&{mode:string;video_duration:number}>;
declare const wanBrand:unique symbol;export interface OwnerWanCurrentIntent{readonly [wanBrand]:never}
const intents=new WeakMap<object,Readonly<OwnerCurrentVideoIntentDescription>>();
const modes:Readonly<Record<Model,string>>=Object.freeze({wan_25_t2v_preview:"t2v",wan_25_i2v_preview:"i2v",wan_27_i2v:"i2v",wan_27_r2v:"r2v",wan_27_videoedit:"videoedit",wan_30_t2v:"t2v",
 wan_30_reference:"reference",wan_30_omni:"omni",wan_30_edit:"edit",wan_30_first_last_frame:"frames"});
export function normalizeOwnerWanCurrentInput(value:unknown):OwnerWanCurrentNormalized {
 plain(value);const parsed=inputSchema.parse(value),model=parsed.model_id,old=model.startsWith("wan_25_"),wan30=model.startsWith("wan_30_");
 if(!parsed.prompt.trim()||parsed.prompt.length>(wan30?20000:1500)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(parsed.prompt)||!wellFormed(parsed.prompt)||/<<<https?:\/\//iu.test(parsed.prompt))invalid();
 const fixedRatio=model==="wan_27_i2v"?"1:1":model==="wan_30_first_last_frame"?"16:9":undefined;
 if(fixedRatio ? parsed.aspect_ratio!==undefined&&parsed.aspect_ratio!==fixedRatio : parsed.aspect_ratio===undefined)invalid();
 if(model==="wan_27_videoedit") {if(parsed.duration_mode===undefined||parsed.duration_mode==="custom"&&(parsed.video_duration===undefined||parsed.video_duration<2||parsed.video_duration>10)||
   parsed.duration_mode==="preserve_input"&&parsed.video_duration!==undefined&&parsed.video_duration!==0)invalid();}
 else if(parsed.duration_mode!==undefined||parsed.video_duration===undefined||parsed.video_duration<2)invalid();
 if(model!=="wan_27_videoedit"&&parsed.audio_setting!==undefined&&parsed.audio_setting!=="auto")invalid();
 if(old){if(parsed.video_duration!==5&&parsed.video_duration!==10||parsed.resolution==="480P"&&!["16:9","9:16","1:1"].includes(parsed.aspect_ratio??"")||parsed.aspect_ratio==="adaptive")invalid();}
 else if(!wan30&&(parsed.resolution==="480P"||parsed.aspect_ratio==="adaptive"))invalid();
 if(wan30?(parsed.native_audio===undefined||parsed.rendering_speed===undefined):parsed.native_audio!==undefined||parsed.rendering_speed!==undefined)invalid();
 return Object.freeze({...parsed,video_duration:parsed.video_duration??0,mode:modes[model]});
}
export function compileOwnerWanCurrentIntent(input:OwnerWanCurrentNormalized,metadata:readonly Readonly<OwnerCurrentVideoReferenceMetadata>[]):OwnerWanCurrentIntent {
 const {mode:_mode,...raw}=input,normalized=normalizeOwnerWanCurrentInput(raw),refs=snapshotMetadata(metadata),model=normalized.model_id,wan30=model.startsWith("wan_30_");
 const selection=refs.map((item,index)=>Object.freeze({...item,reference_handle:`current_video_ref_00000000-0000-4000-8000-${String(index).padStart(12,"0")}`}));
 validateOwnerCurrentVideoReferenceSelection(model,normalized.mode,selection);
 const videoTotal=Math.round(refs.filter(item=>item.kind==="video").reduce((sum,item)=>sum+(item.duration_seconds??0),0)*100)/100;
 if(model==="wan_27_i2v"&&refs[0]?.role==="first_clip"&&normalized.video_duration<Math.max(2,Math.floor(Math.round((refs[0].duration_seconds??0)*100)/100)+1))invalid();
 if(model==="wan_27_r2v"&&normalized.video_duration>(videoTotal>0?10:15))invalid();
 const outputDuration=model==="wan_27_videoedit"&&normalized.duration_mode==="preserve_input"?videoTotal:normalized.video_duration;
 if(model==="wan_27_videoedit"&&normalized.duration_mode==="custom"&&outputDuration>Math.min(10,Math.max(2,Math.floor(videoTotal))))invalid();
 if(wan30){const max=model==="wan_30_edit"?Math.min(30,Math.max(2,Math.floor(videoTotal)||30)):Math.min(30,Math.max(2,Math.floor(30-videoTotal)));
  if(normalized.video_duration>max||refs.some(ref=>ref.kind==="file")&&!normalized.prompt_extend)invalid();}
 const aspect=normalized.aspect_ratio??(model==="wan_27_i2v"?"1:1":"16:9"),nativeAudio=wan30?normalized.native_audio!:
   model==="wan_27_videoedit"||model==="wan_27_i2v"&&refs[0]?.role==="first_clip",speed=wan30?normalized.rendering_speed!:"basic";
 const settings=Object.freeze({model_type:model,resolution:normalized.resolution,aspect_ratio:aspect,video_duration:outputDuration,prompt_extend:normalized.prompt_extend,
  shot_type:"single",audio_setting:model==="wan_27_videoedit"?(normalized.audio_setting??"auto"):"auto",seed:normalized.seed,native_audio:nativeAudio,rendering_speed:speed,
  ...(wan30||model==="wan_27_r2v"||model==="wan_27_videoedit"?{duration:videoTotal}:{})});
 const cost=Object.freeze({resolution:normalized.resolution,video_duration:outputDuration,
  ...(wan30||model==="wan_27_r2v"||model==="wan_27_videoedit"?{duration:videoTotal}:{}),...(wan30?{rendering_speed:speed}:{})});
 const mentions=model==="wan_27_r2v"||model==="wan_30_reference"||model==="wan_30_omni"||model==="wan_30_edit"||model==="wan_30_first_last_frame",prompt=normalized.prompt;
 if(!prompt.trim())invalid();const fingerprint=schemaHash({source_profile_sha256:sourceHash,prompt,settings,references:refs});
 const description:Readonly<OwnerCurrentVideoIntentDescription>=Object.freeze({model_id:model as OwnerCurrentVideoReferenceModelId,mode:normalized.mode,ai_name:"wan_video",prompt,settings,
  cost_parameters:cost,reference_metadata:refs,reference_prompt_mode:mentions?"ENABLED_ALIASES":"DISABLED_LITERAL",intent_fingerprint:fingerprint,source_profile_sha256:sourceHash,source_pins:pins});
 const token=Object.freeze({}) as OwnerWanCurrentIntent;intents.set(token,description);return token;
}
export function inspectOwnerWanCurrentIntent(value:unknown):Readonly<OwnerCurrentVideoIntentDescription>|null{return value&&typeof value==="object"&&!types.isProxy(value)?intents.get(value)??null:null;}
const definition:OwnerCurrentVideoFamilyDefinition<OwnerWanCurrentNormalized,OwnerWanCurrentIntent>=Object.freeze({model_ids:MODELS,source_profile_sha256:sourceHash,source_pins:pins,
 normalize:normalizeOwnerWanCurrentInput,compile:compileOwnerWanCurrentIntent,inspect:inspectOwnerWanCurrentIntent});
export function getOwnerWanCurrentFamilyDefinition(){return definition;}
function snapshotMetadata(value:readonly Readonly<OwnerCurrentVideoReferenceMetadata>[]):readonly Readonly<OwnerCurrentVideoReferenceMetadata>[]{
 if(!Array.isArray(value)||types.isProxy(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>50)invalid();const d=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(d);
 if(keys.length!==value.length+1||keys.some(k=>k!=="length"&&(typeof k!=="string"||!/^\d+$/u.test(k)||Number(k)>=value.length)))invalid();
 return Object.freeze(Array.from({length:value.length},(_,i)=>{const slot=d[String(i)];if(!slot||!slot.enumerable||!Object.hasOwn(slot,"value"))invalid();plain(slot.value);const ref=slot.value as unknown as OwnerCurrentVideoReferenceMetadata;
  if(typeof ref.kind!=="string"||typeof ref.role!=="string"||typeof ref.mime_type!=="string"||!Number.isSafeInteger(ref.size)||ref.size<1||typeof ref.sha256!=="string"||!/^sha256:[a-f0-9]{64}$/u.test(ref.sha256))invalid();return Object.freeze({...ref});}));
}
function plain(value:unknown):asserts value is Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value)||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)invalid();
 const d=Object.getOwnPropertyDescriptors(value);if(Reflect.ownKeys(d).some(k=>typeof k!=="string"||!Object.hasOwn(d[k]!,"value")||!d[k]!.enumerable))invalid();}
function wellFormed(value:string):boolean{for(let i=0;i<value.length;i++){const n=value.charCodeAt(i);if(n>=0xd800&&n<=0xdbff){const m=value.charCodeAt(++i);if(!(m>=0xdc00&&m<=0xdfff))return false;}else if(n>=0xdc00&&n<=0xdfff)return false;}return true;}
function invalid():never{throw new Error("OWNER_WAN_CURRENT_INTENT_INVALID");}
