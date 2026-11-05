import {createHash} from "node:crypto";
import {types} from "node:util";
import {loadSelectedDiscoveryCatalog} from "../catalog/selected-discovery-catalog.js";
import {createGenerationContractRegistryV2,serializeGenerationContractRegistryV2,type GenerationContractV2Input} from "../domain/generation-contract-v2.js";
import type {OwnerReviewedNoReferenceT2vNormalizedRequest,OwnerReviewedNoReferenceT2vProfile} from "./owner-hailuo01-t2v-profile.js";
import {createOwnerSeedance20T2vProfile} from "./owner-seedance20-t2v-profile.js";
export const SEEDANCE20_CURRENT_VARIANT="seedance-2.0-omni-no-media-current-version-v2" as const;
const PUBLIC="sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json" as const;
const SOURCE=Object.freeze({status:"FORM_SOURCE_REVIEWED_NOT_UI_OR_PROVIDER_OBSERVED",build_id:"1793890358",public_version:PUBLIC,
  settings_version:"sha256-4da7d12483291bb632aa21e0deb220142994fe061999d2f246318276964fa187.json",
  form_sha256:"sha256:383bd2c5f8bd5f8e80cce6ef675f92693585cef502e1a93e59d4d865b8fbd9b6",
  helper_sha256:"sha256:3e9229fe7c238a1e7b95f22d313bc8c6ea3b1612c0c54bb9fa08d406c5711d28",
  input_sha256:"sha256:471a22adc9190002a2bafbe6d5ce7beb951ad514632fa210683906ce86881599",
  sender_sha256:"sha256:b8fab1b729a53f72c815aa88bffca1701db42735d7e57190d9176791263f6684",
  cost_sha256:"sha256:395a9c51d508a20064bd8acd676ab1c8e3535889d28484e3df9679f23d3b59ca",
  versions:Object.freeze(["mini","fast","pro"]),resolutions:Object.freeze({mini:Object.freeze(["480p","720p"]),fast:Object.freeze(["480p","720p"]),pro:Object.freeze(["480p","720p","1080p","4K"])}),
  mode:"omni-references",file_urls:"EMPTY_ONLY",mcp_default_version:"mini",duration_seconds:Object.freeze({min:4,max:15}),effective_defaults:"UNKNOWN",backend_acceptance:"UNPROVEN"});
export function getOwnerSeedance20CurrentControls(){return SOURCE;}
export function createOwnerSeedance20CurrentProfile(directory?:string):OwnerReviewedNoReferenceT2vProfile<typeof SOURCE>{
 const old=createOwnerSeedance20T2vProfile(directory),catalog=loadSelectedDiscoveryCatalog(PUBLIC,directory).discoveryCatalog;
 if(catalog.source_hashes.models!=="sha256:11f085ad9b0dd97435d6ebece623fa85bce2870e714e876e6fbb041c562fb438"||!catalog.getModel("seedance-2.0").active)throw Error("SEEDANCE20_CURRENT_SOURCE_INVALID");
 const build=(at:string):GenerationContractV2Input=>{const original=old.buildContractInput(at);return {...original,variant_id:SEEDANCE20_CURRENT_VARIANT,
 provenance:{settings_source_sha256:SOURCE.form_sha256,reviewed_at:at,references:[{kind:"public_catalog",reference:`Pinned ${PUBLIC}`,sha256:catalog.source_hashes.models},
 {kind:"frontend_static",reference:"seedance2.js model-specific version and resolution guards",sha256:SOURCE.form_sha256},
 {kind:"frontend_static",reference:"index8.js copies settings to video sender",sha256:SOURCE.input_sha256},
 {kind:"frontend_static",reference:"video.js sends copied settings",sha256:SOURCE.sender_sha256},
 {kind:"frontend_static",reference:"cost2.js reads mode and explicit size/duration",sha256:SOURCE.cost_sha256},
 {kind:"manual_review",reference:"No-media combinations remain unproven by provider."}]},
 cost_parameter_bindings:{...original.cost_parameter_bindings,mode:{kind:"literal",value:"omni-references"},version:{kind:"parameter",parameter:"version"}},
 parameters:{type:"object",additional_properties:false,required:["prompt","resolution","aspect_ratio","video_duration","generate_audio","mode","version"],properties:{
 prompt:{type:"string",min_length:1,max_length:5000},resolution:{type:"string",enum:["480p","720p","1080p","4K"]},aspect_ratio:{type:"string",enum:["21:9","16:9","4:3","1:1","3:4","9:16"]},
 video_duration:{type:"integer",minimum:4,maximum:15},generate_audio:{type:"boolean"},mode:{type:"string",enum:["omni-references"]},version:{type:"string",enum:["mini","fast","pro"]}},conditions:[],conditional_enums:[{field:"resolution",cases:[
 {when:{field:"version",equals:"mini"},allowed_values:["480p","720p"]},{when:{field:"version",equals:"fast"},allowed_values:["480p","720p"]},{when:{field:"version",equals:"pro"},allowed_values:["480p","720p","1080p","4K"]}]}]},
 wire:{...original.wire,settings_fields:{...original.wire.settings_fields,version:"version"}},limits:{...original.limits,max_parameters:7}};};
 const registry=createGenerationContractRegistryV2({schema_version:"2.0.0",catalog_version:`${catalog.fetched_at}.${catalog.source_hashes.models.slice(7,19)}`,source_hashes:catalog.source_hashes,contracts:[build("2026-11-05T00:00:00.000Z")]});
 return Object.freeze({catalog,registry,registryVersion:`sha256-${createHash("sha256").update(serializeGenerationContractRegistryV2(registry)).digest("hex")}.json`,source:SOURCE,modelId:"seedance-2.0",aiName:"seedance",modelType:"seedance-2.0",operationId:"generate-video" as const,variantId:SEEDANCE20_CURRENT_VARIANT,costParameterFields:Object.freeze([...old.costParameterFields,"version"]),normalizeGenerationInput:normalize,buildContractInput:build});
}
function normalize(value:unknown):OwnerReviewedNoReferenceT2vNormalizedRequest{
 if(!value||typeof value!=="object"||Array.isArray(value)||types.isProxy(value))throw Error("INVALID_REQUEST");const d=Object.getOwnPropertyDescriptors(value),keys=["attemptId","prompt","resolution","aspect_ratio","video_duration","generate_audio","version"];
 if(![Object.prototype,null].includes(Object.getPrototypeOf(value))||Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!d[k]||!("value" in d[k]!)||!d[k]!.enumerable))throw Error("INVALID_REQUEST");const q=Object.fromEntries(keys.map(k=>[k,d[k]!.value]));
 if(typeof q.attemptId!=="string"||!/^link_[A-Za-z0-9_-]{20,120}$/u.test(q.attemptId)||typeof q.prompt!=="string"||!q.prompt.trim()||q.prompt.length>5000||!wellFormed(q.prompt)||
 !["mini","fast","pro"].includes(q.version)||!(q.version==="pro"?["480p","720p","1080p","4K"]:["480p","720p"]).includes(q.resolution)||
 !["21:9","16:9","4:3","1:1","3:4","9:16"].includes(q.aspect_ratio)||!Number.isInteger(q.video_duration)||q.video_duration<4||q.video_duration>15||typeof q.generate_audio!=="boolean")throw Error("INVALID_REQUEST");
 const parameters=Object.freeze({prompt:q.prompt,resolution:q.resolution,aspect_ratio:q.aspect_ratio,video_duration:q.video_duration,generate_audio:q.generate_audio,version:q.version,mode:"omni-references"});
 return Object.freeze({attemptId:q.attemptId,prompt:q.prompt,parameters,semanticIntent:parameters});
}
function wellFormed(v:string):boolean{for(let i=0;i<v.length;i++){const c=v.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const n=v.charCodeAt(++i);if(!(n>=0xdc00&&n<=0xdfff))return false;}else if(c>=0xdc00&&c<=0xdfff)return false;}return true;}
