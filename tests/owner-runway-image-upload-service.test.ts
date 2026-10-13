import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { OwnerRunwayImageUploadService, OwnerRunwayImageUploadServiceError } from "../src/application/owner-runway-image-upload-service.js";
import { OwnerRunwayImagePrepareError, prepareOwnerRunwayImageRequest } from "../src/application/owner-runway-image-request-preparer.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const ATTEMPT = "link_runway_upload_service_0123456789";
const BINDING = Object.freeze({ tenant_id: "runway-upload-tenant", subject: "runway-upload-subject" });
const NOW = Date.parse("2026-10-10T12:00:00.000Z");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x12, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 0x05, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x00, 0x00]);
const AVIF = Buffer.from("AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAkAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAQAAAAEAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAsbWRhdAoKAAAAAZ/41fIAgDIWEACXgBBAggAAEABcEytNbG+TY8nR6A==", "base64");
const CATALOG = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;

function credentialBroker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation("runway-upload-test-credential"); } };
}

function linkedAttempt(attemptId: string, linked = true) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: linked ? "LINKED" as const : "REVOKED" as const, expires_at: null, linked };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 80 && !predicate(); index += 1) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(predicate(), true, "bounded latch did not reach its expected state");
}

function createService(fetchImpl: typeof fetch, linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } }, now: () => number = () => NOW) {
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl });
  const service = new OwnerRunwayImageUploadService({ binding: BINDING, linkService,
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now });
  return { client, service };
}

test("uploads Runway Frames through the exact native client and issues a private same-attempt reference set", async () => {
  let posts = 0;
  const { service } = createService(async (input, init) => {
    posts += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    const form = init?.body as FormData;
    assert.equal(form.get("destination"), "uploaded");
    assert.equal(form.get("check_duplicates"), "true");
    assert.equal(form.get("model_type"), "runway_frames");
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.type, "image/png");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
    return Response.json({ files: [{ id: "private-runway-id", url: "https://r2.syntx.ai/runway/private.png", mime_type: "image/png", size: PNG.byteLength }] });
  });
  try {
    const receipt = await service.upload({ attemptId: ATTEMPT, variant: "runway_frames", content_base64: PNG.toString("base64"), filename: "reference.png", mime_type: "image/png" });
    assert.equal(posts, 1);
    assert.equal(receipt.status, "uploaded");
    assert.equal(receipt.variant, "runway_frames");
    assert.equal(receipt.reference_handle.startsWith("runway_image_"), true);
    assert.equal(receipt.mime_type, "image/png");
    assert.equal(receipt.width, 1);
    assert.equal(receipt.height, 1);
    assert.equal(receipt.size, PNG.byteLength);
    assert.equal(receipt.expires_in_seconds, 900);
    assert.equal(receipt.metadata_confidence, "CONTAINER_METADATA_ONLY");
    assert.equal(Object.isFrozen(receipt), true);
    assert.deepEqual(Object.keys(receipt).sort(), ["expires_in_seconds", "height", "metadata_confidence", "mime_type", "original_mime_type", "reference_handle", "sha256", "size", "status", "validation_confidence", "variant", "width"].sort());
    const serialized = JSON.stringify(receipt);
    assert.equal(serialized.includes("r2.syntx.ai"), false);
    assert.equal(serialized.includes("private-runway-id"), false);
    assert.equal(serialized.includes("reference.png"), false);
    assert.equal(serialized.includes(BINDING.subject), false);

    const set = await service.issueReferences({ attemptId: ATTEMPT, variant: "runway_frames", reference_handles: [receipt.reference_handle] });
    assert.equal(set.variant, "runway_frames");
    assert.equal(set.reference_count, 1);
    assert.equal(set.expires_at, NOW + 900_000);
    await service.invalidateAttempt(ATTEMPT);
    assert.throws(() => prepareOwnerRunwayImageRequest({ principal: { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT },
      attempt_id: ATTEMPT, variant: "runway_frames", parameters: { resolution: "1088x1088", temperature: 2 },
      reference_set: set, prompt: "Check revocation" }, { catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW }),
    (error: unknown) => error instanceof OwnerRunwayImagePrepareError && error.code === "REFERENCE_UNAVAILABLE");
    await assert.rejects(service.issueReferences({ attemptId: ATTEMPT, variant: "runway_frames", reference_handles: [receipt.reference_handle] }));
  } finally { await service.close(); }
});

test("rejects invalid source MIME and callback-shaped clients before any upload request", async () => {
  let posts = 0;
  const { service } = createService(async () => { posts += 1; return Response.json({ files: [{ url: "https://r2.syntx.ai/runway/unused" }] }); });
  try {
    await assert.rejects(service.upload({ attemptId: ATTEMPT, variant: "runway_frames", content_base64: PNG.toString("base64"), filename: "x.png", mime_type: "image/gif" }),
      (error: unknown) => error instanceof OwnerRunwayImageUploadServiceError && error.code === "INVALID_IMAGE_INPUT");
    assert.equal(posts, 0);
  } finally { await service.close(); }

  const fake = new OwnerRunwayImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => ({ async uploadRunwayImageReference() { posts += 1; return { url: "https://r2.syntx.ai/runway/fake" }; } }), now: () => NOW });
  try {
    await assert.rejects(fake.upload({ attemptId: ATTEMPT, variant: "runway_frames", content_base64: PNG.toString("base64"), filename: "x.png", mime_type: "image/png" }),
      (error: unknown) => error instanceof OwnerRunwayImageUploadServiceError && error.code === "MODEL_BINDING_MISMATCH");
    assert.equal(posts, 0);
  } finally { await fake.close(); }
});

test("keeps the original upload expiry and fails closed when the service clock moves backwards", async () => {
  let now = NOW;
  const { service } = createService(async () => Response.json({ files: [{ url: "https://r2.syntx.ai/runway/expiring.png", mime_type: "image/png", size: PNG.byteLength }] }), undefined, () => now);
  try {
    const expiredReceipt = await service.upload({ attemptId: ATTEMPT, variant: "runway_frames", content_base64: PNG.toString("base64"), filename: "one.png", mime_type: "image/png" });
    now = NOW + 15 * 60_000;
    await assert.rejects(service.issueReferences({ attemptId: ATTEMPT, variant: "runway_frames", reference_handles: [expiredReceipt.reference_handle] }),
      (error: unknown) => error instanceof OwnerRunwayImageUploadServiceError && error.code === "REFERENCE_EXPIRED");
  } finally { await service.close(); }

  const clockServiceClient = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () =>
    Response.json({ files: [{ url: "https://r2.syntx.ai/runway/clock.png", mime_type: "image/png", size: PNG.byteLength }] }) });
  const clockService = new OwnerRunwayImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => clockServiceClient, now: () => now });
  try {
    now = NOW;
    const receipt = await clockService.upload({ attemptId: ATTEMPT, variant: "runway_frames", content_base64: PNG.toString("base64"), filename: "two.png", mime_type: "image/png" });
    now = NOW - 1;
    await assert.rejects(clockService.issueReferences({ attemptId: ATTEMPT, variant: "runway_frames", reference_handles: [receipt.reference_handle] }),
      (error: unknown) => error instanceof OwnerRunwayImageUploadServiceError && error.code === "SERVICE_CLOSED");
  } finally { await clockService.close(); }
});

test("accepts only the frozen Runway source MIME set and canonicalizes the JPG alias", async () => {
  const cases = [
    { bytes: JPEG, source: "image/jpeg", canonical: "image/jpeg" },
    { bytes: JPEG, source: "image/jpg", canonical: "image/jpeg" },
    { bytes: PNG, source: "image/png", canonical: "image/png" },
    { bytes: AVIF, source: "image/avif", canonical: "image/avif" },
    { bytes: WEBP, source: "image/webp", canonical: "image/webp" }
  ] as const;
  let index = 0;
  const { service } = createService(async (_input, init) => {
    const item = cases[index++]!;
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    assert.equal(file.type, item.canonical);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), item.bytes);
    return Response.json({ files: [{ url: `https://r2.syntx.ai/runway/${index}`, mime_type: item.canonical, size: item.bytes.byteLength }] });
  });
  try {
    const receipts = [];
    for (const item of cases) receipts.push(await service.upload({ attemptId: ATTEMPT, variant: "runway_frames",
      content_base64: item.bytes.toString("base64"), filename: "reference.img", mime_type: item.source }));
    assert.equal(index, cases.length);
    assert.deepEqual(receipts.map((item) => item.original_mime_type), cases.map((item) => item.source));
    assert.deepEqual(receipts.map((item) => item.mime_type), cases.map((item) => item.canonical));
  } finally { await service.close(); }
});

test("does not transfer a same-attempt handle to another linked principal", async () => {
  const { service } = createService(async () => Response.json({ files: [{ url: "https://r2.syntx.ai/runway/private.png", mime_type: "image/png", size: PNG.byteLength }] }));
  const foreignClient = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    throw new Error("foreign principal must not upload");
  } });
  const foreign = new OwnerRunwayImageUploadService({ binding: { tenant_id: BINDING.tenant_id, subject: "different-owner" },
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => foreignClient, now: () => NOW });
  try {
    const receipt = await service.upload({ attemptId: ATTEMPT, variant: "runway_frames", content_base64: PNG.toString("base64"), filename: "reference.png", mime_type: "image/png" });
    await assert.rejects(foreign.issueReferences({ attemptId: ATTEMPT, variant: "runway_frames", reference_handles: [receipt.reference_handle] }),
      (error: unknown) => error instanceof OwnerRunwayImageUploadServiceError && error.code === "REFERENCE_UNAVAILABLE");
  } finally { await Promise.all([service.close(), foreign.close()]); }
});

test("keeps malformed native upload outcomes unknown and never retries", async () => {
  let posts = 0;
  const { service } = createService(async () => {
    posts += 1;
    return Response.json({ files: [{ id: "private-id", url: "https://r2.syntx.ai/runway/wrong.png", mime_type: "image/jpeg", size: PNG.byteLength }] });
  });
  try {
    await assert.rejects(service.upload({ attemptId: ATTEMPT, variant: "runway_frames", content_base64: PNG.toString("base64"), filename: "reference.png", mime_type: "image/png" }),
      (error: unknown) => error instanceof OwnerRunwayImageUploadServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN" && !error.message.includes("private-id"));
    assert.equal(posts, 1);
  } finally { await service.close(); }
});

test("revocation during reference resolution prevents the branded set from escaping", async () => {
  let statusCalls = 0;
  let releaseStatus!: () => void;
  const statusGate = new Promise<void>((resolve) => { releaseStatus = resolve; });
  let fetchPosts = 0;
  const linkService = { async getStatus(_binding: unknown, attemptId: string) {
    statusCalls += 1;
    if (statusCalls === 4) await statusGate;
    return linkedAttempt(attemptId);
  } };
  const { service } = createService(async () => {
    fetchPosts += 1;
    return Response.json({ files: [{ url: "https://r2.syntx.ai/runway/race.png", mime_type: "image/png", size: PNG.byteLength }] });
  }, linkService);
  try {
    const receipt = await service.upload({ attemptId: ATTEMPT, variant: "runway_frames", content_base64: PNG.toString("base64"), filename: "race.png", mime_type: "image/png" });
    let outcome = service.issueReferences({ attemptId: ATTEMPT, variant: "runway_frames", reference_handles: [receipt.reference_handle] })
      .then((set) => ({ set }), (error: unknown) => ({ error }));
    await waitUntil(() => statusCalls === 4);
    const invalidation = service.invalidateAttempt(ATTEMPT);
    releaseStatus();
    const result = await outcome;
    assert.ok("error" in result);
    assert.ok(result.error instanceof OwnerRunwayImageUploadServiceError);
    assert.equal(result.error.code, "REFERENCE_UNAVAILABLE");
    await invalidation;
    assert.equal(fetchPosts, 1);
  } finally {
    releaseStatus();
    await service.close();
  }
});

test("close aborts an in-flight native upload, waits for cleanup, and returns no handle", async () => {
  let posts = 0;
  let abortObserved = false;
  const { service } = createService(async (_input, init) => {
    posts += 1;
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal instanceof AbortSignal) signal.addEventListener("abort", () => {
        abortObserved = true;
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    });
  });
  try {
    const result = service.upload({ attemptId: ATTEMPT, variant: "runway_frames", content_base64: PNG.toString("base64"), filename: "pending.png", mime_type: "image/png" })
      .then((receipt) => ({ receipt }), (error: unknown) => ({ error }));
    await waitUntil(() => posts === 1);
    const close = service.close();
    await close;
    const settled = await result;
    assert.ok("error" in settled);
    assert.ok(settled.error instanceof OwnerRunwayImageUploadServiceError);
    assert.equal(settled.error.code, "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(abortObserved, true);
    assert.equal(posts, 1);
    await assert.rejects(service.issueReferences({ attemptId: ATTEMPT, variant: "runway_frames", reference_handles: [] }),
      (error: unknown) => error instanceof OwnerRunwayImageUploadServiceError && error.code === "SERVICE_CLOSED");
  } finally { await service.close(); }
});

test("rejects a fourth reference handle and enforces the four-pending-operation ceiling", async () => {
  const { service } = createService(async () => Response.json({ files: [{ url: "https://r2.syntx.ai/runway/count.png", mime_type: "image/png", size: PNG.byteLength }] }));
  try {
    const receipt = await service.upload({ attemptId: ATTEMPT, variant: "runway_frames", content_base64: PNG.toString("base64"), filename: "count.png", mime_type: "image/png" });
    await assert.rejects(service.issueReferences({ attemptId: ATTEMPT, variant: "runway_frames", reference_handles: [receipt.reference_handle,
      "runway_image_00000000-0000-4000-8000-000000000001", "runway_image_00000000-0000-4000-8000-000000000002", "runway_image_00000000-0000-4000-8000-000000000003"] }),
    (error: unknown) => error instanceof OwnerRunwayImageUploadServiceError && error.code === "INVALID_REQUEST");
  } finally { await service.close(); }

  let posts = 0;
  let releaseFetch!: () => void;
  const fetchGate = new Promise<void>((resolve) => { releaseFetch = resolve; });
  const { service: pendingService } = createService(async () => {
    posts += 1;
    await fetchGate;
    return Response.json({ files: [{ url: `https://r2.syntx.ai/runway/pending-${posts}.png`, mime_type: "image/png", size: PNG.byteLength }] });
  });
  const attemptIds = ["link_runway_pending_0000000000000001", "link_runway_pending_0000000000000002", "link_runway_pending_0000000000000003", "link_runway_pending_0000000000000004"];
  try {
    const pending = attemptIds.map((attemptId) => pendingService.upload({ attemptId, variant: "runway_frames", content_base64: PNG.toString("base64"), filename: "pending.png", mime_type: "image/png" })
      .then((receipt) => ({ receipt }), (error: unknown) => ({ error })));
    await waitUntil(() => posts === 4);
    await assert.rejects(pendingService.upload({ attemptId: "link_runway_pending_0000000000000005", variant: "runway_frames",
      content_base64: PNG.toString("base64"), filename: "overflow.png", mime_type: "image/png" }),
    (error: unknown) => error instanceof OwnerRunwayImageUploadServiceError && error.code === "SERVICE_BUSY");
    releaseFetch();
    const settled = await Promise.all(pending);
    assert.equal(settled.filter((item) => "receipt" in item).length, 4);
    assert.equal(posts, 4);
  } finally { releaseFetch(); await pendingService.close(); }
});

test("preserves ambiguous upload outcomes when the linked owner is revoked after the POST await", async () => {
  let linked = true;
  let statusCalls = 0;
  let posts = 0;
  const linkService = { async getStatus(_binding: unknown, attemptId: string) {
    statusCalls += 1;
    return linkedAttempt(attemptId, linked);
  } };
  const { service } = createService(async () => {
    posts += 1;
    linked = false;
    return Response.json({ files: [{ url: "https://r2.syntx.ai/runway/revoked.png", mime_type: "image/png", size: PNG.byteLength }] });
  }, linkService);
  try {
    await assert.rejects(service.upload({ attemptId: ATTEMPT, variant: "runway_frames", content_base64: PNG.toString("base64"), filename: "revoked.png", mime_type: "image/png" }),
      (error: unknown) => error instanceof OwnerRunwayImageUploadServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts, 1);
    assert.equal(statusCalls, 2);
    await assert.rejects(service.issueReferences({ attemptId: ATTEMPT, variant: "runway_frames", reference_handles: [] }),
      (error: unknown) => error instanceof OwnerRunwayImageUploadServiceError && error.code === "PRINCIPAL_NOT_LINKED");
  } finally { await service.close(); }
});

test("enforces the 128-record bound and the local 32 MiB ceiling before POST", async () => {
  let posts = 0;
  const { service } = createService(async () => {
    posts += 1;
    return Response.json({ files: [{ url: `https://r2.syntx.ai/runway/bounded-${posts}`, mime_type: "image/png", size: PNG.byteLength }] });
  });
  try {
    await assert.rejects(service.upload({ attemptId: "link_runway_large_0123456789", variant: "runway_frames",
      content_base64: "A".repeat(44_739_248), filename: "large.png", mime_type: "image/png" }),
    (error: unknown) => error instanceof OwnerRunwayImageUploadServiceError && error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED");
    assert.equal(posts, 0);
    for (let index = 0; index < 128; index += 1) {
      await service.upload({ attemptId: ATTEMPT, variant: "runway_frames", content_base64: PNG.toString("base64"), filename: "bounded.png", mime_type: "image/png" });
    }
    assert.equal(posts, 128);
    await assert.rejects(service.upload({ attemptId: ATTEMPT, variant: "runway_frames", content_base64: PNG.toString("base64"), filename: "overflow.png", mime_type: "image/png" }),
      (error: unknown) => error instanceof OwnerRunwayImageUploadServiceError && error.code === "CAPACITY_EXCEEDED");
    assert.equal(posts, 128);
  } finally { await service.close(); }
});

test("rejects caller-owned byte views at the service boundary without wiping their storage", async () => {
  const backing = Buffer.concat([Buffer.from([0xaa]), PNG, Buffer.from([0xbb])]);
  const view = backing.subarray(1, 1 + PNG.byteLength);
  const before = Buffer.from(backing);
  let posts = 0;
  const { service } = createService(async () => { posts += 1; return Response.json({ files: [] }); });
  try {
    await assert.rejects(service.upload({ attemptId: ATTEMPT, variant: "runway_frames", content_base64: PNG.toString("base64"), filename: "bytes.png", mime_type: "image/png", bytes: view }),
      (error: unknown) => error instanceof OwnerRunwayImageUploadServiceError && error.code === "INVALID_REQUEST");
    assert.deepEqual(backing, before);
    assert.deepEqual(Buffer.from(view), PNG);
    assert.equal(posts, 0);
  } finally { await service.close(); }
});

test("source-profile drift after native upload prevents creation of a reusable handle", async () => {
  const catalog = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
  const getModel = catalog.getModel.bind(catalog);
  let drifted = false;
  Object.defineProperty(catalog, "getModel", { value: (modelId: string) => {
    const model = getModel(modelId);
    return drifted ? { ...model, settings: { ...model.settings, max_file_size: 999 } } : model;
  } });
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    posts += 1;
    drifted = true;
    return Response.json({ files: [{ url: "https://r2.syntx.ai/runway/drift.png", mime_type: "image/png", size: PNG.byteLength }] });
  } });
  const service = new OwnerRunwayImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  try {
    await assert.rejects(service.upload({ attemptId: ATTEMPT, variant: "runway_frames", content_base64: PNG.toString("base64"), filename: "drift.png", mime_type: "image/png" }),
      (error: unknown) => error instanceof OwnerRunwayImageUploadServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts, 1);
    await assert.rejects(service.issueReferences({ attemptId: ATTEMPT, variant: "runway_frames", reference_handles: [] }),
      (error: unknown) => error instanceof OwnerRunwayImageUploadServiceError && error.code === "MODEL_BINDING_MISMATCH");
  } finally { await service.close(); }
});
