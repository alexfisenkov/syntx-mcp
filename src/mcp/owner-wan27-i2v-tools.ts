import { types } from "node:util";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isOwnerWan27I2vGenerationService, type OwnerWan27I2vGenerationService } from "../application/owner-wan27-i2v-generation-service.js";
import { isOwnerWan27I2vReferenceService, type OwnerWan27I2vReferenceService } from "../application/owner-wan27-i2v-reference-service.js";
import { getOwnerWan27I2vSourceProfile } from "../application/owner-wan27-i2v-parameters.js";

const ATTEMPT = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const MODEL = z.literal("wan_27_i2v");
const HANDLE = z.string().regex(/^wan27i2v_image_[0-9a-f-]{36}$/u);
const RECOVERY = z.string().regex(/^wan27i2v_recovery_[0-9a-f-]{36}$/u);
const SOURCE_MIME = z.enum(["image/jpeg","image/jpg","image/png","image/bmp","image/webp"]);
const MAX_BYTES = 20 * 1024 * 1024, MAX_BASE64 = Math.ceil(MAX_BYTES / 3) * 4;
export const OWNER_WAN27_I2V_TOOL_NAMES = Object.freeze([
  "syntx_owner_get_wan27_i2v_parameters", "syntx_owner_upload_wan27_i2v_image",
  "syntx_owner_generate_wan27_i2v_video", "syntx_owner_reconcile_wan27_i2v_video",
  "syntx_owner_list_wan27_i2v_recoveries"
] as const);
export interface OwnerWan27I2vToolOptions {
  readonly referenceService: Pick<OwnerWan27I2vReferenceService,"uploadImage">;
  readonly generationService: Pick<OwnerWan27I2vGenerationService,"generate"|"reconcile"|"listRecoveries">;
}
const parameterInput = z.object({}).strict();
const sourceOutput = z.object({status:z.literal("EXPLICIT_SOURCE_CANDIDATE_ONLY"),model_id:MODEL,ai_name:z.literal("wan_video"),
  scope:z.literal("video"),source_profile_sha256:z.string().regex(/^[a-f0-9]{64}$/u),
  cost_query_keys:z.array(z.enum(["resolution","video_duration"])).length(2),
  dispatch_allowed:z.literal(false),provider_acceptance:z.literal("UNPROVEN"),
  source_gaps:z.array(z.string().max(160)).max(12)}).strict();
const uploadInput = z.object({link_attempt_id:ATTEMPT,model_id:MODEL,filename:z.string().min(1).max(255),
  mime_type:SOURCE_MIME,content_base64:z.string().min(4).max(MAX_BASE64)}).strict();
const uploadOutput = z.object({status:z.literal("uploaded"),model_id:MODEL,image_handle:HANDLE,filename:z.string().min(1).max(255),
  mime_type:z.enum(["image/jpeg","image/png","image/bmp","image/webp"]),size:z.number().int().positive().max(MAX_BYTES),
  sha256:z.string().regex(/^[a-f0-9]{64}$/u),width:z.number().int().positive(),height:z.number().int().positive(),
  expires_in_seconds:z.number().int().nonnegative(),metadata_confidence:z.literal("STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED"),
  provider_acceptance:z.literal("UNPROVEN"),generation_permit:z.literal(false)}).strict();
const generateInput = z.object({link_attempt_id:ATTEMPT,model_id:MODEL,image_handle:HANDLE,prompt:z.string().min(1).max(1500),
  resolution:z.literal("720P"),aspect_ratio:z.literal("1:1"),video_duration:z.literal(5),prompt_extend:z.literal(false),
  shot_type:z.literal("single"),audio_setting:z.literal("auto"),seed:z.null(),native_audio:z.literal(false),
  rendering_speed:z.literal("basic")}).strict();
const artifact = z.object({object_index:z.number().int().nonnegative(),message_object_id:z.string().min(1).max(160),
  object_type:z.literal("video"),object_url:z.string().url().max(4096),mime_type:z.enum(["video/mp4","video/quicktime"]).nullable(),
  message_id:z.string().min(1).max(160),chat_uuid:z.string().min(1).max(160),model_id:MODEL}).strict();
const generationOutput = z.object({status:z.enum(["completed","outcome_unknown"]),recovery_id:RECOVERY,model_id:MODEL,
  status_semantics:z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"),provider_terminal_status:z.literal("UNPROVEN"),
  backend_acceptance:z.literal("UNPROVEN"),cost_cap_enforced:z.literal(false),durability:z.literal("PROCESS_LOCAL_ONLY"),
  observed_artifact_count:z.number().int().nonnegative(),artifacts:z.array(artifact).max(64),gaps:z.array(z.string().max(160)).max(32)}).strict();
const listOutput = z.object({recoveries:z.array(generationOutput).max(128)}).strict();

export function registerSyntxOwnerWan27I2vTools(server:McpServer,input:OwnerWan27I2vToolOptions|unknown):void{
  const options=readOptions(input);
  server.registerTool(OWNER_WAN27_I2V_TOOL_NAMES[0],{title:"Get WAN 2.7 I2V initial candidate",
    description:"Returns the one explicit source-derived WAN27 I2V candidate and its evidence gaps; defaults and provider acceptance remain unproven.",
    inputSchema:parameterInput,outputSchema:sourceOutput,
    annotations:{title:"Get WAN 2.7 I2V candidate",readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
  },async()=>success(sourceOutput,projectSource()));
  server.registerTool(OWNER_WAN27_I2V_TOOL_NAMES[1],{title:"Upload one WAN 2.7 I2V image",
    description:"Uploads one validated owner image for the narrow WAN27 I2V candidate. Trusted runtime selects destination; upload URL is not returned.",
    inputSchema:uploadInput,outputSchema:uploadOutput,
    annotations:{title:"Upload WAN 2.7 I2V image",readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true}
  },async(raw,{signal})=>{
    let bytes:Buffer|undefined;
    try{const d=uploadInput.parse(snapshot(raw));bytes=strictBase64(d.content_base64);
      const v=await options.referenceService.uploadImage({attemptId:d.link_attempt_id,model_id:d.model_id,filename:d.filename,
        mime_type:d.mime_type,bytes},signal);return success(uploadOutput,v);}
    catch(error){return safeError(error);}finally{bytes?.fill(0);}
  });
  server.registerTool(OWNER_WAN27_I2V_TOOL_NAMES[2],{title:"Generate WAN 2.7 I2V video",
    description:"Submits one explicit WAN27 I2V candidate and one uploaded image. Unknown outcomes are sticky; never repeat generation.",
    inputSchema:generateInput,outputSchema:generationOutput,
    annotations:{title:"Generate WAN 2.7 I2V video",readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true}
  },async(raw,{signal})=>{
    try{const d=generateInput.parse(snapshot(raw));
      const result=await options.generationService.generate({attemptId:d.link_attempt_id,model_id:d.model_id,image_handle:d.image_handle,
        prompt:d.prompt,resolution:d.resolution,aspect_ratio:d.aspect_ratio,video_duration:d.video_duration,
        prompt_extend:d.prompt_extend,shot_type:d.shot_type,audio_setting:d.audio_setting,seed:d.seed,native_audio:d.native_audio,
        rendering_speed:d.rendering_speed},signal);return success(generationOutput,result);}
    catch(error){return safeError(error);}
  });
  server.registerTool(OWNER_WAN27_I2V_TOOL_NAMES[3],{title:"Reconcile WAN 2.7 I2V generation",
    description:"Reads only owned GET recovery routes and never creates a chat or repeats generation.",
    inputSchema:z.object({link_attempt_id:ATTEMPT,recovery_id:RECOVERY}).strict(),outputSchema:generationOutput,
    annotations:{title:"Reconcile WAN 2.7 I2V generation",readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}
  },async(raw,{signal})=>{try{const d=z.object({link_attempt_id:ATTEMPT,recovery_id:RECOVERY}).strict().parse(snapshot(raw));
    return success(generationOutput,await options.generationService.reconcile({attemptId:d.link_attempt_id,recovery_id:d.recovery_id},signal));}
    catch(error){return safeError(error);}});
  server.registerTool(OWNER_WAN27_I2V_TOOL_NAMES[4],{title:"List WAN 2.7 I2V recoveries",
    description:"Lists bounded same-owner recovery summaries without upload or generation.",
    inputSchema:z.object({link_attempt_id:ATTEMPT}).strict(),outputSchema:listOutput,
    annotations:{title:"List WAN 2.7 I2V recoveries",readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
  },async(raw,{signal})=>{try{const d=z.object({link_attempt_id:ATTEMPT}).strict().parse(snapshot(raw));
    return success(listOutput,{recoveries:await options.generationService.listRecoveries({attemptId:d.link_attempt_id},signal)});}
    catch(error){return safeError(error);}});
}
function projectSource(){
  const profile=getOwnerWan27I2vSourceProfile();
  return {status:"EXPLICIT_SOURCE_CANDIDATE_ONLY",model_id:profile.model_id,ai_name:profile.ai_name,scope:profile.scope,
    source_profile_sha256:profile.source_sha256,cost_query_keys:[...profile.cost_query_keys],dispatch_allowed:false,
    provider_acceptance:"UNPROVEN",source_gaps:[...profile.source_gaps]};
}
function readOptions(value:unknown):OwnerWan27I2vToolOptions{
  const row=snapshot(value) as Record<string,unknown>|undefined;
  if(!row||Object.keys(row).length!==2||!isOwnerWan27I2vReferenceService(row.referenceService)||
    !isOwnerWan27I2vGenerationService(row.generationService))throw new Error("INVALID_OWNER_WAN27_I2V_TOOL_OPTIONS");
  return Object.freeze({referenceService:row.referenceService,generationService:row.generationService});
}
function snapshot(value:unknown):unknown{
  if(!value||typeof value!=="object"||Array.isArray(value)||types.isProxy(value))return undefined;
  try{const p=Object.getPrototypeOf(value);if(p!==Object.prototype&&p!==null)return undefined;
    const d=Object.getOwnPropertyDescriptors(value),out=Object.create(null) as Record<string,unknown>;
    for(const k of Reflect.ownKeys(d)){if(typeof k!=="string"||!Object.hasOwn(d[k]!,"value")||d[k]!.enumerable!==true)return undefined;out[k]=d[k]!.value;}
    return out;}catch{return undefined;}
}
function strictBase64(s:string):Buffer{const b=Buffer.from(s,"base64");if(!b.length||b.length>MAX_BYTES||b.toString("base64")!==s){b.fill(0);throw new Error("INVALID_REQUEST");}return b;}
function success<T extends z.ZodType>(schema:T,value:unknown){
  const p=schema.safeParse(value);return p.success?{content:[{type:"text" as const,text:JSON.stringify(p.data)}],
    structuredContent:p.data as Record<string,unknown>}:errorResult("OUTPUT_INVALID");
}
function safeError(value:unknown){
  const allowed=new Set(["INVALID_REQUEST","INVALID_PARAMETERS","INVALID_IMAGE_INPUT","LOCAL_RESOURCE_LIMIT_EXCEEDED","PRINCIPAL_NOT_LINKED",
    "REQUEST_ABORTED","SERVICE_BUSY","CAPACITY_EXCEEDED","SERVICE_CLOSED","VALIDATION_REJECTED","UPLOAD_OUTCOME_UNKNOWN",
    "REFERENCE_UNAVAILABLE","REFERENCE_EXPIRED","PREFLIGHT_FAILED","PREFLIGHT_EXPIRED","MODEL_BINDING_MISMATCH",
    "BALANCE_INSUFFICIENT","INTENT_ALREADY_CLAIMED","OUTCOME_UNKNOWN","RECOVERY_NOT_FOUND","CHAT_CREATE_OUTCOME_UNKNOWN"]);
  let code="INVALID_REQUEST",recovery:string|undefined;
  if(value&&typeof value==="object"&&!types.isProxy(value)){const c=Object.getOwnPropertyDescriptor(value,"code");
    if(c&&Object.hasOwn(c,"value")&&typeof c.value==="string"&&allowed.has(c.value))code=c.value;
    const r=Object.getOwnPropertyDescriptor(value,"recovery_id");if(r&&typeof r.value==="string"&&RECOVERY.safeParse(r.value).success)recovery=r.value;}
  return errorResult(code,recovery);
}
function errorResult(code:string,recovery_id?:string){const message=code==="OUTCOME_UNKNOWN"?
  "Generation may have been dispatched. Do not retry; reconcile by GET only.":code==="UPLOAD_OUTCOME_UNKNOWN"?
  "Upload outcome may be unknown. Do not retry the upload.":"The owner WAN 2.7 I2V operation could not be completed safely.";
  return {isError:true,content:[{type:"text" as const,text:JSON.stringify({error:{code,message,...(recovery_id?{recovery_id}:{})}})}]};}
