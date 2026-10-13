import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOwnerWanT2iParameters, OwnerWanT2iParametersError } from "../src/application/owner-wan-t2i-parameters.js";

const costModuleUrl = new URL("../src/application/owner-wan-t2i-cost-parameters.js", import.meta.url).href;
const MODEL_IDS = ["wan_25_t2i_preview", "wan_26_t2i"] as const;
const ASPECT_RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"] as const;
const RESOLUTIONS = ["720P", "1080P"] as const;
const BATCH_SIZES = [1, 2, 3, 4] as const;

test("projects all 80 explicit WAN T2I combinations into the batch-size-only cost query", async () => {
  let costModule: Record<string, unknown> | null = null;
  try { costModule = await import(costModuleUrl) as Record<string, unknown>; }
  catch { /* Expected RED until the cost projector is implemented. */ }
  assert.equal(typeof costModule?.projectOwnerWanT2iCostParameters, "function", "MISSING_OWNER_WAN_T2I_COST_PROJECTOR");
  const project = costModule!.projectOwnerWanT2iCostParameters as (input: unknown) => Record<string, unknown>;

  for (const model_id of MODEL_IDS) {
    for (const aspect_ratio of ASPECT_RATIOS) {
      for (const resolution of RESOLUTIONS) {
        for (const batch_size of BATCH_SIZES) {
          const parameters = { aspect_ratio, resolution, batch_size, prompt_extend: batch_size % 2 === 0,
            seed: batch_size === 4 ? 2_147_483_647 : null, color_palette: null, bbox_list: [] };
          const input = { model_id, prompt: "explicit WAN T2I test prompt", parameters };
          const normalized = normalizeOwnerWanT2iParameters(input);
          const projection = project(input);

          assert.equal(normalized.source_bound_intent.model_id, model_id);
          assert.equal(projection.model_id, model_id);
          assert.deepEqual(projection.routing, { ai_name: "wan_image", model_type: model_id });
          assert.deepEqual(projection.cost_inputs, { batch_size });
          assert.deepEqual(Object.keys(projection.cost_inputs as Record<string, unknown>), ["batch_size"]);
          assert.deepEqual(projection.declared_model_info_keys, ["size", "batch_size"]);
          assert.deepEqual(projection.omitted_model_info_keys, ["size"]);
          assert.equal(Object.isFrozen(projection.declared_model_info_keys), true);
          assert.equal(Object.isFrozen(projection.omitted_model_info_keys), true);
          assert.equal(Object.hasOwn(projection.cost_inputs as Record<string, unknown>, "size"), false);
          assert.equal(projection.size_policy, "OMITTED_NO_CONTROLLED_SIZE_OR_RESOLUTION_ALIAS");
          assert.equal(projection.dispatch_allowed, false);
          assert.equal(projection.backend_acceptance, "UNPROVEN");
          assert.equal(projection.confidence, "SOURCE_JOINED_COST2_QUERY_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP");
        }
      }
    }
  }
});

test("keeps UTF-16-plus-LF prompt bounds and rejects non-source controls before projecting cost", async () => {
  const module = await import(costModuleUrl) as Record<string, unknown>;
  const project = module.projectOwnerWanT2iCostParameters as (input: unknown) => Record<string, unknown>;
  const base = { model_id: "wan_26_t2i", parameters: { aspect_ratio: "1:1", resolution: "720P", batch_size: 2,
    prompt_extend: true, seed: 0, color_palette: null, bbox_list: [] } };
  const promptAtLimit = `${"a".repeat(1_498)}\n`;
  const limitProjection = project({ ...base, prompt: promptAtLimit });
  assert.deepEqual(limitProjection.cost_inputs, { batch_size: 2 });
  assert.equal(Object.hasOwn(limitProjection, "prompt"), false);
  assert.equal(Object.hasOwn(limitProjection, "parameters"), false);

  const emojiProjection = project({ ...base, prompt: "😀".repeat(750) });
  assert.deepEqual(emojiProjection.cost_inputs, { batch_size: 2 });
  assert.throws(() => project({ ...base, prompt: "a".repeat(1_501) }), OwnerWanT2iParametersError);
  assert.throws(() => project({ ...base, prompt: "explicit prompt", model_type: "wan_25_t2i_preview" }), OwnerWanT2iParametersError);
  assert.throws(() => project({ ...base, prompt: "explicit prompt", parameters: { ...base.parameters, size: "720P" } }),
    OwnerWanT2iParametersError);
});
