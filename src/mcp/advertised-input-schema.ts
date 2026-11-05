import { z } from "zod/v4";

type JsonObject = Record<string, unknown>;

/**
 * SDK 1.32 lists only Zod objects; a root union otherwise becomes an empty
 * object in tools/list. The object shell advertises the complete branch schema
 * through Zod's supported JSON metadata and delegates parsing to the canonical
 * union exactly once. Input fields are not independently transformed/defaulted.
 */
export function advertisedUnionInputSchema<T extends z.ZodType>(canonical: T,
  conditions: readonly JsonObject[] = []): z.ZodType<z.output<T>, z.input<T>> {
  const source = z.toJSONSchema(canonical, { target: "draft-7", io: "input" }) as JsonObject;
  const branches = source.oneOf ?? source.anyOf;
  if (!Array.isArray(branches) || branches.length < 2 || branches.some(branch => !branch ||
      typeof branch !== "object" || branch.type !== "object" || !branch.properties || branch.additionalProperties !== false)) {
    throw new TypeError("ADVERTISED_INPUT_REQUIRES_CLOSED_OBJECT_UNION");
  }
  const variants = branches as JsonObject[];
  const schemas = new Map<string, JsonObject[]>();
  for (const branch of variants) for (const [key, value] of Object.entries(branch.properties as JsonObject)) {
    const existing = schemas.get(key) ?? [];
    if (!existing.some(item => JSON.stringify(item) === JSON.stringify(value))) existing.push(value as JsonObject);
    schemas.set(key, existing);
  }
  const properties = Object.fromEntries([...schemas].map(([key, entries]) => [key,
    entries.length === 1 ? entries[0] : entries.every(entry => typeof entry.const === "string")
      ? { type: "string", enum: entries.map(entry => entry.const) } : { anyOf: entries }]));
  const required = [...schemas.keys()].filter(key => variants.every(branch =>
    Array.isArray(branch.required) && branch.required.includes(key)));
  const advertised = { ...source, type: "object", properties, required, additionalProperties: false,
    ...(conditions.length > 0 ? { allOf: [...(Array.isArray(source.allOf) ? source.allOf : []), ...conditions] } : {}) };
  // The canonical parser performs all requirements, conditional refinements,
  // strict-field checks and transforms. This temporary shell owns its root copy.
  const shell = z.object(Object.fromEntries([...schemas.keys()].map(key => [key, z.unknown().optional()])))
    .strict().superRefine(async (input, context) => {
      const parsed = await canonical.safeParseAsync(input);
      if (!parsed.success) { for (const issue of parsed.error.issues) context.addIssue({ ...issue }); return; }
      if (!parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) {
        context.addIssue({ code: "custom", message: "Canonical tool input must remain an object." }); return;
      }
      for (const key of Object.keys(input)) delete input[key];
      Object.assign(input, parsed.data);
    }).meta(advertised);
  return shell as unknown as z.ZodType<z.output<T>, z.input<T>>;
}
