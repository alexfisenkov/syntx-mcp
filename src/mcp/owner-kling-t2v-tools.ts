import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { advertisedUnionInputSchema } from "./advertised-input-schema.js";
import { KLING_T2V_CURRENT_VARIANT, KLING_O1_T2V_CURRENT_VARIANT } from "../application/owner-kling-t2v-current-profile.js";
import {
  OWNER_KLING_T2V_CONTRACT_VARIANT_IDS,
  type OwnerKlingT2vModelId,
  type OwnerKlingT2vSourceContract
} from "../application/owner-kling-t2v-profile.js";
import {
  OwnerKlingT2vGenerationService,
  OwnerReviewedNoReferenceT2vServiceError,
  type OwnerKlingT2vGenerationInput
} from "../application/owner-reviewed-no-reference-t2v-service.js";

export const SYNTX_OWNER_GET_KLING_T2V_SOURCE_TOOL_NAME = "syntx_owner_get_kling_t2v_source" as const;
export const SYNTX_OWNER_GENERATE_KLING_T2V_TOOL_NAME = "syntx_owner_generate_kling_t2v" as const;
export const SYNTX_OWNER_RECONCILE_KLING_T2V_TOOL_NAME = "syntx_owner_reconcile_kling_t2v" as const;
export const SYNTX_OWNER_LIST_KLING_T2V_RECOVERIES_TOOL_NAME = "syntx_owner_list_kling_t2v_recoveries" as const;
export const SYNTX_OWNER_KLING_T2V_TOOL_NAMES = Object.freeze([
  SYNTX_OWNER_GET_KLING_T2V_SOURCE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_KLING_T2V_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_KLING_T2V_TOOL_NAME,
  SYNTX_OWNER_LIST_KLING_T2V_RECOVERIES_TOOL_NAME
] as const);

const modelIdSchema = z.enum(["kling_text2video", "kling_o1_text2video"]);
const attemptIdSchema = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const recoveryIdSchema = z.string().regex(/^recovery_[0-9a-f-]{36}$/u);
const artifactSchema = z.object({
  url: z.string().url(), mime_type: z.literal("video/mp4").optional(), byte_size: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), duration_seconds: z.number().nonnegative().optional()
}).strict();

const sourceRecordSchema = z.record(z.string(), z.unknown());
export const ownerKlingT2vSourceOutputSchema = z.object({
  status: z.literal("CURRENT_1791904852_SOURCE_JOIN_NO_REFERENCE_KLING_T2V"),
  source_pins: sourceRecordSchema,
  identity: z.object({ model_id: modelIdSchema, ai_name: z.literal("kling"), model_type: modelIdSchema, operation_id: z.literal("generate-video") }).strict(),
  controls: sourceRecordSchema,
  no_reference_source: sourceRecordSchema,
  wire_observation: sourceRecordSchema,
  cost_projection: sourceRecordSchema,
  defaults: z.literal("UNKNOWN"), runtime_usable: z.literal(false), dispatch_allowed: z.literal(false), backend_acceptance: z.literal("UNPROVEN"),
  current_controls: z.json().optional()
}).strict() as unknown as z.ZodType<OwnerKlingT2vSourceContract>;

const variantIdSchema = z.enum([
  OWNER_KLING_T2V_CONTRACT_VARIANT_IDS.kling_text2video,
  OWNER_KLING_T2V_CONTRACT_VARIANT_IDS.kling_o1_text2video,
  KLING_T2V_CURRENT_VARIANT, KLING_O1_T2V_CURRENT_VARIANT
]);
const ownerKlingT2vOutputSchema = z.object({ status: z.literal("reviewed"), confidence_scope: z.literal("exact_result_only"),
  model_id: modelIdSchema, operation_id: z.literal("generate-video"), modality: z.literal("video"),
  variant_id: variantIdSchema, artifacts: z.array(artifactSchema).max(16) }).strict();

const recoveryItemSchema = z.object({ recovery_id: recoveryIdSchema, model_id: modelIdSchema, operation_id: z.literal("generate-video"),
  variant_id: variantIdSchema, created_at: z.iso.datetime() }).strict();
const recoveryListOutputSchema = z.object({ recoveries: z.array(recoveryItemSchema).max(20) }).strict();

const baseVersionSchema = z.enum(["1.5", "1.6", "2.1-master", "2.5-turbo", "2.6", "3.0", "3.0-turbo"]);
const baseGenerationSchema = z.object({
  link_attempt_id: attemptIdSchema,
  model_id: z.literal("kling_text2video"),
  prompt: z.string().min(1).max(5_000),
  version: baseVersionSchema,
  mode: z.enum(["standart", "hd"]),
  aspect_ratio: z.enum(["16:9", "1:1", "9:16"]),
  video_duration: z.number().finite().min(3).max(15),
  native_audio: z.boolean()
}).strict().superRefine((input, context) => {
  const standardVersion = ["1.5", "1.6", "2.1-master", "2.5-turbo", "2.6"].includes(input.version);
  if (input.version === "2.1-master" && input.mode !== "hd") {
    context.addIssue({ code: "custom", path: ["mode"], message: "Kling 2.1 Master supports hd mode only." });
  }
  if (standardVersion && input.video_duration !== 5 && input.video_duration !== 10) {
    context.addIssue({ code: "custom", path: ["video_duration"], message: "This Kling version supports 5 or 10 seconds." });
  }
  if (input.native_audio && input.version !== "2.6" && input.version !== "3.0") {
    context.addIssue({ code: "custom", path: ["native_audio"], message: "Native audio is source-listed only for Kling 2.6 and 3.0." });
  }
});
const o1GenerationSchema = z.object({
  link_attempt_id: attemptIdSchema,
  model_id: z.literal("kling_o1_text2video"),
  prompt: z.string().min(1).max(5_000),
  mode: z.literal("hd"),
  aspect_ratio: z.enum(["16:9", "1:1", "9:16"]),
  video_duration: z.number().finite().min(3).max(10)
}).strict();
const currentGenerationSchema = z.object({ ...baseGenerationSchema.shape,
  version: z.enum(["2.5", "2.6", "3.0"]), mode: z.enum(["standart", "hd", "4K"]),
  video_duration: z.number().finite().min(3).max(15), temperature: z.number().finite().min(0).max(1).optional(), multi_shots: z.boolean().optional()
}).strict().superRefine((input, context) => {
  const { temperature, multi_shots, ...legacyFields } = input;
  const basic = baseGenerationSchema.safeParse({ ...legacyFields, version: input.version === "2.5" ? "2.5-turbo" : input.version, mode: input.mode === "4K" ? "hd" : input.mode });
  if (!basic.success) for (const issue of basic.error.issues) context.addIssue({ ...issue });
  if (input.version === "2.6" && input.native_audio && input.mode !== "hd") context.addIssue({ code: "custom", path: ["mode"], message: "Current2.6 native audio requires hd mode." });
  if (input.mode === "4K" && input.version !== "3.0") context.addIssue({ code: "custom", path: ["mode"], message: "4K is source-enabled only for Kling 3.0." });
  if (input.version === "3.0" ? typeof multi_shots !== "boolean" || Object.hasOwn(input, "temperature") :
      typeof temperature !== "number" || Object.hasOwn(input, "multi_shots")) context.addIssue({ code: "custom", message: "Supply the applicable current control explicitly and omit the inactive control." });
});
const generationInputSchema = z.union([baseGenerationSchema, o1GenerationSchema, currentGenerationSchema]);
const advertisedGenerationInput = advertisedUnionInputSchema(generationInputSchema, [
  { if: { properties: { model_id: { const: "kling_text2video" }, version: { enum: ["1.5", "1.6", "2.1-master", "2.5-turbo", "2.5", "2.6"] } }, required: ["model_id", "version"] },
    then: { properties: { video_duration: { enum: [5, 10] } } } },
  { if: { properties: { model_id: { const: "kling_text2video" }, version: { const: "2.1-master" } }, required: ["model_id", "version"] },
    then: { properties: { mode: { const: "hd" } } } },
  { if: { properties: { model_id: { const: "kling_text2video" }, native_audio: { const: true } }, required: ["model_id", "native_audio"] },
    then: { properties: { version: { enum: ["2.6", "3.0"] } } } },
  { if: { properties: { mode: { const: "4K" } }, required: ["mode"] }, then: {
    properties: { model_id: { const: "kling_text2video" }, version: { const: "3.0" } }, required: ["multi_shots"] } },
  { if: { required: ["multi_shots"] }, then: { properties: { model_id: { const: "kling_text2video" }, version: { const: "3.0" },
    video_duration: { minimum: 3, maximum: 15 } }, not: { required: ["temperature"] } } },
  { if: { required: ["temperature"] }, then: { properties: { model_id: { const: "kling_text2video" },
    version: { enum: ["2.5", "2.6"] } }, not: { required: ["multi_shots"] } } },
  { if: { required: ["temperature", "version", "native_audio"], properties: { version: { const: "2.6" }, native_audio: { const: true } } },
    then: { properties: { mode: { const: "hd" } } } }
]);

export interface RegisterSyntxOwnerKlingT2vToolsOptions {
  readonly service: Pick<OwnerKlingT2vGenerationService, "getParametersSource" | "generate" | "reconcile" | "listRecoveries">;
}

/** Registers the four source-pinned Kling T2V family tools. */
export function registerSyntxOwnerKlingT2vTools(server: McpServer, options: RegisterSyntxOwnerKlingT2vToolsOptions): void {
  const service = options.service;
  server.registerTool(SYNTX_OWNER_GET_KLING_T2V_SOURCE_TOOL_NAME, {
    title: "Get Kling T2V source profile",
    description: "Returns current source evidence for one exact Kling model: base Kling T2V or Kling O1 T2V. Effective defaults, provider acceptance, and price are unknown. This does not read account state or generate media.",
    inputSchema: z.object({ model_id: modelIdSchema }).strict(), outputSchema: ownerKlingT2vSourceOutputSchema,
    annotations: { title: "Get Kling T2V source profile", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ model_id }): Promise<CallToolResult> => {
    try {
      const output = ownerKlingT2vSourceOutputSchema.parse(service.getParametersSource(model_id as OwnerKlingT2vModelId));
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output as unknown as Record<string, unknown> };
    } catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_GENERATE_KLING_T2V_TOOL_NAME, {
    title: "Generate one Kling T2V video",
    description: "Runs one non-idempotent owner generation. Base Kling requires version, mode, ratio, duration and native_audio. Current explicit controls: temperature 0..1 for current 2.5/2.6, or multi_shots for 3.0; current 3.0 also allows 4K; 3.0/3.0-turbo allow finite manual 3..15 seconds. Omit the inactive control. Current O1 accepts hd mode, ratio and finite manual 3..10 seconds and rejects version/audio/current controls. Legacy tuples remain accepted. Current controls are form-source reviewed, not observed-provider proof. No references, URLs or raw payload are accepted. Unknown outcomes require GET-only reconciliation; never retry generation.",
    inputSchema: advertisedGenerationInput, outputSchema: ownerKlingT2vOutputSchema,
    annotations: { title: "Generate one Kling T2V video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const { link_attempt_id, ...sourceFields } = input;
      const request = { ...sourceFields, attemptId: link_attempt_id } as OwnerKlingT2vGenerationInput;
      return structuredSuccess(await service.generate(request, signal));
    } catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_KLING_T2V_TOOL_NAME, {
    title: "Reconcile one Kling video (GET only)",
    description: "GET-only reconciliation for the same linked owner attempt, model id, and opaque recovery id. It does not dispatch or retry generation.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, model_id: modelIdSchema, recovery_id: recoveryIdSchema }).strict(),
    outputSchema: ownerKlingT2vOutputSchema,
    annotations: { title: "Reconcile one Kling video (GET only)", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async ({ link_attempt_id, model_id, recovery_id }, { signal }): Promise<CallToolResult> => {
    try { return structuredSuccess(await service.reconcile({ attemptId: link_attempt_id, model_id, recovery_id }, signal), recovery_id); }
    catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_LIST_KLING_T2V_RECOVERIES_TOOL_NAME, {
    title: "List Kling T2V recoveries",
    description: "Lists up to 20 process-local recovery handles for the linked owner attempt across the two exact Kling T2V models. No authentication, account read, HTTP request, or generation occurs.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, limit: z.number().int().min(1).max(20).default(20) }).strict(),
    outputSchema: recoveryListOutputSchema,
    annotations: { title: "List Kling T2V recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ link_attempt_id, limit }): Promise<CallToolResult> => {
    try {
      const output = recoveryListOutputSchema.parse({ recoveries: service.listRecoveries(link_attempt_id, limit) });
      if (output.recoveries.some((item) => !validVariant(item.model_id, item.variant_id))) {
        throw new OwnerReviewedNoReferenceT2vServiceError("INVALID_REQUEST");
      }
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) { return safeError(error); }
  });
}

function structuredSuccess(value: unknown, recoveryId?: string): CallToolResult {
  try {
    const output = ownerKlingT2vOutputSchema.parse(value);
    if (!validVariant(output.model_id, output.variant_id)) {
      throw new OwnerReviewedNoReferenceT2vServiceError("OUTCOME_UNKNOWN", recoveryId);
    }
    return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output,
      ...(recoveryId === undefined ? {} : { _meta: { recovery_id: recoveryId } }) };
  } catch { return safeError(new OwnerReviewedNoReferenceT2vServiceError("OUTCOME_UNKNOWN", recoveryId)); }
}

function validVariant(modelId: keyof typeof OWNER_KLING_T2V_CONTRACT_VARIANT_IDS, variantId: string): boolean {
  return variantId === OWNER_KLING_T2V_CONTRACT_VARIANT_IDS[modelId] ||
    (modelId === "kling_text2video" && variantId === KLING_T2V_CURRENT_VARIANT) ||
    (modelId === "kling_o1_text2video" && variantId === KLING_O1_T2V_CURRENT_VARIANT);
}

function safeError(error: unknown): CallToolResult {
  if (error instanceof OwnerReviewedNoReferenceT2vServiceError) {
    const output = { error: { code: error.code,
      message: error.code === "OUTCOME_UNKNOWN" ? "The request may have been dispatched; do not retry. Use GET-only reconciliation with the same recovery id."
        : "The reviewed Kling T2V request could not be completed safely.",
      ...(error.code === "OUTCOME_UNKNOWN" && error.recovery_id !== undefined ? { recovery_id: error.recovery_id } : {}) } };
    return { isError: true, content: [{ type: "text", text: JSON.stringify(output) }] };
  }
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: {
    code: "KLING_T2V_UNAVAILABLE", message: "The reviewed Kling T2V request could not be completed safely." } }) }] };
}
