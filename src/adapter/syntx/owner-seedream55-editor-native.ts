import { isProxy } from "node:util/types";
import { schemaHash } from "../../domain/generation-contract.js";
import { getOwnerSeedream55EditorSourceProfile } from "../../application/owner-seedream55-editor-source-profile.js";
import { consumeOwnerSeedream55EditorDispatchToken,
  type OwnerSeedream55EditorDispatchToken } from "../../application/owner-seedream55-editor-service.js";
import type { ChatMessageHistorySnapshot } from "./chat-http-client.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";
import { decodeOwnerSeedreamEditorImageResult } from "./owner-seedream-editor-image-result.js";
import { correlateOwnerSeedreamEditorImageHistoryBinding } from "../../application/owner-seedream-editor-image-history-binding.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MAX_CHATS = 128;
const MAX_IMAGE_BYTES = 27_525_120;
const MAX_DRAWING_BYTES = 32 * 1024 * 1024;
const ORIGINAL_MIMES = new Set(["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/webp", "image/gif", "image/tiff", "image/heic", "image/heif"]);

export interface OwnerSeedream55EditorNativePort {
  createChat(title: string, signal?: AbortSignal): Promise<{ readonly chat_uuid: string }>;
  uploadOriginal(input: Readonly<{ bytes: Uint8Array; filename: string; mime_type: string }>, signal?: AbortSignal): Promise<{ readonly url: string; readonly file_id?: string }>;
  uploadDrawing(input: Readonly<{ bytes: Uint8Array; filename: string; mime_type: "image/png" }>, signal?: AbortSignal): Promise<{ readonly url: string; readonly file_id?: string }>;
  postGenerate(input: Readonly<{ chat_uuid: string; prompt: string; settings: Readonly<Record<string, unknown>> }>, signal?: AbortSignal): Promise<{ readonly message_id: string }>;
  getHistoryPage(chatUuid: string, page: number, signal?: AbortSignal): Promise<unknown>;
  getRawResult(chatUuid: string, messageId: string, signal?: AbortSignal): Promise<unknown>;
}
export interface OwnerSeedream55EditorDispatchRequest {
  readonly attemptId: string; readonly chat_uuid: string; readonly prompt: string;
  readonly settings: Readonly<{ stream: false; model_type: "seedream-5.5"; aspect_ratio: string; resolution: string;
    output_format: "jpeg" | "png"; background: "auto" | "opaque" | "transparent";
    file_urls: readonly Readonly<{ type: "image"; url: string }>[] }>;
  readonly profile_schema_hash: string; readonly request_fingerprint: string;
}
interface ChatState { readonly attemptId: string; readonly chat_uuid: string; phase: "AVAILABLE" | "POST_UNKNOWN" | "ACKNOWLEDGED";
  ownerEchoMessageId: string | null; readonly epoch: number;
  request: OwnerSeedream55EditorDispatchRequest | null }
export interface OwnerSeedream55EditorNativeObservation {
  readonly status: "COMPLETE" | "PENDING" | "UNVERIFIED";
  readonly reason: string | null;
  readonly artifacts: readonly Readonly<{ url: string; mime_type: string | null; message_id: string;
    message_object_id: string | null; object_index: number }>[];
  readonly history_get_calls: number;
  readonly result_get_calls: number;
}
export class OwnerSeedream55EditorNativeError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "SOURCE_BINDING_MISMATCH" | "OUTCOME_UNKNOWN" | "CHAT_UNAVAILABLE" | "UPLOAD_OUTCOME_UNKNOWN") {
    super("Seedream 5.5 Editor native operation is unavailable."); this.name = "OwnerSeedream55EditorNativeError";
  }
}
export class OwnerSeedream55EditorNative {
  readonly #port: OwnerSeedream55EditorNativePort;
  readonly #chats = new Map<string, ChatState>();
  readonly #epochs = new Map<string, number>();
  #closed = false;
  constructor(port: OwnerSeedream55EditorNativePort) {
    if (!port || typeof port !== "object" || isProxy(port) ||
        ["createChat", "uploadOriginal", "uploadDrawing", "postGenerate", "getHistoryPage", "getRawResult"]
          .some((key) => typeof (port as unknown as Record<string, unknown>)[key] !== "function")) fail("INVALID_REQUEST");
    this.#port = port; Object.freeze(this);
  }
  async createChat(input: Readonly<{ attemptId: string; title: string }>, signal?: AbortSignal) {
    this.#assertOpen();
    const fields = readExact(input, ["attemptId", "title"]);
    if (!fields || !isAttempt(fields.attemptId) || typeof fields.title !== "string" || fields.title.trim().length === 0 ||
        Buffer.byteLength(fields.title, "utf8") > 512 || this.#chats.size >= MAX_CHATS || signal?.aborted) fail("INVALID_REQUEST");
    const attemptId = fields.attemptId, title = fields.title;
    const epoch = this.#epochs.get(attemptId) ?? 0;
    let receipt: { readonly chat_uuid: string };
    try { receipt = await this.#port.createChat(title, signal); } catch { fail("CHAT_UNAVAILABLE"); }
    const response = readExact(receipt, ["chat_uuid"]);
    if (this.#closed || (this.#epochs.get(attemptId) ?? 0) !== epoch || signal?.aborted ||
        !isId(response?.chat_uuid) || this.#chats.has(response.chat_uuid)) fail("CHAT_UNAVAILABLE");
    const state: ChatState = { attemptId, chat_uuid: response.chat_uuid,
      phase: "AVAILABLE", ownerEchoMessageId: null, epoch, request: null };
    this.#chats.set(response.chat_uuid, state);
    return Object.freeze({ chat_uuid: response.chat_uuid });
  }
  async uploadOriginal(input: Readonly<{ attemptId: string; bytes: Uint8Array; filename: string; mime_type: string }>, signal?: AbortSignal) {
    this.#assertOpen();
    const fields = readExact(input, ["attemptId", "bytes", "filename", "mime_type"]);
    if (!fields || !isAttempt(fields.attemptId) || !plainBytes(fields.bytes, MAX_IMAGE_BYTES) || !safeFilename(fields.filename) ||
        !ORIGINAL_MIMES.has(fields.mime_type as string) || signal?.aborted) fail("INVALID_REQUEST");
    const epoch = this.#epochs.get(fields.attemptId) ?? 0;
    try { const uploaded = snapshotUpload(await this.#port.uploadOriginal({ bytes: fields.bytes, filename: fields.filename, mime_type: fields.mime_type as string }, signal));
      if (this.#closed || (this.#epochs.get(fields.attemptId) ?? 0) !== epoch || signal?.aborted) fail("UPLOAD_OUTCOME_UNKNOWN");
      return uploaded; }
    catch { fail("UPLOAD_OUTCOME_UNKNOWN"); }
  }
  async uploadDrawing(input: Readonly<{ attemptId: string; bytes: Uint8Array; filename: string; mime_type: "image/png" }>, signal?: AbortSignal) {
    this.#assertOpen();
    const fields = readExact(input, ["attemptId", "bytes", "filename", "mime_type"]);
    if (!fields || !isAttempt(fields.attemptId) || !plainBytes(fields.bytes, MAX_DRAWING_BYTES) || !safeFilename(fields.filename) ||
        fields.mime_type !== "image/png" || signal?.aborted) fail("INVALID_REQUEST");
    const epoch = this.#epochs.get(fields.attemptId) ?? 0;
    try { const uploaded = snapshotUpload(await this.#port.uploadDrawing({ bytes: fields.bytes, filename: fields.filename, mime_type: "image/png" }, signal));
      if (this.#closed || (this.#epochs.get(fields.attemptId) ?? 0) !== epoch || signal?.aborted) fail("UPLOAD_OUTCOME_UNKNOWN");
      return uploaded; }
    catch { fail("UPLOAD_OUTCOME_UNKNOWN"); }
  }
  async start(input: Readonly<{ attemptId: string; chat_uuid: string; token: OwnerSeedream55EditorDispatchToken }>, signal?: AbortSignal) {
    this.#assertOpen();
    const fields = readExact(input, ["attemptId", "chat_uuid", "token"]);
    if (!fields) fail("INVALID_REQUEST");
    const state = this.#state(fields.attemptId, fields.chat_uuid);
    if (state.phase !== "AVAILABLE" || signal?.aborted) fail("INVALID_REQUEST");
    let request: OwnerSeedream55EditorDispatchRequest;
    try { request = consumeOwnerSeedream55EditorDispatchToken(this, fields.token as OwnerSeedream55EditorDispatchToken,
      state.attemptId, state.chat_uuid); }
    catch { fail("INVALID_REQUEST"); }
    const sourceHash = getOwnerSeedream55EditorSourceProfile().profile_schema_hash;
    const settings = snapshotSettings(request.settings);
    if (!settings || request.profile_schema_hash !== sourceHash || !SHA256.test(request.request_fingerprint) ||
        request.request_fingerprint !== schemaHash({ chat_uuid: state.chat_uuid, prompt: request.prompt,
          settings, source_profile: sourceHash })) fail("INVALID_REQUEST");
    state.phase = "POST_UNKNOWN"; state.request = deepFreeze({ ...request, settings });
    try {
      const receipt = await this.#port.postGenerate({ chat_uuid: state.chat_uuid, prompt: request.prompt,
        settings }, signal);
      const acknowledged = readExact(receipt, ["message_id"]);
      if (this.#closed || this.#chats.get(state.chat_uuid) !== state ||
          (this.#epochs.get(state.attemptId) ?? 0) !== state.epoch || signal?.aborted ||
          !isId(acknowledged?.message_id)) fail("OUTCOME_UNKNOWN");
      state.ownerEchoMessageId = acknowledged.message_id; state.phase = "ACKNOWLEDGED";
      return Object.freeze({ chat_uuid: state.chat_uuid, message_id: acknowledged.message_id });
    } catch { fail("OUTCOME_UNKNOWN"); }
  }
  async observe(input: Readonly<{ attemptId: string; chat_uuid: string }>, signal?: AbortSignal): Promise<OwnerSeedream55EditorNativeObservation> {
    this.#assertOpen();
    const fields = readExact(input, ["attemptId", "chat_uuid"]);
    if (!fields) fail("INVALID_REQUEST");
    const state = this.#state(fields.attemptId, fields.chat_uuid);
    if (state.phase !== "ACKNOWLEDGED" && state.phase !== "POST_UNKNOWN") fail("CHAT_UNAVAILABLE");
    if (signal?.aborted) fail("CHAT_UNAVAILABLE");
    const history = await readHistory(this.#port, state.chat_uuid, signal);
    this.#assertCurrent(state, signal);
    if (history.status !== "COMPLETE") return Object.freeze({ status: history.status,
      reason: history.reason, artifacts: [], history_get_calls: history.calls, result_get_calls: 0 });
    if (!state.ownerEchoMessageId) {
      const matched = history.ownerRows.filter((row) => exactOwnerEcho(row, state.request));
      if (matched.length !== 1) return Object.freeze({ status: "PENDING", reason: "OWNER_ACK_UNAVAILABLE",
        artifacts: [], history_get_calls: history.calls, result_get_calls: 0 });
      state.ownerEchoMessageId = matched[0]!.id;
    }
    const snapshot = asHistorySnapshot(history, state.chat_uuid, state.ownerEchoMessageId);
    const binding = correlateOwnerSeedreamEditorImageHistoryBinding({ snapshot,
      requested_chat_uuid: state.chat_uuid, owner_echo_message_id: state.ownerEchoMessageId, variant: "seedream-5.5" });
    if (binding.status !== "BOUND") return Object.freeze({ status: binding.status === "PENDING" ? "PENDING" : "UNVERIFIED",
      reason: binding.reason, artifacts: [], history_get_calls: history.calls, result_get_calls: 0 });
    if (binding.gaps.length || binding.model_echo !== "MATCHED" || binding.candidate_message_ids.length < 1 ||
        binding.candidate_message_ids.length > 64) return Object.freeze({ status: "UNVERIFIED", reason: "HISTORY_BINDING_GAP",
      artifacts: [], history_get_calls: history.calls, result_get_calls: 0 });
    const artifacts: OwnerSeedream55EditorNativeObservation["artifacts"][number][] = [];
    let resultGets = 0;
    for (const messageId of binding.candidate_message_ids) {
      const raw = await this.#port.getRawResult(state.chat_uuid, messageId, signal); resultGets += 1;
      this.#assertCurrent(state, signal);
      const decoded = decodeOwnerSeedreamEditorImageResult(raw, { chat_uuid: state.chat_uuid, message_id: messageId,
        variant: "seedream-5.5", provider_chat_id: binding.provider_chat_id });
      if (decoded.message_binding !== "BOUND" || decoded.model_echo !== "MATCHED" || decoded.gaps.length) return Object.freeze({
        status: "UNVERIFIED", reason: decoded.gaps[0]?.code ?? "RESULT_BINDING_GAP", artifacts: [],
        history_get_calls: history.calls, result_get_calls: resultGets });
      for (const image of decoded.ready_images) {
        if (!isSafeUploadReferenceUrl(image.object_url)) return Object.freeze({ status: "UNVERIFIED", reason: "RESULT_URL_UNSAFE",
          artifacts: [], history_get_calls: history.calls, result_get_calls: resultGets });
        artifacts.push(Object.freeze({ url: image.object_url, mime_type: image.mime_type, message_id: messageId,
          message_object_id: image.message_object_id ?? null, object_index: image.object_index }));
        if (artifacts.length > 64) return Object.freeze({ status: "UNVERIFIED", reason: "RESULT_CAPACITY_LIMIT",
          artifacts: [], history_get_calls: history.calls, result_get_calls: resultGets });
      }
    }
    return Object.freeze({ status: artifacts.length ? "COMPLETE" : "PENDING", reason: artifacts.length ? null : "NO_READY_IMAGES",
      artifacts: Object.freeze(artifacts), history_get_calls: history.calls, result_get_calls: resultGets });
  }
  invalidateAttempt(attemptId: string): void {
    if (!isAttempt(attemptId)) fail("INVALID_REQUEST");
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    for (const [id, state] of this.#chats) if (state.attemptId === attemptId) this.#chats.delete(id);
  }
  close(): void { this.#closed = true; for (const state of this.#chats.values())
    this.#epochs.set(state.attemptId, (this.#epochs.get(state.attemptId) ?? 0) + 1); this.#chats.clear(); }
  #assertCurrent(state: ChatState, signal?: AbortSignal): void {
    if (this.#closed || signal?.aborted || this.#chats.get(state.chat_uuid) !== state ||
        (this.#epochs.get(state.attemptId) ?? 0) !== state.epoch) fail("CHAT_UNAVAILABLE");
  }
  #state(attemptId: unknown, chatUuid: unknown): ChatState {
    if (!isAttempt(attemptId) || !isId(chatUuid)) fail("INVALID_REQUEST");
    const state = this.#chats.get(chatUuid);
    if (!state || state.attemptId !== attemptId) fail("CHAT_UNAVAILABLE");
    return state;
  }
  #assertOpen(): void { if (this.#closed) fail("CHAT_UNAVAILABLE"); }
}

export function createOwnerSeedream55EditorNative(port: OwnerSeedream55EditorNativePort): OwnerSeedream55EditorNative {
  return new OwnerSeedream55EditorNative(port);
}
interface HistoryRow { readonly id: string; readonly chatId: string; readonly authorId: number;
  readonly objects: readonly Readonly<{ id: string; messageId: string; type: string; model: string | null;
    text: string | null; url: string | null }>[] }
type HistoryRead =
  | Readonly<{ status: "COMPLETE"; calls: number; rows: readonly HistoryRow[]; ownerRows: readonly HistoryRow[];
      providerChatId: string; totalPages: number; reason: null }>
  | Readonly<{ status: "PENDING" | "UNVERIFIED"; calls: number; reason: string }>;
async function readHistory(port: OwnerSeedream55EditorNativePort, chatUuid: string, signal?: AbortSignal): Promise<HistoryRead> {
  const rows: HistoryRow[] = [], seenMessages = new Set<string>(), seenObjects = new Set<string>();
  let totalCount = -1, totalPages = -1, providerChatId: string | null = null, calls = 0;
  for (let page = 1; page <= 7; page += 1) {
    const raw = await port.getHistoryPage(chatUuid, page, signal); calls += 1;
    const root = readLoose(raw), pagination = readLoose(root?.pagination), messages = readDenseArray(root?.messages, 10);
    if (!root || !pagination || !messages || !Number.isSafeInteger(pagination.page) || pagination.page !== page ||
        pagination.page_size !== 10 || !Number.isSafeInteger(pagination.total_count) ||
        !Number.isSafeInteger(pagination.total_pages) || typeof pagination.has_next !== "boolean" ||
        typeof pagination.has_previous !== "boolean") return Object.freeze({ status: "UNVERIFIED", reason: "HISTORY_PAGE_INVALID", calls });
    if (page === 1) {
      totalCount = pagination.total_count as number; totalPages = pagination.total_pages as number;
      if (totalCount < 0 || totalCount > 64 || totalPages !== (totalCount === 0 ? 0 : Math.ceil(totalCount / 10)) ||
          totalPages > 7) return Object.freeze({ status: "UNVERIFIED", reason: "HISTORY_LOCAL_LIMIT", calls });
      if (totalCount === 0) return Object.freeze({ status: "PENDING", reason: "HISTORY_EMPTY", calls });
    }
    if (pagination.total_count !== totalCount || pagination.total_pages !== totalPages ||
        pagination.has_previous !== (page > 1) || pagination.has_next !== (page < totalPages) ||
        messages.length !== Math.min(10, totalCount - (page - 1) * 10))
      return Object.freeze({ status: "UNVERIFIED", reason: "HISTORY_PAGE_INVALID", calls });
    for (const rawRow of messages) {
      const row = readLoose(rawRow), id = canonicalId(row?.id), chatId = numericChatId(row?.chat_id);
      const authorId = row?.author_id;
      const objects = readDenseArray(row?.message_object, 64);
      if (!row || !id || !chatId || !Number.isSafeInteger(authorId) || !objects || seenMessages.has(id))
        return Object.freeze({ status: "UNVERIFIED", reason: "HISTORY_SHAPE_INVALID", calls });
      if (providerChatId === null) providerChatId = chatId;
      if (providerChatId !== chatId) return Object.freeze({ status: "UNVERIFIED", reason: "HISTORY_CHAT_MISMATCH", calls });
      seenMessages.add(id);
      const normalizedObjects: HistoryRow["objects"][number][] = [];
      for (const rawObject of objects) {
        const object = readLoose(rawObject), objectId = canonicalId(object?.id), messageId = canonicalId(object?.message_id);
        if (!object || !objectId || messageId !== id || seenObjects.has(objectId) ||
            typeof object.object_type !== "string" || !/^[A-Za-z0-9_]{1,80}$/u.test(object.object_type) ||
            !(object.model_type === undefined || object.model_type === null || typeof object.model_type === "string"))
          return Object.freeze({ status: "UNVERIFIED", reason: "HISTORY_OBJECT_INVALID", calls });
        seenObjects.add(objectId);
        normalizedObjects.push(Object.freeze({ id: objectId, messageId, type: object.object_type,
          model: typeof object.model_type === "string" ? object.model_type : null,
          text: typeof object.object_text === "string" ? object.object_text : null,
          url: typeof object.object_url === "string" ? object.object_url : null }));
      }
      rows.push(Object.freeze({ id, chatId, authorId: authorId as number, objects: Object.freeze(normalizedObjects) }));
    }
    if (page === totalPages) break;
  }
  if (rows.length !== totalCount || !providerChatId) return Object.freeze({ status: "UNVERIFIED", reason: "HISTORY_INCOMPLETE", calls });
  return Object.freeze({ status: "COMPLETE", reason: null, calls, rows: Object.freeze(rows),
    ownerRows: Object.freeze(rows.filter((row) => row.authorId > 0)), providerChatId, totalPages });
}
function exactOwnerEcho(row: HistoryRow, request: OwnerSeedream55EditorDispatchRequest | null): boolean {
  if (!request || row.authorId <= 0) return false;
  const texts = row.objects.filter((object) => object.type === "text");
  const images = row.objects.filter((object) => object.type === "image");
  if (texts.length !== 1 || texts[0]?.text !== request.prompt || texts[0]?.model !== "seedream-5.5" ||
      images.length !== request.settings.file_urls.length || row.objects.length !== texts.length + images.length) return false;
  return images.every((image, index) => image.model === "seedream-5.5" &&
    image.url === request.settings.file_urls[index]?.url);
}
function asHistorySnapshot(history: Extract<HistoryRead, { status: "COMPLETE" }>, chatUuid: string,
  ownerEchoMessageId: string): ChatMessageHistorySnapshot {
  return {
    complete: true, page: 1, page_size: 10, total_count: history.rows.length,
    total_pages: history.totalPages, has_next: false, has_previous: false,
    requested_chat_uuid: chatUuid, provider_chat_id: history.providerChatId,
    messages: history.rows.map((row) => ({ message_id: row.id, provider_chat_id: row.chatId,
      author_role: row.id === ownerEchoMessageId && row.authorId > 0 ? "owner" : row.authorId === -1 ? "bot" : "other",
      objects: row.objects.map((object) => ({ message_object_id: object.id, object_type: object.type,
        model_type: object.model })) }))
  };
}
function readLoose(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true) return null;
    result[key] = descriptors[key]!.value;
  }
  return result;
}
function readDenseArray(value: unknown, maximum: number): readonly unknown[] | null {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) return null;
  return Array.from({ length: value.length }, (_, index) => descriptors[String(index)]!.value);
}
function canonicalId(value: unknown): string | null {
  if (typeof value === "string" && SAFE_ID.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}
function numericChatId(value: unknown): string | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && String(value).length <= 16 ? String(value) : null;
}
function snapshotSettings(value: unknown): OwnerSeedream55EditorDispatchRequest["settings"] | null {
  const v = readExact(value, ["stream", "model_type", "aspect_ratio", "resolution", "output_format", "background", "file_urls"]);
  if (!v || v.stream !== false || v.model_type !== "seedream-5.5" || typeof v.aspect_ratio !== "string" ||
      !["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"].includes(v.aspect_ratio) ||
      !["1K", "1.5K", "2K"].includes(v.resolution as string) || !["jpeg", "png"].includes(v.output_format as string) ||
      !["auto", "opaque", "transparent"].includes(v.background as string) ||
      (v.background === "transparent" && v.output_format !== "png") ||
      !Array.isArray(v.file_urls) || isProxy(v.file_urls) || Object.getPrototypeOf(v.file_urls) !== Array.prototype ||
      v.file_urls.length < 1 || v.file_urls.length > 2) return null;
  const urls = v.file_urls as unknown[];
  const fileDescriptors = Object.getOwnPropertyDescriptors(urls);
  if (Reflect.ownKeys(fileDescriptors).length !== urls.length + 1 ||
      Reflect.ownKeys(fileDescriptors).some((key) => key !== "length" &&
        (typeof key !== "string" || !/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= urls.length))) return null;
  const seen = new Set<string>();
  const files: { type: "image"; url: string }[] = [];
  for (let index = 0; index < urls.length; index += 1) {
    const descriptor = fileDescriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return null;
    const item = readExact(descriptor.value, ["type", "url"]);
    if (!item || item.type !== "image" || typeof item.url !== "string" ||
        !isSafeUploadReferenceUrl(item.url) || seen.has(item.url)) return null;
    seen.add(item.url); files.push({ type: "image", url: item.url });
  }
  return deepFreeze({ stream: false, model_type: "seedream-5.5", aspect_ratio: v.aspect_ratio,
    resolution: v.resolution as "1K" | "1.5K" | "2K", output_format: v.output_format as "jpeg" | "png",
    background: v.background as "auto" | "opaque" | "transparent", file_urls: files });
}
function readExact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value)) return null;
  const proto = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value);
  if ((proto !== Object.prototype && proto !== null) || Reflect.ownKeys(descriptors).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(descriptors, key) || !("value" in descriptors[key]!) ||
        descriptors[key]!.enumerable !== true) ||
      Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !keys.includes(key))) return null;
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) result[key] = descriptors[key]!.value;
  return result;
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    if (!Object.isFrozen(value)) Object.freeze(value);
  }
  return value;
}
function snapshotUpload(input: unknown) {
  const withFileId = readExact(input, ["url", "file_id"]);
  const value = withFileId ?? readExact(input, ["url"]);
  if (!value || typeof value.url !== "string" || !isSafeUploadReferenceUrl(value.url) ||
      !(value.file_id === undefined || typeof value.file_id === "string" && SAFE_ID.test(value.file_id))) fail("UPLOAD_OUTCOME_UNKNOWN");
  return Object.freeze({ url: value.url, ...(value.file_id === undefined ? {} : { file_id: value.file_id }) });
}
function plainBytes(value: unknown, maximum: number): value is Uint8Array {
  return value instanceof Uint8Array && !isProxy(value) && value.byteLength > 0 && value.byteLength <= maximum;
}
function safeFilename(value: unknown): value is string {
  return typeof value === "string" && value !== "." && value !== ".." && value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= 255 && !/[\/\\\p{Cc}\p{Cf}\p{Cs}]/u.test(value);
}
function isAttempt(value: unknown): value is string { return typeof value === "string" && ATTEMPT.test(value); }
function isId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function fail(code: OwnerSeedream55EditorNativeError["code"]): never { throw new OwnerSeedream55EditorNativeError(code); }
