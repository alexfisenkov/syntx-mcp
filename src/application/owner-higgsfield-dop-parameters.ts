import { types } from "node:util";
import { schemaHash } from "../domain/generation-contract.js";

export const OWNER_HIGGSFIELD_DOP_MODEL_IDS = Object.freeze(["dop-lite", "dop-turbo"] as const);
export type OwnerHiggsfieldDopModelId = typeof OWNER_HIGGSFIELD_DOP_MODEL_IDS[number];

const AI_NAME = "higgsfield" as const;
const SCOPE = "video" as const;
const COST_QUERY_KEYS = Object.freeze([] as const);
const PROMPT_MAXIMUM_UTF16_LENGTH = 1_000;
const MAX_MOTIONS = 2;
const MOTION_ID_MAXIMUM_LENGTH = 160;
const MOTION_LABEL_MAXIMUM_LENGTH = 256;

export interface OwnerHiggsfieldDopMotionSelection {
  readonly id: string | number;
  readonly label: string;
  readonly strength: 1;
}

type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

const SOURCE_FACTS = deepFreeze({
  profile_id: "owner-higgsfield-dop-source-parameters-2310-v1",
  status: "STATIC_FORM_AND_PINNED_CATALOG_METADATA_ONLY" as const,
  source_pins: {
    form_build_id: "1792363638" as const,
    form_module: "higgsfield.js" as const,
    form_sha256: "sha256:507dff986465c97c051c7081a6152acfadf51436c3419018b65dd69b2910873a" as const,
    settings_module: "settings3.js" as const,
    settings_sha256: "sha256:7fb7a1113b89060cdd9af313cb3f4a140c754959fbda3d997f49bdcacabc52e6" as const,
    cost_module: "cost2.js" as const,
    cost_sha256: "sha256:3d9bb6b5fb2ee26c8cc61251777fa3bad121a7a5754150fdcfd2f7062bcbc8fa" as const,
    video_module: "video.js" as const,
    video_sha256: "sha256:3dbb36e710d6e35ae9babef856678af06cb5d2352beb7a67aa60d47cd6ffc49b" as const,
    uploader_module: "fileUploader.js" as const,
    uploader_sha256: "sha256:45f3174473d1ae4c9e57fbee47c7bf0c7e75773e9f3b36dbb8c3e5cc7ec3863a" as const
  },
  public_catalog_version: "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json" as const,
  ai_name: AI_NAME,
  scope: SCOPE,
  route: "video/generate" as const,
  model_ids: OWNER_HIGGSFIELD_DOP_MODEL_IDS,
  catalog_default_model_candidate: "dop-lite" as const,
  effective_defaults: "UNKNOWN" as const,
  initial_settings: { enhance_prompt: true as const, motions: Object.freeze([] as const) },
  controls: {
    model_type: { source: "DYNAMIC_MODELS_BY_AI_NAME" as const, values: OWNER_HIGGSFIELD_DOP_MODEL_IDS },
    enhance_prompt: { initial: true as const, explicit_values: Object.freeze([false, true] as const) },
    motions: { initial_value: Object.freeze([] as const), initial_value_valid: false as const,
      min_selected: 1 as const, max_selected: MAX_MOTIONS, shape: "{id,label,strength:1}" as const,
      catalogue_row_fields: Object.freeze(["title", "id", "preview_uri"] as const), preview_uri_exposed: false as const }
  },
  input: {
    accepted_file_count: 1 as const,
    allowed_media_type: "images" as const,
    accepted_mime_types: Object.freeze(["image/jpeg", "image/jpg", "image/avif", "image/webp", "image/png"] as const),
    uploadable_in_catalog: true as const,
    max_file_size_catalog_value: 0 as const,
    max_file_size_semantics: "UNKNOWN" as const
  },
  prompt_maximum_utf16_length: PROMPT_MAXIMUM_UTF16_LENGTH,
  prompt_limit_confidence: "LOCAL_CONSERVATIVE_BOUND_NOT_PROVIDER_LIMIT" as const,
  upload_destination: "TRUSTED_RUNTIME_CONFIGURATION_REQUIRED_NOT_PARAMETER" as const,
  cost_query_keys: COST_QUERY_KEYS,
  cost_confidence: "EMPTY_KEYS_FROM_PINNED_CATALOG_NOT_ZERO_COST_OR_BILLING_PROOF" as const,
  wire: {
    body_fields: Object.freeze(["ai_name", "prompt", "settings"] as const),
    settings_fields: Object.freeze(["model_type", "enhance_prompt", "motions", "file_urls"] as const),
    file_url_shape: { type: "image" as const, cardinality: 1 as const },
    crop_policy: "NO_CROP_OR_RESIZE_IN_INITIAL_SLICE" as const
  },
  input_binding_confidence: "ONE_IMAGE_CATALOG_CARDINALITY_AND_GENERIC_SENDER_FILE_URL_JOIN" as const,
  dispatch_allowed: false as const,
  upload_authority: false as const,
  runtime_usable: false as const,
  backend_acceptance: "UNPROVEN" as const
});

const SOURCE_PROFILE = deepFreeze({ ...SOURCE_FACTS, source_sha256: schemaHash(SOURCE_FACTS) });

export interface OwnerHiggsfieldDopParametersInput {
  readonly model_id: OwnerHiggsfieldDopModelId;
  readonly prompt: string;
  readonly enhance_prompt: false;
  readonly motions: readonly OwnerHiggsfieldDopMotionSelection[];
}

export interface OwnerHiggsfieldDopNormalizedParameters {
  readonly status: "SOURCE_PARAMETERS_ONLY_NOT_DISPATCH_AUTHORITY";
  readonly intent: Readonly<OwnerHiggsfieldDopParametersInput>;
  readonly source_parameters: Readonly<{
    model_type: OwnerHiggsfieldDopModelId;
    enhance_prompt: false;
    motions: readonly OwnerHiggsfieldDopMotionSelection[];
  }>;
  readonly profile_sha256: string;
  readonly prompt_limit_confidence: "LOCAL_CONSERVATIVE_BOUND_NOT_PROVIDER_LIMIT";
  readonly prompt_maximum_utf16_length: number;
  readonly cost_query_keys: readonly [];
  readonly upload_destination: "TRUSTED_RUNTIME_CONFIGURATION_REQUIRED_NOT_PARAMETER";
  readonly dispatch_allowed: false;
  readonly upload_authority: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerHiggsfieldDopParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("Higgsfield DOP parameters are invalid.");
    this.name = "OwnerHiggsfieldDopParametersError";
  }
}

export function getOwnerHiggsfieldDopSourceProfile(): DeepReadonly<typeof SOURCE_PROFILE> {
  return SOURCE_PROFILE;
}

/** Normalizes the explicit DOP parameters and exact motion picker selections. */
export function normalizeOwnerHiggsfieldDopParameters(input: unknown): Readonly<OwnerHiggsfieldDopNormalizedParameters> {
  const fields = exactRecord(input, ["model_id", "prompt", "enhance_prompt", "motions"]);
  if (!isOwnerHiggsfieldDopModelId(fields.model_id) || typeof fields.prompt !== "string" ||
      fields.prompt.trim().length === 0 || !isWellFormedUnicode(fields.prompt) ||
      fields.prompt.length > PROMPT_MAXIMUM_UTF16_LENGTH || fields.enhance_prompt !== false) invalid();

  const motions = normalizeMotionSelections(fields.motions);

  const intent = Object.freeze({ model_id: fields.model_id, prompt: fields.prompt,
    enhance_prompt: false as const, motions });
  const source_parameters = Object.freeze({ model_type: fields.model_id, enhance_prompt: false as const, motions });
  return Object.freeze({
    status: "SOURCE_PARAMETERS_ONLY_NOT_DISPATCH_AUTHORITY" as const,
    intent,
    source_parameters,
    profile_sha256: SOURCE_PROFILE.source_sha256,
    prompt_limit_confidence: "LOCAL_CONSERVATIVE_BOUND_NOT_PROVIDER_LIMIT" as const,
    prompt_maximum_utf16_length: PROMPT_MAXIMUM_UTF16_LENGTH,
    cost_query_keys: COST_QUERY_KEYS,
    upload_destination: "TRUSTED_RUNTIME_CONFIGURATION_REQUIRED_NOT_PARAMETER" as const,
    dispatch_allowed: false as const,
    upload_authority: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

export function isOwnerHiggsfieldDopModelId(value: unknown): value is OwnerHiggsfieldDopModelId {
  return typeof value === "string" && (OWNER_HIGGSFIELD_DOP_MODEL_IDS as readonly string[]).includes(value);
}

function exactRecord(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== required.length ||
        required.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) =>
          typeof key !== "string" || !required.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) output[key] = descriptors[key]!.value;
    return output;
  } catch { return invalid(); }
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

function normalizeMotionSelections(value: unknown): readonly OwnerHiggsfieldDopMotionSelection[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length < 1 || value.length > MAX_MOTIONS) return invalid();
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== value.length + 1 || keys.some(key => key !== "length" &&
        (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)))) return invalid();
    const seen = new Set<string>();
    const result = [] as OwnerHiggsfieldDopMotionSelection[];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) return invalid();
      const row = exactRecord(descriptor.value, ["id", "label", "strength"]);
      const id = row.id;
      if (!((typeof id === "string" && id.length >= 1 && id.length <= MOTION_ID_MAXIMUM_LENGTH && !/[\u0000-\u001f\u007f]/u.test(id)) ||
          (typeof id === "number" && Number.isSafeInteger(id) && id >= 0)) ||
          typeof row.label !== "string" || row.label.length < 1 || row.label.length > MOTION_LABEL_MAXIMUM_LENGTH ||
          !isWellFormedUnicode(row.label) || row.strength !== 1) return invalid();
      const identity = `${typeof id}:${String(id)}`;
      if (seen.has(identity)) return invalid();
      seen.add(identity);
      result.push(Object.freeze({ id, label: row.label, strength: 1 }));
    }
    return Object.freeze(result);
  } catch { return invalid(); }
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}

function invalid(): never { throw new OwnerHiggsfieldDopParametersError("INVALID_PARAMETERS"); }
