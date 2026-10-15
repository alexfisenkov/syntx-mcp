import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  OWNER_KLING_KEYFRAMES_IMAGE_POLICY,
  OwnerKlingKeyframesImagePolicyError,
  isValidatedOwnerKlingKeyframesImage,
  readValidatedOwnerKlingKeyframesImage,
  releaseValidatedOwnerKlingKeyframesImage,
  validateOwnerKlingKeyframesImage
} from "../src/application/owner-kling-keyframes-image-policy.js";
import { UnsupportedOwnerClarityAvifCompositionError } from "../src/application/owner-clarity-upscale-input-validator.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const AVIF_16 = Buffer.from("AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAkAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAQAAAAEAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAsbWRhdAoKAAAAAZ/41fIAgDIWEACXgBBAggAAEABcEytNbG+TY8nR6A==", "base64");

function input(bytes: Uint8Array, mime_type: string, filename = "кадр.bin") { return { filename, mime_type, bytes }; }
function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function pngWithDimensions(width: number, height: number): Buffer {
  const bytes = Buffer.from(PNG); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}
function jpegWithDimensions(width: number, height: number): Buffer {
  return Buffer.from([0xff,0xd8,0xff,0xc0,0,0x0b,8,height >> 8,height & 0xff,width >> 8,width & 0xff,1,1,0x11,0,
    0xff,0xda,0,8,1,1,0,0,0x3f,0,0,0xff,0xd9]);
}
function jpegAtSize(size: number): Buffer {
  const tail = jpegWithDimensions(300, 300).subarray(2), parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let remaining = size - 2 - tail.byteLength;
  while (remaining > 65_537) { const segment = Buffer.alloc(65_537); segment[0] = 0xff; segment[1] = 0xe1; segment.writeUInt16BE(65_535, 2); parts.push(segment); remaining -= segment.length; }
  const final = Buffer.alloc(remaining); final[0] = 0xff; final[1] = 0xe1; final.writeUInt16BE(remaining - 2, 2); parts.push(final, tail);
  return Buffer.concat(parts);
}
function makeBox(type: string, payload: Uint8Array): Buffer {
  const box = Buffer.alloc(8 + payload.byteLength); box.writeUInt32BE(box.byteLength, 0); box.write(type, 4, 4, "ascii");
  Buffer.from(payload).copy(box, 8); return box;
}
function avifWithDimensions(width: number, height: number): Buffer {
  const full = (version: number, payload: Uint8Array) => Buffer.concat([Buffer.from([version, 0, 0, 0]), Buffer.from(payload)]);
  const u16 = (value: number) => { const b = Buffer.alloc(2); b.writeUInt16BE(value); return b; };
  const u32 = (value: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(value); return b; };
  const ispe = (w: number, h: number) => makeBox("ispe", full(0, Buffer.concat([u32(w), u32(h)])));
  const ftyp = makeBox("ftyp", Buffer.from("avif\0\0\0\0mif1avif", "ascii"));
  const hdlr = makeBox("hdlr", full(0, Buffer.from([0, 0, 0, 0, ...Buffer.from("pict", "ascii"), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])));
  const pitm = makeBox("pitm", full(0, u16(1)));
  const infe = makeBox("infe", Buffer.concat([full(2, Buffer.concat([u16(1), u16(0), Buffer.from("av01", "ascii"), Buffer.from([0])]))]));
  const iinf = makeBox("iinf", full(0, Buffer.concat([u16(1), infe])));
  const ipco = makeBox("ipco", Buffer.concat([ispe(width, height), ispe(width, height)]));
  const ipma = makeBox("ipma", full(0, Buffer.concat([u32(1), u16(1), Buffer.from([1, 1])])));
  const iprp = makeBox("iprp", Buffer.concat([ipco, ipma]));
  const meta = makeBox("meta", full(0, Buffer.concat([hdlr, pitm, iinf, iprp])));
  return Buffer.concat([ftyp, meta, makeBox("mdat", Buffer.from([0]))]);
}

test("pins B066 keyframe image formats and local-only limits", () => {
  assert.equal(OWNER_KLING_KEYFRAMES_IMAGE_POLICY.model_id, "kling_keyframes");
  assert.deepEqual(OWNER_KLING_KEYFRAMES_IMAGE_POLICY.source_mime_types, ["image/jpg", "image/jpeg", "image/png", "image/avif"]);
  assert.equal(OWNER_KLING_KEYFRAMES_IMAGE_POLICY.max_file_size_bytes, 50 * 1024 * 1024);
  assert.equal(OWNER_KLING_KEYFRAMES_IMAGE_POLICY.min_side, 300);
  assert.equal(OWNER_KLING_KEYFRAMES_IMAGE_POLICY.generation_permit, false);
  assert.equal(OWNER_KLING_KEYFRAMES_IMAGE_POLICY.frame_role_binding, "NOT_ESTABLISHED");
  assert.equal(OWNER_KLING_KEYFRAMES_IMAGE_POLICY.owner_upload_binding, "NOT_ESTABLISHED");
});

test("accepts structurally inspected JPEG alias, PNG, and AVIF at the inclusive minimum", () => {
  const avif = avifWithDimensions(300, 300);
  const cases = [
    [jpegWithDimensions(300, 301), "image/jpg", "image/jpeg", "кадр.jpg"],
    [pngWithDimensions(300, 300), "image/png", "image/png", "кадр.png"],
    [avif, "image/avif", "image/avif", "кадр.avif"]
  ] as const;
  for (const [bytes, sourceMime, canonicalMime, filename] of cases) {
    const before = Buffer.from(bytes);
    let receipt;
    try { receipt = validateOwnerKlingKeyframesImage(input(bytes, sourceMime)); }
    catch (error) { assert.fail(`${sourceMime}: ${String(error)}`); }
    assert.equal(receipt.filename, filename); assert.equal(receipt.mime_type, canonicalMime);
    assert.equal(receipt.width, 300); assert.equal(receipt.height, sourceMime === "image/jpg" ? 301 : 300);
    assert.equal(receipt.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(receipt.generation_permit, false); assert.equal(receipt.frame_role_binding, "NOT_ESTABLISHED");
    assert.equal(Object.isFrozen(receipt), true); assert.deepEqual(bytes, before);
    assert.equal(isValidatedOwnerKlingKeyframesImage(receipt), true);
    const copy = readValidatedOwnerKlingKeyframesImage(receipt)!; assert.deepEqual(Buffer.from(copy.bytes), bytes);
    copy.bytes.fill(0); assert.deepEqual(Buffer.from(readValidatedOwnerKlingKeyframesImage(receipt)!.bytes), bytes);
    assert.equal(releaseValidatedOwnerKlingKeyframesImage(receipt), true);
    assert.equal(isValidatedOwnerKlingKeyframesImage(receipt), false); assert.equal(readValidatedOwnerKlingKeyframesImage(receipt), null);
    assert.equal(releaseValidatedOwnerKlingKeyframesImage(receipt), false);
  }
});

test("rejects WebP, MIME/container mismatch, and dimensions below 300", () => {
  const webp = Buffer.from([0x52,0x49,0x46,0x46,0x16,0,0,0,0x57,0x45,0x42,0x50,0x56,0x50,0x38,0x20,10,0,0,0,0,0,0,0x9d,1,0x2a,0xf0,0,0xf0,0]);
  const invalid = (error: unknown) => error instanceof OwnerKlingKeyframesImagePolicyError && error.code === "INVALID_IMAGE_INPUT";
  assert.throws(() => validateOwnerKlingKeyframesImage(input(webp, "image/webp")), invalid);
  assert.throws(() => validateOwnerKlingKeyframesImage(input(PNG, "image/jpeg")), invalid);
  assert.throws(() => validateOwnerKlingKeyframesImage(input(pngWithDimensions(299, 300), "image/png")), invalid);
  assert.throws(() => validateOwnerKlingKeyframesImage({ ...input(pngWithDimensions(300, 300), "image/png"), width: 300 }), invalid);
  assert.throws(() => validateOwnerKlingKeyframesImage(new Proxy(input(pngWithDimensions(300, 300), "image/png"), {})), invalid);
});

test("keeps a private snapshot when caller bytes change and rejects cloned receipts", () => {
  const source = pngWithDimensions(300, 300), original = Buffer.from(source);
  const receipt = validateOwnerKlingKeyframesImage(input(source, "image/png"));
  source.fill(0);
  const copy = readValidatedOwnerKlingKeyframesImage(receipt)!;
  assert.deepEqual(Buffer.from(copy.bytes), original);
  const clone = Object.freeze({ ...receipt });
  assert.equal(isValidatedOwnerKlingKeyframesImage(clone), false);
  assert.equal(readValidatedOwnerKlingKeyframesImage(clone), null);
  assert.equal(releaseValidatedOwnerKlingKeyframesImage(clone), false);
  releaseValidatedOwnerKlingKeyframesImage(receipt);
});

test("enforces exact 50 MiB gate and keeps cloned/proxied receipts non-authoritative", () => {
  const max = jpegAtSize(50 * 1024 * 1024), receipt = validateOwnerKlingKeyframesImage(input(max, "image/jpeg", "max.jpg"));
  assert.equal(receipt.size, 50 * 1024 * 1024); releaseValidatedOwnerKlingKeyframesImage(receipt);
  const over = Buffer.alloc(50 * 1024 * 1024 + 1);
  assert.throws(() => validateOwnerKlingKeyframesImage(input(over, "image/jpeg")), (error: unknown) =>
    error instanceof OwnerKlingKeyframesImagePolicyError && error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED");
  const genuine = validateOwnerKlingKeyframesImage(input(pngWithDimensions(300, 300), "image/png"));
  const clone = Object.freeze({ ...genuine });
  assert.equal(isValidatedOwnerKlingKeyframesImage(clone), false); assert.equal(readValidatedOwnerKlingKeyframesImage(clone), null);
  assert.equal(releaseValidatedOwnerKlingKeyframesImage(clone), false);
  assert.equal(isValidatedOwnerKlingKeyframesImage(new Proxy(genuine, {})), false);
  assert.equal(releaseValidatedOwnerKlingKeyframesImage(new Proxy(genuine, {})), false);
  releaseValidatedOwnerKlingKeyframesImage(genuine);
});

test("preserves the explicit AVIF unsupported-composition result", () => {
  const sequence = Buffer.from(AVIF_16); sequence.write("avis", 8, 4, "ascii");
  assert.throws(() => validateOwnerKlingKeyframesImage(input(sequence, "image/avif")), (error: unknown) =>
    error instanceof UnsupportedOwnerClarityAvifCompositionError && error.code === "UNSUPPORTED_AVIF_COMPOSITION");
});
