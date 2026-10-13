import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { OwnerReferencePrincipalError } from "../auth/owner-reference-principal.js";
import {
  OwnerFluxImageGenerationServiceError,
  OWNER_FLUX_IMAGE_GENERATION_ERROR_CODES,
  OWNER_FLUX_IMAGE_GENERATION_PHASES,
  OWNER_FLUX_IMAGE_GENERATION_HISTORY_REASONS,
  OWNER_FLUX_IMAGE_GENERATION_RESULT_REASONS,
  type OwnerFluxImageGenerationService
} from "../application/owner-flux-image-generation-service.js";
import { OwnerFluxImageAssetServiceError, type OwnerFluxImageAssetService } from "../application/owner-flux-image-asset-service.js";
import { OwnerFluxImageUploadServiceError, type OwnerFluxImageUploadService } from "../application/owner-flux-image-upload-service.js";
import { OWNER_FLUX_IMAGE_MODELS } from "../application/owner-flux-image-parameters.js";
import { OWNER_RUNWAY_FLUX_IMAGE_INPUT_POLICY } from "../application/owner-runway-flux-image-input-validator.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";

export const SYNTX_UPLOAD_FLUX_IMAGE_REFERENCE_TOOL_NAME = "syntx_upload_flux_image_reference" as const;
export const SYNTX_REGISTER_FLUX_PUBLIC_LORA_TOOL_NAME = "syntx_register_flux_public_lora" as const;
export const SYNTX_OWNER_GENERATE_FLUX_IMAGE_TOOL_NAME = "syntx_owner_generate_flux_image" as const;
export const SYNTX_OWNER_RECONCILE_FLUX_IMAGE_TOOL_NAME = "syntx_owner_reconcile_flux_image" as const;
export const SYNTX_OWNER_LIST_FLUX_IMAGE_RECOVERIES_TOOL_NAME = "syntx_owner_list_flux_image_recoveries" as const;
export const OWNER_FLUX_IMAGE_TOOL_NAMES = Object.freeze([
  SYNTX_UPLOAD_FLUX_IMAGE_REFERENCE_TOOL_NAME, SYNTX_REGISTER_FLUX_PUBLIC_LORA_TOOL_NAME,
  SYNTX_OWNER_GENERATE_FLUX_IMAGE_TOOL_NAME, SYNTX_OWNER_RECONCILE_FLUX_IMAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_FLUX_IMAGE_RECOVERIES_TOOL_NAME
] as const);

export interface RegisterSyntxOwnerFluxImageToolsOptions {
  readonly uploadService: Pick<OwnerFluxImageUploadService, "upload">;
  readonly assetService: Pick<OwnerFluxImageAssetService, "registerPublicLora">;
  readonly generationService: Pick<OwnerFluxImageGenerationService, "generate" | "reconcile" | "listRecoveries">;
}

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const IMAGE = /^flux_image_[0-9a-f-]{36}$/u;
const LORA = /^flux_lora_[0-9a-f-]{36}$/u;
const RECOVERY = /^flux_image_recovery_[0-9a-f-]{36}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SOURCE_MIMES = OWNER_RUNWAY_FLUX_IMAGE_INPUT_POLICY.source_mime_types;
const CANONICAL_MIMES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
const MAX_IMAGE_BYTES = OWNER_RUNWAY_FLUX_IMAGE_INPUT_POLICY.max_local_bytes;
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const SAFE_FILENAME_DELIMITERS = /[<>:"/\\|?*]/u;
const RESERVED_WINDOWS_BASENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const RESOLUTIONS = {
  "flux-1": ["1344x768", "1216x832", "1152x896", "1280x1024", "1024x1024", "1024x1280", "896x1152", "832x1216", "768x1344"],
  "flux-pro-1.1": ["1152x896", "1280x1024"],
  "flux-pro-1.1-ultra": ["3136x1344", "2752x1536", "2368x1792", "2048x2048", "1792x2368", "1536x2752", "1344x3136"]
} as const;
const variants = OWNER_FLUX_IMAGE_MODELS;
const sourceId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const attemptSchema = z.string().regex(ATTEMPT).describe("Exact linked owner attempt identifier.");
const loraHandleSchema = z.string().regex(LORA).describe("Opaque public Civitai LoRA handle for this exact attempt.");
const imageHandleSchema = z.string().regex(IMAGE).describe("Opaque owner-uploaded Flux-1 image handle for this exact attempt.");
const recoverySchema = z.string().regex(RECOVERY).describe("Opaque Flux recovery handle for this exact attempt.");
const base64Schema = z.string().min(4).max(MAX_BASE64_CHARS).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);
const filenameSchema = z.string().min(1).max(255).refine(isSafeFilename, "Use a safe basename; paths are rejected.");
const promptSchema = z.string().min(1).max(65_536).refine(isValidPrompt, "Prompt must be nonblank and within the local input ceiling.");
const uploadInputSchema = z.object({ link_attempt_id: attemptSchema, content_base64: base64Schema,
  filename: filenameSchema, mime_type: z.enum(SOURCE_MIMES) }).strict();
const uploadOutputSchema = z.object({ status: z.literal("uploaded"), reference_handle: imageHandleSchema,
  model_id: z.literal("flux-1"), source_mime_type: z.enum(SOURCE_MIMES), mime_type: z.enum(CANONICAL_MIMES),
  width: z.number().int().positive().max(0xffff_ffff), height: z.number().int().positive().max(0xffff_ffff),
  size: z.number().int().positive().max(MAX_IMAGE_BYTES), sha256: z.string().regex(SHA256),
  expires_in_seconds: z.number().int().min(1).max(900), metadata_confidence: z.literal("CONTAINER_METADATA_ONLY"),
  size_limit_confidence: z.literal("LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT") }).strict();

const registerInputSchema = z.object({ link_attempt_id: attemptSchema, model_id_source: sourceId.optional(),
  model_version_id: sourceId, file_id: sourceId }).strict();
const registerOutputSchema = z.object({ status: z.literal("verified"), reference_handle: loraHandleSchema,
  model_id: z.literal("flux-1"), source_model_id: sourceId, model_version_id: sourceId, file_id: sourceId,
  size: z.number().int().positive().max(1_073_741_824), sha256: z.string().regex(SHA256),
  expires_in_seconds: z.number().int().min(1).max(900),
  content_confidence: z.literal("STREAMED_SHA256_AND_SAFETENSORS_STRUCTURE"), legal_approval: z.literal("NOT_ESTABLISHED"),
  license_compatibility: z.literal("UNPROVEN"), backend_acceptance: z.literal("UNPROVEN") }).strict();

const loraInputSchema = z.object({ handle: loraHandleSchema, strength_model: z.number().min(0).max(1.5),
  strength_clip: z.number().min(0).max(1.5) }).strict().superRefine((item, context) => {
  if (item.strength_clip !== item.strength_model) context.addIssue({ code: "custom", path: ["strength_clip"], message: "LoRA strengths must match." });
});
function parametersSchema(model: typeof variants[number]) {
  const maxLoras = model === "flux-1" ? 3 : 0;
  return z.object({ resolution: z.enum(RESOLUTIONS[model]), cfg: z.number().min(1).max(4), steps: z.number().min(10).max(28),
    image_strength: z.number().min(0).max(1), workflow_type: z.enum(["default", "civitai"]),
    raw: z.literal(model === "flux-pro-1.1-ultra" ? false : null), civitai_loras: z.array(loraInputSchema).max(maxLoras)
  }).strict().superRefine((value, context) => {
    const expected = value.civitai_loras.length > 0 ? "civitai" : "default";
    if (value.workflow_type !== expected) context.addIssue({ code: "custom", path: ["workflow_type"], message: "Workflow must match the explicit LoRA list." });
    if (new Set(value.civitai_loras.map((item) => item.handle)).size !== value.civitai_loras.length) {
      context.addIssue({ code: "custom", path: ["civitai_loras"], message: "LoRA handles must be unique and ordered." });
    }
  });
}
const generateInputSchema = z.object({ link_attempt_id: attemptSchema, model_id: z.enum(variants), prompt: promptSchema,
  image_reference_handle: imageHandleSchema.optional(), parameters: z.union([
    parametersSchema("flux-1"), parametersSchema("flux-pro-1.1"), parametersSchema("flux-pro-1.1-ultra")
  ]) }).strict().superRefine((input, context) => {
  const allowed = RESOLUTIONS[input.model_id] as readonly string[];
  if (!allowed.includes(input.parameters.resolution)) context.addIssue({ code: "custom", path: ["parameters", "resolution"], message: "Resolution is not source-supported for this model." });
  if (input.model_id !== "flux-1" && input.parameters.civitai_loras.length !== 0) {
    context.addIssue({ code: "custom", path: ["parameters", "civitai_loras"], message: "This model does not accept LoRA references." });
  }
  if (input.model_id !== "flux-1" && input.image_reference_handle !== undefined) {
    context.addIssue({ code: "custom", path: ["image_reference_handle"], message: "Only Flux-1 accepts an owned image reference." });
  }
  if (input.model_id === "flux-1" && input.parameters.raw !== null) {
    context.addIssue({ code: "custom", path: ["parameters", "raw"], message: "Flux-1 raw must be explicit null." });
  }
});
const reconcileInputSchema = z.object({ link_attempt_id: attemptSchema, recovery_id: recoverySchema }).strict();
const listInputSchema = z.object({ link_attempt_id: attemptSchema, limit: z.number().int().min(1).max(20).optional() }).strict();
const diagnosticSchema = z.object({ phase: z.enum(OWNER_FLUX_IMAGE_GENERATION_PHASES), post_started: z.boolean(), echo_ack_known: z.boolean(),
  history_binding: z.enum(["NONE", "PENDING", "READY", "INVALID"]),
  history_binding_reason: z.enum(OWNER_FLUX_IMAGE_GENERATION_HISTORY_REASONS).nullable(),
  history_get_calls: z.number().int().min(0).max(255), history_get_calls_saturated: z.boolean(),
  result_get_calls: z.number().int().min(0).max(255), result_get_calls_saturated: z.boolean(),
  result_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "UNVERIFIED"]),
  result_reason: z.enum(OWNER_FLUX_IMAGE_GENERATION_RESULT_REASONS).nullable() }).strict();
const inputReferenceSchema = z.object({ mime_type: z.enum(CANONICAL_MIMES), width: z.number().int().positive().max(0xffff_ffff).nullable(),
  height: z.number().int().positive().max(0xffff_ffff).nullable(), size: z.number().int().positive().max(MAX_IMAGE_BYTES),
  sha256: z.string().regex(SHA256), metadata_confidence: z.literal("CONTAINER_METADATA_ONLY") }).strict();
const loraAssetSchema = z.object({ provenance: z.literal("public_civitai_verified"),
  size: z.number().int().positive().max(1_073_741_824), sha256: z.string().regex(SHA256),
  strength_model: z.number().min(0).max(1.5), strength_clip: z.number().min(0).max(1.5) }).strict();
const parametersOutputSchema = z.object({ resolution: z.enum([...new Set(Object.values(RESOLUTIONS).flat())] as [string, ...string[]]),
  cfg: z.number().min(1).max(4), steps: z.number().min(10).max(28), image_strength: z.number().min(0).max(1),
  workflow_type: z.enum(["default", "civitai"]), raw: z.union([z.literal(false), z.null()]), lora_count: z.number().int().min(0).max(3) }).strict();
const artifactSchema = z.object({ url: z.string().url().max(4096).refine(isSafeUploadReferenceUrl),
  mime_type: z.enum(CANONICAL_MIMES).nullable(), mime_source: z.enum(["URL_EXTENSION", "UNKNOWN"]),
  width: z.null(), height: z.null(), geometry_verified: z.literal(false) }).strict();
const generationOutputSchema = z.object({ status: z.literal("result_observed"), namespace_confidence: z.literal("SOURCE_SHAPED_UNVERIFIED"),
  backend_acceptance: z.literal("UNPROVEN"), ai_name: z.literal("flux"), model_id: z.enum(variants), variant: z.enum(variants),
  operation_id: z.literal("generate-image"), profile_id: z.string().min(1).max(160), profile_schema_hash: z.string().regex(SHA256),
  catalog_version: z.string().min(1).max(160), request_fingerprint: z.string().regex(SHA256), parameters: parametersOutputSchema,
  cost_inputs: z.object({}).strict(), cost_input_confidence: z.literal("NO_SOURCE_COST_INPUTS_QUOTE_AND_BILLING_UNPROVEN"), reference_count: z.number().int().min(0).max(1),
  input_references: z.array(inputReferenceSchema).max(1), lora_assets: z.array(loraAssetSchema).max(3),
  actual_image: z.object({ mime_type: z.enum(CANONICAL_MIMES).nullable(), width: z.null(), height: z.null() }).strict(),
  geometry_verified: z.literal(false), artifact: artifactSchema, legal_approval: z.literal("NOT_ESTABLISHED"),
  license_compatibility: z.literal("UNPROVEN") }).strict().superRefine((value, context) => {
  if (value.model_id !== value.variant || value.reference_count !== value.input_references.length ||
      !(RESOLUTIONS[value.variant] as readonly string[]).includes(value.parameters.resolution) ||
      value.parameters.lora_count !== value.lora_assets.length || value.parameters.workflow_type !== (value.lora_assets.length ? "civitai" : "default") ||
      (value.variant === "flux-pro-1.1-ultra" ? value.parameters.raw !== false : value.parameters.raw !== null) ||
      (value.variant !== "flux-1" && (value.reference_count !== 0 || value.lora_assets.length !== 0))) {
    context.addIssue({ code: "custom", path: ["parameters"], message: "Result metadata must match the exact source-bound variant and asset set." });
  }
  if (value.actual_image.mime_type !== value.artifact.mime_type || ((value.artifact.mime_type === null) !== (value.artifact.mime_source === "UNKNOWN"))) {
    context.addIssue({ code: "custom", path: ["actual_image", "mime_type"], message: "Image MIME evidence must match the artifact." });
  }
});
const recoveryOutputSchema = z.object({ recoveries: z.array(z.object({ recovery_id: recoverySchema, created_at: z.iso.datetime(),
  model_id: z.enum(variants), operation_id: z.literal("generate-image"), status: z.literal("OUTCOME_UNKNOWN"), diagnostic: diagnosticSchema }).strict()).max(20) }).strict();

export const OWNER_FLUX_IMAGE_TOOL_INPUT_SCHEMAS = Object.freeze({ upload: uploadInputSchema, register_public_lora: registerInputSchema,
  generate: generateInputSchema, reconcile: reconcileInputSchema, list_recoveries: listInputSchema });
export const OWNER_FLUX_IMAGE_TOOL_OUTPUT_SCHEMAS = Object.freeze({ upload: uploadOutputSchema, register_public_lora: registerOutputSchema,
  generate: generationOutputSchema, reconcile: generationOutputSchema, list_recoveries: recoveryOutputSchema });

export function registerSyntxOwnerFluxImageTools(server: McpServer, options: RegisterSyntxOwnerFluxImageToolsOptions): void {
  server.registerTool(SYNTX_UPLOAD_FLUX_IMAGE_REFERENCE_TOOL_NAME, { title: "Upload an owned Flux-1 image reference",
    description: "Upload one source-validated image for the exact linked owner attempt. Local size and metadata checks do not establish provider acceptance.",
    inputSchema: OWNER_FLUX_IMAGE_TOOL_INPUT_SCHEMAS.upload, outputSchema: OWNER_FLUX_IMAGE_TOOL_OUTPUT_SCHEMAS.upload,
    annotations: annotations("Upload Flux image reference", false, true, false, true) }, async (input, { signal }) => {
    const parsed = uploadInputSchema.safeParse(input); if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST");
    try { const receipt = await options.uploadService.upload({ attemptId: parsed.data.link_attempt_id, model_id: "flux-1",
      content_base64: parsed.data.content_base64, filename: parsed.data.filename, mime_type: parsed.data.mime_type,
      ...(signal === undefined ? {} : { signal }) }); return structured(uploadOutputSchema.parse(receipt)); }
    catch (error) { return errorResult(error, "UPLOAD_FAILED"); }
  });
  server.registerTool(SYNTX_REGISTER_FLUX_PUBLIC_LORA_TOOL_NAME, { title: "Register a selected public Flux LoRA",
    description: "Verifies one selected public Civitai file and returns an attempt-bound handle. No URL, credential, license, or provider acceptance is inferred.",
    inputSchema: OWNER_FLUX_IMAGE_TOOL_INPUT_SCHEMAS.register_public_lora, outputSchema: OWNER_FLUX_IMAGE_TOOL_OUTPUT_SCHEMAS.register_public_lora,
    annotations: annotations("Register public Flux LoRA", false, false, false, true) }, async (input, { signal }) => {
    const parsed = registerInputSchema.safeParse(input); if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST");
    try { const receipt = await options.assetService.registerPublicLora({ attemptId: parsed.data.link_attempt_id, model_id: "flux-1",
      ...(parsed.data.model_id_source === undefined ? {} : { model_id_source: parsed.data.model_id_source }),
      model_version_id: parsed.data.model_version_id, file_id: parsed.data.file_id,
      ...(signal === undefined ? {} : { signal }) }); return structured(registerOutputSchema.parse(receipt)); }
    catch (error) { return errorResult(error, "REGISTRATION_FAILED"); }
  });
  server.registerTool(SYNTX_OWNER_GENERATE_FLUX_IMAGE_TOOL_NAME, { title: "Generate a Flux image",
    description: "Starts one generation only after source-bound assets and fresh preflights. If outcome is uncertain, do not repeat; reconcile with the same recovery handle.",
    inputSchema: OWNER_FLUX_IMAGE_TOOL_INPUT_SCHEMAS.generate, outputSchema: OWNER_FLUX_IMAGE_TOOL_OUTPUT_SCHEMAS.generate,
    annotations: annotations("Generate Flux image", false, true, false, true) }, async (input, { signal }) => {
    const parsed = generateInputSchema.safeParse(input); if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST");
    try { const result = await options.generationService.generate({ attemptId: parsed.data.link_attempt_id, model_id: parsed.data.model_id,
      prompt: parsed.data.prompt, ...(parsed.data.model_id === "flux-1" && parsed.data.image_reference_handle !== undefined
        ? { image_reference_handle: parsed.data.image_reference_handle } : {}), parameters: parsed.data.parameters }, signal);
      return structured(generationOutputSchema.parse(result)); }
    catch (error) { return errorResult(error, "GENERATION_FAILED"); }
  });
  server.registerTool(SYNTX_OWNER_RECONCILE_FLUX_IMAGE_TOOL_NAME, { title: "Reconcile a Flux image generation",
    description: "Read-only GET-only reconciliation for the exact attempt and opaque recovery handle; never starts another generation.",
    inputSchema: OWNER_FLUX_IMAGE_TOOL_INPUT_SCHEMAS.reconcile, outputSchema: OWNER_FLUX_IMAGE_TOOL_OUTPUT_SCHEMAS.reconcile,
    annotations: annotations("Reconcile Flux image generation", true, false, true, true) }, async (input, { signal }) => {
    const parsed = reconcileInputSchema.safeParse(input); if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST");
    try { return structured(generationOutputSchema.parse(await options.generationService.reconcile({ attemptId: parsed.data.link_attempt_id,
      recovery_id: parsed.data.recovery_id }, signal))); } catch (error) { return errorResult(error, "GENERATION_FAILED"); }
  });
  server.registerTool(SYNTX_OWNER_LIST_FLUX_IMAGE_RECOVERIES_TOOL_NAME, { title: "List Flux image recovery handles",
    description: "Lists bounded process-local recovery metadata for the exact attempt; prompt, artifact URLs, and principal details are not returned.",
    inputSchema: OWNER_FLUX_IMAGE_TOOL_INPUT_SCHEMAS.list_recoveries, outputSchema: OWNER_FLUX_IMAGE_TOOL_OUTPUT_SCHEMAS.list_recoveries,
    annotations: annotations("List Flux image recoveries", true, false, true, false) }, async (input) => {
    const parsed = listInputSchema.safeParse(input); if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST");
    try { const recoveries = await options.generationService.listRecoveries({ attemptId: parsed.data.link_attempt_id, limit: parsed.data.limit });
      return structured(recoveryOutputSchema.parse({ recoveries })); } catch (error) { return errorResult(error, "RECOVERY_LIST_UNAVAILABLE"); }
  });
}

function annotations(title: string, readOnly: boolean, destructive: boolean, idempotent: boolean, openWorld: boolean) {
  return { title, readOnlyHint: readOnly, destructiveHint: destructive, idempotentHint: idempotent, openWorldHint: openWorld };
}
function structured(value: object): CallToolResult { return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> }; }
function errorResult(error: unknown, fallback: string): CallToolResult {
  const uploadCodes = ["INVALID_REQUEST", "INVALID_IMAGE_INPUT", "LOCAL_RESOURCE_LIMIT_EXCEEDED", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH",
    "SERVICE_BUSY", "CAPACITY_EXCEEDED", "SERVICE_CLOSED", "REQUEST_ABORTED", "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED", "UPLOAD_REJECTED", "UPLOAD_OUTCOME_UNKNOWN"];
  const assetCodes = ["SOURCE_MISMATCH", "ATTESTATION_FAILED", "CLOCK_INVALID"];
  let code = fallback, recovery_id: string | undefined, diagnostic: unknown;
  if (error instanceof OwnerFluxImageUploadServiceError && uploadCodes.includes(error.code)) code = error.code;
  else if (error instanceof OwnerFluxImageAssetServiceError && [...uploadCodes, ...assetCodes].includes(error.code)) code = error.code;
  else if (error instanceof OwnerFluxImageGenerationServiceError && (OWNER_FLUX_IMAGE_GENERATION_ERROR_CODES as readonly string[]).includes(error.code)) {
    code = error.code;
    if (error.code === "OUTCOME_UNKNOWN") {
      if (typeof error.recovery_id === "string" && RECOVERY.test(error.recovery_id)) recovery_id = error.recovery_id;
      const safe = diagnosticSchema.safeParse(error.diagnostic); if (safe.success) diagnostic = safe.data;
    }
  } else if (error instanceof OwnerReferencePrincipalError && ["REFERENCE_PRINCIPAL_NOT_LINKED", "REFERENCE_PRINCIPAL_INVALID"].includes(error.code)) code = error.code;
  const messages: Record<string, string> = {
    INVALID_REQUEST: "The owner Flux image request is invalid.", INVALID_IMAGE_INPUT: "Provide a supported image with matching MIME and valid container metadata.",
    LOCAL_RESOURCE_LIMIT_EXCEEDED: "The image exceeds the local resource ceiling.", PRINCIPAL_NOT_LINKED: "The exact owner attempt is not linked.",
    REFERENCE_PRINCIPAL_NOT_LINKED: "The exact owner attempt is not linked.", REFERENCE_PRINCIPAL_INVALID: "The exact owner attempt is not linked.",
    MODEL_BINDING_MISMATCH: "The selected Flux model is unavailable in the pinned source catalog.",
    SERVICE_BUSY: "The owner Flux image service is at its safe concurrency limit; no automatic retry was performed.",
    CAPACITY_EXCEEDED: "The bounded owner Flux image service capacity is full.", SERVICE_CLOSED: "The owner Flux image service is closed.",
    REQUEST_ABORTED: "The operation was aborted; inspect its exact outcome before retrying.",
    REFERENCE_UNAVAILABLE: "A reference handle is unavailable for this exact attempt and model.", REFERENCE_EXPIRED: "A reference handle expired or is no longer available.",
    SOURCE_MISMATCH: "The selected public Civitai model/version/file does not match the source record.",
    ATTESTATION_FAILED: "The selected public Civitai file could not be verified safely.", CLOCK_INVALID: "The owner Flux image service clock is unavailable.",
    REFERENCE_ALREADY_CLAIMED: "This semantic generation intent is already claimed; expiry does not permit replay.",
    PREFLIGHT_FAILED: "Fresh subscription or model-access checks did not pass.", PRE_DISPATCH_FAILED: "Generation failed before dispatch.",
    OUTCOME_UNKNOWN: "Generation may have been dispatched; do not retry. Reconcile only with the same recovery handle.",
    RECOVERY_NOT_FOUND: "No matching process-local recovery record is available for this attempt.",
    UPLOAD_REJECTED: "The reference upload was rejected before a handle was issued.", UPLOAD_OUTCOME_UNKNOWN: "Upload outcome is unknown; do not repeat automatically.",
    UPLOAD_FAILED: "The Flux image upload failed safely.", REGISTRATION_FAILED: "The selected public Flux LoRA could not be verified safely.",
    GENERATION_FAILED: "Generation could not be confirmed; do not repeat a call that may have dispatched.",
    RECOVERY_LIST_UNAVAILABLE: "Flux image recovery handles are unavailable."
  };
  const known = new Set([...OWNER_FLUX_IMAGE_GENERATION_ERROR_CODES, ...uploadCodes, ...assetCodes,
    "REFERENCE_PRINCIPAL_NOT_LINKED", "REFERENCE_PRINCIPAL_INVALID", "UPLOAD_FAILED", "REGISTRATION_FAILED", "GENERATION_FAILED", "RECOVERY_LIST_UNAVAILABLE"]);
  const safeCode = known.has(code) ? code : fallback;
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code: safeCode,
    message: messages[safeCode] ?? "The owner Flux image operation failed safely.",
    ...(recovery_id === undefined ? {} : { recovery_id }), ...(diagnostic === undefined ? {} : { diagnostic }) } }) }] };
}
function isSafeFilename(value: string): boolean {
  if (value.length === 0 || value === "." || value === ".." || value !== value.trimEnd() || value.endsWith(".") ||
      /\p{Cc}/u.test(value) || SAFE_FILENAME_DELIMITERS.test(value) || RESERVED_WINDOWS_BASENAME.test(value)) return false;
  for (let i = 0; i < value.length; i++) { const c = value.charCodeAt(i); if (c >= 0xd800 && c <= 0xdbff) { const n = value.charCodeAt(i + 1); if (n < 0xdc00 || n > 0xdfff) return false; i++; }
    else if (c >= 0xdc00 && c <= 0xdfff) return false; }
  return Buffer.byteLength(value, "utf8") <= 255;
}
function isValidPrompt(value: string): boolean { if (value.trim().length === 0 || Buffer.byteLength(value, "utf8") > 65_536 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) return false;
  for (let i = 0; i < value.length; i++) { const c = value.charCodeAt(i); if (c >= 0xd800 && c <= 0xdbff) { const n = value.charCodeAt(i + 1); if (n < 0xdc00 || n > 0xdfff) return false; i++; }
    else if (c >= 0xdc00 && c <= 0xdfff) return false; } return true; }
