import { types } from "node:util";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  OwnerFlux3MediaReferenceService,
  OwnerFlux3MediaReferenceServiceError,
  type OwnerFlux3MediaReferenceServiceErrorCode
} from "../application/owner-flux3-media-reference-service.js";
import {
  OwnerFlux3VideoGenerationService,
  OwnerFlux3VideoGenerationServiceError,
  isOwnerFlux3VideoGenerationService,
  type OwnerFlux3VideoGenerationServiceErrorCode,
  type OwnerFlux3VideoRecoveryListItem
} from "../application/owner-flux3-video-generation-service.js";
import {
  OWNER_FLUX3_VIDEO_MODEL_IDS,
  getOwnerFlux3VideoSourceProfile
} from "../application/owner-flux3-video-source-profile.js";
import type { OwnerFlux3VideoParameterValues } from "../application/owner-flux3-video-parameters.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_VIDEO_BASE64 = Math.ceil(MAX_VIDEO_BYTES / 3) * 4;
const MAX_RESULTS = 4096;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^flux3_media_reference_[0-9a-f-]{36}$/u;
const RECOVERY = /^flux3_video_recovery_[0-9a-f-]{36}$/u;
const attempt = z.string().regex(ATTEMPT);
const handle = z.string().regex(HANDLE);
const recoveryId = z.string().regex(RECOVERY);
const filename = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._ -]*$/u);
const modelIdSchema = z.enum(OWNER_FLUX3_VIDEO_MODEL_IDS);
const base64 = (maximum: number) => z.string().min(4).max(maximum)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);

const uploadInput = z.object({
  link_attempt_id: attempt,
  model_id: modelIdSchema,
  filename,
  mime_type: z.enum(["image/jpeg", "image/png", "image/webp", "video/mp4"]),
  content_base64: base64(MAX_VIDEO_BASE64)
}).strict();
const generateInput = z.object({
  link_attempt_id: attempt,
  model_id: modelIdSchema,
  prompt: z.string().max(65_536),
  flux3_reference_handles: z.array(handle).min(1).max(10),
  parameters: z.object({
    resolution: z.enum(["hd", "fhd"]),
    video_duration: z.number().int().min(5).max(20),
    generate_audio: z.boolean()
  }).strict()
}).strict();
const reconcileInput = z.object({ link_attempt_id: attempt, recovery_id: recoveryId }).strict();
const listInput = z.object({ link_attempt_id: attempt, limit: z.number().int().min(1).max(128).optional() }).strict();
const pageInput = z.object({
  link_attempt_id: attempt,
  recovery_id: recoveryId,
  offset: z.number().int().min(0).max(MAX_RESULTS).optional()
}).strict();

const getterInput = z.object({ model_id: modelIdSchema }).strict();
const profilePins = z.object({
  public_catalog_version: z.string().regex(/^sha256-[a-f0-9]{64}\.json$/u),
  public_models_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  source_build_id: z.string().regex(/^\d{1,32}$/u),
  modules: z.record(z.string(), z.string().regex(/^sha256:[a-f0-9]{64}$/u))
}).strict();
const staticControls = {
  resolution: z.tuple([z.literal("hd"), z.literal("fhd")]),
  generate_audio: z.literal("BOOLEAN"),
  aspect_ratio: z.object({ mode: z.literal("SOURCE_FORCED"), value: z.literal("auto"), caller_control: z.literal(false) }).strict(),
  conditional_combinations: z.literal("UNPROVEN")
};
const i2vProfileOutput = z.object({
  model_id: z.literal("flux3_i2v"),
  ai_name: z.literal("flux3_video"),
  modality: z.literal("video"),
  catalog_scope: z.literal("video"),
  controls: z.object({ ...staticControls, video_duration: z.tuple([z.literal(5), z.literal(20)]) }).strict(),
  effective_defaults: z.literal("UNKNOWN"),
  upstream_n: z.literal("OMITTED_FROM_EXPLICIT_VIDEO_SETTINGS"),
  draft_cost_parameter: z.literal("UNSET_OMITTED_FROM_QUERY"),
  input: z.object({
    role: z.literal("image"),
    file_count_limit: z.literal(10),
    accepted_file_types: z.tuple([z.literal("image/jpeg"), z.literal("image/png"), z.literal("image/webp")]),
    max_file_size_bytes: z.literal(MAX_IMAGE_BYTES),
    duration_seconds: z.literal("UNKNOWN")
  }).strict(),
  runtime_usable: z.literal(false),
  dispatch_allowed: z.literal(false),
  backend_acceptance: z.literal("UNPROVEN")
}).strict();
const v2vProfileOutput = z.object({
  model_id: z.literal("flux3_v2v"),
  ai_name: z.literal("flux3_video"),
  modality: z.literal("video"),
  catalog_scope: z.literal("video"),
  controls: z.object({ ...staticControls, video_duration: z.tuple([z.literal(5), z.literal(15)]) }).strict(),
  effective_defaults: z.literal("UNKNOWN"),
  upstream_n: z.literal("OMITTED_FROM_EXPLICIT_VIDEO_SETTINGS"),
  draft_cost_parameter: z.literal("UNSET_OMITTED_FROM_QUERY"),
  input: z.object({
    role: z.literal("video"),
    file_count_limit: z.literal(1),
    accepted_file_types: z.tuple([z.literal("video/mp4")]),
    max_file_size_bytes: z.literal(MAX_VIDEO_BYTES),
    duration_seconds: z.literal("UNKNOWN")
  }).strict(),
  runtime_usable: z.literal(false),
  dispatch_allowed: z.literal(false),
  backend_acceptance: z.literal("UNPROVEN")
}).strict();
const modelProfileOutput = z.discriminatedUnion("model_id", [i2vProfileOutput, v2vProfileOutput]);
const parametersOutput = z.object({
  status: z.literal("SOURCE_REVIEWED_STATIC_ONLY"),
  model_id: modelIdSchema,
  source_pins: profilePins,
  profile: modelProfileOutput,
  runtime_usable: z.literal(false),
  dispatch_allowed: z.literal(false),
  backend_acceptance: z.literal("UNPROVEN")
}).strict();

const uploadOutput = z.object({
  status: z.literal("uploaded"),
  flux3_reference_handle: handle,
  model_id: modelIdSchema,
  mime_type: z.string(),
  size: z.number().int().min(1).max(MAX_VIDEO_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  duration_seconds: z.number().positive().nullable(),
  input_confidence: z.enum(["STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED", "LOCAL_FFPROBE_METADATA_ONLY_NO_DECODE"]),
  expires_in_seconds: z.number().int().min(0).max(900)
}).strict();

const diagnostic = z.object({
  phase: z.enum(["VALIDATE_REQUEST", "PREFLIGHT_ONE", "CHAT_CREATE", "PREFLIGHT_TWO", "GENERATION_POST", "POST_ACK_KNOWN", "HISTORY_GET", "RESULT_GET"]),
  post_started: z.boolean(),
  ack_known: z.boolean(),
  request_echo_status: z.enum(["NOT_READ", "MATCHED", "ABSENT", "PARTIAL_UNPROVEN", "CONTRADICTORY"]),
  history_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "INCOMPLETE", "UNVERIFIED"]),
  owner_ack_status: z.enum(["NOT_READ", "MATCHED", "MISSING", "AMBIGUOUS", "MISMATCH"]),
  history_get_calls: z.number().int().min(0).max(255),
  result_get_calls: z.number().int().min(0).max(255),
  result_status: z.enum(["NOT_READ", "COMPLETE", "UNVERIFIED"]),
  gaps: z.array(z.string().max(128)).max(32)
}).strict();
const recoveryItem = z.object({
  recovery_id: recoveryId,
  created_at: z.iso.datetime(),
  model_id: modelIdSchema,
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
  model_id: modelIdSchema,
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
    model_id: modelIdSchema
  }).strict()).max(64),
  has_more: z.boolean(),
  next_offset: z.number().int().min(0).max(MAX_RESULTS).nullable(),
  diagnostic
}).strict();

export const SYNTX_GET_FLUX3_VIDEO_PARAMETERS_TOOL_NAME = "syntx_get_flux3_video_parameters" as const;
export const SYNTX_OWNER_UPLOAD_FLUX3_VIDEO_REFERENCE_TOOL_NAME = "syntx_owner_upload_flux3_video_reference" as const;
export const SYNTX_OWNER_GENERATE_FLUX3_VIDEO_TOOL_NAME = "syntx_owner_generate_flux3_video" as const;
export const SYNTX_OWNER_RECONCILE_FLUX3_VIDEO_TOOL_NAME = "syntx_owner_reconcile_flux3_video" as const;
export const SYNTX_OWNER_LIST_FLUX3_VIDEO_RECOVERIES_TOOL_NAME = "syntx_owner_list_flux3_video_recoveries" as const;
export const SYNTX_OWNER_GET_FLUX3_VIDEO_RESULT_PAGE_TOOL_NAME = "syntx_owner_get_flux3_video_result_page" as const;
export const OWNER_FLUX3_VIDEO_TOOL_NAMES = Object.freeze([
  SYNTX_GET_FLUX3_VIDEO_PARAMETERS_TOOL_NAME,
  SYNTX_OWNER_UPLOAD_FLUX3_VIDEO_REFERENCE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_FLUX3_VIDEO_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_FLUX3_VIDEO_TOOL_NAME,
  SYNTX_OWNER_LIST_FLUX3_VIDEO_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_GET_FLUX3_VIDEO_RESULT_PAGE_TOOL_NAME
] as const);

export interface OwnerFlux3VideoServiceComposition {
  readonly generationService: OwnerFlux3VideoGenerationService;
  readonly referenceService: OwnerFlux3MediaReferenceService;
}

export function registerSyntxOwnerFlux3VideoTools(server: McpServer, optionsInput: unknown): void {
  const options = exactOptions(optionsInput);
  server.registerTool(SYNTX_GET_FLUX3_VIDEO_PARAMETERS_TOOL_NAME, {
    title: "Get Flux3 video parameters",
    description: "Returns the source-reviewed explicit Flux3 I2V/V2V controls and local input bounds; defaults and conditional combinations remain unproven.",
    inputSchema: getterInput,
    outputSchema: parametersOutput,
    annotations: { title: "Get Flux3 video parameters", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    const parsed = getterInput.safeParse(snapshot(input));
    if (!parsed.success) return errorResult("INVALID_REQUEST", "A source-backed Flux3 video model ID is required.");
    const profile = getOwnerFlux3VideoSourceProfile(parsed.data.model_id);
    if (!profile) return errorResult("OUTPUT_INVALID", "The reviewed Flux3 video profile is unavailable.");
    return structured(parametersOutput, {
      status: "SOURCE_REVIEWED_STATIC_ONLY",
      model_id: profile.model_id,
      source_pins: profile.source_pins,
      profile: {
        model_id: profile.model_id,
        ai_name: profile.ai_name,
        modality: profile.modality,
        catalog_scope: profile.catalog_scope,
        controls: profile.controls,
        effective_defaults: profile.effective_defaults,
        upstream_n: profile.upstream_n,
        draft_cost_parameter: profile.draft_cost_parameter,
        input: profile.input,
        runtime_usable: false,
        dispatch_allowed: false,
        backend_acceptance: "UNPROVEN"
      },
      runtime_usable: false,
      dispatch_allowed: false,
      backend_acceptance: "UNPROVEN"
    });
  });

  server.registerTool(SYNTX_OWNER_UPLOAD_FLUX3_VIDEO_REFERENCE_TOOL_NAME, {
    title: "Upload owner Flux3 video reference",
    description: "Validates and uploads one source file for the selected linked owner attempt. If upload outcome is uncertain, do not repeat it.",
    inputSchema: uploadInput,
    outputSchema: uploadOutput,
    annotations: { title: "Upload Flux3 video reference", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = uploadInput.safeParse(snapshot(input));
    if (!parsed.success) return referenceError("INVALID_REQUEST");
    const { data } = parsed;
    const maximum = data.model_id === "flux3_i2v" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    const padding = data.content_base64.endsWith("==") ? 2 : data.content_base64.endsWith("=") ? 1 : 0;
    const size = data.content_base64.length / 4 * 3 - padding;
    if (!Number.isSafeInteger(size) || size < 1 || size > maximum) return referenceError("INVALID_REQUEST");
    if (data.model_id === "flux3_i2v" && !imageFilenameMatchesMime(data.filename, data.mime_type)) return referenceError("INVALID_REQUEST");
    if (data.model_id === "flux3_v2v" && (data.mime_type !== "video/mp4" || !/\.mp4$/iu.test(data.filename))) return referenceError("INVALID_REQUEST");
    const bytes = Buffer.from(data.content_base64, "base64");
    try {
      if (bytes.length !== size || bytes.toString("base64") !== data.content_base64) return referenceError("INVALID_REQUEST");
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

  server.registerTool(SYNTX_OWNER_GENERATE_FLUX3_VIDEO_TOOL_NAME, {
    title: "Generate owner Flux3 video",
    description: "Runs one guarded Flux3 I2V/V2V owner request. If outcome is unknown, reconcile the recovery and do not retry.",
    inputSchema: generateInput,
    outputSchema: resultSchema,
    annotations: { title: "Generate Flux3 video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = generateInput.safeParse(snapshot(input));
    if (!parsed.success) return generationError("INVALID_REQUEST");
    if (Buffer.byteLength(parsed.data.prompt, "utf8") > 64 * 1024) return generationError("INVALID_REQUEST");
    if (parsed.data.model_id === "flux3_v2v" &&
        (parsed.data.flux3_reference_handles.length !== 1 || parsed.data.parameters.video_duration > 15)) return generationError("INVALID_REQUEST");
    try {
      return structured(resultSchema, await options.generationService.generate({
        attemptId: parsed.data.link_attempt_id,
        request: {
          model_id: parsed.data.model_id,
          prompt: parsed.data.prompt,
          flux3_reference_handles: parsed.data.flux3_reference_handles,
          parameters: parsed.data.parameters as OwnerFlux3VideoParameterValues
        }
      }, signal));
    } catch (error) { return generationError(codeGeneration(error), error); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_FLUX3_VIDEO_TOOL_NAME, {
    title: "Reconcile Flux3 video generation",
    description: "GET-only reconciliation for one recovery handle; it never starts or repeats generation.",
    inputSchema: reconcileInput,
    outputSchema: resultSchema,
    annotations: { title: "Reconcile Flux3 video generation", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
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

  server.registerTool(SYNTX_OWNER_LIST_FLUX3_VIDEO_RECOVERIES_TOOL_NAME, {
    title: "List Flux3 video recoveries",
    description: "Lists bounded local recovery summaries without source or result URLs.",
    inputSchema: listInput,
    outputSchema: recoveryList,
    annotations: { title: "List Flux3 video recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    const parsed = listInput.safeParse(snapshot(input));
    if (!parsed.success) return generationError("INVALID_REQUEST");
    try {
      const items: readonly OwnerFlux3VideoRecoveryListItem[] = await options.generationService.listRecoveries({
        attemptId: parsed.data.link_attempt_id,
        ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit })
      });
      return structured(recoveryList, { recoveries: items });
    } catch (error) { return generationError(codeGeneration(error), error); }
  });

  server.registerTool(SYNTX_OWNER_GET_FLUX3_VIDEO_RESULT_PAGE_TOOL_NAME, {
    title: "Get Flux3 video result page",
    description: "Reads a bounded page from the local observed-result cache; provider acceptance remains unproven.",
    inputSchema: pageInput,
    outputSchema: resultSchema,
    annotations: { title: "Get Flux3 video result page", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
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

const GENERATION_MESSAGES: Record<OwnerFlux3VideoGenerationServiceErrorCode, string> = {
  INVALID_REQUEST: "The Flux3 video request is invalid.",
  SERVICE_CLOSED: "The Flux3 video service is closed.",
  SERVICE_BUSY: "The Flux3 video service is busy.",
  PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.",
  MODEL_BINDING_MISMATCH: "The selected Flux3 video model is unavailable.",
  PREFLIGHT_FAILED: "Current account, model access, or quote could not be verified.",
  INTENT_ALREADY_CLAIMED: "This Flux3 video intent has an unresolved outcome.",
  PRE_DISPATCH_FAILED: "The request was not safely dispatched.",
  OUTCOME_UNKNOWN: "The request may have been dispatched; reconcile its recovery and do not retry.",
  RECOVERY_NOT_FOUND: "The recovery is unavailable or expired."
};
const REFERENCE_MESSAGES: Record<OwnerFlux3MediaReferenceServiceErrorCode, string> = {
  INVALID_REQUEST: "The Flux3 media reference request is invalid.",
  PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.",
  REQUEST_ABORTED: "The Flux3 media upload was cancelled.",
  SERVICE_BUSY: "The Flux3 media reference service is busy.",
  CAPACITY_EXCEEDED: "The Flux3 media reference service is full.",
  SERVICE_CLOSED: "The Flux3 media reference service is closed.",
  PROBE_REJECTED: "The source was not accepted by the local media inspector.",
  UPLOAD_REJECTED: "The Flux3 media upload was rejected.",
  UPLOAD_OUTCOME_UNKNOWN: "The upload outcome is unknown; do not repeat it.",
  REFERENCE_UNAVAILABLE: "The uploaded Flux3 reference is unavailable.",
  REFERENCE_EXPIRED: "The uploaded Flux3 reference has expired."
};

function exactOptions(value: unknown): OwnerFlux3VideoServiceComposition {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("OWNER_FLUX3_VIDEO_SERVICE_COMPOSITION_INVALID");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== 2 || keys.some((key) => typeof key !== "string" || !["generationService", "referenceService"].includes(key) ||
      !descriptors[key]!.enumerable || !("value" in descriptors[key]!)) ||
      !isOwnerFlux3VideoGenerationService(descriptors.generationService?.value) ||
      !descriptors.referenceService || types.isProxy(descriptors.referenceService.value) ||
      !(descriptors.referenceService.value instanceof OwnerFlux3MediaReferenceService) ||
      Object.getPrototypeOf(descriptors.referenceService.value) !== OwnerFlux3MediaReferenceService.prototype ||
      !Object.isFrozen(descriptors.referenceService.value)) throw new Error("OWNER_FLUX3_VIDEO_SERVICE_COMPOSITION_INVALID");
  return Object.freeze({
    generationService: descriptors.generationService!.value as OwnerFlux3VideoGenerationService,
    referenceService: descriptors.referenceService!.value as OwnerFlux3MediaReferenceService
  });
}

function imageFilenameMatchesMime(name: string, mime: string): boolean {
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return mime === "image/jpeg" ? extension === "jpg" || extension === "jpeg" :
    mime === "image/png" ? extension === "png" : mime === "image/webp" && extension === "webp";
}
function codeReference(error: unknown): OwnerFlux3MediaReferenceServiceErrorCode {
  return error instanceof OwnerFlux3MediaReferenceServiceError && Object.hasOwn(REFERENCE_MESSAGES, error.code) ? error.code : "PROBE_REJECTED";
}
function codeGeneration(error: unknown): OwnerFlux3VideoGenerationServiceErrorCode {
  return error instanceof OwnerFlux3VideoGenerationServiceError && Object.hasOwn(GENERATION_MESSAGES, error.code) ? error.code : "PRE_DISPATCH_FAILED";
}
function referenceError(code: OwnerFlux3MediaReferenceServiceErrorCode): CallToolResult {
  return errorResult(code, REFERENCE_MESSAGES[code]);
}
function generationError(code: OwnerFlux3VideoGenerationServiceErrorCode, error?: unknown): CallToolResult {
  const known = error instanceof OwnerFlux3VideoGenerationServiceError ? error : undefined;
  const safeDiagnostic = known?.diagnostic === undefined ? undefined : diagnostic.safeParse(snapshot(known.diagnostic));
  return errorResult(code, GENERATION_MESSAGES[code], code === "OUTCOME_UNKNOWN" && known?.recovery_id
    ? { recovery_id: known.recovery_id, ...(safeDiagnostic?.success ? { diagnostic: safeDiagnostic.data } : {}) } : {});
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
