import { createHash } from "node:crypto";
import { types } from "node:util";
import { deflateSync, inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_INPUT_BYTES / 3) * 4;
const MAX_SIDE = 16_384;
const MAX_PIXELS = 16_000_000;
const MAX_CHUNKS = 4_096;
const MAX_OUTPUT_RASTER_BYTES = 64_016_384;
const APNG_CHUNKS = new Set(["acTL", "fcTL", "fdAT"]);
const CRC_TABLE = makeCrcTable();
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const TYPED_ARRAY_BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")!.get!;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;

export type OwnerIdeogramPaintedMaskVariant = Readonly<{
  readonly bytes: Buffer;
  readonly sha256: `sha256:${string}`;
  readonly width: number;
  readonly height: number;
  readonly mime_type: "image/png";
}>;

/** Local source-recipe output only; returned buffers are caller-owned and should be wiped when no longer needed. */
export type OwnerIdeogramPaintedMaskVariants = Readonly<{
  readonly source_interpretation: "PAINTED_CANVAS_ALPHA_GREATER_THAN_ZERO";
  readonly source_inverted_mask_false: OwnerIdeogramPaintedMaskVariant;
  readonly source_inverted_mask_true: OwnerIdeogramPaintedMaskVariant;
  readonly confidence_scope: "LOCAL_CANONICAL_MASK_BYTES_ONLY_NO_OWNERSHIP_OR_PROVIDER_PROOF";
  readonly browser_sampling_verified: false;
}>;

export class OwnerIdeogramPaintedMaskCodecError extends Error {
  constructor(readonly code: "INVALID_BASE64" | "INVALID_PNG" | "UNSUPPORTED_PNG" | "PNG_RESOURCE_LIMIT") {
    super("The painted mask PNG is invalid, unsupported, or exceeds local codec limits.");
    this.name = "OwnerIdeogramPaintedMaskCodecError";
  }
}

/**
 * Applies the pinned Ideogram painted-canvas mask recipe to an explicitly painted-alpha RGBA PNG.
 * This is local deterministic byte conversion, not an ownership grant or provider-acceptance proof.
 */
export function encodeOwnerIdeogramPaintedMaskVariants(paintedRgbaPngBase64: unknown): OwnerIdeogramPaintedMaskVariants {
  let input: Buffer | undefined;
  let compressed: Buffer | undefined;
  let inflated: Buffer | undefined;
  let pixels: Buffer | undefined;
  let sourceInvertedFalse: Buffer | undefined;
  let sourceInvertedTrue: Buffer | undefined;
  try {
    input = decodeStrictBase64(paintedRgbaPngBase64);
    const parsed = parseRgba8Png(input);
    compressed = Buffer.concat(parsed.idat, parsed.compressedBytes);
    inflated = inflatePng(compressed, parsed.expectedInflatedBytes);
    pixels = decodeRgbaPixels(inflated, parsed.width, parsed.height);
    sourceInvertedFalse = encodeVariant(pixels, parsed.width, parsed.height, false);
    sourceInvertedTrue = encodeVariant(pixels, parsed.width, parsed.height, true);

    const result: OwnerIdeogramPaintedMaskVariants = Object.freeze({
      source_interpretation: "PAINTED_CANVAS_ALPHA_GREATER_THAN_ZERO",
      source_inverted_mask_false: Object.freeze({
        bytes: sourceInvertedFalse,
        sha256: `sha256:${createHash("sha256").update(sourceInvertedFalse).digest("hex")}`,
        width: parsed.width,
        height: parsed.height,
        mime_type: "image/png"
      }),
      source_inverted_mask_true: Object.freeze({
        bytes: sourceInvertedTrue,
        sha256: `sha256:${createHash("sha256").update(sourceInvertedTrue).digest("hex")}`,
        width: parsed.width,
        height: parsed.height,
        mime_type: "image/png"
      }),
      confidence_scope: "LOCAL_CANONICAL_MASK_BYTES_ONLY_NO_OWNERSHIP_OR_PROVIDER_PROOF",
      browser_sampling_verified: false
    });
    sourceInvertedFalse = undefined;
    sourceInvertedTrue = undefined;
    return result;
  } catch (error) {
    if (error instanceof OwnerIdeogramPaintedMaskCodecError) throw error;
    return invalidPng();
  } finally {
    input?.fill(0);
    compressed?.fill(0);
    inflated?.fill(0);
    pixels?.fill(0);
    sourceInvertedFalse?.fill(0);
    sourceInvertedTrue?.fill(0);
  }
}

/** Internal transport guard for canonical output produced by this codec; returned bytes are caller-owned and must be wiped. */
export function validateOwnerIdeogramPaintedMaskVariantBytes(input: unknown): Readonly<{
  readonly bytes: Buffer;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: `sha256:${string}`;
}> {
  let bytes: Buffer | undefined;
  let compressed: Buffer | undefined;
  let inflated: Buffer | undefined;
  let pixels: Buffer | undefined;
  try {
    if (types.isProxy(input) || !Buffer.isBuffer(input) || Object.getPrototypeOf(input) !== Buffer.prototype ||
        Object.hasOwn(input, "buffer") || Object.hasOwn(input, "byteLength") || Object.hasOwn(input, "byteOffset") || Object.hasOwn(input, "length")) {
      invalidPng();
    }
    const backing = typedArrayBuffer(input);
    const byteOffset = typedArrayByteOffset(input);
    const byteLength = typedArrayByteLength(input);
    if (types.isProxy(backing) || Object.getPrototypeOf(backing) !== ArrayBuffer.prototype || Object.hasOwn(backing, "byteLength") ||
        byteOffset < 0 || byteLength < 1 || byteLength > MAX_INPUT_BYTES || byteOffset + byteLength > arrayBufferByteLength(backing)) {
      if (byteLength > MAX_INPUT_BYTES) resourceLimit();
      invalidPng();
    }
    bytes = Buffer.allocUnsafeSlow(byteLength);
    bytes.set(new Uint8Array(backing, byteOffset, byteLength));
    const parsed = parseRgba8Png(bytes);
    if (parsed.idat.length !== 1 || !hasCanonicalMaskChunkLayout(bytes, parsed.idat[0]!)) unsupportedPng();
    compressed = Buffer.concat(parsed.idat, parsed.compressedBytes);
    inflated = inflatePng(compressed, parsed.expectedInflatedBytes);
    const rowBytes = parsed.width * 4;
    for (let y = 0; y < parsed.height; y += 1) {
      if (inflated[y * (rowBytes + 1)] !== 0) unsupportedPng();
    }
    pixels = decodeRgbaPixels(inflated, parsed.width, parsed.height);
    for (let offset = 0; offset < pixels.byteLength; offset += 4) {
      const value = pixels[offset]!;
      if ((value !== 0 && value !== 255) || pixels[offset + 1] !== value || pixels[offset + 2] !== value || pixels[offset + 3] !== 255) {
        unsupportedPng();
      }
    }
    const result = Object.freeze({ bytes, size: bytes.byteLength, width: parsed.width, height: parsed.height,
      sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}` });
    bytes = undefined;
    return result;
  } catch (error) {
    if (error instanceof OwnerIdeogramPaintedMaskCodecError) throw error;
    return invalidPng();
  } finally {
    bytes?.fill(0);
    compressed?.fill(0);
    inflated?.fill(0);
    pixels?.fill(0);
  }
}

function hasCanonicalMaskChunkLayout(bytes: Buffer, idat: Buffer): boolean {
  let offset = PNG_SIGNATURE.byteLength;
  for (const expected of ["IHDR", "IDAT", "IEND"] as const) {
    if (offset + 12 > bytes.byteLength) return false;
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type !== expected || length > bytes.byteLength - offset - 12) return false;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (expected === "IDAT" && (dataEnd - dataStart !== idat.byteLength || !bytes.subarray(dataStart, dataEnd).equals(idat))) return false;
    offset = dataEnd + 4;
  }
  return offset === bytes.byteLength;
}

function decodeStrictBase64(value: unknown): Buffer {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_BASE64_CHARS || value.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) invalidBase64();
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength < 57 || decoded.byteLength > MAX_INPUT_BYTES || decoded.toString("base64") !== value) {
    decoded.fill(0);
    invalidBase64();
  }
  return decoded;
}

function parseRgba8Png(bytes: Buffer): ParsedRgbaPng {
  if (bytes.byteLength < 57 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) invalidPng();
  let offset = PNG_SIGNATURE.byteLength;
  let chunks = 0;
  let seenHeader = false;
  let seenImageData = false;
  let endedImageData = false;
  let seenEnd = false;
  let compressedBytes = 0;
  const idat: Buffer[] = [];
  let width = 0;
  let height = 0;

  while (offset < bytes.byteLength) {
    chunks += 1;
    if (chunks > MAX_CHUNKS || offset + 12 > bytes.byteLength) invalidPng();
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.byteLength - offset - 12) invalidPng();
    const typeOffset = offset + 4;
    for (let index = 0; index < 4; index += 1) {
      const code = bytes[typeOffset + index]!;
      if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122))) invalidPng();
    }
    const type = bytes.toString("ascii", typeOffset, typeOffset + 4);
    if (!/^[A-Za-z]{4}$/u.test(type) || type[2] !== type[2]!.toUpperCase()) invalidPng();
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (bytes.readUInt32BE(dataEnd) !== crc32(bytes, typeOffset, dataEnd)) invalidPng();
    if (seenEnd || (!seenHeader && type !== "IHDR")) invalidPng();
    if (APNG_CHUNKS.has(type) || type === "eXIf") unsupportedPng();

    if (type === "IHDR") {
      if (seenHeader || chunks !== 1 || length !== 13) invalidPng();
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      const bitDepth = bytes[dataStart + 8]!;
      const colorType = bytes[dataStart + 9]!;
      const compression = bytes[dataStart + 10]!;
      const filter = bytes[dataStart + 11]!;
      const interlace = bytes[dataStart + 12]!;
      if (!Number.isSafeInteger(width * height) || width < 1 || height < 1) resourceLimit();
      if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) resourceLimit();
      if (bitDepth !== 8 || colorType !== 6 || compression !== 0 || filter !== 0 || interlace !== 0) unsupportedPng();
      seenHeader = true;
    } else if (type === "PLTE" || type === "tRNS") {
      unsupportedPng();
    } else if (type === "IDAT") {
      if (endedImageData) invalidPng();
      seenImageData = true;
      compressedBytes += length;
      if (!Number.isSafeInteger(compressedBytes) || compressedBytes > MAX_INPUT_BYTES) resourceLimit();
      idat.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      if (length !== 0 || !seenImageData || chunkEnd !== bytes.byteLength) invalidPng();
      seenEnd = true;
    } else {
      if (seenImageData) endedImageData = true;
      if (type[0] === type[0]!.toUpperCase()) unsupportedPng();
      // Unknown ancillary chunks are CRC-checked and ignored; APNG/eXIf were rejected above.
    }
    if (type !== "IDAT" && type !== "IHDR" && type !== "IEND" && seenImageData) endedImageData = true;
    offset = chunkEnd;
  }

  if (!seenHeader || !seenImageData || !seenEnd || compressedBytes === 0) invalidPng();
  const rowBytes = width * 4;
  const expectedInflatedBytes = (rowBytes + 1) * height;
  if (!Number.isSafeInteger(expectedInflatedBytes) || expectedInflatedBytes > MAX_OUTPUT_RASTER_BYTES) resourceLimit();
  return { width, height, idat, compressedBytes, expectedInflatedBytes };
}

function inflatePng(compressed: Buffer, expectedBytes: number): Buffer {
  try {
    const result = inflateSync(compressed, { maxOutputLength: expectedBytes, info: true }) as unknown as {
      readonly buffer: Buffer;
      readonly engine: { readonly bytesWritten: number };
    };
    if (result.buffer.byteLength !== expectedBytes || result.engine.bytesWritten !== compressed.byteLength) {
      result.buffer.fill(0);
      invalidPng();
    }
    return result.buffer;
  } catch (error) {
    if (error instanceof OwnerIdeogramPaintedMaskCodecError) throw error;
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ERR_BUFFER_TOO_LARGE") resourceLimit();
    invalidPng();
  }
}

function decodeRgbaPixels(inflated: Buffer, width: number, height: number): Buffer {
  const rowBytes = width * 4;
  const pixels = Buffer.allocUnsafe(rowBytes * height);
  let sourceOffset = 0;
  let previous = Buffer.alloc(rowBytes);
  try {
    for (let y = 0; y < height; y += 1) {
      const filter = inflated[sourceOffset++]!;
      if (filter > 4 || sourceOffset + rowBytes > inflated.byteLength) invalidPng();
      const row = Buffer.from(inflated.subarray(sourceOffset, sourceOffset + rowBytes));
      sourceOffset += rowBytes;
      unfilterRgbaRow(row, previous, filter);
      row.copy(pixels, y * rowBytes);
      previous.fill(0);
      previous = row;
    }
    if (sourceOffset !== inflated.byteLength) invalidPng();
    return pixels;
  } catch (error) {
    pixels.fill(0);
    throw error;
  } finally {
    previous.fill(0);
  }
}

function unfilterRgbaRow(row: Buffer, previous: Buffer, filter: number): void {
  for (let index = 0; index < row.byteLength; index += 1) {
    const raw = row[index]!;
    const left = index >= 4 ? row[index - 4]! : 0;
    const up = previous[index]!;
    const upperLeft = index >= 4 ? previous[index - 4]! : 0;
    let predictor = 0;
    if (filter === 1) predictor = left;
    else if (filter === 2) predictor = up;
    else if (filter === 3) predictor = Math.floor((left + up) / 2);
    else if (filter === 4) predictor = paeth(left, up, upperLeft);
    row[index] = (raw + predictor) & 0xff;
  }
}

function encodeVariant(pixels: Buffer, width: number, height: number, inverted: boolean): Buffer {
  const rowBytes = width * 4;
  const scanlines = Buffer.allocUnsafe((rowBytes + 1) * height);
  const ihdr = Buffer.alloc(13);
  let compressed: Buffer | undefined;
  let idat: Buffer | undefined;
  let ihdrChunk: Buffer | undefined;
  let iendChunk: Buffer | undefined;
  try {
    for (let y = 0; y < height; y += 1) {
      const sourceStart = y * rowBytes;
      const targetStart = y * (rowBytes + 1);
      scanlines[targetStart] = 0;
      for (let x = 0; x < width; x += 1) {
        const paint = pixels[sourceStart + x * 4 + 3]! > 0;
        const value = paint !== inverted ? 0 : 255;
        const target = targetStart + 1 + x * 4;
        scanlines[target] = value;
        scanlines[target + 1] = value;
        scanlines[target + 2] = value;
        scanlines[target + 3] = 255;
      }
    }
    compressed = deflateSync(scanlines);
    if (compressed.byteLength > MAX_INPUT_BYTES) resourceLimit();
    idat = pngChunk("IDAT", compressed);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    ihdrChunk = pngChunk("IHDR", ihdr);
    iendChunk = pngChunk("IEND", Buffer.alloc(0));
    const output = Buffer.concat([PNG_SIGNATURE, ihdrChunk, idat, iendChunk]);
    if (output.byteLength > MAX_INPUT_BYTES) {
      output.fill(0);
      resourceLimit();
    }
    return output;
  } finally {
    scanlines.fill(0);
    ihdr.fill(0);
    compressed?.fill(0);
    idat?.fill(0);
    ihdrChunk?.fill(0);
    iendChunk?.fill(0);
  }
}

function pngChunk(type: "IHDR" | "IDAT" | "IEND", data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.allocUnsafe(data.byteLength + 12);
  chunk.writeUInt32BE(data.byteLength, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk, 4, 8 + data.byteLength), 8 + data.byteLength);
  return chunk;
}

function crc32(bytes: Buffer, start: number, end: number): number {
  let crc = 0xffff_ffff;
  for (let index = start; index < end; index += 1) crc = CRC_TABLE[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffff_ffff) >>> 0;
}

function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let value = 0; value < table.length; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb8_8320 : crc >>> 1;
    table[value] = crc >>> 0;
  }
  return table;
}

function typedArrayBuffer(value: Uint8Array): ArrayBuffer {
  return Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as ArrayBuffer;
}
function typedArrayByteOffset(value: Uint8Array): number {
  return Reflect.apply(TYPED_ARRAY_BYTE_OFFSET_GETTER, value, []) as number;
}
function typedArrayByteLength(value: Uint8Array): number {
  return Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []) as number;
}
function arrayBufferByteLength(value: ArrayBuffer): number {
  return Reflect.apply(Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!, value, []) as number;
}

function paeth(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function invalidBase64(): never { throw new OwnerIdeogramPaintedMaskCodecError("INVALID_BASE64"); }
function invalidPng(): never { throw new OwnerIdeogramPaintedMaskCodecError("INVALID_PNG"); }
function unsupportedPng(): never { throw new OwnerIdeogramPaintedMaskCodecError("UNSUPPORTED_PNG"); }
function resourceLimit(): never { throw new OwnerIdeogramPaintedMaskCodecError("PNG_RESOURCE_LIMIT"); }

interface ParsedRgbaPng {
  readonly width: number;
  readonly height: number;
  readonly idat: readonly Buffer[];
  readonly compressedBytes: number;
  readonly expectedInflatedBytes: number;
}
