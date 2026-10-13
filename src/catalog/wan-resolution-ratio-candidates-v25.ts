import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod/v4";
import { getPublicCatalogDirectory } from "./public-catalog-history.js";
import { generationContractV2ParameterNodeSchema } from "../domain/generation-contract-v2.js";

export const WAN_RESOLUTION_RATIO_V25_VERSION =
  "sha256-1771f7367a161d13cc5cdf4c7363c498d51f809cea11d0e657786e5328c98a3f.json" as const;
export const WAN_RESOLUTION_RATIO_V25_SHA256 =
  "sha256:1771f7367a161d13cc5cdf4c7363c498d51f809cea11d0e657786e5328c98a3f" as const;
export const WAN_RESOLUTION_RATIO_V25_PUBLIC_VERSION =
  "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json" as const;
export const WAN_RESOLUTION_RATIO_V25_SETTINGS_VERSION =
  "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json" as const;
export const WAN_RESOLUTION_RATIO_V25_PUBLIC_MODELS_SHA256 =
  "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444" as const;
export const WAN_RESOLUTION_RATIO_V25_FETCHED_AT = "2026-10-08T13:18:39.393Z" as const;
const EXPECTED_BYTES = 4_591;
const MAX_ARTIFACT_BYTES = 64 * 1024;
const MODEL_IDS = [
  "wan_25_i2v_preview", "wan_25_t2v_preview", "wan_26_i2v", "wan_26_i2v_flash",
  "wan_26_r2v", "wan_26_r2v_flash", "wan_26_t2v", "wan_27_i2v", "wan_27_r2v",
  "wan_27_t2v", "wan_27_videoedit"
] as const;
const WAN_25_MODEL_IDS = new Set(["wan_25_i2v_preview", "wan_25_t2v_preview"]);
const RATIOS_480 = ["16:9", "9:16", "1:1"] as const;
const RATIOS_OTHER = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const;

const unknownStatus = z.object({ status: z.literal("UNKNOWN") }).strict();
const resolutionControlSchema = z.object({
  field: z.literal("resolution"),
  model_options: z.array(z.object({
    model_id: z.enum(MODEL_IDS),
    status: z.literal("FINITE_SOURCE_CANDIDATE"),
    values: z.array(z.enum(["480P", "720P", "1080P"])).min(1).max(3)
  }).strict()).length(11),
  ui_default_candidate: unknownStatus,
  backend_default: z.literal("UNKNOWN"),
  model_applicability: z.literal("UNKNOWN")
}).strict();
const aspectRatioControlSchema = z.object({
  field: z.literal("aspect_ratio"),
  ratio_prop: z.tuple([z.literal("He"), z.literal("value")]),
  branches: z.tuple([
    z.object({
      when: z.object({ field: z.literal("resolution"), operator: z.literal("==="), value: z.literal("480P") }).strict(),
      allowed_values: z.tuple([z.literal("16:9"), z.literal("9:16"), z.literal("1:1")])
    }).strict(),
    z.object({
      when: z.object({ field: z.literal("resolution"), operator: z.literal("!=="), value: z.literal("480P") }).strict(),
      allowed_values: z.tuple([z.literal("16:9"), z.literal("9:16"), z.literal("1:1"), z.literal("4:3"), z.literal("3:4")])
    }).strict()
  ]),
  ui_default_candidate: unknownStatus,
  backend_default: z.literal("UNKNOWN"),
  model_applicability: z.literal("UNKNOWN")
}).strict();

const artifactSchema = z.object({
  schema_version: z.literal("1.0.0"),
  catalog_kind: z.literal("WAN_RESOLUTION_RATIO_CANDIDATES"),
  evidence_scope: z.literal("PARTIAL_STATIC_UI_CANDIDATE"),
  runtime_usable: z.literal(false),
  backend_acceptance: z.literal(false),
  source_persisted: z.literal(false),
  public_version: z.literal(WAN_RESOLUTION_RATIO_V25_PUBLIC_VERSION),
  settings_version: z.literal(WAN_RESOLUTION_RATIO_V25_SETTINGS_VERSION),
  build_id: z.literal("1791467421"),
  ticket: z.string().max(20),
  source_identity: z.object({
    module_name: z.literal("wan-video.js"),
    bytes: z.literal(19_503),
    sha256: z.literal("sha256:aae2be04ca8a814db7dfb93717a234f55922b4b9f0ebc3eccd517c9d82f46119")
  }).strict(),
  source_facts_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  observed_at: z.iso.datetime(),
  model_ids: z.array(z.enum(MODEL_IDS)).length(11),
  target_fields: z.tuple([z.literal("resolution"), z.literal("aspect_ratio")]),
  controls: z.tuple([resolutionControlSchema, aspectRatioControlSchema]),
  limitations: z.array(z.string().min(1).max(300)).length(3)
}).strict();

const parameterSchemaCandidateSchema = z.object({
  type: z.literal("object"),
  additional_properties: z.literal(false),
  required: z.array(z.string().max(64)).max(64),
  properties: z.record(z.string().max(64), generationContractV2ParameterNodeSchema),
  conditions: z.array(z.unknown()).max(64),
  conditional_enums: z.array(z.unknown()).max(64)
}).strict();

const ratioCaseSchema = z.object({
  when: z.object({ field: z.literal("resolution"), equals: z.enum(["480P", "720P", "1080P"]) }).strict(),
  allowed_values: z.array(z.enum(RATIOS_OTHER)).min(3).max(5)
}).strict();
const fieldCandidateEvidenceSchema = z.object({
  status: z.enum(["FINITE_SOURCE_CANDIDATE", "CONDITIONAL_SOURCE_CANDIDATE"]),
  allowed_values: z.array(z.string().max(64)).max(8),
  required: z.literal("UNKNOWN"),
  default: z.literal("UNKNOWN"),
  visibility: z.literal("UNKNOWN"),
  model_applicability: z.literal("UNKNOWN"),
  conditional_on: z.string().max(64).nullable().optional(),
  branches: z.array(ratioCaseSchema).max(3).optional()
}).strict();

export const wanResolutionRatioCandidateSchema = z.object({
  candidate_status: z.literal("STATIC_UI_GETTER_CANDIDATE"),
  runtime_usable: z.literal(false),
  backend_acceptance: z.literal(false),
  wrapper_semantics_verified: z.literal(false),
  wrapper_semantics: z.literal("UNKNOWN"),
  defaults_status: z.literal("UNKNOWN"),
  visibility_status: z.literal("UNKNOWN"),
  model_applicability: z.literal("UNKNOWN"),
  source: z.object({
    model_id: z.enum(MODEL_IDS),
    ai_name: z.literal("wan_video"),
    upstream_model_value: z.string().min(1).max(160),
    operation_id: z.literal("generate-video"),
    public_catalog_version: z.literal(WAN_RESOLUTION_RATIO_V25_PUBLIC_VERSION),
    public_models_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    settings_inventory_version: z.literal(WAN_RESOLUTION_RATIO_V25_SETTINGS_VERSION),
    source_build_id: z.literal("1791467421"),
    artifact_version: z.literal(WAN_RESOLUTION_RATIO_V25_VERSION),
    artifact_sha256: z.literal(WAN_RESOLUTION_RATIO_V25_SHA256)
  }).strict(),
  parameter_schema: parameterSchemaCandidateSchema,
  field_evidence: z.object({
    resolution: fieldCandidateEvidenceSchema,
    aspect_ratio: fieldCandidateEvidenceSchema
  }).strict()
}).strict();

export type WanResolutionRatioV25Artifact = z.infer<typeof artifactSchema>;
export type WanResolutionRatioCandidateV25 = z.infer<typeof wanResolutionRatioCandidateSchema>;

const loadedArtifactBrand: unique symbol = Symbol("LoadedWanResolutionRatioV25");

export interface LoadedWanResolutionRatioV25 {
  readonly [loadedArtifactBrand]: true;
  readonly artifact_version: typeof WAN_RESOLUTION_RATIO_V25_VERSION;
  readonly artifact_sha256: typeof WAN_RESOLUTION_RATIO_V25_SHA256;
  readonly artifact: WanResolutionRatioV25Artifact;
}

export function loadPinnedWanResolutionRatioCandidatesV25(catalogDirectory?: string): LoadedWanResolutionRatioV25 | null {
  try {
    const root = catalogDirectory === undefined ? getPublicCatalogDirectory() : resolve(catalogDirectory);
    assertDirectory(root);
    const runtime = join(root, "runtime");
    assertDirectory(runtime);
    const versionDirectory = join(runtime, "v25");
    assertDirectory(versionDirectory);
    return parsePinnedWanResolutionRatioCandidatesV25Bytes(readBoundedArtifact(join(versionDirectory, WAN_RESOLUTION_RATIO_V25_VERSION)));
  } catch {
    return null;
  }
}

/** Hash-first immutable loader. The unpinned document parser below is for structural diagnostics/tests only. */
export function parsePinnedWanResolutionRatioCandidatesV25Bytes(bytes: Uint8Array): LoadedWanResolutionRatioV25 {
  if (bytes.byteLength !== EXPECTED_BYTES || bytes.byteLength > MAX_ARTIFACT_BYTES) throw new Error("WAN_RATIO_CANDIDATE_SIZE_INVALID");
  const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (actual !== WAN_RESOLUTION_RATIO_V25_SHA256) throw new Error("WAN_RATIO_CANDIDATE_HASH_MISMATCH");
  const artifact = parseWanResolutionRatioCandidatesV25Document(bytes);
  const loaded = Object.freeze({
    [loadedArtifactBrand]: true as const,
    artifact_version: WAN_RESOLUTION_RATIO_V25_VERSION,
    artifact_sha256: actual as typeof WAN_RESOLUTION_RATIO_V25_SHA256,
    artifact: deepFreeze(artifact)
  });
  return loaded;
}

/** Strict UTF-8/schema parser only; this function does not establish source provenance or a trusted pin. */
export function parseWanResolutionRatioCandidatesV25Document(bytes: Uint8Array): WanResolutionRatioV25Artifact {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_ARTIFACT_BYTES) throw new Error("WAN_RATIO_CANDIDATE_SIZE_INVALID");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error("WAN_RATIO_CANDIDATE_UTF8_INVALID"); }
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { throw new Error("WAN_RATIO_CANDIDATE_JSON_INVALID"); }
  const artifact = artifactSchema.parse(raw);
  validateArtifactSemantics(artifact);
  return deepFreeze(artifact);
}

export function makeWanResolutionRatioCandidateV25(
  loaded: LoadedWanResolutionRatioV25 | null,
  model: {
    readonly id: string;
    readonly upstream_id: string;
    readonly ai_name: string;
    readonly active: boolean;
    readonly catalog_version: string;
    readonly fetched_at: string;
    readonly source_hashes: { readonly models: string };
  },
  operationId: string | null,
  outputModality: string | undefined
): WanResolutionRatioCandidateV25 | null {
  if (loaded === null || loaded[loadedArtifactBrand] !== true || loaded.artifact_version !== WAN_RESOLUTION_RATIO_V25_VERSION ||
      loaded.artifact_sha256 !== WAN_RESOLUTION_RATIO_V25_SHA256 || !model.active || model.ai_name !== "wan_video" ||
      operationId !== "generate-video" || outputModality !== "video" ||
      model.fetched_at !== WAN_RESOLUTION_RATIO_V25_FETCHED_AT ||
      model.source_hashes.models !== WAN_RESOLUTION_RATIO_V25_PUBLIC_MODELS_SHA256 ||
      model.catalog_version !== `${model.fetched_at}.${model.source_hashes.models.slice(7, 19)}` ||
      model.upstream_id !== model.id || !loaded.artifact.model_ids.includes(model.id as (typeof MODEL_IDS)[number])) {
    return null;
  }
  const resolutionEvidence = loaded.artifact.controls[0].model_options.find((entry) => entry.model_id === model.id);
  if (!resolutionEvidence || resolutionEvidence.status !== "FINITE_SOURCE_CANDIDATE") return null;
  const branches = resolutionEvidence.values.map((resolution) => ({
    when: { field: "resolution" as const, equals: resolution },
    allowed_values: resolution === "480P" ? [...RATIOS_480] : [...RATIOS_OTHER]
  }));
  const ratioValues = [...RATIOS_OTHER];
  const properties = {
    resolution: { type: "string" as const, enum: [...resolutionEvidence.values] },
    aspect_ratio: { type: "string" as const, enum: ratioValues }
  };
  return wanResolutionRatioCandidateSchema.parse({
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
      operation_id: "generate-video",
      public_catalog_version: loaded.artifact.public_version,
      public_models_sha256: model.source_hashes.models,
      settings_inventory_version: loaded.artifact.settings_version,
      source_build_id: loaded.artifact.build_id,
      artifact_version: loaded.artifact_version,
      artifact_sha256: loaded.artifact_sha256
    },
    parameter_schema: {
      type: "object",
      additional_properties: false,
      required: [],
      properties,
      conditions: [],
      conditional_enums: [{ field: "aspect_ratio", cases: branches }]
    },
    field_evidence: {
      resolution: {
        status: "FINITE_SOURCE_CANDIDATE",
        allowed_values: [...resolutionEvidence.values],
        required: "UNKNOWN", default: "UNKNOWN", visibility: "UNKNOWN", model_applicability: "UNKNOWN"
      },
      aspect_ratio: {
        status: "CONDITIONAL_SOURCE_CANDIDATE",
        allowed_values: ratioValues,
        required: "UNKNOWN", default: "UNKNOWN", visibility: "UNKNOWN", model_applicability: "UNKNOWN",
        conditional_on: "resolution",
        branches
      }
    }
  });
}

function validateArtifactSemantics(artifact: WanResolutionRatioV25Artifact): void {
  const modelIds = [...artifact.model_ids].sort();
  if (modelIds.length !== MODEL_IDS.length || modelIds.some((modelId, index) => modelId !== [...MODEL_IDS].sort()[index]) ||
      artifact.target_fields[0] !== "resolution" || artifact.target_fields[1] !== "aspect_ratio" ||
      artifact.controls[0].model_options.length !== MODEL_IDS.length ||
      artifact.controls[0].model_options.some((option) =>
        option.status !== "FINITE_SOURCE_CANDIDATE" ||
        (WAN_25_MODEL_IDS.has(option.model_id)
          ? !sameValues(option.values, ["480P", "720P", "1080P"])
          : !sameValues(option.values, ["720P", "1080P"]))
      ) || new Set(artifact.controls[0].model_options.map((option) => option.model_id)).size !== MODEL_IDS.length ||
      !sameValues(artifact.controls[1].branches[0].allowed_values, RATIOS_480) ||
      !sameValues(artifact.controls[1].branches[1].allowed_values, RATIOS_OTHER) ||
      artifact.controls.some((control) => control.ui_default_candidate.status !== "UNKNOWN" ||
        control.backend_default !== "UNKNOWN" || control.model_applicability !== "UNKNOWN")) {
    throw new Error("WAN_RATIO_CANDIDATE_BINDING_INVALID");
  }
}

function sameValues(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function assertDirectory(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("WAN_RATIO_CANDIDATE_DIRECTORY_UNSAFE");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function readBoundedArtifact(path: string): Buffer {
  const pathStat = lstatSync(path);
  if (pathStat.isSymbolicLink() || !pathStat.isFile()) throw new Error("WAN_RATIO_CANDIDATE_FILE_UNSAFE");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size !== EXPECTED_BYTES || before.size > MAX_ARTIFACT_BYTES) {
      throw new Error("WAN_RATIO_CANDIDATE_SIZE_INVALID");
    }
    const bytes = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    const after = fstatSync(fd);
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error("WAN_RATIO_CANDIDATE_CHANGED_DURING_READ");
    }
    return bytes.subarray(0, offset);
  } finally {
    closeSync(fd);
  }
}
