import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { loadMaplessSettingsInventoryVersion } from "../src/catalog/mapless-settings-inventory.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { getOwnerBananaInpaintOriginalUploadSourceProfile } from "../src/application/owner-banana-inpaint-original-upload-source-profile.js";

const MODULE_URL = new URL("../src/application/owner-banana-inpaint-original-reference-service.js", import.meta.url).href;
const serviceModule = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const C5_PUBLIC_VERSION = "sha256-c5c10b9b0bffdc4b75dab3363de10c2c2856f1130a559eb9e8a21a1493bf067c.json";
const SETTINGS_62_VERSION = "sha256-62bcf08172eb75011055d9ae04c772362b72337646ee2e460944d7fcb2301bcf.json";
const CATALOG_DIRECTORY = join(process.cwd(), "catalog");
const CATALOG = loadSelectedDiscoveryCatalog(C5_PUBLIC_VERSION, CATALOG_DIRECTORY).discoveryCatalog;
const SETTINGS = loadMaplessSettingsInventoryVersion(SETTINGS_62_VERSION, CATALOG_DIRECTORY);
const ATTEMPT = "link_banana_inpaint_original_service_0123456789";
const BINDING = Object.freeze({ tenant_id: "banana-inpaint-tenant", subject: "banana-inpaint-subject" });
const VARIANTS = ["banana", "banana2", "banana3", "banana3_light"] as const;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return operation("synthetic-banana-inpaint-service-credential");
  } };
}

function linkedAttempt(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: null, linked: true };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function pngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0); chunk.write(type, 4, 4, "ascii"); data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngWithUniqueText(index: number): Buffer {
  const end = PNG.length - 12;
  const text = Buffer.from(`intent\0${index}`, "latin1");
  return Buffer.concat([PNG.subarray(0, end), pngChunk("tEXt", text), PNG.subarray(end)]);
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function principal(attemptId = ATTEMPT, binding = BINDING) {
  return { tenant_id: binding.tenant_id, subject_id: binding.subject, connection_id: attemptId };
}

function resolverContext(receipt: Record<string, unknown>, variant: typeof VARIANTS[number], attemptId = ATTEMPT,
  binding = BINDING) {
  const profile = getOwnerBananaInpaintOriginalUploadSourceProfile(variant, CATALOG, C5_PUBLIC_VERSION, SETTINGS, SETTINGS_62_VERSION);
  return { principal: principal(attemptId, binding), attempt_id: attemptId, variant, form_id: "banana-inpaint",
    source_role: "inpaint_original", public_catalog_version: C5_PUBLIC_VERSION,
    settings_inventory_version: SETTINGS_62_VERSION, profile_schema_hash: profile.profile_schema_hash,
    reference_handle: receipt.reference_handle };
}

function uploadInput(variant: string, attemptId = ATTEMPT) {
  return { attemptId, variant, content_base64: PNG.toString("base64"), filename: "original.png", mime_type: "image/png" };
}

function createService(fetchImpl: typeof fetch, now: () => number, getStatus: (attemptId: string) => Promise<unknown> =
  async (attemptId) => linkedAttempt(attemptId), clientOptions?: { readonly catalog?: unknown; readonly settings?: unknown;
    readonly publicCatalogVersion?: string; readonly settingsVersion?: string }) {
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl });
  const Service = serviceModule?.OwnerBananaInpaintOriginalReferenceService as (new (options: unknown) => {
    upload(input: unknown): Promise<Record<string, unknown>>;
    resolveOriginal(input: unknown): Promise<Record<string, unknown>>;
    invalidateAttempt(attemptId: string): Promise<void>;
    close(): Promise<void>;
  }) | undefined;
  assert.equal(typeof Service, "function", "MISSING_BANANA_INPAINT_ORIGINAL_REFERENCE_SERVICE");
  const service = new Service!({
    binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return getStatus(attemptId); } },
    catalog: clientOptions?.catalog ?? CATALOG,
    public_catalog_version: clientOptions?.publicCatalogVersion ?? C5_PUBLIC_VERSION,
    settings_inventory: clientOptions?.settings ?? SETTINGS,
    settings_inventory_version: clientOptions?.settingsVersion ?? SETTINGS_62_VERSION,
    resolveClient: () => client,
    now
  });
  return { client, service };
}

test("Banana Inpaint original reference service provides the owned upload lifecycle API", () => {
  assert.ok(serviceModule, "MISSING_BANANA_INPAINT_ORIGINAL_REFERENCE_SERVICE_MODULE");
  assert.equal(typeof serviceModule.OwnerBananaInpaintOriginalReferenceService, "function",
    "MISSING_BANANA_INPAINT_ORIGINAL_REFERENCE_SERVICE");
});

test("issues original-only opaque handles through the actual native upload for all four c5 variants", async () => {
  let expectedVariant: typeof VARIANTS[number] = VARIANTS[0];
  let posts = 0, principalReads = 0;
  const calls: Array<{ model_type: string; file_size: number; bytes_match: boolean }> = [];
  const { service } = createService(async (input, init) => {
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
    calls.push({ model_type: String(form.get("model_type")), file_size: file.size, bytes_match: bytes.equals(PNG) });
    bytes.fill(0); posts += 1;
    return jsonResponse({ files: [{ id: posts, file_id: String(posts), url: `https://r2.syntx.ai/inpaint/${posts}.png`,
      mime_type: "image/png", size: PNG.byteLength, status: "accepted" }] });
  }, () => Date.parse("2026-10-11T00:00:00.000Z"), async (attemptId) => {
    principalReads += 1; return linkedAttempt(attemptId);
  });

  try {
    const receipts: Array<Record<string, unknown>> = [];
    for (expectedVariant of VARIANTS) receipts.push(await service.upload(uploadInput(expectedVariant)));
    assert.deepEqual(calls.map((call) => call.model_type), VARIANTS);
    assert.ok(calls.every((call) => call.bytes_match && call.file_size === PNG.byteLength));
    assert.equal(posts, 4);
    assert.equal(principalReads, 8, "each upload must recheck the current link before and after native POST");
    assert.ok(receipts.every((receipt, index) => receipt.status === "uploaded" && receipt.variant === VARIANTS[index] &&
      typeof receipt.reference_handle === "string" && receipt.mime_type === "image/png" && receipt.size === PNG.byteLength &&
      receipt.sha256 === `sha256:${createHash("sha256").update(PNG).digest("hex")}`));
    for (const privateValue of ["https://r2.syntx.ai", "banana-inpaint-subject", "original.png"]) {
      assert.equal(JSON.stringify(receipts).includes(privateValue), false);
    }
    const resolved = await service.resolveOriginal(resolverContext(receipts[0]!, "banana"));
    assert.equal(resolved.role, "inpaint_original");
    assert.equal(resolved.wire_type, "image");
    assert.equal(resolved.reference_handle, receipts[0]!.reference_handle);
    assert.equal(resolved.file_url, "https://r2.syntx.ai/inpaint/1.png");
    assert.equal(resolved.expires_at, Date.parse("2026-10-11T00:00:00.000Z") + 15 * 60_000);
    assert.equal(Object.hasOwn(resolved, "mask_permission"), false);
    assert.equal(Object.hasOwn(resolved, "generation_permission"), false);
    assert.equal(principalReads, 10, "resolver must recheck the current link before and after private URL resolution");
  } finally { await service.close(); }
});

test("rejects navigation aliases, banana-2.1, malformed DTOs, accessors, and proxies before link/auth/upload", async () => {
  let posts = 0, credentialCalls = 0, linkReads = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
      credentialCalls += 1; return operation("synthetic-banana-inpaint-service-credential");
    } },
    fetchImpl: async () => { posts += 1; return jsonResponse({ files: [{ url: "https://r2.syntx.ai/unused.png" }] }); }
  });
  const Service = serviceModule?.OwnerBananaInpaintOriginalReferenceService as (new (options: unknown) => {
    upload(input: unknown): Promise<unknown>; close(): Promise<void>;
  }) | undefined;
  assert.equal(typeof Service, "function", "MISSING_BANANA_INPAINT_ORIGINAL_REFERENCE_SERVICE");
  const service = new Service!({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { linkReads += 1; return linkedAttempt(attemptId); } },
    catalog: CATALOG, public_catalog_version: C5_PUBLIC_VERSION, settings_inventory: SETTINGS,
    settings_inventory_version: SETTINGS_62_VERSION, resolveClient: () => client,
    now: () => Date.parse("2026-10-11T00:00:00.000Z") });
  try {
    for (const invalid of [
      uploadInput("banana-2.1"), uploadInput("banana_inpaint"), { ...uploadInput("banana3"), extra: true },
      { ...uploadInput("banana3"), mime_type: "image/webp" }, { ...uploadInput("banana3"), content_base64: "%%%" }
    ]) {
      await assert.rejects(() => service.upload(invalid), (error: unknown) => hasCode(error, "INVALID_REQUEST") ||
        hasCode(error, "INVALID_IMAGE_INPUT"));
    }
    let getterCalls = 0;
    const getter = Object.defineProperties({}, {
      attemptId: { enumerable: true, get() { getterCalls += 1; return ATTEMPT; } },
      variant: { enumerable: true, value: "banana" }, content_base64: { enumerable: true, value: PNG.toString("base64") },
      filename: { enumerable: true, value: "original.png" }, mime_type: { enumerable: true, value: "image/png" }
    });
    let proxyTraps = 0;
    const proxy = new Proxy(uploadInput("banana"), { ownKeys() { proxyTraps += 1; throw new Error("must not run proxy trap"); } });
    await assert.rejects(() => service.upload(getter), (error: unknown) => hasCode(error, "INVALID_REQUEST"));
    await assert.rejects(() => service.upload(proxy), (error: unknown) => hasCode(error, "INVALID_REQUEST"));
    assert.equal(getterCalls, 0); assert.equal(proxyTraps, 0);
    assert.equal(linkReads, 0); assert.equal(credentialCalls, 0); assert.equal(posts, 0);
  } finally { await service.close(); }
});

test("resolver is limited to the exact original-image handle context and source profile", async () => {
  let posts = 0;
  const { service } = createService(async () => {
    posts += 1;
    return jsonResponse({ files: [{ url: "https://r2.syntx.ai/inpaint/private.png", mime_type: "image/png", size: PNG.length }] });
  }, () => Date.parse("2026-10-11T00:00:00.000Z"));
  try {
    const receipt = await service.upload(uploadInput("banana"));
    const baseContext = resolverContext(receipt, "banana");
    for (const invalid of [
      { ...baseContext, attempt_id: "link_banana_inpaint_other_0123456789", principal: principal("link_banana_inpaint_other_0123456789") },
      { ...baseContext, principal: { ...principal(), subject_id: "foreign-subject" } },
      { ...baseContext, variant: "banana2" },
      { ...baseContext, form_id: "banana" },
      { ...baseContext, source_role: "mask" },
      { ...baseContext, profile_schema_hash: `sha256:${"0".repeat(64)}` },
      { ...baseContext, reference_handle: "banana_inpaint_original_00000000-0000-4000-8000-000000000000" },
      { ...baseContext, file_url: "https://evil.invalid/private.png" }
    ]) {
    await assert.rejects(() => service.resolveOriginal(invalid), (error: unknown) => hasCode(error, "INVALID_REQUEST") ||
        hasCode(error, "REFERENCE_UNAVAILABLE") || hasCode(error, "PRINCIPAL_NOT_LINKED"));
    }
    const resolved = await service.resolveOriginal(baseContext);
    assert.equal(resolved.file_url, "https://r2.syntx.ai/inpaint/private.png");
    assert.equal(resolved.role, "inpaint_original");
    assert.equal(resolved.wire_type, "image");
    assert.equal(resolved.generation_permit, false);
    assert.equal(posts, 1);
  } finally { await service.close(); }
});

test("rejects a changed or unpaired e551/00f source-profile binding before upload", async () => {
  let posts = 0, linkReads = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    posts += 1; return jsonResponse({ files: [{ url: "https://r2.syntx.ai/unused.png" }] });
  } });
  const Service = serviceModule!.OwnerBananaInpaintOriginalReferenceService as new (options: unknown) => { close(): Promise<void> };
  const wrongVersions = [
    { public_catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
      settings_inventory_version: SETTINGS_62_VERSION },
    { public_catalog_version: C5_PUBLIC_VERSION,
      settings_inventory_version: "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json" }
  ];
  for (const versions of wrongVersions) {
    assert.throws(() => new Service({ binding: BINDING,
      linkService: { async getStatus() { linkReads += 1; return linkedAttempt(ATTEMPT); } },
      catalog: CATALOG, public_catalog_version: versions.public_catalog_version,
      settings_inventory: SETTINGS, settings_inventory_version: versions.settings_inventory_version,
      resolveClient: () => client, now: () => 1_000 }),
    (error: unknown) => hasCode(error, "PROFILE_BINDING_MISMATCH"));
  }
  assert.equal(linkReads, 0);
  assert.equal(posts, 0);
});

test("recomputes the exact paired source profile before resolving an existing handle", async () => {
  const changedSettings = structuredClone(SETTINGS);
  const inpaintForm = changedSettings.forms.find((form) => form.form_id === "banana-inpaint");
  assert.ok(inpaintForm);
  let posts = 0;
  const { service } = createService(async () => {
    posts += 1;
    return jsonResponse({ files: [{ url: "https://r2.syntx.ai/inpaint/profile.png", mime_type: "image/png", size: PNG.length }] });
  }, () => 2_000, async (attemptId) => linkedAttempt(attemptId), { settings: changedSettings });
  try {
    const receipt = await service.upload(uploadInput("banana"));
    inpaintForm.javascript.sha256 = `sha256:${"0".repeat(64)}`;
    await assert.rejects(() => service.resolveOriginal(resolverContext(receipt, "banana")),
      (error: unknown) => hasCode(error, "PROFILE_BINDING_MISMATCH"));
    assert.equal(posts, 1);
  } finally { await service.close(); }
});

test("pre-abort stops before link lookup, credentials, or native upload", async () => {
  let links = 0, credentials = 0, posts = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
      credentials += 1; return operation("synthetic-banana-inpaint-service-credential");
    } },
    fetchImpl: async () => { posts += 1; return jsonResponse({ files: [{ url: "https://r2.syntx.ai/unused.png" }] }); }
  });
  const Service = serviceModule!.OwnerBananaInpaintOriginalReferenceService as new (options: unknown) => {
    upload(input: unknown): Promise<unknown>; close(): Promise<void>;
  };
  const service = new Service({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { links += 1; return linkedAttempt(attemptId); } },
    catalog: CATALOG, public_catalog_version: C5_PUBLIC_VERSION, settings_inventory: SETTINGS,
    settings_inventory_version: SETTINGS_62_VERSION, resolveClient: () => client, now: () => 1_000 });
  const controller = new AbortController(); controller.abort();
  try {
    await assert.rejects(() => service.upload({ ...uploadInput("banana"), signal: controller.signal }),
      (error: unknown) => hasCode(error, "REQUEST_ABORTED"));
    assert.equal(links, 0); assert.equal(credentials, 0); assert.equal(posts, 0);
  } finally { await service.close(); }
});

test("an ambiguous native receipt is held semantically and cannot be replayed on a new attempt", async () => {
  let posts = 0, linkReads = 0;
  const { service } = createService(async () => {
    posts += 1;
    return jsonResponse({ files: [] });
  }, () => 10_000, async (attemptId) => { linkReads += 1; return linkedAttempt(attemptId); });
  const nextAttempt = "link_banana_inpaint_relinked_0123456789";
  try {
    await assert.rejects(() => service.upload(uploadInput("banana3")),
      (error: unknown) => hasCode(error, "UPLOAD_OUTCOME_UNKNOWN"));
    await assert.rejects(() => service.upload(uploadInput("banana3", nextAttempt)),
      (error: unknown) => hasCode(error, "UPLOAD_OUTCOME_UNKNOWN"));
    assert.equal(posts, 1, "new link attempt cannot replay the same ambiguous source upload");
    assert.equal(linkReads, 2, "unknown post has one precheck; rejected replay still checks the current principal");
  } finally { await service.close(); }
});

test("a relink before handle issuance becomes unknown and cannot mint a receipt", async () => {
  let statusReads = 0, posts = 0;
  const { service } = createService(async () => {
    posts += 1;
    return jsonResponse({ files: [{ url: "https://r2.syntx.ai/inpaint/relinked.png", mime_type: "image/png", size: PNG.length }] });
  }, () => 30_000, async (attemptId) => {
    statusReads += 1;
    return statusReads === 1 ? linkedAttempt(attemptId) : { ...linkedAttempt(attemptId), status: "REVOKED", linked: false };
  });
  try {
    await assert.rejects(() => service.upload(uploadInput("banana3_light")),
      (error: unknown) => error instanceof Error && hasCode(error, "UPLOAD_OUTCOME_UNKNOWN") && !error.message.includes("r2.syntx.ai"));
    assert.equal(statusReads, 2);
    assert.equal(posts, 1);
  } finally { await service.close(); }
});

test("reference expiry is original and clock rollback closes the service", async () => {
  let now = 10_000, posts = 0;
  const { service } = createService(async () => {
    posts += 1;
    return jsonResponse({ files: [{ url: "https://r2.syntx.ai/inpaint/ttl.png", mime_type: "image/png", size: PNG.length }] });
  }, () => now);
  try {
    const receipt = await service.upload(uploadInput("banana2"));
    const expiry = now + 15 * 60_000;
    const context = resolverContext(receipt, "banana2");
    assert.equal((await service.resolveOriginal(context)).expires_at, expiry);
    now = expiry;
    await assert.rejects(() => service.resolveOriginal(context), (error: unknown) => hasCode(error, "REFERENCE_EXPIRED"));
    assert.equal(posts, 1, "expiry does not refresh or reupload the original");
  } finally { await service.close(); }

  let rollbackNow = 20_000;
  const rollback = createService(async () => jsonResponse({ files: [{ url: "https://r2.syntx.ai/inpaint/clock.png" }] }),
    () => rollbackNow);
  try {
    const receipt = await rollback.service.upload(uploadInput("banana"));
    rollbackNow -= 1;
    await assert.rejects(() => rollback.service.resolveOriginal(resolverContext(receipt, "banana")),
      (error: unknown) => hasCode(error, "SERVICE_CLOSED"));
  } finally { await rollback.service.close(); }
});

test("invalidation establishes a barrier, drains an in-flight POST, and cancels its late response", async () => {
  let posts = 0, cancelled = 0;
  let markStarted!: () => void;
  let resolveLate!: (response: Response) => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const lateResponse = new Promise<Response>((resolve) => { resolveLate = resolve; });
  const { service } = createService(async () => { posts += 1; markStarted(); return lateResponse; }, () => 5_000);
  const upload = service.upload(uploadInput("banana3"));
  await started;
  const invalidation = service.invalidateAttempt(ATTEMPT);
  await assert.rejects(() => service.upload(uploadInput("banana3")),
    (error: unknown) => hasCode(error, "REQUEST_ABORTED"));
  await invalidation;
  await assert.rejects(() => upload, (error: unknown) => hasCode(error, "UPLOAD_OUTCOME_UNKNOWN"));
  resolveLate(new Response(new ReadableStream<Uint8Array>({ start() {}, cancel() { cancelled += 1; } }), { status: 200 }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(posts, 1);
  assert.equal(cancelled, 1);
  await service.close();
});

test("close aborts and drains an in-flight upload before completing cleanup", async () => {
  let posts = 0, cancelled = 0;
  let markStarted!: () => void;
  let resolveLate!: (response: Response) => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const lateResponse = new Promise<Response>((resolve) => { resolveLate = resolve; });
  const { service } = createService(async () => { posts += 1; markStarted(); return lateResponse; }, () => 40_000);
  const upload = service.upload(uploadInput("banana2"));
  await started;
  const closing = service.close();
  await assert.rejects(() => service.upload(uploadInput("banana2")),
    (error: unknown) => hasCode(error, "SERVICE_CLOSED"));
  await closing;
  await assert.rejects(() => upload, (error: unknown) => hasCode(error, "UPLOAD_OUTCOME_UNKNOWN"));
  resolveLate(new Response(new ReadableStream<Uint8Array>({ start() {}, cancel() { cancelled += 1; } }), { status: 200 }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(posts, 1);
  assert.equal(cancelled, 1);
});

test("the process-local handle/attempt ceiling rejects the next upload before native dispatch", async () => {
  let posts = 0;
  const { service } = createService(async () => {
    posts += 1;
    return jsonResponse({ files: [{ url: `https://r2.syntx.ai/inpaint/cap-${posts}.png`, mime_type: "image/png", size: PNG.length }] });
  }, () => 1_000);
  try {
    for (let index = 0; index < 128; index += 1) {
      const attemptId = `link_banana_inpaint_cap_${String(index).padStart(3, "0")}_0123456789`;
      await service.upload(uploadInput("banana", attemptId));
    }
    await assert.rejects(() => service.upload(uploadInput("banana", "link_banana_inpaint_cap_128_0123456789")),
      (error: unknown) => hasCode(error, "CAPACITY_EXCEEDED"));
    assert.equal(posts, 128);
  } finally { await service.close(); }
});

test("expired known handles release attempt capacity before a fresh upload", async () => {
  let now = 1_000, posts = 0;
  const { service } = createService(async () => {
    posts += 1;
    return jsonResponse({ files: [{ url: `https://r2.syntx.ai/inpaint/expiry-${posts}.png`, mime_type: "image/png", size: PNG.length }] });
  }, () => now);
  try {
    for (let index = 0; index < 128; index += 1) {
      const attemptId = `link_banana_inpaint_exp_${String(index).padStart(3, "0")}_0123456789`;
      const receipt = await service.upload(uploadInput("banana", attemptId));
      assert.equal(receipt.status, "uploaded");
    }
    assert.equal(posts, 128);
    now += 15 * 60_000 + 1;
    const recoveredSlot = await service.upload(uploadInput("banana", "link_banana_inpaint_exp_new_0123456789"));
    assert.equal(recoveredSlot.status, "uploaded");
    assert.equal(posts, 129, "expired successful handles are pruned before applying the active-attempt ceiling");
  } finally { await service.close(); }
});

test("unknown semantic upload holds are bounded and nonevicting", async () => {
  let posts = 0;
  const { service } = createService(async () => {
    posts += 1;
    return jsonResponse({ files: [] });
  }, () => 1_000);
  try {
    for (let index = 0; index < 128; index += 1) {
      const bytes = pngWithUniqueText(index);
      try {
        await assert.rejects(() => service.upload({ ...uploadInput("banana", ATTEMPT),
          content_base64: bytes.toString("base64") }), (error: unknown) => hasCode(error, "UPLOAD_OUTCOME_UNKNOWN"));
      } finally { bytes.fill(0); }
    }
    const freshIntent = pngWithUniqueText(128);
    try {
      await assert.rejects(() => service.upload({ ...uploadInput("banana", "link_banana_inpaint_hold_0123456789"),
        content_base64: freshIntent.toString("base64") }), (error: unknown) => hasCode(error, "CAPACITY_EXCEEDED"));
    } finally { freshIntent.fill(0); }
    assert.equal(posts, 128, "the bounded unknown-hold ledger rejects overflow before native dispatch");
  } finally { await service.close(); }
});
