import { types } from "node:util";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../catalog/public-catalog-history.js";
import {
  isOwnerGrokI2vModelId,
  isOwnerGrokI2vVideoDuration,
  type OwnerGrokI2vModelId,
  type OwnerGrokI2vResolution,
  type OwnerGrokI2vVideoDuration
} from "./owner-grok-i2v-parameters.js";
import { getOwnerGrokI2vSourceProfile } from "./owner-grok-i2v-parameters.js";

export const OWNER_GROK_I2V_RUNTIME_CATALOG_VERSION =
  "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json" as const;
const AI_NAME = "grok_video" as const;
const FORM_ID = "grok-video" as const;
const FORM_SCOPE = "video" as const;
const COST_KEYS = Object.freeze(["resolution", "video_duration"] as const);
const MODEL_IDS = getOwnerGrokI2vSourceProfile().model_ids;

export interface OwnerGrokI2vCostParametersInput {
  readonly model_id: OwnerGrokI2vModelId;
  readonly video_duration: OwnerGrokI2vVideoDuration;
  readonly resolution: OwnerGrokI2vResolution;
}
export interface OwnerGrokI2vCostParameters {
  readonly model_id: OwnerGrokI2vModelId;
  readonly routing: Readonly<{ ai_name: typeof AI_NAME; model_type: OwnerGrokI2vModelId }>;
  readonly cost_inputs: Readonly<{
    readonly resolution: OwnerGrokI2vResolution;
    readonly video_duration: OwnerGrokI2vVideoDuration;
  }>;
  readonly source_binding: Readonly<{
    readonly form_id: typeof FORM_ID;
    readonly form_build_id: "1792363638";
    readonly form_sha256: string;
    readonly public_catalog_version: typeof OWNER_GROK_I2V_RUNTIME_CATALOG_VERSION;
    readonly cost_keys: typeof COST_KEYS;
  }>;
  readonly confidence: "FORM_CALLSITE_AND_PINNED_PUBLIC_COST_KEYS_NOT_QUOTE_BILLING_OR_HARDCAP";
  readonly dispatch_allowed: false;
  readonly runtime_usable: false;
  readonly backend_acceptance: "UNPROVEN";
}
export interface OwnerGrokI2vCostBinding {
  readonly model_id: OwnerGrokI2vModelId;
  readonly model_type: OwnerGrokI2vModelId;
  readonly ai_name: typeof AI_NAME;
  readonly form_id: typeof FORM_ID;
  readonly scope: typeof FORM_SCOPE;
  readonly cost_keys: typeof COST_KEYS;
}
export interface OwnerGrokI2vRuntimeCatalog {
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: typeof OWNER_GROK_I2V_RUNTIME_CATALOG_VERSION;
  readonly cost_bindings: readonly Readonly<OwnerGrokI2vCostBinding>[];
}
export class OwnerGrokI2vCostParametersError extends Error {
  constructor(readonly code: "INVALID_COST_PARAMETERS") {
    super("Grok I2V cost parameters are invalid.");
    this.name = "OwnerGrokI2vCostParametersError";
  }
}
export class OwnerGrokI2vCatalogBindingError extends Error {
  constructor(readonly code: "MODEL_BINDING_MISMATCH") {
    super("The pinned Grok I2V catalog binding is invalid.");
    this.name = "OwnerGrokI2vCatalogBindingError";
  }
}

/** Emits only the two pinned model-info query keys; model identity is routed separately. */
export function buildOwnerGrokI2vCostParameters(input: unknown): Readonly<OwnerGrokI2vCostParameters> {
  let row: Record<string, unknown>;
  try { row = exactRecord(input, ["model_id", "video_duration", "resolution"]); }
  catch { return invalidCost(); }
  if (!isOwnerGrokI2vModelId(row.model_id) || !isOwnerGrokI2vVideoDuration(row.model_id, row.video_duration) ||
      (row.resolution !== "480p" && row.resolution !== "720p")) invalidCost();
  const profile = getOwnerGrokI2vSourceProfile();
  return Object.freeze({
    model_id: row.model_id,
    routing: Object.freeze({ ai_name: AI_NAME, model_type: row.model_id }),
    cost_inputs: Object.freeze({ resolution: row.resolution, video_duration: row.video_duration }),
    source_binding: Object.freeze({
      form_id: FORM_ID,
      form_build_id: "1792363638",
      form_sha256: profile.source_pins.form_sha256,
      public_catalog_version: OWNER_GROK_I2V_RUNTIME_CATALOG_VERSION,
      cost_keys: COST_KEYS
    }),
    confidence: "FORM_CALLSITE_AND_PINNED_PUBLIC_COST_KEYS_NOT_QUOTE_BILLING_OR_HARDCAP",
    dispatch_allowed: false,
    runtime_usable: false,
    backend_acceptance: "UNPROVEN"
  });
}

/** Loads the pinned public archive locally and binds both `.value` model IDs to the exact cost-key set. */
export function loadOwnerGrokI2vRuntimeCatalog(catalogDirectory?: string): Readonly<OwnerGrokI2vRuntimeCatalog> {
  try {
    const snapshot = loadPublicCatalogVersion(OWNER_GROK_I2V_RUNTIME_CATALOG_VERSION, catalogDirectory);
    const catalog = new DiscoveryCatalogRepository(snapshot);
    const ai = snapshot.ai.find((entry) => entry.value === AI_NAME);
    if (!ai?.active || ai.scope !== FORM_SCOPE) return invalidCatalog();
    const bindings = MODEL_IDS.map((modelId) => {
      const model = catalog.get(modelId);
      const actual = model.settings?.get_cost_params;
      if (!model.active || model.id !== modelId || model.upstream_id !== modelId || model.ai_name !== AI_NAME ||
          !Array.isArray(actual) || actual.length !== COST_KEYS.length ||
          [...actual].sort().some((key, index) => key !== COST_KEYS[index])) return invalidCatalog();
      return Object.freeze({ model_id: modelId, model_type: modelId, ai_name: AI_NAME, form_id: FORM_ID,
        scope: FORM_SCOPE, cost_keys: COST_KEYS });
    });
    return Object.freeze({ catalog, catalog_version: OWNER_GROK_I2V_RUNTIME_CATALOG_VERSION,
      cost_bindings: Object.freeze(bindings) });
  } catch (error) {
    if (error instanceof OwnerGrokI2vCatalogBindingError) throw error;
    return invalidCatalog();
  }
}

function exactRecord(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return invalidCost();
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== required.length ||
        required.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) =>
          typeof key !== "string" || !required.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) return invalidCost();
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch { return invalidCost(); }
}
function invalidCost(): never { throw new OwnerGrokI2vCostParametersError("INVALID_COST_PARAMETERS"); }
function invalidCatalog(): never { throw new OwnerGrokI2vCatalogBindingError("MODEL_BINDING_MISMATCH"); }
