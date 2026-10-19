import assert from "node:assert/strict";
import test from "node:test";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../src/adapter/syntx/account-decoder.js";
import { evaluateOwnerGrokI2vBudget } from "../src/application/owner-grok-i2v-budget.js";

const NOW = Date.parse("2026-10-19T08:00:00.000Z");
const OBSERVED = "2026-10-19T07:59:59.000Z";
const CATALOG_VERSION = "2026-10-19T07:59:00.000Z.0123456789ab";
function fixture(model_id: "grok_i2v" | "grok_15_i2v" = "grok_i2v") {
  return {
    expected_catalog_version: CATALOG_VERSION,
    now: NOW,
    model_id,
    cost_parameters: { resolution: "480p", video_duration: model_id === "grok_i2v" ? 6 : 1 },
    access: {
      catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
      catalog_version: CATALOG_VERSION,
      model_id,
      ai_name: "grok_video",
      model_type: model_id,
      account_read_live: true,
      parameter_keys: ["resolution", "video_duration"],
      parameters_redacted: true,
      access: true,
      cost: 4.5 as number | null,
      discount_cost: null as number | null,
      free_remaining_generations: null,
      limit: null,
      show_warning: null,
      observed_at: OBSERVED
    },
    account: {
      balance: { unit: "tokens", available: "4.50" },
      subscription: { active: true, plan_type: "synthetic", end_date: null, end_date_kind: null },
      contract_evidence: ACCOUNT_CONTRACT_EVIDENCE,
      source_build: ACCOUNT_SOURCE_BUILD,
      observed_at: OBSERVED
    }
  };
}

test("2280 accepts fresh exact-model affordable quotes for both IDs without imposing a price cap", () => {
  for (const model_id of ["grok_i2v", "grok_15_i2v"] as const) {
    const result = evaluateOwnerGrokI2vBudget(fixture(model_id));
    assert.deepEqual(result, { status: "FRESH_AND_AFFORDABLE_QUOTE_ONLY", model_id, selected_price: 4.5,
      cost_cap_enforced: false, dispatch_allowed: false, backend_acceptance: "UNPROVEN" });
    assert.equal(Object.isFrozen(result), true);
  }
  const large = fixture(); large.access.cost = 250_000; large.account.balance.available = "250000";
  assert.equal(evaluateOwnerGrokI2vBudget(large).selected_price, 250_000);
});

test("2280 fails closed on wrong model, route, quote keys, cost projection or unaffordable balance", () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.model_id = "grok_15_i2v"; },
    (f: ReturnType<typeof fixture>) => { f.access.model_id = "grok_15_i2v"; },
    (f: ReturnType<typeof fixture>) => { Object.assign(f.access, { model_type: "grok_v2v" }); },
    (f: ReturnType<typeof fixture>) => { f.access.ai_name = "grok_image"; },
    (f: ReturnType<typeof fixture>) => { f.access.parameter_keys = ["video_duration", "resolution"]; },
    (f: ReturnType<typeof fixture>) => { f.access.parameter_keys = ["resolution"]; },
    (f: ReturnType<typeof fixture>) => { f.access.access = false; },
    (f: ReturnType<typeof fixture>) => { f.access.cost = null; f.access.discount_cost = null; },
    (f: ReturnType<typeof fixture>) => { f.cost_parameters.video_duration = 8; },
    (f: ReturnType<typeof fixture>) => { f.account.balance.available = "4.49999999999999999999"; },
    (f: ReturnType<typeof fixture>) => { Object.assign(f.cost_parameters, { prompt: "unexpected" }); }
  ]) assert.throws(() => evaluateOwnerGrokI2vBudget((() => { const f = fixture(); mutate(f); return f; })()));
});

test("2280 rejects stale/future snapshots, malformed balance, accessors, and proxies", () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.access.observed_at = "2026-10-19T07:54:59.999Z"; },
    (f: ReturnType<typeof fixture>) => { f.account.observed_at = "2026-10-19T08:00:00.001Z"; },
    (f: ReturnType<typeof fixture>) => { f.now = Number.NaN; },
    (f: ReturnType<typeof fixture>) => { f.account.balance.available = "Infinity"; }
  ]) assert.throws(() => evaluateOwnerGrokI2vBudget((() => { const f = fixture(); mutate(f); return f; })()));
  let getterCalls = 0;
  const f = fixture();
  Object.defineProperty(f.access, "cost", { enumerable: true, get() { getterCalls += 1; return 0; } });
  assert.throws(() => evaluateOwnerGrokI2vBudget(f)); assert.equal(getterCalls, 0);
  assert.throws(() => evaluateOwnerGrokI2vBudget(new Proxy(fixture(), {})));
});
