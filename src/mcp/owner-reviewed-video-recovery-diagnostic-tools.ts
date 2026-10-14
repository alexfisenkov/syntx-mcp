import { types } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import {
  OWNER_REVIEWED_VIDEO_ACK_OBSERVATIONS,
  OWNER_REVIEWED_VIDEO_HISTORY_OBSERVATIONS,
  OWNER_REVIEWED_VIDEO_NO_ARTIFACT_REASONS,
  OWNER_REVIEWED_VIDEO_POST_DISPOSITIONS,
  OWNER_REVIEWED_VIDEO_RECOVERY_PHASES,
  OWNER_REVIEWED_VIDEO_RESULT_BINDING_OBSERVATIONS,
  OWNER_REVIEWED_VIDEO_SAFE_ERROR_CODES,
  type OwnerReviewedVideoRecoveryDiagnostic
} from "../application/owner-reviewed-video-recovery-diagnostic.js";
import { OwnerReviewedNoReferenceT2vServiceError } from "../application/owner-reviewed-no-reference-t2v-service.js";

export const SYNTX_OWNER_GET_VIDEO_RECOVERY_DIAGNOSTIC_TOOL_NAME = "syntx_owner_get_video_recovery_diagnostic" as const;

export const OWNER_REVIEWED_VIDEO_RECOVERY_DIAGNOSTIC_MODEL_IDS = Object.freeze([
  "hailuo-01", "hailuo-01-director", "hailuo-02", "hailuo-2.3", "hailuo-01-live", "seedance-2.0",
  "kling_text2video", "kling_o1_text2video", "veo3", "veo3fast", "veo3fast_r", "grok_t2v"
] as const);

export type OwnerReviewedVideoRecoveryDiagnosticModelId = typeof OWNER_REVIEWED_VIDEO_RECOVERY_DIAGNOSTIC_MODEL_IDS[number];

export type OwnerReviewedVideoRecoveryDiagnosticGetter = (input: {
  readonly attemptId: string;
  readonly recovery_id: string;
}) => Promise<OwnerReviewedVideoRecoveryDiagnostic>;

export interface RegisterSyntxOwnerReviewedVideoRecoveryDiagnosticToolsOptions {
  readonly diagnostics: ReadonlyMap<OwnerReviewedVideoRecoveryDiagnosticModelId, OwnerReviewedVideoRecoveryDiagnosticGetter>;
}

const modelIdSchema = z.enum(OWNER_REVIEWED_VIDEO_RECOVERY_DIAGNOSTIC_MODEL_IDS);
const inputSchema = z.object({
  model_id: modelIdSchema,
  link_attempt_id: z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u),
  recovery_id: z.string().regex(/^recovery_[0-9a-f-]{36}$/u)
}).strict();

const diagnosticSchema = z.object({
  phase: z.enum(OWNER_REVIEWED_VIDEO_RECOVERY_PHASES),
  post_disposition: z.enum(OWNER_REVIEWED_VIDEO_POST_DISPOSITIONS),
  ack_observation: z.enum(OWNER_REVIEWED_VIDEO_ACK_OBSERVATIONS),
  history_observation: z.enum(OWNER_REVIEWED_VIDEO_HISTORY_OBSERVATIONS),
  result_binding_observation: z.enum(OWNER_REVIEWED_VIDEO_RESULT_BINDING_OBSERVATIONS),
  last_safe_error_code: z.enum(OWNER_REVIEWED_VIDEO_SAFE_ERROR_CODES).nullable(),
  no_artifact_reason: z.enum(OWNER_REVIEWED_VIDEO_NO_ARTIFACT_REASONS),
  poll_usage: z.object({
    history_get_calls: z.object({ count: z.number().int().min(0).max(256), capped: z.boolean() }).strict(),
    in_progress_get_calls: z.object({ count: z.number().int().min(0).max(256), capped: z.boolean() }).strict(),
    result_get_calls: z.object({ count: z.number().int().min(0).max(256), capped: z.boolean() }).strict()
  }).strict()
}).strict();

const outputSchema = z.object({ model_id: modelIdSchema, diagnostic: diagnosticSchema }).strict();

export function registerSyntxOwnerReviewedVideoRecoveryDiagnosticTools(
  server: McpServer,
  optionsInput: RegisterSyntxOwnerReviewedVideoRecoveryDiagnosticToolsOptions | unknown
): void {
  const options = snapshotOptions(optionsInput);
  server.registerTool(SYNTX_OWNER_GET_VIDEO_RECOVERY_DIAGNOSTIC_TOOL_NAME, {
    title: "Get an owner video recovery diagnostic",
    description: "Reads only the process-owned diagnostic snapshot for one exact linked owner attempt, reviewed video model, and recovery handle. This local observation performs no native HTTP, reconciliation, generation, account read, provider-state inference, or recovery lifecycle action.",
    inputSchema,
    outputSchema,
    annotations: { title: "Get an owner video recovery diagnostic", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input): Promise<CallToolResult> => {
    let copied: Record<string, unknown>;
    try { copied = snapshotInput(input); }
    catch { return errorResult("INVALID_REQUEST"); }
    const parsed = inputSchema.safeParse(copied);
    if (!parsed.success) return errorResult("INVALID_REQUEST");

    const getter = options.diagnostics.get(parsed.data.model_id);
    if (getter === undefined) return errorResult("MODEL_UNAVAILABLE");
    try {
      const diagnostic = snapshotDiagnostic(await getter({
        attemptId: parsed.data.link_attempt_id,
        recovery_id: parsed.data.recovery_id
      }));
      const output = outputSchema.parse({ model_id: parsed.data.model_id, diagnostic });
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output as unknown as Record<string, unknown>
      };
    } catch (error) {
      return errorResult(safeErrorCode(error));
    }
  });
}

function snapshotOptions(value: unknown): Readonly<{ diagnostics: ReadonlyMap<OwnerReviewedVideoRecoveryDiagnosticModelId, OwnerReviewedVideoRecoveryDiagnosticGetter> }> {
  const record = readClosedRecord(value, ["diagnostics"]);
  const source = record.diagnostics;
  if (source === null || typeof source !== "object" || types.isProxy(source) || !(source instanceof Map) ||
      Object.getPrototypeOf(source) !== Map.prototype || Reflect.ownKeys(source).length !== 0) {
    throw new Error("VIDEO_RECOVERY_DIAGNOSTIC_COMPOSITION_INVALID");
  }
  const sizeGetter = Object.getOwnPropertyDescriptor(Map.prototype, "size")?.get;
  const sourceSize = sizeGetter?.call(source);
  if (typeof sourceSize !== "number" || sourceSize === 0) throw new Error("VIDEO_RECOVERY_DIAGNOSTIC_COMPOSITION_INVALID");
  const allowed = new Set<string>(OWNER_REVIEWED_VIDEO_RECOVERY_DIAGNOSTIC_MODEL_IDS);
  const diagnostics = new Map<OwnerReviewedVideoRecoveryDiagnosticModelId, OwnerReviewedVideoRecoveryDiagnosticGetter>();
  for (const [modelId, getter] of Map.prototype.entries.call(source) as MapIterator<[unknown, unknown]>) {
    if (typeof modelId !== "string" || !allowed.has(modelId) || typeof getter !== "function") {
      throw new Error("VIDEO_RECOVERY_DIAGNOSTIC_COMPOSITION_INVALID");
    }
    diagnostics.set(modelId as OwnerReviewedVideoRecoveryDiagnosticModelId, getter as OwnerReviewedVideoRecoveryDiagnosticGetter);
  }
  return Object.freeze({ diagnostics });
}

function snapshotInput(value: unknown): Record<string, unknown> {
  return readClosedRecord(value, ["model_id", "link_attempt_id", "recovery_id"]);
}

function snapshotDiagnostic(value: unknown): OwnerReviewedVideoRecoveryDiagnostic {
  const record = readClosedRecord(value, ["phase", "post_disposition", "ack_observation", "history_observation",
    "result_binding_observation", "last_safe_error_code", "no_artifact_reason", "poll_usage"]);
  const poll = readClosedRecord(record.poll_usage, ["history_get_calls", "in_progress_get_calls", "result_get_calls"]);
  const pollUsage = {
    history_get_calls: readClosedRecord(poll.history_get_calls, ["count", "capped"]),
    in_progress_get_calls: readClosedRecord(poll.in_progress_get_calls, ["count", "capped"]),
    result_get_calls: readClosedRecord(poll.result_get_calls, ["count", "capped"])
  };
  return diagnosticSchema.parse({
    phase: record.phase,
    post_disposition: record.post_disposition,
    ack_observation: record.ack_observation,
    history_observation: record.history_observation,
    result_binding_observation: record.result_binding_observation,
    last_safe_error_code: record.last_safe_error_code,
    no_artifact_reason: record.no_artifact_reason,
    poll_usage: pollUsage
  });
}

function readClosedRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new Error("INVALID_RECORD");
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("INVALID_RECORD");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))) throw new Error("INVALID_RECORD");
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) throw new Error("INVALID_RECORD");
      output[key] = descriptor.value;
    }
    return output;
  } catch {
    throw new Error("INVALID_RECORD");
  }
}

type SafeDiagnosticErrorCode = "INVALID_REQUEST" | "MODEL_UNAVAILABLE" | "RECOVERY_NOT_FOUND" | "DIAGNOSTIC_UNAVAILABLE";

function safeErrorCode(error: unknown): SafeDiagnosticErrorCode {
  if (error === null || (typeof error === "object" && types.isProxy(error))) return "DIAGNOSTIC_UNAVAILABLE";
  if (error instanceof OwnerReviewedNoReferenceT2vServiceError) {
    if (error.code === "INVALID_REQUEST") return "INVALID_REQUEST";
    if (error.code === "RECOVERY_NOT_FOUND") return "RECOVERY_NOT_FOUND";
  }
  return "DIAGNOSTIC_UNAVAILABLE";
}

function errorResult(code: SafeDiagnosticErrorCode): CallToolResult {
  const message: Record<SafeDiagnosticErrorCode, string> = {
    INVALID_REQUEST: "The video recovery diagnostic request is invalid.",
    MODEL_UNAVAILABLE: "The selected reviewed video recovery diagnostic is unavailable.",
    RECOVERY_NOT_FOUND: "The owner video recovery is unavailable or expired.",
    DIAGNOSTIC_UNAVAILABLE: "The owner video recovery diagnostic is unavailable."
  };
  const output = { error: { code, message: message[code] } };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(output) }] };
}
