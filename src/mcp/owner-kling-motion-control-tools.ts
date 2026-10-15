import { types } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { OwnerKlingMotionControlReferenceService, OwnerKlingMotionControlReferenceServiceError } from "../application/owner-kling-motion-control-reference-service.js";
import { OWNER_KLING_MOTION_CONTROL_IMAGE_POLICY } from "../application/owner-kling-motion-control-image-policy.js";
import { OWNER_KLING_MOTION_CONTROL_VIDEO_POLICY } from "../application/owner-kling-motion-control-video-probe.js";
import { OwnerKlingMotionControlPresetReferenceService, OwnerKlingMotionControlPresetReferenceServiceError } from "../application/owner-kling-motion-control-preset-reference-service.js";
import {
  getOwnerKlingMotionControlParametersSource,
  normalizeOwnerKlingMotionControlParameters,
  OwnerKlingMotionControlParametersError
} from "../application/owner-kling-motion-control-parameters.js";
import {
  isOwnerKlingMotionControlGenerationService,
  OwnerKlingMotionControlGenerationServiceError,
  type OwnerKlingMotionControlGenerationService
} from "../application/owner-kling-motion-control-generation-service.js";
import type { OwnerKlingMotionControlReferenceService as ReferenceService } from "../application/owner-kling-motion-control-reference-service.js";
import type { OwnerKlingMotionControlPresetReferenceService as PresetReferenceService } from "../application/owner-kling-motion-control-preset-reference-service.js";

export const SYNTX_OWNER_GET_KLING_MOTION_CONTROL_PARAMETERS_TOOL_NAME = "syntx_owner_get_kling_motion_control_parameters" as const;
export const SYNTX_OWNER_UPLOAD_KLING_MOTION_CONTROL_IMAGE_TOOL_NAME = "syntx_owner_upload_kling_motion_control_image" as const;
export const SYNTX_OWNER_UPLOAD_KLING_MOTION_CONTROL_VIDEO_TOOL_NAME = "syntx_owner_upload_kling_motion_control_video" as const;
export const SYNTX_OWNER_LIST_KLING_MOTION_CONTROL_PRESETS_TOOL_NAME = "syntx_owner_list_kling_motion_control_presets" as const;
export const SYNTX_OWNER_SELECT_KLING_MOTION_CONTROL_PRESET_TOOL_NAME = "syntx_owner_select_kling_motion_control_preset" as const;
export const SYNTX_OWNER_GENERATE_KLING_MOTION_CONTROL_VIDEO_TOOL_NAME = "syntx_owner_generate_kling_motion_control_video" as const;
export const SYNTX_OWNER_RECONCILE_KLING_MOTION_CONTROL_VIDEO_TOOL_NAME = "syntx_owner_reconcile_kling_motion_control_video" as const;
export const SYNTX_OWNER_LIST_KLING_MOTION_CONTROL_RECOVERIES_TOOL_NAME = "syntx_owner_list_kling_motion_control_recoveries" as const;
export const SYNTX_OWNER_GET_KLING_MOTION_CONTROL_RESULT_PAGE_TOOL_NAME = "syntx_owner_get_kling_motion_control_result_page" as const;
export const OWNER_KLING_MOTION_CONTROL_TOOL_NAMES = Object.freeze([
  SYNTX_OWNER_GET_KLING_MOTION_CONTROL_PARAMETERS_TOOL_NAME,
  SYNTX_OWNER_UPLOAD_KLING_MOTION_CONTROL_IMAGE_TOOL_NAME,
  SYNTX_OWNER_UPLOAD_KLING_MOTION_CONTROL_VIDEO_TOOL_NAME,
  SYNTX_OWNER_LIST_KLING_MOTION_CONTROL_PRESETS_TOOL_NAME,
  SYNTX_OWNER_SELECT_KLING_MOTION_CONTROL_PRESET_TOOL_NAME,
  SYNTX_OWNER_GENERATE_KLING_MOTION_CONTROL_VIDEO_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_KLING_MOTION_CONTROL_VIDEO_TOOL_NAME,
  SYNTX_OWNER_LIST_KLING_MOTION_CONTROL_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_GET_KLING_MOTION_CONTROL_RESULT_PAGE_TOOL_NAME
] as const);

const MODEL_ID = "kling_motion_control" as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const IMAGE_HANDLE = /^kling_motion_control_image_[0-9a-f-]{36}$/u;
const VIDEO_HANDLE = /^kling_motion_control_video_[0-9a-f-]{36}$/u;
const PRESET_HANDLE = /^kling_motion_control_preset_\d{1,3}_[0-9a-f-]{36}$/u;
const PRESET_VIDEO_HANDLE = /^kling_motion_control_preset_video_[0-9a-f-]{36}$/u;
const RECOVERY_ID = /^kling_motion_control_generation_recovery_[0-9a-f-]{36}$/u;
const MAX_IMAGE_BASE64 = Math.ceil(OWNER_KLING_MOTION_CONTROL_IMAGE_POLICY.max_file_size_bytes / 3) * 4;
const MAX_VIDEO_BASE64 = Math.ceil(OWNER_KLING_MOTION_CONTROL_VIDEO_POLICY.max_file_size_bytes / 3) * 4;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const SOURCE = getOwnerKlingMotionControlParametersSource();
const attempt = z.string().regex(ATTEMPT).describe("Exact currently linked owner attempt.");
const recovery = z.string().regex(RECOVERY_ID);
const imageHandle = z.string().regex(IMAGE_HANDLE);
const videoHandle = z.string().regex(VIDEO_HANDLE);
const presetHandle = z.string().regex(PRESET_HANDLE);
const presetVideoHandle = z.string().regex(PRESET_VIDEO_HANDLE);
const version = z.enum(["2.6", "3.0"]);
const mode = z.enum(["standart", "hd"]);
const genType = z.enum(["mcv", "mci"]);

const parameterSourceSchema = z.object({
  status: z.literal(SOURCE.status), model_id: z.literal(MODEL_ID), operation_id: z.literal("generate-video"), ai_name: z.literal("kling"),
  source_pins: z.object({ public_catalog: z.string(), form_module: z.string(), form_build_id: z.string(), form_bytes: z.number().int(), form_sha256: z.string() }).strict(),
  controls: z.object({
    version: z.object({ values: z.tuple([z.literal("2.6"), z.literal("3.0")]), effective_default: z.literal("UNKNOWN") }).strict(),
    mode: z.object({ values: z.tuple([z.literal("standart"), z.literal("hd")]), spelling: z.literal("EXACT_SOURCE_LITERAL"), effective_default: z.literal("UNKNOWN") }).strict(),
    gen_type: z.object({ values: z.tuple([z.literal("mcv"), z.literal("mci")]), effective_default: z.literal("UNKNOWN") }).strict(),
    native_audio: z.object({ values: z.tuple([z.literal(false), z.literal(true)]), versions: z.tuple([z.literal("2.6"), z.literal("3.0")]), effective_default: z.literal("UNKNOWN") }).strict(),
    video_duration: z.object({ min: z.literal(3), max_by_gen_type: z.object({ mci: z.literal(10), mcv: z.literal(30) }).strict(), unit: z.literal("INTEGER_SECONDS"), applies_to_raw_input_duration: z.literal(true), source_caps_are_upload_constraints: z.literal(true) }).strict()
  }).strict(),
  settings: z.object({ template_keys: z.tuple([z.literal("model_type"), z.literal("version"), z.literal("mode"), z.literal("gen_type"), z.literal("native_audio"), z.literal("video_duration")]), raw_video_binding: z.literal("FUTURE_PREPARER_RESPONSIBILITY"), references: z.literal("FUTURE_TYPED_OWNED_IMAGE_AND_VIDEO_PREPARER") }).strict(),
  omissions: z.object({ temperature: z.literal("EXPLICITLY_DELETED_FOR_MCV"), aspect_ratio: z.literal("CLEARED_FOR_RESOLVED_MOTION_CONTROL_INPUT"), multi_shots: z.literal("NOT_AN_MCV_CONTROL"), camera_movement: z.literal("NOT_AN_MCV_CONTROL"), motion_setting: z.literal("CONVERTED_BY_SENDER_TO_TYPED_VIDEO_REFERENCE_THEN_DELETED"), caller_file_urls: z.literal("NOT_ACCEPTED_OR_PROJECTED") }).strict(),
  cost_projection: z.object({ source: z.literal("B066_CURRENT_COST_HELPER_SETTINGS_KEYS_ONLY"), keys: z.tuple([z.literal("mode"), z.literal("video_duration"), z.literal("version"), z.literal("native_audio"), z.literal("gen_type")]), values: z.literal("SAME_FROZEN_NORMALIZED_INTENT"), amount_or_quote: z.literal("UNPROVEN") }).strict(),
  effective_defaults: z.literal("UNKNOWN"), runtime_usable: z.literal(false), dispatch_allowed: z.literal(false), backend_acceptance: z.literal("UNPROVEN")
}).strict();
const parameterSourceToolOutputSchema = parameterSourceSchema.partial().extend({
  status: z.enum([SOURCE.status, "unavailable"]), code: z.string().min(1).max(64).optional(), message: z.string().min(1).max(180).optional()
}).strict();

const attemptOnlySchema = z.object({ link_attempt_id: attempt }).strict();
const uploadImageInputSchema = z.object({ link_attempt_id: attempt, content_base64: z.string().min(4).max(MAX_IMAGE_BASE64).regex(BASE64),
  filename: z.string().min(1).max(255), mime_type: z.enum(OWNER_KLING_MOTION_CONTROL_IMAGE_POLICY.source_mime_types) }).strict();
const uploadVideoInputSchema = z.object({ link_attempt_id: attempt, content_base64: z.string().min(4).max(MAX_VIDEO_BASE64).regex(BASE64),
  filename: z.string().min(1).max(255), mime_type: z.enum(OWNER_KLING_MOTION_CONTROL_VIDEO_POLICY.source_mime_types) }).strict();
const uploadImageOutputSchema = z.object({ status: z.literal("uploaded"), image_handle: imageHandle, model_id: z.literal(MODEL_ID),
  filename: z.string().min(1).max(255), mime_type: z.enum(OWNER_KLING_MOTION_CONTROL_IMAGE_POLICY.source_mime_types),
  size: z.number().int().min(1).max(OWNER_KLING_MOTION_CONTROL_IMAGE_POLICY.max_file_size_bytes), sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  width: z.number().int().min(300), height: z.number().int().min(300), expires_in_seconds: z.number().int().min(1).max(900), generation_permit: z.literal(false) }).strict();
const uploadImageToolOutputSchema = uploadImageOutputSchema.partial().extend({
  status: z.enum(["uploaded", "unavailable"]), code: z.string().min(1).max(64).optional(), message: z.string().min(1).max(180).optional()
}).strict();
const uploadVideoOutputSchema = z.object({ status: z.literal("uploaded"), video_handle: videoHandle, model_id: z.literal(MODEL_ID),
  filename: z.string().min(1).max(255), mime_type: z.enum(OWNER_KLING_MOTION_CONTROL_VIDEO_POLICY.source_mime_types),
  size: z.number().int().min(1).max(OWNER_KLING_MOTION_CONTROL_VIDEO_POLICY.max_file_size_bytes), sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  width: z.number().int().min(300), height: z.number().int().min(300), duration_seconds: z.number().finite().min(3).max(30),
  expires_in_seconds: z.number().int().min(1).max(900), metadata_confidence: z.literal("TRUSTED_FFPROBE_METADATA_NOT_PIXEL_DECODED"), generation_permit: z.literal(false) }).strict();
const uploadVideoToolOutputSchema = uploadVideoOutputSchema.partial().extend({
  status: z.enum(["uploaded", "unavailable"]), code: z.string().min(1).max(64).optional(), message: z.string().min(1).max(180).optional()
}).strict();

const gapSchema = z.object({ index: z.number().int().min(0).max(255), code: z.enum(["UNKNOWN_ENTRY_FIELD", "VARIANT_URL_INVALID", "VARIANT_URL_UNSAFE",
  "VARIANT_URL_ORIGIN_UNVERIFIED", "PREVIEW_URL_INVALID", "PREVIEW_URL_UNSAFE", "PREVIEW_URL_ORIGIN_UNVERIFIED", "NO_SAFE_VARIANT"]) }).strict();
const availabilitySchema = z.object({ audio: z.boolean(), noaudio: z.boolean() }).strict();
const listPresetsOutputSchema = z.object({ presets: z.array(z.object({ preset_handle: presetHandle, name: z.string().min(1).max(160),
  availability: availabilitySchema, gaps: z.array(gapSchema).max(8),
  origin_confidence: z.literal("R2_UPLOAD_ORIGIN_ONLY_LOCAL_UNVERIFIED_FOR_PRESET_LIBRARY") }).strict()).max(256),
  gaps: z.array(gapSchema).max(4096), origin_confidence: z.literal("R2_UPLOAD_ORIGIN_ONLY_LOCAL_UNVERIFIED_FOR_PRESET_LIBRARY") }).strict();
const listPresetsToolOutputSchema = listPresetsOutputSchema.partial().extend({
  status: z.enum(["listed", "unavailable"]), code: z.string().min(1).max(64).optional(), message: z.string().min(1).max(180).optional()
}).strict();
const selectPresetInputSchema = z.object({ link_attempt_id: attempt, preset_handle: presetHandle, variant: z.enum(["audio", "noaudio"]) }).strict();
const selectPresetOutputSchema = z.object({ status: z.literal("selected_video_probed"), preset_video_handle: presetVideoHandle, model_id: z.literal(MODEL_ID),
  variant: z.enum(["audio", "noaudio"]), mime_type: z.enum(OWNER_KLING_MOTION_CONTROL_VIDEO_POLICY.source_mime_types),
  size: z.number().int().min(1).max(OWNER_KLING_MOTION_CONTROL_VIDEO_POLICY.max_file_size_bytes), sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  width: z.number().int().min(300), height: z.number().int().min(300), duration_seconds: z.number().finite().min(3).max(30),
  expires_in_seconds: z.number().int().min(1).max(900), metadata_confidence: z.literal("TRUSTED_FFPROBE_METADATA_NOT_PIXEL_DECODED"), generation_permit: z.literal(false) }).strict();
const selectPresetToolOutputSchema = selectPresetOutputSchema.partial().extend({
  status: z.enum(["selected_video_probed", "unavailable"]), code: z.string().min(1).max(64).optional(), message: z.string().min(1).max(180).optional()
}).strict();

const commonGenerateFields = { link_attempt_id: attempt, model_id: z.literal(MODEL_ID), image_handle: imageHandle,
  version, mode, gen_type: genType, native_audio: z.boolean(), video_duration: z.number().int().min(3).max(30), prompt: z.string().max(128 * 1024).optional() };
const generateInputSchema = z.object({ ...commonGenerateFields, reference_source: z.enum(["owned_video", "service_preset"]),
  video_handle: videoHandle.optional(), preset_video_handle: presetVideoHandle.optional() }).strict().superRefine((input, context) => {
  if (input.reference_source === "owned_video" ? (!input.video_handle || input.preset_video_handle !== undefined) :
      (!input.preset_video_handle || input.video_handle !== undefined)) {
    context.addIssue({ code: "custom", path: ["reference_source"], message: "Provide exactly the handle for the selected Motion Control source." });
  }
  try { normalizeOwnerKlingMotionControlParameters({ model_id: input.model_id, version: input.version, mode: input.mode,
    gen_type: input.gen_type, native_audio: input.native_audio, video_duration: input.video_duration }); }
  catch { context.addIssue({ code: "custom", path: ["video_duration"], message: "The explicit Motion Control parameter tuple is invalid." }); }
  if (input.prompt !== undefined && (Buffer.byteLength(input.prompt, "utf8") > 128 * 1024 || input.prompt.includes("\0") || !wellFormed(input.prompt))) {
    context.addIssue({ code: "custom", path: ["prompt"], message: "Prompt exceeds the local size or text-validity limit." });
  }
});

const reconcileInputSchema = z.object({ link_attempt_id: attempt, recovery_id: recovery }).strict();
const listRecoveriesInputSchema = z.object({ link_attempt_id: attempt, limit: z.number().int().min(1).max(128).optional() }).strict();
const resultPageInputSchema = z.object({ link_attempt_id: attempt, recovery_id: recovery, offset: z.number().int().min(0).max(4096).optional() }).strict();
const diagnosticSchema = z.object({ post_started: z.boolean(), ack_known: z.boolean(),
  history_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "INCOMPLETE", "UNVERIFIED"]),
  owner_ack_status: z.enum(["NOT_READ", "MATCHED", "MISSING", "AMBIGUOUS", "MISMATCH"]),
  history_get_calls: z.number().int().nonnegative(), result_get_calls: z.number().int().nonnegative(),
  gaps: z.array(z.string().min(1).max(64).regex(/^[A-Z0-9_]+$/u)).max(32) }).strict();
const artifactSchema = z.object({ object_index: z.number().int().min(0).max(4095), message_object_id: z.string().min(1).max(160),
  object_type: z.literal("video"), object_url: z.string().url().max(4096).refine(isSafeUploadReferenceUrl),
  mime_type: z.enum(["video/mp4", "video/webm"]).nullable(), message_id: z.string().min(1).max(160),
  chat_uuid: z.string().min(1).max(160), model_id: z.literal(MODEL_ID) }).strict();
const resultSchema = z.object({ status: z.literal("completed"), status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"),
  backend_acceptance: z.literal("UNPROVEN"), provider_terminal_status: z.literal("UNPROVEN"), cost_cap_enforced: z.literal(false),
  model_id: z.literal(MODEL_ID), recovery_id: recovery, observed_artifact_count: z.number().int().min(1).max(4096),
  offset: z.number().int().min(0).max(4096), page_size: z.number().int().min(0).max(64), artifacts: z.array(artifactSchema).max(64),
  has_more: z.boolean(), next_offset: z.number().int().min(1).max(4096).nullable(), diagnostic: diagnosticSchema }).strict();
const recoveriesSchema = z.object({ recoveries: z.array(z.object({ recovery_id: recovery, created_at: z.iso.datetime(),
  status: z.enum(["outcome_unknown", "completed"]), observed_artifact_count: z.number().int().min(0).max(4096) }).strict()).max(128) }).strict();
const unavailableSchema = z.object({ status: z.literal("unavailable"), code: z.string().min(1).max(64), message: z.string().min(1).max(180),
  recovery_id: recovery.optional(), diagnostic: diagnosticSchema.optional() }).strict();
const resultToolOutputSchema = z.object({ status: z.enum(["completed", "unavailable"]),
  status_semantics: resultSchema.shape.status_semantics.optional(), backend_acceptance: resultSchema.shape.backend_acceptance.optional(),
  provider_terminal_status: resultSchema.shape.provider_terminal_status.optional(), cost_cap_enforced: resultSchema.shape.cost_cap_enforced.optional(),
  model_id: resultSchema.shape.model_id.optional(), recovery_id: recovery.optional(), observed_artifact_count: z.number().int().min(0).max(4096).optional(),
  offset: z.number().int().min(0).max(4096).optional(), page_size: z.number().int().min(0).max(64).optional(), artifacts: z.array(artifactSchema).max(64).optional(),
  has_more: z.boolean().optional(), next_offset: z.number().int().min(1).max(4096).nullable().optional(), diagnostic: diagnosticSchema.optional(),
  code: z.string().min(1).max(64).optional(), message: z.string().min(1).max(180).optional() }).strict();
const recoveriesToolOutputSchema = z.object({ recoveries: recoveriesSchema.shape.recoveries.optional(), status: z.literal("unavailable").optional(),
  code: z.string().min(1).max(64).optional(), message: z.string().min(1).max(180).optional(), recovery_id: recovery.optional(), diagnostic: diagnosticSchema.optional() }).strict();
const ERROR_CODES = new Set(["INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH",
  "PREFLIGHT_FAILED", "INTENT_ALREADY_CLAIMED", "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"]);
const REFERENCE_ERROR_CODES = new Set(["INVALID_REQUEST", "PROFILE_BINDING_MISMATCH", "PRINCIPAL_NOT_LINKED", "SERVICE_CLOSED", "SERVICE_BUSY",
  "CAPACITY_EXCEEDED", "REQUEST_ABORTED", "UPLOAD_REJECTED", "UPLOAD_OUTCOME_UNKNOWN", "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED"]);
const PRESET_ERROR_CODES = new Set(["INVALID_REQUEST", "PRINCIPAL_NOT_LINKED", "PROFILE_BINDING_MISMATCH", "SERVICE_CLOSED", "SERVICE_BUSY",
  "CAPACITY_EXCEEDED", "REQUEST_ABORTED", "PRESET_UNAVAILABLE", "PRESET_ORIGIN_UNVERIFIED", "DOWNLOAD_REJECTED", "DOWNLOAD_LIMIT_EXCEEDED", "VIDEO_UNVERIFIED", "REFERENCE_EXPIRED"]);

export interface RegisterSyntxOwnerKlingMotionControlToolsOptions {
  readonly referenceService: Pick<ReferenceService, "uploadImage" | "uploadVideo">;
  readonly presetReferenceService: Pick<PresetReferenceService, "listPresets" | "selectPreset">;
  readonly generationService: Pick<OwnerKlingMotionControlGenerationService, "generate" | "reconcile" | "listRecoveries" | "getResultPage">;
}

/** Registers the owner opt-in Motion Control tools; upload source handles are never accepted as caller URLs. */
export function registerSyntxOwnerKlingMotionControlTools(server: McpServer, options: RegisterSyntxOwnerKlingMotionControlToolsOptions): void {
  if (!(options.referenceService instanceof OwnerKlingMotionControlReferenceService) ||
      Object.getPrototypeOf(options.referenceService) !== OwnerKlingMotionControlReferenceService.prototype ||
      !(options.presetReferenceService instanceof OwnerKlingMotionControlPresetReferenceService) ||
      Object.getPrototypeOf(options.presetReferenceService) !== OwnerKlingMotionControlPresetReferenceService.prototype ||
      !isOwnerKlingMotionControlGenerationService(options.generationService)) throw new Error("OWNER_KLING_MOTION_CONTROL_SERVICE_INVALID");

  server.registerTool(SYNTX_OWNER_GET_KLING_MOTION_CONTROL_PARAMETERS_TOOL_NAME, {
    title: "Get Kling Motion Control parameters", description: "Returns current source-pinned Motion Control choices and local limits. Effective defaults, quoted price, provider validation, and backend acceptance remain unknown.",
    inputSchema: z.object({}).strict(), outputSchema: parameterSourceToolOutputSchema,
    annotations: { title: "Get Kling Motion Control parameters", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (): Promise<CallToolResult> => {
    try { return structured(parameterSourceSchema.parse(getOwnerKlingMotionControlParametersSource())); }
    catch { return unavailable("SOURCE_UNAVAILABLE", "The pinned Motion Control parameter source is unavailable."); }
  });

  server.registerTool(SYNTX_OWNER_UPLOAD_KLING_MOTION_CONTROL_IMAGE_TOOL_NAME, {
    title: "Upload a Kling Motion Control image", description: "Uploads one caller image to the exact linked owner attempt and returns an opaque image handle without its private URL. Local size and container metadata checks do not establish provider acceptance. An uncertain upload must not be replayed.",
    inputSchema: uploadImageInputSchema, outputSchema: uploadImageToolOutputSchema,
    annotations: { title: "Upload a Kling Motion Control image", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    const parsed = uploadImageInputSchema.safeParse(snapshot(input));
    if (!parsed.success) return unavailable("INVALID_REQUEST", "The Motion Control image request is invalid.");
    try {
      const value = parsed.data;
      const output = await options.referenceService.uploadImage({ attemptId: value.link_attempt_id, content_base64: value.content_base64,
        filename: value.filename, mime_type: value.mime_type }, signal);
      return structured(uploadImageOutputSchema.parse(output));
    } catch (error) { return serviceError(error, "REFERENCE"); }
  });

  server.registerTool(SYNTX_OWNER_UPLOAD_KLING_MOTION_CONTROL_VIDEO_TOOL_NAME, {
    title: "Upload a Kling Motion Control video", description: "Uploads one caller video after trusted local ffprobe checks and returns an opaque video handle. Probe metadata does not prove pixel decoding or provider acceptance. An uncertain upload must not be replayed.",
    inputSchema: uploadVideoInputSchema, outputSchema: uploadVideoToolOutputSchema,
    annotations: { title: "Upload a Kling Motion Control video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    const parsed = uploadVideoInputSchema.safeParse(snapshot(input));
    if (!parsed.success) return unavailable("INVALID_REQUEST", "The Motion Control video request is invalid.");
    try {
      const value = parsed.data;
      const output = await options.referenceService.uploadVideo({ attemptId: value.link_attempt_id, content_base64: value.content_base64,
        filename: value.filename, mime_type: value.mime_type }, signal);
      return structured(uploadVideoOutputSchema.parse(output));
    } catch (error) { return serviceError(error, "REFERENCE"); }
  });

  server.registerTool(SYNTX_OWNER_LIST_KLING_MOTION_CONTROL_PRESETS_TOOL_NAME, {
    title: "List Kling Motion Control presets", description: "Reads the linked account's native preset library and returns opaque preset handles, names, variants, and gaps only; no preset URL is returned. The library's R2-origin-only URL policy remains locally unverified.",
    inputSchema: attemptOnlySchema, outputSchema: listPresetsToolOutputSchema,
    annotations: { title: "List Kling Motion Control presets", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    const parsed = attemptOnlySchema.safeParse(snapshot(input));
    if (!parsed.success) return unavailable("INVALID_REQUEST", "The Motion Control preset-list request is invalid.");
    try {
      const output = await options.presetReferenceService.listPresets({ attemptId: parsed.data.link_attempt_id }, signal);
      return structured(listPresetsToolOutputSchema.parse({ status: "listed", presets: output.presets, gaps: output.gaps, origin_confidence: output.origin_confidence }));
    } catch (error) { return serviceError(error, "PRESET"); }
  });

  server.registerTool(SYNTX_OWNER_SELECT_KLING_MOTION_CONTROL_PRESET_TOOL_NAME, {
    title: "Select a Kling Motion Control preset", description: "Downloads one selected preset variant through the local owner path, probes it, and returns an opaque measured video handle. The source preset URL stays private; origin-confidence is local only.",
    inputSchema: selectPresetInputSchema, outputSchema: selectPresetToolOutputSchema,
    annotations: { title: "Select a Kling Motion Control preset", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    const parsed = selectPresetInputSchema.safeParse(snapshot(input));
    if (!parsed.success) return unavailable("INVALID_REQUEST", "The Motion Control preset-selection request is invalid.");
    try {
      const value = parsed.data;
      const output = await options.presetReferenceService.selectPreset({ attemptId: value.link_attempt_id,
        preset_handle: value.preset_handle, variant: value.variant }, signal);
      return structured(selectPresetOutputSchema.parse(output));
    } catch (error) { return serviceError(error, "PRESET"); }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_KLING_MOTION_CONTROL_VIDEO_TOOL_NAME, {
    title: "Generate one Kling Motion Control video", description: "Dispatches one paid, non-idempotent Motion Control generation for the exact linked owner attempt. This tool does not promise a cost cap. If the outcome is uncertain, do not retry; use GET-only reconciliation with its recovery id.",
    inputSchema: generateInputSchema, outputSchema: resultToolOutputSchema,
    annotations: { title: "Generate one Kling Motion Control video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    const parsed = generateInputSchema.safeParse(snapshot(input));
    if (!parsed.success) return unavailable("INVALID_REQUEST", "The explicit Motion Control generation request is invalid.");
    const value = parsed.data;
    const request = { model_id: MODEL_ID, reference_source: value.reference_source, image_handle: value.image_handle,
      ...(value.reference_source === "owned_video" ? { video_handle: value.video_handle! } : { preset_video_handle: value.preset_video_handle! }),
      parameters: { model_id: value.model_id, version: value.version, mode: value.mode, gen_type: value.gen_type,
        native_audio: value.native_audio, video_duration: value.video_duration }, ...(value.prompt === undefined ? {} : { prompt: value.prompt }) };
    try {
      const output = await options.generationService.generate({ attemptId: value.link_attempt_id, request }, signal);
      return structured(resultSchema.parse(output));
    }
    catch (error) { return serviceError(error, "GENERATION"); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_KLING_MOTION_CONTROL_VIDEO_TOOL_NAME, {
    title: "Reconcile Kling Motion Control (GET only)", description: "Reconciles an uncertain generation through GET-only owner history and result reads. It never resends or repeats generation.",
    inputSchema: reconcileInputSchema, outputSchema: resultToolOutputSchema,
    annotations: { title: "Reconcile Kling Motion Control (GET only)", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    const parsed = reconcileInputSchema.safeParse(snapshot(input));
    if (!parsed.success) return unavailable("INVALID_REQUEST", "The Motion Control reconciliation request is invalid.");
    try {
      const value = parsed.data;
      const output = await options.generationService.reconcile({ attemptId: value.link_attempt_id, recovery_id: value.recovery_id }, signal);
      return structured(resultSchema.parse(output));
    }
    catch (error) { return serviceError(error, "GENERATION"); }
  });

  server.registerTool(SYNTX_OWNER_LIST_KLING_MOTION_CONTROL_RECOVERIES_TOOL_NAME, {
    title: "List Kling Motion Control recoveries", description: "Lists safe process-local recovery summaries for this exact linked owner attempt. This read-only tool never retries a generation.",
    inputSchema: listRecoveriesInputSchema, outputSchema: recoveriesToolOutputSchema,
    annotations: { title: "List Kling Motion Control recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input): Promise<CallToolResult> => {
    const parsed = listRecoveriesInputSchema.safeParse(snapshot(input));
    if (!parsed.success) return unavailable("INVALID_REQUEST", "The Motion Control recovery-list request is invalid.");
    try {
      const value = parsed.data;
      return structured(recoveriesSchema.parse({ recoveries: await options.generationService.listRecoveries({ attemptId: value.link_attempt_id,
        ...(value.limit === undefined ? {} : { limit: value.limit }) }) }));
    } catch (error) { return serviceError(error, "GENERATION"); }
  });

  server.registerTool(SYNTX_OWNER_GET_KLING_MOTION_CONTROL_RESULT_PAGE_TOOL_NAME, {
    title: "Get Kling Motion Control result page", description: "Reads one page from the local completed-result cache; it performs no upstream request and does not generate.",
    inputSchema: resultPageInputSchema, outputSchema: resultToolOutputSchema,
    annotations: { title: "Get Kling Motion Control result page", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input): Promise<CallToolResult> => {
    const parsed = resultPageInputSchema.safeParse(snapshot(input));
    if (!parsed.success) return unavailable("INVALID_REQUEST", "The Motion Control result-page request is invalid.");
    const value = parsed.data;
    try {
      const output = await options.generationService.getResultPage({ attemptId: value.link_attempt_id,
        recovery_id: value.recovery_id, ...(value.offset === undefined ? {} : { offset: value.offset }) });
      return structured(resultSchema.parse(output));
    }
    catch (error) { return serviceError(error, "GENERATION"); }
  });
}

function snapshot(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return value;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string" || !descriptors[key as string] || !("value" in descriptors[key as string]!))) return null;
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) output[key] = descriptors[key]!.value;
    return output;
  } catch { return null; }
}

function wellFormed(value: string): boolean { return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value); }
function structured(value: unknown): CallToolResult { return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> }; }
function unavailable(code: string, message: string, extra: Record<string, unknown> = {}): CallToolResult {
  const output = unavailableSchema.parse({ status: "unavailable", code, message, ...extra });
  return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output, isError: true };
}

function serviceError(error: unknown, kind: "REFERENCE" | "PRESET" | "GENERATION"): CallToolResult {
  if (types.isProxy(error)) return unavailable("MOTION_CONTROL_UNAVAILABLE", "The Motion Control operation could not be completed safely.");
  if (kind === "REFERENCE" && error instanceof OwnerKlingMotionControlReferenceServiceError) {
    const code = readCode(error, REFERENCE_ERROR_CODES);
    return unavailable(code ?? "MOTION_CONTROL_UNAVAILABLE", code === "UPLOAD_OUTCOME_UNKNOWN" ? "The upload outcome is unknown; do not repeat it." : "The Motion Control image or video operation could not be completed safely.");
  }
  if (kind === "PRESET" && error instanceof OwnerKlingMotionControlPresetReferenceServiceError) {
    const code = readCode(error, PRESET_ERROR_CODES);
    return unavailable(code ?? "MOTION_CONTROL_UNAVAILABLE", "The Motion Control preset operation could not be completed safely.");
  }
  if (kind === "GENERATION" && error instanceof OwnerKlingMotionControlGenerationServiceError) {
    const code = readCode(error, ERROR_CODES), recoveryId = code === "OUTCOME_UNKNOWN" ? readRecoveryId(error) : undefined;
    const diagnosticDescriptor = Object.getOwnPropertyDescriptor(error, "diagnostic");
    const diagnostic = diagnosticDescriptor && "value" in diagnosticDescriptor ? diagnosticSchema.safeParse(diagnosticDescriptor.value) : undefined;
    return unavailable(code ?? "MOTION_CONTROL_UNAVAILABLE", code === "OUTCOME_UNKNOWN"
      ? "The generation may have been dispatched; do not retry. Reconcile with the same recovery id when supplied."
      : "The Motion Control generation or recovery operation could not be completed safely.",
    { ...(recoveryId ? { recovery_id: recoveryId } : {}), ...(diagnostic?.success ? { diagnostic: diagnostic.data } : {}) });
  }
  if (error instanceof OwnerKlingMotionControlParametersError) return unavailable("INVALID_PARAMETERS", "The Motion Control parameter tuple is invalid.");
  return unavailable("MOTION_CONTROL_UNAVAILABLE", "The Motion Control operation could not be completed safely.");
}

function readCode(error: object, allowlist: ReadonlySet<string>): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  return descriptor && "value" in descriptor && typeof descriptor.value === "string" && allowlist.has(descriptor.value) ? descriptor.value : undefined;
}
function readRecoveryId(error: object): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(error, "recovery_id");
  return descriptor && "value" in descriptor && typeof descriptor.value === "string" && RECOVERY_ID.test(descriptor.value) ? descriptor.value : undefined;
}
