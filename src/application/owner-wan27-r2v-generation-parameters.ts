import { types } from "node:util";
import type { OwnerWan27R2vUploadContext } from "../adapter/syntx/wan27-r2v-upload-context.js";
import {
  isOwnerWan27R2vReferenceService,
  type OwnerWan27R2vReferenceManifest,
  type OwnerWan27R2vReferenceService
} from "./owner-wan27-r2v-reference-service.js";

export type OwnerWan27R2vGenerationResolution = "720P" | "1080P";
export type OwnerWan27R2vGenerationAspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";

export interface OwnerWan27R2vGenerationParameters {
  readonly resolution: OwnerWan27R2vGenerationResolution;
  readonly aspect_ratio: OwnerWan27R2vGenerationAspectRatio;
  readonly video_duration: number;
  readonly prompt_extend: boolean;
  readonly seed: number | null;
  readonly native_audio: false;
}

export interface OwnerWan27R2vGenerationParametersInput {
  readonly model_id: "wan_27_r2v";
  readonly prompt?: string;
  readonly parameters: OwnerWan27R2vGenerationParameters;
}

export interface OwnerWan27R2vGenerationIntent {
  readonly model_id: "wan_27_r2v";
  readonly prompt?: string;
  readonly parameters: OwnerWan27R2vGenerationParameters;
}

export interface OwnerWan27R2vGenerationReferenceContext {
  readonly image_reference_count: number;
  readonly selected_video_reference_count: number;
  readonly total_reference_count: number;
  readonly maximum_video_duration_seconds: 10 | 15;
}

export interface OwnerWan27R2vGenerationSourceContract {
  readonly status: "PINNED_SOURCE_LOCAL_PARAMETER_CONTRACT";
  readonly model_id: "wan_27_r2v";
  readonly source_pins: Readonly<{
    public_catalog_version: "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json";
    public_models_sha256: "sha256:7ffbeff2ef1efa9d617d6e26e3e1c11e1d355cc45b34a2a427159f7e91fa4667";
    form_build_id: "1791904852";
    form_bytes: 19_503;
    form_sha256: "sha256:f69db3d449d0051969def2229ed936d9835e0d65c8f257ec3ab289d6e9387737";
    video_script_bytes: 8_689;
    video_script_sha256: "sha256:5c338a208de4fbcd69d220aaa4931977a31da3390b12768968469707c4f15b5e";
    new_session_helper_bytes: 1_906;
    new_session_helper_sha256: "sha256:dda0cd67d1a152a5d341d3b816493cd7ed8fb5db0aad5c97fe76465940b0aadb";
    seed_helper_bytes: 1_656;
    seed_helper_sha256: "sha256:c95fc355e29e33f6c3998cb62cc2da4d0879cc1ff4fb524e826e74bb24cd792b";
  }>;
  readonly current_media_limits: Readonly<{
    public_catalog_version: "sha256-d1f43b4274fceb50c229711f093edb36c88e60e123da448a71ed256574f02009.json";
    settings_inventory_version: "sha256-a29a66acb812c92e00d9a125132de2be4dbb0728e4174d78d236936164abd880.json";
    form_build_id: "1793202992";
    form_id: "wan-video";
    form_sha256: "sha256:fe48ac9f778d5d795143fef75f679e0dff6b3f8659cf3c7971a73d49eb88eea6";
    image_references: 6;
    selected_video_references: 5;
    total_references_image_only: 6;
    total_references_with_selected_video: 5;
    acceptance: "CURRENT_PUBLIC_SETTINGS_AND_FORM_MAPPING_NOT_PROVIDER_ACCEPTANCE";
  }>;
  readonly controls: Readonly<{
    resolution: readonly OwnerWan27R2vGenerationResolution[];
    aspect_ratio: readonly OwnerWan27R2vGenerationAspectRatio[];
    video_duration: Readonly<{ minimum: 2; maximum_with_selected_video: 10; maximum_without_selected_video: 15; unit: "INTEGER_SECONDS" }>;
    prompt_extend: "BOOLEAN";
    seed: Readonly<{ nullable: true; minimum: 0; maximum: 2_147_483_647; precision: 0 }>;
    native_audio: false;
  }>;
  readonly prompt_limit: Readonly<{
    maximum_length: 1_500;
    source: "PINNED_B066_PUBLIC_CATALOG_ONLY_NOT_CURRENT_UI_LIMIT";
  }>;
  readonly wire_facts: Readonly<{
    fixed_fields: Readonly<{ shot_type: "single"; audio_setting: "auto" }>;
    fixed_fields_source: "PINNED_R2V_CONDITIONAL_VISIBILITY_RESET";
    duration_source: "ROUNDED_SELECTED_DURATION_PER_CLIP_THEN_SUMMED_TO_2_DECIMALS_IMAGE_ONLY_ZERO";
    prompt_reference_policy: "MATCH_CURRENT_FINAL_OWNED_URL_TRIPLES_IDENTITY_OTHER_URLS_REMAIN_TEXT";
    file_url_deduplication: "FIRST_BY_TYPED_ROLE_AND_URL";
  }>;
  readonly coverage_gaps: readonly ["EFFECTIVE_UI_DEFAULTS_NOT_ESTABLISHED", "PROVIDER_ACCEPTANCE_NOT_ESTABLISHED"];
}

export interface OwnerWan27R2vGenerationNormalizedIntent {
  readonly status: "EXPLICIT_LOCAL_PARAMETERS_NORMALIZED";
  readonly intent: OwnerWan27R2vGenerationIntent;
  readonly reference_context: OwnerWan27R2vGenerationReferenceContext;
  readonly source_pins: OwnerWan27R2vGenerationSourceContract["source_pins"];
  readonly coverage_gaps: OwnerWan27R2vGenerationSourceContract["coverage_gaps"];
  readonly effective_defaults: "UNKNOWN";
}

export interface OwnerWan27R2vGenerationParametersOptions {
  readonly referenceService: OwnerWan27R2vReferenceService;
  readonly manifest: OwnerWan27R2vReferenceManifest;
}

const RESOLUTIONS = Object.freeze(["720P", "1080P"] as const);
const ASPECT_RATIOS = Object.freeze(["16:9", "9:16", "1:1", "4:3", "3:4"] as const);
const MAX_SEED = 2_147_483_647;
const CURRENT_MEDIA_LIMITS = Object.freeze({
  public_catalog_version: "sha256-d1f43b4274fceb50c229711f093edb36c88e60e123da448a71ed256574f02009.json",
  settings_inventory_version: "sha256-a29a66acb812c92e00d9a125132de2be4dbb0728e4174d78d236936164abd880.json",
  form_build_id: "1793202992",
  form_id: "wan-video",
  form_sha256: "sha256:fe48ac9f778d5d795143fef75f679e0dff6b3f8659cf3c7971a73d49eb88eea6",
  image_references: 6,
  selected_video_references: 5,
  total_references_image_only: 6,
  total_references_with_selected_video: 5,
  acceptance: "CURRENT_PUBLIC_SETTINGS_AND_FORM_MAPPING_NOT_PROVIDER_ACCEPTANCE"
} as const);
const SOURCE_PINS = Object.freeze({
  public_catalog_version: "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json",
  public_models_sha256: "sha256:7ffbeff2ef1efa9d617d6e26e3e1c11e1d355cc45b34a2a427159f7e91fa4667",
  form_build_id: "1791904852",
  form_bytes: 19_503,
  form_sha256: "sha256:f69db3d449d0051969def2229ed936d9835e0d65c8f257ec3ab289d6e9387737",
  video_script_bytes: 8_689,
  video_script_sha256: "sha256:5c338a208de4fbcd69d220aaa4931977a31da3390b12768968469707c4f15b5e",
  new_session_helper_bytes: 1_906,
  new_session_helper_sha256: "sha256:dda0cd67d1a152a5d341d3b816493cd7ed8fb5db0aad5c97fe76465940b0aadb",
  seed_helper_bytes: 1_656,
  seed_helper_sha256: "sha256:c95fc355e29e33f6c3998cb62cc2da4d0879cc1ff4fb524e826e74bb24cd792b"
} as const);
const COVERAGE_GAPS = Object.freeze([
  "EFFECTIVE_UI_DEFAULTS_NOT_ESTABLISHED",
  "PROVIDER_ACCEPTANCE_NOT_ESTABLISHED"
] as const);
const SOURCE_CONTRACT: OwnerWan27R2vGenerationSourceContract = Object.freeze({
  status: "PINNED_SOURCE_LOCAL_PARAMETER_CONTRACT",
  model_id: "wan_27_r2v",
  source_pins: SOURCE_PINS,
  current_media_limits: CURRENT_MEDIA_LIMITS,
  controls: Object.freeze({
    resolution: RESOLUTIONS,
    aspect_ratio: ASPECT_RATIOS,
    video_duration: Object.freeze({ minimum: 2, maximum_with_selected_video: 10, maximum_without_selected_video: 15, unit: "INTEGER_SECONDS" }),
    prompt_extend: "BOOLEAN",
    seed: Object.freeze({ nullable: true, minimum: 0, maximum: MAX_SEED, precision: 0 }),
    native_audio: false
  }),
  prompt_limit: Object.freeze({ maximum_length: 1_500, source: "PINNED_B066_PUBLIC_CATALOG_ONLY_NOT_CURRENT_UI_LIMIT" }),
  wire_facts: Object.freeze({
    fixed_fields: Object.freeze({ shot_type: "single", audio_setting: "auto" }),
    fixed_fields_source: "PINNED_R2V_CONDITIONAL_VISIBILITY_RESET",
    duration_source: "ROUNDED_SELECTED_DURATION_PER_CLIP_THEN_SUMMED_TO_2_DECIMALS_IMAGE_ONLY_ZERO",
    prompt_reference_policy: "MATCH_CURRENT_FINAL_OWNED_URL_TRIPLES_IDENTITY_OTHER_URLS_REMAIN_TEXT",
    file_url_deduplication: "FIRST_BY_TYPED_ROLE_AND_URL"
  }),
  coverage_gaps: COVERAGE_GAPS
});

export class OwnerWan27R2vGenerationParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS" | "REFERENCE_CONTEXT_UNAVAILABLE") {
    super(code === "INVALID_PARAMETERS"
      ? "WAN 2.7 R2V explicit parameters are invalid."
      : "WAN 2.7 R2V reference context is unavailable.");
    this.name = "OwnerWan27R2vGenerationParametersError";
  }
}

/** Returns pinned static limits and explicit source-coverage gaps; it is not a wire contract. */
export function getOwnerWan27R2vGenerationParametersSource(): OwnerWan27R2vGenerationSourceContract {
  return SOURCE_CONTRACT;
}

/** Normalizes explicit local controls against genuine current owner-bound reference contexts. */
export async function normalizeOwnerWan27R2vGenerationParameters(
  input: unknown,
  options: OwnerWan27R2vGenerationParametersOptions,
  signal?: AbortSignal
): Promise<OwnerWan27R2vGenerationNormalizedIntent> {
  const parsed = parseInput(input);
  const settings = parsed.intent.parameters;
  const optionFields = exactRecord(options, ["referenceService", "manifest"]);
  if (!isOwnerWan27R2vReferenceService(optionFields.referenceService) ||
      !optionFields.referenceService.isOwnedManifest(optionFields.manifest)) referenceUnavailable();

  let counts: OwnerWan27R2vGenerationReferenceContext;
  try {
    counts = await optionFields.referenceService.withCapturedNativeReferences(optionFields.manifest,
      (_client, contexts) => summarizeReferences(contexts), signal);
  } catch { referenceUnavailable(); }
  if (counts.total_reference_count < 1 || counts.total_reference_count > 6 || counts.selected_video_reference_count > 5 ||
      (counts.selected_video_reference_count > 0 && counts.total_reference_count > 5) || counts.image_reference_count > 6 ||
      counts.image_reference_count + counts.selected_video_reference_count !== counts.total_reference_count) referenceUnavailable();
  const maximum = counts.selected_video_reference_count > 0 ? 10 : 15;
  if (settings.video_duration > maximum) invalid();
  const referenceContext = Object.freeze({ ...counts, maximum_video_duration_seconds: maximum as 10 | 15 });
  return deepFreeze({
    status: "EXPLICIT_LOCAL_PARAMETERS_NORMALIZED" as const,
    intent: parsed.intent,
    reference_context: referenceContext,
    source_pins: SOURCE_PINS,
    coverage_gaps: COVERAGE_GAPS,
    effective_defaults: "UNKNOWN" as const
  });
}

function parseInput(input: unknown): Readonly<{ intent: OwnerWan27R2vGenerationIntent }> {
  const request = exactRecord(input, ["model_id", "parameters"], ["prompt"]);
  if (request.model_id !== "wan_27_r2v") invalid();
  let prompt: string | undefined;
  if (Object.hasOwn(request, "prompt")) {
    if (typeof request.prompt !== "string" || request.prompt.length > SOURCE_CONTRACT.prompt_limit.maximum_length || !isWellFormedUnicode(request.prompt)) invalid();
    prompt = request.prompt;
  }
  const raw = exactRecord(request.parameters, ["resolution", "aspect_ratio", "video_duration", "prompt_extend", "seed", "native_audio"]);
  if (!isOneOf(raw.resolution, RESOLUTIONS) || !isOneOf(raw.aspect_ratio, ASPECT_RATIOS) ||
      !Number.isSafeInteger(raw.video_duration) || (raw.video_duration as number) < 2 || (raw.video_duration as number) > 15 ||
      typeof raw.prompt_extend !== "boolean" || !(raw.seed === null || (Number.isSafeInteger(raw.seed) &&
        (raw.seed as number) >= 0 && (raw.seed as number) <= MAX_SEED)) || raw.native_audio !== false) invalid();
  const parameters: OwnerWan27R2vGenerationParameters = Object.freeze({
    resolution: raw.resolution as OwnerWan27R2vGenerationResolution,
    aspect_ratio: raw.aspect_ratio as OwnerWan27R2vGenerationAspectRatio,
    video_duration: raw.video_duration as number,
    prompt_extend: raw.prompt_extend,
    seed: raw.seed as number | null,
    native_audio: false
  });
  const intent: OwnerWan27R2vGenerationIntent = Object.freeze({
    model_id: "wan_27_r2v",
    ...(prompt === undefined ? {} : { prompt }),
    parameters
  });
  return Object.freeze({ intent });
}

function summarizeReferences(contexts: readonly OwnerWan27R2vUploadContext[]): OwnerWan27R2vGenerationReferenceContext {
  let imageCount = 0;
  let videoCount = 0;
  for (const context of contexts) {
    if (context.status !== "uploaded" || context.model_id !== "wan_27_r2v") referenceUnavailable();
    if (context.media_type === "image") imageCount += 1;
    else if (context.media_type === "selected_video") videoCount += 1;
    else referenceUnavailable();
  }
  return Object.freeze({
    image_reference_count: imageCount,
    selected_video_reference_count: videoCount,
    total_reference_count: contexts.length,
    maximum_video_duration_seconds: videoCount > 0 ? 10 : 15
  });
}

function exactRecord(value: unknown, requiredKeys: readonly string[], optionalKeys: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const allowed = [...requiredKeys, ...optionalKeys];
    if ((prototype !== Object.prototype && prototype !== null) || requiredKeys.some((key) => !Object.hasOwn(descriptors, key)) ||
        keys.length < requiredKeys.length || keys.length > allowed.length || keys.some((key) =>
          typeof key !== "string" || !allowed.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
    return Object.fromEntries(keys.map((key) => [key as string, descriptors[key as string]!.value]));
  } catch { return invalid(); }
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function invalid(): never { throw new OwnerWan27R2vGenerationParametersError("INVALID_PARAMETERS"); }
function referenceUnavailable(): never { throw new OwnerWan27R2vGenerationParametersError("REFERENCE_CONTEXT_UNAVAILABLE"); }
