import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOwnerKlingI2vWireSettingsTemplate,
  OwnerKlingI2vWireSourceError
} from "../src/application/owner-kling-i2v-wire-source.js";

const PARAMETERS = {
  model_id: "kling_image2video",
  prompt: "A small boat leaving the harbor",
  reference_count: 1,
  version: "3.0",
  mode: "hd",
  video_duration: 5,
  native_audio: false
} as const;

test("projects explicit Kling I2V fields and leaves the owned reference for a private preparer", () => {
  const result = buildOwnerKlingI2vWireSettingsTemplate({ parameters: PARAMETERS, controls: { temperature: 0.5, multi_shots: false } });
  assert.equal(result.prompt, PARAMETERS.prompt);
  assert.deepEqual(result.settings_template, {
    model_type: "kling_image2video",
    version: "3.0",
    mode: "hd",
    video_duration: 5,
    native_audio: false,
    temperature: 0.5,
    multi_shots: false
  });
  assert.deepEqual(result.reference_requirement, {
    required_count: 1,
    wire_type: "image",
    sender_field: "settings.file_urls",
    status: "OWNED_REFERENCE_BINDING_REQUIRED_LATER"
  });
  assert.equal("file_urls" in result.settings_template, false);
  assert.equal("aspect_ratio" in result.settings_template, false);
  assert.equal("gen_type" in result.settings_template, false);
  assert.equal(result.settings_template.temperature, 0.5);
  assert.equal(result.runtime_usable, false);
  assert.equal(result.dispatch_allowed, false);
  assert.equal(result.backend_acceptance, "UNPROVEN");
});

test("requires temperature for every I2V version and preserves it when its control is hidden", () => {
  const turbo = buildOwnerKlingI2vWireSettingsTemplate({
    parameters: { ...PARAMETERS, version: "3.0-turbo" }, controls: { temperature: 0.5 }
  });
  assert.equal("multi_shots" in turbo.settings_template, false);
  assert.equal(turbo.settings_template.temperature, 0.5);

  const v26 = { ...PARAMETERS, version: "2.6", mode: "hd", native_audio: true };
  assert.throws(() => buildOwnerKlingI2vWireSettingsTemplate({ parameters: v26, controls: {} }),
    OwnerKlingI2vWireSourceError);
  const explicit = buildOwnerKlingI2vWireSettingsTemplate({ parameters: v26, controls: { temperature: 0.6 } });
  assert.equal(explicit.settings_template.temperature, 0.6);
  assert.equal("multi_shots" in explicit.settings_template, false);
  assert.throws(() => buildOwnerKlingI2vWireSettingsTemplate({ parameters: PARAMETERS, controls: {} }),
    OwnerKlingI2vWireSourceError);
});

test("requires single-shot mode at version 3.0 and validates the source temperature range", () => {
  const reject = (controls: unknown) => assert.throws(
    () => buildOwnerKlingI2vWireSettingsTemplate({ parameters: PARAMETERS, controls }),
    OwnerKlingI2vWireSourceError
  );
  reject({ temperature: 0.5, multi_shots: true });
  reject({ temperature: 0.5 });
  reject({ multi_shots: false });
  reject({ temperature: -0.1, multi_shots: false });
  reject({ temperature: 1.1, multi_shots: false });
  reject({ temperature: 0.55, multi_shots: false });
  const singleShot = buildOwnerKlingI2vWireSettingsTemplate({
    parameters: PARAMETERS, controls: { temperature: 1, multi_shots: false }
  });
  assert.equal(singleShot.settings_template.multi_shots, false);
});

test("rejects caller URL fields, model-only controls, and unsafe control records", () => {
  const reject = (input: unknown) => assert.throws(
    () => buildOwnerKlingI2vWireSettingsTemplate(input),
    (error: unknown) => error instanceof OwnerKlingI2vWireSourceError && error.code === "INVALID_WIRE_INPUT"
  );
  reject({ parameters: PARAMETERS, controls: { temperature: 0.5, multi_shots: false }, image_url: "https://caller.example/image.jpg" });
  reject({ parameters: PARAMETERS, controls: { temperature: 0.5, multi_shots: false, gen_type: "mci" } });
  reject({ parameters: { ...PARAMETERS, version: "3.0-turbo" }, controls: { temperature: 0.5, multi_shots: false } });
  reject({ parameters: { ...PARAMETERS, version: "1.6", mode: "standart" }, controls: { temperature: Infinity } });
  reject({ parameters: { ...PARAMETERS, version: "1.6", mode: "standart" }, controls: Object.defineProperty({}, "temperature", {
    enumerable: true, get: () => 0.5
  }) });
});
