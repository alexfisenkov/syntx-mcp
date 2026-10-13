import assert from "node:assert/strict";
import test from "node:test";
import {
  OWNER_RUNWAY_FLUX_IMAGE_INPUT_POLICY,
  validateOwnerRunwayFluxImageInput,
  validateOwnerRunwayFluxImageUploadData
} from "../src/application/owner-runway-flux-image-input-validator.js";

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const JPEG_1X1 = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);
const WEBP_1X1 = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x12, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 0x05, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x00, 0x00]);
const AVIF_16X16 = Buffer.from("AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAkAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAQAAAAEAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAsbWRhdAoKAAAAAZ/41fIAgDIWEACXgBBAggAAEABcEytNbG+TY8nR6A==", "base64");

test("accepts source MIME types with container-only dimensions and canonical MIME", () => {
  const cases = [
    { bytes: PNG_1X1, source: "image/png", canonical: "image/png" },
    { bytes: JPEG_1X1, source: "image/jpeg", canonical: "image/jpeg" },
    { bytes: JPEG_1X1, source: "image/jpg", canonical: "image/jpeg" },
    { bytes: WEBP_1X1, source: "image/webp", canonical: "image/webp" },
    { bytes: AVIF_16X16, source: "image/avif", canonical: "image/avif" }
  ] as const;
  for (const variant of ["runway_frames", "flux-1"] as const) {
    for (const { bytes, source, canonical } of cases) {
      const input = { variant, content_base64: bytes.toString("base64"), filename: "reference.img", mime_type: source };
      assert.doesNotThrow(() => validateOwnerRunwayFluxImageInput(input), `${variant}/${source}`);
      const result = validateOwnerRunwayFluxImageInput(input);
      assert.equal(result.source_mime_type, source);
      assert.equal(result.mime_type, canonical);
      assert.equal(result.width, source === "image/avif" ? 16 : 1);
      assert.equal(result.height, source === "image/avif" ? 16 : 1);
      assert.equal(result.metadata_confidence, "CONTAINER_METADATA_ONLY");
      assert.equal(result.size, bytes.byteLength);
    }
  }
  assert.equal(OWNER_RUNWAY_FLUX_IMAGE_INPUT_POLICY.max_local_bytes, 33_554_432);
  assert.equal(OWNER_RUNWAY_FLUX_IMAGE_INPUT_POLICY.limit_confidence, "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT");
  assert.equal(OWNER_RUNWAY_FLUX_IMAGE_INPUT_POLICY.provider_size_limit, "UNKNOWN");
});

test("raw upload owns the exact subarray bytes and leaves caller storage untouched", () => {
  const source = Buffer.concat([Buffer.from([0xaa, 0xbb]), PNG_1X1, Buffer.from([0xcc])]);
  const inputView = source.subarray(2, 2 + PNG_1X1.byteLength);
  const before = Buffer.from(source);
  const result = validateOwnerRunwayFluxImageUploadData({
    variant: "flux-1", bytes: inputView, filename: "reference.png", mime_type: "image/png"
  });

  assert.deepEqual(source, before);
  assert.equal(result.bytes.constructor, Uint8Array);
  assert.equal(result.bytes.byteOffset, 0);
  assert.equal(result.bytes.byteLength, PNG_1X1.byteLength);
  assert.equal(result.bytes.buffer.byteLength, result.size);
  assert.notEqual(result.bytes.buffer, inputView.buffer);
  result.bytes.fill(0);
  assert.deepEqual(source, before);
});

test("accepts only Runway Frames and Flux 1, and rejects the Flux Pro and Ultra variants", () => {
  const base64 = PNG_1X1.toString("base64");
  for (const variant of ["runway_frames", "flux-1"] as const) {
    assert.equal(validateOwnerRunwayFluxImageInput({
      variant, content_base64: base64, filename: "ref.png", mime_type: "image/png"
    }).variant, variant);
  }
  for (const variant of ["flux-pro-1.1", "flux-pro-1.1-ultra"] as const) {
    assertInvalid(() => validateOwnerRunwayFluxImageInput({
      variant, content_base64: base64, filename: "ref.png", mime_type: "image/png"
    }));
  }
});

test("rejects source MIME spoofing and malformed base64 with a safe closed error", () => {
  assertInvalid(() => validateOwnerRunwayFluxImageInput({
    variant: "runway_frames", content_base64: JPEG_1X1.toString("base64"), filename: "spoof.png", mime_type: "image/png"
  }));
  assertInvalid(() => validateOwnerRunwayFluxImageInput({
    variant: "flux-1", content_base64: "!!!!", filename: "bad.png", mime_type: "image/png"
  }));
  assert.throws(() => validateOwnerRunwayFluxImageInput({
    variant: "runway_frames", content_base64: "!!!!", filename: "private-name.png", mime_type: "image/png"
  }), (error: unknown) => error instanceof Error && error.message === "The owner Runway/Flux image input is invalid or exceeds the local resource ceiling.");
});

test("strict DTO snapshots reject proxies and accessors without invoking caller getters", () => {
  let getterCalls = 0;
  const getterDto = Object.defineProperties({}, {
    variant: { enumerable: true, get: () => { getterCalls += 1; return "runway_frames"; } },
    content_base64: { enumerable: true, value: PNG_1X1.toString("base64") },
    filename: { enumerable: true, value: "ref.png" },
    mime_type: { enumerable: true, value: "image/png" }
  });
  assertInvalid(() => validateOwnerRunwayFluxImageInput(getterDto));
  let proxyTraps = 0;
  const proxy = new Proxy({}, { get: () => { proxyTraps += 1; throw new Error("unexpected get"); } });
  assertInvalid(() => validateOwnerRunwayFluxImageInput(proxy));
  assert.equal(getterCalls, 0);
  assert.equal(proxyTraps, 0);
});

test("rejects shadowed raw typed-array accessors without invoking them", () => {
  const bytes = new Uint8Array(PNG_1X1);
  let getterCalls = 0;
  Object.defineProperty(bytes, "byteOffset", { get: () => { getterCalls += 1; return 0; } });
  assertInvalid(() => validateOwnerRunwayFluxImageUploadData({
    variant: "runway_frames", bytes, filename: "ref.png", mime_type: "image/png"
  }));
  assert.equal(getterCalls, 0);
});

test("rejects raw typed-array proxies without invoking their traps", () => {
  let proxyTraps = 0;
  const bytes = new Proxy(new Uint8Array(PNG_1X1), {
    get: () => { proxyTraps += 1; throw new Error("unexpected typed-array access"); }
  });
  assertInvalid(() => validateOwnerRunwayFluxImageUploadData({
    variant: "flux-1", bytes, filename: "ref.png", mime_type: "image/png"
  }));
  assert.equal(proxyTraps, 0);
});

test("reports the local 32 MiB resource ceiling before decoding oversized input", () => {
  const encodedAboveLimit = "A".repeat(Math.ceil(OWNER_RUNWAY_FLUX_IMAGE_INPUT_POLICY.max_local_bytes / 3) * 4 + 4);
  assert.throws(() => validateOwnerRunwayFluxImageInput({
    variant: "runway_frames", content_base64: encodedAboveLimit, filename: "large.png", mime_type: "image/png"
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED");
});

function assertInvalid(operation: () => unknown): void {
  assert.throws(operation, (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_IMAGE_INPUT");
}
