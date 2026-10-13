import { types } from "node:util";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import {
  getOwnerElevenLabsGenerationParameterProfile,
  normalizeOwnerElevenLabsGenerationParameters,
  OWNER_ELEVENLABS_TTS_MODEL_IDS,
  type OwnerElevenLabsTtsRequest
} from "../application/owner-elevenlabs-generation-parameters.js";
import {
  isOwnerElevenLabsTtsGenerationService,
  OwnerElevenLabsTtsGenerationServiceError,
  type OwnerElevenLabsTtsGenerationService,
  type OwnerElevenLabsTtsGenerationServiceErrorCode
} from "../application/owner-elevenlabs-tts-generation-service.js";
import {
  OwnerElevenLabsVoiceReferenceService,
} from "../application/owner-elevenlabs-voice-reference-service.js";
import { isOwnerElevenLabsVoiceReferenceService, OWNER_ELEVENLABS_VOICE_LIST_INPUT_SCHEMA,
  OWNER_ELEVENLABS_VOICE_LIST_OUTPUT_SCHEMA, registerSyntxOwnerElevenLabsVoiceTools,
  SYNTX_OWNER_LIST_ELEVENLABS_VOICE_REFERENCES_TOOL_NAME } from "./owner-elevenlabs-voice-tools.js";

export { registerSyntxOwnerElevenLabsVoiceTools } from "./owner-elevenlabs-voice-tools.js";

const SOURCE = getOwnerElevenLabsGenerationParameterProfile();
const MODELS = OWNER_ELEVENLABS_TTS_MODEL_IDS;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const VOICE_REF = /^owner_elevenlabs_voice_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RECOVERY_ID = /^elevenlabs_tts_recovery_[0-9a-f-]{36}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const MAX_ARTIFACTS = 4_096;
const PAGE_SIZE = 64;

export const SYNTX_GET_ELEVENLABS_TTS_PARAMETERS_TOOL_NAME = "syntx_get_elevenlabs_tts_parameters" as const;
export { SYNTX_OWNER_LIST_ELEVENLABS_VOICE_REFERENCES_TOOL_NAME };
export const SYNTX_OWNER_GENERATE_ELEVENLABS_TTS_TOOL_NAME = "syntx_owner_generate_elevenlabs_tts" as const;
export const SYNTX_OWNER_RECONCILE_ELEVENLABS_TTS_TOOL_NAME = "syntx_owner_reconcile_elevenlabs_tts" as const;
export const SYNTX_OWNER_LIST_ELEVENLABS_TTS_RECOVERIES_TOOL_NAME = "syntx_owner_list_elevenlabs_tts_recoveries" as const;
export const SYNTX_OWNER_GET_ELEVENLABS_TTS_RESULT_PAGE_TOOL_NAME = "syntx_owner_get_elevenlabs_tts_result_page" as const;
export const OWNER_ELEVENLABS_TTS_TOOL_NAMES = Object.freeze([
  SYNTX_GET_ELEVENLABS_TTS_PARAMETERS_TOOL_NAME,
  SYNTX_OWNER_LIST_ELEVENLABS_VOICE_REFERENCES_TOOL_NAME,
  SYNTX_OWNER_GENERATE_ELEVENLABS_TTS_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_ELEVENLABS_TTS_TOOL_NAME,
  SYNTX_OWNER_LIST_ELEVENLABS_TTS_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_GET_ELEVENLABS_TTS_RESULT_PAGE_TOOL_NAME
] as const);

const attemptSchema = z.string().regex(ATTEMPT).describe("Exact current owner-link attempt; it cannot select another account.");
const voiceReferenceSchema = z.string().regex(VOICE_REF).describe("Opaque, expiring voice reference from the owner voice list; never a provider voice ID.");
const recoveryIdSchema = z.string().regex(RECOVERY_ID);
const modelSchema = z.enum(MODELS);
const promptSchemas = Object.freeze({
  eleven_multilingual_v2: boundedPrompt(SOURCE.models.eleven_multilingual_v2.limits.max_prompt_length),
  eleven_v3: boundedPrompt(SOURCE.models.eleven_v3.limits.max_prompt_length),
  eleven_v4: boundedPrompt(SOURCE.models.eleven_v4.limits.max_prompt_length),
  eleven_v4_turbo: boundedPrompt(SOURCE.models.eleven_v4_turbo.limits.max_prompt_length)
});
const commonGenerateShape = {
  link_attempt_id: attemptSchema
};
const nonV4Controls = { stability: z.literal(0.5), similarity_boost: z.literal(0.5) };
const v4Controls = {
  stability: controlSchema(SOURCE.builder.stability.min, SOURCE.builder.stability.max, SOURCE.builder.stability.step),
  similarity_boost: controlSchema(SOURCE.builder.similarity_boost.min, SOURCE.builder.similarity_boost.max, SOURCE.builder.similarity_boost.step)
};
const generateVariantSchema = z.discriminatedUnion("model_id", [
  z.object({ ...commonGenerateShape, model_id: z.literal("eleven_multilingual_v2"), mode: z.literal("text_to_speech"),
    ...nonV4Controls, prompt: promptSchemas.eleven_multilingual_v2, voice_ref: voiceReferenceSchema }).strict(),
  z.object({ ...commonGenerateShape, model_id: z.literal("eleven_v3"), mode: z.literal("text_to_speech"),
    ...nonV4Controls, prompt: promptSchemas.eleven_v3, voice_ref: voiceReferenceSchema }).strict(),
  z.object({ ...commonGenerateShape, model_id: z.literal("eleven_v4"), mode: z.literal("text_to_speech"),
    ...v4Controls, prompt: promptSchemas.eleven_v4, voice_ref: voiceReferenceSchema, language_code: z.literal("auto").optional() }).strict(),
  z.object({ ...commonGenerateShape, model_id: z.literal("eleven_v4_turbo"), mode: z.literal("text_to_speech"),
    ...v4Controls, prompt: promptSchemas.eleven_v4_turbo, voice_ref: voiceReferenceSchema, language_code: z.literal("auto").optional() }).strict()
]).superRefine((input, context) => {
  try { normalizeOwnerElevenLabsGenerationParameters(toRequest(input)); }
  catch { context.addIssue({ code: "custom", path: ["voice_ref"], message: "The explicit source-shaped TTS request is invalid." }); }
});
const generateJsonSchema = z.toJSONSchema(generateVariantSchema, { target: "draft-7", io: "input" }) as { oneOf?: unknown };
if (!Array.isArray(generateJsonSchema.oneOf) || generateJsonSchema.oneOf.length !== MODELS.length) {
  throw new Error("ELEVENLABS_TTS_GENERATION_SCHEMA_BRANCHES_INVALID");
}
const generateInputSchema = z.object({
  link_attempt_id: attemptSchema,
  model_id: modelSchema,
  mode: z.literal("text_to_speech"),
  prompt: z.string().min(1).max(10_000),
  voice_ref: voiceReferenceSchema,
  stability: z.number().min(0).max(1),
  similarity_boost: z.number().min(0).max(1),
  language_code: z.literal("auto").optional()
}).strict().superRefine((input, context) => {
  const parsed = generateVariantSchema.safeParse(input);
  if (!parsed.success) for (const issue of parsed.error.issues) {
    context.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
}).meta({ oneOf: generateJsonSchema.oneOf });
const parametersInputSchema = z.object({}).strict();
const listVoicesInputSchema = OWNER_ELEVENLABS_VOICE_LIST_INPUT_SCHEMA;
const reconcileInputSchema = z.object({ link_attempt_id: attemptSchema, recovery_id: recoveryIdSchema }).strict();
const listRecoveriesInputSchema = z.object({ link_attempt_id: attemptSchema, limit: z.number().int().min(1).max(128).optional() }).strict();
const resultPageInputSchema = z.object({ link_attempt_id: attemptSchema, recovery_id: recoveryIdSchema,
  offset: z.number().int().min(0).max(MAX_ARTIFACTS).optional() }).strict();

const sourceOutputSchema = z.object({
  status: z.literal("CURRENT_STATIC_SOURCE_CONTRACT"),
  source_binding: z.object({ build_id: z.literal("1791811899"), form_module: z.literal("elevenlabs.js"),
    form_bytes: z.literal(32647), form_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    public_catalog_version: z.string().regex(/^sha256-[a-f0-9]{64}\.json$/u),
    settings_inventory_version: z.string().regex(/^sha256-[a-f0-9]{64}\.json$/u) }).strict(),
  models: z.array(z.object({ model_id: modelSchema, mode: z.literal("text_to_speech"), max_prompt_length: z.number().int().positive(),
    language_code: z.enum(["NOT_SUPPORTED", "auto_only"]),
    control_policy: z.enum(["FIXED_LOCAL_0_5_UNPROVEN_UI", "V4_SOURCE_SLIDERS"]) }).strict()).length(4),
  controls: z.object({ stability_similarity: z.object({ min: z.literal(0), max: z.literal(1), step: z.literal(0.05),
    applies_to: z.literal("V4_MODELS_ONLY"), non_v4_policy: z.literal("EXPLICIT_0_5_LOCAL_PREPARER_RULE_UNPROVEN_UI") }).strict(),
    voice_reference: z.literal("EXPIRING_OWNER_BOUND_OPAQUE_REFERENCE"), language_code: z.literal("auto_only_for_v4_models") }).strict(),
  effective_defaults: z.literal("UNKNOWN"), runtime_usable: z.literal(false), backend_acceptance: z.literal("UNPROVEN")
}).strict();
const voiceOutputSchema = OWNER_ELEVENLABS_VOICE_LIST_OUTPUT_SCHEMA;
const diagnosticSchema = z.object({ phase: z.enum(["VALIDATE_REQUEST", "RESOLVE_PRINCIPAL", "PREPARE_CANDIDATE", "PREFLIGHT",
  "CHAT_CREATE", "GENERATION_POST", "POST_ACK_KNOWN", "HISTORY_GET", "RESULT_GET", "RESULT_BINDING"]),
  post_started: z.boolean(), ack_known: z.boolean(), history_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "INCOMPLETE", "UNVERIFIED"]),
  history_get_calls: z.number().int().min(0).max(255), result_get_calls: z.number().int().min(0).max(255),
  result_status: z.enum(["NOT_READ", "PENDING", "PARTIAL", "COMPLETE", "UNVERIFIED"]), result_gaps: z.array(z.string().max(128)).max(128) }).strict();
const artifactSchema = z.object({ url: z.string().url().max(4_096).refine(isSafeUploadReferenceUrl),
  mime_type: z.enum(["audio/mpeg", "audio/wav", "audio/mp4"]).nullable(),
  mime_source: z.enum(["URL_EXTENSION_LOCAL_POLICY", "UNKNOWN"]), message_id: z.string().regex(SAFE_ID),
  message_object_id: z.string().regex(SAFE_ID), object_index: z.number().int().min(0).max(63),
  object_type: z.literal("audio"), model_echo: z.enum(["MATCHED", "UNKNOWN"]) }).strict();
const generationOutputSchema = z.object({
  status: z.enum(["completed", "partial_results"]), status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"),
  backend_acceptance: z.literal("UNPROVEN"), provider_terminal_status: z.literal("UNPROVEN"), model_id: modelSchema,
  parameters: z.object({ mode: z.literal("text_to_speech"), chars_count: z.number().int().min(1).max(10_000),
    stability: z.number().min(0).max(1), similarity_boost: z.number().min(0).max(1), language_code: z.literal("auto").optional() }).strict(),
  source_binding: z.object({ public_catalog_version: z.string().regex(/^sha256-[a-f0-9]{64}\.json$/u),
    settings_inventory_version: z.string().regex(/^sha256-[a-f0-9]{64}\.json$/u) }).strict(),
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
  status: z.enum(["outcome_unknown", "partial_results"]), observed_artifact_count: z.number().int().min(0).max(MAX_ARTIFACTS),
  diagnostic: diagnosticSchema }).strict();
const recoveryListOutputSchema = z.object({ recoveries: z.array(recoveryItemSchema).max(128) }).strict();

export const OWNER_ELEVENLABS_TTS_TOOL_INPUT_SCHEMAS = Object.freeze({ parameters: parametersInputSchema,
  list_voices: listVoicesInputSchema, generate: generateInputSchema, reconcile: reconcileInputSchema,
  list_recoveries: listRecoveriesInputSchema, result_page: resultPageInputSchema });
export const OWNER_ELEVENLABS_TTS_TOOL_OUTPUT_SCHEMAS = Object.freeze({ parameters: sourceOutputSchema,
  list_voices: voiceOutputSchema, generate: generationOutputSchema, reconcile: generationOutputSchema,
  list_recoveries: recoveryListOutputSchema, result_page: generationOutputSchema });

export interface RegisterSyntxOwnerElevenLabsTtsToolsOptions {
  readonly generationService: OwnerElevenLabsTtsGenerationService;
  readonly voiceReferenceService: OwnerElevenLabsVoiceReferenceService;
}

export function registerSyntxOwnerElevenLabsTtsTools(server: McpServer,
  optionsInput: RegisterSyntxOwnerElevenLabsTtsToolsOptions | unknown): void {
  const options = snapshotOptions(optionsInput);
  server.registerTool(SYNTX_GET_ELEVENLABS_TTS_PARAMETERS_TOOL_NAME, {
    title: "Get ElevenLabs TTS parameters", description: "Returns current static TTS control and source facts only; defaults, provider acceptance and runtime model availability remain unproven.",
    inputSchema: parametersInputSchema, outputSchema: sourceOutputSchema,
    annotations: { title: "Get ElevenLabs TTS parameters", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async () => structured(parseOutput(sourceOutputSchema, sourceProjection())));

  registerSyntxOwnerElevenLabsVoiceTools(server, options.voiceReferenceService);

  server.registerTool(SYNTX_OWNER_GENERATE_ELEVENLABS_TTS_TOOL_NAME, {
    title: "Generate ElevenLabs TTS audio", description: "Submits one explicit TTS request for an exact linked owner attempt. An uncertain result is not safe to retry; reconcile its recovery instead.",
    inputSchema: generateInputSchema, outputSchema: generationOutputSchema,
    annotations: { title: "Generate ElevenLabs TTS audio", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = generateVariantSchema.safeParse(snapshotSafeInput(input));
    if (!parsed.success) return generationErrorResult(undefined, "INVALID_REQUEST");
    const { link_attempt_id: _attempt, ...request } = parsed.data;
    try {
      const result = await options.generationService.generate({ attemptId: parsed.data.link_attempt_id,
        request: request as OwnerElevenLabsTtsRequest }, signal);
      return structured(parseOutput(generationOutputSchema, result));
    } catch (error) { return generationErrorResult(error, "PRE_DISPATCH_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_ELEVENLABS_TTS_TOOL_NAME, {
    title: "Reconcile ElevenLabs TTS", description: "GET-only reconciliation for one exact attempt and recovery; this tool never starts or repeats a TTS request.",
    inputSchema: reconcileInputSchema, outputSchema: generationOutputSchema,
    annotations: { title: "Reconcile ElevenLabs TTS", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = reconcileInputSchema.safeParse(snapshotSafeInput(input));
    if (!parsed.success) return generationErrorResult(undefined, "INVALID_REQUEST");
    try {
      const result = await options.generationService.reconcile({ attemptId: parsed.data.link_attempt_id,
        recovery_id: parsed.data.recovery_id }, signal);
      return structured(parseOutput(generationOutputSchema, result));
    } catch (error) { return generationErrorResult(error, "PRE_DISPATCH_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_LIST_ELEVENLABS_TTS_RECOVERIES_TOOL_NAME, {
    title: "List ElevenLabs TTS recoveries", description: "Lists bounded process-local recovery summaries for an exact owner attempt; excludes prompt, voice and artifact URLs.",
    inputSchema: listRecoveriesInputSchema, outputSchema: recoveryListOutputSchema,
    annotations: { title: "List ElevenLabs TTS recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    const parsed = listRecoveriesInputSchema.safeParse(snapshotSafeInput(input));
    if (!parsed.success) return recoveryListError("INVALID_REQUEST");
    try {
      const recoveries = await options.generationService.listRecoveries({ attemptId: parsed.data.link_attempt_id,
        ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }) });
      return structured(parseOutput(recoveryListOutputSchema, { recoveries }));
    } catch (error) { return recoveryListError(safeRecoveryListErrorCode(error)); }
  });

  server.registerTool(SYNTX_OWNER_GET_ELEVENLABS_TTS_RESULT_PAGE_TOOL_NAME, {
    title: "Get ElevenLabs TTS result page", description: "Projects one page from the local observed audio-result cache; it does not imply provider terminal state or acceptance.",
    inputSchema: resultPageInputSchema, outputSchema: generationOutputSchema,
    annotations: { title: "Get ElevenLabs TTS result page", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    const parsed = resultPageInputSchema.safeParse(snapshotSafeInput(input));
    if (!parsed.success) return generationErrorResult(undefined, "INVALID_REQUEST");
    try {
      const result = await options.generationService.getResultPage({ attemptId: parsed.data.link_attempt_id,
        recovery_id: parsed.data.recovery_id, ...(parsed.data.offset === undefined ? {} : { offset: parsed.data.offset }) });
      return structured(parseOutput(generationOutputSchema, result));
    } catch (error) { return generationErrorResult(error, "PRE_DISPATCH_FAILED"); }
  });
}

const GENERATION_MESSAGES: Record<OwnerElevenLabsTtsGenerationServiceErrorCode, string> = {
  INVALID_REQUEST: "The ElevenLabs TTS request is invalid.", SERVICE_CLOSED: "The owner ElevenLabs TTS service is closed.",
  SERVICE_BUSY: "The owner ElevenLabs TTS service is busy.", PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.",
  MODEL_BINDING_MISMATCH: "The selected ElevenLabs TTS model profile is unavailable.", PREFLIGHT_FAILED: "Current account or model access could not be verified.",
  INTENT_ALREADY_CLAIMED: "This ElevenLabs TTS intent has an unresolved outcome.", PRE_DISPATCH_FAILED: "The ElevenLabs TTS request was not safely dispatched.",
  OUTCOME_UNKNOWN: "The ElevenLabs TTS request may have been dispatched; reconcile its recovery and do not retry.",
  RECOVERY_NOT_FOUND: "The ElevenLabs TTS recovery is unavailable or expired."
};

function boundedPrompt(max: number) {
  return z.string().min(1).max(max).refine((value) => value.trim().length > 0 && isWellFormedUnicode(value),
    "Prompt must be nonblank well-formed Unicode within the source character limit.");
}
function controlSchema(min: number, max: number, step: number) {
  const scale = 1 / step;
  return z.number().min(min).max(max).refine((value) => {
    const scaled = value * scale;
    return Number.isFinite(scaled) && Math.abs(scaled - Math.round(scaled)) <= 1e-9;
  }, "Control must use a supported step.");
}
function toRequest(input: Record<string, unknown>): OwnerElevenLabsTtsRequest {
  return { model_id: input.model_id as OwnerElevenLabsTtsRequest["model_id"], mode: "text_to_speech",
    prompt: input.prompt as string, voice_ref: input.voice_ref as OwnerElevenLabsTtsRequest["voice_ref"],
    stability: input.stability as number, similarity_boost: input.similarity_boost as number,
    ...(input.language_code === undefined ? {} : { language_code: input.language_code as "auto" }) };
}
function sourceProjection() {
  return { status: "CURRENT_STATIC_SOURCE_CONTRACT" as const,
    source_binding: { build_id: SOURCE.source_binding.build_id, form_module: SOURCE.source_binding.form_module.name,
      form_bytes: SOURCE.source_binding.form_module.bytes, form_sha256: SOURCE.source_binding.form_module.sha256,
      public_catalog_version: SOURCE.source_binding.public_catalog_version,
      settings_inventory_version: SOURCE.source_binding.settings_inventory_version },
    models: MODELS.map((model_id) => ({ model_id, mode: "text_to_speech" as const,
      max_prompt_length: SOURCE.models[model_id].limits.max_prompt_length,
      language_code: model_id === "eleven_v4" || model_id === "eleven_v4_turbo" ? "auto_only" as const : "NOT_SUPPORTED" as const,
      control_policy: model_id === "eleven_v4" || model_id === "eleven_v4_turbo" ? "V4_SOURCE_SLIDERS" as const : "FIXED_LOCAL_0_5_UNPROVEN_UI" as const })),
    controls: { stability_similarity: { min: SOURCE.builder.stability.min, max: SOURCE.builder.stability.max,
      step: SOURCE.builder.stability.step, applies_to: "V4_MODELS_ONLY" as const,
      non_v4_policy: "EXPLICIT_0_5_LOCAL_PREPARER_RULE_UNPROVEN_UI" as const },
      voice_reference: "EXPIRING_OWNER_BOUND_OPAQUE_REFERENCE" as const, language_code: "auto_only_for_v4_models" as const },
    effective_defaults: "UNKNOWN" as const, runtime_usable: false as const, backend_acceptance: "UNPROVEN" as const };
}
function snapshotOptions(value: unknown): RegisterSyntxOwnerElevenLabsTtsToolsOptions {
  const fields = readExactRecord(value, ["generationService", "voiceReferenceService"]);
  if (!isOwnerElevenLabsTtsGenerationService(fields.generationService) ||
      !isOwnerElevenLabsVoiceReferenceService(fields.voiceReferenceService)) throw new Error("ELEVENLABS_TTS_SERVICE_COMPOSITION_INVALID");
  return Object.freeze({ generationService: fields.generationService, voiceReferenceService: fields.voiceReferenceService });
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
  if (!parsed.success || !parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) throw new Error("ELEVENLABS_TTS_OUTPUT_SHAPE_INVALID");
  return parsed.data as Record<string, unknown>;
}
function generationErrorResult(error: unknown, fallback: OwnerElevenLabsTtsGenerationServiceErrorCode): CallToolResult {
  let code = fallback, recovery: string | undefined;
  if (isServiceError(error)) {
    const candidate = ownData(error, "code"), maybeRecovery = ownData(error, "recovery_id");
    if (typeof candidate === "string" && Object.hasOwn(GENERATION_MESSAGES, candidate)) code = candidate as OwnerElevenLabsTtsGenerationServiceErrorCode;
    if (typeof maybeRecovery === "string" && RECOVERY_ID.test(maybeRecovery)) recovery = maybeRecovery;
  }
  return errorResult({ error: { code, message: GENERATION_MESSAGES[code], ...(code === "OUTCOME_UNKNOWN" && recovery ? { recovery_id: recovery } : {}) } });
}
function safeRecoveryListErrorCode(error: unknown): "INVALID_REQUEST" | "SERVICE_BUSY" | "SERVICE_CLOSED" | "PRINCIPAL_NOT_LINKED" {
  if (!isServiceError(error)) return "SERVICE_BUSY";
  const code = ownData(error, "code");
  return code === "INVALID_REQUEST" || code === "SERVICE_CLOSED" || code === "PRINCIPAL_NOT_LINKED" ? code : "SERVICE_BUSY";
}
function recoveryListError(code: "INVALID_REQUEST" | "SERVICE_BUSY" | "SERVICE_CLOSED" | "PRINCIPAL_NOT_LINKED"): CallToolResult {
  const messages = { INVALID_REQUEST: "The recovery request is invalid.", SERVICE_BUSY: "The owner TTS service is busy.",
    SERVICE_CLOSED: "The owner TTS service is closed.", PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required." };
  return errorResult({ error: { code, message: messages[code] } });
}
function isServiceError(value: unknown): value is OwnerElevenLabsTtsGenerationServiceError {
  return Boolean(value) && typeof value === "object" && !types.isProxy(value) && value instanceof OwnerElevenLabsTtsGenerationServiceError;
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
