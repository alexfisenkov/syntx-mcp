import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { canonicalJson } from "../domain/generation-contract.js";
import {
  createGenerationContractRegistryV2,
  generationContractRegistryV2Schema,
  type GenerationContractRegistryV2,
  type GenerationContractV2Input
} from "../domain/generation-contract-v2.js";
import type { GenerationContractCatalogPort } from "../adapter/syntx/generation-contract-executor.js";
import { archiveGenerationContractRegistryV2 } from "./generation-contract-history-v2.js";

export interface BuildWan25T2iClientProfileV2Input {
  readonly currentRegistry: GenerationContractRegistryV2;
  readonly publicCatalog: GenerationContractCatalogPort;
  readonly formFactsBytes: Uint8Array;
  readonly sharedStoreJoinFactsBytes: Uint8Array;
  readonly helperFactsBytes: Uint8Array;
  readonly rootDecisionBytes: Uint8Array;
  readonly storeFactsBytes: Uint8Array;
  readonly senderFactsBytes: Uint8Array;
  readonly wireFactsBytes: Uint8Array;
  readonly settingsInventoryBytes: Uint8Array;
  readonly reviewedAt: string;
}
export interface Wan25T2iClientProfileV2BuildResult {
  readonly registry: GenerationContractRegistryV2;
  readonly added_variant_id: "wan-25-t2i-explicit-zero-reference-reviewed";
}

const PARENT_VERSION = "sha256-99a0dbcee376ef2184329762ea26a27519a9457f07e8b7878bffbd7bd77c341d.json";
const PARENT_REGISTRY_SHA = "sha256:e4c88e3eaf86e1f50e01f1ae5f71087d792a69a90a29b384586ef0d2f0e6884b";
const CATALOG_VERSION = "2026-10-08T13:18:39.393Z.36e6960df354";
const PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const PUBLIC_MODELS_SHA = "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444";
const FORM_URL = "https://syntx.ai/assets/1791467421/wan-image.js";
const SETTINGS_URL = "https://syntx.ai/assets/1791467421/settings3.js";
const FORM_SHA = "sha256:c1190674e29d4b943eaa3bfb3571a8716f4a9901de433fc423840aed393f11a3";
const APP_SHA = "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf";
const SETTINGS_SHA = "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe";
const VIDEO_SHA = "sha256:de1f4d8ddb8f79a909aad5a0e62c876995dbaada01946e395d62a3da7e62b2ae";
const INDEX_SHA = "sha256:eb4fe700c7afae0756348aad3118c55ec8c9b5f5e5d18832045be07bbd368447";
const FORM_FACTS_SHA = "2429e3da36175516a4ed2e785523de8f819340a2272891983d3f9ac13342c144";
const JOIN_FACTS_SHA = "5235c26e9d1542a72c59e44139e4d6a790f9800b5482b2fe7cf774391116625c";
const HELPER_FACTS_SHA = "ff617795f650e076083ffa25d7b60aa2f3889b1f52b21f039cffd955db39ecb0";
const POLICY_FACTS_SHA = "8de5f1f403ba40f57f41d51c7e9f7e77c02d71fb3ed02cd22002f973b5063ee9";
const STORE_FACTS_SHA = "64accdfce2b1e82a042b9ba3bceffa8586e02a1fcc043938ac21e464e4e49b0f";
const SENDER_FACTS_SHA = "6b595b45d9b8e6dbd3aeff8f833a13785d23efc1d571eaac5952f180954e54e9";
const WIRE_FACTS_SHA = "1c4ed576f5de0af51a7cb53d44df6ee5947e8152b49930995b6c64d1baa1e556";
const SETTINGS_INVENTORY_SHA = "00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61";
const MODEL_ID = "wan_25_t2i_preview";
const VARIANT_ID = "wan-25-t2i-explicit-zero-reference-reviewed";
const RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"] as const;
const RESOLUTIONS = ["720P", "1080P"] as const;
const FORM_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-196-wan-form-facts.json";
const JOIN_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-196b-wan-shared-store-join.json";
const HELPER_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-199-settings-helper-facts.json";
const POLICY_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-200-wan-client-policy-audit.json";
const STORE_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-132-gpt-image2-store-wire-join.json";
const SENDER_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-90-standard-photo-sender-facts.json";
const WIRE_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-155-ideogram-custom-payload-wire-facts.json";
const SETTINGS_INVENTORY_PATH = "catalog/settings/v2/sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json";
const CHAT_CLIENT_SHA = "sha256:f802ccec131f03a47dedb1a118c194f09b0fc16fc9925743a6b09a1aa9005dd5";
const IMAGE_OBSERVER_SHA = "sha256:52a920ddbe6808df8151a56efcdd512b05f81a976f351e88c188bc21293e5b97";

const formSchema = z.object({
  fetch: z.object({ url: z.literal(FORM_URL), bytes: z.literal(53_279), sha256: z.literal(FORM_SHA), status: z.literal(200), parse_diagnostics: z.literal(0) }).passthrough(),
  imports: z.array(z.string()), constants: z.array(z.object({ name: z.string(), source: z.string() }).passthrough()),
  declarations: z.array(z.object({ start: z.number(), name: z.string(), source: z.string() }).passthrough()),
  functions: z.array(z.object({ start: z.number(), source: z.string() }).passthrough()),
  calls: z.array(z.object({ start: z.number(), source: z.string() }).passthrough()),
  runtime_usable: z.literal(false), vendor_execution: z.literal(false), raw_source_retention: z.literal("RAM_ONLY")
}).passthrough();
const sharedJoinSchema = z.object({ schema_version: z.literal("ROOT_196B_WAN_SHARED_STORE_JOIN_V1"),
  form_import: z.literal("app.js b6 as ce"), form_store_declaration: z.literal("a=ce()"), app_export: z.literal("Zwe as b6"),
  app_sha256: z.literal(APP_SHA), app_cached_only: z.literal(true), form_setup_custom_payload_token_count: z.literal(0),
  checked_tokens: z.array(z.string()), settings_helper: z.string(), standard_sender_source: z.string(), ordinary_wire_source: z.string(),
  raw_source_persisted: z.literal(false), vendor_execution: z.literal(false), runtime_usable: z.literal(false) }).passthrough();
const helperSchema = z.object({
  schema_version: z.literal("ROOT_199_SETTINGS_HELPER_FACTS_V1"), runtime_usable: z.literal(false), vendor_execution: z.literal(false),
  fetch: z.object({ url: z.literal("https://syntx.ai/assets/1791467421/settings3.js"), bytes: z.literal(4_123), sha256: z.literal(SETTINGS_SHA), status: z.literal(200), requests: z.literal(1) }).passthrough(),
  functions: z.array(z.object({ name: z.string(), offset: z.number(), text: z.string() }).passthrough()),
  form_custom_payload_tokens: z.array(z.object({ token: z.string(), count: z.number() }).passthrough()),
  raw_source_retention: z.literal("RAM_ONLY")
}).passthrough();
const storeSchema = z.object({ schema_version: z.literal("ROOT_GPT2_STORE_WIRE_JOIN_V1"), runtime_usable: z.literal(false),
  helper_source: z.object({ url: z.literal("https://syntx.ai/assets/1791467421/settings3.js"), bytes: z.literal(4_123), sha256: z.literal(SETTINGS_SHA) }).passthrough(),
  app_source: z.object({ build_id: z.literal("1791467421"), sha256: z.literal(APP_SHA), cached_only: z.literal(true), no_refetch: z.literal(true) }).passthrough(),
  derived_scope: z.object({ setSettingsByModel_resets_page_metadata_and_custom_payload_to_null: z.literal(true),
    form_has_non_null_custom_payload_setter: z.literal(false), sender_base_settings: z.literal("{n:1,...appStore.settings}"),
    file_urls_appended_after_settings_selection: z.literal(true), backend_values_not_live_verified: z.literal(true), ui_choices_only: z.literal(true) }).passthrough()
}).passthrough();
const senderSchema = z.object({ schema_version: z.literal("1.0.0"), source_only: z.literal(true), backend_acceptance: z.literal(false), source_persisted: z.literal(false),
  sources: z.array(z.object({ module_name: z.string(), url: z.string(), bytes: z.number(), sha256: z.string() }).passthrough()),
  standard_sender: z.array(z.object({ module_name: z.string(), offset: z.number(), tree: z.unknown() }).passthrough()) }).passthrough();
const wireSchema = z.object({ schema_version: z.literal("ROOT_IDEOGRAM_CUSTOM_PAYLOAD_WIRE_V1"), runtime_usable: z.literal(false),
  source: z.object({ url: z.literal("https://syntx.ai/assets/1791467421/video.js"), bytes: z.literal(8_689), observed_sha256: z.literal(VIDEO_SHA) }).passthrough(),
  static_function_edge: z.object({ initial_settings: z.literal("let i={n:1,...s.settings}"), custom_branch_semantics: z.literal("TRUTHY_CUSTOM_REPLACES_SETTINGS_ENTIRELY_NOT_MERGED_NO_EXTRA_WIRE_FIELD"),
    request_object: z.literal("const u={chat_uuid:t,prompt:_,settings:i}"), dispatch: z.literal("L.post(design/generate,u,{params:{ai_name:o},...})"), n_default_retained_under_custom_branch: z.literal(false), backend_or_execution_proof: z.literal(false) }).passthrough()
}).passthrough();
const policySchema = z.object({ schema_version: z.literal("ROOT_200_WAN_T2I_CLIENT_POLICY_DECISION_V1"),
  explicit_no_reference_client_policy: z.object({
    required_parameters: z.object({ prompt: z.string(), aspect_ratio: z.array(z.string()), resolution: z.array(z.string()), prompt_extend: z.string() }).passthrough(),
    fixed_settings: z.object({ model_type: z.literal(MODEL_ID), seed: z.null(), batch_size: z.literal(1), bbox_list: z.array(z.unknown()), color_palette: z.null(), n: z.literal(1), file_urls: z.array(z.unknown()) }).passthrough(),
    color_palette_null_decision: z.string(), source_defaults_claimed: z.literal(false), provider_defaults_claimed: z.literal(false), backend_acceptance: z.literal(false)
  }).passthrough()
}).passthrough();
const inventorySchema = z.object({
  build: z.object({ id: z.literal("1791467421"), base_url: z.literal("https://syntx.ai/assets/1791467421/") }).passthrough(),
  public_catalog: z.object({ version: z.literal(PUBLIC_VERSION), models_sha256: z.literal(PUBLIC_MODELS_SHA) }).passthrough(),
  forms: z.array(z.object({ form_id: z.string(), module_name: z.string(), javascript: z.object({ url: z.string(), bytes: z.number(), sha256: z.string(), parse_diagnostics: z.number() }).passthrough() }).passthrough()),
  models: z.array(z.object({ model_id: z.string(), ai_name: z.string(), active: z.boolean(), form_id: z.string().nullable(), form_binding_status: z.string(), model_value_settings_keys: z.array(z.string()), defaults_status: z.string(), static_setting_defaults: z.record(z.string(), z.unknown()), settings: z.record(z.string(), z.unknown()).nullable() }).passthrough())
}).passthrough();

export function buildWan25T2iClientProfileV2(input: BuildWan25T2iClientProfileV2Input): Wan25T2iClientProfileV2BuildResult {
  const facts = [input.formFactsBytes, input.sharedStoreJoinFactsBytes, input.helperFactsBytes, input.rootDecisionBytes,
    input.storeFactsBytes, input.senderFactsBytes, input.wireFactsBytes, input.settingsInventoryBytes].map((value) => Buffer.from(value));
  const expectedHashes = [FORM_FACTS_SHA, JOIN_FACTS_SHA, HELPER_FACTS_SHA, POLICY_FACTS_SHA,
    STORE_FACTS_SHA, SENDER_FACTS_SHA, WIRE_FACTS_SHA, SETTINGS_INVENTORY_SHA];
  const caps = [64_000, 8_192, 10_000, 8_192, 10_000, 140_000, 8_192, 400_000];
  if (facts.some((bytes, index) => bytes.byteLength > caps[index]! || sha256(bytes) !== expectedHashes[index])) throw new Error("WAN25_T2I_SOURCE_FACTS_HASH_INVALID");
  if (!Number.isFinite(Date.parse(input.reviewedAt))) throw new Error("WAN25_T2I_REVIEW_TIME_INVALID");
  let form: z.infer<typeof formSchema>; let shared: z.infer<typeof sharedJoinSchema>; let helper: z.infer<typeof helperSchema>;
  let policy: z.infer<typeof policySchema>; let store: z.infer<typeof storeSchema>; let sender: z.infer<typeof senderSchema>;
  let wire: z.infer<typeof wireSchema>; let inventory: z.infer<typeof inventorySchema>;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    form = formSchema.parse(parse(facts[0]!, decoder)); shared = sharedJoinSchema.parse(parse(facts[1]!, decoder));
    helper = helperSchema.parse(parse(facts[2]!, decoder)); policy = policySchema.parse(parse(facts[3]!, decoder));
    store = storeSchema.parse(parse(facts[4]!, decoder)); sender = senderSchema.parse(parse(facts[5]!, decoder));
    wire = wireSchema.parse(parse(facts[6]!, decoder)); inventory = inventorySchema.parse(parse(facts[7]!, decoder));
  } catch { throw new Error("WAN25_T2I_SOURCE_FACTS_INVALID"); }
  validateJoin(form, shared, helper, policy, store, sender, wire, inventory);

  const parent = generationContractRegistryV2Schema.parse(input.currentRegistry);
  if (parent.registry_sha256 !== PARENT_REGISTRY_SHA ||
      parent.catalog_version !== CATALOG_VERSION || parent.contracts.length !== 51 || count(parent, "live_verified") !== 13 || count(parent, "reviewed") !== 38 ||
      parent.contracts.some((entry) => entry.model_id === MODEL_ID || entry.variant_id === VARIANT_ID)) throw new Error("WAN25_T2I_PARENT_REGISTRY_MISMATCH");
  const historical = parent.contracts.find((entry) => entry.variant_id === "legacy-image-wan_26_t2i-default");
  if (!historical || historical.model_id !== "wan_26_t2i" || historical.model_type !== "wan_26_t2i" || historical.status !== "reviewed") {
    throw new Error("WAN25_T2I_HISTORICAL_PROFILE_BINDING_INVALID");
  }
  const publicModelsRef = historical.provenance.references.find((ref) => ref.kind === "public_catalog");
  if (!publicModelsRef?.sha256) throw new Error("WAN25_T2I_PUBLIC_CATALOG_REFERENCE_MISSING");

  let model;
  try { model = input.publicCatalog.getModel(MODEL_ID); }
  catch { throw new Error("WAN25_T2I_PUBLIC_MODEL_BINDING_INVALID"); }
  const publicCatalogVersion = `${model.fetched_at}.${model.source_hashes.models.slice(7, 19)}`;
  if (model.id !== MODEL_ID || model.upstream_id !== MODEL_ID || model.ai_name !== "wan_image" || model.active !== true ||
      !model.operations.some((op) => op.id === "generate-image" && op.output_modality === "image") || publicCatalogVersion !== CATALOG_VERSION ||
      model.source_hashes.ai !== parent.source_hashes.ai || model.source_hashes.llm_models !== parent.source_hashes.llm_models ||
      model.source_hashes.models !== PUBLIC_MODELS_SHA || model.source_hashes.models !== parent.source_hashes.models) {
    throw new Error("WAN25_T2I_PUBLIC_MODEL_BINDING_INVALID");
  }

  const candidate: GenerationContractV2Input = {
    variant_id: VARIANT_ID, model_id: MODEL_ID, operation_id: "generate-image", modality: "image", route: "design",
    ai_name: "wan_image", model_type: MODEL_ID, status: "reviewed",
    provenance: {
      settings_source_sha256: FORM_SHA,
      references: [
        { kind: "public_catalog", reference: `${PUBLIC_VERSION}; exact wan_25_t2i_preview active/model-value/ai_name binding`, sha256: PUBLIC_MODELS_SHA },
        { kind: "frontend_static", reference: `${FORM_URL}; Wan image form source mapping, no-reference T2I guard, explicit ratios and resolutions`, sha256: FORM_SHA },
        { kind: "frontend_static", reference: `${SETTINGS_INVENTORY_PATH}; current form/model structural binding and listed setting key names; defaults remain UNKNOWN`, sha256: `sha256:${SETTINGS_INVENTORY_SHA}` },
        { kind: "manual_review", reference: "src/adapter/syntx/chat-http-client.ts; JPEG/PNG local client admission only", sha256: CHAT_CLIENT_SHA },
        { kind: "manual_review", reference: "src/adapter/syntx/owned-image-artifact-observer.ts; JPEG/PNG local codec support only", sha256: IMAGE_OBSERVER_SHA },
        { kind: "manual_review", reference: `${FORM_FACTS_PATH}; SHA-256=${FORM_FACTS_SHA}; model selector, branch guard, current T2I controls and store key`, sha256: `sha256:${FORM_FACTS_SHA}` },
        { kind: "manual_review", reference: `${JOIN_FACTS_PATH}; SHA-256=${JOIN_FACTS_SHA}; app-store join and custom payload census`, sha256: `sha256:${JOIN_FACTS_SHA}` },
        { kind: "manual_review", reference: `${HELPER_FACTS_PATH}; SHA-256=${HELPER_FACTS_SHA}; settings3 model binding, reset and palette-field preservation policy`, sha256: `sha256:${HELPER_FACTS_SHA}` },
        { kind: "manual_review", reference: `${POLICY_FACTS_PATH}; SHA-256=${POLICY_FACTS_SHA}; explicit client palette-null/no-reference intent, not UI or backend default`, sha256: `sha256:${POLICY_FACTS_SHA}` },
        { kind: "manual_review", reference: `${STORE_FACTS_PATH}; SHA-256=${STORE_FACTS_SHA}; shared-store/custom-payload helper semantics`, sha256: `sha256:${STORE_FACTS_SHA}` },
        { kind: "manual_review", reference: `${SENDER_FACTS_PATH}; SHA-256=${SENDER_FACTS_SHA}; standard sender shared app store and n=1 base`, sha256: `sha256:${SENDER_FACTS_SHA}` },
        { kind: "manual_review", reference: `${WIRE_FACTS_PATH}; SHA-256=${WIRE_FACTS_SHA}; ordinary request settings envelope and empty-file canonicalizer`, sha256: `sha256:${WIRE_FACTS_SHA}` },
        { kind: "manual_review", reference: "Client policy is explicit, reviewed-only, and does not claim cached native UI state or backend acceptance." },
        { kind: "manual_review", reference: `${PARENT_VERSION}; exact 51-row parent retained, no profile promotion.` }
      ],
      reviewed_at: input.reviewedAt
    },
    parameters: {
      type: "object", additional_properties: false,
      required: ["prompt", "aspect_ratio", "resolution", "prompt_extend"],
      properties: {
        prompt: { type: "string", min_length: 1 },
        aspect_ratio: { type: "string", enum: [...RATIOS] },
        resolution: { type: "string", enum: [...RESOLUTIONS] },
        prompt_extend: { type: "boolean" }
      }, conditions: [], conditional_enums: []
    },
    wire: {
      dispatch_action: "generate-image", input_kind: "prompt", prompt_field: "prompt",
      settings_fields: { aspect_ratio: "aspect_ratio", resolution: "resolution", prompt_extend: "prompt_extend" },
      fixed_settings: { seed: null, batch_size: 1, bbox_list: [], color_palette: null, n: 1, file_urls: [] },
      media_reference_fields: {}
    },
    // Local client/codec allowlist only; no Wan provider output format is claimed.
    output: { decoder_profile: historical.output.decoder_profile, mime_types: ["image/jpeg", "image/png"] },
    limits: { ...historical.limits, max_parameters: 4 }
  };
  const registry = createGenerationContractRegistryV2({ schema_version: "2.0.0", catalog_version: parent.catalog_version,
    source_hashes: parent.source_hashes, contracts: [...parent.contracts.map(stripSchemaHash), candidate] });
  const exactParent = parent.contracts.every((old) => {
    const retained = registry.contracts.find((entry) => entry.variant_id === old.variant_id);
    return retained !== undefined && canonicalJson(retained) === canonicalJson(old);
  });
  if (!exactParent || registry.contracts.length !== 52 || count(registry, "live_verified") !== 13 || count(registry, "reviewed") !== 39) {
    throw new Error("WAN25_T2I_REGISTRY_INVARIANT_FAILED");
  }
  return Object.freeze({ registry, added_variant_id: VARIANT_ID });
}

export async function archiveWan25T2iClientProfileV2(result: Wan25T2iClientProfileV2BuildResult, catalogDirectory?: string): Promise<{
  readonly version: string; readonly path: string; readonly status: "created" | "existing"
}> {
  const checked = generationContractRegistryV2Schema.parse(result.registry);
  if (result.added_variant_id !== VARIANT_ID || checked.contracts.length !== 52 ||
      !checked.contracts.some((entry) => entry.variant_id === VARIANT_ID && entry.model_id === MODEL_ID && entry.status === "reviewed")) {
    throw new Error("WAN25_T2I_ARCHIVE_BINDING_INVALID");
  }
  return archiveGenerationContractRegistryV2(checked, catalogDirectory);
}

function validateJoin(
  form: z.infer<typeof formSchema>, shared: z.infer<typeof sharedJoinSchema>, helper: z.infer<typeof helperSchema>,
  policy: z.infer<typeof policySchema>, store: z.infer<typeof storeSchema>, sender: z.infer<typeof senderSchema>,
  wire: z.infer<typeof wireSchema>, inventory: z.infer<typeof inventorySchema>
): void {
  const declarations = new Map(form.declarations.map((d) => [d.name, d.source]));
  const calls = new Map(form.calls.map((c) => [c.start, c.source]));
  const constants = new Map(form.constants.map((d) => [d.name, d.source]));
  const inventoryForm = inventory.forms.find((entry) => entry.form_id === "wan-image");
  const inventoryModel = inventory.models.find((entry) => entry.model_id === MODEL_ID);
  const helperK = helper.functions.find((fn) => fn.name === "K")?.text ?? "";
  const zeroLoraPolicy = policy.explicit_no_reference_client_policy;
  if (form.fetch.sha256 !== FORM_SHA || !form.imports.some((v) => v.includes('b6 as ce') && v.includes("./app.js")) ||
      !form.imports.some((v) => v.includes('u as we') && v.includes("./video.js")) ||
      !form.imports.some((v) => v.includes('u as Ce') && v.includes("./settings3.js")) ||
      constants.get("It") !== 'It="wan_image"' || declarations.get("g") !== 'g={model_type:r,aspect_ratio:"1:1",get resolution(){return d(a.settings.model_type??r)},seed:null,batch_size:1,prompt_extend:!1,bbox_list:[],color_palette:null}' ||
      declarations.get("t") !== 't=["wan_26_image","wan_25_i2i_preview"]' ||
      declarations.get("e") !== 'e=["wan_27_image","wan_27_image_pro"]' ||
      !declarations.get("it")?.includes('A.value==="wan_26_image"?["1:1","2:3","3:2","3:4","4:3","9:16","16:9","21:9"]') ||
      !declarations.get("it")?.includes(': ["1:1","3:4","4:3","9:16","16:9"]') && !declarations.get("it")?.includes(':["1:1","3:4","4:3","9:16","16:9"]') ||
      declarations.get("wt") !== 'wt=$(()=>{let k;return W.value?k=["1K","2K","4K"]:F.value?k=["1K","2K"]:A.value==="wan_25_i2i_preview"?k=["720P"]:k=["720P","1080P"],k.map(I=>({label:I,value:I,disabled:I==="4K"&&G.value}))})' ||
      declarations.get("St") !== 'St=[1,2,3,4].map(k=>({label:String(k),value:k}))' ||
      !calls.get(48042)?.includes('a.settings.batch_size===void 0&&(a.settings.batch_size=1)') ||
      !calls.get(48042)?.includes('a.settings.prompt_extend===void 0&&(a.settings.prompt_extend=!1)') ||
      !calls.get(48042)?.includes('a.settings.bbox_list=[]') ||
      !declarations.get("Lt")?.includes('N.value?s.files.length>=1:!0') ||
      !calls.get(47744)?.includes('G.value&&a.settings.resolution==="4K"&&(a.settings.resolution="2K")') ||
      shared.form_import !== "app.js b6 as ce" || shared.form_store_declaration !== "a=ce()" || shared.app_export !== "Zwe as b6" ||
      shared.app_sha256 !== APP_SHA || shared.app_cached_only !== true || shared.form_setup_custom_payload_token_count !== 0 ||
      !shared.checked_tokens.includes("customPayload") || !shared.checked_tokens.includes("setCustomPayload") ||
      helper.fetch.sha256 !== SETTINGS_SHA || helper.fetch.url !== SETTINGS_URL ||
      !helperK.includes("setSettingsByModel:s=>{if(!s)return") || !helperK.includes("e.resetPageSettings()") ||
      !helperK.includes("t&&Object.keys(t).forEach(i=>{switch(i)") || helper.form_custom_payload_tokens.some((entry) => entry.count !== 0) ||
      !store.derived_scope.setSettingsByModel_resets_page_metadata_and_custom_payload_to_null || store.derived_scope.form_has_non_null_custom_payload_setter ||
      store.derived_scope.sender_base_settings !== "{n:1,...appStore.settings}" || !store.derived_scope.file_urls_appended_after_settings_selection ||
      !sender.sources.some((entry) => entry.module_name === "index6.js" && entry.sha256 === INDEX_SHA) ||
      !sender.standard_sender.some((entry) => entry.module_name === "index6.js" && entry.offset === 5_014 && JSON.stringify(entry.tree).includes("SpreadAssignment")) || sender.backend_acceptance ||
      wire.source.observed_sha256 !== "sha256:de1f4d8ddb8f79a909aad5a0e62c876995dbaada01946e395d62a3da7e62b2ae" || wire.static_function_edge.request_object !== "const u={chat_uuid:t,prompt:_,settings:i}" || wire.static_function_edge.n_default_retained_under_custom_branch ||
      inventory.build.id !== "1791467421" || inventory.public_catalog.version !== PUBLIC_VERSION ||
      !inventoryForm || inventoryForm.javascript.sha256 !== FORM_SHA ||
      !inventoryModel || inventoryModel.ai_name !== "wan_image" || inventoryModel.form_id !== "wan-image" || inventoryModel.defaults_status !== "UNKNOWN" ||
      inventoryModel.model_value_settings_keys.includes("color_palette") ||
      JSON.stringify(zeroLoraPolicy.required_parameters.aspect_ratio) !== JSON.stringify(RATIOS) ||
      JSON.stringify(zeroLoraPolicy.required_parameters.resolution) !== JSON.stringify(RESOLUTIONS) ||
      zeroLoraPolicy.fixed_settings.color_palette !== null || zeroLoraPolicy.fixed_settings.seed !== null ||
      zeroLoraPolicy.source_defaults_claimed || zeroLoraPolicy.provider_defaults_claimed || zeroLoraPolicy.backend_acceptance) {
    throw new Error("WAN25_T2I_SOURCE_WIRE_JOIN_INCOMPLETE");
  }
}

function parse(bytes: Buffer, decoder: TextDecoder): unknown { return JSON.parse(decoder.decode(bytes)); }
function stripSchemaHash(contract: GenerationContractRegistryV2["contracts"][number]): GenerationContractV2Input {
  const { schema_hash: _schemaHash, ...withoutHash } = contract;
  return withoutHash;
}
function count(registry: Pick<GenerationContractRegistryV2, "contracts">, status: "live_verified" | "reviewed"): number {
  return registry.contracts.filter((entry) => entry.status === status).length;
}
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
