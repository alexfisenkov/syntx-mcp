import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  OWNER_IDEOGRAM_IMAGE_INPUT_POLICY,
  OwnerIdeogramImageInputError,
  validateOwnerIdeogramImageInput,
  validateOwnerIdeogramImageUploadData
} from "../src/application/owner-ideogram-image-input.js";

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const JPEG_1X1 = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);
const WEBP_1X1 = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x12, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 0x05, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x00, 0x00]);
const AVIF_16X16 = Buffer.from("AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAkAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAQAAAAEAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAsbWRhdAoKAAAAAZ/41fIAgDIWEACXgBBAggAAEABcEytNbG+TY8nR6A==", "base64");

test("declares source MIME/size metadata separately from the finite local ceiling", () => {
  assert.deepEqual(OWNER_IDEOGRAM_IMAGE_INPUT_POLICY.models.ideogram.accepted_mime_types,
    ["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"]);
  assert.equal(OWNER_IDEOGRAM_IMAGE_INPUT_POLICY.models.ideogram.source_max_bytes, 0);
  assert.equal(OWNER_IDEOGRAM_IMAGE_INPUT_POLICY.models.ideogram.local_max_bytes, 67_108_864);
  assert.equal(OWNER_IDEOGRAM_IMAGE_INPUT_POLICY.models.ideogram_40.source_max_bytes, 52_428_800);
  assert.equal(OWNER_IDEOGRAM_IMAGE_INPUT_POLICY.models.ideogram_45.source_max_bytes, 26_214_400);
  assert.equal(OWNER_IDEOGRAM_IMAGE_INPUT_POLICY.local_limit_confidence, "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT");
});

test("accepts declared model MIME combinations and normalizes only the jpg alias", () => {
  const cases = [
    ["ideogram", PNG_1X1, "image/png", "image/png", 1, 1],
    ["ideogram", JPEG_1X1, "image/jpg", "image/jpeg", 1, 1],
    ["ideogram", AVIF_16X16, "image/avif", "image/avif", 16, 16],
    ["ideogram", WEBP_1X1, "image/webp", "image/webp", 1, 1],
    ["ideogram", JPEG_1X1, "image/jpeg", "image/jpeg", 1, 1],
    ["ideogram_40", JPEG_1X1, "image/jpeg", "image/jpeg", 1, 1],
    ["ideogram_40", JPEG_1X1, "image/jpg", "image/jpeg", 1, 1],
    ["ideogram_40", PNG_1X1, "image/png", "image/png", 1, 1],
    ["ideogram_40", WEBP_1X1, "image/webp", "image/webp", 1, 1],
    ["ideogram_45", JPEG_1X1, "image/jpeg", "image/jpeg", 1, 1],
    ["ideogram_45", JPEG_1X1, "image/jpg", "image/jpeg", 1, 1],
    ["ideogram_45", PNG_1X1, "image/png", "image/png", 1, 1],
    ["ideogram_45", WEBP_1X1, "image/webp", "image/webp", 1, 1]
  ] as const;
  for (const [model_id, bytes, mime_type, canonical, width, height] of cases) {
    const image = validateOwnerIdeogramImageInput({
      model_id, content_base64: bytes.toString("base64"), filename: "input.bin", mime_type
    });
    assert.equal(image.model_id, model_id);
    assert.equal(image.original_mime_type, mime_type);
    assert.equal(image.mime_type, canonical);
    assert.equal(image.width, width);
    assert.equal(image.height, height);
    assert.equal(image.size, bytes.byteLength);
    assert.equal(image.sha256, `sha256:${createHash("sha256").update(bytes).digest("hex")}`);
    assert.equal(image.metadata_confidence, "CONTAINER_METADATA_ONLY");
    assert.equal(Buffer.compare(Buffer.from(image.bytes), bytes), 0);
  }
  assert.throws(() => validateOwnerIdeogramImageInput({
    model_id: "ideogram_40", content_base64: AVIF_16X16.toString("base64"), filename: "avif.bin", mime_type: "image/avif"
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_IMAGE_INPUT");
  assert.throws(() => validateOwnerIdeogramImageInput({
    model_id: "ideogram_45", content_base64: AVIF_16X16.toString("base64"), filename: "avif.bin", mime_type: "image/avif"
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_IMAGE_INPUT");
});

test("returns an independent exact-sized byte copy and does not mutate the caller buffer", () => {
  const source = Buffer.concat([Buffer.from([0xaa, 0xbb]), PNG_1X1, Buffer.from([0xcc])]);
  const view = source.subarray(2, 2 + PNG_1X1.byteLength);
  const before = Buffer.from(source);
  const image = validateOwnerIdeogramImageUploadData({ model_id: "ideogram", bytes: view, filename: "image.png", mime_type: "image/png" });
  assert.deepEqual(source, before);
  assert.equal(image.bytes.byteOffset, 0);
  assert.equal(image.bytes.byteLength, PNG_1X1.byteLength);
  assert.equal(image.bytes.buffer.byteLength, PNG_1X1.byteLength);
  assert.notEqual(image.bytes.buffer, view.buffer);
  image.bytes.fill(0);
  assert.deepEqual(source, before);
});

test("rejects mismatched MIME, unsupported modes, unsafe filenames, getters, proxies, and extra authority fields", () => {
  const base = { model_id: "ideogram", content_base64: PNG_1X1.toString("base64"), filename: "image.png", mime_type: "image/png" };
  let getterCalls = 0;
  const getter = Object.defineProperty({ ...base }, "model_id", {
    enumerable: true, get: () => { getterCalls += 1; return "ideogram"; }
  });
  let proxyTraps = 0;
  const proxy = new Proxy({}, { get: () => { proxyTraps += 1; throw new Error("must not invoke proxy traps"); } });
  for (const input of [
    { ...base, mime_type: "image/jpeg" },
    { ...base, model_id: "ideogram_4" },
    { ...base, filename: "../image.png" },
    { ...base, grant: true },
    { ...base, is_mask: true },
    { ...base, content_base64: `${base.content_base64}\n` },
    getter,
    proxy
  ]) {
    assert.throws(() => validateOwnerIdeogramImageInput(input), (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "INVALID_IMAGE_INPUT");
  }
  assert.equal(getterCalls, 0);
  assert.equal(proxyTraps, 0);
});

test("rejects raw byte proxies and shadowed byte accessors without invoking caller traps", () => {
  let proxyTraps = 0;
  const proxy = new Proxy(new Uint8Array(PNG_1X1), {
    get: () => { proxyTraps += 1; throw new Error("must not invoke typed-array proxy traps"); }
  });
  let getterCalls = 0;
  const shadowed = new Uint8Array(PNG_1X1);
  Object.defineProperty(shadowed, "byteLength", { get: () => { getterCalls += 1; return PNG_1X1.byteLength; } });
  for (const bytes of [proxy, shadowed]) {
    assert.throws(() => validateOwnerIdeogramImageUploadData({
      model_id: "ideogram", bytes, filename: "image.png", mime_type: "image/png"
    }), (error: unknown) => error instanceof OwnerIdeogramImageInputError && error.code === "INVALID_IMAGE_INPUT");
  }
  assert.equal(proxyTraps, 0);
  assert.equal(getterCalls, 0);
});
