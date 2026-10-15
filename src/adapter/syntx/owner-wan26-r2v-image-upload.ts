import { types } from "node:util";
import {
  validateOwnerWan26R2vImage,
  type OwnerWan26R2vModelId,
  type ValidatedOwnerWan26R2vImage
} from "../../application/owner-wan26-r2v-image-policy.js";

/** Raw image bytes for the one fixed WAN26 R2V uploaded-image path. */
export interface OwnerWan26R2vImageUploadRequest {
  readonly model_id: OwnerWan26R2vModelId;
  readonly filename: string;
  readonly mime_type: string;
  readonly bytes: Uint8Array;
}

/** Validates the exact raw request and delegates byte integrity checks to the R2V image policy. */
export function validateOwnerWan26R2vImageUploadRequest(input: unknown): Readonly<ValidatedOwnerWan26R2vImage> {
  const fields = exactRecord(input, ["model_id", "filename", "mime_type", "bytes"]);
  return validateOwnerWan26R2vImage({
    model_id: fields.model_id,
    filename: fields.filename,
    mime_type: fields.mime_type,
    bytes: fields.bytes
  });
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) invalid();
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || actual.length !== keys.length || actual.some((key) =>
      typeof key !== "string" || !keys.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of actual as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch { return invalid(); }
}

function invalid(): never { throw new TypeError("INVALID_WAN26_R2V_IMAGE_UPLOAD_REQUEST"); }
