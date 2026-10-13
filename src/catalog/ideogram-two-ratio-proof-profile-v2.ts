import { createHash, randomUUID } from "node:crypto";
import { constants, lstatSync } from "node:fs";
import { link, mkdir, open, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod/v4";
import { archiveGenerationContractRegistryV2 } from "./generation-contract-history-v2.js";
import { canonicalJson } from "../domain/generation-contract.js";
import {
  createGenerationContractRegistryV2,
  generationContractRegistryV2Schema,
  type GenerationContractRegistryV2,
  type GenerationContractV2Input
} from "../domain/generation-contract-v2.js";

const PARENT_VERSION = "sha256-a4d42d4b977836face88a757a5632cc6096997b37e3749b7a31a80cb24cdfa2e.json";
const PARENT_SHA256 = "sha256:502c2d30adcf0c17a698256466d4d4895e622c3382751d8904cb8e94dae19a49";
const PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const ROOT93_SHA256 = "sha256:fef4de4914a49da73a59480822936e47e64fabf93a730e35c581b3f7c5546832";
const ROOT113_SHA256 = "sha256:8d952fbea50176ff629052b05b2d230beaf74334709c0509bbc7efe2d09c5366";
const ROOT93_REFERENCE = ".autopilot/2026-10-08-syntx-completion--wip/root-93-three-image-family-proof.json";
const ROOT113_REFERENCE = ".autopilot/2026-10-08-syntx-completion--wip/root-113-ideogram-landscape-proof.json";
const ROOT93_PROBE_SHA = "19450bfac63f353113176b9c8ec0ff4374f76b23e0a0e9fc401d88d27df8019a";
const ROOT113_PROBE_SHA = "83107218aa4d1ceb266d8bb79226fb8bac8a101a368c15128cabcab6c58194b7";
const OBSERVER_SHA = "52a920ddbe6808df8151a56efcdd512b05f81a976f351e88c188bc21293e5b97";
const ROOT93_PROBE_REFERENCE = ".autopilot/2026-10-08-syntx-completion--wip/historical-source/sha256-19450bfac63f353113176b9c8ec0ff4374f76b23e0a0e9fc401d88d27df8019a.mjs";
const ROOT113_PROBE_REFERENCE = ".autopilot/2026-10-08-syntx-completion--wip/historical-source/sha256-83107218aa4d1ceb266d8bb79226fb8bac8a101a368c15128cabcab6c58194b7.mjs";
const OBSERVER_REFERENCE = ".autopilot/2026-10-08-syntx-completion--wip/historical-source/sha256-52a920ddbe6808df8151a56efcdd512b05f81a976f351e88c188bc21293e5b97.ts";
const LEGACY_VARIANT = "legacy-image-ideogram-default";
const SOURCE_VARIANT = "ideogram-image-generate-aspect-ratio-source-reviewed";
const PROFILE_VARIANT = "ideogram-image-generate-two-ratios-live";
const SOURCE_SCHEMA = "sha256:31e1603ba0668f57860b1d688b7c74bd3b8c54da117180a779f67f4a6363320c";
const LEGACY_SCHEMA = "sha256:32ef5459659b31d78c9faf6191313be83ceb5c73135bf7e06ee145dc3cbb455e";
const FIXED_SETTINGS = Object.freeze({ color_palette_mode: "preset", detail: 90, image_weight: 50,
  magic_prompt: "AUTO", mode: "generate", negative_prompt: "", num_images: 1, rendering_speed: "TURBO",
  resemblance: 55, resolution: "", seed: null, style_preset: "", style_type: "GENERAL" });
const RATIOS = ["1:1", "16:9"] as const;
const V30_PREFIX = "catalog/runtime/v30/sha256-";
const HASH = /^sha256:[a-f0-9]{64}$/u;

const root93Schema = z.object({
  schema_version: z.literal("1.0.0"),
  evidence_kind: z.literal("ROOT_REAL_IMAGE_FAMILY_PURPOSE_ACCEPTANCE"),
  status: z.literal("PASS_THREE_EXACT_SETTINGS_TUPLES"),
  promotion_parent_version: z.string(),
  public_catalog_version: z.literal(PUBLIC_VERSION),
  source_sha256: z.object({ probe_cli: z.string(), owned_image_observer: z.string() }).strict(),
  cases: z.array(z.object({
    case_id: z.string(), status: z.string(), model_id: z.string(), operation_id: z.string(), variant_id: z.string(),
    registry_version: z.string(), schema_hash: z.string(), normalized_request_fingerprint: z.string(),
    fixed_prompt_sha256: z.string(), prepared_settings: z.record(z.string(), z.unknown()), probe_call_count: z.number(),
    application_paid_retry_count: z.number(), recovery_tool_call_count: z.number(), artifact_count: z.number(),
    reported_mime_types: z.array(z.string()), image_observation: z.record(z.string(), z.unknown()),
    timeline: z.record(z.string(), z.unknown()), telegram_send_count: z.number(), telegram_receipt_acknowledged: z.boolean(),
    cleanup: z.record(z.string(), z.unknown()), stderr_bytes: z.number(), requested_n: z.union([z.number(), z.string()]),
    requested_ratio: z.string(), visual_content_or_headline_checked: z.boolean(), private_values_persisted: z.boolean()
  }).passthrough()).length(3)
}).passthrough();

const root113Schema = z.object({
  schema_version: z.literal("ROOT_IDEOGRAM_LANDSCAPE_ACCEPTANCE_V1"),
  fixed_prompt_sha256: z.string().regex(HASH),
  request_settings_proof_role: z.literal("OFFLINE_RECOMPUTED_MATCHING_ACTUAL_REQUEST_FINGERPRINT"),
  prepared_settings: z.record(z.string(), z.unknown()),
  operator_bridge_error: z.object({ code: z.string(), telegram_or_generation_resend: z.boolean(), same_parent_confirmed_ended: z.boolean() }).passthrough(),
  intent: z.object({
    scenario: z.literal("ideogram-landscape"), registry_version: z.string(), model_id: z.string(), operation_id: z.string(),
    variant_id: z.string(), schema_hash: z.string(), requested_ratio: z.string(), source_sha256: z.string(), observer_sha256: z.string(),
    intent_created_at: z.string(), new_intent: z.boolean(), paid_dispatch_limit: z.number(), retries: z.number(),
    old_unknown_replay: z.boolean(), private_values_persisted: z.boolean()
  }).passthrough(),
  telegram_send_count: z.number(), telegram_receipt_acknowledged: z.boolean(), telegram_receipt_at: z.string(),
  timeline: z.object({
    parent_started_at: z.string(), events: z.array(z.object({ event: z.string(), at: z.string() }).passthrough()),
    parent_exit: z.object({ code: z.number(), signal: z.unknown(), at: z.string() }).passthrough()
  }).passthrough(),
  terminal: z.object({
    event: z.string(), status: z.string(), contract_status: z.string(), confidence_scope: z.string(), model_id: z.string(),
    operation_id: z.string(), variant_id: z.string(), registry_version: z.string(), schema_hash: z.string(),
    normalized_request_fingerprint: z.string(), artifact_count: z.number(), mime_types: z.array(z.string()),
    safe_artifact_summary_sha256: z.string(), probe_call_count: z.number(), image_geometry_observation: z.record(z.string(), z.unknown())
  }).passthrough(),
  final: z.object({ status: z.string(), model_id: z.string(), operation_id: z.string(), variant_id: z.string(),
    registry_version: z.string(), schema_hash: z.string(), normalized_request_fingerprint: z.string(), artifact_count: z.number(),
    mime_types: z.array(z.string()), safe_artifact_summary_sha256: z.string(), probe_call_count: z.number(),
    image_geometry_observation: z.record(z.string(), z.unknown()), local_unlink_status: z.string() }).passthrough(),
  stderr_bytes: z.number(), parent_connected: z.boolean(), private_handoff_cleared: z.boolean(),
  application_generation_retry_count: z.number(), recovery_tool_calls: z.number(), visual_quality_or_content_checked: z.boolean(),
  ratio_observation: z.object({ requested: z.string(), actual_width: z.number(), actual_height: z.number(),
    relative_error_percent: z.number(), tolerance_percent: z.number(), exact_pixel_ratio: z.boolean() }).passthrough()
}).passthrough();

export interface BuildIdeogramTwoRatioProfileV2Input {
  readonly currentRegistry: GenerationContractRegistryV2;
  readonly root93ProofBytes: Uint8Array;
  readonly root113ProofBytes: Uint8Array;
  readonly root93ProbeCliBytes: Uint8Array;
  readonly root113ProbeCliBytes: Uint8Array;
  readonly observerBytes: Uint8Array;
  readonly reviewedAt: string;
}

export interface IdeogramTwoRatioProfileV2BuildResult {
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly evidence_json: string;
  readonly evidence_reference: string;
  readonly evidence_sha256: string;
  readonly registry: GenerationContractRegistryV2;
  readonly added_variant_id: typeof PROFILE_VARIANT;
}

export function buildIdeogramTwoRatioProfileV2(input: BuildIdeogramTwoRatioProfileV2Input): IdeogramTwoRatioProfileV2BuildResult {
  const root93Bytes = Buffer.from(input.root93ProofBytes);
  const root113Bytes = Buffer.from(input.root113ProofBytes);
  if (`sha256:${sha256(root93Bytes)}` !== ROOT93_SHA256) throw new Error("IDEOGRAM_TWO_RATIO_ROOT93_HASH_INVALID");
  if (`sha256:${sha256(root113Bytes)}` !== ROOT113_SHA256) throw new Error("IDEOGRAM_TWO_RATIO_ROOT113_HASH_INVALID");
  if (sha256(input.root93ProbeCliBytes) !== ROOT93_PROBE_SHA || sha256(input.root113ProbeCliBytes) !== ROOT113_PROBE_SHA ||
      sha256(input.observerBytes) !== OBSERVER_SHA) throw new Error("IDEOGRAM_TWO_RATIO_SOURCE_HASH_INVALID");

  let root93Raw: unknown;
  let root113Raw: unknown;
  try {
    root93Raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(root93Bytes));
    root113Raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(root113Bytes));
  } catch { throw new Error("IDEOGRAM_TWO_RATIO_PROOF_INVALID"); }
  const root93 = root93Schema.parse(root93Raw);
  const root113 = root113Schema.parse(root113Raw);
  const parent = generationContractRegistryV2Schema.parse(input.currentRegistry);
  if (parent.registry_sha256 !== PARENT_SHA256 || parent.contracts.length !== 41 || count(parent, "live_verified") !== 9 ||
      count(parent, "reviewed") !== 32 || parent.contracts.some((item) => item.variant_id === PROFILE_VARIANT) ||
      input.reviewedAt !== "2026-10-09T08:05:00.000Z") throw new Error("IDEOGRAM_TWO_RATIO_PARENT_MISMATCH");

  const previousSquare = root93.cases.find((item) => item.case_id === "typographic-card");
  const legacyCurrent = parent.contracts.find((item) => item.variant_id === LEGACY_VARIANT);
  const sourceProfile = parent.contracts.find((item) => item.variant_id === SOURCE_VARIANT);
  if (!previousSquare || !legacyCurrent || !sourceProfile || legacyCurrent.status !== "live_verified" ||
      legacyCurrent.model_id !== "ideogram" || legacyCurrent.operation_id !== "generate-image" ||
      sourceProfile.status !== "reviewed" || sourceProfile.schema_hash !== SOURCE_SCHEMA || sourceProfile.model_id !== "ideogram" ||
      sourceProfile.operation_id !== "generate-image" || sourceProfile.ai_name !== "ideogram" || sourceProfile.model_type !== "ideogram" ||
      root93.promotion_parent_version !== "sha256-3abbb0f227fdf3c67be014c550a1a44333aa6dce08224c2a6e40b5417a78cd0f.json" ||
      previousSquare.status !== "PASS_EXACT_RESULT_ONLY" || previousSquare.model_id !== "ideogram" || previousSquare.operation_id !== "generate-image" ||
      previousSquare.variant_id !== LEGACY_VARIANT || previousSquare.schema_hash !== LEGACY_SCHEMA || previousSquare.requested_ratio !== "1:1" ||
      previousSquare.requested_n !== 1 || previousSquare.probe_call_count !== 1 || previousSquare.application_paid_retry_count !== 0 ||
      previousSquare.recovery_tool_call_count !== 0 || previousSquare.artifact_count !== 1 || previousSquare.reported_mime_types.join(",") !== "image/png" ||
      previousSquare.visual_content_or_headline_checked || previousSquare.private_values_persisted || root93.source_sha256.probe_cli !== ROOT93_PROBE_SHA ||
      root93.source_sha256.owned_image_observer !== OBSERVER_SHA) throw new Error("IDEOGRAM_TWO_RATIO_ROOT93_BINDING_INVALID");

  const root93Image = previousSquare.image_observation as Record<string, unknown>;
  const root93Settings = previousSquare.prepared_settings;
  if (canonicalJson(root93Settings) !== canonicalJson({ ...FIXED_SETTINGS, aspect_ratio: "1:1", model_type: "ideogram" }) ||
      canonicalJson({ ...legacyCurrent.wire.fixed_settings, model_type: legacyCurrent.model_type }) !== canonicalJson(root93Settings) ||
      root93Image.status !== "OBSERVED" || root93Image.mime !== "image/png" || root93Image.declared_mime !== "image/png" ||
      root93Image.response_mime_type !== "image/png" || root93Image.byte_size !== 482_731 || root93Image.width !== 1024 || root93Image.height !== 1024 ||
      root93Image.sha256 !== "sha256:2538a2bb92a0b9cc4ab9a575dbd57ee8d7d6b750d2ad29c081b535ea39165b22" ||
      root93Image.requested_ratio !== "1:1" || root93Image.ratio_match !== true ||
      (root93Image.sdk_metadata as Record<string, unknown>).mime_type !== "image/png" ||
      previousSquare.normalized_request_fingerprint !== recomputeFingerprint(previousSquare.registry_version, previousSquare.model_id,
        previousSquare.variant_id, previousSquare.schema_hash, root93Settings, previousSquare.case_id, previousSquare.fixed_prompt_sha256)) {
    throw new Error("IDEOGRAM_TWO_RATIO_ROOT93_REQUEST_INVALID");
  }
  validateRoot93Timeline(previousSquare.timeline as Record<string, unknown>, previousSquare.cleanup as Record<string, unknown>,
    previousSquare.telegram_send_count, previousSquare.telegram_receipt_acknowledged);

  const intent = root113.intent;
  const terminal = root113.terminal;
  const final = root113.final;
  if (intent.registry_version !== PARENT_VERSION || intent.model_id !== "ideogram" || intent.operation_id !== "generate-image" ||
      intent.variant_id !== SOURCE_VARIANT || intent.schema_hash !== SOURCE_SCHEMA || intent.requested_ratio !== "16:9" ||
      intent.source_sha256 !== ROOT113_PROBE_SHA || intent.observer_sha256 !== OBSERVER_SHA || !intent.new_intent ||
      intent.paid_dispatch_limit !== 1 || intent.retries !== 0 || intent.old_unknown_replay || intent.private_values_persisted ||
      terminal.event !== "TERMINAL_RESULT" || terminal.status !== "PASS_EXACT_RESULT_ONLY" || terminal.contract_status !== "reviewed" ||
      terminal.confidence_scope !== "exact_result_only" || terminal.model_id !== "ideogram" || terminal.operation_id !== "generate-image" ||
      terminal.variant_id !== SOURCE_VARIANT || terminal.registry_version !== PARENT_VERSION || terminal.schema_hash !== SOURCE_SCHEMA ||
      terminal.artifact_count !== 1 || terminal.mime_types.join(",") !== "image/png" || terminal.probe_call_count !== 1 ||
      terminal.image_geometry_observation.status !== "OBSERVED" || terminal.image_geometry_observation.mime !== "image/png" ||
      terminal.image_geometry_observation.declared_mime !== "image/png" || terminal.image_geometry_observation.response_mime_type !== "image/png" ||
      terminal.image_geometry_observation.byte_size !== 1_568_951 || terminal.image_geometry_observation.width !== 1312 ||
      terminal.image_geometry_observation.height !== 736 || terminal.image_geometry_observation.sha256 !== "sha256:708b7004e1eea6ce4341473d89daabfb262114ff9dbfc84b73b0b502a5953bf7" ||
      terminal.image_geometry_observation.requested_ratio !== "16:9" || terminal.image_geometry_observation.ratio_match !== true ||
      (terminal.image_geometry_observation.sdk_metadata as Record<string, unknown>).mime_type !== "image/png" ||
      final.local_unlink_status !== "REVOKED_READBACK_CONFIRMED" || final.cleanup_contract_status !== "reviewed" ||
      final.status !== "PASS_EXACT_RESULT_ONLY" || final.model_id !== terminal.model_id || final.operation_id !== terminal.operation_id ||
      final.variant_id !== terminal.variant_id || final.registry_version !== terminal.registry_version || final.schema_hash !== terminal.schema_hash ||
      final.normalized_request_fingerprint !== terminal.normalized_request_fingerprint || final.artifact_count !== 1 ||
      final.mime_types.join(",") !== "image/png" || final.safe_artifact_summary_sha256 !== terminal.safe_artifact_summary_sha256 ||
      final.probe_call_count !== 1 || final.local_unlink_status !== "REVOKED_READBACK_CONFIRMED" ||
      root113.telegram_send_count !== 1 || !root113.telegram_receipt_acknowledged || root113.operator_bridge_error.telegram_or_generation_resend ||
      !root113.operator_bridge_error.same_parent_confirmed_ended || root113.stderr_bytes !== 0 || root113.parent_connected ||
      !root113.private_handoff_cleared || root113.application_generation_retry_count !== 0 || root113.recovery_tool_calls !== 0 ||
      root113.visual_quality_or_content_checked || intent.intent_created_at > root113.timeline.parent_started_at) {
    throw new Error("IDEOGRAM_TWO_RATIO_ROOT113_BINDING_INVALID");
  }

  const root113Settings = root113.prepared_settings;
  const expectedLandscape = { ...FIXED_SETTINGS, aspect_ratio: "16:9", model_type: "ideogram" };
  if (canonicalJson(root113Settings) !== canonicalJson(expectedLandscape) ||
      canonicalJson(terminal.image_geometry_observation) !== canonicalJson(final.image_geometry_observation) ||
      terminal.normalized_request_fingerprint !== recomputeFingerprint(intent.registry_version, intent.model_id, intent.variant_id,
        intent.schema_hash, root113Settings, "ideogram-landscape", root113.fixed_prompt_sha256)) {
    throw new Error("IDEOGRAM_TWO_RATIO_ROOT113_REQUEST_INVALID");
  }
  const ratioObservation = root113.ratio_observation;
  const relativeError = Math.abs(((ratioObservation.actual_width / ratioObservation.actual_height) / (16 / 9)) - 1) * 100;
  if (ratioObservation.requested !== "16:9" || ratioObservation.actual_width !== 1312 || ratioObservation.actual_height !== 736 ||
      ratioObservation.tolerance_percent !== 2 || ratioObservation.exact_pixel_ratio !== false ||
      Math.abs(relativeError - ratioObservation.relative_error_percent) > 1e-12 || relativeError > ratioObservation.tolerance_percent ||
      ratioObservation.exact_pixel_ratio !== (ratioObservation.actual_width * 9 === ratioObservation.actual_height * 16)) {
    throw new Error("IDEOGRAM_TWO_RATIO_GEOMETRY_INVALID");
  }
  validateRoot113Timeline(root113);
  const liveObservedAt = root113.timeline.events.find((event) => event.event === "TERMINAL_RESULT")?.at;
  if (typeof liveObservedAt !== "string" || !Number.isFinite(Date.parse(input.reviewedAt)) || Date.parse(input.reviewedAt) < Date.parse(liveObservedAt)) {
    throw new Error("IDEOGRAM_TWO_RATIO_REVIEW_TIME_INVALID");
  }

  const oldEffective = { ...FIXED_SETTINGS, aspect_ratio: "1:1", model_type: "ideogram" };
  const newEffective = expectedLandscape;
  if (!sameExceptRatio(oldEffective, newEffective) || canonicalJson(root93Settings) !== canonicalJson(oldEffective) ||
      canonicalJson(root113Settings) !== canonicalJson(newEffective)) throw new Error("IDEOGRAM_TWO_RATIO_PREPARED_SETTINGS_MISMATCH");

  const evidenceBase = {
    schema_version: "1.0.0", artifact_kind: "ROOT_IDEOGRAM_TWO_RATIO_EFFECTIVE_PROFILE_V1", runtime_usable: false,
    evidence_level: "TWO_EXACT_RATIO_PROOFS_ONE_RESTRICTED_PROFILE",
    parent_registry_version: PARENT_VERSION, parent_registry_sha256: PARENT_SHA256,
    public_catalog_version: PUBLIC_VERSION, profile_variant_id: PROFILE_VARIANT,
    retained_reviewed_variant_id: SOURCE_VARIANT, retained_reviewed_variant_status: "reviewed",
    ratio_enum: RATIOS,
    prepared_settings_common_fields: FIXED_SETTINGS,
    observations: [
      makeObservation("root-93-ideogram-square", ROOT93_REFERENCE, ROOT93_SHA256, ROOT93_PROBE_REFERENCE, ROOT93_PROBE_SHA,
        previousSquare.registry_version, previousSquare.variant_id, previousSquare.schema_hash, previousSquare.normalized_request_fingerprint,
        previousSquare.fixed_prompt_sha256, root93Settings, root93Image as Record<string, unknown>, "1:1", {
          requested: "1:1", actual_width: 1024, actual_height: 1024, relative_error_percent: 0, tolerance_percent: 0, exact_pixel_ratio: true
        }, previousSquare.timeline as Record<string, unknown>, previousSquare.cleanup as Record<string, unknown>),
      makeObservation("root-113-ideogram-landscape", ROOT113_REFERENCE, ROOT113_SHA256, ROOT113_PROBE_REFERENCE, ROOT113_PROBE_SHA,
        intent.registry_version, intent.variant_id, intent.schema_hash,
        terminal.normalized_request_fingerprint, root113.fixed_prompt_sha256, root113Settings,
        terminal.image_geometry_observation as Record<string, unknown>, "16:9", ratioObservation,
        { parent_started_at: root113.timeline.parent_started_at, begin_observed_at: root113.timeline.events[0]?.at,
          terminal_observed_at: liveObservedAt, final_observed_at: root113.timeline.events[1]?.at, parent_exit_at: root113.timeline.parent_exit.at },
        { local_unlink_status: final.local_unlink_status, parent_exit_code: root113.timeline.parent_exit.code,
          parent_ended: true, private_handoff_cleared: root113.private_handoff_cleared })
    ],
    source_hashes: {
      root93_probe_cli: { reference: ROOT93_PROBE_REFERENCE, sha256: `sha256:${ROOT93_PROBE_SHA}` },
      root113_probe_cli: { reference: ROOT113_PROBE_REFERENCE, sha256: `sha256:${ROOT113_PROBE_SHA}` },
      owned_image_observer: { reference: OBSERVER_REFERENCE, sha256: `sha256:${OBSERVER_SHA}` }
    },
    scope_limits: {
      one_profile_two_exact_ratios_only: true, thirteen_ratio_profile_promoted: false,
      visual_quality_claimed: false, exact_16_9_pixel_ratio_claimed: false,
      full_pixel_decode_or_image_content_claimed: false, other_settings_or_models_claimed: false,
      runtime_usable: false, defaults_or_activation_changed: false
    }
  };
  const evidenceJson = `${canonicalJson(evidenceBase)}\n`;
  const evidenceSha = `sha256:${sha256(Buffer.from(evidenceJson, "utf8"))}`;
  const evidenceReference = `${V30_PREFIX}${evidenceSha.slice(7)}.json`;

  const references = sourceProfile.provenance.references.filter((reference) => reference.kind === "public_catalog" ||
    reference.kind === "frontend_static" || (reference.kind === "manual_review" &&
      !reference.reference.includes("changed-ratio backend acceptance is not established")));
  const candidate: GenerationContractV2Input = {
    ...stripSchemaHash(sourceProfile), variant_id: PROFILE_VARIANT, status: "live_verified",
    provenance: {
      ...sourceProfile.provenance, reviewed_at: input.reviewedAt, live_observed_at: liveObservedAt,
      references: [...references,
        { kind: "live_owner", reference: evidenceReference, sha256: evidenceSha },
        { kind: "manual_review", reference: "Exact effective Ideogram settings proven for 1:1 and 16:9 only; the 16:9 image is within 2% ratio tolerance, not an exact pixel ratio. No visual-quality claim." }
      ]
    },
    parameters: { type: "object", additional_properties: false, required: ["prompt", "aspect_ratio"],
      properties: { prompt: { type: "string", min_length: 1 }, aspect_ratio: { type: "string", enum: [...RATIOS] } },
      conditions: [], conditional_enums: [] },
    wire: { ...sourceProfile.wire, settings_fields: { aspect_ratio: "aspect_ratio" }, fixed_settings: { ...FIXED_SETTINGS } },
    limits: { ...sourceProfile.limits, max_parameters: 2 }
  };
  const registry = createGenerationContractRegistryV2({ schema_version: "2.0.0", catalog_version: parent.catalog_version,
    source_hashes: parent.source_hashes, contracts: [...parent.contracts.map(stripSchemaHash), candidate] });
  const preserved = parent.contracts.every((old) => canonicalJson(registry.contracts.find((item) => item.variant_id === old.variant_id)) === canonicalJson(old));
  if (!preserved || registry.contracts.length !== 42 || count(registry, "live_verified") !== 10 || count(registry, "reviewed") !== 32 ||
      registry.contracts.filter((item) => item.model_id === "ideogram").length !== parent.contracts.filter((item) => item.model_id === "ideogram").length + 1) {
    throw new Error("IDEOGRAM_TWO_RATIO_REGISTRY_INVARIANT_FAILED");
  }
  const proof = Object.freeze({ ...evidenceBase, evidence_sha256: evidenceSha });
  return Object.freeze({ evidence: proof, evidence_json: evidenceJson, evidence_reference: evidenceReference,
    evidence_sha256: evidenceSha, registry, added_variant_id: PROFILE_VARIANT });
}

export async function archiveIdeogramTwoRatioProfileV2(
  built: IdeogramTwoRatioProfileV2BuildResult,
  catalogDirectory?: string
): Promise<{ readonly evidence_status: "created" | "existing"; readonly evidence_reference: string; readonly registry_status: "created" | "existing"; readonly registry_version: string }> {
  const catalogRoot = resolve(catalogDirectory ?? join(process.cwd(), "catalog"));
  const evidenceBytes = Buffer.from(built.evidence_json, "utf8");
  if (`sha256:${sha256(evidenceBytes)}` !== built.evidence_sha256 ||
      `${V30_PREFIX}${built.evidence_sha256.slice(7)}.json` !== built.evidence_reference ||
      built.evidence.evidence_sha256 !== built.evidence_sha256 || built.added_variant_id !== PROFILE_VARIANT ||
      !built.registry.contracts.some((item) => item.variant_id === PROFILE_VARIANT && item.status === "live_verified" &&
        item.provenance.references.some((reference) => reference.kind === "live_owner" && reference.reference === built.evidence_reference && reference.sha256 === built.evidence_sha256))) {
    throw new Error("IDEOGRAM_TWO_RATIO_ARCHIVE_BINDING_INVALID");
  }
  const evidenceStatus = await createOnce(join(catalogRoot, built.evidence_reference.slice("catalog/".length)), evidenceBytes);
  const registry = await archiveGenerationContractRegistryV2(generationContractRegistryV2Schema.parse(built.registry), catalogRoot);
  return Object.freeze({ evidence_status: evidenceStatus, evidence_reference: built.evidence_reference,
    registry_status: registry.status, registry_version: registry.version });
}

function makeObservation(caseId: string, proofReference: string, proofSha: string, probeReference: string, probeSha: string,
  registryVersion: string, variantId: string, schemaSha: string, fingerprintSha: string, promptSha: string,
  preparedSettings: Record<string, unknown>, image: Record<string, unknown>, requestedRatio: string,
  ratioGeometry: Record<string, unknown>, timeline: Record<string, unknown>, cleanup: Record<string, unknown>) {
  return { case_id: caseId, root_proof_reference: proofReference, root_proof_sha256: proofSha,
    probe_cli_reference: probeReference, probe_cli_sha256: `sha256:${probeSha}`, registry_version: registryVersion,
    variant_id: variantId, schema_sha256: schemaSha, request_fingerprint_sha256: fingerprintSha,
    purpose_prompt_sha256: promptSha, prepared_settings: structuredClone(preparedSettings), image_observation: structuredClone(image),
    requested_ratio: requestedRatio, ratio_geometry: structuredClone(ratioGeometry), probe_call_count: 1,
    application_paid_retry_count: 0, recovery_tool_call_count: 0, artifact_count: 1,
    local_cleanup: structuredClone(cleanup), timeline: structuredClone(timeline), visual_quality_claimed: false };
}

function validateRoot93Timeline(timeline: Record<string, unknown>, cleanup: Record<string, unknown>, telegramCount: number, acknowledged: boolean): void {
  const order = ["parent_start_utc", "begin_observed_utc", "terminal_observed_utc", "final_observed_utc", "parent_exit_utc"]
    .map((key) => Date.parse(String(timeline[key])));
  if (order.some((value) => !Number.isFinite(value)) || order.some((value, index) => index > 0 && value < order[index - 1]!) ||
      telegramCount !== 1 || !acknowledged || cleanup.local_unlink_status !== "REVOKED_READBACK_CONFIRMED" ||
      cleanup.parent_exit_code !== 0 || cleanup.parent_ended !== true || cleanup.upstream_logout_claim !== false) {
    throw new Error("IDEOGRAM_TWO_RATIO_ROOT93_TIMELINE_CLEANUP_INVALID");
  }
}

function validateRoot113Timeline(proof: z.infer<typeof root113Schema>): void {
  const begin = proof.timeline.events.find((event) => event.event === "BEGIN")?.at;
  const terminal = proof.timeline.events.find((event) => event.event === "TERMINAL_RESULT")?.at;
  const final = proof.timeline.events.find((event) => event.event === "FINAL")?.at;
  const stamps = [proof.timeline.parent_started_at, proof.intent.intent_created_at, begin, terminal, final, proof.timeline.parent_exit.at]
    .map((value) => Date.parse(String(value)));
  if (stamps.some((value) => !Number.isFinite(value)) || stamps[0]! > stamps[2]! || stamps[2]! > stamps[3]! ||
      stamps[3]! > stamps[4]! || stamps[4]! > stamps[5]! || Date.parse(proof.intent.intent_created_at) > Date.parse(proof.timeline.parent_started_at) ||
      proof.timeline.parent_exit.code !== 0 || proof.timeline.parent_exit.signal !== null) {
    throw new Error("IDEOGRAM_TWO_RATIO_ROOT113_TIMELINE_INVALID");
  }
}

function recomputeFingerprint(registryVersion: string, modelId: string, variantId: string, schemaHash: string,
  settings: Record<string, unknown>, caseId: string, promptSha: string): string {
  return `sha256:${sha256(Buffer.from(canonicalJson({ registry_version: registryVersion, model_id: modelId,
    operation_id: "generate-image", variant_id: variantId, schema_hash: schemaHash, operator_parameter_keys: [],
    normalized_settings: settings, image_family_case_id: caseId, fixed_prompt_sha256: promptSha }), "utf8"))}`;
}

function sameExceptRatio(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const leftBase = { ...left }; const rightBase = { ...right };
  delete leftBase.aspect_ratio; delete rightBase.aspect_ratio;
  return canonicalJson(leftBase) === canonicalJson(rightBase) && left.aspect_ratio === "1:1" && right.aspect_ratio === "16:9";
}

function stripSchemaHash(contract: GenerationContractRegistryV2["contracts"][number]): GenerationContractV2Input {
  const { schema_hash: _schemaHash, ...withoutHash } = contract;
  return withoutHash;
}

function count(registry: Pick<GenerationContractRegistryV2, "contracts">, status: "live_verified" | "reviewed"): number {
  return registry.contracts.filter((item) => item.status === status).length;
}

async function createOnce(path: string, bytes: Buffer): Promise<"created" | "existing"> {
  const directory = dirname(path);
  for (const pathPart of [dirname(directory), directory]) {
    try { await mkdir(pathPart, { recursive: false, mode: 0o755 }); }
    catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
    assertDirectory(pathPart);
  }
  const temporary = join(directory, `.pending-${randomUUID()}.tmp`);
  let created = false;
  let file;
  try {
    file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
    await file.writeFile(bytes); await file.sync(); await file.close(); file = undefined;
    try { await link(temporary, path); created = true; }
    catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
    await readExactFile(path, bytes);
    return created ? "created" : "existing";
  } finally {
    try { await file?.close(); } catch { /* Keep the primary failure. */ }
    try { await unlink(temporary); } catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
  }
}

async function readExactFile(path: string, expected: Buffer): Promise<void> {
  assertRegularFile(path);
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const actual = await file.readFile();
    if (!actual.equals(expected)) throw new Error("IDEOGRAM_TWO_RATIO_ARTIFACT_COLLISION");
  } finally { await file.close(); }
}

function assertDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("IDEOGRAM_TWO_RATIO_ARTIFACT_PATH_INVALID");
}

function assertRegularFile(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("IDEOGRAM_TWO_RATIO_ARTIFACT_PATH_INVALID");
}

function hasCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code;
}

function sha256(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
