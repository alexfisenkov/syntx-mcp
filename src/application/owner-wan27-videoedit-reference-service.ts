import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { isSafeUploadReferenceUrl, type InternalUploadReference } from "../adapter/syntx/upload-reference-bridge.js";
import {
  isValidatedOwnerWan27VideoEditImage, readValidatedOwnerWan27VideoEditImage, releaseValidatedOwnerWan27VideoEditImage,
  validateOwnerWan27VideoEditImage, type OwnerWan27VideoEditImageCanonicalMimeType,
  type ValidatedOwnerWan27VideoEditImage
} from "./owner-wan27-videoedit-image-policy.js";
import {
  isValidatedOwnerWan27VideoEditVideo, readValidatedOwnerWan27VideoEditVideo, releaseValidatedOwnerWan27VideoEditVideo,
  validateOwnerWan27VideoEditVideo, type OwnerWan27VideoEditVideoMimeType, type ValidatedOwnerWan27VideoEditVideo
} from "./owner-wan27-videoedit-video-policy.js";
import { getOwnerWan27VideoEditSourceProfile } from "./owner-wan27-videoedit-parameters.js";

type OwnerWan27VideoEditModelId = "wan_27_videoedit";
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^wan27_videoedit_reference_[0-9a-f-]{36}$/u;
const TTL = 15 * 60_000;
const MAX_RECORDS = 128;
const MAX_PENDING = 4;
const MAX_FILE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const NATIVE_UPLOAD = Reflect.get(SyntxChatHttpClient.prototype, "uploadOwnerWan27VideoEditReference") as unknown;
const NATIVE_LINK_STATUS = PerUserLinkService.prototype.getStatus;
const TA = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TA_LENGTH = Object.getOwnPropertyDescriptor(TA, "byteLength")?.get;
const TA_BUFFER = Object.getOwnPropertyDescriptor(TA, "buffer")?.get;
const TA_OFFSET = Object.getOwnPropertyDescriptor(TA, "byteOffset")?.get;
const ARRAY_BUFFER_LENGTH = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;
const OWNED = new WeakMap<object, Readonly<{service:OwnerWan27VideoEditReferenceService;records:readonly ReferenceRecord[];attemptId:string;
  modelId:OwnerWan27VideoEditModelId;principal:Readonly<GenerationPrincipalRef>;client:SyntxChatHttpClient;epoch:number;expiresAt:number}>>();
const SERVICES = new WeakSet<object>();

export interface OwnerWan27VideoEditReferenceServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveClient: (attemptId:string)=>unknown;
  readonly ffprobePath:string;
  readonly maxVideoFileBytes?:number;
  readonly now?:()=>number;
}
export interface OwnerWan27VideoEditReferenceUploadInput {
  readonly attemptId:string; readonly model_id:OwnerWan27VideoEditModelId; readonly filename:string; readonly mime_type:string; readonly bytes:Uint8Array;
}
export interface OwnerWan27VideoEditReferenceUploadReceipt {
  readonly status:"uploaded"; readonly reference_handle:string; readonly model_id:OwnerWan27VideoEditModelId;
  readonly kind:"image"|"video"; readonly mime_type:OwnerWan27VideoEditImageCanonicalMimeType|OwnerWan27VideoEditVideoMimeType;
  readonly size:number; readonly sha256:string; readonly width:number; readonly height:number;
  readonly duration_seconds:number|null; readonly input_cost_duration_seconds:number|null; readonly expires_in_seconds:number;
  readonly input_confidence:"LOCAL_METADATA_ONLY_NO_DECODE";
}
export interface OwnerWan27VideoEditOwnedReferences {
  readonly attempt_id:string; readonly model_id:OwnerWan27VideoEditModelId; readonly principal:Readonly<GenerationPrincipalRef>;
  readonly profile_sha256:string; readonly expires_at:number; readonly epoch:number;
  readonly references:readonly Readonly<{reference_handle:string;kind:"image"|"video";mime_type:string;size:number;sha256:string;
    width:number;height:number;duration_seconds:number|null;input_cost_duration_seconds:number|null}>[];
  readonly generation_permit:false;
}
export type OwnerWan27VideoEditReferenceServiceErrorCode = "INVALID_REQUEST"|"PRINCIPAL_NOT_LINKED"|"REQUEST_ABORTED"|"SERVICE_BUSY"|
  "CAPACITY_EXCEEDED"|"SERVICE_CLOSED"|"VALIDATION_REJECTED"|"UPLOAD_OUTCOME_UNKNOWN"|"REFERENCE_UNAVAILABLE"|"REFERENCE_EXPIRED";
export class OwnerWan27VideoEditReferenceServiceError extends Error {
  constructor(readonly code:OwnerWan27VideoEditReferenceServiceErrorCode){super("The owner WAN 2.7 Video Edit reference is unavailable.");this.name="OwnerWan27VideoEditReferenceServiceError";}
}
interface ReferenceRecord {
  readonly handle:string;readonly attemptId:string;readonly modelId:OwnerWan27VideoEditModelId;readonly profileHash:string;
  readonly principal:Readonly<GenerationPrincipalRef>;readonly kind:"image"|"video";readonly mimeType:string;readonly size:number;
  readonly sha256:string;readonly width:number;readonly height:number;readonly durationSeconds:number|null;
  readonly inputCostDurationSeconds:number|null;readonly expiresAt:number;readonly epoch:number;readonly client:SyntxChatHttpClient;
  readonly url:string;readonly fileId?:string;
}
interface Pending {readonly controller:AbortController;readonly done:Promise<void>;readonly finish:()=>void;readonly removeAbort:()=>void;readonly epoch:number;}
interface UploadSnapshot {readonly attemptId:string;readonly modelId:OwnerWan27VideoEditModelId;readonly filename:string;readonly mimeType:string;readonly bytes:Buffer;}
interface ResolveSnapshot {readonly attemptId:string;readonly modelId:OwnerWan27VideoEditModelId;readonly handles:readonly string[];}
type Validated=Readonly<ValidatedOwnerWan27VideoEditImage>|Readonly<ValidatedOwnerWan27VideoEditVideo>;

/** Process-local WAN27 Video Edit URL vault. Opaque handles provide reference access, never generation authority. */
export class OwnerWan27VideoEditReferenceService {
  readonly #binding:Readonly<AuthBinding>;readonly #links:Pick<PerUserLinkService,"getStatus">;readonly #resolveClient:(id:string)=>unknown;
  readonly #ffprobePath:string;readonly #maxVideoBytes:number;readonly #now:()=>number;
  readonly #records=new Map<string,ReferenceRecord>();readonly #handles=new Map<string,Set<string>>();
  readonly #emptyOwned=new Map<object,Readonly<{attemptId:string;expiresAt:number}>>();
  readonly #principalByAttempt=new Map<string,Readonly<GenerationPrincipalRef>>();readonly #epochs=new Map<string,number>();
  readonly #pendingByAttempt=new Map<string,Set<Pending>>();readonly #pendingSemantics=new Set<string>();readonly #unknownSemantics=new Set<string>();
  readonly #invalidating=new Set<string>();readonly #invalidations=new Map<string,Promise<void>>();readonly #all=new Set<Promise<void>>();
  #pendingCount=0;#lastNow:number|undefined;#closed=false;#closing:Promise<void>|undefined;
  constructor(optionsInput:OwnerWan27VideoEditReferenceServiceOptions|unknown){
    const f=exactRecord(optionsInput,["binding","linkService","resolveClient","ffprobePath"],["maxVideoFileBytes","now"]);
    if(!genuineLinks(f.linkService)||typeof f.resolveClient!=="function"||types.isProxy(f.resolveClient)||typeof f.ffprobePath!=="string"||!f.ffprobePath||
      (f.maxVideoFileBytes!==undefined&&(!Number.isSafeInteger(f.maxVideoFileBytes)||(f.maxVideoFileBytes as number)<1||(f.maxVideoFileBytes as number)>100*1024*1024))||
      (f.now!==undefined&&(typeof f.now!=="function"||types.isProxy(f.now)))||typeof NATIVE_UPLOAD!=="function") fail("INVALID_REQUEST");
    this.#binding=snapshotBinding(f.binding);this.#links=f.linkService as Pick<PerUserLinkService,"getStatus">;
    this.#resolveClient=f.resolveClient as (id:string)=>unknown;this.#ffprobePath=f.ffprobePath;
    this.#maxVideoBytes=(f.maxVideoFileBytes as number|undefined)??64*1024*1024;this.#now=f.now===undefined?Date.now:readClock(f.now);
    SERVICES.add(this);Object.freeze(this);
  }

  async uploadReference(input:OwnerWan27VideoEditReferenceUploadInput|unknown,signalInput?:AbortSignal):Promise<OwnerWan27VideoEditReferenceUploadReceipt>{
    this.#assertOpen();const q=snapshotUpload(input,this.#maxVideoBytes);let op:Pending;
    try{op=this.#begin(q.attemptId,exactSignal(signalInput));}catch(e){q.bytes.fill(0);throw e;}
    let validation:Validated|undefined,semantic:string|undefined,reserved=false,nativeInvoked=false,published=false;
    try{
      const principal=await this.#principal(q.attemptId,op.controller.signal);this.#stopped(op);
      if(!this.#rememberPrincipal(q.attemptId,principal))fail("PRINCIPAL_NOT_LINKED");
      const initialClient=clientSnapshot(this.#resolveClient(q.attemptId));
      try{
        validation=q.mimeType.startsWith("video/")
          ?await validateOwnerWan27VideoEditVideo({filename:q.filename,mime_type:q.mimeType as OwnerWan27VideoEditVideoMimeType,bytes:q.bytes,ffprobePath:this.#ffprobePath,maxFileBytes:this.#maxVideoBytes},op.controller.signal)
          :validateOwnerWan27VideoEditImage({model_id:q.modelId,filename:q.filename,mime_type:q.mimeType,bytes:q.bytes});
      }catch{this.#stopped(op);fail("VALIDATION_REJECTED");}
      this.#stopped(op);const meta=readValidated(validation,q.modelId);
      if(!meta)fail("VALIDATION_REJECTED");
      semantic=semanticKey(principal,q.modelId,meta.sha256,meta.mime_type,meta.size);
      if(this.#unknownSemantics.has(semantic))fail("UPLOAD_OUTCOME_UNKNOWN");
      if(this.#pendingSemantics.has(semantic))fail("SERVICE_BUSY");
      this.#prune(this.#time());if(this.#records.size+this.#unknownSemantics.size+this.#pendingSemantics.size>=MAX_RECORDS)fail("CAPACITY_EXCEEDED");
      this.#pendingSemantics.add(semantic);reserved=true;
      const before=await this.#principal(q.attemptId,op.controller.signal);this.#stopped(op);
      const client=clientSnapshot(this.#resolveClient(q.attemptId));
      if(!sameGenerationPrincipal(principal,before)||client.client!==initialClient.client)fail("PRINCIPAL_NOT_LINKED");
      if(!isValid(validation,q.modelId)||getOwnerWan27VideoEditSourceProfile().source_sha256!==profileHash(q.modelId))fail("VALIDATION_REJECTED");
      const issued=this.#time();if(issued>Number.MAX_SAFE_INTEGER-TTL)fail("SERVICE_CLOSED");
      nativeInvoked=true;let native:InternalUploadReference;
      try{native=await Reflect.apply(NATIVE_UPLOAD as Function,client.client,[validation,op.controller.signal]) as InternalUploadReference;}
      catch{this.#unknownIfStopped(op);fail("UPLOAD_OUTCOME_UNKNOWN");}
      this.#unknownIfStopped(op);const nativeRef=readNativeReference(native);if(!nativeRef)fail("UPLOAD_OUTCOME_UNKNOWN");
      let after:Readonly<GenerationPrincipalRef>;try{after=await this.#principal(q.attemptId,op.controller.signal);}catch{fail("UPLOAD_OUTCOME_UNKNOWN");}
      this.#unknownIfStopped(op);const afterClient=clientSnapshot(this.#resolveClient(q.attemptId));
      if(!sameGenerationPrincipal(principal,after)||afterClient.client!==client.client)fail("UPLOAD_OUTCOME_UNKNOWN");
      const ack=this.#time(),expires=issued+TTL,epoch=op.epoch;
      if(expires-ack<1000||epoch!==(this.#epochs.get(q.attemptId)??0)||this.#invalidating.has(q.attemptId)||
         this.#records.size+this.#unknownSemantics.size>=MAX_RECORDS||!this.#pendingSemantics.has(semantic))fail("UPLOAD_OUTCOME_UNKNOWN");
      const collisions=[...this.#records.values()].filter(r=>r.principal.tenant_id===principal.tenant_id&&
        r.principal.subject_id===principal.subject_id&&r.kind===meta.kind&&r.url===nativeRef.url);
      const hasConflict=collisions.some(r=>r.sha256!==meta.sha256||r.mimeType!==meta.mime_type||r.size!==meta.size||r.width!==meta.width||r.height!==meta.height||
        r.durationSeconds!==meta.duration_seconds||r.inputCostDurationSeconds!==meta.input_cost_duration_seconds);
      if(hasConflict){this.#quarantineUrl(collisions);fail("UPLOAD_OUTCOME_UNKNOWN");}
      const handle=`wan27_videoedit_reference_${randomUUID()}`;
      const record:ReferenceRecord=Object.freeze({handle,attemptId:q.attemptId,modelId:q.modelId,profileHash:profileHash(q.modelId),principal,
        kind:meta.kind,mimeType:meta.mime_type,size:meta.size,sha256:meta.sha256,width:meta.width,height:meta.height,
        durationSeconds:meta.duration_seconds,inputCostDurationSeconds:meta.input_cost_duration_seconds,expiresAt:expires,epoch,client:client.client,url:nativeRef.url,
        ...(nativeRef.file_id===undefined?{}:{fileId:nativeRef.file_id})});
      this.#records.set(handle,record);const hs=this.#handles.get(q.attemptId)??new Set<string>();hs.add(handle);this.#handles.set(q.attemptId,hs);published=true;
      return Object.freeze({status:"uploaded",reference_handle:handle,model_id:q.modelId,kind:record.kind,mime_type:record.mimeType as OwnerWan27VideoEditReferenceUploadReceipt["mime_type"],
        size:record.size,sha256:record.sha256,width:record.width,height:record.height,duration_seconds:record.durationSeconds,
        input_cost_duration_seconds:record.inputCostDurationSeconds,expires_in_seconds:Math.floor((expires-ack)/1000),input_confidence:"LOCAL_METADATA_ONLY_NO_DECODE"});
    }catch(error){
      if(error instanceof OwnerWan27VideoEditReferenceServiceError){if(nativeInvoked&&!published&&error.code!=="UPLOAD_OUTCOME_UNKNOWN")fail("UPLOAD_OUTCOME_UNKNOWN");throw error;}
      if(error instanceof OwnerReferencePrincipalError){if(nativeInvoked)fail("UPLOAD_OUTCOME_UNKNOWN");fail("PRINCIPAL_NOT_LINKED");}
      if(nativeInvoked)fail("UPLOAD_OUTCOME_UNKNOWN");if(op.controller.signal.aborted)fail("REQUEST_ABORTED");return fail("VALIDATION_REJECTED");
    }finally{
      if(semantic&&reserved){if(nativeInvoked&&!published)this.#unknownSemantics.add(semantic);this.#pendingSemantics.delete(semantic);}
      if(validation)releaseValidation(validation);q.bytes.fill(0);this.#finish(q.attemptId,op);
    }
  }

  async resolveReferences(input:unknown,signalInput?:AbortSignal):Promise<OwnerWan27VideoEditOwnedReferences>{
    this.#assertOpen();const q=snapshotResolve(input),op=this.#begin(q.attemptId,exactSignal(signalInput));
    try{
      const principal=await this.#principal(q.attemptId,op.controller.signal);this.#stopped(op);
      if(!this.#rememberPrincipal(q.attemptId,principal))fail("PRINCIPAL_NOT_LINKED");
      const client=clientSnapshot(this.#resolveClient(q.attemptId)).client,profile=profileHash(q.modelId),rows:ReferenceRecord[]=[];
      const now=this.#time();
      for(const handle of q.handles){const r=this.#records.get(handle);
        if(!r||r.handle!==handle||r.attemptId!==q.attemptId||r.modelId!==q.modelId||r.profileHash!==profile||!sameGenerationPrincipal(r.principal,principal))fail("REFERENCE_UNAVAILABLE");
        if(r.expiresAt<=now){this.#remove(handle);fail("REFERENCE_EXPIRED");}
        if(r.epoch!==op.epoch||r.client!==client||!isSafeUploadReferenceUrl(r.url))fail("REFERENCE_UNAVAILABLE");rows.push(r);}
      const latest=await this.#principal(q.attemptId,op.controller.signal);this.#stopped(op);
      if(!sameGenerationPrincipal(latest,principal)||clientSnapshot(this.#resolveClient(q.attemptId)).client!==client)fail("PRINCIPAL_NOT_LINKED");
      const ack=this.#time(),expires=rows.length?Math.min(...rows.map(r=>r.expiresAt)):ack+TTL;
      for(const r of rows)if(r.expiresAt<=ack||this.#records.get(r.handle)!==r||r.epoch!==(this.#epochs.get(q.attemptId)??0)||
        this.#invalidating.has(q.attemptId)||r.client!==client||!sameGenerationPrincipal(r.principal,latest))fail("REFERENCE_EXPIRED");
      const refs=Object.freeze(rows.map(r=>Object.freeze({reference_handle:r.handle,kind:r.kind,mime_type:r.mimeType,size:r.size,sha256:r.sha256,
        width:r.width,height:r.height,duration_seconds:r.durationSeconds,input_cost_duration_seconds:r.inputCostDurationSeconds})));
      if(rows.length===0&&this.#emptyOwned.size>=MAX_RECORDS)fail("CAPACITY_EXCEEDED");
      const owned:OwnerWan27VideoEditOwnedReferences=Object.freeze({attempt_id:q.attemptId,model_id:q.modelId,principal,profile_sha256:profile,
        expires_at:expires,epoch:op.epoch,references:refs,generation_permit:false});
      OWNED.set(owned,Object.freeze({service:this,records:Object.freeze([...rows]),attemptId:q.attemptId,modelId:q.modelId,principal,client,epoch:op.epoch,expiresAt:expires}));
      if(rows.length===0)this.#emptyOwned.set(owned,Object.freeze({attemptId:q.attemptId,expiresAt:expires}));return owned;
    }catch(error){if(error instanceof OwnerWan27VideoEditReferenceServiceError)throw error;if(error instanceof OwnerReferencePrincipalError)fail("PRINCIPAL_NOT_LINKED");
      if(op.controller.signal.aborted)fail("REQUEST_ABORTED");fail("REFERENCE_UNAVAILABLE");}
    finally{this.#finish(q.attemptId,op);}
  }

  isOwnedReferences(value:unknown):value is OwnerWan27VideoEditOwnedReferences{
    try{this.#assertOpen();if(!value||typeof value!=="object"||types.isProxy(value)||!Object.isFrozen(value))return false;const s=OWNED.get(value);
      const remembered=s?this.#principalByAttempt.get(s.attemptId):undefined;
      if(!s||s.service!==this||this.#time()>=s.expiresAt||s.epoch!==(this.#epochs.get(s.attemptId)??0)||this.#invalidating.has(s.attemptId)||
        !remembered||!sameGenerationPrincipal(remembered,s.principal)||!exactOwned(value,s))return false;
      if(s.records.length===0&&!this.#emptyOwned.has(value))return false;
      for(const r of s.records)if(this.#records.get(r.handle)!==r||r.expiresAt<=this.#lastNow!||r.epoch!==s.epoch||r.profileHash!==profileHash(s.modelId)||
        !sameGenerationPrincipal(r.principal,s.principal)||clientSnapshot(this.#resolveClient(r.attemptId)).client!==s.client||!isSafeUploadReferenceUrl(r.url))return false;
      return clientSnapshot(this.#resolveClient(s.attemptId)).client===s.client;
    }catch{return false;}
  }
  withCapturedReferences<T>(value:unknown,consume:(client:SyntxChatHttpClient,records:readonly Readonly<{reference_handle:string;kind:"image"|"video";url:string;sha256:string;duration_seconds:number|null}>[])=>T):T{
    if(typeof consume!=="function"||types.isProxy(consume))fail("INVALID_REQUEST");const s=value&&typeof value==="object"&&!types.isProxy(value)?OWNED.get(value):undefined;
    if(!s||s.service!==this||!this.isOwnedReferences(value))fail("REFERENCE_UNAVAILABLE");
    const rows=Object.freeze(s.records.map(r=>Object.freeze({reference_handle:r.handle,kind:r.kind,url:r.url,sha256:r.sha256,duration_seconds:r.inputCostDurationSeconds})));
    if(s.records.some(r=>r.client!==s.client||clientSnapshot(this.#resolveClient(r.attemptId)).client!==s.client))fail("REFERENCE_UNAVAILABLE");
    return consume(s.client,rows);
  }
  invalidateAttempt(value:unknown):Promise<void>{if(typeof value!=="string"||!ATTEMPT.test(value))return Promise.resolve();return this.#invalidate(value);}
  close():Promise<void>{if(this.#closing)return this.#closing;this.#closed=true;const invalid=[...this.#active()].map(id=>this.#invalidate(id));
    const pending=[...this.#all];this.#closing=Promise.allSettled([...invalid,...pending]).then(()=>{this.#records.clear();this.#handles.clear();this.#principalByAttempt.clear();this.#epochs.clear();
      this.#emptyOwned.clear();this.#pendingSemantics.clear();this.#unknownSemantics.clear();this.#invalidating.clear();this.#invalidations.clear();this.#all.clear();});return this.#closing;}

  #principal(id:string,signal?:AbortSignal):Promise<Readonly<GenerationPrincipalRef>>{if(signal?.aborted)return Promise.reject(new OwnerWan27VideoEditReferenceServiceError("REQUEST_ABORTED"));
    const p=resolveOwnerReferencePrincipal({binding:this.#binding,attemptId:id,linkService:this.#links});if(!signal)return p;let remove=()=>{};
    const aborted=new Promise<never>((_r,reject)=>{const on=()=>reject(new OwnerWan27VideoEditReferenceServiceError("REQUEST_ABORTED"));if(signal.aborted)on();else{signal.addEventListener("abort",on,{once:true});remove=()=>signal.removeEventListener("abort",on);}});return Promise.race([p,aborted]).finally(remove);}
  #rememberPrincipal(id:string,p:Readonly<GenerationPrincipalRef>):boolean{const prior=this.#principalByAttempt.get(id);if(prior&&!sameGenerationPrincipal(prior,p))return false;this.#principalByAttempt.set(id,p);return true;}
  #begin(id:string,parent?:AbortSignal):Pending{this.#assertOpen();if(this.#invalidating.has(id))fail("REQUEST_ABORTED");this.#prune(this.#time());const active=this.#active();if(!active.has(id)&&active.size>=MAX_RECORDS)fail("CAPACITY_EXCEEDED");if(this.#pendingCount>=MAX_PENDING)fail("SERVICE_BUSY");
    const controller=new AbortController(),abort=()=>controller.abort(parent?.reason);if(parent?.aborted)abort();else parent?.addEventListener("abort",abort,{once:true});let finish!:()=>void;
    const done=new Promise<void>(resolve=>{finish=resolve;}),set=this.#pendingByAttempt.get(id)??new Set<Pending>();const op={controller,done,finish,removeAbort:()=>parent?.removeEventListener("abort",abort),epoch:this.#epochs.get(id)??0};
    set.add(op);this.#pendingByAttempt.set(id,set);this.#all.add(done);this.#pendingCount++;return op;}
  #finish(id:string,op:Pending):void{op.removeAbort();const set=this.#pendingByAttempt.get(id);set?.delete(op);if(!set?.size)this.#pendingByAttempt.delete(id);this.#pendingCount--;op.finish();this.#all.delete(op.done);this.#release(id);}
  #stopped(op:Pending):void{this.#assertOpen();if(op.controller.signal.aborted)fail("REQUEST_ABORTED");}
  #unknownIfStopped(op:Pending):void{if(this.#closed||op.controller.signal.aborted)fail("UPLOAD_OUTCOME_UNKNOWN");}
  #active():Set<string>{return new Set([...this.#handles.keys(),...this.#principalByAttempt.keys(),...this.#pendingByAttempt.keys(),...[...this.#emptyOwned.values()].map(x=>x.attemptId)]);}
  #invalidate(id:string):Promise<void>{const prior=this.#invalidations.get(id);if(prior)return prior;this.#invalidating.add(id);this.#epochs.set(id,(this.#epochs.get(id)??0)+1);this.#removeAttempt(id);this.#principalByAttempt.delete(id);
    for(const op of this.#pendingByAttempt.get(id)??[])op.controller.abort();const waits=[...(this.#pendingByAttempt.get(id)??[])].map(op=>op.done);
    const done=Promise.allSettled(waits).then(()=>{this.#invalidating.delete(id);this.#invalidations.delete(id);this.#release(id);});this.#invalidations.set(id,done);return done;}
  #removeAttempt(id:string):void{for(const h of this.#handles.get(id)??[])this.#records.delete(h);this.#handles.delete(id);for(const [owned,meta]of this.#emptyOwned)if(meta.attemptId===id)this.#emptyOwned.delete(owned);}
  #remove(handle:string):void{const r=this.#records.get(handle);if(!r)return;this.#records.delete(handle);const set=this.#handles.get(r.attemptId);set?.delete(handle);if(!set?.size)this.#handles.delete(r.attemptId);this.#release(r.attemptId);}
  #quarantineUrl(records:readonly ReferenceRecord[]):void{
    for(const record of records){
      this.#unknownSemantics.add(semanticKey(record.principal,record.modelId,record.sha256,record.mimeType,record.size));
      this.#remove(record.handle);
    }
  }
  #prune(now:number):void{for(const [h,r]of this.#records)if(r.expiresAt<=now)this.#remove(h);const expired=new Set<string>();for(const [owned,meta]of this.#emptyOwned)if(meta.expiresAt<=now){this.#emptyOwned.delete(owned);expired.add(meta.attemptId);}for(const id of expired)this.#release(id);}
  #release(id:string):void{if(this.#handles.has(id)||this.#pendingByAttempt.has(id)||this.#invalidating.has(id)||[...this.#emptyOwned.values()].some(x=>x.attemptId===id))return;this.#epochs.delete(id);this.#principalByAttempt.delete(id);}
  #assertOpen():void{if(this.#closed)fail("SERVICE_CLOSED");}
  #time():number{let v:unknown;try{v=this.#now();}catch{fail("SERVICE_CLOSED");}if(!Number.isSafeInteger(v)||(v as number)<0||(this.#lastNow!==undefined&&(v as number)<this.#lastNow))fail("SERVICE_CLOSED");this.#lastNow=v as number;return v as number;}
}
Object.freeze(OwnerWan27VideoEditReferenceService.prototype);
export function isOwnerWan27VideoEditReferenceService(v:unknown):v is OwnerWan27VideoEditReferenceService{return !!v&&typeof v==="object"&&!types.isProxy(v)&&SERVICES.has(v)&&Object.getPrototypeOf(v)===OwnerWan27VideoEditReferenceService.prototype&&Object.isFrozen(v);}

function readValidated(v:Validated,_modelId:OwnerWan27VideoEditModelId):Readonly<{kind:"image"|"video";mime_type:string;size:number;sha256:string;width:number;height:number;duration_seconds:number|null;input_cost_duration_seconds:number|null}>|null{
  if(isValidatedOwnerWan27VideoEditImage(v)){const d=readValidatedOwnerWan27VideoEditImage(v);if(!d)return null;d.bytes.fill(0);return {kind:"image",mime_type:d.mime_type,size:d.size,sha256:d.sha256,width:d.width,height:d.height,duration_seconds:null,input_cost_duration_seconds:null};}
  if(isValidatedOwnerWan27VideoEditVideo(v)){const d=readValidatedOwnerWan27VideoEditVideo(v);if(!d)return null;d.bytes.fill(0);return {kind:"video",mime_type:d.mime_type,size:d.size,sha256:d.sha256,width:d.width,height:d.height,duration_seconds:d.duration_seconds,input_cost_duration_seconds:d.duration_seconds};}
  return null;
}
function isValid(v:Validated,model:OwnerWan27VideoEditModelId):boolean{return model==="wan_27_videoedit"&&(isValidatedOwnerWan27VideoEditImage(v)||isValidatedOwnerWan27VideoEditVideo(v));}
function releaseValidation(v:Validated):void{if(isValidatedOwnerWan27VideoEditImage(v))releaseValidatedOwnerWan27VideoEditImage(v);else if(isValidatedOwnerWan27VideoEditVideo(v))releaseValidatedOwnerWan27VideoEditVideo(v);}
function profileHash(id:OwnerWan27VideoEditModelId):string{if(id!=="wan_27_videoedit")fail("INVALID_REQUEST");return getOwnerWan27VideoEditSourceProfile().source_sha256;}
function semanticKey(p:Readonly<GenerationPrincipalRef>,m:OwnerWan27VideoEditModelId,hash:string,mime:string,size:number):string{return schemaHash({tenant_id:p.tenant_id,subject_id:p.subject_id,model_id:m,profile_hash:profileHash(m),sha256:hash,mime_type:mime,size});}
function snapshotUpload(v:unknown,maxVideo:number):UploadSnapshot{const f=exactRecord(v,["attemptId","model_id","filename","mime_type","bytes"]);if(typeof f.attemptId!=="string"||!ATTEMPT.test(f.attemptId)||!isModel(f.model_id)||typeof f.filename!=="string"||typeof f.mime_type!=="string"||!supportedBytes(f.bytes))fail("INVALID_REQUEST");
  const size=byteLength(f.bytes as Uint8Array);if(size<1||size>(String(f.mime_type).startsWith("video/")?maxVideo:20*1024*1024))fail("INVALID_REQUEST");
  return Object.freeze({attemptId:f.attemptId,modelId:f.model_id,filename:f.filename,mimeType:f.mime_type,bytes:copyBytes(f.bytes as Uint8Array)});}
function snapshotResolve(v:unknown):ResolveSnapshot{const f=exactRecord(v,["attemptId","model_id","reference_handles"]);if(typeof f.attemptId!=="string"||!ATTEMPT.test(f.attemptId)||!isModel(f.model_id))fail("INVALID_REQUEST");const handles=snapshotHandles(f.reference_handles);if(new Set(handles).size!==handles.length)fail("INVALID_REQUEST");return Object.freeze({attemptId:f.attemptId,modelId:f.model_id,handles});}
function snapshotHandles(v:unknown):readonly string[]{
  if(!Array.isArray(v)||types.isProxy(v)||Object.getPrototypeOf(v)!==Array.prototype)fail("INVALID_REQUEST");
  const d=Object.getOwnPropertyDescriptors(v),len=Object.getOwnPropertyDescriptor(v,"length"),count=len?.value;
  if(!len||!Object.hasOwn(len,"value")||!Number.isSafeInteger(count)||(count as number)<0||(count as number)>5||Reflect.ownKeys(d).length!==(count as number)+1)fail("INVALID_REQUEST");
  const a:string[]=[];for(let i=0;i<(count as number);i++){const x=d[String(i)];if(!x||!x.enumerable||!Object.hasOwn(x,"value")||typeof x.value!=="string"||!exactMatch(HANDLE,x.value))fail("INVALID_REQUEST");a.push(x.value);}return Object.freeze(a);
}
function exactOwned(v:object,s:NonNullable<ReturnType<typeof OWNED.get>>):boolean{try{const f=exactRecord(v,["attempt_id","model_id","principal","profile_sha256","expires_at","epoch","references","generation_permit"]);if(f.attempt_id!==s.attemptId||f.model_id!==s.modelId||f.principal!==s.principal||f.profile_sha256!==profileHash(s.modelId)||f.expires_at!==s.expiresAt||f.epoch!==s.epoch||f.generation_permit!==false||!Array.isArray(f.references)||!Object.isFrozen(f.references)||f.references.length!==s.records.length)return false;
  for(let i=0;i<s.records.length;i++){const a=f.references[i],r=s.records[i]!;if(!a||typeof a!=="object"||types.isProxy(a)||!Object.isFrozen(a))return false;const x=exactRecord(a,["reference_handle","kind","mime_type","size","sha256","width","height","duration_seconds","input_cost_duration_seconds"]);if(x.reference_handle!==r.handle||x.kind!==r.kind||x.mime_type!==r.mimeType||x.size!==r.size||x.sha256!==r.sha256||x.width!==r.width||x.height!==r.height||x.duration_seconds!==r.durationSeconds||x.input_cost_duration_seconds!==r.inputCostDurationSeconds)return false;}return true;}catch{return false;}}
function clientSnapshot(v:unknown):Readonly<{client:SyntxChatHttpClient}>{try{const method=Reflect.get(SyntxChatHttpClient.prototype,"uploadOwnerWan27VideoEditReference");if(!v||typeof v!=="object"||types.isProxy(v)||Object.getPrototypeOf(v)!==SyntxChatHttpClient.prototype||Object.hasOwn(v,"uploadOwnerWan27VideoEditReference")||method!==NATIVE_UPLOAD||Reflect.get(v,"uploadOwnerWan27VideoEditReference")!==NATIVE_UPLOAD)fail("INVALID_REQUEST");return Object.freeze({client:v as SyntxChatHttpClient});}catch(e){if(e instanceof OwnerWan27VideoEditReferenceServiceError)throw e;fail("INVALID_REQUEST");}}
function readNativeReference(v:unknown):Readonly<InternalUploadReference>|null{try{if(!v||typeof v!=="object"||types.isProxy(v)||!Object.isFrozen(v))return null;const f=exactRecord(v,["url"],["file_id"]);if(typeof f.url!=="string"||!isSafeUploadReferenceUrl(f.url)||(f.file_id!==undefined&&(typeof f.file_id!=="string"||!MAX_FILE_ID.test(f.file_id))) )return null;return Object.freeze({url:f.url,...(f.file_id===undefined?{}:{file_id:f.file_id as string})});}catch{return null;}}
function exactRecord(v:unknown,required:readonly string[],optional:readonly string[]=[]):Record<string,unknown>{if(!v||typeof v!=="object"||Array.isArray(v)||types.isProxy(v))fail("INVALID_REQUEST");let p:object|null,d:PropertyDescriptorMap;try{p=Object.getPrototypeOf(v);d=Object.getOwnPropertyDescriptors(v);}catch{fail("INVALID_REQUEST");}const keys=Reflect.ownKeys(d),allowed=[...required,...optional];if((p!==Object.prototype&&p!==null)||required.some(k=>!Object.hasOwn(d,k))||keys.some(k=>typeof k!=="string"||!allowed.includes(k)||!Object.hasOwn(d[k]!,"value")||d[k]!.enumerable!==true))fail("INVALID_REQUEST");const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;for(const k of keys as string[])out[k]=d[k]!.value;return out;}
function snapshotBinding(v:unknown):Readonly<AuthBinding>{const f=exactRecord(v,["tenant_id","subject"]);if(typeof f.tenant_id!=="string"||!f.tenant_id||f.tenant_id.length>256||typeof f.subject!=="string"||!f.subject||f.subject.length>512||/[\u0000-\u001f\u007f]/u.test(f.tenant_id)||/[\u0000-\u001f\u007f]/u.test(f.subject))fail("INVALID_REQUEST");return Object.freeze({tenant_id:f.tenant_id,subject:f.subject});}
function genuineLinks(v:unknown):v is PerUserLinkService{if(!v||typeof v!=="object"||types.isProxy(v)||Object.getPrototypeOf(v)!==PerUserLinkService.prototype||PerUserLinkService.prototype.getStatus!==NATIVE_LINK_STATUS||Object.hasOwn(v,"getStatus"))return false;const d=Object.getOwnPropertyDescriptor(PerUserLinkService.prototype,"getStatus");return !!d&&"value"in d&&d.value===NATIVE_LINK_STATUS;}
function exactSignal(v:AbortSignal|undefined):AbortSignal|undefined{if(v===undefined)return undefined;if(!v||typeof v!=="object"||types.isProxy(v)||!(v instanceof AbortSignal)||Object.getPrototypeOf(v)!==AbortSignal.prototype)fail("INVALID_REQUEST");return v;}
function supportedBytes(v:unknown):v is Uint8Array{if(!v||typeof v!=="object"||types.isProxy(v)||!(v instanceof Uint8Array)||(Object.getPrototypeOf(v)!==Uint8Array.prototype&&Object.getPrototypeOf(v)!==Buffer.prototype)||["buffer","byteLength","byteOffset","length"].some(k=>Object.hasOwn(v,k)))return false;try{if(!TA_LENGTH||!TA_BUFFER||!TA_OFFSET||!ARRAY_BUFFER_LENGTH)return false;const b=Reflect.apply(TA_BUFFER,v,[]) as unknown;return !!b&&typeof b==="object"&&!types.isProxy(b)&&Object.getPrototypeOf(b)===ArrayBuffer.prototype&&!Object.hasOwn(b,"byteLength")&&Reflect.apply(ARRAY_BUFFER_LENGTH,b,[])>=Reflect.apply(TA_LENGTH,v,[]);}catch{return false;}}
function byteLength(v:Uint8Array):number{try{return Reflect.apply(TA_LENGTH!,v,[]) as number;}catch{fail("INVALID_REQUEST");}}
function copyBytes(v:Uint8Array):Buffer{try{return Buffer.from(new Uint8Array(Reflect.apply(TA_BUFFER!,v,[]) as ArrayBuffer,Reflect.apply(TA_OFFSET!,v,[]) as number,byteLength(v)));}catch{fail("INVALID_REQUEST");}}
function readClock(v:unknown):()=>number{return ()=>{let n:unknown;try{n=Reflect.apply(v as Function,undefined,[]);}catch{fail("SERVICE_CLOSED");}if(!Number.isSafeInteger(n)||(n as number)<0)fail("SERVICE_CLOSED");return n as number;};}
function isModel(v:unknown):v is OwnerWan27VideoEditModelId{return v==="wan_27_videoedit";}
function exactMatch(r:RegExp,v:string):boolean{return r.exec(v)?.[0]===v;}
function fail(code:OwnerWan27VideoEditReferenceServiceErrorCode):never{throw new OwnerWan27VideoEditReferenceServiceError(code);}
