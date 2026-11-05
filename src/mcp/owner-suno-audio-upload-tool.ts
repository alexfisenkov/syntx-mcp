import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { isOwnerSunoGenerationService, OwnerSunoGenerationServiceError, type OwnerSunoGenerationService } from "../application/owner-suno-generation-service.js";
import { OwnerSunoAudioUploadError, SUNO_AUDIO_UPLOAD_SOURCE } from "../application/owner-suno-audio-reference-probe.js";

export const SYNTX_OWNER_UPLOAD_SUNO_AUDIO_TOOL_NAME = "syntx_owner_upload_suno_audio_reference" as const;
const inputSchema = z.object({
  link_attempt_id: z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u), model_id: z.enum(["V6", "V6_wild"]),
  filename: z.string().min(1).max(255), mime_type: z.enum(["audio/mpeg", "audio/mp3", "audio/wav"]),
  content_base64: z.string().min(24).max(Math.ceil(SUNO_AUDIO_UPLOAD_SOURCE.max_file_bytes / 3) * 4)
}).strict();
const outputSchema = z.object({ status: z.literal("uploaded"), source_kind: z.literal("UPLOADED_AUDIO"),
  track_handle: z.string().regex(/^track_[0-9a-f-]{36}$/u), model_id: z.enum(["V6", "V6_wild"]),
  mime_type: z.enum(["audio/mpeg", "audio/wav"]), size: z.number().int().min(16).max(26_214_400),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u), duration_seconds: z.number().positive().max(480),
  expires_in_seconds: z.number().int().min(1).max(900), provider_acceptance: z.literal("UNPROVEN") }).strict();
export function registerSyntxOwnerSunoAudioUploadTool(server: McpServer, service: OwnerSunoGenerationService): void {
  if (!isOwnerSunoGenerationService(service)) throw new Error("SUNO_UPLOAD_SERVICE_UNTRUSTED");
  server.registerTool(SYNTX_OWNER_UPLOAD_SUNO_AUDIO_TOOL_NAME, {
    title: "Upload owned Suno audio reference",
    description: "Uploads one locally probed MP3/WAV through the current Suno as-is upload branch. Returns an opaque owner/model-bound track_handle for cover/extend, with measured duration; it never accepts a URL or starts generation. An uncertain upload must not be retried. Provider acceptance is unproven.",
    inputSchema, outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return failure("INVALID_REQUEST");
    const { link_attempt_id: attemptId, ...request } = parsed.data;
    let receipt;
    try { receipt = await service.uploadAudioReference({ attemptId, request }, signal); }
    catch (error) {
      return failure(error instanceof OwnerSunoAudioUploadError || error instanceof OwnerSunoGenerationServiceError ? error.code : "PRE_DISPATCH_FAILED");
    }
    const output = outputSchema.safeParse(receipt);
    if (!output.success) return failure("UPLOAD_OUTCOME_UNKNOWN");
    return { content: [{ type: "text", text: JSON.stringify(output.data) }], structuredContent: output.data };
  });
}
function failure(code: string) {
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: { code,
    message: "The Suno audio reference is unavailable. An uncertain upload must never be replayed." } }) }] };
}
