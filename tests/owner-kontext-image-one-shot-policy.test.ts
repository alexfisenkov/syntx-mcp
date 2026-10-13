import assert from "node:assert/strict";
import test from "node:test";
import {
  createOwnerKontextImageOwnedReferenceBindingIssuer,
  getOwnerKontextImageSourceProfile,
  prepareOwnerKontextImageRequest,
  type OwnerKontextImageOwnedReferenceResolverContext
} from "../src/application/owner-kontext-image-request-preparer.js";
import type { OwnerKontextImageVariant } from "../src/application/owner-kontext-image-parameters.js";
import {
  DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
  loadSelectedDiscoveryCatalog
} from "../src/catalog/selected-discovery-catalog.js";
import {
  consumeOwnerKontextImageOneShotPermit,
  createOwnerKontextImageOneShotPermit,
  OwnerKontextImageOneShotPolicyError
} from "../src/application/owner-kontext-image-one-shot-policy.js";

const ATTEMPT = "link_test_0123456789abcdef";
const PRINCIPAL = Object.freeze({ tenant_id: "tenant_test", subject_id: "subject_test", connection_id: ATTEMPT });
const NOW = Date.parse("2026-10-10T00:00:00.000Z");
const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const catalog = loadSelectedDiscoveryCatalog(CATALOG_VERSION).discoveryCatalog;

function resolved(context: OwnerKontextImageOwnedReferenceResolverContext, index: number) {
  return {
    ...context,
    file_url: `https://r2.syntx.ai/private/kontext/${index + 1}.png`,
    mime_type: "image/png",
    width: 1200 + index,
    height: 800 + index,
    size: 1_024 + index,
    sha256: `sha256:${String(index + 1).repeat(64)}`,
    expires_at: NOW + 600_000 - index * 60_000,
    metadata_confidence: "CONTAINER_METADATA_ONLY"
  };
}

async function makeCandidate(variant: OwnerKontextImageVariant, references: number, now = NOW) {
  const issuer = createOwnerKontextImageOwnedReferenceBindingIssuer(async (context) => resolved(context,
    Number(context.reference_handle.slice(-1))), { catalog, catalog_version: CATALOG_VERSION, now: () => now });
  const handles = Array.from({ length: references }, (_, index) =>
    `kontext_image_00000000-0000-4000-8000-00000000000${index + 1}`);
  const reference_set = await issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant, reference_handles: handles });
  const candidate = prepareOwnerKontextImageRequest({
    principal: PRINCIPAL, attempt_id: ATTEMPT, variant,
    parameters: { resolution: "1024x1024", cfg: 2.7, steps: 17.5, image_strength: 0.43 },
    reference_set, workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA", prompt: "  preserve this prompt  "
  }, { catalog, catalog_version: CATALOG_VERSION, now: () => now });
  return { candidate, issuer };
}

function expectPolicyError(callback: () => unknown, code: string): void {
  assert.throws(callback, (error: unknown) => error instanceof OwnerKontextImageOneShotPolicyError && error.code === code);
}

test("issues and consumes one nominal exact-source permit for each real prepared variant", async () => {
  for (const [variant, referenceCount] of [
    ["flux-kontext-pro", 0], ["flux-kontext-max", 0], ["flux-kontext-multi", 4]
  ] as const) {
    const { candidate, issuer } = await makeCandidate(variant, referenceCount);
    assert.equal(candidate.source_readiness, "SOURCE_JOINED_PROMPT_POLICY");
    assert.equal(candidate.dispatch_allowed, false);
    assert.equal(candidate.backend_acceptance, "UNPROVEN");
    assert.equal(candidate.request.prompt, "  preserve this prompt  ");
    assert.equal(candidate.request.settings.model_type, variant);
    assert.equal(candidate.input_images.length, referenceCount);
    assert.ok(Object.isFrozen(candidate.input_images));
    assert.ok(candidate.input_images.every(Object.isFrozen));
    assert.ok(candidate.input_images.every((image) => Object.keys(image).sort().join(",") ===
      "height,metadata_confidence,mime_type,sha256,size,width"));
    assert.equal(JSON.stringify(candidate.input_images).includes("r2.syntx.ai"), false);
    assert.equal(JSON.stringify(candidate.input_images).includes("reference_handle"), false);
    const permit = createOwnerKontextImageOneShotPermit({
      candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog, catalog_version: CATALOG_VERSION, now: () => NOW
    });
    assert.ok(Object.isFrozen(permit));
    assert.equal(permit.dispatch_allowed, false);
    assert.equal(permit.variant, variant);
    assert.equal(permit.model_id, variant);
    assert.equal(permit.ai_name, "flux");
    assert.equal(permit.request_fingerprint, candidate.request_fingerprint);
    assert.equal(permit.expires_at, candidate.expires_at);
    assert.deepEqual(consumeOwnerKontextImageOneShotPermit({ permit, candidate, principal: PRINCIPAL, attemptId: ATTEMPT }), {
      status: "consumed", dispatch_allowed: false, request_fingerprint: candidate.request_fingerprint
    });
    expectPolicyError(() => consumeOwnerKontextImageOneShotPermit({ permit, candidate, principal: PRINCIPAL, attemptId: ATTEMPT }),
      "PERMIT_ALREADY_CONSUMED");
    issuer.close();
  }
});

test("does not reissue or structurally counterfeit candidate-bound permits", async () => {
  const { candidate, issuer } = await makeCandidate("flux-kontext-pro", 0);
  const input = { candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog, catalog_version: CATALOG_VERSION, now: () => NOW };
  const permit = createOwnerKontextImageOneShotPermit(input);
  expectPolicyError(() => createOwnerKontextImageOneShotPermit(input), "CANDIDATE_ALREADY_ISSUED");
  expectPolicyError(() => consumeOwnerKontextImageOneShotPermit({
    permit: { ...permit }, candidate, principal: PRINCIPAL, attemptId: ATTEMPT
  }), "PERMIT_INVALID");
  issuer.close();
});

test("preserves the candidate's original expiry and attempt invalidation", async () => {
  let clock = NOW;
  const { candidate, issuer } = await makeCandidate("flux-kontext-pro", 0, NOW);
  const permit = createOwnerKontextImageOneShotPermit({
    candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog, catalog_version: CATALOG_VERSION, now: () => clock
  });
  clock = candidate.expires_at;
  expectPolicyError(() => consumeOwnerKontextImageOneShotPermit({ permit, candidate, principal: PRINCIPAL, attemptId: ATTEMPT }),
    "PERMIT_EXPIRED");
  issuer.invalidateAttempt(ATTEMPT);
  issuer.close();
});

test("rejects the wrong principal and wrong attempt before permit consumption", async () => {
  const { candidate, issuer } = await makeCandidate("flux-kontext-max", 0);
  const permit = createOwnerKontextImageOneShotPermit({
    candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog, catalog_version: CATALOG_VERSION, now: () => NOW
  });
  expectPolicyError(() => consumeOwnerKontextImageOneShotPermit({
    permit, candidate, principal: { ...PRINCIPAL, subject_id: "other" }, attemptId: ATTEMPT
  }), "PRINCIPAL_MISMATCH");
  expectPolicyError(() => consumeOwnerKontextImageOneShotPermit({
    permit, candidate, principal: PRINCIPAL, attemptId: `${ATTEMPT}x`
  }), "PRINCIPAL_MISMATCH");
  assert.equal(consumeOwnerKontextImageOneShotPermit({ permit, candidate, principal: PRINCIPAL, attemptId: ATTEMPT }).status,
    "consumed");
  issuer.close();
});

test("does not let a permit for one variant authorize a different nominal candidate", async () => {
  const first = await makeCandidate("flux-kontext-pro", 0);
  const second = await makeCandidate("flux-kontext-max", 0);
  const permit = createOwnerKontextImageOneShotPermit({
    candidate: first.candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog, catalog_version: CATALOG_VERSION, now: () => NOW
  });
  expectPolicyError(() => consumeOwnerKontextImageOneShotPermit({
    permit, candidate: second.candidate, principal: PRINCIPAL, attemptId: ATTEMPT
  }), "CANDIDATE_MISMATCH");
  assert.equal(consumeOwnerKontextImageOneShotPermit({
    permit, candidate: first.candidate, principal: PRINCIPAL, attemptId: ATTEMPT
  }).status, "consumed");
  first.issuer.close();
  second.issuer.close();
});

test("uses the exact selected source profile for the same variant", async () => {
  const { candidate, issuer } = await makeCandidate("flux-kontext-multi", 1);
  assert.equal(candidate.profile_schema_hash, getOwnerKontextImageSourceProfile(
    "flux-kontext-multi", catalog, CATALOG_VERSION
  ).profile_schema_hash);
  expectPolicyError(() => createOwnerKontextImageOneShotPermit({
    candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog,
    catalog_version: "sha256-c6fdcc522def8f6f4ef2c172d23822164f0124b29bb5fe86e2b5dce5c54b9fbc.json", now: () => NOW
  }), "CATALOG_BINDING_MISMATCH");
  assert.doesNotThrow(() => createOwnerKontextImageOneShotPermit({
    candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog, catalog_version: CATALOG_VERSION, now: () => NOW
  }), "failed issuance does not reserve a candidate");
  issuer.close();
});
