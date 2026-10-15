import { types } from "node:util";

const MODEL_IDS = Object.freeze(["wan_25_i2v_preview"] as const);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const PAGE_SIZE = 10;
const PAGE_LIMIT = 7;
const MESSAGE_LIMIT = 64;
const OBJECT_LIMIT = 64;
const GRAPH_NODE_LIMIT = 512;
const GRAPH_DEPTH_LIMIT = 8;

export type OwnerWan25I2vModelId = typeof MODEL_IDS[number];
export type OwnerWan25I2vHistoryGapCode =
  | "HISTORY_INPUT_INVALID" | "HISTORY_PAGE_INVALID" | "HISTORY_PAGE_INCONSISTENT" | "HISTORY_INCOMPLETE"
  | "HISTORY_PAGE_LIMIT" | "HISTORY_MESSAGE_LIMIT" | "HISTORY_ROW_INVALID" | "HISTORY_OBJECT_LIMIT"
  | "HISTORY_DUPLICATE_ID" | "HISTORY_CHILD_JOIN_INVALID" | "HISTORY_CHAT_ID_INCONSISTENT"
  | "HISTORY_UNKNOWN_FIELDS" | "OWNER_ACK_MISSING" | "OWNER_ACK_AMBIGUOUS" | "OWNER_ACK_MISMATCH"
  | "BOT_VIDEO_MODEL_MISMATCH" | "BOT_VIDEO_INCOMPLETE" | "BOT_ERROR_OBSERVED" | "BOT_RESULT_NOT_OBSERVED";

export interface OwnerWan25I2vHistoryCandidateMessage {
  readonly message_id: string;
  readonly message_object_ids: readonly string[];
}

export interface OwnerWan25I2vHistoryWitness {
  readonly status: "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  readonly history_binding_status: "BOUND" | "PARTIAL" | "UNVERIFIED";
  readonly history_page_status: "COMPLETE" | "INCOMPLETE" | "UNPROVEN";
  readonly provider_chat_id: string | null;
  readonly owner_echo_message_id: string | null;
  readonly candidate_messages: readonly Readonly<OwnerWan25I2vHistoryCandidateMessage>[];
  readonly bot_error_observed: boolean;
  readonly gaps: readonly OwnerWan25I2vHistoryGapCode[];
  readonly backend_acceptance: "UNPROVEN";
}

interface RecordRead { readonly values: Readonly<Record<string, unknown>>; readonly unknownFields: boolean }
type ArrayRead = Readonly<{ status: "OK"; values: readonly unknown[] }> | Readonly<{ status: "INVALID" }> |
  Readonly<{ status: "OVER_LIMIT" }>;
interface HistoryObject {
  readonly id: string;
  readonly message_id: string;
  readonly object_type: string;
  readonly model_type?: unknown;
  readonly object_text?: unknown;
  readonly completed?: unknown;
}
interface HistoryRow { readonly id: string; readonly chat_id: string; readonly author_id: number; readonly objects: readonly HistoryObject[] }

/** Binds only bounded structural history for the exact WAN 2.5 preview ID; it grants no native/provider authority. */
export function bindOwnerWan25I2vHistory(input: unknown): OwnerWan25I2vHistoryWitness {
  if (!isClosedBoundedGraph(input)) return empty("UNVERIFIED", "UNPROVEN", "HISTORY_INPUT_INVALID");
  const root = readRecord(input, ["pages", "expected"]);
  if (!root || root.unknownFields) return empty("UNVERIFIED", "UNPROVEN", "HISTORY_INPUT_INVALID");
  const expected = readRecord(root.values.expected, ["chat_uuid", "owner_echo_message_id", "prompt", "model_id"]);
  if (!expected || expected.unknownFields || !isSafeId(expected.values.chat_uuid) ||
      !(expected.values.owner_echo_message_id === null || isSafeId(expected.values.owner_echo_message_id)) ||
      typeof expected.values.prompt !== "string" || !isModelId(expected.values.model_id)) {
    return empty("UNVERIFIED", "UNPROVEN", "HISTORY_INPUT_INVALID");
  }
  const modelId = expected.values.model_id;
  const pages = readArray(root.values.pages, PAGE_LIMIT);
  if (pages.status === "INVALID") return empty("UNVERIFIED", "UNPROVEN", "HISTORY_INPUT_INVALID");
  if (pages.status === "OVER_LIMIT") return empty("INCOMPLETE", "INCOMPLETE", "HISTORY_PAGE_LIMIT");

  const rows: HistoryRow[] = [];
  const messageIds = new Set<string>();
  const objectIds = new Set<string>();
  const gaps = new Set<OwnerWan25I2vHistoryGapCode>();
  let totalCount: number | undefined;
  let totalPages: number | undefined;
  let providerChatValue: string | undefined;
  let unknownFields = false;
  let expectedReadPages: number | undefined;
  let objectCount = 0;

  for (let index = 0; index < pages.values.length; index += 1) {
    const page = readRecord(pages.values[index], ["messages", "pagination"], ["created_at", "updated_at"]);
    if (!page) return empty("UNVERIFIED", "UNPROVEN", "HISTORY_PAGE_INVALID");
    unknownFields ||= page.unknownFields;
    const messages = readArray(page.values.messages, MESSAGE_LIMIT);
    if (messages.status === "INVALID") return empty("UNVERIFIED", "UNPROVEN", "HISTORY_PAGE_INVALID");
    if (messages.status === "OVER_LIMIT") return empty("INCOMPLETE", "INCOMPLETE", "HISTORY_MESSAGE_LIMIT");
    const pagination = readRecord(page.values.pagination,
      ["page", "page_size", "total_count", "total_pages", "has_next", "has_previous"], ["next", "previous"]);
    if (!pagination) return empty("UNVERIFIED", "UNPROVEN", "HISTORY_PAGE_INVALID");
    unknownFields ||= pagination.unknownFields;
    const p = pagination.values;
    if (!isSafeInteger(p.page) || !isSafeInteger(p.page_size) || !isSafeInteger(p.total_count) || !isSafeInteger(p.total_pages) ||
        typeof p.has_next !== "boolean" || typeof p.has_previous !== "boolean" || p.page_size !== PAGE_SIZE ||
        (p.total_count as number) < 0 || (p.total_pages as number) < 0) {
      return empty("UNVERIFIED", "UNPROVEN", "HISTORY_PAGE_INVALID");
    }
    const count = p.total_count as number;
    const reportedPages = p.total_pages as number;
    const calculatedPages = count === 0 ? 0 : Math.ceil(count / PAGE_SIZE);
    expectedReadPages ??= Math.max(1, calculatedPages);
    if (count > MESSAGE_LIMIT) return empty("INCOMPLETE", "INCOMPLETE", "HISTORY_MESSAGE_LIMIT");
    const pageNumber = index + 1;
    const expectedRows = Math.min(PAGE_SIZE, Math.max(0, count - (pageNumber - 1) * PAGE_SIZE));
    if (reportedPages > PAGE_LIMIT || pageNumber > PAGE_LIMIT || p.page !== pageNumber || reportedPages !== calculatedPages ||
        p.has_previous !== (pageNumber > 1) || p.has_next !== (pageNumber < calculatedPages) || messages.values.length !== expectedRows ||
        (totalCount !== undefined && (count !== totalCount || reportedPages !== totalPages))) {
      return empty("INCOMPLETE", "INCOMPLETE", "HISTORY_PAGE_INCONSISTENT");
    }
    totalCount ??= count;
    totalPages ??= reportedPages;

    for (const rawRow of messages.values) {
      const row = readRecord(rawRow, ["id", "chat_id", "author_id", "message_object"], ["created_at", "updated_at", "is_favorite"]);
      if (!row) return empty("UNVERIFIED", "UNPROVEN", "HISTORY_ROW_INVALID");
      unknownFields ||= row.unknownFields;
      const id = providerId(row.values.id);
      const chatId = providerChatId(row.values.chat_id);
      const authorId = row.values.author_id;
      if (!id || !chatId || !isSafeInteger(authorId)) return empty("UNVERIFIED", "UNPROVEN", "HISTORY_ROW_INVALID");
      if (messageIds.has(id)) return empty("UNVERIFIED", "UNPROVEN", "HISTORY_DUPLICATE_ID");
      if (providerChatValue !== undefined && providerChatValue !== chatId) return empty("UNVERIFIED", "UNPROVEN", "HISTORY_CHAT_ID_INCONSISTENT");
      providerChatValue ??= chatId;
      const objects = readArray(row.values.message_object, OBJECT_LIMIT);
      if (objects.status === "INVALID") return empty("UNVERIFIED", "UNPROVEN", "HISTORY_ROW_INVALID");
      if (objects.status === "OVER_LIMIT" || objectCount + objects.values.length > OBJECT_LIMIT)
        return empty("INCOMPLETE", "INCOMPLETE", "HISTORY_OBJECT_LIMIT");
      objectCount += objects.values.length;
      const normalizedObjects: HistoryObject[] = [];
      for (const rawObject of objects.values) {
        const object = readRecord(rawObject, ["id", "message_id", "object_type"], ["object_url", "created_at", "updated_at", "task_id", "metadata"],
          ["model_type", "object_text", "completed"]);
        if (!object) return empty("UNVERIFIED", "UNPROVEN", "HISTORY_ROW_INVALID");
        unknownFields ||= object.unknownFields;
        const objectId = providerId(object.values.id);
        const parentId = providerId(object.values.message_id);
        if (!objectId) return empty("UNVERIFIED", "UNPROVEN", "HISTORY_ROW_INVALID");
        if (objectIds.has(objectId)) return empty("UNVERIFIED", "UNPROVEN", "HISTORY_DUPLICATE_ID");
        if (parentId !== id) return empty("UNVERIFIED", "UNPROVEN", "HISTORY_CHILD_JOIN_INVALID");
        if (typeof object.values.object_type !== "string") return empty("UNVERIFIED", "UNPROVEN", "HISTORY_ROW_INVALID");
        objectIds.add(objectId);
        normalizedObjects.push(Object.freeze({ id: objectId, message_id: parentId, object_type: object.values.object_type,
          ...(Object.hasOwn(object.values, "model_type") ? { model_type: object.values.model_type } : {}),
          ...(Object.hasOwn(object.values, "object_text") ? { object_text: object.values.object_text } : {}),
          ...(Object.hasOwn(object.values, "completed") ? { completed: object.values.completed } : {}) }));
      }
      messageIds.add(id);
      rows.push(Object.freeze({ id, chat_id: chatId, author_id: authorId as number, objects: Object.freeze(normalizedObjects) }));
    }
  }

  const requiredPages = expectedReadPages ?? 1;
  if (pages.values.length !== requiredPages || rows.length !== totalCount ||
      (totalCount === 0 && (pages.values.length !== 1 || rows.length !== 0))) {
    return empty("INCOMPLETE", "INCOMPLETE", "HISTORY_INCOMPLETE");
  }
  if (providerChatValue === undefined) return Object.freeze({ status: "PENDING", owner_ack_status: "MISSING", history_binding_status: "PARTIAL",
    history_page_status: "COMPLETE", provider_chat_id: null, owner_echo_message_id: null, candidate_messages: Object.freeze([]),
    bot_error_observed: false, gaps: Object.freeze(["OWNER_ACK_MISSING"] as const), backend_acceptance: "UNPROVEN" });
  if (unknownFields) gaps.add("HISTORY_UNKNOWN_FIELDS");

  const exactAck = (row: HistoryRow): boolean => {
    const textObjects = row.objects.filter((object) => object.object_type === "text");
    return textObjects.length === 1 && textObjects[0]?.model_type === modelId &&
      Object.hasOwn(textObjects[0]!, "object_text") && textObjects[0]?.object_text === expected.values.prompt;
  };
  const expectedAckId = expected.values.owner_echo_message_id;
  let ackStatus: OwnerWan25I2vHistoryWitness["owner_ack_status"];
  let ownerEchoId: string | null = null;
  if (typeof expectedAckId === "string") {
    const matches = rows.filter((row) => row.id === expectedAckId);
    if (matches.length === 0) { ackStatus = "MISSING"; gaps.add("OWNER_ACK_MISSING"); }
    else if (matches.length !== 1) { ackStatus = "AMBIGUOUS"; gaps.add("OWNER_ACK_AMBIGUOUS"); }
    else if (matches[0]!.author_id <= 0 || !exactAck(matches[0]!)) { ackStatus = "MISMATCH"; gaps.add("OWNER_ACK_MISMATCH"); }
    else { ackStatus = "MATCHED"; ownerEchoId = expectedAckId; }
  } else {
    const matches = rows.filter((row) => row.author_id > 0 && exactAck(row));
    if (matches.length === 0) { ackStatus = "MISSING"; gaps.add("OWNER_ACK_MISSING"); }
    else if (matches.length !== 1) { ackStatus = "AMBIGUOUS"; gaps.add("OWNER_ACK_AMBIGUOUS"); }
    else { ackStatus = "MATCHED"; ownerEchoId = matches[0]!.id; }
  }

  const candidates: OwnerWan25I2vHistoryCandidateMessage[] = [];
  let botErrorObserved = false;
  let unresolvedBotObject = false;
  for (const row of rows) {
    if (row.author_id !== -1) continue;
    const candidateObjectIds: string[] = [];
    for (const object of row.objects) {
      if (object.model_type !== modelId) continue;
      if (object.object_type === "error") { botErrorObserved = true; gaps.add("BOT_ERROR_OBSERVED"); continue; }
      if (object.object_type !== "video") continue;
      if (object.completed !== true) { unresolvedBotObject = true; gaps.add("BOT_VIDEO_INCOMPLETE"); continue; }
      candidateObjectIds.push(object.id);
    }
    if (candidateObjectIds.length > 0) candidates.push(Object.freeze({ message_id: row.id, message_object_ids: Object.freeze(candidateObjectIds) }));
    if (row.objects.some((object) => object.object_type === "video" && object.model_type !== modelId)) {
      unresolvedBotObject = true; gaps.add("BOT_VIDEO_MODEL_MISMATCH");
    }
  }
  if (candidates.length === 0 && !unresolvedBotObject && !botErrorObserved) gaps.add("BOT_RESULT_NOT_OBSERVED");
  const ackMatched = ackStatus === "MATCHED";
  const bindingStatus = ackMatched ? (unknownFields || unresolvedBotObject || botErrorObserved ? "PARTIAL" : "BOUND") : "PARTIAL";
  const status = !ackMatched || candidates.length === 0 || unresolvedBotObject || botErrorObserved ? "PENDING" : "COMPLETE";
  return Object.freeze({ status, owner_ack_status: ackStatus, history_binding_status: bindingStatus,
    history_page_status: "COMPLETE", provider_chat_id: providerChatValue, owner_echo_message_id: ownerEchoId,
    candidate_messages: Object.freeze(candidates), bot_error_observed: botErrorObserved,
    gaps: Object.freeze([...gaps]), backend_acceptance: "UNPROVEN" });
}

function readRecord(value: unknown, keys: readonly string[], inertKeys: readonly string[] = [], optionalKeys: readonly string[] = []): RecordRead | null {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    let unknownFields = false;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string") { unknownFields = true; continue; }
      const descriptor = descriptors[key]!;
      if (!("value" in descriptor) || !descriptor.enumerable) return null;
      if (keys.includes(key) || optionalKeys.includes(key)) values[key] = descriptor.value;
      else if (!inertKeys.includes(key)) unknownFields = true;
    }
    if (keys.some((key) => !Object.hasOwn(values, key))) return null;
    return Object.freeze({ values: Object.freeze(values), unknownFields });
  } catch { return null; }
}

function readArray(value: unknown, maximum: number): ArrayRead {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
      return Object.freeze({ status: "INVALID" });
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    if (!Number.isSafeInteger(length) || (length as number) < 0) return Object.freeze({ status: "INVALID" });
    if ((length as number) > maximum) return Object.freeze({ status: "OVER_LIMIT" });
    if (keys.length !== (length as number) + 1 || !keys.includes("length") || keys.some((key) => key !== "length" &&
        (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= (length as number) ||
          !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) return Object.freeze({ status: "INVALID" });
    const values: unknown[] = [];
    for (let index = 0; index < (length as number); index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return Object.freeze({ status: "INVALID" });
      values.push(descriptor.value);
    }
    return Object.freeze({ status: "OK", values: Object.freeze(values) });
  } catch { return Object.freeze({ status: "INVALID" }); }
}

function providerId(value: unknown): string | null {
  if (typeof value === "string") return SAFE_ID.test(value) ? value : null;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return null;
}
function providerChatId(value: unknown): string | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
}
function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function isSafeInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value); }
function isModelId(value: unknown): value is OwnerWan25I2vModelId { return typeof value === "string" && MODEL_IDS.includes(value as OwnerWan25I2vModelId); }

/** Checks the entire caller graph before field selection without reading property values through accessors. */
function isClosedBoundedGraph(root: unknown): boolean {
  const active = new WeakSet<object>();
  const visited = new WeakSet<object>();
  let nodes = 0;
  const visit = (value: unknown, depth: number): boolean => {
    nodes += 1;
    if (nodes > GRAPH_NODE_LIMIT || depth > GRAPH_DEPTH_LIMIT || typeof value === "function") return false;
    if ((typeof value !== "object" || value === null)) return typeof value !== "symbol" && typeof value !== "bigint";
    if (types.isProxy(value)) return false;
    if (active.has(value)) return false;
    if (visited.has(value)) return true;
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
    if (Array.isArray(value) && prototype !== Array.prototype) return false;
    active.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (Array.isArray(value) && key === "length") continue;
      const descriptor = descriptors[key as keyof typeof descriptors];
      if (!descriptor || !("value" in descriptor) || !visit(descriptor.value, depth + 1)) {
        active.delete(value);
        return false;
      }
    }
    active.delete(value);
    visited.add(value);
    return true;
  };
  try { return visit(root, 0); } catch { return false; }
}

function empty(status: OwnerWan25I2vHistoryWitness["status"], pageStatus: OwnerWan25I2vHistoryWitness["history_page_status"],
  gap: OwnerWan25I2vHistoryGapCode): OwnerWan25I2vHistoryWitness {
  return Object.freeze({ status, owner_ack_status: "MISSING", history_binding_status: "UNVERIFIED", history_page_status: pageStatus,
    provider_chat_id: null, owner_echo_message_id: null, candidate_messages: Object.freeze([]), bot_error_observed: false,
    gaps: Object.freeze([gap]), backend_acceptance: "UNPROVEN" });
}
