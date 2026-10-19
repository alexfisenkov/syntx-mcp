import { types } from "node:util";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isOwnerHailuoInitialImageVault, type OwnerHailuoInitialImageVault } from "../application/owner-hailuo-initial-image-vault.js";
import { isOwnerHailuoInitialGenerationService, type OwnerHailuoInitialGenerationService } from "../application/owner-hailuo-initial-generation-service.js";

const ATTEMPT = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const RECOVERY = z.string().regex(/^hailuo_initial_recovery_[0-9a-f-]{36}$/u);
const MODEL = z.enum(["hailuo-2.3-fast", "hailuo-01-live-character", "hailuo-3.0"]);
const MIME = z.enum(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 10 * 1024 * 1024, MAX_BASE64 = Math.ceil(MAX_BYTES / 3) * 4;
export const OWNER_HAILUO_INITIAL_TOOL_NAMES = Object.freeze([
  "syntx_owner_upload_hailuo_initial_image", "syntx_owner_generate_hailuo_initial_video",
  "syntx_owner_get_hailuo_initial_result", "syntx_owner_list_hailuo_initial_recoveries"
] as const);
export interface OwnerHailuoInitialToolOptions {
  readonly imageVault: Pick<OwnerHailuoInitialImageVault, "uploadReference">;
  readonly generationService: Pick<OwnerHailuoInitialGenerationService, "generate" | "reconcile" | "listRecoveries">;
}
const uploadInput = z.object({ link_attempt_id: ATTEMPT, model_id: MODEL, filename: z.string().min(1).max(255),
  mime_type: MIME, content_base64: z.string().min(4).max(MAX_BASE64) }).strict();
const uploadOutput = z.object({ status: z.literal("uploaded"), reference_handle: z.string().regex(/^hailuo_initial_reference_[0-9a-f-]{36}$/u),
  model_id: MODEL, media_type: z.literal("image"), mime_type: MIME, size: z.number().int().positive().max(MAX_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u), width: z.number().int().positive(), height: z.number().int().positive(),
  expires_in_seconds: z.number().int().nonnegative(), metadata_confidence: z.literal("CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS"),
  provider_acceptance: z.literal("UNPROVEN"), upload_authority: z.literal(false), generation_permit: z.literal(false) }).strict();
const generateInput = z.object({ link_attempt_id: ATTEMPT, model_id: MODEL, prompt: z.string().min(1).max(1_000),
  resolution: z.string(), video_duration: z.number().int().positive(), aspect_ratio: z.string().optional(), mode: z.string().optional(),
  reference_handle: z.string().regex(/^hailuo_initial_reference_[0-9a-f-]{36}$/u) }).strict();
const artifact = z.object({ object_index: z.number().int().nonnegative(), message_object_id: z.string().min(1).max(160),
  object_type: z.literal("video"), object_url: z.string().url().max(4096), mime_type: z.enum(["video/mp4", "video/quicktime"]).nullable(),
  message_id: z.string().min(1).max(160), chat_uuid: z.string().min(1).max(160), model_id: MODEL }).strict();
const resultOutput = z.object({ status: z.enum(["completed", "outcome_unknown"]), recovery_id: RECOVERY, model_id: MODEL,
  status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"), provider_terminal_status: z.literal("UNPROVEN"),
  backend_acceptance: z.literal("UNPROVEN"), cost_cap_enforced: z.literal(false), durability: z.literal("PROCESS_LOCAL_ONLY"),
  observed_artifact_count: z.number().int().nonnegative(), artifacts: z.array(artifact).max(64), gaps: z.array(z.string().max(160)).max(32) }).strict();
const listOutput = z.object({ recoveries: z.array(resultOutput).max(128) }).strict();

export function registerSyntxOwnerHailuoInitialTools(server: McpServer, input: OwnerHailuoInitialToolOptions | unknown): void {
  const options = snapshotOptions(input);
  server.registerTool(OWNER_HAILUO_INITIAL_TOOL_NAMES[0], { title: "Upload one source-verified owner Hailuo image",
    description: "Validates and uploads one source-bound Hailuo image. The trusted runtime chooses destination; no upload URL is returned.",
    inputSchema: uploadInput, outputSchema: uploadOutput,
    annotations: { title: "Upload Hailuo image", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (raw, { signal }) => {
    let bytes: Buffer | undefined;
    try {
      const data = uploadInput.parse(snapshot(raw)); bytes = strictBase64(data.content_base64);
      const value = await options.imageVault.uploadReference({ attemptId: data.link_attempt_id, model_id: data.model_id,
        filename: data.filename, mime_type: data.mime_type, bytes }, signal);
      return success(uploadOutput, value);
    } catch (error) { return safeError(error); } finally { bytes?.fill(0); }
  });
  server.registerTool(OWNER_HAILUO_INITIAL_TOOL_NAMES[1], { title: "Generate one Hailuo video",
    description: "Uses one exact source-approved Hailuo tuple and one uploaded image. Uncertain POSTs are never retried.",
    inputSchema: generateInput, outputSchema: resultOutput,
    annotations: { title: "Generate Hailuo video", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (raw, { signal }) => {
    try {
      const data = generateInput.parse(snapshot(raw));
      const value = await options.generationService.generate({ attemptId: data.link_attempt_id, model_id: data.model_id,
        prompt: data.prompt, resolution: data.resolution, video_duration: data.video_duration,
        ...(data.aspect_ratio ? { aspect_ratio: data.aspect_ratio } : {}), ...(data.mode ? { mode: data.mode } : {}),
        reference_handle: data.reference_handle }, signal);
      return success(resultOutput, value);
    } catch (error) { return safeError(error); }
  });
  server.registerTool(OWNER_HAILUO_INITIAL_TOOL_NAMES[2], { title: "Get a Hailuo result",
    description: "Reconciles one process-local generation using owned GET reads only.",
    inputSchema: z.object({ link_attempt_id: ATTEMPT, recovery_id: RECOVERY }).strict(), outputSchema: resultOutput,
    annotations: { title: "Get Hailuo result", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (raw, { signal }) => {
    try { const data = z.object({ link_attempt_id: ATTEMPT, recovery_id: RECOVERY }).strict().parse(snapshot(raw));
      return success(resultOutput, await options.generationService.reconcile({ attemptId: data.link_attempt_id, recovery_id: data.recovery_id }, signal));
    } catch (error) { return safeError(error); }
  });
  server.registerTool(OWNER_HAILUO_INITIAL_TOOL_NAMES[3], { title: "List Hailuo recoveries",
    description: "Lists bounded process-local observations. This tool performs no upload or generation.",
    inputSchema: z.object({ link_attempt_id: ATTEMPT }).strict(), outputSchema: listOutput,
    annotations: { title: "List Hailuo recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async raw => {
    try { const data = z.object({ link_attempt_id: ATTEMPT }).strict().parse(snapshot(raw));
      return success(listOutput, { recoveries: await options.generationService.listRecoveries({ attemptId: data.link_attempt_id }) });
    } catch (error) { return safeError(error); }
  });
}
function snapshotOptions(value: unknown): OwnerHailuoInitialToolOptions {
  const fields = snapshot(value) as Record<string, unknown> | undefined;
  if (!fields || Object.keys(fields).length !== 2 || !isOwnerHailuoInitialImageVault(fields.imageVault) ||
      !isOwnerHailuoInitialGenerationService(fields.generationService)) throw new Error("INVALID_OWNER_HAILUO_INITIAL_TOOL_OPTIONS");
  return Object.freeze({ imageVault: fields.imageVault, generationService: fields.generationService });
}
function snapshot(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value); if (prototype !== Object.prototype && prototype !== null) return undefined;
    const d = Object.getOwnPropertyDescriptors(value), output = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(d)) { if (typeof key !== "string" || !Object.hasOwn(d[key]!, "value") || d[key]!.enumerable !== true) return undefined; output[key] = d[key]!.value; }
    return output;
  } catch { return undefined; }
}
function strictBase64(value: string): Buffer {
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > MAX_BYTES || bytes.toString("base64") !== value) { bytes.fill(0); throw new Error("INVALID_REQUEST"); }
  return bytes;
}
function success<T extends z.ZodType>(schema: T, value: unknown) {
  const parsed = schema.safeParse(value);
  return parsed.success ? { content: [{ type: "text" as const, text: JSON.stringify(parsed.data) }], structuredContent: parsed.data as Record<string, unknown> }
    : errorResult("OUTPUT_INVALID");
}
function safeError(error: unknown) {
  const allowed = new Set(["INVALID_REQUEST", "INVALID_PARAMETERS", "INVALID_IMAGE_INPUT", "LOCAL_RESOURCE_LIMIT_EXCEEDED",
    "PRINCIPAL_NOT_LINKED", "REQUEST_ABORTED", "SERVICE_BUSY", "CAPACITY_EXCEEDED", "SERVICE_CLOSED", "VALIDATION_REJECTED",
    "UPLOAD_OUTCOME_UNKNOWN", "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED", "PREFLIGHT_FAILED", "PREFLIGHT_EXPIRED",
    "MODEL_INACTIVE", "MODEL_BINDING_MISMATCH", "BALANCE_INSUFFICIENT", "INTENT_ALREADY_CLAIMED", "OUTCOME_UNKNOWN",
    "RECOVERY_NOT_FOUND", "CHAT_CREATE_FAILED", "RESULT_PENDING_OR_UNVERIFIED"]);
  let code = "INVALID_REQUEST";
  if (error && typeof error === "object" && !types.isProxy(error)) {
    const d = Object.getOwnPropertyDescriptor(error, "code");
    if (d && Object.hasOwn(d, "value") && typeof d.value === "string" && allowed.has(d.value)) code = d.value;
  }
  let recovery_id: string | undefined;
  if (error && typeof error === "object" && !types.isProxy(error)) {
    const d = Object.getOwnPropertyDescriptor(error, "recovery_id"); if (d && typeof d.value === "string" && RECOVERY.safeParse(d.value).success) recovery_id = d.value;
  }
  return errorResult(code, recovery_id);
}
function errorResult(code: string, recovery_id?: string) {
  const message = code === "OUTCOME_UNKNOWN" ? "Generation may have been dispatched. Do not retry; use the GET-only result tool."
    : code === "UPLOAD_OUTCOME_UNKNOWN" ? "Upload outcome may be unknown. Do not retry the upload."
      : "The owner Hailuo operation could not be completed safely.";
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message, ...(recovery_id ? { recovery_id } : {}) } }) }] };
}
