import { types } from "node:util";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import {
  getOwnerSunoTrackOperationParameterSource,
  normalizeOwnerSunoTrackOperationParameters,
  OWNER_SUNO_TRACK_OPERATION_MODEL_IDS,
  type OwnerSunoTrackOperationModel,
  type OwnerSunoTrackOperationRequest
} from "../application/owner-suno-track-operation-parameters.js";
import {
  isOwnerSunoGenerationService,
  OwnerSunoGenerationServiceError,
  type OwnerSunoGenerationService
} from "../application/owner-suno-generation-service.js";
import { OwnerSunoTrackOperationServiceError } from "../application/owner-suno-track-operation-generation-service.js";

const SOURCE = getOwnerSunoTrackOperationParameterSource();
const MODELS = OWNER_SUNO_TRACK_OPERATION_MODEL_IDS;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const TRACK_HANDLE = /^track_[0-9a-f-]{36}$/u;
const RECOVERY = /^suno_track_operation_recovery_[0-9a-f-]{36}$/u;
const PAGE_SIZE = 64;
const MAX_ARTIFACTS = 4_096;
const GAP_CODES = Object.freeze([
  "HISTORY_UNVERIFIED", "HISTORY_INCOMPLETE", "HISTORY_EMPTY", "OWNER_ACK_MISSING", "OWNER_ACK_MISMATCH",
  "OWNER_ACK_AMBIGUOUS", "BOT_RESULT_NOT_OBSERVED", "AUDIO_OBJECT_IDS_INVALID", "AUDIO_MODEL_ECHO_MISMATCH",
  "ENVELOPE_SHAPE_INVALID", "OUTER_MESSAGE_ID_MISMATCH", "NOT_BOT_MESSAGE", "PROVIDER_CHAT_ID_MISMATCH",
  "UNRECOGNIZED_MESSAGE_FIELDS", "MESSAGE_OBJECT_ARRAY_INVALID", "MESSAGE_OBJECT_ARRAY_EMPTY", "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT",
  "UNRECOGNIZED_OBJECT_FIELDS", "OBJECT_ENTRY_INVALID", "OBJECT_ID_UNAVAILABLE", "OBJECT_ID_DUPLICATE", "OBJECT_ID_UNEXPECTED",
  "EXPECTED_OBJECT_ID_MISSING", "OBJECT_MESSAGE_ID_MISMATCH", "OBJECT_TYPE_UNSUPPORTED", "OBJECT_INCOMPLETE",
  "OBJECT_COMPLETION_UNKNOWN", "OBJECT_URL_MISSING", "OBJECT_URL_INVALID", "OBJECT_URL_UNSAFE", "MIME_TYPE_UNKNOWN",
  "MODEL_TYPE_UNAVAILABLE", "MODEL_TYPE_MISMATCH", "AUDIO_RESULT_UNVERIFIED", "RESULT_GET_UNAVAILABLE", "RESULT_LIMIT_EXCEEDED",
  "BOT_ERROR_OBSERVED"
] as const);

export const SYNTX_GET_SUNO_TRACK_OPERATION_PARAMETERS_TOOL_NAME = "syntx_get_suno_track_operation_parameters" as const;
export const SYNTX_OWNER_COVER_SUNO_AUDIO_TOOL_NAME = "syntx_owner_cover_suno_audio" as const;
export const SYNTX_OWNER_EXTEND_SUNO_AUDIO_TOOL_NAME = "syntx_owner_extend_suno_audio" as const;
export const SYNTX_OWNER_RECONCILE_SUNO_TRACK_OPERATION_TOOL_NAME = "syntx_owner_reconcile_suno_track_operation" as const;
export const SYNTX_OWNER_LIST_SUNO_TRACK_OPERATION_RECOVERIES_TOOL_NAME = "syntx_owner_list_suno_track_operation_recoveries" as const;
export const SYNTX_OWNER_GET_SUNO_TRACK_OPERATION_RESULT_PAGE_TOOL_NAME = "syntx_owner_get_suno_track_operation_result_page" as const;
export const OWNER_SUNO_TRACK_OPERATION_TOOL_NAMES = Object.freeze([
  SYNTX_GET_SUNO_TRACK_OPERATION_PARAMETERS_TOOL_NAME,
  SYNTX_OWNER_COVER_SUNO_AUDIO_TOOL_NAME,
  SYNTX_OWNER_EXTEND_SUNO_AUDIO_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_SUNO_TRACK_OPERATION_TOOL_NAME,
  SYNTX_OWNER_LIST_SUNO_TRACK_OPERATION_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_GET_SUNO_TRACK_OPERATION_RESULT_PAGE_TOOL_NAME
] as const);

const attemptSchema = z.string().regex(ATTEMPT).describe("Exact current owner-link attempt.");
const trackHandleSchema = z.string().regex(TRACK_HANDLE).describe("Opaque owner-bound Suno track handle.");
const modelSchema = z.enum(MODELS);
const textSchema = (max: number, nonblank = false) => z.string().max(max)
  .refine(isWellFormedUnicode, "Text must contain well-formed Unicode.")
  .refine((value) => !nonblank || value.trim().length > 0, "Prompt must not be blank.");
const commonShape = {
  link_attempt_id: attemptSchema,
  model_id: modelSchema,
  track_handle: trackHandleSchema,
  prompt: textSchema(SOURCE.controls.prompt.custom_max, true),
  is_custom_mode: z.boolean(),
  is_instrumental: z.literal(false).describe("Current Suno cover/extend UI admission: false only; form build 1793202992, suno.js SHA-256 7861b84e849dafd787bd484dd99b1dd6383d115d1398071b853fc6ee2bd609ae. This is a local UI policy, not a claim that the provider rejects true."),
  negative_tags: textSchema(SOURCE.controls.negative_tags.local_max),
  styles: textSchema(SOURCE.controls.styles.max),
  title: textSchema(SOURCE.controls.title.max)
};
const coverInputSchema = z.object(commonShape).strict().superRefine((input, context) => {
  const normalized = normalizeRequest(toNormalizedInput(input, "cover"));
  if (!normalized.success) context.addIssue({ code: "custom", message: "The explicit Suno cover request is invalid." });
});
const extendInputSchema = z.object({ ...commonShape,
  continue_at: z.number().finite().min(0).multipleOf(0.1)
}).strict().superRefine((input, context) => {
  const normalized = normalizeRequest(toNormalizedInput(input, "extend"));
  if (!normalized.success) context.addIssue({ code: "custom", message: "The explicit Suno extend request is invalid." });
});
const recoveryIdSchema = z.string().regex(RECOVERY);
const reconcileInputSchema = z.object({ link_attempt_id: attemptSchema, recovery_id: recoveryIdSchema }).strict();
const listRecoveriesInputSchema = z.object({ link_attempt_id: attemptSchema, limit: z.number().int().min(1).max(128).optional() }).strict();
const resultPageInputSchema = z.object({ link_attempt_id: attemptSchema, recovery_id: recoveryIdSchema,
  offset: z.number().int().min(0).max(MAX_ARTIFACTS).optional() }).strict();
const parametersInputSchema = z.object({}).strict();

const sourcePinsSchema = z.object({
  public_catalog_version: z.literal(SOURCE.source_pins.public_catalog_version),
  public_models_sha256: z.literal(SOURCE.source_pins.public_models_sha256),
  settings_inventory_version: z.literal(SOURCE.source_pins.settings_inventory_version),
  form: z.object({ build_id: z.literal(SOURCE.source_pins.form.build_id), module: z.literal(SOURCE.source_pins.form.module),
    bytes: z.literal(SOURCE.source_pins.form.bytes), sha256: z.literal(SOURCE.source_pins.form.sha256) }).strict(),
  settings_helper: z.object({ module: z.literal(SOURCE.source_pins.settings_helper.module),
    bytes: z.literal(SOURCE.source_pins.settings_helper.bytes), sha256: z.literal(SOURCE.source_pins.settings_helper.sha256) }).strict(),
  cost_helper: z.object({ module: z.literal(SOURCE.source_pins.cost_helper.module),
    bytes: z.literal(SOURCE.source_pins.cost_helper.bytes), sha256: z.literal(SOURCE.source_pins.cost_helper.sha256) }).strict(),
  cost_service: z.object({ module: z.literal(SOURCE.source_pins.cost_service.module),
    bytes: z.literal(SOURCE.source_pins.cost_service.bytes), sha256: z.literal(SOURCE.source_pins.cost_service.sha256) }).strict()
}).strict();
const modelSourceSchema = (model: OwnerSunoTrackOperationModel) => z.object({ model_id: z.literal(model), ai_name: z.literal("suno"),
  active: z.literal(true), defaults_status: z.literal("UNKNOWN"), settings_limits: z.object({
    simple_mode_prompt_length: z.literal(500), custom_mode_prompt_length: z.literal(5_000),
    style_prompt_limit: z.literal(1_000), title_limit: z.literal(80)
  }).strict() }).strict();
const parameterSourceSchema = z.object({
  profile_id: z.literal(SOURCE.profile_id), status: z.literal(SOURCE.status), source_pins: sourcePinsSchema,
  current_ui_admission: z.object({
    status: z.literal(SOURCE.current_ui_admission.status),
    source_build_id: z.literal(SOURCE.current_ui_admission.source_build_id),
    form: z.object({ module: z.literal(SOURCE.current_ui_admission.form.module), bytes: z.literal(SOURCE.current_ui_admission.form.bytes),
      sha256: z.literal(SOURCE.current_ui_admission.form.sha256) }).strict(),
    model_ids: z.tuple([z.literal("V6"), z.literal("V6_wild")]),
    modes: z.tuple([z.literal("cover"), z.literal("extend")]),
    is_instrumental: z.object({ allowed_values: z.tuple([z.literal(false)]),
      policy_reason: z.literal(SOURCE.current_ui_admission.is_instrumental.policy_reason) }).strict()
  }).strict(),
  model_ids: z.tuple([z.literal("V6"), z.literal("V6_wild")]), modes: z.tuple([z.literal("cover"), z.literal("extend")]),
  models: z.object({ V6: modelSourceSchema("V6"), V6_wild: modelSourceSchema("V6_wild") }).strict(),
  controls: z.object({
    prompt: z.object({ measure: z.literal("UTF16_CODE_UNITS"), simple_max: z.literal(500), custom_max: z.literal(5_000),
      nonblank: z.literal(true), bound_label: z.literal("PINNED_PUBLIC_CATALOG_RESOURCE_LIMIT_NOT_CURRENT_UI_QUOTE") }).strict(),
    negative_tags: z.object({ local_max: z.literal(5_000), measure: z.literal("UTF16_CODE_UNITS"),
      bound_label: z.literal("LOCAL_RESOURCE_BOUND_NOT_UI_LIMIT"), source_ui_limit: z.literal("UNKNOWN") }).strict(),
    styles: z.object({ max: z.literal(1_000), bound_label: z.literal("PINNED_PUBLIC_CATALOG_RESOURCE_LIMIT_NOT_CURRENT_UI_QUOTE") }).strict(),
    title: z.object({ max: z.literal(80), bound_label: z.literal("PINNED_PUBLIC_CATALOG_RESOURCE_LIMIT_NOT_CURRENT_UI_QUOTE") }).strict(),
    continue_at: z.object({ measure: z.literal("SECONDS"), minimum: z.literal(0), step: z.literal(0.1),
      maximum: z.literal("SOURCE_DURATION_NOT_AVAILABLE_TO_SERVICE"), ui_default: z.literal(0) }).strict()
  }).strict(),
  track_binding: z.object({ public_input: z.literal("OPAQUE_TRACK_HANDLE_ONLY"),
    resolved_model_policy: z.literal("MUST_MATCH_REQUEST_MODEL_ID"), default_ttl_seconds: z.literal(900), maximum_ttl_seconds: z.literal(1_800) }).strict(),
  cost_projection: z.object({ query_keys: z.tuple([z.literal("ai_name"), z.literal("model_type")]), ai_name: z.literal("suno"),
    model_type_source: z.literal("settings_candidate.model_type"), confidence: z.literal("FORM_COST_INPUT_PROJECTION_NOT_QUOTE_OR_CAP") }).strict(),
  effective_defaults: z.literal("UNKNOWN"), runtime_usable: z.literal(false), dispatch_allowed: z.literal(false),
  backend_acceptance: z.literal("UNPROVEN")
}).strict();

const diagnosticSchema = z.object({
  phase: z.enum(["VALIDATE_REQUEST", "RESOLVE_PRINCIPAL", "PREPARE_CANDIDATE", "PREFLIGHT", "CHAT_CREATE",
    "GENERATION_POST", "POST_ACK_KNOWN", "HISTORY_GET", "RESULT_GET", "RESULT_BINDING"]),
  post_started: z.boolean(), ack_known: z.boolean(), history_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "INCOMPLETE", "UNVERIFIED"]),
  owner_ack_status: z.enum(["NOT_READ", "MATCHED", "MISSING", "AMBIGUOUS", "MISMATCH"]),
  history_get_calls: z.number().int().min(0).max(255), result_get_calls: z.number().int().min(0).max(255),
  result_status: z.enum(["NOT_READ", "PENDING", "PARTIAL", "COMPLETE", "UNVERIFIED"]), gaps: z.array(z.enum(GAP_CODES)).max(128), counters_saturated: z.boolean()
}).strict();
const artifactSchema = z.object({ url: z.string().url().max(4_096).refine(isSafeUploadReferenceUrl), mime_type: z.enum(["audio/mpeg", "audio/wav", "audio/mp4"]).nullable(),
  mime_source: z.enum(["URL_EXTENSION_LOCAL_POLICY", "UNKNOWN"]), object_type: z.literal("audio"), model_echo: z.enum(["MATCHED", "UNKNOWN"]) }).strict();
const resultSchema = z.object({ status: z.enum(["completed", "partial_results"]), mode: z.enum(["cover", "extend"]),
  status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"), backend_acceptance: z.literal("UNPROVEN"),
  provider_terminal_status: z.literal("UNPROVEN"), model_id: modelSchema,
  source_binding: z.object({ profile_id: z.literal(SOURCE.profile_id), source_pins: sourcePinsSchema }).strict(),
  recovery_id: recoveryIdSchema, observed_artifact_count: z.number().int().min(0).max(MAX_ARTIFACTS),
  offset: z.number().int().min(0).max(MAX_ARTIFACTS), page_size: z.literal(PAGE_SIZE), artifacts: z.array(artifactSchema).max(PAGE_SIZE),
  has_more: z.boolean(), next_offset: z.number().int().min(1).max(MAX_ARTIFACTS).nullable(), diagnostic: diagnosticSchema
}).strict().superRefine((result, context) => {
  if (result.has_more !== (result.next_offset !== null) ||
      (result.has_more && result.next_offset !== result.offset + result.artifacts.length) ||
      result.offset + result.artifacts.length > result.observed_artifact_count) {
    context.addIssue({ code: "custom", path: ["has_more"], message: "Observed result paging metadata is inconsistent." });
  }
});
const recoveryItemSchema = z.object({ recovery_id: recoveryIdSchema, created_at: z.iso.datetime(), model_id: modelSchema,
  mode: z.enum(["cover", "extend"]), status: z.enum(["outcome_unknown", "partial_results", "upstream_error_observed"]),
  observed_artifact_count: z.number().int().min(0).max(MAX_ARTIFACTS), diagnostic: diagnosticSchema }).strict();
const recoveryListSchema = z.object({ recoveries: z.array(recoveryItemSchema).max(128) }).strict();

export const OWNER_SUNO_TRACK_OPERATION_TOOL_INPUT_SCHEMAS = Object.freeze({ parameters: parametersInputSchema,
  cover: coverInputSchema, extend: extendInputSchema, reconcile: reconcileInputSchema, list_recoveries: listRecoveriesInputSchema,
  result_page: resultPageInputSchema });
export const OWNER_SUNO_TRACK_OPERATION_TOOL_OUTPUT_SCHEMAS = Object.freeze({ parameters: parameterSourceSchema,
  cover: resultSchema, extend: resultSchema, reconcile: resultSchema, list_recoveries: recoveryListSchema, result_page: resultSchema });

export type OwnerSunoTrackOperationServicePort = Pick<OwnerSunoGenerationService,
  "getTrackOperationParametersSource" | "generateTrackOperation" | "reconcileTrackOperation" |
  "listTrackOperationRecoveries" | "getTrackOperationResultPage">;
export interface RegisterSyntxOwnerSunoTrackOperationToolsOptions { readonly generationService: OwnerSunoTrackOperationServicePort; }

export function registerSyntxOwnerSunoTrackOperationTools(server: McpServer, optionsInput: RegisterSyntxOwnerSunoTrackOperationToolsOptions | unknown): void {
  const options = snapshotOptions(optionsInput);
  server.registerTool(SYNTX_GET_SUNO_TRACK_OPERATION_PARAMETERS_TOOL_NAME, {
    title: "Get Suno cover and extend parameters",
    description: "Returns historical native source pins separately from current UI admission for cover/extend (form build 1793202992). The current UI admits is_instrumental=false for these track-operation modes; this does not establish a provider-side rejection rule. Runtime availability, dispatch permission, and provider acceptance remain unproven.",
    inputSchema: parametersInputSchema, outputSchema: parameterSourceSchema,
    annotations: { title: "Suno track-operation parameters", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async () => {
    try { return structured(parseOutput(parameterSourceSchema, options.generationService.getTrackOperationParametersSource())); }
    catch { return operationError("SERVICE_BUSY"); }
  });

  for (const mode of ["cover", "extend"] as const) {
    const toolName = mode === "cover" ? SYNTX_OWNER_COVER_SUNO_AUDIO_TOOL_NAME : SYNTX_OWNER_EXTEND_SUNO_AUDIO_TOOL_NAME;
    const inputSchema = mode === "cover" ? coverInputSchema : extendInputSchema;
    server.registerTool(toolName, {
      title: mode === "cover" ? "Create Suno cover" : "Extend Suno audio",
      description: `Submits one explicit Suno ${mode} request for a current owner-bound track handle. Current UI admission is is_instrumental=false only (build 1793202992, suno.js SHA-256 7861b84e849dafd787bd484dd99b1dd6383d115d1398071b853fc6ee2bd609ae); this is not a provider rejection claim. An uncertain outcome must be reconciled and never replayed.`,
      inputSchema, outputSchema: resultSchema,
      annotations: { title: mode === "cover" ? "Suno cover" : "Suno extend", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    }, async (rawInput, { signal }) => {
      const parsed = inputSchema.safeParse(snapshotSafeInput(rawInput));
      if (!parsed.success) return operationError("INVALID_REQUEST");
      const { link_attempt_id: attemptId, ...request } = parsed.data;
      let generated: unknown;
      try {
        generated = await options.generationService.generateTrackOperation({
          attemptId, request: { ...request, mode } as OwnerSunoTrackOperationRequest
        }, signal);
      } catch (error) { return operationFailure(error, "PRE_DISPATCH_FAILED"); }
      try { return structured(parseOutput(resultSchema, generated)); }
      catch { return postResultValidationError(generated); }
    });
  }

  server.registerTool(SYNTX_OWNER_RECONCILE_SUNO_TRACK_OPERATION_TOOL_NAME, {
    title: "Reconcile Suno track operation", description: "GET-only recovery for one exact owner attempt; it never starts or repeats a request.",
    inputSchema: reconcileInputSchema, outputSchema: resultSchema,
    annotations: { title: "Reconcile Suno track operation", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (rawInput, { signal }) => {
    const parsed = reconcileInputSchema.safeParse(snapshotSafeInput(rawInput));
    if (!parsed.success) return operationError("INVALID_REQUEST");
    try { return structured(parseOutput(resultSchema, await options.generationService.reconcileTrackOperation({
      attemptId: parsed.data.link_attempt_id, recovery_id: parsed.data.recovery_id
    }, signal))); } catch (error) { return operationFailure(error, "RECOVERY_NOT_FOUND"); }
  });

  server.registerTool(SYNTX_OWNER_LIST_SUNO_TRACK_OPERATION_RECOVERIES_TOOL_NAME, {
    title: "List Suno track-operation recoveries", description: "Lists bounded process-local recovery summaries for one exact owner attempt without prompts or audio URLs.",
    inputSchema: listRecoveriesInputSchema, outputSchema: recoveryListSchema,
    annotations: { title: "Suno operation recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (rawInput) => {
    const parsed = listRecoveriesInputSchema.safeParse(snapshotSafeInput(rawInput));
    if (!parsed.success) return recoveryListError("INVALID_REQUEST");
    try { return structured(parseOutput(recoveryListSchema, { recoveries: await options.generationService.listTrackOperationRecoveries({
      attemptId: parsed.data.link_attempt_id, ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit })
    }) })); } catch (error) { return operationFailure(error, "SERVICE_BUSY"); }
  });

  server.registerTool(SYNTX_OWNER_GET_SUNO_TRACK_OPERATION_RESULT_PAGE_TOOL_NAME, {
    title: "Get Suno track-operation result page", description: "Reads one page from the local observed audio-result cache and performs no generation or provider-terminal inference.",
    inputSchema: resultPageInputSchema, outputSchema: resultSchema,
    annotations: { title: "Suno operation result page", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (rawInput) => {
    const parsed = resultPageInputSchema.safeParse(snapshotSafeInput(rawInput));
    if (!parsed.success) return operationError("INVALID_REQUEST");
    try { return structured(parseOutput(resultSchema, await options.generationService.getTrackOperationResultPage({
      attemptId: parsed.data.link_attempt_id, recovery_id: parsed.data.recovery_id,
      ...(parsed.data.offset === undefined ? {} : { offset: parsed.data.offset })
    }))); } catch (error) { return operationFailure(error, "RECOVERY_NOT_FOUND"); }
  });
}

const ERROR_MESSAGES = Object.freeze({
  INVALID_REQUEST: "The Suno track-operation request is invalid.", SERVICE_CLOSED: "The owner Suno service is closed.",
  SERVICE_BUSY: "The owner Suno service is busy.", PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.",
  MODEL_BINDING_MISMATCH: "The selected Suno model profile is unavailable.", PREFLIGHT_FAILED: "Current account or model access could not be verified.",
  INTENT_ALREADY_CLAIMED: "This Suno track-operation intent has an unresolved or previously claimed outcome.",
  PRE_DISPATCH_FAILED: "The Suno request was not safely dispatched.",
  OUTCOME_UNKNOWN: "The Suno request may have been dispatched; reconcile its recovery and do not retry.",
  UPSTREAM_OPERATION_ERROR: "SYNTX reported an operation error for this Suno request; reconcile its recovery and do not retry.",
  RECOVERY_NOT_FOUND: "The Suno recovery is unavailable or expired."
} as const);
type ServiceErrorCode = keyof typeof ERROR_MESSAGES;
function normalizeRequest(input: unknown): { readonly success: true; readonly data: ReturnType<typeof normalizeOwnerSunoTrackOperationParameters> } | { readonly success: false } {
  try { return { success: true, data: normalizeOwnerSunoTrackOperationParameters(input) }; }
  catch { return { success: false }; }
}
function toNormalizedInput(input: Record<string, unknown>, mode: "cover" | "extend"): Record<string, unknown> {
  return { model_id: input.model_id, mode, track_handle: input.track_handle, prompt: input.prompt,
    is_custom_mode: input.is_custom_mode, is_instrumental: input.is_instrumental,
    negative_tags: input.negative_tags, styles: input.styles, title: input.title,
    ...(mode === "extend" ? { continue_at: input.continue_at } : {}) };
}
function snapshotOptions(value: unknown): RegisterSyntxOwnerSunoTrackOperationToolsOptions {
  const fields = readExactRecord(value, ["generationService"]);
  if (!isOwnerSunoGenerationService(fields.generationService) || !isTrackOperationService(fields.generationService)) {
    throw new Error("SUNO_TRACK_OPERATION_SERVICE_COMPOSITION_INVALID");
  }
  return Object.freeze({ generationService: fields.generationService });
}
function isTrackOperationService(value: unknown): value is OwnerSunoTrackOperationServicePort {
  return value !== null && typeof value === "object" && !types.isProxy(value) &&
    ["getTrackOperationParametersSource", "generateTrackOperation", "reconcileTrackOperation", "listTrackOperationRecoveries", "getTrackOperationResultPage"]
      .every((name) => typeof (value as Record<string, unknown>)[name] === "function");
}
function safeOperationError(error: unknown, fallback: ServiceErrorCode): ServiceErrorCode {
  const trustedError = error instanceof OwnerSunoTrackOperationServiceError || error instanceof OwnerSunoGenerationServiceError;
  const code = trustedError && !types.isProxy(error) ? ownData(error, "code") : undefined;
  return typeof code === "string" && Object.hasOwn(ERROR_MESSAGES, code) ? code as ServiceErrorCode : fallback;
}
function safeRecovery(error: unknown): string | undefined {
  if (!(error instanceof OwnerSunoTrackOperationServiceError || error instanceof OwnerSunoGenerationServiceError) ||
      types.isProxy(error) || !["OUTCOME_UNKNOWN", "UPSTREAM_OPERATION_ERROR"].includes(safeOperationError(error, "PRE_DISPATCH_FAILED"))) return undefined;
  const recovery = ownData(error, "recovery_id");
  return typeof recovery === "string" && recoveryIdSchema.safeParse(recovery).success ? recovery : undefined;
}
function safeDiagnostic(error: unknown): Record<string, unknown> | undefined {
  if (!(error instanceof OwnerSunoTrackOperationServiceError) || types.isProxy(error) ||
      safeOperationError(error, "PRE_DISPATCH_FAILED") !== "UPSTREAM_OPERATION_ERROR") return undefined;
  const candidate = ownData(error, "diagnostic");
  try { return parseOutput(diagnosticSchema, candidate); } catch { return undefined; }
}
function operationFailure(error: unknown, fallback: ServiceErrorCode): CallToolResult {
  const code = safeOperationError(error, fallback);
  const recovery = safeRecovery(error);
  const diagnostic = safeDiagnostic(error);
  if (code === "UPSTREAM_OPERATION_ERROR" && (!recovery || !diagnostic)) {
    return operationError("OUTCOME_UNKNOWN", recovery);
  }
  return operationError(code, recovery, diagnostic);
}
function postResultValidationError(value: unknown): CallToolResult {
  const candidate = value !== null && typeof value === "object" && !types.isProxy(value) ? ownData(value, "recovery_id") : undefined;
  const recovery = typeof candidate === "string" && recoveryIdSchema.safeParse(candidate).success ? candidate : undefined;
  return operationError("OUTCOME_UNKNOWN", recovery);
}
function operationError(code: ServiceErrorCode, recoveryId?: string, diagnostic?: Record<string, unknown>): CallToolResult {
  return errorResult({ error: { code, message: ERROR_MESSAGES[code], ...(recoveryId ? { recovery_id: recoveryId } : {}),
    ...(code === "UPSTREAM_OPERATION_ERROR" && diagnostic ? { diagnostic } : {}) } });
}
function recoveryListError(code: ServiceErrorCode): CallToolResult { return operationError(code); }
function readExactRecord(value: unknown, expected: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) throw new TypeError("INVALID_RECORD");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("INVALID_RECORD");
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !expected.includes(key) || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) throw new TypeError("INVALID_RECORD");
    result[key] = descriptors[key]!.value;
  }
  if (expected.some((key) => !Object.hasOwn(result, key))) throw new TypeError("INVALID_RECORD");
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
    if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable))) throw new TypeError("invalid array");
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) { const descriptor = descriptors[String(index)]; if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError("invalid item"); result.push(snapshotJson(descriptor.value, depth + 1, budget)); }
    return result;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("invalid record");
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(descriptors)) { if (typeof key !== "string" || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) throw new TypeError("invalid field"); Object.defineProperty(result, key, { value: snapshotJson(descriptors[key]!.value, depth + 1, budget), enumerable: true }); }
  return result;
}
function parseOutput(schema: z.ZodType, value: unknown): Record<string, unknown> {
  const parsed = schema.safeParse(snapshotSafeInput(value));
  if (!parsed.success || !parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) throw new Error("SUNO_TRACK_OPERATION_OUTPUT_SHAPE_INVALID");
  return parsed.data as Record<string, unknown>;
}
function ownData(value: object, key: string): unknown { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && "value" in descriptor ? descriptor.value : undefined; }
function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) { const unit = value.charCodeAt(index); if (unit >= 0xd800 && unit <= 0xdbff) { const next = value.charCodeAt(index + 1); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; index += 1; } else if (unit >= 0xdc00 && unit <= 0xdfff) return false; }
  return true;
}
function structured(value: object): CallToolResult { return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> }; }
function errorResult(value: object): CallToolResult { return { isError: true, content: [{ type: "text", text: JSON.stringify(value) }] }; }
