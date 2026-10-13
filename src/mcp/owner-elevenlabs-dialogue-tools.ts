import { types } from "node:util";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { OWNER_ELEVENLABS_DIALOGUE_MODEL_IDS, normalizeOwnerElevenLabsGenerationParameters } from "../application/owner-elevenlabs-generation-parameters.js";
import { isOwnerElevenLabsDialogueGenerationService, OwnerElevenLabsDialogueGenerationServiceError,
  type OwnerElevenLabsDialogueGenerationServiceErrorCode } from "../application/owner-elevenlabs-dialogue-generation-service.js";
import { getOwnerElevenLabsDialogueSourceProfile } from "../application/owner-elevenlabs-dialogue-request-preparer.js";

const SOURCE = getOwnerElevenLabsDialogueSourceProfile();
const MODELS = OWNER_ELEVENLABS_DIALOGUE_MODEL_IDS;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const VOICE_REF = /^owner_elevenlabs_voice_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RECOVERY = /^elevenlabs_dialogue_recovery_[0-9a-f-]{36}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const MAX_RESULTS = 4_096;
const PAGE_SIZE = 64;
const attempt = z.string().regex(ATTEMPT).describe("Exact current owner-link attempt; it cannot select another account.");
const voiceRef = z.string().regex(VOICE_REF).describe("Opaque, expiring voice reference; never a provider voice ID.");
const model = z.enum(MODELS);
const recoveryId = z.string().regex(RECOVERY);
const prompt = (max: number) => z.string().max(max).refine(isWellFormedUnicode, "Prompt must be well-formed Unicode within the current source limit.");
const line = z.object({ name: z.string().min(1).max(256), text: z.string().min(1).max(10_000), voice_ref: voiceRef }).strict();
const common = { link_attempt_id: attempt, mode: z.literal("text_to_dialogue") };
const variant = z.discriminatedUnion("model_id", [
  z.object({ ...common, model_id: z.literal("eleven_v3"), prompt: prompt(5_000), inputs: z.array(line).min(2).max(100),
    stability: z.literal(0.5), similarity_boost: z.literal(0.5) }).strict(),
  z.object({ ...common, model_id: z.literal("eleven_v4"), prompt: prompt(10_000), inputs: z.array(line).min(2).max(100),
    stability: z.number().min(0).max(1).multipleOf(0.05), similarity_boost: z.number().min(0).max(1).multipleOf(0.05),
    language_code: z.literal("auto").optional() }).strict(),
  z.object({ ...common, model_id: z.literal("eleven_v4_turbo"), prompt: prompt(10_000), inputs: z.array(line).min(2).max(100),
    stability: z.number().min(0).max(1).multipleOf(0.05), similarity_boost: z.number().min(0).max(1).multipleOf(0.05),
    language_code: z.literal("auto").optional() }).strict()
]).superRefine((input, context) => {
  const { link_attempt_id: _attempt, prompt: _prompt, ...request } = input;
  try { normalizeOwnerElevenLabsGenerationParameters(request); }
  catch { context.addIssue({ code: "custom", path: ["inputs"], message: "The explicit source-shaped dialogue request is invalid." }); }
});
const generateInput = z.object({ link_attempt_id: attempt, model_id: model, mode: z.literal("text_to_dialogue"), prompt: z.string().max(10_000),
  inputs: z.array(line).min(2).max(100), stability: z.number().min(0).max(1), similarity_boost: z.number().min(0).max(1),
  language_code: z.literal("auto").optional() }).strict().superRefine((input, context) => {
  const checked = variant.safeParse(input);
  if (!checked.success) for (const issue of checked.error.issues) context.addIssue({ code: "custom", path: issue.path, message: issue.message });
}).meta({ oneOf: (z.toJSONSchema(variant, { target: "draft-7", io: "input" }) as { oneOf?: unknown }).oneOf });
const parametersInput = z.object({}).strict();
const reconcileInput = z.object({ link_attempt_id: attempt, recovery_id: recoveryId }).strict();
const recoveryListInput = z.object({ link_attempt_id: attempt, limit: z.number().int().min(1).max(128).optional() }).strict();
const resultPageInput = z.object({ link_attempt_id: attempt, recovery_id: recoveryId, offset: z.number().int().min(0).max(MAX_RESULTS).optional() }).strict();

const sourceOutput = z.object({ status: z.literal("CURRENT_STATIC_DIALOGUE_SOURCE_CONTRACT"),
  source_binding: z.object({ build_id: z.literal("1791904852"), audio_route_module: z.literal("index8.js"), audio_route_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    form_module: z.literal("elevenlabs.js"), form_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    public_catalog_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u) }).strict(),
  models: z.array(z.object({ model_id: model, max_prompt_length: z.number().int().positive(), max_inputs: z.literal(100), aggregate_text_length: z.number().int().positive() }).strict()).length(3),
  sender: z.object({ route: z.literal("audio/generate"), prompt: z.literal("EXPLICIT_COMMON_PROMPT_PASSED_THROUGH_UNCHANGED"),
    inputs: z.literal("ORDERED_NAME_TEXT_VOICE_ID"), chars_count: z.literal("INPUT_TEXT_ONLY") }).strict(),
  effective_defaults: z.literal("UNKNOWN"), runtime_usable: z.literal(false), backend_acceptance: z.literal("UNPROVEN") }).strict();
const diagnostic = z.object({ phase: z.enum(["VALIDATE_REQUEST", "RESOLVE_PRINCIPAL", "PREPARE_CANDIDATE", "PREFLIGHT", "CHAT_CREATE",
  "GENERATION_POST", "POST_ACK_KNOWN", "HISTORY_GET", "RESULT_GET", "RESULT_BINDING"]), post_started: z.boolean(), ack_known: z.boolean(),
  owner_ack_status: z.enum(["NOT_READ", "MATCHED", "UNKNOWN", "MISSING", "AMBIGUOUS", "MISMATCH"]),
  history_get_calls: z.number().int().min(0).max(255), result_get_calls: z.number().int().min(0).max(255), gaps: z.array(z.string().max(128)).max(32) }).strict();
const artifact = z.object({ url: z.string().url().max(8_192).refine(isSafeUploadReferenceUrl), mime_type: z.null(), mime_source: z.literal("UNKNOWN"),
  message_id: z.string().regex(SAFE_ID), message_object_id: z.string().regex(SAFE_ID), object_index: z.number().int().min(0).max(63),
  object_type: z.literal("audio"), model_echo: z.enum(["MATCHED", "UNKNOWN"]) }).strict();
const generationOutput = z.object({ status: z.enum(["observed_results", "partial_results"]), status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"),
  backend_acceptance: z.literal("UNPROVEN"), provider_terminal_status: z.literal("UNPROVEN"), model_id: model,
  parameters: z.object({ mode: z.literal("text_to_dialogue"), chars_count: z.number().int().min(1).max(10_000), line_count: z.number().int().min(2).max(100) }).strict(),
  recovery_id: recoveryId, observed_artifact_count: z.number().int().min(0).max(MAX_RESULTS), offset: z.number().int().min(0).max(MAX_RESULTS),
  page_size: z.literal(PAGE_SIZE), artifacts: z.array(artifact).max(PAGE_SIZE), has_more: z.boolean(), next_offset: z.number().int().min(1).max(MAX_RESULTS).nullable(),
  diagnostic }).strict().superRefine((value, context) => {
  if (value.has_more !== (value.next_offset !== null) || (value.has_more && value.next_offset !== value.offset + value.artifacts.length) ||
      value.offset + value.artifacts.length > value.observed_artifact_count) context.addIssue({ code: "custom", path: ["next_offset"], message: "Result paging metadata is inconsistent." });
});
const recoveryItem = z.object({ recovery_id: recoveryId, created_at: z.iso.datetime(), model_id: model, status: z.enum(["outcome_unknown", "partial_results"]),
  observed_artifact_count: z.number().int().min(0).max(MAX_RESULTS), diagnostic }).strict();
const recoveryListOutput = z.object({ recoveries: z.array(recoveryItem).max(128) }).strict();

export const SYNTX_OWNER_ELEVENLABS_DIALOGUE_TOOL_NAMES = Object.freeze([
  "syntx_get_elevenlabs_dialogue_parameters", "syntx_owner_generate_elevenlabs_dialogue", "syntx_owner_reconcile_elevenlabs_dialogue",
  "syntx_owner_list_elevenlabs_dialogue_recoveries", "syntx_owner_get_elevenlabs_dialogue_result_page"
] as const);
export const OWNER_ELEVENLABS_DIALOGUE_TOOL_INPUT_SCHEMAS = Object.freeze({ parameters: parametersInput, generate: generateInput,
  reconcile: reconcileInput, list_recoveries: recoveryListInput, result_page: resultPageInput });
export const OWNER_ELEVENLABS_DIALOGUE_TOOL_OUTPUT_SCHEMAS = Object.freeze({ parameters: sourceOutput, generate: generationOutput,
  reconcile: generationOutput, list_recoveries: recoveryListOutput, result_page: generationOutput });

export function registerSyntxOwnerElevenLabsDialogueTools(server: McpServer, serviceInput: unknown): void {
  if (!isOwnerElevenLabsDialogueGenerationService(serviceInput)) throw new Error("ELEVENLABS_DIALOGUE_SERVICE_COMPOSITION_INVALID");
  const service = serviceInput;
  server.registerTool(SYNTX_OWNER_ELEVENLABS_DIALOGUE_TOOL_NAMES[0], { title: "Get ElevenLabs dialogue parameters",
    description: "Returns the current dialogue model and sender-source contract. It does not read account access or claim provider acceptance.",
    inputSchema: parametersInput, outputSchema: sourceOutput,
    annotations: { title: "Get ElevenLabs dialogue parameters", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async () => structured(parseOutput(sourceOutput, sourceProjection())));

  server.registerTool(SYNTX_OWNER_ELEVENLABS_DIALOGUE_TOOL_NAMES[1], { title: "Generate ElevenLabs dialogue audio",
    description: "Submits one explicit owner dialogue request with ordered speaker lines and opaque voice references. An uncertain outcome must be reconciled; do not retry generation.",
    inputSchema: generateInput, outputSchema: generationOutput,
    annotations: { title: "Generate ElevenLabs dialogue audio", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = variant.safeParse(snapshotSafeInput(input));
    if (!parsed.success) return generationError(undefined, "INVALID_REQUEST");
    const { link_attempt_id, ...request } = parsed.data;
    try { return structured(parseOutput(generationOutput, await service.generate({ attemptId: link_attempt_id, request }, signal))); }
    catch (error) { return generationError(error, "PRE_DISPATCH_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_ELEVENLABS_DIALOGUE_TOOL_NAMES[2], { title: "Reconcile ElevenLabs dialogue (GET only)",
    description: "GET-only recovery for an exact owner attempt and recovery id. It never creates a chat or replays dialogue generation.",
    inputSchema: reconcileInput, outputSchema: generationOutput,
    annotations: { title: "Reconcile ElevenLabs dialogue (GET only)", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = reconcileInput.safeParse(snapshotSafeInput(input)); if (!parsed.success) return generationError(undefined, "INVALID_REQUEST");
    try { return structured(parseOutput(generationOutput, await service.reconcile({ attemptId: parsed.data.link_attempt_id, recovery_id: parsed.data.recovery_id }, signal))); }
    catch (error) { return generationError(error, "PRE_DISPATCH_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_ELEVENLABS_DIALOGUE_TOOL_NAMES[3], { title: "List ElevenLabs dialogue recoveries",
    description: "Lists bounded process-local owner recovery summaries without private dialogue text, voice IDs or output URLs.",
    inputSchema: recoveryListInput, outputSchema: recoveryListOutput,
    annotations: { title: "List ElevenLabs dialogue recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    const parsed = recoveryListInput.safeParse(snapshotSafeInput(input)); if (!parsed.success) return recoveryListError("INVALID_REQUEST");
    try { const recoveries = await service.listRecoveries({ attemptId: parsed.data.link_attempt_id, ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }) });
      return structured(parseOutput(recoveryListOutput, { recoveries })); }
    catch (error) { return recoveryListError(safeRecoveryListCode(error)); }
  });

  server.registerTool(SYNTX_OWNER_ELEVENLABS_DIALOGUE_TOOL_NAMES[4], { title: "Get ElevenLabs dialogue result page",
    description: "Returns one cached page of locally observed dialogue audio URLs. MIME and provider terminal status remain unknown.",
    inputSchema: resultPageInput, outputSchema: generationOutput,
    annotations: { title: "Get ElevenLabs dialogue result page", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    const parsed = resultPageInput.safeParse(snapshotSafeInput(input)); if (!parsed.success) return generationError(undefined, "INVALID_REQUEST");
    try { return structured(parseOutput(generationOutput, await service.getResultPage({ attemptId: parsed.data.link_attempt_id,
      recovery_id: parsed.data.recovery_id, ...(parsed.data.offset === undefined ? {} : { offset: parsed.data.offset }) }))); }
    catch (error) { return generationError(error, "PRE_DISPATCH_FAILED"); }
  });
}

function sourceProjection() {
  return { status: "CURRENT_STATIC_DIALOGUE_SOURCE_CONTRACT" as const,
    source_binding: { build_id: SOURCE.source_binding.build_id, audio_route_module: SOURCE.source_binding.audio_route_module.name,
      audio_route_sha256: SOURCE.source_binding.audio_route_module.sha256, form_module: SOURCE.source_binding.form_module.name,
      form_sha256: SOURCE.source_binding.form_module.sha256, public_catalog_sha256: SOURCE.source_binding.public_catalog_sha256 },
    models: MODELS.map((model_id) => ({ model_id, max_prompt_length: SOURCE.models[model_id].max_prompt_length,
      max_inputs: 100 as const, aggregate_text_length: SOURCE.models[model_id].dialogue_prompt_limit })),
    sender: { route: "audio/generate" as const, prompt: "EXPLICIT_COMMON_PROMPT_PASSED_THROUGH_UNCHANGED" as const,
      inputs: "ORDERED_NAME_TEXT_VOICE_ID" as const, chars_count: "INPUT_TEXT_ONLY" as const },
    effective_defaults: "UNKNOWN" as const, runtime_usable: false as const, backend_acceptance: "UNPROVEN" as const };
}
const ERROR_MESSAGES: Record<OwnerElevenLabsDialogueGenerationServiceErrorCode, string> = {
  INVALID_REQUEST: "The ElevenLabs dialogue request is invalid.", SERVICE_CLOSED: "The owner ElevenLabs dialogue service is closed.",
  SERVICE_BUSY: "The owner ElevenLabs dialogue service is busy.", PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.",
  MODEL_BINDING_MISMATCH: "The current ElevenLabs dialogue source profile is unavailable.", PREFLIGHT_FAILED: "Current account or dialogue model access could not be verified.",
  INTENT_ALREADY_CLAIMED: "This dialogue intent has an unresolved outcome; do not submit it again.", PRE_DISPATCH_FAILED: "The dialogue request was not safely dispatched.",
  OUTCOME_UNKNOWN: "The dialogue request may have been dispatched; reconcile its recovery and do not retry.", RECOVERY_NOT_FOUND: "The dialogue recovery is unavailable or expired."
};
function generationError(error: unknown, fallback: OwnerElevenLabsDialogueGenerationServiceErrorCode): CallToolResult {
  let code = fallback; let recovery: string | undefined;
  if (isServiceError(error)) { const candidate = ownData(error, "code"), id = ownData(error, "recovery_id");
    if (typeof candidate === "string" && Object.hasOwn(ERROR_MESSAGES, candidate)) code = candidate as OwnerElevenLabsDialogueGenerationServiceErrorCode;
    if (typeof id === "string" && RECOVERY.test(id)) recovery = id; }
  return errorResult({ error: { code, message: ERROR_MESSAGES[code], ...(code === "OUTCOME_UNKNOWN" && recovery ? { recovery_id: recovery } : {}) } });
}
function recoveryListError(code: "INVALID_REQUEST" | "SERVICE_BUSY" | "SERVICE_CLOSED" | "PRINCIPAL_NOT_LINKED"): CallToolResult {
  const messages = { INVALID_REQUEST: "The recovery request is invalid.", SERVICE_BUSY: "The dialogue service is busy.",
    SERVICE_CLOSED: "The dialogue service is closed.", PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required." };
  return errorResult({ error: { code, message: messages[code] } });
}
function safeRecoveryListCode(error: unknown): "INVALID_REQUEST" | "SERVICE_BUSY" | "SERVICE_CLOSED" | "PRINCIPAL_NOT_LINKED" {
  if (!isServiceError(error)) return "SERVICE_BUSY";
  return error.code === "INVALID_REQUEST" || error.code === "SERVICE_CLOSED" || error.code === "PRINCIPAL_NOT_LINKED" ? error.code : "SERVICE_BUSY";
}
function isServiceError(value: unknown): value is OwnerElevenLabsDialogueGenerationServiceError {
  return Boolean(value) && typeof value === "object" && !types.isProxy(value) && value instanceof OwnerElevenLabsDialogueGenerationServiceError;
}
function ownData(value: object, key: string): unknown { const d = Object.getOwnPropertyDescriptor(value, key); return d && "value" in d ? d.value : undefined; }
function isWellFormedUnicode(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) { const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(i + 1); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; i += 1; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  } return true;
}
function snapshotSafeInput(value: unknown): unknown { try { return snapshotJson(value, 0, { nodes: 0 }); } catch { return undefined; } }
function snapshotJson(value: unknown, depth: number, budget: { nodes: number }): unknown {
  budget.nodes += 1; if (budget.nodes > 50_000 || depth > 32) throw new TypeError("invalid input");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new TypeError("invalid number"); return value; }
  if (!value || typeof value !== "object" || types.isProxy(value)) throw new TypeError("invalid object");
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError("invalid array"); const d = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(d);
    if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) ||
      Number(key) >= value.length || !("value" in d[key]!) || !d[key]!.enumerable))) throw new TypeError("invalid array");
    const out: unknown[] = []; for (let i = 0; i < value.length; i += 1) { const item = d[String(i)];
      if (!item || !("value" in item) || !item.enumerable) throw new TypeError("invalid item"); out.push(snapshotJson(item.value, depth + 1, budget)); } return out;
  }
  const proto = Object.getPrototypeOf(value); if (proto !== Object.prototype && proto !== null) throw new TypeError("invalid object");
  const d = Object.getOwnPropertyDescriptors(value), out: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(d)) { if (typeof key !== "string" || !("value" in d[key]!) || !d[key]!.enumerable) throw new TypeError("invalid field");
    Object.defineProperty(out, key, { value: snapshotJson(d[key]!.value, depth + 1, budget), enumerable: true }); }
  return out;
}
function parseOutput(schema: z.ZodType, value: unknown): Record<string, unknown> {
  const result = schema.safeParse(snapshotSafeInput(value)); if (!result.success || !result.data || typeof result.data !== "object" || Array.isArray(result.data)) throw new Error("DIALOGUE_OUTPUT_INVALID");
  return result.data as Record<string, unknown>;
}
function structured(value: object): CallToolResult { return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> }; }
function errorResult(value: object): CallToolResult { return { isError: true, content: [{ type: "text", text: JSON.stringify(value) }] }; }
