import assert from "node:assert/strict";
import test from "node:test";
import { loadGenerationContractRegistryV2 } from "../src/catalog/generation-contract-history-v2.js";
import { loadSelectedPublicCatalog } from "../src/catalog/public-catalog-history.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { OwnerMediaReferenceStore } from "../src/application/owner-media-reference-store.js";
import {
  getOwnerImageReferenceCandidateStoreBinding,
  prepareOwnerImageReferenceRequest
} from "../src/application/owner-image-reference-request-preparer.js";
import {
  consumeOwnerImageReferenceOneShotPermit,
  createOwnerImageReferenceOneShotPermit,
  OwnerImageReferenceOneShotPolicyError
} from "../src/application/owner-image-reference-one-shot-policy.js";
import type { AuthBinding, PublicAuthLinkAttempt } from "../src/auth/types.js";

const ROOT = process.cwd();
const REGISTRY_VERSION = "sha256-0e5b7a6ab56a4fc5103c025690293297b49258c1c876d7a0a663ff7959099d39.json";
const PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const ATTEMPT = "link_abcdefghijklmnopqrstuvwxyz123456";
const BINDING: AuthBinding = { tenant_id: "tenant_local_owner", subject: "subject_local_owner" };
const PRINCIPAL = Object.freeze({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });

async function fixture() {
  const registry = loadGenerationContractRegistryV2(REGISTRY_VERSION, `${ROOT}/catalog`);
  const snapshot = loadSelectedPublicCatalog({ version: PUBLIC_VERSION, catalogDirectory: `${ROOT}/catalog` }).snapshot;
  const catalog = new DiscoveryCatalogRepository(snapshot);
  const store = new OwnerMediaReferenceStore({ createHandle: () => "reference_823e4567-e89b-12d3-a456-426614174000" });
  const linkService = {
    async getStatus(_binding: AuthBinding, attemptId: string): Promise<PublicAuthLinkAttempt> {
      return {
        attempt_id: attemptId,
        authorization_profile: "OBSERVED_OWNER_AUTHORIZED",
        status: "LINKED",
        expires_at: null,
        linked: true
      };
    }
  };
  const contract = getOwnerImageReferenceCandidateStoreBinding(registry, catalog);
  const receipt = await store.uploadAndIssue({
    binding: BINDING,
    attemptId: ATTEMPT,
    linkService,
    client: { async uploadFileReferences() { return [{ url: "https://r2.syntx.ai/owned/reference.png" }]; } },
    contract,
    filename: "reference.png",
    mime_type: "image/png",
    bytes: Uint8Array.from([1, 2, 3])
  });
  const candidate = await prepareOwnerImageReferenceRequest({
    registry,
    catalog,
    store,
    binding: BINDING,
    attemptId: ATTEMPT,
    linkService,
    reference_handle: receipt.reference_handle,
    parameters: { prompt: "Use this source image as reference." }
  });
  return { registry, catalog, candidate, store };
}

function createPermit(context: Awaited<ReturnType<typeof fixture>>, now?: () => number) {
  return createOwnerImageReferenceOneShotPermit({
    candidate: context.candidate,
    registry: context.registry,
    catalog: context.catalog,
    principal: PRINCIPAL,
    attemptId: ATTEMPT,
    ...(now ? { now } : {})
  });
}

test("creates a permit bound to one exact candidate and consumes it once", async () => {
  const context = await fixture();
  let now = 1_000;
  const permit = createPermit(context, () => now);
  assert.equal(permit.status, "authorized");
  assert.equal(permit.dispatch_allowed, false);
  assert.equal(permit.candidate_schema_hash, context.candidate.candidate_schema_hash);
  assert.deepEqual(Object.keys(permit).sort(), ["candidate_schema_hash", "dispatch_allowed", "expires_at", "status"]);
  assert.equal(permit.expires_at, 901_000);
  const consumed = consumeOwnerImageReferenceOneShotPermit({
    permit,
    candidate: context.candidate,
    principal: PRINCIPAL,
    attemptId: ATTEMPT
  });
  assert.equal(consumed.status, "consumed");
  now += 1;
  assert.throws(() => consumeOwnerImageReferenceOneShotPermit({
    permit,
    candidate: context.candidate,
    principal: PRINCIPAL,
    attemptId: ATTEMPT
  }), (error: unknown) => error instanceof OwnerImageReferenceOneShotPolicyError && error.code === "PERMIT_ALREADY_CONSUMED");
});

test("racing consumes authorize exactly one caller", async () => {
  const context = await fixture();
  const permit = createPermit(context);
  const results = await Promise.allSettled([
    Promise.resolve().then(() => consumeOwnerImageReferenceOneShotPermit({ permit, candidate: context.candidate, principal: PRINCIPAL, attemptId: ATTEMPT })),
    Promise.resolve().then(() => consumeOwnerImageReferenceOneShotPermit({ permit, candidate: context.candidate, principal: PRINCIPAL, attemptId: ATTEMPT }))
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(rejected && rejected.status === "rejected");
  assert.ok(rejected.reason instanceof OwnerImageReferenceOneShotPolicyError);
  assert.equal(rejected.reason.code, "PERMIT_ALREADY_CONSUMED");
});

test("rejects copied permit, foreign principal, wrong attempt and changed candidate payload", async () => {
  const context = await fixture();
  const permit = createPermit(context);
  const copiedPermit = Object.freeze({ ...permit });
  assert.throws(() => consumeOwnerImageReferenceOneShotPermit({
    permit: copiedPermit as unknown as typeof permit,
    candidate: context.candidate,
    principal: PRINCIPAL,
    attemptId: ATTEMPT
  }), (error: unknown) => error instanceof OwnerImageReferenceOneShotPolicyError && error.code === "PERMIT_INVALID");

  assert.throws(() => consumeOwnerImageReferenceOneShotPermit({
    permit,
    candidate: context.candidate,
    principal: { ...PRINCIPAL, tenant_id: "tenant_foreign" },
    attemptId: ATTEMPT
  }), (error: unknown) => error instanceof OwnerImageReferenceOneShotPolicyError && error.code === "PRINCIPAL_MISMATCH");
  assert.throws(() => consumeOwnerImageReferenceOneShotPermit({
    permit,
    candidate: context.candidate,
    principal: PRINCIPAL,
    attemptId: "link_other_attempt_123456789"
  }), (error: unknown) => error instanceof OwnerImageReferenceOneShotPolicyError && error.code === "PRINCIPAL_MISMATCH");

  const brand = Object.getOwnPropertySymbols(context.candidate)[0]!;
  const substituted = Object.freeze({
    ...context.candidate,
    request: Object.freeze({ ...context.candidate.request, prompt: "A different private prompt." }),
    [brand]: true
  });
  assert.throws(() => consumeOwnerImageReferenceOneShotPermit({
    permit,
    candidate: substituted,
    principal: PRINCIPAL,
    attemptId: ATTEMPT
  }), (error: unknown) => error instanceof OwnerImageReferenceOneShotPolicyError && error.code === "CANDIDATE_MISMATCH");
});

test("does not mint a permit for a copied candidate or a candidate owned by another principal", async () => {
  const context = await fixture();
  const copiedCandidate = Object.freeze({ ...context.candidate });
  assert.throws(() => createOwnerImageReferenceOneShotPermit({
    candidate: copiedCandidate,
    registry: context.registry,
    catalog: context.catalog,
    principal: PRINCIPAL,
    attemptId: ATTEMPT
  }), (error: unknown) => error instanceof OwnerImageReferenceOneShotPolicyError && error.code === "CANDIDATE_UNBOUND");

  const foreignPrincipal = Object.freeze({ ...PRINCIPAL, tenant_id: "tenant_foreign" });
  assert.throws(() => createOwnerImageReferenceOneShotPermit({
    candidate: context.candidate,
    registry: context.registry,
    catalog: context.catalog,
    principal: foreignPrincipal,
    attemptId: ATTEMPT
  }), (error: unknown) => error instanceof OwnerImageReferenceOneShotPolicyError && error.code === "CANDIDATE_UNBOUND");
});

test("expires at 15 minutes and rejects malformed clocks and unbound registry input", async () => {
  const context = await fixture();
  let now = 5_000;
  const permit = createPermit(context, () => now);
  now += 15 * 60_000;
  assert.throws(() => consumeOwnerImageReferenceOneShotPermit({
    permit,
    candidate: context.candidate,
    principal: PRINCIPAL,
    attemptId: ATTEMPT
  }), (error: unknown) => error instanceof OwnerImageReferenceOneShotPolicyError && error.code === "PERMIT_EXPIRED");

  assert.throws(() => createPermit(context, () => Number.NaN),
    (error: unknown) => error instanceof OwnerImageReferenceOneShotPolicyError && error.code === "CLOCK_INVALID");
  const invalidRegistry = { ...context.registry, registry_sha256: `sha256:${"0".repeat(64)}` };
  assert.throws(() => createOwnerImageReferenceOneShotPermit({
    candidate: context.candidate,
    registry: invalidRegistry,
    catalog: context.catalog,
    principal: PRINCIPAL,
    attemptId: ATTEMPT
  }), (error: unknown) => error instanceof OwnerImageReferenceOneShotPolicyError && error.code === "CANDIDATE_UNBOUND");
});

test("invalidates a permit if its clock moves backwards", async () => {
  const context = await fixture();
  let now = 8_000;
  const permit = createPermit(context, () => now);
  now -= 1;
  assert.throws(() => consumeOwnerImageReferenceOneShotPermit({
    permit,
    candidate: context.candidate,
    principal: PRINCIPAL,
    attemptId: ATTEMPT
  }), (error: unknown) => error instanceof OwnerImageReferenceOneShotPolicyError && error.code === "CLOCK_INVALID");
  now += 1;
  assert.throws(() => consumeOwnerImageReferenceOneShotPermit({
    permit,
    candidate: context.candidate,
    principal: PRINCIPAL,
    attemptId: ATTEMPT
  }), (error: unknown) => error instanceof OwnerImageReferenceOneShotPolicyError && error.code === "PERMIT_EXPIRED");
});
