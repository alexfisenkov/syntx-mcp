import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod/v4";
import { getPublicCatalogDirectory } from "./public-catalog-history.js";
import { generationContractV2ParameterNodeSchema } from "../domain/generation-contract-v2.js";

export const BANANA_CONDITIONAL_SETTINGS_V19_VERSION = "banana-conditional-settings-v1.0.0.json" as const;
export const BANANA_CONDITIONAL_SETTINGS_V19_SHA256 = "sha256:9458bd83ce4091fc7a1bac333e45012ef1951ff0aaa5524788865c0ea8d12f1b" as const;
export const BANANA_CONDITIONAL_SETTINGS_PUBLIC_MODELS_SHA256 = "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444" as const;
export const BANANA_CONDITIONAL_SETTINGS_PUBLIC_FETCHED_AT = "2026-10-08T13:18:39.393Z" as const;
const EXPECTED_BYTES = 11_002;
const MAX_ARTIFACT_BYTES = 64 * 1024;
const MODEL_IDS = ["banana", "banana-2.1", "banana2", "banana3", "banana3_light"] as const;
const locationSchema = z.object({ line: z.number().int().positive(), column: z.number().int().positive() }).strict();
const fieldEvidenceSchema = z.object({
  status: z.enum(["CONTROL_PRESENT", "CONTROL_NOT_RENDERED", "EXISTING_STATIC_EVIDENCE_REFERENCE"]),
  allowed_values: z.array(z.string().max(64)).max(64),
  default_candidate: z.string().max(64).nullable(),
  binding_location: locationSchema.nullable(),
  condition_location: locationSchema.nullable(),
  options_location: locationSchema.nullable(),
  default_location: locationSchema.nullable(),
  evidence_ref: z.string().max(500).nullable()
}).strict();
const parameterSchemaCandidateSchema = z.object({
  type: z.literal("object"),
  additional_properties: z.literal(false),
  required: z.array(z.string().max(64)).max(64),
  properties: z.record(z.string().max(64), generationContractV2ParameterNodeSchema),
  conditions: z.array(z.unknown()).max(64),
  conditional_enums: z.array(z.unknown()).max(64)
}).strict();
const modelCandidateSchema = z.object({
  model_id: z.string().min(1).max(160),
  ai_name: z.literal("banana"),
  operation_id: z.literal("generate-image"),
  parameter_schema_status: z.literal("STATIC_UI_CANDIDATE_NOT_WIRE_REVIEW"),
  parameter_schema: parameterSchemaCandidateSchema,
  field_evidence: z.object({ model_type: fieldEvidenceSchema, aspect_ratio: fieldEvidenceSchema, image_size: fieldEvidenceSchema, thinking_level: fieldEvidenceSchema }).strict()
}).strict();

const artifactSchema = z.object({
  schema_version: z.literal("1.0.0"),
  catalog_kind: z.literal("BANANA_CONDITIONAL_SETTINGS_CANDIDATES"),
  evidence_level: z.literal("HASH_PINNED_COMPILED_JS_AST"),
  runtime_usable: z.literal(false),
  current_ui_status: z.literal("SOURCE_BUILD_MATCHES_HOME_BUILD_NOT_UI_VERIFIED"),
  public_catalog_version: z.literal("sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json"),
  settings_inventory_version: z.literal("sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json"),
  source_build_id: z.literal("1791467421"),
  observed_homepage_build_id: z.literal("1791467421"),
  source_refs: z.array(z.object({ module_name: z.literal("banana.js"), url: z.string().url(), bytes: z.number().int().positive(), sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u) }).strict()).length(1),
  form_binding: z.object({
    form_id: z.literal("banana"), module_name: z.literal("banana.js"), source_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    settings3_module: z.literal("./settings3.js"), factory_call_count: z.literal(1), operation_modality: z.literal("image"), ai_name: z.literal("banana"),
    model_ids: z.array(z.string().min(1).max(160)).length(5), model_type_binding_location: locationSchema,
    form_control_artifact_ref: z.string().min(1).max(500), form_control_artifact_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u)
  }).strict(),
  existing_ratio_evidence: z.object({ field: z.literal("aspect_ratio"), artifact_ref: z.string().min(1).max(500), sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u), reused_without_reenumeration: z.literal(true) }).strict(),
  image_size_source: z.object({ field: z.literal("image_size"), guard_model_ids: z.array(z.string()).length(4), switch_options_by_model: z.record(z.string(), z.array(z.string())), default_rule: z.object({ model_type_equals: z.literal("banana3_light"), when_true: z.literal("1K"), otherwise: z.literal("2K"), status: z.literal("UI_DEFAULT_CANDIDATE_ONLY") }).strict(), binding_location: locationSchema, condition_location: locationSchema, switch_location: locationSchema, default_location: locationSchema }).strict(),
  thinking_level_source: z.object({ field: z.literal("thinking_level"), options_by_model: z.record(z.string(), z.array(z.string())), default_by_model: z.record(z.string(), z.string()), guard_expression: z.literal("d.value"), binding_location: locationSchema, condition_location: locationSchema, options_location: locationSchema, default_location: locationSchema }).strict(),
  model_candidates: z.array(modelCandidateSchema).length(5),
  blockers: z.array(z.string().min(1).max(256)).max(32)
}).passthrough();

export type BananaConditionalSettingsV19Artifact = z.infer<typeof artifactSchema>;
export type SourceDerivedParameterCandidate = z.infer<typeof sourceDerivedParameterCandidateSchema>;

export const sourceDerivedParameterCandidateSchema = z.object({
  candidate_status: z.literal("STATIC_UI_CANDIDATE"),
  runtime_usable: z.literal(false),
  backend_acceptance: z.literal(false),
  source: z.object({
    model_id: z.string().min(1).max(160),
    ai_name: z.literal("banana"),
    upstream_model_value: z.string().min(1).max(160),
    operation_id: z.literal("generate-image"),
    public_catalog_version: z.string().max(200),
    public_models_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    settings_inventory_version: z.string().max(200),
    source_build_id: z.string().max(20),
    form_source_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    artifact_version: z.string().max(100),
    artifact_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u)
  }).strict(),
  parameter_schema: parameterSchemaCandidateSchema,
  field_evidence: z.object({ model_type: fieldEvidenceSchema, aspect_ratio: fieldEvidenceSchema, image_size: fieldEvidenceSchema, thinking_level: fieldEvidenceSchema }).strict()
}).strict();

export interface LoadedBananaConditionalSettingsV19 {
  readonly artifact_version: typeof BANANA_CONDITIONAL_SETTINGS_V19_VERSION;
  readonly artifact_sha256: typeof BANANA_CONDITIONAL_SETTINGS_V19_SHA256;
  readonly artifact: BananaConditionalSettingsV19Artifact;
}

export function loadPinnedBananaConditionalSettingsV19(catalogDirectory?: string): LoadedBananaConditionalSettingsV19 | null {
  try {
    const root = catalogDirectory === undefined ? getPublicCatalogDirectory() : resolve(catalogDirectory);
    assertDirectory(root);
    const runtimeDirectory = join(root, "runtime");
    assertDirectory(runtimeDirectory);
    const versionDirectory = join(runtimeDirectory, "v19");
    assertDirectory(versionDirectory);
    const bytes = readBoundedArtifact(join(versionDirectory, BANANA_CONDITIONAL_SETTINGS_V19_VERSION));
    return parsePinnedBananaConditionalSettingsV19Bytes(bytes);
  } catch {
    return null;
  }
}

export function parsePinnedBananaConditionalSettingsV19Bytes(bytes: Uint8Array): LoadedBananaConditionalSettingsV19 {
  if (bytes.byteLength !== EXPECTED_BYTES || bytes.byteLength > MAX_ARTIFACT_BYTES) throw new Error("BANANA_CANDIDATE_SIZE_INVALID");
  const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (actual !== BANANA_CONDITIONAL_SETTINGS_V19_SHA256) throw new Error("BANANA_CANDIDATE_HASH_MISMATCH");
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)); }
  catch { throw new Error("BANANA_CANDIDATE_JSON_INVALID"); }
  const artifact = artifactSchema.parse(raw);
  const ids = artifact.model_candidates.map((candidate) => candidate.model_id).sort();
  if (ids.length !== MODEL_IDS.length || ids.some((id, index) => id !== [...MODEL_IDS].sort()[index]) ||
      artifact.form_binding.model_ids.length !== MODEL_IDS.length || artifact.form_binding.model_ids.slice().sort().some((id, index) => id !== [...MODEL_IDS].sort()[index]) ||
      artifact.form_binding.source_sha256 !== "sha256:b66e233dc1ad667fc128b25c19255458ce51fe4bf6e4648d3848b27b402c1c1e" ||
      artifact.source_refs[0]?.url !== "https://syntx.ai/assets/1791467421/banana.js" ||
      artifact.source_refs[0]?.sha256 !== artifact.form_binding.source_sha256 ||
      artifact.model_candidates.some((candidate) => candidate.parameter_schema.properties.model_type?.type !== "string" ||
        candidate.parameter_schema.properties.model_type?.type === "string" && !candidate.parameter_schema.properties.model_type.enum?.includes(candidate.model_id))) {
    throw new Error("BANANA_CANDIDATE_MODEL_BINDING_INVALID");
  }
  return Object.freeze({ artifact_version: BANANA_CONDITIONAL_SETTINGS_V19_VERSION, artifact_sha256: actual, artifact: deepFreeze(artifact) });
}

export function makeSourceDerivedParameterCandidate(
  loaded: LoadedBananaConditionalSettingsV19 | null,
  model: { readonly id: string; readonly upstream_id: string; readonly ai_name: string; readonly active: boolean; readonly catalog_version: string; readonly fetched_at: string; readonly source_hashes: { readonly models: string } },
  operationId: string | null,
  outputModality: string | undefined
): SourceDerivedParameterCandidate | null {
  if (loaded === null || !model.active || model.ai_name !== "banana" || operationId !== "generate-image" || outputModality !== "image" || model.source_hashes.models !== BANANA_CONDITIONAL_SETTINGS_PUBLIC_MODELS_SHA256 || model.fetched_at !== BANANA_CONDITIONAL_SETTINGS_PUBLIC_FETCHED_AT || model.upstream_id !== model.id) return null;
  const candidate = loaded.artifact.model_candidates.find((entry) => entry.model_id === model.id && entry.ai_name === model.ai_name && entry.operation_id === operationId);
  if (!candidate) return null;
  return sourceDerivedParameterCandidateSchema.parse({
    candidate_status: "STATIC_UI_CANDIDATE",
    runtime_usable: false,
    backend_acceptance: false,
    source: {
      model_id: candidate.model_id,
      ai_name: candidate.ai_name,
      upstream_model_value: model.upstream_id,
      operation_id: candidate.operation_id,
      public_catalog_version: loaded.artifact.public_catalog_version,
      public_models_sha256: model.source_hashes.models,
      settings_inventory_version: loaded.artifact.settings_inventory_version,
      source_build_id: loaded.artifact.source_build_id,
      form_source_sha256: loaded.artifact.form_binding.source_sha256,
      artifact_version: loaded.artifact_version,
      artifact_sha256: loaded.artifact_sha256
    },
    parameter_schema: candidate.parameter_schema,
    field_evidence: candidate.field_evidence
  });
}

function assertDirectory(path: string): void { const stat = lstatSync(path); if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("BANANA_CANDIDATE_DIRECTORY_UNSAFE"); }
function deepFreeze<T>(value: T): T { if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested); Object.freeze(value); } return value; }
function readBoundedArtifact(path: string): Buffer {
  const pathStat = lstatSync(path);
  if (pathStat.isSymbolicLink() || !pathStat.isFile()) throw new Error("BANANA_CANDIDATE_FILE_UNSAFE");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size < 1 || before.size > MAX_ARTIFACT_BYTES) throw new Error("BANANA_CANDIDATE_SIZE_INVALID");
    const bytes = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < bytes.length) { const count = readSync(fd, bytes, offset, bytes.length - offset, null); if (count === 0) break; offset += count; }
    const after = fstatSync(fd);
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error("BANANA_CANDIDATE_CHANGED_DURING_READ");
    return bytes.subarray(0, offset);
  } finally { closeSync(fd); }
}
