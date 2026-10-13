import { types } from "node:util";
import { schemaHash } from "../domain/generation-contract.js";
import {
  getOwnerBananaInpaintImageSourceProfile,
  type OwnerBananaInpaintImageVariant
} from "./owner-banana-inpaint-image-source-profile.js";
import {
  OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
  OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
  OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS,
  type OwnerBananaInpaintOriginalUploadSourceProfile
} from "./owner-banana-inpaint-original-upload-source-profile.js";
import { getOwnerBananaInpaintPaintedCompositeSourceProfile } from "./owner-banana-inpaint-painted-composite-source-profile.js";
import { getOwnerBananaInpaintSourceParameters } from "./owner-banana-inpaint-parameters.js";

const SOURCE_ARTIFACTS = Object.freeze({
  reference: Object.freeze({
    module: "Reference.js", bytes: 5_956,
    sha256: "sha256:99979b585bb47bb5547e28ca927f9a4b5cbe12af56b9a0bfd481e07f91fcea4a"
  }),
  upload_dropdown: Object.freeze({
    module: "UploadDropdown.js", bytes: 42_832,
    sha256: "sha256:b399a8a1d5fede3a16dd444abcfb4b8ddc89cd89e03ab493c5f9b5eff0f9d783"
  }),
  file_uploader: Object.freeze({
    module: "fileUploader.js", bytes: 362_328,
    sha256: "sha256:b1e9af34daa830845c9712121ebb25c92801d22bbcec4f49d8b1748ecbc47786"
  }),
  inpaint_caller: Object.freeze({
    module: "useImageEditorTool.js", bytes: 12_652,
    sha256: "sha256:6ede93da546e372b8a550a00d370a79a65b0e6841942c74317ad7814097ceebe"
  }),
  app_uploader: Object.freeze({
    module: "app.js", bytes: 2_445_534,
    sha256: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf"
  })
} as const);

const SOURCE_CAPTURE = Object.freeze({
  build_id: "1791467421",
  homepage_start_end_sha256: "a7a68e6ae96547333037962ab9bb3a40ddf7aeb912223d65a9962ab5ce6982da",
  root909: Object.freeze({ requests: 5, bytes: 654_616, start_end_same: true }),
  root912: Object.freeze({ requests: 6, bytes: 294_783, start_end_same: true }),
  root914: Object.freeze({ requests: 4, bytes: 648_660, start_end_same: true }),
  raw_vendor_saved: false,
  vendor_executed: false,
  cleanup_same_handle_empty_closed: true
} as const);

const ACCEPTED_LOCAL_MIME_TYPES = Object.freeze([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif",
  "image/heic", "image/heif", "image/bmp", "image/gif", "image/tiff"
] as const);
const LOCAL_FORMAT_LIMITS = Object.freeze({
  jpeg_png_webp: Object.freeze({ mime_types: Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/webp"] as const), max_bytes: 50 * 1024 * 1024, scope: "LOCAL_RESOURCE_BOUND_ONLY" as const }),
  avif: Object.freeze({ mime_types: Object.freeze(["image/avif"] as const), max_bytes: 25 * 1024 * 1024, scope: "LOCAL_PARSER_CEILING_ONLY" as const }),
  bmp_gif_tiff: Object.freeze({ mime_types: Object.freeze(["image/bmp", "image/gif", "image/tiff"] as const), max_bytes: 32 * 1024 * 1024, scope: "LOCAL_PARSER_CEILING_ONLY" as const }),
  heic_heif: Object.freeze({ mime_types: Object.freeze(["image/heic", "image/heif"] as const), max_bytes: 32 * 1024 * 1024, scope: "LOCAL_PARSER_CEILING_ONLY" as const })
} as const);

export interface OwnerBananaInpaintAuxiliarySourceProfile {
  readonly profile_id: "banana-inpaint-auxiliary-image-source-profile-v1";
  readonly variant: OwnerBananaInpaintImageVariant;
  readonly model_id: OwnerBananaInpaintImageVariant;
  readonly model_type: OwnerBananaInpaintImageVariant;
  readonly form_id: "banana-inpaint";
  readonly scope: "tool_image_inpaint";
  readonly family_ai_name: "banana";
  readonly source_role: "auxiliary_image";
  readonly wire_role: "image";
  readonly public_catalog_version: typeof OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION;
  readonly settings_inventory_version: typeof OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION;
  readonly source_binding: Readonly<{
    original_upload_profile_id: OwnerBananaInpaintOriginalUploadSourceProfile["profile_id"];
    original_upload_profile_schema_hash: string;
    generation_source_profile_id: "banana-inpaint-image-source-profile-v1";
    generation_source_profile_schema_hash: string;
    direct_source_artifacts: typeof SOURCE_ARTIFACTS;
    source_capture: typeof SOURCE_CAPTURE;
    confidence: "HASH_PINNED_STATIC_SOURCE_NOT_RENDERED_UI";
  }>;
  readonly source_reference: Readonly<{
    max_count: 1;
    minimum_count: 0;
    media_type: "images";
    weight_active: false;
    picker_accept_hint: "image/*";
    picker_hint_is_backend_permission: false;
    uploaded_destination: "uploaded";
    duplicate_check: true;
    model_type_source: "CURRENT_EXPLICIT_BANANA_INPAINT_VARIANT";
    uri_mapping: "UPLOADED_URI_STRING_TO_IMAGE_REFERENCE";
    catalog_max_file_size_metadata: 0;
    source_size_limit: "UNKNOWN_ZERO_METADATA_NOT_UNLIMITED";
    mime_acceptance: "UNPROVEN";
  }>;
  readonly local_input_policy: Readonly<{
    accepted_mime_types: typeof ACCEPTED_LOCAL_MIME_TYPES;
    local_resource_bound_bytes: 52_428_800;
    local_resource_bound_scope: "LOCAL_RESOURCE_BOUND_ONLY_NOT_SOURCE_UI_OR_PROVIDER_LIMIT";
    parser_format_limits: typeof LOCAL_FORMAT_LIMITS;
    unsupported_source_classifier_mimes: readonly ["image/svg+xml", "image/x-icon"];
    unknown_image_wildcard: "REJECT_NO_LOCAL_CONTAINER_INSPECTOR";
    svg_execution: false;
    pixel_decode_verified: false;
    metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  }>;
  readonly source_upload_policy: Readonly<{
    destination: "uploaded";
    check_duplicates: true;
    wire_model_type: OwnerBananaInpaintImageVariant;
    source_size_limit: "UNKNOWN";
    backend_acceptance: "UNPROVEN";
  }>;
  readonly runtime_usable: false;
  readonly runtime_activation: false;
  readonly dispatch_allowed: false;
  readonly generation_permission: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_schema_hash: string;
}

export type OwnerBananaInpaintAuxiliarySourceProfileErrorCode = "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH";

export class OwnerBananaInpaintAuxiliarySourceProfileError extends Error {
  constructor(readonly code: OwnerBananaInpaintAuxiliarySourceProfileErrorCode) {
    super("The Banana Inpaint auxiliary image source profile could not be verified.");
    this.name = "OwnerBananaInpaintAuxiliarySourceProfileError";
  }
}

/** Binds an auxiliary upload to the exact original/generation source lineage without granting generation. */
export function getOwnerBananaInpaintAuxiliarySourceProfile(
  variantInput: unknown,
  originalProfileInput: Readonly<OwnerBananaInpaintOriginalUploadSourceProfile>
): Readonly<OwnerBananaInpaintAuxiliarySourceProfile> {
  if (typeof variantInput !== "string" || !(OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS as readonly string[]).includes(variantInput)) {
    fail("INVALID_REQUEST");
  }
  const variant = variantInput as OwnerBananaInpaintImageVariant;
  try {
    const painted = getOwnerBananaInpaintPaintedCompositeSourceProfile(variant, originalProfileInput);
    const controls = getOwnerBananaInpaintSourceParameters(variant, originalProfileInput);
    const generation = getOwnerBananaInpaintImageSourceProfile(variant, originalProfileInput, painted, controls);
    const original = snapshotOriginalBinding(originalProfileInput, variant);
    const base = deepFreeze({
      profile_id: "banana-inpaint-auxiliary-image-source-profile-v1" as const,
      variant,
      model_id: variant,
      model_type: variant,
      form_id: "banana-inpaint" as const,
      scope: "tool_image_inpaint" as const,
      family_ai_name: "banana" as const,
      source_role: "auxiliary_image" as const,
      wire_role: "image" as const,
      public_catalog_version: OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
      settings_inventory_version: OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
      source_binding: {
        original_upload_profile_id: original.profile_id,
        original_upload_profile_schema_hash: original.profile_schema_hash,
        generation_source_profile_id: generation.profile_id,
        generation_source_profile_schema_hash: generation.profile_schema_hash,
        direct_source_artifacts: SOURCE_ARTIFACTS,
        source_capture: SOURCE_CAPTURE,
        confidence: "HASH_PINNED_STATIC_SOURCE_NOT_RENDERED_UI" as const
      },
      source_reference: {
        max_count: 1 as const,
        minimum_count: 0 as const,
        media_type: "images" as const,
        weight_active: false as const,
        picker_accept_hint: "image/*" as const,
        picker_hint_is_backend_permission: false as const,
        uploaded_destination: "uploaded" as const,
        duplicate_check: true as const,
        model_type_source: "CURRENT_EXPLICIT_BANANA_INPAINT_VARIANT" as const,
        uri_mapping: "UPLOADED_URI_STRING_TO_IMAGE_REFERENCE" as const,
        catalog_max_file_size_metadata: 0 as const,
        source_size_limit: "UNKNOWN_ZERO_METADATA_NOT_UNLIMITED" as const,
        mime_acceptance: "UNPROVEN" as const
      },
      local_input_policy: {
        accepted_mime_types: ACCEPTED_LOCAL_MIME_TYPES,
        local_resource_bound_bytes: 52_428_800 as const,
        local_resource_bound_scope: "LOCAL_RESOURCE_BOUND_ONLY_NOT_SOURCE_UI_OR_PROVIDER_LIMIT" as const,
        parser_format_limits: LOCAL_FORMAT_LIMITS,
        unsupported_source_classifier_mimes: ["image/svg+xml", "image/x-icon"] as const,
        unknown_image_wildcard: "REJECT_NO_LOCAL_CONTAINER_INSPECTOR" as const,
        svg_execution: false as const,
        pixel_decode_verified: false as const,
        metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" as const
      },
      source_upload_policy: {
        destination: "uploaded" as const,
        check_duplicates: true as const,
        wire_model_type: variant,
        source_size_limit: "UNKNOWN" as const,
        backend_acceptance: "UNPROVEN" as const
      },
      runtime_usable: false as const,
      runtime_activation: false as const,
      dispatch_allowed: false as const,
      generation_permission: false as const,
      backend_acceptance: "UNPROVEN" as const
    });
    return deepFreeze({ ...base, profile_schema_hash: schemaHash(base) }) as Readonly<OwnerBananaInpaintAuxiliarySourceProfile>;
  } catch (error) {
    if (error instanceof OwnerBananaInpaintAuxiliarySourceProfileError) throw error;
    fail("PROFILE_BINDING_MISMATCH");
  }
}

function snapshotOriginalBinding(input: unknown, variant: OwnerBananaInpaintImageVariant): {
  readonly profile_id: OwnerBananaInpaintOriginalUploadSourceProfile["profile_id"];
  readonly profile_schema_hash: string;
} {
  if (!input || typeof input !== "object" || !Object.isFrozen(input)) fail("PROFILE_BINDING_MISMATCH");
  const fields = readDataRecord(input);
  const base = { ...fields };
  delete base.profile_schema_hash;
  if (fields.profile_id !== "banana-inpaint-original-upload-source-profile-v1" || fields.variant !== variant ||
      fields.model_id !== variant || fields.model_type !== variant ||
      fields.public_catalog_version !== OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION ||
      fields.settings_inventory_version !== OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION ||
      fields.runtime_activation !== false || fields.dispatch_allowed !== false || fields.backend_acceptance !== "UNPROVEN" ||
      typeof fields.profile_schema_hash !== "string" || fields.profile_schema_hash !== schemaHash(base)) fail("PROFILE_BINDING_MISMATCH");
  return Object.freeze({ profile_id: fields.profile_id as OwnerBananaInpaintOriginalUploadSourceProfile["profile_id"],
    profile_schema_hash: fields.profile_schema_hash });
}

function readDataRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("PROFILE_BINDING_MISMATCH");
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || keys.some((key) =>
    typeof key !== "string" || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("PROFILE_BINDING_MISMATCH");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
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

function fail(code: OwnerBananaInpaintAuxiliarySourceProfileErrorCode): never {
  throw new OwnerBananaInpaintAuxiliarySourceProfileError(code);
}
