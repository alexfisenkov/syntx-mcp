import { createHash } from "node:crypto";
import { constants, lstatSync, readFileSync } from "node:fs";
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

const PARENT_VERSION = "sha256-394f8824e70dc4d3941b9f88dab7a57a49c34b6cc104bba1f16b43d7bcf3a2fb.json";
const PARENT_SHA256 = "sha256:1b932803b42f9c7dac2f0065c480efe25c6c2364a833582613185500fa7723c3";
const PARENT_CATALOG_VERSION = "2026-10-08T13:18:39.393Z.36e6960df354";
const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const FLEX_VARIANT = "banana-ui-reviewed-banana-2.1";
const FLEX_SCHEMA = "sha256:978ac3e57d759fce06e8ef1013e7e3300aaaff654e81ac0a719e9e7fbfe9103a";
const SQUARE_VARIANT = "banana21-image-1k-minimal-square";
const NEW_VARIANT = "banana21-image-1k-minimal-ratio-flex";
const NEW_PROOF_PREFIX = "catalog/runtime/v28/sha256-";
const CANONICAL_INPUT_SHA256 = "sha256:812b5cf658a966fd8037ef0a58e816564a84c5f5568bd0e3a14fa8063c87e952";
const OLD_SQUARE_PROOF_PATH = "runtime/v13/owner-stdio-contract-banana21-smoke.json";
const OLD_SQUARE_PROOF_SHA256 = "sha256:8dcbb37919218181e0bf75b7750621148abf0056a6bb36ee3bd5b98b75ef67a4";
const HASH = /^sha256:[a-f0-9]{64}$/u;

const sourceHashesSchema = z.object({
  probe_cli: z.literal("2da1e97c55ac0d326c8295d8edb0827f02d0a1c5fe2e0d0307c43a5c8d2046cf"),
  owned_image_observer: z.literal("9906298334b41b111643f85736810c9a9beeeeb13e48e789b60772a428803974"),
  owner_contract_media_service: z.literal("75848538d0507f584d54b92c25da92c819928a9bd21040a8e62d7c4c10c63641"),
  owner_probe_tool: z.literal("a3138e2249f8515cde61ce2d4fb8319c0d37bc8bdf1f76bc632b0dba4ed03f3a")
}).strict();

const inputSchema = z.object({
  schema_version: z.literal("1.0.0"),
  evidence_kind: z.literal("ROOT_REAL_REVIEWED_IMAGE_SETTINGS_PROBE"),
  status: z.literal("PASS_EXACT_RESULT_ONLY"),
  contract_status_at_probe: z.literal("reviewed"),
  confidence_scope: z.literal("exact_settings_tuple_only"),
  model_id: z.literal("banana-2.1"),
  operation_id: z.literal("generate-image"),
  variant_id: z.literal(FLEX_VARIANT),
  registry_version: z.literal("sha256-650fe8e62c95298d81b8134d3f583b0acfbe55fe147ec2c828d95f941f7236ef.json"),
  schema_hash: z.literal(FLEX_SCHEMA),
  public_catalog_version: z.literal(CATALOG_VERSION),
  operator_parameters: z.object({
    image_size: z.literal("1K"), thinking_level: z.literal("minimal"), aspect_ratio: z.literal("16:9")
  }).strict(),
  fixed_settings: z.object({ n: z.literal(1), file_urls: z.tuple([]), model_type: z.literal("banana-2.1") }).strict(),
  operator_parameter_keys: z.tuple([z.literal("aspect_ratio"), z.literal("image_size"), z.literal("thinking_level")]),
  normalized_request_fingerprint: z.string().regex(HASH),
  source_sha256: sourceHashesSchema,
  timeline: z.object({
    parent_start_utc: z.iso.datetime(), begin_observed_utc: z.iso.datetime(),
    telegram_server_send_acknowledged: z.literal(true), telegram_send_count: z.literal(1),
    telegram_send_exact_timestamp: z.literal("NOT_LATCHED"), generation_dispatch_exact_timestamp: z.literal("NOT_LATCHED"),
    terminal_observed_utc: z.iso.datetime(), final_observed_utc: z.iso.datetime(), parent_exit_observed_utc: z.iso.datetime()
  }).strict(),
  probe_call_count: z.literal(1), application_paid_retry_count: z.literal(0), recovery_tool_call_count: z.literal(0),
  initial_control_bridge_error: z.literal("V8_URL_GLOBAL_ABSENT_BEFORE_TELEGRAM_SEND"),
  control_bridge_repair: z.literal("URI_VALIDATED_IN_NODE_NO_PROCESS_RESTART_OR_SEND_RETRY"),
  artifact_count: z.literal(1), reported_mime_types: z.tuple([z.literal("image/jpeg")]),
  safe_artifact_summary_sha256: z.string().regex(HASH),
  safe_artifact_summary_digest_role: z.literal("METADATA_ONLY_NOT_IMAGE_BYTES"),
  geometry: z.object({
    status: z.literal("OBSERVED"), detected_mime: z.literal("image/jpeg"), sdk_declared_mime: z.literal("image/jpeg"),
    http_response_mime: z.literal("image/jpeg"), byte_size: z.literal(852295), width: z.literal(1376), height: z.literal(768),
    image_bytes_sha256: z.literal("sha256:340b3996c7e9e7b2976c306cdaaaf591c671eedc3d9e83d96dac590c27bb410d"),
    requested_ratio: z.literal("16:9"), ratio_match: z.literal(true), relative_ratio_error: z.literal(0.0078125),
    accepted_relative_tolerance: z.literal(0.02), dimension_evidence: z.literal("JPEG_FRAME_HEADERS_NOT_FULL_PIXEL_DECODE"),
    exact_16_to_9_pixel_ratio: z.literal(false), label_1K_not_a_guarantee_of_exact_1024_pixel_width: z.literal(true),
    owned_artifact_get_count: z.literal(1), redirects: z.literal(0), auth_headers_sent: z.literal(false), media_written_to_disk: z.literal(false)
  }).strict(),
  cleanup: z.object({
    local_unlink_status: z.literal("REVOKED_READBACK_CONFIRMED"), parent_exit_code: z.literal(0), parent_ended: z.literal(true),
    stderr_bytes: z.literal(0), upstream_logout_claim: z.literal(false)
  }).strict(),
  not_proven: z.array(z.string()).min(1),
  private_paths_ids_tokens_approval_uri_artifact_urls_rawbytes_persisted: z.literal(false),
  purchase_renewal_push_deploy_public_share: z.literal(false)
}).strict();

export type Banana21RatioProbeEvidence = z.input<typeof inputSchema>;
export interface Banana21RatioBuildResult {
  readonly proof: Readonly<Record<string, unknown>>;
  readonly proof_json: string;
  readonly proof_reference: string;
  readonly proof_sha256: string;
  readonly canonical_input_sha256: string;
  readonly registry: GenerationContractRegistryV2;
  readonly added_variant_id: typeof NEW_VARIANT;
}

export function buildBanana21AspectRatioContractV2(
  currentRegistry: GenerationContractRegistryV2,
  rawEvidence: Banana21RatioProbeEvidence,
  catalogDirectory?: string
): Banana21RatioBuildResult {
  const evidence = inputSchema.parse(rawEvidence);
  const base = generationContractRegistryV2Schema.parse(currentRegistry);
  if (base.registry_sha256 !== PARENT_SHA256 || base.catalog_version !== PARENT_CATALOG_VERSION || base.contracts.length !== 39 ||
      base.contracts.filter((item) => item.status === "live_verified").length !== 5 || base.contracts.filter((item) => item.status === "reviewed").length !== 34) {
    throw new Error("BANANA21_RATIO_PARENT_REGISTRY_MISMATCH");
  }
  const canonicalInputSha256 = `sha256:${sha256(Buffer.from(canonicalJson(evidence), "utf8"))}`;
  if (canonicalInputSha256 !== CANONICAL_INPUT_SHA256) throw new Error("BANANA21_RATIO_WHOLE_PROOF_HASH_MISMATCH");
  if (evidence.timeline.terminal_observed_utc > evidence.timeline.final_observed_utc ||
      evidence.timeline.final_observed_utc > evidence.timeline.parent_exit_observed_utc) throw new Error("BANANA21_RATIO_TIMELINE_INVALID");

  const square = base.contracts.find((item) => item.variant_id === SQUARE_VARIANT);
  validateSquareProof(square, catalogDirectory);
  const flexible = base.contracts.find((item) => item.variant_id === FLEX_VARIANT);
  if (!flexible || flexible.status !== "reviewed" || flexible.schema_hash !== FLEX_SCHEMA || flexible.model_id !== evidence.model_id ||
      flexible.operation_id !== evidence.operation_id || flexible.model_type !== evidence.fixed_settings.model_type ||
      flexible.ai_name !== "banana" || !hasEnum(flexible.parameters.properties.aspect_ratio, "1:1") ||
      !hasEnum(flexible.parameters.properties.aspect_ratio, "16:9") || !hasEnum(flexible.parameters.properties.image_size, "1K") ||
      !hasEnum(flexible.parameters.properties.thinking_level, "minimal")) throw new Error("BANANA21_RATIO_FLEXIBLE_SOURCE_BINDING_INVALID");
  if (base.contracts.some((item) => item.variant_id === NEW_VARIANT)) throw new Error("BANANA21_RATIO_VARIANT_ALREADY_EXISTS");

  const proof = deepFreeze({
    schema_version: "1.0.0",
    artifact_kind: "BANANA21_IMAGE_1K_MINIMAL_FLEXIBLE_RATIO_PROOF_V1",
    runtime_usable: false,
    evidence_level: "ROOT_TERMINAL_EXACT_CONFIGURATION_AND_GEOMETRY",
    canonical_input_sha256: canonicalInputSha256,
    input_bindings: {
      parent_registry_version: PARENT_VERSION, parent_registry_sha256: PARENT_SHA256,
      public_catalog_version: evidence.public_catalog_version, tested_registry_version: evidence.registry_version,
      model_id: evidence.model_id, operation_id: evidence.operation_id, tested_variant_id: evidence.variant_id,
      schema_sha256: evidence.schema_hash, normalized_request_fingerprint: evidence.normalized_request_fingerprint,
      operator_parameters: evidence.operator_parameters, fixed_settings: evidence.fixed_settings
    },
    source_sha256: evidence.source_sha256,
    timeline: {
      attempt_started_at_lower_bound: evidence.timeline.begin_observed_utc,
      terminal_observed_at: evidence.timeline.terminal_observed_utc,
      final_observed_at: evidence.timeline.final_observed_utc,
      parent_exit_observed_at: evidence.timeline.parent_exit_observed_utc
    },
    observation: {
      status: evidence.status, confidence_scope: evidence.confidence_scope, probe_call_count: evidence.probe_call_count,
      application_paid_retry_count: evidence.application_paid_retry_count, recovery_tool_call_count: evidence.recovery_tool_call_count,
      artifact_count: evidence.artifact_count, mime_types: evidence.reported_mime_types,
      safe_artifact_summary_sha256: evidence.safe_artifact_summary_sha256,
      cleanup: evidence.cleanup
    },
    geometry: evidence.geometry,
    old_square_profile: { variant_id: SQUARE_VARIANT, proof_reference: `catalog/${OLD_SQUARE_PROOF_PATH}`, proof_sha256: OLD_SQUARE_PROOF_SHA256, configuration_only: true },
    scope_limits: {
      accepted_aspect_ratios: ["1:1", "16:9"], fixed_image_size: "1K", fixed_thinking_level: "minimal",
      flexible_profile_live_verified_only_for_two_owned_terminal_configurations: true,
      exact_geometry_claimed_for_new_landscape_only: true, image_bytes_or_full_pixel_decode_claimed: false,
      wider_cross_product_or_reference_batch_edit_upscale_coverage_claimed: false
    }
  });
  const proofJson = `${canonicalJson(proof)}\n`;
  const proofSha256 = `sha256:${sha256(Buffer.from(proofJson, "utf8"))}`;
  const proofReference = `${NEW_PROOF_PREFIX}${proofSha256.slice(7)}.json`;

  const prior: GenerationContractV2Input[] = base.contracts.map(({ schema_hash: _schemaHash, ...contract }) => contract);
  const added: GenerationContractV2Input = {
    variant_id: NEW_VARIANT, model_id: "banana-2.1", operation_id: "generate-image", modality: "image", route: "design",
    ai_name: "banana", model_type: "banana-2.1", status: "live_verified",
    provenance: {
      settings_source_sha256: flexible.provenance.settings_source_sha256,
      references: [
        ...flexible.provenance.references.filter((reference) => reference.kind === "public_catalog" ||
          (reference.kind === "frontend_static" && reference.sha256 === flexible.provenance.settings_source_sha256)),
        { kind: "live_owner", reference: proofReference, sha256: proofSha256 },
        { kind: "live_owner", reference: `catalog/${OLD_SQUARE_PROOF_PATH}`, sha256: OLD_SQUARE_PROOF_SHA256 },
        { kind: "manual_review", reference: `Only aspect_ratio 1:1 and 16:9; image_size=1K, thinking_level=minimal; source profile remains reviewed.` }
      ],
      reviewed_at: flexible.provenance.reviewed_at,
      live_observed_at: evidence.timeline.terminal_observed_utc
    },
    parameters: {
      type: "object", additional_properties: false, required: ["prompt", "aspect_ratio"],
      properties: {
        prompt: { type: "string", min_length: 1 },
        aspect_ratio: { type: "string", enum: ["1:1", "16:9"] }
      }, conditions: [], conditional_enums: []
    },
    wire: {
      dispatch_action: "generate-image", input_kind: "prompt", prompt_field: "prompt",
      settings_fields: { aspect_ratio: "aspect_ratio" },
      fixed_settings: { image_size: "1K", thinking_level: "minimal", n: 1, file_urls: [] }, media_reference_fields: {}
    },
    output: { decoder_profile: "syntx-owner-image-jpeg", mime_types: ["image/jpeg"] },
    limits: { max_parameters: 2, max_value_depth: 4, max_serialized_bytes: 131_072, max_normalized_nodes: 20_000 }
  };
  const registry = createGenerationContractRegistryV2({
    schema_version: "2.0.0", catalog_version: base.catalog_version, source_hashes: base.source_hashes,
    contracts: [...prior, added]
  });
  if (registry.contracts.length !== 40 || registry.contracts.filter((item) => item.status === "live_verified").length !== 6 ||
      registry.contracts.filter((item) => item.status === "reviewed").length !== 34 ||
      base.contracts.some((old) => canonicalJson(registry.contracts.find((item) => item.variant_id === old.variant_id)) !== canonicalJson(old))) {
    throw new Error("BANANA21_RATIO_REGISTRY_INVARIANT_FAILED");
  }
  return deepFreeze({ proof, proof_json: proofJson, proof_reference: proofReference, proof_sha256: proofSha256,
    canonical_input_sha256: canonicalInputSha256, registry, added_variant_id: NEW_VARIANT });
}

export async function archiveBanana21AspectRatioContractV2(
  built: Banana21RatioBuildResult,
  catalogDirectory?: string
): Promise<{ readonly proof_reference: string; readonly proof_status: "created" | "existing"; readonly registry_version: string; readonly registry_status: "created" | "existing" }> {
  const root = resolve(catalogDirectory ?? join(process.cwd(), "catalog"));
  const bytes = Buffer.from(built.proof_json, "utf8");
  const sha = `sha256:${sha256(bytes)}`;
  const reference = `${NEW_PROOF_PREFIX}${sha.slice(7)}.json`;
  const registry = generationContractRegistryV2Schema.parse(built.registry);
  if (sha !== built.proof_sha256 || reference !== built.proof_reference || built.canonical_input_sha256 !== (built.proof.canonical_input_sha256 as string) ||
      !registry.contracts.some((item) => item.variant_id === NEW_VARIANT && item.status === "live_verified" &&
        item.provenance.references.some((entry) => entry.kind === "live_owner" && entry.reference === reference && entry.sha256 === sha))) {
    throw new Error("BANANA21_RATIO_ARCHIVE_BINDING_INVALID");
  }
  const relative = reference.slice("catalog/".length);
  const directory = join(root, dirname(relative));
  await mkdir(directory, { recursive: true, mode: 0o755 });
  const stat = lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("BANANA21_RATIO_ARCHIVE_DIRECTORY_UNSAFE");
  const proofStatus = await writeCreateOnce(join(root, relative), join(directory, `.pending-${sha.slice(7)}.tmp`), bytes);
  const archivedRegistry = await archiveGenerationContractRegistryV2(registry, root);
  return Object.freeze({ proof_reference: reference, proof_status: proofStatus,
    registry_version: archivedRegistry.version, registry_status: archivedRegistry.status });
}

function validateSquareProof(
  square: GenerationContractRegistryV2["contracts"][number] | undefined,
  catalogDirectory?: string
): void {
  if (!square || square.status !== "live_verified" || square.model_id !== "banana-2.1" || square.operation_id !== "generate-image" ||
      square.wire.fixed_settings.aspect_ratio !== "1:1" || square.wire.fixed_settings.image_size !== "1K" ||
      square.wire.fixed_settings.thinking_level !== "minimal" || square.wire.fixed_settings.n !== 1 ||
      !Array.isArray(square.wire.settings_fields.file_urls) && square.wire.settings_fields.file_urls !== "file_urls") {
    throw new Error("BANANA21_RATIO_OLD_SQUARE_CONTRACT_INVALID");
  }
  const proofRef = square.provenance.references.find((reference) => reference.kind === "live_owner" && reference.reference.startsWith(`catalog/${OLD_SQUARE_PROOF_PATH}`));
  if (!proofRef || proofRef.sha256 !== OLD_SQUARE_PROOF_SHA256) throw new Error("BANANA21_RATIO_OLD_SQUARE_PROOF_BINDING_INVALID");
  const root = resolve(catalogDirectory ?? join(process.cwd(), "catalog"));
  const file = join(root, OLD_SQUARE_PROOF_PATH);
  const proofBytes = readFileSync(file);
  if (`sha256:${sha256(proofBytes)}` !== OLD_SQUARE_PROOF_SHA256) throw new Error("BANANA21_RATIO_OLD_SQUARE_PROOF_HASH_MISMATCH");
  const proof = JSON.parse(proofBytes.toString("utf8")) as Record<string, any>;
  const profile = proof.exact_profile;
  const observation = proof.observation;
  if (proof.schema_version !== "1.0.0" || proof.artifact_kind !== "OWNER_STDIO_CONTRACT_MEDIA_SMOKE" ||
      proof.profile_result !== "EXACT_PROFILE_PASS" || observation?.status !== "PASS" || observation?.actual_upstream_generation_call !== true ||
      observation?.generation_call_count !== 1 || observation?.retry !== false || observation?.local_cleanup_status !== "REVOKED" ||
      profile?.model_id !== "banana-2.1" || profile?.operation_id !== "generate-image" || profile?.contract_status !== "live_verified" ||
      profile?.wire_settings?.aspect_ratio !== "1:1" || profile?.wire_settings?.image_size !== "1K" ||
      profile?.wire_settings?.thinking_level !== "minimal" || profile?.wire_settings?.n !== 1 || profile?.wire_settings?.file_urls?.length !== 0 ||
      proof.result?.artifact_count !== 1 || JSON.stringify(proof.result?.mime_types) !== JSON.stringify(["image/jpeg"])) {
    throw new Error("BANANA21_RATIO_OLD_SQUARE_PROOF_INVALID");
  }
}

function hasEnum(node: GenerationContractRegistryV2["contracts"][number]["parameters"]["properties"][string] | undefined, value: string): boolean {
  return node !== undefined && "enum" in node && node.enum?.includes(value) === true;
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
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

async function writeCreateOnce(target: string, temporaryPath: string, bytes: Uint8Array): Promise<"created" | "existing"> {
  const temporary = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await temporary.writeFile(bytes); await temporary.sync(); }
  finally { await temporary.close(); }
  try {
    let status: "created" | "existing";
    try { await link(temporaryPath, target); status = "created"; }
    catch (error) {
      if (!isCode(error, "EEXIST")) throw error;
      const existing = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const current = Buffer.alloc(bytes.byteLength + 1);
        const read = await existing.read(current, 0, current.length, 0);
        if (read.bytesRead !== bytes.byteLength || !current.subarray(0, read.bytesRead).equals(Buffer.from(bytes))) throw new Error("BANANA21_RATIO_ARCHIVE_COLLISION");
      } finally { await existing.close(); }
      status = "existing";
    }
    const directory = await open(dirname(target), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { if (!(await directory.stat()).isDirectory()) throw new Error("BANANA21_RATIO_ARCHIVE_DIRECTORY_UNSAFE"); await directory.sync(); }
    finally { await directory.close(); }
    return status;
  } finally { await unlink(temporaryPath); }
}

function isCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === code;
}
