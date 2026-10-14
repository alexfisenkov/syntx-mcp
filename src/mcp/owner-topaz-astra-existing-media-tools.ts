import { types } from "node:util";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OwnerTopazAstraExistingMediaService, OwnerTopazAstraExistingMediaServiceError,
  isOwnerTopazAstraExistingMediaService,
  type OwnerTopazAstraExistingMediaServiceErrorCode } from "../application/owner-topaz-astra-existing-media-service.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u, HANDLE = /^existing_topaz_astra_[0-9a-f-]{36}$/u;
const MODELS = ["slc-1", "slf-2", "slp-2", "slp-2.5"] as const;
const LIST = OwnerTopazAstraExistingMediaService.prototype.listExistingResults;
const GET = OwnerTopazAstraExistingMediaService.prototype.getExistingResult;
const attempt = z.string().regex(ATTEMPT).describe("Exact current owner-link attempt.");
const listInput = z.object({ link_attempt_id: attempt, page: z.number().int().min(1).max(100).optional() }).strict();
const getInput = z.object({ link_attempt_id: attempt, result_handle: z.string().regex(HANDLE) }).strict();
const proof = z.object({ owner: z.literal("CURRENT_LINK_REVALIDATED"), index: z.literal("CURRENT_OWNER_TOPAZ_ASTRA_INDEX_AND_TITLE"),
  history: z.literal("COMPLETE_UNIQUE_OWNER_ACK_AND_BOT_VIDEO_RESULT"), model: z.literal("MATCHED_TOPAZ_ASTRA_ALLOWLIST"),
  result: z.literal("COMPLETED_EXACT_MP4_VIDEO_OBJECT"), source_provenance: z.literal("NOT_AVAILABLE"),
  provider_terminal_status: z.literal("UNPROVEN") }).strict();
const listOutput = z.object({ page: z.number().int().min(1).max(100), page_size: z.literal(20), total_count: z.number().int().min(0),
  total_pages: z.number().int().min(0), has_next: z.boolean(), has_previous: z.boolean(), results: z.array(z.object({
    result_handle: z.string().regex(HANDLE), expires_in_seconds: z.number().int().min(0).max(900), model_id: z.enum(MODELS), proof
  }).strict()).max(20) }).strict();
const getOutput = z.object({ model_id: z.enum(MODELS), object_url: z.string().url().max(4096).refine(isSafeOutputUrl),
  mime_type: z.literal("video/mp4"), output_identity: z.literal("UNHASHED_URL_REFERENCE"), proof }).strict();

export const SYNTX_OWNER_LIST_EXISTING_TOPAZ_ASTRA_RESULTS_TOOL_NAME = "syntx_owner_list_existing_topaz_astra_results" as const;
export const SYNTX_OWNER_GET_EXISTING_TOPAZ_ASTRA_RESULT_TOOL_NAME = "syntx_owner_get_existing_topaz_astra_result" as const;
export const OWNER_TOPAZ_ASTRA_EXISTING_MEDIA_TOOL_NAMES = Object.freeze([
  SYNTX_OWNER_LIST_EXISTING_TOPAZ_ASTRA_RESULTS_TOOL_NAME, SYNTX_OWNER_GET_EXISTING_TOPAZ_ASTRA_RESULT_TOOL_NAME
] as const);
const ERRORS: Readonly<Record<OwnerTopazAstraExistingMediaServiceErrorCode, string>> = Object.freeze({
  INVALID_REQUEST: "The existing Topaz Astra read request is invalid.", SERVICE_CLOSED: "The existing Topaz Astra reader is closed.",
  SERVICE_BUSY: "The existing Topaz Astra reader is busy.", PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.",
  INDEX_UNAVAILABLE: "The owner Topaz Astra result index could not be verified.", HISTORY_UNAVAILABLE: "The owner Topaz Astra result history could not be verified.",
  RESULT_UNAVAILABLE: "The owner Topaz Astra result could not be verified.", RESULT_HANDLE_EXPIRED: "The existing Topaz Astra result handle expired or is unavailable.",
  CAPACITY_EXCEEDED: "The existing Topaz Astra result reader is at capacity.", REQUEST_ABORTED: "The existing Topaz Astra read request was cancelled."
});

/** Registers only GET-backed reads of already-existing owner Topaz Astra outputs. */
export function registerSyntxOwnerTopazAstraExistingMediaTools(server: McpServer, serviceInput: unknown): void {
  const service = exactService(serviceInput);
  server.registerTool(SYNTX_OWNER_LIST_EXISTING_TOPAZ_ASTRA_RESULTS_TOOL_NAME, { title: "List existing Topaz Astra results",
    description: "Reads verified results from the current owner's existing Topaz Astra history. It never uploads, generates, or replays a request.",
    inputSchema: listInput, outputSchema: listOutput,
    annotations: { title: "List existing Topaz Astra results", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = listInput.safeParse(snapshot(input)); if (!parsed.success) return errorResult("INVALID_REQUEST");
    try { return structured(listOutput, await service.listExistingResults({ attemptId: parsed.data.link_attempt_id, page: parsed.data.page ?? 1 }, signal)); }
    catch (error) { return errorResult(errorCode(error)); }
  });
  server.registerTool(SYNTX_OWNER_GET_EXISTING_TOPAZ_ASTRA_RESULT_TOOL_NAME, { title: "Get existing Topaz Astra result",
    description: "Revalidates and reads one exact existing Topaz Astra output using its short-lived opaque result handle.",
    inputSchema: getInput, outputSchema: getOutput,
    annotations: { title: "Get existing Topaz Astra result", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = getInput.safeParse(snapshot(input)); if (!parsed.success) return errorResult("INVALID_REQUEST");
    try { return structured(getOutput, await service.getExistingResult({ attemptId: parsed.data.link_attempt_id, result_handle: parsed.data.result_handle }, signal)); }
    catch (error) { return errorResult(errorCode(error)); }
  });
}

function exactService(value: unknown): OwnerTopazAstraExistingMediaService {
  if (!value || typeof value !== "object" || types.isProxy(value) || !isOwnerTopazAstraExistingMediaService(value) ||
      Object.hasOwn(value, "listExistingResults") || Object.hasOwn(value, "getExistingResult") ||
      Reflect.get(value, "listExistingResults") !== LIST || Reflect.get(value, "getExistingResult") !== GET) {
    throw new Error("TOPAZ_ASTRA_EXISTING_MEDIA_SERVICE_COMPOSITION_INVALID");
  }
  return value;
}
function errorCode(error: unknown): OwnerTopazAstraExistingMediaServiceErrorCode {
  return error instanceof OwnerTopazAstraExistingMediaServiceError && Object.hasOwn(ERRORS, error.code) ? error.code : "RESULT_UNAVAILABLE";
}
function snapshot(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return undefined;
  try { const descriptors = Object.getOwnPropertyDescriptors(value), copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) { if (typeof key !== "string" || !("value" in descriptors[key]!)) return undefined; copy[key] = descriptors[key]!.value; }
    return copy;
  } catch { return undefined; }
}
function structured<T extends z.ZodType>(schema: T, value: unknown): CallToolResult {
  const parsed = schema.safeParse(value); if (!parsed.success) return errorResult("RESULT_UNAVAILABLE");
  return { content: [{ type: "text", text: JSON.stringify(parsed.data) }], structuredContent: parsed.data as Record<string, unknown> };
}
function errorResult(code: OwnerTopazAstraExistingMediaServiceErrorCode | "INVALID_REQUEST"): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message: ERRORS[code] } }) }] };
}
function isSafeOutputUrl(input: string): boolean {
  try { const url = new URL(input); return url.protocol === "https:" && url.hostname === "r2.syntx.ai" && !url.port && !url.username &&
    !url.password && !url.hash && url.pathname.toLowerCase().endsWith(".mp4"); } catch { return false; }
}
