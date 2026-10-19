import { types } from "node:util";
import { SyntxChatHttpClient } from "./chat-http-client.js";
import type { OwnerHailuoInitialModelId } from "../../application/owner-hailuo-media-parameters.js";
import type { OwnerHailuoInitialWireCandidate } from "../../application/owner-hailuo-media-wire.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const CHATS = new WeakMap<object, Readonly<{ client: object; context: OwnerHailuoInitialChatContext; method: unknown }>>();
const UPLOADS = new WeakMap<object, Readonly<{ client: object; context: OwnerHailuoInitialUploadContext; url: string; method: unknown }>>();
const OPERATIONS = new WeakMap<object, Operation>();
const BY_CLIENT = new WeakMap<object, Set<Operation>>();
const RESULTS = new WeakMap<object, Readonly<{ operation: Operation; row: unknown }>>();
const createMethod = () => Reflect.get(SyntxChatHttpClient.prototype, "createOwnerHailuoInitialChat");
const uploadMethod = () => Reflect.get(SyntxChatHttpClient.prototype, "uploadOwnerHailuoInitialImage");

export interface OwnerHailuoInitialChatContext {
  readonly status: "created"; readonly chat_uuid: string; readonly attempt_id: string;
  readonly model_id: OwnerHailuoInitialModelId; readonly scope: "video"; readonly generation_permit: false;
}
export interface OwnerHailuoInitialUploadContext {
  readonly status: "uploaded"; readonly model_id: OwnerHailuoInitialModelId; readonly destination: "uploaded" | "hidden";
  readonly mime_type: "image/jpeg" | "image/png" | "image/webp"; readonly size: number; readonly sha256: string;
  readonly width: number; readonly height: number; readonly provider_acceptance: "UNPROVEN"; readonly generation_permit: false;
}
export interface OwnerHailuoInitialOperationInput {
  readonly client: SyntxChatHttpClient; readonly token: object; readonly attempt_id: string;
  readonly model_id: OwnerHailuoInitialModelId; readonly chat: OwnerHailuoInitialChatContext;
  readonly wire: OwnerHailuoInitialWireCandidate;
}
interface Operation {
  readonly client: SyntxChatHttpClient; readonly token: object; readonly attempt: string; readonly model: OwnerHailuoInitialModelId;
  readonly chat: OwnerHailuoInitialChatContext; readonly wire: OwnerHailuoInitialWireCandidate;
  phase: "READY" | "POSTED" | "INVALID"; ack: string | null; ownerEcho: string | null;
  responseStatus?: number; transportCode?: string;
}

export function createOwnerHailuoInitialChatContext(client: unknown, value: unknown): OwnerHailuoInitialChatContext {
  const nativeMethod = createMethod();
  if (!isExactClient(client) || typeof nativeMethod !== "function") return invalid();
  const fields = exact(value, ["chat_uuid", "attempt_id", "model_id"]);
  if (typeof fields.chat_uuid !== "string" || !ID.test(fields.chat_uuid) || typeof fields.attempt_id !== "string" ||
      !ATTEMPT.test(fields.attempt_id) || !isModel(fields.model_id)) return invalid();
  const context = Object.freeze({ status: "created" as const, chat_uuid: fields.chat_uuid, attempt_id: fields.attempt_id,
    model_id: fields.model_id, scope: "video" as const, generation_permit: false as const });
  CHATS.set(context, Object.freeze({ client: client as object, context, method: nativeMethod })); return context;
}
export function isOwnerHailuoInitialChatContextForClient(client: unknown, value: unknown, attempt: unknown): boolean {
  if (!isExactClient(client) || !value || typeof value !== "object" || types.isProxy(value) || typeof attempt !== "string" || !ATTEMPT.test(attempt)) return false;
  const state = CHATS.get(value);
  return state?.client === client && state.method === createMethod() && state.context === value && state.context.attempt_id === attempt &&
    state.context.status === "created" && state.context.scope === "video" && state.context.generation_permit === false;
}
export function createOwnerHailuoInitialUploadContext(client: unknown, url: unknown, value: unknown): OwnerHailuoInitialUploadContext {
  const nativeMethod = uploadMethod();
  if (!isExactClient(client) || typeof nativeMethod !== "function" || typeof url !== "string" || !safeUrl(url)) return invalid();
  const fields = exact(value, ["model_id", "destination", "mime_type", "size", "sha256", "width", "height"]);
  if (!isModel(fields.model_id) || (fields.destination !== "uploaded" && fields.destination !== "hidden") ||
      !["image/jpeg", "image/png", "image/webp"].includes(String(fields.mime_type)) ||
      !Number.isSafeInteger(fields.size) || (fields.size as number) < 1 || typeof fields.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(fields.sha256) || !Number.isSafeInteger(fields.width) || (fields.width as number) < 1 ||
      !Number.isSafeInteger(fields.height) || (fields.height as number) < 1) return invalid();
  const context = Object.freeze({ status: "uploaded" as const, model_id: fields.model_id, destination: fields.destination,
    mime_type: fields.mime_type, size: fields.size, sha256: fields.sha256, width: fields.width, height: fields.height,
    provider_acceptance: "UNPROVEN" as const, generation_permit: false as const }) as OwnerHailuoInitialUploadContext;
  UPLOADS.set(context, Object.freeze({ client: client as object, context, url, method: nativeMethod })); return context;
}
export function readOwnerHailuoInitialUploadReferenceForClient(client: unknown, value: unknown): Readonly<{ type: "image"; url: string }> | null {
  if (!isExactClient(client) || !value || typeof value !== "object" || types.isProxy(value)) return null;
  const state = UPLOADS.get(value);
  if (!state || state.client !== client || state.context !== value || state.method !== uploadMethod() || !safeUrl(state.url)) return null;
  const context = value as OwnerHailuoInitialUploadContext;
  return context.status === "uploaded" && context.model_id === state.context.model_id && context.destination === state.context.destination &&
    context.mime_type === state.context.mime_type && context.size === state.context.size && context.sha256 === state.context.sha256 &&
    context.width === state.context.width && context.height === state.context.height && context.provider_acceptance === "UNPROVEN" &&
    context.generation_permit === false ? Object.freeze({ type: "image", url: state.url }) : null;
}
export function registerOwnerHailuoInitialOperation(input: OwnerHailuoInitialOperationInput): void {
  if (!isExactClient(input.client) || !isOwnerHailuoInitialChatContextForClient(input.client, input.chat, input.attempt_id) ||
      input.chat.model_id !== input.model_id || input.wire.model_id !== input.model_id || OPERATIONS.has(input.token)) return invalid();
  const row: Operation = { client: input.client, token: input.token, attempt: input.attempt_id, model: input.model_id,
    chat: input.chat, wire: input.wire, phase: "READY", ack: null, ownerEcho: null };
  OPERATIONS.set(input.token, row);
  const rows = BY_CLIENT.get(input.client) ?? new Set<Operation>(); rows.add(row); BY_CLIENT.set(input.client, rows);
}
export function consumeOwnerHailuoInitialOperation(client: SyntxChatHttpClient, token: unknown): Readonly<{ chat_uuid: string; body: Record<string, unknown> }> {
  const operation = operationFor(client, token);
  if (operation.phase !== "READY" || !isOwnerHailuoInitialChatContextForClient(client, operation.chat, operation.attempt)) return invalid();
  operation.phase = "POSTED";
  return Object.freeze({ chat_uuid: operation.chat.chat_uuid,
    body: Object.freeze({ chat_id: operation.chat.chat_uuid, prompt: operation.wire.wire.prompt, settings: operation.wire.wire.settings }) });
}
export function readOwnerHailuoInitialHistoryRoute(client: SyntxChatHttpClient, token: unknown): string {
  const operation = operationFor(client, token); if (operation.phase !== "POSTED") return invalid(); return operation.chat.chat_uuid;
}
export function readOwnerHailuoInitialResultRoute(client: SyntxChatHttpClient, context: unknown): Readonly<{ chat_uuid: string; message_id: string }> {
  const state = context && typeof context === "object" && !types.isProxy(context) ? RESULTS.get(context) : undefined;
  if (!state || state.operation.client !== client || state.operation.phase !== "POSTED") return invalid();
  const row = state.row as Record<string, unknown>;
  return Object.freeze({ chat_uuid: state.operation.chat.chat_uuid, message_id: String(row.id) });
}
export function bindOwnerHailuoInitialAck(client: unknown, token: unknown, ack: unknown): boolean {
  const operation = tryOperation(client, token);
  if (!operation || operation.phase !== "POSTED" || typeof ack !== "string" || !ID.test(ack)) return false;
  operation.ack = ack; return true;
}
export function bindOwnerHailuoInitialOwnerEcho(client: unknown, token: unknown, rowInput: unknown): boolean {
  const operation = tryOperation(client, token), row = readHistoryRow(rowInput);
  if (!operation || operation.phase !== "POSTED" || !row || row.author_id <= 0 || (operation.ack && row.id !== operation.ack)) return false;
  operation.ownerEcho = row.id; return true;
}
export function bindOwnerHailuoInitialResultContext(client: unknown, token: unknown, rowInput: unknown): object | null {
  const operation = tryOperation(client, token), row = readHistoryRow(rowInput);
  if (!operation || operation.phase !== "POSTED" || !operation.ownerEcho || !row || row.author_id !== -1 ||
      !Array.isArray((rowInput as Record<string, unknown>).message_object) ||
      !(rowInput as { message_object: Array<Record<string, unknown>> }).message_object.some(item => item.object_type === "video")) return null;
  const context = Object.freeze({ status: "owned-result" as const, chat_uuid: operation.chat.chat_uuid, message_id: row.id,
    model_id: operation.model, attempt_id: operation.attempt });
  RESULTS.set(context, Object.freeze({ operation, row: rowInput })); return context;
}
export function invalidateOwnerHailuoInitialOperations(client: unknown, attempt?: string): void {
  if (!client || typeof client !== "object" || types.isProxy(client) || (attempt !== undefined && !ATTEMPT.test(attempt))) return;
  for (const operation of BY_CLIENT.get(client) ?? []) if (attempt === undefined || operation.attempt === attempt) operation.phase = "INVALID";
}
export function recordOwnerHailuoInitialTransport(client: unknown, token: unknown, _observed: unknown): void {
  const operation = tryOperation(client, token); if (!operation || operation.phase !== "POSTED") return;
  if (typeof _observed === "number" && Number.isInteger(_observed) && _observed >= 100 && _observed <= 599 &&
      operation.responseStatus === undefined) operation.responseStatus = _observed;
  if (typeof _observed === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(_observed) && operation.transportCode === undefined) {
    operation.transportCode = _observed;
  }
}
export function readOwnerHailuoInitialTransport(client: unknown, token: unknown): Readonly<{ status?: number; code?: string }> {
  const operation = tryOperation(client, token);
  if (!operation) return Object.freeze({});
  return Object.freeze({ ...(operation.responseStatus === undefined ? {} : { status: operation.responseStatus }),
    ...(operation.transportCode === undefined ? {} : { code: operation.transportCode }) });
}
function operationFor(client: unknown, token: unknown): Operation {
  const row = tryOperation(client, token); if (!row || row.phase === "INVALID") return invalid(); return row;
}
function tryOperation(client: unknown, token: unknown): Operation | undefined {
  if (!token || typeof token !== "object" || types.isProxy(token)) return undefined;
  const operation = OPERATIONS.get(token); return operation && operation.client === client && operation.token === token ? operation : undefined;
}
function readHistoryRow(value: unknown): Readonly<{ id: string; chat_id: string | number; author_id: number }> | null {
  if (!value || typeof value !== "object" || types.isProxy(value)) return null;
  const row = value as Record<string, unknown>;
  const id = normalizeProviderId(row.id), chatId = normalizeProviderId(row.chat_id);
  return id !== null && chatId !== null && Number.isSafeInteger(row.author_id)
    ? Object.freeze({ id, chat_id: chatId, author_id: row.author_id as number }) : null;
}
function normalizeProviderId(value: unknown): string | null {
  const id = typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : value;
  return typeof id === "string" && ID.test(id) ? id : null;
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some(key => typeof key !== "string" || !keys.includes(key) ||
      !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) return invalid();
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys) result[key] = descriptors[key]!.value; return result;
}
function isExactClient(value: unknown): value is SyntxChatHttpClient {
  try {
    return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === SyntxChatHttpClient.prototype &&
      !Object.hasOwn(value, "createOwnerHailuoInitialChat") && !Object.hasOwn(value, "uploadOwnerHailuoInitialImage") &&
      Reflect.get(value, "createOwnerHailuoInitialChat") === createMethod() &&
      Reflect.get(value, "uploadOwnerHailuoInitialImage") === uploadMethod();
  } catch { return false; }
}
function safeUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && (url.hostname === "syntx.ai" || url.hostname.endsWith(".syntx.ai")); }
  catch { return false; }
}
function isModel(value: unknown): value is OwnerHailuoInitialModelId {
  return value === "hailuo-2.3-fast" || value === "hailuo-01-live-character" || value === "hailuo-3.0";
}
function invalid(): never { throw new Error("OWNER_HAILUO_INITIAL_NATIVE_CONTEXT_INVALID"); }
