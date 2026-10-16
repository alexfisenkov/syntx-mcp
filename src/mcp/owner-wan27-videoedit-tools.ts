import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { types } from "node:util";
import { z } from "zod/v4";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { getOwnerWan27VideoEditSourceProfile } from "../application/owner-wan27-videoedit-parameters.js";

export const OWNER_WAN27_VIDEOEDIT_TOOL_NAMES = Object.freeze([
  "syntx_owner_get_wan27_videoedit_source", "syntx_owner_upload_wan27_videoedit_reference",
  "syntx_owner_generate_wan27_videoedit_video", "syntx_owner_reconcile_wan27_videoedit_video",
  "syntx_owner_list_wan27_videoedit_recoveries", "syntx_owner_get_wan27_videoedit_result_page"
] as const);

export interface OwnerWan27VideoEditToolOptions {
  readonly maxVideoFileBytes?: number;
  readonly referenceService: { uploadReference(input: unknown, signal?: AbortSignal): Promise<unknown> };
  readonly generationService: {
    generate(input: unknown, signal?: AbortSignal): Promise<unknown>;
    reconcile(input: unknown, signal?: AbortSignal): Promise<unknown>;
    listRecoveries(input: unknown): Promise<readonly unknown[]>;
    getResultPage(input: unknown): Promise<unknown>;
  };
}

const MODEL_ID = "wan_27_videoedit" as const;
const IMAGE_CAP = 20 * 1024 * 1024;
const VIDEO_CAP = 100 * 1024 * 1024;
const DEFAULT_VIDEO_CAP = 64 * 1024 * 1024;
const MAX_RESULTS = 4096;
const PAGE_SIZE = 64;
const attempt = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const handle = z.string().regex(/^wan27_videoedit_reference_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
const recovery = z.string().regex(/^wan27_videoedit_recovery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
const sha = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const imageMime = z.enum(["image/jpg", "image/jpeg", "image/png", "image/bmp", "image/webp"]);
const videoMime = z.enum(["video/mp4", "video/quicktime"]);
const uploadMime = z.union([imageMime, videoMime]);
const sourcePin = getOwnerWan27VideoEditSourceProfile().source_pins;

const diagnostic = z.object({
  phase: z.enum(["VALIDATE_REQUEST", "PREFLIGHT_ONE", "CHAT_CREATE", "PREFLIGHT_TWO", "GENERATION_POST",
    "POST_ACK_KNOWN", "HISTORY_GET", "RESULT_GET"]),
  post_started: z.boolean(), ack_known: z.boolean(),
  history_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "INCOMPLETE", "UNVERIFIED"]),
  owner_ack_status: z.enum(["NOT_READ", "MATCHED", "MISSING", "AMBIGUOUS", "MISMATCH"]),
  request_echo_status: z.enum(["NOT_READ", "MATCHED", "ABSENT", "PARTIAL_UNPROVEN", "CONTRADICTORY"]),
  history_get_calls: z.number().int().nonnegative(), result_get_calls: z.number().int().nonnegative(),
  result_status: z.enum(["NOT_READ", "COMPLETE", "UNVERIFIED"]),
  gaps: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u)).max(32)
}).strict();

const resultSchema = z.object({
  status: z.literal("completed"), status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"),
  backend_acceptance: z.literal("UNPROVEN"), provider_terminal_status: z.literal("UNPROVEN"), cost_cap_enforced: z.literal(false),
  output_count: z.literal("UNKNOWN"), recovery_id: recovery, model_id: z.literal(MODEL_ID),
  source_binding: z.object({ public_catalog_version: z.literal(sourcePin.public_catalog_version), profile_sha256: sha,
    request_fingerprint: sha, intent_fingerprint: sha }).strict(),
  observed_artifact_count: z.number().int().min(1).max(MAX_RESULTS), offset: z.number().int().min(0).max(MAX_RESULTS),
  page_size: z.literal(PAGE_SIZE),
  artifacts: z.array(z.object({ object_index: z.number().int().nonnegative(), message_object_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u),
    object_type: z.literal("video"), object_url: z.string().max(4096).refine(isSafeUploadReferenceUrl),
    mime_type: videoMime.nullable(), mime_source: z.enum(["URL_EXTENSION", "UNKNOWN"]),
    message_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u),
    chat_uuid: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u), model_id: z.literal(MODEL_ID)
  }).strict()).max(PAGE_SIZE),
  has_more: z.boolean(), next_offset: z.number().int().min(0).max(MAX_RESULTS).nullable(), diagnostic
}).strict().refine(value => {
  const next = value.offset + value.artifacts.length;
  return value.source_binding.profile_sha256 === getOwnerWan27VideoEditSourceProfile().source_sha256 &&
    value.artifacts.every(item => item.model_id === MODEL_ID && item.mime_source === (item.mime_type === null ? "UNKNOWN" : "URL_EXTENSION")) &&
    value.offset <= value.observed_artifact_count && value.artifacts.length === Math.min(PAGE_SIZE, value.observed_artifact_count - value.offset) &&
    value.has_more === (next < value.observed_artifact_count) && value.next_offset === (value.has_more ? next : null);
});

const recoveryListSchema = z.object({ recoveries: z.array(z.object({ recovery_id: recovery, model_id: z.literal(MODEL_ID),
  created_at: z.iso.datetime(), status: z.enum(["outcome_unknown", "completed"]),
  observed_artifact_count: z.number().int().min(0).max(MAX_RESULTS), diagnostic
}).strict()).max(128) }).strict();

const generationInput = z.object({
  link_attempt_id: attempt, model_id: z.literal(MODEL_ID), prompt: z.string().min(1).max(1500).refine(value => value.trim().length > 0),
  resolution: z.enum(["720P", "1080P"]), aspect_ratio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"]),
  audio_setting: z.enum(["auto", "origin"]), prompt_extend: z.boolean(),
  seed: z.number().int().min(0).max(2_147_483_647).nullable(), duration_mode: z.enum(["preserve_input", "custom"]),
  custom_video_duration: z.number().int().min(2).max(10).optional(),
  reference_handles: z.array(handle).min(1).max(5).refine(values => new Set(values).size === values.length)
}).strict().superRefine((value, context) => {
  if (value.duration_mode === "custom" && value.custom_video_duration === undefined) {
    context.addIssue({ code: "custom", message: "Custom mode requires an explicit duration.", path: ["custom_video_duration"] });
  }
  if (value.duration_mode === "preserve_input" && Object.hasOwn(value, "custom_video_duration")) {
    context.addIssue({ code: "custom", message: "Preserve mode does not accept a custom duration.", path: ["custom_video_duration"] });
  }
});

const recoveryInput = z.object({ link_attempt_id: attempt, recovery_id: recovery }).strict();
const listInput = z.object({ link_attempt_id: attempt, limit: z.number().int().min(1).max(128).optional() }).strict();
const pageInput = z.object({ link_attempt_id: attempt, recovery_id: recovery,
  offset: z.number().int().min(0).max(MAX_RESULTS).optional() }).strict();

const sourceSchema = z.object({ profile: z.record(z.string(), z.unknown()), local_policy: z.object({
  max_image_file_bytes: z.literal(IMAGE_CAP), max_video_file_bytes: z.number().int().min(1).max(VIDEO_CAP),
  max_video_file_bytes_range: z.object({ min: z.literal(1), max: z.literal(VIDEO_CAP) }).strict(),
  image_mime_types: z.array(imageMime).length(5), video_mime_types: z.array(videoMime).length(2),
  min_width: z.literal(240), max_width: z.literal(4096), min_height: z.literal(240), max_height: z.literal(4096),
  video_duration_min_seconds: z.literal(2), video_duration_max_seconds: z.literal(10),
  video_duration_source: z.literal("MAX_FINITE_AUDIO_VIDEO_TRACK_END_SECONDS"), already_trimmed_video_required: z.literal(true),
  min_video_count: z.literal(1), max_video_count: z.literal(1), max_image_count: z.literal(4), max_reference_count: z.literal(5),
  input_inspection: z.literal("IMAGE_STRUCTURE_AND_FFPROBE_METADATA_NO_PIXEL_DECODE"), pixel_decode: z.literal(false),
  crop_performed: z.literal(false), hdr_or_aspect_ratio_guard: z.literal(false), generation_permit: z.literal(false),
  price_or_provider_cost_cap: z.literal("NOT_ENFORCED_BY_PROVIDER"), durability: z.literal("PROCESS_LOCAL_ONLY")
}).strict(), backend_acceptance: z.literal("UNPROVEN") }).strict();

const ERRORS = new Set(["INVALID_REQUEST", "OUTPUT_INVALID", "SERVICE_CLOSED", "SERVICE_BUSY", "CAPACITY_EXCEEDED", "REQUEST_ABORTED",
  "PRINCIPAL_NOT_LINKED", "VALIDATION_REJECTED", "UPLOAD_OUTCOME_UNKNOWN", "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED",
  "MODEL_BINDING_MISMATCH", "PREFLIGHT_FAILED", "SUBSCRIPTION_REQUIRED", "SUBSCRIPTION_STATUS_UNVERIFIED", "INTENT_ALREADY_CLAIMED",
  "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND", "PARAMETERS_INVALID", "PARAMETER_INVALID",
  "CANDIDATE_UNBOUND", "CANDIDATE_EXPIRED", "PROFILE_BINDING_MISMATCH", "CLOCK_INVALID"]);

/** Six exact-model owner tools. Inputs contain no URLs, role tags, native settings, or cost-duration overrides. */
export function registerSyntxOwnerWan27VideoEditTools(server: McpServer, optionsInput: OwnerWan27VideoEditToolOptions | unknown): void {
  const options = exactOptions(optionsInput);
  const videoCap = options.maxVideoFileBytes ?? DEFAULT_VIDEO_CAP;
  if (!Number.isSafeInteger(videoCap) || videoCap < 1 || videoCap > VIDEO_CAP) throw new Error("INVALID_WAN27_VIDEOEDIT_OPERATOR_CAP");
  const maxEncoded = Math.ceil(Math.max(IMAGE_CAP, videoCap) / 3) * 4;
  const uploadInput = z.object({ link_attempt_id: attempt, model_id: z.literal(MODEL_ID), filename: z.string().min(1).max(255),
    mime_type: uploadMime, content_base64: z.string().min(4).max(maxEncoded)
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u)
  }).strict();

  const uploadOutput = z.object({ status: z.literal("uploaded"), reference_handle: handle, model_id: z.literal(MODEL_ID),
    kind: z.enum(["image", "video"]), mime_type: z.union([z.enum(["image/jpeg", "image/png", "image/bmp", "image/webp"]), videoMime]),
    size: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/u), width: z.number().int().min(240).max(4096),
    height: z.number().int().min(240).max(4096), duration_seconds: z.number().finite().positive().nullable(),
    input_cost_duration_seconds: z.number().finite().positive().nullable(), expires_in_seconds: z.number().int().min(0).max(900),
    input_confidence: z.literal("LOCAL_METADATA_ONLY_NO_DECODE")
  }).strict().refine(value => value.kind === "image"
    ? value.mime_type.startsWith("image/") && value.size <= IMAGE_CAP &&
      value.duration_seconds === null && value.input_cost_duration_seconds === null
    : value.mime_type.startsWith("video/") && value.size <= videoCap && value.duration_seconds !== null &&
      value.input_cost_duration_seconds === value.duration_seconds && value.duration_seconds >= 2 && value.duration_seconds <= 10);

  server.registerTool(OWNER_WAN27_VIDEOEDIT_TOOL_NAMES[0], { title: "Get WAN 2.7 Video Edit controls and limits",
    description: "Pinned source profile and local inspection/resource policy for exact wan_27_videoedit. Source contract is not provider acceptance; no media upload or generation occurs.",
    inputSchema: z.object({ model_id: z.literal(MODEL_ID) }).strict(), outputSchema: sourceSchema, annotations: hints(true, false)
  }, async () => success(sourceSchema, { profile: getOwnerWan27VideoEditSourceProfile(), local_policy: {
    max_image_file_bytes: IMAGE_CAP, max_video_file_bytes: videoCap, max_video_file_bytes_range: { min: 1, max: VIDEO_CAP },
    image_mime_types: ["image/jpg", "image/jpeg", "image/png", "image/bmp", "image/webp"],
    video_mime_types: ["video/mp4", "video/quicktime"], min_width: 240, max_width: 4096, min_height: 240, max_height: 4096,
    video_duration_min_seconds: 2, video_duration_max_seconds: 10,
    video_duration_source: "MAX_FINITE_AUDIO_VIDEO_TRACK_END_SECONDS", already_trimmed_video_required: true,
    min_video_count: 1, max_video_count: 1, max_image_count: 4, max_reference_count: 5,
    input_inspection: "IMAGE_STRUCTURE_AND_FFPROBE_METADATA_NO_PIXEL_DECODE", pixel_decode: false,
    crop_performed: false, hdr_or_aspect_ratio_guard: false, generation_permit: false,
    price_or_provider_cost_cap: "NOT_ENFORCED_BY_PROVIDER", durability: "PROCESS_LOCAL_ONLY"
  }, backend_acceptance: "UNPROVEN" }));

  server.registerTool(OWNER_WAN27_VIDEOEDIT_TOOL_NAMES[1], { title: "Upload one WAN 2.7 Video Edit reference",
    description: "Upload owner-supplied image or already-trimmed video bytes to the linked account. The local inspection is metadata/structure only, produces an opaque handle, and never returns the private upload URL. Never repeat an uncertain upload.",
    inputSchema: uploadInput, outputSchema: uploadOutput, annotations: hints(false, true)
  }, async (input, { signal }) => {
    let bytes: Buffer | undefined;
    try {
      const data = uploadInput.parse(input), video = data.mime_type.startsWith("video/");
      const padding = data.content_base64.endsWith("==") ? 2 : data.content_base64.endsWith("=") ? 1 : 0;
      const length = data.content_base64.length / 4 * 3 - padding;
      if (!Number.isSafeInteger(length) || length < 1 || length > (video ? videoCap : IMAGE_CAP)) return errorCode("INVALID_REQUEST");
      bytes = Buffer.from(data.content_base64, "base64");
      if (bytes.length !== length || bytes.toString("base64") !== data.content_base64) return errorCode("INVALID_REQUEST");
      const output = await options.referenceService.uploadReference({ attemptId: data.link_attempt_id, model_id: MODEL_ID,
        filename: data.filename, mime_type: data.mime_type, bytes }, signal);
      const parsed = uploadOutput.safeParse(output), expectedMime = data.mime_type === "image/jpg" ? "image/jpeg" : data.mime_type;
      if (!parsed.success || parsed.data.model_id !== MODEL_ID || parsed.data.size !== length || parsed.data.mime_type !== expectedMime ||
          parsed.data.kind !== (video ? "video" : "image")) return errorCode("UPLOAD_OUTCOME_UNKNOWN");
      return success(uploadOutput, parsed.data, "UPLOAD_OUTCOME_UNKNOWN");
    } catch (error) { return safeError(error); }
    finally { bytes?.fill(0); }
  });

  server.registerTool(OWNER_WAN27_VIDEOEDIT_TOOL_NAMES[2], { title: "Generate one WAN 2.7 Video Edit video",
    description: "Submit one explicit exact-model request using 1–5 owner-owned opaque handles. One source video and up to four images are resolved and validated by the reference vault/preparer. The input must already be trimmed to 2–10 seconds; no client duration, URL, role, native-setting, or cost-duration override is accepted. Unknown dispatch outcome is GET-only; never repeat generation.",
    inputSchema: generationInput, outputSchema: resultSchema, annotations: hints(false, true)
  }, async (input, { signal }) => {
    try {
      const data = generationInput.parse(input);
      const forwarded = { attemptId: data.link_attempt_id, model_id: MODEL_ID, prompt: data.prompt, resolution: data.resolution,
        aspect_ratio: data.aspect_ratio, audio_setting: data.audio_setting, prompt_extend: data.prompt_extend, seed: data.seed,
        duration_mode: data.duration_mode,
        ...(data.duration_mode === "custom" ? { custom_video_duration: data.custom_video_duration! } : {}),
        reference_handles: [...data.reference_handles] };
      const value = await options.generationService.generate(forwarded, signal);
      const parsed = resultSchema.safeParse(value);
      if (!parsed.success || parsed.data.model_id !== MODEL_ID) return invalidOutput(value, "OUTCOME_UNKNOWN");
      return success(resultSchema, parsed.data, "OUTCOME_UNKNOWN");
    } catch (error) { return safeError(error); }
  });

  server.registerTool(OWNER_WAN27_VIDEOEDIT_TOOL_NAMES[3], { title: "Reconcile WAN 2.7 Video Edit (GET only)",
    description: "Read only this linked owner's existing recovery. No upload, chat creation, or generation retry.",
    inputSchema: recoveryInput, outputSchema: resultSchema, annotations: hints(true, true)
  }, async (input, { signal }) => {
    try {
      const data = recoveryInput.parse(input);
      return success(resultSchema, await options.generationService.reconcile({ attemptId: data.link_attempt_id, recovery_id: data.recovery_id }, signal), "OUTCOME_UNKNOWN");
    } catch (error) { return safeError(error); }
  });

  server.registerTool(OWNER_WAN27_VIDEOEDIT_TOOL_NAMES[4], { title: "List WAN 2.7 Video Edit recoveries",
    description: "Return the bounded process-local recovery list for this linked owner; no provider dispatch.",
    inputSchema: listInput, outputSchema: recoveryListSchema, annotations: hints(true, false)
  }, async input => {
    try {
      const { link_attempt_id, ...fields } = listInput.parse(input);
      return success(recoveryListSchema, { recoveries: await options.generationService.listRecoveries({ attemptId: link_attempt_id, ...fields }) });
    } catch (error) { return safeError(error); }
  });

  server.registerTool(OWNER_WAN27_VIDEOEDIT_TOOL_NAMES[5], { title: "Read WAN 2.7 Video Edit result page",
    description: "Read a bounded page of already observed results for this linked owner; no retry or new generation.",
    inputSchema: pageInput, outputSchema: resultSchema, annotations: hints(true, false)
  }, async input => {
    try {
      const { link_attempt_id, ...fields } = pageInput.parse(input);
      return success(resultSchema, await options.generationService.getResultPage({ attemptId: link_attempt_id, ...fields }), "OUTCOME_UNKNOWN");
    } catch (error) { return safeError(error); }
  });
}

function exactOptions(input: unknown): OwnerWan27VideoEditToolOptions {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) throw new Error("INVALID_WAN27_VIDEOEDIT_TOOL_OPTIONS");
  try {
    const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors);
    const allowed = ["referenceService", "generationService", "maxVideoFileBytes"];
    if (Object.getPrototypeOf(input) !== Object.prototype || keys.length < 2 || keys.length > 3 || keys.some(key =>
      typeof key !== "string" || !allowed.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true) ||
      !Object.hasOwn(descriptors, "referenceService") || !Object.hasOwn(descriptors, "generationService")) throw new Error();
    const referenceService = descriptors.referenceService!.value, generationService = descriptors.generationService!.value;
    if (!referenceService || typeof referenceService !== "object" || types.isProxy(referenceService) ||
        typeof (referenceService as { uploadReference?: unknown }).uploadReference !== "function" ||
        !generationService || typeof generationService !== "object" || types.isProxy(generationService) ||
        ["generate", "reconcile", "listRecoveries", "getResultPage"].some(name =>
          typeof (generationService as Record<string, unknown>)[name] !== "function")) throw new Error();
    return { referenceService: referenceService as OwnerWan27VideoEditToolOptions["referenceService"],
      generationService: generationService as OwnerWan27VideoEditToolOptions["generationService"],
      ...(Object.hasOwn(descriptors, "maxVideoFileBytes") ? { maxVideoFileBytes: descriptors.maxVideoFileBytes!.value as number } : {}) };
  } catch { throw new Error("INVALID_WAN27_VIDEOEDIT_TOOL_OPTIONS"); }
}

function hints(readOnly: boolean, openWorld: boolean) {
  return { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: readOnly, openWorldHint: openWorld };
}

function success<T extends z.ZodType>(schema: T, value: unknown, failure = "OUTPUT_INVALID"): CallToolResult {
  const parsed = schema.safeParse(value);
  return parsed.success
    ? { content: [{ type: "text", text: JSON.stringify(parsed.data) }], structuredContent: parsed.data as Record<string, unknown> }
    : invalidOutput(value, failure);
}

function invalidOutput(value: unknown, failure: string): CallToolResult {
  let recoveryId: string | undefined;
  if (failure === "OUTCOME_UNKNOWN" && value && typeof value === "object" && !types.isProxy(value)) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, "recovery_id");
      if (descriptor && Object.hasOwn(descriptor, "value") && recovery.safeParse(descriptor.value).success) recoveryId = descriptor.value as string;
    } catch { /* malformed output must not escape through diagnostic access */ }
  }
  return errorCode(failure, recoveryId);
}

function safeError(value: unknown): CallToolResult {
  let code = "INVALID_REQUEST", recoveryId: string | undefined;
  if (value && typeof value === "object" && !types.isProxy(value)) {
    try {
      const codeDescriptor = Object.getOwnPropertyDescriptor(value, "code"), recoveryDescriptor = Object.getOwnPropertyDescriptor(value, "recovery_id");
      if (codeDescriptor && Object.hasOwn(codeDescriptor, "value") && typeof codeDescriptor.value === "string" && ERRORS.has(codeDescriptor.value)) {
        code = codeDescriptor.value;
      }
      if (code === "OUTCOME_UNKNOWN" && recoveryDescriptor && Object.hasOwn(recoveryDescriptor, "value") &&
          recovery.safeParse(recoveryDescriptor.value).success) recoveryId = recoveryDescriptor.value as string;
    } catch { /* generic safe error */ }
  }
  return errorCode(code, recoveryId);
}

function errorCode(code: string, recoveryId?: string): CallToolResult {
  const unknown = code === "OUTCOME_UNKNOWN" || code === "UPLOAD_OUTCOME_UNKNOWN";
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code,
    message: unknown ? "The operation may have been dispatched; do not retry. Use GET-only reconciliation with its recovery handle if available."
      : "The owner WAN 2.7 Video Edit operation could not be completed safely.",
    ...(recoveryId === undefined ? {} : { recovery_id: recoveryId }) } }) }] };
}
