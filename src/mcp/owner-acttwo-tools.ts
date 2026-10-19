import { types } from "node:util";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isOwnerActTwoGenerationService, type OwnerActTwoGenerationService } from "../application/owner-acttwo-generation-service.js";
import { isOwnerActTwoImageReferenceService, type OwnerActTwoImageReferenceService } from "../application/owner-acttwo-image-reference-service.js";
import { isOwnerActTwoPerformanceVideoReferenceService, type OwnerActTwoPerformanceVideoReferenceService } from "../application/owner-acttwo-video-reference-service.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY = /^acttwo_recovery_[0-9a-f-]{36}$/u;
const IMAGE_HANDLE = /^acttwo_character_image_[0-9a-f-]{36}$/u;
const VIDEO_HANDLE = /^acttwo_performance_video_[0-9a-f-]{36}$/u;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BASE64 = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const MAX_VIDEO_BASE64 = Math.ceil(MAX_VIDEO_BYTES / 3) * 4;
const imageUploadInput = z.object({ link_attempt_id: z.string().regex(ATTEMPT), filename: z.string().min(1).max(255),
  mime_type: z.enum(["image/jpeg", "image/png"]), content_base64: z.string().min(4).max(MAX_IMAGE_BASE64)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u) }).strict();
const videoUploadInput = z.object({ link_attempt_id: z.string().regex(ATTEMPT), filename: z.string().min(1).max(255),
  mime_type: z.literal("video/mp4"), content_base64: z.string().min(4).max(MAX_VIDEO_BASE64)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u) }).strict();
const generateInput = z.object({ link_attempt_id: z.string().regex(ATTEMPT), model_id: z.literal("acttwo"), aspect_ratio: z.literal("1:1"),
  seed: z.null(), expression: z.literal(3), character_image_handle: z.string().regex(IMAGE_HANDLE),
  performance_video_handle: z.string().regex(VIDEO_HANDLE) }).strict();
const resultInput = z.object({ link_attempt_id: z.string().regex(ATTEMPT), recovery_id: z.string().regex(RECOVERY) }).strict();
const listInput = z.object({ link_attempt_id: z.string().regex(ATTEMPT) }).strict();
const uploadImageOutput = z.object({ status: z.literal("uploaded"), reference_handle: z.string().regex(IMAGE_HANDLE), model_id: z.literal("acttwo"),
  media_type: z.literal("image"), mime_type: z.enum(["image/jpeg", "image/png"]), size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u), width: z.number().int().positive(), height: z.number().int().positive(),
  expires_in_seconds: z.number().int().nonnegative(), metadata_confidence: z.literal("STRUCTURAL_IMAGE_METADATA_NOT_DECODED_PIXELS"),
  upload_authority: z.literal(false), generation_permit: z.literal(false) }).strict();
const uploadVideoOutput = z.object({ status: z.literal("uploaded"), reference_handle: z.string().regex(VIDEO_HANDLE), model_id: z.literal("acttwo"),
  media_type: z.literal("video"), mime_type: z.literal("video/mp4"), size: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  width: z.number().int().positive(), height: z.number().int().positive(), measured_duration_seconds: z.literal(5), expires_in_seconds: z.number().int().nonnegative(),
  probe_confidence: z.literal("FFPROBE_METADATA_NOT_DECODED_PIXELS"), upload_authority: z.literal(false), generation_permit: z.literal(false) }).strict();
const artifact = z.object({ message_object_id: z.string().min(1).max(160), object_type: z.literal("video"), object_url: z.string().url().max(4096),
  mime_type: z.enum(["video/mp4", "video/quicktime"]).nullable(), message_id: z.string().min(1).max(160), chat_uuid: z.string().min(1).max(160),
  model_id: z.literal("acttwo") }).strict();
const resultOutput = z.object({ status: z.enum(["completed", "outcome_unknown"]), recovery_id: z.string().regex(RECOVERY), model_id: z.literal("acttwo"),
  status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"), provider_terminal_status: z.literal("UNPROVEN"), backend_acceptance: z.literal("UNPROVEN"),
  cost_cap_enforced: z.literal(false), durability: z.literal("PROCESS_LOCAL_ONLY"), observed_artifact_count: z.number().int().nonnegative(),
  artifacts: z.array(artifact).max(64), gaps: z.array(z.string().max(160)).max(32) }).strict();
const recoveryListOutput = z.object({ recoveries: z.array(resultOutput).max(128) }).strict();
const ERROR_CODES = new Set(["INVALID_REQUEST", "INVALID_PARAMETERS", "INVALID_IMAGE", "LOCAL_LIMIT_EXCEEDED", "INVALID_VIDEO", "DURATION_MISMATCH",
  "VIDEO_PROBE_FAILED", "REQUEST_ABORTED", "PRINCIPAL_NOT_LINKED", "UPLOAD_OUTCOME_UNKNOWN", "VALIDATION_REJECTED", "REFERENCE_UNAVAILABLE",
  "REFERENCE_EXPIRED", "REFERENCE_ALREADY_ATTACHED", "SERVICE_CLOSED", "SERVICE_BUSY", "CAPACITY_EXCEEDED", "SUBSCRIPTION_REQUIRED",
  "PREFLIGHT_FAILED", "PREFLIGHT_EXPIRED", "MODEL_BINDING_MISMATCH", "BALANCE_INSUFFICIENT", "INTENT_ALREADY_CLAIMED",
  "RECOVERY_NOT_FOUND", "OUTCOME_UNKNOWN", "RESULT_PENDING_OR_UNVERIFIED", "OWNER_ECHO_UNVERIFIED", "NATIVE_METHOD_UNAVAILABLE"]);

export const OWNER_ACTTWO_TOOL_NAMES = Object.freeze(["syntx_owner_upload_acttwo_character_image", "syntx_owner_upload_acttwo_performance_video",
  "syntx_owner_generate_acttwo_video", "syntx_owner_get_acttwo_result", "syntx_owner_list_acttwo_recoveries"] as const);
export interface OwnerActTwoToolOptions {
  readonly imageReferenceService: OwnerActTwoImageReferenceService;
  readonly videoReferenceService: OwnerActTwoPerformanceVideoReferenceService;
  readonly generationService: OwnerActTwoGenerationService;
}

export function registerSyntxOwnerActTwoTools(server: McpServer, input: unknown): void {
  const options = readOptions(input);
  server.registerTool(OWNER_ACTTWO_TOOL_NAMES[0], { title: "Upload ActTwo character image",
    description: "Uploads one validated JPEG/PNG character image. Destination is trusted runtime configuration; the provider URL is not returned.",
    inputSchema: imageUploadInput, outputSchema: uploadImageOutput,
    annotations: { title: "Upload ActTwo character image", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (raw, { signal }) => {
    let bytes: Buffer | undefined;
    try {
      const data = imageUploadInput.parse(snapshot(raw)); bytes = decodeBase64(data.content_base64, MAX_IMAGE_BYTES);
      const receipt = await options.imageReferenceService.uploadCharacterImage({ attemptId: data.link_attempt_id,
        filename: data.filename, mime_type: data.mime_type, bytes }, signal);
      return success(uploadImageOutput, receipt);
    } catch (error) { return safeError(error); } finally { bytes?.fill(0); }
  });
  server.registerTool(OWNER_ACTTWO_TOOL_NAMES[1], { title: "Upload ActTwo performance video",
    description: "Measures and uploads one local five-second MP4 as the ActTwo performance-video role using trusted ffprobe configuration.",
    inputSchema: videoUploadInput, outputSchema: uploadVideoOutput,
    annotations: { title: "Upload ActTwo performance video", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (raw, { signal }) => {
    let bytes: Buffer | undefined;
    try {
      const data = videoUploadInput.parse(snapshot(raw)); bytes = decodeBase64(data.content_base64, MAX_VIDEO_BYTES);
      const receipt = await options.videoReferenceService.uploadPerformanceVideo({ attemptId: data.link_attempt_id,
        filename: data.filename, mime_type: data.mime_type, bytes }, signal);
      return success(uploadVideoOutput, receipt);
    } catch (error) { return safeError(error); } finally { bytes?.fill(0); }
  });
  server.registerTool(OWNER_ACTTWO_TOOL_NAMES[2], { title: "Generate one ActTwo video",
    description: "Submits the initial one-character-image plus one-measured-performance-video tuple. Prompt is fixed empty, result recovery is GET-only, and affordability quotes are not a provider spending cap.",
    inputSchema: generateInput, outputSchema: resultOutput,
    annotations: { title: "Generate one ActTwo video", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (raw, { signal }) => {
    try {
      const data = generateInput.parse(snapshot(raw));
      return success(resultOutput, await options.generationService.generate({ attemptId: data.link_attempt_id, model_id: data.model_id,
        aspect_ratio: data.aspect_ratio, seed: data.seed, expression: data.expression, character_image_handle: data.character_image_handle,
        performance_video_handle: data.performance_video_handle }, signal));
    } catch (error) { return safeError(error); }
  });
  server.registerTool(OWNER_ACTTWO_TOOL_NAMES[3], { title: "Read ActTwo result",
    description: "Reconciles one process-local ActTwo operation through owned GET reads only; upload and generation are never repeated.",
    inputSchema: resultInput, outputSchema: resultOutput,
    annotations: { title: "Read ActTwo result", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (raw, { signal }) => {
    try { const data = resultInput.parse(snapshot(raw)); return success(resultOutput,
      await options.generationService.reconcile({ attemptId: data.link_attempt_id, recovery_id: data.recovery_id }, signal)); }
    catch (error) { return safeError(error); }
  });
  server.registerTool(OWNER_ACTTWO_TOOL_NAMES[4], { title: "List ActTwo recoveries",
    description: "Lists bounded process-local ActTwo status observations for this owner attempt; it performs no upload or generation.",
    inputSchema: listInput, outputSchema: recoveryListOutput,
    annotations: { title: "List ActTwo recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async raw => {
    try { const data = listInput.parse(snapshot(raw)); return success(recoveryListOutput,
      { recoveries: await options.generationService.listRecoveries({ attemptId: data.link_attempt_id }) }); }
    catch (error) { return safeError(error); }
  });
}

function readOptions(value: unknown): OwnerActTwoToolOptions {
  const fields = snapshot(value);
  if (!fields || Object.keys(fields).length !== 3 || !Object.hasOwn(fields, "imageReferenceService") ||
      !Object.hasOwn(fields, "videoReferenceService") || !Object.hasOwn(fields, "generationService") ||
      !isOwnerActTwoImageReferenceService(fields.imageReferenceService) ||
      !isOwnerActTwoPerformanceVideoReferenceService(fields.videoReferenceService) ||
      !isOwnerActTwoGenerationService(fields.generationService)) throw new Error("INVALID_OWNER_ACTTWO_TOOL_OPTIONS");
  return Object.freeze({ imageReferenceService: fields.imageReferenceService, videoReferenceService: fields.videoReferenceService,
    generationService: fields.generationService });
}
function snapshot(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value); if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value), result = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string" || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true) return undefined;
      result[key] = descriptors[key]!.value;
    }
    return result;
  } catch { return undefined; }
}
function decodeBase64(value: string, maximum: number): Buffer {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 1 || bytes.length > maximum || bytes.toString("base64") !== value) { bytes.fill(0); throw new Error("INVALID_REQUEST"); }
  return bytes;
}
function success<T extends z.ZodType>(schema: T, value: unknown) {
  const parsed = schema.safeParse(value);
  return parsed.success ? { content: [{ type: "text" as const, text: JSON.stringify(parsed.data) }], structuredContent: parsed.data as Record<string, unknown> }
    : safeError("OUTPUT_INVALID");
}
function safeError(value: unknown) {
  let code = "INVALID_REQUEST";
  if (value && typeof value === "object" && !types.isProxy(value)) try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "code");
    if (descriptor && Object.hasOwn(descriptor, "value") && typeof descriptor.value === "string" && ERROR_CODES.has(descriptor.value)) code = descriptor.value;
  } catch { /* redacted fallback */ }
  return { isError: true, content: [{ type: "text" as const, text: code }] };
}
