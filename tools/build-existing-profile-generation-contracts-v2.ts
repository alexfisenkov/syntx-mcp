import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RuntimeCoverageProfile, RuntimeCoverageSettingsVariant } from "../src/catalog/runtime-coverage-registry.js";
import type { MaplessSettingsInventory } from "../src/catalog/mapless-settings-inventory.js";
import type { SyntxPublicCatalogSnapshot } from "../src/catalog/syntx-public-catalog.js";
import type {
  GenerationContractRegistryV2,
  GenerationContractRegistryV2Input,
  GenerationContractV2Input
} from "../src/domain/generation-contract-v2.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

export interface ExistingProfileTerminalEvidenceV2 {
  readonly reference: string;
  readonly sha256: string;
  readonly observed_at: string;
  readonly object_type: "image" | "video";
  readonly model_type: string;
  readonly mime_types: readonly string[];
}

export interface ExistingProfileSettingsSourceV2 {
  readonly reference: string;
  readonly sha256: string;
  /** Curated identity and settings hash keep a generic source claim from promoting a different tuple. */
  readonly model_id?: string;
  readonly variant_id?: string;
  readonly settings_sha256?: string;
  readonly source_observed_at?: string;
  readonly supporting_reference?: string;
  readonly supporting_sha256?: string;
}

export interface ExistingProfileEvidenceV2 {
  readonly terminal?: ExistingProfileTerminalEvidenceV2;
  /** Exact contemporaneous request-settings/code binding, not the runtime overlay alone. */
  readonly settings_source?: ExistingProfileSettingsSourceV2;
}

export interface ExistingProfileContractsV2BuildInput {
  readonly currentRegistry: GenerationContractRegistryV2;
  readonly snapshot: SyntxPublicCatalogSnapshot;
  readonly settingsInventory: MaplessSettingsInventory;
  readonly profiles: readonly RuntimeCoverageProfile[];
  readonly profileSourceSha256: string;
  readonly reviewedAt: string;
  readonly evidenceByVariantId: Readonly<Record<string, ExistingProfileEvidenceV2>>;
}

export interface ExistingProfileCoverageV2 {
  readonly model_id: string;
  readonly operation_id: "generate-image" | "generate-video";
  readonly variant_id: string;
  readonly status: "live_verified" | "reviewed";
  readonly reason: string | null;
  readonly catalog_status: "ACTIVE" | "INACTIVE" | "MISSING" | "BINDING_MISMATCH";
  readonly terminal_proof: boolean;
  readonly request_settings_recorded: boolean;
}

export interface ExistingProfileContractsV2BuildResult {
  readonly registryInput: GenerationContractRegistryV2Input;
  readonly coverage: readonly ExistingProfileCoverageV2[];
}

export function parseExistingProfileTerminalEvidenceV2(bytes: Uint8Array, reference: string): Readonly<Record<string, ExistingProfileEvidenceV2>> {
  if (bytes.length < 1 || bytes.length > 2 * 1024 * 1024 || !reference.startsWith("catalog/runtime/v17/") ||
      reference.includes("..") || reference.includes("://")) throw new Error("EXISTING_PROFILE_V2_TERMINAL_CATALOG_INVALID");
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("EXISTING_PROFILE_V2_TERMINAL_CATALOG_INVALID"); }
  if (!isRecord(raw) || raw.artifact_kind !== "EXISTING_PROFILE_TERMINAL_EVIDENCE_V2" || !Array.isArray(raw.observations)) {
    throw new Error("EXISTING_PROFILE_V2_TERMINAL_CATALOG_INVALID");
  }
  const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const evidence: Record<string, ExistingProfileEvidenceV2> = {};
  for (const item of raw.observations) {
    if (!isRecord(item) || typeof item.model_id !== "string" || !IDENTIFIER.test(item.model_id) ||
        typeof item.variant_id !== "string" || !IDENTIFIER.test(item.variant_id) ||
        typeof item.source_sha256 !== "string" || !HASH.test(item.source_sha256) ||
        typeof item.observed_at !== "string" || !Number.isFinite(Date.parse(item.observed_at)) ||
        (item.object_type !== "image" && item.object_type !== "video") || !Array.isArray(item.mime_types) ||
        item.mime_types.some((mime) => typeof mime !== "string" || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u.test(mime))) {
      throw new Error("EXISTING_PROFILE_V2_TERMINAL_CATALOG_INVALID");
    }
    if (Object.hasOwn(evidence, item.variant_id)) throw new Error("EXISTING_PROFILE_V2_TERMINAL_VARIANT_DUPLICATE");
    evidence[item.variant_id] = {
      terminal: {
        reference: `${reference}#${item.variant_id}`,
        sha256,
        observed_at: item.observed_at,
        object_type: item.object_type,
        model_type: item.model_id,
        mime_types: item.mime_types as string[]
      }
    };
  }
  return evidence;
}

/** Parse only safe terminal evidence fields; raw IDs, URLs, prompts and bodies are discarded. */
export function parseLegacyTerminalObservation(
  bytes: Uint8Array,
  reference: string
): ExistingProfileTerminalEvidenceV2 | null {
  if (bytes.length < 1 || bytes.length > 2 * 1024 * 1024 ||
      !reference.startsWith(".черновики/") || reference.includes("..") || reference.includes("://")) return null;
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return null; }
  if (!isRecord(raw) || raw.status !== "TERMINAL_OBSERVED" || !Array.isArray(raw.observations) || raw.observations.length === 0) return null;
  const last = raw.observations.at(-1);
  if (!isRecord(last) || last.phase !== "poll" || last.still_in_progress !== false ||
      typeof last.at !== "string" || !Number.isFinite(Date.parse(last.at)) || !isRecord(last.envelope)) return null;
  const envelope = last.envelope;
  if ((envelope.object_type !== "image" && envelope.object_type !== "video") ||
      typeof envelope.model_type !== "string" || !IDENTIFIER.test(envelope.model_type)) return null;
  const mimeTypes = Array.isArray(envelope.artifacts)
    ? [...new Set(envelope.artifacts.map((artifact) => isRecord(artifact) ? artifact.mime_type : null)
      .filter((value): value is string => typeof value === "string" && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u.test(value)))].sort()
    : [];
  return {
    reference,
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    observed_at: last.at,
    object_type: envelope.object_type,
    model_type: envelope.model_type,
    mime_types: mimeTypes
  };
}

/**
 * Curate exact legacy owner tuples into v2. A terminal model/MIME record is
 * necessary but not sufficient: live_verified additionally requires a
 * contemporaneous request-settings/code source and current active catalog
 * identity. Missing evidence stays reviewed and is reported per tuple.
 */
export function buildExistingProfileContractsV2(
  input: ExistingProfileContractsV2BuildInput
): ExistingProfileContractsV2BuildResult {
  if (!HASH.test(input.profileSourceSha256) || !Number.isFinite(Date.parse(input.reviewedAt))) {
    throw new Error("EXISTING_PROFILE_V2_BUILD_INPUT_INVALID");
  }
  const sourceHashes = {
    ai: input.snapshot.sources.ai.canonical_sha256,
    llm_models: input.snapshot.sources.llm_models.canonical_sha256,
    models: input.snapshot.sources.models.canonical_sha256
  };
  const catalogVersion = `${input.snapshot.fetched_at}.${sourceHashes.models.slice(7, 19)}`;
  const currentTuples = new Set(input.currentRegistry.contracts.map((contract) => `${contract.model_id}\u0000${contract.operation_id}`));
  const contracts: GenerationContractV2Input[] = input.currentRegistry.contracts.map(({ schema_hash: _schemaHash, ...contract }) => contract);
  const coverage: ExistingProfileCoverageV2[] = [];

  for (const profile of input.profiles) {
    const operationId = profile.modality === "image" ? "generate-image" : "generate-video";
    const items: readonly { readonly variant: RuntimeCoverageSettingsVariant | null; readonly settings: Readonly<Record<string, unknown>> }[] = [
      { variant: null, settings: profile.settings },
      ...(profile.settings_variants ?? []).map((variant) => ({ variant, settings: variant.settings }))
    ];
    for (const item of items) {
      const variantId = item.variant === null
        ? `legacy-${profile.modality}-${profile.model_id}-default`
        : `legacy-${profile.modality}-${profile.model_id}-${item.variant.id}`;
      if (!IDENTIFIER.test(variantId)) throw new Error("EXISTING_PROFILE_V2_VARIANT_ID_INVALID");
      const evidence = input.evidenceByVariantId[variantId];
      const publicModel = input.snapshot.models.find((candidate) => candidate.value === profile.model_id);
      const publicProvider = input.snapshot.ai.find((candidate) => candidate.value === profile.ai_name);
      const catalogStatus: ExistingProfileCoverageV2["catalog_status"] = publicModel === undefined
        ? "MISSING"
        : publicModel.active !== true
          ? "INACTIVE"
          : publicModel.ai_name !== profile.ai_name || publicProvider?.scope !== profile.modality
          ? "BINDING_MISMATCH"
          : "ACTIVE";
      if (catalogStatus !== "ACTIVE") {
        coverage.push({
          model_id: profile.model_id,
          operation_id: operationId,
          variant_id: variantId,
          status: "reviewed",
          reason: catalogReason(catalogStatus),
          catalog_status: catalogStatus,
          terminal_proof: false,
          request_settings_recorded: false
        });
        continue;
      }
      const currentContract = input.currentRegistry.contracts.find((contract) =>
        contract.model_id === profile.model_id && contract.operation_id === operationId
      );
      if (item.variant === null && currentContract !== undefined) {
        const status = catalogStatus === "ACTIVE" && currentContract.status === "live_verified" ? "live_verified" as const : "reviewed" as const;
        const reason = catalogStatus !== "ACTIVE" ? catalogReason(catalogStatus)
          : currentContract.status !== "live_verified" ? "EXISTING_CONTRACT_NOT_LIVE_VERIFIED" : null;
        coverage.push({
          model_id: profile.model_id,
          operation_id: operationId,
          variant_id: currentContract.variant_id,
          status,
          reason,
          catalog_status: catalogStatus,
          terminal_proof: currentContract.provenance.live_observed_at !== undefined &&
            currentContract.provenance.references.some((reference) => reference.kind === "live_owner"),
          request_settings_recorded: currentContract.provenance.settings_source_sha256 !== null &&
            currentContract.provenance.references.some((reference) => reference.kind === "manual_review")
        });
        continue;
      }
      const terminal = evidence?.terminal;
      const terminalStatus = exactTerminalStatus(profile, item.settings, terminal);
      const settingsSource = evidence?.settings_source;
      const requestSettingsRecorded = settingsSource !== undefined && HASH.test(settingsSource.sha256) &&
        settingsSource.sha256 === input.profileSourceSha256 &&
        hasContemporaneousSettingsSource(settingsSource, profile.model_id, variantId, item.settings, terminal?.observed_at);
      const settingsInventoryModel = input.settingsInventory.models.find((candidate) => candidate.model_id === profile.model_id);
      const form = settingsInventoryModel?.form_id === null || settingsInventoryModel?.form_id === undefined
        ? undefined
        : input.settingsInventory.forms.find((candidate) => candidate.form_id === settingsInventoryModel.form_id);
      const formSha = form?.javascript.sha256;
      const settingSourceBound = formSha !== undefined && HASH.test(formSha) &&
        settingsInventoryModel?.ai_name === profile.ai_name && settingsInventoryModel.active === true;
      const reason = catalogStatus !== "ACTIVE" ? catalogReason(catalogStatus)
        : terminalStatus !== null ? terminalStatus
          : !requestSettingsRecorded ? "REQUEST_SETTINGS_NOT_CAPTURED"
            : !settingSourceBound ? "CURRENT_FORM_SOURCE_NOT_BOUND" : null;
      const status = reason === null ? "live_verified" as const : "reviewed" as const;
      const modelType = item.settings.model_type;
      if (typeof modelType !== "string" || modelType.trim().length === 0) {
        throw new Error("EXISTING_PROFILE_V2_MODEL_TYPE_MISSING");
      }
      const fixedSettings = { ...item.settings };
      delete fixedSettings.model_type;
      const references = [
        {
          kind: "public_catalog" as const,
          reference: `catalog/public/${input.snapshot.sources.models.canonical_sha256}; exact models[].value/active/ai_name binding`,
          sha256: input.snapshot.sources.models.canonical_sha256
        },
        {
          kind: "manual_review" as const,
          reference: `src/catalog/runtime-coverage-registry.ts; exact legacy settings tuple; sha256=${input.profileSourceSha256}`,
          sha256: input.profileSourceSha256
        },
        ...(formSha === undefined ? [] : [{
          kind: "frontend_static" as const,
          reference: `catalog/settings/v2/forms/${form?.form_id}/${form?.module_name}; form binding only, not backend acceptance`,
          sha256: formSha
        }]),
        ...(settingsSource === undefined ? [] : [{
          kind: "manual_review" as const,
          reference: settingsSource.reference,
          sha256: settingsSource.sha256
        }]),
        ...(settingsSource?.supporting_reference === undefined || settingsSource.supporting_sha256 === undefined ? [] : [{
          kind: "manual_review" as const,
          reference: settingsSource.supporting_reference,
          sha256: settingsSource.supporting_sha256
        }]),
        ...(terminal === undefined ? [] : [{
          kind: "live_owner" as const,
          reference: terminal.reference,
          sha256: terminal.sha256
        }]),
        ...(reason === null ? [] : [{
          kind: "manual_review" as const,
          reference: `Not promoted: ${reason}`
        }])
      ];
      const settingsSourceSha = formSha !== undefined && HASH.test(formSha) ? formSha : null;
      const contract: GenerationContractV2Input = {
        variant_id: variantId,
        model_id: profile.model_id,
        operation_id: operationId,
        modality: profile.modality,
        route: profile.modality === "image" ? "design" : "video",
        ai_name: profile.ai_name,
        model_type: modelType,
        status,
        provenance: {
          settings_source_sha256: settingsSourceSha,
          references,
          reviewed_at: input.reviewedAt,
          ...(status === "live_verified" ? { live_observed_at: terminal!.observed_at } : {})
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
          dispatch_action: operationId,
          input_kind: "prompt",
          prompt_field: "prompt",
          settings_fields: {},
          fixed_settings: fixedSettings as GenerationContractV2Input["wire"]["fixed_settings"],
          media_reference_fields: {}
        },
        output: {
          decoder_profile: `syntx-owner-${profile.modality}-${profile.result_mime_types[0]?.split("/")[1] ?? "unknown"}`,
          mime_types: [...profile.result_mime_types]
        },
        limits: { max_parameters: 1, max_value_depth: 4, max_serialized_bytes: 131_072, max_normalized_nodes: 20_000 }
      };

      const existingTuple = currentTuples.has(`${profile.model_id}\u0000${operationId}`);
      if (!existingTuple || item.variant !== null) contracts.push(contract);
      coverage.push({
        model_id: profile.model_id,
        operation_id: operationId,
        variant_id: variantId,
        status,
        reason,
        catalog_status: catalogStatus,
        terminal_proof: terminalStatus === null && terminal !== undefined,
        request_settings_recorded: requestSettingsRecorded
      });
    }
  }

  const unique = new Set<string>();
  for (const contract of contracts) {
    const key = `${contract.model_id}\u0000${contract.operation_id}\u0000${contract.variant_id}`;
    if (unique.has(key)) throw new Error("EXISTING_PROFILE_V2_VARIANT_DUPLICATE");
    unique.add(key);
  }
  return {
    registryInput: {
      schema_version: "2.0.0",
      catalog_version: catalogVersion,
      source_hashes: sourceHashes,
      contracts
    },
    coverage
  };
}

function exactTerminalStatus(
  profile: RuntimeCoverageProfile,
  settings: Readonly<Record<string, unknown>>,
  terminal: ExistingProfileTerminalEvidenceV2 | undefined
): string | null {
  if (terminal === undefined) return "TERMINAL_PROOF_MISSING";
  if (!HASH.test(terminal.sha256) || !Number.isFinite(Date.parse(terminal.observed_at)) || terminal.reference.trim().length === 0) {
    return "TERMINAL_PROOF_INVALID";
  }
  if (terminal.object_type !== profile.modality) return "TERMINAL_MODALITY_MISMATCH";
  if (terminal.model_type !== settings.model_type) return "TERMINAL_MODEL_TYPE_MISMATCH";
  if (profile.result_mime_types.some((mime) => !terminal.mime_types.includes(mime))) return "TERMINAL_MIME_MISMATCH";
  return null;
}

function catalogReason(status: ExistingProfileCoverageV2["catalog_status"]): string {
  if (status === "INACTIVE") return "MODEL_INACTIVE_IN_CURRENT_CATALOG";
  if (status === "MISSING") return "MODEL_MISSING_FROM_CURRENT_CATALOG";
  if (status === "BINDING_MISMATCH") return "CURRENT_CATALOG_IDENTITY_MISMATCH";
  return "CURRENT_CATALOG_NOT_VERIFIED";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasContemporaneousSettingsSource(
  source: ExistingProfileSettingsSourceV2,
  modelId: string,
  variantId: string,
  settings: Readonly<Record<string, unknown>>,
  terminalObservedAt: string | undefined
): boolean {
  if (source.model_id !== modelId || source.variant_id !== variantId ||
      source.settings_sha256 !== canonicalSettingsSha256(settings) ||
      source.source_observed_at === undefined || terminalObservedAt === undefined ||
      !Number.isFinite(Date.parse(source.source_observed_at)) || Date.parse(source.source_observed_at) > Date.parse(terminalObservedAt)) return false;
  const containsTuple = (reference: string) => {
    const normalized = reference.trim().toLowerCase();
    return normalized.includes(modelId.toLowerCase()) &&
      normalized.includes(variantId.toLowerCase());
  };
  const sourceReference = source.reference.trim().toLowerCase();
  const historicalCommit = containsTuple(sourceReference) &&
    /(?:^|[^a-f0-9])[a-f0-9]{40}(?:$|[^a-f0-9])/u.test(sourceReference);
  const reportReference = source.supporting_reference?.trim().toLowerCase() ?? "";
  const datedReport = source.supporting_sha256 !== undefined && HASH.test(source.supporting_sha256) &&
    containsTuple(reportReference) && reportReference.startsWith("docs/") &&
    reportReference.includes(".md") && /202[0-9]/u.test(reportReference);
  return historicalCommit || datedReport;
}

function canonicalSettingsSha256(settings: Readonly<Record<string, unknown>>): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]));
    }
    return value;
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(settings))).digest("hex")}`;
}

async function archiveCurrentExistingProfileContractsV2(): Promise<void> {
  const [
    { RUNTIME_COVERAGE_PROFILES },
    { loadGenerationContractRegistryV2, archiveGenerationContractRegistryV2 },
    { loadPublicCatalogVersion },
    { loadMaplessSettingsInventoryVersion },
    { createGenerationContractRegistryV2 }
  ] = await Promise.all([
    import("../src/catalog/runtime-coverage-registry.js"),
    import("../src/catalog/generation-contract-history-v2.js"),
    import("../src/catalog/public-catalog-history.js"),
    import("../src/catalog/mapless-settings-inventory.js"),
    import("../src/domain/generation-contract-v2.js")
  ]);
  const catalogDirectory = resolve("catalog");
  const publicVersion = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
  const settingsVersion = "sha256-87e96b78b145338af1a666c92ab8a9811f46eb82b8f377331a103b0b409aec38.json";
  const currentVersion = "sha256-e3a109c3b52f4e1a46b37d5a6f54f311f7f12f99b36da667f85258d928dabffe.json";
  const proofPath = "catalog/runtime/v17/existing-profile-terminal-evidence.json";
  const proofBytes = readFileSync(proofPath);
  const built = buildExistingProfileContractsV2({
    currentRegistry: loadGenerationContractRegistryV2(currentVersion, catalogDirectory),
    snapshot: loadPublicCatalogVersion(publicVersion, catalogDirectory),
    settingsInventory: loadMaplessSettingsInventoryVersion(settingsVersion, catalogDirectory),
    profiles: RUNTIME_COVERAGE_PROFILES,
    profileSourceSha256: `sha256:${createHash("sha256").update(readFileSync("src/catalog/runtime-coverage-registry.ts")).digest("hex")}`,
    reviewedAt: "2026-10-09T00:00:00.000Z",
    evidenceByVariantId: parseExistingProfileTerminalEvidenceV2(proofBytes, proofPath)
  });
  const registry = createGenerationContractRegistryV2(built.registryInput);
  const archived = await archiveGenerationContractRegistryV2(registry, catalogDirectory);
  const counts = built.coverage.reduce<Record<string, number>>((result, row) => {
    result[`${row.status}:${row.reason ?? "eligible"}`] = (result[`${row.status}:${row.reason ?? "eligible"}`] ?? 0) + 1;
    return result;
  }, {});
  process.stdout.write(`${archived.status} ${archived.version} contracts=${registry.contracts.length} coverage=${built.coverage.length} ${JSON.stringify(counts)}\n`);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]) && process.argv.includes("--archive-current")) {
  await archiveCurrentExistingProfileContractsV2();
}
