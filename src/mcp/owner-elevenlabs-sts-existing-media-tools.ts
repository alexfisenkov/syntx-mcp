import { types } from "node:util";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OwnerElevenLabsStsExistingMediaService, OwnerElevenLabsStsExistingMediaServiceError,
  type OwnerElevenLabsStsExistingMediaServiceErrorCode } from "../application/owner-elevenlabs-sts-existing-media-service.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RESULT_HANDLE = /^existing_elevenlabs_sts_[0-9a-f-]{36}$/u;
const LIST_EXISTING = OwnerElevenLabsStsExistingMediaService.prototype.listExistingResults;
const GET_EXISTING = OwnerElevenLabsStsExistingMediaService.prototype.getExistingResult;
const attemptSchema = z.string().regex(ATTEMPT).describe("Exact current owner-link attempt.");
const listInput = z.object({ link_attempt_id: attemptSchema, page: z.number().int().min(1).max(100).optional() }).strict();
const getInput = z.object({ link_attempt_id: attemptSchema, result_handle: z.string().regex(RESULT_HANDLE) }).strict();
const proofSchema = z.object({ owner: z.literal("CURRENT_LINK_REVALIDATED"),
  index: z.literal("CURRENT_OWNER_AUDIO_INDEX_AND_STS_TITLE"),
  history: z.literal("COMPLETE_UNIQUE_OWNER_ACK_AND_BOT_RESULT"), model: z.literal("MATCHED_ELEVENLABS_STS_V2"),
  result: z.literal("COMPLETED_EXACT_AUDIO_OBJECT"), source_provenance: z.literal("NOT_AVAILABLE"),
  provider_terminal_status: z.literal("UNPROVEN") }).strict();
const listOutput = z.object({ page: z.number().int().min(1).max(100), page_size: z.literal(20), total_count: z.number().int().min(0),
  total_pages: z.number().int().min(0), has_next: z.boolean(), has_previous: z.boolean(), results: z.array(z.object({
    result_handle: z.string().regex(RESULT_HANDLE), expires_in_seconds: z.number().int().min(0).max(900),
    model_id: z.literal("eleven_multilingual_sts_v2"), proof: proofSchema }).strict()).max(20) }).strict();
const getOutput = z.object({ model_id: z.literal("eleven_multilingual_sts_v2"), object_url: z.string().url().max(4096)
  .refine(isSafeOutputUrl), mime_type: z.literal("audio/mpeg"), output_identity: z.literal("UNHASHED_URL_REFERENCE"), proof: proofSchema }).strict();

export const SYNTX_OWNER_LIST_EXISTING_ELEVENLABS_STS_RESULTS_TOOL_NAME =
  "syntx_owner_list_existing_elevenlabs_sts_results" as const;
export const SYNTX_OWNER_GET_EXISTING_ELEVENLABS_STS_RESULT_TOOL_NAME =
  "syntx_owner_get_existing_elevenlabs_sts_result" as const;
export const OWNER_ELEVENLABS_STS_EXISTING_MEDIA_TOOL_NAMES = Object.freeze([
  SYNTX_OWNER_LIST_EXISTING_ELEVENLABS_STS_RESULTS_TOOL_NAME,
  SYNTX_OWNER_GET_EXISTING_ELEVENLABS_STS_RESULT_TOOL_NAME
] as const);

const ERROR_MESSAGES: Readonly<Record<OwnerElevenLabsStsExistingMediaServiceErrorCode, string>> = Object.freeze({
  INVALID_REQUEST: "The existing ElevenLabs STS read request is invalid.",
  SERVICE_CLOSED: "The existing ElevenLabs STS reader is closed.",
  SERVICE_BUSY: "The existing ElevenLabs STS reader is busy.",
  PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.",
  INDEX_UNAVAILABLE: "The owner STS result index could not be verified.",
  HISTORY_UNAVAILABLE: "The owner STS result history could not be verified.",
  RESULT_UNAVAILABLE: "The owner STS result could not be verified.",
  RESULT_HANDLE_EXPIRED: "The existing STS result handle expired or is unavailable.",
  CAPACITY_EXCEEDED: "The existing STS result reader is at capacity.",
  REQUEST_ABORTED: "The existing STS read request was cancelled."
});

/** Registers only GET-backed reads of existing, independently verified owner STS outputs. */
export function registerSyntxOwnerElevenLabsStsExistingMediaTools(server: McpServer, serviceInput: unknown): void {
  const service = exactService(serviceInput);
  server.registerTool(SYNTX_OWNER_LIST_EXISTING_ELEVENLABS_STS_RESULTS_TOOL_NAME, {
    title: "List existing ElevenLabs STS results",
    description: "Reads verified results from the current owner's existing ElevenLabs STS history. It never uploads, generates, or replays a request.",
    inputSchema: listInput, outputSchema: listOutput,
    annotations: { title: "List existing STS results", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = listInput.safeParse(snapshotInput(input));
    if (!parsed.success) return errorResult("INVALID_REQUEST");
    try {
      const value = await service.listExistingResults({ attemptId: parsed.data.link_attempt_id, page: parsed.data.page ?? 1 }, signal);
      return structured(listOutput, value);
    } catch (error) { return errorResult(errorCode(error)); }
  });
  server.registerTool(SYNTX_OWNER_GET_EXISTING_ELEVENLABS_STS_RESULT_TOOL_NAME, {
    title: "Get existing ElevenLabs STS result",
    description: "Revalidates and reads one exact output from the current owner's existing STS history using its short-lived opaque result handle.",
    inputSchema: getInput, outputSchema: getOutput,
    annotations: { title: "Get existing STS result", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = getInput.safeParse(snapshotInput(input));
    if (!parsed.success) return errorResult("INVALID_REQUEST");
    try {
      const value = await service.getExistingResult({ attemptId: parsed.data.link_attempt_id, result_handle: parsed.data.result_handle }, signal);
      return structured(getOutput, value);
    } catch (error) { return errorResult(errorCode(error)); }
  });
}

function exactService(value: unknown): OwnerElevenLabsStsExistingMediaService {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== OwnerElevenLabsStsExistingMediaService.prototype ||
      Object.hasOwn(value, "listExistingResults") || Object.hasOwn(value, "getExistingResult") ||
      Reflect.get(value, "listExistingResults") !== LIST_EXISTING || Reflect.get(value, "getExistingResult") !== GET_EXISTING) {
    throw new Error("ELEVENLABS_STS_EXISTING_MEDIA_SERVICE_COMPOSITION_INVALID");
  }
  return value as OwnerElevenLabsStsExistingMediaService;
}
function errorCode(error: unknown): OwnerElevenLabsStsExistingMediaServiceErrorCode {
  return error instanceof OwnerElevenLabsStsExistingMediaServiceError && Object.hasOwn(ERROR_MESSAGES, error.code) ? error.code : "RESULT_UNAVAILABLE";
}
function snapshotInput(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return undefined;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string" || !("value" in descriptors[key]!)) return undefined;
      result[key] = descriptors[key]!.value;
    }
    return result;
  } catch { return undefined; }
}
function structured<T extends z.ZodType>(schema: T, value: unknown): CallToolResult {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return errorResult("RESULT_UNAVAILABLE");
  const content = JSON.stringify(parsed.data);
  return { content: [{ type: "text", text: content }], structuredContent: parsed.data as Record<string, unknown> };
}
function errorResult(code: OwnerElevenLabsStsExistingMediaServiceErrorCode | "INVALID_REQUEST"): CallToolResult {
  const message = ERROR_MESSAGES[code];
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message } }) }] };
}
function isSafeOutputUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === "https:" && url.hostname === "r2.syntx.ai" && !url.port && !url.username && !url.password &&
      !url.hash && url.pathname.toLowerCase().endsWith(".mp3");
  } catch { return false; }
}
