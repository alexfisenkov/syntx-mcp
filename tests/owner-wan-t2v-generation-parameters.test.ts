import test from "node:test";
import assert from "node:assert/strict";
import {
  getOwnerWanT2vGenerationParametersSource,
  normalizeOwnerWanT2vGenerationParameters,
  OwnerWanT2vGenerationParametersError,
  projectOwnerWanT2vGenerationWireCandidate
} from "../src/application/owner-wan-t2v-generation-parameters.js";

const SOURCE_CATALOG = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json";
const SOURCE_SETTINGS = "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json";
const VALID_26 = {
  model_id: "wan_26_t2v",
  prompt: "A paper kite crossing a quiet blue sky",
  parameters: {
    resolution: "720P", aspect_ratio: "16:9", video_duration: 5,
    prompt_extend: true, seed: 0, shot_type: "single"
  }
} as const;
const VALID_27 = {
  model_id: "wan_27_t2v",
  prompt: "A paper kite crossing a quiet blue sky",
  parameters: {
    resolution: "1080P", aspect_ratio: "3:4", video_duration: 15,
    prompt_extend: false, seed: null, native_audio: true
  }
} as const;

test("source contract binds both active T2V IDs to the current B066/1b48 evidence only", () => {
  const source = getOwnerWanT2vGenerationParametersSource();
  assert.deepEqual(source.models.map((model) => model.model_id), ["wan_26_t2v", "wan_27_t2v"]);
  assert.equal(source.source_pins.public_catalog_version, SOURCE_CATALOG);
  assert.equal(source.source_pins.settings_inventory_version, SOURCE_SETTINGS);
  assert.equal(source.source_pins.build_id, "1791811899");
  assert.equal(source.source_pins.form_sha256,
    "sha256:e169fbee16360e0fef359bb96b3498e7ad2db9f43f37e362af138f2787a62f68");
  assert.equal(source.runtime_usable, false);
  assert.equal(source.dispatch_allowed, false);
  assert.equal(source.backend_acceptance, "UNPROVEN");
  assert.equal(source.effective_defaults, "UNKNOWN");
  assert.deepEqual(source.controls.aspect_ratio.values, ["16:9", "9:16", "1:1", "4:3", "3:4"]);
  assert.equal(source.controls.video_duration.minimum, 2);
  assert.equal(source.controls.video_duration.maximum, 15);
  assert.equal(source.models[0]?.branch_control, "shot_type:single|multi");
  assert.equal(source.models[1]?.branch_control, "native_audio:boolean");
  assert.ok(Object.isFrozen(source) && Object.isFrozen(source.models[0]));
});

test("normalizer keeps the source-exact 26 and 27 T2V controls in distinct branches", () => {
  const twentySix = normalizeOwnerWanT2vGenerationParameters(VALID_26);
  const twentySeven = normalizeOwnerWanT2vGenerationParameters(VALID_27);
  assert.deepEqual(twentySix.intent, VALID_26);
  assert.deepEqual(twentySeven.intent, VALID_27);
  assert.deepEqual(twentySix.cost_query_candidate, {
    keys: ["video_duration", "resolution"],
    values: { video_duration: 5, resolution: "720P" },
    confidence: "DECLARED_KEYS_WITH_FORM_FIELD_VALUE_CANDIDATE_NOT_COST_CALLER_JOINED"
  });
  assert.equal(twentySix.status, "SOURCE_REVIEWED_EXPLICIT_INTENT");
  assert.equal(twentySix.dispatch_allowed, false);
  assert.equal(twentySix.backend_acceptance, "UNPROVEN");
  assert.equal(twentySix.effective_defaults, "UNKNOWN");
  assert.ok(Object.isFrozen(twentySix.intent.parameters));
});

test("wire candidate derives model_type and keeps chat binding and provider dispatch absent", () => {
  const normalized = normalizeOwnerWanT2vGenerationParameters(VALID_27);
  assert.deepEqual(projectOwnerWanT2vGenerationWireCandidate(normalized), {
    method: "POST",
    path: "video/generate",
    query_candidate: { ai_name: "wan_video" },
    settings_candidate: {
      model_type: "wan_27_t2v", resolution: "1080P", aspect_ratio: "3:4", video_duration: 15,
      prompt_extend: false, seed: null, native_audio: true, file_urls: []
    },
    prompt_projection: "SOURCE_SENDER_APPLIES_UNJOINED_STRING_REPLACE",
    status: "WIRE_SHAPE_CANDIDATE_NOT_DISPATCHED",
    chat_id_bound: false,
    dispatch_allowed: false,
    backend_acceptance: "UNPROVEN"
  });
});

test("normalizer rejects cross-model fields, caller media, unsupported values, and malformed prompts", () => {
  const reject = (input: unknown) => assert.throws(
    () => normalizeOwnerWanT2vGenerationParameters(input),
    (error: unknown) => error instanceof OwnerWanT2vGenerationParametersError && error.code === "INVALID_PARAMETERS"
  );
  reject({ ...VALID_26, parameters: { ...VALID_26.parameters, native_audio: true } });
  reject({ ...VALID_27, parameters: { ...VALID_27.parameters, shot_type: "single" } });
  reject({ ...VALID_26, file_urls: [] });
  reject({ ...VALID_27, model_type: "wan_26_t2v" });
  reject({ ...VALID_26, parameters: { ...VALID_26.parameters, aspect_ratio: "2:3" } });
  reject({ ...VALID_27, parameters: { ...VALID_27.parameters, resolution: "480P" } });
  reject({ ...VALID_26, parameters: { ...VALID_26.parameters, video_duration: 1 } });
  reject({ ...VALID_27, parameters: { ...VALID_27.parameters, video_duration: 16 } });
  reject({ ...VALID_26, parameters: { ...VALID_26.parameters, seed: -1 } });
  reject({ ...VALID_27, parameters: { ...VALID_27.parameters, seed: 2_147_483_648 } });
  reject({ ...VALID_26, parameters: { ...VALID_26.parameters, prompt_extend: "true" } });
  reject({ ...VALID_27, prompt: "   " });
  reject({ ...VALID_26, prompt: "dangling high surrogate \uD800" });
  reject({ model_id: "wan_25_t2v_preview", prompt: VALID_26.prompt, parameters: VALID_26.parameters });
});

test("strict record inspection rejects accessors, inherited objects, and revoked proxies safely", () => {
  const getterParameters = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(VALID_26.parameters)) {
    Object.defineProperty(getterParameters, key, { enumerable: true, get: () => value });
  }
  assert.throws(() => normalizeOwnerWanT2vGenerationParameters({ ...VALID_26, parameters: getterParameters }),
    OwnerWanT2vGenerationParametersError);
  assert.throws(() => normalizeOwnerWanT2vGenerationParameters(Object.assign(Object.create({ foreign: true }), VALID_26)),
    OwnerWanT2vGenerationParametersError);
  const revoked = Proxy.revocable({ ...VALID_26 }, {});
  revoked.revoke();
  assert.throws(() => normalizeOwnerWanT2vGenerationParameters(revoked.proxy), OwnerWanT2vGenerationParametersError);
  const nestedRevoked = Proxy.revocable({ ...VALID_26.parameters }, {});
  nestedRevoked.revoke();
  assert.throws(() => normalizeOwnerWanT2vGenerationParameters({ ...VALID_26, parameters: nestedRevoked.proxy }),
    OwnerWanT2vGenerationParametersError);
});
