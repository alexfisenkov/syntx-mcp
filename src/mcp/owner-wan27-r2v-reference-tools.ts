import { types } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import {
  getOwnerWan27R2vGenerationParametersSource,
  type OwnerWan27R2vGenerationSourceContract
} from "../application/owner-wan27-r2v-generation-parameters.js";
import {
  OwnerWan27R2vReferenceServiceError,
  type OwnerWan27R2vManifestDraft,
  type OwnerWan27R2vManifestReference,
  type OwnerWan27R2vReferenceManifest
} from "../application/owner-wan27-r2v-reference-service.js";
import {
  isOwnerWan27R2vReferenceUploadService,
  OwnerWan27R2vReferenceUploadService,
  OwnerWan27R2vReferenceUploadServiceError
} from "../application/owner-wan27-r2v-reference-upload-service.js";

export const SYNTX_GET_WAN27_R2V_PARAMETERS_TOOL_NAME = "syntx_get_wan27_r2v_parameters" as const;
export const SYNTX_OWNER_CREATE_WAN27_R2V_MANIFEST_TOOL_NAME = "syntx_owner_create_wan27_r2v_manifest" as const;
export const SYNTX_OWNER_UPLOAD_WAN27_R2V_IMAGE_TOOL_NAME = "syntx_owner_upload_wan27_r2v_image" as const;
export const SYNTX_OWNER_UPLOAD_WAN27_R2V_VIDEO_TOOL_NAME = "syntx_owner_upload_wan27_r2v_video" as const;
export const SYNTX_OWNER_FINALIZE_WAN27_R2V_MANIFEST_TOOL_NAME = "syntx_owner_finalize_wan27_r2v_manifest" as const;
export const OWNER_WAN27_R2V_REFERENCE_TOOL_NAMES = Object.freeze([
  SYNTX_GET_WAN27_R2V_PARAMETERS_TOOL_NAME,
  SYNTX_OWNER_CREATE_WAN27_R2V_MANIFEST_TOOL_NAME,
  SYNTX_OWNER_UPLOAD_WAN27_R2V_IMAGE_TOOL_NAME,
  SYNTX_OWNER_UPLOAD_WAN27_R2V_VIDEO_TOOL_NAME,
  SYNTX_OWNER_FINALIZE_WAN27_R2V_MANIFEST_TOOL_NAME
] as const);

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const MANIFEST = /^wan27ref_[A-Za-z0-9_-]{20,120}$/u;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const attemptSchema = z.string().regex(ATTEMPT);
const manifestSchema = z.string().regex(MANIFEST);
const emptyInput = z.object({}).strict();
const createInput = z.object({ link_attempt_id: attemptSchema, video_reference_count: z.number().int().min(0).max(5) }).strict();
const imageInput = z.object({ link_attempt_id: attemptSchema, manifest_handle: manifestSchema,
  filename: z.string().min(1).max(255), mime_type: z.string().min(1).max(100),
  content_base64: z.string().min(4).max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4) }).strict();
const videoInput = z.object({ link_attempt_id: attemptSchema, manifest_handle: manifestSchema,
  filename: z.string().min(1).max(255), mime_type: z.string().min(1).max(100),
  content_base64: z.string().min(4).max(Math.ceil(MAX_VIDEO_BYTES / 3) * 4),
  start_seconds: z.number().finite().min(0).max(30), end_seconds: z.number().finite().min(0).max(30) }).strict();
const finalizeInput = z.object({ link_attempt_id: attemptSchema, manifest_handle: manifestSchema }).strict();

const referenceSchema = z.object({ reference_handle: z.string().min(1).max(160),
  media_type: z.enum(["image", "selected_video"]), mime_type: z.string().min(1).max(100), size: z.number().int().min(1).max(MAX_VIDEO_BYTES),
  width: z.number().int().min(1).max(8_000), height: z.number().int().min(1).max(8_000),
  video_duration_seconds: z.number().finite().min(0).max(5).optional() }).strict();
const draftOutput = z.object({ status: z.literal("draft"), manifest_handle: manifestSchema,
  video_reference_count: z.number().int().min(0).max(5), expires_in_seconds: z.number().int().min(0).max(900),
  generation_permit: z.literal(false) }).strict();
const itemOutput = z.object({ status: z.literal("item"), manifest_handle: manifestSchema,
  item: referenceSchema }).strict();
const readyOutput = z.object({ status: z.literal("ready"), manifest_handle: manifestSchema,
  video_reference_count: z.number().int().min(0).max(5), total_reference_count: z.number().int().min(0).max(5),
  references: z.array(referenceSchema).max(5), expires_at: z.number().int().nonnegative(), epoch: z.number().int().nonnegative(),
  generation_permit: z.literal(false) }).strict();
const errorOutput = z.object({ error: z.enum(["INVALID_REQUEST", "REQUEST_ABORTED", "SERVICE_BUSY", "SERVICE_CLOSED",
  "MANIFEST_UNAVAILABLE", "MANIFEST_EXPIRED", "MANIFEST_INCOMPLETE", "MANIFEST_VIDEO_COUNT_INVALID",
  "PRINCIPAL_NOT_LINKED", "CAPACITY_EXCEEDED", "IMAGE_REJECTED", "VIDEO_REJECTED",
  "LOCAL_RESOURCE_LIMIT_EXCEEDED", "UPLOAD_REJECTED", "UPLOAD_OUTCOME_UNKNOWN", "REFERENCE_UNAVAILABLE", "OUTPUT_INVALID"]) }).strict();
const draftToolOutput = outputUnionSchema(draftOutput);
const itemToolOutput = outputUnionSchema(itemOutput);
const readyToolOutput = outputUnionSchema(readyOutput);

export interface OwnerWan27R2vReferenceToolComposition {
  readonly referenceUploadService: Pick<OwnerWan27R2vReferenceUploadService,
    "createManifest" | "uploadImage" | "uploadVideo" | "finalizeManifest">;
}

export function registerSyntxOwnerWan27R2vReferenceTools(server: McpServer,
  compositionInput: OwnerWan27R2vReferenceToolComposition | unknown): void {
  const composition = exactComposition(compositionInput);
  const source = getOwnerWan27R2vGenerationParametersSource();
  const sourceOutput = literalSchema(source) as z.ZodType<OwnerWan27R2vGenerationSourceContract>;

  server.registerTool(SYNTX_GET_WAN27_R2V_PARAMETERS_TOOL_NAME, {
    title: "Get WAN 2.7 R2V parameters",
    description: "Returns pinned static WAN 2.7 R2V controls and source gaps. This input command does not start generation.",
    inputSchema: emptyInput, outputSchema: sourceOutput,
    annotations: { title: "Get WAN 2.7 R2V parameters", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async () => success(sourceOutput, source));

  server.registerTool(SYNTX_OWNER_CREATE_WAN27_R2V_MANIFEST_TOOL_NAME, {
    title: "Create WAN 2.7 R2V reference manifest",
    description: "Creates an owner-bound draft for the exact linked attempt. It accepts 0–5 selected video references; uploads are separate. This input command does not start generation.",
    inputSchema: createInput, outputSchema: draftToolOutput,
    annotations: { title: "Create WAN 2.7 R2V reference manifest", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async (raw, { signal }) => {
    const parsed = createInput.safeParse(snapshot(raw));
    if (!parsed.success) return failure("INVALID_REQUEST");
    try {
      const result = await composition.referenceUploadService.createManifest({ attemptId: parsed.data.link_attempt_id,
        video_reference_count: parsed.data.video_reference_count }, signal);
      return success(draftOutput, projectDraft(result));
    } catch (error) { return failure(errorCode(error)); }
  });

  server.registerTool(SYNTX_OWNER_UPLOAD_WAN27_R2V_IMAGE_TOOL_NAME, {
    title: "Upload WAN 2.7 R2V image reference",
    description: "Uploads one bounded image to the owner-bound draft manifest. Base64 data is decoded locally and wiped after the upload operation.",
    inputSchema: imageInput, outputSchema: itemToolOutput,
    annotations: { title: "Upload WAN 2.7 R2V image reference", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (raw, { signal }) => uploadImage(raw, signal, composition));

  server.registerTool(SYNTX_OWNER_UPLOAD_WAN27_R2V_VIDEO_TOOL_NAME, {
    title: "Upload WAN 2.7 R2V selected video",
    description: "Uploads one bounded source video, validates it locally, and selects the requested interval for the owner-bound draft manifest. No source path or URL is accepted.",
    inputSchema: videoInput, outputSchema: itemToolOutput,
    annotations: { title: "Upload WAN 2.7 R2V selected video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (raw, { signal }) => uploadVideo(raw, signal, composition));

  server.registerTool(SYNTX_OWNER_FINALIZE_WAN27_R2V_MANIFEST_TOOL_NAME, {
    title: "Finalize WAN 2.7 R2V reference manifest",
    description: "Finalizes one complete owner-bound draft manifest and returns its ordered reference metadata. This does not start generation.",
    inputSchema: finalizeInput, outputSchema: readyToolOutput,
    annotations: { title: "Finalize WAN 2.7 R2V reference manifest", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async (raw, { signal }) => {
    const parsed = finalizeInput.safeParse(snapshot(raw));
    if (!parsed.success) return failure("INVALID_REQUEST");
    try {
      const result = await composition.referenceUploadService.finalizeManifest({ attemptId: parsed.data.link_attempt_id,
        manifest_handle: parsed.data.manifest_handle }, signal);
      return success(readyOutput, projectReady(result));
    } catch (error) { return failure(errorCode(error)); }
  });
}

async function uploadImage(raw: unknown, signal: AbortSignal | undefined, composition: OwnerWan27R2vReferenceToolComposition): Promise<CallToolResult> {
  const parsed = imageInput.safeParse(snapshot(raw));
  if (!parsed.success) return failure("INVALID_REQUEST");
  let bytes: Buffer | undefined;
  try {
    bytes = decodeBase64(parsed.data.content_base64, MAX_IMAGE_BYTES);
    const result = await composition.referenceUploadService.uploadImage({ attemptId: parsed.data.link_attempt_id,
      manifest_handle: parsed.data.manifest_handle, filename: parsed.data.filename, mime_type: parsed.data.mime_type, bytes }, signal);
    return success(itemOutput, { status: "item", manifest_handle: parsed.data.manifest_handle, item: projectReference(result) });
  } catch (error) { return failure(errorCode(error)); }
  finally { bytes?.fill(0); }
}

async function uploadVideo(raw: unknown, signal: AbortSignal | undefined, composition: OwnerWan27R2vReferenceToolComposition): Promise<CallToolResult> {
  const parsed = videoInput.safeParse(snapshot(raw));
  if (!parsed.success) return failure("INVALID_REQUEST");
  let bytes: Buffer | undefined;
  try {
    bytes = decodeBase64(parsed.data.content_base64, MAX_VIDEO_BYTES);
    const result = await composition.referenceUploadService.uploadVideo({ attemptId: parsed.data.link_attempt_id,
      manifest_handle: parsed.data.manifest_handle, filename: parsed.data.filename, mime_type: parsed.data.mime_type,
      bytes, start_seconds: parsed.data.start_seconds, end_seconds: parsed.data.end_seconds }, signal);
    return success(itemOutput, { status: "item", manifest_handle: parsed.data.manifest_handle, item: projectReference(result) });
  } catch (error) { return failure(errorCode(error)); }
  finally { bytes?.fill(0); }
}

function decodeBase64(value: string, maximum: number): Buffer {
  if (value.length % 4 !== 0 || value.length > Math.ceil(maximum / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new OwnerWan27R2vReferenceUploadServiceError("INVALID_REQUEST");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.length > maximum || bytes.toString("base64") !== value) {
    bytes.fill(0);
    throw new OwnerWan27R2vReferenceUploadServiceError("INVALID_REQUEST");
  }
  return bytes;
}

function projectDraft(value: OwnerWan27R2vManifestDraft): unknown {
  return { status: value.status, manifest_handle: value.manifest_handle, video_reference_count: value.video_reference_count,
    expires_in_seconds: value.expires_in_seconds, generation_permit: false };
}
function projectReference(value: OwnerWan27R2vManifestReference): unknown {
  return { reference_handle: value.reference_handle, media_type: value.media_type, mime_type: value.mime_type,
    size: value.size, width: value.width, height: value.height,
    ...(value.video_duration_seconds === undefined ? {} : { video_duration_seconds: value.video_duration_seconds }) };
}
function projectReady(value: OwnerWan27R2vReferenceManifest): unknown {
  return { status: value.status, manifest_handle: value.manifest_handle, video_reference_count: value.video_reference_count,
    total_reference_count: value.total_reference_count, references: value.references.map(projectReference),
    expires_at: value.expires_at, epoch: value.epoch, generation_permit: false };
}
function success<T extends z.ZodType>(schema: T, value: unknown): CallToolResult {
  const parsed = schema.safeParse(snapshot(value));
  if (!parsed.success) return failure("OUTPUT_INVALID");
  const projected = parsed.data as Record<string, unknown>;
  return { content: [{ type: "text", text: JSON.stringify(projected) }], structuredContent: projected };
}
function failure(code: string): CallToolResult {
  const safeCode = errorOutput.shape.error.safeParse(code).success ? code : "REFERENCE_UNAVAILABLE";
  const value = { error: safeCode };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}
function errorCode(error: unknown): string {
  if (error instanceof OwnerWan27R2vReferenceServiceError || error instanceof OwnerWan27R2vReferenceUploadServiceError) return error.code;
  return "REFERENCE_UNAVAILABLE";
}
function outputUnionSchema<T extends z.ZodObject<z.ZodRawShape>>(successSchema: T): z.ZodTypeAny {
  const optionalSuccessShape = Object.fromEntries(Object.entries(successSchema.shape).map(([key, field]) =>
    [key, z.optional(field)])) as Record<string, z.ZodTypeAny>;
  return z.object({ ...optionalSuccessShape, error: errorOutput.shape.error.optional() }).strict().superRefine((value, context) => {
    const parsed = Object.hasOwn(value, "error") ? errorOutput.safeParse(value) : successSchema.safeParse(value);
    if (!parsed.success) context.addIssue({ code: "custom", message: "The owner WAN 2.7 R2V tool output is invalid." });
  }).meta({ oneOf: [z.toJSONSchema(successSchema, { target: "draft-7", io: "output" }),
    z.toJSONSchema(errorOutput, { target: "draft-7", io: "output" })] });
}
function exactComposition(input: unknown): OwnerWan27R2vReferenceToolComposition {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) throw new Error("OWNER_WAN27_R2V_COMPOSITION_INVALID");
  const fields = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(fields);
  if (keys.length !== 1 || !keys.includes("referenceUploadService") || keys.some((key) =>
    typeof key !== "string" || !Object.hasOwn(fields[key]!, "value") || fields[key]!.enumerable !== true)) {
    throw new Error("OWNER_WAN27_R2V_COMPOSITION_INVALID");
  }
  const service = fields.referenceUploadService!.value;
  if (!isOwnerWan27R2vReferenceUploadService(service)) {
    throw new Error("OWNER_WAN27_R2V_COMPOSITION_INVALID");
  }
  return Object.freeze({ referenceUploadService: service });
}
function snapshot(value: unknown): unknown {
  if (value === null || typeof value !== "object" || types.isProxy(value)) return value;
  try {
    if (Array.isArray(value)) return Array.from(value, snapshot);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string" || !Object.hasOwn(descriptors[key]!, "value") || !descriptors[key]!.enumerable) return value;
      result[key] = snapshot(descriptors[key]!.value);
    }
    return result;
  } catch { return value; }
}
function literalSchema(value: unknown): z.ZodTypeAny {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return z.literal(value);
  if (Array.isArray(value)) return z.tuple(value.map(literalSchema) as [z.ZodTypeAny, ...z.ZodTypeAny[]]);
  if (!value || typeof value !== "object") throw new Error("WAN27_R2V_SOURCE_SCHEMA_INVALID");
  const shape: Record<string, z.ZodTypeAny> = Object.create(null) as Record<string, z.ZodTypeAny>;
  for (const [key, child] of Object.entries(value)) shape[key] = literalSchema(child);
  return z.object(shape).strict();
}
