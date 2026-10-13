import { isProxy } from "node:util/types";

const VARIANTS = Object.freeze([
  "wan_25_i2i_preview", "wan_26_image", "wan_27_image", "wan_27_image_pro"
] as const);
const PARAMETER_KEYS = Object.freeze([
  "aspect_ratio", "resolution", "batch_size", "prompt_extend", "seed", "color_palette", "bbox_list"
] as const);

const ASPECT_RATIOS = Object.freeze({
  wan_25_i2i_preview: Object.freeze(["1:1", "3:4", "4:3", "9:16", "16:9"] as const),
  wan_26_image: Object.freeze(["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"] as const),
  wan_27_image: Object.freeze(["1:1", "1:2", "2:1", "1:3", "3:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const),
  wan_27_image_pro: Object.freeze(["1:1", "1:2", "2:1", "1:3", "3:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const)
} as const);

const RESOLUTIONS = Object.freeze({
  wan_25_i2i_preview: Object.freeze(["720P"] as const),
  wan_26_image: Object.freeze(["720P", "1080P"] as const),
  wan_27_image: Object.freeze(["1K", "2K"] as const),
  wan_27_image_pro: Object.freeze(["1K", "2K", "4K"] as const)
} as const);

const REFERENCE_LIMITS = Object.freeze({
  wan_25_i2i_preview: Object.freeze({ minimum: 1, maximum: 3 }),
  wan_26_image: Object.freeze({ minimum: 1, maximum: 4 }),
  wan_27_image: Object.freeze({ minimum: 0, maximum: 9 }),
  wan_27_image_pro: Object.freeze({ minimum: 0, maximum: 9 })
} as const);

const SOURCE_PARAMETERS = deepFreeze({
  ai_name: "wan_image" as const,
  variants: VARIANTS,
  parameter_keys: PARAMETER_KEYS,
  controls: {
    aspect_ratio: { kind: "string_enum" as const, variants: ASPECT_RATIOS },
    resolution: { kind: "string_enum" as const, variants: RESOLUTIONS },
    batch_size: {
      kind: "integer" as const,
      range: { minimum: 1, maximum: 4 },
      source_note: "Rendered choices 1..4; no per-variant cap observed; backend acceptance unproven"
    },
    prompt_extend: { kind: "boolean" as const, variants: { ...allVariantMap(true) } },
    seed: {
      kind: "nullable_integer" as const,
      minimum: 0,
      maximum: 2_147_483_647,
      null_semantics: "UNPROVEN",
      zero_semantics: "UNPROVEN"
    },
    bbox_list: {
      kind: "ordered_per_reference_rectangles" as const,
      active_by_variant: { wan_25_i2i_preview: false, wan_26_image: false, wan_27_image: true, wan_27_image_pro: true },
      rectangles_per_reference: { minimum: 0, maximum: 2 },
      coordinates: "NONNEGATIVE_INTEGER_LEFT_TOP_RIGHT_BOTTOM_WITH_POSITIVE_AREA",
      inactive_state: "ONE_EMPTY_ENTRY_PER_EXPLICIT_REFERENCE_COUNT",
      association: "ORDERED_REFERENCE_INDEX_ONLY; NO OWNED HANDLE ASSOCIATION HERE",
      geometry_boundary: "BROWSER_NATURAL_PIXEL_COORDINATES; CONTAINER_EQUIVALENCE_UNPROVEN"
    },
    color_palette: {
      kind: "nullable_palette" as const,
      active_by_variant: { wan_25_i2i_preview: false, wan_26_image: false, wan_27_image: true, wan_27_image_pro: true },
      colors: { minimum: 3, maximum: 10 },
      hex: "UPPERCASE_HASH_PREFIXED_HEX6",
      ratio: "CANONICAL_INTEGER_PERCENTAGE_NN.00%; TOTAL_100; EACH_AT_LEAST_1_PERCENT",
      inactive_state: null
    }
  },
  conditions: {
    wan_27_image_pro_4k: "REJECT_WHEN_REFERENCE_COUNT_IS_NONZERO; NEVER_COERCE_TO_2K",
    reference_count: "EXPLICIT_INPUT_COUNT_WITHIN_SELECTED_FORM_AND_CATALOG_LIMITS"
  },
  reference_limits: REFERENCE_LIMITS,
  cost_boundary: {
    declared_cost_metadata_keys: Object.freeze(["size", "batch_size"] as const),
    effective_cost_input_keys: Object.freeze(["batch_size"] as const),
    size: "NO_CONTROLLED_VALUE; OMITTED_BY_SOURCE_SERIALIZER",
    quote_or_cost_amount: "NOT_ESTABLISHED"
  },
  source_pins: {
    public_catalog: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    settings_inventory: "sha256:00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61",
    form_sha256: "sha256:c1190674e29d4b943eaa3bfb3571a8716f4a9901de433fc423840aed393f11a3",
    seed_helper_sha256: "sha256:c95fc355e29e33f6c3998cb62cc2da4d0879cc1ff4fb524e826e74bb24cd792b",
    palette_helper_sha256: "sha256:8062897bb3259b540840c65ad99af558a991d106b1b658f3eb1de3e9b06dc348"
  },
  effective_defaults: "UNKNOWN",
  dispatch_allowed: false as const,
  runtime_activation: false as const,
  backend_acceptance: "UNPROVEN" as const,
  output_batch_cardinality: "UNPROVEN",
  output_geometry: "UNPROVEN"
});

type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export type OwnerWanImageVariant = typeof VARIANTS[number];
export type OwnerWanImageResolution = typeof RESOLUTIONS[OwnerWanImageVariant][number];
export type OwnerWanImageParameters = Readonly<{
  aspect_ratio: string;
  resolution: OwnerWanImageResolution;
  batch_size: number;
  prompt_extend: boolean;
  seed: number | null;
  color_palette: readonly OwnerWanImagePaletteColor[] | null;
  bbox_list: readonly (readonly OwnerWanImageRectangle[])[];
}>;
export type OwnerWanImageRectangle = readonly [left: number, top: number, right: number, bottom: number];
export type OwnerWanImagePaletteColor = Readonly<{ hex: string; ratio: string }>;

export interface OwnerWanImageNormalizedParameters {
  readonly ai_name: "wan_image";
  readonly model_id: OwnerWanImageVariant;
  readonly variant: OwnerWanImageVariant;
  readonly parameters: OwnerWanImageParameters;
  readonly reference_count: number;
  readonly reference_binding: Readonly<{
    reference_count: number;
    bbox_association: "ORDERED_INDEX_ONLY";
    owned_references_bound: false;
    browser_natural_dimensions_verified: false;
    container_geometry_equivalence: "UNPROVEN";
  }>;
  readonly cost_inputs: Readonly<{ batch_size: number }>;
  readonly cost_input_confidence: "SOURCE_JOINED_BATCH_SIZE_ONLY";
  readonly cost_boundary: "NO_SIZE_CONTROL_OR_RESOLUTION_MAPPING";
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerWanImageParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("WAN image parameters are invalid.");
    this.name = "OwnerWanImageParametersError";
  }
}

/** Static selected-source controls only; effective defaults and provider acceptance remain unproven. */
export function getOwnerWanImageSourceParameters(): DeepReadonly<typeof SOURCE_PARAMETERS> {
  return SOURCE_PARAMETERS;
}

/** Validates a full explicit state and reference-count boundary; creates no upload or dispatch capability. */
export function normalizeOwnerWanImageParameters(input: unknown): OwnerWanImageNormalizedParameters {
  const request = readExactRecord(input, ["variant", "reference_count", "parameters"]);
  if (!isVariant(request.variant)) invalid();
  const variant = request.variant;
  const limits = REFERENCE_LIMITS[variant];
  if (!Number.isSafeInteger(request.reference_count) ||
      (request.reference_count as number) < limits.minimum || (request.reference_count as number) > limits.maximum) invalid();
  const referenceCount = request.reference_count as number;
  const raw = readExactRecord(request.parameters, PARAMETER_KEYS);
  const parameters = snapshotParameters(raw, variant, referenceCount);
  return deepFreeze({
    ai_name: "wan_image" as const,
    model_id: variant,
    variant,
    parameters,
    reference_count: referenceCount,
    cost_inputs: { batch_size: parameters.batch_size },
    cost_input_confidence: "SOURCE_JOINED_BATCH_SIZE_ONLY" as const,
    reference_binding: {
      reference_count: referenceCount,
      bbox_association: "ORDERED_INDEX_ONLY" as const,
      owned_references_bound: false as const,
      browser_natural_dimensions_verified: false as const,
      container_geometry_equivalence: "UNPROVEN" as const
    },
    cost_boundary: "NO_SIZE_CONTROL_OR_RESOLUTION_MAPPING" as const,
    dispatch_allowed: false as const,
    runtime_activation: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

function snapshotParameters(raw: Record<string, unknown>, variant: OwnerWanImageVariant, referenceCount: number): OwnerWanImageParameters {
  if (!isOneOf(raw.aspect_ratio, ASPECT_RATIOS[variant]) || !isOneOf(raw.resolution, RESOLUTIONS[variant]) ||
      !Number.isInteger(raw.batch_size) || (raw.batch_size as number) < 1 || (raw.batch_size as number) > 4 ||
      typeof raw.prompt_extend !== "boolean" ||
      !(raw.seed === null || (Number.isSafeInteger(raw.seed) && (raw.seed as number) >= 0 && (raw.seed as number) <= 2_147_483_647))) invalid();

  if (variant === "wan_27_image_pro" && raw.resolution === "4K" && referenceCount > 0) invalid();

  const colorPalette = snapshotPalette(raw.color_palette, variant);
  const bboxList = snapshotBboxList(raw.bbox_list, variant, referenceCount);
  return deepFreeze({
    aspect_ratio: raw.aspect_ratio,
    resolution: raw.resolution,
    batch_size: raw.batch_size as number,
    prompt_extend: raw.prompt_extend,
    seed: raw.seed as number | null,
    color_palette: colorPalette,
    bbox_list: bboxList
  });
}

function snapshotPalette(value: unknown, variant: OwnerWanImageVariant): readonly OwnerWanImagePaletteColor[] | null {
  if (variant === "wan_25_i2i_preview" || variant === "wan_26_image") {
    if (value !== null) invalid();
    return null;
  }
  if (value === null) return null;
  const colors = readExactArray(value, 3, 10);
  const result: OwnerWanImagePaletteColor[] = [];
  let total = 0;
  for (const item of colors) {
    const color = readExactRecord(item, ["hex", "ratio"]);
    if (typeof color.hex !== "string" || !/^#[0-9A-F]{6}$/.test(color.hex) || typeof color.ratio !== "string") invalid();
    const match = /^(100|[1-9]\d?)\.00%$/.exec(color.ratio);
    if (!match) invalid();
    const percent = Number(match[1]);
    if (percent < 1 || percent > 100) invalid();
    total += percent;
    result.push({ hex: color.hex, ratio: color.ratio });
  }
  if (total !== 100) invalid();
  return result;
}

function snapshotBboxList(value: unknown, variant: OwnerWanImageVariant, referenceCount: number): readonly (readonly OwnerWanImageRectangle[])[] {
  const entries = readExactArray(value, referenceCount, referenceCount);
  const result: OwnerWanImageRectangle[][] = [];
  for (const entry of entries) {
    const rectangles = readExactArray(entry, 0, 2);
    if (variant === "wan_25_i2i_preview" || variant === "wan_26_image") {
      if (rectangles.length !== 0) invalid();
      result.push([]);
      continue;
    }
    const snapshot: OwnerWanImageRectangle[] = [];
    for (const rectangle of rectangles) {
      const coordinates = readExactArray(rectangle, 4, 4);
      if (!coordinates.every((coordinate): coordinate is number =>
        typeof coordinate === "number" && Number.isSafeInteger(coordinate) && coordinate >= 0)) invalid();
      const [left, top, right, bottom] = coordinates as [number, number, number, number];
      if (left >= right || top >= bottom) invalid();
      snapshot.push([left, top, right, bottom]);
    }
    result.push(snapshot);
  }
  return result;
}

function readExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) snapshot[key] = descriptors[key]!.value;
  return snapshot;
}

function readExactArray(value: unknown, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || (length as number) < minimum || (length as number) > maximum) invalid();
  const size = length as number;
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== size + 1 || keys.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= size ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) invalid();
  const result: unknown[] = [];
  for (let index = 0; index < size; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) invalid();
    result.push(descriptor.value);
  }
  return result;
}

function isVariant(value: unknown): value is OwnerWanImageVariant {
  return isOneOf(value, VARIANTS);
}

function isOneOf<T>(value: unknown, choices: readonly T[]): value is T {
  return choices.includes(value as T);
}

function allVariantMap(value: true): Record<OwnerWanImageVariant, true> {
  return Object.fromEntries(VARIANTS.map((variant) => [variant, value])) as Record<OwnerWanImageVariant, true>;
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}

function invalid(): never {
  throw new OwnerWanImageParametersError("INVALID_PARAMETERS");
}
