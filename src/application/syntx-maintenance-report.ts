import { createHash } from "node:crypto";
import { types } from "node:util";
import {
  maplessSettingsInventorySchema,
  normalizePublicAiNameToFormId,
  type MaplessSettingsInventory
} from "../catalog/mapless-settings-inventory.js";
import {
  canonicalJson,
  serializeSyntxPublicCatalogSnapshot,
  syntxPublicCatalogSnapshotSchema,
  type SyntxPublicCatalogSnapshot
} from "../catalog/syntx-public-catalog.js";

export interface CompareSyntxMaintenanceSnapshotsInput {
  readonly baseline_public: SyntxPublicCatalogSnapshot;
  readonly candidate_public: SyntxPublicCatalogSnapshot;
  readonly baseline_settings?: MaplessSettingsInventory;
  readonly candidate_settings?: MaplessSettingsInventory;
}

export interface SyntxMaintenanceChangedRow {
  readonly id: string;
  readonly changed_keys: readonly string[];
}

export interface SyntxMaintenanceCollectionDelta {
  readonly baseline_count: number;
  readonly candidate_count: number;
  readonly added_ids: readonly string[];
  readonly removed_ids: readonly string[];
  readonly changed: readonly SyntxMaintenanceChangedRow[];
  readonly unchanged_count: number;
}

export type SyntxMaintenancePublicSourceId = "ai" | "models" | "llm_models";

export interface SyntxMaintenancePublicSourceHashChange {
  readonly source_id: SyntxMaintenancePublicSourceId;
  readonly baseline_sha256: string;
  readonly candidate_sha256: string;
}

export interface SyntxMaintenanceSettingsSourceHashChange {
  readonly source_id: string;
  readonly baseline_sha256: string;
  readonly candidate_sha256: string;
}

export interface SyntxMaintenanceFormDelta {
  readonly form_id: string;
  readonly changed_keys: readonly string[];
}

export interface SyntxMaintenancePublicMetadata {
  readonly fetched_at: string;
  readonly source_hashes: Readonly<{
    ai: string;
    models: string;
    llm_models: string;
  }>;
  readonly counts: Readonly<{
    ai: number;
    models: number;
    llm_models: number;
  }>;
}

export interface SyntxMaintenanceSettingsMetadata {
  readonly generated_at: string;
  readonly build_id: string;
  readonly public_version: string;
}

export interface SyntxMaintenanceReportV1 {
  readonly schema_version: "1.0.0";
  readonly status: "COMPARED";
  readonly baseline: Readonly<{
    public: SyntxMaintenancePublicMetadata;
    settings: SyntxMaintenanceSettingsMetadata | null;
  }>;
  readonly candidate: Readonly<{
    public: SyntxMaintenancePublicMetadata;
    settings: SyntxMaintenanceSettingsMetadata | null;
  }>;
  readonly deltas: Readonly<{
    ai: SyntxMaintenanceCollectionDelta;
    models: SyntxMaintenanceCollectionDelta;
    llm_models: SyntxMaintenanceCollectionDelta;
  }>;
  readonly public_source_hashes: Readonly<{
    changed: readonly SyntxMaintenancePublicSourceHashChange[];
    source_hash_only_drift: boolean;
    proof_revalidation_required: boolean;
    affected_model_ids: readonly string[];
  }>;
  readonly settings: Readonly<{
    status: "COMPARED" | "NOT_CHECKED";
    added_form_ids: readonly string[];
    removed_form_ids: readonly string[];
    changed_forms: readonly SyntxMaintenanceFormDelta[];
    changed_helper_ids: readonly string[];
    source_hash_changes: readonly SyntxMaintenanceSettingsSourceHashChange[];
    affected_model_ids: readonly string[];
    impact_status: "NOT_CHECKED" | "NO_CHANGES" | "FORM_BOUND_PARTIAL" | "SHARED_HELPER_PARTIAL";
  }>;
  readonly coverage: Readonly<{
    public_catalog: "COMPARED";
    settings_inventory: "COMPARED" | "NOT_CHECKED";
    account_availability: "NOT_CHECKED";
    rendered_ui: "NOT_CHECKED";
    provider_acceptance: "NOT_CHECKED";
  }>;
  readonly automatic_runtime_promotion: false;
  readonly paid_operations: false;
}

export type SyntxMaintenanceReportErrorCode =
  | "INVALID_PUBLIC_SNAPSHOT"
  | "SETTINGS_PAIR_REQUIRED"
  | "INVALID_SETTINGS_SNAPSHOT"
  | "SETTINGS_PUBLIC_BINDING_MISMATCH"
  | "UNSAFE_INPUT";

const ERROR_MESSAGES: Readonly<Record<SyntxMaintenanceReportErrorCode, string>> = Object.freeze({
  INVALID_PUBLIC_SNAPSHOT: "A public catalog snapshot is invalid.",
  SETTINGS_PAIR_REQUIRED: "Baseline and candidate settings inventories must be supplied together.",
  INVALID_SETTINGS_SNAPSHOT: "A settings inventory snapshot is invalid.",
  SETTINGS_PUBLIC_BINDING_MISMATCH: "A settings inventory is not bound to its public catalog snapshot.",
  UNSAFE_INPUT: "Maintenance snapshots contain unsupported or unsafe input."
});

export class SyntxMaintenanceReportError extends Error {
  constructor(readonly code: SyntxMaintenanceReportErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "SyntxMaintenanceReportError";
  }
}

const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_INPUT_NODES = 2_000_000;
const MAX_INPUT_DEPTH = 48;
const SAFE_FORM_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * Deterministic, local-only comparison. It does not read files, call endpoints,
 * check a user's plan, infer UI/provider acceptance, or promote runtime data.
 */
export function compareSyntxMaintenanceSnapshots(
  input: CompareSyntxMaintenanceSnapshotsInput
): SyntxMaintenanceReportV1 {
  const safeInput = safeCopy(input);
  const inputRecord = parseCompareInput(safeInput);
  const hasBaselineSettings = Object.hasOwn(inputRecord, "baseline_settings");
  const hasCandidateSettings = Object.hasOwn(inputRecord, "candidate_settings");
  if (hasBaselineSettings !== hasCandidateSettings) {
    throw new SyntxMaintenanceReportError("SETTINGS_PAIR_REQUIRED");
  }

  const baselinePublic = parsePublicSnapshot(inputRecord.baseline_public);
  const candidatePublic = parsePublicSnapshot(inputRecord.candidate_public);
  const settingsCompared = hasBaselineSettings && hasCandidateSettings;
  const baselineSettings = settingsCompared
    ? parseSettingsSnapshot(inputRecord.baseline_settings)
    : null;
  const candidateSettings = settingsCompared
    ? parseSettingsSnapshot(inputRecord.candidate_settings)
    : null;

  if (baselineSettings !== null) assertSettingsBinding(baselineSettings, baselinePublic);
  if (candidateSettings !== null) assertSettingsBinding(candidateSettings, candidatePublic);

  const deltas = {
    ai: compareCollection(baselinePublic.ai, candidatePublic.ai, (row) => row.value),
    models: compareCollection(baselinePublic.models, candidatePublic.models, (row) => row.value),
    llm_models: compareCollection(baselinePublic.llm_models, candidatePublic.llm_models, (row) => row.id)
  };
  const changedPublicSources = comparePublicSourceHashes(baselinePublic, candidatePublic);
  const hasPublicRowChanges = [deltas.ai, deltas.models, deltas.llm_models]
    .some((delta) => delta.added_ids.length > 0 || delta.removed_ids.length > 0 || delta.changed.length > 0);
  const settings = baselineSettings !== null && candidateSettings !== null
    ? compareSettingsInventories(baselineSettings, candidateSettings)
    : emptySettingsDelta();

  return Object.freeze({
    schema_version: "1.0.0",
    status: "COMPARED",
    baseline: Object.freeze({
      public: publicMetadata(baselinePublic),
      settings: baselineSettings === null ? null : settingsMetadata(baselineSettings)
    }),
    candidate: Object.freeze({
      public: publicMetadata(candidatePublic),
      settings: candidateSettings === null ? null : settingsMetadata(candidateSettings)
    }),
    deltas: Object.freeze(deltas),
    public_source_hashes: Object.freeze({
      changed: Object.freeze(changedPublicSources),
      source_hash_only_drift: !hasPublicRowChanges && changedPublicSources.length > 0,
      proof_revalidation_required: changedPublicSources.length > 0,
      affected_model_ids: Object.freeze(publicModelsAffectedBySourceChanges(
        baselinePublic,
        candidatePublic,
        changedPublicSources
      ))
    }),
    settings,
    coverage: Object.freeze({
      public_catalog: "COMPARED",
      settings_inventory: settingsCompared ? "COMPARED" : "NOT_CHECKED",
      account_availability: "NOT_CHECKED",
      rendered_ui: "NOT_CHECKED",
      provider_acceptance: "NOT_CHECKED"
    }),
    automatic_runtime_promotion: false,
    paid_operations: false
  });
}

function parseCompareInput(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new SyntxMaintenanceReportError("UNSAFE_INPUT");
  const keys = Object.keys(value);
  const allowed = new Set(["baseline_public", "candidate_public", "baseline_settings", "candidate_settings"]);
  if (keys.some((key) => !allowed.has(key)) ||
      !Object.hasOwn(value, "baseline_public") ||
      !Object.hasOwn(value, "candidate_public")) {
    throw new SyntxMaintenanceReportError("UNSAFE_INPUT");
  }
  return value;
}

function parsePublicSnapshot(value: unknown): SyntxPublicCatalogSnapshot {
  try {
    return syntxPublicCatalogSnapshotSchema.parse(value) as SyntxPublicCatalogSnapshot;
  } catch {
    throw new SyntxMaintenanceReportError("INVALID_PUBLIC_SNAPSHOT");
  }
}

function parseSettingsSnapshot(value: unknown): MaplessSettingsInventory {
  try {
    return maplessSettingsInventorySchema.parse(value);
  } catch {
    throw new SyntxMaintenanceReportError("INVALID_SETTINGS_SNAPSHOT");
  }
}

function assertSettingsBinding(
  inventory: MaplessSettingsInventory,
  snapshot: SyntxPublicCatalogSnapshot
): void {
  if (inventory.public_catalog.version !== archivedPublicVersion(snapshot) ||
      inventory.public_catalog.fetched_at !== snapshot.fetched_at ||
      inventory.public_catalog.models_sha256 !== snapshot.sources.models.canonical_sha256) {
    throw new SyntxMaintenanceReportError("SETTINGS_PUBLIC_BINDING_MISMATCH");
  }

  const publicModels = indexUnique(snapshot.models, (row) => row.value);
  const settingsModels = indexUnique(inventory.models, (row) => row.model_id);
  for (const form of inventory.forms) {
    if (!SAFE_FORM_ID.test(form.form_id) || form.form_id.length > 160) {
      throw new SyntxMaintenanceReportError("SETTINGS_PUBLIC_BINDING_MISMATCH");
    }
  }
  const forms = indexUnique(inventory.forms, (row) => row.form_id);
  if (publicModels.size !== settingsModels.size || forms.size !== inventory.forms.length) {
    throw new SyntxMaintenanceReportError("SETTINGS_PUBLIC_BINDING_MISMATCH");
  }

  for (const [modelId, publicModel] of publicModels) {
    const settingsModel = settingsModels.get(modelId);
    if (settingsModel === undefined ||
        settingsModel.model_id !== modelId ||
        settingsModel.ai_name !== publicModel.ai_name ||
        settingsModel.active !== publicModel.active ||
        settingsModel.default !== publicModel.default ||
        settingsModel.public_type_label !== publicModel.type ||
        !sameJson(settingsModel.settings, publicModel.settings)) {
      throw new SyntxMaintenanceReportError("SETTINGS_PUBLIC_BINDING_MISMATCH");
    }

    if (settingsModel.form_binding_status === "STRUCTURAL_MATCH") {
      if (settingsModel.form_id === null || !SAFE_FORM_ID.test(settingsModel.form_id) ||
          settingsModel.form_id !== normalizePublicAiNameToFormId(publicModel.ai_name)) {
        throw new SyntxMaintenanceReportError("SETTINGS_PUBLIC_BINDING_MISMATCH");
      }
      const form = forms.get(settingsModel.form_id);
      if (form === undefined || !sameJson(
        form.javascript.model_value_settings_keys,
        settingsModel.model_value_settings_keys
      )) {
        throw new SyntxMaintenanceReportError("SETTINGS_PUBLIC_BINDING_MISMATCH");
      }
    } else if (settingsModel.form_id !== null) {
      throw new SyntxMaintenanceReportError("SETTINGS_PUBLIC_BINDING_MISMATCH");
    }
  }
}

function archivedPublicVersion(snapshot: SyntxPublicCatalogSnapshot): string {
  const bytes = serializeSyntxPublicCatalogSnapshot(snapshot);
  const digest = createHash("sha256").update(bytes, "utf8").digest("hex");
  return "sha256-" + digest + ".json";
}

function publicMetadata(snapshot: SyntxPublicCatalogSnapshot): SyntxMaintenancePublicMetadata {
  return Object.freeze({
    fetched_at: snapshot.fetched_at,
    source_hashes: Object.freeze({
      ai: snapshot.sources.ai.canonical_sha256,
      models: snapshot.sources.models.canonical_sha256,
      llm_models: snapshot.sources.llm_models.canonical_sha256
    }),
    counts: Object.freeze({
      ai: snapshot.ai.length,
      models: snapshot.models.length,
      llm_models: snapshot.llm_models.length
    })
  });
}

function settingsMetadata(inventory: MaplessSettingsInventory): SyntxMaintenanceSettingsMetadata {
  return Object.freeze({
    generated_at: inventory.generated_at,
    build_id: inventory.build.id,
    public_version: inventory.public_catalog.version
  });
}

function comparePublicSourceHashes(
  baseline: SyntxPublicCatalogSnapshot,
  candidate: SyntxPublicCatalogSnapshot
): SyntxMaintenancePublicSourceHashChange[] {
  const sourceIds: readonly SyntxMaintenancePublicSourceId[] = ["ai", "models", "llm_models"];
  return sourceIds.flatMap((sourceId) => {
    const before = baseline.sources[sourceId].canonical_sha256;
    const after = candidate.sources[sourceId].canonical_sha256;
    return before === after ? [] : [{
      source_id: sourceId,
      baseline_sha256: before,
      candidate_sha256: after
    }];
  });
}

function publicModelsAffectedBySourceChanges(
  baseline: SyntxPublicCatalogSnapshot,
  candidate: SyntxPublicCatalogSnapshot,
  changedSources: readonly SyntxMaintenancePublicSourceHashChange[]
): string[] {
  if (!changedSources.some((source) => source.source_id === "ai" || source.source_id === "models")) return [];
  return [...new Set([
    ...baseline.models.map((model) => model.value),
    ...candidate.models.map((model) => model.value)
  ])].sort(compareText);
}

function compareCollection<T>(
  baseline: readonly T[],
  candidate: readonly T[],
  getId: (row: T) => string
): SyntxMaintenanceCollectionDelta {
  const before = indexUnique(baseline, getId);
  const after = indexUnique(candidate, getId);
  const beforeIds = [...before.keys()].sort(compareText);
  const afterIds = [...after.keys()].sort(compareText);
  const addedIds = afterIds.filter((id) => !before.has(id));
  const removedIds = beforeIds.filter((id) => !after.has(id));
  const changed = beforeIds.flatMap((id) => {
    const oldRow = before.get(id);
    const newRow = after.get(id);
    if (oldRow === undefined || newRow === undefined) return [];
    const changedKeys = collectChangedKeys(oldRow, newRow);
    return changedKeys.length === 0 ? [] : [{ id, changed_keys: changedKeys }];
  });
  return Object.freeze({
    baseline_count: before.size,
    candidate_count: after.size,
    added_ids: Object.freeze(addedIds),
    removed_ids: Object.freeze(removedIds),
    changed: Object.freeze(changed),
    unchanged_count: before.size - removedIds.length - changed.length
  });
}

function compareSettingsInventories(
  baseline: MaplessSettingsInventory,
  candidate: MaplessSettingsInventory
): SyntxMaintenanceReportV1["settings"] {
  const beforeForms = indexUnique(baseline.forms, (form) => form.form_id);
  const afterForms = indexUnique(candidate.forms, (form) => form.form_id);
  const beforeIds = [...beforeForms.keys()].sort(compareText);
  const afterIds = [...afterForms.keys()].sort(compareText);
  const addedFormIds = afterIds.filter((id) => !beforeForms.has(id));
  const removedFormIds = beforeIds.filter((id) => !afterForms.has(id));
  const changedForms = beforeIds.flatMap((formId) => {
    const before = beforeForms.get(formId);
    const after = afterForms.get(formId);
    if (before === undefined || after === undefined) return [];
    const changedKeys = collectChangedKeys(before, after);
    return changedKeys.length === 0 ? [] : [{ form_id: formId, changed_keys: changedKeys }];
  });

  const beforeHelpers = settingsHelpers(baseline);
  const afterHelpers = settingsHelpers(candidate);
  const helperIds = [...new Set([...beforeHelpers.keys(), ...afterHelpers.keys()])].sort(compareText);
  const changedHelperIds = helperIds.filter((id) =>
    !sameJson(beforeHelpers.get(id), afterHelpers.get(id))
  );
  const sourceHashChanges = helperIds.flatMap((sourceId) => {
    const before = sourceHashForHelper(beforeHelpers.get(sourceId));
    const after = sourceHashForHelper(afterHelpers.get(sourceId));
    return before === null || after === null || before === after
      ? []
      : [{
          source_id: sourceId,
          baseline_sha256: before,
          candidate_sha256: after
        }];
  });
  const beforeFormHashes = new Map(baseline.forms.map((form) => [form.form_id, form.javascript.sha256]));
  const afterFormHashes = new Map(candidate.forms.map((form) => [form.form_id, form.javascript.sha256]));
  const formSourceHashChanges = [...new Set([...beforeFormHashes.keys(), ...afterFormHashes.keys()])]
    .sort(compareText)
    .flatMap((formId) => {
      const before = beforeFormHashes.get(formId);
      const after = afterFormHashes.get(formId);
      return before === undefined || after === undefined || before === after
        ? []
        : [{ source_id: `form:${formId}`, baseline_sha256: before, candidate_sha256: after }];
    });
  const changedFormIds = new Set([
    ...addedFormIds,
    ...removedFormIds,
    ...changedForms.map((form) => form.form_id)
  ]);
  const affectedModelIds = new Set<string>();
  for (const inventory of [baseline, candidate]) {
    for (const model of inventory.models) {
      if (model.form_id !== null &&
          (changedFormIds.has(model.form_id) ||
            (changedHelperIds.length > 0 && model.form_binding_status === "STRUCTURAL_MATCH"))) {
        affectedModelIds.add(model.model_id);
      }
    }
  }

  const hasFormChanges = addedFormIds.length > 0 || removedFormIds.length > 0 || changedForms.length > 0;
  const impactStatus = changedHelperIds.length > 0
    ? "SHARED_HELPER_PARTIAL" as const
    : hasFormChanges
      ? "FORM_BOUND_PARTIAL" as const
      : "NO_CHANGES" as const;
  return Object.freeze({
    status: "COMPARED",
    added_form_ids: Object.freeze(addedFormIds),
    removed_form_ids: Object.freeze(removedFormIds),
    changed_forms: Object.freeze(changedForms),
    changed_helper_ids: Object.freeze(changedHelperIds),
    source_hash_changes: Object.freeze([...sourceHashChanges, ...formSourceHashChanges]
      .sort((left, right) => compareText(left.source_id, right.source_id))),
    affected_model_ids: Object.freeze([...affectedModelIds].sort(compareText)),
    impact_status: impactStatus
  });
}

function emptySettingsDelta(): SyntxMaintenanceReportV1["settings"] {
  return Object.freeze({
    status: "NOT_CHECKED",
    added_form_ids: Object.freeze([]),
    removed_form_ids: Object.freeze([]),
    changed_forms: Object.freeze([]),
    changed_helper_ids: Object.freeze([]),
    source_hash_changes: Object.freeze([]),
    affected_model_ids: Object.freeze([]),
    impact_status: "NOT_CHECKED"
  });
}

function settingsHelpers(inventory: MaplessSettingsInventory): Map<string, unknown> {
  return new Map<string, unknown>([
    ["asset_build", inventory.build],
    ["homepage", { sha256: inventory.homepage_sha256 }],
    ["app", { sha256: inventory.app_sha256 }],
    ["registry", inventory.registry],
    ["settings3", inventory.framework.settings3],
    ["useSettingsParams", inventory.framework.useSettingsParams]
  ]);
}

function sourceHashForHelper(value: unknown): string | null {
  if (!isPlainRecord(value)) return null;
  return typeof value.sha256 === "string" ? value.sha256 : null;
}

function collectChangedKeys(before: unknown, after: unknown, prefix = ""): string[] {
  if (sameJson(before, after)) return [];
  if (prefix.endsWith("static_setting_defaults") || prefix.endsWith("settings.models")) {
    return prefix === "" ? ["value"] : [prefix];
  }
  if (isPlainRecord(before) && isPlainRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort(compareText);
    return keys.flatMap((key) => {
      const path = prefix === "" ? key : prefix + "." + key;
      return collectChangedKeys(before[key], after[key], path);
    });
  }
  const path = prefix === "" ? "value" : prefix;
  return [safeChangedKeyPath(path)];
}

function safeChangedKeyPath(path: string): string {
  const parts = path.split(".");
  if (parts.some((part) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,160}$/u.test(part) ||
      /(?:token|secret|password|credential|authorization|cookie|session|user_id|client_ip)/iu.test(part))) {
    return "redacted_key";
  }
  return path;
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  return canonicalJson(left) === canonicalJson(right);
}

function indexUnique<T>(rows: readonly T[], getId: (row: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    const id = getId(row);
    if (result.has(id)) throw new SyntxMaintenanceReportError("SETTINGS_PUBLIC_BINDING_MISMATCH");
    result.set(id, row);
  }
  return result;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeCopy(input: unknown): unknown {
  let nodes = 0;
  let bytes = 0;
  const ancestors = new WeakSet<object>();

  const visit = (value: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > MAX_INPUT_NODES || depth > MAX_INPUT_DEPTH) throw unsafeInput();
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") {
      bytes += Buffer.byteLength(value, "utf8");
      if (bytes > MAX_INPUT_BYTES) throw unsafeInput();
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw unsafeInput();
      return value;
    }
    if (typeof value !== "object" || types.isProxy(value)) throw unsafeInput();
    if (ancestors.has(value)) throw unsafeInput();
    ancestors.add(value);
    try {
      if (Array.isArray(value)) return copyArray(value, depth);
      return copyRecord(value as Record<string, unknown>, depth);
    } finally {
      ancestors.delete(value);
    }
  };

  const copyArray = (value: readonly unknown[], depth: number): unknown[] => {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw unsafeInput();
    if (value.length > MAX_INPUT_NODES) throw unsafeInput();
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length > MAX_INPUT_NODES + 1) throw unsafeInput();
    if (ownKeys.some((key) => typeof key !== "string" ||
        (key !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(key)))) throw unsafeInput();
    const output: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) throw unsafeInput();
      bytes += Buffer.byteLength(String(index), "utf8");
      if (bytes > MAX_INPUT_BYTES) throw unsafeInput();
      output.push(visit(descriptor.value, depth + 1));
    }
    return output;
  };

  const copyRecord = (value: Record<string, unknown>, depth: number): Record<string, unknown> => {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw unsafeInput();
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length > MAX_INPUT_NODES) throw unsafeInput();
    const output: Record<string, unknown> = {};
    for (const key of ownKeys) {
      if (typeof key !== "string") throw unsafeInput();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) throw unsafeInput();
      bytes += Buffer.byteLength(key, "utf8");
      if (bytes > MAX_INPUT_BYTES) throw unsafeInput();
      Object.defineProperty(output, key, {
        value: visit(descriptor.value, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
    return output;
  };

  try {
    return visit(input, 0);
  } catch {
    throw new SyntxMaintenanceReportError("UNSAFE_INPUT");
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function unsafeInput(): never {
  throw new Error("UNSAFE_INPUT");
}
