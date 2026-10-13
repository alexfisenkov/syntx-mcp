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

const MODULE_URL = new URL("../src/application/owner-seedream-editor-original-reference-service.js", import.meta.url).href;
const serviceModule = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const C5 = "sha256-c5c10b9b0bffdc4b75dab3363de10c2c2856f1130a559eb9e8a21a1493bf067c.json";
const SETTINGS_62 = "sha256-62bcf08172eb75011055d9ae04c772362b72337646ee2e460944d7fcb2301bcf.json";
const CATALOG = loadSelectedDiscoveryCatalog(C5, join(process.cwd(), "catalog")).discoveryCatalog;
const SETTINGS = loadMaplessSettingsInventoryVersion(SETTINGS_62, join(process.cwd(), "catalog"));
const ATTEMPT = "link_seedream_editor_original_service_0123456789";
const RELINKED = "link_seedream_editor_original_relinked_0123456789";
const BINDING = Object.freeze({ tenant_id: "seedream-editor-tenant", subject: "seedream-editor-subject" });
const VARIANTS = ["seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-flash", "seedream-5.0-pro"] as const;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-editor-credential"); } };
}
function linked(attempt_id: string) { return { attempt_id, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
  status: "LINKED" as const, expires_at: null, linked: true }; }
function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngWithIntent(index: number): Buffer {
  const data = Buffer.from(`intent\0${index}`, "latin1"), chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0); chunk.write("tEXt", 4, 4, "ascii"); data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return Buffer.concat([PNG.subarray(0, PNG.length - 12), chunk, PNG.subarray(PNG.length - 12)]);
}
function code(error: unknown, expected: string): boolean { return error instanceof Error && "code" in error && error.code === expected; }
function principal(attemptId = ATTEMPT) { return { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: attemptId }; }
function uploadInput(variant: string, attemptId = ATTEMPT, content = PNG) {
  return { attemptId, variant, content_base64: content.toString("base64"), filename: "editor-original.png", mime_type: "image/png" };
}
function context(receipt: Record<string, unknown>, variant: typeof VARIANTS[number], attemptId = ATTEMPT) {
  const profile = getOwnerSeedreamEditorOriginalUploadSourceProfile(variant, CATALOG, C5, SETTINGS, SETTINGS_62);
  return { principal: principal(attemptId), attempt_id: attemptId, variant, form_id: "seedream-editor",
    source_role: "editor_original", public_catalog_version: C5, settings_inventory_version: SETTINGS_62,
    profile_schema_hash: profile.profile_schema_hash, reference_handle: receipt.reference_handle };
}
function createService(fetchImpl: typeof fetch, now: () => number, getStatus: (attempt: string) => Promise<unknown> =
  async (attempt) => linked(attempt)) {
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl });
  const Service = serviceModule?.OwnerSeedreamEditorOriginalReferenceService as (new (options: unknown) => {
    upload(input: unknown): Promise<Record<string, unknown>>;
    resolveOriginal(input: unknown): Promise<Record<string, unknown>>;
    isOwnedOriginalResolution(value: unknown, context: unknown): boolean;
    invalidateAttempt(attemptId: string): Promise<void>;
    close(): Promise<void>;
  }) | undefined;
  assert.equal(typeof Service, "function", "MISSING_SEEDREAM_EDITOR_ORIGINAL_REFERENCE_SERVICE");
  const service = new Service!({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attempt: string) { return getStatus(attempt); } },
    catalog: CATALOG, public_catalog_version: C5, settings_inventory: SETTINGS,
    settings_inventory_version: SETTINGS_62, resolveClient: () => client, now });
  return { client, service };
}

test("Seedream Editor original service has a dedicated owner-only lifecycle class", () => {
  assert.ok(serviceModule, "MISSING_SEEDREAM_EDITOR_ORIGINAL_REFERENCE_SERVICE_MODULE");
  assert.equal(typeof serviceModule.OwnerSeedreamEditorOriginalReferenceService, "function",
    "MISSING_SEEDREAM_EDITOR_ORIGINAL_REFERENCE_SERVICE");
});

test("uploads all five exact variants through the captured native Editor method and resolves only genuine originals", async () => {
  let posts = 0, linkReads = 0;
  const modelTypes: string[] = [];
  const { service } = createService(async (input, init) => {
    assert.equal(new URL(String(input)).href, "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    const form = init?.body as FormData;
    assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(form.get("destination"), "uploaded"); assert.equal(form.get("check_duplicates"), "true");
    const file = form.get("files"); assert.ok(file instanceof File);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
    modelTypes.push(String(form.get("model_type"))); posts += 1;
    return response({ files: [{ id: posts, file_id: String(posts), url: `https://r2.syntx.ai/editor/${posts}.png`,
      mime_type: "image/png", size: PNG.length, status: "accepted" }] });
  }, () => Date.parse("2026-10-12T00:00:00.000Z"), async (attempt) => { linkReads += 1; return linked(attempt); });
  try {
    const receipts: Array<Record<string, unknown>> = [];
    for (const variant of VARIANTS) receipts.push(await service.upload(uploadInput(variant)));
    assert.deepEqual(modelTypes, VARIANTS); assert.equal(posts, 5); assert.equal(linkReads, 10);
    for (let index = 0; index < VARIANTS.length; index += 1) {
      const receipt = receipts[index]!;
      assert.equal(receipt.status, "uploaded"); assert.equal(receipt.variant, VARIANTS[index]);
      assert.equal(receipt.original_mime_type, "image/png"); assert.equal(receipt.mime_type, "image/png");
      assert.equal(receipt.width, 1); assert.equal(receipt.height, 1); assert.equal(receipt.size, PNG.length);
      assert.equal(receipt.sha256, `sha256:${createHash("sha256").update(PNG).digest("hex")}`);
      assert.equal(receipt.expires_in_seconds, 900);
      for (const secret of ["https://r2.syntx.ai", BINDING.subject, "editor-original.png", PNG.toString("base64")]) {
        assert.equal(JSON.stringify(receipt).includes(secret), false);
      }
      const ctx = context(receipt, VARIANTS[index]!);
      const resolved = await service.resolveOriginal(ctx);
      assert.equal(service.isOwnedOriginalResolution(resolved, ctx), true);
      assert.equal(resolved.role, "editor_original"); assert.equal(resolved.wire_type, "image");
      assert.equal(resolved.form_id, "seedream-editor"); assert.equal(resolved.source_role, "editor_original");
      assert.equal(resolved.generation_permit, false); assert.equal(resolved.original_sha256, receipt.sha256);
      assert.equal(resolved.file_url, `https://r2.syntx.ai/editor/${index + 1}.png`);
      assert.equal(resolved.expires_at, Date.parse("2026-10-12T00:00:00.000Z") + 900_000);
      assert.equal(service.isOwnedOriginalResolution({ ...resolved }, ctx), false);
    }
    assert.equal(linkReads, 20, "each resolution rechecks the link before and after using the private URL");
  } finally { await service.close(); }
});

test("strict resolver context, foreign principal, profile drift, and invalidation cannot transfer handles", async () => {
  let posts = 0;
  const { service } = createService(async () => { posts += 1; return response({ files: [{ url: "https://r2.syntx.ai/editor/private.png" }] }); }, () => 2_000);
  try {
    const receipt = await service.upload(uploadInput("seedream-5"));
    const ctx = context(receipt, "seedream-5");
    for (const bad of [
      { ...ctx, source_role: "ordinary_seedream_original" }, { ...ctx, form_id: "seedream" },
      { ...ctx, principal: { ...principal(), subject_id: "foreign-subject" } },
      { ...ctx, attempt_id: RELINKED, principal: principal(RELINKED) },
      { ...ctx, profile_schema_hash: `sha256:${"0".repeat(64)}` },
      { ...ctx, reference_handle: "seedream_editor_original_00000000-0000-4000-8000-000000000000" },
      { ...ctx, private_url: "https://evil.invalid/image.png" }
    ]) await assert.rejects(() => service.resolveOriginal(bad), (error: unknown) =>
      code(error, "INVALID_REQUEST") || code(error, "REFERENCE_UNAVAILABLE") || code(error, "PRINCIPAL_NOT_LINKED"));
    const resolved = await service.resolveOriginal(ctx);
    assert.equal(service.isOwnedOriginalResolution(resolved, ctx), true);
    assert.equal(posts, 1);
    await service.invalidateAttempt(RELINKED);
    assert.equal(service.isOwnedOriginalResolution(resolved, ctx), true, "foreign attempt invalidation must not affect the owner handle");
    await service.invalidateAttempt(ATTEMPT);
    await assert.rejects(() => service.resolveOriginal(ctx), (error: unknown) => code(error, "REFERENCE_UNAVAILABLE"));
    assert.equal(service.isOwnedOriginalResolution(resolved, ctx), false);
  } finally { await service.close(); }
});

test("accepts a class-based link service and rejects revoked proxies without invoking accessors", async () => {
  let posts = 0;
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-seedream-challenge", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receiveCredential) { await receiveCredential({ scheme: "Bearer", value: "synthetic-seedream-token" }); return { state: "LINKED" }; } };
  const authNow = () => 7_000, store = new InMemoryAuthLinkStore(authNow);
  const linkService = new PerUserLinkService(provider, store, { now: authNow, attemptIdGenerator: () => ATTEMPT });
  await linkService.createAttempt(BINDING); await linkService.issueHandoff(BINDING, ATTEMPT);
  assert.equal((await linkService.checkAttempt(BINDING, ATTEMPT)).status, "LINKED");
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    posts += 1; return response({ files: [{ url: "https://r2.syntx.ai/editor/class.png" }] });
  } });
  const Service = serviceModule!.OwnerSeedreamEditorOriginalReferenceService as new (options: unknown) => {
    upload(input: unknown): Promise<Record<string, unknown>>; close(): Promise<void>;
  };
  const service = new Service({ binding: BINDING, linkService, catalog: CATALOG,
    public_catalog_version: C5, settings_inventory: SETTINGS, settings_inventory_version: SETTINGS_62,
    resolveClient: () => client, now: () => 7_000 });
  try {
    await service.upload(uploadInput("seedream-5"));
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    await assert.rejects(() => service.upload(revoked.proxy), (error: unknown) => code(error, "INVALID_REQUEST"));
    assert.equal(posts, 1);
  } finally { await service.close(); }
});

test("ambiguous uploads are not replayed across link nonces; known expired handles can be pruned", async () => {
  let posts = 0, now = 5_000;
  const { service } = createService(async () => { posts += 1; return response({ files: [] }); }, () => now);
  try {
    await assert.rejects(() => service.upload(uploadInput("seedream-4.5")), (error: unknown) => code(error, "UPLOAD_OUTCOME_UNKNOWN"));
    await service.invalidateAttempt(ATTEMPT);
    await assert.rejects(() => service.upload(uploadInput("seedream-4.5", RELINKED)), (error: unknown) => code(error, "UPLOAD_OUTCOME_UNKNOWN"));
    assert.equal(posts, 1);
  } finally { await service.close(); }
  const known = createService(async (_input) => { posts += 1; return response({ files: [{ url: `https://r2.syntx.ai/editor/${posts}.png` }] }); }, () => now);
  try {
    const receipt = await known.service.upload(uploadInput("seedream-4"));
    now += 900_001;
    await assert.rejects(() => known.service.resolveOriginal(context(receipt, "seedream-4")), (error: unknown) => code(error, "REFERENCE_EXPIRED"));
    const next = await known.service.upload(uploadInput("seedream-4", RELINKED));
    assert.equal(next.status, "uploaded");
  } finally { await known.service.close(); }
});

test("late native ACK cannot mint an already-expired handle and the nominal guard expires independently", async () => {
  let now = 12_000, posts = 0;
  const late = createService(async () => {
    posts += 1; now += 900_000;
    return response({ files: [{ url: "https://r2.syntx.ai/editor/late-ack.png" }] });
  }, () => now);
  try {
    await assert.rejects(() => late.service.upload(uploadInput("seedream-5.0-pro")),
      (error: unknown) => code(error, "UPLOAD_OUTCOME_UNKNOWN"));
    assert.equal(posts, 1);
    await assert.rejects(() => late.service.upload(uploadInput("seedream-5.0-pro", RELINKED)),
      (error: unknown) => code(error, "UPLOAD_OUTCOME_UNKNOWN"));
    assert.equal(posts, 1);
  } finally { await late.service.close(); }

  now = 20_000;
  const live = createService(async () => { posts += 1; return response({ files: [{ url: "https://r2.syntx.ai/editor/ttl.png" }] }); }, () => now);
  try {
    const receipt = await live.service.upload(uploadInput("seedream-5"));
    const ctx = context(receipt, "seedream-5"), resolved = await live.service.resolveOriginal(ctx);
    assert.equal(live.service.isOwnedOriginalResolution(resolved, ctx), true);
    now += 900_001;
    assert.equal(live.service.isOwnedOriginalResolution(resolved, ctx), false,
      "the synchronous nominal guard checks original expiry without requiring resolver/prune first");
    assert.equal(live.service.isOwnedOriginalResolution({ ...resolved }, ctx), false);
  } finally { await live.service.close(); }
});

test("native ambiguity, 4-pending ceiling, abort drain, and service close preserve no-replay", async () => {
  let posts = 0, release!: (value: Response) => void, started!: () => void;
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  const held = new Promise<Response>((resolve) => { release = resolve; });
  const { service } = createService(async () => { posts += 1; if (posts === 4) started(); return held; }, () => 8_000);
  const first = service.upload(uploadInput("seedream-5"));
  const second = service.upload(uploadInput("seedream-4" , "link_seedream_editor_original_2_0123456789"));
  const third = service.upload(uploadInput("seedream-4.5", "link_seedream_editor_original_3_0123456789"));
  const fourth = service.upload(uploadInput("seedream-5.0-flash", "link_seedream_editor_original_4_0123456789"));
  await startedPromise;
  await assert.rejects(() => service.upload(uploadInput("seedream-5.0-pro", "link_seedream_editor_original_5_0123456789")),
    (error: unknown) => code(error, "SERVICE_BUSY"));
  const closing = service.close();
  release(response({ files: [{ url: "https://r2.syntx.ai/editor/late.png" }] }));
  await closing;
  for (const upload of [first, second, third, fourth]) await assert.rejects(() => upload,
    (error: unknown) => code(error, "UPLOAD_OUTCOME_UNKNOWN") || code(error, "REQUEST_ABORTED") || code(error, "SERVICE_CLOSED"));
  assert.equal(posts, 4);
});

test("attempt invalidation drains the native request before releasing its local state", async () => {
  let posts = 0, release!: (value: Response) => void, started!: () => void;
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  const held = new Promise<Response>((resolve) => { release = resolve; });
  const { service } = createService(async () => { posts += 1; started(); return held; }, () => 9_000);
  const upload = service.upload(uploadInput("seedream-4.5")); await startedPromise;
  const invalidation = service.invalidateAttempt(ATTEMPT);
  await assert.rejects(() => service.upload(uploadInput("seedream-4.5")), (error: unknown) => code(error, "REQUEST_ABORTED"));
  release(response({ files: [{ url: "https://r2.syntx.ai/editor/late-after-invalidate.png" }] }));
  await invalidation;
  await assert.rejects(() => upload, (error: unknown) => code(error, "UPLOAD_OUTCOME_UNKNOWN"));
  assert.equal(posts, 1);
  await service.close();
});

test("128 unknown semantic holds are bounded and never evicted; expired known handles free capacity", async () => {
  let posts = 0, now = 50_000;
  const uncertain = createService(async () => { posts += 1; return response({ files: [] }); }, () => now);
  try {
    for (let index = 0; index < 128; index += 1) {
      const bytes = pngWithIntent(index);
      try { await assert.rejects(() => uncertain.service.upload({ ...uploadInput("seedream-4.5"), content_base64: bytes.toString("base64") }),
        (error: unknown) => code(error, "UPLOAD_OUTCOME_UNKNOWN")); }
      finally { bytes.fill(0); }
    }
    const overflow = pngWithIntent(128);
    try { await assert.rejects(() => uncertain.service.upload({ ...uploadInput("seedream-4.5", RELINKED),
      content_base64: overflow.toString("base64") }), (error: unknown) => code(error, "CAPACITY_EXCEEDED")); }
    finally { overflow.fill(0); }
    assert.equal(posts, 128);
  } finally { await uncertain.service.close(); }

  const known = createService(async () => { posts += 1; return response({ files: [{ url: `https://r2.syntx.ai/editor/known-${posts}.png` }] }); }, () => now);
  try {
    for (let index = 0; index < 128; index += 1) {
      const attempt = `link_seedream_editor_capacity_${String(index).padStart(3, "0")}_0123456789`;
      await known.service.upload(uploadInput("seedream-5", attempt));
    }
    await assert.rejects(() => known.service.upload(uploadInput("seedream-5", "link_seedream_editor_capacity_overflow_0123456789")),
      (error: unknown) => code(error, "CAPACITY_EXCEEDED"));
    now += 900_001;
    assert.equal((await known.service.upload(uploadInput("seedream-5", "link_seedream_editor_capacity_fresh_0123456789"))).status, "uploaded");
    assert.equal(posts, 257);
  } finally { await known.service.close(); }
});
