import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { CivitaiPinnedHttpsDownloadTransport } from "../src/adapter/civitai/pinned-https-download-transport.js";
import { CivitaiPublicModelFileClient } from "../src/adapter/civitai/public-model-file-client.js";
import { CivitaiPublicModelFileAttestor } from "../src/adapter/civitai/public-model-file-attestor.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { prepareOwnerFluxImageRequest } from "../src/application/owner-flux-image-request-preparer.js";
import { OwnerFluxImageAssetService, OwnerFluxImageAssetServiceError } from "../src/application/owner-flux-image-asset-service.js";
import { OwnerFluxImageUploadService } from "../src/application/owner-flux-image-upload-service.js";
import { getOwnerFluxImageSourceProfile } from "../src/application/owner-flux-image-source-profile.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const ATTEMPT = "link_flux_assets_test_0123456789";
const BINDING = Object.freeze({ tenant_id: "flux-assets-tenant", subject: "flux-assets-subject" });
const NOW = Date.parse("2026-10-11T00:00:00.000Z");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG = loadSelectedDiscoveryCatalog(VERSION).discoveryCatalog;
const SELECTED = Array.from({ length: 128 }, (_item, index) => ({ model_id: 101 + index, version_id: 202 + index, file_id: 303 + index }));
const PRINCIPAL = Object.freeze({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });
const LORA_HANDLES = [
  "flux_lora_00000000-0000-4000-8000-000000000001",
  "flux_lora_00000000-0000-4000-8000-000000000002",
  "flux_lora_00000000-0000-4000-8000-000000000003"
] as const;

function bytesFor(index: number): Buffer {
  const header = Buffer.from(JSON.stringify({ [`tensor_${index}`]: { dtype: "F32", shape: [2], data_offsets: [0, 8] } }), "utf8");
  const prefix = Buffer.alloc(8); prefix.writeBigUInt64LE(BigInt(header.byteLength));
  return Buffer.concat([prefix, header, Buffer.from([index, 1, 2, 3, 4, 5, 6, 7])]);
}
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function linkedAttempt(attemptId: string) { return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
  status: "LINKED" as const, expires_at: null, linked: true }; }
function broker(): SyntxCredentialBroker { return { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-flux-asset-credential"); } }; }

function makeFixture(options: { readonly now?: () => number; readonly gate?: Promise<void>; readonly imageUploadFetch?: typeof fetch;
  readonly metadataStatus?: number; readonly linkStatus?: (attemptId: string) => ReturnType<typeof linkedAttempt> } = {}) {
  const fetched: string[] = [];
  const requested: string[] = [];
  const assets = SELECTED.map((_selection, index) => bytesFor(index + 1));
  const metadataClient = new CivitaiPublicModelFileClient({ fetchImpl: async (input: RequestInfo | URL) => {
    const url = String(input); fetched.push(url);
    for (let i = 0; i < SELECTED.length; i++) {
      const item = SELECTED[i]!; const bytes = assets[i]!;
      if (url === `https://civitai.com/api/v1/model-versions/${item.version_id}`) {
        if (options.metadataStatus !== undefined) return new Response("synthetic private error sentinel", { status: options.metadataStatus });
        if (options.gate) await options.gate;
        return Response.json({ id: item.version_id, modelId: item.model_id, baseModel: "Flux.1 D", status: "Published",
          availability: "Public", usageControl: "Download", files: [{ id: item.file_id, type: "Model", name: "private-name.safetensors",
            primary: true, sizeKB: bytes.byteLength / 1024, metadata: { format: "SafeTensor" }, hashes: { SHA256: sha256(bytes) },
            virusScanResult: "Success", pickleScanResult: "Success",
            downloadUrl: `https://civitai.com/api/download/models/${item.version_id}?fileId=${item.file_id}` }] });
      }
      if (url === `https://civitai.com/api/v1/models/${item.model_id}`) {
        return Response.json({ id: item.model_id, type: "LORA", status: "Published", availability: "Public", mode: null,
          modelVersions: [{ id: item.version_id }], allowCommercialUse: null, allowNoCredit: null,
          allowDerivatives: null, allowDifferentLicense: null });
      }
    }
    return new Response("unexpected route", { status: 404 });
  } });
  const transport = new CivitaiPinnedHttpsDownloadTransport({ approvedOrigins: ["https://civitai.com"], ports: {
    dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async ({ hostname, path }: { readonly hostname: string; readonly path: string }) => {
      requested.push(`https://${hostname}${path}`);
      const match = SELECTED.findIndex((item) => path === `/api/download/models/${item.version_id}?fileId=${item.file_id}`);
      if (hostname !== "civitai.com" || match < 0) return { statusCode: 404, headers: {}, remoteAddress: "93.184.216.34",
        tlsAuthorized: true, body: (async function* () {})(), async cancel() {} };
      const bytes = assets[match]!;
      return { statusCode: 200, headers: { "content-length": String(bytes.byteLength), "content-type": "application/octet-stream",
        "content-encoding": "identity" }, remoteAddress: "93.184.216.34", tlsAuthorized: true,
        body: (async function* () { for (let offset = 0; offset < bytes.byteLength; offset += 7) yield bytes.subarray(offset, offset + 7); })(),
        async cancel() {} };
    }
  } });
  const attestor = new CivitaiPublicModelFileAttestor({ metadataClient, transport });
  const uploadClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: options.imageUploadFetch ?? (async () => {
    throw new Error("image upload was not expected");
  }) });
  const uploadService = new OwnerFluxImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return options.linkStatus?.(attemptId) ?? linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: VERSION, resolveClient: () => uploadClient, now: options.now ?? (() => NOW) });
  const service = new OwnerFluxImageAssetService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return options.linkStatus?.(attemptId) ?? linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: VERSION, uploadService, loraAttestor: attestor, now: options.now ?? (() => NOW) });
  return { service, uploadService, attestor, fetched, requested, assets };
}

function registerInput(i = 0) {
  const selected = SELECTED[i]!;
  return { attemptId: ATTEMPT, model_id: "flux-1" as const, model_id_source: selected.model_id,
    model_version_id: selected.version_id, file_id: selected.file_id };
}
const parameters = (loras: readonly { handle: string; strength_model: number; strength_clip: number }[]) => ({
  resolution: "1024x1024", cfg: 2.375, steps: 17.25, image_strength: 0.625,
  workflow_type: loras.length ? "civitai" as const : "default" as const, raw: null, civitai_loras: loras
});

test("three exact selected public LoRAs become opaque safe handles then preserve full 623 candidate wire bindings", async () => {
  const { service, fetched, requested } = makeFixture();
  try {
    const receipts: Awaited<ReturnType<typeof service.registerPublicLora>>[] = [];
    for (let i = 0; i < 3; i++) receipts.push(await service.registerPublicLora(registerInput(i)));
    assert.equal(fetched.length, 6);
    assert.deepEqual(requested, SELECTED.slice(0, 3).map((x) => `https://civitai.com/api/download/models/${x.version_id}?fileId=${x.file_id}`));
    for (let i = 0; i < 3; i++) {
      const receipt = receipts[i]!; const source = SELECTED[i]!;
      assert.equal(receipt.status, "verified"); assert.equal(receipt.source_model_id, source.model_id);
      assert.equal(receipt.model_version_id, source.version_id); assert.equal(receipt.file_id, source.file_id);
      assert.equal(receipt.sha256, `sha256:${sha256(bytesFor(i + 1))}`); assert.equal(receipt.expires_in_seconds, 900);
      assert.match(receipt.reference_handle, /^flux_lora_[0-9a-f-]{36}$/u);
      assert.equal(receipt.legal_approval, "NOT_ESTABLISHED"); assert.equal(receipt.license_compatibility, "UNPROVEN");
      assert.equal(receipt.backend_acceptance, "UNPROVEN");
      for (const secret of ["civitai.com", "private-name", "synthetic-only", "canonical_download_url", "tensor_"]) {
        assert.equal(JSON.stringify(receipt).includes(secret), false);
      }
    }
    const refs = receipts.map((receipt, i) => ({ handle: receipt.reference_handle,
      strength_model: [0, 0.375, 1.5][i]!, strength_clip: [0, 0.375, 1.5][i]! }));
    const set = await service.issueAssets({ attemptId: ATTEMPT, model_id: "flux-1", lora_references: refs });
    const candidate = prepareOwnerFluxImageRequest({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: "flux-1",
      parameters: parameters(refs), asset_set: set, prompt: "source-selected verified asset" },
    { catalog: CATALOG, catalog_version: VERSION, now: () => NOW });
    assert.equal(candidate.lora_assets.length, 3);
    assert.deepEqual(candidate.request.settings.civitai_loras, SELECTED.slice(0, 3).map((_, i) => ({
      id: String(SELECTED[i]!.version_id), url: `https://civitai.com/api/download/models/${SELECTED[i]!.version_id}?fileId=${SELECTED[i]!.file_id}`,
      strength_model: [0, 0.375, 1.5][i], strength_clip: [0, 0.375, 1.5][i]
    })));
    assert.equal(candidate.dispatch_allowed, false); assert.equal(candidate.backend_acceptance, "UNPROVEN");
    assert.equal(JSON.stringify(candidate).includes("civitai.com"), false);
  } finally { await service.close(); }
});

test("zero LoRAs are allowed; asset issuer handles empty and 0..3 requests without issuing synthetic ownership", async () => {
  const { service } = makeFixture();
  try {
    const set = await service.issueAssets({ attemptId: ATTEMPT, model_id: "flux-1", lora_references: [] });
    const candidate = prepareOwnerFluxImageRequest({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: "flux-1",
      parameters: parameters([]), asset_set: set, prompt: "zero references" }, { catalog: CATALOG, catalog_version: VERSION, now: () => NOW });
    assert.equal(candidate.lora_assets.length, 0); assert.equal(candidate.parameters.workflow_type, "default");
    assert.equal(candidate.dispatch_allowed, false);
    const revocable = await service.issueAssets({ attemptId: ATTEMPT, model_id: "flux-1", lora_references: [] });
    await service.invalidateAttempt(ATTEMPT);
    assert.throws(() => prepareOwnerFluxImageRequest({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: "flux-1",
      parameters: parameters([]), asset_set: revocable, prompt: "revoked set" }, { catalog: CATALOG, catalog_version: VERSION, now: () => NOW }));
  } finally { await service.close(); }
});

test("invalid, proxy, and caller-URL registrations fail before reads; wrong source selector is rejected before content GET", async () => {
  const { service, fetched, requested } = makeFixture();
  try {
    const badInputs: unknown[] = [
      { ...registerInput(), caller_url: "https://civitai.com/api/download/models/202?token=secret" },
      { ...registerInput(), provenance_verified: true },
      { ...registerInput(), file_id: "303" },
      { ...registerInput(), model_id: "flux-pro-1.1" },
      new Proxy(registerInput(), {})
    ];
    for (const input of badInputs) await assert.rejects(service.registerPublicLora(input),
      (error: unknown) => error instanceof OwnerFluxImageAssetServiceError && error.code === "INVALID_REQUEST");
    assert.equal(fetched.length, 0);
    const getter = Object.defineProperty(registerInput(), "model_id_source", { get() { throw new Error("must not run"); } });
    await assert.rejects(service.registerPublicLora(getter), (error: unknown) => error instanceof OwnerFluxImageAssetServiceError && error.code === "INVALID_REQUEST");
    assert.equal(fetched.length, 0);
    await assert.rejects(service.registerPublicLora({ ...registerInput(), model_id_source: 999 }),
      (error: unknown) => error instanceof OwnerFluxImageAssetServiceError && error.code === "ATTESTATION_FAILED");
    assert.equal(fetched.length, 1);
    assert.equal(requested.length, 0);
  } finally { await service.close(); }
});

test("only nominal actual 649 witnesses can resolve and cloned or caller-shaped handles stay unavailable", async () => {
  const { service } = makeFixture();
  try {
    const receipt = await service.registerPublicLora(registerInput());
    await assert.rejects(service.resolveLora({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: "flux-1", ai_name: "flux",
      scope: "image", operation_id: "generate-image", catalog_version: VERSION, profile_schema_hash: "sha256:" + "0".repeat(64),
      asset_handle: "flux_lora_00000000-0000-4000-8000-000000000001", asset_role: "lora", canonical_url: "https://civitai.com/forged" } as never),
    (error: unknown) => error instanceof OwnerFluxImageAssetServiceError && error.code === "INVALID_REQUEST");
    const profile = getOwnerFluxImageSourceProfile("flux-1", CATALOG, VERSION);
    const context = { principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: "flux-1" as const, ai_name: "flux" as const,
      scope: "image" as const, operation_id: "generate-image" as const, catalog_version: VERSION,
      profile_schema_hash: profile.profile_schema_hash, asset_handle: receipt.reference_handle, asset_role: "lora" as const };
    const resolved = await service.resolveLora(context);
    assert.equal(resolved.asset_id, String(SELECTED[0]!.version_id));
    assert.equal(resolved.canonical_url, `https://civitai.com/api/download/models/${SELECTED[0]!.version_id}?fileId=${SELECTED[0]!.file_id}`);
    assert.equal(resolved.provenance, "public_civitai_verified");
    await assert.rejects(service.resolveLora({ ...context, asset_handle: "flux_lora_00000000-0000-4000-8000-000000000099" }),
      (error: unknown) => error instanceof OwnerFluxImageAssetServiceError && error.code === "REFERENCE_UNAVAILABLE");
  } finally { await service.close(); }
});

test("original fifteen-minute expiry starts before attestation and never renews on use", async () => {
  let now = NOW;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { service } = makeFixture({ now: () => now, gate });
  try {
    const pending = service.registerPublicLora(registerInput());
    now += 14 * 60_000; release();
    const receipt = await pending;
    assert.equal(receipt.expires_in_seconds, 60);
    now += 60_001;
    const profile = getOwnerFluxImageSourceProfile("flux-1", CATALOG, VERSION);
    await assert.rejects(service.resolveLora({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: "flux-1", ai_name: "flux",
      scope: "image", operation_id: "generate-image", catalog_version: VERSION,
      profile_schema_hash: profile.profile_schema_hash, asset_handle: receipt.reference_handle, asset_role: "lora" }),
    (error: unknown) => error instanceof OwnerFluxImageAssetServiceError && error.code === "REFERENCE_EXPIRED");
  } finally { release(); await service.close(); }
});

test("late attestation cannot mint after invalidation; close aborts/drains and closes owned uploader", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { service } = makeFixture({ gate });
  const pending = service.registerPublicLora(registerInput());
  await new Promise((resolve) => setImmediate(resolve));
  const invalidating = service.invalidateAttempt(ATTEMPT);
  release();
  await invalidating;
  await assert.rejects(pending, (error: unknown) => error instanceof OwnerFluxImageAssetServiceError && error.code === "REQUEST_ABORTED");
  await service.close();
  await assert.rejects(service.issueAssets({ attemptId: ATTEMPT, model_id: "flux-1", lora_references: [] }),
    (error: unknown) => error instanceof OwnerFluxImageAssetServiceError && error.code === "SERVICE_CLOSED");
});

test("unlink during attestation drops the candidate handle", async () => {
  let reads = 0;
  const { service } = makeFixture({ linkStatus(attemptId) {
    reads++;
    return reads <= 1 ? linkedAttempt(attemptId) : { ...linkedAttempt(attemptId), status: "REVOKED" as never, linked: false };
  } });
  try {
    await assert.rejects(service.registerPublicLora(registerInput()),
      (error: unknown) => error instanceof OwnerFluxImageAssetServiceError && error.code === "PRINCIPAL_NOT_LINKED");
    assert.ok(reads >= 2);
    await assert.rejects(service.issueAssets({ attemptId: ATTEMPT, model_id: "flux-1", lora_references: [] }),
      (error: unknown) => error instanceof OwnerFluxImageAssetServiceError && error.code === "PRINCIPAL_NOT_LINKED");
  } finally { await service.close(); }
});

test("Civitai 401 is fixed/redacted and does not retry or expose response details", async () => {
  const { service, fetched } = makeFixture({ metadataStatus: 401 });
  try {
    await assert.rejects(service.registerPublicLora(registerInput()), (error: unknown) => {
      assert.ok(error instanceof OwnerFluxImageAssetServiceError); assert.equal(error.code, "ATTESTATION_FAILED");
      assert.equal(error.message.includes("civitai.com"), false); assert.equal(error.message.includes("synthetic-only"), false); return true;
    });
    assert.equal(fetched.length, 1);
  } finally { await service.close(); }
});

test("private URL, private R2-looking input, unknown source variants, and fake SHA never create a public record", async () => {
  const { service, fetched } = makeFixture();
  try {
    await assert.rejects(service.registerPublicLora({ ...registerInput(), canonical_url: "https://r2.syntx.ai/private/a" }));
    await assert.rejects(service.registerPublicLora({ ...registerInput(), sha256: `sha256:${"a".repeat(64)}` }));
    assert.equal(fetched.length, 0);
    await assert.rejects(service.issueAssets({ attemptId: ATTEMPT, model_id: "flux-pro-1.1", lora_references: [
      { handle: LORA_HANDLES[0], strength_model: 0.5, strength_clip: 0.5 }
    ] }));
    assert.equal(fetched.length, 0);
  } finally { await service.close(); }
});

test("a receipt stops resolving after the owner's linked attempt is revoked", async () => {
  let linked = true;
  const { service } = makeFixture({ linkStatus(attemptId) {
    return linked ? linkedAttempt(attemptId) : { ...linkedAttempt(attemptId), status: "REVOKED" as never, linked: false };
  } });
  try {
    const receipt = await service.registerPublicLora(registerInput());
    const profile = getOwnerFluxImageSourceProfile("flux-1", CATALOG, VERSION);
    linked = false;
    await assert.rejects(service.resolveLora({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: "flux-1", ai_name: "flux",
      scope: "image", operation_id: "generate-image", catalog_version: VERSION, profile_schema_hash: profile.profile_schema_hash,
      asset_handle: receipt.reference_handle, asset_role: "lora" }),
    (error: unknown) => error instanceof OwnerFluxImageAssetServiceError && error.code === "PRINCIPAL_NOT_LINKED");
  } finally { await service.close(); }
});

test("actual uploaded image and verified public LoRA join through the same nominal 623 asset set", async () => {
  const { service, uploadService } = makeFixture({ imageUploadFetch: async (_input, init) => {
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File); assert.equal(file.type, "image/png");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
    return Response.json({ files: [{ url: "https://r2.syntx.ai/private/flux/asset-image.png", mime_type: "image/png", size: PNG.byteLength }] });
  } });
  try {
    const image = await uploadService.upload({ attemptId: ATTEMPT, model_id: "flux-1", content_base64: PNG.toString("base64"),
      filename: "private-reference.png", mime_type: "image/png" });
    const lora = await service.registerPublicLora(registerInput());
    const refs = [{ handle: lora.reference_handle, strength_model: 0.75, strength_clip: 0.75 }];
    const set = await service.issueAssets({ attemptId: ATTEMPT, model_id: "flux-1", image_reference_handle: image.reference_handle, lora_references: refs });
    const candidate = prepareOwnerFluxImageRequest({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: "flux-1",
      parameters: parameters(refs), asset_set: set, prompt: "image plus selected verified LoRA" }, { catalog: CATALOG, catalog_version: VERSION, now: () => NOW });
    assert.equal(candidate.reference_count, 1); assert.equal(candidate.lora_assets.length, 1);
    assert.deepEqual(candidate.request.settings.file_urls, [{ type: "image", url: "https://r2.syntx.ai/private/flux/asset-image.png" }]);
    assert.deepEqual(candidate.request.settings.civitai_loras, [{ id: String(SELECTED[0]!.version_id),
      url: `https://civitai.com/api/download/models/${SELECTED[0]!.version_id}?fileId=${SELECTED[0]!.file_id}`,
      strength_model: 0.75, strength_clip: 0.75 }]);
    assert.equal(candidate.dispatch_allowed, false); assert.equal(candidate.backend_acceptance, "UNPROVEN");
  } finally { await service.close(); }
});

test("four pending registrations are bounded and the fifth is rejected before another metadata read", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { service, fetched } = makeFixture({ gate });
  try {
    const pending = Array.from({ length: 4 }, (_item, index) => service.registerPublicLora(registerInput(index)));
    await new Promise((resolve) => setImmediate(resolve));
    const reads = fetched.length;
    await assert.rejects(service.registerPublicLora(registerInput()),
      (error: unknown) => error instanceof OwnerFluxImageAssetServiceError && error.code === "SERVICE_BUSY");
    assert.equal(fetched.length, reads);
    release(); await Promise.all(pending);
  } finally { release(); await service.close(); }
});

test("128 verified records are bounded and a duplicate or 129th selection is rejected before metadata reads", async () => {
  const { service, fetched } = makeFixture();
  try {
    for (let i = 0; i < 128; i++) await service.registerPublicLora(registerInput(i));
    assert.equal(fetched.length, 256);
    await assert.rejects(service.registerPublicLora(registerInput(127)),
      (error: unknown) => error instanceof OwnerFluxImageAssetServiceError && error.code === "REFERENCE_UNAVAILABLE");
    await assert.rejects(service.registerPublicLora({ attemptId: ATTEMPT, model_id: "flux-1", model_id_source: 999,
      model_version_id: 999, file_id: 999 }),
      (error: unknown) => error instanceof OwnerFluxImageAssetServiceError && error.code === "CAPACITY_EXCEEDED");
    assert.equal(fetched.length, 256);
  } finally { await service.close(); }
});
