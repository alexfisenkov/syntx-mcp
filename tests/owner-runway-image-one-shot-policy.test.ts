import assert from "node:assert/strict";
import test from "node:test";
import { createOwnerRunwayImageOwnedReferenceBindingIssuer, prepareOwnerRunwayImageRequest } from "../src/application/owner-runway-image-request-preparer.js";
import { createOwnerRunwayImageOneShotPermit, consumeOwnerRunwayImageOneShotPermit } from "../src/application/owner-runway-image-one-shot-policy.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const catalog = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const BASE = Date.parse("2026-10-10T00:00:00.000Z");
const principal = Object.freeze({ tenant_id: "tenant_test", subject_id: "subject_test", connection_id: "link_test_0123456789abcdef" });
const handle = "runway_image_00000000-0000-4000-8000-000000000001";
let clock = BASE;
async function candidate() {
  const issuer = createOwnerRunwayImageOwnedReferenceBindingIssuer(async (c) => ({ ...c, file_url: "https://r2.syntx.ai/private/runway/a.png",
    mime_type: "image/png", width: 400, height: 300, size: 90, sha256: `sha256:${"1".repeat(64)}`, expires_at: BASE + 600_000,
    metadata_confidence: "CONTAINER_METADATA_ONLY" }), { catalog, catalog_version: VERSION, now: () => clock });
  const set = await issuer.issue({ principal, attempt_id: principal.connection_id, variant: "runway_frames", reference_handles: [handle] });
  return { issuer, value: prepareOwnerRunwayImageRequest({ principal, attempt_id: principal.connection_id, variant: "runway_frames",
    parameters: { resolution: "1088x1920", temperature: 3.125 }, reference_set: set, prompt: "literal once" }, { catalog, catalog_version: VERSION, now: () => clock }) };
}

test("a nominal permit binds the exact candidate and consumes exactly once", async () => {
  clock = BASE; const { issuer, value } = await candidate();
  const permit = createOwnerRunwayImageOneShotPermit({ candidate: value, principal, attemptId: principal.connection_id, catalog, catalog_version: VERSION, now: () => clock });
  assert.equal(permit.dispatch_allowed, false);
  assert.equal(consumeOwnerRunwayImageOneShotPermit({ permit, candidate: value, principal, attemptId: principal.connection_id }).status, "consumed");
  assert.throws(() => consumeOwnerRunwayImageOneShotPermit({ permit, candidate: value, principal, attemptId: principal.connection_id }),
    (error: unknown) => (error as { code?: string }).code === "PERMIT_ALREADY_CONSUMED");
  issuer.close();
});

test("principal, candidate clone, expiration, and backward clock cannot consume a permit", async () => {
  clock = BASE; const { issuer, value } = await candidate();
  const permit = createOwnerRunwayImageOneShotPermit({ candidate: value, principal, attemptId: principal.connection_id, catalog, catalog_version: VERSION, now: () => clock });
  const other = Object.freeze({ ...principal, connection_id: "link_other_0123456789abcdef" });
  assert.throws(() => consumeOwnerRunwayImageOneShotPermit({ permit, candidate: value, principal: other, attemptId: other.connection_id }));
  assert.throws(() => consumeOwnerRunwayImageOneShotPermit({ permit, candidate: Object.freeze({ ...value }), principal, attemptId: principal.connection_id }));
  clock = BASE - 1;
  assert.throws(() => consumeOwnerRunwayImageOneShotPermit({ permit, candidate: value, principal, attemptId: principal.connection_id }));
  issuer.close();

  clock = BASE; const second = await candidate();
  const expiring = createOwnerRunwayImageOneShotPermit({ candidate: second.value, principal, attemptId: principal.connection_id, catalog, catalog_version: VERSION, now: () => clock });
  clock = BASE + 15 * 60_000;
  assert.throws(() => consumeOwnerRunwayImageOneShotPermit({ permit: expiring, candidate: second.value, principal, attemptId: principal.connection_id }));
  second.issuer.close();
});

test("issuer invalidation revokes an already issued permit before consumption", async () => {
  clock = BASE; const { issuer, value } = await candidate();
  const permit = createOwnerRunwayImageOneShotPermit({ candidate: value, principal, attemptId: principal.connection_id, catalog, catalog_version: VERSION, now: () => clock });
  issuer.invalidateAttempt(principal.connection_id);
  assert.throws(() => consumeOwnerRunwayImageOneShotPermit({ permit, candidate: value, principal, attemptId: principal.connection_id }));
  issuer.close();
});
