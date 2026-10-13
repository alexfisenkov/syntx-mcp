import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { OwnerReferencePrincipalError } from "../auth/owner-reference-principal.js";
import {
  OWNER_RUNWAY_IMAGE_GENERATION_ERROR_CODES,
  OWNER_RUNWAY_IMAGE_GENERATION_HISTORY_REASONS,
  OWNER_RUNWAY_IMAGE_GENERATION_PHASES,
  OWNER_RUNWAY_IMAGE_GENERATION_RESULT_REASONS,
  OwnerRunwayImageGenerationServiceError,
  type OwnerRunwayImageGenerationService
} from "../application/owner-runway-image-generation-service.js";
import { getOwnerRunwayImageSourceParameters } from "../application/owner-runway-image-parameters.js";
import {
  OwnerRunwayImageUploadServiceError,
  type OwnerRunwayImageUploadService
} from "../application/owner-runway-image-upload-service.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const REFERENCE = /^runway_image_[0-9a-f-]{36}$/u;
const RECOVERY = /^runway_image_recovery_[0-9a-f-]{36}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MAX_BASE64 = Math.ceil((32 * 1024 * 1024) / 3) * 4;
const SOURCE = getOwnerRunwayImageSourceParameters();
const VARIANTS = SOURCE.variants;
const RESOLUTIONS = SOURCE.parameters.resolution.values;
const INPUT_MIMES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif"] as const;
const OUTPUT_MIMES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
const VALIDATION_CONFIDENCES = [
  "JPEG_PNG_WEBP_STRUCTURAL_HEADER_ONLY;LOCAL_PROCESS_32MIB_RESOURCE_CEILING_NOT_PROVIDER_LIMIT",
  "AVIF_PRIMARY_ITEM_PROPERTY_ASSOCIATION_ONLY;LOCAL_PROCESS_32MIB_RESOURCE_CEILING_NOT_PROVIDER_LIMIT"
] as const;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export const SYNTX_UPLOAD_RUNWAY_IMAGE_REFERENCE_TOOL_NAME = "syntx_upload_runway_image_reference" as const;
export const SYNTX_OWNER_GENERATE_RUNWAY_IMAGE_TOOL_NAME = "syntx_owner_generate_runway_image" as const;
export const SYNTX_OWNER_RECONCILE_RUNWAY_IMAGE_TOOL_NAME = "syntx_owner_reconcile_runway_image" as const;
export const SYNTX_OWNER_LIST_RUNWAY_IMAGE_RECOVERIES_TOOL_NAME = "syntx_owner_list_runway_image_recoveries" as const;

export interface RegisterSyntxOwnerRunwayImageToolsOptions {
  readonly uploadService: Pick<OwnerRunwayImageUploadService, "upload">;
  readonly generationService: Pick<OwnerRunwayImageGenerationService, "generate" | "reconcile" | "listRecoveries">;
}

const attemptSchema = z.string().regex(ATTEMPT).describe("Exact linked owner attempt identifier.");
const referenceHandleSchema = z.string().regex(REFERENCE).describe("Opaque image reference handle for this attempt.");
const recoveryIdSchema = z.string().regex(RECOVERY).describe("Opaque recovery handle for this attempt.");
const variantSchema = z.enum(VARIANTS);
const parametersSchema = z.object({
  resolution: z.enum(RESOLUTIONS),
  temperature: z.number().finite().min(1).max(5)
}).strict();
const uploadInputSchema = z.object({
  link_attempt_id: attemptSchema,
  variant: variantSchema,
  content_base64: z.string().min(4).max(MAX_BASE64).regex(BASE64).describe("Standard padded Base64; 32 MiB is a local resource ceiling, not a provider limit."),
  filename: z.string().min(1).max(255).refine(isSafeFilename, "Use a portable basename; paths are rejected."),
  mime_type: z.enum(INPUT_MIMES)
}).strict();
const generateInputSchema = z.object({
  link_attempt_id: attemptSchema,
  variant: variantSchema,
  reference_handles: z.array(referenceHandleSchema).max(3),
  parameters: parametersSchema,
  prompt: z.string().min(1).max(65_536).refine(isValidPrompt, "Prompt must be nonblank and within the local input guard.")
}).strict().superRefine((value, context) => {
  if (new Set(value.reference_handles).size !== value.reference_handles.length) {
    context.addIssue({ code: "custom", path: ["reference_handles"], message: "Reference handles must be unique and ordered." });
  }
});
const reconcileInputSchema = z.object({ link_attempt_id: attemptSchema, recovery_id: recoveryIdSchema }).strict();
const listInputSchema = z.object({ link_attempt_id: attemptSchema, limit: z.number().int().min(1).max(20).default(20) }).strict();

const uploadOutputSchema = z.object({
  status: z.literal("uploaded"), reference_handle: referenceHandleSchema, variant: variantSchema,
  original_mime_type: z.enum(INPUT_MIMES), mime_type: z.enum(OUTPUT_MIMES),
  width: z.number().int().positive().max(0xffff_ffff), height: z.number().int().positive().max(0xffff_ffff),
  size: z.number().int().positive().max(32 * 1024 * 1024), sha256: z.string().regex(SHA256),
  expires_in_seconds: z.number().int().min(1).max(900), metadata_confidence: z.literal("CONTAINER_METADATA_ONLY"),
  validation_confidence: z.enum(VALIDATION_CONFIDENCES)
}).strict();
const diagnosticSchema = z.object({
  phase: z.enum(OWNER_RUNWAY_IMAGE_GENERATION_PHASES), post_started: z.boolean(), echo_ack_known: z.boolean(),
  history_binding: z.enum(["NONE", "PENDING", "READY", "INVALID"]),
  history_binding_reason: z.enum(OWNER_RUNWAY_IMAGE_GENERATION_HISTORY_REASONS).nullable(),
  history_get_calls: z.number().int().min(0).max(255), history_get_calls_saturated: z.boolean(),
  result_get_calls: z.number().int().min(0).max(255), result_get_calls_saturated: z.boolean(),
  result_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "UNVERIFIED"]),
  result_reason: z.enum(OWNER_RUNWAY_IMAGE_GENERATION_RESULT_REASONS).nullable()
}).strict();
const inputReferenceSchema = z.object({
  kind: z.literal("image"), mime_type: z.enum(OUTPUT_MIMES), width: z.number().int().positive().max(0xffff_ffff),
  height: z.number().int().positive().max(0xffff_ffff), size: z.number().int().positive().max(32 * 1024 * 1024),
  sha256: z.string().regex(SHA256), metadata_confidence: z.literal("CONTAINER_METADATA_ONLY")
}).strict();
const artifactSchema = z.object({
  url: z.string().url().max(4096).refine(isSafeHttpsUrl), mime_type: z.enum(OUTPUT_MIMES).nullable(), mime_source: z.enum(["URL_EXTENSION", "UNKNOWN"]),
  width: z.null(), height: z.null(), geometry_verified: z.literal(false)
}).strict().superRefine((artifact, context) => {
  if ((artifact.mime_type === null) !== (artifact.mime_source === "UNKNOWN")) {
    context.addIssue({ code: "custom", path: ["mime_source"], message: "MIME confidence must match the source evidence." });
  }
});
const generationOutputSchema = z.object({
  status: z.literal("result_observed"), backend_acceptance: z.literal("unproven"), ai_name: z.literal("runway-frames"),
  model_id: z.literal("runway_frames"), variant: z.literal("runway_frames"), operation_id: z.literal("generate-image"),
  profile_id: z.string().min(1).max(160), profile_schema_hash: z.string().regex(SHA256), catalog_version: z.string().min(1).max(160),
  request_fingerprint: z.string().regex(SHA256), parameters: parametersSchema, cost_inputs: z.object({}).strict(),
  cost_input_confidence: z.literal("SOURCE_JOINED_METADATA_KEYS_NONE_NOT_FREE_PRICE"), reference_count: z.number().int().min(0).max(3),
  input_references: z.array(inputReferenceSchema).max(3),
  actual_image: z.object({ mime_type: z.enum(OUTPUT_MIMES).nullable(), width: z.null(), height: z.null() }).strict(),
  geometry_verified: z.literal(false), artifact: artifactSchema
}).strict().superRefine((value, context) => {
  if (value.reference_count !== value.input_references.length) {
    context.addIssue({ code: "custom", path: ["reference_count"], message: "Reference count must match the exact returned metadata set." });
  }
  if (value.actual_image.mime_type !== value.artifact.mime_type) {
    context.addIssue({ code: "custom", path: ["actual_image", "mime_type"], message: "Actual image MIME must match the artifact MIME evidence." });
  }
});
const recoveryItemSchema = z.object({
  recovery_id: recoveryIdSchema, created_at: z.iso.datetime(), model_id: z.literal("runway_frames"),
  operation_id: z.literal("generate-image"), status: z.literal("OUTCOME_UNKNOWN"), diagnostic: diagnosticSchema
}).strict();
const recoveryListOutputSchema = z.object({ recoveries: z.array(recoveryItemSchema).max(20),
  confidence_scope: z.literal("process_local_get_only_recovery") }).strict();
const errorCodeSchema = z.enum([
  ...OWNER_RUNWAY_IMAGE_GENERATION_ERROR_CODES,
  "INVALID_IMAGE_INPUT", "LOCAL_RESOURCE_LIMIT_EXCEEDED", "UPLOAD_REJECTED", "UPLOAD_OUTCOME_UNKNOWN",
  "REFERENCE_PRINCIPAL_NOT_LINKED", "REFERENCE_PRINCIPAL_INVALID", "UPLOAD_FAILED", "GENERATION_FAILED", "RECOVERY_LIST_UNAVAILABLE"
]);

export function registerSyntxOwnerRunwayImageTools(
  server: McpServer,
  options: RegisterSyntxOwnerRunwayImageToolsOptions
): void {
  server.registerTool(SYNTX_UPLOAD_RUNWAY_IMAGE_REFERENCE_TOOL_NAME, {
    title: "Upload an owned Runway image reference",
    description: "Upload one validated image for the exact linked owner attempt. Returns a private opaque handle and bounded container metadata. Upload is not generation permission.",
    inputSchema: uploadInputSchema,
    outputSchema: uploadOutputSchema,
    annotations: annotations("Upload Runway image reference", false, true, false)
  }, async (input, { signal }) => {
    const parsed = uploadInputSchema.safeParse(input);
    if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST");
    try {
      const receipt = await options.uploadService.upload({ attemptId: parsed.data.link_attempt_id, variant: parsed.data.variant,
        content_base64: parsed.data.content_base64, filename: parsed.data.filename, mime_type: parsed.data.mime_type,
        ...(signal === undefined ? {} : { signal }) });
      return structured(uploadOutputSchema.parse(receipt));
    } catch (error) { return errorResult(error, "UPLOAD_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_RUNWAY_IMAGE_TOOL_NAME, {
    title: "Generate a Runway Frames image",
    description: "Starts one real billed generation after fresh account and model-access preflights. If the outcome is uncertain, do not repeat; use the exact recovery handle.",
    inputSchema: generateInputSchema,
    outputSchema: generationOutputSchema,
    annotations: annotations("Generate Runway Frames image", false, true, true)
  }, async (input, { signal }) => {
    const parsed = generateInputSchema.safeParse(input);
    if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST");
    try {
      const result = await options.generationService.generate({ attemptId: parsed.data.link_attempt_id, variant: parsed.data.variant,
        reference_handles: parsed.data.reference_handles, parameters: parsed.data.parameters, prompt: parsed.data.prompt }, signal);
      return structured(generationOutputSchema.parse(result));
    } catch (error) { return errorResult(error, "GENERATION_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_RUNWAY_IMAGE_TOOL_NAME, {
    title: "Reconcile a Runway image generation",
    description: "Read-only, bounded GET-only reconciliation for the exact attempt and opaque recovery handle. Never starts another generation.",
    inputSchema: reconcileInputSchema,
    outputSchema: generationOutputSchema,
    annotations: annotations("Reconcile Runway image generation", true, false, true)
  }, async (input, { signal }) => {
    const parsed = reconcileInputSchema.safeParse(input);
    if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST");
    try {
      const result = await options.generationService.reconcile({ attemptId: parsed.data.link_attempt_id, recovery_id: parsed.data.recovery_id }, signal);
      return structured(generationOutputSchema.parse(result));
    } catch (error) { return errorResult(error, "GENERATION_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_LIST_RUNWAY_IMAGE_RECOVERIES_TOOL_NAME, {
    title: "List Runway image recovery handles",
    description: "Lists only bounded, process-local recovery metadata for the exact owner attempt. Prompt, artifact URLs, and principal details are never returned.",
    inputSchema: listInputSchema,
    outputSchema: recoveryListOutputSchema,
    annotations: annotations("List Runway image recoveries", true, false, true)
  }, async (input) => {
    const parsed = listInputSchema.safeParse(input);
    if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST");
    try {
      const recoveries = await options.generationService.listRecoveries({ attemptId: parsed.data.link_attempt_id, limit: parsed.data.limit });
      return structured(recoveryListOutputSchema.parse({ recoveries, confidence_scope: "process_local_get_only_recovery" }));
    } catch (error) { return errorResult(error, "RECOVERY_LIST_UNAVAILABLE"); }
  });
}

function annotations(title: string, readOnly: boolean, destructive: boolean, openWorld: boolean) {
  return { title, readOnlyHint: readOnly, destructiveHint: destructive, idempotentHint: readOnly, openWorldHint: openWorld };
}
function structured(value: object): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> };
}
function errorResult(error: unknown, fallback: string): CallToolResult {
  let code = fallback;
  let recoveryId: string | undefined;
  let diagnostic: unknown;
  if (error instanceof OwnerRunwayImageUploadServiceError && ["INVALID_REQUEST", "INVALID_IMAGE_INPUT", "LOCAL_RESOURCE_LIMIT_EXCEEDED",
      "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH", "SERVICE_BUSY", "CAPACITY_EXCEEDED", "SERVICE_CLOSED", "REQUEST_ABORTED",
      "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED", "UPLOAD_REJECTED", "UPLOAD_OUTCOME_UNKNOWN"].includes(error.code)) code = error.code;
  else if (error instanceof OwnerRunwayImageGenerationServiceError && (OWNER_RUNWAY_IMAGE_GENERATION_ERROR_CODES as readonly string[]).includes(error.code)) {
    code = error.code;
    if (error.code === "OUTCOME_UNKNOWN") {
      if (typeof error.recovery_id === "string" && RECOVERY.test(error.recovery_id)) recoveryId = error.recovery_id;
      const parsed = diagnosticSchema.safeParse(error.diagnostic);
      if (parsed.success) diagnostic = parsed.data;
    }
  } else if (error instanceof OwnerReferencePrincipalError && ["REFERENCE_PRINCIPAL_NOT_LINKED", "REFERENCE_PRINCIPAL_INVALID"].includes(error.code)) code = error.code;
  const messages: Record<string, string> = {
    INVALID_REQUEST: "The owner Runway image request is invalid.", INVALID_IMAGE_INPUT: "Provide a supported image with matching MIME and valid container metadata.",
    LOCAL_RESOURCE_LIMIT_EXCEEDED: "The image exceeds the local resource ceiling.", PRINCIPAL_NOT_LINKED: "The exact owner attempt is not linked.",
    REFERENCE_PRINCIPAL_NOT_LINKED: "The exact owner attempt is not linked.", REFERENCE_PRINCIPAL_INVALID: "The exact owner attempt is not linked.",
    MODEL_BINDING_MISMATCH: "The selected Runway variant is unavailable in the pinned source catalog.",
    SERVICE_BUSY: "The owner Runway image service is at its safe concurrency limit; no automatic retry was performed.",
    CAPACITY_EXCEEDED: "The bounded owner Runway image service capacity is full.", SERVICE_CLOSED: "The owner Runway image service is closed.",
    REQUEST_ABORTED: "The operation was aborted; inspect its exact outcome before retrying.",
    REFERENCE_UNAVAILABLE: "A reference handle is unavailable for this exact attempt and variant.", REFERENCE_EXPIRED: "A reference handle expired or is no longer available.",
    REFERENCE_ALREADY_CLAIMED: "This semantic generation intent is already claimed; expiry does not permit paid replay.",
    PREFLIGHT_FAILED: "Fresh subscription or model-access checks did not pass.", PRE_DISPATCH_FAILED: "Generation failed before dispatch.",
    OUTCOME_UNKNOWN: "Generation may have been dispatched; do not retry. Reconcile only with the same recovery handle.",
    RECOVERY_NOT_FOUND: "No matching process-local recovery record is available for this attempt.",
    UPLOAD_REJECTED: "The reference upload was rejected before a handle was issued.", UPLOAD_OUTCOME_UNKNOWN: "Upload outcome is unknown; do not repeat automatically.",
    UPLOAD_FAILED: "The Runway image upload failed safely.", GENERATION_FAILED: "Generation could not be confirmed; do not repeat a call that may have dispatched.",
    RECOVERY_LIST_UNAVAILABLE: "Runway image recovery handles are unavailable."
  };
  const body = { error: { code: errorCodeSchema.safeParse(code).success ? code : fallback,
    message: messages[code] ?? "The owner Runway image operation failed safely.",
    ...(recoveryId === undefined ? {} : { recovery_id: recoveryId }), ...(diagnostic === undefined ? {} : { diagnostic }) } };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] };
}
function isSafeFilename(value: string): boolean {
  return value !== "." && value !== ".." && /^[^/\\\p{Cc}\p{Cf}\p{Cs}]{1,255}$/u.test(value) && Buffer.byteLength(value, "utf8") <= 255;
}
function isSafeHttpsUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname.length > 0 && !url.username && !url.password; }
  catch { return false; }
}
function isValidPrompt(value: string): boolean {
  if (value.trim().length === 0 || Buffer.byteLength(value, "utf8") > 65_536 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(index + 1); if (next < 0xdc00 || next > 0xdfff) return false; index += 1; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
