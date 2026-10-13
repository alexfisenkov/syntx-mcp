import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { loadSelectedDiscoveryCatalog, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import {
  createOwnerMagnificUpscaleOwnedImageBindingIssuer,
  getOwnerMagnificUpscaleSourceProfile,
  prepareOwnerMagnificUpscaleRequest,
  type OwnerMagnificUpscaleOwnedImageResolution
} from "../src/application/owner-magnific-upscale-request-preparer.js";
import {
  consumeOwnerMagnificUpscaleOneShotPermit,
  createOwnerMagnificUpscaleOneShotPermit,
  OwnerMagnificUpscaleOneShotPolicyError
} from "../src/application/owner-magnific-upscale-one-shot-policy.js";
import type { GenerationPrincipalRef } from "../src/domain/generation-operation.js";
import type { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import type { OwnerMagnificUpscaleVariant } from "../src/application/owner-magnific-upscale-parameters.js";

const ATTEMPT = "link_magnific_oneshot_attempt_000001";
const PRINCIPAL: Readonly<GenerationPrincipalRef> = Object.freeze({
  tenant_id: "owner-magnific-tenant", subject_id: "owner-magnific-subject", connection_id: ATTEMPT
});
const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const E551_MODELS_HASH = "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444";
const NOW = 50_000;
const PARAMETERS = Object.freeze({
  scale_factor: "2x", optimized_for: "standard", engine: "automatic", creativity: 3, hdr: 3,
  resemblance: 3, fractality: 3, sharpen: 30, smart_grain: 30, ultra_detail: 30, flavor: "sublime"
} as const);
const catalog = loadSelectedDiscoveryCatalog(CATALOG_VERSION, resolve(process.cwd(), "catalog")).discoveryCatalog;

function resolution(variant: OwnerMagnificUpscaleVariant, expires_at: number): OwnerMagnificUpscaleOwnedImageResolution {
  const profile = getOwnerMagnificUpscaleSourceProfile(variant);
  return {
    principal: PRINCIPAL, attempt_id: ATTEMPT, variant, model_id: variant,
    scope: "tool_image_upscaler", catalog_version: CATALOG_VERSION, profile_schema_hash: profile.profile_schema_hash,
    file_url: `https://r2.syntx.ai/private/magnific-${variant}?sig=localfixture`, mime_type: "image/png",
    width: 512, height: 512, size: 5_461, sha256: `sha256:${"a".repeat(64)}`, expires_at,
    metadata_confidence: "CONTAINER_METADATA_ONLY"
  };
}

async function makeCandidate(
  variant: OwnerMagnificUpscaleVariant,
  expires_at = 2_000_000,
  prompt?: string
) {
  const issuer = createOwnerMagnificUpscaleOwnedImageBindingIssuer(
    async () => resolution(variant, expires_at), { now: () => NOW }
  );
  const binding = await issuer.issue({
    principal: PRINCIPAL, attempt_id: ATTEMPT, variant, opaque_image_handle: `magnific_image_${variant}_fixture`
  });
  const candidate = prepareOwnerMagnificUpscaleRequest({
    principal: PRINCIPAL, attempt_id: ATTEMPT, variant, parameters: PARAMETERS, image_binding: binding,
    ...(prompt === undefined ? {} : { prompt })
  }, { now: () => NOW });
  return { candidate, issuer };
}

function wrongCatalog(overrides: Record<string, unknown> = {}, getModel?: (modelId: string) => unknown): DiscoveryCatalogRepository {
  const fake = Object.create(Object.getPrototypeOf(catalog)) as Record<string, unknown>;
  Object.defineProperties(fake, {
    catalog_kind: { value: overrides.catalog_kind ?? catalog.catalog_kind, enumerable: true },
    runtime_usable: { value: overrides.runtime_usable ?? catalog.runtime_usable, enumerable: true },
    fetched_at: { value: overrides.fetched_at ?? catalog.fetched_at, enumerable: true },
    source_hashes: { value: overrides.source_hashes ?? catalog.source_hashes, enumerable: true },
    getModel: { value: getModel ?? ((modelId: string) => catalog.getModel(modelId)), enumerable: true }
  });
  return fake as unknown as DiscoveryCatalogRepository;
}

function expectPolicyThrows(callback: () => unknown, code: string): void {
  assert.throws(callback, (error: unknown) => error instanceof OwnerMagnificUpscaleOneShotPolicyError && error.code === code);
}

test("issues a nominal source/catalog-bound one-shot permit for each of the three real prepared variants", async () => {
  for (const variant of ["creative", "precision_v1", "precision_v2"] as const) {
    const { candidate } = await makeCandidate(variant);
    assert.equal(candidate.model_id, variant);
    assert.equal(candidate.ai_name, "magnific");
    assert.equal(candidate.backend_acceptance, "UNPROVEN");
    assert.deepEqual(candidate.request.settings, {
      n: 1, model_type: variant, width: 512, height: 512,
      scale_factor: "2x", optimized_for: "standard", engine: "automatic", creativity: 3, hdr: 3,
      resemblance: 3, fractality: 3, sharpen: 30, smart_grain: 30, ultra_detail: 30, flavor: "sublime",
      file_urls: [{ type: "image", url: `https://r2.syntx.ai/private/magnific-${variant}?sig=localfixture` }]
    });
    const permit = createOwnerMagnificUpscaleOneShotPermit({ candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog, now: () => NOW });
    assert.equal(Object.isFrozen(permit), true);
    assert.equal(permit.status, "authorized");
    assert.equal(permit.dispatch_allowed, false);
    assert.equal(permit.variant, variant);
    assert.equal(permit.model_id, variant);
    assert.equal(permit.ai_name, "magnific");
    assert.equal(permit.profile_schema_hash, candidate.profile_schema_hash);
    assert.equal(permit.public_catalog_version, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION);
    assert.equal(permit.catalog_version, `${catalog.fetched_at}.${E551_MODELS_HASH.slice(7, 19)}`);
    assert.equal(permit.request_fingerprint, candidate.request_fingerprint);
    assert.equal(permit.expires_at, NOW + 900_000);
    assert.equal(JSON.stringify(permit).includes("r2.syntx.ai"), false);
    assert.equal(JSON.stringify(permit).includes("file_urls"), false);
    const receipt = consumeOwnerMagnificUpscaleOneShotPermit({ permit, candidate, principal: PRINCIPAL, attemptId: ATTEMPT });
    assert.deepEqual(receipt, { status: "consumed", dispatch_allowed: false, request_fingerprint: candidate.request_fingerprint });
  }
});

test("permit lifetime is the earlier of candidate expiry and fifteen minutes", async () => {
  const short = await makeCandidate("creative", NOW + 20_000);
  const shortPermit = createOwnerMagnificUpscaleOneShotPermit({
    candidate: short.candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog, now: () => NOW
  });
  assert.equal(shortPermit.expires_at, NOW + 20_000);

  const long = await makeCandidate("precision_v2", NOW + 1_500_000);
  const longPermit = createOwnerMagnificUpscaleOneShotPermit({
    candidate: long.candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog, now: () => NOW
  });
  assert.equal(longPermit.expires_at, NOW + 900_000);
  const expired = await makeCandidate("precision_v1", NOW + 1);
  expectPolicyThrows(() => createOwnerMagnificUpscaleOneShotPermit({
    candidate: expired.candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog, now: () => NOW + 1
  }), "CANDIDATE_EXPIRED");
});

test("failed issuance does not reserve candidate, but successful issuance permanently prevents reissue", async () => {
  const { candidate } = await makeCandidate("creative");
  expectPolicyThrows(() => createOwnerMagnificUpscaleOneShotPermit({
    candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog: wrongCatalog({ fetched_at: "2030-01-01T00:00:00.000Z" }), now: () => NOW
  }), "CATALOG_BINDING_MISMATCH");
  const permit = createOwnerMagnificUpscaleOneShotPermit({ candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog, now: () => NOW });
  expectPolicyThrows(() => createOwnerMagnificUpscaleOneShotPermit({ candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog, now: () => NOW }),
    "CANDIDATE_ALREADY_ISSUED");
  consumeOwnerMagnificUpscaleOneShotPermit({ permit, candidate, principal: PRINCIPAL, attemptId: ATTEMPT });
  expectPolicyThrows(() => createOwnerMagnificUpscaleOneShotPermit({ candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog, now: () => NOW }),
    "CANDIDATE_ALREADY_ISSUED");
});

test("cloned candidate or permit, changed principal, and swapped candidate cannot consume", async () => {
  const { candidate } = await makeCandidate("precision_v1");
  const permit = createOwnerMagnificUpscaleOneShotPermit({ candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog, now: () => NOW });
  expectPolicyThrows(() => consumeOwnerMagnificUpscaleOneShotPermit({
    permit: { ...permit }, candidate, principal: PRINCIPAL, attemptId: ATTEMPT
  }), "PERMIT_INVALID");
  expectPolicyThrows(() => consumeOwnerMagnificUpscaleOneShotPermit({
    permit, candidate: { ...candidate }, principal: PRINCIPAL, attemptId: ATTEMPT
  }), "CANDIDATE_MISMATCH");
  expectPolicyThrows(() => consumeOwnerMagnificUpscaleOneShotPermit({
    permit, candidate, principal: { ...PRINCIPAL, subject_id: "other" }, attemptId: ATTEMPT
  }), "PRINCIPAL_MISMATCH");
  const other = await makeCandidate("precision_v1", 2_000_000, "different exact intent");
  expectPolicyThrows(() => consumeOwnerMagnificUpscaleOneShotPermit({
    permit, candidate: other.candidate, principal: PRINCIPAL, attemptId: ATTEMPT
  }), "CANDIDATE_MISMATCH");
});

test("native selected e551 catalog must match exact source epoch and selected active Magnific upscale model", async () => {
  const { candidate } = await makeCandidate("creative");
  const invalidCatalogs = [
    wrongCatalog({ catalog_kind: "OTHER" }),
    wrongCatalog({ runtime_usable: true }),
    wrongCatalog({ fetched_at: "2026-10-09T00:00:00.000Z" }),
    wrongCatalog({ source_hashes: { ...catalog.source_hashes, models: `sha256:${"0".repeat(64)}` } }),
    wrongCatalog({}, (id) => ({ ...catalog.getModel(id), active: false })),
    wrongCatalog({}, (id) => ({ ...catalog.getModel(id), ai_name: "other" })),
    wrongCatalog({}, (id) => ({ ...catalog.getModel(id), upstream_id: "other" })),
    wrongCatalog({}, (id) => ({ ...catalog.getModel(id), scope: "tool_image_inpaint" })),
    wrongCatalog({}, (id) => ({ ...catalog.getModel(id), operations: [] }))
  ];
  for (const invalid of invalidCatalogs) {
    expectPolicyThrows(() => createOwnerMagnificUpscaleOneShotPermit({
      candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog: invalid, now: () => NOW
    }), "CATALOG_BINDING_MISMATCH");
  }
  assert.doesNotThrow(() => createOwnerMagnificUpscaleOneShotPermit({ candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog, now: () => NOW }));
});

test("clock rollback and expiry are sticky and never resurrect an unconsumed permit", async () => {
  const { candidate } = await makeCandidate("precision_v2", NOW + 1_500_000);
  let now = NOW;
  const permit = createOwnerMagnificUpscaleOneShotPermit({ candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog, now: () => now });
  now -= 1;
  expectPolicyThrows(() => consumeOwnerMagnificUpscaleOneShotPermit({ permit, candidate, principal: PRINCIPAL, attemptId: ATTEMPT }), "CLOCK_INVALID");
  now = NOW + 20;
  expectPolicyThrows(() => consumeOwnerMagnificUpscaleOneShotPermit({ permit, candidate, principal: PRINCIPAL, attemptId: ATTEMPT }), "PERMIT_EXPIRED");

  const expiring = await makeCandidate("creative", NOW + 900_000);
  let expiryClock = NOW;
  const expiredPermit = createOwnerMagnificUpscaleOneShotPermit({
    candidate: expiring.candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog, now: () => expiryClock
  });
  expiryClock = NOW + 900_000;
  expectPolicyThrows(() => consumeOwnerMagnificUpscaleOneShotPermit({
    permit: expiredPermit, candidate: expiring.candidate, principal: PRINCIPAL, attemptId: ATTEMPT
  }), "PERMIT_EXPIRED");
  expiryClock -= 1;
  expectPolicyThrows(() => consumeOwnerMagnificUpscaleOneShotPermit({
    permit: expiredPermit, candidate: expiring.candidate, principal: PRINCIPAL, attemptId: ATTEMPT
  }), "PERMIT_EXPIRED");
});

test("issuer rejects unknown, getter, symbol, proxy and wrong-attempt inputs without reserving candidate", async () => {
  const { candidate } = await makeCandidate("creative");
  for (const input of [
    { candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog, extra: true },
    new Proxy({ candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog }, {}),
    { candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog, [Symbol("extra")]: true }
  ]) {
    expectPolicyThrows(() => createOwnerMagnificUpscaleOneShotPermit(input), "INVALID_REQUEST");
  }
  let getterCalls = 0;
  const accessor: Record<string, unknown> = { candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog };
  Object.defineProperty(accessor, "now", { enumerable: true, get() { getterCalls += 1; return () => NOW; } });
  expectPolicyThrows(() => createOwnerMagnificUpscaleOneShotPermit(accessor), "INVALID_REQUEST");
  assert.equal(getterCalls, 0);
  expectPolicyThrows(() => createOwnerMagnificUpscaleOneShotPermit({
    candidate, principal: PRINCIPAL, attemptId: `${ATTEMPT}-foreign`, catalog, now: () => NOW
  }), "PRINCIPAL_MISMATCH");
  const permit = createOwnerMagnificUpscaleOneShotPermit({ candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog, now: () => NOW });
  assert.equal(permit.status, "authorized");
});

test("consumption is atomic once and dispatch metadata remains non-permission", async () => {
  const { candidate } = await makeCandidate("creative");
  const permit = createOwnerMagnificUpscaleOneShotPermit({ candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog, now: () => NOW });
  assert.equal(permit.dispatch_allowed, false);
  assert.deepEqual(consumeOwnerMagnificUpscaleOneShotPermit({ permit, candidate, principal: PRINCIPAL, attemptId: ATTEMPT }), {
    status: "consumed", dispatch_allowed: false, request_fingerprint: candidate.request_fingerprint
  });
  expectPolicyThrows(() => consumeOwnerMagnificUpscaleOneShotPermit({ permit, candidate, principal: PRINCIPAL, attemptId: ATTEMPT }),
    "PERMIT_ALREADY_CONSUMED");
});
