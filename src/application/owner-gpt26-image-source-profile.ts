import { isProxy } from "node:util/types";
import { schemaHash } from "../domain/generation-contract.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { OWNER_GPT26_IMAGE_SOURCE_CONTROLS, OWNER_GPT26_IMAGE_VARIANTS, type OwnerGpt26ImageVariant } from "./owner-gpt26-image-parameters.js";

export const OWNER_GPT26_PUBLIC_CATALOG_VERSION = "sha256-49f41bb1565932456137e2a264a2904c441a95e9f5e0aa2a76a9a0c503fedc13.json" as const;
const FETCHED_AT = "2026-11-10T12:33:30.557Z";
const SOURCE_HASHES = Object.freeze({
  ai: "sha256:381033bd1dca13daa6642276bbdb3508edf71d33d2898b230f5179c179a25985",
  llm_models: "sha256:c2237748fac638cc43937809b651f17bc78a4f9ae95220ec28c1682999f55cfa",
  models: "sha256:24bbc57596f4d3aa33e72f8bd8004f72ff1eb769e33675a71eedc75a586d9252"
});
const MIME = Object.freeze(["image/jpeg", "image/jpg", "image/avif", "image/webp", "image/png"]);
const COST = Object.freeze(["quality", "details_quality", "ref_count", "output_format"]);
const EXPECTED_SETTINGS = Object.freeze({
  accepted_file_types: MIME, allowed_media_types: Object.freeze(["images"]), attach_info_text: null,
  file_count_limit: 16, get_cost_params: COST, max_dimension: 8000,
  max_file_size: 33_554_432, max_height: 8000, max_image_dimension: 8400,
  max_image_file_size: 27_525_120, max_image_height: 8000, max_image_pixel_count: 52_500_000,
  max_image_width: 8000, max_prompt_length: 0, max_total_file_size: 83_886_080,
  max_width: 8000, uploadable: true
});

export interface OwnerGpt26ImageSourceProfile {
  readonly profile_id: "gpt-image-26-source-reviewed-v1";
  readonly model_id: OwnerGpt26ImageVariant;
  readonly variant: OwnerGpt26ImageVariant;
  readonly model_type: OwnerGpt26ImageVariant;
  readonly ai_name: "sora-images";
  readonly scope: "image";
  readonly operation_id: "generate-image";
  readonly public_catalog_version: typeof OWNER_GPT26_PUBLIC_CATALOG_VERSION;
  readonly public_default: false;
  readonly source_binding: Readonly<Record<string, unknown>>;
  readonly public_settings: Readonly<typeof EXPECTED_SETTINGS>;
  readonly reference_count: Readonly<{ minimum: 0; maximum: 16 }>;
  readonly max_total_file_size: 83_886_080;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_schema_hash: string;
}

export class OwnerGpt26ImageSourceProfileError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH") {
    super("GPT Image 2.6 source profile could not be verified.");
    this.name = "OwnerGpt26ImageSourceProfileError";
  }
}

export function getOwnerGpt26ImageSourceProfile(
  variant: unknown,
  catalog: Pick<DiscoveryCatalogRepository, "getModel" | "fetched_at" | "source_hashes" | "catalog_metadata">,
  catalogVersion: unknown
): Readonly<OwnerGpt26ImageSourceProfile> {
  if (!OWNER_GPT26_IMAGE_VARIANTS.includes(variant as OwnerGpt26ImageVariant)) fail("INVALID_REQUEST");
  if (catalogVersion !== OWNER_GPT26_PUBLIC_CATALOG_VERSION || !catalog || typeof catalog !== "object" || isProxy(catalog) ||
      !(catalog instanceof DiscoveryCatalogRepository) || Object.getPrototypeOf(catalog) !== DiscoveryCatalogRepository.prototype ||
      catalog.getModel !== DiscoveryCatalogRepository.prototype.getModel) fail("PROFILE_BINDING_MISMATCH");
  let model: ReturnType<DiscoveryCatalogRepository["getModel"]>;
  try { model = catalog.getModel(variant as OwnerGpt26ImageVariant); } catch { fail("PROFILE_BINDING_MISMATCH"); }
  if (!model || isProxy(model) || model.id !== variant || model.upstream_id !== variant ||
      model.ai_name !== "sora-images" || model.active !== true || model.default !== false ||
      model.scope !== "image" || model.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" ||
      model.runtime_usable !== false || model.fetched_at !== FETCHED_AT ||
      !same(model.source_hashes, SOURCE_HASHES) || !same(catalog.source_hashes, SOURCE_HASHES) ||
      catalog.fetched_at !== FETCHED_AT || !catalog.catalog_metadata || catalog.catalog_metadata.fetched_at !== FETCHED_AT ||
      !same(catalog.catalog_metadata.source_hashes, SOURCE_HASHES) ||
      catalog.catalog_metadata.public_settings_coverage !== "ALLOWLISTED_PUBLIC_API_FIELDS" ||
      !same(model.modalities, ["image"]) ||
      !same(model.operations.map(op => [op.id, op.output_modality, op.derivation]), [["generate-image", "image", "PUBLIC_AI_SCOPE"]]) ||
      !same(model.settings, EXPECTED_SETTINGS)) fail("PROFILE_BINDING_MISMATCH");
  const sourceBinding = Object.freeze({
    public_catalog_version: OWNER_GPT26_PUBLIC_CATALOG_VERSION,
    public_catalog_fetched_at: FETCHED_AT,
    public_source_hashes: SOURCE_HASHES,
    settings_version: "sha256-0a03f8d27f72361e8ca6cff628e2a6245e8fca11b338d0c996ecf71c79b43c32.json",
    settings_build: "1794311734",
    form_sha256: OWNER_GPT26_IMAGE_SOURCE_CONTROLS.form_sha256,
    app_sha256: "sha256:ee9b82ef3997b7a9981aefc0e294870bf656c89c26ac904e46a4b4e4e5cbf323",
    evidence: OWNER_GPT26_IMAGE_SOURCE_CONTROLS.source_evidence
  });
  const base = {
    profile_id: "gpt-image-26-source-reviewed-v1" as const,
    model_id: variant as OwnerGpt26ImageVariant, variant: variant as OwnerGpt26ImageVariant,
    model_type: variant as OwnerGpt26ImageVariant, ai_name: "sora-images" as const,
    scope: "image" as const, operation_id: "generate-image" as const,
    public_catalog_version: OWNER_GPT26_PUBLIC_CATALOG_VERSION, public_default: false as const,
    source_binding: sourceBinding, public_settings: EXPECTED_SETTINGS,
    reference_count: Object.freeze({ minimum: 0 as const, maximum: 16 as const }),
    max_total_file_size: 83_886_080 as const,
    dispatch_allowed: false as const, backend_acceptance: "UNPROVEN" as const
  };
  return Object.freeze({ ...base, profile_schema_hash: schemaHash(base) });
}

function same(a: unknown, b: unknown): boolean { try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; } }
function fail(code: OwnerGpt26ImageSourceProfileError["code"]): never { throw new OwnerGpt26ImageSourceProfileError(code); }
