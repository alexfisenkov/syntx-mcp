import { isProxy } from "node:util/types";
import { schemaHash } from "../domain/generation-contract.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { getOwnerFluxImageSourceProfile, type OwnerFluxImageCatalogPort, type OwnerFluxImageSourceProfile } from "./owner-flux-image-source-profile.js";
import { normalizeOwnerFluxImageParameters, type OwnerFluxImageModel, type OwnerFluxImageParameters } from "./owner-flux-image-parameters.js";

const TTL_MS = 15 * 60_000;
const MAX_PENDING = 4;
const MAX_ACTIVE = 128;
const MAX_IMAGE_ASSET_BYTES = 33_554_432;
const MAX_LORA_ASSET_BYTES = 1_073_741_824;
const MAX_PROMPT_BYTES = 65_536;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const IMAGE_HANDLE = /^flux_image_[0-9a-f-]{36}$/u;
const LORA_HANDLE = /^flux_lora_[0-9a-f-]{36}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const SOURCE_FIELDS = ["principal", "attempt_id", "model_id", "ai_name", "scope", "operation_id", "catalog_version", "profile_schema_hash"] as const;
type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export interface OwnerFluxAssetResolverContext {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly model_id: OwnerFluxImageModel;
  readonly ai_name: "flux";
  readonly scope: "image";
  readonly operation_id: "generate-image";
  readonly catalog_version: string;
  readonly profile_schema_hash: string;
  readonly asset_handle: string;
  readonly asset_role: "image_reference" | "lora";
}
export interface OwnerFluxImageReferenceResolution extends OwnerFluxAssetResolverContext {
  readonly asset_role: "image_reference";
  readonly provenance: "private_r2_owned";
  readonly provenance_verified: true;
  readonly asset_id: string;
  readonly canonical_url: string;
  readonly mime_type: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly size: number;
  readonly sha256: string;
  readonly expires_at: number;
}
export interface OwnerFluxLoraResolution extends OwnerFluxAssetResolverContext {
  readonly asset_role: "lora";
  readonly provenance: "public_civitai_verified" | "private_r2_owned";
  readonly provenance_verified: true;
  readonly asset_id: string;
  readonly canonical_url: string;
  readonly sha256: string;
  readonly size: number;
  readonly expires_at: number;
}
export type ResolveOwnerFluxImageReference = (context: Readonly<OwnerFluxAssetResolverContext>) => Promise<OwnerFluxImageReferenceResolution>;
export type ResolveOwnerFluxLora = (context: Readonly<OwnerFluxAssetResolverContext>) => Promise<OwnerFluxLoraResolution>;
export interface OwnerFluxAssetBindingResolvers { readonly resolveImage: ResolveOwnerFluxImageReference; readonly resolveLora: ResolveOwnerFluxLora; }
export interface OwnerFluxImageBindingIssuerOptions { readonly catalog: OwnerFluxImageCatalogPort; readonly catalog_version: string; readonly now?: () => number; }
export interface OwnerFluxImageAssetBindingIssuer {
  issue(input: OwnerFluxImageAssetBindingIssueInput | unknown): Promise<OwnerFluxImageAssetSet>;
  invalidateAttempt(attemptId: string): void;
  close(): void;
}
export interface OwnerFluxLoraRequest { readonly handle: string; readonly strength_model: number; readonly strength_clip: number; }
export interface OwnerFluxImageAssetBindingIssueInput {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly model_id: OwnerFluxImageModel;
  readonly image_reference_handle?: string;
  readonly lora_references: readonly OwnerFluxLoraRequest[];
}
const assetSetBrand: unique symbol = Symbol("OwnerFluxImageAssetSet");
export interface OwnerFluxImageAssetSet {
  readonly [assetSetBrand]: true;
  readonly model_id: OwnerFluxImageModel;
  readonly image_reference_count: number;
  readonly lora_count: number;
  readonly expires_at: number;
}
interface BoundAssets {
  readonly principal: Readonly<GenerationPrincipalRef>; readonly attempt_id: string; readonly model_id: OwnerFluxImageModel;
  readonly profile: Readonly<OwnerFluxImageSourceProfile>; readonly image: Readonly<OwnerFluxImageReferenceResolution> | null;
  readonly loras: readonly Readonly<OwnerFluxLoraResolution>[]; readonly weights: readonly Readonly<{strength_model:number;strength_clip:number}>[];
  readonly handles: readonly string[];
  readonly expires_at: number; readonly epoch: number;
}
interface CandidateState {
  readonly principal: Readonly<GenerationPrincipalRef>; readonly attempt_id: string; readonly asset_set: object;
  readonly expires_at: number; readonly request_fingerprint: string; readonly intent_fingerprint: string;
  readonly private_parameters: Readonly<OwnerFluxImageParameters>; readonly last_now: number; expired: boolean;
}
const assetSets = new WeakMap<object, BoundAssets>();
const revokedSets = new WeakSet<object>();
const candidates = new WeakMap<object, CandidateState>();
const revokedCandidates = new WeakSet<object>();

export interface OwnerFluxImagePreparedCandidate {
  readonly status: "blocked"; readonly source_readiness: "SOURCE_JOINED_FULL_SETTINGS_OWNED_REFERENCES_AND_PROMPT";
  readonly dispatch_allowed: false; readonly backend_acceptance: "UNPROVEN"; readonly profile_id: string; readonly profile_schema_hash: string;
  readonly source_binding: Readonly<Record<string, unknown>>; readonly model_id: OwnerFluxImageModel; readonly ai_name: "flux";
  readonly variant: OwnerFluxImageModel; readonly model_type: OwnerFluxImageModel; readonly scope: "image"; readonly operation_id: "generate-image";
  readonly prompt: string; readonly prompt_local_max_utf8_bytes: 65_536; readonly prompt_limit_confidence: "LOCAL_RESOURCE_GUARD_NOT_PROVIDER_LIMIT";
  readonly parameters: Readonly<{resolution:string;cfg:number;steps:number;image_strength:number;workflow_type:"default"|"civitai";raw:false|null;lora_count:number}>; readonly reference_count: number;
  readonly references: readonly Readonly<{mime_type:string;width:number|null;height:number|null;size:number;sha256:string;metadata_confidence:"CONTAINER_METADATA_ONLY"}>[];
  readonly lora_assets: readonly Readonly<{provenance:"public_civitai_verified"|"private_r2_owned";size:number;sha256:string;strength_model:number;strength_clip:number}>[];
  readonly cost_inputs: Readonly<Record<string, never>>; readonly cost_input_confidence: string; readonly expires_at: number;
  readonly request_fingerprint: string; readonly intent_fingerprint: string;
  readonly request: Readonly<{prompt:string;settings:Readonly<Record<string,unknown>>}>;
}
export interface PrepareOwnerFluxImageRequestInput {
  readonly principal: Readonly<GenerationPrincipalRef>; readonly attempt_id: string; readonly model_id: OwnerFluxImageModel;
  readonly parameters: unknown; readonly asset_set: OwnerFluxImageAssetSet; readonly prompt: string;
}
export interface OwnerFluxImageBindingOptions extends OwnerFluxImageBindingIssuerOptions {}
export type OwnerFluxImagePrepareErrorCode = "INVALID_REQUEST"|"PROFILE_BINDING_MISMATCH"|"PRINCIPAL_MISMATCH"|"ASSET_UNAVAILABLE"|"ASSET_EXPIRED"|"PARAMETERS_INVALID"|"PROMPT_INVALID"|"CANDIDATE_INVALID"|"CLOCK_INVALID";
export class OwnerFluxImagePrepareError extends Error {
  constructor(readonly code: OwnerFluxImagePrepareErrorCode) { super("The owner Flux image candidate could not be prepared safely."); this.name = "OwnerFluxImagePrepareError"; }
}

/** Injects trusted asset resolvers; URL syntax and caller metadata are never ownership evidence. */
export function createOwnerFluxImageAssetBindingIssuer(resolvers: OwnerFluxAssetBindingResolvers | unknown, optionsInput: OwnerFluxImageBindingIssuerOptions | unknown): OwnerFluxImageAssetBindingIssuer {
  const r = exact(resolvers, ["resolveImage", "resolveLora"]);
  if (typeof r.resolveImage !== "function" || typeof r.resolveLora !== "function" || isProxy(r.resolveImage) || isProxy(r.resolveLora)) fail("INVALID_REQUEST");
  const options = snapshotOptions(optionsInput); let closed = false; let pending = 0;
  const epochs = new Map<string, number>(); const active = new Map<string, Set<object>>();
  const invalidateAttempt = (id: string): void => { if (!ATTEMPT.test(id)) return; epochs.set(id,(epochs.get(id)??0)+1); for (const set of active.get(id)??[]) revokedSets.add(set); active.delete(id); };
  return Object.freeze({
    async issue(input: OwnerFluxImageAssetBindingIssueInput | unknown): Promise<OwnerFluxImageAssetSet> {
      pruneActive(active, revokedSets, options.now ?? Date.now);
      if (closed || pending >= MAX_PENDING || activeSize(active) >= MAX_ACTIVE) fail("ASSET_UNAVAILABLE");
      const req = exact(input,["principal","attempt_id","model_id","image_reference_handle","lora_references"],["principal","attempt_id","model_id","lora_references"]);
      if (typeof req.attempt_id !== "string" || !ATTEMPT.test(req.attempt_id) || !isModel(req.model_id)) fail("INVALID_REQUEST");
      const principal=snapshotPrincipal(req.principal,req.attempt_id); const handles=snapshotLoraRequests(req.lora_references);
      if (handles.length > 3 || (req.model_id !== "flux-1" && handles.length !== 0)) fail("INVALID_REQUEST");
      const imageHandle=req.image_reference_handle;
      if (imageHandle !== undefined && (req.model_id !== "flux-1" || typeof imageHandle !== "string" || !IMAGE_HANDLE.test(imageHandle))) fail("INVALID_REQUEST");
      const profile=profileFor(req.model_id,options); const now=safeNow(options.now); if(now>Number.MAX_SAFE_INTEGER-TTL_MS) fail("CLOCK_INVALID");
      const epoch=epochs.get(req.attempt_id)??0; pending++;
      try {
        const context=(handle:string,role:"image_reference"|"lora")=>Object.freeze({principal,attempt_id:req.attempt_id as string,model_id:req.model_id as OwnerFluxImageModel,
          ai_name:"flux" as const,scope:"image" as const,operation_id:"generate-image" as const,catalog_version:profile.public_catalog_version,
          profile_schema_hash:profile.profile_schema_hash,asset_handle:handle,asset_role:role});
        let image: OwnerFluxImageReferenceResolution|null=null;
        if(typeof imageHandle==="string") image=await resolveAsset(()=> (r.resolveImage as ResolveOwnerFluxImageReference)(context(imageHandle,"image_reference")),closed,epochs,req.attempt_id as string,epoch,"image_reference",context(imageHandle,"image_reference"),now) as OwnerFluxImageReferenceResolution;
        const loras:OwnerFluxLoraResolution[]=[];
        for(const item of handles){ const ctx=context(item.handle,"lora"); const resolved=await resolveAsset(()=> (r.resolveLora as ResolveOwnerFluxLora)(ctx),closed,epochs,req.attempt_id as string,epoch,"lora",ctx,now) as OwnerFluxLoraResolution;
          if(loras.some(x=>x.asset_id===resolved.asset_id || x.canonical_url===resolved.canonical_url || x.sha256===resolved.sha256)) fail("ASSET_UNAVAILABLE"); loras.push(resolved); }
        if(closed || (epochs.get(req.attempt_id as string)??0)!==epoch) fail("ASSET_UNAVAILABLE");
        const expiry=Math.min(now+TTL_MS,...[...(image?[image.expires_at]:[]),...loras.map(x=>x.expires_at)]);
        if(expiry<=safeNow(options.now)) fail("ASSET_EXPIRED");
        const set=Object.create(null) as OwnerFluxImageAssetSet;
        Object.defineProperties(set,{[assetSetBrand]:{value:true},model_id:{value:req.model_id},image_reference_count:{value:image?1:0},lora_count:{value:loras.length},expires_at:{value:expiry}}); Object.freeze(set);
        assetSets.set(set,Object.freeze({principal,attempt_id:req.attempt_id as string,model_id:req.model_id as OwnerFluxImageModel,profile,image,
          loras:Object.freeze(loras),weights:Object.freeze(handles.map(x=>Object.freeze({strength_model:x.strength_model,strength_clip:x.strength_clip}))),
          handles:Object.freeze(handles.map(x=>x.handle)),expires_at:expiry,epoch}));
        const bucket=active.get(req.attempt_id as string)??new Set<object>(); bucket.add(set); active.set(req.attempt_id as string,bucket); return set;
      } finally { pending--; }
    },
    invalidateAttempt,
    close():void { if(closed)return; closed=true; for(const bucket of active.values()) for(const set of bucket) revokedSets.add(set); active.clear(); epochs.clear(); }
  });
}

/** Creates a source-complete local candidate; request URLs stay non-enumerable and private. */
export function prepareOwnerFluxImageRequest(input: PrepareOwnerFluxImageRequestInput | unknown, optionsInput: OwnerFluxImageBindingOptions | unknown): OwnerFluxImagePreparedCandidate {
  const req=exact(input,["principal","attempt_id","model_id","parameters","asset_set","prompt"]); const options=snapshotOptions(optionsInput);
  if(typeof req.attempt_id!=="string" || !isModel(req.model_id)) fail("INVALID_REQUEST");
  const principal=snapshotPrincipal(req.principal,req.attempt_id); const prompt=validatePrompt(req.prompt); const profile=profileFor(req.model_id,options);
  const set=req.asset_set; if(!set || typeof set!=="object" || Array.isArray(set) || isProxy(set) || !Object.isFrozen(set)) fail("ASSET_UNAVAILABLE");
  const bound=assetSets.get(set as object); if(!bound || revokedSets.has(set as object) || bound.attempt_id!==req.attempt_id || bound.model_id!==req.model_id ||
    bound.profile.profile_schema_hash!==profile.profile_schema_hash || !sameGenerationPrincipal(bound.principal,principal)) fail("ASSET_UNAVAILABLE");
  const now=safeNow(options.now ?? Date.now); if(bound.expires_at<=now) fail("ASSET_EXPIRED");
  const supplied=snapshotParametersIntent(req.parameters,req.model_id as OwnerFluxImageModel);
  if(supplied.loras.length!==bound.loras.length || supplied.loras.some((x,i)=>x.handle!==handlesForBoundAsset(bound,i) || x.strength_model!==bound.weights[i]?.strength_model || x.strength_clip!==bound.weights[i]?.strength_clip)) fail("PARAMETERS_INVALID");
  const canonicalParameters={...supplied.parameters,civitai_loras:bound.loras.map((asset,i)=>({id:asset.asset_id,url:asset.canonical_url,strength_model:bound.weights[i]!.strength_model,strength_clip:bound.weights[i]!.strength_clip}))};
  let normalized; try { normalized=normalizeOwnerFluxImageParameters({variant:req.model_id,reference_count:bound.image?1:0,parameters:canonicalParameters}); } catch { fail("PARAMETERS_INVALID"); }
  const wireSettings=Object.assign(Object.create(null) as Record<string,unknown>,normalized.source_json_mapping,{file_urls:bound.image?[{type:"image",url:bound.image.canonical_url}]:[]});
  const privateRequest=deepFreeze({prompt,settings:wireSettings});
  const referenceMetadata=bound.image?deepFreeze([{mime_type:bound.image.mime_type,width:bound.image.width,height:bound.image.height,size:bound.image.size,sha256:bound.image.sha256,metadata_confidence:"CONTAINER_METADATA_ONLY" as const}]):Object.freeze([]);
  const loraMetadata=deepFreeze(bound.loras.map((x,i)=>({provenance:x.provenance,size:x.size,sha256:x.sha256,strength_model:bound.weights[i]!.strength_model,strength_clip:bound.weights[i]!.strength_clip})));
  const semanticParameters={resolution:normalized.parameters.resolution,cfg:normalized.parameters.cfg,steps:normalized.parameters.steps,image_strength:normalized.parameters.image_strength,workflow_type:normalized.parameters.workflow_type,raw:normalized.parameters.raw};
  const requestFingerprint=schemaHash({principal,attempt_id:req.attempt_id,profile_id:profile.profile_id,profile_schema_hash:profile.profile_schema_hash,model_id:req.model_id,
    parameters:normalized.parameters,prompt,reference:bound.image?privateRefFingerprint(bound.image):null,loras:bound.loras.map(privateLoraFingerprint)});
  const intentFingerprint=schemaHash({principal:{tenant_id:principal.tenant_id,subject_id:principal.subject_id},profile_id:profile.profile_id,profile_schema_hash:profile.profile_schema_hash,
    model_id:req.model_id,parameters:semanticParameters,prompt,reference:bound.image?{mime_type:bound.image.mime_type,size:bound.image.size,sha256:bound.image.sha256}:null,
    loras:bound.loras.map((x,i)=>({size:x.size,sha256:x.sha256,strength_model:bound.weights[i]!.strength_model,strength_clip:bound.weights[i]!.strength_clip}))});
  const candidateData:Record<string,unknown>={status:"blocked",source_readiness:"SOURCE_JOINED_FULL_SETTINGS_OWNED_REFERENCES_AND_PROMPT",dispatch_allowed:false,backend_acceptance:"UNPROVEN",
    profile_id:profile.profile_id,profile_schema_hash:profile.profile_schema_hash,source_binding:profile.source_binding,model_id:req.model_id,ai_name:"flux",variant:req.model_id,model_type:req.model_id,
    scope:"image",operation_id:"generate-image",prompt,prompt_local_max_utf8_bytes:MAX_PROMPT_BYTES,prompt_limit_confidence:"LOCAL_RESOURCE_GUARD_NOT_PROVIDER_LIMIT",
    parameters:deepFreeze({...semanticParameters,lora_count:bound.loras.length}),reference_count:bound.image?1:0,references:referenceMetadata,lora_assets:loraMetadata,cost_inputs:Object.freeze(Object.create(null)),
    cost_input_confidence:normalized.cost_input_confidence,expires_at:bound.expires_at,request_fingerprint:requestFingerprint,intent_fingerprint:intentFingerprint};
  Object.defineProperty(candidateData,"request",{value:privateRequest,enumerable:false,writable:false,configurable:false}); Object.freeze(candidateData);
  const candidate=candidateData as unknown as OwnerFluxImagePreparedCandidate;
  candidates.set(candidate,Object.seal({principal,attempt_id:req.attempt_id,asset_set:set as object,expires_at:bound.expires_at,request_fingerprint:requestFingerprint,
    intent_fingerprint:intentFingerprint,private_parameters:normalized.parameters,last_now:now,expired:false})); return candidate;
}

export function isOwnerFluxImagePreparedCandidateForPrincipal(value: unknown, principalInput: unknown, attemptId: unknown, nowInput?: number): value is OwnerFluxImagePreparedCandidate {
  if(!value || typeof value!=="object" || Array.isArray(value) || isProxy(value)) return false;
  const state=candidates.get(value as object); if(!state || revokedCandidates.has(value as object) || state.attempt_id!==attemptId || revokedSets.has(state.asset_set)) return false;
  let principal:Readonly<GenerationPrincipalRef>; try {principal=snapshotPrincipal(principalInput,attemptId);}catch{return false;}
  if(!sameGenerationPrincipal(state.principal,principal)) return false;
  if(nowInput!==undefined && (!Number.isSafeInteger(nowInput)||nowInput<state.last_now||nowInput>=state.expires_at)) return false;
  return true;
}
export function getOwnerFluxImagePreparedCandidateState(value: unknown): CandidateState | undefined { return value&&typeof value==="object"?candidates.get(value as object):undefined; }
export function observeOwnerFluxImageCandidateClock(value: unknown, now: number): boolean {
  const state=getOwnerFluxImagePreparedCandidateState(value); if(!state || revokedCandidates.has(value as object) || !Number.isSafeInteger(now)||now<state.last_now||now>=state.expires_at){if(state)state.expired=true;return false;}
  (state as {last_now:number}).last_now=now; return !state.expired;
}

function handlesForBoundAsset(_bound:BoundAssets,index:number):string { return _bound.handles[index] ?? ""; }
// Keep only opaque handle digests for equality checking; no handle escapes the WeakMap.
interface BoundAssets { readonly handles: readonly string[]; }
function snapshotParametersIntent(value:unknown,model:OwnerFluxImageModel):{parameters:Record<string,unknown>;loras:readonly OwnerFluxLoraRequest[]} {
  const fields=exact(value,["resolution","cfg","steps","image_strength","workflow_type","raw","civitai_loras"]);
  if(!Array.isArray(fields.civitai_loras)||isProxy(fields.civitai_loras)||Object.getPrototypeOf(fields.civitai_loras)!==Array.prototype) fail("PARAMETERS_INVALID");
  const descriptors=Object.getOwnPropertyDescriptors(fields.civitai_loras); const keys=Reflect.ownKeys(descriptors); const loras:OwnerFluxLoraRequest[]=[];
  if(keys.length!==fields.civitai_loras.length+1 || !Object.hasOwn(descriptors,"length")) fail("PARAMETERS_INVALID");
  for(let i=0;i<fields.civitai_loras.length;i++){const d=descriptors[String(i)];if(!d||!("value"in d)||!d.enumerable)fail("PARAMETERS_INVALID"); const x=exact(d.value,["handle","strength_model","strength_clip"]);
    if(typeof x.handle!=="string"||!LORA_HANDLE.test(x.handle)||!inRange(x.strength_model,0,1.5)||x.strength_clip!==x.strength_model)fail("PARAMETERS_INVALID"); loras.push(Object.freeze({handle:x.handle,strength_model:x.strength_model as number,strength_clip:x.strength_clip as number}));}
  const parameters=Object.assign(Object.create(null) as Record<string,unknown>,fields); delete parameters.civitai_loras;
  if(model!=="flux-1"&&loras.length) fail("PARAMETERS_INVALID"); return {parameters,loras:Object.freeze(loras)};
}
function snapshotLoraRequests(value:unknown):readonly OwnerFluxLoraRequest[]{if(!Array.isArray(value)||isProxy(value)||Object.getPrototypeOf(value)!==Array.prototype)fail("INVALID_REQUEST");const d=Object.getOwnPropertyDescriptors(value);const keys=Reflect.ownKeys(d);if(keys.length!==value.length+1)fail("INVALID_REQUEST");const out:OwnerFluxLoraRequest[]=[];for(let i=0;i<value.length;i++){const x=exact(d[String(i)]?.value,["handle","strength_model","strength_clip"]);if(typeof x.handle!=="string"||!LORA_HANDLE.test(x.handle)||!inRange(x.strength_model,0,1.5)||x.strength_clip!==x.strength_model)fail("INVALID_REQUEST");out.push(Object.freeze({handle:x.handle,strength_model:x.strength_model as number,strength_clip:x.strength_clip as number}));}if(new Set(out.map(x=>x.handle)).size!==out.length)fail("INVALID_REQUEST");return Object.freeze(out);}
async function resolveAsset(call:()=>Promise<unknown>,closed:boolean,epochs:Map<string,number>,attempt:string,epoch:number,role:"image_reference"|"lora",context:Readonly<OwnerFluxAssetResolverContext>,now:number):Promise<OwnerFluxImageReferenceResolution|OwnerFluxLoraResolution>{let raw:unknown;try{raw=await call();}catch{fail("ASSET_UNAVAILABLE");}if(closed||(epochs.get(attempt)??0)!==epoch)fail("ASSET_UNAVAILABLE");const value=snapshotResolution(raw,role);validateResolution(value,context,now);return value;}
function snapshotResolution(value:unknown,role:"image_reference"|"lora"):OwnerFluxImageReferenceResolution|OwnerFluxLoraResolution{
  const fields=role==="image_reference"?exact(value,[...SOURCE_FIELDS,"asset_handle","asset_role","provenance","provenance_verified","asset_id","canonical_url","mime_type","width","height","size","sha256","expires_at"]):exact(value,[...SOURCE_FIELDS,"asset_handle","asset_role","provenance","provenance_verified","asset_id","canonical_url","sha256","size","expires_at"]);
  return deepFreeze(fields) as unknown as OwnerFluxImageReferenceResolution|OwnerFluxLoraResolution;
}
function validateResolution(v:OwnerFluxImageReferenceResolution|OwnerFluxLoraResolution,c:Readonly<OwnerFluxAssetResolverContext>,now:number):void{
  const maxAssetBytes=c.asset_role==="image_reference"?MAX_IMAGE_ASSET_BYTES:MAX_LORA_ASSET_BYTES;
  for(const key of SOURCE_FIELDS) if((v as unknown as Record<string,unknown>)[key]!== (c as unknown as Record<string,unknown>)[key]) fail("ASSET_UNAVAILABLE");
  if(v.asset_handle!==c.asset_handle||v.asset_role!==c.asset_role||v.provenance_verified!==true||typeof v.asset_id!=="string"||v.asset_id.length<1||v.asset_id.length>256||
    !Number.isSafeInteger(v.expires_at)||v.expires_at<=now||!Number.isSafeInteger(v.size)||v.size<1||v.size>maxAssetBytes||!SHA256.test(v.sha256)||typeof v.canonical_url!=="string") fail("ASSET_UNAVAILABLE");
  const url=normalizeAssetUrl(v.canonical_url,v.provenance,v.asset_id,c.asset_role); if(url!==v.canonical_url)fail("ASSET_UNAVAILABLE");
  if(c.asset_role==="image_reference") {const i=v as OwnerFluxImageReferenceResolution;if(i.provenance!=="private_r2_owned"||!isSafeUploadReferenceUrl(i.canonical_url)||!MIME_TYPES.has(i.mime_type)||
    !(i.width===null||Number.isSafeInteger(i.width)&&i.width>0)||!(i.height===null||Number.isSafeInteger(i.height)&&i.height>0))fail("ASSET_UNAVAILABLE");}
}
function normalizeAssetUrl(value:string,provenance:string,id:string,role:string):string{
  let u:URL;try{u=new URL(value);}catch{fail("ASSET_UNAVAILABLE");} if(u.protocol!=="https:"||u.username||u.password||u.hash||value!==u.href||u.port)fail("ASSET_UNAVAILABLE");
  if(provenance==="public_civitai_verified"&&role==="lora"&&u.hostname==="civitai.com"&&/^\d+$/u.test(id)&&
    (u.pathname===`/api/download/models/${id}`||(/^\/models\/\d+\/[A-Za-z0-9_-]+$/u.test(u.pathname)&&u.pathname.split("/")[2]===id))){validateCivitQuery(u);return u.href;}
  if(provenance==="private_r2_owned"&&u.hostname==="r2.syntx.ai"&&!u.search&&u.pathname!=="/"&&!/(?:^|\/)\.\.(?:\/|$)/u.test(u.pathname)&&
    (role==="image_reference"||u.pathname.endsWith(`/${id}.safetensors`)||u.pathname===`/${id}.safetensors`)) return u.href;
  fail("ASSET_UNAVAILABLE");
}
function validateCivitQuery(u:URL):void{if(u.search.length>1024)fail("ASSET_UNAVAILABLE");const seen=new Set<string>();let count=0;for(const[k,v]of u.searchParams){const n=k.toLowerCase().replace(/[^a-z0-9]/gu,"");if(++count>16||!k||k.length>64||v.length>256||/[\u0000-\u001f\u007f]/u.test(k+v)||seen.has(n)||/(token|apikey|password|passwd|secret|signature|credential|authorization|bearer|session|jwt|accesskey|privatekey)/u.test(n)||/^(?:bearer|basic)\s+/iu.test(v)||/^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/u.test(v))fail("ASSET_UNAVAILABLE");seen.add(n);}}
function privateRefFingerprint(x:OwnerFluxImageReferenceResolution){return {asset_id:x.asset_id,mime_type:x.mime_type,size:x.size,sha256:x.sha256,expires_at:x.expires_at,url:x.canonical_url};}
function privateLoraFingerprint(x:OwnerFluxLoraResolution){return {asset_id:x.asset_id,provenance:x.provenance,size:x.size,sha256:x.sha256,expires_at:x.expires_at,url:x.canonical_url};}
function pruneActive(buckets:Map<string,Set<object>>,revoked:WeakSet<object>,nowFn:()=>number):void{const now=safeNow(nowFn);for(const[id,bucket]of buckets){for(const set of bucket){const s=assetSets.get(set);if(revoked.has(set)||!s||s.expires_at<=now){revoked.add(set);bucket.delete(set);}}if(bucket.size===0)buckets.delete(id);}}
function activeSize(buckets:Map<string,Set<object>>):number{let n=0;for(const b of buckets.values())n+=b.size;return n;}
function profileFor(model:OwnerFluxImageModel,options:OwnerFluxImageBindingIssuerOptions){try{return getOwnerFluxImageSourceProfile(model,options.catalog,options.catalog_version);}catch{fail("PROFILE_BINDING_MISMATCH");}}
function snapshotOptions(value:unknown):OwnerFluxImageBindingIssuerOptions{const x=exact(value,["catalog","catalog_version","now"],["catalog","catalog_version"]);if(!x.catalog||typeof x.catalog!=="object"||isProxy(x.catalog)||typeof x.catalog_version!=="string"||(x.now!==undefined&&(typeof x.now!=="function"||isProxy(x.now))))fail("INVALID_REQUEST");return Object.freeze({catalog:x.catalog as OwnerFluxImageCatalogPort,catalog_version:x.catalog_version,now:(x.now as (()=>number)|undefined)??Date.now});}
function snapshotPrincipal(value:unknown,attempt:unknown):Readonly<GenerationPrincipalRef>{if(typeof attempt!=="string"||!ATTEMPT.test(attempt))fail("INVALID_REQUEST");let p:Readonly<GenerationPrincipalRef>;try{p=snapshotGenerationPrincipal(value as GenerationPrincipalRef);}catch{fail("INVALID_REQUEST");}if(p.connection_id!==attempt)fail("PRINCIPAL_MISMATCH");return p;}
function validatePrompt(v:unknown):string{if(typeof v!=="string"||!v.trim()||Buffer.byteLength(v,"utf8")>MAX_PROMPT_BYTES||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v)||!wellFormed(v))fail("PROMPT_INVALID");return v;}
function wellFormed(s:string):boolean{for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const n=s.charCodeAt(++i);if(n<0xdc00||n>0xdfff)return false;}else if(c>=0xdc00&&c<=0xdfff)return false;}return true;}
function exact(v:unknown,keys:readonly string[],required:readonly string[]=keys):Record<string,any>{if(!v||typeof v!=="object"||Array.isArray(v)||isProxy(v))fail("INVALID_REQUEST");try{const p=Object.getPrototypeOf(v);const d=Object.getOwnPropertyDescriptors(v);const own=Reflect.ownKeys(d);if((p!==Object.prototype&&p!==null)||own.some(k=>typeof k!=="string"||!keys.includes(k)||!("value"in d[k]!)||!d[k]!.enumerable)||required.some(k=>!Object.hasOwn(d,k)))fail("INVALID_REQUEST");const o=Object.create(null);for(const k of own as string[])o[k]=d[k]!.value;return o;}catch(e){if(e instanceof OwnerFluxImagePrepareError)throw e;fail("INVALID_REQUEST");}}
function deepFreeze<T>(v:T):DeepReadonly<T>{if(!v||typeof v!=="object"||Object.isFrozen(v))return v as DeepReadonly<T>;for(const k of Reflect.ownKeys(v))deepFreeze((v as Record<PropertyKey,unknown>)[k]);return Object.freeze(v) as DeepReadonly<T>;}
function safeNow(now?:()=>number):number{let n:number;try{n=(now??Date.now)();}catch{fail("CLOCK_INVALID");}if(!Number.isSafeInteger(n)||n<0)fail("CLOCK_INVALID");return n;}
function inRange(v:unknown,min:number,max:number):v is number{return typeof v==="number"&&Number.isFinite(v)&&v>=min&&v<=max;}
function isModel(v:unknown):v is OwnerFluxImageModel{return v==="flux-1"||v==="flux-pro-1.1"||v==="flux-pro-1.1-ultra";}
function fail(code:OwnerFluxImagePrepareErrorCode):never{throw new OwnerFluxImagePrepareError(code);}
