import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { deflateSync, inflateSync } from "node:zlib";

const MODULE_URL = new URL("../src/application/owner-banana-inpaint-original-validator.js", import.meta.url).href;
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const NONCANONICAL_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYIJ=";
const JPEG_1X1 = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9
]);
type Validated = {
  readonly bytes: Uint8Array; readonly filename: string; readonly original_mime_type: string; readonly mime_type: string;
  readonly width: number; readonly height: number; readonly size: number; readonly sha256: string;
  readonly metadata_confidence: string; readonly pixel_decode_verified: false; readonly confidence_scope: string;
  readonly dispatch_allowed: false; readonly backend_acceptance: "UNPROVEN";
};

async function loadValidator() {
  const loaded = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;
  assert.ok(loaded, "MISSING_BANANA_INPAINT_ORIGINAL_VALIDATOR_MODULE");
  assert.equal(typeof loaded.validateOwnerBananaInpaintOriginalInput, "function", "MISSING_BANANA_INPAINT_ORIGINAL_VALIDATOR");
  assert.equal(typeof loaded.validateOwnerBananaInpaintOriginalUploadData, "function", "MISSING_BANANA_INPAINT_ORIGINAL_BINARY_VALIDATOR");
  return loaded as unknown as {
    OWNER_BANANA_INPAINT_ORIGINAL_INPUT_POLICY: Readonly<Record<string, unknown>>;
    OwnerBananaInpaintOriginalInputError: new (...args: never[]) => Error & { readonly code: string };
    validateOwnerBananaInpaintOriginalInput(input: unknown): Validated;
    validateOwnerBananaInpaintOriginalUploadData(input: unknown): Validated;
  };
}

function base64Input(bytes: Uint8Array, mime_type: string, filename = "original.png") {
  return { content_base64: Buffer.from(bytes).toString("base64"), filename, mime_type };
}

function jpegContainerHeaderAtSize(size: number): Buffer {
  const prefix = JPEG_1X1.subarray(0, JPEG_1X1.byteLength - 2);
  const bytes = Buffer.alloc(size);
  prefix.copy(bytes);
  bytes[size - 2] = 0xff;
  bytes[size - 1] = 0xd9;
  return bytes;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(data.byteLength + 12);
  chunk.writeUInt32BE(data.byteLength, 0);
  chunk.write(type, 4, 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.byteLength)), 8 + data.byteLength);
  return chunk;
}

function makeZlibValidRgbaPng(width: number, height: number, scanlines: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = deflateSync(scanlines, { level: 0 });
  const iend = Buffer.alloc(0);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat), pngChunk("IEND", iend)]);
}

function readPngIdat(bytes: Buffer): Buffer {
  const payloads: Buffer[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.byteLength) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (offset + length + 12 > bytes.byteLength) throw new Error("invalid test PNG fixture");
    if (type === "IDAT") payloads.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
    if (type === "IEND") break;
  }
  if (offset !== bytes.byteLength || payloads.length === 0) throw new Error("invalid test PNG fixture");
  return Buffer.concat(payloads);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

test("accepts only literal source JPEG and PNG originals and reports local container metadata without grant", async () => {
  const validator = await loadValidator();
  for (const [bytes, mime_type, filename] of [[JPEG_1X1, "image/jpeg", "photo.jpg"], [PNG_1X1, "image/png", "photo.png"]] as const) {
    const value = validator.validateOwnerBananaInpaintOriginalInput(base64Input(bytes, mime_type, filename));
    assert.deepEqual(Buffer.from(value.bytes), bytes);
    assert.equal(value.filename, filename);
    assert.equal(value.original_mime_type, mime_type);
    assert.equal(value.mime_type, mime_type);
    assert.equal(value.width, 1);
    assert.equal(value.height, 1);
    assert.equal(value.size, bytes.byteLength);
    assert.equal(value.sha256, `sha256:${createHash("sha256").update(bytes).digest("hex")}`);
    assert.equal(value.metadata_confidence, "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS");
    assert.equal(value.pixel_decode_verified, false);
    assert.equal(value.dispatch_allowed, false);
    assert.equal(value.backend_acceptance, "UNPROVEN");
    assert.equal(Object.hasOwn(value, "model_id"), false);
    assert.equal(Object.hasOwn(value, "reference_handle"), false);
    assert.equal(Object.hasOwn(value, "url"), false);
    assert.equal(Object.getOwnPropertyDescriptor(value, "bytes")?.enumerable, false,
      "the mutable validation snapshot must not be serialized with public metadata");
    assert.equal(JSON.stringify(value).includes(bytes.toString("base64")), false);
  }
  assert.deepEqual(validator.OWNER_BANANA_INPAINT_ORIGINAL_INPUT_POLICY.accepted_mime_types, ["image/jpeg", "image/png"]);
  assert.equal(validator.OWNER_BANANA_INPAINT_ORIGINAL_INPUT_POLICY.form_id, "banana-inpaint");
  assert.equal(validator.OWNER_BANANA_INPAINT_ORIGINAL_INPUT_POLICY.ai_name, "banana_inpaint");
  assert.equal(validator.OWNER_BANANA_INPAINT_ORIGINAL_INPUT_POLICY.module, "useImageEditorTool.js");
  assert.equal(validator.OWNER_BANANA_INPAINT_ORIGINAL_INPUT_POLICY.source_bytes, 12_652);
  assert.equal(validator.OWNER_BANANA_INPAINT_ORIGINAL_INPUT_POLICY.source_sha256,
    "sha256:6ede93da546e372b8a550a00d370a79a65b0e6841942c74317ad7814097ceebe");
  assert.equal(validator.OWNER_BANANA_INPAINT_ORIGINAL_INPUT_POLICY.max_file_size_bytes, 50 * 1024 * 1024);
  assert.equal(validator.OWNER_BANANA_INPAINT_ORIGINAL_INPUT_POLICY.max_files, 1);
  assert.equal(validator.OWNER_BANANA_INPAINT_ORIGINAL_INPUT_POLICY.runtime_usable, false);
  assert.equal(validator.OWNER_BANANA_INPAINT_ORIGINAL_INPUT_POLICY.size_policy,
    "SOURCE_UI_FILE_INPUT_LIMIT_NOT_PROVIDER_LIMIT_OR_DISPATCH_GRANT");
});

test("rejects unsupported MIME, mismatched bytes, noncanonical base64 and unsafe filenames", async () => {
  const validator = await loadValidator();
  const invalid = (error: unknown, code = "INVALID_IMAGE_INPUT") => error instanceof validator.OwnerBananaInpaintOriginalInputError && error.code === code;
  assert.throws(() => validator.validateOwnerBananaInpaintOriginalInput(base64Input(PNG_1X1, "image/webp")), invalid);
  assert.throws(() => validator.validateOwnerBananaInpaintOriginalInput(base64Input(PNG_1X1, "image/jpeg")), invalid);
  assert.throws(() => validator.validateOwnerBananaInpaintOriginalInput({ ...base64Input(PNG_1X1, "image/png"),
    content_base64: `${PNG_1X1.toString("base64")}\n` }), invalid);
  assert.equal(Buffer.from(NONCANONICAL_PNG_BASE64, "base64").equals(PNG_1X1), true,
    "the mutated unused padding bits still decode to the same PNG bytes");
  assert.throws(() => validator.validateOwnerBananaInpaintOriginalInput({ content_base64: NONCANONICAL_PNG_BASE64,
    filename: "image.png", mime_type: "image/png" }), invalid, "non-zero unused base64 padding bits are rejected");
  assert.throws(() => validator.validateOwnerBananaInpaintOriginalInput(base64Input(PNG_1X1, "image/png", "../image.png")), invalid);
  assert.throws(() => validator.validateOwnerBananaInpaintOriginalInput(base64Input(Buffer.from("not image"), "image/png")), invalid);
  let getterCalls = 0;
  const accessor = Object.defineProperties({}, {
    content_base64: { enumerable: true, get() { getterCalls += 1; return PNG_1X1.toString("base64"); } },
    filename: { enumerable: true, value: "image.png" }, mime_type: { enumerable: true, value: "image/png" }
  });
  assert.throws(() => validator.validateOwnerBananaInpaintOriginalInput(accessor), invalid);
  assert.equal(getterCalls, 0);
  assert.throws(() => validator.validateOwnerBananaInpaintOriginalInput(new Proxy(base64Input(PNG_1X1, "image/png"), {})), invalid);
});

test("binary validation snapshots only the supplied view and does not alias later caller mutation", async () => {
  const validator = await loadValidator();
  const original = Buffer.concat([Buffer.from([0xaa]), JPEG_1X1, Buffer.from([0xbb])]);
  const view = original.subarray(1, original.byteLength - 1);
  const validated = validator.validateOwnerBananaInpaintOriginalUploadData({ bytes: view, filename: "image.jpg", mime_type: "image/jpeg" });
  assert.deepEqual(Buffer.from(validated.bytes), JPEG_1X1);
  assert.equal(validated.size, JPEG_1X1.byteLength);
  original.fill(0);
  assert.deepEqual(Buffer.from(validated.bytes), JPEG_1X1);
  assert.throws(() => validator.validateOwnerBananaInpaintOriginalUploadData({ bytes: new Proxy(JPEG_1X1, {}),
    filename: "image.jpg", mime_type: "image/jpeg" }), (error: unknown) => error instanceof validator.OwnerBananaInpaintOriginalInputError);
});

test("accepts a >12 MiB zlib-valid PNG through both raw and base64 validation paths", async () => {
  const validator = await loadValidator();
  const width = 4_096; const height = 768; const rowBytes = width * 4 + 1;
  const scanlines = Buffer.alloc(rowBytes * height);
  for (let row = 0; row < height; row += 1) scanlines[row * rowBytes] = 0;
  const bytes = makeZlibValidRgbaPng(width, height, scanlines);
  assert.ok(bytes.byteLength > 12 * 1024 * 1024);
  assert.deepEqual(inflateSync(readPngIdat(bytes)), scanlines,
    "the large fixture is a complete PNG container with a valid zlib pixel stream");
  const raw = validator.validateOwnerBananaInpaintOriginalUploadData({ bytes, filename: "large.png", mime_type: "image/png" });
  assert.equal(raw.size, bytes.byteLength);
  const base64 = bytes.toString("base64");
  const encoded = validator.validateOwnerBananaInpaintOriginalInput({ content_base64: base64, filename: "large.png", mime_type: "image/png" });
  assert.equal(encoded.size, bytes.byteLength);
  assert.equal(encoded.sha256, raw.sha256);
  raw.bytes.fill(0); encoded.bytes.fill(0); bytes.fill(0);
});

test("accepts exactly the source UI 50 MiB original ceiling and rejects one extra byte", async () => {
  const validator = await loadValidator();
  const limit = 50 * 1024 * 1024;
  // This boundary fixture has JPEG container markers but is not a decodable JPEG;
  // the generic validator checks container metadata, not full JPEG decoding.
  const over = jpegContainerHeaderAtSize(limit + 1);
  over[limit - 2] = 0xff; over[limit - 1] = 0xd9;
  const accepted = validator.validateOwnerBananaInpaintOriginalUploadData({
    bytes: over.subarray(0, limit), filename: "at-limit.jpg", mime_type: "image/jpeg"
  });
  assert.equal(accepted.size, limit);
  assert.equal(accepted.width, 1);
  assert.equal(accepted.height, 1);
  assert.throws(() => validator.validateOwnerBananaInpaintOriginalUploadData({ bytes: over,
    filename: "over-limit.jpg", mime_type: "image/jpeg" }),
  (error: unknown) => error instanceof validator.OwnerBananaInpaintOriginalInputError && error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED");
  accepted.bytes.fill(0);
  over.fill(0);
});
