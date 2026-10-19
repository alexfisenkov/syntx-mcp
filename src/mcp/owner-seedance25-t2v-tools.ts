import { types } from "node:util";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  OwnerReviewedNoReferenceT2vServiceError,
  type OwnerReviewedNoReferenceT2vGenerationOutput,
  type OwnerSeedance25T2vGenerationService
} from "../application/owner-reviewed-no-reference-t2v-service.js";
import { OWNER_SEEDANCE25_T2V_CONTRACT_VARIANT_ID, type OwnerSeedance25T2vSourceContract } from "../application/owner-seedance25-t2v-profile.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY = /^recovery_[0-9a-f-]{36}$/u;
const PROMPT_MAX = 5_000;
const ERROR_CODES = new Set(["INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "REQUEST_ABORTED", "CAPACITY_EXCEEDED",
  "CLOCK_INVALID", "PRINCIPAL_NOT_LINKED", "VALIDATION_REJECTED", "MODEL_BINDING_MISMATCH", "PREFLIGHT_FAILED",
  "SUBSCRIPTION_REQUIRED", "MODEL_ACCESS_UNAVAILABLE", "INTENT_ALREADY_USED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND",
  "RESULT_PENDING", "RESULT_UNVERIFIED", "RESULT_CHANGED"]);

export const OWNER_SEEDANCE25_T2V_TOOL_NAMES = Object.freeze([
  "syntx_owner_get_seedance25_t2v_source",
  "syntx_owner_generate_seedance25_t2v_video",
  "syntx_owner_get_seedance25_t2v_result",
  "syntx_owner_list_seedance25_t2v_recoveries"
] as const);

export interface RegisterSyntxOwnerSeedance25T2vToolsOptions {
  readonly service: Pick<OwnerSeedance25T2vGenerationService, "getParametersSource" | "generate" | "reconcile" | "listRecoveries">;
}

const attemptId = z.string().regex(ATTEMPT), recoveryId = z.string().regex(RECOVERY);
const sourceOutput = z.object({
  status: z.literal("CURRENT_1792363638_FORM_AND_PUBLIC_ROW_SOURCE_CONTRACT_PROVIDER_UNPROVEN"),
  source_pins: z.record(z.string(), z.unknown()), identity: z.record(z.string(), z.unknown()), controls: z.record(z.string(), z.unknown()),
  form_validation: z.record(z.string(), z.unknown()), wire_observation: z.record(z.string(), z.unknown()),
  cost_projection: z.record(z.string(), z.unknown()), public_bounds: z.record(z.string(), z.unknown()),
  defaults: z.literal("FORM_INITIALIZER_CANDIDATE_NOT_EFFECTIVE_DEFAULT_PROOF"), backend_acceptance: z.literal("UNPROVEN")
}).strict() as unknown as z.ZodType<OwnerSeedance25T2vSourceContract>;
const artifact = z.object({ url: z.string().url().max(4_096), mime_type: z.enum(["video/mp4", "video/quicktime"]).optional(),
  byte_size: z.number().int().nonnegative().optional(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional(),
  duration_seconds: z.number().nonnegative().optional() }).strict();
const generationOutput = z.object({ status: z.literal("reviewed"), confidence_scope: z.literal("exact_result_only"),
  model_id: z.literal("seedance-2.5"), operation_id: z.literal("generate-video"), modality: z.literal("video"),
  variant_id: z.literal(OWNER_SEEDANCE25_T2V_CONTRACT_VARIANT_ID), artifacts: z.array(artifact).max(16) }).strict();
const recoveryList = z.object({ recoveries: z.array(z.object({ recovery_id: recoveryId, model_id: z.literal("seedance-2.5"),
  operation_id: z.literal("generate-video"), variant_id: z.literal(OWNER_SEEDANCE25_T2V_CONTRACT_VARIANT_ID),
  created_at: z.iso.datetime() }).strict()).max(20) }).strict();

export function registerSyntxOwnerSeedance25T2vTools(server: McpServer, optionsInput: RegisterSyntxOwnerSeedance25T2vToolsOptions | unknown): void {
  const options = snapshotOptions(optionsInput), service = options.service;
  server.registerTool(OWNER_SEEDANCE25_T2V_TOOL_NAMES[0], { title: "Get Seedance 2.5 T2V source profile",
    description: "Returns the explicit source-bounded Seedance 2.5 omni-references T2V model-switch candidate and public cost-parameter mapping. This is not a claim of the full post-watcher UI state or no-media validation; backend/provider acceptance and a quote amount remain unproven.",
    inputSchema: z.object({}).strict(), outputSchema: sourceOutput,
    annotations: { title: "Get Seedance 2.5 T2V source profile", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (): Promise<CallToolResult> => {
    try { const value = sourceOutput.parse(service.getParametersSource());
      return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value as unknown as Record<string, unknown> };
    } catch (error) { return safeError(error); }
  });

  const generateInput = z.object({ link_attempt_id: attemptId, prompt: z.string().min(1).max(PROMPT_MAX),
    resolution: z.literal("720p"), aspect_ratio: z.literal("16:9"), video_duration: z.literal(5), generate_audio: z.literal(true) }).strict();
  server.registerTool(OWNER_SEEDANCE25_T2V_TOOL_NAMES[1], { title: "Generate one Seedance 2.5 omni-references T2V video",
    description: "Runs one owner Seedance 2.5 text-to-video candidate using the model-watcher omni-references mode with 720p, 16:9, 5 seconds, audio on, and no files. The mode is fixed internally; callers cannot select it. This explicit tuple is not a claim of the full post-watcher UI state or confirmed no-media validation. No uploads or caller file URLs are accepted. A local 5,000 UTF-16 prompt bound is not a provider limit. Price amount and backend/provider acceptance remain unproven; do not retry an uncertain GEN.",
    inputSchema: generateInput, outputSchema: generationOutput,
    annotations: { title: "Generate Seedance 2.5 omni-references T2V", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try { const data = generateInput.parse(snapshotInput(input));
      const value = await service.generate({ attemptId: data.link_attempt_id, prompt: data.prompt, resolution: data.resolution,
        aspect_ratio: data.aspect_ratio, video_duration: data.video_duration, generate_audio: data.generate_audio }, signal);
      return structuredSuccess(value);
    } catch (error) { return safeError(error); }
  });

  const resultInput = z.object({ link_attempt_id: attemptId, recovery_id: recoveryId }).strict();
  server.registerTool(OWNER_SEEDANCE25_T2V_TOOL_NAMES[2], { title: "Reconcile one Seedance 2.5 T2V result",
    description: "Uses GET-only owner-history/result recovery for one existing Seedance 2.5 operation. It never retries upload or generation.",
    inputSchema: resultInput, outputSchema: generationOutput,
    annotations: { title: "Reconcile Seedance 2.5 T2V result", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try { const data = resultInput.parse(snapshotInput(input));
      const value = await service.reconcile({ attemptId: data.link_attempt_id, recovery_id: data.recovery_id }, signal);
      return structuredSuccess(value);
    } catch (error) { return safeError(error); }
  });

  server.registerTool(OWNER_SEEDANCE25_T2V_TOOL_NAMES[3], { title: "List Seedance 2.5 T2V recoveries",
    description: "Lists bounded process-local Seedance 2.5 recovery ids without network, account reads, upload, or generation.",
    inputSchema: z.object({ link_attempt_id: attemptId, limit: z.number().int().min(1).max(20).default(20) }).strict(), outputSchema: recoveryList,
    annotations: { title: "List Seedance 2.5 T2V recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async input => {
    try { const data = snapshotInput(input) as { link_attempt_id: string; limit: number };
      const value = recoveryList.parse({ recoveries: service.listRecoveries(data.link_attempt_id, data.limit) });
      return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value as unknown as Record<string, unknown> };
    } catch (error) { return safeError(error); }
  });
}

function snapshotOptions(value: unknown): RegisterSyntxOwnerSeedance25T2vToolsOptions {
  const row = snapshotInput(value);
  if (!row || typeof row !== "object" || Object.keys(row).length !== 1 || !Object.hasOwn(row, "service")) throw new Error("INVALID_OWNER_SEEDANCE25_T2V_TOOL_OPTIONS");
  const service = (row as Record<string, unknown>).service;
  if (!service || typeof service !== "object" || types.isProxy(service) || typeof Reflect.get(service, "generate") !== "function" ||
      typeof Reflect.get(service, "reconcile") !== "function" || typeof Reflect.get(service, "listRecoveries") !== "function" ||
      typeof Reflect.get(service, "getParametersSource") !== "function") throw new Error("INVALID_OWNER_SEEDANCE25_T2V_TOOL_OPTIONS");
  return Object.freeze({ service: service as RegisterSyntxOwnerSeedance25T2vToolsOptions["service"] });
}
function snapshotInput(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return undefined;
  try { const proto = Object.getPrototypeOf(value); if (proto !== Object.prototype && proto !== null) return undefined;
    const d = Object.getOwnPropertyDescriptors(value), result = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(d)) { if (typeof key !== "string" || !Object.hasOwn(d[key]!, "value") || d[key]!.enumerable !== true) return undefined; result[key] = d[key]!.value; }
    return result;
  } catch { return undefined; }
}
function structuredSuccess(value: OwnerReviewedNoReferenceT2vGenerationOutput): CallToolResult {
  const parsed = generationOutput.safeParse(value);
  return parsed.success ? { content: [{ type: "text", text: JSON.stringify(parsed.data) }], structuredContent: parsed.data as unknown as Record<string, unknown> }
    : safeError(new OwnerReviewedNoReferenceT2vServiceError("OUTCOME_UNKNOWN"));
}
function safeError(error: unknown): CallToolResult {
  const code = error instanceof OwnerReviewedNoReferenceT2vServiceError && ERROR_CODES.has(error.code) ? error.code : "SEEDANCE25_T2V_UNAVAILABLE";
  const recovery = code === "OUTCOME_UNKNOWN" && error instanceof OwnerReviewedNoReferenceT2vServiceError &&
    typeof error.recovery_id === "string" && RECOVERY.test(error.recovery_id) ? { recovery_id: error.recovery_id } : {};
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, ...recovery,
    message: code === "OUTCOME_UNKNOWN" ? "The generation may have been dispatched; do not retry. Use GET-only reconciliation."
      : "The Seedance 2.5 T2V operation could not be completed safely." } }) }] };
}
