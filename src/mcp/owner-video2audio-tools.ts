import { isCanonicalBase64 as isCanonicalBase64Bounded } from "../application/canonical-base64.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { types } from "node:util";
import { isOwnerVideo2AudioGenerationService, OwnerVideo2AudioGenerationServiceError, type OwnerVideo2AudioGenerationService }
  from "../application/owner-video2audio-generation-service.js";
import { OwnerVideo2AudioOriginalReferenceService, OwnerVideo2AudioOriginalReferenceServiceError }
  from "../application/owner-video2audio-original-reference-service.js";
import { isAuthenticOwnerVideo2AudioSourceProfile, isCurrentOwnerVideo2AudioSourceProfile, type OwnerVideo2AudioSourceProfile }
  from "../application/owner-video2audio-source-profile.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import { OWNER_VIDEO2AUDIO_CURRENT_CONTROLS } from "../application/owner-video2audio-current-controls.js";

export const SYNTX_OWNER_GET_VIDEO2AUDIO_SOURCE_TOOL_NAME = "syntx_owner_get_video2audio_source" as const;
export const SYNTX_OWNER_UPLOAD_VIDEO2AUDIO_ORIGINAL_TOOL_NAME = "syntx_upload_video2audio_original" as const;
export const SYNTX_OWNER_GENERATE_VIDEO2AUDIO_TOOL_NAME = "syntx_owner_generate_video2audio" as const;
export const SYNTX_OWNER_RECONCILE_VIDEO2AUDIO_TOOL_NAME = "syntx_owner_reconcile_video2audio" as const;
export const SYNTX_OWNER_LIST_VIDEO2AUDIO_RECOVERIES_TOOL_NAME = "syntx_owner_list_video2audio_recoveries" as const;
export const SYNTX_OWNER_GET_VIDEO2AUDIO_RESULT_PAGE_TOOL_NAME = "syntx_owner_get_video2audio_result_page" as const;

const MAX_VIDEO_BYTES = 10 * 1024 * 1024;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^video2audio_original_[0-9a-f-]{36}$/u;
const RECOVERY = /^video2audio_generation_recovery_[0-9a-f-]{36}$/u;
const attemptSchema = z.string().regex(ATTEMPT);
const handleSchema = z.string().regex(HANDLE);
const recoverySchema = z.string().regex(RECOVERY);

export const ownerVideo2AudioSourceOutputSchema = z.object({
  current_source_controls: z.object({
    public_catalog_version: z.literal(OWNER_VIDEO2AUDIO_CURRENT_CONTROLS.public_catalog_version),
    settings_inventory_version: z.literal(OWNER_VIDEO2AUDIO_CURRENT_CONTROLS.settings_inventory_version),
    build_id: z.literal("1793890358"), form_sha256: z.literal(OWNER_VIDEO2AUDIO_CURRENT_CONTROLS.form_sha256),
    random_seed_module_sha256: z.literal(OWNER_VIDEO2AUDIO_CURRENT_CONTROLS.random_seed_module_sha256),
    seed: z.object({ minimum: z.literal(0), maximum: z.literal(2147483647), integer: z.literal(true), explicit_zero: z.literal("ZERO_WIRE_PRESERVED_RANDOM_VIEW_ONLY"), explicit_null: z.literal("RANDOM_NULL"), omitted: z.literal("LEGACY_ZERO_COMPATIBILITY"), ui_initializer: z.literal(0) }).strict(),
    negative_prompt: z.object({ ui_control: z.literal("TEXTAREA"), ui_maximum: z.literal("UNSPECIFIED"), local_maximum_utf16: z.literal(5000), omitted: z.literal("LEGACY_EMPTY_STRING"), ui_initializer: z.literal("") }).strict(),
    effective_saved_ui_defaults: z.literal("NOT_INFERRED_FROM_FORM_INITIALIZER"), provider_acceptance: z.literal("UNPROVEN")
  }).strict().optional(),
  status: z.enum(["CURRENT_B066_1B48_STATIC_SOURCE_CONTRACT_WITH_ONE_UI_WIRE_OBSERVATION", "CURRENT_A829_4DA7_FORM_SOURCE_REVIEWED_PROVIDER_UNPROVEN"]),
  source_pins: z.object({
    public_catalog_version: z.enum(["sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json", "sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json"]),
    public_models_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    settings_inventory_version: z.enum(["sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json", "sha256-4da7d12483291bb632aa21e0deb220142994fe061999d2f246318276964fa187.json"]),
    build_id: z.string().min(1).max(32), form_module: z.literal("video-2-audio.js"), form_bytes: z.union([z.literal(4350), z.literal(4382)]),
    form_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u)
  }).strict(),
  identity: z.object({ model_id: z.literal("video2audio"), ai_name: z.literal("video2audio"), model_type: z.literal("video2audio"),
    operation_id: z.literal("generate-audio"), modality: z.literal("audio") }).strict(),
  wire_observation: z.object({ source: z.enum(["ROOT1128_CURRENT_CHROME_UI_OBSERVATION", "HISTORICAL_ROOT1128_ABI_WITH_CURRENT_FORM_SOURCE_REVIEW"]), method: z.literal("POST"),
    path: z.literal("/api/v1/audio/generate"), query: z.object({ ai_name: z.literal("video2audio") }).strict(),
    outer_keys: z.tuple([z.literal("chat_uuid"), z.literal("prompt"), z.literal("settings")]),
    settings_keys: z.tuple([z.literal("model_type"), z.literal("mode"), z.literal("duration"), z.literal("negative_prompt"), z.literal("seed"), z.literal("file_urls")]),
    file_url_item: z.object({ keys: z.tuple([z.literal("type"), z.literal("url")]), type: z.literal("video"),
      url_source: z.literal("SAME_OWNED_UPLOAD_RECEIPT") }).strict(), fixed_mode: z.literal("generate"), fixed_negative_prompt: z.literal(""),
    observed_seed: z.literal(0), duration_source: z.literal("SAME_OWNED_UPLOAD_RECEIPT") }).strict(),
  model_access_observation: z.object({ source: z.enum(["ROOT1128_CURRENT_CHROME_UI_OBSERVATION", "HISTORICAL_ROOT1128_ABI_WITH_CURRENT_FORM_SOURCE_REVIEW"]),
    account_scope: z.literal("HISTORICAL_OWNER_UI_OBSERVATION_NOT_CURRENT_USER_ENTITLEMENT"), current_user_access: z.literal("NOT_READ"),
    query_keys: z.tuple([z.literal("ai_name"), z.literal("model_type")]), cost_parameter_keys: z.tuple([]), access: z.literal(true),
    amount_or_quote: z.literal("UNPROVEN") }).strict(),
  controls: z.object({ prompt: z.object({ source_max_length: z.literal("UNKNOWN"), local_bound_utf16: z.literal(5_000) }).strict(),
    original_video: z.object({ source_accepts: z.tuple([z.literal("video/mp4"), z.literal("video/webm"), z.literal("video/quicktime"), z.literal("video/mov")]),
      profile_accepts: z.union([z.tuple([z.literal("video/mp4")]), z.tuple([z.literal("video/mp4"), z.literal("video/webm"), z.literal("video/quicktime"), z.literal("video/mov")])]), local_size_bound_bytes: z.union([z.literal(MAX_VIDEO_BYTES), z.literal(104857600)]),
      size_bound_kind: z.literal("LOCAL_NATIVE_RESOURCE_BOUND_NOT_PROVIDER_LIMIT") }).strict(),
    duration: z.object({ source: z.enum(["TRUSTED_UPLOAD_METADATA_REQUIRED", "TRUSTED_LOCAL_FFPROBE_BOUND_TO_SAME_UPLOAD_BYTES"]), finite_min_exclusive: z.literal(0),
      ui_hint_max_inclusive_seconds: z.literal(20), max_semantics: z.enum(["UI_HINT_ONLY_NOT_BACKEND_LIMIT", "INITIALIZER_FALLBACK_ONLY_NOT_DURATION_MAXIMUM"]), caller_supplied: z.literal(false) }).strict(),
    random_seed: z.object({ ui_observed_enabled: z.literal(true), observed_wire_value: z.literal(0), general_semantics: z.literal("UNKNOWN") }).strict()
  }).strict(),
  cost_projection: z.object({ declared_cost_parameter_keys: z.tuple([]), query_caller_keys: z.tuple([]),
    transport_owned_keys: z.tuple([z.literal("ai_name"), z.literal("model_type")]), amount_or_quote: z.literal("UNPROVEN") }).strict(),
  defaults: z.literal("UNKNOWN"), runtime_usable: z.literal(false), dispatch_allowed: z.literal(false), backend_acceptance: z.literal("UNPROVEN")
}).strict();

const uploadOutputSchema = z.object({ status: z.literal("uploaded"), video_original_handle: handleSchema, mime_type: z.enum(["video/mp4", "video/webm", "video/quicktime", "video/mov"]),
  size: z.number().int().min(16).max(104857600), sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  duration_seconds: z.number().finite().positive(), expires_in_seconds: z.number().int().min(1).max(900) }).strict();
const diagnosticSchema = z.object({
  phase: z.enum(["VALIDATE_REQUEST", "PREPARE_CANDIDATE", "RESOLVE_PRINCIPAL", "PREFLIGHT_ONE", "CHAT_CREATE", "PREFLIGHT_TWO",
    "GENERATION_POST", "POST_ACK_KNOWN", "HISTORY_GET", "RESULT_GET", "RESULT_BINDING"]),
  post_started: z.boolean(), ack_known: z.boolean(), history_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "INCOMPLETE", "UNVERIFIED"]),
  owner_ack_status: z.enum(["NOT_READ", "MATCHED", "MISSING", "AMBIGUOUS", "MISMATCH"]),
  history_get_calls: z.number().int().min(0).max(255), result_get_calls: z.number().int().min(0).max(255),
  result_status: z.enum(["NOT_READ", "PENDING", "PARTIAL", "COMPLETE", "UNVERIFIED"]),
  gaps: z.array(z.string().regex(/^[A-Z0-9_]{1,96}$/u)).max(128), counters_saturated: z.boolean()
}).strict();
const artifactSchema = z.object({ url: z.string().url(), mime_type: z.enum(["video/mp4", "video/quicktime", "audio/mpeg", "audio/wav", "audio/mp4"]).nullable(),
  mime_source: z.enum(["URL_EXTENSION_LOCAL_POLICY", "UNKNOWN"]), object_type: z.enum(["video", "audio"]), object_index: z.number().int().min(0),
  model_echo: z.enum(["MATCHED", "UNKNOWN"]) }).strict();
const generationOutputSchema = z.object({ status: z.enum(["PENDING", "PARTIAL", "COMPLETE", "UNVERIFIED"]),
  status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"), backend_acceptance: z.literal("UNPROVEN"), provider_terminal_status: z.literal("UNPROVEN"),
  model_id: z.literal("video2audio"), source_binding: z.object({ public_catalog_version: z.string().min(1).max(160),
    settings_inventory_version: z.string().min(1).max(160), form_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u) }).strict(),
  recovery_id: recoverySchema, observed_artifact_count: z.number().int().min(0).max(4096), offset: z.number().int().min(0).max(4096),
  page_size: z.literal(64), artifacts: z.array(artifactSchema).max(64), has_more: z.boolean(), next_offset: z.number().int().min(0).max(4096).nullable(),
  diagnostic: diagnosticSchema }).strict();
const recoveryListOutputSchema = z.object({ recoveries: z.array(z.object({ recovery_id: recoverySchema, created_at: z.iso.datetime(),
  model_id: z.literal("video2audio"), status: z.enum(["outcome_unknown", "pending", "partial_results", "completed"]),
  observed_artifact_count: z.number().int().min(0).max(4096), diagnostic: diagnosticSchema }).strict()).max(20) }).strict();

export interface RegisterSyntxOwnerVideo2AudioToolsOptions {
  readonly profile: OwnerVideo2AudioSourceProfile;
  readonly originalReferenceService: OwnerVideo2AudioOriginalReferenceService;
  readonly generationService: OwnerVideo2AudioGenerationService;
}

/** Registers six strict owner-local Video2Audio source/upload/generate/recovery actions. */
export function registerSyntxOwnerVideo2AudioTools(server: McpServer, options: RegisterSyntxOwnerVideo2AudioToolsOptions): void {
  const { profile, originalReferenceService, generationService } = options;
  if (!isAuthenticOwnerVideo2AudioSourceProfile(profile) || !isExactOriginalReferenceService(originalReferenceService) ||
      !isOwnerVideo2AudioGenerationService(generationService)) throw new Error("OWNER_VIDEO2AUDIO_COMPOSITION_INVALID");
  const current = isCurrentOwnerVideo2AudioSourceProfile(profile), maximumBytes = profile.source.controls.original_video.local_size_bound_bytes, maximumBase64 = Math.ceil(maximumBytes / 3) * 4;
  server.registerTool(SYNTX_OWNER_GET_VIDEO2AUDIO_SOURCE_TOOL_NAME, {
    title: "Get Video2Audio source profile",
    description: "Returns the selected separate currenta829/4da7 form-source profile or explicit historicalB066/1b48 compatibility profile. Current input100MiB/4MIME uses genuine local ffprobe metadata, with no invented20s maximum;20 is initializer/fallback only. Historical UI observation stays historical; new tuples/provider acceptance remain unproven.",
    inputSchema: z.object({}).strict(), outputSchema: ownerVideo2AudioSourceOutputSchema,
    annotations: { title: "Get Video2Audio source profile", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (): Promise<CallToolResult> => {
    try { return safeStructured(ownerVideo2AudioSourceOutputSchema.parse({ ...profile.source, current_source_controls: OWNER_VIDEO2AUDIO_CURRENT_CONTROLS })); }
    catch { return safeError("SOURCE_PROFILE_UNAVAILABLE", "The source-only Video2Audio profile is unavailable."); }
  });

  server.registerTool(SYNTX_OWNER_UPLOAD_VIDEO2AUDIO_ORIGINAL_TOOL_NAME, {
    title: "Upload an owned original for Video2Audio",
    description: "Uploads caller video bytes for the linked owner, returning a URL-free15min handle. Current operator-ffprobe profile accepts MP4/WebM/QuickTime/MOV up100MiB; header and real bounded local metadata probe bind bytes/MIME/positive finite duration before upload. No arbitrary20s maximum. Alias video/mov becomes video/quicktime without changing bytes. Explicit historical profile retains MP4/10MiB/20s compatibility. Upload is not generation; unknown upload must not be retried.",
    inputSchema: z.object({ link_attempt_id: attemptSchema,
      content_base64: z.string().min(24).max(maximumBase64).refine((value) => isCanonicalBase64Bounded(value, maximumBase64)).refine(isCanonicalBase64, "Expected canonical padded base64."),
      // Keep the Unicode filename guard in the runtime parser. Zod's exported
      // JSON Schema `pattern` loses the JS /u flag and some hosts reject \p{}.
      filename: current ? z.string().min(1).max(255).refine((value) => /^[^\\/\p{Cc}\p{Cf}\p{Cs}]+$/u.test(value))
        .describe("Filename checked server-side for path separators and invisible controls.") : z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}\.mp4$/iu), mime_type: current ? z.enum(["video/mp4", "video/webm", "video/quicktime", "video/mov"]) : z.literal("video/mp4") }).strict(),
    outputSchema: uploadOutputSchema,
    annotations: { title: "Upload an owned original for Video2Audio", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const bytes = Buffer.from(input.content_base64, "base64");
      try { const result = await originalReferenceService.uploadOriginal({ attemptId: input.link_attempt_id, filename: input.filename, mime_type: input.mime_type, bytes }, signal);
        return safeStructured(uploadOutputSchema.parse(result)); } finally { bytes.fill(0); }
    } catch (error) { return uploadError(error); }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_VIDEO2AUDIO_TOOL_NAME, {
    title: "Generate audio from an owner video",
    description: "One real owner Video2Audio generation. Requires a URL-free owned video handle. Current profile permits an omitted/empty prompt; historical compatibility requires an explicit nonblank prompt. Optional seed/negative_prompt follow the current form: null is the RandomSeed switch value; explicit0 remains wire0 even though the UI renders its random view. Omission preserves historical seed0/empty-negative behavior. Negative prompt5000 UTF-16 is a local resource cap, not a UI/provider maximum. Model/duration stay server-owned. Provider cost is possible; no quote/spend cap is claimed. If dispatch is uncertain, do not retry: use GET-only reconciliation.",
    inputSchema: z.object({ link_attempt_id: attemptSchema, prompt: current ? z.string().max(5000).default("") : z.string().min(1).max(5_000), video_original_handle: handleSchema,
      seed: z.number().int().min(0).max(2147483647).nullable().optional().describe("Current RandomSeed: null is random-switch wire value; explicit0 retains0, omission retains legacy0."),
      negative_prompt: z.string().max(5000).optional().describe("Current textarea;5000 UTF-16 is a local resource cap, UI maximum unspecified.") }).strict(),
    outputSchema: generationOutputSchema,
    annotations: { title: "Generate audio from an owner video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const result = await generationService.generate({ attemptId: input.link_attempt_id, prompt: input.prompt,
        video_original_handle: input.video_original_handle,
        ...(input.seed === undefined ? {} : { seed: input.seed }),
        ...(input.negative_prompt === undefined ? {} : { negative_prompt: input.negative_prompt }) }, signal);
      return safeStructured(generationOutputSchema.parse(result));
    } catch (error) { return generationError(error); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_VIDEO2AUDIO_TOOL_NAME, {
    title: "Reconcile a Video2Audio generation (GET only)",
    description: "GET-only recovery for the same linked attempt and opaque recovery id. It does not check account access, resolve the upload again, create a chat, dispatch, retry, or cancel provider work. Recovery is process-local and not restart-safe.",
    inputSchema: z.object({ link_attempt_id: attemptSchema, recovery_id: recoverySchema }).strict(), outputSchema: generationOutputSchema,
    annotations: { title: "Reconcile a Video2Audio generation (GET only)", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try { return safeStructured(generationOutputSchema.parse(await generationService.reconcile({ attemptId: input.link_attempt_id,
      recovery_id: input.recovery_id }, signal))); }
    catch (error) { return generationError(error); }
  });

  server.registerTool(SYNTX_OWNER_LIST_VIDEO2AUDIO_RECOVERIES_TOOL_NAME, {
    title: "List Video2Audio recovery ids",
    description: "Lists up to 20 recovery IDs for the exact linked attempt from bounded process-local memory. It performs no provider GET or generation. Unknown-dispatch claims are not evicted to make room.",
    inputSchema: z.object({ link_attempt_id: attemptSchema, limit: z.number().int().min(1).max(20).default(20) }).strict(),
    outputSchema: recoveryListOutputSchema,
    annotations: { title: "List Video2Audio recovery ids", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input): Promise<CallToolResult> => {
    try { return safeStructured(recoveryListOutputSchema.parse({ recoveries: await generationService.listRecoveries({
      attemptId: input.link_attempt_id, limit: input.limit }) })); }
    catch (error) { return generationError(error); }
  });

  server.registerTool(SYNTX_OWNER_GET_VIDEO2AUDIO_RESULT_PAGE_TOOL_NAME, {
    title: "Read a Video2Audio result page",
    description: "Reads one local page of already observed Video2Audio video/audio artifacts for the same linked attempt and recovery. Page size is fixed at 64. This makes no provider request and does not retry generation.",
    inputSchema: z.object({ link_attempt_id: attemptSchema, recovery_id: recoverySchema, offset: z.number().int().min(0).max(4096).default(0) }).strict(),
    outputSchema: generationOutputSchema,
    annotations: { title: "Read a Video2Audio result page", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input): Promise<CallToolResult> => {
    try { return safeStructured(generationOutputSchema.parse(await generationService.getResultPage({ attemptId: input.link_attempt_id,
      recovery_id: input.recovery_id, offset: input.offset }))); }
    catch (error) { return generationError(error); }
  });
}

function isCanonicalBase64(value: string): boolean {
  try { return Buffer.from(value, "base64").toString("base64") === value; } catch { return false; }
}

function isExactOriginalReferenceService(value: unknown): value is OwnerVideo2AudioOriginalReferenceService {
  try {
    return !!value && typeof value === "object" && !types.isProxy(value) && value instanceof OwnerVideo2AudioOriginalReferenceService &&
      Object.getPrototypeOf(value) === OwnerVideo2AudioOriginalReferenceService.prototype &&
      Reflect.get(value, "uploadOriginal") === OwnerVideo2AudioOriginalReferenceService.prototype.uploadOriginal && Object.isFrozen(value);
  } catch { return false; }
}

function safeStructured(value: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

function uploadError(error: unknown): CallToolResult {
  const code = error instanceof OwnerVideo2AudioOriginalReferenceServiceError || error instanceof SyntxHttpError ? error.code : "UPLOAD_FAILED";
  const unknown = code === "UPLOAD_OUTCOME_UNKNOWN";
  return safeError(code, unknown ? "The original upload outcome is unknown; do not retry the same bytes." : "The Video2Audio original upload could not be completed safely.");
}

function generationError(error: unknown): CallToolResult {
  if (error instanceof OwnerVideo2AudioGenerationServiceError) {
    return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: {
      code: error.code,
      message: error.code === "OUTCOME_UNKNOWN" ? "Generation may have been dispatched; do not retry. Use GET-only recovery with this id."
        : "The owner Video2Audio operation could not be completed safely.",
      ...(error.recovery_id === undefined ? {} : { recovery_id: error.recovery_id }),
      ...(error.diagnostic === undefined ? {} : { diagnostic: error.diagnostic })
    } }) }] };
  }
  return safeError("VIDEO2AUDIO_UNAVAILABLE", "The owner Video2Audio operation could not be completed safely.");
}

function safeError(code: string, message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message } }) }] };
}
