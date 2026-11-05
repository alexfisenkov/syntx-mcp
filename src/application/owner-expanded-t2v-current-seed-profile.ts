import { createHash } from "node:crypto";
import { types } from "node:util";
import { loadSelectedDiscoveryCatalog } from "../catalog/selected-discovery-catalog.js";
import { createGenerationContractRegistryV2, serializeGenerationContractRegistryV2, type GenerationContractV2Input } from "../domain/generation-contract-v2.js";
import { createOwnerExpandedT2vProfiles, type OwnerExpandedT2vSourceContract } from "./owner-expanded-t2v-profile.js";
import type { OwnerReviewedNoReferenceT2vProfile } from "./owner-hailuo01-t2v-profile.js";
import { isOwnerRunwayCurrentSeed } from "./owner-runway-current-controls.js";

export const OWNER_EXPANDED_CURRENT_SEED_MODELS = ["happy_horse_t2v", "text2video-4.5"] as const;
export type OwnerExpandedCurrentSeedModel = typeof OWNER_EXPANDED_CURRENT_SEED_MODELS[number];
const PUBLIC_VERSION = "sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json";

export function getOwnerExpandedT2vCurrentSeedControls(modelId: OwnerExpandedCurrentSeedModel) {
  return Object.freeze({ status: "FORM_SOURCE_REVIEWED", model_id: modelId, source_build_id: "1793890358",
    public_version: PUBLIC_VERSION, settings_version: "sha256-4da7d12483291bb632aa21e0deb220142994fe061999d2f246318276964fa187.json",
    form_sha256: modelId === "text2video-4.5" ? "sha256:82ea97e101804712f960f40933573911fb3bba028973ba6ec2431149c4691951" :
      "sha256:928a3d5a0f19b62cab13b8e85d5e4b7aabceab03db0dbb3d1f87e90c181d0c21",
    random_seed_sha256: "sha256:c95fc355e29e33f6c3998cb62cc2da4d0879cc1ff4fb524e826e74bb24cd792b",
    sender_sha256: "sha256:b8fab1b729a53f72c815aa88bffca1701db42735d7e57190d9176791263f6684",
    seed: Object.freeze({ minimum: 0, maximum: 2147483647, integer: true, nullable: true, random_toggle_value: null }),
    ...(modelId === "happy_horse_t2v" ? { video_duration: Object.freeze({ minimum: 3, maximum: 15,
      manual_fractions: true, slider_step: 1, step_is_not_quantization: true,
      slider_sha256: "sha256:77bef1b40ab7d4bce97d12e360b17961467f7315c0d83d6290a2f0ee1d37ee46" }) } : {}),
    provider_acceptance: "UNPROVEN", frontend_source_execution: false });
}

/** A separate source-only branch; omitted seed keeps the immutable historical six-model registry. */
export function createOwnerExpandedT2vCurrentSeedProfile(modelId: OwnerExpandedCurrentSeedModel, catalogDirectory?: string):
OwnerReviewedNoReferenceT2vProfile<OwnerExpandedT2vSourceContract & { readonly current_controls: ReturnType<typeof getOwnerExpandedT2vCurrentSeedControls> }> {
  if (!(OWNER_EXPANDED_CURRENT_SEED_MODELS as readonly unknown[]).includes(modelId)) throw new Error("INVALID_CURRENT_SEED_MODEL");
  const legacy = createOwnerExpandedT2vProfiles(catalogDirectory).get(modelId)!;
  const catalog = loadSelectedDiscoveryCatalog(PUBLIC_VERSION, catalogDirectory).discoveryCatalog;
  const model = catalog.getModel(modelId), controls = getOwnerExpandedT2vCurrentSeedControls(modelId);
  if (!model.active || model.ai_name !== legacy.aiName || catalog.source_hashes.models !== "sha256:11f085ad9b0dd97435d6ebece623fa85bce2870e714e876e6fbb041c562fb438" ||
    JSON.stringify(model.settings?.get_cost_params) !== JSON.stringify(legacy.costParameterFields)) throw new Error("CURRENT_SEED_SOURCE_INVALID");
  const variantId = `expanded-t2v-${modelId}-current-seed-v1`;
  const build = (reviewedAt: string): GenerationContractV2Input => {
    const old = legacy.buildContractInput(reviewedAt);
    return { ...old, variant_id: variantId,
      provenance: { settings_source_sha256: controls.form_sha256, reviewed_at: reviewedAt, references: [
        { kind: "public_catalog", reference: `Current source controls joined to ${PUBLIC_VERSION}`, sha256: catalog.source_hashes.models },
        { kind: "frontend_static", reference: "Current form direct seed binding without per-model overrides", sha256: controls.form_sha256 },
        { kind: "frontend_static", reference: "RandomSeed nullable integer input, precision0, min0/max2147483647", sha256: controls.random_seed_sha256 },
        { kind: "frontend_static", reference: "video.js first-submit settings spread", sha256: controls.sender_sha256 },
        { kind: "manual_review", reference: "FORM_SOURCE_REVIEWED only; no observed provider tuple transferred." }
      ] },
      parameters: { ...old.parameters, required: [...old.parameters.required, "seed"],
        properties: { ...old.parameters.properties,
          ...(modelId === "happy_horse_t2v" ? { video_duration: { type: "number" as const, minimum: 3, maximum: 15 } } : {}),
          seed: { type: "integer", minimum: 0, maximum: 2147483647, nullable: true } } },
      wire: { ...old.wire, settings_fields: { ...old.wire.settings_fields, seed: "seed" } },
      limits: { ...old.limits, max_parameters: old.limits.max_parameters + 1 }
    };
  };
  const registry = createGenerationContractRegistryV2({ schema_version: "2.0.0", catalog_version: `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`,
    source_hashes: catalog.source_hashes, contracts: [build("2026-11-06T00:00:00.000Z")] });
  const registryVersion = `sha256-${createHash("sha256").update(serializeGenerationContractRegistryV2(registry)).digest("hex")}.json`;
  return Object.freeze({ catalog, registry, registryVersion, modelId, aiName: legacy.aiName, modelType: modelId,
    operationId: "generate-video", variantId, costParameterFields: legacy.costParameterFields,
    source: Object.freeze({ ...legacy.source, current_controls: controls }), buildContractInput: build,
    normalizeGenerationInput(value: unknown) {
      if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new Error("INVALID_REQUEST");
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(descriptors).some(key =>
        typeof key !== "string" || !descriptors[key]!.enumerable || !("value" in descriptors[key]!))) throw new Error("INVALID_REQUEST");
      const fields = Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
      const fractionalDuration = modelId === "happy_horse_t2v" && typeof fields.video_duration === "number" && !Number.isInteger(fields.video_duration);
      const seed = Object.hasOwn(fields, "seed") ? fields.seed : fractionalDuration ? null : undefined;
      if (!isOwnerRunwayCurrentSeed(seed) || modelId === "happy_horse_t2v" &&
        (typeof fields.video_duration !== "number" || !Number.isFinite(fields.video_duration) || fields.video_duration < 3 || fields.video_duration > 15)) throw new Error("INVALID_REQUEST");
      const { seed: _seed, ...withoutSeed } = fields;
      const normalized = legacy.normalizeGenerationInput(fractionalDuration ? { ...withoutSeed, video_duration: 5 } : withoutSeed);
      const duration = fractionalDuration ? { video_duration: fields.video_duration } : {};
      return Object.freeze({ ...normalized, parameters: Object.freeze({ ...normalized.parameters, ...duration, seed }),
        semanticIntent: Object.freeze({ ...normalized.semanticIntent, ...duration, seed: seed === null ? "RANDOM_NULL" : seed }) });
    }
  });
}
