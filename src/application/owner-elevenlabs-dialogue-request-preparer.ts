import { createHash } from "node:crypto";
import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { schemaHash } from "../domain/generation-contract.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import {
  OwnerElevenLabsVoiceReferenceService,
  OwnerElevenLabsVoiceReferenceServiceError,
  type OwnerElevenLabsVoicePrivateResolution
} from "./owner-elevenlabs-voice-reference-service.js";
import {
  normalizeOwnerElevenLabsGenerationParameters,
  OWNER_ELEVENLABS_DIALOGUE_MODEL_IDS,
  type OwnerElevenLabsDialogueModel,
  type OwnerElevenLabsVoiceReference
} from "./owner-elevenlabs-generation-parameters.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const VOICE_REF = /^owner_elevenlabs_voice_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const VOICE_ID = /^[A-Za-z0-9._-]{1,160}$/u;
const MAX_CANDIDATES = 128;
const RESOLVE_VOICE = OwnerElevenLabsVoiceReferenceService.prototype.resolveVoice;
const OWNED_VOICE_GUARD = OwnerElevenLabsVoiceReferenceService.prototype.isOwnedVoiceResolution;
const CANDIDATES = new WeakMap<object, CandidateState>();
const PREPARERS = new WeakSet<object>();

const MODEL_LIMITS = Object.freeze({
  eleven_v3: Object.freeze({ max_prompt_length: 5_000, dialogue_prompt_limit: 4_000, dialogue_max_inputs: 100 }),
  eleven_v4: Object.freeze({ max_prompt_length: 10_000, dialogue_prompt_limit: 10_000, dialogue_max_inputs: 100 }),
  eleven_v4_turbo: Object.freeze({ max_prompt_length: 10_000, dialogue_prompt_limit: 10_000, dialogue_max_inputs: 100 })
} as const);

const SOURCE_PROFILE = deepFreeze({
  profile_id: "elevenlabs-dialogue-current-build-1791904852-v1",
  source_binding: {
    build_id: "1791904852",
    app_route_module: { name: "app.js", bytes: 2_434_959, sha256: "sha256:6479e7e48c5a3348c7f642203e0438e7d4fa776997959df4dc505b39bb922ac1" },
    public_catalog_sha256: "sha256:323b585b24a0637466c3729553e14d506aa9427418977db6f201819d83b8a083",
    form_module: { name: "elevenlabs.js", bytes: 32_647, sha256: "sha256:f0bddc3b37e1cd44a32e60b6cdb4401670a2ffb5244a568b1a867d210e660c6c" },
    settings_module: { name: "settings3.js", bytes: 4_155, sha256: "sha256:7fb7a1113b89060cdd9af313cb3f4a140c754959fbda3d997f49bdcacabc52e6" },
    audio_route_module: { name: "index8.js", bytes: 8_985, sha256: "sha256:4a0b37bbf45cb8e2c5e8eb01794cd59b00f437a9f5b23b26c0da07a00eb79ba2" },
    prompt_child_module: { name: "index14.js", bytes: 258_638, sha256: "sha256:037e2b1ffc93672f17642ee39b1a99d93ff1fefc4a3a462c064e76220d1d90a9" },
    audio_sender_module: { name: "audio.js", bytes: 1_248, sha256: "sha256:682ce3838a2cc3d596aec02be0b7d651421a5feea770d9cd61d9379a60b62fe2" },
    source_parse_diagnostics: 0
  },
  models: MODEL_LIMITS,
  sender: {
    route: "audio/generate",
    body_fields: ["chat_uuid", "prompt", "settings"],
    prompt_field: "explicit common prompt, passed through unchanged",
    settings_projection: "truthy customSettingPayload replaces the ordinary settings object",
    dialogue_input_projection: ["name", "text", "voice_id"],
    dialogue_input_order: "preserved",
    dialogue_character_count: "sum of inputs[].text JavaScript string lengths only",
    result_contract: "conservative owner-message correlation; completion, URL, MIME, and codec remain unproven"
  },
  runtime_usable: false,
  generation_allowed: false,
  dispatch_allowed: false,
  backend_acceptance: "UNPROVEN"
} as const);

type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export type OwnerElevenLabsDialogueSourceProfile = typeof SOURCE_PROFILE;

export interface OwnerElevenLabsDialoguePrivateRequest {
  readonly prompt: string;
  readonly settings: Readonly<{
    readonly model_type: OwnerElevenLabsDialogueModel;
    readonly mode: "text_to_dialogue";
    readonly inputs: readonly Readonly<{ name: string; text: string; voice_id: string }>[];
    readonly chars_count: number;
    readonly stability?: number;
    readonly similarity_boost?: number;
    readonly language_code?: "auto";
  }>;
}

export interface OwnerElevenLabsDialoguePreparedCandidate {
  readonly status: "prepared";
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: OwnerElevenLabsDialogueModel;
  readonly mode: "text_to_dialogue";
  readonly line_count: number;
  readonly chars_count: number;
  readonly prompt_length: number;
  readonly prompt_fingerprint: string;
  readonly voice_epoch: number;
  readonly expires_at: number;
  readonly stability: number;
  readonly similarity_boost: number;
  readonly language_code?: "auto";
  readonly profile_id: typeof SOURCE_PROFILE.profile_id;
  readonly profile_schema_hash: string;
  readonly public_catalog_sha256: typeof SOURCE_PROFILE.source_binding.public_catalog_sha256;
  readonly form_sha256: typeof SOURCE_PROFILE.source_binding.form_module.sha256;
  readonly intent_fingerprint: string;
  readonly runtime_usable: false;
  readonly generation_allowed: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface PrepareOwnerElevenLabsDialogueInput {
  readonly attemptId: string;
  readonly principal: GenerationPrincipalRef;
  readonly request: unknown;
}

export interface InspectOwnerElevenLabsDialogueCandidateInput {
  readonly candidate: OwnerElevenLabsDialoguePreparedCandidate;
  readonly attemptId: string;
  readonly principal: GenerationPrincipalRef;
}

export interface OwnerElevenLabsDialogueCandidateBinding {
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: OwnerElevenLabsDialogueModel;
  readonly line_count: number;
  readonly chars_count: number;
  readonly prompt_length: number;
  readonly prompt_fingerprint: string;
  readonly voice_epoch: number;
  readonly expires_at: number;
  readonly intent_fingerprint: string;
  readonly profile_schema_hash: string;
}

export type OwnerElevenLabsDialogueRequestPreparerErrorCode =
  | "INVALID_REQUEST" | "VOICE_SERVICE_UNTRUSTED" | "VOICE_REFERENCE_UNAVAILABLE" | "VOICE_REFERENCE_EXPIRED"
  | "PRINCIPAL_MISMATCH" | "PARAMETERS_INVALID" | "UNSUPPORTED_MODEL_CONTROLS" | "CANDIDATE_UNBOUND"
  | "CANDIDATE_EXPIRED" | "CLOCK_INVALID" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED";

export class OwnerElevenLabsDialogueRequestPreparerError extends Error {
  constructor(readonly code: OwnerElevenLabsDialogueRequestPreparerErrorCode) {
    super("The ElevenLabs dialogue request candidate could not be prepared safely.");
    this.name = "OwnerElevenLabsDialogueRequestPreparerError";
  }
}

interface ResolvedDialogueVoice {
  readonly voice_ref: OwnerElevenLabsVoiceReference;
  readonly resolution: OwnerElevenLabsVoicePrivateResolution;
  readonly owned_resolution: OwnerElevenLabsVoicePrivateResolution;
}

interface CandidateState {
  readonly candidate: OwnerElevenLabsDialoguePreparedCandidate;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly resolver: OwnerElevenLabsVoiceReferenceService;
  readonly voices: readonly ResolvedDialogueVoice[];
  readonly privateRequest: OwnerElevenLabsDialoguePrivateRequest;
  readonly requestHash: string;
}

/** Returns current source facts only; it grants no account, generation, or provider authority. */
export function getOwnerElevenLabsDialogueSourceProfile(): DeepReadonly<OwnerElevenLabsDialogueSourceProfile> {
  return SOURCE_PROFILE;
}

export class OwnerElevenLabsDialogueRequestPreparer {
  readonly #voiceReferenceService: OwnerElevenLabsVoiceReferenceService;
  readonly #now: () => number;
  readonly #active = new Map<object, CandidateState>();
  #lastNow: number | undefined;
  #closed = false;

  constructor(optionsInput: unknown) {
    const fields = exactRecord(optionsInput, ["voiceReferenceService"], ["now"]);
    if (!isVoiceReferenceService(fields.voiceReferenceService) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("VOICE_SERVICE_UNTRUSTED");
    this.#voiceReferenceService = fields.voiceReferenceService;
    this.#now = fields.now === undefined ? Date.now : fields.now as () => number;
    PREPARERS.add(this);
    Object.freeze(this);
  }

  async prepare(input: PrepareOwnerElevenLabsDialogueInput | unknown): Promise<OwnerElevenLabsDialoguePreparedCandidate> {
    this.#assertOpen();
    const fields = exactRecord(input, ["attemptId", "principal", "request"]);
    const attemptId = readAttempt(fields.attemptId);
    const principal = readPrincipal(fields.principal, attemptId);
    const request = readDialogueRequest(fields.request);
    const { model_id: modelId, prompt } = request;
    if (prompt.length > MODEL_LIMITS[modelId].max_prompt_length) fail("PARAMETERS_INVALID");

    let normalized;
    try {
      const dialogueRequest = {
        model_id: request.model_id,
        mode: request.mode,
        inputs: request.inputs,
        stability: request.stability,
        similarity_boost: request.similarity_boost,
        ...(request.language_code === undefined ? {} : { language_code: request.language_code })
      };
      normalized = normalizeOwnerElevenLabsGenerationParameters(dialogueRequest);
      if (normalized.mode !== "text_to_dialogue") fail("INVALID_REQUEST");
    } catch (error) {
      if (error instanceof OwnerElevenLabsDialogueRequestPreparerError) throw error;
      fail("PARAMETERS_INVALID");
    }
    if (!isV4(modelId) && (normalized.settings_candidate.stability !== 0.5 ||
        normalized.settings_candidate.similarity_boost !== 0.5)) fail("UNSUPPORTED_MODEL_CONTROLS");

    const lines = normalized.settings_candidate.inputs;
    if (!lines || lines.some((line) => !VOICE_REF.test(line.voice_ref))) fail("INVALID_REQUEST");
    const resolutions = new Map<string, ResolvedDialogueVoice>();
    for (const line of lines) {
      if (resolutions.has(line.voice_ref)) continue;
      const context = Object.freeze({ attemptId, voice_ref: line.voice_ref });
      let resolution: OwnerElevenLabsVoicePrivateResolution;
      try {
        resolution = await Reflect.apply(RESOLVE_VOICE, this.#voiceReferenceService, [context]) as OwnerElevenLabsVoicePrivateResolution;
      } catch (error) {
        if (error instanceof OwnerElevenLabsVoiceReferenceServiceError && error.code === "VOICE_REFERENCE_EXPIRED") fail("VOICE_REFERENCE_EXPIRED");
        if (error instanceof OwnerElevenLabsVoiceReferenceServiceError && error.code === "PRINCIPAL_NOT_LINKED") fail("PRINCIPAL_MISMATCH");
        fail("VOICE_REFERENCE_UNAVAILABLE");
      }
      const snapshot = snapshotResolution(resolution);
      if (!Reflect.apply(OWNED_VOICE_GUARD, this.#voiceReferenceService, [resolution, context]) ||
          snapshot.attempt_id !== attemptId || snapshot.voice_ref !== line.voice_ref ||
          !sameGenerationPrincipal(snapshot.principal, principal)) fail("VOICE_REFERENCE_UNAVAILABLE");
      resolutions.set(line.voice_ref, Object.freeze({ voice_ref: line.voice_ref, resolution: snapshot, owned_resolution: resolution }));
    }

    const now = this.#readNow();
    const voices = Object.freeze([...resolutions.values()]);
    const expiresAt = Math.min(...voices.map((voice) => voice.resolution.expires_at));
    const voiceEpoch = voices[0]?.resolution.epoch;
    if (voiceEpoch === undefined || voices.some((voice) => voice.resolution.epoch !== voiceEpoch)) fail("VOICE_REFERENCE_UNAVAILABLE");
    if (expiresAt <= now) fail("VOICE_REFERENCE_EXPIRED");
    this.#prune(now);
    if (this.#active.size >= MAX_CANDIDATES) fail("CAPACITY_EXCEEDED");

    const voiceIds = new Map(voices.map((voice) => [voice.voice_ref, voice.resolution.voice_id]));
    const privateInputs = Object.freeze(lines.map((line) => Object.freeze({
      name: line.name, text: line.text, voice_id: voiceIds.get(line.voice_ref)!
    })));
    const settings = Object.freeze({
      model_type: modelId,
      mode: "text_to_dialogue" as const,
      inputs: privateInputs,
      chars_count: normalized.settings_candidate.chars_count,
      ...(isV4(modelId) ? {
        stability: normalized.settings_candidate.stability,
        similarity_boost: normalized.settings_candidate.similarity_boost,
        ...(normalized.settings_candidate.language_code === undefined ? {} : { language_code: normalized.settings_candidate.language_code })
      } : {})
    });
    const privateRequest: OwnerElevenLabsDialoguePrivateRequest = Object.freeze({ prompt, settings });
    const profileSchemaHash = schemaHash(SOURCE_PROFILE);
    const intentFingerprint = semanticFingerprint({ principal, model_id: modelId, prompt, inputs: privateInputs,
      stability: settings.stability ?? null, similarity_boost: settings.similarity_boost ?? null,
      language_code: settings.language_code ?? null });
    const promptFingerprint = promptHash(principal, modelId, prompt);
    const candidate: OwnerElevenLabsDialoguePreparedCandidate = Object.freeze({
      status: "prepared", attempt_id: attemptId, principal, model_id: modelId, mode: "text_to_dialogue",
      line_count: lines.length, chars_count: settings.chars_count, prompt_length: prompt.length,
      prompt_fingerprint: promptFingerprint, voice_epoch: voiceEpoch, expires_at: expiresAt,
      stability: normalized.settings_candidate.stability,
      similarity_boost: normalized.settings_candidate.similarity_boost,
      ...(normalized.settings_candidate.language_code === undefined ? {} : { language_code: normalized.settings_candidate.language_code }),
      profile_id: SOURCE_PROFILE.profile_id, profile_schema_hash: profileSchemaHash,
      public_catalog_sha256: SOURCE_PROFILE.source_binding.public_catalog_sha256,
      form_sha256: SOURCE_PROFILE.source_binding.form_module.sha256,
      intent_fingerprint: intentFingerprint,
      runtime_usable: false, generation_allowed: false, dispatch_allowed: false, backend_acceptance: "UNPROVEN"
    });
    const state: CandidateState = Object.freeze({ candidate, principal, resolver: this.#voiceReferenceService, voices,
      privateRequest, requestHash: schemaHash(privateRequest) });
    CANDIDATES.set(candidate, state);
    this.#active.set(candidate, state);
    return candidate;
  }

  inspectCandidate(candidate: unknown): OwnerElevenLabsDialogueCandidateBinding | undefined {
    const state = this.#state(candidate);
    return state ? bindingOf(state) : undefined;
  }

  revalidateCandidate(input: InspectOwnerElevenLabsDialogueCandidateInput | unknown): OwnerElevenLabsDialogueCandidateBinding {
    this.#assertOpen();
    const fields = exactRecord(input, ["candidate", "attemptId", "principal"]);
    const attemptId = readAttempt(fields.attemptId);
    const principal = readPrincipal(fields.principal, attemptId);
    const state = this.#state(fields.candidate);
    if (!state) fail("CANDIDATE_UNBOUND");
    if (state.candidate.attempt_id !== attemptId || !sameGenerationPrincipal(state.principal, principal) ||
        !sameGenerationPrincipal(state.candidate.principal, principal)) fail("PRINCIPAL_MISMATCH");
    const now = this.#readNow();
    if (state.candidate.expires_at <= now || state.voices.some((voice) => voice.resolution.expires_at <= now)) {
      this.#drop(fields.candidate as object);
      fail("CANDIDATE_EXPIRED");
    }
    if (state.voices.some((voice) => !Reflect.apply(OWNED_VOICE_GUARD, state.resolver,
      [voice.owned_resolution, { attemptId, voice_ref: voice.voice_ref }]))) {
      this.#drop(fields.candidate as object);
      fail("VOICE_REFERENCE_UNAVAILABLE");
    }
    const settings = state.privateRequest.settings;
    if (schemaHash(state.privateRequest) !== state.requestHash || state.candidate.intent_fingerprint !== semanticFingerprint({
      principal, model_id: state.candidate.model_id, prompt: state.privateRequest.prompt, inputs: settings.inputs,
      stability: settings.stability ?? null, similarity_boost: settings.similarity_boost ?? null,
      language_code: settings.language_code ?? null
    })) {
      this.#drop(fields.candidate as object);
      fail("CANDIDATE_UNBOUND");
    }
    return bindingOf(state);
  }

  invalidateAttempt(attemptIdInput: unknown): void {
    if (typeof attemptIdInput !== "string" || !ATTEMPT.test(attemptIdInput)) return;
    for (const [candidate, state] of this.#active) if (state.candidate.attempt_id === attemptIdInput) this.#drop(candidate);
  }

  close(): void { this.#closed = true; this.#active.clear(); }

  #state(value: unknown): CandidateState | undefined {
    if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return undefined;
    const state = CANDIDATES.get(value);
    return state && state.candidate === value && this.#active.get(value) === state ? state : undefined;
  }
  #drop(candidate: object): void { this.#active.delete(candidate); }
  #prune(now: number): void {
    for (const [candidate, state] of this.#active) if (state.candidate.expires_at <= now) this.#drop(candidate);
  }
  #readNow(): number {
    let value: unknown;
    try { value = this.#now(); } catch { fail("CLOCK_INVALID"); }
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 ||
        (this.#lastNow !== undefined && value < this.#lastNow)) fail("CLOCK_INVALID");
    this.#lastNow = value as number;
    return value as number;
  }
  #assertOpen(): void { if (this.#closed || !PREPARERS.has(this)) fail("SERVICE_CLOSED"); }
}

export function isOwnerElevenLabsDialogueRequestPreparer(value: unknown): value is OwnerElevenLabsDialogueRequestPreparer {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && PREPARERS.has(value) &&
    Object.getPrototypeOf(value) === OwnerElevenLabsDialogueRequestPreparer.prototype; } catch { return false; }
}

/** Internal-only accessor; exposes private content only to the future one-shot dispatch seam. */
export function getOwnerElevenLabsDialoguePrivateRequestForPolicy(candidate: unknown): OwnerElevenLabsDialoguePrivateRequest {
  if (!candidate || typeof candidate !== "object" || types.isProxy(candidate)) fail("CANDIDATE_UNBOUND");
  const state = CANDIDATES.get(candidate);
  if (!state || state.candidate !== candidate || schemaHash(state.privateRequest) !== state.requestHash) fail("CANDIDATE_UNBOUND");
  return state.privateRequest;
}

function readDialogueRequest(input: unknown): {
  readonly model_id: OwnerElevenLabsDialogueModel; readonly mode: "text_to_dialogue"; readonly prompt: string;
  readonly inputs: readonly unknown[]; readonly stability: number; readonly similarity_boost: number; readonly language_code?: "auto";
} {
  const fields = exactRecord(input, ["model_id", "mode", "prompt", "inputs", "stability", "similarity_boost"], ["language_code"]);
  if (typeof fields.model_id !== "string" || !isDialogueModel(fields.model_id) || fields.mode !== "text_to_dialogue" ||
      typeof fields.prompt !== "string" || (fields.language_code !== undefined && fields.language_code !== "auto")) fail("INVALID_REQUEST");
  return Object.freeze({ model_id: fields.model_id, mode: "text_to_dialogue", prompt: fields.prompt,
    inputs: fields.inputs as readonly unknown[], stability: fields.stability as number,
    similarity_boost: fields.similarity_boost as number,
    ...(fields.language_code === undefined ? {} : { language_code: fields.language_code as "auto" }) });
}

function snapshotResolution(value: unknown): OwnerElevenLabsVoicePrivateResolution {
  const fields = exactRecord(value, ["attempt_id", "principal", "voice_ref", "voice_id", "name", "expires_at", "epoch",
    "ownership_confidence", "generation_permit"]);
  const principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef);
  if (typeof fields.attempt_id !== "string" || typeof fields.voice_ref !== "string" || !VOICE_REF.test(fields.voice_ref) ||
      typeof fields.voice_id !== "string" || !VOICE_ID.test(fields.voice_id) || typeof fields.name !== "string" ||
      typeof fields.expires_at !== "number" || !Number.isSafeInteger(fields.expires_at) ||
      typeof fields.epoch !== "number" || !Number.isSafeInteger(fields.epoch) || fields.epoch < 0 ||
      fields.ownership_confidence !== "UNPROVEN" || fields.generation_permit !== false) fail("VOICE_REFERENCE_UNAVAILABLE");
  return Object.freeze({ attempt_id: fields.attempt_id, principal, voice_ref: fields.voice_ref as OwnerElevenLabsVoiceReference,
    voice_id: fields.voice_id, name: fields.name, expires_at: fields.expires_at, epoch: fields.epoch,
    ownership_confidence: "UNPROVEN", generation_permit: false });
}

function isVoiceReferenceService(value: unknown): value is OwnerElevenLabsVoiceReferenceService {
  try { return !!value && typeof value === "object" && !types.isProxy(value) &&
    Object.getPrototypeOf(value) === OwnerElevenLabsVoiceReferenceService.prototype &&
    getDataMethod(value, "resolveVoice") === RESOLVE_VOICE && getDataMethod(value, "isOwnedVoiceResolution") === OWNED_VOICE_GUARD; }
  catch { return false; }
}
function isDialogueModel(value: string): value is OwnerElevenLabsDialogueModel {
  return (OWNER_ELEVENLABS_DIALOGUE_MODEL_IDS as readonly string[]).includes(value);
}
function isV4(model: OwnerElevenLabsDialogueModel): boolean { return model === "eleven_v4" || model === "eleven_v4_turbo"; }
function readPrincipal(value: unknown, attemptId: string): Readonly<GenerationPrincipalRef> {
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); }
  catch { return fail("PRINCIPAL_MISMATCH"); }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH");
  return principal;
}
function readAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST"); return value; }
function promptHash(principal: Readonly<GenerationPrincipalRef>, modelId: OwnerElevenLabsDialogueModel, prompt: string): string {
  const value = JSON.stringify(["owner-elevenlabs-dialogue-prompt-v1", principal.tenant_id,
    principal.subject_id, modelId, prompt]);
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
function semanticFingerprint(input: { principal: Readonly<GenerationPrincipalRef>; model_id: OwnerElevenLabsDialogueModel;
  prompt: string; inputs: readonly Readonly<{ name: string; text: string; voice_id: string }>[];
  stability: number | null; similarity_boost: number | null; language_code: "auto" | null }): string {
  const lines = input.inputs.map((line) => [line.name, line.text, line.voice_id]);
  const value = JSON.stringify(["owner-elevenlabs-dialogue-semantic-v1", input.principal.tenant_id,
    input.principal.subject_id, input.model_id, input.prompt, lines, input.stability, input.similarity_boost, input.language_code]);
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
function bindingOf(state: CandidateState): OwnerElevenLabsDialogueCandidateBinding {
  return Object.freeze({ attempt_id: state.candidate.attempt_id, principal: state.principal, model_id: state.candidate.model_id,
    line_count: state.candidate.line_count, chars_count: state.candidate.chars_count,
    prompt_length: state.candidate.prompt_length, prompt_fingerprint: state.candidate.prompt_fingerprint,
    voice_epoch: state.candidate.voice_epoch, expires_at: state.candidate.expires_at,
    intent_fingerprint: state.candidate.intent_fingerprint, profile_schema_hash: state.candidate.profile_schema_hash });
}
function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (required.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) => typeof key !== "string" ||
      (!required.includes(key) && !optional.includes(key)) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) {
    fail("INVALID_REQUEST");
  }
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function getDataMethod(target: object, key: string): unknown {
  let current: object | null = target;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}
function fail(code: OwnerElevenLabsDialogueRequestPreparerErrorCode): never {
  throw new OwnerElevenLabsDialogueRequestPreparerError(code);
}
