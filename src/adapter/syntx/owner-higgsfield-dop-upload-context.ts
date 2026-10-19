import { types } from "node:util";
import { SyntxChatHttpClient } from "./chat-http-client.js";
import type { OwnerHiggsfieldDopModelId } from "../../application/owner-higgsfield-dop-parameters.js";
import type { OwnerHiggsfieldDopImageMimeType } from "../../application/owner-higgsfield-dop-image-policy.js";
import type { InternalUploadReference } from "./upload-reference-bridge.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";

const METHOD = "uploadOwnerHiggsfieldDopImage";
const IMPORT_METHOD = "importOwnerHiggsfieldDopImage";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DIMENSION = 8_400;
const MAX_PIXELS = 52_500_000;
const UPLOADS = new WeakMap<object, Readonly<{ client: SyntxChatHttpClient; context: OwnerHiggsfieldDopImageUploadContext;
  url: string; nativeMethod: Function }>>();
const IMPORTS = new WeakMap<object, Readonly<{ client: SyntxChatHttpClient; context: OwnerHiggsfieldDopExistingImageContext;
  url: string; fileId: string; nativeMethod: Function }>>();

export type OwnerHiggsfieldDopUploadDestination = "uploaded" | "hidden";

export interface OwnerHiggsfieldDopImageUploadContext {
  readonly status: "uploaded";
  readonly model_id: OwnerHiggsfieldDopModelId;
  readonly destination: OwnerHiggsfieldDopUploadDestination;
  readonly media_type: "image";
  readonly mime_type: OwnerHiggsfieldDopImageMimeType;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  readonly provider_acceptance: "UNPROVEN";
  readonly generation_permit: false;
  readonly owner_upload_binding: "SAME_CLIENT_NATIVE_UPLOAD";
}

/** Existing account assets are provenance-bound without pretending MCP uploaded them. */
export interface OwnerHiggsfieldDopExistingImageContext {
  readonly status: "imported";
  readonly model_id: OwnerHiggsfieldDopModelId;
  readonly destination: "uploaded";
  readonly media_type: "image";
  readonly mime_type: OwnerHiggsfieldDopImageMimeType;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  readonly provenance: "OWNED_EXISTING_ACCOUNT_ASSET";
  readonly provider_acceptance: "UNPROVEN";
  readonly generation_permit: false;
  readonly owner_asset_binding: "SAME_CLIENT_ACCOUNT_FILE_IMPORT";
}

export type OwnerHiggsfieldDopUploadReference = Readonly<{ type: "image"; url: string }>;

/** Mints a URL-hidden context tied to the exact native upload client and parsed upload response. */
export function createOwnerHiggsfieldDopImageUploadContext(
  clientInput: unknown,
  referenceInput: InternalUploadReference,
  metadataInput: Readonly<{ model_id: OwnerHiggsfieldDopModelId; destination: OwnerHiggsfieldDopUploadDestination;
    mime_type: OwnerHiggsfieldDopImageMimeType; size: number; sha256: string; width: number; height: number }>
): OwnerHiggsfieldDopImageUploadContext {
  if (!isExactClient(clientInput)) throw new Error("OWNER_HIGGSFIELD_DOP_UPLOAD_CONTEXT_INVALID");
  const ref = readReference(referenceInput), meta = readMetadata(metadataInput);
  if (!ref || !meta) throw new Error("OWNER_HIGGSFIELD_DOP_UPLOAD_CONTEXT_INVALID");
  const method = dataMethod(SyntxChatHttpClient.prototype, METHOD);
  if (typeof method !== "function") throw new Error("OWNER_HIGGSFIELD_DOP_UPLOAD_CONTEXT_INVALID");
  const context: OwnerHiggsfieldDopImageUploadContext = Object.freeze({
    status: "uploaded", model_id: meta.model_id, destination: meta.destination, media_type: "image", mime_type: meta.mime_type,
    size: meta.size, sha256: meta.sha256, width: meta.width, height: meta.height,
    metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS", provider_acceptance: "UNPROVEN",
    generation_permit: false, owner_upload_binding: "SAME_CLIENT_NATIVE_UPLOAD"
  });
  UPLOADS.set(context, Object.freeze({ client: clientInput as SyntxChatHttpClient, context, url: ref.url, nativeMethod: method }));
  return context;
}

export function createOwnerHiggsfieldDopExistingImageContext(
  clientInput: unknown,
  referenceInput: InternalUploadReference,
  metadataInput: Readonly<{ model_id: OwnerHiggsfieldDopModelId; destination: "uploaded";
    mime_type: OwnerHiggsfieldDopImageMimeType; size: number; sha256: string; width: number; height: number }>,
  fileIdInput: unknown
): OwnerHiggsfieldDopExistingImageContext {
  if (!isExactClient(clientInput, undefined, IMPORT_METHOD)) throw new Error("OWNER_HIGGSFIELD_DOP_IMPORT_CONTEXT_INVALID");
  const ref = readReference(referenceInput), meta = readMetadata({ ...metadataInput, destination: "uploaded" });
  if (!ref || !meta || !safeFileId(fileIdInput)) throw new Error("OWNER_HIGGSFIELD_DOP_IMPORT_CONTEXT_INVALID");
  const method = dataMethod(SyntxChatHttpClient.prototype, IMPORT_METHOD);
  if (typeof method !== "function") throw new Error("OWNER_HIGGSFIELD_DOP_IMPORT_CONTEXT_INVALID");
  const context: OwnerHiggsfieldDopExistingImageContext = Object.freeze({ status: "imported", model_id: meta.model_id,
    destination: "uploaded", media_type: "image", mime_type: meta.mime_type, size: meta.size, sha256: meta.sha256,
    width: meta.width, height: meta.height, metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS",
    provenance: "OWNED_EXISTING_ACCOUNT_ASSET", provider_acceptance: "UNPROVEN", generation_permit: false,
    owner_asset_binding: "SAME_CLIENT_ACCOUNT_FILE_IMPORT" });
  IMPORTS.set(context, Object.freeze({ client: clientInput as SyntxChatHttpClient, context, url: ref.url,
    fileId: fileIdInput, nativeMethod: method }));
  return context;
}

/** Only the exact native upload client can retrieve the hidden uploaded image URL. */
export function readOwnerHiggsfieldDopUploadReferenceForClient(
  clientInput: unknown, contextInput: unknown
): OwnerHiggsfieldDopUploadReference | null {
  try {
    if (!contextInput || typeof contextInput !== "object" || types.isProxy(contextInput)) return null;
    const witness = UPLOADS.get(contextInput);
    if (!witness || witness.client !== clientInput || witness.context !== contextInput || !Object.isFrozen(contextInput) ||
        !isExactClient(clientInput, witness.nativeMethod) || !isSafeUploadReferenceUrl(witness.url)) return null;
    const c = contextInput as OwnerHiggsfieldDopImageUploadContext;
    if (c.status !== "uploaded" || c.model_id !== witness.context.model_id || c.destination !== witness.context.destination ||
        c.media_type !== "image" || c.mime_type !== witness.context.mime_type || c.size !== witness.context.size ||
        c.sha256 !== witness.context.sha256 || c.width !== witness.context.width || c.height !== witness.context.height ||
        c.metadata_confidence !== "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" || c.provider_acceptance !== "UNPROVEN" ||
        c.generation_permit !== false || c.owner_upload_binding !== "SAME_CLIENT_NATIVE_UPLOAD") return null;
    return Object.freeze({ type: "image", url: witness.url });
  } catch { return null; }
}

export function readOwnerHiggsfieldDopExistingImageReferenceForClient(
  clientInput: unknown, contextInput: unknown, fileIdInput: unknown
): OwnerHiggsfieldDopUploadReference | null {
  try {
    if (!contextInput || typeof contextInput !== "object" || types.isProxy(contextInput) || !safeFileId(fileIdInput)) return null;
    const witness = IMPORTS.get(contextInput);
    if (!witness || witness.client !== clientInput || witness.context !== contextInput || witness.fileId !== fileIdInput ||
        !Object.isFrozen(contextInput) || !isExactClient(clientInput, witness.nativeMethod, IMPORT_METHOD) || !isSafeUploadReferenceUrl(witness.url)) return null;
    const c = contextInput as OwnerHiggsfieldDopExistingImageContext;
    if (c.status !== "imported" || c.model_id !== witness.context.model_id || c.destination !== "uploaded" || c.media_type !== "image" ||
        c.mime_type !== witness.context.mime_type || c.size !== witness.context.size || c.sha256 !== witness.context.sha256 ||
        c.width !== witness.context.width || c.height !== witness.context.height ||
        c.metadata_confidence !== "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" || c.provenance !== "OWNED_EXISTING_ACCOUNT_ASSET" ||
        c.provider_acceptance !== "UNPROVEN" || c.generation_permit !== false || c.owner_asset_binding !== "SAME_CLIENT_ACCOUNT_FILE_IMPORT") return null;
    return Object.freeze({ type: "image", url: witness.url });
  } catch { return null; }
}

function isExactClient(value: unknown, expectedMethod?: Function, methodName = METHOD): value is SyntxChatHttpClient {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype ||
        Object.hasOwn(value, methodName)) return false;
    const method = dataMethod(SyntxChatHttpClient.prototype, methodName);
    return typeof method === "function" && (expectedMethod === undefined || expectedMethod === method) && Reflect.get(value, methodName) === method;
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

function readReference(value: unknown): Readonly<{ url: string }> | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (!keys.includes("url") || keys.some(key => typeof key !== "string" || !["url", "file_id"].includes(key) ||
        !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) return null;
    const url = descriptors.url!.value;
    return typeof url === "string" && isSafeUploadReferenceUrl(url) ? Object.freeze({ url }) : null;
  } catch { return null; }
}

function readMetadata(value: unknown): Readonly<{ model_id: OwnerHiggsfieldDopModelId; destination: OwnerHiggsfieldDopUploadDestination;
  mime_type: OwnerHiggsfieldDopImageMimeType; size: number; sha256: string; width: number; height: number }> | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value), expected = ["model_id", "destination", "mime_type", "size", "sha256", "width", "height"];
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== expected.length || keys.some(key => typeof key !== "string" || !expected.includes(key) ||
        !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) return null;
    const fields = Object.create(null) as Record<string, unknown>;
    for (const key of expected) fields[key] = descriptors[key]!.value;
    if ((fields.model_id !== "dop-lite" && fields.model_id !== "dop-turbo") ||
        (fields.destination !== "uploaded" && fields.destination !== "hidden") ||
        (fields.mime_type !== "image/jpeg" && fields.mime_type !== "image/png" && fields.mime_type !== "image/webp") ||
        !Number.isSafeInteger(fields.size) || (fields.size as number) < 1 || (fields.size as number) > MAX_IMAGE_BYTES ||
        typeof fields.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(fields.sha256) ||
        !Number.isSafeInteger(fields.width) || (fields.width as number) < 1 || (fields.width as number) > MAX_DIMENSION ||
        !Number.isSafeInteger(fields.height) || (fields.height as number) < 1 || (fields.height as number) > MAX_DIMENSION ||
        (fields.width as number) * (fields.height as number) > MAX_PIXELS) return null;
    return Object.freeze({ model_id: fields.model_id, destination: fields.destination, mime_type: fields.mime_type,
      size: fields.size, sha256: fields.sha256, width: fields.width, height: fields.height }) as Readonly<{
        model_id: OwnerHiggsfieldDopModelId; destination: OwnerHiggsfieldDopUploadDestination;
        mime_type: OwnerHiggsfieldDopImageMimeType; size: number; sha256: string; width: number; height: number
      }>;
  } catch { return null; }
}

function safeFileId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value); }
