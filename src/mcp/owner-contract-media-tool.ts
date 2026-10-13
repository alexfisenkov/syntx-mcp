import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { GenerationContractExecutor, GenerationContractExecutionError } from "../adapter/syntx/generation-contract-executor.js";
import { GenerationContractExecutorV2, GenerationContractExecutionErrorV2, type GenerationContractV2Request } from "../adapter/syntx/generation-contract-executor-v2.js";
import type { OwnerContractMediaClient, OwnerContractMediaContractContext, OwnerContractMediaReadClient, OwnerContractMediaService } from "../application/owner-contract-media.js";
import { OwnerContractMediaError } from "../application/owner-contract-media.js";
import { OwnerGenerationPreflightError } from "../application/owner-generation-preflight.js";
import { GenerationContractValidationError } from "../application/generation-contract-validator.js";
import type { GenerationRequest } from "../domain/types.js";
import type { GenerationContractRegistry } from "../domain/generation-contract.js";
import type { GenerationContractRegistryV2 } from "../domain/generation-contract-v2.js";
import type { PreparedSyntxMediaRequest } from "../adapter/syntx/upstream-adapter.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";

export const SYNTX_OWNER_GENERATE_MEDIA_TOOL_NAME = "syntx_owner_generate_media" as const;
export const SYNTX_OWNER_RECONCILE_MEDIA_TOOL_NAME = "syntx_owner_reconcile_media" as const;

const attemptIdSchema = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const modelIdSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const operationIdSchema = z.enum(["generate-image", "generate-video"]);
const mimeSchema = z.string().regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u);
const artifactSchema = z.object({
  url: z.string().url(),
  mime_type: mimeSchema,
  byte_size: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration_seconds: z.number().nonnegative().optional()
}).strict();

export const ownerContractMediaOutputSchema = z.object({
  model_id: modelIdSchema,
  operation_id: operationIdSchema,
  variant_id: z.string().min(1).max(160).optional(),
  modality: z.enum(["image", "video"]),
  artifacts: z.array(artifactSchema).max(16)
}).strict();

const ownerContractMediaRecoveryListOutputSchema = z.object({
  recoveries: z.array(z.object({
    recovery_id: z.string().regex(/^recovery_[0-9a-f-]{36}$/u),
    model_id: modelIdSchema,
    operation_id: operationIdSchema,
    created_at: z.iso.datetime(),
    variant_id: modelIdSchema.optional()
  }).strict()).max(20)
}).strict();

export interface RegisterSyntxOwnerContractMediaToolsOptions {
  readonly registry: GenerationContractRegistry | GenerationContractRegistryV2;
  readonly executor: GenerationContractExecutor | GenerationContractExecutorV2;
  readonly service: OwnerContractMediaService;
  readonly prepareGeneration: (
    attemptId: string,
    request: GenerationRequest & Pick<GenerationContractV2Request, "variant_id">,
    signal?: AbortSignal
  ) => Promise<PreparedSyntxMediaRequest>;
  readonly resolveChatClient: (attemptId: string) => OwnerContractMediaClient;
}

export function registerSyntxOwnerContractMediaTools(
  server: McpServer,
  options: RegisterSyntxOwnerContractMediaToolsOptions
): void {
  const { executor, registry } = options;
  server.registerTool(SYNTX_OWNER_GENERATE_MEDIA_TOOL_NAME, {
    title: "Generate owner media (real spend)",
    description: "One REAL, owner-authorized image or video dispatch using an exact live_verified contract from the trusted registry. This is not idempotent: calling again starts a new generation. Parameters must not contain external references; copies are fixed at one. Outcomes may remain unknown; an opaque recovery handle is process-local for 15 minutes and does not survive restart. No cost cap or separate confirmation is claimed.",
    inputSchema: z.object({
      link_attempt_id: attemptIdSchema,
      model_id: modelIdSchema,
      operation_id: operationIdSchema,
      variant_id: z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u).optional(),
      parameters: z.record(z.string(), z.unknown())
    }).strict(),
    outputSchema: ownerContractMediaOutputSchema,
    annotations: { title: "Generate owner media (real spend)", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const contract = liveMediaContract(executor, input.model_id, input.operation_id, input.variant_id);
      const request: GenerationRequest & Pick<GenerationContractV2Request, "variant_id"> = {
        model_id: input.model_id,
        operation_id: input.operation_id,
        catalog_version: registry.catalog_version,
        parameters: input.parameters,
        ...(input.variant_id === undefined ? {} : { variant_id: input.variant_id })
      };
      const prepared = await options.prepareGeneration(input.link_attempt_id, request, signal);
      const client = options.resolveChatClient(input.link_attempt_id);
      const result = await options.service.generate({
        client,
        attemptId: input.link_attempt_id,
        contract,
        prepared,
        ...(signal === undefined ? {} : { signal })
      });
      return safeStructuredCall({ ...result, ...(contract.variant_id === undefined ? {} : { variant_id: contract.variant_id }) }, ownerContractMediaOutputSchema);
    } catch (error) {
      return ownerContractMediaErrorResult(error);
    }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_MEDIA_TOOL_NAME, {
    title: "Reconcile owner media with read-only requests",
    description: "GET-only reconciliation for one opaque, process-local recovery id and its exact linked attempt/model/operation. Handles expire after 15 minutes and are not restart-safe. It does not read subscription status, create a chat, retry generation, cancel, or delete.",
    inputSchema: z.object({
      link_attempt_id: attemptIdSchema,
      model_id: modelIdSchema,
      operation_id: operationIdSchema,
      variant_id: z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u).optional(),
      recovery_id: z.string().regex(/^recovery_[0-9a-f-]{36}$/u)
    }).strict(),
    outputSchema: ownerContractMediaOutputSchema,
    annotations: { title: "Reconcile owner media with read-only requests", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    try {
      const contract = liveMediaContract(executor, input.model_id, input.operation_id, input.variant_id);
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
        ...(signal === undefined ? {} : { signal })
      });
      return safeStructuredCall({ ...result, ...(contract.variant_id === undefined ? {} : { variant_id: contract.variant_id }) }, ownerContractMediaOutputSchema, input.recovery_id);
    } catch (error) {
      return ownerContractMediaErrorResult(error);
    }
  });

  server.registerTool("syntx_owner_list_media_recovery", {
    title: "List owner media recovery handles",
    description: "List up to 20 recent opaque recovery handles for the exact linked attempt from this process's bounded local memory. Read-only and local-only: no authentication, subscription check, chat-client resolution, HTTP request, or media dispatch. Records expire after 15 minutes and are not restart-safe. Only handle, model, operation, creation time, and optional V2 variant id are returned.",
    inputSchema: z.object({
      link_attempt_id: attemptIdSchema,
      limit: z.number().int().min(1).max(20).default(20)
    }).strict(),
    outputSchema: ownerContractMediaRecoveryListOutputSchema,
    annotations: { title: "List owner media recovery handles", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input): Promise<CallToolResult> => {
    try {
      const recoveries = options.service.listRecoveries(input.link_attempt_id, input.limit);
      const output = ownerContractMediaRecoveryListOutputSchema.parse({ recoveries });
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
    } catch {
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ error: { code: "RECOVERY_LIST_UNAVAILABLE", message: "Local owner media recovery handles are unavailable." } }) }]
      };
    }
  });
}

function liveMediaContract(
  executor: GenerationContractExecutor | GenerationContractExecutorV2,
  modelId: string,
  operationId: "generate-image" | "generate-video",
  variantId?: string
): OwnerContractMediaContractContext & { readonly variant_id?: string } {
  const contract = executor instanceof GenerationContractExecutorV2
    ? executor.getContract(modelId, operationId, variantId)
    : variantId === undefined ? executor.getContract(modelId, operationId) : null;
  if (contract === null || contract.status !== "live_verified" ||
      (contract.modality !== "image" && contract.modality !== "video")) {
    throw new OwnerContractMediaError("PREPARED_REQUEST_MISMATCH");
  }
  return Object.freeze({
    model_id: contract.model_id,
    operation_id: contract.operation_id as "generate-image" | "generate-video",
    modality: contract.modality,
    ai_name: contract.ai_name,
    model_type: contract.model_type,
    schema_hash: contract.schema_hash,
    status: "live_verified",
    mime_types: Object.freeze([...contract.output.mime_types]),
    ...("variant_id" in contract ? { variant_id: contract.variant_id } : {})
  });
}

function ownerContractMediaErrorResult(error: unknown): CallToolResult {
  let code = "INTERNAL_ERROR";
  let recoveryId: string | undefined;
  if (error instanceof OwnerContractMediaError) {
    code = error.code;
    if (error.code === "OUTCOME_UNKNOWN" && error.recoveryId !== undefined) recoveryId = error.recoveryId;
  } else if (error instanceof OwnerGenerationPreflightError) {
    code = error.code;
  } else if (error instanceof SyntxHttpError) {
    code = error.code;
  } else if (error instanceof GenerationContractExecutionError) {
    code = error.code === "GENERATION_CONTRACT_NOT_FOUND" || error.code === "GENERATION_CONTRACT_NOT_REVIEWED"
      ? "GENERATION_CONTRACT_NOT_AVAILABLE"
      : "GENERATION_CONTRACT_BLOCKED";
  } else if (error instanceof GenerationContractExecutionErrorV2) {
    code = error.code === "GENERATION_CONTRACT_VARIANT_AMBIGUOUS"
      ? "GENERATION_CONTRACT_VARIANT_REQUIRED"
      : error.code === "GENERATION_CONTRACT_VARIANT_NOT_FOUND"
        ? "GENERATION_CONTRACT_VARIANT_NOT_FOUND"
        : error.code === "GENERATION_CONTRACT_NOT_FOUND" || error.code === "GENERATION_CONTRACT_NOT_REVIEWED"
          ? "GENERATION_CONTRACT_NOT_AVAILABLE"
          : error.code === "GENERATION_CONTRACT_VALIDATION_FAILED" || error.code === "GENERATION_CONTRACT_PROMPT_INVALID"
            ? "INVALID_PARAMETERS"
            : "GENERATION_CONTRACT_BLOCKED";
  } else if (error instanceof GenerationContractValidationError) {
    code = "INVALID_PARAMETERS";
  }
  const messages: Record<string, string> = {
    AUTH_REQUIRED: "A linked SYNTX account is required for this exact attempt.",
    SUBSCRIPTION_REQUIRED: "An active paid SYNTX subscription is required for this operation.",
    SUBSCRIPTION_STATUS_UNVERIFIED: "The current subscription could not be verified; the operation is unavailable.",
    GENERATION_CONTRACT_NOT_AVAILABLE: "No live-verified media contract is available for this exact model and operation.",
    GENERATION_CONTRACT_VARIANT_REQUIRED: "Choose one of the available live-verified contract variants for this model and operation.",
    GENERATION_CONTRACT_VARIANT_NOT_FOUND: "The requested live-verified contract variant is not available for this model and operation.",
    GENERATION_CONTRACT_BLOCKED: "The selected media contract does not match the current catalog or schema evidence.",
    INVALID_PARAMETERS: "The supplied parameters do not match the live-verified media contract.",
    PREPARED_REQUEST_MISMATCH: "The prepared media request does not match the live-verified contract.",
    PRE_DISPATCH_FAILED: "The media request was rejected before generation dispatch.",
    OUTCOME_UNKNOWN: "The media request may have been dispatched; do not retry automatically.",
    RECOVERY_NOT_FOUND: "No matching read-only recovery record is available for this attempt."
  };
  return {
    isError: true,
    content: [{
      type: "text",
      text: JSON.stringify({
        error: {
          code,
          message: messages[code] ?? "The owner media operation failed safely.",
          ...(recoveryId === undefined ? {} : { recovery_id: recoveryId })
        }
      })
    }]
  };
}

function safeStructuredCall(value: unknown, schema: z.ZodType, recoveryId?: string): CallToolResult {
  try {
    const output = schema.parse(value);
    return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output as Record<string, unknown> };
  } catch {
    // The dispatch may already have completed and consumed the success-path
    // recovery handle. Report uncertainty, never a retryable internal failure.
    return ownerContractMediaErrorResult(new OwnerContractMediaError("OUTCOME_UNKNOWN", recoveryId));
  }
}
