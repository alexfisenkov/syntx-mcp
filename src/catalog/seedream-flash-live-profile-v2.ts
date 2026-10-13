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

const PARENT_VERSION = "sha256-7243f7184ce583f0841007eb5a9f1b118b7c613e8bbad57d3f35f326d8d75d9d.json";
const PARENT_SHA256 = "sha256:84e5a41e5c3ed74a4574483c08793ebd92b516fe65bbfb4a43ffd2b1ce8bb1ac";
const CATALOG_VERSION = "2026-10-08T13:18:39.393Z.36e6960df354";
const PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const PUBLIC_CATALOG_SHA256 = "sha256:e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989";
const PUBLIC_MODELS_SOURCE_SHA256 = "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444";
const SOURCE_SETTINGS_SHA256 = "sha256:3e762f2725970438f392c18f1d4153e93d4aee1165597e28207a8853a0a5b1d1";
const PROBE_CLI_SHA256 = "sha256:9789a27123eefaa8d90fd6c029da9b46f5314a07155336299edd0629a573db51";
const PROBE_CLI_REFERENCE = ".autopilot/2026-10-08-syntx-completion--wip/historical-source/sha256-9789a27123eefaa8d90fd6c029da9b46f5314a07155336299edd0629a573db51.mjs";
const INTENT_REFERENCE = ".autopilot/2026-10-08-syntx-completion--wip/root-182-flash-intent.json";
const PROOF_REFERENCE = ".autopilot/2026-10-08-syntx-completion--wip/root-182-flash-proof.json";
const INTENT_SHA256 = "sha256:961e8b8fa3874c3057e7fce4667b8db36127445037e7b994cd423273290e2ef8";
const PROOF_SHA256 = "sha256:6ca5ca3abe2bc74f0373d186e8033100b46f5a25194d69bc4fc8da8a73bcab42";
const EVIDENCE_PREFIX = "catalog/runtime/v32/sha256-";
const MODEL_ID = "seedream-5.0-flash";
const SOURCE_VARIANT_ID = "seedream-5-0-flash-generate-source-reviewed";
const LIVE_VARIANT_ID = "seedream-5-0-flash-generate-jpeg-square-1k-live";
const CASE_ID = "seedream-flash-source-jpeg-square";
const SOURCE_SCHEMA_HASH = "sha256:a2aaf9647b6213111fec3e5f8c4f7370e4b8619969fe76b68678e1713d20c921";
const REQUEST_FINGERPRINT = "sha256:e546399fdb726f6ab2f104aa62c1557536b80e08513b72f225af2c3491661379";
const PROMPT_FINGERPRINT = "sha256:323024fc19e7ffc15aa507a408611e444098f9749875d4d949d2b268801b6150";
const IMAGE_BYTES_SHA256 = "sha256:077430060a3e3c6bccbd33d5e60cfccf456f24fbae0ff67822edf55206f941c2";
const IMAGE_BYTE_SIZE = 324_481;
const SEMANTIC_ARTIFACT_SUMMARY_SHA256 = "sha256:41b0555b4d292a9035918d5525e48928ca5a1dce7d54453f6da3f129edb4e0e0";
const LIVE_OBSERVED_AT = "2026-10-09T13:10:17.935Z";
const FIXED_SETTINGS = Object.freeze({ background: "opaque", file_urls: Object.freeze([]), n: 1, stream: false,
  aspect_ratio: "1:1", output_format: "jpeg", resolution: "1K" });

export interface BuildSeedreamFlashLiveProfileV2Input {
  readonly currentRegistry: GenerationContractRegistryV2;
  readonly publicCatalog: GenerationContractCatalogPort;
  readonly rootIntentBytes: Uint8Array;
  readonly rootProofBytes: Uint8Array;
  readonly probeCliBytes: Uint8Array;
  readonly reviewedAt: string;
}

export interface SeedreamFlashLiveProfileV2BuildResult {
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly evidence_json: string;
  readonly evidence_reference: string;
  readonly evidence_sha256: string;
  readonly registry: GenerationContractRegistryV2;
  readonly added_variant_id: typeof LIVE_VARIANT_ID;
}

const intentSchema = z.object({
  schema_version: z.literal("ROOT_FLASH_OWNER_PROBE_INTENT_V1"), case_id: z.literal(CASE_ID),
  model_id: z.literal(MODEL_ID), operation_id: z.literal("generate-image"), variant_id: z.literal(SOURCE_VARIANT_ID),
  registry_version: z.literal(PARENT_VERSION), schema_hash: z.literal(SOURCE_SCHEMA_HASH),
  source_commit: z.literal("4b6bc6e"), source_sha256: z.literal(PROBE_CLI_SHA256.slice(7)),
  prompt_sha256: z.literal(PROMPT_FINGERPRINT), normalized_request_fingerprint: z.literal(REQUEST_FINGERPRINT),
  wire_settings: z.record(z.string(), z.unknown()), transport: z.literal("ACTUAL_SDK_ISOLATED_SOURCE_PROBE_MCP_NOT_ORDINARY_LIVE_TOOL"),
  max_probe_invocations: z.literal(1), max_bot_login_messages: z.literal(1), mutation_retries: z.literal(0),
  owner_authorization: z.literal("STANDING_EXPLICIT_OWNER_AUTH_AND_GENERATION_TEST_PERMISSION_FOR_ACTIVE_GOAL"),
  preflight: z.literal("FRESH_ACCOUNT_SUBSCRIPTION_MODEL_ACCESS_COST_AND_SCHEMA"),
  output_policy: z.literal("CURRENT_CONTRACT_JPEG_PNG_CLIENT_ALLOWLIST_AND_CASE_REQUIRES_ONE_JPEG_NOT_PROVIDER_PROMISE"),
  unknown: z.literal("SAME_PARENT_KNOWN_GET_ONLY_RECOVERY_OR_FINISH_NO_POST"),
  prior169_170: z.literal("AUTHORITATIVE_ENDED_EXIT0_REVOKED_READBACK_PRIVATE_HANDOFFS_CLEARED"),
  new_purpose_prompt_fingerprint: z.literal(true), old_paid_canary_or_unknown_replay: z.literal(false),
  raw_credentials_private_ids_prompts_urls_media_bytes_persisted: z.literal(false),
  purchase_renewal_global_config_public_post_push_deploy: z.literal(false), state: z.literal("RECORDED_BEFORE_AUTH_OR_GENERATION")
}).passthrough();

const proofSchema = z.object({
  schema_version: z.literal("ROOT_FLASH182_REAL_PROOF_V1"), case_id: z.literal(CASE_ID),
  source_commit: z.literal("4b6bc6e"), source_sha256: z.literal(PROBE_CLI_SHA256.slice(7)),
  transport: z.literal("ACTUAL_SDK_ISOLATED_SOURCE_PROBE_MCP_NOT_ORDINARY_LIVE_TOOL"),
  parent_started_at: z.string(), events: z.array(z.object({ event: z.string(), at: z.string() }).passthrough()),
  telegram_sent_at: z.string(), finish_sent_at: z.string(),
  parent_exit: z.object({ code: z.number(), signal: z.unknown(), at: z.string() }).passthrough(),
  final: z.object({ status: z.string(), contract_status: z.string(), confidence_scope: z.string(), model_id: z.string(),
    operation_id: z.string(), variant_id: z.string(), registry_version: z.string(), schema_hash: z.string(),
    operator_parameter_keys: z.array(z.string()), normalized_request_fingerprint: z.string(), artifact_count: z.number(),
    mime_types: z.array(z.string()), safe_artifact_summary_sha256: z.string(), probe_call_count: z.number(),
    image_geometry_observation: z.record(z.string(), z.unknown()), local_unlink_status: z.string(), cleanup_contract_status: z.string() }).passthrough(),
  telegram_send_attempts: z.number(), telegram_receipt_confirmed: z.boolean(), recovery_commands: z.number(), mutation_retries: z.number(),
  prepared_settings: z.record(z.string(), z.unknown()), private_handoff_cleared: z.boolean(), stderr_bytes: z.number(),
  fingerprint_scope: z.literal("CALLER_PREPARED_SETTINGS_AND_PURPOSE_NOT_PROVIDER_ECHO"),
  in_memory_client_server_close_invoked_in_finally: z.boolean(), independent_sdk_close_receipt: z.string(), not_proven: z.array(z.string()),
  old_paid_canary_or_unknown_replay: z.boolean(), raw_private_ids_credentials_urls_media_bytes_saved: z.boolean()
}).passthrough();

export function buildSeedreamFlashLiveProfileV2(input: BuildSeedreamFlashLiveProfileV2Input): SeedreamFlashLiveProfileV2BuildResult {
  const intentBytes = Buffer.from(input.rootIntentBytes);
  const proofBytes = Buffer.from(input.rootProofBytes);
  if (`sha256:${sha256(intentBytes)}` !== INTENT_SHA256) throw new Error("SEEDREAM_FLASH_LIVE_INTENT_HASH_INVALID");
  if (`sha256:${sha256(proofBytes)}` !== PROOF_SHA256) throw new Error("SEEDREAM_FLASH_LIVE_PROOF_HASH_INVALID");
  if (`sha256:${sha256(input.probeCliBytes)}` !== PROBE_CLI_SHA256) throw new Error("SEEDREAM_FLASH_LIVE_SOURCE_HASH_INVALID");
  if (input.reviewedAt !== "2026-10-09T13:20:00.000Z") throw new Error("SEEDREAM_FLASH_LIVE_REVIEW_TIME_INVALID");

  let intent: z.infer<typeof intentSchema>;
  let proof: z.infer<typeof proofSchema>;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    intent = intentSchema.parse(JSON.parse(decoder.decode(intentBytes)));
    proof = proofSchema.parse(JSON.parse(decoder.decode(proofBytes)));
  } catch { throw new Error("SEEDREAM_FLASH_LIVE_PROOF_INVALID"); }

  const parent = generationContractRegistryV2Schema.parse(input.currentRegistry);
  if (parent.registry_sha256 !== PARENT_SHA256 || parent.catalog_version !== CATALOG_VERSION || parent.contracts.length !== 48 ||
      count(parent, "live_verified") !== 12 || count(parent, "reviewed") !== 36 ||
      parent.contracts.some((entry) => entry.variant_id === LIVE_VARIANT_ID)) throw new Error("SEEDREAM_FLASH_LIVE_PARENT_MISMATCH");

  const source = parent.contracts.find((entry) => entry.variant_id === SOURCE_VARIANT_ID);
  if (!source || source.status !== "reviewed" || source.model_id !== MODEL_ID || source.model_type !== MODEL_ID || source.ai_name !== "seedream" ||
      source.operation_id !== "generate-image" || source.schema_hash !== SOURCE_SCHEMA_HASH ||
      source.provenance.settings_source_sha256 !== SOURCE_SETTINGS_SHA256 || source.output.decoder_profile !== "syntx-owner-image-jpeg" ||
      canonicalJson(source.output.mime_types) !== canonicalJson(["image/jpeg", "image/png"]) ||
      canonicalJson(source.wire.fixed_settings) !== canonicalJson({ background: "opaque", file_urls: [], n: 1, stream: false })) {
    throw new Error("SEEDREAM_FLASH_LIVE_SOURCE_CONTRACT_MISMATCH");
  }
  let publicModel;
  try { publicModel = input.publicCatalog.getModel(MODEL_ID); }
  catch { throw new Error("SEEDREAM_FLASH_LIVE_PUBLIC_MODEL_BINDING_INVALID"); }
  if (publicModel.id !== MODEL_ID || publicModel.upstream_id !== MODEL_ID || publicModel.ai_name !== "seedream" || publicModel.active !== true ||
      !publicModel.operations.some((operation) => operation.id === "generate-image" && operation.output_modality === "image") ||
      publicModel.source_hashes.models !== PUBLIC_MODELS_SOURCE_SHA256) throw new Error("SEEDREAM_FLASH_LIVE_PUBLIC_MODEL_BINDING_INVALID");

  validateIntentAndProof(intent, proof);
  if (!Number.isFinite(Date.parse(input.reviewedAt)) || Date.parse(input.reviewedAt) < Date.parse(LIVE_OBSERVED_AT)) {
    throw new Error("SEEDREAM_FLASH_LIVE_REVIEW_TIME_INVALID");
  }

  const evidenceBase = {
    schema_version: "1.0.0", artifact_kind: "ROOT_SEEDREAM_FLASH_EXACT_LIVE_PROFILE_V1",
    evidence_level: "ONE_EXACT_ISOLATED_SOURCE_PROBE_RESULT",
    ordinary_promoted_runtime_usable: false,
    parent_registry_version: PARENT_VERSION, parent_registry_sha256: PARENT_SHA256,
    public_catalog_version: PUBLIC_VERSION, public_catalog_sha256: PUBLIC_CATALOG_SHA256,
    public_models_source_sha256: PUBLIC_MODELS_SOURCE_SHA256,
    source_reviewed_variant_id: SOURCE_VARIANT_ID, live_profile_variant_id: LIVE_VARIANT_ID,
    source_hashes: { probe_cli: { reference: PROBE_CLI_REFERENCE, sha256: PROBE_CLI_SHA256 } },
    observations: [makeObservation(intent, proof)],
    scope_limits: {
      one_exact_flash_tuple_only: true, jpeg_only_profile_does_not_claim_all_model_mimes: true,
      png_or_other_output_claimed: false, other_ratios_or_resolutions_claimed: false,
      transparent_or_reference_or_streaming_modes_claimed: false, prompt_content_or_visual_quality_claimed: false,
      full_pixel_decode_claimed: false, provider_defaults_or_billing_claimed: false,
      ordinary_promoted_runtime_or_client_host_acceptance_claimed: false
    }
  };
  const evidenceJson = `${canonicalJson(evidenceBase)}\n`;
  const evidenceSha = `sha256:${sha256(Buffer.from(evidenceJson, "utf8"))}`;
  const evidenceReference = `${EVIDENCE_PREFIX}${evidenceSha.slice(7)}.json`;

  const references = source.provenance.references.filter((reference) => reference.kind === "public_catalog" ||
    reference.kind === "frontend_static" || reference.kind === "manual_review");
  const candidate: GenerationContractV2Input = {
    ...stripSchemaHash(source), variant_id: LIVE_VARIANT_ID, status: "live_verified",
    output: { ...source.output, mime_types: ["image/jpeg"] },
    provenance: { ...source.provenance, reviewed_at: input.reviewedAt, live_observed_at: LIVE_OBSERVED_AT,
      references: [...references,
        { kind: "live_owner", reference: evidenceReference, sha256: evidenceSha },
        { kind: "manual_review", reference: "One exact Seedream Flash JPEG result only: opaque background, square 1K, one image, no references or streaming; broader output MIME policy is not claimed." }
      ] },
    parameters: { type: "object", additional_properties: false, required: ["prompt"],
      properties: { prompt: { type: "string", min_length: 1 } }, conditions: [], conditional_enums: [] },
    wire: { ...source.wire, settings_fields: {}, fixed_settings: { ...FIXED_SETTINGS } },
    limits: { ...source.limits, max_parameters: 1 }
  };
  const registry = createGenerationContractRegistryV2({ schema_version: "2.0.0", catalog_version: parent.catalog_version,
    source_hashes: parent.source_hashes, contracts: [...parent.contracts.map(stripSchemaHash), candidate] });
  const preserved = parent.contracts.every((old) => canonicalJson(registry.contracts.find((entry) => entry.variant_id === old.variant_id)) === canonicalJson(old));
  const live = registry.contracts.find((entry) => entry.variant_id === LIVE_VARIANT_ID);
  if (!preserved || registry.contracts.length !== 49 || count(registry, "live_verified") !== 13 || count(registry, "reviewed") !== 36 ||
      live?.status !== "live_verified" || live.model_id !== MODEL_ID || canonicalJson(live.output.mime_types) !== canonicalJson(["image/jpeg"]) ||
      canonicalJson(live.wire.fixed_settings) !== canonicalJson(FIXED_SETTINGS) || live.parameters.required.join(",") !== "prompt") {
    throw new Error("SEEDREAM_FLASH_LIVE_REGISTRY_INVARIANT_FAILED");
  }
  return Object.freeze({ evidence: Object.freeze({ ...evidenceBase, evidence_sha256: evidenceSha }), evidence_json: evidenceJson,
    evidence_reference: evidenceReference, evidence_sha256: evidenceSha, registry, added_variant_id: LIVE_VARIANT_ID });
}

export async function archiveSeedreamFlashLiveProfileV2(
  built: SeedreamFlashLiveProfileV2BuildResult,
  catalogDirectory?: string
): Promise<{ readonly evidence_status: "created" | "existing"; readonly evidence_reference: string;
  readonly registry_status: "created" | "existing"; readonly registry_version: string }> {
  const root = resolve(catalogDirectory ?? join(process.cwd(), "catalog"));
  const evidenceBytes = Buffer.from(built.evidence_json, "utf8");
  if (`sha256:${sha256(evidenceBytes)}` !== built.evidence_sha256 || `${EVIDENCE_PREFIX}${built.evidence_sha256.slice(7)}.json` !== built.evidence_reference ||
      built.evidence.evidence_sha256 !== built.evidence_sha256 || built.added_variant_id !== LIVE_VARIANT_ID ||
      !built.registry.contracts.some((entry) => entry.variant_id === LIVE_VARIANT_ID && entry.status === "live_verified" &&
        entry.provenance.references.some((reference) => reference.kind === "live_owner" && reference.reference === built.evidence_reference && reference.sha256 === built.evidence_sha256))) {
    throw new Error("SEEDREAM_FLASH_LIVE_ARCHIVE_BINDING_INVALID");
  }
  const evidenceStatus = await createOnce(join(root, built.evidence_reference.slice("catalog/".length)), evidenceBytes);
  const archived = await archiveGenerationContractRegistryV2(generationContractRegistryV2Schema.parse(built.registry), root);
  return Object.freeze({ evidence_status: evidenceStatus, evidence_reference: built.evidence_reference,
    registry_status: archived.status, registry_version: archived.version });
}

function validateIntentAndProof(intent: z.infer<typeof intentSchema>, proof: z.infer<typeof proofSchema>): void {
  const expectedSettings = { ...FIXED_SETTINGS, model_type: MODEL_ID };
  const geometry = proof.final.image_geometry_observation;
  if (intent.model_id !== proof.final.model_id || intent.operation_id !== proof.final.operation_id ||
      intent.variant_id !== proof.final.variant_id || intent.registry_version !== proof.final.registry_version ||
      intent.schema_hash !== proof.final.schema_hash || proof.final.status !== "PASS_EXACT_RESULT_ONLY" ||
      proof.final.contract_status !== "reviewed" || proof.final.confidence_scope !== "exact_result_only" ||
      proof.final.model_id !== MODEL_ID || proof.final.operation_id !== "generate-image" || proof.final.variant_id !== SOURCE_VARIANT_ID ||
      proof.final.registry_version !== PARENT_VERSION || proof.final.schema_hash !== SOURCE_SCHEMA_HASH ||
      proof.final.operator_parameter_keys.length !== 0 || proof.final.normalized_request_fingerprint !== REQUEST_FINGERPRINT ||
      proof.final.artifact_count !== 1 || canonicalJson(proof.final.mime_types) !== canonicalJson(["image/jpeg"]) ||
      proof.final.safe_artifact_summary_sha256 !== SEMANTIC_ARTIFACT_SUMMARY_SHA256 || proof.final.probe_call_count !== 1 ||
      proof.final.local_unlink_status !== "REVOKED_READBACK_CONFIRMED" || proof.final.cleanup_contract_status !== "reviewed" ||
      canonicalJson(intent.wire_settings) !== canonicalJson(expectedSettings) || canonicalJson(proof.prepared_settings) !== canonicalJson(expectedSettings) ||
      canonicalJson(proof.prepared_settings) !== canonicalJson(intent.wire_settings) ||
      intent.max_probe_invocations !== 1 || intent.max_bot_login_messages !== 1 || intent.mutation_retries !== 0 ||
      proof.telegram_send_attempts !== 1 || !proof.telegram_receipt_confirmed || proof.recovery_commands !== 0 || proof.mutation_retries !== 0 ||
      !proof.private_handoff_cleared || proof.stderr_bytes !== 0 || !proof.in_memory_client_server_close_invoked_in_finally ||
      proof.independent_sdk_close_receipt !== "NOT_EXPOSED" || proof.old_paid_canary_or_unknown_replay ||
      proof.raw_private_ids_credentials_urls_media_bytes_saved || proof.parent_exit.code !== 0 || proof.parent_exit.signal !== null ||
      intent.raw_credentials_private_ids_prompts_urls_media_bytes_persisted || intent.purchase_renewal_global_config_public_post_push_deploy ||
      intent.old_paid_canary_or_unknown_replay || recomputeFingerprint(intent, proof) !== REQUEST_FINGERPRINT ||
      geometry.status !== "OBSERVED" || geometry.mime !== "image/jpeg" || geometry.declared_mime !== "image/jpeg" ||
      geometry.response_mime_type !== "image/jpeg" || geometry.byte_size !== IMAGE_BYTE_SIZE || geometry.width !== 1024 ||
      geometry.height !== 1024 || geometry.sha256 !== IMAGE_BYTES_SHA256 || geometry.requested_ratio !== "1:1" || geometry.ratio_match !== true) {
    throw new Error("SEEDREAM_FLASH_LIVE_PROOF_BINDING_INVALID");
  }
  const times = [proof.parent_started_at, proof.events[0]?.at, proof.telegram_sent_at, proof.events[1]?.at,
    proof.finish_sent_at, proof.events[2]?.at, proof.parent_exit.at].map((value) => Date.parse(value ?? ""));
  if (canonicalJson(proof.events.map((event) => event.event)) !== canonicalJson(["BEGIN", "TERMINAL_RESULT", "FINAL"]) ||
      times.some((time) => !Number.isFinite(time)) || times.some((time, index) => index > 0 && time < times[index - 1]!) ||
      !proof.not_proven.some((value) => value.includes("visual content/quality/fullpixel decode")) ||
      !proof.not_proven.some((value) => value.includes("provider defaults or billing delta/hard cap")) ||
      !proof.not_proven.some((value) => value.includes("ordinary promoted runtime or actual client hosts"))) {
    throw new Error("SEEDREAM_FLASH_LIVE_TIMELINE_INVALID");
  }
}

function recomputeFingerprint(intent: z.infer<typeof intentSchema>, proof: z.infer<typeof proofSchema>): string {
  const value = { registry_version: intent.registry_version, model_id: intent.model_id, operation_id: intent.operation_id,
    variant_id: intent.variant_id, schema_hash: intent.schema_hash, operator_parameter_keys: [],
    normalized_settings: proof.prepared_settings, image_family_case_id: intent.case_id, fixed_prompt_sha256: intent.prompt_sha256 };
  return `sha256:${sha256(Buffer.from(canonicalJson(value), "utf8"))}`;
}

function makeObservation(intent: z.infer<typeof intentSchema>, proof: z.infer<typeof proofSchema>) {
  const geometry = proof.final.image_geometry_observation;
  return Object.freeze({ case_id: CASE_ID, model_id: MODEL_ID, operation_id: "generate-image",
    source_reviewed_variant_id: SOURCE_VARIANT_ID, promoted_live_variant_id: LIVE_VARIANT_ID,
    source_registry_version: PARENT_VERSION, source_contract_schema_hash: SOURCE_SCHEMA_HASH,
    source_request_fingerprint: REQUEST_FINGERPRINT, purpose_prompt_sha256: PROMPT_FINGERPRINT,
    root_intent_reference: INTENT_REFERENCE, root_intent_sha256: INTENT_SHA256,
    root_proof_reference: PROOF_REFERENCE, root_proof_sha256: PROOF_SHA256,
    source_probe_cli_sha256: PROBE_CLI_SHA256, source_settings_sha256: SOURCE_SETTINGS_SHA256,
    observed_image_bytes: Object.freeze({ status: "OBSERVED", mime: geometry.mime, declared_mime: geometry.declared_mime,
      response_mime_type: geometry.response_mime_type, byte_size: geometry.byte_size, width: geometry.width,
      height: geometry.height, sha256: geometry.sha256, requested_ratio: geometry.requested_ratio, ratio_match: geometry.ratio_match }),
    semantic_artifact_metadata_summary_sha256: proof.final.safe_artifact_summary_sha256,
    prepared_settings: proof.prepared_settings, telegram_receipt_confirmed: proof.telegram_receipt_confirmed,
    probe_call_count: proof.final.probe_call_count, mutation_retries: proof.mutation_retries,
    recovery_commands: proof.recovery_commands, local_unlink_status: proof.final.local_unlink_status,
    parent_exit_code: proof.parent_exit.code, private_handoff_cleared: proof.private_handoff_cleared,
    live_observed_at: proof.events[1]!.at, probe_transport: proof.transport,
    fingerprint_scope: proof.fingerprint_scope, ordinary_promoted_runtime_accepted: false,
    output_byte_sha_is_distinct_from_semantic_metadata_sha: true, intent_state_before_auth: intent.state });
}

function stripSchemaHash(contract: GenerationContractRegistryV2["contracts"][number]): GenerationContractV2Input {
  const { schema_hash: _schemaHash, ...withoutHash } = contract;
  return withoutHash;
}
function count(registry: Pick<GenerationContractRegistryV2, "contracts">, status: "live_verified" | "reviewed"): number {
  return registry.contracts.filter((entry) => entry.status === status).length;
}
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function hasCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code;
}

async function createOnce(path: string, bytes: Buffer): Promise<"created" | "existing"> {
  const directory = dirname(path);
  for (const pathPart of [dirname(directory), directory]) {
    try { await mkdir(pathPart, { mode: 0o755 }); }
    catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
    const stat = lstatSync(pathPart);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("SEEDREAM_FLASH_LIVE_ARTIFACT_PATH_INVALID");
  }
  const temporaryPath = join(directory, `.pending-${randomUUID()}.tmp`);
  let temporary;
  try {
    temporary = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    await temporary.writeFile(bytes); await temporary.sync(); await temporary.close(); temporary = undefined;
    let created = false;
    try { await link(temporaryPath, path); created = true; }
    catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("SEEDREAM_FLASH_LIVE_ARTIFACT_PATH_INVALID");
    const existing = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try { if (!(await existing.readFile()).equals(bytes)) throw new Error("SEEDREAM_FLASH_LIVE_ARTIFACT_COLLISION"); }
    finally { await existing.close(); }
    return created ? "created" : "existing";
  } finally {
    try { await temporary?.close(); } catch { /* Preserve the primary error. */ }
    try { await unlink(temporaryPath); } catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
  }
}
