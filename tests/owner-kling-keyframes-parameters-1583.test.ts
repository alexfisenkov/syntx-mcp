import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerKlingKeyframesParametersSource,
  normalizeOwnerKlingKeyframesParameters,
  OwnerKlingKeyframesParametersError
} from "../src/application/owner-kling-keyframes-parameters.js";
import {
  buildOwnerKlingKeyframesWireSettingsTemplate,
  OwnerKlingKeyframesWireSourceError
} from "../src/application/owner-kling-keyframes-wire-source.js";

const PARAMETERS = {
  model_id: "kling_keyframes",
  version: "2.1",
  mode: "hd",
  video_duration: 10,
  native_audio: false,
  aspect_ratio: null
} as const;

test("source pins the six current Keyframes UI versions and distinguishes cached spellings", () => {
  const source = getOwnerKlingKeyframesParametersSource();
  assert.deepEqual(source.controls.version.values, ["1.5", "1.6", "2.1", "2.5", "2.6", "3.0"]);
  assert.equal(source.controls.version.current_option_2_5, "ENABLED" );
  assert.equal(source.controls.version.cached_2_5_turbo, "DISTINCT_UNPROVEN_ALIAS");
  assert.deepEqual(source.controls.mode.values, ["standart", "hd", "4K"]);
  assert.deepEqual(source.controls.video_duration.standard_values, [5, 10]);
  assert.deepEqual(source.controls.video_duration.version_3_values, Array.from({ length: 13 }, (_, i) => i + 3));
  assert.equal(source.controls.aspect_ratio.visible_control, "HIDDEN");
  assert.equal(source.controls.aspect_ratio.effective_cache, "UNKNOWN");
  assert.equal(source.backend_acceptance, "UNPROVEN");
  assert.equal(source.runtime_usable, false);
  assert.equal(source.dispatch_allowed, false);
});

test("normalizes explicit closed Keyframes intent without inventing defaults or claiming cost", () => {
  const normalized = normalizeOwnerKlingKeyframesParameters(PARAMETERS);
  assert.deepEqual(normalized.intent, {
    model_id: "kling_keyframes", version: "2.1", mode: "hd", video_duration: 10,
    native_audio: false, aspect_ratio: null
  });
  assert.deepEqual(normalized.cost_query_candidate, {
    keys: ["version", "mode", "video_duration", "native_audio"],
    values: { version: "2.1", mode: "hd", video_duration: 10, native_audio: false },
    amount_or_quote: "UNPROVEN"
  });
  assert.equal(normalized.runtime_usable, false);
  assert.equal(normalized.dispatch_allowed, false);
  assert.equal(normalized.backend_acceptance, "UNPROVEN");
  assert.throws(() => normalizeOwnerKlingKeyframesParameters({ ...PARAMETERS, version: "2.5-turbo" }), OwnerKlingKeyframesParametersError);
  assert.throws(() => normalizeOwnerKlingKeyframesParameters({ ...PARAMETERS, aspect_ratio: undefined }), OwnerKlingKeyframesParametersError);
});

test("accepts the exact source versions, modes, and duration bounds", () => {
  const accepts = (patch: Record<string, unknown>) => normalizeOwnerKlingKeyframesParameters({ ...PARAMETERS, ...patch });
  for (const version of ["1.5", "1.6", "2.1", "2.5", "2.6"]) {
    for (const video_duration of [5, 10]) accepts({ version, video_duration, mode: "hd" });
  }
  accepts({ version: "3.0", video_duration: 3, mode: "standart" });
  accepts({ version: "3.0", video_duration: 15, mode: "4K" });
  const reject = (patch: Record<string, unknown>) => assert.throws(
    () => accepts(patch),
    (error: unknown) => error instanceof OwnerKlingKeyframesParametersError && error.code === "INVALID_PARAMETERS"
  );
  reject({ version: "1.4" });
  reject({ version: "1.6", mode: "standart" });
  reject({ version: "2.5", mode: "4K" });
  reject({ version: "3.0", video_duration: 2 });
  reject({ version: "3.0", video_duration: 16 });
  reject({ version: "2.6", native_audio: true });
  accepts({ version: "3.0", native_audio: true });
});

test("projects only explicit settings, omits a null aspect ratio, and validates versioned controls", () => {
  const projected = buildOwnerKlingKeyframesWireSettingsTemplate({ parameters: PARAMETERS, controls: { temperature: 0.6 } });
  assert.deepEqual(projected.settings_template, {
    model_type: "kling_keyframes", version: "2.1", mode: "hd", video_duration: 10,
    native_audio: false, temperature: 0.6
  });
  assert.equal("aspect_ratio" in projected.settings_template, false);
  assert.equal("prompt" in projected, false);
  assert.equal("file_urls" in projected.settings_template, false);
  assert.equal(projected.runtime_usable, false);

  for (const aspect_ratio of ["16:9", "1:1", "9:16"] as const) {
    const result = buildOwnerKlingKeyframesWireSettingsTemplate({ parameters: { ...PARAMETERS, aspect_ratio }, controls: { temperature: 0 } });
    assert.equal(result.settings_template.aspect_ratio, aspect_ratio);
  }
  const v3 = buildOwnerKlingKeyframesWireSettingsTemplate({
    parameters: { ...PARAMETERS, version: "3.0", mode: "hd", video_duration: 15, native_audio: true },
    controls: { temperature: 1, multi_shots: true }
  });
  assert.equal(v3.settings_template.multi_shots, true);
  assert.equal(v3.settings_template.native_audio, true);
  assert.throws(() => buildOwnerKlingKeyframesWireSettingsTemplate({ parameters: PARAMETERS, controls: { temperature: 0.55 } }), OwnerKlingKeyframesWireSourceError);
  assert.throws(() => buildOwnerKlingKeyframesWireSettingsTemplate({
    parameters: { ...PARAMETERS, version: "3.0" }, controls: { temperature: 0.5 }
  }), OwnerKlingKeyframesWireSourceError);
  assert.throws(() => buildOwnerKlingKeyframesWireSettingsTemplate({
    parameters: PARAMETERS, controls: { temperature: 0.5, multi_shots: false }
  }), OwnerKlingKeyframesWireSourceError);
});

test("accepts only the four closed camera presets or one bounded active axis for 1.5 HD", () => {
  const base = { ...PARAMETERS, version: "1.5", mode: "hd", video_duration: 5 };
  const camera = (type: string, horizontal: number, vertical: number, zoom: number, tilt: number, pan: number, roll: number) =>
    ({ type, horizontal, vertical, zoom, tilt, pan, roll });
  const cameras = [
    camera("down_back", 0, -10, -10, 0, 0, 0),
    camera("forward_up", 0, 10, 10, 0, 0, 0),
    camera("right_turn_forward", 0, 0, 10, 0, -10, 0),
    camera("left_turn_forward", 0, 0, 10, 0, 10, 0),
    camera("horizontal", 2.3, 0, 0, 0, 0, 0),
    camera("vertical", 0, -0.1, 0, 0, 0, 0),
    camera("zoom", 0, 0, 10, 0, 0, 0),
    camera("tilt", 0, 0, 0, -10, 0, 0),
    camera("pan", 0, 0, 0, 0, 10, 0),
    camera("roll", 0, 0, 0, 0, 0, 0.1)
  ];
  for (const camera_movement of cameras) {
    const result = buildOwnerKlingKeyframesWireSettingsTemplate({
      parameters: base, controls: { temperature: 0.5, camera_movement }
    });
    assert.deepEqual(result.settings_template.camera_movement, camera_movement);
  assert.ok(Object.isFrozen(result.settings_template.camera_movement));
  }
  const reject = (camera_movement: unknown) => assert.throws(() =>
    buildOwnerKlingKeyframesWireSettingsTemplate({ parameters: base, controls: { temperature: 0.5, camera_movement } }),
  OwnerKlingKeyframesWireSourceError);
  reject({ type: "random", horizontal: 0, vertical: 0, zoom: 0, tilt: 0, pan: 0, roll: 0 });
  reject(camera("toString", 0, 0, 0, 0, 0, 0));
  reject(camera("constructor", 0, 0, 0, 0, 0, 0));
  reject(camera("__proto__", 0, 0, 0, 0, 0, 0));
  reject(camera("horizontal", 1.1, 1, 0, 0, 0, 0));
  reject(camera("down_back", 0, -10, -9.9, 0, 0, 0));
  reject({ ...camera("pan", 0, 0, 0, 0, 1, 0), extra: true });
  const getter = Object.defineProperty({}, "temperature", { enumerable: true, get: () => 0.5 });
  assert.throws(() => buildOwnerKlingKeyframesWireSettingsTemplate({ parameters: base, controls: getter }), OwnerKlingKeyframesWireSourceError);
  const proxy = new Proxy({ temperature: 0.5 }, {});
  assert.throws(() => buildOwnerKlingKeyframesWireSettingsTemplate({ parameters: base, controls: proxy }), OwnerKlingKeyframesWireSourceError);
  assert.throws(() => buildOwnerKlingKeyframesWireSettingsTemplate({
    parameters: { ...base, version: "1.6" }, controls: { temperature: 0.5, camera_movement: cameras[4] }
  }), OwnerKlingKeyframesWireSourceError);
});
