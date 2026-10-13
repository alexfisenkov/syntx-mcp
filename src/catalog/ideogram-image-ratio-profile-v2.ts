import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { archiveGenerationContractRegistryV2 } from "./generation-contract-history-v2.js";
import { canonicalJson } from "../domain/generation-contract.js";
import {
  createGenerationContractRegistryV2,
  generationContractRegistryV2Schema,
  type GenerationContractRegistryV2,
  type GenerationContractV2Input
} from "../domain/generation-contract-v2.js";

export interface BuildIdeogramImageRatioProfileV2Input {
  readonly currentRegistry: GenerationContractRegistryV2;
  readonly rootFactsBytes: Uint8Array;
  readonly normalizerFactsBytes: Uint8Array;
  readonly normalizerCallFactsBytes: Uint8Array;
  readonly reviewedAt: string;
}

export interface IdeogramImageRatioProfileBuildResult {
  readonly registry: GenerationContractRegistryV2;
  readonly added_variant_id: typeof VARIANT_ID;
}

const PARENT_VERSION = "sha256-0e5b7a6ab56a4fc5103c025690293297b49258c1c876d7a0a663ff7959099d39.json";
const PARENT_SHA256 = "sha256:2f8cf81a41efece59008a919924975cbd2e379569784565b7643f2a225a017fd";
const PARENT_CATALOG_VERSION = "2026-10-08T13:18:39.393Z.36e6960df354";
const SOURCE_FACTS_SHA256 = "eba8b59332c6641db1f2b9735a5a01d955ceb4a14c9fdbc55dce72fc1ea478b6";
const NORMALIZER_FACTS_SHA256 = "68fc7d386eee0869328a166affb3a00ca49e6a31d72260f1189fea40cbabc340";
const NORMALIZER_CALL_FACTS_SHA256 = "134974688d940905a9c9f29926914c87303ee85194eb92ac1cb6144a861f8df9";
const FORM_SHA256 = "sha256:fb8f93597c1dc69fa811e48f5d3218ef5724d9f2f1dd175a3a63f320f930274a";
const HELPER_SHA256 = "sha256:d4ad75ddd2336d24cba03e1b32dc162d18ff8d7ff4b15b91ab4fd83175dcc5ac";
const FORM_URL = "https://syntx.ai/assets/1791467421/ideogram.js";
const HELPER_URL = "https://syntx.ai/assets/1791467421/modes.registry.js";
const VARIANT_ID = "ideogram-image-generate-aspect-ratio-source-reviewed";
const CURRENT_VARIANT_ID = "legacy-image-ideogram-default";
const ROOT_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-102-ideogram-aspect-source-facts.json";
const NORMALIZER_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-102-ideogram-normalizer-facts.json";
const NORMALIZER_CALL_FACTS_PATH = ".autopilot/2026-10-08-syntx-completion--wip/root-102-ideogram-normalizer-call-facts.json";
const RATIOS = ["1:1", "1:3", "3:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "10:16", "16:10"] as const;
const HASH = /^sha256:[a-f0-9]{64}$/u;

const ratioFactsSchema = z.object({
  schema_version: z.literal("ROOT_IDEOGRAM_ASPECT_SOURCE_V1"),
  runtime_usable: z.literal(false),
  form_source: z.object({ bytes: z.literal(28_373), sha256: z.literal(FORM_SHA256) }).passthrough(),
  helper_source: z.object({ bytes: z.literal(7_965), sha256: z.literal(HELPER_SHA256) }).passthrough(),
  scope: z.object({
    model_id: z.literal("ideogram"), mode: z.literal("generate"), reference_count: z.literal(0),
    not_models: z.array(z.string()), not_custom_resolution: z.literal(true)
  }).passthrough(),
  form_declarations: z.array(z.object({ name: z.string(), pos: z.number(), text: z.string() }).passthrough()),
  helper_declarations: z.array(z.object({ name: z.string(), pos: z.number(), initializer: z.string() }).passthrough())
}).passthrough();

const normalizerFactsSchema = z.object({
  form_sha256: z.literal(FORM_SHA256), helper_sha256: z.literal(HELPER_SHA256),
  nodes: z.array(z.object({ kind: z.string().optional(), name: z.string().optional(), pos: z.number(), text: z.string() }).passthrough())
}).passthrough();

const normalizerCallFactsSchema = z.object({
  form_sha256: z.literal(FORM_SHA256),
  nodes: z.array(z.object({ pos: z.number(), text: z.string(), parent: z.string(), enclosing: z.string() }).passthrough())
}).passthrough();

export function buildIdeogramImageRatioProfileV2(input: BuildIdeogramImageRatioProfileV2Input): IdeogramImageRatioProfileBuildResult {
  const sourceBytes = Buffer.from(input.rootFactsBytes);
  const normalizerBytes = Buffer.from(input.normalizerFactsBytes);
  const callBytes = Buffer.from(input.normalizerCallFactsBytes);
  if (sha256(sourceBytes) !== SOURCE_FACTS_SHA256 || sha256(normalizerBytes) !== NORMALIZER_FACTS_SHA256 ||
      sha256(callBytes) !== NORMALIZER_CALL_FACTS_SHA256) throw new Error("IDEOGRAM_RATIO_SOURCE_FACTS_HASH_INVALID");
  if (!Number.isFinite(Date.parse(input.reviewedAt))) throw new Error("IDEOGRAM_RATIO_REVIEW_TIME_INVALID");

  const sourceFacts = ratioFactsSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes)));
  const normalizerFacts = normalizerFactsSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(normalizerBytes)));
  const callFacts = normalizerCallFactsSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(callBytes)));
  validateSourceJoin(sourceFacts, normalizerFacts, callFacts);

  const parent = generationContractRegistryV2Schema.parse(input.currentRegistry);
  if (parent.registry_sha256 !== PARENT_SHA256 || parent.catalog_version !== PARENT_CATALOG_VERSION || parent.contracts.length !== 40 ||
      count(parent, "live_verified") !== 9 || count(parent, "reviewed") !== 31) throw new Error("IDEOGRAM_RATIO_PARENT_REGISTRY_MISMATCH");
  if (parent.contracts.some((contract) => contract.variant_id === VARIANT_ID)) throw new Error("IDEOGRAM_RATIO_VARIANT_ALREADY_EXISTS");

  const current = parent.contracts.find((contract) => contract.variant_id === CURRENT_VARIANT_ID);
  const publicCatalogRef = current?.provenance.references.find((reference) => reference.kind === "public_catalog");
  if (!current || current.status !== "live_verified" || current.model_id !== "ideogram" || current.ai_name !== "ideogram" ||
      current.operation_id !== "generate-image" || current.model_type !== "ideogram" || current.provenance.settings_source_sha256 !== FORM_SHA256 ||
      current.wire.fixed_settings.aspect_ratio !== "1:1" || Object.keys(current.wire.settings_fields).length !== 0 ||
      current.parameters.required.length !== 1 || current.parameters.required[0] !== "prompt" || !publicCatalogRef?.sha256 ||
      !HASH.test(publicCatalogRef.sha256)) throw new Error("IDEOGRAM_RATIO_CURRENT_PROFILE_MISMATCH");

  const ratioDeclaration = sourceFacts.helper_declarations.find((declaration) => declaration.name === "_");
  const ratios = ratioDeclaration === undefined ? null : parseRatioLiteralArray(ratioDeclaration.initializer);
  if (ratios === null || JSON.stringify(ratios) !== JSON.stringify(RATIOS) ||
      !sourceFacts.scope.not_models.includes("ideogram_40") || !sourceFacts.scope.not_models.includes("ideogram_45")) {
    throw new Error("IDEOGRAM_RATIO_CHOICES_INVALID");
  }

  const { aspect_ratio: _fixedRatio, ...fixedSettings } = current.wire.fixed_settings;
  const candidate: GenerationContractV2Input = {
    variant_id: VARIANT_ID,
    model_id: current.model_id,
    operation_id: current.operation_id,
    modality: current.modality,
    route: current.route,
    ai_name: current.ai_name,
    model_type: current.model_type,
    status: "reviewed",
    provenance: {
      settings_source_sha256: FORM_SHA256,
      references: [
        publicCatalogRef,
        { kind: "frontend_static", reference: `${FORM_URL}; current model/mode/aspect-ratio control`, sha256: FORM_SHA256 },
        { kind: "frontend_static", reference: `${HELPER_URL}; current Ideogram generate-mode ratio candidates`, sha256: HELPER_SHA256 },
        { kind: "manual_review", reference: `${ROOT_FACTS_PATH}; SHA-256=${SOURCE_FACTS_SHA256}; exact 13 base-ratio literals, generate mode, zero references; CUSTOM/null excluded`, sha256: `sha256:${SOURCE_FACTS_SHA256}` },
        { kind: "manual_review", reference: `${NORMALIZER_FACTS_PATH}; SHA-256=${NORMALIZER_FACTS_SHA256}; Jt keeps aspect_ratio for this no-reference generation candidate`, sha256: `sha256:${NORMALIZER_FACTS_SHA256}` },
        { kind: "manual_review", reference: `${NORMALIZER_CALL_FACTS_PATH}; SHA-256=${NORMALIZER_CALL_FACTS_SHA256}; form caller invokes Jt before setCustomSettingPayload`, sha256: `sha256:${NORMALIZER_CALL_FACTS_SHA256}` },
        { kind: "manual_review", reference: `${PARENT_VERSION} exact accepted prepared tuple used as baseline; only aspect_ratio is selectable here, and changed-ratio backend acceptance is not established.` }
      ],
      reviewed_at: input.reviewedAt
    },
    parameters: {
      type: "object",
      additional_properties: false,
      required: ["prompt", "aspect_ratio"],
      properties: { prompt: { type: "string", min_length: 1 }, aspect_ratio: { type: "string", enum: [...ratios] } },
      conditions: [],
      conditional_enums: []
    },
    wire: {
      ...current.wire,
      settings_fields: { aspect_ratio: "aspect_ratio" },
      fixed_settings: fixedSettings
    },
    output: current.output,
    limits: { ...current.limits, max_parameters: 2 }
  };

  const registry = createGenerationContractRegistryV2({
    schema_version: "2.0.0", catalog_version: parent.catalog_version, source_hashes: parent.source_hashes,
    contracts: [...parent.contracts.map(stripSchemaHash), candidate]
  });
  const oldContractsPreserved = parent.contracts.every((old) => {
    const retained = registry.contracts.find((contract) => contract.variant_id === old.variant_id);
    return retained !== undefined && canonicalJson(retained) === canonicalJson(old);
  });
  if (!oldContractsPreserved || registry.contracts.length !== 41 || count(registry, "live_verified") !== 9 || count(registry, "reviewed") !== 32) {
    throw new Error("IDEOGRAM_RATIO_REGISTRY_INVARIANT_FAILED");
  }
  return Object.freeze({ registry, added_variant_id: VARIANT_ID });
}

export async function archiveIdeogramImageRatioProfileV2(
  result: IdeogramImageRatioProfileBuildResult,
  catalogDirectory?: string
): Promise<{ readonly version: string; readonly path: string; readonly status: "created" | "existing" }> {
  const checked = generationContractRegistryV2Schema.parse(result.registry);
  if (result.added_variant_id !== VARIANT_ID || !checked.contracts.some((contract) => contract.variant_id === VARIANT_ID && contract.status === "reviewed")) {
    throw new Error("IDEOGRAM_RATIO_ARCHIVE_BINDING_INVALID");
  }
  return archiveGenerationContractRegistryV2(checked, catalogDirectory);
}

function validateSourceJoin(
  source: z.infer<typeof ratioFactsSchema>,
  normalizer: z.infer<typeof normalizerFactsSchema>,
  call: z.infer<typeof normalizerCallFactsSchema>
): void {
  const form = source.form_declarations.find((declaration) => declaration.name === "Zt");
  const ratioControl = source.form_declarations.find((declaration) => declaration.name === "ce");
  const modelSelector = source.form_declarations.find((declaration) => declaration.name === "g");
  const modeResolver = source.form_declarations.find((declaration) => declaration.name === "_");
  const baseMode = source.helper_declarations.find((declaration) => declaration.name === "I");
  const modelOverrides = source.helper_declarations.find((declaration) => declaration.name === "p");
  const modelResolver = source.helper_declarations.find((declaration) => declaration.name === "k");
  const normalizerFunction = normalizer.nodes.find((node) => node.kind === "FunctionDeclaration" && node.name === "Jt");
  const normalizerCaller = normalizer.nodes.find((node) => node.kind === "Caller" && node.pos === 16_540);
  const normalizerCall = call.nodes.find((node) => node.pos === 16_412);
  if (form === undefined || !form.text.includes("setCustomSettingPayload(i)") ||
      ratioControl === undefined || !ratioControl.text.includes("aspectRatios") ||
      modelSelector === undefined || !modelSelector.text.includes("$e(l.settings.model_type)") ||
      modeResolver === undefined || !modeResolver.text.includes("ze(g.value[l.settings.mode],q())") ||
      baseMode === undefined || !baseMode.initializer.includes("[u.GENERATE]") || !baseMode.initializer.includes("aspect_ratio:!0") ||
      modelOverrides === undefined || !modelOverrides.initializer.includes("ideogram_40") || !modelOverrides.initializer.includes("ideogram_45") ||
      modelResolver === undefined || !modelResolver.initializer.includes("O[e]||I") ||
      normalizerFunction === undefined || !normalizerFunction.text.includes("ze(D[c],o)") ||
      !normalizerFunction.text.includes("delete S.aspect_ratio") || !normalizerFunction.text.includes("d===\"\"" ) ||
      normalizerCaller === undefined || !normalizerCaller.text.includes("setCustomSettingPayload(i)") ||
      normalizerCall === undefined || !normalizerCall.enclosing.includes("Jt({...e||{}},a==null?void 0:a.length)")) {
    throw new Error("IDEOGRAM_RATIO_SOURCE_JOIN_INCOMPLETE");
  }
}

function parseRatioLiteralArray(source: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(source);
    return Array.isArray(parsed) && parsed.every((value) => typeof value === "string") ? parsed : null;
  } catch { return null; }
}

function stripSchemaHash(contract: GenerationContractRegistryV2["contracts"][number]): GenerationContractV2Input {
  const { schema_hash: _schemaHash, ...withoutHash } = contract;
  return withoutHash;
}

function count(registry: Pick<GenerationContractRegistryV2, "contracts">, status: "live_verified" | "reviewed"): number {
  return registry.contracts.filter((contract) => contract.status === status).length;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
