import { isProxy } from "node:util/types";
import { schemaHash } from "../domain/generation-contract.js";
import type { DiscoveryCatalogRepository, DiscoverySourceHashes } from "../catalog/discovery-catalog.js";
import type { MaplessSettingsInventory } from "../catalog/mapless-settings-inventory.js";

export const OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION =
  "sha256-c5c10b9b0bffdc4b75dab3363de10c2c2856f1130a559eb9e8a21a1493bf067c.json" as const;
export const OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION =
  "sha256-62bcf08172eb75011055d9ae04c772362b72337646ee2e460944d7fcb2301bcf.json" as const;
export const OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS = Object.freeze([
  "banana", "banana2", "banana3", "banana3_light"
] as const);

export type OwnerBananaInpaintOriginalUploadVariant = typeof OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS[number];

const PUBLIC_FETCHED_AT = "2026-10-11T12:04:10.638Z";
const PUBLIC_SOURCE_HASHES = Object.freeze({
  ai: "sha256:b99bb90d170acb5a3a06c5be0cbc51d2ab0d17902bee21303a44b32c5fcaef39",
  llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
  models: "sha256:16735c498e3743b67fb384ccee44de34ffd3ac8debaeb46033a5723938191a58"
} as const);
const SETTINGS_MODELS_HASH = "sha256:16735c498e3743b67fb384ccee44de34ffd3ac8debaeb46033a5723938191a58";
const BUILD_ID = "1791467421";
const CATALOG_DEFAULT_FLAGS = Object.freeze({ banana: false, banana2: false, banana3: true, banana3_light: true } as const);
const INPAINT_FORM = Object.freeze({
  form_id: "banana-inpaint",
  module_name: "banana-inpaint.js",
  bytes: 8_715,
  sha256: "sha256:4a22ce6da71d2b39c97614cdfcde3d38f201dad3015f2a59f018d8b7c8146172",
  parse_diagnostics: 0,
  model_value_settings_keys: Object.freeze(["image_size", "model_type"] as const),
  static_setting_defaults: Object.freeze({})
} as const);
const SOURCE_ARTIFACTS = Object.freeze({
  inpaint_form: Object.freeze({
    module: "banana-inpaint.js", bytes: 8_715,
    sha256: "sha256:4a22ce6da71d2b39c97614cdfcde3d38f201dad3015f2a59f018d8b7c8146172"
  }),
  original_upload_caller: Object.freeze({
    module: "useImageEditorTool.js", bytes: 12_652,
    sha256: "sha256:6ede93da546e372b8a550a00d370a79a65b0e6841942c74317ad7814097ceebe"
  }),
  settings_helper: Object.freeze({
    module: "settings3.js", bytes: 4_123,
    sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe"
  }),
  app_upload_store: Object.freeze({
    module: "app.js", bytes: 2_445_534,
    sha256: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf"
  })
} as const);

export interface OwnerBananaInpaintOriginalUploadCatalogPort extends Pick<DiscoveryCatalogRepository,
  "getModel" | "fetched_at" | "source_hashes" | "catalog_metadata" | "catalog_kind" | "runtime_usable"> {}

export interface OwnerBananaInpaintOriginalUploadSourceProfile {
  readonly profile_id: "banana-inpaint-original-upload-source-profile-v1";
  readonly variant: OwnerBananaInpaintOriginalUploadVariant;
  readonly model_id: OwnerBananaInpaintOriginalUploadVariant;
  readonly model_type: OwnerBananaInpaintOriginalUploadVariant;
  readonly family_ai_name: "banana";
  readonly form_ai_name: "banana_inpaint";
  readonly form_id: "banana-inpaint";
  readonly catalog_default_flag: boolean;
  readonly catalog_default_confidence: "PUBLIC_CATALOG_METADATA_ONLY_NOT_RUNTIME_SELECTION";
  readonly public_catalog_version: typeof OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION;
  readonly settings_inventory_version: typeof OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION;
  readonly source_binding: Readonly<{
    selected_public_catalog_fetched_at: string;
    selected_public_source_hashes: Readonly<DiscoverySourceHashes>;
    model_identity: Readonly<{
      id: OwnerBananaInpaintOriginalUploadVariant;
      upstream_id: OwnerBananaInpaintOriginalUploadVariant;
      ai_name: "banana";
      active: true;
      default: boolean;
    }>;
    settings_inventory: Readonly<{
      schema_version: "2.1.0";
      public_catalog_version: typeof OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION;
      build_id: typeof BUILD_ID;
      runtime_usable: false;
      family_model_form: Readonly<{
        form_id: "banana";
        form_binding_status: "STRUCTURAL_MATCH";
        settings_status: "PUBLIC_SETTINGS_KNOWN";
      }>;
      inpaint_form: typeof INPAINT_FORM;
    }>;
    source_artifacts: typeof SOURCE_ARTIFACTS;
    source_confidence: "HASH_PINNED_STATIC_SOURCE_NOT_RENDERED_UI";
  }>;
  readonly input_policy: Readonly<{
    accepted_file_types: readonly ["image/jpeg", "image/png"];
    max_file_bytes: 52_428_800;
    max_file_count: 1;
    size_scope: "SOURCE_UI_FILE_INPUT_LIMIT_NOT_PROVIDER_LIMIT";
    destination: "hidden";
    check_duplicates: true;
    model_type_source: "EXPLICIT_UNDERLYING_BANANA_VARIANT";
  }>;
  readonly runtime_usable: false;
  readonly runtime_activation: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_schema_hash: string;
}

export type OwnerBananaInpaintOriginalUploadSourceProfileErrorCode = "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH";

export class OwnerBananaInpaintOriginalUploadSourceProfileError extends Error {
  constructor(readonly code: OwnerBananaInpaintOriginalUploadSourceProfileErrorCode) {
    super("The Banana Inpaint original-upload source profile could not be verified.");
    this.name = "OwnerBananaInpaintOriginalUploadSourceProfileError";
  }
}

/** Builds a source-only profile from the explicitly paired c5/62bc archives; it never changes the selected catalog. */
export function getOwnerBananaInpaintOriginalUploadSourceProfile(
  variantInput: unknown,
  catalogInput: OwnerBananaInpaintOriginalUploadCatalogPort,
  catalogVersionInput: unknown,
  settingsInventoryInput: MaplessSettingsInventory,
  settingsVersionInput: unknown
): Readonly<OwnerBananaInpaintOriginalUploadSourceProfile> {
  if (!isVariant(variantInput)) fail("INVALID_REQUEST");
  if (catalogVersionInput !== OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION ||
      settingsVersionInput !== OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION) fail("PROFILE_BINDING_MISMATCH");

  const catalog = snapshotCatalog(catalogInput);
  const settings = snapshotSettingsInventory(settingsInventoryInput, catalog.fetchedAt);
  const variant = variantInput;
  const model = snapshotModel(getModel(catalog, variant), variant, catalog.fetchedAt);
  const familyRow = settings.models.find((entry) => entry.model_id === variant);
  if (!familyRow || familyRow.ai_name !== "banana" || familyRow.active !== true || familyRow.form_id !== "banana" ||
      familyRow.default !== model.default ||
      familyRow.form_binding_status !== "STRUCTURAL_MATCH" || familyRow.settings_status !== "PUBLIC_SETTINGS_KNOWN" ||
      familyRow.settings === null) fail("PROFILE_BINDING_MISMATCH");

  const settingsInventory = deepFreeze({
    schema_version: "2.1.0" as const,
    public_catalog_version: OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
    build_id: BUILD_ID,
    runtime_usable: false as const,
    family_model_form: {
      form_id: "banana" as const,
      form_binding_status: "STRUCTURAL_MATCH" as const,
      settings_status: "PUBLIC_SETTINGS_KNOWN" as const
    },
    inpaint_form: INPAINT_FORM
  });
  const sourceBinding = deepFreeze({
    selected_public_catalog_fetched_at: catalog.fetchedAt,
    selected_public_source_hashes: catalog.sourceHashes,
    model_identity: model,
    settings_inventory: settingsInventory,
    source_artifacts: SOURCE_ARTIFACTS,
    source_confidence: "HASH_PINNED_STATIC_SOURCE_NOT_RENDERED_UI" as const
  });
  const base = deepFreeze({
    profile_id: "banana-inpaint-original-upload-source-profile-v1" as const,
    variant,
    model_id: variant,
    model_type: variant,
    family_ai_name: "banana" as const,
    form_ai_name: "banana_inpaint" as const,
    form_id: "banana-inpaint" as const,
    catalog_default_flag: model.default,
    catalog_default_confidence: "PUBLIC_CATALOG_METADATA_ONLY_NOT_RUNTIME_SELECTION" as const,
    public_catalog_version: OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
    settings_inventory_version: OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
    source_binding: sourceBinding,
    input_policy: {
      accepted_file_types: ["image/jpeg", "image/png"] as const,
      max_file_bytes: 52_428_800 as const,
      max_file_count: 1 as const,
      size_scope: "SOURCE_UI_FILE_INPUT_LIMIT_NOT_PROVIDER_LIMIT" as const,
      destination: "hidden" as const,
      check_duplicates: true as const,
      model_type_source: "EXPLICIT_UNDERLYING_BANANA_VARIANT" as const
    },
    runtime_usable: false as const,
    runtime_activation: false as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
  return deepFreeze({ ...base, profile_schema_hash: schemaHash(base) }) as Readonly<OwnerBananaInpaintOriginalUploadSourceProfile>;
}

interface CatalogSnapshot {
  readonly receiver: object;
  readonly getModel: (...args: never[]) => unknown;
  readonly fetchedAt: string;
  readonly sourceHashes: Readonly<DiscoverySourceHashes>;
}

interface FamilyModelSettingsRow {
  readonly model_id: string;
  readonly ai_name: string;
  readonly active: boolean;
  readonly default: boolean;
  readonly form_id: string | null;
  readonly form_binding_status: string;
  readonly settings_status: string;
  readonly settings: Readonly<Record<string, unknown>> | null;
}

interface SettingsSnapshot {
  readonly models: readonly FamilyModelSettingsRow[];
}

function snapshotCatalog(input: unknown): CatalogSnapshot {
  if (!input || typeof input !== "object" || isProxy(input)) fail("INVALID_REQUEST");
  const getModel = readMethod(input, "getModel");
  const fetchedAt = readProperty(input, "fetched_at");
  const catalogKind = readProperty(input, "catalog_kind");
  const runtimeUsable = readProperty(input, "runtime_usable");
  const sourceHashes = snapshotSourceHashes(readProperty(input, "source_hashes"));
  const metadata = readDataRecord(readProperty(input, "catalog_metadata"));
  const metadataHashes = snapshotSourceHashes(metadata.source_hashes);
  const hashesMatch = sameJson(sourceHashes, PUBLIC_SOURCE_HASHES);
  if (typeof getModel !== "function" || isProxy(getModel) || fetchedAt !== PUBLIC_FETCHED_AT ||
      catalogKind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || runtimeUsable !== false || !hashesMatch ||
      metadata.fetched_at !== PUBLIC_FETCHED_AT || metadata.public_settings_coverage !== "ALLOWLISTED_PUBLIC_API_FIELDS" ||
      !sameJson(metadataHashes, PUBLIC_SOURCE_HASHES)) fail("PROFILE_BINDING_MISMATCH");
  return Object.freeze({ receiver: input, getModel: getModel as (...args: never[]) => unknown, fetchedAt, sourceHashes });
}

function snapshotSettingsInventory(input: unknown, expectedFetchedAt: string): SettingsSnapshot & { readonly appSha256: string } {
  const fields = readDataRecord(input);
  const build = readDataRecord(fields.build);
  const publicCatalog = readDataRecord(fields.public_catalog);
  const framework = readDataRecord(fields.framework);
  const settings3 = readDataRecord(framework.settings3);
  const appSha256 = fields.app_sha256;
  if (fields.schema_version !== "2.1.0" || fields.catalog_kind !== "MAPLESS_FRONTEND_SETTINGS_INVENTORY" ||
      fields.evidence_level !== "STATIC_PUBLIC_API_AND_COMPILED_JS" || fields.runtime_usable !== false ||
      fields.generated_at !== "2026-10-11T12:38:53.131Z" || build.id !== BUILD_ID ||
      build.base_url !== "https://syntx.ai/assets/1791467421/" ||
      publicCatalog.version !== OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION || publicCatalog.fetched_at !== expectedFetchedAt ||
      publicCatalog.models_sha256 !== SETTINGS_MODELS_HASH || appSha256 !== SOURCE_ARTIFACTS.app_upload_store.sha256 ||
      settings3.url !== "https://syntx.ai/assets/1791467421/settings3.js" || settings3.bytes !== 4_123 ||
      settings3.sha256 !== SOURCE_ARTIFACTS.settings_helper.sha256) fail("PROFILE_BINDING_MISMATCH");

  const forms = snapshotArray(fields.forms).map((entry) => readDataRecord(entry));
  const inpaint = forms.filter((entry) => entry.form_id === "banana-inpaint");
  if (inpaint.length !== 1) fail("PROFILE_BINDING_MISMATCH");
  const javascript = readDataRecord(inpaint[0]!.javascript);
  const keys = snapshotStringArray(javascript.model_value_settings_keys);
  const staticDefaults = readDataRecord(javascript.static_setting_defaults);
  if (inpaint[0]!.module_name !== INPAINT_FORM.module_name || javascript.url !== "https://syntx.ai/assets/1791467421/banana-inpaint.js" ||
      javascript.bytes !== INPAINT_FORM.bytes || javascript.sha256 !== INPAINT_FORM.sha256 ||
      javascript.parse_diagnostics !== 0 || !sameJson(keys, INPAINT_FORM.model_value_settings_keys) ||
      Object.keys(staticDefaults).length !== 0) fail("PROFILE_BINDING_MISMATCH");

  const modelRows = snapshotArray(fields.models).map((entry) => {
    const row = readDataRecord(entry);
    if (typeof row.active !== "boolean" || typeof row.default !== "boolean") fail("PROFILE_BINDING_MISMATCH");
    return Object.freeze({
      model_id: requireString(row.model_id),
      ai_name: requireString(row.ai_name),
      active: row.active,
      default: row.default,
      form_id: row.form_id === null ? null : requireString(row.form_id),
      form_binding_status: requireString(row.form_binding_status),
      settings_status: requireString(row.settings_status),
      settings: row.settings === null ? null : readDataRecord(row.settings)
    });
  });
  return Object.freeze({ models: Object.freeze(modelRows), appSha256 });
}

function getModel(catalog: CatalogSnapshot, variant: OwnerBananaInpaintOriginalUploadVariant): unknown {
  try { return Reflect.apply(catalog.getModel, catalog.receiver, [variant]); }
  catch { fail("PROFILE_BINDING_MISMATCH"); }
}

function snapshotModel(value: unknown, variant: OwnerBananaInpaintOriginalUploadVariant, fetchedAt: string) {
  const fields = readDataRecord(value);
  const hashes = snapshotSourceHashes(fields.source_hashes);
  if (!sameJson(hashes, PUBLIC_SOURCE_HASHES) || fields.id !== variant || fields.upstream_id !== variant ||
      fields.ai_name !== "banana" || fields.active !== true || fields.fetched_at !== fetchedAt ||
      fields.scope !== "image" || fields.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || fields.runtime_usable !== false ||
      fields.default !== CATALOG_DEFAULT_FLAGS[variant]) fail("PROFILE_BINDING_MISMATCH");
  return deepFreeze({ id: variant, upstream_id: variant, ai_name: "banana" as const, active: true as const, default: fields.default });
}

function snapshotSourceHashes(value: unknown): Readonly<DiscoverySourceHashes> {
  const fields = readDataRecord(value);
  if (!sameJson(fields, PUBLIC_SOURCE_HASHES)) fail("PROFILE_BINDING_MISMATCH");
  return deepFreeze({
    ai: requireString(fields.ai),
    llm_models: requireString(fields.llm_models),
    models: requireString(fields.models)
  });
}

function snapshotArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) fail("PROFILE_BINDING_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || !Object.hasOwn(descriptors, "length") ||
      keys.some((key) => typeof key !== "string" || (key !== "length" && (!/^(?:0|[1-9]\d*)$/u.test(key) ||
        Number(key) >= value.length || !("value" in descriptors[key]!))))) fail("PROFILE_BINDING_MISMATCH");
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor)) fail("PROFILE_BINDING_MISMATCH");
    result.push(descriptor.value);
  }
  return result;
}

function snapshotStringArray(value: unknown): readonly string[] {
  return Object.freeze(snapshotArray(value).map((entry) => requireString(entry)));
}

function readDataRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) fail("PROFILE_BINDING_MISMATCH");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("PROFILE_BINDING_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || !("value" in descriptors[key]!))) fail("PROFILE_BINDING_MISMATCH");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function readProperty(value: object, key: string): unknown {
  let current: object | null = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) {
      if (!("value" in descriptor)) fail("PROFILE_BINDING_MISMATCH");
      return descriptor.value;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  fail("PROFILE_BINDING_MISMATCH");
}

function readMethod(value: object, key: string): unknown {
  try { return readProperty(value, key); }
  catch { fail("PROFILE_BINDING_MISMATCH"); }
}

function requireString(value: unknown): string {
  if (typeof value !== "string") fail("PROFILE_BINDING_MISMATCH");
  return value;
}

function sameJson(left: unknown, right: unknown): boolean {
  try { return JSON.stringify(left) === JSON.stringify(right); }
  catch { return false; }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && "value" in descriptor) deepFreeze(descriptor.value);
    }
    Object.freeze(value);
  }
  return value;
}

function isVariant(value: unknown): value is OwnerBananaInpaintOriginalUploadVariant {
  return typeof value === "string" &&
    (OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS as readonly string[]).includes(value);
}

function fail(code: OwnerBananaInpaintOriginalUploadSourceProfileErrorCode): never {
  throw new OwnerBananaInpaintOriginalUploadSourceProfileError(code);
}
