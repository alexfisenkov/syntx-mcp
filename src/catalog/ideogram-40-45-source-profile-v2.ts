import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { canonicalJson } from "../domain/generation-contract.js";
import {
  createGenerationContractRegistryV2,
  generationContractRegistryV2Schema,
  type GenerationContractRegistryV2,
  type GenerationContractV2Input
} from "../domain/generation-contract-v2.js";
import { archiveGenerationContractRegistryV2 } from "./generation-contract-history-v2.js";
import type { GenerationContractCatalogPort } from "../adapter/syntx/generation-contract-executor.js";

export interface BuildIdeogram4045SourceProfileV2Input {
  readonly currentRegistry: GenerationContractRegistryV2;
  readonly publicCatalog: GenerationContractCatalogPort;
  readonly rootFactsBytes: Uint8Array;
  readonly normalizerFactsBytes: Uint8Array;
  readonly normalizerCallFactsBytes: Uint8Array;
  readonly customPayloadWireFactsBytes: Uint8Array;
  readonly reviewedAt: string;
}

export interface Ideogram4045SourceProfileV2BuildResult {
  readonly registry: GenerationContractRegistryV2;
  readonly added_variant_ids: readonly ["ideogram-40-generate-source-reviewed", "ideogram-45-generate-source-reviewed"];
}

const PARENT_VERSION = "sha256-238dbb38db12d96e331d22ebb739a284de4ace404e1445b56aa87e6f02e86cfe.json";
const PARENT_REGISTRY_SHA = "sha256:386a24cc4177d34d5ed072b04e5db97991fa6653367bda6351171992fa8d2bad";
const PARENT_CATALOG_VERSION = "2026-10-08T13:18:39.393Z.36e6960df354";
const PUBLIC_CATALOG_VERSION = "2026-10-08T13:18:39.393Z.36e6960df354";
const PUBLIC_MODELS_SHA = "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444";
const ROOT_FACTS_SHA = "eba8b59332c6641db1f2b9735a5a01d955ceb4a14c9fdbc55dce72fc1ea478b6";
const NORMALIZER_FACTS_SHA = "68fc7d386eee0869328a166affb3a00ca49e6a31d72260f1189fea40cbabc340";
const NORMALIZER_CALL_FACTS_SHA = "134974688d940905a9c9f29926914c87303ee85194eb92ac1cb6144a861f8df9";
const CUSTOM_WIRE_FACTS_SHA = "1c4ed576f5de0af51a7cb53d44df6ee5947e8152b49930995b6c64d1baa1e556";
const FORM_SHA = "sha256:fb8f93597c1dc69fa811e48f5d3218ef5724d9f2f1dd175a3a63f320f930274a";
const HELPER_SHA = "sha256:d4ad75ddd2336d24cba03e1b32dc162d18ff8d7ff4b15b91ab4fd83175dcc5ac";
const WIRE_SHA = "sha256:de1f4d8ddb8f79a909aad5a0e62c876995dbaada01946e395d62a3da7e62b2ae";
const FORM_URL = "https://syntx.ai/assets/1791467421/ideogram.js";
const HELPER_URL = "https://syntx.ai/assets/1791467421/modes.registry.js";
const WIRE_URL = "https://syntx.ai/assets/1791467421/video.js";
const ROOT_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-102-ideogram-aspect-source-facts.json";
const NORMALIZER_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-102-ideogram-normalizer-facts.json";
const NORMALIZER_CALL_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-102-ideogram-normalizer-call-facts.json";
const CUSTOM_WIRE_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-155-ideogram-custom-payload-wire-facts.json";
const VARIANTS = ["ideogram-40-generate-source-reviewed", "ideogram-45-generate-source-reviewed"] as const;
const MODEL_IDS = ["ideogram_40", "ideogram_45"] as const;
const RATIOS = ["1:1", "1:3", "1:2", "2:1", "3:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "10:16", "16:10"] as const;
const RESOLUTIONS = ["1K", "2K"] as const;
const SPEEDS = ["TURBO", "DEFAULT", "QUALITY"] as const;
const MAGIC_PROMPT = ["AUTO", "ON", "OFF"] as const;
const NO_TALL_WIDE_RATIOS = RATIOS.filter((ratio) => ratio !== "1:3" && ratio !== "3:1");

const sourceRootSchema = z.object({
  schema_version: z.literal("ROOT_IDEOGRAM_ASPECT_SOURCE_V1"),
  runtime_usable: z.literal(false),
  form_source: z.object({ url: z.literal(FORM_URL), bytes: z.literal(28_373), sha256: z.literal(FORM_SHA) }).passthrough(),
  helper_source: z.object({ url: z.literal(HELPER_URL), bytes: z.literal(7_965), sha256: z.literal(HELPER_SHA) }).passthrough(),
  scope: z.object({ model_id: z.literal("ideogram"), mode: z.literal("generate"), reference_count: z.literal(0), not_models: z.array(z.string()) }).passthrough(),
  form_declarations: z.array(z.object({ name: z.string(), text: z.string() }).passthrough()),
  helper_declarations: z.array(z.object({ name: z.string(), initializer: z.string() }).passthrough())
}).passthrough();
const normalizerSchema = z.object({
  form_sha256: z.literal(FORM_SHA), helper_sha256: z.literal(HELPER_SHA),
  nodes: z.array(z.object({ kind: z.string().optional(), name: z.string().optional(), pos: z.number(), text: z.string() }).passthrough())
}).passthrough();
const normalizerCallSchema = z.object({
  form_sha256: z.literal(FORM_SHA),
  nodes: z.array(z.object({ pos: z.number(), text: z.string(), parent: z.string(), enclosing: z.string() }).passthrough())
}).passthrough();
const customWireSchema = z.object({
  schema_version: z.literal("ROOT_IDEOGRAM_CUSTOM_PAYLOAD_WIRE_V1"), runtime_usable: z.literal(false),
  source: z.object({ url: z.literal(WIRE_URL), observed_sha256: z.literal(WIRE_SHA), bytes: z.literal(8_689) }).passthrough(),
  static_function_edge: z.object({
    initial_settings: z.literal("let i={n:1,...s.settings}"), custom_branch: z.literal("l&&(i={...l})"),
    custom_branch_semantics: z.literal("TRUTHY_CUSTOM_REPLACES_SETTINGS_ENTIRELY_NOT_MERGED_NO_EXTRA_WIRE_FIELD"),
    reference_canonicalization: z.string(), request_object: z.literal("const u={chat_uuid:t,prompt:_,settings:i}"),
    n_default_retained_under_custom_branch: z.literal(false), backend_or_execution_proof: z.literal(false)
  }).passthrough()
}).passthrough();

export function buildIdeogram4045SourceProfileV2(input: BuildIdeogram4045SourceProfileV2Input): Ideogram4045SourceProfileV2BuildResult {
  const factBytes = [input.rootFactsBytes, input.normalizerFactsBytes, input.normalizerCallFactsBytes, input.customPayloadWireFactsBytes].map((bytes) => Buffer.from(bytes));
  if (factBytes.some((bytes, index) => sha256(bytes) !== [ROOT_FACTS_SHA, NORMALIZER_FACTS_SHA, NORMALIZER_CALL_FACTS_SHA, CUSTOM_WIRE_FACTS_SHA][index])) {
    throw new Error("IDEOGRAM_4045_SOURCE_FACTS_HASH_INVALID");
  }
  if (!Number.isFinite(Date.parse(input.reviewedAt))) throw new Error("IDEOGRAM_4045_REVIEW_TIME_INVALID");
  let rootFacts: z.infer<typeof sourceRootSchema>;
  let normalizerFacts: z.infer<typeof normalizerSchema>;
  let callFacts: z.infer<typeof normalizerCallSchema>;
  let wireFacts: z.infer<typeof customWireSchema>;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    rootFacts = sourceRootSchema.parse(JSON.parse(decoder.decode(factBytes[0]!)));
    normalizerFacts = normalizerSchema.parse(JSON.parse(decoder.decode(factBytes[1]!)));
    callFacts = normalizerCallSchema.parse(JSON.parse(decoder.decode(factBytes[2]!)));
    wireFacts = customWireSchema.parse(JSON.parse(decoder.decode(factBytes[3]!)));
  } catch { throw new Error("IDEOGRAM_4045_SOURCE_FACTS_INVALID"); }
  validateSourceJoin(rootFacts, normalizerFacts, callFacts, wireFacts);

  const parent = generationContractRegistryV2Schema.parse(input.currentRegistry);
  if (parent.registry_sha256 !== PARENT_REGISTRY_SHA || parent.catalog_version !== PARENT_CATALOG_VERSION || parent.contracts.length !== 43 ||
      count(parent, "live_verified") !== 10 || count(parent, "reviewed") !== 33 || parent.contracts.some((contract) => MODEL_IDS.includes(contract.model_id as typeof MODEL_IDS[number]))) {
    throw new Error("IDEOGRAM_4045_PARENT_REGISTRY_MISMATCH");
  }
  if (VARIANTS.some((variant) => parent.contracts.some((contract) => contract.variant_id === variant))) throw new Error("IDEOGRAM_4045_VARIANT_ALREADY_EXISTS");

  const current = parent.contracts.find((contract) => contract.variant_id === "ideogram-image-generate-aspect-ratio-source-reviewed");
  const publicCatalogRef = current?.provenance.references.find((reference) => reference.kind === "public_catalog");
  if (!current || current.status !== "reviewed" || current.model_id !== "ideogram" || current.ai_name !== "ideogram" ||
      current.operation_id !== "generate-image" || current.model_type !== "ideogram" || !publicCatalogRef?.sha256 ||
      current.provenance.settings_source_sha256 !== FORM_SHA) throw new Error("IDEOGRAM_4045_BASE_PROFILE_MISMATCH");

  for (const modelId of MODEL_IDS) {
    let model;
    try { model = input.publicCatalog.getModel(modelId); }
    catch { throw new Error("IDEOGRAM_4045_PUBLIC_MODEL_BINDING_INVALID"); }
    const catalogVersion = `${model.fetched_at}.${model.source_hashes.models.slice(7, 19)}`;
    if (model.id !== modelId || model.upstream_id !== modelId || !model.active || model.ai_name !== "ideogram" ||
        !model.operations.some((operation) => operation.id === "generate-image" && operation.output_modality === "image") ||
        catalogVersion !== PUBLIC_CATALOG_VERSION || model.source_hashes.ai !== parent.source_hashes.ai ||
        model.source_hashes.llm_models !== parent.source_hashes.llm_models || model.source_hashes.models !== PUBLIC_MODELS_SHA ||
        model.source_hashes.models !== parent.source_hashes.models) throw new Error("IDEOGRAM_4045_PUBLIC_MODEL_BINDING_INVALID");
  }

  const candidates = MODEL_IDS.map((modelId, index): GenerationContractV2Input => ({
    variant_id: VARIANTS[index]!, model_id: modelId, operation_id: "generate-image", modality: "image", route: "design",
    ai_name: "ideogram", model_type: modelId, status: "reviewed",
    provenance: {
      settings_source_sha256: FORM_SHA,
      references: [
        { kind: "public_catalog", reference: `catalog/public/sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json; exact ${modelId} active/upstream/ai binding`, sha256: PUBLIC_MODELS_SHA },
        { kind: "frontend_static", reference: `${FORM_URL}; model aliases, Generate controls, and explicit form-valid no-reference choices`, sha256: FORM_SHA },
        { kind: "frontend_static", reference: `${HELPER_URL}; exact ${modelId} Generate support, finite ratios/resolutions and model-specific constraints`, sha256: HELPER_SHA },
        { kind: "frontend_static", reference: `${WIRE_URL}; selected custom settings replace default settings, request shape remains {chat_uuid,prompt,settings}`, sha256: WIRE_SHA },
        { kind: "manual_review", reference: `${ROOT_FACTS_PATH}; SHA-256=${ROOT_FACTS_SHA}; build 1791467421 source facts, zero-reference Generate only; UI defaults omitted`, sha256: `sha256:${ROOT_FACTS_SHA}` },
        { kind: "manual_review", reference: `${NORMALIZER_FACTS_PATH}; SHA-256=${NORMALIZER_FACTS_SHA}; Jt allowlist and omitted fields for the source-backed no-reference path`, sha256: `sha256:${NORMALIZER_FACTS_SHA}` },
        { kind: "manual_review", reference: `${NORMALIZER_CALL_FACTS_PATH}; SHA-256=${NORMALIZER_CALL_FACTS_SHA}; selected helper-normalized object is forwarded as custom settings`, sha256: `sha256:${NORMALIZER_CALL_FACTS_SHA}` },
        { kind: "manual_review", reference: `${CUSTOM_WIRE_FACTS_PATH}; SHA-256=${CUSTOM_WIRE_FACTS_SHA}; fifth-argument replacement boundary; no backend acceptance implied`, sha256: `sha256:${CUSTOM_WIRE_FACTS_SHA}` },
        { kind: "manual_review", reference: `${PARENT_VERSION}; exact 43 parent rows retained; profiles remain reviewed, not live.` }
      ], reviewed_at: input.reviewedAt
    },
    parameters: {
      type: "object", additional_properties: false,
      required: ["prompt", "aspect_ratio", "resolution", "rendering_speed", "magic_prompt"],
      properties: {
        prompt: { type: "string", min_length: 1 },
        aspect_ratio: { type: "string", enum: [...RATIOS] },
        resolution: { type: "string", enum: [...RESOLUTIONS] },
        rendering_speed: { type: "string", enum: [...SPEEDS] },
        magic_prompt: { type: "string", enum: [...MAGIC_PROMPT] }
      },
      conditions: [],
      conditional_enums: modelId === "ideogram_45" ? [{
        field: "aspect_ratio",
        cases: [
          { when: { field: "resolution", equals: "1K" }, allowed_values: [...NO_TALL_WIDE_RATIOS] },
          { when: { field: "resolution", equals: "2K" }, allowed_values: [...RATIOS] }
        ]
      }] : []
    },
    wire: {
      dispatch_action: "generate-image", input_kind: "prompt", prompt_field: "prompt",
      settings_fields: { aspect_ratio: "aspect_ratio", resolution: "resolution", rendering_speed: "rendering_speed", magic_prompt: "magic_prompt" },
      fixed_settings: { num_images: 1, seed: null, file_urls: [] }, media_reference_fields: {}
    },
    // PNG-only is the adapter's client-acceptance allowlist, not a provider-output claim.
    output: current.output, limits: { ...current.limits, max_parameters: 5 }
  }));

  const registry = createGenerationContractRegistryV2({
    schema_version: "2.0.0", catalog_version: parent.catalog_version, source_hashes: parent.source_hashes,
    contracts: [...parent.contracts.map(stripSchemaHash), ...candidates]
  });
  const oldContractsPreserved = parent.contracts.every((old) => {
    const retained = registry.contracts.find((contract) => contract.variant_id === old.variant_id);
    return retained !== undefined && canonicalJson(retained) === canonicalJson(old);
  });
  if (!oldContractsPreserved || registry.contracts.length !== 45 || count(registry, "live_verified") !== 10 || count(registry, "reviewed") !== 35) {
    throw new Error("IDEOGRAM_4045_REGISTRY_INVARIANT_FAILED");
  }
  return Object.freeze({ registry, added_variant_ids: VARIANTS });
}

export async function archiveIdeogram4045SourceProfileV2(
  result: Ideogram4045SourceProfileV2BuildResult,
  catalogDirectory?: string
): Promise<{ readonly version: string; readonly path: string; readonly status: "created" | "existing" }> {
  const checked = generationContractRegistryV2Schema.parse(result.registry);
  if (canonicalJson(result.added_variant_ids) !== canonicalJson(VARIANTS) || checked.contracts.length !== 45 ||
      VARIANTS.some((variant) => !checked.contracts.some((contract) => contract.variant_id === variant && contract.status === "reviewed"))) {
    throw new Error("IDEOGRAM_4045_ARCHIVE_BINDING_INVALID");
  }
  return archiveGenerationContractRegistryV2(checked, catalogDirectory);
}

function validateSourceJoin(
  root: z.infer<typeof sourceRootSchema>, normalizer: z.infer<typeof normalizerSchema>,
  call: z.infer<typeof normalizerCallSchema>, wire: z.infer<typeof customWireSchema>
): void {
  const declarations = new Map(root.helper_declarations.map((declaration) => [declaration.name, declaration.initializer]));
  const aliases = declarations.get("p");
  const ratios = declarations.get("_");
  const expandedRatios = declarations.get("v");
  const resolution40 = declarations.get("R");
  const resolution45 = declarations.get("T");
  const modes = declarations.get("O");
  const speedChoices = declarations.get("n");
  const modelSpeeds = declarations.get("x");
  const magicChoices = root.form_declarations.find((declaration) => declaration.name === "X")?.text;
  const normalizerFunction = normalizer.nodes.find((node) => node.kind === "FunctionDeclaration" && node.name === "Jt")?.text;
  const callNode = call.nodes.find((node) => node.pos === 16412);
  const modelAliases = root.form_declarations.find((declaration) => declaration.name === "ie")?.text;
  if (root.scope.model_id !== "ideogram" || root.scope.mode !== "generate" || root.scope.reference_count !== 0 ||
      !MODEL_IDS.every((id) => root.scope.not_models.includes(id)) || aliases !== '{V4_0:"ideogram_40",V4_5:"ideogram_45"}' ||
      ratios !== '["1:1","1:3","3:1","2:3","3:2","3:4","4:3","4:5","5:4","9:16","16:9","10:16","16:10"]' ||
      expandedRatios !== '_.flatMap(e=>e==="1:3"?["1:2","2:1",e]:[e])' ||
      !resolution40?.includes('aspectRatios:A,defaultAspectRatio:i,resolutions:["1K","2K"]') ||
      !resolution45?.includes('ratiosBlockedByResolution:{"1K":["3:1","1:3"]}') ||
      !modes?.includes("[p.V4_0]") || !modes.includes("format:R") || !modes.includes("[p.V4_5]") || !modes.includes("format:T") ||
      !modes.includes("magic_prompt:!0,num_images:!0,seed:!0,aspect_ratio:!0,resolution:!0") ||
      !speedChoices?.includes('{value:"TURBO"},{value:"DEFAULT"},{value:"QUALITY"}') || !modelSpeeds?.includes('{value:"FLASH",requiresImage:!0}') ||
      !magicChoices?.includes('value:"AUTO"') || !magicChoices.includes('value:"ON"') || !magicChoices.includes('value:"OFF"') ||
      modelAliases !== 'ie="ideogram"' || !normalizerFunction?.includes('new Set(["model_type","image_url","reframe_mode","replace_background_mode","character_reference_mode","seed"])') ||
      !normalizerFunction.includes('v in h?!!h[v]:!1') || !normalizerFunction.includes('v==="file_urls"?!!h.mask') ||
      callNode?.text !== "Jt({...e||{}},a==null?void 0:a.length)" ||
      wire.static_function_edge.custom_branch_semantics !== "TRUTHY_CUSTOM_REPLACES_SETTINGS_ENTIRELY_NOT_MERGED_NO_EXTRA_WIRE_FIELD" ||
      !wire.static_function_edge.reference_canonicalization.includes("file_urls=ee({files:[...h,...i.file_urls||[]]})")) {
    throw new Error("IDEOGRAM_4045_SOURCE_WIRE_JOIN_INCOMPLETE");
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
