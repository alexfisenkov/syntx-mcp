import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import test from "node:test";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(bytes: Buffer): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb8_8320 : 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function rgba8Png(width: number, height: number, rows: readonly (readonly number[])[], beforeData: readonly { type: string; data: Buffer }[] = []): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const scanlines = rows.flatMap((row) => [0, ...row]);
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), ...beforeData.map((item) => chunk(item.type, item.data)),
    chunk("IDAT", deflateSync(Buffer.from(scanlines))), chunk("IEND", Buffer.alloc(0))]);
}

function rgba16Png(alphas: readonly number[]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(alphas.length, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 16;
  ihdr[9] = 6;
  const raw = [0];
  for (const alpha of alphas) raw.push(0, 1, 0, 2, 0, 3, alpha >> 8, alpha & 0xff);
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from(raw))), chunk("IEND", Buffer.alloc(0))]);
}

function pngFixture(width: number, height: number, bitDepth: number, colorType: number, scanline: readonly number[],
  beforeData: readonly { type: string; data: Buffer }[] = []): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), ...beforeData.map((item) => chunk(item.type, item.data)),
    chunk("IDAT", deflateSync(Buffer.from(scanline))), chunk("IEND", Buffer.alloc(0))]);
}

test("PNG inspector exposes a bounded source-canvas alpha projection", async () => {
  const inspector = await import("../src/application/owner-png-alpha-inspector.js") as Record<string, unknown>;
  assert.equal(typeof inspector.inspectOwnerPngSourceCanvasAlpha, "function");
  const project = inspector.inspectOwnerPngSourceCanvasAlpha as (bytes: Uint8Array) => Record<string, unknown>;
  const projection = project(rgba8Png(1, 1, [[1, 2, 3, 128]]));
  assert.equal(projection.width, 1);
  assert.equal(projection.height, 1);
  assert.match(projection.sha256 as string, /^sha256:[a-f0-9]{64}$/);
  assert.equal(projection.source_sample_width, 1);
  assert.equal(projection.source_sample_height, 1);
  assert.equal(projection.source_alpha_eligible, true);
  assert.equal(projection.confidence_scope, "SOURCE_CANVAS_ALPHA8_NEAREST_SAMPLED");
});

test("source alpha follows rounded max-1024 Canvas samples instead of all source pixels", async () => {
  const inspector = await import("../src/application/owner-png-alpha-inspector.js") as Record<string, unknown>;
  const project = inspector.inspectOwnerPngSourceCanvasAlpha as (bytes: Uint8Array) => Record<string, unknown>;
  const width = 2_049;
  const opaque = Array.from({ length: width }, () => [4, 5, 6, 255]);
  opaque[0] = [4, 5, 6, 0];
  const missed = project(rgba8Png(width, 1, [opaque.flat()]));
  assert.equal(missed.source_sample_width, 1_024);
  assert.equal(missed.source_sample_height, 1);
  assert.equal(missed.source_alpha_eligible, false, "source coordinate 0 is outside the browser's nearest-sampled grid");

  opaque[0] = [4, 5, 6, 255];
  opaque[1] = [4, 5, 6, 0];
  const sampled = project(rgba8Png(width, 1, [opaque.flat()]));
  assert.equal(sampled.source_alpha_eligible, true, "source coordinate 1 maps to the first output pixel center");

  const shortSideRows = [
    Array.from({ length: width }, () => [4, 5, 6, 255]),
    Array.from({ length: width }, () => [4, 5, 6, 255]),
    Array.from({ length: width }, () => [4, 5, 6, 255])
  ];
  shortSideRows[0]![1] = [4, 5, 6, 0];
  assert.equal(project(rgba8Png(width, 3, shortSideRows.map((row) => row.flat()))).source_alpha_eligible, false,
    "source row 0 is outside the rounded one-pixel short-side sample");
  shortSideRows[0]![1] = [4, 5, 6, 255];
  shortSideRows[1]![1] = [4, 5, 6, 0];
  assert.equal(project(rgba8Png(width, 3, shortSideRows.map((row) => row.flat()))).source_alpha_eligible, true,
    "the short-side sample center selects source row 1");
  shortSideRows[1]![1] = [4, 5, 6, 255];
  shortSideRows[2]![1] = [4, 5, 6, 0];
  assert.equal(project(rgba8Png(width, 3, shortSideRows.map((row) => row.flat()))).source_alpha_eligible, false,
    "source row 2 is beyond the short-side nearest sample");
});

test("16-bit PNG alpha is rounded into Canvas alpha8 before the transparency check", async () => {
  const inspector = await import("../src/application/owner-png-alpha-inspector.js") as Record<string, unknown>;
  const project = inspector.inspectOwnerPngSourceCanvasAlpha as (bytes: Uint8Array) => Record<string, unknown>;
  assert.equal(project(rgba16Png([0xffff])).source_alpha_eligible, false);
  assert.equal(project(rgba16Png([0xfffe])).source_alpha_eligible, false, "0xFFFE becomes Canvas alpha8 255");
  assert.equal(project(rgba16Png([0xff80])).source_alpha_eligible, false, "0xFF80 rounds to Canvas alpha8 255");
  assert.equal(project(rgba16Png([0xfeff])).source_alpha_eligible, true, "0xFEFF becomes Canvas alpha8 254");
  assert.equal(project(rgba16Png([0x8080])).source_alpha_eligible, true);
});

test("source-canvas alpha projection handles every PNG alpha and tRNS representation", async () => {
  const inspector = await import("../src/application/owner-png-alpha-inspector.js") as Record<string, unknown>;
  const project = inspector.inspectOwnerPngSourceCanvasAlpha as (bytes: Uint8Array) => Record<string, unknown>;
  const transparentCases: Array<{ name: string; bytes: Buffer }> = [
    { name: "gray-1-tRNS", bytes: pngFixture(1, 1, 1, 0, [0, 0x80], [{ type: "tRNS", data: Buffer.from([0, 1]) }]) },
    { name: "gray-2-tRNS", bytes: pngFixture(1, 1, 2, 0, [0, 0x80], [{ type: "tRNS", data: Buffer.from([0, 2]) }]) },
    { name: "gray-4-tRNS", bytes: pngFixture(1, 1, 4, 0, [0, 0x30], [{ type: "tRNS", data: Buffer.from([0, 3]) }]) },
    { name: "gray-8-tRNS", bytes: pngFixture(1, 1, 8, 0, [0, 0x7f], [{ type: "tRNS", data: Buffer.from([0, 0x7f]) }]) },
    { name: "gray-16-tRNS", bytes: pngFixture(1, 1, 16, 0, [0, 0x12, 0x34], [{ type: "tRNS", data: Buffer.from([0x12, 0x34]) }]) },
    { name: "rgb-8-tRNS", bytes: pngFixture(1, 1, 8, 2, [0, 10, 20, 30], [{ type: "tRNS", data: Buffer.from([0, 10, 0, 20, 0, 30]) }]) },
    { name: "rgb-16-tRNS", bytes: pngFixture(1, 1, 16, 2, [0, 0, 1, 0, 2, 0, 3], [{ type: "tRNS", data: Buffer.from([0, 1, 0, 2, 0, 3]) }]) },
    { name: "palette-1-tRNS", bytes: pngFixture(1, 1, 1, 3, [0, 0x80], [{ type: "PLTE", data: Buffer.from([0, 0, 0, 255, 255, 255]) }, { type: "tRNS", data: Buffer.from([255, 0]) }]) },
    { name: "palette-2-tRNS", bytes: pngFixture(1, 1, 2, 3, [0, 0x40], [{ type: "PLTE", data: Buffer.from([0, 0, 0, 255, 255, 255]) }, { type: "tRNS", data: Buffer.from([255, 0]) }]) },
    { name: "palette-4-tRNS", bytes: pngFixture(1, 1, 4, 3, [0, 0x10], [{ type: "PLTE", data: Buffer.from([0, 0, 0, 255, 255, 255]) }, { type: "tRNS", data: Buffer.from([255, 0]) }]) },
    { name: "palette-8-tRNS", bytes: pngFixture(1, 1, 8, 3, [0, 1], [{ type: "PLTE", data: Buffer.from([0, 0, 0, 255, 255, 255]) }, { type: "tRNS", data: Buffer.from([255, 0]) }]) },
    { name: "gray-alpha-8", bytes: pngFixture(1, 1, 8, 4, [0, 90, 1]) },
    { name: "gray-alpha-16", bytes: pngFixture(1, 1, 16, 4, [0, 0, 90, 0x7f, 0xff]) },
    { name: "rgba-8", bytes: rgba8Png(1, 1, [[1, 2, 3, 254]]) },
    { name: "rgba-16", bytes: rgba16Png([0x1234]) }
  ];
  for (const fixture of transparentCases) {
    assert.equal(project(fixture.bytes).source_alpha_eligible, true, fixture.name);
  }
  const opaquePalette = pngFixture(1, 1, 1, 3, [0, 0x00], [
    { type: "PLTE", data: Buffer.from([255, 0, 0]) }, { type: "tRNS", data: Buffer.from([255]) }
  ]);
  assert.equal(project(opaquePalette).source_alpha_eligible, false, "palette alpha entries are 8-bit, independent of index depth");
});

test("PNG EXIF orientation metadata is explicitly unsupported for source-canvas eligibility", async () => {
  const inspector = await import("../src/application/owner-png-alpha-inspector.js") as Record<string, unknown>;
  const project = inspector.inspectOwnerPngSourceCanvasAlpha as (bytes: Uint8Array) => Record<string, unknown>;
  const withExif = rgba8Png(1, 1, [[1, 2, 3, 0]], [{ type: "eXIf", data: Buffer.from([0, 0]) }]);
  assert.throws(() => project(withExif), { code: "UNSUPPORTED_PNG_COMPOSITION" });
});

test("Seedream source-alpha witness is opaque, frozen, and bound to exact decoded bytes", async () => {
  const witnessModulePath = "../src/application/owner-seedream-source-alpha-witness.js";
  const api = await import(witnessModulePath) as Record<string, unknown>;
  assert.equal(typeof api.createOwnerSeedreamSourceAlphaWitness, "function");
  assert.equal(typeof api.snapshotOwnerSeedreamSourceAlphaWitness, "function");
  const bytes = rgba8Png(1, 1, [[1, 2, 3, 128]]);
  const witness = (api.createOwnerSeedreamSourceAlphaWitness as (source: Uint8Array) => object)(bytes);
  assert.equal(Object.isFrozen(witness), true);
  assert.deepEqual(Reflect.ownKeys(witness), []);
  const snapshot = (api.snapshotOwnerSeedreamSourceAlphaWitness as (token: object, metadata: object) => object)(witness, {
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    width: 1,
    height: 1
  });
  assert.deepEqual(snapshot, {
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    width: 1,
    height: 1,
    source_sample_width: 1,
    source_sample_height: 1,
    source_alpha_eligible: true,
    confidence_scope: "SOURCE_CANVAS_ALPHA8_NEAREST_SAMPLED"
  });
});

test("Seedream source-alpha witness rejects clones and caller metadata that disagrees with the PNG", async () => {
  const api = await import("../src/application/owner-seedream-source-alpha-witness.js") as Record<string, unknown>;
  const make = api.createOwnerSeedreamSourceAlphaWitness as (source: Uint8Array) => object;
  const snapshot = api.snapshotOwnerSeedreamSourceAlphaWitness as (token: object, metadata: object) => object;
  const bytes = rgba8Png(1, 1, [[1, 2, 3, 128]]);
  const witness = make(bytes);
  const metadata = { sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, width: 1, height: 1 };
  assert.throws(() => snapshot({}, metadata), { code: "INVALID_SOURCE_ALPHA_WITNESS" });
  assert.throws(() => snapshot(Object.freeze(Object.create(null)) as object, metadata), { code: "INVALID_SOURCE_ALPHA_WITNESS" });
  assert.throws(() => snapshot(witness, { ...metadata, sha256: `sha256:${"0".repeat(64)}` }), { code: "SOURCE_ALPHA_WITNESS_MISMATCH" });
  assert.throws(() => snapshot(witness, { ...metadata, width: 2 }), { code: "SOURCE_ALPHA_WITNESS_MISMATCH" });
  assert.throws(() => snapshot(witness, { ...metadata, height: 2 }), { code: "SOURCE_ALPHA_WITNESS_MISMATCH" });
});
