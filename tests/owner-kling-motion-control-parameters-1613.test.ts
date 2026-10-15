import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerKlingMotionControlParametersSource,
  normalizeOwnerKlingMotionControlParameters,
  OwnerKlingMotionControlParametersError
} from "../src/application/owner-kling-motion-control-parameters.js";
import {
  buildOwnerKlingMotionControlWireSettingsTemplate,
  OwnerKlingMotionControlWireSourceError
} from "../src/application/owner-kling-motion-control-wire-source.js";

const PARAMETERS = {
  model_id: "kling_motion_control",
  version: "2.6",
  mode: "hd",
  gen_type: "mcv",
  native_audio: false,
  video_duration: 30
} as const;

test("pins current MCV source facts and explicit omission boundaries", () => {
  const source = getOwnerKlingMotionControlParametersSource();
  assert.deepEqual(source.controls.version.values, ["2.6", "3.0"]);
  assert.deepEqual(source.controls.mode.values, ["standart", "hd"]);
  assert.deepEqual(source.controls.gen_type.values, ["mcv", "mci"]);
  assert.deepEqual(source.controls.native_audio.values, [false, true]);
  assert.equal(source.controls.video_duration.min, 3);
  assert.deepEqual(source.controls.video_duration.max_by_gen_type, { mci: 10, mcv: 30 });
  assert.equal(source.controls.video_duration.unit, "INTEGER_SECONDS");
  assert.equal(source.controls.video_duration.applies_to_raw_input_duration, true);
  assert.equal(source.controls.video_duration.source_caps_are_upload_constraints, true);
  assert.equal(source.omissions.temperature, "EXPLICITLY_DELETED_FOR_MCV");
  assert.equal(source.omissions.aspect_ratio, "CLEARED_FOR_RESOLVED_MOTION_CONTROL_INPUT");
  assert.equal(source.runtime_usable, false);
  assert.equal(source.backend_acceptance, "UNPROVEN");
});

test("normalizes only complete, closed explicit MCV intent and derives five-key cost candidate", () => {
  const normalized = normalizeOwnerKlingMotionControlParameters(PARAMETERS);
  assert.deepEqual(normalized.intent, PARAMETERS);
  assert.deepEqual(normalized.cost_query_candidate, {
    keys: ["mode", "video_duration", "version", "native_audio", "gen_type"],
    values: { mode: "hd", video_duration: 30, version: "2.6", native_audio: false, gen_type: "mcv" },
    amount_or_quote: "UNPROVEN"
  });
  assert.equal(normalized.runtime_usable, false);
  assert.equal(normalized.dispatch_allowed, false);
  const reject = (input: unknown) => assert.throws(
    () => normalizeOwnerKlingMotionControlParameters(input),
    (error: unknown) => error instanceof OwnerKlingMotionControlParametersError && error.code === "INVALID_PARAMETERS"
  );
  reject({ ...PARAMETERS, mode: "4K" });
  reject({ ...PARAMETERS, temperature: 0.5 });
  reject({ ...PARAMETERS, aspect_ratio: "16:9" });
  reject({ ...PARAMETERS, motion: "https://example.invalid/video.mp4" });
  reject({ ...PARAMETERS, version: undefined });
});

test("accepts exact source bounds for both versions and gen types and rejects out-of-range durations", () => {
  for (const version of ["2.6", "3.0"] as const) {
    for (const mode of ["standart", "hd"] as const) {
      for (const native_audio of [false, true]) {
        for (const [gen_type, max] of [["mci", 10], ["mcv", 30]] as const) {
          for (const video_duration of [3, max]) {
            normalizeOwnerKlingMotionControlParameters({ ...PARAMETERS, version, mode, native_audio, gen_type, video_duration });
          }
          for (const video_duration of [2, max + 1]) {
            assert.throws(() => normalizeOwnerKlingMotionControlParameters({ ...PARAMETERS, version, mode, native_audio, gen_type, video_duration }), OwnerKlingMotionControlParametersError);
          }
        }
      }
    }
  }
});

test("projects only the closed MCV wire settings and preserves optional raw prompt including empty string", () => {
  const projected = buildOwnerKlingMotionControlWireSettingsTemplate({ parameters: PARAMETERS, prompt: "" });
  assert.deepEqual(projected, {
    status: "CURRENT_1791904852_SOURCE_ONLY_SETTINGS_TEMPLATE",
    source: {
      status: "CURRENT_1791904852_SOURCE_ONLY_SETTINGS_TEMPLATE",
      source_pins: getOwnerKlingMotionControlParametersSource().source_pins,
      settings_keys: ["model_type", "version", "mode", "gen_type", "native_audio", "video_duration"],
      model_type_binding: "EXPLICIT_MODEL_ID_KLING_MOTION_CONTROL",
      prompt: "OPTIONAL_RAW_STRING_NO_NORMALIZATION",
      references: {
        caller_urls_accepted: false,
        file_urls_projected: false,
        preset_motion: "FUTURE_PREPARER_MUST_RESOLVE_TO_TYPED_VIDEO_REFERENCE",
        own_video: "FUTURE_PREPARER_MUST_RESOLVE_TO_TYPED_OWNED_VIDEO_REFERENCE"
      },
      runtime_usable: false,
      dispatch_allowed: false,
      backend_acceptance: "UNPROVEN"
    },
    settings_template: {
      model_type: "kling_motion_control", version: "2.6", mode: "hd", gen_type: "mcv",
      native_audio: false, video_duration: 30
    },
    prompt: "",
    runtime_usable: false,
    dispatch_allowed: false,
    backend_acceptance: "UNPROVEN"
  });
  assert.equal("file_urls" in projected.settings_template, false);
  assert.equal("motion" in projected.settings_template, false);
  assert.equal("prompt" in buildOwnerKlingMotionControlWireSettingsTemplate({ parameters: PARAMETERS }), false);
  assert.throws(() => buildOwnerKlingMotionControlWireSettingsTemplate({ parameters: PARAMETERS, prompt: 3 }), OwnerKlingMotionControlWireSourceError);
  assert.throws(() => buildOwnerKlingMotionControlWireSettingsTemplate({ parameters: PARAMETERS, references: [] }), OwnerKlingMotionControlWireSourceError);
  const accessor = Object.defineProperty({ ...PARAMETERS }, "model_id", { enumerable: true, get: () => PARAMETERS.model_id });
  assert.throws(() => normalizeOwnerKlingMotionControlParameters(accessor), OwnerKlingMotionControlParametersError);
  assert.throws(() => buildOwnerKlingMotionControlWireSettingsTemplate(new Proxy({ parameters: PARAMETERS }, {})), OwnerKlingMotionControlWireSourceError);
});
