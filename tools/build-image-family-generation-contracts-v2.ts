import { createHash, randomUUID } from "node:crypto";
import { constants, lstatSync, openSync, closeSync, fstatSync, readSync } from "node:fs";
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

const ROOT_PROOF_SHA256 = "sha256:fef4de4914a49da73a59480822936e47e64fabf93a730e35c581b3f7c5546832";
const PARENT_VERSION = "sha256-3abbb0f227fdf3c67be014c550a1a44333aa6dce08224c2a6e40b5417a78cd0f.json";
const PARENT_SHA256 = "sha256:00464f0d15ae8eb02d7753d65ff5f68737b5a270bd788cae58d80da5d85f42a8";
const SOURCE_VERSION = "sha256-650fe8e62c95298d81b8134d3f583b0acfbe55fe147ec2c828d95f941f7236ef.json";
const SOURCE_SHA256 = "sha256:aa471747dd21349c35a766dced8189dd58ed970256f93f25aeb67bdb154cc856";
const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const PROOF_SOURCE = ".autopilot/2026-10-08-syntx-completion--wip/root-93-three-image-family-proof.json";
const PROBE_SOURCE = "scripts/live-owner-reviewed-contract-probe.mjs";
const OBSERVER_SOURCE = "src/adapter/syntx/owned-image-artifact-observer.ts";
const V29_PREFIX = "catalog/runtime/v29/sha256-";
const HASH = /^sha256:[a-f0-9]{64}$/u;

const scalarRecord = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));
const imageCaseSchema = z.object({
  case_id: z.enum(["editorial-cover", "square-product-hero", "typographic-card"]),
  status: z.literal("PASS_EXACT_RESULT_ONLY"),
  model_id: z.string(), operation_id: z.literal("generate-image"), variant_id: z.string(),
  registry_version: z.literal(SOURCE_VERSION), schema_hash: z.string().regex(HASH),
  normalized_request_fingerprint: z.string().regex(HASH), prepared_settings: scalarRecord,
  fixed_prompt_sha256: z.string().regex(HASH),
  prompt_sha256_role: z.literal("OFFLINE_RECOMPUTED_MATCHING_ACTUAL_REQUEST_FINGERPRINT"),
  probe_call_count: z.literal(1), application_paid_retry_count: z.literal(0), recovery_tool_call_count: z.literal(0),
  artifact_count: z.literal(1), reported_mime_types: z.tuple([z.enum(["image/png", "image/jpeg"])]),
  metadata_summary_sha256: z.string().regex(HASH), metadata_digest_is_not_image_bytes: z.literal(true),
  image_observation: z.object({
    status: z.literal("OBSERVED"), mime: z.enum(["image/png", "image/jpeg"]),
    declared_mime: z.enum(["image/png", "image/jpeg"]), response_mime_type: z.enum(["image/png", "image/jpeg"]),
    byte_size: z.number().int().positive(), width: z.number().int().positive(), height: z.number().int().positive(),
    sha256: z.string().regex(HASH),
    ratio_status: z.literal("NOT_REQUESTED").optional(), requested_ratio: z.string().optional(), ratio_match: z.boolean().optional(),
    sdk_metadata: z.object({ mime_type: z.enum(["image/png", "image/jpeg"]) }).strict()
  }).strict(),
  timeline: z.object({
    parent_start_utc: z.iso.datetime(), begin_observed_utc: z.iso.datetime(), terminal_observed_utc: z.iso.datetime(),
    final_observed_utc: z.iso.datetime(), parent_exit_utc: z.iso.datetime(), dispatch_exact_timestamp: z.literal("NOT_LATCHED")
  }).strict(),
  telegram_send_count: z.literal(1), telegram_receipt_acknowledged: z.literal(true),
  cleanup: z.object({ local_unlink_status: z.literal("REVOKED_READBACK_CONFIRMED"), parent_exit_code: z.literal(0),
    parent_ended: z.literal(true), upstream_logout_claim: z.literal(false) }).strict(),
  stderr_bytes: z.literal(0), requested_n: z.union([z.literal(1), z.literal("UNKNOWN_NOT_DECLARED")]),
  requested_ratio: z.union([z.literal("NOT_REQUESTED"), z.string()]),
  visual_content_or_headline_checked: z.literal(false), private_values_persisted: z.literal(false)
}).strict();

const rootProofSchema = z.object({
  schema_version: z.literal("1.0.0"), evidence_kind: z.literal("ROOT_REAL_IMAGE_FAMILY_PURPOSE_ACCEPTANCE"),
  status: z.literal("PASS_THREE_EXACT_SETTINGS_TUPLES"), contract_status_at_probe: z.literal("reviewed"),
  public_catalog_version: z.literal(CATALOG_VERSION), promotion_parent_version: z.literal(PARENT_VERSION),
  source_sha256: z.object({ probe_cli: z.literal("19450bfac63f353113176b9c8ec0ff4374f76b23e0a0e9fc401d88d27df8019a"),
    owned_image_observer: z.literal("52a920ddbe6808df8151a56efcdd512b05f81a976f351e88c188bc21293e5b97") }).strict(),
  cases: z.array(imageCaseSchema).length(3),
  byte_observation_scope: z.literal("BOUNDED_IMAGE_SIGNATURE_AND_FRAME_HEADERS_NOT_FULL_PIXEL_DECODE"),
  not_proven: z.array(z.string()).min(1), old_canary_replay: z.literal(false),
  private_paths_ids_tokens_uris_rawbytes_saved: z.literal(false), purchase_renewal_push_deploy_public_share: z.literal(false)
}).strict();

const EXPECTED = [
  { id: "editorial-cover", model: "gpt-image-1.5", ai: "sora-images", variant: "legacy-image-gpt-image-1.5-default",
    schema: "sha256:227410b168b7c4ff2f469d813d594681da15344aafcc400408fa98c7960d601b", mime: "image/png",
    settings: { model_type: "gpt-image-1.5" }, n: "UNKNOWN_NOT_DECLARED", ratio: "NOT_REQUESTED" },
  { id: "square-product-hero", model: "grok_imagine_quality", ai: "grok_image", variant: "legacy-image-grok_imagine_quality-default",
    schema: "sha256:eba0e8af0c7e6469706ba32b558b7f1357bab0f414fb9f5d09429d9a035cf07c", mime: "image/jpeg",
    settings: { model_type: "grok_imagine_quality", aspect_ratio: "1:1", batch_size: 1, details_quality: "low", resolution: "1k" }, n: 1, ratio: "1:1" },
  { id: "typographic-card", model: "ideogram", ai: "ideogram", variant: "legacy-image-ideogram-default",
    schema: "sha256:32ef5459659b31d78c9faf6191313be83ceb5c73135bf7e06ee145dc3cbb455e", mime: "image/png",
    settings: { model_type: "ideogram", aspect_ratio: "1:1", color_palette_mode: "preset", detail: 90, image_weight: 50,
      magic_prompt: "AUTO", mode: "generate", negative_prompt: "", num_images: 1, rendering_speed: "TURBO", resemblance: 55,
      resolution: "", seed: null, style_preset: "", style_type: "GENERAL" }, n: 1, ratio: "1:1" }
] as const;

const validatedBrand: unique symbol = Symbol("validatedImageFamilyProofV2");
export type ValidatedImageFamilyProofV2 = Readonly<{
  readonly [validatedBrand]: true;
  readonly proof: z.infer<typeof rootProofSchema>;
  readonly proof_input_sha256: string;
}>;

export interface ImageFamilyGenerationContractsV2Input {
  readonly currentRegistry: GenerationContractRegistryV2;
  readonly sourceRegistry: GenerationContractRegistryV2;
  readonly rootProofBytes: Uint8Array;
  readonly probeCliBytes: Uint8Array;
  readonly observerBytes: Uint8Array;
  readonly reviewedAt: string;
}

export interface ImageFamilyGenerationContractsV2BuildResult {
  readonly proof: Readonly<Record<string, unknown>>;
  readonly proof_json: string;
  readonly proof_reference: string;
  readonly proof_sha256: string;
  readonly registry: GenerationContractRegistryV2;
  readonly promoted_variant_ids: readonly string[];
}

export function validateImageFamilyProofV2(input: ImageFamilyGenerationContractsV2Input): ValidatedImageFamilyProofV2 {
  const bytes = Buffer.from(input.rootProofBytes);
  if (bytes.length < 1 || bytes.length > 128 * 1024 || `sha256:${sha256(bytes)}` !== ROOT_PROOF_SHA256) {
    throw new Error("IMAGE_FAMILY_PROOF_HASH_INVALID");
  }
  if (`sha256:${sha256(input.probeCliBytes)}` !== "sha256:19450bfac63f353113176b9c8ec0ff4374f76b23e0a0e9fc401d88d27df8019a" ||
      `sha256:${sha256(input.observerBytes)}` !== "sha256:52a920ddbe6808df8151a56efcdd512b05f81a976f351e88c188bc21293e5b97") {
    throw new Error("IMAGE_FAMILY_SOURCE_HASH_INVALID");
  }
  let decoded: unknown;
  try { decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("IMAGE_FAMILY_PROOF_INVALID"); }
  const proof = rootProofSchema.parse(decoded);
  if (proof.cases.map((item) => item.case_id).join("\u0000") !== EXPECTED.map((item) => item.id).join("\u0000")) {
    throw new Error("IMAGE_FAMILY_CASE_ORDER_INVALID");
  }
  return Object.freeze({ [validatedBrand]: true as const, proof, proof_input_sha256: ROOT_PROOF_SHA256 });
}

export function buildImageFamilyGenerationContractsV2(
  input: ImageFamilyGenerationContractsV2Input
): ImageFamilyGenerationContractsV2BuildResult {
  const validated = validateImageFamilyProofV2(input);
  const current = generationContractRegistryV2Schema.parse(input.currentRegistry);
  const source = generationContractRegistryV2Schema.parse(input.sourceRegistry);
  if (current.registry_sha256 !== PARENT_SHA256 || current.contracts.length !== 40 || count(current, "live_verified") !== 6 || count(current, "reviewed") !== 34 ||
      source.registry_sha256 !== SOURCE_SHA256 || source.contracts.length !== 38 || count(source, "live_verified") !== 4 || count(source, "reviewed") !== 34 ||
      current.catalog_version !== source.catalog_version || JSON.stringify(current.source_hashes) !== JSON.stringify(source.source_hashes) ||
      input.reviewedAt !== "2026-10-09T06:42:00.000Z") {
    throw new Error("IMAGE_FAMILY_PARENT_REGISTRY_MISMATCH");
  }

  const promotionCases = EXPECTED.map((expected) => {
    const evidence = validated.proof.cases.find((item) => item.case_id === expected.id);
    const contract = current.contracts.find((item) => item.variant_id === expected.variant);
    const sourceContract = source.contracts.find((item) => item.variant_id === expected.variant);
    if (!evidence || !contract || !sourceContract || contract.status !== "reviewed" || sourceContract.status !== "reviewed" ||
        !sameContractBinding(contract, sourceContract) || contract.model_id !== expected.model || contract.operation_id !== "generate-image" ||
        contract.variant_id !== expected.variant || contract.ai_name !== expected.ai || contract.model_type !== expected.model ||
        contract.schema_hash !== expected.schema || evidence.model_id !== expected.model || evidence.operation_id !== "generate-image" ||
        evidence.variant_id !== expected.variant || evidence.schema_hash !== expected.schema || evidence.reported_mime_types[0] !== expected.mime ||
        evidence.image_observation.mime !== expected.mime || evidence.image_observation.declared_mime !== expected.mime ||
        evidence.image_observation.response_mime_type !== expected.mime || evidence.image_observation.sdk_metadata.mime_type !== expected.mime ||
        evidence.prepared_settings !== undefined && canonicalJson(evidence.prepared_settings) !== canonicalJson(expected.settings) ||
        canonicalJson({ ...contract.wire.fixed_settings, model_type: contract.model_type }) !== canonicalJson(expected.settings) ||
        Object.keys(contract.wire.settings_fields).length !== 0 || contract.output.mime_types.length !== 1 || contract.output.mime_types[0] !== expected.mime ||
        evidence.requested_n !== expected.n || evidence.requested_ratio !== expected.ratio ||
        (expected.id === "editorial-cover" ? evidence.image_observation.ratio_status !== "NOT_REQUESTED" || evidence.image_observation.requested_ratio !== undefined :
          evidence.image_observation.requested_ratio !== "1:1" || evidence.image_observation.ratio_match !== true)) {
      throw new Error("IMAGE_FAMILY_CASE_BINDING_INVALID");
    }
    const prepared = { ...contract.wire.fixed_settings, model_type: contract.model_type };
    const fingerprint = `sha256:${sha256(canonicalJson({ registry_version: SOURCE_VERSION, model_id: expected.model,
      operation_id: "generate-image", variant_id: expected.variant, schema_hash: expected.schema,
      operator_parameter_keys: [], normalized_settings: prepared, image_family_case_id: expected.id,
      fixed_prompt_sha256: evidence.fixed_prompt_sha256 }))}`;
    if (fingerprint !== evidence.normalized_request_fingerprint) throw new Error("IMAGE_FAMILY_REQUEST_FINGERPRINT_INVALID");
    if (evidence.probe_call_count !== 1 || evidence.application_paid_retry_count !== 0 || evidence.recovery_tool_call_count !== 0 ||
        evidence.artifact_count !== 1 || evidence.cleanup.local_unlink_status !== "REVOKED_READBACK_CONFIRMED" ||
        evidence.cleanup.parent_exit_code !== 0 || evidence.cleanup.parent_ended !== true || evidence.stderr_bytes !== 0 ||
        evidence.visual_content_or_headline_checked || evidence.private_values_persisted ||
        evidence.telegram_send_count !== 1 || !evidence.telegram_receipt_acknowledged ||
        Date.parse(evidence.timeline.parent_start_utc) > Date.parse(evidence.timeline.begin_observed_utc) ||
        Date.parse(evidence.timeline.begin_observed_utc) > Date.parse(evidence.timeline.terminal_observed_utc) ||
        Date.parse(evidence.timeline.terminal_observed_utc) > Date.parse(evidence.timeline.final_observed_utc) ||
        Date.parse(evidence.timeline.final_observed_utc) > Date.parse(evidence.timeline.parent_exit_utc)) {
      throw new Error("IMAGE_FAMILY_TERMINAL_ACCEPTANCE_INVALID");
    }
    return { expected, evidence, contract };
  });

  const proofBase = {
    schema_version: "1.0.0", artifact_kind: "ROOT_IMAGE_FAMILY_EXACT_TUPLE_PROMOTION_V1", runtime_usable: false,
    evidence_level: "ROOT_EXACT_REQUEST_FINGERPRINT_AND_BOUNDED_TERMINAL_OBSERVATION",
    root_proof_reference: `catalog/${PROOF_SOURCE}`, root_proof_sha256: validated.proof_input_sha256,
    parent_registry_version: PARENT_VERSION, parent_registry_sha256: PARENT_SHA256,
    source_registry_version: SOURCE_VERSION, source_registry_sha256: SOURCE_SHA256,
    public_catalog_version: CATALOG_VERSION,
    source_sha256: {
      probe_cli: { reference: PROBE_SOURCE, sha256: validated.proof.source_sha256.probe_cli },
      owned_image_observer: { reference: OBSERVER_SOURCE, sha256: validated.proof.source_sha256.owned_image_observer }
    },
    cases: promotionCases.map(({ expected, evidence }) => ({
      case_id: expected.id, model_id: expected.model, ai_name: expected.ai, operation_id: "generate-image", variant_id: expected.variant,
      schema_sha256: expected.schema, request_fingerprint_sha256: evidence.normalized_request_fingerprint,
      purpose_prompt_sha256: evidence.fixed_prompt_sha256, prepared_settings: expected.settings,
      outcome: evidence.status, probe_call_count: evidence.probe_call_count,
      application_paid_retry_count: evidence.application_paid_retry_count, recovery_tool_call_count: evidence.recovery_tool_call_count,
      artifact_count: evidence.artifact_count, mime_types: evidence.reported_mime_types,
      image_observation: evidence.image_observation, requested_n: evidence.requested_n, requested_ratio: evidence.requested_ratio,
      local_cleanup: evidence.cleanup, parent_exit_code: evidence.cleanup.parent_exit_code,
      visual_content_or_headline_checked: false
    })),
    scope_limits: { promoted_exact_tuples_only: true, visual_content_typography_quality_claimed: false,
      gpt_image_1_5_default_n_or_ratio_inferred: false, image_bytes_or_full_pixel_decode_claimed: false,
      all_settings_combinations_or_other_models_claimed: false }
  };
  const proofJson = `${canonicalJson(proofBase)}\n`;
  const proofSha = `sha256:${sha256(proofJson)}`;
  const proofReference = `${V29_PREFIX}${proofSha.slice(7)}.json`;
  const contracts: GenerationContractV2Input[] = current.contracts.map((contract) => {
    const promoted = promotionCases.find((item) => item.expected.variant === contract.variant_id);
    if (!promoted) return stripSchemaHash(contract);
    const references = contract.provenance.references.filter((reference) =>
      !(reference.kind === "manual_review" && reference.reference === "Not promoted: REQUEST_SETTINGS_NOT_CAPTURED"));
    return {
      ...stripSchemaHash(contract), status: "live_verified",
      provenance: { ...contract.provenance, live_observed_at: promoted.evidence.timeline.terminal_observed_utc,
        references: [...references, { kind: "live_owner", reference: proofReference, sha256: proofSha },
          { kind: "manual_review", reference: "One exact current prepared settings tuple; no broader settings or visual-content claim." }] }
    };
  });
  const registry = createGenerationContractRegistryV2({ schema_version: "2.0.0", catalog_version: current.catalog_version,
    source_hashes: current.source_hashes, contracts });
  if (registry.contracts.length !== 40 || count(registry, "live_verified") !== 9 || count(registry, "reviewed") !== 31 ||
      current.contracts.filter((item) => !EXPECTED.some((entry) => entry.variant === item.variant_id)).some((old) =>
        canonicalJson(registry.contracts.find((item) => item.variant_id === old.variant_id)) !== canonicalJson(old))) {
    throw new Error("IMAGE_FAMILY_REGISTRY_INVARIANT_FAILED");
  }
  return Object.freeze({ proof: Object.freeze(proofBase), proof_json: proofJson, proof_reference: proofReference,
    proof_sha256: proofSha, registry, promoted_variant_ids: Object.freeze(EXPECTED.map((item) => item.variant)) });
}

export async function archiveImageFamilyGenerationContractsV2(
  built: ImageFamilyGenerationContractsV2BuildResult,
  catalogDirectory?: string
): Promise<{ readonly proof_status: "created" | "existing"; readonly proof_reference: string; readonly registry_status: "created" | "existing"; readonly registry_version: string }> {
  const catalogRoot = resolve(catalogDirectory ?? join(process.cwd(), "catalog"));
  const proofBytes = Buffer.from(built.proof_json, "utf8");
  if (`sha256:${sha256(proofBytes)}` !== built.proof_sha256 || `${V29_PREFIX}${built.proof_sha256.slice(7)}.json` !== built.proof_reference ||
      built.proof.root_proof_sha256 !== ROOT_PROOF_SHA256 || !built.registry.contracts.every((contract) =>
        !built.promoted_variant_ids.includes(contract.variant_id) || contract.provenance.references.some((ref) =>
          ref.kind === "live_owner" && ref.reference === built.proof_reference && ref.sha256 === built.proof_sha256))) {
    throw new Error("IMAGE_FAMILY_ARCHIVE_BINDING_INVALID");
  }
  const proofRelative = built.proof_reference.slice("catalog/".length);
  const proofStatus = await createOnce(join(catalogRoot, proofRelative), proofBytes);
  const registry = await archiveGenerationContractRegistryV2(built.registry, catalogRoot);
  return Object.freeze({ proof_status: proofStatus, proof_reference: built.proof_reference,
    registry_status: registry.status, registry_version: registry.version });
}

async function createOnce(path: string, bytes: Buffer): Promise<"created" | "existing"> {
  const directory = dirname(path);
  const parent = dirname(directory);
  for (const pathPart of [parent, directory]) {
    try { await mkdir(pathPart, { recursive: false, mode: 0o755 }); }
    catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
    assertDirectory(pathPart);
  }
  const temporaryPath = join(directory, `.pending-${randomUUID()}.tmp`);
  let created = false;
  try {
    const handle = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    created = true;
    try { await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
    let status: "created" | "existing";
    try { await link(temporaryPath, path); status = "created"; }
    catch (error) { if (!hasCode(error, "EEXIST")) throw error; status = "existing"; }
    if (!readBounded(path).equals(bytes)) throw new Error("IMAGE_FAMILY_ARTIFACT_COLLISION");
    const directoryHandle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    return status;
  } finally {
    if (created) await unlink(temporaryPath);
  }
}

function readBounded(path: string): Buffer {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 1 || stat.size > 4 * 1024 * 1024) throw new Error("IMAGE_FAMILY_ARTIFACT_UNSAFE");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd); const bytes = Buffer.alloc(before.size + 1); let size = 0;
    while (size < bytes.length) { const read = readSync(fd, bytes, size, bytes.length - size, null); if (read === 0) break; size += read; }
    const after = fstatSync(fd);
    if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error("IMAGE_FAMILY_ARTIFACT_CHANGED");
    return bytes.subarray(0, size);
  } finally { closeSync(fd); }
}

function assertDirectory(path: string): void { const stat = lstatSync(path); if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("IMAGE_FAMILY_DIRECTORY_UNSAFE"); }
function sha256(value: Uint8Array | string): string { return createHash("sha256").update(value).digest("hex"); }
function count(registry: GenerationContractRegistryV2, status: "reviewed" | "live_verified"): number { return registry.contracts.filter((item) => item.status === status).length; }
function stripSchemaHash(contract: GenerationContractRegistryV2["contracts"][number]): GenerationContractV2Input {
  const { schema_hash: _hash, ...input } = contract; return input;
}
function sameContractBinding(left: GenerationContractRegistryV2["contracts"][number], right: GenerationContractRegistryV2["contracts"][number]): boolean {
  return canonicalJson(left) === canonicalJson(right);
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort(compareCodeUnits).map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function compareCodeUnits(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function hasCode(error: unknown, code: string): boolean { return error instanceof Error && "code" in error && error.code === code; }
