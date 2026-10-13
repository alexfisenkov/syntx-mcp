import { types } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import {
  OWNER_BANANA_INPAINT_IMAGE_GENERATION_ERROR_CODES,
  OWNER_BANANA_INPAINT_IMAGE_GENERATION_PHASES,
  OwnerBananaInpaintImageGenerationServiceError,
  type OwnerBananaInpaintImageGenerationService
} from "../application/owner-banana-inpaint-image-generation-service.js";
import {
  OwnerBananaInpaintOriginalReferenceService,
  OwnerBananaInpaintOriginalReferenceServiceError,
  type OwnerBananaInpaintOriginalReferenceServiceErrorCode
} from "../application/owner-banana-inpaint-original-reference-service.js";
import {
  OwnerBananaInpaintPaintedCompositeReferenceService,
  OwnerBananaInpaintPaintedCompositeReferenceServiceError,
  type OwnerBananaInpaintPaintedCompositeReferenceServiceErrorCode
} from "../application/owner-banana-inpaint-painted-composite-reference-service.js";
import {
  OwnerBananaInpaintAuxiliaryReferenceService,
  OwnerBananaInpaintAuxiliaryReferenceServiceError,
  type OwnerBananaInpaintAuxiliaryReferenceServiceErrorCode
} from "../application/owner-banana-inpaint-auxiliary-reference-service.js";
import { normalizeOwnerBananaInpaintPrompt, OWNER_BANANA_INPAINT_IMAGE_VARIANTS } from "../application/owner-banana-inpaint-image-source-profile.js";
import { OWNER_BANANA_INPAINT_ORIGINAL_INPUT_POLICY } from "../application/owner-banana-inpaint-original-validator.js";
import { OWNER_BANANA_INPAINT_PAINTED_COMPOSITE_INPUT_POLICY } from "../application/owner-banana-inpaint-painted-composite-input-validator.js";
import { OWNER_BANANA_INPAINT_AUXILIARY_INPUT_POLICY } from "../application/owner-banana-inpaint-auxiliary-input-validator.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const ORIGINAL_HANDLE = /^banana_inpaint_original_[0-9a-f-]{36}$/u;
const PAINTED_HANDLE = /^banana_inpaint_painted_[0-9a-f-]{36}$/u;
const AUXILIARY_HANDLE = /^banana_inpaint_auxiliary_[0-9a-f-]{36}$/u;
const RECOVERY_ID = /^banana_inpaint_recovery_[0-9a-f-]{36}$/u;
const RESULT_ID = /^banana_inpaint_result_[0-9a-f-]{36}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4;
const RESULT_PAGE_SIZE = 64;
const MAX_OBSERVED_RESULT_ARTIFACTS = 256 * 64 * 32;
const VARIANTS = OWNER_BANANA_INPAINT_IMAGE_VARIANTS;
const AUXILIARY_MIME_TYPES = OWNER_BANANA_INPAINT_AUXILIARY_INPUT_POLICY.accepted_local_original_mime_types;

export const SYNTX_UPLOAD_BANANA_INPAINT_ORIGINAL_TOOL_NAME = "syntx_upload_banana_inpaint_original" as const;
export const SYNTX_UPLOAD_BANANA_INPAINT_PAINTED_COMPOSITE_TOOL_NAME = "syntx_upload_banana_inpaint_painted_composite" as const;
export const SYNTX_UPLOAD_BANANA_INPAINT_AUXILIARY_REFERENCE_TOOL_NAME = "syntx_upload_banana_inpaint_auxiliary_reference" as const;
export const SYNTX_OWNER_GENERATE_BANANA_INPAINT_IMAGE_TOOL_NAME = "syntx_owner_generate_banana_inpaint_image" as const;
export const SYNTX_OWNER_RECONCILE_BANANA_INPAINT_IMAGE_TOOL_NAME = "syntx_owner_reconcile_banana_inpaint_image" as const;
export const SYNTX_OWNER_LIST_BANANA_INPAINT_IMAGE_RECOVERIES_TOOL_NAME = "syntx_owner_list_banana_inpaint_image_recoveries" as const;
export const SYNTX_OWNER_GET_BANANA_INPAINT_IMAGE_RESULT_PAGE_TOOL_NAME = "syntx_owner_get_banana_inpaint_image_result_page" as const;
export const OWNER_BANANA_INPAINT_IMAGE_TOOL_NAMES = Object.freeze([
  SYNTX_UPLOAD_BANANA_INPAINT_ORIGINAL_TOOL_NAME,
  SYNTX_UPLOAD_BANANA_INPAINT_PAINTED_COMPOSITE_TOOL_NAME,
  SYNTX_UPLOAD_BANANA_INPAINT_AUXILIARY_REFERENCE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_BANANA_INPAINT_IMAGE_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_BANANA_INPAINT_IMAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_BANANA_INPAINT_IMAGE_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_GET_BANANA_INPAINT_IMAGE_RESULT_PAGE_TOOL_NAME
] as const);

export interface RegisterSyntxOwnerBananaInpaintImageToolsOptions {
  readonly originalReferenceService: Pick<OwnerBananaInpaintOriginalReferenceService, "upload">;
  readonly paintedCompositeReferenceService: Pick<OwnerBananaInpaintPaintedCompositeReferenceService, "uploadPaintedComposite">;
  readonly auxiliaryReferenceService: Pick<OwnerBananaInpaintAuxiliaryReferenceService, "upload">;
  readonly generationService: Pick<OwnerBananaInpaintImageGenerationService,
    "generate" | "reconcile" | "listRecoveries" | "getResultPage">;
}

const attemptSchema = z.string().regex(ATTEMPT).describe("Exact linked owner attempt; it does not select a provider or another account.");
const originalHandleSchema = z.string().regex(ORIGINAL_HANDLE).describe("Opaque original-image handle issued for this owner attempt.");
const paintedHandleSchema = z.string().regex(PAINTED_HANDLE).describe("Opaque painted-composite handle bound to this original image and owner attempt.");
const auxiliaryHandleSchema = z.string().regex(AUXILIARY_HANDLE).describe("Opaque optional auxiliary-image handle issued for this owner attempt.");
const recoverySchema = z.string().regex(RECOVERY_ID).describe("Process-local recovery handle for the exact linked owner attempt; never retry an unknown POST.");
const resultIdSchema = z.string().regex(RESULT_ID).describe("Opaque service-issued handle for paging all result objects observed for this exact owner intent.");
const filenameSchema = z.string().min(1).max(255).refine(isSafeFilename, "Use a portable image filename without a path.");
const base64Schema = z.string().min(4).max(MAX_BASE64_CHARS)
  .refine(isCanonicalBase64, "Image bytes must be canonical base64 within the local upload ceiling.");
const originalMimeSchema = z.enum(OWNER_BANANA_INPAINT_ORIGINAL_INPUT_POLICY.accepted_mime_types);
const auxiliaryMimeSchema = z.enum(AUXILIARY_MIME_TYPES);

const originalUploadInputSchema = z.object({
  link_attempt_id: attemptSchema,
  variant: z.enum(VARIANTS),
  content_base64: base64Schema,
  filename: filenameSchema,
  mime_type: originalMimeSchema
}).strict().superRefine((input, context) => {
  if (decodedBase64Length(input.content_base64) > OWNER_BANANA_INPAINT_ORIGINAL_INPUT_POLICY.max_file_size_bytes) {
    context.addIssue({ code: "custom", path: ["content_base64"], message: "Image exceeds the local original-input ceiling." });
  }
});

const paintedUploadInputSchema = z.object({
  link_attempt_id: attemptSchema,
  variant: z.enum(VARIANTS),
  original_handle: originalHandleSchema,
  content_base64: base64Schema,
  filename: filenameSchema,
  mime_type: z.literal("image/png")
}).strict().superRefine((input, context) => {
  if (decodedBase64Length(input.content_base64) > OWNER_BANANA_INPAINT_PAINTED_COMPOSITE_INPUT_POLICY.local_resource_bound_bytes) {
    context.addIssue({ code: "custom", path: ["content_base64"], message: "Image exceeds the local painted-composite ceiling." });
  }
});

const auxiliaryUploadInputSchema = z.object({
  link_attempt_id: attemptSchema,
  variant: z.enum(VARIANTS),
  content_base64: base64Schema,
  filename: filenameSchema,
  mime_type: auxiliaryMimeSchema
}).strict().superRefine((input, context) => {
  const bytes = decodedBase64Length(input.content_base64);
  const mimeLimit = auxiliaryParserCeiling(input.mime_type);
  if (bytes > OWNER_BANANA_INPAINT_AUXILIARY_INPUT_POLICY.local_resource_bound_bytes || bytes > mimeLimit) {
    context.addIssue({ code: "custom", path: ["content_base64"], message: "Image exceeds the local auxiliary-input ceiling." });
  }
});

const promptSchema = z.string().min(1).max(65_536).refine((prompt) => prompt.trim().length > 0,
  "Prompt must be nonblank and fit the local resource bound; its original text is preserved.");
const generateFields = {
  link_attempt_id: attemptSchema,
  prompt: promptSchema,
  original_handle: originalHandleSchema,
  painted_handle: paintedHandleSchema,
  auxiliary_reference_handle: auxiliaryHandleSchema.nullable()
};
const GENERATE_IMAGE_SIZES = ["0.5K", "1K", "2K", "4K"] as const;
const generateVariantSchema = z.discriminatedUnion("variant", [
  z.object({ ...generateFields, variant: z.literal("banana"), image_size: z.null() }).strict(),
  z.object({ ...generateFields, variant: z.literal("banana2"), image_size: z.enum(["1K", "2K", "4K"]) }).strict(),
  z.object({ ...generateFields, variant: z.literal("banana3"), image_size: z.enum(["0.5K", "1K", "2K", "4K"]) }).strict(),
  z.object({ ...generateFields, variant: z.literal("banana3_light"), image_size: z.literal("1K") }).strict()
]).superRefine((input, context) => {
  try { normalizeOwnerBananaInpaintPrompt({ variant: input.variant, prompt: input.prompt }); }
  catch { context.addIssue({ code: "custom", path: ["prompt"], message: "The explicit prompt is invalid for Banana Inpaint." }); }
});
const generateVariantJsonSchema = z.toJSONSchema(generateVariantSchema, { target: "draft-7", io: "input" }) as { oneOf?: unknown };
if (!Array.isArray(generateVariantJsonSchema.oneOf) || generateVariantJsonSchema.oneOf.length !== 4) {
  throw new Error("BANANA_INPAINT_GENERATION_SCHEMA_BRANCHES_INVALID");
}
const generateInputSchema = z.object({
  ...generateFields,
  variant: z.enum(VARIANTS),
  image_size: z.union([z.null(), z.enum(GENERATE_IMAGE_SIZES)])
}).strict().superRefine((input, context) => {
  const parsed = generateVariantSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) context.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
}).meta({ oneOf: generateVariantJsonSchema.oneOf });

const reconcileInputSchema = z.object({ link_attempt_id: attemptSchema, recovery_id: recoverySchema }).strict();
const listRecoveriesInputSchema = z.object({ link_attempt_id: attemptSchema, limit: z.number().int().min(1).max(64).optional() }).strict();
const resultPageInputSchema = z.object({
  link_attempt_id: attemptSchema,
  result_id: resultIdSchema,
  offset: z.number().int().min(0).max(MAX_OBSERVED_RESULT_ARTIFACTS),
  limit: z.number().int().min(1).max(RESULT_PAGE_SIZE)
}).strict();

const shaSchema = z.string().regex(SHA256);
const originalUploadOutputSchema = z.object({
  status: z.literal("uploaded"), reference_handle: originalHandleSchema, variant: z.enum(VARIANTS),
  original_mime_type: originalMimeSchema, mime_type: originalMimeSchema,
  width: z.number().int().positive().max(0xffff_ffff), height: z.number().int().positive().max(0xffff_ffff),
  size: z.number().int().positive().max(50 * 1024 * 1024), sha256: shaSchema,
  expires_in_seconds: z.number().int().min(1).max(900),
  metadata_confidence: z.literal("CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS"),
  validation_scope: z.literal("BANANA_INPAINT_ORIGINAL_UI_FILE_INPUT_ONLY")
}).strict();
const paintedUploadOutputSchema = z.object({
  status: z.literal("uploaded"), painted_handle: paintedHandleSchema, original_handle: originalHandleSchema,
  variant: z.enum(VARIANTS), mime_type: z.literal("image/png"),
  width: z.number().int().positive().max(0xffff_ffff), height: z.number().int().positive().max(0xffff_ffff),
  size: z.number().int().positive().max(50 * 1024 * 1024), sha256: shaSchema,
  expires_in_seconds: z.number().int().min(1).max(900),
  metadata_confidence: z.literal("CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS"),
  geometry_confidence: z.literal("CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS")
}).strict();
const auxiliaryUploadOutputSchema = z.object({
  status: z.literal("uploaded"), reference_handle: auxiliaryHandleSchema, variant: z.enum(VARIANTS),
  original_mime_type: auxiliaryMimeSchema, mime_type: z.string().regex(/^image\/[a-z0-9.+-]{1,64}$/u),
  width: z.number().int().positive().max(0xffff_ffff), height: z.number().int().positive().max(0xffff_ffff),
  size: z.number().int().positive().max(50 * 1024 * 1024), sha256: shaSchema,
  expires_in_seconds: z.number().int().min(1).max(900),
  metadata_confidence: z.literal("CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS"),
  validation_confidence: z.string().min(1).max(160), generation_permit: z.literal(false)
}).strict();
const artifactSchema = z.object({
  url: z.string().url().max(4_096).refine(isSafeUploadReferenceUrl),
  mime_type: z.null(), width: z.null(), height: z.null(), geometry_verified: z.literal(false),
  message_id: z.string().regex(SAFE_ID), object_index: z.number().int().min(0).max(63)
}).strict();
const generationOutputSchema = z.object({
  status: z.enum(["result_observed", "partial_results"]), backend_acceptance: z.literal("UNPROVEN"), provider_execution: z.literal(false),
  attempt_id: attemptSchema, variant: z.enum(VARIANTS), ai_name: z.literal("banana"), model_type: z.enum(VARIANTS),
  result_id: resultIdSchema,
  observed_total: z.number().int().min(0).max(MAX_OBSERVED_RESULT_ARTIFACTS),
  next_offset: z.number().int().min(1).max(MAX_OBSERVED_RESULT_ARTIFACTS).nullable(),
  has_more: z.boolean(),
  artifacts: z.array(artifactSchema).max(RESULT_PAGE_SIZE), recovery_id: recoverySchema.optional()
}).strict().superRefine((result, context) => {
  if ((result.status === "partial_results") !== (result.recovery_id !== undefined) || result.variant !== result.model_type) {
    context.addIssue({ code: "custom", path: ["recovery_id"], message: "Recovery state and model binding must match the observed Inpaint result." });
  }
  if (result.has_more !== (result.next_offset !== null) ||
      (result.has_more && result.next_offset !== result.artifacts.length) ||
      (!result.has_more && result.observed_total !== result.artifacts.length)) {
    context.addIssue({ code: "custom", path: ["next_offset"], message: "The first result page must preserve all observed page metadata." });
  }
});
const resultPageOutputSchema = z.object({
  result_id: resultIdSchema,
  offset: z.number().int().min(0).max(MAX_OBSERVED_RESULT_ARTIFACTS),
  limit: z.number().int().min(1).max(RESULT_PAGE_SIZE),
  observed_total: z.number().int().min(0).max(MAX_OBSERVED_RESULT_ARTIFACTS),
  next_offset: z.number().int().min(1).max(MAX_OBSERVED_RESULT_ARTIFACTS).nullable(),
  has_more: z.boolean(),
  artifacts: z.array(artifactSchema).max(RESULT_PAGE_SIZE)
}).strict().superRefine((page, context) => {
  const pageEnd = page.offset + page.artifacts.length;
  if (page.offset > page.observed_total || page.artifacts.length > page.limit || pageEnd > page.observed_total ||
      page.has_more !== (page.next_offset !== null) ||
      (page.has_more && page.next_offset !== pageEnd) || (!page.has_more && pageEnd !== page.observed_total)) {
    context.addIssue({ code: "custom", path: ["next_offset"], message: "The result page metadata is inconsistent." });
  }
});
const recoveryListOutputSchema = z.object({ recoveries: z.array(z.object({
  recovery_id: recoverySchema, created_at: z.iso.datetime(), variant: z.enum(VARIANTS),
  status: z.literal("OUTCOME_UNKNOWN"), phase: z.enum(OWNER_BANANA_INPAINT_IMAGE_GENERATION_PHASES)
}).strict()).max(64) }).strict();

export const OWNER_BANANA_INPAINT_IMAGE_TOOL_INPUT_SCHEMAS = Object.freeze({
  upload_original: originalUploadInputSchema,
  upload_painted_composite: paintedUploadInputSchema,
  upload_auxiliary_reference: auxiliaryUploadInputSchema,
  generate: generateInputSchema,
  reconcile: reconcileInputSchema,
  list_recoveries: listRecoveriesInputSchema,
  get_result_page: resultPageInputSchema
});
export const OWNER_BANANA_INPAINT_IMAGE_TOOL_OUTPUT_SCHEMAS = Object.freeze({
  upload_original: originalUploadOutputSchema,
  upload_painted_composite: paintedUploadOutputSchema,
  upload_auxiliary_reference: auxiliaryUploadOutputSchema,
  generate: generationOutputSchema,
  reconcile: generationOutputSchema,
  list_recoveries: recoveryListOutputSchema,
  get_result_page: resultPageOutputSchema
});

export function registerSyntxOwnerBananaInpaintImageTools(
  server: McpServer,
  options: RegisterSyntxOwnerBananaInpaintImageToolsOptions
): void {
  const original = options.originalReferenceService;
  const painted = options.paintedCompositeReferenceService;
  const auxiliary = options.auxiliaryReferenceService;
  const generation = options.generationService;

  server.registerTool(SYNTX_UPLOAD_BANANA_INPAINT_ORIGINAL_TOOL_NAME, {
    title: "Upload an owned Banana Inpaint original image",
    description: "Upload one locally inspected original image for the exact linked owner attempt and selected variant. Returns an opaque handle; upload alone does not authorize generation. The 50 MiB ceiling is local UI-derived input handling, not a provider limit.",
    inputSchema: originalUploadInputSchema, outputSchema: originalUploadOutputSchema,
    annotations: annotations("Upload Banana Inpaint original", false, true, true)
  }, async (input, { signal }) => {
    const parsed = safeParseInput(originalUploadInputSchema, input);
    if (!parsed) return errorResult(undefined, "INVALID_REQUEST", "UPLOAD_FAILED");
    try {
      const receipt = await original.upload({ attemptId: parsed.link_attempt_id, variant: parsed.variant,
        content_base64: parsed.content_base64, filename: parsed.filename, mime_type: parsed.mime_type, ...(signal === undefined ? {} : { signal }) });
      return structured(parseSafeOutput(originalUploadOutputSchema, receipt));
    } catch (error) { return errorResult(error, "UPLOAD_FAILED", "UPLOAD_FAILED"); }
  });

  server.registerTool(SYNTX_UPLOAD_BANANA_INPAINT_PAINTED_COMPOSITE_TOOL_NAME, {
    title: "Upload an owned Banana Inpaint painted composite",
    description: "Upload one PNG painted composite bound to the exact owned original handle and attempt. Container geometry checks are not decoded-pixel or provider-acceptance proof.",
    inputSchema: paintedUploadInputSchema, outputSchema: paintedUploadOutputSchema,
    annotations: annotations("Upload Banana Inpaint painted composite", false, true, true)
  }, async (input, { signal }) => {
    const parsed = safeParseInput(paintedUploadInputSchema, input);
    if (!parsed) return errorResult(undefined, "INVALID_REQUEST", "UPLOAD_FAILED");
    try {
      const receipt = await painted.uploadPaintedComposite({ attemptId: parsed.link_attempt_id, variant: parsed.variant,
        original_handle: parsed.original_handle, content_base64: parsed.content_base64, filename: parsed.filename,
        mime_type: parsed.mime_type, ...(signal === undefined ? {} : { signal }) });
      return structured(parseSafeOutput(paintedUploadOutputSchema, receipt));
    } catch (error) { return errorResult(error, "UPLOAD_FAILED", "UPLOAD_FAILED"); }
  });

  server.registerTool(SYNTX_UPLOAD_BANANA_INPAINT_AUXILIARY_REFERENCE_TOOL_NAME, {
    title: "Upload an owned Banana Inpaint auxiliary image",
    description: "Upload at most one locally supported auxiliary image for the exact linked owner attempt and variant. Parser format and 50 MiB ceiling are local validation only; upstream MIME, format, and size acceptance remain unproven.",
    inputSchema: auxiliaryUploadInputSchema, outputSchema: auxiliaryUploadOutputSchema,
    annotations: annotations("Upload Banana Inpaint auxiliary image", false, true, true)
  }, async (input, { signal }) => {
    const parsed = safeParseInput(auxiliaryUploadInputSchema, input);
    if (!parsed) return errorResult(undefined, "INVALID_REQUEST", "UPLOAD_FAILED");
    try {
      const receipt = await auxiliary.upload({ attemptId: parsed.link_attempt_id, variant: parsed.variant,
        content_base64: parsed.content_base64, filename: parsed.filename, mime_type: parsed.mime_type,
        ...(signal === undefined ? {} : { signal }) });
      return structured(parseSafeOutput(auxiliaryUploadOutputSchema, receipt));
    } catch (error) { return errorResult(error, "UPLOAD_FAILED", "UPLOAD_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_BANANA_INPAINT_IMAGE_TOOL_NAME, {
    title: "Generate a Banana Inpaint image",
    description: "Starts one owner-authorized Banana Inpaint request from original, painted-composite, and optional auxiliary handles after fresh account/model-access checks. A result observation is not proof of provider completion or billing. Unknown outcomes must be reconciled; never retry the generation call.",
    inputSchema: generateInputSchema, outputSchema: generationOutputSchema,
    annotations: annotations("Generate Banana Inpaint image", false, true, true)
  }, async (input, { signal }) => {
    const parsed = safeParseInput(generateInputSchema, input);
    if (!parsed) return errorResult(undefined, "INVALID_REQUEST", "GENERATION_FAILED");
    try {
      const result = await generation.generate({ attemptId: parsed.link_attempt_id, variant: parsed.variant, prompt: parsed.prompt,
        image_size: parsed.image_size, original_handle: parsed.original_handle, painted_handle: parsed.painted_handle,
        auxiliary_reference_handle: parsed.auxiliary_reference_handle }, signal);
      return structured(parseSafeOutput(generationOutputSchema, projectGenerationOutput(result)));
    } catch (error) { return errorResult(error, "GENERATION_FAILED", "GENERATION_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_BANANA_INPAINT_IMAGE_TOOL_NAME, {
    title: "Reconcile a Banana Inpaint generation",
    description: "GET-only reconciliation of the exact linked attempt and process-local recovery ID. It never uploads, creates a generation, or retries an unknown POST.",
    inputSchema: reconcileInputSchema, outputSchema: generationOutputSchema,
    annotations: annotations("Reconcile Banana Inpaint image", true, false, true)
  }, async (input, { signal }) => {
    const parsed = safeParseInput(reconcileInputSchema, input);
    if (!parsed) return errorResult(undefined, "INVALID_REQUEST", "GENERATION_FAILED");
    try {
      const result = await generation.reconcile({ attemptId: parsed.link_attempt_id, recovery_id: parsed.recovery_id }, signal);
      return structured(parseSafeOutput(generationOutputSchema, projectGenerationOutput(result)));
    } catch (error) { return errorResult(error, "GENERATION_FAILED", "GENERATION_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_LIST_BANANA_INPAINT_IMAGE_RECOVERIES_TOOL_NAME, {
    title: "List Banana Inpaint recovery handles",
    description: "Lists bounded process-local recovery diagnostics for this exact owner attempt without prompts, principal data, or artifact URLs.",
    inputSchema: listRecoveriesInputSchema, outputSchema: recoveryListOutputSchema,
    annotations: annotations("List Banana Inpaint recoveries", true, false, false)
  }, async (input) => {
    const parsed = safeParseInput(listRecoveriesInputSchema, input);
    if (!parsed) return recoveryListError("INVALID_REQUEST");
    try {
      const recoveries = await generation.listRecoveries({ attemptId: parsed.link_attempt_id,
        ...(parsed.limit === undefined ? {} : { limit: parsed.limit }) });
      return structured(parseSafeOutput(recoveryListOutputSchema, { recoveries }));
    } catch (error) {
      const code = serviceCode(error, "RECOVERY_LIST_UNAVAILABLE");
      return recoveryListError(code === "INVALID_REQUEST" || code === "SERVICE_CLOSED" || code === "PRINCIPAL_NOT_LINKED"
        ? code : "RECOVERY_LIST_UNAVAILABLE");
    }
  });

  server.registerTool(SYNTX_OWNER_GET_BANANA_INPAINT_IMAGE_RESULT_PAGE_TOOL_NAME, {
    title: "Read a Banana Inpaint result page",
    description: "Reads one bounded page from the exact owner attempt's cached result observations. It issues no provider GET or generation POST; use next_offset until has_more is false. The service enforces the result's owner, attempt, epoch, and original reference expiry.",
    inputSchema: resultPageInputSchema, outputSchema: resultPageOutputSchema,
    annotations: annotations("Read Banana Inpaint result page", true, false, false)
  }, async (input, { signal }) => {
    const parsed = safeParseInput(resultPageInputSchema, input);
    if (!parsed) return errorResult(undefined, "INVALID_REQUEST", "RESULT_PAGE_INVALID");
    try {
      const page = await generation.getResultPage({ attemptId: parsed.link_attempt_id, result_id: parsed.result_id,
        offset: parsed.offset, limit: parsed.limit }, signal);
      return structured(parseSafeOutput(resultPageOutputSchema, page));
    } catch (error) { return errorResult(error, "RESULT_PAGE_INVALID", "RESULT_PAGE_INVALID"); }
  });
}

function projectGenerationOutput(value: unknown): unknown {
  const copied = snapshotSafeInput(value);
  if (!isRecord(copied) || !Array.isArray(copied.artifacts)) throw new Error("UNSAFE_SERVICE_OUTPUT");
  const common = {
    backend_acceptance: copied.backend_acceptance,
    provider_execution: copied.provider_execution,
    attempt_id: copied.attempt_id,
    variant: copied.variant,
    ai_name: copied.ai_name,
    model_type: copied.model_type,
    result_id: copied.result_id,
    observed_total: copied.observed_total,
    next_offset: copied.next_offset,
    has_more: copied.has_more,
    artifacts: copied.artifacts.map((artifact) => {
      if (!isRecord(artifact)) throw new Error("UNSAFE_SERVICE_OUTPUT");
      return { url: artifact.url, mime_type: artifact.mime_type, width: artifact.width, height: artifact.height,
        geometry_verified: artifact.geometry_verified, message_id: artifact.message_id, object_index: artifact.object_index };
    })
  };
  return copied.status === "partial_results" ? { ...common, status: copied.status, recovery_id: copied.recovery_id }
    : { ...common, status: copied.status };
}

type UploadErrorCode = OwnerBananaInpaintOriginalReferenceServiceErrorCode |
  OwnerBananaInpaintPaintedCompositeReferenceServiceErrorCode | OwnerBananaInpaintAuxiliaryReferenceServiceErrorCode;
type OwnerBananaInpaintImageGenerationServiceErrorCode = typeof OWNER_BANANA_INPAINT_IMAGE_GENERATION_ERROR_CODES[number];
type ToolErrorCode = UploadErrorCode | OwnerBananaInpaintImageGenerationServiceErrorCode |
  "UPLOAD_FAILED" | "GENERATION_FAILED" | "RECOVERY_LIST_UNAVAILABLE";

const ERROR_MESSAGES: Readonly<Record<ToolErrorCode, string>> = Object.freeze({
  INVALID_REQUEST: "The Banana Inpaint request is invalid.", INVALID_IMAGE_INPUT: "The supplied image is invalid or unsupported.",
  LOCAL_RESOURCE_LIMIT_EXCEEDED: "The image exceeds a local resource ceiling.", UNSUPPORTED_IMAGE_FORMAT: "The auxiliary image format is not supported locally.",
  UNSUPPORTED_IMAGE_COMPOSITION: "The auxiliary image composition is not supported locally.", PRINCIPAL_NOT_LINKED: "The exact owner attempt is not currently linked.",
  PROFILE_BINDING_MISMATCH: "The selected Banana Inpaint source profile could not be verified.", SERVICE_BUSY: "The Banana Inpaint service is busy; no automatic retry was performed.",
  CAPACITY_EXCEEDED: "The Banana Inpaint service capacity is full.", SERVICE_CLOSED: "The Banana Inpaint service is closed.",
  REQUEST_ABORTED: "The upload was aborted; inspect its outcome before retrying.", REFERENCE_UNAVAILABLE: "A reference handle is unavailable for this attempt and variant.",
  REFERENCE_EXPIRED: "A reference handle expired or is no longer available.", UPLOAD_REJECTED: "The reference upload was rejected before a handle was issued.",
  UPLOAD_OUTCOME_UNKNOWN: "The upload outcome is unknown; do not repeat it automatically.", ORIGINAL_REFERENCE_UNAVAILABLE: "The original image handle is unavailable.",
  ORIGINAL_REFERENCE_EXPIRED: "The original image handle expired.", PAINTED_REFERENCE_UNAVAILABLE: "The painted-composite handle is unavailable.",
  PAINTED_REFERENCE_EXPIRED: "The painted-composite handle expired.", GEOMETRY_MISMATCH: "The painted composite does not match the original image geometry.",
  MODEL_BINDING_MISMATCH: "The Banana Inpaint source profile is unavailable.", PREFLIGHT_FAILED: "Current account or model access could not be verified.",
  INTENT_ALREADY_CLAIMED: "This Banana Inpaint intent has an unresolved outcome and cannot be replayed.",
  PRE_DISPATCH_FAILED: "The generation request was not safely dispatched.", OUTCOME_UNKNOWN: "Generation may have been dispatched; reconcile with the same recovery handle and do not retry.",
  RECOVERY_NOT_FOUND: "No matching process-local recovery is available for this attempt.", CLOCK_INVALID: "The local clock could not be verified.",
  RESULT_NOT_FOUND: "No matching stored Banana Inpaint result is available for this attempt.",
  RESULT_PAGE_INVALID: "The requested Banana Inpaint result page is invalid.",
  UPLOAD_FAILED: "The Banana Inpaint image upload failed safely.", GENERATION_FAILED: "The Banana Inpaint request could not be confirmed safely.",
  RECOVERY_LIST_UNAVAILABLE: "Banana Inpaint recovery handles are unavailable."
});

function errorResult(error: unknown, fallback: ToolErrorCode, operationFallback: ToolErrorCode): CallToolResult {
  let code = fallback;
  let recoveryId: string | undefined;
  if (!isProxyObject(error)) {
    if (error instanceof OwnerBananaInpaintOriginalReferenceServiceError || error instanceof OwnerBananaInpaintPaintedCompositeReferenceServiceError ||
        error instanceof OwnerBananaInpaintAuxiliaryReferenceServiceError) {
      const candidate = ownData(error, "code");
      if (typeof candidate === "string" && Object.hasOwn(ERROR_MESSAGES, candidate)) code = candidate as ToolErrorCode;
    } else if (error instanceof OwnerBananaInpaintImageGenerationServiceError) {
      const candidate = ownData(error, "code");
      if (typeof candidate === "string" && (OWNER_BANANA_INPAINT_IMAGE_GENERATION_ERROR_CODES as readonly string[]).includes(candidate)) {
        code = candidate as OwnerBananaInpaintImageGenerationServiceErrorCode;
        if (candidate === "OUTCOME_UNKNOWN") {
          const id = ownData(error, "recovery_id");
          if (typeof id === "string" && RECOVERY_ID.test(id)) recoveryId = id;
        }
      }
    }
  }
  if (!Object.hasOwn(ERROR_MESSAGES, code)) code = operationFallback;
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: {
    code, message: ERROR_MESSAGES[code], ...(code === "OUTCOME_UNKNOWN" && recoveryId ? { recovery_id: recoveryId } : {})
  } }) }] };
}

function recoveryListError(code: "INVALID_REQUEST" | "SERVICE_CLOSED" | "PRINCIPAL_NOT_LINKED" | "RECOVERY_LIST_UNAVAILABLE"): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message: ERROR_MESSAGES[code] } }) }] };
}
function annotations(title: string, readOnly: boolean, destructive: boolean, openWorld: boolean) {
  return { title, readOnlyHint: readOnly, destructiveHint: destructive, idempotentHint: readOnly, openWorldHint: openWorld };
}
function structured(value: object): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> };
}
function safeParseInput<T>(schema: z.ZodType<T>, input: unknown): T | undefined {
  const copied = snapshotSafeInput(input);
  if (copied === undefined) return undefined;
  const parsed = schema.safeParse(copied);
  return parsed.success ? parsed.data : undefined;
}
function parseSafeOutput<T>(schema: z.ZodType<T>, value: unknown): T {
  const copied = snapshotSafeInput(value);
  if (copied === undefined) throw new Error("UNSAFE_SERVICE_OUTPUT");
  return schema.parse(copied);
}
function snapshotSafeInput(value: unknown): unknown {
  const seen = new WeakSet<object>();
  let nodes = 0;
  const copy = (item: unknown, depth: number): unknown => {
    nodes += 1;
    if (depth > 8 || nodes > 4_096) throw new Error("UNSAFE_TOOL_DATA");
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "string") { if (item.length > MAX_BASE64_CHARS) throw new Error("UNSAFE_TOOL_DATA"); return item; }
    if (typeof item === "number") { if (!Number.isFinite(item)) throw new Error("UNSAFE_TOOL_DATA"); return item; }
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
      if (keys.length > 256 || keys.some((key) => typeof key !== "string" || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) {
        throw new Error("UNSAFE_TOOL_DATA");
      }
      const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of keys as string[]) result[key] = copy(descriptors[key]!.value, depth + 1);
      return result;
    } finally { seen.delete(item); }
  };
  try { return copy(value, 0); } catch { return undefined; }
}
function ownData(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || types.isProxy(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}
function serviceCode(error: unknown, fallback: ToolErrorCode): ToolErrorCode {
  if (!isProxyObject(error) && error instanceof OwnerBananaInpaintImageGenerationServiceError) {
    const candidate = ownData(error, "code");
    if (typeof candidate === "string" && (OWNER_BANANA_INPAINT_IMAGE_GENERATION_ERROR_CODES as readonly string[]).includes(candidate)) {
      return candidate as OwnerBananaInpaintImageGenerationServiceErrorCode;
    }
  }
  return fallback;
}
function isProxyObject(value: unknown): boolean { return Boolean(value && typeof value === "object" && types.isProxy(value)); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
}
function isSafeFilename(value: string): boolean {
  return value !== "." && value !== ".." && /^[^/\\\p{Cc}\p{Cf}\p{Cs}]{1,255}$/u.test(value) && Buffer.byteLength(value, "utf8") <= 255;
}
function decodedBase64Length(value: string): number {
  if (value.length === 0 || value.length % 4 !== 0) return 0;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}
function auxiliaryParserCeiling(mimeType: string): number {
  const limits = OWNER_BANANA_INPAINT_AUXILIARY_INPUT_POLICY.parser_limits;
  if (mimeType === "image/avif") return limits.avif;
  if (mimeType === "image/heic" || mimeType === "image/heif") return limits.heif;
  if (mimeType === "image/bmp" || mimeType === "image/gif" || mimeType === "image/tiff") return limits.seedream_extra;
  return limits.common;
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
