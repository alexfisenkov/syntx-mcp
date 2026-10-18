import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { types } from "node:util";
import { z } from "zod/v4";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";

const MODEL_ID = "seedance-2.5-editor" as const;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const DEFAULT_VIDEO_BYTES = 64 * 1024 * 1024;
const MAX_BASE64 = Math.ceil(MAX_VIDEO_BYTES / 3) * 4;
const MAX_ARTIFACTS = 64;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^seedance_editor_reference_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RECOVERY = /^seedance_editor_recovery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const ERROR_CODES = new Set([
  "INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "CAPACITY_EXCEEDED", "REQUEST_ABORTED",
  "PRINCIPAL_NOT_LINKED", "VALIDATION_REJECTED", "UPLOAD_OUTCOME_UNKNOWN", "REFERENCE_UNAVAILABLE",
  "REFERENCE_EXPIRED", "MODEL_BINDING_MISMATCH", "PREFLIGHT_FAILED", "SUBSCRIPTION_REQUIRED",
  "SUBSCRIPTION_STATUS_UNVERIFIED", "INTENT_ALREADY_CLAIMED", "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN",
  "RECOVERY_NOT_FOUND", "CLOCK_INVALID", "ACK_UNVERIFIED", "HISTORY_BINDING_MISMATCH", "HISTORY_INCOMPLETE",
  "OPERATION_CONTEXT_INVALID", "OPERATION_NOT_DISPATCHED", "OWNER_ECHO_UNVERIFIED", "PREFLIGHT_EXPIRED",
  "RESULT_CHANGED", "RESULT_CONTEXT_INVALID", "RESULT_UNVERIFIED", "INVALID_PARAMETERS"
]);

export const OWNER_SEEDANCE_EDITOR_TOOL_NAMES = Object.freeze([
  "syntx_owner_upload_seedance_editor_video",
  "syntx_owner_generate_seedance_editor_video",
  "syntx_owner_reconcile_seedance_editor_video",
  "syntx_owner_list_seedance_editor_recoveries"
] as const);

export interface OwnerSeedanceEditorToolOptions {
  readonly maxVideoFileBytes?: number;
  readonly referenceService: {
    uploadReference(input: unknown, signal?: AbortSignal): Promise<unknown>;
  };
  readonly generationService: {
    generate(input: unknown, signal?: AbortSignal): Promise<unknown>;
    reconcile(input: unknown, signal?: AbortSignal): Promise<unknown>;
    listRecoveries(input: unknown, signal?: AbortSignal): Promise<readonly unknown[]>;
  };
}

const attempt = z.string().regex(ATTEMPT);
const handle = z.string().regex(HANDLE);
const recoveryId = z.string().regex(RECOVERY);
const uploadInput = z.object({
  link_attempt_id: attempt, model_id: z.literal(MODEL_ID), filename: z.string().min(1).max(255),
  mime_type: z.enum(["video/mp4", "video/quicktime"]), content_base64: z.string().min(4).max(MAX_BASE64)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u)
}).strict().superRefine((value, context) => {
  if ((value.mime_type === "video/mp4" && !value.filename.toLowerCase().endsWith(".mp4")) ||
      (value.mime_type === "video/quicktime" && !/\.mov$/iu.test(value.filename))) {
    context.addIssue({ code: "custom", path: ["filename"], message: "The filename extension must match the video MIME type." });
  }
});
const generateInput = z.object({
  link_attempt_id: attempt, model_id: z.literal(MODEL_ID), prompt: z.string().min(1).max(5_000).refine(isWellFormedUnicode),
  resolution: z.enum(["480p", "720p", "1080p"]), reference_handle: handle
}).strict().refine(value => value.prompt.trim().length > 0, "Prompt must not be blank.");
const reconcileInput = z.object({ link_attempt_id: attempt, recovery_id: recoveryId }).strict();
const listInput = z.object({ link_attempt_id: attempt }).strict();

const artifact = z.object({
  object_index: z.number().int().nonnegative(),
  message_object_id: z.string().regex(SAFE_ID),
  object_type: z.literal("video"),
  object_url: z.string().url().max(4096).refine(isSafeUploadReferenceUrl),
  mime_type: z.enum(["video/mp4", "video/quicktime"]).nullable(),
  message_id: z.string().regex(SAFE_ID),
  chat_uuid: z.string().regex(SAFE_ID),
  model_id: z.literal(MODEL_ID)
}).strict();
const resultSchema = z.object({
  status: z.enum(["completed", "outcome_unknown"]),
  recovery_id: recoveryId,
  model_id: z.literal(MODEL_ID),
  status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"),
  provider_terminal_status: z.literal("UNPROVEN"),
  backend_acceptance: z.literal("UNPROVEN"),
  cost_cap_enforced: z.literal(false),
  durability: z.literal("PROCESS_LOCAL_ONLY"),
  observed_artifact_count: z.number().int().min(0).max(MAX_ARTIFACTS),
  artifacts: z.array(artifact).max(MAX_ARTIFACTS),
  gaps: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u)).max(32)
}).strict().superRefine((value, context) => {
  if (value.artifacts.length !== value.observed_artifact_count ||
      value.artifacts.some((item, index) => item.object_index !== index)) {
    context.addIssue({ code: "custom", path: ["artifacts"], message: "Artifact count and indices must match the complete local result." });
  }
  if ((value.status === "completed" && (value.artifacts.length < 1 || value.gaps.length !== 0)) ||
      (value.status === "outcome_unknown" && (value.artifacts.length !== 0 || value.observed_artifact_count !== 0))) {
    context.addIssue({ code: "custom", path: ["status"], message: "Status must agree with the complete artifact snapshot and gaps." });
  }
  const messageObjects = new Set<string>(), urls = new Set<string>();
  for (const [index, item] of value.artifacts.entries()) {
    const path = new URL(item.object_url).pathname.toLowerCase();
    const expectedMime = path.endsWith(".mp4") ? "video/mp4" : path.endsWith(".mov") ? "video/quicktime" : null;
    if (item.mime_type !== expectedMime) {
      context.addIssue({ code: "custom", path: ["artifacts", index, "mime_type"], message: "MIME metadata must match the safe URL extension." });
    }
    if (messageObjects.has(item.message_object_id) || urls.has(item.object_url)) {
      context.addIssue({ code: "custom", path: ["artifacts", index], message: "Artifact object IDs and URLs must be unique." });
    }
    messageObjects.add(item.message_object_id); urls.add(item.object_url);
  }
});
const uploadOutput = z.object({
  status: z.literal("uploaded"), reference_handle: handle, model_id: z.literal(MODEL_ID), kind: z.literal("video"),
  mime_type: z.enum(["video/mp4", "video/quicktime"]), size: z.number().int().min(1).max(MAX_VIDEO_BYTES),
  sha256: z.string().regex(SHA256), width: z.number().int().positive(), height: z.number().int().positive(),
  duration_seconds: z.number().finite().min(4).max(30), expires_in_seconds: z.number().int().min(0).max(900),
  input_confidence: z.literal("LOCAL_METADATA_ONLY_NO_DECODE")
}).strict();
const recoveriesOutput = z.object({ recoveries: z.array(resultSchema).max(128) }).strict();

/** Four exact-model owner-local Seedance Editor upload, one-shot and recovery tools. */
export function registerSyntxOwnerSeedanceEditorTools(server: McpServer, optionsInput: OwnerSeedanceEditorToolOptions | unknown): void {
  const options = snapshotOptions(optionsInput);
  const videoCap = options.maxVideoFileBytes ?? DEFAULT_VIDEO_BYTES;
  if (!Number.isSafeInteger(videoCap) || videoCap < 1 || videoCap > MAX_VIDEO_BYTES) throw new Error("INVALID_SEEDANCE_EDITOR_VIDEO_CAP");

  const boundedUploadInput = uploadInput.safeExtend({ content_base64: z.string().min(4).max(Math.ceil(videoCap / 3) * 4)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u) }).strict();
  const boundedUploadOutput = uploadOutput.extend({ size: z.number().int().min(1).max(videoCap) }).strict();

  server.registerTool(OWNER_SEEDANCE_EDITOR_TOOL_NAMES[0], {
    title: "Upload one Seedance Editor source video",
    description: "Upload one owner-supplied MP4 or MOV for the no-frame Seedance Editor path. Local validation inspects bounded media metadata only and returns an opaque handle; the private upload URL is never returned. Do not retry an uncertain upload.",
    inputSchema: boundedUploadInput, outputSchema: boundedUploadOutput,
    annotations: { title: "Upload one Seedance Editor source video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    let bytes: Buffer | undefined;
    try {
      const data = boundedUploadInput.parse(snapshotInput(input));
      const padding = data.content_base64.endsWith("==") ? 2 : data.content_base64.endsWith("=") ? 1 : 0;
      const expectedLength = data.content_base64.length / 4 * 3 - padding;
      if (!Number.isSafeInteger(expectedLength) || expectedLength < 1 || expectedLength > videoCap) return errorResult("INVALID_REQUEST");
      bytes = Buffer.from(data.content_base64, "base64");
      if (bytes.length !== expectedLength || bytes.toString("base64") !== data.content_base64) return errorResult("INVALID_REQUEST");
      const value = await options.referenceService.uploadReference({ attemptId: data.link_attempt_id, model_id: MODEL_ID,
        filename: data.filename, mime_type: data.mime_type, bytes }, signal);
      const parsed = boundedUploadOutput.safeParse(value);
      if (!parsed.success || parsed.data.size !== expectedLength || parsed.data.mime_type !== data.mime_type) return errorResult("UPLOAD_OUTCOME_UNKNOWN");
      return success(boundedUploadOutput, parsed.data, "UPLOAD_OUTCOME_UNKNOWN");
    } catch (error) { return safeError(error); }
    finally { bytes?.fill(0); }
  });

  server.registerTool(OWNER_SEEDANCE_EDITOR_TOOL_NAMES[1], {
    title: "Generate one Seedance Editor video",
    description: "Experimental no-frame request using an opaque owner-uploaded source video. Live end-to-end provider generation is not yet confirmed. Resolution and prompt are explicit. The provider cost is not capped; if dispatch is uncertain, reconcile the returned recovery ID and never repeat generation. Safe HTTP and transport metadata may appear in gaps; they do not prove provider acceptance or terminal status.",
    inputSchema: generateInput, outputSchema: resultSchema,
    annotations: { title: "Generate one Seedance Editor video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    try {
      const data = generateInput.parse(snapshotInput(input));
      const result = await options.generationService.generate({ attemptId: data.link_attempt_id, model_id: MODEL_ID,
        prompt: data.prompt, resolution: data.resolution, reference_handle: data.reference_handle }, signal);
      return success(resultSchema, result, "OUTCOME_UNKNOWN");
    } catch (error) { return safeError(error); }
  });

  server.registerTool(OWNER_SEEDANCE_EDITOR_TOOL_NAMES[2], {
    title: "Reconcile Seedance Editor generation (GET only)",
    description: "Read the existing process-local recovery for this linked owner. This does not upload, create a chat, or repeat generation.",
    inputSchema: reconcileInput, outputSchema: resultSchema,
    annotations: { title: "Reconcile Seedance Editor generation (GET only)", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }) => {
    try {
      const data = reconcileInput.parse(snapshotInput(input));
      const result = await options.generationService.reconcile({ attemptId: data.link_attempt_id, recovery_id: data.recovery_id }, signal);
      return success(resultSchema, result, "OUTCOME_UNKNOWN");
    } catch (error) { return safeError(error); }
  });

  server.registerTool(OWNER_SEEDANCE_EDITOR_TOOL_NAMES[3], {
    title: "List Seedance Editor recoveries",
    description: "List only this linked owner's bounded process-local Seedance Editor recoveries. No provider dispatch occurs.",
    inputSchema: listInput, outputSchema: recoveriesOutput,
    annotations: { title: "List Seedance Editor recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async input => {
    try {
      const data = listInput.parse(snapshotInput(input));
      const result = await options.generationService.listRecoveries({ attemptId: data.link_attempt_id });
      return success(recoveriesOutput, { recoveries: result });
    } catch (error) { return safeError(error); }
  });
}

function snapshotOptions(value: unknown): OwnerSeedanceEditorToolOptions {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new Error("INVALID_SEEDANCE_EDITOR_TOOL_OPTIONS");
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    const allowed = ["referenceService", "generationService", "maxVideoFileBytes"];
    if (Object.getPrototypeOf(value) !== Object.prototype || keys.length < 2 || keys.length > 3 ||
        keys.some(key => typeof key !== "string" || !allowed.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true) ||
        !Object.hasOwn(descriptors, "referenceService") || !Object.hasOwn(descriptors, "generationService")) throw new Error();
    const referenceService = descriptors.referenceService!.value, generationService = descriptors.generationService!.value;
    if (!validPort(referenceService, ["uploadReference"]) || !validPort(generationService, ["generate", "reconcile", "listRecoveries"])) throw new Error();
    return Object.freeze({ referenceService: referenceService as OwnerSeedanceEditorToolOptions["referenceService"],
      generationService: generationService as OwnerSeedanceEditorToolOptions["generationService"],
      ...(Object.hasOwn(descriptors, "maxVideoFileBytes") ? { maxVideoFileBytes: descriptors.maxVideoFileBytes!.value as number } : {}) });
  } catch { throw new Error("INVALID_SEEDANCE_EDITOR_TOOL_OPTIONS"); }
}
function validPort(value: unknown, names: readonly string[]): boolean {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  for (const name of names) {
    let current: object | null = value, found = false;
    while (current) {
      const descriptor = Object.getOwnPropertyDescriptor(current, name);
      if (descriptor) { if (!("value" in descriptor) || typeof descriptor.value !== "function") return false; found = true; break; }
      current = Object.getPrototypeOf(current);
    }
    if (!found) return false;
  }
  return true;
}
function snapshotInput(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return undefined;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string" || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true) return undefined;
      result[key] = descriptors[key]!.value;
    }
    return result;
  } catch { return undefined; }
}
function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index++;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function success<T extends z.ZodType>(schema: T, value: unknown, failure = "OUTPUT_INVALID"): CallToolResult {
  const parsed = schema.safeParse(value);
  return parsed.success
    ? { content: [{ type: "text", text: JSON.stringify(parsed.data) }], structuredContent: parsed.data as Record<string, unknown> }
    : errorResult(failure, recoveryFrom(value));
}
function safeError(value: unknown): CallToolResult {
  let code = "INVALID_REQUEST";
  if (value && typeof value === "object" && !types.isProxy(value)) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, "code");
      if (descriptor && Object.hasOwn(descriptor, "value") && typeof descriptor.value === "string" && ERROR_CODES.has(descriptor.value)) code = descriptor.value;
    } catch { /* use the generic safe error */ }
  }
  return errorResult(code, code === "OUTCOME_UNKNOWN" || code === "UPLOAD_OUTCOME_UNKNOWN" ? recoveryFrom(value) : undefined);
}
function recoveryFrom(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || types.isProxy(value)) return undefined;
  try { const descriptor = Object.getOwnPropertyDescriptor(value, "recovery_id"); return descriptor && Object.hasOwn(descriptor, "value") && recoveryId.safeParse(descriptor.value).success ? descriptor.value as string : undefined; }
  catch { return undefined; }
}
function errorResult(code: string, recovery_id?: string): CallToolResult {
  const unknown = code === "OUTCOME_UNKNOWN" || code === "UPLOAD_OUTCOME_UNKNOWN";
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code,
    message: unknown ? "Dispatch may have occurred; do not retry. Use GET-only reconciliation with the recovery ID."
      : "The Seedance Editor owner operation could not be completed safely.",
    ...(recovery_id === undefined ? {} : { recovery_id }) } }) }] };
}
