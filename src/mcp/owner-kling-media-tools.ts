import { isCanonicalBase64 as isCanonicalBase64Bounded } from "../application/canonical-base64.js";
import { types } from "node:util";
import { z } from "zod/v4";
import { advertisedUnionInputSchema } from "./advertised-input-schema.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isOwnerKlingMediaGenerationService, type OwnerKlingMediaGenerationService } from "../application/owner-kling-media-generation-service.js";
import { isOwnerKlingMediaReferenceService, type OwnerKlingMediaReferenceService } from "../application/owner-kling-media-reference-service.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^kling_media_reference_[0-9a-f-]{36}$/u;
const RECOVERY = /^kling_media_recovery_[0-9a-f-]{36}$/u;
const IMAGE_MIMES = ["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"] as const;
const VIDEO_MIMES = ["video/mp4", "video/quicktime"] as const;
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const uploadInput = z.object({ link_attempt_id: z.string().regex(ATTEMPT), model_id: z.enum(["kling_elements", "kling_o1_image2video", "kling_o1_video2video"]),
  filename: z.string().min(1).max(255), mime_type: z.enum([...IMAGE_MIMES, ...VIDEO_MIMES]),
  content_base64: z.string().min(4).max(Math.ceil(MAX_VIDEO_BYTES / 3) * 4).refine((value) => isCanonicalBase64Bounded(value, Math.ceil(MAX_VIDEO_BYTES / 3) * 4)) }).strict();
const generateInput = z.union([
  z.object({ link_attempt_id: z.string().regex(ATTEMPT), model_id: z.literal("kling_elements"), prompt: z.string().min(1).max(1_000), version: z.literal("1.6"),
    mode: z.literal("hd"), aspect_ratio: z.literal("16:9"), video_duration: z.literal(5), native_audio: z.literal(false), reference_handle: z.string().regex(HANDLE) }).strict(),
  z.object({ link_attempt_id: z.string().regex(ATTEMPT), model_id: z.literal("kling_o1_image2video"), prompt: z.string().min(1).max(1_000), version: z.literal("1.6"),
    mode: z.literal("hd"), aspect_ratio: z.literal("16:9"), video_duration: z.literal(5), native_audio: z.literal(false), reference_handle: z.string().regex(HANDLE) }).strict(),
  z.object({ link_attempt_id: z.string().regex(ATTEMPT), model_id: z.literal("kling_o1_video2video"), prompt: z.string().min(1).max(1_000), version: z.literal("1.6"),
    mode: z.literal("hd"), video_duration: z.literal(5), native_audio: z.literal(false), reference_handle: z.string().regex(HANDLE) }).strict(),
  z.object({ link_attempt_id: z.string().regex(ATTEMPT), model_id: z.literal("kling_elements"), prompt: z.string().min(1).max(1000), version: z.literal("3.0"),
    mode: z.enum(["standart", "hd", "4K"]), aspect_ratio: z.enum(["16:9", "1:1", "9:16"]), video_duration: z.number().finite().min(3).max(15),
    native_audio: z.boolean(), multi_shots: z.boolean(), reference_handles: currentHandles(7) }).strict(),
  z.object({ link_attempt_id: z.string().regex(ATTEMPT), model_id: z.literal("kling_o1_image2video"), prompt: z.string().min(1).max(1000), mode: z.literal("hd"),
    aspect_ratio: z.enum(["16:9", "1:1", "9:16"]), video_duration: z.number().finite().min(3).max(10), reference_handles: currentHandles(4) }).strict(),
  z.object({ link_attempt_id: z.string().regex(ATTEMPT), model_id: z.literal("kling_o1_video2video"), prompt: z.string().min(1).max(1000), mode: z.literal("hd"),
    reference_handles: currentHandles(5) }).strict()
]);
function currentHandles(maximum: number) { return z.array(z.string().regex(HANDLE)).min(1).max(maximum)
  .refine(value => new Set(value).size === value.length).meta({ uniqueItems: true }); }
const resultInput = z.object({ link_attempt_id: z.string().regex(ATTEMPT), recovery_id: z.string().regex(RECOVERY) }).strict();
const listInput = z.object({ link_attempt_id: z.string().regex(ATTEMPT) }).strict();
const artifact = z.object({ message_object_id: z.string().min(1).max(160), object_type: z.literal("video"), object_url: z.string().url().max(4096),
  mime_type: z.enum(["video/mp4", "video/quicktime"]).nullable(), message_id: z.string().min(1).max(160), chat_uuid: z.string().min(1).max(160),
  model_id: z.enum(["kling_elements", "kling_o1_image2video", "kling_o1_video2video"]) }).strict();
const resultOutput = z.object({ status: z.enum(["completed", "outcome_unknown"]), recovery_id: z.string().regex(RECOVERY),
  model_id: z.enum(["kling_elements", "kling_o1_image2video", "kling_o1_video2video"]), status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"),
  provider_terminal_status: z.literal("UNPROVEN"), backend_acceptance: z.literal("UNPROVEN"), cost_cap_enforced: z.literal(false), durability: z.literal("PROCESS_LOCAL_ONLY"),
  observed_artifact_count: z.number().int().nonnegative(), artifacts: z.array(artifact).max(64), gaps: z.array(z.string().max(160)).max(32) }).strict();
const uploadOutput = z.object({ status: z.literal("uploaded"), reference_handle: z.string().regex(HANDLE),
  model_id: z.enum(["kling_elements", "kling_o1_image2video", "kling_o1_video2video"]), media_type: z.enum(["image", "video"]),
  mime_type: z.string().max(64), size: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/u), width: z.number().int().positive(),
  height: z.number().int().positive(), measured_duration_seconds: z.number().positive().nullable(), expires_in_seconds: z.number().int().nonnegative(),
  provider_acceptance: z.literal("UNPROVEN"), generation_permit: z.literal(false) }).strict();
const listOutput = z.object({ recoveries: z.array(resultOutput).max(128) }).strict();
const ERROR_CODES = new Set(["INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH", "PREFLIGHT_FAILED",
  "BALANCE_INSUFFICIENT", "PREFLIGHT_EXPIRED", "INTENT_ALREADY_CLAIMED", "CAPACITY_EXCEEDED", "UPLOAD_OUTCOME_UNKNOWN", "VALIDATION_REJECTED",
  "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED", "RECOVERY_NOT_FOUND", "REQUEST_ABORTED", "GENERATION_OUTCOME_UNKNOWN", "NATIVE_METHOD_UNAVAILABLE"]);
export const OWNER_KLING_MEDIA_TOOL_NAMES = Object.freeze(["syntx_owner_upload_kling_media_reference", "syntx_owner_generate_kling_media_video",
  "syntx_owner_get_kling_media_result", "syntx_owner_list_kling_media_recoveries"] as const);
export interface OwnerKlingMediaToolOptions { readonly referenceService: OwnerKlingMediaReferenceService; readonly generationService: OwnerKlingMediaGenerationService }

export function registerSyntxOwnerKlingMediaTools(server: McpServer, input: unknown): void {
  const options = readOptions(input);
  server.registerTool(OWNER_KLING_MEDIA_TOOL_NAMES[0], { title: "Upload an owner Kling media reference",
    description: "Validates one image or source video for the exact Kling media model and returns an owner-bound handle; the upload URL is never returned.",
    inputSchema: uploadInput, outputSchema: uploadOutput, annotations: { title: "Upload Kling media reference", readOnlyHint: false,
      destructiveHint: false, idempotentHint: false, openWorldHint: true } }, async (raw, { signal }) => {
    let bytes: Buffer | undefined;
    try { const data = uploadInput.parse(snapshot(raw)); const image = (IMAGE_MIMES as readonly string[]).includes(data.mime_type);
      if (image && (!(IMAGE_MIMES as readonly string[]).includes(data.mime_type) || data.content_base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4)) throw new Error("INVALID_REQUEST");
      if (!image && (data.model_id !== "kling_o1_video2video" || !(VIDEO_MIMES as readonly string[]).includes(data.mime_type))) throw new Error("INVALID_REQUEST");
      bytes = decode(data.content_base64, image ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES);
      const out = await options.referenceService.upload({ attemptId: data.link_attempt_id, model_id: data.model_id, filename: data.filename,
        mime_type: data.mime_type, bytes }, signal); return success(uploadOutput, out);
    } catch (error) { return safeError(error); } finally { bytes?.fill(0); }
  });
  server.registerTool(OWNER_KLING_MEDIA_TOOL_NAMES[1], { title: "Generate one owner Kling media video",
    description: "Current source: Elements3.0 supports1..7 owned images, explicit3..15s/standart|hd|4K/ratios/audio/multi_shots. O1I2V accepts1..4 images and3..10s/ratios; O1V2V accepts exactly1 video plus0..4 images, deriving rounded duration from trusted video metadata. O1 version is omitted and modehd fixed. Use reference_handles for current branches; explicit1.6/reference_handle retains the historical single-source tuple. Unknown POST outcomes remain GET-only; quotes are not spending caps.",
    inputSchema: advertisedUnionInputSchema(generateInput), outputSchema: resultOutput, annotations: { title: "Generate Kling media video", readOnlyHint: false,
      destructiveHint: false, idempotentHint: false, openWorldHint: true } }, async (raw, { signal }) => {
    try { const { link_attempt_id, ...fields } = raw; const out = await options.generationService.generate({ attemptId: link_attempt_id, ...fields }, signal); return success(resultOutput, out);
    } catch (error) { return safeError(error); }
  });
  server.registerTool(OWNER_KLING_MEDIA_TOOL_NAMES[2], { title: "Read an owner Kling media result",
    description: "Reconciles one process-local recovery through owned GET reads only. It never repeats upload or generation.", inputSchema: resultInput,
    outputSchema: resultOutput, annotations: { title: "Read Kling media result", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
  async (raw, { signal }) => { try { const d = resultInput.parse(snapshot(raw)); const out = await options.generationService.reconcile({ attemptId: d.link_attempt_id,
    recovery_id: d.recovery_id }, signal); return success(resultOutput, out); } catch (error) { return safeError(error); } });
  server.registerTool(OWNER_KLING_MEDIA_TOOL_NAMES[3], { title: "List owner Kling media recoveries",
    description: "Lists process-local Kling media outcomes for this owner attempt. No upload or generation is performed.", inputSchema: listInput, outputSchema: listOutput,
    annotations: { title: "List Kling media recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  async raw => { try { const d = listInput.parse(snapshot(raw)); const rows = await options.generationService.listRecoveries({ attemptId: d.link_attempt_id });
    return success(listOutput, { recoveries: rows }); } catch (error) { return safeError(error); } });
}

function readOptions(value: unknown): OwnerKlingMediaToolOptions { const f = snapshot(value) as Record<string, unknown> | undefined;
  if (!f || Object.keys(f).length !== 2 || !isOwnerKlingMediaReferenceService(f.referenceService) || !isOwnerKlingMediaGenerationService(f.generationService))
    throw new Error("INVALID_OWNER_KLING_MEDIA_TOOL_OPTIONS"); return Object.freeze({ referenceService: f.referenceService, generationService: f.generationService }); }
function snapshot(value: unknown): unknown { if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return undefined;
  try { const p = Object.getPrototypeOf(value); if (p !== Object.prototype && p !== null) return undefined; const d = Object.getOwnPropertyDescriptors(value), out = Object.create(null) as Record<string, unknown>;
    for (const k of Reflect.ownKeys(d)) { if (typeof k !== "string" || !Object.hasOwn(d[k]!, "value") || d[k]!.enumerable !== true) return undefined; out[k] = d[k]!.value; } return out;
  } catch { return undefined; } }
function decode(value: string, maximum: number): Buffer { const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > maximum || bytes.toString("base64") !== value) { bytes.fill(0); throw new Error("INVALID_REQUEST"); } return bytes; }
function success<T extends z.ZodType>(schema: T, value: unknown) { const parsed = schema.safeParse(value); return parsed.success
  ? { content: [{ type: "text" as const, text: JSON.stringify(parsed.data) }], structuredContent: parsed.data as Record<string, unknown> } : safeError("OUTPUT_INVALID"); }
function safeError(value: unknown) { let code = "INVALID_REQUEST"; if (value && typeof value === "object" && !types.isProxy(value)) try { const d = Object.getOwnPropertyDescriptor(value, "code");
  if (d && Object.hasOwn(d, "value") && typeof d.value === "string" && ERROR_CODES.has(d.value)) code = d.value; } catch { /* redacted fallback */ }
  return { isError: true, content: [{ type: "text" as const, text: code }] }; }
