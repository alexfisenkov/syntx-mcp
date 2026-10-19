import { types } from "node:util";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  OwnerSwitchxVideoGenerationServiceError,
  type OwnerSwitchxVideoGenerationService,
  type OwnerSwitchxVideoGenerationResult
} from "../application/owner-switchx-video-generation-service.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY = /^switchx_video_recovery_[0-9a-f-]{36}$/u;
const OUTPUT_URL = z.string().url().max(4_096);
const ERROR_CODES = new Set(["INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH",
  "PREFLIGHT_FAILED", "INVALID_VIDEO", "LOCAL_LIMIT_EXCEEDED", "INPUT_VIDEO_NOT_IN_INITIAL_SLICE", "INTENT_ALREADY_CLAIMED",
  "UPLOAD_OUTCOME_UNKNOWN", "CHAT_OUTCOME_UNKNOWN", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"]);

export const OWNER_SWITCHX_VIDEO_TOOL_NAMES = Object.freeze([
  "syntx_owner_get_switchx_video_source",
  "syntx_owner_generate_switchx_video",
  "syntx_owner_reconcile_switchx_video",
  "syntx_owner_list_switchx_video_recoveries"
] as const);

export interface RegisterSyntxOwnerSwitchxVideoToolsOptions {
  readonly service: Pick<OwnerSwitchxVideoGenerationService, "getSourceProfile" | "generate" | "reconcile" | "listRecoveries">;
}

const sourceOutput = z.object({
  status: z.literal("CURRENT_1792363638_FORM_AND_PUBLIC_ROW_SOURCE_BOUNDED_PROVIDER_UNPROVEN"),
  source_pins: z.record(z.string(), z.unknown()), model_id: z.literal("switchx"), ai_name: z.literal("beeble"), scope: z.literal("video"),
  selector: z.record(z.string(), z.unknown()), initial_tuple: z.record(z.string(), z.unknown()),
  cost_parameter_keys: z.array(z.string()), cost_parameter_sources: z.record(z.string(), z.unknown()),
  prompt: z.record(z.string(), z.unknown()), public_video_bounds: z.record(z.string(), z.unknown()),
  input_binding: z.string(), settings: z.record(z.string(), z.unknown()), upload_transport: z.record(z.string(), z.unknown()),
  source_gaps: z.array(z.string()), local_probe_scope: z.string(), provider_acceptance: z.literal("UNPROVEN")
}).strict();
const artifact = z.object({ url: OUTPUT_URL, mime_type: z.enum(["video/mp4", "video/quicktime"]).optional(),
  byte_size: z.number().int().nonnegative().optional(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional(),
  duration_seconds: z.number().nonnegative().optional() }).strict();
const diagnostic = z.object({ phase: z.enum(["VALIDATE", "UPLOAD", "PREFLIGHT_CHAT", "CHAT_CREATE", "PREFLIGHT_GENERATION",
  "GENERATION_POST", "ACK_KNOWN", "HISTORY_GET", "RESULT_GET", "RESULT_BINDING"]), upload_attempted: z.boolean(),
  chat_created: z.boolean(), generation_post_started: z.boolean(), owner_ack_known: z.boolean(),
  history_get_calls: z.number().int().nonnegative(), result_get_calls: z.number().int().nonnegative(), gaps: z.array(z.string()).max(16) }).strict();
const resultOutput = z.object({ status: z.literal("completed"), status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"),
  backend_acceptance: z.literal("UNPROVEN"), provider_terminal_status: z.literal("UNPROVEN"), cost_cap_enforced: z.literal(false),
  recovery_id: z.string().regex(RECOVERY), model_id: z.literal("switchx"), source_binding: z.object({
    public_catalog_version: z.literal("sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json"),
    profile_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u), source_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    input_size: z.number().int().positive().max(10 * 1024 * 1024), width: z.number().int().positive(), height: z.number().int().positive(),
    video_duration: z.literal(5), frame_rate: z.literal(24)
  }).strict(), artifacts: z.array(artifact).min(1).max(16), diagnostics: diagnostic }).strict();
const recoveryList = z.object({ recoveries: z.array(z.object({ recovery_id: z.string().regex(RECOVERY), model_id: z.literal("switchx"),
  status: z.enum(["outcome_unknown", "completed"]), observed_artifact_count: z.number().int().nonnegative(), diagnostics: diagnostic }).strict()).max(20) }).strict();

export function registerSyntxOwnerSwitchxVideoTools(server: McpServer, optionsInput: RegisterSyntxOwnerSwitchxVideoToolsOptions | unknown): void {
  const service = snapshotOptions(optionsInput).service;
  server.registerTool(OWNER_SWITCHX_VIDEO_TOOL_NAMES[0], { title: "Get Switchx measured-video source profile",
    description: "Returns the exact source-bounded Switchx initial video slice: 1280×720 input, 720P output, auto mask, 5 seconds, and 24 fps, plus measured cost keys. It does not prove UI-store parity, backend/provider acceptance, or a quote amount.",
    inputSchema: z.object({}).strict(), outputSchema: sourceOutput,
    annotations: { title: "Get Switchx measured-video source profile", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (): Promise<CallToolResult> => {
    try { const value = sourceOutput.parse(service.getSourceProfile());
      return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value as unknown as Record<string, unknown> };
    } catch { return safeError(new OwnerSwitchxVideoGenerationServiceError("MODEL_BINDING_MISMATCH")); }
  });

  const generationInput = z.object({ link_attempt_id: z.string().regex(ATTEMPT), prompt: z.string().min(1).max(1_000),
    filename: z.string().min(1).max(255), mime_type: z.enum(["video/mp4", "video/quicktime"]),
    content_base64: z.string().min(1).max(14_000_000) }).strict();
  server.registerTool(OWNER_SWITCHX_VIDEO_TOOL_NAMES[1], { title: "Generate one Switchx video from an owned source clip",
    description: "Uses exactly one locally probed owner MP4/MOV for Switchx. The initial source slice requires 1280×720 input, exactly 5 seconds and 24 fps; output is fixed to 720P with auto mask. Other source dimensions or duration/frame-rate combinations are not enabled by this slice. The local 10 MiB transport and 1,000 UTF-16 prompt limits are not provider limits. Upload destination is trusted runtime configuration, not caller input. One upload and one non-idempotent GEN only; uncertain GEN must use GET-only reconciliation.",
    inputSchema: generationInput, outputSchema: resultOutput,
    annotations: { title: "Generate one Switchx video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const data = generationInput.parse(snapshotInput(input));
      const result = await service.generate({ attemptId: data.link_attempt_id, prompt: data.prompt, filename: data.filename,
        mime_type: data.mime_type, content_base64: data.content_base64 }, signal);
      return structuredSuccess(result);
    } catch (error) { return safeError(error); }
  });

  const recoveryInput = z.object({ link_attempt_id: z.string().regex(ATTEMPT), recovery_id: z.string().regex(RECOVERY) }).strict();
  server.registerTool(OWNER_SWITCHX_VIDEO_TOOL_NAMES[2], { title: "Reconcile one Switchx result (GET only)",
    description: "Reads the existing Switchx owner acknowledgement, bounded history, and one result message. It never uploads, creates a chat, checks a quote, or retries generation.",
    inputSchema: recoveryInput, outputSchema: resultOutput,
    annotations: { title: "Reconcile one Switchx result (GET only)", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try { const data = recoveryInput.parse(snapshotInput(input));
      return structuredSuccess(await service.reconcile({ attemptId: data.link_attempt_id, recovery_id: data.recovery_id }, signal));
    } catch (error) { return safeError(error); }
  });

  server.registerTool(OWNER_SWITCHX_VIDEO_TOOL_NAMES[3], { title: "List Switchx generation recoveries",
    description: "Lists bounded process-local Switchx recovery ids without account reads, uploads, chats, or generation.",
    inputSchema: z.object({ link_attempt_id: z.string().regex(ATTEMPT), limit: z.number().int().min(1).max(20).default(20) }).strict(),
    outputSchema: recoveryList,
    annotations: { title: "List Switchx generation recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input): Promise<CallToolResult> => {
    try { const data = snapshotInput(input) as { link_attempt_id: string; limit: number };
      const value = recoveryList.parse({ recoveries: service.listRecoveries({ attemptId: data.link_attempt_id, limit: data.limit }) });
      return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value as unknown as Record<string, unknown> };
    } catch (error) { return safeError(error); }
  });
}

function snapshotOptions(value: unknown): RegisterSyntxOwnerSwitchxVideoToolsOptions {
  const row = snapshotInput(value);
  if (!row || typeof row !== "object" || Object.keys(row).length !== 1 || !Object.hasOwn(row, "service")) throw new Error("INVALID_SWITCHX_VIDEO_TOOL_OPTIONS");
  const service = (row as Record<string, unknown>).service;
  if (!service || typeof service !== "object" || types.isProxy(service) || typeof Reflect.get(service, "generate") !== "function" ||
      typeof Reflect.get(service, "reconcile") !== "function" || typeof Reflect.get(service, "listRecoveries") !== "function" ||
      typeof Reflect.get(service, "getSourceProfile") !== "function") throw new Error("INVALID_SWITCHX_VIDEO_TOOL_OPTIONS");
  return Object.freeze({ service: service as RegisterSyntxOwnerSwitchxVideoToolsOptions["service"] });
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
function structuredSuccess(value: OwnerSwitchxVideoGenerationResult): CallToolResult {
  const parsed = resultOutput.safeParse(value);
  return parsed.success ? { content: [{ type: "text", text: JSON.stringify(parsed.data) },
      { type: "text", text: "Switchx backend/provider acceptance remains unproven." }],
    structuredContent: parsed.data as unknown as Record<string, unknown> }
    : safeError(new OwnerSwitchxVideoGenerationServiceError("OUTCOME_UNKNOWN"));
}
function safeError(error: unknown): CallToolResult {
  const code = error instanceof OwnerSwitchxVideoGenerationServiceError && ERROR_CODES.has(error.code) ? error.code : "SWITCHX_VIDEO_UNAVAILABLE";
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code,
    message: code === "OUTCOME_UNKNOWN" ? "Generation may have been dispatched; do not retry. Use GET-only reconciliation."
      : code === "INPUT_VIDEO_NOT_IN_INITIAL_SLICE" || code === "INVALID_VIDEO"
        ? "Switchx accepts only the enabled 1280×720 input slice at exactly 5 seconds and 24 fps; INVALID_VIDEO can also mean the local video could not be validated."
        : code === "LOCAL_LIMIT_EXCEEDED" ? "The input exceeds the local 10 MiB validation or upload limit."
          : "The Switchx video operation could not be completed safely.",
    ...(error instanceof OwnerSwitchxVideoGenerationServiceError && error.recovery_id ? { recovery_id: error.recovery_id } : {}),
    ...(error instanceof OwnerSwitchxVideoGenerationServiceError && error.diagnostics ? { diagnostics: error.diagnostics } : {}) } }) }] };
}
