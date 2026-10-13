import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { loadMaplessSettingsInventoryVersion } from "../src/catalog/mapless-settings-inventory.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { OwnerBananaInpaintOriginalReferenceService } from "../src/application/owner-banana-inpaint-original-reference-service.js";

const MODULE_URL = new URL("../src/application/owner-banana-inpaint-painted-composite-reference-service.js", import.meta.url).href;
const serviceModule = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const C5_PUBLIC_VERSION = "sha256-c5c10b9b0bffdc4b75dab3363de10c2c2856f1130a559eb9e8a21a1493bf067c.json";
const SETTINGS_62_VERSION = "sha256-62bcf08172eb75011055d9ae04c772362b72337646ee2e460944d7fcb2301bcf.json";
const CATALOG_DIRECTORY = join(process.cwd(), "catalog");
const CATALOG = loadSelectedDiscoveryCatalog(C5_PUBLIC_VERSION, CATALOG_DIRECTORY).discoveryCatalog;
const SETTINGS = loadMaplessSettingsInventoryVersion(SETTINGS_62_VERSION, CATALOG_DIRECTORY);
const ATTEMPT = "link_banana_inpaint_painted_service_0123456789";
const BINDING = Object.freeze({ tenant_id: "banana-painted-tenant", subject: "banana-painted-subject" });
const VARIANTS = ["banana", "banana2", "banana3", "banana3_light"] as const;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return operation("synthetic-banana-painted-composite-credential");
  } };
}

function linkedAttempt(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: null, linked: true };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngWithWidth(width: number): Buffer {
  const result = Buffer.from(PNG);
  result.writeUInt32BE(width, 16);
  result.writeUInt32BE(crc32(result.subarray(12, 29)), 29);
  return result;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0); chunk.write(type, 4, 4, "ascii"); data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

function pngWithUniqueText(index: number): Buffer {
  const iendOffset = PNG.length - 12;
  const text = Buffer.from(`paint\0${index}`, "latin1");
  return Buffer.concat([PNG.subarray(0, iendOffset), pngChunk("tEXt", text), PNG.subarray(iendOffset)]);
}

function createPairService(fetchImpl: typeof fetch, now: () => number, getStatus: (attemptId: string) => Promise<unknown> =
  async (attemptId) => linkedAttempt(attemptId)) {
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return getStatus(attemptId); } };
  const original = new OwnerBananaInpaintOriginalReferenceService({ binding: BINDING, linkService, catalog: CATALOG,
    public_catalog_version: C5_PUBLIC_VERSION, settings_inventory: SETTINGS, settings_inventory_version: SETTINGS_62_VERSION,
    resolveClient: () => client, now });
  const Service = serviceModule?.OwnerBananaInpaintPaintedCompositeReferenceService as (new (options: unknown) => {
    uploadPaintedComposite(input: unknown): Promise<Record<string, unknown>>;
    resolvePaintedComposite(input: unknown): Promise<Record<string, unknown>>;
    invalidateAttempt(attemptId: string): Promise<void>;
    close(): Promise<void>;
  }) | undefined;
  assert.equal(typeof Service, "function", "MISSING_BANANA_INPAINT_PAINTED_COMPOSITE_REFERENCE_SERVICE");
  const service = new Service!({ originalReferenceService: original, binding: BINDING, linkService, catalog: CATALOG,
    public_catalog_version: C5_PUBLIC_VERSION, settings_inventory: SETTINGS, settings_inventory_version: SETTINGS_62_VERSION,
    resolveClient: () => client, now });
  return { client, original, service };
}

function originalInput(variant: string, attemptId = ATTEMPT) {
  return { attemptId, variant, content_base64: PNG.toString("base64"), filename: "original.png", mime_type: "image/png" };
}

test("Banana painted-composite reference service exposes its lifecycle API", () => {
  assert.ok(serviceModule, "MISSING_BANANA_INPAINT_PAINTED_COMPOSITE_REFERENCE_SERVICE_MODULE");
  assert.equal(typeof serviceModule.OwnerBananaInpaintPaintedCompositeReferenceService, "function",
    "MISSING_BANANA_INPAINT_PAINTED_COMPOSITE_REFERENCE_SERVICE");
});

test("pairs all four exact variants through actual native upload and resolves only private role metadata", async () => {
  const uploads: Array<{ model_type: string; bytes_match: boolean; filename: string }> = [];
  let nextId = 0;
  const { original, service } = createPairService(async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.href, "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    const form = init?.body as FormData;
    assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(form.get("destination"), "hidden");
    assert.equal(form.get("check_duplicates"), "true");
    const file = form.get("files");
    assert.ok(file instanceof File);
    const bytes = Buffer.from(await file.arrayBuffer());
    uploads.push({ model_type: String(form.get("model_type")), bytes_match: bytes.equals(PNG), filename: file.name });
    bytes.fill(0);
    nextId += 1;
    return jsonResponse({ files: [{ id: nextId, file_id: String(nextId), url: `https://r2.syntx.ai/inpaint/painted-${nextId}.png`,
      mime_type: "image/png", size: PNG.byteLength, status: "accepted" }] });
  }, () => Date.parse("2026-10-11T00:00:00.000Z"));
  try {
    const receipts: Array<Record<string, unknown>> = [];
    for (const variant of VARIANTS) {
      const originalReceipt = await original.upload(originalInput(variant));
      const receipt = await service.uploadPaintedComposite({ attemptId: ATTEMPT, variant,
        original_handle: originalReceipt.reference_handle, content_base64: PNG.toString("base64"),
        filename: "inpaint-mask.png", mime_type: "image/png" });
      receipts.push(receipt);
      const privateResolution = await service.resolvePaintedComposite({ attempt_id: ATTEMPT, variant,
        original_handle: originalReceipt.reference_handle, painted_handle: receipt.painted_handle });
      assert.equal(privateResolution.role, "painted_composite");
      assert.equal(privateResolution.wire_type, "mask");
      assert.equal(privateResolution.file_url, `https://r2.syntx.ai/inpaint/painted-${(receipts.length - 1) * 2 + 2}.png`);
      assert.equal(privateResolution.generation_permit, false);
      assert.equal(privateResolution.width, 1);
      assert.equal(privateResolution.height, 1);
      assert.equal(privateResolution.original_sha256, `sha256:${createHash("sha256").update(PNG).digest("hex")}`);
      assert.equal(privateResolution.painted_sha256, `sha256:${createHash("sha256").update(PNG).digest("hex")}`);
    }
    assert.deepEqual(uploads.filter((_, index) => index % 2 === 1).map((upload) => upload.model_type), VARIANTS);
    assert.ok(uploads.every((upload) => upload.bytes_match));
    assert.equal(uploads.length, 8);
    assert.ok(receipts.every((receipt, index) => receipt.status === "uploaded" && receipt.variant === VARIANTS[index] &&
      typeof receipt.painted_handle === "string" && typeof receipt.sha256 === "string" && receipt.expires_in_seconds === 900));
    for (const privateValue of ["https://r2.syntx.ai", "file_id", BINDING.subject, "generation_permit"]) {
      assert.equal(JSON.stringify(receipts).includes(privateValue), false);
    }
  } finally { await service.close(); }
});

test("unknown painted upload is held across attempts by original and composite content, without replay", async () => {
  const attemptA = ATTEMPT;
  const attemptB = "link_banana_inpaint_painted_second_0123456789";
  let posts = 0;
  const { original, service } = createPairService(async () => {
    posts += 1;
    if (posts === 2) throw new Error("synthetic connection reset after upload began");
    return jsonResponse({ files: [{ id: posts, file_id: String(posts), url: `https://r2.syntx.ai/inpaint/unknown-${posts}.png`,
      mime_type: "image/png", size: PNG.byteLength, status: "accepted" }] });
  }, () => Date.parse("2026-10-11T00:00:00.000Z"));
  try {
    const originalA = await original.upload(originalInput("banana", attemptA));
    await assert.rejects(() => service.uploadPaintedComposite({ attemptId: attemptA, variant: "banana",
      original_handle: originalA.reference_handle, content_base64: PNG.toString("base64"), filename: "inpaint-mask.png", mime_type: "image/png" }),
    (error: unknown) => hasCode(error, "UPLOAD_OUTCOME_UNKNOWN"));
    const originalB = await original.upload(originalInput("banana", attemptB));
    await assert.rejects(() => service.uploadPaintedComposite({ attemptId: attemptB, variant: "banana",
      original_handle: originalB.reference_handle, content_base64: PNG.toString("base64"), filename: "inpaint-mask.png", mime_type: "image/png" }),
    (error: unknown) => hasCode(error, "UPLOAD_OUTCOME_UNKNOWN"));
    assert.equal(posts, 3, "second attempt must be rejected before another native POST");
  } finally { await service.close(); }
});

test("painted pair inherits original expiry exactly and rejects caller-supplied resolution fields", async () => {
  let now = Date.parse("2026-10-11T00:00:00.000Z");
  let posts = 0;
  const { original, service } = createPairService(async () => {
    posts += 1;
    return jsonResponse({ files: [{ id: posts, file_id: String(posts), url: `https://r2.syntx.ai/inpaint/expiry-${posts}.png`,
      mime_type: "image/png", size: PNG.byteLength, status: "accepted" }] });
  }, () => now);
  try {
    const originalReceipt = await original.upload(originalInput("banana"));
    now += 14 * 60_000;
    const pair = await service.uploadPaintedComposite({ attemptId: ATTEMPT, variant: "banana",
      original_handle: originalReceipt.reference_handle, content_base64: PNG.toString("base64"), filename: "inpaint-mask.png", mime_type: "image/png" });
    assert.equal(pair.expires_in_seconds, 60);
    await assert.rejects(() => service.resolvePaintedComposite({ attempt_id: ATTEMPT, variant: "banana",
      original_handle: originalReceipt.reference_handle, painted_handle: pair.painted_handle, file_url: "https://evil.invalid/x" }),
    (error: unknown) => hasCode(error, "INVALID_REQUEST"));
    now += 60_001;
    await assert.rejects(() => service.resolvePaintedComposite({ attempt_id: ATTEMPT, variant: "banana",
      original_handle: originalReceipt.reference_handle, painted_handle: pair.painted_handle }),
    (error: unknown) => hasCode(error, "PAINTED_REFERENCE_EXPIRED") || hasCode(error, "PAINTED_REFERENCE_UNAVAILABLE"));
    assert.equal(posts, 2);
  } finally { await service.close(); }
});

test("a foreign attempt cannot pair or invalidate another attempt's original handle", async () => {
  const attemptB = "link_banana_inpaint_painted_foreign_0123456789";
  let posts = 0;
  const { original, service } = createPairService(async () => {
    posts += 1;
    return jsonResponse({ files: [{ id: posts, file_id: String(posts), url: `https://r2.syntx.ai/inpaint/foreign-${posts}.png`,
      mime_type: "image/png", size: PNG.byteLength, status: "accepted" }] });
  }, () => Date.parse("2026-10-11T00:00:00.000Z"));
  try {
    const owned = await original.upload(originalInput("banana", ATTEMPT));
    await assert.rejects(() => service.uploadPaintedComposite({ attemptId: attemptB, variant: "banana",
      original_handle: owned.reference_handle, content_base64: PNG.toString("base64"), filename: "inpaint-mask.png", mime_type: "image/png" }),
    (error: unknown) => hasCode(error, "ORIGINAL_REFERENCE_UNAVAILABLE") || hasCode(error, "INVALID_REQUEST"));
    const profile = (await import("../src/application/owner-banana-inpaint-original-upload-source-profile.js"))
      .getOwnerBananaInpaintOriginalUploadSourceProfile("banana", CATALOG, C5_PUBLIC_VERSION, SETTINGS, SETTINGS_62_VERSION);
    const stillOwned = await original.resolveOriginal({ principal: { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject,
      connection_id: ATTEMPT }, attempt_id: ATTEMPT, variant: "banana", form_id: "banana-inpaint", source_role: "inpaint_original",
      public_catalog_version: C5_PUBLIC_VERSION, settings_inventory_version: SETTINGS_62_VERSION,
      profile_schema_hash: profile.profile_schema_hash, reference_handle: owned.reference_handle });
    assert.equal(stillOwned.reference_handle, owned.reference_handle);
    assert.equal(posts, 1, "foreign pairing must be rejected before the painted native upload");
  } finally { await service.close(); }
});

test("pre-aborted painted upload makes no native request", async () => {
  let posts = 0;
  const { original, service } = createPairService(async () => {
    posts += 1;
    return jsonResponse({ files: [{ id: posts, file_id: String(posts), url: `https://r2.syntx.ai/inpaint/abort-${posts}.png`,
      mime_type: "image/png", size: PNG.byteLength, status: "accepted" }] });
  }, () => Date.parse("2026-10-11T00:00:00.000Z"));
  try {
    const originalReceipt = await original.upload(originalInput("banana"));
    const controller = new AbortController(); controller.abort();
    await assert.rejects(() => service.uploadPaintedComposite({ attemptId: ATTEMPT, variant: "banana",
      original_handle: originalReceipt.reference_handle, content_base64: PNG.toString("base64"), filename: "inpaint-mask.png",
      mime_type: "image/png", signal: controller.signal }), (error: unknown) => hasCode(error, "REQUEST_ABORTED"));
    assert.equal(posts, 1);
  } finally { await service.close(); }
});

test("painted PNG container dimensions must match original container metadata", async () => {
  let posts = 0;
  const { original, service } = createPairService(async () => {
    posts += 1;
    return jsonResponse({ files: [{ id: posts, file_id: String(posts), url: `https://r2.syntx.ai/inpaint/geometry-${posts}.png`,
      mime_type: "image/png", size: PNG.byteLength, status: "accepted" }] });
  }, () => Date.parse("2026-10-11T00:00:00.000Z"));
  try {
    const originalReceipt = await original.upload(originalInput("banana"));
    await assert.rejects(() => service.uploadPaintedComposite({ attemptId: ATTEMPT, variant: "banana",
      original_handle: originalReceipt.reference_handle, content_base64: pngWithWidth(2).toString("base64"),
      filename: "inpaint-mask.png", mime_type: "image/png" }),
    (error: unknown) => hasCode(error, "INVALID_IMAGE_INPUT") || hasCode(error, "GEOMETRY_MISMATCH"));
    assert.equal(posts, 1);
  } finally { await service.close(); }
});

test("attempt invalidation removes paired and original handles after the pair barrier", async () => {
  let posts = 0;
  const { original, service } = createPairService(async () => {
    posts += 1;
    return jsonResponse({ files: [{ id: posts, file_id: String(posts), url: `https://r2.syntx.ai/inpaint/invalidate-${posts}.png`,
      mime_type: "image/png", size: PNG.byteLength, status: "accepted" }] });
  }, () => Date.parse("2026-10-11T00:00:00.000Z"));
  try {
    const originalReceipt = await original.upload(originalInput("banana"));
    const pair = await service.uploadPaintedComposite({ attemptId: ATTEMPT, variant: "banana",
      original_handle: originalReceipt.reference_handle, content_base64: PNG.toString("base64"), filename: "inpaint-mask.png", mime_type: "image/png" });
    await service.invalidateAttempt(ATTEMPT);
    await assert.rejects(() => service.resolvePaintedComposite({ attempt_id: ATTEMPT, variant: "banana",
      original_handle: originalReceipt.reference_handle, painted_handle: pair.painted_handle }),
    (error: unknown) => hasCode(error, "ORIGINAL_REFERENCE_UNAVAILABLE") || hasCode(error, "ORIGINAL_REFERENCE_EXPIRED") ||
      hasCode(error, "PAINTED_REFERENCE_UNAVAILABLE"));
    assert.equal(posts, 2);
  } finally { await service.close(); }
});

test("monotonic clock rollback closes the paired resolver", async () => {
  let now = Date.parse("2026-10-11T00:00:00.000Z");
  let posts = 0;
  const { original, service } = createPairService(async () => {
    posts += 1;
    return jsonResponse({ files: [{ id: posts, file_id: String(posts), url: `https://r2.syntx.ai/inpaint/clock-${posts}.png`,
      mime_type: "image/png", size: PNG.byteLength, status: "accepted" }] });
  }, () => now);
  try {
    const originalReceipt = await original.upload(originalInput("banana"));
    const pair = await service.uploadPaintedComposite({ attemptId: ATTEMPT, variant: "banana",
      original_handle: originalReceipt.reference_handle, content_base64: PNG.toString("base64"), filename: "inpaint-mask.png", mime_type: "image/png" });
    now += 1_000;
    await service.resolvePaintedComposite({ attempt_id: ATTEMPT, variant: "banana",
      original_handle: originalReceipt.reference_handle, painted_handle: pair.painted_handle });
    now -= 1_001;
    await assert.rejects(() => service.resolvePaintedComposite({ attempt_id: ATTEMPT, variant: "banana",
      original_handle: originalReceipt.reference_handle, painted_handle: pair.painted_handle }),
    (error: unknown) => hasCode(error, "SERVICE_CLOSED"));
    assert.equal(posts, 2);
  } finally { await service.close(); }
});

test("unknown semantic holds are non-evicting and bounded at 128", async () => {
  let posts = 0;
  const { original, service } = createPairService(async (_input, init) => {
    posts += 1;
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    if (file.name === "inpaint-mask.png") throw new Error("synthetic ambiguous upload");
    return jsonResponse({ files: [{ id: posts, file_id: String(posts), url: `https://r2.syntx.ai/inpaint/hold-${posts}.png`,
      mime_type: "image/png", size: PNG.byteLength, status: "accepted" }] });
  }, () => Date.parse("2026-10-11T00:00:00.000Z"));
  try {
    const originalReceipt = await original.upload(originalInput("banana"));
    for (let index = 0; index < 128; index += 1) {
      await assert.rejects(() => service.uploadPaintedComposite({ attemptId: ATTEMPT, variant: "banana",
        original_handle: originalReceipt.reference_handle, content_base64: pngWithUniqueText(index).toString("base64"),
        filename: "inpaint-mask.png", mime_type: "image/png" }),
      (error: unknown) => hasCode(error, "UPLOAD_OUTCOME_UNKNOWN"));
    }
    await assert.rejects(() => service.uploadPaintedComposite({ attemptId: ATTEMPT, variant: "banana",
      original_handle: originalReceipt.reference_handle, content_base64: pngWithUniqueText(128).toString("base64"),
      filename: "inpaint-mask.png", mime_type: "image/png" }), (error: unknown) => hasCode(error, "CAPACITY_EXCEEDED"));
    assert.equal(posts, 129, "the 129th ambiguous semantic key is rejected before native upload");
  } finally { await service.close(); }
});

test("successful paired records are bounded at 128 and never evict live handles", async () => {
  let posts = 0;
  const { original, service } = createPairService(async (_input, init) => {
    posts += 1;
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    return jsonResponse({ files: [{ id: posts, file_id: String(posts), url: `https://r2.syntx.ai/inpaint/capacity-${posts}.png`,
      mime_type: "image/png", size: file.size, status: "accepted" }] });
  }, () => Date.parse("2026-10-11T00:00:00.000Z"));
  try {
    const originalReceipt = await original.upload(originalInput("banana"));
    const first: Record<string, unknown> = {};
    for (let index = 0; index < 128; index += 1) {
      const receipt = await service.uploadPaintedComposite({ attemptId: ATTEMPT, variant: "banana",
        original_handle: originalReceipt.reference_handle, content_base64: pngWithUniqueText(index).toString("base64"),
        filename: "inpaint-mask.png", mime_type: "image/png" });
      if (index === 0) Object.assign(first, receipt);
    }
    await assert.rejects(() => service.uploadPaintedComposite({ attemptId: ATTEMPT, variant: "banana",
      original_handle: originalReceipt.reference_handle, content_base64: pngWithUniqueText(128).toString("base64"),
      filename: "inpaint-mask.png", mime_type: "image/png" }), (error: unknown) => hasCode(error, "CAPACITY_EXCEEDED"));
    const firstResolution = await service.resolvePaintedComposite({ attempt_id: ATTEMPT, variant: "banana",
      original_handle: originalReceipt.reference_handle, painted_handle: first.painted_handle });
    assert.equal(firstResolution.painted_handle, first.painted_handle);
    assert.equal(posts, 129, "the next pair must fail before POST while the first 128 handles stay live");
  } finally { await service.close(); }
});

test("four pending native uploads are bounded, then invalidation aborts and drains them", async () => {
  let posts = 0;
  let entered = 0;
  let signalFourth: (() => void) | undefined;
  const fourthEntered = new Promise<void>((resolve) => { signalFourth = resolve; });
  const { original, service } = createPairService(async (_input, init) => {
    posts += 1;
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    if (file.name === "original.png") return jsonResponse({ files: [{ id: posts, file_id: String(posts),
      url: `https://r2.syntx.ai/inpaint/pending-${posts}.png`, mime_type: "image/png", size: file.size, status: "accepted" }] });
    entered += 1;
    if (entered === 4) signalFourth?.();
    return await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) { reject(new Error("native upload signal missing")); return; }
      if (signal.aborted) { reject(new DOMException("aborted", "AbortError")); return; }
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  }, () => Date.parse("2026-10-11T00:00:00.000Z"));
  try {
    const originalReceipt = await original.upload(originalInput("banana"));
    const pending = [0, 1, 2, 3].map((index) => service.uploadPaintedComposite({ attemptId: ATTEMPT, variant: "banana",
      original_handle: originalReceipt.reference_handle, content_base64: pngWithUniqueText(index).toString("base64"),
      filename: "inpaint-mask.png", mime_type: "image/png" }));
    await Promise.race([fourthEntered, new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("fourth upload did not start")), 2_000))]);
    await assert.rejects(() => service.uploadPaintedComposite({ attemptId: ATTEMPT, variant: "banana",
      original_handle: originalReceipt.reference_handle, content_base64: pngWithUniqueText(4).toString("base64"),
      filename: "inpaint-mask.png", mime_type: "image/png" }), (error: unknown) => hasCode(error, "SERVICE_BUSY"));
    await service.invalidateAttempt(ATTEMPT);
    const outcomes = await Promise.allSettled(pending);
    assert.ok(outcomes.every((outcome) => outcome.status === "rejected"));
    assert.equal(entered, 4);
    assert.equal(posts, 5);
  } finally { await service.close(); }
});
