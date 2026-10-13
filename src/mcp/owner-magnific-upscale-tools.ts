import { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  OwnerMagnificUpscaleUploadServiceError,
  type OwnerMagnificUpscaleUploadService
} from "../application/owner-magnific-upscale-upload-service.js";
import {
  OwnerMagnificUpscaleGenerationServiceError,
  OWNER_MAGNIFIC_GENERATION_PHASES,
  type OwnerMagnificUpscaleGenerationService,
  type OwnerMagnificUpscaleUnknownDiagnostic
} from "../application/owner-magnific-upscale-generation-service.js";
import { OWNER_MAGNIFIC_HISTORY_BINDING_REASONS } from "../application/owner-magnific-upscale-history-binding.js";
import { getOwnerMagnificUpscaleSourceParameters } from "../application/owner-magnific-upscale-parameters.js";

const ATTEMPT_ID_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const IMAGE_HANDLE_PATTERN = /^magnific_image_[0-9a-f-]{36}$/u;
const RECOVERY_ID_PATTERN = /^magnific_recovery_[0-9a-f-]{36}$/u;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const STANDARD_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const SOURCE_PARAMETERS = getOwnerMagnificUpscaleSourceParameters();
const MAGNIFIC_VARIANTS = SOURCE_PARAMETERS.variants;
const SCALE_FACTORS = SOURCE_PARAMETERS.controls.scale_factor.values;
const OPTIMIZED_FOR = SOURCE_PARAMETERS.controls.optimized_for.values;
const ENGINES = SOURCE_PARAMETERS.controls.engine.values;
const FLAVORS = SOURCE_PARAMETERS.controls.flavor.values;
const NUMERIC_RESULT_REASONS = [
  "NO_RESULT_OBJECTS", "RESULT_NOT_COMPLETED", "RESPONSE_SHAPE_INVALID", "OUTER_MESSAGE_MISMATCH",
  "PROVIDER_CHAT_MISMATCH", "NOT_BOT_MESSAGE", "RESULT_OBJECT_CARDINALITY_INVALID", "RESULT_OBJECT_SHAPE_INVALID",
  "OBJECT_ID_MISMATCH", "OBJECT_MESSAGE_MISMATCH", "OBJECT_TYPE_MISMATCH", "MODEL_TYPE_UNAVAILABLE",
  "MODEL_TYPE_MISMATCH", "RESULT_URL_UNSAFE", "RESULT_MIME_UNKNOWN"
] as const;

export const SYNTX_UPLOAD_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME = "syntx_upload_magnific_upscale_image";
export const SYNTX_OWNER_GENERATE_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME = "syntx_owner_generate_magnific_upscale_image";
export const SYNTX_OWNER_RECONCILE_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME = "syntx_owner_reconcile_magnific_upscale_image";
export const SYNTX_OWNER_LIST_MAGNIFIC_UPSCALE_RECOVERIES_TOOL_NAME = "syntx_owner_list_magnific_upscale_recoveries";

const attemptIdSchema = z.string().regex(ATTEMPT_ID_PATTERN).describe("Exact linked owner attempt; never a user, account, or provider identifier.");
const variantSchema = z.enum(MAGNIFIC_VARIANTS).describe(
  "Explicit selected Magnific model ID: creative, precision_v1, or precision_v2. The family ai_name is magnific; model_type is derived server-side."
);
const imageHandleSchema = z.string().regex(IMAGE_HANDLE_PATTERN).describe("Opaque upload handle bound to this exact attempt and Magnific variant.");
const recoveryIdSchema = z.string().regex(RECOVERY_ID_PATTERN).describe("Opaque process-local recovery handle; use only with the same linked attempt.");
const promptSchema = z.string().refine((value) => Buffer.byteLength(value, "utf8") <= 5_000,
  "Prompt exceeds the local 5,000-byte UTF-8 limit.").describe("Optional prompt; local UTF-8 byte guard only, not a provider limit. Empty prompt is treated as omitted.");

const parametersSchema = z.object({
  scale_factor: z.enum(SCALE_FACTORS).describe("Explicit string scale selected for the requested variant."),
  optimized_for: z.enum(OPTIMIZED_FOR).describe("Explicit creative optimization target, required even when hidden by the selected branch."),
  engine: z.enum(ENGINES).describe("Explicit creative engine, required even when hidden by the selected branch."),
  creativity: z.number().int().min(-10).max(10).describe("Explicit creative control; integer from -10 through 10."),
  hdr: z.number().int().min(-10).max(10).describe("Explicit creative HDR control; integer from -10 through 10."),
  resemblance: z.number().int().min(-10).max(10).describe("Explicit creative resemblance control; integer from -10 through 10."),
  fractality: z.number().int().min(-10).max(10).describe("Explicit creative fractality control; integer from -10 through 10."),
  sharpen: z.number().int().min(0).max(100).describe("Explicit precision sharpen control; integer from 0 through 100."),
  smart_grain: z.number().int().min(0).max(100).describe("Explicit precision smart-grain control; integer from 0 through 100."),
  ultra_detail: z.number().int().min(0).max(100).describe("Explicit precision ultra-detail control; integer from 0 through 100."),
  flavor: z.enum(FLAVORS).describe("Explicit precision-v2 flavor, required even when hidden by the selected branch.")
}).strict().describe(
  "Full explicit Magnific state: all eleven fields are required and validated, including inactive/hidden controls. No defaults, cache fill, model_type, n, dimensions, or file URL are accepted."
);

const uploadInputSchema = z.object({
  link_attempt_id: attemptIdSchema,
  variant: variantSchema,
  content_base64: z.string().min(4).max(MAX_BASE64_CHARS).regex(STANDARD_BASE64)
    .describe("Portable padded standard Base64 image bytes; local maximum encodes 10 MiB, a UI fallback not a provider cap."),
  filename: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/u)
    .describe("Portable filename only; local paths and URL fields are not accepted."),
  mime_type: z.enum(["image/jpeg", "image/png", "image/avif", "image/webp"])
}).strict();

const uploadOutputSchema = z.object({
  status: z.literal("accepted"),
  image_handle: imageHandleSchema,
  variant: variantSchema,
  mime_type: z.enum(["image/jpeg", "image/png", "image/avif", "image/webp"]),
  size: z.number().int().min(1).max(MAX_IMAGE_BYTES),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  expires_in_seconds: z.literal(900),
  metadata_confidence: z.literal("CONTAINER_METADATA_ONLY")
}).strict();

const generationOutputSchema = z.object({
  status: z.literal("result_observed"),
  backend_acceptance: z.literal("unproven"),
  ai_name: z.literal("magnific"),
  model_id: z.enum(MAGNIFIC_VARIANTS),
  variant: z.enum(MAGNIFIC_VARIANTS),
  operation_id: z.literal("upscale-image"),
  profile_id: z.literal("magnific-upscale-source-reviewed-v1"),
  profile_schema_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  catalog_version: z.string().min(1).max(160),
  request_fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  requested_scale_factor: z.enum(SCALE_FACTORS),
  input_image: z.object({
    mime_type: z.enum(["image/jpeg", "image/png", "image/avif", "image/webp"]),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    size: z.number().int().min(1).max(MAX_IMAGE_BYTES),
    sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    metadata_confidence: z.literal("CONTAINER_METADATA_ONLY")
  }).strict(),
  expected_output_geometry: z.null(),
  actual_image: z.object({
    mime_type: z.string().regex(/^image\/[a-z0-9.+-]{1,64}$/u),
    width: z.null(),
    height: z.null()
  }).strict(),
  geometry_verified: z.literal(false),
  artifact: z.object({
    url: z.string().url(),
    mime_type: z.string().regex(/^image\/[a-z0-9.+-]{1,64}$/u),
    mime_source: z.literal("URL_EXTENSION")
  }).strict()
}).strict();

const diagnosticSchema = z.object({
  phase: z.enum(OWNER_MAGNIFIC_GENERATION_PHASES),
  post_started: z.boolean(),
  echo_ack_known: z.boolean(),
  history_binding: z.enum(["NONE", "PENDING", "READY", "INVALID"]),
  history_binding_reason: z.enum(OWNER_MAGNIFIC_HISTORY_BINDING_REASONS).nullable(),
  history_get_calls: z.number().int().min(0).max(255),
  history_get_calls_saturated: z.boolean(),
  inprogress_get_calls: z.number().int().min(0).max(255),
  inprogress_get_calls_saturated: z.boolean(),
  result_get_calls: z.number().int().min(0).max(255),
  result_get_calls_saturated: z.boolean(),
  result_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "UNVERIFIED"]),
  result_reason: z.enum(NUMERIC_RESULT_REASONS).nullable(),
  model_eq_requested: z.boolean().optional(),
  model_eq_family: z.boolean().optional()
}).strict();

const recoveryListOutputSchema = z.object({
  recoveries: z.array(z.object({
    recovery_id: recoveryIdSchema,
    created_at: z.iso.datetime(),
    model_id: z.enum(MAGNIFIC_VARIANTS),
    operation_id: z.literal("upscale-image"),
    status: z.literal("OUTCOME_UNKNOWN"),
    diagnostic: diagnosticSchema
  }).strict()).max(20),
  confidence_scope: z.literal("process_local_get_only_recovery"),
  expires_in_seconds: z.literal(900)
}).strict();

export interface RegisterSyntxOwnerMagnificUpscaleToolsOptions {
  readonly uploadService: Pick<OwnerMagnificUpscaleUploadService, "upload">;
  readonly generationService: Pick<OwnerMagnificUpscaleGenerationService, "generate" | "reconcile" | "listRecoveries">;
}

/** Register only under an explicit owner-local Magnific service injection. */
export function registerSyntxOwnerMagnificUpscaleTools(
  server: import("@modelcontextprotocol/sdk/server/mcp.js").McpServer,
  options: RegisterSyntxOwnerMagnificUpscaleToolsOptions
): void {
  server.registerTool(SYNTX_UPLOAD_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME, {
    title: "Upload an image for Magnific upscaling",
    description: "Upload one owner-provided JPEG, PNG, AVIF, or WebP image as portable Base64 for an explicitly selected Magnific variant. The observed frontend fallback is a 10 MiB local check, not a provider limit; dimensions come from container metadata and do not prove decoded pixels or output geometry. The returned opaque handle is bound to this exact attempt and variant; no path, URL, chat ID, or account override is accepted.",
    inputSchema: uploadInputSchema,
    outputSchema: uploadOutputSchema,
    annotations: { title: "Upload a Magnific upscale input", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const receipt = await options.uploadService.upload({
        attemptId: input.link_attempt_id,
        variant: input.variant,
        content_base64: input.content_base64,
        filename: input.filename,
        mime_type: input.mime_type,
        ...(signal === undefined ? {} : { signal })
      });
      return safeStructured(uploadOutputSchema.parse(receipt));
    } catch (error) {
      return errorResult(error, "UPLOAD_FAILED");
    }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME, {
    title: "Upscale an owner image with Magnific",
    description: "Owner-authorized image transformation that may incur provider cost. Select one of the three source-reviewed Magnific variants and supply all eleven explicit state fields; hidden/inactive values are still required, with no cache/default fill. model_type is derived from variant and n=1; the exact linked account, upload URL, dimensions, source profile, and chat are server-bound. Optional prompt has a local UTF-8 byte check only. Backend acceptance and output geometry remain unproven. After OUTCOME_UNKNOWN do not repeat generation; reconcile only with the same opaque handle.",
    inputSchema: z.object({
      link_attempt_id: attemptIdSchema,
      variant: variantSchema,
      image_handle: imageHandleSchema,
      prompt: promptSchema.optional(),
      parameters: parametersSchema
    }).strict(),
    outputSchema: generationOutputSchema,
    annotations: { title: "Upscale an owner image with Magnific", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const result = await options.generationService.generate({
        attemptId: input.link_attempt_id,
        variant: input.variant,
        image_handle: input.image_handle,
        parameters: input.parameters,
        ...(input.prompt === undefined ? {} : { prompt: input.prompt })
      }, signal);
      return safeStructured(generationOutputSchema.parse(result));
    } catch (error) {
      return errorResult(error, "GENERATION_FAILED");
    }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME, {
    title: "Reconcile a Magnific upscale result",
    description: "GET-only reconciliation of one process-local Magnific recovery handle for the exact linked attempt. It does not upload, create a chat, preflight account/cost, dispatch, retry, cancel, or delete. Recovery is bounded and expires after 15 minutes; it is not restart-safe.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, recovery_id: recoveryIdSchema }).strict(),
    outputSchema: generationOutputSchema,
    annotations: { title: "Reconcile a Magnific upscale", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const result = await options.generationService.reconcile({ attemptId: input.link_attempt_id, recovery_id: input.recovery_id }, signal);
      return safeStructured(generationOutputSchema.parse(result));
    } catch (error) {
      return errorResult(error, "OUTCOME_UNKNOWN");
    }
  });

  server.registerTool(SYNTX_OWNER_LIST_MAGNIFIC_UPSCALE_RECOVERIES_TOOL_NAME, {
    title: "List Magnific upscale recovery handles",
    description: "Read up to 20 recent opaque Magnific recovery handles for the exact linked attempt from process-local memory. No provider request, authentication refresh, chat-client resolution, or generation is performed. Records expire after 15 minutes and are not restart-safe.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, limit: z.number().int().min(1).max(20).default(20) }).strict(),
    outputSchema: recoveryListOutputSchema,
    annotations: { title: "List Magnific recovery handles", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input): Promise<CallToolResult> => {
    try {
      const recoveries = await options.generationService.listRecoveries({ attemptId: input.link_attempt_id, limit: input.limit });
      return safeStructured(recoveryListOutputSchema.parse({
        recoveries,
        confidence_scope: "process_local_get_only_recovery",
        expires_in_seconds: 900
      }));
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
  let diagnostic: OwnerMagnificUpscaleUnknownDiagnostic | undefined;
  if (error instanceof OwnerMagnificUpscaleUploadServiceError) {
    code = error.code;
  } else if (error instanceof OwnerMagnificUpscaleGenerationServiceError) {
    code = error.code;
    if (error.code === "OUTCOME_UNKNOWN" && typeof error.recovery_id === "string" && recoveryIdSchema.safeParse(error.recovery_id).success) {
      recoveryId = error.recovery_id;
      const parsed = diagnosticSchema.safeParse(error.diagnostic);
      if (parsed.success) {
        const value = parsed.data;
        diagnostic = Object.freeze({
          phase: value.phase,
          post_started: value.post_started,
          echo_ack_known: value.echo_ack_known,
          history_binding: value.history_binding,
          history_binding_reason: value.history_binding_reason,
          history_get_calls: value.history_get_calls,
          history_get_calls_saturated: value.history_get_calls_saturated,
          inprogress_get_calls: value.inprogress_get_calls,
          inprogress_get_calls_saturated: value.inprogress_get_calls_saturated,
          result_get_calls: value.result_get_calls,
          result_get_calls_saturated: value.result_get_calls_saturated,
          result_status: value.result_status,
          result_reason: value.result_reason,
          ...(typeof value.model_eq_requested === "boolean" ? { model_eq_requested: value.model_eq_requested } : {}),
          ...(typeof value.model_eq_family === "boolean" ? { model_eq_family: value.model_eq_family } : {})
        });
      }
    }
  }
  const messages: Record<string, string> = {
    INVALID_REQUEST: "The Magnific upscale request is invalid.",
    INVALID_IMAGE_INPUT: "Provide a supported image whose bytes and container metadata pass local validation.",
    UNSUPPORTED_SOURCE_FORMAT: "This source image format is not supported by the current Magnific uploader.",
    UNSUPPORTED_SOURCE_SIZE: "The image exceeds the current local Magnific input check.",
    UNSUPPORTED_AVIF_COMPOSITION: "This AVIF image composition is not supported by the current local Magnific validator.",
    PRINCIPAL_NOT_LINKED: "The exact SYNTX account attempt is not linked.",
    MODEL_BINDING_MISMATCH: "The selected Magnific variant is unavailable in the pinned catalog.",
    SERVICE_BUSY: "The Magnific owner service is at its safe concurrency limit.",
    CAPACITY_EXCEEDED: "The bounded Magnific owner service capacity is full.",
    SERVICE_CLOSED: "The Magnific owner service is closed.",
    REQUEST_ABORTED: "The Magnific upload was cancelled before completion.",
    IMAGE_HANDLE_UNAVAILABLE: "The image handle is unavailable for this exact linked attempt and variant.",
    IMAGE_HANDLE_EXPIRED: "The Magnific image handle expired or is no longer available.",
    IMAGE_HANDLE_ALREADY_USED: "This image handle has already been claimed and cannot be dispatched again.",
    UPLOAD_REJECTED: "The Magnific image upload was rejected before a handle was issued.",
    UPLOAD_OUTCOME_UNKNOWN: "The upload outcome is unknown; do not upload it again automatically.",
    PREFLIGHT_FAILED: "Fresh account or model-access checks did not pass; no generation retry is implied.",
    PRE_DISPATCH_FAILED: "The Magnific generation request was rejected before dispatch.",
    OUTCOME_UNKNOWN: "Generation may have been dispatched; do not repeat it. Reconcile only with the same recovery handle.",
    RECOVERY_NOT_FOUND: "No matching process-local Magnific recovery record is available for this attempt.",
    RECOVERY_LIST_UNAVAILABLE: "Magnific recovery handles are unavailable."
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: {
      code,
      message: messages[code] ?? "The owner Magnific operation failed safely.",
      ...(recoveryId === undefined ? {} : { recovery_id: recoveryId }),
      ...(diagnostic === undefined ? {} : { diagnostic })
    } }) }]
  };
}
