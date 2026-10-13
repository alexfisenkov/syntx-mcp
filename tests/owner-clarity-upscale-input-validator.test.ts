import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  OwnerClarityUpscaleInputError,
  validateOwnerClarityUpscaleInput
} from "../src/application/owner-clarity-upscale-input-validator.js";
import { inspectBoundedOwnerImageBytes } from "../src/application/owner-image-reference-input-validator.js";

const FFMPEG_AVIF_16X16 = "AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAkAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAQAAAAEAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAsbWRhdAoKAAAAAZ/41fIAgDIWEACXgBBAggAAEABcEytNbG+TY8nR6A==";
const JPEG_1X1 = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9
]);

test("accepts an encoder-produced still AVIF and reports associated container dimensions only", () => {
  const image = validateOwnerClarityUpscaleInput({
    content_base64: FFMPEG_AVIF_16X16,
    filename: "still.avif",
    mime_type: "image/avif"
  });
  assert.equal(image.mime_type, "image/avif");
  assert.equal(image.width, 16);
  assert.equal(image.height, 16);
  assert.equal(image.metadata_confidence, "CONTAINER_METADATA_ONLY");
  assert.equal(image.sha256, createHash("sha256").update(Buffer.from(FFMPEG_AVIF_16X16, "base64")).digest("hex"));
  assert.equal(Buffer.compare(Buffer.from(image.bytes), Buffer.from(FFMPEG_AVIF_16X16, "base64")), 0);
});

test("rejects caller MIME that disagrees with the sniffed image format", () => {
  assert.throws(() => validateOwnerClarityUpscaleInput({
    content_base64: JPEG_1X1.toString("base64"),
    filename: "still.jpg",
    mime_type: "image/avif"
  }), (error: unknown) => error instanceof OwnerClarityUpscaleInputError && error.code === "INVALID_IMAGE_INPUT");
});

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
const WEBP_1X1 = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x12, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x4c, 0x05, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x00, 0x00
]);

function pngWithDimensions(width: number, height: number): string {
  const bytes = Buffer.from(PNG_1X1, "base64");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  let crc = 0xffff_ffff;
  for (const byte of bytes.subarray(12, 29)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
  }
  bytes.writeUInt32BE((crc ^ 0xffff_ffff) >>> 0, 29);
  return bytes.toString("base64");
}

test("accepts PNG, JPEG, AVIF, and WebP while keeping header dimensions as metadata only", () => {
  const cases = [
    { content_base64: pngWithDimensions(9_000, 9_000), filename: "p.png", mime_type: "image/png" },
    { content_base64: JPEG_1X1.toString("base64"), filename: "j.jpg", mime_type: "image/jpeg" },
    { content_base64: FFMPEG_AVIF_16X16, filename: "a.avif", mime_type: "image/avif" },
    { content_base64: WEBP_1X1.toString("base64"), filename: "w.webp", mime_type: "image/webp" }
  ] as const;
  const results = cases.map((input) => validateOwnerClarityUpscaleInput(input));
  assert.deepEqual(results.map((image) => image.mime_type), ["image/png", "image/jpeg", "image/avif", "image/webp"]);
  assert.equal(results[0]!.width, 9_000);
  assert.equal(results[0]!.height, 9_000);
  assert.ok(results.every((image) => image.metadata_confidence === "CONTAINER_METADATA_ONLY"));
});

test("rejects noncanonical base64, unsafe filenames, and extra properties", () => {
  const base = { content_base64: PNG_1X1, filename: "x.png", mime_type: "image/png" };
  const invalidInputs = [
    { ...base, content_base64: `${PNG_1X1}\n` },
    { ...base, filename: "../x.png" },
    { ...base, extra: "unexpected" }
  ];
  for (const input of invalidInputs) {
    assert.throws(() => validateOwnerClarityUpscaleInput(input), (error: unknown) =>
      error instanceof OwnerClarityUpscaleInputError && error.code === "INVALID_IMAGE_INPUT");
  }
  const accessorInput = Object.defineProperty({ filename: "x.png", mime_type: "image/png" }, "content_base64", {
    enumerable: true, get: () => PNG_1X1
  });
  assert.throws(() => validateOwnerClarityUpscaleInput(accessorInput), (error: unknown) =>
    error instanceof OwnerClarityUpscaleInputError && error.code === "INVALID_IMAGE_INPUT");
});

function makeBox(type: string, payload: Uint8Array): Buffer {
  const box = Buffer.alloc(8 + payload.byteLength);
  box.writeUInt32BE(box.byteLength, 0);
  box.write(type, 4, 4, "ascii");
  Buffer.from(payload).copy(box, 8);
  return box;
}

function makeAvifWithPrimaryDimensions(primary: readonly [number, number], unrelated: readonly [number, number], includeRotation = false): Buffer {
  const full = (version: number, payload: Uint8Array) => Buffer.concat([Buffer.from([version, 0, 0, 0]), Buffer.from(payload)]);
  const u16 = (value: number) => { const b = Buffer.alloc(2); b.writeUInt16BE(value); return b; };
  const u32 = (value: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(value); return b; };
  const ispe = ([width, height]: readonly [number, number]) => makeBox("ispe", full(0, Buffer.concat([u32(width), u32(height)])));
  const ftyp = makeBox("ftyp", Buffer.from("avif\0\0\0\0mif1avif", "ascii"));
  const hdlr = makeBox("hdlr", full(0, Buffer.from([0, 0, 0, 0, ...Buffer.from("pict", "ascii"), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])));
  const pitm = makeBox("pitm", full(0, u16(1)));
  const infe = makeBox("infe", Buffer.concat([full(2, Buffer.concat([u16(1), u16(0), Buffer.from("av01", "ascii"), Buffer.from([0])]))]));
  const iinf = makeBox("iinf", full(0, Buffer.concat([u16(1), infe])));
  const ipco = makeBox("ipco", Buffer.concat([ispe(primary), ispe(unrelated), ...(includeRotation ? [makeBox("irot", Buffer.from([0]))] : [])]));
  const primaryAssociations = includeRotation ? Buffer.from([2, 1, 3]) : Buffer.from([1, 1]);
  const ipma = makeBox("ipma", full(0, Buffer.concat([u32(1), u16(1), primaryAssociations])));
  const iprp = makeBox("iprp", Buffer.concat([ipco, ipma]));
  const meta = makeBox("meta", full(0, Buffer.concat([hdlr, pitm, iinf, iprp])));
  const mdat = makeBox("mdat", Buffer.from([0x00]));
  return Buffer.concat([ftyp, meta, mdat]);
}

test("uses the ispe associated with the primary AVIF item, not an unrelated item property", () => {
  const bytes = makeAvifWithPrimaryDimensions([3, 5], [640, 480]);
  const image = validateOwnerClarityUpscaleInput({
    content_base64: bytes.toString("base64"), filename: "associated.avif", mime_type: "image/avif"
  });
  assert.equal(image.width, 3);
  assert.equal(image.height, 5);
});

test("rejects AVIS sequence branding and HEIC-only branding", () => {
  const original = Buffer.from(FFMPEG_AVIF_16X16, "base64");
  const avis = Buffer.from(original);
  avis.write("avis", 8, 4, "ascii");
  const heic = Buffer.from(original);
  heic.write("heic", 8, 4, "ascii");
  heic.write("mif1", 16, 4, "ascii");
  heic.write("heic", 20, 4, "ascii");
  heic.write("mif1", 24, 4, "ascii");
  for (const bytes of [avis, heic]) {
    assert.throws(() => validateOwnerClarityUpscaleInput({
      content_base64: bytes.toString("base64"), filename: "x.avif", mime_type: "image/avif"
    }), (error: unknown) => error instanceof OwnerClarityUpscaleInputError && error.code === "INVALID_IMAGE_INPUT");
  }
});

test("rejects AVIF truncation, oversized box lengths, excessive item counts, and associated transforms", () => {
  const original = Buffer.from(FFMPEG_AVIF_16X16, "base64");
  const truncated = original.subarray(0, original.length - 1);
  const oversized = Buffer.from(original);
  oversized.writeUInt32BE(0xffff_ffff, 0);
  const excessiveItems = makeAvifWithPrimaryDimensions([3, 5], [640, 480]);
  const ipma = excessiveItems.indexOf(Buffer.from("ipma")) - 4;
  excessiveItems.writeUInt32BE(4097, ipma + 12);
  const badAssociation = makeAvifWithPrimaryDimensions([3, 5], [640, 480]);
  const badIpma = badAssociation.indexOf(Buffer.from("ipma")) - 4;
  badAssociation[badIpma + 19] = 127;
  const rotated = makeAvifWithPrimaryDimensions([3, 5], [640, 480], true);
  for (const bytes of [truncated, oversized, excessiveItems, badAssociation, rotated]) {
    assert.throws(() => validateOwnerClarityUpscaleInput({
      content_base64: bytes.toString("base64"), filename: "x.avif", mime_type: "image/avif"
    }), (error: unknown) => error instanceof OwnerClarityUpscaleInputError && error.code === "INVALID_IMAGE_INPUT");
  }
});

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

test("accepts exactly the Clarity 25 MiB cap and rejects one byte above it", () => {
  const maximum = jpegWithExactSize(25 * 1024 * 1024);
  assert.equal(maximum.byteLength, 25 * 1024 * 1024);
  assert.equal(inspectBoundedOwnerImageBytes(maximum, 25 * 1024 * 1024).width, 1);
  const canonicalMaximum = maximum.toString("base64");
  assert.equal(canonicalMaximum.length, Math.ceil((25 * 1024 * 1024) / 3) * 4);
  assert.equal(canonicalMaximum.length % 4, 0);
  const accepted = validateOwnerClarityUpscaleInput({
    content_base64: canonicalMaximum, filename: "max.jpg", mime_type: "image/jpeg"
  });
  assert.equal(accepted.bytes.byteLength, 25 * 1024 * 1024);
  assert.throws(() => validateOwnerClarityUpscaleInput({
    content_base64: Buffer.concat([maximum, Buffer.from([0])]).toString("base64"), filename: "large.jpg", mime_type: "image/jpeg"
  }), (error: unknown) => error instanceof OwnerClarityUpscaleInputError && error.code === "INVALID_IMAGE_INPUT");
});
