import assert from "node:assert/strict";
import test from "node:test";

const MODULE_URL = new URL("../src/application/owner-wan-t2i-parameters.js", import.meta.url).href;
const MODELS = ["wan_25_t2i_preview", "wan_26_t2i"] as const;
const RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"] as const;
const RESOLUTIONS = ["720P", "1080P"] as const;
const SEEDS = [null, 0, 2_147_483_647] as const;
type Model = typeof MODELS[number];
type Parameters = {
  aspect_ratio: typeof RATIOS[number]; resolution: typeof RESOLUTIONS[number]; batch_size: 1 | 2 | 3 | 4;
  prompt_extend: boolean; seed: typeof SEEDS[number]; color_palette: null; bbox_list: [];
};
type Intent = { model_id: Model; prompt: string; parameters: Parameters };
interface Api {
  readonly OWNER_WAN_T2I_MODELS: readonly Model[];
  readonly getOwnerWanT2iSourceParameters: () => {
    readonly models: readonly Record<string, unknown>[];
    readonly cost: Record<string, unknown>;
    readonly source_pins: {
      readonly model_row_hash_codec: string; readonly model_row_sha256: Readonly<Record<Model, string>>;
    };
    readonly dispatch_allowed: false; readonly effective_defaults: "UNKNOWN"; readonly backend_acceptance: "UNPROVEN";
  };
  readonly normalizeOwnerWanT2iParameters: (input: unknown) => {
    readonly status: string; readonly source_bound_intent: Intent;
    readonly source_projection_confidence: string; readonly cost_routing: { ai_name: string; model_type: string };
    readonly cost_inputs: { batch_size: number }; readonly cost_projection: string;
    readonly dispatch_allowed: false; readonly backend_acceptance: "UNPROVEN";
  };
  readonly OwnerWanT2iParametersError: new (...args: never[]) => Error & { readonly code: string };
}

async function loadApi(): Promise<Api> {
  let module: Record<string, unknown> | undefined;
  try { module = await import(MODULE_URL) as Record<string, unknown>; } catch { /* Expected RED before source module is added. */ }
  assert.equal(typeof module?.normalizeOwnerWanT2iParameters, "function", "MISSING_OWNER_WAN_T2I_PARAMETER_NORMALIZER");
  assert.equal(typeof module?.getOwnerWanT2iSourceParameters, "function", "MISSING_OWNER_WAN_T2I_SOURCE_PROFILE");
  return module as unknown as Api;
}

function intent(model_id: Model, overrides: Partial<Parameters> = {}, prompt = "A quiet red lighthouse above the sea"): Intent {
  return { model_id, prompt, parameters: { aspect_ratio: "1:1", resolution: "720P", batch_size: 1,
    prompt_extend: false, seed: null, color_palette: null, bbox_list: [], ...overrides } };
}

function invalid(api: Api, value: unknown): void {
  assert.throws(() => api.normalizeOwnerWanT2iParameters(value), (error: unknown) =>
    error instanceof api.OwnerWanT2iParametersError && error.code === "INVALID_PARAMETERS");
}

test("exports two separate exact WAN T2I source profiles without claiming dispatch or defaults", async () => {
  const api = await loadApi();
  const source = api.getOwnerWanT2iSourceParameters();
  assert.deepEqual(api.OWNER_WAN_T2I_MODELS, MODELS);
  const models = source.models as readonly Record<string, unknown>[];
  assert.deepEqual(models.map(({ model_id, ai_name, model_type }) => [model_id, ai_name, model_type]), [
    ["wan_25_t2i_preview", "wan_image", "wan_25_t2i_preview"], ["wan_26_t2i", "wan_image", "wan_26_t2i"]
  ]);
  assert.equal(models[0] === models[1], false);
  assert.deepEqual(models.map(({ aspect_ratio, resolution, reference_scope, public_file_count, uploadable, accepted_file_types,
    allowed_media_types, max_prompt_length }) =>
    [aspect_ratio, resolution, reference_scope, public_file_count, uploadable, accepted_file_types, allowed_media_types, max_prompt_length]), [
    [RATIOS, RESOLUTIONS, "ZERO_REFERENCE_ONLY", 0, false, [], [], 1500],
    [RATIOS, RESOLUTIONS, "ZERO_REFERENCE_ONLY", 0, false, [], [], 1500]
  ]);
  assert.deepEqual(source.cost, {
    declared_get_cost_params: ["size", "batch_size"], cost_inputs: ["batch_size"],
    size: "OMITTED_NO_CONTROLLED_SIZE_OR_RESOLUTION_ALIAS", quote_billing_units_hard_cap: "UNPROVEN"
  });
  assert.deepEqual(source.source_pins.model_row_sha256, {
    wan_25_t2i_preview: "85dd8513cc1fb51429fef15454ec7959935284734cbb4d0f58c7feb7e046883a",
    wan_26_t2i: "44ab97682526f0564452a190742c059754a16427e5b09ce5c4736d79e2000f6e"
  });
  assert.equal(source.source_pins.model_row_hash_codec, "SHA256_JSON_STRINGIFY_EXACT_RAW_PUBLIC_RECORD");
  assert.equal(source.dispatch_allowed, false);
  assert.equal(source.effective_defaults, "UNKNOWN");
  assert.equal(source.backend_acceptance, "UNPROVEN");
  assert.equal(Object.isFrozen(source), true);
  assert.equal(Object.isFrozen(models), true);
});

test("normalizes all 80 ratio-resolution-batch states for both exact T2I models", async () => {
  const api = await loadApi();
  let cases = 0;
  for (const model_id of MODELS) for (const aspect_ratio of RATIOS) for (const resolution of RESOLUTIONS) {
    for (const batch_size of [1, 2, 3, 4] as const) {
      const prompt_extend = cases % 2 === 0;
      const seed = SEEDS[cases % SEEDS.length]!;
      const input = intent(model_id, { aspect_ratio, resolution, batch_size, prompt_extend, seed });
      const result = api.normalizeOwnerWanT2iParameters(input);
      assert.equal(result.status, "SOURCE_REVIEWED_CLIENT_INTENT");
      assert.deepEqual(result.source_bound_intent, input);
      assert.deepEqual(result.cost_routing, { ai_name: "wan_image", model_type: model_id });
      assert.deepEqual(result.cost_inputs, { batch_size });
      assert.equal(result.cost_projection, "SOURCE_COST_KEYS_SIZE_BATCH_SIZE_SIZE_OMITTED");
      assert.equal(result.source_projection_confidence, "EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY");
      assert.equal(result.dispatch_allowed, false);
      assert.equal(result.backend_acceptance, "UNPROVEN");
      assert.equal(Object.hasOwn(result.source_bound_intent, "model_type"), false);
      assert.equal(Object.hasOwn(result.source_bound_intent, "size"), false);
      assert.equal(Object.isFrozen(result), true);
      assert.equal(Object.isFrozen(result.source_bound_intent.parameters), true);
      cases += 1;
    }
  }
  assert.equal(cases, 80);
});

test("accepts every explicit seed boundary and both prompt-extend values without substituting defaults", async () => {
  const api = await loadApi();
  for (const model_id of MODELS) for (const seed of SEEDS) for (const prompt_extend of [false, true]) {
    const input = intent(model_id, { seed, prompt_extend, batch_size: 4, aspect_ratio: "16:9", resolution: "1080P" });
    assert.deepEqual(api.normalizeOwnerWanT2iParameters(input).source_bound_intent, input);
  }
});

test("rejects wrong model identities, open fields, missing required fixed inactive values and invalid enums", async () => {
  const api = await loadApi();
  const base = intent("wan_25_t2i_preview");
  for (const bad of [
    { ...base, model_id: "wan_26_image" },
    { ...base, model_type: "wan_25_t2i_preview" },
    { ...base, n: 1 }, { ...base, size: "720P" }, { ...base, version: "v1" },
    { ...base, file_urls: [] }, { ...base, image_urls: [] }, { ...base, reference_urls: [] },
    { ...base, prompt: "\t\r\n" }, { ...base, prompt: "x\u0001y" }, { ...base, prompt: "x\u0085y" },
    { ...base, parameters: { ...base.parameters, color_palette: undefined } },
    { ...base, parameters: { ...base.parameters, color_palette: [] } },
    { ...base, parameters: { ...base.parameters, bbox_list: undefined } },
    { ...base, parameters: { ...base.parameters, bbox_list: [[]] } },
    { ...base, parameters: { ...base.parameters, aspect_ratio: "2:3" } },
    { ...base, parameters: { ...base.parameters, resolution: "1K" } },
    { ...base, parameters: { ...base.parameters, batch_size: 0 } },
    { ...base, parameters: { ...base.parameters, batch_size: 5 } },
    { ...base, parameters: { ...base.parameters, seed: -1 } },
    { ...base, parameters: { ...base.parameters, seed: 1.5 } },
    { ...base, parameters: { ...base.parameters, seed: 2_147_483_648 } }
  ]) invalid(api, bad);
});

test("enforces the source UI prompt metric while preserving the exact valid input string", async () => {
  const api = await loadApi();
  const validWithLineFeed = "x".repeat(1_498) + "\n"; // UTF-16 length plus one extra LF unit is exactly 1,500.
  const normalized = api.normalizeOwnerWanT2iParameters(intent("wan_25_t2i_preview", {}, validWithLineFeed));
  assert.equal(normalized.source_bound_intent.prompt, validWithLineFeed);
  const validEmojiBoundary = "x".repeat(1_498) + "😀"; // Surrogate pair contributes two UTF-16 units.
  assert.equal(api.normalizeOwnerWanT2iParameters(intent("wan_26_t2i", {}, validEmojiBoundary)).source_bound_intent.prompt, validEmojiBoundary);
  const validTabCarriageReturn = "\tA\rB\nC";
  assert.equal(api.normalizeOwnerWanT2iParameters(intent("wan_25_t2i_preview", {}, validTabCarriageReturn)).source_bound_intent.prompt,
    validTabCarriageReturn);
  invalid(api, intent("wan_25_t2i_preview", {}, "x".repeat(1_501)));
  invalid(api, intent("wan_26_t2i", {}, "x".repeat(1_499) + "\n"));
  invalid(api, intent("wan_25_t2i_preview", {}, "x".repeat(1_499) + "😀"));
  invalid(api, intent("wan_25_t2i_preview", {}, "x\ud800"));
  invalid(api, intent("wan_26_t2i", {}, "\udc00x"));
});

test("rejects accessors, inherited input objects, and proxies without invoking user code", async () => {
  const api = await loadApi();
  let getterCalls = 0;
  const withGetter = intent("wan_25_t2i_preview");
  Object.defineProperty(withGetter, "prompt", { enumerable: true, get() { getterCalls += 1; return "unsafe"; } });
  invalid(api, withGetter);
  assert.equal(getterCalls, 0);
  invalid(api, Object.assign(Object.create({ inherited: true }) as object, intent("wan_25_t2i_preview")));
  let proxyReads = 0;
  const proxied = new Proxy(intent("wan_25_t2i_preview"), { get() { proxyReads += 1; throw new Error("must not run"); } });
  invalid(api, proxied);
  assert.equal(proxyReads, 0);
});
