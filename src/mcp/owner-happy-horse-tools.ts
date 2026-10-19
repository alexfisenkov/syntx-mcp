import { types } from "node:util";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isOwnerHappyHorseGenerationService, type OwnerHappyHorseGenerationService } from "../application/owner-happy-horse-generation-service.js";
import { isOwnerHappyHorseImageReferenceService, type OwnerHappyHorseImageReferenceService } from "../application/owner-happy-horse-image-reference-service.js";
import { isOwnerHappyHorseEditVideoReferenceService, type OwnerHappyHorseEditVideoReferenceService } from "../application/owner-happy-horse-edit-video-reference-service.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY = /^happy_horse_recovery_[0-9a-f-]{36}$/u;
const HANDLE = /^happy_horse_image_[0-9a-f-]{36}$/u;
const VIDEO_HANDLE = /^happy_horse_video_[0-9a-f-]{36}$/u;
const MODELS = ["happy_horse_first_frame", "happy_horse_references", "happy_horse_edit"] as const;
const IMAGE_MODELS = ["happy_horse_first_frame", "happy_horse_references"] as const;
const IMAGE_MIMES = ["image/jpeg", "image/jpg", "image/png", "image/webp"] as const;
const VIDEO_MIMES = ["video/mp4", "video/quicktime"] as const;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_BYTES = MAX_IMAGE_BYTES;
const MAX_BASE64 = Math.ceil(MAX_BYTES / 3) * 4;
const MAX_VIDEO_BASE64 = Math.ceil(MAX_VIDEO_BYTES / 3) * 4;
const uploadInput = z.object({ link_attempt_id: z.string().regex(ATTEMPT), model_id: z.enum(IMAGE_MODELS), filename: z.string().min(1).max(255),
  mime_type: z.enum(IMAGE_MIMES), content_base64: z.string().min(4).max(MAX_BASE64).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u) }).strict();
const editVideoUploadInput = z.object({ link_attempt_id: z.string().regex(ATTEMPT), filename: z.string().min(1).max(255),
  mime_type: z.enum(VIDEO_MIMES), content_base64: z.string().min(4).max(MAX_VIDEO_BASE64).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u) }).strict();
const generateInput = z.object({ link_attempt_id: z.string().regex(ATTEMPT), model_id: z.enum(MODELS), prompt: z.string().min(1).max(1_000),
  aspect_ratio: z.literal("16:9"), resolution: z.literal("720P"), video_duration: z.literal(5), seed: z.null(),
  reference_handle: z.string().regex(/^(?:happy_horse_image|happy_horse_video)_[0-9a-f-]{36}$/u) }).strict();
const resultInput = z.object({ link_attempt_id: z.string().regex(ATTEMPT), recovery_id: z.string().regex(RECOVERY) }).strict();
const listInput = z.object({ link_attempt_id: z.string().regex(ATTEMPT) }).strict();
const uploadOutput = z.object({ status: z.literal("uploaded"), reference_handle: z.string().regex(HANDLE), model_id: z.enum(IMAGE_MODELS),
  mime_type: z.enum(IMAGE_MIMES), size: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/u), width: z.number().int().positive(),
  height: z.number().int().positive(), expires_in_seconds: z.number().int().nonnegative(),
  metadata_confidence: z.literal("BOUNDED_CONTAINER_METADATA_NOT_DECODED_PIXELS"),
  size_limit_confidence: z.literal("CATALOG_METADATA_AND_LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT"),
  provider_acceptance: z.literal("UNPROVEN"), generation_permit: z.literal(false) }).strict();
const editVideoUploadOutput = z.object({ status: z.literal("uploaded"), reference_handle: z.string().regex(VIDEO_HANDLE), model_id: z.literal("happy_horse_edit"),
  media_type: z.literal("video"), mime_type: z.enum(VIDEO_MIMES), size: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  width: z.number().int().positive(), height: z.number().int().positive(), measured_duration_seconds: z.number().positive(), expires_in_seconds: z.number().int().nonnegative(),
  probe_confidence: z.literal("FFPROBE_METADATA_NOT_DECODED_PIXELS"), local_limit_confidence: z.literal("CONSERVATIVE_LOCAL_PROBE_CEILING_NOT_PROVIDER_LIMIT"),
  provider_acceptance: z.literal("UNPROVEN"), generation_permit: z.literal(false) }).strict();
const artifact = z.object({ message_object_id: z.string().min(1).max(160), object_type: z.literal("video"), object_url: z.string().url().max(4096),
  mime_type: z.enum(["video/mp4", "video/quicktime"]).nullable(), message_id: z.string().min(1).max(160), chat_uuid: z.string().min(1).max(160), model_id: z.enum(MODELS) }).strict();
const resultOutput = z.object({ status: z.enum(["completed", "outcome_unknown"]), recovery_id: z.string().regex(RECOVERY), model_id: z.enum(MODELS),
  status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"), provider_terminal_status: z.literal("UNPROVEN"), backend_acceptance: z.literal("UNPROVEN"),
  cost_cap_enforced: z.literal(false), durability: z.literal("PROCESS_LOCAL_ONLY"), observed_artifact_count: z.number().int().nonnegative(),
  artifacts: z.array(artifact).max(64), gaps: z.array(z.string().max(160)).max(32) }).strict();
const recoveryListOutput = z.object({ recoveries: z.array(resultOutput).max(128) }).strict();
const ERROR_CODES = new Set(["INVALID_REQUEST", "INVALID_PARAMETERS", "INVALID_IMAGE", "LOCAL_LIMIT_EXCEEDED", "PRINCIPAL_NOT_LINKED",
  "UPLOAD_OUTCOME_UNKNOWN", "VALIDATION_REJECTED", "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED", "SERVICE_CLOSED", "SERVICE_BUSY",
  "CAPACITY_EXCEEDED", "SUBSCRIPTION_REQUIRED", "PREFLIGHT_FAILED", "PREFLIGHT_EXPIRED", "MODEL_BINDING_MISMATCH",
  "BALANCE_INSUFFICIENT", "INTENT_ALREADY_CLAIMED", "RECOVERY_NOT_FOUND", "REQUEST_ABORTED", "OUTCOME_UNKNOWN",
  "RESULT_PENDING_OR_UNVERIFIED", "OWNER_ECHO_UNVERIFIED", "NATIVE_METHOD_UNAVAILABLE", "INVALID_VIDEO", "VIDEO_PROBE_FAILED"]);

export const OWNER_HAPPY_HORSE_TOOL_NAMES = Object.freeze(["syntx_owner_upload_happy_horse_image", "syntx_owner_upload_happy_horse_edit_video",
  "syntx_owner_generate_happy_horse_video", "syntx_owner_get_happy_horse_result", "syntx_owner_list_happy_horse_recoveries"] as const);
export interface OwnerHappyHorseToolOptions { readonly referenceService: OwnerHappyHorseImageReferenceService;
  readonly editVideoReferenceService: OwnerHappyHorseEditVideoReferenceService; readonly generationService: OwnerHappyHorseGenerationService }

export function registerSyntxOwnerHappyHorseTools(server: McpServer, input: unknown): void {
  const options = readOptions(input);
  server.registerTool(OWNER_HAPPY_HORSE_TOOL_NAMES[0], { title: "Upload an owner HappyHorse image",
    description: "Uploads one validated original image for the selected HappyHorse mode. Destination is trusted runtime configuration and the provider URL is never returned.",
    inputSchema: uploadInput, outputSchema: uploadOutput,
    annotations: { title: "Upload HappyHorse image", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (raw, { signal }) => {
    let bytes: Buffer | undefined;
    try { const data = uploadInput.parse(snapshot(raw)); bytes = decodeBase64(data.content_base64, MAX_IMAGE_BYTES);
      const out = await options.referenceService.uploadReference({ attemptId: data.link_attempt_id, model_id: data.model_id, filename: data.filename,
        mime_type: data.mime_type, bytes }, signal); return success(uploadOutput, out); }
    catch (error) { return safeError(error); } finally { bytes?.fill(0); }
  });
  server.registerTool(OWNER_HAPPY_HORSE_TOOL_NAMES[1], { title: "Upload an owner HappyHorse edit video",
    description: "Measures one local MP4/MOV with trusted ffprobe and uploads the original bytes for the edit mode; the 30-second probe ceiling is local-only.",
    inputSchema: editVideoUploadInput, outputSchema: editVideoUploadOutput,
    annotations: { title: "Upload HappyHorse edit video", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (raw, { signal }) => {
    let bytes: Buffer | undefined;
    try { const data = editVideoUploadInput.parse(snapshot(raw)); bytes = decodeBase64(data.content_base64, MAX_VIDEO_BYTES);
      const out = await options.editVideoReferenceService.uploadVideo({ attemptId: data.link_attempt_id, filename: data.filename, mime_type: data.mime_type, bytes }, signal);
      return success(editVideoUploadOutput, out); }
    catch (error) { return safeError(error); } finally { bytes?.fill(0); }
  });
  server.registerTool(OWNER_HAPPY_HORSE_TOOL_NAMES[2], { title: "Generate one owner HappyHorse video",
    description: "Submits the explicitly selected initial image or measured edit-video tuple. Unknown POST outcomes remain GET-only; quotes do not cap provider cost.",
    inputSchema: generateInput, outputSchema: resultOutput,
    annotations: { title: "Generate HappyHorse video", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (raw, { signal }) => {
    try { const data = generateInput.parse(snapshot(raw)); const out = await options.generationService.generate({ attemptId: data.link_attempt_id,
      model_id: data.model_id, prompt: data.prompt, aspect_ratio: data.aspect_ratio, resolution: data.resolution,
      video_duration: data.video_duration, seed: data.seed, reference_handle: data.reference_handle }, signal); return success(resultOutput, out); }
    catch (error) { return safeError(error); }
  });
  server.registerTool(OWNER_HAPPY_HORSE_TOOL_NAMES[3], { title: "Read a HappyHorse result",
    description: "Reconciles one process-local generation using owned GET reads only; it never repeats upload or generation.", inputSchema: resultInput,
    outputSchema: resultOutput, annotations: { title: "Read HappyHorse result", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (raw, { signal }) => {
    try { const data = resultInput.parse(snapshot(raw)); const out = await options.generationService.reconcile({ attemptId: data.link_attempt_id,
      recovery_id: data.recovery_id }, signal); return success(resultOutput, out); } catch (error) { return safeError(error); }
  });
  server.registerTool(OWNER_HAPPY_HORSE_TOOL_NAMES[4], { title: "List HappyHorse recoveries",
    description: "Lists bounded process-local status observations for this owner attempt; no upload or generation is performed.", inputSchema: listInput,
    outputSchema: recoveryListOutput, annotations: { title: "List HappyHorse recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async raw => {
    try { const data = listInput.parse(snapshot(raw)); const rows = await options.generationService.listRecoveries({ attemptId: data.link_attempt_id });
      return success(recoveryListOutput, { recoveries: rows }); } catch (error) { return safeError(error); }
  });
}

function readOptions(value: unknown): OwnerHappyHorseToolOptions {
  const f = snapshot(value) as Record<string, unknown> | undefined;
  if (!f || Object.keys(f).length !== 3 || !Object.hasOwn(f, "referenceService") || !Object.hasOwn(f, "editVideoReferenceService") || !Object.hasOwn(f, "generationService") ||
      !isOwnerHappyHorseImageReferenceService(f.referenceService) ||
      !isOwnerHappyHorseEditVideoReferenceService(f.editVideoReferenceService) ||
      !isOwnerHappyHorseGenerationService(f.generationService)) throw new Error("INVALID_OWNER_HAPPY_HORSE_TOOL_OPTIONS");
  return Object.freeze({ referenceService: f.referenceService, editVideoReferenceService: f.editVideoReferenceService, generationService: f.generationService });
}
function snapshot(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return undefined;
  try { const p = Object.getPrototypeOf(value); if (p !== Object.prototype && p !== null) return undefined;
    const d = Object.getOwnPropertyDescriptors(value), out = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(d)) { if (typeof key !== "string" || !Object.hasOwn(d[key]!, "value") || d[key]!.enumerable !== true) return undefined; out[key] = d[key]!.value; }
    return out; } catch { return undefined; }
}
function decodeBase64(value: string, maximum: number): Buffer { const bytes = Buffer.from(value, "base64");
  if (bytes.length < 1 || bytes.length > maximum || bytes.toString("base64") !== value) { bytes.fill(0); throw new Error("INVALID_REQUEST"); } return bytes; }
function success<T extends z.ZodType>(schema: T, value: unknown) { const parsed = schema.safeParse(value);
  return parsed.success ? { content: [{ type: "text" as const, text: JSON.stringify(parsed.data) }], structuredContent: parsed.data as Record<string, unknown> } : safeError("OUTPUT_INVALID"); }
function safeError(value: unknown) { let code = "INVALID_REQUEST";
  if (value && typeof value === "object" && !types.isProxy(value)) try { const d = Object.getOwnPropertyDescriptor(value, "code");
    if (d && Object.hasOwn(d, "value") && typeof d.value === "string" && ERROR_CODES.has(d.value)) code = d.value; } catch { /* redacted fallback */ }
  return { isError: true, content: [{ type: "text" as const, text: code }] }; }
