import { isProxy } from "node:util/types";
import { schemaHash } from "../domain/generation-contract.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import {
  getOwnerUniImageUploadProfile,
  OwnerUniImageUploadProfileError,
  type OwnerUniImageModelId
} from "../catalog/owner-uni-image-upload-profile.js";
import {
  OWNER_UNI_IMAGE_MODELS,
  getOwnerUniImageSourceParameters,
  type OwnerUniImageSourceParameters
} from "./owner-uni-image-parameters.js";

const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG_FETCHED_AT = "2026-10-08T13:18:39.393Z";
const SOURCE_HASHES = Object.freeze({
  ai: "sha256:ad66f71c5ace9bb2c2670eb3ccddfbd013882928b398a100d0c757cd2895d609",
  llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
  models: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444"
} as const);
const SOURCE_ARTIFACTS = Object.freeze({
  luma_image_form: Object.freeze({ module: "luma-image.js", build_id: "1791467421", bytes: 5_158,
    sha256: "sha256:97ab44c766c09ead21cdcedd3255b817c18582d60264ebe753da7a61c8e1182e" }),
  uni_source_helper: Object.freeze({ module: "useLuma.js", build_id: "1791467421", bytes: 4_865,
    sha256: "sha256:f884e576649f4663919a079ac910e733f2e09e909262ee9e75bdf049e828f1d6" }),
  app_store: Object.freeze({ module: "app.js", build_id: "1791467421",
    sha256: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf" }),
  settings_helper: Object.freeze({ module: "settings3.js", build_id: "1791467421", bytes: 4_123,
    sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe" }),
  cost_helper: Object.freeze({ module: "cost2.js", build_id: "1791467421", bytes: 1_660,
    sha256: "sha256:c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9" }),
  sender_module: Object.freeze({ module: "video.js", build_id: "1791467421", bytes: 8_689,
    sha256: "sha256:de1f4d8ddb8f79a909aad5a0e62c876995dbaada01946e395d62a3da7e62b2ae" }),
  sender_parent: Object.freeze({ module: "index6.js", build_id: "1791467421", bytes: 12_886,
    sha256: "sha256:eb4fe700c7afae0756348aad3118c55ec8c9b5f5e5d18832045be07bbd368447" }),
  seed_helper: Object.freeze({ module: "RandomSeed.js", build_id: "1791467421",
    sha256: "sha256:c95fc355e29e33f6c3998cb62cc2da4d0879cc1ff4fb524e826e74bb24cd792b", executed: false })
} as const);
const STYLE_OPTIONS = Object.freeze([
  Object.freeze({ label: "Auto", value: "auto" }),
  Object.freeze({ label: "Manga", value: "manga" })
] as const);
const SOURCE_CONFIDENCE = "ROOT743_ROOT798_PINNED_STATIC_SOURCE_NOT_RENDERED_UI_OR_PROVIDER_PROOF" as const;

export type OwnerUniImageSourceProfileModel = OwnerUniImageModelId;
export interface OwnerUniImageSourceProfileCatalogPort extends Pick<DiscoveryCatalogRepository,
  "getModel" | "catalog_kind" | "runtime_usable" | "fetched_at" | "source_hashes" | "catalog_metadata"> {}

type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export interface OwnerUniImageSourceProfile {
  readonly profile_id: "owner-uni-image-source-profile-v1";
  readonly model_id: OwnerUniImageModelId;
  readonly ai_name: "luma_image";
  readonly model_type: OwnerUniImageModelId;
  readonly scope: "image";
  readonly operation_id: "generate-image";
  readonly public_catalog_version: typeof CATALOG_VERSION;
  readonly source_binding: DeepReadonly<{
    selected_public_catalog_version: typeof CATALOG_VERSION;
    selected_public_catalog_fetched_at: typeof CATALOG_FETCHED_AT;
    selected_public_source_hashes: typeof SOURCE_HASHES;
    catalog_metadata_sha256: string;
    full_public_record_sha256: string;
    full_public_record_verified: true;
    upload_profile_reference: {
      operation_id: "upload-image-reference";
      schema_hash: string;
      hash_scope: "UPLOAD_ONLY_NOT_GENERATION_PROFILE_SCHEMA";
    };
    source_artifacts: typeof SOURCE_ARTIFACTS;
    source_joins: {
      form_to_settings_factory: "USE_LUMA_Z_R_A_R_SOURCE_SETTINGS_CALL";
      actual_style_options: typeof STYLE_OPTIONS;
      handle_chat_files: "MAIN_REFERENCE_FIRST_ORDERED_DEDUPED_SET_FILES_SIDE_EFFECT_ONLY";
      ordinary_sender: "APP_STORE_SETTINGS_NORMAL_VIDEO_SENDER_BRANCH";
      custom_payload: "TRUTHY_CUSTOM_PAYLOAD_REPLACES_NOT_MERGES_DEFAULT_SETTINGS";
      dispatch_and_provider_acceptance: "UNPROVEN";
    };
    confidence: typeof SOURCE_CONFIDENCE;
    source_execution: false;
  }>;
  readonly parameters_source: OwnerUniImageSourceParameters;
  readonly model_controls: OwnerUniImageSourceParameters["models_by_id"][OwnerUniImageModelId];
  readonly style_options: typeof STYLE_OPTIONS;
  readonly reference_selection: DeepReadonly<{
    minimum: number;
    maximum: number;
    confidence: "SOURCE_UI_SELECTION_RULE_NOT_OWNERSHIP_OR_PROVIDER_PERMISSION";
    owned_references_bound: false;
    canonical_url_deduplication: "ASSET_ISSUER_CHECK_NOT_THIS_SOURCE_PROFILE";
  }>;
  readonly cost_routing: DeepReadonly<{
    ai_name: "luma_image";
    model_type: OwnerUniImageModelId;
    declared_parameter_keys: readonly ["model_type"];
    cost_inputs: Readonly<Record<never, never>>;
    projection: "ROUTING_ONLY_NOT_QUOTE_BILLING_OR_ADMISSION";
  }>;
  readonly cost_projection_status: "NOT_JOINED";
  readonly defaults: "NOT_INJECTED";
  readonly effective_defaults: "UNKNOWN_SOURCE_INITIALIZERS_NOT_RUNTIME_DEFAULTS";
  readonly generation_readiness: "SOURCE_PROFILE_ONLY_NOT_GENERATION_ADMISSION";
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_schema_hash: string;
}

export class OwnerUniImageSourceProfileError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH") {
    super("The owner Uni image source profile could not be verified.");
    this.name = "OwnerUniImageSourceProfileError";
  }
}

/** Binds the exact e551 catalog row to the full static Uni generation source profile; grants no dispatch authority. */
export function getOwnerUniImageSourceProfile(
  modelInput: unknown,
  catalogInput: OwnerUniImageSourceProfileCatalogPort,
  catalogVersionInput: unknown
): Readonly<OwnerUniImageSourceProfile> {
  if (!isModel(modelInput)) fail("INVALID_REQUEST");
  if (catalogVersionInput !== CATALOG_VERSION) fail("PROFILE_BINDING_MISMATCH");

  let uploadProfile: ReturnType<typeof getOwnerUniImageUploadProfile>;
  try { uploadProfile = getOwnerUniImageUploadProfile(modelInput, catalogInput, CATALOG_VERSION); }
  catch (error) {
    if (error instanceof OwnerUniImageUploadProfileError) fail(error.code);
    fail("PROFILE_BINDING_MISMATCH");
  }

  const parameters = getOwnerUniImageSourceParameters();
  assertParameters(parameters);
  if (uploadProfile.model_id !== modelInput || uploadProfile.ai_name !== "luma_image" ||
      uploadProfile.catalog_version !== CATALOG_VERSION || uploadProfile.catalog_fetched_at !== CATALOG_FETCHED_AT ||
      !sameJson(uploadProfile.catalog_source_hashes, SOURCE_HASHES) ||
      uploadProfile.source_metadata.active !== true || uploadProfile.full_public_record_sha256.length !== 71) {
    fail("PROFILE_BINDING_MISMATCH");
  }

  const controls = parameters.models_by_id[modelInput];
  const base = deepFreeze({
    profile_id: "owner-uni-image-source-profile-v1" as const,
    model_id: modelInput,
    ai_name: "luma_image" as const,
    model_type: modelInput,
    scope: "image" as const,
    operation_id: "generate-image" as const,
    public_catalog_version: CATALOG_VERSION,
    source_binding: {
      selected_public_catalog_version: CATALOG_VERSION,
      selected_public_catalog_fetched_at: CATALOG_FETCHED_AT,
      selected_public_source_hashes: SOURCE_HASHES,
      catalog_metadata_sha256: uploadProfile.catalog_metadata_sha256,
      full_public_record_sha256: uploadProfile.full_public_record_sha256,
      full_public_record_verified: true as const,
      upload_profile_reference: {
        operation_id: "upload-image-reference" as const,
        schema_hash: uploadProfile.upload_profile_schema_hash,
        hash_scope: "UPLOAD_ONLY_NOT_GENERATION_PROFILE_SCHEMA" as const
      },
      source_artifacts: SOURCE_ARTIFACTS,
      source_joins: {
        form_to_settings_factory: "USE_LUMA_Z_R_A_R_SOURCE_SETTINGS_CALL" as const,
        actual_style_options: STYLE_OPTIONS,
        handle_chat_files: "MAIN_REFERENCE_FIRST_ORDERED_DEDUPED_SET_FILES_SIDE_EFFECT_ONLY" as const,
        ordinary_sender: "APP_STORE_SETTINGS_NORMAL_VIDEO_SENDER_BRANCH" as const,
        custom_payload: "TRUTHY_CUSTOM_PAYLOAD_REPLACES_NOT_MERGES_DEFAULT_SETTINGS" as const,
        dispatch_and_provider_acceptance: "UNPROVEN" as const
      },
      confidence: SOURCE_CONFIDENCE,
      source_execution: false as const
    },
    parameters_source: parameters,
    model_controls: controls,
    style_options: STYLE_OPTIONS,
    reference_selection: {
      minimum: controls.reference_count.minimum,
      maximum: controls.reference_count.maximum,
      confidence: "SOURCE_UI_SELECTION_RULE_NOT_OWNERSHIP_OR_PROVIDER_PERMISSION" as const,
      owned_references_bound: false as const,
      canonical_url_deduplication: "ASSET_ISSUER_CHECK_NOT_THIS_SOURCE_PROFILE" as const
    },
    cost_routing: {
      ai_name: "luma_image" as const,
      model_type: modelInput,
      declared_parameter_keys: ["model_type"] as const,
      cost_inputs: Object.freeze({}),
      projection: "ROUTING_ONLY_NOT_QUOTE_BILLING_OR_ADMISSION" as const
    },
    cost_projection_status: "NOT_JOINED" as const,
    defaults: "NOT_INJECTED" as const,
    effective_defaults: "UNKNOWN_SOURCE_INITIALIZERS_NOT_RUNTIME_DEFAULTS" as const,
    generation_readiness: "SOURCE_PROFILE_ONLY_NOT_GENERATION_ADMISSION" as const,
    dispatch_allowed: false as const,
    runtime_activation: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
  return deepFreeze({ ...base, profile_schema_hash: schemaHash(base) }) as Readonly<OwnerUniImageSourceProfile>;
}

function assertParameters(parameters: OwnerUniImageSourceParameters): void {
  if (!sameJson(parameters.models, OWNER_UNI_IMAGE_MODELS) || parameters.profile_id !== "owner-uni-image-source-parameters-v1" ||
      parameters.source_pins.public_catalog_version !== CATALOG_VERSION ||
      parameters.source_pins.use_luma_module !== "useLuma.js" || parameters.source_pins.use_luma_build_id !== "1791467421" ||
      parameters.source_pins.use_luma_bytes !== 4_865 || parameters.source_pins.use_luma_sha256 !== SOURCE_ARTIFACTS.uni_source_helper.sha256 ||
      parameters.source_pins.seed_helper_sha256 !== SOURCE_ARTIFACTS.seed_helper.sha256 || parameters.source_pins.seed_helper_executed !== false ||
      parameters.defaults !== "NOT_INJECTED" || parameters.dispatch_allowed !== false || parameters.runtime_activation !== false ||
      parameters.backend_acceptance !== "UNPROVEN") fail("PROFILE_BINDING_MISMATCH");
}

function sameJson(left: unknown, right: unknown): boolean {
  try { return schemaHash(left) === schemaHash(right); } catch { return false; }
}
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !isProxy(value) && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]!);
    Object.freeze(value);
  }
  return value;
}
function isModel(value: unknown): value is OwnerUniImageModelId {
  return typeof value === "string" && OWNER_UNI_IMAGE_MODELS.includes(value as OwnerUniImageModelId);
}
function fail(code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH"): never {
  throw new OwnerUniImageSourceProfileError(code);
}
