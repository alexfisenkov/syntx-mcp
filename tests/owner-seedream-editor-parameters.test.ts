import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerSeedreamEditorSourceParameters,
  normalizeOwnerSeedreamEditorParameters,
  projectOwnerSeedreamEditorCostParameters,
  OwnerSeedreamEditorParametersError
} from "../src/application/owner-seedream-editor-parameters.js";

const VARIANTS = ["seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-flash", "seedream-5.0-pro"] as const;
const RATIOS = ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"] as const;
const RESOLUTIONS = {
  "seedream-4": ["1K", "2K", "4K"],
  "seedream-4.5": ["2K", "4K"],
  "seedream-5": ["2K", "3K", "4K"],
  "seedream-5.0-flash": ["1K", "1.5K", "2K"],
  "seedream-5.0-pro": ["1K", "2K"]
} as const;

function invalidParameters(action: () => unknown): void {
  assert.throws(action, (error: unknown) => error instanceof OwnerSeedreamEditorParametersError &&
    error.code === "INVALID_PARAMETERS" && error.message === "Seedream Editor parameters are invalid.");
}

test("source descriptor pins model-less Editor form and marks declarations as non-runtime facts", () => {
  const source = getOwnerSeedreamEditorSourceParameters();
  assert.deepEqual(source, {
    profile_id: "seedream-editor-explicit-parameters-v1",
    navigation_id: "seedream-editor",
    family: "seedream",
    scope: "tool_image_inpaint",
    model_variants: VARIANTS,
    aspect_ratios: RATIOS,
    resolutions_by_variant: RESOLUTIONS,
    ui_declared_settings: { model_type: "seedream-5.0-pro", resolution: "2K", aspect_ratio: "1:1", stream: false },
    effective_defaults: "UNPROVEN",
    settings_cache_behavior: "UNPROVEN",
    settings_reset_behavior: "UNPROVEN",
    full_settings_store: "UNPROVEN",
    cost_projection: {
      status: "SOURCE_JOINED_COST_QUERY_INPUTS",
      declared_keys_by_variant: {
        "seedream-4": [],
        "seedream-4.5": [],
        "seedream-5": [],
        "seedream-5.0-flash": [],
        "seedream-5.0-pro": ["batch_size", "resolution"]
      },
      pro_batch_size_input: "can_reset ? 2 : 1",
      pro_batch_size_confidence: "ROOT940_COST_UI_OVERRIDE_NOT_OUTPUT_COUNT",
      pro_resolution_input: "EXPLICIT_EDITOR_PARAMETERS",
      cost_query_only: true,
      generation_wire: "UNPROVEN",
      quote_amount: "UNPROVEN",
      billing_cap: "UNPROVEN",
      generation_output_count: "UNPROVEN",
      source_binding: {
        root: 940,
        form_module: "seedream-editor.js",
        form_sha256: "sha256:2026192d5b0f086446873996ad20cf4691f665d4019621eef3241887ffb3ad7c",
        cost_module: "cost2.js",
        cost_bytes: 1660,
        cost_sha256: "sha256:c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9",
        public_catalog_version: "sha256-c5c10b9b0bffdc4b75dab3363de10c2c2856f1130a559eb9e8a21a1493bf067c.json",
        settings_inventory_version: "sha256-62bcf08172eb75011055d9ae04c772362b72337646ee2e460944d7fcb2301bcf.json"
      }
    },
    drawing_role: "IMAGE_EXTRA_NOT_MASK",
    drawing_ownership: "UNBOUND",
    mask_policy: "UNPROVEN",
    result_history: "UNPROVEN",
    source_binding: {
      build_id: "1791467421",
      home_sha256: "a7a68e6ae96547333037962ab9bb3a40ddf7aeb912223d65a9962ab5ce6982da",
      form_module: "seedream-editor.js",
      form_sha256: "sha256:2026192d5b0f086446873996ad20cf4691f665d4019621eef3241887ffb3ad7c",
      parent_module: "InpaintEditor.js",
      parent_sha256: "sha256:87509acda1040d79927edc30d8ddd18d503a6e7ce9387d5d0a059b1eb5028e14",
      generic_helper_module: "useInpaintTool.js",
      generic_helper_sha256: "sha256:de8396adca45a5ba79c9c52cdfa91b23f45285645bed5df120c0f337a192deb2",
      constants_module: "constants2.js",
      constants_sha256: "sha256:636b6f8e15c847f346395027bc83dc3fddf22199d8ab07a32f98d5f0985ccecf",
      settings_helper_module: "settings3.js",
      settings_helper_sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe"
    },
    runtime_usable: false,
    generation_allowed: false,
    dispatch_allowed: false,
    backend_acceptance: "UNPROVEN"
  });
  assert.match(source.source_binding.home_sha256, /^[a-f0-9]{64}$/u);
  for (const hash of [source.source_binding.form_sha256, source.source_binding.parent_sha256,
    source.source_binding.generic_helper_sha256, source.source_binding.constants_sha256,
    source.source_binding.settings_helper_sha256]) {
    assert.match(hash, /^sha256:[a-f0-9]{64}$/u);
  }
  assert.equal(Object.isFrozen(source), true);
  assert.equal(Object.isFrozen(source.resolutions_by_variant), true);
  assert.equal(Object.isFrozen(source.source_binding), true);
  assert.equal(Object.isFrozen(source.cost_projection), true);
  assert.equal(Object.isFrozen(source.cost_projection.declared_keys_by_variant), true);
  assert.equal(Object.isFrozen(source.cost_projection.source_binding), true);
});

test("normalizes all 104 model-bound aspect-ratio and resolution pairs without defaults", () => {
  let combinations = 0;
  for (const variant of VARIANTS) {
    for (const aspect_ratio of RATIOS) {
      for (const resolution of RESOLUTIONS[variant]) {
        const intent = normalizeOwnerSeedreamEditorParameters({ variant, parameters: { aspect_ratio, resolution } });
        assert.deepEqual(intent, { variant, parameters: { aspect_ratio, resolution } });
        assert.equal(Object.isFrozen(intent), true);
        assert.equal(Object.isFrozen(intent.parameters), true);
        combinations += 1;
      }
    }
  }
  assert.equal(combinations, 104);
});

test("preserves copied explicit values and rejects navigation aliases, cross-model pairs, defaults, and extra fields", () => {
  const parameters = { aspect_ratio: "16:9", resolution: "2K" };
  const intent = normalizeOwnerSeedreamEditorParameters({ variant: "seedream-5.0-pro", parameters });
  parameters.aspect_ratio = "4:3";
  assert.deepEqual(intent, { variant: "seedream-5.0-pro", parameters: { aspect_ratio: "16:9", resolution: "2K" } });

  for (const invalid of [
    { variant: "seedream-editor", parameters: { aspect_ratio: "1:1", resolution: "2K" } },
    { variant: "seedream-4", parameters: { aspect_ratio: "1.85:1", resolution: "2K" } },
    { variant: "seedream-4.5", parameters: { aspect_ratio: "1:1", resolution: "1K" } },
    { variant: "seedream-5", parameters: { aspect_ratio: "1:1", resolution: "1.5K" } },
    { variant: "seedream-5.0-flash", parameters: { aspect_ratio: "1:1", resolution: "4K" } },
    { variant: "seedream-5.0-pro", parameters: { aspect_ratio: "1:1", resolution: "3K" } },
    { variant: "seedream-5.0-pro", parameters: { aspect_ratio: "1:1" } },
    { variant: "seedream-5.0-pro", parameters: { resolution: "2K" } },
    { variant: "seedream-5.0-pro", parameters: { aspect_ratio: "1:1", resolution: "2K", output_format: "png" } },
    { variant: "seedream-5.0-pro", parameters: { aspect_ratio: "1:1", resolution: "2K", background: "transparent" } },
    { variant: "seedream-5.0-pro", parameters: { aspect_ratio: "1:1", resolution: "2K", stream: false } },
    { variant: "seedream-5.0-pro", parameters: { aspect_ratio: "1:1", resolution: "2K", model_type: "seedream-5.0-pro" } },
    { variant: "seedream-5.0-pro", parameters: { aspect_ratio: "1:1", resolution: "2K" }, prompt: "caller authority" },
    { variant: "seedream-5.0-pro", parameters: { aspect_ratio: "1:1", resolution: "2K" }, cost_inputs: { batch_size: 0 } }
  ]) invalidParameters(() => normalizeOwnerSeedreamEditorParameters(invalid));
});

test("rejects accessors and proxies without reading or echoing caller values", () => {
  let getterReads = 0;
  const accessor = Object.defineProperty({ parameters: { aspect_ratio: "1:1", resolution: "2K" } }, "variant", {
    enumerable: true, get() { getterReads += 1; return "seedream-5.0-pro"; }
  });
  invalidParameters(() => normalizeOwnerSeedreamEditorParameters(accessor));
  assert.equal(getterReads, 0);

  let proxyTraps = 0;
  const hostile = new Proxy({}, { getOwnPropertyDescriptor() { proxyTraps += 1; throw new Error("must not run"); } });
  invalidParameters(() => normalizeOwnerSeedreamEditorParameters(hostile));
  assert.equal(proxyTraps, 0);

  const revokedTopLevel = Proxy.revocable({
    variant: "seedream-5.0-pro",
    parameters: { aspect_ratio: "1:1", resolution: "2K" }
  }, {});
  revokedTopLevel.revoke();
  invalidParameters(() => normalizeOwnerSeedreamEditorParameters(revokedTopLevel.proxy));

  const revokedParameters = Proxy.revocable({ aspect_ratio: "1:1", resolution: "2K" }, {});
  revokedParameters.revoke();
  invalidParameters(() => normalizeOwnerSeedreamEditorParameters({
    variant: "seedream-5.0-pro",
    parameters: revokedParameters.proxy
  }));
});

test("projects all 208 literal model-control and can-reset combinations into exact cost query inputs", () => {
  let combinations = 0;
  for (const variant of VARIANTS) {
    for (const aspect_ratio of RATIOS) {
      for (const resolution of RESOLUTIONS[variant]) {
        for (const can_reset of [false, true]) {
          const projected = projectOwnerSeedreamEditorCostParameters({
            variant, parameters: { aspect_ratio, resolution }, can_reset
          });
          const expected = variant === "seedream-5.0-pro"
            ? { batch_size: can_reset ? 2 : 1, resolution }
            : {};
          assert.deepEqual(projected, expected);
          assert.deepEqual(Object.keys(projected).sort(), Object.keys(expected).sort());
          assert.equal(Object.isFrozen(projected), true);
          combinations += 1;
        }
      }
    }
  }
  assert.equal(combinations, 208);
});

test("requires explicit boolean can-reset state and rejects extra or cross-model inputs", () => {
  const explicit = { variant: "seedream-5.0-pro", parameters: { aspect_ratio: "1:1", resolution: "2K" }, can_reset: false } as const;
  assert.deepEqual(projectOwnerSeedreamEditorCostParameters(explicit), { batch_size: 1, resolution: "2K" });
  for (const invalid of [
    { variant: "seedream-5.0-pro", parameters: { aspect_ratio: "1:1", resolution: "2K" } },
    { ...explicit, can_reset: undefined },
    { ...explicit, can_reset: 0 },
    { ...explicit, can_reset: "false" },
    { ...explicit, prompt: "not part of cost inputs" },
    { ...explicit, cost_inputs: { batch_size: 2 } },
    { ...explicit, parameters: { aspect_ratio: "1:1", resolution: "1K" }, variant: "seedream-4.5" }
  ]) invalidParameters(() => projectOwnerSeedreamEditorCostParameters(invalid));
});

test("returns a frozen copy that excludes generation and wire fields", () => {
  const parameters = { aspect_ratio: "16:9", resolution: "2K" };
  const projected = projectOwnerSeedreamEditorCostParameters({ variant: "seedream-5.0-pro", parameters, can_reset: true });
  parameters.resolution = "1K";
  assert.deepEqual(projected, { batch_size: 2, resolution: "2K" });
  assert.deepEqual(Object.keys(projected).sort(), ["batch_size", "resolution"]);
  assert.equal(Object.isFrozen(projected), true);
});

test("rejects hostile and revoked projector input without invoking traps", () => {
  let getterReads = 0;
  const accessor = Object.defineProperty({ parameters: { aspect_ratio: "1:1", resolution: "2K" }, can_reset: true }, "variant", {
    enumerable: true, get() { getterReads += 1; return "seedream-5.0-pro"; }
  });
  invalidParameters(() => projectOwnerSeedreamEditorCostParameters(accessor));
  assert.equal(getterReads, 0);

  let proxyTraps = 0;
  const hostile = new Proxy({}, { getOwnPropertyDescriptor() { proxyTraps += 1; throw new Error("must not run"); } });
  invalidParameters(() => projectOwnerSeedreamEditorCostParameters(hostile));
  assert.equal(proxyTraps, 0);

  const revoked = Proxy.revocable({
    variant: "seedream-5.0-pro", parameters: { aspect_ratio: "1:1", resolution: "2K" }, can_reset: true
  }, {});
  revoked.revoke();
  invalidParameters(() => projectOwnerSeedreamEditorCostParameters(revoked.proxy));

  const revokedParameters = Proxy.revocable({ aspect_ratio: "1:1", resolution: "2K" }, {});
  revokedParameters.revoke();
  invalidParameters(() => projectOwnerSeedreamEditorCostParameters({
    variant: "seedream-5.0-pro", parameters: revokedParameters.proxy, can_reset: true
  }));
});
