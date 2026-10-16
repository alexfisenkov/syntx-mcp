import { types } from "node:util";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import {
  OWNER_WAN_T2V_GENERATION_HISTORY_REASONS,
  OWNER_WAN_T2V_GENERATION_PHASES,
  OWNER_WAN_T2V_GENERATION_RESULT_REASONS,
  type OwnerWanT2vGenerationDiagnostic,
  type OwnerWanT2vVideoArtifact
} from "../application/owner-wan-t2v-generation-service.js";
import {
  isOwnerWan30ReferenceGenerationService,
  OWNER_WAN30_REFERENCE_GENERATION_ERROR_CODES,
  OwnerWan30ReferenceGenerationServiceError,
  type OwnerWan30ReferenceGenerationService,
  type OwnerWan30ReferenceGenerationServiceErrorCode
} from "../application/owner-wan30-reference-generation-service.js";
import {
  getOwnerWan30ReferenceGenerationSourceContract,
  normalizeOwnerWan30ReferenceGenerationIntent,
  type OwnerWan30ReferenceGenerationIntent
} from "../application/owner-wan30-reference-generation-parameters.js";

const SOURCE = getOwnerWan30ReferenceGenerationSourceContract();
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY_ID = /^wan_reference_recovery_[0-9a-f-]{36}$/u;
const IMAGE_HANDLE = /^wan30_reference_image_[0-9a-f-]{36}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_IMAGE_BYTES = 7 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const MAX_RESULTS = 4_096;
const PAGE_SIZE = 64;

export const SYNTX_GET_WAN30_REFERENCE_PARAMETERS_TOOL_NAME = "syntx_get_wan30_reference_parameters" as const;
export const SYNTX_OWNER_UPLOAD_WAN30_REFERENCE_IMAGE_TOOL_NAME = "syntx_owner_upload_wan30_reference_image" as const;
export const SYNTX_OWNER_GENERATE_WAN30_REFERENCE_VIDEO_TOOL_NAME = "syntx_owner_generate_wan30_reference_video" as const;
export const SYNTX_OWNER_RECONCILE_WAN30_REFERENCE_VIDEO_TOOL_NAME = "syntx_owner_reconcile_wan30_reference_video" as const;
export const SYNTX_OWNER_LIST_WAN30_REFERENCE_RECOVERIES_TOOL_NAME = "syntx_owner_list_wan30_reference_recoveries" as const;
export const SYNTX_OWNER_GET_WAN30_REFERENCE_RESULT_PAGE_TOOL_NAME = "syntx_owner_get_wan30_reference_result_page" as const;
export const OWNER_WAN30_REFERENCE_TOOL_NAMES = Object.freeze([
  SYNTX_GET_WAN30_REFERENCE_PARAMETERS_TOOL_NAME,
  SYNTX_OWNER_UPLOAD_WAN30_REFERENCE_IMAGE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_WAN30_REFERENCE_VIDEO_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_WAN30_REFERENCE_VIDEO_TOOL_NAME,
  SYNTX_OWNER_LIST_WAN30_REFERENCE_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_GET_WAN30_REFERENCE_RESULT_PAGE_TOOL_NAME
] as const);

const attemptSchema = z.string().regex(ATTEMPT).describe("Exact currently linked owner attempt; it does not select another account.");
const recoveryIdSchema = z.string().regex(RECOVERY_ID).describe("Opaque process-local recovery ID; reconciliation is GET-only.");
const imageHandleSchema = z.string().regex(IMAGE_HANDLE).describe("Opaque process-local image handle; contains no upload URL.");
const emptyInputSchema = z.object({}).strict();
const uploadInputSchema = z.object({
  link_attempt_id: attemptSchema,
  content_base64: z.base64().min(4).max(MAX_BASE64_CHARS),
  filename: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/u),
  mime_type: z.enum(["image/png", "image/jpeg"])
}).strict().superRefine((input, context) => {
  const lower = input.filename.toLowerCase();
  if ((input.mime_type === "image/png" && !lower.endsWith(".png")) ||
      (input.mime_type === "image/jpeg" && !/\.(?:jpg|jpeg)$/u.test(lower))) {
    context.addIssue({ code: "custom", path: ["filename"], message: "Filename extension must match the selected image MIME type." });
  }
});
const parametersSchema = z.object({
  aspect_ratio: z.literal("16:9"), resolution: z.literal("480P"), video_duration: z.literal(2), prompt_extend: z.literal(true),
  shot_type: z.literal("single"), audio_setting: z.literal("auto"), seed: z.null(), native_audio: z.literal(false),
  duration: z.literal(0), rendering_speed: z.literal("basic")
}).strict();
const promptSchema = z.string().min(1).max(20_000).refine((value) => isWellFormedUnicode(value) && value.trim().length > 0 &&
  !value.includes("<<<") && !value.includes(">>>"),
"Prompt must be nonblank, within the local UI-counter bound, and must not contain reference delimiters.");
const generateInputSchema = z.object({
  link_attempt_id: attemptSchema,
  prompt: promptSchema,
  parameters: parametersSchema,
  image_handle: imageHandleSchema
}).strict().superRefine((input, context) => {
  try { normalizeOwnerWan30ReferenceGenerationIntent({ prompt: input.prompt, parameters: input.parameters }); }
  catch { context.addIssue({ code: "custom", path: ["parameters"], message: "The one observed WAN 3.0 Reference tuple is required." }); }
});
const reconcileInputSchema = z.object({ link_attempt_id: attemptSchema, recovery_id: recoveryIdSchema }).strict();
const listRecoveriesInputSchema = z.object({ link_attempt_id: attemptSchema,
  limit: z.number().int().min(1).max(128).optional() }).strict();
const resultPageInputSchema = z.object({ link_attempt_id: attemptSchema, recovery_id: recoveryIdSchema,
  offset: z.number().int().min(0).max(MAX_RESULTS).optional() }).strict();

const tenParametersSchema = z.object({ aspect_ratio: z.literal("16:9"), resolution: z.literal("480P"),
  video_duration: z.literal(2), prompt_extend: z.literal(true), shot_type: z.literal("single"), audio_setting: z.literal("auto"),
  seed: z.null(), native_audio: z.literal(false), duration: z.literal(0), rendering_speed: z.literal("basic") }).strict();
const sourceOutputSchema = z.object({
  profile_id: z.literal(SOURCE.profile_id), status: z.literal(SOURCE.status), model_id: z.literal(SOURCE.model_id),
  ai_name: z.literal(SOURCE.ai_name),
  source_pins: z.object({ public_catalog_version: z.literal(SOURCE.source_pins.public_catalog_version),
    form_build_id: z.literal(SOURCE.source_pins.form_build_id), form_module: z.literal("wan-video.js"),
    form_module_bytes: z.literal(SOURCE.source_pins.form_module_bytes), form_module_sha256: z.literal(SOURCE.source_pins.form_module_sha256),
    video_sender_module: z.literal("video.js"), video_sender_module_bytes: z.literal(SOURCE.source_pins.video_sender_module_bytes),
    video_sender_module_sha256: z.literal(SOURCE.source_pins.video_sender_module_sha256) }).strict(),
  wire_observation: z.object({ evidence: z.literal("ONE_ORDINARY_UI_POST_HTTP_200"), method: z.literal("POST"), path: z.literal("video/generate"),
    query_candidate: z.object({ ai_name: z.literal("wan_video") }).strict(),
    request_body_keys: z.tuple([z.literal("chat_id"), z.literal("prompt"), z.literal("settings")]),
    settings_keys: z.tuple([z.literal("model_type"), z.literal("file_urls"), z.literal("aspect_ratio"), z.literal("resolution"),
      z.literal("video_duration"), z.literal("prompt_extend"), z.literal("shot_type"), z.literal("audio_setting"), z.literal("seed"),
      z.literal("native_audio"), z.literal("duration"), z.literal("rendering_speed")]),
    file_urls_shape: z.literal("ONE_OBJECT_TYPE_AND_URL_ONLY"), file_urls_entry_types: z.tuple([z.literal("image")]),
    prompt_serialization: z.object({ form: z.literal("<<<[OWN_REFERENCE_URL]>>> [PROMPT] "),
      trusted_reference_url_required: z.literal(true), caller_url_accepted_here: z.literal(false),
      caller_delimiter_injection_rejected: z.literal(true) }).strict(), observed_tuple_only: z.literal(true),
    dispatch_allowed: z.literal(false), backend_acceptance: z.literal("UNPROVEN") }).strict(),
  quote_observation: z.object({ evidence: z.literal("SELECTED_MODE_GET_MODEL_INFO_UI_OBSERVED"), path: z.literal("/api/v2/get_model_info"),
    query_candidate: z.object({ model_type: z.literal("wan_30_reference"), ai_name: z.literal("wan_video") }).strict(),
    observed_keys: z.tuple([z.literal("resolution"), z.literal("video_duration"), z.literal("duration"), z.literal("rendering_speed")]),
    observed_values: z.object({ resolution: z.literal("480P"), video_duration: z.literal(2), duration: z.literal(0),
      rendering_speed: z.literal("basic") }).strict(), full_constraints: z.literal("UNPROVEN") }).strict(),
  controls: z.object({ status: z.literal("CURRENT_UI_VALUES_SINGLE_OBSERVED_CASE"), observed_values: tenParametersSchema,
    valid_combinations: z.literal("UNPROVEN"), local_operator_allowlist_only: z.literal(true) }).strict(),
  prompt_limit: z.object({ maximum_utf16_length: z.literal(20_000),
    source: z.literal("UI_COUNTER_LOCAL_OPERATOR_BOUND_NOT_PROVIDER_LIMIT") }).strict(),
  effective_defaults: z.literal("UNKNOWN"), dispatch_allowed: z.literal(false), backend_acceptance: z.literal("UNPROVEN")
}).strict();
const diagnosticSchema = z.object({
  phase: z.enum(OWNER_WAN_T2V_GENERATION_PHASES), post_started: z.boolean(), ack_known: z.boolean(),
  history_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "UNVERIFIED"]),
  history_reason: z.enum(OWNER_WAN_T2V_GENERATION_HISTORY_REASONS).nullable(),
  history_get_calls: z.number().int().min(0).max(255), result_get_calls: z.number().int().min(0).max(255),
  inprogress_get_calls: z.number().int().min(0).max(255),
  result_status: z.enum(["NOT_READ", "PENDING", "PARTIAL", "COMPLETE", "UNVERIFIED"]),
  result_reason: z.enum(OWNER_WAN_T2V_GENERATION_RESULT_REASONS).nullable()
}).strict() satisfies z.ZodType<OwnerWanT2vGenerationDiagnostic>;
const artifactSchema = z.object({ url: z.string().url().max(4_096).refine(isSafeUploadReferenceUrl),
  mime_type: z.enum(["video/mp4", "video/quicktime"]).nullable(), mime_source: z.enum(["URL_EXTENSION", "UNKNOWN"]),
  message_id: z.string().regex(SAFE_ID), message_object_id: z.string().regex(SAFE_ID),
  object_index: z.number().int().min(0).max(63), model_echo: z.enum(["MATCHED", "UNKNOWN"]), object_type: z.literal("video")
}).strict().superRefine((artifact, context) => {
  if ((artifact.mime_type === null) !== (artifact.mime_source === "UNKNOWN")) {
    context.addIssue({ code: "custom", path: ["mime_source"], message: "URL-derived MIME hint and source must agree." });
  }
}) satisfies z.ZodType<OwnerWanT2vVideoArtifact>;
const generationOutputSchema = z.object({
  status: z.enum(["completed", "partial_results"]), status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"),
  backend_acceptance: z.literal("UNPROVEN"), provider_terminal_status: z.literal("UNPROVEN"), model_id: z.literal("wan_30_reference"),
  parameters: tenParametersSchema, cost_inputs: z.object({ resolution: z.literal("480P"), video_duration: z.literal(2),
    duration: z.literal(0), rendering_speed: z.literal("basic") }).strict(),
  cost_input_confidence: z.literal("UI_QUOTE_CALLER_OBSERVED_SINGLE_TUPLE_NOT_BILLING"),
  recovery_id: recoveryIdSchema, observed_artifact_count: z.number().int().min(0).max(MAX_RESULTS),
  offset: z.number().int().min(0).max(MAX_RESULTS), page_size: z.literal(PAGE_SIZE), artifacts: z.array(artifactSchema).max(PAGE_SIZE),
  has_more: z.boolean(), next_offset: z.number().int().min(1).max(MAX_RESULTS).nullable(), diagnostic: diagnosticSchema
}).strict().superRefine((result, context) => {
  if (result.has_more !== (result.next_offset !== null) || (result.has_more && result.next_offset !== result.offset + result.artifacts.length) ||
      result.offset + result.artifacts.length > result.observed_artifact_count) {
    context.addIssue({ code: "custom", path: ["has_more"], message: "Local page metadata is inconsistent." });
  }
});
const uploadOutputSchema = z.object({ status: z.literal("uploaded"), image_handle: imageHandleSchema,
  model_id: z.literal("wan_30_reference"), mime_type: z.enum(["image/png", "image/jpeg"]), size: z.number().int().min(1).max(MAX_IMAGE_BYTES),
  sha256: z.string().regex(SHA256), width: z.number().int().min(1).max(8_000), height: z.number().int().min(1).max(8_000),
  expires_in_seconds: z.number().int().min(0).max(3_600), metadata_confidence: z.literal("LOCAL_STRUCTURAL_METADATA_ONLY"),
  upload_binding_confidence: z.literal("IMPLEMENTATION_INFERENCE_NOT_UI_MULTIPART_OBSERVED") }).strict();
const recoveryItemSchema = z.object({ recovery_id: recoveryIdSchema, created_at: z.iso.datetime(), model_id: z.literal("wan_30_reference"),
  status: z.enum(["outcome_unknown", "partial_results"]), observed_artifact_count: z.number().int().min(0).max(MAX_RESULTS),
  diagnostic: diagnosticSchema }).strict();
const recoveryListOutputSchema = z.object({ recoveries: z.array(recoveryItemSchema).max(128) }).strict();

export const OWNER_WAN30_REFERENCE_TOOL_INPUT_SCHEMAS = Object.freeze({ parameters: emptyInputSchema, upload: uploadInputSchema,
  generate: generateInputSchema, reconcile: reconcileInputSchema, list_recoveries: listRecoveriesInputSchema,
  result_page: resultPageInputSchema });
export const OWNER_WAN30_REFERENCE_TOOL_OUTPUT_SCHEMAS = Object.freeze({ parameters: sourceOutputSchema, upload: uploadOutputSchema,
  generate: generationOutputSchema, reconcile: generationOutputSchema, list_recoveries: recoveryListOutputSchema,
  result_page: generationOutputSchema });

export interface RegisterSyntxOwnerWan30ReferenceVideoToolsOptions {
  readonly generationService: Pick<OwnerWan30ReferenceGenerationService,
    "uploadReferenceImage" | "generate" | "reconcile" | "listRecoveries" | "getResultPage">;
}

export function registerSyntxOwnerWan30ReferenceVideoTools(server: McpServer,
  optionsInput: RegisterSyntxOwnerWan30ReferenceVideoToolsOptions | unknown): void {
  const options = snapshotOptions(optionsInput);
  server.registerTool(SYNTX_GET_WAN30_REFERENCE_PARAMETERS_TOOL_NAME, {
    title: "Get WAN 3.0 Reference parameters",
    description: "Returns the single observed Reference UI request and selected-mode quote keys; it does not claim full control constraints, defaults, provider acceptance, or billing.",
    inputSchema: emptyInputSchema, outputSchema: sourceOutputSchema,
    annotations: { title: "Get WAN 3.0 Reference parameters", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    if (!emptyInputSchema.safeParse(snapshotSafeInput(input)).success) return errorResult({ error: { code: "INVALID_REQUEST", message: ERROR_MESSAGES.INVALID_REQUEST } });
    return structured(parseSafeOutput(sourceOutputSchema, SOURCE));
  });

  server.registerTool(SYNTX_OWNER_UPLOAD_WAN30_REFERENCE_IMAGE_TOOL_NAME, {
    title: "Upload WAN 3.0 Reference image",
    description: "Uploads one bounded PNG/JPEG into a process-local owner image reference. Upload routing fields are an implementation inference, not observed UI multipart fields; uncertain uploads are not retried.",
    inputSchema: uploadInputSchema, outputSchema: uploadOutputSchema,
    annotations: { title: "Upload WAN 3.0 Reference image", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = uploadInputSchema.safeParse(snapshotSafeInput(input));
    if (!parsed.success) return toolErrorResult(undefined, "INVALID_REQUEST", "upload");
    try {
      const result = await options.generationService.uploadReferenceImage({ attemptId: parsed.data.link_attempt_id,
        content_base64: parsed.data.content_base64, filename: parsed.data.filename, mime_type: parsed.data.mime_type }, signal);
      return structured(parseSafeOutput(uploadOutputSchema, result));
    } catch (error) { return toolErrorResult(error, "UPLOAD_REJECTED", "upload"); }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_WAN30_REFERENCE_VIDEO_TOOL_NAME, {
    title: "Generate WAN 3.0 Reference video",
    description: "Submits one exact observed Reference tuple with an opaque owner image handle after fresh account/access checks. Outcomes may be paid and are never replayed; reconcile an uncertain recovery.",
    inputSchema: generateInputSchema, outputSchema: generationOutputSchema,
    annotations: { title: "Generate WAN 3.0 Reference video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = generateInputSchema.safeParse(snapshotSafeInput(input));
    if (!parsed.success) return toolErrorResult(undefined, "INVALID_REQUEST", "generation");
    let intent: OwnerWan30ReferenceGenerationIntent;
    try { intent = normalizeOwnerWan30ReferenceGenerationIntent({ prompt: parsed.data.prompt, parameters: parsed.data.parameters }).intent; }
    catch { return toolErrorResult(undefined, "INVALID_REQUEST", "generation"); }
    let result: unknown;
    try {
      result = await options.generationService.generate({ attemptId: parsed.data.link_attempt_id,
        input: intent, image_handle: parsed.data.image_handle }, signal);
    } catch (error) { return toolErrorResult(error, "PRE_DISPATCH_FAILED", "generation"); }
    try { return structured(parseSafeOutput(generationOutputSchema, result)); }
    catch { return postDispatchOutputError(result); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_WAN30_REFERENCE_VIDEO_TOOL_NAME, {
    title: "Reconcile WAN 3.0 Reference video", description: "GET-only reconciliation for one exact owner attempt and process-local recovery; it never starts or repeats generation.",
    inputSchema: reconcileInputSchema, outputSchema: generationOutputSchema,
    annotations: { title: "Reconcile WAN 3.0 Reference video", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = reconcileInputSchema.safeParse(snapshotSafeInput(input));
    if (!parsed.success) return toolErrorResult(undefined, "INVALID_REQUEST", "generation");
    try {
      const result = await options.generationService.reconcile({ attemptId: parsed.data.link_attempt_id,
        recovery_id: parsed.data.recovery_id }, signal);
      return structured(parseSafeOutput(generationOutputSchema, result));
    } catch (error) { return toolErrorResult(error, "PRE_DISPATCH_FAILED", "generation"); }
  });

  server.registerTool(SYNTX_OWNER_LIST_WAN30_REFERENCE_RECOVERIES_TOOL_NAME, {
    title: "List WAN 3.0 Reference recoveries", description: "Reads bounded process-local recovery summaries for the exact linked owner attempt; omits prompts, artifacts and private context.",
    inputSchema: listRecoveriesInputSchema, outputSchema: recoveryListOutputSchema,
    annotations: { title: "List WAN 3.0 Reference recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    const parsed = listRecoveriesInputSchema.safeParse(snapshotSafeInput(input));
    if (!parsed.success) return toolErrorResult(undefined, "INVALID_REQUEST", "list");
    try {
      const result = await options.generationService.listRecoveries({ attemptId: parsed.data.link_attempt_id,
        ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }) });
      return structured(parseSafeOutput(recoveryListOutputSchema, result));
    } catch (error) { return toolErrorResult(error, "SERVICE_BUSY", "list"); }
  });

  server.registerTool(SYNTX_OWNER_GET_WAN30_REFERENCE_RESULT_PAGE_TOOL_NAME, {
    title: "Get WAN 3.0 Reference result page", description: "Reads one page from the process-local observed-result cache. Local availability is not provider completion or acceptance.",
    inputSchema: resultPageInputSchema, outputSchema: generationOutputSchema,
    annotations: { title: "Get WAN 3.0 Reference result page", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input, { signal }) => {
    const parsed = resultPageInputSchema.safeParse(snapshotSafeInput(input));
    if (!parsed.success) return toolErrorResult(undefined, "INVALID_REQUEST", "generation");
    try {
      const result = await options.generationService.getResultPage({ attemptId: parsed.data.link_attempt_id,
        recovery_id: parsed.data.recovery_id, ...(parsed.data.offset === undefined ? {} : { offset: parsed.data.offset }) }, signal);
      return structured(parseSafeOutput(generationOutputSchema, result));
    } catch (error) { return toolErrorResult(error, "PRE_DISPATCH_FAILED", "generation"); }
  });
}

const ERROR_MESSAGES: Record<OwnerWan30ReferenceGenerationServiceErrorCode, string> = {
  INVALID_REQUEST: "The WAN 3.0 Reference request is invalid.", SERVICE_CLOSED: "The owner WAN 3.0 Reference service is closed.",
  SERVICE_BUSY: "The owner WAN 3.0 Reference service is busy.", PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.",
  MODEL_BINDING_MISMATCH: "The exact WAN 3.0 Reference model profile is unavailable.", PREFLIGHT_FAILED: "Current account or model access could not be verified.",
  UPLOAD_REJECTED: "The reference image upload was rejected before a usable handle was issued.",
  UPLOAD_OUTCOME_UNKNOWN: "The reference image upload outcome is unknown; do not retry this upload.",
  REFERENCE_UNAVAILABLE: "The reference image handle is unavailable or does not belong to this attempt.",
  REFERENCE_EXPIRED: "The reference image handle expired; upload a new image before generating.",
  INTENT_ALREADY_CLAIMED: "This Reference intent already has an unresolved outcome.",
  PRE_DISPATCH_FAILED: "The generation request was not safely dispatched.",
  OUTCOME_UNKNOWN: "The generation request may have been dispatched; reconcile its recovery and do not retry.",
  RECOVERY_NOT_FOUND: "The Reference recovery is unavailable or expired."
};

function toolErrorResult(error: unknown, fallback: OwnerWan30ReferenceGenerationServiceErrorCode,
  surface: "upload" | "generation" | "list"): CallToolResult {
  let code = fallback, recoveryId: string | undefined, diagnostic: Record<string, unknown> | undefined;
  if (!isProxyObject(error) && error instanceof OwnerWan30ReferenceGenerationServiceError) {
    const candidateCode = ownData(error, "code");
    if (typeof candidateCode === "string" && (OWNER_WAN30_REFERENCE_GENERATION_ERROR_CODES as readonly string[]).includes(candidateCode)) {
      code = candidateCode as OwnerWan30ReferenceGenerationServiceErrorCode;
    }
    const candidateId = ownData(error, "recovery_id");
    if (typeof candidateId === "string" && RECOVERY_ID.test(candidateId)) recoveryId = candidateId;
    if (code === "OUTCOME_UNKNOWN") {
      const parsed = diagnosticSchema.safeParse(ownData(error, "diagnostic"));
      if (parsed.success) diagnostic = parsed.data as Record<string, unknown>;
    }
  }
  const message = surface === "list" && code !== "INVALID_REQUEST" && code !== "SERVICE_CLOSED" && code !== "PRINCIPAL_NOT_LINKED"
    ? ERROR_MESSAGES.SERVICE_BUSY : ERROR_MESSAGES[code];
  return errorResult({ error: { code, message, ...(code === "OUTCOME_UNKNOWN" && recoveryId ? { recovery_id: recoveryId } : {}),
    ...(code === "OUTCOME_UNKNOWN" && diagnostic ? { diagnostic } : {}) } });
}
function postDispatchOutputError(value: unknown): CallToolResult {
  let recoveryId: string | undefined, diagnostic: Record<string, unknown> | undefined;
  if (value && typeof value === "object" && !types.isProxy(value)) {
    const candidateId = ownData(value, "recovery_id");
    if (typeof candidateId === "string" && RECOVERY_ID.test(candidateId)) recoveryId = candidateId;
    const parsed = diagnosticSchema.safeParse(ownData(value, "diagnostic"));
    if (parsed.success) diagnostic = parsed.data as Record<string, unknown>;
  }
  return errorResult({ error: { code: "OUTCOME_UNKNOWN", message: ERROR_MESSAGES.OUTCOME_UNKNOWN,
    ...(recoveryId ? { recovery_id: recoveryId } : {}), ...(diagnostic ? { diagnostic } : {}) } });
}
function snapshotOptions(value: unknown): RegisterSyntxOwnerWan30ReferenceVideoToolsOptions {
  const options = readExactRecord(value, ["generationService"]);
  if (!isOwnerWan30ReferenceGenerationService(options.generationService)) throw new Error("WAN30_REFERENCE_SERVICE_COMPOSITION_INVALID");
  return Object.freeze({ generationService: options.generationService });
}
function readExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) throw new TypeError("INVALID_RECORD");
  const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) throw new TypeError("INVALID_RECORD");
    result[key] = descriptors[key]!.value;
  }
  if ((prototype !== Object.prototype && prototype !== null) || keys.some((key) => !Object.hasOwn(result, key))) throw new TypeError("INVALID_RECORD");
  return result;
}
function snapshotSafeInput(value: unknown): unknown { try { return snapshotJson(value, 0, { nodes: 0 }); } catch { return undefined; } }
function snapshotJson(value: unknown, depth: number, budget: { nodes: number }): unknown {
  budget.nodes += 1;
  if (budget.nodes > 50_000 || depth > 32) throw new TypeError("invalid input");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new TypeError("invalid number"); return value; }
  if (!value || typeof value !== "object" || types.isProxy(value)) throw new TypeError("invalid object");
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError("invalid array");
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" && (typeof key !== "string" ||
      !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable))) {
      throw new TypeError("invalid array");
    }
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError("invalid array item");
      result.push(snapshotJson(descriptor.value, depth + 1, budget));
    }
    return result;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("invalid object prototype");
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) throw new TypeError("invalid property");
    result[key] = snapshotJson(descriptors[key]!.value, depth + 1, budget);
  }
  return result;
}
function parseSafeOutput(schema: z.ZodType, value: unknown): Record<string, unknown> {
  const parsed = schema.safeParse(value);
  if (!parsed.success || !parsed.data || typeof parsed.data !== "object") throw new Error("WAN30_REFERENCE_OUTPUT_INVALID");
  return parsed.data as Record<string, unknown>;
}
function structured(value: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}
function errorResult(value: object): CallToolResult { return { isError: true, content: [{ type: "text", text: JSON.stringify(value) }] }; }
function ownData(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}
function isProxyObject(value: unknown): value is object { return Boolean(value) && typeof value === "object" && types.isProxy(value); }
function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
