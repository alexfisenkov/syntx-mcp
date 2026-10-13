import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { OwnerWanImageUploadService } from "../src/application/owner-wan-image-upload-service.js";
import { prepareOwnerWanImageRequest } from "../src/application/owner-wan-image-request-preparer.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const NOW = Date.parse("2026-10-10T12:00:00.000Z");
const ATTEMPT = "link_wan_owned_upload_service_0123456789";
const BINDING = Object.freeze({ tenant_id: "wan-upload-tenant", subject: "wan-upload-subject" });
const PRINCIPAL = Object.freeze({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });
const CATALOG = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;

function bmp24(width = 384, height = 384): Buffer {
  const stride = Math.ceil(width * 24 / 32) * 4;
  const bytes = Buffer.alloc(54 + stride * height);
  bytes.write("BM", 0, "ascii");
  bytes.writeUInt32LE(bytes.byteLength, 2);
  bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18);
  bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28);
  bytes.writeUInt32LE(0, 30);
  bytes.writeUInt32LE(stride * height, 34);
  return bytes;
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
  chunk.writeUInt32BE(data.byteLength, 0); chunk.write(name, 4, 4, "ascii"); Buffer.from(data).copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.byteLength)), 8 + data.byteLength);
  return chunk;
}

function png24(width = 384, height = 384): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr),
    pngChunk("IDAT", Buffer.from([0])), pngChunk("IEND", Buffer.alloc(0))]);
}

function jpegHeader(width = 384, height = 384): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff,
    0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);
}

function jpegWithExifOrientations(width: number, height: number, ...orientations: number[]): Buffer {
  const segments = orientations.map((orientation) => {
    const tiff = Buffer.alloc(26);
    tiff.write("II", 0, "ascii"); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
    tiff.writeUInt16LE(1, 8); tiff.writeUInt16LE(0x0112, 10); tiff.writeUInt16LE(3, 12);
    tiff.writeUInt32LE(1, 14); tiff.writeUInt16LE(orientation, 18); tiff.writeUInt32LE(0, 22);
    const payload = Buffer.concat([Buffer.from([0x45, 0x78, 0x69, 0x66, 0, 0]), tiff]);
    const marker = Buffer.alloc(4); marker[0] = 0xff; marker[1] = 0xe1; marker.writeUInt16BE(payload.byteLength + 2, 2);
    return Buffer.concat([marker, payload]);
  });
  return Buffer.concat([Buffer.from([0xff, 0xd8]), ...segments, jpegHeader(width, height).subarray(2)]);
}

function fullParameters(count: number, bboxList?: readonly (readonly number[][])[]) {
  return { aspect_ratio: "1:1", resolution: "1K", batch_size: 1, prompt_extend: true, seed: null,
    color_palette: [{ hex: "#FF0000", ratio: "50.00%" }, { hex: "#00FF00", ratio: "30.00%" }, { hex: "#0000FF", ratio: "20.00%" }],
    bbox_list: bboxList ?? Array.from({ length: count }, () => []) };
}

function webpHeader(width = 384, height = 384): Buffer {
  const bytes = Buffer.alloc(30); bytes.write("RIFF", 0, "ascii"); bytes.writeUInt32LE(bytes.byteLength - 8, 4);
  bytes.write("WEBPVP8 ", 8, "ascii"); bytes.writeUInt32LE(10, 16); bytes[23] = 0x9d; bytes[24] = 0x01; bytes[25] = 0x2a;
  bytes.writeUInt16LE(width & 0x3fff, 26); bytes.writeUInt16LE(height & 0x3fff, 28); return bytes;
}

function credentialBroker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation("wan-service-test-credential"); } };
}

function linkedAttempt(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: new Date(NOW + 60 * 60_000).toISOString(), linked: true as const };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 30 && !predicate(); index += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(predicate(), true);
}

test("uploads through the fixed native WAN method and issues a source-hash-bound private reference", async () => {
  const bytes = bmp24();
  let posts = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: credentialBroker(),
    fetchImpl: async (input, init) => {
      posts += 1;
      assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
      assert.equal(init?.method, "POST");
      assert.ok(init?.body instanceof FormData);
      const form = init.body as FormData;
      assert.equal(form.get("destination"), "uploaded");
      assert.equal(form.get("check_duplicates"), "true");
      assert.equal(form.get("model_type"), "wan_27_image");
      const file = form.get("files");
      assert.ok(file instanceof File);
      assert.equal(file.type, "image/bmp");
      assert.equal(file.name, "owner.bmp");
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
      return Response.json({ files: [{ id: "private-wan-provider-id", url: "https://r2.syntx.ai/wan/private.bmp",
        mime_type: "image/bmp", size: bytes.byteLength }] });
    }
  });
  const service = new OwnerWanImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never,
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  try {
    const receipt = await service.upload({ attemptId: ATTEMPT, variant: "wan_27_image", content_base64: bytes.toString("base64"),
      filename: "owner.bmp", mime_type: "image/bmp" });
    assert.equal(posts, 1);
    assert.equal(receipt.status, "uploaded");
    assert.equal(receipt.variant, "wan_27_image");
    assert.equal(receipt.size, bytes.byteLength);
    assert.equal(receipt.width, 384);
    assert.equal(receipt.height, 384);
    assert.equal(receipt.expires_in_seconds, 900);
    assert.equal(receipt.metadata_confidence, "CONTAINER_METADATA_ONLY");
    assert.match(receipt.reference_handle, /^wan_image_[0-9a-f-]{36}$/u);
    assert.match(receipt.sha256, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(receipt.sha256, `sha256:${createHash("sha256").update(bytes).digest("hex")}`);
    assert.equal(JSON.stringify(receipt).includes("r2.syntx.ai"), false);
    assert.equal(JSON.stringify(receipt).includes("private-wan-provider-id"), false);
    assert.equal(JSON.stringify(receipt).includes("owner.bmp"), false);

    const issuer = service.createOwnedReferenceBindingIssuer();
    const set = await issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "wan_27_image",
      reference_handles: [receipt.reference_handle] });
    assert.equal(set.reference_count, 1);
    assert.equal(set.variant, "wan_27_image");
    assert.equal(set.expires_at, NOW + 900_000);
    await service.invalidateAttempt(ATTEMPT);
    await assert.rejects(issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "wan_27_image",
      reference_handles: [receipt.reference_handle] }));
  } finally { await service.close(); }
});

test("accepts the four exact variants and canonical WAN MIME formats including the JPG alias", async () => {
  const inputs = [
    { variant: "wan_25_i2i_preview" as const, bytes: jpegHeader(), filename: "preview.jpg", mime_type: "image/jpg", expectedMime: "image/jpeg" },
    { variant: "wan_26_image" as const, bytes: png24(), filename: "image.png", mime_type: "image/png", expectedMime: "image/png" },
    { variant: "wan_27_image" as const, bytes: bmp24(), filename: "image.bmp", mime_type: "image/bmp", expectedMime: "image/bmp" },
    { variant: "wan_27_image_pro" as const, bytes: webpHeader(), filename: "image.webp", mime_type: "image/webp", expectedMime: "image/webp" },
    { variant: "wan_27_image" as const, bytes: jpegHeader(), filename: "alias.jpg", mime_type: "image/jpeg", expectedMime: "image/jpeg" }
  ];
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (_input, init) => {
    posts += 1;
    const form = init?.body as FormData;
    const index = posts - 1;
    const file = form.get("files") as File;
    assert.equal(form.get("model_type"), inputs[index]!.variant);
    assert.equal(file.type, inputs[index]!.expectedMime);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), inputs[index]!.bytes);
    return Response.json({ files: [{ url: `https://r2.syntx.ai/wan/${posts}.img`, mime_type: inputs[index]!.expectedMime,
      size: inputs[index]!.bytes.byteLength }] });
  } });
  const service = new OwnerWanImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never,
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  try {
    const receipts = [];
    for (const item of inputs) receipts.push(await service.upload({ attemptId: ATTEMPT, variant: item.variant,
      content_base64: item.bytes.toString("base64"), filename: item.filename, mime_type: item.mime_type }));
    assert.equal(posts, inputs.length);
    assert.deepEqual(receipts.map((item) => item.mime_type), inputs.map((item) => item.expectedMime));
    assert.deepEqual(receipts.map((item) => item.original_mime_type), inputs.map((item) => item.mime_type));
  } finally { await service.close(); }
});

test("invalid native receipts stay unknown and invalid input fails before any upload POST", async () => {
  const bytes = jpegHeader();
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    posts += 1;
    return Response.json({ files: [{ id: "private-id-must-not-leak", url: "https://r2.syntx.ai/wan/wrong.jpg",
      mime_type: "image/jpeg", size: bytes.byteLength + 1 }] });
  } });
  const service = new OwnerWanImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never,
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  try {
    await assert.rejects(service.upload({ attemptId: ATTEMPT, variant: "wan_27_image", content_base64: bytes.toString("base64"),
      filename: "wrong.jpg", mime_type: "image/jpeg" }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal("code" in error ? error.code : null, "UPLOAD_OUTCOME_UNKNOWN");
      assert.equal(error.message.includes("private-id-must-not-leak"), false);
      return true;
    });
    assert.equal(posts, 1);
    await assert.rejects(service.upload({ attemptId: ATTEMPT, variant: "wan_27_image", content_base64: "not-base64",
      filename: "bad.jpg", mime_type: "image/jpeg" }), (error: unknown) => {
      assert.equal(error instanceof Error && "code" in error ? error.code : null, "INVALID_IMAGE_INPUT");
      return true;
    });
    assert.equal(posts, 1);
  } finally { await service.close(); }
});

test("native request deadline becomes an unknown upload outcome and never retries", async () => {
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), requestTimeoutMs: 5,
    fetchImpl: async () => { posts += 1; return new Promise<Response>(() => undefined); } });
  const service = new OwnerWanImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never,
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  try {
    const bytes = jpegHeader();
    await assert.rejects(service.upload({ attemptId: ATTEMPT, variant: "wan_27_image", content_base64: bytes.toString("base64"),
      filename: "timeout.jpg", mime_type: "image/jpeg" }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts, 1);
  } finally { await service.close(); }
});

test("missing native credentials are reported as a pre-send principal failure", async () => {
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: {
    async useCredential<T>(_operation: (credential: string) => Promise<T>): Promise<T> { throw new Error("credential unavailable"); }
  }, fetchImpl: async () => { posts += 1; return Response.json({ files: [] }); } });
  const service = new OwnerWanImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never,
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  try {
    const bytes = jpegHeader();
    await assert.rejects(service.upload({ attemptId: ATTEMPT, variant: "wan_27_image", content_base64: bytes.toString("base64"),
      filename: "no-credential.jpg", mime_type: "image/jpeg" }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PRINCIPAL_NOT_LINKED");
    assert.equal(posts, 0);
  } finally { await service.close(); }
});

test("reference TTL begins before the native upload and cannot be renewed by issuer resolution", async () => {
  let now = NOW;
  const bytes = jpegHeader();
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    now += 2_500;
    return Response.json({ files: [{ url: "https://r2.syntx.ai/wan/original-ttl.jpg", mime_type: "image/jpeg", size: bytes.byteLength }] });
  } });
  const service = new OwnerWanImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never,
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => now });
  try {
    const receipt = await service.upload({ attemptId: ATTEMPT, variant: "wan_27_image", content_base64: bytes.toString("base64"),
      filename: "original-ttl.jpg", mime_type: "image/jpeg" });
    assert.equal(receipt.expires_in_seconds, 898);
    const issuer = service.createOwnedReferenceBindingIssuer();
    const set = await issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "wan_27_image",
      reference_handles: [receipt.reference_handle] });
    assert.equal(set.expires_at, NOW + 900_000);
    now = NOW + 900_001;
    await assert.rejects(issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "wan_27_image",
      reference_handles: [receipt.reference_handle] }));
    issuer.close();
  } finally { await service.close(); }
});

test("attempt invalidation and close drain pending work without allowing a late upload receipt to escape", async () => {
  const bytes = jpegHeader();
  let posts = 0;
  let finishFetch!: (response: Response) => void;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    posts += 1;
    return new Promise<Response>((resolve) => { finishFetch = resolve; });
  } });
  const service = new OwnerWanImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never,
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const upload = service.upload({ attemptId: ATTEMPT, variant: "wan_27_image", content_base64: bytes.toString("base64"),
    filename: "pending.jpg", mime_type: "image/jpeg" });
  await waitUntil(() => posts === 1);
  await service.invalidateAttempt(ATTEMPT);
  await assert.rejects(upload, (error: unknown) => error instanceof Error && "code" in error && error.code === "UPLOAD_OUTCOME_UNKNOWN");

  const secondAttempt = "link_wan_upload_close_pending_0123456789";
  const closeUpload = service.upload({ attemptId: secondAttempt, variant: "wan_27_image", content_base64: bytes.toString("base64"),
    filename: "closing.jpg", mime_type: "image/jpeg" });
  await waitUntil(() => posts === 2 && typeof finishFetch === "function");
  const closing = service.close();
  await closing;
  await assert.rejects(closeUpload, (error: unknown) => error instanceof Error && "code" in error && error.code === "UPLOAD_OUTCOME_UNKNOWN");
  finishFetch(Response.json({ files: [{ id: "late-private-id", url: "https://r2.syntx.ai/wan/late.jpg",
    mime_type: "image/jpeg", size: bytes.byteLength }] }));
});

test("issuer binds projected source dimensions and keeps unknown orientation usable only without boxes", async () => {
  const knownBytes = jpegWithExifOrientations(384, 240, 6);
  const unknownBytes = jpegWithExifOrientations(384, 240, 1, 6);
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (_input, init) => {
    posts += 1;
    const file = (init?.body as FormData).get("files") as File;
    const body = Buffer.from(await file.arrayBuffer());
    return Response.json({ files: [{ url: `https://r2.syntx.ai/wan/coordinate-${posts}.jpg`, mime_type: "image/jpeg", size: body.byteLength }] });
  } });
  const service = new OwnerWanImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never,
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  try {
    const issuer = service.createOwnedReferenceBindingIssuer();
    const knownReceipt = await service.upload({ attemptId: ATTEMPT, variant: "wan_27_image", content_base64: knownBytes.toString("base64"),
      filename: "known.jpg", mime_type: "image/jpeg" });
    const knownProjection = (knownReceipt as unknown as Record<string, unknown>).coordinate_projection;
    assert.deepEqual(knownProjection, { orientation: 6, projected_width: 240, projected_height: 384,
      confidence: "HEADER_ORIENTATION_PROJECTION_NOT_BROWSER_DECODE" });
    assert.equal(knownReceipt.width, 384);
    assert.equal(knownReceipt.height, 240);
    assert.equal(Object.isFrozen(knownProjection), true);
    assert.deepEqual(Object.keys(knownProjection as object), ["orientation", "projected_width", "projected_height", "confidence"]);
    assert.deepEqual(Object.keys(knownReceipt), ["status", "reference_handle", "variant", "original_mime_type", "mime_type",
      "width", "height", "size", "sha256", "expires_in_seconds", "metadata_confidence", "coordinate_projection"]);
    assert.equal(JSON.stringify(knownReceipt).includes("Exif"), false);
    assert.equal(JSON.stringify(knownReceipt).includes("r2.syntx.ai"), false);
    for (const forbidden of ["file_url", "fileUrl", "providerFileId", "principal", "attemptId", "epoch", "sha256",
      "coordinate_source_sha256", "catalog_version", "profile_schema_hash", "reference_handle"]) {
      assert.equal(Object.hasOwn(knownProjection as object, forbidden), false);
    }
    const knownSet = await issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "wan_27_image",
      reference_handles: [knownReceipt.reference_handle] });
    const knownCandidate = prepareOwnerWanImageRequest({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "wan_27_image",
      parameters: fullParameters(1, [[[10, 10, 200, 300]]]), reference_set: knownSet, prompt: "subject",
      bbox_coordinate_policy: "LOCAL_HEADER_ORIENTATION_PROJECTION_UNVERIFIED_BROWSER" },
    { catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW });
    assert.equal(knownCandidate.input_images[0]!.coordinate_metadata.orientation, 6);
    assert.equal(knownCandidate.input_images[0]!.coordinate_metadata.projected_width, 240);
    assert.equal(knownCandidate.input_images[0]!.coordinate_metadata.projected_height, 384);
    assert.equal(knownCandidate.input_images[0]!.sha256, knownReceipt.sha256);

    const unknownReceipt = await service.upload({ attemptId: ATTEMPT, variant: "wan_27_image", content_base64: unknownBytes.toString("base64"),
      filename: "unknown.jpg", mime_type: "image/jpeg" });
    assert.deepEqual((unknownReceipt as unknown as Record<string, unknown>).coordinate_projection, {
      orientation: null, projected_width: null, projected_height: null, confidence: "UNSUPPORTED_OR_MALFORMED_METADATA"
    });
    const unknownSet = await issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "wan_27_image",
      reference_handles: [unknownReceipt.reference_handle] });
    const unknownCandidate = prepareOwnerWanImageRequest({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "wan_27_image",
      parameters: fullParameters(1), reference_set: unknownSet, prompt: "subject", bbox_coordinate_policy: null },
    { catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW });
    assert.equal(unknownCandidate.input_images[0]!.coordinate_metadata.confidence, "UNSUPPORTED_OR_MALFORMED_METADATA");
    assert.equal(unknownCandidate.request.settings.file_urls.length, 1);
    assert.equal(JSON.stringify(unknownCandidate).includes("r2.syntx.ai"), false);
    await assert.rejects(Promise.resolve().then(() => prepareOwnerWanImageRequest({ principal: PRINCIPAL,
      attempt_id: ATTEMPT, variant: "wan_27_image", parameters: fullParameters(1, [[[1, 1, 2, 2]]]),
      reference_set: unknownSet, prompt: "subject", bbox_coordinate_policy: "LOCAL_HEADER_ORIENTATION_PROJECTION_UNVERIFIED_BROWSER" },
    { catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW })));
    assert.equal(posts, 2);
    issuer.close();
  } finally { await service.close(); }
});

test("bounds native uploads to four pending operations and prunes 128 expired records and attempts", async () => {
  let posts = 0;
  const releases: Array<(response: Response) => void> = [];
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (_input, init) => {
    posts += 1;
    if (posts <= 4) return new Promise<Response>((resolve) => releases.push(resolve));
    const file = (init?.body as FormData).get("files") as File;
    return Response.json({ files: [{ id: `provider-${posts}`, url: `https://r2.syntx.ai/wan/${file.name}`,
      mime_type: "image/jpeg", size: file.size }] });
  } });
  let now = NOW;
  const service = new OwnerWanImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never,
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => now });
  const bytes = jpegHeader();
  const makeInput = (attemptId: string, filename: string) => ({ attemptId, variant: "wan_27_image" as const,
    content_base64: bytes.toString("base64"), filename, mime_type: "image/jpeg" as const });
  try {
    const firstAttempts = [0, 1, 2, 3].map((index) => `link_wan_capacity_${String(index).padStart(3, "0")}_0123456789`);
    const firstWave = firstAttempts.map((attemptId, index) => service.upload(makeInput(attemptId, `pending-${index}.jpg`)));
    await waitUntil(() => posts === 4);
    await assert.rejects(service.upload(makeInput(ATTEMPT, "fifth.jpg")),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "SERVICE_BUSY");
    assert.equal(posts, 4);
    for (let index = 0; index < releases.length; index += 1) releases[index]!(Response.json({ files: [{
      id: `pending-${index}`, url: `https://r2.syntx.ai/wan/pending-${index}.jpg`, mime_type: "image/jpeg", size: bytes.byteLength
    }] }));
    const firstReceipts = await Promise.all(firstWave);
    assert.equal(firstReceipts.length, 4);

    const receipts = [...firstReceipts];
    for (let index = 4; index < 128; index += 1) {
      const attemptId = `link_wan_capacity_${String(index).padStart(3, "0")}_0123456789`;
      try { receipts.push(await service.upload(makeInput(attemptId, `capacity-${index}.jpg`))); }
      catch (error) { throw new Error(`capacity upload ${index} failed: ${String((error as { code?: unknown }).code)}`); }
    }
    assert.equal(receipts.length, 128);
    assert.equal(posts, 128);
    const overflowAttempt = "link_wan_capacity_128_0123456789";
    await assert.rejects(service.upload(makeInput(overflowAttempt, "overflow.jpg")),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "CAPACITY_EXCEEDED");
    assert.equal(posts, 128);

    now = NOW + 900_001;
    const afterPrune = await service.upload(makeInput(overflowAttempt, "after-prune.jpg"));
    assert.equal(afterPrune.expires_in_seconds, 900);
    assert.equal(posts, 129);
    const issuer = service.createOwnedReferenceBindingIssuer();
    await assert.rejects(issuer.issue({ principal: Object.freeze({ ...PRINCIPAL, connection_id: firstAttempts[0] }),
      attempt_id: firstAttempts[0], variant: "wan_27_image", reference_handles: [firstReceipts[0]!.reference_handle] }));
  } finally { await service.close(); }
});
