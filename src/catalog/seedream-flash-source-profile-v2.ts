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

export interface BuildSeedreamFlashSourceProfileV2Input {
  readonly currentRegistry: GenerationContractRegistryV2;
  readonly publicCatalog: GenerationContractCatalogPort;
  readonly formFactsBytes: Uint8Array;
  readonly helperFactsBytes: Uint8Array;
  readonly storeWireJoinFactsBytes: Uint8Array;
  readonly storeFactsBytes: Uint8Array;
  readonly senderFactsBytes: Uint8Array;
  readonly wireFactsBytes: Uint8Array;
  readonly reviewedAt: string;
}
export interface SeedreamFlashSourceProfileV2BuildResult {
  readonly registry: GenerationContractRegistryV2;
  readonly added_variant_id: "seedream-5-0-flash-generate-source-reviewed";
}

const PARENT_VERSION = "sha256-23ed982e5bae93abec6128ce18568229c38c1569f87efbf036cb25c063b09476.json";
const PARENT_REGISTRY_SHA = "sha256:68779a8b4307afa19eef1253be9fc07f468fd4a384ff50d12c12e1a2553bbb0b";
const CATALOG_VERSION = "2026-10-08T13:18:39.393Z.36e6960df354";
const PUBLIC_MODELS_SHA = "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444";
const APP_SHA = "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf";
const FORM_SHA = "sha256:3e762f2725970438f392c18f1d4153e93d4aee1165597e28207a8853a0a5b1d1";
const HELPER_SHA = "sha256:636b6f8e15c847f346395027bc83dc3fddf22199d8ab07a32f98d5f0985ccecf";
const SETTINGS_SHA = "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe";
const VIDEO_SHA = "sha256:de1f4d8ddb8f79a909aad5a0e62c876995dbaada01946e395d62a3da7e62b2ae";
const INDEX_SHA = "sha256:eb4fe700c7afae0756348aad3118c55ec8c9b5f5e5d18832045be07bbd368447";
const FORM_FACTS_SHA = "55372f624d3cc73a192a66d5fa70fbf1e1c6c94dde39b3fa1191e2640316c061";
const HELPER_FACTS_SHA = "4db4483fcee2c1e1ab2b260a6613110ebfdb9bc5b7c38fd649bddcedac868bab";
const JOIN_FACTS_SHA = "3f9141d9362d793cf0a1c79f53e86a66a8a68dce81e52c1f1547a200fc94bcc8";
const STORE_FACTS_SHA = "64accdfce2b1e82a042b9ba3bceffa8586e02a1fcc043938ac21e464e4e49b0f";
const SENDER_FACTS_SHA = "6b595b45d9b8e6dbd3aeff8f833a13785d23efc1d571eaac5952f180954e54e9";
const WIRE_FACTS_SHA = "1c4ed576f5de0af51a7cb53d44df6ee5947e8152b49930995b6c64d1baa1e556";
const FORM_URL = "https://syntx.ai/assets/1791467421/seedream.js";
const HELPER_URL = "https://syntx.ai/assets/1791467421/constants2.js";
const SETTINGS_URL = "https://syntx.ai/assets/1791467421/settings3.js";
const VIDEO_URL = "https://syntx.ai/assets/1791467421/video.js";
const INDEX_URL = "https://syntx.ai/assets/1791467421/index6.js";
const FORM_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-166-seedream-form-facts.json";
const HELPER_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-167-seedream-helper-facts.json";
const JOIN_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-168b-flash-shared-store-wire-join.json";
const STORE_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-132-gpt-image2-store-wire-join.json";
const SENDER_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-90-standard-photo-sender-facts.json";
const WIRE_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-155-ideogram-custom-payload-wire-facts.json";
const IMAGE_OBSERVER_SHA = "sha256:52a920ddbe6808df8151a56efcdd512b05f81a976f351e88c188bc21293e5b97";
const CHAT_CLIENT_SHA = "sha256:f802ccec131f03a47dedb1a118c194f09b0fc16fc9925743a6b09a1aa9005dd5";
const VARIANT_ID = "seedream-5-0-flash-generate-source-reviewed";
const MODEL_ID = "seedream-5.0-flash";
const RATIOS = ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"] as const;
const RESOLUTIONS = ["1K", "1.5K", "2K"] as const;
const FORMATS = ["jpeg", "png"] as const;

const formSchema = z.object({
  schema_version: z.literal("ROOT_166_SEEDREAM_FORM_FACTS_V1"), runtime_usable: z.literal(false), vendor_code_executed: z.literal(false), raw_body_persisted: z.literal(false),
  source: z.object({ url: z.literal(FORM_URL), bytes: z.literal(9_142), sha256: z.literal(FORM_SHA), parse_diagnostics: z.literal(0) }).passthrough(),
  imports: z.array(z.object({ module: z.string(), clause: z.string().nullable() }).passthrough()),
  declarations: z.array(z.object({ name: z.string(), position: z.number(), initializer: z.string() }).passthrough()),
  setting_watcher_calls: z.array(z.object({ position: z.number(), expression: z.string(), text: z.string() }).passthrough()),
  scope: z.string()
}).passthrough();
const helperSchema = z.object({
  schema_version: z.literal("ROOT_167_SEEDREAM_HELPER_FACTS_V1"), runtime_usable: z.literal(false), vendor_code_executed: z.literal(false), raw_body_persisted: z.literal(false),
  source: z.object({ url: z.literal(HELPER_URL), bytes: z.literal(1_131), sha256: z.literal(HELPER_SHA), parse_diagnostics: z.literal(0) }).passthrough(),
  imports: z.array(z.unknown()), declarations: z.array(z.object({ name: z.string(), position: z.number(), initializer: z.string() }).passthrough()), derived_from: z.literal(FORM_SHA)
}).passthrough();
const joinSchema = z.object({
  schema_version: z.literal("ROOT_FLASH_SHARED_STORE_WIRE_JOIN_V1"), runtime_usable: z.literal(false), vendor_code_executed: z.literal(false), additional_network_calls: z.literal(0),
  sources: z.object({ seedream: z.literal(FORM_SHA), app: z.literal(APP_SHA), video: z.literal(VIDEO_SHA) }).passthrough(),
  form_store: z.object({ import: z.literal("app.js b6 as ve"), declaration: z.literal("o=ve()"), position: z.literal(1_396), settings_access: z.literal("o.settings") }).passthrough(),
  sender_store: z.object({ import: z.literal("app.js b6 as W"), declaration: z.literal("s=W()"), position: z.literal(4_651), settings_access: z.literal("s.settings"), function: z.literal("xe.sendMessage:U"), initial_settings: z.literal("let i={n:1,...s.settings}") }).passthrough(),
  shared_store_export: z.literal("app b6 -> Zwe, proven by Root132 same pinned app"),
  whole_seedream_form_ast: z.object({ property_sendMessage_edges: z.literal(0), property_setCustomSettingPayload_edges: z.literal(0), Me_store_B_files_edges: z.array(z.number()) }).passthrough(),
  settings_reset_helper: z.literal("Ce imports settings3.u; Root132 generic setSettingsByModel resets page custom payload to null; no non-null setter in this form"),
  standard_caller: z.literal("Root90 index6 standard sender calls video.sendMessage with selected aiName and cloned custom payload iff truthy; Root155 proves no custom branch uses n1 plus shared settings"),
  architectural_resolution: z.string(),
  candidate_zero_refs: z.object({ model_type: z.literal(MODEL_ID), n: z.literal(1), stream: z.literal(false), background: z.literal("opaque"), file_urls: z.array(z.unknown()), resolution: z.array(z.string()), aspect_ratio: z.array(z.string()), output_format: z.array(z.string()) }).passthrough(),
  provider_defaults_output_mime_count_cost_backend: z.literal("NOT_PROVEN"), historical168_callsite_gap: z.string()
}).passthrough();
const storeSchema = z.object({
  schema_version: z.literal("ROOT_GPT2_STORE_WIRE_JOIN_V1"), runtime_usable: z.literal(false),
  helper_source: z.object({ url: z.literal(SETTINGS_URL), bytes: z.literal(4_123), sha256: z.literal(SETTINGS_SHA) }).passthrough(),
  app_source: z.object({ build_id: z.literal("1791467421"), sha256: z.literal(APP_SHA), cached_only: z.literal(true), no_refetch: z.literal(true) }).passthrough(),
  derived_scope: z.object({ setSettingsByModel_resets_page_metadata_and_custom_payload_to_null: z.literal(true), form_has_non_null_custom_payload_setter: z.literal(false),
    sender_base_settings: z.literal("{n:1,...appStore.settings}"), file_urls_appended_after_settings_selection: z.literal(true),
    backend_values_not_live_verified: z.literal(true), ui_choices_only: z.literal(true) }).passthrough()
}).passthrough();
const senderSchema = z.object({
  schema_version: z.literal("1.0.0"), source_only: z.literal(true), backend_acceptance: z.literal(false), source_persisted: z.literal(false),
  sources: z.array(z.object({ module_name: z.string(), url: z.string(), bytes: z.number(), sha256: z.string() }).passthrough()),
  standard_sender: z.array(z.object({ module_name: z.string(), offset: z.number(), tree: z.unknown() }).passthrough()),
  send_calls: z.array(z.object({ member: z.string(), receiver: z.string(), offset: z.number(), function_offset: z.number(), function_name: z.string() }).passthrough())
}).passthrough();
const wireSchema = z.object({
  schema_version: z.literal("ROOT_IDEOGRAM_CUSTOM_PAYLOAD_WIRE_V1"), runtime_usable: z.literal(false),
  source: z.object({ url: z.literal(VIDEO_URL), observed_sha256: z.literal(VIDEO_SHA), bytes: z.literal(8_689) }).passthrough(),
  static_function_edge: z.object({ parameters: z.array(z.string()), parameter_roles: z.array(z.string()), initial_settings: z.literal("let i={n:1,...s.settings}"),
    custom_branch: z.literal("l&&(i={...l})"), custom_branch_semantics: z.literal("TRUTHY_CUSTOM_REPLACES_SETTINGS_ENTIRELY_NOT_MERGED_NO_EXTRA_WIRE_FIELD"),
    reference_canonicalization: z.string(), request_object: z.literal("const u={chat_uuid:t,prompt:_,settings:i}"),
    dispatch: z.literal("L.post(design/generate,u,{params:{ai_name:o},...})"), n_default_retained_under_custom_branch: z.literal(false), backend_or_execution_proof: z.literal(false) }).passthrough()
}).passthrough();

export function buildSeedreamFlashSourceProfileV2(input: BuildSeedreamFlashSourceProfileV2Input): SeedreamFlashSourceProfileV2BuildResult {
  const facts = [input.formFactsBytes, input.helperFactsBytes, input.storeWireJoinFactsBytes, input.storeFactsBytes, input.senderFactsBytes, input.wireFactsBytes].map((value) => Buffer.from(value));
  const hashes = [FORM_FACTS_SHA, HELPER_FACTS_SHA, JOIN_FACTS_SHA, STORE_FACTS_SHA, SENDER_FACTS_SHA, WIRE_FACTS_SHA];
  const maxBytes = [32_768, 16_384, 8_192, 16_384, 131_072, 8_192];
  if (facts.some((bytes, index) => bytes.byteLength > maxBytes[index]! || sha256(bytes) !== hashes[index])) throw new Error("SEEDREAM_FLASH_SOURCE_FACTS_HASH_INVALID");
  if (!Number.isFinite(Date.parse(input.reviewedAt))) throw new Error("SEEDREAM_FLASH_REVIEW_TIME_INVALID");
  let form: z.infer<typeof formSchema>; let helper: z.infer<typeof helperSchema>; let join: z.infer<typeof joinSchema>;
  let store: z.infer<typeof storeSchema>; let sender: z.infer<typeof senderSchema>; let wire: z.infer<typeof wireSchema>;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    form = formSchema.parse(parse(facts[0]!, decoder)); helper = helperSchema.parse(parse(facts[1]!, decoder));
    join = joinSchema.parse(parse(facts[2]!, decoder)); store = storeSchema.parse(parse(facts[3]!, decoder));
    sender = senderSchema.parse(parse(facts[4]!, decoder)); wire = wireSchema.parse(parse(facts[5]!, decoder));
  } catch { throw new Error("SEEDREAM_FLASH_SOURCE_FACTS_INVALID"); }
  validateSourceJoin(form, helper, join, store, sender, wire);

  const parent = generationContractRegistryV2Schema.parse(input.currentRegistry);
  if (parent.registry_sha256 !== PARENT_REGISTRY_SHA || parent.catalog_version !== CATALOG_VERSION || parent.contracts.length !== 45 ||
      count(parent, "live_verified") !== 10 || count(parent, "reviewed") !== 35 || parent.contracts.some((entry) => entry.model_id === MODEL_ID || entry.variant_id === VARIANT_ID)) {
    throw new Error("SEEDREAM_FLASH_PARENT_REGISTRY_MISMATCH");
  }
  const current = parent.contracts.find((entry) => entry.variant_id === "legacy-image-seedream-5-default");
  if (!current || current.status !== "live_verified" || current.model_id !== "seedream-5" || current.ai_name !== "seedream" ||
      current.operation_id !== "generate-image" || current.provenance.settings_source_sha256 !== FORM_SHA) throw new Error("SEEDREAM_FLASH_BASE_PROFILE_MISMATCH");
  const publicCatalogRef = current.provenance.references.find((reference) => reference.kind === "public_catalog");
  if (!publicCatalogRef?.sha256) throw new Error("SEEDREAM_FLASH_PUBLIC_CATALOG_REFERENCE_MISSING");

  let model;
  try { model = input.publicCatalog.getModel(MODEL_ID); }
  catch { throw new Error("SEEDREAM_FLASH_PUBLIC_MODEL_BINDING_INVALID"); }
  const publicCatalogVersion = `${model.fetched_at}.${model.source_hashes.models.slice(7, 19)}`;
  if (model.id !== MODEL_ID || model.upstream_id !== MODEL_ID || model.ai_name !== "seedream" || model.active !== true ||
      !model.operations.some((entry) => entry.id === "generate-image" && entry.output_modality === "image") || publicCatalogVersion !== CATALOG_VERSION ||
      model.source_hashes.ai !== parent.source_hashes.ai || model.source_hashes.llm_models !== parent.source_hashes.llm_models ||
      model.source_hashes.models !== PUBLIC_MODELS_SHA || model.source_hashes.models !== parent.source_hashes.models) {
    throw new Error("SEEDREAM_FLASH_PUBLIC_MODEL_BINDING_INVALID");
  }

  const candidate: GenerationContractV2Input = {
    variant_id: VARIANT_ID, model_id: MODEL_ID, operation_id: "generate-image", modality: "image", route: "design",
    ai_name: "seedream", model_type: MODEL_ID, status: "reviewed",
    provenance: {
      settings_source_sha256: FORM_SHA,
      references: [
        { kind: "public_catalog", reference: "catalog/public/sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json; exact Flash active/model-value/ai_name binding", sha256: PUBLIC_MODELS_SHA },
        { kind: "frontend_static", reference: `${FORM_URL}; model_type settings, explicit UI controls and zero-reference transparent guard`, sha256: FORM_SHA },
        { kind: "frontend_static", reference: `${HELPER_URL}; Flash resolution allowlist, optional-field whitelist and UI grouping`, sha256: HELPER_SHA },
        { kind: "frontend_static", reference: `${SETTINGS_URL}; current shared store reset semantics; UI settings only`, sha256: SETTINGS_SHA },
        { kind: "frontend_static", reference: `${VIDEO_URL}; ordinary request envelope and custom-payload replacement semantics; backend unverified`, sha256: VIDEO_SHA },
        { kind: "manual_review", reference: `${FORM_FACTS_PATH}; SHA-256=${FORM_FACTS_SHA}; 1791467421 form initializer/controls/watchers, not provider defaults`, sha256: `sha256:${FORM_FACTS_SHA}` },
        { kind: "manual_review", reference: `${HELPER_FACTS_PATH}; SHA-256=${HELPER_FACTS_SHA}; exact Flash resolutions and optional settings`, sha256: `sha256:${HELPER_FACTS_SHA}` },
        { kind: "manual_review", reference: `${JOIN_FACTS_PATH}; SHA-256=${JOIN_FACTS_SHA}; shared app store join, exact standard sender architecture, no custom-payload edge`, sha256: `sha256:${JOIN_FACTS_SHA}` },
        { kind: "manual_review", reference: `${STORE_FACTS_PATH}; SHA-256=${STORE_FACTS_SHA}; same-build shared settings helper resets custom payload`, sha256: `sha256:${STORE_FACTS_SHA}` },
        { kind: "manual_review", reference: `${SENDER_FACTS_PATH}; SHA-256=${SENDER_FACTS_SHA}; standard sender model/settings flow and n=1 base`, sha256: `sha256:${SENDER_FACTS_SHA}` },
        { kind: "manual_review", reference: `${WIRE_FACTS_PATH}; SHA-256=${WIRE_FACTS_SHA}; no-custom branch and request envelope only`, sha256: `sha256:${WIRE_FACTS_SHA}` },
        { kind: "manual_review", reference: "src/adapter/syntx/chat-http-client.ts; client-recognized image MIME allowlist includes JPEG/PNG (not a provider output claim)", sha256: CHAT_CLIENT_SHA },
        { kind: "manual_review", reference: "src/adapter/syntx/owned-image-artifact-observer.ts; known local image dimension parsers support JPEG/PNG (not a provider output claim)", sha256: IMAGE_OBSERVER_SHA },
        { kind: "manual_review", reference: `${PARENT_VERSION}; exact 45 parent rows preserved; Flash stays reviewed-only.` }
      ], reviewed_at: input.reviewedAt
    },
    parameters: {
      type: "object", additional_properties: false,
      required: ["prompt", "aspect_ratio", "resolution", "output_format"],
      properties: {
        prompt: { type: "string", min_length: 1 }, aspect_ratio: { type: "string", enum: [...RATIOS] },
        resolution: { type: "string", enum: [...RESOLUTIONS] }, output_format: { type: "string", enum: [...FORMATS] }
      },
      conditions: [], conditional_enums: []
    },
    wire: {
      dispatch_action: "generate-image", input_kind: "prompt", prompt_field: "prompt",
      settings_fields: { aspect_ratio: "aspect_ratio", resolution: "resolution", output_format: "output_format" },
      fixed_settings: { background: "opaque", stream: false, n: 1, file_urls: [] }, media_reference_fields: {}
    },
    // These MIME types are a local client/codec acceptance allowlist, not a Seedream provider promise.
    output: { decoder_profile: current.output.decoder_profile, mime_types: ["image/jpeg", "image/png"] },
    limits: { ...current.limits, max_parameters: 4 }
  };
  const registry = createGenerationContractRegistryV2({ schema_version: "2.0.0", catalog_version: parent.catalog_version,
    source_hashes: parent.source_hashes, contracts: [...parent.contracts.map(stripSchemaHash), candidate] });
  const oldRowsPreserved = parent.contracts.every((old) => {
    const retained = registry.contracts.find((entry) => entry.variant_id === old.variant_id);
    return retained !== undefined && canonicalJson(retained) === canonicalJson(old);
  });
  if (!oldRowsPreserved || registry.contracts.length !== 46 || count(registry, "live_verified") !== 10 || count(registry, "reviewed") !== 36) {
    throw new Error("SEEDREAM_FLASH_REGISTRY_INVARIANT_FAILED");
  }
  return Object.freeze({ registry, added_variant_id: VARIANT_ID });
}

export async function archiveSeedreamFlashSourceProfileV2(result: SeedreamFlashSourceProfileV2BuildResult, catalogDirectory?: string): Promise<{
  readonly version: string; readonly path: string; readonly status: "created" | "existing"
}> {
  const checked = generationContractRegistryV2Schema.parse(result.registry);
  if (result.added_variant_id !== VARIANT_ID || checked.contracts.length !== 46 ||
      !checked.contracts.some((entry) => entry.variant_id === VARIANT_ID && entry.model_id === MODEL_ID && entry.status === "reviewed")) {
    throw new Error("SEEDREAM_FLASH_ARCHIVE_BINDING_INVALID");
  }
  return archiveGenerationContractRegistryV2(checked, catalogDirectory);
}

function validateSourceJoin(
  form: z.infer<typeof formSchema>, helper: z.infer<typeof helperSchema>, join: z.infer<typeof joinSchema>,
  store: z.infer<typeof storeSchema>, sender: z.infer<typeof senderSchema>, wire: z.infer<typeof wireSchema>
): void {
  const formImports = new Map(form.imports.map((entry) => [entry.module, entry.clause]));
  const formDeclarations = new Map(form.declarations.map((entry) => [entry.name, entry.initializer]));
  const helperDeclarations = new Map(helper.declarations.map((entry) => [entry.name, entry.initializer]));
  const watchers = new Map(form.setting_watcher_calls.map((entry) => [entry.position, entry.text]));
  const expectedSettings = '{model_type:(P=O.getDefaultModelByAiName(C))==null?void 0:P.value,resolution:"2K",stream:!1,aspect_ratio:"1:1",output_format:"jpeg",background:"opaque"}';
  const expectedRatios = '[{value:"21:9",ratio:"21:9"},{value:"16:9",ratio:"16:9"},{value:"3:2",ratio:"3:2"},{value:"4:3",ratio:"4:3"},{value:"1:1",ratio:"1:1"},{value:"3:4",ratio:"3:4"},{value:"2:3",ratio:"2:3"},{value:"9:16",ratio:"9:16"}]';
  const senderRows = sender.standard_sender.find((entry) => entry.module_name === "index6.js" && entry.offset === 5_014);
  const senderTree = JSON.stringify(senderRows?.tree ?? null);
  if (form.scope !== "Current form structural declarations/guards/imports only; Flash helper bindings and backend acceptance unresolved." ||
      formImports.get("./settings3.js") !== "{u as Ce}" || formImports.get("./video.js") !== "{u as Me}" || !formImports.get("./constants2.js")?.includes("h as X") ||
      formDeclarations.get("C") !== '"seedream"' || formDeclarations.get("b") !== expectedSettings ||
      !formDeclarations.get("N")?.includes("t.includes(l)?l in o.settings||(o.settings[l]=b[l]):delete o.settings[l]") ||
      !formDeclarations.get("ue")?.includes('value:"transparent"') || !formDeclarations.get("ue")?.includes("disabled:!v.value") ||
      !formDeclarations.get("de")?.includes('value:"jpeg"') || !formDeclarations.get("de")?.includes('value:"png"') ||
      !formDeclarations.get("de")?.includes('disabled:o.settings.background==="transparent"') || formDeclarations.get("L") !== expectedRatios ||
      !formDeclarations.get("w")?.includes("B.files.length") || !formDeclarations.get("z")?.includes("w.value===1&&ie(e)?e.url:null") ||
      watchers.get(2_275) !== '_(()=>o.settings.model_type,e=>{Z(e),o.settings.resolution=Oe(e,o.settings.resolution,b.resolution),N(e)},{immediate:!0})' ||
      watchers.get(3_307) !== '_(v,e=>{!e&&o.settings.background==="transparent"&&(o.settings.background="opaque")},{immediate:!0})' ||
      watchers.get(3_408) !== '_(()=>o.settings.background,e=>{e==="transparent"&&(o.settings.output_format="png")},{immediate:!0})' ||
      helperDeclarations.get("a") !== '"seedream-5.0-flash"' ||
      helperDeclarations.get("_") !== '{[n]:["1K","2K","4K"],[S]:["2K","4K"],[r]:["2K","3K","4K"],[a]:["1K","1.5K","2K"],[c]:["1K","2K"]}' ||
      helperDeclarations.get("A") !== '{[n]:{version:"4.0"},[S]:{version:"4.5"},[r]:{version:"5.0",mode:"lite"},[a]:{version:"5.0",mode:"flash"},[c]:{version:"5.0",mode:"pro"}}' ||
      helperDeclarations.get("D") !== '{[a]:["output_format","background"]}' ||
      JSON.stringify(join.whole_seedream_form_ast.Me_store_B_files_edges) !== JSON.stringify([3_047, 3_152]) ||
      join.whole_seedream_form_ast.property_sendMessage_edges !== 0 || join.whole_seedream_form_ast.property_setCustomSettingPayload_edges !== 0 ||
      join.form_store.settings_access !== "o.settings" || join.sender_store.settings_access !== "s.settings" ||
      !join.architectural_resolution.includes("via shared b6/Zwe store") || store.helper_source.sha256 !== SETTINGS_SHA || store.app_source.sha256 !== APP_SHA ||
      !store.derived_scope.setSettingsByModel_resets_page_metadata_and_custom_payload_to_null || store.derived_scope.form_has_non_null_custom_payload_setter ||
      store.derived_scope.sender_base_settings !== "{n:1,...appStore.settings}" || !store.derived_scope.file_urls_appended_after_settings_selection ||
      wire.source.observed_sha256 !== VIDEO_SHA || wire.static_function_edge.request_object !== "const u={chat_uuid:t,prompt:_,settings:i}" ||
      wire.static_function_edge.dispatch !== "L.post(design/generate,u,{params:{ai_name:o},...})" || wire.static_function_edge.n_default_retained_under_custom_branch ||
      JSON.stringify(join.candidate_zero_refs.aspect_ratio) !== JSON.stringify(RATIOS) || JSON.stringify(join.candidate_zero_refs.resolution) !== JSON.stringify(RESOLUTIONS) ||
      JSON.stringify(join.candidate_zero_refs.output_format) !== JSON.stringify(FORMATS) || join.candidate_zero_refs.model_type !== MODEL_ID ||
      join.candidate_zero_refs.background !== "opaque" || join.candidate_zero_refs.stream !== false || join.candidate_zero_refs.n !== 1 ||
      join.candidate_zero_refs.file_urls.length !== 0 || join.provider_defaults_output_mime_count_cost_backend !== "NOT_PROVEN" ||
      !senderTree.includes("SpreadAssignment") || !sender.send_calls.some((call) => call.member === "sendMessage" && call.function_offset === 5_014 && call.function_name === "Pe") ||
      !sender.sources.some((source) => source.module_name === "index6.js" && source.url === INDEX_URL && source.sha256 === INDEX_SHA) ||
      !sender.sources.some((source) => source.module_name === "video.js" && source.url === VIDEO_URL && source.sha256 === VIDEO_SHA) || sender.backend_acceptance ||
      store.derived_scope.backend_values_not_live_verified !== true || store.derived_scope.ui_choices_only !== true) {
    throw new Error("SEEDREAM_FLASH_SOURCE_WIRE_JOIN_INCOMPLETE");
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
