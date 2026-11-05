import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { resolveOwnerReferencePrincipal, OwnerReferencePrincipalError } from "../auth/owner-reference-principal.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { SyntxChatHttpClient, isOwnerCurrentVideoNativeClient, readOwnerCurrentVideoNativeUpload } from "../adapter/syntx/chat-http-client.js";
import { isCanonicalBase64 } from "./canonical-base64.js";
import { validateOwnerCurrentVideoReference, releaseOwnerCurrentValidatedVideoReference, type OwnerCurrentValidatedVideoReference } from "./owner-current-video-reference-validation.js";
import { validateOwnerCurrentVideoReferenceSelection } from "./owner-current-video-reference-policy.js";
import { probeOwnerCurrentVideoMetadata } from "./owner-current-video-metadata.js";
import { prepareOwnerCurrentVideoTrim } from "./owner-current-video-reference-trim.js";
import { validateOwnerCurrentVideoPromptAliases } from "./owner-current-video-reference-prompt.js";
import type { OwnerCurrentVideoNativeUpload, OwnerCurrentVideoReferenceBundle, OwnerCurrentVideoReferenceModelId,
 OwnerCurrentVideoReferencePort, OwnerCurrentVideoReferenceRole, OwnerCurrentVideoReferenceUploadReceipt } from "./owner-current-video-reference-types.js";

const TTL=15*60_000, CAP=128, MAX_BYTES=100*1024*1024, MAX_BASE64=Math.ceil(MAX_BYTES/3)*4;
const ATTEMPT=/^link_[A-Za-z0-9_-]{20,120}$/u, HANDLE=/^current_video_ref_[0-9a-f-]{36}$/u;
const MODELS=new Set<OwnerCurrentVideoReferenceModelId>(["seedance-2.0","seedance-2.5","seedance_pro","seedance_pro-fast","seedance-1.5-pro","hailuo-3.0","ray-3.14","veo3","veo3fast","veo3fast_r","flux3_t2v","flux3_i2v","flux3_v2v","wan_25_t2v_preview","wan_25_i2v_preview","wan_27_i2v","wan_27_r2v","wan_27_videoedit","wan_30_t2v","wan_30_reference","wan_30_omni","wan_30_edit","wan_30_first_last_frame"]);
type Entry={readonly handle:string;readonly attemptId:string;readonly model:OwnerCurrentVideoReferenceModelId;readonly principal:Readonly<GenerationPrincipalRef>;
 readonly client:SyntxChatHttpClient;readonly native:OwnerCurrentVideoNativeUpload;readonly metadata:OwnerCurrentValidatedVideoReference;readonly expires:number;
 readonly preparation:"ORIGINAL_BYTES"|"USER_SELECTED_SEGMENT_LOCAL_TRANSCODE"};
type BundleState={readonly store:OwnerCurrentVideoReferenceStore;readonly attemptId:string;readonly model:OwnerCurrentVideoReferenceModelId;readonly mode:string;readonly principal:Readonly<GenerationPrincipalRef>;
 readonly client:SyntxChatHttpClient;readonly entries:readonly Readonly<{entry:Entry;role:OwnerCurrentVideoReferenceRole}>[];readonly epoch:number;consumed:boolean;revalidatedAt:number|undefined};
const BUNDLES=new WeakMap<object,BundleState>();
export type OwnerCurrentVideoReferenceErrorCode="INVALID_REQUEST"|"PRINCIPAL_NOT_LINKED"|"SERVICE_CLOSED"|"UPLOAD_OUTCOME_UNKNOWN";
export class OwnerCurrentVideoReferenceError extends Error {constructor(readonly code:OwnerCurrentVideoReferenceErrorCode){super("The current video reference could not be processed safely.");this.name="OwnerCurrentVideoReferenceError";}}
export interface OwnerCurrentVideoReferenceStoreOptions {readonly binding:AuthBinding;readonly linkService:Pick<PerUserLinkService,"getStatus">;
 readonly resolveClient:(attemptId:string)=>SyntxChatHttpClient;readonly ffprobePath:string;readonly ffmpegPath?:string;readonly now?:()=>number}
/** Process-local opaque handles. Failures after an upload attempt remain non-retryable. */
export class OwnerCurrentVideoReferenceStore implements OwnerCurrentVideoReferencePort {
 readonly #binding:AuthBinding;readonly #links:Pick<PerUserLinkService,"getStatus">;readonly #resolveClient:(attemptId:string)=>SyntxChatHttpClient;
 readonly #ffprobePath:string;readonly #ffmpegPath:string|undefined;readonly #now:()=>number;readonly #entries=new Map<string,Entry>();readonly #unknown=new Set<string>();
 readonly #pending=new Set<string>();readonly #epochs=new Map<string,number>();readonly #invalidating=new Map<string,Promise<void>>();readonly #runs=new Map<AbortController,Readonly<{attempt:string;done:Promise<void>}>>();#closed=false;#closing:Promise<void>|undefined;#lastNow=-1;
 constructor(options:OwnerCurrentVideoReferenceStoreOptions){this.#binding=options.binding;this.#links=options.linkService;this.#resolveClient=options.resolveClient;this.#ffprobePath=options.ffprobePath;this.#ffmpegPath=options.ffmpegPath;this.#now=options.now??Date.now;}
 async upload(input:Parameters<OwnerCurrentVideoReferencePort["upload"]>[0],signal?:AbortSignal):Promise<OwnerCurrentVideoReferenceUploadReceipt>{
  const row=exact(input,["attemptId","model_id","filename","mime_type","content_base64"],["trim"]);const attempt=readAttempt(row.attemptId),model=readModel(row.model_id);
  if(typeof row.filename!=="string"||typeof row.mime_type!=="string"||typeof row.content_base64!=="string"||!isCanonicalBase64(row.content_base64,MAX_BASE64))invalid();
  const bytes=Buffer.from(row.content_base64,"base64");if(bytes.length<1||bytes.length>MAX_BYTES){bytes.fill(0);invalid();}
  try {return await this.#run(attempt,signal,async(s)=>{let validated:OwnerCurrentValidatedVideoReference|undefined,prepared:Buffer|undefined;let invoked=false,key:string|undefined;
   try {this.#prune();const epoch=this.#epoch(attempt),principal=await this.#principal(attempt),client=this.#client(attempt);this.#check(epoch,attempt,s);
    let filename=row.filename as string,mime=row.mime_type as string,source:Uint8Array=bytes;
    if(row.trim!==undefined){if(!this.#ffmpegPath||(mime!=="video/mp4"&&mime!=="video/quicktime"))invalid();const trim=exact(row.trim,["start_seconds","end_seconds"]);
      const measured=await probeOwnerCurrentVideoMetadata({bytes,mime_type:mime},{ffprobePath:this.#ffprobePath,maximumBytes:MAX_BYTES},s);
      try{prepared=await prepareOwnerCurrentVideoTrim(measured,trim as {start_seconds:number;end_seconds:number},this.#ffmpegPath,s);}finally{measured.bytes.fill(0);}
      source=prepared;mime="video/mp4";filename="current-trimmed.mp4";
    }
    validated=await validateOwnerCurrentVideoReference({model_id:model,filename,mime_type:mime,bytes:source},this.#ffprobePath,s);
    const after=await this.#principal(attempt);this.#check(epoch,attempt,s);if(!sameGenerationPrincipal(principal,after)||this.#client(attempt)!==client)invalid();
    key=JSON.stringify([attempt,principal.tenant_id,principal.subject_id,model,validated.sha256,validated.mime_type]);
    if(this.#unknown.has(key)||this.#pending.has(key))throw new OwnerCurrentVideoReferenceError("UPLOAD_OUTCOME_UNKNOWN");
    if(this.#entries.size+this.#unknown.size+this.#pending.size>=CAP)invalid();this.#pending.add(key);invoked=true;
    const native=await client.uploadOwnerCurrentVideoReference({attempt_id:attempt,principal,reference:validated},s);validated=undefined;
    const finalPrincipal=await this.#principal(attempt);this.#check(epoch,attempt,s);if(!sameGenerationPrincipal(principal,finalPrincipal)||this.#client(attempt)!==client)invalid();
    const owned=readOwnerCurrentVideoNativeUpload(client,native,attempt,principal);if(!owned||owned.metadata.model_id!==model)invalid();
    const handle=`current_video_ref_${randomUUID()}`,expires=this.#time()+TTL,entry:Entry={handle,attemptId:attempt,model,principal,client,native,metadata:owned.metadata,expires,
      preparation:row.trim===undefined?"ORIGINAL_BYTES":"USER_SELECTED_SEGMENT_LOCAL_TRANSCODE"};
    this.#entries.set(handle,entry);invoked=false;return publicReceipt(entry,this.#time());
   }catch(error){if(invoked&&key){this.#unknown.add(key);throw new OwnerCurrentVideoReferenceError("UPLOAD_OUTCOME_UNKNOWN");}
    if(error instanceof OwnerCurrentVideoReferenceError)throw error;if(error instanceof OwnerReferencePrincipalError)throw new OwnerCurrentVideoReferenceError("PRINCIPAL_NOT_LINKED");throw new OwnerCurrentVideoReferenceError("INVALID_REQUEST");
   }finally{if(key)this.#pending.delete(key);if(validated)releaseOwnerCurrentValidatedVideoReference(validated);prepared?.fill(0);bytes.fill(0);}
  });} finally {bytes.fill(0);}
 }
 async prepare(input:Parameters<OwnerCurrentVideoReferencePort["prepare"]>[0],signal?:AbortSignal):ReturnType<OwnerCurrentVideoReferencePort["prepare"]>{
  const row=exact(input,["attemptId","model_id","mode","references"]),attempt=readAttempt(row.attemptId),model=readModel(row.model_id);
  if(typeof row.mode!=="string")invalid();const selection=readSelection(row.references);
  return this.#run(attempt,signal,async(s)=>{this.#prune();const epoch=this.#epoch(attempt),principal=await this.#principal(attempt),client=this.#client(attempt);this.#check(epoch,attempt,s);
   const entries=selection.map(item=>{const entry=this.#entries.get(item.reference_handle);if(!entry||entry.attemptId!==attempt||entry.model!==model||entry.client!==client||!sameGenerationPrincipal(entry.principal,principal)||entry.expires<=this.#time())invalid();
    if(!readOwnerCurrentVideoNativeUpload(client,entry.native,attempt,principal))invalid();return Object.freeze({entry,role:item.role});});
   const metadata=entries.map(({entry,role})=>Object.freeze({reference_handle:entry.handle,role,kind:entry.metadata.kind,mime_type:entry.metadata.mime_type,size:entry.metadata.size,sha256:entry.metadata.sha256,
    ...(entry.metadata.width===undefined?{}:{width:entry.metadata.width}),...(entry.metadata.height===undefined?{}:{height:entry.metadata.height}),
    ...(entry.metadata.duration_seconds===undefined?{}:{duration_seconds:entry.metadata.duration_seconds})}));
   validateOwnerCurrentVideoReferenceSelection(model,row.mode as string,metadata);const after=await this.#principal(attempt);this.#check(epoch,attempt,s);if(!sameGenerationPrincipal(principal,after)||this.#client(attempt)!==client)invalid();
   const token=Object.freeze({}) as OwnerCurrentVideoReferenceBundle;BUNDLES.set(token,{store:this,attemptId:attempt,model,mode:row.mode as string,principal,client,entries:Object.freeze(entries),epoch,consumed:false,revalidatedAt:undefined});
   return Object.freeze({bundle:token,metadata:Object.freeze(metadata.map(({reference_handle:_handle,...safe})=>Object.freeze(safe)))});
  });
 }
 async revalidate(bundle:OwnerCurrentVideoReferenceBundle,signal?:AbortSignal):Promise<void>{const state=bundleState(this,bundle);await this.#run(state.attemptId,signal,async(s)=>{
  const principal=await this.#principal(state.attemptId);this.#check(state.epoch,state.attemptId,s);if(!sameGenerationPrincipal(principal,state.principal)||this.#client(state.attemptId)!==state.client)invalid();
  for(const {entry} of state.entries)if(this.#entries.get(entry.handle)!==entry||entry.expires<=this.#time()||!readOwnerCurrentVideoNativeUpload(state.client,entry.native,state.attemptId,principal))invalid();state.revalidatedAt=this.#time();
 });}
 async invalidateAttempt(attemptId:string):Promise<void>{const attempt=readAttempt(attemptId),existing=this.#invalidating.get(attempt);if(existing)return existing;
  this.#epochs.set(attempt,this.#epoch(attempt)+1);const active=[...this.#runs].filter(([,run])=>run.attempt===attempt);for(const [controller] of active)controller.abort();
  for(const [handle,entry] of this.#entries)if(entry.attemptId===attempt)this.#entries.delete(handle);
  const pending=Promise.all(active.map(([,run])=>run.done)).then(()=>{});this.#invalidating.set(attempt,pending);try{await pending;}finally{if(this.#invalidating.get(attempt)===pending)this.#invalidating.delete(attempt);}}
 async close():Promise<void>{if(this.#closing)return this.#closing;this.#closed=true;const active=[...this.#runs];for(const [controller] of active)controller.abort();this.#entries.clear();this.#closing=Promise.all(active.map(([,run])=>run.done)).then(()=>{});return this.#closing;}
 peekNative(bundle:OwnerCurrentVideoReferenceBundle,client:SyntxChatHttpClient,attemptId:string,principalInput:GenerationPrincipalRef):Readonly<{model_id:OwnerCurrentVideoReferenceModelId;mode:string;metadata:readonly Readonly<import("./owner-current-video-reference-types.js").OwnerCurrentVideoReferenceMetadata>[]}> {
  const state=bundleState(this,bundle),principal=snapshotGenerationPrincipal(principalInput),now=this.#time();
  if(this.#closed||this.#invalidating.has(attemptId)||this.#epoch(attemptId)!==state.epoch||state.client!==client||state.attemptId!==attemptId||
    !sameGenerationPrincipal(state.principal,principal)||this.#client(attemptId)!==client||state.revalidatedAt===undefined||now<state.revalidatedAt||now-state.revalidatedAt>1000)invalid();
  for(const {entry} of state.entries)if(this.#entries.get(entry.handle)!==entry||entry.expires<=now||!readOwnerCurrentVideoNativeUpload(client,entry.native,attemptId,principal))invalid();
  return Object.freeze({model_id:state.model,mode:state.mode,metadata:Object.freeze(state.entries.map(({entry,role})=>Object.freeze({role,kind:entry.metadata.kind,mime_type:entry.metadata.mime_type,size:entry.metadata.size,sha256:entry.metadata.sha256,
    ...(entry.metadata.width===undefined?{}:{width:entry.metadata.width}),...(entry.metadata.height===undefined?{}:{height:entry.metadata.height}),...(entry.metadata.duration_seconds===undefined?{}:{duration_seconds:entry.metadata.duration_seconds})})))});
 }
 consumeNative(bundle:OwnerCurrentVideoReferenceBundle,client:SyntxChatHttpClient,attemptId:string,principalInput:GenerationPrincipalRef):Readonly<{
   model_id:OwnerCurrentVideoReferenceModelId;mode:string;references:readonly Readonly<{role:OwnerCurrentVideoReferenceRole;kind:string;url:string;sha256:string}>[]}> {
  const state=bundleState(this,bundle),principal=snapshotGenerationPrincipal(principalInput);
  const now=this.#time();if(this.#closed||this.#invalidating.has(attemptId)||this.#epoch(attemptId)!==state.epoch||state.client!==client||state.attemptId!==attemptId||!sameGenerationPrincipal(state.principal,principal)||this.#client(attemptId)!==client||state.revalidatedAt===undefined||now<state.revalidatedAt||now-state.revalidatedAt>1000)invalid();
  const references=state.entries.map(({entry,role})=>{if(this.#entries.get(entry.handle)!==entry||entry.expires<=this.#time())invalid();const native=readOwnerCurrentVideoNativeUpload(client,entry.native,attemptId,principal);if(!native)invalid();return Object.freeze({role,kind:entry.metadata.kind,url:native.url,sha256:entry.metadata.sha256});});
  state.consumed=true;return Object.freeze({model_id:state.model,mode:state.mode,references:Object.freeze(references)});
 }
 #epoch(attempt:string){return this.#epochs.get(attempt)??0;}
 #time(){const n=this.#now();if(!Number.isFinite(n)||n<0||n<this.#lastNow)invalid();this.#lastNow=n;return n;}
 #prune(){const now=this.#time();for(const [key,entry] of this.#entries)if(entry.expires<=now)this.#entries.delete(key);}
 #client(attempt:string){const client=this.#resolveClient(attempt);if(!isOwnerCurrentVideoNativeClient(client))invalid();return client;}
 #principal(attemptId:string){if(this.#closed)throw new OwnerCurrentVideoReferenceError("SERVICE_CLOSED");if(this.#invalidating.has(attemptId))invalid();return resolveOwnerReferencePrincipal({binding:this.#binding,attemptId,linkService:this.#links});}
 #check(epoch:number,attempt:string,signal:AbortSignal){if(this.#closed||this.#invalidating.has(attempt)||signal.aborted||this.#epoch(attempt)!==epoch)invalid();}
 async #run<T>(attempt:string,external:AbortSignal|undefined,fn:(signal:AbortSignal)=>Promise<T>):Promise<T>{if(this.#closed)throw new OwnerCurrentVideoReferenceError("SERVICE_CLOSED");if(external!==undefined&&(types.isProxy(external)||!(external instanceof AbortSignal)))invalid();
  const controller=new AbortController(),signal=external?AbortSignal.any([external,controller.signal]):controller.signal;let finish!:()=>void;const done=new Promise<void>(resolve=>{finish=resolve;});this.#runs.set(controller,{attempt,done});try{if(signal.aborted)invalid();return await fn(signal);}finally{this.#runs.delete(controller);finish();}}
}
/** Native-only one-shot extraction. The caller must revalidate immediately before this call. */
export function consumeOwnerCurrentVideoReferenceBundle(store:OwnerCurrentVideoReferenceStore,bundle:OwnerCurrentVideoReferenceBundle,client:SyntxChatHttpClient,
 attemptId:string,principalInput:GenerationPrincipalRef):Readonly<{model_id:OwnerCurrentVideoReferenceModelId;mode:string;references:readonly Readonly<{role:OwnerCurrentVideoReferenceRole;kind:string;url:string;sha256:string}>[]}> {
 return store.consumeNative(bundle,client,attemptId,principalInput);
}
export function peekOwnerCurrentVideoReferenceBundle(store:OwnerCurrentVideoReferenceStore,bundle:OwnerCurrentVideoReferenceBundle,client:SyntxChatHttpClient,
 attemptId:string,principalInput:GenerationPrincipalRef):ReturnType<OwnerCurrentVideoReferenceStore["peekNative"]>{return store.peekNative(bundle,client,attemptId,principalInput);}
/** Internal one-shot source serializer. It accepts only a genuine owner-bound bundle, never caller URLs. */
export function compileOwnerCurrentVideoReferenceWire(store:OwnerCurrentVideoReferenceStore,bundle:OwnerCurrentVideoReferenceBundle,client:SyntxChatHttpClient,
 attemptId:string,principal:GenerationPrincipalRef,prompt:string,promptMode:"DISABLED_LITERAL"|"ENABLED_ALIASES"):Readonly<{model_id:OwnerCurrentVideoReferenceModelId;mode:string;prompt:string;
 file_urls:readonly Readonly<{type:OwnerCurrentVideoReferenceRole;url:string}>[];reference_url_hashes:readonly Readonly<{type:OwnerCurrentVideoReferenceRole;url_sha256:string}>[];
 reference_echoes:readonly Readonly<{object_type:string;url:string}>[]}> {
 const state=bundleState(store,bundle),mentions=promptMode==="ENABLED_ALIASES";
 validateOwnerCurrentVideoPromptAliases(prompt,state.model,promptMode,state.entries.map(({entry,role})=>({...entry.metadata,role})));
 store.peekNative(bundle,client,attemptId,principal);const aliases=new Map<string,string>(),index:Record<string,number>={image:0,video:0,audio:0};
 if(mentions)for(const {entry} of state.entries)if(Object.hasOwn(index,entry.metadata.kind)&&!(state.model==="wan_27_r2v"&&entry.metadata.kind==="audio")){
   const native=readOwnerCurrentVideoNativeUpload(client,entry.native,attemptId,principal);if(!native)invalid();const kind=entry.metadata.kind;
   index[kind]=(index[kind]??0)+1;aliases.set(`${kind}${index[kind]}`,native.url);
 }
 let rendered=prompt;
 if(mentions){const parts:string[]=[];let last=0,bytes=0;for(const match of prompt.matchAll(/@(image|video|audio)(\d+)(?!\d)/gu)){
   const prefix=prompt.slice(last,match.index),url=aliases.get(`${match[1]}${match[2]}`),replacement=url===undefined?match[0]:`<<<${url}>>>`;
   bytes+=Buffer.byteLength(prefix,"utf8")+Buffer.byteLength(replacement,"utf8");if(bytes>512*1024)invalid();parts.push(prefix,replacement);last=match.index+match[0].length;
  }const tail=prompt.slice(last);bytes+=Buffer.byteLength(tail,"utf8");if(bytes>512*1024)invalid();parts.push(tail);rendered=parts.join("");}
 if(Buffer.byteLength(rendered,"utf8")>512*1024)invalid();const captured=store.consumeNative(bundle,client,attemptId,principal);
 const seen=new Set<string>(),file_urls:Readonly<{type:OwnerCurrentVideoReferenceRole;url:string}>[]=[],reference_echoes:Readonly<{object_type:string;url:string}>[]=[];
 for(const reference of captured.references){const key=`${reference.role}:${reference.url}`;if(!seen.has(key)){seen.add(key);file_urls.push(Object.freeze({type:reference.role,url:reference.url}));reference_echoes.push(Object.freeze({object_type:reference.kind,url:reference.url}));}}
 return Object.freeze({model_id:captured.model_id,mode:captured.mode,prompt:rendered,file_urls:Object.freeze(file_urls),
  reference_url_hashes:Object.freeze(file_urls.map(item=>Object.freeze({type:item.type,url_sha256:createHash("sha256").update(item.url,"utf8").digest("hex")}))),reference_echoes:Object.freeze(reference_echoes)});
}
function bundleState(store:OwnerCurrentVideoReferenceStore,bundle:unknown):BundleState{if(!bundle||typeof bundle!=="object"||types.isProxy(bundle)||!Object.isFrozen(bundle))invalid();const state=BUNDLES.get(bundle);if(!state||state.store!==store||state.consumed)invalid();return state;}
function publicReceipt(entry:Entry,now:number):OwnerCurrentVideoReferenceUploadReceipt{return Object.freeze({status:"uploaded",reference_handle:entry.handle,kind:entry.metadata.kind,mime_type:entry.metadata.mime_type,size:entry.metadata.size,sha256:entry.metadata.sha256,preparation:entry.preparation,
 ...(entry.metadata.width===undefined?{}:{width:entry.metadata.width}),...(entry.metadata.height===undefined?{}:{height:entry.metadata.height}),...(entry.metadata.duration_seconds===undefined?{}:{duration_seconds:entry.metadata.duration_seconds}),expires_in_seconds:Math.max(0,Math.ceil((entry.expires-now)/1000))});}
function exact(value:unknown,keys:readonly string[],optional:readonly string[]=[]):Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value)||types.isProxy(value))invalid();const proto=Object.getPrototypeOf(value),d=Object.getOwnPropertyDescriptors(value),own=Reflect.ownKeys(d);
 if(proto!==Object.prototype&&proto!==null||keys.some(k=>!Object.hasOwn(d,k))||own.some(k=>typeof k!=="string"||!keys.includes(k)&&!optional.includes(k)||!Object.hasOwn(d[k]!,"value")||!d[k]!.enumerable))invalid();return Object.fromEntries((own as string[]).map(k=>[k,d[k]!.value]));}
function readAttempt(value:unknown):string{if(typeof value!=="string"||!ATTEMPT.test(value))invalid();return value;}
function readModel(value:unknown):OwnerCurrentVideoReferenceModelId{if(typeof value!=="string"||!MODELS.has(value as OwnerCurrentVideoReferenceModelId))invalid();return value as OwnerCurrentVideoReferenceModelId;}
function readSelection(value:unknown):readonly Readonly<{reference_handle:string;role:OwnerCurrentVideoReferenceRole}>[]{if(!Array.isArray(value)||types.isProxy(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>50)invalid();const d=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(d);
 if(keys.length!==value.length+1||keys.some(k=>k!=="length"&&(typeof k!=="string"||!/^\d+$/u.test(k)||Number(k)>=value.length)))invalid();return Object.freeze(Array.from({length:value.length},(_,i)=>{const slot=d[String(i)];if(!slot||!slot.enumerable||!Object.hasOwn(slot,"value"))invalid();const row=exact(slot.value,["reference_handle","role"]);
 if(typeof row.reference_handle!=="string"||!HANDLE.test(row.reference_handle)||typeof row.role!=="string"||!["image","video","audio","file","first_frame","last_frame","first_clip"].includes(row.role))invalid();return Object.freeze({reference_handle:row.reference_handle,role:row.role as OwnerCurrentVideoReferenceRole});}));}
function invalid():never{throw new OwnerCurrentVideoReferenceError("INVALID_REQUEST");}
