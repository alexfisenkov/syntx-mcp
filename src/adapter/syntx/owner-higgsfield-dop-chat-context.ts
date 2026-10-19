import { types } from "node:util";
import { SyntxChatHttpClient } from "./chat-http-client.js";
import type { OwnerHiggsfieldDopModelId } from "../../application/owner-higgsfield-dop-parameters.js";

const METHOD = "createOwnerHiggsfieldDopChat";
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const CHAT_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const CHATS = new WeakMap<object, Readonly<{ client: SyntxChatHttpClient; context: OwnerHiggsfieldDopChatContext; nativeMethod: Function }>>();

/** Nominal client-bound proof that a fresh Higgsfield video chat was created for this owner attempt. */
export interface OwnerHiggsfieldDopChatContext {
  readonly status: "created";
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly model_id: OwnerHiggsfieldDopModelId;
  readonly scope: "video";
  readonly generation_permit: false;
}

export function createOwnerHiggsfieldDopChatContext(clientInput: unknown, metadataInput: unknown): OwnerHiggsfieldDopChatContext {
  if (!isExactClient(clientInput)) throw new Error("OWNER_HIGGSFIELD_DOP_CHAT_CONTEXT_INVALID");
  const metadata = readMetadata(metadataInput), method = dataMethod(SyntxChatHttpClient.prototype, METHOD);
  if (!metadata || typeof method !== "function") throw new Error("OWNER_HIGGSFIELD_DOP_CHAT_CONTEXT_INVALID");
  const context: OwnerHiggsfieldDopChatContext = Object.freeze({ status: "created", chat_uuid: metadata.chat_uuid,
    attempt_id: metadata.attempt_id, model_id: metadata.model_id, scope: "video", generation_permit: false });
  CHATS.set(context, Object.freeze({ client: clientInput as SyntxChatHttpClient, context, nativeMethod: method }));
  return context;
}

/** Reads only a genuine fresh-chat context owned by the exact client and attempt. */
export function readOwnerHiggsfieldDopChatForClient(clientInput: unknown, contextInput: unknown,
  attemptInput: unknown): Readonly<{ chat_uuid: string; attempt_id: string; model_id: OwnerHiggsfieldDopModelId }> | null {
  try {
    if (!contextInput || typeof contextInput !== "object" || types.isProxy(contextInput) || typeof attemptInput !== "string") return null;
    const witness = CHATS.get(contextInput);
    if (!witness || witness.client !== clientInput || witness.context !== contextInput || !Object.isFrozen(contextInput) ||
        !isExactClient(clientInput, witness.nativeMethod) || !ATTEMPT.test(attemptInput)) return null;
    const c = contextInput as OwnerHiggsfieldDopChatContext;
    if (c.status !== "created" || c.chat_uuid !== witness.context.chat_uuid || c.attempt_id !== witness.context.attempt_id ||
        c.model_id !== witness.context.model_id || c.scope !== "video" || c.generation_permit !== false || c.attempt_id !== attemptInput) return null;
    return Object.freeze({ chat_uuid: c.chat_uuid, attempt_id: c.attempt_id, model_id: c.model_id });
  } catch { return null; }
}

export function isOwnerHiggsfieldDopChatContextForClient(clientInput: unknown, contextInput: unknown, attemptInput: unknown): boolean {
  return readOwnerHiggsfieldDopChatForClient(clientInput, contextInput, attemptInput) !== null;
}

function isExactClient(value: unknown, expectedMethod?: Function): value is SyntxChatHttpClient {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype ||
        Object.hasOwn(value, METHOD)) return false;
    const method = dataMethod(SyntxChatHttpClient.prototype, METHOD);
    return typeof method === "function" && (expectedMethod === undefined || expectedMethod === method) && Reflect.get(value, METHOD) === method;
  } catch { return false; }
}

function dataMethod(target: object, key: string): unknown {
  let current: object | null = target;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function readMetadata(value: unknown): Readonly<{ chat_uuid: string; attempt_id: string; model_id: OwnerHiggsfieldDopModelId }> | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value), expected = ["chat_uuid", "attempt_id", "model_id"];
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== expected.length || keys.some(key => typeof key !== "string" || !expected.includes(key) ||
        !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) return null;
    const fields = Object.create(null) as Record<string, unknown>;
    for (const key of expected) fields[key] = descriptors[key]!.value;
    if (typeof fields.chat_uuid !== "string" || !CHAT_ID.test(fields.chat_uuid) ||
        typeof fields.attempt_id !== "string" || !ATTEMPT.test(fields.attempt_id) ||
        (fields.model_id !== "dop-lite" && fields.model_id !== "dop-turbo")) return null;
    return Object.freeze({ chat_uuid: fields.chat_uuid, attempt_id: fields.attempt_id, model_id: fields.model_id });
  } catch { return null; }
}
