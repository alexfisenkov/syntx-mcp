import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createHash } from "node:crypto";
import { types } from "node:util";
import { z } from "zod/v4";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import type { OwnerGrokI2vImageModelId } from "../application/owner-grok-i2v-image-policy.js";
import { OWNER_GROK_I2V_IMAGE_POLICY } from "../application/owner-grok-i2v-image-policy.js";
import { normalizeOwnerGrokI2vParameters } from "../application/owner-grok-i2v-parameters.js";
import type { OwnerGrokI2vGenerationResult } from "../application/owner-grok-i2v-generation-service.js";
import type { OwnerGrokI2vReferenceUploadReceipt } from "../application/owner-grok-i2v-reference-service.js";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const MAX_DIMENSION = 8_400;
const MAX_ARTIFACTS = 64;
const MODEL_IDS = ["grok_i2v", "grok_15_i2v"] as const;
const ASPECT_RATIOS = ["16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "1:1"] as const;
const RESOLUTIONS = ["480p", "720p"] as const;
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^grok_i2v_reference_[0-9a-f-]{36}$/u;
const RECOVERY = /^grok_i2v_recovery_[0-9a-f-]{36}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const ERROR_CODES = new Set([
  "INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "REQUEST_ABORTED", "CAPACITY_EXCEEDED", "CLOCK_INVALID",
  "PRINCIPAL_NOT_LINKED", "VALIDATION_REJECTED", "UPLOAD_OUTCOME_UNKNOWN", "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED",
  "MODEL_BINDING_MISMATCH", "PREFLIGHT_FAILED", "SUBSCRIPTION_REQUIRED", "INTENT_ALREADY_CLAIMED", "RECOVERY_NOT_FOUND",
  "ACK_UNVERIFIED", "HISTORY_BINDING_MISMATCH", "HISTORY_INCOMPLETE", "OPERATION_CONTEXT_INVALID", "OPERATION_NOT_DISPATCHED",
  "OWNER_ECHO_UNVERIFIED", "PREFLIGHT_EXPIRED", "RESULT_CHANGED", "RESULT_CONTEXT_INVALID", "RESULT_UNVERIFIED",
  "OWNER_GROK_I2V_BUDGET_UNAVAILABLE", "INVALID_PARAMETERS", "INVALID_COST_PARAMETERS"
]);

export const OWNER_GROK_I2V_TOOL_NAMES = Object.freeze([
  "syntx_owner_upload_grok_i2v_image",
  "syntx_owner_generate_grok_i2v_video",
  "syntx_owner_get_grok_i2v_result",
  "syntx_owner_list_grok_i2v_recoveries"
] as const);

export interface OwnerGrokI2vToolOptions {
  readonly referenceService: {
    uploadReference(input: unknown, signal?: AbortSignal): Promise<OwnerGrokI2vReferenceUploadReceipt | unknown>;
  };
  readonly generationService: {
    generate(input: unknown, signal?: AbortSignal): Promise<OwnerGrokI2vGenerationResult | unknown>;
    reconcile(input: unknown, signal?: AbortSignal): Promise<OwnerGrokI2vGenerationResult | unknown>;
    listRecoveries(input: unknown, signal?: AbortSignal): Promise<readonly (OwnerGrokI2vGenerationResult | unknown)[]>;
  };
}

const attempt = z.string().regex(ATTEMPT);
const modelId = z.enum(MODEL_IDS);
const mimeType = z.enum(IMAGE_MIMES);
const handle = z.string().regex(HANDLE);
const recoveryId = z.string().regex(RECOVERY);
const uploadInput = z.object({
  link_attempt_id: attempt,
  model_id: modelId,
  filename: z.string().min(1).max(255).refine(isSafeFilename),
  mime_type: mimeType,
  content_base64: z.string().min(4).max(MAX_BASE64_CHARS).regex(BASE64)
}).strict().superRefine((value, context) => {
  const extension = value.filename.slice(value.filename.lastIndexOf(".")).toLowerCase();
  const validExtension = value.mime_type === "image/jpeg" ? [".jpg", ".jpeg"].includes(extension)
    : value.mime_type === "image/png" ? extension === ".png" : extension === ".webp";
  if (!validExtension) context.addIssue({ code: "custom", path: ["filename"], message: "Filename extension must match image MIME." });
});
const generateInput = z.object({
  link_attempt_id: attempt,
  model_id: modelId,
  prompt: z.string().min(1).max(5_000).refine(isWellFormedUnicode),
  aspect_ratio: z.enum(ASPECT_RATIOS),
  video_duration: z.number().int().min(1).max(15),
  resolution: z.enum(RESOLUTIONS),
  reference_handle: handle
}).strict().superRefine((value, context) => {
  if (value.prompt.trim().length === 0) context.addIssue({ code: "custom", path: ["prompt"], message: "Prompt must not be blank." });
  if (value.model_id === "grok_i2v" && value.aspect_ratio !== "16:9") {
    context.addIssue({ code: "custom", path: ["aspect_ratio"], message: "Grok I2V supports only the restricted 16:9 slice." });
  }
  if (value.model_id === "grok_i2v" && value.video_duration !== 6 && value.video_duration !== 10) {
    context.addIssue({ code: "custom", path: ["video_duration"], message: "Grok I2V duration must be 6 or 10 seconds." });
  }
  if (value.model_id === "grok_15_i2v" && value.prompt.length > 2_000) {
    context.addIssue({ code: "custom", path: ["prompt"], message: "Prompt exceeds the local limit." });
  }
});
const resultInput = z.object({ link_attempt_id: attempt, recovery_id: recoveryId }).strict();
const listInput = z.object({ link_attempt_id: attempt }).strict();

const modelImageLimit = (id: OwnerGrokI2vImageModelId) => OWNER_GROK_I2V_IMAGE_POLICY.local_max_bytes[id];
const uploadOutput = z.object({
  status: z.literal("uploaded"), reference_handle: handle, model_id: modelId, media_type: z.literal("image"), mime_type: mimeType,
  size: z.number().int().min(1).max(MAX_IMAGE_BYTES), sha256: z.string().regex(SHA256),
  width: z.number().int().min(1).max(MAX_DIMENSION), height: z.number().int().min(1).max(MAX_DIMENSION),
  expires_in_seconds: z.number().int().min(0).max(900),
  metadata_confidence: z.literal("CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS"),
  size_limit_confidence: z.literal("LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT"),
  provider_acceptance: z.literal("UNPROVEN"), upload_authority: z.literal(false), generation_permit: z.literal(false)
}).strict();
const artifact = z.object({
  object_index: z.number().int().min(0).max(MAX_ARTIFACTS - 1),
  message_object_id: z.string().regex(SAFE_ID), object_type: z.literal("video"),
  object_url: z.string().url().max(4096).refine(isSafeUploadReferenceUrl),
  mime_type: z.enum(["video/mp4", "video/quicktime"]).nullable(),
  message_id: z.string().regex(SAFE_ID), chat_uuid: z.string().regex(SAFE_ID), model_id: modelId
}).strict().superRefine((value, context) => {
  const path = new URL(value.object_url).pathname.toLowerCase();
  const expected = path.endsWith(".mp4") ? "video/mp4" : path.endsWith(".mov") ? "video/quicktime" : null;
  if (expected !== value.mime_type) context.addIssue({ code: "custom", path: ["mime_type"], message: "Artifact MIME must match the safe URL extension." });
});
const generationOutput = z.object({
  status: z.enum(["completed", "outcome_unknown"]), recovery_id: recoveryId, model_id: modelId,
  status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"), provider_terminal_status: z.literal("UNPROVEN"),
  backend_acceptance: z.literal("UNPROVEN"), cost_cap_enforced: z.literal(false), durability: z.literal("PROCESS_LOCAL_ONLY"),
  observed_artifact_count: z.number().int().min(0).max(MAX_ARTIFACTS), artifacts: z.array(artifact).max(MAX_ARTIFACTS),
  gaps: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u)).max(32)
}).strict().superRefine((value, context) => {
  if (value.artifacts.length !== value.observed_artifact_count ||
      value.artifacts.some((row, index) => row.object_index !== index || row.model_id !== value.model_id)) {
    context.addIssue({ code: "custom", path: ["artifacts"], message: "Artifact rows must be contiguous and model-bound." });
  }
  const ids = new Set<string>(), urls = new Set<string>();
  value.artifacts.forEach((row, index) => {
    if (ids.has(row.message_object_id) || urls.has(row.object_url)) {
      context.addIssue({ code: "custom", path: ["artifacts", index], message: "Artifact IDs and URLs must be unique." });
    }
    ids.add(row.message_object_id); urls.add(row.object_url);
  });
  if ((value.status === "completed" && (value.artifacts.length === 0 || value.gaps.length !== 0)) ||
      (value.status === "outcome_unknown" && value.artifacts.length !== 0)) {
    context.addIssue({ code: "custom", path: ["status"], message: "Status must agree with observed artifacts and gaps." });
  }
});
const recoveryListOutput = z.object({ recoveries: z.array(generationOutput).max(128) }).strict();

/** Registers four exact owner-local Grok I2V image, generation, result, and recovery tools. */
export function registerSyntxOwnerGrokI2vTools(server: McpServer, optionsInput: OwnerGrokI2vToolOptions | unknown): void {
  const options = snapshotOptions(optionsInput);
  server.registerTool(OWNER_GROK_I2V_TOOL_NAMES[0], {
    title: "Upload one Grok I2V image",
    description: "Upload one bounded JPEG, PNG, or WebP image for the selected Grok I2V model. Per-model byte ceilings are local resource limits, not provider limits. The private URL is never returned.",
    inputSchema: uploadInput, outputSchema: uploadOutput,
    annotations: { title: "Upload one Grok I2V image", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    let bytes: Buffer | undefined;
    try {
      const data = uploadInput.parse(snapshotInput(input));
      const padding = data.content_base64.endsWith("==") ? 2 : data.content_base64.endsWith("=") ? 1 : 0;
      const expectedSize = data.content_base64.length / 4 * 3 - padding;
      if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > modelImageLimit(data.model_id)) return errorResult("INVALID_REQUEST");
      bytes = Buffer.from(data.content_base64, "base64");
      if (bytes.byteLength !== expectedSize || bytes.toString("base64") !== data.content_base64) return errorResult("INVALID_REQUEST");
      const expectedSha256 = createHash("sha256").update(bytes).digest("hex");
      const receipt = await options.referenceService.uploadReference({ attemptId: data.link_attempt_id,
        model_id: data.model_id, filename: data.filename, mime_type: data.mime_type, bytes }, signal);
      const parsed = uploadOutput.safeParse(receipt);
      if (!parsed.success || parsed.data.model_id !== data.model_id || parsed.data.mime_type !== data.mime_type ||
          parsed.data.size !== expectedSize || parsed.data.sha256 !== expectedSha256 ||
          parsed.data.size > modelImageLimit(data.model_id)) return errorResult("UPLOAD_OUTCOME_UNKNOWN");
      return success(uploadOutput, parsed.data, "UPLOAD_OUTCOME_UNKNOWN");
    } catch (error) { return safeError(error); }
    finally { bytes?.fill(0); }
  });

  server.registerTool(OWNER_GROK_I2V_TOOL_NAMES[1], {
    title: "Generate a Grok I2V video",
    description: "Starts one owner Grok image-to-video request with an uploaded opaque image handle. The quote is an affordability observation, not a provider cost cap. Never repeat a request with an uncertain result; use its recovery ID.",
    inputSchema: generateInput, outputSchema: generationOutput,
    annotations: { title: "Generate a Grok I2V video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    try {
      const data = generateInput.parse(snapshotInput(input));
      normalizeOwnerGrokI2vParameters({ model_id: data.model_id, prompt: data.prompt, aspect_ratio: data.aspect_ratio,
        video_duration: data.video_duration, resolution: data.resolution });
      const result = await options.generationService.generate({ attemptId: data.link_attempt_id, model_id: data.model_id,
        prompt: data.prompt, aspect_ratio: data.aspect_ratio, video_duration: data.video_duration,
        resolution: data.resolution, reference_handle: data.reference_handle }, signal);
      return success(generationOutput, result, "OUTCOME_UNKNOWN");
    } catch (error) { return safeError(error); }
  });

  server.registerTool(OWNER_GROK_I2V_TOOL_NAMES[2], {
    title: "Get Grok I2V result",
    description: "Read-only GET reconciliation for one process-local Grok I2V recovery. It does not repeat upload or generation.",
    inputSchema: resultInput, outputSchema: generationOutput,
    annotations: { title: "Get Grok I2V result", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }) => {
    try {
      const data = resultInput.parse(snapshotInput(input));
      const result = await options.generationService.reconcile({ attemptId: data.link_attempt_id, recovery_id: data.recovery_id }, signal);
      return success(generationOutput, result, "OUTCOME_UNKNOWN");
    } catch (error) { return safeError(error); }
  });

  server.registerTool(OWNER_GROK_I2V_TOOL_NAMES[3], {
    title: "List Grok I2V recoveries",
    description: "List this linked owner's bounded process-local Grok I2V observations. No provider dispatch occurs.",
    inputSchema: listInput, outputSchema: recoveryListOutput,
    annotations: { title: "List Grok I2V recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async input => {
    try {
      const data = listInput.parse(snapshotInput(input));
      const rows = await options.generationService.listRecoveries({ attemptId: data.link_attempt_id });
      return success(recoveryListOutput, { recoveries: rows }, "OUTPUT_INVALID");
    } catch (error) { return safeError(error); }
  });
}

function snapshotOptions(value: unknown): OwnerGrokI2vToolOptions {
  const row = snapshotInput(value);
  if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== 2 ||
      !Object.hasOwn(row, "referenceService") || !Object.hasOwn(row, "generationService")) throw new Error("INVALID_OWNER_GROK_I2V_TOOL_OPTIONS");
  const fields = row as Record<string, unknown>;
  if (!validPort(fields.referenceService, ["uploadReference"]) ||
      !validPort(fields.generationService, ["generate", "reconcile", "listRecoveries"])) throw new Error("INVALID_OWNER_GROK_I2V_TOOL_OPTIONS");
  return Object.freeze({ referenceService: fields.referenceService as OwnerGrokI2vToolOptions["referenceService"],
    generationService: fields.generationService as OwnerGrokI2vToolOptions["generationService"] });
}
function validPort(value: unknown, names: readonly string[]): boolean {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  for (const name of names) {
    let current: object | null = value, found = false;
    while (current) {
      const descriptor = Object.getOwnPropertyDescriptor(current, name);
      if (descriptor) { if (!("value" in descriptor) || typeof descriptor.value !== "function") return false; found = true; break; }
      current = Object.getPrototypeOf(current) as object | null;
    }
    if (!found) return false;
  }
  return true;
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
function isSafeFilename(value: string): boolean {
  return value !== "." && value !== ".." && !/[\\/\p{Cc}\p{Cf}\p{Cs}]/u.test(value) &&
    Buffer.byteLength(value, "utf8") <= 255 && isWellFormedUnicode(value);
}
function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(index + 1); if (next < 0xdc00 || next > 0xdfff) return false; index += 1; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function success<T extends z.ZodType>(schema: T, value: unknown, failureCode: string): CallToolResult {
  const parsed = schema.safeParse(value);
  return parsed.success
    ? { content: [{ type: "text", text: JSON.stringify(parsed.data) }], structuredContent: parsed.data as Record<string, unknown> }
    : errorResult(failureCode, recoveryFrom(value));
}
function safeError(value: unknown): CallToolResult {
  let code = "INVALID_REQUEST";
  if (value && typeof value === "object" && !types.isProxy(value)) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, "code");
      if (descriptor && Object.hasOwn(descriptor, "value") && typeof descriptor.value === "string" && ERROR_CODES.has(descriptor.value)) code = descriptor.value;
    } catch { /* generic sanitized code */ }
  }
  return errorResult(code, code === "OUTCOME_UNKNOWN" || code === "UPLOAD_OUTCOME_UNKNOWN" ? recoveryFrom(value) : undefined);
}
function recoveryFrom(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || types.isProxy(value)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "recovery_id");
    return descriptor && Object.hasOwn(descriptor, "value") && recoveryId.safeParse(descriptor.value).success
      ? descriptor.value as string : undefined;
  } catch { return undefined; }
}
function errorResult(code: string, recovery_id?: string): CallToolResult {
  const unknown = code === "OUTCOME_UNKNOWN" || code === "UPLOAD_OUTCOME_UNKNOWN";
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code,
    message: unknown ? "The upload or generation result may be unknown. Do not retry generation; use the GET-only recovery tool."
      : "The owner Grok I2V operation could not be completed safely.",
    ...(recovery_id === undefined ? {} : { recovery_id }) } }) }] };
}
