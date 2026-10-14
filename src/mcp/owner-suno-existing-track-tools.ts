import { types } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import {
  isOwnerSunoGenerationService
} from "../application/owner-suno-generation-service.js";
import type { OwnerSunoGenerationService } from "../application/owner-suno-generation-service.js";
import {
  OwnerSunoExistingTrackServiceError,
  type OwnerSunoExistingTrackInputList
} from "../application/owner-suno-existing-track-service.js";

export const SYNTX_OWNER_LIST_EXISTING_SUNO_TRACKS_TOOL_NAME = "syntx_owner_list_existing_suno_tracks" as const;
export const OWNER_SUNO_EXISTING_TRACK_TOOL_NAMES = Object.freeze([
  SYNTX_OWNER_LIST_EXISTING_SUNO_TRACKS_TOOL_NAME
] as const);

const attemptIdSchema = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u)
  .describe("Exact currently linked owner attempt to browse.");
const inputSchema = z.object({
  link_attempt_id: attemptIdSchema,
  page: z.number().int().min(1).max(100).optional().default(1)
    .describe("One bounded page of existing owner Suno tracks; defaults to page 1 (maximum page 100).")
}).strict();

const trackSchema = z.object({
  track_handle: z.string().regex(/^track_[0-9a-f-]{36}$/u),
  model_id: z.enum(["V6", "V6_wild"]),
  expires_in_seconds: z.number().int().min(1).max(1_800),
  artifact: z.object({
    url: z.string().url().max(4_096).refine(isSafeUploadReferenceUrl),
    mime_type: z.enum(["audio/mpeg", "audio/wav", "audio/mp4"]).nullable()
  }).strict()
}).strict();
const outputSchema = z.object({
  status: z.enum(["AVAILABLE", "UNAVAILABLE"]),
  page: z.number().int().min(1).max(100),
  page_size: z.literal(20),
  total_count: z.number().int().min(0).max(2_000_000),
  total_pages: z.number().int().min(0).max(100_000),
  has_next: z.boolean(),
  has_previous: z.boolean(),
  unavailable_reason: z.enum(["NO_TRACKS_AVAILABLE", "TRACK_INPUT_CAPACITY_REACHED"]).optional(),
  tracks: z.array(trackSchema).max(128)
}).strict().superRefine((output, context) => {
  if (output.status === "AVAILABLE" && output.tracks.length === 0) {
    context.addIssue({ code: "custom", path: ["tracks"], message: "Available pages must contain at least one track." });
  }
  if (output.status === "UNAVAILABLE" && (output.tracks.length !== 0 || output.unavailable_reason === undefined)) {
    context.addIssue({ code: "custom", path: ["tracks"], message: "Unavailable pages must include an observed safe reason." });
  }
  if (output.unavailable_reason === "NO_TRACKS_AVAILABLE" && output.status !== "UNAVAILABLE") {
    context.addIssue({ code: "custom", path: ["unavailable_reason"], message: "Empty-page reason requires unavailable status." });
  }
});

export const OWNER_SUNO_EXISTING_TRACK_TOOL_INPUT_SCHEMA = inputSchema;
export const OWNER_SUNO_EXISTING_TRACK_TOOL_OUTPUT_SCHEMA = outputSchema;

export interface RegisterSyntxOwnerSunoExistingTrackToolsOptions {
  readonly generationService: Pick<OwnerSunoGenerationService, "listExistingTracks">;
}

/** Adds one bounded GET-only browse tool to the existing owner Suno opt-in. */
export function registerSyntxOwnerSunoExistingTrackTools(server: McpServer, optionsInput: unknown): void {
  const options = snapshotOptions(optionsInput);
  server.registerTool(SYNTX_OWNER_LIST_EXISTING_SUNO_TRACKS_TOOL_NAME, {
    title: "List existing owner Suno tracks",
    description: "Lists one bounded page of existing Suno results from recognized MCP generation and track-operation chats in the currently linked owner's account. Returns opaque handles and each track's exact associated R2 audio artifact; this read-only browse performs GET requests only and never uploads, checks account or quote data, or generates audio.",
    inputSchema,
    outputSchema,
    annotations: { title: "List existing owner Suno tracks", readOnlyHint: true, destructiveHint: false,
      idempotentHint: true, openWorldHint: true }
  }, async (rawInput, { signal }): Promise<CallToolResult> => {
    const parsed = inputSchema.safeParse(snapshotSafeInput(rawInput));
    if (!parsed.success) return errorResult("INVALID_REQUEST");
    let value: OwnerSunoExistingTrackInputList;
    try {
      value = await options.generationService.listExistingTracks({
        attemptId: parsed.data.link_attempt_id,
        page: parsed.data.page
      }, signal);
    } catch (error) {
      return errorResult(safeErrorCode(error));
    }
    const output = outputSchema.safeParse(snapshotSafeInput(value));
    if (!output.success) return errorResult("SERVICE_BUSY");
    const safeOutput = output.data;
    return { content: [{ type: "text", text: JSON.stringify(safeOutput) }],
      structuredContent: safeOutput as unknown as Record<string, unknown> };
  });
}

function snapshotOptions(value: unknown): RegisterSyntxOwnerSunoExistingTrackToolsOptions {
  const fields = exactRecord(value, ["generationService"]);
  if (!isOwnerSunoGenerationService(fields.generationService)) throw new Error("SUNO_EXISTING_TRACK_SERVICE_COMPOSITION_INVALID");
  return Object.freeze({ generationService: fields.generationService });
}

function exactRecord(value: unknown, expected: readonly string[]): Record<string, unknown> {
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

type SafeErrorCode = "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "PRINCIPAL_NOT_LINKED" |
  "INDEX_UNAVAILABLE" | "HISTORY_UNAVAILABLE" | "RESULT_UNAVAILABLE" | "TRACK_CONTEXT_UNAVAILABLE" |
  "CAPACITY_EXCEEDED" | "REQUEST_ABORTED";
const SAFE_ERROR_CODES = new Set<SafeErrorCode>(["INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED",
  "INDEX_UNAVAILABLE", "HISTORY_UNAVAILABLE", "RESULT_UNAVAILABLE", "TRACK_CONTEXT_UNAVAILABLE", "CAPACITY_EXCEEDED", "REQUEST_ABORTED"]);
const ERROR_MESSAGES: Readonly<Record<SafeErrorCode, string>> = Object.freeze({
  INVALID_REQUEST: "The existing Suno track request is invalid.",
  SERVICE_CLOSED: "The owner Suno service is closed.",
  SERVICE_BUSY: "The owner Suno service is busy.",
  PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.",
  INDEX_UNAVAILABLE: "The owner Suno track index is unavailable.",
  HISTORY_UNAVAILABLE: "The owner Suno track history is unavailable.",
  RESULT_UNAVAILABLE: "The owner Suno track result is unavailable.",
  TRACK_CONTEXT_UNAVAILABLE: "The owner Suno track context is unavailable.",
  CAPACITY_EXCEEDED: "The owner Suno track service is at capacity.",
  REQUEST_ABORTED: "The owner Suno track request was aborted."
});

function safeErrorCode(error: unknown): SafeErrorCode {
  if (!error || typeof error !== "object" || types.isProxy(error) || !(error instanceof OwnerSunoExistingTrackServiceError)) return "SERVICE_BUSY";
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  return descriptor && "value" in descriptor && SAFE_ERROR_CODES.has(descriptor.value as SafeErrorCode)
    ? descriptor.value as SafeErrorCode : "SERVICE_BUSY";
}

function errorResult(code: SafeErrorCode): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message: ERROR_MESSAGES[code] } }) }] };
}
