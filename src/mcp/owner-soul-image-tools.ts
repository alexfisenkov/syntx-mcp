import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { types } from "node:util";
import {
  OwnerSoulCharacterOptionsServiceError,
  type OwnerSoulCharacterOptionsService,
  type OwnerSoulCharacterOptionsServiceErrorCode
} from "../application/owner-soul-character-options-service.js";
import {
  OWNER_SOUL_IMAGE_GENERATION_ERROR_CODES,
  OWNER_SOUL_IMAGE_GENERATION_HISTORY_REASONS,
  OWNER_SOUL_IMAGE_GENERATION_PHASES,
  OWNER_SOUL_IMAGE_GENERATION_RESULT_REASONS,
  OwnerSoulImageGenerationServiceError,
  type OwnerSoulImageGenerationService,
  type OwnerSoulImageGenerationServiceErrorCode
} from "../application/owner-soul-image-generation-service.js";
import {
  normalizeOwnerSoulGenerationParameters,
  type OwnerSoulGenerationParametersInput
} from "../application/owner-soul-generation-parameters.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { OwnerReferencePrincipalError } from "../auth/owner-reference-principal.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";

export const SYNTX_LIST_OWNER_SOUL_CHARACTER_OPTIONS_TOOL_NAME = "syntx_list_owner_soul_character_options" as const;
export const SYNTX_OWNER_GENERATE_SOUL_IMAGE_TOOL_NAME = "syntx_owner_generate_soul_image" as const;
export const SYNTX_OWNER_RECONCILE_SOUL_IMAGE_TOOL_NAME = "syntx_owner_reconcile_soul_image" as const;
export const SYNTX_OWNER_LIST_SOUL_IMAGE_RECOVERIES_TOOL_NAME = "syntx_owner_list_soul_image_recoveries" as const;
export const OWNER_SOUL_IMAGE_TOOL_NAMES = Object.freeze([SYNTX_OWNER_GENERATE_SOUL_IMAGE_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_SOUL_IMAGE_TOOL_NAME, SYNTX_OWNER_LIST_SOUL_IMAGE_RECOVERIES_TOOL_NAME,
  SYNTX_LIST_OWNER_SOUL_CHARACTER_OPTIONS_TOOL_NAME] as const);
const SOURCE_MAPPING_SHA256 = "sha256:a11bcb0b533f7f3f9f1668e5bab290ef5d0ba85410df5b78f18e361db96b9391";
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const STYLE_HANDLE = /^soul_style_[0-9a-f-]{36}$/u;
const CHARACTER_HANDLE = /^soul_character_[0-9a-f-]{36}$/u;
const RECOVERY_ID = /^soul_image_recovery_[0-9a-f-]{36}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

const attemptSchema = z.string().regex(ATTEMPT).describe("Exact linked owner attempt; it never selects another account.");
const characterOptionsInputSchema = z.object({ link_attempt_id: attemptSchema }).strict();
const styleSelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("selected"), style_handle: z.string().regex(STYLE_HANDLE),
    strength: z.number().min(0).max(1).refine((value) => Math.abs(value * 10 - Math.round(value * 10)) < 1e-9) }).strict()
]);
const characterSelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("selected"), character_handle: z.string().regex(CHARACTER_HANDLE) }).strict()
]);
const qualitySchema = z.enum(["720p", "1080p"]);
const resolutionSchema = z.enum(["2048x1152", "1680x1120", "1536x1152", "1536x1536", "1152x1536", "1120x1680", "1152x2048",
  "2016x1344", "2048x1536", "1536x2048", "1344x2016"]);
const batchSizeSchema = z.union([z.literal(1), z.literal(4)]);
const seedSchema = z.number().int().min(0).max(2_147_483_647).nullable();
const generationParametersSchema = z.object({
  prompt: z.string().min(1).max(131_072).refine((prompt) => Buffer.byteLength(prompt, "utf8") <= 131_072 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(prompt)),
  quality: qualitySchema,
  resolution: resolutionSchema,
  batch_size: batchSizeSchema,
  enhance_prompt: z.boolean(),
  seed: seedSchema,
  style: styleSelectionSchema,
  character: characterSelectionSchema
}).strict();
const generateInputSchema = z.object({ link_attempt_id: attemptSchema, ...generationParametersSchema.shape }).strict()
  .superRefine((input, context) => {
    try {
      normalizeOwnerSoulGenerationParameters({ prompt: input.prompt, quality: input.quality, resolution: input.resolution,
        batch_size: input.batch_size, enhance_prompt: input.enhance_prompt, seed: input.seed, style: input.style, character: input.character });
    } catch {
      context.addIssue({ code: "custom", path: ["resolution"], message: "Soul explicit controls or conditional selections are invalid." });
    }
  });
const reconcileInputSchema = z.object({ link_attempt_id: attemptSchema, recovery_id: z.string().regex(RECOVERY_ID) }).strict();
const listRecoveriesInputSchema = z.object({ link_attempt_id: attemptSchema, limit: z.number().int().min(1).max(20).optional() }).strict();
const byteRangeSchema = z.object({ min: z.number().int().min(0).max(4096), max: z.number().int().min(0).max(4096) }).strict()
  .superRefine((range, context) => {
    if (range.max < range.min) context.addIssue({ code: "custom", path: ["max"], message: "The byte range is inverted." });
  });
const summarySchema = z.object({
  route: z.literal("hf/lora/list"),
  response_bytes: z.number().int().min(0).max(65_536),
  outcome: z.enum(["SHAPE_OBSERVED", "EMPTY_INCONCLUSIVE"]),
  record_count: z.number().int().min(0).max(128),
  total_matches: z.literal(true),
  selectable_count: z.number().int().min(0).max(128),
  status_counts: z.object({
    "not-ready": z.number().int().min(0).max(128), "in-progress": z.number().int().min(0).max(128),
    queue: z.number().int().min(0).max(128), error: z.number().int().min(0).max(128),
    completed: z.number().int().min(0).max(128), unknown: z.number().int().min(0).max(128)
  }).strict(),
  record_id_type_counts: z.object({ string: z.number().int().min(0).max(128), number: z.number().int().min(0).max(128) }).strict(),
  reference_id_type_counts: z.object({ string: z.number().int().min(0).max(128), number: z.number().int().min(0).max(128),
    null: z.number().int().min(0).max(128), missing: z.number().int().min(0).max(128) }).strict(),
  title_utf8_bytes: byteRangeSchema,
  unknown_top_level_key_count: z.number().int().min(0).max(64),
  unknown_item_key_count: z.number().int().min(0).max(128 * 64)
}).strict().superRefine((summary, context) => {
  if (summary.record_count === 0 ? summary.outcome !== "EMPTY_INCONCLUSIVE" : summary.outcome !== "SHAPE_OBSERVED") {
    context.addIssue({ code: "custom", path: ["outcome"], message: "Outcome must reflect whether any source rows were observed." });
  }
  if (summary.selectable_count > summary.record_count || summary.status_counts["not-ready"] + summary.status_counts["in-progress"] +
      summary.status_counts.queue + summary.status_counts.error + summary.status_counts.completed + summary.status_counts.unknown !== summary.record_count ||
      summary.record_id_type_counts.string + summary.record_id_type_counts.number !== summary.record_count ||
      summary.reference_id_type_counts.string + summary.reference_id_type_counts.number + summary.reference_id_type_counts.null +
      summary.reference_id_type_counts.missing !== summary.record_count) {
    context.addIssue({ code: "custom", path: ["record_count"], message: "Summary counts must agree with the observed row count." });
  }
});

const optionSchema = z.object({
  character_handle: z.string().regex(/^soul_character_[0-9a-f-]{36}$/u).nullable(),
  label: z.string().min(1).max(256).regex(/^[^\u0000-\u001f\u007f]*$/u),
  status: z.string().min(1).max(64).regex(/^[^\u0000-\u001f\u007f]*$/u),
  selectable: z.boolean(),
  reference_id_type: z.enum(["string", "number", "unavailable"])
}).strict().superRefine((option, context) => {
  if (option.selectable !== (option.character_handle !== null) ||
      (option.selectable && (option.status !== "completed" || option.reference_id_type === "unavailable"))) {
    context.addIssue({ code: "custom", path: ["selectable"], message: "Selectable rows require a completed source-bound option handle." });
  }
});
const outputSchema = z.object({
  status: z.enum(["OPTIONS_ISSUED", "EMPTY_INCONCLUSIVE"]),
  model_id: z.literal("higgsfield-soul"),
  catalog_version: z.literal(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION),
  source_mapping_sha256: z.literal(SOURCE_MAPPING_SHA256),
  confidence_scope: z.literal("AUTHENTICATED_CURRENT_ACCOUNT_LIST_MEMBERSHIP_NOT_UPSTREAM_OWNER_FILTER_OR_PROVIDER_PERMISSION"),
  reference_id_type_confidence: z.literal("CURRENT_ROW_VALUE_TYPE_ONLY_SERVER_TYPE_UNOBSERVED"),
  generation_allowed: z.literal(false),
  expires_in_seconds: z.literal(300),
  options: z.array(optionSchema).max(128),
  summary: summarySchema
}).strict().superRefine((result, context) => {
  if (result.options.length !== result.summary.record_count) {
    context.addIssue({ code: "custom", path: ["options"], message: "Option rows must agree with the validated source count." });
  }
  if ((result.status === "EMPTY_INCONCLUSIVE") !== (result.summary.record_count === 0)) {
    context.addIssue({ code: "custom", path: ["status"], message: "Empty outcomes must remain explicitly inconclusive." });
  }
});
const generationParameterOutputSchema = z.object({
  quality: qualitySchema, resolution: resolutionSchema, batch_size: batchSizeSchema, enhance_prompt: z.boolean(), seed: seedSchema,
  style: z.discriminatedUnion("kind", [z.object({ kind: z.literal("none") }).strict(),
    z.object({ kind: z.literal("selected"), strength: z.number().min(0).max(1) }).strict()]),
  character: z.discriminatedUnion("kind", [z.object({ kind: z.literal("none") }).strict(),
    z.object({ kind: z.literal("selected") }).strict()])
}).strict();
const generationArtifactSchema = z.object({
  message_object_id: z.string().regex(SAFE_ID), message_id: z.string().regex(SAFE_ID), object_type: z.literal("image"),
  model_type: z.literal("higgsfield-soul"), completed: z.literal(true),
  url: z.string().url().max(4096).refine(isSafeUploadReferenceUrl),
  mime_type: z.enum(["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif", "image/bmp"]).nullable(),
  mime_source: z.enum(["URL_EXTENSION", "UNKNOWN"]), width: z.null(), height: z.null(), geometry_verified: z.literal(false)
}).strict().superRefine((artifact, context) => {
  if ((artifact.mime_type === null) !== (artifact.mime_source === "UNKNOWN")) {
    context.addIssue({ code: "custom", path: ["mime_source"], message: "MIME hint and source must agree." });
  }
});
const generationOutputSchema = z.object({
  status: z.enum(["result_observed", "partial_results"]), dispatch_allowed: z.literal(false), backend_acceptance: z.literal("UNPROVEN"),
  provider_execution: z.literal(false), model_id: z.literal("higgsfield-soul"), profile_id: z.literal("owner-soul-image-source-profile-v1"),
  profile_schema_hash: z.string().regex(SHA256), catalog_version: z.literal(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION),
  request_fingerprint: z.string().regex(SHA256), intent_fingerprint: z.string().regex(SHA256),
  parameters: generationParameterOutputSchema,
  selection: z.object({ style: z.enum(["none", "selected"]), character: z.enum(["none", "selected"]) }).strict(),
  cost_routing: z.object({ ai_name: z.literal("higgsfield-soul"), model_type: z.literal("higgsfield-soul") }).strict(),
  cost_inputs: z.object({ quality: qualitySchema, resolution: resolutionSchema, batch_size: batchSizeSchema }).strict(),
  source_projection_confidence: z.literal("EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY"),
  reference_strength: z.literal("UNRESOLVED_UNCONTROLLED_WIRE_FIELD"), requested_batch_size: batchSizeSchema,
  actual_result_count: z.number().int().min(0).max(4),
  count_confidence: z.enum(["CURRENT_VERIFIED_MESSAGE_MATCHES_EXPLICIT_BATCH_SIZE", "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL"]),
  artifacts: z.array(generationArtifactSchema).max(4), recovery_id: z.string().regex(RECOVERY_ID).optional()
}).strict().superRefine((result, context) => {
  const completed = result.status === "result_observed";
  if ((completed && (result.actual_result_count !== result.requested_batch_size || result.artifacts.length !== result.requested_batch_size ||
      result.count_confidence !== "CURRENT_VERIFIED_MESSAGE_MATCHES_EXPLICIT_BATCH_SIZE")) ||
      (!completed && result.count_confidence !== "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL") ||
      result.artifacts.length > result.actual_result_count) {
    context.addIssue({ code: "custom", path: ["actual_result_count"], message: "Observed results must match the explicit requested Soul batch." });
  }
});
const diagnosticSchema = z.object({
  phase: z.enum(OWNER_SOUL_IMAGE_GENERATION_PHASES), post_started: z.boolean(), echo_ack_known: z.boolean(),
  history_status: z.enum(["NONE", "PENDING", "READY", "UNVERIFIED"]),
  history_reason: z.enum(OWNER_SOUL_IMAGE_GENERATION_HISTORY_REASONS).nullable(),
  result_status: z.enum(["NOT_READ", "PENDING", "PARTIAL", "COMPLETE", "UNVERIFIED"]),
  result_reason: z.enum(OWNER_SOUL_IMAGE_GENERATION_RESULT_REASONS).nullable(),
  history_get_calls: z.number().int().min(0).max(255), history_get_calls_saturated: z.boolean(),
  result_get_calls: z.number().int().min(0).max(255), result_get_calls_saturated: z.boolean()
}).strict();
const recoveryItemSchema = z.object({ recovery_id: z.string().regex(RECOVERY_ID), created_at: z.iso.datetime(),
  model_id: z.literal("higgsfield-soul"), status: z.literal("OUTCOME_UNKNOWN"), diagnostic: diagnosticSchema }).strict();
const listRecoveriesOutputSchema = z.object({ recoveries: z.array(recoveryItemSchema).max(20) }).strict();

const CHARACTER_ERROR_CODES = ["INVALID_REQUEST", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH", "SERVICE_BUSY", "SERVICE_CLOSED",
  "SNAPSHOT_SUPERSEDED", "CAPACITY_EXCEEDED", "SOURCE_SNAPSHOT_INVALID", "OPTION_HANDLE_NOT_FOUND", "OPTION_HANDLE_EXPIRED",
  "UPSTREAM_UNAVAILABLE", "UPSTREAM_TIMEOUT", "UPSTREAM_REQUEST_ABORTED", "UPSTREAM_PROTOCOL_ERROR"] as const;
type CharacterErrorDifference = [Exclude<OwnerSoulCharacterOptionsServiceErrorCode, typeof CHARACTER_ERROR_CODES[number]>,
  Exclude<typeof CHARACTER_ERROR_CODES[number], OwnerSoulCharacterOptionsServiceErrorCode>];
const CHARACTER_ERROR_CODES_EXACT: CharacterErrorDifference extends [never, never] ? true : never = true;
void CHARACTER_ERROR_CODES_EXACT;

export interface RegisterSyntxOwnerSoulImageToolsOptions {
  readonly characterOptionsService: Pick<OwnerSoulCharacterOptionsService, "listOptions">;
  readonly generationService?: Pick<OwnerSoulImageGenerationService, "generate" | "reconcile" | "listRecoveries">;
}

export const OWNER_SOUL_IMAGE_TOOL_INPUT_SCHEMAS = Object.freeze({
  generate: generateInputSchema, reconcile: reconcileInputSchema, list_recoveries: listRecoveriesInputSchema,
  character_options: characterOptionsInputSchema
});
export const OWNER_SOUL_IMAGE_TOOL_OUTPUT_SCHEMAS = Object.freeze({
  generate: generationOutputSchema, reconcile: generationOutputSchema, list_recoveries: listRecoveriesOutputSchema,
  character_options: outputSchema
});

/** Soul Character listing is a selector read only; style listing reuses its existing standalone tool. */
export function registerSyntxOwnerSoulImageTools(server: McpServer, options: RegisterSyntxOwnerSoulImageToolsOptions): void {
  const generationService = options.generationService;
  if (generationService) {
  server.registerTool(SYNTX_OWNER_GENERATE_SOUL_IMAGE_TOOL_NAME, {
    title: "Generate a Soul image",
    description: "Starts one source-bound Soul image generation after fresh account and model-access preflights. The explicit batch size is 1 or 4; partial observations must be reconciled, never retried as a new generation.",
    inputSchema: generateInputSchema, outputSchema: generationOutputSchema,
    annotations: { title: "Generate a Soul image", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = generateInputSchema.safeParse(snapshotSafeInput(input));
    if (!parsed.success) return generationErrorResult(undefined, "INVALID_REQUEST", "GENERATION_FAILED");
    try {
      const intent: OwnerSoulGenerationParametersInput = { prompt: parsed.data.prompt, quality: parsed.data.quality,
        resolution: parsed.data.resolution, batch_size: parsed.data.batch_size, enhance_prompt: parsed.data.enhance_prompt,
        seed: parsed.data.seed, style: parsed.data.style, character: parsed.data.character };
      const result = await generationService.generate({ attemptId: parsed.data.link_attempt_id, input: intent }, signal);
      return structured(parseSafeOutput(generationOutputSchema, result));
    } catch (error) { return generationErrorResult(error, "PRE_DISPATCH_FAILED", "GENERATION_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_RECONCILE_SOUL_IMAGE_TOOL_NAME, {
    title: "Reconcile a Soul image generation",
    description: "GET-only reconciliation for the exact linked attempt and process-local recovery ID. It never starts another generation.",
    inputSchema: reconcileInputSchema, outputSchema: generationOutputSchema,
    annotations: { title: "Reconcile a Soul image generation", readOnlyHint: true, destructiveHint: false,
      idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = reconcileInputSchema.safeParse(snapshotSafeInput(input));
    if (!parsed.success) return generationErrorResult(undefined, "INVALID_REQUEST", "GENERATION_FAILED");
    try {
      const result = await generationService.reconcile({ attemptId: parsed.data.link_attempt_id,
        recovery_id: parsed.data.recovery_id }, signal);
      return structured(parseSafeOutput(generationOutputSchema, result));
    } catch (error) { return generationErrorResult(error, "PRE_DISPATCH_FAILED", "GENERATION_FAILED"); }
  });

  server.registerTool(SYNTX_OWNER_LIST_SOUL_IMAGE_RECOVERIES_TOOL_NAME, {
    title: "List Soul image recoveries",
    description: "List bounded process-local Soul recovery diagnostics for the exact linked attempt without prompts, source IDs, or artifact URLs.",
    inputSchema: listRecoveriesInputSchema, outputSchema: listRecoveriesOutputSchema,
    annotations: { title: "List Soul image recoveries", readOnlyHint: true, destructiveHint: false,
      idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    const parsed = listRecoveriesInputSchema.safeParse(snapshotSafeInput(input));
    if (!parsed.success) return recoveryListError("INVALID_REQUEST");
    try {
      const result = await generationService.listRecoveries({ attemptId: parsed.data.link_attempt_id,
        ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }) });
      return structured(parseSafeOutput(listRecoveriesOutputSchema, { recoveries: result }));
    } catch (error) {
      const code = error instanceof OwnerSoulImageGenerationServiceError ? error.code : "SERVICE_BUSY";
      return recoveryListError(code === "INVALID_REQUEST" || code === "SERVICE_CLOSED" || code === "PRINCIPAL_NOT_LINKED"
        ? code : "SERVICE_BUSY");
    }
  });
  }

  server.registerTool(SYNTX_LIST_OWNER_SOUL_CHARACTER_OPTIONS_TOOL_NAME, {
    title: "List owner Soul Character options",
    description: "Read current Character rows for the exact linked owner and return safe labels, status and opaque process-local handles. Reference IDs are not returned; list membership is not upstream ownership or generation permission.",
    inputSchema: characterOptionsInputSchema,
    outputSchema,
    annotations: { title: "List owner Soul Character options", readOnlyHint: true, destructiveHint: false,
      idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = characterOptionsInputSchema.safeParse(snapshotSafeInput(input));
    if (!parsed.success) return characterOptionsError(undefined, "INVALID_REQUEST");
    try {
      const result = await options.characterOptionsService.listOptions({ attemptId: parsed.data.link_attempt_id, signal });
      return structured(parseSafeOutput(outputSchema, result));
    } catch (error) {
      return characterOptionsError(error);
    }
  });
}

const GENERATION_ERROR_MESSAGES: Record<OwnerSoulImageGenerationServiceErrorCode, string> = {
  INVALID_REQUEST: "The Soul image request is invalid.", SERVICE_CLOSED: "The owner Soul image service is closed.",
  SERVICE_BUSY: "The owner Soul image service is busy.", MODEL_BINDING_MISMATCH: "The pinned Soul model is unavailable in the selected catalog.",
  PRINCIPAL_NOT_LINKED: "A linked owner attempt is required.", PREFLIGHT_FAILED: "Current account or model access could not be verified.",
  INTENT_ALREADY_CLAIMED: "This Soul image intent already has an unresolved outcome.",
  PRE_DISPATCH_FAILED: "The Soul image request was not safely dispatched.",
  OUTCOME_UNKNOWN: "The Soul image request may have been dispatched; reconcile its recovery and do not retry.",
  RECOVERY_NOT_FOUND: "The Soul recovery is unavailable or expired."
};

function generationErrorResult(error: unknown, fallback: OwnerSoulImageGenerationServiceErrorCode,
  _operation: "GENERATION_FAILED"): CallToolResult {
  let code = fallback;
  let recoveryId: string | undefined;
  let diagnostic: unknown;
  if (!isProxyObject(error) && error instanceof OwnerSoulImageGenerationServiceError) {
    const candidate = ownData(error, "code");
    if (typeof candidate === "string" && (OWNER_SOUL_IMAGE_GENERATION_ERROR_CODES as readonly string[]).includes(candidate)) {
      code = candidate as OwnerSoulImageGenerationServiceErrorCode;
    }
    const rawRecoveryId = ownData(error, "recovery_id");
    if (typeof rawRecoveryId === "string" && RECOVERY_ID.test(rawRecoveryId)) recoveryId = rawRecoveryId;
    const copied = snapshotSafeInput(ownData(error, "diagnostic"));
    const checked = diagnosticSchema.safeParse(copied);
    if (checked.success) diagnostic = checked.data;
  } else if (!isProxyObject(error) && error instanceof OwnerReferencePrincipalError) {
    code = "PRINCIPAL_NOT_LINKED";
  }
  const body = { error: { code, message: GENERATION_ERROR_MESSAGES[code],
    ...(code === "OUTCOME_UNKNOWN" && recoveryId ? { recovery_id: recoveryId } : {}),
    ...(code === "OUTCOME_UNKNOWN" && diagnostic ? { diagnostic } : {}) } };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] };
}

function recoveryListError(code: "INVALID_REQUEST" | "SERVICE_BUSY" | "SERVICE_CLOSED" | "PRINCIPAL_NOT_LINKED"): CallToolResult {
  const messages = { INVALID_REQUEST: "The Soul recovery-list request is invalid.", SERVICE_BUSY: "The owner Soul image service is busy.",
    SERVICE_CLOSED: "The owner Soul image service is closed.", PRINCIPAL_NOT_LINKED: "A linked owner attempt is required." };
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message: messages[code] } }) } ] };
}

function structured<T extends Record<string, unknown> | readonly unknown[]>(output: T): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output as Record<string, unknown> };
}

function parseSafeOutput<T>(schema: z.ZodType<T>, value: unknown): T {
  const copied = snapshotSafeInput(value);
  if (copied === undefined) throw new Error("UNSAFE_SERVICE_OUTPUT");
  return schema.parse(copied);
}

function snapshotSafeInput(value: unknown): unknown {
  const seen = new WeakSet<object>(); let nodes = 0;
  const copy = (item: unknown, depth: number): unknown => {
    if (++nodes > 4_096 || depth > 8) throw new Error("UNSAFE_TOOL_DATA");
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "string") { if (item.length > 131_072) throw new Error("UNSAFE_TOOL_DATA"); return item; }
    if (typeof item === "number") { if (!Number.isFinite(item)) throw new Error("UNSAFE_TOOL_DATA"); return item; }
    if (!item || typeof item !== "object" || types.isProxy(item) || seen.has(item)) throw new Error("UNSAFE_TOOL_DATA");
    seen.add(item);
    try {
      if (Array.isArray(item)) {
        if (Object.getPrototypeOf(item) !== Array.prototype || item.length > 128) throw new Error("UNSAFE_TOOL_DATA");
        const descriptors = Object.getOwnPropertyDescriptors(item), keys = Reflect.ownKeys(descriptors);
        if (keys.length !== item.length + 1 || keys.some((key) => key !== "length" && (typeof key !== "string" ||
          !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= item.length || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable)) ) {
          throw new Error("UNSAFE_TOOL_DATA");
        }
        return Array.from({ length: item.length }, (_, index) => copy(descriptors[String(index)]!.value, depth + 1));
      }
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw new Error("UNSAFE_TOOL_DATA");
      const descriptors = Object.getOwnPropertyDescriptors(item), keys = Reflect.ownKeys(descriptors);
      if (keys.length > 256 || keys.some((key) => typeof key !== "string" || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable)) {
        throw new Error("UNSAFE_TOOL_DATA");
      }
      const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of keys as string[]) result[key] = copy(descriptors[key]!.value, depth + 1);
      return result;
    } finally { seen.delete(item); }
  };
  try { return copy(value, 0); } catch { return undefined; }
}

function ownData(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || types.isProxy(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}
function isProxyObject(value: unknown): boolean { return Boolean(value && typeof value === "object" && types.isProxy(value)); }

function characterOptionsError(error: unknown, fallback: OwnerSoulCharacterOptionsServiceErrorCode = "UPSTREAM_UNAVAILABLE"): CallToolResult {
  const code: OwnerSoulCharacterOptionsServiceErrorCode = error instanceof OwnerSoulCharacterOptionsServiceError
    ? error.code : error instanceof OwnerReferencePrincipalError ? "PRINCIPAL_NOT_LINKED" : fallback;
  const messages: Record<OwnerSoulCharacterOptionsServiceErrorCode, string> = {
    INVALID_REQUEST: "The Soul Character options request is invalid.", PRINCIPAL_NOT_LINKED: "A linked owner attempt is required.",
    MODEL_BINDING_MISMATCH: "The pinned Soul model is unavailable in the selected catalog.", SERVICE_BUSY: "The owner Soul Character reader is busy.",
    SERVICE_CLOSED: "The owner Soul Character reader is closed.", SNAPSHOT_SUPERSEDED: "A newer Soul Character list replaced this read.",
    CAPACITY_EXCEEDED: "The bounded owner Soul Character option capacity is full.", SOURCE_SNAPSHOT_INVALID: "The Soul Character list did not match the safe source shape.",
    OPTION_HANDLE_NOT_FOUND: "The Character option handle is unavailable for this owner attempt.", OPTION_HANDLE_EXPIRED: "The Character option handle expired.",
    UPSTREAM_UNAVAILABLE: "The owner Soul Character list could not be read.", UPSTREAM_TIMEOUT: "The owner Soul Character list request timed out.",
    UPSTREAM_REQUEST_ABORTED: "The owner Soul Character list request was cancelled.", UPSTREAM_PROTOCOL_ERROR: "The owner Soul Character list did not match the safe source shape."
  };
  const safeCode = (CHARACTER_ERROR_CODES as readonly string[]).includes(code) ? code : "UPSTREAM_UNAVAILABLE";
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code: safeCode, message: messages[safeCode as OwnerSoulCharacterOptionsServiceErrorCode] } }) }] };
}
