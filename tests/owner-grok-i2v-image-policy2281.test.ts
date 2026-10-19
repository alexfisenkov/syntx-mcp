import assert from "node:assert/strict";
import test from "node:test";
import {
  OWNER_GROK_I2V_IMAGE_POLICY,
  OwnerGrokI2vImagePolicyError,
  readValidatedOwnerGrokI2vImageUpload,
  releaseValidatedOwnerGrokI2vImageUpload,
  validateOwnerGrokI2vImageUpload
} from "../src/application/owner-grok-i2v-image-policy.js";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function png(width: number, height: number): Buffer {
  const base = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  base.writeUInt32BE(width, 16); base.writeUInt32BE(height, 20); base.writeUInt32BE(crc32(base.subarray(12, 29)), 29); return base;
}
function jpeg(width: number, height: number): Buffer {
  return Buffer.from([0xff,0xd8,0xff,0xc0,0,0x0b,8,height >> 8,height & 0xff,width >> 8,width & 0xff,1,1,0x11,0,
    0xff,0xda,0,8,1,1,0,0,0x3f,0,0,0xff,0xd9]);
}
function webp(width: number, height: number): Buffer {
  const chunk = Buffer.alloc(18); chunk.write("VP8 ", 0, 4, "ascii"); chunk.writeUInt32LE(10, 4);
  chunk[11] = 0x9d; chunk[12] = 0x01; chunk[13] = 0x2a; chunk.writeUInt16LE(width, 14); chunk.writeUInt16LE(height, 16);
  const out = Buffer.alloc(12 + chunk.length); out.write("RIFF", 0, 4, "ascii"); out.writeUInt32LE(out.length - 8, 4);
  out.write("WEBP", 8, 4, "ascii"); chunk.copy(out, 12); return out;
}
const invalid = (code = "INVALID_IMAGE_INPUT") => (error: unknown) =>
  error instanceof OwnerGrokI2vImagePolicyError && error.code === code;
const input = (model_id: string, bytes: Uint8Array, mime_type: string, filename = "frame.bin") => ({ model_id, bytes, mime_type, filename });

test("2281 accepts source-proven JPEG, PNG and WebP, canonicalizes JPEG, and holds a private copy", () => {
  for (const [bytes, mime_type, canonical] of [[jpeg(160, 90), "image/jpeg", "image/jpeg"],
    [png(160, 90), "image/png", "image/png"], [webp(160, 90), "image/webp", "image/webp"]] as const) {
    const source = Buffer.from(bytes);
    const receipt = validateOwnerGrokI2vImageUpload(input("grok_i2v", source, mime_type));
    source.fill(0);
    const copy = readValidatedOwnerGrokI2vImageUpload(receipt);
    assert.ok(copy); assert.equal(receipt.model_id, "grok_i2v"); assert.equal(receipt.mime_type, canonical);
    assert.equal(receipt.width, 160); assert.equal(receipt.height, 90); assert.deepEqual(Buffer.from(copy.bytes), bytes);
    copy.bytes.fill(0); assert.deepEqual(Buffer.from(readValidatedOwnerGrokI2vImageUpload(receipt)!.bytes), bytes);
    assert.equal(releaseValidatedOwnerGrokI2vImageUpload(receipt), true);
    assert.equal(readValidatedOwnerGrokI2vImageUpload(receipt), null);
  }
});

test("2281 keeps legacy Grok I2V input geometry 16:9 while new Grok 1.5 accepts bounded geometry", () => {
  const legacy = validateOwnerGrokI2vImageUpload(input("grok_i2v", png(160, 90), "image/png"));
  const square = validateOwnerGrokI2vImageUpload(input("grok_15_i2v", png(90, 90), "image/png"));
  assert.equal(legacy.width, 160); assert.equal(legacy.height, 90); assert.equal(square.width, 90); assert.equal(square.height, 90);
  assert.equal("aspect_ratio" in legacy, false); assert.equal("aspect_ratio" in OWNER_GROK_I2V_IMAGE_POLICY, false);
  releaseValidatedOwnerGrokI2vImageUpload(legacy); releaseValidatedOwnerGrokI2vImageUpload(square);
  assert.throws(() => validateOwnerGrokI2vImageUpload(input("grok_i2v", png(90, 90), "image/png")), invalid());
  assert.throws(() => validateOwnerGrokI2vImageUpload({ ...input("grok_15_i2v", png(90, 90), "image/png"), aspect_ratio: "1:1" }), invalid());
});

test("2281 rejects unsupported models, unsafe names, MIME spoofing and malformed bytes", () => {
  assert.throws(() => validateOwnerGrokI2vImageUpload(input("grok_video", png(160, 90), "image/png")), invalid());
  assert.throws(() => validateOwnerGrokI2vImageUpload(input("grok_i2v", png(160, 90), "image/jpeg")), invalid());
  for (const filename of ["../frame.png", "a\\b.png", "bad\u0000.png", "\ud800.png", "x".repeat(256)]) {
    assert.throws(() => validateOwnerGrokI2vImageUpload(input("grok_i2v", png(160, 90), "image/png", filename)), invalid());
  }
  assert.throws(() => validateOwnerGrokI2vImageUpload(input("grok_15_i2v", png(160, 90), "image/avif")), invalid());
  assert.throws(() => validateOwnerGrokI2vImageUpload(input("grok_15_i2v", new Uint8Array(10 * 1024 * 1024 + 1), "image/png")), invalid("LOCAL_RESOURCE_LIMIT_EXCEEDED"));
  assert.equal(OWNER_GROK_I2V_IMAGE_POLICY.local_max_bytes.grok_i2v, 20 * 1024 * 1024);
  assert.equal(OWNER_GROK_I2V_IMAGE_POLICY.local_max_bytes.grok_15_i2v, 10 * 1024 * 1024);
});
