import assert from "node:assert/strict";
import test from "node:test";
import {
  OwnerImageReferenceInputError,
  validateOwnerImageReferenceInput
} from "../src/application/owner-image-reference-input-validator.js";

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";

function pngWithDimensions(width: number, height: number): string {
  const bytes = Buffer.from(PNG_1X1, "base64");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return bytes.toString("base64");
}

function pngWithIhdrByte(offset: number, value: number): string {
  const bytes = Buffer.from(PNG_1X1, "base64");
  bytes[offset] = value;
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return bytes.toString("base64");
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

test("validates canonical portable base64 and returns actual PNG dimensions and digest", () => {
  const image = validateOwnerImageReferenceInput({ content_base64: PNG_1X1, filename: "reference.png", mime_type: "image/png" });
  assert.equal(image.mime_type, "image/png");
  assert.equal(image.width, 1);
  assert.equal(image.height, 1);
  assert.match(image.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(image.bytes.byteLength > 0, true);
});

test("sniffs JPEG and WebP from container headers and reports their encoded dimensions", () => {
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9
  ]);
  const webp = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x12, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x4c, 0x05, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x00, 0x00
  ]);
  for (const [bytes, mime_type, filename] of [
    [jpeg, "image/jpeg", "reference.jpg"],
    [webp, "image/webp", "reference.webp"]
  ] as const) {
    const image = validateOwnerImageReferenceInput({ content_base64: bytes.toString("base64"), filename, mime_type });
    assert.equal(image.mime_type, mime_type);
    assert.equal(image.width, 1);
    assert.equal(image.height, 1);
  }
});

test("rejects MIME mismatch, noncanonical base64, non-image payloads, malformed headers and unsafe dimensions", () => {
  const invalid = [
    { content_base64: PNG_1X1, filename: "reference.png", mime_type: "image/jpeg" },
    { content_base64: `${PNG_1X1}\n`, filename: "reference.png", mime_type: "image/png" },
    { content_base64: Buffer.from("<svg/>").toString("base64"), filename: "x.png", mime_type: "image/png" },
    { content_base64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64"), filename: "x.png", mime_type: "image/png" },
    { content_base64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0x20, 0xD1, 0, 0, 0x20, 0xD1]).toString("base64"), filename: "x.png", mime_type: "image/png" }
  ];
  for (const input of invalid) {
    assert.throws(() => validateOwnerImageReferenceInput(input), (error: unknown) =>
      error instanceof OwnerImageReferenceInputError && error.code === "INVALID_IMAGE_INPUT");
  }
});

test("enforces the published dimension and pixel-count bounds from the actual image header", () => {
  const maxEdge = validateOwnerImageReferenceInput({ content_base64: pngWithDimensions(8400, 1), filename: "x.png", mime_type: "image/png" });
  assert.equal(maxEdge.width, 8400);
  assert.equal(maxEdge.height, 1);
  for (const [width, height] of [[8401, 1], [8400, 6251]] as const) {
    assert.throws(() => validateOwnerImageReferenceInput({
      content_base64: pngWithDimensions(width, height), filename: "x.png", mime_type: "image/png"
    }), (error: unknown) => error instanceof OwnerImageReferenceInputError && error.code === "INVALID_IMAGE_INPUT");
  }
});

test("rejects illegal PNG IHDR format fields even when chunk CRCs are valid", () => {
  for (const [offset, value] of [[24, 3], [25, 1], [26, 1], [27, 1], [28, 2]] as const) {
    assert.throws(() => validateOwnerImageReferenceInput({
      content_base64: pngWithIhdrByte(offset, value), filename: "x.png", mime_type: "image/png"
    }), (error: unknown) => error instanceof OwnerImageReferenceInputError && error.code === "INVALID_IMAGE_INPUT");
  }
});

test("rejects WebP with malformed trailing RIFF framing after its image chunk", () => {
  const webp = Buffer.from([0x52,0x49,0x46,0x46,0x12,0,0,0,0x57,0x45,0x42,0x50,0x56,0x50,0x38,0x4c,5,0,0,0,0x2f,0,0,0,0,0]);
  webp[4] = 0x13;
  const malformed = Buffer.concat([webp, Buffer.from([0x58])]).toString("base64");
  assert.throws(() => validateOwnerImageReferenceInput({ content_base64: malformed, filename: "x.webp", mime_type: "image/webp" }),
    (error: unknown) => error instanceof OwnerImageReferenceInputError && error.code === "INVALID_IMAGE_INPUT");
});

test("rejects undeclared paths, URLs, extra keys and values beyond the upload byte cap", () => {
  const extras = [
    { content_base64: PNG_1X1, filename: "x.png", mime_type: "image/png", path: "/tmp/x.png" },
    { content_base64: PNG_1X1, filename: "x.png", mime_type: "image/png", url: "https://example.invalid/x.png" },
    { content_base64: PNG_1X1, filename: "../x.png", mime_type: "image/png" },
    { content_base64: "A".repeat(9_790_000), filename: "x.png", mime_type: "image/png" }
  ];
  for (const input of extras) {
    assert.throws(() => validateOwnerImageReferenceInput(input), (error: unknown) =>
      error instanceof OwnerImageReferenceInputError && error.code === "INVALID_IMAGE_INPUT");
  }
});
