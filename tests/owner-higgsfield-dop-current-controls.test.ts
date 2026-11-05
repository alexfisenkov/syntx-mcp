import assert from "node:assert/strict";
import test from "node:test";
import { OWNER_HIGGSFIELD_DOP_CURRENT_CONTROLS } from "../src/application/owner-higgsfield-dop-current-controls.js";
import { getOwnerHiggsfieldDopSourceProfile, normalizeOwnerHiggsfieldDopParameters } from "../src/application/owner-higgsfield-dop-parameters.js";
import { buildOwnerHiggsfieldDopWire } from "../src/application/owner-higgsfield-dop-wire.js";

const input = { model_id: "dop-lite", prompt: "Preserve legacy DOP controls", enhance_prompt: false,
  motions: [{ id: 17, label: "Soft orbit", strength: 1 }] };
const image = { url: "https://r2.syntx.ai/dop-controls/owned.png", sha256: "a".repeat(64), width: 90, height: 160 };

test("current DOP controls retain the byte-derived legacy profile and false/strength1 fingerprints", () => {
  assert.equal(getOwnerHiggsfieldDopSourceProfile().source_sha256, "sha256:093ab54498b48ff40976dbf879a400e67173724f2588d10540d204d39eba2b02");
  const old = buildOwnerHiggsfieldDopWire(input, image);
  assert.equal(old.intent_fingerprint, "sha256:2dfb2023f95a721feadc9558257103818ead058e74da4e250c9c969633049a03");
  assert.equal(old.wire_fingerprint, "sha256:b8488d4cac850db9da2d8ac404d760b0d3f2efa3bb4be9ad37140a95cfe07c34");
  assert.equal(OWNER_HIGGSFIELD_DOP_CURRENT_CONTROLS.source.build_id, "1793890358");
  assert.equal(OWNER_HIGGSFIELD_DOP_CURRENT_CONTROLS.provider_acceptance, "UNPROVEN");
});

test("both checkbox values and finite motion strength bounds preserve explicit values and bind semantic fingerprints", () => {
  for (const enhance_prompt of [false, true]) for (const strength of [0, 0.01, 0.375, 1]) {
    const request = { ...input, enhance_prompt, motions: [{ ...input.motions[0]!, strength }] };
    const normalized = normalizeOwnerHiggsfieldDopParameters(request);
    const wire = buildOwnerHiggsfieldDopWire(request, image);
    assert.equal(normalized.intent.enhance_prompt, enhance_prompt); assert.equal(wire.wire.settings.enhance_prompt, enhance_prompt);
    assert.equal(wire.wire.settings.motions[0]?.strength, strength);
    if (enhance_prompt || strength !== 1) assert.notEqual(wire.profile_sha256, getOwnerHiggsfieldDopSourceProfile().source_sha256);
    const opposite = buildOwnerHiggsfieldDopWire({ ...request, enhance_prompt: !enhance_prompt }, image);
    assert.notEqual(wire.intent_fingerprint, opposite.intent_fingerprint);
  }
  for (const strength of [-0.001, 1.001, Infinity, -Infinity, NaN, "0.5", null]) {
    assert.throws(() => normalizeOwnerHiggsfieldDopParameters({ ...input, motions: [{ ...input.motions[0]!, strength }] }), { code: "INVALID_PARAMETERS" });
  }
  for (const enhance_prompt of [undefined, 1, "true", null]) {
    assert.throws(() => normalizeOwnerHiggsfieldDopParameters({ ...input, enhance_prompt }), { code: "INVALID_PARAMETERS" });
  }
});
