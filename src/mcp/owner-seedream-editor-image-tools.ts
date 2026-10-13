import { types } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import {
  OWNER_SEEDREAM_EDITOR_GENERATION_PROMPT_LOCAL_BOUND
} from "../application/owner-seedream-editor-generation-parameters.js";
import { getOwnerSeedreamEditorSourceParameters } from "../application/owner-seedream-editor-parameters.js";
import {
  OwnerSeedreamEditorOriginalReferenceService,
  OwnerSeedreamEditorOriginalReferenceServiceError,
  type OwnerSeedreamEditorOriginalUploadReceipt
} from "../application/owner-seedream-editor-original-reference-service.js";
import {
  OwnerSeedreamEditorDrawingReferenceService,
  OwnerSeedreamEditorDrawingReferenceServiceError,
  type OwnerSeedreamEditorDrawingUploadReceipt
} from "../application/owner-seedream-editor-drawing-reference-service.js";
import {
  isOwnerSeedreamEditorImageGenerationService,
  OwnerSeedreamEditorImageGenerationServiceError,
  OWNER_SEEDREAM_EDITOR_IMAGE_GENERATION_ERROR_CODES,
  type OwnerSeedreamEditorImageGenerationService,
  type OwnerSeedreamEditorImageGenerationResult,
  type OwnerSeedreamEditorImageResultPage,
  type OwnerSeedreamEditorImageRecoveryListItem
} from "../application/owner-seedream-editor-image-generation-service.js";
import { OWNER_SEEDREAM_EDITOR_ORIGINAL_INPUT_POLICY } from "../application/owner-seedream-editor-original-validator.js";
import { OWNER_SEEDREAM_EDITOR_DRAWING_INPUT_POLICY } from "../application/owner-seedream-editor-drawing-input-validator.js";
import { OWNER_SEEDREAM_IMAGE_VARIANTS, type OwnerSeedreamImageVariant } from "../application/owner-seedream-image-parameters.js";

const SOURCE = getOwnerSeedreamEditorSourceParameters();
const VARIANTS = OWNER_SEEDREAM_IMAGE_VARIANTS;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const ORIGINAL_HANDLE = /^seedream_editor_original_[0-9a-f-]{36}$/u;
const DRAWING_HANDLE = /^seedream_editor_drawing_[0-9a-f-]{36}$/u;
const RECOVERY_ID = /^seedream_editor_recovery_[0-9a-f-]{36}$/u;
const RESULT_ID = /^seedream_editor_result_[0-9a-f-]{36}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MAX_ORIGINAL_BYTES = Math.max(...Object.values(OWNER_SEEDREAM_EDITOR_ORIGINAL_INPUT_POLICY.source_max_file_bytes_by_variant));
const MAX_ORIGINAL_BASE64 = Math.ceil(OWNER_SEEDREAM_EDITOR_ORIGINAL_INPUT_POLICY.local_parser_max_bytes / 3) * 4;
const MAX_DRAWING_BASE64 = Math.ceil(OWNER_SEEDREAM_EDITOR_DRAWING_INPUT_POLICY.local_resource_bound_bytes / 3) * 4;
const MAX_RESULT_ARTIFACTS = 4_096;
const RESULT_PAGE_SIZE = 64;
const CANONICAL_IMAGE_MIMES = ["image/jpeg", "image/png", "image/avif", "image/webp", "image/bmp", "image/gif", "image/tiff", "image/heic", "image/heif"] as const;
const OWNER_SEEDREAM_EDITOR_IMAGE_NATIVE_GAPS = [
  "POST_OUTCOME_UNKNOWN", "OWNER_ACK_UNAVAILABLE", "IN_PROGRESS_ENTRIES_AWAITING_MESSAGE_READ", "IN_PROGRESS_DUPLICATE_MESSAGE_ID",
  "HISTORY_SHAPE_UNVERIFIED", "HISTORY_READ_INCOMPLETE", "HISTORY_METADATA_MISMATCH", "HISTORY_CHAT_ID_MISMATCH",
  "HISTORY_MESSAGE_ID_INVALID", "HISTORY_UNEXPECTED_OWNER_MESSAGE", "HISTORY_OBJECT_ID_INVALID", "HISTORY_EMPTY",
  "HISTORY_BINDING_PENDING", "HISTORY_BINDING_INVALID", "HISTORY_LOCAL_LIMIT", "BOT_RESULT_NOT_OBSERVED"
] as const;
const OWNER_SEEDREAM_EDITOR_IMAGE_RESULT_GAPS = [
  "ENVELOPE_SHAPE_INVALID", "OUTER_MESSAGE_ID_MISMATCH", "NOT_BOT_MESSAGE", "PROVIDER_CHAT_ID_UNOBSERVED", "PROVIDER_CHAT_ID_UNBOUND",
  "PROVIDER_CHAT_ID_MISMATCH", "UNRECOGNIZED_MESSAGE_FIELDS", "MESSAGE_OBJECT_ARRAY_INVALID", "MESSAGE_OBJECT_ARRAY_EMPTY",
  "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT", "UNRECOGNIZED_OBJECT_FIELDS", "OBJECT_ENTRY_INVALID", "OBJECT_TYPE_UNSUPPORTED",
  "OBJECT_COMPLETION_UNKNOWN", "OBJECT_INCOMPLETE", "OBJECT_ID_UNAVAILABLE", "OBJECT_ID_DUPLICATE", "OBJECT_URL_MISSING",
  "OBJECT_URL_UNSAFE", "MODEL_TYPE_UNAVAILABLE", "MODEL_TYPE_MISMATCH"
] as const;
const SERVICE_DIAGNOSTICS = [
  "RESULT_CANDIDATES_UNAVAILABLE", "RESULT_CONTEXT_SCOPE_MISMATCH", "RESULT_NOT_OBSERVED", "RESULT_READ_UNAVAILABLE",
  "RESULT_MESSAGE_UNBOUND", "MODEL_ECHO_MISMATCH", "OBSERVED_RESULT_CAPACITY_LIMIT"
] as const;
const DIAGNOSTICS = [...OWNER_SEEDREAM_EDITOR_IMAGE_NATIVE_GAPS, ...OWNER_SEEDREAM_EDITOR_IMAGE_RESULT_GAPS, ...SERVICE_DIAGNOSTICS] as const;
const PHASES = ["REQUEST_PREPARE", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST", "POST_ACK_KNOWN", "HISTORY_GET",
  "HISTORY_BINDING", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"] as const;

export const SYNTX_GET_SEEDREAM_EDITOR_IMAGE_PARAMETERS_TOOL_NAME = "syntx_get_seedream_editor_image_parameters" as const;
export const SYNTX_UPLOAD_SEEDREAM_EDITOR_ORIGINAL_TOOL_NAME = "syntx_upload_seedream_editor_original" as const;
export const SYNTX_UPLOAD_SEEDREAM_EDITOR_DRAWING_TOOL_NAME = "syntx_upload_seedream_editor_drawing" as const;
export const SYNTX_OWNER_GENERATE_SEEDREAM_EDITOR_IMAGE_TOOL_NAME = "syntx_owner_generate_seedream_editor_image" as const;
export const SYNTX_OWNER_RECONCILE_SEEDREAM_EDITOR_IMAGE_TOOL_NAME = "syntx_owner_reconcile_seedream_editor_image" as const;
export const SYNTX_OWNER_LIST_SEEDREAM_EDITOR_IMAGE_RECOVERIES_TOOL_NAME = "syntx_owner_list_seedream_editor_image_recoveries" as const;
export const SYNTX_OWNER_GET_SEEDREAM_EDITOR_IMAGE_RESULT_PAGE_TOOL_NAME = "syntx_owner_get_seedream_editor_image_result_page" as const;
export const OWNER_SEEDREAM_EDITOR_IMAGE_TOOL_NAMES = Object.freeze([
  SYNTX_GET_SEEDREAM_EDITOR_IMAGE_PARAMETERS_TOOL_NAME,
  SYNTX_UPLOAD_SEEDREAM_EDITOR_ORIGINAL_TOOL_NAME,
  SYNTX_UPLOAD_SEEDREAM_EDITOR_DRAWING_TOOL_NAME,
  SYNTX_OWNER_GENERATE_SEEDREAM_EDITOR_IMAGE_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_SEEDREAM_EDITOR_IMAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_SEEDREAM_EDITOR_IMAGE_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_GET_SEEDREAM_EDITOR_IMAGE_RESULT_PAGE_TOOL_NAME
] as const);

export interface RegisterSyntxOwnerSeedreamEditorImageToolsOptions {
  readonly originalReferenceService: Pick<OwnerSeedreamEditorOriginalReferenceService, "upload">;
  readonly drawingReferenceService: Pick<OwnerSeedreamEditorDrawingReferenceService, "uploadDrawing">;
  readonly generationService: Pick<OwnerSeedreamEditorImageGenerationService, "generate" | "reconcile" | "listRecoveries" | "getResultPage">;
}

const ORIGINAL_UPLOAD = OwnerSeedreamEditorOriginalReferenceService.prototype.upload;
const DRAWING_UPLOAD = OwnerSeedreamEditorDrawingReferenceService.prototype.uploadDrawing;
const sourceInputSchema = z.object({}).strict();
const sourceVariantSchema = z.object({
  variant: z.enum(VARIANTS), aspect_ratios: z.array(z.string()).length(SOURCE.aspect_ratios.length),
  resolutions: z.array(z.string()).min(1).max(4)
}).strict();
const sourceOutputSchema = z.object({
  profile_id: z.literal("seedream-editor-explicit-parameters-v1"), variants: z.array(sourceVariantSchema).length(VARIANTS.length),
  controls: z.tuple([z.literal("aspect_ratio"), z.literal("resolution")]),
  prompt: z.object({ required: z.literal(true), whitespace: z.literal("PRESERVED"), max_utf8_bytes: z.number().int().positive(),
    limit_scope: z.literal("LOCAL_RESOURCE_BOUND_NOT_SOURCE_OR_PROVIDER_LIMIT") }).strict(),
  cost_query: z.object({ status: z.literal("SOURCE_JOINED_COST_QUERY_INPUTS"),
    pro_keys: z.tuple([z.literal("batch_size"), z.literal("resolution")]),
    pro_batch_size: z.literal("DERIVED_FROM_GENUINE_DRAWING_HANDLE_PRESENCE_NOT_OUTPUT_COUNT"),
    other_variant_keys: z.tuple([]) }).strict(),
  effective_defaults: z.literal("UNPROVEN"), dispatch_allowed: z.literal(false), runtime_usable: z.literal(false),
  backend_acceptance: z.literal("UNPROVEN")
}).strict();

const attemptSchema = z.string().regex(ATTEMPT).describe("Exact linked owner attempt; it does not select account or provider context.");
const originalHandleSchema = z.string().regex(ORIGINAL_HANDLE).describe("Opaque original handle issued for this attempt and Editor variant.");
const drawingHandleSchema = z.string().regex(DRAWING_HANDLE).describe("Opaque PNG drawing handle paired to the exact original and attempt.");
const recoveryIdSchema = z.string().regex(RECOVERY_ID).describe("Opaque process-local recovery handle for GET-only reconciliation; never replay generation.");
const resultIdSchema = z.string().regex(RESULT_ID).describe("Opaque cached result handle for the exact owner attempt.");
const filenameSchema = z.string().min(1).max(255).refine(isSafeFilename, "Use a portable filename basename without a path.");
const base64Schema = (maxLength: number) => z.string().min(4).max(maxLength).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u)
  .refine(isCanonicalBase64, "Image bytes must be canonical padded base64 within the local input bound.");
const promptSchema = z.string().min(1).max(OWNER_SEEDREAM_EDITOR_GENERATION_PROMPT_LOCAL_BOUND.max_utf8_bytes)
  .refine((value) => isWellFormedUnicode(value) && value.trim().length > 0 &&
    Buffer.byteLength(value, "utf8") <= OWNER_SEEDREAM_EDITOR_GENERATION_PROMPT_LOCAL_BOUND.max_utf8_bytes,
  "Prompt must be nonblank and within the local UTF-8 bound; its original text is preserved.");

function originalMimeSchema(variant: OwnerSeedreamImageVariant) {
  const values = [...OWNER_SEEDREAM_EDITOR_ORIGINAL_INPUT_POLICY.accepted_file_types_by_variant[variant]] as [string, ...string[]];
  return z.enum(values);
}
function originalUploadBranch(variant: OwnerSeedreamImageVariant) {
  return z.object({ link_attempt_id: attemptSchema, variant: z.literal(variant), content_base64: base64Schema(MAX_ORIGINAL_BASE64),
    filename: filenameSchema, mime_type: originalMimeSchema(variant) }).strict();
}
const originalUploadVariantSchema = z.discriminatedUnion("variant", [
  originalUploadBranch(VARIANTS[0]), originalUploadBranch(VARIANTS[1]), originalUploadBranch(VARIANTS[2]),
  originalUploadBranch(VARIANTS[3]), originalUploadBranch(VARIANTS[4])
]).superRefine((value, context) => {
  if (decodedBase64Length(value.content_base64) > OWNER_SEEDREAM_EDITOR_ORIGINAL_INPUT_POLICY.source_max_file_bytes_by_variant[value.variant]) {
    context.addIssue({ code: "custom", path: ["content_base64"], message: "The source UI input ceiling was exceeded." });
  }
});
const originalUploadVariantJson = z.toJSONSchema(originalUploadVariantSchema, { target: "draft-7", io: "input" }) as { oneOf?: unknown };
if (!Array.isArray(originalUploadVariantJson.oneOf) || originalUploadVariantJson.oneOf.length !== VARIANTS.length) {
  throw new Error("SEEDREAM_EDITOR_UPLOAD_SCHEMA_BRANCHES_INVALID");
}
const originalMimes = [...new Set(VARIANTS.flatMap((variant) =>
  [...OWNER_SEEDREAM_EDITOR_ORIGINAL_INPUT_POLICY.accepted_file_types_by_variant[variant]]))] as [string, ...string[]];
// The SDK advertises only object-shaped schemas; the exact union remains the validator.
const originalUploadInputSchema = z.object({ link_attempt_id: attemptSchema, variant: z.enum(VARIANTS),
  content_base64: base64Schema(MAX_ORIGINAL_BASE64), filename: filenameSchema, mime_type: z.enum(originalMimes)
}).strict().superRefine((value, context) => {
  const parsed = originalUploadVariantSchema.safeParse(value);
  if (!parsed.success) for (const issue of parsed.error.issues) {
    context.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
}).meta({ oneOf: originalUploadVariantJson.oneOf });
const drawingUploadInputSchema = z.object({ link_attempt_id: attemptSchema, variant: z.enum(VARIANTS), original_handle: originalHandleSchema,
  content_base64: base64Schema(MAX_DRAWING_BASE64), filename: filenameSchema, mime_type: z.literal("image/png") }).strict().superRefine((value, context) => {
  if (decodedBase64Length(value.content_base64) > OWNER_SEEDREAM_EDITOR_DRAWING_INPUT_POLICY.local_resource_bound_bytes) {
    context.addIssue({ code: "custom", path: ["content_base64"], message: "The local drawing resource bound was exceeded." });
  }
});

function parametersSchema(variant: OwnerSeedreamImageVariant) {
  const values = [...SOURCE.resolutions_by_variant[variant]] as [string, ...string[]];
  return z.object({ aspect_ratio: z.enum([...SOURCE.aspect_ratios] as [string, ...string[]]), resolution: z.enum(values) }).strict();
}
function generateBranch(variant: OwnerSeedreamImageVariant) {
  return z.object({ link_attempt_id: attemptSchema, variant: z.literal(variant), prompt: promptSchema, parameters: parametersSchema(variant),
    original_handle: originalHandleSchema, drawing_handle: drawingHandleSchema.nullable() }).strict();
}
const generateVariantSchema = z.discriminatedUnion("variant", [
  generateBranch(VARIANTS[0]), generateBranch(VARIANTS[1]), generateBranch(VARIANTS[2]), generateBranch(VARIANTS[3]), generateBranch(VARIANTS[4])
]);
const generateVariantJson = z.toJSONSchema(generateVariantSchema, { target: "draft-7", io: "input" }) as { oneOf?: unknown };
if (!Array.isArray(generateVariantJson.oneOf) || generateVariantJson.oneOf.length !== VARIANTS.length) {
  throw new Error("SEEDREAM_EDITOR_GENERATION_SCHEMA_BRANCHES_INVALID");
}
const resolutions = [...new Set(VARIANTS.flatMap((variant) => [...SOURCE.resolutions_by_variant[variant]]))] as [string, ...string[]];
const generateInputSchema = z.object({ link_attempt_id: attemptSchema, variant: z.enum(VARIANTS), prompt: promptSchema,
  parameters: z.object({ aspect_ratio: z.enum([...SOURCE.aspect_ratios] as [string, ...string[]]), resolution: z.enum(resolutions) }).strict(),
  original_handle: originalHandleSchema, drawing_handle: drawingHandleSchema.nullable()
}).strict().superRefine((value, context) => {
  const parsed = generateVariantSchema.safeParse(value);
  if (!parsed.success) for (const issue of parsed.error.issues) {
    context.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
}).meta({ oneOf: generateVariantJson.oneOf });
const reconcileInputSchema = z.object({ link_attempt_id: attemptSchema, recovery_id: recoveryIdSchema }).strict();
const recoveryListInputSchema = z.object({ link_attempt_id: attemptSchema, limit: z.number().int().min(1).max(128).optional() }).strict();
const resultPageInputSchema = z.object({ link_attempt_id: attemptSchema, result_id: resultIdSchema,
  offset: z.number().int().min(0).max(MAX_RESULT_ARTIFACTS), limit: z.number().int().min(1).max(RESULT_PAGE_SIZE).optional() }).strict();

const shaSchema = z.string().regex(SHA256);
const originalUploadOutputSchema = z.object({ status: z.literal("uploaded"), reference_handle: originalHandleSchema, variant: z.enum(VARIANTS),
  original_mime_type: z.string().regex(/^image\/[a-z0-9.+-]{1,64}$/u), mime_type: z.enum(CANONICAL_IMAGE_MIMES),
  width: z.number().int().positive().max(0xffff_ffff), height: z.number().int().positive().max(0xffff_ffff),
  size: z.number().int().positive().max(MAX_ORIGINAL_BYTES), sha256: shaSchema, expires_in_seconds: z.number().int().min(1).max(900),
  metadata_confidence: z.literal("CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS"),
  validation_confidence: z.enum(["JPEG_PNG_WEBP_STRUCTURAL_HEADER_ONLY", "AVIF_PRIMARY_ITEM_PROPERTY_ASSOCIATION_ONLY",
    "HEIF_PRIMARY_ITEM_PROPERTY_ASSOCIATION_ONLY", "BMP_HEADER_AND_PIXEL_EXTENT", "GIF_BLOCK_FRAMING_BOUNDED_FRAMES",
    "TIFF_IFD_AND_STRIP_EXTENTS_BOUNDED_PAGES"] as const) }).strict();
const drawingUploadOutputSchema = z.object({ status: z.literal("uploaded"), drawing_handle: drawingHandleSchema,
  original_handle: originalHandleSchema, variant: z.enum(VARIANTS), drawing_mime_type: z.literal("image/png"),
  original_mime_type: z.string().regex(/^image\/[a-z0-9.+-]{1,64}$/u), width: z.number().int().positive().max(0xffff_ffff),
  height: z.number().int().positive().max(0xffff_ffff), size: z.number().int().positive().max(OWNER_SEEDREAM_EDITOR_DRAWING_INPUT_POLICY.local_resource_bound_bytes),
  sha256: shaSchema, expires_in_seconds: z.number().int().min(1).max(900),
  metadata_confidence: z.literal("CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS"), pixel_decode_verified: z.literal(false), generation_permit: z.literal(false)
}).strict();
const costInputsSchema = z.union([z.object({}).strict(), z.object({ batch_size: z.union([z.literal(1), z.literal(2)]),
  resolution: z.enum(["1K", "1.5K", "2K", "3K", "4K"]) }).strict()]);
const artifactSchema = z.object({ url: z.string().url().max(4_096).refine(isSafeUploadReferenceUrl),
  mime_type: z.string().regex(/^image\/[a-z0-9.+-]{1,64}$/u).nullable(), width: z.null(), height: z.null(), geometry_verified: z.literal(false),
  message_id: z.string().regex(SAFE_ID), object_index: z.number().int().min(0).max(63), message_object_id: z.string().regex(SAFE_ID).nullable()
}).strict();
const generationOutputSchema = z.object({ status: z.enum(["completed", "partial_results"]),
  status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"), backend_acceptance: z.literal("UNPROVEN"), attempt_id: attemptSchema,
  variant: z.enum(VARIANTS), requested_model: z.enum(VARIANTS), model_echo: z.enum(["MATCHED", "UNKNOWN", "MISMATCH"]),
  profile_schema_hash: shaSchema, request_fingerprint: shaSchema, cost_inputs: costInputsSchema,
  cost_input_confidence: z.literal("SOURCE_JOINED_COST_QUERY_INPUTS_NOT_QUOTE_BILLING_OR_OUTPUT_COUNT"), result_id: resultIdSchema,
  observed_total: z.number().int().min(0).max(MAX_RESULT_ARTIFACTS), next_offset: z.number().int().min(1).max(MAX_RESULT_ARTIFACTS).nullable(),
  has_more: z.boolean(), artifacts: z.array(artifactSchema).max(RESULT_PAGE_SIZE), diagnostics: z.array(z.enum(DIAGNOSTICS)).max(256),
  recovery_id: recoveryIdSchema.optional()
}).strict().superRefine((value, context) => {
  if (value.variant !== value.requested_model || value.has_more !== (value.next_offset !== null) ||
      (value.has_more && value.next_offset !== value.artifacts.length) || (!value.has_more && value.observed_total !== value.artifacts.length) ||
      ((value.status === "partial_results") !== (value.recovery_id !== undefined))) {
    context.addIssue({ code: "custom", path: ["status"], message: "Observed result metadata is inconsistent." });
  }
  if (value.variant === "seedream-5.0-pro") {
    if (!("batch_size" in value.cost_inputs) || ![1, 2].includes(value.cost_inputs.batch_size) || typeof value.cost_inputs.resolution !== "string") {
      context.addIssue({ code: "custom", path: ["cost_inputs"], message: "Pro cost query metadata is incomplete." });
    }
  } else if (Object.keys(value.cost_inputs).length !== 0) {
    context.addIssue({ code: "custom", path: ["cost_inputs"], message: "This variant declares no cost-query inputs." });
  }
});
const recoveryListOutputSchema = z.object({ recoveries: z.array(z.object({ recovery_id: recoveryIdSchema, created_at: z.iso.datetime(),
  variant: z.enum(VARIANTS), status: z.literal("OUTCOME_UNKNOWN"), phase: z.enum(PHASES) }).strict()).max(128) }).strict();
const resultPageOutputSchema = z.object({ result_id: resultIdSchema, offset: z.number().int().min(0).max(MAX_RESULT_ARTIFACTS),
  limit: z.number().int().min(1).max(RESULT_PAGE_SIZE), observed_total: z.number().int().min(0).max(MAX_RESULT_ARTIFACTS),
  next_offset: z.number().int().min(1).max(MAX_RESULT_ARTIFACTS).nullable(), has_more: z.boolean(), artifacts: z.array(artifactSchema).max(RESULT_PAGE_SIZE)
}).strict().superRefine((value, context) => {
  const end = value.offset + value.artifacts.length;
  if (value.artifacts.length > value.limit || end > value.observed_total || value.offset > value.observed_total ||
      value.has_more !== (value.next_offset !== null) || (value.has_more && value.next_offset !== end) || (!value.has_more && end !== value.observed_total)) {
    context.addIssue({ code: "custom", path: ["next_offset"], message: "Cached result page metadata is inconsistent." });
  }
});

export const OWNER_SEEDREAM_EDITOR_IMAGE_TOOL_INPUT_SCHEMAS = Object.freeze({ source: sourceInputSchema,
  upload_original: originalUploadInputSchema, upload_drawing: drawingUploadInputSchema, generate: generateInputSchema,
  reconcile: reconcileInputSchema, list_recoveries: recoveryListInputSchema, get_result_page: resultPageInputSchema });
export const OWNER_SEEDREAM_EDITOR_IMAGE_TOOL_OUTPUT_SCHEMAS = Object.freeze({ source: sourceOutputSchema,
  upload_original: originalUploadOutputSchema, upload_drawing: drawingUploadOutputSchema, generate: generationOutputSchema,
  reconcile: generationOutputSchema, list_recoveries: recoveryListOutputSchema, get_result_page: resultPageOutputSchema });

const ERROR_MESSAGES = Object.freeze({
  INVALID_REQUEST: "The Seedream Editor request is invalid.", SERVICE_CLOSED: "The Seedream Editor service is closed.",
  SERVICE_BUSY: "The Seedream Editor service is busy; no automatic retry was made.", PRINCIPAL_NOT_LINKED: "The exact owner attempt is not currently linked.",
  PREFLIGHT_FAILED: "Current account or model access could not be verified.", INTENT_ALREADY_CLAIMED: "This intent has an unresolved outcome and cannot be replayed.",
  PRE_DISPATCH_FAILED: "The request was not safely dispatched.", OUTCOME_UNKNOWN: "The request may have been dispatched; reconcile it and do not retry.",
  RECOVERY_NOT_FOUND: "No matching process-local recovery is available for this attempt.", RESULT_NOT_FOUND: "No matching cached result is available for this attempt.",
  RESULT_PAGE_INVALID: "The requested cached result page is invalid.", CLOCK_INVALID: "The local clock could not be verified.",
  INVALID_IMAGE_INPUT: "The supplied image is invalid or unsupported.", LOCAL_RESOURCE_LIMIT_EXCEEDED: "The image exceeds a local resource bound.",
  UNSUPPORTED_IMAGE_COMPOSITION: "The image composition is not supported by the local validator.", PROFILE_BINDING_MISMATCH: "The source profile could not be verified.",
  CAPACITY_EXCEEDED: "The owner image service capacity is full.", REQUEST_ABORTED: "The operation was aborted; inspect its outcome before retrying.",
  REFERENCE_UNAVAILABLE: "A reference handle is unavailable for this attempt.", REFERENCE_EXPIRED: "A reference handle expired or is no longer available.",
  UPLOAD_REJECTED: "The image upload was rejected before a handle was issued.", UPLOAD_OUTCOME_UNKNOWN: "The upload outcome is unknown; do not repeat it automatically.",
  UPLOAD_FAILED: "The Seedream Editor image upload failed safely.", GENERATION_FAILED: "The Seedream Editor generation could not be confirmed safely.",
  RECOVERY_LIST_UNAVAILABLE: "Seedream Editor recovery handles are unavailable.", RESULT_PAGE_UNAVAILABLE: "The cached Seedream Editor result page is unavailable."
});
type ToolErrorCode = keyof typeof ERROR_MESSAGES;
const ORIGINAL_ERROR_CODES = ["INVALID_REQUEST", "INVALID_IMAGE_INPUT", "LOCAL_RESOURCE_LIMIT_EXCEEDED", "UNSUPPORTED_IMAGE_COMPOSITION",
  "PRINCIPAL_NOT_LINKED", "PROFILE_BINDING_MISMATCH", "SERVICE_BUSY", "CAPACITY_EXCEEDED", "SERVICE_CLOSED", "REQUEST_ABORTED",
  "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED", "UPLOAD_REJECTED", "UPLOAD_OUTCOME_UNKNOWN"] as const;
const DRAWING_ERROR_CODES = ["INVALID_REQUEST", "INVALID_IMAGE_INPUT", "LOCAL_RESOURCE_LIMIT_EXCEEDED", "PRINCIPAL_NOT_LINKED",
  "PROFILE_BINDING_MISMATCH", "SERVICE_BUSY", "CAPACITY_EXCEEDED", "SERVICE_CLOSED", "REQUEST_ABORTED", "REFERENCE_UNAVAILABLE",
  "REFERENCE_EXPIRED", "UPLOAD_REJECTED", "UPLOAD_OUTCOME_UNKNOWN"] as const;

export function registerSyntxOwnerSeedreamEditorImageTools(server: McpServer, optionsInput: RegisterSyntxOwnerSeedreamEditorImageToolsOptions | unknown): void {
  const options = readRegistrationOptions(optionsInput);
  const original = options.originalReferenceService, drawing = options.drawingReferenceService, generation = options.generationService;
  const generate = generation.generate, reconcile = generation.reconcile, listRecoveries = generation.listRecoveries, getResultPage = generation.getResultPage;

  server.registerTool(SYNTX_GET_SEEDREAM_EDITOR_IMAGE_PARAMETERS_TOOL_NAME, {
    title: "Read Seedream Editor image controls",
    description: "Returns the source-backed Editor variants, exact aspect-ratio and resolution controls, prompt guard, and cost-query semantics. This read does not inspect an account or authorize generation.",
    inputSchema: sourceInputSchema, outputSchema: sourceOutputSchema, annotations: annotations("Read Seedream Editor controls", true, false, false)
  }, async (input) => {
    const parsed = safeParseInput(sourceInputSchema, input);
    if (!parsed) return errorResult(undefined, "INVALID_REQUEST");
    const variants = VARIANTS.map((variant) => ({ variant, aspect_ratios: [...SOURCE.aspect_ratios], resolutions: [...SOURCE.resolutions_by_variant[variant]] }));
    const output = { profile_id: SOURCE.profile_id, variants, controls: ["aspect_ratio", "resolution"] as const,
      prompt: { required: true as const, whitespace: "PRESERVED" as const,
        max_utf8_bytes: OWNER_SEEDREAM_EDITOR_GENERATION_PROMPT_LOCAL_BOUND.max_utf8_bytes,
        limit_scope: "LOCAL_RESOURCE_BOUND_NOT_SOURCE_OR_PROVIDER_LIMIT" as const },
      cost_query: { status: "SOURCE_JOINED_COST_QUERY_INPUTS" as const, pro_keys: ["batch_size", "resolution"] as const,
        pro_batch_size: "DERIVED_FROM_GENUINE_DRAWING_HANDLE_PRESENCE_NOT_OUTPUT_COUNT" as const, other_variant_keys: [] as const },
      effective_defaults: "UNPROVEN" as const, dispatch_allowed: false as const, runtime_usable: false as const, backend_acceptance: "UNPROVEN" as const };
    return structured(parseSafeOutput(sourceOutputSchema, output));
  });

  server.registerTool(SYNTX_UPLOAD_SEEDREAM_EDITOR_ORIGINAL_TOOL_NAME, {
    title: "Upload a Seedream Editor original image",
    description: "Uploads one locally bounded source image for the exact linked owner attempt and Editor variant. Returns an opaque private handle and container metadata; upload alone does not authorize generation.",
    inputSchema: originalUploadInputSchema, outputSchema: originalUploadOutputSchema, annotations: annotations("Upload Editor original", false, true, true)
  }, async (input, { signal }) => {
    const parsed = safeParseInput(originalUploadInputSchema, input);
    if (!parsed) return errorResult(undefined, "INVALID_REQUEST", "UPLOAD_FAILED");
    try {
      const receipt = await Reflect.apply(ORIGINAL_UPLOAD, original, [{ attemptId: parsed.link_attempt_id, variant: parsed.variant,
        content_base64: parsed.content_base64, filename: parsed.filename, mime_type: parsed.mime_type, ...(signal ? { signal } : {}) }]) as OwnerSeedreamEditorOriginalUploadReceipt;
      return structured(parseSafeOutput(originalUploadOutputSchema, receipt));
    } catch (error) { return errorResult(error, "UPLOAD_FAILED", "UPLOAD_FAILED", ORIGINAL_ERROR_CODES); }
  });

  server.registerTool(SYNTX_UPLOAD_SEEDREAM_EDITOR_DRAWING_TOOL_NAME, {
    title: "Upload a Seedream Editor drawing",
    description: "Uploads one PNG drawing paired to the exact genuine original handle, variant, and linked owner attempt. Drawing is an image extra, not a mask or generation grant.",
    inputSchema: drawingUploadInputSchema, outputSchema: drawingUploadOutputSchema, annotations: annotations("Upload Editor drawing", false, true, true)
  }, async (input, { signal }) => {
    const parsed = safeParseInput(drawingUploadInputSchema, input);
    if (!parsed) return errorResult(undefined, "INVALID_REQUEST", "UPLOAD_FAILED");
    try {
      const receipt = await Reflect.apply(DRAWING_UPLOAD, drawing, [{ attemptId: parsed.link_attempt_id, variant: parsed.variant,
        original_handle: parsed.original_handle, content_base64: parsed.content_base64, filename: parsed.filename,
        mime_type: parsed.mime_type, ...(signal ? { signal } : {}) }]) as OwnerSeedreamEditorDrawingUploadReceipt;
      return structured(parseSafeOutput(drawingUploadOutputSchema, { status: receipt.status, drawing_handle: receipt.drawing_handle,
        original_handle: receipt.original_handle, variant: receipt.variant, drawing_mime_type: receipt.drawing_mime_type,
        original_mime_type: receipt.original_mime_type, width: receipt.width, height: receipt.height, size: receipt.size,
        sha256: receipt.sha256, expires_in_seconds: receipt.expires_in_seconds, metadata_confidence: receipt.metadata_confidence,
        pixel_decode_verified: false, generation_permit: false }));
    } catch (error) { return errorResult(error, "UPLOAD_FAILED", "UPLOAD_FAILED", DRAWING_ERROR_CODES); }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_SEEDREAM_EDITOR_IMAGE_TOOL_NAME, {
    title: "Generate a Seedream Editor image",
    description: "Starts one generation from genuine original and optional drawing handles after fresh account and model-access checks. Availability means locally observed image results only; provider completion, output count, and billing remain unproven. Never repeat an unknown generation call.",
    inputSchema: generateInputSchema, outputSchema: generationOutputSchema, annotations: annotations("Generate Seedream Editor image", false, true, true)
  }, async (input, { signal }) => {
    const parsed = safeParseInput(generateInputSchema, input);
    if (!parsed) return errorResult(undefined, "INVALID_REQUEST", "GENERATION_FAILED");
    try {
      const result = await Reflect.apply(generate, generation, [{ attemptId: parsed.link_attempt_id, input: {
        variant: parsed.variant, prompt: parsed.prompt, parameters: parsed.parameters, original_handle: parsed.original_handle,
        drawing_handle: parsed.drawing_handle
      } }, ...(signal ? [signal] : [])]) as OwnerSeedreamEditorImageGenerationResult;
      return structured(parseSafeOutput(generationOutputSchema, result));
    } catch (error) { return errorResult(error, "GENERATION_FAILED", "GENERATION_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_SEEDREAM_EDITOR_IMAGE_TOOL_NAME, {
    title: "Reconcile a Seedream Editor generation",
    description: "Performs bounded GET-only reconciliation of the exact owner attempt and process-local recovery handle. It never creates another generation.",
    inputSchema: reconcileInputSchema, outputSchema: generationOutputSchema, annotations: annotations("Reconcile Seedream Editor generation", true, false, true)
  }, async (input, { signal }) => {
    const parsed = safeParseInput(reconcileInputSchema, input);
    if (!parsed) return errorResult(undefined, "INVALID_REQUEST", "GENERATION_FAILED");
    try {
      const result = await Reflect.apply(reconcile, generation,
        [{ attemptId: parsed.link_attempt_id, recovery_id: parsed.recovery_id }, ...(signal ? [signal] : [])]) as OwnerSeedreamEditorImageGenerationResult;
      return structured(parseSafeOutput(generationOutputSchema, result));
    } catch (error) { return errorResult(error, "GENERATION_FAILED", "GENERATION_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_LIST_SEEDREAM_EDITOR_IMAGE_RECOVERIES_TOOL_NAME, {
    title: "List Seedream Editor recovery handles",
    description: "Lists bounded process-local recovery diagnostics for this exact owner attempt. It returns no principal, prompt, or private file URL.",
    inputSchema: recoveryListInputSchema, outputSchema: recoveryListOutputSchema, annotations: annotations("List Editor recovery handles", true, false, true)
  }, async (input) => {
    const parsed = safeParseInput(recoveryListInputSchema, input);
    if (!parsed) return errorResult(undefined, "INVALID_REQUEST", "RECOVERY_LIST_UNAVAILABLE");
    try {
      const items = await Reflect.apply(listRecoveries, generation, [{ attemptId: parsed.link_attempt_id,
        ...(parsed.limit === undefined ? {} : { limit: parsed.limit }) }]) as readonly OwnerSeedreamEditorImageRecoveryListItem[];
      return structured(parseSafeOutput(recoveryListOutputSchema, { recoveries: items }));
    } catch (error) { return errorResult(error, "RECOVERY_LIST_UNAVAILABLE", "RECOVERY_LIST_UNAVAILABLE"); }
  });

  server.registerTool(SYNTX_OWNER_GET_SEEDREAM_EDITOR_IMAGE_RESULT_PAGE_TOOL_NAME, {
    title: "Read a Seedream Editor result page",
    description: "Reads one bounded page from the exact owner's cached result observations. Paging issues no provider GET or generation POST; continue with next_offset while has_more is true.",
    inputSchema: resultPageInputSchema, outputSchema: resultPageOutputSchema, annotations: annotations("Read cached Editor result page", true, false, false)
  }, async (input, { signal }) => {
    const parsed = safeParseInput(resultPageInputSchema, input);
    if (!parsed) return errorResult(undefined, "INVALID_REQUEST", "RESULT_PAGE_INVALID");
    try {
      const page = await Reflect.apply(getResultPage, generation, [{ attemptId: parsed.link_attempt_id, result_id: parsed.result_id,
        offset: parsed.offset, ...(parsed.limit === undefined ? {} : { limit: parsed.limit }) }, ...(signal ? [signal] : [])]) as OwnerSeedreamEditorImageResultPage;
      return structured(parseSafeOutput(resultPageOutputSchema, page));
    } catch (error) { return errorResult(error, "RESULT_PAGE_UNAVAILABLE", "RESULT_PAGE_UNAVAILABLE"); }
  });
}

function readRegistrationOptions(value: unknown): Readonly<RegisterSyntxOwnerSeedreamEditorImageToolsOptions> {
  const fields = exactRecord(value, ["originalReferenceService", "drawingReferenceService", "generationService"]);
  const original = fields.originalReferenceService, drawing = fields.drawingReferenceService, generation = fields.generationService;
  if (!isActualService(original, OwnerSeedreamEditorOriginalReferenceService, "upload", ORIGINAL_UPLOAD) ||
      !isActualService(drawing, OwnerSeedreamEditorDrawingReferenceService, "uploadDrawing", DRAWING_UPLOAD) ||
      !isOwnerSeedreamEditorImageGenerationService(generation)) throw new Error("SEEDREAM_EDITOR_SERVICE_COMPOSITION_INVALID");
  for (const method of ["generate", "reconcile", "listRecoveries", "getResultPage"] as const) {
    if (typeof generation[method] !== "function") throw new Error("SEEDREAM_EDITOR_SERVICE_COMPOSITION_INVALID");
  }
  return Object.freeze({ originalReferenceService: original as OwnerSeedreamEditorOriginalReferenceService,
    drawingReferenceService: drawing as OwnerSeedreamEditorDrawingReferenceService,
    generationService: generation as OwnerSeedreamEditorImageGenerationService });
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) throw new Error("SEEDREAM_EDITOR_SERVICE_COMPOSITION_INVALID");
  let prototype: object | null, descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); }
  catch { throw new Error("SEEDREAM_EDITOR_SERVICE_COMPOSITION_INVALID"); }
  const ownKeys = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable)) {
    throw new Error("SEEDREAM_EDITOR_SERVICE_COMPOSITION_INVALID");
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key]!.value]));
}
function isActualService<T extends object>(value: unknown, ctor: new (...args: never[]) => T, method: string, captured: Function): value is T {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== ctor.prototype || !(value instanceof ctor)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(ctor.prototype, method);
  return !!descriptor && "value" in descriptor && descriptor.value === captured &&
    (value as Record<string, unknown>)[method] === captured;
}

function safeParseInput<T>(schema: z.ZodType<T>, input: unknown): T | undefined {
  const copy = snapshotSafeValue(input);
  if (copy === undefined) return undefined;
  const result = schema.safeParse(copy);
  return result.success ? result.data : undefined;
}
function parseSafeOutput<T>(schema: z.ZodType<T>, value: unknown): T {
  const copy = snapshotSafeValue(value);
  if (copy === undefined) throw new Error("UNSAFE_SERVICE_OUTPUT");
  return schema.parse(copy);
}
function snapshotSafeValue(value: unknown): unknown {
  const seen = new WeakSet<object>();
  let nodes = 0;
  const copy = (item: unknown, depth: number): unknown => {
    nodes += 1;
    if (depth > 8 || nodes > 4_096) throw new Error("UNSAFE_TOOL_DATA");
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "string") return item.length <= MAX_ORIGINAL_BASE64 ? item : failUnsafe();
    if (typeof item === "number") return Number.isFinite(item) ? item : failUnsafe();
    if (!item || typeof item !== "object" || types.isProxy(item) || seen.has(item)) return failUnsafe();
    seen.add(item);
    try {
      if (Array.isArray(item)) {
        if (Object.getPrototypeOf(item) !== Array.prototype || item.length > 1_024) return failUnsafe();
        const descriptors = Object.getOwnPropertyDescriptors(item), ownKeys = Reflect.ownKeys(descriptors);
        if (ownKeys.length !== item.length + 1 || ownKeys.some((key) => key !== "length" && (typeof key !== "string" ||
            !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= item.length || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable))) return failUnsafe();
        return Array.from({ length: item.length }, (_, index) => {
          const d = descriptors[String(index)]; if (!d || !("value" in d) || !d.enumerable) return failUnsafe();
          return copy(d.value, depth + 1);
        });
      }
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) return failUnsafe();
      const descriptors = Object.getOwnPropertyDescriptors(item), ownKeys = Reflect.ownKeys(descriptors);
      if (ownKeys.length > 256 || ownKeys.some((key) => typeof key !== "string" || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable)) return failUnsafe();
      const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of ownKeys as string[]) out[key] = copy(descriptors[key]!.value, depth + 1);
      return out;
    } finally { seen.delete(item); }
  };
  try { return copy(value, 0); } catch { return undefined; }
}
function failUnsafe(): never { throw new Error("UNSAFE_TOOL_DATA"); }
function ownData(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || types.isProxy(value)) return undefined;
  try { const d = Object.getOwnPropertyDescriptor(value, key); return d && "value" in d ? d.value : undefined; }
  catch { return undefined; }
}

function errorResult(error: unknown, fallback: ToolErrorCode, operationFallback: ToolErrorCode = fallback,
  allowed: readonly string[] = OWNER_SEEDREAM_EDITOR_IMAGE_GENERATION_ERROR_CODES): CallToolResult {
  let code = fallback, recoveryId: string | undefined;
  if (error && typeof error === "object" && !types.isProxy(error)) {
    if (error instanceof OwnerSeedreamEditorImageGenerationServiceError) {
      const candidate = ownData(error, "code");
      if (typeof candidate === "string" && allowed.includes(candidate)) {
        code = candidate as ToolErrorCode;
        if (candidate === "OUTCOME_UNKNOWN") {
          const id = ownData(error, "recovery_id");
          if (typeof id === "string" && RECOVERY_ID.test(id)) recoveryId = id;
          else code = operationFallback;
        }
      }
    } else if (error instanceof OwnerSeedreamEditorOriginalReferenceServiceError) {
      const candidate = ownData(error, "code");
      if (typeof candidate === "string" && ORIGINAL_ERROR_CODES.includes(candidate as never)) code = candidate as ToolErrorCode;
    } else if (error instanceof OwnerSeedreamEditorDrawingReferenceServiceError) {
      const candidate = ownData(error, "code");
      if (typeof candidate === "string" && DRAWING_ERROR_CODES.includes(candidate as never)) code = candidate as ToolErrorCode;
    }
  }
  if (!Object.hasOwn(ERROR_MESSAGES, code)) code = operationFallback;
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message: ERROR_MESSAGES[code],
    ...(code === "OUTCOME_UNKNOWN" && recoveryId ? { recovery_id: recoveryId } : {}) } }) }] };
}
function structured(value: object): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> };
}
function annotations(title: string, readOnly: boolean, destructive: boolean, openWorld: boolean) {
  return { title, readOnlyHint: readOnly, destructiveHint: destructive, idempotentHint: readOnly, openWorldHint: openWorld };
}
function decodedBase64Length(value: string): number {
  if (value.length === 0 || value.length % 4 !== 0) return 0;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return value.length / 4 * 3 - padding;
}
function isCanonicalBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  let padding = 0;
  if (value.endsWith("==")) padding = 2; else if (value.endsWith("=")) padding = 1;
  const dataEnd = value.length - padding;
  for (let i = 0; i < dataEnd; i += 1) {
    const code = value.charCodeAt(i);
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 43 || code === 47)) return false;
  }
  for (let i = dataEnd; i < value.length; i += 1) if (value.charCodeAt(i) !== 61) return false;
  if (padding === 2) return base64Index(value.charCodeAt(dataEnd - 1)) % 16 === 0;
  if (padding === 1) return base64Index(value.charCodeAt(dataEnd - 1)) % 4 === 0;
  return true;
}
function base64Index(code: number): number {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  return code === 43 ? 62 : code === 47 ? 63 : -1;
}
function isSafeFilename(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && value === value.trimEnd() && !value.endsWith(".") &&
    !/[\p{Cc}\p{Cf}\p{Cs}<>:"/\\|?*]/u.test(value) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(value) &&
    isWellFormedUnicode(value) && Buffer.byteLength(value, "utf8") <= 255;
}
function isWellFormedUnicode(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(i + 1); if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return false; i += 1; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
