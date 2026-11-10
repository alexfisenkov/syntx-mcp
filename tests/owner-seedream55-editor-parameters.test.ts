import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOwnerSeedream55EditorParameters, projectOwnerSeedream55EditorCost,
  OwnerSeedream55EditorParametersError } from "../src/application/owner-seedream55-editor-parameters.js";

test("Seedream 5.5 Editor uses exact four controls and drawing-sensitive cost", () => {
  const parameters = { aspect_ratio: "3:4", resolution: "1.5K", output_format: "png", background: "transparent" };
  assert.deepEqual(normalizeOwnerSeedream55EditorParameters(parameters), parameters);
  assert.deepEqual(projectOwnerSeedream55EditorCost({ parameters, drawing_present: false }), { batch_size: 1, resolution: "1.5K" });
  assert.deepEqual(projectOwnerSeedream55EditorCost({ parameters, drawing_present: true }), { batch_size: 2, resolution: "1.5K" });
  for (const bad of [
    { ...parameters, resolution: "3K" }, { ...parameters, output_format: "jpeg" },
    { ...parameters, background: "unknown" }, { aspect_ratio: "3:4", resolution: "1.5K" }
  ]) assert.throws(() => normalizeOwnerSeedream55EditorParameters(bad), OwnerSeedream55EditorParametersError);
});
