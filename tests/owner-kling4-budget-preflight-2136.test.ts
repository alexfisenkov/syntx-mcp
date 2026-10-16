import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../src/adapter/syntx/account-decoder.js";
import type { SyntxCostParameter } from "../src/adapter/syntx/http-client.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import type { AccountStatusResult } from "../src/application/account-status.js";
import type { ModelAccessResult } from "../src/application/model-access.js";

type ModelId = "kling_4_keyframes" | "kling_4_omni";
type Resolver = (attemptId: string, modelId: string, costParameters: Readonly<Record<string, SyntxCostParameter>>,
  signal?: AbortSignal) => Promise<ModelAccessResult>;
type Options = {
  catalog: DiscoveryCatalogRepository;
  resolveAccountStatus: (attemptId: string, signal?: AbortSignal) => Promise<AccountStatusResult>;
  resolveModelAccess: (attemptId: string, modelId: string, costParameters: Readonly<Record<string, SyntxCostParameter>>,
    signal?: AbortSignal) => Promise<ModelAccessResult>;
  now?: () => number;
};
type BudgetModule = {
  createOwnerKling4BudgetedModelAccessResolver(options: Options): Resolver;
};

const NOW = Date.parse("2026-10-17T05:00:00.000Z");
const ATTEMPT = "link_kling4_budget_attempt_2136";
const CATALOG_VERSION = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json";
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(CATALOG_VERSION, resolve(process.cwd(), "catalog")));
const EXPECTED_CATALOG_VERSION = `${CATALOG.fetched_at}.${CATALOG.source_hashes.models.slice(7, 19)}`;
const MODEL_IDS: readonly ModelId[] = ["kling_4_keyframes", "kling_4_omni"];

async function loadBudget(): Promise<BudgetModule | null> {
  try {
    return await import(new URL("../src/application/owner-kling4-budget-preflight.js", import.meta.url).href) as BudgetModule;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") return null;
    throw error;
  }
}

function parameters(modelId: ModelId, duration: number | string = 0, mode: "hd" | "standart" = "hd"): Readonly<Record<string, SyntxCostParameter>> {
  return Object.freeze({ mode, version: "4.0", video_duration: 30,
    ...(modelId === "kling_4_omni" ? { duration } : {}) });
}

function quote(modelId: ModelId, parameterKeys: string[], overrides: Partial<ModelAccessResult> = {}): ModelAccessResult {
  return {
    catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT", catalog_version: EXPECTED_CATALOG_VERSION,
    model_id: modelId, ai_name: "kling", model_type: modelId, account_read_live: true,
    parameter_keys: parameterKeys, parameters_redacted: true, access: true, cost: 0.2, discount_cost: null,
    free_remaining_generations: null, limit: null, show_warning: false,
    observed_at: new Date(NOW).toISOString(), ...overrides
  };
}

function account(available = "0.2", overrides: Partial<AccountStatusResult> = {}): AccountStatusResult {
  return {
    balance: { unit: "tokens", available },
    subscription: { active: true, plan_type: "PAID", end_date: null, end_date_kind: null },
    contract_evidence: ACCOUNT_CONTRACT_EVIDENCE, source_build: ACCOUNT_SOURCE_BUILD,
    observed_at: new Date(NOW).toISOString(), ...overrides
  };
}

function expectedKeys(modelId: ModelId): string[] {
  return modelId === "kling_4_keyframes"
    ? ["mode", "version", "video_duration"]
    : ["duration", "mode", "version", "video_duration"];
}

function options(overrides: Partial<Options> = {}): Options {
  return {
    catalog: CATALOG,
    now: () => NOW,
    resolveModelAccess: async (_attemptId, modelId) => quote(modelId as ModelId, expectedKeys(modelId as ModelId)),
    resolveAccountStatus: async () => account(),
    ...overrides
  };
}

test("accepts exact cost fields for each Kling 4 model and preserves Omni source duration representation", async () => {
  const budget = await loadBudget(); assert.ok(budget, "K4 budget preflight must be importable");
  for (const modelId of MODEL_IDS) {
    const values = modelId === "kling_4_keyframes" ? [0] : [0, "1.20", "99999999999999999.99"] as const;
    for (const duration of values) {
      const supplied = parameters(modelId, duration);
      let observedParameters: Readonly<Record<string, SyntxCostParameter>> | undefined;
      const resolver = budget.createOwnerKling4BudgetedModelAccessResolver(options({
        resolveModelAccess: async (attemptId, receivedModelId, costParameters) => {
          assert.equal(attemptId, ATTEMPT); assert.equal(receivedModelId, modelId);
          observedParameters = costParameters;
          return quote(modelId, expectedKeys(modelId));
        },
        resolveAccountStatus: async (attemptId) => { assert.equal(attemptId, ATTEMPT); return account(); }
      }));
      const result = await resolver(ATTEMPT, modelId, supplied);
      assert.deepEqual({ ...observedParameters }, supplied);
      assert.equal(result.model_id, modelId);
      assert.equal(result.ai_name, "kling");
      assert.equal(result.model_type, modelId);
      assert.equal(result.catalog_version, EXPECTED_CATALOG_VERSION);
    }
  }
  const standardMode = budget.createOwnerKling4BudgetedModelAccessResolver(options());
  await standardMode(ATTEMPT, "kling_4_keyframes", parameters("kling_4_keyframes", 0, "standart"));
});

test("rejects wrong identity, extra keys and malformed K4 settings before quote or account reads", async () => {
  const budget = await loadBudget(); assert.ok(budget, "K4 budget preflight must be importable");
  let reads = 0;
  const resolver = budget.createOwnerKling4BudgetedModelAccessResolver(options({
    resolveModelAccess: async () => { reads += 1; return quote("kling_4_keyframes", expectedKeys("kling_4_keyframes")); },
    resolveAccountStatus: async () => { reads += 1; return account(); }
  }));

  await assert.rejects(resolver(ATTEMPT, "veo_omni", parameters("kling_4_keyframes")));
  for (const malformed of [
    { ...parameters("kling_4_keyframes"), n: 1 },
    { mode: "standart", version: "3.0", video_duration: 5 },
    { mode: "4k", version: "4.0", video_duration: 3 },
    { mode: "hd", version: "4.0", video_duration: 2 },
    { mode: "hd", version: "4.0", video_duration: 31 },
    { ...parameters("kling_4_omni", "1.2") },
    { ...parameters("kling_4_omni", -1) },
    { ...parameters("kling_4_omni", "1.2") },
    { ...parameters("kling_4_omni", "1.200") }
  ]) {
    const target: ModelId = "duration" in malformed ? "kling_4_omni" : "kling_4_keyframes";
    await assert.rejects(resolver(ATTEMPT, target, malformed as Readonly<Record<string, SyntxCostParameter>>));
  }
  assert.equal(reads, 0);
});

test("selects a finite discount and accepts the exact decimal affordability boundary", async () => {
  const budget = await loadBudget(); assert.ok(budget, "K4 budget preflight must be importable");
  const modelId = "kling_4_omni";
  const resolver = budget.createOwnerKling4BudgetedModelAccessResolver(options({
    resolveModelAccess: async () => quote(modelId, expectedKeys(modelId), { cost: 4, discount_cost: 0.1 }),
    resolveAccountStatus: async () => account("0.100000000000")
  }));
  const result = await resolver(ATTEMPT, modelId, parameters(modelId, "0.00"));
  assert.equal(result.cost, 4);
  assert.equal(result.discount_cost, 0.1);
});

test("fails closed on stale or identity-mismatched evidence and balances just below the quote", async () => {
  const budget = await loadBudget(); assert.ok(budget, "K4 budget preflight must be importable");
  const modelId = "kling_4_keyframes";
  const params = parameters(modelId);
  const make = (access: ModelAccessResult, balance: AccountStatusResult) => budget.createOwnerKling4BudgetedModelAccessResolver(options({
    resolveModelAccess: async () => access, resolveAccountStatus: async () => balance
  }));
  const goodQuote = quote(modelId, expectedKeys(modelId), { cost: 0.2, discount_cost: null });
  for (const badQuote of [
    quote(modelId, expectedKeys(modelId), { cost: null, discount_cost: null }),
    quote(modelId, expectedKeys(modelId), { cost: Number.NaN, discount_cost: null }),
    quote(modelId, expectedKeys(modelId), { cost: Number.POSITIVE_INFINITY, discount_cost: null }),
    quote(modelId, expectedKeys(modelId), { discount_cost: Number.NEGATIVE_INFINITY }),
    quote(modelId, expectedKeys(modelId), { access: null }),
    quote(modelId, expectedKeys(modelId), { catalog_version: "wrong" }),
    quote(modelId, expectedKeys(modelId), { ai_name: "veo3" }),
    quote(modelId, ["mode", "version"])
  ]) await assert.rejects(make(badQuote, account())(ATTEMPT, modelId, params));
  await assert.rejects(make(quote(modelId, expectedKeys(modelId), { observed_at: new Date(NOW - 300_001).toISOString() }), account())(ATTEMPT, modelId, params));
  await assert.rejects(make(quote(modelId, expectedKeys(modelId), { model_type: "kling" }), account())(ATTEMPT, modelId, params));
  await assert.rejects(make(goodQuote, account("0.19999999999999999"))(ATTEMPT, modelId, params));
  await assert.rejects(make(goodQuote, account("0.2", { observed_at: new Date(NOW - 300_001).toISOString() }))(ATTEMPT, modelId, params));
});

test("rejects accessor and proxy data without invoking getters and returns a detached quote snapshot", async () => {
  const budget = await loadBudget(); assert.ok(budget, "K4 budget preflight must be importable");
  let getterCalls = 0;
  const getterParams = Object.defineProperties({}, {
    mode: { enumerable: true, value: "hd" }, version: { enumerable: true, value: "4.0" },
    video_duration: { enumerable: true, value: 3 },
    duration: { enumerable: true, get() { getterCalls += 1; return "1.20"; } }
  });
  let accountReads = 0;
  const resolver = budget.createOwnerKling4BudgetedModelAccessResolver(options({
    resolveModelAccess: async () => quote("kling_4_omni", expectedKeys("kling_4_omni")),
    resolveAccountStatus: async () => { accountReads += 1; return account(); }
  }));
  await assert.rejects(resolver(ATTEMPT, "kling_4_omni", getterParams as Readonly<Record<string, SyntxCostParameter>>));
  await assert.rejects(resolver(ATTEMPT, "kling_4_keyframes", new Proxy(parameters("kling_4_keyframes"), {})));
  assert.equal(getterCalls, 0); assert.equal(accountReads, 0);

  const mutable = quote("kling_4_omni", expectedKeys("kling_4_omni"), { cost: 0.2 });
  const snapshotResolver = budget.createOwnerKling4BudgetedModelAccessResolver(options({
    resolveModelAccess: async () => mutable,
    resolveAccountStatus: async () => { mutable.cost = 9; return account(); }
  }));
  const result = await snapshotResolver(ATTEMPT, "kling_4_omni", parameters("kling_4_omni", 0));
  assert.equal(result.cost, 0.2);

  const proxiedQuoteResolver = budget.createOwnerKling4BudgetedModelAccessResolver(options({
    resolveModelAccess: async () => new Proxy(quote("kling_4_omni", expectedKeys("kling_4_omni")), {}) as ModelAccessResult,
    resolveAccountStatus: async () => { accountReads += 1; return account(); }
  }));
  await assert.rejects(proxiedQuoteResolver(ATTEMPT, "kling_4_omni", parameters("kling_4_omni", 0)));
  assert.equal(accountReads, 0);

  const getterQuote = quote("kling_4_omni", expectedKeys("kling_4_omni"));
  Object.defineProperty(getterQuote, "cost", { enumerable: true, get() { getterCalls += 1; return 0.2; } });
  const getterQuoteResolver = budget.createOwnerKling4BudgetedModelAccessResolver(options({
    resolveModelAccess: async () => getterQuote,
    resolveAccountStatus: async () => { accountReads += 1; return account(); }
  }));
  await assert.rejects(getterQuoteResolver(ATTEMPT, "kling_4_omni", parameters("kling_4_omni", 0)));
  assert.equal(getterCalls, 0); assert.equal(accountReads, 0);

  const proxiedAccountResolver = budget.createOwnerKling4BudgetedModelAccessResolver(options({
    resolveModelAccess: async () => quote("kling_4_omni", expectedKeys("kling_4_omni")),
    resolveAccountStatus: async () => new Proxy(account(), {}) as AccountStatusResult
  }));
  await assert.rejects(proxiedAccountResolver(ATTEMPT, "kling_4_omni", parameters("kling_4_omni", 0)));

  const getterAccount = account();
  Object.defineProperty(getterAccount, "observed_at", { enumerable: true, get() { getterCalls += 1; return new Date(NOW).toISOString(); } });
  const getterAccountResolver = budget.createOwnerKling4BudgetedModelAccessResolver(options({
    resolveModelAccess: async () => quote("kling_4_omni", expectedKeys("kling_4_omni")),
    resolveAccountStatus: async () => getterAccount
  }));
  await assert.rejects(getterAccountResolver(ATTEMPT, "kling_4_omni", parameters("kling_4_omni", 0)));
  assert.equal(getterCalls, 0);
});
