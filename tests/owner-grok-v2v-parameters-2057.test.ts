import assert from "node:assert/strict";
import test from "node:test";
import {
  isOwnerGrokV2vMeasuredSettingsCandidate,
  isOwnerGrokV2vNormalizedParameters,
  normalizeOwnerGrokV2vParameters,
  OwnerGrokV2vParametersError,
  projectOwnerGrokV2vMeasuredSettings
} from "../src/application/owner-grok-v2v-parameters.js";
import {
  getOwnerGrokV2vSourceProfile,
  OWNER_GROK_V2V_MODEL_ID,
  OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION
} from "../src/application/owner-grok-v2v-source-profile.js";

const rejects = (input: unknown) => assert.throws(
  () => normalizeOwnerGrokV2vParameters(input),
  (error: unknown) => error instanceof OwnerGrokV2vParametersError && error.code === "INVALID_PARAMETERS"
);
const projectRejects = (input: unknown) => assert.throws(
  () => projectOwnerGrokV2vMeasuredSettings(input),
  (error: unknown) => error instanceof OwnerGrokV2vParametersError && error.code === "INVALID_PARAMETERS"
);

test("Grok V2V source profile pins only the exact current static facts and denies runtime", () => {
  const profile = getOwnerGrokV2vSourceProfile(OWNER_GROK_V2V_MODEL_ID);
  assert.ok(profile);
  assert.equal(profile.model_id, "grok_v2v");
  assert.equal(profile.ai_name, "grok_video");
  assert.equal(profile.source_pins.public_catalog_version, OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION);
  assert.equal(profile.source_pins.public_models_sha256,
    "sha256:92c31dba26eb9c0ccf68cdf92a105e6e808c92b187286e4fb366debe051982e1");
  assert.equal(profile.source_pins.source_build_id, "1792133067");
  assert.deepEqual(profile.source_pins.modules, {
    grok_form: "sha256:cc36221a4c696fb91b43166558800e2b1df18e49dcb3c06997b7cfeafb3c5159",
    file_uploader: "sha256:45f3174473d1ae4c9e57fbee47c7bf0c7e75773e9f3b36dbb8c3e5cc7ec3863a",
    chat_input: "sha256:4b6139e2115b651af482800684f569f27dfa46e9154486814d1a8d376701a464",
    app: "sha256:5488b33ac6de23e559932a485c7cf2f7d034151f3d735005dfb0a334ee21a175",
    duration_enricher: "sha256:09611977302662f75f1076cefed631360c1734ba07f7795fe289f562dee49ba6",
    duration_reader: "sha256:13d991c46f54bdfc9f0dad43ae792580a21a5754a5de1d42900c81e3134c7d6b",
    video_sender: "sha256:3dbb36e710d6e35ae9babef856678af06cb5d2352beb7a67aa60d47cd6ffc49b"
  });
  assert.equal(profile.input.max_file_size_bytes, 52_428_800);
  assert.deepEqual(profile.input.accepted_file_types, ["video/mp4", "video/quicktime"]);
  assert.deepEqual(profile.input.total_duration_seconds, { minimum: 1, maximum: 8.7 });
  assert.equal(profile.prompt.max_length_utf16, 2_000);
  assert.equal(profile.settings_projection.aspect_ratio, null);
  assert.deepEqual(profile.cost_projection.keys, ["video_duration", "resolution"]);
  assert.equal(profile.effective_defaults, "UNKNOWN");
  assert.equal(profile.runtime_usable, false);
  assert.equal(profile.dispatch_allowed, false);
  assert.equal(profile.backend_acceptance, "UNPROVEN");
  assert.equal(getOwnerGrokV2vSourceProfile("grok_t2v"), undefined);
});

test("normalizer requires an explicit model and preserves nonblank well-formed UTF-16 prompt", () => {
  const prompt = "A measured-source test prompt 🪁";
  const result = normalizeOwnerGrokV2vParameters({ model_id: "grok_v2v", prompt });
  assert.equal(result.status, "SOURCE_REVIEWED_EXPLICIT_REQUEST_CANDIDATE");
  assert.deepEqual(result.intent, { model_id: "grok_v2v", prompt });
  assert.equal(result.effective_defaults, "UNKNOWN");
  assert.equal(result.runtime_usable, false);
  assert.equal(result.dispatch_allowed, false);
  assert.equal(result.backend_acceptance, "UNPROVEN");
  assert.equal(isOwnerGrokV2vNormalizedParameters(result), true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.intent), true);
  const maxPrompt = "x".repeat(2_000);
  assert.equal(normalizeOwnerGrokV2vParameters({ model_id: "grok_v2v", prompt: maxPrompt }).intent.prompt.length, 2_000);
  rejects({ model_id: "grok_v2v", prompt: "x".repeat(2_001) });
  rejects({ model_id: "grok_v2v", prompt: "  \t " });
  rejects({ model_id: "grok_v2v", prompt: "bad-\ud800" });
  rejects({ model_id: "grok_t2v", prompt });
});

test("measured projection keeps null aspect and rounds source duration to two decimals with pixel threshold", () => {
  const below = projectOwnerGrokV2vMeasuredSettings({ duration_seconds: 1, width: 671, height: 610 });
  assert.deepEqual(below.settings_candidate, {
    model_type: "grok_v2v", aspect_ratio: null, video_duration: 1, resolution: "480p"
  });
  assert.deepEqual(below.cost_parameters_candidate, { video_duration: 1, resolution: "480p" });
  const atThreshold = projectOwnerGrokV2vMeasuredSettings({ duration_seconds: 8.7, width: 672, height: 610 });
  assert.deepEqual(atThreshold.settings_candidate, {
    model_type: "grok_v2v", aspect_ratio: null, video_duration: 8.7, resolution: "720p"
  });
  const decimal = projectOwnerGrokV2vMeasuredSettings({ duration_seconds: 1.239, width: 1, height: 1 });
  assert.equal(decimal.settings_candidate.video_duration, 1.24);
  const jsToFixedBoundary = projectOwnerGrokV2vMeasuredSettings({ duration_seconds: 1.005, width: 640, height: 640 });
  assert.equal(jsToFixedBoundary.settings_candidate.video_duration, Number(Number(1.005).toFixed(2)));
  assert.equal(Object.keys(decimal.settings_candidate).length, 4);
  assert.equal(Object.isFrozen(decimal), true);
  assert.equal(Object.isFrozen(decimal.settings_candidate), true);
  assert.equal(decimal.input_binding, "TRUSTED_OWNER_UPLOAD_RECEIPT_REQUIRED");
  assert.equal(isOwnerGrokV2vMeasuredSettingsCandidate(decimal), true);
  assert.equal(decimal.dispatch_allowed, false);
  for (const forbidden of ["url", "file_urls", "filename", "prompt", "chat_id", "ai_name", "n"]) {
    assert.equal(Object.hasOwn(decimal.settings_candidate, forbidden), false);
  }
});

test("measured projection validates duration bounds, safe integer dimensions, and safe pixel product", () => {
  for (const descriptor of [
    { duration_seconds: 0.999, width: 640, height: 640 },
    { duration_seconds: 8.7001, width: 640, height: 640 },
    { duration_seconds: Number.NaN, width: 640, height: 640 },
    { duration_seconds: Number.POSITIVE_INFINITY, width: 640, height: 640 },
    { duration_seconds: 2, width: 0, height: 640 },
    { duration_seconds: 2, width: 640.5, height: 640 },
    { duration_seconds: 2, width: Number.MAX_SAFE_INTEGER, height: 2 },
    { duration_seconds: 2, width: 640, height: 640, url: "caller-url" }
  ]) projectRejects(descriptor);
});

test("normalizer and measured projection reject getters and proxies without invoking getters", () => {
  let calls = 0;
  const request = Object.defineProperty({}, "model_id", { enumerable: true, get: () => { calls += 1; return "grok_v2v"; } });
  rejects(request);
  const measurement = Object.defineProperty({ width: 640, height: 640 }, "duration_seconds", {
    enumerable: true, get: () => { calls += 1; return 2; }
  });
  projectRejects(measurement);
  rejects(new Proxy({ model_id: "grok_v2v", prompt: "valid prompt" }, {}));
  projectRejects(new Proxy({ duration_seconds: 2, width: 640, height: 640 }, {}));
  assert.equal(calls, 0);
});
