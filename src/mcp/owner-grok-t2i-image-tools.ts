import { types } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { OwnerReferencePrincipalError } from "../auth/owner-reference-principal.js";
import {
  OWNER_GROK_T2I_GENERATION_PHASES,
  OWNER_GROK_T2I_HISTORY_REASONS,
  OWNER_GROK_T2I_RESULT_REASONS,
  OwnerGrokT2iGenerationServiceError,
  type OwnerGrokT2iGenerationService,
  type OwnerGrokT2iGenerationServiceErrorCode
} from "../application/owner-grok-t2i-generation-service.js";
import {
  getOwnerGrokT2iSourceParameters,
  OWNER_GROK_T2I_MODELS
} from "../application/owner-grok-t2i-parameters.js";
import {
  OwnerGrokT2iImageUploadServiceError,
  type OwnerGrokT2iImageUploadService,
  type OwnerGrokT2iImageUploadServiceErrorCode
} from "../application/owner-grok-t2i-image-upload-service.js";
import { OWNER_GROK_T2I_IMAGE_INPUT_POLICY } from "../application/owner-grok-t2i-image-input-validator.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const IMAGE_HANDLE = /^grok_t2i_image_[0-9a-f-]{36}$/u;
const RECOVERY_ID = /^grok_t2i_recovery_[0-9a-f-]{36}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MODEL_IDS = OWNER_GROK_T2I_MODELS;
const SOURCE = getOwnerGrokT2iSourceParameters();
const BASE_RATIOS = SOURCE.controls.aspect_ratio.base_values;
const IMAGINE_RATIOS = SOURCE.controls.aspect_ratio.imagine_values;
const ALL_RATIOS = Object.freeze([...new Set([...BASE_RATIOS, ...IMAGINE_RATIOS])] as [string, ...string[]]);
const RESOLUTIONS = SOURCE.controls.resolution.values;
const BATCH_SIZES = SOURCE.controls.batch_size.values;
const DETAILS_QUALITY = SOURCE.controls.details_quality.values;
const UPLOAD_MODELS = Object.freeze(["grok_imagine_2", "grok_imagine_quality"] as const);
const SOURCE_MIMES = OWNER_GROK_T2I_IMAGE_INPUT_POLICY.accepted_source_mime_types;
const CANONICAL_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_IMAGE_BYTES = OWNER_GROK_T2I_IMAGE_INPUT_POLICY.local_max_bytes;
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export const SYNTX_UPLOAD_GROK_T2I_IMAGE_REFERENCE_TOOL_NAME = "syntx_upload_grok_t2i_image_reference" as const;
export const SYNTX_OWNER_GENERATE_GROK_T2I_IMAGE_TOOL_NAME = "syntx_owner_generate_grok_t2i_image" as const;
export const SYNTX_OWNER_RECONCILE_GROK_T2I_IMAGE_TOOL_NAME = "syntx_owner_reconcile_grok_t2i_image" as const;
export const SYNTX_OWNER_LIST_GROK_T2I_IMAGE_RECOVERIES_TOOL_NAME = "syntx_owner_list_grok_t2i_image_recoveries" as const;
export const OWNER_GROK_T2I_IMAGE_TOOL_NAMES = Object.freeze([
  SYNTX_UPLOAD_GROK_T2I_IMAGE_REFERENCE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_GROK_T2I_IMAGE_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_GROK_T2I_IMAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_GROK_T2I_IMAGE_RECOVERIES_TOOL_NAME
] as const);

export interface RegisterSyntxOwnerGrokT2iImageToolsOptions {
  readonly uploadService: Pick<OwnerGrokT2iImageUploadService, "upload">;
  readonly generationService: Pick<OwnerGrokT2iGenerationService, "generate" | "reconcile" | "listRecoveries">;
}

const attemptSchema = z.string().regex(ATTEMPT).describe("Exact linked owner attempt identifier.");
const imageHandleSchema = z.string().regex(IMAGE_HANDLE).describe("Opaque Grok T2I upload handle for this exact owner attempt.");
const recoveryIdSchema = z.string().regex(RECOVERY_ID).describe("Opaque process-local Grok T2I recovery handle for this attempt.");
const filenameSchema = z.string().min(1).max(255).refine(isSafeFilename, "Use a safe basename; paths are rejected.");
const contentBase64Schema = z.string().min(4).max(MAX_BASE64_CHARS).regex(BASE64)
  .describe("Canonical base64 image bytes; the 64 MiB limit is a local resource ceiling, not a provider limit.");
const uploadInputSchema = z.object({
  link_attempt_id: attemptSchema,
  model_id: z.enum(UPLOAD_MODELS),
  content_base64: contentBase64Schema,
  filename: filenameSchema,
  mime_type: z.enum(SOURCE_MIMES)
}).strict().superRefine((input, context) => {
  const bytes = decodedBase64Length(input.content_base64);
  if (!isCanonicalBase64(input.content_base64) || bytes < 1 || bytes > MAX_IMAGE_BYTES) {
    context.addIssue({ code: "custom", path: ["content_base64"], message: "Image bytes must use canonical base64 and fit the local resource ceiling." });
  }
});

const resolutionSchema = z.enum(RESOLUTIONS);
const batchSchema = z.union(BATCH_SIZES.map((value) => z.literal(value)) as [z.ZodLiteral<number>, ...z.ZodLiteral<number>[]]);
const baseParametersSchema = z.object({
  aspect_ratio: z.enum(BASE_RATIOS), resolution: resolutionSchema, batch_size: batchSchema
}).strict();
const imagine2ParametersSchema = z.object({
  aspect_ratio: z.enum(ALL_RATIOS), resolution: resolutionSchema, batch_size: batchSchema,
  details_quality: z.enum(DETAILS_QUALITY)
}).strict();
const qualityParametersSchema = z.object({
  aspect_ratio: z.enum(ALL_RATIOS), resolution: resolutionSchema, batch_size: batchSchema
}).strict();
const generateInputSchema = z.object({
  link_attempt_id: attemptSchema,
  model_id: z.enum(MODEL_IDS),
  prompt: z.string().min(1).max(5_000),
  reference_handles: z.array(imageHandleSchema).max(5),
  parameters: z.union([baseParametersSchema, imagine2ParametersSchema, qualityParametersSchema])
}).strict().superRefine((input, context) => {
  const limit = input.model_id === "grok_t2i" || input.model_id === "grok_t2i_pro" ? 0
    : input.model_id === "grok_imagine_2" ? 5 : 3;
  if (input.reference_handles.length > limit) {
    context.addIssue({ code: "custom", path: ["reference_handles"], message: "Reference count exceeds the selected model's source selector maximum." });
  }
  if (new Set(input.reference_handles).size !== input.reference_handles.length) {
    context.addIssue({ code: "custom", path: ["reference_handles"], message: "Reference handles must be unique and ordered." });
  }
  const selectedRatios = input.model_id === "grok_t2i" || input.model_id === "grok_t2i_pro" || input.reference_handles.length > 0
    ? BASE_RATIOS : IMAGINE_RATIOS;
  if (!selectedRatios.includes(input.parameters.aspect_ratio as never)) {
    context.addIssue({ code: "custom", path: ["parameters", "aspect_ratio"], message: "Aspect ratio is not source-supported for this model/reference branch." });
  }
  if ((input.model_id === "grok_imagine_2") !== Object.hasOwn(input.parameters, "details_quality")) {
    context.addIssue({ code: "custom", path: ["parameters", "details_quality"], message: "details_quality is required only for grok_imagine_2." });
  }
  const promptLimit = input.model_id === "grok_t2i" || input.model_id === "grok_t2i_pro" ? 5_000 : 1_000;
  if (!isValidPrompt(input.prompt, promptLimit)) {
    context.addIssue({ code: "custom", path: ["prompt"], message: "Prompt exceeds the local UTF-16-plus-line-feed source budget or is malformed." });
  }
});

const reconcileInputSchema = z.object({ link_attempt_id: attemptSchema, recovery_id: recoveryIdSchema }).strict();
const listRecoveriesInputSchema = z.object({ link_attempt_id: attemptSchema, limit: z.number().int().min(1).max(20).optional() }).strict();

const uploadOutputSchema = z.object({
  status: z.literal("uploaded"), reference_handle: imageHandleSchema, model_id: z.enum(UPLOAD_MODELS),
  source_mime_type: z.enum(SOURCE_MIMES), mime_type: z.enum(CANONICAL_MIMES),
  width: z.number().int().positive().max(0xffff_ffff), height: z.number().int().positive().max(0xffff_ffff),
  size: z.number().int().positive().max(MAX_IMAGE_BYTES), sha256: z.string().regex(SHA256),
  expires_in_seconds: z.number().int().min(1).max(900), metadata_confidence: z.literal("CONTAINER_METADATA_ONLY"),
  size_limit_confidence: z.literal("LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT")
}).strict();

const diagnosticSchema = z.object({
  phase: z.enum(OWNER_GROK_T2I_GENERATION_PHASES), post_started: z.boolean(), echo_ack_known: z.boolean(),
  history_status: z.enum(["NONE", "PENDING", "READY", "PARTIAL", "UNVERIFIED", "INVALID"]),
  history_reason: z.enum(OWNER_GROK_T2I_HISTORY_REASONS).nullable(),
  result_status: z.enum(["NOT_READ", "PENDING", "PARTIAL", "COMPLETE", "UNVERIFIED"]),
  result_reason: z.enum(OWNER_GROK_T2I_RESULT_REASONS).nullable(),
  history_get_calls: z.number().int().min(0).max(255), history_get_calls_saturated: z.boolean(),
  result_get_calls: z.number().int().min(0).max(255), result_get_calls_saturated: z.boolean()
}).strict();

const outputParametersSchema = z.object({
  aspect_ratio: z.enum(ALL_RATIOS), resolution: resolutionSchema, batch_size: batchSchema, details_quality: z.enum(DETAILS_QUALITY).optional()
}).strict();
const artifactSchema = z.object({
  message_object_id: z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u),
  url: z.string().url().max(4_096).refine(isSafeUploadReferenceUrl),
  mime_type: z.string().min(1).max(64).regex(/^image\/[A-Za-z0-9.+-]+$/u),
  width: z.null(), height: z.null(), geometry_verified: z.literal(false)
}).strict();
const generationOutputSchema = z.object({
  status: z.literal("result_observed"), backend_acceptance: z.literal("UNPROVEN"),
  namespace_confidence: z.literal("SOURCE_SHAPED_UNVERIFIED"), ai_name: z.literal("grok_image"),
  model_id: z.enum(MODEL_IDS), operation_id: z.literal("generate-image"),
  profile_id: z.string().min(1).max(160), profile_schema_hash: z.string().regex(SHA256),
  catalog_version: z.string().min(1).max(160), request_fingerprint: z.string().regex(SHA256),
  parameters: outputParametersSchema, reference_count: z.number().int().min(0).max(5), artifacts: z.array(artifactSchema).max(5)
}).strict().superRefine((result, context) => {
  const refLimit = result.model_id === "grok_t2i" || result.model_id === "grok_t2i_pro" ? 0
    : result.model_id === "grok_imagine_2" ? 5 : 3;
  const ratios = result.model_id === "grok_t2i" || result.model_id === "grok_t2i_pro" || result.reference_count > 0
    ? BASE_RATIOS : IMAGINE_RATIOS;
  if (result.reference_count > refLimit || !ratios.includes(result.parameters.aspect_ratio as never)) {
    context.addIssue({ code: "custom", path: ["reference_count"], message: "Result metadata does not match the source-supported model/reference branch." });
  }
  if ((result.model_id === "grok_imagine_2") !== Object.hasOwn(result.parameters, "details_quality")) {
    context.addIssue({ code: "custom", path: ["parameters", "details_quality"], message: "Result details_quality must match the selected model." });
  }
  if (result.artifacts.length !== result.parameters.batch_size) {
    context.addIssue({ code: "custom", path: ["artifacts"], message: "Only a full completed batch is exposed as a result." });
  }
});

const recoveryItemSchema = z.object({
  recovery_id: recoveryIdSchema, created_at: z.iso.datetime(), model_id: z.enum(MODEL_IDS),
  operation_id: z.literal("generate-image"), status: z.literal("OUTCOME_UNKNOWN"), diagnostic: diagnosticSchema
}).strict();
const listRecoveriesOutputSchema = z.object({ recoveries: z.array(recoveryItemSchema).max(20) }).strict();

const UPLOAD_ERROR_CODES = ["INVALID_REQUEST", "INVALID_IMAGE_INPUT", "LOCAL_RESOURCE_LIMIT_EXCEEDED", "PRINCIPAL_NOT_LINKED",
  "MODEL_BINDING_MISMATCH", "SERVICE_BUSY", "CAPACITY_EXCEEDED", "SERVICE_CLOSED", "CLOCK_INVALID", "REQUEST_ABORTED",
  "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED", "UPLOAD_IN_PROGRESS", "UPLOAD_REJECTED", "UPLOAD_OUTCOME_UNKNOWN"] as const;
const UPLOAD_ERROR_CODES_VALID: readonly OwnerGrokT2iImageUploadServiceErrorCode[] = UPLOAD_ERROR_CODES;
void UPLOAD_ERROR_CODES_VALID;
type UploadErrorCodeDifference = [Exclude<OwnerGrokT2iImageUploadServiceErrorCode, typeof UPLOAD_ERROR_CODES[number]>,
  Exclude<typeof UPLOAD_ERROR_CODES[number], OwnerGrokT2iImageUploadServiceErrorCode>];
const UPLOAD_ERROR_CODES_EXACT: UploadErrorCodeDifference extends [never, never] ? true : never = true;
void UPLOAD_ERROR_CODES_EXACT;

const GENERATION_ERROR_CODES = ["INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "MODEL_BINDING_MISMATCH", "PRINCIPAL_NOT_LINKED",
  "PREFLIGHT_FAILED", "INTENT_ALREADY_CLAIMED", "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"] as const;
const GENERATION_ERROR_CODES_VALID: readonly OwnerGrokT2iGenerationServiceErrorCode[] = GENERATION_ERROR_CODES;
void GENERATION_ERROR_CODES_VALID;
type GenerationErrorCodeDifference = [Exclude<OwnerGrokT2iGenerationServiceErrorCode, typeof GENERATION_ERROR_CODES[number]>,
  Exclude<typeof GENERATION_ERROR_CODES[number], OwnerGrokT2iGenerationServiceErrorCode>];
const GENERATION_ERROR_CODES_EXACT: GenerationErrorCodeDifference extends [never, never] ? true : never = true;
void GENERATION_ERROR_CODES_EXACT;

const PRINCIPAL_ERROR_CODES = ["REFERENCE_PRINCIPAL_NOT_LINKED", "REFERENCE_PRINCIPAL_INVALID"] as const;
const FALLBACK_ERROR_CODES = ["UPLOAD_FAILED", "GENERATION_FAILED", "RECOVERY_LIST_UNAVAILABLE"] as const;
type ToolErrorCode = typeof UPLOAD_ERROR_CODES[number] | typeof GENERATION_ERROR_CODES[number] |
  typeof PRINCIPAL_ERROR_CODES[number] | typeof FALLBACK_ERROR_CODES[number];
const ERROR_MESSAGES: Readonly<Record<ToolErrorCode, string>> = Object.freeze({
  INVALID_REQUEST: "The owner Grok T2I request is invalid.",
  INVALID_IMAGE_INPUT: "Provide a supported Imagine image with matching MIME and valid container metadata.",
  LOCAL_RESOURCE_LIMIT_EXCEEDED: "The image exceeds the local resource ceiling.",
  PRINCIPAL_NOT_LINKED: "The exact owner attempt is not linked.",
  REFERENCE_PRINCIPAL_NOT_LINKED: "The exact owner attempt is not linked.",
  REFERENCE_PRINCIPAL_INVALID: "The exact owner attempt is not linked.",
  MODEL_BINDING_MISMATCH: "The selected Grok T2I model is unavailable in the pinned source catalog.",
  SERVICE_BUSY: "The bounded Grok T2I service is busy; no automatic retry was performed.",
  CAPACITY_EXCEEDED: "The bounded Grok T2I service capacity is full.",
  SERVICE_CLOSED: "The owner Grok T2I service is closed.",
  CLOCK_INVALID: "The bounded owner operation could not verify its local clock.",
  REQUEST_ABORTED: "The operation was aborted; inspect its exact outcome before retrying.",
  REFERENCE_UNAVAILABLE: "A reference handle is unavailable for this exact attempt and model.",
  REFERENCE_EXPIRED: "A reference handle expired or is no longer available.",
  UPLOAD_IN_PROGRESS: "An upload for this exact reference is already in progress.",
  UPLOAD_REJECTED: "The reference upload was rejected before a handle was issued.",
  UPLOAD_OUTCOME_UNKNOWN: "The upload outcome is unknown; do not repeat it automatically.",
  PREFLIGHT_FAILED: "Fresh account or model-access checks did not pass.",
  INTENT_ALREADY_CLAIMED: "This semantic generation intent is already claimed and cannot be replayed.",
  PRE_DISPATCH_FAILED: "Generation failed before dispatch.",
  OUTCOME_UNKNOWN: "Generation may have been dispatched; do not retry. Reconcile only with the same recovery handle.",
  RECOVERY_NOT_FOUND: "No matching process-local recovery record is available for this attempt.",
  UPLOAD_FAILED: "The Grok Imagine image upload failed safely.",
  GENERATION_FAILED: "Generation could not be confirmed; do not repeat a call that may have dispatched.",
  RECOVERY_LIST_UNAVAILABLE: "Grok T2I recovery handles are unavailable."
});
const TOOL_ERROR_CODES = Object.freeze([...new Set<ToolErrorCode>([
  ...UPLOAD_ERROR_CODES, ...GENERATION_ERROR_CODES, ...PRINCIPAL_ERROR_CODES, ...FALLBACK_ERROR_CODES
])] as [ToolErrorCode, ...ToolErrorCode[]]);

export const OWNER_GROK_T2I_IMAGE_TOOL_INPUT_SCHEMAS = Object.freeze({
  upload: uploadInputSchema, generate: generateInputSchema, reconcile: reconcileInputSchema, list_recoveries: listRecoveriesInputSchema
});
export const OWNER_GROK_T2I_IMAGE_TOOL_OUTPUT_SCHEMAS = Object.freeze({
  upload: uploadOutputSchema, generate: generationOutputSchema, reconcile: generationOutputSchema, list_recoveries: listRecoveriesOutputSchema
});

export function registerSyntxOwnerGrokT2iImageTools(server: McpServer, options: RegisterSyntxOwnerGrokT2iImageToolsOptions): void {
  server.registerTool(SYNTX_UPLOAD_GROK_T2I_IMAGE_REFERENCE_TOOL_NAME, {
    title: "Upload an owned Grok Imagine image reference",
    description: "Upload one locally validated image for the exact linked owner attempt. Returns only an opaque handle and bounded metadata; upload does not authorize generation.",
    inputSchema: uploadInputSchema, outputSchema: uploadOutputSchema,
    annotations: annotations("Upload Grok Imagine image reference", false, true, true)
  }, async (input, { signal }) => {
    const copied = snapshotSafeInput(input);
    if (copied === undefined) return errorResult(undefined, "INVALID_REQUEST", "UPLOAD_FAILED");
    const parsed = uploadInputSchema.safeParse(copied);
    if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST", "UPLOAD_FAILED");
    try {
      const receipt = await options.uploadService.upload({ attemptId: parsed.data.link_attempt_id, model_id: parsed.data.model_id,
        content_base64: parsed.data.content_base64, filename: parsed.data.filename, mime_type: parsed.data.mime_type,
        ...(signal === undefined ? {} : { signal }) });
      return structured(parseSafeOutput(uploadOutputSchema, receipt));
    } catch (error) { return errorResult(error, "UPLOAD_FAILED", "UPLOAD_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_GROK_T2I_IMAGE_TOOL_NAME, {
    title: "Generate a Grok T2I image",
    description: "Starts one full-four Grok T2I generation after fresh account and model-access preflights. If the outcome is uncertain, do not repeat; use the exact recovery handle.",
    inputSchema: generateInputSchema, outputSchema: generationOutputSchema,
    annotations: annotations("Generate Grok T2I image", false, true, true)
  }, async (input, { signal }) => {
    const copied = snapshotSafeInput(input);
    if (copied === undefined) return errorResult(undefined, "INVALID_REQUEST", "GENERATION_FAILED");
    const parsed = generateInputSchema.safeParse(copied);
    if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST", "GENERATION_FAILED");
    try {
      const result = await options.generationService.generate({ attemptId: parsed.data.link_attempt_id, model_id: parsed.data.model_id,
        prompt: parsed.data.prompt, parameters: parsed.data.parameters, reference_handles: parsed.data.reference_handles }, signal);
      return structured(parseSafeOutput(generationOutputSchema, result));
    } catch (error) { return errorResult(error, "GENERATION_FAILED", "GENERATION_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_GROK_T2I_IMAGE_TOOL_NAME, {
    title: "Reconcile a Grok T2I generation",
    description: "Read-only GET-only reconciliation for the exact attempt and recovery handle. It never starts another generation.",
    inputSchema: reconcileInputSchema, outputSchema: generationOutputSchema,
    annotations: annotations("Reconcile Grok T2I generation", true, false, true)
  }, async (input, { signal }) => {
    const copied = snapshotSafeInput(input);
    if (copied === undefined) return errorResult(undefined, "INVALID_REQUEST", "GENERATION_FAILED");
    const parsed = reconcileInputSchema.safeParse(copied);
    if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST", "GENERATION_FAILED");
    try {
      const result = await options.generationService.reconcile({ attemptId: parsed.data.link_attempt_id, recovery_id: parsed.data.recovery_id }, signal);
      return structured(parseSafeOutput(generationOutputSchema, result));
    } catch (error) { return errorResult(error, "GENERATION_FAILED", "GENERATION_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_LIST_GROK_T2I_IMAGE_RECOVERIES_TOOL_NAME, {
    title: "List Grok T2I recovery handles",
    description: "Lists bounded, process-local recovery diagnostics for the exact linked owner attempt. Prompts, source settings, artifact URLs, and principal details are not returned.",
    inputSchema: listRecoveriesInputSchema, outputSchema: listRecoveriesOutputSchema,
    annotations: annotations("List Grok T2I recoveries", true, false, true)
  }, async (input) => {
    const copied = snapshotSafeInput(input);
    if (copied === undefined) return errorResult(undefined, "INVALID_REQUEST", "RECOVERY_LIST_UNAVAILABLE");
    const parsed = listRecoveriesInputSchema.safeParse(copied);
    if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST", "RECOVERY_LIST_UNAVAILABLE");
    try {
      const recoveries = await options.generationService.listRecoveries({ attemptId: parsed.data.link_attempt_id,
        ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }) });
      return structured(parseSafeOutput(listRecoveriesOutputSchema, { recoveries }));
    } catch (error) { return errorResult(error, "RECOVERY_LIST_UNAVAILABLE", "RECOVERY_LIST_UNAVAILABLE"); }
  });
}

function annotations(title: string, readOnly: boolean, destructive: boolean, openWorld: boolean) {
  return { title, readOnlyHint: readOnly, destructiveHint: destructive, idempotentHint: readOnly, openWorldHint: openWorld };
}
function structured(value: object): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> };
}
function errorResult(error: unknown, fallback: ToolErrorCode, operationFallback: ToolErrorCode): CallToolResult {
  let code = fallback;
  let recoveryId: string | undefined;
  let diagnostic: unknown;
  if (!isProxyObject(error) && error instanceof OwnerGrokT2iImageUploadServiceError) {
    const sourceCode = ownData(error, "code");
    if (typeof sourceCode === "string" && (UPLOAD_ERROR_CODES as readonly string[]).includes(sourceCode)) code = sourceCode as ToolErrorCode;
  } else if (!isProxyObject(error) && error instanceof OwnerGrokT2iGenerationServiceError) {
    const sourceCode = ownData(error, "code");
    if (typeof sourceCode === "string" && (GENERATION_ERROR_CODES as readonly string[]).includes(sourceCode)) {
      code = sourceCode as ToolErrorCode;
      if (sourceCode === "OUTCOME_UNKNOWN") {
        const candidateRecoveryId = ownData(error, "recovery_id");
        if (typeof candidateRecoveryId === "string" && RECOVERY_ID.test(candidateRecoveryId)) recoveryId = candidateRecoveryId;
        const sourceDiagnostic = ownData(error, "diagnostic");
        const copied = snapshotDiagnostic(sourceDiagnostic);
        const parsed = copied === undefined ? undefined : diagnosticSchema.safeParse(copied);
        if (parsed?.success) diagnostic = parsed.data;
      }
    }
  } else if (!isProxyObject(error) && error instanceof OwnerReferencePrincipalError) {
    const sourceCode = ownData(error, "code");
    if (sourceCode === "REFERENCE_PRINCIPAL_NOT_LINKED" || sourceCode === "REFERENCE_PRINCIPAL_INVALID") code = sourceCode;
  }
  const safeCode = (TOOL_ERROR_CODES as readonly string[]).includes(code) ? code : operationFallback;
  const body = { error: {
    code: safeCode, message: ERROR_MESSAGES[safeCode],
    ...(safeCode === "OUTCOME_UNKNOWN" && recoveryId !== undefined ? { recovery_id: recoveryId } : {}),
    ...(safeCode === "OUTCOME_UNKNOWN" && diagnostic !== undefined ? { diagnostic } : {})
  } };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] };
}

function ownData(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || types.isProxy(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}
function isProxyObject(value: unknown): boolean { return Boolean(value && typeof value === "object" && types.isProxy(value)); }
function snapshotDiagnostic(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  const allowed = ["phase", "post_started", "echo_ack_known", "history_status", "history_reason", "result_status", "result_reason",
    "history_get_calls", "history_get_calls_saturated", "result_get_calls", "result_get_calls_saturated"];
  if (keys.length !== allowed.length || keys.some((key) => typeof key !== "string" || !allowed.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) return undefined;
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function snapshotSafeInput(value: unknown): unknown {
  const seen = new WeakSet<object>();
  const state = { nodes: 0 };
  const copy = (item: unknown, depth: number): unknown => {
    state.nodes += 1;
    if (depth > 8 || state.nodes > 4_096) throw new Error("UNSAFE_TOOL_DATA");
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "string") return item.length <= MAX_BASE64_CHARS ? item : (() => { throw new Error("UNSAFE_TOOL_DATA"); })();
    if (typeof item === "number") return Number.isFinite(item) ? item : (() => { throw new Error("UNSAFE_TOOL_DATA"); })();
    if (!item || typeof item !== "object" || types.isProxy(item) || seen.has(item)) throw new Error("UNSAFE_TOOL_DATA");
    seen.add(item);
    try {
      if (Array.isArray(item)) {
        if (Object.getPrototypeOf(item) !== Array.prototype || item.length > 1_024) throw new Error("UNSAFE_TOOL_DATA");
        const descriptors = Object.getOwnPropertyDescriptors(item);
        const keys = Reflect.ownKeys(descriptors);
        if (keys.length !== item.length + 1 || !keys.includes("length") || keys.some((key) => key !== "length" &&
            (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= item.length ||
              !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) throw new Error("UNSAFE_TOOL_DATA");
        return Array.from({ length: item.length }, (_, index) => {
          const descriptor = descriptors[String(index)];
          if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) throw new Error("UNSAFE_TOOL_DATA");
          return copy(descriptor.value, depth + 1);
        });
      }
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw new Error("UNSAFE_TOOL_DATA");
      const descriptors = Object.getOwnPropertyDescriptors(item);
      const keys = Reflect.ownKeys(descriptors);
      if (keys.length > 256 || keys.some((key) => typeof key !== "string" || !("value" in descriptors[key]!) ||
          descriptors[key]!.enumerable !== true)) throw new Error("UNSAFE_TOOL_DATA");
      const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of keys as string[]) result[key] = copy(descriptors[key]!.value, depth + 1);
      return result;
    } finally { seen.delete(item); }
  };
  try { return copy(value, 0); } catch { return undefined; }
}
function parseSafeOutput<T>(schema: z.ZodType<T>, value: unknown): T {
  const copied = snapshotSafeInput(value);
  if (copied === undefined) throw new Error("UNSAFE_SERVICE_OUTPUT");
  return schema.parse(copied);
}
function isSafeFilename(value: string): boolean {
  return value !== "." && value !== ".." && /^[^/\\\p{Cc}\p{Cf}\p{Cs}]{1,255}$/u.test(value) && Buffer.byteLength(value, "utf8") <= 255;
}
function decodedBase64Length(value: string): number {
  if (value.length === 0 || value.length % 4 !== 0) return 0;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}
function isCanonicalBase64(value: string): boolean {
  if (!BASE64.test(value) || value.length % 4 !== 0) return false;
  if (value.endsWith("==")) {
    const index = base64Index(value.charCodeAt(value.length - 3));
    return index >= 0 && (index & 15) === 0;
  }
  if (value.endsWith("=")) {
    const index = base64Index(value.charCodeAt(value.length - 2));
    return index >= 0 && (index & 3) === 0;
  }
  return true;
}
function base64Index(code: number): number {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 97 + 26;
  if (code >= 48 && code <= 57) return code - 48 + 52;
  if (code === 43) return 62;
  if (code === 47) return 63;
  return -1;
}
function isValidPrompt(value: string, maximumUtf16Units: number): boolean {
  if (value.trim().length === 0 || Buffer.byteLength(value, "utf8") > 128 * 1024 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) ||
      value.length + (value.match(/\n/gu)?.length ?? 0) > maximumUtf16Units) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
