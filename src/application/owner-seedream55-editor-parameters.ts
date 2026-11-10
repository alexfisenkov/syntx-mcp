import { isProxy } from "node:util/types";

const RATIOS = Object.freeze(["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"] as const);
const RESOLUTIONS = Object.freeze(["1K", "1.5K", "2K"] as const);
const FORMATS = Object.freeze(["jpeg", "png"] as const);
const BACKGROUNDS = Object.freeze(["auto", "opaque", "transparent"] as const);

export interface OwnerSeedream55EditorParameters {
  readonly aspect_ratio: typeof RATIOS[number];
  readonly resolution: typeof RESOLUTIONS[number];
  readonly output_format: typeof FORMATS[number];
  readonly background: typeof BACKGROUNDS[number];
}
export class OwnerSeedream55EditorParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("Seedream 5.5 Editor parameters are invalid.");
    this.name = "OwnerSeedream55EditorParametersError";
  }
}

/** The four current Editor controls must be explicit. No account or dispatch authority is implied. */
export function normalizeOwnerSeedream55EditorParameters(input: unknown): Readonly<OwnerSeedream55EditorParameters> {
  const fields = exact(input, ["aspect_ratio", "resolution", "output_format", "background"]);
  if (!RATIOS.includes(fields.aspect_ratio as never) || !RESOLUTIONS.includes(fields.resolution as never) ||
      !FORMATS.includes(fields.output_format as never) || !BACKGROUNDS.includes(fields.background as never) ||
      (fields.background === "transparent" && fields.output_format !== "png")) invalid();
  return Object.freeze({ aspect_ratio: fields.aspect_ratio, resolution: fields.resolution,
    output_format: fields.output_format, background: fields.background }) as OwnerSeedream55EditorParameters;
}

export function projectOwnerSeedream55EditorCost(input: unknown): Readonly<{ batch_size: 1 | 2; resolution: OwnerSeedream55EditorParameters["resolution"] }> {
  const fields = exact(input, ["parameters", "drawing_present"]);
  if (typeof fields.drawing_present !== "boolean") invalid();
  const parameters = normalizeOwnerSeedream55EditorParameters(fields.parameters);
  return Object.freeze({ batch_size: fields.drawing_present ? 2 as const : 1 as const, resolution: parameters.resolution });
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some((key) => !Object.hasOwn(descriptors, key)) ||
      Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !keys.includes(key) ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) result[key] = descriptors[key]!.value;
  return result;
}
function invalid(): never { throw new OwnerSeedream55EditorParametersError("INVALID_PARAMETERS"); }
