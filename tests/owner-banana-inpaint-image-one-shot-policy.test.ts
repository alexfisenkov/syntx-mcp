import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { loadMaplessSettingsInventoryVersion } from "../src/catalog/mapless-settings-inventory.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import {
  OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
  OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
  OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS,
  getOwnerBananaInpaintOriginalUploadSourceProfile
} from "../src/application/owner-banana-inpaint-original-upload-source-profile.js";
import { OwnerBananaInpaintOriginalReferenceService } from "../src/application/owner-banana-inpaint-original-reference-service.js";
import { OwnerBananaInpaintPaintedCompositeReferenceService } from "../src/application/owner-banana-inpaint-painted-composite-reference-service.js";
import { OwnerBananaInpaintAuxiliaryReferenceService } from "../src/application/owner-banana-inpaint-auxiliary-reference-service.js";
import { getOwnerBananaInpaintPaintedCompositeSourceProfile } from "../src/application/owner-banana-inpaint-painted-composite-source-profile.js";
import { getOwnerBananaInpaintSourceParameters } from "../src/application/owner-banana-inpaint-parameters.js";
import { getOwnerBananaInpaintImageSourceProfile } from "../src/application/owner-banana-inpaint-image-source-profile.js";

const MODULE_URL = new URL("../src/application/owner-banana-inpaint-image-one-shot-policy.js", import.meta.url).href;
const policyModule = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const preparerModule = await import("../src/application/owner-banana-inpaint-image-request-preparer.js") as Record<string, unknown>;
const ATTEMPT = "link_banana_inpaint_policy_0123456789";
const BINDING = Object.freeze({ tenant_id: "banana-policy-tenant", subject: "banana-policy-subject" });
const NOW = Date.parse("2026-10-12T00:00:00.000Z");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const CATALOG = loadSelectedDiscoveryCatalog(OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, join(process.cwd(), "catalog")).discoveryCatalog;
const SETTINGS = loadMaplessSettingsInventoryVersion(OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION, join(process.cwd(), "catalog"));

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

function fixture(now: () => number = () => NOW, urlForUpload: (id: number) => string =
  (id) => `https://r2.syntx.ai/policy/${id}.png`) {
  let nextId = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
      return operation("synthetic-inpaint-policy-credential");
    } } satisfies SyntxCredentialBroker,
    fetchImpl: async () => {
      nextId += 1;
      return jsonResponse({ files: [{ id: nextId, file_id: String(nextId), url: urlForUpload(nextId),
        mime_type: "image/png", size: PNG.byteLength, status: "accepted" }] });
    }
  });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) {
    return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
      status: "LINKED" as const, expires_at: null, linked: true };
  } };
  const originalReferenceService = new OwnerBananaInpaintOriginalReferenceService({ binding: BINDING, linkService,
    catalog: CATALOG, public_catalog_version: OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, settings_inventory: SETTINGS,
    settings_inventory_version: OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION, resolveClient: () => client, now });
  const paintedCompositeReferenceService = new OwnerBananaInpaintPaintedCompositeReferenceService({ originalReferenceService,
    binding: BINDING, linkService, catalog: CATALOG, public_catalog_version: OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
    settings_inventory: SETTINGS, settings_inventory_version: OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
    resolveClient: () => client, now });
  const auxiliaryReferenceService = new OwnerBananaInpaintAuxiliaryReferenceService({ binding: BINDING, linkService, catalog: CATALOG,
    public_catalog_version: OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, settings_inventory: SETTINGS,
    settings_inventory_version: OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION, resolveClient: () => client, now });
  const profiles = OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS.map((variant) => {
    const originalProfile = getOwnerBananaInpaintOriginalUploadSourceProfile(variant, CATALOG,
      OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, SETTINGS, OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION);
    const paintedProfile = getOwnerBananaInpaintPaintedCompositeSourceProfile(variant, originalProfile);
    const controlsProfile = getOwnerBananaInpaintSourceParameters(variant, originalProfile);
    const imageProfile = getOwnerBananaInpaintImageSourceProfile(variant, originalProfile, paintedProfile, controlsProfile);
    return { originalProfile, paintedProfile, controlsProfile, imageProfile };
  });
  const preparer = (preparerModule.createOwnerBananaInpaintImageRequestPreparer as (input: unknown) => any)({
    attemptId: ATTEMPT, originalReferenceService, paintedCompositeReferenceService, auxiliaryReferenceService, profiles, now
  });
  return { originalReferenceService, paintedCompositeReferenceService, auxiliaryReferenceService, preparer };
}

async function actualCandidate(testFixture: ReturnType<typeof fixture>,
  variant: typeof OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS[number] = "banana3", image_size: string | null = "2K",
  withAuxiliary = false) {
  const original = await testFixture.originalReferenceService.upload({ attemptId: ATTEMPT, variant,
    content_base64: PNG.toString("base64"), filename: "original.png", mime_type: "image/png" });
  const painted = await testFixture.paintedCompositeReferenceService.uploadPaintedComposite({ attemptId: ATTEMPT, variant,
    original_handle: original.reference_handle, content_base64: PNG.toString("base64"), filename: "painted.png", mime_type: "image/png" });
  const auxiliary = withAuxiliary ? await testFixture.auxiliaryReferenceService.upload({ attemptId: ATTEMPT, variant,
    content_base64: PNG.toString("base64"), filename: "auxiliary.png", mime_type: "image/png" }) : null;
  const candidate = await testFixture.preparer.prepare({ variant, prompt: "preserve the surrounding image", image_size,
    original_handle: original.reference_handle, painted_handle: painted.painted_handle,
    auxiliary_reference_handle: auxiliary?.reference_handle ?? null });
  return { candidate, original, painted, auxiliary };
}

async function closeFixture(testFixture: ReturnType<typeof fixture>): Promise<void> {
  await testFixture.preparer.close();
  await testFixture.paintedCompositeReferenceService.close();
  await testFixture.auxiliaryReferenceService.close();
  await testFixture.originalReferenceService.close();
}

test("Banana Inpaint one-shot policy exposes its candidate-bound permit API", () => {
  assert.ok(policyModule, "MISSING_BANANA_INPAINT_IMAGE_ONE_SHOT_POLICY_MODULE");
  assert.equal(typeof policyModule.createOwnerBananaInpaintImageOneShotPermit, "function");
  assert.equal(typeof policyModule.revalidateOwnerBananaInpaintImageOneShotPermit, "function");
  assert.equal(typeof policyModule.consumeOwnerBananaInpaintImageOneShotPermit, "function");
});

test("issues an opaque one-shot permit only for a real 910 candidate and binds the actual pair", async (t) => {
  assert.ok(policyModule);
  const testFixture = fixture();
  t.after(() => closeFixture(testFixture));
  const { candidate, original, painted } = await actualCandidate(testFixture);
  const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT };
  const permit = await (policyModule.createOwnerBananaInpaintImageOneShotPermit as (input: unknown) => Promise<Record<string, unknown>>)(
    { preparer: testFixture.preparer, candidate, principal, attemptId: ATTEMPT });
  assert.deepEqual(Object.keys(permit).sort(), ["backend_acceptance", "dispatch_allowed", "expires_at", "status"].sort());
  assert.equal(permit.status, "nominal");
  assert.equal(permit.dispatch_allowed, false);
  assert.equal(permit.backend_acceptance, "UNPROVEN");
  assert.equal(permit.expires_at, candidate.expires_at);
  assert.equal(JSON.stringify(permit).includes(original.reference_handle), false);
  assert.equal(JSON.stringify(permit).includes(painted.painted_handle), false);
  assert.equal(JSON.stringify(permit).includes("https://"), false);
  await assert.rejects(() => (policyModule.createOwnerBananaInpaintImageOneShotPermit as (input: unknown) => Promise<unknown>)(
    { preparer: testFixture.preparer, candidate, principal, attemptId: ATTEMPT }),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "CANDIDATE_ALREADY_ISSUED");
});

test("requires fresh async pair revalidation and consumes the nominal permit exactly once", async (t) => {
  assert.ok(policyModule);
  const testFixture = fixture();
  t.after(() => closeFixture(testFixture));
  const { candidate } = await actualCandidate(testFixture, "banana2");
  const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT };
  const permit = await (policyModule.createOwnerBananaInpaintImageOneShotPermit as (input: unknown) => Promise<unknown>)(
    { preparer: testFixture.preparer, candidate, principal, attemptId: ATTEMPT });
  const input = { preparer: testFixture.preparer, candidate, principal, attemptId: ATTEMPT, permit };
  const consume = policyModule.consumeOwnerBananaInpaintImageOneShotPermit as (input: unknown) => unknown;
  const revalidate = policyModule.revalidateOwnerBananaInpaintImageOneShotPermit as (input: unknown) => Promise<void>;
  await assert.rejects(() => revalidate({ ...input, permit: { ...(permit as object) } }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PERMIT_INVALID");
  assert.throws(() => consume(input),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PERMIT_NOT_REVALIDATED");
  await revalidate(input);
  assert.deepEqual(consume(input), { status: "consumed", dispatch_allowed: false, request_fingerprint: candidate.request_fingerprint });
  await assert.rejects(() => revalidate(input),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PERMIT_ALREADY_CONSUMED");
  assert.throws(() => consume(input),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PERMIT_ALREADY_CONSUMED");
});

test("distinguishes a copied candidate and foreign real preparer from an expired candidate", async (t) => {
  assert.ok(policyModule);
  const ownerFixture = fixture();
  const foreignFixture = fixture();
  t.after(async () => { await closeFixture(ownerFixture); await closeFixture(foreignFixture); });
  const original = await ownerFixture.originalReferenceService.upload({ attemptId: ATTEMPT, variant: "banana",
    content_base64: PNG.toString("base64"), filename: "original.png", mime_type: "image/png" });
  const painted = await ownerFixture.paintedCompositeReferenceService.uploadPaintedComposite({ attemptId: ATTEMPT, variant: "banana",
    original_handle: original.reference_handle, content_base64: PNG.toString("base64"), filename: "painted.png", mime_type: "image/png" });
  const candidate = await ownerFixture.preparer.prepare({ variant: "banana", prompt: "preserve the surrounding image", image_size: null,
    original_handle: original.reference_handle, painted_handle: painted.painted_handle, auxiliary_reference_handle: null });
  const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT };
  const create = policyModule.createOwnerBananaInpaintImageOneShotPermit as (input: unknown) => Promise<unknown>;
  const copy = Object.assign(Object.create(null) as Record<string, unknown>, candidate);
  await assert.rejects(() => create({ preparer: ownerFixture.preparer, candidate: copy, principal, attemptId: ATTEMPT }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "CANDIDATE_UNBOUND");
  await assert.rejects(() => create({ preparer: foreignFixture.preparer, candidate, principal, attemptId: ATTEMPT }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "CANDIDATE_UNBOUND");

  let propertyReads = 0;
  const fakePreparer = new Proxy({}, { get() { propertyReads += 1; throw new Error("untrusted callback invoked"); } });
  await assert.rejects(() => create({ preparer: fakePreparer, candidate, principal, attemptId: ATTEMPT }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PREPARER_UNTRUSTED");
  assert.equal(propertyReads, 0);
});

test("binds a permit to the candidate principal and link attempt", async (t) => {
  assert.ok(policyModule);
  const testFixture = fixture();
  t.after(() => closeFixture(testFixture));
  const { candidate } = await actualCandidate(testFixture, "banana2", "1K");
  const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT };
  const permit = await (policyModule.createOwnerBananaInpaintImageOneShotPermit as (input: unknown) => Promise<unknown>)(
    { preparer: testFixture.preparer, candidate, principal, attemptId: ATTEMPT });
  const revalidate = policyModule.revalidateOwnerBananaInpaintImageOneShotPermit as (input: unknown) => Promise<void>;
  const consume = policyModule.consumeOwnerBananaInpaintImageOneShotPermit as (input: unknown) => unknown;
  const input = { preparer: testFixture.preparer, candidate, principal, attemptId: ATTEMPT, permit };
  await assert.rejects(() => revalidate({ ...input, attemptId: "link_banana_inpaint_other_0123456789" }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PRINCIPAL_MISMATCH");
  await assert.rejects(() => revalidate({ ...input, principal: { ...principal, subject_id: "foreign-subject" } }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PRINCIPAL_MISMATCH");
  await revalidate(input);
  assert.deepEqual(consume(input), { status: "consumed", dispatch_allowed: false, request_fingerprint: candidate.request_fingerprint });
});

test("binds all four variants and all nine explicit size selections to actual prepared candidates", async (t) => {
  assert.ok(policyModule);
  const testFixture = fixture();
  t.after(() => closeFixture(testFixture));
  const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT };
  const selections = [
    ["banana", null], ["banana2", "1K"], ["banana2", "2K"], ["banana2", "4K"],
    ["banana3", "0.5K"], ["banana3", "1K"], ["banana3", "2K"], ["banana3", "4K"], ["banana3_light", "1K"]
  ] as const;
  const create = policyModule.createOwnerBananaInpaintImageOneShotPermit as (input: unknown) => Promise<Record<string, unknown>>;
  const revalidate = policyModule.revalidateOwnerBananaInpaintImageOneShotPermit as (input: unknown) => Promise<void>;
  const consume = policyModule.consumeOwnerBananaInpaintImageOneShotPermit as (input: unknown) => { request_fingerprint: string };
  for (const [variant, imageSize] of selections) {
    const { candidate } = await actualCandidate(testFixture, variant, imageSize);
    const permit = await create({ preparer: testFixture.preparer, candidate, principal, attemptId: ATTEMPT });
    const input = { preparer: testFixture.preparer, candidate, principal, attemptId: ATTEMPT, permit };
    await revalidate(input);
    assert.equal(consume(input).request_fingerprint, candidate.request_fingerprint);
  }
});

test("expiry and attempt invalidation make issued permits unusable without renewal", async (t) => {
  assert.ok(policyModule);
  let current = NOW;
  const expiryFixture = fixture(() => current);
  const revokedFixture = fixture();
  t.after(async () => { await closeFixture(expiryFixture); await closeFixture(revokedFixture); });
  const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT };
  const create = policyModule.createOwnerBananaInpaintImageOneShotPermit as (input: unknown) => Promise<unknown>;
  const revalidate = policyModule.revalidateOwnerBananaInpaintImageOneShotPermit as (input: unknown) => Promise<void>;
  const consume = policyModule.consumeOwnerBananaInpaintImageOneShotPermit as (input: unknown) => unknown;

  const expiring = await actualCandidate(expiryFixture, "banana3", "1K");
  const expiringPermit = await create({ preparer: expiryFixture.preparer, candidate: expiring.candidate, principal, attemptId: ATTEMPT });
  const expiryInput = { preparer: expiryFixture.preparer, candidate: expiring.candidate, principal, attemptId: ATTEMPT, permit: expiringPermit };
  await revalidate(expiryInput);
  current = NOW + 900_000;
  assert.throws(() => consume(expiryInput),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "CANDIDATE_EXPIRED");

  const revoked = await actualCandidate(revokedFixture, "banana2", "4K");
  const revokedPermit = await create({ preparer: revokedFixture.preparer, candidate: revoked.candidate, principal, attemptId: ATTEMPT });
  const revokedInput = { preparer: revokedFixture.preparer, candidate: revoked.candidate, principal, attemptId: ATTEMPT,
    permit: revokedPermit };
  await revalidate(revokedInput);
  await revokedFixture.preparer.invalidateAttempt(ATTEMPT);
  assert.throws(() => consume(revokedInput),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "CANDIDATE_EXPIRED");
});

test("binds a real auxiliary resolution and its ordered third image through one-shot consume", async (t) => {
  assert.ok(policyModule);
  const testFixture = fixture();
  t.after(() => closeFixture(testFixture));
  const { candidate, auxiliary } = await actualCandidate(testFixture, "banana3", "2K", true);
  assert.ok(auxiliary);
  const binding = testFixture.preparer.inspectCandidate(candidate);
  assert.equal(binding?.auxiliary_reference_handle, auxiliary.reference_handle);
  assert.equal(binding?.auxiliary_profile_schema_hash !== null, true);
  assert.equal(binding?.auxiliary_sha256, auxiliary.sha256);
  assert.equal(binding?.auxiliary_epoch !== null, true);
  assert.equal(binding?.auxiliary_expires_at !== null, true);
  const request = testFixture.preparer.getPrivateRequest(candidate);
  assert.equal(request.settings.file_urls.length, 3);
  assert.deepEqual(request.settings.file_urls.map((file: { readonly type: string }) => file.type), ["image", "mask", "image"]);

  const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT };
  const create = policyModule.createOwnerBananaInpaintImageOneShotPermit as (input: unknown) => Promise<Record<string, unknown>>;
  const revalidate = policyModule.revalidateOwnerBananaInpaintImageOneShotPermit as (input: unknown) => Promise<void>;
  const consume = policyModule.consumeOwnerBananaInpaintImageOneShotPermit as (input: unknown) => { request_fingerprint: string };
  const permit = await create({ preparer: testFixture.preparer, candidate, principal, attemptId: ATTEMPT });
  assert.deepEqual(Object.keys(permit).sort(), ["backend_acceptance", "dispatch_allowed", "expires_at", "status"].sort());
  assert.equal(permit.expires_at, candidate.expires_at);
  assert.equal(JSON.stringify(permit).includes(auxiliary.reference_handle), false);
  assert.equal(JSON.stringify(permit).includes("https://"), false);
  const input = { preparer: testFixture.preparer, candidate, principal, attemptId: ATTEMPT, permit };
  await revalidate(input);
  assert.equal(consume(input).request_fingerprint, candidate.request_fingerprint);
});

test("accepts canonical original-plus-auxiliary URL dedup only from the actual preparer", async (t) => {
  assert.ok(policyModule);
  const originalUrl = "https://r2.syntx.ai/policy/shared-original-aux.png";
  const testFixture = fixture(() => NOW, (id) => id === 1 || id === 3 ? originalUrl : `https://r2.syntx.ai/policy/${id}.png`);
  t.after(() => closeFixture(testFixture));
  const { candidate, auxiliary } = await actualCandidate(testFixture, "banana3", "2K", true);
  assert.ok(auxiliary);
  const binding = testFixture.preparer.inspectCandidate(candidate);
  assert.equal(binding?.auxiliary_reference_handle, auxiliary.reference_handle);
  assert.equal(binding?.auxiliary_profile_schema_hash !== null, true);
  assert.equal(binding?.auxiliary_sha256, auxiliary.sha256);
  assert.equal(binding?.auxiliary_epoch !== null, true);
  assert.equal(binding?.auxiliary_expires_at !== null, true);
  const request = testFixture.preparer.getPrivateRequest(candidate);
  assert.equal(request.settings.file_urls.length, 2);
  assert.deepEqual(request.settings.file_urls.map((file: { readonly type: string }) => file.type), ["image", "mask"]);
  assert.equal(request.settings.file_urls[0]?.url, originalUrl);

  const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT };
  const create = policyModule.createOwnerBananaInpaintImageOneShotPermit as (input: unknown) => Promise<Record<string, unknown>>;
  const revalidate = policyModule.revalidateOwnerBananaInpaintImageOneShotPermit as (input: unknown) => Promise<void>;
  const consume = policyModule.consumeOwnerBananaInpaintImageOneShotPermit as (input: unknown) => { request_fingerprint: string };
  const permit = await create({ preparer: testFixture.preparer, candidate, principal, attemptId: ATTEMPT });
  assert.equal(permit.expires_at, candidate.expires_at);
  const input = { preparer: testFixture.preparer, candidate, principal, attemptId: ATTEMPT, permit };
  await revalidate(input);
  assert.equal(consume(input).request_fingerprint, candidate.request_fingerprint);
});
