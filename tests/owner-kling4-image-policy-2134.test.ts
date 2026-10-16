import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

type ModelId = "kling_4_keyframes" | "kling_4_omni";
type Receipt = Readonly<{
  status: "LOCAL_SOURCE_VALIDATED";
  model_id: ModelId;
  source_mime_type: "image/jpg" | "image/jpeg" | "image/png" | "image/avif";
  mime_type: "image/jpeg" | "image/png" | "image/avif";
  filename: string;
  width: number;
  height: number;
  size: number;
  sha256: string;
  metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED";
  generation_permit: false;
  owner_upload_binding: "NOT_ESTABLISHED";
}>;
type PolicyModule = {
  readonly OWNER_KLING4_IMAGE_POLICY: Readonly<Record<string, unknown>>;
  validateOwnerKling4Image(input: unknown): Receipt;
  isValidatedOwnerKling4Image(receipt: unknown, modelId: ModelId): boolean;
  readValidatedOwnerKling4Image(receipt: unknown, modelId: ModelId): Readonly<{
    bytes: Uint8Array; filename: string; mime_type: Receipt["mime_type"];
    width: number; height: number; size: number; sha256: string;
  }> | null;
  releaseValidatedOwnerKling4Image(receipt: unknown): boolean;
  OwnerKling4ImagePolicyError: new (code: string) => Error & { readonly code: string };
};

const MODEL_IDS: readonly ModelId[] = ["kling_4_keyframes", "kling_4_omni"];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

async function loadPolicy(): Promise<PolicyModule | null> {
  try {
    return await import(new URL("../src/application/owner-kling4-image-policy.js", import.meta.url).href) as PolicyModule;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") return null;
    throw error;
  }
}

function input(model_id: ModelId, bytes: Uint8Array, mime_type: string, filename = "кадр.bin") {
  return { model_id, filename, mime_type, bytes };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngWithDimensions(width: number, height: number): Buffer {
  const bytes = Buffer.from(PNG);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return bytes;
}

function jpegWithDimensions(width: number, height: number): Buffer {
  return Buffer.from([0xff,0xd8,0xff,0xc0,0,0x0b,8,height >> 8,height & 0xff,width >> 8,width & 0xff,1,1,0x11,0,
    0xff,0xda,0,8,1,1,0,0,0x3f,0,0,0xff,0xd9]);
}

function jpegAtSize(size: number): Buffer {
  const tail = jpegWithDimensions(300, 300).subarray(2), parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let remaining = size - 2 - tail.byteLength;
  while (remaining > 65_537) {
    const segment = Buffer.alloc(65_537); segment[0] = 0xff; segment[1] = 0xe1; segment.writeUInt16BE(65_535, 2);
    parts.push(segment); remaining -= segment.length;
  }
  const final = Buffer.alloc(remaining); final[0] = 0xff; final[1] = 0xe1; final.writeUInt16BE(remaining - 2, 2);
  parts.push(final, tail);
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
  const ispe = makeBox("ispe", full(0, Buffer.concat([u32(width), u32(height)])));
  const ftyp = makeBox("ftyp", Buffer.from("avif\0\0\0\0mif1avif", "ascii"));
  const hdlr = makeBox("hdlr", full(0, Buffer.from([0, 0, 0, 0, ...Buffer.from("pict", "ascii"), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])));
  const pitm = makeBox("pitm", full(0, u16(1)));
  const infe = makeBox("infe", Buffer.concat([full(2, Buffer.concat([u16(1), u16(0), Buffer.from("av01", "ascii"), Buffer.from([0])]))]));
  const iinf = makeBox("iinf", full(0, Buffer.concat([u16(1), infe])));
  const ipco = makeBox("ipco", ispe);
  const ipma = makeBox("ipma", full(0, Buffer.concat([u32(1), u16(1), Buffer.from([1, 1])] )));
  return Buffer.concat([ftyp, makeBox("meta", full(0, Buffer.concat([hdlr, pitm, iinf, makeBox("iprp", Buffer.concat([ipco, ipma]))]))), makeBox("mdat", Buffer.from([0]))]);
}

function assertPolicyError(policy: PolicyModule, code: string, action: () => unknown): void {
  assert.throws(action, (error: unknown) => error instanceof policy.OwnerKling4ImagePolicyError && error.code === code);
}

test("validates structurally inspected JPEG, PNG, AVIF for each K4 model with nominal receipt binding", async () => {
  const policy = await loadPolicy();
  assert.ok(policy, "K4 image policy must be importable and validate source image behavior");
  const cases = [
    [jpegWithDimensions(300, 300), "image/jpg", "image/jpeg", "кадр.jpg"],
    [pngWithDimensions(300, 300), "image/png", "image/png", "кадр.png"],
    [avifWithDimensions(300, 300), "image/avif", "image/avif", "кадр.avif"]
  ] as const;

  for (const modelId of MODEL_IDS) {
    for (const [bytes, sourceMime, canonicalMime, filename] of cases) {
      const callerBytes = Buffer.from(bytes);
      const receipt = policy.validateOwnerKling4Image(input(modelId, callerBytes, sourceMime));
      assert.equal(receipt.status, "LOCAL_SOURCE_VALIDATED");
      assert.equal(receipt.model_id, modelId);
      assert.equal(receipt.source_mime_type, sourceMime);
      assert.equal(receipt.mime_type, canonicalMime);
      assert.equal(receipt.filename, filename);
      assert.equal(receipt.metadata_confidence, "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED");
      assert.equal(receipt.generation_permit, false);
      assert.equal(receipt.owner_upload_binding, "NOT_ESTABLISHED");
      assert.equal(receipt.sha256, createHash("sha256").update(callerBytes).digest("hex"));
      assert.deepEqual(callerBytes, bytes, "validation must leave caller-owned bytes unchanged");
      assert.equal(Object.isFrozen(receipt), true);
      assert.equal(policy.isValidatedOwnerKling4Image(receipt, modelId), true);
      const otherModelId: ModelId = modelId === "kling_4_keyframes" ? "kling_4_omni" : "kling_4_keyframes";
      assert.equal(policy.isValidatedOwnerKling4Image(receipt, otherModelId), false);
      assert.equal(policy.releaseValidatedOwnerKling4Image(receipt), true);
      assert.deepEqual(callerBytes, bytes, "releasing the private snapshot must not wipe caller-owned bytes");
    }
  }
});

test("accepts inclusive dimension and aspect-ratio edges but rejects values beyond each bound", async () => {
  const policy = await loadPolicy(); assert.ok(policy, "K4 image policy must be importable");
  for (const [width, height] of [[300, 750], [750, 300], [10_000, 4_000]] as const) {
    const receipt = policy.validateOwnerKling4Image(input("kling_4_omni", pngWithDimensions(width, height), "image/png"));
    assert.equal(receipt.width, width); assert.equal(receipt.height, height);
    policy.releaseValidatedOwnerKling4Image(receipt);
  }
  for (const [width, height] of [[300, 751], [751, 300], [10_001, 4_000], [299, 750], [750, 299]] as const) {
    assertPolicyError(policy, "INVALID_IMAGE_INPUT", () => policy.validateOwnerKling4Image(input("kling_4_keyframes", pngWithDimensions(width, height), "image/png")));
  }
});

test("rejects oversized bytes, MIME spoofing, unsupported WebP, and invalid exact inputs", async () => {
  const policy = await loadPolicy(); assert.ok(policy, "K4 image policy must be importable");
  assert.equal(policy.OWNER_KLING4_IMAGE_POLICY.max_file_size_bytes, 30 * 1024 * 1024);
  const maximum = jpegAtSize(30 * 1024 * 1024);
  const maximumReceipt = policy.validateOwnerKling4Image(input("kling_4_keyframes", maximum, "image/jpeg", "maximum.jpg"));
  assert.equal(maximumReceipt.size, 30 * 1024 * 1024);
  policy.releaseValidatedOwnerKling4Image(maximumReceipt);
  assertPolicyError(policy, "LOCAL_RESOURCE_LIMIT_EXCEEDED", () =>
    policy.validateOwnerKling4Image(input("kling_4_keyframes", Buffer.alloc(30 * 1024 * 1024 + 1), "image/jpeg")));
  assertPolicyError(policy, "INVALID_IMAGE_INPUT", () => policy.validateOwnerKling4Image(input("kling_4_omni", pngWithDimensions(300, 300), "image/jpeg")));
  assertPolicyError(policy, "INVALID_IMAGE_INPUT", () => policy.validateOwnerKling4Image(input("kling_4_omni", Buffer.alloc(32), "image/webp")));
  assertPolicyError(policy, "INVALID_IMAGE_INPUT", () => policy.validateOwnerKling4Image({ ...input("kling_4_omni", pngWithDimensions(300, 300), "image/png"), extra: true }));

  let getterCalls = 0;
  const getterInput = Object.defineProperties({}, {
    model_id: { enumerable: true, get() { getterCalls += 1; return "kling_4_omni"; } },
    filename: { enumerable: true, value: "x.png" }, mime_type: { enumerable: true, value: "image/png" },
    bytes: { enumerable: true, value: pngWithDimensions(300, 300) }
  });
  assertPolicyError(policy, "INVALID_IMAGE_INPUT", () => policy.validateOwnerKling4Image(getterInput));
  assert.equal(getterCalls, 0, "exact input inspection must not invoke accessors");
  assertPolicyError(policy, "INVALID_IMAGE_INPUT", () => policy.validateOwnerKling4Image(new Proxy(input("kling_4_omni", pngWithDimensions(300, 300), "image/png"), {})));
  assertPolicyError(policy, "INVALID_IMAGE_INPUT", () => policy.validateOwnerKling4Image(input("kling_4_omni", new Uint8Array(new SharedArrayBuffer(32)), "image/png")));
});

test("keeps an owned snapshot across caller and returned-copy mutation, then revokes it on release", async () => {
  const policy = await loadPolicy(); assert.ok(policy, "K4 image policy must be importable");
  const callerBytes = pngWithDimensions(300, 300), original = Buffer.from(callerBytes);
  const receipt = policy.validateOwnerKling4Image(input("kling_4_keyframes", callerBytes, "image/png"));
  callerBytes.fill(0);
  assert.equal(policy.isValidatedOwnerKling4Image(receipt, "kling_4_keyframes"), true);
  const firstCopy = policy.readValidatedOwnerKling4Image(receipt, "kling_4_keyframes");
  assert.ok(firstCopy); assert.deepEqual(Buffer.from(firstCopy.bytes), original);
  firstCopy.bytes.fill(0);
  const nextCopy = policy.readValidatedOwnerKling4Image(receipt, "kling_4_keyframes");
  assert.ok(nextCopy); assert.deepEqual(Buffer.from(nextCopy.bytes), original);
  assert.equal(policy.readValidatedOwnerKling4Image(receipt, "kling_4_omni"), null);
  assert.equal(policy.releaseValidatedOwnerKling4Image(receipt), true);
  assert.equal(policy.isValidatedOwnerKling4Image(receipt, "kling_4_keyframes"), false);
  assert.equal(policy.readValidatedOwnerKling4Image(receipt, "kling_4_keyframes"), null);
  assert.equal(policy.releaseValidatedOwnerKling4Image(receipt), false);
  assert.notDeepEqual(callerBytes, original, "release must not restore or wipe caller-owned bytes");
});

test("preserves a distinct local AVIF unsupported-composition outcome and truthful confidence", async () => {
  const policy = await loadPolicy(); assert.ok(policy, "K4 image policy must be importable");
  const sequence = avifWithDimensions(300, 300); sequence.write("avis", 8, 4, "ascii");
  assert.equal(policy.OWNER_KLING4_IMAGE_POLICY.metadata_confidence, "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED");
  assert.equal(policy.OWNER_KLING4_IMAGE_POLICY.avif_supported_subset, "CONSERVATIVE_PRIMARY_ITEM_STRUCTURE_ONLY");
  assertPolicyError(policy, "UNSUPPORTED_AVIF_COMPOSITION", () =>
    policy.validateOwnerKling4Image(input("kling_4_omni", sequence, "image/avif")));
});
