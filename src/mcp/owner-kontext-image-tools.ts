import { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OwnerReferencePrincipalError } from "../auth/owner-reference-principal.js";
import {
  OwnerKontextImageGenerationServiceError,
  OWNER_KONTEXT_IMAGE_GENERATION_PHASES,
  type OwnerKontextImageGenerationService,
  type OwnerKontextImageUnknownDiagnostic
} from "../application/owner-kontext-image-generation-service.js";
import {
  OwnerKontextImageUploadServiceError,
  type OwnerKontextImageUploadService
} from "../application/owner-kontext-image-upload-service.js";
import { OWNER_KONTEXT_IMAGE_HISTORY_INVALID_REASONS } from "../application/owner-kontext-image-history-binding.js";
import { getOwnerKontextImageSourceParameters } from "../application/owner-kontext-image-parameters.js";

const ATTEMPT_ID_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const REFERENCE_HANDLE_PATTERN = /^kontext_image_[0-9a-f-]{36}$/u;
const RECOVERY_ID_PATTERN = /^kontext_recovery_[0-9a-f-]{36}$/u;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const SOURCE_PARAMETERS = getOwnerKontextImageSourceParameters();
const VARIANTS = SOURCE_PARAMETERS.variants;
const RESOLUTIONS = SOURCE_PARAMETERS.controls.resolution.values;
const LOCAL_NO_LORA = "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA" as const;
const RESULT_UNVERIFIED_REASONS = [
  "RESPONSE_SHAPE_INVALID", "OUTER_MESSAGE_MISMATCH", "PROVIDER_CHAT_MISMATCH", "NOT_BOT_MESSAGE",
  "RESULT_OBJECT_CARDINALITY_INVALID", "RESULT_OBJECT_SHAPE_INVALID", "OBJECT_ID_MISMATCH",
  "OBJECT_MESSAGE_MISMATCH", "OBJECT_TYPE_MISMATCH", "MODEL_TYPE_UNAVAILABLE", "MODEL_TYPE_MISMATCH",
  "RESULT_URL_UNSAFE", "RESULT_MIME_UNKNOWN"
] as const;
const RESULT_REASONS = ["NO_RESULT_OBJECTS", "RESULT_NOT_COMPLETED", ...RESULT_UNVERIFIED_REASONS] as const;
const CANONICAL_MIME_TYPES = ["image/jpeg", "image/png", "image/avif", "image/webp"] as const;
const ORIGINAL_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"] as const;
const UPLOAD_ERROR_CODES = [
  "INVALID_REQUEST", "INVALID_IMAGE_INPUT", "LOCAL_RESOURCE_LIMIT_EXCEEDED", "UNSUPPORTED_AVIF_COMPOSITION",
  "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH", "SERVICE_BUSY", "CAPACITY_EXCEEDED", "SERVICE_CLOSED",
  "REQUEST_ABORTED", "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED", "UPLOAD_REJECTED", "UPLOAD_OUTCOME_UNKNOWN"
] as const;
const GENERATION_ERROR_CODES = [
  "INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH",
  "REFERENCE_UNAVAILABLE", "REFERENCE_ALREADY_CLAIMED", "PREFLIGHT_FAILED", "PRE_DISPATCH_FAILED",
  "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"
] as const;
const PRINCIPAL_ERROR_CODES = ["REFERENCE_PRINCIPAL_NOT_LINKED", "REFERENCE_PRINCIPAL_INVALID"] as const;
const STANDARD_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export const SYNTX_UPLOAD_KONTEXT_REFERENCE_IMAGE_TOOL_NAME = "syntx_upload_kontext_reference_image" as const;
export const SYNTX_OWNER_GENERATE_KONTEXT_IMAGE_TOOL_NAME = "syntx_owner_generate_kontext_image" as const;
export const SYNTX_OWNER_RECONCILE_KONTEXT_IMAGE_TOOL_NAME = "syntx_owner_reconcile_kontext_image" as const;
export const SYNTX_OWNER_LIST_KONTEXT_RECOVERIES_TOOL_NAME = "syntx_owner_list_kontext_recoveries" as const;

const attemptIdSchema = z.string().regex(ATTEMPT_ID_PATTERN)
  .describe("Exact linked owner attempt; not an account or provider identifier.");
const variantSchema = z.enum(VARIANTS).describe("Explicit source-reviewed Flux Kontext variant.");
const referenceHandleSchema = z.string().regex(REFERENCE_HANDLE_PATTERN)
  .describe("Opaque uploaded reference handle bound to this exact attempt and variant.");
const recoveryIdSchema = z.string().regex(RECOVERY_ID_PATTERN)
  .describe("Opaque process-local recovery handle, usable only with the same linked attempt.");
const filenameSchema = z.string().refine(isSafePortableFilename,
  "Use a portable basename of at most 255 UTF-8 bytes.")
  .describe("Portable basename only; local paths and URL fields are not accepted. The 255-byte limit is a local portability rule.");
const promptSchema = z.string().refine(isValidPrompt,
  "Prompt must be nonblank, contain safe Unicode, and fit the local 65,536-byte UTF-8 resource guard.")
  .describe("Required, nonblank prompt; original whitespace is preserved. The UTF-8 limit is local, not a provider limit.");

const parametersSchema = z.object({
  resolution: z.enum(RESOLUTIONS).describe("Explicit requested output resolution."),
  cfg: z.number().min(SOURCE_PARAMETERS.controls.cfg.range.minimum).max(SOURCE_PARAMETERS.controls.cfg.range.maximum)
    .describe("Explicit finite CFG value; observed slider step is not required for manual input."),
  steps: z.number().min(SOURCE_PARAMETERS.controls.steps.range.minimum).max(SOURCE_PARAMETERS.controls.steps.range.maximum)
    .describe("Explicit finite step count; observed slider step is not an integer-only restriction."),
  image_strength: z.number().min(SOURCE_PARAMETERS.controls.image_strength.range.minimum)
    .max(SOURCE_PARAMETERS.controls.image_strength.range.maximum)
    .describe("Explicit finite image strength; observed slider step is not required for manual input.")
}).strict().describe("All four source controls are required; no defaults, cache fill, model, chat, URL, or dimension overrides.");

const uploadInputSchema = z.object({
  link_attempt_id: attemptIdSchema,
  variant: variantSchema,
  content_base64: z.string().min(4).max(MAX_BASE64_CHARS).regex(STANDARD_BASE64)
    .describe("Padded standard Base64 image bytes. Local resource guard is 10 MiB; it is not a provider limit."),
  filename: filenameSchema,
  mime_type: z.enum(ORIGINAL_MIME_TYPES)
}).strict();

const generateInputSchema = z.object({
  link_attempt_id: attemptIdSchema,
  variant: variantSchema,
  reference_handles: z.array(referenceHandleSchema).max(4),
  parameters: parametersSchema,
  workflow_policy: z.literal(LOCAL_NO_LORA),
  prompt: promptSchema
}).strict().superRefine((input, context) => {
  const minimum = input.variant === "flux-kontext-multi" ? 1 : 0;
  const maximum = input.variant === "flux-kontext-multi" ? 4 : 1;
  if (input.reference_handles.length < minimum || input.reference_handles.length > maximum) {
    context.addIssue({ code: "custom", path: ["reference_handles"], message: "Reference count is invalid for the selected variant." });
  }
  if (new Set(input.reference_handles).size !== input.reference_handles.length) {
    context.addIssue({ code: "custom", path: ["reference_handles"], message: "Reference handles must be unique." });
  }
});
const reconcileInputSchema = z.object({ link_attempt_id: attemptIdSchema, recovery_id: recoveryIdSchema }).strict();
const listInputSchema = z.object({ link_attempt_id: attemptIdSchema, limit: z.number().int().min(1).max(20).default(20) }).strict();

const uploadOutputSchema = z.object({
  status: z.literal("uploaded"),
  reference_handle: referenceHandleSchema,
  variant: variantSchema,
  original_mime_type: z.enum(ORIGINAL_MIME_TYPES),
  mime_type: z.enum(CANONICAL_MIME_TYPES),
  width: z.number().int().positive().max(0xffff_ffff),
  height: z.number().int().positive().max(0xffff_ffff),
  size: z.number().int().min(1).max(MAX_IMAGE_BYTES),
  sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  expires_in_seconds: z.number().int().min(1).max(900),
  metadata_confidence: z.literal("CONTAINER_METADATA_ONLY")
}).strict();

const inputImageSchema = z.object({
  mime_type: z.enum(CANONICAL_MIME_TYPES),
  width: z.number().int().positive().max(0xffff_ffff),
  height: z.number().int().positive().max(0xffff_ffff),
  size: z.number().int().min(1).max(MAX_IMAGE_BYTES),
  sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  metadata_confidence: z.literal("CONTAINER_METADATA_ONLY")
}).strict();

const generationOutputSchema = z.object({
  status: z.literal("result_observed"),
  backend_acceptance: z.literal("unproven"),
  ai_name: z.literal("flux"),
  model_id: variantSchema,
  variant: variantSchema,
  operation_id: z.literal("generate-image"),
  profile_id: z.literal("flux-kontext-source-reviewed-v1"),
  profile_schema_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  catalog_version: z.string().min(1).max(160),
  request_fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  parameters: parametersSchema,
  requested_resolution: z.enum(RESOLUTIONS),
  workflow_policy: z.literal(LOCAL_NO_LORA),
  reference_count: z.number().int().min(0).max(4),
  input_images: z.array(inputImageSchema).max(4),
  expected_output_geometry: z.null(),
  actual_image: z.object({
    mime_type: z.string().regex(/^image\/[a-z0-9.+-]{1,64}$/u),
    width: z.null(),
    height: z.null()
  }).strict(),
  geometry_verified: z.literal(false),
  artifact: z.object({
    url: z.string().url().refine(isHttpsUrl),
    mime_type: z.string().regex(/^image\/[a-z0-9.+-]{1,64}$/u),
    mime_source: z.literal("URL_EXTENSION")
  }).strict()
}).strict();

const diagnosticSchema = z.object({
  phase: z.enum(OWNER_KONTEXT_IMAGE_GENERATION_PHASES),
  post_started: z.boolean(),
  echo_ack_known: z.boolean(),
  history_binding: z.enum(["NONE", "PENDING", "READY", "INVALID"]),
  history_binding_reason: z.enum(OWNER_KONTEXT_IMAGE_HISTORY_INVALID_REASONS).nullable(),
  history_get_calls: z.number().int().min(0).max(99),
  history_get_calls_saturated: z.boolean(),
  inprogress_get_calls: z.number().int().min(0).max(99),
  inprogress_get_calls_saturated: z.boolean(),
  result_get_calls: z.number().int().min(0).max(99),
  result_get_calls_saturated: z.boolean(),
  result_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "UNVERIFIED"]),
  result_reason: z.enum(RESULT_REASONS).nullable(),
  model_eq_requested: z.boolean().optional(),
  model_eq_family: z.boolean().optional()
}).strict();

const recoveryListOutputSchema = z.object({
  recoveries: z.array(z.object({
    recovery_id: recoveryIdSchema,
    created_at: z.iso.datetime(),
    model_id: variantSchema,
    operation_id: z.literal("generate-image"),
    status: z.literal("OUTCOME_UNKNOWN"),
    diagnostic: diagnosticSchema
  }).strict()).max(20),
  confidence_scope: z.literal("process_local_get_only_recovery")
}).strict();

export interface RegisterSyntxOwnerKontextImageToolsOptions {
  readonly uploadService: Pick<OwnerKontextImageUploadService, "upload">;
  readonly generationService: Pick<OwnerKontextImageGenerationService, "generate" | "reconcile" | "listRecoveries">;
}

/** Register only under an explicit owner-local composition; default and HTTP servers omit it. */
export function registerSyntxOwnerKontextImageTools(
  server: import("@modelcontextprotocol/sdk/server/mcp.js").McpServer,
  options: RegisterSyntxOwnerKontextImageToolsOptions
): void {
  server.registerTool(SYNTX_UPLOAD_KONTEXT_REFERENCE_IMAGE_TOOL_NAME, {
    title: "Upload a reference image for Flux Kontext",
    description: "Upload one owner-provided JPEG, JPG, PNG, AVIF, or WebP image under an explicitly selected Flux Kontext variant. The local 10 MiB resource guard is not a provider limit; dimensions are container metadata only. Returns one opaque, attempt- and variant-bound reference handle. No local path or arbitrary URL is accepted.",
    inputSchema: uploadInputSchema,
    outputSchema: uploadOutputSchema,
    annotations: { title: "Upload a Flux Kontext reference image", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    const request = uploadInputSchema.safeParse(input);
    if (!request.success) return errorResult(undefined, "INVALID_REQUEST");
    try {
      const receipt = await options.uploadService.upload({
        attemptId: request.data.link_attempt_id,
        variant: request.data.variant,
        content_base64: request.data.content_base64,
        filename: request.data.filename,
        mime_type: request.data.mime_type,
        ...(signal === undefined ? {} : { signal })
      });
      return safeStructured(uploadOutputSchema.parse(receipt));
    } catch (error) {
      return errorResult(error, "UPLOAD_FAILED");
    }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_KONTEXT_IMAGE_TOOL_NAME, {
    title: "Generate an image with owner-authorized Flux Kontext",
    description: "Owner-authorized image generation that may incur provider cost. Request contract: one exact Flux Kontext variant, all four explicit source controls, a required prompt, explicit LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA policy value, and ordered opaque reference handles (0–1 for Pro/Max, 1–4 for Multi). Hidden values are never filled from cache/defaults; model, account, chat, URL, and dimensions are server-bound or excluded. Backend acceptance and output geometry remain unproven. OUTCOME_UNKNOWN means dispatch may have occurred and is not replayable; the same recovery handle is the only reconciliation scope.",
    inputSchema: generateInputSchema,
    outputSchema: generationOutputSchema,
    annotations: { title: "Generate an image with Flux Kontext", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    const request = generateInputSchema.safeParse(input);
    if (!request.success) return errorResult(undefined, "INVALID_REQUEST");
    try {
      const result = await options.generationService.generate({
        attemptId: request.data.link_attempt_id,
        variant: request.data.variant,
        reference_handles: request.data.reference_handles,
        parameters: request.data.parameters,
        workflow_policy: request.data.workflow_policy,
        prompt: request.data.prompt
      }, signal);
      return safeStructured(generationOutputSchema.parse(result));
    } catch (error) {
      return errorResult(error, "GENERATION_FAILED");
    }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_KONTEXT_IMAGE_TOOL_NAME, {
    title: "Reconcile a Flux Kontext image result",
    description: "GET-only reconciliation of one process-local recovery handle for the exact linked attempt. It does not upload, create a chat, preflight account or cost, dispatch, retry, cancel, or delete. Recovery is bounded to the current process and is not restart-safe.",
    inputSchema: reconcileInputSchema,
    outputSchema: generationOutputSchema,
    annotations: { title: "Reconcile a Flux Kontext image result", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    const request = reconcileInputSchema.safeParse(input);
    if (!request.success) return errorResult(undefined, "INVALID_REQUEST");
    try {
      const result = await options.generationService.reconcile({ attemptId: request.data.link_attempt_id, recovery_id: request.data.recovery_id }, signal);
      return safeStructured(generationOutputSchema.parse(result));
    } catch (error) {
      return errorResult(error, "OUTCOME_UNKNOWN");
    }
  });

  server.registerTool(SYNTX_OWNER_LIST_KONTEXT_RECOVERIES_TOOL_NAME, {
    title: "List Flux Kontext recovery handles",
    description: "Read up to 20 recent opaque recovery records for this exact linked attempt from bounded process-local memory. No provider request, auth refresh, chat-client resolution, or generation is performed.",
    inputSchema: listInputSchema,
    outputSchema: recoveryListOutputSchema,
    annotations: { title: "List Flux Kontext recovery handles", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input): Promise<CallToolResult> => {
    const request = listInputSchema.safeParse(input);
    if (!request.success) return errorResult(undefined, "INVALID_REQUEST");
    try {
      const recoveries = await options.generationService.listRecoveries({ attemptId: request.data.link_attempt_id, limit: request.data.limit });
      return safeStructured(recoveryListOutputSchema.parse({ recoveries, confidence_scope: "process_local_get_only_recovery" }));
    } catch (error) {
      return errorResult(error, "RECOVERY_LIST_UNAVAILABLE");
    }
  });
}

function safeStructured(value: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

function errorResult(error: unknown, fallback: string): CallToolResult {
  let code = fallback;
  let recoveryId: string | undefined;
  let diagnostic: OwnerKontextImageUnknownDiagnostic | undefined;
  if (error instanceof OwnerKontextImageUploadServiceError && UPLOAD_ERROR_CODES.includes(error.code)) code = error.code;
  else if (error instanceof OwnerKontextImageGenerationServiceError) {
    if (GENERATION_ERROR_CODES.includes(error.code)) code = error.code;
    if (code === "OUTCOME_UNKNOWN") {
      if (typeof error.recovery_id === "string" && RECOVERY_ID_PATTERN.test(error.recovery_id)) recoveryId = error.recovery_id;
      const parsed = diagnosticSchema.safeParse(error.diagnostic);
      if (parsed.success) diagnostic = parsed.data as OwnerKontextImageUnknownDiagnostic;
    }
  } else if (error instanceof OwnerReferencePrincipalError && PRINCIPAL_ERROR_CODES.includes(error.code)) code = error.code;

  const messages: Record<string, string> = {
    INVALID_REQUEST: "The owner Kontext image request is invalid.",
    INVALID_IMAGE_INPUT: "Provide a valid supported image with matching MIME and safe dimensions.",
    LOCAL_RESOURCE_LIMIT_EXCEEDED: "The image exceeds the local Kontext input resource guard.",
    UNSUPPORTED_AVIF_COMPOSITION: "This AVIF composition is not supported by the current local validator.",
    PRINCIPAL_NOT_LINKED: "The exact owner attempt is not linked.",
    REFERENCE_PRINCIPAL_NOT_LINKED: "The exact owner attempt is not linked.",
    REFERENCE_PRINCIPAL_INVALID: "The exact owner attempt is not linked.",
    MODEL_BINDING_MISMATCH: "The selected Kontext variant is unavailable in the pinned source catalog.",
    SERVICE_BUSY: "The owner Kontext service is at its safe concurrency limit; no automatic retry was performed.",
    CAPACITY_EXCEEDED: "The bounded owner Kontext service capacity is full.",
    SERVICE_CLOSED: "The owner Kontext service is closed.",
    REQUEST_ABORTED: "The upload was cancelled before completion.",
    REFERENCE_UNAVAILABLE: "The reference handle is unavailable for this exact attempt and variant.",
    REFERENCE_EXPIRED: "The reference handle expired or is no longer available.",
    REFERENCE_ALREADY_CLAIMED: "This reference handle has already been claimed and cannot be dispatched again.",
    UPLOAD_REJECTED: "The reference upload was rejected before a handle was issued.",
    UPLOAD_OUTCOME_UNKNOWN: "The upload outcome is unknown; do not upload it again automatically.",
    PREFLIGHT_FAILED: "Fresh subscription or model-access checks did not pass; this is not permission to retry generation.",
    PRE_DISPATCH_FAILED: "The generation request failed before dispatch.",
    OUTCOME_UNKNOWN: "Generation may have been dispatched; do not retry. Reconcile only with the known recovery handle.",
    GENERATION_FAILED: "The generation result could not be confirmed; do not repeat a call that may have been dispatched. Use a listed recovery handle if available.",
    RECOVERY_NOT_FOUND: "No matching process-local recovery record is available for this attempt.",
    RECOVERY_LIST_UNAVAILABLE: "Kontext recovery handles are unavailable."
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: {
      code,
      message: messages[code] ?? "The owner Kontext operation failed safely.",
      ...(recoveryId === undefined ? {} : { recovery_id: recoveryId }),
      ...(diagnostic === undefined ? {} : { diagnostic })
    } }) }]
  };
}

function isSafePortableFilename(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && value === value.trimEnd() && !value.endsWith(".") &&
    !/\p{Cc}/u.test(value) && !/[<>:"/\\|?*]/u.test(value) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(value) && isWellFormedUnicode(value) &&
    Buffer.byteLength(value, "utf8") <= 255;
}

function isValidPrompt(value: string): boolean {
  return value.trim().length > 0 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) &&
    isWellFormedUnicode(value) && Buffer.byteLength(value, "utf8") <= 65_536;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function isHttpsUrl(value: string): boolean {
  try { return new URL(value).protocol === "https:"; }
  catch { return false; }
}
