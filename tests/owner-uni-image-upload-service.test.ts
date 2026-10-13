import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { syntxPublicCatalogSnapshotSchema } from "../src/catalog/syntx-public-catalog.js";

const BINDING = Object.freeze({ tenant_id: "uni-upload-tenant", subject: "uni-upload-subject" });
const NOW = Date.parse("2026-10-11T00:00:00.000Z");
const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const CATALOG = new DiscoveryCatalogRepository(syntxPublicCatalogSnapshotSchema.parse(JSON.parse(readFileSync(
  join(process.cwd(), "catalog/public", CATALOG_VERSION), "utf8"
))));
const SERVICE_URL = new URL("../src/application/owner-uni-image-upload-service.js", import.meta.url).href;
const PROFILE_URL = new URL("../src/catalog/owner-uni-image-upload-profile.js", import.meta.url).href;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const JPEG = Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x0b,0x08,0x00,0x01,0x00,0x01,0x01,0x01,0x11,0x00,0xff,0xda,0x00,0x08,0x01,0x01,0x00,0x00,0x3f,0x00,0x00,0xff,0xd9]);
const WEBP = Buffer.from([0x52,0x49,0x46,0x46,0x12,0,0,0,0x57,0x45,0x42,0x50,0x56,0x50,0x38,0x4c,5,0,0,0,0x2f,0,0,0,0,0]);
const AVIF = Buffer.from("AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAkAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAQAAAAEAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAsbWRhdAoKAAAAAZ/41fIAgDIWEACXgBBAggAAEABcEytNbG+TY8nR6A==", "base64");
const MODELS = ["uni-1", "uni-1.1-modify-image", "uni-1.1-remove-background"] as const;
const MIME_CASES = [
  { bytes: JPEG, sourceMime: "image/jpeg", wireMime: "image/jpeg" },
  { bytes: JPEG, sourceMime: "image/jpg", wireMime: "image/jpeg" },
  { bytes: PNG, sourceMime: "image/png", wireMime: "image/png" },
  { bytes: WEBP, sourceMime: "image/webp", wireMime: "image/webp" },
  { bytes: AVIF, sourceMime: "image/avif", wireMime: "image/avif" }
] as const;

function jpegWithWidth(width: number): Buffer {
  assert.ok(Number.isInteger(width) && width > 0 && width <= 65_535);
  const bytes = Buffer.from(JPEG);
  bytes.writeUInt16BE(width, 9);
  return bytes;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100 && !predicate(); index += 1) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(predicate(), true, "bounded wait did not reach expected state");
}

function credentialBroker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    return operation("synthetic-uni-upload-credential");
  } };
}

function linkedAttempt(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: null, linked: true };
}

test("uploads all three reviewed Uni models and five declared MIME labels through the actual client, then issues nominal profile-bound references", async () => {
  let serviceModule: Record<string, unknown> | undefined;
  try { serviceModule = await import(SERVICE_URL) as Record<string, unknown>; } catch { /* Expected first RED until the service is implemented. */ }
  assert.equal(typeof serviceModule?.OwnerUniImageUploadService, "function", "MISSING_OWNER_UNI_IMAGE_UPLOAD_SERVICE");
  const profileModule = await import(PROFILE_URL) as Record<string, unknown>;
  assert.equal(typeof profileModule.getOwnerUniImageUploadProfile, "function", "MISSING_OWNER_UNI_IMAGE_UPLOAD_PROFILE");
  const Service = serviceModule!.OwnerUniImageUploadService as new (options: Record<string, unknown>) => {
    upload(input: unknown): Promise<Record<string, unknown>>;
    resolveReference(context: unknown): Promise<Record<string, unknown>>;
    isOwnedReferenceResolution(value: unknown, context: unknown): boolean;
    invalidateAttempt(attemptId: string): Promise<void>;
    close(): Promise<void>;
  };
  const getProfile = profileModule.getOwnerUniImageUploadProfile as (model: string, catalog: unknown, version: string) => Record<string, unknown>;
  const profiles = new Map(MODELS.map((model) => [model, getProfile(model, CATALOG, CATALOG_VERSION)]));
  const observed: Array<{ model: string; mime: string; bytes: Buffer }> = [];
  let linkReads = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (input, init) => {
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    const form = init?.body as FormData;
    assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(form.get("destination"), "uploaded");
    assert.equal(form.get("check_duplicates"), "true");
    const file = form.get("files");
    assert.ok(file instanceof File);
    const model = String(form.get("model_type"));
    const expected = MIME_CASES[observed.length % MIME_CASES.length]!;
    assert.ok(profiles.has(model as typeof MODELS[number]));
    assert.equal(file.type, expected.wireMime);
    const bytes = Buffer.from(await file.arrayBuffer());
    assert.deepEqual(bytes, expected.bytes);
    observed.push({ model, mime: file.type, bytes });
    return Response.json({ files: [{ id: `uni-private-id-${observed.length}`,
      url: `https://r2.syntx.ai/private/uni/object-${observed.length}.img`, mime_type: file.type, size: file.size }] });
  } });
  const service = new Service({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { linkReads += 1; return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  try {
    let number = 0;
    for (const model of MODELS) for (const item of MIME_CASES) {
      number += 1;
      const attemptId = `link_uni_upload_${String(number).padStart(20, "0")}`;
      const receipt = await service.upload({ attemptId, model_id: model, content_base64: item.bytes.toString("base64"),
        filename: `source-${number}.img`, mime_type: item.sourceMime });
      assert.equal(receipt.status, "uploaded");
      assert.equal(receipt.model_id, model);
      assert.match(String(receipt.reference_handle), /^uni_image_[0-9a-f-]{36}$/u);
      assert.equal(receipt.source_mime_type, item.sourceMime);
      assert.equal(receipt.mime_type, item.wireMime);
      assert.equal(receipt.size, item.bytes.byteLength);
      assert.equal(receipt.sha256, `sha256:${createHash("sha256").update(item.bytes).digest("hex")}`);
      assert.equal(receipt.expires_in_seconds, 900);
      assert.equal(linkReads, (number - 1) * 3 + 2, "upload must re-check the currently linked principal after the native response");
      for (const privateValue of ["r2.syntx.ai", "uni-private-id-", `source-${number}.img`, BINDING.subject]) {
        assert.equal(JSON.stringify(receipt).includes(privateValue), false);
      }
      const profile = profiles.get(model)!;
      const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: attemptId };
      const context = { principal, attempt_id: attemptId, model_id: model, ai_name: "luma_image", scope: "image",
        operation_id: "upload-image-reference", catalog_version: CATALOG_VERSION,
        upload_profile_schema_hash: profile.upload_profile_schema_hash, reference_handle: receipt.reference_handle };
      const resolution = await service.resolveReference(context);
      assert.equal(linkReads, number * 3, "reference resolution must re-check the current linked principal");
      assert.equal(resolution.reference_handle, receipt.reference_handle);
      assert.equal(resolution.attempt_id, attemptId);
      assert.equal(resolution.canonical_url, `https://r2.syntx.ai/private/uni/object-${number}.img`);
      assert.equal(service.isOwnedReferenceResolution(resolution, context), true);
      assert.equal(service.isOwnedReferenceResolution({ ...resolution }, context), false);
      await service.invalidateAttempt(attemptId);
      assert.equal(service.isOwnedReferenceResolution(resolution, context), false);
    }
    assert.equal(observed.length, MODELS.length * MIME_CASES.length);
  } finally { await service.close(); }
});

test("maps malformed resolver principals to the service error contract before link lookup or client access", async () => {
  const serviceModule = await import(SERVICE_URL) as Record<string, unknown>;
  const Service = serviceModule.OwnerUniImageUploadService as new (options: Record<string, unknown>) => {
    resolveReference(context: unknown): Promise<unknown>;
    close(): Promise<void>;
  };
  const ServiceError = serviceModule.OwnerUniImageUploadServiceError as new (...args: never[]) => Error & { code: string };
  let linkReads = 0, clientResolutions = 0;
  const service = new Service({ binding: BINDING,
    linkService: { async getStatus() { linkReads += 1; return linkedAttempt("link_uni_malformed_00000000000000000001"); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION,
    resolveClient() { clientResolutions += 1; throw new Error("must not resolve client"); }, now: () => NOW });
  try {
    const context = { principal: new Proxy({}, {}), attempt_id: "link_uni_malformed_00000000000000000001",
      model_id: "uni-1", ai_name: "luma_image", scope: "image", operation_id: "upload-image-reference",
      catalog_version: CATALOG_VERSION, upload_profile_schema_hash: `sha256:${"a".repeat(64)}`,
      reference_handle: `uni_image_${"0".repeat(8)}-${"0".repeat(4)}-${"0".repeat(4)}-${"0".repeat(4)}-${"0".repeat(12)}` };
    await assert.rejects(service.resolveReference(context), (error: unknown) =>
      error instanceof ServiceError && error.code === "INVALID_REQUEST");
    assert.equal(linkReads, 0);
    assert.equal(clientResolutions, 0);
  } finally { await service.close(); }
});

test("keeps post-outcome-unknown content holds across attempt invalidation and never evicts the 128th semantic hold", async () => {
  const serviceModule = await import(SERVICE_URL) as Record<string, unknown>;
  const Service = serviceModule.OwnerUniImageUploadService as new (options: Record<string, unknown>) => {
    upload(input: unknown): Promise<unknown>;
    invalidateAttempt(attemptId: string): Promise<void>;
    close(): Promise<void>;
  };
  const ServiceError = serviceModule.OwnerUniImageUploadServiceError as new (...args: never[]) => Error & { code: string };
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    posts += 1;
    return Response.json({ files: [] });
  } });
  const service = new Service({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const expectedError = (code: string) => (error: unknown) => error instanceof ServiceError && error.code === code;
  const attemptId = (number: number) => `link_uni_unknown_${String(number).padStart(20, "0")}`;
  const upload = (number: number, width: number, filename = `unknown-${number}.jpg`) => {
    const bytes = jpegWithWidth(width);
    return service.upload({ attemptId: attemptId(number), model_id: "uni-1", content_base64: bytes.toString("base64"), filename, mime_type: "image/jpeg" });
  };
  try {
    await assert.rejects(upload(1, 1), expectedError("UPLOAD_OUTCOME_UNKNOWN"));
    await service.invalidateAttempt(attemptId(1));
    await assert.rejects(upload(2, 1, "renamed.jpg"), expectedError("UPLOAD_OUTCOME_UNKNOWN"));
    assert.equal(posts, 1, "stable decoded SHA must hold across filename and relink nonce");
    for (let width = 2; width <= 128; width += 1) {
      await assert.rejects(upload(width + 1, width), expectedError("UPLOAD_OUTCOME_UNKNOWN"));
    }
    assert.equal(posts, 128);
    await assert.rejects(upload(130, 129), expectedError("CAPACITY_EXCEEDED"));
    assert.equal(posts, 128, "the capacity refusal must happen before a new native POST");
  } finally { await service.close(); }
});

test("returns same-attempt success cache with the original expiry, then permits a fresh upload after expiry", async () => {
  const serviceModule = await import(SERVICE_URL) as Record<string, unknown>;
  const Service = serviceModule.OwnerUniImageUploadService as new (options: Record<string, unknown>) => {
    upload(input: unknown): Promise<Record<string, unknown>>;
    close(): Promise<void>;
  };
  let now = NOW, posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (_input, init) => {
    posts += 1;
    const form = init?.body as FormData;
    const file = form.get("files");
    assert.ok(file instanceof File);
    return Response.json({ files: [{ id: `uni-cache-${posts}`, url: `https://r2.syntx.ai/private/uni/cache-${posts}.jpg`,
      mime_type: file.type, size: file.size }] });
  } });
  const service = new Service({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => now });
  const bytes = Buffer.from(JPEG);
  const input = (mime_type: string, filename: string) => ({ attemptId: "link_uni_cache_00000000000000000001",
    model_id: "uni-1", content_base64: bytes.toString("base64"), filename, mime_type });
  try {
    const original = await service.upload(input("image/jpeg", "original.jpg"));
    now += 15 * 60_000 - 1_000;
    const cached = await service.upload(input("image/jpg", "renamed.jpg"));
    assert.equal(posts, 1);
    assert.equal(cached.reference_handle, original.reference_handle);
    assert.equal(cached.expires_in_seconds, 1, "cache reuse must not renew the original 15-minute expiry");
    now += 1_000;
    const refreshed = await service.upload(input("image/jpeg", "expired-again.jpg"));
    assert.equal(posts, 2);
    assert.notEqual(refreshed.reference_handle, original.reference_handle);
    assert.equal(refreshed.expires_in_seconds, 900);
  } finally { await service.close(); }
});

test("bounds concurrent native uploads and close aborts and drains all in-flight operations", async () => {
  const serviceModule = await import(SERVICE_URL) as Record<string, unknown>;
  const Service = serviceModule.OwnerUniImageUploadService as new (options: Record<string, unknown>) => {
    upload(input: unknown): Promise<unknown>;
    close(): Promise<void>;
  };
  const ServiceError = serviceModule.OwnerUniImageUploadServiceError as new (...args: never[]) => Error & { code: string };
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: (_input, init) => {
    posts += 1;
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      const abort = () => reject(signal?.reason ?? new Error("synthetic abort"));
      if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
    });
  } });
  const service = new Service({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const makeInput = (number: number) => {
    const bytes = jpegWithWidth(number);
    return { attemptId: `link_uni_pending_${String(number).padStart(20, "0")}`, model_id: "uni-1",
      content_base64: bytes.toString("base64"), filename: `pending-${number}.jpg`, mime_type: "image/jpeg" };
  };
  try {
    const pending = Array.from({ length: 4 }, (_, index) => service.upload(makeInput(index + 1)));
    await waitFor(() => posts === 4);
    await assert.rejects(service.upload(makeInput(5)), (error: unknown) =>
      error instanceof ServiceError && error.code === "SERVICE_BUSY");
    assert.equal(posts, 4);
    await service.close();
    const results = await Promise.allSettled(pending);
    assert.equal(results.length, 4);
    for (const result of results) assert.equal(result.status, "rejected");
    await assert.rejects(service.upload(makeInput(6)), (error: unknown) =>
      error instanceof ServiceError && error.code === "SERVICE_CLOSED");
    assert.equal(posts, 4);
  } finally { await service.close(); }
});

test("rejects caller URLs, authority extras, accessors, and overridden native methods before credential use", async () => {
  const serviceModule = await import(SERVICE_URL) as Record<string, unknown>;
  const Service = serviceModule.OwnerUniImageUploadService as new (options: Record<string, unknown>) => {
    upload(input: unknown): Promise<unknown>;
    close(): Promise<void>;
  };
  const ServiceError = serviceModule.OwnerUniImageUploadServiceError as new (...args: never[]) => Error & { code: string };
  let linkReads = 0, clientResolutions = 0, credentialCalls = 0, posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      credentialCalls += 1; return operation("synthetic-uni-credential");
    }
  }, fetchImpl: async () => { posts += 1; return Response.json({ files: [] }); } });
  Object.defineProperty(client, "uploadUniImageReference", { enumerable: false, value: async () => ({ url: "https://r2.syntx.ai/forged" }) });
  const service = new Service({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { linkReads += 1; return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient() { clientResolutions += 1; return client; }, now: () => NOW });
  const bytes = Buffer.from(JPEG);
  const input = { attemptId: "link_uni_override_00000000000000000001", model_id: "uni-1",
    content_base64: bytes.toString("base64"), filename: "source.jpg", mime_type: "image/jpeg" };
  try {
    await assert.rejects(service.upload({ ...input, url: "https://r2.syntx.ai/caller-url" }), (error: unknown) =>
      error instanceof ServiceError && error.code === "INVALID_REQUEST");
    let getterCalls = 0;
    const accessorInput = Object.defineProperties({}, {
      attemptId: { enumerable: true, value: input.attemptId }, model_id: { enumerable: true, value: input.model_id },
      content_base64: { enumerable: true, get() { getterCalls += 1; return input.content_base64; } },
      filename: { enumerable: true, value: input.filename }, mime_type: { enumerable: true, value: input.mime_type }
    });
    await assert.rejects(service.upload(accessorInput), (error: unknown) => error instanceof ServiceError && error.code === "INVALID_REQUEST");
    assert.equal(getterCalls, 0);
    await assert.rejects(service.upload(input), (error: unknown) => error instanceof ServiceError && error.code === "PROFILE_BINDING_MISMATCH");
    assert.equal(linkReads, 1);
    assert.equal(clientResolutions, 1);
    assert.equal(credentialCalls, 0);
    assert.equal(posts, 0);
  } finally { await service.close(); }
});

test("reports an expired owned handle as expired instead of indistinguishable from an unknown handle", async () => {
  const serviceModule = await import(SERVICE_URL) as Record<string, unknown>;
  const profileModule = await import(PROFILE_URL) as Record<string, unknown>;
  const Service = serviceModule.OwnerUniImageUploadService as new (options: Record<string, unknown>) => {
    upload(input: unknown): Promise<Record<string, unknown>>;
    resolveReference(context: unknown): Promise<unknown>;
    close(): Promise<void>;
  };
  const ServiceError = serviceModule.OwnerUniImageUploadServiceError as new (...args: never[]) => Error & { code: string };
  const getProfile = profileModule.getOwnerUniImageUploadProfile as (model: string, catalog: unknown, version: string) => Record<string, unknown>;
  let now = NOW;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (_input, init) => {
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    return Response.json({ files: [{ id: "uni-expiry-id", url: "https://r2.syntx.ai/private/uni/expiry.jpg", mime_type: file.type, size: file.size }] });
  } });
  const service = new Service({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => now });
  const attemptId = "link_uni_expiry_00000000000000000001";
  const bytes = Buffer.from(JPEG);
  try {
    const receipt = await service.upload({ attemptId, model_id: "uni-1", content_base64: bytes.toString("base64"),
      filename: "expiry.jpg", mime_type: "image/jpeg" });
    const profile = getProfile("uni-1", CATALOG, CATALOG_VERSION);
    const context = { principal: { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: attemptId },
      attempt_id: attemptId, model_id: "uni-1", ai_name: "luma_image", scope: "image", operation_id: "upload-image-reference",
      catalog_version: CATALOG_VERSION, upload_profile_schema_hash: profile.upload_profile_schema_hash,
      reference_handle: receipt.reference_handle };
    now += 15 * 60_000;
    await assert.rejects(service.resolveReference(context), (error: unknown) =>
      error instanceof ServiceError && error.code === "REFERENCE_EXPIRED");
  } finally { await service.close(); }
});

test("turns a principal change detected after native upload into an unknown hold without retry", async () => {
  const serviceModule = await import(SERVICE_URL) as Record<string, unknown>;
  const Service = serviceModule.OwnerUniImageUploadService as new (options: Record<string, unknown>) => {
    upload(input: unknown): Promise<unknown>;
    close(): Promise<void>;
  };
  const ServiceError = serviceModule.OwnerUniImageUploadServiceError as new (...args: never[]) => Error & { code: string };
  let posts = 0, linkReads = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (_input, init) => {
    posts += 1;
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    return Response.json({ files: [{ id: `uni-principal-${posts}`, url: `https://r2.syntx.ai/private/uni/principal-${posts}.jpg`,
      mime_type: file.type, size: file.size }] });
  } });
  const attemptOne = "link_uni_principal_00000000000000000001";
  const service = new Service({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) {
      linkReads += 1;
      if (linkReads === 2) return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED",
        status: "UNLINKED", expires_at: null, linked: false };
      return linkedAttempt(attemptId);
    } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const bytes = Buffer.from(JPEG);
  const upload = (attemptId: string) => service.upload({ attemptId, model_id: "uni-1",
    content_base64: bytes.toString("base64"), filename: "principal-change.jpg", mime_type: "image/jpeg" });
  try {
    await assert.rejects(upload(attemptOne), (error: unknown) =>
      error instanceof ServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    await assert.rejects(upload("link_uni_principal_00000000000000000002"), (error: unknown) =>
      error instanceof ServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts, 1, "a fresh attempt nonce must not bypass the uncertain upload hold");
  } finally { await service.close(); }
});

test("does not leave a known-success cache behind if the receipt clock fails after the native POST", async () => {
  const serviceModule = await import(SERVICE_URL) as Record<string, unknown>;
  const Service = serviceModule.OwnerUniImageUploadService as new (options: Record<string, unknown>) => {
    upload(input: unknown): Promise<unknown>;
    close(): Promise<void>;
  };
  const ServiceError = serviceModule.OwnerUniImageUploadServiceError as new (...args: never[]) => Error & { code: string };
  let posts = 0, clockReads = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (_input, init) => {
    posts += 1;
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    return Response.json({ files: [{ id: `uni-clock-${posts}`, url: `https://r2.syntx.ai/private/uni/clock-${posts}.jpg`,
      mime_type: file.type, size: file.size }] });
  } });
  const service = new Service({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client,
    now: () => { clockReads += 1; return clockReads === 3 ? NOW - 1 : NOW; } });
  const bytes = Buffer.from(JPEG);
  const input = { attemptId: "link_uni_clock_00000000000000000001", model_id: "uni-1",
    content_base64: bytes.toString("base64"), filename: "clock.jpg", mime_type: "image/jpeg" };
  try {
    await assert.rejects(service.upload(input), (error: unknown) =>
      error instanceof ServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    await assert.rejects(service.upload(input), (error: unknown) =>
      error instanceof ServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts, 1, "clock failure after native dispatch must retain unknown semantics, not a cached grant");
  } finally { await service.close(); }
});

test("keeps owned-resolution authority nominal and rejects foreign, altered, expired, and revoked contexts", async () => {
  const serviceModule = await import(SERVICE_URL) as Record<string, unknown>;
  const profileModule = await import(PROFILE_URL) as Record<string, unknown>;
  const Service = serviceModule.OwnerUniImageUploadService as new (options: Record<string, unknown>) => {
    upload(input: unknown): Promise<Record<string, unknown>>;
    resolveReference(context: unknown): Promise<Record<string, unknown>>;
    isOwnedReferenceResolution(value: unknown, context: unknown): boolean;
    invalidateAttempt(attemptId: string): Promise<void>;
    close(): Promise<void>;
  };
  const getProfile = profileModule.getOwnerUniImageUploadProfile as (model: string, catalog: unknown, version: string) => Record<string, unknown>;
  let now = NOW, posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (_input, init) => {
    posts += 1;
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    return Response.json({ files: [{ id: `uni-brand-${posts}`, url: `https://r2.syntx.ai/private/uni/brand-${posts}.jpg`,
      mime_type: file.type, size: file.size }] });
  } });
  const options = { binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => now };
  const owner = new Service(options), foreign = new Service(options);
  const attemptId = "link_uni_brand_00000000000000000001";
  const bytes = Buffer.from(JPEG);
  try {
    const receipt = await owner.upload({ attemptId, model_id: "uni-1", content_base64: bytes.toString("base64"),
      filename: "brand.jpg", mime_type: "image/jpeg" });
    const profile = getProfile("uni-1", CATALOG, CATALOG_VERSION);
    const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: attemptId };
    const context = { principal, attempt_id: attemptId, model_id: "uni-1", ai_name: "luma_image", scope: "image",
      operation_id: "upload-image-reference", catalog_version: CATALOG_VERSION,
      upload_profile_schema_hash: profile.upload_profile_schema_hash, reference_handle: receipt.reference_handle };
    const resolution = await owner.resolveReference(context);
    assert.equal(owner.isOwnedReferenceResolution(resolution, context), true);
    assert.equal(foreign.isOwnedReferenceResolution(resolution, context), false);
    assert.equal(owner.isOwnedReferenceResolution({ ...resolution }, context), false);
    assert.equal(owner.isOwnedReferenceResolution(resolution, { ...context,
      principal: { ...principal, subject_id: "different-owner" } }), false);
    const otherAttempt = "link_uni_brand_00000000000000000002";
    assert.equal(owner.isOwnedReferenceResolution(resolution, { ...context, attempt_id: otherAttempt,
      principal: { ...principal, connection_id: otherAttempt } }), false);
    assert.equal(owner.isOwnedReferenceResolution(resolution, { ...context, model_id: "uni-1.1-modify-image" }), false);
    assert.equal(owner.isOwnedReferenceResolution(resolution, { ...context, catalog_version: "sha256-old.json" }), false);
    assert.equal(owner.isOwnedReferenceResolution(resolution, { ...context,
      upload_profile_schema_hash: `sha256:${"b".repeat(64)}` }), false);
    assert.equal(owner.isOwnedReferenceResolution(resolution, { ...context,
      reference_handle: `uni_image_${"1".repeat(8)}-${"1".repeat(4)}-${"1".repeat(4)}-${"1".repeat(4)}-${"1".repeat(12)}` }), false);
    assert.equal(posts, 1);
    // The nominal owner must reject exact TTL expiry and then remain closed under clock rollback.
    now = NOW + 15 * 60_000;
    assert.equal(owner.isOwnedReferenceResolution(resolution, context), false);
    now = NOW;
    assert.equal(owner.isOwnedReferenceResolution(resolution, context), false);
    await owner.invalidateAttempt(attemptId);
    assert.equal(owner.isOwnedReferenceResolution(resolution, context), false);
  } finally { await Promise.all([owner.close(), foreign.close()]); }
});

test("synchronously revokes a nominal resolution when the selected catalog profile drifts", async () => {
  const serviceModule = await import(SERVICE_URL) as Record<string, unknown>;
  const profileModule = await import(PROFILE_URL) as Record<string, unknown>;
  const Service = serviceModule.OwnerUniImageUploadService as new (options: Record<string, unknown>) => {
    upload(input: unknown): Promise<Record<string, unknown>>;
    resolveReference(context: unknown): Promise<Record<string, unknown>>;
    isOwnedReferenceResolution(value: unknown, context: unknown): boolean;
    close(): Promise<void>;
  };
  const getProfile = profileModule.getOwnerUniImageUploadProfile as (model: string, catalog: unknown, version: string) => Record<string, unknown>;
  let drift = false;
  const catalog = {
    getModel(modelId: string) {
      const record = CATALOG.getModel(modelId);
      return drift ? { ...record, description: "catalog changed after handle issue" } : record;
    },
    catalog_kind: CATALOG.catalog_kind, runtime_usable: CATALOG.runtime_usable, fetched_at: CATALOG.fetched_at,
    source_hashes: CATALOG.source_hashes, catalog_metadata: CATALOG.catalog_metadata
  };
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (_input, init) => {
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    return Response.json({ files: [{ id: "uni-profile-drift", url: "https://r2.syntx.ai/private/uni/profile-drift.jpg", mime_type: file.type, size: file.size }] });
  } });
  const service = new Service({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog, catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const attemptId = "link_uni_profile_drift_000000000000000001";
  const bytes = Buffer.from(JPEG);
  try {
    const receipt = await service.upload({ attemptId, model_id: "uni-1", content_base64: bytes.toString("base64"),
      filename: "drift.jpg", mime_type: "image/jpeg" });
    const profile = getProfile("uni-1", CATALOG, CATALOG_VERSION);
    const context = { principal: { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: attemptId },
      attempt_id: attemptId, model_id: "uni-1", ai_name: "luma_image", scope: "image", operation_id: "upload-image-reference",
      catalog_version: CATALOG_VERSION, upload_profile_schema_hash: profile.upload_profile_schema_hash,
      reference_handle: receipt.reference_handle };
    const resolution = await service.resolveReference(context);
    assert.equal(service.isOwnedReferenceResolution(resolution, context), true);
    drift = true;
    assert.equal(service.isOwnedReferenceResolution(resolution, context), false);
  } finally { await service.close(); }
});
