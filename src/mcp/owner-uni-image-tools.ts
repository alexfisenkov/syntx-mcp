import { types } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import {
  OWNER_UNI_IMAGE_GENERATION_ERROR_CODES,
  OWNER_UNI_IMAGE_GENERATION_HISTORY_REASONS,
  OWNER_UNI_IMAGE_GENERATION_PHASES,
  OWNER_UNI_IMAGE_GENERATION_RESULT_REASONS,
  OwnerUniImageGenerationServiceError,
  type OwnerUniImageGenerationService,
  type OwnerUniImageGenerationServiceErrorCode
} from "../application/owner-uni-image-generation-service.js";
import {
  getOwnerUniImageSourceParameters,
  normalizeOwnerUniImageParameters,
  OWNER_UNI_IMAGE_MODELS,
  type OwnerUniImageModel
} from "../application/owner-uni-image-parameters.js";
import {
  OwnerUniImageUploadServiceError,
  type OwnerUniImageUploadService,
  type OwnerUniImageUploadServiceErrorCode
} from "../application/owner-uni-image-upload-service.js";
import { OWNER_UNI_IMAGE_INPUT_POLICY } from "../application/owner-uni-image-input-validator.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const IMAGE_HANDLE = /^uni_image_[0-9a-f-]{36}$/u;
const RECOVERY_ID = /^uni_image_recovery_[0-9a-f-]{36}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MODELS = OWNER_UNI_IMAGE_MODELS;
const SOURCE = getOwnerUniImageSourceParameters();
const ASPECT_RATIOS = SOURCE.controls.aspect_ratio.values;
const MODES = SOURCE.controls.mode.values;
const MIMES = OWNER_UNI_IMAGE_INPUT_POLICY.accepted_mime_types;
const CANONICAL_MIMES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
const MAX_IMAGE_BYTES = OWNER_UNI_IMAGE_INPUT_POLICY.local_max_bytes;
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

export const SYNTX_UPLOAD_UNI_IMAGE_REFERENCE_TOOL_NAME = "syntx_upload_uni_image_reference" as const;
export const SYNTX_OWNER_GENERATE_UNI_IMAGE_TOOL_NAME = "syntx_owner_generate_uni_image" as const;
export const SYNTX_OWNER_RECONCILE_UNI_IMAGE_TOOL_NAME = "syntx_owner_reconcile_uni_image" as const;
export const SYNTX_OWNER_LIST_UNI_IMAGE_RECOVERIES_TOOL_NAME = "syntx_owner_list_uni_image_recoveries" as const;
export const OWNER_UNI_IMAGE_TOOL_NAMES = Object.freeze([
  SYNTX_UPLOAD_UNI_IMAGE_REFERENCE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_UNI_IMAGE_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_UNI_IMAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_UNI_IMAGE_RECOVERIES_TOOL_NAME
] as const);

export interface RegisterSyntxOwnerUniImageToolsOptions {
  readonly uploadService: Pick<OwnerUniImageUploadService, "upload">;
  readonly generationService: Pick<OwnerUniImageGenerationService, "generate" | "reconcile" | "listRecoveries">;
}

const attemptSchema = z.string().regex(ATTEMPT).describe("Exact linked owner attempt identifier.");
const imageHandleSchema = z.string().regex(IMAGE_HANDLE).describe("Opaque Uni reference handle bound to this owner attempt.");
const recoverySchema = z.string().regex(RECOVERY_ID).describe("Process-local recovery handle for the exact linked owner attempt.");
const base64Schema = z.string().min(4).max(MAX_BASE64_CHARS)
  .refine(isCanonicalBase64, "Image bytes must use canonical base64 and fit the local resource ceiling.")
  .describe("Canonical base64 image data; the 25 MiB ceiling is local resource protection, not a provider limit.");
const filenameSchema = z.string().min(1).max(255).refine(isSafeFilename, "Use a portable basename; paths are rejected.");

const uploadInputSchema = z.object({
  link_attempt_id: attemptSchema,
  variant: z.enum(MODELS),
  content_base64: base64Schema,
  filename: filenameSchema,
  mime_type: z.enum(MIMES)
}).strict().superRefine((input, context) => {
  const size = decodedBase64Length(input.content_base64);
  if (size < 1 || size > MAX_IMAGE_BYTES) {
    context.addIssue({ code: "custom", path: ["content_base64"], message: "Image bytes exceed the local resource ceiling." });
  }
});

const uni1ParametersSchema = z.object({
  aspect_ratio: z.enum(ASPECT_RATIOS), seed: z.number().int().min(0).max(2_147_483_647).nullable(), mode: z.enum(MODES)
}).strict();
const modifyParametersSchema = z.object({
  seed: z.number().int().min(0).max(2_147_483_647).nullable(), mode: z.enum(MODES)
}).strict();
const removeBackgroundParametersSchema = z.object({ invert_mask: z.boolean() }).strict();
const parametersSchema = z.union([uni1ParametersSchema, modifyParametersSchema, removeBackgroundParametersSchema]);

const generateInputSchema = z.object({
  link_attempt_id: attemptSchema,
  variant: z.enum(MODELS),
  prompt: z.string().max(6_000).describe("Preserve the explicit source-supported prompt; 6,000 UTF-16 units plus one per LF is a local input rule, not a provider limit."),
  parameters: parametersSchema,
  image_reference_handles: z.array(imageHandleSchema).max(9),
  main_image_reference_handle: imageHandleSchema.nullable()
}).strict().superRefine((input, context) => {
  const count = input.image_reference_handles.length;
  const bounds: Readonly<Record<OwnerUniImageModel, readonly [number, number]>> = {
    "uni-1": [0, 9], "uni-1.1-modify-image": [1, 8], "uni-1.1-remove-background": [1, 1]
  };
  const [minimum, maximum] = bounds[input.variant];
  if (count < minimum || count > maximum) {
    context.addIssue({ code: "custom", path: ["image_reference_handles"], message: "Reference count is outside the source-supported variant range." });
    return;
  }
  try {
    normalizeOwnerUniImageParameters({ variant: input.variant, prompt: input.prompt, parameters: input.parameters,
      image_reference_handles: input.image_reference_handles, main_image_reference_handle: input.main_image_reference_handle });
  } catch {
    context.addIssue({ code: "custom", path: ["parameters"], message: "Controls, prompt, or main-reference selection do not match the source-supported variant." });
  }
});

const reconcileInputSchema = z.object({ link_attempt_id: attemptSchema, recovery_id: recoverySchema }).strict();
const listRecoveriesInputSchema = z.object({ link_attempt_id: attemptSchema, limit: z.number().int().min(1).max(20).optional() }).strict();

const uploadOutputSchema = z.object({
  status: z.literal("uploaded"), reference_handle: imageHandleSchema, model_id: z.enum(MODELS),
  source_mime_type: z.enum(MIMES), mime_type: z.enum(CANONICAL_MIMES),
  width: z.number().int().positive().max(0xffff_ffff), height: z.number().int().positive().max(0xffff_ffff),
  size: z.number().int().positive().max(MAX_IMAGE_BYTES), sha256: z.string().regex(SHA256),
  expires_in_seconds: z.number().int().min(1).max(900), metadata_confidence: z.literal("CONTAINER_METADATA_ONLY"),
  size_limit_confidence: z.literal("LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT")
}).strict();

const diagnosticSchema = z.object({
  phase: z.enum(OWNER_UNI_IMAGE_GENERATION_PHASES), post_started: z.boolean(), echo_ack_known: z.boolean(),
  history_binding: z.enum(["NONE", "PENDING", "READY", "UNVERIFIED"]),
  history_binding_reason: z.enum(OWNER_UNI_IMAGE_GENERATION_HISTORY_REASONS).nullable(),
  history_get_calls: z.number().int().min(0).max(255), history_get_calls_saturated: z.boolean(),
  result_get_calls: z.number().int().min(0).max(255), result_get_calls_saturated: z.boolean(),
  result_status: z.enum(["NOT_READ", "PENDING", "PARTIAL", "COMPLETE", "UNVERIFIED"]),
  result_reason: z.enum(OWNER_UNI_IMAGE_GENERATION_RESULT_REASONS).nullable()
}).strict();
const artifactSchema = z.object({
  message_object_id: z.string().regex(SAFE_ID), message_id: z.string().regex(SAFE_ID),
  url: z.string().url().max(4_096).refine(isSafeUploadReferenceUrl),
  mime_type: z.enum(["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif", "image/bmp"]).nullable(),
  mime_source: z.enum(["URL_EXTENSION", "UNKNOWN"]), geometry_verified: z.literal(false)
}).strict().superRefine((artifact, context) => {
  if ((artifact.mime_type === null) !== (artifact.mime_source === "UNKNOWN")) {
    context.addIssue({ code: "custom", path: ["mime_source"], message: "MIME hint and source must be consistent." });
  }
});
const generationOutputSchema = z.object({
  status: z.literal("result_observed"), observation_status: z.enum(["COMPLETE", "PARTIAL", "PENDING", "UNVERIFIED"]),
  observation_reason: z.enum(OWNER_UNI_IMAGE_GENERATION_RESULT_REASONS).nullable(),
  namespace_confidence: z.literal("SOURCE_SHAPED_UNVERIFIED"), backend_acceptance: z.literal("UNPROVEN"),
  model_confidence: z.literal("PRIVATE_PROFILE_CONTEXT_NOT_PROVIDER_PROOF"),
  model_id: z.enum(MODELS), ai_name: z.literal("luma_image"), operation_id: z.literal("generate-image"),
  profile_id: z.string().min(1).max(160), profile_schema_hash: z.string().regex(SHA256),
  catalog_version: z.string().min(1).max(160), request_fingerprint: z.string().regex(SHA256), intent_fingerprint: z.string().regex(SHA256),
  reference_count: z.number().int().min(0).max(9),
  actual_result_count: z.number().int().min(0).max(64).describe("Objects observed in the exact current bot message, not a requested total or future provider count."),
  result_count_confidence: z.literal("OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL"), recovery_id: recoverySchema.nullable(),
  artifacts: z.array(artifactSchema).max(64)
}).strict();
const recoveryItemSchema = z.object({
  recovery_id: recoverySchema, created_at: z.iso.datetime(), model_id: z.enum(MODELS), status: z.literal("OUTCOME_UNKNOWN"),
  diagnostic: diagnosticSchema
}).strict();
const listRecoveriesOutputSchema = z.object({ recoveries: z.array(recoveryItemSchema).max(20) }).strict();

const UPLOAD_ERROR_CODES = ["INVALID_REQUEST", "INVALID_IMAGE_INPUT", "LOCAL_RESOURCE_LIMIT_EXCEEDED", "PRINCIPAL_NOT_LINKED",
  "PROFILE_BINDING_MISMATCH", "SERVICE_BUSY", "CAPACITY_EXCEEDED", "SERVICE_CLOSED", "CLOCK_INVALID", "REQUEST_ABORTED",
  "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED", "UPLOAD_IN_PROGRESS", "UPLOAD_REJECTED", "UPLOAD_OUTCOME_UNKNOWN"] as const;
type UploadCodeDifference = [Exclude<OwnerUniImageUploadServiceErrorCode, typeof UPLOAD_ERROR_CODES[number]>,
  Exclude<typeof UPLOAD_ERROR_CODES[number], OwnerUniImageUploadServiceErrorCode>];
const UPLOAD_CODES_EXACT: UploadCodeDifference extends [never, never] ? true : never = true;
void UPLOAD_CODES_EXACT;
const GENERATION_ERROR_CODES = OWNER_UNI_IMAGE_GENERATION_ERROR_CODES;
type GenerationCodeDifference = [Exclude<OwnerUniImageGenerationServiceErrorCode, typeof GENERATION_ERROR_CODES[number]>,
  Exclude<typeof GENERATION_ERROR_CODES[number], OwnerUniImageGenerationServiceErrorCode>];
const GENERATION_CODES_EXACT: GenerationCodeDifference extends [never, never] ? true : never = true;
void GENERATION_CODES_EXACT;
type ToolErrorCode = typeof UPLOAD_ERROR_CODES[number] | OwnerUniImageGenerationServiceErrorCode | "UPLOAD_FAILED" | "GENERATION_FAILED" | "RECOVERY_LIST_UNAVAILABLE";
const ERROR_MESSAGES: Readonly<Record<ToolErrorCode, string>> = Object.freeze({
  INVALID_REQUEST: "The owner Uni image request is invalid.", INVALID_IMAGE_INPUT: "Provide a supported Uni image with matching MIME and valid container metadata.",
  LOCAL_RESOURCE_LIMIT_EXCEEDED: "The image exceeds the local Uni input resource ceiling.", PRINCIPAL_NOT_LINKED: "The exact owner attempt is not linked.",
  PROFILE_BINDING_MISMATCH: "The selected Uni image profile does not match the pinned catalog.", SERVICE_BUSY: "The bounded Uni image service is busy; no automatic retry was performed.",
  CAPACITY_EXCEEDED: "The bounded Uni image service capacity is full.", SERVICE_CLOSED: "The owner Uni image service is closed.",
  CLOCK_INVALID: "The owner Uni operation could not verify its local clock.", REQUEST_ABORTED: "The upload was aborted; inspect its outcome before retrying.",
  REFERENCE_UNAVAILABLE: "A reference handle is unavailable for this exact attempt and variant.", REFERENCE_EXPIRED: "A reference handle expired or is no longer available.",
  UPLOAD_IN_PROGRESS: "An upload for this exact reference is already in progress.", UPLOAD_REJECTED: "The reference upload was rejected before a handle was issued.",
  UPLOAD_OUTCOME_UNKNOWN: "The upload outcome is unknown; do not repeat it automatically.", MODEL_BINDING_MISMATCH: "The selected Uni image model is unavailable in the pinned source catalog.",
  ASSET_UNAVAILABLE: "A validated owned image reference is unavailable for this exact attempt.",
  REFERENCE_ALREADY_CLAIMED: "This semantic Uni image intent is already claimed and cannot be replayed.", PREFLIGHT_FAILED: "Fresh account or model-access checks did not pass.",
  PRE_DISPATCH_FAILED: "Generation failed before dispatch.", OUTCOME_UNKNOWN: "Generation may have been dispatched; reconcile with the same recovery handle and do not retry.",
  RECOVERY_NOT_FOUND: "No matching process-local recovery record is available for this attempt.", UPLOAD_FAILED: "The Uni image upload failed safely.",
  GENERATION_FAILED: "Uni image generation could not be confirmed; inspect recovery state before retrying.",
  RECOVERY_LIST_UNAVAILABLE: "Uni image recovery handles are unavailable."
});

export const OWNER_UNI_IMAGE_TOOL_INPUT_SCHEMAS = Object.freeze({
  upload: uploadInputSchema, generate: generateInputSchema, reconcile: reconcileInputSchema, list_recoveries: listRecoveriesInputSchema
});
export const OWNER_UNI_IMAGE_TOOL_OUTPUT_SCHEMAS = Object.freeze({
  upload: uploadOutputSchema, generate: generationOutputSchema, reconcile: generationOutputSchema, list_recoveries: listRecoveriesOutputSchema
});

export function registerSyntxOwnerUniImageTools(server: McpServer, options: RegisterSyntxOwnerUniImageToolsOptions): void {
  server.registerTool(SYNTX_UPLOAD_UNI_IMAGE_REFERENCE_TOOL_NAME, {
    title: "Upload an owned Uni image reference",
    description: "Upload one locally validated image for the exact linked owner attempt. Returns an opaque handle; upload does not authorize generation.",
    inputSchema: uploadInputSchema, outputSchema: uploadOutputSchema,
    annotations: annotations("Upload Uni image reference", false, true, true)
  }, async (input, { signal }) => {
    const copied = snapshotSafeInput(input);
    if (copied === undefined) return errorResult(undefined, "INVALID_REQUEST", "UPLOAD_FAILED");
    const parsed = uploadInputSchema.safeParse(copied);
    if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST", "UPLOAD_FAILED");
    try {
      const receipt = await options.uploadService.upload({ attemptId: parsed.data.link_attempt_id, model_id: parsed.data.variant,
        content_base64: parsed.data.content_base64, filename: parsed.data.filename, mime_type: parsed.data.mime_type,
        ...(signal === undefined ? {} : { signal }) });
      return structured(parseSafeOutput(uploadOutputSchema, receipt));
    } catch (error) { return errorResult(error, "UPLOAD_FAILED", "UPLOAD_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_UNI_IMAGE_TOOL_NAME, {
    title: "Generate a Uni image",
    description: "Starts one source-bound Uni image generation after fresh account and model-access preflights. No output count is requested; COMPLETE observations cover only the exact current message. Unknown outcomes must be reconciled, never retried.",
    inputSchema: generateInputSchema, outputSchema: generationOutputSchema,
    annotations: annotations("Generate Uni image", false, true, true)
  }, async (input, { signal }) => {
    const copied = snapshotSafeInput(input);
    if (copied === undefined) return errorResult(undefined, "INVALID_REQUEST", "GENERATION_FAILED");
    const parsed = generateInputSchema.safeParse(copied);
    if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST", "GENERATION_FAILED");
    try {
      const result = await options.generationService.generate({ attemptId: parsed.data.link_attempt_id, variant: parsed.data.variant,
        prompt: parsed.data.prompt, parameters: parsed.data.parameters, image_reference_handles: parsed.data.image_reference_handles,
        main_image_reference_handle: parsed.data.main_image_reference_handle }, signal);
      return structured(parseSafeOutput(generationOutputSchema, result));
    } catch (error) { return errorResult(error, "GENERATION_FAILED", "GENERATION_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_UNI_IMAGE_TOOL_NAME, {
    title: "Reconcile a Uni image generation",
    description: "Read-only reconciliation for the exact attempt and recovery handle. It never starts another generation.",
    inputSchema: reconcileInputSchema, outputSchema: generationOutputSchema,
    annotations: annotations("Reconcile Uni image generation", true, false, true)
  }, async (input, { signal }) => {
    const copied = snapshotSafeInput(input);
    if (copied === undefined) return errorResult(undefined, "INVALID_REQUEST", "GENERATION_FAILED");
    const parsed = reconcileInputSchema.safeParse(copied);
    if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST", "GENERATION_FAILED");
    try {
      const result = await options.generationService.reconcile({ attemptId: parsed.data.link_attempt_id, recovery_id: parsed.data.recovery_id }, signal);
      return structured(parseSafeOutput(generationOutputSchema, result));
    } catch (error) { return errorResult(error, "GENERATION_FAILED", "GENERATION_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_LIST_UNI_IMAGE_RECOVERIES_TOOL_NAME, {
    title: "List Uni image recovery handles",
    description: "Lists bounded, process-local recovery diagnostics for the exact linked owner attempt without prompts, references, or artifact URLs.",
    inputSchema: listRecoveriesInputSchema, outputSchema: listRecoveriesOutputSchema,
    annotations: annotations("List Uni image recoveries", true, false, true)
  }, async (input) => {
    const copied = snapshotSafeInput(input);
    if (copied === undefined) return errorResult(undefined, "INVALID_REQUEST", "RECOVERY_LIST_UNAVAILABLE");
    const parsed = listRecoveriesInputSchema.safeParse(copied);
    if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST", "RECOVERY_LIST_UNAVAILABLE");
    try {
      const recoveries = await options.generationService.listRecoveries({ attemptId: parsed.data.link_attempt_id,
        ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }) });
      return structured(parseSafeOutput(listRecoveriesOutputSchema, { recoveries }));
    } catch (error) { return errorResult(error, "RECOVERY_LIST_UNAVAILABLE", "RECOVERY_LIST_UNAVAILABLE"); }
  });
}

function annotations(title: string, readOnly: boolean, destructive: boolean, openWorld: boolean) {
  return { title, readOnlyHint: readOnly, destructiveHint: destructive, idempotentHint: readOnly, openWorldHint: openWorld };
}
function structured(value: object): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> };
}
function errorResult(error: unknown, fallback: ToolErrorCode, operationFallback: ToolErrorCode): CallToolResult {
  let code = fallback;
  let recoveryId: string | undefined;
  let diagnostic: unknown;
  if (!isProxyObject(error) && error instanceof OwnerUniImageUploadServiceError) {
    const sourceCode = ownData(error, "code");
    if (typeof sourceCode === "string" && (UPLOAD_ERROR_CODES as readonly string[]).includes(sourceCode)) code = sourceCode as ToolErrorCode;
  } else if (!isProxyObject(error) && error instanceof OwnerUniImageGenerationServiceError) {
    const sourceCode = ownData(error, "code");
    if (typeof sourceCode === "string" && (GENERATION_ERROR_CODES as readonly string[]).includes(sourceCode)) {
      code = sourceCode as OwnerUniImageGenerationServiceErrorCode;
      if (sourceCode === "OUTCOME_UNKNOWN") {
        const candidateId = ownData(error, "recovery_id");
        if (typeof candidateId === "string" && RECOVERY_ID.test(candidateId)) recoveryId = candidateId;
        const copied = snapshotDiagnostic(ownData(error, "diagnostic"));
        const parsed = copied === undefined ? undefined : diagnosticSchema.safeParse(copied);
        if (parsed?.success) diagnostic = parsed.data;
      }
    }
  }
  const safeCode = (Object.keys(ERROR_MESSAGES) as ToolErrorCode[]).includes(code) ? code : operationFallback;
  const body = { error: { code: safeCode, message: ERROR_MESSAGES[safeCode],
    ...(safeCode === "OUTCOME_UNKNOWN" && recoveryId !== undefined ? { recovery_id: recoveryId } : {}),
    ...(safeCode === "OUTCOME_UNKNOWN" && diagnostic !== undefined ? { diagnostic } : {}) } };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] };
}
function ownData(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || types.isProxy(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}
function isProxyObject(value: unknown): boolean { return Boolean(value && typeof value === "object" && types.isProxy(value)); }
function snapshotDiagnostic(value: unknown): unknown {
  const allowed = ["phase", "post_started", "echo_ack_known", "history_binding", "history_binding_reason", "history_get_calls",
    "history_get_calls_saturated", "result_get_calls", "result_get_calls_saturated", "result_status", "result_reason"];
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== allowed.length || keys.some((key) => typeof key !== "string" || !allowed.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) return undefined;
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) output[key] = descriptors[key]!.value;
  return output;
}
function snapshotSafeInput(value: unknown): unknown {
  const seen = new WeakSet<object>(); const state = { nodes: 0 };
  const copy = (item: unknown, depth: number): unknown => {
    state.nodes += 1;
    if (depth > 8 || state.nodes > 4_096) throw new Error("UNSAFE_TOOL_DATA");
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "string") return item.length <= MAX_BASE64_CHARS ? item : (() => { throw new Error("UNSAFE_TOOL_DATA"); })();
    if (typeof item === "number") return Number.isFinite(item) ? item : (() => { throw new Error("UNSAFE_TOOL_DATA"); })();
    if (!item || typeof item !== "object" || types.isProxy(item) || seen.has(item)) throw new Error("UNSAFE_TOOL_DATA");
    seen.add(item);
    try {
      if (Array.isArray(item)) {
        if (Object.getPrototypeOf(item) !== Array.prototype || item.length > 1_024) throw new Error("UNSAFE_TOOL_DATA");
        const descriptors = Object.getOwnPropertyDescriptors(item); const keys = Reflect.ownKeys(descriptors);
        if (keys.length !== item.length + 1 || keys.some((key) => key !== "length" &&
            (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= item.length ||
             !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) throw new Error("UNSAFE_TOOL_DATA");
        return Array.from({ length: item.length }, (_, index) => {
          const descriptor = descriptors[String(index)];
          if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) throw new Error("UNSAFE_TOOL_DATA");
          return copy(descriptor.value, depth + 1);
        });
      }
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw new Error("UNSAFE_TOOL_DATA");
      const descriptors = Object.getOwnPropertyDescriptors(item); const keys = Reflect.ownKeys(descriptors);
      if (keys.length > 256 || keys.some((key) => typeof key !== "string" || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) throw new Error("UNSAFE_TOOL_DATA");
      const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of keys as string[]) output[key] = copy(descriptors[key]!.value, depth + 1);
      return output;
    } finally { seen.delete(item); }
  };
  try { return copy(value, 0); } catch { return undefined; }
}
function parseSafeOutput<T>(schema: z.ZodType<T>, value: unknown): T {
  const copied = snapshotSafeInput(value);
  if (copied === undefined) throw new Error("UNSAFE_SERVICE_OUTPUT");
  return schema.parse(copied);
}
function isSafeFilename(value: string): boolean {
  return value !== "." && value !== ".." && /^[^/\\\p{Cc}\p{Cf}\p{Cs}]{1,255}$/u.test(value) && Buffer.byteLength(value, "utf8") <= 255;
}
function decodedBase64Length(value: string): number {
  if (value.length === 0 || value.length % 4 !== 0) return 0;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}
function isCanonicalBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  let padding = 0;
  if (value.endsWith("==")) padding = 2;
  else if (value.endsWith("=")) padding = 1;
  const dataLength = value.length - padding;
  for (let index = 0; index < dataLength; index += 1) {
    const code = value.charCodeAt(index);
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 43 || code === 47)) return false;
  }
  for (let index = dataLength; index < value.length; index += 1) if (value.charCodeAt(index) !== 61) return false;
  if (padding === 2) return base64Index(value.charCodeAt(dataLength - 1)) % 16 === 0;
  if (padding === 1) return base64Index(value.charCodeAt(dataLength - 1)) % 4 === 0;
  return true;
}
function base64Index(code: number): number {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 97 + 26;
  if (code >= 48 && code <= 57) return code - 48 + 52;
  if (code === 43) return 62;
  if (code === 47) return 63;
  return -1;
}
