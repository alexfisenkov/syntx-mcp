import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { DiscoveryCatalogRepository as DiscoveryCatalogRepositoryClass } from "../catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../catalog/public-catalog-history.js";
import type {
  OwnerSeedanceEditorNormalizedParameters
} from "./owner-seedance-editor-parameters.js";
import {
  getOwnerSeedanceEditorSourceProfile,
  normalizeOwnerSeedanceEditorParameters
} from "./owner-seedance-editor-parameters.js";

export const OWNER_SEEDANCE_EDITOR_RUNTIME_CATALOG_VERSION =
  "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json" as const;
const PUBLIC_MODEL_ID = "seedance-2.5" as const;
const PUBLIC_AI_NAME = "seedance" as const;
const EDITOR_AI_NAME = "seedance-editor" as const;
const EDITOR_SCOPE = "tool_video_inpaint" as const;
const REQUIRED_COST_KEYS = Object.freeze(["duration", "mode", "resolution", "size", "video_duration"] as const);
const MIN_SOURCE_DURATION_SECONDS = 4;
const MAX_SOURCE_DURATION_SECONDS = 30;

export interface OwnerSeedanceEditorCostParameters {
  readonly video_duration: 0;
  readonly duration: string;
  readonly mode: "edit";
  readonly size: "adaptive";
  readonly resolution: OwnerSeedanceEditorNormalizedParameters["intent"]["resolution"];
}

export interface OwnerSeedanceEditorCostBinding {
  readonly public_model_id: "seedance-2.5";
  readonly model_type: "seedance-2.5";
  readonly ai_name: "seedance";
  readonly form_id: "seedance-editor";
  readonly scope: "tool_video_inpaint";
  readonly cost_keys: readonly ["duration", "mode", "resolution", "size", "video_duration"];
}

export interface OwnerSeedanceEditorRuntimeCatalog {
  readonly catalog: DiscoveryCatalogRepository;
  /** Immutable archive filename, NOT ModelAccessService's fetched_at.hash runtime revision. */
  readonly catalog_version: typeof OWNER_SEEDANCE_EDITOR_RUNTIME_CATALOG_VERSION;
  readonly cost_binding: Readonly<OwnerSeedanceEditorCostBinding>;
}

export class OwnerSeedanceEditorCostParametersError extends Error {
  constructor(readonly code: "INVALID_SOURCE_DURATION") {
    super("The source duration is outside the supported Seedance Editor cost range.");
    this.name = "OwnerSeedanceEditorCostParametersError";
  }
}

/** Projects the no-extra-media form cost tuple from explicit controls and source duration metadata. */
export function buildOwnerSeedanceEditorCostParameters(
  input: unknown,
  sourceDurationSeconds: number
): Readonly<OwnerSeedanceEditorCostParameters> {
  const normalized = normalizeOwnerSeedanceEditorParameters(input);
  if (typeof sourceDurationSeconds !== "number" || !Number.isFinite(sourceDurationSeconds) ||
      sourceDurationSeconds < MIN_SOURCE_DURATION_SECONDS || sourceDurationSeconds > MAX_SOURCE_DURATION_SECONDS) {
    throw new OwnerSeedanceEditorCostParametersError("INVALID_SOURCE_DURATION");
  }

  return Object.freeze({
    video_duration: 0,
    duration: sourceDurationSeconds.toFixed(2),
    mode: "edit",
    size: "adaptive",
    resolution: normalized.intent.resolution
  });
}

/** Loads the pinned public archive and returns a source-derived cost binding, never dispatch authority. */
export function loadOwnerSeedanceEditorRuntimeCatalog(
  catalogDirectory?: string
): Readonly<OwnerSeedanceEditorRuntimeCatalog> {
  const catalogVersion = OWNER_SEEDANCE_EDITOR_RUNTIME_CATALOG_VERSION;
  const snapshot = loadPublicCatalogVersion(catalogVersion, catalogDirectory);
  const catalog = new DiscoveryCatalogRepositoryClass(snapshot);
  const publicModel = catalog.get(PUBLIC_MODEL_ID);
  const editorAi = snapshot.ai.find((entry) => entry.value === EDITOR_AI_NAME);
  const formModelType = getOwnerSeedanceEditorSourceProfile().form_initializer.model_type;
  const costKeys = publicModel.settings?.get_cost_params;

  if (!publicModel.active || publicModel.id !== PUBLIC_MODEL_ID || publicModel.upstream_id !== PUBLIC_MODEL_ID ||
      publicModel.ai_name !== PUBLIC_AI_NAME || formModelType !== PUBLIC_MODEL_ID ||
      !editorAi?.active || editorAi.scope !== EDITOR_SCOPE || !Array.isArray(costKeys)) {
    throw new Error("OWNER_SEEDANCE_EDITOR_CATALOG_BINDING_MISMATCH");
  }

  const sortedCostKeys = [...costKeys].sort(compareCodeUnits);
  if (sortedCostKeys.length !== REQUIRED_COST_KEYS.length ||
      sortedCostKeys.some((key, index) => key !== REQUIRED_COST_KEYS[index])) {
    throw new Error("OWNER_SEEDANCE_EDITOR_COST_KEYS_MISMATCH");
  }

  const costBinding = Object.freeze({
    public_model_id: PUBLIC_MODEL_ID,
    model_type: formModelType,
    ai_name: PUBLIC_AI_NAME,
    form_id: EDITOR_AI_NAME,
    scope: EDITOR_SCOPE,
    cost_keys: Object.freeze(sortedCostKeys) as unknown as OwnerSeedanceEditorCostBinding["cost_keys"]
  });
  return Object.freeze({ catalog, catalog_version: catalogVersion, cost_binding: costBinding });
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
