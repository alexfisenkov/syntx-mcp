import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

async function loadValidator() {
  const moduleUrl = new URL("../src/application/owner-seedream-editor-drawing-input-validator.js", import.meta.url).href;
  const dynamicImport = new Function("url", "return import(url)") as (url: string) => Promise<Record<string, unknown>>;
  const loaded = await dynamicImport(moduleUrl).catch(() => null) as Record<string, unknown> | null;
  assert.ok(loaded, "MISSING_SEEDREAM_EDITOR_DRAWING_VALIDATOR_MODULE");
  assert.equal(typeof loaded.validateOwnerSeedreamEditorDrawingInput, "function");
  assert.equal(typeof loaded.validateOwnerSeedreamEditorDrawingUploadData, "function");
  return loaded as unknown as {
    OWNER_SEEDREAM_EDITOR_DRAWING_INPUT_POLICY: Readonly<Record<string, unknown>>;
    OwnerSeedreamEditorDrawingInputError: new (...args: never[]) => Error & { readonly code: string };
    validateOwnerSeedreamEditorDrawingInput(input: unknown): Validated;
    validateOwnerSeedreamEditorDrawingUploadData(input: unknown): Validated;
  };
}

type Validated = { readonly bytes: Uint8Array; readonly filename: string; readonly mime_type: string; readonly width: number;
  readonly height: number; readonly size: number; readonly sha256: string; readonly metadata_confidence: string;
  readonly pixel_decode_verified: false; readonly dispatch_allowed: false; readonly backend_acceptance: "UNPROVEN" };

function base64Input(bytes: Uint8Array, extras: Record<string, unknown> = {}) {
  return { content_base64: Buffer.from(bytes).toString("base64"), filename: "drawing.png", mime_type: "image/png", ...extras };
}

test("Seedream Editor drawing exposes a strict PNG validator pair", async () => {
  const validator = await loadValidator();
  const value = validator.validateOwnerSeedreamEditorDrawingInput(base64Input(PNG_1X1, { original_width: 1, original_height: 1 }));
  assert.deepEqual(Buffer.from(value.bytes), PNG_1X1);
  assert.equal(value.filename, "drawing.png"); assert.equal(value.mime_type, "image/png");
  assert.equal(value.width, 1); assert.equal(value.height, 1); assert.equal(value.size, PNG_1X1.byteLength);
  assert.equal(value.sha256, `sha256:${createHash("sha256").update(PNG_1X1).digest("hex")}`);
  assert.equal(value.metadata_confidence, "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS");
  assert.equal(value.pixel_decode_verified, false); assert.equal(value.dispatch_allowed, false); assert.equal(value.backend_acceptance, "UNPROVEN");
  assert.equal(Object.getOwnPropertyDescriptor(value, "bytes")?.enumerable, false);
  assert.equal(validator.OWNER_SEEDREAM_EDITOR_DRAWING_INPUT_POLICY.local_resource_bound_bytes, 32 * 1024 * 1024);
  assert.equal(validator.OWNER_SEEDREAM_EDITOR_DRAWING_INPUT_POLICY.dispatch_allowed, false);
  value.bytes.fill(0);
});

test("raw DTO snapshots caller-owned bytes, enforces geometry pair, and rejects spoofed PNG/MIME/CRC", async () => {
  const validator = await loadValidator();
  const wrapped = Buffer.concat([Buffer.from([0xaa]), PNG_1X1, Buffer.from([0xbb])]);
  const value = validator.validateOwnerSeedreamEditorDrawingUploadData({ bytes: wrapped.subarray(1, -1), filename: "drawing.png", mime_type: "image/png" });
  wrapped.fill(0); assert.deepEqual(Buffer.from(value.bytes), PNG_1X1); value.bytes.fill(0);
  const invalid = (error: unknown, code = "INVALID_IMAGE_INPUT") => error instanceof validator.OwnerSeedreamEditorDrawingInputError && error.code === code;
  assert.throws(() => validator.validateOwnerSeedreamEditorDrawingInput(base64Input(PNG_1X1, { original_width: 1 })), invalid);
  assert.throws(() => validator.validateOwnerSeedreamEditorDrawingInput(base64Input(PNG_1X1, { original_width: 2, original_height: 1 })), invalid);
  assert.throws(() => validator.validateOwnerSeedreamEditorDrawingInput(base64Input(PNG_1X1, { mime_type: "image/jpeg" })), invalid);
  assert.throws(() => validator.validateOwnerSeedreamEditorDrawingInput(base64Input(PNG_1X1, { filename: "../drawing.png" })), invalid);
  assert.throws(() => validator.validateOwnerSeedreamEditorDrawingInput({ ...base64Input(PNG_1X1), extra: true }), invalid);
  const corrupt = Buffer.from(PNG_1X1); corrupt[29] = corrupt[29]! ^ 1;
  assert.throws(() => validator.validateOwnerSeedreamEditorDrawingInput(base64Input(corrupt)), invalid);
  assert.throws(() => validator.validateOwnerSeedreamEditorDrawingInput(base64Input(Buffer.from("not png"))), invalid);
});

test("raw DTO rejects accessors, proxies, revoked views, and accepts only the exact byte cap", async () => {
  const validator = await loadValidator();
  const invalid = (error: unknown, code = "INVALID_IMAGE_INPUT") => error instanceof validator.OwnerSeedreamEditorDrawingInputError && error.code === code;
  const accessor = Object.defineProperties({}, {
    bytes: { enumerable: true, get() { throw new Error("getter must not run"); } },
    filename: { enumerable: true, value: "drawing.png" }, mime_type: { enumerable: true, value: "image/png" }
  });
  assert.throws(() => validator.validateOwnerSeedreamEditorDrawingUploadData(accessor), invalid);
  assert.throws(() => validator.validateOwnerSeedreamEditorDrawingUploadData(new Proxy({ bytes: PNG_1X1, filename: "drawing.png", mime_type: "image/png" }, {})), invalid);
  const revocable = Proxy.revocable(new Uint8Array(PNG_1X1), {}); revocable.revoke();
  assert.throws(() => validator.validateOwnerSeedreamEditorDrawingUploadData({ bytes: revocable.proxy, filename: "drawing.png", mime_type: "image/png" }), invalid);
  const over = new Uint8Array(32 * 1024 * 1024 + 1);
  assert.throws(() => validator.validateOwnerSeedreamEditorDrawingUploadData({ bytes: over, filename: "drawing.png", mime_type: "image/png" }),
    (error: unknown) => invalid(error, "LOCAL_RESOURCE_LIMIT_EXCEEDED"));
  assert.equal(over[0], 0, "invalid input is not adopted or mutated");
});
