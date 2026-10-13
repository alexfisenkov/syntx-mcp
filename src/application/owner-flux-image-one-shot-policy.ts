import { isDeepStrictEqual, types } from "node:util";
import { schemaHash } from "../domain/generation-contract.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { getOwnerFluxImageSourceProfile, type OwnerFluxImageCatalogPort } from "./owner-flux-image-source-profile.js";
import { normalizeOwnerFluxImageParameters, type OwnerFluxImageModel } from "./owner-flux-image-parameters.js";
import {
  getOwnerFluxImagePreparedCandidateState, isOwnerFluxImagePreparedCandidateForPrincipal, observeOwnerFluxImageCandidateClock,
  type OwnerFluxImagePreparedCandidate
} from "./owner-flux-image-request-preparer.js";

const TTL_MS=15*60_000;
const BRAND:unique symbol=Symbol("OwnerFluxImageOneShotPermit");
const states=new WeakMap<object,PermitState>();
const candidatePermits=new WeakMap<object,object>();
export interface CreateOwnerFluxImageOneShotPermitInput {readonly candidate:OwnerFluxImagePreparedCandidate;readonly principal:GenerationPrincipalRef;readonly attemptId:string;readonly catalog:OwnerFluxImageCatalogPort;readonly catalog_version:string;readonly now?:()=>number;}
export interface OwnerFluxImageOneShotPermit {readonly [BRAND]:true;readonly status:"nominal";readonly dispatch_allowed:false;readonly profile_id:string;readonly profile_schema_hash:string;readonly variant:OwnerFluxImageModel;readonly model_id:OwnerFluxImageModel;readonly ai_name:"flux";readonly public_catalog_version:string;readonly catalog_version:string;readonly request_fingerprint:string;readonly intent_fingerprint:string;readonly expires_at:number;}
export interface ConsumeOwnerFluxImageOneShotPermitInput {readonly permit:OwnerFluxImageOneShotPermit;readonly candidate:OwnerFluxImagePreparedCandidate;readonly principal:GenerationPrincipalRef;readonly attemptId:string;}
export interface OwnerFluxImageOneShotPermitReceipt {readonly status:"consumed";readonly dispatch_allowed:false;readonly request_fingerprint:string;}
export type OwnerFluxImageOneShotPolicyErrorCode="INVALID_REQUEST"|"CANDIDATE_UNBOUND"|"CANDIDATE_EXPIRED"|"CANDIDATE_ALREADY_ISSUED"|"CATALOG_BINDING_MISMATCH"|"PERMIT_INVALID"|"PERMIT_EXPIRED"|"PERMIT_ALREADY_CONSUMED"|"PRINCIPAL_MISMATCH"|"CANDIDATE_MISMATCH"|"CLOCK_INVALID";
export class OwnerFluxImageOneShotPolicyError extends Error {constructor(readonly code:OwnerFluxImageOneShotPolicyErrorCode){super("The owner Flux image one-shot policy could not be satisfied.");this.name="OwnerFluxImageOneShotPolicyError";}}
interface PermitState {readonly permit:OwnerFluxImageOneShotPermit;readonly candidate:OwnerFluxImagePreparedCandidate;readonly principal:Readonly<GenerationPrincipalRef>;readonly attemptId:string;readonly catalog:OwnerFluxImageCatalogPort;readonly catalogVersion:string;readonly candidateFingerprint:string;readonly requestFingerprint:string;readonly intentFingerprint:string;readonly expiry:number;readonly originalExpiry:number;readonly now:()=>number;lastNow:number;consumed:boolean;expired:boolean;}

/** Issues a local nominal permit for one exact candidate; this is not payment or dispatch authorization. */
export function createOwnerFluxImageOneShotPermit(input:CreateOwnerFluxImageOneShotPermitInput|unknown):OwnerFluxImageOneShotPermit{
  const f=exact(input,["candidate","principal","attemptId","catalog","catalog_version","now"],["candidate","principal","attemptId","catalog","catalog_version"]);
  if(typeof f.attemptId!=="string"||!/^link_[A-Za-z0-9_-]{20,120}$/u.test(f.attemptId)||typeof f.catalog_version!=="string"||!f.catalog||typeof f.catalog!=="object"||types.isProxy(f.catalog)||(f.now!==undefined&&(typeof f.now!=="function"||types.isProxy(f.now))))fail("INVALID_REQUEST");
  const principal=snapshotPrincipal(f.principal,f.attemptId);const now=(f.now as (()=>number)|undefined)??Date.now;const current=readClock(now);const candidate=f.candidate as OwnerFluxImagePreparedCandidate;
  if(!isOwnerFluxImagePreparedCandidateForPrincipal(candidate,principal,f.attemptId,current))fail("CANDIDATE_UNBOUND");
  const candidateState=getOwnerFluxImagePreparedCandidateState(candidate);if(!candidateState)fail("CANDIDATE_UNBOUND");if(!observeOwnerFluxImageCandidateClock(candidate,current))fail("CANDIDATE_EXPIRED");
  let profile;try{profile=getOwnerFluxImageSourceProfile(candidate.variant,f.catalog as OwnerFluxImageCatalogPort,f.catalog_version);}catch{fail("CATALOG_BINDING_MISMATCH");}
  if(f.catalog_version!==profile.public_catalog_version||profile.variant!==candidate.variant||profile.dispatch_allowed!==false||profile.backend_acceptance!=="UNPROVEN")fail("CATALOG_BINDING_MISMATCH");
  const fingerprint=validateCandidate(candidate,principal,f.attemptId as string,profile);if(candidatePermits.has(candidate))fail("CANDIDATE_ALREADY_ISSUED");
  const expiry=Math.min(candidateState.expires_at,current+TTL_MS);if(!Number.isSafeInteger(expiry)||expiry<=current)fail("CANDIDATE_EXPIRED");
  const permit:OwnerFluxImageOneShotPermit=Object.freeze({[BRAND]:true as const,status:"nominal",dispatch_allowed:false,profile_id:profile.profile_id,profile_schema_hash:profile.profile_schema_hash,
    variant:profile.variant,model_id:profile.model_id,ai_name:"flux",public_catalog_version:profile.public_catalog_version,catalog_version:f.catalog_version as string,
    request_fingerprint:candidate.request_fingerprint,intent_fingerprint:candidate.intent_fingerprint,expires_at:expiry});
  states.set(permit,{permit,candidate,principal,attemptId:f.attemptId as string,catalog:f.catalog as OwnerFluxImageCatalogPort,catalogVersion:f.catalog_version as string,
    candidateFingerprint:fingerprint,requestFingerprint:candidate.request_fingerprint,intentFingerprint:candidate.intent_fingerprint,expiry,originalExpiry:candidateState.expires_at,now,lastNow:current,consumed:false,expired:false});
  candidatePermits.set(candidate,permit);return permit;
}

/** Consumes synchronously once before a future native adapter could perform one POST. */
export function consumeOwnerFluxImageOneShotPermit(input:ConsumeOwnerFluxImageOneShotPermitInput|unknown):OwnerFluxImageOneShotPermitReceipt{
  const f=exact(input,["permit","candidate","principal","attemptId"]);if(typeof f.attemptId!=="string"||!/^link_[A-Za-z0-9_-]{20,120}$/u.test(f.attemptId))fail("INVALID_REQUEST");
  const permit=f.permit as OwnerFluxImageOneShotPermit;if(!permit||typeof permit!=="object"||types.isProxy(permit))fail("PERMIT_INVALID");const state=states.get(permit);
  if(!state||state.permit!==permit||!hasPermitShape(permit))fail("PERMIT_INVALID");if(state.consumed)fail("PERMIT_ALREADY_CONSUMED");if(state.expired)fail("PERMIT_EXPIRED");
  const now=readClock(state.now);if(now<state.lastNow){state.expired=true;observeOwnerFluxImageCandidateClock(state.candidate,now);fail("CLOCK_INVALID");}state.lastNow=now;
  if(now>=state.expiry||now>=state.originalExpiry){state.expired=true;fail("PERMIT_EXPIRED");}if(!observeOwnerFluxImageCandidateClock(state.candidate,now)){state.expired=true;fail("CANDIDATE_EXPIRED");}
  const principal=snapshotPrincipal(f.principal,f.attemptId);if(f.attemptId!==state.attemptId||!sameGenerationPrincipal(principal,state.principal))fail("PRINCIPAL_MISMATCH");
  if(f.candidate!==state.candidate||candidatePermits.get(state.candidate)!==permit||!isOwnerFluxImagePreparedCandidateForPrincipal(state.candidate,state.principal,state.attemptId,now))fail("CANDIDATE_MISMATCH");
  let profile;try{profile=getOwnerFluxImageSourceProfile(state.candidate.variant,state.catalog,state.catalogVersion);}catch{fail("CATALOG_BINDING_MISMATCH");}
  if(permit.request_fingerprint!==state.requestFingerprint||permit.intent_fingerprint!==state.intentFingerprint||permit.profile_schema_hash!==profile.profile_schema_hash||permit.profile_id!==profile.profile_id||
    permit.public_catalog_version!==profile.public_catalog_version||permit.catalog_version!==state.catalogVersion||validateCandidate(state.candidate,state.principal,state.attemptId,profile)!==state.candidateFingerprint)fail("CANDIDATE_MISMATCH");
  state.consumed=true;return Object.freeze({status:"consumed",dispatch_allowed:false,request_fingerprint:state.requestFingerprint});
}

function validateCandidate(c:OwnerFluxImagePreparedCandidate,p:Readonly<GenerationPrincipalRef>,attempt:string,profile:ReturnType<typeof getOwnerFluxImageSourceProfile>):string{
  const state=getOwnerFluxImagePreparedCandidateState(c);if(!state||state.attempt_id!==attempt||!sameGenerationPrincipal(state.principal,p)||c.status!=="blocked"||c.dispatch_allowed!==false||c.backend_acceptance!=="UNPROVEN"||
    c.profile_id!==profile.profile_id||c.profile_schema_hash!==profile.profile_schema_hash||!isDeepStrictEqual(c.source_binding,profile.source_binding)||c.model_id!==profile.model_id||c.ai_name!=="flux"||c.variant!==profile.variant||
    c.model_type!==profile.variant||c.scope!=="image"||c.operation_id!=="generate-image"||c.prompt_local_max_utf8_bytes!==65_536||c.prompt_limit_confidence!=="LOCAL_RESOURCE_GUARD_NOT_PROVIDER_LIMIT"||
    !c.cost_inputs||Object.keys(c.cost_inputs).length!==0||c.expires_at!==state.expires_at||c.request_fingerprint!==state.request_fingerprint||c.intent_fingerprint!==state.intent_fingerprint)fail("CANDIDATE_UNBOUND");
  let normalized;try{normalized=normalizeOwnerFluxImageParameters({variant:c.variant,reference_count:c.reference_count,parameters:state.private_parameters});}catch{fail("CANDIDATE_UNBOUND");}
  if(!isDeepStrictEqual(normalized.parameters,state.private_parameters)||!isDeepStrictEqual(c.parameters,{resolution:normalized.parameters.resolution,cfg:normalized.parameters.cfg,steps:normalized.parameters.steps,image_strength:normalized.parameters.image_strength,workflow_type:normalized.parameters.workflow_type,raw:normalized.parameters.raw,lora_count:normalized.parameters.civitai_loras.length}))fail("CANDIDATE_UNBOUND");
  if(c.lora_assets.length!==normalized.parameters.civitai_loras.length)fail("CANDIDATE_UNBOUND");
  for(let i=0;i<c.lora_assets.length;i++){const asset=exact(c.lora_assets[i],["provenance","size","sha256","strength_model","strength_clip"]);const lora=normalized.parameters.civitai_loras[i]!;
    if((asset.provenance!=="public_civitai_verified"&&asset.provenance!=="private_r2_owned")||!Number.isSafeInteger(asset.size)||(asset.size as number)<1||
      typeof asset.sha256!=="string"||!/^sha256:[a-f0-9]{64}$/u.test(asset.sha256)||asset.strength_model!==lora.strength_model||asset.strength_clip!==lora.strength_clip)fail("CANDIDATE_UNBOUND");}
  const request=exact(c.request,["prompt","settings"]);const expectedSettings=Object.assign(Object.create(null) as Record<string,unknown>,normalized.source_json_mapping);
  const expectedFiles=c.reference_count===1?(request.settings as Record<string,unknown>)?.file_urls:[];
  if(request.prompt!==c.prompt||!Object.isFrozen(c.request)||!Object.isFrozen(request.settings)||!Array.isArray(expectedFiles)||expectedFiles.length!==c.reference_count)fail("CANDIDATE_UNBOUND");
  for(const item of expectedFiles as unknown[]){const wire=exact(item,["type","url"]);if(wire.type!=="image"||typeof wire.url!=="string"||!/^https:\/\/r2\.syntx\.ai\//u.test(wire.url))fail("CANDIDATE_UNBOUND");}
  expectedSettings.file_urls=expectedFiles;if(!isDeepStrictEqual(request.settings,expectedSettings))fail("CANDIDATE_UNBOUND");
  return schemaHash({candidate:{status:c.status,profile_id:c.profile_id,profile_schema_hash:c.profile_schema_hash,source_binding:c.source_binding,model_id:c.model_id,prompt:c.prompt,parameters:c.parameters,
    reference_count:c.reference_count,references:c.references,lora_assets:c.lora_assets,cost_inputs:c.cost_inputs,expires_at:c.expires_at,request_fingerprint:c.request_fingerprint,intent_fingerprint:c.intent_fingerprint},request:c.request});
}
function hasPermitShape(v:object):boolean{if(types.isProxy(v)||!Object.isFrozen(v))return false;try{const d=Object.getOwnPropertyDescriptors(v) as Record<PropertyKey,PropertyDescriptor>;const expected=["status","dispatch_allowed","profile_id","profile_schema_hash","variant","model_id","ai_name","public_catalog_version","catalog_version","request_fingerprint","intent_fingerprint","expires_at"];const keys=Reflect.ownKeys(d);return keys.length===expected.length+1&&keys.includes(BRAND)&&expected.every(k=>Object.hasOwn(d,k)&&"value"in d[k]!)&&d[BRAND]?.value===true&&d.status!.value==="nominal"&&d.dispatch_allowed!.value===false&&Number.isSafeInteger(d.expires_at!.value);}catch{return false;}}
function snapshotPrincipal(v:unknown,a:unknown):Readonly<GenerationPrincipalRef>{if(typeof a!=="string")fail("INVALID_REQUEST");let p:Readonly<GenerationPrincipalRef>;try{p=snapshotGenerationPrincipal(v as GenerationPrincipalRef);}catch{fail("INVALID_REQUEST");}if(p.connection_id!==a)fail("PRINCIPAL_MISMATCH");return p;}
function readClock(now:()=>number):number{let n:number;try{n=now();}catch{fail("CLOCK_INVALID");}if(!Number.isSafeInteger(n)||n<0)fail("CLOCK_INVALID");return n;}
function exact(v:unknown,keys:readonly string[],required:readonly string[]=keys):Record<string,any>{if(!v||typeof v!=="object"||Array.isArray(v)||types.isProxy(v))fail("INVALID_REQUEST");try{const p=Object.getPrototypeOf(v);const d=Object.getOwnPropertyDescriptors(v);const own=Reflect.ownKeys(d);if((p!==Object.prototype&&p!==null)||own.some(k=>typeof k!=="string"||!keys.includes(k)||!("value"in d[k]!)||!d[k]!.enumerable)||required.some(k=>!Object.hasOwn(d,k)))fail("INVALID_REQUEST");const o=Object.create(null);for(const k of own as string[])o[k]=d[k]!.value;return o;}catch(e){if(e instanceof OwnerFluxImageOneShotPolicyError)throw e;fail("INVALID_REQUEST");}}
function fail(code:OwnerFluxImageOneShotPolicyErrorCode):never{throw new OwnerFluxImageOneShotPolicyError(code);}
