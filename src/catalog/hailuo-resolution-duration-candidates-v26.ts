import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod/v4";
import { getPublicCatalogDirectory } from "./public-catalog-history.js";
import { generationContractV2ParameterNodeSchema } from "../domain/generation-contract-v2.js";

export const HAILUO_RESOLUTION_DURATION_V26_VERSION =
  "sha256-b37b32688c83725ff95eaf9c35d7b299f616f8923996d0804e7d25a5059e81e1.json" as const;
export const HAILUO_RESOLUTION_DURATION_V26_SHA256 =
  "sha256:b37b32688c83725ff95eaf9c35d7b299f616f8923996d0804e7d25a5059e81e1" as const;
export const HAILUO_RESOLUTION_DURATION_V26_PUBLIC_VERSION =
  "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json" as const;
export const HAILUO_RESOLUTION_DURATION_V26_SETTINGS_VERSION =
  "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json" as const;
export const HAILUO_RESOLUTION_DURATION_V26_PUBLIC_MODELS_SHA256 =
  "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444" as const;
export const HAILUO_RESOLUTION_DURATION_V26_FETCHED_AT = "2026-10-08T13:18:39.393Z" as const;

const EXPECTED_BYTES = 8_668;
const MAX_ARTIFACT_BYTES = 64 * 1024;
const HAILUO_MODEL_IDS = [
  "hailuo-01", "hailuo-01-director", "hailuo-01-live", "hailuo-01-live-character",
  "hailuo-02", "hailuo-2.3", "hailuo-2.3-fast", "hailuo-3.0", "hailuo-minimax"
] as const;
type HailuoModelId = (typeof HAILUO_MODEL_IDS)[number];

const knownUnknown = z.literal("UNKNOWN");
const resolutionCandidateSchema = z.object({
  value: z.string().min(1).max(32),
  durations: z.array(z.number().int().positive()).min(1).max(32)
}).strict();
const formResetCandidateSchema = z.object({
  resolution: z.string().min(1).max(32),
  video_duration: z.number().int().positive()
}).strict();
const selectControlSchema = z.object({ kind: z.literal("select"), values: z.array(z.number().int().positive()).min(1).max(32) }).strict();
const sliderControlSchema = z.object({
  kind: z.literal("integer_slider"), min: z.number().int(), max: z.number().int(), step: z.number().int().positive(), ui_reset_candidate: z.number().int()
}).strict();
const cohortRowSchema = z.object({
  model_id: z.enum(HAILUO_MODEL_IDS),
  public_binding: z.object({ ai_name: z.literal("hailuo-minimax"), value: z.string().min(1).max(160), label: z.string().min(1).max(160) }).strict(),
  selector_binding: z.enum(["DYNAMIC_SOURCE_CANDIDATE", "EXCLUDED_BY_VALUE_FILTER"]),
  resolution_candidates_status: z.enum(["FINITE_UI_CANDIDATE", "UNRESOLVED"]),
  resolution_candidates: z.array(resolutionCandidateSchema).max(8),
  duration_control: z.union([selectControlSchema, sliderControlSchema]).nullable(),
  form_reset_candidate: formResetCandidateSchema.nullable(),
  aspect_ratio_visibility: z.literal("UNKNOWN")
}).strict();

const artifactSchema = z.object({
  schema_version: z.literal("1.0.0"),
  ticket: z.literal("65"),
  catalog_kind: z.literal("HAILUO_RESOLUTION_DURATION_SOURCE_CANDIDATES"),
  evidence_scope: z.literal("STATIC_FRONTEND_UI_CANDIDATES"),
  runtime_usable: z.literal(false),
  backend_acceptance: z.literal(false),
  source_persisted: z.literal(false),
  public_version: z.literal(HAILUO_RESOLUTION_DURATION_V26_PUBLIC_VERSION),
  settings_version: z.literal(HAILUO_RESOLUTION_DURATION_V26_SETTINGS_VERSION),
  build_id: z.literal("1791467421"),
  source_identity: z.object({
    module_name: z.literal("hailuo-minimax.js"),
    url: z.literal("https://syntx.ai/assets/1791467421/hailuo-minimax.js"),
    bytes: z.literal(13_501),
    sha256: z.literal("sha256:cb839f2df681fdd0043cb73a477fb4576aef830f37d6d87418b422a17e5a3cb9")
  }).strict(),
  source_fact_tree_sha256: z.literal("sha256:f70555b7b51db72e5f7d0eb33023945c9bdc1af59ea342a40a577a9d3d117f97"),
  provenance: z.object({
    client_fetch_utc_exact: z.null(),
    client_fetch_utc_capture_status: z.literal("NOT_LATCHED_AT_FETCH"),
    client_fetch_utc_estimate: z.iso.datetime(),
    response_date_utc: z.iso.datetime(),
    response_date_utc_role: z.literal("HTTP_DATE_ESTIMATE_ONLY"),
    anonymous_get_count: z.literal(1),
    body_written_or_printed: z.literal(false)
  }).strict(),
  dynamic_selector: z.object({
    source: z.literal("getModelsByAiName(provider_name).filter(model.value !== provider_name)"),
    provider_name: z.literal("hailuo-minimax"),
    membership_runtime_verified: z.literal(false)
  }).strict(),
  unresolved: z.object({
    aspect_ratio_per_model_visibility: z.literal("UNKNOWN"),
    backend_defaults: z.literal("UNKNOWN"),
    requiredness: z.literal("UNKNOWN"),
    cost: z.literal("UNKNOWN"),
    operation_id: z.literal("NOT_PRESENT_IN_PINNED_CATALOG")
  }).strict(),
  cohort: z.array(cohortRowSchema).length(9),
  generated_at: z.iso.datetime(),
  reviewed_at: z.iso.datetime()
}).strict();

const parameterSchemaCandidateSchema = z.object({
  type: z.literal("object"),
  additional_properties: z.literal(false),
  required: z.array(z.string().max(64)).max(64),
  properties: z.record(z.string().max(64), generationContractV2ParameterNodeSchema),
  conditions: z.array(z.unknown()).max(64),
  conditional_enums: z.array(z.unknown()).max(64)
}).strict();
const fieldCandidateEvidenceSchema = z.object({
  status: z.enum(["FINITE_SOURCE_CANDIDATE", "CONDITIONAL_SOURCE_CANDIDATE"]),
  allowed_values: z.array(z.union([z.string().max(64), z.number().int()])).max(32),
  required: knownUnknown,
  default: knownUnknown,
  visibility: knownUnknown,
  model_applicability: knownUnknown,
  ui_reset_candidate: z.union([z.string().max(64), z.number().int()]).nullable()
}).strict();

export const hailuoResolutionDurationCandidateV26Schema = z.object({
  candidate_status: z.literal("STATIC_UI_GETTER_CANDIDATE"),
  runtime_usable: z.literal(false),
  backend_acceptance: z.literal(false),
  wrapper_semantics_verified: z.literal(false),
  wrapper_semantics: knownUnknown,
  defaults_status: knownUnknown,
  visibility_status: knownUnknown,
  model_applicability: knownUnknown,
  source: z.object({
    model_id: z.enum(HAILUO_MODEL_IDS),
    ai_name: z.literal("hailuo-minimax"),
    upstream_model_value: z.string().min(1).max(160),
    public_catalog_version: z.literal(HAILUO_RESOLUTION_DURATION_V26_PUBLIC_VERSION),
    public_models_sha256: z.literal(HAILUO_RESOLUTION_DURATION_V26_PUBLIC_MODELS_SHA256),
    settings_inventory_version: z.literal(HAILUO_RESOLUTION_DURATION_V26_SETTINGS_VERSION),
    source_build_id: z.literal("1791467421"),
    source_module_sha256: z.literal("sha256:cb839f2df681fdd0043cb73a477fb4576aef830f37d6d87418b422a17e5a3cb9"),
    source_fact_tree_sha256: z.literal("sha256:f70555b7b51db72e5f7d0eb33023945c9bdc1af59ea342a40a577a9d3d117f97"),
    artifact_version: z.literal(HAILUO_RESOLUTION_DURATION_V26_VERSION),
    artifact_sha256: z.literal(HAILUO_RESOLUTION_DURATION_V26_SHA256)
  }).strict(),
  operation_binding: z.object({
    operation_id: z.literal("generate-video"),
    evidence: z.literal("CURRENT_PUBLIC_CATALOG_OPERATION"),
    output_modality: z.literal("video")
  }).strict(),
  parameter_schema: parameterSchemaCandidateSchema,
  resolution_duration_relation: z.array(z.object({
    resolution: z.string().min(1).max(32),
    durations: z.array(z.number().int().positive()).min(1).max(32)
  }).strict()).min(1).max(8),
  duration_control: z.union([selectControlSchema, sliderControlSchema]),
  field_evidence: z.object({ resolution: fieldCandidateEvidenceSchema, video_duration: fieldCandidateEvidenceSchema }).strict()
}).strict();

export type HailuoResolutionDurationV26Artifact = z.infer<typeof artifactSchema>;
export type HailuoResolutionDurationCandidateV26 = z.infer<typeof hailuoResolutionDurationCandidateV26Schema>;

const loadedArtifactBrand: unique symbol = Symbol("LoadedHailuoResolutionDurationV26");
export interface LoadedHailuoResolutionDurationV26 {
  readonly [loadedArtifactBrand]: true;
  readonly artifact_version: typeof HAILUO_RESOLUTION_DURATION_V26_VERSION;
  readonly artifact_sha256: typeof HAILUO_RESOLUTION_DURATION_V26_SHA256;
  readonly artifact: HailuoResolutionDurationV26Artifact;
}

const EXPECTED_COHORT: Readonly<Record<HailuoModelId, {
  readonly label: string;
  readonly resolutions: readonly { readonly value: string; readonly durations: readonly number[] }[];
  readonly reset: { readonly resolution: string; readonly video_duration: number } | null;
}>> = Object.freeze({
  "hailuo-01": { label: "Hailuo-01", resolutions: [{ value: "720p", durations: [6] }], reset: { resolution: "720p", video_duration: 6 } },
  "hailuo-01-director": { label: "Hailuo-01 Director", resolutions: [{ value: "720p", durations: [6] }], reset: { resolution: "720p", video_duration: 6 } },
  "hailuo-01-live": { label: "Hailuo-01 Live", resolutions: [{ value: "720p", durations: [6] }], reset: { resolution: "720p", video_duration: 6 } },
  "hailuo-01-live-character": { label: "Hailuo-01 Live Character", resolutions: [{ value: "720p", durations: [6] }], reset: { resolution: "720p", video_duration: 6 } },
  "hailuo-02": { label: "Hailuo-02", resolutions: [{ value: "512p", durations: [6, 10] }, { value: "768p", durations: [6, 10] }, { value: "1080p", durations: [6] }], reset: { resolution: "768p", video_duration: 6 } },
  "hailuo-2.3": { label: "Hailuo 2.3", resolutions: [{ value: "768p", durations: [6, 10] }, { value: "1080p", durations: [6] }], reset: { resolution: "768p", video_duration: 6 } },
  "hailuo-2.3-fast": { label: "Hailuo 2.3 Fast", resolutions: [{ value: "768p", durations: [6, 10] }, { value: "1080p", durations: [6] }], reset: { resolution: "768p", video_duration: 6 } },
  "hailuo-3.0": { label: "Hailuo 3.0", resolutions: [{ value: "768p", durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }, { value: "2K", durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }], reset: { resolution: "2K", video_duration: 5 } },
  "hailuo-minimax": { label: "Hailuo MiniMax", resolutions: [], reset: null }
});

export function loadPinnedHailuoResolutionDurationCandidatesV26(catalogDirectory?: string): LoadedHailuoResolutionDurationV26 | null {
  try {
    const root = catalogDirectory === undefined ? getPublicCatalogDirectory() : resolve(catalogDirectory);
    assertDirectory(root);
    const runtime = join(root, "runtime");
    assertDirectory(runtime);
    const versionDirectory = join(runtime, "v26");
    assertDirectory(versionDirectory);
    return parsePinnedHailuoResolutionDurationCandidatesV26Bytes(readBoundedArtifact(join(versionDirectory, HAILUO_RESOLUTION_DURATION_V26_VERSION)));
  } catch {
    return null;
  }
}

export function parsePinnedHailuoResolutionDurationCandidatesV26Bytes(bytes: Uint8Array): LoadedHailuoResolutionDurationV26 {
  if (bytes.byteLength !== EXPECTED_BYTES || bytes.byteLength > MAX_ARTIFACT_BYTES) throw new Error("HAILUO_CANDIDATE_SIZE_INVALID");
  const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (actual !== HAILUO_RESOLUTION_DURATION_V26_SHA256) throw new Error("HAILUO_CANDIDATE_HASH_MISMATCH");
  const artifact = parseHailuoResolutionDurationCandidatesV26Document(bytes);
  return Object.freeze({
    [loadedArtifactBrand]: true as const,
    artifact_version: HAILUO_RESOLUTION_DURATION_V26_VERSION,
    artifact_sha256: actual as typeof HAILUO_RESOLUTION_DURATION_V26_SHA256,
    artifact
  });
}

export function parseHailuoResolutionDurationCandidatesV26Document(bytes: Uint8Array): HailuoResolutionDurationV26Artifact {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_ARTIFACT_BYTES) throw new Error("HAILUO_CANDIDATE_SIZE_INVALID");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error("HAILUO_CANDIDATE_UTF8_INVALID"); }
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { throw new Error("HAILUO_CANDIDATE_JSON_INVALID"); }
  const artifact = artifactSchema.parse(raw);
  validateArtifactSemantics(artifact);
  return deepFreeze(artifact);
}

export function makeHailuoResolutionDurationCandidateV26(
  loaded: LoadedHailuoResolutionDurationV26 | null,
  model: { readonly id: string; readonly upstream_id: string; readonly ai_name: string; readonly active: boolean; readonly catalog_version: string; readonly fetched_at: string; readonly source_hashes: { readonly models: string } },
  operationId: string | null,
  outputModality: string | undefined
): HailuoResolutionDurationCandidateV26 | null {
  if (loaded === null || loaded[loadedArtifactBrand] !== true || loaded.artifact_version !== HAILUO_RESOLUTION_DURATION_V26_VERSION ||
      loaded.artifact_sha256 !== HAILUO_RESOLUTION_DURATION_V26_SHA256 || !model.active || model.ai_name !== "hailuo-minimax" ||
      operationId !== "generate-video" || outputModality !== "video" || model.fetched_at !== HAILUO_RESOLUTION_DURATION_V26_FETCHED_AT ||
      model.source_hashes.models !== HAILUO_RESOLUTION_DURATION_V26_PUBLIC_MODELS_SHA256 ||
      model.catalog_version !== `${model.fetched_at}.${model.source_hashes.models.slice(7, 19)}` || model.upstream_id !== model.id) return null;
  const row = loaded.artifact.cohort.find((entry) => entry.model_id === model.id);
  if (!row || row.selector_binding !== "DYNAMIC_SOURCE_CANDIDATE" || row.resolution_candidates_status !== "FINITE_UI_CANDIDATE" ||
      row.public_binding.ai_name !== model.ai_name || row.public_binding.value !== model.upstream_id || row.duration_control === null) return null;

  const relation = row.resolution_candidates.map((entry) => ({ resolution: entry.value, durations: [...entry.durations] }));
  const resolutionValues = relation.map((entry) => entry.resolution);
  const control = row.duration_control;
  const isSlider = control.kind === "integer_slider";
  const durationValues = [...new Set(relation.flatMap((entry) => entry.durations))];
  const durationProperty = isSlider
    ? { type: "integer" as const, minimum: control.min, maximum: control.max, step: control.step }
    : { type: "integer" as const, enum: durationValues };
  const branches = relation.map((entry) => ({ when: { field: "resolution", equals: entry.resolution }, allowed_values: entry.durations }));
  const parameterSchema = {
    type: "object" as const,
    additional_properties: false as const,
    required: [] as string[],
    properties: {
      resolution: { type: "string" as const, enum: resolutionValues },
      video_duration: durationProperty
    },
    conditions: [],
    conditional_enums: isSlider ? [] : [{ field: "video_duration", cases: branches }]
  };
  const reset = row.form_reset_candidate;
  return hailuoResolutionDurationCandidateV26Schema.parse({
    candidate_status: "STATIC_UI_GETTER_CANDIDATE",
    runtime_usable: false,
    backend_acceptance: false,
    wrapper_semantics_verified: false,
    wrapper_semantics: "UNKNOWN",
    defaults_status: "UNKNOWN",
    visibility_status: "UNKNOWN",
    model_applicability: "UNKNOWN",
    source: {
      model_id: model.id,
      ai_name: model.ai_name,
      upstream_model_value: model.upstream_id,
      public_catalog_version: loaded.artifact.public_version,
      public_models_sha256: model.source_hashes.models,
      settings_inventory_version: loaded.artifact.settings_version,
      source_build_id: loaded.artifact.build_id,
      source_module_sha256: loaded.artifact.source_identity.sha256,
      source_fact_tree_sha256: loaded.artifact.source_fact_tree_sha256,
      artifact_version: loaded.artifact_version,
      artifact_sha256: loaded.artifact_sha256
    },
    operation_binding: { operation_id: "generate-video", evidence: "CURRENT_PUBLIC_CATALOG_OPERATION", output_modality: "video" },
    parameter_schema: parameterSchema,
    resolution_duration_relation: relation,
    duration_control: control,
    field_evidence: {
      resolution: {
        status: "FINITE_SOURCE_CANDIDATE",
        allowed_values: resolutionValues,
        required: "UNKNOWN", default: "UNKNOWN", visibility: "UNKNOWN", model_applicability: "UNKNOWN",
        ui_reset_candidate: reset?.resolution ?? null
      },
      video_duration: {
        status: "CONDITIONAL_SOURCE_CANDIDATE",
        allowed_values: durationValues,
        required: "UNKNOWN", default: "UNKNOWN", visibility: "UNKNOWN", model_applicability: "UNKNOWN",
        ui_reset_candidate: reset?.video_duration ?? null
      }
    }
  });
}

function validateArtifactSemantics(artifact: HailuoResolutionDurationV26Artifact): void {
  const ids = artifact.cohort.map((row) => row.model_id);
  if (new Set(ids).size !== HAILUO_MODEL_IDS.length || HAILUO_MODEL_IDS.some((id) => !ids.includes(id)) ||
      artifact.generated_at === artifact.reviewed_at) throw new Error("HAILUO_CANDIDATE_BINDING_INVALID");
  for (const row of artifact.cohort) {
    const expected = EXPECTED_COHORT[row.model_id];
    const excluded = row.model_id === "hailuo-minimax";
    const expectedDuration = row.model_id === "hailuo-3.0"
      ? { kind: "integer_slider", min: 4, max: 15, step: 1, ui_reset_candidate: 5 }
      : { kind: "select", values: [...new Set(expected.resolutions.flatMap((entry) => entry.durations))] };
    if (row.public_binding.ai_name !== "hailuo-minimax" || row.public_binding.value !== row.model_id || row.public_binding.label !== expected.label ||
        row.selector_binding !== (excluded ? "EXCLUDED_BY_VALUE_FILTER" : "DYNAMIC_SOURCE_CANDIDATE") ||
        row.resolution_candidates_status !== (excluded ? "UNRESOLVED" : "FINITE_UI_CANDIDATE") ||
        !sameJson(row.resolution_candidates, expected.resolutions) || !sameJson(row.duration_control, excluded ? null : expectedDuration) ||
        !sameJson(row.form_reset_candidate, expected.reset) || (excluded && row.resolution_candidates.length !== 0)) {
      throw new Error("HAILUO_CANDIDATE_BINDING_INVALID");
    }
  }
}

function sameJson(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function assertDirectory(path: string): void { const stat = lstatSync(path); if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("HAILUO_CANDIDATE_DIRECTORY_UNSAFE"); }
function deepFreeze<T>(value: T): T { if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested); Object.freeze(value); } return value; }
function readBoundedArtifact(path: string): Buffer {
  const pathStat = lstatSync(path);
  if (pathStat.isSymbolicLink() || !pathStat.isFile()) throw new Error("HAILUO_CANDIDATE_FILE_UNSAFE");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size !== EXPECTED_BYTES || before.size > MAX_ARTIFACT_BYTES) throw new Error("HAILUO_CANDIDATE_SIZE_INVALID");
    const bytes = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < bytes.length) { const count = readSync(fd, bytes, offset, bytes.length - offset, null); if (count === 0) break; offset += count; }
    const after = fstatSync(fd);
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error("HAILUO_CANDIDATE_CHANGED_DURING_READ");
    return bytes.subarray(0, offset);
  } finally { closeSync(fd); }
}
