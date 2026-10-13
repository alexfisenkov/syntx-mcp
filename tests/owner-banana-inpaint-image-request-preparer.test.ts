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
import { getOwnerBananaInpaintPaintedCompositeSourceProfile } from "../src/application/owner-banana-inpaint-painted-composite-source-profile.js";
import { getOwnerBananaInpaintSourceParameters } from "../src/application/owner-banana-inpaint-parameters.js";
import { getOwnerBananaInpaintImageSourceProfile } from "../src/application/owner-banana-inpaint-image-source-profile.js";
import { OwnerBananaInpaintAuxiliaryReferenceService } from "../src/application/owner-banana-inpaint-auxiliary-reference-service.js";

const MODULE_URL = new URL("../src/application/owner-banana-inpaint-image-request-preparer.js", import.meta.url).href;
const preparerModule = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const ATTEMPT = "link_banana_inpaint_preparer_0123456789";
const BINDING = Object.freeze({ tenant_id: "banana-preparer-tenant", subject: "banana-preparer-subject" });
const NOW = Date.parse("2026-10-12T00:00:00.000Z");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const CATALOG = loadSelectedDiscoveryCatalog(OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, join(process.cwd(), "catalog")).discoveryCatalog;
const SETTINGS = loadMaplessSettingsInventoryVersion(OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION, join(process.cwd(), "catalog"));

type TestCandidate = Record<string, unknown>;
type TestBinding = Record<string, unknown>;
type TestPrivateRequest = {
  readonly prompt: string;
  readonly settings: {
    readonly editor: boolean;
    readonly model_type: string;
    readonly image_size: string | null;
    readonly file_urls: readonly Readonly<{ type: string; url: string }>[];
  };
};

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-banana-preparer-credential"); } };
}

function linkedAttempt(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: null, linked: true };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

function createReferenceFixture(now: () => number = () => NOW, urlForUpload: (id: number) => string =
  (id) => `https://r2.syntx.ai/inpaint/preparer-${id}.png`) {
  let nextId = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    nextId += 1;
    return jsonResponse({ files: [{ id: nextId, file_id: String(nextId), url: urlForUpload(nextId),
      mime_type: "image/png", size: PNG.byteLength, status: "accepted" }] });
  } });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } };
  const originalReferenceService = new OwnerBananaInpaintOriginalReferenceService({ binding: BINDING, linkService, catalog: CATALOG,
    public_catalog_version: OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, settings_inventory: SETTINGS,
    settings_inventory_version: OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION, resolveClient: () => client, now });
  const paintedCompositeReferenceService = new OwnerBananaInpaintPaintedCompositeReferenceService({
    originalReferenceService, binding: BINDING, linkService, catalog: CATALOG,
    public_catalog_version: OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, settings_inventory: SETTINGS,
    settings_inventory_version: OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION, resolveClient: () => client, now
  });
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
  const createPreparer = (withAuxiliary = false) => (preparerModule!.createOwnerBananaInpaintImageRequestPreparer as (options: unknown) => {
    prepare(input: unknown): Promise<TestCandidate>;
    inspectCandidate(candidate: unknown): TestBinding | undefined;
    getPrivateRequest(candidate: unknown): TestPrivateRequest;
    revalidateCandidate(candidate: unknown): Promise<TestBinding>;
    invalidateAttempt(attemptId: string): Promise<void>;
    close(): Promise<void>;
  })({ attemptId: ATTEMPT, originalReferenceService, paintedCompositeReferenceService, profiles,
    ...(withAuxiliary ? { auxiliaryReferenceService } : {}), now });
  return { originalReferenceService, paintedCompositeReferenceService, auxiliaryReferenceService, profiles, createPreparer };
}

async function createPair(fixture: ReturnType<typeof createReferenceFixture>, variant: typeof OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS[number]) {
  const original = await fixture.originalReferenceService.upload({ attemptId: ATTEMPT, variant, content_base64: PNG.toString("base64"),
    filename: "original.png", mime_type: "image/png" });
  const painted = await fixture.paintedCompositeReferenceService.uploadPaintedComposite({ attemptId: ATTEMPT, variant,
    original_handle: original.reference_handle, content_base64: PNG.toString("base64"), filename: "painted.png", mime_type: "image/png" });
  return { original, painted };
}

test("Banana Inpaint request preparer exposes its private-candidate factory", () => {
  assert.ok(preparerModule, "MISSING_BANANA_INPAINT_IMAGE_REQUEST_PREPARER_MODULE");
  assert.equal(typeof preparerModule.createOwnerBananaInpaintImageRequestPreparer, "function",
    "MISSING_BANANA_INPAINT_IMAGE_REQUEST_PREPARER_FACTORY");
});

test("recognizes only the original frozen preparer capability without reading foreign properties", async (t) => {
  assert.ok(preparerModule, "MISSING_BANANA_INPAINT_IMAGE_REQUEST_PREPARER_MODULE");
  const isOwnerPreparer = preparerModule.isOwnerBananaInpaintImageRequestPreparer as (value: unknown) => boolean;
  assert.equal(typeof isOwnerPreparer, "function", "MISSING_BANANA_INPAINT_IMAGE_REQUEST_PREPARER_PREDICATE");
  const fixture = createReferenceFixture();
  const preparer = fixture.createPreparer();
  t.after(async () => { await preparer.close(); await fixture.paintedCompositeReferenceService.close(); await fixture.auxiliaryReferenceService.close(); });
  assert.equal(isOwnerPreparer(preparer), true);
  const copied = Object.freeze({ ...preparer });
  assert.equal(isOwnerPreparer(copied), false);
  let getterReads = 0;
  const foreign = Object.freeze(Object.defineProperty({}, "prepare", { enumerable: true, get() { getterReads += 1; throw new Error("MUST_NOT_RUN"); } }));
  assert.equal(isOwnerPreparer(foreign), false);
  assert.equal(getterReads, 0);
});

test("prepares the exact four variants and nine size selections from actual private pairs", async (t) => {
  assert.ok(preparerModule, "MISSING_BANANA_INPAINT_IMAGE_REQUEST_PREPARER_MODULE");
  const fixture = createReferenceFixture();
  const preparer = fixture.createPreparer();
  t.after(async () => { await preparer.close(); await fixture.paintedCompositeReferenceService.close(); await fixture.auxiliaryReferenceService.close(); });
  const selections = [
    ["banana", null],
    ["banana2", "1K"], ["banana2", "2K"], ["banana2", "4K"],
    ["banana3", "0.5K"], ["banana3", "1K"], ["banana3", "2K"], ["banana3", "4K"],
    ["banana3_light", "1K"]
  ] as const;
  for (const [variant, image_size] of selections) {
    const pair = await createPair(fixture, variant);
    const prompt = `  keep line one\n${variant} 🚀  `;
    const candidate = await preparer.prepare({ variant, prompt, image_size, original_handle: pair.original.reference_handle,
      painted_handle: pair.painted.painted_handle, auxiliary_reference_handle: null });
    assert.equal(candidate.status, "blocked");
    assert.equal(candidate.dispatch_allowed, false);
    assert.equal(candidate.backend_acceptance, "UNPROVEN");
    assert.equal(candidate.variant, variant);
    assert.equal(candidate.image_size, image_size);
    assert.equal(candidate.expires_at, NOW + 900_000);
    assert.equal("prompt" in candidate, false);
    assert.equal("request" in candidate, false);
    const body = preparer.getPrivateRequest(candidate);
    assert.equal(body.prompt, prompt);
    assert.deepEqual(Object.keys(body.settings), ["editor", "model_type", "image_size", "file_urls"]);
    assert.equal(body.settings.editor, true);
    assert.equal(body.settings.model_type, variant);
    assert.equal(body.settings.image_size, image_size);
    assert.deepEqual(body.settings.file_urls, [
      { type: "image", url: `https://r2.syntx.ai/inpaint/preparer-${(selections.indexOf(selections.find((x) => x[0] === variant && x[1] === image_size)!) * 2) + 1}.png` },
      { type: "mask", url: `https://r2.syntx.ai/inpaint/preparer-${(selections.indexOf(selections.find((x) => x[0] === variant && x[1] === image_size)!) * 2) + 2}.png` }
    ]);
    assert.equal(JSON.stringify(candidate).includes("https://r2.syntx.ai"), false);
    assert.equal(JSON.stringify(candidate).includes(prompt), false);
    const binding = preparer.inspectCandidate(candidate);
    assert.equal(binding?.attempt_id, ATTEMPT);
    assert.equal(binding?.original_handle, pair.original.reference_handle);
    assert.equal(binding?.painted_handle, pair.painted.painted_handle);
    assert.equal(binding?.original_sha256, pair.original.sha256);
    assert.equal(binding?.painted_sha256, pair.painted.sha256);
    assert.equal(binding?.auxiliary_reference_handle, null);
    await preparer.revalidateCandidate(candidate);
  }
});

test("rejects caller URL/context injection and requires the nominal auxiliary service for a non-null handle", async (t) => {
  assert.ok(preparerModule, "MISSING_BANANA_INPAINT_IMAGE_REQUEST_PREPARER_MODULE");
  const fixture = createReferenceFixture();
  const preparer = fixture.createPreparer();
  t.after(async () => { await preparer.close(); await fixture.paintedCompositeReferenceService.close(); await fixture.auxiliaryReferenceService.close(); });
  const pair = await createPair(fixture, "banana");
  const base = { variant: "banana", prompt: "keep this", image_size: null, original_handle: pair.original.reference_handle,
    painted_handle: pair.painted.painted_handle, auxiliary_reference_handle: null };
  await assert.rejects(() => preparer.prepare({ ...base, file_url: "https://evil.invalid/forged.png" }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
  await assert.rejects(() => preparer.prepare({ ...base, principal: { tenant_id: "other", subject_id: "other", connection_id: ATTEMPT } }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
  await assert.rejects(() => preparer.prepare({ ...base, auxiliary_reference_handle: "banana_reference_00000000-0000-4000-8000-000000000001" }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "AUXILIARY_REFERENCE_NOT_READY");
});

test("expires the private candidate at the original pair deadline and reports it unusable", async (t) => {
  let current = NOW;
  const fixture = createReferenceFixture(() => current);
  const preparer = fixture.createPreparer();
  t.after(async () => { await preparer.close(); await fixture.paintedCompositeReferenceService.close(); await fixture.auxiliaryReferenceService.close(); });
  const pair = await createPair(fixture, "banana3");
  const candidate = await preparer.prepare({ variant: "banana3", prompt: "preserve", image_size: "2K",
    original_handle: pair.original.reference_handle, painted_handle: pair.painted.painted_handle,
    auxiliary_reference_handle: null });
  current = NOW + 900_000;
  assert.equal(preparer.inspectCandidate(candidate), undefined);
  assert.throws(() => preparer.getPrivateRequest(candidate),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "CANDIDATE_EXPIRED");
});

test("permanently expires the candidate after a backwards clock observation", async (t) => {
  let current = NOW;
  const fixture = createReferenceFixture(() => current);
  const preparer = fixture.createPreparer();
  t.after(async () => { await preparer.close(); await fixture.paintedCompositeReferenceService.close(); await fixture.auxiliaryReferenceService.close(); });
  const pair = await createPair(fixture, "banana2");
  const candidate = await preparer.prepare({ variant: "banana2", prompt: "preserve", image_size: "2K",
    original_handle: pair.original.reference_handle, painted_handle: pair.painted.painted_handle,
    auxiliary_reference_handle: null });
  current = NOW - 1;
  assert.throws(() => preparer.getPrivateRequest(candidate),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "CLOCK_INVALID");
  current = NOW + 10;
  assert.throws(() => preparer.getPrivateRequest(candidate),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "CANDIDATE_EXPIRED");
});

test("prepares zero or one actual nominal auxiliary image after the original and painted mask", async (t) => {
  let current = NOW;
  const fixture = createReferenceFixture(() => current);
  t.after(async () => {
    await fixture.paintedCompositeReferenceService.close();
    await fixture.auxiliaryReferenceService.close();
  });
  const preparer = fixture.createPreparer(true);
  t.after(async () => { await preparer.close(); });
  const variants = ["banana", "banana2", "banana3", "banana3_light"] as const;
  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index]!;
    const pairCreatedAt = current;
    const pair = await createPair(fixture, variant);
    if (variant === "banana2") current += 14 * 60_000;
    const auxiliary = await fixture.auxiliaryReferenceService.upload({ attemptId: ATTEMPT, variant,
      content_base64: PNG.toString("base64"), filename: "auxiliary.png", mime_type: "image/png" });
    const resolution = await fixture.auxiliaryReferenceService.resolveReference({ attempt_id: ATTEMPT, variant,
      reference_handle: auxiliary.reference_handle });
    assert.equal(resolution.isAuthenticResolution(), true);
    const image_size = variant === "banana" ? null : variant === "banana2" ? "2K" : variant === "banana3" ? "1K" : "1K";
    const prompt = `  auxiliary ${variant}\n  `;
    const candidate = await preparer.prepare({ variant, prompt, image_size, original_handle: pair.original.reference_handle,
      painted_handle: pair.painted.painted_handle, auxiliary_reference_handle: auxiliary.reference_handle });
    assert.equal(candidate.status, "blocked");
    assert.equal(candidate.dispatch_allowed, false);
    assert.equal(candidate.reference_count, 3);
    assert.equal("prompt" in candidate, false);
    assert.equal(JSON.stringify(candidate).includes("https://r2.syntx.ai"), false);
    assert.equal(JSON.stringify(candidate).includes(prompt), false);
    assert.deepEqual(preparer.getPrivateRequest(candidate).settings.file_urls, [
      { type: "image", url: `https://r2.syntx.ai/inpaint/preparer-${index * 3 + 1}.png` },
      { type: "mask", url: `https://r2.syntx.ai/inpaint/preparer-${index * 3 + 2}.png` },
      { type: "image", url: resolution.file_url }
    ]);
    const binding = preparer.inspectCandidate(candidate)!;
    assert.equal(binding.auxiliary_reference_handle, auxiliary.reference_handle);
    assert.equal(binding.auxiliary_sha256, auxiliary.sha256);
    assert.equal(binding.auxiliary_epoch, resolution.epoch);
    assert.equal(binding.auxiliary_expires_at, resolution.expires_at);
    assert.equal(binding.auxiliary_profile_schema_hash, resolution.profile_schema_hash);
    assert.equal(candidate.expires_at, Math.min(pairCreatedAt + pair.original.expires_in_seconds * 1_000, resolution.expires_at));
    await preparer.revalidateCandidate(candidate);
  }
});

test("canonicalizes duplicate uploaded image URLs by exact role and preserves image-versus-mask order", async (t) => {
  const sharedUrl = "https://r2.syntx.ai/inpaint/shared-upload.png";
  const fixture = createReferenceFixture(() => NOW, () => sharedUrl);
  t.after(async () => {
    await fixture.paintedCompositeReferenceService.close();
    await fixture.auxiliaryReferenceService.close();
  });
  const preparer = fixture.createPreparer(true);
  t.after(async () => { await preparer.close(); });
  const pair = await createPair(fixture, "banana3");
  const auxiliary = await fixture.auxiliaryReferenceService.upload({ attemptId: ATTEMPT, variant: "banana3",
    content_base64: PNG.toString("base64"), filename: "auxiliary.png", mime_type: "image/png" });
  const candidate = await preparer.prepare({ variant: "banana3", prompt: "keep first URL by role", image_size: "2K",
    original_handle: pair.original.reference_handle, painted_handle: pair.painted.painted_handle,
    auxiliary_reference_handle: auxiliary.reference_handle });
  assert.deepEqual(preparer.getPrivateRequest(candidate).settings.file_urls, [
    { type: "image", url: sharedUrl },
    { type: "mask", url: sharedUrl }
  ]);
  assert.equal(candidate.reference_count, 2);
  assert.equal(preparer.inspectCandidate(candidate)?.auxiliary_reference_handle, auxiliary.reference_handle);
  assert.equal(JSON.stringify(candidate).includes(sharedUrl), false);
});
