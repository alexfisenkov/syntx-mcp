import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerFluxImageSourceParameters,
  normalizeOwnerFluxImageParameters,
  OwnerFluxImageParametersError
} from "../src/application/owner-flux-image-parameters.js";
import { getOwnerFluxImageSourceProfile } from "../src/application/owner-flux-image-source-profile.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const RESOLUTIONS = {
  "flux-1": ["1344x768", "1216x832", "1152x896", "1280x1024", "1024x1024", "1024x1280", "896x1152", "832x1216", "768x1344"],
  "flux-pro-1.1": ["1152x896", "1280x1024"],
  "flux-pro-1.1-ultra": ["3136x1344", "2752x1536", "2368x1792", "2048x2048", "1792x2368", "1536x2752", "1344x3136"]
} as const;

function input(model_id: keyof typeof RESOLUTIONS, overrides: Record<string, unknown> = {}) {
  return {
    variant: model_id,
    reference_count: model_id === "flux-1" ? 1 : 0,
    parameters: {
      resolution: RESOLUTIONS[model_id][0], cfg: 1.37, steps: 10.5, image_strength: 0.37,
      workflow_type: "default", raw: model_id === "flux-pro-1.1-ultra" ? false : null,
      civitai_loras: [], ...overrides
    }
  };
}

test("Flux source controls retain every resolution and finite in-range off-grid value", () => {
  const source = getOwnerFluxImageSourceParameters();
  assert.deepEqual(source.resolutions, RESOLUTIONS);
  for (const model_id of Object.keys(RESOLUTIONS) as (keyof typeof RESOLUTIONS)[]) {
    const request = input(model_id);
    const normalized = normalizeOwnerFluxImageParameters(request);
    assert.equal(normalized.parameters.cfg, 1.37);
    assert.equal(normalized.parameters.steps, 10.5);
    assert.equal(normalized.parameters.image_strength, 0.37);
    assert.equal(normalized.dispatch_allowed, false);
    assert.equal(normalized.runtime_activation, false);
    assert.equal(normalized.backend_acceptance, "UNPROVEN");
  }
});

test("Flux LoRA component source pin is a valid SHA-256 and agrees with every reviewed source profile", () => {
  const source = getOwnerFluxImageSourceParameters();
  assert.match(source.source_pins.lora_component_sha256, /^sha256:[a-f0-9]{64}$/u);
  const selected = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION);
  for (const model of source.models) {
    const profile = getOwnerFluxImageSourceProfile(model, selected.discoveryCatalog, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION);
    assert.equal(profile.source_binding.source_artifacts.lora_component.sha256, source.source_pins.lora_component_sha256);
  }
});

test("accepts each literal model resolution and preserves exact source JSON values", () => {
  for (const variant of Object.keys(RESOLUTIONS) as (keyof typeof RESOLUTIONS)[]) {
    for (const resolution of RESOLUTIONS[variant]) {
      const normalized = normalizeOwnerFluxImageParameters({
        ...input(variant), parameters: { ...input(variant).parameters, resolution }
      });
      assert.equal(normalized.parameters.resolution, resolution);
      assert.equal(normalized.source_json_mapping.resolution, resolution);
    }
  }
});

test("accepts LoRA counts zero through three with source IDs and synchronized fractional weights", () => {
  for (let count = 0; count <= 3; count += 1) {
    const civitai_loras = Array.from({ length: count }, (_, index) => ({
      id: String(12345 + index), url: `https://civitai.com/models/${12345 + index}/flux-lora`,
      strength_model: 0.37 + index / 100, strength_clip: 0.37 + index / 100
    }));
    const normalized = normalizeOwnerFluxImageParameters(input("flux-1", {
      workflow_type: count === 0 ? "default" : "civitai", civitai_loras
    }));
    assert.equal(normalized.parameters.civitai_loras.length, count);
    assert.equal(normalized.source_json_mapping.workflow_type, count === 0 ? "default" : "civitai");
    assert.equal(normalized.reference_binding.owned_references_bound, false);
  }
});

test("accepts both CivitAI URL forms and the basename-derived R2 safetensors form", () => {
  const entries = [
    { id: "54321", url: "https://civitai.com/api/download/models/54321", strength_model: 0.5, strength_clip: 0.5 },
    { id: "54322", url: "https://civitai.com/models/54322/flux-style", strength_model: 0.5, strength_clip: 0.5 },
    { id: "flux-style", url: "https://r2.syntx.ai/lora/flux-style.safetensors", strength_model: 0.5, strength_clip: 0.5 }
  ];
  const result = normalizeOwnerFluxImageParameters(input("flux-1", { workflow_type: "civitai", civitai_loras: entries }));
  assert.deepEqual(result.parameters.civitai_loras.map(({ id }) => id), ["54321", "54322", "flux-style"]);
  assert.deepEqual(result.source_json_mapping.civitai_loras, entries);
});

test("preserves bounded opaque public CivitAI query fields without treating them as ownership proof", () => {
  const entries = [
    { id: "54321", url: "https://civitai.com/api/download/models/54321?modelVersionId=123", strength_model: 0.5, strength_clip: 0.5 },
    { id: "54322", url: "https://civitai.com/models/54322/flux-style?format=SafeTensor", strength_model: 0.5, strength_clip: 0.5 }
  ];
  const result = normalizeOwnerFluxImageParameters(input("flux-1", { workflow_type: "civitai", civitai_loras: entries }));
  assert.deepEqual(result.parameters.civitai_loras.map(({ url }) => url), entries.map(({ url }) => url));
  assert.equal(result.reference_binding.owned_references_bound, false);
});

test("rejects numeric bounds, non-finite values, unsupported resolutions, reference overflow and invalid LoRA branches", () => {
  const cases = [
    input("flux-1", { cfg: 0.99 }), input("flux-1", { cfg: 4.01 }), input("flux-1", { cfg: Number.NaN }),
    input("flux-1", { steps: 9.99 }), input("flux-1", { steps: 28.01 }), input("flux-1", { steps: Number.POSITIVE_INFINITY }),
    input("flux-1", { image_strength: -0.01 }), input("flux-1", { image_strength: 1.01 }),
    input("flux-1", { resolution: "1024x768" }), { ...input("flux-1"), reference_count: 2 },
    input("flux-1", { civitai_loras: [{ id: "12345", url: "https://civitai.com/api/download/models/12345", strength_model: 0.5, strength_clip: 0.5 }], workflow_type: "default" }),
    input("flux-pro-1.1", { civitai_loras: [{ id: "12345", url: "https://civitai.com/api/download/models/12345", strength_model: 0.5, strength_clip: 0.5 }], workflow_type: "civitai" }),
    input("flux-pro-1.1-ultra", { raw: null }), input("flux-pro-1.1", { raw: false })
  ];
  for (const candidate of cases) assert.throws(() => normalizeOwnerFluxImageParameters(candidate), OwnerFluxImageParametersError);
});

test("rejects credential-bearing or unsafe LoRA URLs and mismatched source IDs without echoing URL data", () => {
  const base = { id: "12345", url: "https://civitai.com/api/download/models/12345", strength_model: 0.4, strength_clip: 0.4 };
  const unsafe = [
    { ...base, id: "999", url: "https://civitai.com/api/download/models/12345" },
    { ...base, url: "https://civitai.com/api/download/models/12345?token=private-token-value" },
    { ...base, url: "https://civitai.com/api/download/models/12345?api_key=private-value" },
    { ...base, url: "https://civitai.com/api/download/models/12345?access_token=private-value" },
    { ...base, url: "https://civitai.com/api/download/models/12345?auth=fixtureheader.fixturepayload.fixturesignature" },
    { ...base, url: "https://civitai.com/api/download/models/12345?format=SafeTensor&format=Model" },
    { ...base, url: "http://civitai.com/api/download/models/12345" },
    { ...base, strength_clip: 0.41 },
    { ...base, id: "other-model", url: "https://r2.syntx.ai/models/flux-lora.safetensors" },
    { ...base, id: "flux-lora", url: "https://r2.syntx.ai/models/flux-lora.safetensors?signature=private" },
    { ...base, url: "https://evil.example/models/12345/flux-lora" }
  ];
  for (const lora of unsafe) {
    assert.throws(() => normalizeOwnerFluxImageParameters(input("flux-1", { workflow_type: "civitai", civitai_loras: [lora] })),
      (error: unknown) => error instanceof OwnerFluxImageParametersError && !error.message.includes("private"));
  }
});

test("maps absent raw as omission and keeps LoRAs unavailable outside Flux-1", () => {
  const pro = normalizeOwnerFluxImageParameters(input("flux-pro-1.1"));
  const ultra = normalizeOwnerFluxImageParameters(input("flux-pro-1.1-ultra"));
  assert.equal(Object.hasOwn(pro.source_json_mapping, "raw"), false);
  assert.equal(Object.hasOwn(pro.source_json_mapping, "civitai_loras"), false);
  assert.equal(Object.hasOwn(ultra.source_json_mapping, "civitai_loras"), false);
  assert.equal(ultra.source_json_mapping.raw, false);
});

test("rejects getters and proxies without invoking them, and leaves explicit caller objects unchanged", () => {
  const caller = input("flux-1");
  const before = structuredClone(caller);
  const normalized = normalizeOwnerFluxImageParameters(caller);
  assert.deepEqual(caller, before);
  assert.equal(Object.isFrozen(normalized.parameters), true);
  let getterReads = 0;
  const parametersWithGetter = { ...caller.parameters };
  Object.defineProperty(parametersWithGetter, "cfg", { enumerable: true, get() { getterReads += 1; return 2; } });
  assert.throws(() => normalizeOwnerFluxImageParameters({ ...caller, parameters: parametersWithGetter }), OwnerFluxImageParametersError);
  assert.equal(getterReads, 0);
  let proxyTraps = 0;
  const proxied = new Proxy(caller, { ownKeys() { proxyTraps += 1; return Reflect.ownKeys(caller); } });
  assert.throws(() => normalizeOwnerFluxImageParameters(proxied), OwnerFluxImageParametersError);
  assert.equal(proxyTraps, 0);
});
