import { createHash } from "node:crypto";
import { types } from "node:util";
import { z } from "zod/v4";
import type { GenerationPrincipalRef } from "../../domain/generation-operation.js";
import { readOwnerSunoTrackMetadata } from "../../application/owner-suno-track-metadata.js";
import { schemaHash } from "../../domain/generation-contract.js";
import {
  getOwnerSunoGenerationParameterSource,
  type OwnerSunoGenerationModel,
  type OwnerSunoGenerationSourcePins
} from "../../application/owner-suno-generation-parameters.js";
import type { OwnerSunoReadyAudio } from "./owner-suno-audio-result.js";

export const OWNER_SUNO_EXISTING_INDEX_PAGE_SIZE = 20 as const;
export const OWNER_SUNO_EXISTING_HISTORY_PAGE_SIZE = 10 as const;
export const OWNER_SUNO_EXISTING_HISTORY_MAX_MESSAGES = 64 as const;
export const OWNER_SUNO_EXISTING_HISTORY_MAX_PAGES = 7 as const;
export const OWNER_SUNO_EXISTING_INDEX_MAX_PAGE = 100 as const;
export const OWNER_SUNO_EXISTING_CONTEXT_CAPACITY = 128 as const;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_PROVIDER_CHAT_ID = /^\d{1,16}$/u;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const MODELS = new Set<string>(["V6", "V6_wild"]);

const providerIdSchema = z.union([
  z.string().regex(SAFE_ID),
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
]).transform((value) => String(value));

const paginationSchema = z.object({
  page: z.number().int().min(1).max(OWNER_SUNO_EXISTING_INDEX_MAX_PAGE),
  page_size: z.literal(OWNER_SUNO_EXISTING_INDEX_PAGE_SIZE),
  total_count: z.number().int().nonnegative().max(2_000_000),
  total_pages: z.number().int().nonnegative().max(100_000),
  has_next: z.boolean(),
  has_previous: z.boolean()
}).strip();

const indexRowSchema = z.object({
  id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  uuid: z.string().regex(SAFE_ID),
  scope: z.literal("audio"),
  title: z.string().min(1).max(256),
  created_at: z.string().max(128),
  updated_at: z.string().max(128),
  message_count: z.number().int().nonnegative().max(2_000_000)
}).strip();

const indexEnvelopeSchema = z.object({
  chats: z.array(indexRowSchema).max(OWNER_SUNO_EXISTING_INDEX_PAGE_SIZE),
  pagination: paginationSchema
}).strip();

const historyPaginationSchema = z.object({
  page: z.number().int().min(1).max(OWNER_SUNO_EXISTING_HISTORY_MAX_PAGES),
  page_size: z.literal(OWNER_SUNO_EXISTING_HISTORY_PAGE_SIZE),
  total_count: z.number().int().nonnegative().max(OWNER_SUNO_EXISTING_HISTORY_MAX_MESSAGES),
  total_pages: z.number().int().nonnegative().max(OWNER_SUNO_EXISTING_HISTORY_MAX_PAGES),
  has_next: z.boolean(),
  has_previous: z.boolean()
}).strip();

const historyObjectSchema = z.object({
  id: providerIdSchema,
  message_id: providerIdSchema,
  object_type: z.string().regex(/^[A-Za-z0-9._~-]{1,80}$/u),
  model_type: z.string().regex(/^[A-Za-z0-9._~-]{1,80}$/u),
  object_text: z.string().max(5_000),
  object_url: z.string().max(4_096),
  completed: z.boolean(),
  metadata: z.object({ payload: z.unknown() }).strip()
}).strip();

const historyRowSchema = z.object({
  id: providerIdSchema,
  chat_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  author_id: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  message_object: z.array(historyObjectSchema).max(64)
}).strip();

const historyEnvelopeSchema = z.object({
  messages: z.array(historyRowSchema).max(OWNER_SUNO_EXISTING_HISTORY_PAGE_SIZE),
  pagination: historyPaginationSchema
}).strip();

export type OwnerSunoExistingTrackTitleFamily = "MCP_GENERATION" | "MCP_TRACK_OPERATION";

export interface OwnerSunoExistingTrackIndexChat {
  readonly chat_uuid: string;
  readonly provider_chat_id: string;
  readonly title_family: OwnerSunoExistingTrackTitleFamily;
}

export interface OwnerSunoExistingTrackIndexPage {
  readonly page: number;
  readonly page_size: typeof OWNER_SUNO_EXISTING_INDEX_PAGE_SIZE;
  readonly total_count: number;
  readonly total_pages: number;
  readonly has_next: boolean;
  readonly has_previous: boolean;
  readonly chats: readonly Readonly<OwnerSunoExistingTrackIndexChat>[];
}

export interface OwnerSunoExistingTrackHistoryObject {
  readonly id: string;
  readonly message_id: string;
  readonly object_type: string;
  readonly model_type?: string | null;
  readonly object_text?: string;
  readonly object_url?: string;
  readonly completed?: boolean;
  readonly metadata?: Readonly<{ payload: unknown }>;
}

export interface OwnerSunoExistingTrackHistoryRow {
  readonly id: string;
  readonly chat_id: number;
  readonly author_id: number;
  readonly message_object: readonly Readonly<OwnerSunoExistingTrackHistoryObject>[];
}

export interface OwnerSunoExistingTrackHistoryPage {
  readonly messages: readonly Readonly<OwnerSunoExistingTrackHistoryRow>[];
  readonly pagination: Readonly<{
    page: number;
    page_size: typeof OWNER_SUNO_EXISTING_HISTORY_PAGE_SIZE;
    total_count: number;
    total_pages: number;
    has_next: boolean;
    has_previous: boolean;
  }>;
}

export interface OwnerSunoExistingTrackMetadata {
  readonly object_index: number;
  readonly message_object_id: string;
  readonly object_url: string;
  readonly clip_id: string;
  readonly task_id: string;
  readonly model_id: OwnerSunoGenerationModel;
}

export interface OwnerSunoExistingTrackResultContextFields {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly model_id: OwnerSunoGenerationModel;
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly string[];
  readonly source_kind: "EXISTING_OWNER_TRACK";
  readonly owner_echo_message_id: string;
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly intent_fingerprint: string;
  readonly source_profile_schema_hash: string;
  readonly source_pins: Readonly<OwnerSunoGenerationSourcePins>;
}

export class OwnerSunoExistingTrackCodecError extends Error {
  constructor(readonly code: "INDEX_UNVERIFIED" | "HISTORY_UNVERIFIED" | "RESULT_UNVERIFIED") {
    super("The existing owner Suno track could not be verified.");
    this.name = "OwnerSunoExistingTrackCodecError";
  }
}

export function decodeOwnerSunoExistingTrackIndex(rawInput: unknown, requestedPage: number): OwnerSunoExistingTrackIndexPage {
  const raw = readExactEnvelope(rawInput, ["chats", "pagination"], 0, "INDEX_UNVERIFIED");
  const rawPagination = record(raw.pagination);
  if (!rawPagination || countUnknownKeys(rawPagination, new Set([
    "page", "page_size", "total_count", "total_pages", "has_next", "has_previous"
  ])) > 2) return fail("INDEX_UNVERIFIED");
  if (!Array.isArray(raw.chats)) return fail("INDEX_UNVERIFIED");
  for (const rowInput of raw.chats) {
    const row = record(rowInput);
    if (!row || countUnknownKeys(row, new Set(["id", "uuid", "scope", "title", "created_at", "updated_at", "message_count"])) > 5) {
      return fail("INDEX_UNVERIFIED");
    }
  }
  const parsed = indexEnvelopeSchema.safeParse(raw);
  if (!parsed.success || parsed.data.pagination.page !== requestedPage) return fail("INDEX_UNVERIFIED");
  const { chats, pagination } = parsed.data;
  const expectedPages = pagination.total_count === 0 ? 0 : Math.ceil(pagination.total_count / OWNER_SUNO_EXISTING_INDEX_PAGE_SIZE);
  const expectedRows = Math.min(OWNER_SUNO_EXISTING_INDEX_PAGE_SIZE,
    Math.max(0, pagination.total_count - (requestedPage - 1) * OWNER_SUNO_EXISTING_INDEX_PAGE_SIZE));
  if (pagination.total_pages !== expectedPages || pagination.has_previous !== (requestedPage > 1) ||
      pagination.has_next !== (requestedPage < expectedPages) || chats.length !== expectedRows ||
      (expectedPages > 0 && requestedPage > expectedPages)) return fail("INDEX_UNVERIFIED");
  const seenUuids = new Set<string>();
  const seenProviderIds = new Set<string>();
  const accepted: OwnerSunoExistingTrackIndexChat[] = [];
  for (const row of chats) {
    const uuid = safeId(row.uuid);
    const providerChatId = providerChatIdFromNumber(row.id);
    const family = titleFamily(row.title);
    if (!uuid || !providerChatId || seenUuids.has(uuid) || seenProviderIds.has(providerChatId)) return fail("INDEX_UNVERIFIED");
    seenUuids.add(uuid);
    seenProviderIds.add(providerChatId);
    if (family !== undefined) accepted.push(Object.freeze({ chat_uuid: uuid,
      provider_chat_id: providerChatId, title_family: family }));
  }
  return Object.freeze({ page: pagination.page, page_size: OWNER_SUNO_EXISTING_INDEX_PAGE_SIZE,
    total_count: pagination.total_count, total_pages: pagination.total_pages, has_next: pagination.has_next,
    has_previous: pagination.has_previous, chats: Object.freeze(accepted) });
}

export function decodeOwnerSunoExistingTrackHistoryPage(rawInput: unknown, requestedPage: number,
  expectedProviderChatId: string): OwnerSunoExistingTrackHistoryPage {
  const raw = readExactEnvelope(rawInput, ["messages", "pagination"], 2, "HISTORY_UNVERIFIED");
  const rawPagination = record(raw.pagination);
  if (!rawPagination || countUnknownKeys(rawPagination, new Set([
    "page", "page_size", "total_count", "total_pages", "has_next", "has_previous"
  ])) > 2 || !Array.isArray(raw.messages)) return fail("HISTORY_UNVERIFIED");
  for (const rowInput of raw.messages) {
    const row = record(rowInput);
    if (!row || countUnknownKeys(row, new Set(["id", "chat_id", "author_id", "message_object"])) > 3 ||
        !Array.isArray(row.message_object)) return fail("HISTORY_UNVERIFIED");
    for (const objectInput of row.message_object) {
      const object = record(objectInput);
      if (!object || countUnknownKeys(object, new Set(["id", "message_id", "object_type", "model_type", "object_text", "object_url", "completed", "metadata"])) > 3) {
        return fail("HISTORY_UNVERIFIED");
      }
      validateMetadataShape(object.metadata, "HISTORY_UNVERIFIED");
    }
  }
  const parsed = historyEnvelopeSchema.safeParse(raw);
  if (!parsed.success || parsed.data.pagination.page !== requestedPage || !SAFE_PROVIDER_CHAT_ID.test(expectedProviderChatId)) {
    return fail("HISTORY_UNVERIFIED");
  }
  const { messages, pagination } = parsed.data;
  const expectedPages = pagination.total_count === 0 ? 0 : Math.ceil(pagination.total_count / OWNER_SUNO_EXISTING_HISTORY_PAGE_SIZE);
  const expectedRows = Math.min(OWNER_SUNO_EXISTING_HISTORY_PAGE_SIZE,
    Math.max(0, pagination.total_count - (requestedPage - 1) * OWNER_SUNO_EXISTING_HISTORY_PAGE_SIZE));
  if (pagination.total_pages !== expectedPages || pagination.has_previous !== (requestedPage > 1) ||
      pagination.has_next !== (requestedPage < expectedPages) || messages.length !== expectedRows ||
      (expectedPages > 0 && requestedPage > expectedPages)) return fail("HISTORY_UNVERIFIED");
  for (const row of messages) {
    if (String(row.chat_id) !== expectedProviderChatId || row.message_object.some((object) => object.message_id !== row.id)) {
      return fail("HISTORY_UNVERIFIED");
    }
  }
  return Object.freeze({ messages: Object.freeze(messages.map((row) => Object.freeze({
    id: row.id, chat_id: row.chat_id, author_id: row.author_id,
    message_object: Object.freeze(row.message_object.map((object) => Object.freeze({
      id: object.id, message_id: object.message_id, object_type: object.object_type,
      ...(object.model_type === undefined ? {} : { model_type: object.model_type }),
      ...(object.object_text === undefined ? {} : { object_text: object.object_text }),
      ...(object.completed === undefined ? {} : { completed: object.completed })
    }))) }))),
  pagination: Object.freeze({ ...pagination }) });
}

export function validateOwnerSunoExistingTrackResultEnvelope(rawInput: unknown): void {
  const raw = record(rawInput);
  if (!raw || ["id", "chat_id", "author_id", "message_object"].some((key) => !Object.hasOwn(raw, key)) ||
      countUnknownKeys(raw, new Set(["id", "chat_id", "author_id", "message_object", "created_at", "updated_at", "is_favorite"])) > 1 ||
      !Array.isArray(raw.message_object) || raw.message_object.length === 0 || raw.message_object.length > 64) {
    return fail("RESULT_UNVERIFIED");
  }
  for (const objectInput of raw.message_object) {
    const object = record(objectInput);
    if (!object || ["id", "message_id", "object_type", "model_type", "object_url", "completed", "metadata"]
      .some((key) => !Object.hasOwn(object, key)) ||
        countUnknownKeys(object, new Set(["id", "message_id", "object_type", "object_text", "created_at", "updated_at",
          "metadata", "object_url", "completed", "model_type"])) > 3) return fail("RESULT_UNVERIFIED");
    validateMetadataShape(object.metadata, "RESULT_UNVERIFIED");
  }
}

export function validateOwnerSunoExistingTrackResultJoin(rawInput: unknown,
  context: OwnerSunoExistingTrackResultContextFields): void {
  const raw = record(rawInput);
  if (!raw || normalizeProviderId(raw.id) !== context.message_id ||
      normalizeProviderId(raw.chat_id) !== context.provider_chat_id || raw.author_id !== -1 ||
      !Array.isArray(raw.message_object) || raw.message_object.length !== context.message_object_ids.length) return fail("RESULT_UNVERIFIED");
  const actualIds = new Set<string>();
  for (const item of raw.message_object) {
    const object = record(item);
    const id = normalizeProviderId(object?.id);
    if (!object || !id || actualIds.has(id) || normalizeProviderId(object.message_id) !== context.message_id ||
        object.object_type !== "audio" || object.model_type !== context.model_id || object.completed !== true) return fail("RESULT_UNVERIFIED");
    actualIds.add(id);
  }
  if (actualIds.size !== context.message_object_ids.length || context.message_object_ids.some((id) => !actualIds.has(id))) {
    return fail("RESULT_UNVERIFIED");
  }
}

export function deriveOwnerSunoExistingTrackIntentFingerprint(input: {
  readonly chat_uuid: string; readonly owner_echo_message_id: string; readonly model_id: OwnerSunoGenerationModel;
  readonly owner_ack_text: string;
}): string {
  const chatUuid = safeId(input.chat_uuid);
  const ownerEchoId = safeId(input.owner_echo_message_id);
  if (!chatUuid || !ownerEchoId || !MODELS.has(input.model_id) || typeof input.owner_ack_text !== "string" ||
      input.owner_ack_text.trim().length === 0 || input.owner_ack_text.length > 5_000) return fail("HISTORY_UNVERIFIED");
  return `sha256:${createHash("sha256").update(JSON.stringify(["owner-suno-existing-track-intent-v1",
    chatUuid, ownerEchoId, input.model_id, input.owner_ack_text])).digest("hex")}`;
}

export function existingOwnerSunoSourceBinding(): Readonly<{
  source_profile_schema_hash: string; source_pins: Readonly<OwnerSunoGenerationSourcePins>;
}> {
  const source = getOwnerSunoGenerationParameterSource();
  return Object.freeze({ source_profile_schema_hash: schemaHash(source), source_pins: source.source_pins });
}

export function readOwnerSunoExistingTrackMetadata(rawInput: unknown, readyAudio: readonly Readonly<OwnerSunoReadyAudio>[],
  modelId: OwnerSunoGenerationModel, messageId: string): readonly Readonly<OwnerSunoExistingTrackMetadata>[] {
  const metadataByObject = new Map<string, { readonly clip_id: string; readonly task_id: string }>();
  if (!Array.isArray(readyAudio) || readyAudio.length === 0 || !MODELS.has(modelId)) return Object.freeze([]);
  const raw = record(rawInput);
  const objects = raw?.message_object;
  if (!Array.isArray(objects) || types.isProxy(objects) || Object.getPrototypeOf(objects) !== Array.prototype || objects.length > 64) {
    return Object.freeze([]);
  }
  for (const ready of readyAudio) {
    const index = ready.object_index;
    const descriptor = Object.getOwnPropertyDescriptor(objects, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) continue;
    const object = record(descriptor.value);
    if (!object || normalizeProviderId(object.id) !== ready.message_object_id ||
        normalizeProviderId(object.message_id) !== messageId || object.object_type !== "audio" || object.model_type !== modelId ||
        object.completed !== true || object.object_url !== ready.object_url) continue;
    const metadata = record(object.metadata);
    const payload = metadata?.payload;
    const identifiers = readOwnerSunoTrackMetadata(payload);
    if (identifiers) metadataByObject.set(ready.message_object_id, identifiers);
  }
  const entries = readyAudio.flatMap((ready) => {
    const identifiers = metadataByObject.get(ready.message_object_id);
    return identifiers ? [Object.freeze({ object_index: ready.object_index, message_object_id: ready.message_object_id,
      object_url: ready.object_url, clip_id: identifiers.clip_id, task_id: identifiers.task_id, model_id: modelId })] : [];
  });
  return Object.freeze(entries);
}

function validateMetadataShape(value: unknown, code: "HISTORY_UNVERIFIED" | "RESULT_UNVERIFIED"): void {
  if (value === undefined) return;
  const metadata = record(value);
  if (!metadata || countUnknownKeys(metadata, new Set(["payload"])) > 26 || !Object.hasOwn(metadata, "payload")) return fail(code);
  const payload = record(metadata.payload);
  if (!payload || countUnknownKeys(payload, new Set(["clip_id", "task_id", "duration"])) > 3) return fail(code);
}

function titleFamily(value: string): OwnerSunoExistingTrackTitleFamily | undefined {
  if (new RegExp(`^owner-suno-generation-${UUID}$`, "u").test(value)) return "MCP_GENERATION";
  if (new RegExp(`^owner-suno-track-operation-${UUID}$`, "u").test(value)) return "MCP_TRACK_OPERATION";
  return undefined;
}

function readExactEnvelope(value: unknown, keys: readonly string[], maximumUnknownKeys: number, code: "INDEX_UNVERIFIED" | "HISTORY_UNVERIFIED"):
  Record<string, unknown> {
  const result = record(value);
  if (!result) return fail(code);
  const unknown = countUnknownKeys(result, new Set(keys));
  if (unknown > maximumUnknownKeys || keys.some((key) => !Object.hasOwn(result, key))) return fail(code);
  return result;
}

function countUnknownKeys(value: Record<string, unknown>, known: ReadonlySet<string>): number {
  try { return Reflect.ownKeys(value).filter((key) => typeof key !== "string" || !known.has(key)).length; }
  catch { return Number.POSITIVE_INFINITY; }
}

function record(value: unknown): Record<string, unknown> | undefined {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    return value as Record<string, unknown>;
  } catch { return undefined; }
}

function normalizeProviderId(value: unknown): string | undefined {
  if (typeof value === "string") return safeId(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return undefined;
}

function safeId(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_ID.test(value) ? value : undefined;
}

function providerChatIdFromNumber(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return undefined;
  const normalized = String(value);
  return SAFE_PROVIDER_CHAT_ID.test(normalized) ? normalized : undefined;
}

function fail(code: "INDEX_UNVERIFIED" | "HISTORY_UNVERIFIED" | "RESULT_UNVERIFIED"): never {
  throw new OwnerSunoExistingTrackCodecError(code);
}
