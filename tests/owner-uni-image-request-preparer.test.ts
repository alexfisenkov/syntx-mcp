import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { OwnerUniImageUploadService } from "../src/application/owner-uni-image-upload-service.js";
import { getOwnerUniImageSourceProfile } from "../src/application/owner-uni-image-source-profile.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { syntxPublicCatalogSnapshotSchema } from "../src/catalog/syntx-public-catalog.js";

const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const CATALOG = new DiscoveryCatalogRepository(syntxPublicCatalogSnapshotSchema.parse(JSON.parse(readFileSync(
  join(process.cwd(), "catalog/public", CATALOG_VERSION), "utf8"
))));
const BINDING = Object.freeze({ tenant_id: "uni-preparer-tenant", subject: "uni-preparer-subject" });
const ATTEMPT = "link_uni_preparer_00000000000000000001";
const PRINCIPAL = Object.freeze({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });
const NOW = Date.parse("2026-10-11T00:00:00.000Z");
const PREPARER_URL = new URL("../src/application/owner-uni-image-request-preparer.js", import.meta.url).href;
const JPEG = Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x0b,0x08,0x00,0x01,0x00,0x01,0x01,0x01,0x11,0x00,0xff,0xda,0x00,0x08,0x01,0x01,0x00,0x00,0x3f,0x00,0x00,0xff,0xd9]);

function jpegWithWidth(width: number): Buffer {
  assert.ok(Number.isInteger(width) && width > 0 && width <= 65_535);
  const bytes = Buffer.from(JPEG); bytes.writeUInt16BE(width, 9); return bytes;
}

function credentialBroker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    return operation("synthetic-uni-preparer-credential");
  } };
}

function linkedAttempt(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: null, linked: true };
}

test("prepares Uni-1 only from an actual Task800-owned upload resolution and preserves its exact native request privately", async () => {
  let preparerModule: Record<string, unknown> | undefined;
  try { preparerModule = await import(PREPARER_URL) as Record<string, unknown>; } catch { /* Expected first RED until the preparer is implemented. */ }
  assert.equal(typeof preparerModule?.OwnerUniImageRequestPreparer, "function", "MISSING_OWNER_UNI_IMAGE_REQUEST_PREPARER");
  const Preparer = preparerModule!.OwnerUniImageRequestPreparer as new (options: Record<string, unknown>) => {
    issue(input: unknown): Promise<Record<string, unknown>>;
    prepare(input: unknown): Promise<Record<string, unknown>>;
    isPreparedCandidateForPrincipal(candidate: unknown, principal: unknown, attemptId: unknown): boolean;
    close(): Promise<void>;
  };
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (input, init) => {
    posts += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    const form = init?.body as FormData;
    assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(form.get("model_type"), "uni-1");
    const file = form.get("files");
    assert.ok(file instanceof File);
    return Response.json({ files: [{ id: "uni-preparer-private-id", url: "https://r2.syntx.ai/private/uni/preparer.jpg",
      mime_type: file.type, size: file.size }] });
  } });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } };
  const uploadService = new OwnerUniImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const preparer = new Preparer({ binding: BINDING, linkService, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => NOW });
  try {
    const upload = await uploadService.upload({ attemptId: ATTEMPT, model_id: "uni-1",
      content_base64: JPEG.toString("base64"), filename: "source.jpg", mime_type: "image/jpeg" });
    const sourceProfile = getOwnerUniImageSourceProfile("uni-1", CATALOG, CATALOG_VERSION);
    const assetSet = await preparer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "uni-1",
      prompt: "a quiet studio", parameters: { aspect_ratio: "1:1", seed: null, mode: "auto" },
      image_reference_handles: [upload.reference_handle], main_image_reference_handle: null });
    const candidate = await preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: assetSet });
    assert.equal(posts, 1);
    assert.equal(assetSet.status, "nominal");
    assert.equal(assetSet.model_id, "uni-1");
    assert.equal(assetSet.reference_count, 1);
    assert.equal(assetSet.profile_schema_hash, sourceProfile.profile_schema_hash);
    assert.equal(candidate.profile_schema_hash, sourceProfile.profile_schema_hash);
    const sourceBinding = candidate.source_binding as { upload_profile_reference: { schema_hash: string } };
    assert.equal(sourceBinding.upload_profile_reference.schema_hash, sourceProfile.source_binding.upload_profile_reference.schema_hash);
    assert.notEqual(candidate.profile_schema_hash, sourceBinding.upload_profile_reference.schema_hash);
    assert.equal(candidate.dispatch_allowed, false);
    assert.equal(candidate.backend_acceptance, "UNPROVEN");
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, PRINCIPAL, ATTEMPT), true);
    assert.equal(Object.getOwnPropertyDescriptor(candidate, "request")?.enumerable, false);
    assert.equal(Object.keys(candidate).includes("request"), false);
    const request = candidate.request as { prompt: string; settings: Record<string, unknown> };
    assert.equal(request.prompt, "a quiet studio");
    assert.deepEqual(Object.keys(request.settings), ["model_type", "aspect_ratio", "seed", "mode", "file_urls"]);
    assert.equal(request.settings.model_type, "uni-1");
    assert.equal(request.settings.seed, null);
    assert.deepEqual(request.settings.file_urls, [{ type: "image", url: "https://r2.syntx.ai/private/uni/preparer.jpg" }]);
    assert.equal(Object.hasOwn(request.settings, "n"), false);
    assert.equal(JSON.stringify(candidate).includes("r2.syntx.ai"), false);
    assert.equal(JSON.stringify(candidate).includes("uni-preparer-private-id"), false);
    assert.equal(JSON.stringify(candidate).includes(upload.reference_handle), false);
  } finally {
    await preparer.close();
    await uploadService.close();
  }
});

test("preserves all three Uni branches, allows zero Uni-1 references, orders Modify main first, and keeps BG1 without n/defaults", async () => {
  const preparerModule = await import(PREPARER_URL) as Record<string, unknown>;
  const Preparer = preparerModule.OwnerUniImageRequestPreparer as new (options: Record<string, unknown>) => {
    issue(input: unknown): Promise<Record<string, unknown>>;
    prepare(input: unknown): Promise<Record<string, unknown>>;
    close(): Promise<void>;
  };
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (_input, init) => {
    posts += 1;
    const form = init?.body as FormData;
    const file = form.get("files");
    assert.ok(file instanceof File);
    const model = String(form.get("model_type"));
    assert.ok(["uni-1", "uni-1.1-modify-image", "uni-1.1-remove-background"].includes(model));
    return Response.json({ files: [{ id: `uni-full-${posts}`, url: `https://r2.syntx.ai/private/uni/full-${posts}.jpg`,
      mime_type: file.type, size: file.size }] });
  } });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } };
  const uploadService = new OwnerUniImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const preparer = new Preparer({ binding: BINDING, linkService, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => NOW });
  const upload = async (attemptId: string, model_id: string, width: number) => uploadService.upload({
    attemptId, model_id, content_base64: jpegWithWidth(width).toString("base64"), filename: `branch-${width}.jpg`, mime_type: "image/jpeg"
  });
  try {
    const zeroAsset = await preparer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "uni-1",
      prompt: "zero reference is an explicit Uni-1 input", parameters: { aspect_ratio: "1:1", seed: 0, mode: "auto" },
      image_reference_handles: [], main_image_reference_handle: null });
    const zeroCandidate = await preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: zeroAsset });
    const zeroRequest = zeroCandidate.request as { prompt: string; settings: Record<string, unknown> };
    assert.equal(zeroAsset.reference_count, 0);
    assert.deepEqual(zeroRequest.settings.file_urls, []);
    assert.equal(zeroRequest.settings.seed, 0);
    assert.equal(Object.hasOwn(zeroRequest.settings, "n"), false);

    const first = await upload(ATTEMPT, "uni-1.1-modify-image", 2);
    const main = await upload(ATTEMPT, "uni-1.1-modify-image", 3);
    const modifyAsset = await preparer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "uni-1.1-modify-image",
      prompt: "modify while retaining the chosen main", parameters: { seed: null, mode: "manga" },
      image_reference_handles: [first.reference_handle, main.reference_handle], main_image_reference_handle: main.reference_handle });
    const modifyCandidate = await preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: modifyAsset });
    const modifyRequest = modifyCandidate.request as { prompt: string; settings: Record<string, unknown> };
    assert.deepEqual((modifyRequest.settings.file_urls as Array<{ url: string }>).map((item) => item.url), [
      "https://r2.syntx.ai/private/uni/full-2.jpg", "https://r2.syntx.ai/private/uni/full-1.jpg"
    ]);
    assert.deepEqual(Object.keys(modifyRequest.settings), ["model_type", "seed", "mode", "file_urls"]);
    assert.equal(modifyRequest.settings.seed, null);
    assert.equal(Object.hasOwn(modifyRequest.settings, "aspect_ratio"), false);
    assert.equal(Object.hasOwn(modifyRequest.settings, "n"), false);

    const background = await upload(ATTEMPT, "uni-1.1-remove-background", 4);
    const bgAsset = await preparer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "uni-1.1-remove-background",
      prompt: "", parameters: { invert_mask: true }, image_reference_handles: [background.reference_handle], main_image_reference_handle: null });
    const bgCandidate = await preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: bgAsset });
    const bgRequest = bgCandidate.request as { prompt: string; settings: Record<string, unknown> };
    assert.equal(bgRequest.prompt, "");
    assert.equal(bgAsset.reference_count, 1);
    assert.deepEqual(Object.keys(bgRequest.settings), ["model_type", "invert_mask", "file_urls"]);
    assert.equal(bgRequest.settings.invert_mask, true);
    assert.equal(Object.hasOwn(bgRequest.settings, "seed"), false);
    assert.equal(Object.hasOwn(bgRequest.settings, "n"), false);
    assert.equal(posts, 3);
  } finally {
    await preparer.close();
    await uploadService.close();
  }
});

test("rejects duplicate canonical owned URLs instead of silently dropping a selected Modify reference", async () => {
  const preparerModule = await import(PREPARER_URL) as Record<string, unknown>;
  const Preparer = preparerModule.OwnerUniImageRequestPreparer as new (options: Record<string, unknown>) => {
    issue(input: unknown): Promise<unknown>;
    close(): Promise<void>;
  };
  const PreparerError = preparerModule.OwnerUniImageRequestPrepareError as new (...args: never[]) => Error & { code: string };
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (_input, init) => {
    posts += 1;
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    return Response.json({ files: [{ id: `same-url-${posts}`, url: "https://r2.syntx.ai/private/uni/deduplicated.jpg",
      mime_type: file.type, size: file.size }] });
  } });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } };
  const uploadService = new OwnerUniImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const preparer = new Preparer({ binding: BINDING, linkService, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => NOW });
  try {
    const first = await uploadService.upload({ attemptId: ATTEMPT, model_id: "uni-1.1-modify-image",
      content_base64: jpegWithWidth(10).toString("base64"), filename: "first.jpg", mime_type: "image/jpeg" });
    const second = await uploadService.upload({ attemptId: ATTEMPT, model_id: "uni-1.1-modify-image",
      content_base64: jpegWithWidth(11).toString("base64"), filename: "second.jpg", mime_type: "image/jpeg" });
    assert.notEqual(first.reference_handle, second.reference_handle);
    await assert.rejects(preparer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "uni-1.1-modify-image",
      prompt: "two selected sources must not collapse", parameters: { seed: null, mode: "auto" },
      image_reference_handles: [first.reference_handle, second.reference_handle], main_image_reference_handle: first.reference_handle }),
      (error: unknown) => error instanceof PreparerError && error.code === "ASSET_UNAVAILABLE");
    assert.equal(posts, 2);
  } finally {
    await preparer.close();
    await uploadService.close();
  }
});

test("keeps asset sets and candidates nominal, principal-bound, expiring, and revocable", async () => {
  const preparerModule = await import(PREPARER_URL) as Record<string, unknown>;
  const Preparer = preparerModule.OwnerUniImageRequestPreparer as new (options: Record<string, unknown>) => {
    issue(input: unknown): Promise<Record<string, unknown>>;
    prepare(input: unknown): Promise<Record<string, unknown>>;
    isPreparedCandidateForPrincipal(candidate: unknown, principal: unknown, attemptId: unknown): boolean;
    invalidateAttempt(attemptId: string): Promise<void>;
    close(): Promise<void>;
  };
  const PreparerError = preparerModule.OwnerUniImageRequestPrepareError as new (...args: never[]) => Error & { code: string };
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (_input, init) => {
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    return Response.json({ files: [{ id: "uni-nominal", url: "https://r2.syntx.ai/private/uni/nominal.jpg",
      mime_type: file.type, size: file.size }] });
  } });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } };
  const uploadService = new OwnerUniImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const preparer = new Preparer({ binding: BINDING, linkService, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => NOW });
  const bytes = jpegWithWidth(21);
  try {
    const upload = await uploadService.upload({ attemptId: ATTEMPT, model_id: "uni-1", content_base64: bytes.toString("base64"),
      filename: "nominal.jpg", mime_type: "image/jpeg" });
    const assetSet = await preparer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "uni-1",
      prompt: "nominal candidate", parameters: { aspect_ratio: "1:1", seed: null, mode: "auto" },
      image_reference_handles: [upload.reference_handle], main_image_reference_handle: null });
    const candidate = await preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: assetSet });
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, PRINCIPAL, ATTEMPT), true);
    assert.equal(preparer.isPreparedCandidateForPrincipal({ ...candidate }, PRINCIPAL, ATTEMPT), false);
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, { ...PRINCIPAL, subject_id: "other" }, ATTEMPT), false);
    const otherAttempt = "link_uni_preparer_other_0000000000000001";
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate,
      { ...PRINCIPAL, connection_id: otherAttempt }, otherAttempt), false);
    await assert.rejects(preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: { ...assetSet } }),
      (error: unknown) => error instanceof PreparerError && error.code === "ASSET_UNAVAILABLE");
    await preparer.invalidateAttempt(ATTEMPT);
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, PRINCIPAL, ATTEMPT), false);
    await assert.rejects(preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: assetSet }),
      (error: unknown) => error instanceof PreparerError && error.code === "ASSET_UNAVAILABLE");
  } finally {
    await preparer.close();
    await uploadService.close();
  }
});

test("asset and candidate TTL is the earliest original upload expiry and cannot be renewed by prepare", async () => {
  const preparerModule = await import(PREPARER_URL) as Record<string, unknown>;
  const Preparer = preparerModule.OwnerUniImageRequestPreparer as new (options: Record<string, unknown>) => {
    issue(input: unknown): Promise<Record<string, unknown>>;
    prepare(input: unknown): Promise<Record<string, unknown>>;
    isPreparedCandidateForPrincipal(candidate: unknown, principal: unknown, attemptId: unknown): boolean;
    close(): Promise<void>;
  };
  const PreparerError = preparerModule.OwnerUniImageRequestPrepareError as new (...args: never[]) => Error & { code: string };
  let now = NOW;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (_input, init) => {
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    return Response.json({ files: [{ id: "uni-original-expiry", url: "https://r2.syntx.ai/private/uni/original-expiry.jpg",
      mime_type: file.type, size: file.size }] });
  } });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } };
  const uploadService = new OwnerUniImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => now });
  const preparer = new Preparer({ binding: BINDING, linkService, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => now });
  try {
    const bytes = jpegWithWidth(31);
    const upload = await uploadService.upload({ attemptId: ATTEMPT, model_id: "uni-1", content_base64: bytes.toString("base64"),
      filename: "ttl.jpg", mime_type: "image/jpeg" });
    now += 10 * 60_000;
    const assetSet = await preparer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "uni-1",
      prompt: "preserve original reference TTL", parameters: { aspect_ratio: "1:1", seed: null, mode: "auto" },
      image_reference_handles: [upload.reference_handle], main_image_reference_handle: null });
    const candidate = await preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: assetSet });
    assert.equal(assetSet.expires_at, NOW + 15 * 60_000);
    assert.equal(candidate.expires_at, NOW + 15 * 60_000);
    now = NOW + 15 * 60_000 - 1;
    const rechecked = await preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: assetSet });
    assert.equal(rechecked, candidate);
    assert.equal(rechecked.expires_at, NOW + 15 * 60_000);
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, PRINCIPAL, ATTEMPT), true);
    now = NOW + 15 * 60_000;
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, PRINCIPAL, ATTEMPT), false);
    await assert.rejects(preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: assetSet }),
      (error: unknown) => error instanceof PreparerError && error.code === "ASSET_EXPIRED");
  } finally {
    await preparer.close();
    await uploadService.close();
  }
});

test("rechecks the full generation profile and actual uploader binding after candidate issuance", async () => {
  const preparerModule = await import(PREPARER_URL) as Record<string, unknown>;
  const Preparer = preparerModule.OwnerUniImageRequestPreparer as new (options: Record<string, unknown>) => {
    issue(input: unknown): Promise<Record<string, unknown>>;
    prepare(input: unknown): Promise<Record<string, unknown>>;
    isPreparedCandidateForPrincipal(candidate: unknown, principal: unknown, attemptId: unknown): boolean;
    close(): Promise<void>;
  };
  const PreparerError = preparerModule.OwnerUniImageRequestPrepareError as new (...args: never[]) => Error & { code: string };
  let drift = false;
  const catalog = {
    getModel(modelId: string) {
      const record = CATALOG.getModel(modelId);
      return drift ? { ...record, description: "selected Uni model drifted" } : record;
    },
    catalog_kind: CATALOG.catalog_kind, runtime_usable: CATALOG.runtime_usable, fetched_at: CATALOG.fetched_at,
    source_hashes: CATALOG.source_hashes, catalog_metadata: CATALOG.catalog_metadata
  };
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (_input, init) => {
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    return Response.json({ files: [{ id: "uni-source-drift", url: "https://r2.syntx.ai/private/uni/source-drift.jpg",
      mime_type: file.type, size: file.size }] });
  } });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } };
  const uploadService = new OwnerUniImageUploadService({ binding: BINDING, linkService, catalog,
    catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const preparer = new Preparer({ binding: BINDING, linkService, imageUploadService: uploadService,
    catalog, catalog_version: CATALOG_VERSION, now: () => NOW });
  try {
    const bytes = jpegWithWidth(41);
    const upload = await uploadService.upload({ attemptId: ATTEMPT, model_id: "uni-1", content_base64: bytes.toString("base64"),
      filename: "source-drift.jpg", mime_type: "image/jpeg" });
    const assetSet = await preparer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "uni-1",
      prompt: "reject stale source binding", parameters: { aspect_ratio: "1:1", seed: null, mode: "auto" },
      image_reference_handles: [upload.reference_handle], main_image_reference_handle: null });
    const candidate = await preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: assetSet });
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, PRINCIPAL, ATTEMPT), true);
    drift = true;
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, PRINCIPAL, ATTEMPT), false);
    await assert.rejects(preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: assetSet }),
      (error: unknown) => error instanceof PreparerError && error.code === "PROFILE_BINDING_MISMATCH");
  } finally {
    await preparer.close();
    await uploadService.close();
  }
});

test("binds Uni-1 0–9 and Modify 1–8 owned references, preserves main-first order, and rejects overrange before re-resolution", async () => {
  const preparerModule = await import(PREPARER_URL) as Record<string, unknown>;
  const Preparer = preparerModule.OwnerUniImageRequestPreparer as new (options: Record<string, unknown>) => {
    issue(input: unknown): Promise<Record<string, unknown>>;
    prepare(input: unknown): Promise<Record<string, unknown>>;
    close(): Promise<void>;
  };
  const PreparerError = preparerModule.OwnerUniImageRequestPrepareError as new (...args: never[]) => Error & { code: string };
  let posts = 0, linkReads = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (_input, init) => {
    posts += 1;
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    return Response.json({ files: [{ id: `uni-eight-${posts}`, url: `https://r2.syntx.ai/private/uni/eight-${posts}.jpg`,
      mime_type: file.type, size: file.size }] });
  } });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { linkReads += 1; return linkedAttempt(attemptId); } };
  const uploadService = new OwnerUniImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const preparer = new Preparer({ binding: BINDING, linkService, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => NOW });
  try {
    const receipts = [];
    for (let index = 1; index <= 9; index += 1) receipts.push(await uploadService.upload({ attemptId: ATTEMPT,
      model_id: "uni-1.1-modify-image", content_base64: jpegWithWidth(100 + index).toString("base64"),
      filename: `modify-${index}.jpg`, mime_type: "image/jpeg" }));
    const handles = receipts.slice(0, 8).map((receipt) => receipt.reference_handle);
    const main = handles[7]!;
    const assetSet = await preparer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "uni-1.1-modify-image",
      prompt: "preserve all eight ordered selections", parameters: { seed: 2147483647, mode: "auto" },
      image_reference_handles: handles, main_image_reference_handle: main });
    const candidate = await preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: assetSet });
    const request = candidate.request as { prompt: string; settings: Record<string, unknown> };
    assert.equal(candidate.reference_count, 8);
    assert.equal(assetSet.reference_count, 8);
    assert.deepEqual((request.settings.file_urls as Array<{ url: string }>).map((item) => item.url), [
      "https://r2.syntx.ai/private/uni/eight-8.jpg", ...Array.from({ length: 7 }, (_, index) =>
        `https://r2.syntx.ai/private/uni/eight-${index + 1}.jpg`)
    ]);
    const beforeInvalidNinth = linkReads;
    await assert.rejects(preparer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "uni-1.1-modify-image",
      prompt: "the ninth selected reference is outside the source range", parameters: { seed: null, mode: "auto" },
      image_reference_handles: receipts.map((receipt) => receipt.reference_handle), main_image_reference_handle: main }),
      (error: unknown) => error instanceof PreparerError && error.code === "PARAMETERS_INVALID");
    assert.equal(linkReads, beforeInvalidNinth, "source-range validation precedes owner-reference re-resolution");

    const uniReceipts = [];
    for (let index = 1; index <= 10; index += 1) uniReceipts.push(await uploadService.upload({ attemptId: ATTEMPT,
      model_id: "uni-1", content_base64: jpegWithWidth(200 + index).toString("base64"),
      filename: `uni-${index}.jpg`, mime_type: "image/jpeg" }));
    const uniHandles = uniReceipts.slice(0, 9).map((receipt) => receipt.reference_handle);
    const uniAsset = await preparer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "uni-1",
      prompt: "bind all nine selected source references", parameters: { aspect_ratio: "1:1", seed: null, mode: "auto" },
      image_reference_handles: uniHandles, main_image_reference_handle: null });
    const uniCandidate = await preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: uniAsset });
    const uniRequest = uniCandidate.request as { prompt: string; settings: Record<string, unknown> };
    assert.equal(uniAsset.reference_count, 9);
    assert.equal(uniCandidate.reference_count, 9);
    assert.equal((uniRequest.settings.file_urls as Array<unknown>).length, 9);
    const beforeInvalidTenth = linkReads;
    await assert.rejects(preparer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "uni-1",
      prompt: "the tenth selected reference is outside the source range", parameters: { aspect_ratio: "1:1", seed: null, mode: "auto" },
      image_reference_handles: uniReceipts.map((receipt) => receipt.reference_handle), main_image_reference_handle: null }),
      (error: unknown) => error instanceof PreparerError && error.code === "PARAMETERS_INVALID");
    assert.equal(linkReads, beforeInvalidTenth);
    assert.equal(posts, 19);
  } finally {
    await preparer.close();
    await uploadService.close();
  }
});

test("round-trips all Uni-1 auto and manga ratios plus explicit seed values without injecting defaults", async () => {
  const preparerModule = await import(PREPARER_URL) as Record<string, unknown>;
  const Preparer = preparerModule.OwnerUniImageRequestPreparer as new (options: Record<string, unknown>) => {
    issue(input: unknown): Promise<Record<string, unknown>>;
    prepare(input: unknown): Promise<Record<string, unknown>>;
    close(): Promise<void>;
  };
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    posts += 1;
    throw new Error("zero-reference Uni-1 tests must not upload");
  } });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } };
  const uploadService = new OwnerUniImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const preparer = new Preparer({ binding: BINDING, linkService, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => NOW });
  const cases = [
    ...["3:1", "2:1", "16:9", "3:2", "1:1", "4:3", "2:3", "3:4", "9:16", "1:2", "1:3"].map((aspect_ratio) =>
      ({ aspect_ratio, mode: "auto", seed: null })),
    ...["9:16", "2:3", "1:2", "1:3"].map((aspect_ratio) => ({ aspect_ratio, mode: "manga", seed: 2_147_483_647 }))
  ];
  try {
    let index = 0;
    for (const parameters of cases) {
      index += 1;
      const assetSet = await preparer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "uni-1",
        prompt: `explicit Uni ratio ${index}`, parameters, image_reference_handles: [], main_image_reference_handle: null });
      const candidate = await preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: assetSet });
      const request = candidate.request as { prompt: string; settings: Record<string, unknown> };
      assert.deepEqual(candidate.parameters, parameters);
      assert.equal(request.settings.aspect_ratio, parameters.aspect_ratio);
      assert.equal(request.settings.mode, parameters.mode);
      assert.equal(request.settings.seed, parameters.seed);
      assert.equal(Object.hasOwn(request.settings, "n"), false);
      assert.deepEqual(candidate.cost_inputs, {});
    }
    assert.equal(posts, 0);
  } finally {
    await preparer.close();
    await uploadService.close();
  }
});

test("requires the actual nominal Task800 uploader class instead of accepting a resolver callback façade", async () => {
  const preparerModule = await import(PREPARER_URL) as Record<string, unknown>;
  const Preparer = preparerModule.OwnerUniImageRequestPreparer as new (options: Record<string, unknown>) => unknown;
  const PreparerError = preparerModule.OwnerUniImageRequestPrepareError as new (...args: never[]) => Error & { code: string };
  let resolverCalls = 0;
  const fakeUploader = {
    async resolveReference() { resolverCalls += 1; return Object.freeze({ provenance_verified: true }); },
    isOwnedReferenceResolution() { resolverCalls += 1; return true; },
    async invalidateAttempt() { resolverCalls += 1; }
  };
  assert.throws(() => new Preparer({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    imageUploadService: fakeUploader, catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => NOW }),
    (error: unknown) => error instanceof PreparerError && error.code === "PROFILE_BINDING_MISMATCH");
  assert.equal(resolverCalls, 0);
});

test("close aborts and drains an in-flight actual Task800 reference revalidation", async () => {
  const preparerModule = await import(PREPARER_URL) as Record<string, unknown>;
  const Preparer = preparerModule.OwnerUniImageRequestPreparer as new (options: Record<string, unknown>) => {
    issue(input: unknown): Promise<unknown>;
    close(): Promise<void>;
  };
  let statusReads = 0, signalResolutionStarted!: () => void, releaseStatus!: (value: ReturnType<typeof linkedAttempt>) => void;
  const started = new Promise<void>((resolve) => { signalResolutionStarted = resolve; });
  const heldStatus = new Promise<ReturnType<typeof linkedAttempt>>((resolve) => { releaseStatus = resolve; });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) {
    statusReads += 1;
    if (statusReads === 4) { signalResolutionStarted(); return heldStatus; }
    return linkedAttempt(attemptId);
  } };
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (_input, init) => {
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    return Response.json({ files: [{ id: "uni-close-drain", url: "https://r2.syntx.ai/private/uni/close-drain.jpg",
      mime_type: file.type, size: file.size }] });
  } });
  const uploadService = new OwnerUniImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const preparer = new Preparer({ binding: BINDING, linkService, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => NOW });
  const bytes = jpegWithWidth(51);
  try {
    const upload = await uploadService.upload({ attemptId: ATTEMPT, model_id: "uni-1", content_base64: bytes.toString("base64"),
      filename: "close-drain.jpg", mime_type: "image/jpeg" });
    const pendingIssue = preparer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "uni-1",
      prompt: "drain after close", parameters: { aspect_ratio: "1:1", seed: null, mode: "auto" },
      image_reference_handles: [upload.reference_handle], main_image_reference_handle: null });
    await started;
    await preparer.close();
    releaseStatus(linkedAttempt(ATTEMPT));
    await assert.rejects(pendingIssue);
    assert.equal(statusReads, 4);
  } finally {
    releaseStatus(linkedAttempt(ATTEMPT));
    await preparer.close();
    await uploadService.close();
  }
});
