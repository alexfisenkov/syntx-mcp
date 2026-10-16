import { isProxy } from "node:util/types";

export const OWNER_VEO_OMNI_MODEL_ID = "veo_omni" as const;
const MODEL_ID = OWNER_VEO_OMNI_MODEL_ID;
const AI_NAME = "veo3" as const;
const SOURCE_PINS = deepFreeze({
  public_catalog_version: "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json",
  public_models_sha256: "sha256:92c31dba26eb9c0ccf68cdf92a105e6e808c92b187286e4fb366debe051982e1",
  source_build_id: "1792156098",
  modules: {
    veo_form: "sha256:75c37d86280482f13b12d5edd546c36c0314cac91c24984aae0a6e9c7ba925a1",
    constants: "sha256:f56c58e705e32b6a4ddfc7cc44e62fd6ca029e6c33a848621812428a365ef2c2",
    video_sender: "sha256:3dbb36e710d6e35ae9babef856678af06cb5d2352beb7a67aa60d47cd6ffc49b",
    quality_helper: "sha256:7a38ef339db6700d1ccf7fe5a5be23e56722144f216e1db29bf7ff07b8849bf4",
    app: "sha256:eb1b2c82b9f62fbe378064bbd607cdb5cc875a4df1d2ae6f2d531d4baa59f042",
    settings_helper: "sha256:7fb7a1113b89060cdd9af313cb3f4a140c754959fbda3d997f49bdcacabc52e6",
    video_route: "sha256:8310cb1c9ac8221077220da873cfe785e35408b43b1cfba85d409272c9b44596"
  }
} as const);

const CONTROL_REPORT = deepFreeze({
  type: ["text", "image", "references"] as const,
  upscale: {
    values: [0, 1, 2, 3] as const,
    labels: { 0: "720p", 1: "1080p", 2: "4K", 3: "360p Draft" } as const
  },
  aspect_ratio: ["16:9", "9:16"] as const,
  video_duration: [4, 6, 8, 10] as const,
  reference_counts: {
    text: { images: [0, 0], videos: [0, 0] },
    image: { images: [1, 2], videos: [0, 0] },
    references: {
      images_only: { images: [1, 7], videos: [0, 0] },
      one_video_with_images: { images: [0, 5], videos: [1, 1] }
    }
  },
  initializer_candidate: {
    type: "text",
    aspect_ratio: "16:9",
    video_duration: 8,
    upscale: 0,
    semantics: "FORM_INITIALIZER_ONLY_NOT_EFFECTIVE_DEFAULT"
  }
} as const);

const SETTINGS_SELECTION = deepFreeze({
  helper_effect: "GLOBAL_SETTINGS_STORE_NOT_PAYLOAD_RETURN",
  dispatch_owner: "VIDEO_ROUTE_NOT_OMNI_FORM",
  truthy_custom_payload: "REPLACE_SETTINGS_SHALLOW_SNAPSHOT",
  otherwise: "SHALLOW_SETTINGS_SNAPSHOT",
  custom_payload_reset: "NULL_ON_RESET_PAGE_SETTINGS",
  references: "OWNED_BINDING_REQUIRED"
} as const);

const COST_PROJECTION = deepFreeze({
  caller_keys: ["upscale", "video_duration"] as const,
  video_reference_extra: { mode: "video_ref" } as const,
  mode_in_generation_settings: "NOT_ESTABLISHED_BY_COST_QUERY",
  amount_or_quote: "UNPROVEN"
} as const);

const REPORT: OwnerVeoOmniParameterReport = deepFreeze({
  status: "SOURCE_REVIEWED_STATIC_ONLY",
  model_id: MODEL_ID,
  ai_name: AI_NAME,
  source_pins: SOURCE_PINS,
  controls: CONTROL_REPORT,
  settings_selection: SETTINGS_SELECTION,
  cost_projection: COST_PROJECTION,
  effective_defaults: "UNKNOWN",
  duration_upscale_compatibility: "UNKNOWN_NOT_ENFORCED",
  settings_serializer: "SOURCE_JOINED_COMMON_SETTINGS_BRANCH_REFERENCES_UNBOUND",
  runtime_usable: false,
  dispatch_allowed: false,
  backend_acceptance: "UNPROVEN"
});

const REQUEST_KEYS = Object.freeze(["model_id", "parameters"] as const);
const PARAMETER_KEYS = Object.freeze(["type", "upscale", "aspect_ratio", "video_duration", "reference_counts"] as const);
const COUNT_KEYS = Object.freeze(["images", "videos"] as const);

export type OwnerVeoOmniInputType = "text" | "image" | "references";
export interface OwnerVeoOmniReferenceCounts {
  readonly images: number;
  readonly videos: number;
}
export interface OwnerVeoOmniExplicitParameterValues {
  readonly type: OwnerVeoOmniInputType;
  readonly upscale: 0 | 1 | 2 | 3;
  readonly aspect_ratio: "16:9" | "9:16";
  readonly video_duration: 4 | 6 | 8 | 10;
  readonly reference_counts: OwnerVeoOmniReferenceCounts;
}
export interface OwnerVeoOmniParameterInput {
  readonly model_id: typeof MODEL_ID;
  readonly parameters: OwnerVeoOmniExplicitParameterValues;
}
export interface OwnerVeoOmniCostParametersCandidate {
  readonly upscale: 0 | 1 | 2 | 3;
  readonly video_duration: 4 | 6 | 8 | 10;
  readonly mode?: "video_ref";
}
export interface OwnerVeoOmniSettingsSelection {
  readonly helper_effect: "GLOBAL_SETTINGS_STORE_NOT_PAYLOAD_RETURN";
  readonly dispatch_owner: "VIDEO_ROUTE_NOT_OMNI_FORM";
  readonly truthy_custom_payload: "REPLACE_SETTINGS_SHALLOW_SNAPSHOT";
  readonly otherwise: "SHALLOW_SETTINGS_SNAPSHOT";
  readonly custom_payload_reset: "NULL_ON_RESET_PAGE_SETTINGS";
  readonly references: "OWNED_BINDING_REQUIRED";
}
export interface OwnerVeoOmniCostProjection {
  readonly caller_keys: readonly ["upscale", "video_duration"];
  readonly video_reference_extra: Readonly<{ mode: "video_ref" }>;
  readonly mode_in_generation_settings: "NOT_ESTABLISHED_BY_COST_QUERY";
  readonly amount_or_quote: "UNPROVEN";
}
export interface OwnerVeoOmniSourcePins {
  readonly public_catalog_version: string;
  readonly public_models_sha256: string;
  readonly source_build_id: string;
  readonly modules: Readonly<Record<string, string>>;
}
export interface OwnerVeoOmniControls {
  readonly type: readonly OwnerVeoOmniInputType[];
  readonly upscale: Readonly<{ values: readonly (0 | 1 | 2 | 3)[]; labels: Readonly<Record<0 | 1 | 2 | 3, string>> }>;
  readonly aspect_ratio: readonly ["16:9", "9:16"];
  readonly video_duration: readonly [4, 6, 8, 10];
  readonly reference_counts: Readonly<Record<string, unknown>>;
  readonly initializer_candidate: Readonly<Record<string, unknown>>;
}
export interface OwnerVeoOmniParameterReport {
  readonly status: "SOURCE_REVIEWED_STATIC_ONLY";
  readonly model_id: typeof MODEL_ID;
  readonly ai_name: typeof AI_NAME;
  readonly source_pins: OwnerVeoOmniSourcePins;
  readonly controls: OwnerVeoOmniControls;
  readonly settings_selection: OwnerVeoOmniSettingsSelection;
  readonly cost_projection: OwnerVeoOmniCostProjection;
  readonly effective_defaults: "UNKNOWN";
  readonly duration_upscale_compatibility: "UNKNOWN_NOT_ENFORCED";
  readonly settings_serializer: "SOURCE_JOINED_COMMON_SETTINGS_BRANCH_REFERENCES_UNBOUND";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}
export interface OwnerVeoOmniNormalizedParameters {
  readonly status: "SOURCE_REVIEWED_EXPLICIT_PARAMETER_CANDIDATE";
  readonly model_id: typeof MODEL_ID;
  readonly parameters: Readonly<Omit<OwnerVeoOmniExplicitParameterValues, "reference_counts">>;
  readonly cost_parameters_candidate: OwnerVeoOmniCostParametersCandidate;
  readonly cost_projection_status: "SOURCE_DERIVED_READ_ONLY_CANDIDATE_NOT_A_QUOTE";
  readonly source_pins: OwnerVeoOmniSourcePins;
  readonly effective_defaults: "UNKNOWN";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerVeoOmniParametersError extends Error {
  readonly code = "INVALID_PARAMETERS" as const;
  constructor() {
    super("Veo Omni explicit parameters are invalid.");
    this.name = "OwnerVeoOmniParametersError";
  }
}

/** Static source facts only; public controls, initializers, and sender fragments do not prove effective defaults or wire support. */
export function getOwnerVeoOmniGenerationParameterReport(): OwnerVeoOmniParameterReport {
  return REPORT;
}

/** Validates explicit UI values and mode-specific counts. Counts validate shape only and are not projected as file bindings. */
export function normalizeOwnerVeoOmniGenerationParameters(input: unknown): OwnerVeoOmniNormalizedParameters {
  try {
    const request = exactRecord(input, REQUEST_KEYS);
    if (request.model_id !== MODEL_ID) invalid();
    const raw = exactRecord(request.parameters, PARAMETER_KEYS);
    if (!(CONTROL_REPORT.type as readonly unknown[]).includes(raw.type) ||
        !(CONTROL_REPORT.upscale.values as readonly unknown[]).includes(raw.upscale) ||
        !(CONTROL_REPORT.aspect_ratio as readonly unknown[]).includes(raw.aspect_ratio) ||
        !(CONTROL_REPORT.video_duration as readonly unknown[]).includes(raw.video_duration)) invalid();
    const counts = exactRecord(raw.reference_counts, COUNT_KEYS);
    if (!isCount(counts.images) || !isCount(counts.videos)) invalid();
    if (!validReferenceCounts(raw.type as OwnerVeoOmniInputType, counts.images, counts.videos)) invalid();

    const parameters = deepFreeze({
      type: raw.type as OwnerVeoOmniInputType,
      upscale: raw.upscale as 0 | 1 | 2 | 3,
      aspect_ratio: raw.aspect_ratio as "16:9" | "9:16",
      video_duration: raw.video_duration as 4 | 6 | 8 | 10
    });
    const costParametersCandidate = deepFreeze({
      upscale: parameters.upscale,
      video_duration: parameters.video_duration,
      ...(raw.type === "references" && counts.videos === 1 ? { mode: "video_ref" as const } : {})
    });
    return deepFreeze({
      status: "SOURCE_REVIEWED_EXPLICIT_PARAMETER_CANDIDATE",
      model_id: MODEL_ID,
      parameters,
      cost_parameters_candidate: costParametersCandidate,
      cost_projection_status: "SOURCE_DERIVED_READ_ONLY_CANDIDATE_NOT_A_QUOTE",
      source_pins: SOURCE_PINS,
      effective_defaults: "UNKNOWN",
      runtime_usable: false,
      dispatch_allowed: false,
      backend_acceptance: "UNPROVEN"
    });
  } catch (error) {
    if (error instanceof OwnerVeoOmniParametersError) throw error;
    invalid();
  }
}

function validReferenceCounts(type: OwnerVeoOmniInputType, images: number, videos: number): boolean {
  if (type === "text") return images === 0 && videos === 0;
  if (type === "image") return images >= 1 && images <= 2 && videos === 0;
  return (videos === 0 && images >= 1 && images <= 7) || (videos === 1 && images >= 0 && images <= 5);
}

function exactRecord(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value)) invalid();
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== required.length || keys.some((key) => typeof key !== "string" || !required.includes(key) ||
        !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
    const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) copy[key] = descriptors[key]!.value;
    return copy;
  } catch (error) {
    if (error instanceof OwnerVeoOmniParametersError) throw error;
    invalid();
  }
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}

function invalid(): never {
  throw new OwnerVeoOmniParametersError();
}
