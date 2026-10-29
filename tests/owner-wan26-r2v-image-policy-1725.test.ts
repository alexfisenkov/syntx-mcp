import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  OWNER_WAN26_R2V_IMAGE_POLICY,
  OwnerWan26R2vImagePolicyError,
  isValidatedOwnerWan26R2vImage,
  readValidatedOwnerWan26R2vImage,
  releaseValidatedOwnerWan26R2vImage,
  validateOwnerWan26R2vImage
} from "../src/application/owner-wan26-r2v-image-policy.js";

const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function png(width: number, height: number): Buffer {
  const bytes = Buffer.from(PNG_1PX);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return bytes;
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
const input = (model_id: "wan_26_r2v" | "wan_26_r2v_flash", bytes: Uint8Array, mime_type: string, filename = "кадр.input") =>
  ({ model_id, filename, mime_type, bytes });
const invalid = (error: unknown) => error instanceof OwnerWan26R2vImagePolicyError && error.code === "INVALID_IMAGE_INPUT";

test("pins C396 image metadata for the exact R2V models and distinguishes local resource guards", () => {
  assert.deepEqual(OWNER_WAN26_R2V_IMAGE_POLICY.model_ids, ["wan_26_r2v", "wan_26_r2v_flash"]);
  assert.equal(OWNER_WAN26_R2V_IMAGE_POLICY.catalog_max_file_size_bytes, 1_048_576_000);
  assert.equal(OWNER_WAN26_R2V_IMAGE_POLICY.max_local_resource_bytes, 67_108_864);
  assert.equal(OWNER_WAN26_R2V_IMAGE_POLICY.bmp_local_resource_bytes, 20_971_520);
  assert.equal(OWNER_WAN26_R2V_IMAGE_POLICY.local_resource_guard_reason, "EXISTING_BOUNDED_INSPECTOR_MAXIMUMS");
  assert.equal(OWNER_WAN26_R2V_IMAGE_POLICY.local_resource_guard_configurable, false);
  assert.equal(OWNER_WAN26_R2V_IMAGE_POLICY.policy_readonly, true);
  assert.deepEqual(OWNER_WAN26_R2V_IMAGE_POLICY.source_mime_types,
    ["image/jpg", "image/jpeg", "image/png", "image/bmp", "image/webp"]);
  assert.equal(OWNER_WAN26_R2V_IMAGE_POLICY.min_side, 384);
  assert.equal(OWNER_WAN26_R2V_IMAGE_POLICY.max_side, 5_000);
  assert.equal(OWNER_WAN26_R2V_IMAGE_POLICY.current_public_observation.max_image_file_size_bytes, 20 * 1024 * 1024);
  assert.equal(OWNER_WAN26_R2V_IMAGE_POLICY.current_public_observation.max_side, 4_096);
  assert.equal(OWNER_WAN26_R2V_IMAGE_POLICY.generation_permit, false);
  assert.equal(OWNER_WAN26_R2V_IMAGE_POLICY.owner_upload_binding, "NOT_ESTABLISHED");
});

test("validates genuine catalog image formats for both WAN26 R2V IDs", () => {
  const formats = [
    [jpeg(384, 384), "image/jpg", ".jpg"],
    [jpeg(384, 384), "image/jpeg", ".jpg"],
    [png(384, 384), "image/png", ".png"],
    [bmp(384, 384), "image/bmp", ".bmp"],
    [webp(384, 384), "image/webp", ".webp"]
  ] as const;
  for (const model_id of OWNER_WAN26_R2V_IMAGE_POLICY.model_ids) {
    for (const [bytes, mime_type, extension] of formats) {
      const receipt = validateOwnerWan26R2vImage(input(model_id, bytes, mime_type, "сцена.old"));
      assert.equal(receipt.model_id, model_id);
      assert.equal(receipt.filename, `сцена${extension}`);
      assert.equal(receipt.source_mime_type, mime_type);
      assert.equal(receipt.mime_type, mime_type === "image/jpg" ? "image/jpeg" : mime_type);
      assert.equal(receipt.width, 384); assert.equal(receipt.height, 384);
      assert.equal(receipt.sha256, createHash("sha256").update(bytes).digest("hex"));
      assert.equal(receipt.generation_permit, false);
      assert.equal(releaseValidatedOwnerWan26R2vImage(receipt), true);
    }
  }
});

test("enforces inclusive catalog side bounds without pixel decoding", () => {
  for (const [width, height] of [[384, 384], [4_096, 384], [384, 4_096]] as const) {
    const receipt = validateOwnerWan26R2vImage(input("wan_26_r2v_flash", png(width, height), "image/png"));
    assert.equal(receipt.width, width); assert.equal(receipt.height, height);
    assert.equal(receipt.metadata_confidence, "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED");
    releaseValidatedOwnerWan26R2vImage(receipt);
  }
  for (const [width, height] of [[383, 384], [4_097, 384], [384, 4_097]] as const) {
    assert.throws(() => validateOwnerWan26R2vImage(input("wan_26_r2v", png(width, height), "image/png")), invalid);
  }
});

test("rejects mismatched MIME, unsafe filenames, malformed shapes, proxies, and non-R2V models", () => {
  assert.throws(() => validateOwnerWan26R2vImage(input("wan_26_r2v", png(384, 384), "image/jpeg")), invalid);
  assert.throws(() => validateOwnerWan26R2vImage(input("wan_26_r2v", png(384, 384), "image/avif")), invalid);
  assert.throws(() => validateOwnerWan26R2vImage(input("wan_26_r2v", png(384, 384), "video/mp4")), invalid);
  assert.throws(() => validateOwnerWan26R2vImage(input("wan_26_r2v", png(384, 384), "audio/mp3")), invalid);
  assert.throws(() => validateOwnerWan26R2vImage(input("wan_26_r2v", png(384, 384), "image/png", "../frame.png")), invalid);
  assert.throws(() => validateOwnerWan26R2vImage(input("wan_26_r2v", png(384, 384), "image/png", "CON.png")), invalid);
  assert.throws(() => validateOwnerWan26R2vImage({ ...input("wan_26_r2v", png(384, 384), "image/png"), extra: true }), invalid);
  assert.throws(() => validateOwnerWan26R2vImage(new Proxy(input("wan_26_r2v", png(384, 384), "image/png"), {})), invalid);
  assert.throws(() => validateOwnerWan26R2vImage({ model_id: "wan_27_r2v", filename: "frame.png", mime_type: "image/png", bytes: png(384, 384) }), invalid);
});

test("rejects images exceeding the local resource bound before copying or inspection", () => {
  const tooLarge = Buffer.alloc(OWNER_WAN26_R2V_IMAGE_POLICY.max_local_resource_bytes + 1);
  assert.throws(() => validateOwnerWan26R2vImage(input("wan_26_r2v", tooLarge, "image/png")),
    (error: unknown) => error instanceof OwnerWan26R2vImagePolicyError && error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED");
  const tooLargeBmp = Buffer.alloc(OWNER_WAN26_R2V_IMAGE_POLICY.bmp_local_resource_bytes + 1);
  assert.throws(() => validateOwnerWan26R2vImage(input("wan_26_r2v_flash", tooLargeBmp, "image/bmp")),
    (error: unknown) => error instanceof OwnerWan26R2vImagePolicyError && error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED");
});

test("keeps validated bytes private, returns verified copies, and wipes/revokes on release", () => {
  const bytes = png(384, 384), original = Buffer.from(bytes);
  const receipt = validateOwnerWan26R2vImage(input("wan_26_r2v_flash", bytes, "image/png", "source.png"));
  bytes.fill(0);
  assert.equal(isValidatedOwnerWan26R2vImage(receipt), true);
  const read = readValidatedOwnerWan26R2vImage(receipt);
  assert.ok(read); assert.deepEqual(Buffer.from(read.bytes), original);
  read.bytes.fill(0);
  assert.deepEqual(Buffer.from(readValidatedOwnerWan26R2vImage(receipt)!.bytes), original);
  const forged = Object.freeze({ ...receipt });
  assert.equal(readValidatedOwnerWan26R2vImage(forged), null);
  assert.equal(releaseValidatedOwnerWan26R2vImage(new Proxy(receipt, {})), false);
  assert.equal(releaseValidatedOwnerWan26R2vImage(receipt), true);
  assert.equal(readValidatedOwnerWan26R2vImage(receipt), null);
  assert.equal(releaseValidatedOwnerWan26R2vImage(receipt), false);
});
