import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { SyntxChatHttpClient, type MediaGenerationReceipt } from "../adapter/syntx/chat-http-client.js";
import { SyntxHttpClient } from "../adapter/syntx/http-client.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../catalog/public-catalog-history.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { AccountStatusService, type AccountStatusResult } from "./account-status.js";
import { ModelAccessService, type ModelAccessResult } from "./model-access.js";
import type { OwnerWan27I2vChatContext } from "../adapter/syntx/owner-wan27-i2v-native-context.js";
import { bindOwnerWan27I2vAck, bindOwnerWan27I2vOwnerEcho, bindOwnerWan27I2vResultContext,
  isOwnerWan27I2vChatContextForClient, readOwnerWan27I2vTransport, registerOwnerWan27I2vOperation }
  from "../adapter/syntx/owner-wan27-i2v-native-context.js";
import { buildOwnerWan27I2vWire, type OwnerWan27I2vWireCandidate } from "./owner-wan27-i2v-wire.js";
import { getOwnerWan27I2vSourceProfile, normalizeOwnerWan27I2vParameters,
  type OwnerWan27I2vInput, type OwnerWan27I2vNormalizedParameters } from "./owner-wan27-i2v-parameters.js";
import { isOwnerWan27I2vReferenceService, type OwnerWan27I2vOwnedImage, type OwnerWan27I2vReferenceService } from "./owner-wan27-i2v-reference-service.js";

export const OWNER_WAN27_I2V_CATALOG_VERSION = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json" as const;
const MODEL_ID = "wan_27_i2v" as const, AI_NAME = "wan_video" as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u, RECOVERY = /^wan27i2v_recovery_[0-9a-f-]{36}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const FRESH_MS = 15_000, MAX_PENDING = 4, MAX_RECOVERIES = 128;
const NATIVE_CREATE=Reflect.get(SyntxChatHttpClient.prototype,"createOwnerWan27I2vChat");
const NATIVE_IS_CHAT=Reflect.get(SyntxChatHttpClient.prototype,"isOwnerWan27I2vChat");
const NATIVE_INVALIDATE=Reflect.get(SyntxChatHttpClient.prototype,"invalidateOwnerWan27I2vChats");
const NATIVE_START=Reflect.get(SyntxChatHttpClient.prototype,"startOwnerWan27I2vOperation");
const NATIVE_HISTORY=Reflect.get(SyntxChatHttpClient.prototype,"readOwnerWan27I2vHistory");
const NATIVE_GET=Reflect.get(SyntxChatHttpClient.prototype,"readOwnerWan27I2vResult");
const SERVICES = new WeakSet<object>(), CLAIMS = new Set<string>(), IN_FLIGHT = new Set<string>();
interface NativeWan27I2vClient extends SyntxChatHttpClient {
  createOwnerWan27I2vChat(input: { readonly attemptId: string; readonly model_id: "wan_27_i2v"; readonly title: string },
    signal?: AbortSignal): Promise<OwnerWan27I2vChatContext>;
  isOwnerWan27I2vChat(context: unknown, attemptId: string): context is OwnerWan27I2vChatContext;
  invalidateOwnerWan27I2vChats(attemptId?: string): void;
  startOwnerWan27I2vOperation(token: unknown, signal?: AbortSignal): Promise<MediaGenerationReceipt>;
  readOwnerWan27I2vHistory(token: unknown, signal?: AbortSignal): Promise<unknown>;
  readOwnerWan27I2vResult(context: unknown, signal?: AbortSignal): Promise<unknown>;
}

export interface OwnerWan27I2vGenerationOptions {
  readonly binding: AuthBinding; readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly referenceService: OwnerWan27I2vReferenceService; readonly catalog: DiscoveryCatalogRepository;
  readonly catalogDirectory?: string; readonly resolveChatClient: (attemptId: string) => unknown;
  readonly createReadClient: (attemptId: string) => unknown; readonly now: () => number; readonly timeoutMs?: number;
}
export interface OwnerWan27I2vGenerateInput extends OwnerWan27I2vInput {
  readonly attemptId: string; readonly image_handle: string;
}
export interface OwnerWan27I2vArtifact {
  readonly object_index: number; readonly message_object_id: string; readonly object_type: "video"; readonly object_url: string;
  readonly mime_type: "video/mp4" | "video/quicktime" | null; readonly message_id: string;
  readonly chat_uuid: string; readonly model_id: "wan_27_i2v";
}
export interface OwnerWan27I2vGenerationResult {
  readonly status: "completed" | "outcome_unknown"; readonly recovery_id: string; readonly model_id: "wan_27_i2v";
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY"; readonly provider_terminal_status: "UNPROVEN";
  readonly backend_acceptance: "UNPROVEN"; readonly cost_cap_enforced: false; readonly durability: "PROCESS_LOCAL_ONLY";
  readonly observed_artifact_count: number; readonly artifacts: readonly OwnerWan27I2vArtifact[]; readonly gaps: readonly string[];
}
interface Operation {
  readonly request: OwnerWan27I2vGenerateInput; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly client: NativeWan27I2vClient; readonly reference: OwnerWan27I2vOwnedImage; readonly normalized: OwnerWan27I2vNormalizedParameters;
  readonly wire: OwnerWan27I2vWireCandidate; readonly token: object; readonly recovery: string; readonly semantic: string;
  readonly epoch: number; chat?: OwnerWan27I2vChatContext; phase: "PREPARING" | "READY" | "POSTED" | "INVALID";
  ack: string | null; quoteAt: number; invalid: boolean; result: OwnerWan27I2vGenerationResult;
}
export class OwnerWan27I2vGenerationServiceError extends Error {
  constructor(readonly code: string, readonly recovery_id?: string) {
    super(code === "OUTCOME_UNKNOWN" ? "WAN 2.7 I2V may have been dispatched; reconcile by GET only and never retry."
      : "The owner WAN 2.7 I2V operation could not be completed safely.");
    this.name = "OwnerWan27I2vGenerationServiceError";
  }
}

/** Draft owner-only WAN27 I2V engine. No canonical client methods are added from this draft. */
export class OwnerWan27I2vGenerationService {
  readonly #binding: Readonly<AuthBinding>; readonly #links: Pick<PerUserLinkService,"getStatus">;
  readonly #references: OwnerWan27I2vReferenceService; readonly #catalog: DiscoveryCatalogRepository;
  readonly #resolve: (attempt: string) => unknown; readonly #read: (attempt: string) => unknown;
  readonly #now: () => number; readonly #timeout: number; readonly #records = new Map<string,Operation>();
  readonly #epochs = new Map<string,number>(); readonly #claims = new Set<string>(); readonly #pending = new Set<Promise<unknown>>();
  #lastNow = -1; #closed = false;
  constructor(input: OwnerWan27I2vGenerationOptions | unknown) {
    const f = exact(input,["binding","linkService","referenceService","catalog","resolveChatClient","createReadClient","now"],["catalogDirectory","timeoutMs"]);
    if (!genuine(f.linkService,PerUserLinkService,["getStatus"]) || !isOwnerWan27I2vReferenceService(f.referenceService) ||
        !(f.catalog instanceof DiscoveryCatalogRepository) || typeof f.resolveChatClient !== "function" ||
        typeof f.createReadClient !== "function" || typeof f.now !== "function" ||
        [NATIVE_CREATE,NATIVE_IS_CHAT,NATIVE_INVALIDATE,NATIVE_START,NATIVE_HISTORY,NATIVE_GET].some(v=>typeof v!=="function"))
      fail("INVALID_REQUEST");
    this.#binding = binding(f.binding); this.#links = f.linkService as Pick<PerUserLinkService,"getStatus">;
    this.#references = f.referenceService as OwnerWan27I2vReferenceService; this.#catalog = f.catalog as DiscoveryCatalogRepository;
    this.#resolve = f.resolveChatClient as (attempt: string) => unknown; this.#read = f.createReadClient as (attempt: string) => unknown;
    this.#now = f.now as () => number; this.#timeout = bounded(f.timeoutMs,1_000,300_000,120_000);
    assertCatalog(this.#catalog,f.catalogDirectory as string|undefined); SERVICES.add(this); Object.freeze(this);
  }
  generate(input: OwnerWan27I2vGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerWan27I2vGenerationResult> {
    const request = generateRequest(input), normalized = normalizeOwnerWan27I2vParameters(sourceInput(request));
    return this.#run(request.attemptId,signal,d=>this.#generate(request,normalized,d));
  }
  reconcile(input: unknown, signal?: AbortSignal): Promise<OwnerWan27I2vGenerationResult> {
    const f = exact(input,["attemptId","recovery_id"]);
    if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) ||
        typeof f.recovery_id !== "string" || !RECOVERY.test(f.recovery_id)) fail("INVALID_REQUEST");
    return this.#run(f.attemptId,signal,async d=>{
      const op = this.#records.get(f.recovery_id as string);
      if (!op || op.request.attemptId !== f.attemptId) fail("RECOVERY_NOT_FOUND");
      await this.#current(op,d); this.#validate(op,false);
      return op.phase !== "POSTED" || op.result.status === "completed" ? op.result : this.#collect(op,d);
    });
  }
  listRecoveries(input: unknown, signal?: AbortSignal): Promise<readonly OwnerWan27I2vGenerationResult[]> {
    const f = exact(input,["attemptId"]);
    if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId)) fail("INVALID_REQUEST");
    return this.#run(f.attemptId,signal,async d=>{
      const principal = await d.waitFor(resolveOwnerReferencePrincipal({binding:this.#binding,attemptId:f.attemptId as string,linkService:this.#links}));
      return Object.freeze([...this.#records.values()].filter(op=>op.request.attemptId===f.attemptId &&
        sameGenerationPrincipal(op.principal,principal)).map(op=>op.result));
    });
  }
  async invalidateAttempt(attempt: string): Promise<void> {
    if (!ATTEMPT.test(attempt)) return; this.#epochs.set(attempt,(this.#epochs.get(attempt)??0)+1);
    for (const op of this.#records.values()) if (op.request.attemptId===attempt) {
      op.invalid=true; op.phase="INVALID"; op.client.invalidateOwnerWan27I2vChats(attempt);
    }
    await this.#references.invalidateAttempt(attempt); await Promise.allSettled([...this.#pending]);
  }
  async close(): Promise<void> { this.#closed=true; for (const op of this.#records.values()) {op.invalid=true;op.phase="INVALID";}
    await Promise.allSettled([...this.#pending]); this.#records.clear(); }

  async #generate(request: OwnerWan27I2vGenerateInput, normalized: OwnerWan27I2vNormalizedParameters,
    d: AbsoluteRequestDeadline): Promise<OwnerWan27I2vGenerationResult> {
    const principal=await d.waitFor(resolveOwnerReferencePrincipal({binding:this.#binding,attemptId:request.attemptId,linkService:this.#links}));
    const reference=await d.waitFor(this.#references.resolveImage({attemptId:request.attemptId,model_id:MODEL_ID,image_handle:request.image_handle}));
    if(!sameGenerationPrincipal(principal,reference.principal)) fail("PRINCIPAL_NOT_LINKED");
    const captured=this.#references.withCapturedImage(reference,(client,image)=>({client,wire:buildOwnerWan27I2vWire(normalized.intent,{
      model_id:MODEL_ID,url:image.url,sha256:image.sha256,mime_type:image.mime_type,size:image.size,width:image.width,height:image.height})}));
    if(!isNativeWan27I2vClient(captured.client))fail("NATIVE_METHOD_UNAVAILABLE");
    const semantic=schemaHash({tenant_id:principal.tenant_id,subject_id:principal.subject_id,intent:captured.wire.intent_fingerprint});
    if(this.#claims.has(semantic)||CLAIMS.has(semantic)) fail("INTENT_ALREADY_CLAIMED");
    if(IN_FLIGHT.has(semantic)) fail("SERVICE_BUSY"); IN_FLIGHT.add(semantic);
    try {return await this.#submit(request,principal,reference,normalized,captured.client,captured.wire,semantic,d);}
    finally {IN_FLIGHT.delete(semantic);}
  }
  async #submit(request:OwnerWan27I2vGenerateInput,principal:Readonly<GenerationPrincipalRef>,reference:OwnerWan27I2vOwnedImage,
    normalized:OwnerWan27I2vNormalizedParameters,client:NativeWan27I2vClient,wire:OwnerWan27I2vWireCandidate,
    semantic:string,d:AbsoluteRequestDeadline):Promise<OwnerWan27I2vGenerationResult>{
    if(this.#records.size>=MAX_RECOVERIES) fail("CAPACITY_EXCEEDED");
    const recovery="wan27i2v_recovery_"+randomUUID(),token=Object.freeze({model_id:MODEL_ID});
    const op:Operation={request,principal,client,reference,normalized,wire,token,recovery,semantic,
      epoch:this.#epochs.get(request.attemptId)??0,phase:"PREPARING",ack:null,quoteAt:0,invalid:false,
      result:unknownResult(recovery,["NOT_DISPATCHED"])};
    this.#validate(op,false); await this.#preflight(op,d); this.#validate(op,true);
    this.#records.set(recovery,op); this.#claims.add(semantic); CLAIMS.add(semantic);
    try { op.chat=await d.waitFor(client.createOwnerWan27I2vChat({attemptId:request.attemptId,model_id:MODEL_ID,title:"owner-wan27-i2v-"+randomUUID()},d.signal)); }
    catch {op.result=unknownResult(recovery,["CHAT_CREATE_OUTCOME_UNKNOWN"]);return op.result;}
    if(!op.chat||!isOwnerWan27I2vChatContextForClient(client,op.chat,request.attemptId)) fail("CHAT_CONTEXT_INVALID");
    op.phase="READY"; registerOwnerWan27I2vOperation({client,token,attempt_id:request.attemptId,chat:op.chat,wire});
    await this.#preflight(op,d); this.#validate(op,true); d.throwIfAborted(); op.phase="POSTED";
    try {
      const ack=await d.waitFor(client.startOwnerWan27I2vOperation(token,d.signal));
      if(!ack||ack.chat_uuid!==op.chat.chat_uuid||typeof ack.message_id!=="string"||!ID.test(ack.message_id)||
          !bindOwnerWan27I2vAck(client,token,ack.message_id)) fail("OUTCOME_UNKNOWN");
      op.ack=ack.message_id;
    } catch {const t=readOwnerWan27I2vTransport(client,token);op.result=unknownResult(recovery,["GENERATION_OUTCOME_UNKNOWN",
      ...(t.status===undefined?[]:["GENERATION_HTTP_"+t.status]),...(t.code===undefined?[]:["GENERATION_TRANSPORT_"+t.code])]);return op.result;}
    return this.#collect(op,d);
  }
  async #preflight(op:Operation,d:AbsoluteRequestDeadline):Promise<void>{
    await this.#current(op,d);this.#validate(op,true);
    const read=this.#read(op.request.attemptId);if(!genuine(read,SyntxHttpClient,["getAccountBalance","getSubscription","getModelInfo"]))fail("PREFLIGHT_FAILED");
    const account=await d.waitFor(new AccountStatusService(read as SyntxHttpClient,()=>this.#time()).getAccountStatus(d.signal));
    const access=await d.waitFor(new ModelAccessService(this.#catalog,read as SyntxHttpClient,()=>this.#time()).getModelAccess(
      {model_id:MODEL_ID,cost_parameters:op.normalized.cost_parameters},d.signal));
    const now=this.#time();
    validateQuote(access,account,this.#catalog,now);op.quoteAt=Math.min(Date.parse(account.observed_at),Date.parse(access.observed_at));
    await this.#current(op,d);this.#validate(op,true);
  }
  async #current(op:Operation,d:AbsoluteRequestDeadline):Promise<void>{
    d.throwIfAborted();this.#validate(op,false);
    const p=await d.waitFor(resolveOwnerReferencePrincipal({binding:this.#binding,attemptId:op.request.attemptId,linkService:this.#links}));
    if(!sameGenerationPrincipal(p,op.principal))fail("PRINCIPAL_NOT_LINKED");d.throwIfAborted();this.#validate(op,false);
  }
  #validate(op:Operation,dispatch:boolean):void{
    if(this.#closed||op.invalid||(this.#epochs.get(op.request.attemptId)??0)!==op.epoch||
      this.#resolve(op.request.attemptId)!==op.client||!isNativeWan27I2vClient(op.client))fail("PRINCIPAL_NOT_LINKED");
    if(op.chat&&(!isOwnerWan27I2vChatContextForClient(op.client,op.chat,op.request.attemptId)||
      !op.client.isOwnerWan27I2vChat(op.chat,op.request.attemptId)))fail("CHAT_CONTEXT_INVALID");
    if(dispatch&&(!this.#references.isOwnedImage(op.reference)||op.reference.expires_at<=this.#time()||
      op.wire.source_profile_sha256!==getOwnerWan27I2vSourceProfile().source_sha256))fail("REFERENCE_EXPIRED");
    if(dispatch&&op.phase==="READY"&&(this.#time()<op.quoteAt||this.#time()-op.quoteAt>FRESH_MS))fail("PREFLIGHT_EXPIRED");
  }
  async #collect(op:Operation,d:AbsoluteRequestDeadline):Promise<OwnerWan27I2vGenerationResult>{
    try{
      await this.#current(op,d);const history=parseHistory(await d.waitFor(op.client.readOwnerWan27I2vHistory(op.token,d.signal)));
      if(history.messages.length!==history.total||history.messages.length>10)fail("HISTORY_INCOMPLETE");
      const ids=new Set<string>(),objectIds=new Set<string>(),chatIds=new Set<string>();
      for(const row of history.messages){chatIds.add(String(row.chat_id));if(ids.has(row.id))fail("HISTORY_BINDING_MISMATCH");ids.add(row.id);
        for(const object of row.message_object){if(typeof object.id!=="string"||!ID.test(object.id)||objectIds.has(object.id)||object.message_id!==row.id)fail("HISTORY_BINDING_MISMATCH");objectIds.add(object.id);}}
      if(chatIds.size>1)fail("HISTORY_BINDING_MISMATCH");
      const imageUrl=op.wire.wire.settings.file_urls[0]?.url;
      const owners=history.messages.filter(row=>row.author_id>0&&(!op.ack||row.id===op.ack)&&
        row.message_object.filter(x=>x.object_type==="text").length===1&&row.message_object.some(x=>x.object_type==="text"&&x.object_text===op.request.prompt)&&
        row.message_object.filter(x=>x.object_type==="image"||x.object_type==="first_frame").length===1&&
        row.message_object.some(x=>(x.object_type==="image"||x.object_type==="first_frame")&&x.model_type===MODEL_ID&&x.object_url===imageUrl));
      if(owners.length!==1||history.messages.filter(row=>row.author_id>0).length!==1||
        !bindOwnerWan27I2vOwnerEcho(op.client,op.token,owners[0]))fail("OWNER_ECHO_UNVERIFIED");
      const bots=history.messages.filter(row=>row.author_id===-1&&row.message_object.some(x=>x.object_type==="video"));
      if(!bots.length){op.result=unknownResult(op.recovery,["RESULT_PENDING_OR_UNVERIFIED"]);return op.result;}
      const artifacts:OwnerWan27I2vArtifact[]=[];
      for(const row of bots){if(row.message_object.length!==1)fail("RESULT_UNVERIFIED");
        const item=row.message_object[0];if(!item||item.object_type!=="video"||item.model_type!==MODEL_ID||item.completed!==true||
          typeof item.object_url!=="string"||!safeUrl(item.object_url))fail("RESULT_UNVERIFIED");
        const context=bindOwnerWan27I2vResultContext(op.client,op.token,row);if(!context)fail("RESULT_CONTEXT_INVALID");
        await this.#current(op,d);const detail=await d.waitFor(op.client.readOwnerWan27I2vResult(context,d.signal));
        if(!sameResult(detail,row))fail("RESULT_CHANGED");
        artifacts.push(Object.freeze({object_index:artifacts.length,message_object_id:String(item.id),object_type:"video",
          object_url:item.object_url,mime_type:mime(item.object_url),message_id:row.id,chat_uuid:op.chat!.chat_uuid,model_id:MODEL_ID}));}
      op.result=Object.freeze({...unknownResult(op.recovery,[]),status:"completed",observed_artifact_count:artifacts.length,
        artifacts:Object.freeze(artifacts)});return op.result;
    }catch{op.result=unknownResult(op.recovery,["OWNED_HISTORY_OR_RESULT_UNVERIFIED"]);return op.result;}
  }
  #run<T>(attempt:string,signal:AbortSignal|undefined,work:(d:AbsoluteRequestDeadline)=>Promise<T>):Promise<T>{
    if(this.#closed)return Promise.reject(new OwnerWan27I2vGenerationServiceError("SERVICE_CLOSED"));
    if(!ATTEMPT.test(attempt)||this.#pending.size>=MAX_PENDING)return Promise.reject(new OwnerWan27I2vGenerationServiceError("SERVICE_BUSY"));
    if(signal!==undefined&&(!(signal instanceof AbortSignal)||types.isProxy(signal)))return Promise.reject(new OwnerWan27I2vGenerationServiceError("INVALID_REQUEST"));
    const abort=new AbortController(),combined=signal?AbortSignal.any([signal,abort.signal]):abort.signal;
    const d=new AbsoluteRequestDeadline(this.#timeout,combined,()=>new OwnerWan27I2vGenerationServiceError("REQUEST_ABORTED"));
    const task=Promise.resolve().then(()=>work(d)).finally(()=>{d.close();this.#pending.delete(task);});this.#pending.add(task);return task;
  }
  #time():number{let n:unknown;try{n=this.#now();}catch{return fail("CLOCK_INVALID");}
    if(!Number.isSafeInteger(n)||(n as number)<this.#lastNow)return fail("CLOCK_INVALID");this.#lastNow=n as number;return n as number;}
}
Object.freeze(OwnerWan27I2vGenerationService.prototype);
export function isOwnerWan27I2vGenerationService(value:unknown):value is OwnerWan27I2vGenerationService{
  return !!value&&typeof value==="object"&&!types.isProxy(value)&&SERVICES.has(value)&&
    Object.getPrototypeOf(value)===OwnerWan27I2vGenerationService.prototype&&Object.isFrozen(value);
}
export function loadOwnerWan27I2vRuntimeCatalog(directory?:string):Readonly<{catalog:DiscoveryCatalogRepository}>{
  const catalog=new DiscoveryCatalogRepository(loadPublicCatalogVersion(OWNER_WAN27_I2V_CATALOG_VERSION,directory));assertCatalog(catalog,directory);return Object.freeze({catalog});
}
function assertCatalog(c:DiscoveryCatalogRepository,directory?:string):void{
  const fresh=new DiscoveryCatalogRepository(loadPublicCatalogVersion(OWNER_WAN27_I2V_CATALOG_VERSION,directory));
  const m=c.getModel(MODEL_ID);
  if(c.fetched_at!==fresh.fetched_at||schemaHash(c.source_hashes)!==schemaHash(fresh.source_hashes)||!m.active||
    m.id!==MODEL_ID||m.upstream_id!==MODEL_ID||m.ai_name!==AI_NAME||
    schemaHash([...(m.settings?.get_cost_params??[])].sort())!==schemaHash(["resolution","video_duration"])||
    m.settings?.uploadable!==true||!Array.isArray(m.settings.allowed_media_types)||!m.settings.allowed_media_types.includes("images")||
    !m.settings.file_count_limit||typeof m.settings.file_count_limit!=="object"||
    (m.settings.file_count_limit as Record<string,unknown>).images!==2)fail("MODEL_BINDING_MISMATCH");
}
function validateQuote(a:ModelAccessResult,b:AccountStatusResult,c:DiscoveryCatalogRepository,now:number):void{
  const expected=c.fetched_at+"."+c.source_hashes.models.slice(7,19),cost=a.discount_cost??a.cost;
  if(a.catalog_kind!=="OFFICIAL_PUBLIC_API_SNAPSHOT"||a.catalog_version!==expected||a.model_id!==MODEL_ID||a.model_type!==MODEL_ID||
    a.ai_name!==AI_NAME||a.account_read_live!==true||a.access!==true||a.parameters_redacted!==true||
    schemaHash([...a.parameter_keys].sort())!==schemaHash(["resolution","video_duration"])||!fresh(a.observed_at,now)||
    typeof cost!=="number"||!Number.isFinite(cost)||cost<0||!fresh(b.observed_at,now)||
    b.contract_evidence!==ACCOUNT_CONTRACT_EVIDENCE||b.source_build!==ACCOUNT_SOURCE_BUILD||b.balance.unit!=="tokens"||
    typeof b.balance.available!=="string"||b.subscription.active!==true||typeof b.subscription.plan_type!=="string"||
    !b.subscription.plan_type||b.subscription.plan_type.toUpperCase()==="FREE"||!decimalAtLeast(b.balance.available,String(cost)))fail("PREFLIGHT_FAILED");
}
function generateRequest(value:unknown):OwnerWan27I2vGenerateInput{
  const f=exact(value,["attemptId","model_id","prompt","resolution","aspect_ratio","video_duration","prompt_extend","shot_type",
    "audio_setting","seed","native_audio","rendering_speed","image_handle"]);
  if(typeof f.attemptId!=="string"||!ATTEMPT.test(f.attemptId)||typeof f.image_handle!=="string"||
    !/^wan27i2v_image_[0-9a-f-]{36}$/u.test(f.image_handle))fail("INVALID_REQUEST");
  const request={model_id:f.model_id,prompt:f.prompt,resolution:f.resolution,aspect_ratio:f.aspect_ratio,video_duration:f.video_duration,
    prompt_extend:f.prompt_extend,shot_type:f.shot_type,audio_setting:f.audio_setting,seed:f.seed,native_audio:f.native_audio,rendering_speed:f.rendering_speed};
  normalizeOwnerWan27I2vParameters(request);
  return Object.freeze({attemptId:f.attemptId,...request,image_handle:f.image_handle}) as OwnerWan27I2vGenerateInput;
}
function sourceInput(request:OwnerWan27I2vGenerateInput):OwnerWan27I2vInput{return Object.freeze({model_id:MODEL_ID,prompt:request.prompt,
  resolution:request.resolution as "720P",aspect_ratio:request.aspect_ratio as "1:1",video_duration:request.video_duration as 5,
  prompt_extend:false,shot_type:"single",audio_setting:"auto",seed:null,native_audio:false,rendering_speed:"basic"});}
function parseHistory(value: unknown): { messages: Array<{ id: string; chat_id: string | number; author_id: number; message_object: Array<Record<string, unknown>> }>; total: number } {
  if (!value || typeof value !== "object" || types.isProxy(value)) fail("HISTORY_UNVERIFIED");
  const source = value as Record<string, unknown>, page = source.pagination as Record<string, unknown>;
  if (!Array.isArray(source.messages) || !page || typeof page !== "object" || !Number.isSafeInteger(page.total_count) ||
      (page.total_count as number) < 0) fail("HISTORY_UNVERIFIED");
  const messages = source.messages.map(value => {
    if (!value || typeof value !== "object" || types.isProxy(value)) return fail("HISTORY_UNVERIFIED");
    const row = value as Record<string, unknown>;
    const id = normalizeProviderId(row.id), chatId = normalizeProviderId(row.chat_id);
    if (id === null || chatId === null ||
        !Number.isSafeInteger(row.author_id) || !Array.isArray(row.message_object) || row.message_object.length > 64) fail("HISTORY_UNVERIFIED");
    const messageObject = row.message_object.map(item => normalizeMessageObject(item));
    return { id, chat_id: chatId, author_id: row.author_id as number, message_object: messageObject };
  });
  return { messages, total: page.total_count as number };
}
function sameResult(a: unknown, b: unknown): boolean {
  if (!a || typeof a !== "object" || !b || typeof b !== "object") return false;
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  const xId = normalizeProviderId(x.id), yId = normalizeProviderId(y.id), xChat = normalizeProviderId(x.chat_id), yChat = normalizeProviderId(y.chat_id);
  if (xId === null || yId === null || xChat === null || yChat === null || xId !== yId || xChat !== yChat || x.author_id !== y.author_id) return false;
  try { return schemaHash(normalizeMessageObjects(x.message_object)) === schemaHash(normalizeMessageObjects(y.message_object)); }
  catch { return false; }
}
function normalizeProviderId(value: unknown): string | null {
  const id = typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : value;
  return typeof id === "string" && ID.test(id) ? id : null;
}
function normalizeMessageObjects(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length > 64) fail("RESULT_UNVERIFIED");
  return value.map(normalizeMessageObject);
}
function normalizeMessageObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("HISTORY_UNVERIFIED");
  const row = value as Record<string, unknown>, id = normalizeProviderId(row.id), messageId = normalizeProviderId(row.message_id);
  if (id === null || messageId === null) fail("HISTORY_UNVERIFIED");
  return { ...row, id, message_id: messageId };
}
function unknownResult(recovery:string,gaps:readonly string[]):OwnerWan27I2vGenerationResult{return Object.freeze({status:"outcome_unknown",
  recovery_id:recovery,model_id:MODEL_ID,status_semantics:"LOCAL_OBSERVED_AVAILABILITY_ONLY",provider_terminal_status:"UNPROVEN",
  backend_acceptance:"UNPROVEN",cost_cap_enforced:false,durability:"PROCESS_LOCAL_ONLY",observed_artifact_count:0,
  artifacts:Object.freeze([]),gaps:Object.freeze([...gaps])});}
function fresh(value:string,now:number):boolean{if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))return false;
  const at=Date.parse(value);return Number.isFinite(at)&&new Date(at).toISOString()===value&&at<=now&&now-at<=FRESH_MS;}
function decimalAtLeast(b:string,p:string):boolean{if(!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(b)||!/^\d+(?:\.\d+)?$/u.test(p))return false;
  const [bi,bf=""]=b.split("."),[pi,pf=""]=p.split("."),n=Math.max(bf.length,pf.length);
  return BigInt(bi!+bf.padEnd(n,"0"))>=BigInt(pi!+pf.padEnd(n,"0"));}
function mime(url:string):"video/mp4"|"video/quicktime"|null{try{const p=new URL(url).pathname.toLowerCase();
  return p.endsWith(".mp4")?"video/mp4":p.endsWith(".mov")?"video/quicktime":null;}catch{return null;}}
function safeUrl(url:string):boolean{try{const u=new URL(url);return u.protocol==="https:"&&(u.hostname==="syntx.ai"||u.hostname.endsWith(".syntx.ai"));}catch{return false;}}
function binding(value:unknown):Readonly<AuthBinding>{const f=exact(value,["tenant_id","subject"]);
  if(typeof f.tenant_id!=="string"||!f.tenant_id||typeof f.subject!=="string"||!f.subject)fail("INVALID_REQUEST");
  return Object.freeze({tenant_id:f.tenant_id,subject:f.subject});}
function genuine(value:unknown,ctor:{prototype:object},methods:readonly string[]):boolean{
  return !!value&&typeof value==="object"&&!types.isProxy(value)&&Object.getPrototypeOf(value)===ctor.prototype&&
    methods.every(k=>Reflect.get(value,k)===Reflect.get(ctor.prototype,k));}
function exact(value:unknown,required:readonly string[],optional:readonly string[]=[]):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value)||types.isProxy(value))fail("INVALID_REQUEST");
  const d=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(d);
  if(keys.some(k=>typeof k!=="string"||(!required.includes(k)&&!optional.includes(k))||!Object.hasOwn(d[k]!,"value")||
    d[k]!.enumerable!==true)||required.some(k=>!Object.hasOwn(d,k)))fail("INVALID_REQUEST");
  const out=Object.create(null) as Record<string,unknown>;for(const k of keys as string[])out[k]=d[k]!.value;return out;}
function isNativeWan27I2vClient(value:unknown):value is NativeWan27I2vClient {
  if(!value||typeof value!=="object"||types.isProxy(value)||Object.getPrototypeOf(value)!==SyntxChatHttpClient.prototype)return false;
  return [["createOwnerWan27I2vChat",NATIVE_CREATE],["isOwnerWan27I2vChat",NATIVE_IS_CHAT],
    ["invalidateOwnerWan27I2vChats",NATIVE_INVALIDATE],["startOwnerWan27I2vOperation",NATIVE_START],
    ["readOwnerWan27I2vHistory",NATIVE_HISTORY],["readOwnerWan27I2vResult",NATIVE_GET]]
    .every(([key,method])=>typeof method==="function"&&Reflect.get(value,String(key))===method&&
      Reflect.get(SyntxChatHttpClient.prototype,String(key))===method);
}
function bounded(value:unknown,min:number,max:number,fallback:number):number{if(value===undefined)return fallback;
  if(!Number.isSafeInteger(value)||(value as number)<min||(value as number)>max)return fail("INVALID_REQUEST");return value as number;}
function fail(code:string):never{throw new OwnerWan27I2vGenerationServiceError(code);}
