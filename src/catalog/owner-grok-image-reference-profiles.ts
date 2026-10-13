import { createHash } from "node:crypto";
import { types } from "node:util";
import { canonicalJson, schemaHash } from "../domain/generation-contract.js";
import { DiscoveryCatalogRepository, type DiscoveryModelRecord } from "./discovery-catalog.js";

const PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const CATALOG_VERSION = "2026-10-08T13:18:39.393Z.36e6960df354";
const PUBLIC_SOURCE_HASHES = Object.freeze({
  ai: "sha256:ad66f71c5ace9bb2c2670eb3ccddfbd013882928b398a100d0c757cd2895d609",
  llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
  models: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444"
});
const SETTINGS_INVENTORY_SHA = "00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61";
const SETTINGS_INVENTORY_VERSION = "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json";
const FORM_FACTS_SHA = "58a38fc1ac1bd3673709c848e9f5bd6e0b94c4fb9ab268a332ccc604c087f26e";
const FORM_SOURCE_SHA = "sha256:1bbf68ba51172eeacaa936e66755236179d8595bde98b54f78414b30645b2f5d";
const HELPER_FACTS_SHA = "ff617795f650e076083ffa25d7b60aa2f3889b1f52b21f039cffd955db39ecb0";
const SETTINGS_HELPER_SHA = "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe";
const STORE_FACTS_SHA = "64accdfce2b1e82a042b9ba3bceffa8586e02a1fcc043938ac21e464e4e49b0f";
const APP_SHA = "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf";
const SENDER_FACTS_SHA = "6b595b45d9b8e6dbd3aeff8f833a13785d23efc1d571eaac5952f180954e54e9";
const STANDARD_SENDER_SHA = "sha256:eb4fe700c7afae0756348aad3118c55ec8c9b5f5e5d18832045be07bbd368447";
const WIRE_FACTS_SHA = "1c4ed576f5de0af51a7cb53d44df6ee5947e8152b49930995b6c64d1baa1e556";
const VIDEO_SHA = "sha256:de1f4d8ddb8f79a909aad5a0e62c876995dbaada01946e395d62a3da7e62b2ae";
const SOURCE_AUDIT_SHA = "c2ac26509d75cdaa674498aed497eb342e4d068ce7be8bb9ea0d48165f724ca7";
const FORM_URL = "https://syntx.ai/assets/1791467421/grok-image.js";
const SETTINGS_URL = "https://syntx.ai/assets/1791467421/settings3.js";
const VIDEO_URL = "https://syntx.ai/assets/1791467421/video.js";
const ARTIFACT_SCHEMA_VERSION = "OWNER_GROK_IMAGE_REFERENCE_PROFILE_SET_V1";
const PROMPT_CONTROL_BYTES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

const ASPECT_RATIOS = ["1:1", "1:2", "2:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"] as const;
const RESOLUTIONS = ["1k", "2k"] as const;
const BATCH_SIZES = [1, 2, 3, 4, 5] as const;
const PROFILE_IDS = [
  "grok-i2i-reference-one-source-reviewed",
  "grok-i2i-reference-multi-source-reviewed",
  "grok-i2i-pro-reference-one-source-reviewed"
] as const;

export type OwnerGrokImageReferenceProfileId = (typeof PROFILE_IDS)[number];
export type OwnerGrokImageReferenceModelId = "grok_i2i" | "grok_i2i_pro";
export type OwnerGrokImageReferenceResolution = (typeof RESOLUTIONS)[number];
export type OwnerGrokImageReferenceBatchSize = (typeof BATCH_SIZES)[number];
export type OwnerGrokImageReferenceAspectRatio = (typeof ASPECT_RATIOS)[number];

export interface OwnerGrokImageReferenceSourceBinding {
  readonly public_catalog_version: typeof CATALOG_VERSION;
  readonly public_source_hashes: typeof PUBLIC_SOURCE_HASHES;
  readonly settings_inventory_version: typeof SETTINGS_INVENTORY_VERSION;
  readonly settings_inventory_sha256: typeof SETTINGS_INVENTORY_SHA;
  readonly form_url: typeof FORM_URL;
  readonly form_bytes: 7622;
  readonly form_sha256: typeof FORM_SOURCE_SHA;
  readonly form_facts_sha256: typeof FORM_FACTS_SHA;
  readonly settings_helper_url: typeof SETTINGS_URL;
  readonly settings_helper_sha256: typeof SETTINGS_HELPER_SHA;
  readonly settings_helper_facts_sha256: typeof HELPER_FACTS_SHA;
  readonly app_sha256: typeof APP_SHA;
  readonly store_join_facts_sha256: typeof STORE_FACTS_SHA;
  readonly standard_sender_sha256: typeof STANDARD_SENDER_SHA;
  readonly sender_facts_sha256: typeof SENDER_FACTS_SHA;
  readonly ordinary_wire_url: typeof VIDEO_URL;
  readonly ordinary_wire_sha256: typeof VIDEO_SHA;
  readonly wire_facts_sha256: typeof WIRE_FACTS_SHA;
  readonly source_audit_sha256: typeof SOURCE_AUDIT_SHA;
}

export interface OwnerGrokImageReferenceProfile {
  readonly profile_id: OwnerGrokImageReferenceProfileId;
  readonly capability: "source_reviewed_owner_reference";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "unproven";
  readonly model_id: OwnerGrokImageReferenceModelId;
  readonly ai_name: "grok_image";
  readonly model_type: OwnerGrokImageReferenceModelId;
  readonly operation_id: "generate-image";
  readonly modality: "image";
  readonly variant_id: OwnerGrokImageReferenceProfileId;
  readonly schema_hash: string;
  readonly catalog_version: typeof CATALOG_VERSION;
  readonly source_binding: OwnerGrokImageReferenceSourceBinding;
  readonly server_contract: Readonly<{
    route: "design";
    operation_id: "generate-image";
    modality: "image";
    prompt_field: "prompt";
    model_type: OwnerGrokImageReferenceModelId;
    reference_input_field: "reference_handles";
    reference_wire_field: "file_urls";
    settings_fields: Readonly<{ resolution: "resolution"; batch_size: "batch_size"; aspect_ratio?: "aspect_ratio" }>;
    fixed_settings: Readonly<{ n: 1 }>;
  }>;
  readonly prompt_schema: Readonly<{ required: true; min_length: 1; max_length: 5000 }>;
  readonly reference_bounds: Readonly<{ minimum: 1 | 2; maximum: 1 | 3 }>;
  readonly resolution_schema: typeof RESOLUTIONS;
  readonly aspect_ratio_policy: Readonly<{
    mode: "forbidden" | "required";
    allowed_values: typeof ASPECT_RATIOS | readonly [];
  }>;
  readonly batch_size_schema: Readonly<{ type: "integer"; minimum: 1; maximum: 5 }>;
  readonly forbidden_fields: readonly ["details_quality", "seed", "mode", "n", "file_urls", "model_type", "url", "path"];
  readonly output_policy: Readonly<{
    client_mime_allowlist: readonly ["image/jpeg", "image/png"];
    provider_mime_behavior: "unproven";
    batch_result_count_relation: "unproven";
    maximum_returned_artifacts: 5;
  }>;
  readonly defaults_claimed: false;
}

export interface OwnerGrokImageReferenceProfileSet {
  readonly profile_ids: typeof PROFILE_IDS;
  readonly catalog_version: typeof CATALOG_VERSION;
  readonly public_source_hashes: typeof PUBLIC_SOURCE_HASHES;
  readonly source_binding: OwnerGrokImageReferenceSourceBinding;
  readonly profile_set_sha256: string;
  readonly backend_acceptance: "unproven";
  readonly defaults_claimed: false;
}

export interface OwnerGrokImageReferenceProfileArtifact {
  readonly schema_version: typeof ARTIFACT_SCHEMA_VERSION;
  readonly catalog_version: typeof CATALOG_VERSION;
  readonly public_source_hashes: typeof PUBLIC_SOURCE_HASHES;
  readonly source_binding: OwnerGrokImageReferenceSourceBinding;
  readonly profile_set_sha256: string;
  readonly backend_acceptance: "unproven";
  readonly defaults_claimed: false;
  readonly profiles: readonly OwnerGrokImageReferenceProfile[];
}

export interface OwnerGrokImageReferenceNormalizedRequest {
  readonly prompt: string;
  readonly settings: Readonly<{
    n: 1;
    model_type: OwnerGrokImageReferenceModelId;
    resolution: OwnerGrokImageReferenceResolution;
    batch_size: OwnerGrokImageReferenceBatchSize;
    aspect_ratio?: OwnerGrokImageReferenceAspectRatio;
  }>;
}

export interface BuildOwnerGrokImageReferenceProfilesInput {
  readonly publicCatalog: DiscoveryCatalogRepository;
  readonly settingsInventoryBytes: Uint8Array;
  readonly grokFormFactsBytes: Uint8Array;
  readonly helperFactsBytes: Uint8Array;
  readonly storeJoinFactsBytes: Uint8Array;
  readonly senderFactsBytes: Uint8Array;
  readonly wireFactsBytes: Uint8Array;
  readonly sourceAuditBytes: Uint8Array;
}

const profileSetState = new WeakMap<object, ReadonlyMap<string, OwnerGrokImageReferenceProfile>>();
const profileState = new WeakMap<object, OwnerGrokImageReferenceProfileSet>();

export class OwnerGrokImageReferenceProfileError extends Error {
  constructor(readonly code:
    | "GROK_REFERENCE_SOURCE_BINDING_INVALID"
    | "GROK_REFERENCE_PROFILE_SET_FORGED"
    | "GROK_REFERENCE_PROFILE_NOT_FOUND"
    | "GROK_REFERENCE_PROFILE_FORGED"
    | "GROK_REFERENCE_PROFILE_ARTIFACT_INVALID"
    | "GROK_REFERENCE_PARAMETERS_INVALID") {
    super("The private Grok image-reference profile is unavailable or invalid.");
    this.name = "OwnerGrokImageReferenceProfileError";
  }
}

/** Build a private source-bound capability set; this is not a V2 registry or executable DTO. */
export function buildOwnerGrokImageReferenceProfiles(
  input: BuildOwnerGrokImageReferenceProfilesInput | unknown
): OwnerGrokImageReferenceProfileSet {
  const fields = readDataRecord(input, [
    "publicCatalog", "settingsInventoryBytes", "grokFormFactsBytes", "helperFactsBytes",
    "storeJoinFactsBytes", "senderFactsBytes", "wireFactsBytes", "sourceAuditBytes"
  ]);
  const pins = [
    ["settingsInventoryBytes", SETTINGS_INVENTORY_SHA, 400_000],
    ["grokFormFactsBytes", FORM_FACTS_SHA, 32_000],
    ["helperFactsBytes", HELPER_FACTS_SHA, 16_000],
    ["storeJoinFactsBytes", STORE_FACTS_SHA, 32_000],
    ["senderFactsBytes", SENDER_FACTS_SHA, 160_000],
    ["wireFactsBytes", WIRE_FACTS_SHA, 16_000],
    ["sourceAuditBytes", SOURCE_AUDIT_SHA, 32_000]
  ] as const;
  const documents = new Map<string, Record<string, unknown>>();
  try {
    for (const [key, expectedSha, maxBytes] of pins) {
      const bytes = snapshotBytes(fields[key], maxBytes);
      if (sha256(bytes) !== expectedSha) sourceInvalid();
      documents.set(key, parseJsonObject(bytes));
    }
  } catch {
    sourceInvalid();
  }
  const inventory = documents.get("settingsInventoryBytes")!;
  const form = documents.get("grokFormFactsBytes")!;
  const helper = documents.get("helperFactsBytes")!;
  const store = documents.get("storeJoinFactsBytes")!;
  const sender = documents.get("senderFactsBytes")!;
  const wire = documents.get("wireFactsBytes")!;
  const audit = documents.get("sourceAuditBytes")!;
  validateSourceFacts(inventory, form, helper, store, sender, wire, audit);
  const models = validatePublicCatalog(fields.publicCatalog);
  for (const id of ["grok_i2i", "grok_i2i_pro"] as const) validateInventoryModel(inventory, models.get(id)!);
  return createProfileSet(currentSourceBinding());
}

export function serializeOwnerGrokImageReferenceProfileSet(
  setInput: OwnerGrokImageReferenceProfileSet | unknown
): Uint8Array {
  if (!isAuthenticSet(setInput)) throw profileArtifactInvalid();
  return Buffer.from(canonicalJson(artifactForSet(setInput)), "utf8");
}

/** Rebuild capabilities from compiled policy and compare every persisted field before branding. */
export function hydrateOwnerGrokImageReferenceProfileArtifact(
  artifactInput: unknown,
  catalogInput: unknown
): OwnerGrokImageReferenceProfileSet {
  let copied: unknown;
  try { copied = snapshotArtifactJson(artifactInput, 0, { nodes: 0 }); }
  catch { throw profileArtifactInvalid(); }
  const artifact = record(copied);
  if (!artifact || !hasExactKeys(artifact, [
    "schema_version", "catalog_version", "public_source_hashes", "source_binding",
    "profile_set_sha256", "backend_acceptance", "defaults_claimed", "profiles"
  ]) || artifact.schema_version !== ARTIFACT_SCHEMA_VERSION) throw profileArtifactInvalid();
  try {
    validatePublicCatalog(catalogInput);
    const expected = createProfileSet(currentSourceBinding());
    if (canonicalJson(copied) !== canonicalJson(artifactForSet(expected))) throw profileArtifactInvalid();
    return expected;
  } catch {
    throw profileArtifactInvalid();
  }
}

export function getOwnerGrokImageReferenceProfile(
  setInput: OwnerGrokImageReferenceProfileSet | unknown,
  profileId: string
): OwnerGrokImageReferenceProfile {
  if (!isAuthenticSet(setInput)) throw new OwnerGrokImageReferenceProfileError("GROK_REFERENCE_PROFILE_SET_FORGED");
  const profile = profileSetState.get(setInput)?.get(profileId);
  if (!profile) throw new OwnerGrokImageReferenceProfileError("GROK_REFERENCE_PROFILE_NOT_FOUND");
  return profile;
}

/** Validate explicit caller choices without accepting reference URLs or materializing default settings. */
export function validateOwnerGrokImageReferenceParameters(
  profileInput: OwnerGrokImageReferenceProfile | unknown,
  parametersInput: unknown,
  referenceCount: number
): OwnerGrokImageReferenceNormalizedRequest {
  if (!profileInput || typeof profileInput !== "object" || types.isProxy(profileInput) ||
      !profileState.has(profileInput) || !Object.isFrozen(profileInput)) {
    throw new OwnerGrokImageReferenceProfileError("GROK_REFERENCE_PROFILE_FORGED");
  }
  const profile = profileInput as OwnerGrokImageReferenceProfile;
  if (!Number.isSafeInteger(referenceCount) || referenceCount < profile.reference_bounds.minimum ||
      referenceCount > profile.reference_bounds.maximum) parametersInvalid();
  const required = profile.aspect_ratio_policy.mode === "required"
    ? ["prompt", "resolution", "batch_size", "aspect_ratio"] as const
    : ["prompt", "resolution", "batch_size"] as const;
  let fields: Record<string, unknown>;
  try { fields = readDataRecord(parametersInput, required); }
  catch { parametersInvalid(); }
  if (typeof fields.prompt !== "string" || Array.from(fields.prompt.trim()).length < 1 ||
      Array.from(fields.prompt.trim()).length > profile.prompt_schema.max_length ||
      PROMPT_CONTROL_BYTES.test(fields.prompt) ||
      (typeof fields.resolution !== "string" || !(RESOLUTIONS as readonly string[]).includes(fields.resolution)) ||
      !BATCH_SIZES.some((size) => size === fields.batch_size)) parametersInvalid();
  const aspect = fields.aspect_ratio;
  if (profile.aspect_ratio_policy.mode === "required" &&
      (typeof aspect !== "string" || !ASPECT_RATIOS.includes(aspect as OwnerGrokImageReferenceAspectRatio))) parametersInvalid();
  const settings = Object.freeze({
    n: 1 as const,
    model_type: profile.model_type,
    resolution: fields.resolution as OwnerGrokImageReferenceResolution,
    batch_size: fields.batch_size as OwnerGrokImageReferenceBatchSize,
    ...(profile.aspect_ratio_policy.mode === "required"
      ? { aspect_ratio: aspect as OwnerGrokImageReferenceAspectRatio }
      : {})
  });
  return Object.freeze({ prompt: (fields.prompt as string).trim(), settings });
}

function makeProfile(
  profileId: OwnerGrokImageReferenceProfileId,
  modelId: OwnerGrokImageReferenceModelId,
  minimum: 1 | 2,
  maximum: 1 | 3,
  ratioMode: "forbidden" | "required",
  sourceBinding: OwnerGrokImageReferenceSourceBinding
): OwnerGrokImageReferenceProfile {
  const ratioPolicy = Object.freeze({
    mode: ratioMode,
    allowed_values: ratioMode === "required" ? ASPECT_RATIOS : Object.freeze([]) as readonly []
  });
  const profileBody = {
    profile_id: profileId,
    variant_id: profileId,
    capability: "source_reviewed_owner_reference",
    dispatch_allowed: false,
    backend_acceptance: "unproven",
    model_id: modelId,
    ai_name: "grok_image",
    model_type: modelId,
    operation_id: "generate-image",
    modality: "image",
    catalog_version: CATALOG_VERSION,
    source_binding: sourceBinding,
    server_contract: {
      route: "design",
      operation_id: "generate-image",
      modality: "image",
      prompt_field: "prompt",
      model_type: modelId,
      reference_input_field: "reference_handles",
      reference_wire_field: "file_urls",
      settings_fields: {
        resolution: "resolution",
        batch_size: "batch_size",
        ...(ratioMode === "required" ? { aspect_ratio: "aspect_ratio" } : {})
      },
      fixed_settings: { n: 1 }
    },
    prompt_schema: { required: true, min_length: 1, max_length: 5000 },
    reference_bounds: { minimum, maximum },
    resolution_schema: RESOLUTIONS,
    aspect_ratio_policy: ratioPolicy,
    batch_size_schema: { type: "integer", minimum: 1, maximum: 5 },
    forbidden_fields: ["details_quality", "seed", "mode", "n", "file_urls", "model_type", "url", "path"] as const,
    output_policy: {
      client_mime_allowlist: ["image/jpeg", "image/png"] as const,
      provider_mime_behavior: "unproven",
      batch_result_count_relation: "unproven",
      maximum_returned_artifacts: 5
    },
    defaults_claimed: false
  };
  return deepFreeze({
    ...profileBody,
    profile_id: profileId,
    model_id: modelId,
    model_type: modelId,
    variant_id: profileId,
    schema_hash: schemaHash(profileBody)
  }) as OwnerGrokImageReferenceProfile;
}

function currentSourceBinding(): OwnerGrokImageReferenceSourceBinding {
  return Object.freeze({
    public_catalog_version: CATALOG_VERSION,
    public_source_hashes: PUBLIC_SOURCE_HASHES,
    settings_inventory_version: SETTINGS_INVENTORY_VERSION,
    settings_inventory_sha256: SETTINGS_INVENTORY_SHA,
    form_url: FORM_URL,
    form_bytes: 7622 as const,
    form_sha256: FORM_SOURCE_SHA,
    form_facts_sha256: FORM_FACTS_SHA,
    settings_helper_url: SETTINGS_URL,
    settings_helper_sha256: SETTINGS_HELPER_SHA,
    settings_helper_facts_sha256: HELPER_FACTS_SHA,
    app_sha256: APP_SHA,
    store_join_facts_sha256: STORE_FACTS_SHA,
    standard_sender_sha256: STANDARD_SENDER_SHA,
    sender_facts_sha256: SENDER_FACTS_SHA,
    ordinary_wire_url: VIDEO_URL,
    ordinary_wire_sha256: VIDEO_SHA,
    wire_facts_sha256: WIRE_FACTS_SHA,
    source_audit_sha256: SOURCE_AUDIT_SHA
  });
}

function createProfileSet(sourceBinding: OwnerGrokImageReferenceSourceBinding): OwnerGrokImageReferenceProfileSet {
  const profiles = [
    makeProfile("grok-i2i-reference-one-source-reviewed", "grok_i2i", 1, 1, "forbidden", sourceBinding),
    makeProfile("grok-i2i-reference-multi-source-reviewed", "grok_i2i", 2, 3, "required", sourceBinding),
    makeProfile("grok-i2i-pro-reference-one-source-reviewed", "grok_i2i_pro", 1, 1, "forbidden", sourceBinding)
  ] as const;
  const map = new Map<string, OwnerGrokImageReferenceProfile>(profiles.map((profile) => [profile.profile_id, profile]));
  const setBody = {
    profile_ids: PROFILE_IDS,
    catalog_version: CATALOG_VERSION,
    public_source_hashes: PUBLIC_SOURCE_HASHES,
    source_binding: sourceBinding,
    profiles: profiles.map((profile) => profile.schema_hash),
    backend_acceptance: "unproven",
    defaults_claimed: false
  };
  const set = Object.freeze({
    profile_ids: PROFILE_IDS,
    catalog_version: CATALOG_VERSION,
    public_source_hashes: PUBLIC_SOURCE_HASHES,
    source_binding: sourceBinding,
    profile_set_sha256: schemaHash(setBody),
    backend_acceptance: "unproven" as const,
    defaults_claimed: false as const
  });
  profileSetState.set(set, map);
  for (const profile of profiles) profileState.set(profile, set);
  return set;
}

function artifactForSet(set: OwnerGrokImageReferenceProfileSet): OwnerGrokImageReferenceProfileArtifact {
  const map = profileSetState.get(set);
  if (!map) throw profileArtifactInvalid();
  const profiles = PROFILE_IDS.map((profileId) => map.get(profileId));
  if (profiles.some((profile) => profile === undefined)) throw profileArtifactInvalid();
  return Object.freeze({
    schema_version: ARTIFACT_SCHEMA_VERSION,
    catalog_version: set.catalog_version,
    public_source_hashes: set.public_source_hashes,
    source_binding: set.source_binding,
    profile_set_sha256: set.profile_set_sha256,
    backend_acceptance: set.backend_acceptance,
    defaults_claimed: set.defaults_claimed,
    profiles: Object.freeze(profiles as OwnerGrokImageReferenceProfile[])
  });
}

function snapshotArtifactJson(value: unknown, depth: number, budget: { nodes: number }): unknown {
  budget.nodes += 1;
  if (depth > 12 || budget.nodes > 10_000) throw profileArtifactInvalid();
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw profileArtifactInvalid();
    return value;
  }
  if (!value || typeof value !== "object" || types.isProxy(value)) throw profileArtifactInvalid();
  if (Array.isArray(value)) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : undefined;
    if (!Number.isSafeInteger(length) || length < 0 || length > 512 || keys.length !== length + 1 ||
        keys.some((key) => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length))) {
      throw profileArtifactInvalid();
    }
    const result: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw profileArtifactInvalid();
      result.push(snapshotArtifactJson(descriptor.value, depth + 1, budget));
    }
    return result;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw profileArtifactInvalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length > 128 || keys.some((key) => typeof key !== "string" ||
      !descriptors[key]!.enumerable || !("value" in descriptors[key]!))) throw profileArtifactInvalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) {
    result[key] = snapshotArtifactJson(descriptors[key]!.value, depth + 1, budget);
  }
  return result;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function validatePublicCatalog(catalogInput: unknown): Map<OwnerGrokImageReferenceModelId, DiscoveryModelRecord> {
  if (!(catalogInput instanceof DiscoveryCatalogRepository) || types.isProxy(catalogInput) ||
      Object.getPrototypeOf(catalogInput) !== DiscoveryCatalogRepository.prototype ||
      Object.hasOwn(catalogInput, "getModel") || catalogInput.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" ||
      catalogInput.runtime_usable !== false ||
      catalogInput.fetched_at + "." + catalogInput.source_hashes.models.slice(7, 19) !== CATALOG_VERSION ||
      canonicalJson(catalogInput.source_hashes) !== canonicalJson(PUBLIC_SOURCE_HASHES)) sourceInvalid();
  const records = new Map<OwnerGrokImageReferenceModelId, DiscoveryModelRecord>();
  for (const modelId of ["grok_i2i", "grok_i2i_pro"] as const) {
    let model: DiscoveryModelRecord;
    try { model = catalogInput.getModel(modelId); } catch { return sourceInvalid(); }
    if (model.id !== modelId || model.upstream_id !== modelId || model.ai_name !== "grok_image" ||
        model.active !== true || model.runtime_usable !== false ||
        !model.operations.some((operation) => operation.id === "generate-image" && operation.output_modality === "image")) sourceInvalid();
    records.set(modelId, model);
  }
  return records;
}

function validateInventoryModel(inventory: Record<string, unknown>, model: DiscoveryModelRecord): void {
  const forms = arrayField(inventory, "forms");
  const models = arrayField(inventory, "models");
  const form = forms.find((entry) => entry.form_id === "grok-image");
  const item = models.find((entry) => entry.model_id === model.id);
  const formJs = record(form?.javascript);
  if (record(inventory.build)?.id !== "1791467421" || record(inventory.public_catalog)?.version !== PUBLIC_VERSION ||
      record(inventory.public_catalog)?.models_sha256 !== PUBLIC_SOURCE_HASHES.models || formJs?.url !== FORM_URL ||
      formJs.bytes !== 7622 || formJs.sha256 !== FORM_SOURCE_SHA || formJs.parse_diagnostics !== 0 ||
      item?.ai_name !== "grok_image" || item.form_id !== "grok-image" || item.active !== true ||
      item.form_binding_status !== "STRUCTURAL_MATCH" || item.defaults_status !== "UNKNOWN" || item.runtime_usable !== false) sourceInvalid();
  const settings = record(item.settings);
  const expectedLimit = model.id === "grok_i2i" ? 3 : 1;
  if (!settings || settings.file_count_limit !== expectedLimit || settings.uploadable !== true ||
      canonicalJson(settings) !== canonicalJson(model.settings) ||
      settings.max_prompt_length !== 5000 ||
      canonicalJson(item.model_value_settings_keys) !== canonicalJson(["aspect_ratio", "batch_size", "model_type", "resolution"]) ||
      !Array.isArray(item.payload_field_keys) || canonicalJson(item.payload_field_keys) !== canonicalJson(["model_type"]) ||
      item.defaults_status !== "UNKNOWN" || canonicalJson(item.static_setting_defaults) !== "{}") sourceInvalid();
}

function validateSourceFacts(
  inventory: Record<string, unknown>,
  form: Record<string, unknown>,
  helper: Record<string, unknown>,
  store: Record<string, unknown>,
  sender: Record<string, unknown>,
  wire: Record<string, unknown>,
  audit: Record<string, unknown>
): void {
  const fetch = record(form.fetch);
  const declarations = arrayField(form, "declarations");
  const hasDeclaration = (name: string, contains: string) =>
    declarations.some((entry) => entry.name === name && typeof entry.source === "string" && entry.source.includes(contains));
  const hasConstant = (name: string, contains: string) =>
    declarations.some((entry) => entry.name === name && typeof entry.source === "string" && entry.source.includes(contains));
  const helperFetch = record(helper.fetch);
  const storeApp = record(store.app_source);
  const storeHelper = record(store.helper_source);
  const senderSources = arrayField(sender, "sources");
  const wireSource = record(wire.source);
  const auditEvidence = record(audit.evidence);
  if (form.schema_version !== "ROOT_207_GROK_IMAGE_FORM_FACTS_V1" || fetch?.url !== FORM_URL ||
      fetch.bytes !== 7622 || fetch.sha256 !== FORM_SOURCE_SHA || fetch.status !== 200 ||
      fetch.parse_diagnostics !== 0 || form.runtime_usable !== false || form.vendor_execution !== false ||
      form.raw_source_retention !== "RAM_ONLY" || !hasConstant("V", 'V="grok_image"') ||
      !hasDeclaration("ne", 'n.value==="grok_i2i"?c.files.length>=1') ||
      !hasDeclaration("ne", 'n.value==="grok_i2i_pro"?c.files.length==1') ||
      !hasDeclaration("Q", 'Q=["1:1","1:2","2:1","2:3","3:2","3:4","4:3","9:16","16:9"]') ||
      !hasDeclaration("M", 'M=[{label:"1K",value:"1k"},{label:"2K",value:"2k"}]') ||
      !hasDeclaration("b", 'n.value==="grok_i2i"?(((e=c.files)==null?void 0:e.length)??0)>=2') ||
      !hasDeclaration("h", 'if(e==="grok_i2i_pro"){delete s.settings.aspect_ratio;return}') ||
      !hasDeclaration("N", 'N={grok_imagine_2:["low","medium"]}') ||
      !hasDeclaration("R", 'if(!N[e]){delete s.settings[p];return}') ||
      !arrayField(form, "controls").some((entry) =>
        typeof entry.source === "string" && entry.source.includes('D(5,t=>i(m,{key:t,label:t,value:t')
      ) ||
      helper.schema_version !== "ROOT_199_SETTINGS_HELPER_FACTS_V1" || helperFetch?.sha256 !== SETTINGS_HELPER_SHA ||
      helper.runtime_usable !== false || helper.vendor_execution !== false ||
      store.schema_version !== "ROOT_GPT2_STORE_WIRE_JOIN_V1" || store.runtime_usable !== false ||
      storeHelper?.sha256 !== SETTINGS_HELPER_SHA || storeApp?.sha256 !== APP_SHA || storeApp.cached_only !== true ||
      sender.schema_version !== "1.0.0" || sender.source_only !== true || sender.backend_acceptance !== false ||
      !senderSources.some((entry) => entry.module_name === "index6.js" && entry.sha256 === STANDARD_SENDER_SHA) ||
      wire.schema_version !== "ROOT_IDEOGRAM_CUSTOM_PAYLOAD_WIRE_V1" || wire.runtime_usable !== false ||
      wireSource?.url !== VIDEO_URL || wireSource.observed_sha256 !== VIDEO_SHA ||
      record(wire.static_function_edge)?.backend_or_execution_proof !== false ||
      audit.schema_version !== "ROOT_208_GROK_REFERENCE_NEXT_PLAN_AUDIT_V1" ||
      audit.status !== "READ_ONLY_STATIC_JOIN_COMPLETE" || !auditEvidence ||
      record(auditEvidence.form_facts)?.sha256 !== FORM_FACTS_SHA ||
      record(auditEvidence.form_facts)?.source_sha256 !== FORM_SOURCE_SHA ||
      auditEvidence.public_catalog !== "catalog/public/" + PUBLIC_VERSION ||
      auditEvidence.settings_inventory !== "catalog/settings/v2/" + SETTINGS_INVENTORY_VERSION ||
      record(auditEvidence.settings_helper)?.sha256 !== HELPER_FACTS_SHA ||
      record(auditEvidence.shared_store_join)?.sha256 !== STORE_FACTS_SHA ||
      record(auditEvidence.ordinary_wire)?.sha256 !== WIRE_FACTS_SHA ||
      record(inventory.build)?.id !== "1791467421" || inventory.runtime_usable !== false) sourceInvalid();
}

function snapshotBytes(value: unknown, maximum: number): Buffer {
  if (!(value instanceof Uint8Array) || types.isProxy(value) || value.byteLength > maximum) sourceInvalid();
  return Buffer.from(value);
}

function parseJsonObject(bytes: Buffer): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const parsed = record(value);
    if (!parsed) return sourceInvalid();
    return parsed;
  } catch {
    return sourceInvalid();
  }
}

function readDataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) sourceInvalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) sourceInvalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some((key) =>
    typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable
  )) sourceInvalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function arrayField(recordValue: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = recordValue[key];
  if (!Array.isArray(value) || types.isProxy(value)) return sourceInvalid();
  return value.map((entry) => {
    const result = record(entry);
    if (!result) return sourceInvalid();
    return result;
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value)
    ? value as Record<string, unknown>
    : null;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}

function isAuthenticSet(value: unknown): value is OwnerGrokImageReferenceProfileSet {
  return value !== null && typeof value === "object" && !types.isProxy(value) &&
    Object.isFrozen(value) && profileSetState.has(value);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sourceInvalid(): never {
  throw new OwnerGrokImageReferenceProfileError("GROK_REFERENCE_SOURCE_BINDING_INVALID");
}

function parametersInvalid(): never {
  throw new OwnerGrokImageReferenceProfileError("GROK_REFERENCE_PARAMETERS_INVALID");
}

function profileArtifactInvalid(): never {
  throw new OwnerGrokImageReferenceProfileError("GROK_REFERENCE_PROFILE_ARTIFACT_INVALID");
}
