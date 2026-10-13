import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL("../src/application/owner-soul-image-cost-parameters.js", import.meta.url).href;

test("projects one explicit Soul intent into separate routing and exactly three read-only model-info keys", async () => {
  let module: Record<string, unknown> | null = null;
  try { module = await import(moduleUrl) as Record<string, unknown>; } catch { /* expected first RED until projector exists */ }
  assert.equal(typeof module?.projectOwnerSoulImageCostParameters, "function", "MISSING_OWNER_SOUL_IMAGE_COST_PROJECTOR");
  const project = module!.projectOwnerSoulImageCostParameters as (input: unknown) => Record<string, any>;
  const result = project({ prompt: "Explicit Soul cost projection", quality: "720p", resolution: "2048x1152",
    batch_size: 1, enhance_prompt: true, seed: null, style: { kind: "none" }, character: { kind: "none" } });
  assert.equal(result.model_id, "higgsfield-soul");
  assert.deepEqual(result.routing, { ai_name: "higgsfield-soul", model_type: "higgsfield-soul" });
  assert.deepEqual(result.cost_inputs, { quality: "720p", resolution: "2048x1152", batch_size: 1 });
  assert.equal(Object.hasOwn(result.cost_inputs, "version"), false);
  assert.equal(result.cost_inputs_confidence, "SOURCE_JOINED_COST2_QUERY_FIELDS_NOT_QUOTE_BILLING_OR_HARDCAP");
  assert.equal(result.source_binding.public_catalog_version,
    "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json");
  assert.equal(result.source_binding.full_public_model_record_sha256,
    "sha256:16da8ea2298f05143e9992197536d63830a9359428312e2c635287d8f152fa22");
  assert.deepEqual(result.source_binding.projected_model_info_keys, ["quality", "resolution", "batch_size"]);
  assert.deepEqual(result.source_binding.declared_model_info_keys, ["quality", "resolution", "batch_size", "version"]);
  assert.equal(result.source_binding.generation_wire_bound, false);
  assert.equal(result.dispatch_allowed, false);
  assert.equal(result.runtime_activation, false);
  assert.equal(result.backend_acceptance, "UNPROVEN");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.cost_inputs), true);
});

test("all 14 pairs and batch branches validate full style/Character intent but project only query fields", async () => {
  const module = await import(moduleUrl) as Record<string, unknown>;
  const project = module.projectOwnerSoulImageCostParameters as (input: unknown) => Record<string, any>;
  const styleHandle = "soul_style_00000000-0000-4000-8000-000000000001";
  const characterHandle = "soul_character_00000000-0000-4000-8000-000000000002";
  let count = 0;
  for (const [quality, resolutions] of Object.entries({
    "720p": ["2048x1152", "1680x1120", "1536x1152", "1536x1536", "1152x1536", "1120x1680", "1152x2048"],
    "1080p": ["2048x1152", "2016x1344", "2048x1536", "1536x1536", "1536x2048", "1344x2016", "1152x2048"]
  } as const)) {
    for (const resolution of resolutions) for (const batch_size of [1, 4] as const) {
      for (const style of [{ kind: "none" }, { kind: "selected", style_handle: styleHandle, strength: 0.7 }] as const) {
        for (const character of [{ kind: "none" }, { kind: "selected", character_handle: characterHandle }] as const) {
          const prompt = `literal-${quality}-${resolution}-${batch_size}`;
          const seed = batch_size === 1 ? null : batch_size === 4 ? 2_147_483_647 : 0;
          const enhance_prompt = batch_size % 2 === 0;
          const result = project({ prompt, quality, resolution, batch_size, enhance_prompt, seed, style, character });
          assert.deepEqual(result.routing, { ai_name: "higgsfield-soul", model_type: "higgsfield-soul" });
          assert.deepEqual(result.cost_inputs, { quality, resolution, batch_size });
          assert.deepEqual(Object.keys(result.cost_inputs), ["quality", "resolution", "batch_size"]);
          assert.equal(JSON.stringify(result).includes(prompt), false);
          assert.equal(JSON.stringify(result).includes(styleHandle), false);
          assert.equal(JSON.stringify(result).includes(characterHandle), false);
          assert.equal(result.dispatch_allowed, false);
          count += 1;
        }
      }
    }
  }
  assert.equal(count, 112);
});

test("rejects cross-pairs, unknown cost/version/model overrides, raw IDs, nonfinite values, proxies, and getters", async () => {
  const module = await import(moduleUrl) as Record<string, unknown>;
  const project = module.projectOwnerSoulImageCostParameters as (input: unknown) => Record<string, any>;
  const base = { prompt: "valid explicit prompt", quality: "720p", resolution: "2048x1152", batch_size: 1,
    enhance_prompt: false, seed: null, style: { kind: "none" }, character: { kind: "none" } };
  const invalid = [
    { ...base, quality: "720p", resolution: "2016x1344" },
    { ...base, quality: "1080p", resolution: "1680x1120" },
    { ...base, version: "v1" },
    { ...base, cost_inputs: { quality: "720p" } },
    { ...base, model_id: "higgsfield-soul" },
    { ...base, model_type: "higgsfield-soul" },
    { ...base, ai_name: "higgsfield-soul" },
    { ...base, source_profile_hash: `sha256:${"a".repeat(64)}` },
    { ...base, reference_strength: 0.7 },
    { ...base, raw: true },
    { ...base, file_urls: [] },
    { ...base, seed: Number.POSITIVE_INFINITY },
    { ...base, style: { kind: "selected", style_handle: "raw-style-id", strength: 0.7 } },
    { ...base, character: { kind: "selected", character_handle: "raw-character-id" } },
    { ...base, style: { kind: "selected", style_handle: "soul_style_00000000-0000-4000-8000-000000000001", strength: 0.15 } }
  ];
  for (const input of invalid) assert.throws(() => project(input));
  assert.throws(() => project(new Proxy(base, { getPrototypeOf() { throw new Error("must not invoke proxy trap"); } })));

  let getterCalls = 0;
  const accessor = Object.defineProperties({}, {
    prompt: { enumerable: true, get() { getterCalls += 1; throw new Error("must not invoke input getter"); } },
    quality: { value: "720p", enumerable: true }, resolution: { value: "2048x1152", enumerable: true },
    batch_size: { value: 1, enumerable: true }, enhance_prompt: { value: true, enumerable: true }, seed: { value: null, enumerable: true },
    style: { value: { kind: "none" }, enumerable: true }, character: { value: { kind: "none" }, enumerable: true }
  });
  assert.throws(() => project(accessor));
  assert.equal(getterCalls, 0);
});
