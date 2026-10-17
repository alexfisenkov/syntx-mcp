import assert from "node:assert/strict";
import test from "node:test";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../src/adapter/syntx/account-decoder.js";
import { evaluateOwnerSeedanceEditorBudget } from "../src/application/owner-seedance-editor-budget.js";

const NOW = Date.parse("2026-10-17T03:00:00.000Z");
const OBSERVED = "2026-10-17T02:59:59.000Z";
const VERSION = "2026-10-16T08:51:59.507Z.92c31dba26eb";
const KEYS = ["duration", "mode", "resolution", "size", "video_duration"];
function fixture() {
  return {
    expected_catalog_version: VERSION, now: NOW,
    cost_parameters: { duration: "4.25", mode: "edit", resolution: "720p", size: "adaptive", video_duration: 0 },
    access: {
      catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT", catalog_version: VERSION,
      model_id: "seedance-2.5", ai_name: "seedance", model_type: "seedance-2.5",
      account_read_live: true, parameter_keys: [...KEYS], parameters_redacted: true,
      access: true, cost: 1.25, discount_cost: null as number | null,
      free_remaining_generations: null, limit: null, show_warning: null, observed_at: OBSERVED
    },
    account: {
      balance: { unit: "tokens", available: "1.25" },
      subscription: { active: true, plan_type: "synthetic", end_date: null, end_date_kind: null },
      contract_evidence: ACCOUNT_CONTRACT_EVIDENCE, source_build: ACCOUNT_SOURCE_BUILD, observed_at: OBSERVED
    }
  };
}

test("Editor budget accepts a fresh exact-model quote at the decimal balance boundary, not dispatch", () => {
  const value = evaluateOwnerSeedanceEditorBudget(fixture());
  assert.deepEqual(value, { status: "FRESH_AND_AFFORDABLE_QUOTE_ONLY", selected_price: 1.25,
    cost_cap_enforced: false, dispatch_allowed: false });
  assert.equal(Object.isFrozen(value), true);
  const free = fixture(); free.access.discount_cost = 0; free.account.balance.available = "0";
  assert.equal(evaluateOwnerSeedanceEditorBudget(free).selected_price, 0);
});

test("Editor budget rejects unknown, unaffordable or contradictory public model/access evidence", () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.access.cost = Number.NaN; },
    (f: ReturnType<typeof fixture>) => { f.access.access = false; },
    (f: ReturnType<typeof fixture>) => { f.access.catalog_version = "wrong-version"; },
    (f: ReturnType<typeof fixture>) => { f.access.model_id = "seedance-2.5-editor"; },
    (f: ReturnType<typeof fixture>) => { f.access.ai_name = "seedance-editor"; },
    (f: ReturnType<typeof fixture>) => { f.access.parameter_keys = ["resolution"]; },
    (f: ReturnType<typeof fixture>) => { f.account.balance.available = "1.24999999999999999999"; },
    (f: ReturnType<typeof fixture>) => { f.access.cost = 0.30000000000000004; f.account.balance.available = "0.3"; }
  ]) { const f = fixture(); mutate(f); assert.throws(() => evaluateOwnerSeedanceEditorBudget(f)); }
  const missing = fixture(); (missing.access as unknown as { cost: unknown }).cost = null;
  assert.throws(() => evaluateOwnerSeedanceEditorBudget(missing));
});

test("Editor budget rejects stale/future clocks, malformed balances and unbound setting selectors", () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.access.observed_at = "2026-10-17T02:54:59.999Z"; },
    (f: ReturnType<typeof fixture>) => { f.account.observed_at = "2026-10-17T03:00:00.001Z"; },
    (f: ReturnType<typeof fixture>) => { f.now = Number.NaN; },
    (f: ReturnType<typeof fixture>) => { f.account.balance.available = "Infinity"; },
    (f: ReturnType<typeof fixture>) => { f.cost_parameters.mode = "mini"; },
    (f: ReturnType<typeof fixture>) => { f.cost_parameters.duration = "3.99"; },
    (f: ReturnType<typeof fixture>) => { f.cost_parameters.duration = "30.01"; },
    (f: ReturnType<typeof fixture>) => { f.cost_parameters.video_duration = 5; }
  ]) { const f = fixture(); mutate(f); assert.throws(() => evaluateOwnerSeedanceEditorBudget(f)); }
});

test("Editor budget never invokes getters or accepts proxies as trusted snapshots", () => {
  let calls = 0;
  const f = fixture(); Object.defineProperty(f.access, "cost", { enumerable: true, get() { calls++; return 0; } });
  assert.throws(() => evaluateOwnerSeedanceEditorBudget(f));
  assert.equal(calls, 0);
  assert.throws(() => evaluateOwnerSeedanceEditorBudget(new Proxy(fixture(), {})));
});
