import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { syntxPublicCatalogSnapshotSchema } from "../src/catalog/syntx-public-catalog.js";
import { getOwnerGrokT2iSourceProfile } from "../src/application/owner-grok-t2i-source-profile.js";

const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const serviceModuleUrl = new URL("../src/application/owner-grok-t2i-image-upload-service.js", import.meta.url).href;
const BINDING = Object.freeze({ tenant_id: "grok-upload-tenant", subject: "grok-upload-subject" });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x12, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 5, 0, 0, 0, 0x2f, 0, 0, 0, 0, 0]);
const CATALOG = new DiscoveryCatalogRepository(syntxPublicCatalogSnapshotSchema.parse(JSON.parse(readFileSync(
  join(process.cwd(), "catalog/public", CATALOG_VERSION), "utf8"
))));

function credentialBroker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation("synthetic-grok-upload-credential"); } };
}

function linkedAttempt(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: null, linked: true };
}

function jpegWithWidth(width: number): Buffer {
  assert.ok(Number.isInteger(width) && width > 0 && width <= 65_535);
  const bytes = Buffer.from(JPEG);
  bytes[9] = (width >>> 8) & 0xff;
  bytes[10] = width & 0xff;
  return bytes;
}

test("uploads both Imagine models through the actual native client and returns only opaque source-checked references", async () => {
  let profileModule: Record<string, unknown> | null = null;
  try {
    profileModule = await import(serviceModuleUrl) as Record<string, unknown>;
  } catch {
    // The missing service is asserted as the expected first RED result below.
  }
  assert.equal(typeof profileModule?.OwnerGrokT2iImageUploadService, "function", "MISSING_OWNER_GROK_T2I_IMAGE_UPLOAD_SERVICE");
  const UploadService = profileModule!.OwnerGrokT2iImageUploadService as new (options: Record<string, unknown>) => {
    upload(input: unknown): Promise<Record<string, unknown>>;
    resolveReference(context: unknown): Promise<Record<string, unknown>>;
    isOwnedReferenceResolution(value: unknown, context: unknown): boolean;
    invalidateAttempt(attemptId: string): Promise<void>;
    close(): Promise<void>;
  };
  const profiles = new Map([
    ["grok_imagine_2", getOwnerGrokT2iSourceProfile("grok_imagine_2", CATALOG, CATALOG_VERSION)],
    ["grok_imagine_quality", getOwnerGrokT2iSourceProfile("grok_imagine_quality", CATALOG, CATALOG_VERSION)]
  ]);
  const cases = [
    { bytes: JPEG, sourceMime: "image/jpeg", wireMime: "image/jpeg" },
    { bytes: JPEG, sourceMime: "image/jpg", wireMime: "image/jpeg" },
    { bytes: PNG, sourceMime: "image/png", wireMime: "image/png" },
    { bytes: WEBP, sourceMime: "image/webp", wireMime: "image/webp" }
  ] as const;
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (input, init) => {
    posts += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    const form = init?.body as FormData;
    assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(form.get("destination"), "uploaded");
    assert.equal(form.get("check_duplicates"), "true");
    const file = form.get("files");
    assert.ok(file instanceof File);
    const modelId = String(form.get("model_type"));
    assert.ok(profiles.has(modelId));
    const current = cases[(posts - 1) % cases.length]!;
    assert.equal(file.type, current.wireMime);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), current.bytes);
    return Response.json({ files: [{ id: `native-grok-file-${posts}`, url: `https://r2.syntx.ai/private/grok/object-${posts}.img`,
      mime_type: current.wireMime, size: current.bytes.byteLength }] });
  } });
  let now = Date.parse("2026-10-11T00:00:00.000Z");
  const service = new UploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => now });
  try {
    let attemptNumber = 0;
    for (const modelId of ["grok_imagine_2", "grok_imagine_quality"] as const) {
      for (const item of cases) {
        attemptNumber += 1;
        const attemptId = `link_grok_upload_${String(attemptNumber).padStart(20, "0")}`;
        const receipt = await service.upload({ attemptId, model_id: modelId,
          content_base64: item.bytes.toString("base64"), filename: `source-${attemptNumber}.img`, mime_type: item.sourceMime });
        assert.equal(receipt.status, "uploaded");
        assert.equal(receipt.model_id, modelId);
        assert.match(String(receipt.reference_handle), /^grok_t2i_image_[0-9a-f-]{36}$/u);
        assert.equal(receipt.source_mime_type, item.sourceMime);
        assert.equal(receipt.mime_type, item.wireMime);
        assert.equal(receipt.size, item.bytes.byteLength);
        assert.equal(receipt.sha256, `sha256:${createHash("sha256").update(item.bytes).digest("hex")}`);
        assert.equal(receipt.expires_in_seconds, 900);
        assert.equal(receipt.metadata_confidence, "CONTAINER_METADATA_ONLY");
        assert.equal(receipt.size_limit_confidence, "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT");
        for (const privateValue of ["r2.syntx.ai", "native-grok-file-", `source-${attemptNumber}.img`, BINDING.subject]) {
          assert.equal(JSON.stringify(receipt).includes(privateValue), false);
        }
        const profile = profiles.get(modelId)!;
        const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: attemptId };
        const context = { principal, attempt_id: attemptId, model_id: modelId, ai_name: "grok_image", scope: "image",
          operation_id: "generate-image", catalog_version: CATALOG_VERSION, profile_schema_hash: profile.profile_schema_hash,
          reference_handle: receipt.reference_handle };
        const resolution = await service.resolveReference(context);
        assert.equal(resolution.reference_handle, receipt.reference_handle);
        assert.equal(resolution.attempt_id, attemptId);
        assert.equal(resolution.canonical_url, `https://r2.syntx.ai/private/grok/object-${posts}.img`);
        assert.equal(resolution.provenance, "private_r2_owned");
        assert.equal(service.isOwnedReferenceResolution(resolution, context), true);
        assert.equal(service.isOwnedReferenceResolution({ ...resolution }, context), false, "copied public shape is not a nominal resolution");
        await service.invalidateAttempt(attemptId);
        assert.equal(service.isOwnedReferenceResolution(resolution, context), false, "relink invalidation revokes the prior resolution");
        await assert.rejects(service.resolveReference(context), (error: unknown) =>
          error instanceof (profileModule!.OwnerGrokT2iImageUploadServiceError as new (...args: never[]) => Error & { code: string }) &&
          (error as Error & { code: string }).code === "REFERENCE_UNAVAILABLE");
      }
    }
    assert.equal(posts, 8);
  } finally {
    now += 1;
    await service.close();
  }
});

test("denies both non-uploadable Grok T2I rows before link lookup, client resolution, or broker use", async () => {
  const profileModule = await import(serviceModuleUrl) as Record<string, unknown>;
  const UploadService = profileModule.OwnerGrokT2iImageUploadService as new (options: Record<string, unknown>) => {
    upload(input: unknown): Promise<unknown>;
    close(): Promise<void>;
  };
  const ServiceError = profileModule.OwnerGrokT2iImageUploadServiceError as new (...args: never[]) => Error & { code: string };
  let links = 0, resolvedClients = 0, credentials = 0, posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { credentials += 1; return operation("synthetic"); }
  }, fetchImpl: async () => { posts += 1; return Response.json({ files: [] }); } });
  const service = new UploadService({ binding: BINDING,
    linkService: { async getStatus() { links += 1; return linkedAttempt("link_grok_upload_00000000000000000001"); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => { resolvedClients += 1; return client; } });
  try {
    for (const model_id of ["grok_t2i", "grok_t2i_pro"]) {
      await assert.rejects(service.upload({ attemptId: "link_grok_upload_00000000000000000001", model_id,
        content_base64: "not-base64", filename: "source.png", mime_type: "image/png" }),
      (error: unknown) => error instanceof ServiceError && error.code === "INVALID_REQUEST");
    }
    assert.equal(links, 0);
    assert.equal(resolvedClients, 0);
    assert.equal(credentials, 0);
    assert.equal(posts, 0);
  } finally { await service.close(); }
});

test("same-attempt successful upload reuses the original opaque handle and expiry without a second POST", async () => {
  const profileModule = await import(serviceModuleUrl) as Record<string, unknown>;
  const UploadService = profileModule.OwnerGrokT2iImageUploadService as new (options: Record<string, unknown>) => {
    upload(input: unknown): Promise<Record<string, unknown>>;
    close(): Promise<void>;
  };
  const attemptId = "link_grok_upload_cache_0000000001";
  const startedAt = Date.parse("2026-10-11T00:00:00.000Z");
  let now = startedAt, posts = 0, clientResolutions = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (_input, init) => {
    posts += 1;
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    assert.equal(file.type, "image/jpeg");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), JPEG);
    return Response.json({ files: [{ url: "https://r2.syntx.ai/private/grok/cache.jpg", file_id: "native-cache-1",
      mime_type: "image/jpeg", size: JPEG.byteLength }] });
  } });
  const service = new UploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, id: string) { return linkedAttempt(id); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => { clientResolutions += 1; return client; }, now: () => now });
  try {
    const first = await service.upload({ attemptId, model_id: "grok_imagine_2", content_base64: JPEG.toString("base64"),
      filename: "first.jpg", mime_type: "image/jpeg" });
    now += 60_000;
    const cached = await service.upload({ attemptId, model_id: "grok_imagine_2", content_base64: JPEG.toString("base64"),
      filename: "renamed.jpg", mime_type: "image/jpg" });
    assert.equal(posts, 1);
    assert.equal(clientResolutions, 1);
    assert.equal(cached.reference_handle, first.reference_handle);
    assert.equal(cached.source_mime_type, "image/jpeg");
    assert.equal(cached.expires_in_seconds, 840);
  } finally { await service.close(); }
});

test("an unknown native outcome holds the same principal/model/content across a new attempt without replay", async () => {
  const profileModule = await import(serviceModuleUrl) as Record<string, unknown>;
  const UploadService = profileModule.OwnerGrokT2iImageUploadService as new (options: Record<string, unknown>) => {
    upload(input: unknown): Promise<unknown>;
    close(): Promise<void>;
  };
  const ServiceError = profileModule.OwnerGrokT2iImageUploadServiceError as new (...args: never[]) => Error & { code: string };
  const firstAttempt = "link_grok_upload_unknown_000001";
  const nextAttempt = "link_grok_upload_unknown_000002";
  let posts = 0, credentials = 0, resolvedClients = 0, links = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      credentials += 1;
      return operation("synthetic-grok-unknown");
    }
  }, fetchImpl: async () => {
    posts += 1;
    throw new Error("synthetic transport loss after request invocation");
  } });
  const service = new UploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { links += 1; return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION,
    resolveClient: () => { resolvedClients += 1; return client; } });
  try {
    const input = { model_id: "grok_imagine_2", content_base64: JPEG.toString("base64"),
      filename: "same-content.jpg", mime_type: "image/jpeg" };
    await assert.rejects(service.upload({ attemptId: firstAttempt, ...input }),
      (error: unknown) => error instanceof ServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    await assert.rejects(service.upload({ attemptId: nextAttempt, ...input }),
      (error: unknown) => error instanceof ServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts, 1, "unknown POST outcome must never be replayed for the same semantic upload");
    assert.equal(credentials, 1);
    assert.equal(resolvedClients, 1, "held content is rejected before resolving another native client");
    assert.equal(links, 2, "the new attempt is still freshly linked before the stable hold is applied");
  } finally { await service.close(); }
});

test("a known rate-limit rejection is distinct from unknown and permits a later explicit attempt", async () => {
  const profileModule = await import(serviceModuleUrl) as Record<string, unknown>;
  const UploadService = profileModule.OwnerGrokT2iImageUploadService as new (options: Record<string, unknown>) => {
    upload(input: unknown): Promise<Record<string, unknown>>;
    close(): Promise<void>;
  };
  const ServiceError = profileModule.OwnerGrokT2iImageUploadServiceError as new (...args: never[]) => Error & { code: string };
  const attempts = ["link_grok_upload_429_0000000001", "link_grok_upload_429_0000000002"];
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    posts += 1;
    if (posts === 1) return new Response("rate limited", { status: 429 });
    return Response.json({ files: [{ id: "rate-limit-recovered", url: "https://r2.syntx.ai/private/grok/recovered.jpg",
      mime_type: "image/jpeg", size: JPEG.byteLength }] });
  } });
  const service = new UploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client });
  try {
    const input = { model_id: "grok_imagine_2", content_base64: JPEG.toString("base64"),
      filename: "known-reject.jpg", mime_type: "image/jpeg" };
    await assert.rejects(service.upload({ attemptId: attempts[0], ...input }),
      (error: unknown) => error instanceof ServiceError && error.code === "UPLOAD_REJECTED");
    const receipt = await service.upload({ attemptId: attempts[1], ...input });
    assert.equal(receipt.status, "uploaded");
    assert.equal(receipt.model_id, "grok_imagine_2");
    assert.equal(posts, 2, "only an explicitly requested later call is made after a known rejection");
  } finally { await service.close(); }
});

test("pre-abort makes no native request while abort after invocation is held as unknown", async () => {
  const profileModule = await import(serviceModuleUrl) as Record<string, unknown>;
  const UploadService = profileModule.OwnerGrokT2iImageUploadService as new (options: Record<string, unknown>) => {
    upload(input: unknown): Promise<unknown>;
    close(): Promise<void>;
  };
  const ServiceError = profileModule.OwnerGrokT2iImageUploadServiceError as new (...args: never[]) => Error & { code: string };
  const attempts = ["link_grok_upload_abort_000000001", "link_grok_upload_abort_000000002"];
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (_input, init) => {
    posts += 1;
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) reject(new DOMException("Aborted", "AbortError"));
      else signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  } });
  const service = new UploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client });
  try {
    const input = { model_id: "grok_imagine_quality", content_base64: JPEG.toString("base64"),
      filename: "abort.jpg", mime_type: "image/jpeg" };
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await assert.rejects(service.upload({ attemptId: attempts[0], ...input, signal: alreadyAborted.signal }),
      (error: unknown) => error instanceof ServiceError && error.code === "REQUEST_ABORTED");
    assert.equal(posts, 0);

    const controller = new AbortController();
    const inFlight = service.upload({ attemptId: attempts[0], ...input, signal: controller.signal });
    setTimeout(() => controller.abort(), 0);
    await assert.rejects(inFlight, (error: unknown) => error instanceof ServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts, 1);
    await assert.rejects(service.upload({ attemptId: attempts[1], ...input }),
      (error: unknown) => error instanceof ServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts, 1, "the aborted native call may have committed, so a later attempt cannot replay it");
  } finally { await service.close(); }
});

test("concurrent duplicate semantic upload is rejected while one native request is pending", async () => {
  const profileModule = await import(serviceModuleUrl) as Record<string, unknown>;
  const UploadService = profileModule.OwnerGrokT2iImageUploadService as new (options: Record<string, unknown>) => {
    upload(input: unknown): Promise<Record<string, unknown>>;
    close(): Promise<void>;
  };
  const ServiceError = profileModule.OwnerGrokT2iImageUploadServiceError as new (...args: never[]) => Error & { code: string };
  const attemptId = "link_grok_upload_pending_00000001";
  let posts = 0;
  let markEntered!: () => void;
  let finishFetch!: (response: Response) => void;
  const entered = new Promise<void>((resolve) => { markEntered = resolve; });
  const waitingResponse = new Promise<Response>((resolve) => { finishFetch = resolve; });
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    posts += 1;
    markEntered();
    return await waitingResponse;
  } });
  const service = new UploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, id: string) { return linkedAttempt(id); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client });
  try {
    const input = { attemptId, model_id: "grok_imagine_2", content_base64: JPEG.toString("base64"),
      filename: "pending.jpg", mime_type: "image/jpeg" };
    const first = service.upload(input);
    await entered;
    await assert.rejects(service.upload({ ...input, filename: "renamed.jpg" }),
      (error: unknown) => error instanceof ServiceError && error.code === "UPLOAD_IN_PROGRESS");
    assert.equal(posts, 1);
    finishFetch(Response.json({ files: [{ url: "https://r2.syntx.ai/private/grok/pending.jpg",
      mime_type: "image/jpeg", size: JPEG.byteLength }] }));
    assert.equal((await first).status, "uploaded");
    assert.equal(posts, 1);
  } finally { await service.close(); }
});

test("a monotonic-clock rollback makes an existing nominal resolution unusable", async () => {
  const profileModule = await import(serviceModuleUrl) as Record<string, unknown>;
  const UploadService = profileModule.OwnerGrokT2iImageUploadService as new (options: Record<string, unknown>) => {
    upload(input: unknown): Promise<Record<string, unknown>>;
    resolveReference(context: unknown): Promise<unknown>;
    isOwnedReferenceResolution(value: unknown, context: unknown): boolean;
    close(): Promise<void>;
  };
  const ServiceError = profileModule.OwnerGrokT2iImageUploadServiceError as new (...args: never[]) => Error & { code: string };
  const attemptId = "link_grok_upload_clock_000000001";
  const profile = getOwnerGrokT2iSourceProfile("grok_imagine_2", CATALOG, CATALOG_VERSION);
  let now = Date.parse("2026-10-11T00:00:00.000Z"), posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    posts += 1;
    return Response.json({ files: [{ url: "https://r2.syntx.ai/private/grok/clock.jpg", mime_type: "image/jpeg", size: JPEG.byteLength }] });
  } });
  const service = new UploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, id: string) { return linkedAttempt(id); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => now });
  try {
    const receipt = await service.upload({ attemptId, model_id: "grok_imagine_2", content_base64: JPEG.toString("base64"),
      filename: "clock.jpg", mime_type: "image/jpeg" });
    const context = { principal: { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: attemptId },
      attempt_id: attemptId, model_id: "grok_imagine_2", ai_name: "grok_image", scope: "image", operation_id: "generate-image",
      catalog_version: CATALOG_VERSION, profile_schema_hash: profile.profile_schema_hash, reference_handle: receipt.reference_handle };
    const resolution = await service.resolveReference(context);
    assert.equal(service.isOwnedReferenceResolution(resolution, context), true);
    now -= 1;
    assert.equal(service.isOwnedReferenceResolution(resolution, context), false);
    await assert.rejects(service.resolveReference(context),
      (error: unknown) => error instanceof ServiceError && error.code === "CLOCK_INVALID");
    assert.equal(posts, 1);
  } finally { await service.close(); }
});

test("source-profile drift is rejected before client resolution or POST", async () => {
  const profileModule = await import(serviceModuleUrl) as Record<string, unknown>;
  const UploadService = profileModule.OwnerGrokT2iImageUploadService as new (options: Record<string, unknown>) => {
    upload(input: unknown): Promise<unknown>;
    close(): Promise<void>;
  };
  const ServiceError = profileModule.OwnerGrokT2iImageUploadServiceError as new (...args: never[]) => Error & { code: string };
  let drift = false, clients = 0, posts = 0;
  const mutableCatalog = {
    getModel(modelId: string) {
      const record = CATALOG.getModel(modelId as never);
      return drift ? { ...record, default: !record.default } : record;
    },
    fetched_at: CATALOG.fetched_at,
    source_hashes: CATALOG.source_hashes,
    catalog_metadata: CATALOG.catalog_metadata,
    catalog_kind: CATALOG.catalog_kind,
    runtime_usable: CATALOG.runtime_usable
  };
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    posts += 1;
    return Response.json({ files: [] });
  } });
  const service = new UploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, id: string) { return linkedAttempt(id); } },
    catalog: mutableCatalog, catalog_version: CATALOG_VERSION, resolveClient: () => { clients += 1; return client; } });
  try {
    drift = true;
    await assert.rejects(service.upload({ attemptId: "link_grok_upload_drift_000000001", model_id: "grok_imagine_2",
      content_base64: JPEG.toString("base64"), filename: "drift.jpg", mime_type: "image/jpeg" }),
    (error: unknown) => error instanceof ServiceError && error.code === "MODEL_BINDING_MISMATCH");
    assert.equal(clients, 0);
    assert.equal(posts, 0);
  } finally { await service.close(); }
});

test("an unlinked current principal cannot reuse a cached success or keep its resolved URL", async () => {
  const profileModule = await import(serviceModuleUrl) as Record<string, unknown>;
  const UploadService = profileModule.OwnerGrokT2iImageUploadService as new (options: Record<string, unknown>) => {
    upload(input: unknown): Promise<Record<string, unknown>>;
    resolveReference(context: unknown): Promise<unknown>;
    isOwnedReferenceResolution(value: unknown, context: unknown): boolean;
    close(): Promise<void>;
  };
  const ServiceError = profileModule.OwnerGrokT2iImageUploadServiceError as new (...args: never[]) => Error & { code: string };
  const attemptId = "link_grok_upload_relink_0000001";
  const profile = getOwnerGrokT2iSourceProfile("grok_imagine_2", CATALOG, CATALOG_VERSION);
  let linked = true, posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    posts += 1;
    return Response.json({ files: [{ url: "https://r2.syntx.ai/private/grok/relink.jpg", mime_type: "image/jpeg", size: JPEG.byteLength }] });
  } });
  const service = new UploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, id: string) {
      return linked ? linkedAttempt(id) : { attempt_id: id, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
        status: "UNLINKED" as const, expires_at: null, linked: false };
    } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client });
  try {
    const input = { attemptId, model_id: "grok_imagine_2", content_base64: JPEG.toString("base64"), filename: "relink.jpg", mime_type: "image/jpeg" };
    const receipt = await service.upload(input);
    const context = { principal: { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: attemptId },
      attempt_id: attemptId, model_id: "grok_imagine_2", ai_name: "grok_image", scope: "image", operation_id: "generate-image",
      catalog_version: CATALOG_VERSION, profile_schema_hash: profile.profile_schema_hash, reference_handle: receipt.reference_handle };
    const resolution = await service.resolveReference(context);
    assert.equal(service.isOwnedReferenceResolution(resolution, context), true);
    linked = false;
    await assert.rejects(service.upload(input),
      (error: unknown) => error instanceof ServiceError && error.code === "PRINCIPAL_NOT_LINKED");
    await assert.rejects(service.resolveReference(context),
      (error: unknown) => error instanceof ServiceError && error.code === "REFERENCE_UNAVAILABLE");
    assert.equal(service.isOwnedReferenceResolution(resolution, context), false);
    assert.equal(posts, 1);
  } finally { await service.close(); }
});

test("four pending native uploads drain on close and a fifth is rejected at the pending cap", async () => {
  const profileModule = await import(serviceModuleUrl) as Record<string, unknown>;
  const UploadService = profileModule.OwnerGrokT2iImageUploadService as new (options: Record<string, unknown>) => {
    upload(input: unknown): Promise<unknown>;
    close(): Promise<void>;
  };
  const ServiceError = profileModule.OwnerGrokT2iImageUploadServiceError as new (...args: never[]) => Error & { code: string };
  let posts = 0;
  const entered: (() => void)[] = [];
  const allEntered = new Promise<void>((resolve) => {
    let count = 0;
    for (let index = 0; index < 4; index += 1) entered.push(() => { count += 1; if (count === 4) resolve(); });
  });
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (_input, init) => {
    posts += 1;
    entered[posts - 1]?.();
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) reject(new DOMException("Aborted", "AbortError"));
      else signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  } });
  const service = new UploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client });
  const attemptId = "link_grok_upload_cap_00000000001";
  const pending = Array.from({ length: 4 }, (_unused, index) => {
    const bytes = jpegWithWidth(index + 1);
    return service.upload({ attemptId, model_id: "grok_imagine_quality", content_base64: bytes.toString("base64"),
      filename: `cap-${index + 1}.jpg`, mime_type: "image/jpeg" });
  });
  try {
    await allEntered;
    const fifthBytes = jpegWithWidth(5);
    await assert.rejects(service.upload({ attemptId, model_id: "grok_imagine_quality", content_base64: fifthBytes.toString("base64"),
      filename: "cap-5.jpg", mime_type: "image/jpeg" }),
    (error: unknown) => error instanceof ServiceError && error.code === "SERVICE_BUSY");
    assert.equal(posts, 4);
    await service.close();
    const settled = await Promise.allSettled(pending);
    assert.equal(settled.length, 4);
    assert.ok(settled.every((result) => result.status === "rejected"));
    assert.equal(posts, 4);
  } finally { await service.close(); }
});

test("128 distinct unknown semantic holds are retained and the 129th distinct upload is capacity-blocked", async () => {
  const profileModule = await import(serviceModuleUrl) as Record<string, unknown>;
  const UploadService = profileModule.OwnerGrokT2iImageUploadService as new (options: Record<string, unknown>) => {
    upload(input: unknown): Promise<unknown>;
    close(): Promise<void>;
  };
  const ServiceError = profileModule.OwnerGrokT2iImageUploadServiceError as new (...args: never[]) => Error & { code: string };
  const attemptId = "link_grok_upload_unknown_capacity_0001";
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    posts += 1;
    throw new Error("synthetic uncertain transport outcome");
  } });
  const service = new UploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, id: string) { return linkedAttempt(id); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client });
  try {
    for (let index = 1; index <= 128; index += 1) {
      const bytes = jpegWithWidth(index);
      await assert.rejects(service.upload({ attemptId, model_id: "grok_imagine_2", content_base64: bytes.toString("base64"),
        filename: `unknown-${index}.jpg`, mime_type: "image/jpeg" }),
      (error: unknown) => error instanceof ServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    }
    assert.equal(posts, 128);
    const firstBytes = jpegWithWidth(1);
    await assert.rejects(service.upload({ attemptId: "link_grok_upload_unknown_capacity_0002", model_id: "grok_imagine_2",
      content_base64: firstBytes.toString("base64"), filename: "first-again.jpg", mime_type: "image/jpeg" }),
    (error: unknown) => error instanceof ServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    const newBytes = jpegWithWidth(129);
    await assert.rejects(service.upload({ attemptId, model_id: "grok_imagine_2", content_base64: newBytes.toString("base64"),
      filename: "new-capacity.jpg", mime_type: "image/jpeg" }),
    (error: unknown) => error instanceof ServiceError && error.code === "CAPACITY_EXCEEDED");
    assert.equal(posts, 128, "unknown holds are not evicted to make room for new uploads");
  } finally { await service.close(); }
});
