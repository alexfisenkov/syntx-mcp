import { createHash, randomUUID } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { link, mkdir, open, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod/v4";
import type { DiscoveryModelRecord } from "./discovery-catalog.js";
import { getPublicCatalogDirectory } from "./public-catalog-history.js";
import type { SyntxPublicCatalogSnapshot } from "./syntx-public-catalog.js";
import type { MaplessSettingsInventory } from "./mapless-settings-inventory.js";

export const KLING_SOURCE_GUARD_V27_PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json" as const;
export const KLING_SOURCE_GUARD_V27_SETTINGS_VERSION = "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json" as const;
export const KLING_SOURCE_GUARD_V27_PUBLIC_MODELS_SHA256 = "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444" as const;
export const KLING_SOURCE_GUARD_V27_SOURCE_SHA256 = "sha256:98b0275d23ce3c822b4f3ee860fb4ee673d001d300a5dd947a2bd496000a6963" as const;
export const KLING_SOURCE_GUARD_V27_SOURCE_MODULE = "kling.js" as const;
export const KLING_SOURCE_GUARD_V27_SOURCE_URL = "https://syntx.ai/assets/1791467421/kling.js" as const;
export const KLING_SOURCE_GUARD_V27_RESULT_JSON_SHA256 = "sha256:dc39ca50a384e62b8609861a2537a73ad690f5356826a663fb56991bf2cc496c" as const;
export const KLING_SOURCE_GUARD_V27_RESULT_MARKDOWN_SHA256 = "sha256:e5180bcfaf8e8b4ae56e683a3ac1d6be3e791be8cfc749cf5a6ea1f3e0428325" as const;
export const KLING_SOURCE_GUARD_V27_VERSION = "sha256-TO_BE_PINNED.json" as const;
export const KLING_SOURCE_GUARD_V27_SHA256 = "sha256:TO_BE_PINNED" as const;

const MAX_ARTIFACT_BYTES = 512 * 1024;
const MAX_AST_NODES = 100_000;
const MODEL_IDS = ["kling_elements", "kling_image2video", "kling_keyframes", "kling_motion_control", "kling_o1_image2video", "kling_o1_text2video", "kling_o1_video2video", "kling_text2video"] as const;
type KlingModelId = (typeof MODEL_IDS)[number];
const literalString = z.string().min(1).max(80);
const versionGuardSchema = z.object({
  kind: z.enum(["RETAIN_GUARD_VALUES", "FIXED_ASSIGNMENT", "CLEARED"]),
  guard_values: z.array(z.string().max(32)).max(16),
  fallback_assignment: z.string().max(32).nullable()
}).strict();
const durationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ALWAYS_TRUE_NO_FINITE_ENUM") }).strict(),
  z.object({ kind: z.literal("RANGE_GUARD_CANDIDATE"), minimum: z.literal(3), maximum: z.literal(10) }).strict(),
  z.object({
    kind: z.literal("CONDITIONAL_SOURCE_GUARD_CANDIDATE"),
    source_file_absent: z.object({ predicate: z.literal("UNKNOWN"), accepted_values: z.tuple([z.literal(5), z.literal(10)]) }).strict(),
    source_file_metadata_present: z.object({ predicate: z.literal("UNKNOWN"), requested_duration: z.literal("ROUND_METADATA_DURATION") }).strict(),
    source_file_metadata_absent: z.object({ predicate: z.literal("UNKNOWN"), minimum: z.literal(3), maximum: z.literal(10) }).strict()
  }).strict()
]);
const guardRowSchema = z.object({
  model_id: z.enum(MODEL_IDS),
  public_binding: z.object({ model_id: z.enum(MODEL_IDS), ai_name: z.literal("kling"), active: z.literal(true), value: z.enum(MODEL_IDS), label: z.string().min(1).max(500) }).strict(),
  settings_binding: z.object({ model_id: z.enum(MODEL_IDS), form_id: z.literal("kling"), form_source_sha256: z.literal(KLING_SOURCE_GUARD_V27_SOURCE_SHA256), settings_status: z.literal("PUBLIC_SETTINGS_KNOWN"), defaults_status: z.literal("UNKNOWN"), runtime_usable: z.literal(false) }).strict(),
  version: versionGuardSchema,
  mode: z.object({ source_literals: z.tuple([z.literal("standart"), z.literal("hd")]), normalization_fallback: z.literal("hd"), validator_requirement: z.literal("hd").nullable(), selectable_options: z.literal("UNKNOWN") }).strict(),
  duration: durationSchema,
  fallback_assignments: z.object({ mode: z.string().max(32).nullable(), temperature: z.string().max(32).nullable(), gen_type: z.literal("mcv").nullable(), aspect_ratio: z.enum(["16:9", "1:1"]).nullable() }).strict(),
  multi_shots_deleted: z.boolean(),
  camera_movement_cleared: z.boolean()
}).strict();
const excludedSchema = z.object({ model_id: z.literal("kling-kolors"), active: z.literal(false), form_id: z.null(), reason: z.literal("not bound to the current Kling form") }).strict();
const provenanceSchema = z.object({
  result_json_sha256: z.literal(KLING_SOURCE_GUARD_V27_RESULT_JSON_SHA256),
  result_markdown_sha256: z.literal(KLING_SOURCE_GUARD_V27_RESULT_MARKDOWN_SHA256),
  historical_read_boundary: z.object({ anonymous_get_count: z.literal(3), response_body_bytes: z.literal(2_503_157), aggregate_limit_bytes: z.literal(400_000), limit_passed: z.literal(false), client_utc: z.array(z.iso.datetime()).length(4) }).strict(),
  fresh_get: z.object({ started_at: z.iso.datetime(), completed_at: z.iso.datetime(), response_date: z.iso.datetime().nullable(), status: z.literal(200), redirects: z.literal(0), retries: z.literal(0), bytes: z.literal(31_857), sha256: z.literal(KLING_SOURCE_GUARD_V27_SOURCE_SHA256) }).strict()
}).strict();
const astNodeSchema: z.ZodType<unknown> = z.lazy(() => z.tuple([z.string().max(64), z.string().max(2_000).nullable(), z.array(astNodeSchema).max(MAX_AST_NODES)]));
const artifactSchema = z.object({
  schema_version: z.literal("1.0.0"), ticket: z.literal("77"), catalog_kind: z.literal("KLING_SOURCE_GUARD_CANDIDATES"),
  evidence_scope: z.literal("STATIC_FRONTEND_NORMALIZATION_AND_VALIDATOR_GUARDS"), runtime_usable: z.literal(false), backend_acceptance: z.literal(false), source_persisted: z.literal(false),
  public_version: z.literal(KLING_SOURCE_GUARD_V27_PUBLIC_VERSION), settings_version: z.literal(KLING_SOURCE_GUARD_V27_SETTINGS_VERSION), build_id: z.literal("1791467421"),
  public_models_sha256: z.literal(KLING_SOURCE_GUARD_V27_PUBLIC_MODELS_SHA256),
  source_identity: z.object({ module_name: z.literal(KLING_SOURCE_GUARD_V27_SOURCE_MODULE), url: z.literal(KLING_SOURCE_GUARD_V27_SOURCE_URL), bytes: z.literal(31_857), sha256: z.literal(KLING_SOURCE_GUARD_V27_SOURCE_SHA256), parse_diagnostics: z.literal(0) }).strict(),
  source_fact_tree: z.object({ normalizer_ast: astNodeSchema, duration_validator_ast: astNodeSchema, ast_node_count: z.number().int().positive().max(MAX_AST_NODES), sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u) }).strict(),
  source_summary: z.object({ result_json_sha256: z.literal(KLING_SOURCE_GUARD_V27_RESULT_JSON_SHA256), result_markdown_sha256: z.literal(KLING_SOURCE_GUARD_V27_RESULT_MARKDOWN_SHA256) }).strict(),
  provenance: provenanceSchema, cohort: z.array(guardRowSchema).length(MODEL_IDS.length), excluded: z.array(excludedSchema).length(1),
  unresolved: z.object({ selectable_options: z.literal("UNKNOWN"), backend_defaults: z.literal("UNKNOWN"), requiredness: z.literal("UNKNOWN"), wrapper_semantics: z.literal("UNKNOWN"), source_metadata_predicates: z.literal("UNKNOWN"), imported_duration_helper: z.literal("UNKNOWN"), uploaded_source_duration_limits: z.literal("NOT_GENERATED_DURATION_EVIDENCE") }).strict()
}).strict();
export type KlingSourceGuardCandidatesV27Artifact = z.infer<typeof artifactSchema>;

export interface KlingSourceGuardAstInput {
  readonly normalizer_ast: unknown;
  readonly duration_validator_ast: unknown;
  readonly ast_node_count: number;
  readonly parse_diagnostics: number;
  readonly source_bytes: number;
  readonly source_sha256: string;
}
export interface KlingFreshGetMetadata {
  readonly started_at: string;
  readonly completed_at: string;
  readonly response_date: string | null;
  readonly status: 200;
  readonly redirects: 0;
  readonly retries: 0;
}

const ORDERED_IDS = [...MODEL_IDS].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
const EXPECTED_VERSION: Readonly<Record<KlingModelId, z.infer<typeof versionGuardSchema>>> = Object.freeze({
  kling_motion_control: { kind: "RETAIN_GUARD_VALUES", guard_values: ["2.6", "3.0"], fallback_assignment: "2.6" },
  kling_text2video: { kind: "RETAIN_GUARD_VALUES", guard_values: ["1.5", "1.6", "2.1-master", "2.5-turbo", "2.6", "3.0", "3.0-turbo"], fallback_assignment: "3.0-turbo" },
  kling_image2video: { kind: "RETAIN_GUARD_VALUES", guard_values: ["1.5", "1.6", "2.1-master", "2.5-turbo", "2.6", "3.0", "3.0-turbo"], fallback_assignment: "3.0-turbo" },
  kling_keyframes: { kind: "RETAIN_GUARD_VALUES", guard_values: ["1.5", "1.6", "2.1", "2.5-turbo", "2.6", "3.0"], fallback_assignment: "2.1" },
  kling_elements: { kind: "FIXED_ASSIGNMENT", guard_values: [], fallback_assignment: "1.6" },
  kling_o1_image2video: { kind: "CLEARED", guard_values: [], fallback_assignment: null },
  kling_o1_text2video: { kind: "CLEARED", guard_values: [], fallback_assignment: null },
  kling_o1_video2video: { kind: "CLEARED", guard_values: [], fallback_assignment: null }
});

export function canonicalKlingCandidateJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new TypeError("KLING_CANDIDATE_NONFINITE_NUMBER"); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonicalKlingCandidateJson).join(",")}]`;
  if (typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalKlingCandidateJson(entry)}`).join(",")}}`;
  throw new TypeError("KLING_CANDIDATE_VALUE_INVALID");
}

export function buildKlingSourceGuardCandidatesV27(input: {
  public_catalog: SyntxPublicCatalogSnapshot; settings_inventory: MaplessSettingsInventory;
  source_fact_tree: KlingSourceGuardAstInput; source_fact_tree_sha256: string; provenance: KlingFreshGetMetadata;
  result_json_sha256: string; result_markdown_sha256: string;
}): KlingSourceGuardCandidatesV27Artifact {
  if (input.public_catalog.sources.models.canonical_sha256 !== KLING_SOURCE_GUARD_V27_PUBLIC_MODELS_SHA256 ||
      input.public_catalog.fetched_at !== input.settings_inventory.public_catalog.fetched_at ||
      input.settings_inventory.public_catalog.version !== KLING_SOURCE_GUARD_V27_PUBLIC_VERSION ||
      input.settings_inventory.build.id !== "1791467421" || input.settings_inventory.forms.find((form) => form.form_id === "kling")?.javascript.bytes !== 31_857 ||
      input.settings_inventory.forms.find((form) => form.form_id === "kling")?.javascript.sha256 !== KLING_SOURCE_GUARD_V27_SOURCE_SHA256 ||
      input.source_fact_tree.parse_diagnostics !== 0 || input.source_fact_tree.source_bytes !== 31_857 || input.source_fact_tree.source_sha256 !== KLING_SOURCE_GUARD_V27_SOURCE_SHA256 || input.source_fact_tree_sha256 !== hashCanonical({ normalizer_ast: input.source_fact_tree.normalizer_ast, duration_validator_ast: input.source_fact_tree.duration_validator_ast })) {
    throw new Error("KLING_CANDIDATE_INPUT_BINDING_INVALID");
  }
  if (input.result_json_sha256 !== KLING_SOURCE_GUARD_V27_RESULT_JSON_SHA256 || input.result_markdown_sha256 !== KLING_SOURCE_GUARD_V27_RESULT_MARKDOWN_SHA256) throw new Error("KLING_CANDIDATE_SOURCE_SUMMARY_INVALID");
  const sourceForm = input.settings_inventory.forms.find((form) => form.form_id === "kling");
  if (!sourceForm || sourceForm.module_name !== "kling.js" || sourceForm.javascript.url !== KLING_SOURCE_GUARD_V27_SOURCE_URL) throw new Error("KLING_CANDIDATE_FORM_BINDING_INVALID");
  const currentRows = input.settings_inventory.models.filter((row) => row.form_id === "kling" && row.active).map((row) => row.model_id).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  if (!same(currentRows, ORDERED_IDS)) throw new Error("KLING_CANDIDATE_COHORT_INVALID");
  const publicRows = input.public_catalog.models.filter((row) => row.ai_name === "kling" && row.active).map((row) => row.value).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  if (!same(publicRows, ORDERED_IDS)) throw new Error("KLING_CANDIDATE_PUBLIC_COHORT_INVALID");
  const excludedRow = input.public_catalog.models.find((row) => row.value === "kling-kolors");
  const excludedInventory = input.settings_inventory.models.find((row) => row.model_id === "kling-kolors");
  if (!excludedRow || excludedRow.active || !excludedInventory || excludedInventory.active || excludedInventory.form_id !== null) throw new Error("KLING_CANDIDATE_EXCLUSION_INVALID");

  const cohort = ORDERED_IDS.map((modelId) => {
    const publicModel = input.public_catalog.models.find((row) => row.value === modelId);
    const settingsModel = input.settings_inventory.models.find((row) => row.model_id === modelId);
    if (!publicModel || !settingsModel || publicModel.ai_name !== "kling" || !publicModel.active || settingsModel.form_id !== "kling" || settingsModel.settings_status !== "PUBLIC_SETTINGS_KNOWN" || settingsModel.defaults_status !== "UNKNOWN" || settingsModel.runtime_usable) throw new Error("KLING_CANDIDATE_MODEL_BINDING_INVALID");
    return ({
    model_id: modelId,
    public_binding: { model_id: modelId, ai_name: "kling", active: true, value: publicModel.value, label: publicModel.label },
    settings_binding: { model_id: modelId, form_id: "kling", form_source_sha256: KLING_SOURCE_GUARD_V27_SOURCE_SHA256, settings_status: "PUBLIC_SETTINGS_KNOWN", defaults_status: "UNKNOWN", runtime_usable: false },
    version: EXPECTED_VERSION[modelId],
    mode: { source_literals: ["standart", "hd"] as ["standart", "hd"], normalization_fallback: "hd" as const, validator_requirement: modelId.startsWith("kling_o1_") ? "hd" as const : null, selectable_options: "UNKNOWN" as const },
    duration: durationFor(modelId),
    fallback_assignments: { mode: modelId === "kling_keyframes" || modelId.startsWith("kling_o1_") ? null : "standart", temperature: modelId === "kling_motion_control" || modelId.startsWith("kling_o1_") ? null : "0.5", gen_type: modelId === "kling_motion_control" ? "mcv" : null, aspect_ratio: ratioFallback(modelId) },
    multi_shots_deleted: modelId === "kling_motion_control" || modelId.startsWith("kling_o1_"),
    camera_movement_cleared: modelId.startsWith("kling_o1_")
    });
  });
  const artifact = artifactSchema.parse({
    schema_version: "1.0.0", ticket: "77", catalog_kind: "KLING_SOURCE_GUARD_CANDIDATES", evidence_scope: "STATIC_FRONTEND_NORMALIZATION_AND_VALIDATOR_GUARDS",
    runtime_usable: false, backend_acceptance: false, source_persisted: false,
    public_version: KLING_SOURCE_GUARD_V27_PUBLIC_VERSION, settings_version: KLING_SOURCE_GUARD_V27_SETTINGS_VERSION, build_id: "1791467421", public_models_sha256: KLING_SOURCE_GUARD_V27_PUBLIC_MODELS_SHA256,
    source_identity: { module_name: "kling.js", url: KLING_SOURCE_GUARD_V27_SOURCE_URL, bytes: 31_857, sha256: KLING_SOURCE_GUARD_V27_SOURCE_SHA256, parse_diagnostics: 0 },
    source_fact_tree: { normalizer_ast: input.source_fact_tree.normalizer_ast, duration_validator_ast: input.source_fact_tree.duration_validator_ast, ast_node_count: input.source_fact_tree.ast_node_count, sha256: input.source_fact_tree_sha256 },
    source_summary: { result_json_sha256: input.result_json_sha256, result_markdown_sha256: input.result_markdown_sha256 },
    provenance: { result_json_sha256: input.result_json_sha256, result_markdown_sha256: input.result_markdown_sha256, historical_read_boundary: { anonymous_get_count: 3, response_body_bytes: 2_503_157, aggregate_limit_bytes: 400_000, limit_passed: false, client_utc: ["2026-10-09T03:13:58.648Z", "2026-10-09T03:13:59.412Z", "2026-10-09T03:15:53.780Z", "2026-10-09T03:15:54.674Z"] }, fresh_get: { ...input.provenance, status: 200, redirects: 0, retries: 0, bytes: 31_857, sha256: KLING_SOURCE_GUARD_V27_SOURCE_SHA256 } },
    cohort, excluded: [{ model_id: "kling-kolors", active: false, form_id: null, reason: "not bound to the current Kling form" }],
    unresolved: { selectable_options: "UNKNOWN", backend_defaults: "UNKNOWN", requiredness: "UNKNOWN", wrapper_semantics: "UNKNOWN", source_metadata_predicates: "UNKNOWN", imported_duration_helper: "UNKNOWN", uploaded_source_duration_limits: "NOT_GENERATED_DURATION_EVIDENCE" }
  });
  validateArtifactSemantics(artifact);
  return artifact;
}

export function parseKlingSourceGuardCandidatesV27Document(bytes: Uint8Array): KlingSourceGuardCandidatesV27Artifact {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_ARTIFACT_BYTES) throw new Error("KLING_CANDIDATE_SIZE_INVALID");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw new Error("KLING_CANDIDATE_UTF8_INVALID"); }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("KLING_CANDIDATE_JSON_INVALID"); }
  const artifact = artifactSchema.parse(raw);
  validateArtifactSemantics(artifact);
  return deepFreeze(artifact);
}

export function parsePinnedKlingSourceGuardCandidatesV27Bytes(bytes: Uint8Array): LoadedKlingSourceGuardCandidatesV27 {
  if (bytes.byteLength !== KLING_SOURCE_GUARD_V27_EXPECTED_BYTES || bytes.byteLength > MAX_ARTIFACT_BYTES) throw new Error("KLING_CANDIDATE_SIZE_INVALID");
  const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (actual !== KLING_SOURCE_GUARD_V27_SHA256) throw new Error("KLING_CANDIDATE_HASH_MISMATCH");
  return makeLoaded(parseKlingSourceGuardCandidatesV27Document(bytes), actual);
}

const loadedBrand: unique symbol = Symbol("LoadedKlingSourceGuardCandidatesV27");
export interface LoadedKlingSourceGuardCandidatesV27 {
  readonly [loadedBrand]: true;
  readonly artifact_version: typeof KLING_SOURCE_GUARD_V27_VERSION;
  readonly artifact_sha256: typeof KLING_SOURCE_GUARD_V27_SHA256;
  readonly artifact: KlingSourceGuardCandidatesV27Artifact;
}
function makeLoaded(artifact: KlingSourceGuardCandidatesV27Artifact, sha: string): LoadedKlingSourceGuardCandidatesV27 {
  return Object.freeze({ [loadedBrand]: true as const, artifact_version: KLING_SOURCE_GUARD_V27_VERSION, artifact_sha256: sha as typeof KLING_SOURCE_GUARD_V27_SHA256, artifact });
}

export function loadPinnedKlingSourceGuardCandidatesV27(catalogDirectory?: string): LoadedKlingSourceGuardCandidatesV27 | null {
  try {
    const root = catalogDirectory === undefined ? getPublicCatalogDirectory() : resolve(catalogDirectory);
    assertDirectory(root); assertDirectory(join(root, "runtime")); assertDirectory(join(root, "runtime", "v27"));
    return parsePinnedKlingSourceGuardCandidatesV27Bytes(readBounded(join(root, "runtime", "v27", KLING_SOURCE_GUARD_V27_VERSION)));
  } catch { return null; }
}

export async function archiveKlingSourceGuardCandidatesV27(artifact: KlingSourceGuardCandidatesV27Artifact, catalogDirectory?: string): Promise<{ version: string; sha256: string; path: string; status: "created" | "existing"; bytes: number }> {
  validateArtifactSemantics(artifact);
  const bytes = Buffer.from(`${canonicalKlingCandidateJson(artifact)}\n`, "utf8");
  if (bytes.length > MAX_ARTIFACT_BYTES) throw new Error("KLING_CANDIDATE_SIZE_INVALID");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const root = resolve(catalogDirectory ?? getPublicCatalogDirectory());
  assertDirectory(root);
  const runtime = join(root, "runtime"); assertDirectory(runtime);
  const directory = join(runtime, "v27");
  try { await mkdir(directory, { mode: 0o755 }); } catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
  assertDirectory(directory);
  const version = `sha256-${digest}.json`; const path = join(directory, version); const temporaryPath = join(directory, `.pending-${randomUUID()}.tmp`);
  let created = false;
  try {
    const handle = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); created = true;
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    let status: "created" | "existing";
    try { await link(temporaryPath, path); status = "created"; } catch (error) { if (!hasCode(error, "EEXIST")) throw error; status = "existing"; }
    if (!readBounded(path).equals(bytes)) throw new Error("KLING_CANDIDATE_VERSION_COLLISION");
    return { version, sha256: `sha256:${digest}`, path, status, bytes: bytes.byteLength };
  } finally { if (created) await unlink(temporaryPath); }
}

export const klingSourceGuardCandidateV27Schema = z.object({
  candidate_status: z.literal("STATIC_SOURCE_GUARD_CANDIDATE"), runtime_usable: z.literal(false), backend_acceptance: z.literal(false),
  defaults_status: z.literal("UNKNOWN"), visibility_status: z.literal("UNKNOWN"), requiredness_status: z.literal("UNKNOWN"), wrapper_semantics: z.literal("UNKNOWN"),
  source: z.object({ model_id: z.enum(MODEL_IDS), upstream_model_value: literalString, ai_name: z.literal("kling"), public_catalog_version: z.literal(KLING_SOURCE_GUARD_V27_PUBLIC_VERSION), public_models_sha256: z.literal(KLING_SOURCE_GUARD_V27_PUBLIC_MODELS_SHA256), settings_inventory_version: z.literal(KLING_SOURCE_GUARD_V27_SETTINGS_VERSION), source_build_id: z.literal("1791467421"), source_module_sha256: z.literal(KLING_SOURCE_GUARD_V27_SOURCE_SHA256), source_fact_tree_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u), artifact_version: z.literal(KLING_SOURCE_GUARD_V27_VERSION), artifact_sha256: z.literal(KLING_SOURCE_GUARD_V27_SHA256) }).strict(),
  operation_binding: z.object({ operation_id: z.literal("generate-video"), output_modality: z.literal("video"), evidence: z.literal("EXPLICIT_CURRENT_DISCOVERY_CONTEXT") }).strict(),
  source_guards: guardRowSchema
}).strict();
export type KlingSourceGuardCandidateV27 = z.infer<typeof klingSourceGuardCandidateV27Schema>;

export function makeKlingSourceGuardCandidateV27(loaded: LoadedKlingSourceGuardCandidatesV27 | null, model: DiscoveryModelRecord & { readonly catalog_version: string }, operationId: string, outputModality: string | undefined): KlingSourceGuardCandidateV27 | null {
  if (!loaded || loaded[loadedBrand] !== true || loaded.artifact_version !== KLING_SOURCE_GUARD_V27_VERSION || loaded.artifact_sha256 !== KLING_SOURCE_GUARD_V27_SHA256 ||
      !model.active || model.ai_name !== "kling" || model.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || model.runtime_usable !== false || operationId !== "generate-video" || outputModality !== "video" ||
      model.source_hashes.models !== KLING_SOURCE_GUARD_V27_PUBLIC_MODELS_SHA256 || model.catalog_version !== `${model.fetched_at}.${model.source_hashes.models.slice(7, 19)}`) return null;
  const row = loaded.artifact.cohort.find((candidate) => candidate.model_id === model.id);
  if (!row || row.public_binding.value !== model.id || row.public_binding.ai_name !== model.ai_name || row.settings_binding.form_id !== "kling" || row.model_id !== model.upstream_id || !model.operations.some((operation) => operation.id === operationId && operation.output_modality === outputModality)) return null;
  return klingSourceGuardCandidateV27Schema.parse({
    candidate_status: "STATIC_SOURCE_GUARD_CANDIDATE", runtime_usable: false, backend_acceptance: false, defaults_status: "UNKNOWN", visibility_status: "UNKNOWN", requiredness_status: "UNKNOWN", wrapper_semantics: "UNKNOWN",
    source: { model_id: model.id, upstream_model_value: model.upstream_id, ai_name: model.ai_name, public_catalog_version: loaded.artifact.public_version, public_models_sha256: model.source_hashes.models, settings_inventory_version: loaded.artifact.settings_version, source_build_id: loaded.artifact.build_id, source_module_sha256: loaded.artifact.source_identity.sha256, source_fact_tree_sha256: loaded.artifact.source_fact_tree.sha256, artifact_version: loaded.artifact_version, artifact_sha256: loaded.artifact_sha256 },
    operation_binding: { operation_id: "generate-video", output_modality: "video", evidence: "EXPLICIT_CURRENT_DISCOVERY_CONTEXT" }, source_guards: row
  });
}

function durationFor(id: KlingModelId): z.infer<typeof durationSchema> {
  if (id === "kling_o1_image2video") return { kind: "RANGE_GUARD_CANDIDATE", minimum: 3, maximum: 10 };
  if (id === "kling_o1_video2video") return { kind: "CONDITIONAL_SOURCE_GUARD_CANDIDATE", source_file_absent: { predicate: "UNKNOWN", accepted_values: [5, 10] }, source_file_metadata_present: { predicate: "UNKNOWN", requested_duration: "ROUND_METADATA_DURATION" }, source_file_metadata_absent: { predicate: "UNKNOWN", minimum: 3, maximum: 10 } };
  return { kind: "ALWAYS_TRUE_NO_FINITE_ENUM" };
}
function ratioFallback(id: KlingModelId): "16:9" | "1:1" | null { if (id === "kling_text2video" || id.startsWith("kling_o1_") && id !== "kling_o1_video2video") return "16:9"; if (id === "kling_elements") return "1:1"; return null; }
function validateArtifactSemantics(a: KlingSourceGuardCandidatesV27Artifact): void {
  if (!same(a.cohort.map((row) => row.model_id), ORDERED_IDS) || a.cohort.some((row) => row.public_binding.model_id !== row.model_id || row.public_binding.value !== row.model_id || row.public_binding.ai_name !== "kling" || !row.public_binding.active || row.settings_binding.model_id !== row.model_id || row.settings_binding.form_id !== "kling" || row.settings_binding.form_source_sha256 !== KLING_SOURCE_GUARD_V27_SOURCE_SHA256 || JSON.stringify(row.version) !== JSON.stringify(EXPECTED_VERSION[row.model_id]) || JSON.stringify(row.duration) !== JSON.stringify(durationFor(row.model_id))) ||
      a.provenance.fresh_get.bytes > 64 * 1024 || Date.parse(a.provenance.fresh_get.completed_at) - Date.parse(a.provenance.fresh_get.started_at) > 15_000 ||
      a.source_fact_tree.ast_node_count > MAX_AST_NODES || !validAst(a.source_fact_tree.normalizer_ast) || !validAst(a.source_fact_tree.duration_validator_ast) ||
      a.excluded[0]?.model_id !== "kling-kolors" || a.runtime_usable || a.backend_acceptance || a.source_persisted) throw new Error("KLING_CANDIDATE_BINDING_INVALID");
  const normalizerAtoms = JSON.stringify(a.source_fact_tree.normalizer_ast);
  const atoms = JSON.stringify([a.source_fact_tree.normalizer_ast, a.source_fact_tree.duration_validator_ast]);
  for (const id of MODEL_IDS) if (!normalizerAtoms.includes(id)) throw new Error("KLING_CANDIDATE_AST_COHORT_INVALID");
  for (const token of ["version", "mode", "gen_type", "video_duration", "standart", "hd", "mcv", "multi_shots", "camera_movement"]) if (!atoms.includes(token)) throw new Error(`KLING_CANDIDATE_AST_FACT_MISSING_${token.toUpperCase()}`);
  if (hashCanonical({ normalizer_ast: a.source_fact_tree.normalizer_ast, duration_validator_ast: a.source_fact_tree.duration_validator_ast }) !== a.source_fact_tree.sha256) throw new Error("KLING_CANDIDATE_AST_HASH_MISMATCH");
}
function validAst(value: unknown, depth = 0, budget = { count: 0 }): boolean {
  if (depth > 128 || !Array.isArray(value) || value.length !== 3 || typeof value[0] !== "string" || !(typeof value[1] === "string" || value[1] === null) || !Array.isArray(value[2])) return false;
  budget.count += 1; if (budget.count > MAX_AST_NODES) return false;
  return value[2].every((child) => validAst(child, depth + 1, budget));
}
function hashCanonical(value: unknown): string { return `sha256:${createHash("sha256").update(canonicalKlingCandidateJson(value), "utf8").digest("hex")}`; }
function same(a: readonly string[], b: readonly string[]): boolean { return a.length === b.length && a.every((value, index) => value === b[index]); }
function deepFreeze<T>(value: T): T { if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested); Object.freeze(value); } return value; }
function assertDirectory(path: string): void { const stat = lstatSync(path); if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("KLING_CANDIDATE_DIRECTORY_UNSAFE"); }
function readBounded(path: string): Buffer {
  if (!Number.isSafeInteger(MAX_ARTIFACT_BYTES)) throw new Error("KLING_CANDIDATE_SIZE_INVALID");
  const stat = lstatSync(path); if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("KLING_CANDIDATE_FILE_UNSAFE");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { const before = fstatSync(fd); if (!before.isFile() || before.size < 1 || before.size > MAX_ARTIFACT_BYTES) throw new Error("KLING_CANDIDATE_SIZE_INVALID"); const bytes = Buffer.alloc(before.size + 1); let offset = 0; while (offset < bytes.length) { const count = readSync(fd, bytes, offset, bytes.length - offset, null); if (!count) break; offset += count; } const after = fstatSync(fd); if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error("KLING_CANDIDATE_CHANGED_DURING_READ"); return bytes.subarray(0, offset); }
  finally { closeSync(fd); }
}
function hasCode(error: unknown, code: string): boolean { return error instanceof Error && "code" in error && error.code === code; }

const KLING_SOURCE_GUARD_V27_EXPECTED_BYTES = -1;
