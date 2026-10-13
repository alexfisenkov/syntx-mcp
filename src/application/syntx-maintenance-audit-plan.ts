import { createHash } from "node:crypto";
import { types } from "node:util";
import {
  maplessSettingsInventorySchema,
  serializeMaplessSettingsInventory,
  type MaplessSettingsInventory
} from "../catalog/mapless-settings-inventory.js";
import {
  serializeSyntxPublicCatalogSnapshot,
  syntxPublicCatalogSnapshotSchema,
  type SyntxPublicCatalogSnapshot
} from "../catalog/syntx-public-catalog.js";
import {
  compareSyntxMaintenanceSnapshots,
  type SyntxMaintenanceReportV1
} from "./syntx-maintenance-report.js";

export type SyntxMaintenanceAuditStatus =
  | "NOT_VISITED"
  | "OBSERVED"
  | "BLOCKED_BY_PLAN"
  | "UNSUPPORTED";

export type SyntxMaintenanceAuditModality = "image" | "video" | "audio" | "other" | "text" | "unknown";
export type SyntxMaintenanceCheckpointStatus = "OBSERVED" | "UNSUPPORTED";

export type SyntxMaintenanceAuditObligation =
  | "controls"
  | "conditional_branches"
  | "actions"
  | "references"
  | "settings"
  | "helper_store_sender"
  | "results"
  | "mcp_consumers"
  | "account_access";

export interface SyntxMaintenanceAuditSourceIdentity {
  readonly public_version: string;
  readonly public_hash: string;
  readonly settings_version: string | null;
  readonly settings_hash: string | null;
}

export interface SyntxMaintenanceAuditCheckpointV1 {
  readonly schema_version: "1.0.0";
  readonly source_identity: SyntxMaintenanceAuditSourceIdentity;
  readonly observations: readonly {
    readonly model_id: string;
    readonly obligation: Exclude<SyntxMaintenanceAuditObligation, "account_access">;
    readonly status: SyntxMaintenanceCheckpointStatus;
  }[];
}

export interface SyntxMaintenanceAuditPlanInput {
  readonly baseline_public: SyntxPublicCatalogSnapshot;
  readonly candidate_public: SyntxPublicCatalogSnapshot;
  readonly baseline_settings?: MaplessSettingsInventory;
  readonly candidate_settings?: MaplessSettingsInventory;
  readonly checkpoint?: unknown;
}

export interface SyntxMaintenanceAuditPlanV1 {
  readonly schema_version: "1.0.0";
  readonly operation: "INCREMENTAL_AUDIT_PLAN";
  readonly source_identity: SyntxMaintenanceAuditSourceIdentity;
  readonly report: SyntxMaintenanceReportV1;
  readonly census: Readonly<{
    readonly total_models: number;
    readonly models: readonly Readonly<{
    readonly model_id: string;
    readonly modality: SyntxMaintenanceAuditModality;
    readonly mandatory_gate: boolean;
    readonly affected: boolean;
      readonly obligations: readonly Readonly<{
        readonly id: SyntxMaintenanceAuditObligation;
        readonly status: SyntxMaintenanceAuditStatus;
      }>[];
    }>[];
    readonly removed_model_ids: readonly string[];
  }>;
  readonly affected_queue: Readonly<{ readonly model_ids: readonly string[] }>;
  readonly impact: Readonly<{
    readonly settings_status: SyntxMaintenanceReportV1["settings"]["impact_status"];
    readonly mapping_partial: boolean;
    readonly affected_model_ids: readonly string[];
  }>;
  readonly checkpoint_resume: Readonly<{
    readonly status: "NONE" | "EXACT_SOURCE" | "CARRIED_UNAFFECTED" | "SOURCE_CHANGED_RESET";
    readonly carried_observation_count: number;
    readonly stale_model_ids: readonly string[];
  }>;
  readonly checkpoint_template: SyntxMaintenanceAuditCheckpointV1;
  readonly coverage: Readonly<{
    readonly public_control_observations: "USER_DECLARED_ONLY";
    readonly account_access: "NOT_CHECKED";
    readonly rendered_ui: "NOT_CHECKED";
    readonly provider_acceptance: "NOT_CHECKED";
  }>;
  readonly automatic_runtime_promotion: false;
  readonly paid_operations: false;
}

export type SyntxMaintenanceAuditPlanErrorCode =
  | "INVALID_INPUT"
  | "UNSAFE_CHECKPOINT"
  | "CHECKPOINT_SOURCE_MISMATCH";

const ERROR_MESSAGES: Readonly<Record<SyntxMaintenanceAuditPlanErrorCode, string>> = Object.freeze({
  INVALID_INPUT: "Maintenance audit plan input is invalid.",
  UNSAFE_CHECKPOINT: "Maintenance checkpoint is invalid or unsafe.",
  CHECKPOINT_SOURCE_MISMATCH: "Maintenance checkpoint does not match the current or baseline source."
});

export class SyntxMaintenanceAuditPlanError extends Error {
  constructor(readonly code: SyntxMaintenanceAuditPlanErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "SyntxMaintenanceAuditPlanError";
  }
}

const MAX_INPUT_NODES = 2_000_000;
const CHECKPOINT_MODEL_ID = /^[A-Za-z0-9._-]{1,160}$/u;
const PUBLIC_OBLIGATIONS = [
  "controls", "conditional_branches", "actions", "references", "settings",
  "helper_store_sender", "results", "mcp_consumers"
] as const;
const ALL_OBLIGATIONS: readonly SyntxMaintenanceAuditObligation[] = [
  ...PUBLIC_OBLIGATIONS, "account_access"
];
const MODALITY_ORDER: Readonly<Record<SyntxMaintenanceAuditModality, number>> = Object.freeze({
  image: 0, video: 1, audio: 2, other: 3, text: 4, unknown: 5
});

/**
 * Creates a deterministic, offline audit queue from validated source snapshots.
 * Checkpoint observations are user-declared progress, never provider acceptance.
 */
export function buildSyntxMaintenanceAuditPlan(
  input: SyntxMaintenanceAuditPlanInput
): SyntxMaintenanceAuditPlanV1 {
  const splitInput = splitPlanInput(input);
  const safeInput = safeCopy(splitInput.value, MAX_INPUT_NODES, 64 * 1024 * 1024);
  if (!isRecord(safeInput) || !onlyKeys(safeInput, [
    "baseline_public", "candidate_public", "baseline_settings", "candidate_settings", "checkpoint"
  ]) || !Object.hasOwn(safeInput, "baseline_public") || !Object.hasOwn(safeInput, "candidate_public")) {
    throw new SyntxMaintenanceAuditPlanError("INVALID_INPUT");
  }

  let baseline: SyntxPublicCatalogSnapshot;
  let candidate: SyntxPublicCatalogSnapshot;
  let baselineSettings: MaplessSettingsInventory | undefined;
  let candidateSettings: MaplessSettingsInventory | undefined;
  try {
    baseline = syntxPublicCatalogSnapshotSchema.parse(safeInput.baseline_public);
    candidate = syntxPublicCatalogSnapshotSchema.parse(safeInput.candidate_public);
    const hasBaselineSettings = Object.hasOwn(safeInput, "baseline_settings");
    const hasCandidateSettings = Object.hasOwn(safeInput, "candidate_settings");
    if (hasBaselineSettings !== hasCandidateSettings) throw new Error();
    if (hasBaselineSettings) {
      baselineSettings = maplessSettingsInventorySchema.parse(safeInput.baseline_settings);
      candidateSettings = maplessSettingsInventorySchema.parse(safeInput.candidate_settings);
    }
  } catch {
    throw new SyntxMaintenanceAuditPlanError("INVALID_INPUT");
  }

  let report: SyntxMaintenanceReportV1;
  try {
    report = compareSyntxMaintenanceSnapshots({
      baseline_public: baseline,
      candidate_public: candidate,
      ...(baselineSettings === undefined ? {} : {
        baseline_settings: baselineSettings,
        candidate_settings: candidateSettings as MaplessSettingsInventory
      })
    });
  } catch {
    throw new SyntxMaintenanceAuditPlanError("INVALID_INPUT");
  }

  const baselineIdentity = sourceIdentity(baseline, baselineSettings);
  const candidateIdentity = sourceIdentity(candidate, candidateSettings);
  const inputCheckpoint = splitInput.hasCheckpoint
    ? parseCheckpoint(splitInput.checkpoint)
    : null;
  const checkpointState = resumeCheckpoint(
    inputCheckpoint,
    baselineIdentity,
    candidateIdentity,
    report,
    new Set(baseline.models.map((model) => model.value)),
    new Set(candidate.models.map((model) => model.value))
  );
  const changedIds = changedModelIds(report);
  const candidateIds = new Set(candidate.models.map((model) => model.value));
  const modelRows = candidate.models.map((model) => ({
    model_id: model.value,
    modality: inferModality(model, candidate),
    mandatory_gate: inferModality(model, candidate) !== "text",
    affected: changedIds.has(model.value),
    obligations: ALL_OBLIGATIONS.map((id) => ({
      id,
      status: id === "account_access"
        ? "NOT_VISITED" as const
        : checkpointState.statuses.get(observationKey(model.value, id)) ?? "NOT_VISITED" as const
    }))
  })).sort((left, right) => MODALITY_ORDER[left.modality] - MODALITY_ORDER[right.modality] || compareText(left.model_id, right.model_id));

  const queue = modelRows.filter((model) => model.affected).map((model) => model.model_id);
  const removed = report.deltas.models.removed_ids.slice().sort(compareText);
  const observations = modelRows.flatMap((model) => model.obligations.flatMap((obligation) => {
    if (obligation.id === "account_access" ||
        (obligation.status !== "OBSERVED" && obligation.status !== "UNSUPPORTED")) return [];
    return [{
      model_id: model.model_id,
      obligation: obligation.id as Exclude<SyntxMaintenanceAuditObligation, "account_access">,
      status: obligation.status
    }];
  })).sort(compareObservation);

  return Object.freeze({
    schema_version: "1.0.0",
    operation: "INCREMENTAL_AUDIT_PLAN",
    source_identity: candidateIdentity,
    report,
    census: Object.freeze({
      total_models: modelRows.length,
      models: Object.freeze(modelRows.map((model) => Object.freeze({
        ...model,
        obligations: Object.freeze(model.obligations.map((obligation) => Object.freeze(obligation)))
      }))),
      removed_model_ids: Object.freeze(removed)
    }),
    affected_queue: Object.freeze({ model_ids: Object.freeze(queue) }),
    impact: Object.freeze({
      settings_status: report.settings.impact_status,
      mapping_partial: report.settings.impact_status === "NOT_CHECKED" ||
        report.settings.impact_status === "FORM_BOUND_PARTIAL" ||
        report.settings.impact_status === "SHARED_HELPER_PARTIAL",
      affected_model_ids: Object.freeze([...changedIds].filter((id) => candidateIds.has(id)).sort(compareText))
    }),
    checkpoint_resume: Object.freeze({
      status: checkpointState.status,
      carried_observation_count: observations.length,
      stale_model_ids: Object.freeze(checkpointState.staleModelIds)
    }),
    checkpoint_template: Object.freeze({
      schema_version: "1.0.0",
      source_identity: candidateIdentity,
      observations: Object.freeze(observations.map((observation) => Object.freeze(observation)))
    }),
    coverage: Object.freeze({
      public_control_observations: "USER_DECLARED_ONLY",
      account_access: "NOT_CHECKED",
      rendered_ui: "NOT_CHECKED",
      provider_acceptance: "NOT_CHECKED"
    }),
    automatic_runtime_promotion: false,
    paid_operations: false
  });
}

function sourceIdentity(
  publicSnapshot: SyntxPublicCatalogSnapshot,
  settings?: MaplessSettingsInventory
): SyntxMaintenanceAuditSourceIdentity {
  const publicBytes = serializeSyntxPublicCatalogSnapshot(publicSnapshot);
  const publicDigest = sha256(publicBytes);
  const settingsBytes = settings === undefined ? null : serializeMaplessSettingsInventory(settings);
  const settingsDigest = settingsBytes === null ? null : sha256(settingsBytes);
  return Object.freeze({
    public_version: `sha256-${publicDigest}.json`,
    public_hash: `sha256:${publicDigest}`,
    settings_version: settingsDigest === null ? null : `sha256-${settingsDigest}.json`,
    settings_hash: settingsDigest === null ? null : `sha256:${settingsDigest}`
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function inferModality(
  model: SyntxPublicCatalogSnapshot["models"][number],
  snapshot: SyntxPublicCatalogSnapshot
): SyntxMaintenanceAuditModality {
  const matchingAi = snapshot.ai.filter((item) => item.value === model.ai_name);
  if (matchingAi.length !== 1) return "unknown";
  const scope = matchingAi[0]?.scope;
  switch (scope) {
    case "image":
    case "tool_image_inpaint":
    case "tool_image_upscaler":
      return "image";
    case "video":
    case "tool_video_inpaint":
    case "tool_video_upscaler":
      return "video";
    case "audio": return "audio";
    case "text": return "text";
    case "other": return "other";
    default: return "unknown";
  }
}

function changedModelIds(report: SyntxMaintenanceReportV1): Set<string> {
  return new Set([
    ...report.deltas.models.added_ids,
    ...report.deltas.models.changed.map((model) => model.id),
    ...report.public_source_hashes.affected_model_ids,
    ...report.settings.affected_model_ids
  ]);
}

function parseCheckpoint(value: unknown): SyntxMaintenanceAuditCheckpointV1 {
  let safe: unknown;
  try { safe = safeCopy(value, 600_000, 1024 * 1024); }
  catch { throw new SyntxMaintenanceAuditPlanError("UNSAFE_CHECKPOINT"); }
  if (!isRecord(safe) || !exactKeys(safe, ["schema_version", "source_identity", "observations"]) ||
      safe.schema_version !== "1.0.0" || !isRecord(safe.source_identity) ||
      !exactKeys(safe.source_identity, ["public_version", "public_hash", "settings_version", "settings_hash"]) ||
      !Array.isArray(safe.observations) || safe.observations.length > 80_000) {
    throw new SyntxMaintenanceAuditPlanError("UNSAFE_CHECKPOINT");
  }
  const identity = safe.source_identity;
  if (typeof identity.public_version !== "string" || !/^sha256-[a-f0-9]{64}\.json$/u.test(identity.public_version) ||
      typeof identity.public_hash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(identity.public_hash) ||
      !(identity.settings_version === null || (typeof identity.settings_version === "string" && /^sha256-[a-f0-9]{64}\.json$/u.test(identity.settings_version))) ||
      !(identity.settings_hash === null || (typeof identity.settings_hash === "string" && /^sha256:[a-f0-9]{64}$/u.test(identity.settings_hash))) ||
      (identity.settings_version === null) !== (identity.settings_hash === null)) {
    throw new SyntxMaintenanceAuditPlanError("UNSAFE_CHECKPOINT");
  }
  const seen = new Set<string>();
  const observations = safe.observations.map((item) => {
    if (!isRecord(item) || !exactKeys(item, ["model_id", "obligation", "status"]) ||
        typeof item.model_id !== "string" || !CHECKPOINT_MODEL_ID.test(item.model_id) ||
        typeof item.obligation !== "string" || !(PUBLIC_OBLIGATIONS as readonly string[]).includes(item.obligation) ||
        item.status !== "OBSERVED" && item.status !== "UNSUPPORTED") {
      throw new SyntxMaintenanceAuditPlanError("UNSAFE_CHECKPOINT");
    }
    const key = observationKey(item.model_id, item.obligation as Exclude<SyntxMaintenanceAuditObligation, "account_access">);
    if (seen.has(key)) throw new SyntxMaintenanceAuditPlanError("UNSAFE_CHECKPOINT");
    seen.add(key);
    return Object.freeze({
      model_id: item.model_id,
      obligation: item.obligation as Exclude<SyntxMaintenanceAuditObligation, "account_access">,
      status: item.status
    });
  }).sort(compareObservation);
  return Object.freeze({
    schema_version: "1.0.0",
    source_identity: Object.freeze({
      public_version: identity.public_version,
      public_hash: identity.public_hash,
      settings_version: identity.settings_version,
      settings_hash: identity.settings_hash
    }),
    observations: Object.freeze(observations)
  });
}

function resumeCheckpoint(
  checkpoint: SyntxMaintenanceAuditCheckpointV1 | null,
  baseline: SyntxMaintenanceAuditSourceIdentity,
  candidate: SyntxMaintenanceAuditSourceIdentity,
  report: SyntxMaintenanceReportV1,
  baselineModelIds: ReadonlySet<string>,
  candidateModelIds: ReadonlySet<string>
): { status: SyntxMaintenanceAuditPlanV1["checkpoint_resume"]["status"]; statuses: Map<string, SyntxMaintenanceAuditStatus>; staleModelIds: string[] } {
  const statuses = new Map<string, SyntxMaintenanceAuditStatus>();
  if (checkpoint === null) return { status: "NONE", statuses, staleModelIds: [] };
  const source = checkpoint.source_identity;
  const exactCandidate = sameIdentity(source, candidate);
  const exactBaseline = sameIdentity(source, baseline);
  if (!exactCandidate && !exactBaseline) throw new SyntxMaintenanceAuditPlanError("CHECKPOINT_SOURCE_MISMATCH");
  const sourceModelIds = exactCandidate ? candidateModelIds : baselineModelIds;
  if (checkpoint.observations.some((item) => !sourceModelIds.has(item.model_id))) {
    throw new SyntxMaintenanceAuditPlanError("UNSAFE_CHECKPOINT");
  }
  if (exactCandidate) {
    for (const item of checkpoint.observations) statuses.set(observationKey(item.model_id, item.obligation), item.status);
    return { status: "EXACT_SOURCE", statuses, staleModelIds: [] };
  }
  const affected = changedModelIds(report);
  const stale = new Set<string>();
  for (const item of checkpoint.observations) {
    if (affected.has(item.model_id) || !candidateModelIds.has(item.model_id)) stale.add(item.model_id);
    else statuses.set(observationKey(item.model_id, item.obligation), item.status);
  }
  return {
    status: statuses.size > 0 ? "CARRIED_UNAFFECTED" : "SOURCE_CHANGED_RESET",
    statuses,
    staleModelIds: [...stale].sort(compareText)
  };
}

function splitPlanInput(value: unknown): { value: Record<string, unknown>; hasCheckpoint: boolean; checkpoint: unknown } {
  if (typeof value !== "object" || value === null || Array.isArray(value) || types.isProxy(value)) {
    throw new SyntxMaintenanceAuditPlanError("INVALID_INPUT");
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error();
    const copied: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const allowed = new Set(["baseline_public", "candidate_public", "baseline_settings", "candidate_settings", "checkpoint"]);
    let hasCheckpoint = false;
    let checkpoint: unknown;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || !allowed.has(key)) throw new Error();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
        if (key === "checkpoint") throw new SyntxMaintenanceAuditPlanError("UNSAFE_CHECKPOINT");
        throw new Error();
      }
      if (key === "checkpoint") {
        hasCheckpoint = true;
        checkpoint = descriptor.value;
      } else {
        copied[key] = descriptor.value;
      }
    }
    return { value: copied, hasCheckpoint, checkpoint };
  } catch (error) {
    if (error instanceof SyntxMaintenanceAuditPlanError) throw error;
    throw new SyntxMaintenanceAuditPlanError("INVALID_INPUT");
  }
}

function sameIdentity(left: SyntxMaintenanceAuditSourceIdentity, right: SyntxMaintenanceAuditSourceIdentity): boolean {
  return left.public_version === right.public_version && left.public_hash === right.public_hash &&
    left.settings_version === right.settings_version && left.settings_hash === right.settings_hash;
}

function safeCopy(value: unknown, maxNodes: number, maxText: number): unknown {
  let nodes = 0;
  let text = 0;
  const seen = new Set<object>();
  const visit = (current: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > maxNodes || depth > 48) throw new SyntxMaintenanceAuditPlanError("INVALID_INPUT");
    if (typeof current === "string") {
      text += current.length;
      if (text > maxText) throw new SyntxMaintenanceAuditPlanError("INVALID_INPUT");
      return current;
    }
    if (current === null || typeof current === "boolean" || typeof current === "number") return current;
    if (typeof current !== "object" || types.isProxy(current) || seen.has(current)) {
      throw new SyntxMaintenanceAuditPlanError("INVALID_INPUT");
    }
    seen.add(current);
    try {
      if (Array.isArray(current)) {
        if (Object.getPrototypeOf(current) !== Array.prototype || current.length > maxNodes) {
          throw new SyntxMaintenanceAuditPlanError("INVALID_INPUT");
        }
        const output: unknown[] = [];
        for (let index = 0; index < current.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
          if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
            throw new SyntxMaintenanceAuditPlanError("INVALID_INPUT");
          }
          output.push(visit(descriptor.value, depth + 1));
        }
        if (Reflect.ownKeys(current).some((key) => typeof key === "symbol" ||
            (key !== "length" && !(typeof key === "string" && /^(?:0|[1-9]\d*)$/u.test(key) && Number(key) < current.length)))) {
          throw new SyntxMaintenanceAuditPlanError("INVALID_INPUT");
        }
        return output;
      }
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) throw new SyntxMaintenanceAuditPlanError("INVALID_INPUT");
      const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of Reflect.ownKeys(current)) {
        if (typeof key !== "string" || key.length > 256 || key === "__proto__") {
          throw new SyntxMaintenanceAuditPlanError("INVALID_INPUT");
        }
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
          throw new SyntxMaintenanceAuditPlanError("INVALID_INPUT");
        }
        text += key.length;
        if (text > maxText) throw new SyntxMaintenanceAuditPlanError("INVALID_INPUT");
        output[key] = visit(descriptor.value, depth + 1);
      }
      return output;
    } catch (error) {
      if (error instanceof SyntxMaintenanceAuditPlanError) throw error;
      throw new SyntxMaintenanceAuditPlanError("INVALID_INPUT");
    } finally {
      seen.delete(current);
    }
  };
  return visit(value, 0);
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const found = Object.keys(record).sort(compareText);
  const expected = [...keys].sort(compareText);
  return found.length === expected.length && found.every((key, index) => key === expected[index]);
}

function onlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(record).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function observationKey(modelId: string, obligation: string): string {
  return `${modelId}\u0000${obligation}`;
}

function compareObservation(
  left: { model_id: string; obligation: string },
  right: { model_id: string; obligation: string }
): number {
  return compareText(left.model_id, right.model_id) || compareText(left.obligation, right.obligation);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
