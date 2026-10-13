import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerSoulGenerationSourceParameters,
  normalizeOwnerSoulGenerationParameters,
  OwnerSoulGenerationParametersError
} from "../src/application/owner-soul-generation-parameters.js";

const PROMPT = "A folded paper crane on a quiet desk";
const STYLE_HANDLE = "soul_style_00000000-0000-4000-8000-000000000001";
const CHARACTER_HANDLE = "soul_character_00000000-0000-4000-8000-000000000002";
const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const QUALITY_RESOLUTIONS = {
  "720p": ["2048x1152", "1680x1120", "1536x1152", "1536x1536", "1152x1536", "1120x1680", "1152x2048"],
  "1080p": ["2048x1152", "2016x1344", "2048x1536", "1536x1536", "1536x2048", "1344x2016", "1152x2048"]
} as const;

function input(overrides: Record<string, unknown> = {}) {
  return {
    prompt: PROMPT,
    quality: "720p",
    resolution: "1536x1536",
    batch_size: 1,
    enhance_prompt: false,
    seed: null,
    style: { kind: "none" },
    character: { kind: "none" },
    ...overrides
  };
}

function e551Catalog(model = {
  id: "higgsfield-soul", ai_name: "higgsfield-soul", upstream_id: "higgsfield-soul", active: true
}) {
  return { catalog_version: CATALOG_VERSION, model };
}

test("source descriptor exposes full explicit UI controls, source pins, and unresolved non-controls", () => {
  const descriptor = getOwnerSoulGenerationSourceParameters();
  assert.deepEqual(descriptor.quality_resolution_pairs, QUALITY_RESOLUTIONS);
  assert.deepEqual(descriptor.batch_size.values, [1, 4]);
  assert.equal(descriptor.enhance_prompt.type, "boolean");
  assert.deepEqual(descriptor.seed, {
    required: true, nullable: true, minimum: 0, maximum: 2147483647, integer: true,
    null_ui_choice: "random",
    zero_watcher_note: "external zero may be treated as random except recognized own-update echo",
    backend_semantics: "UNPROVEN"
  });
  assert.deepEqual(descriptor.style_strength, { minimum: 0, maximum: 1, step: 0.1, conditional_on: "selected_style" });
  assert.equal(descriptor.style.empty_backend_acceptance, "UNPROVEN");
  assert.deepEqual(descriptor.character.statuses, ["not-ready", "in-progress", "queue", "error", "completed"]);
  assert.equal(descriptor.character.actual_server_reference_id_type, "UNOBSERVED_EMPTY_LIST");
  assert.equal(descriptor.character.empty_backend_acceptance, "UNPROVEN");
  assert.equal(descriptor.character_source_mapping.binding, "inline_soul_form_a11");
  assert.equal(descriptor.character_source_mapping.value_source, "record.reference_id");
  assert.equal(descriptor.historical_character_source_reference.status, "HISTORICAL_NOT_CURRENT_CHARACTER_BINDING");
  assert.equal("character_module_sha256" in descriptor.source_pins, false);
  assert.equal(descriptor.reference_strength, "UNRESOLVED_UNCONTROLLED_WIRE_FIELD");
  assert.equal(descriptor.prompt.local_utf8_max_bytes, 131072);
  assert.equal(descriptor.prompt.provider_max, "UNPROVEN");
  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(Object.isFrozen(descriptor.quality_resolution_pairs["720p"]), true);
});

test("normalizer returns frozen full explicit intent and derives model binding from e551", () => {
  const result = normalizeOwnerSoulGenerationParameters(input({
    style: { kind: "selected", style_handle: STYLE_HANDLE, strength: 0.7 },
    character: { kind: "selected", character_handle: CHARACTER_HANDLE },
    seed: 0,
    batch_size: 4,
    enhance_prompt: true
  }), e551Catalog());
  assert.deepEqual(result.intent, {
    prompt: PROMPT, quality: "720p", resolution: "1536x1536", batch_size: 4,
    enhance_prompt: true, seed: 0,
    style: { kind: "selected", style_handle: STYLE_HANDLE, strength: 0.7 },
    character: { kind: "selected", character_handle: CHARACTER_HANDLE }
  });
  assert.deepEqual(result.model, {
    model_id: "higgsfield-soul", ai_name: "higgsfield-soul", model_type: "higgsfield-soul", catalog_version: CATALOG_VERSION
  });
  assert.equal(result.dispatch_allowed, false);
  assert.equal(result.generation_readiness, "BLOCKED_SOURCE_OR_BACKEND_GATES");
  assert.equal(result.reference_strength, "UNRESOLVED_UNCONTROLLED_WIRE_FIELD");
  assert.equal("file_urls" in result.intent, false);
  assert.equal("style_id" in (result.intent.style as object), false);
  assert.equal("reference_id" in (result.intent.character as object), false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.intent), true);
  assert.equal(Object.isFrozen(result.intent.style), true);
});

test("all 14 quality/resolution pairs normalize while crossed pairs are rejected", () => {
  for (const quality of ["720p", "1080p"] as const) {
    for (const resolution of QUALITY_RESOLUTIONS[quality]) {
      const normalized = normalizeOwnerSoulGenerationParameters(input({ quality, resolution }));
      assert.equal(normalized.intent.quality, quality);
      assert.equal(normalized.intent.resolution, resolution);
    }
  }
  assert.throws(() => normalizeOwnerSoulGenerationParameters(input({ quality: "720p", resolution: "2016x1344" })),
    (error: unknown) => error instanceof OwnerSoulGenerationParametersError && error.code === "INVALID_PARAMETERS");
  assert.throws(() => normalizeOwnerSoulGenerationParameters(input({ quality: "1080p", resolution: "1680x1120" })),
    (error: unknown) => error instanceof OwnerSoulGenerationParametersError && error.code === "INVALID_PARAMETERS");
});

test("none and selected style/Character branches are explicit and type-closed", () => {
  assert.equal(normalizeOwnerSoulGenerationParameters(input({ style: { kind: "none" }, character: { kind: "none" } })).intent.style.kind, "none");
  const selected = normalizeOwnerSoulGenerationParameters(input({
    style: { kind: "selected", style_handle: STYLE_HANDLE, strength: 0.1 },
    character: { kind: "selected", character_handle: CHARACTER_HANDLE }
  }));
  assert.equal(selected.intent.style.kind, "selected");
  assert.equal(selected.intent.character.kind, "selected");
  for (const badStyle of [
    { kind: "selected", style_handle: "raw-provider-style-id", strength: 0.5 },
    { kind: "selected", style_handle: STYLE_HANDLE, strength: 0.55 },
    { kind: "selected", style_handle: STYLE_HANDLE, strength: 1.1 },
    { kind: "none", style_handle: STYLE_HANDLE }
  ]) {
    assert.throws(() => normalizeOwnerSoulGenerationParameters(input({ style: badStyle })),
      (error: unknown) => error instanceof OwnerSoulGenerationParametersError && error.code === "INVALID_PARAMETERS");
  }
  assert.throws(() => normalizeOwnerSoulGenerationParameters(input({ character: { kind: "selected", character_handle: "raw-reference-id" } })),
    (error: unknown) => error instanceof OwnerSoulGenerationParametersError && error.code === "INVALID_PARAMETERS");
});

test("seed accepts explicit null, zero and source-bound maximum; rejects strings/fractions/out-of-range", () => {
  for (const seed of [null, 0, 2147483647]) {
    assert.equal(normalizeOwnerSoulGenerationParameters(input({ seed })).intent.seed, seed);
  }
  for (const seed of ["1", -1, 2147483648, 1.5, Number.NaN]) {
    assert.throws(() => normalizeOwnerSoulGenerationParameters(input({ seed })),
      (error: unknown) => error instanceof OwnerSoulGenerationParametersError && error.code === "INVALID_PARAMETERS");
  }
});

test("prompt local UTF-8 cap is enforced without using catalog zero as provider max", () => {
  assert.throws(() => normalizeOwnerSoulGenerationParameters(input({ prompt: "x".repeat(131073) })),
    (error: unknown) => error instanceof OwnerSoulGenerationParametersError && error.code === "INVALID_PARAMETERS");
  assert.throws(() => normalizeOwnerSoulGenerationParameters(input({ prompt: "bad\u0000prompt" })),
    (error: unknown) => error instanceof OwnerSoulGenerationParametersError && error.code === "INVALID_PARAMETERS");
  const accepted = normalizeOwnerSoulGenerationParameters(input({ prompt: "é".repeat(65536) }));
  assert.equal(Buffer.byteLength(accepted.intent.prompt, "utf8"), 131072);
});

test("normalizer rejects caller model fields, extras, accessors, proxies, bad catalogs, and staged writes", () => {
  for (const bad of [
    input({ model_type: "caller-model-type" }),
    input({ file_urls: [] }),
    input({ reference_strength: 0.7 }),
    input({ aspect_ratio: "1:1" }),
    input({ quality: "720P" }),
    input({ batch_size: 2 }),
    input({ enhance_prompt: "true" })
  ]) {
    assert.throws(() => normalizeOwnerSoulGenerationParameters(bad),
      (error: unknown) => error instanceof OwnerSoulGenerationParametersError && error.code === "INVALID_PARAMETERS");
  }
  const accessor = input();
  Object.defineProperty(accessor, "seed", { enumerable: true, get() { throw new Error("must not execute"); } });
  assert.throws(() => normalizeOwnerSoulGenerationParameters(accessor),
    (error: unknown) => error instanceof OwnerSoulGenerationParametersError && error.code === "INVALID_PARAMETERS");
  assert.throws(() => normalizeOwnerSoulGenerationParameters(new Proxy(input(), {})),
    (error: unknown) => error instanceof OwnerSoulGenerationParametersError && error.code === "INVALID_PARAMETERS");
  assert.throws(() => normalizeOwnerSoulGenerationParameters(input(), e551Catalog({
    id: "higgsfield-soul", ai_name: "higgsfield-soul", upstream_id: "other", active: true
  })), (error: unknown) => error instanceof OwnerSoulGenerationParametersError && error.code === "MODEL_BINDING_MISMATCH");
});
