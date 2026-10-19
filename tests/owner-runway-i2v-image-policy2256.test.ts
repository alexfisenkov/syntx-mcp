import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import test from "node:test";
import {
  OwnerRunwayI2vImagePolicyError,
  readValidatedOwnerRunwayI2vImageUpload,
  releaseValidatedOwnerRunwayI2vImageUpload,
  validateOwnerRunwayI2vImageUpload
} from "../src/application/owner-runway-i2v-image-policy.js";

const RATIOS = [
  ["21:9", 21, 9], ["16:9", 16, 9], ["4:3", 4, 3],
  ["1:1", 1, 1], ["3:4", 3, 4], ["9:16", 9, 16]
] as const;

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u32(value: number): Buffer {
  const result = Buffer.alloc(4);
  result.writeUInt32BE(value);
  return result;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, "ascii");
  const body = Buffer.concat([name, data]);
  return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
}

function png(width: number, height: number): Uint8Array {
  const ihdr = Buffer.concat([u32(width), u32(height), Buffer.from([8, 6, 0, 0, 0])]);
  const row = Buffer.alloc(1 + width * 4);
  return new Uint8Array(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    pngChunk("IEND", Buffer.alloc(0))
  ]));
}

function input(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    model_id: "4genfirstframeimage",
    aspect_ratio: "16:9",
    filename: "first-frame.png",
    mime_type: "image/png",
    bytes: png(16, 9),
    ...overrides
  };
}

function withCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof OwnerRunwayI2vImagePolicyError &&
    (error as OwnerRunwayI2vImagePolicyError).code === code;
}

test("binds exact pre-cropped geometry to each allowed model and ratio while preserving a private byte snapshot", () => {
  for (const model_id of ["4genfirstframeimage", "turbo4genfirstframeimage"] as const) {
    for (const [aspect_ratio, width, height] of RATIOS) {
      const source = png(width, height);
      const receipt = validateOwnerRunwayI2vImageUpload(input({ model_id, aspect_ratio, bytes: source }));
      source.fill(0);
      const copy = readValidatedOwnerRunwayI2vImageUpload(receipt);
      assert.ok(copy);
      assert.equal(receipt.model_id, model_id);
      assert.equal(receipt.aspect_ratio, aspect_ratio);
      assert.equal(receipt.width, width);
      assert.equal(receipt.height, height);
      assert.equal(receipt.mime_type, "image/png");
      assert.equal(copy.size, copy.bytes.byteLength);
      assert.equal(releaseValidatedOwnerRunwayI2vImageUpload(receipt), true);
    }
  }
});

test("rejects forged receipts and does not let consumer byte copies mutate the private snapshot", () => {
  const receipt = validateOwnerRunwayI2vImageUpload(input());
  const first = readValidatedOwnerRunwayI2vImageUpload(receipt);
  assert.ok(first);
  const expected = Buffer.from(first.bytes);
  first.bytes.fill(0);
  const second = readValidatedOwnerRunwayI2vImageUpload(receipt);
  assert.ok(second);
  assert.deepEqual(Buffer.from(second.bytes), expected);
  assert.equal(readValidatedOwnerRunwayI2vImageUpload({ ...receipt }), null);
  assert.equal(readValidatedOwnerRunwayI2vImageUpload(Object.create(receipt)), null);
  assert.equal(releaseValidatedOwnerRunwayI2vImageUpload({ ...receipt }), false);
  assert.equal(releaseValidatedOwnerRunwayI2vImageUpload(receipt), true);
  assert.equal(readValidatedOwnerRunwayI2vImageUpload(receipt), null);
  assert.equal(releaseValidatedOwnerRunwayI2vImageUpload(receipt), false);
});

test("rejects wrong model or crop ratio, MIME mismatch, unsupported AVIF, and malformed records", () => {
  for (const invalid of [
    input({ model_id: "gen4.5i2v" }), input({ aspect_ratio: "2:1" }), input({ bytes: png(4, 3) }),
    input({ mime_type: "image/jpeg" }), input({ mime_type: "image/avif", filename: "frame.avif" }),
    input({ filename: "../frame.png" }), input({ filename: "frame\u0000.png" }), input({ extra: true })
  ]) assert.throws(() => validateOwnerRunwayI2vImageUpload(invalid), withCode("INVALID_IMAGE_INPUT"));

  const accessor = input();
  Object.defineProperty(accessor, "aspect_ratio", { enumerable: true, get: () => "16:9" });
  assert.throws(() => validateOwnerRunwayI2vImageUpload(accessor), withCode("INVALID_IMAGE_INPUT"));
  assert.throws(() => validateOwnerRunwayI2vImageUpload(new Proxy(input(), {})), withCode("INVALID_IMAGE_INPUT"));
});

test("enforces the local byte ceiling before container inspection and rejects invalid dimensions", () => {
  assert.throws(() => validateOwnerRunwayI2vImageUpload(input({ bytes: new Uint8Array(10 * 1024 * 1024 + 1) })),
    withCode("LOCAL_RESOURCE_LIMIT_EXCEEDED"));
  assert.throws(() => validateOwnerRunwayI2vImageUpload(input({ bytes: png(0, 9) })), withCode("INVALID_IMAGE_INPUT"));
});
