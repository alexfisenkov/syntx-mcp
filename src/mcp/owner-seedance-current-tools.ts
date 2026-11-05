import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { advertisedUnionInputSchema } from "./advertised-input-schema.js";
import { registerOwnerCurrentVideoFamilyTools, ownerCurrentVideoAttemptSchema as attempt,
  ownerCurrentVideoReferenceSelectionSchema as selection } from "./owner-current-video-generation-tools.js";
import type { OwnerCurrentVideoGenerationService } from "../application/owner-current-video-generation-service.js";
import { OWNER_SEEDANCE_CURRENT_SOURCE, type OwnerSeedanceCurrentNormalized, type OwnerSeedanceCurrentIntent } from "../application/owner-seedance-current-intent.js";

export const OWNER_SEEDANCE_CURRENT_TOOL_NAMES = Object.freeze(["syntx_owner_get_seedance_current_source", "syntx_owner_generate_seedance_current_video",
  "syntx_owner_get_seedance_current_result", "syntx_owner_list_seedance_current_recoveries"] as const);
export type OwnerSeedanceCurrentGenerationService = OwnerCurrentVideoGenerationService<OwnerSeedanceCurrentNormalized, OwnerSeedanceCurrentIntent>;
const ratios = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;
const base = { link_attempt_id: attempt, prompt: z.string().max(35000) };
const audio = z.boolean(), references = (maximum: number, minimum = 0) => z.array(selection.extend({ role: z.enum(["image", "video", "audio"]) })).min(minimum).max(maximum);
const frameReferences = z.union([z.tuple([selection.extend({ role: z.literal("first_frame") })]),
  z.tuple([selection.extend({ role: z.literal("first_frame") }), selection.extend({ role: z.literal("last_frame") })])]);
const duration25 = z.union([z.literal(0), z.number().finite().min(4).max(30)]);
const modern20 = (["mini", "fast", "pro"] as const).flatMap(version => {
  const common = { ...base, model_id: z.literal("seedance-2.0"), version: z.literal(version), generate_audio: audio,
    prompt: z.string().min(1).max(35000), resolution: z.enum(version === "pro" ? ["480p", "720p", "1080p", "4K"] : ["480p", "720p"]), video_duration: z.number().finite().min(4).max(15) };
  return [z.object({ ...common, mode: z.literal("omni-references"), aspect_ratio: z.enum(ratios), references: references(11) }).strict(),
    z.object({ ...common, mode: z.literal("frames"), references: frameReferences }).strict()];
});
const modern25 = { ...base, model_id: z.literal("seedance-2.5"), resolution: z.enum(["480p", "720p", "1080p"]), generate_audio: audio };
const older = { link_attempt_id: attempt, prompt: z.string().min(1).max(5000), resolution: z.enum(["480p", "720p", "1080p"]), aspect_ratio: z.enum(ratios) };
const canonical = z.union([
  ...modern20,
  z.object({ ...modern25, mode: z.literal("omni-references"), aspect_ratio: z.enum([...ratios, "adaptive"]), video_duration: duration25, references: references(50) }).strict(),
  z.object({ ...modern25, mode: z.literal("frames"), prompt: z.string().min(1).max(35000), video_duration: z.number().finite().min(4).max(30), references: frameReferences }).strict(),
  z.object({ ...modern25, mode: z.literal("extend"), video_duration: duration25, references: references(50, 1) }).strict(),
  z.object({ ...modern25, mode: z.literal("edit"), references: references(50, 1) }).strict(),
  z.object({ ...older, model_id: z.literal("seedance_pro"), video_duration: z.union([z.literal(5), z.literal(10)]),
    references: z.array(selection.extend({ role: z.literal("image") })).max(2).default([]) }).strict(),
  z.object({ ...older, model_id: z.literal("seedance_pro-fast"), aspect_ratio: z.enum(["16:9", "4:3", "1:1", "3:4", "9:16"]), video_duration: z.number().finite().min(5).max(12),
    references: z.array(selection.extend({ role: z.literal("image") })).max(1).default([]) }).strict(),
  z.object({ ...older, model_id: z.literal("seedance-1.5-pro"), resolution: z.literal("720p"), video_duration: z.number().finite().min(5).max(12),
    generate_audio: audio, camera_fixed: z.boolean(), references: z.array(selection.extend({ role: z.literal("image") })).max(2).default([]) }).strict()
]);
export function registerOwnerSeedanceCurrentTools(server: McpServer, options: { readonly service: OwnerSeedanceCurrentGenerationService }): void {
  registerOwnerCurrentVideoFamilyTools(server, { service: options.service, names: OWNER_SEEDANCE_CURRENT_TOOL_NAMES, title: "Seedance current T2V and references",
    source: OWNER_SEEDANCE_CURRENT_SOURCE, inputSchema: advertisedUnionInputSchema(canonical),
    toRequest(data) { const { link_attempt_id, references: selected, ...input } = data;
      return { attemptId: link_attempt_id, input, references: selected }; }
  });
}
