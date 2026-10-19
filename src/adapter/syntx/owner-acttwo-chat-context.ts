import { types } from "node:util";
import { SyntxChatHttpClient } from "./chat-http-client.js";

const METHOD = "createOwnerActTwoChat";
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const CHAT_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const CHATS = new WeakMap<object, Readonly<{ client: SyntxChatHttpClient; context: OwnerActTwoChatContext; nativeMethod: Function }>>();

export interface OwnerActTwoChatContext {
  readonly status: "created";
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly model_id: "acttwo";
  readonly scope: "video";
  readonly generation_permit: false;
}

export function createOwnerActTwoChatContext(clientInput: unknown, metadataInput: unknown): OwnerActTwoChatContext {
  if (!isClient(clientInput)) throw new Error("OWNER_ACTTWO_CHAT_CONTEXT_INVALID");
  const metadata = readMetadata(metadataInput), method = Reflect.get(SyntxChatHttpClient.prototype, METHOD);
  if (!metadata || typeof method !== "function") throw new Error("OWNER_ACTTWO_CHAT_CONTEXT_INVALID");
  const context = Object.freeze({ status: "created" as const, ...metadata, scope: "video" as const, generation_permit: false as const });
  CHATS.set(context, Object.freeze({ client: clientInput as SyntxChatHttpClient, context, nativeMethod: method }));
  return context;
}

export function readOwnerActTwoChat(clientInput: unknown, contextInput: unknown, attemptInput: unknown): Readonly<{
  chat_uuid: string; attempt_id: string; model_id: "acttwo"
}> | null {
  try {
    if (!contextInput || typeof contextInput !== "object" || types.isProxy(contextInput) || typeof attemptInput !== "string") return null;
    const witness = CHATS.get(contextInput);
    if (!witness || witness.client !== clientInput || witness.context !== contextInput || !Object.isFrozen(contextInput) ||
        !isClient(clientInput, witness.nativeMethod) || !ATTEMPT.test(attemptInput)) return null;
    const context = contextInput as OwnerActTwoChatContext;
    if (context.status !== "created" || context.chat_uuid !== witness.context.chat_uuid || context.attempt_id !== witness.context.attempt_id ||
        context.model_id !== "acttwo" || context.scope !== "video" || context.generation_permit !== false || context.attempt_id !== attemptInput) return null;
    return Object.freeze({ chat_uuid: context.chat_uuid, attempt_id: context.attempt_id, model_id: "acttwo" });
  } catch { return null; }
}

export function isOwnerActTwoChatContextForClient(clientInput: unknown, contextInput: unknown, attemptInput: unknown): boolean {
  return readOwnerActTwoChat(clientInput, contextInput, attemptInput) !== null;
}

function isClient(value: unknown, expected?: Function): value is SyntxChatHttpClient {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype || Object.hasOwn(value, METHOD)) return false;
    const method = Reflect.get(SyntxChatHttpClient.prototype, METHOD);
    return typeof method === "function" && (expected === undefined || method === expected) && Reflect.get(value, METHOD) === method;
  } catch { return false; }
}
function readMetadata(value: unknown): Readonly<{ chat_uuid: string; attempt_id: string; model_id: "acttwo" }> | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors), expected = ["chat_uuid", "attempt_id", "model_id"];
    if ((Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || keys.length !== expected.length ||
        keys.some(key => typeof key !== "string" || !expected.includes(key) || !Object.hasOwn(descriptors[key]!, "value") ||
          descriptors[key]!.enumerable !== true)) return null;
    const fields = Object.create(null) as Record<string, unknown>;
    for (const key of expected) fields[key] = descriptors[key]!.value;
    if (typeof fields.chat_uuid !== "string" || !CHAT_ID.test(fields.chat_uuid) || typeof fields.attempt_id !== "string" ||
        !ATTEMPT.test(fields.attempt_id) || fields.model_id !== "acttwo") return null;
    return Object.freeze({ chat_uuid: fields.chat_uuid, attempt_id: fields.attempt_id, model_id: "acttwo" });
  } catch { return null; }
}
