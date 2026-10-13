import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import {
  OWNER_HAILUO23_T2V_CONTRACT_VARIANT_ID,
  type OwnerHailuo23T2vSourceContract
} from "../application/owner-hailuo23-t2v-profile.js";
import {
  OwnerHailuo23T2vGenerationService,
  OwnerReviewedNoReferenceT2vServiceError,
  type OwnerHailuo23T2vGenerationInput
} from "../application/owner-reviewed-no-reference-t2v-service.js";

export const SYNTX_OWNER_GET_HAILUO23_T2V_SOURCE_TOOL_NAME = "syntx_owner_get_hailuo23_t2v_source" as const;
export const SYNTX_OWNER_GENERATE_HAILUO23_T2V_TOOL_NAME = "syntx_owner_generate_hailuo23_t2v" as const;
export const SYNTX_OWNER_RECONCILE_HAILUO23_T2V_TOOL_NAME = "syntx_owner_reconcile_hailuo23_t2v" as const;
export const SYNTX_OWNER_LIST_HAILUO23_T2V_RECOVERIES_TOOL_NAME = "syntx_owner_list_hailuo23_t2v_recoveries" as const;

const attemptIdSchema = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const recoveryIdSchema = z.string().regex(/^recovery_[0-9a-f-]{36}$/u);
const artifactSchema = z.object({
  url: z.string().url(), mime_type: z.literal("video/mp4").optional(), byte_size: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), duration_seconds: z.number().nonnegative().optional()
}).strict();

export const ownerHailuo23T2vSourceOutputSchema = z.object({
  status: z.literal("CURRENT_B066_1B48_STATIC_SOURCE_CONTRACT_WITH_SINGLE_UI_OBSERVATION"),
  source_pins: z.object({ public_catalog_version: z.literal("sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json"),
    public_models_sha256: z.literal("sha256:7ffbeff2ef1efa9d617d6e26e3e1c11e1d355cc45b34a2a427159f7e91fa4667"),
    settings_inventory_version: z.literal("sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json"),
    build_id: z.literal("1791811899"), form_module: z.literal("hailuo-minimax.js"), form_bytes: z.literal(13_501),
    form_sha256: z.literal("sha256:44470e6f7de725746c4fbbee0ddb61cf861629943299ce006f34d0120706d10c"),
    sender_module: z.literal("video.js"), sender_bytes: z.literal(8_689),
    sender_sha256: z.literal("sha256:b5df2329cf5fbc9e1b1289d146695954fd8576aed04818baffa6fbaaff1f73de") }).strict(),
  identity: z.object({ model_id: z.literal("hailuo-2.3"), ai_name: z.literal("hailuo-minimax"), model_type: z.literal("hailuo-2.3"), operation_id: z.literal("generate-video") }).strict(),
  controls: z.object({
    resolution: z.object({ values: z.tuple([z.literal("768p"), z.literal("1080p")]), effective_default: z.literal("UNKNOWN") }).strict(),
    video_duration: z.object({ values: z.tuple([z.literal(6), z.literal(10)]), unit: z.literal("INTEGER_SECONDS"), effective_default: z.literal("UNKNOWN") }).strict(),
    valid_pairs: z.array(z.union([z.object({ resolution: z.literal("768p"), video_duration: z.union([z.literal(6), z.literal(10)]) }).strict(),
      z.object({ resolution: z.literal("1080p"), video_duration: z.literal(6) }).strict()])),
    prompt: z.object({ source_max_length: z.literal("UNKNOWN"), local_bound_utf16: z.literal(5_000), local_bound_kind: z.literal("LOCAL_RESOURCE_BOUND_UTF16") }).strict()
  }).strict(),
  wire_observation: z.object({ source: z.literal("ROOT1140_CURRENT_CHROME_UI_OWNER_OBSERVATION"), method: z.literal("POST"),
    path: z.literal("/api/v1/video/generate"), query: z.object({ ai_name: z.literal("hailuo-minimax") }).strict(),
    settings_keys: z.tuple([z.literal("model_type"), z.literal("video_duration"), z.literal("resolution"), z.literal("file_urls")]),
    no_references: z.literal(true), no_presets: z.literal(true), mode_field_present: z.literal(false),
    gen_type_field_present: z.literal(false), aspect_ratio_field_present: z.literal(false) }).strict(),
  ui_observation: z.object({ source: z.literal("ROOT1140_HAILUO23_UI_POST_AND_RESULT"),
    provider_verified_pair: z.object({ resolution: z.literal("768p"), video_duration: z.literal(6) }).strict(),
    other_pairs_status: z.literal("SOURCE_REVIEWED_NOT_PROVIDER_VERIFIED"),
    output_observation: z.object({ container: z.literal("MP4"), video_codec: z.literal("H264"), width: z.literal(1366), height: z.literal(768),
      duration_seconds: z.literal(5.875), audio: z.literal(false), decode_exit_code: z.literal(0) }).strict(),
    requested_duration_is_not_output_duration_guarantee: z.literal(true) }).strict(),
  cost_projection: z.object({ caller_keys: z.tuple([z.literal("resolution"), z.literal("video_duration")]),
    transport_owned_keys: z.tuple([z.literal("model_type")]), exact_ui_mapping_scope: z.literal("ONLY_768P_6S_OBSERVED"),
    other_pair_mapping: z.literal("SOURCE_REVIEWED_NOT_PROVIDER_VERIFIED"), amount_or_quote: z.literal("UNPROVEN") }).strict(),
  defaults: z.literal("UNKNOWN"), runtime_usable: z.literal(false), dispatch_allowed: z.literal(false), backend_acceptance: z.literal("UNPROVEN")
}).strict() satisfies z.ZodType<OwnerHailuo23T2vSourceContract>;

export const ownerHailuo23T2vOutputSchema = z.object({ status: z.literal("reviewed"), confidence_scope: z.literal("exact_result_only"),
  model_id: z.literal("hailuo-2.3"), operation_id: z.literal("generate-video"), modality: z.literal("video"),
  variant_id: z.literal(OWNER_HAILUO23_T2V_CONTRACT_VARIANT_ID), artifacts: z.array(artifactSchema).max(16) }).strict();

const recoveryListOutputSchema = z.object({ recoveries: z.array(z.object({ recovery_id: recoveryIdSchema, model_id: z.literal("hailuo-2.3"),
  operation_id: z.literal("generate-video"), variant_id: z.literal(OWNER_HAILUO23_T2V_CONTRACT_VARIANT_ID), created_at: z.iso.datetime() }).strict()).max(20) }).strict();

export interface RegisterSyntxOwnerHailuo23T2vToolsOptions {
  readonly service: Pick<OwnerHailuo23T2vGenerationService, "getParametersSource" | "generate" | "reconcile" | "listRecoveries">;
}

/** Registers four source-pinned Hailuo 2.3 no-reference video operations. */
export function registerSyntxOwnerHailuo23T2vTools(server: McpServer, options: RegisterSyntxOwnerHailuo23T2vToolsOptions): void {
  const service = options.service;
  server.registerTool(SYNTX_OWNER_GET_HAILUO23_T2V_SOURCE_TOOL_NAME, {
    title: "Get Hailuo 2.3 T2V source profile",
    description: "Returns pinned source evidence and the three explicit no-reference request pairs. Only 768p/6s has a UI result observation; the other pairs are source-reviewed, not provider-verified. This is not account access or a price quote.",
    inputSchema: z.object({}).strict(), outputSchema: ownerHailuo23T2vSourceOutputSchema,
    annotations: { title: "Get Hailuo 2.3 T2V source profile", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (): Promise<CallToolResult> => {
    try {
      const output = ownerHailuo23T2vSourceOutputSchema.parse(service.getParametersSource());
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) { return safeError(error); }
  });

  const common = { link_attempt_id: attemptIdSchema, prompt: z.string().min(1).max(5_000) };
  const pairFields = z.object({ ...common, resolution: z.enum(["768p", "1080p"]), video_duration: z.union([z.literal(6), z.literal(10)]) })
    .strict()
    .superRefine((input, context) => {
      if (input.resolution === "1080p" && input.video_duration === 10) {
        context.addIssue({ code: "custom", path: ["video_duration"], message: "This reviewed profile does not support 1080p/10s." });
      }
    });
  server.registerTool(SYNTX_OWNER_GENERATE_HAILUO23_T2V_TOOL_NAME, {
    title: "Generate one Hailuo 2.3 no-reference video",
    description: "Runs one non-idempotent owner generation for an explicit source-reviewed pair: 768p/6s, 768p/10s, or 1080p/6s. No model selector, preset, reference, or raw settings are accepted. 5,000 UTF-16 code units is a local prompt bound; provider maximum and price are unknown. Unknown outcomes require GET-only reconciliation; never retry generation.",
    inputSchema: pairFields, outputSchema: ownerHailuo23T2vOutputSchema,
    annotations: { title: "Generate one Hailuo 2.3 no-reference video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const request: OwnerHailuo23T2vGenerationInput = { attemptId: input.link_attempt_id, prompt: input.prompt,
        resolution: input.resolution, video_duration: input.video_duration };
      return structuredSuccess(await service.generate(request, signal));
    } catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_HAILUO23_T2V_TOOL_NAME, {
    title: "Reconcile one Hailuo 2.3 video (GET only)",
    description: "GET-only reconciliation for the same linked owner attempt and opaque recovery id. It does not create a chat, check subscription or model access, dispatch, retry, cancel, or delete.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, recovery_id: recoveryIdSchema }).strict(), outputSchema: ownerHailuo23T2vOutputSchema,
    annotations: { title: "Reconcile one Hailuo 2.3 video (GET only)", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try { return structuredSuccess(await service.reconcile({ attemptId: input.link_attempt_id, recovery_id: input.recovery_id }, signal), input.recovery_id); }
    catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_LIST_HAILUO23_T2V_RECOVERIES_TOOL_NAME, {
    title: "List Hailuo 2.3 video recoveries",
    description: "Lists bounded process-local recovery ids for one owner attempt without authentication, account reads, HTTP requests, or generation.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, limit: z.number().int().min(1).max(20).default(20) }).strict(), outputSchema: recoveryListOutputSchema,
    annotations: { title: "List Hailuo 2.3 video recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input): Promise<CallToolResult> => {
    try { const output = recoveryListOutputSchema.parse({ recoveries: service.listRecoveries(input.link_attempt_id, input.limit) });
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output }; }
    catch (error) { return safeError(error); }
  });
}

function structuredSuccess(value: unknown, recoveryId?: string): CallToolResult {
  try { const output = ownerHailuo23T2vOutputSchema.parse(value);
    return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output,
      ...(recoveryId === undefined ? {} : { _meta: { recovery_id: recoveryId } }) }; }
  catch { return safeError(new OwnerReviewedNoReferenceT2vServiceError("OUTCOME_UNKNOWN", recoveryId)); }
}

function safeError(error: unknown): CallToolResult {
  if (error instanceof OwnerReviewedNoReferenceT2vServiceError) {
    const output = { error: { code: error.code,
      message: error.code === "OUTCOME_UNKNOWN" ? "The request may have been dispatched; do not retry. Use GET-only reconciliation with the same recovery id."
        : "The reviewed Hailuo 2.3 request could not be completed safely.",
      ...(error.code === "OUTCOME_UNKNOWN" && error.recovery_id !== undefined ? { recovery_id: error.recovery_id } : {}) } };
    return { isError: true, content: [{ type: "text", text: JSON.stringify(output) }] };
  }
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: {
    code: "HAILUO23_T2V_UNAVAILABLE", message: "The reviewed Hailuo 2.3 request could not be completed safely." } }) }] };
}
