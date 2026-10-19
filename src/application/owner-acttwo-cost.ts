import { types } from "node:util";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../catalog/public-catalog-history.js";
import { schemaHash } from "../domain/generation-contract.js";
import { getOwnerActTwoSourceProfile } from "./owner-acttwo-parameters.js";

export const OWNER_ACTTWO_RUNTIME_CATALOG_VERSION =
  "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json" as const;
const COST_KEYS = Object.freeze(["video_duration"] as const);

export interface OwnerActTwoCostParametersInput {
  readonly model_id: "acttwo";
  readonly video_duration: 5;
}
export interface OwnerActTwoCostParameters { readonly video_duration: 5 }
export interface OwnerActTwoCostBinding {
  readonly model_id: "acttwo";
  readonly ai_name: "runway";
  readonly scope: "video";
  readonly cost_keys: readonly ["video_duration"];
}
export interface OwnerActTwoRuntimeCatalog {
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: typeof OWNER_ACTTWO_RUNTIME_CATALOG_VERSION;
  readonly cost_bindings: readonly Readonly<OwnerActTwoCostBinding>[];
}

export class OwnerActTwoCostParametersError extends Error {
  constructor(readonly code: "INVALID_COST_PARAMETERS") {
    super("The ActTwo measured-duration cost parameters are invalid.");
    this.name = "OwnerActTwoCostParametersError";
  }
}

/** Emits the sole public cost key from the measured performance-video duration. */
export function buildOwnerActTwoCostParameters(input: unknown): Readonly<OwnerActTwoCostParameters> {
  const fields = exactRecord(input, ["model_id", "video_duration"]);
  if (fields.model_id !== "acttwo" || fields.video_duration !== 5) invalidCostParameters();
  return Object.freeze({ video_duration: 5 });
}

/** Loads the pinned public row and checks exact ActTwo catalog identity and upload bounds. */
export function loadOwnerActTwoRuntimeCatalog(catalogDirectory?: string): Readonly<OwnerActTwoRuntimeCatalog> {
  try {
    const profile = getOwnerActTwoSourceProfile();
    if (profile.public_catalog_version !== OWNER_ACTTWO_RUNTIME_CATALOG_VERSION) throw new Error("OWNER_ACTTWO_PROFILE_CATALOG_MISMATCH");
    const snapshot = loadPublicCatalogVersion(OWNER_ACTTWO_RUNTIME_CATALOG_VERSION, catalogDirectory);
    const catalog = new DiscoveryCatalogRepository(snapshot);
    const ai = snapshot.ai.find(row => row.value === "runway");
    const model = catalog.getModel("acttwo"), settings = model.settings, keys = settings?.get_cost_params;
    if (!ai?.active || ai.scope !== "video" || !model.active || model.id !== "acttwo" || model.upstream_id !== "acttwo" ||
        model.ai_name !== "runway" || !settings || !Array.isArray(keys) || keys.length !== 1 || keys[0] !== "video_duration" ||
        settings.max_prompt_length !== 0 || settings.min_prompt_length !== 0 || settings.max_file_size !== 20 * 1024 * 1024 ||
        settings.max_video_duration !== 30 || settings.uploadable !== true ||
        !Array.isArray(settings.allowed_media_types) || settings.allowed_media_types.length !== 1 || settings.allowed_media_types[0] !== "videos" ||
        schemaHash(settings.file_count_limit) !== schemaHash({ videos: 1 })) throw new Error("OWNER_ACTTWO_CATALOG_BINDING_MISMATCH");
    const costBindings = Object.freeze([Object.freeze({ model_id: "acttwo" as const, ai_name: "runway" as const,
      scope: "video" as const, cost_keys: COST_KEYS })]);
    return Object.freeze({ catalog, catalog_version: OWNER_ACTTWO_RUNTIME_CATALOG_VERSION, cost_bindings: costBindings });
  } catch (error) {
    if (error instanceof OwnerActTwoCostParametersError) throw error;
    throw new OwnerActTwoCostParametersError("INVALID_COST_PARAMETERS");
  }
}

function exactRecord(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalidCostParameters();
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== required.length ||
        required.some(key => !Object.hasOwn(descriptors, key)) || keys.some(key => typeof key !== "string" || !required.includes(key) ||
          !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalidCostParameters();
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch { return invalidCostParameters(); }
}
function invalidCostParameters(): never { throw new OwnerActTwoCostParametersError("INVALID_COST_PARAMETERS"); }
