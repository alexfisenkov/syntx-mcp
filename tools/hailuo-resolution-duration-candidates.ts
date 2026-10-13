import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { MaplessSettingsInventory } from "../src/catalog/mapless-settings-inventory.js";
import type { SyntxPublicCatalogSnapshot } from "../src/catalog/syntx-public-catalog.js";
import { serializeSyntxPublicCatalogSnapshot } from "../src/catalog/syntx-public-catalog.js";
import { createImmutableJsonSnapshot } from "./settings-ir/immutable-json-snapshot.js";

export const HAILUO_CANDIDATE_PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
export const HAILUO_CANDIDATE_SETTINGS_VERSION = "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json";
const SOURCE_HASH = "sha256:cb839f2df681fdd0043cb73a477fb4576aef830f37d6d87418b422a17e5a3cb9";
const SOURCE_BYTES = 13501;
const FACT_TREE_HASH = "f70555b7b51db72e5f7d0eb33023945c9bdc1af59ea342a40a577a9d3d117f97";
const COHORT = ["hailuo-01", "hailuo-01-director", "hailuo-01-live", "hailuo-01-live-character", "hailuo-02", "hailuo-2.3", "hailuo-2.3-fast", "hailuo-3.0", "hailuo-minimax"] as const;
const SPECIAL = "hailuo-3.0";
const PUBLIC_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "hailuo-01": "Hailuo-01",
  "hailuo-01-director": "Hailuo-01 Director",
  "hailuo-01-live": "Hailuo-01 Live",
  "hailuo-01-live-character": "Hailuo-01 Live Character",
  "hailuo-02": "Hailuo-02",
  "hailuo-2.3": "Hailuo 2.3",
  "hailuo-2.3-fast": "Hailuo 2.3 Fast",
  "hailuo-3.0": "Hailuo 3.0",
  "hailuo-minimax": "Hailuo MiniMax"
});
const CURATED_ARTIFACTS = new WeakSet<object>();

export interface HailuoResolutionDurationCandidateInput {
  readonly publicCatalog: SyntxPublicCatalogSnapshot;
  readonly publicVersion: string;
  readonly settingsInventory: MaplessSettingsInventory;
  readonly settingsVersion: string;
  readonly sourceFacts: unknown;
  readonly reviewedAt: string;
  readonly generatedAt?: () => Date;
}

interface Candidate { readonly value: string; readonly durations: readonly number[] }
interface CohortRow {
  readonly model_id: typeof COHORT[number];
  readonly public_binding: { readonly ai_name: string; readonly value: string; readonly label: string };
  readonly selector_binding: "DYNAMIC_SOURCE_CANDIDATE" | "EXCLUDED_BY_VALUE_FILTER";
  readonly resolution_candidates_status: "FINITE_UI_CANDIDATE" | "UNRESOLVED";
  readonly resolution_candidates: readonly Candidate[];
  readonly duration_control: { readonly kind: "select"; readonly values: readonly number[] } | { readonly kind: "integer_slider"; readonly min: 4; readonly max: 15; readonly step: 1; readonly ui_reset_candidate: 5 } | null;
  readonly form_reset_candidate: { readonly resolution: string; readonly video_duration: number } | null;
  readonly aspect_ratio_visibility: "UNKNOWN";
}

export interface HailuoResolutionDurationCandidatesArtifact {
  readonly schema_version: "1.0.0";
  readonly ticket: "65";
  readonly catalog_kind: "HAILUO_RESOLUTION_DURATION_SOURCE_CANDIDATES";
  readonly evidence_scope: "STATIC_FRONTEND_UI_CANDIDATES";
  readonly runtime_usable: false;
  readonly backend_acceptance: false;
  readonly source_persisted: false;
  readonly public_version: typeof HAILUO_CANDIDATE_PUBLIC_VERSION;
  readonly settings_version: typeof HAILUO_CANDIDATE_SETTINGS_VERSION;
  readonly build_id: "1791467421";
  readonly source_identity: { readonly module_name: "hailuo-minimax.js"; readonly url: "https://syntx.ai/assets/1791467421/hailuo-minimax.js"; readonly bytes: 13501; readonly sha256: typeof SOURCE_HASH };
  readonly source_fact_tree_sha256: string;
  readonly provenance: { readonly client_fetch_utc_exact: null; readonly client_fetch_utc_capture_status: "NOT_LATCHED_AT_FETCH"; readonly client_fetch_utc_estimate: "2026-10-09T01:45:33Z"; readonly response_date_utc: "2026-10-09T01:45:33Z"; readonly response_date_utc_role: "HTTP_DATE_ESTIMATE_ONLY"; readonly anonymous_get_count: 1; readonly body_written_or_printed: false };
  readonly dynamic_selector: { readonly source: "getModelsByAiName(provider_name).filter(model.value !== provider_name)"; readonly provider_name: "hailuo-minimax"; readonly membership_runtime_verified: false };
  readonly cohort: readonly CohortRow[];
  readonly unresolved: { readonly aspect_ratio_per_model_visibility: "UNKNOWN"; readonly backend_defaults: "UNKNOWN"; readonly requiredness: "UNKNOWN"; readonly cost: "UNKNOWN"; readonly operation_id: "NOT_PRESENT_IN_PINNED_CATALOG" };
  readonly generated_at: string;
  readonly reviewed_at: string;
}

const rowSchema = z.object({
  model_id: z.enum(COHORT),
  public_binding: z.object({ ai_name: z.string().min(1), value: z.string().min(1), label: z.string().min(1) }).strict(),
  selector_binding: z.enum(["DYNAMIC_SOURCE_CANDIDATE", "EXCLUDED_BY_VALUE_FILTER"]),
  resolution_candidates_status: z.enum(["FINITE_UI_CANDIDATE", "UNRESOLVED"]),
  resolution_candidates: z.array(z.object({ value: z.string().min(1), durations: z.array(z.number().int().positive()) }).strict()),
  duration_control: z.union([z.object({ kind: z.literal("select"), values: z.array(z.number().int().positive()) }).strict(), z.object({ kind: z.literal("integer_slider"), min: z.literal(4), max: z.literal(15), step: z.literal(1), ui_reset_candidate: z.literal(5) }).strict()]).nullable(),
  form_reset_candidate: z.object({ resolution: z.string().min(1), video_duration: z.number().int().positive() }).strict().nullable(),
  aspect_ratio_visibility: z.literal("UNKNOWN")
}).strict();
const artifactSchema = z.object({
  schema_version: z.literal("1.0.0"), ticket: z.literal("65"), catalog_kind: z.literal("HAILUO_RESOLUTION_DURATION_SOURCE_CANDIDATES"), evidence_scope: z.literal("STATIC_FRONTEND_UI_CANDIDATES"),
  runtime_usable: z.literal(false), backend_acceptance: z.literal(false), source_persisted: z.literal(false),
  public_version: z.literal(HAILUO_CANDIDATE_PUBLIC_VERSION), settings_version: z.literal(HAILUO_CANDIDATE_SETTINGS_VERSION), build_id: z.literal("1791467421"),
  source_identity: z.object({ module_name: z.literal("hailuo-minimax.js"), url: z.literal("https://syntx.ai/assets/1791467421/hailuo-minimax.js"), bytes: z.literal(SOURCE_BYTES), sha256: z.literal(SOURCE_HASH) }).strict(),
  source_fact_tree_sha256: z.literal("sha256:" + FACT_TREE_HASH),
  provenance: z.object({ client_fetch_utc_exact: z.null(), client_fetch_utc_capture_status: z.literal("NOT_LATCHED_AT_FETCH"), client_fetch_utc_estimate: z.literal("2026-10-09T01:45:33Z"), response_date_utc: z.literal("2026-10-09T01:45:33Z"), response_date_utc_role: z.literal("HTTP_DATE_ESTIMATE_ONLY"), anonymous_get_count: z.literal(1), body_written_or_printed: z.literal(false) }).strict(),
  dynamic_selector: z.object({ source: z.literal("getModelsByAiName(provider_name).filter(model.value !== provider_name)"), provider_name: z.literal("hailuo-minimax"), membership_runtime_verified: z.literal(false) }).strict(),
  cohort: z.array(rowSchema).length(9),
  unresolved: z.object({ aspect_ratio_per_model_visibility: z.literal("UNKNOWN"), backend_defaults: z.literal("UNKNOWN"), requiredness: z.literal("UNKNOWN"), cost: z.literal("UNKNOWN"), operation_id: z.literal("NOT_PRESENT_IN_PINNED_CATALOG") }).strict(),
  generated_at: z.string().datetime({ offset: true }), reviewed_at: z.string().datetime({ offset: true })
}).strict();

export function curateHailuoResolutionDurationCandidates(input: HailuoResolutionDurationCandidateInput): HailuoResolutionDurationCandidatesArtifact {
  let serializedCatalog: string;
  try { serializedCatalog = serializeSyntxPublicCatalogSnapshot(input.publicCatalog); }
  catch { throw new Error("HAILUO_CATALOG_BINDING_INVALID"); }
  if (input.publicVersion !== HAILUO_CANDIDATE_PUBLIC_VERSION || input.settingsVersion !== HAILUO_CANDIDATE_SETTINGS_VERSION || input.settingsInventory.public_catalog.version !== HAILUO_CANDIDATE_PUBLIC_VERSION || input.settingsInventory.build.id !== "1791467421" || hash(serializedCatalog) !== HAILUO_CANDIDATE_PUBLIC_VERSION.slice(7, -5)) throw new Error("HAILUO_CATALOG_BINDING_INVALID");
  if (hash(canonicalJson(input.sourceFacts)) !== FACT_TREE_HASH) throw new Error("HAILUO_FACT_TREE_INVALID");
  if (input.settingsInventory.app_sha256 !== "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf") throw new Error("HAILUO_SOURCE_BINDING_INVALID");
  const form = input.settingsInventory.forms.find(item => item.form_id === "hailuo-minimax");
  if (!form || form.module_name !== "hailuo-minimax.js" || form.javascript.bytes !== SOURCE_BYTES || form.javascript.sha256 !== SOURCE_HASH) throw new Error("HAILUO_SOURCE_BINDING_INVALID");
  const inventoryRows = input.settingsInventory.models.filter(item => item.form_id === "hailuo-minimax" && item.active);
  const publicRows = input.publicCatalog.models.filter(item => item.ai_name === "hailuo-minimax" && item.active);
  const ids = (items: readonly { model_id?: string; value?: string }[]) => items.map(item => item.model_id ?? item.value).sort();
  if (!isDeepStrictEqual(ids(inventoryRows), [...COHORT].sort()) || !isDeepStrictEqual(ids(publicRows), [...COHORT].sort())) throw new Error("HAILUO_COHORT_BINDING_INVALID");

  const facts = input.sourceFacts as any;
  const rows: CohortRow[] = COHORT.map(model_id => {
    const model = publicRows.find(item => item.value === model_id);
    if (!model) throw new Error("HAILUO_COHORT_BINDING_INVALID");
    const public_binding = { ai_name: model.ai_name, value: model.value, label: model.label };
    if (model_id === "hailuo-minimax") return { model_id, public_binding, selector_binding: "EXCLUDED_BY_VALUE_FILTER", resolution_candidates_status: "UNRESOLVED", resolution_candidates: [], duration_control: null, form_reset_candidate: null, aspect_ratio_visibility: "UNKNOWN" };
    if (model_id === SPECIAL) return {
      model_id, public_binding, selector_binding: "DYNAMIC_SOURCE_CANDIDATE", resolution_candidates_status: "FINITE_UI_CANDIDATE",
      resolution_candidates: facts.ast_bindings.resolution_getter_Y.if_u_true.It.map((value: string) => ({ value, durations: [...facts.ast_bindings.duration_renderer.if_u_true.integer_ui_candidates] })),
      duration_control: { kind: "integer_slider", min: 4, max: 15, step: 1, ui_reset_candidate: facts.ast_bindings.duration_renderer.if_u_true.default_candidate },
      form_reset_candidate: { resolution: facts.ast_bindings.default_getter_D.if_u_true.resolution, video_duration: facts.ast_bindings.default_getter_D.if_u_true.video_duration }, aspect_ratio_visibility: "UNKNOWN"
    };
    const resolutionMap = facts.ast_bindings.per_model_resolution_map as Record<string, string[]>;
    const compatibility = facts.ast_bindings.resolution_duration_compatibility as Record<string, number[]>;
    const candidates = resolutionMap[model_id]!.map(value => ({ value, durations: [...compatibility[value]!] }));
    const shortModels: string[] = facts.ast_bindings.default_getter_D.otherwise_if_model_type_in_he.he;
    const reset = shortModels.includes(model_id) ? facts.ast_bindings.default_getter_D.otherwise_if_model_type_in_he : facts.ast_bindings.default_getter_D.otherwise;
    return { model_id, public_binding, selector_binding: "DYNAMIC_SOURCE_CANDIDATE", resolution_candidates_status: "FINITE_UI_CANDIDATE", resolution_candidates: candidates, duration_control: { kind: "select", values: [...new Set(candidates.flatMap(candidate => candidate.durations))].sort((a, b) => a - b) }, form_reset_candidate: { resolution: reset.resolution, video_duration: reset.video_duration }, aspect_ratio_visibility: "UNKNOWN" };
  });
  if (!Number.isFinite(Date.parse(input.reviewedAt)) || !input.reviewedAt.endsWith("Z")) throw new Error("HAILUO_REVIEW_TIMESTAMP_INVALID");
  const artifact: HailuoResolutionDurationCandidatesArtifact = deepFreeze({
    schema_version: "1.0.0", ticket: "65", catalog_kind: "HAILUO_RESOLUTION_DURATION_SOURCE_CANDIDATES", evidence_scope: "STATIC_FRONTEND_UI_CANDIDATES",
    runtime_usable: false, backend_acceptance: false, source_persisted: false, public_version: input.publicVersion as HailuoResolutionDurationCandidatesArtifact["public_version"], settings_version: input.settingsVersion as HailuoResolutionDurationCandidatesArtifact["settings_version"], build_id: "1791467421",
    source_identity: { module_name: "hailuo-minimax.js", url: "https://syntx.ai/assets/1791467421/hailuo-minimax.js", bytes: SOURCE_BYTES, sha256: SOURCE_HASH },
    source_fact_tree_sha256: "sha256:" + FACT_TREE_HASH,
    provenance: { client_fetch_utc_exact: null, client_fetch_utc_capture_status: "NOT_LATCHED_AT_FETCH", client_fetch_utc_estimate: "2026-10-09T01:45:33Z", response_date_utc: "2026-10-09T01:45:33Z", response_date_utc_role: "HTTP_DATE_ESTIMATE_ONLY", anonymous_get_count: 1, body_written_or_printed: false },
    dynamic_selector: { source: "getModelsByAiName(provider_name).filter(model.value !== provider_name)", provider_name: "hailuo-minimax", membership_runtime_verified: false },
    cohort: rows, unresolved: { aspect_ratio_per_model_visibility: "UNKNOWN", backend_defaults: "UNKNOWN", requiredness: "UNKNOWN", cost: "UNKNOWN", operation_id: "NOT_PRESENT_IN_PINNED_CATALOG" },
    generated_at: (input.generatedAt ?? (() => new Date()))().toISOString(), reviewed_at: input.reviewedAt
  });
  CURATED_ARTIFACTS.add(artifact);
  return artifact;
}

export async function archiveHailuoResolutionDurationCandidates(artifact: HailuoResolutionDurationCandidatesArtifact, projectRoot: string): Promise<{ path: string; sha256: string; status: "created" }> {
  validateArtifact(artifact);
  const serialized = JSON.stringify(artifact, null, 2) + "\n";
  const digest = hash(serialized);
  const path = join(resolve(projectRoot), "catalog", "runtime", "v26", "sha256-" + digest + ".json");
  try { await createImmutableJsonSnapshot(path, serialized, { maxBytes: 256 * 1024 }); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "IMMUTABLE_SNAPSHOT_TARGET_EXISTS") throw new Error("HAILUO_ARTIFACT_ALREADY_EXISTS");
    throw error;
  }
  if (await readFile(path, "utf8") !== serialized) throw new Error("HAILUO_ARTIFACT_READBACK_MISMATCH");
  return { path, sha256: digest, status: "created" };
}

function validateArtifact(value: unknown): asserts value is HailuoResolutionDurationCandidatesArtifact {
  if (typeof value !== "object" || value === null) throw new Error("HAILUO_ARTIFACT_INVALID");
  const parsed = artifactSchema.safeParse(value);
  if (!parsed.success) throw new Error("HAILUO_ARTIFACT_INVALID");
  const cohort = parsed.data.cohort;
  if (!isDeepStrictEqual(cohort.map(row => row.model_id), COHORT)) throw new Error("HAILUO_ARTIFACT_INVALID");
  const root = cohort[8];
  const special = cohort[7];
  if (!root || root.selector_binding !== "EXCLUDED_BY_VALUE_FILTER" || root.resolution_candidates_status !== "UNRESOLVED" || root.resolution_candidates.length !== 0 || root.form_reset_candidate !== null || !special || special.duration_control?.kind !== "integer_slider" || special.resolution_candidates.map(row => row.value).join(",") !== "768p,2K") throw new Error("HAILUO_ARTIFACT_INVALID");
  const expected: Record<string, readonly Candidate[]> = {
    "hailuo-01": [{ value: "720p", durations: [6] }],
    "hailuo-01-director": [{ value: "720p", durations: [6] }],
    "hailuo-01-live": [{ value: "720p", durations: [6] }],
    "hailuo-01-live-character": [{ value: "720p", durations: [6] }],
    "hailuo-02": [{ value: "512p", durations: [6, 10] }, { value: "768p", durations: [6, 10] }, { value: "1080p", durations: [6] }],
    "hailuo-2.3": [{ value: "768p", durations: [6, 10] }, { value: "1080p", durations: [6] }],
    "hailuo-2.3-fast": [{ value: "768p", durations: [6, 10] }, { value: "1080p", durations: [6] }]
  };
  for (const row of cohort) {
    if (row.public_binding.value !== row.model_id || row.public_binding.ai_name !== "hailuo-minimax" || row.public_binding.label !== PUBLIC_LABELS[row.model_id]) throw new Error("HAILUO_ARTIFACT_INVALID");
    if (row.model_id === "hailuo-minimax") continue;
    if (row.model_id === SPECIAL) {
      const uiDurations = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
      if (!isDeepStrictEqual(row.resolution_candidates, [{ value: "768p", durations: uiDurations }, { value: "2K", durations: uiDurations }]) || !isDeepStrictEqual(row.duration_control, { kind: "integer_slider", min: 4, max: 15, step: 1, ui_reset_candidate: 5 }) || !isDeepStrictEqual(row.form_reset_candidate, { resolution: "2K", video_duration: 5 })) throw new Error("HAILUO_ARTIFACT_INVALID");
      continue;
    }
    const candidates = expected[row.model_id];
    if (!candidates || !isDeepStrictEqual(row.resolution_candidates, candidates)) throw new Error("HAILUO_ARTIFACT_INVALID");
    const reset = row.model_id.startsWith("hailuo-01") ? { resolution: "720p", video_duration: 6 } : { resolution: "768p", video_duration: 6 };
    const durations = [...new Set(candidates.flatMap(candidate => candidate.durations))].sort((a, b) => a - b);
    if (!isDeepStrictEqual(row.form_reset_candidate, reset) || !isDeepStrictEqual(row.duration_control, { kind: "select", values: durations })) throw new Error("HAILUO_ARTIFACT_INVALID");
  }
  if (!CURATED_ARTIFACTS.has(value)) throw new Error("HAILUO_ARTIFACT_NOT_CURATED");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => JSON.stringify(key) + ":" + canonicalJson(item)).join(",") + "}";
  return JSON.stringify(value);
}
function hash(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
