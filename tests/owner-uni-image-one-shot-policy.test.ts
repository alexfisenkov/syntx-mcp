import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { OwnerUniImageRequestPreparer } from "../src/application/owner-uni-image-request-preparer.js";
import { OwnerUniImageUploadService } from "../src/application/owner-uni-image-upload-service.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { syntxPublicCatalogSnapshotSchema } from "../src/catalog/syntx-public-catalog.js";

const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const CATALOG = new DiscoveryCatalogRepository(syntxPublicCatalogSnapshotSchema.parse(JSON.parse(readFileSync(
  join(process.cwd(), "catalog/public", CATALOG_VERSION), "utf8"
))));
const BINDING = Object.freeze({ tenant_id: "uni-permit-tenant", subject: "uni-permit-subject" });
const ATTEMPT = "link_uni_permit_00000000000000000001";
const PRINCIPAL = Object.freeze({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });
const NOW = Date.parse("2026-10-11T00:00:00.000Z");
const POLICY_URL = new URL("../src/application/owner-uni-image-one-shot-policy.js", import.meta.url).href;
const JPEG = Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x0b,0x08,0x00,0x01,0x00,0x01,0x01,0x01,0x11,0x00,0xff,0xda,0x00,0x08,0x01,0x01,0x00,0x00,0x3f,0x00,0x00,0xff,0xd9]);

function jpegWithWidth(width: number): Buffer {
  const bytes = Buffer.from(JPEG); bytes.writeUInt16BE(width, 9); return bytes;
}
function credentialBroker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    return operation("synthetic-uni-permit-credential");
  } };
}
function linkedAttempt(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: null, linked: true };
}

async function createZeroReferenceUni1Candidate(now: () => number = () => NOW) {
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } };
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    throw new Error("zero-reference permit fixture must not upload");
  } });
  const uploadService = new OwnerUniImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveClient: () => client, now });
  const preparer = new OwnerUniImageRequestPreparer({ binding: BINDING, linkService, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now });
  const assetSet = await preparer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "uni-1",
    prompt: "a nominal zero-reference request", parameters: { aspect_ratio: "1:1", seed: null, mode: "auto" },
    image_reference_handles: [], main_image_reference_handle: null });
  const candidate = await preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: assetSet });
  return { preparer, uploadService, candidate, async close() { await preparer.close(); await uploadService.close(); } };
}

test("issues and consumes one nominal permit for actual Uni-1, Modify, and BG candidates without granting dispatch", async () => {
  let policyModule: Record<string, unknown> | undefined;
  try { policyModule = await import(POLICY_URL) as Record<string, unknown>; } catch { /* Expected first RED until policy is implemented. */ }
  assert.equal(typeof policyModule?.createOwnerUniImageOneShotPermit, "function", "MISSING_OWNER_UNI_IMAGE_ONESHOT_ISSUER");
  assert.equal(typeof policyModule?.consumeOwnerUniImageOneShotPermit, "function", "MISSING_OWNER_UNI_IMAGE_ONESHOT_CONSUMER");
  const createPermit = policyModule!.createOwnerUniImageOneShotPermit as (input: unknown) => Record<string, unknown>;
  const consumePermit = policyModule!.consumeOwnerUniImageOneShotPermit as (input: unknown) => Record<string, unknown>;
  const PolicyError = policyModule!.OwnerUniImageOneShotPolicyError as new (...args: never[]) => Error & { code: string };
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (_input, init) => {
    posts += 1;
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    const model = String((init?.body as FormData).get("model_type"));
    return Response.json({ files: [{ id: `uni-permit-${posts}`, url: `https://r2.syntx.ai/private/uni/permit-${posts}.jpg`,
      mime_type: file.type, size: file.size, model_type: model }] });
  } });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } };
  const uploadService = new OwnerUniImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const preparer = new OwnerUniImageRequestPreparer({ binding: BINDING, linkService, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => NOW });
  try {
    const modifyRef = await uploadService.upload({ attemptId: ATTEMPT, model_id: "uni-1.1-modify-image",
      content_base64: jpegWithWidth(2).toString("base64"), filename: "modify.jpg", mime_type: "image/jpeg" });
    const backgroundRef = await uploadService.upload({ attemptId: ATTEMPT, model_id: "uni-1.1-remove-background",
      content_base64: jpegWithWidth(3).toString("base64"), filename: "background.jpg", mime_type: "image/jpeg" });
    const cases = [
      { model_id: "uni-1", prompt: "explicit zero-reference generation intent", parameters: { aspect_ratio: "1:1", seed: null, mode: "auto" },
        image_reference_handles: [], main_image_reference_handle: null },
      { model_id: "uni-1.1-modify-image", prompt: "modify the selected source", parameters: { seed: 9, mode: "manga" },
        image_reference_handles: [modifyRef.reference_handle], main_image_reference_handle: modifyRef.reference_handle },
      { model_id: "uni-1.1-remove-background", prompt: "", parameters: { invert_mask: true },
        image_reference_handles: [backgroundRef.reference_handle], main_image_reference_handle: null }
    ] as const;
    for (const input of cases) {
      const { model_id: variant, ...intent } = input;
      const assetSet = await preparer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant, ...intent });
      const candidate = await preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: assetSet });
      const permit = createPermit({ preparer, candidate, principal: PRINCIPAL, attemptId: ATTEMPT,
        catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => NOW });
      assert.equal(permit.status, "nominal");
      assert.equal(permit.dispatch_allowed, false);
      assert.equal(permit.backend_acceptance, "UNPROVEN");
      assert.equal(permit.cost_input_confidence, "ROUTING_ONLY_NOT_QUOTE_BILLING_OR_ADMISSION");
      assert.equal(permit.profile_id, candidate.profile_id);
      assert.equal(permit.profile_schema_hash, candidate.profile_schema_hash);
      assert.notEqual(permit.profile_schema_hash, candidate.source_binding.upload_profile_reference.schema_hash);
      assert.equal(permit.model_id, input.model_id);
      const consumed = consumePermit({ permit, candidate, principal: PRINCIPAL, attemptId: ATTEMPT });
      assert.deepEqual(consumed, { status: "consumed", dispatch_allowed: false, request_fingerprint: candidate.request_fingerprint });
      assert.throws(() => consumePermit({ permit, candidate, principal: PRINCIPAL, attemptId: ATTEMPT }),
        (error: unknown) => error instanceof PolicyError && error.code === "PERMIT_ALREADY_CONSUMED");
      assert.throws(() => createPermit({ preparer, candidate, principal: PRINCIPAL, attemptId: ATTEMPT,
        catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => NOW }),
        (error: unknown) => error instanceof PolicyError && error.code === "CANDIDATE_ALREADY_ISSUED");
    }
    assert.equal(posts, 2);
  } finally {
    await preparer.close();
    await uploadService.close();
  }
});

test("rejects copied permit/candidate, foreign preparer, caller grant flags, and mismatched principal", async () => {
  const policyModule = await import(POLICY_URL) as Record<string, unknown>;
  const createPermit = policyModule.createOwnerUniImageOneShotPermit as (input: unknown) => Record<string, unknown>;
  const consumePermit = policyModule.consumeOwnerUniImageOneShotPermit as (input: unknown) => Record<string, unknown>;
  const PolicyError = policyModule.OwnerUniImageOneShotPolicyError as new (...args: never[]) => Error & { code: string };
  const rig = await createZeroReferenceUni1Candidate();
  const foreignPreparer = new OwnerUniImageRequestPreparer({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } },
    imageUploadService: rig.uploadService, catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => NOW });
  try {
    assert.throws(() => createPermit({ preparer: rig.preparer, candidate: { ...rig.candidate }, principal: PRINCIPAL,
      attemptId: ATTEMPT, catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => NOW }),
      (error: unknown) => error instanceof PolicyError && error.code === "CANDIDATE_UNBOUND");
    assert.throws(() => createPermit({ preparer: foreignPreparer, candidate: rig.candidate, principal: PRINCIPAL,
      attemptId: ATTEMPT, catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => NOW }),
      (error: unknown) => error instanceof PolicyError && error.code === "CANDIDATE_UNBOUND");
    assert.throws(() => createPermit({ preparer: rig.preparer, candidate: rig.candidate, principal: PRINCIPAL,
      attemptId: ATTEMPT, catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => NOW, dispatch_allowed: true }),
      (error: unknown) => error instanceof PolicyError && error.code === "INVALID_REQUEST");
    const permit = createPermit({ preparer: rig.preparer, candidate: rig.candidate, principal: PRINCIPAL,
      attemptId: ATTEMPT, catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => NOW });
    assert.throws(() => consumePermit({ permit: { ...permit }, candidate: rig.candidate, principal: PRINCIPAL, attemptId: ATTEMPT }),
      (error: unknown) => error instanceof PolicyError && error.code === "PERMIT_INVALID");
    assert.throws(() => consumePermit({ permit, candidate: rig.candidate,
      principal: { ...PRINCIPAL, subject_id: "different-subject" }, attemptId: ATTEMPT }),
      (error: unknown) => error instanceof PolicyError && error.code === "PRINCIPAL_MISMATCH");
    assert.deepEqual(consumePermit({ permit, candidate: rig.candidate, principal: PRINCIPAL, attemptId: ATTEMPT }),
      { status: "consumed", dispatch_allowed: false, request_fingerprint: rig.candidate.request_fingerprint });
  } finally { await Promise.all([rig.close(), foreignPreparer.close()]); }
});

test("caps permit lifetime at the original candidate expiry and fails closed on clock rollback", async () => {
  const policyModule = await import(POLICY_URL) as Record<string, unknown>;
  const createPermit = policyModule.createOwnerUniImageOneShotPermit as (input: unknown) => Record<string, unknown>;
  const consumePermit = policyModule.consumeOwnerUniImageOneShotPermit as (input: unknown) => Record<string, unknown>;
  const PolicyError = policyModule.OwnerUniImageOneShotPolicyError as new (...args: never[]) => Error & { code: string };
  let now = NOW;
  const rig = await createZeroReferenceUni1Candidate(() => now);
  try {
    const candidateExpiry = rig.candidate.expires_at as number;
    now += 5 * 60_000;
    const permit = createPermit({ preparer: rig.preparer, candidate: rig.candidate, principal: PRINCIPAL,
      attemptId: ATTEMPT, catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => now });
    assert.equal(permit.expires_at, candidateExpiry, "permit may not extend original 803 candidate lifetime");
    now = candidateExpiry;
    assert.throws(() => consumePermit({ permit, candidate: rig.candidate, principal: PRINCIPAL, attemptId: ATTEMPT }),
      (error: unknown) => error instanceof PolicyError && error.code === "PERMIT_EXPIRED");

    now += 1;
    const secondAssetSet = await rig.preparer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "uni-1",
      prompt: "separate candidate for rollback check", parameters: { aspect_ratio: "3:2", seed: 1, mode: "auto" },
      image_reference_handles: [], main_image_reference_handle: null });
    const secondCandidate = await rig.preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: secondAssetSet });
    const secondPermit = createPermit({ preparer: rig.preparer, candidate: secondCandidate, principal: PRINCIPAL,
      attemptId: ATTEMPT, catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => now });
    now -= 1;
    assert.throws(() => consumePermit({ permit: secondPermit, candidate: secondCandidate, principal: PRINCIPAL, attemptId: ATTEMPT }),
      (error: unknown) => error instanceof PolicyError && error.code === "CLOCK_INVALID");
  } finally { await rig.close(); }
});

test("refuses permit consumption after the bound full catalog record drifts", async () => {
  const policyModule = await import(POLICY_URL) as Record<string, unknown>;
  const createPermit = policyModule.createOwnerUniImageOneShotPermit as (input: unknown) => Record<string, unknown>;
  const consumePermit = policyModule.consumeOwnerUniImageOneShotPermit as (input: unknown) => Record<string, unknown>;
  const PolicyError = policyModule.OwnerUniImageOneShotPolicyError as new (...args: never[]) => Error & { code: string };
  let drift = false;
  const catalog = {
    getModel(modelId: string) {
      const record = CATALOG.getModel(modelId);
      return drift ? { ...record, description: "Uni model record changed after permit issue" } : record;
    },
    catalog_kind: CATALOG.catalog_kind, runtime_usable: CATALOG.runtime_usable, fetched_at: CATALOG.fetched_at,
    source_hashes: CATALOG.source_hashes, catalog_metadata: CATALOG.catalog_metadata
  };
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } };
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    throw new Error("zero-reference permit fixture must not upload");
  } });
  const uploadService = new OwnerUniImageUploadService({ binding: BINDING, linkService, catalog,
    catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const preparer = new OwnerUniImageRequestPreparer({ binding: BINDING, linkService, imageUploadService: uploadService,
    catalog, catalog_version: CATALOG_VERSION, now: () => NOW });
  try {
    const assetSet = await preparer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "uni-1",
      prompt: "catalog-bound permit", parameters: { aspect_ratio: "1:1", seed: null, mode: "auto" },
      image_reference_handles: [], main_image_reference_handle: null });
    const candidate = await preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: assetSet });
    const permit = createPermit({ preparer, candidate, principal: PRINCIPAL, attemptId: ATTEMPT,
      catalog, catalog_version: CATALOG_VERSION, now: () => NOW });
    drift = true;
    assert.throws(() => consumePermit({ permit, candidate, principal: PRINCIPAL, attemptId: ATTEMPT }),
      (error: unknown) => error instanceof PolicyError && error.code === "CANDIDATE_UNBOUND");
  } finally {
    await preparer.close();
    await uploadService.close();
  }
});

test("refuses consumption after the actual Task800 reference is revoked", async () => {
  const policyModule = await import(POLICY_URL) as Record<string, unknown>;
  const createPermit = policyModule.createOwnerUniImageOneShotPermit as (input: unknown) => Record<string, unknown>;
  const consumePermit = policyModule.consumeOwnerUniImageOneShotPermit as (input: unknown) => Record<string, unknown>;
  const PolicyError = policyModule.OwnerUniImageOneShotPolicyError as new (...args: never[]) => Error & { code: string };
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } };
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (_input, init) => {
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    return Response.json({ files: [{ id: "uni-revoked-permit", url: "https://r2.syntx.ai/private/uni/revoked-permit.jpg",
      mime_type: file.type, size: file.size }] });
  } });
  const uploadService = new OwnerUniImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const preparer = new OwnerUniImageRequestPreparer({ binding: BINDING, linkService, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => NOW });
  try {
    const bytes = jpegWithWidth(5);
    const upload = await uploadService.upload({ attemptId: ATTEMPT, model_id: "uni-1.1-modify-image",
      content_base64: bytes.toString("base64"), filename: "revoked.jpg", mime_type: "image/jpeg" });
    const assetSet = await preparer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "uni-1.1-modify-image",
      prompt: "must revoke after upload link is invalidated", parameters: { seed: null, mode: "auto" },
      image_reference_handles: [upload.reference_handle], main_image_reference_handle: upload.reference_handle });
    const candidate = await preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: assetSet });
    const permit = createPermit({ preparer, candidate, principal: PRINCIPAL, attemptId: ATTEMPT,
      catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => NOW });
    await uploadService.invalidateAttempt(ATTEMPT);
    assert.throws(() => consumePermit({ permit, candidate, principal: PRINCIPAL, attemptId: ATTEMPT }),
      (error: unknown) => error instanceof PolicyError && error.code === "CANDIDATE_UNBOUND");
  } finally {
    await preparer.close();
    await uploadService.close();
  }
});
