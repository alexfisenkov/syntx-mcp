import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  OWNER_WAN27_R2V_IMAGE_POLICY,
  OwnerWan27R2vImagePolicyError,
  readValidatedOwnerWan27R2vImage,
  releaseValidatedOwnerWan27R2vImage,
  validateOwnerWan27R2vImage
} from "../src/application/owner-wan27-r2v-image-policy.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const WEBP = Buffer.from([0x52,0x49,0x46,0x46,0x16,0,0,0,0x57,0x45,0x42,0x50,0x56,0x50,0x38,0x20,10,0,0,0,0,0,0,0x9d,1,0x2a,0xf0,0,0xf0,0]);
function input(bytes: Uint8Array, mime_type: string, filename = "кадр.ignored") { return { filename, mime_type, bytes }; }
function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function pngWithDimensions(width: number, height: number): Buffer {
  const bytes = Buffer.from(PNG); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}
function jpegWithDimensions(width: number, height: number): Buffer {
  return Buffer.from([0xff,0xd8,0xff,0xc0,0,0x0b,8,height >> 8,height & 0xff,width >> 8,width & 0xff,1,1,0x11,0,
    0xff,0xda,0,8,1,1,0,0,0x3f,0,0,0xff,0xd9]);
}
function bmp24(width: number, height: number): Buffer {
  const stride = Math.ceil(width * 24 / 32) * 4, pixelLength = stride * height, bytes = Buffer.alloc(54 + pixelLength);
  bytes.write("BM", 0, "ascii"); bytes.writeUInt32LE(bytes.byteLength, 2); bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14); bytes.writeInt32LE(width, 18); bytes.writeInt32LE(height, 22); bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28); bytes.writeUInt32LE(pixelLength, 34); return bytes;
}
function jpegAtSize(size: number): Buffer {
  const tail = jpegWithDimensions(240, 240).subarray(2), parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let remaining = size - 2 - tail.byteLength;
  while (remaining > 65_537) { const segment = Buffer.alloc(65_537); segment[0] = 0xff; segment[1] = 0xe1; segment.writeUInt16BE(65_535, 2); parts.push(segment); remaining -= segment.length; }
  const final = Buffer.alloc(remaining); final[0] = 0xff; final[1] = 0xe1; final.writeUInt16BE(remaining - 2, 2); parts.push(final, tail);
  return Buffer.concat(parts);
}

test("pins WAN 2.7 R2V image catalog bounds as local guard, not provider acceptance", () => {
  assert.equal(OWNER_WAN27_R2V_IMAGE_POLICY.model_id, "wan_27_r2v");
  assert.equal(OWNER_WAN27_R2V_IMAGE_POLICY.public_catalog_version,
    "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json");
  assert.deepEqual(OWNER_WAN27_R2V_IMAGE_POLICY.source_mime_types, ["image/jpg", "image/jpeg", "image/png", "image/bmp", "image/webp"]);
  assert.equal(OWNER_WAN27_R2V_IMAGE_POLICY.max_file_size_bytes, 20 * 1024 * 1024);
  assert.equal(OWNER_WAN27_R2V_IMAGE_POLICY.min_side, 240); assert.equal(OWNER_WAN27_R2V_IMAGE_POLICY.max_side, 8_000);
  assert.equal(OWNER_WAN27_R2V_IMAGE_POLICY.generation_permit, false);
  assert.equal(OWNER_WAN27_R2V_IMAGE_POLICY.owner_upload_binding, "NOT_ESTABLISHED");
});

test("admits JPEG/JPG, PNG, BMP and WebP byte containers and canonicalizes their filename", () => {
  const cases = [
    [jpegWithDimensions(240, 240), "image/jpg", "image/jpeg", ".jpg"], [jpegWithDimensions(240, 240), "image/jpeg", "image/jpeg", ".jpg"],
    [pngWithDimensions(240, 240), "image/png", "image/png", ".png"],
    [bmp24(240, 240), "image/bmp", "image/bmp", ".bmp"], [WEBP, "image/webp", "image/webp", ".webp"]
  ] as const;
  for (const [bytes, sourceMime, canonicalMime, extension] of cases) {
    const before = Buffer.from(bytes), receipt = validateOwnerWan27R2vImage(input(bytes, sourceMime));
    assert.equal(receipt.filename, `кадр${extension}`); assert.equal(receipt.model_id, "wan_27_r2v");
    assert.equal(receipt.source_mime_type, sourceMime); assert.equal(receipt.mime_type, canonicalMime);
    assert.equal(receipt.width, 240); assert.equal(receipt.height, 240); assert.equal(receipt.size, bytes.byteLength);
    assert.equal(receipt.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(receipt.metadata_confidence, "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED");
    assert.equal(Object.isFrozen(receipt), true); assert.deepEqual(bytes, before);
    const copy = readValidatedOwnerWan27R2vImage(receipt)!; assert.deepEqual(Buffer.from(copy.bytes), bytes);
    copy.bytes.fill(0); assert.deepEqual(Buffer.from(readValidatedOwnerWan27R2vImage(receipt)!.bytes), bytes);
    assert.equal(releaseValidatedOwnerWan27R2vImage(receipt), true);
    assert.equal(readValidatedOwnerWan27R2vImage(receipt), null); assert.equal(releaseValidatedOwnerWan27R2vImage(receipt), false);
  }
});

test("enforces inclusive image side and byte bounds", () => {
  for (const [width, height] of [[240, 240], [8_000, 240], [240, 8_000]] as const) {
    const receipt = validateOwnerWan27R2vImage(input(pngWithDimensions(width, height), "image/png", "edge.png"));
    assert.equal(receipt.width, width); assert.equal(receipt.height, height); releaseValidatedOwnerWan27R2vImage(receipt);
  }
  for (const [width, height] of [[239, 240], [8_001, 240], [240, 8_001]] as const) {
    assert.throws(() => validateOwnerWan27R2vImage(input(pngWithDimensions(width, height), "image/png")),
      (error: unknown) => error instanceof OwnerWan27R2vImagePolicyError && error.code === "INVALID_IMAGE_INPUT");
  }
  const max = jpegAtSize(20 * 1024 * 1024), receipt = validateOwnerWan27R2vImage(input(max, "image/jpeg", "max.jpg"));
  assert.equal(receipt.size, max.byteLength); releaseValidatedOwnerWan27R2vImage(receipt);
  const over = Buffer.alloc(20 * 1024 * 1024 + 1);
  assert.throws(() => validateOwnerWan27R2vImage(input(over, "image/jpeg")),
    (error: unknown) => error instanceof OwnerWan27R2vImagePolicyError && error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED");
});

test("rejects mismatched or malformed source and adversarial records without trusting metadata", () => {
  const invalid = (error: unknown) => error instanceof OwnerWan27R2vImagePolicyError && error.code === "INVALID_IMAGE_INPUT";
  assert.throws(() => validateOwnerWan27R2vImage(input(PNG, "image/jpeg")), invalid);
  assert.throws(() => validateOwnerWan27R2vImage(input(Buffer.from("not image"), "image/png")), invalid);
  assert.throws(() => validateOwnerWan27R2vImage({ ...input(PNG, "image/png"), width: 240 }), invalid);
  assert.throws(() => validateOwnerWan27R2vImage(Object.defineProperty({}, "filename", { get: () => "x.png" })), invalid);
  const proxy = new Proxy(input(PNG, "image/png"), {});
  assert.throws(() => validateOwnerWan27R2vImage(proxy), invalid);
});

test("snapshots Buffer-backed caller bytes and only recognizes genuine frozen receipts", () => {
  const source = Buffer.from(pngWithDimensions(240, 240)), receipt = validateOwnerWan27R2vImage(input(source, "image/png", "source.png"));
  const digest = receipt.sha256; source.fill(0);
  const owned = readValidatedOwnerWan27R2vImage(receipt)!;
  assert.equal(owned.sha256, digest); assert.equal(owned.bytes.byteLength, receipt.size);
  const forged = Object.freeze({ ...receipt });
  assert.equal(readValidatedOwnerWan27R2vImage(forged), null); assert.equal(releaseValidatedOwnerWan27R2vImage(forged), false);
  assert.equal(releaseValidatedOwnerWan27R2vImage(new Proxy(receipt, {})), false);
  assert.equal(releaseValidatedOwnerWan27R2vImage(receipt), true);
});
