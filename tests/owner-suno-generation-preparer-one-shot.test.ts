import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { resolveOwnerReferencePrincipal } from "../src/auth/owner-reference-principal.js";

const PARAMETERS_URL = new URL("../src/application/owner-suno-generation-parameters.js", import.meta.url).href;
const PREPARER_URL = new URL("../src/application/owner-suno-generation-request-preparer.js", import.meta.url).href;
const ONE_SHOT_URL = new URL("../src/application/owner-suno-generation-one-shot-policy.js", import.meta.url).href;
const parameterModule = await import(PARAMETERS_URL).catch(() => null) as Record<string, unknown> | null;
const preparerModule = await import(PREPARER_URL).catch(() => null) as Record<string, unknown> | null;
const oneShotModule = await import(ONE_SHOT_URL).catch(() => null) as Record<string, unknown> | null;
const ATTEMPT_A = "link_suno_1070_attempt_a_0123456789";
const ATTEMPT_B = "link_suno_1070_attempt_b_0123456789";
const BINDING = Object.freeze({ tenant_id: "suno-1070-tenant", subject: "suno-1070-owner" });
const stores = new Set<InMemoryAuthLinkStore>();

afterEach(() => {
  for (const store of stores) store.close();
  stores.clear();
});

interface PreparerApi {
  prepare(input: unknown): Promise<Record<string, any>>;
  inspectCandidate(candidate: unknown): Record<string, any> | undefined;
  revalidateCandidate(input: unknown): Record<string, any>;
  invalidateAttempt(attemptId: unknown): void;
  close(): void;
}

interface OneShotApi {
  createPermit(input: unknown): Record<string, any>;
  revalidate(input: unknown): Record<string, any>;
  consume(input: unknown): Record<string, any>;
  invalidateAttempt(attemptId: unknown): void;
  close(): void;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function sunoRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model_id: "V6",
    mode: "generate",
    prompt: "A short, warm instrumental phrase",
    is_custom_mode: false,
    is_instrumental: true,
    negative_tags: "crowd noise",
    styles: "minimal, warm",
    title: "Suno source-bound test",
    ...overrides
  };
}

function normalized(overrides: Record<string, unknown> = {}): Record<string, any> {
  assert.ok(parameterModule, "MISSING_OWNER_SUNO_GENERATION_PARAMETERS_MODULE");
  return (parameterModule.normalizeOwnerSunoGenerationParameters as (input: unknown) => Record<string, any>)(
    sunoRequest(overrides)
  );
}

async function makeFixture() {
  let now = Date.parse("2026-10-13T00:00:00.000Z");
  let challenge = 0;
  let credential = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() {
      challenge += 1;
      return { upstream_attempt_id: "synthetic-suno-challenge-" + challenge, approval_url: "https://example.invalid/" };
    },
    async pollChallenge(_id, receiveCredential) {
      credential += 1;
      await receiveCredential({ scheme: "Bearer", value: "synthetic-suno-credential-" + credential });
      return { state: "LINKED" };
    }
  };
  const store = new InMemoryAuthLinkStore(() => now);
  stores.add(store);
  const attemptIds = [ATTEMPT_A, ATTEMPT_B];
  const links = new PerUserLinkService(provider, store, {
    now: () => now,
    defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: () => attemptIds.shift() ?? "link_suno_1070_extra_0123456789"
  });
  for (const attemptId of [ATTEMPT_A, ATTEMPT_B]) {
    await links.createAttempt(BINDING);
    await links.issueHandoff(BINDING, attemptId);
    assert.equal((await links.checkAttempt(BINDING, attemptId)).status, "LINKED");
  }
  const RequestPreparer = preparerModule?.OwnerSunoGenerationRequestPreparer as
    new (options: unknown) => PreparerApi;
  const OneShotPolicy = oneShotModule?.OwnerSunoGenerationOneShotPolicy as
    new (options: unknown) => OneShotApi;
  assert.equal(typeof RequestPreparer, "function", "MISSING_OWNER_SUNO_GENERATION_REQUEST_PREPARER");
  assert.equal(typeof OneShotPolicy, "function", "MISSING_OWNER_SUNO_GENERATION_ONE_SHOT_POLICY");
  const preparer = new RequestPreparer({ binding: BINDING, linkService: links, now: () => now });
  const policy = new OneShotPolicy({ preparer, now: () => now });
  return {
    get now() { return now; },
    set now(value: number) { now = value; },
    links,
    preparer,
    policy,
    async principal(attemptId: string) {
      return resolveOwnerReferencePrincipal({ binding: BINDING, attemptId, linkService: links });
    },
    async prepare(attemptId: string, input = sunoRequest()) {
      return preparer.prepare({ attemptId, normalized: normalized(input) });
    },
    async close() {
      policy.close();
      preparer.close();
    }
  };
}

test("Suno source preparer and one-shot are private local seams with no dispatch authority", () => {
  assert.equal(typeof preparerModule?.OwnerSunoGenerationRequestPreparer, "function");
  assert.equal(typeof preparerModule?.isOwnerSunoGenerationRequestPreparer, "function");
  assert.equal(typeof preparerModule?.isOwnerSunoGenerationPreparedCandidate, "function");
  assert.equal(typeof oneShotModule?.OwnerSunoGenerationOneShotPolicy, "function");
  assert.equal(typeof oneShotModule?.isOwnerSunoGenerationOneShotPolicy, "function");
  assert.equal(typeof oneShotModule?.isOwnerSunoGenerationOneShotPermit, "function");
});

test("prepares a redacted candidate from exact normalized intent and a genuine linked owner service", async () => {
  const f = await makeFixture();
  try {
    const input = sunoRequest();
    const candidate = await f.prepare(ATTEMPT_A, input);
    assert.equal((preparerModule!.isOwnerSunoGenerationPreparedCandidate as (value: unknown) => boolean)(candidate), true);
    assert.equal((preparerModule!.isOwnerSunoGenerationPreparedCandidate as (value: unknown) => boolean)({
      ...candidate
    }), false);
    const principal = await f.principal(ATTEMPT_A);
    const binding = f.preparer.inspectCandidate(candidate);
    assert.equal(candidate.status, "prepared");
    assert.equal(candidate.model_id, "V6");
    assert.equal(candidate.mode, "generate");
    assert.equal(candidate.attempt_id, ATTEMPT_A);
    assert.equal(candidate.expires_at, f.now + 15 * 60_000);
    assert.equal(candidate.runtime_usable, false);
    assert.equal(candidate.dispatch_allowed, false);
    assert.equal(candidate.backend_acceptance, "UNPROVEN");
    assert.equal(typeof candidate.intent_fingerprint, "string");
    assert.equal(binding?.principal.tenant_id, principal.tenant_id);
    assert.equal(binding?.principal.subject_id, principal.subject_id);
    assert.equal(binding?.principal.connection_id, ATTEMPT_A);
    assert.equal(JSON.stringify(candidate).includes(String(input.prompt)), false);
    assert.equal(JSON.stringify(candidate).includes(String(input.title)), false);
    assert.equal(JSON.stringify(candidate).includes(BINDING.tenant_id), false);
    assert.equal(JSON.stringify(candidate).includes(BINDING.subject), false);
    assert.equal(Object.isFrozen(candidate), true);
    assert.equal(Object.isFrozen(binding), true);
  } finally {
    await f.close();
  }
});

test("one-shot emits the exact private Suno request once and keeps it off candidate and permit", async () => {
  const f = await makeFixture();
  try {
    const input = sunoRequest();
    const candidate = await f.prepare(ATTEMPT_A, input);
    const principal = await f.principal(ATTEMPT_A);
    const context = { candidate, attemptId: ATTEMPT_A, principal };
    const permit = f.policy.createPermit(context);
    assert.equal((oneShotModule!.isOwnerSunoGenerationOneShotPermit as (value: unknown) => boolean)(permit), true);
    assert.equal((oneShotModule!.isOwnerSunoGenerationOneShotPermit as (value: unknown) => boolean)({
      ...permit
    }), false);
    assert.equal(permit.dispatch_allowed, false);
    assert.equal(permit.backend_acceptance, "UNPROVEN");
    assert.equal(JSON.stringify(permit).includes(String(input.prompt)), false);
    assert.equal(JSON.stringify(permit).includes(String(input.title)), false);
    f.policy.revalidate({ ...context, permit });
    const result = f.policy.consume({ ...context, permit });
    assert.deepEqual(result.private_request, {
      ai_name: "suno",
      prompt: "A short, warm instrumental phrase",
      settings: {
        model_type: "V6",
        mode: "generate",
        is_custom_mode: false,
        is_instrumental: true,
        negative_tags: "crowd noise",
        styles: "minimal, warm",
        title: "Suno source-bound test"
      }
    });
    assert.equal(result.dispatch_allowed, false);
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.throws(() => f.policy.consume({ ...context, permit }),
      (error: unknown) => errorCode(error) === "PERMIT_ALREADY_CONSUMED");
  } finally {
    await f.close();
  }
});

test("semantic fingerprint excludes attempt nonce but consumed claims survive expiry and relinking", async () => {
  const f = await makeFixture();
  try {
    const normalizedInput = sunoRequest();
    const first = await f.prepare(ATTEMPT_A, normalizedInput);
    const firstPrincipal = await f.principal(ATTEMPT_A);
    const firstContext = { candidate: first, attemptId: ATTEMPT_A, principal: firstPrincipal };
    const permit = f.policy.createPermit(firstContext);
    f.policy.revalidate({ ...firstContext, permit });
    f.policy.consume({ ...firstContext, permit });
    f.policy.invalidateAttempt(ATTEMPT_A);

    f.now += 15 * 60_000 + 1;
    const second = await f.prepare(ATTEMPT_B, normalizedInput);
    assert.equal(second.intent_fingerprint, first.intent_fingerprint);
    const secondPrincipal = await f.principal(ATTEMPT_B);
    assert.throws(() => f.policy.createPermit({
      candidate: second,
      attemptId: ATTEMPT_B,
      principal: secondPrincipal
    }), (error: unknown) => errorCode(error) === "INTENT_ALREADY_CLAIMED");
  } finally {
    await f.close();
  }
});

test("expires only unconsumed pre-dispatch candidates and permits", async () => {
  const f = await makeFixture();
  try {
    const candidate = await f.prepare(ATTEMPT_A);
    const principal = await f.principal(ATTEMPT_A);
    const context = { candidate, attemptId: ATTEMPT_A, principal };
    const permit = f.policy.createPermit(context);
    f.now += 15 * 60_000 + 1;
    assert.throws(() => f.policy.revalidate({ ...context, permit }),
      (error: unknown) => errorCode(error) === "CANDIDATE_EXPIRED");
    const renewedCandidate = await f.prepare(ATTEMPT_B);
    const renewedPrincipal = await f.principal(ATTEMPT_B);
    assert.ok(f.policy.createPermit({
      candidate: renewedCandidate,
      attemptId: ATTEMPT_B,
      principal: renewedPrincipal
    }));
  } finally {
    await f.close();
  }
});

test("rejects forged normalized candidates, foreign principals, and substituted link-service ports", async () => {
  const f = await makeFixture();
  try {
    const sourceValue = normalized();
    const modified = structuredClone(sourceValue);
    modified.source_pins.form_sha256 = "sha256:" + "0".repeat(64);
    await assert.rejects(f.preparer.prepare({ attemptId: ATTEMPT_A, normalized: modified }),
      (error: unknown) => errorCode(error) === "NORMALIZED_CANDIDATE_INVALID");

    const candidate = await f.prepare(ATTEMPT_A);
    const foreignPrincipal = { tenant_id: BINDING.tenant_id, subject_id: "foreign-owner", connection_id: ATTEMPT_A };
    assert.throws(() => f.policy.createPermit({
      candidate,
      attemptId: ATTEMPT_A,
      principal: foreignPrincipal
    }), (error: unknown) => errorCode(error) === "PRINCIPAL_MISMATCH");

    const RequestPreparer = preparerModule!.OwnerSunoGenerationRequestPreparer as new (options: unknown) => unknown;
    assert.throws(() => new RequestPreparer({
      binding: BINDING,
      linkService: { getStatus: async () => ({ status: "LINKED" }) }
    }), (error: unknown) => errorCode(error) === "LINK_SERVICE_UNTRUSTED");

    const revoked = Proxy.revocable(f.preparer, {});
    revoked.revoke();
    assert.equal((preparerModule!.isOwnerSunoGenerationRequestPreparer as (value: unknown) => boolean)(revoked.proxy), false);
  } finally {
    await f.close();
  }
});

test("candidate accessors and proxies are rejected without invoking caller getters", async () => {
  const f = await makeFixture();
  try {
    const candidate = await f.prepare(ATTEMPT_A);
    let getterCalled = false;
    const input = { candidate, attemptId: ATTEMPT_A, principal: await f.principal(ATTEMPT_A) };
    Object.defineProperty(input, "candidate", {
      enumerable: true,
      get() { getterCalled = true; return candidate; }
    });
    assert.throws(() => f.policy.createPermit(input),
      (error: unknown) => errorCode(error) === "INVALID_REQUEST");
    assert.equal(getterCalled, false);

    const revoked = Proxy.revocable(candidate, {});
    revoked.revoke();
    assert.equal(f.preparer.inspectCandidate(revoked.proxy), undefined);
  } finally {
    await f.close();
  }
});

test("attempt invalidation drops only unconsumed authority and close leaves the borrowed link service open", async () => {
  const f = await makeFixture();
  try {
    const candidate = await f.prepare(ATTEMPT_A);
    const principal = await f.principal(ATTEMPT_A);
    const permit = f.policy.createPermit({ candidate, attemptId: ATTEMPT_A, principal });
    f.policy.invalidateAttempt(ATTEMPT_A);
    assert.throws(() => f.policy.revalidate({ candidate, attemptId: ATTEMPT_A, principal, permit }),
      (error: unknown) => errorCode(error) === "ATTEMPT_INVALIDATED");

    f.preparer.invalidateAttempt(ATTEMPT_A);
    assert.equal(f.preparer.inspectCandidate(candidate), undefined);
    await f.close();
    assert.equal((await f.links.getStatus(BINDING, ATTEMPT_A)).status, "LINKED");
  } finally {
    await f.close();
  }
});
