import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOwnerWan30EditGenerationIntent } from "../src/application/owner-wan30-edit-generation-parameters.js";
import { normalizeOwnerWan30FirstLastGenerationIntent } from "../src/application/owner-wan30-first-last-generation-parameters.js";
import { normalizeOwnerWan30OmniGenerationIntent } from "../src/application/owner-wan30-omni-generation-parameters.js";
import { normalizeOwnerWan30ReferenceGenerationIntent } from "../src/application/owner-wan30-reference-generation-parameters.js";

test("WAN30 reference families reject caller supplied provider markers", () => {
  const base = { aspect_ratio: "16:9", resolution: "480P", video_duration: 2, prompt_extend: true,
    seed: null, native_audio: false, rendering_speed: "basic" };
  const cases = [
    [normalizeOwnerWan30EditGenerationIntent, { ...base, shot_type: "single", audio_setting: "auto", native_audio: true, duration: 2 }],
    [normalizeOwnerWan30FirstLastGenerationIntent, base],
    [normalizeOwnerWan30OmniGenerationIntent, { ...base, shot_type: "single", audio_setting: "auto", duration: 0 }],
    [normalizeOwnerWan30ReferenceGenerationIntent, { ...base, shot_type: "single", audio_setting: "auto", duration: 0 }]
  ] as const;
  for (const [normalize, parameters] of cases) {
    assert.doesNotThrow(() => normalize({ prompt: "Animate https://example.com", parameters }));
    assert.throws(() => normalize({ prompt: "Animate <<<https://example.com/foreign.mp4>>>", parameters }));
  }
});
