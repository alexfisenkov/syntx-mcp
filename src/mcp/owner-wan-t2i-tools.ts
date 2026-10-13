import { z } from "zod/v4";
import { types } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OwnerReferencePrincipalError } from "../auth/owner-reference-principal.js";
import {
  OWNER_WAN_T2I_GENERATION_ERROR_CODES,
  OWNER_WAN_T2I_GENERATION_HISTORY_REASONS,
  OWNER_WAN_T2I_GENERATION_PHASES,
  OWNER_WAN_T2I_GENERATION_RESULT_REASONS,
  OwnerWanT2iGenerationServiceError,
  type OwnerWanT2iGenerationService,
  type OwnerWanT2iGenerationServiceErrorCode
} from "../application/owner-wan-t2i-generation-service.js";
import {
  OWNER_WAN_T2I_MODELS,
  normalizeOwnerWanT2iParameters,
  type OwnerWanT2iParametersInput
} from "../application/owner-wan-t2i-parameters.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";

export const SYNTX_OWNER_GENERATE_WAN_T2I_IMAGE_TOOL_NAME = "syntx_owner_generate_wan_t2i_image" as const;
export const SYNTX_OWNER_RECONCILE_WAN_T2I_IMAGE_TOOL_NAME = "syntx_owner_reconcile_wan_t2i_image" as const;
export const SYNTX_OWNER_LIST_WAN_T2I_IMAGE_RECOVERIES_TOOL_NAME = "syntx_owner_list_wan_t2i_image_recoveries" as const;
export const OWNER_WAN_T2I_TOOL_NAMES = Object.freeze([
  SYNTX_OWNER_GENERATE_WAN_T2I_IMAGE_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_WAN_T2I_IMAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_WAN_T2I_IMAGE_RECOVERIES_TOOL_NAME
] as const);

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const attemptSchema = z.string().regex(ATTEMPT).describe("Exact current linked owner attempt.");
const parameterSchema = z.object({
  aspect_ratio: z.enum(["1:1", "3:4", "4:3", "9:16", "16:9"]),
  resolution: z.enum(["720P", "1080P"]),
  batch_size: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  prompt_extend: z.boolean(),
  seed: z.number().int().min(0).max(2_147_483_647).nullable(),
  color_palette: z.null(),
  bbox_list: z.tuple([])
}).strict();

const generateInputSchema = z.object({
  link_attempt_id: attemptSchema,
  model_id: z.enum(OWNER_WAN_T2I_MODELS),
  prompt: z.string().min(1).max(1_500),
  parameters: parameterSchema
}).strict().superRefine((input, context) => {
  try {
    normalizeOwnerWanT2iParameters({ model_id: input.model_id, prompt: input.prompt,
      parameters: input.parameters } satisfies OwnerWanT2iParametersInput);
  } catch {
    context.addIssue({ code: "custom", path: ["prompt"], message: "WAN T2I source-shaped input is invalid." });
  }
});

const RECOVERY_ID = /^wan_t2i_recovery_[0-9a-f-]{36}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const recoveryIdSchema = z.string().regex(RECOVERY_ID);
const reconcileInputSchema = z.object({ link_attempt_id: attemptSchema, recovery_id: recoveryIdSchema }).strict();
const listRecoveriesInputSchema = z.object({ link_attempt_id: attemptSchema, limit: z.number().int().min(1).max(20).optional() }).strict();

const generationArtifactSchema = z.object({
  message_object_id: z.string().regex(SAFE_ID), message_id: z.string().regex(SAFE_ID),
  object_type: z.literal("image"), model_type: z.enum(OWNER_WAN_T2I_MODELS), completed: z.literal(true),
  url: z.string().url().max(4096).refine(isSafeUploadReferenceUrl),
  mime_type: z.enum(["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif", "image/bmp"]).nullable(),
  mime_source: z.enum(["URL_EXTENSION", "UNKNOWN"]), width: z.null(), height: z.null(), geometry_verified: z.literal(false)
}).strict().superRefine((artifact, context) => {
  if ((artifact.mime_type === null) !== (artifact.mime_source === "UNKNOWN")) {
    context.addIssue({ code: "custom", path: ["mime_source"], message: "MIME hint and source must agree." });
  }
});
const generationOutputSchema = z.object({
  status: z.enum(["result_observed", "partial_results"]), dispatch_allowed: z.literal(false),
  backend_acceptance: z.literal("UNPROVEN"), provider_execution: z.literal(false),
  model_id: z.enum(OWNER_WAN_T2I_MODELS), profile_id: z.literal("owner-wan-t2i-source-profile-v1"),
  profile_schema_hash: z.string().regex(SHA256), catalog_version: z.literal("sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json"),
  request_fingerprint: z.string().regex(SHA256), intent_fingerprint: z.string().regex(SHA256),
  parameters: parameterSchema, cost_routing: z.object({ ai_name: z.literal("wan_image"), model_type: z.enum(OWNER_WAN_T2I_MODELS) }).strict(),
  cost_inputs: z.object({ batch_size: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]) }).strict(),
  cost_input_confidence: z.literal("SOURCE_JOINED_COST2_QUERY_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP"),
  source_projection_confidence: z.literal("EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY"),
  requested_batch_size: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  actual_result_count: z.number().int().min(0).max(4),
  count_confidence: z.enum(["CURRENT_MESSAGE_MATCHES_EXPLICIT_BATCH_NOT_PROVIDER_TERMINAL", "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL"]),
  provider_terminal_confidence: z.literal("UNPROVEN"),
  artifacts: z.array(generationArtifactSchema).max(4), recovery_id: recoveryIdSchema.optional()
}).strict().superRefine((result, context) => {
  if (result.artifacts.length > result.actual_result_count) {
    context.addIssue({ code: "custom", path: ["artifacts"], message: "Artifacts cannot exceed current message object count." });
  }
  if (result.status === "result_observed" && (result.actual_result_count !== result.requested_batch_size ||
      result.artifacts.length !== result.requested_batch_size ||
      result.count_confidence !== "CURRENT_MESSAGE_MATCHES_EXPLICIT_BATCH_NOT_PROVIDER_TERMINAL")) {
    context.addIssue({ code: "custom", path: ["status"], message: "Observed results must match the full requested batch." });
  }
  if (result.status === "partial_results" && result.count_confidence !== "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL") {
    context.addIssue({ code: "custom", path: ["count_confidence"], message: "Partial results are current-message observations, not a requested-total claim." });
  }
});
const diagnosticSchema = z.object({
  phase: z.enum(OWNER_WAN_T2I_GENERATION_PHASES), post_started: z.boolean(), echo_ack_known: z.boolean(),
  history_status: z.enum(["NONE", "PENDING", "READY", "UNVERIFIED"]),
  history_reason: z.enum(OWNER_WAN_T2I_GENERATION_HISTORY_REASONS).nullable(),
  result_status: z.enum(["NOT_READ", "PENDING", "PARTIAL", "COMPLETE", "UNVERIFIED"]),
  result_reason: z.enum(OWNER_WAN_T2I_GENERATION_RESULT_REASONS).nullable(),
  history_get_calls: z.number().int().min(0).max(255), history_get_calls_saturated: z.boolean(),
  result_get_calls: z.number().int().min(0).max(255), result_get_calls_saturated: z.boolean()
}).strict();
const recoveryItemSchema = z.object({ recovery_id: recoveryIdSchema, created_at: z.iso.datetime(),
  model_id: z.enum(OWNER_WAN_T2I_MODELS), status: z.literal("OUTCOME_UNKNOWN"), diagnostic: diagnosticSchema }).strict();
const recoveryListOutputSchema = z.object({ recoveries: z.array(recoveryItemSchema).max(20) }).strict();

export const OWNER_WAN_T2I_TOOL_INPUT_SCHEMAS = Object.freeze({
  generate: generateInputSchema, reconcile: reconcileInputSchema, list_recoveries: listRecoveriesInputSchema
});
export const OWNER_WAN_T2I_TOOL_OUTPUT_SCHEMAS = Object.freeze({
  generate: generationOutputSchema, reconcile: generationOutputSchema, list_recoveries: recoveryListOutputSchema
});

export interface RegisterSyntxOwnerWanT2iToolsOptions {
  readonly generationService: Pick<OwnerWanT2iGenerationService, "generate" | "reconcile" | "listRecoveries">;
}

/** Registers only the three source-shaped WAN T2I owner tools; no upload tool exists for these zero-reference models. */
export function registerSyntxOwnerWanT2iTools(server: McpServer, options: RegisterSyntxOwnerWanT2iToolsOptions): void {
  server.registerTool(SYNTX_OWNER_GENERATE_WAN_T2I_IMAGE_TOOL_NAME, {
    title: "Generate a WAN T2I image",
    description: "Starts one explicit source-shaped WAN T2I request after fresh account and model-access preflights. Partial observations must be reconciled; never repeat an unknown POST.",
    inputSchema: generateInputSchema, outputSchema: generationOutputSchema,
    annotations: { title: "Generate WAN T2I image", readOnlyHint: false, destructiveHint: true,
      idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    const copied = snapshotSafeInput(input);
    if (copied === undefined) return generationErrorResult(undefined, "INVALID_REQUEST");
    const parsed = generateInputSchema.safeParse(copied);
    if (!parsed.success) return generationErrorResult(undefined, "INVALID_REQUEST");
    try {
      const intent: OwnerWanT2iParametersInput = { model_id: parsed.data.model_id, prompt: parsed.data.prompt,
        parameters: parsed.data.parameters };
      const result = await options.generationService.generate({ attemptId: parsed.data.link_attempt_id, input: intent }, signal);
      return structured(parseSafeOutput(generationOutputSchema, result));
    } catch (error) { return generationErrorResult(error, "PRE_DISPATCH_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_WAN_T2I_IMAGE_TOOL_NAME, {
    title: "Reconcile a WAN T2I generation",
    description: "GET-only reconciliation for the exact linked attempt and process-local recovery ID; it never starts another generation.",
    inputSchema: reconcileInputSchema, outputSchema: generationOutputSchema,
    annotations: { title: "Reconcile WAN T2I generation", readOnlyHint: true, destructiveHint: false,
      idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }) => {
    const copied = snapshotSafeInput(input);
    if (copied === undefined) return generationErrorResult(undefined, "INVALID_REQUEST");
    const parsed = reconcileInputSchema.safeParse(copied);
    if (!parsed.success) return generationErrorResult(undefined, "INVALID_REQUEST");
    try {
      const result = await options.generationService.reconcile({ attemptId: parsed.data.link_attempt_id,
        recovery_id: parsed.data.recovery_id }, signal);
      return structured(parseSafeOutput(generationOutputSchema, result));
    } catch (error) { return generationErrorResult(error, "PRE_DISPATCH_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_LIST_WAN_T2I_IMAGE_RECOVERIES_TOOL_NAME, {
    title: "List WAN T2I recoveries",
    description: "Lists bounded process-local recovery diagnostics for the exact linked attempt without prompt or artifact data.",
    inputSchema: listRecoveriesInputSchema, outputSchema: recoveryListOutputSchema,
    annotations: { title: "List WAN T2I recoveries", readOnlyHint: true, destructiveHint: false,
      idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    const copied = snapshotSafeInput(input);
    if (copied === undefined) return recoveryListError("INVALID_REQUEST");
    const parsed = listRecoveriesInputSchema.safeParse(copied);
    if (!parsed.success) return recoveryListError("INVALID_REQUEST");
    try {
      const result = await options.generationService.listRecoveries({ attemptId: parsed.data.link_attempt_id,
        ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }) });
      return structured(parseSafeOutput(recoveryListOutputSchema, { recoveries: result }));
    } catch (error) {
      const code = error instanceof OwnerWanT2iGenerationServiceError ? error.code : "SERVICE_BUSY";
      return recoveryListError(code === "INVALID_REQUEST" || code === "SERVICE_CLOSED" || code === "PRINCIPAL_NOT_LINKED"
        ? code : "SERVICE_BUSY");
    }
  });
}

const GENERATION_ERROR_MESSAGES: Record<OwnerWanT2iGenerationServiceErrorCode, string> = {
  INVALID_REQUEST: "The WAN T2I request is invalid.",
  SERVICE_CLOSED: "The owner WAN T2I service is closed.",
  SERVICE_BUSY: "The owner WAN T2I service is busy.",
  MODEL_BINDING_MISMATCH: "The selected WAN T2I model profile is unavailable.",
  PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.",
  PREFLIGHT_FAILED: "Current account or model access could not be verified.",
  INTENT_ALREADY_CLAIMED: "This WAN T2I intent has an unresolved outcome.",
  PRE_DISPATCH_FAILED: "The WAN T2I request was not safely dispatched.",
  OUTCOME_UNKNOWN: "The WAN T2I request may have been dispatched; reconcile its recovery and do not retry.",
  RECOVERY_NOT_FOUND: "The WAN T2I recovery is unavailable or expired."
};

function generationErrorResult(error: unknown, fallback: OwnerWanT2iGenerationServiceErrorCode): CallToolResult {
  let code = fallback;
  let recoveryId: string | undefined;
  let diagnostic: unknown;
  if (!isProxyObject(error) && error instanceof OwnerWanT2iGenerationServiceError) {
    const candidateCode = ownData(error, "code");
    if (typeof candidateCode === "string" && (OWNER_WAN_T2I_GENERATION_ERROR_CODES as readonly string[]).includes(candidateCode)) {
      code = candidateCode as OwnerWanT2iGenerationServiceErrorCode;
    }
    const candidateRecoveryId = ownData(error, "recovery_id");
    if (typeof candidateRecoveryId === "string" && RECOVERY_ID.test(candidateRecoveryId)) recoveryId = candidateRecoveryId;
    const checkedDiagnostic = diagnosticSchema.safeParse(snapshotSafeInput(ownData(error, "diagnostic")));
    if (checkedDiagnostic.success) diagnostic = checkedDiagnostic.data;
  } else if (!isProxyObject(error) && error instanceof OwnerReferencePrincipalError) {
    code = "PRINCIPAL_NOT_LINKED";
  }
  return errorResult({ error: { code, message: GENERATION_ERROR_MESSAGES[code],
    ...(code === "OUTCOME_UNKNOWN" && recoveryId ? { recovery_id: recoveryId } : {}),
    ...(code === "OUTCOME_UNKNOWN" && diagnostic ? { diagnostic } : {}) } });
}

function recoveryListError(code: "INVALID_REQUEST" | "SERVICE_BUSY" | "SERVICE_CLOSED" | "PRINCIPAL_NOT_LINKED"): CallToolResult {
  const messages = { INVALID_REQUEST: "The WAN T2I recovery request is invalid.", SERVICE_BUSY: "The owner WAN T2I service is busy.",
    SERVICE_CLOSED: "The owner WAN T2I service is closed.", PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required." };
  return errorResult({ error: { code, message: messages[code] } });
}

function structured(value: object): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> };
}

function errorResult(value: object): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify(value) }] };
}

function parseSafeOutput(schema: z.ZodType, value: unknown): Record<string, unknown> {
  const copied = snapshotSafeInput(value);
  const parsed = schema.safeParse(copied);
  if (!parsed.success || !parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) {
    throw new Error("WAN_T2I_OUTPUT_SHAPE_INVALID");
  }
  return parsed.data as Record<string, unknown>;
}

function snapshotSafeInput(value: unknown): unknown {
  try { return snapshotJson(value, 0, { nodes: 0 }); } catch { return undefined; }
}

function snapshotJson(value: unknown, depth: number, budget: { nodes: number }): unknown {
  budget.nodes += 1;
  if (budget.nodes > 50_000 || depth > 32) throw new TypeError("invalid input");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new TypeError("invalid number"); return value; }
  if (!value || typeof value !== "object" || types.isProxy(value)) throw new TypeError("invalid object");
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError("invalid array");
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" && (typeof key !== "string" ||
        !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length || !("value" in descriptors[key]!) ||
        descriptors[key]!.enumerable !== true))) throw new TypeError("invalid array");
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError("invalid array item");
      result.push(snapshotJson(descriptor.value, depth + 1, budget));
    }
    return result;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("invalid record");
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (typeof key !== "string" || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) throw new TypeError("invalid field");
    Object.defineProperty(result, key, { value: snapshotJson(descriptors[key]!.value, depth + 1, budget), enumerable: true });
  }
  return result;
}

function ownData(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function isProxyObject(value: unknown): value is object { return Boolean(value) && typeof value === "object" && types.isProxy(value); }
