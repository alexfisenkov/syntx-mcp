import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { OwnerReferencePrincipalError } from "../auth/owner-reference-principal.js";
import {
  OWNER_IDEOGRAM_IMAGE_GENERATION_ERROR_CODES,
  OWNER_IDEOGRAM_IMAGE_GENERATION_HISTORY_REASONS,
  OWNER_IDEOGRAM_IMAGE_GENERATION_PHASES,
  OWNER_IDEOGRAM_IMAGE_GENERATION_RESULT_REASONS,
  OwnerIdeogramImageGenerationServiceError,
  type OwnerIdeogramImageGenerationService
} from "../application/owner-ideogram-image-generation-service.js";
import {
  OWNER_IDEOGRAM_IMAGE_CONTEXTS,
  getOwnerIdeogramImageParameterProfile,
  normalizeOwnerIdeogramImageParameters,
  type OwnerIdeogramImageMode,
  type OwnerIdeogramImageModelId
} from "../application/owner-ideogram-image-parameters.js";
import {
  OwnerIdeogramImageUploadServiceError,
  type OwnerIdeogramImageUploadService,
  type OwnerIdeogramImageUploadServiceErrorCode
} from "../application/owner-ideogram-image-upload-service.js";
import {
  OwnerIdeogramImageMaskUploadServiceError,
  type OwnerIdeogramImageMaskUploadService,
  type OwnerIdeogramImageMaskUploadServiceErrorCode
} from "../application/owner-ideogram-image-mask-upload-service.js";
import { OWNER_IDEOGRAM_IMAGE_INPUT_POLICY } from "../application/owner-ideogram-image-input.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const REFERENCE_HANDLE = /^ideogram_image_[0-9a-f-]{36}$/u;
const MASK_HANDLE = /^ideogram_mask_[0-9a-f-]{36}$/u;
const RECOVERY_ID = /^ideogram_image_recovery_[0-9a-f-]{36}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u;
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const PROFILE = getOwnerIdeogramImageParameterProfile();
const SOURCE_CONTEXTS = OWNER_IDEOGRAM_IMAGE_CONTEXTS;
const UPLOAD_CONTEXTS = SOURCE_CONTEXTS.filter((context) => !(context.model_id === "ideogram_40" && context.mode === "transparent"));

export const SYNTX_UPLOAD_IDEOGRAM_IMAGE_REFERENCE_TOOL_NAME = "syntx_upload_ideogram_image_reference" as const;
export const SYNTX_UPLOAD_IDEOGRAM_MASK_TOOL_NAME = "syntx_upload_ideogram_mask" as const;
export const SYNTX_OWNER_GENERATE_IDEOGRAM_IMAGE_TOOL_NAME = "syntx_owner_generate_ideogram_image" as const;
export const SYNTX_OWNER_RECONCILE_IDEOGRAM_IMAGE_TOOL_NAME = "syntx_owner_reconcile_ideogram_image" as const;
export const SYNTX_OWNER_LIST_IDEOGRAM_IMAGE_RECOVERIES_TOOL_NAME = "syntx_owner_list_ideogram_image_recoveries" as const;
export const OWNER_IDEOGRAM_IMAGE_TOOL_NAMES = Object.freeze([
  SYNTX_UPLOAD_IDEOGRAM_IMAGE_REFERENCE_TOOL_NAME,
  SYNTX_UPLOAD_IDEOGRAM_MASK_TOOL_NAME,
  SYNTX_OWNER_GENERATE_IDEOGRAM_IMAGE_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_IDEOGRAM_IMAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_IDEOGRAM_IMAGE_RECOVERIES_TOOL_NAME
] as const);

export interface RegisterSyntxOwnerIdeogramImageToolsOptions {
  readonly uploadService: Pick<OwnerIdeogramImageUploadService, "upload">;
  readonly maskUploadService?: Pick<OwnerIdeogramImageMaskUploadService, "upload" | "invalidateAttempt" | "close">;
  readonly generationService: Pick<OwnerIdeogramImageGenerationService, "generate" | "reconcile" | "listRecoveries">;
}

const UPLOAD_ERROR_CODES = [
  "INVALID_REQUEST", "INVALID_IMAGE_INPUT", "LOCAL_RESOURCE_LIMIT_EXCEEDED", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH",
  "MODE_HAS_NO_IMAGE_REFERENCES", "SERVICE_BUSY", "CAPACITY_EXCEEDED", "SERVICE_CLOSED", "REQUEST_ABORTED",
  "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED", "UPLOAD_REJECTED", "UPLOAD_OUTCOME_UNKNOWN"
] as const satisfies readonly OwnerIdeogramImageUploadServiceErrorCode[];
type UploadCodeDifference = [
  Exclude<OwnerIdeogramImageUploadServiceErrorCode, typeof UPLOAD_ERROR_CODES[number]>,
  Exclude<typeof UPLOAD_ERROR_CODES[number], OwnerIdeogramImageUploadServiceErrorCode>
];
const UPLOAD_ERROR_CODES_EXACT: UploadCodeDifference extends [never, never] ? true : never = true;
void UPLOAD_ERROR_CODES_EXACT;

const MASK_UPLOAD_ERROR_CODES = [
  "INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "CAPACITY_EXCEEDED", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH",
  "BASE_REFERENCE_UNAVAILABLE", "BASE_REFERENCE_EXPIRED", "INVALID_PAINTED_MASK", "LOCAL_RESOURCE_LIMIT_EXCEEDED",
  "MASK_GEOMETRY_MISMATCH", "MASK_HANDLE_UNAVAILABLE", "MASK_HANDLE_EXPIRED", "MASK_OUTCOME_UNKNOWN", "REQUEST_ABORTED"
] as const satisfies readonly OwnerIdeogramImageMaskUploadServiceErrorCode[];
type MaskUploadCodeDifference = [
  Exclude<OwnerIdeogramImageMaskUploadServiceErrorCode, typeof MASK_UPLOAD_ERROR_CODES[number]>,
  Exclude<typeof MASK_UPLOAD_ERROR_CODES[number], OwnerIdeogramImageMaskUploadServiceErrorCode>
];
const MASK_UPLOAD_ERROR_CODES_EXACT: MaskUploadCodeDifference extends [never, never] ? true : never = true;
void MASK_UPLOAD_ERROR_CODES_EXACT;

const PRINCIPAL_ERROR_CODES = ["REFERENCE_PRINCIPAL_NOT_LINKED", "REFERENCE_PRINCIPAL_INVALID"] as const;
const FALLBACK_ERROR_CODES = ["UPLOAD_FAILED", "MASK_UPLOAD_FAILED", "GENERATION_FAILED", "RECOVERY_LIST_UNAVAILABLE"] as const;
type ToolErrorCode = typeof OWNER_IDEOGRAM_IMAGE_GENERATION_ERROR_CODES[number] | typeof UPLOAD_ERROR_CODES[number] |
  typeof MASK_UPLOAD_ERROR_CODES[number] | typeof PRINCIPAL_ERROR_CODES[number] | typeof FALLBACK_ERROR_CODES[number];
const ERROR_CODES: readonly ToolErrorCode[] = Object.freeze([...new Set<ToolErrorCode>([
  ...OWNER_IDEOGRAM_IMAGE_GENERATION_ERROR_CODES, ...UPLOAD_ERROR_CODES, ...MASK_UPLOAD_ERROR_CODES, ...PRINCIPAL_ERROR_CODES, ...FALLBACK_ERROR_CODES
] )]);

const ERROR_MESSAGES: Readonly<Record<ToolErrorCode, string>> = Object.freeze({
  INVALID_REQUEST: "The owner Ideogram image request is invalid.",
  INVALID_IMAGE_INPUT: "Provide a supported image with matching MIME and valid container metadata.",
  LOCAL_RESOURCE_LIMIT_EXCEEDED: "The image exceeds the local Ideogram input resource ceiling.",
  PRINCIPAL_NOT_LINKED: "The exact owner attempt is not linked.",
  REFERENCE_PRINCIPAL_NOT_LINKED: "The exact owner attempt is not linked.",
  REFERENCE_PRINCIPAL_INVALID: "The exact owner attempt is not linked.",
  MODEL_BINDING_MISMATCH: "The selected Ideogram model or mode is unavailable in the pinned source catalog.",
  MODE_HAS_NO_IMAGE_REFERENCES: "The selected Ideogram mode does not accept image references.",
  SERVICE_BUSY: "The owner Ideogram service is at its safe concurrency limit; no automatic retry was performed.",
  CAPACITY_EXCEEDED: "The bounded owner Ideogram service capacity is full.",
  SERVICE_CLOSED: "The owner Ideogram service is closed.",
  REQUEST_ABORTED: "The upload was aborted; inspect its exact outcome before retrying.",
  REFERENCE_UNAVAILABLE: "A reference handle is unavailable for this exact attempt and mode.",
  REFERENCE_EXPIRED: "A reference handle expired or is no longer available.",
  UPLOAD_REJECTED: "The reference upload was rejected before a handle was issued.",
  UPLOAD_OUTCOME_UNKNOWN: "The upload outcome is unknown; do not repeat it automatically.",
  BASE_REFERENCE_UNAVAILABLE: "The base image handle is unavailable for this exact attempt.",
  BASE_REFERENCE_EXPIRED: "The base image handle expired or is no longer available.",
  INVALID_PAINTED_MASK: "The painted RGBA mask is invalid or unsupported for local processing.",
  MASK_GEOMETRY_MISMATCH: "The mask dimensions do not match the exact base image metadata.",
  MASK_HANDLE_UNAVAILABLE: "The mask handle is unavailable for this exact attempt and base image.",
  MASK_HANDLE_EXPIRED: "The mask handle expired or is no longer available.",
  MASK_OUTCOME_UNKNOWN: "The mask pair upload outcome is unknown; do not repeat it automatically.",
  REFERENCE_ALREADY_CLAIMED: "This exact reference set has already been claimed and cannot be replayed.",
  PREFLIGHT_FAILED: "Fresh account or model-access checks did not pass.",
  PRE_DISPATCH_FAILED: "Generation failed before dispatch.",
  OUTCOME_UNKNOWN: "Generation may have been dispatched; do not retry. Reconcile only with the same recovery handle.",
  RECOVERY_NOT_FOUND: "No matching process-local recovery record is available for this attempt.",
  UPLOAD_FAILED: "The Ideogram image upload failed safely.",
  MASK_UPLOAD_FAILED: "The Ideogram mask upload failed safely.",
  GENERATION_FAILED: "Generation could not be confirmed; do not repeat a call that may have dispatched.",
  RECOVERY_LIST_UNAVAILABLE: "Ideogram recovery handles are unavailable."
});

const attemptSchema = z.string().regex(ATTEMPT).describe("Exact linked owner attempt identifier; not a provider or account ID.");
const referenceHandleSchema = z.string().regex(REFERENCE_HANDLE)
  .describe("Opaque uploaded ordinary-image reference handle bound to the exact owner attempt and Ideogram mode.");
const recoveryIdSchema = z.string().regex(RECOVERY_ID)
  .describe("Opaque process-local recovery handle; use only with the same linked owner attempt.");
const promptSchema = z.string().min(1).max(10_000).refine((value) => value.trim().length > 0,
  "Prompt must be nonblank and fit the local source input guard.");
const disabledPromptSchema = z.literal(null).describe("Reframe prompt is explicitly disabled and must be null.");

interface UploadToolInput {
  readonly link_attempt_id: string;
  readonly context: { readonly model_id: OwnerIdeogramImageModelId; readonly mode: OwnerIdeogramImageMode };
  readonly content_base64: string;
  readonly filename: string;
  readonly mime_type: string;
}
interface GenerateToolInput {
  readonly link_attempt_id: string;
  readonly context: { readonly model_id: OwnerIdeogramImageModelId; readonly mode: OwnerIdeogramImageMode };
  readonly prompt: string | null;
  readonly reference_handles: readonly string[];
  readonly mask_handle?: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

function pairSchema(contexts: readonly Readonly<{ model_id: OwnerIdeogramImageModelId; mode: OwnerIdeogramImageMode }>[]): z.ZodType {
  const branches: z.ZodType[] = [];
  for (const context of contexts) branches.push(pairSchemaFor(context.model_id, context.mode));
  return z.union(branches as unknown as [z.ZodType, ...z.ZodType[]]);
}
function pairSchemaFor<M extends OwnerIdeogramImageModelId, D extends OwnerIdeogramImageMode>(model: M, mode: D): z.ZodType {
  return z.object({ model_id: z.literal(model), mode: z.literal(mode) }).strict();
}
const generationContextSchema = pairSchema(SOURCE_CONTEXTS);
const uploadContextSchema = pairSchema(UPLOAD_CONTEXTS);

const maskUploadInputSchema = z.object({
  link_attempt_id: attemptSchema,
  base_reference_handle: referenceHandleSchema.describe("First ordered ordinary reference handle to which this painted mask is bound."),
  painted_rgba_png_base64: z.string().min(4).max(Math.ceil(25 * 1024 * 1024 / 3) * 4).regex(BASE64)
    .describe("Painted RGBA PNG bytes for local alpha-to-mask conversion; local size, CRC, RGBA8, geometry, and canonical mask checks apply.")
}).strict().superRefine((input, context) => {
  if (!isCanonicalBase64(input.painted_rgba_png_base64) || !isWithinBase64ByteLimit(input.painted_rgba_png_base64, 25 * 1024 * 1024)) {
    context.addIssue({ code: "custom", path: ["painted_rgba_png_base64"], message: "The painted mask exceeds its local input byte guard." });
  }
});
const maskUploadOutputSchema = z.object({
  status: z.literal("uploaded"), mask_handle: z.string().regex(MASK_HANDLE), width: z.number().int().positive().max(16_384),
  height: z.number().int().positive().max(16_384), pair_sha256: z.string().regex(SHA256), expires_in_seconds: z.number().int().min(1).max(900),
  confidence_scope: z.literal("LOCAL_MASK_BYTES_ONLY_NOT_PROVIDER_ACCEPTANCE")
}).strict();

const inputParameterBranches: z.ZodType[] = [];
for (const context of SOURCE_CONTEXTS) {
  for (const referenceCount of referenceCounts(context.model_id, context.mode)) {
    inputParameterBranches.push(parametersSchema(context.model_id, context.mode, referenceCount));
  }
}
const parameterInputSchema = z.union(inputParameterBranches as [z.ZodType, ...z.ZodType[]]);
function createGenerateInputSchema(maskAvailable: boolean) {
  return z.object({
    link_attempt_id: attemptSchema, context: generationContextSchema,
    ...(maskAvailable ? { mask_handle: z.string().regex(MASK_HANDLE).optional()
      .describe("Opaque mask handle bound to the first ordinary image; only available for Ideogram Precise Edit.") } : {}),
    prompt: z.union([promptSchema, disabledPromptSchema]).describe("Required nonblank prompt in eight contexts; explicitly null only for Ideogram Reframe."),
    reference_handles: z.array(referenceHandleSchema).max(5), parameters: parameterInputSchema
  }).strict().superRefine((value, issueContext) => {
    const input = value as GenerateToolInput;
    const modelId = input.context.model_id;
    const mode = input.context.mode;
    const maskPresent = input.mask_handle !== undefined;
    if (maskPresent && (modelId !== "ideogram_45" || mode !== "precise_edit")) {
      issueContext.addIssue({ code: "custom", path: ["mask_handle"], message: "Mask handles are supported only for Ideogram Precise Edit." });
      return;
    }
    if (!referenceCounts(modelId, mode, maskPresent).includes(input.reference_handles.length)) {
      issueContext.addIssue({ code: "custom", path: ["reference_handles"], message: "The model/mode pair or reference count is not source-supported." });
      return;
    }
    if (new Set(input.reference_handles).size !== input.reference_handles.length) {
      issueContext.addIssue({ code: "custom", path: ["reference_handles"], message: "Reference handles must be unique and ordered." });
    }
    try {
      normalizeOwnerIdeogramImageParameters({ model_id: modelId, mode,
        reference_count: input.reference_handles.length, mask_present: maskPresent, prompt: input.prompt, parameters: input.parameters });
    } catch {
      issueContext.addIssue({ code: "custom", path: ["parameters"], message: "Controls do not match the source-validated model and mode." });
    }
  });
}
const generateInputSchema = createGenerateInputSchema(true);
const unmaskedGenerateInputSchema = createGenerateInputSchema(false);

const ALL_UPLOAD_MIMES = [...new Set(Object.values(OWNER_IDEOGRAM_IMAGE_INPUT_POLICY.models)
  .flatMap((policy) => policy.accepted_mime_types))] as [string, ...string[]];
const MAX_UPLOAD_BYTES = Math.max(...Object.keys(OWNER_IDEOGRAM_IMAGE_INPUT_POLICY.models)
  .map((model) => effectiveInputBytes(model as OwnerIdeogramImageModelId)));
const uploadInputSchema = z.object({
  link_attempt_id: attemptSchema, context: uploadContextSchema,
  content_base64: z.string().min(4).max(Math.ceil(MAX_UPLOAD_BYTES / 3) * 4).regex(BASE64)
    .describe("Standard padded Base64. Per-model source and local byte guards are enforced; local limits are not provider limits."),
  filename: z.string().min(1).max(255).refine(isSafeFilename, "Use a portable basename without a local path."),
  mime_type: z.enum(ALL_UPLOAD_MIMES)
}).strict().superRefine((value, issueContext) => {
  const input = value as UploadToolInput;
  const policy = OWNER_IDEOGRAM_IMAGE_INPUT_POLICY.models[input.context.model_id];
  const maximum = effectiveInputBytes(input.context.model_id);
  if (!policy.accepted_mime_types.includes(input.mime_type as never)) {
    issueContext.addIssue({ code: "custom", path: ["mime_type"], message: "This MIME type is not source-supported for the selected model." });
  }
  if (!isCanonicalBase64(input.content_base64) || !isWithinBase64ByteLimit(input.content_base64, maximum)) {
    issueContext.addIssue({ code: "custom", path: ["content_base64"], message: "The encoded image exceeds the model's input byte guard." });
  }
});

const uploadOutputSchema = z.object({
  status: z.literal("uploaded"), reference_handle: referenceHandleSchema,
  model_id: z.enum(["ideogram", "ideogram_40", "ideogram_45"]),
  mode: z.enum(["generate", "remix", "reframe", "replace_background", "character_reference", "transparent", "precise_edit"]),
  original_mime_type: z.enum(["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"]),
  mime_type: z.enum(["image/jpeg", "image/png", "image/avif", "image/webp"]),
  width: z.number().int().positive().max(0xffff_ffff), height: z.number().int().positive().max(0xffff_ffff),
  size: z.number().int().positive().max(64 * 1024 * 1024), sha256: z.string().regex(SHA256),
  expires_in_seconds: z.number().int().min(1).max(900),
  metadata_confidence: z.literal("CONTAINER_METADATA_ONLY"),
  validation_scope: z.literal("LOCAL_INPUT_VALIDATION_ONLY_NOT_PROVIDER_ACCEPTANCE")
}).strict().superRefine((receipt, context) => {
  const policy = OWNER_IDEOGRAM_IMAGE_INPUT_POLICY.models[receipt.model_id];
  if (!policy.accepted_mime_types.includes(receipt.original_mime_type as never) || receipt.size > effectiveInputBytes(receipt.model_id)) {
    context.addIssue({ code: "custom", path: ["model_id"], message: "Upload metadata exceeds the selected model's local/source input policy." });
  }
  const expectedCanonical = receipt.original_mime_type === "image/jpg" ? "image/jpeg" : receipt.original_mime_type;
  if (receipt.mime_type !== expectedCanonical) {
    context.addIssue({ code: "custom", path: ["mime_type"], message: "Canonical MIME must match the validated source MIME." });
  }
  if (!UPLOAD_CONTEXTS.some((modeContext) => modeContext.model_id === receipt.model_id && modeContext.mode === receipt.mode)) {
    context.addIssue({ code: "custom", path: ["mode"], message: "The upload receipt must match a reference-capable model/mode context." });
  }
});

const artifactSchema = z.object({
  url: z.string().url().max(4_096).refine(isSafeUploadReferenceUrl),
  mime_type: z.enum(["image/jpeg", "image/png", "image/webp", "image/avif"]).nullable(),
  mime_source: z.enum(["URL_EXTENSION", "UNKNOWN"]), width: z.null(), height: z.null(), geometry_verified: z.literal(false)
}).strict().superRefine((artifact, context) => {
  if ((artifact.mime_type === null) !== (artifact.mime_source === "UNKNOWN")) {
    context.addIssue({ code: "custom", path: ["mime_type"], message: "MIME hint and source must be consistent." });
  }
});

const generationOutputSchema = z.object({
  status: z.literal("result_observed"), namespace_confidence: z.literal("SOURCE_SHAPED_UNVERIFIED"),
  backend_acceptance: z.literal("UNPROVEN"), mode_confidence: z.literal("PRIVATE_REQUEST_CONTEXT_NOT_PROVIDER_ECHO"),
  ai_name: z.literal("ideogram"), model_id: z.enum(["ideogram", "ideogram_40", "ideogram_45"]),
  mode: z.enum(["generate", "remix", "reframe", "replace_background", "character_reference", "transparent", "precise_edit"]),
  operation_id: z.literal("generate-image"), profile_id: z.string().min(1).max(160), profile_schema_hash: z.string().regex(SHA256),
  catalog_version: z.string().min(1).max(160), reference_count: z.number().int().min(0).max(5),
  mask_present: z.boolean(), mask_acceptance: z.enum(["UNPROVEN", "NOT_REQUESTED"]),
  output_count: z.number().int().min(1).max(8),
  cost_input_confidence: z.literal("SOURCE_CALLBACK_INPUTS_ONLY_PRICE_AND_BILLING_UNPROVEN"),
  artifacts: z.array(artifactSchema).min(1).max(8)
}).strict().superRefine((result, context) => {
  if (result.output_count !== result.artifacts.length) {
    context.addIssue({ code: "custom", path: ["artifacts"], message: "The returned artifact count must match the observed output count." });
  }
  if (result.mask_acceptance !== (result.mask_present ? "UNPROVEN" : "NOT_REQUESTED")) {
    context.addIssue({ code: "custom", path: ["mask_acceptance"], message: "Mask presence is local request context only and cannot claim provider acceptance." });
  }
});

const diagnosticSchema = z.object({
  phase: z.enum(OWNER_IDEOGRAM_IMAGE_GENERATION_PHASES), post_started: z.boolean(), echo_ack_known: z.boolean(),
  history_binding: z.enum(["NONE", "PENDING", "PARTIAL", "READY", "INVALID", "NOT_VERIFIABLE"]),
  history_binding_reason: z.enum(OWNER_IDEOGRAM_IMAGE_GENERATION_HISTORY_REASONS).nullable(),
  history_get_calls: z.number().int().min(0).max(255), history_get_calls_saturated: z.boolean(),
  result_get_calls: z.number().int().min(0).max(255), result_get_calls_saturated: z.boolean(),
  result_status: z.enum(["NOT_READ", "PENDING", "PARTIAL", "COMPLETE", "UNVERIFIED"]),
  result_reason: z.enum(OWNER_IDEOGRAM_IMAGE_GENERATION_RESULT_REASONS).nullable()
}).strict();

const errorOutputSchema = z.object({ error: z.object({
  code: z.enum([...ERROR_CODES] as [ToolErrorCode, ...ToolErrorCode[]]), message: z.string().min(1).max(512),
  recovery_id: recoveryIdSchema.optional(), diagnostic: diagnosticSchema.optional()
}).strict() }).strict();

const reconcileInputSchema = z.object({ link_attempt_id: attemptSchema, recovery_id: recoveryIdSchema }).strict();
const listInputSchema = z.object({ link_attempt_id: attemptSchema, limit: z.number().int().min(1).max(20).optional() }).strict();
const recoveryListOutputSchema = z.object({
  recoveries: z.array(z.object({
    recovery_id: recoveryIdSchema, created_at: z.iso.datetime(), model_id: z.enum(["ideogram", "ideogram_40", "ideogram_45"]),
    mode: z.enum(["generate", "remix", "reframe", "replace_background", "character_reference", "transparent", "precise_edit"]),
    status: z.literal("OUTCOME_UNKNOWN"), mask_present: z.boolean(), mask_acceptance: z.enum(["UNPROVEN", "NOT_REQUESTED"]),
    diagnostic: diagnosticSchema
  }).strict().superRefine((recovery, context) => {
    if (recovery.mask_acceptance !== (recovery.mask_present ? "UNPROVEN" : "NOT_REQUESTED")) {
      context.addIssue({ code: "custom", path: ["mask_acceptance"], message: "Recovery mask status is local request context only." });
    }
  })).max(20),
  confidence_scope: z.literal("process_local_get_only_recovery")
}).strict();

export function registerSyntxOwnerIdeogramImageTools(server: McpServer, options: RegisterSyntxOwnerIdeogramImageToolsOptions): void {
  server.registerTool(SYNTX_UPLOAD_IDEOGRAM_IMAGE_REFERENCE_TOOL_NAME, {
    title: "Upload an Ideogram image reference",
    description: "Upload one user-provided ordinary image for an explicit supported Ideogram model and mode. Returns only a private, attempt-bound handle and bounded container metadata; this is not a mask handle or generation permit. Local byte ceilings are not provider limits; container dimensions are not decoded-pixel proof.",
    inputSchema: uploadInputSchema, outputSchema: uploadOutputSchema,
    annotations: { title: "Upload Ideogram image reference", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    const parsedResult = uploadInputSchema.safeParse(input);
    if (!parsedResult.success) return errorResult(undefined, "INVALID_REQUEST");
    const parsed = parsedResult.data as UploadToolInput;
    try {
      const receipt = await options.uploadService.upload({ attemptId: parsed.link_attempt_id, model_id: parsed.context.model_id,
        mode: parsed.context.mode, content_base64: parsed.content_base64, filename: parsed.filename,
        mime_type: parsed.mime_type, ...(signal === undefined ? {} : { signal }) });
      const output = uploadOutputSchema.parse(receipt);
      if (output.model_id !== parsed.context.model_id || output.mode !== parsed.context.mode || output.original_mime_type !== parsed.mime_type) {
        return errorResult(undefined, "UPLOAD_FAILED");
      }
      return safeStructured(output);
    } catch (error) { return errorResult(error, "UPLOAD_FAILED"); }
  });

  if (options.maskUploadService) {
    server.registerTool(SYNTX_UPLOAD_IDEOGRAM_MASK_TOOL_NAME, {
      title: "Upload an Ideogram painted mask",
      description: "Upload a painted RGBA PNG bound to the first ordinary image handle for Ideogram Precise Edit. The server creates the two hidden polarity variants and returns only an opaque role-mask handle and local metadata; this is not provider acceptance or a generation permit.",
      inputSchema: maskUploadInputSchema, outputSchema: maskUploadOutputSchema,
      annotations: { title: "Upload Ideogram mask", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    }, async (input, { signal }): Promise<CallToolResult> => {
      const parsed = maskUploadInputSchema.safeParse(input);
      if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST");
      try {
        const receipt = await options.maskUploadService!.upload({ attemptId: parsed.data.link_attempt_id,
          base_reference_handle: parsed.data.base_reference_handle, painted_rgba_png_base64: parsed.data.painted_rgba_png_base64,
          ...(signal === undefined ? {} : { signal }) });
        return safeStructured(maskUploadOutputSchema.parse(receipt));
      } catch (error) { return errorResult(error, "MASK_UPLOAD_FAILED"); }
    });
  }

  server.registerTool(SYNTX_OWNER_GENERATE_IDEOGRAM_IMAGE_TOOL_NAME, {
    title: "Generate an Ideogram image",
    description: "Starts one explicit source-validated Ideogram model/mode request after fresh owner, account, and access checks. Use ordered unique opaque image handles; for Precise Edit an optional role-bound mask handle must match the first ordinary image. Mask acceptance remains unproven. No controls are filled from defaults. OUTCOME_UNKNOWN may have dispatched and must not be replayed; reconcile only with its recovery handle.",
    inputSchema: options.maskUploadService ? generateInputSchema : unmaskedGenerateInputSchema, outputSchema: generationOutputSchema,
    annotations: { title: "Generate Ideogram image", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    const parsedResult = (options.maskUploadService ? generateInputSchema : unmaskedGenerateInputSchema).safeParse(input);
    if (!parsedResult.success) return errorResult(undefined, "INVALID_REQUEST");
    const parsed = parsedResult.data as GenerateToolInput;
    try {
      const result = await options.generationService.generate({ attemptId: parsed.link_attempt_id,
        model_id: parsed.context.model_id, mode: parsed.context.mode, prompt: parsed.prompt,
        reference_handles: parsed.reference_handles, ...(parsed.mask_handle === undefined ? {} : { mask_handle: parsed.mask_handle }),
        parameters: parsed.parameters }, signal);
      return safeStructured(generationOutputSchema.parse(result));
    } catch (error) { return errorResult(error, "GENERATION_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_IDEOGRAM_IMAGE_TOOL_NAME, {
    title: "Reconcile an Ideogram image generation",
    description: "GET-only reconciliation for the exact linked attempt and opaque process-local recovery handle. It does not upload, create a chat, preflight account or cost, dispatch, or retry.",
    inputSchema: reconcileInputSchema, outputSchema: generationOutputSchema,
    annotations: { title: "Reconcile Ideogram image generation", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    const parsed = reconcileInputSchema.safeParse(input);
    if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST");
    try {
      const result = await options.generationService.reconcile({ attemptId: parsed.data.link_attempt_id,
        recovery_id: parsed.data.recovery_id }, signal);
      return safeStructured(generationOutputSchema.parse(result));
    } catch (error) { return errorResult(error, "GENERATION_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_LIST_IDEOGRAM_IMAGE_RECOVERIES_TOOL_NAME, {
    title: "List Ideogram image recovery handles",
    description: "Lists up to 20 process-local recovery records for the exact attempt. It performs no provider request and returns no prompt, artifact URL, or principal data.",
    inputSchema: listInputSchema, outputSchema: recoveryListOutputSchema,
    annotations: { title: "List Ideogram image recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input): Promise<CallToolResult> => {
    const parsed = listInputSchema.safeParse(input);
    if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST");
    try {
      const recoveries = await options.generationService.listRecoveries({ attemptId: parsed.data.link_attempt_id,
        ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }) });
      return safeStructured(recoveryListOutputSchema.parse({ recoveries, confidence_scope: "process_local_get_only_recovery" }));
    } catch (error) { return errorResult(error, "RECOVERY_LIST_UNAVAILABLE"); }
  });
}

function parametersSchema(model: OwnerIdeogramImageModelId, mode: OwnerIdeogramImageMode, referenceCount: number): z.ZodType {
  const allowed: string[] = ["rendering_speed", "num_images"];
  const required = new Set<string>(["rendering_speed", "num_images"]);
  const properties: Record<string, z.ZodType> = {
    rendering_speed: z.enum([...speedOptions(model)] as [string, ...string[]]),
    num_images: z.number().int().min(PROFILE.num_images.minimum).max(PROFILE.num_images.maximum)
  };
  const allow = (key: string, schema: z.ZodType, isRequired = false): void => {
    allowed.push(key);
    properties[key] = schema;
    if (isRequired) required.add(key);
  };

  allow("seed", z.number().int().min(PROFILE.seed.minimum).max(PROFILE.seed.maximum).nullable());
  if (model === "ideogram" && ["generate", "remix", "character_reference"].includes(mode)) {
    allow("aspect_ratio", stringOrNullEnum(PROFILE.ratios.ideogram), true);
    allow("resolution", enumValues(PROFILE.resolutions.ideogram_generate_remix_character_reference_reframe), true);
  } else if (model === "ideogram" && mode === "reframe") {
    allow("resolution", enumValues(PROFILE.resolutions.ideogram_generate_remix_character_reference_reframe), true);
  } else if (model === "ideogram_40" && mode === "generate") {
    allow("aspect_ratio", stringOrNullEnum(PROFILE.ratios.ideogram_40_generate), true);
    allow("resolution", enumValues(PROFILE.resolutions.ideogram_40_generate), true);
    if (referenceCount === 0) allow("magic_prompt", enumValues(PROFILE.magic_prompt).nullable());
    else {
      allow("image_weight_auto", z.boolean());
      allow("image_weight", z.number().finite().min(PROFILE.image_weight.minimum).max(PROFILE.image_weight.maximum).nullable());
    }
  } else if (model === "ideogram_40" && mode === "transparent") {
    allow("aspect_ratio", enumValues(PROFILE.ratios.ideogram_40_transparent), true);
    allow("resolution", enumValues(PROFILE.resolutions.ideogram_40_transparent), true);
    allow("magic_prompt", enumValues(PROFILE.magic_prompt).nullable());
  } else if (model === "ideogram_45" && mode === "generate") {
    allow("aspect_ratio", enumValues(PROFILE.ratios.ideogram_45_generate), true);
    allow("resolution", enumValues(PROFILE.resolutions.ideogram_45_generate), true);
    allow("magic_prompt", enumValues(PROFILE.magic_prompt).nullable());
  }

  if (model === "ideogram" && mode === "generate") {
    allow("magic_prompt", enumValues(PROFILE.magic_prompt).nullable());
    allow("negative_prompt", z.string().max(PROFILE.custom_source_bounds.negative_prompt_maximum).nullable());
    allow("style_type", enumValues(PROFILE.style_type).nullable());
    allow("style_preset", safeStylePresetSchema());
    allow("color_palette", colorPaletteSchema());
  } else if (model === "ideogram" && mode === "remix") {
    allow("magic_prompt", enumValues(PROFILE.magic_prompt).nullable());
    allow("negative_prompt", z.string().max(PROFILE.custom_source_bounds.negative_prompt_maximum).nullable());
    allow("style_type", enumValues(PROFILE.style_type).nullable());
    allow("style_preset", safeStylePresetSchema());
    allow("color_palette", colorPaletteSchema());
    allow("image_weight", z.number().finite().min(PROFILE.image_weight.minimum).max(PROFILE.image_weight.maximum), true);
  } else if (model === "ideogram" && mode === "reframe") {
    allow("style_type", enumValues(PROFILE.style_type).nullable());
    allow("style_preset", safeStylePresetSchema());
    allow("color_palette", colorPaletteSchema());
  } else if (model === "ideogram" && mode === "replace_background") {
    allow("magic_prompt", enumValues(PROFILE.magic_prompt).nullable());
    allow("style_type", enumValues(PROFILE.style_type).nullable());
    allow("style_preset", safeStylePresetSchema());
    allow("color_palette", colorPaletteSchema());
  } else if (model === "ideogram" && mode === "character_reference") {
    allow("negative_prompt", z.string().max(PROFILE.custom_source_bounds.negative_prompt_maximum).nullable());
    allow("style_type", enumValues(PROFILE.style_type).nullable());
    allow("magic_prompt", enumValues(PROFILE.magic_prompt).nullable());
  }

  if (model === "ideogram" && mode === "generate") {
    required.add("aspect_ratio"); required.add("resolution");
  }
  if (model === "ideogram" && mode === "remix") {
    required.add("aspect_ratio"); required.add("resolution");
  }
  if (model === "ideogram" && mode === "character_reference") {
    required.add("aspect_ratio"); required.add("resolution");
  }
  if (model === "ideogram_40" && mode === "generate") {
    required.add("aspect_ratio"); required.add("resolution");
  }
  if (model === "ideogram_40" && mode === "transparent") {
    required.add("aspect_ratio"); required.add("resolution");
  }
  if (model === "ideogram_45" && mode === "generate") {
    required.add("aspect_ratio"); required.add("resolution");
  }
  if (model === "ideogram" && mode === "remix") required.add("image_weight");

  const shape: Record<string, z.ZodType> = {};
  for (const key of allowed) shape[key] = required.has(key) ? properties[key]! : properties[key]!.optional();
  return z.object(shape).strict();
}

function referenceCounts(model: OwnerIdeogramImageModelId, mode: OwnerIdeogramImageMode, maskPresent = false): readonly number[] {
  if (model === "ideogram") {
    if (mode === "generate") return [0, 2, 3, 4, 5];
    if (mode === "remix" || mode === "reframe" || mode === "replace_background" || mode === "character_reference") return [1];
  }
  if (model === "ideogram_40") {
    if (mode === "generate") return [0, 1];
    if (mode === "transparent") return [0];
  }
  if (model === "ideogram_45") {
    if (mode === "generate") return [0, 1, 2, 3, 4, 5];
    if (mode === "precise_edit") return maskPresent ? [1, 2, 3, 4] : [1, 2, 3, 4, 5];
  }
  return [];
}

function speedOptions(model: OwnerIdeogramImageModelId): readonly string[] {
  return model === "ideogram_45" ? PROFILE.speed_options.ideogram_45 : PROFILE.speed_options.base_and_40;
}
function enumValues(values: readonly string[]): z.ZodType<string> { return z.enum([...values] as [string, ...string[]]); }
function stringOrNullEnum(values: readonly (string | null)[]): z.ZodType<string | null> {
  return z.union([enumValues(values.filter((value): value is string => value !== null)), z.null()]);
}
function safeStylePresetSchema(): z.ZodType<string | null> {
  return z.string().min(1).max(PROFILE.custom_source_bounds.style_preset_name_maximum)
    .refine((value) => value.trim().length > 0).nullable();
}
function colorPaletteSchema(): z.ZodType {
  const preset = z.object({ kind: z.literal("preset"), name: z.string().min(1).max(PROFILE.color_palette.preset_name_maximum)
    .refine((value) => value.trim().length > 0) }).strict();
  const custom = z.object({ kind: z.literal("custom"), colors: z.array(z.object({
    color_hex: z.string().min(1).max(PROFILE.color_palette.custom_local_limits.hex_characters_maximum),
    color_weight: z.number().finite().min(PROFILE.color_palette.custom_local_limits.weight_minimum)
      .max(PROFILE.color_palette.custom_local_limits.weight_maximum)
  }).strict()).min(PROFILE.color_palette.custom_local_limits.members_minimum).max(PROFILE.color_palette.custom_local_limits.members_maximum) }).strict();
  return z.union([preset, custom, z.null()]);
}

function effectiveInputBytes(model: OwnerIdeogramImageModelId): number {
  const policy = OWNER_IDEOGRAM_IMAGE_INPUT_POLICY.models[model];
  return policy.source_max_bytes === 0 ? policy.local_max_bytes : Math.min(policy.source_max_bytes, policy.local_max_bytes);
}
function isWithinBase64ByteLimit(value: string, maxBytes: number): boolean {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor(value.length / 4) * 3 - padding <= maxBytes;
}
function isCanonicalBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0 || !BASE64.test(value)) return false;
  if (value.endsWith("==")) {
    const lastSextet = BASE64_ALPHABET.indexOf(value[value.length - 3]!);
    return lastSextet >= 0 && (lastSextet & 0x0f) === 0;
  }
  if (value.endsWith("=")) {
    const lastSextet = BASE64_ALPHABET.indexOf(value[value.length - 2]!);
    return lastSextet >= 0 && (lastSextet & 0x03) === 0;
  }
  return true;
}
function isSafeFilename(value: string): boolean {
  return value !== "." && value !== ".." && value === value.trimEnd() && !value.endsWith(".") &&
    !/[<>:"/\\|?*\u0000-\u001f\u007f]/u.test(value) && isWellFormedUnicode(value) && Buffer.byteLength(value, "utf8") <= 255 &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(value);
}
function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function safeStructured(value: object): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> };
}

function errorResult(error: unknown, fallback: ToolErrorCode): CallToolResult {
  let code: ToolErrorCode = fallback;
  let recoveryId: string | undefined;
  let diagnostic: unknown;
  if (error instanceof OwnerIdeogramImageMaskUploadServiceError && MASK_UPLOAD_ERROR_CODES.includes(error.code)) code = error.code;
  else if (error instanceof OwnerIdeogramImageUploadServiceError && UPLOAD_ERROR_CODES.includes(error.code)) code = error.code;
  else if (error instanceof OwnerIdeogramImageGenerationServiceError &&
      (OWNER_IDEOGRAM_IMAGE_GENERATION_ERROR_CODES as readonly string[]).includes(error.code)) {
    code = error.code;
    if (code === "OUTCOME_UNKNOWN") {
      if (typeof error.recovery_id === "string" && RECOVERY_ID.test(error.recovery_id)) recoveryId = error.recovery_id;
      const parsed = diagnosticSchema.safeParse(error.diagnostic);
      if (parsed.success) diagnostic = parsed.data;
    }
  } else if (error instanceof OwnerReferencePrincipalError && PRINCIPAL_ERROR_CODES.includes(error.code)) code = error.code;
  const body = errorOutputSchema.parse({ error: { code, message: ERROR_MESSAGES[code],
    ...(recoveryId === undefined ? {} : { recovery_id: recoveryId }), ...(diagnostic === undefined ? {} : { diagnostic }) } });
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] };
}
