import assert from "node:assert/strict";
import test from "node:test";
import {
  OwnerStandardImageAuxInputError,
  validateOwnerStandardImageAuxInput,
  validateOwnerStandardImageAuxUploadData
} from "../src/application/owner-standard-image-aux-input-validator.js";

const U32 = (value: number) => { const out = Buffer.alloc(4); out.writeUInt32BE(value); return out; };
const ascii = (value: string) => Buffer.from(value, "ascii");

function box(type: string, payload: Uint8Array): Buffer {
  return Buffer.concat([U32(payload.byteLength + 8), ascii(type), Buffer.from(payload)]);
}

function bmff(brand: string): Buffer {
  const ftyp = box("ftyp", Buffer.concat([ascii(brand), U32(0), ascii(brand)]));
  return Buffer.concat([ftyp, box("mdat", Buffer.from([1])), box("moov", Buffer.alloc(0))]);
}

function vint(value: number): Buffer {
  if (value < 127) return Buffer.from([0x80 | value]);
  if (value < 16_383) return Buffer.from([0x40 | (value >>> 8), value & 0xff]);
  throw new Error("fixture value too large");
}

function ebmlElement(id: Uint8Array, payload: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from(id), vint(payload.byteLength), Buffer.from(payload)]);
}

function webm(): Buffer {
  const header = ebmlElement(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), ebmlElement(Buffer.from([0x42, 0x82]), ascii("webm")));
  const info = ebmlElement(Buffer.from([0x15, 0x49, 0xa9, 0x66]), Buffer.alloc(0));
  const tracks = ebmlElement(Buffer.from([0x16, 0x54, 0xae, 0x6b]), Buffer.alloc(0));
  const cluster = ebmlElement(Buffer.from([0x1f, 0x43, 0xb6, 0x75]), Buffer.alloc(0));
  const segmentPayload = Buffer.concat([info, tracks, cluster]);
  return Buffer.concat([header, ebmlElement(Buffer.from([0x18, 0x53, 0x80, 0x67]), segmentPayload)]);
}

function mpegElementary(): Buffer {
  return Buffer.from([0, 0, 1, 0xb3, 0x10, 0, 0x10, 0x11, 0xb7, 0, 0, 1, 0, 0, 0x10, 0, 0, 1, 1, 0]);
}

function mpegProgramStream(): Buffer {
  return Buffer.from([0,0,1,0xba,0x44,0,0,0,0,0,0,0,0,0,0,0,1,0xe0,0,0,0x80,0,0,0,0,1,0xb3,0x10,0,0x10,0x11,0xb7,0,0,1,0,0,0x10,0,0,1,1,0]);
}

function flv(): Buffer {
  const header = Buffer.from([0x46, 0x4c, 0x56, 1, 1, 0, 0, 0, 9, 0, 0, 0, 0]);
  const tag = Buffer.alloc(16);
  tag[0] = 9; tag[3] = 1; tag[11] = 0x17;
  tag.writeUInt32BE(12, 12);
  return Buffer.concat([header, tag]);
}

function asf(): Buffer {
  const headerGuid = Buffer.from([0x30,0x26,0xb2,0x75,0x8e,0x66,0xcf,0x11,0xa6,0xd9,0,0xaa,0,0x62,0xce,0x6c]);
  const filePropertiesGuid = Buffer.from([0xa1,0xdc,0xab,0x8c,0x47,0xa9,0xcf,0x11,0x8e,0xe4,0,0xc0,0x0c,0x20,0x53,0x65]);
  const streamPropertiesGuid = Buffer.from([0x91,0x07,0xdc,0xb7,0xb7,0xa9,0xcf,0x11,0x8e,0xe6,0,0xc0,0x0c,0x20,0x53,0x65]);
  const dataObjectGuid = Buffer.from([0x36,0x26,0xb2,0x75,0x8e,0x66,0xcf,0x11,0xa6,0xd9,0,0xaa,0,0x62,0xce,0x6c]);
  const videoGuid = Buffer.from([0xc0,0xef,0x19,0xbc,0x4d,0x5b,0xcf,0x11,0xa8,0xfd,0,0x80,0x5f,0x5c,0x44,0x2b]);
  const child = (guid: Buffer, body: Buffer) => Buffer.concat([guid, Buffer.alloc(8).fill(0).map((_, index) => index === 0 ? (24 + body.byteLength) : 0), body]);
  const file = child(filePropertiesGuid, Buffer.alloc(16));
  const stream = child(streamPropertiesGuid, Buffer.concat([videoGuid, Buffer.alloc(32)]));
  const children = Buffer.concat([file, stream]);
  const header = Buffer.alloc(30);
  headerGuid.copy(header);
  header.writeBigUInt64LE(BigInt(30 + children.byteLength), 16);
  header.writeUInt32LE(2, 24);
  header[28] = 1; header[29] = 2;
  const data = Buffer.alloc(50);
  dataObjectGuid.copy(data);
  data.writeBigUInt64LE(50n, 16);
  data[48] = 1; data[49] = 1;
  return Buffer.concat([header, children, data]);
}

function pdf(encrypted = false): Buffer {
  const trailer = encrypted ? "trailer\n<< /Size 1 /Encrypt 1 0 R >>\n" : "trailer\n<< /Size 1 >>\n";
  const prefix = `%PDF-1.7\n1 0 obj\n<<>>\nendobj\nxref\n0 1\n0000000000 65535 f \n${trailer}startxref\n30\n%%EOF\n`;
  return Buffer.from(prefix, "ascii");
}

function validBytes(mime: string): Buffer {
  switch (mime) {
    case "video/mp4": return bmff("isom");
    case "video/webm": return webm();
    case "video/quicktime":
    case "video/mov": return bmff("qt  ");
    case "video/mpeg": return mpegElementary();
    case "video/3gpp": return bmff("3gp6");
    case "video/x-flv": return flv();
    case "video/x-ms-wmv": return asf();
    case "application/pdf": return pdf();
    default: throw new Error(`missing fixture for ${mime}`);
  }
}

function input(mime: string, bytes = validBytes(mime), filename = "clip.bin") {
  return { variant: "banana-2.1", content_base64: bytes.toString("base64"), filename, mime_type: mime };
}

test("validates each declared video container and PDF without claiming decoded metadata", () => {
  const cases = [
    ["video/mp4", "video/mp4", "video"],
    ["video/webm", "video/webm", "video"],
    ["video/quicktime", "video/quicktime", "video"],
    ["video/mpeg", "video/mpeg", "video"],
    ["video/3gpp", "video/3gpp", "video"],
    ["video/x-flv", "video/x-flv", "video"],
    ["video/x-ms-wmv", "video/x-ms-wmv", "video"],
    ["video/mov", "video/quicktime", "video"],
    ["application/pdf", "application/pdf", "file"]
  ] as const;
  for (const [sourceMime, canonicalMime, kind] of cases) {
    let result;
    try { result = validateOwnerStandardImageAuxInput(input(sourceMime)); }
    catch (error) { throw new Error(`${sourceMime}: ${(error as Error).message} (${(error as { code?: string }).code ?? "unknown"})`); }
    assert.equal(result.kind, kind);
    assert.equal(result.original_mime_type, sourceMime);
    assert.equal(result.mime_type, canonicalMime);
    assert.equal(result.width, null);
    assert.equal(result.height, null);
    assert.equal(result.duration, null);
    assert.equal(result.size, validBytes(sourceMime).byteLength);
    assert.match(result.sha256, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(result.metadata_confidence, "NOT_EXTRACTED");
    assert.equal(result.validation_confidence, sourceMime === "application/pdf"
      ? "PDF_HEADER_TAIL_GUARDS_ONLY_NOT_PARSED" : "STRUCTURAL_CONTAINER_VALIDATED_NOT_DECODED");
  }
  assert.equal(validateOwnerStandardImageAuxInput(input("video/mpeg", mpegProgramStream())).mime_type, "video/mpeg");
});

test("rejects mismatched MIME/container signatures and malformed container tails", () => {
  const invalid = [
    input("video/mp4", webm()),
    input("video/mov", bmff("isom")),
    input("video/3gpp", bmff("isom")),
    input("video/webm", Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80])),
    input("video/mpeg", Buffer.from([0, 0, 1, 0xb3])),
    input("video/x-flv", Buffer.from([0x46, 0x4c, 0x56, 1, 1, 0, 0, 0, 9])),
    input("video/x-ms-wmv", Buffer.from("not ASF")),
    input("application/pdf", Buffer.from("%PDF-1.7\n%%EOF"))
  ];
  for (const candidate of invalid) assert.throws(() => validateOwnerStandardImageAuxInput(candidate), OwnerStandardImageAuxInputError);
});

test("enforces per-file byte ceilings before decode and rejects foreign variants", () => {
  for (const [mime, bytes] of [["video/mp4", 20 * 1024 * 1024 + 1], ["application/pdf", 5 * 1024 * 1024 + 1]] as const) {
    const oversized = { ...input(mime), content_base64: "A".repeat(Math.ceil(bytes / 3) * 4) };
    assert.throws(() => validateOwnerStandardImageAuxInput(oversized), (error: unknown) =>
      error instanceof OwnerStandardImageAuxInputError && error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED");
  }
  assert.throws(() => validateOwnerStandardImageAuxInput({ ...input("video/mp4"), variant: "banana" }), OwnerStandardImageAuxInputError);
  assert.throws(() => validateOwnerStandardImageAuxInput({ ...input("video/mp4"), mime_type: "video/avi" }), OwnerStandardImageAuxInputError);
});

test("accepts Unicode basenames by UTF-8 byte length and rejects unsafe or oversized names", () => {
  const name = `${"猫".repeat(83)}.mp4`;
  assert.equal(Buffer.byteLength(name, "utf8") <= 255, true);
  assert.equal(validateOwnerStandardImageAuxInput(input("video/mp4", undefined, name)).filename, name);
  for (const filename of [`${"猫".repeat(84)}.mp4`, "../clip.mp4", "x\\clip.mp4", "clip\n.mp4", "\ud800.mp4"]) {
    assert.throws(() => validateOwnerStandardImageAuxInput(input("video/mp4", undefined, filename)), OwnerStandardImageAuxInputError);
  }
});

test("rejects getters, proxies, extra keys, encrypted PDF and caller-owned metadata", () => {
  let getterCalled = false;
  const getterInput = { variant: "banana-2.1", filename: "x.pdf", mime_type: "application/pdf", get content_base64() { getterCalled = true; return pdf().toString("base64"); } };
  assert.throws(() => validateOwnerStandardImageAuxInput(getterInput), OwnerStandardImageAuxInputError);
  assert.equal(getterCalled, false);
  assert.throws(() => validateOwnerStandardImageAuxInput(new Proxy(input("video/mp4"), {})), OwnerStandardImageAuxInputError);
  assert.throws(() => validateOwnerStandardImageAuxInput({ ...input("video/mp4"), width: 1 }), OwnerStandardImageAuxInputError);
  assert.throws(() => validateOwnerStandardImageAuxInput(input("application/pdf", pdf(true))), (error: unknown) =>
    error instanceof OwnerStandardImageAuxInputError && error.code === "UNSUPPORTED_ENCRYPTED_PDF");
});

test("returns an independently owned mutable byte copy", () => {
  const bytes = validBytes("video/mp4");
  const expected = new Uint8Array([
    0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00, 0x69, 0x73, 0x6f, 0x6d,
    0x00, 0x00, 0x00, 0x09, 0x6d, 0x64, 0x61, 0x74, 0x01,
    0x00, 0x00, 0x00, 0x08, 0x6d, 0x6f, 0x6f, 0x76
  ]);
  const original = new Uint8Array(expected);
  const result = validateOwnerStandardImageAuxInput(input("video/mp4", bytes));
  assert.notEqual(result.bytes, bytes);
  assert.equal(Object.getPrototypeOf(result.bytes), Uint8Array.prototype);
  assert.notEqual(result.bytes.buffer, bytes.buffer);
  assert.equal(result.bytes.buffer.byteLength, result.bytes.byteLength);
  assert.deepEqual(result.bytes, expected);
  result.bytes[0] = 0;
  assert.deepEqual(new Uint8Array(bytes), original);
  assert.equal(result.bytes[0], 0);
});

test("validates raw upload bytes without base64 conversion and snapshots caller-owned memory", () => {
  const source = validBytes("video/mp4");
  const original = new Uint8Array(source);
  const result = validateOwnerStandardImageAuxUploadData({
    variant: "banana-2.1", bytes: source, filename: "clip.mp4", mime_type: "video/mp4"
  });
  assert.deepEqual(result.bytes, original);
  assert.notEqual(result.bytes, source);
  source[0] = 0xff;
  assert.deepEqual(result.bytes, original);
});

test("rejects proxies, non-Uint8Array inputs, shared backing stores, and raw over-limit data", () => {
  const bytes = validBytes("video/mp4");
  const base = { variant: "banana-2.1", filename: "clip.mp4", mime_type: "video/mp4" };
  const invalidInputs: unknown[] = [
    { ...base, bytes: new Proxy(new Uint8Array(bytes), {}) },
    { ...base, bytes: new Uint8ClampedArray(bytes) },
    { ...base, bytes: new DataView(bytes.buffer) },
    { ...base, bytes: new Uint8Array(new SharedArrayBuffer(bytes.byteLength)) }
  ];
  for (const candidate of invalidInputs) assert.throws(() => validateOwnerStandardImageAuxUploadData(candidate), OwnerStandardImageAuxInputError);
  const oversized = new Uint8Array(20 * 1024 * 1024 + 1);
  assert.throws(() => validateOwnerStandardImageAuxUploadData({ ...base, bytes: oversized }), (error: unknown) =>
    error instanceof OwnerStandardImageAuxInputError && error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED");
  assert.equal(oversized[0], 0);
});
