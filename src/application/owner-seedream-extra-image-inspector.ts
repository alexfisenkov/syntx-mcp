import { types } from "node:util";

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_IFDS = 32;
const MAX_GIF_BLOCKS = 100_000;
const MAX_GIF_FRAMES = 256;

export type OwnerSeedreamExtraImageMime = "image/bmp" | "image/gif" | "image/tiff";
export class OwnerSeedreamExtraImageInspectorError extends Error {
  constructor(readonly code: "INVALID_IMAGE_CONTAINER" | "UNSUPPORTED_IMAGE_COMPOSITION") {
    super("The Seedream image container is invalid or uses an unsupported composition.");
    this.name = "OwnerSeedreamExtraImageInspectorError";
  }
}

/** Bounded structural metadata inspection for the extra Seedream formats; no pixel decode is performed. */
export function inspectOwnerSeedreamExtraImageBytes(bytes: Uint8Array, mime: OwnerSeedreamExtraImageMime): {
  readonly mime: OwnerSeedreamExtraImageMime;
  readonly width: number;
  readonly height: number;
  readonly validation_confidence: "BMP_HEADER_AND_PIXEL_EXTENT" | "GIF_BLOCK_FRAMING_BOUNDED_FRAMES" | "TIFF_IFD_AND_STRIP_EXTENTS_BOUNDED_PAGES";
} {
  try {
    if (types.isProxy(bytes) || (Object.getPrototypeOf(bytes) !== Uint8Array.prototype && Object.getPrototypeOf(bytes) !== Buffer.prototype) ||
        Object.hasOwn(bytes, "buffer") || Object.hasOwn(bytes, "byteLength") || Object.hasOwn(bytes, "byteOffset") || Object.hasOwn(bytes, "length") ||
        !safeBacking(bytes) || bytes.byteLength < 8) invalid();
    if (bytes.byteLength > MAX_BYTES) unsupported();
    const dimensions = mime === "image/bmp" ? inspectBmp(bytes) : mime === "image/gif" ? inspectGif(bytes) : inspectTiff(bytes);
    return Object.freeze({ mime, ...dimensions, validation_confidence: mime === "image/bmp"
      ? "BMP_HEADER_AND_PIXEL_EXTENT" as const
      : mime === "image/gif" ? "GIF_BLOCK_FRAMING_BOUNDED_FRAMES" as const : "TIFF_IFD_AND_STRIP_EXTENTS_BOUNDED_PAGES" as const });
  } catch (error) {
    if (error instanceof OwnerSeedreamExtraImageInspectorError) throw error;
    invalid();
  }
}

function inspectBmp(b: Uint8Array): { width: number; height: number } {
  if (ascii(b, 0, 2) !== "BM" || b.byteLength < 54) invalid();
  const fileSize = u32le(b, 2), pixelOffset = u32le(b, 10), dibSize = u32le(b, 14);
  if (fileSize !== b.byteLength || dibSize < 40 || dibSize > b.byteLength - 14 || pixelOffset < 14 + dibSize || pixelOffset > b.byteLength) invalid();
  const width = i32le(b, 18), signedHeight = i32le(b, 22), planes = u16le(b, 26), bits = u16le(b, 28), compression = u32le(b, 30);
  if (width < 1 || signedHeight === 0 || signedHeight === -0x80000000 || planes !== 1 || ![1, 4, 8, 16, 24, 32].includes(bits) ||
      (compression !== 0 && !(compression === 3 && [16, 32].includes(bits)))) unsupported();
  if (compression === 3 && ((dibSize === 40 && pixelOffset < 66) || (dibSize > 40 && dibSize < 52))) invalid();
  const height = Math.abs(signedHeight);
  const rowBytes = Math.floor((width * bits + 31) / 32) * 4;
  const imageBytes = rowBytes * height;
  if (!Number.isSafeInteger(imageBytes) || imageBytes > b.byteLength - pixelOffset) invalid();
  const declaredImageBytes = u32le(b, 34);
  if (declaredImageBytes !== 0 && declaredImageBytes !== imageBytes) invalid();
  if (width > 0x7fffffff || height > 0x7fffffff) invalid();
  return { width, height };
}

function inspectGif(b: Uint8Array): { width: number; height: number } {
  if ((ascii(b, 0, 6) !== "GIF87a" && ascii(b, 0, 6) !== "GIF89a") || b.byteLength < 14) invalid();
  const width = u16le(b, 6), height = u16le(b, 8);
  if (!width || !height) invalid();
  let offset = 13;
  const packed = b[10]!;
  const hasGlobalTable = Boolean(packed & 0x80);
  if (hasGlobalTable) offset += 3 * 2 ** ((packed & 7) + 1);
  if (offset > b.byteLength) invalid();
  let frames = 0, blocks = 0, ended = false;
  while (offset < b.byteLength) {
    if (++blocks > MAX_GIF_BLOCKS) unsupported();
    const marker = b[offset++]!;
    if (marker === 0x3b) { ended = true; break; }
    if (marker === 0x21) {
      if (offset >= b.byteLength) invalid();
      const label = b[offset++]!;
      if (label === 0xf9) {
        if (offset >= b.byteLength || b[offset++] !== 4 || offset + 5 > b.byteLength) invalid();
        offset += 4;
        if (b[offset++] !== 0) invalid();
      } else if (label === 0xff || label === 0x01) {
        const expected = label === 0xff ? 11 : 12;
        if (offset >= b.byteLength) invalid();
        const length = b[offset++]!;
        if (length !== expected || length > b.byteLength - offset) invalid();
        offset += length;
        offset = skipSubBlocks(b, offset);
      } else {
        offset = skipSubBlocks(b, offset);
      }
      continue;
    }
    if (marker !== 0x2c || offset + 9 > b.byteLength) invalid();
    frames += 1;
    if (frames > MAX_GIF_FRAMES) unsupported();
    const left = u16le(b, offset), top = u16le(b, offset + 2), frameWidth = u16le(b, offset + 4), frameHeight = u16le(b, offset + 6);
    if (!frameWidth || !frameHeight || left + frameWidth > width || top + frameHeight > height) invalid();
    const imagePacked = b[offset + 8]!;
    offset += 9;
    const hasLocalTable = Boolean(imagePacked & 0x80);
    if (hasLocalTable) offset += 3 * 2 ** ((imagePacked & 7) + 1);
    if (!hasLocalTable && !hasGlobalTable) unsupported();
    if (offset >= b.byteLength) invalid();
    const lzwMinimumCodeSize = b[offset++]!;
    if (lzwMinimumCodeSize < 2 || lzwMinimumCodeSize > 8) invalid();
    offset = skipSubBlocks(b, offset);
  }
  if (!ended || frames < 1 || offset !== b.byteLength) invalid();
  return { width, height };
}

function skipSubBlocks(b: Uint8Array, start: number): number {
  let offset = start, count = 0;
  while (offset < b.byteLength && count++ < MAX_GIF_BLOCKS) {
    const length = b[offset++]!;
    if (length === 0) return offset;
    if (length > b.byteLength - offset) invalid();
    offset += length;
  }
  return invalid();
}

function inspectTiff(b: Uint8Array): { width: number; height: number } {
  const little = ascii(b, 0, 2) === "II";
  if ((!little && ascii(b, 0, 2) !== "MM") || read16(b, 2, little) !== 42) invalid();
  const first = read32(b, 4, little);
  if (first < 8 || first + 2 > b.byteLength) invalid();
  const seen = new Set<number>();
  let offset = first, pages = 0, width = 0, height = 0;
  while (offset !== 0) {
    if (++pages > MAX_IFDS) unsupported();
    if (offset < 8 || seen.has(offset) || offset + 2 > b.byteLength) invalid();
    seen.add(offset);
    const count = read16(b, offset, little);
    if (count > 4096 || offset + 2 + count * 12 + 4 > b.byteLength) invalid();
    const entries = new Map<number, { type: number; count: number; value: number; valueOffset: number }>();
    for (let i = 0; i < count; i += 1) {
      const at = offset + 2 + i * 12, tag = read16(b, at, little), type = read16(b, at + 2, little), n = read32(b, at + 4, little);
      const value = read32(b, at + 8, little);
      if (!([1, 3, 4].includes(type)) || n < 1 || entries.has(tag)) invalid();
      entries.set(tag, { type, count: n, value, valueOffset: at + 8 });
      if (n * typeSize(type) > 4) {
        const length = n * typeSize(type);
        if (!Number.isSafeInteger(length) || value > b.byteLength || length > b.byteLength - value) invalid();
      }
    }
    const pageWidth = scalar(b, entries.get(256), little), pageHeight = scalar(b, entries.get(257), little);
    const compression = scalar(b, entries.get(259), little);
    if (!pageWidth || !pageHeight) invalid();
    if (compression !== 1 && compression !== 5 && compression !== 7 && compression !== 8 && compression !== 32946) unsupported();
    if (entries.has(324) || entries.has(325)) unsupported();
    const offsets = entries.get(273), counts = entries.get(279);
    const stripOffsets = values(b, offsets, little), stripCounts = values(b, counts, little);
    if (!stripOffsets.length || stripOffsets.length !== stripCounts.length) invalid();
    for (let i = 0; i < stripOffsets.length; i += 1) {
      if (stripOffsets[i]! > b.byteLength || stripCounts[i]! < 1 || stripCounts[i]! > b.byteLength - stripOffsets[i]!) invalid();
    }
    if (pages === 1) { width = pageWidth; height = pageHeight; }
    offset = read32(b, offset + 2 + count * 12, little);
  }
  if (pages < 1) invalid();
  if (!width || !height) invalid();
  return { width, height };
}

function values(b: Uint8Array, entry: { type: number; count: number; value: number; valueOffset: number } | undefined, little: boolean): number[] {
  if (!entry) invalid();
  if (entry.count > 4096) unsupported();
  const size = typeSize(entry.type);
  const at = entry.count * size <= 4 ? entry.valueOffset : entry.value;
  return Array.from({ length: entry.count }, (_, i) => {
    const position = at + i * size;
    if (size === 1) return b[position]!;
    return size === 2 ? read16(b, position, little) : read32(b, position, little);
  });
}
function scalar(b: Uint8Array, entry: { type: number; count: number; value: number; valueOffset: number } | undefined, little: boolean): number {
  if (!entry || entry.count !== 1) invalid();
  if (entry.type === 1) return b[entry.valueOffset]!;
  if (entry.type === 3) return read16(b, entry.valueOffset, little);
  if (typeSize(entry.type) === 2) return little ? entry.value & 0xffff : entry.value >>> 16;
  return entry.value;
}
function typeSize(type: number): number { return type === 1 ? 1 : type === 3 ? 2 : 4; }
function read16(b: Uint8Array, at: number, le: boolean): number { return le ? b[at]! | b[at + 1]! << 8 : b[at]! << 8 | b[at + 1]!; }
function read32(b: Uint8Array, at: number, le: boolean): number { return le ? (b[at]! | b[at + 1]! << 8 | b[at + 2]! << 16 | b[at + 3]! << 24) >>> 0 : b[at]! * 0x1000000 + (b[at + 1]! << 16) + (b[at + 2]! << 8) + b[at + 3]!; }
function u16le(b: Uint8Array, at: number): number { return b[at]! | b[at + 1]! << 8; }
function u32le(b: Uint8Array, at: number): number { return (b[at]! | b[at + 1]! << 8 | b[at + 2]! << 16 | b[at + 3]! << 24) >>> 0; }
function i32le(b: Uint8Array, at: number): number { return b[at]! | b[at + 1]! << 8 | b[at + 2]! << 16 | b[at + 3]! << 24; }
function ascii(b: Uint8Array, at: number, count: number): string { return String.fromCharCode(...b.subarray(at, at + count)); }
function safeBacking(bytes: Uint8Array): boolean {
  const proto = Object.getPrototypeOf(Uint8Array.prototype) as object;
  const getter = Object.getOwnPropertyDescriptor(proto, "buffer")!.get!;
  const backing = Reflect.apply(getter, bytes, []) as ArrayBuffer;
  return !types.isProxy(backing) && Object.getPrototypeOf(backing) === ArrayBuffer.prototype && !Object.hasOwn(backing, "byteLength");
}
function invalid(): never { throw new OwnerSeedreamExtraImageInspectorError("INVALID_IMAGE_CONTAINER"); }
function unsupported(): never { throw new OwnerSeedreamExtraImageInspectorError("UNSUPPORTED_IMAGE_COMPOSITION"); }
