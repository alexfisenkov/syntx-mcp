import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OwnerCurrentVideoGenerationService } from "../application/owner-current-video-generation-service.js";
import { OWNER_FLUX3_CURRENT_SOURCE, type OwnerFlux3CurrentNormalizedInput, type OwnerFlux3CurrentIntent } from "../application/owner-flux3-current-intent.js";
import { advertisedUnionInputSchema } from "./advertised-input-schema.js";
import { ownerCurrentVideoAttemptSchema, registerOwnerCurrentVideoFamilyTools } from "./owner-current-video-generation-tools.js";

export const OWNER_FLUX3_CURRENT_TOOL_NAMES = ["syntx_owner_get_flux3_current_source", "syntx_owner_generate_flux3_current_video",
  "syntx_owner_get_flux3_current_result", "syntx_owner_list_flux3_current_recoveries"] as const;
export function registerOwnerFlux3CurrentTools(server: McpServer, options: { readonly service: OwnerCurrentVideoGenerationService<OwnerFlux3CurrentNormalizedInput, OwnerFlux3CurrentIntent> }) {
  const common = { link_attempt_id: ownerCurrentVideoAttemptSchema, prompt: z.string().min(1).max(35000), resolution: z.enum(["hd", "fhd"]), generate_audio: z.boolean() };
  const handle = z.string().regex(/^current_video_ref_[0-9a-f-]{36}$/u), image = z.object({ reference_handle: handle, role: z.literal("image") }).strict(),
    video = z.object({ reference_handle: handle, role: z.literal("video") }).strict();
  const schema = z.discriminatedUnion("model_id", [
    z.object({ ...common, model_id: z.literal("flux3_t2v"), video_duration: z.number().finite().min(5).max(20),
      aspect_ratio: z.enum(["auto", "21:9", "2:1", "16:9", "4:3", "1:1", "3:4", "9:16"]), references: z.array(z.never()).max(0).default([]) }).strict(),
    z.object({ ...common, model_id: z.literal("flux3_i2v"), video_duration: z.number().finite().min(5).max(20), references: z.array(image).min(1).max(10) }).strict(),
    z.object({ ...common, model_id: z.literal("flux3_v2v"), video_duration: z.number().finite().min(5).max(15), references: z.tuple([video]) }).strict()
  ]);
  registerOwnerCurrentVideoFamilyTools(server, { service: options.service, names: OWNER_FLUX3_CURRENT_TOOL_NAMES, title: "Flux3 current", source: OWNER_FLUX3_CURRENT_SOURCE,
    inputSchema: advertisedUnionInputSchema(schema), toRequest: ({ link_attempt_id, references, ...input }) => ({ attemptId: link_attempt_id, input, references }) });
}
