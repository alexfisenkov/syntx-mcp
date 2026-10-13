import assert from "node:assert/strict";
import test from "node:test";
import {
  OWNER_WAN_IMAGE_INPUT_POLICY,
  OwnerWanImageInputError,
  validateOwnerWanImageInput
} from "../src/application/owner-wan-image-input-validator.js";

function bmp24(width: number, signedHeight: number, pixelOffset = 54): Buffer {
  const height = Math.abs(signedHeight);
  const stride = Math.ceil(width * 24 / 32) * 4;
  const bytes = Buffer.alloc(pixelOffset + stride * height);
  bytes.write("BM", 0, "ascii");
  bytes.writeUInt32LE(bytes.byteLength, 2);
  bytes.writeUInt32LE(pixelOffset, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18);
  bytes.writeInt32LE(signedHeight, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28);
  bytes.writeUInt32LE(0, 30);
  bytes.writeUInt32LE(stride * height, 34);
  return bytes;
}

function bmpFile(dib: Buffer, pixelData: Buffer, pixelPrefix: Buffer = Buffer.alloc(0), trailing?: Buffer<ArrayBufferLike>): Buffer {
  const trailingBytes = trailing ?? Buffer.alloc(0);
  const pixelOffset = 14 + dib.byteLength + pixelPrefix.byteLength;
  const bytes = Buffer.alloc(14 + dib.byteLength + pixelPrefix.byteLength + pixelData.byteLength + trailingBytes.byteLength);
  bytes.write("BM", 0, "ascii");
  bytes.writeUInt32LE(bytes.byteLength, 2);
  bytes.writeUInt32LE(pixelOffset, 10);
  dib.copy(bytes, 14);
  pixelPrefix.copy(bytes, 14 + dib.byteLength);
  pixelData.copy(bytes, pixelOffset);
  trailingBytes.copy(bytes, pixelOffset + pixelData.byteLength);
  return bytes;
}

function bmpCore12(width: number, height: number, bitDepth: 1 | 4 | 8 | 24): Buffer {
  const paletteEntries = bitDepth <= 8 ? 2 ** bitDepth : 0;
  const palette = Buffer.alloc(paletteEntries * 3);
  const rowStride = Math.ceil(width * bitDepth / 32) * 4;
  const pixels = Buffer.alloc(rowStride * height);
  const dib = Buffer.alloc(12 + palette.byteLength);
  dib.writeUInt32LE(12, 0);
  dib.writeUInt16LE(width, 4);
  dib.writeUInt16LE(height, 6);
  dib.writeUInt16LE(1, 8);
  dib.writeUInt16LE(bitDepth, 10);
  palette.copy(dib, 12);
  return bmpFile(dib, pixels);
}

function bmpInfo(options: {
  width: number; signedHeight: number; bitDepth: 1 | 4 | 8 | 16 | 24 | 32; headerSize?: 40 | 108 | 124;
  compression?: number; colorsUsed?: number; imageSize?: number; paletteEntries?: number; masks?: readonly number[];
  pixels?: Buffer; trailing?: Buffer; profile?: { offset: number; size: number; colorType: number };
}): Buffer {
  const headerSize = options.headerSize ?? 40;
  const height = Math.abs(options.signedHeight);
  const compression = options.compression ?? 0;
  const colorsUsed = options.colorsUsed ?? 0;
  const defaultPaletteEntries = options.bitDepth <= 8 ? (colorsUsed || 2 ** options.bitDepth) : colorsUsed;
  const paletteEntries = options.paletteEntries ?? defaultPaletteEntries;
  const paletteBytes = Buffer.alloc(paletteEntries * 4);
  const rowStride = Math.ceil(options.width * options.bitDepth / 32) * 4;
  const pixels = options.pixels ?? Buffer.alloc(rowStride * height);
  const masks = options.masks ?? [];
  const externalMasks = headerSize === 40 && compression === 3 ? Buffer.alloc(masks.length * 4) : Buffer.alloc(0);
  for (let i = 0; i < masks.length && externalMasks.byteLength > 0; i += 1) externalMasks.writeUInt32LE(masks[i]!, i * 4);
  const dib = Buffer.alloc(headerSize);
  dib.writeUInt32LE(headerSize, 0);
  dib.writeInt32LE(options.width, 4);
  dib.writeInt32LE(options.signedHeight, 8);
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(options.bitDepth, 14);
  dib.writeUInt32LE(compression, 16);
  dib.writeUInt32LE(options.imageSize ?? (compression === 1 || compression === 2 ? pixels.byteLength : rowStride * height), 20);
  dib.writeUInt32LE(colorsUsed, 32);
  if (headerSize >= 108) {
    const embeddedMaskOffset = 40;
    for (let i = 0; i < Math.min(masks.length, 4); i += 1) dib.writeUInt32LE(masks[i]!, embeddedMaskOffset + i * 4);
  }
  if (headerSize === 124 && options.profile) {
    dib.writeUInt32LE(options.profile.colorType, 56);
    dib.writeUInt32LE(options.profile.offset, 112);
    dib.writeUInt32LE(options.profile.size, 116);
  }
  return bmpFile(dib, pixels, Buffer.concat([externalMasks, paletteBytes]), options.trailing);
}

function rleRows(width: number, height: number, bitDepth: 4 | 8): Buffer {
  const parts: number[] = [];
  let remaining = width;
  while (remaining > 0) {
    const count = Math.min(remaining, 255);
    parts.push(count, bitDepth === 8 ? 1 : 0x12);
    remaining -= count;
  }
  parts.push(0, 0);
  for (let row = 1; row < height; row += 1) {
    let left = width;
    while (left > 0) {
      const count = Math.min(left, 255);
      parts.push(count, bitDepth === 8 ? 2 : 0x21);
      left -= count;
    }
    parts.push(0, 0);
  }
  parts.push(0, 1);
  return Buffer.from(parts);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngChunk(name: string, data: Uint8Array): Buffer {
  const chunk = Buffer.alloc(12 + data.byteLength);
  chunk.writeUInt32BE(data.byteLength, 0);
  chunk.write(name, 4, 4, "ascii");
  Buffer.from(data).copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.byteLength)), 8 + data.byteLength);
  return chunk;
}

function pngHeader(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", Buffer.from([0])), pngChunk("IEND", Buffer.alloc(0))]);
}

function jpegHeader(width: number, height: number): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff,
    0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9
  ]);
}

function jpegWithExactSize(byteLength: number): Buffer {
  const tail = jpegHeader(384, 384).subarray(2);
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let remaining = byteLength - 2 - tail.byteLength;
  while (remaining > 65_537) {
    const marker = Buffer.alloc(65_537);
    marker[0] = 0xff; marker[1] = 0xe1; marker.writeUInt16BE(65_535, 2);
    parts.push(marker);
    remaining -= marker.byteLength;
  }
  if (remaining < 4) throw new Error("Fixture is too small for a JPEG marker.");
  const finalMarker = Buffer.alloc(remaining);
  finalMarker[0] = 0xff; finalMarker[1] = 0xe1; finalMarker.writeUInt16BE(remaining - 2, 2);
  parts.push(finalMarker, tail);
  return Buffer.concat(parts);
}

function webpHeader(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.byteLength - 8, 4);
  bytes.write("WEBPVP8 ", 8, "ascii");
  bytes.writeUInt32LE(10, 16);
  bytes[23] = 0x9d; bytes[24] = 0x01; bytes[25] = 0x2a;
  bytes.writeUInt16LE(width & 0x3fff, 26);
  bytes.writeUInt16LE(height & 0x3fff, 28);
  return bytes;
}

test("accepts exact WAN variant and structurally valid BMP with bounded metadata claim", () => {
  const bytes = bmp24(384, 384);
  const image = validateOwnerWanImageInput({
    variant: "wan_26_image", content_base64: bytes.toString("base64"), filename: "input.bmp", mime_type: "image/bmp"
  });
  assert.equal(image.variant, "wan_26_image");
  assert.equal(image.mime_type, "image/bmp");
  assert.equal(image.width, 384);
  assert.equal(image.height, 384);
  assert.equal(image.size, bytes.byteLength);
  assert.equal(image.metadata_confidence, "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED");
  assert.equal(image.dimensions_proof, "CONTAINER_METADATA_ONLY_NOT_BROWSER_NATURAL_DIMENSIONS");
  assert.throws(() => validateOwnerWanImageInput({
    variant: "wan_26_image", content_base64: bytes.toString("base64"), filename: "input.bmp", mime_type: "image/jpeg"
  }), (error: unknown) => error instanceof OwnerWanImageInputError && error.code === "INVALID_IMAGE_INPUT");
});

test("reports a variant-specific encoded-size overflow as a local resource limit before decoding", () => {
  const oversizedBase64 = "A".repeat(14_000_000);
  assert.throws(() => validateOwnerWanImageInput({
    variant: "wan_25_i2i_preview", content_base64: oversizedBase64, filename: "large.jpg", mime_type: "image/jpeg"
  }), (error: unknown) => error instanceof OwnerWanImageInputError && error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED");
});

test("accepts exact catalog-derived byte ceilings and rejects one byte above each selected variant ceiling", () => {
  for (const [variant, limit] of [["wan_25_i2i_preview", 10_485_760], ["wan_27_image", 20_971_520]] as const) {
    const exact = jpegWithExactSize(limit);
    const accepted = validateOwnerWanImageInput({
      variant, content_base64: exact.toString("base64"), filename: "exact.jpg", mime_type: "image/jpeg"
    });
    assert.equal(accepted.size, limit);
    const over = jpegWithExactSize(limit + 1);
    assert.throws(() => validateOwnerWanImageInput({
      variant, content_base64: over.toString("base64"), filename: "over.jpg", mime_type: "image/jpeg"
    }), (error: unknown) => error instanceof OwnerWanImageInputError && error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED");
  }
});

test("sniffs each declared source MIME and canonicalizes only the JPG alias", () => {
  const cases = [
    { bytes: pngHeader(384, 384), mime: "image/png", canonical: "image/png" },
    { bytes: jpegHeader(384, 384), mime: "image/jpeg", canonical: "image/jpeg" },
    { bytes: jpegHeader(384, 384), mime: "image/jpg", canonical: "image/jpeg" },
    { bytes: bmp24(384, -384), mime: "image/bmp", canonical: "image/bmp" },
    { bytes: webpHeader(384, 384), mime: "image/webp", canonical: "image/webp" }
  ] as const;
  for (const item of cases) {
    const image = validateOwnerWanImageInput({
      variant: "wan_26_image", content_base64: item.bytes.toString("base64"), filename: "source.bin", mime_type: item.mime
    });
    assert.equal(image.original_mime_type, item.mime);
    assert.equal(image.mime_type, item.canonical);
    assert.equal(image.width, 384);
    assert.equal(image.height, 384);
  }
});

test("keeps all four exact variant byte and dimension limits distinct from provider acceptance", () => {
  assert.deepEqual(OWNER_WAN_IMAGE_INPUT_POLICY.variants, {
    wan_25_i2i_preview: { max_bytes: 10_485_760, min_dimension: 384, max_dimension: 5_000 },
    wan_26_image: { max_bytes: 10_485_760, min_dimension: 384, max_dimension: 5_000 },
    wan_27_image: { max_bytes: 20_971_520, min_dimension: 240, max_dimension: 8_000 },
    wan_27_image_pro: { max_bytes: 20_971_520, min_dimension: 240, max_dimension: 8_000 }
  });
  assert.equal(OWNER_WAN_IMAGE_INPUT_POLICY.limits_policy, "LOCAL_GUARD_FROM_SELECTED_CATALOG_NOT_PROVIDER_ACCEPTANCE");
  for (const variant of ["wan_25_i2i_preview", "wan_26_image", "wan_27_image", "wan_27_image_pro"] as const) {
    const minDimension = variant === "wan_25_i2i_preview" || variant === "wan_26_image" ? 384 : 240;
    const bytes = bmp24(minDimension, minDimension);
    assert.equal(validateOwnerWanImageInput({
      variant, content_base64: bytes.toString("base64"), filename: "min.bmp", mime_type: "image/bmp"
    }).width, minDimension);
  }
  for (const input of [
    { variant: "wan_25_i2i_preview", content_base64: bmp24(383, 384).toString("base64"), filename: "small.bmp", mime_type: "image/bmp" },
    { variant: "wan_27_image", content_base64: bmp24(239, 240).toString("base64"), filename: "small.bmp", mime_type: "image/bmp" }
  ]) {
    assert.throws(() => validateOwnerWanImageInput(input), (error: unknown) =>
      error instanceof OwnerWanImageInputError && error.code === "INVALID_IMAGE_INPUT");
  }
  for (const [variant, maxDimension, otherDimension, overDimension] of [
    ["wan_25_i2i_preview", 5_000, 384, 5_001], ["wan_27_image_pro", 8_000, 240, 8_001]
  ] as const) {
    const maxEdge = bmp24(maxDimension, otherDimension);
    assert.equal(validateOwnerWanImageInput({
      variant, content_base64: maxEdge.toString("base64"), filename: "max.bmp", mime_type: "image/bmp"
    }).width, maxDimension);
    const overEdge = bmp24(overDimension, otherDimension);
    assert.throws(() => validateOwnerWanImageInput({
      variant, content_base64: overEdge.toString("base64"), filename: "over.bmp", mime_type: "image/bmp"
    }), (error: unknown) => error instanceof OwnerWanImageInputError && error.code === "INVALID_IMAGE_INPUT");
  }
});

test("bounds BMP offsets and declared pixel array and rejects unsupported bit depths or compression", () => {
  const paddedOffset = bmp24(384, -384, 70);
  assert.equal(validateOwnerWanImageInput({
    variant: "wan_27_image", content_base64: paddedOffset.toString("base64"), filename: "top-down.bmp", mime_type: "image/bmp"
  }).height, 384);
  const omittedImageSize = bmp24(384, 384); omittedImageSize.writeUInt32LE(0, 34);
  assert.equal(validateOwnerWanImageInput({
    variant: "wan_27_image", content_base64: omittedImageSize.toString("base64"), filename: "omitted-size.bmp", mime_type: "image/bmp"
  }).height, 384);

  const truncated = bmp24(384, 384).subarray(0, bmp24(384, 384).byteLength - 1);
  const badOffset = bmp24(384, 384); badOffset.writeUInt32LE(53, 10);
  const badDeclaredSize = bmp24(384, 384); badDeclaredSize.writeUInt32LE(badDeclaredSize.byteLength + 1, 2);
  const badBitDepth = bmp24(384, 384); badBitDepth.writeUInt16LE(12, 28);
  const compressed = bmp24(384, 384); compressed.writeUInt32LE(2, 30);
  const unknownDibHeader = bmp24(384, 384); unknownDibHeader.writeUInt32LE(56, 14);
  const overflow = bmp24(384, 384); overflow.writeInt32LE(0x7fff_ffff, 18); overflow.writeInt32LE(-0x7fff_ffff, 22);
  for (const bytes of [truncated, badOffset, badDeclaredSize, overflow]) {
    assert.throws(() => validateOwnerWanImageInput({
      variant: "wan_27_image", content_base64: bytes.toString("base64"), filename: "bad.bmp", mime_type: "image/bmp"
    }), (error: unknown) => error instanceof OwnerWanImageInputError && error.code === "INVALID_IMAGE_INPUT");
  }
  for (const bytes of [badBitDepth, compressed, unknownDibHeader]) {
    assert.throws(() => validateOwnerWanImageInput({
      variant: "wan_27_image", content_base64: bytes.toString("base64"), filename: "unsupported.bmp", mime_type: "image/bmp"
    }), (error: unknown) => error instanceof OwnerWanImageInputError && error.code === "UNSUPPORTED_BMP_COMPOSITION");
  }
});

test("rejects unknown keys, proxies, accessors and keeps returned bytes separate from the input fixture", () => {
  const bytes = bmp24(384, 384);
  const base = { variant: "wan_26_image", content_base64: bytes.toString("base64"), filename: "safe.bmp", mime_type: "image/bmp" };
  let getterCalls = 0;
  const accessor = { ...base };
  Object.defineProperty(accessor, "filename", { enumerable: true, get() { getterCalls += 1; return "safe.bmp"; } });
  for (const input of [
    { ...base, path: "/tmp/ignored.bmp" },
    new Proxy(base, {}),
    accessor
  ]) {
    assert.throws(() => validateOwnerWanImageInput(input), (error: unknown) =>
      error instanceof OwnerWanImageInputError && error.code === "INVALID_IMAGE_INPUT");
  }
  assert.equal(getterCalls, 0);
  const image = validateOwnerWanImageInput(base);
  image.bytes[0] = 0;
  assert.equal(bytes[0], 0x42);
});

test("rejects noncanonical base64 and unsafe portable basenames without echoing caller values", () => {
  const jpeg = jpegHeader(384, 384);
  const canonical = jpeg.toString("base64");
  const noncanonical = canonical.slice(0, -3) + String.fromCharCode(canonical.charCodeAt(canonical.length - 3) + 1) + "==";
  assert.deepEqual(Buffer.from(noncanonical, "base64"), jpeg);
  const invalidInputs: readonly (readonly [string, string])[] = [
    [`${canonical}\n`, "safe.jpg"],
    [noncanonical, "safe.jpg"],
    [canonical, "../private.jpg"],
    [canonical, "NUL.txt"],
    [canonical, "trailing."],
    [canonical, `long-${"é".repeat(128)}.jpg`]
  ];
  for (const [content_base64, filename] of invalidInputs) {
    assert.throws(() => validateOwnerWanImageInput({
      variant: "wan_26_image", content_base64, filename, mime_type: "image/jpeg"
    }), (error: unknown) => error instanceof OwnerWanImageInputError && error.code === "INVALID_IMAGE_INPUT" &&
      !error.message.includes(filename));
  }
});

test("accepts common 12-byte BITMAPCOREHEADER indexed and direct-color layouts", () => {
  for (const bitDepth of [1, 4, 8, 24] as const) {
    const bytes = bmpCore12(384, 384, bitDepth);
    const image = validateOwnerWanImageInput({
      variant: "wan_26_image", content_base64: bytes.toString("base64"), filename: "core.bmp", mime_type: "image/bmp"
    });
    assert.equal(image.width, 384);
    assert.equal(image.height, 384);
    assert.equal(image.size, bytes.byteLength);
  }
});

test("accepts INFO40, V4 and V5 headers with indexed palettes, bitfields and bounded trailing profiles", () => {
  const indexed1 = bmpInfo({ width: 384, signedHeight: 384, bitDepth: 1 });
  const indexed4 = bmpInfo({ width: 384, signedHeight: 384, bitDepth: 4 });
  const indexed8 = bmpInfo({ width: 384, signedHeight: 384, bitDepth: 8, colorsUsed: 8, paletteEntries: 8 });
  const rgb16 = bmpInfo({ width: 384, signedHeight: 384, bitDepth: 16 });
  const rgb24WithOptimizationPalette = bmpInfo({
    width: 384, signedHeight: 384, bitDepth: 24, colorsUsed: 2, paletteEntries: 2
  });
  const info40WithTrailingMetadata = bmpInfo({
    width: 384, signedHeight: 384, bitDepth: 24, trailing: Buffer.from([0xde, 0xad, 0xbe, 0xef])
  });
  const bitfields40 = bmpInfo({
    width: 384, signedHeight: 384, bitDepth: 16, compression: 3, masks: [0x7c00, 0x03e0, 0x001f]
  });
  const bitfieldsV4 = bmpInfo({
    width: 384, signedHeight: 384, bitDepth: 32, headerSize: 108, compression: 3,
    masks: [0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000]
  });
  const pixelBytes = 384 * 4 * 384;
  const bitfieldsV5WithProfile = bmpInfo({
    width: 384, signedHeight: 384, bitDepth: 32, headerSize: 124, compression: 3,
    masks: [0x00ff0000, 0x0000ff00, 0x000000ff],
    profile: { offset: 124 + pixelBytes, size: 4, colorType: 0x4d424544 },
    trailing: Buffer.from([0x11, 0x22, 0x33, 0x44])
  });
  const pixelBytes24 = 384 * 3 * 384;
  const bitfieldsV5LinkedProfile = bmpInfo({
    width: 384, signedHeight: 384, bitDepth: 24, headerSize: 124,
    profile: { offset: 124 + pixelBytes24, size: 6, colorType: 0x4c49_4e4b },
    trailing: Buffer.from([0x6e, 0x6f, 0x74, 0x65, 0x73, 0x00])
  });
  for (const bytes of [indexed1, indexed4, indexed8, rgb16, rgb24WithOptimizationPalette, info40WithTrailingMetadata,
    bitfields40, bitfieldsV4, bitfieldsV5WithProfile, bitfieldsV5LinkedProfile]) {
    const image = validateOwnerWanImageInput({
      variant: "wan_26_image", content_base64: bytes.toString("base64"), filename: "header.bmp", mime_type: "image/bmp"
    });
    assert.equal(image.width, 384);
    assert.equal(image.height, 384);
  }
});

test("validates bounded RLE4 and RLE8 encoded and absolute command streams", () => {
  for (const bitDepth of [4, 8] as const) {
    const compression = bitDepth === 4 ? 2 : 1;
    const encoded = bmpInfo({
      width: 384, signedHeight: 384, bitDepth, compression, colorsUsed: 4, paletteEntries: 4,
      pixels: rleRows(384, 384, bitDepth)
    });
    const image = validateOwnerWanImageInput({
      variant: "wan_26_image", content_base64: encoded.toString("base64"), filename: "rle.bmp", mime_type: "image/bmp"
    });
    assert.equal(image.width, 384);

    const absoluteRow = bitDepth === 8
      ? Buffer.from([0, 3, 1, 2, 3, 0, 0, 0])
      : Buffer.from([0, 3, 0x12, 0x30, 0, 0]);
    const remainingRows = Buffer.from(Array.from({ length: 383 }, () => [0, 0]).flat().concat([0, 1]));
    const absolute = bmpInfo({
      width: 384, signedHeight: 384, bitDepth, compression, colorsUsed: 4, paletteEntries: 4,
      pixels: Buffer.concat([absoluteRow, remainingRows])
    });
    assert.equal(validateOwnerWanImageInput({
      variant: "wan_26_image", content_base64: absolute.toString("base64"), filename: "absolute.bmp", mime_type: "image/bmp"
    }).height, 384);
  }
});

test("rejects malformed BMP headers, palettes, masks, offsets, top-down RLE and out-of-bounds RLE commands", () => {
  const badCorePlanes = bmpCore12(384, 384, 1); badCorePlanes.writeUInt16LE(2, 22);
  const tooManyPaletteColors = bmpInfo({
    width: 384, signedHeight: 384, bitDepth: 1, colorsUsed: 3, paletteEntries: 3
  });
  const shortPaletteOffset = bmpInfo({ width: 384, signedHeight: 384, bitDepth: 1 }); shortPaletteOffset.writeUInt32LE(14 + 40 + 4 - 1, 10);
  const overlappingMasks = bmpInfo({
    width: 384, signedHeight: 384, bitDepth: 16, headerSize: 108, compression: 3,
    masks: [0x7c00, 0x03e0, 0x001f]
  }); overlappingMasks.writeUInt32LE(0x7c00, 14 + 40 + 4);
  const noncontiguousMasks = bmpInfo({
    width: 384, signedHeight: 384, bitDepth: 16, compression: 3, masks: [0x7c01, 0x03e0, 0x001e]
  });
  const masksOutsideBitDepth = bmpInfo({
    width: 384, signedHeight: 384, bitDepth: 16, compression: 3, masks: [0x10000, 0x03e0, 0x001e]
  });
  const missingExternalMasks = bmpInfo({
    width: 384, signedHeight: 384, bitDepth: 16, compression: 3, masks: [0x7c00, 0x03e0, 0x001f]
  }); missingExternalMasks.writeUInt32LE(54, 10);
  const rleIndicesOutOfPalette = bmpInfo({
    width: 384, signedHeight: 384, bitDepth: 8, compression: 1, colorsUsed: 4, paletteEntries: 4,
    pixels: Buffer.from([1, 255, 0, 1])
  });
  const rleRunPastRow = bmpInfo({
    width: 384, signedHeight: 384, bitDepth: 8, compression: 1, colorsUsed: 4, paletteEntries: 4,
    pixels: Buffer.from([255, 1, 255, 1, 0, 1])
  });
  const rleBadDelta = bmpInfo({
    width: 384, signedHeight: 384, bitDepth: 8, compression: 1, colorsUsed: 4, paletteEntries: 4,
    pixels: Buffer.from([0, 2, 255, 0, 0, 2, 255, 0, 0, 1])
  });
  const topDownRle = bmpInfo({
    width: 384, signedHeight: -384, bitDepth: 8, compression: 1, colorsUsed: 4, paletteEntries: 4,
    pixels: Buffer.from([0, 1])
  });
  const truncatedRle = bmpInfo({
    width: 384, signedHeight: 384, bitDepth: 8, compression: 1, colorsUsed: 4, paletteEntries: 4,
    pixels: Buffer.from([255, 1])
  });
  const badProfileRange = bmpInfo({
    width: 384, signedHeight: 384, bitDepth: 24, headerSize: 124,
    profile: { offset: 0xffff_fffc, size: 16, colorType: 0x4d42_4544 }, trailing: Buffer.alloc(16)
  });
  const profileOverlapsPixels = bmpInfo({
    width: 384, signedHeight: 384, bitDepth: 24, headerSize: 124,
    profile: { offset: 124, size: 4, colorType: 0x4d42_4544 }, trailing: Buffer.alloc(4)
  });
  const linkedProfileMissingTerminator = bmpInfo({
    width: 384, signedHeight: 384, bitDepth: 24, headerSize: 124,
    profile: { offset: 124 + 384 * 3 * 384, size: 4, colorType: 0x4c49_4e4b }, trailing: Buffer.from("path")
  });
  for (const bytes of [badCorePlanes, tooManyPaletteColors, shortPaletteOffset, overlappingMasks, noncontiguousMasks,
    masksOutsideBitDepth, missingExternalMasks, rleIndicesOutOfPalette, rleRunPastRow, rleBadDelta, topDownRle,
    truncatedRle, badProfileRange, profileOverlapsPixels, linkedProfileMissingTerminator]) {
    assert.throws(() => validateOwnerWanImageInput({
      variant: "wan_26_image", content_base64: bytes.toString("base64"), filename: "bad.bmp", mime_type: "image/bmp"
    }), (error: unknown) => error instanceof OwnerWanImageInputError);
  }
});
