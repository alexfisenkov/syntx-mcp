import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { OwnerSeedreamImageUploadService, OwnerSeedreamImageUploadServiceError } from "../src/application/owner-seedream-image-upload-service.js";
import { OwnerSeedreamImagePrepareError, isOwnerSeedreamImagePreparedCandidateForPrincipal, prepareOwnerSeedreamImageRequest } from "../src/application/owner-seedream-image-request-preparer.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const ATTEMPT = "link_seedream_upload_service_0123456789";
const BINDING = Object.freeze({ tenant_id: "seedream-upload-tenant", subject: "seedream-upload-subject" });
const NOW = Date.parse("2026-10-11T00:00:00.000Z");
const CATALOG = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);

function credentialBroker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation("synthetic-seedream-upload-credential"); } };
}
function crc32(bytes: Buffer): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}
function png15(alpha = 255, red = 20): Buffer {
  const width = 15, height = 15, ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows = Array.from({ length: height }, () => Buffer.from([0, ...Array.from({ length: width }, () => [red, 40, 60, alpha]).flat()]));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))), pngChunk("IEND", Buffer.alloc(0))]);
}
function pngWithUnsupportedExif(): Buffer {
  const source = png15();
  return Buffer.concat([source.subarray(0, 33), pngChunk("eXIf", Buffer.from([1, 2, 3])), source.subarray(33)]);
}
function pngWithCorruptDeflate(): Buffer {
  const source = png15();
  const idatLength = source.readUInt32BE(33);
  const compressed = Buffer.from(source.subarray(37, 37 + idatLength));
  const last = compressed.length - 1;
  compressed[last] = compressed[last]! ^ 0xff;
  return Buffer.concat([source.subarray(0, 33), pngChunk("IDAT", compressed), source.subarray(41 + idatLength)]);
}
function bmp20(): Buffer {
  const rowBytes = 60, bytes = Buffer.alloc(54 + rowBytes * 20);
  bytes.write("BM"); bytes.writeUInt32LE(bytes.byteLength, 2); bytes.writeUInt32LE(54, 10); bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(20, 18); bytes.writeInt32LE(20, 22); bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28);
  bytes.writeUInt32LE(rowBytes * 20, 34); return bytes;
}
function linkedAttempt(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: null, linked: true };
}
function createService(fetchImpl: typeof fetch, now: () => number = () => NOW) {
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl });
  const service = new OwnerSeedreamImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now });
  return { client, service };
}
async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100 && !predicate(); index += 1) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(predicate(), true, "bounded wait did not reach expected state");
}

test("owned Flash PNG witness supports transparent preparation without caller alpha authority", async () => {
  const source = png15(128);
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (input, init) => {
    posts += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    const form = init?.body as FormData;
    assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(form.get("destination"), "uploaded");
    assert.equal(form.get("check_duplicates"), "true");
    assert.equal(form.get("model_type"), "seedream-5.0-flash");
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.type, "image/png");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), source);
    return Response.json({ files: [{ id: "private-seedream-id", url: "https://r2.syntx.ai/private/seedream/source.png", mime_type: "image/png", size: source.byteLength }] });
  } });
  const service = new OwnerSeedreamImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  try {
    const receipt = await service.upload({ attemptId: ATTEMPT, variant: "seedream-5.0-flash",
      content_base64: source.toString("base64"), filename: "owned.png", mime_type: "image/png" });
    assert.equal(posts, 1);
    assert.equal(receipt.status, "uploaded");
    assert.equal(receipt.variant, "seedream-5.0-flash");
    assert.equal(receipt.width, 15);
    assert.equal(receipt.height, 15);
    assert.equal(receipt.source_alpha_eligible, true);
    assert.equal(receipt.source_alpha_confidence, "SOURCE_CANVAS_ALPHA8_NEAREST_SAMPLED");
    assert.equal(JSON.stringify(receipt).includes("private/seedream"), false);
    assert.equal(JSON.stringify(receipt).includes("private-seedream-id"), false);
    const referenceSet = await service.issueReferences({ attemptId: ATTEMPT, variant: "seedream-5.0-flash", reference_handles: [receipt.reference_handle] });
    const candidate = prepareOwnerSeedreamImageRequest({ principal: { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT },
      attempt_id: ATTEMPT, variant: "seedream-5.0-flash", parameters: { aspect_ratio: "1:1", resolution: "1K", output_format: "png", background: "transparent" },
      reference_set: referenceSet, prompt: "preserve transparent source" },
    { catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW });
    assert.equal(candidate.transparency_eligibility.source_alpha_eligible, true);
    assert.deepEqual(candidate.transparency_eligibility.sampled_source_dimensions, [{ width: 15, height: 15 }]);
    assert.equal(candidate.request.settings.background, "transparent");
  } finally { await service.close(); }
});

test("uploads source-valid PNG bytes through the fixed native seam for all five exact variants", async () => {
  const source = png15();
  const seen: string[] = [];
  const { service } = createService(async (_input, init) => {
    const form = init?.body as FormData;
    seen.push(String(form.get("model_type")));
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.type, "image/png");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), source);
    return Response.json({ files: [{ url: `https://r2.syntx.ai/private/seedream/${seen.length}.png`, mime_type: "image/png", size: source.byteLength }] });
  });
  const variants = ["seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-flash", "seedream-5.0-pro"] as const;
  try {
    const receipts = [];
    for (const variant of variants) receipts.push(await service.upload({ attemptId: ATTEMPT, variant,
      content_base64: source.toString("base64"), filename: "variant.png", mime_type: "image/png" }));
    assert.deepEqual(seen, variants);
    assert.deepEqual(receipts.map((receipt) => receipt.variant), variants);
    assert.equal(new Set(receipts.map((receipt) => receipt.reference_handle)).size, variants.length);
  } finally { await service.close(); }
});

test("enforces each source-declared per-variant reference-count maximum", async () => {
  let posts = 0;
  const { service } = createService(async () => {
    posts += 1;
    return Response.json({ files: [{ url: `https://r2.syntx.ai/private/seedream/ref-${posts}.png`, mime_type: "image/png", size: png15(255, posts).byteLength }] });
  });
  const limits = [["seedream-4", 4], ["seedream-4.5", 4], ["seedream-5", 14], ["seedream-5.0-flash", 10], ["seedream-5.0-pro", 10]] as const;
  try {
    for (const [variant, limit] of limits) {
      const attemptId = `link_seedream_count_${variant.replaceAll(".", "_")}_0123456789`;
      const receipts = [];
      for (let index = 0; index <= limit; index += 1) {
        const source = png15(255, index + posts + 1);
        receipts.push(await service.upload({ attemptId, variant, content_base64: source.toString("base64"), filename: `ref-${index}.png`, mime_type: "image/png" }));
      }
      const handles = receipts.map((receipt) => receipt.reference_handle);
      const set = await service.issueReferences({ attemptId, variant, reference_handles: handles.slice(0, limit) });
      assert.equal(set.reference_count, limit);
      await assert.rejects(service.issueReferences({ attemptId, variant, reference_handles: handles }),
        (error: unknown) => error instanceof OwnerSeedreamImageUploadServiceError && error.code === "INVALID_REQUEST");
    }
    assert.equal(posts, limits.reduce((sum, [, limit]) => sum + limit + 1, 0));
  } finally { await service.close(); }
});

test("keeps unsupported PNG composition as explicitly unsupported and never grants transparent eligibility", async () => {
  const source = pngWithUnsupportedExif();
  let posts = 0;
  const { service } = createService(async () => {
    posts += 1;
    return Response.json({ files: [{ url: "https://r2.syntx.ai/private/seedream/unsupported.png", mime_type: "image/png", size: source.byteLength }] });
  });
  try {
    const receipt = await service.upload({ attemptId: ATTEMPT, variant: "seedream-5.0-flash",
      content_base64: source.toString("base64"), filename: "unsupported-exif.png", mime_type: "image/png" });
    assert.equal(posts, 1);
    assert.equal(receipt.source_alpha_eligible, false);
    assert.equal(receipt.source_alpha_confidence, "UNSUPPORTED_PNG_ALPHA_COMPOSITION");
    assert.equal(receipt.source_sample_width, null);
    assert.equal(receipt.source_sample_height, null);
    const referenceSet = await service.issueReferences({ attemptId: ATTEMPT, variant: "seedream-5.0-flash", reference_handles: [receipt.reference_handle] });
    assert.throws(() => prepareOwnerSeedreamImageRequest({ principal: { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT },
      attempt_id: ATTEMPT, variant: "seedream-5.0-flash", parameters: { aspect_ratio: "1:1", resolution: "1K", output_format: "png", background: "transparent" },
      reference_set: referenceSet, prompt: "unsupported source must not grant transparency" },
    { catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW }),
    (error: unknown) => error instanceof OwnerSeedreamImagePrepareError && error.code === "PARAMETERS_INVALID");
  } finally { await service.close(); }
});

test("rejects undeclared ownership fields and source MIME/cap failures before native upload", async () => {
  let posts = 0;
  const { service } = createService(async () => {
    posts += 1;
    return Response.json({ files: [{ url: "https://r2.syntx.ai/private/seedream/unused.png", mime_type: "image/png", size: 0 }] });
  });
  const source = png15();
  try {
    await assert.rejects(service.upload({ attemptId: ATTEMPT, variant: "seedream-5.0-flash", content_base64: source.toString("base64"),
      filename: "forged.png", mime_type: "image/png", source_alpha_eligible: true }),
    (error: unknown) => error instanceof OwnerSeedreamImageUploadServiceError && error.code === "INVALID_REQUEST");
    await assert.rejects(service.upload({ attemptId: ATTEMPT, variant: "seedream-5", content_base64: source.toString("base64"), filename: "extra.bmp", mime_type: "image/bmp" }),
      (error: unknown) => error instanceof OwnerSeedreamImageUploadServiceError && error.code === "INVALID_IMAGE_INPUT");
    await assert.rejects(service.upload({ attemptId: ATTEMPT, variant: "seedream-4", content_base64: "A".repeat(14_000_000), filename: "too-large.png", mime_type: "image/png" }),
      (error: unknown) => error instanceof OwnerSeedreamImageUploadServiceError && error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED");
    assert.equal(posts, 0);
  } finally { await service.close(); }
});

test("rejects a corrupt PNG pixel stream before native upload even when the IDAT CRC is valid", async () => {
  const source = pngWithCorruptDeflate();
  let posts = 0;
  const { service } = createService(async () => {
    posts += 1;
    return Response.json({ files: [{ url: "https://r2.syntx.ai/private/seedream/invalid.png", mime_type: "image/png", size: source.byteLength }] });
  });
  try {
    await assert.rejects(service.upload({ attemptId: ATTEMPT, variant: "seedream-5.0-flash",
      content_base64: source.toString("base64"), filename: "corrupt.png", mime_type: "image/png" }),
    (error: unknown) => error instanceof OwnerSeedreamImageUploadServiceError && error.code === "INVALID_IMAGE_INPUT");
    assert.equal(posts, 0);
  } finally { await service.close(); }
});

test("preserves the original JPG alias and routes extra MIME only to Flash and Pro", async () => {
  const seen: Array<{ model: string; mime: string; bytes: Buffer }> = [];
  const { service } = createService(async (_input, init) => {
    const form = init?.body as FormData;
    const file = form.get("files");
    assert.ok(file instanceof File);
    seen.push({ model: String(form.get("model_type")), mime: file.type, bytes: Buffer.from(await file.arrayBuffer()) });
    return Response.json({ files: [{ url: `https://r2.syntx.ai/private/seedream/mixed-${seen.length}`, mime_type: file.type, size: file.size }] });
  });
  try {
    const alias = await service.upload({ attemptId: ATTEMPT, variant: "seedream-4", content_base64: JPEG.toString("base64"), filename: "alias.jpg", mime_type: "image/jpg" });
    assert.equal(alias.original_mime_type, "image/jpg");
    assert.equal(alias.mime_type, "image/jpeg");
    assert.deepEqual(seen[0], { model: "seedream-4", mime: "image/jpeg", bytes: JPEG });
    const source = bmp20();
    for (const variant of ["seedream-5.0-flash", "seedream-5.0-pro"] as const) {
      const receipt = await service.upload({ attemptId: ATTEMPT, variant, content_base64: source.toString("base64"), filename: "extra.bmp", mime_type: "image/bmp" });
      assert.equal(receipt.original_mime_type, "image/bmp");
      assert.equal(receipt.mime_type, "image/bmp");
    }
    assert.deepEqual(seen.slice(1).map(({ model, mime, bytes }) => ({ model, mime, size: bytes.byteLength })), [
      { model: "seedream-5.0-flash", mime: "image/bmp", size: source.byteLength },
      { model: "seedream-5.0-pro", mime: "image/bmp", size: source.byteLength }
    ]);
  } finally { await service.close(); }
});

test("reference sets retain original expiry and invalidation revokes already-prepared candidates", async () => {
  const source = png15();
  let now = NOW;
  const { service } = createService(async () => Response.json({ files: [{ url: "https://r2.syntx.ai/private/seedream/ttl.png", mime_type: "image/png", size: source.byteLength }] }), () => now);
  const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT };
  try {
    const receipt = await service.upload({ attemptId: ATTEMPT, variant: "seedream-5.0-flash",
      content_base64: source.toString("base64"), filename: "ttl.png", mime_type: "image/png" });
    assert.equal(receipt.expires_in_seconds, 900);
    assert.equal(Object.isFrozen(receipt), true);
    const referenceSet = await service.issueReferences({ attemptId: ATTEMPT, variant: "seedream-5.0-flash", reference_handles: [receipt.reference_handle] });
    assert.equal(referenceSet.expires_at, NOW + 15 * 60_000);
    const candidate = prepareOwnerSeedreamImageRequest({ principal, attempt_id: ATTEMPT, variant: "seedream-5.0-flash",
      parameters: { aspect_ratio: "1:1", resolution: "1K", output_format: "png", background: "opaque" }, reference_set: referenceSet, prompt: "expire at original deadline" },
    { catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => now });
    now = NOW + 14 * 60_000;
    const relinkedSet = await service.issueReferences({ attemptId: ATTEMPT, variant: "seedream-5.0-flash", reference_handles: [receipt.reference_handle] });
    assert.equal(relinkedSet.expires_at, NOW + 15 * 60_000);
    await service.invalidateAttempt(ATTEMPT);
    assert.equal(isOwnerSeedreamImagePreparedCandidateForPrincipal(candidate, principal, ATTEMPT, now), false);
    await assert.rejects(service.issueReferences({ attemptId: ATTEMPT, variant: "seedream-5.0-flash", reference_handles: [receipt.reference_handle] }),
      (error: unknown) => error instanceof OwnerSeedreamImageUploadServiceError && error.code === "REFERENCE_UNAVAILABLE");
    now = NOW + 15 * 60_000;
    await assert.rejects(service.issueReferences({ attemptId: ATTEMPT, variant: "seedream-5.0-flash", reference_handles: [receipt.reference_handle] }),
      (error: unknown) => error instanceof OwnerSeedreamImageUploadServiceError && error.code === "REFERENCE_UNAVAILABLE");
  } finally { await service.close(); }
});

test("attempt invalidation during upload prevents a late native ACK from minting a handle", async () => {
  const source = png15();
  let posts = 0;
  let releaseFetch!: () => void;
  const fetchGate = new Promise<void>((resolve) => { releaseFetch = resolve; });
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    posts += 1;
    await fetchGate;
    return Response.json({ files: [{ url: "https://r2.syntx.ai/private/seedream/late-ack.png", mime_type: "image/png", size: source.byteLength }] });
  } });
  const service = new OwnerSeedreamImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  try {
    const pending = service.upload({ attemptId: ATTEMPT, variant: "seedream-5", content_base64: source.toString("base64"), filename: "late.png", mime_type: "image/png" })
      .then((receipt) => ({ receipt }), (error: unknown) => ({ error }));
    await waitUntil(() => posts === 1);
    const invalidation = service.invalidateAttempt(ATTEMPT);
    releaseFetch();
    const outcome = await pending;
    await invalidation;
    assert.ok("error" in outcome);
    assert.ok(outcome.error instanceof OwnerSeedreamImageUploadServiceError);
    assert.equal(outcome.error.code, "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts, 1);
  } finally { releaseFetch(); await service.close(); }
});

test("close aborts and drains an in-flight upload without returning a handle or retrying", async () => {
  const source = png15();
  let posts = 0;
  let abortObserved = false;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (_input, init) => {
    posts += 1;
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal instanceof AbortSignal) signal.addEventListener("abort", () => {
        abortObserved = true;
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    });
  } });
  const service = new OwnerSeedreamImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  try {
    const pending = service.upload({ attemptId: ATTEMPT, variant: "seedream-5.0-pro", content_base64: source.toString("base64"), filename: "pending.png", mime_type: "image/png" })
      .then((receipt) => ({ receipt }), (error: unknown) => ({ error }));
    await waitUntil(() => posts === 1);
    await service.close();
    const outcome = await pending;
    assert.ok("error" in outcome);
    assert.ok(outcome.error instanceof OwnerSeedreamImageUploadServiceError);
    assert.equal(outcome.error.code, "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(abortObserved, true);
    assert.equal(posts, 1);
    await assert.rejects(service.issueReferences({ attemptId: ATTEMPT, variant: "seedream-5.0-pro", reference_handles: [] }),
      (error: unknown) => error instanceof OwnerSeedreamImageUploadServiceError && error.code === "SERVICE_CLOSED");
  } finally { await service.close(); }
});

test("rejects accessor and proxy upload DTOs without executing caller code", async () => {
  const source = png15();
  let posts = 0, getterReads = 0, proxyReads = 0;
  const { service } = createService(async () => {
    posts += 1;
    return Response.json({ files: [{ url: "https://r2.syntx.ai/private/seedream/unused.png", mime_type: "image/png", size: source.byteLength }] });
  });
  const accessor = { attemptId: ATTEMPT, variant: "seedream-5", content_base64: source.toString("base64"), mime_type: "image/png" } as Record<string, unknown>;
  Object.defineProperty(accessor, "filename", { enumerable: true, get() { getterReads += 1; return "accessor.png"; } });
  const proxied = new Proxy({ attemptId: ATTEMPT, variant: "seedream-5", content_base64: source.toString("base64"), filename: "proxy.png", mime_type: "image/png" }, {
    get(target, key, receiver) { proxyReads += 1; return Reflect.get(target, key, receiver); }
  });
  try {
    for (const input of [accessor, proxied]) await assert.rejects(service.upload(input),
      (error: unknown) => error instanceof OwnerSeedreamImageUploadServiceError && error.code === "INVALID_REQUEST");
    assert.equal(getterReads, 0);
    assert.equal(proxyReads, 0);
    assert.equal(posts, 0);
    await assert.rejects(service.issueReferences({ attemptId: ATTEMPT, variant: "seedream-5", reference_handles: new Array(1) }),
      (error: unknown) => error instanceof OwnerSeedreamImageUploadServiceError && error.code === "INVALID_REQUEST");
    await assert.rejects(service.issueReferences({ attemptId: ATTEMPT, variant: "seedream-5", reference_handles: ["seedream_image_00000000-0000-4000-8000-000000000001", "seedream_image_00000000-0000-4000-8000-000000000001"] }),
      (error: unknown) => error instanceof OwnerSeedreamImageUploadServiceError && error.code === "INVALID_REQUEST");
  } finally { await service.close(); }
});

test("revocation after the single upload POST preserves an unknown outcome and mints no reference", async () => {
  const source = png15();
  let posts = 0, linked = true;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    posts += 1;
    linked = false;
    return Response.json({ files: [{ url: "https://r2.syntx.ai/private/seedream/revoked.png", mime_type: "image/png", size: source.byteLength }] });
  } });
  const service = new OwnerSeedreamImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) {
      return linked ? linkedAttempt(attemptId) : { ...linkedAttempt(attemptId), status: "REVOKED" as const, linked: false };
    } }, catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => client, now: () => NOW });
  try {
    await assert.rejects(service.upload({ attemptId: ATTEMPT, variant: "seedream-4.5", content_base64: source.toString("base64"), filename: "revoked.png", mime_type: "image/png" }),
      (error: unknown) => error instanceof OwnerSeedreamImageUploadServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts, 1);
    await assert.rejects(service.issueReferences({ attemptId: ATTEMPT, variant: "seedream-4.5", reference_handles: [] }),
      (error: unknown) => error instanceof OwnerSeedreamImageUploadServiceError && error.code === "PRINCIPAL_NOT_LINKED");
  } finally { await service.close(); }
});
