import { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OwnerReferencePrincipalError } from "../auth/owner-reference-principal.js";
import {
  OWNER_STANDARD_IMAGE_GENERATION_ERROR_CODES,
  OWNER_STANDARD_IMAGE_GENERATION_HISTORY_REASONS,
  OWNER_STANDARD_IMAGE_GENERATION_PHASES,
  OWNER_STANDARD_IMAGE_GENERATION_RESULT_REASONS,
  OwnerStandardImageGenerationServiceError,
  type OwnerStandardImageGenerationService,
  type OwnerStandardImageGenerationResult
} from "../application/owner-standard-image-generation-service.js";
import {
  OwnerStandardImageUploadServiceError,
  type OwnerStandardImageUploadService,
  type OwnerStandardImageUploadReceipt
} from "../application/owner-standard-image-upload-service.js";
import {
  OWNER_STANDARD_IMAGE_VARIANTS,
  type OwnerStandardImageVariant
} from "../application/owner-standard-image-request-preparer.js";
import { getOwnerBananaImageSourceParameters } from "../application/owner-banana-image-parameters.js";
import { getOwnerGptImageSourceParameters } from "../application/owner-gpt-image-parameters.js";

const ATTEMPT_ID_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const REFERENCE_HANDLE_PATTERN = /^standard_image_[0-9a-f-]{36}$/u;
const RECOVERY_ID_PATTERN = /^standard_image_recovery_[0-9a-f-]{36}$/u;
const MAX_BASE64_CHARS = 44_739_244;
const MAX_INPUT_BYTES = 32 * 1024 * 1024;
const BANANA_SOURCE = getOwnerBananaImageSourceParameters();
const GPT_SOURCE = getOwnerGptImageSourceParameters();
const VARIANTS = OWNER_STANDARD_IMAGE_VARIANTS;
const KIND_VALUES = ["image", "video", "file"] as const;
const IMAGE_MIMES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif"] as const;
const VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime", "video/mpeg", "video/mov", "video/3gpp", "video/x-flv", "video/x-ms-wmv"] as const;
const ORIGINAL_MIMES = [...IMAGE_MIMES, ...VIDEO_MIMES, "application/pdf"] as const;
const CANONICAL_MIMES = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif",
  "video/mp4", "video/webm", "video/quicktime", "video/mpeg", "video/3gpp", "video/x-flv", "video/x-ms-wmv",
  "application/pdf"] as const;
const VALIDATION_CONFIDENCES = [
  "JPEG_PNG_WEBP_STRUCTURAL_HEADER_ONLY;BANANA_21_CATALOG_METADATA_CEILING_PROVIDER_UNPROVEN",
  "JPEG_PNG_WEBP_STRUCTURAL_HEADER_ONLY;LOCAL_PROCESS_32MIB_RESOURCE_CEILING_NOT_PROVIDER_LIMIT",
  "AVIF_PRIMARY_ITEM_PROPERTY_ASSOCIATION_ONLY;LOCAL_PROCESS_32MIB_RESOURCE_CEILING_NOT_PROVIDER_LIMIT",
  "HEIF_PRIMARY_ITEM_ISPE_ASSOCIATION_ONLY;BANANA_21_CATALOG_METADATA_CEILING_PROVIDER_UNPROVEN",
  "HEIF_PRIMARY_ITEM_ISPE_ASSOCIATION_ONLY;LOCAL_PROCESS_32MIB_RESOURCE_CEILING_NOT_PROVIDER_LIMIT",
  "STRUCTURAL_CONTAINER_VALIDATED_NOT_DECODED",
  "PDF_HEADER_TAIL_GUARDS_ONLY_NOT_PARSED"
] as const;
const UPLOAD_ERROR_CODES = [
  "INVALID_REQUEST", "INVALID_IMAGE_INPUT", "LOCAL_RESOURCE_LIMIT_EXCEEDED", "UNSUPPORTED_IMAGE_COMPOSITION",
  "INVALID_MEDIA_INPUT", "UNSUPPORTED_MEDIA_CONTAINER", "UNSUPPORTED_ENCRYPTED_PDF", "PRINCIPAL_NOT_LINKED",
  "MODEL_BINDING_MISMATCH", "SERVICE_BUSY", "CAPACITY_EXCEEDED", "SERVICE_CLOSED", "REQUEST_ABORTED",
  "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED", "UPLOAD_REJECTED", "UPLOAD_OUTCOME_UNKNOWN"
] as const;
const PRINCIPAL_ERROR_CODES = ["REFERENCE_PRINCIPAL_NOT_LINKED", "REFERENCE_PRINCIPAL_INVALID"] as const;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

export const SYNTX_UPLOAD_STANDARD_IMAGE_REFERENCE_TOOL_NAME = "syntx_upload_standard_image_reference" as const;
export const SYNTX_OWNER_GENERATE_STANDARD_IMAGE_TOOL_NAME = "syntx_owner_generate_standard_image" as const;
export const SYNTX_OWNER_RECONCILE_STANDARD_IMAGE_TOOL_NAME = "syntx_owner_reconcile_standard_image" as const;
export const SYNTX_OWNER_LIST_STANDARD_IMAGE_RECOVERIES_TOOL_NAME = "syntx_owner_list_standard_image_recoveries" as const;

const attemptIdSchema = z.string().regex(ATTEMPT_ID_PATTERN)
  .describe("Exact linked owner attempt; not an account, provider, or chat identifier.");
const variantSchema = z.enum(VARIANTS).describe("One exact source-reviewed Banana or GPT Image variant.");
const referenceHandleSchema = z.string().regex(REFERENCE_HANDLE_PATTERN)
  .describe("Opaque uploaded reference handle bound to this exact owner attempt and variant.");
const recoveryIdSchema = z.string().regex(RECOVERY_ID_PATTERN)
  .describe("Opaque recovery handle for this exact linked attempt; recovery is bounded and process-local.");
const filenameSchema = z.string().refine(isSafeFilename, "Use a portable basename of at most 255 UTF-8 bytes.")
  .describe("Portable filename only; local paths and URLs are rejected. It is used for upload validation and is never returned.");
const promptSchema = z.string().refine(isValidPrompt,
  "Prompt must be nonblank, well-formed Unicode, contain no forbidden control characters, and fit the local 65,536-byte resource guard.")
  .describe("Required prompt. The 65,536-byte limit is a local resource guard, not a provider limit; original text is preserved.");

const BANANA_ASPECT_RATIO_VALUES = BANANA_SOURCE.controls.aspect_ratio.values.filter((value) => value !== null) as [string, ...string[]];
const bananaAspectRatios = z.union([z.enum(BANANA_ASPECT_RATIO_VALUES), z.null()]);
const bananaImageSizes = z.union([z.enum(["1K", "2K", "4K", "0.5K"]), z.null()]);
const bananaThinkingLevels = z.union([z.enum(["minimal", "medium", "high"]), z.null()]);
const bananaParametersSchema = z.object({
  aspect_ratio: bananaAspectRatios,
  image_size: bananaImageSizes,
  thinking_level: bananaThinkingLevels
}).strict();
const gptAspectRatios = z.enum(["1:1", "16:9", "9:16", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "21:9"]);
const gptParametersSchema = z.object({
  aspect_ratio: gptAspectRatios,
  quality: z.union([z.enum(["1K", "2K", "4K"]), z.null()]),
  details_quality: z.union([z.enum(["low", "medium", "high", "xhigh", "max"]), z.null()])
}).strict();
const parametersSchema = z.union([bananaParametersSchema, gptParametersSchema]);

const uploadInputSchema = z.object({
  link_attempt_id: attemptIdSchema,
  variant: variantSchema,
  content_base64: z.string().min(4).max(MAX_BASE64_CHARS).regex(BASE64)
    .describe("Padded standard Base64. The 32 MiB encoded-input ceiling is a local MCP guard; variant validators enforce actual decoded limits."),
  filename: filenameSchema,
  mime_type: z.enum(ORIGINAL_MIMES)
}).strict();

const generateInputSchema = z.object({
  link_attempt_id: attemptIdSchema,
  variant: variantSchema,
  reference_handles: z.array(referenceHandleSchema).max(34),
  parameters: parametersSchema,
  prompt: promptSchema
}).strict().superRefine((input, context) => {
  if (new Set(input.reference_handles).size !== input.reference_handles.length) {
    context.addIssue({ code: "custom", path: ["reference_handles"], message: "Reference handles must be unique and ordered." });
  }
  if (input.parameters && !parametersMatchVariant(input.variant, input.parameters)) {
    context.addIssue({ code: "custom", path: ["parameters"], message: "All three explicit fields must match the selected source variant, including nulls for inactive controls." });
  }
  const limits = referenceLimits(input.variant);
  if (input.reference_handles.length < limits.minimum || input.reference_handles.length > limits.maximum) {
    context.addIssue({ code: "custom", path: ["reference_handles"], message: "Reference count is outside the selected source variant's declared range." });
  }
});
const reconcileInputSchema = z.object({ link_attempt_id: attemptIdSchema, recovery_id: recoveryIdSchema }).strict();
const listInputSchema = z.object({ link_attempt_id: attemptIdSchema, limit: z.number().int().min(1).max(20).default(20) }).strict();

const uploadOutputSchema = z.object({
  status: z.literal("uploaded"),
  reference_handle: referenceHandleSchema,
  variant: variantSchema,
  kind: z.enum(KIND_VALUES),
  original_mime_type: z.enum(ORIGINAL_MIMES),
  mime_type: z.enum(CANONICAL_MIMES),
  width: z.number().int().positive().max(0xffff_ffff).nullable(),
  height: z.number().int().positive().max(0xffff_ffff).nullable(),
  duration: z.number().finite().nonnegative().nullable(),
  size: z.number().int().positive().max(MAX_INPUT_BYTES),
  sha256: z.string().regex(SHA256),
  expires_in_seconds: z.number().int().min(1).max(900),
  metadata_confidence: z.enum(["CONTAINER_METADATA_ONLY", "NOT_EXTRACTED"]),
  validation_confidence: z.enum(VALIDATION_CONFIDENCES)
}).strict().superRefine((receipt, context) => {
  const image = receipt.original_mime_type.startsWith("image/");
  const video = receipt.original_mime_type.startsWith("video/");
  const canonicalMatches = receipt.mime_type === (receipt.original_mime_type === "image/jpg" ? "image/jpeg" :
    receipt.original_mime_type === "video/mov" ? "video/quicktime" : receipt.original_mime_type);
  if (!canonicalMatches) {
    context.addIssue({ code: "custom", path: ["mime_type"], message: "Canonical MIME must match the supplied content type." });
  }
  if (receipt.kind === "image" && (!image || receipt.width === null || receipt.height === null || receipt.duration !== null ||
      receipt.metadata_confidence !== "CONTAINER_METADATA_ONLY")) {
    context.addIssue({ code: "custom", path: ["kind"], message: "Image upload receipt metadata is inconsistent." });
  }
  if (receipt.kind === "video" && (!video || receipt.width !== null || receipt.height !== null || receipt.duration !== null ||
      receipt.metadata_confidence !== "NOT_EXTRACTED")) {
    context.addIssue({ code: "custom", path: ["kind"], message: "Video upload receipt metadata is inconsistent with its public confidence." });
  }
  if (receipt.kind === "file" && (receipt.original_mime_type !== "application/pdf" || receipt.width !== null || receipt.height !== null ||
      receipt.duration !== null || receipt.metadata_confidence !== "NOT_EXTRACTED")) {
    context.addIssue({ code: "custom", path: ["kind"], message: "File upload receipt metadata is inconsistent with its public confidence." });
  }
});

const parametersOutputSchema = parametersSchema;
const inputReferenceSchema = z.object({
  kind: z.enum(KIND_VALUES),
  mime_type: z.enum(CANONICAL_MIMES),
  width: z.number().int().positive().max(0xffff_ffff).nullable(),
  height: z.number().int().positive().max(0xffff_ffff).nullable(),
  duration: z.number().finite().nonnegative().nullable(),
  size: z.number().int().positive().max(MAX_INPUT_BYTES),
  sha256: z.string().regex(SHA256),
  metadata_confidence: z.enum(["CONTAINER_METADATA_ONLY", "UNKNOWN"])
}).strict().superRefine((reference, context) => {
  const isImage = reference.kind === "image" && reference.mime_type.startsWith("image/") &&
    reference.width !== null && reference.height !== null && reference.duration === null &&
    reference.metadata_confidence === "CONTAINER_METADATA_ONLY";
  const isVideo = reference.kind === "video" && reference.mime_type.startsWith("video/") &&
    reference.width === null && reference.height === null && reference.duration === null && reference.metadata_confidence === "UNKNOWN";
  const isFile = reference.kind === "file" && reference.mime_type === "application/pdf" &&
    reference.width === null && reference.height === null && reference.duration === null && reference.metadata_confidence === "UNKNOWN";
  if (!isImage && !isVideo && !isFile) {
    context.addIssue({ code: "custom", path: ["kind"], message: "Input reference metadata does not match its public media-kind confidence." });
  }
});
const artifactSchema = z.object({
  url: z.string().url().refine(isHttpsUrl),
  mime_type: z.string().regex(/^image\/[a-z0-9.+-]{1,64}$/u).nullable(),
  mime_source: z.enum(["URL_EXTENSION", "UNKNOWN"]),
  width: z.null(), height: z.null(), geometry_verified: z.literal(false)
}).strict().superRefine((artifact, context) => {
  if ((artifact.mime_source === "UNKNOWN") !== (artifact.mime_type === null)) {
    context.addIssue({ code: "custom", path: ["mime_type"], message: "Artifact MIME must match its URL-extension evidence status." });
  }
});
const generationOutputSchema = z.object({
  status: z.literal("result_observed"), backend_acceptance: z.literal("unproven"),
  ai_name: z.enum(["banana", "sora-images"]), model_id: variantSchema, variant: variantSchema,
  operation_id: z.literal("generate-image"), profile_id: z.string().min(1).max(160),
  profile_schema_hash: z.string().regex(SHA256), catalog_version: z.string().min(1).max(160),
  request_fingerprint: z.string().regex(SHA256), parameters: parametersOutputSchema,
  cost_inputs: z.union([
    z.object({}).strict(),
    z.object({ image_size: z.enum(["1K", "2K", "4K", "0.5K"]) }).strict(),
    z.object({ quality: z.enum(["1K", "2K", "4K"]), details_quality: z.enum(["low", "medium", "high", "xhigh", "max"]) }).strict(),
    z.object({ quality: z.enum(["1K", "2K", "4K"]), details_quality: z.enum(["low", "medium", "high", "xhigh", "max"]), ref_count: z.number().int().min(1).max(34) }).strict()
  ]),
  cost_input_confidence: z.enum([
    "SOURCE_JOINED_METADATA_KEYS_NOT_QUOTE",
    "SOURCE_JOINED_CONTROLLED_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP"
  ]),
  reference_count: z.number().int().min(0).max(34), total_reference_count: z.number().int().min(0).max(34),
  counts_by_kind: z.object({ image: z.number().int().min(0).max(34), video: z.number().int().min(0).max(34), file: z.number().int().min(0).max(34) }).strict(),
  input_references: z.array(inputReferenceSchema).max(34),
  actual_image: z.object({ mime_type: z.string().regex(/^image\/[a-z0-9.+-]{1,64}$/u).nullable(), width: z.null(), height: z.null() }).strict(),
  geometry_verified: z.literal(false), artifact: artifactSchema
}).strict().superRefine((result, context) => {
  if (result.model_id !== result.variant || result.ai_name !== aiNameFor(result.variant) ||
      !parametersMatchVariant(result.variant, result.parameters)) {
    context.addIssue({ code: "custom", path: ["variant"], message: "Result identity or all-three-field parameter state is inconsistent." });
  }
  const counts = result.input_references.reduce((current, reference) => ({ ...current, [reference.kind]: current[reference.kind] + 1 }),
    { image: 0, video: 0, file: 0 });
  if (result.total_reference_count !== result.input_references.length || result.reference_count !== counts.image ||
      result.counts_by_kind.image !== counts.image || result.counts_by_kind.video !== counts.video || result.counts_by_kind.file !== counts.file) {
    context.addIssue({ code: "custom", path: ["input_references"], message: "Ordered reference metadata counts do not match the full input set." });
  }
  if (isBanana(result.variant)) {
    const parameters = result.parameters as z.infer<typeof bananaParametersSchema>;
    const expectedCost = result.variant === "banana" ? {} : { image_size: parameters.image_size };
    if (!sameScalarRecord(result.cost_inputs, expectedCost) || result.cost_input_confidence !== "SOURCE_JOINED_METADATA_KEYS_NOT_QUOTE") {
      context.addIssue({ code: "custom", path: ["cost_inputs"], message: "Banana cost-input keys must match the selected variant; no quote or cap is implied." });
    }
  } else {
    const parameters = result.parameters as z.infer<typeof gptParametersSchema>;
    const expectedCost = result.variant === "gpt-image-1" || result.variant === "gpt-image-1.5" ? {} :
      result.variant === "gpt-image-2" ? { quality: parameters.quality, details_quality: parameters.details_quality } :
        { quality: parameters.quality, details_quality: parameters.details_quality,
          ...(result.reference_count === 0 ? {} : { ref_count: result.reference_count }) };
    if (!sameScalarRecord(result.cost_inputs, expectedCost) || result.cost_input_confidence !== "SOURCE_JOINED_CONTROLLED_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP") {
      context.addIssue({ code: "custom", path: ["cost_inputs"], message: "GPT Image cost inputs must preserve source keys and omit a zero reference count." });
    }
  }
});

const diagnosticSchema = z.object({
  phase: z.enum(OWNER_STANDARD_IMAGE_GENERATION_PHASES), post_started: z.boolean(), echo_ack_known: z.boolean(),
  history_binding: z.enum(["NONE", "PENDING", "READY", "INVALID"]),
  history_binding_reason: z.enum(OWNER_STANDARD_IMAGE_GENERATION_HISTORY_REASONS).nullable(),
  history_get_calls: z.number().int().min(0).max(99), history_get_calls_saturated: z.boolean(),
  inprogress_get_calls: z.number().int().min(0).max(99), inprogress_get_calls_saturated: z.boolean(),
  result_get_calls: z.number().int().min(0).max(99), result_get_calls_saturated: z.boolean(),
  result_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "UNVERIFIED"]), result_reason: z.enum(OWNER_STANDARD_IMAGE_GENERATION_RESULT_REASONS).nullable()
}).strict();
const recoveryListOutputSchema = z.object({ recoveries: z.array(z.object({
  recovery_id: recoveryIdSchema, created_at: z.iso.datetime(), model_id: variantSchema,
  operation_id: z.literal("generate-image"), status: z.literal("OUTCOME_UNKNOWN"), diagnostic: diagnosticSchema
}).strict()).max(20), confidence_scope: z.literal("process_local_get_only_recovery") }).strict();

export interface RegisterSyntxOwnerStandardImageToolsOptions {
  readonly uploadService: Pick<OwnerStandardImageUploadService, "upload">;
  readonly generationService: Pick<OwnerStandardImageGenerationService, "generate" | "reconcile" | "listRecoveries">;
}

/** Register only when an explicit owner-local composition is supplied. */
export function registerSyntxOwnerStandardImageTools(
  server: import("@modelcontextprotocol/sdk/server/mcp.js").McpServer,
  options: RegisterSyntxOwnerStandardImageToolsOptions
): void {
  server.registerTool(SYNTX_UPLOAD_STANDARD_IMAGE_REFERENCE_TOOL_NAME, {
    title: "Upload a Banana or GPT Image reference",
    description: "Upload one owner-provided image, or for Banana 2.1 a supported video or PDF input. The Base64 ceiling is 32 MiB encoded text; the variant validator applies the actual decoded local limits. Metadata confidence is reported explicitly. The filename is used only for validation and is not returned. No path or URL is accepted.",
    inputSchema: uploadInputSchema, outputSchema: uploadOutputSchema,
    annotations: { title: "Upload a standard image reference", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    const request = uploadInputSchema.safeParse(input);
    if (!request.success) return errorResult(undefined, "INVALID_REQUEST");
    try {
      const receipt = await options.uploadService.upload({
        attemptId: request.data.link_attempt_id, variant: request.data.variant,
        content_base64: request.data.content_base64, filename: request.data.filename,
        mime_type: request.data.mime_type, ...(signal === undefined ? {} : { signal })
      });
      return safeStructured(uploadOutputSchema.parse(receipt) as OwnerStandardImageUploadReceipt);
    } catch (error) { return errorResult(error, "UPLOAD_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_STANDARD_IMAGE_TOOL_NAME, {
    title: "Generate an image with Banana or GPT Image",
    description: "Owner-authorized image generation may incur provider cost or token usage; the shown cost inputs are source metadata, not a quote, billing cap, or guaranteed charge. Select one exact variant, supply all three explicit settings (including null for inactive controls), the ordered opaque handles, and a required prompt. The local 65,536-byte prompt guard is not a provider limit. Result geometry and backend acceptance remain unproven. OUTCOME_UNKNOWN means dispatch may have occurred; do not retry and reconcile only with the same recovery handle.",
    inputSchema: generateInputSchema, outputSchema: generationOutputSchema,
    annotations: { title: "Generate a standard image", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    const request = generateInputSchema.safeParse(input);
    if (!request.success) return errorResult(undefined, "INVALID_REQUEST");
    try {
      const result = await options.generationService.generate({
        attemptId: request.data.link_attempt_id, variant: request.data.variant,
        reference_handles: request.data.reference_handles, parameters: request.data.parameters,
        prompt: request.data.prompt
      }, signal);
      return safeStructured(generationOutputSchema.parse(result) as OwnerStandardImageGenerationResult);
    } catch (error) { return errorResult(error, "GENERATION_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_STANDARD_IMAGE_TOOL_NAME, {
    title: "Reconcile a standard image generation",
    description: "Read-only, bounded GET-only reconciliation for the same opaque recovery handle and linked owner attempt. It never starts or retries a paid generation. Recovery is process-local and does not promise restart or global durability.",
    inputSchema: reconcileInputSchema, outputSchema: generationOutputSchema,
    annotations: { title: "Reconcile standard image generation", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    const request = reconcileInputSchema.safeParse(input);
    if (!request.success) return errorResult(undefined, "INVALID_REQUEST");
    try {
      const result = await options.generationService.reconcile({ attemptId: request.data.link_attempt_id,
        recovery_id: request.data.recovery_id }, signal);
      return safeStructured(generationOutputSchema.parse(result) as OwnerStandardImageGenerationResult);
    } catch (error) { return errorResult(error, "GENERATION_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_LIST_STANDARD_IMAGE_RECOVERIES_TOOL_NAME, {
    title: "List standard image recoveries",
    description: "Read-only bounded list of process-local recovery handles for this exact linked owner attempt. Listing never starts or retries a generation; restart/global recovery is not promised.",
    inputSchema: listInputSchema, outputSchema: recoveryListOutputSchema,
    annotations: { title: "List standard image recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input): Promise<CallToolResult> => {
    const request = listInputSchema.safeParse(input);
    if (!request.success) return errorResult(undefined, "INVALID_REQUEST");
    try {
      const recoveries = await options.generationService.listRecoveries({ attemptId: request.data.link_attempt_id,
        limit: request.data.limit });
      return safeStructured(recoveryListOutputSchema.parse({ recoveries, confidence_scope: "process_local_get_only_recovery" }));
    } catch (error) { return errorResult(error, "RECOVERY_LIST_UNAVAILABLE"); }
  });
}

function parametersMatchVariant(variant: OwnerStandardImageVariant, value: unknown): boolean {
  if (isBanana(variant)) {
    const parameters = value as { aspect_ratio: string | null; image_size: string | null; thinking_level: string | null };
    const sizeValues = BANANA_SOURCE.controls.image_size.values_by_variant[variant];
    const thinkingValues = BANANA_SOURCE.controls.thinking_level.values_by_variant[variant];
    return BANANA_SOURCE.controls.aspect_ratio.values.includes(parameters.aspect_ratio as never) &&
      sizeValues.includes(parameters.image_size as never) && thinkingValues.includes(parameters.thinking_level as never);
  }
  const parameters = value as { aspect_ratio: string; quality: string | null; details_quality: string | null };
  const legacy = variant === "gpt-image-1" || variant === "gpt-image-1.5";
  const allowedRatios = legacy ? GPT_SOURCE.parameters.aspect_ratio.legacy_values : GPT_SOURCE.parameters.aspect_ratio.mapped_values;
  if (!allowedRatios.includes(parameters.aspect_ratio as never)) return false;
  if (legacy) return parameters.quality === null && parameters.details_quality === null;
  if (!(GPT_SOURCE.parameters.quality.values as readonly string[]).includes(parameters.quality ?? "")) return false;
  const details = variant === "gpt-image-2" ? GPT_SOURCE.parameters.details_quality.gpt_image_2_values : GPT_SOURCE.parameters.details_quality.gpt_image_25_values;
  return details.includes(parameters.details_quality as never);
}

function referenceLimits(variant: OwnerStandardImageVariant): { minimum: number; maximum: number } {
  if (variant === "banana-2.1") return { minimum: 0, maximum: 34 };
  return isBanana(variant) ? BANANA_SOURCE.reference_limits[variant] : { minimum: 0, maximum: GPT_SOURCE.reference_limits[variant] };
}
function isBanana(variant: OwnerStandardImageVariant): variant is typeof BANANA_SOURCE.variants[number] {
  return (BANANA_SOURCE.variants as readonly string[]).includes(variant);
}
function aiNameFor(variant: OwnerStandardImageVariant): "banana" | "sora-images" { return isBanana(variant) ? "banana" : "sora-images"; }
function isSafeFilename(value: string): boolean {
  return value !== "." && value !== ".." && /^[^/\\\p{Cc}\p{Cf}\p{Cs}]{1,255}$/u.test(value) && Buffer.byteLength(value, "utf8") <= 255;
}
function sameScalarRecord(actual: unknown, expected: Readonly<Record<string, string | number | null>>): boolean {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  const actualRecord = actual as Record<string, unknown>;
  const actualKeys = Object.keys(actualRecord);
  const expectedKeys = Object.keys(expected);
  return actualKeys.length === expectedKeys.length && actualKeys.every((key) =>
    Object.hasOwn(expected, key) && actualRecord[key] === expected[key]);
}
function isValidPrompt(value: string): boolean {
  if (value.trim().length === 0 || Buffer.byteLength(value, "utf8") > 65_536 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function isHttpsUrl(value: string): boolean {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}
function safeStructured(value: object): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> };
}
function errorResult(error: unknown, fallback: string): CallToolResult {
  let code = fallback;
  let recoveryId: string | undefined;
  let diagnostic: unknown;
  if (error instanceof OwnerStandardImageUploadServiceError && (UPLOAD_ERROR_CODES as readonly string[]).includes(error.code)) {
    code = error.code;
  } else if (error instanceof OwnerStandardImageGenerationServiceError &&
      (OWNER_STANDARD_IMAGE_GENERATION_ERROR_CODES as readonly string[]).includes(error.code)) {
    code = error.code;
    if (code === "OUTCOME_UNKNOWN") {
      if (typeof error.recovery_id === "string" && RECOVERY_ID_PATTERN.test(error.recovery_id)) recoveryId = error.recovery_id;
      const parsed = diagnosticSchema.safeParse(error.diagnostic);
      if (parsed.success) diagnostic = parsed.data;
    }
  } else if (error instanceof OwnerReferencePrincipalError && (PRINCIPAL_ERROR_CODES as readonly string[]).includes(error.code)) {
    code = error.code;
  }
  const messages: Record<string, string> = {
    INVALID_REQUEST: "The owner standard image request is invalid.",
    INVALID_IMAGE_INPUT: "Provide a supported image with matching MIME and valid container metadata.",
    LOCAL_RESOURCE_LIMIT_EXCEEDED: "The input exceeds the selected variant's local resource guard.",
    UNSUPPORTED_IMAGE_COMPOSITION: "This image composition is not supported by the current local validator.",
    INVALID_MEDIA_INPUT: "Provide a supported Banana 2.1 video or PDF input.",
    UNSUPPORTED_MEDIA_CONTAINER: "This media container is not supported by the current local validator.",
    UNSUPPORTED_ENCRYPTED_PDF: "Encrypted PDF inputs are not supported by the current local validator.",
    PRINCIPAL_NOT_LINKED: "The exact owner attempt is not linked.", REFERENCE_PRINCIPAL_NOT_LINKED: "The exact owner attempt is not linked.",
    REFERENCE_PRINCIPAL_INVALID: "The exact owner attempt is not linked.",
    MODEL_BINDING_MISMATCH: "The selected variant is unavailable in the pinned source catalog.",
    SERVICE_BUSY: "The owner standard image service is at its safe concurrency limit; no automatic retry was performed.",
    CAPACITY_EXCEEDED: "The bounded owner standard image service capacity is full.", SERVICE_CLOSED: "The owner standard image service is closed.",
    REQUEST_ABORTED: "The upload was aborted; inspect its exact outcome before retrying.",
    REFERENCE_UNAVAILABLE: "The reference handle is unavailable for this exact attempt and variant.",
    REFERENCE_EXPIRED: "The reference handle expired or is no longer available.",
    REFERENCE_ALREADY_CLAIMED: "This semantic generation intent is already claimed; expiry does not permit paid replay.",
    UPLOAD_REJECTED: "The reference upload was rejected before a handle was issued.",
    UPLOAD_OUTCOME_UNKNOWN: "The upload outcome is unknown; do not repeat it automatically.",
    PREFLIGHT_FAILED: "Fresh subscription or model-access checks did not pass; this is not permission to retry generation.",
    PRE_DISPATCH_FAILED: "The generation request failed before dispatch.",
    OUTCOME_UNKNOWN: "Generation may have been dispatched; do not retry. Reconcile only with the same recovery handle.",
    RECOVERY_NOT_FOUND: "No matching process-local recovery record is available for this attempt.",
    UPLOAD_FAILED: "The standard image upload failed safely.",
    GENERATION_FAILED: "The standard image generation outcome could not be confirmed; do not repeat a call that may have dispatched.",
    RECOVERY_LIST_UNAVAILABLE: "Standard image recovery handles are unavailable."
  };
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: {
    code, message: messages[code] ?? "The owner standard image operation failed safely.",
    ...(recoveryId === undefined ? {} : { recovery_id: recoveryId }), ...(diagnostic === undefined ? {} : { diagnostic })
  } }) }] };
}
