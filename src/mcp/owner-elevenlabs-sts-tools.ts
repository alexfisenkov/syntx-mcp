import { types } from "node:util";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OwnerElevenLabsStsGenerationService, isOwnerElevenLabsStsGenerationService,
  OwnerElevenLabsStsGenerationServiceError, type OwnerElevenLabsStsGenerationServiceErrorCode } from "../application/owner-elevenlabs-sts-generation-service.js";
import { OwnerElevenLabsStsOriginalReferenceService, OwnerElevenLabsStsOriginalReferenceServiceError,
  type OwnerElevenLabsStsOriginalReferenceServiceErrorCode } from "../application/owner-elevenlabs-sts-original-reference-service.js";
import { getOwnerElevenLabsStsParameterProfile, OWNER_ELEVENLABS_STS_MODEL_ID,
  OWNER_ELEVENLABS_STS_MODE } from "../application/owner-elevenlabs-sts-parameters.js";
import type { OwnerElevenLabsVoiceReferenceService } from "../application/owner-elevenlabs-voice-reference-service.js";
import { isOwnerElevenLabsVoiceReferenceService } from "./owner-elevenlabs-voice-tools.js";

const MAX_UPLOAD_BYTES = 52_428_800;
const MAX_BASE64_CHARS = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4;
const MAX_RESULTS = 4_096;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const ORIGINAL = /^elevenlabs_sts_original_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const VOICE = /^owner_elevenlabs_voice_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RECOVERY = /^elevenlabs_sts_recovery_[0-9a-f-]{36}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;

export const SYNTX_GET_ELEVENLABS_STS_PARAMETERS_TOOL_NAME = "syntx_get_elevenlabs_sts_parameters" as const;
export const SYNTX_OWNER_UPLOAD_ELEVENLABS_STS_ORIGINAL_TOOL_NAME = "syntx_owner_upload_elevenlabs_sts_original" as const;
export const SYNTX_OWNER_GENERATE_ELEVENLABS_STS_TOOL_NAME = "syntx_owner_generate_elevenlabs_sts" as const;
export const SYNTX_OWNER_RECONCILE_ELEVENLABS_STS_TOOL_NAME = "syntx_owner_reconcile_elevenlabs_sts" as const;
export const SYNTX_OWNER_LIST_ELEVENLABS_STS_RECOVERIES_TOOL_NAME = "syntx_owner_list_elevenlabs_sts_recoveries" as const;
export const SYNTX_OWNER_GET_ELEVENLABS_STS_RESULT_PAGE_TOOL_NAME = "syntx_owner_get_elevenlabs_sts_result_page" as const;
export const OWNER_ELEVENLABS_STS_TOOL_NAMES = Object.freeze([
  SYNTX_GET_ELEVENLABS_STS_PARAMETERS_TOOL_NAME,
  SYNTX_OWNER_UPLOAD_ELEVENLABS_STS_ORIGINAL_TOOL_NAME,
  SYNTX_OWNER_GENERATE_ELEVENLABS_STS_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_ELEVENLABS_STS_TOOL_NAME,
  SYNTX_OWNER_LIST_ELEVENLABS_STS_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_GET_ELEVENLABS_STS_RESULT_PAGE_TOOL_NAME
] as const);

const attemptSchema = z.string().regex(ATTEMPT).describe("Exact current owner-link attempt.");
const originalSchema = z.string().regex(ORIGINAL);
const voiceSchema = z.string().regex(VOICE).describe("Opaque owner voice reference from the shared ElevenLabs voice-list tool.");
const recoverySchema = z.string().regex(RECOVERY);
const parametersInput = z.object({}).strict();
const uploadInput = z.object({ link_attempt_id: attemptSchema, filename: z.string().min(1).max(255).regex(/^[^\u0000-\u001f\\/:*?"<>|]+\.mp3$/iu),
  mime_type: z.literal("audio/mpeg"), content_base64: z.string().min(4).max(MAX_BASE64_CHARS).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u) }).strict();
const generateInput = z.object({ link_attempt_id: attemptSchema, model_id: z.literal(OWNER_ELEVENLABS_STS_MODEL_ID),
  mode: z.literal(OWNER_ELEVENLABS_STS_MODE), audio_original_handle: originalSchema, voice_ref: voiceSchema }).strict();
const reconcileInput = z.object({ link_attempt_id: attemptSchema, recovery_id: recoverySchema }).strict();
const listInput = z.object({ link_attempt_id: attemptSchema, limit: z.number().int().min(1).max(128).optional() }).strict();
const pageInput = z.object({ link_attempt_id: attemptSchema, recovery_id: recoverySchema,
  offset: z.number().int().min(0).max(MAX_RESULTS).optional() }).strict();

const diagnosticSchema = z.object({ phase: z.enum(["VALIDATE_REQUEST", "RESOLVE_PRINCIPAL", "PREPARE_CANDIDATE", "PREFLIGHT_ONE", "CHAT_CREATE",
  "PREFLIGHT_TWO", "GENERATION_POST", "POST_ACK_KNOWN", "HISTORY_GET", "RESULT_GET", "RESULT_BINDING"]), post_started: z.boolean(), ack_known: z.boolean(),
  history_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "INCOMPLETE", "UNVERIFIED"]), owner_ack_status: z.enum(["NOT_READ", "MATCHED", "MISSING", "AMBIGUOUS", "MISMATCH"]),
  history_get_calls: z.number().int().min(0).max(255), result_get_calls: z.number().int().min(0).max(255),
  result_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "UNVERIFIED"]), gaps: z.array(z.string().max(128)).max(32) }).strict();
const recoveryId = z.string().regex(RECOVERY);
const resultSchema = z.object({ status: z.literal("completed"), status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"),
  backend_acceptance: z.literal("UNPROVEN"), provider_terminal_status: z.literal("UNPROVEN"), cost_cap_enforced: z.literal(false),
  recovery_id: recoveryId, model_id: z.literal(OWNER_ELEVENLABS_STS_MODEL_ID), source_binding: z.object({
    public_catalog_version: z.string().regex(/^sha256-[a-f0-9]{64}\.json$/u), profile_schema_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    request_fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u), intent_fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u) }).strict(),
  observed_artifact_count: z.number().int().min(0).max(MAX_RESULTS), offset: z.number().int().min(0).max(MAX_RESULTS), page_size: z.literal(64),
  artifacts: z.array(z.object({ object_index: z.literal(0), message_object_id: z.string().regex(SAFE_ID), object_type: z.literal("audio"),
    object_url: z.string().url().max(4_096).refine(isSafeAudioUrl), mime_type: z.literal("audio/mpeg"),
    mime_source: z.literal("URL_EXTENSION_LOCAL_POLICY"), message_id: z.string().regex(SAFE_ID), chat_uuid: z.string().regex(SAFE_ID),
    model_id: z.literal(OWNER_ELEVENLABS_STS_MODEL_ID) }).strict()).max(64), has_more: z.boolean(), next_offset: z.number().int().min(1).max(MAX_RESULTS).nullable(),
  diagnostic: diagnosticSchema }).strict().superRefine((r, c) => {
    if (r.has_more !== (r.next_offset !== null) || (r.has_more && r.next_offset !== r.offset + r.artifacts.length) ||
        r.offset + r.artifacts.length > r.observed_artifact_count) c.addIssue({ code: "custom", path: ["next_offset"], message: "Inconsistent result page." });
  });
const uploadOutput = z.object({ status: z.literal("uploaded"), audio_original_handle: originalSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/u), size: z.number().int().min(1).max(MAX_UPLOAD_BYTES), mime_type: z.literal("audio/mpeg"),
  duration_seconds: z.number().positive().max(300), expires_in_seconds: z.number().int().min(0).max(900) }).strict();
const recoveryItem = z.object({ recovery_id: recoveryId, created_at: z.iso.datetime(), model_id: z.literal(OWNER_ELEVENLABS_STS_MODEL_ID),
  status: z.enum(["outcome_unknown", "completed"]), observed_artifact_count: z.number().int().min(0).max(MAX_RESULTS), diagnostic: diagnosticSchema }).strict();
const recoveryListOutput = z.object({ recoveries: z.array(recoveryItem).max(128) }).strict();
const parametersOutput = z.object({ status: z.literal("PARTIAL_SOURCE_REPORT"), model_id: z.literal(OWNER_ELEVENLABS_STS_MODEL_ID),
  mode: z.literal(OWNER_ELEVENLABS_STS_MODE), source_scope: z.literal("PARTIAL_SOURCE_REPORT_ONLY"),
  original: z.object({ mime_type: z.literal("audio/mpeg"), minimum_duration_seconds: z.literal(5), maximum_duration_seconds: z.literal(300),
    maximum_bytes: z.literal(MAX_UPLOAD_BYTES) }).strict(), runtime_usable: z.literal(false), generation_allowed: z.literal(false),
  backend_acceptance: z.literal("UNPROVEN") }).strict();

export interface RegisterSyntxOwnerElevenLabsStsToolsOptions {
  readonly generationService: OwnerElevenLabsStsGenerationService;
  readonly originalReferenceService: OwnerElevenLabsStsOriginalReferenceService;
  readonly voiceReferenceService: OwnerElevenLabsVoiceReferenceService;
}

export function registerSyntxOwnerElevenLabsStsTools(server: McpServer, optionsInput: unknown): void {
  const options = snapshotOptions(optionsInput);
  server.registerTool(SYNTX_GET_ELEVENLABS_STS_PARAMETERS_TOOL_NAME, { title: "Get ElevenLabs STS parameters",
    description: "Reports the locally evidenced STS v2 input bounds and partial source scope; it does not establish provider support or acceptance.",
    inputSchema: parametersInput, outputSchema: parametersOutput,
    annotations: { title: "Get ElevenLabs STS parameters", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async () => structured(parseOutput(parametersOutput, parameterProjection())));

  server.registerTool(SYNTX_OWNER_UPLOAD_ELEVENLABS_STS_ORIGINAL_TOOL_NAME, { title: "Upload owner ElevenLabs STS original",
    description: "Validates and uploads one bounded MP3 source for the exact linked owner attempt. An uncertain upload must not be repeated.",
    inputSchema: uploadInput, outputSchema: uploadOutput,
    annotations: { title: "Upload STS original audio", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = uploadInput.safeParse(snapshotSafeInput(input));
    if (!parsed.success) return originalError(undefined, "INVALID_REQUEST");
    try {
      // Bound encoded length before Buffer allocates the decoded payload.
      if (parsed.data.content_base64.length > MAX_BASE64_CHARS) return originalError(undefined, "INVALID_REQUEST");
      const padding = parsed.data.content_base64.endsWith("==") ? 2 : parsed.data.content_base64.endsWith("=") ? 1 : 0;
      const decodedSize = parsed.data.content_base64.length / 4 * 3 - padding;
      if (!Number.isSafeInteger(decodedSize) || decodedSize < 1 || decodedSize > MAX_UPLOAD_BYTES) return originalError(undefined, "INVALID_REQUEST");
      const bytes = Buffer.from(parsed.data.content_base64, "base64");
      if (bytes.length === 0 || bytes.length > MAX_UPLOAD_BYTES || bytes.toString("base64") !== parsed.data.content_base64) {
        bytes.fill(0); return originalError(undefined, "INVALID_REQUEST");
      }
      try {
        const result = await options.originalReferenceService.uploadOriginal({ attemptId: parsed.data.link_attempt_id,
          filename: parsed.data.filename, mime_type: "audio/mpeg", bytes }, signal);
        return structured(parseOutput(uploadOutput, result));
      } finally { bytes.fill(0); }
    } catch (error) { return originalError(error, "PROBE_REJECTED"); }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_ELEVENLABS_STS_TOOL_NAME, { title: "Generate ElevenLabs STS audio",
    description: "Starts one source-bound STS v2 request. An uncertain outcome is not safe to retry; reconcile its recovery using GET-only reads.",
    inputSchema: generateInput, outputSchema: resultSchema,
    annotations: { title: "Generate ElevenLabs STS audio", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = generateInput.safeParse(snapshotSafeInput(input)); if (!parsed.success) return generationError(undefined, "INVALID_REQUEST");
    try { return structured(parseOutput(resultSchema, await options.generationService.generate({ attemptId: parsed.data.link_attempt_id,
      request: { model_id: parsed.data.model_id, mode: parsed.data.mode, audio_original_handle: parsed.data.audio_original_handle,
        voice_ref: parsed.data.voice_ref } }, signal))); }
    catch (error) { return generationError(error, "PRE_DISPATCH_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_ELEVENLABS_STS_TOOL_NAME, { title: "Reconcile ElevenLabs STS",
    description: "GET-only reconciliation of one exact owner recovery. It never starts or repeats generation.", inputSchema: reconcileInput,
    outputSchema: resultSchema, annotations: { title: "Reconcile STS generation", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = reconcileInput.safeParse(snapshotSafeInput(input)); if (!parsed.success) return generationError(undefined, "INVALID_REQUEST");
    try { return structured(parseOutput(resultSchema, await options.generationService.reconcile({ attemptId: parsed.data.link_attempt_id,
      recovery_id: parsed.data.recovery_id }, signal))); } catch (error) { return generationError(error, "PRE_DISPATCH_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_LIST_ELEVENLABS_STS_RECOVERIES_TOOL_NAME, { title: "List ElevenLabs STS recoveries",
    description: "Lists bounded process-local recovery summaries for the exact owner attempt without source or result URLs.", inputSchema: listInput,
    outputSchema: recoveryListOutput, annotations: { title: "List STS recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    const parsed = listInput.safeParse(snapshotSafeInput(input)); if (!parsed.success) return recoveryListError("INVALID_REQUEST");
    try { return structured(parseOutput(recoveryListOutput, { recoveries: await options.generationService.listRecoveries({
      attemptId: parsed.data.link_attempt_id, ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }) }) })); }
    catch (error) { return recoveryListError(safeGenerationCode(error)); }
  });

  server.registerTool(SYNTX_OWNER_GET_ELEVENLABS_STS_RESULT_PAGE_TOOL_NAME, { title: "Get ElevenLabs STS result page",
    description: "Reads one page from the local observed-result cache and does not imply provider acceptance or terminal status.", inputSchema: pageInput,
    outputSchema: resultSchema, annotations: { title: "Get STS result page", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    const parsed = pageInput.safeParse(snapshotSafeInput(input)); if (!parsed.success) return generationError(undefined, "INVALID_REQUEST");
    try { return structured(parseOutput(resultSchema, await options.generationService.getResultPage({ attemptId: parsed.data.link_attempt_id,
      recovery_id: parsed.data.recovery_id, ...(parsed.data.offset === undefined ? {} : { offset: parsed.data.offset }) }))); }
    catch (error) { return generationError(error, "PRE_DISPATCH_FAILED"); }
  });
}

const GENERATION_MESSAGES: Record<OwnerElevenLabsStsGenerationServiceErrorCode, string> = {
  INVALID_REQUEST: "The ElevenLabs STS request is invalid.", SERVICE_CLOSED: "The owner ElevenLabs STS service is closed.",
  SERVICE_BUSY: "The owner ElevenLabs STS service is busy.", PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.",
  MODEL_BINDING_MISMATCH: "The selected ElevenLabs STS model profile is unavailable.", PREFLIGHT_FAILED: "Current account or model access could not be verified.",
  INTENT_ALREADY_CLAIMED: "This ElevenLabs STS intent already has an unresolved outcome.", PRE_DISPATCH_FAILED: "The request was not safely dispatched.",
  OUTCOME_UNKNOWN: "The request may have been dispatched; reconcile its recovery and do not retry.", RECOVERY_NOT_FOUND: "The recovery is unavailable or expired."
};
const ORIGINAL_MESSAGES: Record<OwnerElevenLabsStsOriginalReferenceServiceErrorCode, string> = {
  INVALID_REQUEST: "The STS original upload request is invalid.", PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.",
  REQUEST_ABORTED: "The STS original upload was cancelled.", SERVICE_BUSY: "The STS original service is busy.", CAPACITY_EXCEEDED: "The STS original service is full.",
  SERVICE_CLOSED: "The STS original service is closed.", PROBE_REJECTED: "The source was not accepted as a valid MP3.", UPLOAD_REJECTED: "The upload was rejected.",
  UPLOAD_OUTCOME_UNKNOWN: "The upload outcome is unknown; do not repeat it.", REFERENCE_UNAVAILABLE: "The uploaded original is unavailable.", REFERENCE_EXPIRED: "The uploaded original has expired."
};

function snapshotOptions(value: unknown): RegisterSyntxOwnerElevenLabsStsToolsOptions {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("ELEVENLABS_STS_SERVICE_COMPOSITION_INVALID");
  const d = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(d), allowed = ["generationService", "originalReferenceService", "voiceReferenceService"];
  if (keys.length !== allowed.length || keys.some((k) => typeof k !== "string" || !allowed.includes(k) || !("value" in d[k]!) || !d[k]!.enumerable) ||
      !isOwnerElevenLabsStsGenerationService(d.generationService?.value) || !isOriginalService(d.originalReferenceService?.value) ||
      !isOwnerElevenLabsVoiceReferenceService(d.voiceReferenceService?.value)) throw new Error("ELEVENLABS_STS_SERVICE_COMPOSITION_INVALID");
  return Object.freeze({ generationService: d.generationService!.value as OwnerElevenLabsStsGenerationService,
    originalReferenceService: d.originalReferenceService!.value as OwnerElevenLabsStsOriginalReferenceService,
    voiceReferenceService: d.voiceReferenceService!.value as OwnerElevenLabsVoiceReferenceService });
}
function isOriginalService(value: unknown): value is OwnerElevenLabsStsOriginalReferenceService {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === OwnerElevenLabsStsOriginalReferenceService.prototype &&
    !Object.hasOwn(value, "uploadOriginal") && !Object.hasOwn(value, "resolveOriginal");
}
function parameterProjection() {
  const p = getOwnerElevenLabsStsParameterProfile();
  return { status: "PARTIAL_SOURCE_REPORT", model_id: p.model_id, mode: p.mode, source_scope: p.source_scope,
    original: { mime_type: p.input_boundary.mime_type, minimum_duration_seconds: p.input_boundary.minimum_duration_seconds,
      maximum_duration_seconds: p.input_boundary.maximum_duration_seconds, maximum_bytes: p.input_boundary.maximum_bytes },
    runtime_usable: false, generation_allowed: false, backend_acceptance: p.backend_acceptance };
}
function isSafeAudioUrl(input: string): boolean { try { const u = new URL(input); return u.protocol === "https:" && u.hostname === "r2.syntx.ai" && !u.port && !u.username && !u.password && !u.hash && u.pathname.toLowerCase().endsWith(".mp3"); } catch { return false; } }
function safeGenerationCode(error: unknown): OwnerElevenLabsStsGenerationServiceErrorCode { return isGenerationError(error) && Object.hasOwn(GENERATION_MESSAGES, error.code) ? error.code : "PRE_DISPATCH_FAILED"; }
function isGenerationError(value: unknown): value is OwnerElevenLabsStsGenerationServiceError { return !!value && typeof value === "object" && !types.isProxy(value) && value instanceof OwnerElevenLabsStsGenerationServiceError; }
function generationError(error: unknown, fallback: OwnerElevenLabsStsGenerationServiceErrorCode): CallToolResult {
  const code = isGenerationError(error) && Object.hasOwn(GENERATION_MESSAGES, error.code) ? error.code : fallback;
  const recovery = code === "OUTCOME_UNKNOWN" && isGenerationError(error) && error.recovery_id && RECOVERY.test(error.recovery_id) ? { recovery_id: error.recovery_id } : {};
  const diagnostic = code === "OUTCOME_UNKNOWN" && isGenerationError(error) && error.diagnostic ? { diagnostic: error.diagnostic } : {};
  return errorResult({ error: { code, message: GENERATION_MESSAGES[code], ...recovery, ...diagnostic } });
}
function recoveryListError(code: "INVALID_REQUEST" | OwnerElevenLabsStsGenerationServiceErrorCode): CallToolResult { return errorResult({ error: { code, message: code === "INVALID_REQUEST" ? "The recovery-list request is invalid." : GENERATION_MESSAGES[code] } }); }
function originalError(error: unknown, fallback: OwnerElevenLabsStsOriginalReferenceServiceErrorCode): CallToolResult {
  const code = error instanceof OwnerElevenLabsStsOriginalReferenceServiceError && Object.hasOwn(ORIGINAL_MESSAGES, error.code) ? error.code : fallback;
  return errorResult({ error: { code, message: ORIGINAL_MESSAGES[code] } });
}
function parseOutput(schema: z.ZodType, value: unknown): Record<string, unknown> { const parsed = schema.safeParse(snapshotSafeInput(value)); if (!parsed.success || !parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) throw new Error("ELEVENLABS_STS_OUTPUT_INVALID"); return parsed.data as Record<string, unknown>; }
function snapshotSafeInput(value: unknown): unknown { try { return snapshotJson(value, 0, { nodes: 0 }); } catch { return undefined; } }
function snapshotJson(value: unknown, depth: number, budget: { nodes: number }): unknown {
  budget.nodes += 1; if (budget.nodes > 50_000 || depth > 32) throw new TypeError("invalid input");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new TypeError("invalid number"); return value; }
  if (!value || typeof value !== "object" || types.isProxy(value)) throw new TypeError("invalid object");
  if (Array.isArray(value)) { if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError("invalid array"); const d = Object.getOwnPropertyDescriptors(value); const keys = Reflect.ownKeys(d);
    if (keys.length !== value.length + 1 || keys.some((k) => k !== "length" && (typeof k !== "string" || !/^(?:0|[1-9]\d*)$/u.test(k) || Number(k) >= value.length || !("value" in d[k]!) || !d[k]!.enumerable))) throw new TypeError("invalid array");
    return Array.from({ length: value.length }, (_, i) => { const item = d[String(i)]; if (!item || !("value" in item) || !item.enumerable) throw new TypeError("invalid array item"); return snapshotJson(item.value, depth + 1, budget); }); }
  const proto = Object.getPrototypeOf(value); if (proto !== Object.prototype && proto !== null) throw new TypeError("invalid record"); const d = Object.getOwnPropertyDescriptors(value), out: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(d)) { if (typeof key !== "string" || !("value" in d[key]!) || !d[key]!.enumerable) throw new TypeError("invalid field"); Object.defineProperty(out, key, { value: snapshotJson(d[key]!.value, depth + 1, budget), enumerable: true }); } return out;
}
function structured(value: object): CallToolResult { return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> }; }
function errorResult(value: object): CallToolResult { return { isError: true, content: [{ type: "text", text: JSON.stringify(value) }] }; }
