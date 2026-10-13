import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthBinding } from "../src/auth/types.js";
import { loadSelectedDiscoveryCatalog, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import { OwnerWanT2iRequestPreparer } from "../src/application/owner-wan-t2i-request-preparer.js";

const POLICY_MODULE_URL = new URL("../src/application/owner-wan-t2i-one-shot-policy.js", import.meta.url).href;
const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG_ROOT = join(process.cwd(), "catalog");
const CATALOG = loadSelectedDiscoveryCatalog(CATALOG_VERSION, CATALOG_ROOT).discoveryCatalog;
const BINDING: AuthBinding = Object.freeze({ tenant_id: "wan-t2i-one-shot-tenant", subject: "wan-t2i-one-shot-subject" });
const ATTEMPT = "link_wan_t2i_oneshot_policy_000000000001";
const SECOND_ATTEMPT = "link_wan_t2i_oneshot_policy_000000000002";

function principal(attemptId = ATTEMPT, overrides: Record<string, string> = {}) {
  return Object.freeze({ tenant_id: overrides.tenant_id ?? BINDING.tenant_id,
    subject_id: overrides.subject_id ?? BINDING.subject, connection_id: attemptId });
}

function createLinkService() {
  return new PerUserLinkService({} as never, { async getSnapshot(_binding: unknown, attemptId: string) {
    return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
      status: "LINKED" as const, expires_at: null, linked: true };
  }, async revoke(_binding: unknown, attemptId: string) {
    return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
      status: "REVOKED" as const, expires_at: null, linked: false };
  } } as never);
}

test("creates and consumes one nominal permit from an actual 841 candidate without granting dispatch", async () => {
  let clock = 1_000_000;
  const preparer = new OwnerWanT2iRequestPreparer({ binding: BINDING, linkService: createLinkService(),
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => clock });
  try {
    const candidate = await preparer.prepare({ attemptId: ATTEMPT, principal: principal(), input: {
      model_id: "wan_25_t2i_preview", prompt: "A red kite over a quiet beach",
      parameters: { aspect_ratio: "1:1", resolution: "720P", batch_size: 1, prompt_extend: false,
        seed: null, color_palette: null, bbox_list: [] }
    } });
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, { attemptId: ATTEMPT, principal: principal() }), true);

    let policyModule: Record<string, unknown> | null = null;
    try { policyModule = await import(POLICY_MODULE_URL) as Record<string, unknown>; }
    catch { /* Expected RED until the one-shot policy exists. */ }
    assert.equal(typeof policyModule?.createOwnerWanT2iOneShotPermit, "function", "MISSING_OWNER_WAN_T2I_ONESHOT_POLICY");
    assert.equal(typeof policyModule?.consumeOwnerWanT2iOneShotPermit, "function", "MISSING_OWNER_WAN_T2I_ONESHOT_POLICY_CONSUMER");

    const createPermit = policyModule!.createOwnerWanT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
    const consumePermit = policyModule!.consumeOwnerWanT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
    const PolicyError = policyModule!.OwnerWanT2iOneShotPolicyError as new (...args: never[]) => Error & { code: string };
    const permit = createPermit({ preparer, candidate, principal: principal(), attemptId: ATTEMPT,
      catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => clock });
    assert.equal(permit.dispatch_allowed, false);
    assert.equal(permit.backend_acceptance, "UNPROVEN");
    assert.equal(permit.provider_execution, false);
    assert.deepEqual(permit.cost_routing, { ai_name: "wan_image", model_type: "wan_25_t2i_preview" });
    assert.deepEqual(permit.cost_inputs, { batch_size: 1 });
    assert.equal(Object.hasOwn(permit, "request"), false);
    assert.equal(Object.isFrozen(permit), true);
    assert.equal(Object.isFrozen(permit.cost_routing), true);
    assert.equal(Object.isFrozen(permit.cost_inputs), true);
    const forgedClone = { ...permit };
    assert.throws(() => consumePermit({ permit: forgedClone, candidate, principal: principal(), attemptId: ATTEMPT }),
      (error: unknown) => error instanceof PolicyError && error.code === "PERMIT_INVALID");

    const receipt = consumePermit({ permit, candidate, principal: principal(), attemptId: ATTEMPT });
    assert.deepEqual(receipt, { status: "consumed", dispatch_allowed: false,
      request_fingerprint: candidate.request_fingerprint });
    assert.throws(() => consumePermit({ permit, candidate, principal: principal(), attemptId: ATTEMPT }),
      (error: unknown) => error instanceof PolicyError && error.code === "PERMIT_ALREADY_CONSUMED");
  } finally { await preparer.close(); }
});

test("issues and consumes against actual 841 candidates for both models and all 80 source states", async () => {
  const policyModule = await import(POLICY_MODULE_URL) as Record<string, unknown>;
  const createPermit = policyModule.createOwnerWanT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const consumePermit = policyModule.consumeOwnerWanT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  let clock = 2_000_000;
  const preparer = new OwnerWanT2iRequestPreparer({ binding: BINDING, linkService: createLinkService(),
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => clock });
  const models = ["wan_25_t2i_preview", "wan_26_t2i"] as const;
  const ratios = ["1:1", "3:4", "4:3", "9:16", "16:9"] as const;
  const resolutions = ["720P", "1080P"] as const;
  let caseNumber = 0;
  try {
    for (const model_id of models) for (const aspect_ratio of ratios) for (const resolution of resolutions) {
      for (const batch_size of [1, 2, 3, 4] as const) {
        const request = { model_id, prompt: `WAN T2I prompt ${caseNumber}`, parameters: { aspect_ratio, resolution,
          batch_size, prompt_extend: caseNumber % 2 === 1, seed: batch_size === 4 ? 2_147_483_647 : null,
          color_palette: null, bbox_list: [] } };
        const candidate = await preparer.prepare({ attemptId: ATTEMPT, principal: principal(), input: request });
        const permit = createPermit({ preparer, candidate, principal: principal(), attemptId: ATTEMPT,
          catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => clock });
        assert.equal(permit.model_id, model_id);
        assert.equal(permit.model_type, model_id);
        assert.deepEqual(permit.cost_inputs, { batch_size });
        assert.equal(Object.hasOwn(permit, "size"), false);
        assert.equal(Object.hasOwn(permit, "prompt"), false);
        assert.equal(permit.dispatch_allowed, false);
        assert.equal(permit.backend_acceptance, "UNPROVEN");
        const receipt = consumePermit({ permit, candidate, principal: principal(), attemptId: ATTEMPT });
        assert.equal(receipt.status, "consumed");
        assert.equal(receipt.dispatch_allowed, false);
        assert.equal(receipt.request_fingerprint, candidate.request_fingerprint);
        caseNumber += 1;
      }
    }
    assert.equal(caseNumber, 80);
  } finally { await preparer.close(); }
});

test("binds permits to the exact issuer, candidate, principal and one issuance", async () => {
  const policyModule = await import(POLICY_MODULE_URL) as Record<string, unknown>;
  const createPermit = policyModule.createOwnerWanT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const consumePermit = policyModule.consumeOwnerWanT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const PolicyError = policyModule.OwnerWanT2iOneShotPolicyError as new (...args: never[]) => Error & { code: string };
  const expectCode = (code: string) => (error: unknown) => error instanceof PolicyError && error.code === code;
  const clock = () => 3_000_000;
  const firstPreparer = new OwnerWanT2iRequestPreparer({ binding: BINDING, linkService: createLinkService(),
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now: clock });
  const secondPreparer = new OwnerWanT2iRequestPreparer({ binding: BINDING, linkService: createLinkService(),
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now: clock });
  try {
    const request = { model_id: "wan_26_t2i", prompt: "A blue paper lantern", parameters: {
      aspect_ratio: "3:4", resolution: "1080P", batch_size: 4, prompt_extend: true,
      seed: 0, color_palette: null, bbox_list: []
    } };
    const candidate = await firstPreparer.prepare({ attemptId: ATTEMPT, principal: principal(), input: request });
    const foreignCandidate = await secondPreparer.prepare({ attemptId: ATTEMPT, principal: principal(), input: request });
    const otherAttemptCandidate = await firstPreparer.prepare({ attemptId: SECOND_ATTEMPT,
      principal: principal(SECOND_ATTEMPT), input: request });
    const permit = createPermit({ preparer: firstPreparer, candidate, principal: principal(), attemptId: ATTEMPT,
      catalog: CATALOG, catalog_version: CATALOG_VERSION, now: clock });
    const foreignPermit = createPermit({ preparer: secondPreparer, candidate: foreignCandidate,
      principal: principal(), attemptId: ATTEMPT, catalog: CATALOG, catalog_version: CATALOG_VERSION, now: clock });
    const otherAttemptPermit = createPermit({ preparer: firstPreparer, candidate: otherAttemptCandidate,
      principal: principal(SECOND_ATTEMPT), attemptId: SECOND_ATTEMPT, catalog: CATALOG, catalog_version: CATALOG_VERSION, now: clock });

    assert.equal(candidate.intent_fingerprint, foreignCandidate.intent_fingerprint);
    assert.notEqual(candidate.request_fingerprint, foreignCandidate.request_fingerprint,
      "same semantic input receives a fresh request nonce per actual candidate");
    assert.notEqual(permit.candidate_fingerprint, foreignPermit.candidate_fingerprint);

    assert.throws(() => createPermit({ preparer: firstPreparer, candidate, principal: principal(), attemptId: ATTEMPT,
      catalog: CATALOG, catalog_version: CATALOG_VERSION, now: clock }), expectCode("CANDIDATE_ALREADY_ISSUED"));
    assert.throws(() => createPermit({ preparer: secondPreparer, candidate, principal: principal(), attemptId: ATTEMPT,
      catalog: CATALOG, catalog_version: CATALOG_VERSION, now: clock }), expectCode("CANDIDATE_UNBOUND"));
    assert.throws(() => consumePermit({ permit, candidate: structuredClone(candidate), principal: principal(), attemptId: ATTEMPT }),
      expectCode("CANDIDATE_MISMATCH"));
    assert.throws(() => consumePermit({ permit, candidate: foreignCandidate, principal: principal(), attemptId: ATTEMPT }),
      expectCode("CANDIDATE_MISMATCH"));
    assert.throws(() => consumePermit({ permit, candidate, principal: principal(ATTEMPT, { subject_id: "other-subject" }), attemptId: ATTEMPT }),
      expectCode("PRINCIPAL_MISMATCH"));
    assert.throws(() => consumePermit({ permit: otherAttemptPermit, candidate: otherAttemptCandidate,
      principal: principal(), attemptId: ATTEMPT }), expectCode("PRINCIPAL_MISMATCH"));
    assert.equal(consumePermit({ permit, candidate, principal: principal(), attemptId: ATTEMPT }).status, "consumed");
  } finally {
    await firstPreparer.close();
    await secondPreparer.close();
  }
});

test("bounds permit expiry by original candidate TTL and invalidates on clock rollback", async () => {
  const policyModule = await import(POLICY_MODULE_URL) as Record<string, unknown>;
  const createPermit = policyModule.createOwnerWanT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const consumePermit = policyModule.consumeOwnerWanT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const PolicyError = policyModule.OwnerWanT2iOneShotPolicyError as new (...args: never[]) => Error & { code: string };
  const expectCode = (code: string) => (error: unknown) => error instanceof PolicyError && error.code === code;
  let clock = 4_000_000;
  const preparer = new OwnerWanT2iRequestPreparer({ binding: BINDING, linkService: createLinkService(),
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => clock });
  try {
    const candidate = await preparer.prepare({ attemptId: ATTEMPT, principal: principal(), input: {
      model_id: "wan_25_t2i_preview", prompt: "Original expiration stays fixed", parameters: {
        aspect_ratio: "16:9", resolution: "1080P", batch_size: 3, prompt_extend: true,
        seed: 1, color_palette: null, bbox_list: []
      }
    } });
    clock += 500;
    const permit = createPermit({ preparer, candidate, principal: principal(), attemptId: ATTEMPT,
      catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => clock });
    assert.equal(permit.expires_at_ms, candidate.expires_at_ms, "a new permit cannot renew candidate TTL");
    clock = permit.expires_at_ms as number;
    assert.throws(() => consumePermit({ permit, candidate, principal: principal(), attemptId: ATTEMPT }),
      expectCode("PERMIT_EXPIRED"));
  } finally { await preparer.close(); }

  let rollbackClock = 5_000_000;
  const rollbackPreparer = new OwnerWanT2iRequestPreparer({ binding: BINDING, linkService: createLinkService(),
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => rollbackClock });
  try {
    const candidate = await rollbackPreparer.prepare({ attemptId: ATTEMPT, principal: principal(), input: {
      model_id: "wan_26_t2i", prompt: "Rollback invalidates permit", parameters: {
        aspect_ratio: "1:1", resolution: "720P", batch_size: 1, prompt_extend: false,
        seed: null, color_palette: null, bbox_list: []
      }
    } });
    const permit = createPermit({ preparer: rollbackPreparer, candidate, principal: principal(), attemptId: ATTEMPT,
      catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => rollbackClock });
    rollbackClock -= 1;
    assert.throws(() => consumePermit({ permit, candidate, principal: principal(), attemptId: ATTEMPT }),
      expectCode("CLOCK_INVALID"));
    rollbackClock += 2;
    assert.throws(() => consumePermit({ permit, candidate, principal: principal(), attemptId: ATTEMPT }),
      expectCode("PERMIT_EXPIRED"));
  } finally { await rollbackPreparer.close(); }
});

test("refuses consumption after the actual preparer invalidates the candidate attempt", async () => {
  const policyModule = await import(POLICY_MODULE_URL) as Record<string, unknown>;
  const createPermit = policyModule.createOwnerWanT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const consumePermit = policyModule.consumeOwnerWanT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const PolicyError = policyModule.OwnerWanT2iOneShotPolicyError as new (...args: never[]) => Error & { code: string };
  const preparer = new OwnerWanT2iRequestPreparer({ binding: BINDING, linkService: createLinkService(),
    catalog: CATALOG, catalog_version: CATALOG_VERSION });
  try {
    const candidate = await preparer.prepare({ attemptId: ATTEMPT, principal: principal(), input: {
      model_id: "wan_25_t2i_preview", prompt: "Invalidate before permit use", parameters: {
        aspect_ratio: "4:3", resolution: "720P", batch_size: 2, prompt_extend: false,
        seed: null, color_palette: null, bbox_list: []
      }
    } });
    const permit = createPermit({ preparer, candidate, principal: principal(), attemptId: ATTEMPT,
      catalog: CATALOG, catalog_version: CATALOG_VERSION });
    await preparer.invalidateAttempt(ATTEMPT);
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, { attemptId: ATTEMPT, principal: principal() }), false);
    assert.throws(() => consumePermit({ permit, candidate, principal: principal(), attemptId: ATTEMPT }),
      (error: unknown) => error instanceof PolicyError && error.code === "CANDIDATE_UNBOUND");
  } finally { await preparer.close(); }
});

test("refuses consumption when the selected catalog binding changes after issuance", async () => {
  const policyModule = await import(POLICY_MODULE_URL) as Record<string, unknown>;
  const createPermit = policyModule.createOwnerWanT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const consumePermit = policyModule.consumeOwnerWanT2iOneShotPermit as (input: unknown) => Record<string, unknown>;
  const PolicyError = policyModule.OwnerWanT2iOneShotPolicyError as new (...args: never[]) => Error & { code: string };
  const catalog = loadSelectedDiscoveryCatalog(CATALOG_VERSION, CATALOG_ROOT).discoveryCatalog;
  const preparer = new OwnerWanT2iRequestPreparer({ binding: BINDING, linkService: createLinkService(),
    catalog, catalog_version: CATALOG_VERSION });
  try {
    const candidate = await preparer.prepare({ attemptId: ATTEMPT, principal: principal(), input: {
      model_id: "wan_26_t2i", prompt: "Catalog drift blocks consume", parameters: {
        aspect_ratio: "9:16", resolution: "1080P", batch_size: 4, prompt_extend: true,
        seed: 0, color_palette: null, bbox_list: []
      }
    } });
    const permit = createPermit({ preparer, candidate, principal: principal(), attemptId: ATTEMPT,
      catalog, catalog_version: CATALOG_VERSION });
    Object.defineProperty(catalog, "fetched_at", { value: "2026-10-09T00:00:00.000Z" });
    assert.throws(() => consumePermit({ permit, candidate, principal: principal(), attemptId: ATTEMPT }),
      (error: unknown) => error instanceof PolicyError && error.code === "CANDIDATE_UNBOUND");
  } finally { await preparer.close(); }
});
