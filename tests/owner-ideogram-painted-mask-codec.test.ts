import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import test from "node:test";
import {
  encodeOwnerIdeogramPaintedMaskVariants,
  validateOwnerIdeogramPaintedMaskVariantBytes,
  OwnerIdeogramPaintedMaskCodecError
} from "../src/application/owner-ideogram-painted-mask-codec.js";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb8_8320 : 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  body.copy(result, 4);
  result.writeUInt32BE(crc32(body), data.length + 8);
  return result;
}

function rgbaPng(width: number, height: number, pixels: readonly (readonly number[])[], filters?: readonly number[], compressionLevel = 6): Buffer {
  const raw: number[] = [];
  const previous = Buffer.alloc(width * 4);
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.from(pixels.slice(y * width, (y + 1) * width).flat());
    const filter = filters?.[y] ?? 0;
    raw.push(filter);
    for (let index = 0; index < row.length; index += 1) {
      const left = index >= 4 ? row[index - 4]! : 0;
      const up = previous[index]!;
      const upperLeft = index >= 4 ? previous[index - 4]! : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upperLeft);
      raw.push((row[index]! - predictor + 256) & 0xff);
    }
    row.copy(previous);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from(raw), { level: compressionLevel })), chunk("IEND", Buffer.alloc(0))]);
}

function largeLowCompressionRgbaPng(width: number, height: number): Buffer {
  const rowBytes = width * 4;
  const raw = Buffer.allocUnsafe((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowStart + 1 + x * 4;
      raw[offset] = x & 0xff;
      raw[offset + 1] = y & 0xff;
      raw[offset + 2] = (x + y) & 0xff;
      raw[offset + 3] = (x + y) % 2 === 0 ? 0 : 1;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  try {
    return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 0 })), chunk("IEND", Buffer.alloc(0))]);
  } finally {
    raw.fill(0);
    ihdr.fill(0);
  }
}

function paeth(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const dl = Math.abs(estimate - left);
  const du = Math.abs(estimate - up);
  const dul = Math.abs(estimate - upperLeft);
  return dl <= du && dl <= dul ? left : du <= dul ? up : upperLeft;
}

function decodeCanonical(bytes: Uint8Array): { width: number; height: number; rows: Buffer[]; chunkTypes: string[] } {
  const source = Buffer.from(bytes);
  assert.deepEqual(source.subarray(0, 8), SIGNATURE);
  let offset = 8;
  const chunks: Array<{ type: string; data: Buffer }> = [];
  while (offset < source.length) {
    const length = source.readUInt32BE(offset);
    const type = source.toString("ascii", offset + 4, offset + 8);
    const dataEnd = offset + 8 + length;
    assert.equal(source.readUInt32BE(dataEnd), crc32(source.subarray(offset + 4, dataEnd)), `${type} CRC`);
    chunks.push({ type, data: source.subarray(offset + 8, dataEnd) });
    offset += length + 12;
  }
  const ihdr = chunks[0]!.data;
  assert.equal(ihdr[8], 8);
  assert.equal(ihdr[9], 6);
  assert.equal(ihdr[10], 0);
  assert.equal(ihdr[11], 0);
  assert.equal(ihdr[12], 0);
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const inflated = inflateSync(Buffer.concat(chunks.filter((item) => item.type === "IDAT").map((item) => item.data)));
  const rowBytes = width * 4;
  const rows = Array.from({ length: height }, (_, y) => {
    const start = y * (rowBytes + 1);
    assert.equal(inflated[start], 0, "canonical encoder uses filter 0");
    return inflated.subarray(start + 1, start + 1 + rowBytes);
  });
  return { width, height, rows, chunkTypes: chunks.map((item) => item.type) };
}

test("uses painted alpha > 0 and emits complementary opaque grayscale masks", () => {
  const input = rgbaPng(4, 1, [[10, 20, 30, 0], [90, 80, 70, 1], [2, 3, 4, 128], [255, 127, 0, 255]]);
  const result = encodeOwnerIdeogramPaintedMaskVariants(input.toString("base64"));
  const normal = decodeCanonical(result.source_inverted_mask_false.bytes);
  const inverse = decodeCanonical(result.source_inverted_mask_true.bytes);
  assert.equal(normal.width, 4);
  assert.equal(normal.height, 1);
  assert.deepEqual(normal.chunkTypes, ["IHDR", "IDAT", "IEND"]);
  assert.deepEqual([...normal.rows[0]!], [255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
  assert.deepEqual([...inverse.rows[0]!], [0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
  assert.equal(result.source_inverted_mask_false.sha256,
    `sha256:${createHash("sha256").update(result.source_inverted_mask_false.bytes).digest("hex")}`);
  assert.equal(result.source_inverted_mask_true.sha256,
    `sha256:${createHash("sha256").update(result.source_inverted_mask_true.bytes).digest("hex")}`);
  assert.equal(result.confidence_scope, "LOCAL_CANONICAL_MASK_BYTES_ONLY_NO_OWNERSHIP_OR_PROVIDER_PROOF");
});

test("validates only canonical codec-output mask bytes and returns bounded metadata without mutating caller bytes", () => {
  const input = rgbaPng(2, 1, [[1, 2, 3, 0], [20, 30, 40, 1]]);
  const variant = encodeOwnerIdeogramPaintedMaskVariants(input.toString("base64")).source_inverted_mask_false;
  const callerBytes = Buffer.from(variant.bytes);
  const checked = validateOwnerIdeogramPaintedMaskVariantBytes(variant.bytes);
  assert.deepEqual({ size: checked.size, width: checked.width, height: checked.height, sha256: checked.sha256 },
    { size: variant.bytes.byteLength, width: 2, height: 1, sha256: variant.sha256 });
  assert.notEqual(checked.bytes, variant.bytes);
  assert.deepEqual(checked.bytes, variant.bytes);
  variant.bytes.fill(0);
  assert.deepEqual(checked.bytes, callerBytes, "the upload snapshot is independent of later caller-buffer mutation");
  checked.bytes.fill(0);
  variant.bytes.set(callerBytes);
  assert.throws(() => validateOwnerIdeogramPaintedMaskVariantBytes(rgbaPng(1, 1, [[0, 0, 0, 254]])), OwnerIdeogramPaintedMaskCodecError);
  assert.throws(() => validateOwnerIdeogramPaintedMaskVariantBytes(rgbaPng(1, 1, [[128, 128, 128, 255]])), OwnerIdeogramPaintedMaskCodecError);
  assert.throws(() => validateOwnerIdeogramPaintedMaskVariantBytes(rgbaPng(1, 1, [[0, 255, 0, 255]])), OwnerIdeogramPaintedMaskCodecError);
  const noncanonicalFilter = rgbaPng(1, 1, [[0, 0, 0, 255]], [1]);
  assert.throws(() => validateOwnerIdeogramPaintedMaskVariantBytes(noncanonicalFilter), OwnerIdeogramPaintedMaskCodecError);
  const corrupt = Buffer.from(variant.bytes);
  corrupt[corrupt.byteLength - 5] = corrupt[corrupt.byteLength - 5]! ^ 0xff;
  assert.throws(() => validateOwnerIdeogramPaintedMaskVariantBytes(corrupt), OwnerIdeogramPaintedMaskCodecError);
  assert.throws(() => validateOwnerIdeogramPaintedMaskVariantBytes(Buffer.alloc(25 * 1024 * 1024 + 1)), OwnerIdeogramPaintedMaskCodecError);
});

test("decodes every PNG row filter including Paeth before applying mask alpha semantics", () => {
  const pixels = [
    [31, 18, 9, 0], [12, 64, 22, 1],
    [5, 7, 8, 255], [200, 100, 50, 128],
    [9, 10, 11, 0], [255, 1, 2, 255],
    [1, 2, 3, 128], [4, 5, 6, 1],
    [7, 8, 9, 255], [10, 11, 12, 0]
  ];
  const input = rgbaPng(2, 5, pixels, [0, 1, 2, 3, 4]);
  const result = encodeOwnerIdeogramPaintedMaskVariants(input.toString("base64"));
  const decoded = decodeCanonical(result.source_inverted_mask_false.bytes);
  assert.deepEqual(decoded.rows.map((row) => [...row].filter((_, index) => index % 4 === 0)),
    [[255, 0], [0, 0], [255, 0], [0, 0], [0, 255]]);
  for (const row of decoded.rows) for (let index = 3; index < row.length; index += 4) assert.equal(row[index], 255);
});

test("rejects malformed base64, unsupported PNG layouts, corrupt CRC and trailing bytes safely", () => {
  const valid = rgbaPng(1, 1, [[1, 2, 3, 0]]);
  for (const invalidBase64 of ["", "YQ", "YQ==\n", "!!!!", "YQ==AAAA"]) {
    assert.throws(() => encodeOwnerIdeogramPaintedMaskVariants(invalidBase64), OwnerIdeogramPaintedMaskCodecError);
  }
  const corrupt = Buffer.from(valid);
  corrupt[corrupt.length - 5] = corrupt[corrupt.length - 5]! ^ 0xff;
  assert.throws(() => encodeOwnerIdeogramPaintedMaskVariants(corrupt.toString("base64")), OwnerIdeogramPaintedMaskCodecError);
  assert.throws(() => encodeOwnerIdeogramPaintedMaskVariants(valid.subarray(0, valid.length - 1).toString("base64")),
    OwnerIdeogramPaintedMaskCodecError);
  assert.throws(() => encodeOwnerIdeogramPaintedMaskVariants(Buffer.concat([valid, Buffer.from([0])]).toString("base64")),
    OwnerIdeogramPaintedMaskCodecError);

  const unsupportedHeader = Buffer.from(valid);
  unsupportedHeader[24] = 16;
  const headerCrcOffset = 8 + 8 + 13;
  unsupportedHeader.writeUInt32BE(crc32(unsupportedHeader.subarray(12, 29)), headerCrcOffset);
  assert.throws(() => encodeOwnerIdeogramPaintedMaskVariants(unsupportedHeader.toString("base64")), OwnerIdeogramPaintedMaskCodecError);
});

test("rejects PLTE, APNG and unknown critical chunks rather than interpreting alternate composition", () => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  const idat = chunk("IDAT", deflateSync(Buffer.from([0, 1, 2, 3, 4])));
  const ancillaryBeforeHeader = Buffer.concat([SIGNATURE, chunk("tEXt", Buffer.from("x")), chunk("IHDR", header), idat, chunk("IEND", Buffer.alloc(0))]);
  assert.throws(() => encodeOwnerIdeogramPaintedMaskVariants(ancillaryBeforeHeader.toString("base64")), OwnerIdeogramPaintedMaskCodecError);
  for (const inserted of [chunk("PLTE", Buffer.from([0, 0, 0])), chunk("acTL", Buffer.alloc(8)), chunk("ABCD", Buffer.alloc(0))]) {
    const bytes = Buffer.concat([SIGNATURE, chunk("IHDR", header), inserted, idat, chunk("IEND", Buffer.alloc(0))]);
    assert.throws(() => encodeOwnerIdeogramPaintedMaskVariants(bytes.toString("base64")), OwnerIdeogramPaintedMaskCodecError);
  }
});

test("rejects invalid filter bytes, separated IDAT sequences, and compressed trailing data", () => {
  const invalidFilter = rgbaPng(1, 1, [[1, 2, 3, 4]], [5]);
  assert.throws(() => encodeOwnerIdeogramPaintedMaskVariants(invalidFilter.toString("base64")), OwnerIdeogramPaintedMaskCodecError);

  const valid = rgbaPng(1, 1, [[1, 2, 3, 4]]);
  const ihdrChunk = valid.subarray(8, 33);
  const idatLength = valid.readUInt32BE(33);
  const compressed = valid.subarray(41, 41 + idatLength);
  const split = Math.max(1, Math.floor(compressed.byteLength / 2));
  const beforeIdat = chunk("IDAT", compressed.subarray(0, split));
  const afterIdat = chunk("IDAT", compressed.subarray(split));
  const nonContiguous = Buffer.concat([SIGNATURE, ihdrChunk, beforeIdat, chunk("tEXt", Buffer.from("x")), afterIdat, chunk("IEND", Buffer.alloc(0))]);
  assert.throws(() => encodeOwnerIdeogramPaintedMaskVariants(nonContiguous.toString("base64")), OwnerIdeogramPaintedMaskCodecError);

  const trailingCompressed = Buffer.concat([SIGNATURE, ihdrChunk,
    chunk("IDAT", Buffer.concat([compressed, Buffer.from([0xde, 0xad])])), chunk("IEND", Buffer.alloc(0))]);
  assert.throws(() => encodeOwnerIdeogramPaintedMaskVariants(trailingCompressed.toString("base64")), OwnerIdeogramPaintedMaskCodecError);
});

test("enforces compressed input, side, and pixel resource limits before full decode", () => {
  const hugeHeader = Buffer.alloc(13);
  hugeHeader.writeUInt32BE(16_385, 0);
  hugeHeader.writeUInt32BE(1, 4);
  hugeHeader[8] = 8;
  hugeHeader[9] = 6;
  const png = Buffer.concat([SIGNATURE, chunk("IHDR", hugeHeader), chunk("IDAT", deflateSync(Buffer.from([0]))), chunk("IEND", Buffer.alloc(0))]);
  assert.throws(() => encodeOwnerIdeogramPaintedMaskVariants(png.toString("base64")), OwnerIdeogramPaintedMaskCodecError);

  const pixelLimitHeader = Buffer.alloc(13);
  pixelLimitHeader.writeUInt32BE(4_000, 0);
  pixelLimitHeader.writeUInt32BE(4_001, 4);
  pixelLimitHeader[8] = 8;
  pixelLimitHeader[9] = 6;
  const overPixelLimit = Buffer.concat([SIGNATURE, chunk("IHDR", pixelLimitHeader), chunk("IDAT", deflateSync(Buffer.from([0]))), chunk("IEND", Buffer.alloc(0))]);
  assert.throws(() => encodeOwnerIdeogramPaintedMaskVariants(overPixelLimit.toString("base64")), OwnerIdeogramPaintedMaskCodecError);
});

test("accepts a valid large base64 RGBA PNG and preserves samples, dimensions, and output hashes", () => {
  const width = 2_750;
  const height = 2_000;
  const input = largeLowCompressionRgbaPng(width, height);
  assert.ok(input.byteLength > 1_000_000);
  const base64 = input.toString("base64");
  input.fill(0);
  assert.ok(base64.length > 1_000_000);
  assert.ok(base64.length < Math.ceil((25 * 1024 * 1024) / 3) * 4);
  assert.throws(() => encodeOwnerIdeogramPaintedMaskVariants(`${base64}====`),
    (error: unknown) => error instanceof OwnerIdeogramPaintedMaskCodecError && error.code === "INVALID_BASE64");

  const result = encodeOwnerIdeogramPaintedMaskVariants(base64);
  const normal = decodeCanonical(result.source_inverted_mask_false.bytes);
  const inverse = decodeCanonical(result.source_inverted_mask_true.bytes);
  assert.deepEqual([normal.width, normal.height, inverse.width, inverse.height], [width, height, width, height]);
  assert.deepEqual([...normal.rows[0]!.subarray(0, 8)], [255, 255, 255, 255, 0, 0, 0, 255]);
  assert.deepEqual([...inverse.rows[0]!.subarray(0, 8)], [0, 0, 0, 255, 255, 255, 255, 255]);
  assert.equal(result.source_inverted_mask_false.sha256,
    `sha256:${createHash("sha256").update(result.source_inverted_mask_false.bytes).digest("hex")}`);
  assert.equal(result.source_inverted_mask_true.sha256,
    `sha256:${createHash("sha256").update(result.source_inverted_mask_true.bytes).digest("hex")}`);
});
