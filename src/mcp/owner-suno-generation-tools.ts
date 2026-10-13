import { types } from "node:util";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import {
  getOwnerSunoGenerationParameterSource,
  normalizeOwnerSunoGenerationParameters,
  OWNER_SUNO_GENERATION_MODEL_IDS,
  type OwnerSunoGenerationModel,
  type OwnerSunoGenerationRequest
} from "../application/owner-suno-generation-parameters.js";
import {
  isOwnerSunoGenerationService,
  OwnerSunoGenerationServiceError,
  type OwnerSunoGenerationService,
  type OwnerSunoGenerationServiceErrorCode
} from "../application/owner-suno-generation-service.js";

const SOURCE = getOwnerSunoGenerationParameterSource();
const MODELS = OWNER_SUNO_GENERATION_MODEL_IDS;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const MAX_ARTIFACTS = 4_096;
const PAGE_SIZE = 64;
// Keep this exact closed union aligned with OwnerSunoGenerationService.SERVICE_GAPS.
// Native-reader warnings stay observable; the MCP layer must not silently drop them.
const SUNO_GENERATION_GAP_CODES = Object.freeze([
  "HISTORY_UNVERIFIED", "HISTORY_INCOMPLETE", "HISTORY_EMPTY", "OWNER_ACK_MISSING", "OWNER_ACK_MISMATCH",
  "OWNER_ACK_AMBIGUOUS", "BOT_RESULT_NOT_OBSERVED", "AUDIO_OBJECT_IDS_INVALID", "AUDIO_MODEL_ECHO_MISMATCH",
  "ENVELOPE_SHAPE_INVALID", "OUTER_MESSAGE_ID_MISMATCH", "NOT_BOT_MESSAGE", "PROVIDER_CHAT_ID_MISMATCH",
  "UNRECOGNIZED_MESSAGE_FIELDS", "MESSAGE_OBJECT_ARRAY_INVALID", "MESSAGE_OBJECT_ARRAY_EMPTY", "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT",
  "UNRECOGNIZED_OBJECT_FIELDS", "OBJECT_ENTRY_INVALID", "OBJECT_ID_UNAVAILABLE", "OBJECT_ID_DUPLICATE", "OBJECT_ID_UNEXPECTED",
  "EXPECTED_OBJECT_ID_MISSING", "OBJECT_MESSAGE_ID_MISMATCH", "OBJECT_TYPE_UNSUPPORTED", "OBJECT_INCOMPLETE",
  "OBJECT_COMPLETION_UNKNOWN", "OBJECT_URL_MISSING", "OBJECT_URL_INVALID", "OBJECT_URL_UNSAFE", "MIME_TYPE_UNKNOWN",
  "MODEL_TYPE_UNAVAILABLE", "MODEL_TYPE_MISMATCH", "AUDIO_RESULT_UNVERIFIED", "RESULT_GET_UNAVAILABLE", "RESULT_LIMIT_EXCEEDED"
] as const);

export const SYNTX_GET_SUNO_GENERATE_PARAMETERS_TOOL_NAME = "syntx_get_suno_generate_parameters" as const;
export const SYNTX_OWNER_GENERATE_SUNO_AUDIO_TOOL_NAME = "syntx_owner_generate_suno_audio" as const;
export const SYNTX_OWNER_RECONCILE_SUNO_AUDIO_TOOL_NAME = "syntx_owner_reconcile_suno_audio" as const;
export const SYNTX_OWNER_LIST_SUNO_RECOVERIES_TOOL_NAME = "syntx_owner_list_suno_recoveries" as const;
export const SYNTX_OWNER_GET_SUNO_RESULT_PAGE_TOOL_NAME = "syntx_owner_get_suno_result_page" as const;
export const OWNER_SUNO_GENERATION_TOOL_NAMES = Object.freeze([
  SYNTX_GET_SUNO_GENERATE_PARAMETERS_TOOL_NAME,
  SYNTX_OWNER_GENERATE_SUNO_AUDIO_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_SUNO_AUDIO_TOOL_NAME,
  SYNTX_OWNER_LIST_SUNO_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_GET_SUNO_RESULT_PAGE_TOOL_NAME
] as const);

const attemptSchema = z.string().regex(ATTEMPT).describe("Exact current owner-link attempt; it cannot select another account.");
const modelSchema = z.enum(MODELS);
const promptSchema = (max: number) => z.string().min(1).max(max).refine((value) =>
  value.trim().length > 0 && isWellFormedUnicode(value), "Prompt must be nonblank well-formed Unicode within the selected mode bound.");
const sharedRequestShape = {
  link_attempt_id: attemptSchema,
  mode: z.literal("generate"),
  is_instrumental: z.boolean(),
  negative_tags: z.string().max(SOURCE.controls.negative_tags.local_max).refine(isWellFormedUnicode,
    "Negative tags exceed the local resource bound or contain malformed Unicode."),
  styles: z.string().max(SOURCE.controls.styles.max).refine(isWellFormedUnicode, "Styles exceed the source bound or contain malformed Unicode."),
  title: z.string().max(SOURCE.controls.title.max).refine(isWellFormedUnicode, "Title exceeds the source bound or contains malformed Unicode.")
};
const generateSchemaVariants = z.discriminatedUnion("is_custom_mode", [
  z.object({ ...sharedRequestShape, model_id: modelSchema, is_custom_mode: z.literal(false),
    prompt: promptSchema(SOURCE.controls.prompt.simple_max) }).strict(),
  z.object({ ...sharedRequestShape, model_id: modelSchema, is_custom_mode: z.literal(true),
    prompt: promptSchema(SOURCE.controls.prompt.custom_max) }).strict()
]);
const generateOneOf = (z.toJSONSchema(generateSchemaVariants, { target: "draft-7", io: "input" }) as { oneOf?: unknown }).oneOf;
if (!Array.isArray(generateOneOf) || generateOneOf.length !== 2) {
  throw new Error("SUNO_GENERATION_SCHEMA_BRANCHES_INVALID");
}
const generateInputSchema = z.object({ ...sharedRequestShape, model_id: modelSchema, is_custom_mode: z.boolean(),
  prompt: z.string().min(1).max(SOURCE.controls.prompt.custom_max) }).strict().superRefine((input, context) => {
  const parsed = generateSchemaVariants.safeParse(snapshotSafeInput(input));
  if (!parsed.success) for (const issue of parsed.error.issues) {
    context.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
  try { normalizeOwnerSunoGenerationParameters(toRequest(input)); }
  catch { context.addIssue({ code: "custom", message: "The explicit source-shaped Suno generate request is invalid." }); }
}).meta({ oneOf: generateOneOf });

const recoveryIdSchema = z.string().regex(/^suno_generation_recovery_[0-9a-f-]{36}$/u);
const reconcileInputSchema = z.object({ link_attempt_id: attemptSchema, recovery_id: recoveryIdSchema }).strict();
const listRecoveriesInputSchema = z.object({ link_attempt_id: attemptSchema, limit: z.number().int().min(1).max(128).optional() }).strict();
const resultPageInputSchema = z.object({ link_attempt_id: attemptSchema, recovery_id: recoveryIdSchema,
  offset: z.number().int().min(0).max(MAX_ARTIFACTS).optional() }).strict();
const parametersInputSchema = z.object({}).strict();

const pinsSchema = z.object({
  public_catalog_version: z.literal(SOURCE.source_pins.public_catalog_version),
  public_models_sha256: z.literal(SOURCE.source_pins.public_models_sha256),
  settings_inventory_version: z.literal(SOURCE.source_pins.settings_inventory_version),
  build_id: z.literal(SOURCE.source_pins.build_id),
  form_module: z.literal(SOURCE.source_pins.form_module),
  form_bytes: z.literal(SOURCE.source_pins.form_bytes),
  form_sha256: z.literal(SOURCE.source_pins.form_sha256)
}).strict();
const sourceModelOutputSchema = (model_id: OwnerSunoGenerationModel) => z.object({ model_id: z.literal(model_id),
  ai_name: z.literal("suno"), active: z.literal(true), defaults_status: z.literal("UNKNOWN"),
  model_value_settings_keys: z.tuple([z.literal("is_custom_mode"), z.literal("is_instrumental"),
    z.literal("model_type"), z.literal("negative_tags"), z.literal("styles"), z.literal("title")]),
  payload_field_keys: z.tuple([z.literal("model_type")]), settings_limits: z.object({
    simple_mode_prompt_length: z.literal(500), custom_mode_prompt_length: z.literal(5_000),
    style_prompt_limit: z.literal(1_000), title_limit: z.literal(80)
  }).strict()
}).strict();
const sourceOutputSchema = z.object({
  status: z.literal("CURRENT_B066_1B48_STATIC_SOURCE_CONTRACT"),
  source_pins: pinsSchema,
  model_ids: z.tuple([z.literal("V6"), z.literal("V6_wild")]),
  models: z.tuple([sourceModelOutputSchema("V6"), sourceModelOutputSchema("V6_wild")]),
  controls: z.object({
    mode: z.object({ supported_value: z.literal("generate") }).strict(),
    prompt: z.object({ measure: z.literal("UTF16_CODE_UNITS"), simple_max: z.literal(500), custom_max: z.literal(5_000),
      nonblank: z.literal(true), nonblank_policy: z.literal("LOCAL_VALIDATION_POLICY_NOT_UI_VALIDATOR"), effective_default: z.literal("UNKNOWN") }).strict(),
    is_custom_mode: z.object({ type: z.literal("boolean"), effective_default: z.literal("UNKNOWN") }).strict(),
    is_instrumental: z.object({ type: z.literal("boolean"), effective_default: z.literal("UNKNOWN") }).strict(),
    negative_tags: z.object({ local_max: z.literal(5_000), measure: z.literal("UTF16_CODE_UNITS"),
      bound_label: z.literal("LOCAL_RESOURCE_BOUND_NOT_UI_LIMIT"), source_ui_limit: z.literal("UNKNOWN") }).strict(),
    styles: z.object({ max: z.literal(1_000), effective_default: z.literal("UNKNOWN") }).strict(),
    title: z.object({ max: z.literal(80), effective_default: z.literal("UNKNOWN") }).strict()
  }).strict(),
  cost_projection: z.object({ declared_cost_query_keys: z.array(z.literal("version")).length(1),
    generation_value_mapping: z.literal("UNPROVEN_NOT_INCLUDED_IN_GENERATE_SETTINGS") }).strict(),
  effective_defaults: z.literal("UNKNOWN"), runtime_usable: z.literal(false), dispatch_allowed: z.literal(false), backend_acceptance: z.literal("UNPROVEN")
}).strict();
const diagnosticSchema = z.object({
  phase: z.enum(["VALIDATE_REQUEST", "RESOLVE_PRINCIPAL", "PREPARE_CANDIDATE", "PREFLIGHT", "CHAT_CREATE",
    "GENERATION_POST", "POST_ACK_KNOWN", "HISTORY_GET", "RESULT_GET", "RESULT_BINDING"]),
  post_started: z.boolean(), ack_known: z.boolean(),
  history_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "INCOMPLETE", "UNVERIFIED"]),
  owner_ack_status: z.enum(["NOT_READ", "MATCHED", "MISSING", "AMBIGUOUS", "MISMATCH"]),
  history_get_calls: z.number().int().min(0).max(255), result_get_calls: z.number().int().min(0).max(255),
  result_status: z.enum(["NOT_READ", "PENDING", "PARTIAL", "COMPLETE", "UNVERIFIED"]),
  gaps: z.array(z.enum(SUNO_GENERATION_GAP_CODES)).max(128), counters_saturated: z.boolean()
}).strict();
const artifactSchema = z.object({
  url: z.string().url().max(4_096).refine(isSafeUploadReferenceUrl),
  mime_type: z.enum(["audio/mpeg", "audio/wav", "audio/mp4"]).nullable(),
  mime_source: z.enum(["URL_EXTENSION_LOCAL_POLICY", "UNKNOWN"]),
  message_id: z.string().regex(SAFE_ID), message_object_id: z.string().regex(SAFE_ID),
  object_index: z.number().int().min(0).max(63), object_type: z.literal("audio"), model_echo: z.enum(["MATCHED", "UNKNOWN"])
}).strict();
const generationOutputSchema = z.object({
  status: z.enum(["completed", "partial_results"]), status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"),
  backend_acceptance: z.literal("UNPROVEN"), provider_terminal_status: z.literal("UNPROVEN"), model_id: modelSchema,
  parameters: z.object({ mode: z.literal("generate"), is_custom_mode: z.boolean(), is_instrumental: z.boolean() }).strict(),
  source_binding: z.object({ public_catalog_version: pinsSchema.shape.public_catalog_version,
    settings_inventory_version: pinsSchema.shape.settings_inventory_version, form_sha256: pinsSchema.shape.form_sha256 }).strict(),
  cost_inputs: z.object({ version: modelSchema }).strict(),
  cost_input_confidence: z.literal("PUBLIC_VERSION_KEY_LOCAL_PROJECTION_NOT_UI_QUOTE_OR_CAP"),
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
  status: z.enum(["outcome_unknown", "partial_results"]), observed_artifact_count: z.number().int().min(0).max(MAX_ARTIFACTS), diagnostic: diagnosticSchema }).strict();
const recoveryListOutputSchema = z.object({ recoveries: z.array(recoveryItemSchema).max(128) }).strict();

export const OWNER_SUNO_GENERATION_TOOL_INPUT_SCHEMAS = Object.freeze({ parameters: parametersInputSchema,
  generate: generateInputSchema, reconcile: reconcileInputSchema, list_recoveries: listRecoveriesInputSchema, result_page: resultPageInputSchema });
export const OWNER_SUNO_GENERATION_TOOL_OUTPUT_SCHEMAS = Object.freeze({ parameters: sourceOutputSchema,
  generate: generationOutputSchema, reconcile: generationOutputSchema, list_recoveries: recoveryListOutputSchema, result_page: generationOutputSchema });

export interface RegisterSyntxOwnerSunoGenerationToolsOptions {
  readonly generationService: OwnerSunoGenerationService;
}

export function registerSyntxOwnerSunoGenerationTools(server: McpServer,
  optionsInput: RegisterSyntxOwnerSunoGenerationToolsOptions | unknown): void {
  const options = snapshotOptions(optionsInput);
  server.registerTool(SYNTX_GET_SUNO_GENERATE_PARAMETERS_TOOL_NAME, {
    title: "Get Suno generate parameters", description: "Returns pinned static generate controls only. Effective defaults, runtime availability, dispatch permission, and provider acceptance remain unproven.",
    inputSchema: parametersInputSchema, outputSchema: sourceOutputSchema,
    annotations: { title: "Get Suno generate parameters", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async () => structured(parseOutput(sourceOutputSchema, sourceProjection())));

  server.registerTool(SYNTX_OWNER_GENERATE_SUNO_AUDIO_TOOL_NAME, {
    title: "Generate Suno audio", description: "Submits one explicit Suno generate request for the exact linked owner attempt. An uncertain result is not safe to retry; reconcile its recovery instead.",
    inputSchema: generateInputSchema, outputSchema: generationOutputSchema,
    annotations: { title: "Generate Suno audio", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = generateSchemaVariants.safeParse(snapshotSafeInput(input));
    if (!parsed.success) return generationErrorResult(undefined, "INVALID_REQUEST");
    const { link_attempt_id: _attempt, ...request } = parsed.data;
    let generated: unknown;
    try {
      generated = await options.generationService.generate({ attemptId: parsed.data.link_attempt_id,
        request: request as OwnerSunoGenerationRequest }, signal);
    } catch (error) { return generationErrorResult(error, "PRE_DISPATCH_FAILED"); }
    try { return structured(parseOutput(generationOutputSchema, generated)); }
    catch { return postResultValidationError(generated); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_SUNO_AUDIO_TOOL_NAME, {
    title: "Reconcile Suno audio", description: "GET-only reconciliation for one exact attempt and recovery; it never starts or repeats a Suno request.",
    inputSchema: reconcileInputSchema, outputSchema: generationOutputSchema,
    annotations: { title: "Reconcile Suno audio", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = reconcileInputSchema.safeParse(snapshotSafeInput(input));
    if (!parsed.success) return generationErrorResult(undefined, "INVALID_REQUEST");
    try { return structured(parseOutput(generationOutputSchema, await options.generationService.reconcile({
      attemptId: parsed.data.link_attempt_id, recovery_id: parsed.data.recovery_id
    }, signal))); } catch (error) { return generationErrorResult(error, "RECOVERY_NOT_FOUND"); }
  });

  server.registerTool(SYNTX_OWNER_LIST_SUNO_RECOVERIES_TOOL_NAME, {
    title: "List Suno generation recoveries", description: "Lists bounded process-local recovery summaries for an exact owner attempt; it excludes prompts, settings text, and artifact URLs.",
    inputSchema: listRecoveriesInputSchema, outputSchema: recoveryListOutputSchema,
    annotations: { title: "List Suno recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    const parsed = listRecoveriesInputSchema.safeParse(snapshotSafeInput(input));
    if (!parsed.success) return recoveryListError("INVALID_REQUEST");
    try {
      const recoveries = await options.generationService.listRecoveries({ attemptId: parsed.data.link_attempt_id,
        ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }) });
      return structured(parseOutput(recoveryListOutputSchema, { recoveries }));
    } catch (error) { return recoveryListError(safeRecoveryListErrorCode(error)); }
  });

  server.registerTool(SYNTX_OWNER_GET_SUNO_RESULT_PAGE_TOOL_NAME, {
    title: "Get Suno result page", description: "Projects one page from the local observed audio-result cache; this read-only action performs no generation, upstream request, or provider-terminal inference.",
    inputSchema: resultPageInputSchema, outputSchema: generationOutputSchema,
    annotations: { title: "Get Suno result page", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    const parsed = resultPageInputSchema.safeParse(snapshotSafeInput(input));
    if (!parsed.success) return generationErrorResult(undefined, "INVALID_REQUEST");
    try { return structured(parseOutput(generationOutputSchema, await options.generationService.getResultPage({
      attemptId: parsed.data.link_attempt_id, recovery_id: parsed.data.recovery_id,
      ...(parsed.data.offset === undefined ? {} : { offset: parsed.data.offset })
    }))); } catch (error) { return generationErrorResult(error, "RECOVERY_NOT_FOUND"); }
  });
}

const GENERATION_MESSAGES: Record<OwnerSunoGenerationServiceErrorCode, string> = {
  INVALID_REQUEST: "The Suno generate request is invalid.", SERVICE_CLOSED: "The owner Suno generation service is closed.",
  SERVICE_BUSY: "The owner Suno generation service is busy.", PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.",
  MODEL_BINDING_MISMATCH: "The selected Suno model profile is unavailable.", PREFLIGHT_FAILED: "Current account or model access could not be verified.",
  INTENT_ALREADY_CLAIMED: "This Suno intent has an unresolved or previously claimed outcome.", PRE_DISPATCH_FAILED: "The Suno request was not safely dispatched.",
  OUTCOME_UNKNOWN: "The Suno request may have been dispatched; reconcile its recovery and do not retry.",
  RECOVERY_NOT_FOUND: "The Suno recovery is unavailable or expired."
};

function sourceProjection() {
  return { status: SOURCE.status, source_pins: SOURCE.source_pins, model_ids: SOURCE.model_ids,
    models: MODELS.map((model_id) => SOURCE.models[model_id]), controls: SOURCE.controls, cost_projection: SOURCE.cost_projection,
    effective_defaults: SOURCE.effective_defaults, runtime_usable: false as const, dispatch_allowed: false as const,
    backend_acceptance: SOURCE.backend_acceptance };
}
function toRequest(input: Record<string, unknown>): OwnerSunoGenerationRequest {
  return { model_id: input.model_id as OwnerSunoGenerationModel, mode: "generate", prompt: input.prompt as string,
    is_custom_mode: input.is_custom_mode as boolean, is_instrumental: input.is_instrumental as boolean,
    negative_tags: input.negative_tags as string, styles: input.styles as string, title: input.title as string };
}
function snapshotOptions(value: unknown): RegisterSyntxOwnerSunoGenerationToolsOptions {
  const fields = readExactRecord(value, ["generationService"]);
  if (!isOwnerSunoGenerationService(fields.generationService)) throw new Error("SUNO_GENERATION_SERVICE_COMPOSITION_INVALID");
  return Object.freeze({ generationService: fields.generationService });
}
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
    if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" && (typeof key !== "string" ||
        !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable))) throw new TypeError("invalid array");
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError("invalid item");
      result.push(snapshotJson(descriptor.value, depth + 1, budget));
    }
    return result;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("invalid record");
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) throw new TypeError("invalid field");
    Object.defineProperty(result, key, { value: snapshotJson(descriptors[key]!.value, depth + 1, budget), enumerable: true });
  }
  return result;
}
function parseOutput(schema: z.ZodType, value: unknown): Record<string, unknown> {
  const parsed = schema.safeParse(snapshotSafeInput(value));
  if (!parsed.success || !parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) throw new Error("SUNO_GENERATION_OUTPUT_SHAPE_INVALID");
  return parsed.data as Record<string, unknown>;
}
function generationErrorResult(error: unknown, fallback: OwnerSunoGenerationServiceErrorCode): CallToolResult {
  const code = isServiceError(error) && Object.hasOwn(GENERATION_MESSAGES, ownData(error, "code") as string)
    ? ownData(error, "code") as OwnerSunoGenerationServiceErrorCode : fallback;
  let recovery: string | undefined;
  if (code === "OUTCOME_UNKNOWN" && isServiceError(error)) {
    const candidate = ownData(error, "recovery_id");
    if (typeof candidate === "string" && recoveryIdSchema.safeParse(candidate).success) recovery = candidate;
  }
  return errorResult({ error: { code, message: GENERATION_MESSAGES[code], ...(recovery ? { recovery_id: recovery } : {}) } });
}
export function postResultValidationError(value: unknown): CallToolResult {
  const candidate = value !== null && typeof value === "object" && !types.isProxy(value) ? ownData(value, "recovery_id") : undefined;
  const recovery = typeof candidate === "string" && recoveryIdSchema.safeParse(candidate).success ? candidate : undefined;
  return errorResult({ error: { code: "OUTCOME_UNKNOWN", message: GENERATION_MESSAGES.OUTCOME_UNKNOWN,
    ...(recovery ? { recovery_id: recovery } : {}) } });
}
function safeRecoveryListErrorCode(error: unknown): "INVALID_REQUEST" | "SERVICE_BUSY" | "SERVICE_CLOSED" | "PRINCIPAL_NOT_LINKED" {
  if (!isServiceError(error)) return "SERVICE_BUSY";
  const code = ownData(error, "code");
  return code === "INVALID_REQUEST" || code === "SERVICE_CLOSED" || code === "PRINCIPAL_NOT_LINKED" ? code : "SERVICE_BUSY";
}
function recoveryListError(code: "INVALID_REQUEST" | "SERVICE_BUSY" | "SERVICE_CLOSED" | "PRINCIPAL_NOT_LINKED"): CallToolResult {
  const messages = { INVALID_REQUEST: "The recovery request is invalid.", SERVICE_BUSY: "The owner Suno service is busy.",
    SERVICE_CLOSED: "The owner Suno service is closed.", PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required." };
  return errorResult({ error: { code, message: messages[code] } });
}
function isServiceError(value: unknown): value is OwnerSunoGenerationServiceError {
  return Boolean(value) && typeof value === "object" && !types.isProxy(value) && value instanceof OwnerSunoGenerationServiceError;
}
function ownData(value: object, key: string): unknown { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && "value" in descriptor ? descriptor.value : undefined; }
function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) { const next = value.charCodeAt(index + 1); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; index += 1; }
    else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
function structured(value: object): CallToolResult { return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> }; }
function errorResult(value: object): CallToolResult { return { isError: true, content: [{ type: "text", text: JSON.stringify(value) }] }; }
