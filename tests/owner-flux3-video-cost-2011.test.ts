import assert from "node:assert/strict";
import test from "node:test";
import * as parametersModule from "../src/application/owner-flux3-video-parameters.js";

test("Flux3 video cost projection contains only explicit resolution and duration", () => {
  const normalized = parametersModule.normalizeOwnerFlux3VideoParameters({
    model_id: "flux3_i2v",
    parameters: { resolution: "fhd", video_duration: 20, generate_audio: true }
  });
  const project = Reflect.get(parametersModule, "projectOwnerFlux3VideoCostParameters");
  assert.equal(typeof project, "function", "the pure video cost projection is available");
  const projected = Reflect.apply(project as (...args: unknown[]) => unknown, undefined, [normalized]);
  assert.deepEqual(projected, { resolution: "fhd", video_duration: 20 });
  assert.deepEqual(Object.keys(projected as object), ["resolution", "video_duration"]);
  assert.equal(Object.isFrozen(projected), true);
  assert.equal(Object.hasOwn(projected as object, "draft"), false);
  assert.equal(Object.hasOwn(projected as object, "n"), false);
  assert.equal(Object.hasOwn(projected as object, "generate_audio"), false);
});

test("Flux3 video cost projection rejects a structurally forged normalized tuple", () => {
  const project = Reflect.get(parametersModule, "projectOwnerFlux3VideoCostParameters");
  assert.equal(typeof project, "function", "the pure video cost projection is available");
  const forged = Object.freeze({ model_id: "flux3_i2v", parameters: { resolution: "hd", video_duration: 5, generate_audio: true } });
  assert.throws(() => Reflect.apply(project as (...args: unknown[]) => unknown, undefined, [forged]),
    (error: unknown) => error instanceof parametersModule.OwnerFlux3VideoParametersError && error.code === "INVALID_PARAMETERS");
});
