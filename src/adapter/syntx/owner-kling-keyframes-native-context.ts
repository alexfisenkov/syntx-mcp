import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../../auth/types.js";
import { PerUserLinkService } from "../../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../../domain/generation-principal.js";
import { schemaHash } from "../../domain/generation-contract.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";
import { SyntxChatHttpClient, type MediaGenerationReceipt, readOwnerKlingKeyframesUploadReferenceForClient } from "./chat-http-client.js";
import { isOwnerKlingKeyframesRequestPreparer, isOwnerKlingKeyframesPreparedCandidate, type OwnerKlingKeyframesRequestPreparer,
  type OwnerKlingKeyframesPreparedCandidate, type OwnerKlingKeyframesPrivateRequest } from "../../application/owner-kling-keyframes-request-preparer.js";
import { consumeOwnerKlingKeyframesOneShotPermit, revalidateOwnerKlingKeyframesOneShotPermit,
  type OwnerKlingKeyframesOneShotPermit } from "../../application/owner-kling-keyframes-one-shot-policy.js";
import { readOwnerKlingKeyframesNativeBindingForClient } from "../../application/owner-kling-keyframes-request-preparer.js";
import type { OwnerKlingKeyframesUploadContext } from "./kling-keyframes-upload-context.js";
import { bindOwnerKlingKeyframesHistory } from "./owner-kling-keyframes-history.js";
import { decodeOwnerKlingKeyframesVideoResult, type OwnerKlingKeyframesVideoResult } from "./owner-kling-keyframes-video-result.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u, ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const LINK_GET = PerUserLinkService.prototype.getStatus;
const READ = readOwnerKlingKeyframesUploadReferenceForClient;
const calls = new WeakMap<object, Map<string, State>>(), chats = new WeakMap<object, State>(), results = new WeakMap<object, ResultState>();
const pendingCreates = new WeakMap<object, number>();
const reserved = new WeakSet<object>(), creating = new WeakSet<object>(), starting = new WeakSet<object>();
type Op = Readonly<{preparer: OwnerKlingKeyframesRequestPreparer; candidate: OwnerKlingKeyframesPreparedCandidate; permit: OwnerKlingKeyframesOneShotPermit;
  principal: Readonly<GenerationPrincipalRef>; attemptId: string; linkService: PerUserLinkService; binding: Readonly<AuthBinding>}>;
export interface OwnerKlingKeyframesNativeOperationInput { readonly preparer: OwnerKlingKeyframesRequestPreparer; readonly candidate: OwnerKlingKeyframesPreparedCandidate;
  readonly permit: OwnerKlingKeyframesOneShotPermit; readonly principal: GenerationPrincipalRef; readonly attemptId: string;
  readonly linkService: PerUserLinkService; readonly binding: AuthBinding; readonly chat?: OwnerKlingKeyframesChatContext; readonly context?: OwnerKlingKeyframesResultContext }
export interface OwnerKlingKeyframesChatContext { readonly status:"created"; readonly chat_uuid:string; readonly attempt_id:string; readonly model_id:"kling_keyframes";
  readonly profile_schema_hash:string; readonly request_fingerprint:string; readonly intent_fingerprint:string; readonly expires_at:number;
  readonly dispatch_allowed:false; readonly backend_acceptance:"UNPROVEN" }
export interface OwnerKlingKeyframesResultContext { readonly chat_uuid:string; readonly message_id:string; readonly model_id:"kling_keyframes";
  readonly provider_chat_id:string; readonly message_object_ids:readonly string[]; readonly attempt_id:string; readonly profile_schema_hash:string;
  readonly intent_fingerprint:string; readonly owner_echo_message_id:string }
export interface OwnerKlingKeyframesResultCandidates { readonly status:"PENDING"|"COMPLETE"|"INCOMPLETE"|"UNVERIFIED";
  readonly owner_ack_status:"MATCHED"|"MISSING"|"AMBIGUOUS"|"MISMATCH"; readonly history_binding_status:"BOUND"|"PARTIAL"|"UNVERIFIED";
  readonly history_page_status:"COMPLETE"|"INCOMPLETE"|"UNPROVEN"; readonly history_get_calls:number; readonly total_count:number|null;
  readonly total_pages:number|null; readonly provider_chat_id:string|null; readonly owner_echo_message_id:string|null;
  readonly contexts:readonly OwnerKlingKeyframesResultContext[]; readonly gaps:readonly string[]; readonly backend_acceptance:"UNPROVEN" }
interface State { client:SyntxChatHttpClient; op:Op; chat:OwnerKlingKeyframesChatContext; request:OwnerKlingKeyframesPrivateRequest;
  phase:"AVAILABLE"|"OUTCOME_UNKNOWN"|"ACKNOWLEDGED"; ack?:string; contexts:Map<string,OwnerKlingKeyframesResultContext> }
interface ResultState { client:SyntxChatHttpClient; state:State; context:OwnerKlingKeyframesResultContext }
export type OwnerKlingKeyframesNativeErrorCode = "INVALID_REQUEST"|"CANDIDATE_INVALID"|"PRINCIPAL_NOT_LINKED"|"CHAT_CREATE_FAILED"|"CHAT_ALREADY_CREATED"|
  "CHAT_CONTEXT_INVALID"|"CHAT_DISPATCH_ALREADY_STARTED"|"CHAT_NOT_DISPATCHED"|"OUTCOME_UNKNOWN"|"HISTORY_UNAVAILABLE"|"RESULT_CONTEXT_INVALID"|
  "RESULT_GET_UNAVAILABLE"|"REQUEST_ABORTED"|"CAPACITY_EXCEEDED";
export class OwnerKlingKeyframesNativeError extends Error { constructor(readonly code:OwnerKlingKeyframesNativeErrorCode){super("The owner Kling Keyframes native operation could not be completed safely.");this.name="OwnerKlingKeyframesNativeError";} }

export async function createOwnerKlingKeyframesChat(input:unknown, packet:unknown, signal?:AbortSignal):Promise<OwnerKlingKeyframesChatContext>{
  const {client, callback}=await consume(input,packet,"create"), create=callback as (title:string,signal?:AbortSignal)=>Promise<{chat_uuid:string}>;
  const op=readOp(input); let map=calls.get(client);
  if(!map){map=new Map<string,State>();calls.set(client,map);}
  validSignal(signal); if(signal?.aborted) fail("REQUEST_ABORTED");
  if(reserved.has(op.candidate)||creating.has(op.candidate)) fail("CHAT_ALREADY_CREATED");
  const pending=pendingCreates.get(client)??0;
  if(map.size+pending>=128) fail("CAPACITY_EXCEEDED");
  reserved.add(op.candidate); creating.add(op.candidate); pendingCreates.set(client,pending+1);
  try {
    await current(op); await candidate(op); await revalidate(op);
    const verified=await candidate(op);
    const nativeBinding=op.preparer.getNativeBindingForClient(client,op.candidate);
    const contexts=readOwnerKlingKeyframesNativeBindingForClient(client,nativeBinding);
    if(!contexts) fail("CANDIDATE_INVALID");
    verifyRefs(client,contexts,verified.request,verified.binding.images);
    const cap={request:verified.request,binding:verified.binding};
    await current(op); await candidate(op); await revalidate(op);
    const receipt=await create(`owner-kling-keyframes-${randomUUID()}`,signal);
    if(signal?.aborted||!ID.test(receipt?.chat_uuid)||map.has(receipt.chat_uuid)) fail("CHAT_CREATE_FAILED");
    const context=Object.freeze({status:"created" as const,chat_uuid:receipt.chat_uuid,attempt_id:op.attemptId,model_id:"kling_keyframes" as const,
      profile_schema_hash:cap.binding.profile_schema_hash,request_fingerprint:cap.binding.request_fingerprint,
      intent_fingerprint:cap.binding.intent_fingerprint,expires_at:cap.binding.expires_at,dispatch_allowed:false as const,backend_acceptance:"UNPROVEN" as const});
    const state:State={client,op,chat:context,request:cap.request,phase:"AVAILABLE",contexts:new Map()}; map.set(context.chat_uuid,state); chats.set(context,state); return context;
  } catch(e){ if(e instanceof OwnerKlingKeyframesNativeError) throw e; throw new OwnerKlingKeyframesNativeError("CHAT_CREATE_FAILED"); }
  finally {creating.delete(op.candidate);const remaining=(pendingCreates.get(client)??1)-1;if(remaining>0)pendingCreates.set(client,remaining);else pendingCreates.delete(client);}
}
export async function startOwnerKlingKeyframesWithOwnedCandidate(input:unknown,packet:unknown,signal?:AbortSignal):Promise<MediaGenerationReceipt>{
  const {client,callback}=await consume(input,packet,"start"), start=callback as (chat:string,body:Record<string,unknown>,signal?:AbortSignal)=>Promise<MediaGenerationReceipt>;
  const fields=readOp(input,true), state=chats.get(fields.chat as object);
  if(!state||state.client!==client||state.chat!==fields.chat||!sameOp(state.op,fields)||calls.get(client)?.get(state.chat.chat_uuid)!==state) fail("CHAT_CONTEXT_INVALID");
  if(state.phase!=="AVAILABLE"||starting.has(state.chat)) fail("CHAT_DISPATCH_ALREADY_STARTED"); validSignal(signal); if(signal?.aborted) fail("REQUEST_ABORTED");
  starting.add(state.chat); let dispatched=false;
  try {
    await current(state.op); await candidate(state.op); await revalidate(state.op); await current(state.op);
    const consumed=consumeOwnerKlingKeyframesOneShotPermit({preparer:state.op.preparer,candidate:state.op.candidate,permit:state.op.permit,
      principal:state.op.principal,attemptId:state.op.attemptId});
    if(consumed.request_fingerprint!==state.chat.request_fingerprint||schemaHash(consumed.request)!==schemaHash(state.request)) fail("CANDIDATE_INVALID");
    const body={prompt:state.request.prompt,settings:{...state.request.settings,file_urls:state.request.settings.file_urls.map((file)=>({type:"image",url:file.url}))}};
    dispatched=true; state.phase="OUTCOME_UNKNOWN";
    const ack=await start(state.chat.chat_uuid,body,signal);
    if(ack.chat_uuid!==state.chat.chat_uuid||!ID.test(ack.message_id)) fail("OUTCOME_UNKNOWN");
    state.ack=ack.message_id; state.phase="ACKNOWLEDGED"; return ack;
  } catch(e){ if(dispatched||state.phase!=="AVAILABLE") fail("OUTCOME_UNKNOWN"); if(e instanceof OwnerKlingKeyframesNativeError) throw e; fail("CANDIDATE_INVALID"); }
  finally {starting.delete(state.chat);}
}
export async function listOwnedKlingKeyframesCandidates(input:unknown,packet:unknown,signal?:AbortSignal):Promise<OwnerKlingKeyframesResultCandidates>{
  const {client,callback}=await consume(input,packet,"list"), getPage=callback as (chat:string,page:number,size:number,signal?:AbortSignal)=>Promise<unknown>;
  const fields=readOp(input,true), state=chats.get(fields.chat as object); if(!state||state.client!==client||state.chat!==fields.chat||!sameOp(state.op,fields)) fail("CHAT_CONTEXT_INVALID");
  if(state.phase!=="ACKNOWLEDGED"&&state.phase!=="OUTCOME_UNKNOWN") fail("CHAT_NOT_DISPATCHED"); validSignal(signal); if(signal?.aborted) fail("REQUEST_ABORTED");
  const pages:unknown[]=[]; let calls=0;
  try { for(let p=1;p<=7;p++){await current(state.op);calls++;const page=await getPage(state.chat.chat_uuid,p,10,signal); await current(state.op); pages.push(page);
    const totalPages=readPageNumber(page,"total_pages"); if(totalPages!==null&&p>=totalPages)break; } }
  catch(e){if(signal?.aborted)fail("REQUEST_ABORTED");return emptyHistory(calls);}
  const witness=bindOwnerKlingKeyframesHistory({pages,expected:{chat_uuid:state.chat.chat_uuid,owner_echo_message_id:state.ack??null,prompt:state.request.prompt}});
  const contexts:OwnerKlingKeyframesResultContext[]=[];
  const replacements:Array<Readonly<{previous:OwnerKlingKeyframesResultContext|null;next:OwnerKlingKeyframesResultContext}>>=[];
  if(witness.owner_ack_status==="MATCHED"&&witness.history_binding_status==="BOUND"&&witness.history_page_status==="COMPLETE"&&witness.owner_echo_message_id&&witness.provider_chat_id){
    state.ack=witness.owner_echo_message_id; state.phase="ACKNOWLEDGED";
    for(const row of witness.candidate_messages){const context=Object.freeze({chat_uuid:state.chat.chat_uuid,message_id:row.message_id,model_id:"kling_keyframes" as const,
      provider_chat_id:witness.provider_chat_id,message_object_ids:Object.freeze([...row.message_object_ids]),attempt_id:state.chat.attempt_id,
      profile_schema_hash:state.chat.profile_schema_hash,intent_fingerprint:state.chat.intent_fingerprint,owner_echo_message_id:witness.owner_echo_message_id});
      const previous=state.contexts.get(context.message_id)??null;
      if(previous&&!sameResultIdentity(previous,context))return emptyHistory(calls);
      if(previous&&schemaHash(previous)!==schemaHash(context)&&!isOrderedIdSuperset(previous.message_object_ids,context.message_object_ids))return emptyHistory(calls);
      const next=previous&&schemaHash(previous)===schemaHash(context)?previous:context;
      replacements.push({previous,next});contexts.push(next);}
    for(const {previous,next} of replacements){if(previous&&previous!==next)results.delete(previous);if(previous!==next){results.set(next,{client,state,context:next});state.contexts.set(next.message_id,next);}}
  }
  return Object.freeze({...witness,history_get_calls:calls,total_count:readPageNumber(pages[0],"total_count"),
    total_pages:readPageNumber(pages[0],"total_pages"),contexts:Object.freeze(contexts),backend_acceptance:"UNPROVEN" as const});
}
export async function getOwnedKlingKeyframesResult(input:unknown,packet:unknown,signal?:AbortSignal):Promise<OwnerKlingKeyframesVideoResult>{
  const {client,callback}=await consume(input,packet,"get"), get=callback as (chat:string,message:string,signal?:AbortSignal)=>Promise<unknown>;
  const fields=readOp(input,false,true), owned=fields.context&&results.get(fields.context as object);
  if(!owned||owned.client!==client||owned.context!==fields.context||owned.state.client!==client||owned.state.phase!=="ACKNOWLEDGED"||
    owned.state.ack!==owned.context.owner_echo_message_id||!sameOp(owned.state.op,fields)) fail("RESULT_CONTEXT_INVALID");
  validSignal(signal);if(signal?.aborted)fail("REQUEST_ABORTED");await current(owned.state.op);
  try { const raw=await get(owned.context.chat_uuid,owned.context.message_id,signal);await current(owned.state.op);
    return decodeOwnerKlingKeyframesVideoResult(raw,{chat_uuid:owned.context.chat_uuid,message_id:owned.context.message_id,
      provider_chat_id:owned.context.provider_chat_id,message_object_ids:owned.context.message_object_ids}); }
  catch(e){if(signal?.aborted)fail("REQUEST_ABORTED");if(e instanceof OwnerKlingKeyframesNativeError)throw e;fail("RESULT_GET_UNAVAILABLE");}
}

function readOp(value:unknown,withChat=false,withContext=false):Op&{chat?:OwnerKlingKeyframesChatContext;context?:OwnerKlingKeyframesResultContext}{
 const names=["preparer","candidate","permit","principal","attemptId","linkService","binding",...(withChat?["chat"]:[]),...(withContext?["context"]:[])]; const f=exact(value,names);
 if(!isOwnerKlingKeyframesRequestPreparer(f.preparer)||!isOwnerKlingKeyframesPreparedCandidate(f.candidate)||!f.permit||typeof f.permit!=="object"||types.isProxy(f.permit)||
   typeof f.attemptId!=="string"||!ATTEMPT.test(f.attemptId))fail("INVALID_REQUEST");
 let principal:Readonly<GenerationPrincipalRef>;try{principal=snapshotGenerationPrincipal(f.principal as GenerationPrincipalRef);}catch{fail("INVALID_REQUEST");}
 if(principal.connection_id!==f.attemptId)fail("PRINCIPAL_NOT_LINKED");const b=exact(f.binding,["tenant_id","subject"]);
 if(typeof b.tenant_id!=="string"||!b.tenant_id.trim()||typeof b.subject!=="string"||!b.subject.trim())fail("INVALID_REQUEST");
 return Object.freeze({preparer:f.preparer as OwnerKlingKeyframesRequestPreparer,candidate:f.candidate as OwnerKlingKeyframesPreparedCandidate,
 permit:f.permit as OwnerKlingKeyframesOneShotPermit,principal,attemptId:f.attemptId,linkService:f.linkService as PerUserLinkService,
 binding:Object.freeze({tenant_id:b.tenant_id,subject:b.subject}),...(withChat?{chat:f.chat as OwnerKlingKeyframesChatContext}:{}),...(withContext?{context:f.context as OwnerKlingKeyframesResultContext}:{})});
}
async function candidate(op:Op){await current(op);try{await op.preparer.revalidateCandidate(op.candidate);}catch{fail("CANDIDATE_INVALID");}
 const b=op.preparer.inspectCandidate(op.candidate),r=op.preparer.getPrivateRequest(op.candidate);if(!b||b.attempt_id!==op.attemptId||!sameGenerationPrincipal(b.principal,op.principal)||schemaHash(r)!==b.request_fingerprint||
  op.candidate.model_id!=="kling_keyframes"||op.candidate.request_fingerprint!==b.request_fingerprint)fail("CANDIDATE_INVALID");await current(op);return {binding:b,request:r};}
async function revalidate(op:Op){try{await revalidateOwnerKlingKeyframesOneShotPermit({permit:op.permit,preparer:op.preparer,candidate:op.candidate,principal:op.principal,attemptId:op.attemptId});}
 catch{fail("CANDIDATE_INVALID");}}
function verifyRefs(client:SyntxChatHttpClient,contexts:readonly OwnerKlingKeyframesUploadContext[],request:OwnerKlingKeyframesPrivateRequest,
 images:readonly Readonly<{mime_type:string;size:number;sha256:string;width:number;height:number}>[]){
 if(contexts.length!==2||request.settings.file_urls.length!==2)fail("CANDIDATE_INVALID");
 contexts.forEach((c,i)=>{const r=READ(client,c),f=request.settings.file_urls[i],image=images[i];if(!r||!image||!isSafeUploadReferenceUrl(r.url)||f?.type!=="image"||f.url!==r.url||
  c.mime_type!==image.mime_type||c.size!==image.size||c.sha256!==image.sha256||c.width!==image.width||c.height!==image.height)fail("CANDIDATE_INVALID");});}
async function current(op:Op){if(!op.linkService||types.isProxy(op.linkService)||Object.getPrototypeOf(op.linkService)!==PerUserLinkService.prototype||
 Reflect.get(op.linkService,"getStatus")!==LINK_GET)fail("PRINCIPAL_NOT_LINKED");try{const p=await resolveOwnerReferencePrincipal({binding:op.binding,attemptId:op.attemptId,linkService:op.linkService});
 if(!sameGenerationPrincipal(p,op.principal))fail("PRINCIPAL_NOT_LINKED");}catch(e){if(e instanceof OwnerKlingKeyframesNativeError)throw e;if(e instanceof OwnerReferencePrincipalError)fail("PRINCIPAL_NOT_LINKED");fail("PRINCIPAL_NOT_LINKED");}}
function sameOp(a:Op,b:Op){return a.preparer===b.preparer&&a.candidate===b.candidate&&a.permit===b.permit&&a.attemptId===b.attemptId&&a.linkService===b.linkService&&sameGenerationPrincipal(a.principal,b.principal)&&a.binding.tenant_id===b.binding.tenant_id&&a.binding.subject===b.binding.subject;}
function sameResultIdentity(a:OwnerKlingKeyframesResultContext,b:OwnerKlingKeyframesResultContext):boolean{return a.chat_uuid===b.chat_uuid&&a.message_id===b.message_id&&a.model_id===b.model_id&&a.provider_chat_id===b.provider_chat_id&&a.attempt_id===b.attempt_id&&a.profile_schema_hash===b.profile_schema_hash&&a.intent_fingerprint===b.intent_fingerprint&&a.owner_echo_message_id===b.owner_echo_message_id;}
function isOrderedIdSuperset(previous:readonly string[],next:readonly string[]):boolean{if(next.length<=previous.length)return false;let index=0;for(const id of next)if(id===previous[index])index++;return index===previous.length;}
function validSignal(s?:AbortSignal){if(s!==undefined&&(!(s instanceof AbortSignal)||types.isProxy(s)))fail("INVALID_REQUEST");}
function emptyHistory(calls:number):OwnerKlingKeyframesResultCandidates{return Object.freeze({status:"UNVERIFIED",owner_ack_status:"MISSING",history_binding_status:"UNVERIFIED",history_page_status:"INCOMPLETE",history_get_calls:calls,total_count:null,total_pages:null,provider_chat_id:null,owner_echo_message_id:null,contexts:Object.freeze([]),gaps:Object.freeze(["HISTORY_UNAVAILABLE"]),backend_acceptance:"UNPROVEN"});}
function readPageNumber(value:unknown,key:"total_count"|"total_pages"):number|null{try{if(!value||typeof value!=="object"||types.isProxy(value)||Array.isArray(value))return null;
 const d=Object.getOwnPropertyDescriptor(value,"pagination");if(!d||!("value"in d)||!d.enumerable||!d.value||typeof d.value!=="object"||types.isProxy(d.value))return null;
 const n=Object.getOwnPropertyDescriptor(d.value,key);return n&&"value"in n&&Number.isSafeInteger(n.value)&&n.value>=0&&n.value<=(key==="total_count"?64:7)?n.value:null;}catch{return null;}}
function exact(value:unknown,keys:readonly string[]):Record<string,any>{if(!value||typeof value!=="object"||Array.isArray(value)||types.isProxy(value))fail("INVALID_REQUEST");try{const p=Object.getPrototypeOf(value),d=Object.getOwnPropertyDescriptors(value),own=Reflect.ownKeys(d);if((p!==Object.prototype&&p!==null)||own.length!==keys.length||own.some(k=>typeof k!=="string"||!keys.includes(k)||!d[k]!.enumerable||!("value"in d[k]!)))fail("INVALID_REQUEST");const out=Object.create(null) as Record<string,any>;for(const k of keys)out[k]=d[k]!.value;return out;}catch{fail("INVALID_REQUEST");}}
async function consume(input:unknown,packet:unknown,method:"create"|"start"|"list"|"get"){try{return (await import("./chat-http-client.js")).consumeOwnerKlingKeyframesNativeInvocation(input,packet,method);}catch{fail("INVALID_REQUEST");}}
function fail(code:OwnerKlingKeyframesNativeErrorCode):never{throw new OwnerKlingKeyframesNativeError(code);}
