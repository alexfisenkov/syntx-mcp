import { types } from "node:util";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import {
  OwnerGrokV2vGenerationService,
  OwnerGrokV2vGenerationServiceError,
  isOwnerGrokV2vGenerationService,
  type OwnerGrokV2vGenerationServiceErrorCode,
  type OwnerGrokV2vRecoveryListItem
} from "../application/owner-grok-v2v-generation-service.js";
import {
  OwnerGrokV2vOriginalReferenceService,
  OwnerGrokV2vOriginalReferenceServiceError,
  isOwnerGrokV2vOriginalReferenceService,
  type OwnerGrokV2vOriginalReferenceServiceErrorCode
} from "../application/owner-grok-v2v-original-reference-service.js";
import { getOwnerGrokV2vSourceProfile, OWNER_GROK_V2V_MODEL_ID } from "../application/owner-grok-v2v-source-profile.js";

const MODEL_ID = OWNER_GROK_V2V_MODEL_ID;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_BASE64_LENGTH = Math.ceil(MAX_VIDEO_BYTES / 3) * 4;
const MAX_RESULTS = 4_096;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^grok_v2v_reference_[0-9a-f-]{36}$/u;
const RECOVERY = /^grok_v2v_recovery_[0-9a-f-]{36}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const attempt = z.string().regex(ATTEMPT);
const handle = z.string().regex(HANDLE);
const recoveryId = z.string().regex(RECOVERY);
const filename = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._ -]*$/u);
const videoMime = z.enum(["video/mp4", "video/quicktime"]);
const base64 = z.string().min(4).max(MAX_BASE64_LENGTH)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);
const prompt = z.string().max(2_000).refine((value) => value.trim().length > 0 && isWellFormedUnicode(value));
const profilePins = z.object({
  public_catalog_version: z.literal("sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json"),
  public_models_sha256: z.literal("sha256:92c31dba26eb9c0ccf68cdf92a105e6e808c92b187286e4fb366debe051982e1"),
  source_build_id: z.literal("1792133067"),
  modules: z.object({
    grok_form: z.literal("sha256:cc36221a4c696fb91b43166558800e2b1df18e49dcb3c06997b7cfeafb3c5159"),
    file_uploader: z.literal("sha256:45f3174473d1ae4c9e57fbee47c7bf0c7e75773e9f3b36dbb8c3e5cc7ec3863a"),
    chat_input: z.literal("sha256:4b6139e2115b651af482800684f569f27dfa46e9154486814d1a8d376701a464"),
    app: z.literal("sha256:5488b33ac6de23e559932a485c7cf2f7d034151f3d735005dfb0a334ee21a175"),
    duration_enricher: z.literal("sha256:09611977302662f75f1076cefed631360c1734ba07f7795fe289f562dee49ba6"),
    duration_reader: z.literal("sha256:13d991c46f54bdfc9f0dad43ae792580a21a5754a5de1d42900c81e3134c7d6b"),
    video_sender: z.literal("sha256:3dbb36e710d6e35ae9babef856678af06cb5d2352beb7a67aa60d47cd6ffc49b")
  }).strict()
}).strict();

const sourceProfileOutput = z.object({
  profile_id: z.literal("owner-grok-v2v-static-source-profile-2057"),
  status: z.literal("SOURCE_REVIEWED_STATIC_ONLY"),
  model_id: z.literal(MODEL_ID),
  ai_name: z.literal("grok_video"),
  source_pins: profilePins,
  input: z.object({
    role: z.literal("video"), file_count_limit: z.literal(1),
    accepted_file_types: z.tuple([z.literal("video/mp4"), z.literal("video/quicktime")]),
    max_file_size_bytes: z.literal(MAX_VIDEO_BYTES),
    total_duration_seconds: z.object({ minimum: z.literal(1), maximum: z.literal(8.7) }).strict(),
    bounds_source: z.literal("PUBLIC_CATALOG_METADATA_NOT_UPLOAD_OR_DECODER_AUTHORITY")
  }).strict(),
  prompt: z.object({ max_length_utf16: z.literal(2_000), source: z.literal("PUBLIC_CATALOG_MAX_PROMPT_LENGTH") }).strict(),
  settings_projection: z.object({
    model_type: z.literal(MODEL_ID),
    aspect_ratio: z.null(),
    video_duration: z.object({
      input: z.literal("TRUSTED_MEASURED_SOURCE_DURATION_REQUIRED"),
      normalization: z.literal("Number(Number(duration_seconds).toFixed(2))"),
      effective_default: z.literal("UNKNOWN")
    }).strict(),
    resolution: z.object({
      input: z.literal("TRUSTED_MEASURED_SOURCE_DIMENSIONS_REQUIRED"),
      threshold_pixels_inclusive: z.literal(409_920),
      at_or_above: z.literal("720p"), below: z.literal("480p"), effective_default: z.literal("UNKNOWN")
    }).strict(),
    user_controls_for_resolution_or_duration: z.literal(false)
  }).strict(),
  cost_projection: z.object({
    keys: z.tuple([z.literal("video_duration"), z.literal("resolution")]),
    evidence: z.literal("PUBLIC_CATALOG_KEYS_ONLY_NOT_QUOTE_OR_BILLING_PROOF"),
    amount: z.literal("UNPROVEN")
  }).strict(),
  effective_defaults: z.literal("UNKNOWN"),
  runtime_usable: z.literal(false),
  dispatch_allowed: z.literal(false),
  backend_acceptance: z.literal("UNPROVEN")
}).strict();

const getterInput = z.object({ model_id: z.literal(MODEL_ID) }).strict();
const uploadInput = z.object({
  link_attempt_id: attempt,
  model_id: z.literal(MODEL_ID),
  filename,
  mime_type: videoMime,
  content_base64: base64
}).strict();
const generateInput = z.object({
  link_attempt_id: attempt,
  model_id: z.literal(MODEL_ID),
  prompt,
  grok_reference_handle: handle
}).strict();
const reconcileInput = z.object({ link_attempt_id: attempt, recovery_id: recoveryId }).strict();
const listInput = z.object({ link_attempt_id: attempt, limit: z.number().int().min(1).max(128).optional() }).strict();
const pageInput = z.object({
  link_attempt_id: attempt,
  recovery_id: recoveryId,
  offset: z.number().int().min(0).max(MAX_RESULTS).optional()
}).strict();

const parametersOutput = z.object({
  status: z.literal("SOURCE_REVIEWED_STATIC_ONLY"),
  model_id: z.literal(MODEL_ID),
  source_pins: profilePins,
  profile: sourceProfileOutput,
  runtime_usable: z.literal(false),
  dispatch_allowed: z.literal(false),
  backend_acceptance: z.literal("UNPROVEN")
}).strict();
const uploadOutput = z.object({
  status: z.literal("uploaded"),
  grok_reference_handle: handle,
  model_id: z.literal(MODEL_ID),
  mime_type: videoMime,
  size: z.number().int().min(1).max(MAX_VIDEO_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  duration_seconds: z.number().positive(),
  input_confidence: z.literal("LOCAL_FFPROBE_METADATA_ONLY_NO_DECODE"),
  expires_in_seconds: z.number().int().min(0).max(900)
}).strict();

const diagnostic = z.object({
  phase: z.enum(["VALIDATE_REQUEST", "PREFLIGHT_ONE", "CHAT_CREATE", "PREFLIGHT_TWO", "GENERATION_POST", "POST_ACK_KNOWN", "HISTORY_GET", "RESULT_GET"]),
  post_started: z.boolean(),
  ack_known: z.boolean(),
  history_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "INCOMPLETE", "UNVERIFIED"]),
  owner_ack_status: z.enum(["NOT_READ", "MATCHED", "MISSING", "AMBIGUOUS", "MISMATCH"]),
  request_echo_status: z.enum(["NOT_READ", "MATCHED", "ABSENT", "PARTIAL_UNPROVEN", "CONTRADICTORY"]),
  history_get_calls: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  result_get_calls: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  result_status: z.enum(["NOT_READ", "COMPLETE", "UNVERIFIED"]),
  gaps: z.array(z.string().max(128)).max(32)
}).strict();
const recoveryItem = z.object({
  recovery_id: recoveryId,
  created_at: z.iso.datetime(),
  model_id: z.literal(MODEL_ID),
  status: z.enum(["outcome_unknown", "completed"]),
  observed_artifact_count: z.number().int().min(0).max(MAX_RESULTS),
  diagnostic
}).strict();
const recoveryList = z.object({ recoveries: z.array(recoveryItem).max(128) }).strict();
const resultSchema = z.object({
  status: z.literal("completed"),
  status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"),
  backend_acceptance: z.literal("UNPROVEN"),
  provider_terminal_status: z.literal("UNPROVEN"),
  cost_cap_enforced: z.literal(false),
  output_count: z.literal("UNKNOWN"),
  recovery_id: recoveryId,
  model_id: z.literal(MODEL_ID),
  source_binding: z.object({
    public_catalog_version: z.string().regex(/^sha256-[a-f0-9]{64}\.json$/u),
    profile_schema_hash: z.string().regex(SHA256),
    request_fingerprint: z.string().regex(SHA256),
    intent_fingerprint: z.string().regex(SHA256)
  }).strict(),
  observed_artifact_count: z.number().int().min(0).max(MAX_RESULTS),
  offset: z.number().int().min(0).max(MAX_RESULTS),
  page_size: z.literal(64),
  artifacts: z.array(z.object({
    object_index: z.number().int().nonnegative(),
    message_object_id: z.string().min(1).max(160),
    object_type: z.literal("video"),
    object_url: z.string().url().max(4096).refine(isSafeUploadReferenceUrl),
    mime_type: z.union([z.literal("video/mp4"), z.literal("video/quicktime"), z.null()]),
    mime_source: z.enum(["URL_EXTENSION", "UNKNOWN"]),
    message_id: z.string().min(1).max(160),
    chat_uuid: z.string().min(1).max(160),
    model_id: z.literal(MODEL_ID)
  }).strict()).max(64),
  has_more: z.boolean(),
  next_offset: z.number().int().min(0).max(MAX_RESULTS).nullable(),
  diagnostic
}).strict();

export const SYNTX_GET_GROK_V2V_PARAMETERS_TOOL_NAME = "syntx_get_grok_v2v_parameters" as const;
export const SYNTX_OWNER_UPLOAD_GROK_V2V_REFERENCE_TOOL_NAME = "syntx_owner_upload_grok_v2v_reference" as const;
export const SYNTX_OWNER_GENERATE_GROK_V2V_TOOL_NAME = "syntx_owner_generate_grok_v2v" as const;
export const SYNTX_OWNER_RECONCILE_GROK_V2V_TOOL_NAME = "syntx_owner_reconcile_grok_v2v" as const;
export const SYNTX_OWNER_LIST_GROK_V2V_RECOVERIES_TOOL_NAME = "syntx_owner_list_grok_v2v_recoveries" as const;
export const SYNTX_OWNER_GET_GROK_V2V_RESULT_PAGE_TOOL_NAME = "syntx_owner_get_grok_v2v_result_page" as const;
export const OWNER_GROK_V2V_TOOL_NAMES = Object.freeze([
  SYNTX_GET_GROK_V2V_PARAMETERS_TOOL_NAME,
  SYNTX_OWNER_UPLOAD_GROK_V2V_REFERENCE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_GROK_V2V_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_GROK_V2V_TOOL_NAME,
  SYNTX_OWNER_LIST_GROK_V2V_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_GET_GROK_V2V_RESULT_PAGE_TOOL_NAME
] as const);

export interface OwnerGrokV2vServiceComposition {
  readonly referenceService: OwnerGrokV2vOriginalReferenceService;
  readonly generationService: OwnerGrokV2vGenerationService;
}

export function registerSyntxOwnerGrokV2vTools(server: McpServer, optionsInput: unknown): void {
  const options = exactOptions(optionsInput);
  server.registerTool(SYNTX_GET_GROK_V2V_PARAMETERS_TOOL_NAME, {
    title: "Get Grok V2V parameters",
    description: "Returns the source-reviewed Grok V2V input bounds and input-derived settings. Defaults, quote amount, and provider acceptance remain unknown; this does not read account state or dispatch.",
    inputSchema: getterInput,
    outputSchema: parametersOutput,
    annotations: { title: "Get Grok V2V parameters", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    const parsed = getterInput.safeParse(snapshot(input));
    if (!parsed.success) return errorResult("INVALID_REQUEST", "The Grok V2V model ID is invalid.");
    const profile = getOwnerGrokV2vSourceProfile(MODEL_ID);
    if (!profile) return errorResult("OUTPUT_INVALID", "The source-reviewed Grok V2V profile is unavailable.");
    return structured(parametersOutput, {
      status: "SOURCE_REVIEWED_STATIC_ONLY",
      model_id: MODEL_ID,
      source_pins: profile.source_pins,
      profile,
      runtime_usable: false,
      dispatch_allowed: false,
      backend_acceptance: "UNPROVEN"
    });
  });

  server.registerTool(SYNTX_OWNER_UPLOAD_GROK_V2V_REFERENCE_TOOL_NAME, {
    title: "Upload owner Grok V2V reference",
    description: "Probes and uploads one owner-provided MP4 or QuickTime source for the linked attempt. Do not repeat an upload with an uncertain outcome.",
    inputSchema: uploadInput,
    outputSchema: uploadOutput,
    annotations: { title: "Upload Grok V2V reference", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = uploadInput.safeParse(snapshot(input));
    if (!parsed.success) return referenceError("INVALID_REQUEST");
    const data = parsed.data;
    if (!filenameMatchesMime(data.filename, data.mime_type)) return referenceError("INVALID_REQUEST");
    const padding = data.content_base64.endsWith("==") ? 2 : data.content_base64.endsWith("=") ? 1 : 0;
    const decodedSize = data.content_base64.length / 4 * 3 - padding;
    if (!Number.isSafeInteger(decodedSize) || decodedSize < 16 || decodedSize > MAX_VIDEO_BYTES) return referenceError("INVALID_REQUEST");
    const bytes = Buffer.from(data.content_base64, "base64");
    try {
      if (bytes.length !== decodedSize || bytes.toString("base64") !== data.content_base64) return referenceError("INVALID_REQUEST");
      const receipt = await options.referenceService.uploadReference({
        attemptId: data.link_attempt_id,
        model_id: data.model_id,
        filename: data.filename,
        mime_type: data.mime_type,
        bytes
      }, signal);
      return structured(uploadOutput, receipt);
    } catch (error) { return referenceError(codeReference(error)); }
    finally { bytes.fill(0); }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_GROK_V2V_TOOL_NAME, {
    title: "Generate owner Grok V2V video",
    description: "Runs one owner-bound Grok V2V request using an opaque uploaded reference. Duration and resolution are measured locally, not caller controls. If outcome is unknown, reconcile; never retry generation.",
    inputSchema: generateInput,
    outputSchema: resultSchema,
    annotations: { title: "Generate Grok V2V video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = generateInput.safeParse(snapshot(input));
    if (!parsed.success) return generationError("INVALID_REQUEST");
    try {
      const { link_attempt_id, ...request } = parsed.data;
      return structured(resultSchema, await options.generationService.generate({ attemptId: link_attempt_id, request }, signal));
    } catch (error) { return generationError(codeGeneration(error), error); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_GROK_V2V_TOOL_NAME, {
    title: "Reconcile Grok V2V generation",
    description: "GET-only reconciliation for the same linked attempt and opaque recovery ID; it never starts or retries generation.",
    inputSchema: reconcileInput,
    outputSchema: resultSchema,
    annotations: { title: "Reconcile Grok V2V generation", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = reconcileInput.safeParse(snapshot(input));
    if (!parsed.success) return generationError("INVALID_REQUEST");
    try {
      return structured(resultSchema, await options.generationService.reconcile({
        attemptId: parsed.data.link_attempt_id, recovery_id: parsed.data.recovery_id
      }, signal));
    } catch (error) { return generationError(codeGeneration(error), error); }
  });

  server.registerTool(SYNTX_OWNER_LIST_GROK_V2V_RECOVERIES_TOOL_NAME, {
    title: "List Grok V2V recoveries",
    description: "Lists bounded process-local Grok V2V recovery summaries for the linked owner attempt. The list contains no input or result URLs.",
    inputSchema: listInput,
    outputSchema: recoveryList,
    annotations: { title: "List Grok V2V recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    const parsed = listInput.safeParse(snapshot(input));
    if (!parsed.success) return generationError("INVALID_REQUEST");
    try {
      const items: readonly OwnerGrokV2vRecoveryListItem[] = await options.generationService.listRecoveries({
        attemptId: parsed.data.link_attempt_id,
        ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit })
      });
      return structured(recoveryList, { recoveries: items });
    } catch (error) { return generationError(codeGeneration(error), error); }
  });

  server.registerTool(SYNTX_OWNER_GET_GROK_V2V_RESULT_PAGE_TOOL_NAME, {
    title: "Get Grok V2V result page",
    description: "Reads a bounded page of locally observed Grok V2V results from the same owner recovery. Provider terminal status remains unproven.",
    inputSchema: pageInput,
    outputSchema: resultSchema,
    annotations: { title: "Get Grok V2V result page", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    const parsed = pageInput.safeParse(snapshot(input));
    if (!parsed.success) return generationError("INVALID_REQUEST");
    try {
      return structured(resultSchema, await options.generationService.getResultPage({
        attemptId: parsed.data.link_attempt_id,
        recovery_id: parsed.data.recovery_id,
        ...(parsed.data.offset === undefined ? {} : { offset: parsed.data.offset })
      }));
    } catch (error) { return generationError(codeGeneration(error), error); }
  });
}

const REFERENCE_MESSAGES: Record<OwnerGrokV2vOriginalReferenceServiceErrorCode, string> = {
  INVALID_REQUEST: "The Grok V2V reference request is invalid.",
  PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.",
  REQUEST_ABORTED: "The Grok V2V upload was cancelled.",
  SERVICE_BUSY: "The Grok V2V reference service is busy.",
  CAPACITY_EXCEEDED: "The Grok V2V reference service is full.",
  SERVICE_CLOSED: "The Grok V2V reference service is closed.",
  PROBE_REJECTED: "The original was not accepted by the local media inspector.",
  UPLOAD_REJECTED: "The Grok V2V reference upload was rejected.",
  UPLOAD_OUTCOME_UNKNOWN: "The upload outcome is unknown; do not repeat it.",
  REFERENCE_UNAVAILABLE: "The Grok V2V reference is unavailable.",
  REFERENCE_EXPIRED: "The Grok V2V reference has expired."
};

const GENERATION_MESSAGES: Record<OwnerGrokV2vGenerationServiceErrorCode, string> = {
  INVALID_REQUEST: "The Grok V2V request is invalid.",
  SERVICE_CLOSED: "The Grok V2V service is closed.",
  SERVICE_BUSY: "The Grok V2V service is busy.",
  PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.",
  MODEL_BINDING_MISMATCH: "The Grok V2V model binding is unavailable.",
  PREFLIGHT_FAILED: "Current account, model access, or quote could not be verified.",
  INTENT_ALREADY_CLAIMED: "This Grok V2V intent has an unresolved outcome.",
  PRE_DISPATCH_FAILED: "The request was not safely dispatched.",
  OUTCOME_UNKNOWN: "The request may have been dispatched; reconcile its recovery and do not retry.",
  RECOVERY_NOT_FOUND: "The recovery is unavailable or expired."
};

function exactOptions(value: unknown): OwnerGrokV2vServiceComposition {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("INVALID_GROK_V2V_SERVICE_COMPOSITION");
  }
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { throw new Error("INVALID_GROK_V2V_SERVICE_COMPOSITION"); }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== 2 || keys.some((key) => typeof key !== "string" || !["generationService", "referenceService"].includes(key) ||
      !descriptors[key]!.enumerable || !("value" in descriptors[key]!)) ||
      !descriptors.generationService || !isOwnerGrokV2vGenerationService(descriptors.generationService.value) ||
      !descriptors.referenceService || !isOwnerGrokV2vOriginalReferenceService(descriptors.referenceService.value)) {
    throw new Error("INVALID_GROK_V2V_SERVICE_COMPOSITION");
  }
  return Object.freeze({
    generationService: descriptors.generationService.value as OwnerGrokV2vGenerationService,
    referenceService: descriptors.referenceService.value as OwnerGrokV2vOriginalReferenceService
  });
}

function filenameMatchesMime(name: string, mime: "video/mp4" | "video/quicktime"): boolean {
  return mime === "video/mp4" ? /\.mp4$/iu.test(name) : /\.mov$/iu.test(name);
}

function codeReference(error: unknown): OwnerGrokV2vOriginalReferenceServiceErrorCode {
  return error instanceof OwnerGrokV2vOriginalReferenceServiceError && Object.hasOwn(REFERENCE_MESSAGES, error.code)
    ? error.code : "PROBE_REJECTED";
}

function codeGeneration(error: unknown): OwnerGrokV2vGenerationServiceErrorCode {
  return error instanceof OwnerGrokV2vGenerationServiceError && Object.hasOwn(GENERATION_MESSAGES, error.code)
    ? error.code : "PRE_DISPATCH_FAILED";
}

function referenceError(code: OwnerGrokV2vOriginalReferenceServiceErrorCode): CallToolResult {
  return errorResult(code, REFERENCE_MESSAGES[code]);
}

function generationError(code: OwnerGrokV2vGenerationServiceErrorCode, error?: unknown): CallToolResult {
  const known = error instanceof OwnerGrokV2vGenerationServiceError ? error : undefined;
  const parsedDiagnostic = known?.diagnostic === undefined ? undefined : diagnostic.safeParse(snapshot(known.diagnostic));
  const extra = code === "OUTCOME_UNKNOWN" && known?.recovery_id ? {
    recovery_id: known.recovery_id,
    ...(parsedDiagnostic?.success ? { diagnostic: parsedDiagnostic.data } : {})
  } : {};
  return errorResult(code, GENERATION_MESSAGES[code], extra);
}

function errorResult(code: string, message: string, extra: Record<string, unknown> = {}): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message, ...extra } }) }] };
}

function structured<T>(schema: z.ZodType<T>, value: unknown): CallToolResult {
  const parsed = schema.safeParse(snapshot(value));
  if (!parsed.success) return errorResult("OUTPUT_INVALID", "The Grok V2V service returned an invalid response.");
  return { content: [{ type: "text", text: JSON.stringify(parsed.data) }], structuredContent: parsed.data as Record<string, unknown> };
}

function snapshot(value: unknown): unknown {
  try { return walk(value, 0, { nodes: 0 }); } catch { return undefined; }
}

function walk(value: unknown, depth: number, budget: { nodes: number }): unknown {
  budget.nodes += 1;
  if (budget.nodes > 50_000 || depth > 32) throw new Error("TOOL_SNAPSHOT_LIMIT");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error("TOOL_SNAPSHOT_INVALID"); return value; }
  if (!value || typeof value !== "object" || types.isProxy(value) ||
      (Array.isArray(value) && Object.getPrototypeOf(value) !== Array.prototype) ||
      (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)) throw new Error("TOOL_SNAPSHOT_INVALID");
  const descriptors = Object.getOwnPropertyDescriptors(value), output: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !descriptor || !("value" in descriptor)) throw new Error("TOOL_SNAPSHOT_INVALID");
    if (Array.isArray(output)) {
      if (key === "length") { if (descriptor.enumerable || descriptor.value !== (value as unknown[]).length) throw new Error("TOOL_SNAPSHOT_INVALID"); continue; }
      if (!descriptor.enumerable || !/^(?:0|[1-9]\d*)$/u.test(key)) throw new Error("TOOL_SNAPSHOT_INVALID");
      output[Number(key)] = walk(descriptor.value, depth + 1, budget);
    } else {
      if (!descriptor.enumerable) throw new Error("TOOL_SNAPSHOT_INVALID");
      Object.defineProperty(output, key, { value: walk(descriptor.value, depth + 1, budget), enumerable: true, writable: true, configurable: true });
    }
  }
  return output;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
