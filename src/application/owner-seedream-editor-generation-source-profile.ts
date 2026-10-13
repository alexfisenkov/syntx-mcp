import { isProxy } from "node:util/types";
import { schemaHash } from "../domain/generation-contract.js";
import { OWNER_SEEDREAM_IMAGE_VARIANTS, type OwnerSeedreamImageVariant } from "./owner-seedream-image-parameters.js";
import {
  OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION,
  OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION,
  type OwnerSeedreamEditorOriginalUploadSourceProfile
} from "./owner-seedream-editor-original-upload-source-profile.js";

const SOURCE_PINS = Object.freeze({
  home_sha256: "sha256:a7a68e6ae96547333037962ab9bb3a40ddf7aeb912223d65a9962ab5ce6982da",
  form_sha256: "sha256:2026192d5b0f086446873996ad20cf4691f665d4019621eef3241887ffb3ad7c",
  parent_sha256: "sha256:87509acda1040d79927edc30d8ddd18d503a6e7ce9387d5d0a059b1eb5028e14",
  generic_sender_sha256: "sha256:de8396adca45a5ba79c9c52cdfa91b23f45285645bed5df120c0f337a192deb2",
  constants_sha256: "sha256:636b6f8e15c847f346395027bc83dc3fddf22199d8ab07a32f98d5f0985ccecf",
  settings_helper_sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe",
  cost_query_sha256: "sha256:c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9",
  app_upload_sha256: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf",
  typed_url_serializer_sha256: "sha256:8a1c0d06d68b82d97ac6a58ed7caf8d2e759d31cc10f0b1ceb26d676fa664706"
} as const);

const COST_KEYS = Object.freeze({
  "seedream-4": Object.freeze([] as string[]),
  "seedream-4.5": Object.freeze([] as string[]),
  "seedream-5": Object.freeze([] as string[]),
  "seedream-5.0-flash": Object.freeze([] as string[]),
  "seedream-5.0-pro": Object.freeze(["batch_size", "resolution"])
} satisfies Readonly<Record<OwnerSeedreamImageVariant, readonly string[]>>);
const ACCEPTED_MIMES = Object.freeze({
  "seedream-4": Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"]),
  "seedream-4.5": Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"]),
  "seedream-5": Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"]),
  "seedream-5.0-flash": Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/heic", "image/heif", "image/tiff", "image/gif", "image/webp"]),
  "seedream-5.0-pro": Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/webp", "image/gif", "image/tiff", "image/heic", "image/heif"])
} satisfies Readonly<Record<OwnerSeedreamImageVariant, readonly string[]>>);
const SOURCE_UI_CAPS = Object.freeze({
  "seedream-4": 10_485_760, "seedream-4.5": 10_485_760, "seedream-5": 10_485_760,
  "seedream-5.0-flash": 31_457_280, "seedream-5.0-pro": 31_457_280
} satisfies Readonly<Record<OwnerSeedreamImageVariant, number>>);
const DEFAULTS = Object.freeze({
  "seedream-4": false, "seedream-4.5": false, "seedream-5": true,
  "seedream-5.0-flash": false, "seedream-5.0-pro": false
} satisfies Readonly<Record<OwnerSeedreamImageVariant, boolean>>);

type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export interface OwnerSeedreamEditorGenerationSourceProfile {
  readonly profile_id: "seedream-editor-generation-source-profile-v1";
  readonly variant: OwnerSeedreamImageVariant;
  readonly model_id: OwnerSeedreamImageVariant;
  readonly family_ai_name: "seedream";
  readonly navigation_id: "seedream-editor";
  readonly scope: "tool_image_inpaint";
  readonly source_binding: Readonly<{
    public_catalog_version: typeof OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION;
    settings_inventory_version: typeof OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION;
    original_upload_profile_schema_hash: string;
    home_sha256: typeof SOURCE_PINS.home_sha256;
    form_sha256: typeof SOURCE_PINS.form_sha256;
    parent_sha256: typeof SOURCE_PINS.parent_sha256;
    generic_sender_sha256: typeof SOURCE_PINS.generic_sender_sha256;
    constants_sha256: typeof SOURCE_PINS.constants_sha256;
    settings_helper_sha256: typeof SOURCE_PINS.settings_helper_sha256;
    cost_query_sha256: typeof SOURCE_PINS.cost_query_sha256;
    app_upload_sha256: typeof SOURCE_PINS.app_upload_sha256;
    typed_url_serializer_sha256: typeof SOURCE_PINS.typed_url_serializer_sha256;
  }>;
  readonly protocol: Readonly<{
    method: "POST";
    route: "design/generate";
    query: Readonly<{ ai_name: "seedream" }>;
    body_fields: readonly ["chat_uuid", "prompt", "settings"];
    settings: Readonly<{
      location: "nested_only";
      keys: readonly ["n", "stream", "model_type", "aspect_ratio", "resolution", "file_urls"];
      confidence: "FIXED_CLIENT_JSON_PROTOCOL_CHOICE_NOT_CACHE_OR_OUTPUT_GUARANTEE";
      n: 1;
      stream: false;
      model_type: "EXPLICIT_UNDERLYING_VARIANT";
      file_urls: "ORIGINAL_THEN_OPTIONAL_DRAWING_IMAGE";
    }>;
    custom_payload_branch: "ABSENT_OR_NULL_USES_NORMAL_SETTINGS";
    file_roles: readonly ["original_image", "optional_drawing_image"];
    original: Readonly<{ max_count: 1; role: "ORIGINAL_IMAGE"; source_profile: "947" }>;
    drawing: Readonly<{ max_count: 1; role: "IMAGE_EXTRA_NOT_MASK"; ownership: "UNBOUND" }>;
    mask: "NONE";
    duplicate_reference_policy: "TYPED_URL_STABLE_FIRST";
    output_count: "UNPROVEN";
  }>;
  readonly cost_projection: Readonly<{
    declared_keys_by_variant: Readonly<Record<OwnerSeedreamImageVariant, readonly string[]>>;
    pro_batch_size_input: "can_reset ? 2 : 1";
    pro_batch_size_confidence: "ROOT940_COST_UI_OVERRIDE_NOT_OUTPUT_COUNT";
    generation_wire: "UNPROVEN";
    quote_amount: "UNPROVEN";
    billing_cap: "UNPROVEN";
    generation_output_count: "UNPROVEN";
  }>;
  readonly effective_defaults: "UNPROVEN";
  readonly runtime_usable: false;
  readonly generation_allowed: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_schema_hash: string;
}

export class OwnerSeedreamEditorGenerationSourceProfileError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH") {
    super("The Seedream Editor generation source profile could not be verified.");
    this.name = "OwnerSeedreamEditorGenerationSourceProfileError";
  }
}

/** Describes the pinned normal Editor request path; it grants no runtime or generation capability. */
export function getOwnerSeedreamEditorGenerationSourceProfile(
  variantInput: unknown,
  originalProfileInput: OwnerSeedreamEditorOriginalUploadSourceProfile
): Readonly<OwnerSeedreamEditorGenerationSourceProfile> {
  if (!isVariant(variantInput)) fail("INVALID_REQUEST");
  const original = validateOriginalProfile(originalProfileInput, variantInput);
  const base = deepFreeze({
    profile_id: "seedream-editor-generation-source-profile-v1" as const,
    variant: variantInput,
    model_id: variantInput,
    family_ai_name: "seedream" as const,
    navigation_id: "seedream-editor" as const,
    scope: "tool_image_inpaint" as const,
    source_binding: {
      public_catalog_version: OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION,
      settings_inventory_version: OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION,
      original_upload_profile_schema_hash: original.profile_schema_hash,
      ...SOURCE_PINS
    },
    protocol: {
      method: "POST" as const,
      route: "design/generate" as const,
      query: { ai_name: "seedream" as const },
      body_fields: ["chat_uuid", "prompt", "settings"] as const,
      settings: {
        location: "nested_only" as const,
        keys: ["n", "stream", "model_type", "aspect_ratio", "resolution", "file_urls"] as const,
        confidence: "FIXED_CLIENT_JSON_PROTOCOL_CHOICE_NOT_CACHE_OR_OUTPUT_GUARANTEE" as const,
        n: 1 as const,
        stream: false as const,
        model_type: "EXPLICIT_UNDERLYING_VARIANT" as const,
        file_urls: "ORIGINAL_THEN_OPTIONAL_DRAWING_IMAGE" as const
      },
      custom_payload_branch: "ABSENT_OR_NULL_USES_NORMAL_SETTINGS" as const,
      file_roles: ["original_image", "optional_drawing_image"] as const,
      original: { max_count: 1 as const, role: "ORIGINAL_IMAGE" as const, source_profile: "947" as const },
      drawing: { max_count: 1 as const, role: "IMAGE_EXTRA_NOT_MASK" as const, ownership: "UNBOUND" as const },
      mask: "NONE" as const,
      duplicate_reference_policy: "TYPED_URL_STABLE_FIRST" as const,
      output_count: "UNPROVEN" as const
    },
    cost_projection: {
      declared_keys_by_variant: COST_KEYS,
      pro_batch_size_input: "can_reset ? 2 : 1" as const,
      pro_batch_size_confidence: "ROOT940_COST_UI_OVERRIDE_NOT_OUTPUT_COUNT" as const,
      generation_wire: "UNPROVEN" as const,
      quote_amount: "UNPROVEN" as const,
      billing_cap: "UNPROVEN" as const,
      generation_output_count: "UNPROVEN" as const
    },
    effective_defaults: "UNPROVEN" as const,
    runtime_usable: false as const,
    generation_allowed: false as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
  return deepFreeze({ ...base, profile_schema_hash: schemaHash(base) }) as Readonly<OwnerSeedreamEditorGenerationSourceProfile>;
}

function validateOriginalProfile(input: unknown, variant: OwnerSeedreamImageVariant): Readonly<OwnerSeedreamEditorOriginalUploadSourceProfile> {
  if (!input || typeof input !== "object" || isProxy(input)) fail("INVALID_REQUEST");
  const snapshot = snapshotFrozenValue(input, 0);
  const profile = readRecord(snapshot);
  if (!hasExactKeys(profile, ["profile_id", "variant", "model_id", "model_type", "navigation_id", "family_ai_name", "form_ai_name", "scope",
    "public_catalog_version", "settings_inventory_version", "source_binding", "input_policy", "effective_defaults", "runtime_usable",
    "runtime_activation", "generation_allowed", "dispatch_allowed", "backend_acceptance", "profile_schema_hash"])) fail("PROFILE_BINDING_MISMATCH");
  const base = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(profile)) if (key !== "profile_schema_hash") base[key] = profile[key];
  if (profile.profile_id !== "seedream-editor-original-upload-source-profile-v1" ||
      profile.variant !== variant || profile.model_id !== variant || profile.model_type !== variant ||
      profile.navigation_id !== "seedream-editor" || profile.family_ai_name !== "seedream" ||
      profile.form_ai_name !== "seedream-editor" || profile.scope !== "tool_image_inpaint" ||
      profile.public_catalog_version !== OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION ||
      profile.settings_inventory_version !== OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION ||
      profile.effective_defaults !== "NOT_CHECKED" || profile.runtime_usable !== false || profile.runtime_activation !== false ||
      profile.generation_allowed !== false || profile.dispatch_allowed !== false || profile.backend_acceptance !== "UNPROVEN" ||
      typeof profile.profile_schema_hash !== "string" || schemaHash(base) !== profile.profile_schema_hash) fail("PROFILE_BINDING_MISMATCH");

  const binding = readRecord(profile.source_binding);
  if (!hasExactKeys(binding, ["selected_public_catalog_fetched_at", "selected_public_source_hashes", "model_identity", "settings_inventory", "source_artifacts", "source_confidence"])) fail("PROFILE_BINDING_MISMATCH");
  const modelIdentity = readRecord(binding.model_identity);
  if (!hasExactKeys(modelIdentity, ["id", "upstream_id", "ai_name", "active", "default"])) fail("PROFILE_BINDING_MISMATCH");
  const settingsInventory = readRecord(binding.settings_inventory);
  if (!hasExactKeys(settingsInventory, ["schema_version", "public_catalog_version", "build_id", "runtime_usable", "family_form_id", "editor_form"])) fail("PROFILE_BINDING_MISMATCH");
  const form = readRecord(settingsInventory.editor_form);
  if (!hasExactKeys(form, ["form_id", "module_name", "bytes", "sha256", "parse_diagnostics", "model_value_settings_keys", "static_setting_defaults"])) fail("PROFILE_BINDING_MISMATCH");
  const artifacts = readRecord(binding.source_artifacts);
  const artifactsExpected = {
    editor_form: { module: "seedream-editor.js", bytes: 7_628, sha256: SOURCE_PINS.form_sha256 },
    editor_parent: { module: "InpaintEditor.js", bytes: 24_250, sha256: SOURCE_PINS.parent_sha256 },
    generic_sender: { module: "useInpaintTool.js", bytes: 218_328, sha256: SOURCE_PINS.generic_sender_sha256 },
    settings_helper: { module: "settings3.js", bytes: 4_123, sha256: SOURCE_PINS.settings_helper_sha256 },
    file_upload_component: { module: "FileUpload.js", bytes: 30_206, sha256: "sha256:2eddb5ee7f0b41cd31f56a2345542d9b5d70da419d1c2b1d003afc36519869d5" },
    file_uploader: { module: "fileUploader.js", bytes: 362_328, sha256: "sha256:b1e9af34daa830845c9712121ebb25c92801d22bbcec4f49d8b1748ecbc47786" },
    app_store_and_upload: { module: "app.js", bytes: 2_445_534, sha256: SOURCE_PINS.app_upload_sha256 }
  };
  if (!hasExactKeys(artifacts, Object.keys(artifactsExpected))) fail("PROFILE_BINDING_MISMATCH");
  const expectedForm = {
    form_id: "seedream-editor", module_name: "seedream-editor.js", bytes: 7_628,
    sha256: SOURCE_PINS.form_sha256, parse_diagnostics: 0,
    model_value_settings_keys: ["aspect_ratio", "resolution"], static_setting_defaults: {}
  };
  const sourceHashes = readRecord(binding.selected_public_source_hashes);
  const policy = readRecord(profile.input_policy);
  if (!hasExactKeys(policy, ["accepted_file_types", "source_ui_max_file_bytes", "source_ui_limit_is_provider_limit", "local_parser_max_bytes",
    "local_parser_policy", "max_file_count", "destination", "check_duplicates", "model_type_source", "min_image_aspect_ratio",
    "max_image_aspect_ratio", "side_limits", "metadata_confidence"])) fail("PROFILE_BINDING_MISMATCH");
  if (binding.selected_public_catalog_fetched_at !== "2026-10-11T12:04:10.638Z" ||
      binding.source_confidence !== "HASH_PINNED_STATIC_SOURCE_NOT_RENDERED_UI" ||
      modelIdentity.id !== variant || modelIdentity.upstream_id !== variant || modelIdentity.ai_name !== "seedream" ||
      modelIdentity.active !== true || modelIdentity.default !== DEFAULTS[variant] || settingsInventory.schema_version !== "2.1.0" ||
      settingsInventory.public_catalog_version !== OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION ||
      settingsInventory.build_id !== "1791467421" || settingsInventory.runtime_usable !== false ||
      settingsInventory.family_form_id !== "seedream" || !sameJson(form, expectedForm) ||
      !sameJson(artifacts, artifactsExpected) ||
      !sameJson(sourceHashes, {
        ai: "sha256:b99bb90d170acb5a3a06c5be0cbc51d2ab0d17902bee21303a44b32c5fcaef39",
        llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
        models: "sha256:16735c498e3743b67fb384ccee44de34ffd3ac8debaeb46033a5723938191a58"
      }) || policy.max_file_count !== 1 || policy.destination !== "uploaded" || policy.check_duplicates !== true ||
      policy.model_type_source !== "EXPLICIT_UNDERLYING_VARIANT" || policy.source_ui_limit_is_provider_limit !== false ||
      !sameJson(policy.accepted_file_types, ACCEPTED_MIMES[variant]) || policy.source_ui_max_file_bytes !== SOURCE_UI_CAPS[variant] ||
      policy.local_parser_max_bytes !== 33_554_432 || policy.local_parser_policy !== "BOUNDED_CONTAINER_INSPECTION_ONLY_NOT_SOURCE_OR_PROVIDER_LIMIT" ||
      policy.side_limits !== "NOT_SPECIFIED_BY_EDITOR_SOURCE" || policy.metadata_confidence !== "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" ||
      policy.min_image_aspect_ratio !== (variant === "seedream-5.0-flash" || variant === "seedream-5.0-pro" ? 1 / 16 : null) ||
      policy.max_image_aspect_ratio !== (variant === "seedream-5.0-flash" || variant === "seedream-5.0-pro" ? 16 : null) ||
      !Object.isFrozen(input)) fail("PROFILE_BINDING_MISMATCH");
  return input as Readonly<OwnerSeedreamEditorOriginalUploadSourceProfile>;
}

function snapshotFrozenValue(value: unknown, depth: number): unknown {
  if (depth > 16) fail("PROFILE_BINDING_MISMATCH");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || isProxy(value) || !Object.isFrozen(value)) fail("PROFILE_BINDING_MISMATCH");
  if (Array.isArray(value)) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => key !== "length" && (typeof key !== "string" || !/^\d+$/u.test(key))) ||
        Object.getPrototypeOf(value) !== Array.prototype || keys.length !== value.length + 1) fail("PROFILE_BINDING_MISMATCH");
    return Array.from({ length: value.length }, (_, index) => {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) fail("PROFILE_BINDING_MISMATCH");
      return snapshotFrozenValue(descriptor.value, depth + 1);
    });
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail("PROFILE_BINDING_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true) fail("PROFILE_BINDING_MISMATCH");
    snapshot[key] = snapshotFrozenValue(descriptors[key]!.value, depth + 1);
  }
  return snapshot;
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("PROFILE_BINDING_MISMATCH");
  return value as Record<string, unknown>;
}
function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
function sameJson(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}
function isVariant(value: unknown): value is OwnerSeedreamImageVariant {
  return typeof value === "string" && (OWNER_SEEDREAM_IMAGE_VARIANTS as readonly string[]).includes(value);
}
function fail(code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH"): never {
  throw new OwnerSeedreamEditorGenerationSourceProfileError(code);
}
