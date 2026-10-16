import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { createOwnerVeoOmniT2vProfile } from "../src/application/owner-veo-omni-t2v-profile.js";
import {
  createOwnerVeoOmniT2vBudgetedModelAccessResolver,
  type OwnerVeoOmniT2vBudgetPreflightOptions
} from "../src/application/owner-veo-omni-t2v-budget-preflight.js";
import type { AccountStatusResult } from "../src/application/account-status.js";
import type { ModelAccessResult } from "../src/application/model-access.js";

const NOW = Date.parse("2026-10-17T02:00:00.000Z");
const ATTEMPT = "link_veo_omni_budget_attempt_0001";
const PROFILE = createOwnerVeoOmniT2vProfile(resolve(process.cwd(), "catalog"));
const COST_PARAMETERS = Object.freeze({ upscale: 2, video_duration: 10 });

function quote(overrides: Partial<ModelAccessResult> = {}): ModelAccessResult {
  return {
    catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
    catalog_version: `${PROFILE.catalog.fetched_at}.${PROFILE.catalog.source_hashes.models.slice(7, 19)}`,
    model_id: "veo_omni",
    ai_name: "veo3",
    model_type: "veo_omni",
    account_read_live: true,
    parameter_keys: ["upscale", "video_duration"],
    parameters_redacted: true,
    access: true,
    cost: 0.2,
    discount_cost: null,
    free_remaining_generations: null,
    limit: null,
    show_warning: false,
    observed_at: new Date(NOW).toISOString(),
    ...overrides
  };
}

function account(balance: string | null = "0.2", overrides: Partial<AccountStatusResult> = {}): AccountStatusResult {
  return {
    balance: { unit: "tokens", available: balance },
    subscription: { active: true, plan_type: "PAID", end_date: null, end_date_kind: null },
    contract_evidence: "PUBLIC_FRONTEND_OBSERVED",
    source_build: "1789134564",
    observed_at: new Date(NOW).toISOString(),
    ...overrides
  };
}

function options(overrides: Partial<OwnerVeoOmniT2vBudgetPreflightOptions> = {}): OwnerVeoOmniT2vBudgetPreflightOptions {
  return {
    catalog: PROFILE.catalog,
    now: () => NOW,
    resolveModelAccess: async () => quote(),
    resolveAccountStatus: async () => account(),
    ...overrides
  };
}

test("Omni budget resolver accepts an exact affordable scientific-notation boundary without losing decimal digits", async () => {
  let quoteCalls = 0;
  let accountCalls = 0;
  const resolver = createOwnerVeoOmniT2vBudgetedModelAccessResolver(options({
    resolveModelAccess: async (attemptId, modelId, costParameters) => {
      quoteCalls += 1;
      assert.equal(attemptId, ATTEMPT);
      assert.equal(modelId, "veo_omni");
      assert.deepEqual(costParameters, COST_PARAMETERS);
      return quote({ cost: 1e-7, discount_cost: null });
    },
    resolveAccountStatus: async (attemptId) => {
      accountCalls += 1;
      assert.equal(attemptId, ATTEMPT);
      return account("0.0000001");
    }
  }));

  const result = await resolver(ATTEMPT, "veo_omni", COST_PARAMETERS);
  assert.equal(result.access, true);
  assert.equal(quoteCalls, 1);
  assert.equal(accountCalls, 1);
});

test("Omni budget resolver fails closed for missing, nonfinite, stale, mismatched, or unaffordable evidence", async () => {
  const badQuotes: readonly [string, Partial<ModelAccessResult>][] = [
    ["null selected price", { cost: null, discount_cost: null }],
    ["NaN selected price", { cost: Number.NaN, discount_cost: null }],
    ["infinite selected price", { cost: Number.POSITIVE_INFINITY, discount_cost: null }],
    ["stale quote", { observed_at: new Date(NOW - 300_001).toISOString() }],
    ["foreign model", { model_id: "veo3", model_type: "veo3" }],
    ["foreign family", { ai_name: "veo2" }],
    ["wrong cost keys", { parameter_keys: ["upscale"] }],
    ["denied model", { access: false }]
  ];

  for (const [, invalidQuote] of badQuotes) {
    const resolver = createOwnerVeoOmniT2vBudgetedModelAccessResolver(options({
      resolveModelAccess: async () => quote(invalidQuote)
    }));
    await assert.rejects(resolver(ATTEMPT, "veo_omni", COST_PARAMETERS));
  }

  for (const [, invalidAccount] of [
    ["missing balance", account(null)],
    ["malformed balance", account("0.2x")],
    ["stale account", account("0.2", { observed_at: new Date(NOW - 300_001).toISOString() })],
    ["insufficient exact decimal balance", account("0.19999999999999999")]
  ] as const) {
    const resolver = createOwnerVeoOmniT2vBudgetedModelAccessResolver(options({
      resolveModelAccess: async () => quote({ cost: 0.2, discount_cost: null }),
      resolveAccountStatus: async () => invalidAccount
    }));
    await assert.rejects(resolver(ATTEMPT, "veo_omni", COST_PARAMETERS));
  }
});

test("Omni budget resolver selects discount price and requires both quote and account snapshots to be safely snapshotted", async () => {
  let accountReads = 0;
  const discounted = createOwnerVeoOmniT2vBudgetedModelAccessResolver(options({
    resolveModelAccess: async () => quote({ cost: 4, discount_cost: 0.1 }),
    resolveAccountStatus: async () => account("0.1")
  }));
  assert.equal((await discounted(ATTEMPT, "veo_omni", COST_PARAMETERS)).discount_cost, 0.1);

  const getterQuote = quote();
  Object.defineProperty(getterQuote, "cost", { enumerable: true, get: () => 0.2 });
  const guarded = createOwnerVeoOmniT2vBudgetedModelAccessResolver(options({
    resolveModelAccess: async () => getterQuote,
    resolveAccountStatus: async () => { accountReads += 1; return account(); }
  }));
  await assert.rejects(guarded(ATTEMPT, "veo_omni", COST_PARAMETERS));
  assert.equal(accountReads, 0);

  const proxiedQuote = createOwnerVeoOmniT2vBudgetedModelAccessResolver(options({
    resolveModelAccess: async () => new Proxy(quote(), {}) as ModelAccessResult,
    resolveAccountStatus: async () => { accountReads += 1; return account(); }
  }));
  await assert.rejects(proxiedQuote(ATTEMPT, "veo_omni", COST_PARAMETERS));
  assert.equal(accountReads, 0);

  const mutableQuote = quote({ cost: 0.2, discount_cost: null });
  const snapshotted = createOwnerVeoOmniT2vBudgetedModelAccessResolver(options({
    resolveModelAccess: async () => mutableQuote,
    resolveAccountStatus: async () => {
      Object.assign(mutableQuote, { cost: 100 });
      return account("0.2");
    }
  }));
  assert.equal((await snapshotted(ATTEMPT, "veo_omni", COST_PARAMETERS)).cost, 0.2);

  const proxiedAccount = createOwnerVeoOmniT2vBudgetedModelAccessResolver(options({
    resolveAccountStatus: async () => new Proxy(account(), {}) as AccountStatusResult
  }));
  await assert.rejects(proxiedAccount(ATTEMPT, "veo_omni", COST_PARAMETERS));
});

test("Omni budget resolver rejects a caller-supplied other model before reading the account", async () => {
  let accountReads = 0;
  const resolver = createOwnerVeoOmniT2vBudgetedModelAccessResolver(options({
    resolveAccountStatus: async () => { accountReads += 1; return account(); }
  }));
  await assert.rejects(resolver(ATTEMPT, "veo3", COST_PARAMETERS));
  assert.equal(accountReads, 0);
});
