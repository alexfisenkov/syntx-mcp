import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../../auth/types.js";
import { PerUserLinkService } from "../../auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../../domain/generation-principal.js";
import { schemaHash } from "../../domain/generation-contract.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";
import { SyntxChatHttpClient, type MediaGenerationReceipt, readOwnerKlingMotionControlUploadReferenceForClient, consumeOwnerKlingMotionControlNativeInvocation } from "./chat-http-client.js";
import { isOwnerKlingMotionControlRequestPreparer, isOwnerKlingMotionControlPreparedCandidate, readOwnerKlingMotionControlNativeBindingForClient,
  type OwnerKlingMotionControlRequestPreparer, type OwnerKlingMotionControlPreparedCandidate, type OwnerKlingMotionControlPrivateRequest } from "../../application/owner-kling-motion-control-request-preparer.js";
import { readOwnerKlingMotionControlPresetVideoReferenceForClient } from "../../application/owner-kling-motion-control-preset-reference-service.js";
import { consumeOwnerKlingMotionControlOneShotPermit, revalidateOwnerKlingMotionControlOneShotPermit, type OwnerKlingMotionControlOneShotPermit } from "../../application/owner-kling-motion-control-one-shot-policy.js";
import { bindOwnerKlingMotionControlHistory } from "./owner-kling-motion-control-history.js";
import { decodeOwnerKlingMotionControlVideoResult, type OwnerKlingMotionControlVideoResult } from "./owner-kling-motion-control-video-result.js";

const ATTEMPT=/^link_[A-Za-z0-9_-]{20,120}$/u, ID=/^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const LINK_GET=PerUserLinkService.prototype.getStatus;
const calls=new WeakMap<object,Map<string,State>>(), chats=new WeakMap<object,State>(), results=new WeakMap<object,ResultState>();
const pendingCreates=new WeakMap<object,number>();
const reserved=new WeakSet<object>(), creating=new WeakSet<object>(), starting=new WeakSet<object>();
type Op=Readonly<{preparer:OwnerKlingMotionControlRequestPreparer;candidate:OwnerKlingMotionControlPreparedCandidate;permit:OwnerKlingMotionControlOneShotPermit;
 principal:Readonly<GenerationPrincipalRef>;attemptId:string;linkService:PerUserLinkService;binding:Readonly<AuthBinding>}>;
export interface OwnerKlingMotionControlNativeOperationInput {readonly preparer:OwnerKlingMotionControlRequestPreparer;readonly candidate:OwnerKlingMotionControlPreparedCandidate;
 readonly permit:OwnerKlingMotionControlOneShotPermit;readonly principal:GenerationPrincipalRef;readonly attemptId:string;readonly linkService:PerUserLinkService;readonly binding:AuthBinding;
 readonly chat?:OwnerKlingMotionControlChatContext;readonly context?:OwnerKlingMotionControlResultContext}
export interface OwnerKlingMotionControlChatContext {readonly status:"created";readonly chat_uuid:string;readonly attempt_id:string;readonly model_id:"kling_motion_control";
 readonly profile_schema_hash:string;readonly request_fingerprint:string;readonly intent_fingerprint:string;readonly expires_at:number;readonly dispatch_allowed:false;readonly backend_acceptance:"UNPROVEN"}
export interface OwnerKlingMotionControlResultContext {readonly chat_uuid:string;readonly message_id:string;readonly model_id:"kling_motion_control";readonly provider_chat_id:string;
 readonly message_object_ids:readonly string[];readonly attempt_id:string;readonly profile_schema_hash:string;readonly intent_fingerprint:string;readonly owner_echo_message_id:string}
export interface OwnerKlingMotionControlResultCandidates {readonly status:"PENDING"|"COMPLETE"|"INCOMPLETE"|"UNVERIFIED";readonly owner_ack_status:"MATCHED"|"MISSING"|"AMBIGUOUS"|"MISMATCH";
 readonly history_binding_status:"BOUND"|"PARTIAL"|"UNVERIFIED";readonly history_page_status:"COMPLETE"|"INCOMPLETE"|"UNPROVEN";readonly history_get_calls:number;
 readonly total_count:number|null;readonly total_pages:number|null;readonly provider_chat_id:string|null;readonly owner_echo_message_id:string|null;
 readonly contexts:readonly OwnerKlingMotionControlResultContext[];readonly gaps:readonly string[];readonly backend_acceptance:"UNPROVEN"}
interface State {client:SyntxChatHttpClient;op:Op;chat:OwnerKlingMotionControlChatContext;request:OwnerKlingMotionControlPrivateRequest;phase:"AVAILABLE"|"OUTCOME_UNKNOWN"|"ACKNOWLEDGED";ack?:string;
 contexts:Map<string,OwnerKlingMotionControlResultContext>}
interface ResultState {client:SyntxChatHttpClient;state:State;context:OwnerKlingMotionControlResultContext}
export type OwnerKlingMotionControlNativeErrorCode="INVALID_REQUEST"|"CANDIDATE_INVALID"|"PRINCIPAL_NOT_LINKED"|"CHAT_CREATE_FAILED"|"CHAT_ALREADY_CREATED"|"CHAT_CONTEXT_INVALID"|
 "CHAT_DISPATCH_ALREADY_STARTED"|"CHAT_NOT_DISPATCHED"|"OUTCOME_UNKNOWN"|"HISTORY_UNAVAILABLE"|"RESULT_CONTEXT_INVALID"|"RESULT_GET_UNAVAILABLE"|"REQUEST_ABORTED"|"CAPACITY_EXCEEDED";
export class OwnerKlingMotionControlNativeError extends Error {constructor(readonly code:OwnerKlingMotionControlNativeErrorCode){super("The owner Kling Motion Control native operation could not be completed safely.");this.name="OwnerKlingMotionControlNativeError";}}

export async function createOwnerKlingMotionControlChat(input:unknown,packet:unknown,signal?:AbortSignal):Promise<OwnerKlingMotionControlChatContext>{
 const {client,callback}=consume(input,packet,"create"),create=callback as (title:string,signal?:AbortSignal)=>Promise<{chat_uuid:string}>;const op=readOp(input);let map=calls.get(client);
 if(!map){map=new Map();calls.set(client,map);}validSignal(signal);if(signal?.aborted)fail("REQUEST_ABORTED");if(reserved.has(op.candidate)||creating.has(op.candidate))fail("CHAT_ALREADY_CREATED");
 const pending=pendingCreates.get(client)??0;if(map.size+pending>=128)fail("CAPACITY_EXCEEDED");reserved.add(op.candidate);creating.add(op.candidate);pendingCreates.set(client,pending+1);
 try{const cap=await candidate(op);await revalidate(op);await current(op);const binding=readOwnerKlingMotionControlNativeBindingForClient(client,op.preparer.getNativeBindingForClient(client,op.candidate));
  if(!binding||binding.length!==2)fail("CANDIDATE_INVALID");const imageRef=readOwnerKlingMotionControlUploadReferenceForClient(client,binding[0]);
  const selected=op.candidate.reference_source==="owned_video"?readOwnerKlingMotionControlUploadReferenceForClient(client,binding[1]):readOwnerKlingMotionControlPresetVideoReferenceForClient(client,binding[1]);
  const videoUrl=selected&&"url"in selected?selected.url:selected&&"uri"in selected?selected.uri:null,req=cap.request.settings.file_urls;
  if(!imageRef||!isSafeUploadReferenceUrl(imageRef.url)||!selected||!videoUrl||!isSafeUploadReferenceUrl(videoUrl)||req[0]?.type!=="image"||req[1]?.type!=="video"||req[0].url!==imageRef.url||req[1].url!==videoUrl)fail("CANDIDATE_INVALID");
  if(op.candidate.reference_source==="service_preset"&&(!("sha256"in selected)||selected.sha256!==op.candidate.video.sha256||selected.duration_seconds!==op.candidate.video.duration_seconds||
    (selected.variant!=="audio"&&selected.variant!=="noaudio")))fail("CANDIDATE_INVALID");
  const receipt=await create(`owner-kling-motion-control-${randomUUID()}`,signal);if(signal?.aborted||!ID.test(receipt?.chat_uuid)||map.has(receipt.chat_uuid))fail("CHAT_CREATE_FAILED");
  const chat=Object.freeze({status:"created" as const,chat_uuid:receipt.chat_uuid,attempt_id:op.attemptId,model_id:"kling_motion_control" as const,profile_schema_hash:cap.binding.profile_schema_hash,
   request_fingerprint:cap.binding.request_fingerprint,intent_fingerprint:cap.binding.intent_fingerprint,expires_at:cap.binding.expires_at,dispatch_allowed:false as const,backend_acceptance:"UNPROVEN" as const});
  map.set(chat.chat_uuid,{client,op,chat,request:cap.request,phase:"AVAILABLE",contexts:new Map()});chats.set(chat,map.get(chat.chat_uuid)!);return chat;
 }catch(e){if(e instanceof OwnerKlingMotionControlNativeError)throw e;return fail("CHAT_CREATE_FAILED");}finally{creating.delete(op.candidate);const left=(pendingCreates.get(client)??1)-1;if(left>0)pendingCreates.set(client,left);else pendingCreates.delete(client);}}
export async function startOwnerKlingMotionControlWithOwnedCandidate(input:unknown,packet:unknown,signal?:AbortSignal):Promise<MediaGenerationReceipt>{
 const {client,callback}=consume(input,packet,"start"),start=callback as (chat:string,body:Record<string,unknown>,signal?:AbortSignal)=>Promise<MediaGenerationReceipt>;
 const f=readOp(input,true),s=chats.get(f.chat as object);if(!s||s.client!==client||s.chat!==f.chat||!sameOp(s.op,f))fail("CHAT_CONTEXT_INVALID");
 if(s.phase!=="AVAILABLE"||starting.has(s.chat))fail("CHAT_DISPATCH_ALREADY_STARTED");validSignal(signal);if(signal?.aborted)fail("REQUEST_ABORTED");starting.add(s.chat);let dispatched=false;
 try{await current(s.op);await candidate(s.op);await revalidate(s.op);const used=consumeOwnerKlingMotionControlOneShotPermit({permit:s.op.permit,preparer:s.op.preparer,candidate:s.op.candidate,principal:s.op.principal,attemptId:s.op.attemptId});
  if(used.request_fingerprint!==s.chat.request_fingerprint||schemaHash(used.request)!==schemaHash(s.request))fail("CANDIDATE_INVALID");const body={prompt:s.request.prompt,settings:{...s.request.settings,file_urls:s.request.settings.file_urls.map(x=>({type:x.type,url:x.url}))}};
  dispatched=true;s.phase="OUTCOME_UNKNOWN";const ack=await start(s.chat.chat_uuid,body,signal);if(ack.chat_uuid!==s.chat.chat_uuid||!ID.test(ack.message_id))fail("OUTCOME_UNKNOWN");s.ack=ack.message_id;s.phase="ACKNOWLEDGED";return ack;
 }catch(e){if(dispatched||s.phase!=="AVAILABLE")fail("OUTCOME_UNKNOWN");if(e instanceof OwnerKlingMotionControlNativeError)throw e;fail("CANDIDATE_INVALID");}finally{starting.delete(s.chat);}}
export async function listOwnedKlingMotionControlCandidates(input:unknown,packet:unknown,signal?:AbortSignal):Promise<OwnerKlingMotionControlResultCandidates>{
 const {client,callback}=consume(input,packet,"list"),get=callback as (chat:string,page:number,size:number,signal?:AbortSignal)=>Promise<unknown>;const f=readOp(input,true,false,true),s=chats.get(f.chat as object);
 if(!s||s.client!==client||s.chat!==f.chat||!sameOp(s.op,f))fail("CHAT_CONTEXT_INVALID");if(s.phase!=="ACKNOWLEDGED"&&s.phase!=="OUTCOME_UNKNOWN")fail("CHAT_NOT_DISPATCHED");validSignal(signal);if(signal?.aborted)fail("REQUEST_ABORTED");
 const pages:unknown[]=[];let n=0;try{await current(s.op);for(let p=1;p<=7;p++){n++;pages.push(await get(s.chat.chat_uuid,p,10,signal));await current(s.op);const total=pageNum(pages[p-1],"total_pages");if(total!==null&&p>=total)break;}}
 catch(e){if(signal?.aborted)fail("REQUEST_ABORTED");return empty(n);}const witness=bindOwnerKlingMotionControlHistory({pages,expected:{chat_uuid:s.chat.chat_uuid,owner_echo_message_id:s.ack??null,prompt:s.request.prompt}}),contexts:OwnerKlingMotionControlResultContext[]=[];
 if(witness.status==="COMPLETE"&&witness.gaps.length===0&&witness.owner_ack_status==="MATCHED"&&witness.history_binding_status==="BOUND"&&witness.history_page_status==="COMPLETE"&&witness.owner_echo_message_id&&witness.provider_chat_id){s.ack=witness.owner_echo_message_id;s.phase="ACKNOWLEDGED";
  for(const row of witness.candidate_messages){const next=Object.freeze({chat_uuid:s.chat.chat_uuid,message_id:row.message_id,model_id:"kling_motion_control" as const,provider_chat_id:witness.provider_chat_id,message_object_ids:Object.freeze([...row.message_object_ids]),
   attempt_id:s.chat.attempt_id,profile_schema_hash:s.chat.profile_schema_hash,intent_fingerprint:s.chat.intent_fingerprint,owner_echo_message_id:witness.owner_echo_message_id});const old=s.contexts.get(next.message_id);
   if(old&&!sameIdentity(old,next))return empty(n);if(old&&schemaHash(old)!==schemaHash(next)&&!orderedSuperset(old.message_object_ids,next.message_object_ids))return empty(n);const context=old&&schemaHash(old)===schemaHash(next)?old:next;
   if(old&&old!==context)results.delete(old);if(old!==context){s.contexts.set(context.message_id,context);results.set(context,{client,state:s,context});}contexts.push(context);}}
 return Object.freeze({...witness,history_get_calls:n,total_count:pageNum(pages[0],"total_count"),total_pages:pageNum(pages[0],"total_pages"),contexts:Object.freeze(contexts),backend_acceptance:"UNPROVEN" as const});}
export async function getOwnedKlingMotionControlResult(input:unknown,packet:unknown,signal?:AbortSignal):Promise<OwnerKlingMotionControlVideoResult>{
 const {client,callback}=consume(input,packet,"get"),get=callback as (chat:string,message:string,signal?:AbortSignal)=>Promise<unknown>;const f=readOp(input,false,true,true),r=f.context&&results.get(f.context as object);
 if(!r||r.client!==client||r.context!==f.context||r.state.phase!=="ACKNOWLEDGED"||r.state.ack!==r.context.owner_echo_message_id||!sameOp(r.state.op,f))fail("RESULT_CONTEXT_INVALID");validSignal(signal);if(signal?.aborted)fail("REQUEST_ABORTED");
 try{await current(r.state.op);const raw=await get(r.context.chat_uuid,r.context.message_id,signal);await current(r.state.op);return decodeOwnerKlingMotionControlVideoResult(raw,{chat_uuid:r.context.chat_uuid,message_id:r.context.message_id,model_id:r.context.model_id,provider_chat_id:r.context.provider_chat_id,message_object_ids:r.context.message_object_ids});}
 catch(e){if(signal?.aborted)fail("REQUEST_ABORTED");if(e instanceof OwnerKlingMotionControlNativeError)throw e;fail("RESULT_GET_UNAVAILABLE");}}

function readOp(v:unknown,withChat=false,withContext=false,retained=false):Op&{chat?:OwnerKlingMotionControlChatContext;context?:OwnerKlingMotionControlResultContext}{const x=exact(v,["preparer","candidate","permit","principal","attemptId","linkService","binding",...(withChat?["chat"]:[]),...(withContext?["context"]:[])]);
 if(!isOwnerKlingMotionControlRequestPreparer(x.preparer)||(!isOwnerKlingMotionControlPreparedCandidate(x.candidate)&&!(retained&&isRetainedCandidate(x.candidate)))||!x.permit||typeof x.permit!=="object"||types.isProxy(x.permit)||typeof x.attemptId!=="string"||!ATTEMPT.test(x.attemptId))fail("INVALID_REQUEST");
 let principal:Readonly<GenerationPrincipalRef>;try{principal=snapshotGenerationPrincipal(x.principal as GenerationPrincipalRef);}catch{fail("INVALID_REQUEST");}if(principal.connection_id!==x.attemptId)fail("PRINCIPAL_NOT_LINKED");const b=exact(x.binding,["tenant_id","subject"]);
 if(typeof b.tenant_id!=="string"||!b.tenant_id.trim()||typeof b.subject!=="string"||!b.subject.trim())fail("INVALID_REQUEST");return Object.freeze({preparer:x.preparer as OwnerKlingMotionControlRequestPreparer,candidate:x.candidate as OwnerKlingMotionControlPreparedCandidate,
  permit:x.permit as OwnerKlingMotionControlOneShotPermit,principal,attemptId:x.attemptId,linkService:x.linkService as PerUserLinkService,binding:Object.freeze({tenant_id:b.tenant_id,subject:b.subject}),...(withChat?{chat:x.chat as OwnerKlingMotionControlChatContext}:{}),...(withContext?{context:x.context as OwnerKlingMotionControlResultContext}:{})});}
async function candidate(op:Op){await current(op);try{await op.preparer.revalidateCandidate(op.candidate);}catch{fail("CANDIDATE_INVALID");}const b=op.preparer.inspectCandidate(op.candidate),r=op.preparer.getPrivateRequest(op.candidate);
 if(!b||b.attempt_id!==op.attemptId||!sameGenerationPrincipal(b.principal,op.principal)||schemaHash(r)!==b.request_fingerprint||op.candidate.model_id!=="kling_motion_control"||op.candidate.request_fingerprint!==b.request_fingerprint)fail("CANDIDATE_INVALID");return{binding:b,request:r};}
async function revalidate(op:Op){try{await revalidateOwnerKlingMotionControlOneShotPermit({permit:op.permit,preparer:op.preparer,candidate:op.candidate,principal:op.principal,attemptId:op.attemptId});}catch{fail("CANDIDATE_INVALID");}}
async function current(op:Op){if(!op.linkService||types.isProxy(op.linkService)||Object.getPrototypeOf(op.linkService)!==PerUserLinkService.prototype||Reflect.get(op.linkService,"getStatus")!==LINK_GET)fail("PRINCIPAL_NOT_LINKED");try{const p=await resolveOwnerReferencePrincipal({binding:op.binding,attemptId:op.attemptId,linkService:op.linkService});if(!sameGenerationPrincipal(p,op.principal))fail("PRINCIPAL_NOT_LINKED");}catch{fail("PRINCIPAL_NOT_LINKED");}}
function sameOp(a:Op,b:Op){return a.preparer===b.preparer&&a.candidate===b.candidate&&a.permit===b.permit&&a.attemptId===b.attemptId&&a.linkService===b.linkService&&sameGenerationPrincipal(a.principal,b.principal)&&a.binding.tenant_id===b.binding.tenant_id&&a.binding.subject===b.binding.subject;}
function isRetainedCandidate(v:unknown):v is OwnerKlingMotionControlPreparedCandidate {try{return !!v&&typeof v==="object"&&!types.isProxy(v)&&Object.isFrozen(v)&&Reflect.get(v,"model_id")==="kling_motion_control"&&Reflect.get(v,"status")==="prepared"&&typeof Reflect.get(v,"request_fingerprint")==="string";}catch{return false;}}
function sameIdentity(a:OwnerKlingMotionControlResultContext,b:OwnerKlingMotionControlResultContext){return a.chat_uuid===b.chat_uuid&&a.message_id===b.message_id&&a.provider_chat_id===b.provider_chat_id&&a.attempt_id===b.attempt_id&&a.profile_schema_hash===b.profile_schema_hash&&a.intent_fingerprint===b.intent_fingerprint&&a.owner_echo_message_id===b.owner_echo_message_id;}
function orderedSuperset(a:readonly string[],b:readonly string[]){if(b.length<=a.length)return false;let i=0;for(const x of b)if(x===a[i])i++;return i===a.length;}
function pageNum(v:unknown,k:"total_count"|"total_pages"):number|null{if(!v||typeof v!=="object"||types.isProxy(v))return null;const p=Object.getOwnPropertyDescriptor(v,"pagination")?.value;const n=p&&Object.getOwnPropertyDescriptor(p,k)?.value;return Number.isSafeInteger(n)&&n>=0&&n<=(k==="total_count"?64:7)?n:null;}
function empty(n:number):OwnerKlingMotionControlResultCandidates{return Object.freeze({status:"UNVERIFIED",owner_ack_status:"MISSING",history_binding_status:"UNVERIFIED",history_page_status:"INCOMPLETE",history_get_calls:n,total_count:null,total_pages:null,provider_chat_id:null,owner_echo_message_id:null,contexts:Object.freeze([]),gaps:Object.freeze(["HISTORY_UNAVAILABLE"]),backend_acceptance:"UNPROVEN"});}
function validSignal(s?:AbortSignal){if(s!==undefined&&(!(s instanceof AbortSignal)||types.isProxy(s)))fail("INVALID_REQUEST");}
function exact(v:unknown,keys:readonly string[]):Record<string,any>{if(!v||typeof v!=="object"||Array.isArray(v)||types.isProxy(v))fail("INVALID_REQUEST");try{const d=Object.getOwnPropertyDescriptors(v),own=Reflect.ownKeys(d);if((Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)||own.length!==keys.length||own.some(k=>typeof k!=="string"||!keys.includes(k)||!d[k]!.enumerable||!("value"in d[k]!)))fail("INVALID_REQUEST");const o=Object.create(null);for(const k of keys)o[k]=d[k]!.value;return o;}catch{fail("INVALID_REQUEST");}}
function consume(i:unknown,p:unknown,m:"create"|"start"|"list"|"get"){try{return consumeOwnerKlingMotionControlNativeInvocation(i,p,m);}catch{fail("INVALID_REQUEST");}}
function fail(c:OwnerKlingMotionControlNativeErrorCode):never{throw new OwnerKlingMotionControlNativeError(c);}
