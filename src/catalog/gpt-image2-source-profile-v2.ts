import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { canonicalJson } from "../domain/generation-contract.js";
import { archiveGenerationContractRegistryV2 } from "./generation-contract-history-v2.js";
import {
  createGenerationContractRegistryV2,
  generationContractRegistryV2Schema,
  type GenerationContractRegistryV2,
  type GenerationContractV2Input
} from "../domain/generation-contract-v2.js";
import type { GenerationContractCatalogPort } from "../adapter/syntx/generation-contract-executor.js";

export interface BuildGptImage2SourceProfileV2Input {
  readonly currentRegistry: GenerationContractRegistryV2;
  readonly publicCatalog: GenerationContractCatalogPort;
  readonly rootFactsBytes: Uint8Array;
  readonly storeWireJoinFactsBytes: Uint8Array;
  readonly standardSenderFactsBytes: Uint8Array;
  readonly reviewedAt: string;
}

export interface GptImage2SourceProfileV2BuildResult {
  readonly registry: GenerationContractRegistryV2;
  readonly added_variant_id: "gpt-image-2-source-reviewed";
}

const PARENT_VERSION = "sha256-2dbdeed0c7390430e37bbfc20486d0116943418cc37ec53a875ae49d41a2ba52.json";
const PARENT_REGISTRY_SHA = "sha256:c4fb7943d7e50c08a70fae916479f06ed46ce11b6964e6561d44f7bcff3ab68d";
const PARENT_CATALOG_VERSION = "2026-10-08T13:18:39.393Z.36e6960df354";
const ROOT_FACTS_SHA = "f84e917ccc5c5bb41d0e2f8eba914a7e77da6648bc9f39f5f2e506e8f93a1995";
const JOIN_FACTS_SHA = "64accdfce2b1e82a042b9ba3bceffa8586e02a1fcc043938ac21e464e4e49b0f";
const SENDER_FACTS_SHA = "6b595b45d9b8e6dbd3aeff8f833a13785d23efc1d571eaac5952f180954e54e9";
const FORM_SHA = "sha256:b30879e1d8171abf2dcab0dd490fbf561fab85495f022c8215b414d17178a966";
const HELPER_SHA = "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe";
const APP_SHA = "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf";
const PUBLIC_MODELS_SHA = "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444";
const VARIANT_ID = "gpt-image-2-source-reviewed";
const ROOT_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-116-gpt-image2-form-facts.json";
const JOIN_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-132-gpt-image2-store-wire-join.json";
const SENDER_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-90-standard-photo-sender-facts.json";
const FORM_URL = "https://syntx.ai/assets/1791467421/sora-images.js";
const HELPER_URL = "https://syntx.ai/assets/1791467421/settings3.js";
const RATIOS = ["1:1", "16:9", "9:16", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "21:9"] as const;
const DETAILS = ["low", "medium", "high"] as const;
const QUALITIES = ["1K", "2K", "4K"] as const;

const declarationSchema = z.object({ name: z.string(), text: z.string() }).passthrough();
const rootFactsSchema = z.object({
  schema_version: z.literal("ROOT_SORA_IMAGE_FORM_FACTS_V1"),
  runtime_usable: z.literal(false),
  models_in_scope: z.array(z.string()),
  source: z.object({ url: z.literal(FORM_URL), bytes: z.literal(5_740), sha256: z.literal(FORM_SHA) }).passthrough(),
  declarations: z.array(declarationSchema),
  controls: z.array(z.object({ text: z.string() }).passthrough()),
  setup_calls: z.array(z.object({ text: z.string() }).passthrough())
}).passthrough();
const assignmentSchema = z.object({ left: z.string(), right: z.string(), operator: z.string() }).passthrough();
const joinFactsSchema = z.object({
  schema_version: z.literal("ROOT_GPT2_STORE_WIRE_JOIN_V1"),
  runtime_usable: z.literal(false),
  model_id: z.literal("gpt-image-2"),
  helper_source: z.object({ url: z.literal(HELPER_URL), bytes: z.literal(4_123), sha256: z.literal(HELPER_SHA), max_requests: z.literal(1), max_bytes: z.literal(8_192) }).passthrough(),
  app_source: z.object({ build_id: z.literal("1791467421"), sha256: z.literal(APP_SHA), cached_only: z.literal(true), no_refetch: z.literal(true) }).passthrough(),
  helper_assignments: z.array(assignmentSchema),
  store_functions: z.array(z.object({ name: z.string(), text: z.string() }).passthrough()),
  derived_scope: z.object({
    setSettingsByModel_resets_page_metadata_and_custom_payload_to_null: z.literal(true),
    form_has_non_null_custom_payload_setter: z.literal(false),
    store_keeps_quality_key_name: z.literal("quality"),
    store_keeps_details_quality_key_name: z.literal("details_quality"),
    standard_sender_reference: z.literal(SENDER_FACTS_PATH),
    sender_base_settings: z.literal("{n:1,...appStore.settings}"),
    file_urls_appended_after_settings_selection: z.literal(true),
    backend_values_not_live_verified: z.literal(true),
    ui_choices_only: z.literal(true)
  }).passthrough()
}).passthrough();
const senderFactsSchema = z.object({
  schema_version: z.literal("1.0.0"),
  source_only: z.literal(true),
  backend_acceptance: z.literal(false),
  source_persisted: z.literal(false),
  sources: z.array(z.object({ module_name: z.string(), sha256: z.string() }).passthrough()),
  standard_sender: z.array(z.object({ module_name: z.string(), offset: z.number(), tree: z.unknown() }).passthrough())
}).passthrough();

export function buildGptImage2SourceProfileV2(input: BuildGptImage2SourceProfileV2Input): GptImage2SourceProfileV2BuildResult {
  const rootBytes = Buffer.from(input.rootFactsBytes);
  const joinBytes = Buffer.from(input.storeWireJoinFactsBytes);
  const senderBytes = Buffer.from(input.standardSenderFactsBytes);
  if (sha256(rootBytes) !== ROOT_FACTS_SHA || sha256(joinBytes) !== JOIN_FACTS_SHA || sha256(senderBytes) !== SENDER_FACTS_SHA) {
    throw new Error("GPT_IMAGE2_SOURCE_FACTS_HASH_INVALID");
  }
  if (!Number.isFinite(Date.parse(input.reviewedAt))) throw new Error("GPT_IMAGE2_REVIEW_TIME_INVALID");
  let rootFacts: z.infer<typeof rootFactsSchema>;
  let joinFacts: z.infer<typeof joinFactsSchema>;
  let senderFacts: z.infer<typeof senderFactsSchema>;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    rootFacts = rootFactsSchema.parse(JSON.parse(decoder.decode(rootBytes)));
    joinFacts = joinFactsSchema.parse(JSON.parse(decoder.decode(joinBytes)));
    senderFacts = senderFactsSchema.parse(JSON.parse(decoder.decode(senderBytes)));
  } catch { throw new Error("GPT_IMAGE2_SOURCE_FACTS_INVALID"); }
  validatePositiveSourceJoin(rootFacts, joinFacts, senderFacts);

  const parent = generationContractRegistryV2Schema.parse(input.currentRegistry);
  if (parent.registry_sha256 !== PARENT_REGISTRY_SHA || parent.catalog_version !== PARENT_CATALOG_VERSION || parent.contracts.length !== 42 ||
      count(parent, "live_verified") !== 10 || count(parent, "reviewed") !== 32) throw new Error("GPT_IMAGE2_PARENT_REGISTRY_MISMATCH");
  if (parent.contracts.some((contract) => contract.variant_id === VARIANT_ID)) throw new Error("GPT_IMAGE2_VARIANT_ALREADY_EXISTS");
  const model = input.publicCatalog.getModel("gpt-image-2");
  const catalogVersion = `${model.fetched_at}.${model.source_hashes.models.slice(7, 19)}`;
  if (model.id !== "gpt-image-2" || model.upstream_id !== "gpt-image-2" || !model.active || model.ai_name !== "sora-images" ||
      !model.operations.some((operation) => operation.id === "generate-image" && operation.output_modality === "image") ||
      catalogVersion !== parent.catalog_version || model.source_hashes.ai !== parent.source_hashes.ai ||
      model.source_hashes.llm_models !== parent.source_hashes.llm_models || model.source_hashes.models !== parent.source_hashes.models ||
      model.source_hashes.models !== PUBLIC_MODELS_SHA) throw new Error("GPT_IMAGE2_PUBLIC_MODEL_BINDING_INVALID");

  const current = parent.contracts.find((contract) => contract.variant_id === "legacy-image-gpt-image-2.5-sunburst-default");
  const publicCatalogRef = current?.provenance.references.find((reference) => reference.kind === "public_catalog");
  if (!current || current.model_id !== "gpt-image-2.5-sunburst" || current.ai_name !== "sora-images" ||
      current.operation_id !== "generate-image" || current.modality !== "image" || current.route !== "design" ||
      current.provenance.settings_source_sha256 !== FORM_SHA || !publicCatalogRef?.sha256 ||
      !current.wire.prompt_field || current.wire.dispatch_action !== "generate-image" ||
      canonicalJson(current.wire.fixed_settings) !== canonicalJson({ aspect_ratio: "1:1", details_quality: "medium", quality: "1K" })) {
    throw new Error("GPT_IMAGE2_BASE_PROFILE_MISMATCH");
  }
  const candidate: GenerationContractV2Input = {
    variant_id: VARIANT_ID,
    model_id: "gpt-image-2",
    operation_id: "generate-image",
    modality: "image",
    route: "design",
    ai_name: "sora-images",
    model_type: "gpt-image-2",
    status: "reviewed",
    provenance: {
      settings_source_sha256: FORM_SHA,
      references: [
        publicCatalogRef,
        { kind: "frontend_static", reference: `${FORM_URL}; GPT Image 2-only details-quality/quality and current ratio controls`, sha256: FORM_SHA },
        { kind: "frontend_static", reference: `${HELPER_URL}; source-backed settings store keeps quality/details_quality keys and model_type`, sha256: HELPER_SHA },
        { kind: "manual_review", reference: `${ROOT_FACTS_PATH}; SHA-256=${ROOT_FACTS_SHA}; exact GPT Image 2 source choices and 10 ratio options; UI defaults omitted`, sha256: `sha256:${ROOT_FACTS_SHA}` },
        { kind: "manual_review", reference: `${JOIN_FACTS_PATH}; SHA-256=${JOIN_FACTS_SHA}; current model-specific store and source-bound model_type to standard sender join`, sha256: `sha256:${JOIN_FACTS_SHA}` },
        { kind: "manual_review", reference: `${SENDER_FACTS_PATH}; SHA-256=${SENDER_FACTS_SHA}; standard sender carries n:1 and selected settings without key renaming`, sha256: `sha256:${SENDER_FACTS_SHA}` },
        { kind: "manual_review", reference: `${PARENT_VERSION}; parent contract rows preserved byte-for-byte; reviewed profile is not live backend evidence.` }
      ],
      reviewed_at: input.reviewedAt
    },
    parameters: {
      type: "object", additional_properties: false,
      required: ["prompt", "aspect_ratio", "details_quality", "quality"],
      properties: {
        prompt: { type: "string", min_length: 1 },
        aspect_ratio: { type: "string", enum: [...RATIOS] },
        details_quality: { type: "string", enum: [...DETAILS] },
        quality: { type: "string", enum: [...QUALITIES] }
      },
      conditions: [], conditional_enums: []
    },
    wire: {
      ...current.wire,
      settings_fields: { aspect_ratio: "aspect_ratio", details_quality: "details_quality", quality: "quality" },
      fixed_settings: { n: 1, file_urls: [] }
    },
    output: { decoder_profile: current.output.decoder_profile, mime_types: ["image/jpeg", "image/png"] },
    limits: { ...current.limits, max_parameters: 4 }
  };
  const registry = createGenerationContractRegistryV2({
    schema_version: "2.0.0", catalog_version: parent.catalog_version, source_hashes: parent.source_hashes,
    contracts: [...parent.contracts.map(stripSchemaHash), candidate]
  });
  const oldContractsPreserved = parent.contracts.every((old) => {
    const retained = registry.contracts.find((contract) => contract.variant_id === old.variant_id);
    return retained !== undefined && canonicalJson(retained) === canonicalJson(old);
  });
  if (!oldContractsPreserved || registry.contracts.length !== 43 || count(registry, "live_verified") !== 10 || count(registry, "reviewed") !== 33) {
    throw new Error("GPT_IMAGE2_REGISTRY_INVARIANT_FAILED");
  }
  return Object.freeze({ registry, added_variant_id: VARIANT_ID });
}

export async function archiveGptImage2SourceProfileV2(
  result: GptImage2SourceProfileV2BuildResult,
  catalogDirectory?: string
): Promise<{ readonly version: string; readonly path: string; readonly status: "created" | "existing" }> {
  const checked = generationContractRegistryV2Schema.parse(result.registry);
  if (result.added_variant_id !== VARIANT_ID || checked.contracts.length !== 43 ||
      !checked.contracts.some((contract) => contract.variant_id === VARIANT_ID && contract.model_id === "gpt-image-2" && contract.status === "reviewed")) {
    throw new Error("GPT_IMAGE2_ARCHIVE_BINDING_INVALID");
  }
  return archiveGenerationContractRegistryV2(checked, catalogDirectory);
}

function validatePositiveSourceJoin(
  form: z.infer<typeof rootFactsSchema>,
  join: z.infer<typeof joinFactsSchema>,
  sender: z.infer<typeof senderFactsSchema>
): void {
  const declarations = new Map(form.declarations.map((declaration) => [declaration.name, declaration.text]));
  const detailsKey = declarations.get("d");
  const choicesText = declarations.get("F");
  const qualityText = declarations.get("h");
  const ratiosText = declarations.get("V");
  let choices: unknown;
  try {
    choices = JSON.parse(choicesText?.slice(choicesText.indexOf("=") + 1) ?? "");
  } catch { throw new Error("GPT_IMAGE2_FORM_CHOICES_INVALID"); }
  const qualities = qualityText?.match(/value:"([^"]+)"/gu)?.map((value) => value.slice(7, -1)) ?? null;
  const ratioMatch = /^V=u\(\(\)=>c\.value\?\[(.*?)\]:\[/u.exec(ratiosText ?? "");
  const sourceRatios = ratioMatch?.[1]?.match(/value:"([^"]+)"/gu)?.map((value) => value.slice(7, -1));
  const controls = form.controls.map((control) => control.text);
  const modelTypeAssignment = join.helper_assignments.some((assignment) => assignment.left === "e.settings.model_type" && assignment.right === "l" && assignment.operator === "FirstAssignment");
  const storeSettings = join.store_functions.some((fn) => fn.name === "o" && fn.text.includes("a.value=Wn.value"));
  const senderRow = sender.standard_sender[0];
  const senderTree = JSON.stringify(senderRow?.tree ?? null);
  const indexSource = sender.sources.find((source) => source.module_name === "index6.js");
  if (form.models_in_scope.length !== 1 || form.models_in_scope[0] !== "gpt-image-2" || detailsKey !== 'd="details_quality"' ||
      !choicesText?.startsWith("F=") || choices === null || typeof choices !== "object" || Array.isArray(choices) ||
      JSON.stringify((choices as Record<string, unknown>)["gpt-image-2"]) !== JSON.stringify(DETAILS) ||
      JSON.stringify(qualities) !== JSON.stringify(QUALITIES) ||
      JSON.stringify(sourceRatios) !== JSON.stringify(RATIOS) ||
      !controls.some((text) => text.includes("modelValue:t(e).settings.model_type")) ||
      !controls.some((text) => text.includes("modelValue:t(e).settings.aspect_ratio")) ||
      !controls.some((text) => text.includes("modelValue:t(e).settings[d]")) ||
      !controls.some((text) => text.includes("modelValue:t(e).settings.quality")) ||
      !form.setup_calls.some((call) => call.text.includes("T(o)") && call.text.includes("e.settings.quality=void 0") && call.text.includes("e.settings[d]=void 0")) ||
      !modelTypeAssignment || !storeSettings ||
      join.helper_assignments.some((assignment) => assignment.left === "e.settings.model_type" && assignment.right !== "l") ||
      senderRow?.module_name !== "index6.js" || senderRow.offset !== 5014 || indexSource?.sha256 !== "sha256:eb4fe700c7afae0756348aad3118c55ec8c9b5f5e5d18832045be07bbd368447" ||
      !senderTree.includes("SpreadAssignment") || join.derived_scope.sender_base_settings !== "{n:1,...appStore.settings}" ||
      !join.derived_scope.file_urls_appended_after_settings_selection || !join.derived_scope.setSettingsByModel_resets_page_metadata_and_custom_payload_to_null ||
      join.derived_scope.form_has_non_null_custom_payload_setter || !join.derived_scope.backend_values_not_live_verified ||
      join.app_source.sha256 !== APP_SHA || !join.app_source.cached_only || !join.app_source.no_refetch) {
    throw new Error("GPT_IMAGE2_SOURCE_WIRE_JOIN_INCOMPLETE");
  }
}

function stripSchemaHash(contract: GenerationContractRegistryV2["contracts"][number]): GenerationContractV2Input {
  const { schema_hash: _schemaHash, ...withoutHash } = contract;
  return withoutHash;
}

function count(registry: Pick<GenerationContractRegistryV2, "contracts">, status: "live_verified" | "reviewed"): number {
  return registry.contracts.filter((contract) => contract.status === status).length;
}

function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
