import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import {
  OWNER_GROK_T2V_CONTRACT_VARIANT_ID,
  type OwnerGrokT2vSourceContract
} from "../application/owner-grok-t2v-profile.js";
import {
  OwnerReviewedNoReferenceT2vServiceError,
  OwnerGrokT2vGenerationService
} from "../application/owner-reviewed-no-reference-t2v-service.js";

export const SYNTX_OWNER_GET_GROK_T2V_SOURCE_TOOL_NAME = "syntx_owner_get_grok_t2v_source" as const;
export const SYNTX_OWNER_GENERATE_GROK_T2V_TOOL_NAME = "syntx_owner_generate_grok_t2v" as const;
export const SYNTX_OWNER_RECONCILE_GROK_T2V_TOOL_NAME = "syntx_owner_reconcile_grok_t2v" as const;
export const SYNTX_OWNER_LIST_GROK_T2V_RECOVERIES_TOOL_NAME = "syntx_owner_list_grok_t2v_recoveries" as const;
export const SYNTX_OWNER_GROK_T2V_TOOL_NAMES = Object.freeze([
  SYNTX_OWNER_GET_GROK_T2V_SOURCE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_GROK_T2V_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_GROK_T2V_TOOL_NAME,
  SYNTX_OWNER_LIST_GROK_T2V_RECOVERIES_TOOL_NAME
] as const);

const attemptIdSchema = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const recoveryIdSchema = z.string().regex(/^recovery_[0-9a-f-]{36}$/u);
const artifactSchema = z.object({
  url: z.string().url(), mime_type: z.literal("video/mp4").optional(), byte_size: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), duration_seconds: z.number().nonnegative().optional()
}).strict();
const sourceRecordSchema = z.record(z.string(), z.unknown());

export const ownerGrokT2vSourceOutputSchema = z.object({
  status: z.literal("CURRENT_1791904852_SOURCE_JOIN_NO_REFERENCE_GROK_T2V"),
  source_pins: sourceRecordSchema,
  identity: z.object({ model_id: z.literal("grok_t2v"), ai_name: z.literal("grok_video"), model_type: z.literal("grok_t2v"), operation_id: z.literal("generate-video") }).strict(),
  contract_schema_hash: z.string(), controls: sourceRecordSchema, initializer_candidates: sourceRecordSchema,
  no_reference_source: sourceRecordSchema, wire_observation: sourceRecordSchema, cost_projection: sourceRecordSchema,
  defaults: z.literal("UNKNOWN"), runtime_usable: z.literal(false), dispatch_allowed: z.literal(false), backend_acceptance: z.literal("UNPROVEN")
}).strict() as unknown as z.ZodType<OwnerGrokT2vSourceContract>;

const outputSchema = z.object({ status: z.literal("reviewed"), confidence_scope: z.literal("exact_result_only"),
  model_id: z.literal("grok_t2v"), operation_id: z.literal("generate-video"), modality: z.literal("video"),
  variant_id: z.literal(OWNER_GROK_T2V_CONTRACT_VARIANT_ID), artifacts: z.array(artifactSchema).max(16) }).strict();
const recoveryItemSchema = z.object({ recovery_id: recoveryIdSchema, model_id: z.literal("grok_t2v"),
  operation_id: z.literal("generate-video"), variant_id: z.literal(OWNER_GROK_T2V_CONTRACT_VARIANT_ID), created_at: z.iso.datetime() }).strict();
const recoveryListOutputSchema = z.object({ recoveries: z.array(recoveryItemSchema).max(20) }).strict();
const generationInputSchema = z.object({
  link_attempt_id: attemptIdSchema, prompt: z.string().min(1).max(5_000),
  aspect_ratio: z.enum(["16:9", "9:16", "3:2", "2:3", "1:1"]),
  resolution: z.enum(["480p", "720p"]), video_duration: z.union([z.literal(6), z.literal(7), z.literal(8), z.literal(9), z.literal(10)])
}).strict();

export interface RegisterSyntxOwnerGrokT2vToolsOptions {
  readonly service: Pick<OwnerGrokT2vGenerationService, "getParametersSource" | "getReviewedContract" | "generate" | "reconcile" | "listRecoveries">;
}

/** Registers four explicit owner-only Grok T2V source/generation/recovery tools. */
export function registerSyntxOwnerGrokT2vTools(server: McpServer, options: RegisterSyntxOwnerGrokT2vToolsOptions): void {
  const { service } = options;
  server.registerTool(SYNTX_OWNER_GET_GROK_T2V_SOURCE_TOOL_NAME, {
    title: "Get Grok T2V source profile",
    description: "Returns the pinned no-reference Grok T2V source contract and exact controls. Defaults, price, and backend acceptance are unknown. This static tool has no arguments and performs no account read or provider request.",
    inputSchema: z.object({}).strict(), outputSchema: ownerGrokT2vSourceOutputSchema,
    annotations: { title: "Get Grok T2V source profile", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (): Promise<CallToolResult> => {
    try {
      const output = ownerGrokT2vSourceOutputSchema.parse(service.getParametersSource());
      if (output.identity.model_id !== "grok_t2v" || output.identity.ai_name !== "grok_video" ||
          output.identity.model_type !== "grok_t2v" || service.getReviewedContract().variant_id !== OWNER_GROK_T2V_CONTRACT_VARIANT_ID) {
        throw new OwnerReviewedNoReferenceT2vServiceError("INVALID_REQUEST");
      }
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output as unknown as Record<string, unknown> };
    } catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_GROK_T2V_TOOL_NAME, {
    title: "Generate one Grok T2V video",
    description: "Starts one non-idempotent owner generation using the exact grok_t2v profile. Supply a reviewed ratio, 480p or 720p, and integer duration 6–10 seconds. Model ids, references, raw URLs, and wire fields are rejected. Price and backend acceptance are unknown. Unknown outcomes require GET-only reconciliation; never retry generation.",
    inputSchema: generationInputSchema, outputSchema,
    annotations: { title: "Generate one Grok T2V video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const { link_attempt_id, ...fields } = input;
      return structuredSuccess(await service.generate({ ...fields, attemptId: link_attempt_id }, signal));
    } catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_GROK_T2V_TOOL_NAME, {
    title: "Reconcile one Grok video (GET only)",
    description: "GET-only reconciliation for the same linked owner attempt and opaque recovery id. It does not dispatch or retry generation.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, recovery_id: recoveryIdSchema }).strict(), outputSchema,
    annotations: { title: "Reconcile one Grok video (GET only)", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async ({ link_attempt_id, recovery_id }, { signal }): Promise<CallToolResult> => {
    try { return structuredSuccess(await service.reconcile({ attemptId: link_attempt_id, recovery_id }, signal), recovery_id); }
    catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_LIST_GROK_T2V_RECOVERIES_TOOL_NAME, {
    title: "List Grok T2V recoveries",
    description: "Lists up to 20 process-local recovery handles for one linked owner attempt. No account read, HTTP request, or generation occurs.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, limit: z.number().int().min(1).max(20).default(20) }).strict(),
    outputSchema: recoveryListOutputSchema,
    annotations: { title: "List Grok T2V recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ link_attempt_id, limit }): Promise<CallToolResult> => {
    try {
      const output = recoveryListOutputSchema.parse({ recoveries: service.listRecoveries(link_attempt_id, limit) });
      if (output.recoveries.some((item) => item.model_id !== "grok_t2v" || item.variant_id !== OWNER_GROK_T2V_CONTRACT_VARIANT_ID)) {
        throw new OwnerReviewedNoReferenceT2vServiceError("INVALID_REQUEST");
      }
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) { return safeError(error); }
  });
}

function structuredSuccess(value: unknown, recoveryId?: string): CallToolResult {
  try {
    const output = outputSchema.parse(value);
    if (output.variant_id !== OWNER_GROK_T2V_CONTRACT_VARIANT_ID) throw new OwnerReviewedNoReferenceT2vServiceError("OUTCOME_UNKNOWN", recoveryId);
    return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output,
      ...(recoveryId === undefined ? {} : { _meta: { recovery_id: recoveryId } }) };
  } catch { return safeError(new OwnerReviewedNoReferenceT2vServiceError("OUTCOME_UNKNOWN", recoveryId)); }
}

function safeError(error: unknown): CallToolResult {
  if (error instanceof OwnerReviewedNoReferenceT2vServiceError) {
    const output = { error: { code: error.code,
      message: error.code === "OUTCOME_UNKNOWN" ? "The request may have been dispatched; do not retry. Use GET-only reconciliation with the same recovery id."
        : "The reviewed Grok T2V request could not be completed safely.",
      ...(error.code === "OUTCOME_UNKNOWN" && error.recovery_id !== undefined ? { recovery_id: error.recovery_id } : {}) } };
    return { isError: true, content: [{ type: "text", text: JSON.stringify(output) }] };
  }
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: {
    code: "GROK_T2V_UNAVAILABLE", message: "The reviewed Grok T2V request could not be completed safely." } }) }] };
}
