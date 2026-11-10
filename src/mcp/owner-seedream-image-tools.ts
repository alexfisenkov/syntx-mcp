import { isCanonicalBase64 as isCanonicalBase64Bounded } from "../application/canonical-base64.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { imageArtifactContentForResult, imageArtifactResultJsonText } from "./image-artifact-content.js";
import { z } from "zod/v4";
import { OwnerReferencePrincipalError } from "../auth/owner-reference-principal.js";
import {
  OWNER_SEEDREAM_IMAGE_GENERATION_ERROR_CODES,
  OWNER_SEEDREAM_IMAGE_GENERATION_HISTORY_REASONS,
  OWNER_SEEDREAM_IMAGE_GENERATION_PHASES,
  OWNER_SEEDREAM_IMAGE_GENERATION_RESULT_REASONS,
  OwnerSeedreamImageGenerationServiceError,
  type OwnerSeedreamImageGenerationService
} from "../application/owner-seedream-image-generation-service.js";
import { OWNER_SEEDREAM_IMAGE_INPUT_POLICY } from "../application/owner-seedream-image-input-validator.js";
import { OWNER_SEEDREAM_IMAGE_VARIANTS } from "../application/owner-seedream-image-parameters.js";
import {
  OwnerSeedreamImageUploadServiceError,
  type OwnerSeedreamImageUploadService
} from "../application/owner-seedream-image-upload-service.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { loadSelectedDiscoveryCatalog } from "../catalog/selected-discovery-catalog.js";
import { getOwnerSeedream55ImageSourceProfile, SEEDREAM55_PUBLIC_CATALOG_VERSION,
  SEEDREAM55_SETTINGS_VERSION } from "../application/owner-seedream55-image-source-profile.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const REFERENCE = /^seedream_image_[0-9a-f-]{36}$/u;
const RECOVERY = /^seedream_image_recovery_[0-9a-f-]{36}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const VARIANTS = OWNER_SEEDREAM_IMAGE_VARIANTS;
const RATIOS = ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"] as const;
const RESOLUTIONS = {
  "seedream-4": ["1K", "2K", "4K"], "seedream-4.5": ["2K", "4K"], "seedream-5": ["2K", "3K", "4K"],
  "seedream-5.0-flash": ["1K", "1.5K", "2K"], "seedream-5.0-pro": ["1K", "2K"]
} as const;
const REFERENCE_LIMITS = { "seedream-4": 4, "seedream-4.5": 4, "seedream-5": 14,
  "seedream-5.0-flash": 10, "seedream-5.0-pro": 10 } as const;
const BASIC_MIMES = ["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"] as const;
const EXTRA_MIMES = ["image/bmp", "image/gif", "image/tiff", "image/heic", "image/heif"] as const;
const FLASH_MIMES = ["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/heic", "image/heif", "image/tiff", "image/gif", "image/webp"] as const;
const PRO_MIMES = ["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/webp", "image/gif", "image/tiff", "image/heic", "image/heif"] as const;
const ALL_SOURCE_MIMES = [...BASIC_MIMES, ...EXTRA_MIMES] as const;
const CANONICAL_MIMES = ["image/jpeg", "image/png", "image/avif", "image/webp", "image/bmp", "image/gif", "image/tiff", "image/heic", "image/heif"] as const;
const VALIDATION_CONFIDENCES = [
  "JPEG_PNG_WEBP_STRUCTURAL_HEADER_ONLY;SOURCE_CONTAINER_METADATA_ONLY_NOT_PROVIDER_ACCEPTANCE",
  "AVIF_PRIMARY_ITEM_PROPERTY_ASSOCIATION_ONLY;SOURCE_CONTAINER_METADATA_ONLY_NOT_PROVIDER_ACCEPTANCE",
  "HEIF_PRIMARY_ITEM_ISPE_ASSOCIATION_ONLY;SOURCE_CONTAINER_METADATA_ONLY_NOT_PROVIDER_ACCEPTANCE",
  "BMP_HEADER_AND_PIXEL_EXTENT;SOURCE_CONTAINER_METADATA_ONLY_NOT_PROVIDER_ACCEPTANCE",
  "GIF_BLOCK_FRAMING_BOUNDED_FRAMES;SOURCE_CONTAINER_METADATA_ONLY_NOT_PROVIDER_ACCEPTANCE",
  "TIFF_IFD_AND_STRIP_EXTENTS_BOUNDED_PAGES;SOURCE_CONTAINER_METADATA_ONLY_NOT_PROVIDER_ACCEPTANCE"
] as const;
const SOURCE_ALPHA_CONFIDENCES = ["SOURCE_CANVAS_ALPHA8_NEAREST_SAMPLED", "UNSUPPORTED_PNG_ALPHA_COMPOSITION", "NOT_PNG_SOURCE"] as const;
const SOURCE_ALPHA_SCOPE = "SOURCE_CANVAS_ALPHA8_NEAREST_SAMPLED" as const;
const MAX_BASE64_CHARS = Math.ceil(OWNER_SEEDREAM_IMAGE_INPUT_POLICY.image_byte_caps.pro / 3) * 4;

export const SYNTX_UPLOAD_SEEDREAM_IMAGE_REFERENCE_TOOL_NAME = "syntx_upload_seedream_image_reference" as const;
export const SYNTX_OWNER_GENERATE_SEEDREAM_IMAGE_TOOL_NAME = "syntx_owner_generate_seedream_image" as const;
export const SYNTX_OWNER_RECONCILE_SEEDREAM_IMAGE_TOOL_NAME = "syntx_owner_reconcile_seedream_image" as const;
export const SYNTX_OWNER_LIST_SEEDREAM_IMAGE_RECOVERIES_TOOL_NAME = "syntx_owner_list_seedream_image_recoveries" as const;
export const SYNTX_UPLOAD_SEEDREAM55_IMAGE_REFERENCE_TOOL_NAME = "syntx_upload_seedream55_image_reference" as const;
export const SYNTX_OWNER_GENERATE_SEEDREAM55_IMAGE_TOOL_NAME = "syntx_owner_generate_seedream55_image" as const;
export const SYNTX_OWNER_RECONCILE_SEEDREAM55_IMAGE_TOOL_NAME = "syntx_owner_reconcile_seedream55_image" as const;
export const SYNTX_OWNER_LIST_SEEDREAM55_IMAGE_RECOVERIES_TOOL_NAME = "syntx_owner_list_seedream55_image_recoveries" as const;
export const SYNTX_GET_SEEDREAM55_IMAGE_PARAMETERS_TOOL_NAME = "syntx_get_seedream55_image_parameters" as const;

export interface RegisterSyntxOwnerSeedreamImageToolsOptions {
  readonly uploadService: Pick<OwnerSeedreamImageUploadService, "upload">;
  readonly generationService: Pick<OwnerSeedreamImageGenerationService, "generate" | "reconcile" | "listRecoveries">;
}

const attemptSchema = z.string().regex(ATTEMPT).describe("Exact linked owner attempt identifier.");
const referenceHandleSchema = z.string().regex(REFERENCE).describe("Opaque Seedream reference handle for this attempt.");
const recoveryIdSchema = z.string().regex(RECOVERY).describe("Opaque Seedream recovery handle for this attempt.");
const filenameSchema = z.string().min(1).max(255).refine(isSafeFilename, "Use a portable basename; paths are rejected.");
const promptSchema = z.string().min(1).max(65_536).refine(isValidPrompt, "Prompt must be nonblank and within the local input guard.");

const uploadInputSchema = z.object({
  link_attempt_id: attemptSchema, variant: z.enum(VARIANTS), content_base64: z.string().min(4).max(MAX_BASE64_CHARS).refine((value) => isCanonicalBase64Bounded(value, MAX_BASE64_CHARS)),
  filename: filenameSchema, mime_type: z.enum(ALL_SOURCE_MIMES)
}).strict().superRefine((value, context) => {
  const accepted = value.variant === "seedream-5.0-flash" ? FLASH_MIMES : value.variant === "seedream-5.0-pro" ? PRO_MIMES : BASIC_MIMES;
  const cap = value.variant === "seedream-5.0-flash" ? OWNER_SEEDREAM_IMAGE_INPUT_POLICY.image_byte_caps.flash
    : value.variant === "seedream-5.0-pro" ? OWNER_SEEDREAM_IMAGE_INPUT_POLICY.image_byte_caps.pro : OWNER_SEEDREAM_IMAGE_INPUT_POLICY.image_byte_caps.legacy;
  if (!accepted.includes(value.mime_type as never)) context.addIssue({ code: "custom", path: ["mime_type"], message: "MIME is not source-accepted for this variant." });
  if (value.content_base64.length > Math.ceil(cap / 3) * 4) context.addIssue({ code: "custom", path: ["content_base64"], message: "The source image byte ceiling was exceeded." });
});

const parametersInputSchema = z.union([
  parametersSchema("seedream-4"), parametersSchema("seedream-4.5"), parametersSchema("seedream-5"),
  parametersSchema("seedream-5.0-flash"), parametersSchema("seedream-5.0-pro")
]);
const generateInputSchema = z.object({
  link_attempt_id: attemptSchema, variant: z.enum(VARIANTS), reference_handles: z.array(referenceHandleSchema).max(14),
  parameters: parametersInputSchema, prompt: promptSchema
}).strict().superRefine((value, context) => {
  if (value.reference_handles.length > REFERENCE_LIMITS[value.variant]) context.addIssue({ code: "custom", path: ["reference_handles"], message: "The source reference-count limit was exceeded." });
  if (new Set(value.reference_handles).size !== value.reference_handles.length) context.addIssue({ code: "custom", path: ["reference_handles"], message: "Reference handles must be unique and ordered." });
  if (!RESOLUTIONS[value.variant].includes(value.parameters.resolution as never)) context.addIssue({ code: "custom", path: ["parameters", "resolution"], message: "Resolution is not source-supported for this variant." });
  const flash = value.variant === "seedream-5.0-flash";
  if (flash ? (value.parameters.output_format === null || value.parameters.background === null)
    : (value.parameters.output_format !== null || value.parameters.background !== null)) context.addIssue({ code: "custom", path: ["parameters"], message: "Controls must exactly match the variant's active fields." });
});
const reconcileInputSchema = z.object({ link_attempt_id: attemptSchema, recovery_id: recoveryIdSchema }).strict();
const listInputSchema = z.object({ link_attempt_id: attemptSchema, limit: z.number().int().min(1).max(20) }).strict();

const sourceAlphaSchema = z.object({
  source_sample_width: z.number().int().positive().max(1_024), source_sample_height: z.number().int().positive().max(1_024),
  source_alpha_eligible: z.boolean(), confidence_scope: z.literal(SOURCE_ALPHA_SCOPE)
}).strict();
const uploadOutputSchema = z.object({
  status: z.literal("uploaded"), reference_handle: referenceHandleSchema, variant: z.enum(VARIANTS),
  original_mime_type: z.enum([...BASIC_MIMES, ...EXTRA_MIMES]), mime_type: z.enum(CANONICAL_MIMES),
  width: z.number().int().positive().max(0xffff_ffff), height: z.number().int().positive().max(0xffff_ffff),
  size: z.number().int().positive().max(27_525_120), sha256: z.string().regex(SHA256),
  expires_in_seconds: z.number().int().min(1).max(900), metadata_confidence: z.literal("CONTAINER_METADATA_ONLY"),
  validation_confidence: z.enum(VALIDATION_CONFIDENCES), source_alpha_eligible: z.boolean(),
  source_alpha_confidence: z.enum(SOURCE_ALPHA_CONFIDENCES), source_sample_width: z.number().int().positive().max(1_024).nullable(),
  source_sample_height: z.number().int().positive().max(1_024).nullable()
}).strict().superRefine((receipt, context) => {
  const sourceMimes = receipt.variant === "seedream-5.0-flash" ? FLASH_MIMES : receipt.variant === "seedream-5.0-pro" ? PRO_MIMES : BASIC_MIMES;
  const sizeLimit = receipt.variant === "seedream-5.0-flash" ? 11_010_048 : receipt.variant === "seedream-5.0-pro" ? 27_525_120 : 10_485_760;
  if (!sourceMimes.includes(receipt.original_mime_type as never) || receipt.size > sizeLimit) {
    context.addIssue({ code: "custom", path: ["variant"], message: "Upload metadata must match the source variant profile." });
  }
  const witnessed = receipt.source_alpha_confidence === SOURCE_ALPHA_SCOPE;
  if ((receipt.original_mime_type === "image/png") === (receipt.source_alpha_confidence === "NOT_PNG_SOURCE") ||
      (!witnessed && (receipt.source_sample_width !== null || receipt.source_sample_height !== null || receipt.source_alpha_eligible)) ||
      (witnessed && (receipt.source_sample_width === null || receipt.source_sample_height === null))) {
    context.addIssue({ code: "custom", path: ["source_alpha_confidence"], message: "Alpha metadata must match the upload source evidence." });
  }
});

const diagnosticSchema = z.object({
  phase: z.enum(OWNER_SEEDREAM_IMAGE_GENERATION_PHASES), post_started: z.boolean(), echo_ack_known: z.boolean(),
  history_binding: z.enum(["NONE", "PENDING", "READY", "INVALID"]),
  history_binding_reason: z.enum(OWNER_SEEDREAM_IMAGE_GENERATION_HISTORY_REASONS).nullable(),
  history_get_calls: z.number().int().min(0).max(255), history_get_calls_saturated: z.boolean(),
  result_get_calls: z.number().int().min(0).max(255), result_get_calls_saturated: z.boolean(),
  result_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "UNVERIFIED"]),
  result_reason: z.enum(OWNER_SEEDREAM_IMAGE_GENERATION_RESULT_REASONS).nullable()
}).strict();
const inputReferenceSchema = z.object({
  source_mime_type: z.enum([...BASIC_MIMES, ...EXTRA_MIMES]), mime_type: z.enum(CANONICAL_MIMES),
  width: z.number().int().positive().max(0xffff_ffff), height: z.number().int().positive().max(0xffff_ffff),
  size: z.number().int().positive().max(27_525_120), sha256: z.string().regex(SHA256), metadata_confidence: z.literal("CONTAINER_METADATA_ONLY"),
  source_alpha: sourceAlphaSchema.nullable()
}).strict();
const artifactSchema = z.object({
  url: z.string().url().max(4_096).refine(isSafeUploadReferenceUrl), mime_type: z.enum(CANONICAL_MIMES).nullable(),
  mime_source: z.enum(["URL_EXTENSION", "UNKNOWN"]), width: z.null(), height: z.null(), geometry_verified: z.literal(false)
}).strict();
const recoveryListOutputSchema = z.object({
  recoveries: z.array(z.object({
    recovery_id: recoveryIdSchema, created_at: z.iso.datetime(), model_id: z.enum(VARIANTS), operation_id: z.literal("generate-image"),
    status: z.literal("OUTCOME_UNKNOWN"), diagnostic: diagnosticSchema
  }).strict()).max(20), confidence_scope: z.literal("process_local_get_only_recovery")
}).strict();

export function registerSyntxOwnerSeedream55ImageTools(server: McpServer, options: RegisterSyntxOwnerSeedreamImageToolsOptions): void {
  registerImageTools(server, options, true);
  server.registerTool(SYNTX_GET_SEEDREAM55_IMAGE_PARAMETERS_TOOL_NAME, {
    title: "Get Seedream 5.5 source parameters",
    description: "Read-only static public-source controls and local input limits. Does not check account access, rendered UI, cost amount or provider acceptance.",
    inputSchema: seedream55GetterInputSchema, outputSchema: seedream55GetterOutputSchema,
    annotations: annotations("Get Seedream 5.5 source parameters", true, false, false)
  }, async (input) => {
    if (!seedream55GetterInputSchema.safeParse(input).success) return errorResult(undefined, "INVALID_REQUEST");
    try {
      const catalog = loadSelectedDiscoveryCatalog(SEEDREAM55_PUBLIC_CATALOG_VERSION).discoveryCatalog;
      const profile = getOwnerSeedream55ImageSourceProfile(catalog, SEEDREAM55_PUBLIC_CATALOG_VERSION);
      return structured(seedream55GetterOutputSchema.parse({
        evidence_level: "STATIC_PUBLIC_SOURCE_ONLY", model_id: profile.model_id, ai_name: profile.ai_name,
        public_catalog_version: SEEDREAM55_PUBLIC_CATALOG_VERSION, settings_version: SEEDREAM55_SETTINGS_VERSION,
        form_build_id: "1794311734", form_sha256: "sha256:792ed18820311f638530324962234f1207be3880d5e8181cf713d0620229334c",
        controls: { aspect_ratio: RATIOS, resolution: ["1K", "1.5K", "2K"], output_format: ["jpeg", "png"],
          background: ["auto", "opaque", "transparent"], transparent_requires_png: true,
          defaults: profile.source_controller_markers.defaults },
        reference_count_maximum: profile.reference_count.maximum,
        accepted_file_types: profile.mime_policy.accepted_file_types,
        generic_max_file_bytes: profile.input_policy.generic_max_file_bytes,
        image_max_file_bytes: profile.input_policy.image_max_file_bytes,
        cost_input_keys: profile.cost_policy.controlled_inputs,
        rendered_ui: "NOT_CHECKED", account_access: "NOT_CHECKED", backend_acceptance: "UNPROVEN"
      }));
    } catch { return errorResult(undefined, "MODEL_BINDING_MISMATCH"); }
  });
}

export function registerSyntxOwnerSeedreamImageTools(server: McpServer, options: RegisterSyntxOwnerSeedreamImageToolsOptions): void {
  registerImageTools(server, options, false);
}

function registerImageTools(server: McpServer, options: RegisterSyntxOwnerSeedreamImageToolsOptions, seedream55: boolean): void {
  const uploadName = seedream55 ? SYNTX_UPLOAD_SEEDREAM55_IMAGE_REFERENCE_TOOL_NAME : SYNTX_UPLOAD_SEEDREAM_IMAGE_REFERENCE_TOOL_NAME;
  const generateName = seedream55 ? SYNTX_OWNER_GENERATE_SEEDREAM55_IMAGE_TOOL_NAME : SYNTX_OWNER_GENERATE_SEEDREAM_IMAGE_TOOL_NAME;
  const reconcileName = seedream55 ? SYNTX_OWNER_RECONCILE_SEEDREAM55_IMAGE_TOOL_NAME : SYNTX_OWNER_RECONCILE_SEEDREAM_IMAGE_TOOL_NAME;
  const listName = seedream55 ? SYNTX_OWNER_LIST_SEEDREAM55_IMAGE_RECOVERIES_TOOL_NAME : SYNTX_OWNER_LIST_SEEDREAM_IMAGE_RECOVERIES_TOOL_NAME;
  const uploadInput = seedream55 ? seedream55UploadInputSchema : uploadInputSchema;
  const uploadOutput = seedream55 ? seedream55UploadOutputSchema : uploadOutputSchema;
  const generateInput = seedream55 ? seedream55GenerateInputSchema : generateInputSchema;
  const generationOutput = seedream55 ? seedream55GenerationOutputSchema : generationOutputSchema;
  const recoveryListOutput = seedream55 ? seedream55RecoveryListOutputSchema : recoveryListOutputSchema;
  server.registerTool(uploadName, {
    title: "Upload an owned Seedream image reference",
    description: "Upload one source-validated image for the exact linked owner attempt. Returns a private handle and bounded metadata; upload is not generation permission.",
    inputSchema: uploadInput, outputSchema: uploadOutput,
    annotations: annotations("Upload Seedream image reference", false, true, false)
  }, async (input: unknown, { signal }: { signal?: AbortSignal }) => {
    const parsed = uploadInput.safeParse(input);
    if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST");
    try {
      const receipt = await options.uploadService.upload({ attemptId: parsed.data.link_attempt_id, variant: parsed.data.variant,
        content_base64: parsed.data.content_base64, filename: parsed.data.filename, mime_type: parsed.data.mime_type,
        ...(signal === undefined ? {} : { signal }) });
      return structured(uploadOutput.parse(receipt));
    } catch (error) { return errorResult(error, "UPLOAD_FAILED"); }
  });

  server.registerTool(generateName, {
    title: "Generate a Seedream image",
    description: "Starts one generation after fresh account and model-access preflights. If the outcome is uncertain, do not repeat; use the exact recovery handle.",
    inputSchema: generateInput, outputSchema: generationOutput,
    annotations: annotations("Generate Seedream image", false, true, true)
  }, async (input: unknown, { signal }: { signal?: AbortSignal }) => {
    const parsed = generateInput.safeParse(input);
    if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST");
    try {
      const result = await options.generationService.generate({ attemptId: parsed.data.link_attempt_id, variant: parsed.data.variant,
        reference_handles: parsed.data.reference_handles, parameters: parsed.data.parameters, prompt: parsed.data.prompt }, signal);
      return structured(generationOutput.parse(result));
    } catch (error) { return errorResult(error, "GENERATION_FAILED"); }
  });

  server.registerTool(reconcileName, {
    title: "Reconcile a Seedream image generation",
    description: "Read-only, bounded GET-only reconciliation for the exact attempt and opaque recovery handle. Never starts another generation.",
    inputSchema: reconcileInputSchema, outputSchema: generationOutput,
    annotations: annotations("Reconcile Seedream image generation", true, false, true)
  }, async (input, { signal }) => {
    const parsed = reconcileInputSchema.safeParse(input);
    if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST");
    try {
      const result = await options.generationService.reconcile({ attemptId: parsed.data.link_attempt_id, recovery_id: parsed.data.recovery_id }, signal);
      return structured(generationOutput.parse(result));
    } catch (error) { return errorResult(error, "GENERATION_FAILED"); }
  });

  server.registerTool(listName, {
    title: "List Seedream image recovery handles",
    description: "Lists bounded, process-local recovery metadata for the exact owner attempt. Prompt, artifact URLs, and principal details are never returned.",
    inputSchema: listInputSchema, outputSchema: recoveryListOutput,
    annotations: annotations("List Seedream image recoveries", true, false, true)
  }, async (input) => {
    const parsed = listInputSchema.safeParse(input);
    if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST");
    try {
      const recoveries = await options.generationService.listRecoveries({ attemptId: parsed.data.link_attempt_id, limit: parsed.data.limit });
      return structured(recoveryListOutput.parse({ recoveries, confidence_scope: "process_local_get_only_recovery" }));
    } catch (error) { return errorResult(error, "RECOVERY_LIST_UNAVAILABLE"); }
  });
}

function parametersSchema(variant: typeof VARIANTS[number]) {
  const common = { aspect_ratio: z.enum(RATIOS), resolution: z.enum([...RESOLUTIONS[variant]] as [string, ...string[]]) };
  return variant === "seedream-5.0-flash"
    ? z.object({ ...common, output_format: z.enum(["jpeg", "png"]), background: z.enum(["opaque", "transparent"]) }).strict()
    : z.object({ ...common, output_format: z.null(), background: z.null() }).strict();
}
const ALL_RESOLUTIONS = ["1K", "1.5K", "2K", "3K", "4K"] as const;
const genericParametersSchema = z.object({ aspect_ratio: z.enum(RATIOS), resolution: z.enum(ALL_RESOLUTIONS),
  output_format: z.enum(["jpeg", "png"]).nullable(), background: z.enum(["opaque", "transparent"]).nullable() }).strict();
const genericCostInputsSchema = z.union([
  z.object({}).strict(), z.object({ batch_size: z.number().int().min(0).max(14), resolution: z.enum(ALL_RESOLUTIONS) }).strict()
]);
const generationOutputSchema = z.object({
  status: z.literal("result_observed"), namespace_confidence: z.literal("SOURCE_SHAPED_UNVERIFIED"), backend_acceptance: z.literal("UNPROVEN"),
  ai_name: z.literal("seedream"), model_id: z.enum(VARIANTS), variant: z.enum(VARIANTS), operation_id: z.literal("generate-image"),
  profile_id: z.string().min(1).max(160), profile_schema_hash: z.string().regex(SHA256), catalog_version: z.string().min(1).max(160),
  request_fingerprint: z.string().regex(SHA256), parameters: genericParametersSchema, cost_inputs: genericCostInputsSchema,
  cost_input_confidence: z.literal("SOURCE_JOINED_CONTROLLED_STATE_NOT_QUOTE"), reference_count: z.number().int().min(0).max(14),
  input_references: z.array(inputReferenceSchema).max(14),
  actual_image: z.object({ mime_type: z.enum(CANONICAL_MIMES).nullable(), width: z.null(), height: z.null() }).strict(),
  geometry_verified: z.literal(false), artifact: artifactSchema
}).strict().superRefine((result, context) => {
  if (result.model_id !== result.variant) context.addIssue({ code: "custom", path: ["model_id"], message: "Model and variant must match." });
  if (!RESOLUTIONS[result.variant].includes(result.parameters.resolution as never)) {
    context.addIssue({ code: "custom", path: ["parameters", "resolution"], message: "Resolution must be source-valid for this variant." });
  }
  const flash = result.variant === "seedream-5.0-flash";
  if (flash ? (result.parameters.output_format === null || result.parameters.background === null)
    : (result.parameters.output_format !== null || result.parameters.background !== null)) {
    context.addIssue({ code: "custom", path: ["parameters"], message: "Inactive controls must be explicit null; Flash controls are explicit enums." });
  }
  const maxReferences = REFERENCE_LIMITS[result.variant];
  if (result.reference_count > maxReferences || result.input_references.length > maxReferences || result.reference_count !== result.input_references.length) {
    context.addIssue({ code: "custom", path: ["reference_count"], message: "Reference count must match the exact source-bounded returned metadata set." });
  }
  if (result.actual_image.mime_type !== result.artifact.mime_type ||
      ((result.artifact.mime_type === null) !== (result.artifact.mime_source === "UNKNOWN"))) {
    context.addIssue({ code: "custom", path: ["actual_image", "mime_type"], message: "MIME evidence must match the artifact." });
  }
  if (result.variant === "seedream-5.0-pro") {
    if (!Object.hasOwn(result.cost_inputs, "batch_size") || !Object.hasOwn(result.cost_inputs, "resolution") ||
        (result.cost_inputs as { batch_size: number }).batch_size !== result.reference_count ||
        (result.cost_inputs as { resolution: string }).resolution !== result.parameters.resolution) {
      context.addIssue({ code: "custom", path: ["cost_inputs"], message: "Pro cost inputs must match the explicit reference count and resolution." });
    }
  } else if (Object.keys(result.cost_inputs).length !== 0) {
    context.addIssue({ code: "custom", path: ["cost_inputs"], message: "Non-Pro variants have no declared cost inputs." });
  }
});

const seedream55ParametersSchema = z.object({
  aspect_ratio: z.enum(RATIOS), resolution: z.enum(["1K", "1.5K", "2K"]),
  output_format: z.enum(["jpeg", "png"]), background: z.enum(["auto", "opaque", "transparent"])
}).strict().superRefine((value, context) => {
  if (value.background === "transparent" && value.output_format !== "png")
    context.addIssue({ code: "custom", path: ["output_format"], message: "Transparent background requires PNG." });
});
const seedream55UploadInputSchema = z.object({
  link_attempt_id: attemptSchema, variant: z.literal("seedream-5.5"),
  content_base64: z.string().min(4).max(MAX_BASE64_CHARS).refine((value) => isCanonicalBase64Bounded(value, MAX_BASE64_CHARS)),
  filename: filenameSchema, mime_type: z.enum(PRO_MIMES)
}).strict();
const seedream55GenerateInputSchema = z.object({
  link_attempt_id: attemptSchema, variant: z.literal("seedream-5.5"),
  reference_handles: z.array(referenceHandleSchema).max(10), parameters: seedream55ParametersSchema, prompt: promptSchema
}).strict().superRefine((value, context) => {
  if (new Set(value.reference_handles).size !== value.reference_handles.length)
    context.addIssue({ code: "custom", path: ["reference_handles"], message: "Reference handles must be unique and ordered." });
});
const seedream55UploadOutputSchema = z.object({ ...uploadOutputSchema.shape, variant: z.literal("seedream-5.5") }).strict().superRefine((receipt, context) => {
  if (!PRO_MIMES.includes(receipt.original_mime_type as never) || receipt.size > 27_525_120)
    context.addIssue({ code: "custom", path: ["variant"], message: "Upload metadata must match Seedream 5.5." });
});
const seedream55GenerationOutputSchema = z.object({ ...generationOutputSchema.shape,
  model_id: z.literal("seedream-5.5"), variant: z.literal("seedream-5.5"),
  parameters: seedream55ParametersSchema, reference_count: z.number().int().min(0).max(10),
  input_references: z.array(inputReferenceSchema).max(10),
  cost_inputs: z.object({ batch_size: z.number().int().min(0).max(10), resolution: z.enum(["1K", "1.5K", "2K"]) }).strict()
}).strict().superRefine((result, context) => {
  if (result.cost_inputs.batch_size !== result.reference_count || result.cost_inputs.resolution !== result.parameters.resolution ||
      result.input_references.length !== result.reference_count)
    context.addIssue({ code: "custom", path: ["cost_inputs"], message: "Seedream 5.5 cost and reference metadata must match." });
  if (result.actual_image.mime_type !== result.artifact.mime_type ||
      ((result.artifact.mime_type === null) !== (result.artifact.mime_source === "UNKNOWN")))
    context.addIssue({ code: "custom", path: ["actual_image", "mime_type"], message: "MIME evidence must match the artifact." });
});
const seedream55RecoveryListOutputSchema = z.object({
  recoveries: z.array(z.object({ recovery_id: recoveryIdSchema, created_at: z.iso.datetime(), model_id: z.literal("seedream-5.5"),
    operation_id: z.literal("generate-image"), status: z.literal("OUTCOME_UNKNOWN"), diagnostic: diagnosticSchema }).strict()).max(20),
  confidence_scope: z.literal("process_local_get_only_recovery")
}).strict();
const seedream55GetterInputSchema = z.object({}).strict();
const seedream55GetterOutputSchema = z.object({
  evidence_level: z.literal("STATIC_PUBLIC_SOURCE_ONLY"), model_id: z.literal("seedream-5.5"), ai_name: z.literal("seedream"),
  public_catalog_version: z.literal(SEEDREAM55_PUBLIC_CATALOG_VERSION), settings_version: z.literal(SEEDREAM55_SETTINGS_VERSION),
  form_build_id: z.literal("1794311734"), form_sha256: z.string().regex(SHA256),
  controls: z.object({ aspect_ratio: z.array(z.enum(RATIOS)).length(8), resolution: z.array(z.enum(["1K", "1.5K", "2K"])).length(3),
    output_format: z.array(z.enum(["jpeg", "png"])).length(2), background: z.array(z.enum(["auto", "opaque", "transparent"])).length(3),
    transparent_requires_png: z.literal(true), defaults: z.object({ aspect_ratio: z.literal("1:1"), resolution: z.literal("2K"),
      output_format: z.literal("png"), background: z.literal("auto") }).strict() }).strict(),
  reference_count_maximum: z.literal(10), accepted_file_types: z.array(z.enum(PRO_MIMES)).length(9),
  generic_max_file_bytes: z.literal(31_457_280), image_max_file_bytes: z.literal(27_525_120),
  cost_input_keys: z.array(z.enum(["batch_size", "resolution"])).length(2),
  rendered_ui: z.literal("NOT_CHECKED"), account_access: z.literal("NOT_CHECKED"), backend_acceptance: z.literal("UNPROVEN")
}).strict();

function annotations(title: string, readOnly: boolean, destructive: boolean, openWorld: boolean) {
  return { title, readOnlyHint: readOnly, destructiveHint: destructive, idempotentHint: readOnly, openWorldHint: openWorld };
}
function structured(value: object): CallToolResult {
  return { content: [{ type: "text", text: imageArtifactResultJsonText(value) }, ...imageArtifactContentForResult(value)], structuredContent: value as Record<string, unknown> };
}
function errorResult(error: unknown, fallback: string): CallToolResult {
  const uploadCodes = ["INVALID_REQUEST", "INVALID_IMAGE_INPUT", "LOCAL_RESOURCE_LIMIT_EXCEEDED", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH",
    "SERVICE_BUSY", "CAPACITY_EXCEEDED", "SERVICE_CLOSED", "REQUEST_ABORTED", "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED", "UPLOAD_REJECTED", "UPLOAD_OUTCOME_UNKNOWN"];
  let code = fallback;
  let recoveryId: string | undefined;
  let diagnostic: unknown;
  if (error instanceof OwnerSeedreamImageUploadServiceError && uploadCodes.includes(error.code)) code = error.code;
  else if (error instanceof OwnerSeedreamImageGenerationServiceError && (OWNER_SEEDREAM_IMAGE_GENERATION_ERROR_CODES as readonly string[]).includes(error.code)) {
    code = error.code;
    if (error.code === "OUTCOME_UNKNOWN") {
      if (typeof error.recovery_id === "string" && RECOVERY.test(error.recovery_id)) recoveryId = error.recovery_id;
      const parsed = diagnosticSchema.safeParse(error.diagnostic);
      if (parsed.success) diagnostic = parsed.data;
    }
  } else if (error instanceof OwnerReferencePrincipalError && ["REFERENCE_PRINCIPAL_NOT_LINKED", "REFERENCE_PRINCIPAL_INVALID"].includes(error.code)) code = error.code;
  const messages: Record<string, string> = {
    INVALID_REQUEST: "The owner Seedream image request is invalid.", INVALID_IMAGE_INPUT: "Provide a supported image with matching MIME and valid container metadata.",
    LOCAL_RESOURCE_LIMIT_EXCEEDED: "The image exceeds the local resource ceiling.", PRINCIPAL_NOT_LINKED: "The exact owner attempt is not linked.",
    REFERENCE_PRINCIPAL_NOT_LINKED: "The exact owner attempt is not linked.", REFERENCE_PRINCIPAL_INVALID: "The exact owner attempt is not linked.",
    MODEL_BINDING_MISMATCH: "The selected Seedream variant is unavailable in the pinned source catalog.",
    SERVICE_BUSY: "The owner Seedream image service is at its safe concurrency limit; no automatic retry was performed.",
    CAPACITY_EXCEEDED: "The bounded owner Seedream image service capacity is full.", SERVICE_CLOSED: "The owner Seedream image service is closed.",
    REQUEST_ABORTED: "The operation was aborted; inspect its exact outcome before retrying.",
    REFERENCE_UNAVAILABLE: "A reference handle is unavailable for this exact attempt and variant.", REFERENCE_EXPIRED: "A reference handle expired or is no longer available.",
    REFERENCE_ALREADY_CLAIMED: "This semantic generation intent is already claimed; expiry does not permit replay.",
    PREFLIGHT_FAILED: "Fresh subscription or model-access checks did not pass.", PRE_DISPATCH_FAILED: "Generation failed before dispatch.",
    OUTCOME_UNKNOWN: "Generation may have been dispatched; do not retry. Reconcile only with the same recovery handle.",
    RECOVERY_NOT_FOUND: "No matching process-local recovery record is available for this attempt.",
    UPLOAD_REJECTED: "The reference upload was rejected before a handle was issued.", UPLOAD_OUTCOME_UNKNOWN: "Upload outcome is unknown; do not repeat automatically.",
    UPLOAD_FAILED: "The Seedream image upload failed safely.", GENERATION_FAILED: "Generation could not be confirmed; do not repeat a call that may have dispatched.",
    RECOVERY_LIST_UNAVAILABLE: "Seedream image recovery handles are unavailable."
  };
  const errorCodeSchema = z.enum([...new Set([...OWNER_SEEDREAM_IMAGE_GENERATION_ERROR_CODES, ...uploadCodes,
    "REFERENCE_PRINCIPAL_NOT_LINKED", "REFERENCE_PRINCIPAL_INVALID", "UPLOAD_FAILED", "GENERATION_FAILED", "RECOVERY_LIST_UNAVAILABLE"])] as [string, ...string[]]);
  const body = { error: { code: errorCodeSchema.safeParse(code).success ? code : fallback,
    message: messages[code] ?? "The owner Seedream image operation failed safely.",
    ...(recoveryId === undefined ? {} : { recovery_id: recoveryId }), ...(diagnostic === undefined ? {} : { diagnostic }) } };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] };
}
function isSafeFilename(value: string): boolean {
  return value !== "." && value !== ".." && /^[^/\\\p{Cc}\p{Cf}\p{Cs}]{1,255}$/u.test(value) && Buffer.byteLength(value, "utf8") <= 255;
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
