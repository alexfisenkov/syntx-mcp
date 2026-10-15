import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  OWNER_WAN25_I2V_PREVIEW_IMAGE_POLICY,
  OwnerWan25I2vPreviewImagePolicyError,
  isValidatedOwnerWan25I2vPreviewImage,
  readValidatedOwnerWan25I2vPreviewImage,
  releaseValidatedOwnerWan25I2vPreviewImage,
  validateOwnerWan25I2vPreviewImage
} from "../src/application/owner-wan25-i2v-image-policy.js";
import { releaseValidatedOwnerWan26I2vImage, validateOwnerWan26I2vImage } from "../src/application/owner-wan26-i2v-image-policy.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const BASE = "sha256-396de1c43fcaa64082a3b6adb4539054929ca388b5b1cf951afff0130ffe2e7e.json";
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
  return Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 0x0b, 8, height >> 8, height & 0xff, width >> 8, width & 0xff,
    1, 1, 0x11, 0, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0, 0xff, 0xd9]);
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
const input = (bytes: Uint8Array, mime_type: string, filename = "preview.frame") => ({
  model_id: "wan_25_i2v_preview", filename, mime_type, bytes
});
const invalid = (error: unknown) => error instanceof OwnerWan25I2vPreviewImagePolicyError && error.code === "INVALID_IMAGE_INPUT";

test("pins one exact preview image and C396 image bounds as local non-authority guards", () => {
  assert.equal(OWNER_WAN25_I2V_PREVIEW_IMAGE_POLICY.model_id, "wan_25_i2v_preview");
  assert.equal(OWNER_WAN25_I2V_PREVIEW_IMAGE_POLICY.catalog_version, BASE);
  assert.equal(OWNER_WAN25_I2V_PREVIEW_IMAGE_POLICY.catalog_fetched_at, "2026-10-15T07:17:24.901Z");
  assert.equal(OWNER_WAN25_I2V_PREVIEW_IMAGE_POLICY.image_count_limit, 1);
  assert.deepEqual(OWNER_WAN25_I2V_PREVIEW_IMAGE_POLICY.source_mime_types,
    ["image/jpg", "image/jpeg", "image/png", "image/bmp", "image/webp"]);
  assert.equal(OWNER_WAN25_I2V_PREVIEW_IMAGE_POLICY.max_file_size_bytes, 10 * 1024 * 1024);
  assert.equal(OWNER_WAN25_I2V_PREVIEW_IMAGE_POLICY.min_side, 384);
  assert.equal(OWNER_WAN25_I2V_PREVIEW_IMAGE_POLICY.max_side, 5_000);
  assert.equal(OWNER_WAN25_I2V_PREVIEW_IMAGE_POLICY.bounds_policy,
    "C396_CATALOG_LOCAL_GUARD_NOT_CURRENT_PROVIDER_LIMIT_OR_ACCEPTANCE");
  assert.equal(OWNER_WAN25_I2V_PREVIEW_IMAGE_POLICY.metadata_confidence, "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED");
  assert.equal(OWNER_WAN25_I2V_PREVIEW_IMAGE_POLICY.dispatch_allowed, false);
  assert.equal(OWNER_WAN25_I2V_PREVIEW_IMAGE_POLICY.generation_permit, false);
  assert.equal(OWNER_WAN25_I2V_PREVIEW_IMAGE_POLICY.owner_upload_binding, "NOT_ESTABLISHED");
});

test("accepts the five C396 image MIME spellings and canonicalizes the JPG alias", () => {
  const formats = [
    [jpeg(384, 384), "image/jpg", "image/jpeg", ".jpg"],
    [jpeg(384, 384), "image/jpeg", "image/jpeg", ".jpg"],
    [png(384, 384), "image/png", "image/png", ".png"],
    [bmp(384, 384), "image/bmp", "image/bmp", ".bmp"],
    [webp(384, 384), "image/webp", "image/webp", ".webp"]
  ] as const;
  for (const [bytes, sourceMime, canonicalMime, extension] of formats) {
    const receipt = validateOwnerWan25I2vPreviewImage(input(bytes, sourceMime));
    assert.equal(receipt.status, "LOCAL_SOURCE_VALIDATED");
    assert.equal(receipt.model_id, "wan_25_i2v_preview");
    assert.equal(receipt.source_mime_type, sourceMime); assert.equal(receipt.mime_type, canonicalMime);
    assert.equal(receipt.filename, `preview${extension}`); assert.equal(receipt.width, 384); assert.equal(receipt.height, 384);
    assert.equal(receipt.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(receipt.generation_permit, false); assert.equal(receipt.dispatch_allowed, false);
    assert.equal(receipt.owner_upload_binding, "NOT_ESTABLISHED");
    assert.equal("url" in receipt, false); assert.equal("bytes" in receipt, false);
    assert.equal(releaseValidatedOwnerWan25I2vPreviewImage(receipt), true);
  }
});

test("enforces inclusive 384–5000 side bounds and the 10 MiB local byte guard", () => {
  for (const [width, height] of [[384, 384], [5_000, 384], [384, 5_000]] as const) {
    const receipt = validateOwnerWan25I2vPreviewImage(input(png(width, height), "image/png", "edge.png"));
    assert.equal(receipt.width, width); assert.equal(receipt.height, height);
    assert.equal(releaseValidatedOwnerWan25I2vPreviewImage(receipt), true);
  }
  for (const [width, height] of [[383, 384], [5_001, 384], [384, 383], [384, 5_001]] as const) {
    assert.throws(() => validateOwnerWan25I2vPreviewImage(input(png(width, height), "image/png")), invalid);
  }
  assert.throws(() => validateOwnerWan25I2vPreviewImage(input(Buffer.alloc(10 * 1024 * 1024 + 1), "image/png")),
    (error: unknown) => error instanceof OwnerWan25I2vPreviewImagePolicyError && error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED");
});

test("rejects other model IDs, MIME mismatch, malformed records, proxies, getters, and hostile byte views", () => {
  assert.throws(() => validateOwnerWan25I2vPreviewImage({ ...input(png(384, 384), "image/png"), model_id: "wan_26_i2v" }), invalid);
  assert.throws(() => validateOwnerWan25I2vPreviewImage(input(png(384, 384), "image/jpeg")), invalid);
  assert.throws(() => validateOwnerWan25I2vPreviewImage({ ...input(png(384, 384), "image/png"), width: 384 }), invalid);
  assert.throws(() => validateOwnerWan25I2vPreviewImage(Object.defineProperty({}, "model_id", { get: () => "wan_25_i2v_preview" })), invalid);
  assert.throws(() => validateOwnerWan25I2vPreviewImage(new Proxy(input(png(384, 384), "image/png"), {})), invalid);
  assert.throws(() => validateOwnerWan25I2vPreviewImage(input(new Proxy(png(384, 384), {}), "image/png")), invalid);
  const withOwnByteLength = png(384, 384); Object.defineProperty(withOwnByteLength, "byteLength", { value: withOwnByteLength.byteLength });
  assert.throws(() => validateOwnerWan25I2vPreviewImage(input(withOwnByteLength, "image/png")), invalid);
  const getterBytes = png(384, 384); Object.defineProperty(getterBytes, "byteOffset", { get: () => 0 });
  assert.throws(() => validateOwnerWan25I2vPreviewImage(input(getterBytes, "image/png")), invalid);
  if (typeof SharedArrayBuffer === "function") {
    const shared = new Uint8Array(new SharedArrayBuffer(png(384, 384).byteLength));
    assert.throws(() => validateOwnerWan25I2vPreviewImage(input(shared, "image/png")), invalid);
  }
  const detached = new Uint8Array(png(384, 384)); structuredClone(detached.buffer, { transfer: [detached.buffer] });
  assert.throws(() => validateOwnerWan25I2vPreviewImage(input(detached, "image/png")), invalid);
});

test("keeps genuine bytes private, defensive-copies reads, and wipes/revokes on release", () => {
  const source = png(384, 384), original = Buffer.from(source);
  const receipt = validateOwnerWan25I2vPreviewImage(input(source, "image/png", "owned.png"));
  source.fill(0);
  const first = readValidatedOwnerWan25I2vPreviewImage(receipt);
  assert.ok(first); assert.deepEqual(Buffer.from(first.bytes), original); assert.equal(first.model_id, "wan_25_i2v_preview");
  first.bytes.fill(0);
  assert.deepEqual(Buffer.from(readValidatedOwnerWan25I2vPreviewImage(receipt)!.bytes), original);
  const forged = Object.freeze({ ...receipt });
  assert.equal(isValidatedOwnerWan25I2vPreviewImage(forged), false);
  assert.equal(readValidatedOwnerWan25I2vPreviewImage(forged), null);
  assert.equal(releaseValidatedOwnerWan25I2vPreviewImage(forged), false);
  assert.equal(releaseValidatedOwnerWan25I2vPreviewImage(new Proxy(receipt, {})), false);
  assert.equal(releaseValidatedOwnerWan25I2vPreviewImage(receipt), true);
  assert.equal(isValidatedOwnerWan25I2vPreviewImage(receipt), false);
  assert.equal(readValidatedOwnerWan25I2vPreviewImage(receipt), null);
  assert.equal(releaseValidatedOwnerWan25I2vPreviewImage(receipt), false);
});

test("rejects a genuine WAN 2.6 image receipt without crossing the model-specific brand", () => {
  const receipt = validateOwnerWan26I2vImage({ model_id: "wan_26_i2v", filename: "frame.png", mime_type: "image/png", bytes: png(384, 384) });
  try {
    assert.equal(isValidatedOwnerWan25I2vPreviewImage(receipt), false);
    assert.equal(readValidatedOwnerWan25I2vPreviewImage(receipt), null);
    assert.equal(releaseValidatedOwnerWan25I2vPreviewImage(receipt), false);
  } finally { releaseValidatedOwnerWan26I2vImage(receipt); }
});
