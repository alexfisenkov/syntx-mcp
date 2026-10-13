import { types } from "node:util";
import {
  validateOwnerUniImageUploadData,
  type OwnerUniImageOriginalMimeType,
  type ValidatedOwnerUniImageInput
} from "../../application/owner-uni-image-input-validator.js";

export const OWNER_UNI_IMAGE_MODEL_IDS = Object.freeze([
  "uni-1", "uni-1.1-modify-image", "uni-1.1-remove-background"
] as const);

export type OwnerUniImageModelId = typeof OWNER_UNI_IMAGE_MODEL_IDS[number];

/** Native internal upload request; never accepts a provider URL or role metadata. */
export interface OwnerUniImageReferenceUploadRequest {
  readonly model_id: OwnerUniImageModelId;
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: OwnerUniImageOriginalMimeType;
}

export interface ValidatedOwnerUniImageReferenceUploadRequest extends ValidatedOwnerUniImageInput {
  readonly model_id: OwnerUniImageModelId;
}

/** Exact model-bound request snapshot used only by the native Uni upload method. */
export function validateOwnerUniImageReferenceUploadRequest(input: unknown): ValidatedOwnerUniImageReferenceUploadRequest {
  const fields = exactRecord(input, ["model_id", "bytes", "filename", "mime_type"]);
  if (typeof fields.model_id !== "string" || !(OWNER_UNI_IMAGE_MODEL_IDS as readonly string[]).includes(fields.model_id)) invalid();
  const image = validateOwnerUniImageUploadData({ bytes: fields.bytes, filename: fields.filename, mime_type: fields.mime_type });
  return Object.freeze({ ...image, model_id: fields.model_id as OwnerUniImageModelId });
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || actual.length !== keys.length || actual.some((key) =>
    typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true
  )) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function invalid(): never { throw new TypeError("INVALID_UNI_IMAGE_UPLOAD_REQUEST"); }
