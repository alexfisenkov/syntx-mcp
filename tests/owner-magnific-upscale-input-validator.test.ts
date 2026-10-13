import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  OwnerMagnificUpscaleInputError,
  validateOwnerMagnificUpscaleInput
} from "../src/application/owner-magnific-upscale-input-validator.js";

const AVIF_16X16 = "AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAkAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAQAAAAEAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAsbWRhdAoKAAAAAZ/41fIAgDIWEACXgBBAggAAEABcEytNbG+TY8nR6A==";
const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
const JPEG_1X1 = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9
]);
const WEBP_1X1 = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x12, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x4c, 0x05, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x00, 0x00
]);

function input(bytes: Uint8Array, filename: string, mime_type: string) {
  return { content_base64: Buffer.from(bytes).toString("base64"), filename, mime_type };
}

function jpegWithExactSize(byteLength: number): Buffer {
  const tail = Buffer.from([
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9
  ]);
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let remaining = byteLength - 2 - tail.byteLength;
  while (remaining > 65_537) {
    const marker = Buffer.alloc(65_537);
    marker[0] = 0xff; marker[1] = 0xe1; marker.writeUInt16BE(65_535, 2);
    parts.push(marker);
    remaining -= marker.byteLength;
  }
  if (remaining < 4) throw new Error("Fixture is too small for a JPEG marker.");
  const lastMarker = Buffer.alloc(remaining);
  lastMarker[0] = 0xff; lastMarker[1] = 0xe1; lastMarker.writeUInt16BE(remaining - 2, 2);
  parts.push(lastMarker, tail);
  return Buffer.concat(parts);
}

test("sniffs and returns canonical JPEG, PNG, AVIF, and WebP bytes with container metadata and SHA-256", () => {
  const fixtures = [
    { bytes: JPEG_1X1, filename: "one.jpg", mime_type: "image/jpeg", width: 1, height: 1 },
    { bytes: Buffer.from(PNG_1X1, "base64"), filename: "one.png", mime_type: "image/png", width: 1, height: 1 },
    { bytes: Buffer.from(AVIF_16X16, "base64"), filename: "one.avif", mime_type: "image/avif", width: 16, height: 16 },
    { bytes: WEBP_1X1, filename: "one.webp", mime_type: "image/webp", width: 1, height: 1 }
  ] as const;

  for (const fixture of fixtures) {
    const image = validateOwnerMagnificUpscaleInput(input(fixture.bytes, fixture.filename, fixture.mime_type));
    assert.equal(image.mime_type, fixture.mime_type);
    assert.equal(image.width, fixture.width);
    assert.equal(image.height, fixture.height);
    assert.equal(image.metadata_confidence, "CONTAINER_METADATA_ONLY");
    assert.equal(image.sha256, createHash("sha256").update(fixture.bytes).digest("hex"));
    assert.equal(Buffer.compare(Buffer.from(image.bytes), Buffer.from(fixture.bytes)), 0);
  }
});

test("accepts an image larger than the legacy 7 MiB reference cap and exactly the 10 MiB Magnific UI fallback", () => {
  const eightMiB = jpegWithExactSize(8 * 1024 * 1024);
  const acceptedEight = validateOwnerMagnificUpscaleInput(input(eightMiB, "eight.jpg", "image/jpeg"));
  assert.equal(acceptedEight.bytes.byteLength, 8 * 1024 * 1024);

  const tenMiB = jpegWithExactSize(10 * 1024 * 1024);
  const acceptedMaximum = validateOwnerMagnificUpscaleInput(input(tenMiB, "maximum.jpg", "image/jpeg"));
  assert.equal(acceptedMaximum.bytes.byteLength, 10 * 1024 * 1024);
});

test("rejects one byte above the Magnific UI fallback with a closed local policy error", () => {
  const tooLarge = jpegWithExactSize(10 * 1024 * 1024 + 1);
  assert.throws(() => validateOwnerMagnificUpscaleInput(input(tooLarge, "large.jpg", "image/jpeg")), (error: unknown) =>
    error instanceof OwnerMagnificUpscaleInputError && error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED" &&
    !error.message.includes("large.jpg"));
});

test("rejects MIME mismatch, malformed AVIF, and unsupported AVIF sequence branding explicitly", () => {
  assert.throws(() => validateOwnerMagnificUpscaleInput(input(JPEG_1X1, "wrong.png", "image/png")), (error: unknown) =>
    error instanceof OwnerMagnificUpscaleInputError && error.code === "INVALID_IMAGE_INPUT");

  const truncatedAvif = Buffer.from(AVIF_16X16, "base64").subarray(0, -1);
  assert.throws(() => validateOwnerMagnificUpscaleInput(input(truncatedAvif, "broken.avif", "image/avif")), (error: unknown) =>
    error instanceof OwnerMagnificUpscaleInputError && error.code === "INVALID_IMAGE_INPUT");

  const sequenceAvif = Buffer.from(AVIF_16X16, "base64");
  sequenceAvif.write("avis", 8, 4, "ascii");
  assert.throws(() => validateOwnerMagnificUpscaleInput(input(sequenceAvif, "sequence.avif", "image/avif")), (error: unknown) =>
    error instanceof OwnerMagnificUpscaleInputError && error.code === "UNSUPPORTED_AVIF_COMPOSITION");

  const composedAvif = Buffer.concat([Buffer.from(AVIF_16X16, "base64"), Buffer.from([0, 0, 0, 8, 0x6d, 0x6f, 0x6f, 0x76])]);
  assert.throws(() => validateOwnerMagnificUpscaleInput(input(composedAvif, "composed.avif", "image/avif")), (error: unknown) =>
    error instanceof OwnerMagnificUpscaleInputError && error.code === "UNSUPPORTED_AVIF_COMPOSITION");
});

test("rejects noncanonical base64, unsafe filenames, symbols, accessors, and proxies without echoing input", () => {
  const base = input(Buffer.from(PNG_1X1, "base64"), "private.png", "image/png");
  const noncanonical = { ...base, content_base64: `${base.content_base64}\n` };
  const unsafeFilename = { ...base, filename: "../private.png" };
  const withSymbol = { ...base, [Symbol("private")]: "secret" };
  const customPrototype = Object.assign(Object.create({ private: true }), base) as unknown;
  let getterCalls = 0;
  const accessor = { filename: "private.png", mime_type: "image/png" };
  Object.defineProperty(accessor, "content_base64", { enumerable: true, get() { getterCalls += 1; return base.content_base64; } });
  for (const value of [noncanonical, unsafeFilename, withSymbol, customPrototype, accessor, new Proxy(base, {})]) {
    assert.throws(() => validateOwnerMagnificUpscaleInput(value), (error: unknown) =>
      error instanceof OwnerMagnificUpscaleInputError && error.code === "INVALID_IMAGE_INPUT" &&
      !error.message.includes("private") && !error.message.includes("secret"));
  }
  assert.equal(getterCalls, 0);
});
