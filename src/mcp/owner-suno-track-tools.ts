import { types } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import {
  isOwnerSunoGenerationService,
  OwnerSunoGenerationServiceError,
  type OwnerSunoGenerationService,
  type OwnerSunoTrackInputList
} from "../application/owner-suno-generation-service.js";

export const SYNTX_OWNER_LIST_SUNO_TRACK_INPUTS_TOOL_NAME = "syntx_owner_list_suno_track_inputs" as const;

const attemptIdSchema = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const recoveryIdSchema = z.string().regex(/^suno_generation_recovery_[0-9a-f-]{36}$/u);
const trackSchema = z.object({
  track_handle: z.string().regex(/^track_[0-9a-f-]{36}$/u),
  model_id: z.enum(["V6", "V6_wild"]),
  expires_in_seconds: z.number().int().min(1).max(1_800)
}).strict();
const outputSchema = z.object({
  recovery_id: recoveryIdSchema,
  status: z.enum(["AVAILABLE", "UNAVAILABLE"]),
  unavailable_reason: z.enum(["TRACK_METADATA_UNAVAILABLE", "TRACK_INPUT_CAPACITY_REACHED"]).optional(),
  tracks: z.array(trackSchema).max(128)
}).strict().superRefine((value, context) => {
  if (value.status === "AVAILABLE" && (value.tracks.length === 0 ||
      (value.unavailable_reason !== undefined && value.unavailable_reason !== "TRACK_INPUT_CAPACITY_REACHED"))) {
    context.addIssue({ code: "custom", path: ["tracks"], message: "Available track inputs require at least one handle and only allow a capacity notice." });
  }
  if (value.status === "UNAVAILABLE" && (value.tracks.length !== 0 || value.unavailable_reason === undefined)) {
    context.addIssue({ code: "custom", path: ["tracks"], message: "Unavailable track inputs require an empty list and a fixed reason." });
  }
});
const inputSchema = z.object({ link_attempt_id: attemptIdSchema, recovery_id: recoveryIdSchema }).strict();

export interface RegisterSyntxOwnerSunoTrackToolsOptions {
  readonly generationService: OwnerSunoGenerationService;
}

/** Registers one additional default-off read-only Suno metadata-handle tool. */
export function registerSyntxOwnerSunoTrackTools(server: McpServer, optionsInput: unknown): void {
  const options = snapshotOptions(optionsInput);
  server.registerTool(SYNTX_OWNER_LIST_SUNO_TRACK_INPUTS_TOOL_NAME, {
    title: "List available Suno track inputs",
    description: "Lists bounded opaque handles derived from already-observed owner Suno results. The response contains no provider IDs, URLs, prompts, or account data; this read-only call performs no upstream request or generation.",
    inputSchema,
    outputSchema,
    annotations: { title: "List Suno track inputs", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input): Promise<CallToolResult> => {
    const parsed = inputSchema.safeParse(snapshotSafeInput(input));
    if (!parsed.success) return errorResult("INVALID_REQUEST");
    try {
      const output = parseOutput(await options.generationService.listTrackInputs({
        attemptId: parsed.data.link_attempt_id,
        recovery_id: parsed.data.recovery_id
      }));
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output as unknown as Record<string, unknown> };
    } catch (error) { return errorResult(safeErrorCode(error)); }
  });
}

function snapshotOptions(value: unknown): RegisterSyntxOwnerSunoTrackToolsOptions {
  const fields = readExactRecord(value, ["generationService"]);
  if (!isOwnerSunoGenerationService(fields.generationService)) throw new Error("SUNO_TRACK_SERVICE_COMPOSITION_INVALID");
  return Object.freeze({ generationService: fields.generationService });
}

function readExactRecord(value: unknown, expected: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) throw new TypeError("INVALID_RECORD");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("INVALID_RECORD");
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !expected.includes(key) || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) {
      throw new TypeError("INVALID_RECORD");
    }
    result[key] = descriptors[key]!.value;
  }
  if (expected.some((key) => !Object.hasOwn(result, key))) throw new TypeError("INVALID_RECORD");
  return result;
}

function snapshotSafeInput(value: unknown): unknown {
  try { return snapshotJson(value, 0, { nodes: 0 }); } catch { return undefined; }
}

function snapshotJson(value: unknown, depth: number, budget: { nodes: number }): unknown {
  budget.nodes += 1;
  if (budget.nodes > 10_000 || depth > 24) throw new TypeError("INVALID_INPUT");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new TypeError("INVALID_INPUT"); return value; }
  if (!value || typeof value !== "object" || types.isProxy(value)) throw new TypeError("INVALID_INPUT");
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError("INVALID_INPUT");
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" && (typeof key !== "string" ||
        !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable))) {
      throw new TypeError("INVALID_INPUT");
    }
    return Array.from({ length: value.length }, (_, index) => {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError("INVALID_INPUT");
      return snapshotJson(descriptor.value, depth + 1, budget);
    });
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("INVALID_INPUT");
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) throw new TypeError("INVALID_INPUT");
    Object.defineProperty(result, key, { value: snapshotJson(descriptors[key]!.value, depth + 1, budget), enumerable: true });
  }
  return result;
}

function parseOutput(value: unknown): OwnerSunoTrackInputList {
  const snapshot = snapshotSafeInput(value);
  const parsed = outputSchema.safeParse(snapshot);
  if (!parsed.success) throw new TypeError("SUNO_TRACK_OUTPUT_SHAPE_INVALID");
  const { unavailable_reason, ...output } = parsed.data;
  return Object.freeze({ ...output,
    ...(unavailable_reason === undefined ? {} : { unavailable_reason }),
    tracks: Object.freeze(output.tracks.map((track) => Object.freeze(track))) });
}

type SafeErrorCode = "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "PRINCIPAL_NOT_LINKED" | "RECOVERY_NOT_FOUND";
const SAFE_ERROR_CODES = new Set<SafeErrorCode>(["INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "RECOVERY_NOT_FOUND"]);
const ERROR_MESSAGES: Readonly<Record<SafeErrorCode, string>> = Object.freeze({
  INVALID_REQUEST: "The Suno track-input request is invalid.",
  SERVICE_CLOSED: "The owner Suno service is closed.",
  SERVICE_BUSY: "The owner Suno service is busy.",
  PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.",
  RECOVERY_NOT_FOUND: "The Suno recovery is unavailable or expired."
});

function safeErrorCode(error: unknown): SafeErrorCode {
  if (!error || typeof error !== "object" || types.isProxy(error) || !(error instanceof OwnerSunoGenerationServiceError)) return "SERVICE_BUSY";
  {
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    if (descriptor && "value" in descriptor && SAFE_ERROR_CODES.has(descriptor.value as SafeErrorCode)) {
      return descriptor.value as SafeErrorCode;
    }
  }
  return "SERVICE_BUSY";
}

function errorResult(code: SafeErrorCode): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message: ERROR_MESSAGES[code] } }) }] };
}
