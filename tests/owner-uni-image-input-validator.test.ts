import assert from "node:assert/strict";
import test from "node:test";
import { OWNER_UNI_IMAGE_INPUT_POLICY, OwnerUniImageInputError, validateOwnerUniImageInput, validateOwnerUniImageUploadData } from "../src/application/owner-uni-image-input-validator.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const JPEG = Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x0b,0x08,0x00,0x01,0x00,0x01,0x01,0x01,0x11,0x00,0xff,0xda,0x00,0x08,0x01,0x01,0x00,0x00,0x3f,0x00,0x00,0xff,0xd9]);
const WEBP = Buffer.from([0x52,0x49,0x46,0x46,0x12,0,0,0,0x57,0x45,0x42,0x50,0x56,0x50,0x38,0x4c,5,0,0,0,0x2f,0,0,0,0,0]);
const AVIF = Buffer.from("AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAkAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAQAAAAEAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAsbWRhdAoKAAAAAZ/41fIAgDIWEACXgBBAggAAEABcEytNbG+TY8nR6A==", "base64");

function dto(bytes: Buffer, mime_type: string, filename = "source image.bin") {
  return { content_base64: bytes.toString("base64"), filename, mime_type };
}

test("accepts the four selected Uni image containers and canonicalizes JPG", () => {
  const cases = [
    [JPEG, "image/jpeg", "image/jpeg"], [JPEG, "image/jpg", "image/jpeg"],
    [PNG, "image/png", "image/png"], [WEBP, "image/webp", "image/webp"], [AVIF, "image/avif", "image/avif"]
  ] as const;
  for (const [bytes, declared, canonical] of cases) {
    const result = validateOwnerUniImageInput(dto(bytes, declared));
    assert.equal(result.mime_type, canonical);
    assert.equal(result.original_mime_type, declared);
    assert.deepEqual(Buffer.from(result.bytes), bytes);
    assert.equal(result.size, bytes.byteLength);
    assert.equal(result.width, declared === "image/avif" ? 16 : 1);
    assert.equal(result.height, declared === "image/avif" ? 16 : 1);
    assert.equal(result.metadata_confidence, "CONTAINER_METADATA_ONLY");
    assert.equal(result.validation_confidence, declared === "image/avif"
      ? "AVIF_PRIMARY_ITEM_PROPERTY_ASSOCIATION_ONLY"
      : "JPEG_PNG_WEBP_STRUCTURAL_HEADER_ONLY");
  }
});

test("rejects truncated containers and declared MIME mismatches", () => {
  assert.throws(() => validateOwnerUniImageInput(dto(PNG.subarray(0, -1), "image/png")),
    (error: unknown) => error instanceof OwnerUniImageInputError && error.code === "INVALID_IMAGE_INPUT");
  assert.throws(() => validateOwnerUniImageInput(dto(PNG, "image/jpeg")),
    (error: unknown) => error instanceof OwnerUniImageInputError && error.code === "INVALID_IMAGE_INPUT");
});

test("rejects path-like filenames, proxies, and accessor DTOs without invoking getters", () => {
  const invalid = (error: unknown) => error instanceof OwnerUniImageInputError && error.code === "INVALID_IMAGE_INPUT";
  assert.throws(() => validateOwnerUniImageInput(dto(PNG, "image/png", "../image.png")), invalid);
  let getterCalls = 0;
  const accessor = Object.defineProperties({}, {
    content_base64: { enumerable: true, get() { getterCalls += 1; return PNG.toString("base64"); } },
    filename: { enumerable: true, value: "image.png" }, mime_type: { enumerable: true, value: "image/png" }
  });
  assert.throws(() => validateOwnerUniImageInput(accessor), invalid);
  assert.equal(getterCalls, 0);
  assert.throws(() => validateOwnerUniImageInput(new Proxy(dto(PNG, "image/png"), {})), invalid);
});

test("rejects Unicode format controls in filenames", () => {
  assert.throws(() => validateOwnerUniImageInput(dto(PNG, "image/png", "photo\u202e.png")),
    (error: unknown) => error instanceof OwnerUniImageInputError && error.code === "INVALID_IMAGE_INPUT");
});

test("raw upload snapshots only the supplied subarray without mutating caller storage", () => {
  const backing = Buffer.concat([Buffer.from([0xaa]), PNG, Buffer.from([0xbb])]);
  const before = Buffer.from(backing);
  const result = validateOwnerUniImageUploadData({ bytes: backing.subarray(1, -1), filename: "image.png", mime_type: "image/png" });
  assert.deepEqual(backing, before);
  assert.deepEqual(Buffer.from(result.bytes), PNG);
  assert.equal(result.bytes.byteOffset, 0);
  assert.equal(result.bytes.buffer.byteLength, PNG.byteLength);
});

test("large valid JPEG has identical raw-byte and base64 DTO acceptance", () => {
  const largeJpeg = Buffer.concat([JPEG.subarray(0, -3), Buffer.alloc(8_388_608), Buffer.from([0xff, 0xd9])]);
  const raw = validateOwnerUniImageUploadData({ bytes: largeJpeg, filename: "large.jpg", mime_type: "image/jpeg" });
  assert.equal(raw.size, 8_388_635);
  assert.equal(raw.width, 1);
  assert.equal(raw.height, 1);
  const decoded = validateOwnerUniImageInput(dto(largeJpeg, "image/jpeg", "large.jpg"));
  assert.equal(decoded.size, raw.size);
  assert.equal(decoded.sha256, raw.sha256);
});

test("accepts a structurally valid JPEG exactly at 25 MiB and rejects noncanonical base64", () => {
  const exactMax = 26_214_400;
  const atLimit = Buffer.concat([JPEG.subarray(0, -3), Buffer.alloc(exactMax - 27), Buffer.from([0xff, 0xd9])]);
  assert.equal(atLimit.byteLength, exactMax);
  const result = validateOwnerUniImageInput(dto(atLimit, "image/jpeg", "limit.jpg"));
  assert.equal(result.size, exactMax);
  assert.equal(result.width, 1);
  assert.equal(result.height, 1);

  const canonical = PNG.toString("base64");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lastDataIndex = canonical.length - 2;
  const value = alphabet.indexOf(canonical[lastDataIndex]!);
  const noncanonical = `${canonical.slice(0, lastDataIndex)}${alphabet[value ^ 1]}=`;
  const invalid = (error: unknown) => error instanceof OwnerUniImageInputError && error.code === "INVALID_IMAGE_INPUT";
  assert.throws(() => validateOwnerUniImageInput({ content_base64: noncanonical, filename: "image.png", mime_type: "image/png" }), invalid);
  assert.throws(() => validateOwnerUniImageInput({ content_base64: "A===", filename: "image.png", mime_type: "image/png" }), invalid);
});

test("raw boundary rejects proxies, accessors, SharedArrayBuffer, and bytes above 25 MiB", () => {
  const invalid = (error: unknown) => error instanceof OwnerUniImageInputError && error.code === "INVALID_IMAGE_INPUT";
  const limit = (error: unknown) => error instanceof OwnerUniImageInputError && error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED";
  let getterCalls = 0;
  const accessor = Object.defineProperties({}, {
    bytes: { enumerable: true, get() { getterCalls += 1; return PNG; } },
    filename: { enumerable: true, value: "image.png" }, mime_type: { enumerable: true, value: "image/png" }
  });
  assert.throws(() => validateOwnerUniImageUploadData(accessor), invalid);
  assert.equal(getterCalls, 0);
  assert.throws(() => validateOwnerUniImageUploadData({ bytes: new Proxy(PNG, {}), filename: "image.png", mime_type: "image/png" }), invalid);
  const shared = new SharedArrayBuffer(PNG.byteLength);
  new Uint8Array(shared).set(PNG);
  assert.throws(() => validateOwnerUniImageUploadData({ bytes: new Uint8Array(shared), filename: "image.png", mime_type: "image/png" }), invalid);
  assert.equal(OWNER_UNI_IMAGE_INPUT_POLICY.local_max_bytes, 26_214_400);
  assert.throws(() => validateOwnerUniImageUploadData({ bytes: new Uint8Array(26_214_401), filename: "large.png", mime_type: "image/png" }), limit);
});
