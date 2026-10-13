import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { loadMaplessSettingsInventoryVersion, type MaplessSettingsInventory } from "../catalog/mapless-settings-inventory.js";
import { loadSelectedDiscoveryCatalog } from "../catalog/selected-discovery-catalog.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";

export const OWNER_VIDEO2AUDIO_PUBLIC_CATALOG_VERSION = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json" as const;
export const OWNER_VIDEO2AUDIO_SETTINGS_INVENTORY_VERSION = "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json" as const;
export const OWNER_VIDEO2AUDIO_MODEL_ID = "video2audio" as const;
export const OWNER_VIDEO2AUDIO_AI_NAME = "video2audio" as const;
export const OWNER_VIDEO2AUDIO_OPERATION_ID = "generate-audio" as const;
export const OWNER_VIDEO2AUDIO_FORM_SHA256 = "sha256:46f99867fa2ed84c1784bfcf00ca62e32b9b481f2eea661bc6e7870218d84e12" as const;

const PUBLIC_MODELS_SHA256 = "sha256:7ffbeff2ef1efa9d617d6e26e3e1c11e1d355cc45b34a2a427159f7e91fa4667" as const;
const BUILD_ID = "1791811899" as const;
const FORM_BYTES = 4_350;
const LOCAL_PROMPT_UTF16_LIMIT = 5_000;
const LOCAL_VIDEO_BYTES_LIMIT = 10 * 1024 * 1024;
const UI_VIDEO_DURATION_HINT_SECONDS = 20;
const PROFILE_BRAND = new WeakSet<object>();

export interface OwnerVideo2AudioSourceContract {
  readonly status: "CURRENT_B066_1B48_STATIC_SOURCE_CONTRACT_WITH_ONE_UI_WIRE_OBSERVATION";
  readonly source_pins: Readonly<{
    public_catalog_version: typeof OWNER_VIDEO2AUDIO_PUBLIC_CATALOG_VERSION;
    public_models_sha256: typeof PUBLIC_MODELS_SHA256;
    settings_inventory_version: typeof OWNER_VIDEO2AUDIO_SETTINGS_INVENTORY_VERSION;
    build_id: typeof BUILD_ID;
    form_module: "video-2-audio.js";
    form_bytes: typeof FORM_BYTES;
    form_sha256: typeof OWNER_VIDEO2AUDIO_FORM_SHA256;
  }>;
  readonly identity: Readonly<{
    model_id: typeof OWNER_VIDEO2AUDIO_MODEL_ID;
    ai_name: typeof OWNER_VIDEO2AUDIO_AI_NAME;
    model_type: typeof OWNER_VIDEO2AUDIO_MODEL_ID;
    operation_id: typeof OWNER_VIDEO2AUDIO_OPERATION_ID;
    modality: "audio";
  }>;
  readonly wire_observation: Readonly<{
    source: "ROOT1128_CURRENT_CHROME_UI_OBSERVATION";
    method: "POST";
    path: "/api/v1/audio/generate";
    query: Readonly<{ ai_name: typeof OWNER_VIDEO2AUDIO_AI_NAME }>;
    outer_keys: readonly ["chat_uuid", "prompt", "settings"];
    settings_keys: readonly ["model_type", "mode", "duration", "negative_prompt", "seed", "file_urls"];
    file_url_item: Readonly<{ keys: readonly ["type", "url"]; type: "video"; url_source: "SAME_OWNED_UPLOAD_RECEIPT" }>;
    fixed_mode: "generate";
    fixed_negative_prompt: "";
    observed_seed: 0;
    duration_source: "SAME_OWNED_UPLOAD_RECEIPT";
  }>;
  readonly model_access_observation: Readonly<{
    source: "ROOT1128_CURRENT_CHROME_UI_OBSERVATION";
    account_scope: "HISTORICAL_OWNER_UI_OBSERVATION_NOT_CURRENT_USER_ENTITLEMENT";
    current_user_access: "NOT_READ";
    query_keys: readonly ["ai_name", "model_type"];
    cost_parameter_keys: readonly [];
    access: true;
    amount_or_quote: "UNPROVEN";
  }>;
  readonly controls: Readonly<{
    prompt: Readonly<{ source_max_length: "UNKNOWN"; local_bound_utf16: typeof LOCAL_PROMPT_UTF16_LIMIT }>;
    original_video: Readonly<{
      source_accepts: readonly ["video/mp4", "video/webm", "video/quicktime", "video/mov"];
      profile_accepts: readonly ["video/mp4"];
      local_size_bound_bytes: typeof LOCAL_VIDEO_BYTES_LIMIT;
      size_bound_kind: "LOCAL_NATIVE_RESOURCE_BOUND_NOT_PROVIDER_LIMIT";
    }>;
    duration: Readonly<{
      source: "TRUSTED_UPLOAD_METADATA_REQUIRED";
      finite_min_exclusive: 0;
      ui_hint_max_inclusive_seconds: typeof UI_VIDEO_DURATION_HINT_SECONDS;
      max_semantics: "UI_HINT_ONLY_NOT_BACKEND_LIMIT";
      caller_supplied: false;
    }>;
    random_seed: Readonly<{ ui_observed_enabled: true; observed_wire_value: 0; general_semantics: "UNKNOWN" }>;
  }>;
  readonly cost_projection: Readonly<{
    declared_cost_parameter_keys: readonly [];
    query_caller_keys: readonly [];
    transport_owned_keys: readonly ["ai_name", "model_type"];
    amount_or_quote: "UNPROVEN";
  }>;
  readonly defaults: "UNKNOWN";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerVideo2AudioSourceProfile {
  readonly source: OwnerVideo2AudioSourceContract;
  readonly catalog: DiscoveryCatalogRepository;
  readonly settingsInventory: MaplessSettingsInventory;
  readonly profileId: "owner-video2audio-exact-ui-wire-v1";
  readonly profileSchemaHash: string;
}

const SOURCE: OwnerVideo2AudioSourceContract = Object.freeze({
  status: "CURRENT_B066_1B48_STATIC_SOURCE_CONTRACT_WITH_ONE_UI_WIRE_OBSERVATION",
  source_pins: Object.freeze({
    public_catalog_version: OWNER_VIDEO2AUDIO_PUBLIC_CATALOG_VERSION,
    public_models_sha256: PUBLIC_MODELS_SHA256,
    settings_inventory_version: OWNER_VIDEO2AUDIO_SETTINGS_INVENTORY_VERSION,
    build_id: BUILD_ID,
    form_module: "video-2-audio.js",
    form_bytes: FORM_BYTES,
    form_sha256: OWNER_VIDEO2AUDIO_FORM_SHA256
  }),
  identity: Object.freeze({
    model_id: OWNER_VIDEO2AUDIO_MODEL_ID,
    ai_name: OWNER_VIDEO2AUDIO_AI_NAME,
    model_type: OWNER_VIDEO2AUDIO_MODEL_ID,
    operation_id: OWNER_VIDEO2AUDIO_OPERATION_ID,
    modality: "audio"
  }),
  wire_observation: Object.freeze({
    source: "ROOT1128_CURRENT_CHROME_UI_OBSERVATION",
    method: "POST",
    path: "/api/v1/audio/generate",
    query: Object.freeze({ ai_name: OWNER_VIDEO2AUDIO_AI_NAME }),
    outer_keys: Object.freeze(["chat_uuid", "prompt", "settings"] as const),
    settings_keys: Object.freeze(["model_type", "mode", "duration", "negative_prompt", "seed", "file_urls"] as const),
    file_url_item: Object.freeze({
      keys: Object.freeze(["type", "url"] as const),
      type: "video",
      url_source: "SAME_OWNED_UPLOAD_RECEIPT"
    }),
    fixed_mode: "generate",
    fixed_negative_prompt: "",
    observed_seed: 0,
    duration_source: "SAME_OWNED_UPLOAD_RECEIPT"
  }),
  model_access_observation: Object.freeze({
    source: "ROOT1128_CURRENT_CHROME_UI_OBSERVATION",
    account_scope: "HISTORICAL_OWNER_UI_OBSERVATION_NOT_CURRENT_USER_ENTITLEMENT",
    current_user_access: "NOT_READ",
    query_keys: Object.freeze(["ai_name", "model_type"] as const),
    cost_parameter_keys: Object.freeze([] as const),
    access: true,
    amount_or_quote: "UNPROVEN"
  }),
  controls: Object.freeze({
    prompt: Object.freeze({ source_max_length: "UNKNOWN", local_bound_utf16: LOCAL_PROMPT_UTF16_LIMIT }),
    original_video: Object.freeze({
      source_accepts: Object.freeze(["video/mp4", "video/webm", "video/quicktime", "video/mov"] as const),
      profile_accepts: Object.freeze(["video/mp4"] as const),
      local_size_bound_bytes: LOCAL_VIDEO_BYTES_LIMIT,
      size_bound_kind: "LOCAL_NATIVE_RESOURCE_BOUND_NOT_PROVIDER_LIMIT"
    }),
    duration: Object.freeze({
      source: "TRUSTED_UPLOAD_METADATA_REQUIRED",
      finite_min_exclusive: 0,
      ui_hint_max_inclusive_seconds: UI_VIDEO_DURATION_HINT_SECONDS,
      max_semantics: "UI_HINT_ONLY_NOT_BACKEND_LIMIT",
      caller_supplied: false
    }),
    random_seed: Object.freeze({ ui_observed_enabled: true, observed_wire_value: 0, general_semantics: "UNKNOWN" })
  }),
  cost_projection: Object.freeze({
    declared_cost_parameter_keys: Object.freeze([] as const),
    query_caller_keys: Object.freeze([] as const),
    transport_owned_keys: Object.freeze(["ai_name", "model_type"] as const),
    amount_or_quote: "UNPROVEN"
  }),
  defaults: "UNKNOWN",
  runtime_usable: false,
  dispatch_allowed: false,
  backend_acceptance: "UNPROVEN"
});

/** Loads and seals the exact B066/1b48 source binding; it is not a generation permit. */
export function createOwnerVideo2AudioSourceProfile(catalogDirectory?: string): OwnerVideo2AudioSourceProfile {
  const catalog = loadSelectedDiscoveryCatalog(OWNER_VIDEO2AUDIO_PUBLIC_CATALOG_VERSION, catalogDirectory).discoveryCatalog;
  const settingsInventory = loadMaplessSettingsInventoryVersion(OWNER_VIDEO2AUDIO_SETTINGS_INVENTORY_VERSION, catalogDirectory);
  assertSourceBinding(catalog, settingsInventory);
  const profileId = "owner-video2audio-exact-ui-wire-v1" as const;
  const profileSchemaHash = `sha256:${createHash("sha256").update(stableJson(SOURCE)).digest("hex")}`;
  const profile = Object.freeze({ source: SOURCE, catalog, settingsInventory, profileId, profileSchemaHash });
  PROFILE_BRAND.add(profile);
  return profile;
}

export function isAuthenticOwnerVideo2AudioSourceProfile(value: unknown): value is OwnerVideo2AudioSourceProfile {
  return value !== null && typeof value === "object" && PROFILE_BRAND.has(value);
}

function assertSourceBinding(catalog: DiscoveryCatalogRepository, inventory: MaplessSettingsInventory): void {
  const model = catalog.getModel(OWNER_VIDEO2AUDIO_MODEL_ID);
  const modelRow = inventory.models.find((entry) => entry.model_id === OWNER_VIDEO2AUDIO_MODEL_ID);
  const form = inventory.forms.find((entry) => entry.form_id === "video-2-audio");
  if (catalog.source_hashes.models !== PUBLIC_MODELS_SHA256 ||
      inventory.public_catalog.version !== OWNER_VIDEO2AUDIO_PUBLIC_CATALOG_VERSION ||
      inventory.public_catalog.models_sha256 !== PUBLIC_MODELS_SHA256 || inventory.build.id !== BUILD_ID ||
      model.active !== true || model.default !== true || model.ai_name !== OWNER_VIDEO2AUDIO_AI_NAME ||
      model.upstream_id !== OWNER_VIDEO2AUDIO_MODEL_ID || model.scope !== "audio" ||
      !model.operations.some((operation) => operation.id === OWNER_VIDEO2AUDIO_OPERATION_ID && operation.output_modality === "audio") ||
      !Array.isArray(model.settings?.get_cost_params) || model.settings.get_cost_params.length !== 0 ||
      !Array.isArray(model.settings?.accepted_file_types) || !model.settings.accepted_file_types.includes("video/mp4") ||
      !Array.isArray(model.settings?.allowed_media_types) || !model.settings.allowed_media_types.includes("videos") ||
      model.settings.file_count_limit !== 1 ||
      !modelRow || modelRow.active !== true || modelRow.default !== true || modelRow.ai_name !== OWNER_VIDEO2AUDIO_AI_NAME ||
      modelRow.form_id !== "video-2-audio" || modelRow.form_binding_status !== "STRUCTURAL_MATCH" ||
      modelRow.settings_status !== "PUBLIC_SETTINGS_KNOWN" || modelRow.defaults_status !== "UNKNOWN" ||
      modelRow.runtime_usable !== false || !Array.isArray(modelRow.settings?.get_cost_params) || modelRow.settings.get_cost_params.length !== 0 ||
      !form || form.module_name !== "video-2-audio.js" || form.javascript.bytes !== FORM_BYTES ||
      form.javascript.sha256 !== OWNER_VIDEO2AUDIO_FORM_SHA256 || form.javascript.parse_diagnostics !== 0 ||
      !isDeepStrictEqual(modelRow.model_value_settings_keys, ["model_type", "negative_prompt", "seed"])) {
    throw new Error("OWNER_VIDEO2AUDIO_SOURCE_BINDING_UNAVAILABLE");
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + stableJson(record[key])).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
}
