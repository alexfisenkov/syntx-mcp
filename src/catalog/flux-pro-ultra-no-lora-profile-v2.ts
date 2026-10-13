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

export interface BuildFluxProUltraNoLoraProfileV2Input {
  readonly currentRegistry: GenerationContractRegistryV2;
  readonly publicCatalog: GenerationContractCatalogPort;
  readonly formFactsBytes: Uint8Array;
  readonly wireAuditFactsBytes: Uint8Array;
  readonly policyBytes: Uint8Array;
  readonly storeFactsBytes: Uint8Array;
  readonly senderFactsBytes: Uint8Array;
  readonly wireFactsBytes: Uint8Array;
  readonly reviewedAt: string;
}
export interface FluxProUltraNoLoraProfileV2BuildResult {
  readonly registry: GenerationContractRegistryV2;
  readonly added_variant_ids: readonly ["flux-pro-1-1-explicit-no-lora-reviewed", "flux-pro-1-1-ultra-explicit-no-lora-reviewed"];
}

const PARENT_VERSION = "sha256-0f3ea4f02dc02baffeb9cb3cbaeb5e2125c5baa995882727f98c5974ff97cf10.json";
const PARENT_REGISTRY_SHA = "sha256:c4b7a761e7543013a57a7f692588ed48b6d264002ab16f7c4d9952275705cee2";
const CATALOG_VERSION = "2026-10-08T13:18:39.393Z.36e6960df354";
const PUBLIC_MODELS_SHA = "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444";
const FORM_SHA = "sha256:80307235518f6f0c80952ce4a5a0834ee373d7294f8dc90e58748d57389de664";
const APP_SHA = "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf";
const SETTINGS_SHA = "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe";
const VIDEO_SHA = "sha256:de1f4d8ddb8f79a909aad5a0e62c876995dbaada01946e395d62a3da7e62b2ae";
const INDEX_SHA = "sha256:eb4fe700c7afae0756348aad3118c55ec8c9b5f5e5d18832045be07bbd368447";
const FORM_FACTS_SHA = "aab0bed361578942608e03bbc9e1ee8d7a5fd47d35cbbdd7121a5b26f43ee2a5";
const AUDIT_FACTS_SHA = "bc24f7a29531de694a0a8a51c8ff66ff232fdd6e2b627d43d88eeb88d9d110c3";
const POLICY_SHA = "2f3924b85d32b209a53f604fd4a020272d13a553b3ce1f13522766dc3792325a";
const STORE_FACTS_SHA = "64accdfce2b1e82a042b9ba3bceffa8586e02a1fcc043938ac21e464e4e49b0f";
const SENDER_FACTS_SHA = "6b595b45d9b8e6dbd3aeff8f833a13785d23efc1d571eaac5952f180954e54e9";
const WIRE_FACTS_SHA = "1c4ed576f5de0af51a7cb53d44df6ee5947e8152b49930995b6c64d1baa1e556";
const FORM_URL = "https://syntx.ai/assets/1791467421/flux.js";
const SETTINGS_URL = "https://syntx.ai/assets/1791467421/settings3.js";
const INDEX_URL = "https://syntx.ai/assets/1791467421/index6.js";
const VIDEO_URL = "https://syntx.ai/assets/1791467421/video.js";
const FORM_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-180-flux-form-facts.json";
const AUDIT_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-186-flux-wire-closure-audit.json";
const POLICY_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-187-flux-no-lora-policy-decision.md";
const STORE_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-132-gpt-image2-store-wire-join.json";
const SENDER_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-90-standard-photo-sender-facts.json";
const WIRE_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-155-ideogram-custom-payload-wire-facts.json";
const IDS = ["flux-pro-1.1", "flux-pro-1.1-ultra"] as const;
const VARIANTS = ["flux-pro-1-1-explicit-no-lora-reviewed", "flux-pro-1-1-ultra-explicit-no-lora-reviewed"] as const;
const PRO_SIZES = ["1152x896", "1280x1024"] as const;
const ULTRA_SIZES = ["3136x1344", "2752x1536", "2368x1792", "2048x2048", "1792x2368", "1536x2752", "1344x3136"] as const;
const NO_LORA = "default" as const;

const formSchema = z.object({
  schema_version: z.literal("ROOT_180_FLUX_FORM_FACTS_V1"), runtime_usable: z.literal(false), vendor_code_executed: z.literal(false), raw_body_persisted: z.literal(false),
  source: z.object({ url: z.literal(FORM_URL), bytes: z.literal(10_970), sha256: z.literal(FORM_SHA), parse_diagnostics: z.literal(0) }).passthrough(),
  imports: z.array(z.object({ module: z.string(), clause: z.string().nullable() }).passthrough()),
  declarations: z.array(z.object({ name: z.string(), position: z.number(), initializer: z.string() }).passthrough()),
  calls: z.array(z.object({ expression: z.string(), position: z.number(), text: z.string() }).passthrough())
}).passthrough();
const auditSchema = z.object({
  schema_version: z.literal("ROOT_186_FLUX_WIRE_CLOSURE_AUDIT_V1"), runtime_usable: z.literal(false),
  targets: z.array(z.string()), source_anchors: z.record(z.string(), z.unknown()), closure_findings: z.record(z.string(), z.unknown())
}).passthrough();
const storeSchema = z.object({
  schema_version: z.literal("ROOT_GPT2_STORE_WIRE_JOIN_V1"), runtime_usable: z.literal(false),
  helper_source: z.object({ url: z.literal(SETTINGS_URL), bytes: z.literal(4_123), sha256: z.literal(SETTINGS_SHA) }).passthrough(),
  app_source: z.object({ build_id: z.literal("1791467421"), sha256: z.literal(APP_SHA), cached_only: z.literal(true), no_refetch: z.literal(true) }).passthrough(),
  derived_scope: z.object({ setSettingsByModel_resets_page_metadata_and_custom_payload_to_null: z.literal(true),
    form_has_non_null_custom_payload_setter: z.literal(false), sender_base_settings: z.literal("{n:1,...appStore.settings}"),
    file_urls_appended_after_settings_selection: z.literal(true), backend_values_not_live_verified: z.literal(true), ui_choices_only: z.literal(true) }).passthrough()
}).passthrough();
const senderSchema = z.object({
  schema_version: z.literal("1.0.0"), source_only: z.literal(true), backend_acceptance: z.literal(false), source_persisted: z.literal(false),
  sources: z.array(z.object({ module_name: z.string(), url: z.string(), bytes: z.number(), sha256: z.string() }).passthrough()),
  standard_sender: z.array(z.object({ module_name: z.string(), offset: z.number(), tree: z.unknown() }).passthrough())
}).passthrough();
const wireSchema = z.object({
  schema_version: z.literal("ROOT_IDEOGRAM_CUSTOM_PAYLOAD_WIRE_V1"), runtime_usable: z.literal(false),
  source: z.object({ url: z.literal(VIDEO_URL), observed_sha256: z.literal(VIDEO_SHA), bytes: z.literal(8_689) }).passthrough(),
  static_function_edge: z.object({ initial_settings: z.literal("let i={n:1,...s.settings}"),
    custom_branch: z.literal("l&&(i={...l})"), custom_branch_semantics: z.literal("TRUTHY_CUSTOM_REPLACES_SETTINGS_ENTIRELY_NOT_MERGED_NO_EXTRA_WIRE_FIELD"),
    request_object: z.literal("const u={chat_uuid:t,prompt:_,settings:i}"), dispatch: z.literal("L.post(design/generate,u,{params:{ai_name:o},...})"),
    n_default_retained_under_custom_branch: z.literal(false), backend_or_execution_proof: z.literal(false) }).passthrough()
}).passthrough();

export function buildFluxProUltraNoLoraProfileV2(input: BuildFluxProUltraNoLoraProfileV2Input): FluxProUltraNoLoraProfileV2BuildResult {
  const rawFacts = [input.formFactsBytes, input.wireAuditFactsBytes, input.policyBytes, input.storeFactsBytes, input.senderFactsBytes, input.wireFactsBytes].map((value) => Buffer.from(value));
  const hashes = [FORM_FACTS_SHA, AUDIT_FACTS_SHA, POLICY_SHA, STORE_FACTS_SHA, SENDER_FACTS_SHA, WIRE_FACTS_SHA];
  const caps = [64_000, 16_000, 8_000, 10_000, 140_000, 8_000];
  if (rawFacts.some((bytes, index) => bytes.byteLength > caps[index]! || sha256(bytes) !== hashes[index])) throw new Error("FLUX_PRO_ULTRA_SOURCE_FACTS_HASH_INVALID");
  if (!Number.isFinite(Date.parse(input.reviewedAt))) throw new Error("FLUX_PRO_ULTRA_REVIEW_TIME_INVALID");
  let form: z.infer<typeof formSchema>; let audit: z.infer<typeof auditSchema>; let store: z.infer<typeof storeSchema>;
  let sender: z.infer<typeof senderSchema>; let wire: z.infer<typeof wireSchema>; let policyText: string;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    form = formSchema.parse(parse(rawFacts[0]!, decoder)); audit = auditSchema.parse(parse(rawFacts[1]!, decoder));
    policyText = decoder.decode(rawFacts[2]!); store = storeSchema.parse(parse(rawFacts[3]!, decoder));
    sender = senderSchema.parse(parse(rawFacts[4]!, decoder)); wire = wireSchema.parse(parse(rawFacts[5]!, decoder));
  } catch { throw new Error("FLUX_PRO_ULTRA_SOURCE_FACTS_INVALID"); }
  validateSourceJoin(form, audit, policyText, store, sender, wire);

  const parent = generationContractRegistryV2Schema.parse(input.currentRegistry);
  if (parent.registry_sha256 !== PARENT_REGISTRY_SHA || parent.catalog_version !== CATALOG_VERSION || parent.contracts.length !== 49 ||
      count(parent, "live_verified") !== 13 || count(parent, "reviewed") !== 36 ||
      parent.contracts.some((entry) => IDS.includes(entry.model_id as typeof IDS[number]) || VARIANTS.includes(entry.variant_id as typeof VARIANTS[number]))) {
    throw new Error("FLUX_PRO_ULTRA_PARENT_REGISTRY_MISMATCH");
  }
  const base = parent.contracts.find((entry) => entry.variant_id === "legacy-image-flux-1-default");
  if (!base || base.status !== "reviewed" || base.model_id !== "flux-1" || base.ai_name !== "flux" || base.operation_id !== "generate-image" ||
      base.provenance.settings_source_sha256 !== FORM_SHA) throw new Error("FLUX_PRO_ULTRA_BASE_PROFILE_MISMATCH");
  const publicRef = base.provenance.references.find((ref) => ref.kind === "public_catalog");
  if (!publicRef?.sha256) throw new Error("FLUX_PRO_ULTRA_PUBLIC_REFERENCE_MISSING");

  const modelRecords = IDS.map((modelId) => {
    try { return input.publicCatalog.getModel(modelId); } catch { throw new Error("FLUX_PRO_ULTRA_PUBLIC_MODEL_BINDING_INVALID"); }
  });
  for (const model of modelRecords) {
    const version = `${model.fetched_at}.${model.source_hashes.models.slice(7, 19)}`;
    if (!IDS.includes(model.id as typeof IDS[number]) || model.upstream_id !== model.id || model.ai_name !== "flux" || model.active !== true ||
        !model.operations.some((op) => op.id === "generate-image" && op.output_modality === "image") || version !== CATALOG_VERSION ||
        model.source_hashes.ai !== parent.source_hashes.ai || model.source_hashes.llm_models !== parent.source_hashes.llm_models ||
        model.source_hashes.models !== PUBLIC_MODELS_SHA || model.source_hashes.models !== parent.source_hashes.models) {
      throw new Error("FLUX_PRO_ULTRA_PUBLIC_MODEL_BINDING_INVALID");
    }
  }

  const candidates = IDS.map((modelId, index): GenerationContractV2Input => {
    const ultra = index === 1;
    const variantId = VARIANTS[index]!;
    const resolutions = ultra ? ULTRA_SIZES : PRO_SIZES;
    return {
      variant_id: variantId, model_id: modelId, operation_id: "generate-image", modality: "image", route: "design",
      ai_name: "flux", model_type: modelId, status: "reviewed",
      provenance: {
        settings_source_sha256: FORM_SHA,
        references: [
          { kind: "public_catalog", reference: `catalog/public/sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json; exact active ${modelId} model-value/ai_name binding`, sha256: PUBLIC_MODELS_SHA },
          { kind: "frontend_static", reference: `${FORM_URL}; model-specific allowed resolution branches, numeric controls and no-LoRA UI intent`, sha256: FORM_SHA },
          { kind: "frontend_static", reference: `${SETTINGS_URL}; shared model settings store and custom-payload reset source`, sha256: SETTINGS_SHA },
          { kind: "frontend_static", reference: `${VIDEO_URL}; ordinary sender {n:1,...settings} branch and request envelope only`, sha256: VIDEO_SHA },
          { kind: "manual_review", reference: `${FORM_FACTS_PATH}; SHA-256=${FORM_FACTS_SHA}; raw source not persisted/executed`, sha256: `sha256:${FORM_FACTS_SHA}` },
          { kind: "manual_review", reference: `${AUDIT_FACTS_PATH}; SHA-256=${AUDIT_FACTS_SHA}; computed Pro/Ultra blacklists, allowed sizes and serialization gap`, sha256: `sha256:${AUDIT_FACTS_SHA}` },
          { kind: "manual_review", reference: `${POLICY_PATH}; SHA-256=${POLICY_SHA}; explicit no-LoRA client policy, not native UI/provider default`, sha256: `sha256:${POLICY_SHA}` },
          { kind: "manual_review", reference: `${STORE_FACTS_PATH}; SHA-256=${STORE_FACTS_SHA}; shared store and model binding helper facts`, sha256: `sha256:${STORE_FACTS_SHA}` },
          { kind: "manual_review", reference: `${SENDER_FACTS_PATH}; SHA-256=${SENDER_FACTS_SHA}; ordinary sender carries n=1 and shared app settings`, sha256: `sha256:${SENDER_FACTS_SHA}` },
          { kind: "manual_review", reference: `${WIRE_FACTS_PATH}; SHA-256=${WIRE_FACTS_SHA}; standard no-custom payload request shape, no backend proof`, sha256: `sha256:${WIRE_FACTS_SHA}` },
          { kind: "manual_review", reference: "src/adapter/syntx/chat-http-client.ts; local JPEG/PNG client MIME acceptance only", sha256: "sha256:f802ccec131f03a47dedb1a118c194f09b0fc16fc9925743a6b09a1aa9005dd5" },
          { kind: "manual_review", reference: "src/adapter/syntx/owned-image-artifact-observer.ts; local JPEG/PNG image codec acceptance only", sha256: "sha256:52a920ddbe6808df8151a56efcdd512b05f81a976f351e88c188bc21293e5b97" },
          { kind: "manual_review", reference: `${PARENT_VERSION}; all 49 parent rows retained exactly; reviewed-only client policy.` }
        ], reviewed_at: input.reviewedAt
      },
      parameters: {
        type: "object", additional_properties: false,
        required: ["prompt", "resolution", "cfg", "steps", "image_strength", "workflow_type"],
        properties: {
          prompt: { type: "string", min_length: 1 },
          resolution: { type: "string", enum: [...resolutions] },
          cfg: { type: "number", minimum: 1, maximum: 4, step: 0.1 },
          steps: { type: "integer", minimum: 10, maximum: 28 },
          image_strength: { type: "number", minimum: 0, maximum: 1, step: 0.1 },
          workflow_type: { type: "string", enum: [NO_LORA] }
        },
        conditions: [], conditional_enums: []
      },
      wire: {
        dispatch_action: "generate-image", input_kind: "prompt", prompt_field: "prompt",
        settings_fields: { resolution: "resolution", cfg: "cfg", steps: "steps", image_strength: "image_strength", workflow_type: "workflow_type" },
        fixed_settings: { civitai_loras: [], n: 1, file_urls: [], ...(ultra ? { raw: false } : {}) },
        media_reference_fields: {}
      },
      output: { decoder_profile: base.output.decoder_profile, mime_types: ["image/jpeg", "image/png"] },
      limits: { ...base.limits, max_parameters: 6 }
    };
  });

  const registry = createGenerationContractRegistryV2({ schema_version: "2.0.0", catalog_version: parent.catalog_version,
    source_hashes: parent.source_hashes, contracts: [...parent.contracts.map(stripSchemaHash), ...candidates] });
  const unchanged = parent.contracts.every((old) => {
    const retained = registry.contracts.find((entry) => entry.variant_id === old.variant_id);
    return retained !== undefined && canonicalJson(retained) === canonicalJson(old);
  });
  if (!unchanged || registry.contracts.length !== 51 || count(registry, "live_verified") !== 13 || count(registry, "reviewed") !== 38) {
    throw new Error("FLUX_PRO_ULTRA_REGISTRY_INVARIANT_FAILED");
  }
  return Object.freeze({ registry, added_variant_ids: VARIANTS });
}

export async function archiveFluxProUltraNoLoraProfileV2(result: FluxProUltraNoLoraProfileV2BuildResult, catalogDirectory?: string): Promise<{
  readonly version: string; readonly path: string; readonly status: "created" | "existing"
}> {
  const checked = generationContractRegistryV2Schema.parse(result.registry);
  if (canonicalJson(result.added_variant_ids) !== canonicalJson(VARIANTS) || checked.contracts.length !== 51 ||
      VARIANTS.some((variant, i) => !checked.contracts.some((entry) => entry.variant_id === variant && entry.model_id === IDS[i] && entry.status === "reviewed"))) {
    throw new Error("FLUX_PRO_ULTRA_ARCHIVE_BINDING_INVALID");
  }
  return archiveGenerationContractRegistryV2(checked, catalogDirectory);
}

function validateSourceJoin(
  form: z.infer<typeof formSchema>, audit: z.infer<typeof auditSchema>, policy: string,
  store: z.infer<typeof storeSchema>, sender: z.infer<typeof senderSchema>, wire: z.infer<typeof wireSchema>
): void {
  const declarations = new Map(form.declarations.map((entry) => [entry.name, entry.initializer]));
  const calls = new Map(form.calls.map((entry) => [entry.position, entry.text]));
  const auditModel = audit.closure_findings as Record<string, unknown>;
  const inputPolicy = auditModel.explicit_client_closed_no_lora_policy as Record<string, unknown> | undefined;
  if (form.source.sha256 !== FORM_SHA || form.imports.some((entry) => entry.module === "./app.js" && entry.clause?.includes("b6 as ce") !== true) ||
      form.imports.some((entry) => entry.module === "./settings3.js" && entry.clause?.includes("u as ke") !== true) ||
      form.imports.some((entry) => entry.module === "./video.js" && entry.clause?.includes("u as be") !== true) ||
      form.imports.some((entry) => entry.module === "./settings3.js" && entry.clause !== "{u as ke}") ||
      form.imports.some((entry) => entry.module === "./video.js" && entry.clause !== "{u as be}") ||
      declarations.get("Ce") !== '"flux-pro-1.1"' || declarations.get("se") !== '"flux-pro-1.1-ultra"' ||
      declarations.get("Ie") !== '[{ratio:"16:9",value:"1344x768"},{ratio:"3:2",value:"1216x832"},{ratio:"4:3",value:"1152x896"},{ratio:"5:4",value:"1280x1024"},{ratio:"1:1",value:"1024x1024"},{ratio:"4:5",value:"1024x1280"},{ratio:"3:4",value:"896x1152"},{ratio:"2:3",value:"832x1216"},{ratio:"9:16",value:"768x1344"}]' ||
      declarations.get("Me") !== '[{ratio:"21:9",value:"3136x1344"},{ratio:"16:9",value:"2752x1536"},{ratio:"3:2",value:"2496x1644"},{ratio:"4:3",value:"2368x1792"},{ratio:"5:4",value:"2304x1856"},{ratio:"1:1",value:"2048x2048"},{ratio:"4:5",value:"1856x2304"},{ratio:"3:4",value:"1792x2368"},{ratio:"2:3",value:"1644x2496"},{ratio:"9:16",value:"1536x2752"},{ratio:"9:21",value:"1344x3136"}]' ||
      declarations.get("Oe") !== '{[Ce]:["16:9","3:2","1:1","4:5","3:4","2:3","9:16"],[se]:["3:2","5:4","4:5","2:3"],[Le]:["3:2","5:4","4:5","2:3"],[Fe]:["3:2","5:4","4:5","2:3"],[$e]:["3:2","5:4","4:5","2:3"]}' ||
      declarations.get("Ne") !== 'y=>{const n=y===se?Me:Ie,d=Oe[y];return d?n.filter(({ratio:t})=>!d.includes(t)):n}' ||
      declarations.get("m") !== 'f(()=>t.settings.model_type==="flux-1")' ||
      !calls.get(6521)?.includes('case"flux-pro-1.1-ultra":t.settings.raw=!1,t.settings.resolution="2048x2048"') ||
      !calls.get(6521)?.includes('default:t.settings.raw=void 0,t.settings.workflow_type=void 0,t.settings.civitai_loras=void 0') ||
      !calls.get(6991)?.includes('t.settings.resolution=i[0].value') ||
      !calls.get(7109)?.includes('t.settings.workflow_type="default"') ||
      !calls.get(7109)?.includes('t.settings.workflow_type="civitai"') ||
      !calls.get(9014)?.includes('min:1,max:4,step:.1') || !calls.get(9014)?.includes('min:10,max:28') || !calls.get(9014)?.includes('min:0,max:1,step:.1') ||
      !policy.includes("Клиент должен явно указать `workflow_type=default`") || !policy.includes("explicit client intent") ||
      audit.targets.length !== 2 || !audit.targets.includes(IDS[0]) || !audit.targets.includes(IDS[1]) ||
      store.helper_source.sha256 !== SETTINGS_SHA || store.app_source.sha256 !== APP_SHA ||
      !store.derived_scope.setSettingsByModel_resets_page_metadata_and_custom_payload_to_null || store.derived_scope.form_has_non_null_custom_payload_setter ||
      store.derived_scope.sender_base_settings !== "{n:1,...appStore.settings}" || !store.derived_scope.file_urls_appended_after_settings_selection ||
      wire.source.observed_sha256 !== VIDEO_SHA || wire.static_function_edge.request_object !== "const u={chat_uuid:t,prompt:_,settings:i}" ||
      wire.static_function_edge.dispatch !== "L.post(design/generate,u,{params:{ai_name:o},...})" || wire.static_function_edge.n_default_retained_under_custom_branch ||
      !sender.sources.some((source) => source.module_name === "index6.js" && source.url === INDEX_URL && source.sha256 === INDEX_SHA) ||
      !sender.sources.some((source) => source.module_name === "video.js" && source.url === VIDEO_URL && source.sha256 === VIDEO_SHA) ||
      !sender.standard_sender.some((row) => row.module_name === "index6.js" && row.offset === 5_014 && JSON.stringify(row.tree).includes("SpreadAssignment")) ||
      sender.backend_acceptance || inputPolicy?.source_reviewed_candidate_supported !== true) {
    throw new Error("FLUX_PRO_ULTRA_SOURCE_WIRE_JOIN_INCOMPLETE");
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
