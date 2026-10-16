import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { types } from "node:util";
import { z } from "zod/v4";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { getOwnerKling4SourceProfile, normalizeOwnerKling4Parameters } from "../application/owner-kling4-parameters.js";

export const OWNER_KLING4_TOOL_NAMES = Object.freeze([
  "syntx_owner_get_kling4_source", "syntx_owner_upload_kling4_reference", "syntx_owner_generate_kling4_video",
  "syntx_owner_reconcile_kling4_video", "syntx_owner_list_kling4_recoveries", "syntx_owner_get_kling4_result_page"
] as const);
export interface OwnerKling4ToolOptions {
  readonly maxVideoFileBytes?: number;
  readonly referenceService: { uploadReference(input: unknown, signal?: AbortSignal): Promise<unknown> };
  readonly generationService: {
    generate(input: unknown, signal?: AbortSignal): Promise<unknown>;
    reconcile(input: unknown, signal?: AbortSignal): Promise<unknown>;
    listRecoveries(input: unknown): Promise<readonly unknown[]>;
    getResultPage(input: unknown): Promise<unknown>;
  };
}
const IMAGE_CAP = 30 * 1024 * 1024;
const VIDEO_CAP = 300 * 1024 * 1024;
const MAX_RESULTS = 4096;
const model = z.enum(["kling_4_keyframes", "kling_4_omni"]);
const attempt = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const handle = z.string().regex(/^kling4_reference_[0-9a-f-]{36}$/u);
const recovery = z.string().regex(/^kling4_recovery_[0-9a-f-]{36}$/u);
const sha = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const mime = z.enum(["image/jpg", "image/jpeg", "image/png", "image/avif", "video/mp4", "video/quicktime"]);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u);
const diagnostic = z.object({ phase: z.enum(["VALIDATE_REQUEST", "PREFLIGHT_ONE", "CHAT_CREATE", "PREFLIGHT_TWO", "GENERATION_POST",
  "POST_ACK_KNOWN", "HISTORY_GET", "RESULT_GET"]), post_started: z.boolean(), ack_known: z.boolean(),
  history_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "INCOMPLETE", "UNVERIFIED"]),
  owner_ack_status: z.enum(["NOT_READ", "MATCHED", "MISSING", "AMBIGUOUS", "MISMATCH"]),
  request_echo_status: z.enum(["NOT_READ", "MATCHED", "ABSENT", "PARTIAL_UNPROVEN", "CONTRADICTORY"]),
  history_get_calls: z.number().int().nonnegative(), result_get_calls: z.number().int().nonnegative(),
  result_status: z.enum(["NOT_READ", "COMPLETE", "UNVERIFIED"]), gaps: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u)).max(32)
}).strict();
const resultSchema = z.object({ status: z.literal("completed"), status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"),
  backend_acceptance: z.literal("UNPROVEN"), provider_terminal_status: z.literal("UNPROVEN"), cost_cap_enforced: z.literal(false),
  output_count: z.literal("UNKNOWN"), recovery_id: recovery, model_id: model,
  source_binding: z.object({ public_catalog_version: z.literal(getOwnerKling4SourceProfile("kling_4_omni").source_catalog_version),
    profile_sha256: sha, request_fingerprint: sha, intent_fingerprint: sha }).strict(),
  observed_artifact_count: z.number().int().min(1).max(MAX_RESULTS), offset: z.number().int().min(0).max(MAX_RESULTS), page_size: z.literal(64),
  artifacts: z.array(z.object({ object_index: z.number().int().nonnegative(), message_object_id: id, object_type: z.literal("video"),
    object_url: z.string().max(4096).refine(isSafeUploadReferenceUrl), mime_type: z.enum(["video/mp4", "video/quicktime"]).nullable(),
    mime_source: z.enum(["URL_EXTENSION", "UNKNOWN"]), message_id: id, chat_uuid: id, model_id: model }).strict()).max(64),
  has_more: z.boolean(), next_offset: z.number().int().min(0).max(MAX_RESULTS).nullable(), diagnostic
}).strict().refine(value => {
  const next = value.offset + value.artifacts.length;
  return value.source_binding.profile_sha256 === getOwnerKling4SourceProfile(value.model_id).source_sha256 &&
    value.artifacts.every(x => x.model_id === value.model_id && x.mime_source === (x.mime_type === null ? "UNKNOWN" : "URL_EXTENSION")) &&
    value.offset <= value.observed_artifact_count && value.artifacts.length === Math.min(64, value.observed_artifact_count - value.offset) &&
    value.has_more === (next < value.observed_artifact_count) && value.next_offset === (value.has_more ? next : null);
});
const recoveryListSchema = z.object({ recoveries: z.array(z.object({ recovery_id: recovery, model_id: model, created_at: z.iso.datetime(),
  status: z.enum(["outcome_unknown", "completed"]), observed_artifact_count: z.number().int().min(0).max(MAX_RESULTS), diagnostic
}).strict()).max(128) }).strict();
const generationInput = z.object({ link_attempt_id: attempt, model_id: model, prompt: z.string().max(24000), version: z.literal("4.0"),
  mode: z.enum(["standart", "hd"]), aspect_ratio: z.enum(["16:9", "1:1", "9:16", "21:9"]),
  video_duration: z.number().int().min(3).max(30), native_audio: z.boolean(), reference_handles: z.array(handle).max(15)
}).strict();
const recoveryInput = z.object({ link_attempt_id: attempt, recovery_id: recovery }).strict();
const listInput = z.object({ link_attempt_id: attempt, limit: z.number().int().min(1).max(128).optional() }).strict();
const pageInput = z.object({ link_attempt_id: attempt, recovery_id: recovery, offset: z.number().int().min(0).max(MAX_RESULTS).optional() }).strict();
const sourceSchema = z.object({ profile: z.record(z.string(), z.unknown()), local_policy: z.object({
  max_image_file_bytes: z.literal(IMAGE_CAP), max_video_file_bytes: z.number().int().positive().max(VIDEO_CAP),
  reference_ttl_seconds: z.literal(900), input_inspection: z.literal("LOCAL_METADATA_ONLY_NO_DECODE"),
  image_subset: z.literal("JPEG_PNG_AV1_AVIF_CONSERVATIVE_STRUCTURE"), durability: z.literal("PROCESS_LOCAL_ONLY"),
  price_or_provider_cost_cap: z.literal("NOT_ENFORCED_BY_PROVIDER") }).strict(), backend_acceptance: z.literal("UNPROVEN")
}).strict();
const ERRORS = new Set(["INVALID_REQUEST", "OUTPUT_INVALID", "SERVICE_CLOSED", "SERVICE_BUSY", "CAPACITY_EXCEEDED", "REQUEST_ABORTED",
  "PRINCIPAL_NOT_LINKED", "VALIDATION_REJECTED", "UPLOAD_OUTCOME_UNKNOWN", "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED", "MODEL_BINDING_MISMATCH",
  "PREFLIGHT_FAILED", "SUBSCRIPTION_REQUIRED", "SUBSCRIPTION_STATUS_UNVERIFIED", "INTENT_ALREADY_CLAIMED", "PRE_DISPATCH_FAILED",
  "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"]);

/** Six owner-local tools. Raw private URLs, role/slot fields and quote quantities are not inputs. */
export function registerSyntxOwnerKling4Tools(server: McpServer, options: OwnerKling4ToolOptions): void {
  const videoCap = options.maxVideoFileBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(videoCap) || videoCap < 1 || videoCap > VIDEO_CAP) throw new Error("INVALID_KLING4_OPERATOR_CAP");
  const maxEncoded = Math.ceil(Math.max(IMAGE_CAP, videoCap) / 3) * 4;
  const uploadInput = z.object({ link_attempt_id: attempt, model_id: model, filename: z.string().min(1).max(255), mime_type: mime,
    content_base64: z.string().min(4).max(maxEncoded).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u)
  }).strict();
  const uploadOutput = z.object({ status: z.literal("uploaded"), reference_handle: handle, model_id: model, kind: z.enum(["image", "video"]),
    mime_type: mime, size: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/u), width: z.number().int().positive(),
    height: z.number().int().positive(), duration_seconds: z.number().positive().max(30).nullable(), input_cost_duration_seconds: z.number().positive().nullable(),
    expires_in_seconds: z.number().int().min(0).max(900), input_confidence: z.literal("LOCAL_METADATA_ONLY_NO_DECODE")
  }).strict().refine(value => value.kind === "image"
    ? value.mime_type.startsWith("image/") && value.mime_type !== "image/jpg" && value.duration_seconds === null &&
      value.input_cost_duration_seconds === null && value.size <= IMAGE_CAP && value.width >= 300 && value.height >= 300 &&
      value.width <= 10000 && value.height <= 10000 && value.width / value.height >= 0.4 && value.width / value.height <= 2.5
    : value.model_id === "kling_4_omni" && value.mime_type.startsWith("video/") && value.size <= videoCap && value.duration_seconds !== null &&
      value.duration_seconds >= 3 && value.input_cost_duration_seconds !== null && value.width >= 700 && value.height >= 700 &&
      value.width <= 10000 && value.height <= 10000);
  server.registerTool(OWNER_KLING4_TOOL_NAMES[0], { title: "Get Kling 4 controls and limits",
    description: "Pinned controls for exactly Kling 4 Keyframes or Omni, with separate configured local limits. Source evidence is not provider acceptance. No network or generation.",
    inputSchema: z.object({ model_id: model }).strict(), outputSchema: sourceSchema, annotations: hints(true, false)
  }, async input => success(sourceSchema, { profile: getOwnerKling4SourceProfile(input.model_id), local_policy: {
    max_image_file_bytes: IMAGE_CAP, max_video_file_bytes: videoCap, reference_ttl_seconds: 900,
    input_inspection: "LOCAL_METADATA_ONLY_NO_DECODE", image_subset: "JPEG_PNG_AV1_AVIF_CONSERVATIVE_STRUCTURE", durability: "PROCESS_LOCAL_ONLY",
    price_or_provider_cost_cap: "NOT_ENFORCED_BY_PROVIDER" }, backend_acceptance: "UNPROVEN" }));
  server.registerTool(OWNER_KLING4_TOOL_NAMES[1], { title: "Upload one Kling 4 reference",
    description: "Upload owner-supplied bytes into the linked account. Keyframes: image only; Omni: image or video. Canonical base64, model-specific local metadata validation, opaque 15-minute handle; no upload URL returned. Never repeat an uncertain upload.",
    inputSchema: uploadInput, outputSchema: uploadOutput, annotations: hints(false, true)
  }, async (input, { signal }) => {
    let bytes: Buffer | undefined;
    try {
      const data = uploadInput.parse(input), video = data.mime_type.startsWith("video/");
      const padding = data.content_base64.endsWith("==") ? 2 : data.content_base64.endsWith("=") ? 1 : 0;
      const length = data.content_base64.length / 4 * 3 - padding;
      if (video && data.model_id !== "kling_4_omni" || !Number.isSafeInteger(length) || length < 1 || length > (video ? videoCap : IMAGE_CAP)) return errorCode("INVALID_REQUEST");
      bytes = Buffer.from(data.content_base64, "base64");
      if (bytes.length !== length || bytes.toString("base64") !== data.content_base64) return errorCode("INVALID_REQUEST");
      const output = await options.referenceService.uploadReference({ attemptId: data.link_attempt_id, model_id: data.model_id,
        filename: data.filename, mime_type: data.mime_type, bytes }, signal);
      const parsed = uploadOutput.safeParse(output), expectedMime = data.mime_type === "image/jpg" ? "image/jpeg" : data.mime_type;
      if (!parsed.success || parsed.data.model_id !== data.model_id || parsed.data.size !== length || parsed.data.mime_type !== expectedMime ||
          parsed.data.kind !== (video ? "video" : "image")) return errorCode("UPLOAD_OUTCOME_UNKNOWN");
      return success(uploadOutput, parsed.data, "UPLOAD_OUTCOME_UNKNOWN");
    } catch (error) { return safeError(error); } finally { bytes?.fill(0); }
  });
  server.registerTool(OWNER_KLING4_TOOL_NAMES[2], { title: "Generate one Kling 4 video",
    description: "One non-idempotent generation for exact Keyframes/Omni using explicit version4.0, mode, ratio, output seconds, native audio, and ordered owned handles. Keyframes audio must be true and image count <= min(seconds+1,10). Omni <=10 images/5 videos and <=30 selected input video seconds. [[ref:N]] uses one-based handle order. Active paid plan/live quote/balance checks; no provider cost cap. Uncertainty requires GET-only recovery, never another generation.",
    inputSchema: generationInput, outputSchema: resultSchema, annotations: hints(false, true)
  }, async (input, { signal }) => {
    try {
      const { link_attempt_id, ...fields } = generationInput.parse(input), raw = { ...fields, attemptId: link_attempt_id };
      normalizeOwnerKling4Parameters(raw);
      const output = await options.generationService.generate(raw, signal), parsed = resultSchema.safeParse(output);
      if (!parsed.success || parsed.data.model_id !== fields.model_id) return invalidOutput(output, "OUTCOME_UNKNOWN");
      return success(resultSchema, parsed.data, "OUTCOME_UNKNOWN");
    } catch (error) { return safeError(error); }
  });
  server.registerTool(OWNER_KLING4_TOOL_NAMES[3], { title: "Reconcile Kling 4 video (GET only)",
    description: "Read only this linked owner's existing recovery. No upload, chat creation or generation retry.",
    inputSchema: recoveryInput, outputSchema: resultSchema, annotations: hints(true, true)
  }, async (input, { signal }) => {
    try { const { link_attempt_id, recovery_id } = recoveryInput.parse(input);
      return success(resultSchema, await options.generationService.reconcile({ attemptId: link_attempt_id, recovery_id }, signal), "OUTCOME_UNKNOWN");
    } catch (error) { return safeError(error); }
  });
  server.registerTool(OWNER_KLING4_TOOL_NAMES[4], { title: "List Kling 4 recoveries",
    description: "Bounded process-local recovery list for this linked owner. No provider dispatch.",
    inputSchema: listInput, outputSchema: recoveryListSchema, annotations: hints(true, false)
  }, async input => {
    try { const { link_attempt_id, ...fields } = listInput.parse(input);
      return success(recoveryListSchema, { recoveries: await options.generationService.listRecoveries({ attemptId: link_attempt_id, ...fields }) });
    } catch (error) { return safeError(error); }
  });
  server.registerTool(OWNER_KLING4_TOOL_NAMES[5], { title: "Read Kling 4 result page",
    description: "Page through already observed results for this linked owner; no provider retry or new generation.",
    inputSchema: pageInput, outputSchema: resultSchema, annotations: hints(true, false)
  }, async input => {
    try { const { link_attempt_id, ...fields } = pageInput.parse(input);
      return success(resultSchema, await options.generationService.getResultPage({ attemptId: link_attempt_id, ...fields }), "OUTCOME_UNKNOWN");
    } catch (error) { return safeError(error); }
  });
}
function hints(readOnly: boolean, openWorld: boolean) {
  return { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: readOnly, openWorldHint: openWorld };
}
function success<T extends z.ZodType>(schema: T, value: unknown, failure = "OUTPUT_INVALID"): CallToolResult {
  const parsed = schema.safeParse(value);
  return parsed.success ? { content: [{ type: "text", text: JSON.stringify(parsed.data) }], structuredContent: parsed.data as Record<string, unknown> }
    : invalidOutput(value, failure);
}
function invalidOutput(value: unknown, failure: string): CallToolResult {
  let recoveryId: string | undefined;
  if (failure === "OUTCOME_UNKNOWN" && value && typeof value === "object" && !types.isProxy(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, "recovery_id");
    if (descriptor && Object.hasOwn(descriptor, "value") && recovery.safeParse(descriptor.value).success) recoveryId = descriptor.value as string;
  }
  return errorCode(failure, recoveryId);
}
function safeError(value: unknown): CallToolResult {
  let code = "INVALID_REQUEST", recoveryId: string | undefined;
  if (value && typeof value === "object" && !types.isProxy(value)) {
    const c = Object.getOwnPropertyDescriptor(value, "code"), r = Object.getOwnPropertyDescriptor(value, "recovery_id");
    if (c && Object.hasOwn(c, "value") && typeof c.value === "string" && ERRORS.has(c.value)) code = c.value;
    if (code === "OUTCOME_UNKNOWN" && r && Object.hasOwn(r, "value") && recovery.safeParse(r.value).success) recoveryId = r.value as string;
  }
  return errorCode(code, recoveryId);
}
function errorCode(code: string, recoveryId?: string): CallToolResult {
  const unknown = code === "OUTCOME_UNKNOWN" || code === "UPLOAD_OUTCOME_UNKNOWN";
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code,
    message: unknown ? "The operation may have been dispatched; do not retry. Use GET-only reconciliation with its recovery handle if available."
      : "The owner Kling 4 operation could not be completed safely.", ...(recoveryId === undefined ? {} : { recovery_id: recoveryId }) } }) }] };
}
