import { types } from "node:util";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isOwnerHeygen4ReferenceService, type OwnerHeygen4ReferenceService } from "../application/owner-heygen4-reference-service.js";
import { isOwnerHeygen4GenerationService, type OwnerHeygen4GenerationService } from "../application/owner-heygen4-generation-service.js";

const ATTEMPT = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u), FILE_ID = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u);
const HANDLE = /^heygen4_(?:image|audio)_[0-9a-f-]{36}$/u, MAX_BYTES = 10 * 1024 * 1024, MAX_BASE64 = Math.ceil(MAX_BYTES / 3) * 4;
const imageMime = z.enum(["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"]);
const audioMime = z.enum(["audio/wav", "audio/mp3", "audio/mpeg", "audio/x-wav", "audio/m4a", "audio/mp4"]);
export const OWNER_HEYGEN4_TOOL_NAMES = Object.freeze(["syntx_owner_get_heygen4_source", "syntx_owner_import_heygen4_asset",
  "syntx_owner_get_heygen4_parameters", "syntx_owner_generate_heygen4_video", "syntx_owner_reconcile_heygen4_video",
  "syntx_owner_list_heygen4_recoveries"] as const);
export interface RegisterSyntxOwnerHeygen4ToolsOptions { readonly importService: OwnerHeygen4ReferenceService;
  readonly service: Pick<OwnerHeygen4GenerationService, "getSourceProfile" | "getParameters" | "generate" | "reconcile" | "listRecoveries">; }
const sourceSchema = z.object({ status: z.string(), source_pins: z.record(z.string(), z.unknown()), model_id: z.literal("heygen4"),
  ai_name: z.literal("heygen"), scope: z.literal("video"), selector: z.record(z.string(), z.unknown()), initial_tuple: z.record(z.string(), z.unknown()),
  cost_parameter_keys: z.array(z.string()), cost_parameter_sources: z.record(z.string(), z.unknown()), controls: z.record(z.string(), z.unknown()),
  media: z.record(z.string(), z.unknown()), public_bounds: z.record(z.string(), z.unknown()), prompt: z.record(z.string(), z.unknown()),
  settings: z.record(z.string(), z.unknown()), source_gaps: z.array(z.string()), avatar_voice_training: z.string(), provider_acceptance: z.literal("UNPROVEN") }).strict();
const importSchema = z.object({ link_attempt_id: ATTEMPT, file_id: FILE_ID, media_type: z.enum(["image", "audio"]), filename: z.string().min(1).max(255),
  mime_type: z.string().min(1).max(128), content_base64: z.string().min(4).max(MAX_BASE64).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u) }).strict();
const importOutput = z.object({ status: z.literal("imported"), reference_handle: z.string().regex(HANDLE), model_id: z.literal("heygen4"),
  media_type: z.enum(["image", "audio"]), file_id: FILE_ID, filename: z.string().max(255), mime_type: z.string().max(128),
  size: z.number().int().positive().max(MAX_BYTES), sha256: z.string().regex(/^[a-f0-9]{64}$/u), width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(), duration_seconds: z.number().min(2).max(120).optional(), expires_in_seconds: z.number().int().nonnegative(),
  provenance: z.literal("OWNED_EXISTING_ACCOUNT_ASSET"), generation_permit: z.literal(false), provider_acceptance: z.literal("UNPROVEN") }).strict();
const parameterSchema = z.object({ model_id: z.literal("heygen4"), ai_name: z.literal("heygen"), aspect_ratios: z.array(z.literal("16:9").or(z.literal("9:16"))),
  initial_aspect_ratio: z.literal("16:9"), image_count: z.literal(1), audio_count: z.literal(1), accepted_image_mime_types: z.array(imageMime),
  accepted_audio_mime_types: z.array(audioMime), max_file_size_bytes: z.number().int().positive(), audio_duration_seconds: z.object({ minimum: z.literal(2),
    maximum: z.literal(120), source: z.literal("TRUSTED_LOCAL_FFPROBE_OF_SELECTED_AUDIO") }).strict(), cost_parameter_keys: z.array(z.literal("duration")),
  cost_parameter_sources: z.record(z.string(), z.string()), prompt: z.record(z.string(), z.unknown()) }).strict();
const generateSchema = z.object({ link_attempt_id: ATTEMPT, prompt: z.string().min(1).max(2_000), image_handle: z.string().regex(HANDLE), audio_handle: z.string().regex(HANDLE) }).strict();
const recoverySchema = z.object({ link_attempt_id: ATTEMPT, recovery_id: z.string().regex(/^heygen4_recovery_[0-9a-f-]{36}$/u) }).strict();
const listSchema = z.object({ link_attempt_id: ATTEMPT }).strict();
const artifact = z.object({ message_object_id: z.string().min(1).max(160), message_id: z.string().min(1).max(160), object_type: z.literal("video"),
  url: z.string().url().max(4_096), mime_type: z.string().max(128).nullable() }).strict();
const resultSchema = z.object({ status: z.enum(["completed", "outcome_unknown"]), recovery_id: z.string().regex(/^heygen4_recovery_[0-9a-f-]{36}$/u),
  model_id: z.literal("heygen4"), status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"), provider_terminal_status: z.literal("UNPROVEN"),
  backend_acceptance: z.literal("UNPROVEN"), cost_cap_enforced: z.literal(false), durability: z.literal("PROCESS_LOCAL_ONLY"), artifacts: z.array(artifact).max(16),
  diagnostics: z.object({ phase: z.string().max(100), generation_post_started: z.boolean(), history_get_calls: z.number().int().nonnegative(),
    result_get_calls: z.number().int().nonnegative(), gaps: z.array(z.string().max(100)).max(16) }).strict() }).strict();

export function registerSyntxOwnerHeygen4Tools(server: McpServer, input: RegisterSyntxOwnerHeygen4ToolsOptions | unknown): void {
  const options = snapshotOptions(input);
  server.registerTool(OWNER_HEYGEN4_TOOL_NAMES[0], { title: "Get HeyGen 4 source profile",
    description: "Returns the bounded HeyGen 4 image-plus-audio source contract. Public upload is disabled; only explicitly selected existing account assets can be imported.",
    inputSchema: z.object({}).strict(), outputSchema: sourceSchema,
    annotations: { title: "HeyGen 4 source", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async () => safeSuccess(sourceSchema, options.service.getSourceProfile()));

  server.registerTool(OWNER_HEYGEN4_TOOL_NAMES[1], { title: "Import one existing HeyGen 4 image or audio",
    description: "Read-only import for one explicitly selected uploaded file id. Caller bytes must exactly match the safe account-owned R2 object; no upload occurs and no object URL is returned.",
    inputSchema: importSchema, outputSchema: importOutput,
    annotations: { title: "Import existing HeyGen 4 media", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }) => {
    let bytes: Buffer | undefined;
    try {
      const data = importSchema.parse(snapshot(input)); bytes = strictBase64(data.content_base64);
      const mime = data.media_type === "image" ? imageMime.parse(data.mime_type) : audioMime.parse(data.mime_type);
      return safeSuccess(importOutput, await options.importService.importExisting({ attemptId: data.link_attempt_id, file_id: data.file_id,
        media_type: data.media_type, filename: data.filename, mime_type: mime, bytes }, signal));
    } catch (error) { return safeError(error); } finally { bytes?.fill(0); }
  });

  server.registerTool(OWNER_HEYGEN4_TOOL_NAMES[2], { title: "Get HeyGen 4 parameters",
    description: "Returns only the implemented source-bounded HeyGen 4 image-plus-audio parameters and the trusted local duration measurement source.",
    inputSchema: z.object({}).strict(), outputSchema: parameterSchema,
    annotations: { title: "HeyGen 4 parameters", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async () => safeSuccess(parameterSchema, options.service.getParameters()));

  server.registerTool(OWNER_HEYGEN4_TOOL_NAMES[3], { title: "Generate one HeyGen 4 video",
    description: "Requires one imported image and one imported audio in that order. Uses 16:9 and the measured audio duration, checks two fresh account/model quotes, and makes at most one generation request. An uncertain POST is never retried.",
    inputSchema: generateSchema, outputSchema: resultSchema,
    annotations: { title: "Generate HeyGen 4 video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => { try { const data = generateSchema.parse(snapshot(input)); return safeSuccess(resultSchema,
    await options.service.generate({ attemptId: data.link_attempt_id, prompt: data.prompt, image_handle: data.image_handle, audio_handle: data.audio_handle }, signal));
  } catch (error) { return safeError(error); } });

  server.registerTool(OWNER_HEYGEN4_TOOL_NAMES[4], { title: "Reconcile one HeyGen 4 result (GET only)",
    description: "Reads the owned chat history and the observed result message only. It never repeats chat creation, quote checks or generation.",
    inputSchema: recoverySchema, outputSchema: resultSchema,
    annotations: { title: "Reconcile HeyGen 4 result", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }) => { try { const data = recoverySchema.parse(snapshot(input)); return safeSuccess(resultSchema,
    await options.service.reconcile({ attemptId: data.link_attempt_id, recovery_id: data.recovery_id }, signal)); } catch (error) { return safeError(error); } });

  server.registerTool(OWNER_HEYGEN4_TOOL_NAMES[5], { title: "List HeyGen 4 recoveries",
    description: "Lists process-local HeyGen 4 observations. It performs no account read, upload, chat creation or generation.",
    inputSchema: listSchema, outputSchema: z.object({ recoveries: z.array(resultSchema).max(64) }).strict(),
    annotations: { title: "List HeyGen 4 recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async input => { try { const data = listSchema.parse(snapshot(input)); return safeSuccess(z.object({ recoveries: z.array(resultSchema).max(64) }).strict(),
    { recoveries: options.service.listRecoveries({ attemptId: data.link_attempt_id }) }); } catch (error) { return safeError(error); } });
}

function snapshotOptions(value: unknown): RegisterSyntxOwnerHeygen4ToolsOptions { const row = snapshot(value); if (!row || typeof row !== "object" || Array.isArray(row) ||
  Object.keys(row).length !== 2 || !Object.hasOwn(row, "importService") || !Object.hasOwn(row, "service") || !isOwnerHeygen4ReferenceService((row as any).importService) ||
  !isOwnerHeygen4GenerationService((row as any).service)) throw new Error("INVALID_OWNER_HEYGEN4_TOOL_OPTIONS"); return Object.freeze(row as RegisterSyntxOwnerHeygen4ToolsOptions); }
function snapshot(value: unknown): unknown { if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return undefined;
  try { const descriptors = Object.getOwnPropertyDescriptors(value), result = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) { if (typeof key !== "string" || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true) return undefined; result[key] = descriptors[key]!.value; }
    return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null ? result : undefined; } catch { return undefined; } }
function strictBase64(value: string): Buffer { const bytes = Buffer.from(value, "base64"); if (!bytes.length || bytes.length > MAX_BYTES || bytes.toString("base64") !== value) { bytes.fill(0); throw new Error("INVALID_REQUEST"); } return bytes; }
function safeSuccess<T extends z.ZodType>(schema: T, value: unknown) { const parsed = schema.safeParse(value); return parsed.success
  ? { content: [{ type: "text" as const, text: JSON.stringify(parsed.data) }], structuredContent: parsed.data as Record<string, unknown> } : safeError(new Error("OUTPUT_INVALID")); }
function safeError(value: unknown) { const raw = value && typeof value === "object" && !types.isProxy(value) ? Reflect.get(value, "code") : undefined;
  const allowed = new Set(["INVALID_REQUEST", "ASSET_INVALID", "PRINCIPAL_NOT_LINKED", "SOURCE_FILE_UNAVAILABLE", "SOURCE_ASSET_UNVERIFIED", "REFERENCE_NOT_FOUND",
    "REFERENCE_EXPIRED", "SERVICE_CLOSED", "SERVICE_BUSY", "CAPACITY_EXCEEDED", "PREFLIGHT_FAILED", "MODEL_INACTIVE", "BALANCE_INSUFFICIENT",
    "INTENT_ALREADY_CLAIMED", "REQUEST_ABORTED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"]); const code = typeof raw === "string" && allowed.has(raw) ? raw : "HEYGEN4_UNAVAILABLE";
  const message = code === "OUTCOME_UNKNOWN" ? "Generation may have been sent. Do not retry; use GET-only reconciliation." :
    "The HeyGen 4 operation could not be completed safely.";
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message,
    ...(value && typeof value === "object" && typeof Reflect.get(value, "recovery_id") === "string" ? { recovery_id: Reflect.get(value, "recovery_id") } : {}) } }) }] }; }
