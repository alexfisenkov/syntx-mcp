import { types } from "node:util";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OwnerElevenLabsVoiceReferenceService, OwnerElevenLabsVoiceReferenceServiceError,
  type OwnerElevenLabsVoiceReferenceServiceErrorCode } from "../application/owner-elevenlabs-voice-reference-service.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const VOICE_REF = /^owner_elevenlabs_voice_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const NATIVE_LIST_VOICES = OwnerElevenLabsVoiceReferenceService.prototype.listVoices;
const attemptSchema = z.string().regex(ATTEMPT).describe("Exact current owner-link attempt; it cannot select another account.");

export const SYNTX_OWNER_LIST_ELEVENLABS_VOICE_REFERENCES_TOOL_NAME = "syntx_owner_list_elevenlabs_voice_references" as const;
export const OWNER_ELEVENLABS_VOICE_LIST_INPUT_SCHEMA = z.object({ link_attempt_id: attemptSchema }).strict();
export const OWNER_ELEVENLABS_VOICE_LIST_OUTPUT_SCHEMA = z.object({
  status: z.literal("available"), page: z.literal(1), page_size: z.literal(10), total: z.number().int().nonnegative().nullable(),
  has_more: z.boolean().nullable(), coverage: z.literal("PARTIAL_PAGE_ONLY"), source_confidence: z.literal("CURRENT_SOURCE_ROUTE"),
  ownership_confidence: z.literal("UNPROVEN"),
  voices: z.array(z.object({ voice_ref: z.string().regex(VOICE_REF), name: z.string().min(1).max(256),
    expires_in_seconds: z.number().int().min(0).max(900) }).strict()).max(10)
}).strict();

const VOICE_MESSAGES: Record<OwnerElevenLabsVoiceReferenceServiceErrorCode, string> = {
  INVALID_REQUEST: "The voice-reference request is invalid.", PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.",
  NATIVE_CLIENT_INVALID: "The native voice-list client is unavailable.", VOICE_LIST_UNAVAILABLE: "The owner voice list is unavailable.",
  VOICE_REFERENCE_UNAVAILABLE: "The opaque voice reference is unavailable.", VOICE_REFERENCE_EXPIRED: "The opaque voice reference has expired.",
  SERVICE_BUSY: "The owner voice-reference service is busy.", CAPACITY_EXCEEDED: "The owner voice-reference capacity is full.",
  SERVICE_CLOSED: "The owner voice-reference service is closed.", REQUEST_ABORTED: "The voice-reference request was cancelled."
};

export function isOwnerElevenLabsVoiceReferenceService(value: unknown): value is OwnerElevenLabsVoiceReferenceService {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== OwnerElevenLabsVoiceReferenceService.prototype) return false;
  return Object.getOwnPropertyDescriptor(OwnerElevenLabsVoiceReferenceService.prototype, "listVoices")?.value === NATIVE_LIST_VOICES &&
    !Object.hasOwn(value, "listVoices");
}

export function registerSyntxOwnerElevenLabsVoiceTools(server: McpServer, serviceInput: unknown): void {
  if (!isOwnerElevenLabsVoiceReferenceService(serviceInput)) throw new Error("ELEVENLABS_VOICE_SERVICE_COMPOSITION_INVALID");
  const service = serviceInput;
  server.registerTool(SYNTX_OWNER_LIST_ELEVENLABS_VOICE_REFERENCES_TOOL_NAME, {
    title: "List owner ElevenLabs voice references", description: "Lists one bounded owner-authorized page. Returns expiring opaque references and display names, never provider voice IDs or preview URLs.",
    inputSchema: OWNER_ELEVENLABS_VOICE_LIST_INPUT_SCHEMA, outputSchema: OWNER_ELEVENLABS_VOICE_LIST_OUTPUT_SCHEMA,
    annotations: { title: "List ElevenLabs voice references", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }) => {
    const parsed = OWNER_ELEVENLABS_VOICE_LIST_INPUT_SCHEMA.safeParse(snapshotSafeInput(input));
    if (!parsed.success) return voiceErrorResult(undefined, "INVALID_REQUEST");
    try {
      const result = await service.listVoices({ attemptId: parsed.data.link_attempt_id, signal });
      const safe = { ...result, voices: result.voices.map(({ voice_ref, name, expires_in_seconds }) => ({ voice_ref, name, expires_in_seconds })) };
      return structured(parseOutput(OWNER_ELEVENLABS_VOICE_LIST_OUTPUT_SCHEMA, safe));
    } catch (error) { return voiceErrorResult(error, "VOICE_LIST_UNAVAILABLE"); }
  });
}

function voiceErrorResult(error: unknown, fallback: OwnerElevenLabsVoiceReferenceServiceErrorCode): CallToolResult {
  const code = isVoiceError(error) && Object.hasOwn(VOICE_MESSAGES, ownData(error, "code") as string)
    ? ownData(error, "code") as OwnerElevenLabsVoiceReferenceServiceErrorCode : fallback;
  return errorResult({ error: { code, message: VOICE_MESSAGES[code] } });
}
function isVoiceError(value: unknown): value is OwnerElevenLabsVoiceReferenceServiceError {
  return Boolean(value) && typeof value === "object" && !types.isProxy(value) && value instanceof OwnerElevenLabsVoiceReferenceServiceError;
}
function ownData(value: object, key: string): unknown { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && "value" in descriptor ? descriptor.value : undefined; }
function snapshotSafeInput(value: unknown): unknown { try { return snapshotJson(value, 0, { nodes: 0 }); } catch { return undefined; } }
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
        !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable))) throw new TypeError("invalid array");
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)]; if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError("invalid item");
      result.push(snapshotJson(descriptor.value, depth + 1, budget));
    }
    return result;
  }
  const prototype = Object.getPrototypeOf(value); if (prototype !== Object.prototype && prototype !== null) throw new TypeError("invalid record");
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) throw new TypeError("invalid field");
    Object.defineProperty(result, key, { value: snapshotJson(descriptors[key]!.value, depth + 1, budget), enumerable: true });
  }
  return result;
}
function parseOutput(schema: z.ZodType, value: unknown): Record<string, unknown> {
  const parsed = schema.safeParse(snapshotSafeInput(value));
  if (!parsed.success || !parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) throw new Error("ELEVENLABS_VOICE_OUTPUT_INVALID");
  return parsed.data as Record<string, unknown>;
}
function structured(value: object): CallToolResult { return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> }; }
function errorResult(value: object): CallToolResult { return { isError: true, content: [{ type: "text", text: JSON.stringify(value) }] }; }
