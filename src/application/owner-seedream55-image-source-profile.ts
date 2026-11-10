import { isDeepStrictEqual, types } from "node:util";
import { schemaHash } from "../domain/generation-contract.js";
import type { OwnerSeedreamImageCatalogPort } from "./owner-seedream-image-source-profile.js";

export const SEEDREAM55_PUBLIC_CATALOG_VERSION =
  "sha256-49f41bb1565932456137e2a264a2904c441a95e9f5e0aa2a76a9a0c503fedc13.json";
export const SEEDREAM55_SETTINGS_VERSION =
  "sha256-0a03f8d27f72361e8ca6cff628e2a6245e8fca11b338d0c996ecf71c79b43c32.json";
const FETCHED_AT = "2026-11-10T12:33:30.557Z";
const HASHES = Object.freeze({
  ai: "sha256:381033bd1dca13daa6642276bbdb3508edf71d33d2898b230f5179c179a25985",
  llm_models: "sha256:c2237748fac638cc43937809b651f17bc78a4f9ae95220ec28c1682999f55cfa",
  models: "sha256:24bbc57596f4d3aa33e72f8bd8004f72ff1eb769e33675a71eedc75a586d9252"
});
const MIME = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/webp", "image/gif", "image/tiff", "image/heic", "image/heif"]);
const SETTINGS = Object.freeze({
  accepted_file_types: MIME, allowed_media_types: ["images"], attach_info_text: null,
  file_count_limit: 10, get_cost_params: ["batch_size", "resolution"],
  max_dimension: 6_000, max_file_size: 31_457_280, max_height: 6_000,
  max_image_aspect_ratio: 16, max_image_dimension: 8_400, max_image_file_size: 27_525_120,
  max_image_height: 6_000, max_image_pixel_count: 36_000_000, max_image_width: 6_000,
  max_prompt_length: 0, max_width: 6_000, min_dimension: 15,
  min_image_aspect_ratio: 0.0625, min_image_height: 15, min_image_pixel_count: 196,
  min_image_width: 15, uploadable: true
});

export class OwnerSeedream55ImageSourceProfileError extends Error {
  constructor(readonly code: "PROFILE_BINDING_MISMATCH") {
    super("The Seedream 5.5 public source binding is unavailable.");
    this.name = "OwnerSeedream55ImageSourceProfileError";
  }
}

/** Exact public and static-source proof; no provider or account authorization. */
export function getOwnerSeedream55ImageSourceProfile(catalog: OwnerSeedreamImageCatalogPort, version: unknown) {
  const fail = (): never => { throw new OwnerSeedream55ImageSourceProfileError("PROFILE_BINDING_MISMATCH"); };
  if (version !== SEEDREAM55_PUBLIC_CATALOG_VERSION || !catalog || typeof catalog !== "object" || types.isProxy(catalog)) fail();
  const read = (object: object, key: string): unknown => {
    let current: object | null = object;
    while (current !== null) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
      current = Object.getPrototypeOf(current) as object | null;
    }
    return undefined;
  };
  const metadata = read(catalog, "catalog_metadata");
  if (!metadata || typeof metadata !== "object" || types.isProxy(metadata) ||
      read(catalog, "fetched_at") !== FETCHED_AT || read(catalog, "catalog_kind") !== "OFFICIAL_PUBLIC_API_SNAPSHOT" ||
      read(catalog, "runtime_usable") !== false || !isDeepStrictEqual(read(catalog, "source_hashes"), HASHES) ||
      read(metadata, "fetched_at") !== FETCHED_AT || read(metadata, "public_settings_coverage") !== "ALLOWLISTED_PUBLIC_API_FIELDS" ||
      !isDeepStrictEqual(read(metadata, "source_hashes"), HASHES)) fail();
  const getModel = read(catalog, "getModel");
  if (typeof getModel !== "function" || types.isProxy(getModel)) fail();
  let model: unknown;
  try { model = Reflect.apply(getModel as Function, catalog, ["seedream-5.5"]); } catch { fail(); }
  if (!model || typeof model !== "object" || types.isProxy(model)) fail();
  const record = model as object;
  const operations = read(record, "operations");
  if (read(record, "id") !== "seedream-5.5" || read(record, "upstream_id") !== "seedream-5.5" ||
      read(record, "ai_name") !== "seedream" || read(record, "active") !== true || read(record, "default") !== true ||
      read(record, "fetched_at") !== FETCHED_AT || read(record, "catalog_kind") !== "OFFICIAL_PUBLIC_API_SNAPSHOT" ||
      read(record, "runtime_usable") !== false || read(record, "scope") !== "image" ||
      !isDeepStrictEqual(read(record, "source_hashes"), HASHES) ||
      !isDeepStrictEqual(read(record, "modalities"), ["image"]) ||
      !isDeepStrictEqual(read(record, "settings"), SETTINGS) || !Array.isArray(operations) ||
      operations.length !== 1 || read(operations[0] as object, "id") !== "generate-image" ||
      read(operations[0] as object, "output_modality") !== "image" ||
      read(operations[0] as object, "derivation") !== "PUBLIC_AI_SCOPE") fail();
  const base = Object.freeze({
    profile_id: "seedream55-image-source-reviewed-v1" as const,
    model_id: "seedream-5.5" as const, variant: "seedream-5.5" as const,
    ai_name: "seedream" as const, model_type: "seedream-5.5" as const,
    catalog_default_flag: true, operation_id: "generate-image" as const,
    public_catalog_version: SEEDREAM55_PUBLIC_CATALOG_VERSION,
    source_binding: Object.freeze({
      selected_public_catalog_version: SEEDREAM55_PUBLIC_CATALOG_VERSION,
      selected_public_catalog_fetched_at: FETCHED_AT, selected_public_source_hashes: HASHES,
      settings_inventory: SEEDREAM55_SETTINGS_VERSION,
      form: Object.freeze({ build_id: "1794311734", module: "seedream.js", bytes: 7_251,
        sha256: "sha256:792ed18820311f638530324962234f1207be3880d5e8181cf713d0620229334c",
        constants_sha256: "sha256:940ff49e7c5c1c4e28e8dcfb8fa4b1495f258c31219f0af4a1b9e28185953449",
        extra_settings_sha256: "sha256:defce768fb2a3cf58707f6ed04982fb597e1d2daeec3d31567d886f42246f1e0",
        cost_sha256: "sha256:30ecd2694a05092e2d08dc73d0c903a1c6ca6242163f95dfc7e7901b26c9d648" })
    }),
    source_controller_markers: Object.freeze({
      controlled_fields: ["aspect_ratio", "resolution", "output_format", "background"] as const,
      inactive_fields: "ALL_FIELDS_ACTIVE" as const,
      defaults: Object.freeze({ aspect_ratio: "1:1", resolution: "2K", output_format: "png", background: "auto" }),
      fixed_wire: Object.freeze({ n: 1 as const, stream: false as const }),
      transparency: "TRANSPARENT_PNG_WITHOUT_ALPHA_REFERENCE_REQUIREMENT_IN_STATIC_SOURCE" as const
    }),
    public_settings: SETTINGS,
    parameters_source: Object.freeze({
      profile_id: "seedream55-image-source-parameters-v1", variants: ["seedream-5.5"],
      aspect_ratios: ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"],
      resolutions: ["1K", "1.5K", "2K"], output_formats: ["jpeg", "png"],
      backgrounds: ["auto", "opaque", "transparent"]
    }),
    reference_count: Object.freeze({ minimum: 0 as const, maximum: 10, confidence: "PUBLIC_FILE_COUNT_METADATA_NOT_PROVIDER_ACCEPTANCE" as const }),
    mime_policy: Object.freeze({ accepted_file_types: MIME, confidence: "PUBLIC_CATALOG_DECLARATION_NOT_PROVIDER_ACCEPTANCE" as const }),
    input_policy: Object.freeze({ generic_max_file_bytes: 31_457_280, image_max_file_bytes: 27_525_120,
      local_structural_max_bytes: 27_525_120,
      local_policy: "SELECTED_49F41B_IMAGE_METADATA_CEILING_NOT_PROVIDER_LIMIT" as const,
      max_image_dimension: 8_400, max_image_width: 6_000,
      max_image_height: 6_000, max_image_pixel_count: 36_000_000, min_image_width: 15,
      min_image_height: 15, min_image_pixel_count: 196, max_image_aspect_ratio: 16, min_image_aspect_ratio: 0.0625,
      dimensions_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" as const }),
    cost_policy: Object.freeze({ declared_metadata_keys: ["batch_size", "resolution"] as const,
      controlled_inputs: ["batch_size", "resolution"] as const,
      pro_batch_size_semantics: "EXPLICIT_REFERENCE_COUNT_INCLUDING_ZERO" as const,
      quote_or_amount: "UNPROVEN" as const,
      confidence: "SOURCE_JOINED_CONTROLLED_STATE_NOT_QUOTE" as const }),
    effective_defaults: "STATIC_FORM_DEFAULTS_KNOWN_RUNTIME_EFFECT_UNKNOWN" as const,
    dispatch_allowed: false as const, runtime_activation: false as const, backend_acceptance: "UNPROVEN" as const
  });
  return deepFreeze({ ...base, profile_schema_hash: schemaHash(base) });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    if (!Object.isFrozen(value)) Object.freeze(value);
  }
  return value;
}
