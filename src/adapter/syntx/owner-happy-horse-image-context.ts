import { types } from "node:util";
import { SyntxChatHttpClient } from "./chat-http-client.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";
import type { OwnerHappyHorseImageModelId, OwnerHappyHorseModelId } from "../../application/owner-happy-horse-parameters.js";
import type { OwnerHappyHorseImageMimeType } from "../../application/owner-happy-horse-image-policy.js";
import type { OwnerHappyHorseChatContext } from "./owner-happy-horse-chat-context.js";

export type OwnerHappyHorseUploadDestination = "uploaded" | "hidden";
export interface OwnerHappyHorseImageUploadContext {
  readonly status: "uploaded";
  readonly model_id: OwnerHappyHorseImageModelId;
  readonly destination: OwnerHappyHorseUploadDestination;
  readonly mime_type: OwnerHappyHorseImageMimeType;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly provider_acceptance: "UNPROVEN";
  readonly generation_permit: false;
}
export type OwnerHappyHorseUploadReference = Readonly<{ type: "image"; url: string }>;

/* Root-owned native adapter must implement this exact-client API before this draft is integrable. */
export interface OwnerHappyHorseNativeClient extends SyntxChatHttpClient {
  uploadOwnerHappyHorseImage(input: { readonly media: unknown; readonly destination: OwnerHappyHorseUploadDestination }, signal?: AbortSignal): Promise<OwnerHappyHorseImageUploadContext>;
  uploadOwnerHappyHorseEditVideo(input: { readonly media: unknown; readonly destination: OwnerHappyHorseUploadDestination }, signal?: AbortSignal): Promise<import("./owner-happy-horse-video-context.js").OwnerHappyHorseEditVideoUploadContext>;
  createOwnerHappyHorseChat(input: { readonly attemptId: string; readonly model_id: OwnerHappyHorseModelId; readonly title: string }, signal?: AbortSignal): Promise<OwnerHappyHorseChatContext>;
  isOwnerHappyHorseChat(context: unknown, attemptId: string): context is OwnerHappyHorseChatContext;
  startOwnerHappyHorseOperation(token: object, signal?: AbortSignal): Promise<Readonly<{ chat_uuid: string; message_id: string }>>;
  readOwnerHappyHorseHistory(token: object, signal?: AbortSignal): Promise<unknown>;
  readOwnerHappyHorseResult(token: object, result: unknown, signal?: AbortSignal): Promise<unknown>;
  invalidateOwnerHappyHorseChats(attemptId?: string): void;
}

const METHOD = "uploadOwnerHappyHorseImage";
const UPLOADS = new WeakMap<object, Readonly<{ client: SyntxChatHttpClient; context: OwnerHappyHorseImageUploadContext; url: string; nativeMethod: Function }>>();

/** Draft nominal client-bound receipt. Root's native adapter supplies the actual upload method. */
export function createOwnerHappyHorseImageUploadContext(clientInput: unknown, urlInput: unknown, metadataInput: unknown): OwnerHappyHorseImageUploadContext {
  if (!isClient(clientInput)) throw new Error("OWNER_HAPPY_HORSE_UPLOAD_CONTEXT_INVALID");
  const meta = exactMetadata(metadataInput), url = typeof urlInput === "string" ? urlInput : "";
  if (!meta || !isSafeUploadReferenceUrl(url)) throw new Error("OWNER_HAPPY_HORSE_UPLOAD_CONTEXT_INVALID");
  const method = Reflect.get(Object.getPrototypeOf(clientInput)!, METHOD);
  if (typeof method !== "function") throw new Error("OWNER_HAPPY_HORSE_UPLOAD_CONTEXT_INVALID");
  const context = Object.freeze({ status: "uploaded" as const, ...meta, provider_acceptance: "UNPROVEN" as const, generation_permit: false as const });
  UPLOADS.set(context, Object.freeze({ client: clientInput as SyntxChatHttpClient, context, url, nativeMethod: method }));
  return context;
}

export function readOwnerHappyHorseUploadReference(clientInput: unknown, contextInput: unknown): OwnerHappyHorseUploadReference | null {
  try {
    if (!contextInput || typeof contextInput !== "object" || types.isProxy(contextInput)) return null;
    const witness = UPLOADS.get(contextInput);
    if (!witness || witness.client !== clientInput || witness.context !== contextInput || !Object.isFrozen(contextInput) ||
        !isClient(clientInput, witness.nativeMethod) || !isSafeUploadReferenceUrl(witness.url)) return null;
    const c = contextInput as OwnerHappyHorseImageUploadContext;
    if (c.status !== "uploaded" || c.model_id !== witness.context.model_id || c.destination !== witness.context.destination ||
        c.mime_type !== witness.context.mime_type || c.size !== witness.context.size || c.sha256 !== witness.context.sha256 ||
        c.width !== witness.context.width || c.height !== witness.context.height || c.provider_acceptance !== "UNPROVEN" || c.generation_permit !== false) return null;
    return Object.freeze({ type: "image", url: witness.url });
  } catch { return null; }
}

function isClient(value: unknown, expected?: Function): value is OwnerHappyHorseNativeClient {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype || Object.hasOwn(value, METHOD)) return false;
    const method = Reflect.get(SyntxChatHttpClient.prototype, METHOD);
    return typeof method === "function" && (expected === undefined || method === expected) && Reflect.get(value, METHOD) === method;
  } catch { return false; }
}
function exactMetadata(value: unknown): Omit<OwnerHappyHorseImageUploadContext, "status" | "provider_acceptance" | "generation_permit"> | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return null;
    const proto = Object.getPrototypeOf(value), ds = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(ds), expected = ["model_id", "destination", "mime_type", "size", "sha256", "width", "height"];
    if (proto !== Object.prototype && proto !== null) return null;
    if (keys.length !== expected.length || keys.some(key => typeof key !== "string" || !expected.includes(key) ||
      !Object.hasOwn(ds[key]!, "value") || ds[key]!.enumerable !== true)) return null;
    const f = Object.create(null) as Record<string, unknown>; for (const key of expected) f[key] = ds[key]!.value;
    if ((f.model_id !== "happy_horse_first_frame" && f.model_id !== "happy_horse_references") ||
        (f.destination !== "uploaded" && f.destination !== "hidden") ||
        !( ["image/jpeg", "image/jpg", "image/png", "image/webp"] as readonly string[]).includes(String(f.mime_type)) ||
        !Number.isSafeInteger(f.size) || (f.size as number) < 1 || (f.size as number) > 10 * 1024 * 1024 ||
        typeof f.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(f.sha256) || !Number.isSafeInteger(f.width) ||
        !Number.isSafeInteger(f.height) || (f.width as number) < 400 || (f.height as number) < 400 ||
        (f.width as number) > 8_000 || (f.height as number) > 8_000 || (f.width as number) * (f.height as number) > 52_500_000) return null;
    return Object.freeze({ model_id: f.model_id as OwnerHappyHorseImageModelId, destination: f.destination as OwnerHappyHorseUploadDestination,
      mime_type: f.mime_type as OwnerHappyHorseImageMimeType, size: f.size as number, sha256: f.sha256,
      width: f.width as number, height: f.height as number });
  } catch { return null; }
}
