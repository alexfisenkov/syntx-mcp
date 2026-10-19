import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../src/adapter/syntx/account-decoder.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import {
  buildOwnerRunwayI2vCostParameters,
  loadOwnerRunwayI2vRuntimeCatalog
} from "../src/application/owner-runway-i2v-cost.js";
import { evaluateOwnerRunwayI2vBudget } from "../src/application/owner-runway-i2v-budget.js";

const CATALOG_DIRECTORY = join(process.cwd(), "catalog");
const ARCHIVE_VERSION = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json";
const MODEL_IDS = ["4genfirstframeimage", "turbo4genfirstframeimage"] as const;
const NOW = Date.parse("2026-10-18T03:00:00.000Z");
const OBSERVED = "2026-10-18T02:59:59.000Z";
const CATALOG_VERSION = "2026-10-18T02:59:00.000Z.0123456789ab";

test("loads the Editor-pinned immutable archive and binds both Runway IDs to the exact cost key", () => {
  const before = statSync(join(CATALOG_DIRECTORY, "public", ARCHIVE_VERSION));
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = (async () => { networkCalls += 1; throw new Error("network forbidden"); }) as typeof fetch;
  try {
    const runtime = loadOwnerRunwayI2vRuntimeCatalog(CATALOG_DIRECTORY);
    assert.ok(runtime.catalog instanceof DiscoveryCatalogRepository);
    assert.equal(runtime.catalog_version, ARCHIVE_VERSION);
    assert.deepEqual(runtime.cost_bindings, MODEL_IDS.map(model_id => ({
      model_id, model_type: model_id, ai_name: "runway", form_id: "runway", scope: "video", cost_keys: ["video_duration"]
    })));
    for (const id of MODEL_IDS) {
      const model = runtime.catalog.get(id);
      assert.equal(model.active, true);
      assert.equal(model.ai_name, "runway");
      assert.deepEqual(model.settings?.get_cost_params, ["video_duration"]);
    }
    const snapshot = loadPublicCatalogVersion(ARCHIVE_VERSION, CATALOG_DIRECTORY);
    const runwayAi = snapshot.ai.find(ai => ai.value === "runway");
    assert.equal(runwayAi?.active, true);
    assert.equal(runwayAi?.scope, "video");
    assert.equal(networkCalls, 0);
    assert.equal(Object.isFrozen(runtime), true);
    assert.equal(Object.isFrozen(runtime.cost_bindings), true);
    assert.equal(runtime.cost_bindings.every(binding => Object.isFrozen(binding) && Object.isFrozen(binding.cost_keys)), true);
  } finally { globalThis.fetch = originalFetch; }
  const after = statSync(join(CATALOG_DIRECTORY, "public", ARCHIVE_VERSION));
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs);
});

test("projects only the source-proven string video_duration cost parameter for both exact model IDs", () => {
  for (const model_id of MODEL_IDS) {
    assert.deepEqual(buildOwnerRunwayI2vCostParameters({ model_id, video_duration: 5 }), { video_duration: "5.0" });
    assert.deepEqual(buildOwnerRunwayI2vCostParameters({ model_id, video_duration: 10 }), { video_duration: "10.0" });
    assert.deepEqual(Object.keys(buildOwnerRunwayI2vCostParameters({ model_id, video_duration: 5 })), ["video_duration"]);
  }
  for (const invalid of [
    { model_id: "gen4.5i2v", video_duration: 5 }, { model_id: MODEL_IDS[0], video_duration: 8 },
    { model_id: MODEL_IDS[0], video_duration: "5.0" }, { model_id: MODEL_IDS[0], video_duration: 5, prompt: "unexpected" }
  ]) assert.throws(() => buildOwnerRunwayI2vCostParameters(invalid as never));
});

function fixture(model_id: typeof MODEL_IDS[number] = MODEL_IDS[0]) {
  return {
    expected_catalog_version: CATALOG_VERSION,
    now: NOW,
    model_id,
    cost_parameters: { video_duration: "5.0" },
    access: {
      catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
      catalog_version: CATALOG_VERSION,
      model_id,
      ai_name: "runway",
      model_type: model_id,
      account_read_live: true,
      parameter_keys: ["video_duration"],
      parameters_redacted: true,
      access: true,
      cost: 1.25 as number | null,
      discount_cost: null as number | null,
      free_remaining_generations: null,
      limit: null,
      show_warning: null,
      observed_at: OBSERVED
    },
    account: {
      balance: { unit: "tokens", available: "1.25" },
      subscription: { active: true, plan_type: "synthetic", end_date: null, end_date_kind: null },
      contract_evidence: ACCOUNT_CONTRACT_EVIDENCE,
      source_build: ACCOUNT_SOURCE_BUILD,
      observed_at: OBSERVED
    }
  };
}

test("budget accepts a fresh exact-model affordable quote but never enforces a cost cap", () => {
  for (const model_id of MODEL_IDS) {
    const result = evaluateOwnerRunwayI2vBudget(fixture(model_id));
    assert.deepEqual(result, { status: "FRESH_AND_AFFORDABLE_QUOTE_ONLY", model_id, selected_price: 1.25,
      cost_cap_enforced: false, dispatch_allowed: false });
    assert.equal(Object.isFrozen(result), true);
  }
  const free = fixture(); free.access.discount_cost = 0; free.account.balance.available = "0";
  assert.equal(evaluateOwnerRunwayI2vBudget(free).selected_price, 0);
});

test("budget fails closed on wrong model/catalog/cost keys, denied access, or unaffordable balance", () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.model_id = "turbo4genfirstframeimage"; },
    (f: ReturnType<typeof fixture>) => { f.expected_catalog_version = "wrong"; },
    (f: ReturnType<typeof fixture>) => { f.access.catalog_version = "wrong"; },
    (f: ReturnType<typeof fixture>) => { f.access.model_id = "turbo4genfirstframeimage"; },
    (f: ReturnType<typeof fixture>) => { Object.assign(f.access, { model_type: "runway_frames" }); },
    (f: ReturnType<typeof fixture>) => { f.access.ai_name = "other"; },
    (f: ReturnType<typeof fixture>) => { f.access.parameter_keys = ["prompt"]; },
    (f: ReturnType<typeof fixture>) => { Object.assign(f.cost_parameters, { prompt: "x" }); },
    (f: ReturnType<typeof fixture>) => { f.access.access = false; },
    (f: ReturnType<typeof fixture>) => { f.access.cost = null; f.access.discount_cost = null; },
    (f: ReturnType<typeof fixture>) => { f.account.balance.available = "1.24999999999999999999"; }
  ]) assert.throws(() => evaluateOwnerRunwayI2vBudget((() => { const f = fixture(); mutate(f); return f; })()));
});

test("budget rejects stale/future snapshots, malformed balance, getter records, and proxies without invoking getters", () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.access.observed_at = "2026-10-18T02:54:59.999Z"; },
    (f: ReturnType<typeof fixture>) => { f.account.observed_at = "2026-10-18T03:00:00.001Z"; },
    (f: ReturnType<typeof fixture>) => { f.now = Number.NaN; },
    (f: ReturnType<typeof fixture>) => { f.account.balance.available = "Infinity"; },
    (f: ReturnType<typeof fixture>) => { f.cost_parameters.video_duration = "8.0"; }
  ]) assert.throws(() => evaluateOwnerRunwayI2vBudget((() => { const f = fixture(); mutate(f); return f; })()));

  let getterCalls = 0;
  const f = fixture();
  Object.defineProperty(f.access, "cost", { enumerable: true, get() { getterCalls += 1; return 0; } });
  assert.throws(() => evaluateOwnerRunwayI2vBudget(f));
  assert.equal(getterCalls, 0);
  assert.throws(() => evaluateOwnerRunwayI2vBudget(new Proxy(fixture(), {})));
});
