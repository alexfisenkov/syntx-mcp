import { types } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import {
  OWNER_WAN26_I2V_REFERENCE_LIMITS,
  OwnerWan26I2vReferenceService,
  OwnerWan26I2vReferenceServiceError
} from "../application/owner-wan26-i2v-reference-service.js";
import {
  OWNER_WAN26_I2V_IMAGE_POLICY
} from "../application/owner-wan26-i2v-image-policy.js";
import {
  getOwnerWan26I2vGenerationParametersSource,
  type OwnerWan26I2vGenerationModelId
} from "../application/owner-wan26-i2v-generation-parameters.js";
import {
  OwnerWan26I2vGenerationService,
  OwnerWan26I2vGenerationServiceError,
  isOwnerWan26I2vGenerationService,
  type OwnerWan26I2vGenerationArtifact,
  type OwnerWan26I2vGenerationDiagnostic,
  type OwnerWan26I2vGenerationResult,
  type OwnerWan26I2vRecoveryListItem
} from "../application/owner-wan26-i2v-generation-service.js";

const MODEL_IDS = Object.freeze(["wan_26_i2v", "wan_26_i2v_flash"] as const);
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const IMAGE_HANDLE = /^wan26image_[0-9a-f-]{36}$/u;
const AUDIO_HANDLE = /^wan26audio_[0-9a-f-]{36}$/u;
const RECOVERY_ID = /^wan26_generation_recovery_[0-9a-f-]{36}$/u;
const MAX_RESULTS = 4096;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const PORTABLE_FILENAME = /^(?!\.{1,2}$)(?!.*[. ]$)(?!.*[<>:"/\\|?*\p{Cc}\p{Cf}\p{Cs}])(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)).+$/iu;
const source = getOwnerWan26I2vGenerationParametersSource();
const attempt = z.string().regex(ATTEMPT).describe("Exact linked owner attempt ID.");
const modelId = z.enum(MODEL_IDS);
const imageMime = z.enum(OWNER_WAN26_I2V_IMAGE_POLICY.source_mime_types);
const audioMime = z.enum(["audio/mp3", "audio/mpeg", "audio/wav", "audio/x-wav"]);
const filename = z.string().min(1).max(255).regex(PORTABLE_FILENAME).refine((value) => value === value.trim());
const imageHandle = z.string().regex(IMAGE_HANDLE);
const audioHandle = z.string().regex(AUDIO_HANDLE);
const recoveryId = z.string().regex(RECOVERY_ID);
const sourceSha = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const errorCode = z.enum([
  "INVALID_REQUEST", "PRINCIPAL_NOT_LINKED", "PROFILE_BINDING_MISMATCH", "SERVICE_CLOSED", "SERVICE_BUSY",
  "CAPACITY_EXCEEDED", "REQUEST_ABORTED", "UPLOAD_REJECTED", "UPLOAD_OUTCOME_UNKNOWN", "REFERENCE_UNAVAILABLE",
  "REFERENCE_EXPIRED", "MODEL_BINDING_MISMATCH", "PREFLIGHT_FAILED", "INTENT_ALREADY_CLAIMED",
  "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND", "OUTPUT_INVALID", "SERVICE_UNAVAILABLE"
]);
const diagnosticCode = z.enum([
  "ACCOUNT_READ_UNAVAILABLE", "ACCOUNT_STATUS_STALE", "MODEL_ACCESS_UNAVAILABLE", "MODEL_ACCESS_STALE",
  "HISTORY_UNAVAILABLE", "HISTORY_INCOMPLETE", "HISTORY_UNVERIFIED", "OWNER_ACK_MISSING", "OWNER_ACK_AMBIGUOUS",
  "OWNER_ACK_MISMATCH", "BACKEND_ERROR_OBSERVED", "RESULT_GET_UNAVAILABLE", "RESULT_PENDING", "RESULT_UNVERIFIED",
  "RESULT_MODEL_ECHO_UNAVAILABLE", "RESULT_MODEL_ECHO_MISMATCH", "RESULT_URL_UNSAFE", "NO_VIDEO_OBSERVED",
  "ARTIFACT_LIMIT_EXCEEDED"
]);

const parameterInput = z.object({}).strict();
const imageInput = z.object({ link_attempt_id: attempt, model_id: modelId, filename, mime_type: imageMime,
  content_base64: z.string().min(4).max(OWNER_WAN26_I2V_REFERENCE_LIMITS.image_max_base64_chars).regex(BASE64) }).strict();
const audioInput = z.object({ link_attempt_id: attempt, model_id: modelId, filename, mime_type: audioMime,
  content_base64: z.string().min(4).max(OWNER_WAN26_I2V_REFERENCE_LIMITS.audio_max_base64_chars).regex(BASE64) }).strict();
const generateInput = z.object({ link_attempt_id: attempt, model_id: modelId, image_handle: imageHandle,
  audio_handle: audioHandle.nullable(), prompt: z.string().max(1_500), resolution: z.enum(["720P", "1080P"]),
  aspect_ratio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"]), video_duration: z.number().int().min(2).max(15),
  prompt_extend: z.boolean(), seed: z.number().int().min(0).max(2_147_483_647).nullable(), native_audio: z.boolean() }).strict();
const reconcileInput = z.object({ link_attempt_id: attempt, recovery_id: recoveryId }).strict();
const recoveriesInput = z.object({ link_attempt_id: attempt, limit: z.number().int().min(1).max(128).optional() }).strict();
const resultPageInput = z.object({ link_attempt_id: attempt, recovery_id: recoveryId,
  offset: z.number().int().min(0).max(MAX_RESULTS).optional() }).strict();

const sourceOutput = z.object({
  status: z.enum(["ready", "unavailable"]), error_code: errorCode.nullable(), error_message: z.string().max(180).nullable(),
  model_ids: z.array(modelId).length(2).nullable(), public_catalog_version: z.string().max(160).nullable(),
  public_catalog_fetched_at: z.iso.datetime().nullable(), public_models_sha256: sourceSha.nullable(), files_mention: z.boolean().nullable(),
  resolution_values: z.array(z.enum(["720P", "1080P"])).length(2).nullable(),
  aspect_ratio_values: z.array(z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"])).length(5).nullable(),
  video_duration_min: z.number().int().nullable(), video_duration_max: z.number().int().nullable(),
  prompt_extend_explicit: z.boolean().nullable(), seed_min: z.number().int().nullable(), seed_max: z.number().int().nullable(),
  regular_native_audio_policy: z.literal("FIXED_FALSE").nullable(), flash_native_audio_policy: z.literal("EXPLICIT_BOOLEAN").nullable(),
  shot_type: z.literal("single").nullable(), audio_setting: z.literal("auto").nullable(),
  reference_duration_setting: z.literal("OMITTED_FROM_FINAL_SETTINGS").nullable(),
  regular_cost_keys: z.tuple([z.literal("resolution"), z.literal("video_duration")]).nullable(),
  flash_cost_keys: z.tuple([z.literal("resolution"), z.literal("video_duration"), z.literal("native_audio")]).nullable(),
  cost_projection_confidence: z.literal("PINNED_C396_METADATA_NOT_CURRENT_QUOTE").nullable(),
  effective_defaults: z.literal("UNKNOWN").nullable(), current_quote: z.literal("UNKNOWN").nullable(),
  provider_acceptance: z.literal("UNPROVEN").nullable(), dispatch_allowed: z.literal(false).nullable()
}).strict();

const imageUploadOutput = z.object({
  status: z.enum(["uploaded", "unavailable"]), error_code: errorCode.nullable(), error_message: z.string().max(180).nullable(),
  model_id: modelId.nullable(), image_handle: imageHandle.nullable(), filename: z.string().max(255).nullable(),
  mime_type: z.enum(["image/jpeg", "image/png", "image/bmp", "image/webp"]).nullable(), size: z.number().int().min(1).nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(), width: z.number().int().min(384).max(5_000).nullable(),
  height: z.number().int().min(384).max(5_000).nullable(), expires_in_seconds: z.literal(900).nullable(), generation_permit: z.literal(false).nullable()
}).strict();
const audioUploadOutput = z.object({
  status: z.enum(["uploaded", "unavailable"]), error_code: errorCode.nullable(), error_message: z.string().max(180).nullable(),
  model_id: modelId.nullable(), audio_handle: audioHandle.nullable(), filename: z.string().max(255).nullable(),
  mime_type: z.enum(["audio/mpeg", "audio/wav"]).nullable(), size: z.number().int().min(1).nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(), duration_seconds: z.number().finite().min(3).max(30).nullable(),
  expires_in_seconds: z.literal(900).nullable(), generation_permit: z.literal(false).nullable()
}).strict();

const diagnosticOutput = z.object({
  post_started: z.boolean(), ack_known: z.boolean(),
  history_status: z.enum(["PENDING", "COMPLETE", "INCOMPLETE", "UNVERIFIED", "NOT_READ"]),
  owner_ack_status: z.enum(["MATCHED", "MISSING", "AMBIGUOUS", "MISMATCH", "NOT_READ"]),
  history_get_calls: z.number().int().min(0).max(10_000), result_get_calls: z.number().int().min(0).max(10_000),
  backend_error_observed: z.boolean(), pending_object_indices: z.array(z.number().int().min(0).max(63)).max(64),
  gaps: z.array(diagnosticCode).max(32)
}).strict();
const artifactOutput = z.object({
  object_index: z.number().int().min(0).max(MAX_RESULTS), message_object_id: z.string().min(1).max(160),
  object_type: z.literal("video"), object_url: z.string().url().max(4_096).refine(isSafeUploadReferenceUrl),
  mime_type: z.enum(["video/mp4", "video/webm"]).nullable(), message_id: z.string().min(1).max(160),
  chat_uuid: z.string().min(1).max(160), model_id: modelId
}).strict();
const generationOutput = z.object({
  status: z.enum(["completed", "unavailable"]), error_code: errorCode.nullable(), error_message: z.string().max(180).nullable(),
  status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY").nullable(), backend_acceptance: z.literal("UNPROVEN").nullable(),
  provider_terminal_status: z.literal("UNPROVEN").nullable(), cost_cap_enforced: z.literal(false).nullable(),
  recovery_id: recoveryId.nullable(), model_id: modelId.nullable(), observed_artifact_count: z.number().int().min(0).max(MAX_RESULTS).nullable(),
  offset: z.number().int().min(0).max(MAX_RESULTS).nullable(), page_size: z.number().int().min(0).max(64).nullable(),
  artifacts: z.array(artifactOutput).max(64).nullable(), has_more: z.boolean().nullable(),
  next_offset: z.number().int().min(0).max(MAX_RESULTS).nullable(), diagnostic: diagnosticOutput.nullable()
}).strict();
const recoveryItemOutput = z.object({ recovery_id: recoveryId, created_at: z.iso.datetime(), status: z.enum(["outcome_unknown", "completed"]),
  model_id: modelId, observed_artifact_count: z.number().int().min(0).max(MAX_RESULTS) }).strict();
const recoveriesOutput = z.object({
  status: z.enum(["listed", "unavailable"]), error_code: errorCode.nullable(), error_message: z.string().max(180).nullable(),
  recoveries: z.array(recoveryItemOutput).max(128).nullable()
}).strict();

export const SYNTX_OWNER_GET_WAN26_I2V_PARAMETERS_TOOL_NAME = "syntx_owner_get_wan26_i2v_parameters" as const;
export const SYNTX_OWNER_UPLOAD_WAN26_I2V_IMAGE_TOOL_NAME = "syntx_owner_upload_wan26_i2v_image" as const;
export const SYNTX_OWNER_UPLOAD_WAN26_I2V_AUDIO_TOOL_NAME = "syntx_owner_upload_wan26_i2v_audio" as const;
export const SYNTX_OWNER_GENERATE_WAN26_I2V_VIDEO_TOOL_NAME = "syntx_owner_generate_wan26_i2v_video" as const;
export const SYNTX_OWNER_RECONCILE_WAN26_I2V_VIDEO_TOOL_NAME = "syntx_owner_reconcile_wan26_i2v_video" as const;
export const SYNTX_OWNER_LIST_WAN26_I2V_RECOVERIES_TOOL_NAME = "syntx_owner_list_wan26_i2v_recoveries" as const;
export const SYNTX_OWNER_GET_WAN26_I2V_RESULT_PAGE_TOOL_NAME = "syntx_owner_get_wan26_i2v_result_page" as const;
export const OWNER_WAN26_I2V_TOOL_NAMES = Object.freeze([
  SYNTX_OWNER_GET_WAN26_I2V_PARAMETERS_TOOL_NAME, SYNTX_OWNER_UPLOAD_WAN26_I2V_IMAGE_TOOL_NAME,
  SYNTX_OWNER_UPLOAD_WAN26_I2V_AUDIO_TOOL_NAME, SYNTX_OWNER_GENERATE_WAN26_I2V_VIDEO_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_WAN26_I2V_VIDEO_TOOL_NAME, SYNTX_OWNER_LIST_WAN26_I2V_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_GET_WAN26_I2V_RESULT_PAGE_TOOL_NAME
] as const);

export interface OwnerWan26I2vServiceComposition {
  readonly referenceService: Pick<OwnerWan26I2vReferenceService, "uploadImage" | "uploadAudio" | "invalidateAttempt" | "close">;
  readonly generationService: Pick<OwnerWan26I2vGenerationService,
    "generate" | "reconcile" | "listRecoveries" | "getResultPage" | "invalidateAttempt" | "close">;
}

const errorMessages: Record<z.infer<typeof errorCode>, string> = {
  INVALID_REQUEST: "The WAN 2.6 I2V request is invalid.",
  PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.",
  PROFILE_BINDING_MISMATCH: "The owner reference binding is unavailable.",
  SERVICE_CLOSED: "The WAN 2.6 I2V service is closed.", SERVICE_BUSY: "The WAN 2.6 I2V service is busy.",
  CAPACITY_EXCEEDED: "The WAN 2.6 I2V service reached its local capacity.", REQUEST_ABORTED: "The WAN 2.6 I2V request was aborted.",
  UPLOAD_REJECTED: "The WAN 2.6 I2V upload was rejected.", UPLOAD_OUTCOME_UNKNOWN: "The upload outcome is unknown; do not repeat the upload.",
  REFERENCE_UNAVAILABLE: "The owner-bound WAN 2.6 I2V reference is unavailable.", REFERENCE_EXPIRED: "The owner-bound WAN 2.6 I2V reference expired.",
  MODEL_BINDING_MISMATCH: "The WAN 2.6 I2V model binding is unavailable.", PREFLIGHT_FAILED: "Current account or model access could not be verified.",
  INTENT_ALREADY_CLAIMED: "This WAN 2.6 I2V intent already has an unresolved outcome.",
  PRE_DISPATCH_FAILED: "The request was not safely dispatched.",
  OUTCOME_UNKNOWN: "Generation may have been dispatched; reconcile its recovery and never retry generation.",
  RECOVERY_NOT_FOUND: "The recovery is unavailable or expired.", OUTPUT_INVALID: "The service returned an invalid structured response.",
  SERVICE_UNAVAILABLE: "The WAN 2.6 I2V service is unavailable."
};

export function registerSyntxOwnerWan26I2vTools(server: McpServer, input: unknown): void {
  const composition = exactComposition(input);

  server.registerTool(SYNTX_OWNER_GET_WAN26_I2V_PARAMETERS_TOOL_NAME, {
    title: "Get WAN 2.6 I2V parameters",
    description: "Returns the pinned C396 WAN26 source snapshot and explicit controls. Defaults, quote and provider acceptance remain unproven.",
    inputSchema: parameterInput, outputSchema: sourceOutput,
    annotations: { title: "Get WAN 2.6 I2V parameters", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async () => success(sourceOutput, projectParameters()));

  server.registerTool(SYNTX_OWNER_UPLOAD_WAN26_I2V_IMAGE_TOOL_NAME, {
    title: "Upload WAN 2.6 I2V image reference",
    description: "Uploads one bounded image for the exact linked owner and selected WAN26 model. It returns a private-use handle, never the upload URL.",
    inputSchema: imageInput, outputSchema: imageUploadOutput,
    annotations: { title: "Upload WAN 2.6 I2V image reference", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (raw, { signal }) => {
    const parsed = imageInput.safeParse(snapshotFlat(raw)); if (!parsed.success) return unavailable(imageUploadOutput, "INVALID_REQUEST");
    try {
      const v = parsed.data;
      const receipt = await composition.referenceService.uploadImage({ attemptId: v.link_attempt_id, model_id: v.model_id,
        filename: v.filename, mime_type: v.mime_type, content_base64: v.content_base64 }, signal);
      return success(imageUploadOutput, { status: "uploaded", error_code: null, error_message: null, model_id: receipt.model_id,
        image_handle: receipt.image_handle, filename: receipt.filename, mime_type: receipt.mime_type, size: receipt.size,
        sha256: receipt.sha256, width: receipt.width, height: receipt.height, expires_in_seconds: receipt.expires_in_seconds,
        generation_permit: false });
    } catch (error) { return unavailable(imageUploadOutput, referenceErrorCode(error)); }
  });

  server.registerTool(SYNTX_OWNER_UPLOAD_WAN26_I2V_AUDIO_TOOL_NAME, {
    title: "Upload WAN 2.6 I2V audio reference",
    description: "Locally probes one bounded MP3 or PCM-WAV and uploads it as an optional WAN26 audio reference. It returns a private-use handle, never a URL.",
    inputSchema: audioInput, outputSchema: audioUploadOutput,
    annotations: { title: "Upload WAN 2.6 I2V audio reference", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (raw, { signal }) => {
    const parsed = audioInput.safeParse(snapshotFlat(raw)); if (!parsed.success) return unavailable(audioUploadOutput, "INVALID_REQUEST");
    try {
      const v = parsed.data;
      const receipt = await composition.referenceService.uploadAudio({ attemptId: v.link_attempt_id, model_id: v.model_id,
        filename: v.filename, mime_type: v.mime_type, content_base64: v.content_base64 }, signal);
      return success(audioUploadOutput, { status: "uploaded", error_code: null, error_message: null, model_id: receipt.model_id,
        audio_handle: receipt.audio_handle, filename: receipt.filename, mime_type: receipt.mime_type, size: receipt.size,
        sha256: receipt.sha256, duration_seconds: receipt.duration_seconds, expires_in_seconds: receipt.expires_in_seconds,
        generation_permit: false });
    } catch (error) { return unavailable(audioUploadOutput, referenceErrorCode(error)); }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_WAN26_I2V_VIDEO_TOOL_NAME, {
    title: "Generate WAN 2.6 I2V video",
    description: "Starts one owner generation and may incur a charge. On an unknown outcome, reconcile the recovery; never retry generation.",
    inputSchema: generateInput, outputSchema: generationOutput,
    annotations: { title: "Generate WAN 2.6 I2V video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (raw, { signal }) => {
    const parsed = generateInput.safeParse(snapshotFlat(raw)); if (!parsed.success) return unavailable(generationOutput, "INVALID_REQUEST");
    const v = parsed.data;
    try {
      const result = await composition.generationService.generate({ attemptId: v.link_attempt_id, request: { model_id: v.model_id,
        image_handle: v.image_handle, audio_handle: v.audio_handle, prompt: v.prompt,
        parameters: { resolution: v.resolution, aspect_ratio: v.aspect_ratio, video_duration: v.video_duration,
          prompt_extend: v.prompt_extend, seed: v.seed, native_audio: v.native_audio } } }, signal);
      return success(generationOutput, projectResult(result));
    } catch (error) { return generationFailure(generationOutput, error); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_WAN26_I2V_VIDEO_TOOL_NAME, {
    title: "Reconcile WAN 2.6 I2V generation",
    description: "Performs GET-only recovery for one WAN26 recovery ID. It never creates a chat or repeats generation.",
    inputSchema: reconcileInput, outputSchema: generationOutput,
    annotations: { title: "Reconcile WAN 2.6 I2V generation", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (raw, { signal }) => {
    const parsed = reconcileInput.safeParse(snapshotFlat(raw)); if (!parsed.success) return unavailable(generationOutput, "INVALID_REQUEST");
    try { return success(generationOutput, projectResult(await composition.generationService.reconcile({
      attemptId: parsed.data.link_attempt_id, recovery_id: parsed.data.recovery_id }, signal))); }
    catch (error) { return generationFailure(generationOutput, error); }
  });

  server.registerTool(SYNTX_OWNER_LIST_WAN26_I2V_RECOVERIES_TOOL_NAME, {
    title: "List WAN 2.6 I2V recoveries",
    description: "Lists bounded local recovery summaries for the linked owner without result URLs.",
    inputSchema: recoveriesInput, outputSchema: recoveriesOutput,
    annotations: { title: "List WAN 2.6 I2V recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (raw) => {
    const parsed = recoveriesInput.safeParse(snapshotFlat(raw)); if (!parsed.success) return unavailable(recoveriesOutput, "INVALID_REQUEST");
    try {
      const records = await composition.generationService.listRecoveries({ attemptId: parsed.data.link_attempt_id,
        ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }) });
      return success(recoveriesOutput, { status: "listed", error_code: null, error_message: null,
        recoveries: records.map(projectRecovery) });
    } catch (error) { return unavailable(recoveriesOutput, generationErrorCode(error)); }
  });

  server.registerTool(SYNTX_OWNER_GET_WAN26_I2V_RESULT_PAGE_TOOL_NAME, {
    title: "Get WAN 2.6 I2V result page",
    description: "Reads one bounded page of already observed video artifacts. Local availability does not establish provider terminal success.",
    inputSchema: resultPageInput, outputSchema: generationOutput,
    annotations: { title: "Get WAN 2.6 I2V result page", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (raw) => {
    const parsed = resultPageInput.safeParse(snapshotFlat(raw)); if (!parsed.success) return unavailable(generationOutput, "INVALID_REQUEST");
    try { return success(generationOutput, projectResult(await composition.generationService.getResultPage({
      attemptId: parsed.data.link_attempt_id, recovery_id: parsed.data.recovery_id,
      ...(parsed.data.offset === undefined ? {} : { offset: parsed.data.offset }) }))); }
    catch (error) { return generationFailure(generationOutput, error); }
  });
}

function projectParameters() {
  const controls = source.controls, pins = source.source_pins;
  return { status: "ready", error_code: null, error_message: null, model_ids: source.model_ids,
    public_catalog_version: pins.public_catalog_version, public_catalog_fetched_at: pins.public_catalog_fetched_at,
    public_models_sha256: pins.public_models_sha256, files_mention: pins.files_mention,
    resolution_values: controls.resolution, aspect_ratio_values: controls.aspect_ratio,
    video_duration_min: controls.video_duration.minimum, video_duration_max: controls.video_duration.maximum,
    prompt_extend_explicit: true, seed_min: controls.seed.minimum, seed_max: controls.seed.maximum,
    regular_native_audio_policy: "FIXED_FALSE", flash_native_audio_policy: "EXPLICIT_BOOLEAN",
    shot_type: source.wire_facts.fixed_fields.shot_type, audio_setting: source.wire_facts.fixed_fields.audio_setting,
    reference_duration_setting: source.wire_facts.duration,
    regular_cost_keys: source.cost_projection.keys_by_model.wan_26_i2v,
    flash_cost_keys: source.cost_projection.keys_by_model.wan_26_i2v_flash,
    cost_projection_confidence: source.cost_projection.source, effective_defaults: source.effective_defaults,
    current_quote: source.cost_projection.current_quote, provider_acceptance: source.provider_acceptance,
    dispatch_allowed: source.dispatch_allowed };
}

function projectResult(result: OwnerWan26I2vGenerationResult): Record<string, unknown> {
  if (!isModelId(result.model_id) || !isSafeRecoveryId(result.recovery_id) ||
      result.status_semantics !== "LOCAL_OBSERVED_AVAILABILITY_ONLY" || result.backend_acceptance !== "UNPROVEN" ||
      result.provider_terminal_status !== "UNPROVEN" || result.cost_cap_enforced !== false) throw new Error("OUTPUT_INVALID");
  const artifacts = result.artifacts.map(projectArtifact);
  return { status: result.status, error_code: null, error_message: null, status_semantics: result.status_semantics,
    backend_acceptance: result.backend_acceptance, provider_terminal_status: result.provider_terminal_status,
    cost_cap_enforced: result.cost_cap_enforced, recovery_id: result.recovery_id, model_id: result.model_id,
    observed_artifact_count: result.observed_artifact_count, offset: result.offset, page_size: result.page_size,
    artifacts, has_more: result.has_more, next_offset: result.next_offset, diagnostic: projectDiagnostic(result.diagnostic) };
}

function projectArtifact(artifact: OwnerWan26I2vGenerationArtifact): Record<string, unknown> {
  if (artifact.object_type !== "video" || !isModelId(artifact.model_id) || !isSafeReferenceUrl(artifact.object_url)) throw new Error("OUTPUT_INVALID");
  return { object_index: artifact.object_index, message_object_id: artifact.message_object_id, object_type: artifact.object_type,
    object_url: artifact.object_url, mime_type: artifact.mime_type, message_id: artifact.message_id,
    chat_uuid: artifact.chat_uuid, model_id: artifact.model_id };
}

function projectDiagnostic(value: OwnerWan26I2vGenerationDiagnostic): Record<string, unknown> {
  return { post_started: value.post_started, ack_known: value.ack_known, history_status: value.history_status,
    owner_ack_status: value.owner_ack_status, history_get_calls: value.history_get_calls, result_get_calls: value.result_get_calls,
    backend_error_observed: value.backend_error_observed, pending_object_indices: value.pending_object_indices,
    gaps: value.gaps };
}

function projectRecovery(value: OwnerWan26I2vRecoveryListItem): Record<string, unknown> {
  return { recovery_id: value.recovery_id, created_at: value.created_at, status: value.status, model_id: value.model_id,
    observed_artifact_count: value.observed_artifact_count };
}

function success<T extends z.ZodObject<z.ZodRawShape>>(schema: T, value: unknown): CallToolResult {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return unavailable(schema, "OUTPUT_INVALID");
  const data = parsed.data as Record<string, unknown>;
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}

function unavailable<T extends z.ZodObject<z.ZodRawShape>>(schema: T, codeInput: string,
  extras: Readonly<Record<string, unknown>> = {}): CallToolResult {
  const code = isErrorCode(codeInput) ? codeInput : "SERVICE_UNAVAILABLE";
  const fields = Object.fromEntries(Object.keys(schema.shape).map((key) => [key, null])) as Record<string, unknown>;
  const value = { ...fields, status: "unavailable", error_code: code, error_message: errorMessages[code], ...safeErrorExtras(extras) };
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("WAN26_TOOL_ERROR_OUTPUT_SCHEMA_INVALID");
  const data = parsed.data as Record<string, unknown>;
  return { isError: true, content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}

function referenceErrorCode(error: unknown): string {
  return error instanceof OwnerWan26I2vReferenceServiceError && isErrorCode(error.code) ? error.code : "REFERENCE_UNAVAILABLE";
}
function generationErrorCode(error: unknown): string {
  return error instanceof OwnerWan26I2vGenerationServiceError && isErrorCode(error.code) ? error.code : "SERVICE_UNAVAILABLE";
}
function generationFailure(schema: typeof generationOutput, error: unknown): CallToolResult {
  const code = generationErrorCode(error), extra: Record<string, unknown> = {};
  if (code === "OUTCOME_UNKNOWN" && error instanceof OwnerWan26I2vGenerationServiceError) {
    if (isSafeRecoveryId(error.recovery_id)) extra.recovery_id = error.recovery_id;
    if (error.diagnostic) {
      try { extra.diagnostic = projectDiagnostic(error.diagnostic); } catch { /* omit malformed diagnostics */ }
    }
  }
  return unavailable(schema, code, extra);
}

function safeErrorExtras(input: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  if (input.recovery_id !== undefined && isSafeRecoveryId(input.recovery_id)) extra.recovery_id = input.recovery_id;
  if (input.diagnostic !== undefined) {
    try { extra.diagnostic = diagnosticOutput.parse(input.diagnostic); } catch { /* keep the error closed and redacted */ }
  }
  return extra;
}

function isErrorCode(value: unknown): value is z.infer<typeof errorCode> { return errorCode.safeParse(value).success; }
function isModelId(value: unknown): value is OwnerWan26I2vGenerationModelId { return value === MODEL_IDS[0] || value === MODEL_IDS[1]; }
function isSafeRecoveryId(value: unknown): value is string { return typeof value === "string" && RECOVERY_ID.test(value); }
function isSafeReferenceUrl(value: unknown): value is string { return typeof value === "string" && isSafeUploadReferenceUrl(value); }

function exactComposition(value: unknown): OwnerWan26I2vServiceComposition {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new Error("OWNER_WAN26_I2V_COMPOSITION_INVALID");
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    const expected = ["referenceService", "generationService"];
    if (prototype !== Object.prototype || keys.length !== expected.length ||
        keys.some((key) => typeof key !== "string" || !expected.includes(key) || !Object.hasOwn(descriptors[key]!, "value") ||
          descriptors[key]!.enumerable !== true) ||
        !(descriptors.referenceService!.value instanceof OwnerWan26I2vReferenceService) ||
        !isOwnerWan26I2vGenerationService(descriptors.generationService!.value)) throw new Error();
    const references = descriptors.referenceService!.value as OwnerWan26I2vReferenceService;
    if (Object.getPrototypeOf(references) !== OwnerWan26I2vReferenceService.prototype || !Object.isFrozen(references)) throw new Error();
    return Object.freeze({ referenceService: references, generationService: descriptors.generationService!.value as OwnerWan26I2vGenerationService });
  } catch { throw new Error("OWNER_WAN26_I2V_COMPOSITION_INVALID"); }
}

function snapshotFlat(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), output = Object.create(null) as Record<string, unknown>;
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string") return undefined;
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return undefined;
      const item = descriptor.value;
      if (item !== null && !["string", "number", "boolean"].includes(typeof item)) return undefined;
      Object.defineProperty(output, key, { value: item, enumerable: true, writable: true, configurable: true });
    }
    return output;
  } catch { return undefined; }
}

