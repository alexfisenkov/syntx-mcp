import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { OwnerReferencePrincipalError } from "../auth/owner-reference-principal.js";
import {
  OwnerGrokImageReferenceLifecycleError,
  OWNER_GROK_UNKNOWN_DIAGNOSTIC_PHASES,
  OWNER_GROK_UNKNOWN_HISTORY_MATCHES,
  OWNER_GROK_UNKNOWN_UPSTREAM_ERROR_CODES
} from "../application/owner-grok-image-reference-lifecycle.js";
import { OwnerGrokImageReferenceOneShotPolicyError } from "../application/owner-grok-image-reference-one-shot-policy.js";
import { OwnerGrokImageReferencePrepareError } from "../application/owner-grok-image-reference-request-preparer.js";
import {
  OwnerGrokImageReferenceService,
  OwnerGrokImageReferenceServiceError
} from "../application/owner-grok-image-reference-service.js";
import { OwnerGrokImageReferenceUploadError } from "../application/owner-grok-image-reference-upload-service.js";
import { OwnerMediaReferenceStoreError } from "../application/owner-media-reference-store.js";

export const SYNTX_GET_GROK_REFERENCE_SCHEMA_TOOL_NAME = "syntx_get_grok_reference_schema" as const;
export const SYNTX_VALIDATE_GROK_REFERENCE_TOOL_NAME = "syntx_validate_grok_reference" as const;
export const SYNTX_UPLOAD_GROK_IMAGE_REFERENCE_TOOL_NAME = "syntx_upload_grok_image_reference" as const;
export const SYNTX_OWNER_GENERATE_GROK_REFERENCE_TOOL_NAME = "syntx_owner_generate_grok_reference" as const;
export const SYNTX_OWNER_RECONCILE_GROK_REFERENCE_TOOL_NAME = "syntx_owner_reconcile_grok_reference" as const;
export const SYNTX_OWNER_LIST_GROK_REFERENCE_RECOVERY_TOOL_NAME = "syntx_owner_list_grok_reference_recovery" as const;

const PROFILE_IDS = [
  "grok-i2i-reference-one-source-reviewed",
  "grok-i2i-reference-multi-source-reviewed",
  "grok-i2i-pro-reference-one-source-reviewed"
] as const;
const profileIdSchema = z.enum(PROFILE_IDS).describe("Exact source-reviewed profile ID; model aliases are not accepted.");
const modelIdSchema = z.enum(["grok_i2i", "grok_i2i_pro"]);
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const catalogVersionSchema = z.string().min(1).max(200);
const attemptIdSchema = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u)
  .describe("Exact linked attempt ID returned by the owner account-link flow; it is not a model or account alias.");
const referenceHandleSchema = z.string().regex(/^reference_[0-9a-f-]{36}$/u)
  .describe("Opaque owner-issued image reference handle; URLs, paths, and upstream file IDs are not accepted.");
const recoveryIdSchema = z.string().regex(/^recovery_[0-9a-f-]{36}$/u)
  .describe("Opaque recovery ID returned for the exact generation attempt; do not guess or substitute one.");
const resolutionSchema = z.enum(["1k", "2k"]).describe("Explicit source-reviewed resolution choice; no default is assumed.");
const batchSizeSchema = z.number().int().min(1).max(5).describe("Explicit requested batch size from 1 through 5.");
const aspectRatioSchema = z.enum(["1:1", "1:2", "2:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"])
  .describe("Source-reviewed ratio choice; required or forbidden depending on the selected profile and handle count.");
const promptSchema = z.string().trim().min(1).max(5000)
  .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/u)
  .describe("Prompt text for this one request, up to 5000 characters.");
const parametersSchema = z.object({
  prompt: promptSchema,
  resolution: resolutionSchema,
  batch_size: batchSizeSchema,
  aspect_ratio: aspectRatioSchema.optional()
}).strict().describe("Closed, explicit request choices. The selected source-reviewed profile enforces conditional aspect-ratio rules.");
const referenceHandlesSchema = z.array(referenceHandleSchema).min(1).max(3)
  .refine((handles) => new Set(handles).size === handles.length, "Reference handles must be distinct.")
  .describe("One to three distinct owner-issued opaque handles in the intended image order; profile-specific bounds still apply.");
const unknownDiagnosticSchema = z.object({
  phase: z.enum(OWNER_GROK_UNKNOWN_DIAGNOSTIC_PHASES),
  echo_ack_known: z.boolean(),
  history_get_eligible: z.boolean(),
  history_get_performed: z.boolean(),
  history_get_count: z.number().int().min(0).max(255),
  history_get_count_capped: z.boolean(),
  history_match: z.enum(OWNER_GROK_UNKNOWN_HISTORY_MATCHES),
  result_get_performed: z.boolean(),
  result_get_count: z.number().int().min(0).max(255),
  result_get_count_capped: z.boolean(),
  result_binding_known: z.boolean(),
  upstream_error_code: z.enum(OWNER_GROK_UNKNOWN_UPSTREAM_ERROR_CODES).nullable()
}).strict();
const profileListSchema = z.object({
  recoveries: z.array(z.object({
    recovery_id: recoveryIdSchema,
    model_id: modelIdSchema,
    profile_id: profileIdSchema,
    created_at: z.iso.datetime(),
    requested_batch_size: batchSizeSchema,
    diagnostic: unknownDiagnosticSchema
  }).strict()).max(20),
  confidence_scope: z.literal("process_local_get_only_recovery"),
  expires_in_seconds: z.literal(900)
}).strict();

const profileSchemaOutputSchema = z.object({
  profile_id: profileIdSchema,
  schema_hash: sha256Schema,
  profile_set_sha256: sha256Schema,
  catalog_version: catalogVersionSchema,
  model_id: modelIdSchema,
  variant_id: profileIdSchema,
  operation_id: z.literal("generate-image"),
  dispatch_allowed: z.literal(false),
  backend_acceptance: z.literal("unproven"),
  prompt: z.object({ required: z.literal(true), min_length: z.literal(1), max_length: z.literal(5000) }).strict(),
  reference_count: z.object({ minimum: z.number().int().min(1).max(3), maximum: z.number().int().min(1).max(3) }).strict(),
  resolution: z.object({ required: z.literal(true), values: z.tuple([resolutionSchema, resolutionSchema]) }).strict(),
  batch_size: z.object({ required: z.literal(true), values: z.tuple([
    z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)
  ]) }).strict(),
  aspect_ratio: z.object({ required: z.boolean(), values: z.array(aspectRatioSchema).max(9) }).strict(),
  fixed_settings: z.object({ n: z.literal(1) }).strict(),
  output_policy: z.object({
    client_mime_allowlist: z.tuple([z.literal("image/jpeg"), z.literal("image/png")]),
    provider_mime_behavior: z.literal("unproven"),
    batch_result_count_relation: z.literal("unproven"),
    maximum_returned_artifacts: z.literal(5)
  }).strict()
}).strict();

const validationOutputSchema = z.object({
  profile_id: profileIdSchema,
  schema_hash: sha256Schema,
  profile_set_sha256: sha256Schema,
  catalog_version: catalogVersionSchema,
  model_id: modelIdSchema,
  reference_count: z.number().int().min(1).max(3),
  dispatch_allowed: z.literal(false),
  backend_acceptance: z.literal("unproven"),
  request: z.object({ prompt: promptSchema, settings: z.object({
    n: z.literal(1), model_type: modelIdSchema, resolution: resolutionSchema, batch_size: batchSizeSchema,
    aspect_ratio: aspectRatioSchema.optional()
  }).strict() }).strict()
}).strict();

const uploadOutputSchema = z.object({
  status: z.literal("accepted"),
  reference_handle: referenceHandleSchema,
  mime_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
  mime_type_source: z.literal("request_declared"),
  size: z.number().int().min(1).max(7 * 1024 * 1024),
  size_source: z.literal("request_bytes"),
  profile_id: profileIdSchema,
  model_id: modelIdSchema,
  expires_in_seconds: z.literal(900),
  image: z.object({
    mime_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
    width: z.number().int().min(1).max(8400),
    height: z.number().int().min(1).max(8400),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    byte_length: z.number().int().min(1).max(7 * 1024 * 1024)
  }).strict(),
  confidence_scope: z.literal("input_bytes_sniffed_and_dimensions_checked")
}).strict();

const generationOutputSchema = z.object({
  status: z.literal("result_observed"),
  backend_acceptance: z.literal("unproven"),
  profile_schema_hash: sha256Schema,
  profile_set_sha256: sha256Schema,
  request_fingerprint: sha256Schema,
  model_id: modelIdSchema,
  profile_id: profileIdSchema,
  variant_id: profileIdSchema,
  requested_batch_size: batchSizeSchema,
  actual_result_count: z.number().int().min(1).max(5),
  batch_count_matches_requested: z.literal(true),
  mime_confidence: z.literal("URL_EXTENSION_ONLY"),
  artifacts: z.array(z.object({
    url: z.string().url(),
    mime_type: z.enum(["image/jpeg", "image/png"]),
    mime_source: z.literal("URL_EXTENSION"),
    message_object_id: z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._~-]*$/u)
  }).strict()).min(1).max(5)
}).strict();

export interface RegisterSyntxOwnerGrokImageReferenceToolsOptions {
  readonly service: Pick<OwnerGrokImageReferenceService,
    "getSchema" | "validate" | "upload" | "generate" | "reconcile" | "listRecoveries">;
}

/** Register six explicit owner-scoped Grok reference tools on an opted-in server only. */
export function registerSyntxOwnerGrokImageReferenceTools(
  server: McpServer,
  options: RegisterSyntxOwnerGrokImageReferenceToolsOptions
): void {
  const service = options.service;
  server.registerTool(SYNTX_GET_GROK_REFERENCE_SCHEMA_TOOL_NAME, {
    title: "Get Grok reference profile",
    description: "Read a source-reviewed Grok image-reference profile and its finite explicit choices. The profiles are candidates only: backend acceptance, effective defaults, result count per batch, and provider MIME behavior remain unproven. This tool performs no account check or provider request.",
    inputSchema: z.object({ profile_id: profileIdSchema }).strict(),
    outputSchema: profileSchemaOutputSchema,
    annotations: { title: "Get Grok reference profile", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ profile_id }): Promise<CallToolResult> => {
    try { return success(profileSchemaOutputSchema.parse(service.getSchema(profile_id))); }
    catch (error) { return errorResult(error, "PROFILE_INVALID"); }
  });

  server.registerTool(SYNTX_VALIDATE_GROK_REFERENCE_TOOL_NAME, {
    title: "Validate Grok reference request",
    description: "Validate one source-reviewed Grok profile, reference count, prompt, resolution, batch size, and conditional aspect ratio locally. The server enforces profile-specific reference/ratio rules. No account check, upload, provider request, or generation occurs; a valid result does not prove backend acceptance.",
    inputSchema: z.object({
      profile_id: profileIdSchema,
      reference_count: z.number().int().min(1).max(3).describe("Number of distinct source handles planned for this request; the selected profile enforces its exact range."),
      parameters: parametersSchema
    }).strict(),
    outputSchema: validationOutputSchema,
    annotations: { title: "Validate Grok reference request", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ profile_id, reference_count, parameters }): Promise<CallToolResult> => {
    try { return success(validationOutputSchema.parse(service.validate(profile_id, parameters, reference_count))); }
    catch (error) { return errorResult(error, "INVALID_REQUEST"); }
  });

  server.registerTool(SYNTX_UPLOAD_GROK_IMAGE_REFERENCE_TOOL_NAME, {
    title: "Upload a Grok image reference",
    description: "Upload one image for a source-reviewed Grok profile to the owner-authorized SYNTX account and receive an opaque, attempt/profile-bound handle valid for 15 minutes. Input signatures and dimensions are checked locally; this does not establish that Grok accepts this format as a reference. The remote hidden upload may change provider state; there is no remote deletion or retention guarantee.",
    inputSchema: z.object({
      profile_id: profileIdSchema,
      link_attempt_id: attemptIdSchema,
      content_base64: z.string().min(4).max(9_786_712).describe("Portable base64-encoded image bytes; no filesystem path or remote URL."),
      filename: z.string().min(1).max(128).regex(/^[^/\\\u0000-\u001f\u007f]+$/u)
        .describe("Safe display filename without directory separators or control characters."),
      mime_type: z.enum(["image/jpeg", "image/png", "image/webp"]).describe("Declared input MIME; local byte-signature validation must match it.")
    }).strict(),
    outputSchema: uploadOutputSchema,
    annotations: { title: "Upload a Grok image reference", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const { link_attempt_id, ...request } = input;
      return success(uploadOutputSchema.parse(await service.upload({ ...request, attemptId: link_attempt_id }, signal)));
    }
    catch (error) { return errorResult(error, "IMAGE_REFERENCE_UPLOAD_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_GROK_REFERENCE_TOOL_NAME, {
    title: "Generate an image using Grok references",
    description: "This invokes a REAL, potentially billed Grok image generation. There is no spending cap or separate approval step in this tool. Use only a source-reviewed profile, owned opaque handles, and explicit settings; source review is not backend acceptance. If the result is unknown, do not call again: use GET-only reconciliation with the returned recovery id. Recovery is process-local for 15 minutes and not restart-safe. If the HTTP response is lost before a recovery id is returned, the current lifecycle has no echo-based recovery. Returned count is observed for this result only; provider batch-count mapping is unproven. MIME is classified from URL extension, not content bytes.",
    inputSchema: z.object({
      profile_id: profileIdSchema,
      link_attempt_id: attemptIdSchema,
      reference_handles: referenceHandlesSchema,
      parameters: parametersSchema
    }).strict(),
    outputSchema: generationOutputSchema,
    annotations: { title: "Generate an image using Grok references", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const { link_attempt_id, ...request } = input;
      return success(generationOutputSchema.parse(await service.generate({ ...request, attemptId: link_attempt_id }, signal)));
    }
    catch (error) { return errorResult(error, "REFERENCE_GENERATION_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_GROK_REFERENCE_TOOL_NAME, {
    title: "Reconcile a Grok reference generation",
    description: "GET-only reconciliation of one known opaque recovery id for the exact linked attempt and source-reviewed profile. It does not upload, create a chat, dispatch generation, retry, cancel, or delete. Recovery lasts 15 minutes in process memory and is not restart-safe; if the original HTTP response lost the recovery id, this tool cannot discover it.",
    inputSchema: z.object({ profile_id: profileIdSchema, link_attempt_id: attemptIdSchema, recovery_id: recoveryIdSchema }).strict(),
    outputSchema: generationOutputSchema,
    annotations: { title: "Reconcile a Grok reference generation", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const { link_attempt_id, ...request } = input;
      return success(generationOutputSchema.parse(await service.reconcile({ ...request, attemptId: link_attempt_id }, signal)));
    }
    catch (error) { return errorResult(error, "OUTCOME_UNKNOWN"); }
  });

  server.registerTool(SYNTX_OWNER_LIST_GROK_REFERENCE_RECOVERY_TOOL_NAME, {
    title: "List Grok reference recovery handles",
    description: "List recent process-local recovery metadata for the exact linked attempt and source-reviewed profile; the profile does not establish backend acceptance. This reads local memory after checking the current link; it does not fetch provider messages, upload, or generate. Records expire after 15 minutes and do not survive restart.",
    inputSchema: z.object({ profile_id: profileIdSchema, link_attempt_id: attemptIdSchema,
      limit: z.number().int().min(1).max(20).default(20).describe("Maximum number of recent matching local recoveries to list, from 1 through 20.") }).strict(),
    outputSchema: profileListSchema,
    annotations: { title: "List Grok reference recovery handles", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input): Promise<CallToolResult> => {
    try {
      const { link_attempt_id, ...request } = input;
      const recoveries = await service.listRecoveries({ ...request, attemptId: link_attempt_id });
      return success(profileListSchema.parse({ recoveries, confidence_scope: "process_local_get_only_recovery", expires_in_seconds: 900 }));
    } catch (error) { return errorResult(error, "RECOVERY_LIST_UNAVAILABLE"); }
  });
}

function success(value: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

function errorResult(error: unknown, fallback: string): CallToolResult {
  const code = error instanceof OwnerGrokImageReferenceServiceError || error instanceof OwnerGrokImageReferenceLifecycleError ||
    error instanceof OwnerGrokImageReferenceUploadError || error instanceof OwnerGrokImageReferencePrepareError ||
    error instanceof OwnerGrokImageReferenceOneShotPolicyError || error instanceof OwnerMediaReferenceStoreError ||
    error instanceof OwnerReferencePrincipalError ? error.code : fallback;
  const recoveryId = error instanceof OwnerGrokImageReferenceLifecycleError && error.code === "OUTCOME_UNKNOWN" &&
    typeof error.recovery_id === "string" && /^recovery_[0-9a-f-]{36}$/u.test(error.recovery_id) ? error.recovery_id : undefined;
  const diagnostic = error instanceof OwnerGrokImageReferenceLifecycleError && error.code === "OUTCOME_UNKNOWN" && error.diagnostic
    ? unknownDiagnosticSchema.safeParse(error.diagnostic).data : undefined;
  const messages: Record<string, string> = {
    INVALID_REQUEST: "The request does not match a supported Grok reference profile.",
    PROFILE_INVALID: "The source-reviewed Grok profile is unavailable.",
    PROFILE_SET_INVALID: "The source-reviewed Grok profile set is unavailable.",
    SERVICE_CLOSED: "The owner Grok reference service is closed.",
    SERVICE_BUSY: "The owner Grok reference service is at its safe concurrency limit.",
    PRINCIPAL_NOT_LINKED: "The exact SYNTX account attempt is not linked.",
    REFERENCE_PRINCIPAL_NOT_LINKED: "The exact SYNTX account attempt is not linked.",
    REFERENCE_PRINCIPAL_INVALID: "The owner account binding is invalid for this operation.",
    REFERENCE_UNAVAILABLE: "One or more references are unavailable for this exact attempt and profile.",
    PREFLIGHT_FAILED: "Required account, access, or cost preflight did not pass.",
    INVALID_IMAGE_INPUT: "The image bytes, declared MIME type, filename, or dimensions are invalid.",
    UPLOAD_RECEIPT_INVALID: "The hidden upload did not return one attributable reference.",
    REFERENCE_UPLOAD_OUTCOME_UNKNOWN: "The upload outcome is unknown; do not upload again automatically.",
    REFERENCE_UPLOAD_REJECTED: "The image upload was rejected before a handle was issued.",
    OUTCOME_UNKNOWN: "Generation may have been dispatched; do not retry. Reconcile only with the known recovery id.",
    PRE_DISPATCH_FAILED: "The request was rejected before generation dispatch.",
    RECOVERY_NOT_FOUND: "No matching process-local recovery record is available for this attempt and profile.",
    PERMIT_EXPIRED: "The local one-shot generation permit expired.",
    PERMIT_INVALID: "The local one-shot generation permit is invalid.",
    PERMIT_ALREADY_CONSUMED: "The local one-shot generation permit has already been consumed."
  };
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: {
    code,
    message: messages[code] ?? "The owner Grok reference operation failed safely.",
    ...(recoveryId === undefined ? {} : { recovery_id: recoveryId }),
    ...(diagnostic === undefined ? {} : { diagnostic })
  } }) }] };
}
