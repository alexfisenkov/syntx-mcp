import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { OWNER_EXPANDED_T2V_MODEL_IDS } from "../application/owner-expanded-t2v-profile.js";
import {
  OwnerExpandedT2vGenerationService,
  OwnerReviewedNoReferenceT2vServiceError
} from "../application/owner-reviewed-no-reference-t2v-service.js";

export const SYNTX_OWNER_GET_EXPANDED_T2V_PARAMETERS_TOOL_NAME = "syntx_owner_get_expanded_t2v_parameters" as const;
export const SYNTX_OWNER_GENERATE_EXPANDED_T2V_TOOL_NAME = "syntx_owner_generate_expanded_t2v" as const;
export const SYNTX_OWNER_RECONCILE_EXPANDED_T2V_TOOL_NAME = "syntx_owner_reconcile_expanded_t2v" as const;
export const SYNTX_OWNER_LIST_EXPANDED_T2V_RECOVERIES_TOOL_NAME = "syntx_owner_list_expanded_t2v_recoveries" as const;

const attemptIdSchema = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const recoveryIdSchema = z.string().regex(/^recovery_[0-9a-f-]{36}$/u);
const modelIdSchema = z.enum(OWNER_EXPANDED_T2V_MODEL_IDS);
const commonInput = { link_attempt_id: attemptIdSchema, prompt: z.string().min(1).max(5_000) };
const generationInputSchema = z.discriminatedUnion("model_id", [
  z.object({ model_id: z.literal("flux3_t2v"), ...commonInput, video_duration: z.number().int().min(5).max(20), resolution: z.enum(["hd", "fhd"]), aspect_ratio: z.enum(["auto", "21:9", "2:1", "16:9", "4:3", "1:1", "3:4", "9:16"]), generate_audio: z.boolean() }).strict(),
  z.object({ model_id: z.literal("happy_horse_t2v"), ...commonInput, video_duration: z.number().int().min(3).max(15), resolution: z.enum(["720P", "1080P"]), aspect_ratio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"]) }).strict(),
  z.object({ model_id: z.literal("seedance-1.5-pro"), ...commonInput, video_duration: z.number().int().min(5).max(12), resolution: z.literal("720p"), aspect_ratio: z.enum(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]), generate_audio: z.boolean(), camera_fixed: z.boolean() }).strict(),
  z.object({ model_id: z.literal("seedance_pro"), ...commonInput, video_duration: z.union([z.literal(5), z.literal(10)]), resolution: z.enum(["480p", "720p", "1080p"]), aspect_ratio: z.enum(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]) }).strict(),
  z.object({ model_id: z.literal("seedance_pro-fast"), ...commonInput, video_duration: z.number().int().min(5).max(12), resolution: z.enum(["480p", "720p", "1080p"]), aspect_ratio: z.enum(["16:9", "4:3", "1:1", "3:4", "9:16"]) }).strict(),
  z.object({ model_id: z.literal("text2video-4.5"), ...commonInput, video_duration: z.enum(["5.0", "8.0", "10.0"]), aspect_ratio: z.enum(["169", "916"]) }).strict()
]);
const mcpGenerationInputSchema = z.object({
  model_id: modelIdSchema,
  ...commonInput,
  video_duration: z.union([z.number().int().min(3).max(20), z.enum(["5.0", "8.0", "10.0"])]).optional(),
  resolution: z.enum(["hd", "fhd", "720P", "1080P", "720p", "480p", "1080p"]).optional(),
  aspect_ratio: z.enum(["auto", "21:9", "2:1", "16:9", "4:3", "1:1", "3:4", "9:16", "169", "916"]).optional(),
  generate_audio: z.boolean().optional(),
  camera_fixed: z.boolean().optional()
}).strict().superRefine((input, context) => {
  const parsed = generationInputSchema.safeParse(input);
  if (!parsed.success) context.addIssue({ code: "custom", message: "Fields and values must match the selected source-reviewed model controls." });
});

const sourceOutputSchema = z.object({
  status: z.literal("CURRENT_STATIC_FORM_SOURCE_REVIEWED_CONTROLS_WITH_LIMITATIONS"),
  source_pins: z.object({ public_catalog_version: z.string(), public_models_sha256: z.string(), settings_inventory_version: z.string(),
    build_id: z.string(), form_module: z.string(), form_bytes: z.number().int(), form_sha256: z.string(), sender_module: z.literal("video.js"),
    sender_bytes: z.literal(8_689), sender_sha256: z.string() }).strict(),
  identity: z.object({ model_id: modelIdSchema, ai_name: z.string(), model_type: modelIdSchema, operation_id: z.literal("generate-video") }).strict(),
  controls: z.object({ exact_reviewed_tuple: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    accepted_source_choices: z.record(z.string(), z.array(z.union([z.string(), z.number(), z.boolean()]))),
    numeric_bounds: z.record(z.string(), z.object({ minimum: z.number(), maximum: z.number(), step: z.number().optional() }).strict()),
    unresolved_controls: z.array(z.string()),
    effective_defaults: z.literal("UNKNOWN_CALLER_MUST_SUPPLY_EXPLICIT_VALUES") }).strict(),
  wire_observation: z.object({ source: z.literal("CURRENT_STATIC_SHARED_SENDER"), method: z.literal("POST"), path: z.literal("/api/v1/video/generate"),
    query_ai_name: z.string(), settings_keys: z.array(z.string()), file_urls: z.array(z.never()), no_references: z.literal(true) }).strict(),
  cost_projection: z.object({ public_keys: z.array(z.string()), caller_keys: z.array(z.string()), omitted_public_keys: z.array(z.string()), amount_or_quote: z.literal("UNPROVEN") }).strict(),
  output: z.object({ mime_type: z.literal("video/mp4"), evidence: z.literal("LOCAL_VIDEO_DECODER_PROFILE_ONLY_NOT_CURRENT_SOURCE_OR_PROVIDER_PROOF") }).strict(),
  runtime_usable: z.literal(false), dispatch_allowed: z.literal(false), backend_acceptance: z.literal("UNPROVEN")
}).strict();
const videoArtifactSchema = z.object({ url: z.string().url(), mime_type: z.literal("video/mp4").optional(), byte_size: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), duration_seconds: z.number().nonnegative().optional() }).strict();
const resultSchema = z.object({ status: z.literal("reviewed"), confidence_scope: z.literal("exact_result_only"), model_id: modelIdSchema,
  operation_id: z.literal("generate-video"), modality: z.literal("video"), variant_id: z.string(), artifacts: z.array(videoArtifactSchema).max(16) }).strict();
const recoveryItemSchema = z.object({ recovery_id: recoveryIdSchema, model_id: modelIdSchema, operation_id: z.literal("generate-video"), variant_id: z.string(), created_at: z.iso.datetime() }).strict();

export interface RegisterSyntxOwnerExpandedT2vToolsOptions {
  readonly service: Pick<OwnerExpandedT2vGenerationService, "getParametersSource" | "generate" | "reconcile" | "listRecoveries">;
}

/** Registers one grouped six-model source reader, narrow T2V dispatch, and GET-only recovery surface. */
export function registerSyntxOwnerExpandedT2vTools(server: McpServer, options: RegisterSyntxOwnerExpandedT2vToolsOptions): void {
  const service = options.service;
  server.registerTool(SYNTX_OWNER_GET_EXPANDED_T2V_PARAMETERS_TOOL_NAME, {
    title: "Get expanded T2V parameters",
    description: "Returns source-pinned no-reference controls for one of six T2V model IDs, including accepted choices and source limitations. Caller supplies every field explicitly; defaults, quote amount, output MIME source proof, and backend/provider acceptance remain unknown. Public settings are not entitlement.",
    inputSchema: z.object({ model_id: modelIdSchema }).strict(), outputSchema: sourceOutputSchema,
    annotations: { title: "Get expanded T2V parameters", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input): Promise<CallToolResult> => {
    try {
      const output = sourceOutputSchema.parse(service.getParametersSource(input.model_id));
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
    } catch { return unavailable("EXPANDED_T2V_SOURCE_UNAVAILABLE"); }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_EXPANDED_T2V_TOOL_NAME, {
    title: "Generate one reviewed expanded T2V video",
    description: "One real, non-idempotent paid owner generation for exactly one of six current T2V-only model IDs with explicitly supplied source-reviewed controls. Unsupported controls and combinations are rejected before dispatch. There is no enforceable cost cap. Unknown outcomes must use GET-only reconciliation; never retry generation.",
    inputSchema: mcpGenerationInputSchema, outputSchema: resultSchema,
    annotations: { title: "Generate one reviewed expanded T2V video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const { link_attempt_id, ...request } = input;
      return structuredSuccess(await service.generate({ ...request, attemptId: link_attempt_id }, signal));
    } catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_EXPANDED_T2V_TOOL_NAME, {
    title: "Reconcile expanded T2V result (GET only)",
    description: "GET-only recovery for the same linked owner attempt, exact model ID, and recovery id. It never uploads, creates a chat, checks model access, dispatches, retries, cancels, or deletes.",
    inputSchema: z.object({ model_id: modelIdSchema, link_attempt_id: attemptIdSchema, recovery_id: recoveryIdSchema }).strict(), outputSchema: resultSchema,
    annotations: { title: "Reconcile expanded T2V result (GET only)", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try { return structuredSuccess(await service.reconcile({ model_id: input.model_id, attemptId: input.link_attempt_id, recovery_id: input.recovery_id }, signal)); }
    catch (error) { return safeError(error, input.recovery_id); }
  });

  server.registerTool(SYNTX_OWNER_LIST_EXPANDED_T2V_RECOVERIES_TOOL_NAME, {
    title: "List expanded T2V recoveries",
    description: "Lists bounded process-local recovery IDs for one exact model and linked owner attempt. It performs no authentication, account read, network request, or generation.",
    inputSchema: z.object({ model_id: modelIdSchema, link_attempt_id: attemptIdSchema, limit: z.number().int().min(1).max(20).default(20) }).strict(),
    outputSchema: z.object({ recoveries: z.array(recoveryItemSchema).max(20) }).strict(),
    annotations: { title: "List expanded T2V recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input): Promise<CallToolResult> => {
    try {
      const output = { recoveries: service.listRecoveries(input.model_id, input.link_attempt_id, input.limit) };
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) { return safeError(error); }
  });
}

function structuredSuccess(value: unknown, recoveryId?: string): CallToolResult {
  try {
    const output = resultSchema.parse(value);
    return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output,
      ...(recoveryId === undefined ? {} : { _meta: { recovery_id: recoveryId } }) };
  } catch { return safeError(new OwnerReviewedNoReferenceT2vServiceError("OUTCOME_UNKNOWN", recoveryId)); }
}

function safeError(error: unknown, recoveryId?: string): CallToolResult {
  if (error instanceof OwnerReviewedNoReferenceT2vServiceError) {
    const id = error.code === "OUTCOME_UNKNOWN" ? error.recovery_id ?? recoveryId : undefined;
    return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code: error.code,
      message: error.code === "OUTCOME_UNKNOWN" ? "The reviewed T2V request may have been dispatched; do not retry. Use GET-only reconciliation." :
        "The reviewed expanded T2V request could not be completed safely.", ...(id === undefined ? {} : { recovery_id: id }) } }) }] };
  }
  return unavailable("EXPANDED_T2V_UNAVAILABLE");
}

function unavailable(code: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message: "Expanded T2V tools are unavailable for this request." } }) }] };
}
