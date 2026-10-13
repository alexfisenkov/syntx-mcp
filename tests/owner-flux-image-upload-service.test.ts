import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { createOwnerFluxImageAssetBindingIssuer, prepareOwnerFluxImageRequest } from "../src/application/owner-flux-image-request-preparer.js";
import { OwnerFluxImageUploadService, OwnerFluxImageUploadServiceError } from "../src/application/owner-flux-image-upload-service.js";
import { getOwnerFluxImageSourceProfile } from "../src/application/owner-flux-image-source-profile.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const ATTEMPT = "link_flux_owned_upload_test_0123456789";
const BINDING = Object.freeze({ tenant_id: "flux-upload-tenant", subject: "flux-upload-subject" });
const NOW = Date.parse("2026-10-11T00:00:00.000Z");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const AVIF_16X16 = Buffer.from("AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAkAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAQAAAAEAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAsbWRhdAoKAAAAAZ/41fIAgDIWEACXgBBAggAAEABcEytNbG+TY8nR6A==", "base64");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x12, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 5, 0, 0, 0, 0x2f, 0, 0, 0, 0, 0]);
const AVIF = Buffer.from("AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAkAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAUaXNpcGUAAAAAAAAAEAAAAhAAAAEgAAAABwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAsbWRhdAoKAAAAAZ/41fIAgDIWEACXgBBAggAAEABcEytNbG+TY8nR6A==", "base64");
const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG = loadSelectedDiscoveryCatalog(CATALOG_VERSION).discoveryCatalog;

function credentialBroker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation("synthetic-flux-upload-credential"); } };
}
function linkedAttempt(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: null, linked: true };
}

test("owned Flux image receipt resolves through the real 623 issuer without exposing its private URL", async () => {
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (input, init) => {
    posts += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    const form = init?.body as FormData;
    assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(form.get("destination"), "uploaded");
    assert.equal(form.get("check_duplicates"), "true");
    assert.equal(form.get("model_type"), "flux-1");
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.type, "image/png");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
    return Response.json({ files: [{ id: "native-flux-file-7", url: "https://r2.syntx.ai/private/flux/object-7.png",
      mime_type: "image/png", size: PNG.byteLength }] });
  } });
  const service = new OwnerFluxImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT };
  try {
    const receipt = await service.upload({ attemptId: ATTEMPT, model_id: "flux-1", content_base64: PNG.toString("base64"),
      filename: "reference.png", mime_type: "image/png" });
    assert.equal(posts, 1);
    assert.equal(receipt.status, "uploaded");
    assert.equal(receipt.model_id, "flux-1");
    assert.match(receipt.reference_handle, /^flux_image_[0-9a-f-]{36}$/u);
    assert.equal(receipt.mime_type, "image/png");
    assert.equal(receipt.size, PNG.byteLength);
    assert.equal(receipt.expires_in_seconds, 900);
    for (const privateValue of ["r2.syntx.ai", "native-flux-file-7", "reference.png", BINDING.subject]) {
      assert.equal(JSON.stringify(receipt).includes(privateValue), false);
    }

    const profile = getOwnerFluxImageSourceProfile("flux-1", CATALOG, CATALOG_VERSION);
    const resolved = await service.resolveImage({ principal, attempt_id: ATTEMPT, model_id: "flux-1", ai_name: "flux", scope: "image",
      operation_id: "generate-image", catalog_version: CATALOG_VERSION, profile_schema_hash: profile.profile_schema_hash,
      asset_handle: receipt.reference_handle, asset_role: "image_reference" });
    assert.equal(resolved.provenance, "private_r2_owned");
    assert.equal(resolved.asset_id, "object-7.png");
    assert.equal(resolved.canonical_url, "https://r2.syntx.ai/private/flux/object-7.png");
    const resolverContext = { principal, attempt_id: ATTEMPT, model_id: "flux-1" as const, ai_name: "flux" as const, scope: "image" as const,
      operation_id: "generate-image" as const, catalog_version: CATALOG_VERSION, profile_schema_hash: profile.profile_schema_hash,
      asset_handle: receipt.reference_handle, asset_role: "image_reference" as const };
    await assert.rejects(service.resolveImage({ ...resolverContext, principal: { ...principal, subject_id: "foreign-subject" } }),
      (error: unknown) => error instanceof OwnerFluxImageUploadServiceError && error.code === "REFERENCE_UNAVAILABLE");
    await assert.rejects(service.resolveImage({ ...resolverContext, model_id: "flux-pro-1.1" } as never),
      (error: unknown) => error instanceof OwnerFluxImageUploadServiceError && error.code === "REFERENCE_UNAVAILABLE");
    await assert.rejects(service.resolveImage({ ...resolverContext, profile_schema_hash: `sha256:${"0".repeat(64)}` }),
      (error: unknown) => error instanceof OwnerFluxImageUploadServiceError && error.code === "MODEL_BINDING_MISMATCH");

    const issuer = createOwnerFluxImageAssetBindingIssuer({ resolveImage: service.resolveImage,
      async resolveLora() { throw new Error("no LoRA resolver call for image-only test"); } },
    { catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => NOW });
    try {
      const assetSet = await issuer.issue({ principal, attempt_id: ATTEMPT, model_id: "flux-1",
        image_reference_handle: receipt.reference_handle, lora_references: [] });
      assert.equal(assetSet.image_reference_count, 1);
      assert.equal(assetSet.lora_count, 0);
      const candidate = prepareOwnerFluxImageRequest({ principal, attempt_id: ATTEMPT, model_id: "flux-1", asset_set: assetSet,
        prompt: "source-bound image reference", parameters: { resolution: "1024x1024", cfg: 2, steps: 16,
          image_strength: 0.5, workflow_type: "default", raw: null, civitai_loras: [] } },
      { catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => NOW });
      assert.equal(candidate.reference_count, 1);
      assert.equal(candidate.references[0]?.sha256.startsWith("sha256:"), true);
      assert.equal(candidate.dispatch_allowed, false);
      assert.equal(candidate.backend_acceptance, "UNPROVEN");
      assert.equal(JSON.stringify(candidate).includes("r2.syntx.ai"), false);
    } finally { issuer.close(); }
  } finally { await service.close(); }
});

test("Flux-1 upload preserves the accepted JPG alias and canonicalizes native multipart MIME", async () => {
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (_input, init) => {
    posts += 1;
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    assert.equal(file.type, "image/jpeg");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), JPEG);
    return Response.json({ files: [{ url: "https://r2.syntx.ai/private/flux/alias.jpg", mime_type: "image/jpeg", size: JPEG.byteLength }] });
  } });
  const service = new OwnerFluxImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  try {
    const receipt = await service.upload({ attemptId: ATTEMPT, model_id: "flux-1", content_base64: JPEG.toString("base64"),
      filename: "alias.jpg", mime_type: "image/jpg" });
    assert.equal(posts, 1);
    assert.equal(receipt.source_mime_type, "image/jpg");
    assert.equal(receipt.mime_type, "image/jpeg");
  } finally { await service.close(); }
});

test("Flux owner upload preserves all five declared source MIME cases and canonical wire MIME", async () => {
  const cases = [
    { bytes: JPEG, source: "image/jpeg", canonical: "image/jpeg" },
    { bytes: JPEG, source: "image/jpg", canonical: "image/jpeg" },
    { bytes: PNG, source: "image/png", canonical: "image/png" },
    { bytes: WEBP, source: "image/webp", canonical: "image/webp" },
    { bytes: AVIF_16X16, source: "image/avif", canonical: "image/avif" }
  ] as const;
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (_input, init) => {
    const current = cases[posts++]!;
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    assert.equal(file.type, current.canonical);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), current.bytes);
    return Response.json({ files: [{ url: `https://r2.syntx.ai/private/flux/mime-${posts}`, mime_type: current.canonical, size: current.bytes.byteLength }] });
  } });
  const service = new OwnerFluxImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  try {
    const receipts = [];
    for (const item of cases) {
      try {
        receipts.push(await service.upload({ attemptId: ATTEMPT, model_id: "flux-1",
          content_base64: item.bytes.toString("base64"), filename: "source.img", mime_type: item.source }));
      } catch (error) { assert.fail(`${item.source}: ${error instanceof OwnerFluxImageUploadServiceError ? error.code : "unexpected failure"}`); }
    }
    assert.deepEqual(receipts.map(({ source_mime_type }) => source_mime_type), cases.map(({ source }) => source));
    assert.deepEqual(receipts.map(({ mime_type }) => mime_type), cases.map(({ canonical }) => canonical));
    assert.equal(posts, 5);
  } finally { await service.close(); }
});

test("Flux image handle keeps its original 15-minute expiry and cannot be renewed by resolving", async () => {
  let now = NOW;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => Response.json({
    files: [{ url: "https://r2.syntx.ai/private/flux/ttl.png", mime_type: "image/png", size: PNG.byteLength }]
  }) });
  const service = new OwnerFluxImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => now });
  const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT };
  const profile = getOwnerFluxImageSourceProfile("flux-1", CATALOG, CATALOG_VERSION);
  try {
    const receipt = await service.upload({ attemptId: ATTEMPT, model_id: "flux-1", content_base64: PNG.toString("base64"),
      filename: "ttl.png", mime_type: "image/png" });
    now = NOW + 14 * 60_000;
    const resolved = await service.resolveImage({ principal, attempt_id: ATTEMPT, model_id: "flux-1", ai_name: "flux", scope: "image",
      operation_id: "generate-image", catalog_version: CATALOG_VERSION, profile_schema_hash: profile.profile_schema_hash,
      asset_handle: receipt.reference_handle, asset_role: "image_reference" });
    assert.equal(resolved.expires_at, NOW + 15 * 60_000);
    now = NOW + 15 * 60_000;
    await assert.rejects(service.resolveImage({ principal, attempt_id: ATTEMPT, model_id: "flux-1", ai_name: "flux", scope: "image",
      operation_id: "generate-image", catalog_version: CATALOG_VERSION, profile_schema_hash: profile.profile_schema_hash,
      asset_handle: receipt.reference_handle, asset_role: "image_reference" }),
    (error: unknown) => error instanceof OwnerFluxImageUploadServiceError &&
      (error.code === "REFERENCE_EXPIRED" || error.code === "REFERENCE_UNAVAILABLE"));
  } finally { await service.close(); }
});

test("Flux attempt invalidation revokes an already-issued image handle", async () => {
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    posts += 1;
    return Response.json({ files: [{ url: "https://r2.syntx.ai/private/flux/revoked.png", mime_type: "image/png", size: PNG.byteLength }] });
  } });
  const service = new OwnerFluxImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT };
  const profile = getOwnerFluxImageSourceProfile("flux-1", CATALOG, CATALOG_VERSION);
  try {
    const receipt = await service.upload({ attemptId: ATTEMPT, model_id: "flux-1", content_base64: PNG.toString("base64"),
      filename: "revoked.png", mime_type: "image/png" });
    await service.invalidateAttempt(ATTEMPT);
    await assert.rejects(service.resolveImage({ principal, attempt_id: ATTEMPT, model_id: "flux-1", ai_name: "flux", scope: "image",
      operation_id: "generate-image", catalog_version: CATALOG_VERSION, profile_schema_hash: profile.profile_schema_hash,
      asset_handle: receipt.reference_handle, asset_role: "image_reference" }),
    (error: unknown) => error instanceof OwnerFluxImageUploadServiceError && error.code === "REFERENCE_UNAVAILABLE");
    assert.equal(posts, 1);
  } finally { await service.close(); }
});

test("Flux linked-attempt revocation invalidates the prior principal and issued handle", async () => {
  let linked = true, posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    posts += 1;
    return Response.json({ files: [{ url: "https://r2.syntx.ai/private/flux/relinked.png", mime_type: "image/png", size: PNG.byteLength }] });
  } });
  const service = new OwnerFluxImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linked ? linkedAttempt(attemptId) : {
      ...linkedAttempt(attemptId), status: "REVOKED" as const, linked: false }; } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT };
  const profile = getOwnerFluxImageSourceProfile("flux-1", CATALOG, CATALOG_VERSION);
  try {
    const receipt = await service.upload({ attemptId: ATTEMPT, model_id: "flux-1", content_base64: PNG.toString("base64"),
      filename: "relinked.png", mime_type: "image/png" });
    linked = false;
    const context = { principal, attempt_id: ATTEMPT, model_id: "flux-1" as const, ai_name: "flux" as const, scope: "image" as const,
      operation_id: "generate-image" as const, catalog_version: CATALOG_VERSION, profile_schema_hash: profile.profile_schema_hash,
      asset_handle: receipt.reference_handle, asset_role: "image_reference" as const };
    await assert.rejects(service.resolveImage(context),
      (error: unknown) => error instanceof OwnerFluxImageUploadServiceError && error.code === "PRINCIPAL_NOT_LINKED");
    await assert.rejects(service.resolveImage(context),
      (error: unknown) => error instanceof OwnerFluxImageUploadServiceError && error.code === "REFERENCE_UNAVAILABLE");
    assert.equal(posts, 1);
  } finally { await service.close(); }
});

test("Flux upload rejects accessor, proxy, sparse, and spoofed-image input before link or native calls", async () => {
  let linkCalls = 0, clientResolutions = 0, posts = 0, getterCalls = 0, proxyTraps = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    posts += 1;
    return Response.json({ files: [{ url: "https://r2.syntx.ai/private/flux/unused.png", mime_type: "image/png", size: PNG.byteLength }] });
  } });
  const service = new OwnerFluxImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { linkCalls += 1; return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => { clientResolutions += 1; return client; }, now: () => NOW });
  const good = { attemptId: ATTEMPT, model_id: "flux-1", content_base64: PNG.toString("base64"), filename: "source.png", mime_type: "image/png" };
  const getterDto = Object.defineProperties({}, {
    attemptId: { enumerable: true, get: () => { getterCalls += 1; return ATTEMPT; } },
    model_id: { enumerable: true, value: "flux-1" }, content_base64: { enumerable: true, value: good.content_base64 },
    filename: { enumerable: true, value: good.filename }, mime_type: { enumerable: true, value: good.mime_type }
  });
  const proxyDto = new Proxy({}, { get: () => { proxyTraps += 1; throw new Error("unexpected proxy read"); } });
  try {
    for (const invalid of [getterDto, proxyDto, { attemptId: ATTEMPT, model_id: "flux-1", content_base64: good.content_base64,
      mime_type: "image/png" }]) await assert.rejects(service.upload(invalid),
    (error: unknown) => error instanceof OwnerFluxImageUploadServiceError && error.code === "INVALID_REQUEST");
    await assert.rejects(service.upload({ ...good, content_base64: JPEG.toString("base64") }),
      (error: unknown) => error instanceof OwnerFluxImageUploadServiceError && error.code === "INVALID_IMAGE_INPUT");
    assert.equal(getterCalls, 0); assert.equal(proxyTraps, 0);
    assert.equal(linkCalls, 0); assert.equal(clientResolutions, 0); assert.equal(posts, 0);
  } finally { await service.close(); }
});

test("Flux late upload acknowledgement after attempt revoke stays unknown, drains, and is never retried", async () => {
  let posts = 0, markStarted!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    posts += 1; markStarted(); await gate;
    return Response.json({ files: [{ url: "https://r2.syntx.ai/private/flux/late.png", mime_type: "image/png", size: PNG.byteLength }] });
  } });
  const service = new OwnerFluxImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  try {
    const upload = service.upload({ attemptId: ATTEMPT, model_id: "flux-1", content_base64: PNG.toString("base64"),
      filename: "late.png", mime_type: "image/png" });
    await started;
    const revoked = service.invalidateAttempt(ATTEMPT);
    release();
    await assert.rejects(upload, (error: unknown) => error instanceof OwnerFluxImageUploadServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    await revoked;
    assert.equal(posts, 1);
  } finally { release(); await service.close(); }
});

test("Flux owner upload enforces the four-operation pending ceiling before a fifth native call", async () => {
  let posts = 0, release!: () => void, markFourStarted!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fourStarted = new Promise<void>((resolve) => { markFourStarted = resolve; });
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    posts += 1; if (posts === 4) markFourStarted(); await gate;
    return Response.json({ files: [{ url: `https://r2.syntx.ai/private/flux/pending-${posts}.png`, mime_type: "image/png", size: PNG.byteLength }] });
  } });
  const service = new OwnerFluxImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const request = { attemptId: ATTEMPT, model_id: "flux-1" as const, content_base64: PNG.toString("base64"), filename: "pending.png", mime_type: "image/png" };
  try {
    const pending = Array.from({ length: 4 }, () => service.upload(request));
    await fourStarted;
    await assert.rejects(service.upload(request),
      (error: unknown) => error instanceof OwnerFluxImageUploadServiceError && error.code === "SERVICE_BUSY");
    assert.equal(posts, 4);
    release();
    await Promise.all(pending);
  } finally { release(); await service.close(); }
});

test("Flux owner upload enforces the 128-record cap before a 129th native call", async () => {
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    posts += 1;
    return Response.json({ files: [{ url: `https://r2.syntx.ai/private/flux/cap-${posts}.png`, mime_type: "image/png", size: PNG.byteLength }] });
  } });
  const service = new OwnerFluxImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const request = { attemptId: ATTEMPT, model_id: "flux-1" as const, content_base64: PNG.toString("base64"), filename: "cap.png", mime_type: "image/png" };
  try {
    for (let index = 0; index < 128; index += 1) await service.upload(request);
    await assert.rejects(service.upload(request),
      (error: unknown) => error instanceof OwnerFluxImageUploadServiceError && error.code === "CAPACITY_EXCEEDED");
    assert.equal(posts, 128);
  } finally { await service.close(); }
});

test("Flux close aborts and drains a pending upload without retry or a handle", async () => {
  let posts = 0, markStarted!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    posts += 1; markStarted(); await gate;
    return Response.json({ files: [{ url: "https://r2.syntx.ai/private/flux/closed.png", mime_type: "image/png", size: PNG.byteLength }] });
  } });
  const service = new OwnerFluxImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const upload = service.upload({ attemptId: ATTEMPT, model_id: "flux-1", content_base64: PNG.toString("base64"),
    filename: "closed.png", mime_type: "image/png" });
  await started;
  const closed = service.close();
  release();
  await assert.rejects(upload, (error: unknown) => error instanceof OwnerFluxImageUploadServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
  await closed;
  assert.equal(posts, 1);
});

test("Pro and Ultra image uploads and unsupported Flux-1 MIME stop before auth or native upload", async () => {
  let linkCalls = 0, clientResolutions = 0, posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    posts += 1;
    return Response.json({ files: [{ url: "https://r2.syntx.ai/private/flux/unused.png", mime_type: "image/png", size: PNG.byteLength }] });
  } });
  const service = new OwnerFluxImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { linkCalls += 1; return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => { clientResolutions += 1; return client; }, now: () => NOW });
  try {
    for (const model_id of ["flux-pro-1.1", "flux-pro-1.1-ultra"]) await assert.rejects(service.upload({ attemptId: ATTEMPT,
      model_id, content_base64: PNG.toString("base64"), filename: "source.png", mime_type: "image/png" }),
    (error: unknown) => error instanceof OwnerFluxImageUploadServiceError && error.code === "INVALID_REQUEST");
    await assert.rejects(service.upload({ attemptId: ATTEMPT, model_id: "flux-1", content_base64: PNG.toString("base64"),
      filename: "unsupported.gif", mime_type: "image/gif" }),
    (error: unknown) => error instanceof OwnerFluxImageUploadServiceError && error.code === "INVALID_IMAGE_INPUT");
    await assert.rejects(service.upload({ attemptId: ATTEMPT, model_id: "flux-1", content_base64: AVIF.toString("base64"),
      filename: "malformed.avif", mime_type: "image/avif" }),
    (error: unknown) => error instanceof OwnerFluxImageUploadServiceError && error.code === "INVALID_IMAGE_INPUT");
    assert.equal(linkCalls, 0);
    assert.equal(clientResolutions, 0);
    assert.equal(posts, 0);
  } finally { await service.close(); }
});
