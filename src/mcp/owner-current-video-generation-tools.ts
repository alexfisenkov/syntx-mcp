import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OwnerCurrentVideoGenerationService, OwnerCurrentVideoGenerationError, type OwnerCurrentVideoGenerateInput } from "../application/owner-current-video-generation-service.js";

const attempt = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u), recovery = z.string().regex(/^current_video_recovery_[0-9a-f-]{36}$/u);
const resultSchema = z.object({ status: z.enum(["pending", "completed", "unverified", "outcome_unknown"]), recovery_id: recovery, model_id: z.string(),
  source_binding: z.object({ profile_sha256: z.string(), source_pins: z.record(z.string(), z.string()), intent_fingerprint: z.string() }).strict(),
  parameters: z.record(z.string(), z.unknown()), artifacts: z.array(z.object({ url: z.string().url(), mime_type: z.string().nullable(), message_id: z.string(), message_object_id: z.string() }).strict()).max(64),
  diagnostic: z.object({ category: z.enum(["HTTP_REJECTED", "TRANSPORT_UNVERIFIED", "ACK_UNVERIFIED"]), http_status: z.number().int().min(100).max(599).optional() }).strict().optional(),
  phase: z.enum(["CHAT_CREATE_INVOKED", "CHAT_CREATED", "DISPATCH_INVOKED", "ACKNOWLEDGED", "OBSERVED"]), backend_acceptance: z.literal("UNPROVEN"), cost_cap_enforced: z.literal(false), durability: z.literal("PROCESS_LOCAL_ONLY") }).strict();
export const ownerCurrentVideoAttemptSchema = attempt;
export const ownerCurrentVideoReferenceSelectionSchema = z.object({ reference_handle: z.string().regex(/^current_video_ref_[0-9a-f-]{36}$/u),
  role: z.enum(["image", "video", "audio", "file", "first_frame", "last_frame", "first_clip"]) }).strict();

/** Presentation adapter only. The genuine closed app service remains the sole dispatch authority. */
export function registerOwnerCurrentVideoFamilyTools<T extends Record<string, unknown>>(server: McpServer, options: {
  readonly service: Pick<OwnerCurrentVideoGenerationService<any, any>, "generate" | "reconcile" | "listRecoveries">;
  readonly names: readonly [string, string, string, string]; readonly title: string; readonly source: Record<string, unknown>;
  readonly inputSchema: z.ZodType<T>; readonly toRequest: (input: T) => OwnerCurrentVideoGenerateInput;
}) {
  if (!(options.service instanceof OwnerCurrentVideoGenerationService) || !Object.isFrozen(options.service)) throw new Error("CURRENT_VIDEO_MCP_COMPOSITION_INVALID");
  const sourceOutput = z.object({ source: z.record(z.string(), z.unknown()), common_upload_tool: z.literal("syntx_owner_upload_current_video_reference") }).strict();
  server.registerTool(options.names[0], { title: `Get ${options.title} current source`, description: "Current pinned form controls and conditions, independently of account/provider acceptance or saved UI defaults.",
    inputSchema: z.object({}).strict(), outputSchema: sourceOutput, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async () => {
      const output = sourceOutput.parse({ source: options.source, common_upload_tool: "syntx_owner_upload_current_video_reference" }); return structured(output);
    });
  server.registerTool(options.names[1], { title: `Generate ${options.title} current video`, description: "Uses only same-owner/model current reference handles from the common upload tool. Validates exact current settings and all input roles, rechecks account/model access twice, then makes one dispatch. Unknown operations must use the read-only recovery id. Input handles expire15min; result recovery is process-local and can continue after input expiry. Source review does not prove vendor acceptance of every tuple; no spend cap is claimed.",
    inputSchema: options.inputSchema, outputSchema: resultSchema, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } }, async (input, extra): Promise<CallToolResult> => {
      try { return structured(resultSchema.parse(await options.service.generate(options.toRequest(input as T), extra.signal))); } catch (error) { return safeError(error); }
    });
  const recoveryInput = z.object({ link_attempt_id: attempt, recovery_id: recovery }).strict();
  server.registerTool(options.names[2], { title: `Get ${options.title} current result`, description: "GET-only owned result reconciliation. It never uploads, prepares expired inputs, requests a quote, creates a chat or repeats generation.",
    inputSchema: recoveryInput, outputSchema: resultSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } }, async (input, { signal }): Promise<CallToolResult> => {
      try { return structured(resultSchema.parse(await options.service.reconcile({ attemptId: input.link_attempt_id, recovery_id: input.recovery_id }, signal))); } catch (error) { return safeError(error); }
    });
  const listOutput = z.object({ recoveries: z.array(resultSchema).max(128) }).strict();
  server.registerTool(options.names[3], { title: `List ${options.title} current recoveries`, description: "Bounded process-local records for the exact owner link. Uncertain semantic claims survive unlink/relink in this process; restart is not durable recovery.",
    inputSchema: z.object({ link_attempt_id: attempt, limit: z.number().int().min(1).max(128).default(20) }).strict(), outputSchema: listOutput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async input => {
      try { return structured(listOutput.parse({ recoveries: await options.service.listRecoveries({ attemptId: input.link_attempt_id, limit: input.limit }) })); } catch (error) { return safeError(error); }
    });
}
function structured(value: Record<string, unknown>): CallToolResult {
  const content: CallToolResult["content"] = [{ type: "text", text: JSON.stringify(value) }];
  // Every artifact here has passed the genuine app's owned-result checks and the result schema above.
  if (value.status === "completed" && Array.isArray(value.artifacts)) {
    for (const [index, artifact] of (value.artifacts as Array<{ url: string; mime_type: string | null }>).entries()) {
      content.push({ type: "resource_link", uri: artifact.url, name: `video-${index + 1}`,
        ...(artifact.mime_type === null ? {} : { mimeType: artifact.mime_type }) });
    }
  }
  return { content, structuredContent: value };
}
function safeError(error: unknown): CallToolResult {
  const code = error instanceof OwnerCurrentVideoGenerationError ? error.code : "CURRENT_VIDEO_UNAVAILABLE";
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message: code === "OUTCOME_UNKNOWN"
    ? "The operation may have been accepted. Do not repeat it; use read-only recovery." : "The current video request could not be completed safely.",
    ...(error instanceof OwnerCurrentVideoGenerationError && error.recovery_id ? { recovery_id: error.recovery_id } : {}) } }) }] };
}
