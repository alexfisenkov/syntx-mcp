import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { archiveGenerationContractRegistryV2, loadGenerationContractRegistryV2 } from "../src/catalog/generation-contract-history-v2.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { loadMaplessSettingsInventoryVersion, type MaplessSettingsInventory } from "../src/catalog/mapless-settings-inventory.js";
import type { SyntxPublicCatalogSnapshot } from "../src/catalog/syntx-public-catalog.js";
import { bananaConditionalSettingsArtifactSchema, type BananaConditionalSettingsArtifact } from "./banana-conditional-settings.js";
import {
  createGenerationContractRegistryV2,
  type GenerationContractRegistryV2,
  type GenerationContractV2Input,
  generationContractRegistryV2Schema
} from "../src/domain/generation-contract-v2.js";

export interface BuildConfigurableBananaV2Input {
  readonly reviewedAt: string;
  readonly catalogDirectory?: string;
}

export interface BuildConfigurableBananaV2Result {
  readonly registry: GenerationContractRegistryV2;
  readonly base_contract_count: number;
  readonly added_contract_ids: readonly string[];
  readonly reviewed_contract_count: number;
  readonly live_contract_count: number;
}

const BASE_REGISTRY_VERSION = "sha256-5b2c4b8554f99cf7735defcefb006a246d7ae602756f23d6dca309df2125b602.json";
const PUBLIC_CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const SETTINGS_INVENTORY_VERSION = "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json";
const CANDIDATE_PATH = "runtime/v19/banana-conditional-settings-v1.0.0.json";
const CANDIDATE_SHA = "sha256:9458bd83ce4091fc7a1bac333e45012ef1951ff0aaa5524788865c0ea8d12f1b";
const FORM_CONTROL_PATH = "runtime/v11/static-form-control-analysis-v1.6-e5517ee5-87e96b78-26627f87a943cc9a.json";
const FORM_CONTROL_SHA = "sha256:26627f87a943cc9a2a40ca159217f3e2e7f26232d58a9d5d5b9469d05d43ec50";
const IMAGE_FLOW_PATH = "runtime/v16/sha256-e355acee34bcd0e923bcaafeec0336580dd2da5f1d367cff35296a291fb60310.json";
const IMAGE_FLOW_SHA = "sha256:e355acee34bcd0e923bcaafeec0336580dd2da5f1d367cff35296a291fb60310";
const NATIVE_REQUEST_PATH = "runtime/v12/owner-observed-banana-2.1-1k-minimal.json";
const NATIVE_REQUEST_SHA = "sha256:0790f114bfd89eb033132d7b7c8c68a82590a55ef91fa6e07f5f49d90310d4bf";
const FORM_SHA = "sha256:b66e233dc1ad667fc128b25c19255458ce51fe4bf6e4648d3848b27b402c1c1e";
const MODEL_IDS = ["banana", "banana-2.1", "banana2", "banana3", "banana3_light"] as const;
const EXPECTED_ASPECT_RATIOS = [null, "21:9", "16:9", "9:16", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "1:1"] as const;

export function buildConfigurableBananaGenerationContractsV2(input: BuildConfigurableBananaV2Input): BuildConfigurableBananaV2Result {
  if (!Number.isFinite(Date.parse(input.reviewedAt))) throw new Error("BANANA_V2_REVIEW_TIME_INVALID");
  const root = resolve(input.catalogDirectory ?? join(process.cwd(), "catalog"));
  const base = loadGenerationContractRegistryV2(BASE_REGISTRY_VERSION, root);
  const snapshot = loadPublicCatalogVersion(PUBLIC_CATALOG_VERSION, root);
  const inventory = loadMaplessSettingsInventoryVersion(SETTINGS_INVENTORY_VERSION, root);
  const candidateBytes = readPinnedFile(root, CANDIDATE_PATH, CANDIDATE_SHA);
  const candidateFacts = bananaConditionalSettingsArtifactSchema.parse(JSON.parse(candidateBytes.toString("utf8")));
  const ratioBytes = readPinnedFile(root, FORM_CONTROL_PATH, FORM_CONTROL_SHA);
  const ratioArtifact = parseJson(ratioBytes);
  const imageFlow = parsePinnedJson(root, IMAGE_FLOW_PATH, IMAGE_FLOW_SHA);
  const nativeRequest = parsePinnedJson(root, NATIVE_REQUEST_PATH, NATIVE_REQUEST_SHA);
  validatePinnedInputs(base, snapshot, inventory, candidateFacts, ratioArtifact, imageFlow, nativeRequest);

  const existingByModel = new Map<string, GenerationContractV2Input>();
  const baseContracts: GenerationContractV2Input[] = base.contracts.map(({ schema_hash: _schemaHash, ...contract }) => {
    if (contract.operation_id === "generate-image" && contract.ai_name === "banana") existingByModel.set(contract.model_id, contract);
    return contract;
  });
  const contracts: GenerationContractV2Input[] = [...baseContracts];
  const added: string[] = [];
  for (const modelId of MODEL_IDS) {
    const model = snapshot.models.find((entry) => entry.value === modelId);
    if (!model || model.active !== true || model.ai_name !== "banana") throw new Error("BANANA_V2_PUBLIC_MODEL_BINDING_INVALID");
    const inventoryModel = inventory.models.find((entry) => entry.model_id === modelId);
    if (!inventoryModel || !inventoryModel.active || inventoryModel.ai_name !== "banana" || inventoryModel.form_id !== "banana" ||
        inventoryModel.form_binding_status !== "STRUCTURAL_MATCH" ||
        !["model_type", "aspect_ratio", "image_size", "thinking_level"].every((field) => inventoryModel.model_value_settings_keys.includes(field))) {
      throw new Error("BANANA_V2_INVENTORY_MODEL_BINDING_INVALID");
    }
    const candidate = candidateFacts.model_candidates.find((entry) => entry.model_id === modelId);
    if (!candidate || candidate.ai_name !== "banana" || candidate.operation_id !== "generate-image") throw new Error("BANANA_V2_CANDIDATE_BINDING_INVALID");
    const aspectField = candidate.field_evidence.aspect_ratio;
    if (aspectField.status !== "EXISTING_STATIC_EVIDENCE_REFERENCE" || aspectField.evidence_ref === null) throw new Error("BANANA_V2_RATIO_EVIDENCE_MISSING");
    const ratioControl = ratioArtifact.forms?.find((entry: any) => entry.form_id === "banana")?.controls?.find((entry: any) => entry.field === "aspect_ratio");
    const aspectRatios = Array.isArray(ratioControl?.option_values) ? ratioControl.option_values.map((entry: any) => entry.value) : [];
    if (JSON.stringify(aspectRatios) !== JSON.stringify(EXPECTED_ASPECT_RATIOS) || ratioControl.value_type !== "string" || ratioControl.options_nullable !== true) {
      throw new Error("BANANA_V2_RATIO_CHOICES_INVALID");
    }
    const imageField = candidate.field_evidence.image_size;
    const thinkingField = candidate.field_evidence.thinking_level;
    const hasImageSize = imageField.status === "CONTROL_PRESENT";
    const hasThinking = thinkingField.status === "CONTROL_PRESENT";
    const imageSizes = hasImageSize ? [...imageField.allowed_values] : [];
    const thinkingLevels = hasThinking ? [...thinkingField.allowed_values] : [];
    if ((hasImageSize && imageSizes.length === 0) || (hasThinking && thinkingLevels.length === 0) ||
        (modelId === "banana" && (hasImageSize || hasThinking)) || (modelId === "banana-2.1" && !hasThinking) ||
        (modelId !== "banana-2.1" && hasThinking)) throw new Error("BANANA_V2_FIELD_PRESENCE_INVALID");

    const properties: GenerationContractV2Input["parameters"]["properties"] = {
      prompt: { type: "string", min_length: 1 },
      aspect_ratio: { type: "string", nullable: true, enum: [...aspectRatios] as (string | null)[] }
    };
    const required = ["prompt", "aspect_ratio"];
    const settingsFields: Record<string, string> = { aspect_ratio: "aspect_ratio" };
    if (hasImageSize) {
      properties.image_size = { type: "string", enum: imageSizes };
      required.push("image_size");
      settingsFields.image_size = "image_size";
    }
    if (hasThinking) {
      properties.thinking_level = { type: "string", enum: thinkingLevels };
      required.push("thinking_level");
      settingsFields.thinking_level = "thinking_level";
    }
    const baseModelContract = existingByModel.get(modelId);
    const output = modelId === "banana-2.1" || modelId === "banana"
      ? baseModelContract?.output
      : { decoder_profile: "syntx-owner-image-png", mime_types: ["image/png", "image/jpeg"] };
    if (!output) throw new Error("BANANA_V2_BASE_OUTPUT_MISSING");
    const variantId = `banana-ui-reviewed-${modelId}`;
    if (base.contracts.some((entry) => entry.model_id === modelId && entry.operation_id === "generate-image" && entry.variant_id === variantId)) {
      throw new Error("BANANA_V2_VARIANT_ALREADY_EXISTS");
    }
    contracts.push({
      variant_id: variantId,
      model_id: modelId,
      operation_id: "generate-image",
      modality: "image",
      route: "design",
      ai_name: "banana",
      model_type: modelId,
      status: "reviewed",
      provenance: {
        settings_source_sha256: FORM_SHA,
        references: [
          { kind: "public_catalog", reference: `catalog/public/${PUBLIC_CATALOG_VERSION}; exact model value/active/ai_name binding`, sha256: snapshot.sources.models.canonical_sha256 },
          { kind: "frontend_static", reference: `catalog/settings/v2/${SETTINGS_INVENTORY_VERSION}; active form/model binding`, sha256: FORM_SHA },
          { kind: "frontend_static", reference: `catalog/runtime/v19/banana-conditional-settings-v1.0.0.json; source-derived UI choices only`, sha256: CANDIDATE_SHA },
          { kind: "frontend_static", reference: `${FORM_CONTROL_PATH}; nullable aspect-ratio option list`, sha256: FORM_CONTROL_SHA },
          { kind: "manual_review", reference: `${IMAGE_FLOW_PATH}; historical build 1791445568 flow corroboration only, not current app-flow proof`, sha256: IMAGE_FLOW_SHA },
          { kind: "manual_review", reference: `Task35 curated V2 candidate; explicit choices required, UI defaults omitted; reviewedAt=${input.reviewedAt}` },
          { kind: "manual_review", reference: `${NATIVE_REQUEST_PATH}; exact key-name corroboration for banana-2.1 only; not generalized as live proof`, sha256: NATIVE_REQUEST_SHA },
          ...(modelId !== "banana" && modelId !== "banana-2.1" ? [{ kind: "manual_review" as const, reference: "Output MIME allowlist image/png,image/jpeg is a bounded shared media-service probe policy, not a source-derived or live-verified format claim." }] : [])
        ],
        reviewed_at: input.reviewedAt
      },
      parameters: { type: "object", additional_properties: false, required, properties, conditions: [], conditional_enums: [] },
      wire: {
        dispatch_action: "generate-image",
        input_kind: "prompt",
        prompt_field: "prompt",
        settings_fields: settingsFields,
        fixed_settings: { n: 1, file_urls: [] },
        media_reference_fields: {}
      },
      output,
      limits: { max_parameters: required.length, max_value_depth: 4, max_serialized_bytes: 131_072, max_normalized_nodes: 20_000 }
    });
    added.push(variantId);
  }

  const registry = createGenerationContractRegistryV2({
    schema_version: "2.0.0",
    catalog_version: base.catalog_version,
    source_hashes: base.source_hashes,
    contracts
  });
  const preserved = registry.contracts.filter((contract) => base.contracts.some((old) => old.variant_id === contract.variant_id));
  if (preserved.length !== base.contracts.length || preserved.some((entry) => {
    const old = base.contracts.find((candidate) => candidate.variant_id === entry.variant_id);
    return !old || JSON.stringify(entry) !== JSON.stringify(old);
  })) throw new Error("BANANA_V2_BASE_CONTRACTS_CHANGED");
  if (registry.contracts.length !== 38 || registry.contracts.filter((contract) => contract.status === "live_verified").length !== 4 || registry.contracts.filter((contract) => contract.status === "reviewed").length !== 34) {
    throw new Error("BANANA_V2_REGISTRY_COUNTS_INVALID");
  }
  generationContractRegistryV2Schema.parse(registry);
  return { registry, base_contract_count: base.contracts.length, added_contract_ids: added, reviewed_contract_count: 34, live_contract_count: 4 };
}

export async function archiveConfigurableBananaGenerationContractsV2(input: BuildConfigurableBananaV2Input): Promise<BuildConfigurableBananaV2Result & { readonly archive: { readonly version: string; readonly path: string; readonly status: "created" | "existing" } }> {
  const result = buildConfigurableBananaGenerationContractsV2(input);
  const archive = await archiveGenerationContractRegistryV2(result.registry, input.catalogDirectory);
  return { ...result, archive };
}

function validatePinnedInputs(
  base: GenerationContractRegistryV2,
  snapshot: SyntxPublicCatalogSnapshot,
  inventory: MaplessSettingsInventory,
  candidate: BananaConditionalSettingsArtifact,
  ratioArtifact: any,
  imageFlow: any,
  nativeRequest: any
): void {
  const modelsHash = snapshot.sources.models.canonical_sha256;
  const expectedCatalogVersion = `${snapshot.fetched_at}.${modelsHash.slice(7, 19)}`;
  if (base.contracts.length !== 33 || base.catalog_version !== expectedCatalogVersion || base.source_hashes.models !== modelsHash ||
      snapshot.fetched_at !== "2026-10-08T13:18:39.393Z" || modelsHash !== "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444" ||
      inventory.build.id !== "1791467421" || inventory.public_catalog.version !== PUBLIC_CATALOG_VERSION || inventory.forms.find((form) => form.form_id === "banana")?.javascript.sha256 !== FORM_SHA ||
      candidate.runtime_usable !== false || candidate.source_build_id !== inventory.build.id || candidate.settings_inventory_version !== SETTINGS_INVENTORY_VERSION) throw new Error("BANANA_V2_SOURCE_BINDING_INVALID");
  const currentIds = inventory.models.filter((model) => model.active && model.ai_name === "banana" && model.form_id === "banana").map((model) => model.model_id).sort();
  if (JSON.stringify(currentIds) !== JSON.stringify([...MODEL_IDS].sort()) || JSON.stringify(candidate.form_binding.model_ids.slice().sort()) !== JSON.stringify([...MODEL_IDS].sort())) throw new Error("BANANA_V2_MODEL_SET_INVALID");
  const ratioForm = ratioArtifact.forms?.find((form: any) => form.form_id === "banana");
  const ratioControl = ratioForm?.controls?.find((control: any) => control.field === "aspect_ratio");
  const choices = ratioControl?.option_values?.map((choice: any) => choice.value);
  if (JSON.stringify(choices) !== JSON.stringify([null, "21:9", "16:9", "9:16", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "1:1"]) || ratioForm.source_sha256 !== FORM_SHA ||
      ratioControl.options_nullable !== true || ratioControl.value_type !== "string") throw new Error("BANANA_V2_RATIO_SOURCE_INVALID");
  const flow = imageFlow.route_handoff;
  if (imageFlow.target_form?.source_sha256 !== FORM_SHA || flow?.route !== "design/generate" || flow.settings_source !== "APP_STORE_SETTINGS_WITH_TRUTHY_CUSTOM_PAYLOAD_OVERRIDE" ||
      flow.settings_overwrite_guard !== "CONDITIONAL_LOGICAL_AND_TRUTHY" || flow.base_settings_seed_n !== 1 || flow.file_urls_overwritten_after_settings !== true) throw new Error("BANANA_V2_IMAGE_FLOW_SOURCE_INVALID");
  const nativeSettings = nativeRequest.observation?.request_sequence?.find((item: any) => item.phase === "DISPATCH_GENERATION")?.body?.settings;
  const expectedNative = { n: 1, model_type: "banana-2.1", aspect_ratio: "1:1", image_size: "1K", thinking_level: "minimal", file_urls: [] };
  if (JSON.stringify(nativeSettings) !== JSON.stringify(expectedNative)) throw new Error("BANANA_V2_NATIVE_REQUEST_SOURCE_INVALID");
}

function readPinnedJson(root: string, relativePath: string, expectedSha256: string): unknown {
  return parseJson(readPinnedFile(root, relativePath, expectedSha256));
}

function parsePinnedJson(root: string, relativePath: string, expectedSha256: string): any {
  return readPinnedJson(root, relativePath, expectedSha256);
}

function parseJson(bytes: Buffer): any {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("BANANA_V2_EVIDENCE_JSON_INVALID"); }
}

function readPinnedFile(root: string, relativePath: string, expectedSha256: string): Buffer {
  const path = join(root, relativePath);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 1 || stat.size > 2 * 1024 * 1024) throw new Error("BANANA_V2_EVIDENCE_FILE_INVALID");
  const bytes = readFileSync(path);
  if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== expectedSha256) throw new Error("BANANA_V2_EVIDENCE_HASH_MISMATCH");
  return bytes;
}
