import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import {
  OWNER_VEO_OMNI_T2V_CONTRACT_VARIANT_ID,
  type OwnerVeoOmniT2vSourceContract
} from "../application/owner-veo-omni-t2v-profile.js";
import { OwnerReviewedNoReferenceT2vServiceError } from "../application/owner-reviewed-no-reference-t2v-service.js";

export const SYNTX_OWNER_GET_VEO_OMNI_T2V_SOURCE_TOOL_NAME = "syntx_owner_get_veo_omni_t2v_source" as const;
export const SYNTX_OWNER_GENERATE_VEO_OMNI_T2V_TOOL_NAME = "syntx_owner_generate_veo_omni_t2v" as const;
export const SYNTX_OWNER_RECONCILE_VEO_OMNI_T2V_TOOL_NAME = "syntx_owner_reconcile_veo_omni_t2v" as const;
export const SYNTX_OWNER_LIST_VEO_OMNI_T2V_RECOVERIES_TOOL_NAME = "syntx_owner_list_veo_omni_t2v_recoveries" as const;
export const SYNTX_OWNER_VEO_OMNI_T2V_TOOL_NAMES = Object.freeze([
  SYNTX_OWNER_GET_VEO_OMNI_T2V_SOURCE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_VEO_OMNI_T2V_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_VEO_OMNI_T2V_TOOL_NAME,
  SYNTX_OWNER_LIST_VEO_OMNI_T2V_RECOVERIES_TOOL_NAME
] as const);

const attemptIdSchema = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const recoveryIdSchema = z.string().regex(/^recovery_[0-9a-f-]{36}$/u);
const artifactSchema = z.object({
  url: z.string().url(), mime_type: z.literal("video/mp4").optional(), byte_size: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), duration_seconds: z.number().nonnegative().optional()
}).strict();
const sourceRecordSchema = z.record(z.string(), z.unknown());
const sourcePinsSchema = z.object({
  public_catalog_version: z.literal("sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json"),
  public_models_sha256: z.literal("sha256:92c31dba26eb9c0ccf68cdf92a105e6e808c92b187286e4fb366debe051982e1"),
  source_build_id: z.literal("1792156098"),
  modules: z.object({
    app: z.literal("sha256:eb1b2c82b9f62fbe378064bbd607cdb5cc875a4df1d2ae6f2d531d4baa59f042"),
    constants: z.literal("sha256:f56c58e705e32b6a4ddfc7cc44e62fd6ca029e6c33a848621812428a365ef2c2"),
    quality_helper: z.literal("sha256:7a38ef339db6700d1ccf7fe5a5be23e56722144f216e1db29bf7ff07b8849bf4"),
    settings_helper: z.literal("sha256:7fb7a1113b89060cdd9af313cb3f4a140c754959fbda3d997f49bdcacabc52e6"),
    veo_form: z.literal("sha256:75c37d86280482f13b12d5edd546c36c0314cac91c24984aae0a6e9c7ba925a1"),
    video_route: z.literal("sha256:8310cb1c9ac8221077220da873cfe785e35408b43b1cfba85d409272c9b44596"),
    video_sender: z.literal("sha256:3dbb36e710d6e35ae9babef856678af06cb5d2352beb7a67aa60d47cd6ffc49b")
  }).strict()
}).strict();

export const ownerVeoOmniT2vSourceOutputSchema = z.object({
  status: z.literal("CURRENT_1792156098_SOURCE_JOIN_OMNI_T2V"),
  source_pins: sourcePinsSchema,
  identity: z.object({ model_id: z.literal("veo_omni"), ai_name: z.literal("veo3"), model_type: z.literal("veo_omni"), operation_id: z.literal("generate-video") }).strict(),
  controls: sourceRecordSchema,
  settings_selection: sourceRecordSchema,
  cost_projection: sourceRecordSchema,
  local_t2v_scope: z.object({ type: z.literal("text"), file_urls: z.array(z.never()), caller_reference_fields: z.literal(false), scope: z.literal("LOCAL_T2V_ONLY_PUBLIC_REFERENCE_LIMITS_RETAINED") }).strict(),
  public_model_limits: sourceRecordSchema,
  effective_defaults: z.literal("UNKNOWN"),
  duration_upscale_compatibility: z.literal("UNKNOWN_NOT_ENFORCED"),
  runtime_usable: z.literal(false), dispatch_allowed: z.literal(false), backend_acceptance: z.literal("UNPROVEN")
}).strict() as unknown as z.ZodType<OwnerVeoOmniT2vSourceContract>;

const outputSchema = z.object({
  status: z.literal("reviewed"), confidence_scope: z.literal("exact_result_only"),
  model_id: z.literal("veo_omni"), operation_id: z.literal("generate-video"), modality: z.literal("video"),
  variant_id: z.literal(OWNER_VEO_OMNI_T2V_CONTRACT_VARIANT_ID), artifacts: z.array(artifactSchema).max(16)
}).strict();
const recoveryItemSchema = z.object({ recovery_id: recoveryIdSchema, model_id: z.literal("veo_omni"),
  operation_id: z.literal("generate-video"), variant_id: z.literal(OWNER_VEO_OMNI_T2V_CONTRACT_VARIANT_ID), created_at: z.iso.datetime() }).strict();
const recoveryListOutputSchema = z.object({ recoveries: z.array(recoveryItemSchema).max(20) }).strict();

const generationInputSchema = z.object({
  link_attempt_id: attemptIdSchema,
  prompt: z.string().min(1).max(100_000).refine((value) => [...value.trim()].length >= 8 && [...value].length <= 50_000),
  upscale: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  aspect_ratio: z.enum(["16:9", "9:16"]),
  video_duration: z.union([z.literal(4), z.literal(6), z.literal(8), z.literal(10)])
}).strict();

/** Structural ABI keeps this module independently buildable while the Omni service adapter lands. */
export interface OwnerVeoOmniT2vToolService {
  getParametersSource(): unknown;
  getReviewedContract(): { readonly variant_id: string };
  generate(input: unknown, signal?: AbortSignal): Promise<unknown>;
  reconcile(input: unknown, signal?: AbortSignal): Promise<unknown>;
  listRecoveries(attemptId: string, limit?: number): readonly unknown[];
}

export interface RegisterSyntxOwnerVeoOmniT2vToolsOptions {
  readonly service: OwnerVeoOmniT2vToolService;
}

/** Registers the fixed owner-only Veo Omni text/no-reference T2V tools. */
export function registerSyntxOwnerVeoOmniT2vTools(server: McpServer, options: RegisterSyntxOwnerVeoOmniT2vToolsOptions): void {
  const { service } = options;
  server.registerTool(SYNTX_OWNER_GET_VEO_OMNI_T2V_SOURCE_TOOL_NAME, {
    title: "Get Veo Omni T2V source profile",
    description: "Returns the source-pinned static Veo Omni text/no-reference T2V contract. Runtime and dispatch remain disabled in this source report; defaults, price and backend acceptance are unknown. This read-only tool performs no account read or provider request.",
    inputSchema: z.object({}).strict(), outputSchema: ownerVeoOmniT2vSourceOutputSchema,
    annotations: { title: "Get Veo Omni T2V source profile", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (): Promise<CallToolResult> => {
    try {
      const output = ownerVeoOmniT2vSourceOutputSchema.parse(service.getParametersSource());
      if (output.identity.model_id !== "veo_omni" || output.identity.ai_name !== "veo3" ||
          output.identity.model_type !== "veo_omni" || output.identity.operation_id !== "generate-video" ||
          service.getReviewedContract().variant_id !== OWNER_VEO_OMNI_T2V_CONTRACT_VARIANT_ID) {
        throw new OwnerReviewedNoReferenceT2vServiceError("INVALID_REQUEST");
      }
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output as unknown as Record<string, unknown> };
    } catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_VEO_OMNI_T2V_TOOL_NAME, {
    title: "Generate one Veo Omni T2V video",
    description: "Runs one non-idempotent owner generation for the fixed veo_omni model and reviewed text/no-reference contract. Supply all controls explicitly: upscale 0–3, ratio 16:9 or 9:16, and duration 4, 6, 8 or 10 seconds. The server fixes text mode and empty file_urls. Caller model/type/mode/count, file URLs, references, wire fields and chat identifiers are rejected. The runtime service must separately verify an active paid subscription and, at both preflights, a fresh live finite quote and sufficient finite balance before dispatch. Unknown outcomes require GET-only reconciliation; never retry generation.",
    inputSchema: generationInputSchema, outputSchema,
    annotations: { title: "Generate one Veo Omni T2V video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const { link_attempt_id, ...fields } = input;
      return structuredSuccess(await service.generate({ ...fields, attemptId: link_attempt_id }, signal));
    } catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_VEO_OMNI_T2V_TOOL_NAME, {
    title: "Reconcile one Veo Omni video (GET only)",
    description: "GET-only reconciliation for the same linked owner attempt and opaque recovery id. It never dispatches or retries generation.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, recovery_id: recoveryIdSchema }).strict(), outputSchema,
    annotations: { title: "Reconcile one Veo Omni video (GET only)", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async ({ link_attempt_id, recovery_id }, { signal }): Promise<CallToolResult> => {
    try { return structuredSuccess(await service.reconcile({ attemptId: link_attempt_id, recovery_id }, signal), recovery_id); }
    catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_LIST_VEO_OMNI_T2V_RECOVERIES_TOOL_NAME, {
    title: "List Veo Omni T2V recoveries",
    description: "Lists up to 20 process-local recovery handles for one linked owner attempt. No account read, HTTP request or generation occurs.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, limit: z.number().int().min(1).max(20).default(20) }).strict(),
    outputSchema: recoveryListOutputSchema,
    annotations: { title: "List Veo Omni T2V recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ link_attempt_id, limit }): Promise<CallToolResult> => {
    try {
      const output = recoveryListOutputSchema.parse({ recoveries: service.listRecoveries(link_attempt_id, limit) });
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) { return safeError(error); }
  });
}

function structuredSuccess(value: unknown, recoveryId?: string): CallToolResult {
  try {
    const output = outputSchema.parse(value);
    if (output.variant_id !== OWNER_VEO_OMNI_T2V_CONTRACT_VARIANT_ID) {
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
        : "The reviewed Veo Omni T2V request could not be completed safely.",
      ...(error.code === "OUTCOME_UNKNOWN" && error.recovery_id !== undefined ? { recovery_id: error.recovery_id } : {}) } };
    return { isError: true, content: [{ type: "text", text: JSON.stringify(output) }] };
  }
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: {
    code: "VEO_OMNI_T2V_UNAVAILABLE", message: "The reviewed Veo Omni T2V request could not be completed safely." } }) }] };
}
