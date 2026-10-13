import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import { OwnerGrokT2iImageUploadService } from "../src/application/owner-grok-t2i-image-upload-service.js";
import { createOwnerGrokT2iRequestPreparer } from "../src/application/owner-grok-t2i-request-preparer.js";
import type { OwnerGrokT2iCatalogPort } from "../src/application/owner-grok-t2i-source-profile.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const BASE = Date.parse("2026-10-11T00:00:00.000Z");
const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(CATALOG_VERSION, resolve(process.cwd(), "catalog")));
const BINDING = Object.freeze({ tenant_id: "grok-once-tenant", subject: "grok-once-owner" });
const ATTEMPT = "link_grok_once_00000000000000001";
const PRINCIPAL = Object.freeze({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);

async function policyModule(): Promise<Record<string, unknown>> {
  const href = new URL("../src/application/owner-grok-t2i-one-shot-policy.js", import.meta.url).href;
  let module: Record<string, unknown> | null = null;
  try { module = await import(href) as Record<string, unknown>; } catch { /* expected RED while policy is absent */ }
  assert.equal(typeof module?.createOwnerGrokT2iOneShotPermit, "function", "MISSING_OWNER_GROK_T2I_ONESHOT_ISSUER");
  assert.equal(typeof module?.consumeOwnerGrokT2iOneShotPermit, "function", "MISSING_OWNER_GROK_T2I_ONESHOT_CONSUMER");
  return module!;
}

function credentialBroker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-grok-once-credential"); } };
}

function jpegWithWidth(width: number): Buffer {
  const bytes = Buffer.from(JPEG);
  bytes[9] = (width >>> 8) & 0xff;
  bytes[10] = width & 0xff;
  return bytes;
}

async function makeCandidate(modelId: "grok_t2i" | "grok_t2i_pro" | "grok_imagine_2" | "grok_imagine_quality" = "grok_t2i",
  referenceCount = 0) {
  let posts = 0;
  let now = BASE;
  const links = { async getStatus(_binding: unknown, attemptId: string) {
    return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "LINKED", expires_at: null, linked: true };
  } };
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    posts += 1;
    return Response.json({ files: [{ id: `grok-once-${posts}`, url: `https://r2.syntx.ai/private/grok/once-${posts}.jpg`,
      mime_type: "image/jpeg", size: JPEG.byteLength }] });
  } });
  const uploadService = new OwnerGrokT2iImageUploadService({ binding: BINDING, linkService: links,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => client });
  const preparer = createOwnerGrokT2iRequestPreparer({ binding: BINDING, linkService: links,
    imageUploadService: uploadService, catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => now });
  const handles: string[] = [];
  for (let index = 0; index < referenceCount; index += 1) {
    const bytes = jpegWithWidth(index + 1);
    const receipt = await uploadService.upload({ attemptId: ATTEMPT, model_id: modelId, content_base64: bytes.toString("base64"),
      filename: `once-${index + 1}.jpg`, mime_type: "image/jpeg" });
    assert.match(receipt.reference_handle, /^grok_t2i_image_[0-9a-f-]{36}$/u);
    handles.push(String(receipt.reference_handle));
  }
  const parameters = { aspect_ratio: referenceCount > 0 ? "16:9" : "1:1", resolution: "1k", batch_size: 1,
    ...(modelId === "grok_imagine_2" ? { details_quality: "low" } : {}) };
  const assetSet = await preparer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: modelId,
    prompt: "Once only", parameters, reference_handles: handles });
  const candidate = await preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: assetSet });
  return { assetSet, candidate, preparer, uploadService, posts: () => posts, now: (value?: number) => value === undefined ? now : (now = value) };
}

test("one-shot permit binds the real candidate, consumes once, and creates no POST", async () => {
  const api = await policyModule();
  const createPermit = api.createOwnerGrokT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const consumePermit = api.consumeOwnerGrokT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const fixture = await makeCandidate();
  try {
    const permit = createPermit({ preparer: fixture.preparer, candidate: fixture.candidate, principal: PRINCIPAL,
      attemptId: ATTEMPT, catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => fixture.now() });
    assert.equal(permit.status, "nominal");
    assert.equal(permit.dispatch_allowed, false);
    assert.equal(permit.backend_acceptance, "UNPROVEN");
    assert.equal(JSON.stringify(permit).includes("Once only"), false);
    assert.deepEqual(consumePermit({ permit, candidate: fixture.candidate, principal: PRINCIPAL, attemptId: ATTEMPT }), {
      status: "consumed", dispatch_allowed: false, request_fingerprint: fixture.candidate.request_fingerprint
    });
    assert.throws(() => consumePermit({ permit, candidate: fixture.candidate, principal: PRINCIPAL, attemptId: ATTEMPT }),
      (error: unknown) => (error as { code?: string }).code === "PERMIT_ALREADY_CONSUMED");
    assert.equal(fixture.posts(), 0);
  } finally { await fixture.preparer.close(); await fixture.uploadService.close(); }
});

test("a real prepared candidate cannot issue a second permit", async () => {
  const api = await policyModule();
  const createPermit = api.createOwnerGrokT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const fixture = await makeCandidate();
  try {
    createPermit({ preparer: fixture.preparer, candidate: fixture.candidate, principal: PRINCIPAL,
      attemptId: ATTEMPT, catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => fixture.now() });
    assert.throws(() => createPermit({ preparer: fixture.preparer, candidate: fixture.candidate, principal: PRINCIPAL,
      attemptId: ATTEMPT, catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => fixture.now() }),
      (error: unknown) => (error as { code?: string }).code === "CANDIDATE_ALREADY_ISSUED");
  } finally { await fixture.preparer.close(); await fixture.uploadService.close(); }
});

test("candidate clones and proxies cannot mint a nominal permit", async () => {
  const api = await policyModule();
  const createPermit = api.createOwnerGrokT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const fixture = await makeCandidate();
  try {
    const clone = Object.freeze({ ...fixture.candidate });
    assert.throws(() => createPermit({ preparer: fixture.preparer, candidate: clone, principal: PRINCIPAL,
      attemptId: ATTEMPT, catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => fixture.now() }),
      (error: unknown) => (error as { code?: string }).code === "CANDIDATE_UNBOUND");
    assert.throws(() => createPermit({ preparer: fixture.preparer, candidate: new Proxy(fixture.candidate, {}), principal: PRINCIPAL,
      attemptId: ATTEMPT, catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => fixture.now() }),
      (error: unknown) => (error as { code?: string }).code === "CANDIDATE_UNBOUND");
  } finally { await fixture.preparer.close(); await fixture.uploadService.close(); }
});

test("a permit is bound to its owner principal and attempt", async () => {
  const api = await policyModule();
  const createPermit = api.createOwnerGrokT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const consumePermit = api.consumeOwnerGrokT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const fixture = await makeCandidate();
  try {
    const permit = createPermit({ preparer: fixture.preparer, candidate: fixture.candidate, principal: PRINCIPAL,
      attemptId: ATTEMPT, catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => fixture.now() });
    const otherPrincipal = Object.freeze({ ...PRINCIPAL, subject_id: "other-grok-once-owner" });
    assert.throws(() => consumePermit({ permit, candidate: fixture.candidate, principal: otherPrincipal, attemptId: ATTEMPT }),
      (error: unknown) => (error as { code?: string }).code === "PRINCIPAL_MISMATCH");
    const otherAttempt = "link_grok_once_other_0000000000001";
    assert.throws(() => consumePermit({ permit, candidate: fixture.candidate,
      principal: { ...PRINCIPAL, connection_id: otherAttempt }, attemptId: otherAttempt }),
      (error: unknown) => (error as { code?: string }).code === "PRINCIPAL_MISMATCH");
    assert.equal(consumePermit({ permit, candidate: fixture.candidate, principal: PRINCIPAL, attemptId: ATTEMPT }).status, "consumed");
  } finally { await fixture.preparer.close(); await fixture.uploadService.close(); }
});

test("prepare reuse cannot renew the original asset TTL or extend a late-issued permit", async () => {
  const api = await policyModule();
  const createPermit = api.createOwnerGrokT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const fixture = await makeCandidate();
  try {
    const candidate = await fixture.preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: fixture.assetSet });
    assert.equal(candidate.expires_at, fixture.candidate.expires_at);
    fixture.now(BASE + 14 * 60_000);
    const permit = createPermit({ preparer: fixture.preparer, candidate, principal: PRINCIPAL,
      attemptId: ATTEMPT, catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => fixture.now() });
    assert.equal(permit.expires_at, fixture.candidate.expires_at);
    assert.equal((permit.expires_at as number) - fixture.now(), 60_000);
    fixture.now(fixture.candidate.expires_at);
    assert.throws(() => (api.consumeOwnerGrokT2iOneShotPermit as (input: unknown) => unknown)(
      { permit, candidate, principal: PRINCIPAL, attemptId: ATTEMPT }),
      (error: unknown) => (error as { code?: string }).code === "PERMIT_EXPIRED");
    assert.equal(fixture.posts(), 0);
  } finally { await fixture.preparer.close(); await fixture.uploadService.close(); }
});

test("real preparer candidates cover all four no-reference models and owned maximum reference sets", async () => {
  const api = await policyModule();
  const createPermit = api.createOwnerGrokT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const consumePermit = api.consumeOwnerGrokT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const cases = [
    { model: "grok_t2i", references: 0 },
    { model: "grok_t2i_pro", references: 0 },
    { model: "grok_imagine_2", references: 0 },
    { model: "grok_imagine_quality", references: 0 },
    { model: "grok_imagine_2", references: 5 },
    { model: "grok_imagine_quality", references: 3 }
  ] as const;
  const fixtures = [];
  try {
    for (const entry of cases) {
      const fixture = await makeCandidate(entry.model, entry.references);
      fixtures.push(fixture);
      const permit = createPermit({ preparer: fixture.preparer, candidate: fixture.candidate, principal: PRINCIPAL,
        attemptId: ATTEMPT, catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => fixture.now() });
      assert.equal(fixture.candidate.reference_count, entry.references);
      assert.equal(fixture.posts(), entry.references, "only the real reference upload POSTs occurred");
      assert.equal(JSON.stringify(permit).includes("r2.syntx.ai"), false);
      assert.equal(Object.hasOwn(permit, "cost_inputs"), false);
      assert.equal(consumePermit({ permit, candidate: fixture.candidate, principal: PRINCIPAL, attemptId: ATTEMPT }).status, "consumed");
      assert.equal(fixture.posts(), entry.references, "permit issue and consume perform no POST");
    }
  } finally {
    for (const fixture of fixtures) { await fixture.preparer.close(); await fixture.uploadService.close(); }
  }
});

test("synchronous preparer revocation invalidates a nominal permit before use", async () => {
  const api = await policyModule();
  const createPermit = api.createOwnerGrokT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const consumePermit = api.consumeOwnerGrokT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const fixture = await makeCandidate();
  try {
    const permit = createPermit({ preparer: fixture.preparer, candidate: fixture.candidate, principal: PRINCIPAL,
      attemptId: ATTEMPT, catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => fixture.now() });
    await fixture.preparer.invalidateAttempt(ATTEMPT);
    assert.throws(() => consumePermit({ permit, candidate: fixture.candidate, principal: PRINCIPAL, attemptId: ATTEMPT }),
      (error: unknown) => (error as { code?: string }).code === "CANDIDATE_UNBOUND");
    assert.equal(fixture.posts(), 0);
  } finally { await fixture.preparer.close(); await fixture.uploadService.close(); }
});

test("policy clock rollback permanently invalidates the permit", async () => {
  const api = await policyModule();
  const createPermit = api.createOwnerGrokT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const consumePermit = api.consumeOwnerGrokT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const fixture = await makeCandidate();
  try {
    const permit = createPermit({ preparer: fixture.preparer, candidate: fixture.candidate, principal: PRINCIPAL,
      attemptId: ATTEMPT, catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => fixture.now() });
    fixture.now(BASE - 1);
    assert.throws(() => consumePermit({ permit, candidate: fixture.candidate, principal: PRINCIPAL, attemptId: ATTEMPT }),
      (error: unknown) => (error as { code?: string }).code === "CLOCK_INVALID");
    fixture.now(BASE + 1);
    assert.throws(() => consumePermit({ permit, candidate: fixture.candidate, principal: PRINCIPAL, attemptId: ATTEMPT }),
      (error: unknown) => (error as { code?: string }).code === "PERMIT_EXPIRED");
  } finally { await fixture.preparer.close(); await fixture.uploadService.close(); }
});

test("catalog source-record drift invalidates an already issued permit", async () => {
  const api = await policyModule();
  const createPermit = api.createOwnerGrokT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const consumePermit = api.consumeOwnerGrokT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const fixture = await makeCandidate();
  let drifted = false;
  const catalog = {
    catalog_kind: CATALOG.catalog_kind,
    runtime_usable: CATALOG.runtime_usable,
    fetched_at: CATALOG.fetched_at,
    source_hashes: CATALOG.source_hashes,
    catalog_metadata: CATALOG.catalog_metadata,
    getModel(modelId: string) {
      const record = CATALOG.getModel(modelId);
      return drifted ? { ...record, description: "mutated source record" } : record;
    }
  } as OwnerGrokT2iCatalogPort;
  try {
    assert.throws(() => createPermit({ preparer: fixture.preparer, candidate: fixture.candidate, principal: PRINCIPAL,
      attemptId: ATTEMPT, catalog, catalog_version: "sha256-foreign.json", now: () => fixture.now() }),
      (error: unknown) => (error as { code?: string }).code === "CATALOG_BINDING_MISMATCH");
    const permit = createPermit({ preparer: fixture.preparer, candidate: fixture.candidate, principal: PRINCIPAL,
      attemptId: ATTEMPT, catalog, catalog_version: CATALOG_VERSION, now: () => fixture.now() });
    drifted = true;
    assert.throws(() => consumePermit({ permit, candidate: fixture.candidate, principal: PRINCIPAL, attemptId: ATTEMPT }),
      (error: unknown) => (error as { code?: string }).code === "CATALOG_BINDING_MISMATCH");
    assert.equal(fixture.posts(), 0);
  } finally { await fixture.preparer.close(); await fixture.uploadService.close(); }
});

test("forged permit copies cannot consume the WeakMap-issued original permit", async () => {
  const api = await policyModule();
  const createPermit = api.createOwnerGrokT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const consumePermit = api.consumeOwnerGrokT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const fixture = await makeCandidate();
  try {
    const permit = createPermit({ preparer: fixture.preparer, candidate: fixture.candidate, principal: PRINCIPAL,
      attemptId: ATTEMPT, catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => fixture.now() });
    const forged = Object.freeze({ ...permit });
    assert.throws(() => consumePermit({ permit: forged, candidate: fixture.candidate, principal: PRINCIPAL, attemptId: ATTEMPT }),
      (error: unknown) => (error as { code?: string }).code === "PERMIT_INVALID");
    assert.equal(consumePermit({ permit, candidate: fixture.candidate, principal: PRINCIPAL, attemptId: ATTEMPT }).status, "consumed");
  } finally { await fixture.preparer.close(); await fixture.uploadService.close(); }
});

test("candidate and private request structures reject field mutation before permit consumption", async () => {
  const api = await policyModule();
  const createPermit = api.createOwnerGrokT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const consumePermit = api.consumeOwnerGrokT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const fixture = await makeCandidate();
  try {
    const candidate = fixture.candidate as typeof fixture.candidate & { request: { settings: Record<string, unknown> } };
    const permit = createPermit({ preparer: fixture.preparer, candidate, principal: PRINCIPAL,
      attemptId: ATTEMPT, catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => fixture.now() });
    assert.equal(Reflect.set(candidate, "model_id", "grok_imagine_2"), false);
    assert.equal(Reflect.set(candidate.request.settings, "n", 2), false);
    assert.equal(candidate.model_id, "grok_t2i");
    assert.equal(candidate.request.settings.n, 1);
    assert.equal(consumePermit({ permit, candidate, principal: PRINCIPAL, attemptId: ATTEMPT }).status, "consumed");
  } finally { await fixture.preparer.close(); await fixture.uploadService.close(); }
});
