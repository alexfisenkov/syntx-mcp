import { isProxy } from "node:util/types";

export const OWNER_FLUX_IMAGE_MODELS = Object.freeze(["flux-1", "flux-pro-1.1", "flux-pro-1.1-ultra"] as const);
export type OwnerFluxImageModel = typeof OWNER_FLUX_IMAGE_MODELS[number];

const RESOLUTIONS = Object.freeze({
  "flux-1": Object.freeze(["1344x768", "1216x832", "1152x896", "1280x1024", "1024x1024", "1024x1280", "896x1152", "832x1216", "768x1344"] as const),
  "flux-pro-1.1": Object.freeze(["1152x896", "1280x1024"] as const),
  "flux-pro-1.1-ultra": Object.freeze(["3136x1344", "2752x1536", "2368x1792", "2048x2048", "1792x2368", "1536x2752", "1344x3136"] as const)
} as const);
const REFERENCE_LIMITS = Object.freeze({
  "flux-1": Object.freeze({ minimum: 0, maximum: 1 }),
  "flux-pro-1.1": Object.freeze({ minimum: 0, maximum: 0 }),
  "flux-pro-1.1-ultra": Object.freeze({ minimum: 0, maximum: 0 })
} as const);
const SOURCE_PARAMETERS = deepFreeze({
  profile_id: "flux-image-source-parameters-v1",
  models: OWNER_FLUX_IMAGE_MODELS,
  resolutions: RESOLUTIONS,
  numeric_controls: {
    cfg: { minimum: 1, maximum: 4, slider_step: 0.1, manual_values: "FINITE_IN_RANGE_NO_QUANTIZATION" as const },
    steps: { minimum: 10, maximum: 28, slider_step_default: 1, manual_values: "FINITE_IN_RANGE_NO_QUANTIZATION" as const },
    image_strength: { minimum: 0, maximum: 1, slider_step: 0.1, manual_values: "FINITE_IN_RANGE_NO_QUANTIZATION" as const },
    lora_strength: { minimum: 0, maximum: 1.5, slider_step: 0.1, manual_values: "FINITE_IN_RANGE_NO_QUANTIZATION" as const }
  },
  lora_policy: {
    model: "flux-1" as const, maximum: 3,
    item_fields: Object.freeze(["id", "url", "strength_model", "strength_clip"] as const),
    strength_clip: "MUST_EQUAL_STRENGTH_MODEL_SOURCE_SYNC" as const,
    accepted_url_shapes: Object.freeze([
      "https://civitai.com/api/download/models/<digits>",
      "https://civitai.com/models/<digits>/<slug>",
      "https://r2.syntx.ai/<path>.safetensors"
    ] as const),
    url_query_policy: "BOUNDED_OPAQUE_NONCREDENTIAL_CIVITAI_QUERY_PRESERVED_R2_QUERY_REJECTED_NO_SECRET_ECHO" as const,
    civitai_id: "MUST_MATCH_NUMERIC_MODEL_ID_IN_URL" as const,
    r2_id: "OPAQUE_SOURCE_ID_NOT_OWNED_UPLOAD_PROOF" as const,
    ownership: "SOURCE_URL_METADATA_ONLY_NATIVE_OWNED_ISSUER_REQUIRED" as const
  },
  reference_limits: REFERENCE_LIMITS,
  reference_count_confidence: "PUBLIC_CATALOG_FILE_COUNT_ONLY_NOT_OWNED_REFERENCE_OR_PROVIDER_ACCEPTANCE" as const,
  workflow_policy: "EXPLICIT_CONTROLLED_LOCAL_POLICY_CIVITAI_IFF_LORAS_NONEMPTY_OTHERWISE_DEFAULT_NOT_CALLBACK_DEFAULT_PROOF" as const,
  raw_policy: "NO_USER_CONTROL_FLUX1_AND_PRO_OMIT_ULTRA_FIXED_FALSE_NOT_WATCHER_DEFAULT_PROOF" as const,
  cost_policy: { controlled_inputs: Object.freeze([] as const), quote_or_amount: "UNPROVEN" as const },
  fixed_wire: { n: 1 as const },
  source_pins: {
    public_catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    public_catalog_fetched_at: "2026-10-08T13:18:39.393Z",
    public_models_sha256: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444",
    form_build_id: "1791467421",
    form_module: "flux.js",
    form_sha256: "sha256:80307235518f6f0c80952ce4a5a0834ee373d7294f8dc90e58748d57389de664",
    form_freshness: "ROOT590_ANONYMOUS_GET_MATCHED_PIN" as const,
    settings_helper_module: "settings3.js",
    settings_helper_sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe",
    lora_component_module: "LinkLora.vue",
    lora_component_sha256: "sha256:1f28ad5b0f171f68288c827fe0725518aab51e24c590f32a5703303f1c5fc2ba",
    source_execution: false as const
  },
  defaults: "UNKNOWN_CALLBACK_ORDER_AND_CACHED_UI_NOT_PROVEN" as const,
  dispatch_allowed: false as const,
  runtime_activation: false as const,
  backend_acceptance: "UNPROVEN" as const
});

type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export interface OwnerFluxImageLora {
  readonly id: string;
  readonly url: string;
  readonly strength_model: number;
  readonly strength_clip: number;
}
export interface OwnerFluxImageParameters {
  readonly resolution: string;
  readonly cfg: number;
  readonly steps: number;
  readonly image_strength: number;
  readonly workflow_type: "default" | "civitai";
  readonly raw: false | null;
  readonly civitai_loras: readonly OwnerFluxImageLora[];
}
export interface OwnerFluxImageNormalizedParameters {
  readonly variant: OwnerFluxImageModel;
  readonly parameters: Readonly<OwnerFluxImageParameters>;
  readonly reference_count: number;
  readonly reference_binding: Readonly<{ reference_count: number; owned_references_bound: false; provider_acceptance: "UNPROVEN" }>;
  readonly source_json_mapping: Readonly<Record<string, unknown>>;
  readonly source_mapping_confidence: "CONTROLLED_LOCAL_REQUEST_POLICY_NOT_RAW_UI_OR_WIRE_PROOF";
  readonly cost_inputs: Readonly<Record<string, never>>;
  readonly cost_input_confidence: "NO_SOURCE_COST_INPUTS_QUOTE_AND_BILLING_UNPROVEN";
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerFluxImageParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("Flux image parameters are invalid.");
    this.name = "OwnerFluxImageParametersError";
  }
}

export function getOwnerFluxImageSourceParameters(): DeepReadonly<typeof SOURCE_PARAMETERS> { return SOURCE_PARAMETERS; }

/** Validates explicit local Flux intent; no defaults, quantization, ownership grant, or dispatch are created. */
export function normalizeOwnerFluxImageParameters(input: unknown): OwnerFluxImageNormalizedParameters {
  const request = readExactRecord(input, ["variant", "reference_count", "parameters"]);
  if (!isModel(request.variant)) invalid();
  const modelId = request.variant;
  const limit = REFERENCE_LIMITS[modelId];
  if (!Number.isSafeInteger(request.reference_count) || (request.reference_count as number) < limit.minimum || (request.reference_count as number) > limit.maximum) invalid();
  const raw = readExactRecord(request.parameters, ["resolution", "cfg", "steps", "image_strength", "workflow_type", "raw", "civitai_loras"]);
  if (!isOneOf(raw.resolution, RESOLUTIONS[modelId]) || !inRange(raw.cfg, 1, 4) || !inRange(raw.steps, 10, 28) ||
      !inRange(raw.image_strength, 0, 1) || raw.raw !== (modelId === "flux-pro-1.1-ultra" ? false : null)) invalid();
  const loras = snapshotLoras(raw.civitai_loras, modelId);
  const workflow: "default" | "civitai" = loras.length > 0 ? "civitai" : "default";
  if (raw.workflow_type !== workflow) invalid();
  const parameters = deepFreeze({
    resolution: raw.resolution as string, cfg: raw.cfg as number, steps: raw.steps as number,
    image_strength: raw.image_strength as number, workflow_type: workflow,
    raw: raw.raw as false | null, civitai_loras: loras
  });
  const sourceJsonMapping: Record<string, unknown> = Object.assign(Object.create(null) as Record<string, unknown>, {
    model_type: modelId, resolution: parameters.resolution, cfg: parameters.cfg, steps: parameters.steps,
    image_strength: parameters.image_strength, workflow_type: parameters.workflow_type, n: 1, file_urls: Object.freeze([])
  });
  if (modelId === "flux-1") sourceJsonMapping.civitai_loras = parameters.civitai_loras;
  if (parameters.raw === false) sourceJsonMapping.raw = false;
  return deepFreeze({
    variant: modelId, parameters, reference_count: request.reference_count as number,
    reference_binding: { reference_count: request.reference_count as number, owned_references_bound: false as const, provider_acceptance: "UNPROVEN" as const },
    source_json_mapping: sourceJsonMapping,
    source_mapping_confidence: "CONTROLLED_LOCAL_REQUEST_POLICY_NOT_RAW_UI_OR_WIRE_PROOF" as const,
    cost_inputs: Object.freeze(Object.create(null) as Record<string, never>),
    cost_input_confidence: "NO_SOURCE_COST_INPUTS_QUOTE_AND_BILLING_UNPROVEN" as const,
    dispatch_allowed: false as const, runtime_activation: false as const, backend_acceptance: "UNPROVEN" as const
  });
}

function snapshotLoras(value: unknown, modelId: OwnerFluxImageModel): readonly OwnerFluxImageLora[] {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expected = ["length", ...Array.from({ length: value.length }, (_, index) => String(index))];
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== expected.length || keys.some((key) => typeof key !== "string" || !expected.includes(key))) invalid();
  const maximum = modelId === "flux-1" ? 3 : 0;
  if (value.length > maximum) invalid();
  const result: OwnerFluxImageLora[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) invalid();
    const item = readExactRecord(descriptor.value, ["id", "url", "strength_model", "strength_clip"]);
    if (typeof item.id !== "string" || item.id.length < 1 || item.id.length > 256 ||
        typeof item.url !== "string" || item.url.length < 1 || item.url.length > 2_048 ||
        !inRange(item.strength_model, 0, 1.5) || item.strength_clip !== item.strength_model) invalid();
    validateLoraUrl(item.id, item.url);
    result.push(Object.freeze({ id: item.id, url: item.url, strength_model: item.strength_model as number, strength_clip: item.strength_clip as number }));
  }
  return Object.freeze(result);
}

function validateLoraUrl(id: string, value: string): void {
  let url: URL;
  try { url = new URL(value); } catch { invalid(); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || value !== url.href) invalid();
  const civitaiModelPath = /^\/models\/\d+\/[A-Za-z0-9_-]+$/u.test(url.pathname) && url.pathname.split("/")[2] === id;
  if (url.hostname === "civitai.com" && url.port === "" && /^\d+$/u.test(id) &&
      (url.pathname === `/api/download/models/${id}` || civitaiModelPath)) {
    validateCivitQuery(url);
    return;
  }
  if (url.hostname === "r2.syntx.ai" && url.port === "" && !url.search &&
      /^\/(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+\.safetensors$/u.test(url.pathname)) {
    const basename = url.pathname.slice(url.pathname.lastIndexOf("/") + 1).replace(/\.safetensors$/u, "");
    if (basename === id) return;
  }
  invalid();
}

function validateCivitQuery(url: URL): void {
  if (!url.search) return;
  if (url.search.length > 1_024) invalid();
  const seen = new Set<string>();
  let count = 0;
  for (const [key, value] of url.searchParams) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
    if (++count > 16 || key.length < 1 || key.length > 64 || value.length > 256 ||
        /[\u0000-\u001f\u007f]/u.test(key + value) || seen.has(normalizedKey) ||
        ["token", "apikey", "password", "passwd", "secret", "signature", "sig", "credential", "authorization", "bearer", "session", "jwt", "accesskey", "clientsecret", "privatekey"].some((term) => normalizedKey.includes(term)) ||
        /^(?:bearer|basic)\s+/iu.test(value) || /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/u.test(value)) invalid();
    seen.add(normalizedKey);
  }
}

function readExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!plainRecord(value)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function isModel(value: unknown): value is OwnerFluxImageModel { return typeof value === "string" && (OWNER_FLUX_IMAGE_MODELS as readonly string[]).includes(value); }
function isOneOf<T>(value: unknown, values: readonly T[]): value is T { return values.includes(value as T); }
function inRange(value: unknown, minimum: number, maximum: number): value is number { return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum; }
function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}
function invalid(): never { throw new OwnerFluxImageParametersError("INVALID_PARAMETERS"); }
