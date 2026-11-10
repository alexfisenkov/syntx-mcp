import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { isCanonicalBase64 } from "../application/canonical-base64.js";
import { imageArtifactContentForResult, imageArtifactResultJsonText } from "./image-artifact-content.js";
import { OwnerSeedream55EditorService, OwnerSeedream55EditorServiceError } from "../application/owner-seedream55-editor-service.js";
import { getOwnerSeedream55EditorSourceProfile } from "../application/owner-seedream55-editor-source-profile.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";

export const SYNTX_GET_SEEDREAM55_EDITOR_PARAMETERS = "syntx_get_seedream55_editor_parameters" as const;
export const SYNTX_UPLOAD_SEEDREAM55_EDITOR_ORIGINAL = "syntx_upload_seedream55_editor_original" as const;
export const SYNTX_UPLOAD_SEEDREAM55_EDITOR_DRAWING = "syntx_upload_seedream55_editor_drawing" as const;
export const SYNTX_OWNER_GENERATE_SEEDREAM55_EDITOR_IMAGE = "syntx_owner_generate_seedream55_editor_image" as const;
export const SYNTX_OWNER_RECONCILE_SEEDREAM55_EDITOR_IMAGE = "syntx_owner_reconcile_seedream55_editor_image" as const;
export const SYNTX_OWNER_LIST_SEEDREAM55_EDITOR_RECOVERIES = "syntx_owner_list_seedream55_editor_recoveries" as const;
export const SYNTX_OWNER_GET_SEEDREAM55_EDITOR_RESULT_PAGE = "syntx_owner_get_seedream55_editor_result_page" as const;
export const OWNER_SEEDREAM55_EDITOR_TOOL_NAMES = Object.freeze([
  SYNTX_GET_SEEDREAM55_EDITOR_PARAMETERS, SYNTX_UPLOAD_SEEDREAM55_EDITOR_ORIGINAL,
  SYNTX_UPLOAD_SEEDREAM55_EDITOR_DRAWING, SYNTX_OWNER_GENERATE_SEEDREAM55_EDITOR_IMAGE,
  SYNTX_OWNER_RECONCILE_SEEDREAM55_EDITOR_IMAGE, SYNTX_OWNER_LIST_SEEDREAM55_EDITOR_RECOVERIES,
  SYNTX_OWNER_GET_SEEDREAM55_EDITOR_RESULT_PAGE
] as const);

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const ORIGINAL = /^seedream55_editor_original_[0-9a-f-]{36}$/u;
const DRAWING = /^seedream55_editor_drawing_[0-9a-f-]{36}$/u;
const RECOVERY = /^seedream55_editor_recovery_[0-9a-f-]{36}$/u;
const RESULT = /^seedream55_editor_result_[0-9a-f-]{36}$/u;
const RATIOS = ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"] as const;
const RESOLUTIONS = ["1K", "1.5K", "2K"] as const;
const MIMES = ["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/webp", "image/gif", "image/tiff", "image/heic", "image/heif"] as const;
const attempt = z.string().regex(ATTEMPT), original = z.string().regex(ORIGINAL), drawing = z.string().regex(DRAWING);
const recovery = z.string().regex(RECOVERY), resultId = z.string().regex(RESULT);
const filename = z.string().min(1).max(255).refine((value) => value !== "." && value !== ".." &&
  Buffer.byteLength(value, "utf8") <= 255 && !/[\/\\\p{Cc}\p{Cf}\p{Cs}]/u.test(value));
const base64 = (maxBytes: number) => z.string().min(4).max(Math.ceil(maxBytes / 3) * 4)
  .refine((value) => isCanonicalBase64(value, Math.ceil(maxBytes / 3) * 4));
const parameters = z.object({ aspect_ratio: z.enum(RATIOS), resolution: z.enum(RESOLUTIONS),
  output_format: z.enum(["jpeg", "png"]), background: z.enum(["auto", "opaque", "transparent"]) }).strict()
  .superRefine((value, context) => { if (value.background === "transparent" && value.output_format !== "png")
    context.addIssue({ code: "custom", path: ["output_format"], message: "Transparent background requires PNG." }); });
const artifact = z.object({ url: z.string().url().refine(isSafeUploadReferenceUrl), mime_type: z.string().nullable(), width: z.null(), height: z.null(),
  geometry_verified: z.literal(false) }).strict();
const getParamsInput = z.object({}).strict();
const getParamsOutput = z.object({ evidence_level: z.literal("STATIC_PUBLIC_SOURCE_ONLY"),
  profile_id: z.literal("seedream55-editor-source-profile-v1"), variant: z.literal("seedream-5.5"),
  profile_schema_hash: z.string().regex(SHA256), public_catalog_version: z.string(), settings_inventory_version: z.string(),
  controls: z.object({ aspect_ratios: z.array(z.enum(RATIOS)).length(8), resolutions: z.array(z.enum(RESOLUTIONS)).length(3),
    output_formats: z.array(z.enum(["jpeg", "png"])).length(2), backgrounds: z.array(z.enum(["auto", "opaque", "transparent"])).length(3),
    defaults: parameters, transparent_requires_png: z.literal(true) }).strict(),
  original_count: z.literal(1), drawing_count_maximum: z.literal(1), original_max_image_bytes: z.literal(27_525_120),
  cost_keys: z.tuple([z.literal("batch_size"), z.literal("resolution")]),
  backend_acceptance: z.literal("UNPROVEN"), rendered_ui: z.literal("NOT_CHECKED") }).strict();
const originalInput = z.object({ link_attempt_id: attempt, content_base64: base64(27_525_120),
  filename, mime_type: z.enum(MIMES) }).strict();
const drawingInput = z.object({ link_attempt_id: attempt, original_handle: original,
  content_base64: base64(32 * 1024 * 1024), filename, mime_type: z.literal("image/png") }).strict();
const originalOutput = z.object({ status: z.literal("uploaded"), reference_handle: original, variant: z.literal("seedream-5.5"),
  original_mime_type: z.enum(MIMES), mime_type: z.string(), width: z.number().int().positive(), height: z.number().int().positive(),
  size: z.number().int().positive().max(27_525_120), sha256: z.string().regex(SHA256), expires_in_seconds: z.number().int().positive(),
  metadata_confidence: z.literal("CONTAINER_METADATA_ONLY") }).strict();
const drawingOutput = z.object({ status: z.literal("uploaded"), reference_handle: drawing, variant: z.literal("seedream-5.5"),
  original_handle: original, mime_type: z.literal("image/png"), width: z.number().int().positive(), height: z.number().int().positive(),
  size: z.number().int().positive().max(32 * 1024 * 1024), sha256: z.string().regex(SHA256), expires_in_seconds: z.number().int().positive(),
  metadata_confidence: z.literal("CONTAINER_METADATA_ONLY") }).strict();
const generateInput = z.object({ link_attempt_id: attempt, variant: z.literal("seedream-5.5"), prompt: z.string().min(1).max(32 * 1024),
  parameters, original_handle: original, drawing_handle: drawing.nullable() }).strict();
const reconcileInput = z.object({ link_attempt_id: attempt, recovery_id: recovery }).strict();
const listInput = z.object({ link_attempt_id: attempt, limit: z.number().int().min(1).max(20) }).strict();
const pageInput = z.object({ link_attempt_id: attempt, result_id: resultId, offset: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(64) }).strict();
const resultOutput = z.object({ status: z.literal("completed"), variant: z.literal("seedream-5.5"),
  status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"), backend_acceptance: z.literal("UNPROVEN"),
  profile_id: z.literal("seedream55-editor-source-profile-v1"), profile_schema_hash: z.string().regex(SHA256),
  request_fingerprint: z.string().regex(SHA256),
  cost_inputs: z.object({ batch_size: z.union([z.literal(1), z.literal(2)]), resolution: z.enum(RESOLUTIONS) }).strict(),
  result_id: resultId, offset: z.number().int().nonnegative(), limit: z.literal(64), observed_total: z.number().int().positive().max(64),
  artifacts: z.array(artifact).min(1).max(64), next_offset: z.number().int().nonnegative().nullable(), has_more: z.boolean() }).strict();
const recoveryListOutput = z.object({ recoveries: z.array(z.object({ recovery_id: recovery, created_at: z.iso.datetime(),
  variant: z.literal("seedream-5.5"), status: z.literal("OUTCOME_UNKNOWN") }).strict()).max(20),
  confidence_scope: z.literal("process_local_get_only_recovery") }).strict();
const pageOutput = z.object({ offset: z.number().int().nonnegative(), limit: z.number().int().min(1).max(64),
  observed_total: z.number().int().positive().max(64), artifacts: z.array(artifact).max(64),
  next_offset: z.number().int().nonnegative().nullable(), has_more: z.boolean() }).strict();

export function registerSyntxOwnerSeedream55EditorTools(server: McpServer,
  options: Readonly<{ service: Pick<OwnerSeedream55EditorService,
    "uploadOriginal" | "uploadDrawing" | "generate" | "reconcile" | "listRecoveries" | "getResultPage"> }>): void {
  const service = options.service;
  server.registerTool(SYNTX_GET_SEEDREAM55_EDITOR_PARAMETERS, { title: "Get Seedream 5.5 Editor parameters",
    description: "Static current public-source controls and limits only; account and provider acceptance are unverified.",
    inputSchema: getParamsInput, outputSchema: getParamsOutput, annotations: annotations(true, false) }, async (input) => {
      if (!getParamsInput.safeParse(input).success) return errorResult("INVALID_REQUEST");
      try { const source = getOwnerSeedream55EditorSourceProfile();
        return structured(getParamsOutput.parse({ evidence_level: "STATIC_PUBLIC_SOURCE_ONLY", profile_id: source.profile_id,
          variant: source.variant, profile_schema_hash: source.profile_schema_hash,
          public_catalog_version: source.source_binding.public_catalog_version,
          settings_inventory_version: source.source_binding.settings_inventory_version,
          controls: { aspect_ratios: source.controls.aspect_ratios, resolutions: source.controls.resolutions,
            output_formats: source.controls.output_formats, backgrounds: source.controls.backgrounds,
            defaults: source.controls.defaults, transparent_requires_png: true }, original_count: 1,
          drawing_count_maximum: 1, original_max_image_bytes: 27_525_120,
          cost_keys: source.cost.keys, backend_acceptance: "UNPROVEN", rendered_ui: "NOT_CHECKED" })); }
      catch { return errorResult("PROFILE_BINDING_MISMATCH"); }
    });
  server.registerTool(SYNTX_UPLOAD_SEEDREAM55_EDITOR_ORIGINAL, { title: "Upload Seedream 5.5 Editor original",
    description: "Upload one original image bound to the exact linked attempt; no generation is started.",
    inputSchema: originalInput, outputSchema: originalOutput, annotations: annotations(false, true) }, async (input, { signal }) => {
      const parsed = originalInput.safeParse(input); if (!parsed.success) return errorResult("INVALID_REQUEST");
      try { return structured(originalOutput.parse(await service.uploadOriginal({ attemptId: parsed.data.link_attempt_id,
        content_base64: parsed.data.content_base64, filename: parsed.data.filename, mime_type: parsed.data.mime_type }, signal))); }
      catch (error) { return errorResult(code(error)); }
    });
  server.registerTool(SYNTX_UPLOAD_SEEDREAM55_EDITOR_DRAWING, { title: "Upload Seedream 5.5 Editor drawing",
    description: "Upload one canvas PNG paired to a genuine owned original handle; no generation is started.",
    inputSchema: drawingInput, outputSchema: drawingOutput, annotations: annotations(false, true) }, async (input, { signal }) => {
      const parsed = drawingInput.safeParse(input); if (!parsed.success) return errorResult("INVALID_REQUEST");
      try { return structured(drawingOutput.parse(await service.uploadDrawing({ attemptId: parsed.data.link_attempt_id,
        original_handle: parsed.data.original_handle, content_base64: parsed.data.content_base64,
        filename: parsed.data.filename, mime_type: "image/png" }, signal))); }
      catch (error) { return errorResult(code(error)); }
    });
  server.registerTool(SYNTX_OWNER_GENERATE_SEEDREAM55_EDITOR_IMAGE, { title: "Generate a Seedream 5.5 Editor image",
    description: "Starts one charged generation after owned reference and fresh account preflights. Unknown outcomes require GET-only recovery.",
    inputSchema: generateInput, outputSchema: resultOutput, annotations: annotations(false, true) }, async (input, { signal }) => {
      const parsed = generateInput.safeParse(input); if (!parsed.success) return errorResult("INVALID_REQUEST");
      try { return structured(resultOutput.parse(await service.generate({ attemptId: parsed.data.link_attempt_id,
        prompt: parsed.data.prompt, parameters: parsed.data.parameters, original_handle: parsed.data.original_handle,
        drawing_handle: parsed.data.drawing_handle }, signal))); }
      catch (error) { return errorResult(code(error), error); }
    });
  server.registerTool(SYNTX_OWNER_RECONCILE_SEEDREAM55_EDITOR_IMAGE, { title: "Reconcile Seedream 5.5 Editor image",
    description: "GET-only recovery for the exact attempt and opaque recovery handle; never repeats generation.",
    inputSchema: reconcileInput, outputSchema: resultOutput, annotations: annotations(true, false) }, async (input, { signal }) => {
      const parsed = reconcileInput.safeParse(input); if (!parsed.success) return errorResult("INVALID_REQUEST");
      try { return structured(resultOutput.parse(await service.reconcile({ attemptId: parsed.data.link_attempt_id,
        recovery_id: parsed.data.recovery_id }, signal))); }
      catch (error) { return errorResult(code(error), error); }
    });
  server.registerTool(SYNTX_OWNER_LIST_SEEDREAM55_EDITOR_RECOVERIES, { title: "List Seedream 5.5 Editor recoveries",
    description: "Read-only bounded process-local recovery handles for the exact linked attempt.",
    inputSchema: listInput, outputSchema: recoveryListOutput, annotations: annotations(true, false) }, async (input) => {
      const parsed = listInput.safeParse(input); if (!parsed.success) return errorResult("INVALID_REQUEST");
      try { const recoveries = await service.listRecoveries({ attemptId: parsed.data.link_attempt_id, limit: parsed.data.limit });
        return structured(recoveryListOutput.parse({ recoveries, confidence_scope: "process_local_get_only_recovery" })); }
      catch (error) { return errorResult(code(error)); }
    });
  server.registerTool(SYNTX_OWNER_GET_SEEDREAM55_EDITOR_RESULT_PAGE, { title: "Get Seedream 5.5 Editor result page",
    description: "Read-only bounded page from an already observed exact-attempt result.",
    inputSchema: pageInput, outputSchema: pageOutput, annotations: annotations(true, false) }, async (input) => {
      const parsed = pageInput.safeParse(input); if (!parsed.success) return errorResult("INVALID_REQUEST");
      try { return structured(pageOutput.parse(await service.getResultPage({ attemptId: parsed.data.link_attempt_id,
        result_id: parsed.data.result_id, offset: parsed.data.offset, limit: parsed.data.limit }))); }
      catch (error) { return errorResult(code(error)); }
    });
}

function annotations(readOnly: boolean, destructive: boolean) {
  return { readOnlyHint: readOnly, destructiveHint: destructive, idempotentHint: readOnly, openWorldHint: true };
}
function structured(value: object): CallToolResult {
  return { content: [{ type: "text", text: imageArtifactResultJsonText(value) }, ...imageArtifactContentForResult(value)],
    structuredContent: value as Record<string, unknown> };
}
function code(error: unknown): string { return error instanceof OwnerSeedream55EditorServiceError ? error.code : "OPERATION_UNAVAILABLE"; }
function errorResult(errorCode: string, error?: unknown): CallToolResult {
  const recoveryId = error instanceof OwnerSeedream55EditorServiceError && error.code === "OUTCOME_UNKNOWN" &&
    typeof error.recovery_id === "string" && RECOVERY.test(error.recovery_id) ? error.recovery_id : undefined;
  const body = { error: { code: errorCode, message: "Seedream 5.5 Editor operation is unavailable; do not repeat an uncertain generation.",
    ...(recoveryId === undefined ? {} : { recovery_id: recoveryId }) } };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] };
}
