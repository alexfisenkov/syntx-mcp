import { createHash } from "node:crypto";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytes } from "./owner-image-reference-input-validator.js";

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_STANDARD_FAMILY_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_EXPLICIT_IMAGE_INSPECTION_BYTES = 64 * 1024 * 1024;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const MAX_BASE64_CHARS = Math.ceil(MAX_BYTES / 3) * 4;
const MAX_BOXES = 4_096;
const MAX_ITEMS = 4_096;
const SAFE_FILENAME = /^[^/\\\u0000-\u001f\u007f]{1,128}$/u;
const MIME_TYPES = new Set<OwnerClarityImageMimeType>(["image/jpeg", "image/png", "image/avif", "image/webp"]);
const SIMPLE_AVIF_PROPERTIES = new Set(["ispe", "pixi", "av1C", "colr"]);

export type OwnerClarityImageMimeType = "image/jpeg" | "image/png" | "image/avif" | "image/webp";

export interface ValidatedOwnerClarityUpscaleInput {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: OwnerClarityImageMimeType;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
}

export class OwnerClarityUpscaleInputError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT") {
    super("The owner Clarity image input is invalid.");
    this.name = "OwnerClarityUpscaleInputError";
  }
}

export class UnsupportedOwnerClarityAvifCompositionError extends Error {
  readonly code = "UNSUPPORTED_AVIF_COMPOSITION" as const;
  constructor() {
    super("The AVIF composition is unsupported.");
    this.name = "UnsupportedOwnerClarityAvifCompositionError";
  }
}

/** Runs the existing strict AVIF parser under a caller's explicit bounded byte policy. */
export function inspectBoundedOwnerClarityAvifBytes(bytes: Uint8Array, maxBytes: number): {
  readonly mime: "image/avif";
  readonly width: number;
  readonly height: number;
} {
  try {
    if (types.isProxy(bytes) || (!Buffer.isBuffer(bytes) && Object.getPrototypeOf(bytes) !== Uint8Array.prototype) ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES ||
        bytes.byteLength < 1 || bytes.byteLength > maxBytes) invalid();
    return Object.freeze(parseAvif(bytes));
  } catch (error) {
    if (error instanceof OwnerClarityUpscaleInputError || error instanceof UnsupportedOwnerClarityAvifCompositionError) throw error;
    return invalid();
  }
}

/** Structural AVIF metadata inspection for the separate standard image-family local 32 MiB policy. */
export function inspectBoundedOwnerClarityAvifBytes32MiB(bytes: Uint8Array, maxBytes: number): {
  readonly mime: "image/avif";
  readonly width: number;
  readonly height: number;
} {
  return inspectBoundedOwnerClarityAvifBytesWithMaximum(bytes, maxBytes, MAX_STANDARD_FAMILY_IMAGE_BYTES);
}

/** Structural AVIF inspection under an explicit trusted ceiling no greater than 64 MiB. */
export function inspectBoundedOwnerClarityAvifBytesWithMax(bytes: Uint8Array, maxBytes: number): {
  readonly mime: "image/avif";
  readonly width: number;
  readonly height: number;
} {
  return inspectBoundedOwnerClarityAvifBytesWithMaximum(bytes, maxBytes, MAX_EXPLICIT_IMAGE_INSPECTION_BYTES);
}

function inspectBoundedOwnerClarityAvifBytesWithMaximum(bytes: Uint8Array, maxBytes: number, ceiling: number): {
  readonly mime: "image/avif";
  readonly width: number;
  readonly height: number;
} {
  try {
    if (types.isProxy(bytes) || (Object.getPrototypeOf(bytes) !== Uint8Array.prototype && Object.getPrototypeOf(bytes) !== Buffer.prototype) ||
        Object.hasOwn(bytes, "buffer") || Object.hasOwn(bytes, "byteLength") || Object.hasOwn(bytes, "byteOffset") || Object.hasOwn(bytes, "length") ||
        !hasSafeArrayBufferBacking(bytes) ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > ceiling ||
        typedArrayByteLength(bytes) < 1 || typedArrayByteLength(bytes) > maxBytes) invalid();
    return Object.freeze(parseAvif(bytes));
  } catch (error) {
    if (error instanceof OwnerClarityUpscaleInputError || error instanceof UnsupportedOwnerClarityAvifCompositionError) throw error;
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

/** Validates a bounded portable image and only reports dimensions present in its container metadata. */
export function validateOwnerClarityUpscaleInput(input: unknown): ValidatedOwnerClarityUpscaleInput {
  try {
    const fields = exactRecord(input, ["content_base64", "filename", "mime_type"]);
    if (typeof fields.content_base64 !== "string" || fields.content_base64.length === 0 ||
        fields.content_base64.length > MAX_BASE64_CHARS || fields.content_base64.length % 4 !== 0 ||
        typeof fields.filename !== "string" || !SAFE_FILENAME.test(fields.filename) ||
        typeof fields.mime_type !== "string" || !MIME_TYPES.has(fields.mime_type as OwnerClarityImageMimeType)) invalid();

    const bytes = Buffer.from(fields.content_base64, "base64");
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES || bytes.toString("base64") !== fields.content_base64) invalid();
    const mime = fields.mime_type as OwnerClarityImageMimeType;
    const parsed = mime === "image/avif" ? parseAvif(bytes) : inspectBoundedOwnerImageBytes(bytes, MAX_BYTES);
    if (parsed.mime !== mime || !Number.isSafeInteger(parsed.width) || parsed.width < 1 ||
        !Number.isSafeInteger(parsed.height) || parsed.height < 1) invalid();

    return Object.freeze({
      bytes: new Uint8Array(bytes),
      filename: fields.filename,
      mime_type: mime,
      width: parsed.width,
      height: parsed.height,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      metadata_confidence: "CONTAINER_METADATA_ONLY"
    });
  } catch (error) {
    if (error instanceof OwnerClarityUpscaleInputError) throw error;
    return invalid();
  }
}

function parseAvif(bytes: Uint8Array): { readonly mime: "image/avif"; readonly width: number; readonly height: number } {
  const budget = { boxes: 0 };
  let ftyp: Box | undefined;
  let meta: Box | undefined;
  let hasMediaData = false;
  let hasAvifBrand = false;
  let firstBox = true;
  for (const box of readBoxes(bytes, 0, bytes.byteLength, budget)) {
    if (firstBox && box.type !== "ftyp") invalid();
    firstBox = false;
    if (box.type === "ftyp") {
      if (ftyp) invalid();
      ftyp = box;
      const brands = parseFileTypeBrands(bytes, box);
      if (brands.hasAvis) unsupportedAvifComposition();
      hasAvifBrand = brands.hasAvif;
    } else if (box.type === "meta") {
      if (meta) invalid();
      meta = box;
    } else if (box.type === "mdat") {
      if (box.end > box.payloadStart) hasMediaData = true;
    } else if (box.type === "moov" || box.type === "moof") {
      unsupportedAvifComposition();
    }
  }
  if (!ftyp || !meta || !hasAvifBrand) invalid();

  const metaPayload = meta.payloadStart;
  if (meta.end - metaPayload < 4 || bytes[metaPayload] !== 0 || readU24(bytes, metaPayload + 1) !== 0) invalid();
  let handler: Box | undefined;
  let primaryItem: number | undefined;
  let itemInfo: Box | undefined;
  let itemProperties: Box | undefined;
  for (const box of readBoxes(bytes, metaPayload + 4, meta.end, budget)) {
    if (box.type === "hdlr") {
      if (handler) invalid();
      handler = box;
    } else if (box.type === "pitm") {
      if (primaryItem !== undefined) invalid();
      primaryItem = parsePrimaryItemId(bytes, box);
    } else if (box.type === "iinf") {
      if (itemInfo) invalid();
      itemInfo = box;
    } else if (box.type === "iprp") {
      if (itemProperties) invalid();
      itemProperties = box;
    } else if (box.type === "idat" && box.end > box.payloadStart) {
      hasMediaData = true;
    } else if (box.type === "iref" || box.type === "grpl") {
      // References and groups can declare derived, layered, or animated composition.
      unsupportedAvifComposition();
    }
  }
  if (!hasMediaData || !handler || !isPictureHandler(bytes, handler) || primaryItem === undefined || !itemInfo || !itemProperties) invalid();

  const primaryType = parsePrimaryItemType(bytes, itemInfo, primaryItem, budget);
  if (primaryType !== "av01") unsupportedAvifComposition();
  const dimensions = parsePrimaryItemDimensions(bytes, itemProperties, primaryItem, budget);
  if (dimensions.width < 1 || dimensions.height < 1) invalid();
  return { mime: "image/avif", ...dimensions };
}

function parseFileTypeBrands(bytes: Uint8Array, box: Box): { readonly hasAvif: boolean; readonly hasAvis: boolean } {
  const length = box.end - box.payloadStart;
  if (length < 8 || (length - 8) % 4 !== 0 || (length - 8) / 4 > 64) invalid();
  let hasAvif = ascii(bytes, box.payloadStart, 4) === "avif";
  let hasAvis = ascii(bytes, box.payloadStart, 4) === "avis";
  for (let offset = box.payloadStart + 8; offset < box.end; offset += 4) {
    const brand = ascii(bytes, offset, 4);
    if (brand === "avif") hasAvif = true;
    if (brand === "avis") hasAvis = true;
  }
  return { hasAvif, hasAvis };
}

function parsePrimaryItemId(bytes: Uint8Array, box: Box): number {
  const length = box.end - box.payloadStart;
  if (length < 6) invalid();
  const version = bytes[box.payloadStart]!;
  if (readU24(bytes, box.payloadStart + 1) !== 0) invalid();
  if (version === 0 && length === 6) return readU16(bytes, box.payloadStart + 4);
  if (version === 1 && length === 8) return readU32(bytes, box.payloadStart + 4);
  return invalid();
}

function parsePrimaryItemType(bytes: Uint8Array, box: Box, primaryItem: number, budget: BoxBudget): string | undefined {
  const payload = box.payloadStart;
  const length = box.end - payload;
  if (length < 6) invalid();
  const version = bytes[payload]!;
  if (readU24(bytes, payload + 1) !== 0 || (version !== 0 && version !== 1)) invalid();
  const countBytes = version === 0 ? 2 : 4;
  const count = countBytes === 2 ? readU16(bytes, payload + 4) : readU32(bytes, payload + 4);
  if (count > MAX_ITEMS) invalid();
  let parsedCount = 0;
  let primaryType: string | undefined;
  const itemIds = new Set<number>();
  for (const entry of readBoxes(bytes, payload + 4 + countBytes, box.end, budget)) {
    parsedCount += 1;
    if (parsedCount > count || entry.type !== "infe") invalid();
    const item = parseItemInfoEntry(bytes, entry);
    if (itemIds.has(item.id)) invalid();
    itemIds.add(item.id);
    if (item.id === primaryItem) {
      if (primaryType !== undefined) invalid();
      primaryType = item.type;
    }
  }
  if (parsedCount !== count || primaryType === undefined) invalid();
  return primaryType;
}

function parseItemInfoEntry(bytes: Uint8Array, box: Box): { readonly id: number; readonly type: string } {
  const payload = box.payloadStart;
  const length = box.end - payload;
  if (length < 12) invalid();
  const version = bytes[payload]!;
  if (readU24(bytes, payload + 1) !== 0 || (version !== 2 && version !== 3)) invalid();
  const idOffset = payload + 4;
  const protectionOffset = idOffset + (version === 2 ? 2 : 4);
  const typeOffset = protectionOffset + 2;
  if (typeOffset + 5 > box.end || readU16(bytes, protectionOffset) !== 0) invalid();
  const type = ascii(bytes, typeOffset, 4);
  let nameEnd = typeOffset + 4;
  while (nameEnd < box.end && bytes[nameEnd] !== 0) nameEnd += 1;
  if (nameEnd === box.end) invalid();
  return { id: version === 2 ? readU16(bytes, idOffset) : readU32(bytes, idOffset), type };
}

function parsePrimaryItemDimensions(bytes: Uint8Array, box: Box, primaryItem: number, budget: BoxBudget): { width: number; height: number } {
  let propertyContainer: Box | undefined;
  let association: Box | undefined;
  for (const child of readBoxes(bytes, box.payloadStart, box.end, budget)) {
    if (child.type === "ipco") {
      if (propertyContainer) invalid();
      propertyContainer = child;
    } else if (child.type === "ipma") {
      if (association) invalid();
      association = child;
    }
  }
  if (!propertyContainer || !association) invalid();

  const properties: Array<{ readonly type: string; readonly width?: number; readonly height?: number }> = [];
  for (const property of readBoxes(bytes, propertyContainer.payloadStart, propertyContainer.end, budget)) {
    if (properties.length >= MAX_ITEMS) invalid();
    if (property.type === "ispe") {
      const length = property.end - property.payloadStart;
      if (length !== 12 || bytes[property.payloadStart] !== 0 || readU24(bytes, property.payloadStart + 1) !== 0) invalid();
      properties.push({ type: property.type, width: readU32(bytes, property.payloadStart + 4), height: readU32(bytes, property.payloadStart + 8) });
    } else {
      properties.push({ type: property.type });
    }
  }

  const primaryProperties = parsePrimaryPropertyAssociations(bytes, association, primaryItem);
  const associatedIspe = primaryProperties.filter((index) => properties[index - 1]?.type === "ispe");
  if (associatedIspe.length !== 1 || primaryProperties.some((index) => !properties[index - 1])) invalid();
  if (primaryProperties.some((index) => !SIMPLE_AVIF_PROPERTIES.has(properties[index - 1]!.type))) unsupportedAvifComposition();
  const dimensions = properties[associatedIspe[0]! - 1]!;
  return { width: dimensions.width!, height: dimensions.height! };
}

function parsePrimaryPropertyAssociations(bytes: Uint8Array, box: Box, primaryItem: number): number[] {
  const payload = box.payloadStart;
  const length = box.end - payload;
  if (length < 8) invalid();
  const version = bytes[payload]!;
  const flags = readU24(bytes, payload + 1);
  if ((version !== 0 && version !== 1) || (flags & ~1) !== 0) invalid();
  const wideIndex = (flags & 1) !== 0;
  const entryCount = readU32(bytes, payload + 4);
  if (entryCount > MAX_ITEMS) invalid();
  let offset = payload + 8;
  let parsedEntries = 0;
  let primaryCount = 0;
  let primaryProperties: number[] | undefined;
  const itemIds = new Set<number>();
  for (; parsedEntries < entryCount; parsedEntries += 1) {
    const idBytes = version === 0 ? 2 : 4;
    if (offset + idBytes + 1 > box.end) invalid();
    const itemId = idBytes === 2 ? readU16(bytes, offset) : readU32(bytes, offset);
    offset += idBytes;
    if (itemIds.has(itemId)) invalid();
    itemIds.add(itemId);
    const associationCount = bytes[offset++]!;
    if (itemId === primaryItem) {
      primaryCount += 1;
      if (primaryCount > 1) invalid();
      primaryProperties = [];
    }
    for (let index = 0; index < associationCount; index += 1) {
      const associationBytes = wideIndex ? 2 : 1;
      if (offset + associationBytes > box.end) invalid();
      const raw = wideIndex ? readU16(bytes, offset) : bytes[offset]!;
      offset += associationBytes;
      const propertyIndex = wideIndex ? raw & 0x7fff : raw & 0x7f;
      if (propertyIndex === 0) invalid();
      if (itemId === primaryItem) primaryProperties!.push(propertyIndex);
    }
  }
  if (offset !== box.end || primaryCount !== 1 || !primaryProperties || primaryProperties.length > 127) invalid();
  if (new Set(primaryProperties).size !== primaryProperties.length) invalid();
  return primaryProperties;
}

function isPictureHandler(bytes: Uint8Array, box: Box): boolean {
  return box.end - box.payloadStart >= 12 && bytes[box.payloadStart] === 0 &&
    readU24(bytes, box.payloadStart + 1) === 0 && ascii(bytes, box.payloadStart + 8, 4) === "pict";
}

function* readBoxes(bytes: Uint8Array, start: number, end: number, budget: BoxBudget): Generator<Box> {
  let offset = start;
  while (offset < end) {
    budget.boxes += 1;
    if (budget.boxes > MAX_BOXES || offset + 8 > end) invalid();
    const size32 = readU32(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    let headerBytes = 8;
    let size: number;
    if (size32 === 1) {
      if (offset + 16 > end) invalid();
      const extended = BigInt(readU32(bytes, offset + 8)) * 0x1_0000_0000n + BigInt(readU32(bytes, offset + 12));
      if (extended > BigInt(end - offset) || extended > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
      size = Number(extended);
      headerBytes = 16;
    } else {
      if (size32 === 0) invalid();
      size = size32;
    }
    if (size < headerBytes || size > end - offset) invalid();
    const boxEnd = offset + size;
    yield { type, start: offset, payloadStart: offset + headerBytes, end: boxEnd };
    offset = boxEnd;
  }
  if (offset !== end) invalid();
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

function readU16(bytes: Uint8Array, offset: number): number { return (bytes[offset]! << 8) | bytes[offset + 1]!; }
function readU24(bytes: Uint8Array, offset: number): number { return (bytes[offset]! << 16) | (bytes[offset + 1]! << 8) | bytes[offset + 2]!; }
function readU32(bytes: Uint8Array, offset: number): number { return bytes[offset]! * 0x1000000 + (bytes[offset + 1]! << 16) + (bytes[offset + 2]! << 8) + bytes[offset + 3]!; }
function ascii(bytes: Uint8Array, offset: number, length: number): string { return String.fromCharCode(...bytes.subarray(offset, offset + length)); }
function invalid(): never { throw new OwnerClarityUpscaleInputError("INVALID_IMAGE_INPUT"); }
function unsupportedAvifComposition(): never { throw new UnsupportedOwnerClarityAvifCompositionError(); }
interface Box { readonly type: string; readonly start: number; readonly payloadStart: number; readonly end: number; }
interface BoxBudget { boxes: number; }
