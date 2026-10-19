import { types } from "node:util";
import { SyntxChatHttpClient } from "./chat-http-client.js";
import { isOwnerKlingMediaModelId, type OwnerKlingMediaModelId } from "../../application/owner-kling-media-parameters.js";

const METHOD = "createOwnerKlingMediaChat";
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const CHAT_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const CONTEXTS = new WeakMap<object, Readonly<{ client: SyntxChatHttpClient; context: OwnerKlingMediaChatContext; method: Function }>>();

export interface OwnerKlingMediaChatContext {
  readonly status: "created"; readonly chat_uuid: string; readonly attempt_id: string;
  readonly model_id: OwnerKlingMediaModelId; readonly scope: "video"; readonly generation_permit: false;
}

/** Nominal same-client witness for a newly created chat in one exact Kling media model. */
export function createOwnerKlingMediaChatContext(clientInput: unknown, metadataInput: unknown): OwnerKlingMediaChatContext {
  if (!isClient(clientInput)) throw new Error("OWNER_KLING_MEDIA_CHAT_CONTEXT_INVALID");
  const meta = readMetadata(metadataInput), method = dataMethod(SyntxChatHttpClient.prototype, METHOD);
  if (!meta || typeof method !== "function") throw new Error("OWNER_KLING_MEDIA_CHAT_CONTEXT_INVALID");
  const context = Object.freeze({ status: "created" as const, chat_uuid: meta.chat_uuid, attempt_id: meta.attempt_id,
    model_id: meta.model_id, scope: "video" as const, generation_permit: false as const });
  CONTEXTS.set(context, Object.freeze({ client: clientInput, context, method })); return context;
}

export function readOwnerKlingMediaChat(clientInput: unknown, contextInput: unknown, attemptInput: unknown): Readonly<{
  chat_uuid: string; attempt_id: string; model_id: OwnerKlingMediaModelId
}> | null {
  try {
    if (!contextInput || typeof contextInput !== "object" || types.isProxy(contextInput) || typeof attemptInput !== "string" || !ATTEMPT.test(attemptInput)) return null;
    const witness = CONTEXTS.get(contextInput);
    if (!witness || witness.client !== clientInput || witness.context !== contextInput || !Object.isFrozen(contextInput) ||
        !isClient(clientInput, witness.method)) return null;
    const context = contextInput as OwnerKlingMediaChatContext;
    if (context.status !== "created" || context.chat_uuid !== witness.context.chat_uuid || context.attempt_id !== witness.context.attempt_id ||
        context.model_id !== witness.context.model_id || context.scope !== "video" || context.generation_permit !== false || context.attempt_id !== attemptInput) return null;
    return Object.freeze({ chat_uuid: context.chat_uuid, attempt_id: context.attempt_id, model_id: context.model_id });
  } catch { return null; }
}

function isClient(value: unknown, expected?: Function): value is SyntxChatHttpClient {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype || Object.hasOwn(value, METHOD)) return false;
    const method = dataMethod(SyntxChatHttpClient.prototype, METHOD);
    return typeof method === "function" && (expected === undefined || expected === method) && Reflect.get(value, METHOD) === method;
  } catch { return false; }
}
function dataMethod(target: object, key: string): unknown {
  let current: object | null = target;
  while (current) { const d = Object.getOwnPropertyDescriptor(current, key); if (d) return "value" in d ? d.value : undefined;
    current = Object.getPrototypeOf(current) as object | null; }
  return undefined;
}
function readMetadata(value: unknown): Readonly<{ chat_uuid: string; attempt_id: string; model_id: OwnerKlingMediaModelId }> | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return null;
    const ds = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(ds), expected = ["chat_uuid", "attempt_id", "model_id"];
    if (keys.length !== expected.length || keys.some(k => typeof k !== "string" || !expected.includes(k) || !Object.hasOwn(ds[k]!, "value") || ds[k]!.enumerable !== true)) return null;
    const f = Object.create(null) as Record<string, unknown>; for (const key of expected) f[key] = ds[key]!.value;
    if (typeof f.chat_uuid !== "string" || !CHAT_ID.test(f.chat_uuid) || typeof f.attempt_id !== "string" || !ATTEMPT.test(f.attempt_id) || !isOwnerKlingMediaModelId(f.model_id)) return null;
    return Object.freeze({ chat_uuid: f.chat_uuid, attempt_id: f.attempt_id, model_id: f.model_id });
  } catch { return null; }
}
