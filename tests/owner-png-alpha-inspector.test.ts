import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { inspectOwnerPngAlpha } from "../src/application/owner-png-alpha-inspector.js";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBytes, data]);
  const crc = crc32(body);
  const trailer = Buffer.alloc(4);
  trailer.writeUInt32BE(crc);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, body, trailer]);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb8_8320 : 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function png(width: number, height: number, bitDepth: number, colorType: number, interlace: number,
  scanlines: readonly number[][], beforeData: readonly { type: string; data: number[] }[] = []): Buffer {
  return rawPng(width, height, bitDepth, colorType, interlace, [
    ...beforeData.map((chunk) => ({ type: chunk.type, data: Buffer.from(chunk.data) })),
    { type: "IDAT", data: deflateSync(Buffer.from(scanlines.flat())) }
  ]);
}

function rawPng(width: number, height: number, bitDepth: number, colorType: number, interlace: number,
  chunks: readonly { type: string; data: Buffer }[]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[12] = interlace;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    ...chunks.map((chunk) => pngChunk(chunk.type, chunk.data)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function rgbaPng(width: number, height: number, rows: readonly number[][]): Buffer {
  return png(width, height, 8, 6, 0, rows);
}

function filteredRows(pixels: readonly (readonly number[])[], filters: readonly number[]): number[][] {
  const previous = Array.from({ length: pixels[0]!.length }, () => 0);
  return pixels.map((target, y) => {
    const filter = filters[y]!;
    const encoded = target.map((value, index) => {
      const left = index >= 4 ? target[index - 4]! : 0;
      const up = previous[index]!;
      const upperLeft = index >= 4 ? previous[index - 4]! : 0;
      let prediction = 0;
      if (filter === 1) prediction = left;
      else if (filter === 2) prediction = up;
      else if (filter === 3) prediction = Math.floor((left + up) / 2);
      else if (filter === 4) prediction = testPaeth(left, up, upperLeft);
      return (value - prediction + 256) & 0xff;
    });
    previous.splice(0, previous.length, ...target);
    return [filter, ...encoded];
  });
}

function testPaeth(left: number, up: number, upperLeft: number): number {
  const guess = left + up - upperLeft;
  const dl = Math.abs(guess - left);
  const du = Math.abs(guess - up);
  const dul = Math.abs(guess - upperLeft);
  return dl <= du && dl <= dul ? left : du <= dul ? up : upperLeft;
}

function adam7RgbaPng(): Buffer {
  const width = 5;
  const height = 5;
  const rows = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => [
    20 + x, 40 + y, 60, x === 4 && y === 2 ? 0 : 255
  ]));
  const starts = [[0, 0], [4, 0], [0, 4], [2, 0], [0, 2], [1, 0], [0, 1]] as const;
  const steps = [[8, 8], [8, 8], [4, 8], [4, 4], [2, 4], [2, 2], [1, 2]] as const;
  const scanlines: number[] = [];
  for (let pass = 0; pass < starts.length; pass += 1) {
    const [xStart, yStart] = starts[pass]!;
    const [xStep, yStep] = steps[pass]!;
    for (let y = yStart; y < height; y += yStep) {
      scanlines.push(0);
      for (let x = xStart; x < width; x += xStep) scanlines.push(...rows[y]![x]!);
    }
  }
  return png(width, height, 8, 6, 1, [scanlines]);
}

test("decodes literal RGBA alpha and returns only a bounded, non-ownership summary", () => {
  const bytes = rgbaPng(1, 1, [[0, 12, 34, 56, 0]]);
  const summary = inspectOwnerPngAlpha(bytes);
  assert.deepEqual(summary, {
    width: 1,
    height: 1,
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    has_transparent_pixels: true,
    validation_confidence: "PNG_DECODED_PIXEL_ALPHA",
    browser_sampling_verified: false
  });
});

test("decodes each legal PNG colour type and bit depth, including tRNS transparency", () => {
  const cases: Array<{ name: string; bytes: Buffer; transparent: boolean }> = [
    { name: "gray-1", bytes: png(1, 1, 1, 0, 0, [[0, 0x80]], [{ type: "tRNS", data: [0, 1] }]), transparent: true },
    { name: "gray-2", bytes: png(1, 1, 2, 0, 0, [[0, 0x80]], [{ type: "tRNS", data: [0, 2] }]), transparent: true },
    { name: "gray-4", bytes: png(1, 1, 4, 0, 0, [[0, 0x30]], [{ type: "tRNS", data: [0, 3] }]), transparent: true },
    { name: "gray-8", bytes: png(1, 1, 8, 0, 0, [[0, 0x7f]], [{ type: "tRNS", data: [0, 0x7f] }]), transparent: true },
    { name: "gray-16", bytes: png(1, 1, 16, 0, 0, [[0, 0x12, 0x34]], [{ type: "tRNS", data: [0x12, 0x34] }]), transparent: true },
    { name: "rgb-8", bytes: png(1, 1, 8, 2, 0, [[0, 10, 20, 30]], [{ type: "tRNS", data: [0, 10, 0, 20, 0, 30] }]), transparent: true },
    { name: "rgb-16", bytes: png(1, 1, 16, 2, 0, [[0, 0, 1, 0, 2, 0, 3]], [{ type: "tRNS", data: [0, 1, 0, 2, 0, 3] }]), transparent: true },
    { name: "palette-1", bytes: png(1, 1, 1, 3, 0, [[0, 0x80]], [{ type: "PLTE", data: [0, 0, 0, 255, 255, 255] }, { type: "tRNS", data: [255, 0] }]), transparent: true },
    { name: "palette-2", bytes: png(1, 1, 2, 3, 0, [[0, 0x40]], [{ type: "PLTE", data: [0, 0, 0, 255, 255, 255] }, { type: "tRNS", data: [255, 0] }]), transparent: true },
    { name: "palette-4", bytes: png(1, 1, 4, 3, 0, [[0, 0x10]], [{ type: "PLTE", data: [0, 0, 0, 255, 255, 255] }, { type: "tRNS", data: [255, 0] }]), transparent: true },
    { name: "palette-8", bytes: png(1, 1, 8, 3, 0, [[0, 1]], [{ type: "PLTE", data: [0, 0, 0, 255, 255, 255] }, { type: "tRNS", data: [255, 0] }]), transparent: true },
    { name: "gray-alpha-8", bytes: png(1, 1, 8, 4, 0, [[0, 90, 1]]), transparent: true },
    { name: "gray-alpha-16", bytes: png(1, 1, 16, 4, 0, [[0, 0, 90, 0x7f, 0xff]]), transparent: true },
    { name: "rgba-8", bytes: png(1, 1, 8, 6, 0, [[0, 1, 2, 3, 254]]), transparent: true },
    { name: "rgba-16", bytes: png(1, 1, 16, 6, 0, [[0, 0, 1, 0, 2, 0, 3, 0x12, 0x34]]), transparent: true }
  ];
  for (const fixture of cases) {
    try {
      assert.equal(inspectOwnerPngAlpha(fixture.bytes).has_transparent_pixels, fixture.transparent, fixture.name);
    } catch (error) {
      assert.fail(`${fixture.name}: ${String(error)}`);
    }
  }
  const opaquePalette = png(1, 1, 1, 3, 0, [[0, 0x00]], [{ type: "PLTE", data: [255, 0, 0] }, { type: "tRNS", data: [255] }]);
  assert.equal(inspectOwnerPngAlpha(opaquePalette).has_transparent_pixels, false, "palette alpha is 8-bit even for 1-bit indices");
});

test("reconstructs all five PNG filters and decodes pixels across Adam7 passes", () => {
  const pixels = [
    [1, 2, 3, 255, 4, 5, 6, 255],
    [10, 20, 30, 255, 40, 50, 60, 0],
    [11, 21, 31, 255, 41, 51, 61, 1],
    [1, 2, 3, 255, 7, 8, 9, 0],
    [5, 6, 7, 255, 9, 10, 11, 255]
  ];
  const filtered = png(2, 5, 8, 6, 0, filteredRows(pixels, [0, 1, 2, 3, 4]));
  assert.equal(inspectOwnerPngAlpha(filtered).has_transparent_pixels, true, "literal alpha rows include 0 and partial alpha");
  assert.equal(inspectOwnerPngAlpha(adam7RgbaPng()).has_transparent_pixels, true, "pixel at Adam7 coordinate (4,2) has alpha 0");
});

test("rejects corrupt CRC, nonconsecutive IDAT, trailing bytes, APNG, and unknown critical chunks", () => {
  const good = rgbaPng(1, 1, [[0, 1, 2, 3, 0]]);
  const badCrc = Buffer.from(good);
  const idatType = badCrc.indexOf(Buffer.from("IDAT"));
  const idatLength = badCrc.readUInt32BE(idatType - 4);
  badCrc[idatType + 4 + idatLength]! ^= 1;
  assert.throws(() => inspectOwnerPngAlpha(badCrc), { code: "INVALID_PNG_CONTAINER" });

  const compressed = deflateSync(Buffer.from([0, 1, 2, 3, 0]));
  const splitIdat = rawPng(1, 1, 8, 6, 0, [
    { type: "IDAT", data: compressed.subarray(0, 2) },
    { type: "IDAT", data: compressed.subarray(2) }
  ]);
  assert.equal(inspectOwnerPngAlpha(splitIdat).has_transparent_pixels, true, "IDAT boundaries may split the zlib stream");
  const split = rawPng(1, 1, 8, 6, 0, [
    { type: "IDAT", data: compressed.subarray(0, 2) },
    { type: "tEXt", data: Buffer.from([65, 0, 66]) },
    { type: "IDAT", data: compressed.subarray(2) }
  ]);
  assert.throws(() => inspectOwnerPngAlpha(split), { code: "INVALID_PNG_CONTAINER" });
  assert.throws(() => inspectOwnerPngAlpha(Buffer.concat([good, Buffer.from([0])])), { code: "INVALID_PNG_CONTAINER" });
  assert.throws(() => inspectOwnerPngAlpha(png(1, 1, 8, 6, 0, [[0, 1, 2, 3, 0]], [{ type: "acTL", data: [0, 0, 0, 1] }])),
    { code: "UNSUPPORTED_PNG_COMPOSITION" });
  const unknownCritical = rawPng(1, 1, 8, 6, 0, [
    { type: "ABCD", data: Buffer.from([1]) },
    { type: "IDAT", data: compressed }
  ]);
  assert.throws(() => inspectOwnerPngAlpha(unknownCritical), { code: "UNSUPPORTED_PNG_COMPOSITION" });
});

test("bounds declared dimensions and zlib output to the exact decoded scanline size", () => {
  assert.throws(() => inspectOwnerPngAlpha(Buffer.alloc(32 * 1024 * 1024 + 1)), { code: "PNG_RESOURCE_LIMIT" });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(6_001, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const oversized = Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(Buffer.from([0]))), pngChunk("IEND", Buffer.alloc(0))]);
  assert.throws(() => inspectOwnerPngAlpha(oversized), { code: "PNG_RESOURCE_LIMIT" });

  const bomb = rawPng(1, 1, 8, 6, 0, [
    { type: "IDAT", data: deflateSync(Buffer.alloc(1_000_000)) }
  ]);
  assert.throws(() => inspectOwnerPngAlpha(bomb), { code: "PNG_RESOURCE_LIMIT" });
});

test("rejects untrusted byte objects, malformed filters, invalid transparency keys, and trailing zlib data", () => {
  const good = rgbaPng(1, 1, [[0, 1, 2, 3, 255]]);
  assert.throws(() => inspectOwnerPngAlpha(new Proxy(good, {})), { code: "INVALID_PNG_CONTAINER" });
  class ByteSubclass extends Uint8Array {}
  assert.throws(() => inspectOwnerPngAlpha(new ByteSubclass(good)), { code: "INVALID_PNG_CONTAINER" });

  const invalidFilter = rgbaPng(1, 1, [[5, 1, 2, 3, 255]]);
  assert.throws(() => inspectOwnerPngAlpha(invalidFilter), { code: "INVALID_PNG_CONTAINER" });
  const invalidGrayKey = png(1, 1, 8, 0, 0, [[0, 1]], [{ type: "tRNS", data: [1, 0] }]);
  assert.throws(() => inspectOwnerPngAlpha(invalidGrayKey), { code: "INVALID_PNG_CONTAINER" });

  const compressedWithTail = Buffer.concat([deflateSync(Buffer.from([0, 1, 2, 3, 255])), Buffer.from([0xde, 0xad])]);
  const zlibTail = rawPng(1, 1, 8, 6, 0, [{ type: "IDAT", data: compressedWithTail }]);
  assert.throws(() => inspectOwnerPngAlpha(zlibTail), { code: "INVALID_PNG_CONTAINER" });
});
