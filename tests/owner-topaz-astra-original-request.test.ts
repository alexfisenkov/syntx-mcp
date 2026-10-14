import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOwnerTopazAstraParameters, OwnerTopazAstraParametersError } from "../src/application/owner-topaz-astra-parameters.js";
import { validateOwnerTopazAstraOriginalInput, OwnerTopazAstraOriginalReferencePolicyError } from "../src/application/owner-topaz-astra-original-reference-policy.js";
import { prepareOwnerTopazAstraRequest } from "../src/application/owner-topaz-astra-request-preparer.js";
import { evaluateOwnerTopazAstraOneShotPolicy } from "../src/application/owner-topaz-astra-one-shot-policy.js";

const PARAMETERS = Object.freeze({ model_id: "slc-1", prompt: "Clean, natural detail.", parameters: {
  resolution: "1920x1080", frame_rate: 24, slowmo: null, creativity: "middle"
} });

function mp4Header(): Uint8Array {
  const bytes = new Uint8Array(16);
  new DataView(bytes.buffer).setUint32(0, 16, false);
  bytes.set([0x66, 0x74, 0x79, 0x70], 4);
  bytes.set([0x69, 0x73, 0x6f, 0x6d], 8);
  return bytes;
}

test("Topaz Astra parameters accept only explicit pinned control values", () => {
  const actual = normalizeOwnerTopazAstraParameters(PARAMETERS);
  assert.deepEqual(actual, PARAMETERS);
  assert.equal(Object.isFrozen(actual), true);
  assert.equal(Object.isFrozen(actual.parameters), true);
  assert.equal(normalizeOwnerTopazAstraParameters({ ...PARAMETERS, prompt: "" }).prompt, "");
  assert.throws(() => normalizeOwnerTopazAstraParameters({ ...PARAMETERS, parameters: { ...PARAMETERS.parameters, frame_rate: 25 } }),
    OwnerTopazAstraParametersError);
  assert.throws(() => normalizeOwnerTopazAstraParameters({ ...PARAMETERS, model_id: "topaz_enhance" }), OwnerTopazAstraParametersError);
  assert.throws(() => normalizeOwnerTopazAstraParameters({ ...PARAMETERS, prompt: "\ud800" }), OwnerTopazAstraParametersError);
});

test("Topaz original validation applies the one-file MIME/size/duration/frame bounds without claiming probing", () => {
  const actual = validateOwnerTopazAstraOriginalInput({ model_id: "slc-1", filename: "source.mp4", mime_type: "video/mp4",
    bytes: mp4Header(), reported_duration_seconds: 25, reported_frame_count: 450 });
  assert.equal(actual.container_check, "ISO_BMFF_FTYP_HEADER_ONLY");
  assert.equal(actual.metadata_confidence, "CALLER_REPORTED_NOT_PROBED");
  assert.equal(actual.dispatch_allowed, false);
  assert.equal(actual.runtime_usable, false);
  assert.throws(() => validateOwnerTopazAstraOriginalInput({ model_id: "slc-1", filename: "source.mp4", mime_type: "video/webm",
    bytes: mp4Header(), reported_duration_seconds: 1, reported_frame_count: 1 }), OwnerTopazAstraOriginalReferencePolicyError);
  assert.throws(() => validateOwnerTopazAstraOriginalInput({ model_id: "slc-1", filename: "source.mp4", mime_type: "video/mp4",
    bytes: mp4Header(), reported_duration_seconds: 25.01, reported_frame_count: 1 }), OwnerTopazAstraOriginalReferencePolicyError);
  assert.throws(() => validateOwnerTopazAstraOriginalInput({ model_id: "slc-1", filename: "source.mp4", mime_type: "video/mp4",
    bytes: mp4Header(), reported_duration_seconds: 1, reported_frame_count: 451 }), OwnerTopazAstraOriginalReferencePolicyError);
  assert.throws(() => validateOwnerTopazAstraOriginalInput({ model_id: "slf-2", filename: "source.mov", mime_type: "video/quicktime",
    bytes: mp4Header(), reported_duration_seconds: 25, reported_frame_count: 9001 }), OwnerTopazAstraOriginalReferencePolicyError);
});

test("Topaz preparer exposes source-known transport shape but produces no dispatchable body or upload URL", () => {
  const candidate = prepareOwnerTopazAstraRequest(PARAMETERS);
  assert.equal(candidate.status, "blocked");
  assert.equal(candidate.source_build_id, "1791904852");
  assert.equal(candidate.path, "video/generate");
  assert.deepEqual(candidate.query, { ai_name: "topaz_astra" });
  assert.deepEqual(candidate.body_fields, ["chat_id", "prompt", "settings"]);
  assert.deepEqual(candidate.missing_evidence, ["prompt_caller_binding", "genuine_topaz_owned_upload_binding", "trusted_duration_and_frame_probe"]);
  assert.equal("settings" in candidate, false);
  assert.equal("file_urls" in candidate, false);
  assert.equal(candidate.dispatch_allowed, false);
  assert.deepEqual(evaluateOwnerTopazAstraOneShotPolicy(candidate), {
    decision: "BLOCK", reason: "TOPAZ_OWNED_UPLOAD_AND_PROMPT_BINDINGS_UNPROVEN", dispatch_allowed: false, replay_allowed: false
  });
  assert.throws(() => prepareOwnerTopazAstraRequest({ ...PARAMETERS, extra: "caller URL" }), OwnerTopazAstraParametersError);
});
