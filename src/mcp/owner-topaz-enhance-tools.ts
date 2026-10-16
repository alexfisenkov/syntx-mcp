import { types } from "node:util";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  OwnerTopazEnhanceGenerationService,
  OwnerTopazEnhanceGenerationServiceError,
  isOwnerTopazEnhanceGenerationService,
  type OwnerTopazEnhanceGenerationServiceErrorCode,
  type OwnerTopazEnhanceRecoveryListItem
} from "../application/owner-topaz-enhance-generation-service.js";
import {
  OwnerTopazEnhanceOriginalReferenceService,
  OwnerTopazEnhanceOriginalReferenceServiceError,
  type OwnerTopazEnhanceOriginalReferenceServiceErrorCode
} from "../application/owner-topaz-enhance-original-reference-service.js";
import { OWNER_TOPAZ_ENHANCE_MODEL_ID, getOwnerTopazEnhanceSourceProfile } from "../application/owner-topaz-enhance-source-profile.js";
import { OwnerTopazEnhanceParameterValues } from "../application/owner-topaz-enhance-parameters.js";

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_BASE64 = Math.ceil(MAX_BYTES / 3) * 4;
const MAX_RESULTS = 4096;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^topaz_enhance_original_[0-9a-f-]{36}$/u;
const RECOVERY = /^topaz_enhance_recovery_[0-9a-f-]{36}$/u;
const attempt = z.string().regex(ATTEMPT);
const handle = z.string().regex(HANDLE);
const recoveryId = z.string().regex(RECOVERY);

const uploadInput = z.object({
  link_attempt_id: attempt,
  filename: z.string().min(1).max(255).regex(/^[^\u0000-\u001f\\/:*?"<>|]+\.mp4$/iu),
  content_base64: z.string().min(4).max(MAX_BASE64)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u)
}).strict();

const parametersInput = z.object({
  blur: z.number().int().min(-100).max(100),
  halo: z.number().int().min(-100).max(100),
  focus: z.enum(["off", "normal", "strong"]),
  grain: z.enum(["off", "on"]),
  model: z.enum(["ghq-5", "rhea-1", "prob-4", "iris-3", "gcg-5"]),
  noise: z.number().int().min(-100).max(100),
  details: z.number().int().min(-100).max(100),
  preblur: z.number().int().min(-100).max(100),
  upscale: z.union([z.literal(1), z.literal(2), z.literal(4)]),
  prenoise: z.number().int().min(0).max(100),
  compression: z.number().int().min(-100).max(100),
  interpolation: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(45), z.literal(50), z.literal(60)])
}).strict();

const generateInput = z.object({
  link_attempt_id: attempt,
  model_id: z.literal(OWNER_TOPAZ_ENHANCE_MODEL_ID),
  topaz_original_handle: handle,
  parameters: parametersInput
}).strict();
const reconcileInput = z.object({ link_attempt_id: attempt, recovery_id: recoveryId }).strict();
const listInput = z.object({ link_attempt_id: attempt, limit: z.number().int().min(1).max(128).optional() }).strict();
const pageInput = z.object({ link_attempt_id: attempt, recovery_id: recoveryId, offset: z.number().int().min(0).max(MAX_RESULTS).optional() }).strict();

const diagnostic = z.object({
  phase: z.enum(["VALIDATE_REQUEST", "PREFLIGHT_ONE", "CHAT_CREATE", "PREFLIGHT_TWO", "GENERATION_POST", "POST_ACK_KNOWN", "HISTORY_GET", "RESULT_GET"]),
  post_started: z.boolean(),
  ack_known: z.boolean(),
  history_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "INCOMPLETE", "UNVERIFIED"]),
  owner_ack_status: z.enum(["NOT_READ", "MATCHED", "MISSING", "AMBIGUOUS", "MISMATCH"]),
  history_get_calls: z.number().int().min(0).max(255),
  result_get_calls: z.number().int().min(0).max(255),
  result_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "UNVERIFIED"]),
  gaps: z.array(z.string().max(128)).max(32)
}).strict();
const recoveryItem = z.object({
  recovery_id: recoveryId,
  created_at: z.iso.datetime(),
  model_id: z.literal(OWNER_TOPAZ_ENHANCE_MODEL_ID),
  status: z.enum(["outcome_unknown", "completed"]),
  observed_artifact_count: z.number().int().min(0).max(MAX_RESULTS),
  diagnostic
}).strict();
const recoveryList = z.object({ recoveries: z.array(recoveryItem).max(128) }).strict();
const profilePins = z.object({
  public_catalog_version: z.string().regex(/^sha256-[a-f0-9]{64}\.json$/u),
  source_build_id: z.string().regex(/^\d{1,32}$/u),
  public_models_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  modules: z.record(z.string(), z.string().regex(/^sha256:[a-f0-9]{64}$/u))
}).strict();
const parametersOutput = z.object({
  status: z.literal("SOURCE_REVIEWED_STATIC_ONLY"),
  model_id: z.literal(OWNER_TOPAZ_ENHANCE_MODEL_ID),
  ai_name: z.literal("topaz_ai"),
  source_pins: profilePins,
  controls: z.object({
    model: z.array(z.string()).length(5),
    upscale: z.array(z.number()).length(3),
    interpolation: z.array(z.number()).length(6),
    numeric_ranges: z.object({
      prenoise: z.tuple([z.literal(0), z.literal(100)]),
      compression: z.tuple([z.literal(-100), z.literal(100)]),
      details: z.tuple([z.literal(-100), z.literal(100)]),
      blur: z.tuple([z.literal(-100), z.literal(100)]),
      noise: z.tuple([z.literal(-100), z.literal(100)]),
      halo: z.tuple([z.literal(-100), z.literal(100)]),
      preblur: z.tuple([z.literal(-100), z.literal(100)])
    }).strict(),
    focus: z.array(z.string()).length(3),
    grain: z.array(z.string()).length(2)
  }).strict(),
  catalog_default_model: z.literal("rhea-1"),
  form_fallback_model: z.literal("prob-4"),
  effective_defaults: z.literal("UNKNOWN"),
  conditional_combinations: z.literal("UNPROVEN"),
  public_accepted_mime_types: z.array(z.string()).length(3),
  local_supported_mime_types: z.tuple([z.literal("video/mp4")]),
  local_input_limitation: z.literal("MP4_ONLY_LOCAL_PROBE_PUBLIC_SOURCE_ALSO_LISTS_WEBM_QUICKTIME"),
  maximum_file_size_bytes: z.literal(MAX_BYTES),
  duration_seconds: z.tuple([z.literal(2), z.literal(26.25)]),
  runtime_usable: z.literal(false),
  backend_acceptance: z.literal("UNPROVEN"),
  dispatch_allowed: z.literal(false)
}).strict();
const uploadOutput = z.object({
  status: z.literal("uploaded"),
  topaz_original_handle: handle,
  model_id: z.literal(OWNER_TOPAZ_ENHANCE_MODEL_ID),
  mime_type: z.literal("video/mp4"),
  size: z.number().int().min(1).max(MAX_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  duration_seconds: z.number().min(2).max(26.25),
  frame_count: z.number().int().positive().max(10_000),
  expires_in_seconds: z.number().int().min(0).max(900)
}).strict();
const resultSchema = z.object({
  status: z.literal("completed"),
  status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"),
  backend_acceptance: z.literal("UNPROVEN"),
  provider_terminal_status: z.literal("UNPROVEN"),
  cost_cap_enforced: z.literal(false),
  recovery_id: recoveryId,
  model_id: z.literal(OWNER_TOPAZ_ENHANCE_MODEL_ID),
  source_binding: z.object({
    public_catalog_version: z.string(),
    profile_schema_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    request_fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    intent_fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u)
  }).strict(),
  observed_artifact_count: z.number().int().min(0).max(MAX_RESULTS),
  offset: z.number().int().min(0).max(MAX_RESULTS),
  page_size: z.literal(64),
  artifacts: z.array(z.object({
    object_index: z.number().int().nonnegative(),
    message_object_id: z.string().min(1).max(160),
    object_type: z.literal("video"),
    object_url: z.string().url().max(4096),
    mime_type: z.union([z.literal("video/mp4"), z.literal("video/quicktime"), z.null()]),
    mime_source: z.enum(["URL_EXTENSION", "UNKNOWN"]),
    message_id: z.string().min(1).max(160),
    chat_uuid: z.string().min(1).max(160),
    model_id: z.literal(OWNER_TOPAZ_ENHANCE_MODEL_ID)
  }).strict()).max(64),
  has_more: z.boolean(),
  next_offset: z.number().int().min(0).max(MAX_RESULTS).nullable(),
  diagnostic
}).strict();

export const SYNTX_GET_TOPAZ_ENHANCE_PARAMETERS_TOOL_NAME = "syntx_get_topaz_enhance_parameters" as const;
export const SYNTX_OWNER_UPLOAD_TOPAZ_ENHANCE_ORIGINAL_TOOL_NAME = "syntx_owner_upload_topaz_enhance_original" as const;
export const SYNTX_OWNER_GENERATE_TOPAZ_ENHANCE_TOOL_NAME = "syntx_owner_generate_topaz_enhance" as const;
export const SYNTX_OWNER_RECONCILE_TOPAZ_ENHANCE_TOOL_NAME = "syntx_owner_reconcile_topaz_enhance" as const;
export const SYNTX_OWNER_LIST_TOPAZ_ENHANCE_RECOVERIES_TOOL_NAME = "syntx_owner_list_topaz_enhance_recoveries" as const;
export const SYNTX_OWNER_GET_TOPAZ_ENHANCE_RESULT_PAGE_TOOL_NAME = "syntx_owner_get_topaz_enhance_result_page" as const;
export const OWNER_TOPAZ_ENHANCE_TOOL_NAMES = Object.freeze([
  SYNTX_GET_TOPAZ_ENHANCE_PARAMETERS_TOOL_NAME,
  SYNTX_OWNER_UPLOAD_TOPAZ_ENHANCE_ORIGINAL_TOOL_NAME,
  SYNTX_OWNER_GENERATE_TOPAZ_ENHANCE_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_TOPAZ_ENHANCE_TOOL_NAME,
  SYNTX_OWNER_LIST_TOPAZ_ENHANCE_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_GET_TOPAZ_ENHANCE_RESULT_PAGE_TOOL_NAME
] as const);

export interface OwnerTopazEnhanceServiceComposition {
  readonly generationService: OwnerTopazEnhanceGenerationService;
  readonly originalReferenceService: OwnerTopazEnhanceOriginalReferenceService;
}

export function registerSyntxOwnerTopazEnhanceTools(server: McpServer, optionsInput: unknown): void {
  const options = exactOptions(optionsInput);
  server.registerTool(SYNTX_GET_TOPAZ_ENHANCE_PARAMETERS_TOOL_NAME, {
    title: "Get Topaz Enhance parameters",
    description: "Reports source-reviewed Topaz Enhance controls and local media limits; it does not prove provider acceptance.",
    inputSchema: z.object({}).strict(),
    outputSchema: parametersOutput,
    annotations: { title: "Get Topaz Enhance parameters", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async () => {
    const profile = getOwnerTopazEnhanceSourceProfile(OWNER_TOPAZ_ENHANCE_MODEL_ID);
    if (!profile) return errorResult("OUTPUT_INVALID", "The reviewed Topaz Enhance profile is unavailable.");
    return structured(parametersOutput, {
      status: profile.status,
      model_id: profile.model_id,
      ai_name: profile.ai_name,
      source_pins: profile.source_pins,
      controls: {
        model: [...profile.controls.model.values],
        upscale: [...profile.controls.upscale.values],
        interpolation: [...profile.controls.interpolation.values],
        numeric_ranges: profile.controls.numeric.values,
        focus: [...profile.controls.focus.values],
        grain: [...profile.controls.grain.values]
      },
      catalog_default_model: profile.catalog_default_model,
      form_fallback_model: profile.form_fallback_model,
      effective_defaults: profile.effective_defaults,
      conditional_combinations: profile.controls.conditional_combinations,
      public_accepted_mime_types: [...profile.input.accepted_file_types],
      local_supported_mime_types: ["video/mp4"],
      local_input_limitation: "MP4_ONLY_LOCAL_PROBE_PUBLIC_SOURCE_ALSO_LISTS_WEBM_QUICKTIME",
      maximum_file_size_bytes: profile.input.max_file_size_bytes,
      duration_seconds: [...profile.input.duration_seconds],
      runtime_usable: false,
      backend_acceptance: "UNPROVEN",
      dispatch_allowed: false
    });
  });

  server.registerTool(SYNTX_OWNER_UPLOAD_TOPAZ_ENHANCE_ORIGINAL_TOOL_NAME, {
    title: "Upload owner Topaz Enhance original",
    description: "Validates and uploads one MP4 for the exact linked owner attempt. If the outcome is uncertain, do not repeat the upload.",
    inputSchema: uploadInput,
    outputSchema: uploadOutput,
    annotations: { title: "Upload Topaz Enhance original", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = uploadInput.safeParse(snapshot(input));
    if (!parsed.success) return originalError("INVALID_REQUEST");
    const { data } = parsed;
    const padding = data.content_base64.endsWith("==") ? 2 : data.content_base64.endsWith("=") ? 1 : 0;
    const size = data.content_base64.length / 4 * 3 - padding;
    if (!Number.isSafeInteger(size) || size < 16 || size > MAX_BYTES) return originalError("INVALID_REQUEST");
    const bytes = Buffer.from(data.content_base64, "base64");
    try {
      if (bytes.length !== size || bytes.toString("base64") !== data.content_base64) return originalError("INVALID_REQUEST");
      const receipt = await options.originalReferenceService.uploadOriginal({
        attemptId: data.link_attempt_id,
        model_id: OWNER_TOPAZ_ENHANCE_MODEL_ID,
        filename: data.filename,
        mime_type: "video/mp4",
        bytes
      }, signal);
      return structured(uploadOutput, receipt);
    } catch (error) { return originalError(codeOriginal(error)); }
    finally { bytes.fill(0); }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_TOPAZ_ENHANCE_TOOL_NAME, {
    title: "Generate Topaz Enhance video",
    description: "Runs one guarded owner generation. If the outcome is unknown, reconcile the recovery and do not retry.",
    inputSchema: generateInput,
    outputSchema: resultSchema,
    annotations: { title: "Generate Topaz Enhance video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = generateInput.safeParse(snapshot(input));
    if (!parsed.success) return generationError("INVALID_REQUEST");
    try {
      return structured(resultSchema, await options.generationService.generate({
        attemptId: parsed.data.link_attempt_id,
        request: {
          model_id: parsed.data.model_id,
          topaz_original_handle: parsed.data.topaz_original_handle,
          parameters: parsed.data.parameters as OwnerTopazEnhanceParameterValues
        }
      }, signal));
    } catch (error) { return generationError(codeGeneration(error), error); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_TOPAZ_ENHANCE_TOOL_NAME, {
    title: "Reconcile Topaz Enhance generation",
    description: "GET-only reconciliation for one recovery handle. It never starts or repeats generation.",
    inputSchema: reconcileInput,
    outputSchema: resultSchema,
    annotations: { title: "Reconcile Topaz Enhance generation", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = reconcileInput.safeParse(snapshot(input));
    if (!parsed.success) return generationError("INVALID_REQUEST");
    try {
      return structured(resultSchema, await options.generationService.reconcile({
        attemptId: parsed.data.link_attempt_id,
        recovery_id: parsed.data.recovery_id
      }, signal));
    } catch (error) { return generationError(codeGeneration(error), error); }
  });

  server.registerTool(SYNTX_OWNER_LIST_TOPAZ_ENHANCE_RECOVERIES_TOOL_NAME, {
    title: "List Topaz Enhance recoveries",
    description: "Lists bounded local recovery summaries without source or result URLs.",
    inputSchema: listInput,
    outputSchema: recoveryList,
    annotations: { title: "List Topaz Enhance recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    const parsed = listInput.safeParse(snapshot(input));
    if (!parsed.success) return generationError("INVALID_REQUEST");
    try {
      const items: readonly OwnerTopazEnhanceRecoveryListItem[] = await options.generationService.listRecoveries({
        attemptId: parsed.data.link_attempt_id,
        ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit })
      });
      return structured(recoveryList, { recoveries: items });
    } catch (error) { return generationError(codeGeneration(error), error); }
  });

  server.registerTool(SYNTX_OWNER_GET_TOPAZ_ENHANCE_RESULT_PAGE_TOOL_NAME, {
    title: "Get Topaz Enhance result page",
    description: "Reads a bounded page from the locally observed result cache; provider acceptance is unproven.",
    inputSchema: pageInput,
    outputSchema: resultSchema,
    annotations: { title: "Get Topaz Enhance result page", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
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

const GEN_MESSAGES: Record<OwnerTopazEnhanceGenerationServiceErrorCode, string> = {
  INVALID_REQUEST: "The Topaz Enhance request is invalid.",
  SERVICE_CLOSED: "The Topaz Enhance service is closed.",
  SERVICE_BUSY: "The Topaz Enhance service is busy.",
  PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.",
  MODEL_BINDING_MISMATCH: "The selected Topaz Enhance model is unavailable.",
  PREFLIGHT_FAILED: "Current account, model access, or quote could not be verified.",
  INTENT_ALREADY_CLAIMED: "This Topaz Enhance intent has an unresolved outcome.",
  PRE_DISPATCH_FAILED: "The request was not safely dispatched.",
  OUTCOME_UNKNOWN: "The request may have been dispatched; reconcile its recovery and do not retry.",
  RECOVERY_NOT_FOUND: "The recovery is unavailable or expired."
};
const ORIGINAL_MESSAGES: Record<OwnerTopazEnhanceOriginalReferenceServiceErrorCode, string> = {
  INVALID_REQUEST: "The Topaz Enhance original upload request is invalid.",
  PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.",
  REQUEST_ABORTED: "The Topaz Enhance original upload was cancelled.",
  SERVICE_BUSY: "The Topaz Enhance original service is busy.",
  CAPACITY_EXCEEDED: "The Topaz Enhance original service is full.",
  SERVICE_CLOSED: "The Topaz Enhance original service is closed.",
  PROBE_REJECTED: "The video source was not accepted by the local MP4 probe.",
  UPLOAD_REJECTED: "The Topaz Enhance upload was rejected.",
  UPLOAD_OUTCOME_UNKNOWN: "The upload outcome is unknown; do not repeat it.",
  REFERENCE_UNAVAILABLE: "The uploaded original is unavailable.",
  REFERENCE_EXPIRED: "The uploaded original has expired."
};

function exactOptions(value: unknown): OwnerTopazEnhanceServiceComposition {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("TOPAZ_ENHANCE_SERVICE_COMPOSITION_INVALID");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== 2 || keys.some((key) => typeof key !== "string" || !["generationService", "originalReferenceService"].includes(key) ||
      !descriptors[key]!.enumerable || !("value" in descriptors[key]!)) ||
      !isOwnerTopazEnhanceGenerationService(descriptors.generationService?.value) ||
      !descriptors.originalReferenceService || types.isProxy(descriptors.originalReferenceService.value) ||
      !(descriptors.originalReferenceService.value instanceof OwnerTopazEnhanceOriginalReferenceService) ||
      Object.getPrototypeOf(descriptors.originalReferenceService.value) !== OwnerTopazEnhanceOriginalReferenceService.prototype ||
      !Object.isFrozen(descriptors.originalReferenceService.value)) throw new Error("TOPAZ_ENHANCE_SERVICE_COMPOSITION_INVALID");
  return Object.freeze({ generationService: descriptors.generationService!.value as OwnerTopazEnhanceGenerationService,
    originalReferenceService: descriptors.originalReferenceService!.value as OwnerTopazEnhanceOriginalReferenceService });
}

function codeOriginal(error: unknown): OwnerTopazEnhanceOriginalReferenceServiceErrorCode {
  return error instanceof OwnerTopazEnhanceOriginalReferenceServiceError && Object.hasOwn(ORIGINAL_MESSAGES, error.code) ? error.code : "PROBE_REJECTED";
}
function codeGeneration(error: unknown): OwnerTopazEnhanceGenerationServiceErrorCode {
  return error instanceof OwnerTopazEnhanceGenerationServiceError && Object.hasOwn(GEN_MESSAGES, error.code) ? error.code : "PRE_DISPATCH_FAILED";
}
function originalError(code: OwnerTopazEnhanceOriginalReferenceServiceErrorCode): CallToolResult {
  return errorResult(code, ORIGINAL_MESSAGES[code]);
}
function generationError(code: OwnerTopazEnhanceGenerationServiceErrorCode, error?: unknown): CallToolResult {
  const known = error instanceof OwnerTopazEnhanceGenerationServiceError ? error : undefined;
  return errorResult(code, GEN_MESSAGES[code], code === "OUTCOME_UNKNOWN" && known?.recovery_id
    ? { recovery_id: known.recovery_id, ...(known.diagnostic ? { diagnostic: known.diagnostic } : {}) } : {});
}
function errorResult(code: string, message: string, extra: Record<string, unknown> = {}): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message, ...extra } }) }] };
}
function structured<T>(schema: z.ZodType<T>, value: unknown): CallToolResult {
  const parsed = schema.safeParse(snapshot(value));
  if (!parsed.success) return errorResult("OUTPUT_INVALID", "The service returned an invalid response.");
  return { content: [{ type: "text", text: JSON.stringify(parsed.data) }], structuredContent: parsed.data as Record<string, unknown> };
}
function snapshot(value: unknown): unknown { try { return walk(value, 0, { n: 0 }); } catch { return undefined; } }
function walk(value: unknown, depth: number, budget: { n: number }): unknown {
  budget.n += 1;
  if (budget.n > 50_000 || depth > 32) throw new Error("TOOL_SNAPSHOT_LIMIT");
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
