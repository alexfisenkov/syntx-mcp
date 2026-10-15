import { types } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import {
  OwnerWan26R2vGenerationService,
  OwnerWan26R2vGenerationServiceError,
  isOwnerWan26R2vGenerationService,
  type OwnerWan26R2vGenerationArtifact,
  type OwnerWan26R2vGenerationDiagnostic,
  type OwnerWan26R2vGenerationResult,
  type OwnerWan26R2vRecoveryListItem
} from "../application/owner-wan26-r2v-generation-service.js";
import {
  OwnerWan26R2vReferenceService,
  OwnerWan26R2vReferenceServiceError,
  type OwnerWan26R2vReferenceReceipt
} from "../application/owner-wan26-r2v-reference-service.js";
import {
  getOwnerWan26R2vGenerationParametersSource,
  normalizeOwnerWan26R2vGenerationParameters,
  type OwnerWan26R2vGenerationModelId
} from "../application/owner-wan26-r2v-generation-parameters.js";
import { OWNER_WAN26_R2V_IMAGE_POLICY } from "../application/owner-wan26-r2v-image-policy.js";

const MODELS = Object.freeze(["wan_26_r2v", "wan_26_r2v_flash"] as const);
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^wan26ref_[0-9a-f]{32}$/u;
const RECOVERY = /^wan26_r2v_recovery_[0-9a-f-]{36}$/u;
const MAX_PAGE = 4_096;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const PORTABLE_FILENAME = /^(?!\.{1,2}$)(?!.*[. ]$)(?!.*[<>:"/\\|?*\p{Cc}\p{Cf}\p{Cs}])(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)).+$/iu;
const source = getOwnerWan26R2vGenerationParametersSource();
const attempt = z.string().regex(ATTEMPT);
const model = z.enum(MODELS);
const handle = z.string().regex(HANDLE);
const recovery = z.string().regex(RECOVERY);
const filename = z.string().min(1).max(255).regex(PORTABLE_FILENAME).refine((v) => v === v.trim());
const imageMime = z.enum(OWNER_WAN26_R2V_IMAGE_POLICY.source_mime_types);
const serviceError = z.enum(["INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH", "PREFLIGHT_FAILED", "INTENT_ALREADY_CLAIMED", "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND", "REQUEST_ABORTED", "OUTPUT_INVALID", "SERVICE_UNAVAILABLE"]);
const referenceError = z.enum(["INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH", "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED", "UPLOAD_REJECTED", "UPLOAD_OUTCOME_UNKNOWN", "CAPACITY_EXCEEDED", "REQUEST_ABORTED"]);
const diagnosticCode = z.enum(["ACCOUNT_READ_UNAVAILABLE", "ACCOUNT_STATUS_STALE", "MODEL_ACCESS_UNAVAILABLE", "MODEL_ACCESS_STALE", "HISTORY_UNAVAILABLE", "HISTORY_INCOMPLETE", "HISTORY_UNVERIFIED", "OWNER_ACK_MISSING", "OWNER_ACK_AMBIGUOUS", "OWNER_ACK_MISMATCH", "BACKEND_ERROR_OBSERVED", "RESULT_GET_UNAVAILABLE", "RESULT_PENDING", "RESULT_UNVERIFIED", "RESULT_MODEL_ECHO_UNAVAILABLE", "RESULT_MODEL_ECHO_MISMATCH", "RESULT_URL_UNSAFE", "NO_VIDEO_OBSERVED", "ARTIFACT_LIMIT_EXCEEDED"]);
const emptyInput = z.object({}).strict();
const imageInput = z.object({ link_attempt_id: attempt, model_id: model, filename, mime_type: imageMime,
  content_base64: z.string().min(4).max(Math.ceil(OWNER_WAN26_R2V_IMAGE_POLICY.max_local_resource_bytes * 4 / 3)).regex(BASE64) }).strict();
const videoInput = z.object({ link_attempt_id: attempt, model_id: model, filename,
  mime_type: z.literal("video/mp4"), content_base64: z.string().min(4).max(Math.ceil(100 * 1024 * 1024 * 4 / 3)).regex(BASE64),
  start_seconds: z.number().finite().min(0), end_seconds: z.number().finite().gt(0), total_reference_count: z.number().int().min(1).max(5) }).strict();
const referenceCheckInput = z.object({ link_attempt_id: attempt, model_id: model,
  reference_handles: z.array(handle).min(1).max(5) }).strict();
const generationInput = z.object({ link_attempt_id: attempt, model_id: model, prompt: z.string().max(1_500),
  resolution: z.enum(["720P", "1080P"]), aspect_ratio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"]),
  video_duration: z.number().int().min(2).max(10), seed: z.number().int().min(0).max(2_147_483_647).nullable(),
  native_audio: z.boolean().optional(), reference_handles: z.array(handle).min(1).max(5) }).strict();
const reconcileInput = z.object({ link_attempt_id: attempt, recovery_id: recovery }).strict();
const listInput = z.object({ link_attempt_id: attempt, limit: z.number().int().min(1).max(128).optional() }).strict();
const pageInput = z.object({ link_attempt_id: attempt, recovery_id: recovery, offset: z.number().int().min(0).max(MAX_PAGE).optional() }).strict();

const sourceOutput = z.object({ status: z.enum(["ready", "unavailable"]), error_code: referenceError.nullable(),
  error_message: z.string().max(180).nullable(), model_ids: z.array(model).length(2).nullable(),
  public_catalog_version: z.string().max(160).nullable(), public_catalog_fetched_at: z.iso.datetime().nullable(),
  public_models_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u).nullable(), files_mention: z.boolean().nullable(),
  resolution_values: z.array(z.enum(["720P", "1080P"])).length(2).nullable(),
  aspect_ratio_values: z.array(z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"])).length(5).nullable(),
  video_duration_values: z.array(z.number().int().min(2).max(10)).length(9).nullable(), prompt_max_length: z.literal(1_500).nullable(),
  seed_min: z.literal(0).nullable(), seed_max: z.literal(2_147_483_647).nullable(),
  regular_native_audio: z.literal("FORBIDDEN").nullable(), flash_native_audio: z.literal("EXPLICIT_BOOLEAN").nullable(),
  reference_requirement: z.literal("AT_LEAST_ONE_IMAGE_OR_VIDEO").nullable(), effective_defaults: z.literal("UNKNOWN").nullable(),
  current_quote: z.literal("UNKNOWN").nullable(), provider_acceptance: z.literal("UNPROVEN").nullable(), dispatch_allowed: z.literal(false).nullable(),
  source_readiness: z.literal("PARTIAL_SOURCE_EXPLICIT_SETTINGS").nullable(), coverage_gaps: z.array(z.string()).max(32).nullable() }).strict();
const receiptOutput = z.object({ status: z.enum(["uploaded", "unavailable"]), error_code: referenceError.nullable(),
  error_message: z.string().max(180).nullable(), model_id: model.nullable(), reference_handle: handle.nullable(),
  media_type: z.enum(["image", "selected_video"]).nullable(), mime_type: z.string().max(80).nullable(), size: z.number().int().positive().nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(), width: z.number().int().positive().nullable(), height: z.number().int().positive().nullable(),
  selected_duration_seconds: z.number().finite().positive().nullable(), video_duration_seconds: z.number().finite().positive().nullable(),
  expires_in_seconds: z.literal(900).nullable(), generation_permit: z.literal(false).nullable() }).strict();
const refCheckOutput = z.object({ status: z.enum(["ready", "unavailable"]), error_code: referenceError.nullable(),
  error_message: z.string().max(180).nullable(), model_id: model.nullable(), reference_handles: z.array(handle).max(5).nullable(),
  image_count: z.number().int().min(0).max(2).nullable(), video_count: z.number().int().min(0).max(3).nullable(),
  total_reference_count: z.number().int().min(1).max(5).nullable(), expires_at: z.number().finite().nullable(),
  generation_permit: z.literal(false).nullable() }).strict();
const diagnosticOutput = z.object({ post_started: z.boolean(), ack_known: z.boolean(),
  history_status: z.enum(["PENDING", "COMPLETE", "INCOMPLETE", "UNVERIFIED", "NOT_READ"]),
  owner_ack_status: z.enum(["MATCHED", "MISSING", "AMBIGUOUS", "MISMATCH", "NOT_READ"]),
  history_get_calls: z.number().int().min(0), result_get_calls: z.number().int().min(0), backend_error_observed: z.boolean(),
  pending_object_indices: z.array(z.number().int().min(0).max(63)).max(64), gaps: z.array(diagnosticCode).max(32) }).strict();
const artifactOutput = z.object({ object_index: z.number().int().min(0).max(MAX_PAGE), message_object_id: z.string().min(1).max(160),
  object_type: z.literal("video"), object_url: z.string().url().max(4_096).refine(isSafeUploadReferenceUrl), mime_type: z.enum(["video/mp4", "video/webm"]).nullable(),
  message_id: z.string().min(1).max(160), chat_uuid: z.string().min(1).max(160), model_id: model }).strict();
const generationOutput = z.object({ status: z.enum(["completed", "unavailable"]), error_code: serviceError.nullable(), error_message: z.string().max(180).nullable(),
  status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY").nullable(), backend_acceptance: z.literal("UNPROVEN").nullable(),
  provider_terminal_status: z.literal("UNPROVEN").nullable(), cost_cap_enforced: z.literal(false).nullable(), recovery_id: recovery.nullable(), model_id: model.nullable(),
  source_readiness: z.literal("PARTIAL_SOURCE_EXPLICIT_SETTINGS").nullable(), source_binding: z.object({ public_catalog_version: z.string().max(160),
    profile_schema_hash: z.string().max(160), request_fingerprint: z.string().max(160), intent_fingerprint: z.string().max(160),
    source_readiness: z.literal("PARTIAL_SOURCE_EXPLICIT_SETTINGS") }).strict().nullable(),
  observed_artifact_count: z.number().int().min(0).max(MAX_PAGE).nullable(), offset: z.number().int().min(0).max(MAX_PAGE).nullable(),
  page_size: z.literal(64).nullable(), artifacts: z.array(artifactOutput).max(64).nullable(), has_more: z.boolean().nullable(),
  next_offset: z.number().int().min(0).max(MAX_PAGE).nullable(), diagnostic: diagnosticOutput.nullable() }).strict();
const recoveryItemOutput = z.object({ recovery_id: recovery, created_at: z.iso.datetime(), status: z.enum(["outcome_unknown", "completed"]),
  model_id: model, observed_artifact_count: z.number().int().min(0).max(MAX_PAGE) }).strict();
const listOutput = z.object({ status: z.enum(["listed", "unavailable"]), error_code: serviceError.nullable(), error_message: z.string().max(180).nullable(),
  recoveries: z.array(recoveryItemOutput).max(128).nullable() }).strict();

export const OWNER_WAN26_R2V_TOOL_NAMES = Object.freeze([
  "syntx_owner_get_wan26_r2v_parameters", "syntx_owner_upload_wan26_r2v_image", "syntx_owner_upload_wan26_r2v_selected_video",
  "syntx_owner_check_wan26_r2v_references", "syntx_owner_generate_wan26_r2v_video", "syntx_owner_reconcile_wan26_r2v_video",
  "syntx_owner_list_wan26_r2v_recoveries", "syntx_owner_get_wan26_r2v_result_page"
] as const);

export interface OwnerWan26R2vServiceComposition {
  readonly referenceService: OwnerWan26R2vReferenceService;
  readonly generationService: OwnerWan26R2vGenerationService;
}

export function registerSyntxOwnerWan26R2vTools(server: McpServer, options: OwnerWan26R2vServiceComposition): void {
  const composition = exactComposition(options);
  server.registerTool(OWNER_WAN26_R2V_TOOL_NAMES[0], { title: "Get WAN 2.6 R2V parameters", description: "Returns pinned local parameter evidence; settings are partial and provider acceptance is unproven.", inputSchema: emptyInput, outputSchema: sourceOutput,
    annotations: { title: "Get WAN 2.6 R2V parameters", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async () => success(sourceOutput, projectSource()));
  server.registerTool(OWNER_WAN26_R2V_TOOL_NAMES[1], { title: "Upload WAN 2.6 R2V image", description: "Uploads one bounded image for the linked owner and selected model. Returns an opaque handle, never a URL.", inputSchema: imageInput, outputSchema: receiptOutput,
    annotations: { title: "Upload WAN 2.6 R2V image", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } }, async (raw, { signal }) => {
    const v = imageInput.safeParse(snapshot(raw)); if (!v.success) return failOutput(receiptOutput, "INVALID_REQUEST");
    try { return success(receiptOutput, projectReceipt(await composition.referenceService.uploadImage({ attemptId: v.data.link_attempt_id, model_id: v.data.model_id,
      filename: v.data.filename, mime_type: v.data.mime_type, content_base64: v.data.content_base64 }, signal))); }
    catch (e) { return failOutput(receiptOutput, referenceCode(e)); }
  });
  server.registerTool(OWNER_WAN26_R2V_TOOL_NAMES[2], { title: "Upload WAN 2.6 R2V selected video", description: "Locally validates and crops one selected MP4 interval before owner-bound upload.", inputSchema: videoInput, outputSchema: receiptOutput,
    annotations: { title: "Upload WAN 2.6 R2V selected video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } }, async (raw, { signal }) => {
    const v = videoInput.safeParse(snapshot(raw)); if (!v.success) return failOutput(receiptOutput, "INVALID_REQUEST");
    try { const x = v.data; return success(receiptOutput, projectReceipt(await composition.referenceService.uploadSelectedVideo({ attemptId: x.link_attempt_id,
      model_id: x.model_id, filename: x.filename, mime_type: x.mime_type, content_base64: x.content_base64, start_seconds: x.start_seconds,
      end_seconds: x.end_seconds, total_reference_count: x.total_reference_count }, signal))); }
    catch (e) { return failOutput(receiptOutput, referenceCode(e)); }
  });
  server.registerTool(OWNER_WAN26_R2V_TOOL_NAMES[3], { title: "Check WAN 2.6 R2V references", description: "Checks exact ordered owner-bound handles. Monotonic expiry is process-local and grants no generation permit.", inputSchema: referenceCheckInput, outputSchema: refCheckOutput,
    annotations: { title: "Check WAN 2.6 R2V references", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (raw, { signal }) => {
    const v = referenceCheckInput.safeParse(snapshot(raw)); if (!v.success) return failOutput(refCheckOutput, "INVALID_REQUEST");
    try { const result = await composition.referenceService.resolveManifest({ attempt_id: v.data.link_attempt_id, model_id: v.data.model_id, reference_handles: v.data.reference_handles }, signal);
      return success(refCheckOutput, { status: "ready", error_code: null, error_message: null, model_id: result.model_id,
        reference_handles: v.data.reference_handles, image_count: result.image_count, video_count: result.video_count, total_reference_count: result.total_reference_count,
        expires_at: result.expires_at, generation_permit: false }); }
    catch (e) { return failOutput(refCheckOutput, referenceCode(e)); }
  });
  server.registerTool(OWNER_WAN26_R2V_TOOL_NAMES[4], { title: "Generate WAN 2.6 R2V video", description: "May incur a charge. Unknown outcomes require recovery; never repeat generation.", inputSchema: generationInput, outputSchema: generationOutput,
    annotations: { title: "Generate WAN 2.6 R2V video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } }, async (raw, { signal }) => {
    const v = generationInput.safeParse(snapshot(raw)); if (!v.success || (v.success && (v.data.model_id === "wan_26_r2v" && v.data.native_audio !== undefined || v.data.model_id === "wan_26_r2v_flash" && v.data.native_audio === undefined))) return failOutput(generationOutput, "INVALID_REQUEST");
    try { const x = v.data; const parameters = { resolution: x.resolution, aspect_ratio: x.aspect_ratio, video_duration: x.video_duration,
      seed: x.seed, ...(x.native_audio === undefined ? {} : { native_audio: x.native_audio }) };
      const normalized = normalizeOwnerWan26R2vGenerationParameters({ model_id: x.model_id, prompt: x.prompt, parameters });
      return success(generationOutput, projectResult(await composition.generationService.generate({ attemptId: x.link_attempt_id,
        request: { model_id: x.model_id, prompt: x.prompt, parameters: normalized.intent.parameters, reference_handles: [...x.reference_handles] } }, signal))); }
    catch (e) { return generationFailure(e); }
  });
  server.registerTool(OWNER_WAN26_R2V_TOOL_NAMES[5], { title: "Reconcile WAN 2.6 R2V generation", description: "GET-only recovery for the exact owner attempt and recovery ID; never repeats generation.", inputSchema: reconcileInput, outputSchema: generationOutput,
    annotations: { title: "Reconcile WAN 2.6 R2V generation", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } }, async (raw, { signal }) => {
    const v = reconcileInput.safeParse(snapshot(raw)); if (!v.success) return failOutput(generationOutput, "INVALID_REQUEST");
    try { return success(generationOutput, projectResult(await composition.generationService.reconcile({ attemptId: v.data.link_attempt_id, recovery_id: v.data.recovery_id }, signal))); }
    catch (e) { return generationFailure(e); }
  });
  server.registerTool(OWNER_WAN26_R2V_TOOL_NAMES[6], { title: "List WAN 2.6 R2V recoveries", description: "Lists bounded owner-local recovery summaries without artifact URLs.", inputSchema: listInput, outputSchema: listOutput,
    annotations: { title: "List WAN 2.6 R2V recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (raw) => {
    const v = listInput.safeParse(snapshot(raw)); if (!v.success) return failOutput(listOutput, "INVALID_REQUEST");
    try { const items = await composition.generationService.listRecoveries({ attemptId: v.data.link_attempt_id, ...(v.data.limit === undefined ? {} : { limit: v.data.limit }) });
      return success(listOutput, { status: "listed", error_code: null, error_message: null, recoveries: items.map(projectRecovery) }); }
    catch (e) { return failOutput(listOutput, serviceCode(e)); }
  });
  server.registerTool(OWNER_WAN26_R2V_TOOL_NAMES[7], { title: "Get WAN 2.6 R2V result page", description: "Reads one bounded page of already observed artifacts.", inputSchema: pageInput, outputSchema: generationOutput,
    annotations: { title: "Get WAN 2.6 R2V result page", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (raw) => {
    const v = pageInput.safeParse(snapshot(raw)); if (!v.success) return failOutput(generationOutput, "INVALID_REQUEST");
    try { return success(generationOutput, projectResult(await composition.generationService.getResultPage({ attemptId: v.data.link_attempt_id, recovery_id: v.data.recovery_id,
      ...(v.data.offset === undefined ? {} : { offset: v.data.offset }) }))); }
    catch (e) { return generationFailure(e); }
  });
}

function projectSource(): Record<string, unknown> {
  const controls = source.controls, pins = source.source_pins;
  return { status: "ready", error_code: null, error_message: null, model_ids: source.model_ids, public_catalog_version: pins.public_catalog_version,
    public_catalog_fetched_at: pins.public_catalog_fetched_at, public_models_sha256: pins.public_models_sha256, files_mention: pins.files_mention,
    resolution_values: controls.resolution, aspect_ratio_values: controls.aspect_ratio, video_duration_values: controls.video_duration.values,
    prompt_max_length: source.prompt_limit.maximum_length, seed_min: controls.seed.minimum, seed_max: controls.seed.maximum,
    regular_native_audio: "FORBIDDEN", flash_native_audio: "EXPLICIT_BOOLEAN", reference_requirement: source.reference_input.requirement,
    effective_defaults: source.effective_defaults, current_quote: source.cost_projection.current_quote, provider_acceptance: source.provider_acceptance,
    dispatch_allowed: source.dispatch_allowed, source_readiness: "PARTIAL_SOURCE_EXPLICIT_SETTINGS", coverage_gaps: source.coverage_gaps };
}
function projectReceipt(x: OwnerWan26R2vReferenceReceipt): Record<string, unknown> {
  if (!isModel(x.model_id) || !HANDLE.test(x.reference_handle) || x.generation_permit !== false) throw new Error("OUTPUT_INVALID");
  return { status: "uploaded", error_code: null, error_message: null, model_id: x.model_id, reference_handle: x.reference_handle, media_type: x.media_type,
    mime_type: x.mime_type, size: x.size, sha256: x.sha256, width: x.width, height: x.height,
    selected_duration_seconds: x.selected_duration_seconds ?? null, video_duration_seconds: x.video_duration_seconds ?? null,
    expires_in_seconds: x.expires_in_seconds, generation_permit: false };
}
function projectResult(x: OwnerWan26R2vGenerationResult): Record<string, unknown> {
  if (!isModel(x.model_id) || !RECOVERY.test(x.recovery_id) || x.status_semantics !== "LOCAL_OBSERVED_AVAILABILITY_ONLY" ||
      x.backend_acceptance !== "UNPROVEN" || x.provider_terminal_status !== "UNPROVEN" || x.cost_cap_enforced !== false ||
      x.source_binding.source_readiness !== "PARTIAL_SOURCE_EXPLICIT_SETTINGS") throw new Error("OUTPUT_INVALID");
  return { status: x.status, error_code: null, error_message: null, status_semantics: x.status_semantics, backend_acceptance: x.backend_acceptance,
    provider_terminal_status: x.provider_terminal_status, cost_cap_enforced: false, recovery_id: x.recovery_id, model_id: x.model_id,
    source_readiness: x.source_binding.source_readiness, source_binding: x.source_binding, observed_artifact_count: x.observed_artifact_count,
    offset: x.offset, page_size: x.page_size, artifacts: x.artifacts.map(projectArtifact), has_more: x.has_more, next_offset: x.next_offset,
    diagnostic: projectDiagnostic(x.diagnostic) };
}
function projectArtifact(x: OwnerWan26R2vGenerationArtifact): Record<string, unknown> {
  if (x.object_type !== "video" || !isModel(x.model_id) || !isSafeUploadReferenceUrl(x.object_url)) throw new Error("OUTPUT_INVALID");
  return { object_index: x.object_index, message_object_id: x.message_object_id, object_type: x.object_type, object_url: x.object_url,
    mime_type: x.mime_type, message_id: x.message_id, chat_uuid: x.chat_uuid, model_id: x.model_id };
}
function projectDiagnostic(x: OwnerWan26R2vGenerationDiagnostic): Record<string, unknown> {
  return { post_started: x.post_started, ack_known: x.ack_known, history_status: x.history_status, owner_ack_status: x.owner_ack_status,
    history_get_calls: x.history_get_calls, result_get_calls: x.result_get_calls, backend_error_observed: x.backend_error_observed,
    pending_object_indices: x.pending_object_indices, gaps: x.gaps };
}
function projectRecovery(x: OwnerWan26R2vRecoveryListItem): Record<string, unknown> { return { recovery_id: x.recovery_id, created_at: x.created_at,
  status: x.status, model_id: x.model_id, observed_artifact_count: x.observed_artifact_count }; }
function success<T extends z.ZodObject<z.ZodRawShape>>(schema: T, value: unknown): CallToolResult {
  const parsed = schema.safeParse(value); if (!parsed.success) return failOutput(schema, "OUTPUT_INVALID");
  const data = parsed.data as Record<string, unknown>; return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}
function failOutput<T extends z.ZodObject<z.ZodRawShape>>(schema: T, codeInput: string, extra: Record<string, unknown> = {}): CallToolResult {
  const schemaIdentity: unknown = schema;
  const code = schemaIdentity === receiptOutput || schemaIdentity === sourceOutput || schemaIdentity === refCheckOutput ? referenceError.safeParse(codeInput).success ? codeInput : "REFERENCE_UNAVAILABLE" :
    schemaIdentity === listOutput || schemaIdentity === generationOutput ? serviceError.safeParse(codeInput).success ? codeInput : "SERVICE_CLOSED" : "INVALID_REQUEST";
  const value = { ...Object.fromEntries(Object.keys(schema.shape).map((key) => [key, null])), status: "unavailable", error_code: code,
    error_message: "The WAN 2.6 R2V operation could not be completed safely.", ...extra };
  const parsed = schema.safeParse(value); if (!parsed.success) throw new Error("WAN26_R2V_ERROR_OUTPUT_INVALID");
  const data = parsed.data as Record<string, unknown>; return { isError: true, content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}
function serviceCode(e: unknown): string {
  if (e instanceof OwnerWan26R2vGenerationServiceError && serviceError.safeParse(e.code).success) return e.code;
  if (e instanceof Error && e.message === "OUTPUT_INVALID") return "OUTPUT_INVALID";
  return "SERVICE_UNAVAILABLE";
}
function referenceCode(e: unknown): string { return e instanceof OwnerWan26R2vReferenceServiceError && referenceError.safeParse(e.code).success ? e.code : "REFERENCE_UNAVAILABLE"; }
function generationFailure(e: unknown): CallToolResult {
  const code = serviceCode(e), extra: Record<string, unknown> = {};
  if (code === "OUTCOME_UNKNOWN" && e instanceof OwnerWan26R2vGenerationServiceError && typeof e.recovery_id === "string" && RECOVERY.test(e.recovery_id)) extra.recovery_id = e.recovery_id;
  if (code === "OUTCOME_UNKNOWN" && e instanceof OwnerWan26R2vGenerationServiceError && e.diagnostic) {
    const result = z.object({ post_started: z.boolean(), ack_known: z.boolean(), history_status: z.enum(["PENDING", "COMPLETE", "INCOMPLETE", "UNVERIFIED", "NOT_READ"]),
      owner_ack_status: z.enum(["MATCHED", "MISSING", "AMBIGUOUS", "MISMATCH", "NOT_READ"]), history_get_calls: z.number().int().min(0), result_get_calls: z.number().int().min(0),
      backend_error_observed: z.boolean(), pending_object_indices: z.array(z.number().int().min(0).max(63)).max(64), gaps: z.array(diagnosticCode).max(32) }).safeParse(e.diagnostic);
    if (result.success) extra.diagnostic = result.data;
  }
  return failOutput(generationOutput, code, extra);
}
function isModel(x: unknown): x is OwnerWan26R2vGenerationModelId { return x === MODELS[0] || x === MODELS[1]; }
function exactComposition(value: unknown): OwnerWan26R2vServiceComposition {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new Error("OWNER_WAN26_R2V_COMPOSITION_INVALID");
  try { const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (Object.getPrototypeOf(value) !== Object.prototype || keys.length !== 2 || keys.some((k) => typeof k !== "string" || !["referenceService", "generationService"].includes(k) ||
      !Object.hasOwn(descriptors[k]!, "value") || descriptors[k]!.enumerable !== true) || !(descriptors.referenceService!.value instanceof OwnerWan26R2vReferenceService) ||
      !isOwnerWan26R2vGenerationService(descriptors.generationService!.value)) throw new Error();
    const refs = descriptors.referenceService!.value as OwnerWan26R2vReferenceService;
    if (Object.getPrototypeOf(refs) !== OwnerWan26R2vReferenceService.prototype || !Object.isFrozen(refs)) throw new Error();
    return Object.freeze({ referenceService: refs, generationService: descriptors.generationService!.value as OwnerWan26R2vGenerationService });
  } catch { throw new Error("OWNER_WAN26_R2V_COMPOSITION_INVALID"); }
}
function snapshot(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return undefined;
  try { const proto = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value); if (proto !== Object.prototype && proto !== null) return undefined;
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) { if (typeof key !== "string") return undefined; const d = descriptors[key]!;
      if (!d.enumerable || !Object.hasOwn(d, "value")) return undefined; const item = d.value;
      if (item === null || ["string", "number", "boolean"].includes(typeof item)) Object.defineProperty(out, key, { value: item, enumerable: true });
      else if (Array.isArray(item) && !types.isProxy(item) && Object.getPrototypeOf(item) === Array.prototype) {
        const ds = Object.getOwnPropertyDescriptors(item), n = Object.getOwnPropertyDescriptor(item, "length")?.value;
        if (!Number.isInteger(n) || n < 0 || n > 5 || Reflect.ownKeys(ds).length !== n + 1) return undefined;
        const copy: unknown[] = []; for (let i = 0; i < n; i++) { const entry = ds[String(i)]; if (!entry || !Object.hasOwn(entry, "value") || !entry.enumerable || typeof entry.value !== "string") return undefined; copy.push(entry.value); }
        Object.defineProperty(out, key, { value: copy, enumerable: true });
      } else return undefined;
    }
    return out;
  } catch { return undefined; }
}
