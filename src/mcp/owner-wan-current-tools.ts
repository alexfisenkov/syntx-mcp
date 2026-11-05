import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OwnerCurrentVideoGenerationService } from "../application/owner-current-video-generation-service.js";
import { OWNER_WAN_CURRENT_SOURCE, type OwnerWanCurrentIntent, type OwnerWanCurrentNormalized } from "../application/owner-wan-current-intent.js";
import { registerOwnerCurrentVideoFamilyTools, ownerCurrentVideoAttemptSchema, ownerCurrentVideoReferenceSelectionSchema } from "./owner-current-video-generation-tools.js";

export const OWNER_WAN_CURRENT_TOOL_NAMES=Object.freeze(["syntx_owner_get_wan_current_source","syntx_owner_generate_wan_current",
 "syntx_owner_get_wan_current_result","syntx_owner_list_wan_current_recoveries"] as const);
export function registerOwnerWanCurrentTools(server:McpServer,options:{readonly service:OwnerCurrentVideoGenerationService<OwnerWanCurrentNormalized,OwnerWanCurrentIntent>}):void {
 const schema=z.object({link_attempt_id:ownerCurrentVideoAttemptSchema,model_id:z.enum(["wan_25_t2v_preview","wan_25_i2v_preview","wan_27_i2v","wan_27_r2v","wan_27_videoedit","wan_30_t2v",
   "wan_30_reference","wan_30_omni","wan_30_edit","wan_30_first_last_frame"]),prompt:z.string().min(1).max(20000),resolution:z.enum(["480P","720P","1080P"]),
  aspect_ratio:z.enum(["16:9","9:16","1:1","4:3","3:4","adaptive"]).optional(),video_duration:z.number().finite().min(0).max(30).optional(),
  duration_mode:z.enum(["preserve_input","custom"]).optional(),audio_setting:z.enum(["auto","origin"]).optional(),prompt_extend:z.boolean().describe("Must be true when a document/file reference is attached."),
  seed:z.number().int().min(0).max(2147483647).nullable(),native_audio:z.boolean().optional(),rendering_speed:z.enum(["basic","prime"]).optional(),
  references:z.array(ownerCurrentVideoReferenceSelectionSchema).max(50).default([]).describe("Ordered owned handles; WAN27 I2V first_frame or first_clip, optional last_frame, and audio only with first_frame. WAN30 frames first_frame then optional last_frame. WAN25/27 auxiliary audio follows main references.")}).strict();
 registerOwnerCurrentVideoFamilyTools(server,{service:options.service,names:OWNER_WAN_CURRENT_TOOL_NAMES,title:"WAN current",source:OWNER_WAN_CURRENT_SOURCE,inputSchema:schema,
  toRequest:({link_attempt_id,references,...input})=>({attemptId:link_attempt_id,input,references})});
}
