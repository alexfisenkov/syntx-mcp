import { isProxy } from "node:util/types";
import { loadMaplessSettingsInventoryVersion } from "../catalog/mapless-settings-inventory.js";
import { loadPinnedWanResolutionRatioCandidatesV25 } from "../catalog/wan-resolution-ratio-candidates-v25.js";
import { loadPublicCatalogVersion } from "../catalog/public-catalog-history.js";

const PUBLIC_CATALOG_VERSION = "sha256-c5c10b9b0bffdc4b75dab3363de10c2c2856f1130a559eb9e8a21a1493bf067c.json" as const;
const SETTINGS_INVENTORY_VERSION = "sha256-62bcf08172eb75011055d9ae04c772362b72337646ee2e460944d7fcb2301bcf.json" as const;
const FORM_SHA256 = "sha256:aae2be04ca8a814db7dfb93717a234f55922b4b9f0ebc3eccd517c9d82f46119" as const;
const FORM_BYTES = 19_503 as const;
const MODELS = Object.freeze([
  { model_id: "wan_25_i2v_preview", operation_family_candidate: "i2v" },
  { model_id: "wan_25_t2v_preview", operation_family_candidate: "audio_conditioned_t2v_candidate" },
  { model_id: "wan_26_i2v", operation_family_candidate: "i2v" },
  { model_id: "wan_26_i2v_flash", operation_family_candidate: "i2v" },
  { model_id: "wan_26_r2v", operation_family_candidate: "r2v" },
  { model_id: "wan_26_r2v_flash", operation_family_candidate: "r2v" },
  { model_id: "wan_26_t2v", operation_family_candidate: "t2v" },
  { model_id: "wan_27_i2v", operation_family_candidate: "i2v" },
  { model_id: "wan_27_r2v", operation_family_candidate: "r2v" },
  { model_id: "wan_27_t2v", operation_family_candidate: "t2v" },
  { model_id: "wan_27_videoedit", operation_family_candidate: "videoedit" }
] as const);
const RESOLUTIONS_BY_MODEL = Object.freeze({
  wan_25_i2v_preview: ["480P", "720P", "1080P"],
  wan_25_t2v_preview: ["480P", "720P", "1080P"],
  wan_26_i2v: ["720P", "1080P"],
  wan_26_i2v_flash: ["720P", "1080P"],
  wan_26_r2v: ["720P", "1080P"],
  wan_26_r2v_flash: ["720P", "1080P"],
  wan_26_t2v: ["720P", "1080P"],
  wan_27_i2v: ["720P", "1080P"],
  wan_27_r2v: ["720P", "1080P"],
  wan_27_t2v: ["720P", "1080P"],
  wan_27_videoedit: ["720P", "1080P"]
} as const satisfies Record<(typeof MODELS)[number]["model_id"], readonly string[]>);
const RATIOS_480 = Object.freeze(["16:9", "9:16", "1:1"] as const);
const RATIOS_OTHER = Object.freeze(["16:9", "9:16", "1:1", "4:3", "3:4"] as const);
const UNPROVEN_CONTROLS = Object.freeze([
  "video_duration", "prompt_extend", "shot_type", "audio_setting", "native_audio", "seed",
  "model_type", "file_urls", "prompt", "effective_defaults", "provider_acceptance"
] as const);

type WanModelId = (typeof MODELS)[number]["model_id"];
type WanResolution = "480P" | "720P" | "1080P";
type WanRatio = (typeof RATIOS_OTHER)[number];
type WanFamily = (typeof MODELS)[number]["operation_family_candidate"];
type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export interface OwnerWanVideoSourceParametersReport {
  readonly profile_id: "owner-wan-video-static-parameters-v1";
  readonly source_pins: Readonly<{
    public_catalog_version: typeof PUBLIC_CATALOG_VERSION;
    settings_inventory_version: typeof SETTINGS_INVENTORY_VERSION;
    form_module: "wan-video.js";
    form_bytes: typeof FORM_BYTES;
    form_sha256: typeof FORM_SHA256;
    ratio_candidate_artifact: "sha256-1771f7367a161d13cc5cdf4c7363c498d51f809cea11d0e657786e5328c98a3f.json";
    ratio_candidate_public_catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
    ratio_candidate_settings_inventory_version: "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json";
    ratio_candidate_evidence_scope: "PRIOR_CATALOG_AND_SETTINGS_WITH_EXACT_CURRENT_FORM_HASH";
  }>;
  readonly models: readonly Readonly<{
    model_id: WanModelId;
    operation_family_candidate: WanFamily;
    model_status: "ACTIVE_IN_C5_PUBLIC_CATALOG_AND_62BC_SETTINGS_INVENTORY";
    cost_input_keys: readonly string[];
    cost_input_confidence: "CATALOG_QUERY_KEYS_ONLY_NOT_PRICE_OR_QUOTE";
  }>[];
  readonly controls: Readonly<{
    resolution: Readonly<{
      status: "PARTIAL_STATIC_UI_CANDIDATE";
      values_by_model: Readonly<Record<WanModelId, readonly WanResolution[]>>;
      default: "UNKNOWN";
      model_applicability: "UNKNOWN";
    }>;
    aspect_ratio: Readonly<{
      status: "PARTIAL_STATIC_UI_CANDIDATE";
      branches: readonly [
        Readonly<{ when: "resolution === 480P"; allowed_values: typeof RATIOS_480 }>,
        Readonly<{ when: "resolution !== 480P"; allowed_values: typeof RATIOS_OTHER }>
      ];
      default: "UNKNOWN";
      model_applicability: "UNKNOWN";
    }>;
  }>;
  readonly unproven_controls: typeof UNPROVEN_CONTROLS;
  readonly effective_defaults: "UNKNOWN";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerWanVideoNormalizedParameters {
  readonly model_id: WanModelId;
  readonly operation_family_candidate: WanFamily;
  readonly parameters: Readonly<{ resolution: WanResolution; aspect_ratio: WanRatio }>;
  readonly cost_input_keys: readonly string[];
  readonly completeness: "PARTIAL_STATIC_SOURCE_CANDIDATE";
  readonly dispatch_allowed: false;
  readonly runtime_usable: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerWanVideoParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS" | "SOURCE_EVIDENCE_UNAVAILABLE") {
    super(code === "INVALID_PARAMETERS" ? "WAN video parameters are invalid." : "WAN video source evidence is unavailable.");
    this.name = "OwnerWanVideoParametersError";
  }
}

/** Reports C5 public model/cost-key metadata and partial static UI evidence; no provider or runtime capability is implied. */
export function getOwnerWanVideoSourceParameters(): DeepReadonly<OwnerWanVideoSourceParametersReport> {
  return buildSourceReport();
}

/** Strictly validates only the source-backed resolution/ratio branch; does not supply defaults or authorize generation. */
export function normalizeOwnerWanVideoParameters(input: unknown): OwnerWanVideoNormalizedParameters {
  const request = readExactRecord(input, ["model_id", "parameters"]);
  if (!isWanModelId(request.model_id)) invalid();
  const raw = readExactRecord(request.parameters, ["resolution", "aspect_ratio"]);
  const modelId = request.model_id;
  const resolution = raw.resolution;
  const ratio = raw.aspect_ratio;
  const resolutions = RESOLUTIONS_BY_MODEL[modelId] as readonly string[];
  const allowedRatios: readonly string[] = resolution === "480P" ? RATIOS_480 : RATIOS_OTHER;
  if (!resolutions.includes(resolution as string) || !allowedRatios.includes(ratio as WanRatio)) invalid();
  const model = MODELS.find((candidate) => candidate.model_id === modelId)!;
  const sourceModel = buildSourceReport().models.find((candidate) => candidate.model_id === modelId);
  if (!sourceModel) unavailable();
  return deepFreeze({
    model_id: modelId,
    operation_family_candidate: model.operation_family_candidate,
    parameters: { resolution: resolution as WanResolution, aspect_ratio: ratio as WanRatio },
    cost_input_keys: [...sourceModel.cost_input_keys],
    completeness: "PARTIAL_STATIC_SOURCE_CANDIDATE" as const,
    dispatch_allowed: false as const,
    runtime_usable: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

/** Maps only the two validated UI fields; this object is not a full provider payload or dispatch-ready settings. */
export function projectOwnerWanVideoWireSettings(normalized: OwnerWanVideoNormalizedParameters) {
  if (!isNormalizedParameters(normalized)) invalid();
  return deepFreeze({
    settings_candidate: {
      resolution: normalized.parameters.resolution,
      aspect_ratio: normalized.parameters.aspect_ratio
    },
    mapping_status: "PARTIAL_STATIC_SOURCE_CANDIDATE" as const,
    runtime_usable: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

function buildSourceReport(): DeepReadonly<OwnerWanVideoSourceParametersReport> {
  const inventory = loadMaplessSettingsInventoryVersion(SETTINGS_INVENTORY_VERSION);
  const catalog = loadPublicCatalogVersion(PUBLIC_CATALOG_VERSION);
  if (inventory.public_catalog.version !== PUBLIC_CATALOG_VERSION ||
      inventory.build.id !== "1791467421" || catalog.models.length === 0) unavailable();
  const form = inventory.forms.find((candidate) => candidate.form_id === "wan-video");
  if (!form || form.module_name !== "wan-video.js" || form.javascript.bytes !== FORM_BYTES ||
      form.javascript.sha256 !== FORM_SHA256) unavailable();
  const ratios = loadPinnedWanResolutionRatioCandidatesV25();
  if (!ratios || ratios.artifact.source_identity.sha256 !== FORM_SHA256 ||
      ratios.artifact.source_identity.bytes !== FORM_BYTES) unavailable();
  const models = MODELS.map((expected) => {
    const row = inventory.models.find((candidate) => candidate.model_id === expected.model_id);
    const publicRow = catalog.models.find((candidate) => candidate.value === expected.model_id);
    const costKeys = row?.settings?.get_cost_params;
    if (!row || !row.active || row.ai_name !== "wan_video" || row.form_id !== "wan-video" ||
        row.settings_status !== "PUBLIC_SETTINGS_KNOWN" || !publicRow || !publicRow.active ||
        publicRow.ai_name !== "wan_video" || !Array.isArray(costKeys) ||
        !row.model_value_settings_keys.includes("resolution") || !row.model_value_settings_keys.includes("aspect_ratio")) unavailable();
    return {
      model_id: expected.model_id,
      operation_family_candidate: expected.operation_family_candidate,
      model_status: "ACTIVE_IN_C5_PUBLIC_CATALOG_AND_62BC_SETTINGS_INVENTORY" as const,
      cost_input_keys: [...costKeys] as string[],
      cost_input_confidence: "CATALOG_QUERY_KEYS_ONLY_NOT_PRICE_OR_QUOTE" as const
    };
  });
  if (new Set(models.map((model) => model.model_id)).size !== MODELS.length) unavailable();
  return deepFreeze({
    profile_id: "owner-wan-video-static-parameters-v1" as const,
    source_pins: {
      public_catalog_version: PUBLIC_CATALOG_VERSION,
      settings_inventory_version: SETTINGS_INVENTORY_VERSION,
      form_module: "wan-video.js" as const,
      form_bytes: FORM_BYTES,
      form_sha256: FORM_SHA256,
      ratio_candidate_artifact: "sha256-1771f7367a161d13cc5cdf4c7363c498d51f809cea11d0e657786e5328c98a3f.json" as const,
      ratio_candidate_public_catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json" as const,
      ratio_candidate_settings_inventory_version: "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json" as const,
      ratio_candidate_evidence_scope: "PRIOR_CATALOG_AND_SETTINGS_WITH_EXACT_CURRENT_FORM_HASH" as const
    },
    models,
    controls: {
      resolution: {
        status: "PARTIAL_STATIC_UI_CANDIDATE" as const,
        values_by_model: RESOLUTIONS_BY_MODEL,
        default: "UNKNOWN" as const,
        model_applicability: "UNKNOWN" as const
      },
      aspect_ratio: {
        status: "PARTIAL_STATIC_UI_CANDIDATE" as const,
        branches: [
          { when: "resolution === 480P" as const, allowed_values: RATIOS_480 },
          { when: "resolution !== 480P" as const, allowed_values: RATIOS_OTHER }
        ] as const,
        default: "UNKNOWN" as const,
        model_applicability: "UNKNOWN" as const
      }
    },
    unproven_controls: UNPROVEN_CONTROLS,
    effective_defaults: "UNKNOWN" as const,
    runtime_usable: false as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

function isNormalizedParameters(value: unknown): value is OwnerWanVideoNormalizedParameters {
  if (!isPlainRecord(value)) return false;
  try {
    const row = readExactRecord(value, ["model_id", "operation_family_candidate", "parameters", "cost_input_keys", "completeness", "dispatch_allowed", "runtime_usable", "backend_acceptance"]);
    if (!isWanModelId(row.model_id) || row.dispatch_allowed !== false || row.runtime_usable !== false ||
        row.backend_acceptance !== "UNPROVEN" || row.completeness !== "PARTIAL_STATIC_SOURCE_CANDIDATE" ||
        !Array.isArray(row.cost_input_keys) || row.cost_input_keys.some((key) => typeof key !== "string")) return false;
    const expected = MODELS.find((model) => model.model_id === row.model_id);
    if (!expected || expected.operation_family_candidate !== row.operation_family_candidate) return false;
    const params = readExactRecord(row.parameters, ["resolution", "aspect_ratio"]);
    const resolution = params.resolution;
    const aspect = params.aspect_ratio;
    const allowedRatios: readonly string[] = resolution === "480P" ? RATIOS_480 : RATIOS_OTHER;
    return (RESOLUTIONS_BY_MODEL[row.model_id] as readonly string[]).includes(resolution as string) &&
      allowedRatios.includes(aspect as string);
  } catch { return false; }
}

function isWanModelId(value: unknown): value is WanModelId {
  return typeof value === "string" && MODELS.some((model) => model.model_id === value);
}

function readExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(value)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}

function invalid(): never { throw new OwnerWanVideoParametersError("INVALID_PARAMETERS"); }
function unavailable(): never { throw new OwnerWanVideoParametersError("SOURCE_EVIDENCE_UNAVAILABLE"); }
