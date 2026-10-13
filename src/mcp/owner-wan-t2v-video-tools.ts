import { types } from "node:util";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OwnerReferencePrincipalError } from "../auth/owner-reference-principal.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import {
  isOwnerWanT2vGenerationService,
  OWNER_WAN_T2V_GENERATION_ERROR_CODES,
  OWNER_WAN_T2V_GENERATION_HISTORY_REASONS,
  OWNER_WAN_T2V_GENERATION_PHASES,
  OWNER_WAN_T2V_GENERATION_RESULT_REASONS,
  OwnerWanT2vGenerationServiceError,
  type OwnerWanT2vGenerationService,
  type OwnerWanT2vGenerationServiceErrorCode
} from "../application/owner-wan-t2v-generation-service.js";
import {
  getOwnerWanT2vGenerationParametersSource,
  normalizeOwnerWanT2vGenerationParameters,
  OWNER_WAN_T2V_GENERATION_MODEL_IDS,
  type OwnerWanT2vGenerationIntent
} from "../application/owner-wan-t2v-generation-parameters.js";

const SOURCE = getOwnerWanT2vGenerationParametersSource();
const MODELS = OWNER_WAN_T2V_GENERATION_MODEL_IDS;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY_ID = /^wan_t2v_recovery_[0-9a-f-]{36}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MAX_PROMPT_UTF8_BYTES = 65_536;
const MAX_ARTIFACTS = 4_096;
const PAGE_SIZE = 64;

export const SYNTX_GET_WAN_T2V_PARAMETERS_TOOL_NAME = "syntx_get_wan_t2v_parameters" as const;
export const SYNTX_OWNER_GENERATE_WAN_T2V_VIDEO_TOOL_NAME = "syntx_owner_generate_wan_t2v_video" as const;
export const SYNTX_OWNER_RECONCILE_WAN_T2V_VIDEO_TOOL_NAME = "syntx_owner_reconcile_wan_t2v_video" as const;
export const SYNTX_OWNER_LIST_WAN_T2V_RECOVERIES_TOOL_NAME = "syntx_owner_list_wan_t2v_recoveries" as const;
export const SYNTX_OWNER_GET_WAN_T2V_RESULT_PAGE_TOOL_NAME = "syntx_owner_get_wan_t2v_result_page" as const;
export const OWNER_WAN_T2V_TOOL_NAMES = Object.freeze([
  SYNTX_GET_WAN_T2V_PARAMETERS_TOOL_NAME,
  SYNTX_OWNER_GENERATE_WAN_T2V_VIDEO_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_WAN_T2V_VIDEO_TOOL_NAME,
  SYNTX_OWNER_LIST_WAN_T2V_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_GET_WAN_T2V_RESULT_PAGE_TOOL_NAME
] as const);

const attemptSchema = z.string().regex(ATTEMPT).describe("Exact currently linked owner attempt; it does not select another account.");
const recoveryIdSchema = z.string().regex(RECOVERY_ID).describe("Opaque process-local recovery ID; reconciliation is GET-only.");
const modelSchema = z.enum(MODELS);
const parameterCommonSchema = z.object({
  resolution: z.enum(SOURCE.controls.resolution.values),
  aspect_ratio: z.enum(SOURCE.controls.aspect_ratio.values),
  video_duration: z.number().int().min(SOURCE.controls.video_duration.minimum).max(SOURCE.controls.video_duration.maximum),
  prompt_extend: z.boolean(),
  seed: z.number().int().min(SOURCE.controls.seed.minimum).max(SOURCE.controls.seed.maximum).nullable()
}).strict();
const parameter26Schema = parameterCommonSchema.extend({ shot_type: z.enum(["single", "multi"]) }).strict();
const parameter27Schema = parameterCommonSchema.extend({ native_audio: z.boolean() }).strict();
const parametersInputSchema = z.object({}).strict();
const promptSchema = z.string().min(1).max(MAX_PROMPT_UTF8_BYTES).refine((prompt) =>
  isWellFormedUnicode(prompt) && prompt.trim().length > 0 && Buffer.byteLength(prompt, "utf8") <= MAX_PROMPT_UTF8_BYTES,
"Prompt must be nonblank and within the local UTF-8 resource bound; its original text is preserved.");
const generateVariantSchema = z.discriminatedUnion("model_id", [
  z.object({ link_attempt_id: attemptSchema, model_id: z.literal("wan_26_t2v"), prompt: promptSchema,
    parameters: parameter26Schema }).strict(),
  z.object({ link_attempt_id: attemptSchema, model_id: z.literal("wan_27_t2v"), prompt: promptSchema,
    parameters: parameter27Schema }).strict()
]).superRefine((input, context) => {
  try { normalizeOwnerWanT2vGenerationParameters({ model_id: input.model_id, prompt: input.prompt, parameters: input.parameters }); }
  catch { context.addIssue({ code: "custom", path: ["parameters"], message: "WAN T2V explicit source-shaped parameters are invalid." }); }
});
const generateVariantJson = z.toJSONSchema(generateVariantSchema, { target: "draft-7", io: "input" }) as { oneOf?: unknown };
if (!Array.isArray(generateVariantJson.oneOf) || generateVariantJson.oneOf.length !== MODELS.length) {
  throw new Error("WAN_T2V_GENERATION_SCHEMA_BRANCHES_INVALID");
}
const generateInputSchema = z.object({
  link_attempt_id: attemptSchema,
  model_id: modelSchema,
  prompt: promptSchema,
  parameters: z.object({
    resolution: z.enum(SOURCE.controls.resolution.values),
    aspect_ratio: z.enum(SOURCE.controls.aspect_ratio.values),
    video_duration: z.number().int().min(2).max(15),
    prompt_extend: z.boolean(),
    seed: z.number().int().min(0).max(2_147_483_647).nullable(),
    shot_type: z.enum(["single", "multi"]).optional(),
    native_audio: z.boolean().optional()
  }).strict()
}).strict().superRefine((input, context) => {
  const parsed = generateVariantSchema.safeParse(input);
  if (!parsed.success) for (const issue of parsed.error.issues) {
    context.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
}).meta({ oneOf: generateVariantJson.oneOf });
const reconcileInputSchema = z.object({ link_attempt_id: attemptSchema, recovery_id: recoveryIdSchema }).strict();
const listRecoveriesInputSchema = z.object({ link_attempt_id: attemptSchema,
  limit: z.number().int().min(1).max(128).optional() }).strict();
const resultPageInputSchema = z.object({ link_attempt_id: attemptSchema, recovery_id: recoveryIdSchema,
  offset: z.number().int().min(0).max(MAX_ARTIFACTS).optional() }).strict();

const sourcePinsSchema = z.object({ public_catalog_version: z.string().regex(/^sha256-[a-f0-9]{64}\.json$/u),
  public_models_sha256: SHA256Schema(), settings_inventory_version: z.string().regex(/^sha256-[a-f0-9]{64}\.json$/u),
  build_id: z.string().regex(/^\d{1,20}$/u), form_module: z.literal("wan-video.js"), form_bytes: z.number().int().positive(),
  form_sha256: SHA256Schema(), sender_module: z.literal("video.js"), sender_sha256: SHA256Schema(),
  runtime_catalog_not_promoted: z.literal("e551") }).strict();
const modelSourceSchema = z.object({ model_id: modelSchema, ai_name: z.literal("wan_video"),
  model_type_binding: z.literal("EXACT_PUBLIC_MODEL_ID"), settings_keys: z.array(z.string()).max(32),
  cost_query_keys: z.tuple([z.literal("video_duration"), z.literal("resolution")]),
  branch_control: z.enum(["shot_type:single|multi", "native_audio:boolean"]),
  static_status: z.literal("CURRENT_STATIC_SOURCE_METADATA_ONLY") }).strict();
const parameterSourceOutputSchema = z.object({
  status: z.literal("CURRENT_B066_1B48_STATIC_SOURCE_CONTRACT"),
  source_pins: sourcePinsSchema,
  models: z.array(modelSourceSchema).length(2),
  controls: z.object({
    resolution: z.object({ values: z.tuple([z.literal("720P"), z.literal("1080P")]), effective_default: z.literal("UNKNOWN") }).strict(),
    aspect_ratio: z.object({ values: z.tuple([z.literal("16:9"), z.literal("9:16"), z.literal("1:1"), z.literal("4:3"), z.literal("3:4")]),
      visibility: z.literal("ALL_ACTIVE_WAN_IDS_EXCEPT_wan_27_i2v"), effective_default: z.literal("UNKNOWN") }).strict(),
    video_duration: z.object({ minimum: z.literal(2), maximum: z.literal(15), unit: z.literal("INTEGER_SECONDS"),
      effective_default: z.literal("UNKNOWN") }).strict(),
    prompt_extend: z.object({ type: z.literal("boolean"), effective_default: z.literal("UNKNOWN") }).strict(),
    seed: z.object({ nullable: z.literal(true), minimum: z.literal(0), maximum: z.literal(2_147_483_647), precision: z.literal(0),
      effective_default: z.literal("UNKNOWN") }).strict(),
    initializer_candidates_only: z.object({ aspect_ratio: z.literal("1:1"), resolution: z.literal("1080P"),
      video_duration: z.literal(5), prompt_extend: z.literal(true), seed: z.null(), shot_type: z.literal("single"),
      native_audio: z.literal(false) }).strict()
  }).strict(),
  cost_projection: z.object({ declared_keys: z.tuple([z.literal("video_duration"), z.literal("resolution")]),
    value_mapping: z.literal("FORM_FIELD_VALUE_CANDIDATE_ONLY_COST_CALLER_NOT_JOINED"), amount_or_quote: z.literal("UNPROVEN") }).strict(),
  caller_gaps: z.tuple([z.literal("CUSTOM_PAYLOAD_TO_VIDEO_SENDER_ARGUMENT_NOT_JOINED"),
    z.literal("PROMPT_STRING_REPLACE_TRANSFORM_NOT_JOINED"), z.literal("CHAT_ID_IS_BOUND_ONLY_BY_A_FUTURE_PRIVATE_OWNER_CONTEXT")]),
  effective_defaults: z.literal("UNKNOWN"), runtime_usable: z.literal(false), dispatch_allowed: z.literal(false),
  backend_acceptance: z.literal("UNPROVEN")
}).strict();

const recoveryDiagnosticSchema = z.object({
  phase: z.enum(OWNER_WAN_T2V_GENERATION_PHASES), post_started: z.boolean(), ack_known: z.boolean(),
  history_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "UNVERIFIED"]),
  history_reason: z.enum(OWNER_WAN_T2V_GENERATION_HISTORY_REASONS).nullable(),
  history_get_calls: z.number().int().min(0).max(255), result_get_calls: z.number().int().min(0).max(255),
  inprogress_get_calls: z.number().int().min(0).max(255),
  result_status: z.enum(["NOT_READ", "PENDING", "PARTIAL", "COMPLETE", "UNVERIFIED"]),
  result_reason: z.enum(OWNER_WAN_T2V_GENERATION_RESULT_REASONS).nullable()
}).strict();
const artifactSchema = z.object({
  url: z.string().url().max(4_096).refine(isSafeUploadReferenceUrl),
  mime_type: z.enum(["video/mp4", "video/quicktime"]).nullable(),
  mime_source: z.enum(["URL_EXTENSION", "UNKNOWN"]),
  message_id: z.string().regex(SAFE_ID), message_object_id: z.string().regex(SAFE_ID),
  object_index: z.number().int().min(0).max(63), model_echo: z.enum(["MATCHED", "UNKNOWN"]), object_type: z.literal("video")
}).strict().superRefine((artifact, context) => {
  if ((artifact.mime_type === null) !== (artifact.mime_source === "UNKNOWN")) {
    context.addIssue({ code: "custom", path: ["mime_source"], message: "URL-derived MIME hint and source must agree." });
  }
});
const parametersOutputSchema = z.union([
  z.object({ resolution: z.enum(["720P", "1080P"]),
    aspect_ratio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"]), video_duration: z.number().int().min(2).max(15),
    prompt_extend: z.boolean(), seed: z.number().int().min(0).max(2_147_483_647).nullable(), shot_type: z.enum(["single", "multi"]) }).strict(),
  z.object({ resolution: z.enum(["720P", "1080P"]),
    aspect_ratio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"]), video_duration: z.number().int().min(2).max(15),
    prompt_extend: z.boolean(), seed: z.number().int().min(0).max(2_147_483_647).nullable(), native_audio: z.boolean() }).strict()
]);
const generationOutputSchema = z.object({
  status: z.enum(["completed", "partial_results"]), status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"),
  backend_acceptance: z.literal("UNPROVEN"), provider_terminal_status: z.literal("UNPROVEN"),
  model_id: modelSchema, parameters: parametersOutputSchema,
  cost_inputs: z.object({ video_duration: z.number().int().min(2).max(15), resolution: z.enum(["720P", "1080P"]) }).strict(),
  cost_input_confidence: z.literal("PUBLIC_KEYS_PLUS_EXPLICIT_VALUES_LOCAL_INTEGRATION_NOT_UI_CALLER_OR_QUOTE"),
  recovery_id: recoveryIdSchema, observed_artifact_count: z.number().int().min(0).max(MAX_ARTIFACTS),
  offset: z.number().int().min(0).max(MAX_ARTIFACTS), page_size: z.literal(PAGE_SIZE), artifacts: z.array(artifactSchema).max(PAGE_SIZE),
  has_more: z.boolean(), next_offset: z.number().int().min(1).max(MAX_ARTIFACTS).nullable(), diagnostic: recoveryDiagnosticSchema
}).strict().superRefine((result, context) => {
  if (result.has_more !== (result.next_offset !== null) ||
      (result.has_more && result.next_offset !== result.offset + result.artifacts.length) ||
      result.offset + result.artifacts.length > result.observed_artifact_count) {
    context.addIssue({ code: "custom", path: ["has_more"], message: "The local page metadata is inconsistent." });
  }
});
const recoveryItemSchema = z.object({ recovery_id: recoveryIdSchema, created_at: z.iso.datetime(), model_id: modelSchema,
  status: z.enum(["outcome_unknown", "partial_results"]), observed_artifact_count: z.number().int().min(0).max(MAX_ARTIFACTS),
  diagnostic: recoveryDiagnosticSchema }).strict();
const recoveryListOutputSchema = z.object({ recoveries: z.array(recoveryItemSchema).max(128) }).strict();

export const OWNER_WAN_T2V_TOOL_INPUT_SCHEMAS = Object.freeze({ parameters: parametersInputSchema, generate: generateInputSchema,
  reconcile: reconcileInputSchema, list_recoveries: listRecoveriesInputSchema, result_page: resultPageInputSchema });
export const OWNER_WAN_T2V_TOOL_OUTPUT_SCHEMAS = Object.freeze({ parameters: parameterSourceOutputSchema, generate: generationOutputSchema,
  reconcile: generationOutputSchema, list_recoveries: recoveryListOutputSchema, result_page: generationOutputSchema });

export interface RegisterSyntxOwnerWanT2vVideoToolsOptions {
  readonly generationService: Pick<OwnerWanT2vGenerationService, "generate" | "reconcile" | "listRecoveries" | "getResultPage">;
}

export function registerSyntxOwnerWanT2vVideoTools(server: McpServer, optionsInput: RegisterSyntxOwnerWanT2vVideoToolsOptions | unknown): void {
  const options = snapshotOptions(optionsInput);
  server.registerTool(SYNTX_GET_WAN_T2V_PARAMETERS_TOOL_NAME, {
    title: "Get WAN T2V parameters", description: "Returns the pinned static B066/1b48 WAN text-to-video controls and source gaps. This is evidence only; it does not establish runtime availability or authorize generation.",
    inputSchema: parametersInputSchema, outputSchema: parameterSourceOutputSchema,
    annotations: { title: "Get WAN T2V parameters", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async () => structured(parseSafeOutput(parameterSourceOutputSchema, SOURCE)));

  server.registerTool(SYNTX_OWNER_GENERATE_WAN_T2V_VIDEO_TOOL_NAME, {
    title: "Generate WAN T2V video", description: "Submits one complete explicit WAN 2.6/2.7 T2V intent after fresh owner/account/access checks. A timeout or uncertain receipt is not safe to retry; reconcile the returned recovery instead.",
    inputSchema: generateInputSchema, outputSchema: generationOutputSchema,
    annotations: { title: "Generate WAN T2V video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    const copied = snapshotSafeInput(input);
    const parsed = generateVariantSchema.safeParse(copied);
    if (!parsed.success) return generationErrorResult(undefined, "INVALID_REQUEST");
    const intent: OwnerWanT2vGenerationIntent = parsed.data.model_id === "wan_26_t2v"
      ? { model_id: "wan_26_t2v", prompt: parsed.data.prompt, parameters: parameter26Schema.parse(parsed.data.parameters) }
      : { model_id: "wan_27_t2v", prompt: parsed.data.prompt, parameters: parameter27Schema.parse(parsed.data.parameters) };
    try {
      const result = await options.generationService.generate({ attemptId: parsed.data.link_attempt_id, input: intent }, signal);
      return structured(parseSafeOutput(generationOutputSchema, result));
    } catch (error) { return generationErrorResult(error, "PRE_DISPATCH_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_WAN_T2V_VIDEO_TOOL_NAME, {
    title: "Reconcile WAN T2V generation", description: "GET-only reconciliation for one exact owner attempt and process-local recovery; never starts or repeats generation.",
    inputSchema: reconcileInputSchema, outputSchema: generationOutputSchema,
    annotations: { title: "Reconcile WAN T2V generation", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }) => {
    const copied = snapshotSafeInput(input);
    const parsed = reconcileInputSchema.safeParse(copied);
    if (!parsed.success) return generationErrorResult(undefined, "INVALID_REQUEST");
    try {
      const result = await options.generationService.reconcile({ attemptId: parsed.data.link_attempt_id, recovery_id: parsed.data.recovery_id }, signal);
      return structured(parseSafeOutput(generationOutputSchema, result));
    } catch (error) { return generationErrorResult(error, "PRE_DISPATCH_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_LIST_WAN_T2V_RECOVERIES_TOOL_NAME, {
    title: "List WAN T2V recoveries", description: "Reads bounded process-local WAN T2V recovery summaries for the exact linked owner attempt; excludes prompt, artifacts and private context.",
    inputSchema: listRecoveriesInputSchema, outputSchema: recoveryListOutputSchema,
    annotations: { title: "List WAN T2V recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    const copied = snapshotSafeInput(input);
    const parsed = listRecoveriesInputSchema.safeParse(copied);
    if (!parsed.success) return recoveryListError("INVALID_REQUEST");
    try {
      const recoveries = await options.generationService.listRecoveries({ attemptId: parsed.data.link_attempt_id,
        ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }) });
      return structured(parseSafeOutput(recoveryListOutputSchema, { recoveries }));
    } catch (error) { return recoveryListError(safeListErrorCode(error)); }
  });

  server.registerTool(SYNTX_OWNER_GET_WAN_T2V_RESULT_PAGE_TOOL_NAME, {
    title: "Get WAN T2V result page", description: "Reads one page from the process-local observed WAN T2V result cache. This is local availability only, not provider completion or acceptance.",
    inputSchema: resultPageInputSchema, outputSchema: generationOutputSchema,
    annotations: { title: "Get WAN T2V result page", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    const copied = snapshotSafeInput(input);
    const parsed = resultPageInputSchema.safeParse(copied);
    if (!parsed.success) return generationErrorResult(undefined, "INVALID_REQUEST");
    try {
      const result = await options.generationService.getResultPage({ attemptId: parsed.data.link_attempt_id,
        recovery_id: parsed.data.recovery_id, ...(parsed.data.offset === undefined ? {} : { offset: parsed.data.offset }) });
      return structured(parseSafeOutput(generationOutputSchema, result));
    } catch (error) { return generationErrorResult(error, "PRE_DISPATCH_FAILED"); }
  });
}

const ERROR_MESSAGES: Record<OwnerWanT2vGenerationServiceErrorCode, string> = {
  INVALID_REQUEST: "The WAN T2V request is invalid.", SERVICE_CLOSED: "The owner WAN T2V service is closed.",
  SERVICE_BUSY: "The owner WAN T2V service is busy.", PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.",
  MODEL_BINDING_MISMATCH: "The selected WAN T2V model profile is unavailable.", PREFLIGHT_FAILED: "Current account or model access could not be verified.",
  INTENT_ALREADY_CLAIMED: "This WAN T2V intent has an unresolved outcome.", PRE_DISPATCH_FAILED: "The WAN T2V request was not safely dispatched.",
  OUTCOME_UNKNOWN: "The WAN T2V request may have been dispatched; reconcile its recovery and do not retry.",
  RECOVERY_NOT_FOUND: "The WAN T2V recovery is unavailable or expired."
};

function generationErrorResult(error: unknown, fallback: OwnerWanT2vGenerationServiceErrorCode): CallToolResult {
  let code = fallback;
  let recoveryId: string | undefined;
  if (isPlainServiceError(error)) {
    const candidateCode = ownData(error, "code");
    if (typeof candidateCode === "string" && (OWNER_WAN_T2V_GENERATION_ERROR_CODES as readonly string[]).includes(candidateCode)) {
      code = candidateCode as OwnerWanT2vGenerationServiceErrorCode;
    }
    const candidateId = ownData(error, "recovery_id");
    if (typeof candidateId === "string" && RECOVERY_ID.test(candidateId)) recoveryId = candidateId;
  } else if (!isProxyObject(error) && error instanceof OwnerReferencePrincipalError) code = "PRINCIPAL_NOT_LINKED";
  return errorResult({ error: { code, message: ERROR_MESSAGES[code],
    ...(code === "OUTCOME_UNKNOWN" && recoveryId ? { recovery_id: recoveryId } : {}) } });
}

function safeListErrorCode(error: unknown): "INVALID_REQUEST" | "SERVICE_BUSY" | "SERVICE_CLOSED" | "PRINCIPAL_NOT_LINKED" {
  if (isPlainServiceError(error)) {
    const code = ownData(error, "code");
    if (code === "INVALID_REQUEST" || code === "SERVICE_CLOSED" || code === "PRINCIPAL_NOT_LINKED") return code;
  }
  if (!isProxyObject(error) && error instanceof OwnerReferencePrincipalError) return "PRINCIPAL_NOT_LINKED";
  return "SERVICE_BUSY";
}
function recoveryListError(code: "INVALID_REQUEST" | "SERVICE_BUSY" | "SERVICE_CLOSED" | "PRINCIPAL_NOT_LINKED"): CallToolResult {
  const messages = { INVALID_REQUEST: "The WAN T2V recovery request is invalid.", SERVICE_BUSY: "The owner WAN T2V service is busy.",
    SERVICE_CLOSED: "The owner WAN T2V service is closed.", PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required." };
  return errorResult({ error: { code, message: messages[code] } });
}

function snapshotOptions(value: unknown): RegisterSyntxOwnerWanT2vVideoToolsOptions {
  const options = readExactRecord(value, ["generationService"]);
  if (!isOwnerWanT2vGenerationService(options.generationService)) throw new Error("WAN_T2V_SERVICE_COMPOSITION_INVALID");
  return Object.freeze({ generationService: options.generationService });
}
function readExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) throw new TypeError("INVALID_RECORD");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("INVALID_RECORD");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) {
      throw new TypeError("INVALID_RECORD");
    }
    result[key] = descriptors[key]!.value;
  }
  if (keys.some((key) => !Object.hasOwn(result, key))) throw new TypeError("INVALID_RECORD");
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
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("invalid record");
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) throw new TypeError("invalid field");
    Object.defineProperty(result, key, { value: snapshotJson(descriptors[key]!.value, depth + 1, budget), enumerable: true });
  }
  return result;
}
function parseSafeOutput(schema: z.ZodType, value: unknown): Record<string, unknown> {
  const copied = snapshotSafeInput(value); const parsed = schema.safeParse(copied);
  if (!parsed.success || !parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) throw new Error("WAN_T2V_OUTPUT_SHAPE_INVALID");
  return parsed.data as Record<string, unknown>;
}
function structured(value: object): CallToolResult { return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> }; }
function errorResult(value: object): CallToolResult { return { isError: true, content: [{ type: "text", text: JSON.stringify(value) }] }; }
function ownData(value: object, key: string): unknown { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && "value" in descriptor ? descriptor.value : undefined; }
function isPlainServiceError(value: unknown): value is object { return !isProxyObject(value) && value instanceof OwnerWanT2vGenerationServiceError; }
function isProxyObject(value: unknown): value is object { return Boolean(value) && typeof value === "object" && types.isProxy(value); }
function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
function SHA256Schema() { return z.string().regex(SHA256); }
