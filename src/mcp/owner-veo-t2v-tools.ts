import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import {
  OWNER_VEO_T2V_CONTRACT_VARIANT_IDS,
  type OwnerVeoT2vModelId,
  type OwnerVeoT2vSourceContract
} from "../application/owner-veo-t2v-profile.js";
import {
  OwnerReviewedNoReferenceT2vServiceError,
  OwnerVeoT2vGenerationService,
  type OwnerVeoT2vGenerationInput
} from "../application/owner-reviewed-no-reference-t2v-service.js";

export const SYNTX_OWNER_GET_VEO_T2V_SOURCE_TOOL_NAME = "syntx_owner_get_veo_t2v_source" as const;
export const SYNTX_OWNER_GENERATE_VEO_T2V_TOOL_NAME = "syntx_owner_generate_veo_t2v" as const;
export const SYNTX_OWNER_RECONCILE_VEO_T2V_TOOL_NAME = "syntx_owner_reconcile_veo_t2v" as const;
export const SYNTX_OWNER_LIST_VEO_T2V_RECOVERIES_TOOL_NAME = "syntx_owner_list_veo_t2v_recoveries" as const;
export const SYNTX_OWNER_VEO_T2V_TOOL_NAMES = Object.freeze([
  SYNTX_OWNER_GET_VEO_T2V_SOURCE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_VEO_T2V_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_VEO_T2V_TOOL_NAME,
  SYNTX_OWNER_LIST_VEO_T2V_RECOVERIES_TOOL_NAME
] as const);

const modelIdSchema = z.enum(["veo3", "veo3fast", "veo3fast_r"]);
const attemptIdSchema = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const recoveryIdSchema = z.string().regex(/^recovery_[0-9a-f-]{36}$/u);
const artifactSchema = z.object({
  url: z.string().url(), mime_type: z.literal("video/mp4").optional(), byte_size: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), duration_seconds: z.number().nonnegative().optional()
}).strict();
const sourceRecordSchema = z.record(z.string(), z.unknown());

export const ownerVeoT2vSourceOutputSchema = z.object({
  status: z.literal("CURRENT_1791904852_SOURCE_JOIN_NO_REFERENCE_VEO_T2V"),
  source_pins: sourceRecordSchema,
  identity: z.object({ model_id: modelIdSchema, ai_name: z.literal("veo3"), model_type: modelIdSchema, operation_id: z.literal("generate-video") }).strict(),
  contract_schema_hash: z.string(),
  controls: sourceRecordSchema,
  no_reference_source: sourceRecordSchema,
  wire_observation: sourceRecordSchema,
  cost_projection: sourceRecordSchema,
  defaults: z.literal("UNKNOWN"), runtime_usable: z.literal(false), dispatch_allowed: z.literal(false), backend_acceptance: z.literal("UNPROVEN")
}).strict() as unknown as z.ZodType<OwnerVeoT2vSourceContract>;

const variantIdSchema = z.enum([
  OWNER_VEO_T2V_CONTRACT_VARIANT_IDS.veo3,
  OWNER_VEO_T2V_CONTRACT_VARIANT_IDS.veo3fast,
  OWNER_VEO_T2V_CONTRACT_VARIANT_IDS.veo3fast_r
]);
const ownerVeoT2vOutputSchema = z.object({ status: z.literal("reviewed"), confidence_scope: z.literal("exact_result_only"),
  model_id: modelIdSchema, operation_id: z.literal("generate-video"), modality: z.literal("video"),
  variant_id: variantIdSchema, artifacts: z.array(artifactSchema).max(16) }).strict();
const recoveryItemSchema = z.object({ recovery_id: recoveryIdSchema, model_id: modelIdSchema, operation_id: z.literal("generate-video"),
  variant_id: variantIdSchema, created_at: z.iso.datetime() }).strict();
const recoveryListOutputSchema = z.object({ recoveries: z.array(recoveryItemSchema).max(20) }).strict();

const generationFields = {
  link_attempt_id: attemptIdSchema,
  prompt: z.string().min(8),
  upscale: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  aspect_ratio: z.enum(["16:9", "9:16"]),
  video_duration: z.literal(8)
} as const;
const generationInputSchema = z.discriminatedUnion("model_id", [
  z.object({ ...generationFields, model_id: z.literal("veo3") }).strict(),
  z.object({ ...generationFields, model_id: z.literal("veo3fast") }).strict(),
  z.object({ ...generationFields, model_id: z.literal("veo3fast_r") }).strict()
]);

export interface RegisterSyntxOwnerVeoT2vToolsOptions {
  readonly service: Pick<OwnerVeoT2vGenerationService, "getParametersSource" | "generate" | "reconcile" | "listRecoveries">;
}

/** Registers the four source-pinned Veo T2V family tools. */
export function registerSyntxOwnerVeoT2vTools(server: McpServer, options: RegisterSyntxOwnerVeoT2vToolsOptions): void {
  const service = options.service;
  server.registerTool(SYNTX_OWNER_GET_VEO_T2V_SOURCE_TOOL_NAME, {
    title: "Get Veo T2V source profile",
    description: "Returns the pinned no-reference T2V source evidence for one exact Veo model. Quality values are numeric 0, 1, or 2; labels are display-only, and draft value 3 is excluded. Defaults, price, and provider acceptance are unknown. This does not read account state or generate media.",
    inputSchema: z.object({ model_id: modelIdSchema }).strict(), outputSchema: ownerVeoT2vSourceOutputSchema,
    annotations: { title: "Get Veo T2V source profile", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ model_id }): Promise<CallToolResult> => {
    try {
      const output = ownerVeoT2vSourceOutputSchema.parse(service.getParametersSource(model_id as OwnerVeoT2vModelId));
      if (output.identity.model_id !== model_id || output.identity.model_type !== model_id) {
        throw new OwnerReviewedNoReferenceT2vServiceError("INVALID_REQUEST");
      }
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output as unknown as Record<string, unknown> };
    } catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_VEO_T2V_TOOL_NAME, {
    title: "Generate one Veo T2V video",
    description: "Runs one non-idempotent owner generation for the exact selected model. Supply numeric upscale 0, 1, or 2, a supported ratio, and 8 seconds. The server fixes text mode and empty file_urls. Display labels, draft value 3, references, URLs, wire fields, and raw chat identifiers are rejected. Price and backend acceptance are unknown. Unknown outcomes require GET-only reconciliation; never retry generation.",
    inputSchema: generationInputSchema, outputSchema: ownerVeoT2vOutputSchema,
    annotations: { title: "Generate one Veo T2V video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const { link_attempt_id, ...sourceFields } = input;
      const request = { ...sourceFields, attemptId: link_attempt_id } as OwnerVeoT2vGenerationInput;
      return structuredSuccess(await service.generate(request, signal));
    } catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_VEO_T2V_TOOL_NAME, {
    title: "Reconcile one Veo video (GET only)",
    description: "GET-only reconciliation for the same linked owner attempt, exact model id, and opaque recovery id. It does not dispatch or retry generation.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, model_id: modelIdSchema, recovery_id: recoveryIdSchema }).strict(),
    outputSchema: ownerVeoT2vOutputSchema,
    annotations: { title: "Reconcile one Veo video (GET only)", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async ({ link_attempt_id, model_id, recovery_id }, { signal }): Promise<CallToolResult> => {
    try { return structuredSuccess(await service.reconcile({ attemptId: link_attempt_id, model_id, recovery_id }, signal), recovery_id); }
    catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_LIST_VEO_T2V_RECOVERIES_TOOL_NAME, {
    title: "List Veo T2V recoveries",
    description: "Lists up to 20 process-local recovery handles for the linked owner attempt across the three exact Veo T2V models. No authentication, account read, HTTP request, or generation occurs.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, limit: z.number().int().min(1).max(20).default(20) }).strict(),
    outputSchema: recoveryListOutputSchema,
    annotations: { title: "List Veo T2V recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ link_attempt_id, limit }): Promise<CallToolResult> => {
    try {
      const output = recoveryListOutputSchema.parse({ recoveries: service.listRecoveries(link_attempt_id, limit) });
      if (output.recoveries.some((item) => item.variant_id !== OWNER_VEO_T2V_CONTRACT_VARIANT_IDS[item.model_id])) {
        throw new OwnerReviewedNoReferenceT2vServiceError("INVALID_REQUEST");
      }
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) { return safeError(error); }
  });
}

function structuredSuccess(value: unknown, recoveryId?: string): CallToolResult {
  try {
    const output = ownerVeoT2vOutputSchema.parse(value);
    if (output.variant_id !== OWNER_VEO_T2V_CONTRACT_VARIANT_IDS[output.model_id]) {
      throw new OwnerReviewedNoReferenceT2vServiceError("OUTCOME_UNKNOWN", recoveryId);
    }
    return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output,
      ...(recoveryId === undefined ? {} : { _meta: { recovery_id: recoveryId } }) };
  } catch { return safeError(new OwnerReviewedNoReferenceT2vServiceError("OUTCOME_UNKNOWN", recoveryId)); }
}

function safeError(error: unknown): CallToolResult {
  if (error instanceof OwnerReviewedNoReferenceT2vServiceError) {
    const output = { error: { code: error.code,
      message: error.code === "OUTCOME_UNKNOWN" ? "The request may have been dispatched; do not retry. Use GET-only reconciliation with the same recovery id."
        : "The reviewed Veo T2V request could not be completed safely.",
      ...(error.code === "OUTCOME_UNKNOWN" && error.recovery_id !== undefined ? { recovery_id: error.recovery_id } : {}) } };
    return { isError: true, content: [{ type: "text", text: JSON.stringify(output) }] };
  }
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: {
    code: "VEO_T2V_UNAVAILABLE", message: "The reviewed Veo T2V request could not be completed safely." } }) }] };
}
