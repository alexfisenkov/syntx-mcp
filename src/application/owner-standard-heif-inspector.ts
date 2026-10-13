import { types } from "node:util";

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_BOXES = 4_096;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;

export class OwnerStandardHeifInspectorError extends Error {
  constructor(readonly code: "INVALID_HEIF_CONTAINER" | "UNSUPPORTED_HEIF_COMPOSITION") {
    super("The HEIF container is invalid or uses an unsupported image composition.");
    this.name = "OwnerStandardHeifInspectorError";
  }
}

/** Reads primary-item dimensions from a bounded common HEIC/HEIF ISO-BMFF still container. */
export function inspectOwnerStandardHeifBytes(bytes: Uint8Array, declaredMime: "image/heic" | "image/heif"): {
  readonly mime: "image/heic" | "image/heif";
  readonly width: number;
  readonly height: number;
  readonly validation_confidence: "HEIF_PRIMARY_ITEM_ISPE_ASSOCIATION_ONLY";
} {
  try {
    if (types.isProxy(bytes) || (Object.getPrototypeOf(bytes) !== Uint8Array.prototype && Object.getPrototypeOf(bytes) !== Buffer.prototype) ||
        Object.hasOwn(bytes, "buffer") || Object.hasOwn(bytes, "byteLength") || Object.hasOwn(bytes, "byteOffset") || Object.hasOwn(bytes, "length") ||
        !hasSafeArrayBufferBacking(bytes) ||
        typedArrayByteLength(bytes) < 32 || typedArrayByteLength(bytes) > MAX_BYTES) invalid();
    const budget = { boxes: 0 };
    const top = [...readBoxes(bytes, 0, bytes.byteLength, budget)];
    if (top[0]?.type !== "ftyp") invalid();
    const ftyp = top[0]!;
    const brands = readBrands(bytes, ftyp);
    const heicBrands = new Set(["heic", "heix", "hevc", "hevx"]);
    const heifBrands = new Set(["heif", "mif1", "mif2"]);
    if (declaredMime === "image/heic" ? ![...brands].some((brand) => heicBrands.has(brand)) :
        ![...brands].some((brand) => heifBrands.has(brand))) invalid();
    const metas = top.filter((box) => box.type === "meta");
    if (metas.length !== 1 || !top.some((box) => box.type === "mdat" || box.type === "idat")) invalid();
    if (top.some((box) => box.type === "moov" || box.type === "moof" || box.type === "iref")) unsupported();
    const meta = metas[0]!;
    if (meta.end - meta.payloadStart < 4 || bytes[meta.payloadStart] !== 0 || readU24(bytes, meta.payloadStart + 1) !== 0) invalid();
    const children = [...readBoxes(bytes, meta.payloadStart + 4, meta.end, budget)];
    const handlers = children.filter((box) => box.type === "hdlr");
    const primaries = children.filter((box) => box.type === "pitm");
    const itemInfos = children.filter((box) => box.type === "iinf");
    const propertyContainers = children.filter((box) => box.type === "iprp");
    if (handlers.length !== 1 || !isPictureHandler(bytes, handlers[0]!) || primaries.length !== 1 || itemInfos.length !== 1 || propertyContainers.length !== 1) invalid();
    if (children.some((box) => box.type === "iref")) unsupported();
    const primaryItem = readPrimaryItemId(bytes, primaries[0]!);
    const primaryType = readPrimaryItemType(bytes, itemInfos[0]!, primaryItem, budget);
    if (primaryType === "grid" || primaryType === "iovl" || primaryType === "iden") unsupported();
    if (primaryType !== "hvc1" && primaryType !== "hev1") unsupported();
    const iprpChildren = [...readBoxes(bytes, propertyContainers[0]!.payloadStart, propertyContainers[0]!.end, budget)];
    const ipco = iprpChildren.filter((box) => box.type === "ipco");
    const ipma = iprpChildren.filter((box) => box.type === "ipma");
    if (ipco.length !== 1 || ipma.length !== 1) invalid();
    const properties = [...readBoxes(bytes, ipco[0]!.payloadStart, ipco[0]!.end, budget)];
    const dimensions: Array<{ width: number; height: number }> = [];
    for (const property of properties) {
      if (property.type === "ispe") {
        const length = property.end - property.payloadStart;
        if (length !== 12 || bytes[property.payloadStart] !== 0 || readU24(bytes, property.payloadStart + 1) !== 0) invalid();
        dimensions.push({ width: readU32(bytes, property.payloadStart + 4), height: readU32(bytes, property.payloadStart + 8) });
      }
    }
    const associated = readPrimaryPropertyAssociations(bytes, ipma[0]!, primaryItem);
    const ispeIndexes = associated.filter((index) => properties[index - 1]?.type === "ispe");
    if (associated.some((index) => !properties[index - 1]) || ispeIndexes.length !== 1) invalid();
    const size = dimensions[ispeIndexes[0]! - 1];
    if (!size || !Number.isSafeInteger(size.width) || !Number.isSafeInteger(size.height) || size.width < 1 || size.height < 1) invalid();
    return Object.freeze({ mime: declaredMime, width: size.width, height: size.height, validation_confidence: "HEIF_PRIMARY_ITEM_ISPE_ASSOCIATION_ONLY" });
  } catch (error) {
    if (error instanceof OwnerStandardHeifInspectorError) throw error;
    return invalid();
  }
}

function readBrands(bytes: Uint8Array, box: Box): Set<string> {
  const length = box.end - box.payloadStart;
  if (length < 8 || (length - 8) % 4 !== 0) invalid();
  const brands = new Set<string>([ascii(bytes, box.payloadStart, 4)]);
  for (let offset = box.payloadStart + 8; offset < box.end; offset += 4) brands.add(ascii(bytes, offset, 4));
  return brands;
}
function readPrimaryItemId(bytes: Uint8Array, box: Box): number {
  const payload = box.payloadStart;
  const length = box.end - payload;
  if (length < 6) invalid();
  const version = bytes[payload]!;
  if (version === 0 && length === 6) return readU16(bytes, payload + 4);
  if (version === 1 && length === 8) return readU32(bytes, payload + 4);
  return invalid();
}
function readPrimaryItemType(bytes: Uint8Array, box: Box, primary: number, budget: BoxBudget): string {
  const payload = box.payloadStart;
  const length = box.end - payload;
  if (length < 6 || (bytes[payload] !== 0 && bytes[payload] !== 1)) invalid();
  const version = bytes[payload]!;
  const countBytes = version === 0 ? 2 : 4;
  const count = countBytes === 2 ? readU16(bytes, payload + 4) : readU32(bytes, payload + 4);
  let offset = payload + 4 + countBytes;
  let found: string | undefined;
  for (let index = 0; index < count; index += 1) {
    const entry = nextBox(bytes, offset, box.end, budget);
    if (entry.type !== "infe") invalid();
    const itemPayload = entry.payloadStart;
    const itemVersion = bytes[itemPayload]!;
    if (itemVersion !== 2 && itemVersion !== 3) unsupported();
    const itemIdSize = itemVersion === 2 ? 2 : 4;
    if (entry.end - itemPayload < 4 + itemIdSize + 2 + 5) invalid();
    const itemId = itemIdSize === 2 ? readU16(bytes, itemPayload + 4) : readU32(bytes, itemPayload + 4);
    const typeOffset = itemPayload + 4 + itemIdSize + 2;
    const type = ascii(bytes, typeOffset, 4);
    if (itemId === primary) {
      if (found) invalid();
      found = type;
    }
    offset = entry.end;
  }
  if (offset !== box.end || !found) invalid();
  return found;
}
function readPrimaryPropertyAssociations(bytes: Uint8Array, box: Box, primary: number): number[] {
  const payload = box.payloadStart;
  const length = box.end - payload;
  if (length < 8) invalid();
  const version = bytes[payload]!;
  const flags = readU24(bytes, payload + 1);
  if ((version !== 0 && version !== 1) || (flags & ~1) !== 0) invalid();
  const wide = (flags & 1) !== 0;
  const count = readU32(bytes, payload + 4);
  if (count > MAX_BOXES) invalid();
  const properties: number[] = [];
  const seen = new Set<number>();
  let offset = payload + 8;
  let found = false;
  for (let index = 0; index < count; index += 1) {
    const idSize = version === 0 ? 2 : 4;
    if (offset + idSize + 1 > box.end) invalid();
    const id = idSize === 2 ? readU16(bytes, offset) : readU32(bytes, offset);
    offset += idSize;
    const associations = bytes[offset++]!;
    if (seen.has(id)) invalid();
    seen.add(id);
    if (id === primary) found = true;
    for (let association = 0; association < associations; association += 1) {
      const raw = wide ? readU16(bytes, offset) : bytes[offset]!;
      offset += wide ? 2 : 1;
      const propertyIndex = wide ? raw & 0x7fff : raw & 0x7f;
      if (propertyIndex === 0) invalid();
      if (id === primary) properties.push(propertyIndex);
    }
  }
  if (offset !== box.end || !found || properties.length === 0 || properties.length > 127 || new Set(properties).size !== properties.length) invalid();
  return properties;
}
function isPictureHandler(bytes: Uint8Array, box: Box): boolean {
  return box.end - box.payloadStart >= 12 && bytes[box.payloadStart] === 0 &&
    readU24(bytes, box.payloadStart + 1) === 0 && ascii(bytes, box.payloadStart + 8, 4) === "pict";
}
function* readBoxes(bytes: Uint8Array, start: number, end: number, budget: BoxBudget): Generator<Box> {
  let offset = start;
  while (offset < end) {
    yield nextBox(bytes, offset, end, budget);
    const size = readU32(bytes, offset);
    offset += size === 1 ? Number(readU64(bytes, offset + 8)) : size;
  }
  if (offset !== end) invalid();
}
function nextBox(bytes: Uint8Array, offset: number, end: number, budget: BoxBudget): Box {
  budget.boxes += 1;
  if (budget.boxes > MAX_BOXES || offset + 8 > end) invalid();
  const size32 = readU32(bytes, offset);
  const type = ascii(bytes, offset + 4, 4);
  let headerBytes = 8;
  let size: number;
  if (size32 === 1) {
    if (offset + 16 > end) invalid();
    const extended = readU64(bytes, offset + 8);
    if (extended > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
    size = Number(extended);
    headerBytes = 16;
  } else {
    if (size32 === 0) invalid();
    size = size32;
  }
  if (size < headerBytes || size > end - offset) invalid();
  return { type, start: offset, payloadStart: offset + headerBytes, end: offset + size };
}
function readU16(bytes: Uint8Array, offset: number): number { return (bytes[offset]! << 8) | bytes[offset + 1]!; }
function readU24(bytes: Uint8Array, offset: number): number { return (bytes[offset]! << 16) | (bytes[offset + 1]! << 8) | bytes[offset + 2]!; }
function readU32(bytes: Uint8Array, offset: number): number { return bytes[offset]! * 0x1000000 + (bytes[offset + 1]! << 16) + (bytes[offset + 2]! << 8) + bytes[offset + 3]!; }
function readU64(bytes: Uint8Array, offset: number): bigint { return BigInt(readU32(bytes, offset)) * 0x1_0000_0000n + BigInt(readU32(bytes, offset + 4)); }
function ascii(bytes: Uint8Array, offset: number, length: number): string { return String.fromCharCode(...bytes.subarray(offset, offset + length)); }
function typedArrayByteLength(bytes: Uint8Array): number { return Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, bytes, []) as number; }
function hasSafeArrayBufferBacking(bytes: Uint8Array): boolean {
  const backing = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, bytes, []) as ArrayBuffer;
  return !types.isProxy(backing) && Object.getPrototypeOf(backing) === ArrayBuffer.prototype && !Object.hasOwn(backing, "byteLength");
}
function invalid(): never { throw new OwnerStandardHeifInspectorError("INVALID_HEIF_CONTAINER"); }
function unsupported(): never { throw new OwnerStandardHeifInspectorError("UNSUPPORTED_HEIF_COMPOSITION"); }
interface Box { readonly type: string; readonly start: number; readonly payloadStart: number; readonly end: number; }
interface BoxBudget { boxes: number; }
