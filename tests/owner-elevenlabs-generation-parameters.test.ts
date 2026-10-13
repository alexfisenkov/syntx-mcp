import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { OwnerElevenLabsVoiceReference } from "../src/application/owner-elevenlabs-generation-parameters.js";

const MODULE_URL = new URL("../src/application/owner-elevenlabs-generation-parameters.js", import.meta.url).href;
const parameterModule = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const PUBLIC_VERSION = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json";
const SETTINGS_VERSION = "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json";
const TTS_MODELS = ["eleven_multilingual_v2", "eleven_v3", "eleven_v4", "eleven_v4_turbo"] as const;
const DIALOGUE_MODELS = ["eleven_v3", "eleven_v4", "eleven_v4_turbo"] as const;
const VOICE_A = "test-owner-voice-ref-a" as unknown as OwnerElevenLabsVoiceReference;
const VOICE_B = "test-owner-voice-ref-b" as unknown as OwnerElevenLabsVoiceReference;

function api(): {
  getOwnerElevenLabsGenerationParameterProfile: () => Record<string, any>;
  normalizeOwnerElevenLabsGenerationParameters: (input: unknown) => Record<string, any>;
  OwnerElevenLabsGenerationParametersError: new (...args: any[]) => Error & { code: string };
} {
  assert.ok(parameterModule, "MISSING_OWNER_ELEVENLABS_GENERATION_PARAMETERS_MODULE");
  return parameterModule as ReturnType<typeof api>;
}

function voiceRef(value: string): OwnerElevenLabsVoiceReference {
  // The later owner-authorized selector will supply this opaque nominal value.
  // These are synthetic test-only references, not provider voice IDs.
  return value as unknown as OwnerElevenLabsVoiceReference;
}

function normalize(input: unknown): Record<string, any> {
  return api().normalizeOwnerElevenLabsGenerationParameters(input);
}

function invalid(input: unknown): void {
  const { OwnerElevenLabsGenerationParametersError } = api();
  assert.throws(() => normalize(input), (error: unknown) =>
    error instanceof OwnerElevenLabsGenerationParametersError && error.code === "INVALID_PARAMETERS");
}

test("publishes the current B066/1b48 model modes and limits without runtime authority", () => {
  const source = api().getOwnerElevenLabsGenerationParameterProfile();
  const publicCatalog = JSON.parse(readFileSync(join(process.cwd(), "catalog/public", PUBLIC_VERSION), "utf8")) as {
    models: Array<{ ai_name: string; active: boolean; value: string; settings: Record<string, unknown> }>;
  };
  const settingsInventory = JSON.parse(readFileSync(join(process.cwd(), "catalog/settings/v2", SETTINGS_VERSION), "utf8")) as {
    models: Array<{ ai_name: string; active: boolean; model_id: string; settings: Record<string, unknown> }>;
  };

  assert.equal(source.source_binding.public_catalog_version, PUBLIC_VERSION);
  assert.equal(source.source_binding.settings_inventory_version, SETTINGS_VERSION);
  assert.equal(source.source_binding.build_id, "1791811899");
  assert.equal(source.source_binding.form_module.bytes, 32647);
  assert.equal(source.source_binding.form_module.sha256,
    "sha256:17a2018ebc2211457988afd7dcc45f52752e076b6e83d37cb47c6d9f6df9cbb1");
  assert.deepEqual(source.tts_model_ids, TTS_MODELS);
  assert.deepEqual(source.dialogue_model_ids, DIALOGUE_MODELS);
  assert.deepEqual(source.deferred_model_ids, ["eleven_multilingual_sts_v2"]);
  for (const modelId of [...TTS_MODELS, "eleven_multilingual_sts_v2"] as const) {
    const publicModel = publicCatalog.models.find((row) => row.ai_name === "elevenlabs" && row.value === modelId);
    const settingsModel = settingsInventory.models.find((row) => row.model_id === modelId);
    assert.ok(publicModel, `missing public model ${modelId}`);
    assert.ok(settingsModel, `missing paired settings model ${modelId}`);
    assert.equal(publicModel.active, true);
    assert.equal(settingsModel.active, true);
    assert.deepEqual(source.models[modelId].allowed_modes, publicModel.settings.allowed_modes);
    assert.deepEqual(source.models[modelId].allowed_modes, settingsModel.settings.allowed_modes);
    assert.deepEqual(source.models[modelId].limits, {
      max_prompt_length: publicModel.settings.max_prompt_length,
      dialogue_prompt_limit: publicModel.settings.dialogue_prompt_limit ?? null,
      dialogue_max_inputs: publicModel.settings.dialogue_max_inputs ?? null
    });
  }
  assert.equal(source.models.eleven_multilingual_v2.limits.max_prompt_length, 5000);
  assert.equal(source.models.eleven_v3.limits.dialogue_prompt_limit, 4000);
  assert.equal(source.models.eleven_v4.limits.dialogue_prompt_limit, 10000);
  assert.equal(source.models.eleven_v4_turbo.limits.dialogue_prompt_limit, 10000);
  assert.equal(source.runtime_usable, false);
  assert.equal(source.generation_allowed, false);
  assert.equal(source.dispatch_allowed, false);
  assert.equal(source.backend_acceptance, "UNPROVEN");
  assert.equal(Object.isFrozen(source), true);
  assert.equal(Object.isFrozen(source.models.eleven_v4.limits), true);
});

test("normalizes TTS prompt length as UTF-16 and emits only an unresolved voice reference candidate", () => {
  const prompt = "a".repeat(4998) + "😀";
  const normalized = normalize({
    model_id: "eleven_multilingual_v2",
    mode: "text_to_speech",
    prompt,
    voice_ref: voiceRef(VOICE_A),
    stability: 0,
    similarity_boost: 1
  });

  assert.equal(normalized.prompt, prompt);
  assert.equal(normalized.settings_candidate.model_type, "eleven_multilingual_v2");
  assert.equal(normalized.settings_candidate.mode, "text_to_speech");
  assert.equal(normalized.settings_candidate.chars_count, 5000);
  assert.equal(normalized.settings_candidate.voice_ref, VOICE_A);
  assert.equal(normalized.settings_candidate.stability, 0);
  assert.equal(normalized.settings_candidate.similarity_boost, 1);
  assert.equal(Object.hasOwn(normalized.settings_candidate, "voice_id"), false);
  assert.equal(Object.hasOwn(normalized.settings_candidate, "voice_name"), false);
  assert.equal(Object.hasOwn(normalized.settings_candidate, "language_code"), false);
  assert.equal(normalized.generation_allowed, false);
  assert.equal(normalized.dispatch_allowed, false);
  assert.equal(normalized.backend_acceptance, "UNPROVEN");
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.settings_candidate), true);
});

test("applies the model-specific TTS prompt boundary without counting Unicode code points", () => {
  assert.equal(normalize({
    model_id: "eleven_v4",
    mode: "text_to_speech",
    prompt: "a".repeat(9998) + "😀",
    voice_ref: voiceRef(VOICE_A),
    stability: 0.5,
    similarity_boost: 0.5
  }).settings_candidate.chars_count, 10000);

  invalid({ model_id: "eleven_v3", mode: "text_to_speech", prompt: "a".repeat(5001), voice_ref: VOICE_A,
    stability: 0.5, similarity_boost: 0.5 });
  invalid({ model_id: "eleven_v4_turbo", mode: "text_to_speech", prompt: "a".repeat(10001), voice_ref: VOICE_A,
    stability: 0.5, similarity_boost: 0.5 });
  invalid({ model_id: "eleven_v3", mode: "text_to_speech", prompt: "   ", voice_ref: VOICE_A,
    stability: 0.5, similarity_boost: 0.5 });
});

test("normalizes dialogue while preserving speaker text and excluding names and voice refs from the count", () => {
  const inputs = [
    { name: "", text: "A😀", voice_ref: voiceRef(VOICE_A) },
    { name: "Second speaker", text: "Б", voice_ref: voiceRef(VOICE_B) }
  ];
  const normalized = normalize({
    model_id: "eleven_v3",
    mode: "text_to_dialogue",
    inputs,
    stability: 0.25,
    similarity_boost: 0.75
  });

  assert.equal(normalized.settings_candidate.chars_count, 4);
  assert.deepEqual(normalized.settings_candidate.inputs, inputs);
  assert.equal(api().getOwnerElevenLabsGenerationParameterProfile().models.eleven_v3.limits.dialogue_prompt_limit, 4000);
  assert.equal(api().getOwnerElevenLabsGenerationParameterProfile().models.eleven_v3.limits.dialogue_max_inputs, 100);
  assert.equal(Object.hasOwn(normalized.settings_candidate, "voice_id"), false);
  assert.equal(Object.hasOwn(normalized.settings_candidate, "voice_name"), false);
  assert.equal(Object.isFrozen(normalized.settings_candidate.inputs), true);
  assert.equal(Object.isFrozen(normalized.settings_candidate.inputs[0]), true);
});

test("enforces the source-bound dialogue speaker count and aggregate character limit", () => {
  const two = [
    { name: "A", text: "x", voice_ref: voiceRef(VOICE_A) },
    { name: "B", text: "y", voice_ref: voiceRef(VOICE_B) }
  ];
  assert.equal(normalize({ model_id: "eleven_v4", mode: "text_to_dialogue", inputs: two,
    stability: 0.5, similarity_boost: 0.5 }).settings_candidate.chars_count, 2);
  invalid({ model_id: "eleven_v3", mode: "text_to_dialogue", inputs: [two[0]], stability: 0.5, similarity_boost: 0.5 });
  invalid({ model_id: "eleven_v4", mode: "text_to_dialogue", inputs: Array.from({ length: 101 }, (_, i) =>
    ({ name: String(i), text: "x", voice_ref: voiceRef(VOICE_A) })), stability: 0.5, similarity_boost: 0.5 });

  const atV3Limit = [
    { name: "A", text: "a".repeat(2000), voice_ref: voiceRef(VOICE_A) },
    { name: "B", text: "b".repeat(2000), voice_ref: voiceRef(VOICE_B) }
  ];
  assert.equal(normalize({ model_id: "eleven_v3", mode: "text_to_dialogue", inputs: atV3Limit,
    stability: 0, similarity_boost: 1 }).settings_candidate.chars_count, 4000);
  invalid({ model_id: "eleven_v3", mode: "text_to_dialogue", inputs: [
    atV3Limit[0], { ...atV3Limit[1], text: "b".repeat(2001) }
  ], stability: 0, similarity_boost: 1 });

  const atV4Limit = [
    { name: "A", text: "a".repeat(5000), voice_ref: voiceRef(VOICE_A) },
    { name: "B", text: "b".repeat(5000), voice_ref: voiceRef(VOICE_B) }
  ];
  assert.equal(normalize({ model_id: "eleven_v4_turbo", mode: "text_to_dialogue", inputs: atV4Limit,
    stability: 0.5, similarity_boost: 0.5 }).settings_candidate.chars_count, 10000);
  invalid({ model_id: "eleven_v4", mode: "text_to_dialogue", inputs: [
    atV4Limit[0], { ...atV4Limit[1], text: "b".repeat(5001) }
  ], stability: 0.5, similarity_boost: 0.5 });
});

test("requires nonblank dialogue text and a nominal voice reference while preserving optional blank names", () => {
  const base = {
    model_id: "eleven_v4",
    mode: "text_to_dialogue",
    inputs: [
      { name: "", text: "first", voice_ref: voiceRef(VOICE_A) },
      { name: "", text: "second", voice_ref: voiceRef(VOICE_B) }
    ],
    stability: 0.5,
    similarity_boost: 0.5
  };
  assert.equal(normalize(base).settings_candidate.inputs[0].name, "");
  invalid({ ...base, inputs: [base.inputs[0], { ...base.inputs[1], text: "  " }] });
  invalid({ ...base, inputs: [base.inputs[0], { ...base.inputs[1], voice_ref: "" }] });
  invalid({ ...base, inputs: [base.inputs[0], { ...base.inputs[1], voice_id: "caller-chosen" }] });
});

test("requires explicit stability and similarity values on the five-percent scale", () => {
  const tts = { model_id: "eleven_multilingual_v2", mode: "text_to_speech", prompt: "hello", voice_ref: VOICE_A };
  for (const [field, value] of [
    ["stability", undefined], ["similarity_boost", undefined], ["stability", -0.05], ["similarity_boost", 1.05],
    ["stability", 0.03], ["similarity_boost", Number.NaN], ["stability", Number.POSITIVE_INFINITY], ["stability", "0.5"]
  ] as const) {
    const request = { ...tts, stability: 0.5, similarity_boost: 0.5, [field]: value };
    if (value === undefined) delete request[field];
    invalid(request);
  }
  assert.equal(normalize({ ...tts, stability: 0.35, similarity_boost: 0.65 }).settings_candidate.stability, 0.35);
});

test("accepts only the known auto language value for V4 and rejects the field for other models", () => {
  const tts = { mode: "text_to_speech", prompt: "hello", voice_ref: VOICE_A, stability: 0.5, similarity_boost: 0.5 };
  assert.equal(normalize({ ...tts, model_id: "eleven_v4" }).settings_candidate.language_code, "auto");
  assert.equal(normalize({ ...tts, model_id: "eleven_v4_turbo", language_code: "auto" }).settings_candidate.language_code, "auto");
  assert.equal(normalize({
    model_id: "eleven_v4", mode: "text_to_dialogue", inputs: [
      { name: "A", text: "a", voice_ref: VOICE_A }, { name: "B", text: "b", voice_ref: VOICE_B }
    ], stability: 0.5, similarity_boost: 0.5, language_code: "auto"
  }).settings_candidate.language_code, "auto");
  invalid({ ...tts, model_id: "eleven_v4", language_code: "en" });
  invalid({ ...tts, model_id: "eleven_v3", language_code: "auto" });
});

test("rejects STS, cross-mode models, and unrecognized request fields", () => {
  const tts = { mode: "text_to_speech", prompt: "hello", voice_ref: VOICE_A, stability: 0.5, similarity_boost: 0.5 };
  invalid({ ...tts, model_id: "eleven_multilingual_sts_v2" });
  invalid({ ...tts, model_id: "eleven_english_sts_v2" });
  invalid({ ...tts, model_id: "eleven_v3", mode: "speech_to_speech" });
  invalid({ ...tts, model_id: "eleven_v2", mode: "text_to_speech" });
  invalid({ ...tts, model_id: "eleven_v4", voice_id: "raw-provider-id" });
  invalid({ ...tts, model_id: "eleven_v4", dispatch_allowed: true });
});

test("rejects accessors, proxies, class instances, and malformed dialogue arrays without invoking getters", () => {
  const getterInput: Record<string, unknown> = {
    model_id: "eleven_multilingual_v2", mode: "text_to_speech", voice_ref: VOICE_A,
    stability: 0.5, similarity_boost: 0.5
  };
  let getterCalls = 0;
  Object.defineProperty(getterInput, "prompt", { enumerable: true, get() { getterCalls += 1; return "hello"; } });
  invalid(getterInput);
  assert.equal(getterCalls, 0);
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  invalid(revoked.proxy);
  invalid(new (class TtsInput {})());
  const request = { model_id: "eleven_v3", mode: "text_to_dialogue", inputs: [
    { name: "A", text: "x", voice_ref: VOICE_A }, { name: "B", text: "y", voice_ref: VOICE_B }
  ], stability: 0.5, similarity_boost: 0.5 };
  invalid({ ...request, inputs: new Proxy(request.inputs, {}) });
});
