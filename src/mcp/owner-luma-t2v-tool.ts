import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import {
  OWNER_LUMA_T2V_CONTRACT_VARIANT_ID,
  OwnerLumaT2vContractService,
  OwnerLumaT2vContractServiceError,
  type OwnerLumaT2vGenerationInput
} from "../application/owner-luma-t2v-contract-service.js";

export const SYNTX_OWNER_LUMA_T2V_GENERATE_TOOL_NAME = "syntx_owner_generate_luma_t2v" as const;
export const SYNTX_OWNER_LUMA_T2V_RECONCILE_TOOL_NAME = "syntx_owner_reconcile_luma_t2v" as const;
export const SYNTX_OWNER_LUMA_T2V_LIST_RECOVERIES_TOOL_NAME = "syntx_owner_list_luma_t2v_recoveries" as const;

const attemptIdSchema = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const recoveryIdSchema = z.string().regex(/^recovery_[0-9a-f-]{36}$/u);
const artifactSchema = z.object({
  url: z.string().url(),
  mime_type: z.literal("video/mp4"),
  byte_size: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration_seconds: z.number().nonnegative().optional()
}).strict();

export const ownerLumaT2vOutputSchema = z.object({
  status: z.literal("reviewed"),
  confidence_scope: z.literal("exact_result_only"),
  model_id: z.literal("ray-3.14"),
  operation_id: z.literal("generate-video"),
  modality: z.literal("video"),
  variant_id: z.literal(OWNER_LUMA_T2V_CONTRACT_VARIANT_ID),
  artifacts: z.array(artifactSchema).max(16)
}).strict();

const recoveryListOutputSchema = z.object({
  recoveries: z.array(z.object({
    recovery_id: recoveryIdSchema,
    model_id: z.literal("ray-3.14"),
    operation_id: z.literal("generate-video"),
    variant_id: z.literal(OWNER_LUMA_T2V_CONTRACT_VARIANT_ID),
    created_at: z.iso.datetime()
  }).strict()).max(20)
}).strict();

export interface RegisterSyntxOwnerLumaT2vToolsOptions {
  readonly service: Pick<OwnerLumaT2vContractService,
    "getParametersSource" | "generate" | "reconcile" | "listRecoveries">;
}

/** Registers one default-off owner-only Luma call path; every call is a real, non-idempotent generation. */
export function registerSyntxOwnerLumaT2vTools(
  server: McpServer,
  options: RegisterSyntxOwnerLumaT2vToolsOptions
): void {
  const service = options.service;
  server.registerTool(SYNTX_OWNER_LUMA_T2V_GENERATE_TOOL_NAME, {
    title: "Generate one owner Luma Ray 3.14 video",
    description: "One real, non-idempotent owner Luma Ray 3.14 text-to-video dispatch. Supply prompt and all three explicit controls. The source-reviewed 48-choice contract remains reviewed; a successful result proves only this exact call. Each accepted call may spend account balance; no price quote or billing cap is claimed. Unknown outcomes must use GET-only reconciliation; never submit the same intent again.",
    inputSchema: z.object({
      link_attempt_id: attemptIdSchema,
      prompt: z.string().min(1).max(5_000),
      quality: z.enum(["360p", "540p", "720p", "1080p"]),
      aspect_ratio: z.enum(["9:16", "3:4", "1:1", "4:3", "16:9", "21:9"]),
      video_duration: z.union([z.literal(5), z.literal(10)])
    }).strict(),
    outputSchema: ownerLumaT2vOutputSchema,
    annotations: { title: "Generate one owner Luma Ray 3.14 video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const request: OwnerLumaT2vGenerationInput = {
        attemptId: input.link_attempt_id,
        prompt: input.prompt,
        quality: input.quality,
        aspect_ratio: input.aspect_ratio,
        video_duration: input.video_duration
      };
      return safeSuccess(await service.generate(request, signal));
    } catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_LUMA_T2V_RECONCILE_TOOL_NAME, {
    title: "Reconcile one owner Luma video (GET only)",
    description: "GET-only reconciliation for the exact linked attempt and opaque Luma recovery id. It does not create a chat, check subscription/model access, dispatch, retry, cancel, or delete. A completed result proves only the original call and does not promote the 48-choice contract to live_verified.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, recovery_id: recoveryIdSchema }).strict(),
    outputSchema: ownerLumaT2vOutputSchema,
    annotations: { title: "Reconcile one owner Luma video (GET only)", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      return safeSuccess(await service.reconcile({ attemptId: input.link_attempt_id, recovery_id: input.recovery_id }, signal), input.recovery_id);
    } catch (error) { return safeError(error); }
  });

  server.registerTool(SYNTX_OWNER_LUMA_T2V_LIST_RECOVERIES_TOOL_NAME, {
    title: "List owner Luma video recoveries",
    description: "Lists bounded process-local recovery ids for the exact attempt. It performs no authentication, account read, HTTP request, or generation. Unknown dispatched intents remain held until observed, invalidated, or service close; they are not evicted to make room.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, limit: z.number().int().min(1).max(20).default(20) }).strict(),
    outputSchema: recoveryListOutputSchema,
    annotations: { title: "List owner Luma video recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input): Promise<CallToolResult> => {
    try {
      const recoveries = recoveryListOutputSchema.parse({ recoveries: service.listRecoveries(input.link_attempt_id, input.limit) });
      return { content: [{ type: "text", text: JSON.stringify(recoveries) }], structuredContent: recoveries };
    } catch (error) { return safeError(error); }
  });
}

function safeSuccess(value: unknown, recoveryId?: string): CallToolResult {
  try {
    const output = ownerLumaT2vOutputSchema.parse(value);
    return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output,
      ...(recoveryId === undefined ? {} : { _meta: { recovery_id: recoveryId } }) };
  } catch { return safeError(new OwnerLumaT2vContractServiceError("OUTCOME_UNKNOWN", recoveryId)); }
}

function safeError(error: unknown): CallToolResult {
  if (error instanceof OwnerLumaT2vContractServiceError) {
    const output = { error: {
      code: error.code,
      message: error.code === "OUTCOME_UNKNOWN"
        ? "The video may have been dispatched; do not retry. Use GET-only reconciliation with the same recovery id."
        : "The owner Luma request could not be completed safely.",
      ...(error.code === "OUTCOME_UNKNOWN" && error.recovery_id !== undefined ? { recovery_id: error.recovery_id } : {})
    } };
    return { isError: true, content: [{ type: "text", text: JSON.stringify(output) }] };
  }
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: {
    code: "LUMA_T2V_UNAVAILABLE", message: "The owner Luma request could not be completed safely."
  } }) }] };
}
