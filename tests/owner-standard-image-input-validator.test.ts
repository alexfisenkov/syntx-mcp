import assert from "node:assert/strict";
import test from "node:test";
import { validateOwnerStandardImageInput, validateOwnerStandardImageUploadData } from "../src/application/owner-standard-image-input-validator.js";
import { inspectBoundedOwnerImageBytes, inspectBoundedOwnerImageBytes32MiB, inspectBoundedOwnerImageBytesWithMax } from "../src/application/owner-image-reference-input-validator.js";
import { inspectBoundedOwnerClarityAvifBytes, inspectBoundedOwnerClarityAvifBytes32MiB, inspectBoundedOwnerClarityAvifBytesWithMax } from "../src/application/owner-clarity-upscale-input-validator.js";

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
const JPEG_1X1 = Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x0b,0x08,0x00,0x01,0x00,0x01,0x01,0x01,0x11,0x00,0xff,0xda,0x00,0x08,0x01,0x01,0x00,0x00,0x3f,0x00,0x00,0xff,0xd9]);
const WEBP_1X1 = Buffer.from([0x52,0x49,0x46,0x46,0x12,0,0,0,0x57,0x45,0x42,0x50,0x56,0x50,0x38,0x4c,5,0,0,0,0x2f,0,0,0,0,0]);
const AVIF_16X16 = "AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAkAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAQAAAAEAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAsbWRhdAoKAAAAAZ/41fIAgDIWEACXgBBAggAAEABcEytNbG+TY8nR6A==";

function box(type: string, payload: Uint8Array): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.byteLength + 8, 0);
  header.write(type, 4, 4, "ascii");
  return Buffer.concat([header, Buffer.from(payload)]);
}

function heifFixture(mime: "image/heic" | "image/heif" = "image/heic", primaryType = "hvc1", brands = mime === "image/heic" ? ["heic", "mif1", "heic"] : ["mif1", "heif", "mif1"]): Buffer {
  const ftyp = box("ftyp", Buffer.concat([Buffer.from(brands[0]!, "ascii"), Buffer.alloc(4), ...brands.slice(1).map((brand) => Buffer.from(brand, "ascii"))]));
  const hdlr = box("hdlr", Buffer.concat([Buffer.alloc(8), Buffer.from("pict", "ascii"), Buffer.alloc(12)]));
  const pitm = box("pitm", Buffer.from([0, 0, 0, 0, 0, 1]));
  const infe = box("infe", Buffer.concat([Buffer.from([2, 0, 0, 0, 0, 1, 0, 0]), Buffer.from(primaryType, "ascii"), Buffer.from([0])]));
  const iinf = box("iinf", Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 1]), infe]));
  const ispe = box("ispe", Buffer.from([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1]));
  const ipco = box("ipco", ispe);
  const iprp = box("iprp", Buffer.concat([ipco, box("ipma", Buffer.from([0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1]))]));
  const meta = box("meta", Buffer.concat([Buffer.alloc(4), hdlr, pitm, iinf, iprp]));
  return Buffer.concat([ftyp, meta, box("mdat", Buffer.from([0x01]))]);
}

function pngWithDimensions(width: number, height: number): string {
  const bytes = Buffer.from(PNG_1X1, "base64");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(12, 29)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29);
  return bytes.toString("base64");
}

function pngOver25MiB(): Buffer {
  const base = Buffer.from(PNG_1X1, "base64");
  const payloadLength = 25 * 1024 * 1024;
  const chunkLength = payloadLength + 12;
  const output = Buffer.alloc(base.length + chunkLength);
  base.copy(output, 0, 0, 33);
  output.writeUInt32BE(payloadLength, 33);
  output.write("tEXt", 37, 4, "ascii");
  const crcTable = new Uint32Array(256);
  for (let index = 0; index < crcTable.length; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    crcTable[index] = crc >>> 0;
  }
  let crc = 0xffffffff;
  for (let index = 37; index < 37 + 4 + payloadLength; index += 1) crc = (crcTable[(crc ^ output[index]!) & 0xff]! ^ (crc >>> 8)) >>> 0;
  output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 37 + 4 + payloadLength);
  base.copy(output, 33 + chunkLength, 33);
  return output;
}

function avifOver25MiB(): Buffer {
  const base = Buffer.from(AVIF_16X16, "base64");
  const payloadLength = 25 * 1024 * 1024;
  const free = Buffer.alloc(payloadLength + 8);
  free.writeUInt32BE(free.byteLength, 0);
  free.write("free", 4, 4, "ascii");
  return Buffer.concat([base, free]);
}

test("validates a source-admitted Banana 2.1 PNG and returns owned container metadata", () => {
  const result = validateOwnerStandardImageInput({
    variant: "banana-2.1", content_base64: PNG_1X1, filename: "reference.png", mime_type: "image/png"
  });
  assert.equal(result.variant, "banana-2.1");
  assert.equal(result.kind, "image");
  assert.equal(result.mime_type, "image/png");
  assert.equal(result.original_mime_type, "image/png");
  assert.equal(result.width, 1);
  assert.equal(result.height, 1);
  assert.equal(result.size, 68);
  assert.match(result.sha256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(result.metadata_confidence, "CONTAINER_METADATA_ONLY");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(result.bytes.constructor, Uint8Array);
  assert.equal(result.bytes.byteOffset, 0);
  assert.equal(result.bytes.buffer.byteLength, result.size);
  assert.notEqual(result.bytes.buffer, Buffer.from(PNG_1X1, "base64").buffer);
});

test("accepts common HEIC and HEIF primary hvc1 items from their associated ispe metadata", () => {
  for (const [mime_type, brands] of [
    ["image/heic", ["heic", "mif1", "heic"]], ["image/heif", ["mif1", "heif", "mif1"]],
    ["image/heif", ["heic", "mif1", "heic"]]
  ] as const) {
    const content = heifFixture(mime_type, "hvc1", [...brands]);
    const result = validateOwnerStandardImageInput({
      variant: "banana-2.1", content_base64: content.toString("base64"), filename: `still.${mime_type.slice(6)}`, mime_type
    });
    assert.equal(result.mime_type, mime_type);
    assert.equal(result.width, 1);
    assert.equal(result.height, 1);
  }
});

test("reports derived HEIF grid primary items as explicitly unsupported", () => {
  const content = heifFixture("image/heic", "grid");
  assert.throws(() => validateOwnerStandardImageInput({
    variant: "banana-2.1", content_base64: content.toString("base64"), filename: "grid.heic", mime_type: "image/heic"
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "UNSUPPORTED_IMAGE_COMPOSITION");
});

test("accepts only each exact image family MIME set and canonicalizes the declared JPG alias", () => {
  const others = ["banana", "banana2", "banana3", "banana3_light", "gpt-image-1", "gpt-image-1.5", "gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"] as const;
  for (const variant of others) {
    const inputs = [
      { content_base64: JPEG_1X1.toString("base64"), mime_type: "image/jpeg", filename: "a.jpg" },
      { content_base64: JPEG_1X1.toString("base64"), mime_type: "image/jpg", filename: "a.jpg" },
      { content_base64: PNG_1X1, mime_type: "image/png", filename: "a.png" },
      { content_base64: WEBP_1X1.toString("base64"), mime_type: "image/webp", filename: "a.webp" },
      { content_base64: AVIF_16X16, mime_type: "image/avif", filename: "a.avif" }
    ];
    for (const input of inputs) {
      const result = validateOwnerStandardImageInput({ variant, ...input });
      assert.equal(result.mime_type, input.mime_type === "image/jpg" ? "image/jpeg" : input.mime_type);
    }
  }
  assert.throws(() => validateOwnerStandardImageInput({
    variant: "banana-2.1", content_base64: JPEG_1X1.toString("base64"), filename: "a.jpg", mime_type: "image/jpg"
  }));
});

test("rejects caller getters, proxies, path-like or oversized UTF-8 filenames, MIME spoofing, and unsafe object shapes", () => {
  let getterReads = 0;
  const getter = Object.defineProperty({}, "variant", { enumerable: true, get() { getterReads += 1; return "banana"; } });
  let proxyTraps = 0;
  const proxied = new Proxy({}, { ownKeys() { proxyTraps += 1; return []; }, getPrototypeOf() { proxyTraps += 1; return Object.prototype; } });
  const badInputs = [
    getter,
    proxied,
    { variant: "banana", content_base64: PNG_1X1, filename: "../a.png", mime_type: "image/png" },
    { variant: "banana", content_base64: PNG_1X1, filename: `é${"x".repeat(254)}.png`, mime_type: "image/png" },
    { variant: "banana", content_base64: PNG_1X1, filename: "safe\u202ename.png", mime_type: "image/png" },
    { variant: "banana", content_base64: PNG_1X1, filename: "a.png", mime_type: "image/jpeg" },
    { variant: "banana", content_base64: `${PNG_1X1}\n`, filename: "a.png", mime_type: "image/png" },
    { variant: "future-banana", content_base64: PNG_1X1, filename: "a.png", mime_type: "image/png" },
    { variant: "banana", content_base64: PNG_1X1, filename: "a.png", mime_type: "image/png", dimensions: { width: 1, height: 1 } }
  ];
  for (const input of badInputs) assert.throws(() => validateOwnerStandardImageInput(input));
  assert.equal(getterReads, 0);
  assert.equal(proxyTraps, 0);
});

test("raw upload validation snapshots subarray bytes without mutating or retaining caller storage", () => {
  const caller = Buffer.concat([Buffer.from([0xaa]), Buffer.from(PNG_1X1, "base64"), Buffer.from([0xbb])]);
  const source = caller.subarray(1, caller.length - 1);
  const before = Buffer.from(caller);
  const result = validateOwnerStandardImageUploadData({
    variant: "gpt-image-2.5-sunburst", bytes: source, filename: "reference.png", mime_type: "image/png"
  });
  assert.deepEqual(caller, before);
  assert.notEqual(result.bytes.buffer, source.buffer);
  assert.deepEqual(Array.from(result.bytes), Array.from(source));
  result.bytes.fill(0);
  assert.deepEqual(caller, before);
});

test("raw-byte guards reject proxies, typed-array subclasses, shadowed accessors, shared memory, and malformed content", () => {
  class ExtendedBytes extends Uint8Array {}
  let getterReads = 0;
  const shadowed = Buffer.from(PNG_1X1, "base64");
  Object.defineProperty(shadowed, "buffer", { configurable: true, get() { getterReads += 1; return new ArrayBuffer(0); } });
  const shadowedBacking = new Uint8Array(Buffer.from(PNG_1X1, "base64"));
  Object.defineProperty(shadowedBacking.buffer, "byteLength", { configurable: true, get() { getterReads += 1; return 68; } });
  let proxyReads = 0;
  const proxy = new Proxy(Buffer.from(PNG_1X1, "base64"), { get() { proxyReads += 1; return undefined; } });
  const malformed = Buffer.from("<svg/>");
  const malformedBefore = Buffer.from(malformed);
  const invalidBytes: unknown[] = [
    new ExtendedBytes(Buffer.from(PNG_1X1, "base64")), shadowed, shadowedBacking, proxy, malformed,
    new Uint8Array(new SharedArrayBuffer(8))
  ];
  for (const bytes of invalidBytes) assert.throws(() => validateOwnerStandardImageUploadData({
    variant: "banana", bytes, filename: "input.png", mime_type: "image/png"
  }));
  assert.throws(() => inspectBoundedOwnerImageBytes32MiB(shadowed, 32 * 1024 * 1024));
  assert.throws(() => inspectBoundedOwnerImageBytes32MiB(shadowedBacking, 32 * 1024 * 1024));
  assert.throws(() => inspectBoundedOwnerClarityAvifBytes32MiB(shadowedBacking, 32 * 1024 * 1024));
  assert.equal(getterReads, 0);
  assert.equal(proxyReads, 0);
  assert.deepEqual(malformed, malformedBefore);
});

test("exposes AVIF sequence composition rejection instead of treating it as validated metadata", () => {
  const avis = Buffer.from(AVIF_16X16, "base64");
  avis.write("avis", 8, 4, "ascii");
  assert.throws(() => validateOwnerStandardImageInput({
    variant: "gpt-image-2", content_base64: avis.toString("base64"), filename: "sequence.avif", mime_type: "image/avif"
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "UNSUPPORTED_IMAGE_COMPOSITION");
});

test("accepts a structurally valid 25-to-32 MiB image under the explicit local family cap", () => {
  const bytes = pngOver25MiB();
  assert.equal(bytes.byteLength > 25 * 1024 * 1024, true);
  assert.throws(() => inspectBoundedOwnerImageBytes(bytes, bytes.byteLength), /invalid/u);
  const result = validateOwnerStandardImageInput({
    variant: "gpt-image-2.5-flare", content_base64: bytes.toString("base64"), filename: "large.png", mime_type: "image/png"
  });
  assert.equal(result.size, bytes.byteLength);
  assert.equal(result.width, 1);
  assert.equal(result.height, 1);
  assert.match(result.validation_confidence, /NOT_PROVIDER_LIMIT/u);
});

test("keeps Banana 2.1 at its declared 7 MiB image metadata ceiling", () => {
  const overCatalogCeiling = Buffer.alloc(7 * 1024 * 1024 + 1).toString("base64");
  assert.throws(() => validateOwnerStandardImageInput({
    variant: "banana-2.1", content_base64: overCatalogCeiling, filename: "too-large.png", mime_type: "image/png"
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_IMAGE_INPUT");
});

test("applies Banana 2.1's source-declared dimension and pixel metadata bounds", () => {
  const boundary = validateOwnerStandardImageInput({
    variant: "banana-2.1", content_base64: pngWithDimensions(8_400, 6_250), filename: "boundary.png", mime_type: "image/png"
  });
  assert.equal(boundary.width * boundary.height, 52_500_000);
  for (const [width, height] of [[8_401, 1], [8_400, 6_251]] as const) {
    assert.throws(() => validateOwnerStandardImageInput({
      variant: "banana-2.1", content_base64: pngWithDimensions(width, height), filename: "oversized.png", mime_type: "image/png"
    }));
  }
});

test("adds an explicit AVIF 32 MiB inspection primitive without widening Clarity's 25 MiB API", () => {
  const bytes = avifOver25MiB();
  assert.throws(() => inspectBoundedOwnerClarityAvifBytes(bytes, bytes.byteLength), /invalid/u);
  assert.deepEqual(inspectBoundedOwnerClarityAvifBytes32MiB(bytes, 32 * 1024 * 1024), {
    mime: "image/avif", width: 16, height: 16
  });
});

test("parameterized structural inspectors allow explicit 64 MiB ceilings while legacy wrappers stay at 32 MiB", () => {
  const png = Buffer.from(PNG_1X1, "base64");
  const avif = Buffer.from(AVIF_16X16, "base64");
  assert.deepEqual(inspectBoundedOwnerImageBytesWithMax(png, 64 * 1024 * 1024), { mime: "image/png", width: 1, height: 1 });
  assert.deepEqual(inspectBoundedOwnerClarityAvifBytesWithMax(avif, 64 * 1024 * 1024), { mime: "image/avif", width: 16, height: 16 });
  assert.throws(() => inspectBoundedOwnerImageBytes32MiB(png, 64 * 1024 * 1024));
  assert.throws(() => inspectBoundedOwnerClarityAvifBytes32MiB(avif, 64 * 1024 * 1024));
  for (const invalidLimit of [0, -1, 64 * 1024 * 1024 + 1, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => inspectBoundedOwnerImageBytesWithMax(png, invalidLimit));
    assert.throws(() => inspectBoundedOwnerClarityAvifBytesWithMax(avif, invalidLimit));
  }
});
