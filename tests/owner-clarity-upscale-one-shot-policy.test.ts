import assert from "node:assert/strict";
import test from "node:test";
import { loadSelectedDiscoveryCatalog, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import {
  createOwnerClarityUpscaleOwnedImageBindingIssuer,
  prepareOwnerClarityUpscaleRequest,
  isOwnerClarityUpscalePreparedCandidateForPrincipal
} from "../src/application/owner-clarity-upscale-request-preparer.js";
import type { GenerationPrincipalRef } from "../src/domain/generation-operation.js";

const ATTEMPT = "link_owner_clarity_policy_attempt_000001";
const PRINCIPAL: Readonly<GenerationPrincipalRef> = Object.freeze({
  tenant_id: "owner-clarity-tenant", subject_id: "owner-clarity-subject", connection_id: ATTEMPT
});
const IMAGE = Object.freeze({
  principal: PRINCIPAL, attempt_id: ATTEMPT, scope: "tool_image_upscaler", model_id: "clarity",
  file_url: "https://r2.syntx.ai/private/clarity-policy-input?sig=synthetic", mime_type: "image/png",
  width: 2000, height: 1000
});
const policyUrl = new URL("../src/application/owner-clarity-upscale-one-shot-policy.js", import.meta.url).href;

async function loadPolicy(): Promise<Record<string, any> | null> {
  try { return await import(policyUrl) as Record<string, any>; }
  catch { return null; }
}

async function candidate(prompt = "clean edges") {
  const issuer = createOwnerClarityUpscaleOwnedImageBindingIssuer(async () => IMAGE);
  const imageBinding = await issuer.issue({
    principal: PRINCIPAL, attempt_id: ATTEMPT, opaque_image_handle: "synthetic-owned-image-001"
  });
  return prepareOwnerClarityUpscaleRequest({
    principal: PRINCIPAL, attempt_id: ATTEMPT, prompt,
    parameters: { professional_mode: false, scale_factor: 2, strength: 0.85, cfg: 6, denoise: 0.2 },
    image_binding: imageBinding
  });
}

function selectedCatalog() {
  return loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
}

function expectPolicyError(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && (error as { code?: unknown }).code === code &&
    !String(error).includes(IMAGE.file_url);
}

function expectPolicyThrows(callback: () => unknown, code: string): void {
  assert.throws(callback, (error: unknown) => expectPolicyError(error, code));
}

test("one-shot permit binds genuine candidate, exact principal/catalog and consumes once", async () => {
  const module = await loadPolicy();
  assert.ok(module?.createOwnerClarityUpscaleOneShotPermit, "Clarity one-shot policy must exist");
  const catalog = selectedCatalog();
  const prepared = await candidate();
  assert.equal(isOwnerClarityUpscalePreparedCandidateForPrincipal(prepared, PRINCIPAL, ATTEMPT), true);
  let now = 50_000;
  const permit = module.createOwnerClarityUpscaleOneShotPermit({
    candidate: prepared, principal: PRINCIPAL, attemptId: ATTEMPT, catalog, now: () => now
  });
  assert.equal(Object.isFrozen(permit), true);
  assert.equal(permit.status, "authorized");
  assert.equal(permit.dispatch_allowed, false);
  assert.equal(permit.expires_at, 950_000);
  assert.equal(permit.catalog_version, `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`);
  assert.equal(JSON.stringify(permit).includes(IMAGE.file_url), false);

  expectPolicyThrows(() => module.consumeOwnerClarityUpscaleOneShotPermit({
    permit: { ...permit }, candidate: prepared, principal: PRINCIPAL, attemptId: ATTEMPT
  }), "PERMIT_INVALID");
  expectPolicyThrows(() => module.consumeOwnerClarityUpscaleOneShotPermit({
    permit, candidate: prepared, principal: { ...PRINCIPAL, subject_id: "foreign" }, attemptId: ATTEMPT
  }), "PRINCIPAL_MISMATCH");
  const changedCandidate = await candidate("different request");
  expectPolicyThrows(() => module.consumeOwnerClarityUpscaleOneShotPermit({
    permit, candidate: changedCandidate, principal: PRINCIPAL, attemptId: ATTEMPT
  }), "CANDIDATE_MISMATCH");

  const receipt = module.consumeOwnerClarityUpscaleOneShotPermit({
    permit, candidate: prepared, principal: PRINCIPAL, attemptId: ATTEMPT
  });
  assert.equal(receipt.status, "consumed");
  assert.equal(receipt.dispatch_allowed, false);
  expectPolicyThrows(() => module.consumeOwnerClarityUpscaleOneShotPermit({
    permit, candidate: prepared, principal: PRINCIPAL, attemptId: ATTEMPT
  }), "PERMIT_ALREADY_CONSUMED");
});

test("candidate clones, foreign attempts, wrong public catalog epoch and inactive model cannot mint permits", async () => {
  const module = await loadPolicy();
  assert.ok(module?.createOwnerClarityUpscaleOneShotPermit, "Clarity one-shot policy must exist");
  const prepared = await candidate();
  const catalog = selectedCatalog();
  expectPolicyThrows(() => module.createOwnerClarityUpscaleOneShotPermit({
    candidate: { ...prepared }, principal: PRINCIPAL, attemptId: ATTEMPT, catalog
  }), "CANDIDATE_UNBOUND");
  expectPolicyThrows(() => module.createOwnerClarityUpscaleOneShotPermit({
    candidate: prepared, principal: { ...PRINCIPAL, connection_id: `${ATTEMPT}-foreign` }, attemptId: `${ATTEMPT}-foreign`, catalog
  }), "CANDIDATE_UNBOUND");

  const inactiveCatalog = Object.create(Object.getPrototypeOf(catalog));
  Object.defineProperties(inactiveCatalog, {
    catalog_kind: { value: catalog.catalog_kind, enumerable: true },
    runtime_usable: { value: catalog.runtime_usable, enumerable: true },
    fetched_at: { value: catalog.fetched_at, enumerable: true },
    source_hashes: { value: catalog.source_hashes, enumerable: true },
    getModel: { value(modelId: string) { return { ...catalog.getModel(modelId), active: false }; } }
  });
  expectPolicyThrows(() => module.createOwnerClarityUpscaleOneShotPermit({
    candidate: prepared, principal: PRINCIPAL, attemptId: ATTEMPT, catalog: inactiveCatalog
  }), "CATALOG_BINDING_MISMATCH");
});

test("permit expires after fifteen minutes and a backward clock permanently closes it", async () => {
  const module = await loadPolicy();
  assert.ok(module?.createOwnerClarityUpscaleOneShotPermit, "Clarity one-shot policy must exist");
  const prepared = await candidate();
  const catalog = selectedCatalog();
  let now = 1_000;
  const expired = module.createOwnerClarityUpscaleOneShotPermit({
    candidate: prepared, principal: PRINCIPAL, attemptId: ATTEMPT, catalog, now: () => now
  });
  now += 900_000;
  expectPolicyThrows(() => module.consumeOwnerClarityUpscaleOneShotPermit({
    permit: expired, candidate: prepared, principal: PRINCIPAL, attemptId: ATTEMPT
  }), "PERMIT_EXPIRED");

  now = 20_000;
  const rollback = module.createOwnerClarityUpscaleOneShotPermit({
    candidate: prepared, principal: PRINCIPAL, attemptId: ATTEMPT, catalog, now: () => now
  });
  now -= 1;
  expectPolicyThrows(() => module.consumeOwnerClarityUpscaleOneShotPermit({
    permit: rollback, candidate: prepared, principal: PRINCIPAL, attemptId: ATTEMPT
  }), "CLOCK_INVALID");
  now += 2;
  expectPolicyThrows(() => module.consumeOwnerClarityUpscaleOneShotPermit({
    permit: rollback, candidate: prepared, principal: PRINCIPAL, attemptId: ATTEMPT
  }), "PERMIT_EXPIRED");
});
