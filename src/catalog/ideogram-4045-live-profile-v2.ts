import { createHash, randomUUID } from "node:crypto";
import { constants, lstatSync } from "node:fs";
import { link, mkdir, open, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod/v4";
import type { GenerationContractCatalogPort } from "../adapter/syntx/generation-contract-executor.js";
import { canonicalJson } from "../domain/generation-contract.js";
import {
  createGenerationContractRegistryV2,
  generationContractRegistryV2Schema,
  type GenerationContractRegistryV2,
  type GenerationContractV2Input
} from "../domain/generation-contract-v2.js";
import { archiveGenerationContractRegistryV2 } from "./generation-contract-history-v2.js";

const PARENT_VERSION = "sha256-db0f0e3a24c1951c50450cd91a2f9ce87d135e756176fa2f2ffd205d11b34a95.json";
const PARENT_SHA256 = "sha256:5883a87a18ab6f6704cf2f5f21239d84c349634af87950b91d1f1b8ca43d51e4";
const PROOF_REGISTRY_VERSION = "sha256-23ed982e5bae93abec6128ce18568229c38c1569f87efbf036cb25c063b09476.json";
const PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const PUBLIC_CATALOG_SHA256 = "sha256:e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989";
const PUBLIC_MODELS_SHA256 = "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444";
const SOURCE_SETTINGS_SHA256 = "sha256:fb8f93597c1dc69fa811e48f5d3218ef5724d9f2f1dd175a3a63f320f930274a";
const PROBE_CLI_SHA256 = "sha256:967eb2572b937930aa2fb9a80cce3f830b9bae864afe54ce457c3ce4e019f6e4";
const PROBE_CLI_REFERENCE = "scripts/live-owner-reviewed-contract-probe.mjs";
const ROOT169_REFERENCE = ".autopilot/2026-10-08-syntx-completion--wip/root-169-ideogram40-proof.json";
const ROOT170_REFERENCE = ".autopilot/2026-10-08-syntx-completion--wip/root-170-ideogram45-proof.json";
const ROOT169_SHA256 = "sha256:815378f70dc2cea748375cd6fc3d63e7db80b08b93a0a7627bff832d0c2928fc";
const ROOT170_SHA256 = "sha256:804bc2135661cfe79043db99fdb9ebe7fc0cf8a68789d0681647ab1777f67d01";
const V31_PREFIX = "catalog/runtime/v31/sha256-";
const MODEL_IDS = ["ideogram_40", "ideogram_45"] as const;
const REVIEWED_VARIANTS = ["ideogram-40-generate-source-reviewed", "ideogram-45-generate-source-reviewed"] as const;
const LIVE_VARIANTS = ["ideogram-40-generate-square-1k-turbo-auto-live", "ideogram-45-generate-square-1k-turbo-auto-live"] as const;
const CASE_IDS = ["ideogram-40-source-square", "ideogram-45-source-square"] as const;
const SOURCE_SCHEMA_HASHES = [
  "sha256:746078931628029688e1685751e41b4837daa6d9071fc4dc342efd242510987a",
  "sha256:b0bba92b9482519db0290246d942f2555b628ed0a1ba9a7bdfbadd36ec636b05"
] as const;
const REQUEST_FINGERPRINTS = [
  "sha256:b859c4848c2f8698b5be1d21009227d500598cae87c4ed5fb400309352bfe323",
  "sha256:93ef1822e26a3af3c32871495cff5045b7629ebdfdb5374bc11fc564b90aa644"
] as const;
const PROMPT_FINGERPRINTS = [
  "sha256:02ad7f63133985504f918b89e28616dd5e23170f849b56c4bef54702e711d019",
  "sha256:7f3e26b039417b8fce7d39c1764532dda51626795167a8f74b2811a3716955b4"
] as const;
const OUTPUT_FINGERPRINTS = [
  "sha256:5f76c0f10241ddd83f61a0424547de323c59288c72f44541b9ee511666f54536",
  "sha256:4d8edfe281c5dfc8f0126b4d62e3b91dc2692371f818189122f03876702f12ba"
] as const;
const OUTPUT_BYTES = [1_442_155, 1_665_509] as const;
const SAFE_ARTIFACT_SUMMARY_SHA256 = "sha256:0a171c475f78474adc5e031c8fc7e84ee87f701ec3046b3fed29c0f93852cd9d";
const FIXED_SETTINGS = Object.freeze({ file_urls: Object.freeze([]), num_images: 1, seed: null, aspect_ratio: "1:1",
  magic_prompt: "AUTO", rendering_speed: "TURBO", resolution: "1K" });

export interface BuildIdeogram4045LiveProfilesV2Input {
  readonly currentRegistry: GenerationContractRegistryV2;
  readonly publicCatalog: GenerationContractCatalogPort;
  readonly ideogram40ProofBytes: Uint8Array;
  readonly ideogram45ProofBytes: Uint8Array;
  readonly probeCliBytes: Uint8Array;
  readonly reviewedAt: string;
}

export interface Ideogram4045LiveProfilesV2BuildResult {
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly evidence_json: string;
  readonly evidence_reference: string;
  readonly evidence_sha256: string;
  readonly registry: GenerationContractRegistryV2;
  readonly added_variant_ids: readonly typeof LIVE_VARIANTS[number][];
}

const proofSchema = z.object({
  schema_version: z.string(), case_id: z.string(), source_commit: z.string(), source_sha256: z.string(),
  transport: z.string(), parent_started_at: z.string(), events: z.array(z.object({ event: z.string(), at: z.string() }).passthrough()),
  telegram_sent_at: z.string(), finish_sent_at: z.string(), parent_exit: z.object({ code: z.number(), signal: z.unknown(), at: z.string() }).passthrough(),
  final: z.object({ status: z.string(), contract_status: z.string(), confidence_scope: z.string(), model_id: z.string(),
    operation_id: z.string(), variant_id: z.string(), registry_version: z.string(), schema_hash: z.string(),
    operator_parameter_keys: z.array(z.string()), normalized_request_fingerprint: z.string(), artifact_count: z.number(),
    mime_types: z.array(z.string()), safe_artifact_summary_sha256: z.string(), probe_call_count: z.number(),
    image_geometry_observation: z.record(z.string(), z.unknown()), local_unlink_status: z.string(), cleanup_contract_status: z.string() }).passthrough(),
  telegram_send_attempts: z.number(), telegram_receipt_confirmed: z.boolean(), recovery_commands: z.number(), mutation_retries: z.number(),
  prepared_settings: z.record(z.string(), z.unknown()), private_handoff_cleared: z.boolean(), stderr_bytes: z.number(),
  fingerprint_scope: z.string(), in_memory_client_server_close_invoked_in_finally: z.boolean(),
  independent_sdk_close_receipt: z.string(), not_proven: z.array(z.string()),
  old_paid_canary_or_unknown_replay: z.boolean(), raw_private_ids_credentials_urls_media_bytes_saved: z.boolean()
}).passthrough();

export function buildIdeogram4045LiveProfilesV2(input: BuildIdeogram4045LiveProfilesV2Input): Ideogram4045LiveProfilesV2BuildResult {
  const rootProofBytes = [Buffer.from(input.ideogram40ProofBytes), Buffer.from(input.ideogram45ProofBytes)] as const;
  if (`sha256:${sha256(rootProofBytes[0])}` !== ROOT169_SHA256 || `sha256:${sha256(rootProofBytes[1])}` !== ROOT170_SHA256) {
    throw new Error("IDEOGRAM_4045_LIVE_PROOF_HASH_INVALID");
  }
  if (`sha256:${sha256(input.probeCliBytes)}` !== PROBE_CLI_SHA256) throw new Error("IDEOGRAM_4045_LIVE_SOURCE_HASH_INVALID");
  if (input.reviewedAt !== "2026-10-09T12:30:00.000Z") throw new Error("IDEOGRAM_4045_LIVE_REVIEW_TIME_INVALID");

  let proofs: z.infer<typeof proofSchema>[];
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    proofs = rootProofBytes.map((bytes) => proofSchema.parse(JSON.parse(decoder.decode(bytes))));
  } catch { throw new Error("IDEOGRAM_4045_LIVE_PROOF_INVALID"); }

  const parent = generationContractRegistryV2Schema.parse(input.currentRegistry);
  if (parent.registry_sha256 !== PARENT_SHA256 || parent.catalog_version !== "2026-10-08T13:18:39.393Z.36e6960df354" ||
      parent.contracts.length !== 46 || count(parent, "live_verified") !== 10 || count(parent, "reviewed") !== 36 ||
      parent.contracts.some((entry) => LIVE_VARIANTS.includes(entry.variant_id as typeof LIVE_VARIANTS[number]))) {
    throw new Error("IDEOGRAM_4045_LIVE_PARENT_MISMATCH");
  }
  const sourceProfiles = REVIEWED_VARIANTS.map((variant) => parent.contracts.find((entry) => entry.variant_id === variant));
  for (const [index, source] of sourceProfiles.entries()) {
    if (!source || source.status !== "reviewed" || source.model_id !== MODEL_IDS[index] || source.ai_name !== "ideogram" ||
        source.model_type !== MODEL_IDS[index] || source.operation_id !== "generate-image" ||
        source.schema_hash !== SOURCE_SCHEMA_HASHES[index] || source.provenance.settings_source_sha256 !== SOURCE_SETTINGS_SHA256 ||
        source.output.mime_types.length !== 1 || source.output.mime_types[0] !== "image/png" ||
        source.wire.fixed_settings.num_images !== 1 || source.wire.fixed_settings.seed !== null ||
        !Array.isArray(source.wire.fixed_settings.file_urls) || source.wire.fixed_settings.file_urls.length !== 0) {
      throw new Error("IDEOGRAM_4045_LIVE_SOURCE_CONTRACT_MISMATCH");
    }
    let model;
    try { model = input.publicCatalog.getModel(MODEL_IDS[index]); }
    catch { throw new Error("IDEOGRAM_4045_LIVE_PUBLIC_MODEL_BINDING_INVALID"); }
    if (model.id !== MODEL_IDS[index] || model.upstream_id !== MODEL_IDS[index] || model.ai_name !== "ideogram" || model.active !== true ||
        !model.operations.some((operation) => operation.id === "generate-image" && operation.output_modality === "image") ||
        model.source_hashes.models !== PUBLIC_MODELS_SHA256) throw new Error("IDEOGRAM_4045_LIVE_PUBLIC_MODEL_BINDING_INVALID");
  }

  const observations = proofs.map((proof, index) => validateProof(proof, index));
  const latestObservation = observations.reduce((latest, item) =>
    Date.parse(item.terminal_result_at) > Date.parse(latest.terminal_result_at) ? item : latest);
  if (!Number.isFinite(Date.parse(input.reviewedAt)) || Date.parse(input.reviewedAt) < Date.parse(latestObservation.terminal_result_at)) {
    throw new Error("IDEOGRAM_4045_LIVE_REVIEW_TIME_INVALID");
  }

  const evidenceBase = {
    schema_version: "1.0.0", artifact_kind: "ROOT_IDEOGRAM_40_45_EXACT_LIVE_PROFILE_V1",
    evidence_level: "TWO_EXACT_SOURCE_PROBE_ACCEPTANCES_ONE_FIXED_TUPLE_EACH",
    ordinary_promoted_runtime_usable: false, parent_registry_version: PARENT_VERSION, parent_registry_sha256: PARENT_SHA256,
    public_catalog_version: PUBLIC_VERSION, public_catalog_sha256: PUBLIC_CATALOG_SHA256, public_models_source_sha256: PUBLIC_MODELS_SHA256,
    source_reviewed_contracts_retained: REVIEWED_VARIANTS,
    live_profile_variants: LIVE_VARIANTS,
    source_hashes: { probe_cli: { reference: PROBE_CLI_REFERENCE, sha256: PROBE_CLI_SHA256 } },
    observations,
    scope_limits: {
      one_exact_tuple_per_model: true, ratio_other_than_1_1_claimed: false, resolution_other_than_1k_claimed: false,
      speed_other_than_turbo_claimed: false, magic_prompt_other_than_auto_claimed: false, prompt_content_or_visual_quality_claimed: false,
      full_pixel_decode_claimed: false, billing_delta_or_spending_cap_claimed: false,
      ordinary_promoted_runtime_invocation_claimed: false, actual_client_host_matrix_claimed: false,
      provider_defaults_or_extra_settings_claimed: false, references_or_edit_claimed: false
    }
  };
  const evidenceJson = `${canonicalJson(evidenceBase)}\n`;
  const evidenceSha = `sha256:${sha256(Buffer.from(evidenceJson, "utf8"))}`;
  const evidenceReference = `${V31_PREFIX}${evidenceSha.slice(7)}.json`;

  const additions: GenerationContractV2Input[] = sourceProfiles.map((source, index) => {
    const sourceContract = source!;
    const proof = proofs[index]!;
    const references = sourceContract.provenance.references.filter((reference) => reference.kind === "public_catalog" ||
      reference.kind === "frontend_static" || reference.kind === "manual_review");
    const fixedSettings = { ...FIXED_SETTINGS };
    return {
      ...stripSchemaHash(sourceContract), variant_id: LIVE_VARIANTS[index]!, status: "live_verified",
      provenance: { ...sourceContract.provenance, reviewed_at: input.reviewedAt, live_observed_at: proof.events[1]!.at,
        references: [...references,
          { kind: "live_owner", reference: evidenceReference, sha256: evidenceSha },
          { kind: "manual_review", reference: "One exact isolated source-probe result only: 1:1/1K/TURBO/AUTO; prepared settings and image-byte observation are bound in the immutable proof." }
        ] },
      parameters: { type: "object", additional_properties: false, required: ["prompt"],
        properties: { prompt: { type: "string", min_length: 1 } }, conditions: [], conditional_enums: [] },
      wire: { ...sourceContract.wire, settings_fields: {}, fixed_settings: fixedSettings },
      limits: { ...sourceContract.limits, max_parameters: 1 }
    };
  });
  const registry = createGenerationContractRegistryV2({ schema_version: "2.0.0", catalog_version: parent.catalog_version,
    source_hashes: parent.source_hashes, contracts: [...parent.contracts.map(stripSchemaHash), ...additions] });
  const preserved = parent.contracts.every((old) => canonicalJson(registry.contracts.find((entry) => entry.variant_id === old.variant_id)) === canonicalJson(old));
  if (!preserved || registry.contracts.length !== 48 || count(registry, "live_verified") !== 12 || count(registry, "reviewed") !== 36 ||
      additions.some((_addition, index) => {
        const row = registry.contracts.find((entry) => entry.variant_id === LIVE_VARIANTS[index]);
        return row?.status !== "live_verified" || row.model_id !== MODEL_IDS[index] ||
          canonicalJson(row.wire.fixed_settings) !== canonicalJson(FIXED_SETTINGS) ||
          row.parameters.required.join(",") !== "prompt";
      })) throw new Error("IDEOGRAM_4045_LIVE_REGISTRY_INVARIANT_FAILED");

  return Object.freeze({ evidence: Object.freeze({ ...evidenceBase, evidence_sha256: evidenceSha }), evidence_json: evidenceJson,
    evidence_reference: evidenceReference, evidence_sha256: evidenceSha, registry,
    added_variant_ids: Object.freeze([...LIVE_VARIANTS]) });
}

export async function archiveIdeogram4045LiveProfilesV2(
  built: Ideogram4045LiveProfilesV2BuildResult,
  catalogDirectory?: string
): Promise<{ readonly evidence_status: "created" | "existing"; readonly evidence_reference: string;
  readonly registry_status: "created" | "existing"; readonly registry_version: string }> {
  const root = resolve(catalogDirectory ?? join(process.cwd(), "catalog"));
  const evidenceBytes = Buffer.from(built.evidence_json, "utf8");
  if (`sha256:${sha256(evidenceBytes)}` !== built.evidence_sha256 || `${V31_PREFIX}${built.evidence_sha256.slice(7)}.json` !== built.evidence_reference ||
      built.evidence.evidence_sha256 !== built.evidence_sha256 || canonicalJson(built.added_variant_ids) !== canonicalJson(LIVE_VARIANTS) ||
      built.added_variant_ids.some((variant) => !built.registry.contracts.some((entry) => entry.variant_id === variant && entry.status === "live_verified" &&
        entry.provenance.references.some((reference) => reference.kind === "live_owner" && reference.reference === built.evidence_reference && reference.sha256 === built.evidence_sha256)))) {
    throw new Error("IDEOGRAM_4045_LIVE_ARCHIVE_BINDING_INVALID");
  }
  const evidenceStatus = await createOnce(join(root, built.evidence_reference.slice("catalog/".length)), evidenceBytes);
  const archived = await archiveGenerationContractRegistryV2(generationContractRegistryV2Schema.parse(built.registry), root);
  return Object.freeze({ evidence_status: evidenceStatus, evidence_reference: built.evidence_reference,
    registry_status: archived.status, registry_version: archived.version });
}

function validateProof(proof: z.infer<typeof proofSchema>, index: number) {
  const expectedModel = MODEL_IDS[index]!;
  const expectedVariant = REVIEWED_VARIANTS[index]!;
  const expectedRegistry = PROOF_REGISTRY_VERSION;
  const expectedSettings = { ...FIXED_SETTINGS, model_type: expectedModel };
  const geometry = proof.final.image_geometry_observation;
  if (proof.schema_version !== `ROOT_IDEOGRAM${index === 0 ? "40" : "45"}_REAL_PROOF_V1` || proof.case_id !== CASE_IDS[index] ||
      proof.source_commit !== "ef0ea47" || proof.source_sha256 !== PROBE_CLI_SHA256.slice(7) ||
      proof.transport !== "ACTUAL_SDK_ISOLATED_SOURCE_PROBE_MCP_NOT_ORDINARY_LIVE_TOOL" ||
      proof.fingerprint_scope !== "CALLER_PREPARED_SETTINGS_AND_PURPOSE_NOT_PROVIDER_ECHO" ||
      proof.final.status !== "PASS_EXACT_RESULT_ONLY" || proof.final.contract_status !== "reviewed" ||
      proof.final.confidence_scope !== "exact_result_only" || proof.final.model_id !== expectedModel ||
      proof.final.operation_id !== "generate-image" || proof.final.variant_id !== expectedVariant ||
      proof.final.registry_version !== expectedRegistry || proof.final.schema_hash !== SOURCE_SCHEMA_HASHES[index] ||
      proof.final.operator_parameter_keys.length !== 0 || proof.final.normalized_request_fingerprint !== REQUEST_FINGERPRINTS[index] ||
      proof.final.artifact_count !== 1 || proof.final.mime_types.length !== 1 || proof.final.mime_types[0] !== "image/png" ||
      proof.final.safe_artifact_summary_sha256 !== SAFE_ARTIFACT_SUMMARY_SHA256 || proof.final.probe_call_count !== 1 ||
      proof.final.local_unlink_status !== "REVOKED_READBACK_CONFIRMED" || proof.final.cleanup_contract_status !== "reviewed" ||
      canonicalJson(proof.prepared_settings) !== canonicalJson(expectedSettings) ||
      geometry.status !== "OBSERVED" || geometry.mime !== "image/png" || geometry.declared_mime !== "image/png" ||
      geometry.response_mime_type !== "image/png" || geometry.width !== 1024 || geometry.height !== 1024 ||
      geometry.byte_size !== OUTPUT_BYTES[index] || geometry.sha256 !== OUTPUT_FINGERPRINTS[index] ||
      geometry.requested_ratio !== "1:1" || geometry.ratio_match !== true ||
      proof.telegram_send_attempts !== 1 || !proof.telegram_receipt_confirmed || proof.recovery_commands !== 0 || proof.mutation_retries !== 0 ||
      !proof.private_handoff_cleared || proof.stderr_bytes !== 0 || !proof.in_memory_client_server_close_invoked_in_finally ||
      proof.independent_sdk_close_receipt !== "NOT_EXPOSED" || proof.old_paid_canary_or_unknown_replay ||
      proof.raw_private_ids_credentials_urls_media_bytes_saved || proof.parent_exit.code !== 0 || proof.parent_exit.signal !== null ||
      recomputeRequestFingerprint(proof, index) !== REQUEST_FINGERPRINTS[index]) {
    throw new Error("IDEOGRAM_4045_LIVE_PROOF_BINDING_INVALID");
  }
  const eventNames = proof.events.map((event) => event.event);
  const eventTimes = [proof.parent_started_at, proof.events[0]?.at, proof.events[1]?.at, proof.events[2]?.at, proof.parent_exit.at]
    .map((value) => Date.parse(value ?? ""));
  if (canonicalJson(eventNames) !== canonicalJson(["BEGIN", "TERMINAL_RESULT", "FINAL"]) ||
      eventTimes.some((value) => !Number.isFinite(value)) || eventTimes.some((value, pos) => pos > 0 && value < eventTimes[pos - 1]!) ||
      proof.telegram_sent_at < proof.events[0]!.at || proof.telegram_sent_at > proof.events[1]!.at ||
      proof.finish_sent_at < proof.events[1]!.at || proof.finish_sent_at > proof.events[2]!.at ||
      !proof.not_proven.some((value) => value.includes("ordinary promoted runtime invocation")) ||
      !proof.not_proven.some((value) => value.includes("visual content/quality/fullpixel decode")) ||
      !proof.not_proven.some((value) => value.includes("billing delta or hard cap"))) {
    throw new Error("IDEOGRAM_4045_LIVE_PROOF_TIMELINE_INVALID");
  }
  return Object.freeze({
    case_id: CASE_IDS[index], model_id: expectedModel, operation_id: "generate-image", source_reviewed_variant_id: expectedVariant,
    promoted_live_variant_id: LIVE_VARIANTS[index]!, source_registry_version: expectedRegistry,
    source_contract_schema_hash: SOURCE_SCHEMA_HASHES[index]!, source_request_fingerprint: proof.final.normalized_request_fingerprint,
    purpose_prompt_sha256: PROMPT_FINGERPRINTS[index]!, source_probe_cli_sha256: PROBE_CLI_SHA256,
    root_proof_reference: index === 0 ? ROOT169_REFERENCE : ROOT170_REFERENCE,
    root_proof_sha256: index === 0 ? ROOT169_SHA256 : ROOT170_SHA256,
    source_settings_sha256: SOURCE_SETTINGS_SHA256,
    actual_image_observation: Object.freeze({ status: "OBSERVED", mime: geometry.mime, declared_mime: geometry.declared_mime,
      response_mime_type: geometry.response_mime_type, byte_size: geometry.byte_size, width: geometry.width, height: geometry.height,
      sha256: geometry.sha256, requested_ratio: geometry.requested_ratio, ratio_match: geometry.ratio_match }),
    semantic_artifact_metadata_summary_sha256: proof.final.safe_artifact_summary_sha256,
    prepared_settings: proof.prepared_settings, probe_call_count: 1, telegram_receipt_confirmed: true,
    recovery_commands: 0, mutation_retries: 0, local_unlink_status: proof.final.local_unlink_status,
    parent_exit_code: proof.parent_exit.code, private_handoff_cleared: proof.private_handoff_cleared,
    probe_transport: proof.transport, fingerprint_scope: proof.fingerprint_scope,
    begin_at: proof.events[0]!.at, terminal_result_at: proof.events[1]!.at, final_at: proof.events[2]!.at, parent_exit_at: proof.parent_exit.at,
    ordinary_promoted_runtime_accepted: false, output_byte_sha_is_distinct_from_semantic_metadata_sha: true
  });
}

function recomputeRequestFingerprint(proof: z.infer<typeof proofSchema>, index: number): string {
  return `sha256:${sha256(Buffer.from(canonicalJson({ registry_version: PROOF_REGISTRY_VERSION, model_id: MODEL_IDS[index],
    operation_id: "generate-image", variant_id: REVIEWED_VARIANTS[index], schema_hash: SOURCE_SCHEMA_HASHES[index],
    operator_parameter_keys: [], normalized_settings: proof.prepared_settings, image_family_case_id: CASE_IDS[index],
    fixed_prompt_sha256: PROMPT_FINGERPRINTS[index] }), "utf8"))}`;
}

function stripSchemaHash(contract: GenerationContractRegistryV2["contracts"][number]): GenerationContractV2Input {
  const { schema_hash: _schemaHash, ...withoutHash } = contract;
  return withoutHash;
}
function count(registry: Pick<GenerationContractRegistryV2, "contracts">, status: "live_verified" | "reviewed"): number {
  return registry.contracts.filter((entry) => entry.status === status).length;
}
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

async function createOnce(path: string, bytes: Buffer): Promise<"created" | "existing"> {
  const directory = dirname(path);
  for (const pathPart of [dirname(directory), directory]) {
    try { await mkdir(pathPart, { mode: 0o755 }); }
    catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
    const stat = lstatSync(pathPart);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("IDEOGRAM_4045_LIVE_ARTIFACT_PATH_INVALID");
  }
  const temporaryPath = join(directory, `.pending-${randomUUID()}.tmp`);
  let temporary;
  try {
    temporary = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    await temporary.writeFile(bytes); await temporary.sync(); await temporary.close(); temporary = undefined;
    let created = false;
    try { await link(temporaryPath, path); created = true; }
    catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
    const fileStat = lstatSync(path);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new Error("IDEOGRAM_4045_LIVE_ARTIFACT_PATH_INVALID");
    const existing = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try { if (!(await existing.readFile()).equals(bytes)) throw new Error("IDEOGRAM_4045_LIVE_ARTIFACT_COLLISION"); }
    finally { await existing.close(); }
    return created ? "created" : "existing";
  } finally {
    try { await temporary?.close(); } catch { /* Preserve the primary error. */ }
    try { await unlink(temporaryPath); } catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code;
}
