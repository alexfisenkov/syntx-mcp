import { isProxy } from "node:util/types";
import { schemaHash } from "../domain/generation-contract.js";
import type { DiscoveryCatalogRepository, DiscoverySourceHashes } from "../catalog/discovery-catalog.js";
import type { MaplessSettingsInventory } from "../catalog/mapless-settings-inventory.js";
import { OWNER_SEEDREAM_IMAGE_VARIANTS, type OwnerSeedreamImageVariant } from "./owner-seedream-image-parameters.js";

export const OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION =
  "sha256-c5c10b9b0bffdc4b75dab3363de10c2c2856f1130a559eb9e8a21a1493bf067c.json" as const;
export const OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION =
  "sha256-62bcf08172eb75011055d9ae04c772362b72337646ee2e460944d7fcb2301bcf.json" as const;

const BUILD_ID = "1791467421";
const PUBLIC_FETCHED_AT = "2026-10-11T12:04:10.638Z";
const PUBLIC_SOURCE_HASHES = Object.freeze({
  ai: "sha256:b99bb90d170acb5a3a06c5be0cbc51d2ab0d17902bee21303a44b32c5fcaef39",
  llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
  models: "sha256:16735c498e3743b67fb384ccee44de34ffd3ac8debaeb46033a5723938191a58"
} as const);
const DEFAULTS = Object.freeze({
  "seedream-4": false, "seedream-4.5": false, "seedream-5": true,
  "seedream-5.0-flash": false, "seedream-5.0-pro": false
} satisfies Readonly<Record<OwnerSeedreamImageVariant, boolean>>);
const BASIC_MIMES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"] as const);
const FLASH_MIMES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/heic", "image/heif", "image/tiff", "image/gif", "image/webp"] as const);
const PRO_MIMES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/webp", "image/gif", "image/tiff", "image/heic", "image/heif"] as const);
const COMMON_SETTINGS = Object.freeze({ allowed_media_types: ["images"], attach_info_text: null, max_prompt_length: 0, uploadable: true });
const MODEL_SETTINGS: Readonly<Record<OwnerSeedreamImageVariant, Readonly<Record<string, unknown>>>> = Object.freeze({
  "seedream-4": Object.freeze({ ...COMMON_SETTINGS, accepted_file_types: BASIC_MIMES, file_count_limit: 4, get_cost_params: [], max_file_size: 10_485_760 }),
  "seedream-4.5": Object.freeze({ ...COMMON_SETTINGS, accepted_file_types: BASIC_MIMES, file_count_limit: 4, get_cost_params: [], max_file_size: 10_485_760 }),
  "seedream-5": Object.freeze({ ...COMMON_SETTINGS, accepted_file_types: BASIC_MIMES, file_count_limit: 14, get_cost_params: [], max_file_size: 10_485_760 }),
  "seedream-5.0-flash": Object.freeze({
    ...COMMON_SETTINGS, accepted_file_types: FLASH_MIMES, file_count_limit: 10, get_cost_params: [], max_file_size: 31_457_280,
    max_image_aspect_ratio: 16, max_image_dimension: 8_400, max_image_file_size: 11_010_048,
    max_image_height: 6_000, max_image_pixel_count: 36_000_000, max_image_width: 6_000,
    min_image_aspect_ratio: 0.0625, min_image_height: 15, min_image_pixel_count: 196, min_image_width: 15
  }),
  "seedream-5.0-pro": Object.freeze({
    ...COMMON_SETTINGS, accepted_file_types: PRO_MIMES, file_count_limit: 10, get_cost_params: ["batch_size", "resolution"], max_file_size: 31_457_280,
    max_image_aspect_ratio: 16, max_image_dimension: 8_400, max_image_file_size: 27_525_120,
    max_image_height: 6_000, max_image_pixel_count: 36_000_000, max_image_width: 6_000,
    max_prompt_length: 0, min_image_aspect_ratio: 0.0625, min_image_height: 15, min_image_pixel_count: 196, min_image_width: 15
  })
});
const EDITOR_FORM = Object.freeze({
  form_id: "seedream-editor",
  module_name: "seedream-editor.js",
  bytes: 7_628,
  sha256: "sha256:2026192d5b0f086446873996ad20cf4691f665d4019621eef3241887ffb3ad7c",
  parse_diagnostics: 0,
  model_value_settings_keys: Object.freeze(["aspect_ratio", "resolution"] as const),
  static_setting_defaults: Object.freeze({})
});
const SOURCE_ARTIFACTS = Object.freeze({
  editor_form: Object.freeze({ module: "seedream-editor.js", bytes: 7_628, sha256: EDITOR_FORM.sha256 }),
  editor_parent: Object.freeze({ module: "InpaintEditor.js", bytes: 24_250, sha256: "sha256:87509acda1040d79927edc30d8ddd18d503a6e7ce9387d5d0a059b1eb5028e14" }),
  generic_sender: Object.freeze({ module: "useInpaintTool.js", bytes: 218_328, sha256: "sha256:de8396adca45a5ba79c9c52cdfa91b23f45285645bed5df120c0f337a192deb2" }),
  settings_helper: Object.freeze({ module: "settings3.js", bytes: 4_123, sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe" }),
  file_upload_component: Object.freeze({ module: "FileUpload.js", bytes: 30_206, sha256: "sha256:2eddb5ee7f0b41cd31f56a2345542d9b5d70da419d1c2b1d003afc36519869d5" }),
  file_uploader: Object.freeze({ module: "fileUploader.js", bytes: 362_328, sha256: "sha256:b1e9af34daa830845c9712121ebb25c92801d22bbcec4f49d8b1748ecbc47786" }),
  app_store_and_upload: Object.freeze({ module: "app.js", bytes: 2_445_534, sha256: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf" })
});

type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export interface OwnerSeedreamEditorOriginalUploadCatalogPort extends Pick<DiscoveryCatalogRepository,
  "getModel" | "fetched_at" | "source_hashes" | "catalog_metadata" | "catalog_kind" | "runtime_usable"> {}

export interface OwnerSeedreamEditorOriginalUploadSourceProfile {
  readonly profile_id: "seedream-editor-original-upload-source-profile-v1";
  readonly variant: OwnerSeedreamImageVariant;
  readonly model_id: OwnerSeedreamImageVariant;
  readonly model_type: OwnerSeedreamImageVariant;
  readonly navigation_id: "seedream-editor";
  readonly family_ai_name: "seedream";
  readonly form_ai_name: "seedream-editor";
  readonly scope: "tool_image_inpaint";
  readonly public_catalog_version: typeof OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION;
  readonly settings_inventory_version: typeof OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION;
  readonly source_binding: Readonly<{
    selected_public_catalog_fetched_at: string;
    selected_public_source_hashes: Readonly<DiscoverySourceHashes>;
    model_identity: Readonly<{ id: OwnerSeedreamImageVariant; upstream_id: OwnerSeedreamImageVariant; ai_name: "seedream"; active: true; default: boolean }>;
    settings_inventory: Readonly<{ schema_version: "2.1.0"; public_catalog_version: typeof OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION; build_id: typeof BUILD_ID; runtime_usable: false; family_form_id: "seedream"; editor_form: typeof EDITOR_FORM }>;
    source_artifacts: typeof SOURCE_ARTIFACTS;
    source_confidence: "HASH_PINNED_STATIC_SOURCE_NOT_RENDERED_UI";
  }>;
  readonly input_policy: Readonly<{
    accepted_file_types: readonly string[];
    source_ui_max_file_bytes: 10_485_760 | 31_457_280;
    source_ui_limit_is_provider_limit: false;
    local_parser_max_bytes: 33_554_432;
    local_parser_policy: "BOUNDED_CONTAINER_INSPECTION_ONLY_NOT_SOURCE_OR_PROVIDER_LIMIT";
    max_file_count: 1;
    destination: "uploaded";
    check_duplicates: true;
    model_type_source: "EXPLICIT_UNDERLYING_VARIANT";
    min_image_aspect_ratio: number | null;
    max_image_aspect_ratio: number | null;
    side_limits: "NOT_SPECIFIED_BY_EDITOR_SOURCE";
    metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  }>;
  readonly effective_defaults: "NOT_CHECKED";
  readonly runtime_usable: false;
  readonly runtime_activation: false;
  readonly generation_allowed: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_schema_hash: string;
}

export class OwnerSeedreamEditorOriginalUploadSourceProfileError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH") {
    super("The Seedream Editor original-upload source profile could not be verified.");
    this.name = "OwnerSeedreamEditorOriginalUploadSourceProfileError";
  }
}

/** Binds one Editor variant to the explicitly paired c5/62bc archives; no global selector or runtime state is consulted. */
export function getOwnerSeedreamEditorOriginalUploadSourceProfile(
  variantInput: unknown,
  catalogInput: OwnerSeedreamEditorOriginalUploadCatalogPort,
  catalogVersionInput: unknown,
  settingsInventoryInput: MaplessSettingsInventory,
  settingsVersionInput: unknown
): Readonly<OwnerSeedreamEditorOriginalUploadSourceProfile> {
  if (!isVariant(variantInput)) fail("INVALID_REQUEST");
  if (catalogVersionInput !== OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION || settingsVersionInput !== OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION) fail("PROFILE_BINDING_MISMATCH");
  const catalog = snapshotCatalog(catalogInput);
  const settings = snapshotSettings(settingsInventoryInput, catalog.fetchedAt);
  const variant = variantInput;
  const model = snapshotModel(getModel(catalog, variant), variant, catalog.fetchedAt);
  const settingsRow = settings.models.find((entry) => entry.model_id === variant);
  const expected = MODEL_SETTINGS[variant];
  if (!settingsRow || settingsRow.ai_name !== "seedream" || settingsRow.active !== true || settingsRow.default !== model.default ||
      settingsRow.form_id !== "seedream" || settingsRow.form_binding_status !== "STRUCTURAL_MATCH" ||
      settingsRow.settings_status !== "PUBLIC_SETTINGS_KNOWN" || !sameJson(settingsRow.settings, expected) ||
      !sameJson(model.settings, expected)) fail("PROFILE_BINDING_MISMATCH");

  const sourceBinding = deepFreeze({
    selected_public_catalog_fetched_at: catalog.fetchedAt,
    selected_public_source_hashes: catalog.sourceHashes,
    model_identity: { id: variant, upstream_id: variant, ai_name: "seedream" as const, active: true as const, default: model.default },
    settings_inventory: {
      schema_version: "2.1.0" as const, public_catalog_version: OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION,
      build_id: BUILD_ID, runtime_usable: false as const, family_form_id: "seedream" as const, editor_form: EDITOR_FORM
    },
    source_artifacts: SOURCE_ARTIFACTS,
    source_confidence: "HASH_PINNED_STATIC_SOURCE_NOT_RENDERED_UI" as const
  });
  const base = deepFreeze({
    profile_id: "seedream-editor-original-upload-source-profile-v1" as const,
    variant, model_id: variant, model_type: variant,
    navigation_id: "seedream-editor" as const, family_ai_name: "seedream" as const, form_ai_name: "seedream-editor" as const,
    scope: "tool_image_inpaint" as const,
    public_catalog_version: OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION,
    settings_inventory_version: OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION,
    source_binding: sourceBinding,
    input_policy: {
      accepted_file_types: [...expected.accepted_file_types as readonly string[]],
      source_ui_max_file_bytes: expected.max_file_size as 10_485_760 | 31_457_280,
      source_ui_limit_is_provider_limit: false as const,
      local_parser_max_bytes: 32 * 1024 * 1024,
      local_parser_policy: "BOUNDED_CONTAINER_INSPECTION_ONLY_NOT_SOURCE_OR_PROVIDER_LIMIT" as const,
      max_file_count: 1 as const, destination: "uploaded" as const, check_duplicates: true as const,
      model_type_source: "EXPLICIT_UNDERLYING_VARIANT" as const,
      min_image_aspect_ratio: variant === "seedream-5.0-flash" || variant === "seedream-5.0-pro" ? 1 / 16 : null,
      max_image_aspect_ratio: variant === "seedream-5.0-flash" || variant === "seedream-5.0-pro" ? 16 : null,
      side_limits: "NOT_SPECIFIED_BY_EDITOR_SOURCE" as const,
      metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" as const
    },
    effective_defaults: "NOT_CHECKED" as const,
    runtime_usable: false as const, runtime_activation: false as const, generation_allowed: false as const,
    dispatch_allowed: false as const, backend_acceptance: "UNPROVEN" as const
  });
  return deepFreeze({ ...base, profile_schema_hash: schemaHash(base) }) as Readonly<OwnerSeedreamEditorOriginalUploadSourceProfile>;
}

interface CatalogSnapshot { readonly receiver: object; readonly getModel: (...args: never[]) => unknown; readonly fetchedAt: string; readonly sourceHashes: Readonly<DiscoverySourceHashes> }
function snapshotCatalog(input: unknown): CatalogSnapshot {
  if (!input || typeof input !== "object" || isProxy(input)) fail("INVALID_REQUEST");
  const getModel = readProperty(input, "getModel"), fetchedAt = readProperty(input, "fetched_at"), catalogKind = readProperty(input, "catalog_kind");
  const runtimeUsable = readProperty(input, "runtime_usable"), hashes = snapshotHashes(readProperty(input, "source_hashes"));
  const metadata = readRecord(readProperty(input, "catalog_metadata"));
  const metadataHashes = snapshotHashes(metadata.source_hashes);
  if (typeof getModel !== "function" || isProxy(getModel) || fetchedAt !== PUBLIC_FETCHED_AT || catalogKind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" ||
      runtimeUsable !== false || !sameJson(hashes, PUBLIC_SOURCE_HASHES) || metadata.fetched_at !== PUBLIC_FETCHED_AT ||
      metadata.public_settings_coverage !== "ALLOWLISTED_PUBLIC_API_FIELDS" || !sameJson(metadataHashes, PUBLIC_SOURCE_HASHES)) fail("PROFILE_BINDING_MISMATCH");
  return Object.freeze({ receiver: input, getModel: getModel as (...args: never[]) => unknown, fetchedAt, sourceHashes: hashes });
}
function snapshotSettings(input: unknown, fetchedAt: string) {
  const fields = readRecord(input), build = readRecord(fields.build), publicCatalog = readRecord(fields.public_catalog), framework = readRecord(fields.framework), helper = readRecord(framework.settings3);
  if (fields.schema_version !== "2.1.0" || fields.catalog_kind !== "MAPLESS_FRONTEND_SETTINGS_INVENTORY" || fields.evidence_level !== "STATIC_PUBLIC_API_AND_COMPILED_JS" ||
      fields.runtime_usable !== false || fields.generated_at !== "2026-10-11T12:38:53.131Z" || build.id !== BUILD_ID ||
      build.base_url !== "https://syntx.ai/assets/1791467421/" || publicCatalog.version !== OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION ||
      publicCatalog.fetched_at !== fetchedAt || publicCatalog.models_sha256 !== PUBLIC_SOURCE_HASHES.models ||
      fields.app_sha256 !== SOURCE_ARTIFACTS.app_store_and_upload.sha256 || helper.url !== "https://syntx.ai/assets/1791467421/settings3.js" ||
      helper.bytes !== SOURCE_ARTIFACTS.settings_helper.bytes || helper.sha256 !== SOURCE_ARTIFACTS.settings_helper.sha256) fail("PROFILE_BINDING_MISMATCH");
  const forms = snapshotArray(fields.forms).map(readRecord);
  const editorForms = forms.filter((entry) => entry.form_id === "seedream-editor");
  if (editorForms.length !== 1 || editorForms[0]!.module_name !== EDITOR_FORM.module_name) fail("PROFILE_BINDING_MISMATCH");
  const javascript = readRecord(editorForms[0]!.javascript);
  if (javascript.url !== "https://syntx.ai/assets/1791467421/seedream-editor.js" || javascript.bytes !== EDITOR_FORM.bytes ||
      javascript.sha256 !== EDITOR_FORM.sha256 || javascript.parse_diagnostics !== 0 ||
      !sameJson(snapshotArray(javascript.model_value_settings_keys), EDITOR_FORM.model_value_settings_keys) || Object.keys(readRecord(javascript.static_setting_defaults)).length !== 0) fail("PROFILE_BINDING_MISMATCH");
  const models = snapshotArray(fields.models).map((row) => {
    const entry = readRecord(row);
    if (typeof entry.active !== "boolean" || typeof entry.default !== "boolean") fail("PROFILE_BINDING_MISMATCH");
    return Object.freeze({ model_id: requireString(entry.model_id), ai_name: requireString(entry.ai_name), active: entry.active, default: entry.default,
      form_id: entry.form_id === null ? null : requireString(entry.form_id), form_binding_status: requireString(entry.form_binding_status),
      settings_status: requireString(entry.settings_status), settings: entry.settings === null ? null : readRecord(entry.settings) });
  });
  for (const variant of OWNER_SEEDREAM_IMAGE_VARIANTS) {
    const matches = models.filter((entry) => entry.model_id === variant);
    if (matches.length !== 1) fail("PROFILE_BINDING_MISMATCH");
  }
  return { models: Object.freeze(models) };
}
function getModel(catalog: CatalogSnapshot, variant: OwnerSeedreamImageVariant): unknown {
  try { return Reflect.apply(catalog.getModel, catalog.receiver, [variant]); }
  catch { return fail("PROFILE_BINDING_MISMATCH"); }
}
function snapshotModel(input: unknown, variant: OwnerSeedreamImageVariant, fetchedAt: string) {
  const fields = readRecord(input), operations = snapshotArray(fields.operations).map(readRecord), operation = operations[0];
  if (fields.id !== variant || fields.upstream_id !== variant || fields.ai_name !== "seedream" || fields.active !== true ||
      fields.default !== DEFAULTS[variant] || fields.fetched_at !== fetchedAt || fields.scope !== "image" ||
      fields.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || fields.runtime_usable !== false ||
      !sameJson(snapshotHashes(fields.source_hashes), PUBLIC_SOURCE_HASHES) || !sameJson(snapshotArray(fields.modalities), ["image"]) ||
      operations.length !== 1 || operation!.id !== "generate-image" || operation!.output_modality !== "image" || operation!.derivation !== "PUBLIC_AI_SCOPE") fail("PROFILE_BINDING_MISMATCH");
  const settings = readRecord(fields.settings);
  if (!sameJson(settings, MODEL_SETTINGS[variant])) fail("PROFILE_BINDING_MISMATCH");
  return deepFreeze({ id: variant, upstream_id: variant, ai_name: "seedream" as const, active: true as const, default: DEFAULTS[variant], settings });
}
function snapshotHashes(input: unknown): Readonly<DiscoverySourceHashes> {
  const value = readRecord(input);
  if (!sameJson(value, PUBLIC_SOURCE_HASHES)) fail("PROFILE_BINDING_MISMATCH");
  return deepFreeze({ ai: requireString(value.ai), llm_models: requireString(value.llm_models), models: requireString(value.models) });
}
function readProperty(value: object, key: string): unknown {
  let current: object | null = value;
  try {
    while (current) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) { if (!("value" in descriptor)) fail("PROFILE_BINDING_MISMATCH"); return descriptor.value; }
      current = Object.getPrototypeOf(current) as object | null;
    }
  } catch { fail("PROFILE_BINDING_MISMATCH"); }
  return fail("PROFILE_BINDING_MISMATCH");
}
function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value)) fail("PROFILE_BINDING_MISMATCH");
  let prototype: object | null, descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); } catch { return fail("PROFILE_BINDING_MISMATCH"); }
  if (prototype !== Object.prototype && prototype !== null) fail("PROFILE_BINDING_MISMATCH");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !("value" in descriptors[key]!)) fail("PROFILE_BINDING_MISMATCH");
    result[key] = descriptors[key]!.value;
  }
  return result;
}
function snapshotArray(value: unknown): readonly unknown[] {
  if (isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail("PROFILE_BINDING_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || !Object.hasOwn(descriptors, "length") || keys.some((key) => typeof key !== "string" ||
      (key !== "length" && (!/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length || !("value" in descriptors[key]!))))) fail("PROFILE_BINDING_MISMATCH");
  return Object.freeze(Array.from({ length: value.length }, (_, index) => {
    const descriptor = descriptors[String(index)]; if (!descriptor || !("value" in descriptor)) return fail("PROFILE_BINDING_MISMATCH");
    return descriptor.value;
  }));
}
function requireString(value: unknown): string { if (typeof value !== "string") fail("PROFILE_BINDING_MISMATCH"); return value; }
function sameJson(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
    return value;
  };
  try { return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)); } catch { return false; }
}
function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (descriptor && "value" in descriptor) deepFreeze(descriptor.value); }
  return Object.freeze(value) as DeepReadonly<T>;
}
function isVariant(value: unknown): value is OwnerSeedreamImageVariant { return typeof value === "string" && (OWNER_SEEDREAM_IMAGE_VARIANTS as readonly string[]).includes(value); }
function fail(code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH"): never { throw new OwnerSeedreamEditorOriginalUploadSourceProfileError(code); }
