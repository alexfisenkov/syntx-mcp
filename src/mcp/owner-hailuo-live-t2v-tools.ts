import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import {
  OWNER_HAILUO_LIVE_T2V_CONTRACT_VARIANT_ID,
  type OwnerHailuoLiveT2vSourceContract
} from "../application/owner-hailuo-live-t2v-profile.js";
import {
  OwnerHailuoLiveT2vGenerationService,
  OwnerReviewedNoReferenceT2vServiceError,
  type OwnerReviewedNoReferenceT2vGenerationInput
} from "../application/owner-reviewed-no-reference-t2v-service.js";

export const SYNTX_OWNER_GET_HAILUO_LIVE_T2V_SOURCE_TOOL_NAME = "syntx_owner_get_hailuo_live_t2v_source" as const;
export const SYNTX_OWNER_GENERATE_HAILUO_LIVE_T2V_TOOL_NAME = "syntx_owner_generate_hailuo_live_t2v" as const;
export const SYNTX_OWNER_RECONCILE_HAILUO_LIVE_T2V_TOOL_NAME = "syntx_owner_reconcile_hailuo_live_t2v" as const;
export const SYNTX_OWNER_LIST_HAILUO_LIVE_T2V_RECOVERIES_TOOL_NAME = "syntx_owner_list_hailuo_live_t2v_recoveries" as const;
export const SYNTX_OWNER_HAILUO_LIVE_T2V_TOOL_NAMES = Object.freeze([
  SYNTX_OWNER_GET_HAILUO_LIVE_T2V_SOURCE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_HAILUO_LIVE_T2V_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_HAILUO_LIVE_T2V_TOOL_NAME,
  SYNTX_OWNER_LIST_HAILUO_LIVE_T2V_RECOVERIES_TOOL_NAME
] as const);

const attemptIdSchema = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const recoveryIdSchema = z.string().regex(/^recovery_[0-9a-f-]{36}$/u);
const artifactSchema = z.object({
  url: z.string().url(), mime_type: z.literal("video/mp4").optional(), byte_size: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), duration_seconds: z.number().nonnegative().optional()
}).strict();
const recordSchema = z.record(z.string(), z.unknown());

export const ownerHailuoLiveT2vSourceOutputSchema = z.object({
  status: z.literal("CURRENT_1791904852_SOURCE_JOIN_LIVE_NO_REFERENCE_720P_6S"),
  source_pins: recordSchema,
  identity: recordSchema,
  controls: recordSchema,
  no_reference_source: recordSchema,
  wire_observation: recordSchema,
  cost_projection: recordSchema,
  defaults: z.literal("UNKNOWN"), runtime_usable: z.literal(false), dispatch_allowed: z.literal(false), backend_acceptance: z.literal("UNPROVEN")
}).strict() as unknown as z.ZodType<OwnerHailuoLiveT2vSourceContract>;

export const ownerHailuoLiveT2vOutputSchema = z.object({
  status: z.literal("reviewed"), confidence_scope: z.literal("exact_result_only"), model_id: z.literal("hailuo-01-live"),
  operation_id: z.literal("generate-video"), modality: z.literal("video"),
  variant_id: z.literal(OWNER_HAILUO_LIVE_T2V_CONTRACT_VARIANT_ID), artifacts: z.array(artifactSchema).max(16)
}).strict();

const recoveryListOutputSchema = z.object({ recoveries: z.array(z.object({ recovery_id: recoveryIdSchema,
  model_id: z.literal("hailuo-01-live"), operation_id: z.literal("generate-video"),
  variant_id: z.literal(OWNER_HAILUO_LIVE_T2V_CONTRACT_VARIANT_ID), created_at: z.iso.datetime() }).strict()).max(20) }).strict();

export interface RegisterSyntxOwnerHailuoLiveT2vToolsOptions {
  readonly service: Pick<OwnerHailuoLiveT2vGenerationService, "getParametersSource" | "generate" | "reconcile" | "listRecoveries">;
}

/** Registers the four fixed Hailuo Live source, generation, and recovery operations. */
export function registerSyntxOwnerHailuoLiveT2vTools(server: McpServer, options: RegisterSyntxOwnerHailuoLiveT2vToolsOptions): void {
  const service = options.service;
  server.registerTool(SYNTX_OWNER_GET_HAILUO_LIVE_T2V_SOURCE_TOOL_NAME, {
    title: "Get Hailuo Live T2V source profile",
    description: "Returns pinned source metadata and the fixed reviewed no-reference shape. This is not account entitlement, a price quote, provider acceptance, or proof that generation succeeds. The source prompt maximum is unknown; 5,000 UTF-16 code units is a local resource bound.",
    inputSchema: z.object({}).strict(), outputSchema: ownerHailuoLiveT2vSourceOutputSchema,
    annotations: { title: "Get Hailuo Live T2V source profile", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (): Promise<CallToolResult> => {
    try {
      const output = ownerHailuoLiveT2vSourceOutputSchema.parse(service.getParametersSource());
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output as unknown as Record<string, unknown> };
    } catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_HAILUO_LIVE_T2V_TOOL_NAME, {
    title: "Generate one Hailuo Live 720p 6-second video",
    description: "Runs one non-idempotent owner generation using the fixed source-reviewed Hailuo Live no-reference pair: resolution=720p and video_duration=6. Supply both explicitly. No model selector, reference, aspect ratio, mode, preset, or raw settings are accepted. There is no price quote or billing cap. Unknown outcomes require GET-only reconciliation with the same recovery id; never retry generation.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, prompt: z.string().min(1).max(5_000),
      resolution: z.literal("720p"), video_duration: z.literal(6) }).strict(),
    outputSchema: ownerHailuoLiveT2vOutputSchema,
    annotations: { title: "Generate one Hailuo Live 720p 6-second video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const request: OwnerReviewedNoReferenceT2vGenerationInput = {
        attemptId: input.link_attempt_id, prompt: input.prompt, resolution: input.resolution, video_duration: input.video_duration
      };
      return structuredSuccess(await service.generate(request, signal));
    } catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_HAILUO_LIVE_T2V_TOOL_NAME, {
    title: "Reconcile one Hailuo Live video (GET only)",
    description: "GET-only reconciliation for the same linked owner attempt and opaque recovery id. It does not dispatch, retry, check access, cancel, or delete.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, recovery_id: recoveryIdSchema }).strict(), outputSchema: ownerHailuoLiveT2vOutputSchema,
    annotations: { title: "Reconcile one Hailuo Live video (GET only)", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try { return structuredSuccess(await service.reconcile({ attemptId: input.link_attempt_id, recovery_id: input.recovery_id }, signal), input.recovery_id); }
    catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_LIST_HAILUO_LIVE_T2V_RECOVERIES_TOOL_NAME, {
    title: "List Hailuo Live video recoveries",
    description: "Lists bounded process-local recovery ids for one owner attempt without authentication, account reads, HTTP requests, or generation.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, limit: z.number().int().min(1).max(20).default(20) }).strict(),
    outputSchema: recoveryListOutputSchema,
    annotations: { title: "List Hailuo Live video recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input): Promise<CallToolResult> => {
    try {
      const output = recoveryListOutputSchema.parse({ recoveries: service.listRecoveries(input.link_attempt_id, input.limit) });
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) { return safeError(error); }
  });
}

function structuredSuccess(value: unknown, recoveryId?: string): CallToolResult {
  try {
    const output = ownerHailuoLiveT2vOutputSchema.parse(value);
    return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output,
      ...(recoveryId === undefined ? {} : { _meta: { recovery_id: recoveryId } }) };
  } catch { return safeError(new OwnerReviewedNoReferenceT2vServiceError("OUTCOME_UNKNOWN", recoveryId)); }
}

function safeError(error: unknown): CallToolResult {
  if (error instanceof OwnerReviewedNoReferenceT2vServiceError) {
    const output = { error: { code: error.code,
      message: error.code === "OUTCOME_UNKNOWN" ? "The Hailuo Live request may have been dispatched; do not retry. Use GET-only reconciliation with the same recovery id."
        : "The reviewed Hailuo Live request could not be completed safely.",
      ...(error.code === "OUTCOME_UNKNOWN" && error.recovery_id !== undefined ? { recovery_id: error.recovery_id } : {}) } };
    return { isError: true, content: [{ type: "text", text: JSON.stringify(output) }] };
  }
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: {
    code: "HAILUO_LIVE_T2V_UNAVAILABLE", message: "The reviewed Hailuo Live request could not be completed safely." } }) }] };
}
