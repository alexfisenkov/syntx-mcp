import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { snapshotOwnerDurableLiveParameters } from "../application/owner-durable-live-generation-service.js";
import type { OwnerDurableLiveGenerationServicePort } from "../application/owner-durable-live-generation-service.js";

export const SYNTX_OWNER_START_DURABLE_GENERATION_TOOL_NAME = "syntx_owner_start_durable_generation" as const;
export const SYNTX_OWNER_GET_DURABLE_JOB_TOOL_NAME = "syntx_owner_get_durable_job" as const;
export const SYNTX_OWNER_GET_DURABLE_RESULT_TOOL_NAME = "syntx_owner_get_durable_result" as const;

const attemptIdSchema = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u);
const idempotencyKeySchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
// Keep nested values opaque to Zod: the application snapshot enforces depth/node/byte
// bounds iteratively before any contract validator walks the parameter tree.
const parametersSchema = z.record(z.string().min(1).max(64), z.unknown()).refine((value) => Object.keys(value).length <= 64);
const startInputSchema = z.object({
  link_attempt_id: attemptIdSchema,
  model_id: identifierSchema,
  operation_id: identifierSchema,
  variant_id: identifierSchema,
  parameters: parametersSchema,
  idempotency_key: idempotencyKeySchema
}).strict();
const safeJobSchema = z.object({
  id: identifierSchema,
  model_id: identifierSchema,
  operation_id: identifierSchema,
  catalog_version: z.string().max(200),
  status: z.enum(["queued", "running", "succeeded", "failed", "canceled"]),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime()
}).strict();
const safeResultSchema = z.object({
  id: identifierSchema,
  job_id: identifierSchema,
  model_id: identifierSchema,
  operation_id: identifierSchema,
  catalog_version: z.string().max(200),
  completed_at: z.iso.datetime(),
  summary: z.string().max(4_000),
  artifacts: z.array(z.object({
    id: identifierSchema,
    kind: z.enum(["text", "image", "video", "audio"]),
    mime_type: z.string().max(128),
    size_bytes: z.number().int().nonnegative().nullable(),
    download_url: z.string().url().max(4_096).refine((value) => new URL(value).protocol === "https:").nullable()
  }).strict()).max(16)
}).strict();

/** Explicit owner-only registration. The default and HTTP composition roots never call this module. */
export function registerSyntxOwnerDurableGenerationTools(
  server: McpServer,
  service: OwnerDurableLiveGenerationServicePort
): void {
  server.registerTool(SYNTX_OWNER_START_DURABLE_GENERATION_TOOL_NAME, {
    title: "Start durable owner generation",
    description: "Starts or replays one exact owner generation request through the durable journal. Cost is uncapped and SYNTX may charge the account. Reuse the same idempotency_key only for the same request; an unknown outcome must be reconciled with the returned job_id using the GET tools, never retried with a new key.",
    inputSchema: startInputSchema,
    outputSchema: z.object({ job_id: identifierSchema, model_id: identifierSchema, operation_id: identifierSchema, status: z.enum(["queued", "running", "succeeded", "failed", "canceled"]) }).strict(),
    annotations: { title: "Start durable owner generation", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
  }, async (input): Promise<CallToolResult> => {
    try {
      const job = safeJobSchema.parse(await service.start({ ...input, parameters: snapshotOwnerDurableLiveParameters(input.parameters) }));
      const output = { job_id: job.id, model_id: job.model_id, operation_id: job.operation_id, status: job.status };
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) { return safeToolError(error); }
  });

  server.registerTool(SYNTX_OWNER_GET_DURABLE_JOB_TOOL_NAME, {
    title: "Get durable owner job",
    description: "Reads one previously journaled job for this exact linked attempt. This performs no model lookup, tariff check, chat creation, or generation dispatch.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, job_id: identifierSchema }).strict(),
    outputSchema: safeJobSchema,
    annotations: { title: "Get durable owner job", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async ({ link_attempt_id, job_id }): Promise<CallToolResult> => {
    try { return safeSuccess(safeJobSchema.parse(await service.getJob(link_attempt_id, job_id))); }
    catch (error) { return safeToolError(error); }
  });

  server.registerTool(SYNTX_OWNER_GET_DURABLE_RESULT_TOOL_NAME, {
    title: "Get durable owner result",
    description: "Reads one previously journaled result for this exact linked attempt. This performs no model lookup, tariff check, chat creation, or generation dispatch.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, job_id: identifierSchema }).strict(),
    outputSchema: safeResultSchema,
    annotations: { title: "Get durable owner result", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async ({ link_attempt_id, job_id }): Promise<CallToolResult> => {
    try { return safeSuccess(safeResultSchema.parse(await service.getResult(link_attempt_id, job_id))); }
    catch (error) { return safeToolError(error); }
  });
}

function safeSuccess<T extends Record<string, unknown>>(output: T): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
}

function safeToolError(error: unknown): CallToolResult {
  const code = readSafeErrorCode(error);
  const operationId = readOpaqueOperationId(error);
  const messages: Record<string, string> = {
    UPSTREAM_OUTCOME_UNKNOWN: "The generation may have been dispatched. Do not retry; reconcile the returned job_id with the GET tools.",
    IDEMPOTENCY_CONFLICT: "This idempotency key is already bound to another request.",
    OWNER_SESSION_NOT_LINKED: "The exact owner account attempt is not currently linked.",
    OWNER_SESSION_NOT_FOUND: "The requested durable job or result is unavailable for this attempt.",
    OWNER_SESSION_CONTEXT_UNAVAILABLE: "The durable owner read could not be completed safely.",
    OWNER_SESSION_SELECTION_UNAVAILABLE: "The selected live generation contract is unavailable.",
    OWNER_SESSION_CATALOG_MISMATCH: "The selected live contract does not match the current catalog.",
    OWNER_SESSION_CLOSED: "The owner session is closed.",
    INVALID_PARAMETERS: "Generation parameters do not match the selected live contract.",
    SUBSCRIPTION_REQUIRED: "An active paid subscription is required.",
    SUBSCRIPTION_STATUS_UNVERIFIED: "The current subscription could not be verified.",
    OWNER_MODEL_ACCESS_UNAVAILABLE: "Current account access to this exact model could not be verified.",
    INTERNAL_ERROR: "The owner generation request is unavailable."
  };
  const output = { error: { code, message: messages[code] ?? messages.INTERNAL_ERROR!, ...(operationId ? { job_id: operationId } : {}) } };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(output) }] };
}

function readSafeErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "INTERNAL_ERROR";
  const code = Object.getOwnPropertyDescriptor(error, "code")?.value;
  const known = new Set([
    "UPSTREAM_OUTCOME_UNKNOWN", "IDEMPOTENCY_CONFLICT", "OWNER_SESSION_NOT_LINKED",
    "OWNER_SESSION_NOT_FOUND", "OWNER_SESSION_CONTEXT_UNAVAILABLE", "OWNER_SESSION_SELECTION_UNAVAILABLE", "OWNER_SESSION_CATALOG_MISMATCH",
    "OWNER_SESSION_CLOSED", "INVALID_PARAMETERS", "SUBSCRIPTION_REQUIRED",
    "SUBSCRIPTION_STATUS_UNVERIFIED", "OWNER_MODEL_ACCESS_UNAVAILABLE", "OWNER_LIVE_UNAVAILABLE"
  ]);
  return typeof code === "string" && known.has(code) ? code : "INTERNAL_ERROR";
}

function readOpaqueOperationId(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const details = Object.getOwnPropertyDescriptor(error, "details")?.value;
  if (!details || typeof details !== "object") return undefined;
  const id = Object.getOwnPropertyDescriptor(details, "operation_id")?.value;
  return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(id) ? id : undefined;
}
