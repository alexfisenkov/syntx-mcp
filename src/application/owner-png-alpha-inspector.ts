import { createHash } from "node:crypto";
import { types } from "node:util";
import { inflateSync } from "node:zlib";

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const MAX_INPUT_BYTES = 32 * 1024 * 1024;
const MAX_SIDE = 6_000;
const MAX_PIXELS = 36_000_000;
const MAX_CHUNKS = 4_096;
const MAX_INFLATED_BYTES = 300 * 1024 * 1024;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const CRC_TABLE = makeCrcTable();

export type OwnerPngAlphaSummary = Readonly<{
  readonly width: number;
  readonly height: number;
  readonly sha256: `sha256:${string}`;
  readonly has_transparent_pixels: boolean;
  readonly validation_confidence: "PNG_DECODED_PIXEL_ALPHA";
  readonly browser_sampling_verified: false;
}>;

/** Internal safe projection consumed by the nominal Seedream witness issuer. */
export type OwnerPngSourceCanvasAlphaProjection = Readonly<{
  readonly width: number;
  readonly height: number;
  readonly sha256: `sha256:${string}`;
  readonly source_sample_width: number;
  readonly source_sample_height: number;
  readonly source_alpha_eligible: boolean;
  readonly confidence_scope: "SOURCE_CANVAS_ALPHA8_NEAREST_SAMPLED";
}>;

export class OwnerPngAlphaInspectionError extends Error {
  constructor(readonly code: "INVALID_PNG_CONTAINER" | "UNSUPPORTED_PNG_COMPOSITION" | "PNG_RESOURCE_LIMIT") {
    super("The PNG image is invalid, unsupported, or exceeds local inspection limits.");
    this.name = "OwnerPngAlphaInspectionError";
  }
}

/** Fully decodes PNG sample alpha within explicit local byte, dimension, and inflate bounds. */
export function inspectOwnerPngAlpha(bytes: Uint8Array): OwnerPngAlphaSummary {
  try {
    const ownedInput = copyTrustedBytes(bytes);
    const parsed = parsePng(ownedInput);
    const inflated = inflatePng(parsed);
    const hasTransparent = decodeAlpha(parsed, inflated);
    return Object.freeze({
      width: parsed.width,
      height: parsed.height,
      sha256: `sha256:${createHash("sha256").update(ownedInput).digest("hex")}`,
      has_transparent_pixels: hasTransparent,
      validation_confidence: "PNG_DECODED_PIXEL_ALPHA",
      browser_sampling_verified: false
    });
  } catch (error) {
    if (error instanceof OwnerPngAlphaInspectionError) throw error;
    return invalid();
  }
}

/** Decodes a bounded PNG and evaluates only the nearest-neighbour Canvas source samples. */
export function inspectOwnerPngSourceCanvasAlpha(bytes: Uint8Array): OwnerPngSourceCanvasAlphaProjection {
  try {
    const ownedInput = copyTrustedBytes(bytes);
    const parsed = parsePng(ownedInput);
    const inflated = inflatePng(parsed);
    const sampleWidth = Math.max(1, Math.round(parsed.width * Math.min(1, 1_024 / Math.max(parsed.width, parsed.height))));
    const sampleHeight = Math.max(1, Math.round(parsed.height * Math.min(1, 1_024 / Math.max(parsed.width, parsed.height))));
    const transparent = hasSampledCanvasTransparency(parsed, inflated, sampleWidth, sampleHeight);
    return Object.freeze({
      width: parsed.width,
      height: parsed.height,
      sha256: `sha256:${createHash("sha256").update(ownedInput).digest("hex")}`,
      source_sample_width: sampleWidth,
      source_sample_height: sampleHeight,
      source_alpha_eligible: transparent,
      confidence_scope: "SOURCE_CANVAS_ALPHA8_NEAREST_SAMPLED"
    });
  } catch (error) {
    if (error instanceof OwnerPngAlphaInspectionError) throw error;
    return invalid();
  }
}

function copyTrustedBytes(bytes: Uint8Array): Buffer {
  if (!bytes || typeof bytes !== "object" || types.isProxy(bytes)) invalid();
  const prototype = Object.getPrototypeOf(bytes);
  if (prototype !== Uint8Array.prototype && prototype !== Buffer.prototype) invalid();
  if (Object.hasOwn(bytes, "buffer") || Object.hasOwn(bytes, "byteLength") ||
      Object.hasOwn(bytes, "byteOffset") || Object.hasOwn(bytes, "length")) invalid();
  const backing = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, bytes, []) as ArrayBuffer;
  if (types.isProxy(backing) || Object.getPrototypeOf(backing) !== ArrayBuffer.prototype ||
      Object.hasOwn(backing, "byteLength")) invalid();
  const length = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, bytes, []) as number;
  if (!Number.isSafeInteger(length) || length < SIGNATURE.length + 25 || length > MAX_INPUT_BYTES) resourceLimit();
  return Buffer.from(bytes);
}

function parsePng(bytes: Buffer): ParsedPng {
  for (let index = 0; index < SIGNATURE.length; index += 1) if (bytes[index] !== SIGNATURE[index]) invalid();
  let offset: number = SIGNATURE.length;
  let chunks = 0;
  let seenHeader = false;
  let seenPalette = false;
  let seenTransparency = false;
  let seenImageData = false;
  let endedImageData = false;
  let seenEnd = false;
  let palette: Buffer | undefined;
  let transparency: Buffer | undefined;
  let header: Header | undefined;
  const idat: Buffer[] = [];
  let compressedBytes = 0;

  while (offset < bytes.length) {
    chunks += 1;
    if (chunks > MAX_CHUNKS || offset + 12 > bytes.length) invalid();
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) invalid();
    const typeOffset = offset + 4;
    const type = bytes.toString("ascii", typeOffset, typeOffset + 4);
    if (!/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2]!.toUpperCase()) invalid();
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (bytes.readUInt32BE(dataEnd) !== crc32(bytes, typeOffset, dataEnd)) invalid();
    if (seenEnd) invalid();
    if (!seenHeader && type !== "IHDR") invalid();
    if (type === "acTL" || type === "fcTL" || type === "fdAT" || type === "eXIf") unsupported();
    if (seenImageData && type !== "IDAT") endedImageData = true;
    if (type === "IDAT" && endedImageData) invalid();

    if (type === "IHDR") {
      if (seenHeader || chunks !== 1 || length !== 13) invalid();
      header = parseHeader(bytes, dataStart);
      seenHeader = true;
    } else if (type === "PLTE") {
      if (!header || seenPalette || seenImageData || length === 0 || length > 768 || length % 3 !== 0) invalid();
      if (header.colorType === 0 || header.colorType === 4) invalid();
      if (header.colorType === 3 && length / 3 > 2 ** header.bitDepth) invalid();
      palette = Buffer.from(bytes.subarray(dataStart, dataEnd));
      seenPalette = true;
    } else if (type === "tRNS") {
      if (!header || seenTransparency || seenImageData) invalid();
      transparency = Buffer.from(bytes.subarray(dataStart, dataEnd));
      validateTransparency(header, palette, transparency);
      seenTransparency = true;
    } else if (type === "IDAT") {
      if (!header || (header.colorType === 3 && !seenPalette)) invalid();
      seenImageData = true;
      compressedBytes += length;
      if (!Number.isSafeInteger(compressedBytes) || compressedBytes > MAX_INPUT_BYTES) resourceLimit();
      idat.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      if (!header || !seenImageData || length !== 0) invalid();
      seenEnd = true;
      if (chunkEnd !== bytes.length) invalid();
    } else {
      if (!header) invalid();
      const critical = type[0] === type[0]!.toUpperCase();
      if (critical) unsupported();
      if (type === "tRNS" || type === "PLTE" || type === "IHDR" || type === "IDAT") invalid();
    }
    offset = chunkEnd;
  }
  if (!seenHeader || !header || !seenImageData || !seenEnd || compressedBytes === 0) invalid();
  if (header.colorType === 3 && !palette) invalid();
  const expectedInflatedBytes = computeInflatedSize(header);
  if (expectedInflatedBytes > MAX_INFLATED_BYTES) resourceLimit();
  return { ...header, palette, transparency, idat, expectedInflatedBytes };
}

function parseHeader(bytes: Buffer, offset: number): Header {
  const width = bytes.readUInt32BE(offset);
  const height = bytes.readUInt32BE(offset + 4);
  const bitDepth = bytes[offset + 8]!;
  const colorType = bytes[offset + 9]!;
  const compression = bytes[offset + 10]!;
  const filter = bytes[offset + 11]!;
  const interlace = bytes[offset + 12]!;
  if (width < 1 || height < 1 || !Number.isSafeInteger(width * height)) resourceLimit();
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) resourceLimit();
  const allowedDepths: Readonly<Record<number, readonly number[]>> = {
    0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16]
  };
  if (!allowedDepths[colorType]?.includes(bitDepth) || compression !== 0 || filter !== 0 || (interlace !== 0 && interlace !== 1)) unsupported();
  return { width, height, bitDepth, colorType, interlace };
}

function validateTransparency(header: Header, palette: Buffer | undefined, data: Buffer): void {
  const maxSample = header.bitDepth === 16 ? 65_535 : (1 << header.bitDepth) - 1;
  if (header.colorType === 0) {
    if (data.length !== 2 || data.readUInt16BE(0) > maxSample) invalid();
  } else if (header.colorType === 2) {
    if (data.length !== 6 || data.readUInt16BE(0) > maxSample || data.readUInt16BE(2) > maxSample || data.readUInt16BE(4) > maxSample) invalid();
  } else if (header.colorType === 3) {
    if (!palette || data.length < 1 || data.length > palette.length / 3) invalid();
  } else invalid();
}

function computeInflatedSize(header: Header): number {
  let total = 0;
  for (const pass of passes(header)) {
    if (pass.width === 0 || pass.height === 0) continue;
    const bitsPerPixel = channelsFor(header.colorType) * header.bitDepth;
    const rowBytes = Math.ceil(pass.width * bitsPerPixel / 8);
    total += (rowBytes + 1) * pass.height;
    if (!Number.isSafeInteger(total) || total > MAX_INFLATED_BYTES) resourceLimit();
  }
  return total;
}

function inflatePng(png: ParsedPng): Buffer {
  try {
    const compressed = Buffer.concat(png.idat);
    const result = inflateSync(compressed, {
      maxOutputLength: png.expectedInflatedBytes,
      info: true
    }) as unknown as { readonly buffer: Buffer; readonly engine: { readonly bytesWritten: number } };
    if (result.buffer.length !== png.expectedInflatedBytes || result.engine.bytesWritten !== compressed.length) invalid();
    return result.buffer;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ERR_BUFFER_TOO_LARGE") resourceLimit();
    return invalid();
  }
}

function decodeAlpha(png: ParsedPng, data: Buffer): boolean {
  const sampleMax = png.bitDepth === 16 ? 65_535 : (1 << png.bitDepth) - 1;
  const bytesPerPixel = Math.max(1, Math.ceil(channelsFor(png.colorType) * png.bitDepth / 8));
  let offset = 0;
  let hasTransparent = false;
  for (const pass of passes(png)) {
    if (pass.width === 0 || pass.height === 0) continue;
    const bitsPerPixel = channelsFor(png.colorType) * png.bitDepth;
    const rowBytes = Math.ceil(pass.width * bitsPerPixel / 8);
    let previous = Buffer.alloc(rowBytes);
    for (let y = 0; y < pass.height; y += 1) {
      const filter = data[offset++]!;
      if (filter > 4 || offset + rowBytes > data.length) invalid();
      const row = Buffer.from(data.subarray(offset, offset + rowBytes));
      offset += rowBytes;
      unfilter(row, previous, bytesPerPixel, filter);
      for (let x = 0; x < pass.width; x += 1) {
        if (pixelIsTransparent(row, x, png, sampleMax)) hasTransparent = true;
      }
      previous = row;
    }
  }
  if (offset !== data.length) invalid();
  return hasTransparent;
}

function hasSampledCanvasTransparency(png: ParsedPng, data: Buffer, sampleWidth: number, sampleHeight: number): boolean {
  const sampledX = nearestSourceCoordinates(png.width, sampleWidth);
  const sampledY = nearestSourceCoordinates(png.height, sampleHeight);
  const xIndices = new Map(sampledX.map((x, index) => [x, index]));
  const yIndices = new Map(sampledY.map((y, index) => [y, index]));
  const bytesPerPixel = Math.max(1, Math.ceil(channelsFor(png.colorType) * png.bitDepth / 8));
  let offset = 0;
  let hasTransparency = false;
  for (const pass of passes(png)) {
    if (pass.width === 0 || pass.height === 0) continue;
    const rowBytes = Math.ceil(pass.width * channelsFor(png.colorType) * png.bitDepth / 8);
    let previous = Buffer.alloc(rowBytes);
    for (let y = 0; y < pass.height; y += 1) {
      const filter = data[offset++]!;
      if (filter > 4 || offset + rowBytes > data.length) invalid();
      const row = Buffer.from(data.subarray(offset, offset + rowBytes));
      offset += rowBytes;
      unfilter(row, previous, bytesPerPixel, filter);
      const absoluteY = pass.yStart + y * pass.yStep;
      if (yIndices.has(absoluteY)) {
        for (let x = 0; x < pass.width; x += 1) {
          const absoluteX = pass.xStart + x * pass.xStep;
          if (!xIndices.has(absoluteX)) continue;
          if (pixelAlphaByte(row, x, png) < 255) hasTransparency = true;
        }
      }
      previous = row;
    }
  }
  if (offset !== data.length) invalid();
  return hasTransparency;
}

function nearestSourceCoordinates(sourceLength: number, sampleLength: number): number[] {
  return Array.from({ length: sampleLength }, (_, index) => Math.min(sourceLength - 1,
    Math.floor(((index + 0.5) * sourceLength) / sampleLength)));
}

function pixelIsTransparent(row: Buffer, x: number, png: ParsedPng, sampleMax: number): boolean {
  const channels = channelsFor(png.colorType);
  if (png.colorType === 4) return readSample(row, x, channels, 1, png.bitDepth) < sampleMax;
  if (png.colorType === 6) return readSample(row, x, channels, 3, png.bitDepth) < sampleMax;
  if (png.colorType === 3) {
    const index = readSample(row, x, 1, 0, png.bitDepth);
    if (!png.palette || index >= png.palette.length / 3) invalid();
    return (png.transparency?.[index] ?? 255) < 255;
  }
  if (png.transparency) {
    const grayOrRed = png.transparency.readUInt16BE(0);
    if (png.colorType === 0) return readSample(row, x, 1, 0, png.bitDepth) === grayOrRed;
    if (readSample(row, x, channels, 0, png.bitDepth) === grayOrRed &&
        readSample(row, x, channels, 1, png.bitDepth) === png.transparency.readUInt16BE(2) &&
        readSample(row, x, channels, 2, png.bitDepth) === png.transparency.readUInt16BE(4)) return true;
  }
  return false;
}

function pixelAlphaByte(row: Buffer, x: number, png: ParsedPng): number {
  const channels = channelsFor(png.colorType);
  if (png.colorType === 4) return toCanvasAlpha8(readSample(row, x, channels, 1, png.bitDepth), png.bitDepth === 16 ? 65_535 : 255);
  if (png.colorType === 6) return toCanvasAlpha8(readSample(row, x, channels, 3, png.bitDepth), png.bitDepth === 16 ? 65_535 : 255);
  if (png.colorType === 3) {
    const index = readSample(row, x, 1, 0, png.bitDepth);
    if (!png.palette || index >= png.palette.length / 3) invalid();
    return png.transparency?.[index] ?? 255;
  }
  if (png.transparency) {
    const transparent = png.colorType === 0
      ? readSample(row, x, 1, 0, png.bitDepth) === png.transparency.readUInt16BE(0)
      : readSample(row, x, channels, 0, png.bitDepth) === png.transparency.readUInt16BE(0) &&
        readSample(row, x, channels, 1, png.bitDepth) === png.transparency.readUInt16BE(2) &&
        readSample(row, x, channels, 2, png.bitDepth) === png.transparency.readUInt16BE(4);
    if (transparent) return 0;
  }
  return 255;
}

function toCanvasAlpha8(alpha: number, maximum: number): number {
  return maximum === 255 ? alpha : Math.floor((alpha * 255 + Math.floor(maximum / 2)) / maximum);
}

function readSample(row: Buffer, x: number, channels: number, channel: number, bitDepth: number): number {
  const index = x * channels + channel;
  if (bitDepth === 16) return row.readUInt16BE(index * 2);
  if (bitDepth === 8) return row[index]!;
  const bitOffset = index * bitDepth;
  const shift = 8 - bitDepth - (bitOffset % 8);
  return (row[Math.floor(bitOffset / 8)]! >> shift) & ((1 << bitDepth) - 1);
}

function unfilter(row: Buffer, previous: Buffer, bytesPerPixel: number, filter: number): void {
  for (let index = 0; index < row.length; index += 1) {
    const raw = row[index]!;
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel]! : 0;
    const up = previous[index]!;
    const upperLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel]! : 0;
    let predictor = 0;
    if (filter === 1) predictor = left;
    else if (filter === 2) predictor = up;
    else if (filter === 3) predictor = Math.floor((left + up) / 2);
    else if (filter === 4) predictor = paeth(left, up, upperLeft);
    row[index] = (raw + predictor) & 0xff;
  }
}

function paeth(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function passes(header: Header): Pass[] {
  if (header.interlace === 0) return [{ xStart: 0, yStart: 0, xStep: 1, yStep: 1, width: header.width, height: header.height }];
  const starts = [[0, 0], [4, 0], [0, 4], [2, 0], [0, 2], [1, 0], [0, 1]] as const;
  const steps = [[8, 8], [8, 8], [4, 8], [4, 4], [2, 4], [2, 2], [1, 2]] as const;
  return starts.map(([xStart, yStart], index) => {
    const [xStep, yStep] = steps[index]!;
    return {
      xStart, yStart, xStep, yStep,
      width: passLength(header.width, xStart, xStep),
      height: passLength(header.height, yStart, yStep)
    };
  });
}

function passLength(size: number, start: number, step: number): number {
  return size <= start ? 0 : Math.ceil((size - start) / step);
}

function channelsFor(colorType: number): number {
  if (colorType === 0 || colorType === 3) return 1;
  if (colorType === 2) return 3;
  if (colorType === 4) return 2;
  return 4;
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
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb8_8320 : crc >>> 1;
    table[value] = crc >>> 0;
  }
  return table;
}

function invalid(): never { throw new OwnerPngAlphaInspectionError("INVALID_PNG_CONTAINER"); }
function unsupported(): never { throw new OwnerPngAlphaInspectionError("UNSUPPORTED_PNG_COMPOSITION"); }
function resourceLimit(): never { throw new OwnerPngAlphaInspectionError("PNG_RESOURCE_LIMIT"); }

interface Header { readonly width: number; readonly height: number; readonly bitDepth: number; readonly colorType: number; readonly interlace: number; }
interface Pass { readonly xStart: number; readonly yStart: number; readonly xStep: number; readonly yStep: number; readonly width: number; readonly height: number; }
interface ParsedPng extends Header {
  readonly palette: Buffer | undefined;
  readonly transparency: Buffer | undefined;
  readonly idat: readonly Buffer[];
  readonly expectedInflatedBytes: number;
}
