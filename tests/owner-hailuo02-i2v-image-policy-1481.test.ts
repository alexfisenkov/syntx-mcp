import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  OWNER_HAILUO02_I2V_IMAGE_INPUT_POLICY,
  OwnerHailuo02I2vImageUploadError,
  readValidatedOwnerHailuo02I2vImageUpload,
  releaseValidatedOwnerHailuo02I2vImageUpload,
  validateOwnerHailuo02I2vImageUpload
} from "../src/application/owner-hailuo02-i2v-image-policy.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x12, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x4c, 0x05, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x00, 0x00]);

function input(bytes: Uint8Array, filename: string, mime_type: string) { return { filename, mime_type, bytes }; }

function pngWithDimensions(width: number, height: number): Buffer {
  const bytes = Buffer.from(PNG);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return bytes;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

test("pins Hailuo source upload facts and labels the 10 MiB bound as local only", () => {
  assert.equal(OWNER_HAILUO02_I2V_IMAGE_INPUT_POLICY.model_id, "hailuo-02");
  assert.deepEqual(OWNER_HAILUO02_I2V_IMAGE_INPUT_POLICY.upload_source, {
    model_type: "hailuo-02", destination: "uploaded", check_duplicates: true, reference_count_limit: 1
  });
  assert.deepEqual(OWNER_HAILUO02_I2V_IMAGE_INPUT_POLICY.source_mime_types,
    ["image/jpeg", "image/jpg", "image/png", "image/webp"]);
  assert.equal(OWNER_HAILUO02_I2V_IMAGE_INPUT_POLICY.source_max_bytes, "UNKNOWN");
  assert.equal(OWNER_HAILUO02_I2V_IMAGE_INPUT_POLICY.local_max_bytes, 10 * 1024 * 1024);
  assert.equal(OWNER_HAILUO02_I2V_IMAGE_INPUT_POLICY.local_max_bytes_policy, "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT");
});

test("admits the four source MIME spellings against actual JPEG, PNG, and WebP containers", () => {
  const cases = [
    [JPEG, "image/jpeg", "image/jpeg", "кадр.jpg"], [JPEG, "image/jpg", "image/jpeg", "кадр.jpg"],
    [PNG, "image/png", "image/png", "кадр.png"], [WEBP, "image/webp", "image/webp", "кадр.webp"]
  ] as const;
  for (const [bytes, sourceMime, canonicalMime, filename] of cases) {
    const before = Buffer.from(bytes);
    const receipt = validateOwnerHailuo02I2vImageUpload(input(bytes, "кадр.untrusted", sourceMime));
    assert.equal(receipt.status, "LOCAL_SOURCE_VALIDATED");
    assert.equal(receipt.model_id, "hailuo-02");
    assert.equal(receipt.filename, filename);
    assert.equal(receipt.source_mime_type, sourceMime);
    assert.equal(receipt.mime_type, canonicalMime);
    assert.equal(receipt.width, 1);
    assert.equal(receipt.height, 1);
    assert.equal(receipt.size, bytes.byteLength);
    assert.equal(receipt.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(receipt.metadata_confidence, "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS");
    assert.equal(receipt.provider_acceptance, "UNPROVEN");
    assert.deepEqual(bytes, before);
    assert.equal(Object.isFrozen(receipt), true);
    assert.equal("bytes" in receipt, false);
    assert.equal(releaseValidatedOwnerHailuo02I2vImageUpload(receipt), true);
  }
});

test("does not borrow Kling dimension bounds and requires only positive parsed metadata", () => {
  const largerThanKlingLocalDimension = pngWithDimensions(9_000, 1);
  const valid = validateOwnerHailuo02I2vImageUpload(input(largerThanKlingLocalDimension, "wide.png", "image/png"));
  assert.equal(valid.width, 9_000);
  assert.equal(valid.height, 1);
  assert.equal(releaseValidatedOwnerHailuo02I2vImageUpload(valid), true);

  const zeroDimension = pngWithDimensions(0, 1);
  assert.throws(() => validateOwnerHailuo02I2vImageUpload(input(zeroDimension, "zero.png", "image/png")),
    (error: unknown) => error instanceof OwnerHailuo02I2vImageUploadError && error.code === "INVALID_IMAGE_INPUT");
});

test("rejects forged MIME, truncated containers, malformed names, and caller-supplied metadata", () => {
  const invalid = (error: unknown) => error instanceof OwnerHailuo02I2vImageUploadError && error.code === "INVALID_IMAGE_INPUT";
  assert.throws(() => validateOwnerHailuo02I2vImageUpload(input(PNG, "frame.png", "image/jpeg")), invalid);
  assert.throws(() => validateOwnerHailuo02I2vImageUpload(input(PNG.subarray(0, -1), "frame.png", "image/png")), invalid);
  assert.throws(() => validateOwnerHailuo02I2vImageUpload(input(PNG, "../frame.png", "image/png")), invalid);
  assert.throws(() => validateOwnerHailuo02I2vImageUpload({ ...input(PNG, "frame.png", "image/png"), width: 1 }), invalid);
  assert.throws(() => validateOwnerHailuo02I2vImageUpload({ ...input(PNG, "frame.png", "image/png"), sha256: "a".repeat(64) }), invalid);
});

test("enforces the local byte ceiling before snapshot allocation and preserves caller storage", () => {
  const tooLarge = new Uint8Array(10 * 1024 * 1024 + 1);
  tooLarge.fill(0x5a);
  const before = tooLarge.slice();
  assert.throws(() => validateOwnerHailuo02I2vImageUpload(input(tooLarge, "large.png", "image/png")),
    (error: unknown) => error instanceof OwnerHailuo02I2vImageUploadError && error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED");
  assert.deepEqual(tooLarge, before);
});

test("keeps bytes behind a genuine receipt brand and wipes the sealed copy on release", () => {
  const source = Buffer.from(PNG);
  const receipt = validateOwnerHailuo02I2vImageUpload(input(source, "image.png", "image/png"));
  const forged = { ...receipt };
  const first = readValidatedOwnerHailuo02I2vImageUpload(receipt);
  assert.ok(first);
  first.bytes.fill(0);
  assert.deepEqual(Buffer.from(readValidatedOwnerHailuo02I2vImageUpload(receipt)!.bytes), PNG);
  assert.equal(readValidatedOwnerHailuo02I2vImageUpload(forged), null);
  assert.equal(readValidatedOwnerHailuo02I2vImageUpload(new Proxy(receipt, {})), null);
  assert.equal(releaseValidatedOwnerHailuo02I2vImageUpload(forged), false);
  assert.equal(releaseValidatedOwnerHailuo02I2vImageUpload(receipt), true);
  assert.equal(readValidatedOwnerHailuo02I2vImageUpload(receipt), null);
  assert.equal(releaseValidatedOwnerHailuo02I2vImageUpload(receipt), false);
  assert.deepEqual(source, PNG);
});

test("rejects proxy byte views and accessor DTOs without invoking getters", () => {
  const invalid = (error: unknown) => error instanceof OwnerHailuo02I2vImageUploadError && error.code === "INVALID_IMAGE_INPUT";
  assert.throws(() => validateOwnerHailuo02I2vImageUpload(input(new Proxy(PNG, {}), "image.png", "image/png")), invalid);
  let getterCalls = 0;
  const accessor = Object.defineProperties({}, {
    filename: { enumerable: true, value: "image.png" },
    mime_type: { enumerable: true, value: "image/png" },
    bytes: { enumerable: true, get() { getterCalls += 1; return PNG; } }
  });
  assert.throws(() => validateOwnerHailuo02I2vImageUpload(accessor), invalid);
  assert.equal(getterCalls, 0);
});
