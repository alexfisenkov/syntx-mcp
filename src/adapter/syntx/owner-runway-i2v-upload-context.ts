import { types } from "node:util";
import { SyntxChatHttpClient } from "./chat-http-client.js";
import type {
  OwnerRunwayI2vImageAspectRatio,
  OwnerRunwayI2vImageMimeType,
  OwnerRunwayI2vImageModelId
} from "../../application/owner-runway-i2v-image-policy.js";
import type { InternalUploadReference } from "./upload-reference-bridge.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";

const UPLOAD_METHOD = "uploadOwnerRunwayI2vImage" as const;
const RATIOS: Readonly<Record<OwnerRunwayI2vImageAspectRatio, readonly [number, number]>> = Object.freeze({
  "21:9": [21, 9], "16:9": [16, 9], "4:3": [4, 3], "1:1": [1, 1], "3:4": [3, 4], "9:16": [9, 16]
});
const UPLOADS = new WeakMap<object, UploadWitness>();

export interface OwnerRunwayI2vImageUploadContext {
  readonly status: "uploaded";
  readonly model_id: OwnerRunwayI2vImageModelId;
  readonly aspect_ratio: OwnerRunwayI2vImageAspectRatio;
  readonly media_type: "image";
  readonly mime_type: OwnerRunwayI2vImageMimeType;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  readonly provider_acceptance: "UNPROVEN";
  readonly generation_permit: false;
  readonly owner_upload_binding: "SAME_CLIENT_NATIVE_UPLOAD";
}

export interface OwnerRunwayI2vImageUploadMetadata {
  readonly model_id: OwnerRunwayI2vImageModelId;
  readonly aspect_ratio: OwnerRunwayI2vImageAspectRatio;
  readonly mime_type: OwnerRunwayI2vImageMimeType;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
}

export type OwnerRunwayI2vUploadReference = Readonly<{ readonly type: "image"; readonly url: string }>;

interface UploadWitness {
  readonly client: SyntxChatHttpClient;
  readonly context: OwnerRunwayI2vImageUploadContext;
  readonly url: string;
  readonly nativeMethod: Function;
}

/** Internal post-upload constructor; accepts only parsed internal references and a native client instance. */
export function createOwnerRunwayI2vImageUploadContext(
  clientInput: unknown,
  referenceInput: InternalUploadReference,
  metadataInput: OwnerRunwayI2vImageUploadMetadata
): OwnerRunwayI2vImageUploadContext {
  if (!isExactNativeClient(clientInput)) throw new Error("OWNER_RUNWAY_I2V_UPLOAD_CONTEXT_INVALID");
  const reference = readReference(referenceInput);
  const metadata = readMetadata(metadataInput);
  if (!reference || !metadata) throw new Error("OWNER_RUNWAY_I2V_UPLOAD_CONTEXT_INVALID");
  const nativeMethod = getDataMethod(SyntxChatHttpClient.prototype, UPLOAD_METHOD);
  if (typeof nativeMethod !== "function") throw new Error("OWNER_RUNWAY_I2V_UPLOAD_CONTEXT_INVALID");

  const context: OwnerRunwayI2vImageUploadContext = Object.freeze({
    status: "uploaded",
    model_id: metadata.model_id,
    aspect_ratio: metadata.aspect_ratio,
    media_type: "image",
    mime_type: metadata.mime_type,
    size: metadata.size,
    sha256: metadata.sha256,
    width: metadata.width,
    height: metadata.height,
    metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS",
    provider_acceptance: "UNPROVEN",
    generation_permit: false,
    owner_upload_binding: "SAME_CLIENT_NATIVE_UPLOAD"
  });
  UPLOADS.set(context, Object.freeze({ client: clientInput, context, url: reference.url, nativeMethod }));
  return context;
}

/** Returns an internal image reference only for the genuine context and client that uploaded it. */
export function readOwnerRunwayI2vUploadReferenceForClient(
  clientInput: unknown,
  contextInput: unknown
): OwnerRunwayI2vUploadReference | null {
  try {
    if (!contextInput || typeof contextInput !== "object" || types.isProxy(contextInput)) return null;
    const witness = UPLOADS.get(contextInput);
    if (!witness || witness.client !== clientInput || witness.context !== contextInput || !Object.isFrozen(contextInput) ||
        !isExactNativeClient(clientInput, witness.nativeMethod) || !isSafeUploadReferenceUrl(witness.url)) return null;
    const context = contextInput as OwnerRunwayI2vImageUploadContext;
    if (context.status !== "uploaded" || context.model_id !== witness.context.model_id ||
        context.aspect_ratio !== witness.context.aspect_ratio || context.media_type !== "image" ||
        context.mime_type !== witness.context.mime_type || context.size !== witness.context.size ||
        context.sha256 !== witness.context.sha256 || context.width !== witness.context.width ||
        context.height !== witness.context.height ||
        context.metadata_confidence !== "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" ||
        context.provider_acceptance !== "UNPROVEN" || context.generation_permit !== false ||
        context.owner_upload_binding !== "SAME_CLIENT_NATIVE_UPLOAD") return null;
    return Object.freeze({ type: "image", url: witness.url });
  } catch { return null; }
}

function isExactNativeClient(value: unknown, expectedMethod?: Function): value is SyntxChatHttpClient {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) ||
        Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype || Object.hasOwn(value, UPLOAD_METHOD)) return false;
    const method = getDataMethod(SyntxChatHttpClient.prototype, UPLOAD_METHOD);
    return typeof method === "function" && (expectedMethod === undefined || method === expectedMethod) &&
      Reflect.get(value, UPLOAD_METHOD) === method;
  } catch { return false; }
}

function getDataMethod(target: object, key: string): unknown {
  let current: object | null = target;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function readReference(value: unknown): InternalUploadReference | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (!keys.includes("url") || keys.some((key) => typeof key !== "string" || !["url", "file_id"].includes(key) ||
        !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) return null;
    const url = descriptors.url!.value;
    const fileId = descriptors.file_id?.value;
    if (typeof url !== "string" || !isSafeUploadReferenceUrl(url) ||
        (fileId !== undefined && (typeof fileId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(fileId)))) return null;
    return Object.freeze({ ...(typeof fileId === "string" ? { file_id: fileId } : {}), url });
  } catch { return null; }
}

function readMetadata(value: unknown): OwnerRunwayI2vImageUploadMetadata | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const expected = ["model_id", "aspect_ratio", "mime_type", "size", "sha256", "width", "height"] as const;
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== expected.length || keys.some((key) => typeof key !== "string" || !expected.includes(key as typeof expected[number]) ||
        !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) return null;
    const fields = Object.fromEntries(expected.map((key) => [key, descriptors[key]!.value])) as Record<string, unknown>;
    const model = fields.model_id;
    const aspect = fields.aspect_ratio;
    const mime = fields.mime_type;
    if ((model !== "4genfirstframeimage" && model !== "turbo4genfirstframeimage") ||
        typeof aspect !== "string" || !Object.hasOwn(RATIOS, aspect) ||
        (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") ||
        !Number.isSafeInteger(fields.size) || (fields.size as number) < 1 || (fields.size as number) > 10 * 1024 * 1024 ||
        typeof fields.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(fields.sha256) ||
        !Number.isSafeInteger(fields.width) || (fields.width as number) < 1 || (fields.width as number) > 8_400 ||
        !Number.isSafeInteger(fields.height) || (fields.height as number) < 1 || (fields.height as number) > 8_400 ||
        (fields.width as number) * (fields.height as number) > 52_500_000) return null;
    const [numerator, denominator] = RATIOS[aspect as OwnerRunwayI2vImageAspectRatio];
    if ((fields.width as number) * denominator !== (fields.height as number) * numerator) return null;
    return Object.freeze({ model_id: model as OwnerRunwayI2vImageModelId, aspect_ratio: aspect as OwnerRunwayI2vImageAspectRatio,
      mime_type: mime as OwnerRunwayI2vImageMimeType, size: fields.size as number, sha256: fields.sha256,
      width: fields.width as number, height: fields.height as number });
  } catch { return null; }
}
