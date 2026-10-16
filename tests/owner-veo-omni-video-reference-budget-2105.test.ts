import assert from "node:assert/strict";
import test from "node:test";
import * as budget from "../src/application/owner-veo-omni-t2v-budget-preflight.js";
import { createOwnerVeoOmniT2vProfile } from "../src/application/owner-veo-omni-t2v-profile.js";
import type { ModelAccessResult } from "../src/application/model-access.js";
import type { AccountStatusResult } from "../src/application/account-status.js";

const NOW = Date.parse("2026-10-17T03:00:00.000Z");
const ATTEMPT = "link_omni_video_reference_budget_2105";
const CATALOG = createOwnerVeoOmniT2vProfile("catalog").catalog;
const PARAMS = Object.freeze({ upscale: 3, video_duration: 4, mode: "video_ref" });

function quote(overrides: Partial<ModelAccessResult> = {}): ModelAccessResult {
  return {
    catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
    catalog_version: `${CATALOG.fetched_at}.${CATALOG.source_hashes.models.slice(7, 19)}`,
    model_id: "veo_omni", ai_name: "veo3", model_type: "veo_omni",
    account_read_live: true, parameter_keys: ["mode", "upscale", "video_duration"],
    parameters_redacted: true, access: true, cost: 1e-7, discount_cost: null,
    free_remaining_generations: null, limit: null, show_warning: false,
    observed_at: new Date(NOW).toISOString(), ...overrides
  };
}
function account(available = "0.0000001"): AccountStatusResult {
  return { balance: { unit: "tokens", available },
    subscription: { active: true, plan_type: "PAID", end_date: null, end_date_kind: null },
    contract_evidence: "PUBLIC_FRONTEND_OBSERVED", source_build: "1789134564",
    observed_at: new Date(NOW).toISOString() };
}
function videoFactory(): (options: budget.OwnerVeoOmniT2vBudgetPreflightOptions) => budget.OwnerVeoOmniT2vModelAccessResolver {
  const factory = (budget as unknown as Record<string, unknown>).createOwnerVeoOmniVideoReferenceBudgetedModelAccessResolver;
  assert.equal(typeof factory, "function", "Separate source-bound video-reference cost factory is missing");
  return factory as (options: budget.OwnerVeoOmniT2vBudgetPreflightOptions) => budget.OwnerVeoOmniT2vModelAccessResolver;
}

test("Omni video-reference guard sends all three exact cost keys and keeps the quoted mode key", async () => {
  const resolver = videoFactory()({ catalog: CATALOG, now: () => NOW,
    resolveModelAccess: async (attemptId, modelId, params) => {
      assert.equal(attemptId, ATTEMPT);
      assert.equal(modelId, "veo_omni");
      assert.deepEqual(params, { upscale: 3, video_duration: 4, mode: "video_ref" });
      return quote();
    }, resolveAccountStatus: async () => account() });
  const result = await resolver(ATTEMPT, "veo_omni", PARAMS);
  assert.deepEqual(result.parameter_keys, ["mode", "upscale", "video_duration"]);
  assert.equal(result.cost, 1e-7);
});

test("Omni video-reference guard refuses incomplete, different or caller-extended cost modes before I/O", async () => {
  let reads = 0;
  let modeGetterCalls = 0;
  const resolver = videoFactory()({ catalog: CATALOG, now: () => NOW,
    resolveModelAccess: async () => { reads += 1; return quote(); },
    resolveAccountStatus: async () => { reads += 1; return account(); } });
  for (const params of [
    { upscale: 3, video_duration: 4 },
    { upscale: 3, video_duration: 4, mode: "text" },
    { upscale: 3, video_duration: 4, mode: "video_ref", n: 1 },
    { upscale: 3, video_duration: 4, mode: null },
    Object.defineProperty({ upscale: 3, video_duration: 4 }, "mode", { enumerable: true, get() { modeGetterCalls += 1; return "video_ref"; } })
  ]) await assert.rejects(resolver(ATTEMPT, "veo_omni", params as Record<string, string | number | boolean>));
  assert.equal(reads, 0);
  assert.equal(modeGetterCalls, 0);
});

test("Omni video-reference quote remains fail-closed for wrong parameter binding and insufficient exact balance", async () => {
  const make = (value: ModelAccessResult, available: string) => videoFactory()({
    catalog: CATALOG, now: () => NOW, resolveModelAccess: async () => value,
    resolveAccountStatus: async () => account(available)
  });
  await assert.rejects(make(quote({ parameter_keys: ["upscale", "video_duration"] }), "1")(ATTEMPT, "veo_omni", PARAMS));
  await assert.rejects(make(quote({ cost: null, discount_cost: null }), "1")(ATTEMPT, "veo_omni", PARAMS));
  await assert.rejects(make(quote(), "0.00000009999999999999")(ATTEMPT, "veo_omni", PARAMS));
});

test("Original Omni T2V guard never accepts the video-reference mode even with affordable quote", async () => {
  let reads = 0;
  const resolver = budget.createOwnerVeoOmniT2vBudgetedModelAccessResolver({ catalog: CATALOG, now: () => NOW,
    resolveModelAccess: async () => { reads += 1; return quote(); },
    resolveAccountStatus: async () => { reads += 1; return account(); } });
  await assert.rejects(resolver(ATTEMPT, "veo_omni", PARAMS));
  assert.equal(reads, 0);
});
