import { types } from "node:util";
import { parseInternalUploadReferences, type InternalUploadReference } from "./upload-reference-bridge.js";

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 8_400;
const MAX_IMAGE_PIXELS = 52_500_000;
const FILENAME_INVALID = /[\\/\p{Cc}\p{Cf}\p{Cs}]/u;
const VIEW_BYTE_LENGTH = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")?.get;

export interface ProfileVideoImageUploadExpectation {
  readonly filename: string;
  readonly mime_type: string;
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export class ProfileVideoImageUploadResponseError extends Error {
  readonly code = "UPLOAD_RESPONSE_INVALID" as const;

  constructor() {
    super("The profile video image upload response is invalid or does not match the submitted image.");
    this.name = "ProfileVideoImageUploadResponseError";
  }
}

/**
 * Validates one image upload acknowledgement and returns only its existing
 * internal URL reference. `duplicate` needs a complete submitted-metadata
 * echo; metadata equality is not proof of byte identity or a provider hash.
 * The native caller separately validates and binds the outgoing image bytes.
 */
export function validateProfileVideoImageUploadResponse(
  responseInput: unknown,
  expectedInput: unknown
): InternalUploadReference {
  const expected = readExpectation(expectedInput);
  const response = readDataRecord(responseInput);
  const files = response?.files;
  if (!Array.isArray(files) || types.isProxy(files) || Object.getPrototypeOf(files) !== Array.prototype || files.length !== 1) invalid();
  const index = Object.getOwnPropertyDescriptor(files, "0");
  if (!index || !("value" in index) || index.enumerable !== true) invalid();
  const file = readDataRecord(index.value);
  if (!file || typeof file.status !== "string" || file.status.length > 64) invalid();

  const status = file.status.toLowerCase();
  if (status !== "success" && status !== "duplicate") invalid();

  const hasFilename = Object.hasOwn(file, "filename");
  const hasSize = Object.hasOwn(file, "size");
  const hasMimeType = Object.hasOwn(file, "mime_type");
  const hasContentType = Object.hasOwn(file, "content_type");
  const hasWidth = Object.hasOwn(file, "width");
  const hasHeight = Object.hasOwn(file, "height");
  const responseMimeType = hasContentType ? file.content_type : file.mime_type;

  if (hasMimeType && hasContentType && file.mime_type !== file.content_type) invalid();
  if ((hasFilename && file.filename !== expected.filename) ||
      (hasSize && (!Number.isSafeInteger(file.size) || file.size !== expected.size)) ||
      ((hasMimeType || hasContentType) && responseMimeType !== expected.mime_type) ||
      (hasWidth !== hasHeight) ||
      (hasWidth && (file.width !== expected.width || file.height !== expected.height))) invalid();

  if (status === "duplicate" && (!hasFilename || !hasSize || (!hasMimeType && !hasContentType) || !hasWidth || !hasHeight)) invalid();
  if ((file.id !== undefined && !validProviderId(file.id)) || (file.file_id !== undefined && !validProviderId(file.file_id)) ||
      (file.id !== undefined && file.file_id !== undefined && String(file.id) !== String(file.file_id))) invalid();

  let references: InternalUploadReference[];
  try {
    references = parseInternalUploadReferences({ files: [{
      ...(file.id === undefined ? {} : { id: file.id }),
      ...(file.file_id === undefined ? {} : { file_id: file.file_id }),
      url: file.url
    }] });
  } catch {
    invalid();
  }
  if (references.length !== 1) invalid();
  return references[0]!;
}

function validProviderId(value: unknown): boolean {
  return (typeof value === "string" && value.length <= 256) ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

interface ExpectedSnapshot {
  readonly filename: string;
  readonly mime_type: string;
  readonly size: number;
  readonly width: number;
  readonly height: number;
}

function readExpectation(value: unknown): ExpectedSnapshot {
  const fields = readDataRecord(value);
  if (!fields || !exactKeySet(fields, ["filename", "mime_type", "bytes", "width", "height"]) ||
      typeof fields.filename !== "string" || !fields.filename || fields.filename === "." || fields.filename === ".." ||
      FILENAME_INVALID.test(fields.filename) || Buffer.byteLength(fields.filename, "utf8") > 255 ||
      typeof fields.mime_type !== "string" || !IMAGE_MIME_TYPES.has(fields.mime_type) ||
      !(fields.bytes instanceof Uint8Array) || !ArrayBuffer.isView(fields.bytes) || types.isProxy(fields.bytes) ||
      typeof VIEW_BYTE_LENGTH !== "function" ||
      !Number.isSafeInteger(fields.width) || (fields.width as number) < 1 || (fields.width as number) > MAX_IMAGE_DIMENSION ||
      !Number.isSafeInteger(fields.height) || (fields.height as number) < 1 || (fields.height as number) > MAX_IMAGE_DIMENSION ||
      (fields.width as number) * (fields.height as number) > MAX_IMAGE_PIXELS) invalid();

  let size: unknown;
  try { size = VIEW_BYTE_LENGTH!.call(fields.bytes); } catch { return invalid(); }
  if (!Number.isSafeInteger(size) || (size as number) < 1 || (size as number) > MAX_IMAGE_BYTES) invalid();
  return Object.freeze({ filename: fields.filename, mime_type: fields.mime_type, size: size as number,
    width: fields.width as number, height: fields.height as number });
}

function readDataRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      const descriptor = descriptors[key as string];
      if (typeof key !== "string" || !descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return null;
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}

function exactKeySet(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every(key => Object.hasOwn(value, key));
}

function invalid(): never {
  throw new ProfileVideoImageUploadResponseError();
}
