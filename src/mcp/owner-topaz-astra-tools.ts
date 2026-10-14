import { types } from "node:util";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OwnerTopazAstraGenerationService, OwnerTopazAstraGenerationServiceError,
  isOwnerTopazAstraGenerationService, type OwnerTopazAstraGenerationServiceErrorCode } from "../application/owner-topaz-astra-generation-service.js";
import { OwnerTopazAstraOriginalReferenceService, OwnerTopazAstraOriginalReferenceServiceError,
  type OwnerTopazAstraOriginalReferenceServiceErrorCode } from "../application/owner-topaz-astra-original-reference-service.js";
import { OWNER_TOPAZ_ASTRA_MODEL_IDS, getOwnerTopazAstraSourceProfile } from "../application/owner-topaz-astra-source-profile.js";
import { OWNER_TOPAZ_ASTRA_PROMPT_LOCAL_BOUND } from "../application/owner-topaz-astra-parameters.js";

const MAX_BYTES = 52_428_800, MAX_BASE64 = Math.ceil(MAX_BYTES / 3) * 4, MAX_RESULTS = 4096;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^topaz_astra_original_[0-9a-f-]{36}$/u, RECOVERY = /^topaz_astra_recovery_[0-9a-f-]{36}$/u;
const attempt = z.string().regex(ATTEMPT);
const model = z.enum(OWNER_TOPAZ_ASTRA_MODEL_IDS);
const uploadInput = z.object({ link_attempt_id: attempt, model_id: model,
  filename: z.string().min(1).max(255).regex(/^[^\u0000-\u001f\\/:*?"<>|]+\.(?:mp4|mov)$/iu),
  mime_type: z.enum(["video/mp4", "video/quicktime"]), content_base64: z.string().min(4).max(MAX_BASE64)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u) }).strict();
const generateInput = z.object({ link_attempt_id: attempt, model_id: model, topaz_original_handle: z.string().regex(HANDLE),
  prompt: z.string().refine((value) => Buffer.byteLength(value, "utf8") <= OWNER_TOPAZ_ASTRA_PROMPT_LOCAL_BOUND.max_utf8_bytes).optional(), parameters: z.object({ resolution: z.enum(["1920x1080", "3840x2160"]),
    frame_rate: z.union([z.literal(24), z.literal(30), z.literal(60), z.literal(120)]),
    slowmo: z.union([z.literal(null), z.literal(2), z.literal(3), z.literal(4), z.literal(6), z.literal(8), z.literal(10), z.literal(12), z.literal(16)]),
    creativity: z.enum(["low", "middle", "high"]) }).strict() }).strict();
const reconcileInput = z.object({ link_attempt_id: attempt, recovery_id: z.string().regex(RECOVERY) }).strict();
const listInput = z.object({ link_attempt_id: attempt, limit: z.number().int().min(1).max(128).optional() }).strict();
const pageInput = z.object({ link_attempt_id: attempt, recovery_id: z.string().regex(RECOVERY), offset: z.number().int().min(0).max(MAX_RESULTS).optional() }).strict();
const diagnostic = z.object({ phase: z.enum(["VALIDATE_REQUEST", "RESOLVE_PRINCIPAL", "PREPARE_CANDIDATE", "PREFLIGHT_ONE", "CHAT_CREATE", "PREFLIGHT_TWO", "GENERATION_POST", "POST_ACK_KNOWN", "HISTORY_GET", "RESULT_GET", "RESULT_BINDING"]),
  post_started: z.boolean(), ack_known: z.boolean(), history_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "INCOMPLETE", "UNVERIFIED"]),
  owner_ack_status: z.enum(["NOT_READ", "MATCHED", "MISSING", "AMBIGUOUS", "MISMATCH"]), history_get_calls: z.number().int().min(0).max(255),
  result_get_calls: z.number().int().min(0).max(255), result_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "UNVERIFIED"]), gaps: z.array(z.string().max(128)).max(32) }).strict();
const recoveryItem = z.object({ recovery_id: z.string().regex(RECOVERY), created_at: z.iso.datetime(), model_id: model,
  status: z.enum(["outcome_unknown", "completed"]), observed_artifact_count: z.number().int().min(0).max(MAX_RESULTS), diagnostic }).strict();
const recoveryList = z.object({ recoveries: z.array(recoveryItem).max(128) }).strict();
const parametersOutput = z.object({ status: z.literal("SOURCE_REVIEWED_STATIC_ONLY"), models: z.array(z.object({
  model_id: model, resolution: z.array(z.string()), frame_rate: z.array(z.number()), slowmo: z.array(z.number().nullable()),
  creativity: z.array(z.string()), maximum_bytes: z.number(), maximum_duration_seconds: z.number(), backend_acceptance: z.literal("UNPROVEN")
}).strict()).length(4), runtime_usable: z.literal(false), backend_acceptance: z.literal("UNPROVEN") }).strict();
const resultSchema = z.object({ status: z.literal("completed"), status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"),
  backend_acceptance: z.literal("UNPROVEN"), provider_terminal_status: z.literal("UNPROVEN"), cost_cap_enforced: z.literal(false),
  recovery_id: z.string().regex(RECOVERY), model_id: model, source_binding: z.object({ public_catalog_version: z.string(),
    profile_schema_hash: z.string(), request_fingerprint: z.string(), intent_fingerprint: z.string() }).strict(),
  observed_artifact_count: z.number().int().min(0).max(MAX_RESULTS), offset: z.number().int().min(0).max(MAX_RESULTS), page_size: z.literal(64),
  artifacts: z.array(z.object({ object_index: z.number().int(), message_object_id: z.string(), object_type: z.literal("video"),
    object_url: z.string().url().max(4096), mime_type: z.enum(["video/mp4", "video/quicktime"]).nullable(),
    mime_source: z.enum(["URL_EXTENSION", "UNKNOWN"]), message_id: z.string(), chat_uuid: z.string(), model_id: model }).strict()).max(64),
  has_more: z.boolean(), next_offset: z.number().int().nullable(), diagnostic }).strict();
const uploadOutput = z.object({ status: z.literal("uploaded"), topaz_original_handle: z.string().regex(HANDLE), model_id: model,
  mime_type: z.enum(["video/mp4", "video/quicktime"]), size: z.number().int().min(1).max(MAX_BYTES), sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  width: z.number().int(), height: z.number().int(), duration_seconds: z.number().positive().max(25), decoded_frame_count: z.number().int(),
  expires_in_seconds: z.number().int().min(0).max(900) }).strict();

export const SYNTX_GET_TOPAZ_ASTRA_PARAMETERS_TOOL_NAME = "syntx_get_topaz_astra_parameters" as const;
export const SYNTX_OWNER_UPLOAD_TOPAZ_ASTRA_ORIGINAL_TOOL_NAME = "syntx_owner_upload_topaz_astra_original" as const;
export const SYNTX_OWNER_GENERATE_TOPAZ_ASTRA_TOOL_NAME = "syntx_owner_generate_topaz_astra" as const;
export const SYNTX_OWNER_RECONCILE_TOPAZ_ASTRA_TOOL_NAME = "syntx_owner_reconcile_topaz_astra" as const;
export const SYNTX_OWNER_LIST_TOPAZ_ASTRA_RECOVERIES_TOOL_NAME = "syntx_owner_list_topaz_astra_recoveries" as const;
export const SYNTX_OWNER_GET_TOPAZ_ASTRA_RESULT_PAGE_TOOL_NAME = "syntx_owner_get_topaz_astra_result_page" as const;
export const OWNER_TOPAZ_ASTRA_TOOL_NAMES = Object.freeze([SYNTX_GET_TOPAZ_ASTRA_PARAMETERS_TOOL_NAME,
  SYNTX_OWNER_UPLOAD_TOPAZ_ASTRA_ORIGINAL_TOOL_NAME, SYNTX_OWNER_GENERATE_TOPAZ_ASTRA_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_TOPAZ_ASTRA_TOOL_NAME, SYNTX_OWNER_LIST_TOPAZ_ASTRA_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_GET_TOPAZ_ASTRA_RESULT_PAGE_TOOL_NAME] as const);

export interface OwnerTopazAstraServiceComposition {
  readonly generationService: OwnerTopazAstraGenerationService;
  readonly originalReferenceService: OwnerTopazAstraOriginalReferenceService;
}

export function registerSyntxOwnerTopazAstraTools(server: McpServer, optionsInput: unknown): void {
  const options = exactOptions(optionsInput);
  server.registerTool(SYNTX_GET_TOPAZ_ASTRA_PARAMETERS_TOOL_NAME, { title: "Get Topaz Astra parameters",
    description: "Reports the locally reviewed source controls and explicit uncertainty; it does not establish provider acceptance.",
    inputSchema: z.object({}).strict(), outputSchema: parametersOutput,
    annotations: { title: "Get Topaz Astra parameters", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async () => structured(parametersOutput, { status: "SOURCE_REVIEWED_STATIC_ONLY", models: OWNER_TOPAZ_ASTRA_MODEL_IDS.map((id) => {
    const p = getOwnerTopazAstraSourceProfile(id)!; return { model_id: id, resolution: [...p.controls.resolution.values],
      frame_rate: [...p.controls.frame_rate.values], slowmo: [...p.controls.slowmo.values], creativity: [...p.controls.creativity.values],
      maximum_bytes: p.input.max_file_size_bytes, maximum_duration_seconds: p.input.max_video_duration_seconds, backend_acceptance: "UNPROVEN" as const };
  }), runtime_usable: false, backend_acceptance: "UNPROVEN" }));
  server.registerTool(SYNTX_OWNER_UPLOAD_TOPAZ_ASTRA_ORIGINAL_TOOL_NAME, { title: "Upload owner Topaz Astra original",
    description: "Validates and uploads one bounded video for the exact linked owner attempt. If the upload outcome is uncertain, do not repeat it.",
    inputSchema: uploadInput, outputSchema: uploadOutput,
    annotations: { title: "Upload Topaz Astra original", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = uploadInput.safeParse(snapshot(input)); if (!parsed.success) return originalError("INVALID_REQUEST");
    const { data } = parsed; const padding = data.content_base64.endsWith("==") ? 2 : data.content_base64.endsWith("=") ? 1 : 0;
    const size = data.content_base64.length / 4 * 3 - padding;
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_BYTES) return originalError("INVALID_REQUEST");
    const bytes = Buffer.from(data.content_base64, "base64");
    try {
      if (bytes.length !== size) return originalError("INVALID_REQUEST");
      return structured(uploadOutput, await options.originalReferenceService.uploadOriginal({ attemptId: data.link_attempt_id,
        model_id: data.model_id, filename: data.filename, mime_type: data.mime_type, bytes }, signal));
    } catch (error) { return originalError(codeOriginal(error)); }
    finally { bytes.fill(0); }
  });
  server.registerTool(SYNTX_OWNER_GENERATE_TOPAZ_ASTRA_TOOL_NAME, { title: "Generate Topaz Astra video",
    description: "Starts one guarded owner generation. An unknown outcome includes a recovery handle; reconcile it and do not retry.",
    inputSchema: generateInput, outputSchema: resultSchema,
    annotations: { title: "Generate Topaz Astra video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    const p = generateInput.safeParse(snapshot(input)); if (!p.success) return generationError("INVALID_REQUEST");
    try { return structured(resultSchema, await options.generationService.generate({ attemptId: p.data.link_attempt_id,
      request: { model_id: p.data.model_id, topaz_original_handle: p.data.topaz_original_handle,
        ...(p.data.prompt === undefined ? {} : { prompt: p.data.prompt }), parameters: p.data.parameters } }, signal)); }
    catch (error) { return generationError(codeGeneration(error), error); }
  });
  server.registerTool(SYNTX_OWNER_RECONCILE_TOPAZ_ASTRA_TOOL_NAME, { title: "Reconcile Topaz Astra generation",
    description: "GET-only reconciliation for one recovery handle. It never starts or repeats generation.", inputSchema: reconcileInput,
    outputSchema: resultSchema, annotations: { title: "Reconcile Topaz Astra generation", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }) => { const p = reconcileInput.safeParse(snapshot(input)); if (!p.success) return generationError("INVALID_REQUEST");
    try { return structured(resultSchema, await options.generationService.reconcile({ attemptId: p.data.link_attempt_id, recovery_id: p.data.recovery_id }, signal)); }
    catch (error) { return generationError(codeGeneration(error), error); } });
  server.registerTool(SYNTX_OWNER_LIST_TOPAZ_ASTRA_RECOVERIES_TOOL_NAME, { title: "List Topaz Astra recoveries",
    description: "Lists bounded local recovery summaries without source or result URLs.", inputSchema: listInput, outputSchema: recoveryList,
    annotations: { title: "List Topaz Astra recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => { const p = listInput.safeParse(snapshot(input)); if (!p.success) return generationError("INVALID_REQUEST");
    try { return structured(recoveryList, { recoveries: await options.generationService.listRecoveries({ attemptId: p.data.link_attempt_id,
      ...(p.data.limit === undefined ? {} : { limit: p.data.limit }) }) }); } catch (error) { return generationError(codeGeneration(error), error); } });
  server.registerTool(SYNTX_OWNER_GET_TOPAZ_ASTRA_RESULT_PAGE_TOOL_NAME, { title: "Get Topaz Astra result page",
    description: "Reads a page from the locally observed result cache; it does not imply provider acceptance or terminal status.", inputSchema: pageInput,
    outputSchema: resultSchema, annotations: { title: "Get Topaz Astra result page", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => { const p = pageInput.safeParse(snapshot(input)); if (!p.success) return generationError("INVALID_REQUEST");
    try { return structured(resultSchema, await options.generationService.getResultPage({ attemptId: p.data.link_attempt_id,
      recovery_id: p.data.recovery_id, ...(p.data.offset === undefined ? {} : { offset: p.data.offset }) })); }
    catch (error) { return generationError(codeGeneration(error), error); } });
}

const GEN_MESSAGES: Record<OwnerTopazAstraGenerationServiceErrorCode, string> = {
  INVALID_REQUEST: "The Topaz Astra request is invalid.", SERVICE_CLOSED: "The Topaz Astra service is closed.", SERVICE_BUSY: "The Topaz Astra service is busy.",
  PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.", MODEL_BINDING_MISMATCH: "The selected Topaz Astra model is unavailable.",
  PREFLIGHT_FAILED: "Current account or model access could not be verified.", INTENT_ALREADY_CLAIMED: "This Topaz Astra intent has an unresolved outcome.",
  PRE_DISPATCH_FAILED: "The request was not safely dispatched.", OUTCOME_UNKNOWN: "The request may have been dispatched; reconcile its recovery and do not retry.",
  RECOVERY_NOT_FOUND: "The recovery is unavailable or expired."
};
const ORIG_MESSAGES: Record<OwnerTopazAstraOriginalReferenceServiceErrorCode, string> = {
  INVALID_REQUEST: "The Topaz Astra original upload request is invalid.", PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.",
  REQUEST_ABORTED: "The Topaz Astra original upload was cancelled.", SERVICE_BUSY: "The Topaz Astra original service is busy.",
  CAPACITY_EXCEEDED: "The Topaz Astra original service is full.", SERVICE_CLOSED: "The Topaz Astra original service is closed.",
  PROBE_REJECTED: "The video source was not accepted.", UPLOAD_REJECTED: "The upload was rejected.",
  UPLOAD_OUTCOME_UNKNOWN: "The upload outcome is unknown; do not repeat it.", REFERENCE_UNAVAILABLE: "The uploaded original is unavailable.",
  REFERENCE_EXPIRED: "The uploaded original has expired."
};
function exactOptions(v: unknown): OwnerTopazAstraServiceComposition {
  if (!v || typeof v !== "object" || types.isProxy(v) || Object.getPrototypeOf(v) !== Object.prototype) throw new Error("TOPAZ_ASTRA_SERVICE_COMPOSITION_INVALID");
  const d = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(d);
  if (keys.length !== 2 || keys.some((k) => { const descriptor = Object.getOwnPropertyDescriptor(v, k); return typeof k !== "string" || !["generationService", "originalReferenceService"].includes(k) ||
    !descriptor || !("value" in descriptor) || !descriptor.enumerable; }) ||
      !isOwnerTopazAstraGenerationService(d.generationService?.value) || !isOriginal(d.originalReferenceService?.value)) throw new Error("TOPAZ_ASTRA_SERVICE_COMPOSITION_INVALID");
  return Object.freeze({ generationService: d.generationService!.value as OwnerTopazAstraGenerationService,
    originalReferenceService: d.originalReferenceService!.value as OwnerTopazAstraOriginalReferenceService });
}
function isOriginal(v: unknown): v is OwnerTopazAstraOriginalReferenceService { return !!v && typeof v === "object" && !types.isProxy(v) &&
  v instanceof OwnerTopazAstraOriginalReferenceService && Object.getPrototypeOf(v) === OwnerTopazAstraOriginalReferenceService.prototype && Object.isFrozen(v); }
function codeOriginal(e: unknown): OwnerTopazAstraOriginalReferenceServiceErrorCode { return e instanceof OwnerTopazAstraOriginalReferenceServiceError && Object.hasOwn(ORIG_MESSAGES, e.code) ? e.code : "PROBE_REJECTED"; }
function codeGeneration(e: unknown): OwnerTopazAstraGenerationServiceErrorCode { return e instanceof OwnerTopazAstraGenerationServiceError && Object.hasOwn(GEN_MESSAGES, e.code) ? e.code : "PRE_DISPATCH_FAILED"; }
function originalError(code: OwnerTopazAstraOriginalReferenceServiceErrorCode): CallToolResult { return errorResult(code, ORIG_MESSAGES[code]); }
function generationError(code: OwnerTopazAstraGenerationServiceErrorCode, e?: unknown): CallToolResult {
  const known = e instanceof OwnerTopazAstraGenerationServiceError ? e : undefined;
  return errorResult(code, GEN_MESSAGES[code], code === "OUTCOME_UNKNOWN" && known?.recovery_id ? { recovery_id: known.recovery_id, ...(known.diagnostic ? { diagnostic: known.diagnostic } : {}) } : {});
}
function errorResult(code: string, message: string, extra: Record<string, unknown> = {}): CallToolResult { return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message, ...extra } }) }] }; }
function structured<T>(schema: z.ZodType<T>, value: unknown): CallToolResult { const p = schema.safeParse(snapshot(value)); if (!p.success) return errorResult("OUTPUT_INVALID", "The service returned an invalid response.");
  return { content: [{ type: "text", text: JSON.stringify(p.data) }], structuredContent: p.data as Record<string, unknown> }; }
function snapshot(v: unknown): unknown { try { return walk(v, 0, { n: 0 }); } catch { return undefined; } }
function walk(v: unknown, depth: number, b: { n: number }): unknown { b.n++; if (b.n > 50_000 || depth > 32) throw new Error();
  if (v === null || typeof v === "string" || typeof v === "boolean") return v; if (typeof v === "number") { if (!Number.isFinite(v)) throw new Error(); return v; }
  if (!v || typeof v !== "object" || types.isProxy(v) || (Array.isArray(v) && Object.getPrototypeOf(v) !== Array.prototype) || (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype)) throw new Error();
  const ds = Object.getOwnPropertyDescriptors(v), out: Record<string, unknown> | unknown[] = Array.isArray(v) ? [] : {};
  for (const k of Reflect.ownKeys(ds)) { const d = Object.getOwnPropertyDescriptor(v, k); if (typeof k !== "string" || !d || !("value" in d)) throw new Error();
    if (Array.isArray(out)) { if (k === "length") { if (d.enumerable || d.value !== (v as unknown[]).length) throw new Error(); continue; }
      if (!d.enumerable || !/^(?:0|[1-9]\d*)$/u.test(k)) throw new Error(); out[Number(k)] = walk(d.value, depth + 1, b); }
    else if (!d.enumerable) throw new Error();
    else Object.defineProperty(out, k, { value: walk(d.value, depth + 1, b), enumerable: true, writable: true, configurable: true }); }
  return out;
}
