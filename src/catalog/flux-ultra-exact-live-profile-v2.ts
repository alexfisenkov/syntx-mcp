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

const PARENT_VERSION = "sha256-28ec639226f6397c5848072a1b9ce98f3a9bf9e4faee51688d8921ba262dd5bb.json";
const PARENT_SHA256 = "sha256:b23d5cdbf1ae6ec633e64476213ea241db1ea3a10025e6aa8d62504f8f56fe28";
const PROOF_SOURCE_REGISTRY_VERSION = "sha256-99a0dbcee376ef2184329762ea26a27519a9457f07e8b7878bffbd7bd77c341d.json";
const PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const PUBLIC_CATALOG_SHA256 = "sha256:e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989";
const PUBLIC_MODELS_SHA256 = "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444";
const SOURCE_CLI_SHA256 = "sha256:b3d9973728bd0bb5738fefc5f38e4b86a8faf4f68eb7ae510dac79692cc796b1";
const SOURCE_CLI_REFERENCE = ".autopilot/2026-10-08-syntx-completion--wip/historical-source/sha256-b3d9973728bd0bb5738fefc5f38e4b86a8faf4f68eb7ae510dac79692cc796b1.mjs";
const PRO_INTENT_SHA256 = "sha256:5a73b5165eaad44b912627c90e7990a79896334014bbe704e175bc95cef9c683";
const PRO_PROOF_SHA256 = "sha256:e53d72f04947835b336c1272f8e938b763abe1e0e484c60c7950fb1ec0d3458a";
const ULTRA_INTENT_SHA256 = "sha256:7e7fa5f4b14ebc46d21c5b3cb7371f5d3d41fdfe2d819d8f9a92f57539d57935";
const ULTRA_PROOF_SHA256 = "sha256:6992fe5397d03f97c1b7a862fd502f8de8c4ec36f6ad0ff8177e76d8e3619b4b";
const SEMANTIC_SUMMARY_SHA256 = "sha256:41b0555b4d292a9035918d5525e48928ca5a1dce7d54453f6da3f129edb4e0e0";
const EVIDENCE_PREFIX = "catalog/runtime/v33/sha256-";
const SOURCE_VARIANT_ID = "flux-pro-1-1-ultra-explicit-no-lora-reviewed";
const LIVE_VARIANT_ID = "flux-pro-1-1-ultra-2048-square-no-lora-live";
const MODEL_ID = "flux-pro-1.1-ultra";
const SOURCE_SCHEMA_HASH = "sha256:1f08f74c6110fa9a087a54c1249b52ba719bb9e9f0d51520bf5308ef76d12fbf";
const FIXED_SETTINGS = Object.freeze({ civitai_loras: Object.freeze([]), file_urls: Object.freeze([]), n: 1, raw: false,
  cfg: 3.5, image_strength: 0.5, resolution: "2048x2048", steps: 28, workflow_type: "default" });

export interface ValidateFluxUltraLiveProofsInput {
  readonly proIntentBytes: Uint8Array;
  readonly proProofBytes: Uint8Array;
  readonly ultraIntentBytes: Uint8Array;
  readonly ultraProofBytes: Uint8Array;
  readonly probeCliBytes: Uint8Array;
}

const intentSchema = z.object({
  schema_version: z.literal("ROOT_FLUX_OWNER_PROBE_INTENT_V1"),
  case_id: z.string(), model_id: z.string(), operation_id: z.literal("generate-image"), variant_id: z.string(),
  registry_version: z.literal(PROOF_SOURCE_REGISTRY_VERSION), schema_hash: z.string(), source_commit: z.literal("3b97b95"),
  source_sha256: z.literal(SOURCE_CLI_SHA256.slice(7)), prompt_sha256: z.string(), normalized_request_fingerprint: z.string(),
  wire_settings: z.record(z.string(), z.unknown()), transport: z.literal("ACTUAL_SDK_ISOLATED_SOURCE_PROBE_MCP_NOT_ORDINARY_LIVE_TOOL"),
  max_probe_invocations: z.literal(1), max_bot_login_messages: z.literal(1), mutation_retries: z.literal(0),
  preflight: z.literal("FRESH_ACCOUNT_SUBSCRIPTION_MODEL_ACCESS_COST_AND_SCHEMA"),
  owner_authorization: z.literal("STANDING_EXPLICIT_OWNER_AUTH_AND_GENERATION_TEST_PERMISSION_FOR_ACTIVE_GOAL"),
  output_policy: z.literal("ONE_ACTUAL_JPEG_OR_PNG_FROM_EXACT_CONTRACT_PAIR_NOT_PROVIDER_PROMISE"),
  requested_resolution: z.string(), ratio_status: z.literal("NOT_REQUESTED; UI label4:3 is not exact1152:896 pixel ratio")
    .or(z.literal("NOT_REQUESTED; observe actual pixel geometry separately")),
  unknown: z.literal("SAME_PARENT_KNOWN_GET_ONLY_RECOVERY_OR_FINISH_NO_POST"),
  old_paid_canary_or_unknown_replay: z.literal(false), native_ui_default_or_other_flux_tuple_transfer: z.literal(false),
  purchase_renewal_global_config_public_post_push_deploy: z.literal(false), state: z.literal("RECORDED_BEFORE_AUTH_OR_GENERATION")
}).passthrough();

const geometrySchema = z.object({ status: z.literal("OBSERVED"), requested_resolution: z.string(), mime: z.string(),
  declared_mime: z.string(), response_mime_type: z.string(), byte_size: z.number(), width: z.number(), height: z.number(),
  sha256: z.string(), ratio_status: z.literal("NOT_REQUESTED"), sdk_metadata: z.record(z.string(), z.unknown()) }).passthrough();

const proofEventSchema = z.object({ event: z.string(), at: z.string(), status: z.string().optional(), model_id: z.string().optional(),
  operation_id: z.string().optional(), variant_id: z.string().optional(), registry_version: z.string().optional(), schema_hash: z.string().optional(),
  normalized_request_fingerprint: z.string().optional(), artifact_count: z.number().optional(), mime_types: z.array(z.string()).optional(),
  safe_artifact_summary_sha256: z.string().optional(), probe_call_count: z.number().optional(), image_geometry_observation: geometrySchema.optional(),
  local_unlink_status: z.string().optional(), cleanup_contract_status: z.string().optional() }).passthrough();

const proofSchema = z.object({
  schema_version: z.literal("ROOT_FLUX_OWNER_PROBE_PROOF_V1"), status: z.string(), intent: z.string(),
  source_commit: z.literal("3b97b95"), source_sha256: z.literal(SOURCE_CLI_SHA256.slice(7)),
  started_at: z.string(), tg_receipt_ack_at: z.string(), finish_sent_at: z.string(), ended_at: z.string(),
  events: z.array(proofEventSchema), tg_receipts: z.literal(1), mutation_retries: z.literal(0), recovery_calls: z.literal(0),
  parent_exit_code: z.literal(0), parent_exit_signal: z.null(), private_handoff_cleared: z.literal(true),
  all_prior_parents_ended: z.literal(true), requested_resolution: z.string(), observed_resolution: z.string(),
  requested_resolution_fulfilled: z.boolean(), registry_promotion: z.literal(false),
  in_memory_sdk_close_called_in_finally: z.literal(true), independent_sdk_close_receipt: z.literal("NOT_EXPOSED"),
  limits: z.array(z.string()), secrets_credentials_private_ids_urls_prompts_media_bytes_persisted: z.literal(false)
}).passthrough();

const CASES = [
  { case_id: "flux-pro-no-lora-landscape", model_id: "flux-pro-1.1", source_variant_id: "flux-pro-1-1-explicit-no-lora-reviewed",
    schema_hash: "sha256:6cf96aad7eac9c1430bcda1b0907c1ed0b7b3965bfe1cb1c7ad6937251b98935",
    prompt_sha256: "sha256:8eb7968cbfb0f48fd9941f40b1000f9156bf69675cb0d56fb60aaa6a157e338a",
    request_fingerprint: "sha256:196c581c61461989d19ce147cdaa8f4c684b12e4a7e17344dac143ff443f8dc1",
    intent_hash: PRO_INTENT_SHA256, proof_hash: PRO_PROOF_SHA256,
    requested_resolution: "1152x896", observed_resolution: "1024x768", fulfilled: false,
    bytes: 217_220, width: 1024, height: 768,
    byte_sha256: "sha256:3b9af451ac270c8f51eb909f7a7a61a6a87414d53f343c32581add27d9d951ed",
    prompt_status: "RESULT_OBSERVED_REQUESTED_RESOLUTION_MISMATCH_NOT_PROMOTED" },
  { case_id: "flux-pro-ultra-no-lora-square", model_id: "flux-pro-1.1-ultra", source_variant_id: "flux-pro-1-1-ultra-explicit-no-lora-reviewed",
    schema_hash: "sha256:1f08f74c6110fa9a087a54c1249b52ba719bb9e9f0d51520bf5308ef76d12fbf",
    prompt_sha256: "sha256:36df7b633ee20e3a414d99892ad97a949c9be5e0c1a07dd512352c3059939425",
    request_fingerprint: "sha256:9ce7e7bbdaf2c08932b078541542d8905bbb556ee14e9524dc318cc76b28e301",
    intent_hash: ULTRA_INTENT_SHA256, proof_hash: ULTRA_PROOF_SHA256,
    requested_resolution: "2048x2048", observed_resolution: "2048x2048", fulfilled: true,
    bytes: 621_299, width: 2048, height: 2048,
    byte_sha256: "sha256:897f05ceee3cb4924ade54989b366b24a4515f5a3f268b8ef6ed8794b1561f5e",
    prompt_status: "PASS_EXACT_RESULT_ONLY" }
] as const;

export interface FluxUltraLiveObservation {
  readonly case_id: typeof CASES[number]["case_id"];
  readonly model_id: typeof CASES[number]["model_id"];
  readonly source_variant_id: typeof CASES[number]["source_variant_id"];
  readonly schema_hash: string;
  readonly prompt_sha256: string;
  readonly request_fingerprint: string;
  readonly requested_resolution: string;
  readonly observed_resolution_fulfilled: boolean;
  readonly actual_dimensions: { readonly width: number; readonly height: number };
  readonly actual_byte_size: number;
  readonly actual_byte_sha256: string;
  readonly mime: "image/jpeg";
  readonly ratio_status: "NOT_REQUESTED";
  readonly semantic_artifact_metadata_summary_sha256: string;
  readonly probe_calls: 1;
  readonly tg_receipts: 1;
  readonly retries: 0;
  readonly recovery_calls: 0;
  readonly local_unlink_status: "REVOKED_READBACK_CONFIRMED";
  readonly parent_exit_code: 0;
  readonly private_handoff_cleared: true;
  readonly promote: boolean;
  readonly terminal_observed_at: string;
}

export interface FluxUltraLiveProofValidationResult {
  readonly source_cli_sha256: typeof SOURCE_CLI_SHA256;
  readonly observations: readonly [FluxUltraLiveObservation, FluxUltraLiveObservation];
}

export interface BuildFluxUltraExactLiveProfileV2Input extends ValidateFluxUltraLiveProofsInput {
  readonly currentRegistry: GenerationContractRegistryV2;
  readonly publicCatalog: GenerationContractCatalogPort;
  readonly reviewedAt: string;
}

export interface FluxUltraExactLiveProfileV2BuildResult {
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly evidence_json: string;
  readonly evidence_reference: string;
  readonly evidence_sha256: string;
  readonly registry: GenerationContractRegistryV2;
  readonly added_variant_id: typeof LIVE_VARIANT_ID;
}

export function buildFluxUltraExactLiveProfileV2(input: BuildFluxUltraExactLiveProfileV2Input): FluxUltraExactLiveProfileV2BuildResult {
  const validation = validateFluxUltraLiveProofs(input);
  const parent = generationContractRegistryV2Schema.parse(input.currentRegistry);
  if (parent.registry_sha256 !== PARENT_SHA256 || parent.catalog_version !== "2026-10-08T13:18:39.393Z.36e6960df354" ||
      parent.contracts.length !== 52 || count(parent, "live_verified") !== 13 || count(parent, "reviewed") !== 39 ||
      parent.contracts.some((entry) => entry.variant_id === LIVE_VARIANT_ID)) throw new Error("FLUX_ULTRA_LIVE_PARENT_MISMATCH");
  const source = parent.contracts.find((entry) => entry.variant_id === SOURCE_VARIANT_ID);
  if (!source || source.status !== "reviewed" || source.model_id !== MODEL_ID || source.ai_name !== "flux" ||
      source.model_type !== MODEL_ID || source.operation_id !== "generate-image" || source.schema_hash !== SOURCE_SCHEMA_HASH ||
      source.output.mime_types.length !== 2 || !source.output.mime_types.includes("image/jpeg") || !source.output.mime_types.includes("image/png")) {
    throw new Error("FLUX_ULTRA_LIVE_SOURCE_CONTRACT_MISMATCH");
  }
  let model;
  try { model = input.publicCatalog.getModel(MODEL_ID); }
  catch { throw new Error("FLUX_ULTRA_LIVE_PUBLIC_MODEL_BINDING_INVALID"); }
  const publicCatalogVersion = `${model.fetched_at}.${model.source_hashes.models.slice(7, 19)}`;
  if (model.id !== MODEL_ID || model.upstream_id !== MODEL_ID || model.ai_name !== "flux" || model.active !== true ||
      !model.operations.some((operation) => operation.id === "generate-image" && operation.output_modality === "image") ||
      publicCatalogVersion !== parent.catalog_version || model.source_hashes.ai !== parent.source_hashes.ai ||
      model.source_hashes.llm_models !== parent.source_hashes.llm_models || model.source_hashes.models !== PUBLIC_MODELS_SHA256 ||
      model.source_hashes.models !== parent.source_hashes.models) throw new Error("FLUX_ULTRA_LIVE_PUBLIC_MODEL_BINDING_INVALID");
  const ultra = validation.observations[1]!;
  if (!ultra.promote || !Number.isFinite(Date.parse(input.reviewedAt)) || Date.parse(input.reviewedAt) < Date.parse(ultra.terminal_observed_at)) {
    throw new Error("FLUX_ULTRA_LIVE_REVIEW_TIME_INVALID");
  }

  const evidenceBase = {
    schema_version: "1.0.0", artifact_kind: "ROOT_FLUX_ULTRA_EXACT_LIVE_PROFILE_V1",
    evidence_level: "ONE_EXACT_ISOLATED_SOURCE_PROBE_RESULT; PRO_RESOLUTION_MISMATCH_RETAINED_NOT_PROMOTED",
    ordinary_promoted_runtime_usable: false, parent_registry_version: PARENT_VERSION, parent_registry_sha256: PARENT_SHA256,
    proof_source_registry_version: PROOF_SOURCE_REGISTRY_VERSION,
    public_catalog_version: PUBLIC_VERSION, public_catalog_sha256: PUBLIC_CATALOG_SHA256, public_models_source_sha256: PUBLIC_MODELS_SHA256,
    source_reviewed_variant_id: SOURCE_VARIANT_ID, live_profile_variant_id: LIVE_VARIANT_ID,
    source_hashes: { probe_cli: { reference: SOURCE_CLI_REFERENCE, sha256: SOURCE_CLI_SHA256 } },
    observations: validation.observations,
    scope_limits: {
      one_exact_ultra_tuple_only: true, pro_resolution_mismatch_not_promoted: true,
      jpeg_only_observed_result_not_all_model_mimes: true, other_ratios_or_resolutions_claimed: false,
      other_speeds_or_workflows_claimed: false, prompt_content_or_visual_quality_claimed: false,
      full_pixel_decode_claimed: false, provider_defaults_or_billing_claimed: false,
      ordinary_promoted_runtime_or_client_host_acceptance_claimed: false, native_ui_default_claimed: false
    }
  };
  const evidenceJson = `${canonicalJson(evidenceBase)}\n`;
  const evidenceSha = `sha256:${sha256(Buffer.from(evidenceJson, "utf8"))}`;
  const evidenceReference = `${EVIDENCE_PREFIX}${evidenceSha.slice(7)}.json`;
  const retainedReferences = source.provenance.references.filter((reference) =>
    reference.kind === "public_catalog" || reference.kind === "frontend_static" || reference.kind === "manual_review");
  const candidate: GenerationContractV2Input = {
    ...stripSchemaHash(source), variant_id: LIVE_VARIANT_ID, status: "live_verified",
    output: { decoder_profile: "syntx-owner-image-jpeg", mime_types: ["image/jpeg"] },
    provenance: { ...source.provenance, reviewed_at: input.reviewedAt, live_observed_at: ultra.terminal_observed_at,
      references: [...retainedReferences,
        { kind: "live_owner", reference: evidenceReference, sha256: evidenceSha },
        { kind: "manual_review", reference: "One exact isolated Ultra JPEG result only: 2048x2048, cfg3.5, steps28, strength0.5, workflow default, raw false, no LoRAs/references; not ordinary runtime or UI default proof." }
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
  if (!preserved || registry.contracts.length !== 53 || count(registry, "live_verified") !== 14 || count(registry, "reviewed") !== 39 ||
      live?.status !== "live_verified" || live.model_id !== MODEL_ID || canonicalJson(live.output.mime_types) !== canonicalJson(["image/jpeg"]) ||
      canonicalJson(live.wire.fixed_settings) !== canonicalJson(FIXED_SETTINGS) ||
      canonicalJson(live.wire.settings_fields) !== canonicalJson({}) || live.parameters.required.join(",") !== "prompt") {
    throw new Error("FLUX_ULTRA_LIVE_REGISTRY_INVARIANT_FAILED");
  }
  return Object.freeze({ evidence: Object.freeze({ ...evidenceBase, evidence_sha256: evidenceSha }), evidence_json: evidenceJson,
    evidence_reference: evidenceReference, evidence_sha256: evidenceSha, registry, added_variant_id: LIVE_VARIANT_ID });
}

export async function archiveFluxUltraExactLiveProfileV2(built: FluxUltraExactLiveProfileV2BuildResult, catalogDirectory?: string): Promise<{
  readonly evidence_status: "created" | "existing"; readonly evidence_reference: string;
  readonly registry_status: "created" | "existing"; readonly registry_version: string
}> {
  const root = resolve(catalogDirectory ?? join(process.cwd(), "catalog"));
  const evidenceBytes = Buffer.from(built.evidence_json, "utf8");
  if (`sha256:${sha256(evidenceBytes)}` !== built.evidence_sha256 || `${EVIDENCE_PREFIX}${built.evidence_sha256.slice(7)}.json` !== built.evidence_reference ||
      built.evidence.evidence_sha256 !== built.evidence_sha256 || built.added_variant_id !== LIVE_VARIANT_ID ||
      !built.registry.contracts.some((entry) => entry.variant_id === LIVE_VARIANT_ID && entry.status === "live_verified" &&
        entry.provenance.references.some((reference) => reference.kind === "live_owner" && reference.reference === built.evidence_reference && reference.sha256 === built.evidence_sha256))) {
    throw new Error("FLUX_ULTRA_LIVE_ARCHIVE_BINDING_INVALID");
  }
  const evidenceStatus = await createOnce(join(root, built.evidence_reference.slice("catalog/".length)), evidenceBytes);
  const archived = await archiveGenerationContractRegistryV2(generationContractRegistryV2Schema.parse(built.registry), root);
  return Object.freeze({ evidence_status: evidenceStatus, evidence_reference: built.evidence_reference,
    registry_status: archived.status, registry_version: archived.version });
}

export function validateFluxUltraLiveProofs(input: ValidateFluxUltraLiveProofsInput): FluxUltraLiveProofValidationResult {
  const proIntentBytes = Buffer.from(input.proIntentBytes); const proProofBytes = Buffer.from(input.proProofBytes);
  const ultraIntentBytes = Buffer.from(input.ultraIntentBytes); const ultraProofBytes = Buffer.from(input.ultraProofBytes);
  if (`sha256:${sha256(input.probeCliBytes)}` !== SOURCE_CLI_SHA256) throw new Error("FLUX_ULTRA_SOURCE_HASH_INVALID");
  if (`sha256:${sha256(proIntentBytes)}` !== CASES[0].intent_hash || `sha256:${sha256(proProofBytes)}` !== CASES[0].proof_hash) {
    throw new Error("FLUX_ULTRA_PROOF_HASH_INVALID");
  }
  if (`sha256:${sha256(ultraIntentBytes)}` !== CASES[1].intent_hash || `sha256:${sha256(ultraProofBytes)}` !== CASES[1].proof_hash) {
    throw new Error("FLUX_ULTRA_PROOF_HASH_INVALID");
  }
  let intents: z.infer<typeof intentSchema>[]; let proofs: z.infer<typeof proofSchema>[];
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    intents = [intentSchema.parse(JSON.parse(decoder.decode(proIntentBytes))), intentSchema.parse(JSON.parse(decoder.decode(ultraIntentBytes)))];
    proofs = [proofSchema.parse(JSON.parse(decoder.decode(proProofBytes))), proofSchema.parse(JSON.parse(decoder.decode(ultraProofBytes)))];
  } catch { throw new Error("FLUX_ULTRA_PROOF_INVALID"); }
  const observations = CASES.map((expected, index) => validateOne(intents[index]!, proofs[index]!, expected));
  return Object.freeze({ source_cli_sha256: SOURCE_CLI_SHA256, observations: Object.freeze(observations) as unknown as readonly [FluxUltraLiveObservation, FluxUltraLiveObservation] });
}

function validateOne(intent: z.infer<typeof intentSchema>, proof: z.infer<typeof proofSchema>, expected: typeof CASES[number]): FluxUltraLiveObservation {
  const terminal = proof.events.find((event) => event.event === "TERMINAL_RESULT");
  const final = proof.events.find((event) => event.event === "FINAL");
  const actual = terminal?.image_geometry_observation;
  const expectedSettings = expected.model_id === "flux-pro-1.1"
    ? { civitai_loras: [], file_urls: [], n: 1, cfg: 3.5, image_strength: 0.5, resolution: "1152x896", steps: 28,
      workflow_type: "default", model_type: "flux-pro-1.1" }
    : { civitai_loras: [], file_urls: [], n: 1, raw: false, cfg: 3.5, image_strength: 0.5, resolution: "2048x2048", steps: 28,
      workflow_type: "default", model_type: "flux-pro-1.1-ultra" };
  if (intent.case_id !== expected.case_id || intent.model_id !== expected.model_id || intent.operation_id !== "generate-image" ||
      intent.variant_id !== expected.source_variant_id || intent.schema_hash !== expected.schema_hash ||
      intent.registry_version !== PROOF_SOURCE_REGISTRY_VERSION || intent.source_commit !== "3b97b95" || intent.source_sha256 !== SOURCE_CLI_SHA256.slice(7) ||
      intent.prompt_sha256 !== expected.prompt_sha256 || intent.normalized_request_fingerprint !== expected.request_fingerprint ||
      canonicalJson(intent.wire_settings) !== canonicalJson(expectedSettings) || intent.requested_resolution !== expected.requested_resolution ||
      intent.ratio_status !== (expected.model_id === "flux-pro-1.1" ? "NOT_REQUESTED; UI label4:3 is not exact1152:896 pixel ratio" : "NOT_REQUESTED; observe actual pixel geometry separately") ||
      intent.transport !== "ACTUAL_SDK_ISOLATED_SOURCE_PROBE_MCP_NOT_ORDINARY_LIVE_TOOL" || intent.max_probe_invocations !== 1 ||
      intent.max_bot_login_messages !== 1 || intent.mutation_retries !== 0 || intent.old_paid_canary_or_unknown_replay !== false ||
      intent.native_ui_default_or_other_flux_tuple_transfer !== false || intent.purchase_renewal_global_config_public_post_push_deploy !== false ||
      intent.state !== "RECORDED_BEFORE_AUTH_OR_GENERATION" || proof.source_commit !== "3b97b95" ||
      proof.source_sha256 !== SOURCE_CLI_SHA256.slice(7) || proof.registry_promotion !== false || proof.requested_resolution !== expected.requested_resolution ||
      proof.observed_resolution !== expected.observed_resolution || proof.requested_resolution_fulfilled !== expected.fulfilled ||
      proof.status !== expected.prompt_status || proof.events.map((event) => event.event).join(",") !== "BEGIN,TERMINAL_RESULT,FINAL" ||
      terminal?.status !== "PASS_EXACT_RESULT_ONLY" || terminal.model_id !== expected.model_id || terminal.operation_id !== "generate-image" ||
      terminal.variant_id !== expected.source_variant_id || terminal.schema_hash !== expected.schema_hash ||
      terminal.normalized_request_fingerprint !== expected.request_fingerprint || terminal.artifact_count !== 1 ||
      canonicalJson(terminal.mime_types) !== canonicalJson(["image/jpeg"]) || terminal.probe_call_count !== 1 ||
      terminal.safe_artifact_summary_sha256 !== SEMANTIC_SUMMARY_SHA256 || actual === undefined || actual.status !== "OBSERVED" ||
      actual.requested_resolution !== expected.requested_resolution || actual.ratio_status !== "NOT_REQUESTED" ||
      Object.hasOwn(actual, "requested_ratio") || Object.hasOwn(actual, "ratio_match") || actual.mime !== "image/jpeg" ||
      actual.declared_mime !== "image/jpeg" || actual.response_mime_type !== "image/jpeg" || actual.byte_size !== expected.bytes ||
      actual.width !== expected.width || actual.height !== expected.height || actual.sha256 !== expected.byte_sha256 ||
      final?.status !== "PASS_EXACT_RESULT_ONLY" || final.model_id !== expected.model_id || final.variant_id !== expected.source_variant_id ||
      final.probe_call_count !== 1 || final.local_unlink_status !== "REVOKED_READBACK_CONFIRMED" || final.cleanup_contract_status !== "reviewed" ||
      proof.tg_receipts !== 1 || proof.mutation_retries !== 0 || proof.recovery_calls !== 0 || proof.parent_exit_code !== 0 ||
      proof.parent_exit_signal !== null || proof.private_handoff_cleared !== true || proof.all_prior_parents_ended !== true ||
      proof.in_memory_sdk_close_called_in_finally !== true || proof.independent_sdk_close_receipt !== "NOT_EXPOSED" ||
      proof.secrets_credentials_private_ids_urls_prompts_media_bytes_persisted !== false) {
    throw new Error("FLUX_ULTRA_PROOF_BINDING_INVALID");
  }
  const sequence = [proof.started_at, proof.events[0]!.at, proof.tg_receipt_ack_at, terminal.at, proof.finish_sent_at,
    final.at, proof.ended_at].map((value) => Date.parse(value));
  if (sequence.some((time) => !Number.isFinite(time)) || sequence.some((time, index) => index > 0 && time < sequence[index - 1]!)) {
    throw new Error("FLUX_ULTRA_PROOF_TIMELINE_INVALID");
  }
  const limitsText = proof.limits.join("\n");
  if (!limitsText.includes("ordinary runtime/client hosts not proven") || !limitsText.includes("UI defaults/effective cached state") ||
      !limitsText.includes("Semantic artifact summary hash is not media byte hash")) throw new Error("FLUX_ULTRA_PROOF_LIMITS_INVALID");

  return Object.freeze({ case_id: expected.case_id, model_id: expected.model_id, source_variant_id: expected.source_variant_id,
    schema_hash: expected.schema_hash, prompt_sha256: expected.prompt_sha256, request_fingerprint: expected.request_fingerprint,
    requested_resolution: expected.requested_resolution, observed_resolution_fulfilled: expected.fulfilled,
    actual_dimensions: Object.freeze({ width: actual.width, height: actual.height }), actual_byte_size: actual.byte_size,
    actual_byte_sha256: actual.sha256, mime: "image/jpeg", ratio_status: "NOT_REQUESTED",
    semantic_artifact_metadata_summary_sha256: terminal.safe_artifact_summary_sha256!, probe_calls: 1, tg_receipts: 1,
    retries: 0, recovery_calls: 0, local_unlink_status: "REVOKED_READBACK_CONFIRMED", parent_exit_code: 0,
    private_handoff_cleared: true, promote: expected.model_id === "flux-pro-1.1-ultra" && expected.fulfilled,
    terminal_observed_at: terminal.at });
}

function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

function stripSchemaHash(contract: GenerationContractRegistryV2["contracts"][number]): GenerationContractV2Input {
  const { schema_hash: _schemaHash, ...withoutHash } = contract;
  return withoutHash;
}
function count(registry: Pick<GenerationContractRegistryV2, "contracts">, status: "live_verified" | "reviewed"): number {
  return registry.contracts.filter((entry) => entry.status === status).length;
}
function hasCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code;
}

async function createOnce(path: string, bytes: Buffer): Promise<"created" | "existing"> {
  const directory = dirname(path);
  for (const pathPart of [dirname(directory), directory]) {
    try { await mkdir(pathPart, { mode: 0o755 }); }
    catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
    const stat = lstatSync(pathPart);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("FLUX_ULTRA_LIVE_ARTIFACT_PATH_INVALID");
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
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("FLUX_ULTRA_LIVE_ARTIFACT_PATH_INVALID");
    const existing = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try { if (!(await existing.readFile()).equals(bytes)) throw new Error("FLUX_ULTRA_LIVE_ARTIFACT_COLLISION"); }
    finally { await existing.close(); }
    return created ? "created" : "existing";
  } finally {
    try { await temporary?.close(); } catch { /* Preserve the primary error. */ }
    try { await unlink(temporaryPath); } catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
  }
}
