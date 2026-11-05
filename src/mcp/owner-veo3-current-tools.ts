import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OwnerCurrentVideoGenerationService } from "../application/owner-current-video-generation-service.js";
import { OWNER_VEO3_CURRENT_SOURCE, type OwnerVeo3CurrentIntent, type OwnerVeo3CurrentNormalizedInput } from "../application/owner-veo3-current-intent.js";
import { registerOwnerCurrentVideoFamilyTools, ownerCurrentVideoAttemptSchema } from "./owner-current-video-generation-tools.js";

export const OWNER_VEO3_CURRENT_TOOL_NAMES = Object.freeze(["syntx_owner_get_veo3_current_source", "syntx_owner_generate_veo3_current",
  "syntx_owner_get_veo3_current_result", "syntx_owner_list_veo3_current_recoveries"] as const);
export function registerSyntxOwnerVeo3CurrentTools(server: McpServer, options: {
  readonly service: OwnerCurrentVideoGenerationService<OwnerVeo3CurrentNormalizedInput, OwnerVeo3CurrentIntent>;
}) {
  const schema = z.object({ link_attempt_id: ownerCurrentVideoAttemptSchema, model_id: z.enum(["veo3", "veo3fast", "veo3fast_r"]), prompt: z.string().min(8).max(50000),
    type: z.enum(["text", "image", "references"]), aspect_ratio: z.enum(["16:9", "9:16"]), video_duration: z.literal(8), upscale: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    references: z.array(z.object({ reference_handle: z.string().regex(/^current_video_ref_[0-9a-f-]{36}$/u), role: z.literal("image") }).strict()).max(3).default([])
      .describe("text0 images; image1..2 for all3 models; references1..3 onlyfast/fast_r (notveo3). Bothratios remain selectable; enteringreferences merely resets16:9 once.") }).strict();
  registerOwnerCurrentVideoFamilyTools(server, { service: options.service, names: OWNER_VEO3_CURRENT_TOOL_NAMES, title: "Veo3Base", source: OWNER_VEO3_CURRENT_SOURCE,
    inputSchema: schema, toRequest: ({ link_attempt_id, references, ...input }) => ({ attemptId: link_attempt_id, input, references }) });
}
