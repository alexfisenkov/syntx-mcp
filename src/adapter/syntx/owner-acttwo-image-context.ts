import { types } from "node:util";
import { SyntxChatHttpClient } from "./chat-http-client.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";
import type { OwnerActTwoCharacterImageMimeType } from "../../application/owner-acttwo-image-policy.js";

export type OwnerActTwoUploadDestination = "uploaded" | "hidden";
export interface OwnerActTwoCharacterImageUploadContext {
  readonly status: "uploaded";
  readonly model_id: "acttwo";
  readonly destination: OwnerActTwoUploadDestination;
  readonly media_type: "image";
  readonly mime_type: OwnerActTwoCharacterImageMimeType;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly provider_acceptance: "UNPROVEN";
  readonly generation_permit: false;
}
export type OwnerActTwoCharacterImageReference = Readonly<{ type: "image"; url: string }>;

const METHOD = "uploadOwnerActTwoCharacterImage";
const UPLOADS = new WeakMap<object, Readonly<{ client: SyntxChatHttpClient; context: OwnerActTwoCharacterImageUploadContext; url: string; nativeMethod: Function }>>();

export function createOwnerActTwoCharacterImageUploadContext(clientInput: unknown, referenceInput: unknown,
  metadataInput: unknown): OwnerActTwoCharacterImageUploadContext {
  if (!isClient(clientInput)) throw new Error("OWNER_ACTTWO_IMAGE_CONTEXT_INVALID");
  const reference = readReference(referenceInput), metadata = readMetadata(metadataInput);
  if (!reference || !metadata) throw new Error("OWNER_ACTTWO_IMAGE_CONTEXT_INVALID");
  const nativeMethod = Reflect.get(SyntxChatHttpClient.prototype, METHOD);
  if (typeof nativeMethod !== "function") throw new Error("OWNER_ACTTWO_IMAGE_CONTEXT_INVALID");
  const context = Object.freeze({ status: "uploaded" as const, model_id: "acttwo" as const, destination: metadata.destination,
    media_type: "image" as const, mime_type: metadata.mime_type, size: metadata.size, sha256: metadata.sha256,
    width: metadata.width, height: metadata.height, provider_acceptance: "UNPROVEN" as const, generation_permit: false as const });
  UPLOADS.set(context, Object.freeze({ client: clientInput as SyntxChatHttpClient, context, url: reference.url, nativeMethod }));
  return context;
}

export function readOwnerActTwoCharacterImageReference(clientInput: unknown, contextInput: unknown): OwnerActTwoCharacterImageReference | null {
  try {
    if (!contextInput || typeof contextInput !== "object" || types.isProxy(contextInput)) return null;
    const witness = UPLOADS.get(contextInput);
    if (!witness || witness.client !== clientInput || witness.context !== contextInput || !Object.isFrozen(contextInput) ||
        !isClient(clientInput, witness.nativeMethod) || !isSafeUploadReferenceUrl(witness.url)) return null;
    const context = contextInput as OwnerActTwoCharacterImageUploadContext;
    if (context.status !== "uploaded" || context.model_id !== "acttwo" || context.destination !== witness.context.destination ||
        context.media_type !== "image" || context.mime_type !== witness.context.mime_type || context.size !== witness.context.size ||
        context.sha256 !== witness.context.sha256 || context.width !== witness.context.width || context.height !== witness.context.height ||
        context.provider_acceptance !== "UNPROVEN" || context.generation_permit !== false) return null;
    return Object.freeze({ type: "image", url: witness.url });
  } catch { return null; }
}

function isClient(value: unknown, expected?: Function): value is SyntxChatHttpClient {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype || Object.hasOwn(value, METHOD)) return false;
    const method = Reflect.get(SyntxChatHttpClient.prototype, METHOD);
    return typeof method === "function" && (expected === undefined || expected === method) && Reflect.get(value, METHOD) === method;
  } catch { return false; }
}
function readReference(value: unknown): Readonly<{ url: string }> | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== "string" || !["url", "file_id"].includes(key) || !Object.hasOwn(descriptors[key]!, "value") ||
        descriptors[key]!.enumerable !== true)) return null;
    const url = descriptors.url?.value;
    return typeof url === "string" && isSafeUploadReferenceUrl(url) ? Object.freeze({ url }) : null;
  } catch { return null; }
}
function readMetadata(value: unknown): Readonly<Omit<OwnerActTwoCharacterImageUploadContext, "status" | "media_type" | "provider_acceptance" | "generation_permit">> | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    const expected = ["model_id", "destination", "mime_type", "size", "sha256", "width", "height"];
    if ((Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || keys.length !== expected.length ||
        keys.some(key => typeof key !== "string" || !expected.includes(key) || !Object.hasOwn(descriptors[key]!, "value") ||
          descriptors[key]!.enumerable !== true)) return null;
    const fields = Object.create(null) as Record<string, unknown>;
    for (const key of expected) fields[key] = descriptors[key]!.value;
    if (fields.model_id !== "acttwo" || (fields.destination !== "uploaded" && fields.destination !== "hidden") ||
        (fields.mime_type !== "image/jpeg" && fields.mime_type !== "image/png") || !Number.isSafeInteger(fields.size) ||
        (fields.size as number) < 1 || (fields.size as number) > 20 * 1024 * 1024 || typeof fields.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(fields.sha256) || !Number.isSafeInteger(fields.width) || !Number.isSafeInteger(fields.height) ||
        (fields.width as number) < 1 || (fields.height as number) < 1 || (fields.width as number) > 8_400 || (fields.height as number) > 8_400 ||
        (fields.width as number) * (fields.height as number) > 52_500_000) return null;
    return Object.freeze({ model_id: "acttwo", destination: fields.destination as OwnerActTwoUploadDestination,
      mime_type: fields.mime_type as OwnerActTwoCharacterImageMimeType, size: fields.size as number, sha256: fields.sha256,
      width: fields.width as number, height: fields.height as number });
  } catch { return null; }
}
