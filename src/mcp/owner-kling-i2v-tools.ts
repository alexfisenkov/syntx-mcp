import { types } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { OWNER_KLING_I2V_IMAGE_INPUT_POLICY } from "../application/owner-kling-i2v-input-policy.js";
import {
  OwnerKlingI2VImageReferenceServiceError,
  type OwnerKlingI2VImageReferenceService
} from "../application/owner-kling-i2v-reference-service.js";
import {
  OwnerKlingI2vGenerationServiceError,
  type OwnerKlingI2vGenerationService
} from "../application/owner-kling-i2v-generation-service.js";
import type { OwnerKlingI2vVersion } from "../application/owner-kling-i2v-parameters.js";

export const SYNTX_OWNER_GET_KLING_I2V_PARAMETERS_TOOL_NAME = "syntx_owner_get_kling_i2v_parameters" as const;
export const SYNTX_OWNER_UPLOAD_KLING_I2V_IMAGE_TOOL_NAME = "syntx_owner_upload_kling_i2v_image" as const;
export const SYNTX_OWNER_GENERATE_KLING_I2V_VIDEO_TOOL_NAME = "syntx_owner_generate_kling_i2v_video" as const;
export const SYNTX_OWNER_RECONCILE_KLING_I2V_VIDEO_TOOL_NAME = "syntx_owner_reconcile_kling_i2v_video" as const;
export const SYNTX_OWNER_LIST_KLING_I2V_RECOVERIES_TOOL_NAME = "syntx_owner_list_kling_i2v_recoveries" as const;
export const OWNER_KLING_I2V_TOOL_NAMES = Object.freeze([
  SYNTX_OWNER_GET_KLING_I2V_PARAMETERS_TOOL_NAME,
  SYNTX_OWNER_UPLOAD_KLING_I2V_IMAGE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_KLING_I2V_VIDEO_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_KLING_I2V_VIDEO_TOOL_NAME,
  SYNTX_OWNER_LIST_KLING_I2V_RECOVERIES_TOOL_NAME
] as const);

const MODEL_ID = "kling_image2video" as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const IMAGE_HANDLE = /^kling_i2v_image_[0-9a-f-]{36}$/u;
const RECOVERY_ID = /^kling_i2v_generation_recovery_[0-9a-f-]{36}$/u;
const MAX_IMAGE_BYTES = OWNER_KLING_I2V_IMAGE_INPUT_POLICY.local_max_bytes;
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const VERSIONS = ["1.5", "1.6", "2.1-master", "2.5-turbo", "2.6", "3.0", "3.0-turbo"] as const;
const MODES = ["standart", "hd", "4K"] as const;
const PIN_VALUE_SCHEMA = z.union([z.string(), z.number().finite()]);
const sourceRecordSchema = z.record(z.string(), z.unknown());

const sourceOutputSchema = z.object({
  status: z.literal("CURRENT_1791904852_STATIC_I2V_SOURCE_PARAMETERS_ONLY"),
  model_id: z.literal(MODEL_ID), operation_id: z.literal("generate-video"), ai_name: z.literal("kling"),
  source_pins: z.record(z.string(), PIN_VALUE_SCHEMA), controls: sourceRecordSchema,
  settings: sourceRecordSchema, references: sourceRecordSchema, cost_projection: sourceRecordSchema, wire: sourceRecordSchema,
  effective_defaults: z.literal("UNKNOWN"), runtime_usable: z.literal(false), dispatch_allowed: z.literal(false),
  backend_acceptance: z.literal("UNPROVEN")
}).strict();

const attemptSchema = z.string().regex(ATTEMPT).describe("Exact currently linked owner attempt.");
const uploadInputSchema = z.object({
  link_attempt_id: attemptSchema,
  content_base64: z.string().min(4).max(MAX_BASE64_CHARS).regex(BASE64),
  filename: z.string().min(1).max(255),
  mime_type: z.enum(OWNER_KLING_I2V_IMAGE_INPUT_POLICY.mime_types)
}).strict();

const uploadOutputSchema = z.object({
  status: z.literal("uploaded"), image_handle: z.string().regex(IMAGE_HANDLE), model_id: z.literal(MODEL_ID),
  mime_type: z.enum(["image/jpeg", "image/png", "image/avif", "image/webp"]),
  size: z.number().int().min(1).max(MAX_IMAGE_BYTES), sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  width: z.number().int().min(300), height: z.number().int().min(300), expires_in_seconds: z.number().int().min(1).max(900),
  input_acceptance: z.literal("SOURCE_FORMAT_DECLARED_PROVIDER_ACCEPTANCE_UNVERIFIED")
}).strict();

const generateInputSchema = z.object({
  link_attempt_id: attemptSchema,
  image_handle: z.string().regex(IMAGE_HANDLE),
  model_id: z.literal(MODEL_ID),
  prompt: z.string().optional(),
  version: z.enum(VERSIONS),
  mode: z.enum(MODES),
  video_duration: z.number().int(),
  native_audio: z.boolean(),
  temperature: z.number().finite().min(0).max(1),
  multi_shots: z.literal(false).optional()
}).strict().superRefine((input, context) => {
  const version: OwnerKlingI2vVersion = input.version;
  if (version !== "3.0-turbo" && (!input.prompt || input.prompt.trim().length === 0)) {
    context.addIssue({ code: "custom", path: ["prompt"], message: "This Kling I2V version requires a nonblank prompt." });
  }
  if (version === "2.1-master" && input.mode !== "hd") {
    context.addIssue({ code: "custom", path: ["mode"], message: "Kling 2.1 Master supports hd mode only." });
  }
  if (input.mode === "4K" && version !== "3.0") {
    context.addIssue({ code: "custom", path: ["mode"], message: "4K mode is source-listed only for Kling 3.0." });
  }
  const durationAllowed = version === "3.0" || version === "3.0-turbo"
    ? Number.isSafeInteger(input.video_duration) && input.video_duration >= 3 && input.video_duration <= 15
    : input.video_duration === 5 || input.video_duration === 10;
  if (!durationAllowed) {
    context.addIssue({ code: "custom", path: ["video_duration"], message: "The selected Kling I2V version does not support this duration." });
  }
  if (input.native_audio && version !== "2.6" && version !== "3.0") {
    context.addIssue({ code: "custom", path: ["native_audio"], message: "Native audio is source-listed only for Kling 2.6 and 3.0." });
  }
  if (input.native_audio && version === "2.6" && input.mode !== "hd") {
    context.addIssue({ code: "custom", path: ["mode"], message: "Kling 2.6 native audio requires hd mode." });
  }
  if (Math.abs(input.temperature * 10 - Math.round(input.temperature * 10)) > 1e-9) {
    context.addIssue({ code: "custom", path: ["temperature"], message: "Temperature must use 0.1 increments." });
  }
  if (version === "3.0" ? input.multi_shots !== false : input.multi_shots !== undefined) {
    context.addIssue({ code: "custom", path: ["multi_shots"], message: "Only single-shot mode is supported; provide false only for version 3.0." });
  }
});

const diagnosticSchema = z.object({
  post_started: z.boolean(), ack_known: z.boolean(),
  history_get_calls: z.number().int().min(0).max(255), result_get_calls: z.number().int().min(0).max(255),
  gaps: z.array(z.enum(["POST_ACK_UNKNOWN", "HISTORY_UNVERIFIED", "RESULT_UNVERIFIED", "PRINCIPAL_CHANGED", "POLL_BUDGET_EXHAUSTED"])).max(16)
}).strict();
const artifactSchema = z.object({
  url: z.string().url().max(4_096).refine(isSafeUploadReferenceUrl), mime_type: z.literal("video/mp4").optional()
}).strict();
const generationOutputSchema = z.object({
  status: z.enum(["pending", "completed", "unverified"]),
  status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"), backend_acceptance: z.literal("UNPROVEN"),
  provider_terminal_status: z.literal("UNPROVEN"), model_id: z.literal(MODEL_ID),
  recovery_id: z.string().regex(RECOVERY_ID), observed_artifact_count: z.number().int().min(0).max(16),
  artifacts: z.array(artifactSchema).max(16), diagnostic: diagnosticSchema
}).strict();
const recoveryListOutputSchema = z.object({ recoveries: z.array(z.object({
  recovery_id: z.string().regex(RECOVERY_ID), created_at: z.iso.datetime(),
  status: z.enum(["pending", "completed", "unverified", "outcome_unknown"]),
  observed_artifact_count: z.number().int().min(0).max(16)
}).strict()).max(20) }).strict();

const reconcileInputSchema = z.object({ link_attempt_id: attemptSchema, recovery_id: z.string().regex(RECOVERY_ID) }).strict();
const listInputSchema = z.object({ link_attempt_id: attemptSchema, limit: z.number().int().min(1).max(20).optional() }).strict();

export interface RegisterSyntxOwnerKlingI2vToolsOptions {
  readonly referenceService: Pick<OwnerKlingI2VImageReferenceService, "upload">;
  readonly generationService: Pick<OwnerKlingI2vGenerationService,
    "getParametersSource" | "generate" | "reconcile" | "list">;
}

/** Adds owner-local Kling I2V source, owned upload, one-shot generation, and GET-only recovery tools. */
export function registerSyntxOwnerKlingI2vTools(server: McpServer, options: RegisterSyntxOwnerKlingI2vToolsOptions): void {
  server.registerTool(SYNTX_OWNER_GET_KLING_I2V_PARAMETERS_TOOL_NAME, {
    title: "Get Kling I2V parameters and source",
    description: "Returns pinned static Kling I2V form and wire evidence. Effective defaults, price, provider acceptance, and dispatch authority are unknown. This read-only tool does not read the linked account or contact SYNTX.",
    inputSchema: z.object({}).strict(), outputSchema: sourceOutputSchema,
    annotations: { title: "Get Kling I2V parameters and source", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (): Promise<CallToolResult> => {
    try { return structuredResult(sourceOutputSchema.parse(options.generationService.getParametersSource())); }
    catch { return unavailable("SOURCE_UNAVAILABLE", "The pinned Kling I2V source profile is unavailable."); }
  });

  server.registerTool(SYNTX_OWNER_UPLOAD_KLING_I2V_IMAGE_TOOL_NAME, {
    title: "Upload one Kling I2V image",
    description: "Uploads one caller-supplied image to the exact linked owner attempt and returns an opaque 15-minute image handle without its URL. Input bytes are checked against source formats and a 30 MiB local ceiling; the 300-pixel minimum sides come from container metadata, not decoded-pixel inspection. This does not prove provider acceptance. An ambiguous upload outcome must not be retried with the same image content.",
    inputSchema: uploadInputSchema, outputSchema: uploadOutputSchema,
    annotations: { title: "Upload one Kling I2V image", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const output = await options.referenceService.upload({ attemptId: input.link_attempt_id,
        content_base64: input.content_base64, filename: input.filename, mime_type: input.mime_type }, signal);
      return structuredResult(uploadOutputSchema.parse(output));
    } catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_KLING_I2V_VIDEO_TOOL_NAME, {
    title: "Generate one Kling I2V video",
    description: "Dispatches one non-idempotent owner Kling I2V request with an opaque image handle. Supply the exact model, version, mode, duration, native audio, version-appropriate prompt, and an explicit temperature for every version, including versions where the UI hides that control. Version 3.0 requires multi_shots=false; only one image is accepted. A fresh finite quote is checked in preflight but is not an enforceable spend cap, and provider acceptance is unproven. For an unknown outcome, do not retry; use GET-only reconciliation with the returned recovery id.",
    inputSchema: generateInputSchema, outputSchema: generationOutputSchema,
    annotations: { title: "Generate one Kling I2V video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const output = await options.generationService.generate({ attemptId: input.link_attempt_id, image_handle: input.image_handle,
        parameters: { model_id: MODEL_ID, prompt: input.prompt ?? "", reference_count: 1, version: input.version,
          mode: input.mode, video_duration: input.video_duration, native_audio: input.native_audio },
        controls: { temperature: input.temperature, ...(input.version === "3.0" ? { multi_shots: false } : {}) }
      }, signal);
      return structuredResult(generationOutputSchema.parse(output));
    } catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_KLING_I2V_VIDEO_TOOL_NAME, {
    title: "Reconcile one Kling I2V video (GET only)",
    description: "GET-only reconciliation for the same currently linked owner attempt and opaque Kling I2V recovery id. It never retries generation.",
    inputSchema: reconcileInputSchema, outputSchema: generationOutputSchema,
    annotations: { title: "Reconcile one Kling I2V video (GET only)", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const output = await options.generationService.reconcile({ attemptId: input.link_attempt_id, recovery_id: input.recovery_id }, signal);
      return structuredResult(generationOutputSchema.parse(output));
    } catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_LIST_KLING_I2V_RECOVERIES_TOOL_NAME, {
    title: "List Kling I2V recoveries",
    description: "Lists up to 20 process-local Kling I2V recovery handles for the exact linked owner attempt. This operation is read-only and does not retry generation.",
    inputSchema: listInputSchema, outputSchema: recoveryListOutputSchema,
    annotations: { title: "List Kling I2V recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const request = { attemptId: input.link_attempt_id, ...(input.limit === undefined ? {} : { limit: input.limit }) };
      return structuredResult(recoveryListOutputSchema.parse({ recoveries: await options.generationService.list(request, signal) }));
    } catch (error) { return safeError(error); }
  });
}

function structuredResult(output: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
}

function safeError(error: unknown): CallToolResult {
  if (types.isProxy(error)) return unavailable("KLING_I2V_UNAVAILABLE", "The Kling I2V operation could not be completed safely.");
  if (error instanceof OwnerKlingI2vGenerationServiceError) {
    const code = readDataCode(error, GENERATION_ERROR_CODES);
    if (!code) return unavailable("KLING_I2V_UNAVAILABLE", "The Kling I2V operation could not be completed safely.");
    const recoveryId = code === "OUTCOME_UNKNOWN" ? readDataRecoveryId(error) : undefined;
    return unavailable(code, generationErrorMessage(code), recoveryId);
  }
  if (error instanceof OwnerKlingI2VImageReferenceServiceError) {
    const code = readDataCode(error, REFERENCE_ERROR_CODES);
    if (!code) return unavailable("KLING_I2V_UNAVAILABLE", "The Kling I2V operation could not be completed safely.");
    return unavailable(code, referenceErrorMessage(code));
  }
  return unavailable("KLING_I2V_UNAVAILABLE", "The Kling I2V operation could not be completed safely.");
}

const GENERATION_ERROR_CODES = new Set([
  "INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH",
  "PREFLIGHT_FAILED", "INTENT_ALREADY_CLAIMED", "CHAT_CREATE_UNKNOWN", "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"
]);
const REFERENCE_ERROR_CODES = new Set([
  "INVALID_REQUEST", "PROFILE_BINDING_MISMATCH", "PRINCIPAL_NOT_LINKED", "REQUEST_ABORTED", "SERVICE_BUSY",
  "CAPACITY_EXCEEDED", "SERVICE_CLOSED", "UPLOAD_REJECTED", "UPLOAD_OUTCOME_UNKNOWN", "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED"
]);

function readDataCode(error: object, allowlist: ReadonlySet<string>): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  return descriptor && "value" in descriptor && typeof descriptor.value === "string" && allowlist.has(descriptor.value)
    ? descriptor.value : undefined;
}

function readDataRecoveryId(error: object): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(error, "recovery_id");
  return descriptor && "value" in descriptor && typeof descriptor.value === "string" && RECOVERY_ID.test(descriptor.value)
    ? descriptor.value : undefined;
}

function generationErrorMessage(code: string): string {
  if (code === "OUTCOME_UNKNOWN") return "The request may have been dispatched; do not retry. Use GET-only reconciliation with the same recovery id when supplied.";
  return "The owner Kling I2V request could not be completed safely.";
}

function referenceErrorMessage(code: string): string {
  if (code === "UPLOAD_OUTCOME_UNKNOWN") return "The image upload may have completed; do not retry with the same image content.";
  return "The owner Kling I2V image upload could not be completed safely.";
}

function unavailable(code: string, message: string, recoveryId?: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: {
    code, message, ...(recoveryId === undefined ? {} : { recovery_id: recoveryId })
  } }) }] };
}
