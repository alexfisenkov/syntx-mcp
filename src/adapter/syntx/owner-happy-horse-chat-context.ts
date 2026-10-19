import { types } from "node:util";
import { SyntxChatHttpClient } from "./chat-http-client.js";
import type { OwnerHappyHorseModelId } from "../../application/owner-happy-horse-parameters.js";

const METHOD = "createOwnerHappyHorseChat";
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const CHAT_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const CHATS = new WeakMap<object, Readonly<{ client: SyntxChatHttpClient; context: OwnerHappyHorseChatContext; nativeMethod: Function }>>();

export interface OwnerHappyHorseChatContext {
  readonly status: "created";
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly model_id: OwnerHappyHorseModelId;
  readonly scope: "video";
  readonly generation_permit: false;
}

/** Creates a nominal fresh-chat proof for the exact native SYNTX client. */
export function createOwnerHappyHorseChatContext(clientInput: unknown, metadataInput: unknown): OwnerHappyHorseChatContext {
  if (!isClient(clientInput)) throw new Error("OWNER_HAPPY_HORSE_CHAT_CONTEXT_INVALID");
  const meta = metadata(metadataInput), method = dataMethod(SyntxChatHttpClient.prototype, METHOD);
  if (!meta || typeof method !== "function") throw new Error("OWNER_HAPPY_HORSE_CHAT_CONTEXT_INVALID");
  const context = Object.freeze({ status: "created" as const, chat_uuid: meta.chat_uuid, attempt_id: meta.attempt_id,
    model_id: meta.model_id, scope: "video" as const, generation_permit: false as const });
  CHATS.set(context, Object.freeze({ client: clientInput, context, nativeMethod: method }));
  return context;
}

export function readOwnerHappyHorseChat(clientInput: unknown, contextInput: unknown, attemptInput: unknown): Readonly<{
  chat_uuid: string; attempt_id: string; model_id: OwnerHappyHorseModelId
}> | null {
  try {
    if (!contextInput || typeof contextInput !== "object" || types.isProxy(contextInput) || typeof attemptInput !== "string") return null;
    const witness = CHATS.get(contextInput);
    if (!witness || witness.client !== clientInput || witness.context !== contextInput || !Object.isFrozen(contextInput) ||
        !isClient(clientInput, witness.nativeMethod) || !ATTEMPT.test(attemptInput)) return null;
    const c = contextInput as OwnerHappyHorseChatContext;
    if (c.status !== "created" || c.chat_uuid !== witness.context.chat_uuid || c.attempt_id !== witness.context.attempt_id ||
        c.model_id !== witness.context.model_id || c.scope !== "video" || c.generation_permit !== false || c.attempt_id !== attemptInput) return null;
    return Object.freeze({ chat_uuid: c.chat_uuid, attempt_id: c.attempt_id, model_id: c.model_id });
  } catch { return null; }
}

export function isOwnerHappyHorseChatContextForClient(clientInput: unknown, contextInput: unknown, attemptInput: unknown): boolean {
  return readOwnerHappyHorseChat(clientInput, contextInput, attemptInput) !== null;
}

function isClient(value: unknown, expected?: Function): value is SyntxChatHttpClient {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype || Object.hasOwn(value, METHOD)) return false;
    const method = dataMethod(SyntxChatHttpClient.prototype, METHOD);
    return typeof method === "function" && (expected === undefined || method === expected) && Reflect.get(value, METHOD) === method;
  } catch { return false; }
}
function dataMethod(target: object, key: string): unknown {
  let current: object | null = target;
  while (current) { const d = Object.getOwnPropertyDescriptor(current, key); if (d) return "value" in d ? d.value : undefined;
    current = Object.getPrototypeOf(current) as object | null; }
  return undefined;
}
function metadata(value: unknown): Readonly<{ chat_uuid: string; attempt_id: string; model_id: OwnerHappyHorseModelId }> | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return null;
    const ds = Object.getOwnPropertyDescriptors(value), expected = ["chat_uuid", "attempt_id", "model_id"], keys = Reflect.ownKeys(ds);
    if (keys.length !== expected.length || keys.some(key => typeof key !== "string" || !expected.includes(key) ||
        !Object.hasOwn(ds[key]!, "value") || ds[key]!.enumerable !== true)) return null;
    const f = Object.create(null) as Record<string, unknown>; for (const key of expected) f[key] = ds[key]!.value;
    if (typeof f.chat_uuid !== "string" || !CHAT_ID.test(f.chat_uuid) || typeof f.attempt_id !== "string" || !ATTEMPT.test(f.attempt_id) ||
        (f.model_id !== "happy_horse_first_frame" && f.model_id !== "happy_horse_references" && f.model_id !== "happy_horse_edit")) return null;
    return Object.freeze({ chat_uuid: f.chat_uuid, attempt_id: f.attempt_id, model_id: f.model_id });
  } catch { return null; }
}
