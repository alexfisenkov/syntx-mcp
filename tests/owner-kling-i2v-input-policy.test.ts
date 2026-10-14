import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import {
  OwnerKlingI2VImageInputError,
  OWNER_KLING_I2V_IMAGE_INPUT_POLICY,
  readValidatedOwnerKlingI2VImageInput,
  validateOwnerKlingI2VImageInput
} from "../src/application/owner-kling-i2v-input-policy.js";
import {
  OwnerKlingI2VUploadContextError,
  readOwnerKlingI2VUploadReferenceForClient,
  uploadOwnerKlingI2VImage
} from "../src/adapter/syntx/kling-i2v-upload-context.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const AVIF_16X16 = Buffer.from("AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAkAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAQAAAAEAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAsbWRhdAoKAAAAAZ/41fIAgDIWEACXgBBAggAAEABcEytNbG+TY8nR6A==", "base64");

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

function crc32Fast(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]!;
  return (crc ^ 0xffffffff) >>> 0;
}

function png(width: number, height: number): Buffer {
  const bytes = Buffer.from(PNG_1X1);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return bytes;
}

function structurallyValidPngOver10MiB(): Buffer {
  const base = png(300, 300);
  const iendOffset = base.byteLength - 12;
  const data = Buffer.alloc(10 * 1024 * 1024 + 1 - base.byteLength - 12, 0x41);
  data.write("Comment\0", 0, "latin1");
  const chunk = Buffer.alloc(12 + data.byteLength);
  chunk.writeUInt32BE(data.byteLength, 0);
  chunk.write("tEXt", 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32Fast(chunk.subarray(4, 8 + data.byteLength)), 8 + data.byteLength);
  return Buffer.concat([base.subarray(0, iendOffset), chunk, base.subarray(iendOffset)]);
}

function jpeg(width: number, height: number): Buffer {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0, 1, 0, 1, 1, 1, 0x11, 0,
    0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0, 0xff, 0xd9]);
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  return bytes;
}

function webp(width: number, height: number): Buffer {
  const bytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x12, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x4c, 5, 0, 0, 0, 0x2f, 0, 0, 0, 0, 0]);
  const w = width - 1;
  const h = height - 1;
  bytes[21] = w & 0xff;
  bytes[22] = ((w >>> 8) & 0x3f) | ((h & 0x03) << 6);
  bytes[23] = (h >>> 2) & 0xff;
  bytes[24] = (h >>> 10) & 0x0f;
  return bytes;
}

function avif(width: number, height: number): Buffer {
  const bytes = Buffer.from(AVIF_16X16);
  const ispe = bytes.indexOf(Buffer.from("ispe"));
  assert.notEqual(ispe, -1);
  bytes.writeUInt32BE(width, ispe + 8);
  bytes.writeUInt32BE(height, ispe + 12);
  return bytes;
}

function input(bytes: Uint8Array, filename: string, mime_type: string) {
  return { content_base64: Buffer.from(bytes).toString("base64"), filename, mime_type };
}

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation("local-test-token"); } };
}

test("Kling source policy records five MIME spellings, a 30 MiB ceiling, and minimum side 300", () => {
  assert.deepEqual(OWNER_KLING_I2V_IMAGE_INPUT_POLICY.mime_types,
    ["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"]);
  assert.equal(OWNER_KLING_I2V_IMAGE_INPUT_POLICY.source_max_bytes, 31_457_280);
  assert.equal(OWNER_KLING_I2V_IMAGE_INPUT_POLICY.local_max_bytes, 31_457_280);
  assert.equal(OWNER_KLING_I2V_IMAGE_INPUT_POLICY.min_side, 300);
  assert.match(OWNER_KLING_I2V_IMAGE_INPUT_POLICY.local_max_bytes_policy, /NOT_PROVIDER_ACCEPTANCE/u);
});

test("validates actual PNG bytes, canonicalizes the JPG alias, and returns isolated snapshots", () => {
  const source = png(300, 301);
  const validated = validateOwnerKlingI2VImageInput(input(source, "frame.png", "image/png"));
  assert.equal(validated.width, 300);
  assert.equal(validated.height, 301);
  assert.equal(validated.metadata_confidence, "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS");
  assert.equal(validated.sha256, createHash("sha256").update(source).digest("hex"));
  const first = validated.bytes;
  first.fill(0);
  assert.deepEqual(validated.bytes, new Uint8Array(source));
  assert.equal(readValidatedOwnerKlingI2VImageInput({ ...validated }), null);
  assert.equal(validateOwnerKlingI2VImageInput(input(jpeg(300, 300), "frame.jpg", "image/jpg")).mime_type, "image/jpeg");
});

test("parses AVIF container dimensions under the full local 30 MiB ceiling", () => {
  const validated = validateOwnerKlingI2VImageInput(input(avif(300, 300), "frame.avif", "image/avif"));
  assert.equal(validated.mime_type, "image/avif");
  assert.equal(validated.width, 300);
  assert.equal(validated.height, 300);
});

test("validates JPEG and WebP dimensions from their bytes rather than trusting input claims", () => {
  for (const [bytes, filename, mime] of [
    [jpeg(300, 320), "frame.jpg", "image/jpeg"],
    [webp(320, 300), "frame.webp", "image/webp"]
  ] as const) {
    const validated = validateOwnerKlingI2VImageInput(input(bytes, filename, mime));
    assert.equal(validated.width >= 300, true);
    assert.equal(validated.height >= 300, true);
    assert.equal(validated.mime_type, mime);
  }
});

test("rejects claimed MIME mismatch, sub-300 dimensions, unsafe names, and unlisted fields", () => {
  const small = png(299, 300);
  const invalidInputs = [
    input(png(300, 300), "frame.png", "image/jpeg"),
    input(small, "frame.png", "image/png"),
    input(png(300, 300), "../frame.png", "image/png"),
    { ...input(png(300, 300), "frame.png", "image/png"), url: "https://r2.syntx.ai/file.png" }
  ];
  for (const candidate of invalidInputs) {
    assert.throws(() => validateOwnerKlingI2VImageInput(candidate), (error: unknown) =>
      error instanceof OwnerKlingI2VImageInputError && error.code === "INVALID_IMAGE_INPUT");
  }
});

test("rejects an over-cap source as a local resource limit before decoding", () => {
  const encodedOverCap = "A".repeat(Math.ceil(31_457_281 / 3) * 4);
  assert.throws(() => validateOwnerKlingI2VImageInput({
    content_base64: encodedOverCap, filename: "frame.png", mime_type: "image/png"
  }), (error: unknown) => error instanceof OwnerKlingI2VImageInputError && error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED");
});

test("seals a single native upload to its client without returning URL or file ID", async () => {
  const pngBytes = png(300, 300);
  let uploadCalls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (request, init) => {
    uploadCalls += 1;
    assert.equal(String(request), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    const form = init?.body as FormData;
    assert.equal(form.get("destination"), "hidden");
    assert.equal(form.get("model_type"), "kling_image2video");
    assert.equal(form.get("check_duplicates"), "true");
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.name, "frame.png");
    assert.equal(file.type, "image/png");
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array(pngBytes));
    return new Response(JSON.stringify({ files: [{ id: 9001, url: "https://r2.syntx.ai/hidden/frame.png" }] }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  } });

  const context = await uploadOwnerKlingI2VImage(client, input(pngBytes, "frame.png", "image/png"), "hidden");
  assert.equal(uploadCalls, 1);
  assert.equal(context.destination, "hidden");
  assert.equal(context.status, "uploaded");
  assert.equal(context.input_acceptance, "SOURCE_FORMAT_DECLARED_PROVIDER_ACCEPTANCE_UNVERIFIED");
  assert.equal(Object.hasOwn(context, "url"), false);
  assert.equal(Object.hasOwn(context, "file_id"), false);
  assert.deepEqual(readOwnerKlingI2VUploadReferenceForClient(client, context), { url: "https://r2.syntx.ai/hidden/frame.png" });
  assert.equal(readOwnerKlingI2VUploadReferenceForClient(new SyntxChatHttpClient({ credentialBroker: broker() }), context), null);
  assert.equal(readOwnerKlingI2VUploadReferenceForClient(client, { ...context }), null);
  await assert.rejects(uploadOwnerKlingI2VImage(client, input(pngBytes, "frame.png", "image/png"), undefined as never),
    (error: unknown) => error instanceof OwnerKlingI2VUploadContextError && error.code === "INVALID_DESTINATION");
});

test("dedicated Kling native upload accepts a structural PNG above 10 MiB while generic upload remains capped", async () => {
  const largePng = structurallyValidPngOver10MiB();
  assert.equal(largePng.byteLength, 10 * 1024 * 1024 + 1);
  let dedicatedCalls = 0;
  const dedicatedClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_request, init) => {
    dedicatedCalls += 1;
    const form = init?.body as FormData;
    assert.equal(form.get("destination"), "uploaded");
    assert.equal(form.get("model_type"), "kling_image2video");
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.size, largePng.byteLength);
    assert.equal(file.type, "image/png");
    return new Response(JSON.stringify({ files: [{ url: "https://r2.syntx.ai/uploaded/large.png",
      mime_type: "image/png", size: largePng.byteLength }] }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  } });
  const reference = await dedicatedClient.uploadKlingI2VImageReference({
    bytes: largePng, filename: "large.png", mime_type: "image/png"
  }, "uploaded");
  assert.equal(reference.url, "https://r2.syntx.ai/uploaded/large.png");
  assert.equal(dedicatedCalls, 1);

  let genericCalls = 0;
  const genericClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    genericCalls += 1;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  } });
  await assert.rejects(genericClient.uploadFileReferences({ bytes: largePng, filename: "large.png", mime_type: "image/png",
    destination: "uploaded", check_duplicates: true, model_type: "kling_image2video" }));
  assert.equal(genericCalls, 0);
  largePng.fill(0);
});

