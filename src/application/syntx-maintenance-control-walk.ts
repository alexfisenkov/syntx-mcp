import { createHash } from "node:crypto";
import { types } from "node:util";
import {
  maplessSettingsInventorySchema,
  serializeMaplessSettingsInventory,
  type MaplessSettingsInventory
} from "../catalog/mapless-settings-inventory.js";
import type { SyntxMaintenanceAuditPlanV1, SyntxMaintenanceAuditSourceIdentity } from "./syntx-maintenance-audit-plan.js";

const CHECKPOINT_VERSION = "1.0.0" as const;
const SAFE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;
const SAFE_FORM_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SAFE_CONTROL_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SENSITIVE_KEY = /(?:token|secret|password|passwd|credential|authorization|cookie|session|user[_-]?id|client[_-]?ip)/iu;
const CHECKPOINT_ID = /^ctl_[a-f0-9]{32}$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const VERSION = /^sha256-([a-f0-9]{64})\.json$/u;
const MAX_CONTROLS = 250_000;
const MAX_CHECKPOINT_OBSERVATIONS = 4_000;
const MAX_CHECKPOINT_BYTES = 1024 * 1024;

export type SyntxMaintenanceControlOrigin =
  | "FORM_MODEL_VALUE"
  | "GENERIC_SETTING"
  | "PAYLOAD_FIELD"
  | "PUBLIC_SETTING"
  | "ENUM_CONSTRAINT"
  | "STATIC_DEFAULT";
export type SyntxMaintenanceControlStatus = "NOT_VISITED" | "OBSERVED" | "UNSUPPORTED" | "STALE";
export type SyntxMaintenanceControlCheckpointStatus = "OBSERVED" | "UNSUPPORTED";
export type SyntxMaintenanceControlChangeStatus = "NEW" | "UNCHANGED" | "CHANGED";
export type SyntxMaintenanceControlGapCode =
  | "UNSAFE_MODEL_ID"
  | "SETTINGS_MODEL_MISSING"
  | "FORM_BINDING_UNKNOWN"
  | "FORM_RECORD_MISSING"
  | "UNSAFE_FORM_ID"
  | "PUBLIC_SETTINGS_UNKNOWN"
  | "UNSAFE_CONTROL_KEY"
  | "CONTROL_CONSTRAINTS_NOT_IN_PUBLIC_SETTINGS"
  | "STATIC_DEFAULTS_PARTIAL"
  | "CONDITIONAL_VISIBILITY_NOT_EVALUATED"
  | "GENERATION_PAYLOAD_NOT_RUNTIME_VERIFIED";

export interface SyntxMaintenanceControlCheckpointV1 {
  readonly schema_version: typeof CHECKPOINT_VERSION;
  readonly source_identity: SyntxMaintenanceAuditSourceIdentity;
  readonly observations: readonly Readonly<{
    control_id: string;
    fingerprint: string;
    status: SyntxMaintenanceControlCheckpointStatus;
  }>[];
}
export interface SyntxMaintenanceControlWalkInput {
  readonly audit_plan: SyntxMaintenanceAuditPlanV1;
  readonly baseline_settings: MaplessSettingsInventory;
  readonly candidate_settings: MaplessSettingsInventory;
  readonly checkpoint?: unknown;
}
export interface SyntxMaintenanceControlWalkControl {
  readonly control_id: string;
  readonly model_id: string;
  readonly form_id: string | null;
  readonly control_key: string;
  readonly origins: readonly SyntxMaintenanceControlOrigin[];
  readonly fingerprint: string;
  readonly change_status: SyntxMaintenanceControlChangeStatus;
  readonly status: SyntxMaintenanceControlStatus;
}
export interface SyntxMaintenanceControlWalkV1 {
  readonly schema_version: typeof CHECKPOINT_VERSION;
  readonly operation: "PER_CONTROL_SOURCE_WALK";
  readonly source_identity: SyntxMaintenanceAuditSourceIdentity;
  readonly models: readonly Readonly<{
    model_id: string | null;
    model_ref: string;
    control_count: number;
    gaps: readonly Readonly<{ code: SyntxMaintenanceControlGapCode; count: number }>[];
  }>[];
  readonly controls: readonly Readonly<SyntxMaintenanceControlWalkControl>[];
  readonly diff: Readonly<{
    baseline_control_count: number;
    candidate_control_count: number;
    added_control_ids: readonly string[];
    removed_control_ids: readonly string[];
    changed_control_ids: readonly string[];
  }>;
  readonly checkpoint_resume: Readonly<{
    status: "NONE" | "EXACT_SOURCE" | "CARRIED_UNAFFECTED" | "SOURCE_CHANGED_RESET";
    carried_observation_count: number;
    stale_control_ids: readonly string[];
  }>;
  readonly checkpoint_template: SyntxMaintenanceControlCheckpointV1;
  readonly coverage: Readonly<{
    source_control_keys: "STATIC_INVENTORY_ONLY";
    conditional_visibility: "NOT_EVALUATED";
    account_access: "NOT_CHECKED";
    rendered_ui: "NOT_CHECKED";
    provider_acceptance: "NOT_CHECKED";
  }>;
  readonly automatic_runtime_promotion: false;
  readonly paid_operations: false;
}
export type SyntxMaintenanceControlWalkErrorCode =
  | "INVALID_INPUT"
  | "UNSAFE_CHECKPOINT"
  | "CHECKPOINT_SOURCE_MISMATCH"
  | "CONTROL_CHECKPOINT_LIMIT_EXCEEDED";
export class SyntxMaintenanceControlWalkError extends Error {
  constructor(readonly code: SyntxMaintenanceControlWalkErrorCode) {
    super("The maintenance control walk input is invalid or cannot be resumed safely.");
    this.name = "SyntxMaintenanceControlWalkError";
  }
}

const ORIGIN_ORDER: Readonly<Record<SyntxMaintenanceControlOrigin, number>> = Object.freeze({
  FORM_MODEL_VALUE: 0, GENERIC_SETTING: 1, PAYLOAD_FIELD: 2,
  PUBLIC_SETTING: 3, ENUM_CONSTRAINT: 4, STATIC_DEFAULT: 5
});

/** Builds a deterministic, source-bound worklist; source keys are not proof of rendered UI controls. */
export function buildSyntxMaintenanceControlWalk(input: SyntxMaintenanceControlWalkInput | unknown): SyntxMaintenanceControlWalkV1 {
  const fields = exact(input, ["audit_plan", "baseline_settings", "candidate_settings"], ["checkpoint"]);
  let safePlan: unknown;
  try { safePlan = safeCopy(fields.audit_plan, 2_000_000, 64 * 1024 * 1024); } catch { fail("INVALID_INPUT"); }
  if (!isRecord(safePlan) || !isRecord(safePlan.source_identity) || !isRecord(safePlan.census) || !Array.isArray(safePlan.census.models) ||
      !isRecord(safePlan.report) || !isRecord(safePlan.report.settings) || !isRecord(safePlan.report.baseline) ||
      !isRecord(safePlan.report.candidate) || !isRecord(safePlan.report.baseline.settings) ||
      !isRecord(safePlan.report.candidate.settings) || !isRecord(safePlan.report.baseline.public) ||
      !isRecord(safePlan.report.candidate.public) || !isRecord(safePlan.report.baseline.public.source_hashes) ||
      !isRecord(safePlan.report.candidate.public.source_hashes) || safePlan.report.settings.status !== "COMPARED" ||
      !safeSourceHashes(safePlan.report.baseline.public.source_hashes) || !safeSourceHashes(safePlan.report.candidate.public.source_hashes)) fail("INVALID_INPUT");
  const plan = safePlan as unknown as SyntxMaintenanceAuditPlanV1;
  const planRows = plan.census.models;
  if (planRows.some((row) => !row || typeof row !== "object" || typeof row.model_id !== "string")) fail("INVALID_INPUT");
  const baselineSettings = parseSettings(fields.baseline_settings);
  const candidateSettings = parseSettings(fields.candidate_settings);
  if (!plan.report.baseline.settings || !plan.report.candidate.settings) fail("INVALID_INPUT");
  const baselineIdentity = sourceIdentity(baselineSettings);
  const candidateIdentity = sourceIdentity(candidateSettings);
  if (!sameIdentity(parseIdentity(safePlan.source_identity as Record<string, unknown>), candidateIdentity) ||
      plan.report.baseline.settings.public_version !== baselineSettings.public_catalog.version ||
      plan.report.candidate.settings.public_version !== candidateSettings.public_catalog.version) fail("INVALID_INPUT");

  const baseline = buildInventoryControls(baselineSettings, undefined, plan.report.baseline.public.source_hashes);
  const candidate = buildInventoryControls(candidateSettings, plan.census.models.map((row) => row.model_id), plan.report.candidate.public.source_hashes);
  if (baseline.controls.length > MAX_CONTROLS || candidate.controls.length > MAX_CONTROLS) fail("INVALID_INPUT");
  const baselineById = new Map(baseline.controls.map((row) => [row.control_id, row]));
  const candidateById = new Map(candidate.controls.map((row) => [row.control_id, row]));
  const checkpoint = Object.hasOwn(fields, "checkpoint") ? fields.checkpoint : undefined;
  const resume = resumeCheckpoint(checkpoint, baselineIdentity, candidateIdentity, baselineById, candidateById);
  const controls = candidate.controls.map((row) => {
    const previous = baselineById.get(row.control_id);
    const saved = resume.statuses.get(row.control_id);
    const changeStatus: SyntxMaintenanceControlChangeStatus = previous === undefined
      ? "NEW"
      : previous.fingerprint === row.fingerprint ? "UNCHANGED" : "CHANGED";
    return Object.freeze({ ...row, change_status: changeStatus,
      status: saved ?? (resume.staleControlIds.has(row.control_id) ? "STALE" : "NOT_VISITED") });
  }).sort(compareControls);
  const checkpointRows = controls.flatMap((row) => row.status === "OBSERVED" || row.status === "UNSUPPORTED"
    ? [{ control_id: row.control_id, fingerprint: row.fingerprint, status: row.status as SyntxMaintenanceControlCheckpointStatus }]
    : []).sort((left, right) => compareText(left.control_id, right.control_id));
  const added = controls.filter((row) => row.change_status === "NEW").map((row) => row.control_id).sort(compareText);
  const changed = controls.filter((row) => row.change_status === "CHANGED").map((row) => row.control_id).sort(compareText);
  const removed = [...baselineById.keys()].filter((id) => !candidateById.has(id)).sort(compareText);
  const controlsByModel = new Map<string, number>();
  for (const row of controls) controlsByModel.set(row.model_id, (controlsByModel.get(row.model_id) ?? 0) + 1);

  return Object.freeze({
    schema_version: CHECKPOINT_VERSION,
    operation: "PER_CONTROL_SOURCE_WALK",
    source_identity: candidateIdentity,
    models: Object.freeze(candidate.models.map((row) => Object.freeze({
      model_id: row.model_id, model_ref: row.model_ref,
      control_count: row.model_id === null ? 0 : controlsByModel.get(row.model_id) ?? 0,
      gaps: row.gaps
    }))),
    controls: Object.freeze(controls),
    diff: Object.freeze({
      baseline_control_count: baseline.controls.length,
      candidate_control_count: controls.length,
      added_control_ids: Object.freeze(added),
      removed_control_ids: Object.freeze(removed),
      changed_control_ids: Object.freeze(changed)
    }),
    checkpoint_resume: Object.freeze({
      status: resume.status,
      carried_observation_count: checkpointRows.length,
      stale_control_ids: Object.freeze([...resume.staleControlIds].sort(compareText))
    }),
    checkpoint_template: Object.freeze({
      schema_version: CHECKPOINT_VERSION,
      source_identity: candidateIdentity,
      observations: Object.freeze(checkpointRows.map((row) => Object.freeze(row)))
    }),
    coverage: Object.freeze({
      source_control_keys: "STATIC_INVENTORY_ONLY",
      conditional_visibility: "NOT_EVALUATED",
      account_access: "NOT_CHECKED",
      rendered_ui: "NOT_CHECKED",
      provider_acceptance: "NOT_CHECKED"
    }),
    automatic_runtime_promotion: false,
    paid_operations: false
  });
}

interface BuiltControl extends SyntxMaintenanceControlWalkControl {}
interface BuiltInventory {
  readonly controls: readonly BuiltControl[];
  readonly models: readonly Readonly<{
    model_id: string | null;
    model_ref: string;
    gaps: readonly Readonly<{ code: SyntxMaintenanceControlGapCode; count: number }>[];
  }>[];
}
interface CheckpointState {
  readonly status: SyntxMaintenanceControlWalkV1["checkpoint_resume"]["status"];
  readonly statuses: ReadonlyMap<string, SyntxMaintenanceControlCheckpointStatus>;
  readonly staleControlIds: ReadonlySet<string>;
}

function buildInventoryControls(
  inventory: MaplessSettingsInventory,
  fullCensusModelIds: readonly string[] | undefined,
  publicSourceHashes: Readonly<{ ai: string; models: string; llm_models: string }>
): BuiltInventory {
  const inventoryById = new Map(inventory.models.map((model) => [model.model_id, model]));
  const modelIds = fullCensusModelIds ?? inventory.models.map((model) => model.model_id);
  const formById = new Map(inventory.forms.map((form) => [form.form_id, form]));
  const controls: BuiltControl[] = [];
  const models = modelIds.map((rawModelId) => {
    const safeModel = typeof rawModelId === "string" && SAFE_MODEL_ID.test(rawModelId);
    const modelRef = safeModel ? rawModelId : "model_" + digest(String(rawModelId)).slice(0, 24);
    const gaps = new Map<SyntxMaintenanceControlGapCode, number>();
    const addGap = (code: SyntxMaintenanceControlGapCode, count = 1): void => {
      if (count > 0) gaps.set(code, (gaps.get(code) ?? 0) + count);
    };
    if (!safeModel) addGap("UNSAFE_MODEL_ID");
    const model = inventoryById.get(rawModelId);
    if (model === undefined) {
      addGap("SETTINGS_MODEL_MISSING");
      return modelSummary(safeModel ? rawModelId : null, modelRef, gaps);
    }
    if (model.form_binding_status !== "STRUCTURAL_MATCH" || model.form_id === null) addGap("FORM_BINDING_UNKNOWN");
    const formIdSafe = model.form_id !== null && SAFE_FORM_ID.test(model.form_id);
    if (model.form_id !== null && !formIdSafe) addGap("UNSAFE_FORM_ID");
    const form = formIdSafe ? formById.get(model.form_id!) : undefined;
    if (formIdSafe && form === undefined) addGap("FORM_RECORD_MISSING");
    if (model.settings === null) addGap("PUBLIC_SETTINGS_UNKNOWN");
    if (model.unknown_reasons.includes("CONTROL_CONSTRAINTS_NOT_IN_PUBLIC_SETTINGS")) {
      const publicKeys = new Set(model.settings === null ? [] : Object.keys(model.settings));
      addGap("CONTROL_CONSTRAINTS_NOT_IN_PUBLIC_SETTINGS",
        model.model_value_settings_keys.filter((key) => !publicKeys.has(key)).length);
    }
    if (model.unknown_reasons.includes("SETTING_DEFAULTS_NOT_STATICALLY_RESOLVED")) addGap("STATIC_DEFAULTS_PARTIAL");
    if (model.unknown_reasons.includes("CONDITIONAL_VISIBILITY_NOT_FULLY_EVALUATED")) addGap("CONDITIONAL_VISIBILITY_NOT_EVALUATED");
    if (model.unknown_reasons.includes("GENERATION_PAYLOAD_NOT_RUNTIME_VERIFIED")) addGap("GENERATION_PAYLOAD_NOT_RUNTIME_VERIFIED");
    if (!safeModel) return modelSummary(null, modelRef, gaps);

    const originsByKey = new Map<string, Set<SyntxMaintenanceControlOrigin>>();
    const unsafeControlKeys = new Set<string>();
    const addKeys = (keys: readonly string[], origin: SyntxMaintenanceControlOrigin): void => {
      for (const key of keys) {
        if (!SAFE_CONTROL_KEY.test(key) || SENSITIVE_KEY.test(key)) { unsafeControlKeys.add(digest(key)); continue; }
        if (!originsByKey.has(key) && controls.length + originsByKey.size >= MAX_CONTROLS) fail("INVALID_INPUT");
        const origins = originsByKey.get(key) ?? new Set<SyntxMaintenanceControlOrigin>();
        origins.add(origin);
        originsByKey.set(key, origins);
      }
    };
    addKeys(model.model_value_settings_keys, "FORM_MODEL_VALUE");
    addKeys(form?.javascript.model_value_settings_keys ?? [], "FORM_MODEL_VALUE");
    addKeys(model.generic_setting_keys, "GENERIC_SETTING");
    addKeys(model.payload_field_keys, "PAYLOAD_FIELD");
    addKeys(model.settings === null ? [] : Object.keys(model.settings), "PUBLIC_SETTING");
    addKeys(Object.keys(model.enum_constraints), "ENUM_CONSTRAINT");
    addKeys(Object.keys(model.static_setting_defaults), "STATIC_DEFAULT");
    addKeys(Object.keys(form?.javascript.static_setting_defaults ?? {}), "STATIC_DEFAULT");
    addGap("UNSAFE_CONTROL_KEY", unsafeControlKeys.size);

    for (const [controlKey, originSet] of originsByKey) {
      if (controls.length >= MAX_CONTROLS) fail("INVALID_INPUT");
      const origins = [...originSet].sort((left, right) => ORIGIN_ORDER[left] - ORIGIN_ORDER[right]);
      const formId = formIdSafe ? model.form_id : null;
      controls.push(Object.freeze({
        control_id: "ctl_" + digest(JSON.stringify([rawModelId, formId, controlKey])).slice(0, 32),
        model_id: rawModelId,
        form_id: formId,
        control_key: controlKey,
        origins: Object.freeze(origins),
        fingerprint: controlFingerprint(inventory, model, form, controlKey, origins, publicSourceHashes),
        change_status: "UNCHANGED",
        status: "NOT_VISITED"
      }));
    }
    return modelSummary(rawModelId, modelRef, gaps);
  });
  return {
    controls: Object.freeze(controls.sort(compareControls)),
    models: Object.freeze(models.sort((left, right) => compareText(left.model_ref, right.model_ref)))
  };
}

function modelSummary(
  modelId: string | null,
  modelRef: string,
  gaps: ReadonlyMap<SyntxMaintenanceControlGapCode, number>
): BuiltInventory["models"][number] {
  return Object.freeze({
    model_id: modelId,
    model_ref: modelRef,
    gaps: Object.freeze([...gaps.entries()]
      .map(([code, count]) => Object.freeze({ code, count }))
      .sort((left, right) => compareText(left.code, right.code)))
  });
}

function controlFingerprint(
  inventory: MaplessSettingsInventory,
  model: MaplessSettingsInventory["models"][number],
  form: MaplessSettingsInventory["forms"][number] | undefined,
  key: string,
  origins: readonly SyntxMaintenanceControlOrigin[],
  publicSourceHashes: Readonly<{ ai: string; models: string; llm_models: string }>
): string {
  const sourceHashes: Record<string, string | null> = {
    app: inventory.app_sha256,
    homepage: inventory.homepage_sha256,
    registry: inventory.registry.sha256,
    public_ai: publicSourceHashes.ai,
    public_models: publicSourceHashes.models,
    public_llm_models: publicSourceHashes.llm_models
  };
  if (model.form_id !== null) sourceHashes.form = form?.javascript.sha256 ?? null;
  if (origins.includes("GENERIC_SETTING")) sourceHashes.generic_helper = inventory.framework.settings3.sha256;
  if (origins.includes("PAYLOAD_FIELD")) sourceHashes.payload_helper = inventory.framework.useSettingsParams.sha256;
  const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  if (origins.includes("PUBLIC_SETTING") && model.settings !== null) values.public_setting = model.settings[key];
  if (origins.includes("ENUM_CONSTRAINT")) values.enum_constraint = model.enum_constraints[key];
  if (origins.includes("STATIC_DEFAULT")) values.static_default = Object.hasOwn(model.static_setting_defaults, key)
    ? model.static_setting_defaults[key]
    : form?.javascript.static_setting_defaults[key];
  return "sha256:" + digest(canonicalJson({
    model_id: model.model_id,
    form_id: model.form_id,
    key,
    origins,
    source_hashes: sourceHashes,
    values
  }));
}

function resumeCheckpoint(
  checkpointValue: unknown,
  baselineIdentity: SyntxMaintenanceAuditSourceIdentity,
  candidateIdentity: SyntxMaintenanceAuditSourceIdentity,
  baseline: ReadonlyMap<string, BuiltControl>,
  candidate: ReadonlyMap<string, BuiltControl>
): CheckpointState {
  const statuses = new Map<string, SyntxMaintenanceControlCheckpointStatus>();
  const stale = new Set<string>();
  if (checkpointValue === undefined) return { status: "NONE", statuses, staleControlIds: stale };
  const checkpoint = parseCheckpoint(checkpointValue);
  const exactCandidate = sameIdentity(checkpoint.source_identity, candidateIdentity);
  const exactBaseline = sameIdentity(checkpoint.source_identity, baselineIdentity);
  if (!exactCandidate && !exactBaseline) fail("CHECKPOINT_SOURCE_MISMATCH");
  const source = exactCandidate ? candidate : baseline;
  for (const observation of checkpoint.observations) {
    const previous = source.get(observation.control_id);
    if (!previous || previous.fingerprint !== observation.fingerprint) fail("UNSAFE_CHECKPOINT");
    if (exactCandidate) statuses.set(observation.control_id, observation.status);
    else {
      const next = candidate.get(observation.control_id);
      if (next && next.fingerprint === observation.fingerprint) statuses.set(observation.control_id, observation.status);
      else stale.add(observation.control_id);
    }
  }
  return {
    status: exactCandidate ? "EXACT_SOURCE" : statuses.size > 0 ? "CARRIED_UNAFFECTED" : "SOURCE_CHANGED_RESET",
    statuses,
    staleControlIds: stale
  };
}

function parseCheckpoint(value: unknown): SyntxMaintenanceControlCheckpointV1 {
  let safe: unknown;
  try { safe = safeCopy(value, 500_000, MAX_CHECKPOINT_BYTES); } catch { fail("UNSAFE_CHECKPOINT"); }
  if (!isRecord(safe) || !exactKeys(safe, ["schema_version", "source_identity", "observations"]) ||
      safe.schema_version !== CHECKPOINT_VERSION || !isRecord(safe.source_identity) ||
      !exactKeys(safe.source_identity, ["public_version", "public_hash", "settings_version", "settings_hash"]) ||
      !Array.isArray(safe.observations)) fail("UNSAFE_CHECKPOINT");
  if (safe.observations.length > MAX_CHECKPOINT_OBSERVATIONS) fail("CONTROL_CHECKPOINT_LIMIT_EXCEEDED");
  const identity = parseIdentity(safe.source_identity);
  const seen = new Set<string>();
  const observations = safe.observations.map((value) => {
    if (!isRecord(value) || !exactKeys(value, ["control_id", "fingerprint", "status"]) ||
        typeof value.control_id !== "string" || !CHECKPOINT_ID.test(value.control_id) ||
        typeof value.fingerprint !== "string" || !HASH.test(value.fingerprint) ||
        value.status !== "OBSERVED" && value.status !== "UNSUPPORTED" || seen.has(value.control_id)) fail("UNSAFE_CHECKPOINT");
    seen.add(value.control_id);
    return Object.freeze({
      control_id: value.control_id,
      fingerprint: value.fingerprint,
      status: value.status as SyntxMaintenanceControlCheckpointStatus
    });
  }).sort((left, right) => compareText(left.control_id, right.control_id));
  return Object.freeze({ schema_version: CHECKPOINT_VERSION, source_identity: identity, observations: Object.freeze(observations) });
}

function parseSettings(value: unknown): MaplessSettingsInventory {
  try { return maplessSettingsInventorySchema.parse(safeCopy(value, 2_000_000, 64 * 1024 * 1024)); }
  catch { fail("INVALID_INPUT"); }
}
function sourceIdentity(settings: MaplessSettingsInventory): SyntxMaintenanceAuditSourceIdentity {
  const publicMatch = VERSION.exec(settings.public_catalog.version);
  if (!publicMatch) fail("INVALID_INPUT");
  const settingsHash = digest(serializeMaplessSettingsInventory(settings));
  return Object.freeze({
    public_version: settings.public_catalog.version,
    public_hash: "sha256:" + publicMatch[1],
    settings_version: "sha256-" + settingsHash + ".json",
    settings_hash: "sha256:" + settingsHash
  });
}
function parseIdentity(value: Record<string, unknown>): SyntxMaintenanceAuditSourceIdentity {
  const publicVersion = typeof value.public_version === "string" ? VERSION.exec(value.public_version) : null;
  const settingsVersion = value.settings_version === null
    ? null
    : typeof value.settings_version === "string" ? VERSION.exec(value.settings_version) : null;
  if (!publicVersion || value.public_hash !== "sha256:" + publicVersion[1] ||
      !(value.settings_version === null || settingsVersion && value.settings_hash === "sha256:" + settingsVersion[1]) ||
      (value.settings_version === null) !== (value.settings_hash === null)) fail("UNSAFE_CHECKPOINT");
  return Object.freeze({
    public_version: value.public_version as string,
    public_hash: value.public_hash as string,
    settings_version: value.settings_version as string | null,
    settings_hash: value.settings_hash as string | null
  });
}
function sameIdentity(left: SyntxMaintenanceAuditSourceIdentity, right: SyntxMaintenanceAuditSourceIdentity): boolean {
  return left.public_version === right.public_version && left.public_hash === right.public_hash &&
    left.settings_version === right.settings_version && left.settings_hash === right.settings_hash;
}
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!isRecord(value)) fail("INVALID_INPUT");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (required.some((key) => !Object.hasOwn(descriptors, key)) || keys.length > required.length + optional.length ||
      keys.some((key) => typeof key !== "string" || (!required.includes(key) && !optional.includes(key)) ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_INPUT");
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) output[key] = descriptors[key]!.value;
  return output;
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length && keys.every((key) => typeof key === "string" && expected.includes(key));
}
function safeCopy(value: unknown, maxNodes: number, maxText: number): unknown {
  let nodes = 0;
  let text = 0;
  const seen = new Set<object>();
  const visit = (item: unknown, depth: number): unknown => {
    if (++nodes > maxNodes || depth > 48) throw new Error();
    if (typeof item === "string") {
      text += item.length;
      if (text > maxText) throw new Error();
      return item;
    }
    if (item === null || typeof item === "boolean" || typeof item === "number") return item;
    if (typeof item !== "object" || types.isProxy(item) || seen.has(item)) throw new Error();
    seen.add(item);
    try {
      if (Array.isArray(item)) {
        if (Object.getPrototypeOf(item) !== Array.prototype || item.length > maxNodes) throw new Error();
        const output: unknown[] = [];
        for (let index = 0; index < item.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor || !("value" in descriptor)) throw new Error();
          output.push(visit(descriptor.value, depth + 1));
        }
        if (Reflect.ownKeys(item).some((key) => key !== "length" &&
            !(typeof key === "string" && /^(?:0|[1-9]\d*)$/u.test(key) && Number(key) < item.length))) throw new Error();
        return output;
      }
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw new Error();
      const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of Reflect.ownKeys(item)) {
        if (typeof key !== "string") throw new Error();
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new Error();
        output[key] = visit(descriptor.value, depth + 1);
      }
      return output;
    } finally { seen.delete(item); }
  };
  return visit(value, 0);
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (isRecord(value)) {
    return "{" + Object.keys(value).sort(compareText)
      .map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}
function digest(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function safeSourceHashes(value: Record<string, unknown>): boolean {
  return ["ai", "models", "llm_models"].every((key) => typeof value[key] === "string" && HASH.test(value[key] as string));
}
function compareControls(left: BuiltControl, right: BuiltControl): number {
  return compareText(left.model_id, right.model_id) || compareText(left.form_id ?? "", right.form_id ?? "") ||
    compareText(left.control_key, right.control_key);
}
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function fail(code: SyntxMaintenanceControlWalkErrorCode): never { throw new SyntxMaintenanceControlWalkError(code); }
