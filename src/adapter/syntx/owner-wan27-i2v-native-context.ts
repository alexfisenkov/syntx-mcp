import { types } from "node:util";
import { SyntxChatHttpClient } from "./chat-http-client.js";
import type { OwnerWan27I2vWireCandidate } from "../../application/owner-wan27-i2v-wire.js";
import type { OwnerWan27I2vImageMimeType } from "../../application/owner-wan27-i2v-image-policy.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u, ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const CHATS = new WeakMap<object, Readonly<{ client: object; context: OwnerWan27I2vChatContext; method: unknown }>>();
const UPLOADS = new WeakMap<object, Readonly<{ client: object; context: OwnerWan27I2vImageUploadContext; url: string; method: unknown }>>();
const OPERATIONS = new WeakMap<object, Operation>();
const BY_CLIENT = new WeakMap<object, Set<Operation>>();
const RESULTS = new WeakMap<object, Readonly<{ operation: Operation; row: unknown }>>();
const chatMethod = () => Reflect.get(SyntxChatHttpClient.prototype, "createOwnerWan27I2vChat");
const uploadMethod = () => Reflect.get(SyntxChatHttpClient.prototype, "uploadOwnerWan27I2vImage");

export interface OwnerWan27I2vChatContext {
  readonly status: "created"; readonly chat_uuid: string; readonly attempt_id: string;
  readonly model_id: "wan_27_i2v"; readonly scope: "video"; readonly generation_permit: false;
}
export interface OwnerWan27I2vImageUploadContext {
  readonly status: "uploaded"; readonly model_id: "wan_27_i2v"; readonly destination: "uploaded" | "hidden";
  readonly mime_type: OwnerWan27I2vImageMimeType; readonly size: number; readonly sha256: string;
  readonly width: number; readonly height: number; readonly owner_upload_binding: "SAME_CLIENT_NATIVE_UPLOAD";
  readonly generation_permit: false; readonly provider_acceptance: "UNPROVEN";
}
export interface OwnerWan27I2vOperationInput {
  readonly client: SyntxChatHttpClient; readonly token: object; readonly attempt_id: string;
  readonly chat: OwnerWan27I2vChatContext; readonly wire: OwnerWan27I2vWireCandidate;
}
interface Operation {
  readonly client: SyntxChatHttpClient; readonly token: object; readonly attempt: string;
  readonly chat: OwnerWan27I2vChatContext; readonly wire: OwnerWan27I2vWireCandidate;
  phase: "READY" | "POSTED" | "INVALID"; ack: string | null; ownerEcho: string | null;
  responseStatus?: number; transportCode?: string;
}

export function createOwnerWan27I2vChatContext(client: unknown, value: unknown): OwnerWan27I2vChatContext {
  const method = chatMethod();
  if (!exactClient(client) || typeof method !== "function") return invalid();
  const f = exact(value, ["chat_uuid", "attempt_id", "model_id"]);
  if (typeof f.chat_uuid !== "string" || !ID.test(f.chat_uuid) || typeof f.attempt_id !== "string" ||
      !ATTEMPT.test(f.attempt_id) || f.model_id !== "wan_27_i2v") return invalid();
  const context = Object.freeze({ status: "created" as const, chat_uuid: f.chat_uuid, attempt_id: f.attempt_id,
    model_id: "wan_27_i2v" as const, scope: "video" as const, generation_permit: false as const });
  CHATS.set(context, Object.freeze({ client: client as object, context, method })); return context;
}
export function isOwnerWan27I2vChatContextForClient(client: unknown, context: unknown, attempt: unknown): boolean {
  if (!exactClient(client) || !context || typeof context !== "object" || types.isProxy(context) ||
      typeof attempt !== "string" || !ATTEMPT.test(attempt)) return false;
  const state = CHATS.get(context);
  return !!state && state.client === client && state.context === context && state.method === chatMethod() &&
    state.context.attempt_id === attempt && state.context.status === "created" && state.context.scope === "video";
}
export function createOwnerWan27I2vImageUploadContext(client: unknown, url: unknown, value: unknown): OwnerWan27I2vImageUploadContext {
  const method = uploadMethod();
  if (!exactClient(client) || typeof method !== "function" || typeof url !== "string" || !safeUrl(url)) return invalid();
  const f = exact(value, ["model_id", "destination", "mime_type", "size", "sha256", "width", "height"]);
  if (f.model_id !== "wan_27_i2v" || (f.destination !== "uploaded" && f.destination !== "hidden") ||
      !["image/jpeg", "image/png", "image/bmp", "image/webp"].includes(String(f.mime_type)) ||
      !Number.isSafeInteger(f.size) || (f.size as number) < 1 || (f.size as number) > 20 * 1024 * 1024 ||
      typeof f.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(f.sha256) ||
      !Number.isSafeInteger(f.width) || (f.width as number) < 240 || (f.width as number) > 8_000 ||
      !Number.isSafeInteger(f.height) || (f.height as number) < 240 || (f.height as number) > 8_000 ||
      (f.width as number) / (f.height as number) < 0.125 || (f.width as number) / (f.height as number) > 8) return invalid();
  const context = Object.freeze({ status: "uploaded" as const, model_id: "wan_27_i2v" as const,
    destination: f.destination, mime_type: f.mime_type, size: f.size, sha256: f.sha256, width: f.width, height: f.height,
    owner_upload_binding: "SAME_CLIENT_NATIVE_UPLOAD" as const, generation_permit: false as const,
    provider_acceptance: "UNPROVEN" as const }) as OwnerWan27I2vImageUploadContext;
  UPLOADS.set(context, Object.freeze({ client: client as object, context, url, method })); return context;
}
export function readOwnerWan27I2vUploadReferenceForClient(client: unknown, value: unknown): Readonly<{ type: "image"; url: string }> | null {
  if (!exactClient(client) || !value || typeof value !== "object" || types.isProxy(value)) return null;
  const state = UPLOADS.get(value);
  if (!state || state.client !== client || state.context !== value || state.method !== uploadMethod() || !safeUrl(state.url)) return null;
  const c = value as OwnerWan27I2vImageUploadContext;
  return c.status === "uploaded" && c.model_id === state.context.model_id && c.destination === state.context.destination &&
    c.mime_type === state.context.mime_type && c.size === state.context.size && c.sha256 === state.context.sha256 &&
    c.width === state.context.width && c.height === state.context.height && c.owner_upload_binding === "SAME_CLIENT_NATIVE_UPLOAD" &&
    c.generation_permit === false && c.provider_acceptance === "UNPROVEN" ? Object.freeze({ type: "image", url: state.url }) : null;
}
export function registerOwnerWan27I2vOperation(input: OwnerWan27I2vOperationInput): void {
  if (!exactClient(input.client) || !isOwnerWan27I2vChatContextForClient(input.client, input.chat, input.attempt_id) ||
      input.wire.model_id !== "wan_27_i2v" || OPERATIONS.has(input.token)) return invalid();
  const row: Operation = { client: input.client, token: input.token, attempt: input.attempt_id,
    chat: input.chat, wire: input.wire, phase: "READY", ack: null, ownerEcho: null };
  OPERATIONS.set(input.token, row); const rows = BY_CLIENT.get(input.client) ?? new Set<Operation>(); rows.add(row); BY_CLIENT.set(input.client, rows);
}
export function consumeOwnerWan27I2vOperation(client: SyntxChatHttpClient, token: unknown): Readonly<{ chat_uuid: string; body: Record<string, unknown> }> {
  const op = operation(client, token);
  if (op.phase !== "READY" || !isOwnerWan27I2vChatContextForClient(client, op.chat, op.attempt)) return invalid();
  op.phase = "POSTED";
  return Object.freeze({ chat_uuid: op.chat.chat_uuid, body: Object.freeze({ chat_id: op.chat.chat_uuid,
    prompt: op.wire.wire.prompt, settings: op.wire.wire.settings }) });
}
export function readOwnerWan27I2vHistoryRoute(client: SyntxChatHttpClient, token: unknown): string {
  const op = operation(client, token); if (op.phase !== "POSTED") return invalid(); return op.chat.chat_uuid;
}
export function bindOwnerWan27I2vAck(client: unknown, token: unknown, ack: unknown): boolean {
  const op = getOperation(client, token);
  if (!op || op.phase !== "POSTED" || typeof ack !== "string" || !ID.test(ack)) return false;
  op.ack = ack; return true;
}
export function bindOwnerWan27I2vOwnerEcho(client: unknown, token: unknown, row: unknown): boolean {
  const op = getOperation(client, token), parsed = messageIdentity(row);
  if (!op || op.phase !== "POSTED" || !parsed || parsed.author_id <= 0 || (op.ack !== null && parsed.id !== op.ack)) return false;
  op.ownerEcho = parsed.id; return true;
}
export function bindOwnerWan27I2vResultContext(client: unknown, token: unknown, row: unknown): object | null {
  const op = getOperation(client, token), parsed = messageIdentity(row);
  if (!op || op.phase !== "POSTED" || !op.ownerEcho || !parsed || parsed.author_id !== -1) return null;
  const objects = (row as Record<string, unknown>).message_object;
  if (!Array.isArray(objects) || objects.length !== 1 || !objects[0] || typeof objects[0] !== "object" ||
      (objects[0] as Record<string, unknown>).object_type !== "video") return null;
  const context = Object.freeze({ chat_uuid: op.chat.chat_uuid, message_id: parsed.id, model_id: "wan_27_i2v" as const,
    attempt_id: op.attempt, owner_echo_message_id: op.ownerEcho });
  RESULTS.set(context, Object.freeze({ operation: op, row })); return context;
}
export function readOwnerWan27I2vResultRoute(client: SyntxChatHttpClient, context: unknown): Readonly<{ chat_uuid: string; message_id: string }> {
  const state = context && typeof context === "object" && !types.isProxy(context) ? RESULTS.get(context) : undefined;
  if (!state || state.operation.client !== client || state.operation.phase !== "POSTED") return invalid();
  const row = messageIdentity(state.row); if (!row) return invalid();
  return Object.freeze({ chat_uuid: state.operation.chat.chat_uuid, message_id: row.id });
}
export function recordOwnerWan27I2vTransport(client: unknown, token: unknown, value: unknown): void {
  const op = getOperation(client, token); if (!op || op.phase !== "POSTED") return;
  if (typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 && op.responseStatus === undefined) op.responseStatus = value;
  if (typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(value) && op.transportCode === undefined) op.transportCode = value;
}
export function readOwnerWan27I2vTransport(client: unknown, token: unknown): Readonly<{ status?: number; code?: string }> {
  const op = getOperation(client, token); if (!op) return Object.freeze({});
  return Object.freeze({ ...(op.responseStatus === undefined ? {} : { status: op.responseStatus }),
    ...(op.transportCode === undefined ? {} : { code: op.transportCode }) });
}
export function invalidateOwnerWan27I2vOperations(client: unknown, attempt?: string): void {
  if (!client || typeof client !== "object" || types.isProxy(client) || (attempt !== undefined && !ATTEMPT.test(attempt))) return;
  for (const op of BY_CLIENT.get(client) ?? []) if (attempt === undefined || op.attempt === attempt) op.phase = "INVALID";
}
function operation(client: unknown, token: unknown): Operation {
  const op = getOperation(client, token); if (!op || op.phase === "INVALID") return invalid(); return op;
}
function getOperation(client: unknown, token: unknown): Operation | undefined {
  if (!token || typeof token !== "object" || types.isProxy(token)) return undefined;
  const op = OPERATIONS.get(token); return op && op.client === client && op.token === token ? op : undefined;
}
function messageIdentity(value: unknown): Readonly<{ id: string; author_id: number }> | null {
  if (!value || typeof value !== "object" || types.isProxy(value)) return null;
  const row = value as Record<string, unknown>;
  const id=typeof row.id === "number" && Number.isSafeInteger(row.id) && row.id>=0 ? String(row.id) : row.id;
  return typeof id === "string" && ID.test(id) && Number.isSafeInteger(row.author_id)
    ? Object.freeze({ id, author_id: row.author_id as number }) : null;
}
function exact(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return invalid();
  const d = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(d);
  if (keys.length !== required.length || keys.some(k => typeof k !== "string" || !required.includes(k) ||
      !Object.hasOwn(d[k]!, "value") || d[k]!.enumerable !== true)) return invalid();
  const out = Object.create(null) as Record<string, unknown>; for (const k of keys as string[]) out[k] = d[k]!.value; return out;
}
function exactClient(value: unknown): value is SyntxChatHttpClient {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === SyntxChatHttpClient.prototype &&
    Reflect.get(value, "createOwnerWan27I2vChat") === chatMethod() && Reflect.get(value, "uploadOwnerWan27I2vImage") === uploadMethod();
}
function safeUrl(value: string): boolean { try { const u = new URL(value); return u.protocol === "https:" && (u.hostname === "syntx.ai" || u.hostname.endsWith(".syntx.ai")); } catch { return false; } }
function invalid(): never { throw new Error("OWNER_WAN27_I2V_NATIVE_CONTEXT_INVALID"); }
