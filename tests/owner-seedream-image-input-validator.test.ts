import assert from "node:assert/strict";
import test from "node:test";
import { OWNER_SEEDREAM_IMAGE_INPUT_POLICY, validateOwnerSeedreamImageInput, validateOwnerSeedreamImageUploadData } from "../src/application/owner-seedream-image-input-validator.js";
import { inspectOwnerSeedreamExtraImageBytes } from "../src/application/owner-seedream-extra-image-inspector.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const JPEG = Buffer.from([0xff,0xd8,0xff,0xc0,0,0x0b,8,0,1,0,1,1,1,0x11,0,0xff,0xda,0,8,1,1,0,0,0x3f,0,0,0xff,0xd9]);
const WEBP = Buffer.from([0x52,0x49,0x46,0x46,0x12,0,0,0,0x57,0x45,0x42,0x50,0x56,0x50,0x38,0x4c,5,0,0,0,0x2f,0,0,0,0,0]);
const AVIF = Buffer.from("AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAkAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAQAAAAEAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAsbWRhdAoKAAAAAZ/41fIAgDIWEACXgBBAggAAEABcEytNbG+TY8nR6A==", "base64");

function bmp(width = 20, height = 20): Buffer {
  const row = Math.ceil(width * 24 / 32) * 4, b = Buffer.alloc(54 + row * height);
  b.write("BM"); b.writeUInt32LE(b.length, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14);
  b.writeInt32LE(width, 18); b.writeInt32LE(height, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(row * height, 34); return b;
}
function gif(animated = false): Buffer {
  const header = Buffer.from("GIF89a", "ascii"), screen = Buffer.from([20,0,20,0,0x80,0,0]);
  const frame = Buffer.from([0x2c,0,0,0,0,20,0,20,0,0,2,1,0,0]);
  return Buffer.concat([header, screen, Buffer.alloc(6), frame, ...(animated ? [frame] : []), Buffer.from([0x3b])]);
}
function twoFrameGif(): Buffer {
  // Literal GIF89a framing: 20×20 logical screen, two full-canvas image
  // descriptors, each with a one-byte image-data sub-block and terminator.
  return Buffer.from([
    0x47,0x49,0x46,0x38,0x39,0x61, 0x14,0x00,0x14,0x00,0x80,0x00,0x00, 0,0,0,0,0,0,
    0x2c,0x00,0x00,0x00,0x00,0x14,0x00,0x14,0x00,0x00,0x02,0x01,0x00,0x00,
    0x2c,0x00,0x00,0x00,0x00,0x14,0x00,0x14,0x00,0x80, 0,0,0,0,0,0,0x02,0x01,0x00,0x00,
    0x3b
  ]);
}
function manyFrameGif(count: number): Buffer {
  const prefix = Buffer.from([0x47,0x49,0x46,0x38,0x39,0x61,0x14,0,0x14,0,0x80,0,0,0,0,0,0,0,0]);
  const frame = Buffer.from([0x2c,0,0,0,0,0x14,0,0x14,0,0,0x02,0x01,0,0]);
  return Buffer.concat([prefix, ...Array.from({ length: count }, () => frame), Buffer.from([0x3b])]);
}
function tiff(cycle = false, width = 20, height = 20, little = true): Buffer {
  const b = Buffer.alloc(123); b.write(little ? "II" : "MM");
  const w16=(n:number,p:number)=>little?b.writeUInt16LE(n,p):b.writeUInt16BE(n,p), w32=(n:number,p:number)=>little?b.writeUInt32LE(n,p):b.writeUInt32BE(n,p);
  w16(42,2); w32(8,4); w16(9,8);
  const entries = [[256,4,1,width],[257,4,1,height],[259,3,1,1],[262,3,1,2],[273,4,1,122],[277,3,1,3],[278,4,1,height],[279,4,1,1],[284,3,1,1]];
  entries.forEach(([tag,type,count,value],i)=>{ const p=10+i*12; w16(tag!,p); w16(type!,p+2); w32(count!,p+4); type===3 ? w16(value!,p+8) : w32(value!,p+8); });
  w32(cycle ? 8 : 0, 10+9*12); b[122]=1; return b;
}
function multiPageTiff(little: boolean, pageCount = 2): Buffer {
  // Literal TIFF 6.0 layout: classic header, five-entry IFDs chained from 8,
  // and one in-bounds strip byte per page.
  const firstIfd = 8, ifdBytes = 66, dataStart = firstIfd + ifdBytes * pageCount;
  const b = Buffer.alloc(dataStart + pageCount); b.write(little ? "II" : "MM");
  const w16=(n:number,p:number)=>little?b.writeUInt16LE(n,p):b.writeUInt16BE(n,p), w32=(n:number,p:number)=>little?b.writeUInt32LE(n,p):b.writeUInt32BE(n,p);
  w16(42,2); w32(8,4);
  const writeIfd=(at:number,next:number,data:number)=>{
    w16(5,at);
    const entries=[[256,4,1,20],[257,4,1,20],[259,3,1,1],[273,4,1,data],[279,4,1,1]];
    entries.forEach(([tag,type,count,value],i)=>{const p=at+2+i*12;w16(tag!,p);w16(type!,p+2);w32(count!,p+4);type===3?w16(value!,p+8):w32(value!,p+8);});
    w32(next,at+62);
  };
  for (let i=0;i<pageCount;i+=1) writeIfd(firstIfd+ifdBytes*i,i+1<pageCount?firstIfd+ifdBytes*(i+1):0,dataStart+i);
  for(let i=0;i<pageCount;i+=1)b[dataStart+i]=i+1;
  return b;
}
function pngDimensions(width:number,height:number): Buffer { const b=Buffer.from(PNG); b.writeUInt32BE(width,16); b.writeUInt32BE(height,20); let c=0xffffffff; for(const x of b.subarray(12,29)){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb88320:0);} b.writeUInt32BE((c^0xffffffff)>>>0,29); return b; }
function png20(): Buffer { return pngDimensions(20,20); }
function jpeg20(): Buffer { const b=Buffer.from(JPEG); b.writeUInt16BE(20,7); b.writeUInt16BE(20,9); return b; }
function webp20(): Buffer { const b=Buffer.from(WEBP); b[21]=19; b[23]=4; return b; }
function avif20(): Buffer { const b=Buffer.from(AVIF); const i=b.indexOf(Buffer.from("ispe")); b.writeUInt32BE(20,i+8); b.writeUInt32BE(20,i+12); return b; }
function input(variant: string, bytes: Buffer, mime: string) { return { variant, content_base64: bytes.toString("base64"), filename: "image.bin", mime_type: mime }; }
function heif(primaryType="hvc1", mime:"image/heic"|"image/heif"="image/heif"):Buffer {
  const box=(type:string,payload:Buffer)=>{const h=Buffer.alloc(8);h.writeUInt32BE(payload.length+8);h.write(type,4);return Buffer.concat([h,payload]);};
  const brands=mime==="image/heic"?["heic","mif1","heic"]:["mif1","heif","mif1"];
  const ftyp=box("ftyp",Buffer.concat([Buffer.from(brands[0]!),Buffer.alloc(4),...brands.slice(1).map(x=>Buffer.from(x))]));
  const hdlr=box("hdlr",Buffer.concat([Buffer.alloc(8),Buffer.from("pict"),Buffer.alloc(12)]));
  const pitm=box("pitm",Buffer.from([0,0,0,0,0,1]));
  const infe=box("infe",Buffer.concat([Buffer.from([2,0,0,0,0,1,0,0]),Buffer.from(primaryType),Buffer.from([0])]));
  const iinf=box("iinf",Buffer.concat([Buffer.from([0,0,0,0,0,1]),infe]));
  const ispe=box("ispe",Buffer.from([0,0,0,0,0,0,0,20,0,0,0,20]));
  const iprp=box("iprp",Buffer.concat([box("ipco",ispe),box("ipma",Buffer.from([0,0,0,0,0,0,0,1,0,1,1,1]))]));
  return Buffer.concat([ftyp,box("meta",Buffer.concat([Buffer.alloc(4),hdlr,pitm,iinf,iprp])),box("mdat",Buffer.from([1]))]);
}

test("accepts source-declared basic image containers across all five exact variants", () => {
  const cases = [[JPEG,"image/jpeg"],[JPEG,"image/jpg"],[PNG,"image/png"],[WEBP,"image/webp"],[AVIF,"image/avif"]] as const;
  for (const variant of ["seedream-4","seedream-4.5","seedream-5","seedream-5.0-flash","seedream-5.0-pro"]) {
    for (const [small,mime] of cases) {
      if ((variant === "seedream-5.0-flash" || variant === "seedream-5.0-pro") && mime === "image/avif") {
        assertInvalid(() => validateOwnerSeedreamImageInput(input(variant,small,mime)));
        continue;
      }
      const bytes = variant === "seedream-5.0-flash" || variant === "seedream-5.0-pro"
        ? mime === "image/jpeg" || mime === "image/jpg" ? jpeg20() : mime === "image/png" ? png20() : mime === "image/webp" ? webp20() : avif20()
        : small;
      const result = validateOwnerSeedreamImageInput(input(variant,bytes,mime));
      assert.equal(result.variant,variant); assert.equal(result.mime_type,mime === "image/jpg" ? "image/jpeg" : mime);
      assert.equal(result.size,bytes.byteLength); assert.equal(result.metadata_confidence,"CONTAINER_METADATA_ONLY");
    }
  }
});

test("extra source formats are admitted only for Flash and Pro and report dimensions", () => {
  for (const [bytes,mime] of [[bmp(),"image/bmp"],[gif(),"image/gif"],[tiff(),"image/tiff"]] as const) {
    for (const variant of ["seedream-5.0-flash","seedream-5.0-pro"]) {
      const result = validateOwnerSeedreamImageInput(input(variant,bytes,mime));
      assert.equal(result.width,20); assert.equal(result.height,20);
    }
    assertInvalid(() => validateOwnerSeedreamImageInput(input("seedream-5",bytes,mime)));
  }
  assert.equal(validateOwnerSeedreamImageInput(input("seedream-5.0-flash",tiff(false,20,20,false),"image/tiff")).width,20);
});

test("accepts a complete two-frame GIF from its logical screen geometry", () => {
  const inspected = inspectOwnerSeedreamExtraImageBytes(twoFrameGif(), "image/gif");
  assert.deepEqual({ mime: inspected.mime, width: inspected.width, height: inspected.height },
    { mime: "image/gif", width: 20, height: 20 });
  for (const variant of ["seedream-5.0-flash", "seedream-5.0-pro"] as const) {
    const result = validateOwnerSeedreamImageInput(input(variant, twoFrameGif(), "image/gif"));
    assert.equal(result.width, 20); assert.equal(result.height, 20);
    assert.equal(result.metadata_confidence, "CONTAINER_METADATA_ONLY");
  }
});

test("accepts bounded two-page TIFF IFD chains in both byte orders", () => {
  for (const little of [true, false]) {
    const result = inspectOwnerSeedreamExtraImageBytes(multiPageTiff(little), "image/tiff");
    assert.deepEqual({ mime: result.mime, width: result.width, height: result.height },
      { mime: "image/tiff", width: 20, height: 20 });
  }
});

test("rejects incomplete and out-of-canvas GIF frames and enforces the frame cap", () => {
  const incomplete = twoFrameGif().subarray(0, -1);
  assert.throws(() => inspectOwnerSeedreamExtraImageBytes(incomplete, "image/gif"),
    (e: unknown) => e instanceof Error && "code" in e && e.code === "INVALID_IMAGE_CONTAINER");
  const outside = twoFrameGif(); outside.writeUInt16LE(1, 33); // second descriptor left=1, width remains 20
  assert.throws(() => inspectOwnerSeedreamExtraImageBytes(outside, "image/gif"),
    (e: unknown) => e instanceof Error && "code" in e && e.code === "INVALID_IMAGE_CONTAINER");
  assert.throws(() => inspectOwnerSeedreamExtraImageBytes(twoFrameGif().subarray(0, 49), "image/gif"),
    (e: unknown) => e instanceof Error && "code" in e && e.code === "INVALID_IMAGE_CONTAINER");
  assert.throws(() => inspectOwnerSeedreamExtraImageBytes(twoFrameGif().subarray(0, 53), "image/gif"),
    (e: unknown) => e instanceof Error && "code" in e && e.code === "INVALID_IMAGE_CONTAINER");
  assert.throws(() => inspectOwnerSeedreamExtraImageBytes(manyFrameGif(257), "image/gif"),
    (e: unknown) => e instanceof Error && "code" in e && e.code === "UNSUPPORTED_IMAGE_COMPOSITION");
});

test("enforces the TIFF IFD resource cap without truncating page traversal", () => {
  assert.throws(() => inspectOwnerSeedreamExtraImageBytes(multiPageTiff(true, 33), "image/tiff"),
    (e: unknown) => e instanceof Error && "code" in e && e.code === "UNSUPPORTED_IMAGE_COMPOSITION");
});

test("reports the inspector byte ceiling as an explicit local composition limit", () => {
  assert.throws(() => inspectOwnerSeedreamExtraImageBytes(new Uint8Array(32 * 1024 * 1024 + 1), "image/gif"),
    (e: unknown) => e instanceof Error && "code" in e && e.code === "UNSUPPORTED_IMAGE_COMPOSITION");
});

test("HEIC and HEIF MIME declarations use the primary image item, while derived grids stay explicit", () => {
  for (const mime of ["image/heic","image/heif"] as const) {
    for (const variant of ["seedream-5.0-flash","seedream-5.0-pro"] as const) {
      const value = validateOwnerSeedreamImageInput(input(variant,heif("hvc1",mime),mime));
      assert.equal(value.mime_type,mime); assert.equal(value.width,20); assert.equal(value.height,20);
    }
  }
  assert.throws(()=>validateOwnerSeedreamImageInput(input("seedream-5.0-flash",heif("grid","image/heic"),"image/heic")),
    (e:unknown)=>e instanceof Error && "code" in e && e.code === "UNSUPPORTED_IMAGE_COMPOSITION");
});

test("extra inspector rejects truncated files and TIFF IFD cycles", () => {
  assert.throws(()=>inspectOwnerSeedreamExtraImageBytes(bmp().subarray(0,53),"image/bmp"));
  const badBmp=bmp(); badBmp.writeUInt32LE(badBmp.length-1,2);
  assert.throws(()=>inspectOwnerSeedreamExtraImageBytes(badBmp,"image/bmp"));
  assert.throws(()=>inspectOwnerSeedreamExtraImageBytes(tiff(true),"image/tiff"));
  assert.deepEqual(inspectOwnerSeedreamExtraImageBytes(gif(true),"image/gif").width, 20);
  const outside = tiff(); outside.writeUInt32LE(999, 66);
  assert.throws(() => inspectOwnerSeedreamExtraImageBytes(outside, "image/tiff"),
    (e: unknown) => e instanceof Error && "code" in e && e.code === "INVALID_IMAGE_CONTAINER");
  const badIfd = tiff(); badIfd.writeUInt32LE(124, 118);
  assert.throws(() => inspectOwnerSeedreamExtraImageBytes(badIfd, "image/tiff"),
    (e: unknown) => e instanceof Error && "code" in e && e.code === "INVALID_IMAGE_CONTAINER");
});

test("raw byte DTO snapshots subarray and rejects proxy/accessor inputs without invoking them", () => {
  const backing = Buffer.concat([Buffer.from([99]), PNG, Buffer.from([88])]);
  const original = Buffer.from(backing);
  const result = validateOwnerSeedreamImageUploadData({ variant:"seedream-5", bytes:backing.subarray(1,-1), filename:"p.png", mime_type:"image/png" });
  assert.deepEqual(backing,original); assert.equal(result.bytes.byteOffset,0); assert.equal(result.bytes.buffer.byteLength,PNG.byteLength);
  let calls=0; const dto=Object.defineProperties({}, {variant:{enumerable:true,get(){calls++;return "seedream-5"}},bytes:{enumerable:true,value:PNG},filename:{enumerable:true,value:"p.png"},mime_type:{enumerable:true,value:"image/png"}});
  assertInvalid(()=>validateOwnerSeedreamImageUploadData(dto)); assert.equal(calls,0);
});

test("Seedream image structural dimensions enforce Flash and Pro source bounds", () => {
  const tooSmall = pngDimensions(14,14);
  assertInvalid(()=>validateOwnerSeedreamImageInput(input("seedream-5.0-flash",tooSmall,"image/png")));
  assert.equal(validateOwnerSeedreamImageInput(input("seedream-5.0-flash",pngDimensions(15,15),"image/png")).width,15);
  assert.equal(validateOwnerSeedreamImageInput(input("seedream-5.0-pro",pngDimensions(15,240),"image/png")).height,240);
  assert.equal(validateOwnerSeedreamImageInput(input("seedream-5.0-pro",pngDimensions(240,15),"image/png")).width,240);
  assertInvalid(()=>validateOwnerSeedreamImageInput(input("seedream-5.0-pro",pngDimensions(15,241),"image/png")));
  assertInvalid(()=>validateOwnerSeedreamImageInput(input("seedream-5.0-pro",pngDimensions(241,15),"image/png")));
  assert.equal(validateOwnerSeedreamImageInput(input("seedream-5.0-pro",pngDimensions(6_000,6_000),"image/png")).width,6_000);
  assertInvalid(()=>validateOwnerSeedreamImageInput(input("seedream-5.0-pro",pngDimensions(6_001,100),"image/png")));
  assert.equal(validateOwnerSeedreamImageInput(input("seedream-5",PNG,"image/png")).width,1);
});

test("input source policy keeps generic and per-image byte ceilings separate", () => {
  assert.deepEqual(OWNER_SEEDREAM_IMAGE_INPUT_POLICY.image_byte_caps,{legacy:10_485_760,flash:11_010_048,pro:27_525_120});
  assert.equal(OWNER_SEEDREAM_IMAGE_INPUT_POLICY.generic_byte_caps.flash_pro,31_457_280);
  const above = (n:number) => new Uint8Array(n + 1);
  for (const [variant,size] of [["seedream-4",10_485_760],["seedream-4.5",10_485_760],["seedream-5",10_485_760],
    ["seedream-5.0-flash",11_010_048],["seedream-5.0-pro",27_525_120]] as const) {
    assert.throws(()=>validateOwnerSeedreamImageUploadData({variant,bytes:above(size),filename:"x",mime_type:"image/png"}),
      (e:unknown)=>e instanceof Error && "code" in e && e.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED");
  }
});

function assertInvalid(run:()=>unknown): void { assert.throws(run,(e:unknown)=>e instanceof Error && "code" in e && e.code === "INVALID_IMAGE_INPUT"); }
