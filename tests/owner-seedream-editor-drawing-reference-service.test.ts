import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { loadMaplessSettingsInventoryVersion } from "../src/catalog/mapless-settings-inventory.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { getOwnerSeedreamEditorOriginalUploadSourceProfile } from "../src/application/owner-seedream-editor-original-upload-source-profile.js";
import { OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION as C5, OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION as SETTINGS_62 } from "../src/application/owner-seedream-editor-original-upload-source-profile.js";

const moduleUrl = new URL("../src/application/owner-seedream-editor-drawing-reference-service.js", import.meta.url).href;
const loaded = await import(moduleUrl).catch(() => null) as Record<string, unknown> | null;
const CATALOG = loadSelectedDiscoveryCatalog(C5, join(process.cwd(), "catalog")).discoveryCatalog;
const SETTINGS = loadMaplessSettingsInventoryVersion(SETTINGS_62, join(process.cwd(), "catalog"));
const ATTEMPT = "link_seedream_editor_drawing_service_0123456789";
const RELINKED = "link_seedream_editor_drawing_relinked_0123456789";
const BINDING = Object.freeze({ tenant_id: "seedream-drawing-tenant", subject: "seedream-drawing-subject" });
const VARIANTS = ["seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-flash", "seedream-5.0-pro"] as const;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const JPEG = Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x0b,0x08,0x00,0x01,0x00,0x01,0x01,0x01,0x11,0x00,0xff,0xda,0x00,0x08,0x01,0x01,0x00,0x00,0x3f,0x00,0x00,0xff,0xd9]);
const originalServiceUrl = new URL("../src/application/owner-seedream-editor-original-reference-service.js", import.meta.url).href;
const originalModule = await import(originalServiceUrl) as Record<string, unknown>;

function broker(): SyntxCredentialBroker { return { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-drawing-credential"); } }; }
function linked(attempt_id: string) { return { attempt_id, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const, status: "LINKED" as const, expires_at: null, linked: true }; }
function response(payload: unknown): Response { return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }); }
function crc32(bytes: Uint8Array): number { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function pngWithIntent(index: number): Buffer {
  const data = Buffer.from(`intent\0${index}`, "latin1"), chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0); chunk.write("tEXt", 4, 4, "ascii"); data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return Buffer.concat([PNG.subarray(0, PNG.length - 12), chunk, PNG.subarray(PNG.length - 12)]);
}
function code(error: unknown, expected: string): boolean { return error instanceof Error && "code" in error && error.code === expected; }
function principal(attemptId = ATTEMPT) { return { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: attemptId }; }
function originalContext(handle: unknown, variant: typeof VARIANTS[number], attemptId = ATTEMPT) {
  const profile = getOwnerSeedreamEditorOriginalUploadSourceProfile(variant, CATALOG, C5, SETTINGS, SETTINGS_62);
  return { principal: principal(attemptId), attempt_id: attemptId, variant, form_id: "seedream-editor", source_role: "editor_original",
    public_catalog_version: C5, settings_inventory_version: SETTINGS_62, profile_schema_hash: profile.profile_schema_hash, reference_handle: handle };
}
function createFixture(fetchImpl: typeof fetch, now: () => number, getStatus: (attempt: string) => Promise<unknown> = async (attempt) => linked(attempt)) {
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl });
  const Original = originalModule.OwnerSeedreamEditorOriginalReferenceService as new (options: unknown) => { upload(input: unknown): Promise<Record<string, unknown>>; resolveOriginal(input: unknown): Promise<Record<string, unknown>>; isOwnedOriginalResolution(value: unknown, context: unknown): boolean; invalidateAttempt(attempt: string): Promise<void>; close(): Promise<void> };
  const originalReferenceService = new Original({ binding: BINDING, linkService: { async getStatus(_binding: unknown, attempt: string) { return getStatus(attempt); } },
    catalog: CATALOG, public_catalog_version: C5, settings_inventory: SETTINGS, settings_inventory_version: SETTINGS_62, resolveClient: () => client, now });
  const Service = loaded?.OwnerSeedreamEditorDrawingReferenceService as (new (options: unknown) => {
    uploadDrawing(input: unknown): Promise<Record<string, unknown>>; resolveDrawing(input: unknown): Promise<Record<string, unknown>>;
    isOwnedDrawingResolution(value: unknown, context: unknown): boolean; invalidateAttempt(attempt: string): Promise<void>; close(): Promise<void>;
  }) | undefined;
  assert.equal(typeof Service, "function", "MISSING_SEEDREAM_EDITOR_DRAWING_REFERENCE_SERVICE");
  const service = new Service!({ originalReferenceService, binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attempt: string) { return getStatus(attempt); } }, catalog: CATALOG,
    public_catalog_version: C5, settings_inventory: SETTINGS, settings_inventory_version: SETTINGS_62, resolveClient: () => client, now });
  return { client, originalReferenceService, service };
}
async function uploadOriginal(fixture: ReturnType<typeof createFixture>, variant: typeof VARIANTS[number] = "seedream-5", attemptId = ATTEMPT,
  bytes: Uint8Array = PNG, mime_type: "image/png" | "image/jpeg" = "image/png") {
  return fixture.originalReferenceService.upload({ attemptId, variant, content_base64: Buffer.from(bytes).toString("base64"), filename: mime_type === "image/jpeg" ? "original.jpg" : "original.png", mime_type });
}
function drawingInput(variant: string, original_handle: unknown, attemptId = ATTEMPT, bytes: Uint8Array = PNG) {
  return { attemptId, variant, original_handle, content_base64: Buffer.from(bytes).toString("base64"), filename: "drawing.png", mime_type: "image/png" };
}
function drawingContext(original: Record<string, unknown>, drawing: Record<string, unknown>, variant: typeof VARIANTS[number], attemptId = ATTEMPT) {
  return { principal: principal(attemptId), attempt_id: attemptId, variant, original_handle: original.reference_handle, drawing_handle: drawing.drawing_handle };
}

test("Seedream Editor drawing service module and dedicated class exist", () => {
  assert.ok(loaded, "MISSING_SEEDREAM_EDITOR_DRAWING_REFERENCE_SERVICE_MODULE");
  assert.equal(typeof loaded!.OwnerSeedreamEditorDrawingReferenceService, "function", "MISSING_SEEDREAM_EDITOR_DRAWING_REFERENCE_SERVICE");
});

test("uploads paired PNG through the captured native method for all five variants and keeps public receipts opaque", async () => {
  let post = 0, now = 10_000;
  const fixture = createFixture(async (input, init) => {
    assert.equal(new URL(String(input)).href, "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    const form = init?.body as FormData;
    assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.ok(form.get("destination") === "hidden" || form.get("destination") === "uploaded"); assert.equal(form.get("check_duplicates"), "true");
    const file = form.get("files"); assert.ok(file instanceof File); assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
    post += 1; const destination = form.get("destination");
    return response({ files: [{ url: `https://r2.syntx.ai/editor/drawing-${post}.png`, file_id: `drawing-${post}`,
      ...(destination === "uploaded" ? { mime_type: "image/png", size: PNG.length, status: "accepted" } : {}) }] });
  }, () => now);
  try {
    for (const variant of VARIANTS) {
      const original = await uploadOriginal(fixture, variant);
      const receipt = await fixture.service.uploadDrawing(drawingInput(variant, original.reference_handle));
      assert.equal(receipt.status, "uploaded"); assert.equal(receipt.variant, variant);
      assert.equal(receipt.original_handle, original.reference_handle); assert.equal(receipt.width, 1); assert.equal(receipt.height, 1);
      assert.equal(receipt.sha256, `sha256:${createHash("sha256").update(PNG).digest("hex")}`);
      assert.equal(receipt.expires_in_seconds, 900);
      assert.equal(JSON.stringify(receipt).includes("https://r2.syntx.ai"), false);
      const context = drawingContext(original, receipt, variant), resolution = await fixture.service.resolveDrawing(context);
      assert.equal(fixture.service.isOwnedDrawingResolution(resolution, context), true);
      assert.equal(resolution.role, "editor_drawing"); assert.equal(resolution.wire_role, "image"); assert.equal(resolution.extra_role, "image");
      assert.equal(resolution.original_sha256, original.sha256); assert.equal(resolution.drawing_sha256, receipt.sha256);
      assert.equal(resolution.original_width, 1); assert.equal(resolution.drawing_width, 1);
      assert.equal(resolution.original_expires_at, now + 900_000); assert.equal(resolution.generation_permit, false);
      assert.equal(resolution.original_epoch, resolution.drawing_epoch);
      assert.equal(JSON.stringify(resolution).includes("https://r2.syntx.ai"), true, "only private internal resolution carries URLs");
      assert.equal(fixture.service.isOwnedDrawingResolution({ ...resolution }, context), false);
      now += 1;
    }
    assert.equal(post, VARIANTS.length * 2, "one original POST and one drawing POST per model");
  } finally { await fixture.service.close(); await fixture.originalReferenceService.close(); }
});

test("rejects mismatched container geometry before the drawing POST and permits PNG drawing over non-PNG originals", async () => {
  let posts = 0;
  const fixture = createFixture(async (_input, init) => { posts += 1; const form = init?.body as FormData, destination = form.get("destination"), file = form.get("files") as File;
    return response({ files: [{ url: `https://r2.syntx.ai/drawing-${posts}.png`, ...(destination === "uploaded" ? { mime_type: file.type, size: file.size, status: "accepted" } : {}) }] }); }, () => 20_000);
  try {
    const original = await uploadOriginal(fixture, "seedream-5", ATTEMPT, JPEG, "image/jpeg");
    const before = posts;
    await assert.rejects(() => fixture.service.uploadDrawing({ ...drawingInput("seedream-5", original.reference_handle), original_width: 2, original_height: 1 }),
      (error: unknown) => code(error, "INVALID_IMAGE_INPUT"));
    assert.equal(posts, before, "geometry mismatch must be rejected before POST");
    const receipt = await fixture.service.uploadDrawing(drawingInput("seedream-5", original.reference_handle));
    assert.equal(receipt.original_mime_type, "image/jpeg"); assert.equal(receipt.drawing_mime_type, "image/png");
  } finally { await fixture.service.close(); await fixture.originalReferenceService.close(); }
});

test("drawing TTL is inherited from original and delayed ACK cannot mint an expired pair", async () => {
  let now = 30_000, posts = 0;
  const fixture = createFixture(async (_input, init) => { posts += 1; const destination = (init?.body as FormData).get("destination");
    if (destination === "hidden") now += 899_500;
    return response({ files: destination === "uploaded" ? [{ url: "https://r2.syntx.ai/original.png", mime_type: "image/png", size: PNG.length, status: "accepted" }] : [{ url: "https://r2.syntx.ai/late.png" }] }); }, () => now);
  try {
    const original = await uploadOriginal(fixture);
    await assert.rejects(() => fixture.service.uploadDrawing(drawingInput("seedream-5", original.reference_handle)),
      (error: unknown) => code(error, "UPLOAD_OUTCOME_UNKNOWN"));
    assert.equal(posts, 2);
  } finally { await fixture.service.close(); await fixture.originalReferenceService.close(); }
});

test("semantic unknown survives attempt nonce change; foreign invalidation preserves owner pair", async () => {
  let posts = 0;
  const fixture = createFixture(async (_input, init) => { posts += 1; return response({ files: (init?.body as FormData).get("destination") === "uploaded"
    ? [{ url: "https://r2.syntx.ai/original.png", mime_type: "image/png", size: PNG.length, status: "accepted" }] : [] }); }, () => 40_000);
  try {
    const original = await uploadOriginal(fixture);
    await assert.rejects(() => fixture.service.uploadDrawing(drawingInput("seedream-5", original.reference_handle)), (error: unknown) => code(error, "UPLOAD_OUTCOME_UNKNOWN"));
    await fixture.service.invalidateAttempt(RELINKED);
    const relinkedOriginal = await uploadOriginal(fixture, "seedream-5", RELINKED);
    await assert.rejects(() => fixture.service.uploadDrawing(drawingInput("seedream-5", relinkedOriginal.reference_handle, RELINKED)),
      (error: unknown) => code(error, "UPLOAD_OUTCOME_UNKNOWN"));
    assert.equal(posts, 3, "one original per link nonce and one ambiguous drawing; relink does not replay POST");
    await fixture.service.invalidateAttempt(RELINKED);
  } finally { await fixture.service.close(); await fixture.originalReferenceService.close(); }
});

test("nominal guard binds actual original lifetime and invalidation without transferring a pair", async () => {
  const fixture = createFixture(async (_input, init) => { const destination = (init?.body as FormData).get("destination");
    return response({ files: [{ url: `https://r2.syntx.ai/${destination}.png`, ...(destination === "uploaded" ? { mime_type: "image/png", size: PNG.length, status: "accepted" } : {}) }] }); }, () => 50_000);
  try {
    const original = await uploadOriginal(fixture), drawing = await fixture.service.uploadDrawing(drawingInput("seedream-5", original.reference_handle));
    const context = drawingContext(original, drawing, "seedream-5"), resolution = await fixture.service.resolveDrawing(context);
    assert.equal(fixture.service.isOwnedDrawingResolution(resolution, context), true);
    assert.equal(fixture.service.isOwnedDrawingResolution({ ...resolution }, context), false, "spread clone has no private brand");
    await fixture.service.invalidateAttempt(RELINKED);
    assert.equal(fixture.service.isOwnedDrawingResolution(resolution, context), true, "foreign lifecycle event cannot revoke owner pair");
    await fixture.originalReferenceService.invalidateAttempt(ATTEMPT);
    assert.equal(fixture.service.isOwnedDrawingResolution(resolution, context), false, "genuine original invalidation retires the paired nominal witness");
    await assert.rejects(() => fixture.service.resolveDrawing(context), (error: unknown) => code(error, "REFERENCE_UNAVAILABLE"));
  } finally { await fixture.service.close(); await fixture.originalReferenceService.close(); }
});

test("drawing invalidate and close retire only borrowed pairs, leaving originals resolvable", async () => {
  const fixture = createFixture(async (_input, init) => { const form = init?.body as FormData, destination = form.get("destination"), file = form.get("files") as File;
    return response({ files: [{ url: `https://r2.syntx.ai/${destination}.png`, ...(destination === "uploaded" ? { mime_type: file.type, size: file.size, status: "accepted" } : {}) }] }); }, () => 55_000);
  try {
    const original = await uploadOriginal(fixture), sourceContext = originalContext(original.reference_handle, "seedream-5");
    const drawing = await fixture.service.uploadDrawing(drawingInput("seedream-5", original.reference_handle));
    await fixture.service.invalidateAttempt(ATTEMPT);
    await assert.rejects(() => fixture.service.resolveDrawing(drawingContext(original, drawing, "seedream-5")),
      (error: unknown) => code(error, "REFERENCE_UNAVAILABLE"));
    const firstOriginal = await fixture.originalReferenceService.resolveOriginal(sourceContext);
    assert.equal(fixture.originalReferenceService.isOwnedOriginalResolution(firstOriginal, sourceContext), true,
      "drawing invalidation must not revoke its borrowed original");
    const secondDrawing = await fixture.service.uploadDrawing(drawingInput("seedream-5", original.reference_handle));
    await fixture.service.close();
    const afterClose = await fixture.originalReferenceService.resolveOriginal(sourceContext);
    assert.equal(fixture.originalReferenceService.isOwnedOriginalResolution(afterClose, sourceContext), true,
      "drawing close must leave the independently owned original available");
    await assert.rejects(() => fixture.service.resolveDrawing(drawingContext(original, secondDrawing, "seedream-5")),
      (error: unknown) => code(error, "SERVICE_CLOSED"));
  } finally { await fixture.service.close(); await fixture.originalReferenceService.close(); }
});

test("actual PerUserLinkService class works and strict upload rejects accessors, proxies, and malformed pairs", async () => {
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-drawing-challenge", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receiveCredential) { await receiveCredential({ scheme: "Bearer", value: "synthetic-drawing-credential" }); return { state: "LINKED" }; } };
  const now = () => 60_000, linkService = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), { now, attemptIdGenerator: () => ATTEMPT });
  await linkService.createAttempt(BINDING); await linkService.issueHandoff(BINDING, ATTEMPT); await linkService.checkAttempt(BINDING, ATTEMPT);
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
    const destination = (init?.body as FormData).get("destination"); return response({ files: [{ url: `https://r2.syntx.ai/${destination}.png`,
      ...(destination === "uploaded" ? { mime_type: "image/png", size: PNG.length, status: "accepted" } : {}) }] });
  } });
  const Original = originalModule.OwnerSeedreamEditorOriginalReferenceService as new (options: unknown) => { upload(input: unknown): Promise<Record<string, unknown>>; close(): Promise<void> };
  const originalService = new Original({ binding: BINDING, linkService, catalog: CATALOG, public_catalog_version: C5,
    settings_inventory: SETTINGS, settings_inventory_version: SETTINGS_62, resolveClient: () => client, now });
  const Service = loaded!.OwnerSeedreamEditorDrawingReferenceService as new (options: unknown) => {
    uploadDrawing(input: unknown): Promise<Record<string, unknown>>; close(): Promise<void>;
  };
  const service = new Service({ originalReferenceService: originalService, binding: BINDING, linkService, catalog: CATALOG,
    public_catalog_version: C5, settings_inventory: SETTINGS, settings_inventory_version: SETTINGS_62, resolveClient: () => client, now });
  try {
    const original = await originalService.upload({ attemptId: ATTEMPT, variant: "seedream-5", content_base64: PNG.toString("base64"), filename: "original.png", mime_type: "image/png" });
    const invalid = Object.defineProperty({}, "attemptId", { enumerable: true, get() { throw new Error("must not invoke accessor"); } });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    for (const input of [invalid, new Proxy({}, {}), revoked.proxy, { ...drawingInput("seedream-5", original.reference_handle), original_width: 1 }]) {
      await assert.rejects(() => service.uploadDrawing(input));
    }
    const valid = await service.uploadDrawing(drawingInput("seedream-5", original.reference_handle));
    assert.equal(valid.status, "uploaded");
  } finally { await service.close(); await originalService.close(); }
});

test("expired known pairs prune for liveness", async () => {
  let now = 70_000, started = 0;
  const fixture = createFixture(async (_input, init) => {
    const destination = (init?.body as FormData).get("destination");
    if (destination === "hidden") started += 1;
    return response({ files: [{ url: `https://r2.syntx.ai/${destination}-${started}.png`, ...(destination === "uploaded" ? { mime_type: "image/png", size: PNG.length, status: "accepted" } : {}) }] });
  }, () => now);
  try {
    const original = await uploadOriginal(fixture), drawing = await fixture.service.uploadDrawing(drawingInput("seedream-5", original.reference_handle));
    now += 900_001;
    await assert.rejects(() => fixture.service.resolveDrawing(drawingContext(original, drawing, "seedream-5")), (error: unknown) => code(error, "REFERENCE_EXPIRED"));
    const freshOriginal = await uploadOriginal(fixture, "seedream-5", RELINKED);
    const fresh = await fixture.service.uploadDrawing(drawingInput("seedream-5", freshOriginal.reference_handle, RELINKED, Buffer.from(PNG)));
    assert.equal(fresh.status, "uploaded", "expired known records are pruned before capacity checks");
  } finally { await fixture.service.close(); await fixture.originalReferenceService.close(); }
});

test("four native uploads are the pending ceiling and close drains them", async () => {
  const attempts = ["link_seedream_editor_pending_1_0123456789", "link_seedream_editor_pending_2_0123456789",
    "link_seedream_editor_pending_3_0123456789", "link_seedream_editor_pending_4_0123456789", "link_seedream_editor_pending_5_0123456789"];
  let started = 0, notifyStarted!: () => void;
  const allStarted = new Promise<void>((resolve) => { notifyStarted = resolve; });
  const fixture = createFixture(async (_input, init) => {
    const destination = (init?.body as FormData).get("destination");
    if (destination === "hidden") return new Promise<Response>((_resolve, reject) => {
      started += 1; if (started === 4) notifyStarted();
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
    return response({ files: [{ url: `https://r2.syntx.ai/${destination}-${started}.png`, ...(destination === "uploaded" ? { mime_type: "image/png", size: PNG.length, status: "accepted" } : {}) }] });
  }, () => 80_000);
  try {
    const variants = VARIANTS.slice(0, 5), originals: Array<Record<string, unknown>> = [];
    for (let index = 0; index < attempts.length; index += 1) {
      originals.push(await fixture.originalReferenceService.upload({ attemptId: attempts[index], variant: variants[index],
        content_base64: PNG.toString("base64"), filename: "original.png", mime_type: "image/png" }));
    }
    const uploads = attempts.slice(0, 4).map((attemptId, index) => fixture.service.uploadDrawing(
      drawingInput(variants[index]!, originals[index]!.reference_handle, attemptId)));
    await allStarted;
    await assert.rejects(() => fixture.service.uploadDrawing(drawingInput(variants[4]!, originals[4]!.reference_handle, attempts[4]!)),
      (error: unknown) => code(error, "SERVICE_BUSY"));
    await fixture.service.close();
    for (const upload of uploads) await assert.rejects(() => upload,
      (error: unknown) => code(error, "UPLOAD_OUTCOME_UNKNOWN") || code(error, "REQUEST_ABORTED") || code(error, "SERVICE_CLOSED"));
    assert.equal(started, 4);
  } finally { await fixture.service.close(); await fixture.originalReferenceService.close(); }
});

test("128 ambiguous semantic holds are nonevicting and deny a 129th distinct intent", async () => {
  let posts = 0;
  const fixture = createFixture(async (_input, init) => { posts += 1; const destination = (init?.body as FormData).get("destination");
    return response({ files: destination === "uploaded" ? [{ url: "https://r2.syntx.ai/original.png", mime_type: "image/png", size: PNG.length, status: "accepted" }] : [] }); }, () => 90_000);
  try {
    const original = await uploadOriginal(fixture);
    for (let index = 0; index < 128; index += 1) await assert.rejects(() => fixture.service.uploadDrawing(
      drawingInput("seedream-5", original.reference_handle, ATTEMPT, pngWithIntent(index))), (error: unknown) => code(error, "UPLOAD_OUTCOME_UNKNOWN"));
    await assert.rejects(() => fixture.service.uploadDrawing(drawingInput("seedream-5", original.reference_handle, ATTEMPT, pngWithIntent(128))),
      (error: unknown) => code(error, "CAPACITY_EXCEEDED"));
    assert.equal(posts, 129, "the 129th unknown semantic is denied before another POST");
  } finally { await fixture.service.close(); await fixture.originalReferenceService.close(); }
});

test("128 known pairs expire and prune so a fresh original and drawing can be stored", async () => {
  let now = 100_000, posts = 0;
  const fixture = createFixture(async (_input, init) => { posts += 1; const destination = (init?.body as FormData).get("destination");
    return response({ files: [{ url: `https://r2.syntx.ai/${destination}-${posts}.png`, ...(destination === "uploaded" ? { mime_type: "image/png", size: PNG.length, status: "accepted" } : {}) }] }); }, () => now);
  try {
    const original = await uploadOriginal(fixture);
    for (let index = 0; index < 128; index += 1) await fixture.service.uploadDrawing(
      drawingInput("seedream-5", original.reference_handle, ATTEMPT, pngWithIntent(index)));
    await assert.rejects(() => fixture.service.uploadDrawing(drawingInput("seedream-5", original.reference_handle, ATTEMPT, pngWithIntent(128))),
      (error: unknown) => code(error, "CAPACITY_EXCEEDED"));
    now += 900_001;
    const freshOriginal = await uploadOriginal(fixture, "seedream-5", RELINKED);
    const fresh = await fixture.service.uploadDrawing(drawingInput("seedream-5", freshOriginal.reference_handle, RELINKED, pngWithIntent(129)));
    assert.equal(fresh.status, "uploaded"); assert.equal(posts, 131, "one initial and one fresh original; 128 initial and one fresh drawing POST");
  } finally { await fixture.service.close(); await fixture.originalReferenceService.close(); }
});

