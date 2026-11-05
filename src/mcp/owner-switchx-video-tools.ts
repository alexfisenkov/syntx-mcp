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
  "syntx_owner_list_switchx_video_recoveries",
  "syntx_owner_upload_switchx_reference"
] as const);

export interface RegisterSyntxOwnerSwitchxVideoToolsOptions {
  readonly service: Pick<OwnerSwitchxVideoGenerationService, "getSourceProfile" | "generate" | "reconcile" | "listRecoveries" | "uploadReference">;
}

const sourceOutput = z.object({
  status: z.literal("CURRENT_1792363638_FORM_AND_PUBLIC_ROW_SOURCE_BOUNDED_PROVIDER_UNPROVEN"),
  source_pins: z.record(z.string(), z.unknown()), model_id: z.literal("switchx"), ai_name: z.literal("beeble"), scope: z.literal("video"),
  selector: z.record(z.string(), z.unknown()), initial_tuple: z.record(z.string(), z.unknown()),
  cost_parameter_keys: z.array(z.string()), cost_parameter_sources: z.record(z.string(), z.unknown()),
  prompt: z.record(z.string(), z.unknown()), public_video_bounds: z.record(z.string(), z.unknown()),
  input_binding: z.string(), settings: z.record(z.string(), z.unknown()), upload_transport: z.record(z.string(), z.unknown()),
  current_source_controls: z.record(z.string(), z.unknown()),
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
    public_catalog_version: z.enum(["sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json", "sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json"]),
    profile_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u), source_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    input_size: z.number().int().positive().max(100 * 1024 * 1024), width: z.number().int().positive(), height: z.number().int().positive(),
    video_duration: z.number().int().min(1).max(10), frame_rate: z.number().int().min(1).max(240)
  }).strict(), artifacts: z.array(artifact).min(1).max(16), diagnostics: diagnostic }).strict();
const recoveryList = z.object({ recoveries: z.array(z.object({ recovery_id: z.string().regex(RECOVERY), model_id: z.literal("switchx"),
  status: z.enum(["outcome_unknown", "completed"]), observed_artifact_count: z.number().int().nonnegative(), diagnostics: diagnostic }).strict()).max(20) }).strict();

export function registerSyntxOwnerSwitchxVideoTools(server: McpServer, optionsInput: RegisterSyntxOwnerSwitchxVideoToolsOptions | unknown): void {
  const service = snapshotOptions(optionsInput).service;
  server.registerTool(OWNER_SWITCHX_VIDEO_TOOL_NAMES[0], { title: "Get Switchx measured-video source profile",
    description: "Returns the historical source profile plus separately pinned current controls: auto/fill/image/video masks, optional style image, measured duration/fps, conditional1080 and240-frame segment policy. Source review does not prove provider acceptance or saved UI defaults.",
    inputSchema: z.object({}).strict(), outputSchema: sourceOutput,
    annotations: { title: "Get Switchx measured-video source profile", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (): Promise<CallToolResult> => {
    try { const value = sourceOutput.parse(service.getSourceProfile());
      return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value as unknown as Record<string, unknown> };
    } catch { return safeError(new OwnerSwitchxVideoGenerationServiceError("MODEL_BINDING_MISMATCH")); }
  });

  const generationInput = z.object({ link_attempt_id: z.string().regex(ATTEMPT), prompt: z.string().max(2_000),
    filename: z.string().min(1).max(255), mime_type: z.enum(["video/mp4", "video/quicktime"]),
    content_base64: z.string().min(1).max(139_810_136), resolution: z.enum(["720P", "1080P"]).optional(),
    mask_mode: z.enum(["auto", "fill", "image", "video"]).optional(), style_image_handle: z.string().regex(/^switchx_reference_[0-9a-f-]{36}$/u).optional(),
    mask_handle: z.string().regex(/^switchx_reference_[0-9a-f-]{36}$/u).optional(), segment: z.object({ start_seconds: z.number().finite().nonnegative(), end_seconds: z.number().finite().positive() }).strict().optional() }).strict();
  server.registerTool(OWNER_SWITCHX_VIDEO_TOOL_NAMES[1], { title: "Generate one Switchx video from an owned source clip",
    description: "One owner MP4/MOV foreground, at most10 seconds/100MiB and240 measured frames. Duration/fps are rounded from trusted local measurements; optional segment explicitly transcodes only the selected window using operator ffmpeg and remeasures it. No segment preserves original bytes.720P default;1080P requires foreground minimum side1080. auto/fill require no mask; image/video require same-owner image_mask/video_mask handle. Optional style_image handle permits empty prompt; otherwise prompt required (max2000). Mask is not a background. Uploaded handles expire15min. One GEN; unknown POST is GET-only, never retried.",
    inputSchema: generationInput, outputSchema: resultOutput,
    annotations: { title: "Generate one Switchx video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const data = generationInput.parse(snapshotInput(input));
      const result = await service.generate({ attemptId: data.link_attempt_id, prompt: data.prompt, filename: data.filename,
        mime_type: data.mime_type, content_base64: data.content_base64, resolution: data.resolution, mask_mode: data.mask_mode,
        style_image_handle: data.style_image_handle, mask_handle: data.mask_handle, segment: data.segment }, signal);
      return structuredSuccess(result);
    } catch (error) { return safeError(error); }
  });

  const referenceInput = z.object({ link_attempt_id: z.string().regex(ATTEMPT), role: z.enum(["style_image", "image_mask", "video_mask"]),
    filename: z.string().min(1).max(255), mime_type: z.enum(["image/jpeg", "image/jpg", "image/png", "image/webp", "video/mp4", "video/quicktime"]),
    content_base64: z.string().min(1).max(139_810_136) }).strict();
  const referenceOutput = z.object({ reference_handle: z.string().regex(/^switchx_reference_[0-9a-f-]{36}$/u), model_id: z.literal("switchx"),
    role: z.enum(["style_image", "image_mask", "video_mask"]), mime_type: z.string(), bytes: z.number().int().positive().max(104857600),
    width: z.number().int().positive(), height: z.number().int().positive(), expires_at: z.string(), generation_permit: z.literal(false), source_confidence: z.string() }).strict();
  server.registerTool(OWNER_SWITCHX_VIDEO_TOOL_NAMES[4], { title: "Upload an owned Switchx style or mask reference",
    description: "Uploads a style_image (JPEG/PNG/WEBP max27,525,120B), image_mask (already prepared binary/inverted PNG mask), or video_mask (MP4/MOV max10s/100MiB). A mask is not a background image. Returns a role/owner/client-bound process-local15min handle, no private URL. Container metadata validation does not prove mask pixel semantics or provider acceptance. Does not generate.",
    inputSchema: referenceInput, outputSchema: referenceOutput, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try { const data = referenceInput.parse(snapshotInput(input)); const result = referenceOutput.parse(await service.uploadReference({ attemptId: data.link_attempt_id,
      role: data.role, filename: data.filename, mime_type: data.mime_type, content_base64: data.content_base64 }, signal));
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    } catch { return safeError(new OwnerSwitchxVideoGenerationServiceError("INVALID_REQUEST")); }
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
        ? "Switchx requires valid measured input at most10 seconds/240 frames; use an explicit selected segment for longer frame counts."
        : code === "LOCAL_LIMIT_EXCEEDED" ? "The input exceeds the100MiB public/local resource bound."
          : "The Switchx video operation could not be completed safely.",
    ...(error instanceof OwnerSwitchxVideoGenerationServiceError && error.recovery_id ? { recovery_id: error.recovery_id } : {}),
    ...(error instanceof OwnerSwitchxVideoGenerationServiceError && error.diagnostics ? { diagnostics: error.diagnostics } : {}) } }) }] };
}
