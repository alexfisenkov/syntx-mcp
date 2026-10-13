import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { deflateSync } from "node:zlib";

const MODULE_URL = new URL("../src/application/owner-banana-inpaint-painted-composite-input-validator.js", import.meta.url).href;
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

async function loadValidator() {
  const loaded = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;
  assert.ok(loaded, "MISSING_BANANA_INPAINT_PAINTED_COMPOSITE_VALIDATOR_MODULE");
  assert.equal(typeof loaded.validateOwnerBananaInpaintPaintedCompositeInput, "function");
  assert.equal(typeof loaded.validateOwnerBananaInpaintPaintedCompositeUploadData, "function");
  return loaded as unknown as {
    OWNER_BANANA_INPAINT_PAINTED_COMPOSITE_INPUT_POLICY: Readonly<Record<string, unknown>>;
    OwnerBananaInpaintPaintedCompositeInputError: new (...args: never[]) => Error & { readonly code: string };
    validateOwnerBananaInpaintPaintedCompositeInput(input: unknown): Validated;
    validateOwnerBananaInpaintPaintedCompositeUploadData(input: unknown): Validated;
  };
}

type Validated = {
  readonly bytes: Uint8Array; readonly filename: string; readonly mime_type: string; readonly width: number;
  readonly height: number; readonly size: number; readonly sha256: string; readonly metadata_confidence: string;
  readonly pixel_decode_verified: false; readonly confidence_scope: string; readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
};

function input(bytes: Uint8Array, additions: Record<string, unknown> = {}) {
  return { content_base64: Buffer.from(bytes).toString("base64"), filename: "painted.png", mime_type: "image/png", ...additions };
}

function pngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(data.byteLength + 12);
  chunk.writeUInt32BE(data.byteLength, 0); chunk.write(type, 4, 4, "ascii"); data.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, 8 + data.byteLength)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.byteLength);
  return chunk;
}

function largeValidPng(): Buffer {
  const width = 4_096, height = 2_048, rowBytes = width * 4 + 1;
  const scanlines = Buffer.alloc(rowBytes * height);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const imageData = deflateSync(scanlines, { level: 0 });
  const result = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header),
    pngChunk("IDAT", imageData), pngChunk("IEND", Buffer.alloc(0))]);
  scanlines.fill(0); imageData.fill(0);
  return result;
}

test("accepts a literal painted-composite PNG as local container metadata only", async () => {
  const validator = await loadValidator();
  const value = validator.validateOwnerBananaInpaintPaintedCompositeInput(input(PNG_1X1, { original_width: 1, original_height: 1 }));
  assert.deepEqual(Buffer.from(value.bytes), PNG_1X1);
  assert.equal(value.filename, "painted.png");
  assert.equal(value.mime_type, "image/png");
  assert.equal(value.width, 1); assert.equal(value.height, 1); assert.equal(value.size, PNG_1X1.byteLength);
  assert.equal(value.sha256, `sha256:${createHash("sha256").update(PNG_1X1).digest("hex")}`);
  assert.equal(value.metadata_confidence, "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS");
  assert.equal(value.pixel_decode_verified, false); assert.equal(value.dispatch_allowed, false);
  assert.equal(value.backend_acceptance, "UNPROVEN");
  assert.equal(Object.getOwnPropertyDescriptor(value, "bytes")?.enumerable, false);
  assert.equal(JSON.stringify(value).includes(PNG_1X1.toString("base64")), false);
  assert.equal(validator.OWNER_BANANA_INPAINT_PAINTED_COMPOSITE_INPUT_POLICY.size_policy, "LOCAL_RESOURCE_BOUND_ONLY");
  assert.equal(validator.OWNER_BANANA_INPAINT_PAINTED_COMPOSITE_INPUT_POLICY.dispatch_allowed, false);
});

test("raw validation snapshots only PNG bytes and caller mutation cannot change its result", async () => {
  const validator = await loadValidator();
  const wrapped = Buffer.concat([Buffer.from([0xaa]), PNG_1X1, Buffer.from([0xbb])]);
  const view = wrapped.subarray(1, wrapped.length - 1);
  const value = validator.validateOwnerBananaInpaintPaintedCompositeUploadData({ bytes: view, filename: "paint.png", mime_type: "image/png" });
  wrapped.fill(0);
  assert.deepEqual(Buffer.from(value.bytes), PNG_1X1);
  value.bytes.fill(0);
});

test("rejects MIME/magic mismatch, noncanonical base64, unsafe DTOs, and container geometry mismatch", async () => {
  const validator = await loadValidator();
  const invalid = (error: unknown, code = "INVALID_IMAGE_INPUT") => error instanceof validator.OwnerBananaInpaintPaintedCompositeInputError && error.code === code;
  assert.throws(() => validator.validateOwnerBananaInpaintPaintedCompositeInput(input(PNG_1X1, { mime_type: "image/jpeg" })), invalid);
  assert.throws(() => validator.validateOwnerBananaInpaintPaintedCompositeInput(input(Buffer.from("not PNG"))), invalid);
  const base64 = PNG_1X1.toString("base64");
  assert.throws(() => validator.validateOwnerBananaInpaintPaintedCompositeInput({ ...input(PNG_1X1), content_base64: `${base64}\n` }), invalid);
  assert.throws(() => validator.validateOwnerBananaInpaintPaintedCompositeInput(input(PNG_1X1, { original_width: 2, original_height: 1 })), invalid);
  assert.throws(() => validator.validateOwnerBananaInpaintPaintedCompositeInput(input(PNG_1X1, { original_width: 1 })), invalid);
  assert.throws(() => validator.validateOwnerBananaInpaintPaintedCompositeInput({ ...input(PNG_1X1), extra: true }), invalid);
  assert.throws(() => validator.validateOwnerBananaInpaintPaintedCompositeInput(input(PNG_1X1, { filename: "../paint.png" })), invalid);
});

test("accepts a valid PNG above the unrelated standard 32 MiB guard under the explicit local bound", async () => {
  const validator = await loadValidator();
  const bytes = largeValidPng();
  assert.ok(bytes.byteLength > 32 * 1024 * 1024);
  assert.ok(bytes.byteLength < 50 * 1024 * 1024);
  const value = validator.validateOwnerBananaInpaintPaintedCompositeUploadData({ bytes, filename: "large.png", mime_type: "image/png" });
  assert.equal(value.size, bytes.byteLength);
  assert.equal(value.width, 4_096); assert.equal(value.height, 2_048);
  assert.equal(value.sha256, `sha256:${createHash("sha256").update(bytes).digest("hex")}`);
  value.bytes.fill(0); bytes.fill(0);
});
