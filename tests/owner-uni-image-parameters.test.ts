import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerUniImageSourceParameters,
  normalizeOwnerUniImageParameters
} from "../src/application/owner-uni-image-parameters.js";

test("normalizes explicit Uni-1 settings without injecting defaults or rewriting prompt/seed", () => {
  const parameters = getOwnerUniImageSourceParameters();
  assert.deepEqual(parameters.models, ["uni-1", "uni-1.1-modify-image", "uni-1.1-remove-background"]);
  assert.deepEqual(parameters.controls.aspect_ratio.values, ["3:1", "2:1", "16:9", "3:2", "1:1", "4:3", "2:3", "3:4", "9:16", "1:2", "1:3"]);
  assert.deepEqual(parameters.controls.mode.values, ["auto", "manga"]);

  const prompt = "  keep this\nexactly  ";
  const result = normalizeOwnerUniImageParameters({
    variant: "uni-1",
    prompt,
    parameters: { aspect_ratio: "1:1", seed: null, mode: "auto" },
    image_reference_handles: [],
    main_image_reference_handle: null
  });
  assert.equal(result.prompt, prompt);
  assert.deepEqual(result.parameters, { aspect_ratio: "1:1", seed: null, mode: "auto" });
  assert.deepEqual(result.custom_settings, { model_type: "uni-1", aspect_ratio: "1:1", seed: null, mode: "auto" });
  assert.deepEqual(result.cost_inputs, {});
  assert.deepEqual(result.cost_routing.declared_parameter_keys, ["model_type"]);
  assert.equal(result.cost_routing.ai_name, "luma_image");
  assert.equal(result.cost_routing.model_type, "uni-1");
  assert.equal(result.dispatch_allowed, false);
  assert.equal(result.backend_acceptance, "UNPROVEN");
});

test("accepts every Auto and Manga ratio but rejects ratios the explicit Manga mode would reset", () => {
  const autoRatios = ["3:1", "2:1", "16:9", "3:2", "1:1", "4:3", "2:3", "3:4", "9:16", "1:2", "1:3"] as const;
  const mangaRatios = ["9:16", "2:3", "1:2", "1:3"] as const;
  for (const aspect_ratio of autoRatios) {
    const value = normalizeOwnerUniImageParameters(gen({ aspect_ratio, seed: null, mode: "auto" }));
    assert.equal(value.custom_settings.model_type, "uni-1");
    assert.equal("aspect_ratio" in value.parameters ? value.parameters.aspect_ratio : undefined, aspect_ratio);
  }
  for (const aspect_ratio of mangaRatios) {
    const value = normalizeOwnerUniImageParameters(gen({ aspect_ratio, seed: 0, mode: "manga" }));
    assert.equal("aspect_ratio" in value.parameters ? value.parameters.aspect_ratio : undefined, aspect_ratio);
    assert.equal("mode" in value.parameters ? value.parameters.mode : undefined, "manga");
  }
  assertInvalid(() => normalizeOwnerUniImageParameters(gen({ aspect_ratio: "3:4", seed: null, mode: "manga" })));
});

test("preserves nullable integer seeds and rejects coercion or values outside the source range", () => {
  for (const seed of [null, 0, 2_147_483_647] as const) {
    const generate = normalizeOwnerUniImageParameters(gen({ aspect_ratio: "1:1", seed, mode: "auto" }));
    assert.equal("seed" in generate.parameters ? generate.parameters.seed : undefined, seed);
    assert.equal(generate.custom_settings.model_type, "uni-1");
    const modify = normalizeOwnerUniImageParameters(modifyInput({ seed, mode: "manga" }));
    assert.equal("seed" in modify.parameters ? modify.parameters.seed : undefined, seed);
    assert.equal(modify.custom_settings.model_type, "uni-1.1-modify-image");
  }
  for (const seed of [-1, 2_147_483_648, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "0", true]) {
    assertInvalid(() => normalizeOwnerUniImageParameters(gen({ aspect_ratio: "1:1", seed, mode: "auto" })));
    assertInvalid(() => normalizeOwnerUniImageParameters(modifyInput({ seed, mode: "auto" })));
  }
});

test("enforces per-model source counts and orders Modify main handle first without granting ownership", () => {
  for (let count = 0; count <= 9; count += 1) {
    const handles = Array.from({ length: count }, (_unused, index) => handle(index + 1));
    const result = normalizeOwnerUniImageParameters(gen({ aspect_ratio: "1:1", seed: null, mode: "auto" }, {
      image_reference_handles: handles
    }));
    assert.deepEqual(result.ordered_image_reference_handles, handles);
    assert.equal(result.reference_selection.owned_references_bound, false);
  }
  assertInvalid(() => normalizeOwnerUniImageParameters(gen({ aspect_ratio: "1:1", seed: null, mode: "auto" }, {
    image_reference_handles: Array.from({ length: 10 }, (_unused, index) => handle(index + 1))
  })));
  assertInvalid(() => normalizeOwnerUniImageParameters(gen({ aspect_ratio: "1:1", seed: null, mode: "auto" }, {
    main_image_reference_handle: handle(1)
  })));

  for (let count = 1; count <= 8; count += 1) {
    const handles = Array.from({ length: count }, (_unused, index) => handle(index + 11));
    const main = handles[Math.floor(count / 2)]!;
    const expected = [main, ...handles.filter((value) => value !== main)];
    const result = normalizeOwnerUniImageParameters(modifyInput({ seed: 0, mode: "auto" }, {
      image_reference_handles: handles,
      main_image_reference_handle: main
    }));
    assert.deepEqual(result.ordered_image_reference_handles, expected);
    assert.equal(result.reference_selection.main_handle, main);
    assert.equal(result.reference_selection.confidence, "SOURCE_SELECTION_ONLY_NOT_OWNERSHIP_OR_PROVIDER_ACCEPTANCE");
  }
  assertInvalid(() => normalizeOwnerUniImageParameters(modifyInput({ seed: 0, mode: "auto" }, {
    image_reference_handles: [], main_image_reference_handle: null
  })));
  assertInvalid(() => normalizeOwnerUniImageParameters(modifyInput({ seed: 0, mode: "auto" }, {
    image_reference_handles: [handle(1)], main_image_reference_handle: handle(2)
  })));
  assertInvalid(() => normalizeOwnerUniImageParameters(modifyInput({ seed: 0, mode: "auto" }, {
    image_reference_handles: Array.from({ length: 9 }, (_unused, index) => handle(index + 1)),
    main_image_reference_handle: handle(1)
  })));
});

test("accepts explicit Remove Background invert-mask values and optional prompt only with one reference", () => {
  for (const invert_mask of [false, true]) {
    const result = normalizeOwnerUniImageParameters({
      variant: "uni-1.1-remove-background",
      prompt: "",
      parameters: { invert_mask },
      image_reference_handles: [handle(31)],
      main_image_reference_handle: null
    });
    assert.equal(result.prompt, "");
    assert.deepEqual(result.parameters, { invert_mask });
    assert.deepEqual(result.custom_settings, { model_type: "uni-1.1-remove-background", invert_mask });
    assert.deepEqual(result.ordered_image_reference_handles, [handle(31)]);
  }
  assertInvalid(() => normalizeOwnerUniImageParameters({
    variant: "uni-1.1-remove-background", prompt: "", parameters: { invert_mask: false },
    image_reference_handles: [], main_image_reference_handle: null
  }));
  assertInvalid(() => normalizeOwnerUniImageParameters({
    variant: "uni-1.1-remove-background", prompt: "x", parameters: { invert_mask: false },
    image_reference_handles: [handle(1), handle(2)], main_image_reference_handle: null
  }));
  assertInvalid(() => normalizeOwnerUniImageParameters({
    variant: "uni-1.1-remove-background", prompt: "x", parameters: { invert_mask: false },
    image_reference_handles: [handle(1)], main_image_reference_handle: handle(1)
  }));
  assertInvalid(() => normalizeOwnerUniImageParameters({
    variant: "uni-1.1-remove-background", prompt: "x", parameters: { invert_mask: false, mode: "auto" },
    image_reference_handles: [handle(1)], main_image_reference_handle: null
  }));
});

test("enforces original prompt UTF-16 plus one unit per LF while preserving accepted text", () => {
  for (const prompt of ["x".repeat(6_000), `${"x".repeat(5_998)}\n`]) {
    const result = normalizeOwnerUniImageParameters(gen({ aspect_ratio: "1:1", seed: null, mode: "auto" }, { prompt }));
    assert.equal(result.prompt, prompt);
  }
  assertInvalid(() => normalizeOwnerUniImageParameters(gen({ aspect_ratio: "1:1", seed: null, mode: "auto" }, { prompt: `${"x".repeat(6_000)}\n` })));
  assertInvalid(() => normalizeOwnerUniImageParameters(gen({ aspect_ratio: "1:1", seed: null, mode: "auto" }, { prompt: "   \n  " })));
  assertInvalid(() => normalizeOwnerUniImageParameters(gen({ aspect_ratio: "1:1", seed: null, mode: "auto" }, { prompt: "bad\rline" })));
  assertInvalid(() => normalizeOwnerUniImageParameters(gen({ aspect_ratio: "1:1", seed: null, mode: "auto" }, { prompt: "lone\ud800" })));
  assertInvalid(() => normalizeOwnerUniImageParameters(gen({ aspect_ratio: "1:1", seed: null, mode: "auto" }, { prompt: "lone\udc00" })));
});

test("exposes exact source pins, per-model fields and selector-only limits without defaults", () => {
  const source = getOwnerUniImageSourceParameters();
  assert.equal(source.profile_id, "owner-uni-image-source-parameters-v1");
  assert.deepEqual(source.source_pins, {
    public_catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    use_luma_module: "useLuma.js", use_luma_build_id: "1791467421", use_luma_bytes: 4_865,
    use_luma_sha256: "sha256:f884e576649f4663919a079ac910e733f2e09e909262ee9e75bdf049e828f1d6",
    seed_helper_name: "currentRandomSeed",
    seed_helper_sha256: "sha256:c95fc355e29e33f6c3998cb62cc2da4d0879cc1ff4fb524e826e74bb24cd792b",
    seed_helper_executed: false
  });
  assert.deepEqual(source.models_by_id, {
    "uni-1": { reference_count: { minimum: 0, maximum: 9 }, prompt_policy: "required", controls: ["aspect_ratio", "seed", "mode"] },
    "uni-1.1-modify-image": { reference_count: { minimum: 1, maximum: 8 }, prompt_policy: "required", controls: ["seed", "mode"] },
    "uni-1.1-remove-background": { reference_count: { minimum: 1, maximum: 1 }, prompt_policy: "optional_with_reference", controls: ["invert_mask"] }
  });
  assert.deepEqual(source.custom_settings_fields_by_model, {
    "uni-1": ["model_type", "aspect_ratio", "seed", "mode"],
    "uni-1.1-modify-image": ["model_type", "seed", "mode"],
    "uni-1.1-remove-background": ["model_type", "invert_mask"]
  });
  assert.equal(source.defaults, "NOT_INJECTED");
  assert.equal(source.hidden_ui_cache_fields, "NOT_INCLUDED");
  assert.equal(source.dispatch_allowed, false);
  assert.ok(Object.isFrozen(source));
  assert.ok(Object.isFrozen(source.models_by_id["uni-1"]));
});

test("rejects defaults, extra fields, bad handles, duplicates, proxies and accessors without invoking them", () => {
  let getterCalls = 0;
  let proxyTraps = 0;
  const valid = gen({ aspect_ratio: "1:1", seed: null, mode: "auto" });
  const accessor = { ...valid };
  Object.defineProperty(accessor, "variant", { enumerable: true, get() { getterCalls += 1; return "uni-1"; } });
  const parameterAccessor = Object.defineProperties({}, {
    aspect_ratio: { enumerable: true, get() { getterCalls += 1; return "1:1"; } },
    seed: { enumerable: true, value: null }, mode: { enumerable: true, value: "auto" }
  });
  const handlesProxy = new Proxy([handle(1)], { get(target, property, receiver) {
    proxyTraps += 1;
    return Reflect.get(target, property, receiver);
  } });
  const badInputs: unknown[] = [
    { ...valid, variant: "uni-1.1" },
    { ...valid, n: 1 }, { ...valid, parameters: { aspect_ratio: "1:1", seed: null, mode: "auto", style: "auto" } },
    { ...valid, parameters: { aspect_ratio: "1:1", seed: null } },
    { ...valid, parameters: { aspect_ratio: "1:1", seed: null, mode: "legacy" } },
    { ...valid, parameters: { aspect_ratio: "1:4", seed: null, mode: "auto" } },
    { ...valid, image_reference_handles: ["https://r2.syntx.ai/image.png"] },
    { ...valid, image_reference_handles: [handle(1), handle(1)] },
    { ...valid, parameters: { invert_mask: 1 } },
    accessor, { ...valid, parameters: parameterAccessor }, { ...valid, image_reference_handles: handlesProxy },
    { ...valid, image_reference_handles: [handle(1), ,] },
    new Proxy(valid, { ownKeys(target) { proxyTraps += 1; return Reflect.ownKeys(target); } })
  ];
  for (const input of badInputs) assertInvalid(() => normalizeOwnerUniImageParameters(input));
  assert.equal(getterCalls, 0);
  assert.equal(proxyTraps, 0);
});

function gen(parameters: unknown, overrides: Record<string, unknown> = {}) {
  return {
    variant: "uni-1",
    prompt: "draw this",
    parameters,
    image_reference_handles: [],
    main_image_reference_handle: null,
    ...overrides
  };
}
function modifyInput(parameters: unknown, overrides: Record<string, unknown> = {}) {
  return {
    variant: "uni-1.1-modify-image",
    prompt: "edit this",
    parameters,
    image_reference_handles: [handle(1)],
    main_image_reference_handle: handle(1),
    ...overrides
  };
}
function handle(index: number): string {
  return `uni_image_00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}
function assertInvalid(run: () => unknown): void {
  assert.throws(run, (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_PARAMETERS");
}
