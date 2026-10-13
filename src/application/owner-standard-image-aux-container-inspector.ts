import { types } from "node:util";

export type OwnerStandardImageAuxMimeType =
  | "video/mp4" | "video/webm" | "video/quicktime" | "video/mpeg" | "video/mov"
  | "video/3gpp" | "video/x-flv" | "video/x-ms-wmv" | "application/pdf";

export interface OwnerStandardImageAuxContainerInspection {
  readonly kind: "video" | "file";
  readonly mime_type: Exclude<OwnerStandardImageAuxMimeType, "video/mov">;
  readonly confidence: "STRUCTURAL_CONTAINER_VALIDATED_NOT_DECODED" | "PDF_HEADER_TAIL_GUARDS_ONLY_NOT_PARSED";
}

export class OwnerStandardImageAuxContainerError extends Error {
  constructor(readonly code: "UNSUPPORTED_MEDIA_CONTAINER" | "UNSUPPORTED_ENCRYPTED_PDF") {
    super("The media container is unsupported or structurally invalid.");
    this.name = "OwnerStandardImageAuxContainerError";
  }
}

const VIDEO_MIMES = new Set<OwnerStandardImageAuxMimeType>([
  "video/mp4", "video/webm", "video/quicktime", "video/mpeg", "video/mov", "video/3gpp", "video/x-flv", "video/x-ms-wmv"
]);

/** Checks common container framing and signatures only; it never decodes media. */
export function inspectOwnerStandardImageAuxContainer(
  bytes: Uint8Array,
  declaredMime: OwnerStandardImageAuxMimeType
): OwnerStandardImageAuxContainerInspection {
  try {
    if (types.isProxy(bytes) || (!Buffer.isBuffer(bytes) && Object.getPrototypeOf(bytes) !== Uint8Array.prototype) || bytes.byteLength < 8) invalid();
    let confidence: OwnerStandardImageAuxContainerInspection["confidence"] = "STRUCTURAL_CONTAINER_VALIDATED_NOT_DECODED";
    switch (declaredMime) {
      case "video/mp4":
      case "video/quicktime":
      case "video/mov":
      case "video/3gpp":
        inspectBmff(bytes, declaredMime);
        break;
      case "video/webm": inspectWebm(bytes); break;
      case "video/mpeg": inspectMpeg(bytes); break;
      case "video/x-flv": inspectFlv(bytes); break;
      case "video/x-ms-wmv": inspectAsf(bytes); break;
      case "application/pdf": inspectPdf(bytes); confidence = "PDF_HEADER_TAIL_GUARDS_ONLY_NOT_PARSED"; break;
    }
    return Object.freeze({
      kind: VIDEO_MIMES.has(declaredMime) ? "video" : "file",
      mime_type: declaredMime === "video/mov" ? "video/quicktime" : declaredMime,
      confidence
    });
  } catch (error) {
    if (error instanceof OwnerStandardImageAuxContainerError) throw error;
    return invalid();
  }
}

function inspectBmff(bytes: Uint8Array, mime: OwnerStandardImageAuxMimeType): void {
  let offset = 0;
  let hasQuicktime = false;
  let has3gpp = false;
  let hasMp4 = false;
  let sawFtyp = false;
  let sawMediaData = false;
  let sawMovie = false;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) invalid();
    let size = readU32(bytes, offset);
    const type = readAscii(bytes, offset + 4, 4);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > bytes.byteLength) invalid();
      const extended = readU64(bytes, offset + 8);
      if (extended > Number.MAX_SAFE_INTEGER) invalid();
      size = Number(extended);
      headerSize = 16;
    } else if (size === 0) size = bytes.byteLength - offset;
    if (size < headerSize || size > bytes.byteLength - offset) invalid();
    if (!/^[\x20-\x7e]{4}$/u.test(type)) invalid();
    if (type === "ftyp") {
      if (sawFtyp || offset !== 0 || size < headerSize + 8 || (size - headerSize - 8) % 4 !== 0) invalid();
      sawFtyp = true;
      const payload = offset + headerSize;
      for (let brandOffset = payload; brandOffset + 4 <= offset + size; brandOffset += 4) {
        if (brandOffset === payload + 4) continue;
        const brand = readAscii(bytes, brandOffset, 4);
        if (brand === "qt  ") hasQuicktime = true;
        if (/^3gp[1-9a-z]$/u.test(brand)) has3gpp = true;
        if (/^(?:isom|iso[2-9]|mp4[12]|avc1|M4V )$/u.test(brand)) hasMp4 = true;
      }
    } else if (type === "mdat") sawMediaData = true;
    else if (type === "moov") sawMovie = true;
    offset += size;
  }
  if (offset !== bytes.byteLength || !sawFtyp || !sawMediaData || !sawMovie) invalid();
  if ((mime === "video/quicktime" || mime === "video/mov") ? !hasQuicktime
    : mime === "video/3gpp" ? !has3gpp
      : !hasMp4) invalid();
}

function inspectWebm(bytes: Uint8Array): void {
  const header = readEbml(bytes, 0);
  if (header.id !== 0x1a45dfa3 || header.unknownSize) invalid();
  const headerEnd = header.dataOffset + header.size;
  if (headerEnd > bytes.byteLength) invalid();
  let cursor = header.dataOffset;
  let hasWebmDocType = false;
  while (cursor < headerEnd) {
    const child = readEbml(bytes, cursor);
    if (child.unknownSize || child.dataOffset + child.size > headerEnd) invalid();
    if (child.id === 0x4282 && child.size === 4 && readAscii(bytes, child.dataOffset, child.size) === "webm") hasWebmDocType = true;
    cursor = child.dataOffset + child.size;
  }
  if (!hasWebmDocType) invalid();
  const segment = readEbml(bytes, headerEnd);
  if (segment.id !== 0x18538067) invalid();
  const segmentEnd = segment.unknownSize ? bytes.byteLength : segment.dataOffset + segment.size;
  if (segmentEnd > bytes.byteLength || segmentEnd !== bytes.byteLength) invalid();
  cursor = segment.dataOffset;
  let hasInfo = false;
  let hasTracks = false;
  let hasCluster = false;
  while (cursor < segmentEnd) {
    const child = readEbml(bytes, cursor);
    if (child.unknownSize || child.dataOffset + child.size > segmentEnd) invalid();
    if (child.id === 0x1549a966) hasInfo = true;
    if (child.id === 0x1654ae6b) hasTracks = true;
    if (child.id === 0x1f43b675) hasCluster = true;
    cursor = child.dataOffset + child.size;
  }
  if (!hasInfo || !hasTracks || !hasCluster) invalid();
}

function readEbml(bytes: Uint8Array, offset: number): { id: number; dataOffset: number; size: number; unknownSize: boolean } {
  if (offset >= bytes.byteLength) invalid();
  const idLength = vintLength(bytes[offset]!, 4);
  if (!idLength || offset + idLength >= bytes.byteLength) invalid();
  const id = readUnsigned(bytes, offset, idLength, false);
  const sizeLength = vintLength(bytes[offset + idLength]!, 8);
  if (!sizeLength || offset + idLength + sizeLength > bytes.byteLength) invalid();
  const encodedSize = readUnsignedBigInt(bytes, offset + idLength, sizeLength, true);
  const unknownSize = encodedSize === (1n << BigInt(7 * sizeLength)) - 1n;
  if (unknownSize) return { id, dataOffset: offset + idLength + sizeLength, size: bytes.byteLength, unknownSize };
  if (encodedSize > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
  return { id, dataOffset: offset + idLength + sizeLength, size: Number(encodedSize), unknownSize };
}

function inspectMpeg(bytes: Uint8Array): void {
  let sequenceHeader = false;
  let picture = false;
  let slice = false;
  let pack = false;
  let videoPes = false;
  for (let i = 0; i + 4 <= bytes.byteLength; i += 1) {
    if (bytes[i] !== 0 || bytes[i + 1] !== 0 || bytes[i + 2] !== 1) continue;
    const code = bytes[i + 3]!;
    if (code === 0xb3 && i + 8 <= bytes.byteLength) {
      const width = (bytes[i + 4]! << 4) | (bytes[i + 5]! >>> 4);
      const height = ((bytes[i + 5]! & 0x0f) << 8) | bytes[i + 6]!;
      const aspectRatioCode = bytes[i + 7]! >>> 4;
      const frameRateCode = bytes[i + 7]! & 0x0f;
      if (width > 0 && height > 0 && aspectRatioCode >= 1 && aspectRatioCode <= 4 && frameRateCode >= 1 && frameRateCode <= 8) sequenceHeader = true;
    }
    if (code === 0x00 && i + 7 <= bytes.byteLength) {
      const pictureCodingType = (bytes[i + 5]! >>> 3) & 0x07;
      if (pictureCodingType >= 1 && pictureCodingType <= 3) picture = true;
    }
    if (code >= 0x01 && code <= 0xaf) slice = true;
    if (code === 0xba && i + 12 <= bytes.byteLength) {
      const marker = bytes[i + 4]!;
      if ((marker & 0xc0) === 0x40 && i + 14 <= bytes.byteLength) pack = true;
      if ((marker & 0xf0) === 0x20 && i + 12 <= bytes.byteLength) pack = true;
    }
    if (code >= 0xe0 && code <= 0xef && i + 6 <= bytes.byteLength) videoPes = true;
  }
  if (!sequenceHeader || !picture || (!slice && !(pack && videoPes))) invalid();
}

function inspectFlv(bytes: Uint8Array): void {
  if (readAscii(bytes, 0, 3) !== "FLV" || bytes[3] !== 1 || (bytes[4]! & 1) !== 1) invalid();
  const offset = readU32(bytes, 5);
  if (offset < 9 || offset + 15 > bytes.byteLength || readU32(bytes, offset) !== 0) invalid();
  let cursor = offset + 4;
  let videoTag = false;
  while (cursor < bytes.byteLength) {
    if (cursor + 15 > bytes.byteLength) invalid();
    const type = bytes[cursor]!;
    const dataSize = readU24(bytes, cursor + 1);
    const next = cursor + 11 + dataSize + 4;
    if (next > bytes.byteLength || readU32(bytes, cursor + 11 + dataSize) !== 11 + dataSize) invalid();
    if (type === 9 && dataSize > 0) videoTag = true;
    cursor = next;
  }
  if (!videoTag || cursor !== bytes.byteLength) invalid();
}

function inspectAsf(bytes: Uint8Array): void {
  const headerGuid = "3026b2758e66cf11a6d900aa0062ce6c";
  const filePropertiesGuid = "a1dcab8c47a9cf118ee400c00c205365";
  const streamPropertiesGuid = "9107dcb7b7a9cf118ee600c00c205365";
  const dataObjectGuid = "3626b2758e66cf11a6d900aa0062ce6c";
  const videoGuid = "c0ef19bc4d5bcf11a8fd00805f5c442b";
  if (hex(bytes, 0, 16) !== headerGuid || bytes.byteLength < 30) invalid();
  const headerSize = readU64LE(bytes, 16);
  const objectCount = readU32LE(bytes, 24);
  if (headerSize < 30 || headerSize > bytes.byteLength || bytes[28] !== 1 || bytes[29] !== 2 || objectCount > 64) invalid();
  let cursor = 30;
  let sawFileProperties = false;
  let sawVideoStream = false;
  for (let index = 0; index < objectCount; index += 1) {
    if (cursor + 24 > headerSize) invalid();
    const guid = hex(bytes, cursor, 16);
    const size = readU64LE(bytes, cursor + 16);
    if (size < 24 || size > headerSize - cursor) invalid();
    const body = cursor + 24;
    if (guid === filePropertiesGuid && size >= 40) sawFileProperties = true;
    if (guid === streamPropertiesGuid && size >= 40 && hex(bytes, body, 16) === videoGuid) sawVideoStream = true;
    cursor += size;
  }
  if (cursor !== headerSize || !sawFileProperties || !sawVideoStream || headerSize + 50 > bytes.byteLength ||
      hex(bytes, headerSize, 16) !== dataObjectGuid || readU64LE(bytes, headerSize + 16) < 50 ||
      readU64LE(bytes, headerSize + 16) > bytes.byteLength - headerSize) invalid();
}

function inspectPdf(bytes: Uint8Array): void {
  const headerLength = Math.min(bytes.byteLength, 1024);
  const header = readAscii(bytes, 0, headerLength);
  if (!/^%PDF-(?:1\.[0-7]|2\.0)/u.test(header)) invalid();
  const tailStart = Math.max(0, bytes.byteLength - 1024);
  const tail = readAscii(bytes, tailStart, bytes.byteLength - tailStart);
  const eof = tail.lastIndexOf("%%EOF");
  const startXref = tail.lastIndexOf("startxref");
  if (eof < 0 || startXref < 0 || startXref > eof || !/\d+/u.test(tail.slice(startXref + 9, eof))) invalid();
  const xrefTable = tail.lastIndexOf("xref") >= 0 && tail.lastIndexOf("trailer") >= 0;
  const xrefStream = /\/Type\s*\/XRef/u.test(tail);
  if (!xrefTable && !xrefStream) invalid();
  if (/\/Encrypt\b/u.test(tail.slice(Math.max(0, tail.lastIndexOf("trailer")), eof))) {
    throw new OwnerStandardImageAuxContainerError("UNSUPPORTED_ENCRYPTED_PDF");
  }
}

function readU24(bytes: Uint8Array, offset: number): number {
  if (offset + 3 > bytes.byteLength) invalid();
  return (bytes[offset]! << 16) | (bytes[offset + 1]! << 8) | bytes[offset + 2]!;
}

function readU32(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.byteLength) invalid();
  return bytes[offset]! * 0x1000000 + (bytes[offset + 1]! << 16) + (bytes[offset + 2]! << 8) + bytes[offset + 3]!;
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.byteLength) invalid();
  return bytes[offset]! + (bytes[offset + 1]! << 8) + (bytes[offset + 2]! << 16) + bytes[offset + 3]! * 0x1000000;
}

function readU64(bytes: Uint8Array, offset: number): bigint {
  if (offset + 8 > bytes.byteLength) invalid();
  let value = 0n;
  for (let i = 0; i < 8; i += 1) value = (value << 8n) | BigInt(bytes[offset + i]!);
  return value;
}

function readU64LE(bytes: Uint8Array, offset: number): number {
  if (offset + 8 > bytes.byteLength) invalid();
  let value = 0n;
  for (let i = 7; i >= 0; i -= 1) value = (value << 8n) | BigInt(bytes[offset + i]!);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
  return Number(value);
}

function readUnsigned(bytes: Uint8Array, offset: number, length: number, stripMarker: boolean): number {
  let value = stripMarker ? bytes[offset]! & (0xff >>> length) : bytes[offset]!;
  for (let i = 1; i < length; i += 1) value = value * 256 + bytes[offset + i]!;
  return value;
}

function readUnsignedBigInt(bytes: Uint8Array, offset: number, length: number, stripMarker: boolean): bigint {
  if (offset < 0 || length < 1 || offset + length > bytes.byteLength) invalid();
  let value = BigInt(stripMarker ? bytes[offset]! & (0xff >>> length) : bytes[offset]!);
  for (let i = 1; i < length; i += 1) value = value * 256n + BigInt(bytes[offset + i]!);
  return value;
}

function vintLength(first: number, maxLength: number): number {
  for (let length = 1; length <= maxLength; length += 1) {
    if ((first & (0x80 >>> (length - 1))) !== 0) return length;
  }
  return 0;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) invalid();
  return Buffer.from(bytes.subarray(offset, offset + length)).toString("latin1");
}

function hex(bytes: Uint8Array, offset: number, length: number): string {
  if (offset < 0 || offset + length > bytes.byteLength) invalid();
  return Buffer.from(bytes.subarray(offset, offset + length)).toString("hex");
}

function invalid(): never {
  throw new OwnerStandardImageAuxContainerError("UNSUPPORTED_MEDIA_CONTAINER");
}
