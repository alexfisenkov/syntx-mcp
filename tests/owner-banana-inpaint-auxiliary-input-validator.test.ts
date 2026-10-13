import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  validateOwnerBananaInpaintAuxiliaryInput,
  validateOwnerBananaInpaintAuxiliaryUploadData,
  OWNER_BANANA_INPAINT_AUXILIARY_INPUT_POLICY
} from "../src/application/owner-banana-inpaint-auxiliary-input-validator.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const jpeg = Buffer.from([0xff,0xd8,0xff,0xc0,0,0x0b,8,0,1,0,1,1,1,0x11,0,0xff,0xda,0,8,1,1,0,0,0x3f,0,0,0xff,0xd9]);
const webp = Buffer.from([0x52,0x49,0x46,0x46,0x12,0,0,0,0x57,0x45,0x42,0x50,0x56,0x50,0x38,0x4c,5,0,0,0,0x2f,0,0,0,0,0]);
const avif = Buffer.from("AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAkAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAQAAAAEAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAsbWRhdAoKAAAAAZ/41fIAgDIWEACXgBBAggAAEABcEytNbG+TY8nR6A==", "base64");
const variants = ["banana", "banana2", "banana3", "banana3_light"] as const;

function bmp(): Buffer {
  const width = 20, height = 20, row = Math.ceil(width * 24 / 32) * 4;
  const bytes = Buffer.alloc(54 + row * height);
  bytes.write("BM"); bytes.writeUInt32LE(bytes.length, 2); bytes.writeUInt32LE(54, 10); bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18); bytes.writeInt32LE(height, 22); bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28);
  bytes.writeUInt32LE(row * height, 34); return bytes;
}

function gif(): Buffer {
  return Buffer.from([0x47,0x49,0x46,0x38,0x39,0x61, 0x14,0,0x14,0,0x80,0,0, 0,0,0,0,0,0,
    0x2c,0,0,0,0,0x14,0,0x14,0,0,0x02,0x01,0,0,0x3b]);
}

function tiff(): Buffer {
  const b = Buffer.alloc(123); b.write("II"); b.writeUInt16LE(42, 2); b.writeUInt32LE(8, 4); b.writeUInt16LE(9, 8);
  const entries = [[256,4,1,20],[257,4,1,20],[259,3,1,1],[262,3,1,2],[273,4,1,122],[277,3,1,3],[278,4,1,20],[279,4,1,1],[284,3,1,1]];
  entries.forEach(([tag,type,count,value], i) => { const p = 10 + i * 12; b.writeUInt16LE(tag!, p); b.writeUInt16LE(type!, p + 2);
    b.writeUInt32LE(count!, p + 4); type === 3 ? b.writeUInt16LE(value!, p + 8) : b.writeUInt32LE(value!, p + 8); });
  b.writeUInt32LE(0, 118); b[122] = 1; return b;
}

function heif(mime: "image/heic" | "image/heif"): Buffer {
  const box = (type: string, payload: Buffer) => { const h = Buffer.alloc(8); h.writeUInt32BE(payload.length + 8); h.write(type, 4); return Buffer.concat([h, payload]); };
  const brands = mime === "image/heic" ? ["heic", "mif1", "heic"] : ["mif1", "heif", "mif1"];
  const ftyp = box("ftyp", Buffer.concat([Buffer.from(brands[0]!), Buffer.alloc(4), ...brands.slice(1).map((item) => Buffer.from(item))]));
  const hdlr = box("hdlr", Buffer.concat([Buffer.alloc(8), Buffer.from("pict"), Buffer.alloc(12)]));
  const pitm = box("pitm", Buffer.from([0,0,0,0,0,1]));
  const infe = box("infe", Buffer.concat([Buffer.from([2,0,0,0,0,1,0,0]), Buffer.from("hvc1"), Buffer.from([0])]));
  const iinf = box("iinf", Buffer.concat([Buffer.from([0,0,0,0,0,1]), infe]));
  const ispe = box("ispe", Buffer.from([0,0,0,0,0,0,0,20,0,0,0,20]));
  const iprp = box("iprp", Buffer.concat([box("ipco", ispe), box("ipma", Buffer.from([0,0,0,0,0,0,0,1,0,1,1,1]))]));
  return Buffer.concat([ftyp, box("meta", Buffer.concat([Buffer.alloc(4), hdlr, pitm, iinf, iprp])), box("mdat", Buffer.from([1]))]);
}

function assertCode(operation: () => unknown, code: string): void {
  assert.throws(operation, (error: unknown) => error instanceof Error && "code" in error && error.code === code);
}

test("validates an auxiliary PNG into owned image metadata for all four exact Banana variants", () => {
  for (const variant of variants) {
    const validated = validateOwnerBananaInpaintAuxiliaryInput({
      variant, content_base64: png.toString("base64"), filename: "auxiliary.png", mime_type: "image/png"
    });
    assert.equal(validated.variant, variant);
    assert.equal(validated.kind, "auxiliary_image");
    assert.equal(validated.original_mime_type, "image/png");
    assert.equal(validated.mime_type, "image/png");
    assert.equal(validated.width, 1);
    assert.equal(validated.height, 1);
    assert.equal(validated.size, png.byteLength);
    assert.equal(validated.sha256, `sha256:${createHash("sha256").update(png).digest("hex")}`);
    assert.equal(validated.metadata_confidence, "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS");
    assert.equal(validated.backend_acceptance, "UNPROVEN");
  }
  assert.equal(OWNER_BANANA_INPAINT_AUXILIARY_INPUT_POLICY.local_resource_bound_bytes, 50 * 1024 * 1024);
  assert.equal(OWNER_BANANA_INPAINT_AUXILIARY_INPUT_POLICY.size_policy, "LOCAL_RESOURCE_BOUND_ONLY");
});

test("uses existing local inspectors for the nine known raster formats and canonicalizes only the JPEG alias", () => {
  const cases = [
    { bytes: jpeg, mime: "image/jpeg", canonical: "image/jpeg", width: 1 },
    { bytes: jpeg, mime: "image/jpg", canonical: "image/jpeg", width: 1 },
    { bytes: png, mime: "image/png", canonical: "image/png", width: 1 },
    { bytes: webp, mime: "image/webp", canonical: "image/webp", width: 1 },
    { bytes: avif, mime: "image/avif", canonical: "image/avif", width: 16 },
    { bytes: bmp(), mime: "image/bmp", canonical: "image/bmp", width: 20 },
    { bytes: gif(), mime: "image/gif", canonical: "image/gif", width: 20 },
    { bytes: tiff(), mime: "image/tiff", canonical: "image/tiff", width: 20 },
    { bytes: heif("image/heic"), mime: "image/heic", canonical: "image/heic", width: 20 },
    { bytes: heif("image/heif"), mime: "image/heif", canonical: "image/heif", width: 20 }
  ] as const;
  for (const item of cases) {
    const result = validateOwnerBananaInpaintAuxiliaryInput({ variant: "banana3_light", content_base64: item.bytes.toString("base64"),
      filename: "reference.image", mime_type: item.mime });
    assert.equal(result.original_mime_type, item.mime);
    assert.equal(result.mime_type, item.canonical);
    assert.equal(result.width, item.width);
    assert.equal(result.height, item.width);
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.equal(result.pixel_decode_verified, false);
  }
  assert.equal(cases.length, 10, "nine local formats plus the byte-verified JPEG MIME alias");
});

test("rejects unsupported image wildcard formats, MIME/signature mismatch, malformed base64, and extras", () => {
  for (const mime of ["image/svg+xml", "image/x-icon", "image/unknown"] as const) {
    assertCode(() => validateOwnerBananaInpaintAuxiliaryInput({ variant: "banana", content_base64: png.toString("base64"),
      filename: "x.image", mime_type: mime }), "UNSUPPORTED_IMAGE_FORMAT");
  }
  assertCode(() => validateOwnerBananaInpaintAuxiliaryInput({ variant: "banana", content_base64: png.toString("base64"),
    filename: "x.jpg", mime_type: "image/jpeg" }), "INVALID_IMAGE_INPUT");
  assertCode(() => validateOwnerBananaInpaintAuxiliaryInput({ variant: "banana", content_base64: "%%%", filename: "x.png", mime_type: "image/png" }),
    "INVALID_IMAGE_INPUT");
  assertCode(() => validateOwnerBananaInpaintAuxiliaryInput({ variant: "banana_inpaint", content_base64: png.toString("base64"),
    filename: "x.png", mime_type: "image/png" }), "INVALID_IMAGE_INPUT");
  assertCode(() => validateOwnerBananaInpaintAuxiliaryInput({ variant: "banana", content_base64: png.toString("base64"),
    filename: "x.png", mime_type: "image/png", extra: true }), "INVALID_IMAGE_INPUT");
  assert.equal(OWNER_BANANA_INPAINT_AUXILIARY_INPUT_POLICY.svg_execution, false);
});

test("raw byte validation snapshots caller data and rejects oversized bytes at the local guard", () => {
  const source = Buffer.from(png);
  const result = validateOwnerBananaInpaintAuxiliaryUploadData({ variant: "banana2", bytes: source, filename: "x.png", mime_type: "image/png" });
  assert.notEqual(result.bytes, source);
  assert.deepEqual(Buffer.from(result.bytes), source);
  assert.deepEqual(source, png);
  const oversized = new Uint8Array(50 * 1024 * 1024 + 1);
  assertCode(() => validateOwnerBananaInpaintAuxiliaryUploadData({ variant: "banana2", bytes: oversized,
    filename: "large.png", mime_type: "image/png" }), "LOCAL_RESOURCE_LIMIT_EXCEEDED");
});
