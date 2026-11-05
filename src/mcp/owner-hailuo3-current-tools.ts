import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OwnerCurrentVideoGenerationService } from "../application/owner-current-video-generation-service.js";
import { OWNER_HAILUO3_CURRENT_SOURCE, type OwnerHailuo3CurrentIntent, type OwnerHailuo3CurrentNormalizedInput } from "../application/owner-hailuo3-current-intent.js";
import { registerOwnerCurrentVideoFamilyTools, ownerCurrentVideoAttemptSchema, ownerCurrentVideoReferenceSelectionSchema } from "./owner-current-video-generation-tools.js";

export const OWNER_HAILUO3_CURRENT_TOOL_NAMES = Object.freeze(["syntx_owner_get_hailuo3_current_source", "syntx_owner_generate_hailuo3_current",
  "syntx_owner_get_hailuo3_current_result", "syntx_owner_list_hailuo3_current_recoveries"] as const);
export function registerSyntxOwnerHailuo3CurrentTools(server: McpServer, options: {
  readonly service: OwnerCurrentVideoGenerationService<OwnerHailuo3CurrentNormalizedInput, OwnerHailuo3CurrentIntent>;
}) {
  const schema = z.object({ link_attempt_id: ownerCurrentVideoAttemptSchema, model_id: z.literal("hailuo-3.0").default("hailuo-3.0"),
    prompt: z.string().min(1).max(20000), mode: z.enum(["omni-references", "frames"]), resolution: z.enum(["768p", "2K"]),
    video_duration: z.number().finite().min(4).max(15), aspect_ratio: z.enum(["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]),
    references: z.array(ownerCurrentVideoReferenceSelectionSchema).max(12).default([]).describe("Omni≤12 total: image9/video3/audio3. Frames1..2: first_frame and/or last_frame, first before last. Last-only is valid. Frames requires auto ratio; omni requires an explicit ratio.") }).strict();
  registerOwnerCurrentVideoFamilyTools(server, { service: options.service, names: OWNER_HAILUO3_CURRENT_TOOL_NAMES, title: "Hailuo3", source: OWNER_HAILUO3_CURRENT_SOURCE,
    inputSchema: schema, toRequest: ({ link_attempt_id, references, ...input }) => ({ attemptId: link_attempt_id, input, references }) });
}
