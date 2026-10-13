import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  OWNER_SEEDREAM_EDITOR_ORIGINAL_INPUT_POLICY,
  OwnerSeedreamEditorOriginalInputError,
  validateOwnerSeedreamEditorOriginalInput,
  validateOwnerSeedreamEditorOriginalUploadData
} from "../src/application/owner-seedream-editor-original-validator.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const JPEG = Buffer.from([0xff,0xd8,0xff,0xc0,0,0x0b,8,0,1,0,1,1,1,0x11,0,0xff,0xda,0,8,1,1,0,0,0x3f,0,0,0xff,0xd9]);
const WEBP = Buffer.from([0x52,0x49,0x46,0x46,0x12,0,0,0,0x57,0x45,0x42,0x50,0x56,0x50,0x38,0x4c,5,0,0,0,0x2f,0,0,0,0,0]);
const AVIF = Buffer.from("AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAkAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAQAAAAEAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAsbWRhdAoKAAAAAZ/41fIAgDIWEACXgBBAggAAEABcEytNbG+TY8nR6A==", "base64");
const VARIANTS = ["seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-flash", "seedream-5.0-pro"] as const;
const BASIC = ["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"];
const FLASH = ["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/heic", "image/heif", "image/tiff", "image/gif", "image/webp"];
const PRO = ["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/webp", "image/gif", "image/tiff", "image/heic", "image/heif"];

function jpegAtSize(size: number, width = 1, height = 1): Buffer {
  const bytes = Buffer.alloc(size);
  JPEG.copy(bytes, 0, 0, JPEG.length - 2);
  bytes.writeUInt16BE(height, 7); bytes.writeUInt16BE(width, 9);
  bytes[size - 2] = 0xff; bytes[size - 1] = 0xd9;
  return bytes;
}
function bmp(): Buffer {
  const bytes = Buffer.alloc(54 + 4);
  bytes.write("BM"); bytes.writeUInt32LE(bytes.length, 2); bytes.writeUInt32LE(54, 10); bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(1, 18); bytes.writeInt32LE(1, 22); bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28); bytes.writeUInt32LE(4, 34);
  return bytes;
}
function gif(): Buffer {
  return Buffer.from([0x47,0x49,0x46,0x38,0x39,0x61, 1,0,1,0,0x80,0,0, 0,0,0,0,0,0,
    0x2c,0,0,0,0,1,0,1,0,0,0x02,0x01,0,0,0x3b]);
}
function tiff(): Buffer {
  const bytes = Buffer.alloc(123); bytes.write("II"); bytes.writeUInt16LE(42, 2); bytes.writeUInt32LE(8, 4); bytes.writeUInt16LE(9, 8);
  const entries = [[256,4,1,1],[257,4,1,1],[259,3,1,1],[262,3,1,2],[273,4,1,122],[277,3,1,3],[278,4,1,1],[279,4,1,1],[284,3,1,1]];
  entries.forEach(([tag,type,count,value],index)=>{const at=10+index*12;bytes.writeUInt16LE(tag!,at);bytes.writeUInt16LE(type!,at+2);bytes.writeUInt32LE(count!,at+4);type===3?bytes.writeUInt16LE(value!,at+8):bytes.writeUInt32LE(value!,at+8);});
  bytes.writeUInt32LE(0,118); bytes[122]=1; return bytes;
}
function heif(mime: "image/heic" | "image/heif"): Buffer {
  const box = (type: string, payload: Buffer) => { const header=Buffer.alloc(8);header.writeUInt32BE(payload.length+8);header.write(type,4);return Buffer.concat([header,payload]); };
  const brands = mime === "image/heic" ? ["heic","mif1","heic"] : ["mif1","heif","mif1"];
  const ftyp=box("ftyp",Buffer.concat([Buffer.from(brands[0]!),Buffer.alloc(4),...brands.slice(1).map((brand)=>Buffer.from(brand))]));
  const hdlr=box("hdlr",Buffer.concat([Buffer.alloc(8),Buffer.from("pict"),Buffer.alloc(12)]));
  const pitm=box("pitm",Buffer.from([0,0,0,0,0,1]));
  const infe=box("infe",Buffer.concat([Buffer.from([2,0,0,0,0,1,0,0]),Buffer.from("hvc1"),Buffer.from([0])]));
  const iinf=box("iinf",Buffer.concat([Buffer.from([0,0,0,0,0,1]),infe]));
  const ispe=box("ispe",Buffer.from([0,0,0,0,0,0,0,1,0,0,0,1]));
  const iprp=box("iprp",Buffer.concat([box("ipco",ispe),box("ipma",Buffer.from([0,0,0,0,0,0,0,1,0,1,1,1]))]));
  return Buffer.concat([ftyp,box("meta",Buffer.concat([Buffer.alloc(4),hdlr,pitm,iinf,iprp])),box("mdat",Buffer.from([1]))]);
}
function base64Input(variant: string, bytes: Uint8Array, mime_type: string, filename = "original.png") {
  return { variant, content_base64: Buffer.from(bytes).toString("base64"), filename, mime_type };
}
function expectCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof OwnerSeedreamEditorOriginalInputError && error.code === code);
}

test("source policy is five independent underlying-model policies with numeric 10/30 MiB caps", () => {
  assert.deepEqual(OWNER_SEEDREAM_EDITOR_ORIGINAL_INPUT_POLICY.variants, VARIANTS);
  assert.deepEqual(OWNER_SEEDREAM_EDITOR_ORIGINAL_INPUT_POLICY.source_max_file_bytes_by_variant, {
    "seedream-4": 10_485_760, "seedream-4.5": 10_485_760, "seedream-5": 10_485_760,
    "seedream-5.0-flash": 31_457_280, "seedream-5.0-pro": 31_457_280
  });
  for (const variant of VARIANTS.slice(0, 3)) assert.deepEqual(OWNER_SEEDREAM_EDITOR_ORIGINAL_INPUT_POLICY.accepted_file_types_by_variant[variant], BASIC);
  assert.deepEqual(OWNER_SEEDREAM_EDITOR_ORIGINAL_INPUT_POLICY.accepted_file_types_by_variant["seedream-5.0-flash"], FLASH);
  assert.deepEqual(OWNER_SEEDREAM_EDITOR_ORIGINAL_INPUT_POLICY.accepted_file_types_by_variant["seedream-5.0-pro"], PRO);
  assert.equal(OWNER_SEEDREAM_EDITOR_ORIGINAL_INPUT_POLICY.accepted_file_types_by_variant["seedream-5.0-flash"].includes("image/avif" as never), false);
  assert.equal(OWNER_SEEDREAM_EDITOR_ORIGINAL_INPUT_POLICY.local_parser_max_bytes, 32 * 1024 * 1024);
  assert.equal(OWNER_SEEDREAM_EDITOR_ORIGINAL_INPUT_POLICY.max_file_count, 1);
  assert.equal(OWNER_SEEDREAM_EDITOR_ORIGINAL_INPUT_POLICY.dispatch_allowed, false);
  assert.equal(OWNER_SEEDREAM_EDITOR_ORIGINAL_INPUT_POLICY.runtime_usable, false);
  assert.equal(OWNER_SEEDREAM_EDITOR_ORIGINAL_INPUT_POLICY.backend_acceptance, "UNPROVEN");
});

test("raw bytes and strict base64 return equal immutable metadata with a non-enumerable private copy", () => {
  const original = Buffer.concat([Buffer.from([0xaa]), JPEG, Buffer.from([0xbb])]);
  const view = original.subarray(1, original.length - 1);
  const raw = validateOwnerSeedreamEditorOriginalUploadData({ variant: "seedream-5.0-pro", bytes: view, filename: "photo.jpg", mime_type: "image/jpeg" });
  const encoded = validateOwnerSeedreamEditorOriginalInput(base64Input("seedream-5.0-pro", JPEG, "image/jpeg", "photo.jpg"));
  assert.deepEqual({ variant: raw.variant, kind: raw.kind, filename: raw.filename, source_mime_type: raw.source_mime_type,
    mime_type: raw.mime_type, width: raw.width, height: raw.height, size: raw.size, sha256: raw.sha256,
    source_ui_limit_applied: raw.source_ui_limit_applied, source_ui_limit_is_provider_limit: raw.source_ui_limit_is_provider_limit,
    dispatch_allowed: raw.dispatch_allowed, runtime_usable: raw.runtime_usable, backend_acceptance: raw.backend_acceptance }, {
    variant: "seedream-5.0-pro", kind: "image", filename: "photo.jpg", source_mime_type: "image/jpeg", mime_type: "image/jpeg",
    width: 1, height: 1, size: JPEG.length, sha256: `sha256:${createHash("sha256").update(JPEG).digest("hex")}`,
    source_ui_limit_applied: true, source_ui_limit_is_provider_limit: false, dispatch_allowed: false, runtime_usable: false, backend_acceptance: "UNPROVEN"
  });
  assert.deepEqual(Buffer.from(raw.bytes), JPEG);
  assert.deepEqual(Buffer.from(encoded.bytes), JPEG);
  assert.equal(Object.getOwnPropertyDescriptor(raw, "bytes")?.enumerable, false);
  assert.equal(JSON.stringify(raw).includes(JPEG.toString("base64")), false);
  original.fill(0);
  assert.deepEqual(Buffer.from(raw.bytes), JPEG, "the validated bytes are independent of the caller view");
  assert.equal(Object.isFrozen(raw), true);
  raw.bytes.fill(0); encoded.bytes.fill(0);
});

test("structurally inspects the source-declared formats without claiming pixel decoding", () => {
  const avif = Buffer.from(AVIF), ispe = avif.indexOf(Buffer.from("ispe"));
  avif.writeUInt32BE(1, ispe + 8); avif.writeUInt32BE(1, ispe + 12);
  const webp = Buffer.from(WEBP);
  for (const [bytes, mime] of [[JPEG,"image/jpeg"],[JPEG,"image/jpg"],[PNG,"image/png"],[webp,"image/webp"],[avif,"image/avif"]] as const) {
    const result = validateOwnerSeedreamEditorOriginalUploadData({ variant: "seedream-5", bytes, filename: "original.bin", mime_type: mime });
    assert.equal(result.source_mime_type, mime);
    assert.equal(result.width, 1); assert.equal(result.height, 1);
    result.bytes.fill(0);
  }
  for (const [bytes, mime] of [[bmp(),"image/bmp"],[gif(),"image/gif"],[tiff(),"image/tiff"],
    [heif("image/heic"),"image/heic"],[heif("image/heif"),"image/heif"]] as const) {
    const result = validateOwnerSeedreamEditorOriginalUploadData({ variant: "seedream-5.0-flash", bytes, filename: "original.bin", mime_type: mime });
    assert.equal(result.source_mime_type, mime);
    assert.equal(result.width, 1); assert.equal(result.height, 1);
    assert.equal(result.metadata_confidence, "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS");
    result.bytes.fill(0); bytes.fill(0);
  }
});

test("accepts each exact source numeric cap and rejects cap plus one without using ordinary editor-image metadata caps", () => {
  for (const [variant, cap] of [["seedream-4", 10 * 1024 * 1024], ["seedream-5.0-flash", 30 * 1024 * 1024]] as const) {
    const bytes = jpegAtSize(cap);
    const accepted = validateOwnerSeedreamEditorOriginalUploadData({ variant, bytes, filename: "at-cap.jpg", mime_type: "image/jpeg" });
    assert.equal(accepted.size, cap);
    assert.equal(accepted.width, 1);
    assert.equal(accepted.height, 1);
    assert.equal(accepted.metadata_confidence, "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS");
    accepted.bytes.fill(0); bytes.fill(0);
    expectCode(() => validateOwnerSeedreamEditorOriginalUploadData({ variant, bytes: jpegAtSize(cap + 1), filename: "over-cap.jpg", mime_type: "image/jpeg" }), "LOCAL_RESOURCE_LIMIT_EXCEEDED");
  }
});

test("enforces only mapped Flash/Pro aspect ratio and does not inherit ordinary min/max side or pixel limits", () => {
  const wide = Buffer.from(JPEG); wide.writeUInt16BE(16, 9);
  assert.equal(validateOwnerSeedreamEditorOriginalUploadData({ variant: "seedream-5.0-flash", bytes: wide, filename: "wide.jpg", mime_type: "image/jpeg" }).width, 16);
  const tooWide = Buffer.from(JPEG); tooWide.writeUInt16BE(17, 9);
  expectCode(() => validateOwnerSeedreamEditorOriginalUploadData({ variant: "seedream-5.0-flash", bytes: tooWide, filename: "ratio.jpg", mime_type: "image/jpeg" }), "INVALID_IMAGE_INPUT");
  const tiny = Buffer.from(JPEG);
  assert.equal(validateOwnerSeedreamEditorOriginalUploadData({ variant: "seedream-5", bytes: tiny, filename: "tiny.jpg", mime_type: "image/jpeg" }).width, 1);
});

test("rejects variant spoofing, MIME mismatch, aliases outside each source allowlist, hostile DTOs, and unsafe files", () => {
  expectCode(() => validateOwnerSeedreamEditorOriginalInput(base64Input("seedream-editor", PNG, "image/png")), "INVALID_IMAGE_INPUT");
  expectCode(() => validateOwnerSeedreamEditorOriginalInput(base64Input("seedream-5.0-flash", PNG, "image/avif")), "INVALID_IMAGE_INPUT");
  expectCode(() => validateOwnerSeedreamEditorOriginalInput(base64Input("seedream-5", PNG, "image/png", "../image.png")), "INVALID_IMAGE_INPUT");
  expectCode(() => validateOwnerSeedreamEditorOriginalInput(base64Input("seedream-5", PNG, "image/png", "bad\ud800.png")), "INVALID_IMAGE_INPUT");
  expectCode(() => validateOwnerSeedreamEditorOriginalUploadData({ variant: "seedream-5", bytes: new Proxy(PNG, {}), filename: "x.png", mime_type: "image/png" }), "INVALID_IMAGE_INPUT");
  let getterRuns = 0;
  const accessor = Object.defineProperties({}, {
    variant: { enumerable: true, value: "seedream-5" }, bytes: { enumerable: true, value: PNG },
    filename: { enumerable: true, get() { getterRuns += 1; return "x.png"; } }, mime_type: { enumerable: true, value: "image/png" }
  });
  expectCode(() => validateOwnerSeedreamEditorOriginalUploadData(accessor), "INVALID_IMAGE_INPUT");
  assert.equal(getterRuns, 0);
  const extra = { ...base64Input("seedream-5", PNG, "image/png"), width: 1 };
  expectCode(() => validateOwnerSeedreamEditorOriginalInput(extra), "INVALID_IMAGE_INPUT");
});

test("revoked top-level DTO proxies fail with the domain error before Array.isArray or proxy traps", () => {
  const base64 = Proxy.revocable(base64Input("seedream-5", PNG, "image/png"), {});
  base64.revoke();
  expectCode(() => validateOwnerSeedreamEditorOriginalInput(base64.proxy), "INVALID_IMAGE_INPUT");
  const raw = Proxy.revocable({ variant: "seedream-5", bytes: PNG, filename: "image.png", mime_type: "image/png" }, {});
  raw.revoke();
  expectCode(() => validateOwnerSeedreamEditorOriginalUploadData(raw.proxy), "INVALID_IMAGE_INPUT");
});
