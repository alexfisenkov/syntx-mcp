import { types } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { OwnerWan25I2vPreviewImagePolicyError, OWNER_WAN25_I2V_PREVIEW_IMAGE_POLICY } from "../application/owner-wan25-i2v-image-policy.js";
import { getOwnerWan25I2vGenerationParametersSource } from "../application/owner-wan25-i2v-generation-parameters.js";
import {
  OwnerWan25I2vGenerationService, OwnerWan25I2vGenerationServiceError, isOwnerWan25I2vGenerationService,
  type OwnerWan25I2vGenerationArtifact, type OwnerWan25I2vGenerationDiagnostic,
  type OwnerWan25I2vGenerationResult, type OwnerWan25I2vRecoveryListItem
} from "../application/owner-wan25-i2v-generation-service.js";
import {
  OwnerWan25I2vReferenceService, OwnerWan25I2vReferenceServiceError
} from "../application/owner-wan25-i2v-reference-service.js";

const MODEL_ID = "wan_25_i2v_preview" as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const IMAGE_HANDLE = /^wan25image_[0-9a-f-]{36}$/u;
const RECOVERY_ID = /^wan25_generation_recovery_[0-9a-f-]{36}$/u;
const MAX_COUNT = 10_000;
const MAX_PAGE_SIZE = 64;
const MAX_IMAGE_BASE64 = Math.ceil(OWNER_WAN25_I2V_PREVIEW_IMAGE_POLICY.max_file_size_bytes / 3) * 4;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const PORTABLE_FILENAME = /^(?!\.{1,2}$)(?!.*[. ]$)(?!.*[<>:"/\\|?*\p{Cc}\p{Cf}\p{Cs}])(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)).+$/iu;
const source = getOwnerWan25I2vGenerationParametersSource();
const attempt = z.string().regex(ATTEMPT).describe("Exact linked owner attempt ID.");
const imageMime = z.enum(OWNER_WAN25_I2V_PREVIEW_IMAGE_POLICY.source_mime_types);
const filename = z.string().min(1).max(255).regex(PORTABLE_FILENAME).refine((value) => value === value.trim());
const imageHandle = z.string().regex(IMAGE_HANDLE);
const recoveryId = z.string().regex(RECOVERY_ID);
const errorCode = z.enum([
  "INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "PROFILE_BINDING_MISMATCH",
  "MODEL_BINDING_MISMATCH", "PREFLIGHT_FAILED", "INTENT_ALREADY_CLAIMED", "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN",
  "RECOVERY_NOT_FOUND", "REQUEST_ABORTED", "UPLOAD_REJECTED", "UPLOAD_OUTCOME_UNKNOWN", "REFERENCE_UNAVAILABLE",
  "REFERENCE_EXPIRED", "CAPACITY_EXCEEDED", "OUTPUT_INVALID", "SERVICE_UNAVAILABLE"
]);
const diagnosticCode = z.enum([
  "PREFLIGHT_FAILED", "HISTORY_UNAVAILABLE", "HISTORY_INCOMPLETE", "HISTORY_UNVERIFIED", "OWNER_ACK_MISSING",
  "OWNER_ACK_AMBIGUOUS", "OWNER_ACK_MISMATCH", "BACKEND_ERROR_OBSERVED", "RESULT_GET_UNAVAILABLE", "RESULT_PENDING",
  "RESULT_UNVERIFIED", "RESULT_MODEL_ECHO_UNAVAILABLE", "RESULT_MODEL_ECHO_MISMATCH", "RESULT_URL_UNSAFE",
  "NO_VIDEO_OBSERVED", "ARTIFACT_LIMIT_EXCEEDED"
]);

const parameterInput = z.object({}).strict();
const imageInput = z.object({ link_attempt_id: attempt, model_id: z.literal(MODEL_ID), filename, mime_type: imageMime,
  content_base64: z.string().min(4).max(MAX_IMAGE_BASE64).regex(BASE64) }).strict();
const generateInput = z.object({ link_attempt_id: attempt, model_id: z.literal(MODEL_ID), image_handle: imageHandle,
  audio_handle: z.literal(null), prompt: z.string().max(1_500), resolution: z.enum(["480P", "720P", "1080P"]),
  aspect_ratio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"]), video_duration: z.union([z.literal(5), z.literal(10)]),
  prompt_extend: z.boolean(), seed: z.number().int().min(0).max(2_147_483_647).nullable() }).strict();
const reconcileInput = z.object({ link_attempt_id: attempt, recovery_id: recoveryId }).strict();
const recoveriesInput = z.object({ link_attempt_id: attempt, limit: z.number().int().min(1).max(128).optional() }).strict();
const resultPageInput = z.object({ link_attempt_id: attempt, recovery_id: recoveryId,
  offset: z.number().int().min(0).max(4_096).optional() }).strict();

const sourceOutput = z.object({
  status: z.enum(["ready", "unavailable"]), error_code: errorCode.nullable(), error_message: z.string().max(180).nullable(),
  model_id: z.literal(MODEL_ID).nullable(), public_catalog_version: z.string().max(160).nullable(),
  public_catalog_fetched_at: z.iso.datetime().nullable(), public_models_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u).nullable(),
  form_build_id: z.string().max(64).nullable(), form_module: z.string().max(120).nullable(), form_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u).nullable(),
  files_mention: z.literal(false).nullable(), resolution_values: z.array(z.enum(["480P", "720P", "1080P"])).length(3).nullable(),
  aspect_ratio_480p: z.array(z.enum(["16:9", "9:16", "1:1"])).length(3).nullable(),
  aspect_ratio_other: z.array(z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"])).length(5).nullable(),
  video_duration_values: z.array(z.union([z.literal(5), z.literal(10)])).length(2).nullable(), prompt_extend_explicit: z.boolean().nullable(),
  seed_min: z.number().int().nullable(), seed_max: z.number().int().nullable(), native_audio: z.literal(false).nullable(),
  input_audio_status: z.literal("OPTIONAL_UI_NOT_JOINED_TO_NATIVE_CONTEXT").nullable(),
  audio_integration_status: z.literal("NATIVE_AUDIO_CONTEXT_NOT_AVAILABLE").nullable(), shot_type: z.literal("single").nullable(),
  audio_setting: z.literal("auto").nullable(), reference_duration_setting: z.literal("OMITTED_FROM_SETTINGS").nullable(),
  cost_keys: z.tuple([z.literal("resolution"), z.literal("video_duration")]).nullable(),
  cost_projection_confidence: z.literal("PINNED_C396_METADATA_NOT_CURRENT_QUOTE").nullable(),
  current_quote: z.literal("UNKNOWN").nullable(), effective_defaults: z.literal("UNKNOWN").nullable(),
  image_mime_types: z.array(z.enum(OWNER_WAN25_I2V_PREVIEW_IMAGE_POLICY.source_mime_types)).length(5).nullable(),
  image_size_guard_bytes: z.number().int().nullable(), image_side_guard_min: z.number().int().nullable(), image_side_guard_max: z.number().int().nullable(),
  image_guard_semantics: z.literal("C396_CATALOG_LOCAL_GUARD_NOT_CURRENT_PROVIDER_LIMIT_OR_ACCEPTANCE").nullable(),
  provider_acceptance: z.literal("UNPROVEN").nullable(), dispatch_allowed: z.literal(false).nullable()
}).strict();

const imageOutput = z.object({ status: z.enum(["uploaded", "unavailable"]), error_code: errorCode.nullable(),
  error_message: z.string().max(180).nullable(), model_id: z.literal(MODEL_ID).nullable(), image_handle: imageHandle.nullable(),
  filename: z.string().max(255).nullable(), mime_type: z.enum(["image/jpeg", "image/png", "image/bmp", "image/webp"]).nullable(),
  size: z.number().int().min(1).nullable(), sha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  width: z.number().int().min(384).max(5_000).nullable(), height: z.number().int().min(384).max(5_000).nullable(),
  expires_in_seconds: z.literal(900).nullable(), generation_permit: z.literal(false).nullable() }).strict();
const diagnosticOutput = z.object({ post_started: z.boolean(), ack_known: z.boolean(),
  history_status: z.enum(["PENDING", "COMPLETE", "INCOMPLETE", "UNVERIFIED", "NOT_READ"]),
  owner_ack_status: z.enum(["MATCHED", "MISSING", "AMBIGUOUS", "MISMATCH", "NOT_READ"]),
  history_get_calls: z.number().int().min(0).max(MAX_COUNT), result_get_calls: z.number().int().min(0).max(MAX_COUNT),
  backend_error_observed: z.boolean(), pending_object_indices: z.array(z.number().int().min(0).max(63)).max(64), gaps: z.array(diagnosticCode).max(32) }).strict();
const artifactOutput = z.object({ object_index: z.number().int().min(0).max(4_096), message_object_id: z.string().min(1).max(160),
  object_type: z.literal("video"), object_url: z.string().url().max(4_096).refine(isSafeUploadReferenceUrl),
  mime_type: z.enum(["video/mp4", "video/webm"]).nullable(), message_id: z.string().min(1).max(160),
  chat_uuid: z.string().min(1).max(160), model_id: z.literal(MODEL_ID) }).strict();
const generationOutput = z.object({ status: z.enum(["completed", "unavailable"]), error_code: errorCode.nullable(),
  error_message: z.string().max(180).nullable(), status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY").nullable(),
  backend_acceptance: z.literal("UNPROVEN").nullable(), provider_terminal_status: z.literal("UNPROVEN").nullable(),
  cost_cap_enforced: z.literal(false).nullable(), recovery_id: recoveryId.nullable(), model_id: z.literal(MODEL_ID).nullable(),
  observed_artifact_count: z.number().int().min(0).max(MAX_COUNT).nullable(), offset: z.number().int().min(0).max(MAX_COUNT).nullable(),
  page_size: z.number().int().min(0).max(MAX_PAGE_SIZE).nullable(), artifacts: z.array(artifactOutput).max(MAX_PAGE_SIZE).nullable(),
  has_more: z.boolean().nullable(), next_offset: z.number().int().min(0).max(MAX_COUNT).nullable(), diagnostic: diagnosticOutput.nullable() }).strict();
const recoveryItemOutput = z.object({ recovery_id: recoveryId, created_at: z.iso.datetime(), status: z.enum(["outcome_unknown", "completed"]),
  model_id: z.literal(MODEL_ID), observed_artifact_count: z.number().int().min(0).max(MAX_COUNT) }).strict();
const recoveriesOutput = z.object({ status: z.enum(["listed", "unavailable"]), error_code: errorCode.nullable(),
  error_message: z.string().max(180).nullable(), recoveries: z.array(recoveryItemOutput).max(128).nullable() }).strict();

export const SYNTX_OWNER_GET_WAN25_I2V_PREVIEW_PARAMETERS_TOOL_NAME = "syntx_owner_get_wan25_i2v_preview_parameters" as const;
export const SYNTX_OWNER_UPLOAD_WAN25_I2V_PREVIEW_IMAGE_TOOL_NAME = "syntx_owner_upload_wan25_i2v_preview_image" as const;
export const SYNTX_OWNER_GENERATE_WAN25_I2V_PREVIEW_VIDEO_TOOL_NAME = "syntx_owner_generate_wan25_i2v_preview_video" as const;
export const SYNTX_OWNER_RECONCILE_WAN25_I2V_PREVIEW_VIDEO_TOOL_NAME = "syntx_owner_reconcile_wan25_i2v_preview_video" as const;
export const SYNTX_OWNER_LIST_WAN25_I2V_PREVIEW_RECOVERIES_TOOL_NAME = "syntx_owner_list_wan25_i2v_preview_recoveries" as const;
export const SYNTX_OWNER_GET_WAN25_I2V_PREVIEW_RESULT_PAGE_TOOL_NAME = "syntx_owner_get_wan25_i2v_preview_result_page" as const;
export const OWNER_WAN25_I2V_PREVIEW_TOOL_NAMES = Object.freeze([
  SYNTX_OWNER_GET_WAN25_I2V_PREVIEW_PARAMETERS_TOOL_NAME, SYNTX_OWNER_UPLOAD_WAN25_I2V_PREVIEW_IMAGE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_WAN25_I2V_PREVIEW_VIDEO_TOOL_NAME, SYNTX_OWNER_RECONCILE_WAN25_I2V_PREVIEW_VIDEO_TOOL_NAME,
  SYNTX_OWNER_LIST_WAN25_I2V_PREVIEW_RECOVERIES_TOOL_NAME, SYNTX_OWNER_GET_WAN25_I2V_PREVIEW_RESULT_PAGE_TOOL_NAME
] as const);

export interface OwnerWan25I2vPreviewServiceComposition {
  readonly referenceService: Pick<OwnerWan25I2vReferenceService, "uploadImage" | "invalidateAttempt" | "close">;
  readonly generationService: Pick<OwnerWan25I2vGenerationService,
    "generate" | "reconcile" | "listRecoveries" | "getResultPage" | "invalidateAttempt" | "close">;
}

const errorMessages: Record<z.infer<typeof errorCode>, string> = {
  INVALID_REQUEST: "The WAN 2.5 I2V preview request is invalid.", SERVICE_CLOSED: "The WAN 2.5 I2V preview service is closed.",
  SERVICE_BUSY: "The WAN 2.5 I2V preview service is busy.", PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.",
  PROFILE_BINDING_MISMATCH: "The owner reference binding is unavailable.", MODEL_BINDING_MISMATCH: "The WAN 2.5 I2V model binding is unavailable.",
  PREFLIGHT_FAILED: "Current account or model access could not be verified.", INTENT_ALREADY_CLAIMED: "This WAN 2.5 I2V intent already has an unresolved outcome.",
  PRE_DISPATCH_FAILED: "The request was not safely dispatched.", OUTCOME_UNKNOWN: "Generation may have been dispatched; reconcile the recovery and do not retry.",
  RECOVERY_NOT_FOUND: "The recovery is unavailable or expired.", REQUEST_ABORTED: "The WAN 2.5 I2V request was aborted.",
  UPLOAD_REJECTED: "The image upload was rejected.", UPLOAD_OUTCOME_UNKNOWN: "The upload outcome is unknown; do not repeat the upload.",
  REFERENCE_UNAVAILABLE: "The owner-bound image reference is unavailable.", REFERENCE_EXPIRED: "The owner-bound image reference expired.",
  CAPACITY_EXCEEDED: "The local WAN 2.5 I2V preview capacity was reached.", OUTPUT_INVALID: "The service returned an invalid structured response.",
  SERVICE_UNAVAILABLE: "The WAN 2.5 I2V preview service is unavailable."
};

export function registerSyntxOwnerWan25I2vPreviewTools(server: McpServer, input: unknown): void {
  const composition = exactComposition(input);
  server.registerTool(SYNTX_OWNER_GET_WAN25_I2V_PREVIEW_PARAMETERS_TOOL_NAME, {
    title: "Get WAN 2.5 I2V preview parameters",
    description: "Returns pinned C396 preview controls and local guard semantics. Defaults, current quote, provider limits and acceptance remain unproven.",
    inputSchema: parameterInput, outputSchema: sourceOutput,
    annotations: { title: "Get WAN 2.5 I2V preview parameters", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async () => success(sourceOutput, projectParameters()));

  server.registerTool(SYNTX_OWNER_UPLOAD_WAN25_I2V_PREVIEW_IMAGE_TOOL_NAME, {
    title: "Upload WAN 2.5 I2V preview image",
    description: "Uploads one local-guarded image for the exact linked owner. Returns a private handle, never the uploaded URL.",
    inputSchema: imageInput, outputSchema: imageOutput,
    annotations: { title: "Upload WAN 2.5 I2V preview image", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (raw, { signal }) => {
    const parsed = imageInput.safeParse(snapshotFlat(raw)); if (!parsed.success) return unavailable(imageOutput, "INVALID_REQUEST");
    const v = parsed.data;
    try {
      const receipt = await composition.referenceService.uploadImage({ attemptId: v.link_attempt_id, model_id: v.model_id,
        filename: v.filename, mime_type: v.mime_type, content_base64: v.content_base64 }, signal);
      return success(imageOutput, { status: "uploaded", error_code: null, error_message: null, model_id: receipt.model_id,
        image_handle: receipt.image_handle, filename: receipt.filename, mime_type: receipt.mime_type, size: receipt.size,
        sha256: receipt.sha256, width: receipt.width, height: receipt.height, expires_in_seconds: receipt.expires_in_seconds,
        generation_permit: false });
    } catch (error) { return unavailable(imageOutput, referenceErrorCode(error)); }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_WAN25_I2V_PREVIEW_VIDEO_TOOL_NAME, {
    title: "Generate WAN 2.5 I2V preview video",
    description: "Starts one owner generation and may incur a charge. On an unknown outcome, reconcile its recovery; never retry generation.",
    inputSchema: generateInput, outputSchema: generationOutput,
    annotations: { title: "Generate WAN 2.5 I2V preview video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (raw, { signal }) => {
    const parsed = generateInput.safeParse(snapshotFlat(raw)); if (!parsed.success) return unavailable(generationOutput, "INVALID_REQUEST");
    const v = parsed.data;
    try {
      const result = await composition.generationService.generate({ attemptId: v.link_attempt_id, request: { model_id: v.model_id,
        image_handle: v.image_handle, audio_handle: null, prompt: v.prompt, parameters: { resolution: v.resolution,
          aspect_ratio: v.aspect_ratio, video_duration: v.video_duration, prompt_extend: v.prompt_extend, seed: v.seed } } }, signal);
      return success(generationOutput, projectResult(result));
    } catch (error) { return generationFailure(generationOutput, error); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_WAN25_I2V_PREVIEW_VIDEO_TOOL_NAME, {
    title: "Reconcile WAN 2.5 I2V preview generation",
    description: "Performs GET-only recovery for one WAN25 preview recovery ID. It never creates a chat or repeats generation.",
    inputSchema: reconcileInput, outputSchema: generationOutput,
    annotations: { title: "Reconcile WAN 2.5 I2V preview generation", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (raw, { signal }) => {
    const parsed = reconcileInput.safeParse(snapshotFlat(raw)); if (!parsed.success) return unavailable(generationOutput, "INVALID_REQUEST");
    try { return success(generationOutput, projectResult(await composition.generationService.reconcile({
      attemptId: parsed.data.link_attempt_id, recovery_id: parsed.data.recovery_id }, signal))); }
    catch (error) { return generationFailure(generationOutput, error); }
  });

  server.registerTool(SYNTX_OWNER_LIST_WAN25_I2V_PREVIEW_RECOVERIES_TOOL_NAME, {
    title: "List WAN 2.5 I2V preview recoveries",
    description: "Lists bounded recovery summaries for the linked owner without result URLs.",
    inputSchema: recoveriesInput, outputSchema: recoveriesOutput,
    annotations: { title: "List WAN 2.5 I2V preview recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (raw) => {
    const parsed = recoveriesInput.safeParse(snapshotFlat(raw)); if (!parsed.success) return unavailable(recoveriesOutput, "INVALID_REQUEST");
    try {
      const records = await composition.generationService.listRecoveries({ attemptId: parsed.data.link_attempt_id,
        ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }) });
      return success(recoveriesOutput, { status: "listed", error_code: null, error_message: null, recoveries: records.map(projectRecovery) });
    } catch (error) { return unavailable(recoveriesOutput, generationErrorCode(error)); }
  });

  server.registerTool(SYNTX_OWNER_GET_WAN25_I2V_PREVIEW_RESULT_PAGE_TOOL_NAME, {
    title: "Get WAN 2.5 I2V preview result page",
    description: "Reads one bounded page of already observed video artifacts. Local availability does not establish provider terminal success.",
    inputSchema: resultPageInput, outputSchema: generationOutput,
    annotations: { title: "Get WAN 2.5 I2V preview result page", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (raw) => {
    const parsed = resultPageInput.safeParse(snapshotFlat(raw)); if (!parsed.success) return unavailable(generationOutput, "INVALID_REQUEST");
    try { return success(generationOutput, projectResult(await composition.generationService.getResultPage({
      attemptId: parsed.data.link_attempt_id, recovery_id: parsed.data.recovery_id,
      ...(parsed.data.offset === undefined ? {} : { offset: parsed.data.offset }) }))); }
    catch (error) { return generationFailure(generationOutput, error); }
  });
}

function projectParameters(): Record<string, unknown> {
  const s = source.source_controls, pins = source.source_pins, image = OWNER_WAN25_I2V_PREVIEW_IMAGE_POLICY;
  return { status: "ready", error_code: null, error_message: null, model_id: MODEL_ID,
    public_catalog_version: pins.public_catalog_version, public_catalog_fetched_at: pins.public_catalog_fetched_at,
    public_models_sha256: pins.public_models_sha256, form_build_id: pins.form_build_id, form_module: pins.form_module,
    form_sha256: pins.form_sha256, files_mention: false, resolution_values: s.resolution,
    aspect_ratio_480p: s.aspect_ratio_by_resolution["480P"], aspect_ratio_other: s.aspect_ratio_by_resolution.other,
    video_duration_values: s.video_duration.values, prompt_extend_explicit: true, seed_min: s.seed.minimum, seed_max: s.seed.maximum,
    native_audio: false, input_audio_status: "OPTIONAL_UI_NOT_JOINED_TO_NATIVE_CONTEXT",
    audio_integration_status: "NATIVE_AUDIO_CONTEXT_NOT_AVAILABLE",
    shot_type: s.fixed_fields.shot_type, audio_setting: s.fixed_fields.audio_setting, reference_duration_setting: s.reference_duration,
    cost_keys: source.cost_projection.keys, cost_projection_confidence: source.cost_projection.source,
    current_quote: source.cost_projection.current_quote, effective_defaults: source.effective_defaults,
    image_mime_types: image.source_mime_types, image_size_guard_bytes: image.max_file_size_bytes,
    image_side_guard_min: image.min_side, image_side_guard_max: image.max_side,
    image_guard_semantics: image.bounds_policy, provider_acceptance: source.provider_acceptance, dispatch_allowed: false };
}

function projectResult(result: OwnerWan25I2vGenerationResult): Record<string, unknown> {
  if (result.model_id !== MODEL_ID || !RECOVERY_ID.test(result.recovery_id) ||
      result.status_semantics !== "LOCAL_OBSERVED_AVAILABILITY_ONLY" || result.backend_acceptance !== "UNPROVEN" ||
      result.provider_terminal_status !== "UNPROVEN" || result.cost_cap_enforced !== false) throw new Error("OUTPUT_INVALID");
  return { status: result.status, error_code: null, error_message: null, status_semantics: result.status_semantics,
    backend_acceptance: result.backend_acceptance, provider_terminal_status: result.provider_terminal_status,
    cost_cap_enforced: result.cost_cap_enforced, recovery_id: result.recovery_id, model_id: result.model_id,
    observed_artifact_count: result.observed_artifact_count, offset: result.offset, page_size: result.page_size,
    artifacts: result.artifacts.map(projectArtifact), has_more: result.has_more, next_offset: result.next_offset,
    diagnostic: projectDiagnostic(result.diagnostic) };
}
function projectArtifact(value: OwnerWan25I2vGenerationArtifact): Record<string, unknown> {
  if (value.model_id !== MODEL_ID || value.object_type !== "video" || !isSafeUploadReferenceUrl(value.object_url) ||
      !/\.(?:mp4|webm)$/iu.test(new URL(value.object_url).pathname)) throw new Error("OUTPUT_INVALID");
  return { object_index: value.object_index, message_object_id: value.message_object_id, object_type: value.object_type,
    object_url: value.object_url, mime_type: value.mime_type, message_id: value.message_id,
    chat_uuid: value.chat_uuid, model_id: value.model_id };
}
function projectDiagnostic(value: OwnerWan25I2vGenerationDiagnostic): Record<string, unknown> {
  return { post_started: value.post_started, ack_known: value.ack_known, history_status: value.history_status,
    owner_ack_status: value.owner_ack_status, history_get_calls: value.history_get_calls, result_get_calls: value.result_get_calls,
    backend_error_observed: value.backend_error_observed, pending_object_indices: value.pending_object_indices, gaps: value.gaps };
}
function projectRecovery(value: OwnerWan25I2vRecoveryListItem): Record<string, unknown> {
  return { recovery_id: value.recovery_id, created_at: value.created_at, status: value.status,
    model_id: MODEL_ID, observed_artifact_count: value.observed_artifact_count };
}
function success<T extends z.ZodObject<z.ZodRawShape>>(schema: T, value: unknown): CallToolResult {
  const parsed = schema.safeParse(value); if (!parsed.success) return unavailable(schema, "OUTPUT_INVALID");
  const data = parsed.data as Record<string, unknown>;
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}
function unavailable<T extends z.ZodObject<z.ZodRawShape>>(schema: T, codeInput: string, extras: Readonly<Record<string, unknown>> = {}): CallToolResult {
  const code = isErrorCode(codeInput) ? codeInput : "SERVICE_UNAVAILABLE";
  const fields = Object.fromEntries(Object.keys(schema.shape).map((key) => [key, null])) as Record<string, unknown>;
  const parsed = schema.safeParse({ ...fields, status: "unavailable", error_code: code, error_message: errorMessages[code], ...safeErrorExtras(extras) });
  if (!parsed.success) throw new Error("WAN25_I2V_PREVIEW_ERROR_OUTPUT_SCHEMA_INVALID");
  const data = parsed.data as Record<string, unknown>;
  return { isError: true, content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}
function referenceErrorCode(error: unknown): string {
  if (error instanceof OwnerWan25I2vPreviewImagePolicyError) return error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED" ? "CAPACITY_EXCEEDED" : "INVALID_REQUEST";
  return error instanceof OwnerWan25I2vReferenceServiceError && isErrorCode(error.code) ? error.code : "REFERENCE_UNAVAILABLE";
}
function generationErrorCode(error: unknown): string {
  return error instanceof OwnerWan25I2vGenerationServiceError && isErrorCode(error.code) ? error.code : "SERVICE_UNAVAILABLE";
}
function generationFailure(schema: typeof generationOutput, error: unknown): CallToolResult {
  const code = generationErrorCode(error), extra: Record<string, unknown> = {};
  if (code === "OUTCOME_UNKNOWN" && error instanceof OwnerWan25I2vGenerationServiceError) {
    if (error.recovery_id && RECOVERY_ID.test(error.recovery_id)) extra.recovery_id = error.recovery_id;
    if (error.diagnostic) { try { extra.diagnostic = projectDiagnostic(error.diagnostic); } catch { /* fail closed */ } }
  }
  return unavailable(schema, code, extra);
}
function safeErrorExtras(input: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  if (input.recovery_id !== undefined && typeof input.recovery_id === "string" && RECOVERY_ID.test(input.recovery_id)) extra.recovery_id = input.recovery_id;
  if (input.diagnostic !== undefined) { try { extra.diagnostic = diagnosticOutput.parse(input.diagnostic); } catch { /* omit malformed diagnostic */ } }
  return extra;
}
function isErrorCode(value: unknown): value is z.infer<typeof errorCode> { return errorCode.safeParse(value).success; }
function exactComposition(value: unknown): OwnerWan25I2vPreviewServiceComposition {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new Error("OWNER_WAN25_I2V_PREVIEW_COMPOSITION_INVALID");
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    const expected = ["referenceService", "generationService"];
    if (prototype !== Object.prototype || keys.length !== expected.length ||
        keys.some((key) => typeof key !== "string" || !expected.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true) ||
        !(descriptors.referenceService!.value instanceof OwnerWan25I2vReferenceService) ||
        !isOwnerWan25I2vGenerationService(descriptors.generationService!.value)) throw new Error();
    const references = descriptors.referenceService!.value as OwnerWan25I2vReferenceService;
    if (Object.getPrototypeOf(references) !== OwnerWan25I2vReferenceService.prototype || !Object.isFrozen(references)) throw new Error();
    return Object.freeze({ referenceService: references, generationService: descriptors.generationService!.value as OwnerWan25I2vGenerationService });
  } catch { throw new Error("OWNER_WAN25_I2V_PREVIEW_COMPOSITION_INVALID"); }
}
function snapshotFlat(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), output = Object.create(null) as Record<string, unknown>;
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string") return undefined;
      const descriptor = descriptors[key]; if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      const item = descriptor.value; if (item !== null && !["string", "number", "boolean"].includes(typeof item)) return undefined;
      Object.defineProperty(output, key, { value: item, enumerable: true, writable: true, configurable: true });
    }
    return output;
  } catch { return undefined; }
}
