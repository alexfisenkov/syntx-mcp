import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../src/adapter/syntx/account-decoder.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import type { AccountStatusResult } from "../src/application/account-status.js";
import type { ModelAccessResult } from "../src/application/model-access.js";
import type { SyntxCostParameter } from "../src/adapter/syntx/http-client.js";
const VERSION = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json";
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(VERSION, resolve(process.cwd(), "catalog")));
const NOW = Date.parse("2026-10-17T16:00:00.000Z"), ATTEMPT = "link_wan27_edit_budget_2169";
type Cost = Readonly<Record<string, SyntxCostParameter>>;
type Resolver = (attempt: string, model: string, parameters: Cost, signal?: AbortSignal) => Promise<ModelAccessResult>;
type Options = { catalog: DiscoveryCatalogRepository; now: () => number;
  resolveAccountStatus: () => Promise<AccountStatusResult>; resolveModelAccess: Resolver };
async function factory(): Promise<(options: Options) => Resolver> {
  let module: { createOwnerWan27VideoEditBudgetedModelAccessResolver?: (o: Options) => Resolver } = {};
  try { module = await import(new URL("../src/application/owner-wan27-videoedit-budget-preflight.js", import.meta.url).href); }
  catch (error) { if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ERR_MODULE_NOT_FOUND") throw error; }
  assert.equal(typeof module.createOwnerWan27VideoEditBudgetedModelAccessResolver, "function", "new exact budget module must exist");
  return module.createOwnerWan27VideoEditBudgetedModelAccessResolver!;
}
function account(available = "0.2"): AccountStatusResult { return {
  balance: { unit: "tokens", available }, subscription: { active: true, plan_type: "PAID", end_date: null, end_date_kind: null },
  contract_evidence: ACCOUNT_CONTRACT_EVIDENCE, source_build: ACCOUNT_SOURCE_BUILD, observed_at: new Date(NOW).toISOString()
}; }
function quote(patch: Partial<ModelAccessResult> = {}): ModelAccessResult { return {
  catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT", catalog_version: `${CATALOG.fetched_at}.${CATALOG.source_hashes.models.slice(7,19)}`,
  model_id: "wan_27_videoedit", ai_name: "wan_video", model_type: "wan_27_videoedit", account_read_live: true,
  parameter_keys: ["duration", "resolution", "video_duration"], parameters_redacted: true, access: true,
  cost: 0.2, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false,
  observed_at: new Date(NOW).toISOString(), ...patch
}; }
function options(patch: Partial<Options> = {}): Options { return { catalog: CATALOG, now: () => NOW,
  resolveAccountStatus: async () => account(), resolveModelAccess: async () => quote(), ...patch }; }
const COST = Object.freeze({ resolution: "720P", video_duration: 4.25, duration: 4.25 });
test("2169 exact WAN cost preserves fractional seconds and compares decimal affordability without float rounding", async () => {
  const create = await factory(); let supplied: Cost | undefined;
  const budget = create(options({ resolveModelAccess: async (_id, _model, parameters) => { supplied = parameters; return quote(); } }));
  assert.equal((await budget(ATTEMPT, "wan_27_videoedit", COST)).model_id, "wan_27_videoedit");
  assert.deepEqual({ ...supplied }, COST);
  await assert.rejects(create(options({ resolveAccountStatus: async () => account("0.199999999999999999999") }))(ATTEMPT, "wan_27_videoedit", COST));
  const discount = create(options({ resolveAccountStatus: async () => account("0.1"), resolveModelAccess: async () => quote({ cost: 5, discount_cost: 0.1 }) }));
  assert.equal((await discount(ATTEMPT, "wan_27_videoedit", COST)).discount_cost, 0.1);
});
test("2169 wrong tuple, extra keys and non-source durations fail before account or quote reads", async () => {
  const create = await factory(); let reads = 0;
  const budget = create(options({ resolveModelAccess: async () => { reads++; return quote(); }, resolveAccountStatus: async () => { reads++; return account(); } }));
  await assert.rejects(budget(ATTEMPT, "wan_27_r2v", COST));
  for (const value of [{ ...COST, mode: "hd" }, { ...COST, resolution: "480P" }, { ...COST, duration: "4.25" },
    { ...COST, duration: 10.01 }, { ...COST, video_duration: 1.99 }, { ...COST, video_duration: Number.NaN },
    { ...COST, video_duration: 5 }, { ...COST, video_duration: 2.37 }, new Proxy(COST, {})]) await assert.rejects(budget(ATTEMPT, "wan_27_videoedit", value));
  assert.equal(reads, 0);
});
test("2169 missing, stale, foreign and denied evidence cannot authorize a quote", async () => {
  const create = await factory();
  for (const bad of [quote({ cost: null }), quote({ cost: Number.NaN }), quote({ discount_cost: Number.POSITIVE_INFINITY }),
    quote({ access: false }), quote({ model_type: "wan_30_edit" }), quote({ ai_name: "kling" }),
    quote({ observed_at: new Date(NOW - 300001).toISOString() }), quote({ parameter_keys: ["video_duration"] })]) {
    await assert.rejects(create(options({ resolveModelAccess: async () => bad }))(ATTEMPT, "wan_27_videoedit", COST));
  }
  await assert.rejects(create(options({ resolveAccountStatus: async () => ({ ...account(), observed_at: new Date(NOW + 300001).toISOString() }) }))(ATTEMPT, "wan_27_videoedit", COST));
});
