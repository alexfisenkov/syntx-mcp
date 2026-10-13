import { types } from "node:util";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";

const MODEL_ID = "video2audio" as const;
const HISTORY_PAGE_SIZE = 10;
const HISTORY_MESSAGE_LIMIT = 64;
const HISTORY_PAGE_LIMIT = Math.ceil(HISTORY_MESSAGE_LIMIT / HISTORY_PAGE_SIZE);
const MAX_MESSAGE_OBJECTS = 64;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_PROVIDER_CHAT_ID = /^\d{1,16}$/u;

export type OwnerVideo2AudioHistoryGapCode =
  | "HISTORY_INPUT_INVALID" | "HISTORY_PAGES_MISSING" | "HISTORY_PAGE_INVALID" | "HISTORY_PAGE_LIMIT" | "HISTORY_PAGE_INCONSISTENT"
  | "HISTORY_MESSAGE_LIMIT"
  | "HISTORY_ROW_INVALID" | "HISTORY_ROW_CHAT_MISMATCH" | "HISTORY_ROW_DUPLICATE" | "HISTORY_OBJECTS_INVALID"
  | "HISTORY_OBJECT_ID_INVALID" | "HISTORY_OBJECT_ID_DUPLICATE" | "HISTORY_OBJECT_MESSAGE_MISMATCH"
  | "OWNER_ACK_MISSING" | "OWNER_ACK_MISMATCH" | "OWNER_ACK_AMBIGUOUS"
  | "RESULT_OBJECT_IDS_INVALID" | "RESULT_OBJECT_MODEL_MISMATCH" | "BOT_RESULT_NOT_OBSERVED";

export type OwnerVideo2AudioResultGapCode =
  | "ENVELOPE_SHAPE_INVALID" | "OUTER_MESSAGE_ID_MISMATCH" | "NOT_BOT_MESSAGE" | "PROVIDER_CHAT_ID_MISMATCH"
  | "UNRECOGNIZED_MESSAGE_FIELDS" | "MESSAGE_OBJECT_ARRAY_INVALID" | "MESSAGE_OBJECT_ARRAY_EMPTY"
  | "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT" | "UNRECOGNIZED_OBJECT_FIELDS" | "OBJECT_ENTRY_INVALID"
  | "OBJECT_ID_UNAVAILABLE" | "OBJECT_ID_DUPLICATE" | "OBJECT_ID_UNEXPECTED" | "EXPECTED_OBJECT_ID_MISSING"
  | "OBJECT_MESSAGE_ID_MISMATCH" | "OBJECT_TYPE_UNSUPPORTED" | "OBJECT_INCOMPLETE" | "OBJECT_COMPLETION_UNKNOWN"
  | "OBJECT_URL_MISSING" | "OBJECT_URL_INVALID" | "OBJECT_URL_UNSAFE" | "MIME_TYPE_UNKNOWN"
  | "MODEL_TYPE_UNAVAILABLE" | "MODEL_TYPE_MISMATCH";

export interface OwnerVideo2AudioResultReadContext {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly model_id: typeof MODEL_ID;
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly string[];
  readonly owner_echo_message_id: string;
}

export interface OwnerVideo2AudioReadyArtifact {
  readonly object_index: number;
  readonly message_object_id: string;
  readonly object_type: "video" | "audio";
  readonly object_url: string;
  readonly mime_type: "video/mp4" | "video/quicktime" | "audio/mpeg" | "audio/wav" | "audio/mp4" | null;
  readonly mime_source: "URL_EXTENSION_LOCAL_POLICY" | "UNKNOWN";
  readonly model_echo: "MATCHED" | "UNKNOWN";
}

export interface OwnerVideo2AudioResult {
  readonly message_binding: "BOUND" | "UNVERIFIED";
  readonly model_echo: "MATCHED" | "UNKNOWN" | "MISMATCH";
  readonly ready_artifacts: readonly Readonly<OwnerVideo2AudioReadyArtifact>[];
  readonly gaps: readonly Readonly<{ object_index: number | null; code: OwnerVideo2AudioResultGapCode }>[];
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerVideo2AudioHistoryResultContext extends OwnerVideo2AudioResultReadContext {}

export interface OwnerVideo2AudioHistoryCorrelation {
  readonly status: "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  readonly history_page_status: "COMPLETE" | "INCOMPLETE" | "UNPROVEN";
  readonly provider_chat_id: string | null;
  readonly owner_echo_message_id: string | null;
  readonly contexts: readonly Readonly<OwnerVideo2AudioHistoryResultContext>[];
  readonly gaps: readonly OwnerVideo2AudioHistoryGapCode[];
  readonly backend_acceptance: "UNPROVEN";
}

interface DataRecord {
  readonly values: Readonly<Record<string, unknown>>;
  readonly unknownFieldCount: number;
}

type ArrayRead =
  | Readonly<{ status: "OK"; values: readonly unknown[] }>
  | Readonly<{ status: "INVALID" }>
  | Readonly<{ status: "OVER_LIMIT" }>;

/** Correlates complete bounded GET-history pages; this plain data context is not an ownership capability. */
export function correlateOwnerVideo2AudioHistory(input: unknown): OwnerVideo2AudioHistoryCorrelation {
  const snapshot = snapshotHistoryInput(input);
  if (!snapshot) return historyResult("UNVERIFIED", "MISSING", "UNPROVEN", null, null, [], ["HISTORY_INPUT_INVALID"]);
  const pages = readArray(snapshot.pages, HISTORY_PAGE_LIMIT);
  if (pages.status === "INVALID") return historyResult("UNVERIFIED", "MISSING", "UNPROVEN", null, null, [], ["HISTORY_PAGE_INVALID"]);
  if (pages.status === "OVER_LIMIT") return historyResult("INCOMPLETE", "MISSING", "INCOMPLETE", null, null, [], ["HISTORY_PAGE_LIMIT"]);
  if (pages.values.length === 0) return historyResult("INCOMPLETE", "MISSING", "INCOMPLETE", null, null, [], ["HISTORY_PAGES_MISSING"]);

  const pageRows: Array<readonly unknown[]> = [];
  const rowIds = new Set<string>();
  const objectIds = new Set<string>();
  let totalCount: number | undefined;
  let totalPages: number | undefined;
  let boundProviderChatId: string | undefined;
  let pageGap: OwnerVideo2AudioHistoryGapCode | undefined;

  for (let index = 0; index < pages.values.length; index += 1) {
    const page = readRecord(pages.values[index], ["messages", "pagination"]);
    if (!page) { pageGap = "HISTORY_PAGE_INVALID"; break; }
    const messages = readArray(page.values.messages, HISTORY_PAGE_SIZE);
    const pagination = readRecord(page.values.pagination, ["page", "page_size", "total_count", "total_pages", "has_next", "has_previous"]);
    if (messages.status !== "OK" || !pagination) { pageGap = "HISTORY_PAGE_INVALID"; break; }
    const values = pagination.values;
    if (!positiveInteger(values.page) || !positiveIntegerOrZero(values.total_count) || !positiveIntegerOrZero(values.total_pages) ||
        values.page_size !== HISTORY_PAGE_SIZE || typeof values.has_next !== "boolean" || typeof values.has_previous !== "boolean") {
      pageGap = "HISTORY_PAGE_INVALID"; break;
    }
    const expectedPages = values.total_count === 0 ? 0 : Math.ceil(values.total_count / HISTORY_PAGE_SIZE);
    const expectedRows = values.total_count === 0 ? 0 : Math.min(HISTORY_PAGE_SIZE,
      Math.max(0, values.total_count - (values.page - 1) * HISTORY_PAGE_SIZE));
    const expectedPage = index + 1;
    const pageCountMismatch = totalCount !== undefined && (values.total_count !== totalCount || values.total_pages !== totalPages);
    const expectedPageNumber = expectedPages === 0 ? 1 : expectedPage;
    if (pageCountMismatch || values.page !== expectedPageNumber || values.total_pages !== expectedPages ||
        values.has_previous !== (values.page > 1) || values.has_next !== (values.page < expectedPages) || messages.values.length !== expectedRows) {
      pageGap = "HISTORY_PAGE_INCONSISTENT"; break;
    }
    totalCount ??= values.total_count as number;
    totalPages ??= values.total_pages as number;
    const rows: unknown[] = [];
    for (const rawRow of messages.values) {
      const row = readRecord(rawRow, ["id", "chat_id", "author_id", "message_object"]);
      if (!row) { pageGap = "HISTORY_ROW_INVALID"; break; }
      const rowId = providerId(row.values.id);
      const chatId = providerChatId(row.values.chat_id);
      if (rowId === undefined || chatId === undefined || !Number.isSafeInteger(row.values.author_id)) {
        pageGap = "HISTORY_ROW_INVALID"; break;
      }
      if (boundProviderChatId !== undefined && boundProviderChatId !== chatId) { pageGap = "HISTORY_ROW_CHAT_MISMATCH"; break; }
      boundProviderChatId ??= chatId;
      if (rowIds.has(rowId)) { pageGap = "HISTORY_ROW_DUPLICATE"; break; }
      rowIds.add(rowId);
      const objects = readArray(row.values.message_object, MAX_MESSAGE_OBJECTS);
      if (objects.status !== "OK") { pageGap = "HISTORY_OBJECTS_INVALID"; break; }
      const validatedObjects: unknown[] = [];
      for (const rawObject of objects.values) {
        const object = readRecord(rawObject, ["id", "message_id", "object_type", "model_type", "object_text", "object_url", "completed"],
          ["created_at", "updated_at", "task_id", "metadata"]);
        if (!object || object.unknownFieldCount > 0) { pageGap = "HISTORY_OBJECTS_INVALID"; break; }
        const objectId = providerId(object.values.id);
        if (objectId === undefined) { pageGap = "HISTORY_OBJECT_ID_INVALID"; break; }
        if (objectIds.has(objectId)) { pageGap = "HISTORY_OBJECT_ID_DUPLICATE"; break; }
        objectIds.add(objectId);
        if (object.values.message_id !== undefined && providerId(object.values.message_id) !== rowId) {
          pageGap = "HISTORY_OBJECT_MESSAGE_MISMATCH"; break;
        }
        validatedObjects.push(Object.freeze({ ...object.values, id: objectId }));
      }
      if (pageGap) break;
      rows.push(Object.freeze({ id: rowId, chat_id: chatId, author_id: row.values.author_id,
        message_object: Object.freeze(validatedObjects) }));
    }
    if (pageGap) break;
    pageRows.push(Object.freeze(rows));
  }
  if (pageGap) return historyResult("UNVERIFIED", "MISSING", "UNPROVEN", boundProviderChatId ?? null, null, [], [pageGap]);
  if ((totalCount ?? 0) > HISTORY_MESSAGE_LIMIT) {
    return historyResult("INCOMPLETE", "MISSING", "INCOMPLETE", boundProviderChatId ?? null, null, [], ["HISTORY_MESSAGE_LIMIT"]);
  }
  if (totalPages === undefined || pages.values.length !== (totalPages === 0 ? 1 : totalPages) || (totalCount ?? 0) !== rowIds.size) {
    return historyResult("INCOMPLETE", "MISSING", "INCOMPLETE", boundProviderChatId ?? null, null, [], ["HISTORY_PAGE_INCONSISTENT"]);
  }

  const rows = pageRows.flat() as readonly HistoryRow[];
  const ownerRows = rows.filter((row) => row.author_id > 0);
  const matchingAcks = ownerRows.filter((row) => isPositiveOwnerAck(row, snapshot.prompt));
  const postedAckRow = ownerRows.find((row) => row.id === snapshot.ownerEchoMessageId);
  const ackMatchesPost = postedAckRow !== undefined && isPositiveOwnerAck(postedAckRow, snapshot.prompt);
  if (matchingAcks.length > 1) {
    return historyResult("UNVERIFIED", "AMBIGUOUS", "COMPLETE", boundProviderChatId ?? null, null, [], ["OWNER_ACK_AMBIGUOUS"]);
  }
  if (!ackMatchesPost) {
    const ackStatus = postedAckRow !== undefined || matchingAcks.length > 0 ? "MISMATCH" : "MISSING";
    return historyResult(ackStatus === "MISSING" ? "INCOMPLETE" : "UNVERIFIED", ackStatus, "COMPLETE",
      boundProviderChatId ?? null, null, [], [ackStatus === "MISSING" ? "OWNER_ACK_MISSING" : "OWNER_ACK_MISMATCH"]);
  }

  const contexts: OwnerVideo2AudioHistoryResultContext[] = [];
  const gaps: OwnerVideo2AudioHistoryGapCode[] = [];
  for (const row of rows) {
    if (row.author_id !== -1 || row.message_object.length === 0) continue;
    const mismatchedModel = row.message_object.some((object) => object.model_type !== undefined && object.model_type !== null &&
      object.model_type !== MODEL_ID);
    if (mismatchedModel) { gaps.push("RESULT_OBJECT_MODEL_MISMATCH"); continue; }
    const ids = row.message_object.map((object) => providerId(object.id));
    if (ids.some((id) => id === undefined) || new Set(ids).size !== ids.length) { gaps.push("RESULT_OBJECT_IDS_INVALID"); continue; }
    contexts.push(Object.freeze({ chat_uuid: snapshot.chatUuid, message_id: row.id, model_id: MODEL_ID,
      provider_chat_id: boundProviderChatId!, message_object_ids: Object.freeze(ids as string[]),
      owner_echo_message_id: snapshot.ownerEchoMessageId }));
  }
  const status = contexts.length === 0 && gaps.length === 0 ? "PENDING" : gaps.length > 0 ? "INCOMPLETE" : "COMPLETE";
  if (contexts.length === 0 && gaps.length === 0) gaps.push("BOT_RESULT_NOT_OBSERVED");
  return historyResult(status, "MATCHED", "COMPLETE", boundProviderChatId ?? null, snapshot.ownerEchoMessageId, contexts, gaps);
}

/** Decodes one GET result message; read-context data alone grants no ownership or result-read authority. */
export function decodeOwnerVideo2AudioResult(rawInput: unknown, contextInput: unknown): OwnerVideo2AudioResult {
  let context: Readonly<OwnerVideo2AudioResultReadContext>;
  try { context = snapshotResultContext(contextInput); }
  catch { throw new TypeError("INVALID_OWNER_VIDEO2AUDIO_RESULT_CONTEXT"); }

  const raw = readRecord(rawInput, ["id", "chat_id", "author_id", "message_object"], ["created_at", "updated_at", "is_favorite"]);
  if (!raw) return unverified("UNKNOWN", [gap(null, "ENVELOPE_SHAPE_INVALID")]);
  if (providerId(raw.values.id) !== context.message_id) return unverified("MISMATCH", [gap(null, "OUTER_MESSAGE_ID_MISMATCH")]);
  if (raw.values.author_id !== -1) return unverified("MISMATCH", [gap(null, "NOT_BOT_MESSAGE")]);
  if (providerChatId(raw.values.chat_id) !== context.provider_chat_id) return unverified("MISMATCH", [gap(null, "PROVIDER_CHAT_ID_MISMATCH")]);

  const gaps: OwnerVideo2AudioResult["gaps"][number][] = [];
  if (raw.unknownFieldCount > 0) gaps.push(gap(null, "UNRECOGNIZED_MESSAGE_FIELDS"));
  const objects = readArray(raw.values.message_object, MAX_MESSAGE_OBJECTS);
  if (objects.status === "INVALID") return unverified("UNKNOWN", [...gaps, gap(null, "MESSAGE_OBJECT_ARRAY_INVALID")]);
  if (objects.status === "OVER_LIMIT") return unverified("UNKNOWN", [...gaps, gap(null, "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT")]);
  if (objects.values.length === 0) gaps.push(gap(null, "MESSAGE_OBJECT_ARRAY_EMPTY"));

  const expectedIds = new Set(context.message_object_ids);
  const seenIds = new Set<string>();
  const observedExpectedIds = new Set<string>();
  const ready: OwnerVideo2AudioReadyArtifact[] = [];
  let modelEcho: OwnerVideo2AudioResult["model_echo"] = "MATCHED";
  let modelMismatch = false;

  for (let index = 0; index < objects.values.length; index += 1) {
    const object = readRecord(objects.values[index], ["id", "message_id", "object_type", "model_type", "object_url", "completed"],
      ["object_text", "created_at", "updated_at", "task_id", "metadata"]);
    if (!object) { gaps.push(gap(index, "OBJECT_ENTRY_INVALID")); continue; }
    if (object.unknownFieldCount > 0) gaps.push(gap(index, "UNRECOGNIZED_OBJECT_FIELDS"));
    const objectId = providerId(object.values.id);
    if (objectId === undefined) { gaps.push(gap(index, "OBJECT_ID_UNAVAILABLE")); continue; }
    if (seenIds.has(objectId)) { gaps.push(gap(index, "OBJECT_ID_DUPLICATE")); continue; }
    seenIds.add(objectId);
    if (!expectedIds.has(objectId)) { gaps.push(gap(index, "OBJECT_ID_UNEXPECTED")); continue; }
    observedExpectedIds.add(objectId);
    if (object.values.message_id !== undefined && providerId(object.values.message_id) !== context.message_id) {
      gaps.push(gap(index, "OBJECT_MESSAGE_ID_MISMATCH")); continue;
    }
    const objectType = object.values.object_type;
    if (objectType !== "video" && objectType !== "audio") { gaps.push(gap(index, "OBJECT_TYPE_UNSUPPORTED")); continue; }

    const echoedModel = object.values.model_type;
    let objectModelEcho: "MATCHED" | "UNKNOWN" = "MATCHED";
    if (echoedModel === undefined || echoedModel === null) {
      modelEcho = modelEcho === "MISMATCH" ? modelEcho : "UNKNOWN";
      objectModelEcho = "UNKNOWN";
      gaps.push(gap(index, "MODEL_TYPE_UNAVAILABLE"));
    } else if (echoedModel !== context.model_id) {
      modelEcho = "MISMATCH";
      modelMismatch = true;
      gaps.push(gap(index, "MODEL_TYPE_MISMATCH"));
      continue;
    }
    if (object.values.completed !== true) {
      gaps.push(gap(index, object.values.completed === false ? "OBJECT_INCOMPLETE" : "OBJECT_COMPLETION_UNKNOWN"));
      continue;
    }
    if (object.values.object_url === undefined || object.values.object_url === null || object.values.object_url === "") {
      gaps.push(gap(index, "OBJECT_URL_MISSING")); continue;
    }
    if (typeof object.values.object_url !== "string") { gaps.push(gap(index, "OBJECT_URL_INVALID")); continue; }
    if (!isSafeUploadReferenceUrl(object.values.object_url)) { gaps.push(gap(index, "OBJECT_URL_UNSAFE")); continue; }
    const mimeType = inferMimeType(objectType, object.values.object_url);
    if (mimeType === null) gaps.push(gap(index, "MIME_TYPE_UNKNOWN"));
    ready.push(Object.freeze({ object_index: index, message_object_id: objectId, object_type: objectType,
      object_url: object.values.object_url, mime_type: mimeType, mime_source: mimeType === null ? "UNKNOWN" : "URL_EXTENSION_LOCAL_POLICY",
      model_echo: objectModelEcho }));
  }

  for (const expectedId of context.message_object_ids) {
    if (!observedExpectedIds.has(expectedId)) gaps.push(gap(null, "EXPECTED_OBJECT_ID_MISSING"));
  }
  if (modelMismatch) return unverified("MISMATCH", gaps);
  return bound(modelEcho, ready, gaps);
}

interface HistoryInputSnapshot { readonly chatUuid: string; readonly ownerEchoMessageId: string; readonly prompt: string; readonly pages: readonly unknown[] }
interface HistoryRow { readonly id: string; readonly chat_id: string; readonly author_id: number; readonly message_object: readonly Readonly<Record<string, unknown>>[] }

function snapshotHistoryInput(value: unknown): HistoryInputSnapshot | null {
  const record = readRecord(value, ["chat_uuid", "model_id", "owner_echo_message_id", "prompt", "pages"]);
  if (!record || record.unknownFieldCount !== 0 || record.values.model_id !== MODEL_ID || !isSafeId(record.values.chat_uuid) ||
      !isSafeId(record.values.owner_echo_message_id) || typeof record.values.prompt !== "string" || record.values.prompt.trim().length === 0 ||
      record.values.prompt.length > 5_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(record.values.prompt) ||
      !Array.isArray(record.values.pages) || types.isProxy(record.values.pages)) return null;
  return Object.freeze({ chatUuid: record.values.chat_uuid, ownerEchoMessageId: record.values.owner_echo_message_id,
    prompt: record.values.prompt, pages: record.values.pages });
}

function isPositiveOwnerAck(row: HistoryRow, prompt: string): boolean {
  if (row.author_id <= 0 || row.message_object.length !== 1) return false;
  const object = row.message_object[0]!;
  return object.object_type === "text" && typeof object.object_text === "string" &&
    (object.object_text === prompt || object.object_text === `🎵 ${prompt}`) &&
    object.object_text.trim().length > 0 && object.model_type === MODEL_ID;
}

function snapshotResultContext(value: unknown): Readonly<OwnerVideo2AudioResultReadContext> {
  const record = readRecord(value, ["chat_uuid", "message_id", "model_id", "provider_chat_id", "message_object_ids", "owner_echo_message_id"]);
  if (!record || record.unknownFieldCount > 0 || !isSafeId(record.values.chat_uuid) || !isSafeId(record.values.message_id) ||
      record.values.model_id !== MODEL_ID || !isSafeProviderChatId(record.values.provider_chat_id) || !isSafeId(record.values.owner_echo_message_id)) {
    throw new TypeError("INVALID_OWNER_VIDEO2AUDIO_RESULT_CONTEXT");
  }
  const ids = readArray(record.values.message_object_ids, MAX_MESSAGE_OBJECTS);
  if (ids.status !== "OK" || ids.values.length === 0 || ids.values.some((id) => !isSafeId(id)) || new Set(ids.values).size !== ids.values.length) {
    throw new TypeError("INVALID_OWNER_VIDEO2AUDIO_RESULT_CONTEXT");
  }
  return Object.freeze({ chat_uuid: record.values.chat_uuid, message_id: record.values.message_id, model_id: MODEL_ID,
    provider_chat_id: record.values.provider_chat_id, message_object_ids: Object.freeze([...ids.values]) as readonly string[],
    owner_echo_message_id: record.values.owner_echo_message_id });
}

function readRecord(value: unknown, knownKeys: readonly string[], recognizedUnconsumedKeys: readonly string[] = []): DataRecord | null {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    let unknownFieldCount = 0;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string") { unknownFieldCount += 1; continue; }
      const descriptor = descriptors[key]!;
      if (!("value" in descriptor) || !descriptor.enumerable) return null;
      if (knownKeys.includes(key)) values[key] = descriptor.value;
      else if (!recognizedUnconsumedKeys.includes(key)) unknownFieldCount += 1;
    }
    return Object.freeze({ values: Object.freeze(values), unknownFieldCount });
  } catch { return null; }
}

function readArray(value: unknown, maximum: number): ArrayRead {
  try {
    if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return Object.freeze({ status: "INVALID" });
    if (value.length > maximum) return Object.freeze({ status: "OVER_LIMIT" });
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== value.length + 1 || !keys.includes("length") || keys.some((key) => key !== "length" &&
        (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length ||
          !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) return Object.freeze({ status: "INVALID" });
    const values: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return Object.freeze({ status: "INVALID" });
      values.push(descriptor.value);
    }
    return Object.freeze({ status: "OK", values: Object.freeze(values) });
  } catch { return Object.freeze({ status: "INVALID" }); }
}

function providerId(value: unknown): string | undefined {
  if (typeof value === "string") return isSafeId(value) ? value : undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return undefined;
}
function providerChatId(value: unknown): string | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined;
}
function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function isSafeProviderChatId(value: unknown): value is string { return typeof value === "string" && SAFE_PROVIDER_CHAT_ID.test(value); }
function positiveInteger(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0; }
function positiveIntegerOrZero(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function inferMimeType(type: "video" | "audio", url: string): OwnerVideo2AudioReadyArtifact["mime_type"] {
  let pathname: string;
  try { pathname = new URL(url).pathname; } catch { return null; }
  const extension = /\.([A-Za-z0-9]{1,8})$/u.exec(pathname)?.[1]?.toLowerCase();
  if (type === "video") {
    if (extension === "mp4") return "video/mp4";
    if (extension === "mov") return "video/quicktime";
  } else {
    if (extension === "mp3") return "audio/mpeg";
    if (extension === "wav") return "audio/wav";
    if (extension === "m4a" || extension === "mp4") return "audio/mp4";
  }
  return null;
}
function gap(objectIndex: number | null, code: OwnerVideo2AudioResultGapCode) { return Object.freeze({ object_index: objectIndex, code }); }
function bound(modelEcho: OwnerVideo2AudioResult["model_echo"], artifacts: readonly OwnerVideo2AudioReadyArtifact[],
  gaps: readonly OwnerVideo2AudioResult["gaps"][number][]): OwnerVideo2AudioResult {
  return Object.freeze({ message_binding: "BOUND", model_echo: modelEcho, ready_artifacts: Object.freeze([...artifacts]),
    gaps: Object.freeze([...gaps]), backend_acceptance: "UNPROVEN" });
}
function unverified(modelEcho: OwnerVideo2AudioResult["model_echo"], gaps: readonly OwnerVideo2AudioResult["gaps"][number][]): OwnerVideo2AudioResult {
  return Object.freeze({ message_binding: "UNVERIFIED", model_echo: modelEcho, ready_artifacts: Object.freeze([]),
    gaps: Object.freeze([...gaps]), backend_acceptance: "UNPROVEN" });
}
function historyResult(status: OwnerVideo2AudioHistoryCorrelation["status"], ack: OwnerVideo2AudioHistoryCorrelation["owner_ack_status"],
  pageStatus: OwnerVideo2AudioHistoryCorrelation["history_page_status"], providerChatId: string | null, ownerEchoMessageId: string | null,
  contexts: readonly OwnerVideo2AudioHistoryResultContext[], gaps: readonly OwnerVideo2AudioHistoryGapCode[]): OwnerVideo2AudioHistoryCorrelation {
  return Object.freeze({ status, owner_ack_status: ack, history_page_status: pageStatus, provider_chat_id: providerChatId,
    owner_echo_message_id: ownerEchoMessageId, contexts: Object.freeze([...contexts]), gaps: Object.freeze([...gaps]), backend_acceptance: "UNPROVEN" });
}
