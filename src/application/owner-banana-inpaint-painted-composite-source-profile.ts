import { isProxy } from "node:util/types";
import { schemaHash } from "../domain/generation-contract.js";
import {
  OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
  OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
  OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS,
  type OwnerBananaInpaintOriginalUploadSourceProfile,
  type OwnerBananaInpaintOriginalUploadVariant
} from "./owner-banana-inpaint-original-upload-source-profile.js";

export const OWNER_BANANA_INPAINT_PAINTED_COMPOSITE_VARIANTS = Object.freeze([
  "banana", "banana2", "banana3", "banana3_light"
] as const);

export type OwnerBananaInpaintPaintedCompositeVariant = typeof OWNER_BANANA_INPAINT_PAINTED_COMPOSITE_VARIANTS[number];

const SOURCE_ARTIFACTS = Object.freeze({
  inpaint_editor: Object.freeze({
    module: "InpaintEditor.js", bytes: 24_250,
    sha256: "sha256:87509acda1040d79927edc30d8ddd18d503a6e7ce9387d5d0a059b1eb5028e14"
  }),
  image_canvas: Object.freeze({
    module: "ImageCanvas.js", bytes: 15_226,
    sha256: "sha256:510f00b01ae9deadd6a265f6733adbd383c785cfa10c15a907d835c810c7a9b2"
  }),
  painted_composite_caller: Object.freeze({
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

const PRODUCER = Object.freeze({
  encoding: "ORIGINAL_IMAGE_PLUS_COLORED_PAINT_OVERLAY_PNG_NOT_BINARY_MASK_PLANE",
  producer_mime_type: "image/png",
  output_dimensions: "LOADED_IMAGE_NATURAL_WIDTH_HEIGHT",
  paint_layer_alpha: 191,
  pixel_role: "SOURCE_PAINT_LAYER_ALPHA_GREATER_THAN_ZERO",
  initial_paint_rgb: Object.freeze({ r: 99, g: 102, b: 241 }),
  paint_rgb_is_mutable: true,
  local_file_mime: "DATA_URL_HEADER_MIME_WITH_IMAGE_PNG_FALLBACK_NOT_HARDCODED_PNG",
  local_filename: "inpaint-mask"
} as const);

const GEOMETRY = Object.freeze({
  scope: "CONTAINER_GEOMETRY_ONLY",
  dimensions_source: "LOADED_IMAGE_NATURAL_WIDTH_HEIGHT",
  decoded_pixel_geometry: false,
  browser_exif_rendering: false,
  provider_crop_or_resize: false
} as const);
const ORIGINAL_PROFILE_FETCHED_AT = "2026-10-11T12:04:10.638Z";
const ORIGINAL_MODEL_DEFAULTS = Object.freeze({ banana: false, banana2: false, banana3: true, banana3_light: true } as const);
const ORIGINAL_SOURCE_HASHES = Object.freeze({
  ai: "sha256:b99bb90d170acb5a3a06c5be0cbc51d2ab0d17902bee21303a44b32c5fcaef39",
  llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
  models: "sha256:16735c498e3743b67fb384ccee44de34ffd3ac8debaeb46033a5723938191a58"
} as const);

export interface OwnerBananaInpaintPaintedCompositeSourceProfile {
  readonly profile_id: "banana-inpaint-painted-composite-source-profile-v1";
  readonly variant: OwnerBananaInpaintPaintedCompositeVariant;
  readonly model_id: OwnerBananaInpaintPaintedCompositeVariant;
  readonly model_type: OwnerBananaInpaintPaintedCompositeVariant;
  readonly source_role: "painted_composite";
  readonly wire_role: "mask";
  readonly public_catalog_version: typeof OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION;
  readonly settings_inventory_version: typeof OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION;
  readonly source_binding: Readonly<{
    original_upload_profile_schema_hash: string;
    original_upload_profile_id: "banana-inpaint-original-upload-source-profile-v1";
    source_artifacts: typeof SOURCE_ARTIFACTS;
    source_confidence: "HASH_PINNED_STATIC_SOURCE_NOT_RENDERED_UI";
  }>;
  readonly producer: typeof PRODUCER;
  readonly geometry: typeof GEOMETRY;
  readonly source_mask_byte_limit: "UNPROVEN";
  readonly runtime_usable: false;
  readonly runtime_activation: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_schema_hash: string;
}

export type OwnerBananaInpaintPaintedCompositeSourceProfileErrorCode =
  | "INVALID_REQUEST"
  | "PROFILE_BINDING_MISMATCH";

export class OwnerBananaInpaintPaintedCompositeSourceProfileError extends Error {
  constructor(readonly code: OwnerBananaInpaintPaintedCompositeSourceProfileErrorCode) {
    super("The Banana Inpaint painted-composite source profile could not be verified.");
    this.name = "OwnerBananaInpaintPaintedCompositeSourceProfileError";
  }
}

/** Binds the painted-composite source path to a verified original-upload profile without granting generation authority. */
export function getOwnerBananaInpaintPaintedCompositeSourceProfile(
  variantInput: unknown,
  originalProfileInput: Readonly<OwnerBananaInpaintOriginalUploadSourceProfile>
): Readonly<OwnerBananaInpaintPaintedCompositeSourceProfile> {
  if (!isVariant(variantInput)) fail("INVALID_REQUEST");
  const originalProfile = snapshotOriginalProfile(originalProfileInput, variantInput);
  const base = deepFreeze({
    profile_id: "banana-inpaint-painted-composite-source-profile-v1" as const,
    variant: variantInput,
    model_id: variantInput,
    model_type: variantInput,
    source_role: "painted_composite" as const,
    wire_role: "mask" as const,
    public_catalog_version: OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
    settings_inventory_version: OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
    source_binding: {
      original_upload_profile_schema_hash: originalProfile.profile_schema_hash,
      original_upload_profile_id: originalProfile.profile_id,
      source_artifacts: SOURCE_ARTIFACTS,
      source_confidence: "HASH_PINNED_STATIC_SOURCE_NOT_RENDERED_UI" as const
    },
    producer: PRODUCER,
    geometry: GEOMETRY,
    source_mask_byte_limit: "UNPROVEN" as const,
    runtime_usable: false as const,
    runtime_activation: false as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
  return deepFreeze({ ...base, profile_schema_hash: schemaHash(base) }) as Readonly<OwnerBananaInpaintPaintedCompositeSourceProfile>;
}

interface OriginalProfileSnapshot {
  readonly profile_id: OwnerBananaInpaintOriginalUploadSourceProfile["profile_id"];
  readonly variant: OwnerBananaInpaintOriginalUploadVariant;
  readonly profile_schema_hash: string;
}

function snapshotOriginalProfile(input: unknown, variant: OwnerBananaInpaintPaintedCompositeVariant): OriginalProfileSnapshot {
  const fields = readDataRecord(input);
  const sourceBinding = readDataRecord(fields.source_binding);
  const settingsInventory = readDataRecord(sourceBinding.settings_inventory);
  const modelIdentity = readDataRecord(sourceBinding.model_identity);
  const selectedHashes = readDataRecord(sourceBinding.selected_public_source_hashes);
  const familyForm = readDataRecord(settingsInventory.family_model_form);
  const sourceArtifacts = readDataRecord(sourceBinding.source_artifacts);
  const inpaintForm = readDataRecord(settingsInventory.inpaint_form);
  const inpaintArtifact = readDataRecord(sourceArtifacts.inpaint_form);
  const caller = readDataRecord(sourceArtifacts.original_upload_caller);
  const helper = readDataRecord(sourceArtifacts.settings_helper);
  const app = readDataRecord(sourceArtifacts.app_upload_store);
  const inputPolicy = readDataRecord(fields.input_policy);
  const base = { ...fields };
  delete base.profile_schema_hash;
  const computedHash = schemaHash(base);
  const expectedDefault = ORIGINAL_MODEL_DEFAULTS[variant];
  if (fields.profile_id !== "banana-inpaint-original-upload-source-profile-v1" || fields.variant !== variant ||
      fields.model_id !== variant || fields.model_type !== variant || fields.family_ai_name !== "banana" ||
      fields.form_ai_name !== "banana_inpaint" || fields.form_id !== "banana-inpaint" ||
      fields.public_catalog_version !== OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION ||
      fields.settings_inventory_version !== OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION ||
      fields.catalog_default_flag !== expectedDefault ||
      fields.catalog_default_confidence !== "PUBLIC_CATALOG_METADATA_ONLY_NOT_RUNTIME_SELECTION" ||
      fields.runtime_usable !== false || fields.runtime_activation !== false || fields.dispatch_allowed !== false ||
      fields.backend_acceptance !== "UNPROVEN" || sourceBinding.source_confidence !== "HASH_PINNED_STATIC_SOURCE_NOT_RENDERED_UI" ||
      sourceBinding.selected_public_catalog_fetched_at !== ORIGINAL_PROFILE_FETCHED_AT ||
      !sameJson(selectedHashes, ORIGINAL_SOURCE_HASHES) ||
      !sameJson(modelIdentity, { id: variant, upstream_id: variant, ai_name: "banana", active: true, default: expectedDefault }) ||
      settingsInventory.schema_version !== "2.1.0" ||
      settingsInventory.public_catalog_version !== OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION ||
      settingsInventory.build_id !== "1791467421" || settingsInventory.runtime_usable !== false ||
      !sameJson(familyForm, { form_id: "banana", form_binding_status: "STRUCTURAL_MATCH", settings_status: "PUBLIC_SETTINGS_KNOWN" }) ||
      !sameJson(inpaintForm, {
        form_id: "banana-inpaint", module_name: "banana-inpaint.js", bytes: 8_715,
        sha256: "sha256:4a22ce6da71d2b39c97614cdfcde3d38f201dad3015f2a59f018d8b7c8146172",
        parse_diagnostics: 0, model_value_settings_keys: ["image_size", "model_type"], static_setting_defaults: {}
      }) ||
      !sameJson(inpaintArtifact, { module: "banana-inpaint.js", bytes: 8_715, sha256: inpaintForm.sha256 }) ||
      !sameJson(inputPolicy, {
        accepted_file_types: ["image/jpeg", "image/png"], max_file_bytes: 52_428_800, max_file_count: 1,
        size_scope: "SOURCE_UI_FILE_INPUT_LIMIT_NOT_PROVIDER_LIMIT", destination: "hidden", check_duplicates: true,
        model_type_source: "EXPLICIT_UNDERLYING_BANANA_VARIANT"
      }) ||
      caller.module !== SOURCE_ARTIFACTS.painted_composite_caller.module ||
      caller.bytes !== SOURCE_ARTIFACTS.painted_composite_caller.bytes ||
      caller.sha256 !== SOURCE_ARTIFACTS.painted_composite_caller.sha256 ||
      helper.module !== SOURCE_ARTIFACTS.settings_helper.module ||
      helper.bytes !== SOURCE_ARTIFACTS.settings_helper.bytes || helper.sha256 !== SOURCE_ARTIFACTS.settings_helper.sha256 ||
      app.module !== SOURCE_ARTIFACTS.app_upload_store.module || app.bytes !== SOURCE_ARTIFACTS.app_upload_store.bytes ||
      app.sha256 !== SOURCE_ARTIFACTS.app_upload_store.sha256 || typeof fields.profile_schema_hash !== "string" ||
      fields.profile_schema_hash !== computedHash || !Object.isFrozen(input)) fail("PROFILE_BINDING_MISMATCH");
  return Object.freeze({
    profile_id: fields.profile_id as OwnerBananaInpaintOriginalUploadSourceProfile["profile_id"],
    variant,
    profile_schema_hash: fields.profile_schema_hash
  });
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

function isVariant(value: unknown): value is OwnerBananaInpaintPaintedCompositeVariant {
  return typeof value === "string" &&
    (OWNER_BANANA_INPAINT_PAINTED_COMPOSITE_VARIANTS as readonly string[]).includes(value) &&
    (OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS as readonly string[]).includes(value);
}

function fail(code: OwnerBananaInpaintPaintedCompositeSourceProfileErrorCode): never {
  throw new OwnerBananaInpaintPaintedCompositeSourceProfileError(code);
}
