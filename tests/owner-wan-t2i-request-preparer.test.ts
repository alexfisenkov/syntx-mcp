import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthBinding } from "../src/auth/types.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import { type OwnerWanT2iModel, type OwnerWanT2iParametersInput } from "../src/application/owner-wan-t2i-parameters.js";
import { getOwnerWanT2iSourceProfile } from "../src/application/owner-wan-t2i-source-profile.js";
import { projectOwnerWanT2iCostParameters } from "../src/application/owner-wan-t2i-cost-parameters.js";

const MODULE_URL = new URL("../src/application/owner-wan-t2i-request-preparer.js", import.meta.url).href;
const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG_ROOT = join(process.cwd(), "catalog");
const CATALOG = loadSelectedDiscoveryCatalog(CATALOG_VERSION, CATALOG_ROOT).discoveryCatalog;
const BINDING: AuthBinding = Object.freeze({ tenant_id: "wan-t2i-preparer-tenant", subject: "wan-t2i-preparer-subject" });
const ATTEMPT = "link_wan_t2i_preparer_test_000000000001";
const SECOND_ATTEMPT = "link_wan_t2i_preparer_test_000000000002";
const MODELS = ["wan_25_t2i_preview", "wan_26_t2i"] as const;
const RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"] as const;
const RESOLUTIONS = ["720P", "1080P"] as const;
const SEEDS = [null, 0, 2_147_483_647] as const;

interface PreparedCandidate extends Record<string, unknown> {
  readonly model_id: OwnerWanT2iModel;
  readonly parameters: Record<string, unknown>;
  readonly profile_schema_hash: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly expires_at_ms: number;
  readonly dispatch_allowed: false;
  readonly request: { readonly prompt: string; readonly settings: Record<string, unknown> };
}
interface Preparer {
  prepare(input: unknown): Promise<PreparedCandidate>;
  isPreparedCandidateForPrincipal(candidate: unknown, context: unknown): boolean;
  invalidateAttempt(attemptId: unknown): Promise<void>;
  close(): Promise<void>;
}
interface Api {
  readonly OwnerWanT2iRequestPreparer: new (options: unknown) => Preparer;
  readonly OwnerWanT2iRequestPrepareError: new (...args: never[]) => Error & { readonly code: string };
}

function parameters(overrides: Record<string, unknown> = {}) {
  return { aspect_ratio: "1:1", resolution: "720P", batch_size: 1, prompt_extend: false, seed: null,
    color_palette: null, bbox_list: [], ...overrides };
}
function input(model_id: OwnerWanT2iModel = "wan_25_t2i_preview", prompt = "A quiet red lighthouse above the sea",
  overrides: Record<string, unknown> = {}): OwnerWanT2iParametersInput {
  return { model_id, prompt, parameters: parameters(overrides) as unknown as OwnerWanT2iParametersInput["parameters"] };
}
function principal(attemptId = ATTEMPT) {
  return Object.freeze({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: attemptId });
}
function linkedStatus(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: null, linked: true };
}

function createLinkService(options: {
  pending?: Promise<unknown>; status?: (attemptId: string) => unknown; revoke?: (attemptId: string) => unknown;
} = {}) {
  let calls = 0;
  let revoked = false;
  const service = new PerUserLinkService({} as never, { async getSnapshot(_binding: unknown, attemptId: string) {
    calls += 1;
    return options.pending ?? options.status?.(attemptId) ?? (revoked
      ? { ...linkedStatus(attemptId), status: "REVOKED" as const, linked: false } : linkedStatus(attemptId));
  }, async revoke(_binding: unknown, attemptId: string) {
    revoked = true;
    return options.revoke?.(attemptId) ?? { ...linkedStatus(attemptId), status: "REVOKED" as const, linked: false };
  } } as never);
  return { service, get calls() { return calls; } };
}

async function loadApi(): Promise<Api> {
  let module: Record<string, unknown> | undefined;
  try { module = await import(MODULE_URL) as Record<string, unknown>; } catch { /* Expected RED before the preparer exists. */ }
  assert.equal(typeof module?.OwnerWanT2iRequestPreparer, "function", "MISSING_OWNER_WAN_T2I_REQUEST_PREPARER");
  return module as unknown as Api;
}

function createPreparer(api: Api, options: { now?: () => number; link?: ReturnType<typeof createLinkService> } = {}) {
  const link = options.link ?? createLinkService();
  const preparer = new api.OwnerWanT2iRequestPreparer({ binding: BINDING, linkService: link.service,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, ...(options.now === undefined ? {} : { now: options.now }) });
  return { preparer, link };
}

function expectPrepareError(api: Api, promise: Promise<unknown>): Promise<void> {
  return assert.rejects(promise, (error: unknown) => error instanceof api.OwnerWanT2iRequestPrepareError);
}

test("exports the private zero-reference WAN T2I request preparation seam", async () => {
  const api = await loadApi();
  assert.equal(typeof api.OwnerWanT2iRequestPreparer, "function");
  const expectedHashes = [
    ["wan_25_t2i_preview", "sha256:85dd8513cc1fb51429fef15454ec7959935284734cbb4d0f58c7feb7e046883a"],
    ["wan_26_t2i", "sha256:44ab97682526f0564452a190742c059754a16427e5b09ce5c4736d79e2000f6e"]
  ] as const;
  for (const [modelId, rowHash] of expectedHashes) {
    const profile = getOwnerWanT2iSourceProfile(modelId, CATALOG, CATALOG_VERSION);
    assert.equal(profile.model_id, modelId);
    assert.equal(profile.source_binding.public_catalog_raw_model_row_schema_hash, rowHash);
  }
});

test("prepares all 80 explicit source states into exact private sender bodies and batch-only cost inputs", async () => {
  const api = await loadApi();
  const { preparer, link } = createPreparer(api);
  let count = 0;
  try {
    for (const model_id of MODELS) for (const aspect_ratio of RATIOS) for (const resolution of RESOLUTIONS) {
      for (const batch_size of [1, 2, 3, 4] as const) {
        const prompt_extend = count % 2 === 0;
        const seed = SEEDS[count % SEEDS.length]!;
        const request = input(model_id, `Prompt ${count}`, { aspect_ratio, resolution, batch_size, prompt_extend, seed });
        const cost = projectOwnerWanT2iCostParameters(request);
        const candidate = await preparer.prepare({ attemptId: ATTEMPT, principal: principal(), input: request });
        assert.equal(candidate.status, "PREPARED_SOURCE_SHAPED");
        assert.equal(candidate.dispatch_allowed, false);
        assert.equal(candidate.backend_acceptance, "UNPROVEN");
        assert.equal(candidate.model_id, model_id);
        assert.deepEqual(candidate.parameters, request.parameters);
        assert.deepEqual(candidate.cost_routing, cost.routing);
        assert.deepEqual(candidate.cost_inputs, cost.cost_inputs);
        assert.deepEqual(candidate.cost_input_confidence, cost.confidence);
        assert.equal(candidate.source_projection_confidence,
          "EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY");
        assert.deepEqual(candidate.request, { prompt: request.prompt, settings: {
          n: 1, model_type: model_id, aspect_ratio, resolution, batch_size, prompt_extend, seed,
          color_palette: null, bbox_list: [], file_urls: []
        } });
        assert.equal(Object.hasOwn(candidate.request.settings, "size"), false);
        assert.equal(Object.hasOwn(candidate.request.settings, "version"), false);
        assert.equal(Object.getOwnPropertyDescriptor(candidate, "request")?.enumerable, false);
        assert.equal(JSON.stringify(candidate).includes(request.prompt), false);
        assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, { attemptId: ATTEMPT, principal: principal() }), true);
        count += 1;
      }
    }
    assert.equal(count, 80);
    assert.equal(link.calls, 160, "each preparation is bracketed by actual current linked-principal reads");
  } finally { await preparer.close(); }
});

test("fingerprints separate stable intent from one-shot request nonce, original expiry, and caller-visible metadata", async () => {
  const api = await loadApi();
  let now = 100_000;
  const { preparer } = createPreparer(api, { now: () => now });
  const request = input("wan_26_t2i", "Keep this prompt private", { batch_size: 4, prompt_extend: true, seed: 0 });
  try {
    const first = await preparer.prepare({ attemptId: ATTEMPT, principal: principal(), input: request });
    const second = await preparer.prepare({ attemptId: ATTEMPT, principal: principal(), input: request });
    assert.equal(first.intent_fingerprint, second.intent_fingerprint);
    assert.notEqual(first.request_fingerprint, second.request_fingerprint);
    assert.equal(first.expires_at_ms, 1_000_000);
    assert.equal(second.expires_at_ms, 1_000_000);
    assert.equal(Object.hasOwn(first, "prompt"), false);
    for (const secret of [request.prompt, ATTEMPT, BINDING.tenant_id, BINDING.subject]) {
      assert.equal(JSON.stringify(first).includes(secret), false);
    }
    now += 1_000;
    const later = await preparer.prepare({ attemptId: ATTEMPT, principal: principal(), input: request });
    assert.equal(first.expires_at_ms, 1_000_000, "existing candidate expiry is never renewed");
    assert.equal(later.expires_at_ms, 1_001_000);
    assert.equal(first.intent_fingerprint, later.intent_fingerprint);
    assert.notEqual(first.request_fingerprint, later.request_fingerprint);
    const nextAttempt = await preparer.prepare({ attemptId: SECOND_ATTEMPT, principal: principal(SECOND_ATTEMPT), input: request });
    assert.equal(first.intent_fingerprint, nextAttempt.intent_fingerprint, "intent fingerprint excludes attempt and time");
    assert.notEqual(first.request_fingerprint, nextAttempt.request_fingerprint);
  } finally { await preparer.close(); }
});

test("rejects a foreign principal and an already aborted request before returning a candidate", async () => {
  const api = await loadApi();
  const link = createLinkService();
  const { preparer } = createPreparer(api, { link });
  try {
    await expectPrepareError(api, preparer.prepare({ attemptId: ATTEMPT,
      principal: Object.freeze({ ...principal(), subject_id: "other-subject" }), input: input() }));
    assert.equal(link.calls, 1, "principal mismatch is rejected on the first actual linked-owner read");
  } finally { await preparer.close(); }

  const preAborted = createLinkService();
  const next = createPreparer(api, { link: preAborted });
  const controller = new AbortController(); controller.abort();
  try {
    await expectPrepareError(api, next.preparer.prepare({ attemptId: ATTEMPT, principal: principal(), input: input(), signal: controller.signal }));
    assert.equal(preAborted.calls, 0);
  } finally { await next.preparer.close(); }
});

test("rejects malformed closed intents before source lookup or candidate issuance", async () => {
  const api = await loadApi();
  const link = createLinkService();
  const { preparer } = createPreparer(api, { link });
  try {
    for (const bad of [
      { ...input(), model_type: "wan_25_t2i_preview" }, { ...input(), file_urls: [] },
      { ...input(), parameters: { ...input().parameters, size: "720P" } },
      { ...input(), parameters: { ...input().parameters, bbox_list: [[]] } },
      { ...input(), parameters: { ...input().parameters, color_palette: [] } },
      { ...input(), prompt: "x".repeat(1_501) }, { ...input(), prompt: "x\u0085y" }
    ]) await expectPrepareError(api, preparer.prepare({ attemptId: ATTEMPT, principal: principal(), input: bad }));
    assert.equal(link.calls, 0);
  } finally { await preparer.close(); }
});

test("candidate authority is exact-object, principal/attempt scoped, and invalidated before auth revoke", async () => {
  const api = await loadApi();
  let now = 200_000;
  const link = createLinkService();
  const { preparer } = createPreparer(api, { now: () => now, link });
  try {
    const candidate = await preparer.prepare({ attemptId: ATTEMPT, principal: principal(), input: input() });
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, { attemptId: ATTEMPT, principal: principal() }), true);
    assert.equal(preparer.isPreparedCandidateForPrincipal(structuredClone(candidate), { attemptId: ATTEMPT, principal: principal() }), false);
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, { attemptId: SECOND_ATTEMPT, principal: principal(SECOND_ATTEMPT) }), false);
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, { attemptId: ATTEMPT,
      principal: Object.freeze({ ...principal(), subject_id: "foreign-subject" }) }), false);
    await preparer.invalidateAttempt(ATTEMPT);
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, { attemptId: ATTEMPT, principal: principal() }), false);
    await link.service.revoke(BINDING, ATTEMPT);
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, { attemptId: ATTEMPT, principal: principal() }), false,
      "attempt-scoped candidate is revoked before the linked credential can be revoked");
    assert.equal(Object.isFrozen(candidate.request), true);
  } finally { await preparer.close(); }
});

test("original TTL expires candidates, and clock rollback invalidates preparation checks", async () => {
  const api = await loadApi();
  let now = 500_000;
  const { preparer } = createPreparer(api, { now: () => now });
  try {
    const candidate = await preparer.prepare({ attemptId: ATTEMPT, principal: principal(), input: input() });
    now = candidate.expires_at_ms - 1;
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, { attemptId: ATTEMPT, principal: principal() }), true);
    now = candidate.expires_at_ms;
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidate, { attemptId: ATTEMPT, principal: principal() }), false);
  } finally { await preparer.close(); }

  let clock = 700_000;
  const rollback = createPreparer(api, { now: () => clock });
  try {
    const candidate = await rollback.preparer.prepare({ attemptId: ATTEMPT, principal: principal(), input: input() });
    clock -= 1;
    assert.equal(rollback.preparer.isPreparedCandidateForPrincipal(candidate, { attemptId: ATTEMPT, principal: principal() }), false);
    clock += 2;
    assert.equal(rollback.preparer.isPreparedCandidateForPrincipal(candidate, { attemptId: ATTEMPT, principal: principal() }), false,
      "rollback permanently invalidates old candidate authority even after wall clock returns");
    await expectPrepareError(api, rollback.preparer.prepare({ attemptId: ATTEMPT, principal: principal(), input: input() }));
  } finally { await rollback.preparer.close(); }
});

test("caps active candidate handles at 128 and releases capacity after expiry", async () => {
  const api = await loadApi();
  let now = 800_000;
  const { preparer } = createPreparer(api, { now: () => now });
  try {
    const candidates: PreparedCandidate[] = [];
    for (let index = 0; index < 128; index += 1) {
      candidates.push(await preparer.prepare({ attemptId: ATTEMPT, principal: principal(), input: input("wan_25_t2i_preview", `hold ${index}`) }));
    }
    await assert.rejects(preparer.prepare({ attemptId: ATTEMPT, principal: principal(), input: input() }), (error: unknown) =>
      error instanceof api.OwnerWanT2iRequestPrepareError && error.code === "CAPACITY_EXCEEDED");
    now += 900_000;
    const replacement = await preparer.prepare({ attemptId: ATTEMPT, principal: principal(), input: input("wan_26_t2i", "replacement") });
    assert.equal(preparer.isPreparedCandidateForPrincipal(candidates[0], { attemptId: ATTEMPT, principal: principal() }), false);
    assert.equal(preparer.isPreparedCandidateForPrincipal(replacement, { attemptId: ATTEMPT, principal: principal() }), true);
  } finally { await preparer.close(); }
});

test("revocation aborts at most four pending link reads and drains without late candidate issuance", async () => {
  const api = await loadApi();
  let release!: (value: unknown) => void;
  const pending = new Promise<unknown>((resolve) => { release = resolve; });
  const link = createLinkService({ pending });
  const { preparer } = createPreparer(api, { link });
  const preparing = Array.from({ length: 4 }, (_, index) => preparer.prepare({ attemptId: ATTEMPT, principal: principal(),
    input: input("wan_25_t2i_preview", `pending ${index}`) }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  await expectPrepareError(api, preparer.prepare({ attemptId: ATTEMPT, principal: principal(), input: input() }));
  assert.equal(link.calls, 4);
  const invalidating = preparer.invalidateAttempt(ATTEMPT);
  await invalidating;
  await Promise.all(preparing.map((operation) => expectPrepareError(api, operation)));
  release(linkedStatus(ATTEMPT));
  await preparer.close();
  assert.equal(link.calls, 4);
  await expectPrepareError(api, preparer.prepare({ attemptId: ATTEMPT, principal: principal(), input: input() }));
});

test("close aborts and drains in-flight preparation before returning", async () => {
  const api = await loadApi();
  let release!: (value: unknown) => void;
  const pending = new Promise<unknown>((resolve) => { release = resolve; });
  const link = createLinkService({ pending });
  const { preparer } = createPreparer(api, { link });
  const preparing = preparer.prepare({ attemptId: ATTEMPT, principal: principal(), input: input() });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const closing = preparer.close();
  await closing;
  await expectPrepareError(api, preparing);
  release(linkedStatus(ATTEMPT));
  assert.equal(link.calls, 1);
});

test("attempt invalidation blocks new preparation until the old lookup has drained", async () => {
  const api = await loadApi();
  let release!: (value: unknown) => void;
  const pending = new Promise<unknown>((resolve) => { release = resolve; });
  const link = createLinkService({ pending });
  const { preparer } = createPreparer(api, { link });
  const oldPreparation = preparer.prepare({ attemptId: ATTEMPT, principal: principal(), input: input("wan_25_t2i_preview", "old") });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const invalidating = preparer.invalidateAttempt(ATTEMPT);
  const racingPreparation = preparer.prepare({ attemptId: ATTEMPT, principal: principal(), input: input("wan_26_t2i", "racing") });
  const racingRejection = expectPrepareError(api, racingPreparation);
  await invalidating;
  assert.equal(link.calls, 1, "new preparation is refused while invalidation owns the attempt lifecycle");
  release(linkedStatus(ATTEMPT));
  await expectPrepareError(api, oldPreparation);
  await racingRejection;
  await preparer.close();
});
