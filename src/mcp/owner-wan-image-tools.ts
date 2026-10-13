import { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OwnerReferencePrincipalError } from "../auth/owner-reference-principal.js";
import {
  OWNER_WAN_IMAGE_GENERATION_ERROR_CODES,
  OWNER_WAN_IMAGE_HISTORY_BINDING_REASONS,
  OWNER_WAN_IMAGE_GENERATION_PHASES,
  OWNER_WAN_IMAGE_GENERATION_RESULT_REASONS,
  OwnerWanImageGenerationServiceError,
  type OwnerWanImageGenerationService,
  type OwnerWanImageUnknownDiagnostic
} from "../application/owner-wan-image-generation-service.js";
import {
  OwnerWanImageUploadServiceError,
  type OwnerWanImageUploadService
} from "../application/owner-wan-image-upload-service.js";
import {
  getOwnerWanImageSourceParameters,
  type OwnerWanImageParameters,
  type OwnerWanImageVariant
} from "../application/owner-wan-image-parameters.js";
import type { OwnerWanImageBboxCoordinatePolicy } from "../application/owner-wan-image-request-preparer.js";

const ATTEMPT_ID_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const REFERENCE_HANDLE_PATTERN = /^wan_image_[0-9a-f-]{36}$/u;
const RECOVERY_ID_PATTERN = /^wan_image_recovery_[0-9a-f-]{36}$/u;
const MAX_BASE64_CHARS = Math.ceil((20 * 1024 * 1024) / 3) * 4;
const SOURCE = getOwnerWanImageSourceParameters();
const VARIANTS = SOURCE.variants;
const ALL_RATIOS = [...new Set(Object.values(SOURCE.controls.aspect_ratio.variants).flat())];
const ALL_RESOLUTIONS = [...new Set(Object.values(SOURCE.controls.resolution.variants).flat())];
const BBOX_COORDINATE_POLICY = "LOCAL_HEADER_ORIENTATION_PROJECTION_UNVERIFIED_BROWSER" as const;
const CANONICAL_MIME_TYPES = ["image/png", "image/jpeg", "image/bmp", "image/webp"] as const;
const ORIGINAL_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/webp"] as const;
const UPLOAD_ERROR_CODES = [
  "INVALID_REQUEST", "INVALID_IMAGE_INPUT", "LOCAL_RESOURCE_LIMIT_EXCEEDED", "UNSUPPORTED_BMP_COMPOSITION",
  "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH", "SERVICE_BUSY", "CAPACITY_EXCEEDED", "SERVICE_CLOSED",
  "REQUEST_ABORTED", "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED", "UPLOAD_REJECTED", "UPLOAD_OUTCOME_UNKNOWN"
] as const;
const PRINCIPAL_ERROR_CODES = ["REFERENCE_PRINCIPAL_NOT_LINKED", "REFERENCE_PRINCIPAL_INVALID"] as const;
const STANDARD_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export const SYNTX_UPLOAD_WAN_REFERENCE_IMAGE_TOOL_NAME = "syntx_upload_wan_reference_image" as const;
export const SYNTX_OWNER_GENERATE_WAN_IMAGE_TOOL_NAME = "syntx_owner_generate_wan_image" as const;
export const SYNTX_OWNER_RECONCILE_WAN_IMAGE_TOOL_NAME = "syntx_owner_reconcile_wan_image" as const;
export const SYNTX_OWNER_LIST_WAN_RECOVERIES_TOOL_NAME = "syntx_owner_list_wan_recoveries" as const;

const attemptIdSchema = z.string().regex(ATTEMPT_ID_PATTERN)
  .describe("Exact linked owner attempt; not an account, provider, or chat identifier.");
const variantSchema = z.enum(VARIANTS).describe("Explicit source-reviewed WAN image variant.");
const referenceHandleSchema = z.string().regex(REFERENCE_HANDLE_PATTERN)
  .describe("Opaque uploaded WAN reference handle bound to this exact owner attempt and variant.");
const recoveryIdSchema = z.string().regex(RECOVERY_ID_PATTERN)
  .describe("Opaque process-local recovery handle for this exact linked attempt.");
const bboxPolicySchema = z.union([z.literal(BBOX_COORDINATE_POLICY), z.null()])
  .describe("Required explicit policy: use LOCAL_HEADER_ORIENTATION_PROJECTION_UNVERIFIED_BROWSER when any bbox is present; otherwise pass null. This does not prove browser-natural dimensions or provider crop semantics.");
const filenameSchema = z.string().refine(isSafePortableFilename,
  "Use a portable basename of at most 255 UTF-8 bytes.")
  .describe("Portable filename only. Local paths and URLs are not accepted; 255 UTF-8 bytes is a local portability guard.");
const promptSchema = z.string().refine(isValidUnicodeAndControls,
  "Prompt must be well-formed Unicode and contain no C0/C1 control characters other than tab, LF, and CR.")
  .describe("Required explicit prompt. Source-observed limit is 1,500 units for WAN 2.5/2.6 and 5,000 for WAN 2.7/2.7 Pro (UTF-16 code units plus LF count); preserve the original, do not clip. This is not a provider limit.");

const paletteColorSchema = z.object({
  hex: z.string().regex(/^#[0-9A-F]{6}$/u),
  ratio: z.string().regex(/^(?:100|[1-9]\d?)\.00%$/u)
}).strict();
const rectangleSchema = z.tuple([
  z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
]).refine(([left, top, right, bottom]) => left < right && top < bottom,
  "Bounding box must have positive area.");
const parametersSchema = z.object({
  aspect_ratio: z.enum(ALL_RATIOS),
  resolution: z.enum(ALL_RESOLUTIONS),
  batch_size: z.number().int().min(1).max(4),
  prompt_extend: z.boolean(),
  seed: z.number().int().min(0).max(2_147_483_647).nullable(),
  color_palette: z.array(paletteColorSchema).min(3).max(10).nullable(),
  bbox_list: z.array(z.array(rectangleSchema).max(2)).max(9)
}).strict().superRefine((parameters, context) => {
  if (parameters.color_palette !== null) {
    const total = parameters.color_palette.reduce((sum, entry) => sum + Number(entry.ratio.slice(0, -4)), 0);
    if (total !== 100) context.addIssue({ code: "custom", path: ["color_palette"], message: "Palette ratios must total 100%." });
  }
});

const uploadInputSchema = z.object({
  link_attempt_id: attemptIdSchema,
  variant: variantSchema,
  content_base64: z.string().min(4).max(MAX_BASE64_CHARS).regex(STANDARD_BASE64)
    .describe("Padded standard Base64 image data only. The 20 MiB encoded-input ceiling is an MCP guard; the service applies the selected variant's 10/20 MiB decoded limit."),
  filename: filenameSchema,
  mime_type: z.enum(ORIGINAL_MIME_TYPES)
}).strict();

const generateInputSchema = z.object({
  link_attempt_id: attemptIdSchema,
  variant: variantSchema,
  reference_handles: z.array(referenceHandleSchema).max(9),
  parameters: parametersSchema,
  prompt: promptSchema,
  bbox_coordinate_policy: bboxPolicySchema
}).strict().superRefine((input, context) => {
  const limits = SOURCE.reference_limits[input.variant];
  if (input.reference_handles.length < limits.minimum || input.reference_handles.length > limits.maximum) {
    context.addIssue({ code: "custom", path: ["reference_handles"], message: "Reference count is invalid for the selected WAN variant." });
  }
  if (new Set(input.reference_handles).size !== input.reference_handles.length) {
    context.addIssue({ code: "custom", path: ["reference_handles"], message: "Reference handles must be unique and ordered." });
  }
  if (!SOURCE.controls.aspect_ratio.variants[input.variant].includes(input.parameters.aspect_ratio as never)) {
    context.addIssue({ code: "custom", path: ["parameters", "aspect_ratio"], message: "Aspect ratio is unavailable for the selected WAN variant." });
  }
  if (!SOURCE.controls.resolution.variants[input.variant].includes(input.parameters.resolution as never)) {
    context.addIssue({ code: "custom", path: ["parameters", "resolution"], message: "Resolution is unavailable for the selected WAN variant." });
  }
  const isPaletteVariant = input.variant === "wan_27_image" || input.variant === "wan_27_image_pro";
  if ((!isPaletteVariant && input.parameters.color_palette !== null) ||
      (input.variant === "wan_27_image_pro" && input.parameters.resolution === "4K" && input.reference_handles.length > 0)) {
    context.addIssue({ code: "custom", path: ["parameters"], message: "The parameter combination is unavailable for the selected WAN variant." });
  }
  if (input.parameters.bbox_list.length !== input.reference_handles.length) {
    context.addIssue({ code: "custom", path: ["parameters", "bbox_list"], message: "bbox_list must contain one ordered entry per reference handle." });
  }
  const hasBoxes = input.parameters.bbox_list.some((entry) => entry.length > 0);
  const bboxActive = input.variant === "wan_27_image" || input.variant === "wan_27_image_pro";
  if (!bboxActive && hasBoxes) {
    context.addIssue({ code: "custom", path: ["parameters", "bbox_list"], message: "Bounding boxes are unavailable for this WAN variant." });
  }
  if ((hasBoxes && input.bbox_coordinate_policy !== BBOX_COORDINATE_POLICY) || (!hasBoxes && input.bbox_coordinate_policy !== null)) {
    context.addIssue({ code: "custom", path: ["bbox_coordinate_policy"], message: "Pass the projection policy exactly when bbox rectangles are present; otherwise pass null." });
  }
  if (!isPromptWithinSourceLimit(input.prompt, input.variant)) {
    context.addIssue({ code: "custom", path: ["prompt"], message: "Prompt exceeds the source-observed local input budget for the selected WAN variant." });
  }
});

const reconcileInputSchema = z.object({ link_attempt_id: attemptIdSchema, recovery_id: recoveryIdSchema }).strict();
const listInputSchema = z.object({ link_attempt_id: attemptIdSchema,
  limit: z.number().int().min(1).max(20).default(20) }).strict();

const uploadOutputSchema = z.object({
  status: z.literal("uploaded"), reference_handle: referenceHandleSchema, variant: variantSchema,
  original_mime_type: z.enum(ORIGINAL_MIME_TYPES), mime_type: z.enum(CANONICAL_MIME_TYPES),
  width: z.number().int().positive().max(0xffff_ffff), height: z.number().int().positive().max(0xffff_ffff),
  size: z.number().int().positive().max(20 * 1024 * 1024), sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  expires_in_seconds: z.number().int().min(1).max(900), metadata_confidence: z.literal("CONTAINER_METADATA_ONLY"),
  coordinate_projection: z.object({
    orientation: z.union([z.number().int().min(1).max(8), z.null()]),
    projected_width: z.number().int().positive().max(0xffff_ffff).nullable(),
    projected_height: z.number().int().positive().max(0xffff_ffff).nullable(),
    confidence: z.enum(["HEADER_ORIENTATION_PROJECTION_NOT_BROWSER_DECODE", "UNSUPPORTED_OR_MALFORMED_METADATA"])
  }).strict()
}).strict();

const publicInputImageSchema = z.object({
  mime_type: z.enum(CANONICAL_MIME_TYPES), width: z.number().int().positive().max(0xffff_ffff),
  height: z.number().int().positive().max(0xffff_ffff), size: z.number().int().positive().max(20 * 1024 * 1024),
  sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u), metadata_confidence: z.literal("CONTAINER_METADATA_ONLY")
}).strict();
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
  status: z.literal("result_observed"), backend_acceptance: z.literal("unproven"), ai_name: z.literal("wan_image"),
  model_id: variantSchema, variant: variantSchema, operation_id: z.literal("generate-image"),
  profile_id: z.literal("wan-image-source-reviewed-v1"), profile_schema_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  catalog_version: z.string().min(1).max(160), request_fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  parameters: parametersSchema, cost_inputs: z.object({ batch_size: z.number().int().min(1).max(4) }).strict(),
  cost_input_confidence: z.literal("SOURCE_JOINED_BATCH_SIZE_ONLY"), requested_batch_size: z.number().int().min(1).max(4),
  bbox_coordinate_policy: bboxPolicySchema, reference_count: z.number().int().min(0).max(9),
  input_images: z.array(publicInputImageSchema).max(9), artifacts: z.array(artifactSchema).min(1).max(4),
  expected_output_geometry: z.null(), geometry_verified: z.literal(false)
}).strict().superRefine((result, context) => {
  if (result.artifacts.length !== result.requested_batch_size) {
    context.addIssue({ code: "custom", path: ["artifacts"], message: "Artifact count does not match requested batch size." });
  }
  if (result.reference_count !== result.input_images.length || result.parameters.batch_size !== result.requested_batch_size ||
      result.parameters.bbox_list.length !== result.reference_count) {
    context.addIssue({ code: "custom", path: ["input_images"], message: "Result cardinalities do not match the explicit generation request." });
  }
  if (result.model_id !== result.variant || result.cost_inputs.batch_size !== result.requested_batch_size ||
      !SOURCE.controls.aspect_ratio.variants[result.variant].includes(result.parameters.aspect_ratio as never) ||
      !SOURCE.controls.resolution.variants[result.variant].includes(result.parameters.resolution as never)) {
    context.addIssue({ code: "custom", path: ["parameters"], message: "Result does not match its exact source-reviewed variant and cost-input binding." });
  }
  const paletteActive = result.variant === "wan_27_image" || result.variant === "wan_27_image_pro";
  const hasBoxes = result.parameters.bbox_list.some((entry) => entry.length > 0);
  if ((!paletteActive && result.parameters.color_palette !== null) ||
      (result.variant === "wan_27_image_pro" && result.parameters.resolution === "4K" && result.reference_count > 0) ||
      (!(result.variant === "wan_27_image" || result.variant === "wan_27_image_pro") && hasBoxes) ||
      (hasBoxes !==
        (result.bbox_coordinate_policy === BBOX_COORDINATE_POLICY))) {
    context.addIssue({ code: "custom", path: ["parameters"], message: "Result parameter combination violates the selected variant's local source contract." });
  }
});

const diagnosticSchema = z.object({
  phase: z.enum(OWNER_WAN_IMAGE_GENERATION_PHASES), post_started: z.boolean(), echo_ack_known: z.boolean(),
  history_binding: z.enum(["NONE", "PENDING", "READY", "INVALID"]),
  history_binding_reason: z.enum(OWNER_WAN_IMAGE_HISTORY_BINDING_REASONS).nullable(),
  history_get_calls: z.number().int().min(0).max(255), history_get_calls_saturated: z.boolean(),
  inprogress_get_calls: z.number().int().min(0).max(255), inprogress_get_calls_saturated: z.boolean(),
  result_get_calls: z.number().int().min(0).max(255), result_get_calls_saturated: z.boolean(),
  result_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "UNVERIFIED"]),
  result_reason: z.enum(OWNER_WAN_IMAGE_GENERATION_RESULT_REASONS).nullable()
}).strict();
const recoveryListOutputSchema = z.object({ recoveries: z.array(z.object({
  recovery_id: recoveryIdSchema, created_at: z.iso.datetime(), model_id: variantSchema,
  operation_id: z.literal("generate-image"), status: z.literal("OUTCOME_UNKNOWN"), diagnostic: diagnosticSchema
}).strict()).max(20), confidence_scope: z.literal("process_local_get_only_recovery") }).strict();

export interface RegisterSyntxOwnerWanImageToolsOptions {
  readonly uploadService: Pick<OwnerWanImageUploadService, "upload">;
  readonly generationService: Pick<OwnerWanImageGenerationService, "generate" | "reconcile" | "listRecoveries">;
}

/** Register only when an explicit owner-local composition is supplied. */
export function registerSyntxOwnerWanImageTools(
  server: import("@modelcontextprotocol/sdk/server/mcp.js").McpServer,
  options: RegisterSyntxOwnerWanImageToolsOptions
): void {
  server.registerTool(SYNTX_UPLOAD_WAN_REFERENCE_IMAGE_TOOL_NAME, {
    title: "Upload an owner WAN image reference",
    description: "Upload one owner-provided PNG, JPEG, JPG, BMP, or WebP image for an explicit source-reviewed WAN image variant. The MCP Base64 ceiling is 20 MiB; the service applies the selected variant's 10 or 20 MiB local decoded-input guard. Dimensions are container metadata only. Returns one opaque attempt- and variant-bound handle. No path or URL input is accepted.",
    inputSchema: uploadInputSchema, outputSchema: uploadOutputSchema,
    annotations: { title: "Upload a WAN image reference", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    const request = uploadInputSchema.safeParse(input);
    if (!request.success) return errorResult(undefined, "INVALID_REQUEST");
    try {
      const receipt = await options.uploadService.upload({ attemptId: request.data.link_attempt_id,
        variant: request.data.variant, content_base64: request.data.content_base64,
        filename: request.data.filename, mime_type: request.data.mime_type,
        ...(signal === undefined ? {} : { signal }) });
      return safeStructured(uploadOutputSchema.parse(receipt));
    } catch (error) { return errorResult(error, "UPLOAD_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_WAN_IMAGE_TOOL_NAME, {
    title: "Generate images with owner-authorized WAN",
    description: "Owner-authorized WAN image generation may incur provider cost. Select one exact variant, provide all seven explicit source controls, an explicit prompt, ordered opaque reference handles, and bbox_coordinate_policy (the exact local projection policy when any bbox is present; otherwise null). No values are defaulted or inferred. Cost inputs contain batch_size only; this is not a quote, billing cap, browser-dimension proof, provider acceptance, or output-geometry proof. An OUTCOME_UNKNOWN result may mean dispatch occurred; do not retry. Reconcile only with its same opaque recovery handle.",
    inputSchema: generateInputSchema, outputSchema: generationOutputSchema,
    annotations: { title: "Generate images with WAN", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    const request = generateInputSchema.safeParse(input);
    if (!request.success) return errorResult(undefined, "INVALID_REQUEST");
    try {
      const result = await options.generationService.generate({ attemptId: request.data.link_attempt_id,
        variant: request.data.variant, reference_handles: request.data.reference_handles,
        parameters: request.data.parameters as OwnerWanImageParameters, prompt: request.data.prompt,
        bbox_coordinate_policy: request.data.bbox_coordinate_policy as OwnerWanImageBboxCoordinatePolicy | null }, signal);
      return safeStructured(generationOutputSchema.parse(result));
    } catch (error) { return errorResult(error, "GENERATION_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_WAN_IMAGE_TOOL_NAME, {
    title: "Reconcile an owner WAN image outcome",
    description: "GET-only reconciliation for one opaque process-local recovery handle and the exact linked attempt. It does not upload, create a chat, recheck a cost estimate, dispatch, repeat a POST, cancel upstream work, or delete provider data. Recovery is not restart-safe; backend acceptance and completion are only reported when the service observes a strictly bound result.",
    inputSchema: reconcileInputSchema, outputSchema: generationOutputSchema,
    annotations: { title: "Reconcile a WAN image outcome", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    const request = reconcileInputSchema.safeParse(input);
    if (!request.success) return errorResult(undefined, "INVALID_REQUEST");
    try {
      const result = await options.generationService.reconcile({ attemptId: request.data.link_attempt_id,
        recovery_id: request.data.recovery_id }, signal);
      return safeStructured(generationOutputSchema.parse(result));
    } catch (error) { return errorResult(error, "OUTCOME_UNKNOWN"); }
  });

  server.registerTool(SYNTX_OWNER_LIST_WAN_RECOVERIES_TOOL_NAME, {
    title: "List owner WAN image recoveries",
    description: "List bounded process-local recovery records scoped to the exact linked attempt. This read-only operation does not upload or dispatch, and the listed diagnostics exclude prompts, palettes, private URLs, provider identifiers, filenames, and reference handles. The records are not restart-safe.",
    inputSchema: listInputSchema, outputSchema: recoveryListOutputSchema,
    annotations: { title: "List WAN image recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
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

function safeStructured(value: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

function errorResult(error: unknown, fallback: string): CallToolResult {
  let code = fallback;
  let recoveryId: string | undefined;
  let diagnostic: OwnerWanImageUnknownDiagnostic | undefined;
  if (error instanceof OwnerWanImageUploadServiceError && UPLOAD_ERROR_CODES.includes(error.code)) code = error.code;
  else if (error instanceof OwnerWanImageGenerationServiceError &&
      (OWNER_WAN_IMAGE_GENERATION_ERROR_CODES as readonly string[]).includes(error.code)) {
    code = error.code;
    if (code === "OUTCOME_UNKNOWN") {
      if (typeof error.recovery_id === "string" && RECOVERY_ID_PATTERN.test(error.recovery_id)) recoveryId = error.recovery_id;
      const parsed = diagnosticSchema.safeParse(error.diagnostic);
      if (parsed.success) diagnostic = parsed.data as OwnerWanImageUnknownDiagnostic;
    }
  } else if (error instanceof OwnerReferencePrincipalError && PRINCIPAL_ERROR_CODES.includes(error.code)) code = error.code;
  const messages: Record<string, string> = {
    INVALID_REQUEST: "The owner WAN image request is invalid.", INVALID_IMAGE_INPUT: "Provide a supported image with matching MIME and safe dimensions.",
    LOCAL_RESOURCE_LIMIT_EXCEEDED: "The image exceeds the local WAN input resource guard.",
    UNSUPPORTED_BMP_COMPOSITION: "This BMP composition is not supported by the current local validator.",
    PRINCIPAL_NOT_LINKED: "The exact owner attempt is not linked.", REFERENCE_PRINCIPAL_NOT_LINKED: "The exact owner attempt is not linked.",
    REFERENCE_PRINCIPAL_INVALID: "The exact owner attempt is not linked.",
    MODEL_BINDING_MISMATCH: "The selected WAN variant is unavailable in the pinned source catalog.",
    SERVICE_BUSY: "The owner WAN service is at its safe concurrency limit; no automatic retry was performed.",
    CAPACITY_EXCEEDED: "The bounded owner WAN service capacity is full.", SERVICE_CLOSED: "The owner WAN service is closed.",
    REQUEST_ABORTED: "The upload was aborted; inspect the exact operation outcome before retrying.",
    REFERENCE_UNAVAILABLE: "The reference handle is unavailable for this exact attempt and variant.",
    REFERENCE_EXPIRED: "The reference handle expired or is no longer available.",
    REFERENCE_ALREADY_CLAIMED: "This reference set is already claimed and cannot be dispatched again.",
    UPLOAD_REJECTED: "The reference upload was rejected before a handle was issued.",
    UPLOAD_OUTCOME_UNKNOWN: "The upload outcome is unknown; do not upload it again automatically.",
    PREFLIGHT_FAILED: "Fresh subscription or model-access checks did not pass; this is not permission to retry generation.",
    PRE_DISPATCH_FAILED: "The generation request failed before dispatch.",
    OUTCOME_UNKNOWN: "Generation may have been dispatched; do not retry. Reconcile only with the known recovery handle.",
    RECOVERY_NOT_FOUND: "No matching process-local recovery record is available for this attempt.",
    UPLOAD_FAILED: "The WAN image upload failed safely.", GENERATION_FAILED: "The WAN generation outcome could not be confirmed; do not repeat an operation that may have been dispatched.",
    RECOVERY_LIST_UNAVAILABLE: "WAN recovery handles are unavailable."
  };
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: {
    code, message: messages[code] ?? "The owner WAN image operation failed safely.",
    ...(recoveryId === undefined ? {} : { recovery_id: recoveryId }), ...(diagnostic === undefined ? {} : { diagnostic })
  } }) }] };
}

function isSafePortableFilename(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && value === value.trimEnd() && !value.endsWith(".") &&
    !/\p{Cc}/u.test(value) && !/[<>:"/\\|?*]/u.test(value) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(value) && isWellFormedUnicode(value) &&
    Buffer.byteLength(value, "utf8") <= 255;
}

function isValidUnicodeAndControls(value: string): boolean {
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value) && isWellFormedUnicode(value);
}

function isPromptWithinSourceLimit(value: string, variant: OwnerWanImageVariant): boolean {
  const limit = variant === "wan_25_i2i_preview" || variant === "wan_26_image" ? 1_500 : 5_000;
  let units = value.length;
  for (let index = 0; index < value.length; index += 1) if (value.charCodeAt(index) === 0x000a) units += 1;
  return value.trim().length > 0 && units <= limit;
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
