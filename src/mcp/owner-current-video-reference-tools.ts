import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OwnerCurrentVideoReferenceError, OwnerCurrentVideoReferenceStore } from "../application/owner-current-video-reference-store.js";

export const SYNTX_OWNER_UPLOAD_CURRENT_VIDEO_REFERENCE = "syntx_owner_upload_current_video_reference" as const;
export const SYNTX_GET_CURRENT_VIDEO_REFERENCE_POLICY = "syntx_get_current_video_reference_policy" as const;
const model=z.enum(["seedance-2.0","seedance-2.5","seedance_pro","seedance_pro-fast","seedance-1.5-pro","hailuo-3.0","ray-3.14","veo3","veo3fast","veo3fast_r","flux3_t2v","flux3_i2v","flux3_v2v","wan_25_t2v_preview","wan_25_i2v_preview","wan_27_i2v","wan_27_r2v","wan_27_videoedit","wan_30_t2v","wan_30_reference","wan_30_omni","wan_30_edit","wan_30_first_last_frame"]);
const mime=z.enum(["image/jpeg","image/jpg","image/png","image/webp","image/bmp","image/gif","image/tiff","image/heic","image/heif","image/avif",
 "video/mp4","video/quicktime","audio/mpeg","audio/mp3","audio/wav","audio/x-wav","application/pdf","text/plain","text/markdown","application/msword",
 "application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
 "application/vnd.ms-powerpoint","application/vnd.openxmlformats-officedocument.presentationml.presentation"]);
const upload=z.object({link_attempt_id:z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u),model_id:model,filename:z.string().min(1).max(255),
 mime_type:mime,content_base64:z.string().min(4).max(Math.ceil(100*1024*1024/3)*4),
 trim:z.object({start_seconds:z.number().finite().nonnegative(),end_seconds:z.number().finite().positive()}).strict().optional()}).strict();
const output=z.object({status:z.literal("uploaded"),reference_handle:z.string().regex(/^current_video_ref_[0-9a-f-]{36}$/u),kind:z.enum(["image","video","audio","file"]),preparation:z.enum(["ORIGINAL_BYTES","USER_SELECTED_SEGMENT_LOCAL_TRANSCODE"]),
 mime_type:z.string().min(1).max(128),size:z.number().int().positive().max(100*1024*1024),sha256:z.string().regex(/^sha256:[a-f0-9]{64}$/u),width:z.number().int().positive().optional(),
 height:z.number().int().positive().optional(),duration_seconds:z.number().positive().optional(),expires_in_seconds:z.number().int().nonnegative().max(900)}).strict();
export function registerOwnerCurrentVideoReferenceTools(server:McpServer,store:OwnerCurrentVideoReferenceStore):void {
 if(!(store instanceof OwnerCurrentVideoReferenceStore))throw new Error("OWNER_CURRENT_VIDEO_REFERENCE_STORE_REQUIRED");
 server.registerTool(SYNTX_GET_CURRENT_VIDEO_REFERENCE_POLICY,{title:"Get current video reference policy",
  description:"Describes locally supported current video reference inputs; model-specific mode and count restrictions also apply.",
  inputSchema:z.object({}).strict(),outputSchema:z.object({models:z.array(model),image_types:z.array(z.string()),video_types:z.array(z.string()),audio_types:z.array(z.string()),
    documents:z.string(),local_max_bytes:z.number(),preparation:z.string(),provider_acceptance:z.literal("UNPROVEN")}).strict(),
  annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async()=>({content:[{type:"text",text:"Current local reference policy."}],structuredContent:{
   models:["seedance-2.0","seedance-2.5","seedance_pro","seedance_pro-fast","seedance-1.5-pro","hailuo-3.0","ray-3.14","veo3","veo3fast","veo3fast_r","flux3_t2v","flux3_i2v","flux3_v2v","wan_25_t2v_preview","wan_25_i2v_preview","wan_27_i2v","wan_27_r2v","wan_27_videoedit","wan_30_t2v","wan_30_reference","wan_30_omni","wan_30_edit","wan_30_first_last_frame"],
   image_types:["image/jpeg","image/png","image/webp","image/bmp","image/gif","image/tiff","image/heic","image/heif","image/avif"],video_types:["video/mp4","video/quicktime"],audio_types:["audio/mpeg","audio/wav"],
   documents:"WAN 3.0 Omni: PDF, UTF-8 text/Markdown, and structurally identified Office containers",local_max_bytes:100*1024*1024,
   preparation:"Image types vary by model; extra formats require codec support in the trusted local ffprobe. Optional video trim requires an operator-configured local ffmpeg.",provider_acceptance:"UNPROVEN"}}));
 server.registerTool(SYNTX_OWNER_UPLOAD_CURRENT_VIDEO_REFERENCE,{title:"Upload current video reference",
  description:"Uploads one locally validated owner-bound reference. Returns an opaque expiring handle; never pass a URL. Unknown upload outcomes are not retried.",
  inputSchema:upload,outputSchema:output,annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true}},async(input,{signal})=>{
   try{const result=await store.upload({attemptId:input.link_attempt_id,model_id:input.model_id,filename:input.filename,mime_type:input.mime_type,content_base64:input.content_base64,...(input.trim===undefined?{}:{trim:input.trim})},signal);
    return {content:[{type:"text" as const,text:"Reference uploaded."}],structuredContent:{...result}};
   }catch(error){const code=error instanceof OwnerCurrentVideoReferenceError?error.code:"INVALID_REQUEST";
    return {isError:true,content:[{type:"text" as const,text:JSON.stringify({error:{code,message:code==="UPLOAD_OUTCOME_UNKNOWN"?
      "Upload may have completed. Do not retry the same input blindly.":code==="PRINCIPAL_NOT_LINKED"?"Link the owner account before uploading.":
      code==="SERVICE_CLOSED"?"The reference service is closed.":"The local reference input or configuration is invalid."}})}]};}
  });
}
