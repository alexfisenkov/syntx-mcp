import { types } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { OWNER_KLING_KEYFRAMES_IMAGE_POLICY } from "../application/owner-kling-keyframes-image-policy.js";
import {
  OwnerKlingKeyframesReferenceServiceError,
  type OwnerKlingKeyframesReferenceService
} from "../application/owner-kling-keyframes-reference-service.js";

export const SYNTX_OWNER_GET_KLING_KEYFRAMES_INPUT_POLICY_TOOL_NAME = "syntx_owner_get_kling_keyframes_input_policy" as const;
export const SYNTX_OWNER_UPLOAD_KLING_KEYFRAMES_IMAGE_TOOL_NAME = "syntx_owner_upload_kling_keyframes_image" as const;
export const SYNTX_OWNER_CHECK_KLING_KEYFRAMES_IMAGES_TOOL_NAME = "syntx_owner_check_kling_keyframes_images" as const;
export const OWNER_KLING_KEYFRAMES_INPUT_TOOL_NAMES = Object.freeze([
  SYNTX_OWNER_GET_KLING_KEYFRAMES_INPUT_POLICY_TOOL_NAME,
  SYNTX_OWNER_UPLOAD_KLING_KEYFRAMES_IMAGE_TOOL_NAME,
  SYNTX_OWNER_CHECK_KLING_KEYFRAMES_IMAGES_TOOL_NAME
] as const);

const MODEL_ID = "kling_keyframes" as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const IMAGE_HANDLE = /^kling_keyframes_image_[0-9a-f-]{36}$/u;
const MAX_IMAGE_BYTES = OWNER_KLING_KEYFRAMES_IMAGE_POLICY.max_file_size_bytes;
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const attemptSchema = z.string().regex(ATTEMPT).describe("Exact currently linked owner attempt.");
const imageHandleSchema = z.string().regex(IMAGE_HANDLE);
const imageMetadataSchema = z.object({
  image_handle: imageHandleSchema,
  filename: z.string().min(1).max(255),
  mime_type: z.enum(["image/jpeg", "image/png", "image/avif"]),
  size: z.number().int().min(1).max(MAX_IMAGE_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  width: z.number().int().min(300), height: z.number().int().min(300)
}).strict();
const policyOutputSchema = z.object({
  status: z.literal("LOCAL_INPUT_POLICY_ONLY"), model_id: z.literal(MODEL_ID),
  accepted_mime_types: z.array(z.enum(OWNER_KLING_KEYFRAMES_IMAGE_POLICY.source_mime_types)).length(4),
  max_file_size_bytes: z.literal(MAX_IMAGE_BYTES), min_side: z.literal(300),
  metadata_confidence: z.literal("STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED"),
  generation_permit: z.literal(false), backend_acceptance: z.literal("UNPROVEN")
}).strict();
const uploadInputSchema = z.object({
  link_attempt_id: attemptSchema,
  content_base64: z.string().min(4).max(MAX_BASE64_CHARS).regex(BASE64),
  filename: z.string().min(1).max(255),
  mime_type: z.enum(OWNER_KLING_KEYFRAMES_IMAGE_POLICY.source_mime_types)
}).strict();
const uploadOutputSchema = z.object({
  status: z.literal("uploaded"), model_id: z.literal(MODEL_ID), ...imageMetadataSchema.shape,
  remaining_ttl_seconds: z.number().int().min(1).max(900), backend_acceptance: z.literal("UNPROVEN")
}).strict();
const checkInputSchema = z.object({
  link_attempt_id: attemptSchema,
  image_handles: z.tuple([imageHandleSchema, imageHandleSchema])
}).strict();
const checkOutputSchema = z.object({
  status: z.literal("checked"), model_id: z.literal(MODEL_ID),
  images: z.tuple([imageMetadataSchema, imageMetadataSchema]),
  remaining_ttl_seconds: z.number().int().min(1).max(900),
  generation_permit: z.literal(false), backend_acceptance: z.literal("UNPROVEN")
}).strict();
const uploadToolOutputSchema = z.object({
  status: z.enum(["uploaded", "unavailable"]), model_id: z.literal(MODEL_ID).optional(), ...imageMetadataSchema.partial().shape,
  remaining_ttl_seconds: z.number().int().min(1).max(900).optional(), backend_acceptance: z.literal("UNPROVEN").optional(),
  code: z.string().min(1).max(64).optional(), message: z.string().min(1).max(160).optional()
}).strict();
const checkToolOutputSchema = z.object({
  status: z.enum(["checked", "unavailable"]), model_id: z.literal(MODEL_ID).optional(),
  images: z.tuple([imageMetadataSchema, imageMetadataSchema]).optional(),
  remaining_ttl_seconds: z.number().int().min(1).max(900).optional(),
  generation_permit: z.literal(false).optional(), backend_acceptance: z.literal("UNPROVEN").optional(),
  code: z.string().min(1).max(64).optional(), message: z.string().min(1).max(160).optional()
}).strict();

export interface RegisterSyntxOwnerKlingKeyframesToolsOptions {
  readonly referenceService: Pick<OwnerKlingKeyframesReferenceService, "upload" | "resolvePair">;
  readonly now?: () => number;
}

/** Adds only static input policy, owner-bound upload, and GET-free local pair validation; no generation tool is registered. */
export function registerSyntxOwnerKlingKeyframesTools(server: McpServer, options: RegisterSyntxOwnerKlingKeyframesToolsOptions): void {
  const now = options.now ?? Date.now;
  server.registerTool(SYNTX_OWNER_GET_KLING_KEYFRAMES_INPUT_POLICY_TOOL_NAME, {
    title: "Get Kling Keyframes image input policy",
    description: "Returns local input limits only: JPEG/JPG, PNG, or AVIF; at most 50 MiB and a 300-pixel minimum side. This does not enable Kling Keyframes generation, establish frame roles, or prove provider acceptance. It is read-only and makes no HTTP request.",
    inputSchema: z.object({}).strict(), outputSchema: policyOutputSchema,
    annotations: { title: "Get Kling Keyframes image input policy", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (): Promise<CallToolResult> => structuredResult(policyOutputSchema.parse({
    status: "LOCAL_INPUT_POLICY_ONLY", model_id: MODEL_ID,
    accepted_mime_types: [...OWNER_KLING_KEYFRAMES_IMAGE_POLICY.source_mime_types],
    max_file_size_bytes: MAX_IMAGE_BYTES, min_side: 300,
    metadata_confidence: OWNER_KLING_KEYFRAMES_IMAGE_POLICY.metadata_confidence,
    generation_permit: false, backend_acceptance: "UNPROVEN"
  })));

  server.registerTool(SYNTX_OWNER_UPLOAD_KLING_KEYFRAMES_IMAGE_TOOL_NAME, {
    title: "Upload one Kling Keyframes image",
    description: "Uploads one caller-supplied JPEG/JPG, PNG, or AVIF image to the exact linked owner attempt. Returns an opaque image handle and safe local metadata without its private URL. Local validation checks at most 50 MiB and a 300-pixel minimum side using container metadata, not decoded pixels. Provider acceptance is unproven. An upload with unknown outcome has a fixed redacted error.",
    inputSchema: uploadInputSchema, outputSchema: uploadToolOutputSchema,
    annotations: { title: "Upload one Kling Keyframes image", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const uploaded = await options.referenceService.upload({ attemptId: input.link_attempt_id,
        content_base64: input.content_base64, filename: input.filename, mime_type: input.mime_type }, signal);
      return structuredResult(uploadOutputSchema.parse({
        status: uploaded.status, model_id: uploaded.model_id, image_handle: uploaded.image_handle,
        filename: uploaded.filename, mime_type: uploaded.mime_type, size: uploaded.size, sha256: uploaded.sha256,
        width: uploaded.width, height: uploaded.height, remaining_ttl_seconds: uploaded.expires_in_seconds,
        backend_acceptance: "UNPROVEN"
      }));
    } catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_CHECK_KLING_KEYFRAMES_IMAGES_TOOL_NAME, {
    title: "Check two Kling Keyframes images (local validation only)",
    description: "Checks exactly two uploaded image handles in caller order against the exact currently linked owner attempt. This resolves local ownership and expiry only; it does not fetch provider URLs, establish first/last frame roles, enable generation, or prove provider acceptance.",
    inputSchema: checkInputSchema, outputSchema: checkToolOutputSchema,
    annotations: { title: "Check two Kling Keyframes images (local validation only)", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const checked = await options.referenceService.resolvePair({ attempt_id: input.link_attempt_id,
        image_handles: input.image_handles }, signal);
      const remaining = Math.floor(Math.max(0, checked.expires_at - now()) / 1000);
      return structuredResult(checkOutputSchema.parse({
        status: "checked", model_id: checked.model_id,
        images: checked.images.map((image) => ({ image_handle: image.image_handle, filename: image.filename,
          mime_type: image.mime_type, size: image.size, sha256: image.sha256, width: image.width, height: image.height })),
        remaining_ttl_seconds: remaining, generation_permit: false, backend_acceptance: "UNPROVEN"
      }));
    } catch (error) { return safeError(error); }
  });
}

function structuredResult(output: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
}

function safeError(error: unknown): CallToolResult {
  if (types.isProxy(error) || !(error instanceof OwnerKlingKeyframesReferenceServiceError)) {
    return unavailable("KEYFRAMES_INPUT_UNAVAILABLE", "The Kling Keyframes input operation could not be completed safely.");
  }
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  const code = descriptor && "value" in descriptor && typeof descriptor.value === "string" && ERROR_CODES.has(descriptor.value)
    ? descriptor.value : undefined;
  if (code === undefined) return unavailable("KEYFRAMES_INPUT_UNAVAILABLE", "The Kling Keyframes input operation could not be completed safely.");
  const message = code === "UPLOAD_OUTCOME_UNKNOWN"
    ? "The image upload result could not be confirmed."
    : "The Kling Keyframes input operation could not be completed safely.";
  return unavailable(code, message);
}

const ERROR_CODES = new Set([
  "INVALID_REQUEST", "PROFILE_BINDING_MISMATCH", "PRINCIPAL_NOT_LINKED", "REQUEST_ABORTED", "SERVICE_BUSY",
  "CAPACITY_EXCEEDED", "SERVICE_CLOSED", "UPLOAD_REJECTED", "UPLOAD_OUTCOME_UNKNOWN", "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED"
]);

function unavailable(code: string, message: string): CallToolResult {
  const output = { status: "unavailable", code, message };
  return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output, isError: true };
}
