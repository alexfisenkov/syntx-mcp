import { createHash } from "node:crypto";
import { constants, lstatSync } from "node:fs";
import { link, mkdir, open, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod/v4";
import { archiveGenerationContractRegistryV2 } from "../src/catalog/generation-contract-history-v2.js";
import {
  createGenerationContractRegistryV2,
  generationContractRegistryV2Schema,
  type GenerationContractRegistryV2,
  type GenerationContractV2Input
} from "../src/domain/generation-contract-v2.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const PARENT_VERSION = "sha256-650fe8e62c95298d81b8134d3f583b0acfbe55fe147ec2c828d95f941f7236ef.json";
const PARENT_REGISTRY_SHA256 = "sha256:aa471747dd21349c35a766dced8189dd58ed970256f93f25aeb67bdb154cc856";
const FLEX_VARIANT_ID = "banana-ui-reviewed-banana-2.1";
const FLEX_SCHEMA_SHA256 = "sha256:978ac3e57d759fce06e8ef1013e7e3300aaaff654e81ac0a719e9e7fbfe9103a";
const EXACT_VARIANT_ID = "banana21-image-2k-medium-landscape";
const SETTINGS = { model_type: "banana-2.1", aspect_ratio: "16:9", image_size: "2K", thinking_level: "medium", n: 1, file_urls: [] } as const;

const proofInputSchema = z.object({
  schema_version: z.literal("1.0.0"),
  artifact_kind: z.literal("OWNER_EXACT_CONFIGURABLE_BANANA_PROBE_V1"),
  runtime_usable: z.literal(false),
  outcome: z.literal("PASS_EXACT_RESULT_ONLY"),
  parent_registry_version: z.literal(PARENT_VERSION),
  parent_registry_sha256: z.literal(PARENT_REGISTRY_SHA256),
  tested_variant_id: z.literal(FLEX_VARIANT_ID),
  tested_schema_sha256: z.literal(FLEX_SCHEMA_SHA256),
  request_fingerprint_sha256: z.string().regex(HASH),
  model_id: z.literal("banana-2.1"),
  operation_id: z.literal("generate-image"),
  settings: z.object({
    model_type: z.literal("banana-2.1"),
    aspect_ratio: z.literal("16:9"),
    image_size: z.literal("2K"),
    thinking_level: z.literal("medium"),
    n: z.literal(1),
    file_urls: z.tuple([])
  }).strict(),
  attempt_started_at_exact: z.null(),
  attempt_started_at_lower_bound: z.iso.datetime(),
  observed_at: z.iso.datetime(),
  actual_upstream_call: z.literal(true),
  dispatch_count: z.literal(1),
  retry_count: z.literal(0),
  artifact_count: z.literal(1),
  mime_types: z.tuple([z.literal("image/jpeg")]),
  safe_artifact_summary_sha256: z.string().regex(HASH),
  media_content_sha256: z.null(),
  playback_verified: z.literal(false),
  code_hashes: z.array(z.object({
    source: z.string().regex(/^(?:src|scripts)\/[A-Za-z0-9._/-]+$/u).refine((value) => !value.includes("..")),
    sha256: z.string().regex(HASH)
  }).strict()).min(2).max(12).superRefine((entries, context) => {
    if (new Set(entries.map((entry) => entry.source)).size !== entries.length) context.addIssue({ code: "custom", message: "Code source references must be unique." });
  }),
  pre_probe_history: z.tuple([z.object({
    status: z.literal("HANDOFF_NOT_CONFIRMED"),
    observed_at: z.null(),
    wait_timeout_seconds: z.literal(45),
    local_unlink_status: z.literal("REVOKED_READBACK_CONFIRMED"),
    child_exit_code: z.literal(1),
    actual_upstream_call: z.literal(false)
  }).strict()]),
  cleanup: z.object({
    observed_at: z.iso.datetime(),
    local_unlink_status: z.literal("REVOKED_READBACK_CONFIRMED"),
    process_exit_code: z.literal(0)
  }).strict()
}).strict().superRefine((evidence, context) => {
  if (Date.parse(evidence.cleanup.observed_at) < Date.parse(evidence.observed_at)) {
    context.addIssue({ code: "custom", path: ["cleanup", "observed_at"], message: "Cleanup must follow terminal observation." });
  }
  if (Date.parse(evidence.attempt_started_at_lower_bound) > Date.parse(evidence.observed_at)) {
    context.addIssue({ code: "custom", path: ["attempt_started_at_lower_bound"], message: "Start lower bound cannot follow the terminal observation." });
  }
});

export const EXACT_BANANA_PROOF_V2_PARENT_VERSION = PARENT_VERSION;
export const EXACT_BANANA_PROOF_V2_VARIANT_ID = EXACT_VARIANT_ID;

export interface BananaExactTerminalEvidenceV2 {
  readonly schema_version: "1.0.0";
  readonly artifact_kind: "OWNER_EXACT_CONFIGURABLE_BANANA_PROBE_V1";
  readonly runtime_usable: false;
  readonly outcome: "PASS_EXACT_RESULT_ONLY";
  readonly parent_registry_version: string;
  readonly parent_registry_sha256: string;
  readonly tested_variant_id: "banana-ui-reviewed-banana-2.1";
  readonly tested_schema_sha256: string;
  readonly request_fingerprint_sha256: string;
  readonly model_id: "banana-2.1";
  readonly operation_id: "generate-image";
  readonly settings: {
    readonly model_type: "banana-2.1";
    readonly aspect_ratio: "16:9";
    readonly image_size: "2K";
    readonly thinking_level: "medium";
    readonly n: 1;
    readonly file_urls: readonly [];
  };
  readonly attempt_started_at_exact: null;
  readonly attempt_started_at_lower_bound: string;
  readonly observed_at: string;
  readonly actual_upstream_call: true;
  readonly dispatch_count: 1;
  readonly retry_count: 0;
  readonly artifact_count: 1;
  readonly mime_types: readonly ["image/jpeg"];
  readonly safe_artifact_summary_sha256: string;
  readonly media_content_sha256: null;
  readonly playback_verified: false;
  readonly code_hashes: readonly { readonly source: string; readonly sha256: string }[];
  readonly pre_probe_history: readonly [{
    readonly status: "HANDOFF_NOT_CONFIRMED";
    readonly observed_at: null;
    readonly wait_timeout_seconds: 45;
    readonly local_unlink_status: "REVOKED_READBACK_CONFIRMED";
    readonly child_exit_code: 1;
    readonly actual_upstream_call: false;
  }];
  readonly cleanup: {
    readonly observed_at: string;
    readonly local_unlink_status: "REVOKED_READBACK_CONFIRMED";
    readonly process_exit_code: 0;
  };
}

export interface ExactBananaProofV2BuildResult {
  readonly proof_artifact: Readonly<Record<string, unknown>>;
  readonly proof_json: string;
  readonly proof_reference: string;
  readonly proof_sha256: string;
  readonly registry: GenerationContractRegistryV2;
  readonly added_variant_id: "banana21-image-2k-medium-landscape";
}

export function buildExactBananaProofV2(
  currentRegistry: GenerationContractRegistryV2,
  rawEvidence: BananaExactTerminalEvidenceV2,
  reviewedAt: string
): ExactBananaProofV2BuildResult {
  const evidence = proofInputSchema.parse(rawEvidence);
  const parsedRegistry = generationContractRegistryV2Schema.parse(currentRegistry);
  if (!Number.isFinite(Date.parse(reviewedAt)) || Date.parse(reviewedAt) < Date.parse(evidence.cleanup.observed_at)) {
    throw new Error("EXACT_BANANA_PROOF_REVIEW_TIME_INVALID");
  }
  if (evidence.settings.model_type !== SETTINGS.model_type || evidence.settings.aspect_ratio !== SETTINGS.aspect_ratio ||
      evidence.settings.image_size !== SETTINGS.image_size || evidence.settings.thinking_level !== SETTINGS.thinking_level ||
      evidence.settings.n !== SETTINGS.n || evidence.settings.file_urls.length !== SETTINGS.file_urls.length) {
    throw new Error("EXACT_BANANA_PROOF_SETTINGS_MISMATCH");
  }
  if (parsedRegistry.registry_sha256 !== PARENT_REGISTRY_SHA256 || parsedRegistry.contracts.length !== 38 ||
      parsedRegistry.contracts.filter((contract) => contract.status === "live_verified").length !== 4 ||
      parsedRegistry.contracts.filter((contract) => contract.status === "reviewed").length !== 34) {
    throw new Error("EXACT_BANANA_PROOF_PARENT_REGISTRY_MISMATCH");
  }
  const flexible = parsedRegistry.contracts.find((contract) => contract.variant_id === FLEX_VARIANT_ID);
  if (!flexible || flexible.status !== "reviewed" || flexible.schema_hash !== FLEX_SCHEMA_SHA256 ||
      flexible.model_id !== evidence.model_id || flexible.operation_id !== evidence.operation_id ||
      flexible.model_type !== evidence.settings.model_type || flexible.ai_name !== "banana" ||
      !enumIncludes(flexible.parameters.properties.aspect_ratio, evidence.settings.aspect_ratio) ||
      !enumIncludes(flexible.parameters.properties.image_size, evidence.settings.image_size) ||
      !enumIncludes(flexible.parameters.properties.thinking_level, evidence.settings.thinking_level)) {
    throw new Error("EXACT_BANANA_PROOF_FLEX_SCHEMA_MISMATCH");
  }
  if (parsedRegistry.contracts.some((contract) => contract.variant_id === EXACT_VARIANT_ID)) {
    throw new Error("EXACT_BANANA_PROOF_VARIANT_ALREADY_EXISTS");
  }

  const proofArtifact = Object.freeze({
    schema_version: evidence.schema_version,
    artifact_kind: evidence.artifact_kind,
    evidence_level: "OWNER_TERMINAL_EXACT_SETTINGS",
    runtime_usable: false,
    parent_registry_version: evidence.parent_registry_version,
    parent_registry_sha256: evidence.parent_registry_sha256,
    tested_request: {
      model_id: evidence.model_id,
      operation_id: evidence.operation_id,
      variant_id: evidence.tested_variant_id,
      schema_sha256: evidence.tested_schema_sha256,
      request_fingerprint_sha256: evidence.request_fingerprint_sha256,
      settings: evidence.settings,
      prompt_recorded: false
    },
    timing: {
      attempt_started_at_exact: evidence.attempt_started_at_exact,
      attempt_started_at_lower_bound: evidence.attempt_started_at_lower_bound,
      terminal_observed_at: evidence.observed_at,
      cleanup_observed_at: evidence.cleanup.observed_at
    },
    observation: {
      outcome: evidence.outcome,
      observed_at: evidence.observed_at,
      actual_upstream_call: evidence.actual_upstream_call,
      dispatch_count: evidence.dispatch_count,
      retry_count: evidence.retry_count,
      artifact_count: evidence.artifact_count,
      mime_types: evidence.mime_types,
      safe_artifact_summary_sha256: evidence.safe_artifact_summary_sha256,
      media_content_sha256: evidence.media_content_sha256,
      playback_verified: evidence.playback_verified
    },
    code_hashes: evidence.code_hashes,
    pre_probe_history: evidence.pre_probe_history,
    cleanup: evidence.cleanup,
    scope_limits: {
      one_exact_tuple_only: true,
      flexible_profile_remains_reviewed: true,
      media_bytes_or_content_claimed: false,
      playback_claimed: false,
      broader_parameter_or_model_coverage_claimed: false
    }
  });
  const proofJson = `${JSON.stringify(proofArtifact)}\n`;
  const proofBytes = Buffer.from(proofJson, "utf8");
  const proofSha256 = `sha256:${createHash("sha256").update(proofBytes).digest("hex")}`;
  const proofHex = proofSha256.slice("sha256:".length);
  const proofReference = `catalog/runtime/v22/sha256-${proofHex}.json`;
  const priorContracts: GenerationContractV2Input[] = parsedRegistry.contracts.map(({ schema_hash: _schemaHash, ...contract }) => contract);
  const liveContract: GenerationContractV2Input = {
    variant_id: EXACT_VARIANT_ID,
    model_id: "banana-2.1",
    operation_id: "generate-image",
    modality: "image",
    route: "design",
    ai_name: "banana",
    model_type: "banana-2.1",
    status: "live_verified",
    provenance: {
      settings_source_sha256: flexible.provenance.settings_source_sha256,
      references: [
        ...flexible.provenance.references.filter((reference) => reference.kind === "public_catalog" ||
          (reference.kind === "frontend_static" && reference.sha256 === flexible.provenance.settings_source_sha256)),
        { kind: "live_owner", reference: proofReference, sha256: proofSha256 },
        { kind: "manual_review", reference: `Exact configurable Banana terminal tuple ${EXACT_VARIANT_ID}; tested flexible schema ${FLEX_SCHEMA_SHA256}.` },
        ...evidence.code_hashes.map((entry) => ({ kind: "manual_review" as const, reference: entry.source, sha256: entry.sha256 }))
      ],
      reviewed_at: reviewedAt,
      live_observed_at: evidence.observed_at
    },
    parameters: {
      type: "object",
      additional_properties: false,
      required: ["prompt"],
      properties: { prompt: { type: "string", min_length: 1 } },
      conditions: [],
      conditional_enums: []
    },
    wire: {
      dispatch_action: "generate-image",
      input_kind: "prompt",
      prompt_field: "prompt",
      settings_fields: {},
      fixed_settings: {
        aspect_ratio: evidence.settings.aspect_ratio,
        image_size: evidence.settings.image_size,
        thinking_level: evidence.settings.thinking_level,
        n: evidence.settings.n,
        file_urls: []
      },
      media_reference_fields: {}
    },
    output: { decoder_profile: "syntx-owner-image-jpeg", mime_types: ["image/jpeg"] },
    limits: { max_parameters: 1, max_value_depth: 4, max_serialized_bytes: 131_072, max_normalized_nodes: 20_000 }
  };
  const registry = createGenerationContractRegistryV2({
    schema_version: "2.0.0",
    catalog_version: parsedRegistry.catalog_version,
    source_hashes: parsedRegistry.source_hashes,
    contracts: [...priorContracts, liveContract]
  });
  if (registry.contracts.length !== 39 || registry.contracts.filter((contract) => contract.status === "live_verified").length !== 5 ||
      registry.contracts.filter((contract) => contract.status === "reviewed").length !== 34 ||
      parsedRegistry.contracts.some((old) => JSON.stringify(registry.contracts.find((contract) => contract.variant_id === old.variant_id)) !== JSON.stringify(old))) {
    throw new Error("EXACT_BANANA_PROOF_REGISTRY_INVARIANT_FAILED");
  }
  return deepFreeze({
    proof_artifact: proofArtifact,
    proof_json: proofJson,
    proof_reference: proofReference,
    proof_sha256: proofSha256,
    registry,
    added_variant_id: EXACT_VARIANT_ID
  });
}

export async function archiveExactBananaProofV2(
  built: ExactBananaProofV2BuildResult,
  catalogDirectory?: string
): Promise<{ readonly proof_reference: string; readonly proof_sha256: string; readonly proof_status: "created" | "existing"; readonly registry_version: string; readonly registry_status: "created" | "existing" }> {
  const root = resolve(catalogDirectory ?? join(process.cwd(), "catalog"));
  const proofBytes = Buffer.from(built.proof_json, "utf8");
  const proofSha256 = `sha256:${createHash("sha256").update(proofBytes).digest("hex")}`;
  const proofVersion = `catalog/runtime/v22/sha256-${proofSha256.slice("sha256:".length)}.json`;
  const registry = generationContractRegistryV2Schema.parse(built.registry);
  if (proofSha256 !== built.proof_sha256 || proofVersion !== built.proof_reference ||
      !registry.contracts.some((contract) => contract.variant_id === EXACT_VARIANT_ID && contract.status === "live_verified" &&
        contract.provenance.references.some((reference) => reference.kind === "live_owner" && reference.reference === proofVersion && reference.sha256 === proofSha256))) {
    throw new Error("EXACT_BANANA_PROOF_ARCHIVE_BINDING_INVALID");
  }
  const relativeProof = built.proof_reference.replace(/^catalog\//u, "");
  const proofPath = join(root, relativeProof);
  const directory = join(root, "runtime", "v22");
  await mkdir(directory, { recursive: true, mode: 0o755 });
  const stat = lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("EXACT_BANANA_PROOF_DIRECTORY_UNSAFE");
  const temporaryPath = join(directory, `.pending-${proofSha256.slice("sha256:".length)}.tmp`);
  const targetStatus = await writeCreateOnce(proofPath, temporaryPath, proofBytes);
  const registryArchive = await archiveGenerationContractRegistryV2(registry, root);
  return Object.freeze({
    proof_reference: built.proof_reference,
    proof_sha256: built.proof_sha256,
    proof_status: targetStatus,
    registry_version: registryArchive.version,
    registry_status: registryArchive.status
  });
}

async function writeCreateOnce(target: string, temporaryPath: string, bytes: Uint8Array): Promise<"created" | "existing"> {
  const temporary = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await temporary.writeFile(bytes); await temporary.sync(); }
  finally { await temporary.close(); }
  try {
    let status: "created" | "existing";
    try {
      await link(temporaryPath, target);
      status = "created";
    }
    catch (error) {
      if (!isCode(error, "EEXIST")) throw error;
      const existing = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const current = Buffer.alloc(bytes.byteLength + 1);
        const read = await existing.read(current, 0, current.length, 0);
        if (read.bytesRead !== bytes.byteLength || !current.subarray(0, read.bytesRead).equals(Buffer.from(bytes))) {
          throw new Error("EXACT_BANANA_PROOF_VERSION_COLLISION");
        }
      } finally { await existing.close(); }
      status = "existing";
    }
    await syncDirectory(dirname(target));
    return status;
  } finally {
    await unlink(temporaryPath);
    await syncDirectory(dirname(target));
  }
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    if (!(await directory.stat()).isDirectory()) throw new Error("EXACT_BANANA_PROOF_DIRECTORY_UNSAFE");
    await directory.sync();
  } finally { await directory.close(); }
}

function isCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === code;
}

function enumIncludes(node: GenerationContractRegistryV2["contracts"][number]["parameters"]["properties"][string] | undefined, value: string): boolean {
  return node !== undefined && "enum" in node && node.enum?.includes(value) === true;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
