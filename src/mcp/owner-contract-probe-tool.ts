import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import type { OwnerContractMediaClient, OwnerContractMediaReadClient, OwnerContractMediaService } from "../application/owner-contract-media.js";
import { OwnerContractMediaError } from "../application/owner-contract-media.js";
import {
  getOwnerReviewedContractProbeBinding,
  getOwnerReviewedContractProbeContract,
  OwnerContractProbePolicyError,
  prepareOwnerReviewedContractProbe,
  type OwnerReviewedContractProbePolicy
} from "../application/owner-contract-probe-policy.js";
import type { ModelAccessResult } from "../application/model-access.js";
import type { SyntxSubscription } from "../adapter/syntx/account-decoder.js";
import { OwnerGenerationPreflightError } from "../application/owner-generation-preflight.js";

export const SYNTX_OWNER_CONTRACT_PROBE_TOOL_NAME = "syntx_owner_probe_reviewed_contract" as const;
export const SYNTX_OWNER_CONTRACT_PROBE_RECONCILE_TOOL_NAME = "syntx_owner_reconcile_reviewed_contract_probe" as const;

const attemptIdSchema = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const recoveryIdSchema = z.string().regex(/^recovery_[0-9a-f-]{36}$/u);
const artifactSchema = z.object({
  url: z.string().url(),
  mime_type: z.string().regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u),
  byte_size: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration_seconds: z.number().nonnegative().optional()
}).strict();
const outputSchema = z.object({
  model_id: z.string(),
  operation_id: z.enum(["generate-image", "generate-video"]),
  variant_id: z.string(),
  status: z.literal("reviewed"),
  confidence_scope: z.literal("exact_result_only"),
  artifacts: z.array(artifactSchema).max(16)
}).strict();

export interface RegisterSyntxOwnerContractProbeToolOptions {
  readonly policy: OwnerReviewedContractProbePolicy;
  readonly service: OwnerContractMediaService;
  readonly resolveSubscription: (attemptId: string, signal?: AbortSignal) => Promise<SyntxSubscription>;
  readonly resolveModelAccess: (attemptId: string, modelId: string, signal?: AbortSignal) => Promise<ModelAccessResult>;
  readonly resolveChatClient: (attemptId: string) => OwnerContractMediaClient;
}

/** This module is registered only by an explicit source/operator choice; the default server never wires it. */
export function registerSyntxOwnerContractProbeTool(server: McpServer, options: RegisterSyntxOwnerContractProbeToolOptions): void {
  const binding = getOwnerReviewedContractProbeBinding(options.policy);
  const contract = getOwnerReviewedContractProbeContract(options.policy);
  if (binding === null || contract === null) throw new Error("OWNER_CONTRACT_PROBE_POLICY_UNAVAILABLE");

  server.registerTool(SYNTX_OWNER_CONTRACT_PROBE_TOOL_NAME, {
    title: "Probe one reviewed owner media contract (one real spend)",
    description: "EXPERIMENTAL: dispatches at most one REAL, owner-authorized generation using one operator-fixed benign prompt and one exact reviewed-but-unverified model/variant/schema tuple. Fresh subscription and account model access are checked before chat creation. A successful artifact proves only this exact probe result; it does not mark the contract live_verified or update the registry. One-shot authorization expires and has no promised cost cap. Unknown outcomes must use the GET-only recovery tool; never call this probe again.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema }).strict(),
    outputSchema,
    annotations: { title: "Probe one reviewed owner media contract (one real spend)", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    if (input.link_attempt_id !== binding.attempt_id) return probeError("PROBE_UNAVAILABLE");
    try {
      const prepared = await prepareOwnerReviewedContractProbe(
        options.policy,
        input.link_attempt_id,
        options.resolveSubscription,
        options.resolveModelAccess,
        signal
      );
      const result = await options.service.generate({
        client: options.resolveChatClient(input.link_attempt_id),
        attemptId: input.link_attempt_id,
        contract,
        prepared,
        probePolicy: options.policy,
        ...(signal === undefined ? {} : { signal })
      });
      return safeProbeSuccess(result, binding);
    } catch (error) {
      return mapProbeError(error);
    }
  });

  server.registerTool(SYNTX_OWNER_CONTRACT_PROBE_RECONCILE_TOOL_NAME, {
    title: "Reconcile one reviewed owner contract probe (GET only)",
    description: "Read-only GET reconciliation for the exact attempt and recovery handle from one reviewed owner contract probe. This tool never checks subscription, creates a chat, posts, retries, or deletes. The probe permit can authorize only the original exact tuple and cannot authorize another dispatch.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, recovery_id: recoveryIdSchema }).strict(),
    outputSchema,
    annotations: { title: "Reconcile one reviewed owner contract probe (GET only)", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    if (input.link_attempt_id !== binding.attempt_id) return probeRecoveryError(input.recovery_id);
    try {
      const client = options.resolveChatClient(input.link_attempt_id);
      const readOnlyClient: OwnerContractMediaReadClient = Object.freeze({
        listInProgress: (chatUuid: string, requestSignal?: AbortSignal) => client.listInProgress(chatUuid, requestSignal),
        getMessage: (chatUuid: string, messageId: string, requestSignal?: AbortSignal) => client.getMessage(chatUuid, messageId, requestSignal),
        ...(client.listMessageCandidates === undefined ? {} : {
          listMessageCandidates: (chatUuid: string, echoId: string, requestSignal?: AbortSignal) =>
            client.listMessageCandidates!(chatUuid, echoId, requestSignal)
        })
      });
      const result = await options.service.reconcile({
        client: readOnlyClient,
        attemptId: input.link_attempt_id,
        recoveryId: input.recovery_id,
        contract,
        probePolicy: options.policy,
        ...(signal === undefined ? {} : { signal })
      });
      return safeProbeSuccess(result, binding);
    } catch {
      return probeRecoveryError(input.recovery_id);
    }
  });
}

function safeProbeSuccess(
  result: { readonly model_id: string; readonly operation_id: string; readonly artifacts: readonly unknown[] },
  binding: NonNullable<ReturnType<typeof getOwnerReviewedContractProbeBinding>>
): CallToolResult {
  try {
    const output = outputSchema.parse({
      model_id: result.model_id,
      operation_id: result.operation_id,
      variant_id: binding.variant_id,
      status: "reviewed",
      confidence_scope: "exact_result_only",
      artifacts: result.artifacts
    });
    return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
  } catch { return probeError("OUTCOME_UNKNOWN"); }
}

function mapProbeError(error: unknown): CallToolResult {
  if (error instanceof OwnerContractMediaError && error.code === "OUTCOME_UNKNOWN") {
    return probeError("OUTCOME_UNKNOWN", isRecoveryId(error.recoveryId) ? error.recoveryId : undefined);
  }
  if (error instanceof OwnerGenerationPreflightError) {
    return probeError(error.code);
  }
  if (error instanceof OwnerContractProbePolicyError) return probeError(error.code);
  if (error instanceof OwnerContractMediaError && error.code === "RECOVERY_NOT_FOUND") return probeError("PROBE_UNAVAILABLE");
  return probeError("PROBE_UNAVAILABLE");
}

function probeError(code: string, recoveryId?: string): CallToolResult {
  const messages: Record<string, string> = {
    MODEL_UNAVAILABLE: "The reviewed probe model is unavailable.",
    SUBSCRIPTION_REQUIRED: "An active paid subscription is required for this probe.",
    SUBSCRIPTION_STATUS_UNVERIFIED: "The current subscription could not be verified; the probe is unavailable.",
    PROBE_AUTHORIZATION_UNAVAILABLE: "The reviewed probe authorization is unavailable or expired.",
    PROBE_MODEL_ACCESS_UNAVAILABLE: "Current account model access could not be verified.",
    PROBE_CONTRACT_NOT_REVIEWED: "The exact reviewed contract tuple is unavailable.",
    PROBE_PREPARATION_FAILED: "The fixed reviewed probe request is unavailable.",
    OUTCOME_UNKNOWN: "The probe may have been dispatched; do not retry. Use GET-only reconciliation if a recovery id is available.",
    PROBE_UNAVAILABLE: "The reviewed probe is unavailable for this exact attempt."
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: {
      code,
      message: messages[code] ?? messages.PROBE_UNAVAILABLE,
      ...(recoveryId === undefined ? {} : { recovery_id: recoveryId })
    } }) }]
  };
}

function probeRecoveryError(recoveryId: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: {
      code: "OUTCOME_UNKNOWN",
      message: "The probe outcome remains unknown; do not retry generation.",
      recovery_id: recoveryId
    } }) }]
  };
}

function isRecoveryId(value: string | undefined): value is string {
  return typeof value === "string" && /^recovery_[0-9a-f-]{36}$/u.test(value);
}
