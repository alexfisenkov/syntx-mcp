import { types } from "node:util";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { OwnerWan25T2vGenerationResult } from "../application/owner-wan25-t2v-generation-service.js";
import { OWNER_WAN25_T2V_MODEL_ID, normalizeOwnerWan25T2vParameters } from "../application/owner-wan25-t2v-parameters.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY = /^wan25_t2v_recovery_[0-9a-f-]{36}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const ERROR_CODES = new Set([
  "INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "REQUEST_ABORTED", "CAPACITY_EXCEEDED", "CLOCK_INVALID",
  "PRINCIPAL_NOT_LINKED", "VALIDATION_REJECTED", "MODEL_BINDING_MISMATCH", "PREFLIGHT_FAILED", "SUBSCRIPTION_REQUIRED",
  "INTENT_ALREADY_CLAIMED", "CHAT_CREATE_OUTCOME_UNKNOWN", "GENERATION_OUTCOME_UNKNOWN", "ACK_UNVERIFIED",
  "PREFLIGHT_EXPIRED", "HISTORY_BINDING_MISMATCH", "HISTORY_INCOMPLETE", "OWNER_ECHO_UNVERIFIED", "RESULT_UNVERIFIED",
  "RESULT_CHANGED", "RESULT_PENDING_OR_UNVERIFIED", "RECOVERY_NOT_FOUND", "OPERATION_CONTEXT_INVALID",
  "OPERATION_NOT_DISPATCHED", "RESULT_CONTEXT_INVALID"
]);

export const OWNER_WAN25_T2V_TOOL_NAMES = Object.freeze([
  "syntx_owner_generate_wan25_t2v_video",
  "syntx_owner_get_wan25_t2v_result",
  "syntx_owner_list_wan25_t2v_recoveries"
] as const);

export interface OwnerWan25T2vToolOptions {
  readonly generationService: {
    generate(input: unknown, signal?: AbortSignal): Promise<OwnerWan25T2vGenerationResult | unknown>;
    reconcile(input: unknown, signal?: AbortSignal): Promise<OwnerWan25T2vGenerationResult | unknown>;
    listRecoveries(input: unknown, signal?: AbortSignal): Promise<readonly (OwnerWan25T2vGenerationResult | unknown)[]>;
  };
}

const attempt = z.string().regex(ATTEMPT);
const recoveryId = z.string().regex(RECOVERY);
const generateInput = z.object({
  link_attempt_id: attempt,
  model_id: z.literal(OWNER_WAN25_T2V_MODEL_ID),
  prompt: z.string().min(1).max(1500),
  resolution: z.enum(["480P", "720P", "1080P"]),
  aspect_ratio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"]),
  video_duration: z.union([z.literal(5), z.literal(10)]),
  prompt_extend: z.boolean(),
  seed: z.null()
}).strict().superRefine((value, context) => {
  if (!value.prompt.trim()) context.addIssue({ code: "custom", path: ["prompt"], message: "Prompt must not be blank." });
  if (value.resolution === "480P" && !["16:9", "9:16", "1:1"].includes(value.aspect_ratio)) {
    context.addIssue({ code: "custom", path: ["aspect_ratio"], message: "The selected ratio is not available at 480P." });
  }
  try {
    normalizeOwnerWan25T2vParameters({ model_id: value.model_id, prompt: value.prompt, resolution: value.resolution,
      aspect_ratio: value.aspect_ratio, video_duration: value.video_duration, prompt_extend: value.prompt_extend, seed: value.seed });
  } catch { context.addIssue({ code: "custom", path: [], message: "The explicit model settings are invalid." }); }
});
const resultInput = z.object({ link_attempt_id: attempt, recovery_id: recoveryId }).strict();
const listInput = z.object({ link_attempt_id: attempt }).strict();
const artifact = z.object({
  object_index: z.number().int().min(0).max(63), message_object_id: z.string().regex(ID), object_type: z.literal("video"),
  object_url: z.string().url().max(4096).refine(isSafeUploadReferenceUrl),
  mime_type: z.enum(["video/mp4", "video/quicktime"]).nullable(),
  message_id: z.string().regex(ID), chat_uuid: z.string().regex(ID), model_id: z.literal(OWNER_WAN25_T2V_MODEL_ID)
}).strict();
const generationOutput = z.object({
  status: z.enum(["completed", "outcome_unknown"]), recovery_id: recoveryId, model_id: z.literal(OWNER_WAN25_T2V_MODEL_ID),
  status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"), provider_terminal_status: z.literal("UNPROVEN"),
  backend_acceptance: z.literal("UNPROVEN"), cost_cap_enforced: z.literal(false), durability: z.literal("PROCESS_LOCAL_ONLY"),
  observed_artifact_count: z.number().int().min(0).max(64), artifacts: z.array(artifact).max(64),
  gaps: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u)).max(32)
}).strict().superRefine((value, context) => {
  if (value.artifacts.length !== value.observed_artifact_count ||
      value.artifacts.some((row, index) => row.object_index !== index || row.model_id !== value.model_id)) {
    context.addIssue({ code: "custom", path: ["artifacts"], message: "Artifacts must be contiguous and model-bound." });
  }
  const ids = new Set<string>(), urls = new Set<string>();
  value.artifacts.forEach((row, index) => {
    if (ids.has(row.message_object_id) || urls.has(row.object_url)) {
      context.addIssue({ code: "custom", path: ["artifacts", index], message: "Artifact IDs and URLs must be unique." });
    }
    ids.add(row.message_object_id); urls.add(row.object_url);
  });
  if ((value.status === "completed" && (value.artifacts.length === 0 || value.gaps.length !== 0)) ||
      (value.status === "outcome_unknown" && value.artifacts.length !== 0)) {
    context.addIssue({ code: "custom", path: ["status"], message: "Status must agree with the owned artifacts and gaps." });
  }
});
const recoveryListOutput = z.object({ recoveries: z.array(generationOutput).max(128) }).strict();

/** Registers default-off owner-local generation, GET-only reconciliation, and recovery listing. */
export function registerSyntxOwnerWan25T2vTools(server: McpServer, optionsInput: OwnerWan25T2vToolOptions | unknown): void {
  const options = snapshotOptions(optionsInput);
  server.registerTool(OWNER_WAN25_T2V_TOOL_NAMES[0], {
    title: "Generate a Wan 2.5 T2V video",
    description: "Starts one exact owner Wan 2.5 text-to-video generation with no media inputs. The fresh quote and balance check is affordability evidence, not a provider cost cap. Do not retry uncertain dispatch; use its GET-only recovery ID.",
    inputSchema: generateInput, outputSchema: generationOutput,
    annotations: { title: "Generate a Wan 2.5 T2V video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    try {
      const data = generateInput.parse(snapshotInput(input));
      const normalized = normalizeOwnerWan25T2vParameters({ model_id: data.model_id, prompt: data.prompt, resolution: data.resolution,
        aspect_ratio: data.aspect_ratio, video_duration: data.video_duration, prompt_extend: data.prompt_extend, seed: data.seed });
      const result = await options.generationService.generate({ attemptId: data.link_attempt_id, ...normalized.intent }, signal);
      return success(generationOutput, result, "OUTPUT_INVALID");
    } catch (error) { return safeError(error); }
  });

  server.registerTool(OWNER_WAN25_T2V_TOOL_NAMES[1], {
    title: "Get Wan 2.5 T2V result",
    description: "Read-only GET reconciliation for a process-local Wan 2.5 T2V recovery. It never repeats chat creation or generation.",
    inputSchema: resultInput, outputSchema: generationOutput,
    annotations: { title: "Get Wan 2.5 T2V result", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }) => {
    try {
      const data = resultInput.parse(snapshotInput(input));
      const result = await options.generationService.reconcile({ attemptId: data.link_attempt_id, recovery_id: data.recovery_id }, signal);
      return success(generationOutput, result, "OUTPUT_INVALID");
    } catch (error) { return safeError(error); }
  });

  server.registerTool(OWNER_WAN25_T2V_TOOL_NAMES[2], {
    title: "List Wan 2.5 T2V recoveries",
    description: "List this linked owner's bounded process-local Wan 2.5 T2V observations. No provider dispatch occurs.",
    inputSchema: listInput, outputSchema: recoveryListOutput,
    annotations: { title: "List Wan 2.5 T2V recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async input => {
    try {
      const data = listInput.parse(snapshotInput(input));
      const rows = await options.generationService.listRecoveries({ attemptId: data.link_attempt_id });
      return success(recoveryListOutput, { recoveries: rows }, "OUTPUT_INVALID");
    } catch (error) { return safeError(error); }
  });
}

function snapshotOptions(value: unknown): OwnerWan25T2vToolOptions {
  const row = snapshotInput(value);
  if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== 1 || !Object.hasOwn(row, "generationService")) {
    throw new Error("INVALID_OWNER_WAN25_T2V_TOOL_OPTIONS");
  }
  const generationService = (row as Record<string, unknown>).generationService;
  if (!validPort(generationService, ["generate", "reconcile", "listRecoveries"])) throw new Error("INVALID_OWNER_WAN25_T2V_TOOL_OPTIONS");
  return Object.freeze({ generationService: generationService as OwnerWan25T2vToolOptions["generationService"] });
}

function validPort(value: unknown, names: readonly string[]): boolean {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  for (const name of names) {
    let current: object | null = value, found = false;
    while (current) {
      const descriptor = Object.getOwnPropertyDescriptor(current, name);
      if (descriptor) {
        if (!("value" in descriptor) || typeof descriptor.value !== "function") return false;
        found = true; break;
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
    if (!found) return false;
  }
  return true;
}
function snapshotInput(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value), result = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string" || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true) return undefined;
      result[key] = descriptors[key]!.value;
    }
    return result;
  } catch { return undefined; }
}
function isSafeUploadReferenceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "r2.syntx.ai" && url.port === "" &&
      url.username === "" && url.password === "" && url.hash === "" && url.pathname !== "/";
  } catch { return false; }
}
function success<T extends z.ZodType>(schema: T, value: unknown, failureCode: string): CallToolResult {
  const parsed = schema.safeParse(value);
  return parsed.success ? { content: [{ type: "text", text: JSON.stringify(parsed.data) }], structuredContent: parsed.data as Record<string, unknown> }
    : errorResult(failureCode);
}
function safeError(value: unknown): CallToolResult {
  let code = "INVALID_REQUEST";
  if (value && typeof value === "object" && !types.isProxy(value)) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, "code");
      if (descriptor && "value" in descriptor && typeof descriptor.value === "string" && ERROR_CODES.has(descriptor.value)) code = descriptor.value;
    } catch { /* sanitized fallback */ }
  }
  const recovery = recoveryFrom(value);
  return errorResult(code, recovery);
}
function recoveryFrom(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || types.isProxy(value)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "recovery_id");
    return descriptor && "value" in descriptor && recoveryId.safeParse(descriptor.value).success ? descriptor.value as string : undefined;
  } catch { return undefined; }
}
function errorResult(code: string, recoveryIdValue?: string): CallToolResult {
  const unknown = code.includes("UNKNOWN") || code === "RESULT_PENDING_OR_UNVERIFIED";
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code,
    message: unknown ? "The generation result may be unknown. Do not retry generation; use the GET-only recovery tool."
      : "The owner Wan 2.5 T2V operation could not be completed safely.",
    ...(recoveryIdValue === undefined ? {} : { recovery_id: recoveryIdValue }) } }) }] };
}
