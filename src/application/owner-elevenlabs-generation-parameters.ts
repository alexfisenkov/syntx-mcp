import { isProxy } from "node:util/types";

export const OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION =
  "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json" as const;
export const OWNER_ELEVENLABS_GENERATION_SETTINGS_VERSION =
  "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json" as const;

export const OWNER_ELEVENLABS_TTS_MODEL_IDS = Object.freeze([
  "eleven_multilingual_v2", "eleven_v3", "eleven_v4", "eleven_v4_turbo"
] as const);
export const OWNER_ELEVENLABS_DIALOGUE_MODEL_IDS = Object.freeze([
  "eleven_v3", "eleven_v4", "eleven_v4_turbo"
] as const);

export type OwnerElevenLabsTtsModel = typeof OWNER_ELEVENLABS_TTS_MODEL_IDS[number];
export type OwnerElevenLabsDialogueModel = typeof OWNER_ELEVENLABS_DIALOGUE_MODEL_IDS[number];
export type OwnerElevenLabsGenerationModel = OwnerElevenLabsTtsModel;
export type OwnerElevenLabsMode = "text_to_speech" | "text_to_dialogue";

declare const ownerElevenLabsVoiceReferenceBrand: unique symbol;
/** Issued by the future owner-authorized voice selector; never a provider voice_id. */
export type OwnerElevenLabsVoiceReference = string & {
  readonly [ownerElevenLabsVoiceReferenceBrand]: "OwnerElevenLabsVoiceReference";
};

export interface OwnerElevenLabsTtsRequest {
  readonly model_id: OwnerElevenLabsTtsModel;
  readonly mode: "text_to_speech";
  readonly prompt: string;
  readonly voice_ref: OwnerElevenLabsVoiceReference;
  readonly stability: number;
  readonly similarity_boost: number;
  readonly language_code?: "auto";
}

export interface OwnerElevenLabsDialogueLine {
  readonly name: string;
  readonly text: string;
  readonly voice_ref: OwnerElevenLabsVoiceReference;
}

export interface OwnerElevenLabsDialogueRequest {
  readonly model_id: OwnerElevenLabsDialogueModel;
  readonly mode: "text_to_dialogue";
  readonly inputs: readonly OwnerElevenLabsDialogueLine[];
  readonly stability: number;
  readonly similarity_boost: number;
  readonly language_code?: "auto";
}

export type OwnerElevenLabsGenerationRequest = OwnerElevenLabsTtsRequest | OwnerElevenLabsDialogueRequest;

type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

const SOURCE_MODELS = deepFreeze({
  eleven_multilingual_sts_v2: {
    allowed_modes: ["speech_to_speech"],
    limits: { max_prompt_length: 0, dialogue_prompt_limit: null, dialogue_max_inputs: null },
    supported_by_this_builder: false
  },
  eleven_multilingual_v2: {
    allowed_modes: ["text_to_speech"],
    limits: { max_prompt_length: 5_000, dialogue_prompt_limit: null, dialogue_max_inputs: null },
    supported_by_this_builder: true
  },
  eleven_v3: {
    allowed_modes: ["text_to_speech", "text_to_dialogue"],
    limits: { max_prompt_length: 5_000, dialogue_prompt_limit: 4_000, dialogue_max_inputs: 100 },
    supported_by_this_builder: true
  },
  eleven_v4: {
    allowed_modes: ["text_to_speech", "text_to_dialogue"],
    limits: { max_prompt_length: 10_000, dialogue_prompt_limit: 10_000, dialogue_max_inputs: 100 },
    supported_by_this_builder: true
  },
  eleven_v4_turbo: {
    allowed_modes: ["text_to_speech", "text_to_dialogue"],
    limits: { max_prompt_length: 10_000, dialogue_prompt_limit: 10_000, dialogue_max_inputs: 100 },
    supported_by_this_builder: true
  }
} as const);

const SOURCE_PROFILE = deepFreeze({
  profile_id: "elevenlabs-generation-parameters-current-v1",
  source_binding: {
    build_id: "1791811899",
    form_module: {
      name: "elevenlabs.js",
      bytes: 32_647,
      sha256: "sha256:17a2018ebc2211457988afd7dcc45f52752e076b6e83d37cb47c6d9f6df9cbb1",
      ast_parse_diagnostics: 0
    },
    public_catalog_version: OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION,
    settings_inventory_version: OWNER_ELEVENLABS_GENERATION_SETTINGS_VERSION,
    selector_or_archive_changed: false,
    source_catalog_runtime_usable: false
  },
  tts_model_ids: OWNER_ELEVENLABS_TTS_MODEL_IDS,
  dialogue_model_ids: OWNER_ELEVENLABS_DIALOGUE_MODEL_IDS,
  deferred_model_ids: ["eleven_multilingual_sts_v2"] as const,
  models: SOURCE_MODELS,
  builder: {
    mode_fallback: "text_to_speech" as const,
    dialogue_fields: ["name", "text", "voice_ref"] as const,
    dialogue_min_inputs: 2,
    dialogue_minimum_basis: "CURRENT_FORM_DEFAULTS_TWO_AND_REMOVAL_GUARD_REQUIRES_MORE_THAN_TWO" as const,
    dialogue_maximum_basis: "PAIRED_PUBLIC_SETTINGS_AND_FORM_MAX_INPUTS" as const,
    character_length_unit: "JAVASCRIPT_STRING_LENGTH_UTF16_CODE_UNITS" as const,
    dialogue_character_count: "SUM_INPUT_TEXT_LENGTH_ONLY_EXCLUDES_SPEAKER_NAME_AND_VOICE_REFERENCE" as const,
    empty_count_fallback: 10,
    fallback_is_effective_provider_default: false,
    membership_models: ["eleven_v4", "eleven_v4_turbo"] as const,
    stability: { min: 0, max: 1, step: 0.05, explicit_input_required: true },
    similarity_boost: { min: 0, max: 1, step: 0.05, explicit_input_required: true },
    language_code: {
      emitted_for_membership_models_only: true,
      accepted_value: "auto" as const,
      other_locale_values: "UNRESOLVED_DYNAMIC_USE_AVAILABLE_LOCALES" as const
    },
    voice_reference: {
      type: "NOMINAL_OWNER_SESSION_SELECTION_NOT_RESOLVED_TO_PROVIDER_VOICE_ID" as const,
      issuer: "OWNER_AUTHORIZED_VOICE_RESOLVER_NOT_IMPLEMENTED_IN_THIS_PARAMETER_SLICE" as const
    }
  },
  sender_join: "FORM_TO_AUDIO_SENDMESSAGE_CALLER_NOT_ESTABLISHED" as const,
  result_join: "AUDIO_SPECIFIC_COMPLETED_RESULT_AND_CODEC_NOT_ESTABLISHED" as const,
  effective_provider_defaults: "UNPROVEN" as const,
  source_scope: "SOURCE_BOUND_PARAMETER_CANDIDATE_ONLY" as const,
  runtime_usable: false as const,
  generation_allowed: false as const,
  dispatch_allowed: false as const,
  backend_acceptance: "UNPROVEN" as const
});

export type OwnerElevenLabsGenerationParameterProfile = typeof SOURCE_PROFILE;

export interface OwnerElevenLabsGenerationSettingsCandidate {
  readonly model_type: OwnerElevenLabsGenerationModel;
  readonly mode: OwnerElevenLabsMode;
  readonly voice_ref?: OwnerElevenLabsVoiceReference;
  readonly inputs?: readonly OwnerElevenLabsDialogueLine[];
  readonly chars_count: number;
  readonly stability: number;
  readonly similarity_boost: number;
  readonly language_code?: "auto";
}

export interface OwnerElevenLabsNormalizedTtsCandidate {
  readonly model_id: OwnerElevenLabsTtsModel;
  readonly mode: "text_to_speech";
  readonly prompt: string;
  readonly settings_candidate: OwnerElevenLabsGenerationSettingsCandidate;
  readonly profile_id: typeof SOURCE_PROFILE.profile_id;
  readonly runtime_usable: false;
  readonly generation_allowed: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerElevenLabsNormalizedDialogueCandidate {
  readonly model_id: OwnerElevenLabsDialogueModel;
  readonly mode: "text_to_dialogue";
  readonly settings_candidate: OwnerElevenLabsGenerationSettingsCandidate;
  readonly profile_id: typeof SOURCE_PROFILE.profile_id;
  readonly runtime_usable: false;
  readonly generation_allowed: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export type OwnerElevenLabsNormalizedCandidate =
  | OwnerElevenLabsNormalizedTtsCandidate
  | OwnerElevenLabsNormalizedDialogueCandidate;

export class OwnerElevenLabsGenerationParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("ElevenLabs generation parameters are invalid.");
    this.name = "OwnerElevenLabsGenerationParametersError";
  }
}

/** Returns current source facts only; it grants neither provider nor dispatch authority. */
export function getOwnerElevenLabsGenerationParameterProfile(): DeepReadonly<OwnerElevenLabsGenerationParameterProfile> {
  return SOURCE_PROFILE;
}

/** Builds a frozen source-bound TTS/dialogue candidate; voice refs remain unresolved and STS is excluded. */
export function normalizeOwnerElevenLabsGenerationParameters(input: unknown): OwnerElevenLabsNormalizedCandidate {
  const header = readExactRecord(input, ["model_id", "mode"], [
    "model_id", "mode", "prompt", "voice_ref", "inputs", "stability", "similarity_boost", "language_code"
  ]);
  if (typeof header.model_id !== "string" || typeof header.mode !== "string") invalid();

  if (header.mode === "text_to_speech") return normalizeTts(input, header.model_id);
  if (header.mode === "text_to_dialogue") return normalizeDialogue(input, header.model_id);
  return invalid();
}

function normalizeTts(input: unknown, modelIdValue: string): OwnerElevenLabsNormalizedTtsCandidate {
  if (!isTtsModel(modelIdValue)) invalid();
  const model = SOURCE_MODELS[modelIdValue];
  const allowed = isV4Model(modelIdValue)
    ? ["model_id", "mode", "prompt", "voice_ref", "stability", "similarity_boost", "language_code"]
    : ["model_id", "mode", "prompt", "voice_ref", "stability", "similarity_boost"];
  const request = readExactRecord(input, ["model_id", "mode", "prompt", "voice_ref", "stability", "similarity_boost"], allowed);
  if (request.mode !== "text_to_speech" || typeof request.prompt !== "string" || request.prompt.trim().length === 0 ||
      request.prompt.length > model.limits.max_prompt_length || !isVoiceReference(request.voice_ref) ||
      !isControl(request.stability) || !isControl(request.similarity_boost)) invalid();
  const languageCode = readLanguageCode(request.language_code, modelIdValue);
  const settingsCandidate = deepFreeze({
    model_type: modelIdValue,
    mode: "text_to_speech" as const,
    voice_ref: request.voice_ref,
    chars_count: request.prompt.length,
    stability: request.stability,
    similarity_boost: request.similarity_boost,
    ...(languageCode ? { language_code: languageCode } : {})
  });
  return deepFreeze({
    model_id: modelIdValue,
    mode: "text_to_speech" as const,
    prompt: request.prompt,
    settings_candidate: settingsCandidate,
    profile_id: SOURCE_PROFILE.profile_id,
    runtime_usable: false as const,
    generation_allowed: false as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  }) as OwnerElevenLabsNormalizedTtsCandidate;
}

function normalizeDialogue(input: unknown, modelIdValue: string): OwnerElevenLabsNormalizedDialogueCandidate {
  if (!isDialogueModel(modelIdValue)) invalid();
  const model = SOURCE_MODELS[modelIdValue];
  const allowed = isV4Model(modelIdValue)
    ? ["model_id", "mode", "inputs", "stability", "similarity_boost", "language_code"]
    : ["model_id", "mode", "inputs", "stability", "similarity_boost"];
  const request = readExactRecord(input, ["model_id", "mode", "inputs", "stability", "similarity_boost"], allowed);
  if (request.mode !== "text_to_dialogue" || !isControl(request.stability) || !isControl(request.similarity_boost)) invalid();
  const inputValues = readExactArray(request.inputs);
  if (inputValues.length < 2 || inputValues.length > (model.limits.dialogue_max_inputs ?? 0)) invalid();
  const inputs = inputValues.map(normalizeDialogueLine);
  const charsCount = inputs.reduce((total, line) => total + line.text.length, 0);
  if (charsCount === 0 || charsCount > (model.limits.dialogue_prompt_limit ?? 0)) invalid();
  const languageCode = readLanguageCode(request.language_code, modelIdValue);
  const settingsCandidate = deepFreeze({
    model_type: modelIdValue,
    mode: "text_to_dialogue" as const,
    inputs,
    chars_count: charsCount,
    stability: request.stability,
    similarity_boost: request.similarity_boost,
    ...(languageCode ? { language_code: languageCode } : {})
  });
  return deepFreeze({
    model_id: modelIdValue,
    mode: "text_to_dialogue" as const,
    settings_candidate: settingsCandidate,
    profile_id: SOURCE_PROFILE.profile_id,
    runtime_usable: false as const,
    generation_allowed: false as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  }) as OwnerElevenLabsNormalizedDialogueCandidate;
}

function normalizeDialogueLine(value: unknown): OwnerElevenLabsDialogueLine {
  const line = readExactRecord(value, ["name", "text", "voice_ref"]);
  if (typeof line.name !== "string" || typeof line.text !== "string" || line.text.trim().length === 0 ||
      !isVoiceReference(line.voice_ref)) invalid();
  return { name: line.name, text: line.text, voice_ref: line.voice_ref } as OwnerElevenLabsDialogueLine;
}

function readLanguageCode(value: unknown, modelId: OwnerElevenLabsGenerationModel): "auto" | undefined {
  if (!isV4Model(modelId)) {
    if (value !== undefined) invalid();
    return undefined;
  }
  if (value !== undefined && value !== "auto") invalid();
  return "auto";
}

function readExactRecord(
  value: unknown,
  required: readonly string[],
  allowed: readonly string[] = required
): Record<string, unknown> {
  if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function readExactArray(value: unknown): unknown[] {
  if (!value || typeof value !== "object" || isProxy(value) || !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || !Object.hasOwn(descriptors, "length")) invalid();
  const values: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) invalid();
    values.push(descriptor.value);
  }
  if (keys.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))) invalid();
  return values;
}

function isTtsModel(value: string): value is OwnerElevenLabsTtsModel {
  return (OWNER_ELEVENLABS_TTS_MODEL_IDS as readonly string[]).includes(value);
}

function isDialogueModel(value: string): value is OwnerElevenLabsDialogueModel {
  return (OWNER_ELEVENLABS_DIALOGUE_MODEL_IDS as readonly string[]).includes(value);
}

function isV4Model(value: OwnerElevenLabsGenerationModel): value is "eleven_v4" | "eleven_v4_turbo" {
  return value === "eleven_v4" || value === "eleven_v4_turbo";
}

function isVoiceReference(value: unknown): value is OwnerElevenLabsVoiceReference {
  return typeof value === "string" && value.trim().length > 0;
}

function isControl(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 &&
    Number.isInteger(value * 20);
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}

function invalid(): never {
  throw new OwnerElevenLabsGenerationParametersError("INVALID_PARAMETERS");
}
