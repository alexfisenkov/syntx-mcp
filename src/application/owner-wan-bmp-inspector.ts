export class OwnerWanBmpInspectionError extends Error {
  constructor(readonly code: "INVALID_BMP_STRUCTURE" | "UNSUPPORTED_BMP_COMPOSITION") {
    super("The BMP container is malformed or uses an unsupported composition.");
    this.name = "OwnerWanBmpInspectionError";
  }
}

const FILE_HEADER_BYTES = 14;
const MAX_BMP_BYTES = 20_971_520;
const BI_RGB = 0;
const BI_RLE8 = 1;
const BI_RLE4 = 2;
const BI_BITFIELDS = 3;
const PROFILE_LINKED = 0x4c49_4e4b;
const PROFILE_EMBEDDED = 0x4d42_4544;

/**
 * Bounded structural inspection for common Windows BMP layouts. Pixel values,
 * browser decoding, color transforms, and provider acceptance are not checked.
 */
export function inspectBoundedOwnerWanBmp(bytes: Uint8Array): { readonly width: number; readonly height: number } {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength < 26 || bytes.byteLength > MAX_BMP_BYTES ||
      bytes[0] !== 0x42 || bytes[1] !== 0x4d) invalid();
  const fileSize = readU32le(bytes, 2);
  const pixelOffset = readU32le(bytes, 10);
  if (fileSize !== bytes.byteLength || readU16le(bytes, 6) !== 0 || readU16le(bytes, 8) !== 0 || pixelOffset > fileSize) invalid();

  const headerSize = readU32le(bytes, FILE_HEADER_BYTES);
  if (headerSize === 12) return inspectCoreHeader(bytes, fileSize, pixelOffset);
  if (headerSize === 40 || headerSize === 108 || headerSize === 124) {
    return inspectInfoHeader(bytes, fileSize, pixelOffset, headerSize);
  }
  return unsupported();
}

function inspectCoreHeader(bytes: Uint8Array, fileSize: number, pixelOffset: number) {
  if (bytes.byteLength < FILE_HEADER_BYTES + 12) invalid();
  const width = readU16le(bytes, 18);
  const height = readU16le(bytes, 20);
  const planes = readU16le(bytes, 22);
  const bitDepth = readU16le(bytes, 24);
  if (width < 1 || height < 1 || planes !== 1) invalid();
  if (![1, 4, 8, 24].includes(bitDepth)) unsupported();

  const paletteEntries = bitDepth <= 8 ? 2 ** bitDepth : 0;
  const paletteStart = FILE_HEADER_BYTES + 12;
  const paletteEnd = paletteStart + paletteEntries * 3;
  if (!Number.isSafeInteger(paletteEnd) || pixelOffset < paletteEnd || pixelOffset > fileSize) invalid();
  const pixelBytes = uncompressedPixelBytes(width, height, bitDepth);
  const pixelEnd = pixelOffset + pixelBytes;
  if (!Number.isSafeInteger(pixelEnd) || pixelEnd > fileSize) invalid();
  return Object.freeze({ width, height });
}

function inspectInfoHeader(bytes: Uint8Array, fileSize: number, pixelOffset: number, headerSize: number) {
  const headerEnd = FILE_HEADER_BYTES + headerSize;
  if (bytes.byteLength < headerEnd) invalid();
  const width = readI32le(bytes, 18);
  const signedHeight = readI32le(bytes, 22);
  const planes = readU16le(bytes, 26);
  const bitDepth = readU16le(bytes, 28);
  const compression = readU32le(bytes, 30);
  const imageSize = readU32le(bytes, 34);
  const colorsUsed = readU32le(bytes, 46);
  if (width < 1 || signedHeight === 0 || signedHeight === -0x8000_0000 || planes !== 1) invalid();
  if (![1, 4, 8, 16, 24, 32].includes(bitDepth)) unsupported();
  const height = Math.abs(signedHeight);
  const isRle = compression === BI_RLE4 || compression === BI_RLE8;
  if (signedHeight < 0 && isRle) unsupported();

  let masksEnd = headerEnd;
  if (compression === BI_BITFIELDS) {
    if (bitDepth !== 16 && bitDepth !== 32) unsupported();
    const masks = headerSize === 40
      ? readMasksAfterInfoHeader(bytes, headerEnd, fileSize)
      : readMasksFromExtendedHeader(bytes, FILE_HEADER_BYTES);
    validateMasks(masks, bitDepth);
    if (headerSize === 40) masksEnd += 12;
  } else if (compression !== BI_RGB && compression !== BI_RLE4 && compression !== BI_RLE8) {
    unsupported();
  }
  if ((compression === BI_RLE4 && bitDepth !== 4) || (compression === BI_RLE8 && bitDepth !== 8)) unsupported();

  const paletteEntries = getPaletteEntries(bitDepth, colorsUsed);
  const paletteEntryBytes = 4;
  const paletteEnd = masksEnd + paletteEntries * paletteEntryBytes;
  if (!Number.isSafeInteger(paletteEnd) || pixelOffset < paletteEnd || pixelOffset > fileSize) invalid();

  const pixelEnd = isRle
    ? inspectRle(bytes, pixelOffset, fileSize, width, height, bitDepth as 4 | 8, paletteEntries, imageSize)
    : inspectUncompressedArray(fileSize, pixelOffset, width, height, bitDepth, imageSize);

  if (headerSize === 124) validateV5Profile(bytes, fileSize, pixelEnd, paletteEnd);
  return Object.freeze({ width, height });
}

function getPaletteEntries(bitDepth: number, colorsUsed: number): number {
  const maximum = bitDepth <= 8 ? 2 ** bitDepth : Number.MAX_SAFE_INTEGER;
  if (bitDepth <= 8) {
    const count = colorsUsed === 0 ? maximum : colorsUsed;
    if (count < 1 || count > maximum) invalid();
    return count;
  }
  return colorsUsed;
}

function readMasksAfterInfoHeader(bytes: Uint8Array, offset: number, fileSize: number): readonly number[] {
  if (offset + 12 > fileSize || bytes.byteLength < offset + 12) invalid();
  return Object.freeze([readU32le(bytes, offset), readU32le(bytes, offset + 4), readU32le(bytes, offset + 8)]);
}

function readMasksFromExtendedHeader(bytes: Uint8Array, headerStart: number): readonly number[] {
  return Object.freeze([
    readU32le(bytes, headerStart + 40), readU32le(bytes, headerStart + 44),
    readU32le(bytes, headerStart + 48), readU32le(bytes, headerStart + 52)
  ]);
}

function validateMasks(masks: readonly number[], bitDepth: number): void {
  const [red, green, blue, alpha = 0] = masks;
  const max = bitDepth === 32 ? 0xffff_ffff : 2 ** bitDepth - 1;
  if (!red || !green || !blue || red > max || green > max || blue > max || alpha > max ||
      (red & green) !== 0 || (red & blue) !== 0 || (green & blue) !== 0 ||
      (alpha & (red | green | blue)) !== 0 || !isContiguousMask(red) || !isContiguousMask(green) ||
      !isContiguousMask(blue) || (alpha !== 0 && !isContiguousMask(alpha))) invalid();
}

function isContiguousMask(mask: number): boolean {
  const lowestBit = mask & -mask;
  const normalized = Math.floor(mask / lowestBit);
  return (normalized & (normalized + 1)) === 0;
}

function uncompressedPixelBytes(width: number, height: number, bitDepth: number): number {
  const rowBits = width * bitDepth;
  if (!Number.isSafeInteger(rowBits) || rowBits < 1) invalid();
  const rowStride = Math.ceil(rowBits / 32) * 4;
  const pixelBytes = rowStride * height;
  if (!Number.isSafeInteger(pixelBytes) || pixelBytes < 1) invalid();
  return pixelBytes;
}

function inspectUncompressedArray(fileSize: number, pixelOffset: number, width: number, height: number,
  bitDepth: number, imageSize: number): number {
  const pixelBytes = uncompressedPixelBytes(width, height, bitDepth);
  const pixelEnd = pixelOffset + pixelBytes;
  if (!Number.isSafeInteger(pixelEnd) || pixelEnd > fileSize || (imageSize !== 0 && imageSize !== pixelBytes)) invalid();
  return pixelEnd;
}

function inspectRle(bytes: Uint8Array, start: number, fileSize: number, width: number, height: number,
  bitDepth: 4 | 8, paletteEntries: number, imageSize: number): number {
  const end = start + imageSize;
  if (!Number.isSafeInteger(end) || imageSize < 1 || end > fileSize) invalid();
  let cursor = start;
  let x = 0;
  let y = 0;
  let ended = false;
  while (cursor < end) {
    if (cursor + 2 > end) invalid();
    const count = bytes[cursor++]!;
    const value = bytes[cursor++]!;
    if (count > 0) {
      if (y >= height || x + count > width) invalid();
      if (bitDepth === 8) {
        if (value >= paletteEntries) invalid();
      } else {
        validateRle4Run(value, count, paletteEntries);
      }
      x += count;
      continue;
    }
    if (value === 0) {
      if (y >= height) invalid();
      x = 0;
      y += 1;
      continue;
    }
    if (value === 1) {
      ended = true;
      break;
    }
    if (value === 2) {
      if (cursor + 2 > end || y >= height) invalid();
      const nextX = x + bytes[cursor++]!;
      const nextY = y + bytes[cursor++]!;
      if (nextX > width || nextY >= height) invalid();
      x = nextX;
      y = nextY;
      continue;
    }

    const pixels = value;
    if (y >= height || x + pixels > width) invalid();
    if (bitDepth === 8) {
      const packedBytes = pixels;
      const paddedBytes = packedBytes + (packedBytes % 2);
      if (cursor + paddedBytes > end) invalid();
      for (let index = 0; index < pixels; index += 1) if (bytes[cursor + index]! >= paletteEntries) invalid();
      cursor += paddedBytes;
    } else {
      const packedBytes = Math.ceil(pixels / 2);
      const paddedBytes = packedBytes + (packedBytes % 2);
      if (cursor + paddedBytes > end) invalid();
      for (let index = 0; index < pixels; index += 1) {
        const packed = bytes[cursor + Math.floor(index / 2)]!;
        const paletteIndex = index % 2 === 0 ? packed >> 4 : packed & 0x0f;
        if (paletteIndex >= paletteEntries) invalid();
      }
      cursor += paddedBytes;
    }
    x += pixels;
  }
  if (!ended || cursor !== end) invalid();
  return end;
}

function validateRle4Run(packed: number, count: number, paletteEntries: number): void {
  if ((packed >> 4) >= paletteEntries || (count > 1 && (packed & 0x0f) >= paletteEntries)) invalid();
}

function validateV5Profile(bytes: Uint8Array, fileSize: number, pixelEnd: number, paletteEnd: number): void {
  const headerStart = FILE_HEADER_BYTES;
  const colorType = readU32le(bytes, headerStart + 56);
  const profileOffset = readU32le(bytes, headerStart + 112);
  const profileSize = readU32le(bytes, headerStart + 116);
  if (profileOffset === 0 && profileSize === 0) return;
  if (profileOffset === 0 || profileSize === 0 ||
      (colorType !== PROFILE_LINKED && colorType !== PROFILE_EMBEDDED)) invalid();
  const absoluteStart = headerStart + profileOffset;
  const absoluteEnd = absoluteStart + profileSize;
  if (!Number.isSafeInteger(absoluteEnd) || absoluteStart < Math.max(pixelEnd, paletteEnd) || absoluteEnd > fileSize) invalid();
  if (colorType === PROFILE_LINKED) {
    if (bytes[absoluteEnd - 1] !== 0) invalid();
    for (let index = absoluteStart; index < absoluteEnd - 1; index += 1) if (bytes[index] === 0) invalid();
  }
}

function readU16le(bytes: Uint8Array, offset: number): number { return bytes[offset]! | (bytes[offset + 1]! << 8); }
function readU32le(bytes: Uint8Array, offset: number): number {
  return readU16le(bytes, offset) + readU16le(bytes, offset + 2) * 0x1_0000;
}
function readI32le(bytes: Uint8Array, offset: number): number { return readU32le(bytes, offset) | 0; }
function invalid(): never { throw new OwnerWanBmpInspectionError("INVALID_BMP_STRUCTURE"); }
function unsupported(): never { throw new OwnerWanBmpInspectionError("UNSUPPORTED_BMP_COMPOSITION"); }
