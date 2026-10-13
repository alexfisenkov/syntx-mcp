import assert from "node:assert/strict";
import test from "node:test";
import { inspectOwnerWanImageCoordinateMetadata } from "../src/application/owner-wan-image-coordinate-metadata.js";

function tiffOrientation(orientation: number, littleEndian = true): Buffer {
  const bytes = Buffer.alloc(26);
  bytes.write(littleEndian ? "II" : "MM", 0, "ascii");
  if (littleEndian) {
    bytes.writeUInt16LE(42, 2);
    bytes.writeUInt32LE(8, 4);
    bytes.writeUInt16LE(1, 8);
    bytes.writeUInt16LE(274, 10);
    bytes.writeUInt16LE(3, 12);
    bytes.writeUInt32LE(1, 14);
    bytes.writeUInt16LE(orientation, 18);
    bytes.writeUInt32LE(0, 22);
  } else {
    bytes.writeUInt16BE(42, 2);
    bytes.writeUInt32BE(8, 4);
    bytes.writeUInt16BE(1, 8);
    bytes.writeUInt16BE(274, 10);
    bytes.writeUInt16BE(3, 12);
    bytes.writeUInt32BE(1, 14);
    bytes.writeUInt16BE(orientation, 18);
    bytes.writeUInt32BE(0, 22);
  }
  return bytes;
}

function duplicateOrientationTiff(): Buffer {
  const bytes = Buffer.alloc(38);
  bytes.write("II", 0, "ascii");
  bytes.writeUInt16LE(42, 2);
  bytes.writeUInt32LE(8, 4);
  bytes.writeUInt16LE(2, 8);
  for (const entry of [10, 22]) {
    bytes.writeUInt16LE(274, entry);
    bytes.writeUInt16LE(3, entry + 2);
    bytes.writeUInt32LE(1, entry + 4);
    bytes.writeUInt16LE(6, entry + 8);
  }
  bytes.writeUInt32LE(0, 34);
  return bytes;
}

function jpegWithExif(tiff: Buffer): Buffer {
  return jpegWithExifBlocks([tiff]);
}

function jpegWithExifBlocks(tiffs: readonly Buffer[]): Buffer {
  const segments = tiffs.map((tiff) => {
    const payload = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff]);
    const segmentLength = payload.length + 2;
    return Buffer.concat([Buffer.from([0xff, 0xe1, segmentLength >> 8, segmentLength & 0xff]), payload]);
  });
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x01, 0x01, 0x11, 0x00]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), ...segments, sof, sos]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(12 + data.byteLength);
  chunk.writeUInt32BE(data.byteLength, 0);
  chunk.write(type, 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.byteLength)), 8 + data.byteLength);
  return chunk;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngWithExif(tiff: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(640, 0);
  ihdr.writeUInt32BE(480, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("eXIf", tiff),
    pngChunk("IDAT", Buffer.from([0])),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngWithoutExif(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(640, 0);
  ihdr.writeUInt32BE(480, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", Buffer.from([0])),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function webpChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(8 + data.byteLength + (data.byteLength % 2));
  chunk.write(type, 0, "ascii");
  chunk.writeUInt32LE(data.byteLength, 4);
  data.copy(chunk, 8);
  return chunk;
}

function webpWithExif(tiff: Buffer): Buffer {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x08;
  vp8x.writeUIntLE(639, 4, 3);
  vp8x.writeUIntLE(479, 7, 3);
  const vp8 = Buffer.from([0, 0, 0, 0x9d, 0x01, 0x2a, 0x80, 0x02, 0xe0, 0x01]);
  const chunks = Buffer.concat([webpChunk("VP8X", vp8x), webpChunk("VP8 ", vp8), webpChunk("EXIF", tiff)]);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(chunks.byteLength + 4, 4);
  header.write("WEBP", 8, "ascii");
  return Buffer.concat([header, chunks]);
}

test("projects known JPEG orientation 6 by swapping supplied header dimensions", () => {
  const bytes = jpegWithExif(tiffOrientation(6));
  assert.deepEqual(inspectOwnerWanImageCoordinateMetadata({ bytes, mime_type: "image/jpeg", width: 640, height: 480 }), {
    orientation: 6,
    projected_width: 480,
    projected_height: 640,
    confidence: "HEADER_ORIENTATION_PROJECTION_NOT_BROWSER_DECODE"
  });
});

test("projects all eight TIFF orientation values without changing caller coordinates", () => {
  for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
    const swaps = orientation >= 5;
    assert.deepEqual(inspectOwnerWanImageCoordinateMetadata({
      bytes: jpegWithExif(tiffOrientation(orientation, orientation % 2 === 0)),
      mime_type: "image/jpeg",
      width: 640,
      height: 480
    }), {
      orientation,
      projected_width: swaps ? 480 : 640,
      projected_height: swaps ? 640 : 480,
      confidence: "HEADER_ORIENTATION_PROJECTION_NOT_BROWSER_DECODE"
    });
  }
});

test("uses orientation 1 for absent metadata on PNG and BMP", () => {
  const png = pngWithoutExif();
  const bmp = Buffer.alloc(26);
  bmp.write("BM", 0, "ascii");
  const expected = {
    orientation: 1,
    projected_width: 640,
    projected_height: 480,
    confidence: "HEADER_ORIENTATION_PROJECTION_NOT_BROWSER_DECODE"
  };
  assert.deepEqual(inspectOwnerWanImageCoordinateMetadata({ bytes: png, mime_type: "image/png", width: 640, height: 480 }), expected);
  assert.deepEqual(inspectOwnerWanImageCoordinateMetadata({ bytes: bmp, mime_type: "image/bmp", width: 640, height: 480 }), expected);
});

test("reads a PNG eXIf chunk that stores the TIFF profile without a JPEG APP1 prefix", () => {
  assert.deepEqual(inspectOwnerWanImageCoordinateMetadata({
    bytes: pngWithExif(tiffOrientation(7)), mime_type: "image/png", width: 640, height: 480
  }), {
    orientation: 7,
    projected_width: 480,
    projected_height: 640,
    confidence: "HEADER_ORIENTATION_PROJECTION_NOT_BROWSER_DECODE"
  });
});

test("reads WebP EXIF chunk metadata using the TIFF payload", () => {
  assert.deepEqual(inspectOwnerWanImageCoordinateMetadata({
    bytes: webpWithExif(tiffOrientation(5, false)), mime_type: "image/webp", width: 640, height: 480
  }), {
    orientation: 5,
    projected_width: 480,
    projected_height: 640,
    confidence: "HEADER_ORIENTATION_PROJECTION_NOT_BROWSER_DECODE"
  });
});

test("rejects duplicate orientation tags instead of choosing one", () => {
  assert.deepEqual(inspectOwnerWanImageCoordinateMetadata({
    bytes: jpegWithExif(duplicateOrientationTiff()), mime_type: "image/jpeg", width: 640, height: 480
  }), {
    orientation: null,
    projected_width: null,
    projected_height: null,
    confidence: "UNSUPPORTED_OR_MALFORMED_METADATA"
  });
});

test("rejects multiple JPEG EXIF APP1 blocks even when their values agree", () => {
  assert.deepEqual(inspectOwnerWanImageCoordinateMetadata({
    bytes: jpegWithExifBlocks([tiffOrientation(6), tiffOrientation(6)]), mime_type: "image/jpeg", width: 640, height: 480
  }), {
    orientation: null,
    projected_width: null,
    projected_height: null,
    confidence: "UNSUPPORTED_OR_MALFORMED_METADATA"
  });
});

test("fails closed for proxies, accessors, malformed dimensions, and oversized buffers", () => {
  const validBytes = jpegWithExif(tiffOrientation(6));
  let getterCalls = 0;
  const accessor = Object.defineProperties({}, {
    bytes: { enumerable: true, get() { getterCalls += 1; return validBytes; } },
    mime_type: { enumerable: true, value: "image/jpeg" },
    width: { enumerable: true, value: 640 },
    height: { enumerable: true, value: 480 }
  });
  const invalid = {
    orientation: null,
    projected_width: null,
    projected_height: null,
    confidence: "UNSUPPORTED_OR_MALFORMED_METADATA"
  };
  assert.deepEqual(inspectOwnerWanImageCoordinateMetadata(accessor), invalid);
  assert.deepEqual(inspectOwnerWanImageCoordinateMetadata(new Proxy({
    bytes: validBytes, mime_type: "image/jpeg", width: 640, height: 480
  }, {})), invalid);
  assert.deepEqual(inspectOwnerWanImageCoordinateMetadata({
    bytes: validBytes, mime_type: "image/jpeg", width: Number.MAX_SAFE_INTEGER + 1, height: 480
  }), invalid);
  assert.deepEqual(inspectOwnerWanImageCoordinateMetadata({
    bytes: validBytes, mime_type: "image/jpeg", width: 8_001, height: 480
  }), invalid);
  assert.deepEqual(inspectOwnerWanImageCoordinateMetadata({
    bytes: Buffer.alloc(20 * 1024 * 1024 + 1), mime_type: "image/jpeg", width: 640, height: 480
  }), invalid);
  assert.equal(getterCalls, 0);
});

test("rejects overflowing TIFF IFD offsets and unsupported orientation values", () => {
  const overflowing = tiffOrientation(6);
  overflowing.writeUInt32LE(0xffff_fff0, 4);
  const invalid = {
    orientation: null,
    projected_width: null,
    projected_height: null,
    confidence: "UNSUPPORTED_OR_MALFORMED_METADATA"
  };
  assert.deepEqual(inspectOwnerWanImageCoordinateMetadata({
    bytes: jpegWithExif(overflowing), mime_type: "image/jpeg", width: 640, height: 480
  }), invalid);
  assert.deepEqual(inspectOwnerWanImageCoordinateMetadata({
    bytes: jpegWithExif(tiffOrientation(9)), mime_type: "image/jpeg", width: 640, height: 480
  }), invalid);
});

test("does not treat a truncated JPEG Exif identifier as absent metadata", () => {
  const malformed = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x08]),
    Buffer.from("Exifxx", "ascii"),
    Buffer.from([0xff, 0xda, 0x00, 0x02, 0xff, 0xd9])
  ]);
  assert.deepEqual(inspectOwnerWanImageCoordinateMetadata({
    bytes: malformed, mime_type: "image/jpeg", width: 640, height: 480
  }), {
    orientation: null,
    projected_width: null,
    projected_height: null,
    confidence: "UNSUPPORTED_OR_MALFORMED_METADATA"
  });
});

test("returns a frozen summary independent from later caller byte mutation", () => {
  const bytes = jpegWithExif(tiffOrientation(6));
  const result = inspectOwnerWanImageCoordinateMetadata({ bytes, mime_type: "image/jpeg", width: 640, height: 480 });
  bytes.fill(0);
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(result, {
    orientation: 6,
    projected_width: 480,
    projected_height: 640,
    confidence: "HEADER_ORIENTATION_PROJECTION_NOT_BROWSER_DECODE"
  });
});

test("preserves caller bytes on success and unsupported metadata returns", () => {
  const validBytes = jpegWithExif(tiffOrientation(6));
  const validBefore = Buffer.from(validBytes);
  const validResult = inspectOwnerWanImageCoordinateMetadata({
    bytes: validBytes, mime_type: "image/jpeg", width: 640, height: 480
  });
  assert.equal(Object.isFrozen(validResult), true);
  assert.deepEqual(Object.keys(validResult).sort(), ["confidence", "orientation", "projected_height", "projected_width"]);
  assert.deepEqual(validBytes, validBefore);

  const unsupportedBytes = jpegWithExif(tiffOrientation(9));
  const unsupportedBefore = Buffer.from(unsupportedBytes);
  const unsupportedResult = inspectOwnerWanImageCoordinateMetadata({
    bytes: unsupportedBytes, mime_type: "image/jpeg", width: 640, height: 480
  });
  assert.deepEqual(unsupportedResult, {
    orientation: null,
    projected_width: null,
    projected_height: null,
    confidence: "UNSUPPORTED_OR_MALFORMED_METADATA"
  });
  assert.deepEqual(unsupportedBytes, unsupportedBefore);
});

test("rejects typed-array shadow getters and subclasses without invoking them", () => {
  const original = jpegWithExif(tiffOrientation(6));
  let getterCalls = 0;
  const invalid = {
    orientation: null,
    projected_width: null,
    projected_height: null,
    confidence: "UNSUPPORTED_OR_MALFORMED_METADATA"
  };
  for (const key of ["buffer", "byteLength", "byteOffset", "length"] as const) {
    const bytes = Buffer.from(original);
    Object.defineProperty(bytes, key, {
      configurable: true,
      get() { getterCalls += 1; return key === "buffer" ? original.buffer : original.length; }
    });
    assert.deepEqual(inspectOwnerWanImageCoordinateMetadata({
      bytes, mime_type: "image/jpeg", width: 640, height: 480
    }), invalid);
  }

  class GetterSubclass extends Uint8Array {
    override get buffer(): ArrayBuffer {
      getterCalls += 1;
      return super.buffer as ArrayBuffer;
    }
  }
  const subclassBytes = new GetterSubclass(original);
  assert.deepEqual(inspectOwnerWanImageCoordinateMetadata({
    bytes: subclassBytes, mime_type: "image/jpeg", width: 640, height: 480
  }), invalid);
  assert.equal(getterCalls, 0);
});

test("accepts ordinary Uint8Array and rejects SharedArrayBuffer-backed bytes", () => {
  const bytes = jpegWithExif(tiffOrientation(6));
  const view = new Uint8Array(bytes);
  assert.equal(inspectOwnerWanImageCoordinateMetadata({
    bytes: view, mime_type: "image/jpeg", width: 640, height: 480
  }).orientation, 6);

  if (typeof SharedArrayBuffer === "undefined") return;
  const sharedBytes = new Uint8Array(new SharedArrayBuffer(bytes.byteLength));
  sharedBytes.set(bytes);
  const before = new Uint8Array(sharedBytes);
  assert.deepEqual(inspectOwnerWanImageCoordinateMetadata({
    bytes: sharedBytes, mime_type: "image/jpeg", width: 640, height: 480
  }), {
    orientation: null,
    projected_width: null,
    projected_height: null,
    confidence: "UNSUPPORTED_OR_MALFORMED_METADATA"
  });
  assert.deepEqual(sharedBytes, before);
});
