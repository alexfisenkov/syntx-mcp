import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  OWNER_KONTEXT_IMAGE_INPUT_POLICY,
  OwnerKontextImageInputError,
  validateOwnerKontextImageInput
} from "../src/application/owner-kontext-image-input-validator.js";

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const JPEG_1X1 = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9
]);
const AVIF_16X16 = Buffer.from("AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAkAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAQAAAAEAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAsbWRhdAoKAAAAAZ/41fIAgDIWEACXgBBAggAAEABcEytNbG+TY8nR6A==", "base64");
const WEBP_1X1 = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x12, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x4c, 0x05, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x00, 0x00
]);

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
  const finalMarker = Buffer.alloc(remaining);
  finalMarker[0] = 0xff; finalMarker[1] = 0xe1; finalMarker.writeUInt16BE(remaining - 2, 2);
  parts.push(finalMarker, tail);
  return Buffer.concat(parts);
}

function avifBox(type: string, payload: Uint8Array): Buffer {
  const box = Buffer.alloc(8 + payload.byteLength);
  box.writeUInt32BE(box.byteLength, 0);
  box.write(type, 4, 4, "ascii");
  Buffer.from(payload).copy(box, 8);
  return box;
}

function rotatedAvif(): Buffer {
  const full = (payload: Uint8Array) => Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from(payload)]);
  const u16 = (value: number) => { const bytes = Buffer.alloc(2); bytes.writeUInt16BE(value); return bytes; };
  const u32 = (value: number) => { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes; };
  const ftyp = avifBox("ftyp", Buffer.from("avif\0\0\0\0mif1avif", "ascii"));
  const hdlr = avifBox("hdlr", full(Buffer.from([0, 0, 0, 0, ...Buffer.from("pict", "ascii"), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])));
  const pitm = avifBox("pitm", full(u16(1)));
  const infe = avifBox("infe", Buffer.concat([Buffer.from([2, 0, 0, 0]), u16(1), u16(0), Buffer.from("av01", "ascii"), Buffer.from([0])]));
  const iinf = avifBox("iinf", full(Buffer.concat([u16(1), infe])));
  const ispe = ([width, height]: readonly [number, number]) => avifBox("ispe", full(Buffer.concat([u32(width), u32(height)])));
  const irot = avifBox("irot", Buffer.from([0]));
  const ipco = avifBox("ipco", Buffer.concat([ispe([16, 16]), ispe([640, 480]), irot]));
  const ipma = avifBox("ipma", full(Buffer.concat([u32(1), u16(1), Buffer.from([2, 1, 3])])));
  const iprp = avifBox("iprp", Buffer.concat([ipco, ipma]));
  const meta = avifBox("meta", full(Buffer.concat([hdlr, pitm, iinf, iprp])));
  return Buffer.concat([ftyp, meta, avifBox("mdat", Buffer.from([0]))]);
}

test("sniffs four image formats and canonicalizes JPG alias without trusting caller MIME", () => {
  const cases = [
    { bytes: JPEG_1X1, filename: "фото.jpg", original_mime_type: "image/jpg", mime_type: "image/jpeg", width: 1, height: 1 },
    { bytes: JPEG_1X1, filename: "image.jpeg", original_mime_type: "image/jpeg", mime_type: "image/jpeg", width: 1, height: 1 },
    { bytes: PNG_1X1, filename: "image.png", original_mime_type: "image/png", mime_type: "image/png", width: 1, height: 1 },
    { bytes: AVIF_16X16, filename: "image.avif", original_mime_type: "image/avif", mime_type: "image/avif", width: 16, height: 16 },
    { bytes: WEBP_1X1, filename: "image.webp", original_mime_type: "image/webp", mime_type: "image/webp", width: 1, height: 1 }
  ] as const;

  for (const item of cases) {
    const inputBytes = Buffer.from(item.bytes);
    const image = validateOwnerKontextImageInput({
      content_base64: inputBytes.toString("base64"), filename: item.filename, mime_type: item.original_mime_type
    });
    assert.equal(image.original_mime_type, item.original_mime_type);
    assert.equal(image.mime_type, item.mime_type);
    assert.equal(image.width, item.width);
    assert.equal(image.height, item.height);
    assert.equal(image.size, item.bytes.byteLength);
    assert.equal(image.sha256, createHash("sha256").update(item.bytes).digest("hex"));
    assert.equal(image.metadata_confidence, "CONTAINER_METADATA_ONLY");
    assert.deepEqual(Buffer.from(image.bytes), item.bytes);
    assert.notStrictEqual(image.bytes.buffer, inputBytes.buffer);
  }
  assert.throws(() => validateOwnerKontextImageInput({
    content_base64: PNG_1X1.toString("base64"), filename: "wrong.png", mime_type: "image/jpg"
  }), (error: unknown) => error instanceof OwnerKontextImageInputError && error.code === "INVALID_IMAGE_INPUT");
});

test("accepts the exact 10 MiB local guard but rejects one byte above it without claiming an upstream cap", () => {
  assert.deepEqual(OWNER_KONTEXT_IMAGE_INPUT_POLICY, {
    local_max_bytes: 10 * 1024 * 1024,
    local_max_bytes_policy: "LOCAL_RESOURCE_GUARD_NOT_PROVIDER_LIMIT",
    source_max_bytes: "UNKNOWN",
    provider_max_bytes: "UNKNOWN",
    filename_utf8_max_bytes: 255,
    filename_policy: "LOCAL_PORTABLE_BASENAME_ONLY"
  });

  const eightMiB = jpegWithExactSize(8 * 1024 * 1024);
  const acceptedEight = validateOwnerKontextImageInput({
    content_base64: eightMiB.toString("base64"), filename: "eight.jpg", mime_type: "image/jpeg"
  });
  assert.equal(acceptedEight.size, 8 * 1024 * 1024, "the local guard does not inherit the legacy 7 MiB validator cap");

  const exactLimit = jpegWithExactSize(10 * 1024 * 1024);
  const acceptedLimit = validateOwnerKontextImageInput({
    content_base64: exactLimit.toString("base64"), filename: "limit.jpg", mime_type: "image/jpeg"
  });
  assert.equal(acceptedLimit.size, 10 * 1024 * 1024);

  const overLimit = jpegWithExactSize(10 * 1024 * 1024 + 1);
  assert.throws(() => validateOwnerKontextImageInput({
    content_base64: overLimit.toString("base64"), filename: "large.jpg", mime_type: "image/jpeg"
  }), (error: unknown) => error instanceof OwnerKontextImageInputError &&
    error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED" && !error.message.includes("large.jpg"));
});

test("rejects filenames containing an unpaired surrogate instead of silently replacing it during UTF-8 encoding", () => {
  const invalidUnicode = `broken${String.fromCharCode(0xd800)}`;
  assert.throws(() => validateOwnerKontextImageInput({
    content_base64: PNG_1X1.toString("base64"), filename: invalidUnicode, mime_type: "image/png"
  }), (error: unknown) => error instanceof OwnerKontextImageInputError && error.code === "INVALID_IMAGE_INPUT");
});

test("rejects unsupported AVIF sequence, container composition, and rotation with the explicit closed error", () => {
  const sequence = Buffer.from(AVIF_16X16);
  sequence.write("avis", 8, 4, "ascii");
  const composed = Buffer.concat([AVIF_16X16, Buffer.from([0, 0, 0, 8, 0x6d, 0x6f, 0x6f, 0x76])]);
  for (const [label, bytes] of [["sequence", sequence], ["composition", composed], ["rotation", rotatedAvif()]] as const) {
    assert.throws(() => validateOwnerKontextImageInput({
      content_base64: bytes.toString("base64"), filename: "image.avif", mime_type: "image/avif"
    }), (error: unknown) => error instanceof OwnerKontextImageInputError && error.code === "UNSUPPORTED_AVIF_COMPOSITION", label);
  }
});

test("rejects noncanonical base64, MIME mismatch, and trailing image bytes", () => {
  const base64 = PNG_1X1.toString("base64");
  const invalidInputs = [
    { content_base64: `${base64}\n`, filename: "image.png", mime_type: "image/png" },
    { content_base64: base64, filename: "image.png", mime_type: "image/jpeg" },
    { content_base64: Buffer.concat([PNG_1X1, Buffer.from([0])]).toString("base64"), filename: "image.png", mime_type: "image/png" }
  ];
  for (const input of invalidInputs) {
    assert.throws(() => validateOwnerKontextImageInput(input), (error: unknown) =>
      error instanceof OwnerKontextImageInputError && error.code === "INVALID_IMAGE_INPUT");
  }
});

test("rejects unsafe or nonportable filenames with errors that do not echo the name", () => {
  const content_base64 = PNG_1X1.toString("base64");
  const invalidNames = ["../private.png", "folder\\private.png", "NUL.txt", "trailing.", "name\u0000.png", `${"é".repeat(128)}.png`];
  for (const filename of invalidNames) {
    assert.throws(() => validateOwnerKontextImageInput({ content_base64, filename, mime_type: "image/png" }),
      (error: unknown) => error instanceof OwnerKontextImageInputError && error.code === "INVALID_IMAGE_INPUT" &&
        !error.message.includes(filename), `filename policy should reject ${JSON.stringify(filename)}`);
  }
});

test("rejects proxy and accessor request objects without invoking caller code", () => {
  const base = { content_base64: PNG_1X1.toString("base64"), filename: "safe.png", mime_type: "image/png" };
  let getterCalls = 0;
  const accessor = { filename: base.filename, mime_type: base.mime_type };
  Object.defineProperty(accessor, "content_base64", { enumerable: true, get() { getterCalls += 1; return base.content_base64; } });
  for (const input of [new Proxy(base, {}), accessor]) {
    assert.throws(() => validateOwnerKontextImageInput(input), (error: unknown) =>
      error instanceof OwnerKontextImageInputError && error.code === "INVALID_IMAGE_INPUT");
  }
  assert.equal(getterCalls, 0);
});
