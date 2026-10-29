import { types } from "node:util";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isOwnerExistingVideoRecoveryService, type OwnerExistingVideoRecoveryService } from "../application/owner-existing-video-recovery-service.js";

const ATTEMPT = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const MODEL = z.enum(["dop-lite", "dop-turbo", "hailuo-2.3-fast", "hailuo-01-live-character", "hailuo-3.0", "kling_elements",
  "kling_o1_image2video", "kling_4_keyframes", "kling_4_omni", "acttwo", "wan_27_i2v", "gen4.5i2v", "seedance-2.5", "switchx"]);
export const OWNER_EXISTING_VIDEO_RESULT_TOOL_NAME = "syntx_owner_get_existing_video_recovery";
const targetSchema = z.object({ model_id: MODEL, chat_uuid: z.string().uuid(), owner_message_id: z.string().min(1).max(160),
  provider_message_id: z.string().min(1).max(160), expected_prompt: z.string().max(10_000) }).strict().superRefine((target, context) => {
    if (target.model_id === "acttwo" ? target.expected_prompt !== "" : target.expected_prompt.length === 0) {
      context.addIssue({ code: "custom", path: ["expected_prompt"], message: "The expected prompt shape is not supported for this model." });
    }
  });
const inputSchema = z.object({ link_attempt_id: ATTEMPT, targets: z.array(targetSchema).min(1).max(6) }).strict();
const artifactSchema = z.object({ object_url: z.string().url().max(4096), mime_type: z.enum(["video/mp4", "video/quicktime"]).nullable() }).strict();
const resultRowSchema = z.object({
  model_id: MODEL,
  status: z.enum(["video", "provider_error", "unverified"]),
  object_url: z.string().url().max(4096).optional(),
  mime_type: z.enum(["video/mp4", "video/quicktime"]).nullable().optional(),
  artifacts: z.array(artifactSchema).length(2).optional(),
  provider_error_code: z.literal("PROVIDER_ERROR_OBJECT_OBSERVED").optional(),
  proof: z.enum(["CURRENT_LINK_INDEX_HISTORY_DETAIL_BOUND", "UNVERIFIED"]),
  gaps: z.array(z.string().max(160)).max(8)
}).strict();
const outputSchema = z.object({
  status: z.enum(["complete", "partial"]),
  index_page: z.literal(1),
  index_page_size: z.literal(20),
  results: z.array(resultRowSchema).min(1).max(6),
  read_counts: z.object({ index_gets: z.literal(1), history_gets: z.number().int().min(0).max(6), detail_gets: z.number().int().min(0).max(6) }).strict(),
  provider_terminal_status: z.literal("UNPROVEN")
}).strict();
export interface OwnerExistingVideoRecoveryToolOptions { readonly recoveryService: OwnerExistingVideoRecoveryService }

export function registerOwnerExistingVideoResultTools(server: McpServer, input: unknown): void {
  const service = snapshotService(input);
  server.registerTool(OWNER_EXISTING_VIDEO_RESULT_TOOL_NAME, {
    title: "Read existing owner video jobs",
    description: "Reads up to six receipt-bound existing owner chats through the current index, exact message history, and result-detail GETs. Performs no upload or generation.",
    inputSchema,
    outputSchema,
    annotations: { title: "Read existing owner video results", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (raw, { signal }) => {
    try {
      const request = inputSchema.parse(copyDataRecord(raw));
      const read = await service.readExistingVideos({ attemptId: request.link_attempt_id, targets: request.targets }, signal);
      const rows = read.results.map(row => ({
        model_id: row.model_id,
        status: row.status === "video_available" ? "video" as const : row.status === "provider_error" ? "provider_error" as const : "unverified" as const,
        ...(row.object_url ? { object_url: row.object_url, mime_type: row.mime_type } : {}),
        ...(row.artifacts ? { artifacts: row.artifacts.map(item => ({ object_url: item.object_url, mime_type: item.mime_type })) } : {}),
        ...(row.provider_error_code ? { provider_error_code: row.provider_error_code } : {}),
        proof: row.proof,
        gaps: [...row.gaps]
      }));
      const result = outputSchema.safeParse({ status: read.status, index_page: read.index_page,
        index_page_size: read.index_page_size, results: rows, read_counts: read.read_counts, provider_terminal_status: read.provider_terminal_status });
      if (!result.success) return errorResult("OUTPUT_INVALID");
      return { content: [{ type: "text" as const, text: JSON.stringify(result.data) }], structuredContent: result.data };
    } catch (error) { return safeError(error); }
  });
}

function snapshotService(value: unknown): OwnerExistingVideoRecoveryService {
  const row = copyDataRecord(value) as Record<string, unknown> | undefined;
  if (!row || Object.keys(row).length !== 1 || !isOwnerExistingVideoRecoveryService(row.recoveryService)) throw new Error("INVALID_TOOL_OPTIONS");
  return row.recoveryService;
}
function copyDataRecord(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return undefined;
  try {
    const proto = Object.getPrototypeOf(value); if (proto !== Object.prototype && proto !== null) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value), result = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      const descriptor = typeof key === "string" ? descriptors[key] : undefined;
      if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) return undefined;
      result[key as string] = descriptor.value;
    }
    return result;
  } catch { return undefined; }
}
function safeError(error: unknown) {
  const allowed = new Set(["INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "INDEX_UNAVAILABLE",
    "NATIVE_METHOD_UNAVAILABLE", "REQUEST_ABORTED"]);
  let code = "INVALID_REQUEST";
  if (error && typeof error === "object" && !types.isProxy(error)) {
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    if (descriptor && Object.hasOwn(descriptor, "value") && typeof descriptor.value === "string" && allowed.has(descriptor.value)) code = descriptor.value;
  }
  return errorResult(code);
}
function errorResult(code: string) {
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: { code,
    message: "Existing owner video results could not be read safely. No generation or upload was attempted." } }) }] };
}
