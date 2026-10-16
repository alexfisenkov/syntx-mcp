import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import * as importedPolicy from "../src/application/owner-wan27-videoedit-image-policy.js";

const MODEL_ID = "wan_27_videoedit" as const;
const MAX_BYTES = 20 * 1024 * 1024;
const POLICY_API = importedPolicy as unknown as {
  validateOwnerWan27VideoEditImage(input: unknown): Readonly<Record<string, unknown>>;
  isValidatedOwnerWan27VideoEditImage(receipt: unknown): boolean;
  readValidatedOwnerWan27VideoEditImage(receipt: unknown): Readonly<{
    bytes: Uint8Array;
    filename: string;
    mime_type: string;
    width: number;
    height: number;
    size: number;
    sha256: string;
  }> | null;
  releaseValidatedOwnerWan27VideoEditImage(receipt: unknown): boolean;
};

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
  return Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 0x0b, 8, height >> 8, height & 0xff, width >> 8, width & 0xff,
    1, 1, 0x11, 0, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0, 0xff, 0xd9]);
}

function bmp(width: number, height: number): Buffer {
  const stride = Math.ceil(width * 24 / 32) * 4;
  const pixelLength = stride * height;
  const bytes = Buffer.alloc(54 + pixelLength);
  bytes.write("BM", 0, "ascii"); bytes.writeUInt32LE(bytes.byteLength, 2); bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14); bytes.writeInt32LE(width, 18); bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28); bytes.writeUInt32LE(pixelLength, 34);
  return bytes;
}

function unsupportedBmp(): Buffer {
  const bytes = Buffer.alloc(70);
  bytes.write("BM", 0, "ascii"); bytes.writeUInt32LE(bytes.byteLength, 2); bytes.writeUInt32LE(70, 10);
  bytes.writeUInt32LE(56, 14);
  return bytes;
}

function webp(width: number, height: number): Buffer {
  const chunk = Buffer.alloc(18); chunk.write("VP8 ", 0, 4, "ascii"); chunk.writeUInt32LE(10, 4);
  chunk[11] = 0x9d; chunk[12] = 0x01; chunk[13] = 0x2a; chunk.writeUInt16LE(width, 14); chunk.writeUInt16LE(height, 16);
  const bytes = Buffer.alloc(12 + chunk.length); bytes.write("RIFF", 0, 4, "ascii"); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WEBP", 8, 4, "ascii"); chunk.copy(bytes, 12);
  return bytes;
}

function input(bytes: Uint8Array, mime_type: string, filename = "frame.old", model_id: string = MODEL_ID): Record<string, unknown> {
  return { model_id, filename, mime_type, bytes };
}

function invalidImage(error: unknown): boolean {
  return error instanceof Error && (error as Error & { code?: unknown }).code === "INVALID_IMAGE_INPUT";
}

test("accepts each C19 image MIME and canonicalizes image/jpg without issuing upload authority", () => {
  const formats = [
    [jpeg(240, 300), "image/jpg", "image/jpeg", ".jpg"],
    [jpeg(240, 300), "image/jpeg", "image/jpeg", ".jpg"],
    [png(240, 300), "image/png", "image/png", ".png"],
    [bmp(240, 300), "image/bmp", "image/bmp", ".bmp"],
    [webp(240, 300), "image/webp", "image/webp", ".webp"]
  ] as const;
  for (const [bytes, sourceMime, canonicalMime, extension] of formats) {
    const receipt = POLICY_API.validateOwnerWan27VideoEditImage(input(bytes, sourceMime));
    assert.equal(receipt.status, "LOCAL_SOURCE_VALIDATED");
    assert.equal(receipt.model_id, MODEL_ID);
    assert.equal(receipt.source_policy_id, "OWNER_WAN27_VIDEOEDIT_IMAGE_INPUT_POLICY_C19_LOCAL_GUARD_V1");
    assert.equal(receipt.filename, `frame${extension}`);
    assert.equal(receipt.source_mime_type, sourceMime);
    assert.equal(receipt.mime_type, canonicalMime);
    assert.equal(receipt.width, 240); assert.equal(receipt.height, 300);
    assert.equal(receipt.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(receipt.metadata_confidence, "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED");
    assert.equal(receipt.generation_permit, false);
    assert.equal(receipt.reference_role_binding, "NOT_ESTABLISHED");
    assert.equal(receipt.owner_upload_binding, "NOT_ESTABLISHED");
    assert.equal("bytes" in receipt, false); assert.equal("url" in receipt, false);
    assert.equal(POLICY_API.releaseValidatedOwnerWan27VideoEditImage(receipt), true);
  }
});

test("enforces inclusive 240–4096 bounds independently on width and height", () => {
  for (const [width, height] of [[240, 240], [4_096, 240], [240, 4_096], [4_096, 4_096]] as const) {
    const receipt = POLICY_API.validateOwnerWan27VideoEditImage(input(png(width, height), "image/png", "edge.png"));
    assert.equal(receipt.width, width); assert.equal(receipt.height, height);
    assert.equal(POLICY_API.releaseValidatedOwnerWan27VideoEditImage(receipt), true);
  }
  for (const [width, height] of [[239, 240], [4_097, 240], [240, 239], [240, 4_097]] as const) {
    assert.throws(() => POLICY_API.validateOwnerWan27VideoEditImage(input(png(width, height), "image/png")), invalidImage);
  }
});

test("rejects MIME spoofing, non-target model IDs, extra fields, proxy objects, and accessors", () => {
  assert.throws(() => POLICY_API.validateOwnerWan27VideoEditImage(input(png(240, 240), "image/jpeg")), invalidImage);
  for (const otherModel of ["wan_27_r2v", "wan_30_edit", "kling_4_keyframes"]) {
    assert.throws(() => POLICY_API.validateOwnerWan27VideoEditImage(input(png(240, 240), "image/png", "frame.png", otherModel)), invalidImage);
  }
  assert.throws(() => POLICY_API.validateOwnerWan27VideoEditImage({ ...input(png(240, 240), "image/png"), width: 240 }), invalidImage);
  assert.throws(() => POLICY_API.validateOwnerWan27VideoEditImage(new Proxy(input(png(240, 240), "image/png"), {})), invalidImage);
  const getterInput = Object.defineProperty({}, "model_id", { enumerable: true, get: () => MODEL_ID });
  assert.throws(() => POLICY_API.validateOwnerWan27VideoEditImage(getterInput), invalidImage);
  assert.throws(() => POLICY_API.validateOwnerWan27VideoEditImage(input(png(240, 240), "image/avif")), invalidImage);
  for (const filename of ["../frame.png", "folder\\frame.png", "CON.png", `frame${"x".repeat(256)}.png`, "bad\u0000.png"]) {
    assert.throws(() => POLICY_API.validateOwnerWan27VideoEditImage(input(png(240, 240), "image/png", filename)), invalidImage);
  }
});

test("preserves the BMP inspector's explicit unsupported-composition boundary", () => {
  assert.throws(() => POLICY_API.validateOwnerWan27VideoEditImage(input(unsupportedBmp(), "image/bmp")),
    (error: unknown) => error instanceof Error && (error as Error & { code?: unknown }).code === "UNSUPPORTED_BMP_COMPOSITION");
});

test("rejects bytes over the 20 MiB local inspection guard before parsing", () => {
  const tooLarge = Buffer.alloc(MAX_BYTES + 1);
  assert.throws(() => POLICY_API.validateOwnerWan27VideoEditImage(input(tooLarge, "image/png")),
    (error: unknown) => error instanceof Error && (error as Error & { code?: unknown }).code === "LOCAL_RESOURCE_LIMIT_EXCEEDED");
});

test("keeps an independent private byte snapshot and revokes only its nominal receipt", () => {
  const source = png(240, 240); const original = Buffer.from(source);
  const receipt = POLICY_API.validateOwnerWan27VideoEditImage(input(source, "image/png", "owned.png"));
  assert.deepEqual(source, original, "the policy retains a private copy rather than taking ownership of caller bytes");
  source.fill(0);
  assert.equal(POLICY_API.isValidatedOwnerWan27VideoEditImage(receipt), true);
  const first = POLICY_API.readValidatedOwnerWan27VideoEditImage(receipt);
  assert.ok(first); assert.deepEqual(Buffer.from(first.bytes), original);
  first.bytes.fill(0);
  assert.deepEqual(Buffer.from(POLICY_API.readValidatedOwnerWan27VideoEditImage(receipt)!.bytes), original);
  const forged = Object.freeze({ ...receipt });
  assert.equal(POLICY_API.isValidatedOwnerWan27VideoEditImage(forged), false);
  assert.equal(POLICY_API.readValidatedOwnerWan27VideoEditImage(forged), null);
  assert.equal(POLICY_API.releaseValidatedOwnerWan27VideoEditImage(new Proxy(receipt, {})), false);
  assert.equal(POLICY_API.releaseValidatedOwnerWan27VideoEditImage(receipt), true);
  assert.equal(POLICY_API.isValidatedOwnerWan27VideoEditImage(receipt), false);
  assert.equal(POLICY_API.readValidatedOwnerWan27VideoEditImage(receipt), null);
  assert.equal(POLICY_API.releaseValidatedOwnerWan27VideoEditImage(receipt), false);
});
