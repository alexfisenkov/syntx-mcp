import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import {
  OWNER_SEEDANCE20_T2V_CONTRACT_VARIANT_ID,
  type OwnerSeedance20T2vSourceContract
} from "../application/owner-seedance20-t2v-profile.js";
import {
  OwnerReviewedNoReferenceT2vServiceError,
  OwnerSeedance20T2vGenerationService,
  type OwnerSeedance20T2vGenerationInput
} from "../application/owner-reviewed-no-reference-t2v-service.js";

export const SYNTX_OWNER_GET_SEEDANCE20_T2V_SOURCE_TOOL_NAME = "syntx_owner_get_seedance20_t2v_source" as const;
export const SYNTX_OWNER_GENERATE_SEEDANCE20_T2V_TOOL_NAME = "syntx_owner_generate_seedance20_t2v" as const;
export const SYNTX_OWNER_RECONCILE_SEEDANCE20_T2V_TOOL_NAME = "syntx_owner_reconcile_seedance20_t2v" as const;
export const SYNTX_OWNER_LIST_SEEDANCE20_T2V_RECOVERIES_TOOL_NAME = "syntx_owner_list_seedance20_t2v_recoveries" as const;
export const SYNTX_OWNER_SEEDANCE20_T2V_TOOL_NAMES = Object.freeze([
  SYNTX_OWNER_GET_SEEDANCE20_T2V_SOURCE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_SEEDANCE20_T2V_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_SEEDANCE20_T2V_TOOL_NAME,
  SYNTX_OWNER_LIST_SEEDANCE20_T2V_RECOVERIES_TOOL_NAME
] as const);

const attemptIdSchema = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const recoveryIdSchema = z.string().regex(/^recovery_[0-9a-f-]{36}$/u);
const artifactSchema = z.object({
  url: z.string().url(), mime_type: z.literal("video/mp4").optional(), byte_size: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), duration_seconds: z.number().nonnegative().optional()
}).strict();

const sourceRecordSchema = z.record(z.string(), z.unknown());
export const ownerSeedance20T2vSourceOutputSchema = z.object({
  status: z.literal("CURRENT_1791904852_SOURCE_JOIN_NO_REFERENCE_MINI_VARIANT"),
  source_pins: sourceRecordSchema,
  identity: sourceRecordSchema,
  controls: sourceRecordSchema,
  excluded_controls: sourceRecordSchema,
  wire_observation: sourceRecordSchema,
  cost_projection: sourceRecordSchema,
  defaults: z.literal("UNKNOWN"), runtime_usable: z.literal(false), dispatch_allowed: z.literal(false), backend_acceptance: z.literal("UNPROVEN")
}).strict() as unknown as z.ZodType<OwnerSeedance20T2vSourceContract>;

export const ownerSeedance20T2vOutputSchema = z.object({ status: z.literal("reviewed"), confidence_scope: z.literal("exact_result_only"),
  model_id: z.literal("seedance-2.0"), operation_id: z.literal("generate-video"), modality: z.literal("video"),
  variant_id: z.literal(OWNER_SEEDANCE20_T2V_CONTRACT_VARIANT_ID), artifacts: z.array(artifactSchema).max(16) }).strict();

const recoveryListOutputSchema = z.object({ recoveries: z.array(z.object({ recovery_id: recoveryIdSchema, model_id: z.literal("seedance-2.0"),
  operation_id: z.literal("generate-video"), variant_id: z.literal(OWNER_SEEDANCE20_T2V_CONTRACT_VARIANT_ID), created_at: z.iso.datetime() }).strict()).max(20) }).strict();

export interface RegisterSyntxOwnerSeedance20T2vToolsOptions {
  readonly service: Pick<OwnerSeedance20T2vGenerationService, "getParametersSource" | "generate" | "reconcile" | "listRecoveries">;
}

/** Registers four source-pinned Seedance 2.0 mini no-reference video tools. */
export function registerSyntxOwnerSeedance20T2vTools(server: McpServer, options: RegisterSyntxOwnerSeedance20T2vToolsOptions): void {
  const service = options.service;
  server.registerTool(SYNTX_OWNER_GET_SEEDANCE20_T2V_SOURCE_TOOL_NAME, {
    title: "Get Seedance 2.0 mini T2V source profile",
    description: "Returns the pinned Seedance 2.0 mini source contract. The profile requires explicit resolution (480p or 720p), aspect ratio, duration (4–15 seconds), and generate_audio. mode=mini and no-reference file_urls are injected by the sealed profile; mode is not a caller selector. camera_fixed is hidden for Seedance 2.0. Defaults, provider acceptance, and price are unknown.",
    inputSchema: z.object({}).strict(), outputSchema: ownerSeedance20T2vSourceOutputSchema,
    annotations: { title: "Get Seedance 2.0 mini T2V source profile", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (): Promise<CallToolResult> => {
    try {
      const output = ownerSeedance20T2vSourceOutputSchema.parse(service.getParametersSource());
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output as unknown as Record<string, unknown> };
    } catch (error) { return safeError(error); }
  });

  const generationInputSchema = z.object({
    link_attempt_id: attemptIdSchema,
    prompt: z.string().min(1).max(5_000),
    resolution: z.enum(["480p", "720p"]),
    aspect_ratio: z.enum(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]),
    video_duration: z.number().int().min(4).max(15),
    generate_audio: z.boolean()
  }).strict();
  server.registerTool(SYNTX_OWNER_GENERATE_SEEDANCE20_T2V_TOOL_NAME, {
    title: "Generate one Seedance 2.0 mini no-reference video",
    description: "Runs one non-idempotent owner generation with no references. Select 480p or 720p, one of the source-listed aspect ratios, a 4–15 second duration, and generate_audio explicitly. mode=mini and file_urls=[] are injected; camera_fixed, raw settings, URLs, and mode selectors are not accepted. 5,000 UTF-16 code units is a local prompt bound. Price and provider acceptance are unknown. Unknown outcomes require GET-only reconciliation; never retry generation.",
    inputSchema: generationInputSchema, outputSchema: ownerSeedance20T2vOutputSchema,
    annotations: { title: "Generate one Seedance 2.0 mini no-reference video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const request: OwnerSeedance20T2vGenerationInput = {
        attemptId: input.link_attempt_id, prompt: input.prompt, resolution: input.resolution,
        aspect_ratio: input.aspect_ratio, video_duration: input.video_duration, generate_audio: input.generate_audio
      };
      return structuredSuccess(await service.generate(request, signal));
    } catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_SEEDANCE20_T2V_TOOL_NAME, {
    title: "Reconcile one Seedance 2.0 video (GET only)",
    description: "GET-only reconciliation for the same linked owner attempt and opaque recovery id. It does not create a chat, check subscription or model access, dispatch, retry, cancel, or delete.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, recovery_id: recoveryIdSchema }).strict(), outputSchema: ownerSeedance20T2vOutputSchema,
    annotations: { title: "Reconcile one Seedance 2.0 video (GET only)", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try { return structuredSuccess(await service.reconcile({ attemptId: input.link_attempt_id, recovery_id: input.recovery_id }, signal), input.recovery_id); }
    catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_LIST_SEEDANCE20_T2V_RECOVERIES_TOOL_NAME, {
    title: "List Seedance 2.0 video recoveries",
    description: "Lists bounded process-local recovery ids for one owner attempt without authentication, account reads, HTTP requests, or generation.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, limit: z.number().int().min(1).max(20).default(20) }).strict(), outputSchema: recoveryListOutputSchema,
    annotations: { title: "List Seedance 2.0 video recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input): Promise<CallToolResult> => {
    try {
      const output = recoveryListOutputSchema.parse({ recoveries: service.listRecoveries(input.link_attempt_id, input.limit) });
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) { return safeError(error); }
  });
}

function structuredSuccess(value: unknown, recoveryId?: string): CallToolResult {
  try {
    const output = ownerSeedance20T2vOutputSchema.parse(value);
    return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output,
      ...(recoveryId === undefined ? {} : { _meta: { recovery_id: recoveryId } }) };
  } catch { return safeError(new OwnerReviewedNoReferenceT2vServiceError("OUTCOME_UNKNOWN", recoveryId)); }
}

function safeError(error: unknown): CallToolResult {
  if (error instanceof OwnerReviewedNoReferenceT2vServiceError) {
    const output = { error: { code: error.code,
      message: error.code === "OUTCOME_UNKNOWN" ? "The request may have been dispatched; do not retry. Use GET-only reconciliation with the same recovery id."
        : "The reviewed Seedance 2.0 request could not be completed safely.",
      ...(error.code === "OUTCOME_UNKNOWN" && error.recovery_id !== undefined ? { recovery_id: error.recovery_id } : {}) } };
    return { isError: true, content: [{ type: "text", text: JSON.stringify(output) }] };
  }
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: {
    code: "SEEDANCE20_T2V_UNAVAILABLE", message: "The reviewed Seedance 2.0 request could not be completed safely." } }) }] };
}
