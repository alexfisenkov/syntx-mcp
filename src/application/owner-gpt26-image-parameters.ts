import { isProxy } from "node:util/types";

export const OWNER_GPT26_IMAGE_VARIANTS = Object.freeze(["gpt-image-2.6-flare", "gpt-image-2.6-sunburst"] as const);
export type OwnerGpt26ImageVariant = typeof OWNER_GPT26_IMAGE_VARIANTS[number];
const RATIOS = Object.freeze(["1:1", "16:9", "9:16", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "21:9"] as const);
const GIF_RATIOS = Object.freeze(["1:1", "16:9", "9:16"] as const);
const QUALITY = Object.freeze(["1K", "2K", "4K"] as const);
const DETAILS = Object.freeze(["low", "medium", "high", "xhigh", "max"] as const);
const FORMATS = Object.freeze(["png", "jpg", "webp", "gif"] as const);

export const OWNER_GPT26_IMAGE_SOURCE_CONTROLS = Object.freeze({
  variants: OWNER_GPT26_IMAGE_VARIANTS, ratios: RATIOS, gif_ratios: GIF_RATIOS,
  quality: QUALITY, details_quality: DETAILS, output_format: FORMATS,
  reference_limit: 16, max_total_file_size: 83_886_080,
  form_build: "1794311734", form_sha256: "sha256:00f3e94fc089ec27b935d1cbd7386fcc8ae9fa1f18237041969cd2d93b518354",
  source_evidence: "STATIC_FORM_AND_PUBLIC_CATALOG_NOT_RENDERED_UI_OR_PROVIDER_ACCEPTANCE"
} as const);

export interface OwnerGpt26ImageNormalizedParameters {
  readonly ai_name: "sora-images";
  readonly model_id: OwnerGpt26ImageVariant;
  readonly variant: OwnerGpt26ImageVariant;
  readonly parameters: Readonly<{ aspect_ratio: string; quality: string; details_quality: string; output_format: string }>;
  readonly source_wire_settings: Readonly<{ aspect_ratio: string; quality: string; details_quality: string; output_format: string }>;
  readonly cost_inputs: Readonly<{ quality: string; details_quality: string; output_format: string; ref_count?: number }>;
  readonly reference_count: number;
  readonly cost_input_confidence: "SOURCE_JOINED_CONTROLLED_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP";
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerGpt26ImageParametersError extends Error {
  readonly code = "INVALID_PARAMETERS" as const;
  constructor() { super("GPT Image 2.6 parameters are invalid."); this.name = "OwnerGpt26ImageParametersError"; }
}

export function normalizeOwnerGpt26ImageParameters(input: unknown): OwnerGpt26ImageNormalizedParameters {
  const request = exact(input, ["variant", "reference_count", "parameters"]);
  if (!OWNER_GPT26_IMAGE_VARIANTS.includes(request.variant as OwnerGpt26ImageVariant) ||
      !Number.isSafeInteger(request.reference_count) || (request.reference_count as number) < 0 ||
      (request.reference_count as number) > 16) invalid();
  const parameters = exact(request.parameters, ["aspect_ratio", "quality", "details_quality", "output_format"]);
  if (!FORMATS.includes(parameters.output_format as typeof FORMATS[number]) ||
      !RATIOS.includes(parameters.aspect_ratio as typeof RATIOS[number]) ||
      !QUALITY.includes(parameters.quality as typeof QUALITY[number]) ||
      !DETAILS.includes(parameters.details_quality as typeof DETAILS[number])) invalid();
  if (parameters.output_format === "gif" &&
      (parameters.quality !== "1K" || !GIF_RATIOS.includes(parameters.aspect_ratio as typeof GIF_RATIOS[number]))) invalid();
  const wire = Object.freeze({
    aspect_ratio: parameters.aspect_ratio as string, quality: parameters.quality as string,
    details_quality: parameters.details_quality as string, output_format: parameters.output_format as string
  });
  const refCount = request.reference_count as number;
  return Object.freeze({
    ai_name: "sora-images", model_id: request.variant as OwnerGpt26ImageVariant,
    variant: request.variant as OwnerGpt26ImageVariant, parameters: wire, source_wire_settings: wire,
    reference_count: refCount,
    cost_inputs: Object.freeze({ quality: wire.quality, details_quality: wire.details_quality,
      output_format: wire.output_format, ...(refCount === 0 ? {} : { ref_count: refCount }) }),
    cost_input_confidence: "SOURCE_JOINED_CONTROLLED_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP",
    dispatch_allowed: false, runtime_activation: false, backend_acceptance: "UNPROVEN"
  });
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const found = Reflect.ownKeys(descriptors);
  if (found.length !== keys.length || found.some(key => typeof key !== "string" || !keys.includes(key) ||
      !("value" in descriptors[key]!) || !descriptors[key]!.enumerable)) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) result[key] = descriptors[key]!.value;
  return result;
}

function invalid(): never { throw new OwnerGpt26ImageParametersError(); }
