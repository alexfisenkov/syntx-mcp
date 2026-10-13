import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import {
  OwnerClarityUpscaleGenerationServiceError,
  type OwnerClarityUpscaleGenerationService
} from "../application/owner-clarity-upscale-generation-service.js";
import {
  OwnerClarityUpscaleUploadServiceError,
  type OwnerClarityUpscaleUploadService
} from "../application/owner-clarity-upscale-upload-service.js";
import { OwnerReferencePrincipalError } from "../auth/owner-reference-principal.js";
import {
  OWNER_CLARITY_UNKNOWN_DIAGNOSTIC_PHASES,
  OWNER_CLARITY_UNKNOWN_HISTORY_BINDINGS,
  OWNER_CLARITY_UNKNOWN_HISTORY_BINDING_REASONS,
  OWNER_CLARITY_UNKNOWN_UNVERIFIED_REASONS,
  OWNER_CLARITY_UNKNOWN_UPSTREAM_ERROR_CODES
} from "../application/owner-clarity-upscale-diagnostics.js";

export const SYNTX_OWNER_CLARITY_UPSCALE_UPLOAD_TOOL_NAME = "syntx_upload_clarity_upscale_image" as const;
export const SYNTX_OWNER_CLARITY_UPSCALE_GENERATE_TOOL_NAME = "syntx_owner_generate_clarity_upscale_image" as const;
export const SYNTX_OWNER_CLARITY_UPSCALE_RECONCILE_TOOL_NAME = "syntx_owner_reconcile_clarity_upscale_image" as const;
export const SYNTX_OWNER_CLARITY_UPSCALE_LIST_RECOVERIES_TOOL_NAME = "syntx_owner_list_clarity_upscale_recoveries" as const;

const attemptIdSchema = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const imageHandleSchema = z.string().regex(/^clarity_image_[0-9a-f-]{36}$/u);
const recoveryIdSchema = z.string().regex(/^clarity_recovery_[0-9a-f-]{36}$/u);
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const promptSchema = z.string().max(5_000).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/u).optional();
const CLARITY_MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const CLARITY_MAX_BASE64_CHARS = Math.ceil(CLARITY_MAX_IMAGE_BYTES / 3) * 4;

const uploadOutputSchema = z.object({
  status: z.literal("accepted"),
  image_handle: imageHandleSchema,
  mime_type: z.enum(["image/jpeg", "image/png", "image/avif", "image/webp"]),
  size: z.number().int().min(1).max(CLARITY_MAX_IMAGE_BYTES),
  width: z.number().int().positive().max(0xffff_ffff),
  height: z.number().int().positive().max(0xffff_ffff),
  sha256: sha256Schema,
  expires_in_seconds: z.literal(900),
  confidence_scope: z.literal("input_bytes_sniffed_and_dimensions_checked"),
  metadata_confidence: z.literal("CONTAINER_METADATA_ONLY"),
  upload_destination: z.literal("uploaded"),
  destination_source_binding: z.literal("root347_clarity_default_upload"),
  coverage: z.object({
    source_mime_types: z.tuple([z.literal("image/jpeg"), z.literal("image/png"), z.literal("image/avif"), z.literal("image/webp")]),
    source_max_bytes: z.literal(25 * 1024 * 1024),
    implemented_mime_types: z.tuple([z.literal("image/jpeg"), z.literal("image/png"), z.literal("image/avif"), z.literal("image/webp")]),
    implemented_max_bytes: z.literal(CLARITY_MAX_IMAGE_BYTES),
    status: z.literal("STRUCTURALLY_VALIDATED_NOT_PROVIDER_ACCEPTANCE"),
    upload_destination: z.literal("uploaded"),
    destination_source_binding: z.literal("root347_clarity_default_upload")
  }).strict()
}).strict();

const artifactSchema = z.object({
  url: z.string().url(),
  mime_type: z.string().regex(/^image\/[a-z0-9.+-]{1,64}$/u).nullable(),
  mime_confidence: z.enum(["URL_EXTENSION_ONLY", "UNKNOWN"])
}).strict();
const generationOutputSchema = z.object({
  status: z.literal("result_observed"),
  backend_acceptance: z.literal("unproven"),
  model_id: z.literal("clarity"),
  operation_id: z.literal("upscale-image"),
  profile_id: z.string().min(1).max(160),
  profile_schema_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  catalog_version: z.string().min(1).max(160),
  request_fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  requested_scale_factor: z.number().positive(),
  input_image: z.object({ mime_type: z.string().regex(/^image\/[a-z0-9.+-]{1,64}$/u), width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  expected_output_geometry: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict().nullable(),
  actual_image: z.object({ mime_type: z.string().regex(/^image\/[a-z0-9.+-]{1,64}$/u).nullable(), width: z.null(), height: z.null() }).strict(),
  geometry_verified: z.literal(false),
  artifact: artifactSchema
}).strict();
const recoveryListOutputSchema = z.object({
  recoveries: z.array(z.object({
    recovery_id: recoveryIdSchema,
    created_at: z.iso.datetime(),
    model_id: z.literal("clarity"),
    operation_id: z.literal("upscale-image"),
    status: z.literal("OUTCOME_UNKNOWN"),
    diagnostic: z.object({
      phase: z.enum(OWNER_CLARITY_UNKNOWN_DIAGNOSTIC_PHASES),
      echo_ack_known: z.boolean(),
      history_get_eligible: z.boolean(),
      history_get_performed: z.boolean(),
      history_get_count: z.number().int().min(0).max(255),
      history_get_count_capped: z.boolean(),
      history_binding: z.enum(OWNER_CLARITY_UNKNOWN_HISTORY_BINDINGS),
      history_binding_reason: z.enum(OWNER_CLARITY_UNKNOWN_HISTORY_BINDING_REASONS).nullable(),
      result_get_performed: z.boolean(),
      result_get_count: z.number().int().min(0).max(255),
      result_get_count_capped: z.boolean(),
      unverified_reason: z.enum(OWNER_CLARITY_UNKNOWN_UNVERIFIED_REASONS).nullable(),
      upstream_error_code: z.enum(OWNER_CLARITY_UNKNOWN_UPSTREAM_ERROR_CODES).nullable()
    }).strict()
  }).strict()).max(20),
  confidence_scope: z.literal("process_local_get_only_recovery"),
  expires_in_seconds: z.literal(900)
}).strict();

const parametersSchema = z.object({
  professional_mode: z.boolean(),
  scale_factor: z.number().min(0.01).max(6),
  strength: z.number().min(0.1).max(1),
  cfg: z.number().int().min(2).max(9),
  denoise: z.number().min(0.1).max(0.7)
}).strict();

export interface RegisterSyntxOwnerClarityUpscaleToolsOptions {
  readonly uploadService: Pick<OwnerClarityUpscaleUploadService, "upload">;
  readonly generationService: Pick<OwnerClarityUpscaleGenerationService, "generate" | "reconcile" | "listRecoveries">;
}

/** Register Clarity tools only when an explicit owner-local composition injects both services. */
export function registerSyntxOwnerClarityUpscaleTools(
  server: McpServer,
  options: RegisterSyntxOwnerClarityUpscaleToolsOptions
): void {
  server.registerTool(SYNTX_OWNER_CLARITY_UPSCALE_UPLOAD_TOOL_NAME, {
    title: "Upload an image for Clarity upscaling",
    description: "Upload one owner-provided JPEG, PNG, AVIF, or WebP image as portable base64 for the source-reviewed Clarity upscale flow. The server validates container structure and reads dimensions from container metadata only; this does not establish decoded pixels or provider acceptance. It returns an opaque 15-minute handle. This sends image bytes to SYNTX using the exact linked owner attempt; no local path or arbitrary URL is accepted.",
    inputSchema: z.object({
      link_attempt_id: attemptIdSchema,
      content_base64: z.string().min(4).max(CLARITY_MAX_BASE64_CHARS),
      filename: z.string().min(1).max(128),
      mime_type: z.enum(["image/jpeg", "image/png", "image/avif", "image/webp"])
    }).strict(),
    outputSchema: uploadOutputSchema,
    annotations: { title: "Upload an image for Clarity upscaling", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const result = await options.uploadService.upload({
        attemptId: input.link_attempt_id,
        content_base64: input.content_base64,
        filename: input.filename,
        mime_type: input.mime_type,
        ...(signal === undefined ? {} : { signal })
      });
      return safeStructured(uploadOutputSchema.parse(result));
    } catch (error) {
      return errorResult(error, "UPLOAD_FAILED");
    }
  });

  server.registerTool(SYNTX_OWNER_CLARITY_UPSCALE_GENERATE_TOOL_NAME, {
    title: "Upscale an owner image with Clarity",
    description: "REAL owner-authorized image transformation that may incur provider cost. Uses one previously uploaded Clarity image handle, an optional prompt, and the five explicit source settings in `parameters`; model_type and n are fixed/derived, while route, URL, account, and file reference are server-bound. Fresh subscription and model-access snapshots are checked before dispatch; no spending cap or provider acceptance is claimed. If the outcome is unknown, do not repeat the call; use the same recovery handle with GET-only reconciliation. Recovery is bounded, process-local, and not restart-safe.",
    inputSchema: z.object({
      link_attempt_id: attemptIdSchema,
      image_handle: imageHandleSchema,
      prompt: promptSchema,
      parameters: parametersSchema
    }).strict(),
    outputSchema: generationOutputSchema,
    annotations: { title: "Upscale an owner image with Clarity", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const result = await options.generationService.generate({
        attemptId: input.link_attempt_id,
        image_handle: input.image_handle,
        parameters: input.parameters,
        ...(input.prompt === undefined ? {} : { prompt: input.prompt })
      }, signal);
      return safeStructured(generationOutputSchema.parse(result));
    } catch (error) {
      return errorResult(error, "GENERATION_FAILED");
    }
  });

  server.registerTool(SYNTX_OWNER_CLARITY_UPSCALE_RECONCILE_TOOL_NAME, {
    title: "Reconcile a Clarity upscale result",
    description: "GET-only reconciliation of one exact process-local Clarity recovery handle and linked attempt. It does not upload, create a chat, check current subscription/model access, dispatch, retry, cancel, or delete. Recovery expires after 15 minutes and does not survive restart.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, recovery_id: recoveryIdSchema }).strict(),
    outputSchema: generationOutputSchema,
    annotations: { title: "Reconcile a Clarity upscale result", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const result = await options.generationService.reconcile({ attemptId: input.link_attempt_id, recovery_id: input.recovery_id }, signal);
      return safeStructured(generationOutputSchema.parse(result));
    } catch (error) {
      return errorResult(error, "OUTCOME_UNKNOWN");
    }
  });

  server.registerTool(SYNTX_OWNER_CLARITY_UPSCALE_LIST_RECOVERIES_TOOL_NAME, {
    title: "List Clarity upscale recovery handles",
    description: "Read up to 20 recent opaque Clarity recovery handles for the exact linked attempt from bounded process-local memory. No provider request, auth refresh, chat-client resolution, or generation is performed. Records expire after 15 minutes and are not restart-safe.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, limit: z.number().int().min(1).max(20).default(20) }).strict(),
    outputSchema: recoveryListOutputSchema,
    annotations: { title: "List Clarity upscale recovery handles", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input): Promise<CallToolResult> => {
    try {
      const records = await options.generationService.listRecoveries({ attemptId: input.link_attempt_id, limit: input.limit });
      return safeStructured(recoveryListOutputSchema.parse({ recoveries: records, confidence_scope: "process_local_get_only_recovery", expires_in_seconds: 900 }));
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
  if (error instanceof OwnerClarityUpscaleUploadServiceError) code = error.code;
  else if (error instanceof OwnerClarityUpscaleGenerationServiceError) {
    code = error.code;
    if (error.code === "OUTCOME_UNKNOWN" && typeof error.recovery_id === "string" && recoveryIdSchema.safeParse(error.recovery_id).success) {
      recoveryId = error.recovery_id;
    }
  } else if (error instanceof OwnerReferencePrincipalError) {
    code = error.code;
  }
  const messages: Record<string, string> = {
    INVALID_REQUEST: "The Clarity upscale request is invalid.",
    INVALID_IMAGE_INPUT: "Provide a valid supported image with matching MIME and safe dimensions.",
    UNSUPPORTED_SOURCE_FORMAT: "This source image format is not supported by the current Clarity uploader.",
    UNSUPPORTED_SOURCE_SIZE: "The image exceeds the current local Clarity upload limit.",
    PRINCIPAL_NOT_LINKED: "The exact SYNTX account attempt is not linked.",
    REFERENCE_PRINCIPAL_NOT_LINKED: "The exact SYNTX account attempt is not linked.",
    MODEL_BINDING_MISMATCH: "The pinned Clarity model is unavailable in the selected catalog.",
    SERVICE_BUSY: "The Clarity owner service is at its safe concurrency limit; retry only after this known pre-dispatch rejection.",
    CAPACITY_EXCEEDED: "The bounded Clarity owner service capacity is full.",
    SERVICE_CLOSED: "The Clarity owner service is closed.",
    REQUEST_ABORTED: "The Clarity upload was cancelled before dispatch.",
    IMAGE_HANDLE_UNAVAILABLE: "The image handle is unavailable for this exact linked attempt.",
    IMAGE_HANDLE_EXPIRED: "The image handle expired or is no longer available.",
    IMAGE_HANDLE_ALREADY_USED: "This image handle has already been claimed and cannot be dispatched again.",
    UPLOAD_REJECTED: "The Clarity image upload was rejected before a handle was issued.",
    UPLOAD_OUTCOME_UNKNOWN: "The upload outcome is unknown; do not upload it again automatically.",
    PREFLIGHT_FAILED: "Fresh subscription or model-access checks did not pass; no generation retry is implied.",
    PRE_DISPATCH_FAILED: "The Clarity generation request was rejected before dispatch.",
    OUTCOME_UNKNOWN: "The generation may have been dispatched; do not retry. Reconcile only with the known recovery handle.",
    RECOVERY_NOT_FOUND: "No matching process-local Clarity recovery record is available for this attempt.",
    RECOVERY_LIST_UNAVAILABLE: "Clarity recovery handles are unavailable."
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: {
      code,
      message: messages[code] ?? "The owner Clarity operation failed safely.",
      ...(recoveryId === undefined ? {} : { recovery_id: recoveryId }),
      ...(error instanceof OwnerClarityUpscaleGenerationServiceError && error.code === "OUTCOME_UNKNOWN" && error.diagnostic !== undefined
        ? { diagnostic: error.diagnostic }
        : {})
    } }) }]
  };
}
