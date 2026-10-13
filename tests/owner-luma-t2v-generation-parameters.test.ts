import test from "node:test";
import assert from "node:assert/strict";
import {
  getOwnerLumaT2vGenerationParametersSource,
  normalizeOwnerLumaT2vGenerationParameters,
  OwnerLumaT2vGenerationParametersError,
  projectOwnerLumaT2vGenerationWireCandidate
} from "../src/application/owner-luma-t2v-generation-parameters.js";

const SOURCE_CATALOG = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json";
const SOURCE_SETTINGS = "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json";
const PROMPT = "A quiet harbor at dawn";
const VALID = {
  model_id: "ray-3.14",
  mode: "text2video",
  prompt: PROMPT,
  quality: "360p",
  aspect_ratio: "16:9",
  video_duration: 5
} as const;

test("source contract binds Ray 3.14 to current B066/1b48 and keeps runtime unavailable", () => {
  const source = getOwnerLumaT2vGenerationParametersSource();
  assert.deepEqual(source.models.map((model) => model.model_id), ["ray-3.14"]);
  assert.equal(source.source_pins.public_catalog_version, SOURCE_CATALOG);
  assert.equal(source.source_pins.settings_inventory_version, SOURCE_SETTINGS);
  assert.equal(source.source_pins.build_id, "1791811899");
  assert.equal(source.source_pins.form_module, "luma.js");
  assert.equal(source.source_pins.form_bytes, 5847);
  assert.equal(source.source_pins.form_sha256,
    "sha256:6581a04b6a9c2707070a9994f0fef31be7f5da366202ae65c3286cf09df8e588");
  assert.equal(source.source_pins.sender_sha256,
    "sha256:b5df2329cf5fbc9e1b1289d146695954fd8576aed04818baffa6fbaaff1f73de");
  assert.deepEqual(source.controls.video_duration.values, [5, 10]);
  assert.equal(source.ui_observation.combination_count, 48);
  assert.equal(source.ui_observation.count_method, "CARTESIAN_PRODUCT_DERIVED_FROM_INDEPENDENT_ENUMS");
  assert.equal(source.ui_observation.controls_enumerated_independently, true);
  assert.deepEqual(source.cost_projection.declared_keys, ["model_type", "quality", "video_duration"]);
  assert.equal(source.cost_projection.value_mapping, "UI_OBSERVED_RUNTIME_REQUEST");
  assert.deepEqual(source.cost_projection.caller_keys, ["quality", "video_duration"]);
  assert.deepEqual(source.cost_projection.transport_owned_keys, ["model_type"]);
  assert.equal(source.cost_projection.amount_or_quote, "UNPROVEN");
  assert.equal(source.runtime_usable, false);
  assert.equal(source.dispatch_allowed, false);
  assert.equal(source.backend_acceptance, "UNPROVEN");
  assert.ok(Object.isFrozen(source) && Object.isFrozen(source.models[0]));
});

test("all 48 combinations derived from independently enumerated controls normalize explicitly", () => {
  const qualities = ["360p", "540p", "720p", "1080p"] as const;
  const ratios = ["9:16", "3:4", "1:1", "4:3", "16:9", "21:9"] as const;
  const durations = [5, 10] as const;
  let count = 0;
  for (const quality of qualities) for (const aspect_ratio of ratios) for (const video_duration of durations) {
    const result = normalizeOwnerLumaT2vGenerationParameters({
      ...VALID, quality, aspect_ratio, video_duration
    });
    assert.deepEqual(result.intent, { ...VALID, quality, aspect_ratio, video_duration });
    assert.equal(result.status, "SOURCE_REVIEWED_EXPLICIT_INTENT");
    assert.equal(result.dispatch_allowed, false);
    assert.deepEqual(result.cost_query_candidate, {
      keys: ["quality", "video_duration"],
      values: { quality, video_duration },
      confidence: "UI_OBSERVED_RUNTIME_REQUEST"
    });
    count += 1;
  }
  assert.equal(count, 48);
});

test("normalizer requires explicit model, mode, prompt and supported setting values", () => {
  const reject = (input: unknown) => assert.throws(
    () => normalizeOwnerLumaT2vGenerationParameters(input),
    (error: unknown) => error instanceof OwnerLumaT2vGenerationParametersError && error.code === "INVALID_PARAMETERS"
  );
  reject({ ...VALID, model_id: "ray-3.1" });
  reject({ ...VALID, mode: "image2video" });
  reject({ ...VALID, prompt: " \t " });
  reject({ ...VALID, prompt: "dangling high surrogate \uD800" });
  reject({ ...VALID, prompt: "dangling low surrogate \uDC00" });
  reject({ ...VALID, prompt: "forbidden control \u0001" });
  reject({ ...VALID, quality: "1440p" });
  reject({ ...VALID, aspect_ratio: "2:3" });
  reject({ ...VALID, video_duration: 7 });
  reject({ ...VALID, video_duration: 4 });
  reject({ ...VALID, video_duration: 11 });
  reject({ ...VALID, video_duration: 5.5 });
  for (const key of Object.keys(VALID)) {
    const missing = { ...VALID } as Record<string, unknown>;
    delete missing[key];
    reject(missing);
  }
  assert.equal(normalizeOwnerLumaT2vGenerationParameters({ ...VALID, prompt: "x".repeat(5000) }).intent.prompt.length, 5000);
  reject({ ...VALID, prompt: "x".repeat(5001) });
});

test("normalizer rejects extra fields and unsafe records", () => {
  const reject = (input: unknown) => assert.throws(
    () => normalizeOwnerLumaT2vGenerationParameters(input), OwnerLumaT2vGenerationParametersError
  );
  reject({ ...VALID, seed: 123 });
  reject({ ...VALID, file_urls: [] });
  reject({ ...VALID, chat_id: "caller-provided" });
  const getter = Object.create(null) as Record<string, unknown>;
  let getterInvocations = 0;
  for (const [key, value] of Object.entries(VALID)) {
    Object.defineProperty(getter, key, { enumerable: true, get: () => { getterInvocations += 1; return value; } });
  }
  reject(getter);
  assert.equal(getterInvocations, 0);
  reject(Object.assign(Object.create({ foreign: true }), VALID));
  const revoked = Proxy.revocable({ ...VALID }, {});
  revoked.revoke();
  reject(revoked.proxy);
});

test("wire projection rejects altered source pins and cost metadata", () => {
  const normalized = normalizeOwnerLumaT2vGenerationParameters(VALID);
  assert.throws(() => projectOwnerLumaT2vGenerationWireCandidate({
    ...normalized,
    source_pins: { ...normalized.source_pins, public_models_sha256: "sha256:forged" }
  }), OwnerLumaT2vGenerationParametersError);
  assert.throws(() => projectOwnerLumaT2vGenerationWireCandidate({
    ...normalized,
    cost_query_candidate: {
      ...normalized.cost_query_candidate,
      values: { ...normalized.cost_query_candidate.values, quality: "1080p" }
    }
  }), OwnerLumaT2vGenerationParametersError);
  assert.throws(() => projectOwnerLumaT2vGenerationWireCandidate({
    ...normalized,
    cost_query_candidate: {
      ...normalized.cost_query_candidate,
      keys: ["model_type", "quality", "video_duration"]
    }
  }), OwnerLumaT2vGenerationParametersError);
});

test("normalizer detaches mutable caller data and freezes returned intent and metadata", () => {
  const input: Record<string, unknown> = { ...VALID };
  const normalized = normalizeOwnerLumaT2vGenerationParameters(input);
  input.prompt = "mutated after normalization";
  assert.equal(normalized.intent.prompt, PROMPT);
  assert.equal(normalized.effective_defaults, "UNKNOWN");
  assert.equal(normalized.runtime_usable, false);
  assert.equal(normalized.dispatch_allowed, false);
  assert.equal(normalized.backend_acceptance, "UNPROVEN");
  assert.ok(Object.isFrozen(normalized));
  assert.ok(Object.isFrozen(normalized.intent));
  assert.ok(Object.isFrozen(normalized.cost_query_candidate.values));
  assert.ok(Object.isFrozen(normalized.source_pins));
});

test("private wire candidate projects only the observed pilot body shape and is non-dispatching", () => {
  const normalized = normalizeOwnerLumaT2vGenerationParameters(VALID);
  assert.deepEqual(projectOwnerLumaT2vGenerationWireCandidate(normalized), {
    method: "POST",
    path: "video/generate",
    query_candidate: { ai_name: "luma" },
    body_candidate: {
      prompt: PROMPT,
      settings: {
        model_type: "ray-3.14", video_duration: 5, quality: "360p", aspect_ratio: "16:9",
        gen_type: "text2video", file_urls: []
      }
    },
    chat_id_bound: false,
    status: "WIRE_SHAPE_CANDIDATE_NOT_DISPATCHED",
    dispatch_allowed: false,
    backend_acceptance: "UNPROVEN"
  });
});
