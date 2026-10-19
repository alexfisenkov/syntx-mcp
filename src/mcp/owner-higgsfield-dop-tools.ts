import { types } from "node:util";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isOwnerHiggsfieldDopGenerationService, type OwnerHiggsfieldDopGenerationService } from "../application/owner-higgsfield-dop-generation-service.js";
import { isOwnerHiggsfieldDopImportService, type OwnerHiggsfieldDopImportService } from "../application/owner-higgsfield-dop-import-service.js";
import { isOwnerHiggsfieldDopReferenceService, type OwnerHiggsfieldDopReferenceService } from "../application/owner-higgsfield-dop-reference-service.js";
import { isOwnerHiggsfieldDopMotionService, type OwnerHiggsfieldDopMotionService } from "../application/owner-higgsfield-dop-motion-service.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY = /^higgsfield_dop_recovery_[0-9a-f-]{36}$/u;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_BASE64 = Math.ceil(MAX_BYTES / 3) * 4;
const MODEL_IDS = ["dop-lite", "dop-turbo"] as const;
const MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const ERROR_CODES = new Set([
  "INVALID_REQUEST", "INVALID_PARAMETERS", "INVALID_IMAGE_INPUT", "LOCAL_RESOURCE_LIMIT_EXCEEDED", "PRINCIPAL_NOT_LINKED",
  "REQUEST_ABORTED", "SERVICE_BUSY", "CAPACITY_EXCEEDED", "SERVICE_CLOSED", "VALIDATION_REJECTED", "UPLOAD_OUTCOME_UNKNOWN",
  "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED", "SOURCE_FILE_UNAVAILABLE", "SOURCE_ASSET_UNVERIFIED", "SUBSCRIPTION_REQUIRED", "PREFLIGHT_FAILED", "PREFLIGHT_EXPIRED",
  "MODEL_INACTIVE", "MODEL_BINDING_MISMATCH", "BALANCE_INSUFFICIENT", "INTENT_ALREADY_CLAIMED", "OUTCOME_UNKNOWN",
  "RECOVERY_NOT_FOUND", "RESULT_PENDING_OR_UNVERIFIED", "OWNER_ECHO_UNVERIFIED"
]);

export const OWNER_HIGGSFIELD_DOP_TOOL_NAMES = Object.freeze([
  "syntx_owner_upload_higgsfield_dop_image",
  "syntx_owner_import_higgsfield_dop_image",
  "syntx_owner_get_higgsfield_dop_motions",
  "syntx_owner_generate_higgsfield_dop_video",
  "syntx_owner_get_higgsfield_dop_result",
  "syntx_owner_list_higgsfield_dop_recoveries"
] as const);

export interface OwnerHiggsfieldDopToolOptions {
  readonly referenceService: Pick<OwnerHiggsfieldDopReferenceService, "uploadReference">;
  readonly importService?: OwnerHiggsfieldDopImportService;
  readonly motionService: OwnerHiggsfieldDopMotionService;
  readonly generationService: Pick<OwnerHiggsfieldDopGenerationService, "generate" | "reconcile" | "listRecoveries">;
}

const attemptId = z.string().regex(ATTEMPT);
const recoveryId = z.string().regex(RECOVERY);
const modelId = z.enum(MODEL_IDS);
const motionId = z.union([z.string().min(1).max(160).refine(value => !/[\u0000-\u001f\u007f]/u.test(value)),
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]);
const motionSelection = z.object({ id: motionId, label: z.string().min(1).max(256), strength: z.literal(1) }).strict();
const motionInput = z.object({ link_attempt_id: attemptId }).strict();
const motionOutput = z.object({ motions: z.array(motionSelection).min(1).max(256), source: z.object({
  endpoint: z.literal("https://api.syntx.ai/api/v1/higgsfield/motions"), source_module: z.literal("app.js"),
  source_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  response_shape: z.literal("array<{id:string|number,title:string,preview_uri:string}>"), preview_uri_exposed: z.literal(false)
}).strict() }).strict();
const imageMime = z.enum(MIME_TYPES);
const uploadInput = z.object({ link_attempt_id: attemptId, model_id: modelId, filename: z.string().min(1).max(255),
  mime_type: imageMime, content_base64: z.string().min(4).max(MAX_BASE64).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u) }).strict();
const fileId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u);
const importInput = z.object({ link_attempt_id: attemptId, model_id: modelId, filename: z.string().min(1).max(255),
  mime_type: imageMime, content_base64: z.string().min(4).max(MAX_BASE64).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u),
  file_id: fileId, destination: z.literal("uploaded") }).strict();
const generateInput = z.object({ link_attempt_id: attemptId, model_id: modelId, prompt: z.string().min(1).max(1_000),
  enhance_prompt: z.literal(false), motions: z.array(motionSelection).min(1).max(2),
  reference_handle: z.string().regex(/^higgsfield_dop_reference_[0-9a-f-]{36}$/u) }).strict();
const resultInput = z.object({ link_attempt_id: attemptId, recovery_id: recoveryId }).strict();
const listInput = z.object({ link_attempt_id: attemptId }).strict();
const uploadOutput = z.object({ status: z.literal("uploaded"), reference_handle: z.string().regex(/^higgsfield_dop_reference_[0-9a-f-]{36}$/u),
  model_id: modelId, media_type: z.literal("image"), mime_type: imageMime, size: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  width: z.number().int().positive(), height: z.number().int().positive(), expires_in_seconds: z.number().int().nonnegative(),
  metadata_confidence: z.literal("CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS"),
  size_limit_confidence: z.literal("LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT"), provider_acceptance: z.literal("UNPROVEN"),
  upload_authority: z.literal(false), generation_permit: z.literal(false) }).strict();
const importOutput = z.object({ status: z.literal("imported"), reference_handle: z.string().regex(/^higgsfield_dop_reference_[0-9a-f-]{36}$/u),
  model_id: modelId, media_type: z.literal("image"), mime_type: imageMime, size: z.number().int().positive().max(MAX_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u), width: z.number().int().positive().max(8_400), height: z.number().int().positive().max(8_400),
  expires_in_seconds: z.number().int().nonnegative(), metadata_confidence: z.literal("CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS"),
  provenance: z.literal("OWNED_EXISTING_ACCOUNT_ASSET"), provider_acceptance: z.literal("UNPROVEN"), generation_permit: z.literal(false) }).strict();
const artifactOutput = z.object({ object_index: z.number().int().nonnegative(), message_object_id: z.string().min(1).max(160), object_type: z.literal("video"),
  object_url: z.string().url().max(4_096), mime_type: z.enum(["video/mp4", "video/quicktime"]).nullable(), message_id: z.string().min(1).max(160),
  chat_uuid: z.string().min(1).max(160), model_id: modelId }).strict();
const generationOutput = z.object({ status: z.enum(["completed", "outcome_unknown"]), recovery_id: recoveryId, model_id: modelId,
  status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"), provider_terminal_status: z.literal("UNPROVEN"), backend_acceptance: z.literal("UNPROVEN"),
  cost_cap_enforced: z.literal(false), durability: z.literal("PROCESS_LOCAL_ONLY"), observed_artifact_count: z.number().int().nonnegative(),
  artifacts: z.array(artifactOutput).max(64), gaps: z.array(z.string().max(160)).max(32) }).strict();
const recoveryListOutput = z.object({ recoveries: z.array(generationOutput).max(128) }).strict();

export function registerSyntxOwnerHiggsfieldDopTools(server: McpServer, optionsInput: OwnerHiggsfieldDopToolOptions | unknown): void {
  const options = snapshotOptions(optionsInput);
  server.registerTool(OWNER_HIGGSFIELD_DOP_TOOL_NAMES[0], {
    title: "Upload an owner Higgsfield DOP image",
    description: "Validates and uploads one owner image for Higgsfield DOP. The trusted owner runtime selects the upload destination; the URL is never returned.",
    inputSchema: uploadInput, outputSchema: uploadOutput,
    annotations: { title: "Upload DOP image", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    let bytes: Buffer | undefined;
    try {
      const data = uploadInput.parse(snapshotInput(input));
      bytes = strictBase64(data.content_base64);
      const result = await options.referenceService.uploadReference({ attemptId: data.link_attempt_id, model_id: data.model_id,
        filename: data.filename, mime_type: data.mime_type, bytes }, signal);
      return success(uploadOutput, result, "OUTPUT_INVALID");
    } catch (error) { return safeError(error); }
    finally { bytes?.fill(0); }
  });

  if (options.importService) {
    server.registerTool(OWNER_HIGGSFIELD_DOP_TOOL_NAMES[1], {
      title: "Import an existing owner Higgsfield DOP image",
      description: "Read-only import of one explicitly selected file id from the linked account's first uploaded-files page. The local image must match the owned R2 object byte-for-byte; no URL, credentials, upload, or generation is returned or performed.",
      inputSchema: importInput, outputSchema: importOutput,
      annotations: { title: "Import existing DOP image", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    }, async (input, { signal }) => {
      let bytes: Buffer | undefined;
      try {
        const data = importInput.parse(snapshotInput(input)); bytes = strictBase64(data.content_base64);
        const result = await options.importService!.importExisting({ attemptId: data.link_attempt_id, model_id: data.model_id,
          filename: data.filename, mime_type: data.mime_type, bytes, file_id: data.file_id, destination: data.destination }, signal);
        return success(importOutput, result, "OUTPUT_INVALID");
      } catch (error) { return safeError(error); }
      finally { bytes?.fill(0); }
    });
  }

  server.registerTool(OWNER_HIGGSFIELD_DOP_TOOL_NAMES[2], {
    title: "List current Higgsfield DOP motion options",
    description: "Reads the authenticated current DOP motion catalogue. Returns native IDs and labels only; preview URLs are omitted.",
    inputSchema: motionInput, outputSchema: motionOutput,
    annotations: { title: "Get DOP motion options", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input, { signal }) => {
    try {
      const data = motionInput.parse(snapshotInput(input));
      const result = await options.motionService.list({ attemptId: data.link_attempt_id }, signal);
      return success(motionOutput, { motions: result.motions, source: { endpoint: result.source.endpoint,
        source_module: result.source.source_module, source_sha256: result.source.source_sha256,
        response_shape: result.source.response_shape, preview_uri_exposed: false } }, "OUTPUT_INVALID");
    } catch (error) { return safeError(error); }
  });

  server.registerTool(OWNER_HIGGSFIELD_DOP_TOOL_NAMES[3], {
    title: "Generate a Higgsfield DOP video",
    description: "Submits one owner image with an explicit prompt using the initial Higgsfield DOP tuple. An uncertain generation is not retried.",
    inputSchema: generateInput, outputSchema: generationOutput,
    annotations: { title: "Generate DOP video", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    try {
      const data = generateInput.parse(snapshotInput(input));
      const result = await options.generationService.generate({ attemptId: data.link_attempt_id, model_id: data.model_id,
        prompt: data.prompt, enhance_prompt: data.enhance_prompt, motions: data.motions, reference_handle: data.reference_handle }, signal);
      return success(generationOutput, result, "OUTPUT_INVALID");
    } catch (error) { return safeError(error); }
  });

  server.registerTool(OWNER_HIGGSFIELD_DOP_TOOL_NAMES[4], {
    title: "Get a Higgsfield DOP result",
    description: "Reconciles one process-local DOP generation by owned GET reads only. It never repeats upload or generation.",
    inputSchema: resultInput, outputSchema: generationOutput,
    annotations: { title: "Get DOP result", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }) => {
    try {
      const data = resultInput.parse(snapshotInput(input));
      const result = await options.generationService.reconcile({ attemptId: data.link_attempt_id, recovery_id: data.recovery_id }, signal);
      return success(generationOutput, result, "OUTPUT_INVALID");
    } catch (error) { return safeError(error); }
  });

  server.registerTool(OWNER_HIGGSFIELD_DOP_TOOL_NAMES[5], {
    title: "List Higgsfield DOP recoveries",
    description: "Lists bounded process-local DOP observations for this linked owner. No upload or generation occurs.",
    inputSchema: listInput, outputSchema: recoveryListOutput,
    annotations: { title: "List DOP recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async input => {
    try {
      const data = listInput.parse(snapshotInput(input));
      const rows = await options.generationService.listRecoveries({ attemptId: data.link_attempt_id });
      return success(recoveryListOutput, { recoveries: rows }, "OUTPUT_INVALID");
    } catch (error) { return safeError(error); }
  });
}

function snapshotOptions(value: unknown): OwnerHiggsfieldDopToolOptions {
  const row = snapshotInput(value);
  if (!row || typeof row !== "object" || Array.isArray(row) || (Object.keys(row).length !== 3 && Object.keys(row).length !== 4) ||
      !Object.hasOwn(row, "referenceService") || !Object.hasOwn(row, "motionService") || !Object.hasOwn(row, "generationService") ||
      (Object.hasOwn(row, "importService") && !isOwnerHiggsfieldDopImportService((row as Record<string, unknown>).importService))) {
    throw new Error("INVALID_OWNER_HIGGSFIELD_DOP_TOOL_OPTIONS");
  }
  const fields = row as Record<string, unknown>;
  if (!isOwnerHiggsfieldDopReferenceService(fields.referenceService) || !isOwnerHiggsfieldDopMotionService(fields.motionService) ||
      !isOwnerHiggsfieldDopGenerationService(fields.generationService)) {
    throw new Error("INVALID_OWNER_HIGGSFIELD_DOP_TOOL_OPTIONS");
  }
  return Object.freeze({ referenceService: fields.referenceService as OwnerHiggsfieldDopToolOptions["referenceService"],
    ...(fields.importService === undefined ? {} : { importService: fields.importService as OwnerHiggsfieldDopImportService }),
    motionService: fields.motionService as OwnerHiggsfieldDopMotionService,
    generationService: fields.generationService as OwnerHiggsfieldDopToolOptions["generationService"] });
}
function snapshotInput(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value), result = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string" || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true) return undefined;
      result[key] = descriptors[key]!.value;
    }
    return result;
  } catch { return undefined; }
}
function strictBase64(value: string): Buffer {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 1 || bytes.length > MAX_BYTES || bytes.toString("base64") !== value) {
    bytes.fill(0); throw new Error("INVALID_REQUEST");
  }
  return bytes;
}
function success<T extends z.ZodType>(schema: T, value: unknown, failureCode: string) {
  const parsed = schema.safeParse(value);
  return parsed.success ? { content: [{ type: "text" as const, text: JSON.stringify(parsed.data) }],
    structuredContent: parsed.data as Record<string, unknown> } : errorResult(failureCode, recoveryFrom(value));
}
function safeError(value: unknown) {
  let code = "INVALID_REQUEST";
  if (value && typeof value === "object" && !types.isProxy(value)) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, "code");
      if (descriptor && Object.hasOwn(descriptor, "value") && typeof descriptor.value === "string" && ERROR_CODES.has(descriptor.value)) code = descriptor.value;
    } catch { /* sanitized fallback */ }
  }
  return errorResult(code, code === "OUTCOME_UNKNOWN" || code === "UPLOAD_OUTCOME_UNKNOWN" ? recoveryFrom(value) : undefined);
}
function recoveryFrom(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || types.isProxy(value)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "recovery_id");
    return descriptor && Object.hasOwn(descriptor, "value") && recoveryId.safeParse(descriptor.value).success ? descriptor.value as string : undefined;
  } catch { return undefined; }
}
function errorResult(code: string, recovery_id?: string) {
  const message = code === "UPLOAD_OUTCOME_UNKNOWN"
    ? "The image upload outcome may be unknown. Do not retry the upload or start generation with an unconfirmed image."
    : code === "OUTCOME_UNKNOWN"
      ? "The generation outcome may be unknown. Do not retry generation; use the GET-only result tool."
      : "The owner Higgsfield DOP operation could not be completed safely.";
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: { code,
    message,
    ...(recovery_id === undefined ? {} : { recovery_id }) } }) }] };
}
