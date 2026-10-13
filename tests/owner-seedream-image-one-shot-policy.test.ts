import assert from "node:assert/strict";
import test from "node:test";
import { createOwnerSeedreamImageOwnedReferenceBindingIssuer, prepareOwnerSeedreamImageRequest } from "../src/application/owner-seedream-image-request-preparer.js";
import { createOwnerSeedreamImageOneShotPermit, consumeOwnerSeedreamImageOneShotPermit } from "../src/application/owner-seedream-image-one-shot-policy.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const catalog = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const BASE = Date.parse("2026-10-11T00:00:00.000Z");
const principal = Object.freeze({ tenant_id: "tenant_seedream", subject_id: "owner_test", connection_id: "link_seedream_test_0123456789" });
let clock = BASE;

async function makeCandidate() {
  const issuer = createOwnerSeedreamImageOwnedReferenceBindingIssuer(async () => { throw new Error("not called for zero refs"); },
    { catalog, catalog_version: VERSION, now: () => clock });
  const referenceSet = await issuer.issue({ principal, attempt_id: principal.connection_id, variant: "seedream-5.0-pro", reference_handles: [] });
  const candidate = prepareOwnerSeedreamImageRequest({ principal, attempt_id: principal.connection_id, variant: "seedream-5.0-pro",
    parameters: { aspect_ratio: "1:1", resolution: "2K", output_format: null, background: null }, reference_set: referenceSet, prompt: "once" },
  { catalog, catalog_version: VERSION, now: () => clock });
  return { issuer, candidate };
}

test("nominal Seedream permit is bound to one candidate and consumes once", async () => {
  clock = BASE;
  const { issuer, candidate } = await makeCandidate();
  const permit = createOwnerSeedreamImageOneShotPermit({ candidate, principal, attemptId: principal.connection_id,
    catalog, catalog_version: VERSION, now: () => clock });
  assert.equal(permit.dispatch_allowed, false);
  assert.equal(consumeOwnerSeedreamImageOneShotPermit({ permit, candidate, principal, attemptId: principal.connection_id }).status, "consumed");
  assert.throws(() => consumeOwnerSeedreamImageOneShotPermit({ permit, candidate, principal, attemptId: principal.connection_id }),
    (error: unknown) => (error as { code?: string }).code === "PERMIT_ALREADY_CONSUMED");
  issuer.close();
});

test("candidate clone, proxy, foreign principal, issuer revocation, expiry, and rollback cannot consume", async () => {
  clock = BASE;
  const first = await makeCandidate();
  const candidateClone = Object.freeze({ ...first.candidate });
  assert.throws(() => createOwnerSeedreamImageOneShotPermit({ candidate: candidateClone, principal, attemptId: principal.connection_id,
    catalog, catalog_version: VERSION, now: () => clock }), { code: "CANDIDATE_UNBOUND" });
  const permit = createOwnerSeedreamImageOneShotPermit({ candidate: first.candidate, principal, attemptId: principal.connection_id,
    catalog, catalog_version: VERSION, now: () => clock });
  assert.throws(() => consumeOwnerSeedreamImageOneShotPermit({ permit, candidate: new Proxy(first.candidate, {}), principal,
    attemptId: principal.connection_id }), { code: "CANDIDATE_MISMATCH" });
  const other = Object.freeze({ ...principal, connection_id: "link_seedream_other_0123456789" });
  assert.throws(() => consumeOwnerSeedreamImageOneShotPermit({ permit, candidate: first.candidate, principal: other, attemptId: other.connection_id }),
    { code: "PRINCIPAL_MISMATCH" });
  first.issuer.invalidateAttempt(principal.connection_id);
  assert.throws(() => consumeOwnerSeedreamImageOneShotPermit({ permit, candidate: first.candidate, principal, attemptId: principal.connection_id }));
  first.issuer.close();

  clock = BASE;
  const closed = await makeCandidate();
  const closePermit = createOwnerSeedreamImageOneShotPermit({ candidate: closed.candidate, principal, attemptId: principal.connection_id,
    catalog, catalog_version: VERSION, now: () => clock });
  closed.issuer.close();
  assert.throws(() => consumeOwnerSeedreamImageOneShotPermit({ permit: closePermit, candidate: closed.candidate,
    principal, attemptId: principal.connection_id }));

  clock = BASE;
  const expiring = await makeCandidate();
  const shortPermit = createOwnerSeedreamImageOneShotPermit({ candidate: expiring.candidate, principal, attemptId: principal.connection_id,
    catalog, catalog_version: VERSION, now: () => clock });
  clock = BASE + 15 * 60_000;
  assert.throws(() => consumeOwnerSeedreamImageOneShotPermit({ permit: shortPermit, candidate: expiring.candidate,
    principal, attemptId: principal.connection_id }), { code: "PERMIT_EXPIRED" });
  expiring.issuer.close();

  clock = BASE;
  const regressed = await makeCandidate();
  const rollbackPermit = createOwnerSeedreamImageOneShotPermit({ candidate: regressed.candidate, principal, attemptId: principal.connection_id,
    catalog, catalog_version: VERSION, now: () => clock });
  clock = BASE - 1;
  assert.throws(() => consumeOwnerSeedreamImageOneShotPermit({ permit: rollbackPermit, candidate: regressed.candidate,
    principal, attemptId: principal.connection_id }), { code: "CLOCK_INVALID" });
  regressed.issuer.close();
});
