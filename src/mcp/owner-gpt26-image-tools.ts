import { z } from "zod/v4";
import { isCanonicalBase64 } from "../application/canonical-base64.js";
import { OWNER_GPT26_IMAGE_SOURCE_CONTROLS, OWNER_GPT26_IMAGE_VARIANTS,
  normalizeOwnerGpt26ImageParameters } from "../application/owner-gpt26-image-parameters.js";
import { OWNER_GPT26_PUBLIC_CATALOG_VERSION } from "../application/owner-gpt26-image-source-profile.js";
import type { OwnerStandardImageUploadService } from "../application/owner-standard-image-upload-service.js";
import type { OwnerStandardImageGenerationService } from "../application/owner-standard-image-generation-service.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CHATGPT_IMAGE_FILE_SCHEMA, CHATGPT_IMAGE_FILE_TOOL_META,
  resolveChatgptImageUploadInput, type ChatgptImageFileResolver } from "./chatgpt-image-file-input.js";
import { errorResult, safeImageResult, safeStructured } from "./owner-standard-image-tools.js";

export const SYNTX_UPLOAD_GPT26_IMAGE_REFERENCE_TOOL_NAME = "syntx_upload_gpt26_image_reference" as const;
export const SYNTX_OWNER_GENERATE_GPT26_IMAGE_TOOL_NAME = "syntx_owner_generate_gpt26_image" as const;
export const SYNTX_OWNER_RECONCILE_GPT26_IMAGE_TOOL_NAME = "syntx_owner_reconcile_gpt26_image" as const;
export const SYNTX_OWNER_LIST_GPT26_IMAGE_RECOVERIES_TOOL_NAME = "syntx_owner_list_gpt26_image_recoveries" as const;
export const SYNTX_GET_GPT26_IMAGE_PARAMETERS_TOOL_NAME = "syntx_get_gpt26_image_parameters" as const;

const ATTEMPT = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const HANDLE = z.string().regex(/^standard_image_[0-9a-f-]{36}$/u);
const RECOVERY = z.string().regex(/^standard_image_recovery_[0-9a-f-]{36}$/u);
const HASH = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const VARIANT = z.enum(OWNER_GPT26_IMAGE_VARIANTS);
const MIME = z.enum(["image/jpeg", "image/jpg", "image/avif", "image/webp", "image/png"]);
const CANONICAL_MIME = z.enum(["image/jpeg", "image/avif", "image/webp", "image/png"]);
const MAX_B64 = 44_739_244;
const PARAMS = z.object({
  aspect_ratio: z.enum(OWNER_GPT26_IMAGE_SOURCE_CONTROLS.ratios),
  quality: z.enum(OWNER_GPT26_IMAGE_SOURCE_CONTROLS.quality),
  details_quality: z.enum(OWNER_GPT26_IMAGE_SOURCE_CONTROLS.details_quality),
  output_format: z.enum(OWNER_GPT26_IMAGE_SOURCE_CONTROLS.output_format)
}).strict();
const PROMPT = z.string().min(1).max(65_536).refine(value => value.trim().length > 0 &&
  Buffer.byteLength(value, "utf8") <= 65_536 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));

const uploadInput = z.object({
  link_attempt_id: ATTEMPT,
  variant: VARIANT,
  content_base64: z.string().min(4).max(MAX_B64).refine(value => isCanonicalBase64(value, MAX_B64)).optional(),
  filename: z.string().min(1).max(255).refine(value => /^[^/\\\p{Cc}\p{Cf}\p{Cs}]+$/u.test(value)).optional(),
  mime_type: MIME.optional(),
  file: CHATGPT_IMAGE_FILE_SCHEMA.optional()
}).strict().superRefine((value, context) => {
  if ((value.file === undefined) === (value.content_base64 === undefined) ||
      (value.content_base64 !== undefined && (value.filename === undefined || value.mime_type === undefined)) ||
      (value.file !== undefined && (value.filename !== undefined || value.mime_type !== undefined))) {
    context.addIssue({ code: "custom", path: ["file"], message: "Provide one complete Base64 input or one attachment." });
  }
});

const generateInput = z.object({
  link_attempt_id: ATTEMPT, variant: VARIANT,
  reference_handles: z.array(HANDLE).max(16),
  parameters: PARAMS, prompt: PROMPT
}).strict().superRefine((value, context) => {
  if (new Set(value.reference_handles).size !== value.reference_handles.length) {
    context.addIssue({ code: "custom", path: ["reference_handles"], message: "Duplicate reference handles." });
  }
  try { normalizeOwnerGpt26ImageParameters({ variant: value.variant,
    reference_count: value.reference_handles.length, parameters: value.parameters }); }
  catch { context.addIssue({ code: "custom", path: ["parameters"], message: "Invalid GPT Image 2.6 controls." }); }
});

const uploadOutput = z.object({
  status: z.literal("uploaded"), reference_handle: HANDLE, variant: VARIANT,
  kind: z.literal("image"), original_mime_type: MIME, mime_type: CANONICAL_MIME,
  width: z.number().int().positive().nullable(), height: z.number().int().positive().nullable(),
  duration: z.null(), size: z.number().int().positive().max(32 * 1024 * 1024), sha256: HASH,
  expires_in_seconds: z.number().int().min(1).max(900),
  metadata_confidence: z.literal("CONTAINER_METADATA_ONLY"),
  validation_confidence: z.string().min(1).max(180)
}).strict();

const INPUT_REF = z.object({ kind: z.literal("image"), mime_type: CANONICAL_MIME,
  width: z.number().int().positive().nullable(), height: z.number().int().positive().nullable(),
  duration: z.null(), size: z.number().int().positive(), sha256: HASH,
  metadata_confidence: z.enum(["CONTAINER_METADATA_ONLY", "UNKNOWN"]) }).strict();
const RESULT = z.object({
  status: z.literal("result_observed"), backend_acceptance: z.literal("unproven"),
  ai_name: z.literal("sora-images"), model_id: VARIANT, variant: VARIANT,
  operation_id: z.literal("generate-image"), profile_id: z.literal("gpt-image-26-source-reviewed-v1"),
  profile_schema_hash: HASH, catalog_version: z.literal(OWNER_GPT26_PUBLIC_CATALOG_VERSION),
  request_fingerprint: HASH, parameters: PARAMS,
  cost_inputs: z.union([z.object({ quality: z.enum(OWNER_GPT26_IMAGE_SOURCE_CONTROLS.quality),
    details_quality: z.enum(OWNER_GPT26_IMAGE_SOURCE_CONTROLS.details_quality),
    output_format: z.enum(OWNER_GPT26_IMAGE_SOURCE_CONTROLS.output_format) }).strict(),
    z.object({ quality: z.enum(OWNER_GPT26_IMAGE_SOURCE_CONTROLS.quality),
      details_quality: z.enum(OWNER_GPT26_IMAGE_SOURCE_CONTROLS.details_quality),
      output_format: z.enum(OWNER_GPT26_IMAGE_SOURCE_CONTROLS.output_format),
      ref_count: z.number().int().min(1).max(16) }).strict()]),
  cost_input_confidence: z.literal("SOURCE_JOINED_CONTROLLED_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP"),
  reference_count: z.number().int().min(0).max(16), total_reference_count: z.number().int().min(0).max(16),
  counts_by_kind: z.object({ image: z.number().int().min(0).max(16), video: z.literal(0), file: z.literal(0) }).strict(),
  input_references: z.array(INPUT_REF).max(16),
  actual_image: z.object({ mime_type: z.string().regex(/^image\/[a-z0-9.+-]{1,64}$/u).nullable(), width: z.null(), height: z.null() }).strict(),
  geometry_verified: z.literal(false),
  artifact: z.object({ url: z.string().url().refine(value => { try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; } }),
    mime_type: z.string().regex(/^image\/[a-z0-9.+-]{1,64}$/u).nullable(),
    mime_source: z.enum(["URL_EXTENSION", "UNKNOWN"]), width: z.null(), height: z.null(), geometry_verified: z.literal(false) }).strict()
}).strict().superRefine((value, context) => {
  if (value.model_id !== value.variant || value.reference_count !== value.input_references.length ||
      value.total_reference_count !== value.reference_count || value.counts_by_kind.image !== value.reference_count ||
      value.input_references.reduce((n, ref) => n + ref.size, 0) > OWNER_GPT26_IMAGE_SOURCE_CONTROLS.max_total_file_size) {
    context.addIssue({ code: "custom", path: ["input_references"], message: "Result reference identity or size is inconsistent." });
  }
  try {
    const expected = normalizeOwnerGpt26ImageParameters({ variant: value.variant,
      reference_count: value.reference_count, parameters: value.parameters });
    if (JSON.stringify(value.cost_inputs) !== JSON.stringify(expected.cost_inputs)) throw new Error("cost mismatch");
  } catch { context.addIssue({ code: "custom", path: ["cost_inputs"], message: "Result controls or cost inputs are inconsistent." }); }
});
const RECONCILE = z.object({ link_attempt_id: ATTEMPT, recovery_id: RECOVERY }).strict();
const LIST = z.object({ link_attempt_id: ATTEMPT, limit: z.number().int().min(1).max(20).default(20) }).strict();
const DIAGNOSTIC = z.object({ phase: z.string(), post_started: z.boolean(), echo_ack_known: z.boolean(),
  history_binding: z.enum(["NONE", "PENDING", "READY", "INVALID"]), history_binding_reason: z.string().nullable(),
  history_get_calls: z.number().int().min(0).max(99), history_get_calls_saturated: z.boolean(),
  inprogress_get_calls: z.number().int().min(0).max(99), inprogress_get_calls_saturated: z.boolean(),
  result_get_calls: z.number().int().min(0).max(99), result_get_calls_saturated: z.boolean(),
  result_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "UNVERIFIED"]), result_reason: z.string().nullable() }).strict();
const LIST_OUTPUT = z.object({ recoveries: z.array(z.object({ recovery_id: RECOVERY,
  created_at: z.iso.datetime(), model_id: VARIANT, operation_id: z.literal("generate-image"),
  status: z.literal("OUTCOME_UNKNOWN"), diagnostic: DIAGNOSTIC }).strict()).max(20),
  confidence_scope: z.literal("process_local_get_only_recovery") }).strict();
const SOURCE_OUTPUT = z.object({
  variants: z.tuple([z.literal("gpt-image-2.6-flare"), z.literal("gpt-image-2.6-sunburst")]),
  ratios: z.array(z.string()), gif_ratios: z.array(z.string()), quality: z.array(z.string()),
  details_quality: z.array(z.string()), output_format: z.array(z.string()),
  reference_limit: z.literal(16), max_total_file_size: z.literal(83_886_080),
  form_build: z.literal("1794311734"), form_sha256: HASH,
  public_catalog_version: z.literal(OWNER_GPT26_PUBLIC_CATALOG_VERSION),
  gif_rule: z.literal("GIF_REQUIRES_1K_AND_ONE_OF_GIF_RATIOS"),
  evidence: z.literal("STATIC_FORM_AND_PUBLIC_CATALOG_NOT_RENDERED_UI_OR_PROVIDER_ACCEPTANCE")
}).strict();

export interface RegisterSyntxOwnerGpt26ImageToolsOptions {
  readonly uploadService: Pick<OwnerStandardImageUploadService, "upload" | "assertLinkedAttempt">;
  readonly generationService: Pick<OwnerStandardImageGenerationService, "generate" | "reconcile" | "listRecoveries">;
  readonly resolveChatgptImageFile?: ChatgptImageFileResolver;
}

export function registerSyntxOwnerGpt26ImageTools(
  server: import("@modelcontextprotocol/sdk/server/mcp.js").McpServer,
  options: RegisterSyntxOwnerGpt26ImageToolsOptions
): void {
  server.registerTool(SYNTX_GET_GPT26_IMAGE_PARAMETERS_TOOL_NAME, {
    title: "Get GPT Image 2.6 controls",
    description: "Read-only source-backed GPT Image 2.6 controls, format conditions, reference cardinality and public aggregate metadata. This does not check account access, quote cost, or prove provider acceptance.",
    inputSchema: z.object({}).strict(), outputSchema: SOURCE_OUTPUT,
    annotations: { title: "Get GPT Image 2.6 controls", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (): Promise<CallToolResult> => safeStructured(SOURCE_OUTPUT.parse({
    variants: OWNER_GPT26_IMAGE_SOURCE_CONTROLS.variants,
    ratios: OWNER_GPT26_IMAGE_SOURCE_CONTROLS.ratios,
    gif_ratios: OWNER_GPT26_IMAGE_SOURCE_CONTROLS.gif_ratios,
    quality: OWNER_GPT26_IMAGE_SOURCE_CONTROLS.quality,
    details_quality: OWNER_GPT26_IMAGE_SOURCE_CONTROLS.details_quality,
    output_format: OWNER_GPT26_IMAGE_SOURCE_CONTROLS.output_format,
    reference_limit: OWNER_GPT26_IMAGE_SOURCE_CONTROLS.reference_limit,
    max_total_file_size: OWNER_GPT26_IMAGE_SOURCE_CONTROLS.max_total_file_size,
    form_build: OWNER_GPT26_IMAGE_SOURCE_CONTROLS.form_build,
    form_sha256: OWNER_GPT26_IMAGE_SOURCE_CONTROLS.form_sha256,
    public_catalog_version: OWNER_GPT26_PUBLIC_CATALOG_VERSION,
    gif_rule: "GIF_REQUIRES_1K_AND_ONE_OF_GIF_RATIOS",
    evidence: OWNER_GPT26_IMAGE_SOURCE_CONTROLS.source_evidence
  })));

  server.registerTool(SYNTX_UPLOAD_GPT26_IMAGE_REFERENCE_TOOL_NAME, {
    title: "Upload a GPT Image 2.6 reference",
    description: "Upload one image reference for an exact GPT Image 2.6 variant and linked owner attempt. Local 32 MiB file guard; public total 80 MiB across up to 16 images. No generation is started.",
    inputSchema: uploadInput, outputSchema: uploadOutput, _meta: CHATGPT_IMAGE_FILE_TOOL_META,
    annotations: { title: "Upload GPT Image 2.6 reference", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    const parsed = uploadInput.safeParse(input);
    if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST");
    try {
      let file: Awaited<ReturnType<typeof resolveChatgptImageUploadInput>> | undefined;
      if (parsed.data.file !== undefined) {
        await options.uploadService.assertLinkedAttempt(parsed.data.link_attempt_id, signal);
        file = await resolveChatgptImageUploadInput(parsed.data.file, parsed.data.variant, signal, options.resolveChatgptImageFile);
      }
      const receipt = await options.uploadService.upload({ attemptId: parsed.data.link_attempt_id,
        variant: parsed.data.variant, content_base64: file?.content_base64 ?? parsed.data.content_base64!,
        filename: file?.filename ?? parsed.data.filename!, mime_type: file?.mime_type ?? parsed.data.mime_type!,
        ...(signal === undefined ? {} : { signal }) });
      const output = uploadOutput.parse(receipt);
      if (output.variant !== parsed.data.variant) throw new Error("Upload variant binding mismatch.");
      return safeStructured(output);
    } catch (error) { return errorResult(error, "UPLOAD_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_GPT26_IMAGE_TOOL_NAME, {
    title: "Generate GPT Image 2.6",
    description: "Owner-authorized paid generation with explicit aspect ratio, quality, detail quality and output format. GIF permits only 1K and 1:1, 16:9 or 9:16. Use opaque reference handles from this tool family. OUTCOME_UNKNOWN must be reconciled without replay.",
    inputSchema: generateInput, outputSchema: RESULT,
    annotations: { title: "Generate GPT Image 2.6", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    const parsed = generateInput.safeParse(input);
    if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST");
    try { const output = RESULT.parse(await options.generationService.generate({
      attemptId: parsed.data.link_attempt_id, variant: parsed.data.variant,
      reference_handles: parsed.data.reference_handles, parameters: parsed.data.parameters,
      prompt: parsed.data.prompt
    }, signal));
      if (output.variant !== parsed.data.variant || JSON.stringify(output.parameters) !== JSON.stringify(parsed.data.parameters) ||
          output.reference_count !== parsed.data.reference_handles.length) throw new Error("Generation result binding mismatch.");
      return safeImageResult(output); }
    catch (error) { return errorResult(error, "GENERATION_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_GPT26_IMAGE_TOOL_NAME, {
    title: "Reconcile GPT Image 2.6 generation",
    description: "GET-only reconciliation of this process-local recovery; no replay.",
    inputSchema: RECONCILE, outputSchema: RESULT,
    annotations: { title: "Reconcile GPT Image 2.6", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    const parsed = RECONCILE.safeParse(input);
    if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST");
    try { return safeImageResult(RESULT.parse(await options.generationService.reconcile({
      attemptId: parsed.data.link_attempt_id, recovery_id: parsed.data.recovery_id
    }, signal))); }
    catch (error) { return errorResult(error, "GENERATION_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_LIST_GPT26_IMAGE_RECOVERIES_TOOL_NAME, {
    title: "List GPT Image 2.6 recoveries",
    description: "List process-local uncertain outcomes for the linked owner attempt; no generation or replay.",
    inputSchema: LIST, outputSchema: LIST_OUTPUT,
    annotations: { title: "List GPT Image 2.6 recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input): Promise<CallToolResult> => {
    const parsed = LIST.safeParse(input);
    if (!parsed.success) return errorResult(undefined, "INVALID_REQUEST");
    try { return safeStructured(LIST_OUTPUT.parse({ recoveries: await options.generationService.listRecoveries({
      attemptId: parsed.data.link_attempt_id, limit: parsed.data.limit
    }), confidence_scope: "process_local_get_only_recovery" })); }
    catch (error) { return errorResult(error, "RECOVERY_LIST_UNAVAILABLE"); }
  });
}
