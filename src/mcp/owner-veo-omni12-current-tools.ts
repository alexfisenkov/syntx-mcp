import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OwnerCurrentVideoGenerationService } from "../application/owner-current-video-generation-service.js";
import { OWNER_VEO_OMNI12_CURRENT_SOURCE, type OwnerVeoOmni12CurrentIntent,
  type OwnerVeoOmni12CurrentNormalized } from "../application/owner-veo-omni12-current-intent.js";
import { registerOwnerCurrentVideoFamilyTools, ownerCurrentVideoAttemptSchema,
  ownerCurrentVideoReferenceSelectionSchema } from "./owner-current-video-generation-tools.js";

export const OWNER_VEO_OMNI12_CURRENT_TOOL_NAMES = Object.freeze([
  "syntx_owner_get_veo_omni12_current_source",
  "syntx_owner_generate_veo_omni12_current",
  "syntx_owner_get_veo_omni12_current_result",
  "syntx_owner_list_veo_omni12_current_recoveries"
] as const);

export function registerSyntxOwnerVeoOmni12CurrentTools(server: McpServer, options: {
  readonly service: OwnerCurrentVideoGenerationService<OwnerVeoOmni12CurrentNormalized, OwnerVeoOmni12CurrentIntent>;
}): void {
  const inputSchema = z.object({
    link_attempt_id: ownerCurrentVideoAttemptSchema,
    model_id: z.literal("omni1.2"),
    type: z.enum(["text", "image", "references"]),
    prompt: z.string().min(8).max(50_000),
    aspect_ratio: z.enum(["16:9", "9:16"]),
    video_duration: z.number().int().min(3).max(15),
    upscale: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    references: z.array(ownerCurrentVideoReferenceSelectionSchema).max(7).default([])
      .describe("text: no references; image: first_frame and optional last_frame, or sole first_clip; references: 1..7 images or up to 5 images plus 1 video. Video roles and durations are checked against uploaded metadata.")
  }).strict();
  registerOwnerCurrentVideoFamilyTools(server, {
    service: options.service,
    names: OWNER_VEO_OMNI12_CURRENT_TOOL_NAMES,
    title: "Veo Omni Flash 1.2",
    source: OWNER_VEO_OMNI12_CURRENT_SOURCE,
    inputSchema,
    toRequest: ({ link_attempt_id, references, ...input }) => ({ attemptId: link_attempt_id, input, references })
  });
}
