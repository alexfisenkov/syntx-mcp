import { createHash } from "node:crypto";
import { types } from "node:util";

const MAX_BYTES = 7 * 1024 * 1024;
const MAX_REUSABLE_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_STANDARD_FAMILY_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_EXPLICIT_IMAGE_INSPECTION_BYTES = 64 * 1024 * 1024;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const MAX_BASE64_CHARS = Math.ceil(MAX_BYTES / 3) * 4;
const MAX_DIMENSION = 8_400;
const MAX_PIXELS = 52_500_000;
const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SAFE_FILENAME = /^[^/\\\u0000-\u001f\u007f]{1,128}$/u;
const PNG_CRITICAL_CHUNKS = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);

export interface ValidatedOwnerImageReferenceInput {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: "image/jpeg" | "image/png" | "image/webp";
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

export class OwnerImageReferenceInputError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT") {
    super("The owner image input is invalid.");
    this.name = "OwnerImageReferenceInputError";
  }
}

/** Validates a portable image payload without trusting caller MIME or dimensions. */
export function validateOwnerImageReferenceInput(input: unknown): ValidatedOwnerImageReferenceInput {
  try {
    const fields = exactRecord(input, ["content_base64", "filename", "mime_type"]);
    if (typeof fields.content_base64 !== "string" || fields.content_base64.length === 0 ||
        fields.content_base64.length > MAX_BASE64_CHARS || fields.content_base64.length % 4 !== 0 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(fields.content_base64) ||
        typeof fields.filename !== "string" || !SAFE_FILENAME.test(fields.filename) ||
        typeof fields.mime_type !== "string" || !MIME_TYPES.has(fields.mime_type)) invalid();

    const bytes = Buffer.from(fields.content_base64, "base64");
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES || bytes.toString("base64") !== fields.content_base64) invalid();
    const parsed = inspectBoundedOwnerImageBytes(bytes, MAX_BYTES);
    if (parsed.mime !== fields.mime_type || parsed.width < 1 || parsed.height < 1 ||
        parsed.width > MAX_DIMENSION || parsed.height > MAX_DIMENSION || parsed.width * parsed.height > MAX_PIXELS) invalid();

    return Object.freeze({
      bytes: new Uint8Array(bytes),
      filename: fields.filename,
      mime_type: parsed.mime,
      width: parsed.width,
      height: parsed.height,
      sha256: createHash("sha256").update(bytes).digest("hex")
    });
  } catch (error) {
    if (error instanceof OwnerImageReferenceInputError) throw error;
    return invalid();
  }
}

/** Sniffs existing reference formats under a caller-selected, hard bounded byte policy. */
export function inspectBoundedOwnerImageBytes(bytes: Uint8Array, maxBytes: number): {
  readonly mime: "image/jpeg" | "image/png" | "image/webp";
  readonly width: number;
  readonly height: number;
} {
  try {
    if (types.isProxy(bytes) || (!Buffer.isBuffer(bytes) && Object.getPrototypeOf(bytes) !== Uint8Array.prototype) ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_REUSABLE_IMAGE_BYTES ||
        bytes.byteLength < 1 || bytes.byteLength > maxBytes) invalid();
    return Object.freeze(parseImage(bytes));
  } catch (error) {
    if (error instanceof OwnerImageReferenceInputError) throw error;
    return invalid();
  }
}

/** Structural metadata inspection for the separate standard image-family local 32 MiB policy. */
export function inspectBoundedOwnerImageBytes32MiB(bytes: Uint8Array, maxBytes: number): {
  readonly mime: "image/jpeg" | "image/png" | "image/webp";
  readonly width: number;
  readonly height: number;
} {
  return inspectBoundedOwnerImageBytesWithMaximum(bytes, maxBytes, MAX_STANDARD_FAMILY_IMAGE_BYTES);
}

/** Structural image inspection under an explicit trusted ceiling no greater than 64 MiB. */
export function inspectBoundedOwnerImageBytesWithMax(bytes: Uint8Array, maxBytes: number): {
  readonly mime: "image/jpeg" | "image/png" | "image/webp";
  readonly width: number;
  readonly height: number;
} {
  return inspectBoundedOwnerImageBytesWithMaximum(bytes, maxBytes, MAX_EXPLICIT_IMAGE_INSPECTION_BYTES);
}

function inspectBoundedOwnerImageBytesWithMaximum(bytes: Uint8Array, maxBytes: number, ceiling: number): {
  readonly mime: "image/jpeg" | "image/png" | "image/webp";
  readonly width: number;
  readonly height: number;
} {
  try {
    if (types.isProxy(bytes) || (Object.getPrototypeOf(bytes) !== Uint8Array.prototype && Object.getPrototypeOf(bytes) !== Buffer.prototype) ||
        Object.hasOwn(bytes, "buffer") || Object.hasOwn(bytes, "byteLength") || Object.hasOwn(bytes, "byteOffset") || Object.hasOwn(bytes, "length") ||
        !hasSafeArrayBufferBacking(bytes) ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > ceiling ||
        typedArrayByteLength(bytes) < 1 || typedArrayByteLength(bytes) > maxBytes) invalid();
    return Object.freeze(parseImage(bytes));
  } catch (error) {
    if (error instanceof OwnerImageReferenceInputError) throw error;
    return invalid();
  }
}

function typedArrayByteLength(bytes: Uint8Array): number {
  return Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, bytes, []) as number;
}
function hasSafeArrayBufferBacking(bytes: Uint8Array): boolean {
  const backing = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, bytes, []) as ArrayBuffer;
  return !types.isProxy(backing) && Object.getPrototypeOf(backing) === ArrayBuffer.prototype && !Object.hasOwn(backing, "byteLength");
}

function parseImage(bytes: Uint8Array): { mime: "image/jpeg" | "image/png" | "image/webp"; width: number; height: number } {
  if (isPng(bytes)) return parsePng(bytes);
  if (isJpeg(bytes)) return parseJpeg(bytes);
  if (isWebp(bytes)) return parseWebp(bytes);
  return invalid();
}

function parsePng(bytes: Uint8Array) {
  if (bytes.byteLength < 45 || readU32(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== "IHDR") invalid();
  const width = readU32(bytes, 16);
  const height = readU32(bytes, 20);
  const bitDepth = bytes[24]!;
  const colorType = bytes[25]!;
  const validDepths: Readonly<Record<number, readonly number[]>> = {
    0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16]
  };
  if (!validDepths[colorType]?.includes(bitDepth) || bytes[26] !== 0 || bytes[27] !== 0 ||
      (bytes[28] !== 0 && bytes[28] !== 1)) invalid();
  let offset = 8;
  let first = true;
  let sawEnd = false;
  let sawImageData = false;
  let imageDataEnded = false;
  let sawPalette = false;
  const indexedColor = colorType === 3;
  while (offset + 12 <= bytes.byteLength) {
    const length = readU32(bytes, offset);
    if (length > bytes.byteLength - offset - 12) invalid();
    const type = ascii(bytes, offset + 4, 4);
    if (!/^[A-Za-z]{4}$/u.test(type) || (bytes[offset + 6]! & 0x20) !== 0) invalid();
    if (!PNG_CRITICAL_CHUNKS.has(type) && (bytes[offset + 4]! & 0x20) === 0) invalid();
    if (first && (type !== "IHDR" || length !== 13)) invalid();
    if (!first && type === "IHDR") invalid();
    if (type === "PLTE") {
      if (sawPalette || sawImageData || (colorType !== 2 && colorType !== 3 && colorType !== 6) ||
          length < 3 || length > 768 || length % 3 !== 0) invalid();
      sawPalette = true;
      if (indexedColor && length / 3 > 2 ** bitDepth) invalid();
    }
    if (type === "IDAT") {
      if (imageDataEnded || (indexedColor && !sawPalette)) invalid();
      sawImageData = true;
    } else if (sawImageData && type !== "IEND") {
      imageDataEnded = true;
    }
    const crcOffset = offset + 8 + length;
    if (readU32(bytes, crcOffset) !== pngCrc32(bytes, offset + 4, 4 + length)) invalid();
    offset = crcOffset + 4;
    first = false;
    if (type === "IEND") {
      if (length !== 0 || offset !== bytes.byteLength || !sawImageData) invalid();
      sawEnd = true;
      break;
    }
  }
  if (first || !sawEnd) invalid();
  return { mime: "image/png" as const, width, height };
}

function parseJpeg(bytes: Uint8Array) {
  if (bytes.byteLength < 12 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) invalid();
  let offset = 2;
  let dimensions: { width: number; height: number } | undefined;
  while (offset + 4 <= bytes.byteLength - 2) {
    if (bytes[offset] !== 0xff) invalid();
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || offset + 2 > bytes.byteLength) invalid();
    const length = readU16(bytes, offset);
    if (length < 2 || offset + length > bytes.byteLength) invalid();
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8) invalid();
      dimensions = { height: readU16(bytes, offset + 3), width: readU16(bytes, offset + 5) };
    }
    if (marker === 0xda) {
      if (!dimensions || length < 6 || offset + length >= bytes.byteLength - 2) invalid();
      return { mime: "image/jpeg" as const, ...dimensions };
    }
    offset += length;
  }
  return invalid();
}

function parseWebp(bytes: Uint8Array) {
  if (bytes.byteLength < 26 || readU32le(bytes, 4) !== bytes.byteLength - 8) invalid();
  let offset = 12;
  let extendedDimensions: { width: number; height: number } | undefined;
  let imageDimensions: { width: number; height: number } | undefined;
  let sawVp8x = false;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) invalid();
    const kind = ascii(bytes, offset, 4);
    const length = readU32le(bytes, offset + 4);
    const data = offset + 8;
    const end = data + length + (length % 2);
    if (end > bytes.byteLength || end <= offset || !/^[A-Z0-9 ]{4}$/u.test(kind) ||
        (length % 2 === 1 && bytes[data + length] !== 0)) invalid();
    if (kind === "VP8X") {
      if (sawVp8x || offset !== 12 || length !== 10 || imageDimensions) invalid();
      sawVp8x = true;
      extendedDimensions = { width: readU24le(bytes, data + 4) + 1, height: readU24le(bytes, data + 7) + 1 };
    }
    if (kind === "VP8 ") {
      if (imageDimensions || length < 10 || bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) invalid();
      imageDimensions = { width: readU16le(bytes, data + 6) & 0x3fff, height: readU16le(bytes, data + 8) & 0x3fff };
    }
    if (kind === "VP8L") {
      if (imageDimensions || length < 5 || bytes[data] !== 0x2f) invalid();
      const b1 = bytes[data + 1]!; const b2 = bytes[data + 2]!; const b3 = bytes[data + 3]!; const b4 = bytes[data + 4]!;
      imageDimensions = { width: 1 + (((b2 & 0x3f) << 8) | b1), height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)) };
    }
    offset = end;
  }
  if (!imageDimensions || offset !== bytes.byteLength ||
      (extendedDimensions && (extendedDimensions.width !== imageDimensions.width || extendedDimensions.height !== imageDimensions.height))) invalid();
  return { mime: "image/webp" as const, ...imageDimensions };
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || actual.length !== keys.length ||
      actual.some((key) => typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!))) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 8 && bytes[0] === 137 && ascii(bytes, 1, 3) === "PNG" && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10;
}
function isJpeg(bytes: Uint8Array): boolean { return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff; }
function isWebp(bytes: Uint8Array): boolean { return bytes.byteLength >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP"; }
function ascii(bytes: Uint8Array, offset: number, length: number): string { return String.fromCharCode(...bytes.subarray(offset, offset + length)); }
function readU16(bytes: Uint8Array, offset: number): number { return (bytes[offset]! << 8) | bytes[offset + 1]!; }
function readU32(bytes: Uint8Array, offset: number): number { return bytes[offset]! * 0x1000000 + (bytes[offset + 1]! << 16) + (bytes[offset + 2]! << 8) + bytes[offset + 3]!; }
function readU16le(bytes: Uint8Array, offset: number): number { return bytes[offset]! | (bytes[offset + 1]! << 8); }
function readU24le(bytes: Uint8Array, offset: number): number { return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16); }
function readU32le(bytes: Uint8Array, offset: number): number { return readU16le(bytes, offset) + readU16le(bytes, offset + 2) * 0x1_0000; }
function pngCrc32(bytes: Uint8Array, offset: number, length: number): number {
  let crc = 0xffffffff;
  for (let i = offset; i < offset + length; i += 1) {
    crc ^= bytes[i]!;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function invalid(): never { throw new OwnerImageReferenceInputError("INVALID_IMAGE_INPUT"); }
