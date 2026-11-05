import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OwnerCurrentVideoGenerationService } from "../application/owner-current-video-generation-service.js";
import { OWNER_LUMA_CURRENT_SOURCE, type OwnerLumaCurrentIntent, type OwnerLumaCurrentNormalizedInput } from "../application/owner-luma-current-intent.js";
import { registerOwnerCurrentVideoFamilyTools, ownerCurrentVideoAttemptSchema } from "./owner-current-video-generation-tools.js";

export const OWNER_LUMA_CURRENT_TOOL_NAMES = Object.freeze(["syntx_owner_get_luma_current_source", "syntx_owner_generate_luma_current",
  "syntx_owner_get_luma_current_result", "syntx_owner_list_luma_current_recoveries"] as const);
export function registerSyntxOwnerLumaCurrentTools(server: McpServer, options: {
  readonly service: OwnerCurrentVideoGenerationService<OwnerLumaCurrentNormalizedInput, OwnerLumaCurrentIntent>;
}) {
  const schema = z.object({ link_attempt_id: ownerCurrentVideoAttemptSchema, model_id: z.literal("ray-3.14").default("ray-3.14"), prompt: z.string().max(5000).default(""),
    quality: z.enum(["360p", "540p", "720p", "1080p"]), video_duration: z.union([z.literal(5), z.literal(10)]),
    aspect_ratio: z.enum(["auto", "9:16", "3:4", "1:1", "4:3", "16:9", "21:9"]),
    references: z.array(z.object({ reference_handle: z.string().regex(/^current_video_ref_[0-9a-f-]{36}$/u), role: z.literal("image") }).strict()).max(2).default([])
      .describe("0 images derives text2video:5/10s and explicit ratio.1..2 images derives keyframes:5s and auto only; prompt optional only with2 images. Ordered image handles, not frame roles.") }).strict();
  registerOwnerCurrentVideoFamilyTools(server, { service: options.service, names: OWNER_LUMA_CURRENT_TOOL_NAMES, title: "LumaRay3.14", source: OWNER_LUMA_CURRENT_SOURCE,
    inputSchema: schema, toRequest: ({ link_attempt_id, references, ...input }) => ({ attemptId: link_attempt_id, input, references }) });
}
