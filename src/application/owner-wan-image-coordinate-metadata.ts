import { types } from "node:util";

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_DIMENSION = 8_000;
const ORIENTATIONS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8] as const);
const MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp", "image/bmp"] as const);
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")?.get;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")?.get;
const TYPED_ARRAY_BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")?.get;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;

export type OwnerWanImageOrientation = typeof ORIENTATIONS[number];
export type OwnerWanImageCoordinateConfidence =
  | "HEADER_ORIENTATION_PROJECTION_NOT_BROWSER_DECODE"
  | "UNSUPPORTED_OR_MALFORMED_METADATA";

export interface OwnerWanImageCoordinateMetadata {
  readonly orientation: OwnerWanImageOrientation | null;
  readonly projected_width: number | null;
  readonly projected_height: number | null;
  readonly confidence: OwnerWanImageCoordinateConfidence;
}

interface CoordinateInput {
  readonly bytes: Uint8Array;
  readonly mime_type: typeof MIME_TYPES[number];
  readonly width: number;
  readonly height: number;
}

type OrientationRead =
  | { readonly kind: "absent" }
  | { readonly kind: "known"; readonly orientation: OwnerWanImageOrientation }
  | { readonly kind: "invalid" };

const UNSUPPORTED = makeResult(null, null, null, "UNSUPPORTED_OR_MALFORMED_METADATA");

/** Projects trusted container dimensions through the recognized EXIF orientation only. */
export function inspectOwnerWanImageCoordinateMetadata(input: unknown): OwnerWanImageCoordinateMetadata {
  let ownedSnapshot: Uint8Array | undefined;
  try {
    const fields = exactInput(input);
    if (!MIME_TYPES.includes(fields.mime_type) || !Number.isSafeInteger(fields.width) || fields.width < 1 || fields.width > MAX_DIMENSION ||
        !Number.isSafeInteger(fields.height) || fields.height < 1 || fields.height > MAX_DIMENSION) return UNSUPPORTED;
    ownedSnapshot = copySupportedBytes(fields.bytes);
    if (!ownedSnapshot) return UNSUPPORTED;
    const read = readOrientation(ownedSnapshot, fields.mime_type);
    if (read.kind === "invalid") return UNSUPPORTED;
    const orientation = read.kind === "absent" ? 1 : read.orientation;
    const swap = orientation >= 5;
    const projectedWidth = swap ? fields.height : fields.width;
    const projectedHeight = swap ? fields.width : fields.height;
    if (!Number.isSafeInteger(projectedWidth) || !Number.isSafeInteger(projectedHeight)) return UNSUPPORTED;
    return makeResult(orientation, projectedWidth, projectedHeight, "HEADER_ORIENTATION_PROJECTION_NOT_BROWSER_DECODE");
  } catch {
    return UNSUPPORTED;
  } finally {
    ownedSnapshot?.fill(0);
  }
}

function exactInput(value: unknown): CoordinateInput {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new Error();
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  const allowed = ["bytes", "mime_type", "width", "height"] as const;
  if ((prototype !== Object.prototype && prototype !== null) || keys.length !== allowed.length ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key as typeof allowed[number]) ||
        !("value" in descriptors[key]!))) throw new Error();
  const record = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) record[key] = descriptors[key]!.value;
  return record as unknown as CoordinateInput;
}

function copySupportedBytes(value: unknown): Uint8Array | undefined {
  if (!value || typeof value !== "object" || types.isProxy(value) || !ArrayBuffer.isView(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Uint8Array.prototype && prototype !== Buffer.prototype) return undefined;
  for (const key of ["buffer", "byteLength", "byteOffset", "length"] as const) {
    if (Object.getOwnPropertyDescriptor(value, key) !== undefined) return undefined;
  }
  if (!TYPED_ARRAY_BUFFER_GETTER || !TYPED_ARRAY_BYTE_LENGTH_GETTER || !TYPED_ARRAY_BYTE_OFFSET_GETTER ||
      !ARRAY_BUFFER_BYTE_LENGTH_GETTER) return undefined;
  let snapshot: Uint8Array | undefined;
  try {
    const backing = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as ArrayBufferLike;
    const backingLength = Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, backing, []) as number;
    const byteLength = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []) as number;
    const byteOffset = Reflect.apply(TYPED_ARRAY_BYTE_OFFSET_GETTER, value, []) as number;
    if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > MAX_BYTES ||
        !Number.isSafeInteger(byteOffset) || byteOffset < 0 || byteOffset + byteLength > backingLength) return undefined;
    snapshot = new Uint8Array(byteLength);
    const source = value as Uint8Array;
    for (let index = 0; index < byteLength; index += 1) snapshot[index] = source[index]!;
    return snapshot;
  } catch {
    snapshot?.fill(0);
    return undefined;
  }
}

function readOrientation(bytes: Uint8Array, mime: CoordinateInput["mime_type"]): OrientationRead {
  if (mime === "image/jpeg") return readJpegExif(bytes);
  if (mime === "image/png") return readPngExif(bytes);
  if (mime === "image/webp") return readWebpExif(bytes);
  return hasBmpSignature(bytes) ? { kind: "absent" } : { kind: "invalid" };
}

function readJpegExif(bytes: Uint8Array): OrientationRead {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return { kind: "invalid" };
  let offset = 2;
  let result: OrientationRead = { kind: "absent" };
  let sawExif = false;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return { kind: "invalid" };
    while (bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return { kind: "invalid" };
    const marker = bytes[offset++]!;
    if (marker === 0xda) return result;
    if (marker === 0xd9 || marker === 0x00 || marker === 0xd8 || marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return { kind: "invalid" };
    const segmentLength = readU16be(bytes, offset);
    if (segmentLength < 2 || segmentLength > bytes.length - offset) return { kind: "invalid" };
    const payloadStart = offset + 2;
    const payloadEnd = offset + segmentLength;
    if (marker === 0xe1 && startsWithExifIdentifier(bytes, payloadStart, payloadEnd)) {
      if (!startsWithExif(bytes, payloadStart, payloadEnd) || sawExif) return { kind: "invalid" };
      sawExif = true;
      result = readTiffIfd0(bytes, payloadStart + 6, payloadEnd);
      if (result.kind === "invalid") return result;
    }
    offset = payloadEnd;
  }
  return { kind: "invalid" };
}

function readPngExif(bytes: Uint8Array): OrientationRead {
  if (bytes.length < 8 || !hasPngSignature(bytes)) return { kind: "invalid" };
  let offset = 8;
  let result: OrientationRead = { kind: "absent" };
  let sawExif = false;
  let sawEnd = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) return { kind: "invalid" };
    const chunkLength = readU32be(bytes, offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    const chunkEnd = dataEnd + 4;
    if (!Number.isSafeInteger(dataEnd) || !Number.isSafeInteger(chunkEnd) || chunkEnd > bytes.length) return { kind: "invalid" };
    const type = ascii(bytes, offset + 4, 4);
    if (!/^[A-Za-z]{4}$/u.test(type) || (bytes[offset + 6]! & 0x20) !== 0) return { kind: "invalid" };
    if (type === "eXIf") {
      if (readU32be(bytes, dataEnd) !== pngCrc32(bytes, offset + 4, 4 + chunkLength)) return { kind: "invalid" };
      if (sawExif) return { kind: "invalid" };
      sawExif = true;
      result = readTiffIfd0(bytes, dataStart, dataEnd);
      if (result.kind === "invalid") return result;
    }
    offset = chunkEnd;
    if (type === "IEND") {
      if (chunkLength !== 0 || offset !== bytes.length) return { kind: "invalid" };
      sawEnd = true;
      break;
    }
  }
  return sawEnd ? result : { kind: "invalid" };
}

function readWebpExif(bytes: Uint8Array): OrientationRead {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP" ||
      readU32le(bytes, 4) !== bytes.length - 8) return { kind: "invalid" };
  let offset = 12;
  let result: OrientationRead = { kind: "absent" };
  let sawExif = false;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return { kind: "invalid" };
    const kind = ascii(bytes, offset, 4);
    const length = readU32le(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + (length % 2);
    if (!Number.isSafeInteger(dataEnd) || !Number.isSafeInteger(chunkEnd) || chunkEnd > bytes.length ||
        !/^[A-Z0-9 ]{4}$/u.test(kind) || (length % 2 === 1 && bytes[dataEnd] !== 0)) return { kind: "invalid" };
    if (kind === "EXIF") {
      if (sawExif) return { kind: "invalid" };
      sawExif = true;
      if (startsWithExifIdentifier(bytes, dataStart, dataEnd) && !startsWithExif(bytes, dataStart, dataEnd)) {
        return { kind: "invalid" };
      }
      const tiffStart = startsWithExif(bytes, dataStart, dataEnd) ? dataStart + 6 : dataStart;
      result = readTiffIfd0(bytes, tiffStart, dataEnd);
      if (result.kind === "invalid") return result;
    }
    offset = chunkEnd;
  }
  return offset === bytes.length ? result : { kind: "invalid" };
}

function readTiffIfd0(bytes: Uint8Array, start: number, end: number): OrientationRead {
  if (start < 0 || end > bytes.length || end - start < 8) return { kind: "invalid" };
  const littleEndian = bytes[start] === 0x49 && bytes[start + 1] === 0x49;
  const bigEndian = bytes[start] === 0x4d && bytes[start + 1] === 0x4d;
  if (!littleEndian && !bigEndian) return { kind: "invalid" };
  const u16 = (offset: number) => littleEndian ? readU16le(bytes, offset) : readU16be(bytes, offset);
  const u32 = (offset: number) => littleEndian ? readU32le(bytes, offset) : readU32be(bytes, offset);
  if (u16(start + 2) !== 42) return { kind: "invalid" };
  const ifdOffset = u32(start + 4);
  const ifdStart = start + ifdOffset;
  if (!Number.isSafeInteger(ifdStart) || ifdOffset < 8 || ifdOffset % 2 !== 0 || ifdStart + 2 > end) return { kind: "invalid" };
  const entryCount = u16(ifdStart);
  const entriesStart = ifdStart + 2;
  const nextIfdOffsetPos = entriesStart + entryCount * 12;
  if (!Number.isSafeInteger(nextIfdOffsetPos) || nextIfdOffsetPos + 4 > end) return { kind: "invalid" };
  const nextIfdOffset = u32(nextIfdOffsetPos);
  if (nextIfdOffset !== 0 && (nextIfdOffset < 8 || nextIfdOffset % 2 !== 0 || start + nextIfdOffset + 2 > end)) return { kind: "invalid" };
  let orientation: OwnerWanImageOrientation | undefined;
  for (let index = 0; index < entryCount; index += 1) {
    const entry = entriesStart + index * 12;
    if (u16(entry) !== 274) continue;
    if (orientation !== undefined || u16(entry + 2) !== 3 || u32(entry + 4) !== 1) return { kind: "invalid" };
    const value = u16(entry + 8);
    if (!ORIENTATIONS.includes(value as OwnerWanImageOrientation)) return { kind: "invalid" };
    orientation = value as OwnerWanImageOrientation;
  }
  return orientation === undefined ? { kind: "absent" } : { kind: "known", orientation };
}

function startsWithExif(bytes: Uint8Array, start: number, end: number): boolean {
  return end - start >= 6 && bytes[start] === 0x45 && bytes[start + 1] === 0x78 && bytes[start + 2] === 0x69 &&
    bytes[start + 3] === 0x66 && bytes[start + 4] === 0 && bytes[start + 5] === 0;
}

function startsWithExifIdentifier(bytes: Uint8Array, start: number, end: number): boolean {
  return end - start >= 4 && bytes[start] === 0x45 && bytes[start + 1] === 0x78 &&
    bytes[start + 2] === 0x69 && bytes[start + 3] === 0x66;
}

function hasBmpSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d;
}

function hasPngSignature(bytes: Uint8Array): boolean {
  return bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG" && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10;
}

function readU16be(bytes: Uint8Array, offset: number): number { return (bytes[offset]! << 8) | bytes[offset + 1]!; }
function readU32be(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! * 0x1000000 + (bytes[offset + 1]! << 16) + (bytes[offset + 2]! << 8) + bytes[offset + 3]!;
}
function readU16le(bytes: Uint8Array, offset: number): number { return bytes[offset]! | (bytes[offset + 1]! << 8); }
function readU32le(bytes: Uint8Array, offset: number): number {
  return readU16le(bytes, offset) + readU16le(bytes, offset + 2) * 0x1_0000;
}
function pngCrc32(bytes: Uint8Array, offset: number, length: number): number {
  let crc = 0xffff_ffff;
  for (let index = offset; index < offset + length; index += 1) {
    crc ^= bytes[index]!;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
function makeResult(orientation: OwnerWanImageOrientation | null, width: number | null, height: number | null,
  confidence: OwnerWanImageCoordinateConfidence): OwnerWanImageCoordinateMetadata {
  return Object.freeze({ orientation, projected_width: width, projected_height: height, confidence });
}
