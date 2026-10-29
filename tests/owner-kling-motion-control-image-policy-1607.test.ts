import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  OWNER_KLING_MOTION_CONTROL_IMAGE_POLICY,
  OwnerKlingMotionControlImagePolicyError,
  isValidatedOwnerKlingMotionControlImage,
  readValidatedOwnerKlingMotionControlImage,
  releaseValidatedOwnerKlingMotionControlImage,
  validateOwnerKlingMotionControlImage
} from "../src/application/owner-kling-motion-control-image-policy.js";

const PNG_1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
function png(width: number, height: number): Buffer {
  const b = Buffer.from(PNG_1); b.writeUInt32BE(width, 16); b.writeUInt32BE(height, 20); b.writeUInt32BE(crc32(b.subarray(12, 29)), 29); return b;
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); } return (crc ^ 0xffff_ffff) >>> 0;
}
function jpeg(width: number, height: number): Buffer {
  return Buffer.from([0xff,0xd8,0xff,0xc0,0,0x0b,8,height >> 8,height & 255,width >> 8,width & 255,1,1,0x11,0,0xff,0xda,0,8,1,1,0,0,0x3f,0,0,0xff,0xd9]);
}
function box(type: string, payload: Uint8Array): Buffer { const b = Buffer.alloc(8 + payload.byteLength); b.writeUInt32BE(b.length); b.write(type, 4, 4, "ascii"); Buffer.from(payload).copy(b, 8); return b; }
function avif(width: number, height: number): Buffer {
  const full = (version: number, payload: Uint8Array) => Buffer.concat([Buffer.from([version,0,0,0]), Buffer.from(payload)]);
  const u16 = (n: number) => { const b=Buffer.alloc(2); b.writeUInt16BE(n); return b; }, u32 = (n: number) => { const b=Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  const ispe = (w: number,h: number) => box("ispe",full(0,Buffer.concat([u32(w),u32(h)]))), ftyp=box("ftyp",Buffer.from("avif\0\0\0\0mif1avif","ascii"));
  const hdlr=box("hdlr",full(0,Buffer.from([0,0,0,0,...Buffer.from("pict","ascii"),0,0,0,0,0,0,0,0,0,0,0,0]))), pitm=box("pitm",full(0,u16(1)));
  const infe=box("infe",Buffer.concat([full(2,Buffer.concat([u16(1),u16(0),Buffer.from("av01","ascii"),Buffer.from([0])]))]));
  const iinf=box("iinf",full(0,Buffer.concat([u16(1),infe]))), ipco=box("ipco",Buffer.concat([ispe(width,height),ispe(width,height)]));
  const ipma=box("ipma",full(0,Buffer.concat([u32(1),u16(1),Buffer.from([1,1])])));
  const iprp=box("iprp",Buffer.concat([ipco,ipma])), meta=box("meta",full(0,Buffer.concat([hdlr,pitm,iinf,iprp])));
  return Buffer.concat([ftyp,meta,box("mdat",Buffer.from([0]))]);
}
function webp(width: number, height: number): Buffer {
  const chunk=Buffer.alloc(18); chunk.write("VP8 ",0,4,"ascii"); chunk.writeUInt32LE(10,4); chunk[11]=0x9d; chunk[12]=0x01; chunk[13]=0x2a;
  chunk.writeUInt16LE(width,14); chunk.writeUInt16LE(height,16);
  const out=Buffer.alloc(12+chunk.length); out.write("RIFF",0,4,"ascii"); out.writeUInt32LE(out.length-8,4); out.write("WEBP",8,4,"ascii"); chunk.copy(out,12); return out;
}
const input = (bytes: Uint8Array, mime_type: string, filename = "参考素材.img") => ({ filename, mime_type, bytes });
const invalid = (error: unknown) => error instanceof OwnerKlingMotionControlImagePolicyError && error.code === "INVALID_IMAGE_INPUT";

test("pins MCV source facts and the explicit local-only unknown-size cap", () => {
  assert.equal(OWNER_KLING_MOTION_CONTROL_IMAGE_POLICY.model_id, "kling_motion_control");
  assert.deepEqual(OWNER_KLING_MOTION_CONTROL_IMAGE_POLICY.source_mime_types, ["image/jpeg","image/png","image/avif","image/webp"]);
  assert.deepEqual(OWNER_KLING_MOTION_CONTROL_IMAGE_POLICY.current_public_mime_types, ["image/jpeg","image/png","image/avif"]);
  assert.equal(OWNER_KLING_MOTION_CONTROL_IMAGE_POLICY.source_max_file_size_bytes, null);
  assert.equal(OWNER_KLING_MOTION_CONTROL_IMAGE_POLICY.current_public_image_max_bytes, 10 * 1024 * 1024);
  assert.equal(OWNER_KLING_MOTION_CONTROL_IMAGE_POLICY.max_file_size_bytes, 10 * 1024 * 1024);
  assert.equal(OWNER_KLING_MOTION_CONTROL_IMAGE_POLICY.size_limit_confidence, "CURRENT_PUBLIC_10MIB_IMAGE_MAXIMUM_LOCAL_GUARD");
  assert.equal(OWNER_KLING_MOTION_CONTROL_IMAGE_POLICY.generation_permit, false);
  assert.equal(OWNER_KLING_MOTION_CONTROL_IMAGE_POLICY.owner_upload_binding, "NOT_ESTABLISHED");
  assert.equal(OWNER_KLING_MOTION_CONTROL_IMAGE_POLICY.frame_role_binding, "NOT_ESTABLISHED");
});

test("accepts structurally inspected four source formats at 300px and snapshots bytes", () => {
  const cases = [[jpeg(300,301),"image/jpeg"],[png(300,300),"image/png"],[avif(300,300),"image/avif"]] as const;
  for (const [bytes,mime] of cases) {
    const before=Buffer.from(bytes); let receipt;
    try { receipt=validateOwnerKlingMotionControlImage(input(bytes,mime)); } catch (error) { assert.fail(`${mime}: ${String(error)}`); }
    assert.equal(receipt.width,300); assert.ok(receipt.height>=300); assert.equal(receipt.mime_type,mime);
    assert.equal(receipt.sha256,createHash("sha256").update(bytes).digest("hex")); assert.deepEqual(bytes,before);
    assert.equal(receipt.metadata_confidence,"STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED");
    assert.equal(isValidatedOwnerKlingMotionControlImage(receipt),true); releaseValidatedOwnerKlingMotionControlImage(receipt);
  }
  assert.throws(()=>validateOwnerKlingMotionControlImage(input(webp(300,300),"image/webp")),invalid);
});

test("rejects 299px, mismatched MIME, and the unsupported JPG alias", () => {
  assert.throws(()=>validateOwnerKlingMotionControlImage(input(png(299,300),"image/png")),invalid);
  assert.throws(()=>validateOwnerKlingMotionControlImage(input(png(300,300),"image/jpeg")),invalid);
  assert.throws(()=>validateOwnerKlingMotionControlImage(input(jpeg(300,300),"image/jpg")),invalid);
});

test("receipt keeps private bytes, returns fresh copies, and rejects clones", () => {
  const bytes=png(300,300), original=Buffer.from(bytes), receipt=validateOwnerKlingMotionControlImage(input(bytes,"image/png")); bytes.fill(0);
  const read=readValidatedOwnerKlingMotionControlImage(receipt)!; assert.deepEqual(Buffer.from(read.bytes),original); read.bytes.fill(0);
  assert.deepEqual(Buffer.from(readValidatedOwnerKlingMotionControlImage(receipt)!.bytes),original);
  const clone=Object.freeze({...receipt}); assert.equal(isValidatedOwnerKlingMotionControlImage(clone),false);
  assert.equal(readValidatedOwnerKlingMotionControlImage(clone),null); assert.equal(releaseValidatedOwnerKlingMotionControlImage(receipt),true);
  assert.equal(isValidatedOwnerKlingMotionControlImage(receipt),false);
});

test("rejects accessor/proxy inputs without reading accessors", () => {
  let accessed=false; const bad={get filename(){accessed=true;return "x.png";},mime_type:"image/png",bytes:png(300,300)};
  assert.throws(()=>validateOwnerKlingMotionControlImage(bad),invalid); assert.equal(accessed,false);
  assert.throws(()=>validateOwnerKlingMotionControlImage(new Proxy(input(png(300,300),"image/png"),{})),invalid);
});

test("preserves typed unsupported AVIF composition behavior", () => {
  const sequence=avif(300,300); sequence.write("avis",8,4,"ascii");
  assert.throws(()=>validateOwnerKlingMotionControlImage(input(sequence,"image/avif")),(error:unknown)=>
    error instanceof OwnerKlingMotionControlImagePolicyError && error.code === "UNSUPPORTED_AVIF_COMPOSITION");
});
