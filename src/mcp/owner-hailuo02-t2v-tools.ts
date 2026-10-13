import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import {
  OWNER_HAILUO02_T2V_CONTRACT_VARIANT_ID,
  type OwnerHailuo02T2vSourceContract
} from "../application/owner-hailuo02-t2v-profile.js";
import {
  OwnerHailuo02T2vGenerationService,
  OwnerReviewedNoReferenceT2vServiceError,
  type OwnerHailuo02T2vGenerationInput
} from "../application/owner-reviewed-no-reference-t2v-service.js";

export const SYNTX_OWNER_GET_HAILUO02_T2V_SOURCE_TOOL_NAME = "syntx_owner_get_hailuo02_t2v_source" as const;
export const SYNTX_OWNER_GENERATE_HAILUO02_T2V_TOOL_NAME = "syntx_owner_generate_hailuo02_t2v" as const;
export const SYNTX_OWNER_RECONCILE_HAILUO02_T2V_TOOL_NAME = "syntx_owner_reconcile_hailuo02_t2v" as const;
export const SYNTX_OWNER_LIST_HAILUO02_T2V_RECOVERIES_TOOL_NAME = "syntx_owner_list_hailuo02_t2v_recoveries" as const;
export const SYNTX_OWNER_HAILUO02_T2V_TOOL_NAMES = Object.freeze([
  SYNTX_OWNER_GET_HAILUO02_T2V_SOURCE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_HAILUO02_T2V_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_HAILUO02_T2V_TOOL_NAME,
  SYNTX_OWNER_LIST_HAILUO02_T2V_RECOVERIES_TOOL_NAME
] as const);

const attemptIdSchema = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const recoveryIdSchema = z.string().regex(/^recovery_[0-9a-f-]{36}$/u);
const artifactSchema = z.object({
  url: z.string().url(), mime_type: z.literal("video/mp4").optional(), byte_size: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), duration_seconds: z.number().nonnegative().optional()
}).strict();

const sourceRecordSchema = z.record(z.string(), z.unknown());
export const ownerHailuo02T2vSourceOutputSchema = z.object({
  status: z.literal("CURRENT_BUILD_STATIC_SOURCE_CONTRACT_WITH_FRESH_PUBLIC_MODEL_ROW"),
  source_pins: sourceRecordSchema,
  identity: sourceRecordSchema,
  controls: sourceRecordSchema,
  wire_observation: sourceRecordSchema,
  cost_projection: sourceRecordSchema,
  defaults: z.literal("UNKNOWN"), runtime_usable: z.literal(false), dispatch_allowed: z.literal(false), backend_acceptance: z.literal("UNPROVEN")
}).strict() as unknown as z.ZodType<OwnerHailuo02T2vSourceContract>;

export const ownerHailuo02T2vOutputSchema = z.object({ status: z.literal("reviewed"), confidence_scope: z.literal("exact_result_only"),
  model_id: z.literal("hailuo-02"), operation_id: z.literal("generate-video"), modality: z.literal("video"),
  variant_id: z.literal(OWNER_HAILUO02_T2V_CONTRACT_VARIANT_ID), artifacts: z.array(artifactSchema).max(16) }).strict();

const recoveryListOutputSchema = z.object({ recoveries: z.array(z.object({ recovery_id: recoveryIdSchema, model_id: z.literal("hailuo-02"),
  operation_id: z.literal("generate-video"), variant_id: z.literal(OWNER_HAILUO02_T2V_CONTRACT_VARIANT_ID), created_at: z.iso.datetime() }).strict()).max(20) }).strict();

export interface RegisterSyntxOwnerHailuo02T2vToolsOptions {
  readonly service: Pick<OwnerHailuo02T2vGenerationService, "getParametersSource" | "generate" | "reconcile" | "listRecoveries">;
}

/** Registers four source-pinned Hailuo 02 no-reference video operations. */
export function registerSyntxOwnerHailuo02T2vTools(server: McpServer, options: RegisterSyntxOwnerHailuo02T2vToolsOptions): void {
  const service = options.service;
  server.registerTool(SYNTX_OWNER_GET_HAILUO02_T2V_SOURCE_TOOL_NAME, {
    title: "Get Hailuo 02 T2V source profile",
    description: "Returns pinned current-build source evidence and the three explicit no-reference pairs: 768p/6s, 768p/10s, and 1080p/6s. The 512p branch requires a reference and is excluded. This is not account access or a price quote.",
    inputSchema: z.object({}).strict(), outputSchema: ownerHailuo02T2vSourceOutputSchema,
    annotations: { title: "Get Hailuo 02 T2V source profile", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (): Promise<CallToolResult> => {
    try {
      const output = ownerHailuo02T2vSourceOutputSchema.parse(service.getParametersSource());
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output as unknown as Record<string, unknown> };
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
  server.registerTool(SYNTX_OWNER_GENERATE_HAILUO02_T2V_TOOL_NAME, {
    title: "Generate one Hailuo 02 no-reference video",
    description: "Runs one non-idempotent owner generation for one explicit no-reference pair: 768p/6s, 768p/10s, or 1080p/6s. No model selector, preset, reference, or raw settings are accepted. 5,000 UTF-16 code units is a local prompt bound; provider maximum and price are unknown. Unknown outcomes require GET-only reconciliation; never retry generation.",
    inputSchema: pairFields, outputSchema: ownerHailuo02T2vOutputSchema,
    annotations: { title: "Generate one Hailuo 02 no-reference video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const request: OwnerHailuo02T2vGenerationInput = { attemptId: input.link_attempt_id, prompt: input.prompt,
        resolution: input.resolution, video_duration: input.video_duration };
      return structuredSuccess(await service.generate(request, signal));
    } catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_HAILUO02_T2V_TOOL_NAME, {
    title: "Reconcile one Hailuo 02 video (GET only)",
    description: "GET-only reconciliation for the same linked owner attempt and opaque recovery id. It does not create a chat, check subscription or model access, dispatch, retry, cancel, or delete.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, recovery_id: recoveryIdSchema }).strict(), outputSchema: ownerHailuo02T2vOutputSchema,
    annotations: { title: "Reconcile one Hailuo 02 video (GET only)", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try { return structuredSuccess(await service.reconcile({ attemptId: input.link_attempt_id, recovery_id: input.recovery_id }, signal), input.recovery_id); }
    catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_LIST_HAILUO02_T2V_RECOVERIES_TOOL_NAME, {
    title: "List Hailuo 02 video recoveries",
    description: "Lists bounded process-local recovery ids for one owner attempt without authentication, account reads, HTTP requests, or generation.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, limit: z.number().int().min(1).max(20).default(20) }).strict(), outputSchema: recoveryListOutputSchema,
    annotations: { title: "List Hailuo 02 video recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input): Promise<CallToolResult> => {
    try {
      const output = recoveryListOutputSchema.parse({ recoveries: service.listRecoveries(input.link_attempt_id, input.limit) });
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) { return safeError(error); }
  });
}

function structuredSuccess(value: unknown, recoveryId?: string): CallToolResult {
  try {
    const output = ownerHailuo02T2vOutputSchema.parse(value);
    return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output,
      ...(recoveryId === undefined ? {} : { _meta: { recovery_id: recoveryId } }) };
  } catch { return safeError(new OwnerReviewedNoReferenceT2vServiceError("OUTCOME_UNKNOWN", recoveryId)); }
}

function safeError(error: unknown): CallToolResult {
  if (error instanceof OwnerReviewedNoReferenceT2vServiceError) {
    const output = { error: { code: error.code,
      message: error.code === "OUTCOME_UNKNOWN" ? "The request may have been dispatched; do not retry. Use GET-only reconciliation with the same recovery id."
        : "The reviewed Hailuo 02 request could not be completed safely.",
      ...(error.code === "OUTCOME_UNKNOWN" && error.recovery_id !== undefined ? { recovery_id: error.recovery_id } : {}) } };
    return { isError: true, content: [{ type: "text", text: JSON.stringify(output) }] };
  }
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: {
    code: "HAILUO02_T2V_UNAVAILABLE", message: "The reviewed Hailuo 02 request could not be completed safely." } }) }] };
}
