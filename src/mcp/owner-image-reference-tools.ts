import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { OwnerContractMediaError } from "../application/owner-contract-media.js";
import { OwnerMediaReferenceStoreError } from "../application/owner-media-reference-store.js";
import { OwnerImageReferenceInputError } from "../application/owner-image-reference-input-validator.js";
import { OwnerImageReferenceServiceError, type OwnerImageReferenceServicePort } from "../application/owner-image-reference-service.js";
import { OwnerReferencePrincipalError } from "../auth/owner-reference-principal.js";

export const SYNTX_OWNER_UPLOAD_IMAGE_REFERENCE_TOOL_NAME = "syntx_upload_image_reference" as const;
export const SYNTX_OWNER_GENERATE_REFERENCE_IMAGE_TOOL_NAME = "syntx_owner_generate_reference_image" as const;
export const SYNTX_OWNER_RECONCILE_REFERENCE_IMAGE_TOOL_NAME = "syntx_owner_reconcile_reference_image" as const;
export const SYNTX_OWNER_LIST_REFERENCE_RECOVERY_TOOL_NAME = "syntx_owner_list_reference_recovery" as const;

const attemptIdSchema = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const referenceHandleSchema = z.string().regex(/^reference_[0-9a-f-]{36}$/u);
const recoveryIdSchema = z.string().regex(/^recovery_[0-9a-f-]{36}$/u);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const artifactSchema = z.object({
  url: z.string().url(),
  mime_type: z.literal("image/jpeg"),
  byte_size: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional()
}).strict();
const evidenceSchema = z.object({
  confidence_scope: z.literal("root126_exact_owner_reference_path"),
  backend_acceptance: z.literal("one_observed_png_reference_on_exact_tuple"),
  profile: z.object({
    model_id: z.literal("banana-2.1"),
    variant_id: z.literal("banana21-image-1k-minimal-square"),
    image_size: z.literal("1K"),
    thinking_level: z.literal("minimal"),
    aspect_ratio: z.literal("1:1"),
    n: z.literal(1)
  }).strict(),
  limits: z.tuple([z.string(), z.string()])
}).strict();
const generatedOutputSchema = z.object({
  model_id: z.literal("banana-2.1"),
  operation_id: z.literal("generate-image"),
  variant_id: z.literal("banana21-image-1k-minimal-square"),
  status: z.literal("result_observed"),
  confidence: evidenceSchema,
  artifacts: z.array(artifactSchema).length(1)
}).strict();
const uploadOutputSchema = z.object({
  status: z.literal("accepted"),
  reference_handle: referenceHandleSchema,
  mime_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
  mime_type_source: z.literal("request_declared"),
  size: z.number().int().min(1).max(7 * 1024 * 1024),
  size_source: z.literal("request_bytes"),
  image: z.object({
    mime_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
    width: z.number().int().positive().max(8400),
    height: z.number().int().positive().max(8400),
    sha256: sha256Schema
  }).strict(),
  expires_in_seconds: z.literal(900),
  confidence_scope: z.literal("input_bytes_sniffed_and_dimensions_checked")
}).strict();
const recoveryListSchema = z.object({
  recoveries: z.array(z.object({
    recovery_id: recoveryIdSchema,
    model_id: z.literal("banana-2.1"),
    operation_id: z.literal("generate-image"),
    created_at: z.iso.datetime(),
    variant_id: z.literal("banana21-image-1k-minimal-square")
  }).strict()).max(20),
  confidence_scope: z.literal("process_local_get_only_recovery"),
  expires_in_seconds: z.literal(900)
}).strict();

export interface RegisterSyntxOwnerImageReferenceToolsOptions {
  readonly service: OwnerImageReferenceServicePort;
}

/** Register the four reference tools only on an explicitly opted-in owner server. */
export function registerSyntxOwnerImageReferenceTools(
  server: McpServer,
  options: RegisterSyntxOwnerImageReferenceToolsOptions
): void {
  const service = options.service;
  server.registerTool(SYNTX_OWNER_UPLOAD_IMAGE_REFERENCE_TOOL_NAME, {
    title: "Upload an owner image reference",
    description: "Upload one local image provided as portable base64. The server checks the actual JPEG, PNG, or WebP signature and header dimensions, then stores it in SYNTX hidden uploads and returns an opaque 15-minute handle. Only PNG was exercised live as a Banana reference; local JPEG/WebP validation does not prove backend acceptance. The image bytes are sent to SYNTX by the owner-authorized account.",
    inputSchema: z.object({
      link_attempt_id: attemptIdSchema,
      content_base64: z.string().min(4).max(9_786_712),
      filename: z.string().min(1).max(128),
      mime_type: z.enum(["image/jpeg", "image/png", "image/webp"])
    }).strict(),
    outputSchema: uploadOutputSchema,
    annotations: { title: "Upload an owner image reference", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const result = await service.upload(input, signal);
      const output = uploadOutputSchema.parse(result);
      return success(output);
    } catch (error) {
      return errorResult(error, "IMAGE_REFERENCE_UPLOAD_FAILED");
    }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_REFERENCE_IMAGE_TOOL_NAME, {
    title: "Generate one Banana 2.1 image from a reference",
    description: "REAL, billed image generation using one previously uploaded owner reference and one prompt. Fixed to Banana 2.1, 1K, minimal, 1:1, one image. Fresh subscription, model access and current cost are read before dispatch; no spending cap or separate approval is enforced. The live reference proof covers only one PNG input and one result on this exact tuple. JPEG/WebP upload validation does not prove those formats work as references. If the outcome is unknown, do not call again; use GET-only reconciliation with the returned recovery id. Recovery is process-local for 15 minutes and not restart-safe.",
    inputSchema: z.object({
      link_attempt_id: attemptIdSchema,
      reference_handle: referenceHandleSchema,
      prompt: z.string().trim().min(1).max(4096).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/u)
    }).strict(),
    outputSchema: generatedOutputSchema,
    annotations: { title: "Generate one Banana 2.1 image from a reference", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const result = await service.generate(input, signal);
      const output = generatedOutputSchema.parse(result);
      return success(output);
    } catch (error) {
      return errorResult(error, "REFERENCE_GENERATION_FAILED");
    }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_REFERENCE_IMAGE_TOOL_NAME, {
    title: "Reconcile a reference image request",
    description: "GET-only reconciliation of one exact process-local reference generation recovery handle. It does not upload, create a chat, check model access, dispatch generation, retry, cancel, or delete. Handles expire after 15 minutes and do not survive restart.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, recovery_id: recoveryIdSchema }).strict(),
    outputSchema: generatedOutputSchema,
    annotations: { title: "Reconcile a reference image request", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const result = await service.reconcile(input, signal);
      return success(generatedOutputSchema.parse(result));
    } catch (error) {
      return errorResult(error, "OUTCOME_UNKNOWN");
    }
  });

  server.registerTool(SYNTX_OWNER_LIST_REFERENCE_RECOVERY_TOOL_NAME, {
    title: "List reference image recovery handles",
    description: "List up to 20 recent opaque recovery handles for this exact linked attempt from bounded process-local memory. No provider request or generation is made; records expire after 15 minutes and do not survive restart.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, limit: z.number().int().min(1).max(20).default(20) }).strict(),
    outputSchema: recoveryListSchema,
    annotations: { title: "List reference image recovery handles", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input): Promise<CallToolResult> => {
    try {
      const output = recoveryListSchema.parse(await service.listRecoveries(input));
      return success(output);
    } catch (error) {
      return errorResult(error, "RECOVERY_LIST_UNAVAILABLE");
    }
  });
}

function success(value: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

function errorResult(error: unknown, fallback: string): CallToolResult {
  const code = error instanceof OwnerImageReferenceInputError
    ? error.code
    : error instanceof OwnerImageReferenceServiceError
      ? error.code
      : error instanceof OwnerContractMediaError
      ? error.code
      : error instanceof OwnerMediaReferenceStoreError
          ? error.code
          : error instanceof OwnerReferencePrincipalError
            ? error.code
            : fallback;
  const recoveryId = error instanceof OwnerContractMediaError && error.code === "OUTCOME_UNKNOWN" &&
    typeof error.recoveryId === "string" && /^recovery_[0-9a-f-]{36}$/u.test(error.recoveryId)
    ? error.recoveryId
    : undefined;
  const messages: Record<string, string> = {
    INVALID_IMAGE_INPUT: "Provide one supported image with valid base64, matching MIME, and safe dimensions.",
    SERVICE_CLOSED: "The owner reference service is closed.",
    SERVICE_BUSY: "The owner reference service is at its safe concurrency limit; retry only after this known pre-dispatch rejection.",
    REFERENCE_UNAVAILABLE: "The owner reference is unavailable for this linked attempt.",
    OUTCOME_UNKNOWN: "The generation may have been dispatched; do not retry. Reconcile only with the known recovery handle.",
    REFERENCE_UPLOAD_OUTCOME_UNKNOWN: "The upload outcome is unknown; do not upload it again automatically.",
    REFERENCE_UPLOAD_REJECTED: "The image upload was rejected before a reference handle was issued.",
    REFERENCE_EXPIRED: "The image reference expired or is no longer available.",
    REFERENCE_NOT_FOUND: "The image reference is unavailable for this exact linked attempt.",
    REFERENCE_SCOPE_MISMATCH: "The image reference is unavailable for this exact linked attempt.",
    REFERENCE_PRINCIPAL_NOT_LINKED: "The exact SYNTX account attempt is not linked.",
    REFERENCE_PRINCIPAL_INVALID: "The owner account binding is invalid for this reference operation.",
    RECOVERY_NOT_FOUND: "No matching process-local recovery record is available for this attempt.",
    PRE_DISPATCH_FAILED: "The image request was rejected before generation dispatch."
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: {
      code,
      message: messages[code] ?? "The owner image-reference operation failed safely.",
      ...(recoveryId === undefined ? {} : { recovery_id: recoveryId })
    } }) }]
  };
}
