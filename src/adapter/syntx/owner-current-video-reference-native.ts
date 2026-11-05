import { randomUUID } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";
import { z } from "zod/v4";
import type { AuthBinding } from "../../auth/types.js";
import type { PerUserLinkService } from "../../auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../../auth/owner-reference-principal.js";
import { sameGenerationPrincipal } from "../../domain/generation-principal.js";
import type { GenerationPrincipalRef } from "../../domain/generation-operation.js";
import { SyntxChatHttpClient, isOwnerCurrentVideoNativeClient } from "./chat-http-client.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";
import { compileOwnerCurrentVideoReferenceWire, peekOwnerCurrentVideoReferenceBundle, OwnerCurrentVideoReferenceStore } from "../../application/owner-current-video-reference-store.js";
import type { OwnerCurrentVideoReferenceBundle, OwnerCurrentVideoNativeOperation, OwnerCurrentVideoNativePort } from "../../application/owner-current-video-reference-types.js";
import { inspectOwnerCurrentVideoIntent, type OwnerCurrentVideoIntentDescription } from "../../application/owner-current-video-generation-service.js";

const ID=/^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u, ATTEMPT=/^link_[A-Za-z0-9_-]{20,120}$/u, PAGE_SIZE=10, MAX_PAGES=7;
const providerId=z.union([z.string().regex(ID),z.number().int().safe().nonnegative()]).transform(String);
const objectSchema=z.object({id:providerId,message_id:providerId.optional(),object_type:z.string().max(64),model_type:z.string().max(160).nullable().optional(),
 object_text:z.string().max(512*1024).nullable().optional(),object_url:z.string().max(4096).nullable().optional(),completed:z.boolean().nullable().optional()}).passthrough();
const rowSchema=z.object({id:providerId,chat_id:providerId,author_id:z.number().int().safe(),message_object:z.array(objectSchema).max(64)}).passthrough();
const pageSchema=z.object({messages:z.array(rowSchema).max(PAGE_SIZE),pagination:z.object({page:z.number().int().positive(),page_size:z.literal(PAGE_SIZE),
 total_count:z.number().int().nonnegative().max(64),total_pages:z.number().int().nonnegative().max(MAX_PAGES),has_previous:z.boolean(),has_next:z.boolean()}).passthrough()}).passthrough();
type Echo=Readonly<{object_type:string;url:string}>;
type State={readonly service:OwnerCurrentVideoNativeService;readonly client:SyntxChatHttpClient;readonly attemptId:string;readonly principal:Readonly<GenerationPrincipalRef>;
 readonly references:OwnerCurrentVideoReferenceStore;readonly bundle:OwnerCurrentVideoReferenceBundle;readonly intent:object;readonly description:Readonly<OwnerCurrentVideoIntentDescription>;readonly chatId:string;readonly epoch:number;
 phase:"READY"|"UNKNOWN"|"ACKNOWLEDGED"|"INVALIDATED";postStarted:boolean;ack?:string;wirePrompt?:string;echoes?:readonly Echo[]};
const OPERATIONS=new WeakMap<object,State>();
export interface OwnerCurrentVideoNativeServiceOptions {readonly binding:AuthBinding;readonly linkService:Pick<PerUserLinkService,"getStatus">;
 readonly references:OwnerCurrentVideoReferenceStore;readonly resolveClient:(attemptId:string)=>SyntxChatHttpClient}
/** Closed, owner-bound native orchestration. Family validation is admitted only via the sealed inspector. */
export class OwnerCurrentVideoNativeService implements OwnerCurrentVideoNativePort<object> {
 readonly #binding:AuthBinding;readonly #links:Pick<PerUserLinkService,"getStatus">;readonly #references:OwnerCurrentVideoReferenceStore;
 readonly #resolveClient:(attemptId:string)=>SyntxChatHttpClient;readonly #epochs=new Map<string,number>();readonly #states=new Set<State>();
 readonly #runs=new Map<AbortController,Readonly<{attempt:string;done:Promise<void>}>>();readonly #invalidating=new Map<string,Promise<void>>();#closed=false;#closing:Promise<void>|undefined;
 constructor(options:OwnerCurrentVideoNativeServiceOptions){this.#binding=options.binding;this.#links=options.linkService;this.#references=options.references;this.#resolveClient=options.resolveClient;}
 async createChat(input:{readonly attemptId:string;readonly bundle:OwnerCurrentVideoReferenceBundle;readonly intent:object},signal?:AbortSignal):Promise<OwnerCurrentVideoNativeOperation>{
  const row=exact(input,["attemptId","bundle","intent"]),attempt=readAttempt(row.attemptId),description=inspectOwnerCurrentVideoIntent(row.intent);if(!description||this.#states.size+this.#runs.size>=128)invalid();
  const run=this.#begin(attempt,signal);signal=run.signal;try {
  const epoch=this.#epoch(attempt),principal=await this.#principal(attempt),client=this.#client(attempt);await this.#references.revalidate(row.bundle as OwnerCurrentVideoReferenceBundle,signal);
  const peek=peekOwnerCurrentVideoReferenceBundle(this.#references,row.bundle as OwnerCurrentVideoReferenceBundle,client,attempt,principal);
  if(peek.model_id!==description.model_id||peek.mode!==description.mode||!isDeepStrictEqual(peek.metadata,description.reference_metadata))invalid();
  const chat=await client.createChat("video",`owner-current-video-${randomUUID()}`,signal);if(!chat||!ID.test(chat.chat_uuid))invalid();
  const after=await this.#principal(attempt);if(this.#closed||epoch!==this.#epoch(attempt)||!sameGenerationPrincipal(principal,after)||this.#client(attempt)!==client||signal?.aborted)invalid();
  const operation=Object.freeze({}) as OwnerCurrentVideoNativeOperation,state:State={service:this,client,attemptId:attempt,principal,bundle:row.bundle as OwnerCurrentVideoReferenceBundle,
   references:this.#references,intent:row.intent as object,description,chatId:chat.chat_uuid,epoch,phase:"READY",postStarted:false};OPERATIONS.set(operation,state);this.#states.add(state);return operation;
  } finally {run.finish();}
 }
 async dispatch(operation:OwnerCurrentVideoNativeOperation,signal?:AbortSignal):Promise<Readonly<{status:"acknowledged"}>>{
  const state=this.#state(operation);if(state.phase!=="READY")invalid();const run=this.#begin(state.attemptId,signal);signal=run.signal;try {await this.#authorize(state,signal);await this.#references.revalidate(state.bundle,signal);
  try{const receipt=await state.client.startOwnerCurrentVideoReferenceOperation(operation,signal);if(!receipt||receipt.chat_uuid!==state.chatId||!ID.test(receipt.message_id)||signal?.aborted)throw new Error("OUTCOME_UNKNOWN");await this.#authorize(state,signal);
   state.ack=receipt.message_id;state.phase="ACKNOWLEDGED";return Object.freeze({status:"acknowledged"});
  }catch(error){if(state.postStarted)throw new Error("OUTCOME_UNKNOWN");throw error;}}finally{run.finish();}
 }
 async observe(operation:OwnerCurrentVideoNativeOperation,signal?:AbortSignal):Promise<Readonly<{status:"pending"|"complete"|"unverified";artifacts:readonly Readonly<{url:string;mime_type:string|null;message_id:string;message_object_id:string}>[]}>>{
  const state=this.#state(operation);if(state.phase!=="UNKNOWN"&&state.phase!=="ACKNOWLEDGED")invalid();const empty=(status:"pending"|"unverified")=>Object.freeze({status,artifacts:Object.freeze([])});
  const run=this.#begin(state.attemptId,signal);signal=run.signal;try{const rows:z.infer<typeof rowSchema>[]=[],ids=new Set<string>(),objectIds=new Set<string>();let total:number|undefined,pages:number|undefined,providerChat:string|undefined;
   for(let page=1;page<=Math.min(MAX_PAGES,Math.max(1,pages??1));page++){
    await this.#authorize(state,signal);const raw=await state.client.readOwnerCurrentVideoReferenceHistory(operation,page,signal);await this.#authorize(state,signal);
    const parsed=pageSchema.safeParse(raw);if(!parsed.success)return empty("unverified");const p=parsed.data.pagination,expectedPages=p.total_count===0?0:Math.ceil(p.total_count/PAGE_SIZE);
    if(p.page!==page||p.total_pages!==expectedPages||p.has_previous!==(page>1)||p.has_next!==(page<expectedPages)||parsed.data.messages.length!==(p.total_count===0?0:Math.min(PAGE_SIZE,p.total_count-(page-1)*PAGE_SIZE))||
      total!==undefined&&(total!==p.total_count||pages!==p.total_pages))return empty("unverified");total??=p.total_count;pages??=p.total_pages;
    for(const row of parsed.data.messages){if(ids.has(row.id)||providerChat!==undefined&&providerChat!==row.chat_id)return empty("unverified");ids.add(row.id);providerChat??=row.chat_id;
      for(const object of row.message_object){if(objectIds.has(object.id)||object.message_id!==undefined&&object.message_id!==row.id)return empty("unverified");objectIds.add(object.id);}rows.push(row);}
    if(page===Math.max(1,expectedPages))break;
   }
   if(total===undefined||rows.length!==total||state.wirePrompt===undefined||!state.echoes)return empty("unverified");
   const owners=rows.filter(row=>row.author_id>0);if(owners.length!==1||state.ack&&owners[0]!.id!==state.ack)return empty("unverified");
   const owner=owners[0]!,texts=owner.message_object.filter(item=>item.object_type==="text"&&item.object_text===state.wirePrompt&&item.model_type===state.description.model_id);
   const noTextAllowed=state.wirePrompt===""&&state.echoes.length>0&&owner.message_object.every(item=>item.object_type!=="text");
   const media=owner.message_object.filter(item=>item.object_type!=="text");if((!noTextAllowed&&texts.length!==1)||media.length!==state.echoes.length||owner.message_object.length!==(noTextAllowed?0:1)+state.echoes.length)return empty("unverified");
   const remaining=[...media];for(const ref of state.echoes){const index=remaining.findIndex(obj=>obj.object_type===ref.object_type&&obj.object_url===ref.url&&obj.model_type===state.description.model_id);if(index<0)return empty("unverified");remaining.splice(index,1);}
   state.ack=owner.id;state.phase="ACKNOWLEDGED";const candidates=rows.filter(row=>row.author_id===-1&&row.message_object.some(item=>item.object_type==="video"));if(!candidates.length)return empty("pending");
   const artifacts:Array<{url:string;mime_type:string|null;message_id:string;message_object_id:string}>=[];
   for(const candidate of candidates){await this.#authorize(state,signal);const raw=await state.client.readOwnerCurrentVideoReferenceMessage(operation,candidate.id,signal);await this.#authorize(state,signal);
    const parsed=rowSchema.safeParse(raw);if(!parsed.success||parsed.data.id!==candidate.id||parsed.data.chat_id!==providerChat||parsed.data.author_id!==-1||!parsed.data.message_object.length)return empty("unverified");
    const expected=candidate.message_object.filter(o=>o.object_type==="video").map(o=>o.id),actualIds=parsed.data.message_object.map(o=>o.id);
    if(expected.length!==actualIds.length||new Set(expected).size!==expected.length||new Set(actualIds).size!==actualIds.length||expected.some(id=>!actualIds.includes(id)))return empty("unverified");
    for(const obj of parsed.data.message_object){if(!expected.includes(obj.id)||obj.message_id!==undefined&&obj.message_id!==candidate.id||obj.object_type!=="video"||obj.model_type!==state.description.model_id||obj.completed!==true||typeof obj.object_url!=="string"||!isSafeUploadReferenceUrl(obj.object_url))return empty("unverified");
     const ext=new URL(obj.object_url).pathname.toLowerCase();artifacts.push(Object.freeze({url:obj.object_url,mime_type:ext.endsWith(".mp4")?"video/mp4":ext.endsWith(".mov")?"video/quicktime":null,message_id:candidate.id,message_object_id:obj.id}));}
   }
   return Object.freeze({status:"complete",artifacts:Object.freeze(artifacts)});
  }catch{return empty("unverified");}finally{run.finish();}
 }
 async invalidateAttempt(attemptId:string):Promise<void>{const id=readAttempt(attemptId),existing=this.#invalidating.get(id);if(existing)return existing;this.#epochs.set(id,this.#epoch(id)+1);
  const active=[...this.#runs].filter(([,run])=>run.attempt===id);for(const [controller] of active)controller.abort();for(const state of this.#states)if(state.attemptId===id){state.phase="INVALIDATED";this.#states.delete(state);}
  const pending=Promise.all(active.map(([,run])=>run.done)).then(()=>{});this.#invalidating.set(id,pending);try{await pending;}finally{if(this.#invalidating.get(id)===pending)this.#invalidating.delete(id);}}
 async close():Promise<void>{if(this.#closing)return this.#closing;this.#closed=true;const active=[...this.#runs];for(const [controller] of active)controller.abort();for(const state of this.#states)state.phase="INVALIDATED";this.#states.clear();this.#closing=Promise.all(active.map(([,run])=>run.done)).then(()=>{});return this.#closing;}
 #epoch(id:string){return this.#epochs.get(id)??0;}
 async #principal(attemptId:string){if(this.#closed||this.#invalidating.has(attemptId))invalid();return resolveOwnerReferencePrincipal({binding:this.#binding,attemptId,linkService:this.#links});}
 #client(attemptId:string){const c=this.#resolveClient(attemptId);if(!isOwnerCurrentVideoNativeClient(c))invalid();return c;}
 #state(operation:OwnerCurrentVideoNativeOperation){if(!operation||typeof operation!=="object"||types.isProxy(operation))invalid();const state=OPERATIONS.get(operation);if(!state||state.service!==this||state.phase==="INVALIDATED"||this.#closed||state.epoch!==this.#epoch(state.attemptId)||this.#client(state.attemptId)!==state.client)invalid();return state;}
 async #authorize(state:State,signal?:AbortSignal){if(signal?.aborted||this.#closed||this.#invalidating.has(state.attemptId)||state.epoch!==this.#epoch(state.attemptId))invalid();const p=await this.#principal(state.attemptId);if(signal?.aborted||!sameGenerationPrincipal(p,state.principal)||this.#client(state.attemptId)!==state.client)invalid();}
 #begin(attempt:string,external?:AbortSignal):Readonly<{signal:AbortSignal;finish:()=>void}>{if(this.#closed||this.#invalidating.has(attempt)||external!==undefined&&(types.isProxy(external)||!(external instanceof AbortSignal)))invalid();
  const controller=new AbortController(),signal=external?AbortSignal.any([external,controller.signal]):controller.signal;let resolve!:()=>void;const done=new Promise<void>(r=>{resolve=r;});this.#runs.set(controller,{attempt,done});return Object.freeze({signal,finish:()=>{this.#runs.delete(controller);resolve();}});}
}
/** Called only by the native client immediately before its one non-idempotent POST. */
export function consumeOwnerCurrentVideoDispatch(client:SyntxChatHttpClient,operation:unknown):Readonly<{chat_id:string;ai_name:string;prompt:string;settings:Readonly<Record<string,unknown>>}>{
 if(!operation||typeof operation!=="object"||types.isProxy(operation))invalid();const state=OPERATIONS.get(operation);if(!state||state.client!==client||state.phase!=="READY")invalid();
 const current=inspectOwnerCurrentVideoIntent(state.intent);if(!current||!isDeepStrictEqual(current,state.description)||Object.hasOwn(current.settings,"file_urls")||
   current.settings.model_type!==current.model_id||current.source_pins.public_catalog_version!=="sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json"||
   current.source_pins.settings_inventory_version!=="sha256-4da7d12483291bb632aa21e0deb220142994fe061999d2f246318276964fa187.json")invalid();
 const wire=compileOwnerCurrentVideoReferenceWire(state.references,state.bundle,client,state.attemptId,state.principal,current.prompt,current.reference_prompt_mode);
 if(wire.model_id!==current.model_id||wire.mode!==current.mode)invalid();state.wirePrompt=wire.prompt;state.echoes=wire.reference_echoes;state.postStarted=true;state.phase="UNKNOWN";
 return Object.freeze({chat_id:state.chatId,ai_name:current.ai_name,prompt:wire.prompt,settings:Object.freeze({...current.settings,file_urls:wire.file_urls})});
}
export function readOwnerCurrentVideoOperationChat(client:SyntxChatHttpClient,operation:unknown):string {if(!operation||typeof operation!=="object"||types.isProxy(operation))invalid();const state=OPERATIONS.get(operation);if(!state||state.client!==client||state.phase==="INVALIDATED"||state.phase==="READY")invalid();return state.chatId;}
function exact(value:unknown,keys:readonly string[]):Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value)||types.isProxy(value))invalid();const proto=Object.getPrototypeOf(value),d=Object.getOwnPropertyDescriptors(value),own=Reflect.ownKeys(d);if(proto!==Object.prototype&&proto!==null||own.length!==keys.length||own.some(k=>typeof k!=="string"||!keys.includes(k)||!Object.hasOwn(d[k]!,"value")||!d[k]!.enumerable))invalid();return Object.fromEntries(keys.map(k=>[k,d[k]!.value]));}
function readAttempt(value:unknown):string{if(typeof value!=="string"||!ATTEMPT.test(value))invalid();return value;}
function invalid():never{throw new Error("OWNER_CURRENT_VIDEO_NATIVE_INVALID");}
