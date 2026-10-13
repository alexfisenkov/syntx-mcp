import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import {
  OWNER_HAILUO01_DIRECTOR_T2V_CONTRACT_VARIANT_ID,
  type OwnerHailuo01DirectorT2vSourceContract
} from "../application/owner-hailuo01-director-t2v-profile.js";
import {
  OwnerHailuo01DirectorT2vGenerationService,
  OwnerReviewedNoReferenceT2vServiceError,
  type OwnerReviewedNoReferenceT2vGenerationInput
} from "../application/owner-reviewed-no-reference-t2v-service.js";

export const SYNTX_OWNER_GET_HAILUO01_DIRECTOR_T2V_SOURCE_TOOL_NAME = "syntx_owner_get_hailuo01_director_t2v_source" as const;
export const SYNTX_OWNER_GENERATE_HAILUO01_DIRECTOR_T2V_TOOL_NAME = "syntx_owner_generate_hailuo01_director_t2v" as const;
export const SYNTX_OWNER_RECONCILE_HAILUO01_DIRECTOR_T2V_TOOL_NAME = "syntx_owner_reconcile_hailuo01_director_t2v" as const;
export const SYNTX_OWNER_LIST_HAILUO01_DIRECTOR_T2V_RECOVERIES_TOOL_NAME = "syntx_owner_list_hailuo01_director_t2v_recoveries" as const;

const attemptIdSchema = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const recoveryIdSchema = z.string().regex(/^recovery_[0-9a-f-]{36}$/u);
const videoArtifactSchema = z.object({
  url: z.string().url(),
  mime_type: z.literal("video/mp4").optional(),
  byte_size: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration_seconds: z.number().nonnegative().optional()
}).strict();

export const ownerHailuo01DirectorT2vSourceOutputSchema = z.object({
  status: z.literal("CURRENT_B066_1B48_STATIC_SOURCE_CONTRACT_WITH_UI_OBSERVATION"),
  source_pins: z.object({
    public_catalog_version: z.literal("sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json"),
    public_models_sha256: z.literal("sha256:7ffbeff2ef1efa9d617d6e26e3e1c11e1d355cc45b34a2a427159f7e91fa4667"),
    settings_inventory_version: z.literal("sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json"),
    build_id: z.literal("1791811899"),
    form_module: z.literal("hailuo-minimax.js"),
    form_bytes: z.literal(13_501),
    form_sha256: z.literal("sha256:44470e6f7de725746c4fbbee0ddb61cf861629943299ce006f34d0120706d10c"),
    sender_module: z.literal("video.js"),
    sender_bytes: z.literal(8_689),
    sender_sha256: z.literal("sha256:b5df2329cf5fbc9e1b1289d146695954fd8576aed04818baffa6fbaaff1f73de")
  }).strict(),
  identity: z.object({ model_id: z.literal("hailuo-01-director"), ai_name: z.literal("hailuo-minimax"),
    model_type: z.literal("hailuo-01-director"), operation_id: z.literal("generate-video") }).strict(),
  controls: z.object({
    resolution: z.object({ values: z.tuple([z.literal("720p")]), effective_default: z.literal("UNKNOWN") }).strict(),
    video_duration: z.object({ values: z.tuple([z.literal(6)]), unit: z.literal("INTEGER_SECONDS"), effective_default: z.literal("UNKNOWN") }).strict(),
    prompt: z.object({ source_max_length: z.literal("UNKNOWN"), local_bound: z.literal(5_000),
      local_bound_kind: z.literal("LOCAL_RESOURCE_BOUND_UTF16") }).strict()
  }).strict(),
  wire_observation: z.object({
    source: z.literal("CURRENT_CHROME_UI_OWNER_OBSERVATION"),
    method: z.literal("POST"),
    path: z.literal("/api/v1/video/generate"),
    query: z.object({ ai_name: z.literal("hailuo-minimax") }).strict(),
    settings_keys: z.tuple([z.literal("model_type"), z.literal("video_duration"), z.literal("resolution"), z.literal("file_urls")]),
    no_references: z.literal(true),
    no_presets: z.literal(true)
  }).strict(),
  ui_observation: z.object({
    source: z.literal("ROOT1124_DIRECTOR_UI_POST"),
    result: z.literal("PENDING"),
    requested_resolution: z.literal("720p"),
    requested_video_duration: z.literal(6),
    no_references: z.literal(true),
    no_preset_selected: z.literal(true)
  }).strict(),
  cost_projection: z.object({
    caller_keys: z.tuple([z.literal("resolution"), z.literal("video_duration")]),
    transport_owned_keys: z.tuple([z.literal("model_type")]),
    value_mapping: z.literal("UI_OBSERVED_RUNTIME_REQUEST"),
    amount_or_quote: z.literal("UNPROVEN")
  }).strict(),
  effective_defaults: z.literal("UNKNOWN"),
  runtime_usable: z.literal(false),
  dispatch_allowed: z.literal(false),
  backend_acceptance: z.literal("UNPROVEN")
}).strict() satisfies z.ZodType<OwnerHailuo01DirectorT2vSourceContract>;

export const ownerHailuo01DirectorT2vOutputSchema = z.object({
  status: z.literal("reviewed"),
  confidence_scope: z.literal("exact_result_only"),
  model_id: z.literal("hailuo-01-director"),
  operation_id: z.literal("generate-video"),
  modality: z.literal("video"),
  variant_id: z.literal(OWNER_HAILUO01_DIRECTOR_T2V_CONTRACT_VARIANT_ID),
  artifacts: z.array(videoArtifactSchema).max(16)
}).strict();

const recoveryListOutputSchema = z.object({
  recoveries: z.array(z.object({
    recovery_id: recoveryIdSchema,
    model_id: z.literal("hailuo-01-director"),
    operation_id: z.literal("generate-video"),
    variant_id: z.literal(OWNER_HAILUO01_DIRECTOR_T2V_CONTRACT_VARIANT_ID),
    created_at: z.iso.datetime()
  }).strict()).max(20)
}).strict();

export interface RegisterSyntxOwnerHailuo01DirectorT2vToolsOptions {
  readonly service: Pick<OwnerHailuo01DirectorT2vGenerationService,
    "getParametersSource" | "generate" | "reconcile" | "listRecoveries">;
}

/** Registers the fixed reviewed Hailuo-01 Director no-reference owner T2V flow. */
export function registerSyntxOwnerHailuo01DirectorT2vTools(
  server: McpServer,
  options: RegisterSyntxOwnerHailuo01DirectorT2vToolsOptions
): void {
  const service = options.service;

  server.registerTool(SYNTX_OWNER_GET_HAILUO01_DIRECTOR_T2V_SOURCE_TOOL_NAME, {
    title: "Get Hailuo-01 Director T2V source profile",
    description: "Returns the pinned public catalog/form/UI-observation metadata and fixed reviewed request shape only. This is not account status, subscription, model entitlement, a price quote, provider acceptance, or proof that the request succeeds. The source maximum for prompt length is unknown; 5,000 UTF-16 code units is only a local resource bound.",
    inputSchema: z.object({}).strict(),
    outputSchema: ownerHailuo01DirectorT2vSourceOutputSchema,
    annotations: { title: "Get Hailuo-01 Director T2V source profile", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (): Promise<CallToolResult> => {
    try {
      const output = ownerHailuo01DirectorT2vSourceOutputSchema.parse(service.getParametersSource());
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_HAILUO01_DIRECTOR_T2V_TOOL_NAME, {
    title: "Generate one Hailuo-01 Director 720p 6-second video",
    description: "One real, non-idempotent owner Hailuo-01 Director text-to-video request using the single reviewed no-reference profile. Supply prompt, resolution=720p, and video_duration=6 explicitly. No model selector, raw settings, preset, or media reference is supported. Each accepted call may spend account balance; there is no quote or billing cap. Prompt maximum is UNKNOWN at source; 5,000 UTF-16 code units is a local resource bound, not a provider limit. Unknown outcomes must use GET-only reconciliation; never retry generation.",
    inputSchema: z.object({
      link_attempt_id: attemptIdSchema,
      prompt: z.string().min(1).max(5_000),
      resolution: z.literal("720p"),
      video_duration: z.literal(6)
    }).strict(),
    outputSchema: ownerHailuo01DirectorT2vOutputSchema,
    annotations: { title: "Generate one Hailuo-01 Director 720p 6-second video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const request: OwnerReviewedNoReferenceT2vGenerationInput = {
        attemptId: input.link_attempt_id,
        prompt: input.prompt,
        resolution: input.resolution,
        video_duration: input.video_duration
      };
      return structuredSuccess(await service.generate(request, signal));
    } catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_HAILUO01_DIRECTOR_T2V_TOOL_NAME, {
    title: "Reconcile one Hailuo-01 Director video (GET only)",
    description: "GET-only reconciliation for the same linked owner attempt and opaque recovery id. It does not create a chat, check subscription/model access, dispatch, retry, cancel, or delete. A result remains scoped to the exact original call; the profile stays reviewed.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, recovery_id: recoveryIdSchema }).strict(),
    outputSchema: ownerHailuo01DirectorT2vOutputSchema,
    annotations: { title: "Reconcile one Hailuo-01 Director video (GET only)", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      return structuredSuccess(await service.reconcile({ attemptId: input.link_attempt_id, recovery_id: input.recovery_id }, signal), input.recovery_id);
    } catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_LIST_HAILUO01_DIRECTOR_T2V_RECOVERIES_TOOL_NAME, {
    title: "List Hailuo-01 Director video recoveries",
    description: "Lists bounded process-local Hailuo-01 Director recovery ids for one owner attempt. It performs no authentication, account read, HTTP request, or generation. Unknown dispatched calls remain held until observed, invalidated, or service close; records are not evicted to make room.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, limit: z.number().int().min(1).max(20).default(20) }).strict(),
    outputSchema: recoveryListOutputSchema,
    annotations: { title: "List Hailuo-01 Director video recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input): Promise<CallToolResult> => {
    try {
      const output = recoveryListOutputSchema.parse({ recoveries: service.listRecoveries(input.link_attempt_id, input.limit) });
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) { return safeError(error); }
  });
}

function structuredSuccess(value: unknown, recoveryId?: string): CallToolResult {
  try {
    const output = ownerHailuo01DirectorT2vOutputSchema.parse(value);
    return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output,
      ...(recoveryId === undefined ? {} : { _meta: { recovery_id: recoveryId } }) };
  } catch { return safeError(new OwnerReviewedNoReferenceT2vServiceError("OUTCOME_UNKNOWN", recoveryId)); }
}

function safeError(error: unknown): CallToolResult {
  if (error instanceof OwnerReviewedNoReferenceT2vServiceError) {
    const output = { error: {
      code: error.code,
      message: error.code === "OUTCOME_UNKNOWN"
        ? "The Hailuo-01 Director request may have been dispatched; do not retry. Use GET-only reconciliation with the same recovery id."
        : "The reviewed Hailuo-01 Director request could not be completed safely.",
      ...(error.code === "OUTCOME_UNKNOWN" && error.recovery_id !== undefined ? { recovery_id: error.recovery_id } : {})
    } };
    return { isError: true, content: [{ type: "text", text: JSON.stringify(output) }] };
  }
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: {
    code: "HAILUO01_DIRECTOR_T2V_UNAVAILABLE", message: "The reviewed Hailuo-01 Director request could not be completed safely."
  } }) }] };
}
