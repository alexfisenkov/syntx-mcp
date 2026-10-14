import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeOwnerHailuo02I2vParameters,
  OwnerHailuo02I2vParametersError
} from "../src/application/owner-hailuo02-i2v-parameters.js";
import {
  OWNER_HAILUO02_I2V_MODEL,
  OWNER_HAILUO02_I2V_SOURCE_PINS,
  OWNER_HAILUO02_I2V_SOURCE_PROFILE
} from "../src/application/owner-hailuo02-i2v-source-profile.js";

const IMAGE_HANDLE = "h02img_0123456789abcdefghijklmn";
const PROMPT = "A paper lantern drifting over a calm lake.";
const PAIRS = [
  { resolution: "512p", video_duration: 6 },
  { resolution: "512p", video_duration: 10 },
  { resolution: "768p", video_duration: 6 },
  { resolution: "768p", video_duration: 10 },
  { resolution: "1080p", video_duration: 6 }
] as const;

test("Hailuo-02 I2V source profile pins the reviewed source and exact input ABI", () => {
  assert.equal(OWNER_HAILUO02_I2V_SOURCE_PROFILE.source_pins, OWNER_HAILUO02_I2V_SOURCE_PINS);
  assert.equal(OWNER_HAILUO02_I2V_SOURCE_PROFILE.model, OWNER_HAILUO02_I2V_MODEL);
  assert.equal(OWNER_HAILUO02_I2V_SOURCE_PINS.source_build_id, "1791904852");
  assert.equal(OWNER_HAILUO02_I2V_SOURCE_PROFILE.status, "CURRENT_FORM_SOURCE_WITH_PINNED_PUBLIC_MODEL_ROW");
  assert.equal(OWNER_HAILUO02_I2V_SOURCE_PINS.form_sha256,
    "sha256:44470e6f7de725746c4fbbee0ddb61cf861629943299ce006f34d0120706d10c");
  assert.deepEqual(OWNER_HAILUO02_I2V_SOURCE_PROFILE.controls.valid_pairs, PAIRS);
  assert.deepEqual(OWNER_HAILUO02_I2V_SOURCE_PROFILE.wire.settings_keys,
    ["model_type", "resolution", "video_duration", "file_urls"]);
  assert.deepEqual(OWNER_HAILUO02_I2V_SOURCE_PROFILE.cost_projection.caller_keys, ["resolution", "video_duration"]);
  assert.deepEqual(OWNER_HAILUO02_I2V_SOURCE_PROFILE.cost_projection.transport_owned_keys, ["ai_name", "model_type"]);
  assert.equal(OWNER_HAILUO02_I2V_SOURCE_PROFILE.cost_projection.reference_count_included, false);
  assert.deepEqual(OWNER_HAILUO02_I2V_SOURCE_PROFILE.upload_source, {
    model_type: "hailuo-02", destination: "uploaded", check_duplicates: true, reference_count_limit: 1
  });
  assert.equal(OWNER_HAILUO02_I2V_SOURCE_PROFILE.controls.prompt.source_max_length, "UNKNOWN");
  assert.equal(OWNER_HAILUO02_I2V_SOURCE_PROFILE.defaults, "UNKNOWN");
  assert.equal(OWNER_HAILUO02_I2V_SOURCE_PROFILE.runtime_usable, false);
  assert.equal(OWNER_HAILUO02_I2V_SOURCE_PROFILE.dispatch_allowed, false);
  assert.equal(OWNER_HAILUO02_I2V_SOURCE_PROFILE.backend_acceptance, "UNPROVEN");
});

test("normalizer accepts every source-supported I2V pair with one opaque reference handle", () => {
  for (const pair of PAIRS) {
    const normalized = normalizeOwnerHailuo02I2vParameters({
      model_id: "hailuo-02", ...pair, prompt: PROMPT, image_handle: IMAGE_HANDLE
    });
    assert.deepEqual(normalized.intent, { prompt: PROMPT, ...pair });
    assert.deepEqual(normalized.reference_binding, {
      required_count: 1, image_handle: IMAGE_HANDLE, owner_bound: false, file_urls_projected: false
    });
    assert.deepEqual(normalized.cost_query_candidate.values, pair);
    assert.equal(normalized.cost_query_candidate.reference_count_included, false);
    assert.equal(normalized.model.ai_name, "hailuo-minimax");
    assert.equal(normalized.runtime_usable, false);
    assert.equal(normalized.dispatch_allowed, false);
  }
});

test("normalizer rejects unsupported tuples, extra wire fields, and forged URL or file identifiers", () => {
  const base = { model_id: "hailuo-02", resolution: "512p", video_duration: 6, prompt: PROMPT, image_handle: IMAGE_HANDLE };
  for (const invalid of [
    { ...base, resolution: "1080p", video_duration: 10 },
    { ...base, resolution: "768p", video_duration: 5 },
    { ...base, resolution: "512p", video_duration: 6, file_urls: ["https://example.test/image.png"] },
    { ...base, image_handle: "https://example.test/image.png" },
    { ...base, image_handle: "provider-file-id-12345678901234567890" },
    { ...base, image_handle: "h02img_short" },
    { ...base, model_id: "another-model" },
    { ...base, prompt: "  " },
    { ...base, prompt: "x".repeat(5_001) }
  ]) {
    assert.throws(() => normalizeOwnerHailuo02I2vParameters(invalid), OwnerHailuo02I2vParametersError);
  }
});

test("normalizer validates prompt nonblankness without changing the caller's text", () => {
  const prompt = "  Keep these leading and trailing spaces.  ";
  const normalized = normalizeOwnerHailuo02I2vParameters({
    model_id: "hailuo-02", resolution: "512p", video_duration: 6, prompt, image_handle: IMAGE_HANDLE
  });
  assert.equal(normalized.intent.prompt, prompt);
});
