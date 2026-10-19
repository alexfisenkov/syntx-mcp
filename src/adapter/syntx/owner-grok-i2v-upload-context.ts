import { types } from "node:util";
import { SyntxChatHttpClient } from "./chat-http-client.js";
import type { OwnerGrokI2vImageMimeType, OwnerGrokI2vImageModelId } from "../../application/owner-grok-i2v-image-policy.js";
import type { InternalUploadReference } from "./upload-reference-bridge.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";

const METHOD = "uploadOwnerGrokI2vImage";
const UPLOADS = new WeakMap<object, Readonly<{ client: SyntxChatHttpClient; context: OwnerGrokI2vImageUploadContext;
  url: string; nativeMethod: Function }>>();

export type OwnerGrokI2vUploadDestination = "uploaded" | "hidden";
export interface OwnerGrokI2vImageUploadContext {
  readonly status: "uploaded";
  readonly model_id: OwnerGrokI2vImageModelId;
  readonly destination: OwnerGrokI2vUploadDestination;
  readonly media_type: "image";
  readonly mime_type: OwnerGrokI2vImageMimeType;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  readonly provider_acceptance: "UNPROVEN";
  readonly generation_permit: false;
  readonly owner_upload_binding: "SAME_CLIENT_NATIVE_UPLOAD";
}
export type OwnerGrokI2vUploadReference = Readonly<{ type: "image"; url: string }>;

/** Build a client-bound, URL-hidden witness from the one parsed native upload reference. */
export function createOwnerGrokI2vImageUploadContext(clientInput: unknown, referenceInput: InternalUploadReference,
  metadataInput: Readonly<{ model_id: OwnerGrokI2vImageModelId; destination: OwnerGrokI2vUploadDestination;
    mime_type: OwnerGrokI2vImageMimeType; size: number; sha256: string; width: number; height: number }>): OwnerGrokI2vImageUploadContext {
  if (!isExactClient(clientInput)) throw new Error("OWNER_GROK_I2V_UPLOAD_CONTEXT_INVALID");
  const ref = readReference(referenceInput), meta = readMetadata(metadataInput);
  if (!ref || !meta) throw new Error("OWNER_GROK_I2V_UPLOAD_CONTEXT_INVALID");
  const method = dataMethod(SyntxChatHttpClient.prototype, METHOD);
  if (typeof method !== "function") throw new Error("OWNER_GROK_I2V_UPLOAD_CONTEXT_INVALID");
  const context: OwnerGrokI2vImageUploadContext = Object.freeze({ status: "uploaded", model_id: meta.model_id,
    destination: meta.destination, media_type: "image", mime_type: meta.mime_type, size: meta.size, sha256: meta.sha256,
    width: meta.width, height: meta.height, metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS",
    provider_acceptance: "UNPROVEN", generation_permit: false, owner_upload_binding: "SAME_CLIENT_NATIVE_UPLOAD" });
  UPLOADS.set(context, Object.freeze({ client: clientInput as SyntxChatHttpClient, context, url: ref.url, nativeMethod: method }));
  return context;
}

/** Only the exact native upload client can retrieve its genuine internal image URL. */
export function readOwnerGrokI2vUploadReferenceForClient(clientInput: unknown,
  contextInput: unknown): OwnerGrokI2vUploadReference | null {
  try {
    if (!contextInput || typeof contextInput !== "object" || types.isProxy(contextInput)) return null;
    const witness = UPLOADS.get(contextInput);
    if (!witness || witness.client !== clientInput || witness.context !== contextInput || !Object.isFrozen(contextInput) ||
        !isExactClient(clientInput, witness.nativeMethod) || !isSafeUploadReferenceUrl(witness.url)) return null;
    const c = contextInput as OwnerGrokI2vImageUploadContext;
    if (c.status !== "uploaded" || c.model_id !== witness.context.model_id || c.destination !== witness.context.destination ||
        c.media_type !== "image" || c.mime_type !== witness.context.mime_type || c.size !== witness.context.size ||
        c.sha256 !== witness.context.sha256 || c.width !== witness.context.width || c.height !== witness.context.height ||
        c.metadata_confidence !== "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" || c.provider_acceptance !== "UNPROVEN" ||
        c.generation_permit !== false || c.owner_upload_binding !== "SAME_CLIENT_NATIVE_UPLOAD") return null;
    return Object.freeze({ type: "image", url: witness.url });
  } catch { return null; }
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
  while (current) { const d = Object.getOwnPropertyDescriptor(current, key); if (d) return "value" in d ? d.value : undefined;
    current = Object.getPrototypeOf(current) as object | null; }
  return undefined;
}
function readReference(value: unknown): Readonly<{ url: string }> | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const d = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(d);
    if (!keys.includes("url") || keys.some(key => typeof key !== "string" || !["url", "file_id"].includes(key) ||
        !Object.hasOwn(d[key]!, "value") || d[key]!.enumerable !== true)) return null;
    const url = d.url!.value;
    return typeof url === "string" && isSafeUploadReferenceUrl(url) ? Object.freeze({ url }) : null;
  } catch { return null; }
}
function readMetadata(value: unknown): Readonly<{ model_id: OwnerGrokI2vImageModelId; destination: OwnerGrokI2vUploadDestination;
  mime_type: OwnerGrokI2vImageMimeType; size: number; sha256: string; width: number; height: number }> | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return null;
    const d = Object.getOwnPropertyDescriptors(value), expected = ["model_id", "destination", "mime_type", "size", "sha256", "width", "height"];
    const keys = Reflect.ownKeys(d);
    if (keys.length !== expected.length || keys.some(key => typeof key !== "string" || !expected.includes(key) ||
        !Object.hasOwn(d[key]!, "value") || d[key]!.enumerable !== true)) return null;
    const f = Object.fromEntries(expected.map(key => [key, d[key]!.value])) as Record<string, unknown>;
    const cap = f.model_id === "grok_i2v" ? 20 * 1024 * 1024 : f.model_id === "grok_15_i2v" ? 10 * 1024 * 1024 : 0;
    if (!cap || (f.destination !== "uploaded" && f.destination !== "hidden") ||
        (f.mime_type !== "image/jpeg" && f.mime_type !== "image/png" && f.mime_type !== "image/webp") ||
        !Number.isSafeInteger(f.size) || (f.size as number) < 1 || (f.size as number) > cap ||
        typeof f.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(f.sha256) ||
        !Number.isSafeInteger(f.width) || (f.width as number) < 1 || (f.width as number) > 8_400 ||
        !Number.isSafeInteger(f.height) || (f.height as number) < 1 || (f.height as number) > 8_400 ||
        (f.width as number) * (f.height as number) > 52_500_000 ||
        (f.model_id === "grok_i2v" && (f.width as number) * 9 !== (f.height as number) * 16)) return null;
    return Object.freeze({ model_id: f.model_id as OwnerGrokI2vImageModelId, destination: f.destination as OwnerGrokI2vUploadDestination,
      mime_type: f.mime_type as OwnerGrokI2vImageMimeType, size: f.size as number, sha256: f.sha256,
      width: f.width as number, height: f.height as number });
  } catch { return null; }
}
