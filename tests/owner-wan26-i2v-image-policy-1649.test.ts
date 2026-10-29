import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  OWNER_WAN26_I2V_IMAGE_POLICY,
  OwnerWan26I2vImagePolicyError,
  isValidatedOwnerWan26I2vImage,
  readValidatedOwnerWan26I2vImage,
  releaseValidatedOwnerWan26I2vImage,
  validateOwnerWan26I2vImage
} from "../src/application/owner-wan26-i2v-image-policy.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function png(width: number, height: number): Buffer {
  const bytes = Buffer.from(PNG); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}
function jpeg(width: number, height: number): Buffer {
  return Buffer.from([0xff,0xd8,0xff,0xc0,0,0x0b,8,height >> 8,height & 0xff,width >> 8,width & 0xff,1,1,0x11,0,
    0xff,0xda,0,8,1,1,0,0,0x3f,0,0,0xff,0xd9]);
}
function bmp(width: number, height: number): Buffer {
  const stride = Math.ceil(width * 24 / 32) * 4, pixelLength = stride * height, bytes = Buffer.alloc(54 + pixelLength);
  bytes.write("BM", 0, "ascii"); bytes.writeUInt32LE(bytes.byteLength, 2); bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14); bytes.writeInt32LE(width, 18); bytes.writeInt32LE(height, 22); bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28); bytes.writeUInt32LE(pixelLength, 34); return bytes;
}
function webp(width: number, height: number): Buffer {
  const chunk = Buffer.alloc(18); chunk.write("VP8 ", 0, 4, "ascii"); chunk.writeUInt32LE(10, 4);
  chunk[11] = 0x9d; chunk[12] = 0x01; chunk[13] = 0x2a; chunk.writeUInt16LE(width, 14); chunk.writeUInt16LE(height, 16);
  const out = Buffer.alloc(12 + chunk.length); out.write("RIFF", 0, 4, "ascii"); out.writeUInt32LE(out.length - 8, 4);
  out.write("WEBP", 8, 4, "ascii"); chunk.copy(out, 12); return out;
}
const input = (model_id: string, bytes: Uint8Array, mime_type: string, filename = "кадр.input") => ({ model_id, filename, mime_type, bytes });
const invalid = (error: unknown) => error instanceof OwnerWan26I2vImagePolicyError && error.code === "INVALID_IMAGE_INPUT";

test("pins both WAN 2.6 I2V IDs and historical B066 bounds as local guards", () => {
  assert.deepEqual(OWNER_WAN26_I2V_IMAGE_POLICY.model_ids, ["wan_26_i2v", "wan_26_i2v_flash"]);
  assert.equal(OWNER_WAN26_I2V_IMAGE_POLICY.public_catalog_version,
    "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json");
  assert.equal(OWNER_WAN26_I2V_IMAGE_POLICY.public_catalog_fetched_at, "2026-10-12T17:09:37.867Z");
  assert.deepEqual(OWNER_WAN26_I2V_IMAGE_POLICY.source_mime_types, ["image/jpg", "image/jpeg", "image/png", "image/bmp", "image/webp"]);
  assert.equal(OWNER_WAN26_I2V_IMAGE_POLICY.max_file_size_bytes, 10 * 1024 * 1024);
  assert.equal(OWNER_WAN26_I2V_IMAGE_POLICY.min_side, 384); assert.equal(OWNER_WAN26_I2V_IMAGE_POLICY.max_side, 5_000);
  assert.equal(OWNER_WAN26_I2V_IMAGE_POLICY.current_public_max_side, 8_000);
  assert.equal(OWNER_WAN26_I2V_IMAGE_POLICY.max_prompt_length, 1_500);
  assert.equal(OWNER_WAN26_I2V_IMAGE_POLICY.limits_policy,
    "PINNED_B066_CATALOG_LOCAL_GUARD_NOT_CURRENT_METADATA_OR_PROVIDER_ACCEPTANCE");
  assert.equal(OWNER_WAN26_I2V_IMAGE_POLICY.generation_permit, false);
  assert.equal(OWNER_WAN26_I2V_IMAGE_POLICY.owner_upload_binding, "NOT_ESTABLISHED");
});

test("accepts one 384px PNG and the JPEG JPG alias for each exact model ID", () => {
  for (const model of OWNER_WAN26_I2V_IMAGE_POLICY.model_ids) {
    for (const [bytes, mime, extension] of [[png(384, 384), "image/png", ".png"], [jpeg(384, 384), "image/jpg", ".jpg"]] as const) {
      const receipt = validateOwnerWan26I2vImage(input(model, bytes, mime));
      assert.equal(receipt.model_id, model); assert.equal(receipt.status, "LOCAL_SOURCE_VALIDATED");
      assert.equal(receipt.filename, `кадр${extension}`); assert.equal(receipt.width, 384); assert.equal(receipt.height, 384);
      assert.equal(receipt.mime_type, mime === "image/jpg" ? "image/jpeg" : mime);
      assert.equal(receipt.sha256, createHash("sha256").update(bytes).digest("hex"));
      assert.equal(receipt.generation_permit, false); assert.equal(receipt.owner_upload_binding, "NOT_ESTABLISHED");
      assert.equal(isValidatedOwnerWan26I2vImage(receipt), true); assert.equal(releaseValidatedOwnerWan26I2vImage(receipt), true);
    }
  }
});

test("structurally inspects all pinned formats and enforces inclusive side bounds", () => {
  const formats = [[jpeg(384, 384), "image/jpeg"], [png(384, 384), "image/png"], [bmp(384, 384), "image/bmp"], [webp(384, 384), "image/webp"]] as const;
  for (const [bytes, mime] of formats) {
    const receipt = validateOwnerWan26I2vImage(input("wan_26_i2v", bytes, mime, "scene.old"));
    assert.equal(receipt.width, 384); assert.equal(receipt.height, 384);
    assert.equal(receipt.filename, `scene.${mime === "image/jpeg" ? "jpg" : mime.slice("image/".length)}`);
    assert.equal(releaseValidatedOwnerWan26I2vImage(receipt), true);
  }
  for (const [width, height] of [[384, 384], [8_000, 384], [384, 8_000]] as const) {
    const receipt = validateOwnerWan26I2vImage(input("wan_26_i2v_flash", png(width, height), "image/png", "edge.png"));
    assert.equal(receipt.width, width); assert.equal(receipt.height, height); releaseValidatedOwnerWan26I2vImage(receipt);
  }
  for (const [width, height] of [[383, 384], [8_001, 384], [384, 8_001]] as const) {
    assert.throws(() => validateOwnerWan26I2vImage(input("wan_26_i2v", png(width, height), "image/png")), invalid);
  }
});

test("rejects unsupported IDs, MIME mismatches, malformed records, accessors, proxies and unsafe paths", () => {
  assert.throws(() => validateOwnerWan26I2vImage(input("wan_27_i2v", png(384, 384), "image/png")), invalid);
  assert.throws(() => validateOwnerWan26I2vImage(input("wan_26_i2v", png(384, 384), "image/jpeg")), invalid);
  assert.throws(() => validateOwnerWan26I2vImage({ ...input("wan_26_i2v", png(384, 384), "image/png"), width: 384 }), invalid);
  assert.throws(() => validateOwnerWan26I2vImage(Object.defineProperty({}, "model_id", { get: () => "wan_26_i2v" })), invalid);
  assert.throws(() => validateOwnerWan26I2vImage(new Proxy(input("wan_26_i2v", png(384, 384), "image/png"), {})), invalid);
  assert.throws(() => validateOwnerWan26I2vImage(input("wan_26_i2v", png(384, 384), "image/png", "../scene.png")), invalid);
  assert.throws(() => validateOwnerWan26I2vImage(input("wan_26_i2v", png(384, 384), "image/avif")), invalid);
  assert.throws(() => validateOwnerWan26I2vImage(input("wan_26_i2v", Buffer.alloc(10 * 1024 * 1024 + 1), "image/png")),
    (error: unknown) => error instanceof OwnerWan26I2vImagePolicyError && error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED");
});

test("owns immutable source bytes and invalidates genuine receipts after wipe and release", () => {
  const source = png(384, 384), original = Buffer.from(source), receipt = validateOwnerWan26I2vImage(input("wan_26_i2v_flash", source, "image/png", "source.png"));
  source.fill(0);
  const copy = readValidatedOwnerWan26I2vImage(receipt)!;
  assert.deepEqual(Buffer.from(copy.bytes), original); assert.equal(copy.model_id, "wan_26_i2v_flash");
  copy.bytes.fill(0); assert.deepEqual(Buffer.from(readValidatedOwnerWan26I2vImage(receipt)!.bytes), original);
  const forged = Object.freeze({ ...receipt });
  assert.equal(readValidatedOwnerWan26I2vImage(forged), null); assert.equal(releaseValidatedOwnerWan26I2vImage(forged), false);
  assert.equal(releaseValidatedOwnerWan26I2vImage(new Proxy(receipt, {})), false);
  assert.equal(releaseValidatedOwnerWan26I2vImage(receipt), true); assert.equal(readValidatedOwnerWan26I2vImage(receipt), null);
  assert.equal(isValidatedOwnerWan26I2vImage(receipt), false); assert.equal(releaseValidatedOwnerWan26I2vImage(receipt), false);
});
