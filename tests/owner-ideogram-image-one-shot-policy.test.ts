import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import {
  createOwnerIdeogramImageAssetBindingIssuer,
  prepareOwnerIdeogramImageRequest,
  type OwnerIdeogramImagePreparedCandidate
} from "../src/application/owner-ideogram-image-request-preparer.js";
import { OwnerIdeogramImageUploadService } from "../src/application/owner-ideogram-image-upload-service.js";
import { OwnerIdeogramImageMaskUploadService } from "../src/application/owner-ideogram-image-mask-upload-service.js";
import { createOwnerIdeogramImageOneShotPermit, consumeOwnerIdeogramImageOneShotPermit } from "../src/application/owner-ideogram-image-one-shot-policy.js";
import type { OwnerIdeogramImageCatalogPort } from "../src/application/owner-ideogram-image-source-profile.js";

const CATALOG = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const BASE = Date.parse("2026-10-11T00:00:00.000Z");
const BINDING = Object.freeze({ tenant_id: "ideogram-policy-tenant", subject: "ideogram-policy-subject" });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

type Case = Readonly<{ model_id: string; mode: string; prompt: string | null; parameters: Readonly<Record<string, unknown>>; refs: number }>;
const CASES: readonly Case[] = [
  { model_id: "ideogram", mode: "generate", prompt: "base", parameters: { rendering_speed: "TURBO", num_images: 2, aspect_ratio: "1:1", resolution: "1024x1024" }, refs: 0 },
  { model_id: "ideogram", mode: "remix", prompt: "remix", parameters: { rendering_speed: "TURBO", num_images: 2, aspect_ratio: "1:1", resolution: "1024x1024", image_weight: 50 }, refs: 1 },
  { model_id: "ideogram", mode: "reframe", prompt: null, parameters: { rendering_speed: "TURBO", num_images: 2, resolution: "1024x1024" }, refs: 1 },
  { model_id: "ideogram", mode: "replace_background", prompt: "replace", parameters: { rendering_speed: "TURBO", num_images: 2 }, refs: 1 },
  { model_id: "ideogram", mode: "character_reference", prompt: "character", parameters: { rendering_speed: "TURBO", num_images: 2, aspect_ratio: "1:1", resolution: "1024x1024" }, refs: 1 },
  { model_id: "ideogram_40", mode: "generate", prompt: "4.0", parameters: { rendering_speed: "TURBO", num_images: 2, aspect_ratio: null, resolution: "1K" }, refs: 0 },
  { model_id: "ideogram_40", mode: "transparent", prompt: "transparent", parameters: { rendering_speed: "TURBO", num_images: 2, aspect_ratio: "1:1", resolution: "4K" }, refs: 0 },
  { model_id: "ideogram_45", mode: "generate", prompt: "4.5", parameters: { rendering_speed: "TURBO", num_images: 2, aspect_ratio: "1:1", resolution: "1K" }, refs: 2 },
  { model_id: "ideogram_45", mode: "precise_edit", prompt: "precise", parameters: { rendering_speed: "TURBO", num_images: 2 }, refs: 1 }
];
let fixtureIndex = 0;

function credentialBroker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation("synthetic-ideogram-policy-credential"); } };
}
function linkedAttempt(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: null, linked: true };
}
function code(error: unknown): string | undefined { return error instanceof Error && "code" in error ? String(error.code) : undefined; }
function fileUrls(candidate: OwnerIdeogramImagePreparedCandidate): readonly Readonly<{ type: string; url: string }>[] {
  return candidate.request.settings.file_urls as readonly Readonly<{ type: string; url: string }>[];
}

async function makeCandidate(item: Case = CASES[7]!, catalogInput: OwnerIdeogramImageCatalogPort = CATALOG, withMask = false) {
  const suffix = String(++fixtureIndex).padStart(3, "0");
  const attemptId = `link_ideogram_policy_candidate_${suffix}_0123456789`;
  const principal = Object.freeze({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: attemptId });
  let now = BASE;
  let uploadCount = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (input, init) => {
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    const form = init?.body as FormData;
    const file = form.get("files");
    assert.ok(file instanceof File);
    uploadCount += 1;
    return Response.json({ files: [{ id: `private-file-${suffix}-${uploadCount}`, url: `https://r2.syntx.ai/private/ideogram/${suffix}-${uploadCount}.png`,
      mime_type: file.type, size: file.size }] });
  } });
  const uploadService = new OwnerIdeogramImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, requestedAttempt: string) { return linkedAttempt(requestedAttempt); } },
    catalog: catalogInput, catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => now });
  const maskService = new OwnerIdeogramImageMaskUploadService({ baseUploadService: uploadService, catalog: catalogInput,
    catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => now });
  const assetIssuer = createOwnerIdeogramImageAssetBindingIssuer(uploadService, {
    catalog: catalogInput, catalog_version: CATALOG_VERSION, now: () => now, maskService
  });
  try {
    const handles: string[] = [];
    for (let index = 0; index < item.refs; index += 1) {
      const receipt = await uploadService.upload({ attemptId, model_id: item.model_id, mode: item.mode,
        content_base64: PNG.toString("base64"), filename: `image-${index + 1}.png`, mime_type: "image/png" });
      handles.push(receipt.reference_handle);
    }
    let maskHandle: string | undefined;
    if (withMask) {
      const mask = await maskService.upload({ attemptId, base_reference_handle: handles[0]!, painted_rgba_png_base64: PNG.toString("base64") });
      maskHandle = mask.mask_handle;
    }
    const assetSet = await assetIssuer.issue({ principal, attempt_id: attemptId, model_id: item.model_id, mode: item.mode,
      reference_handles: handles, prompt: item.prompt, parameters: item.parameters,
      ...(maskHandle === undefined ? {} : { mask_handle: maskHandle }) });
    const candidate = await prepareOwnerIdeogramImageRequest({ principal, attempt_id: attemptId, asset_set: assetSet }, {
      catalog: catalogInput, catalog_version: CATALOG_VERSION, now: () => now
    });
    return {
      candidate, principal, attemptId, catalog: catalogInput, assetIssuer, uploadService,
      maskService, maskHandle, baseReferenceHandle: handles[0],
      setNow(value: number) { now = value; }, get now() { return now; }, uploadCount,
      close: async () => { await assetIssuer.close(); await maskService.close(); await uploadService.close(); }
  };
  } catch (error) {
    await assetIssuer.close(); await maskService.close(); await uploadService.close(); throw error;
  }
}

function createPermit(fixture: Awaited<ReturnType<typeof makeCandidate>>) {
  return createOwnerIdeogramImageOneShotPermit({ candidate: fixture.candidate, principal: fixture.principal,
    attemptId: fixture.attemptId, catalog: fixture.catalog, catalog_version: CATALOG_VERSION, now: () => fixture.now });
}
function consume(fixture: Awaited<ReturnType<typeof makeCandidate>>, permit: unknown, candidate: unknown = fixture.candidate, principal: unknown = fixture.principal, attemptId = fixture.attemptId) {
  return consumeOwnerIdeogramImageOneShotPermit({ permit, candidate, principal, attemptId });
}

test("mints a non-dispatchable nominal permit only for authentic candidates in all nine source contexts", async () => {
  for (const item of CASES) {
    const fixture = await makeCandidate(item);
    try {
      const candidate = fixture.candidate;
      assert.equal(candidate.dispatch_allowed, false);
      assert.equal(candidate.backend_acceptance, "UNPROVEN");
      assert.equal(candidate.mask_present, false);
      assert.equal(Object.hasOwn(candidate.request.settings, "n"), false);
      assert.equal(candidate.request.prompt, item.prompt ?? "");
      assert.equal(candidate.request_prompt_confidence, item.prompt === null
        ? "LOCAL_EXPLICIT_EMPTY_SERIALIZATION_NOT_PROVIDER_ACCEPTANCE" : "SOURCE_REQUIRED_PROMPT");
      assert.equal(candidate.native_wire_status, item.prompt === null
        ? "LOCAL_EXPLICIT_EMPTY_SERIALIZATION_NOT_PROVIDER_ACCEPTANCE" : "SOURCE_MAPPED");
      assert.deepEqual(candidate.parameters, item.parameters);
      assert.equal(fileUrls(candidate).length, item.refs);
      assert.deepEqual(fileUrls(candidate).map((file) => file.url),
        Array.from({ length: item.refs }, (_, index) => `https://r2.syntx.ai/private/ideogram/${String(fixtureIndex).padStart(3, "0")}-${index + 1}.png`));
      const permit = createPermit(fixture);
      assert.equal(permit.status, "nominal");
      assert.equal(permit.dispatch_allowed, false);
      assert.equal(permit.profile_id, candidate.profile_id);
      assert.equal(permit.profile_schema_hash, candidate.profile_schema_hash);
      assert.equal(permit.model_id, item.model_id);
      assert.equal(permit.mode, item.mode);
      assert.equal(permit.request_fingerprint, candidate.request_fingerprint);
      assert.equal(permit.intent_fingerprint, candidate.intent_fingerprint);
      const receipt = consume(fixture, permit);
      assert.equal(receipt.status, "consumed");
      assert.equal(receipt.dispatch_allowed, false);
    } finally { await fixture.close(); }
  }
});

test("one-shot permit binds a real role-mask pair without counting it as an ordinary reference", async () => {
  const fixture = await makeCandidate(CASES[8]!, CATALOG, true);
  try {
    const candidate = fixture.candidate;
    const files = fileUrls(candidate);
    const requestFiles = candidate.request.settings.file_urls as readonly Readonly<{ type: string; url: string }>[];
    assert.equal(candidate.mask_present, true);
    assert.equal(candidate.reference_count, 1);
    assert.deepEqual(files.map((file) => file.type), ["image", "mask"]);
    assert.equal(candidate.references.length, 1);
    assert.equal(candidate.mask_binding?.mask_handle, fixture.maskHandle);
    assert.equal(candidate.mask_binding?.base_reference_handle, fixture.baseReferenceHandle);
    assert.equal(candidate.cost_inputs.ref_count, 1, "cost reference count excludes the mask slot");
    assert.equal(requestFiles.length, 2, "native settings contain the ordinary image plus a mask role");
    assert.equal(Object.hasOwn(candidate.request.settings, "n"), false);
    const clonedCandidate = Object.freeze({ ...candidate });
    assert.throws(() => createOwnerIdeogramImageOneShotPermit({ candidate: clonedCandidate as OwnerIdeogramImagePreparedCandidate,
      principal: fixture.principal, attemptId: fixture.attemptId, catalog: fixture.catalog,
      catalog_version: CATALOG_VERSION, now: () => fixture.now }), (error: unknown) => code(error) === "CANDIDATE_UNBOUND");

    const permit = createPermit(fixture);
    assert.equal(permit.mask_present, true);
    assert.match(permit.mask_binding_fingerprint ?? "", /^sha256:[a-f0-9]{64}$/u);
    assert.equal(JSON.stringify(permit).includes("https://r2.syntx.ai"), false);
    assert.equal(JSON.stringify(permit).includes(fixture.maskHandle ?? "unreachable"), false);
    assert.equal(consume(fixture, permit).status, "consumed");
    assert.throws(() => consume(fixture, permit), (error: unknown) => code(error) === "PERMIT_ALREADY_CONSUMED");
  } finally { await fixture.close(); }

  const expiring = await makeCandidate(CASES[8]!, CATALOG, true);
  try {
    expiring.setNow(BASE + 14 * 60_000);
    const permit = createPermit(expiring);
    assert.equal(permit.expires_at, BASE + 15 * 60_000, "mask and base never outlive their earliest original expiry");
    expiring.setNow(BASE + 15 * 60_000);
    assert.throws(() => consume(expiring, permit), (error: unknown) => code(error) === "PERMIT_EXPIRED");
  } finally { await expiring.close(); }

  const revoked = await makeCandidate(CASES[8]!, CATALOG, true);
  try {
    const permit = createPermit(revoked);
    await revoked.assetIssuer.invalidateAttempt(revoked.attemptId);
    assert.throws(() => consume(revoked, permit), (error: unknown) => code(error) === "CANDIDATE_EXPIRED" || code(error) === "CANDIDATE_MISMATCH");
  } finally { await revoked.close(); }
});

test("matches source wire profile and ordered real-owned references; rejects candidate clones and repeated permits", async () => {
  const fixture = await makeCandidate(CASES[7]!);
  try {
    const candidate = fixture.candidate as OwnerIdeogramImagePreparedCandidate;
    assert.equal(candidate.source_wire_binding.confidence, "STATIC_SOURCE_HELPER_JOIN_NOT_PROVIDER_ACCEPTANCE");
    assert.deepEqual(fileUrls(candidate).map((file) => file.url), [
      "https://r2.syntx.ai/private/ideogram/" + String(fixtureIndex).padStart(3, "0") + "-1.png",
      "https://r2.syntx.ai/private/ideogram/" + String(fixtureIndex).padStart(3, "0") + "-2.png"
    ]);
    assert.equal(candidate.request.settings.num_images, 2);
    const clonedCandidate = Object.freeze({ ...candidate });
    assert.throws(() => createOwnerIdeogramImageOneShotPermit({ candidate: clonedCandidate as OwnerIdeogramImagePreparedCandidate,
      principal: fixture.principal, attemptId: fixture.attemptId, catalog: fixture.catalog,
      catalog_version: CATALOG_VERSION, now: () => fixture.now }), (error: unknown) => code(error) === "CANDIDATE_UNBOUND");
    const permit = createPermit(fixture);
    assert.throws(() => createPermit(fixture), (error: unknown) => code(error) === "CANDIDATE_ALREADY_ISSUED");
    const forged = Object.freeze({ ...candidate, request_fingerprint: `sha256:${"f".repeat(64)}` });
    assert.throws(() => consume(fixture, permit, forged), (error: unknown) => code(error) === "PERMIT_INVALID" || code(error) === "CANDIDATE_MISMATCH");
    assert.throws(() => consume(fixture, Object.freeze({ ...permit })), (error: unknown) => code(error) === "PERMIT_INVALID");
    const wrongPrincipal = Object.freeze({ ...fixture.principal, subject_id: "different-subject" });
    assert.throws(() => consume(fixture, permit, candidate, wrongPrincipal), (error: unknown) => code(error) === "PRINCIPAL_MISMATCH");
    assert.throws(() => consume(fixture, permit, candidate, fixture.principal, `${fixture.attemptId}_other`),
      (error: unknown) => code(error) === "PRINCIPAL_MISMATCH" || code(error) === "INVALID_REQUEST");
    assert.equal(consume(fixture, permit).status, "consumed");
    assert.throws(() => consume(fixture, permit), (error: unknown) => code(error) === "PERMIT_ALREADY_CONSUMED");
    assert.equal(JSON.stringify(permit).includes("https://r2.syntx.ai"), false);
  } finally { await fixture.close(); }
});

test("honors the original candidate TTL, clock monotonicity, attempt invalidation, and close", async () => {
  const expiring = await makeCandidate(CASES[0]!);
  try {
    expiring.setNow(BASE + 14 * 60_000);
    const permit = createPermit(expiring);
    assert.equal(permit.expires_at, BASE + 15 * 60_000);
    expiring.setNow(BASE + 15 * 60_000);
    assert.throws(() => consume(expiring, permit), (error: unknown) => code(error) === "PERMIT_EXPIRED");
  } finally { await expiring.close(); }

  const rollback = await makeCandidate(CASES[0]!);
  try {
    const permit = createPermit(rollback);
    rollback.setNow(BASE - 1);
    assert.throws(() => consume(rollback, permit), (error: unknown) => code(error) === "CLOCK_INVALID");
  } finally { await rollback.close(); }

  const invalidated = await makeCandidate(CASES[0]!);
  const invalidatedPermit = createPermit(invalidated);
  await invalidated.assetIssuer.invalidateAttempt(invalidated.attemptId);
  assert.throws(() => consume(invalidated, invalidatedPermit), (error: unknown) => code(error) === "CANDIDATE_EXPIRED" || code(error) === "CANDIDATE_MISMATCH");
  await invalidated.close();

  const closed = await makeCandidate(CASES[0]!);
  const closedPermit = createPermit(closed);
  await closed.assetIssuer.close();
  assert.throws(() => consume(closed, closedPermit), (error: unknown) => code(error) === "CANDIDATE_EXPIRED" || code(error) === "CANDIDATE_MISMATCH");
  await closed.uploadService.close();
});

test("rechecks the exact pinned source profile at consume time", async () => {
  let stale = false;
  const catalog = Object.create(CATALOG) as OwnerIdeogramImageCatalogPort;
  Object.defineProperty(catalog, "getModel", { enumerable: true, configurable: false, value: (id: string) => {
    const model = CATALOG.getModel(id);
    return stale && id === "ideogram_45" ? { ...model, display_name: "stale profile" } : model;
  } });
  const fixture = await makeCandidate(CASES[7]!, catalog);
  try {
    const permit = createPermit(fixture);
    stale = true;
    assert.throws(() => consume(fixture, permit), (error: unknown) => code(error) === "CATALOG_BINDING_MISMATCH");
  } finally { await fixture.close(); }
});
