import { types } from "node:util";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../catalog/public-catalog-history.js";
import type { OwnerRunwayI2vModelId, OwnerRunwayI2vVideoDuration } from "./owner-runway-i2v-parameters.js";
import { getOwnerRunwayI2vSourceProfile } from "./owner-runway-i2v-parameters.js";

export const OWNER_RUNWAY_I2V_RUNTIME_CATALOG_VERSION =
  "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json" as const;
const AI_NAME = "runway" as const;
const FORM_ID = "runway" as const;
const FORM_SCOPE = "video" as const;
const COST_KEYS = Object.freeze(["video_duration"] as const);
const MODEL_IDS = getOwnerRunwayI2vSourceProfile().model_ids;

export interface OwnerRunwayI2vCostParametersInput {
  readonly model_id: OwnerRunwayI2vModelId;
  readonly video_duration: OwnerRunwayI2vVideoDuration;
}

export interface OwnerRunwayI2vCostParameters {
  readonly video_duration: "5.0" | "8.0" | "10.0";
}

export interface OwnerRunwayI2vCostBinding {
  readonly model_id: OwnerRunwayI2vModelId;
  readonly model_type: OwnerRunwayI2vModelId;
  readonly ai_name: typeof AI_NAME;
  readonly form_id: typeof FORM_ID;
  readonly scope: typeof FORM_SCOPE;
  readonly cost_keys: typeof COST_KEYS;
}

export interface OwnerRunwayI2vRuntimeCatalog {
  readonly catalog: DiscoveryCatalogRepository;
  /** Immutable local archive filename, not the live model-access catalog revision. */
  readonly catalog_version: typeof OWNER_RUNWAY_I2V_RUNTIME_CATALOG_VERSION;
  readonly cost_bindings: readonly Readonly<OwnerRunwayI2vCostBinding>[];
}

export class OwnerRunwayI2vCostParametersError extends Error {
  constructor(readonly code: "INVALID_COST_PARAMETERS") {
    super("The Runway first-frame cost parameters are invalid.");
    this.name = "OwnerRunwayI2vCostParametersError";
  }
}

/** Emits only the archived form's one cost key; model identity travels separately. */
export function buildOwnerRunwayI2vCostParameters(
  input: OwnerRunwayI2vCostParametersInput
): Readonly<OwnerRunwayI2vCostParameters> {
  try {
    const row = exactRecord(input, ["model_id", "video_duration"]);
    if (!isModelId(row.model_id) || !isAllowedDuration(row.model_id, row.video_duration)) invalid();
    return Object.freeze({ video_duration: row.video_duration === 5 ? "5.0" : row.video_duration === 8 ? "8.0" : "10.0" });
  } catch (error) {
    if (error instanceof OwnerRunwayI2vCostParametersError) throw error;
    return invalid();
  }
}

/** Loads and verifies the pinned public archive; no live source or fabricated model metadata is used. */
export function loadOwnerRunwayI2vRuntimeCatalog(catalogDirectory?: string): Readonly<OwnerRunwayI2vRuntimeCatalog> {
  const catalogVersion = OWNER_RUNWAY_I2V_RUNTIME_CATALOG_VERSION;
  const snapshot = loadPublicCatalogVersion(catalogVersion, catalogDirectory);
  const catalog = new DiscoveryCatalogRepository(snapshot);
  const runwayAi = snapshot.ai.find((entry) => entry.value === AI_NAME);
  if (!runwayAi?.active || runwayAi.scope !== FORM_SCOPE) throw new Error("OWNER_RUNWAY_I2V_CATALOG_BINDING_MISMATCH");

  const bindings = MODEL_IDS.map((modelId) => {
    const model = catalog.get(modelId);
    const keys = model.settings?.get_cost_params;
    if (!model.active || model.id !== modelId || model.upstream_id !== modelId || model.ai_name !== AI_NAME ||
        !Array.isArray(keys) || keys.length !== COST_KEYS.length || keys.some((key, index) => key !== COST_KEYS[index])) {
      throw new Error("OWNER_RUNWAY_I2V_CATALOG_BINDING_MISMATCH");
    }
    if (modelId === "gen4.5i2v") {
      const settings = model.settings;
      if (!settings || settings.max_file_size !== 0 || settings.max_prompt_length !== 1_000 || settings.file_count_limit !== 1 ||
          settings.uploadable !== true || !Array.isArray(settings.allowed_media_types) || settings.allowed_media_types.length !== 1 ||
          settings.allowed_media_types[0] !== "images" || !Array.isArray(settings.accepted_file_types) ||
          !["image/jpeg", "image/jpg", "image/avif", "image/webp", "image/png"].every(type => settings.accepted_file_types!.includes(type))) {
        throw new Error("OWNER_RUNWAY_I2V_CATALOG_BINDING_MISMATCH");
      }
    }
    return Object.freeze({ model_id: modelId, model_type: modelId, ai_name: AI_NAME, form_id: FORM_ID,
      scope: FORM_SCOPE, cost_keys: COST_KEYS });
  });
  return Object.freeze({ catalog, catalog_version: catalogVersion, cost_bindings: Object.freeze(bindings) });
}

function exactRecord(input: unknown, required: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) invalid();
  try {
    const prototype = Object.getPrototypeOf(input);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== required.length ||
        required.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) =>
          typeof key !== "string" || !required.includes(key) || !Object.hasOwn(descriptors[key]!, "value") ||
          descriptors[key]!.enumerable !== true)) invalid();
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch { return invalid(); }
}

function isModelId(value: unknown): value is OwnerRunwayI2vModelId {
  return typeof value === "string" && (MODEL_IDS as readonly string[]).includes(value);
}

function isAllowedDuration(modelId: OwnerRunwayI2vModelId, value: unknown): value is OwnerRunwayI2vVideoDuration {
  return modelId === "gen4.5i2v" ? value === 5 || value === 8 || value === 10 : value === 5 || value === 10;
}

function invalid(): never { throw new OwnerRunwayI2vCostParametersError("INVALID_COST_PARAMETERS"); }
