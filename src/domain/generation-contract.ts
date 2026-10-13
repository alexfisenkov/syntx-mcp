import { createHash } from "node:crypto";
import { z } from "zod/v4";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const identifierSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);
const safeFieldSchema = z.string().min(1).max(64).regex(/^[A-Za-z][A-Za-z0-9._-]*$/u);
const literalSchema = z.union([z.string().max(2_000), z.number().finite(), z.boolean()]);

const scalarPropertySchema = z.object({
  type: z.enum(["string", "number", "integer", "boolean"]),
  enum: z.array(literalSchema).min(1).max(200).optional(),
  default: literalSchema.optional(),
  min_length: z.number().int().nonnegative().max(100_000).optional(),
  max_length: z.number().int().nonnegative().max(100_000).optional(),
  minimum: z.number().finite().optional(),
  maximum: z.number().finite().optional()
}).strict().superRefine((property, context) => {
  if (property.type !== "string" && (property.min_length !== undefined || property.max_length !== undefined)) {
    context.addIssue({ code: "custom", message: "String length constraints are valid only for string properties." });
  }
  if (property.type !== "number" && property.type !== "integer" && (property.minimum !== undefined || property.maximum !== undefined)) {
    context.addIssue({ code: "custom", message: "Numeric bounds are valid only for numeric properties." });
  }
  if (property.min_length !== undefined && property.max_length !== undefined && property.min_length > property.max_length) {
    context.addIssue({ code: "custom", path: ["min_length"], message: "min_length must not exceed max_length." });
  }
  if (property.minimum !== undefined && property.maximum !== undefined && property.minimum > property.maximum) {
    context.addIssue({ code: "custom", path: ["minimum"], message: "minimum must not exceed maximum." });
  }
  if (property.enum !== undefined && new Set(property.enum.map(canonicalJson)).size !== property.enum.length) {
    context.addIssue({ code: "custom", path: ["enum"], message: "enum values must be unique." });
  }
  if (property.enum?.some((value) => !matchesType(value, property.type))) {
    context.addIssue({ code: "custom", path: ["enum"], message: "enum values must match the property type." });
  }
  if (property.default !== undefined && !matchesType(property.default, property.type)) {
    context.addIssue({ code: "custom", path: ["default"], message: "default must match the property type." });
  }
});

const arrayPropertySchema = z.object({
  type: z.literal("array"),
  items: z.object({
    type: z.enum(["string", "number", "integer", "boolean"]),
    enum: z.array(literalSchema).min(1).max(200).optional()
  }).strict(),
  default: z.array(literalSchema).max(256).optional(),
  min_items: z.number().int().nonnegative().max(256).optional(),
  max_items: z.number().int().nonnegative().max(256).optional()
}).strict().superRefine((property, context) => {
  if (property.min_items !== undefined && property.max_items !== undefined && property.min_items > property.max_items) {
    context.addIssue({ code: "custom", path: ["min_items"], message: "min_items must not exceed max_items." });
  }
  if (property.default !== undefined && property.default.some((item) => !matchesType(item, property.items.type))) {
    context.addIssue({ code: "custom", path: ["default"], message: "default items must match the item type." });
  }
  if (property.items.enum !== undefined && (new Set(property.items.enum.map(canonicalJson)).size !== property.items.enum.length || property.items.enum.some((item) => !matchesType(item, property.items.type)))) {
    context.addIssue({ code: "custom", path: ["items", "enum"], message: "item enum values must be unique and match the item type." });
  }
});

export const generationParameterPropertySchema = z.union([scalarPropertySchema, arrayPropertySchema]);
export type GenerationParameterProperty = z.infer<typeof generationParameterPropertySchema>;

const conditionSchema = z.object({
  when: z.object({ field: safeFieldSchema, equals: literalSchema }).strict(),
  require: z.array(safeFieldSchema).max(64).optional(),
  forbid: z.array(safeFieldSchema).max(64).optional()
}).strict().superRefine((condition, context) => {
  const required = condition.require ?? [];
  const forbidden = condition.forbid ?? [];
  if (new Set(required).size !== required.length || new Set(forbidden).size !== forbidden.length ||
      required.some((field) => forbidden.includes(field))) {
    context.addIssue({ code: "custom", message: "Condition field lists must be unique and disjoint." });
  }
});

export const generationParameterSchema = z.object({
  type: z.literal("object"),
  additional_properties: z.literal(false),
  required: z.array(safeFieldSchema).max(64),
  properties: z.record(safeFieldSchema, generationParameterPropertySchema).refine((properties) => Object.keys(properties).length <= 64),
  conditions: z.array(conditionSchema).max(64)
}).strict().superRefine((schema, context) => {
  const keys = Object.keys(schema.properties);
  if (new Set(schema.required).size !== schema.required.length) {
    context.addIssue({ code: "custom", path: ["required"], message: "required fields must be unique." });
  }
  for (const field of schema.required) {
    if (!Object.hasOwn(schema.properties, field)) context.addIssue({ code: "custom", path: ["required"], message: `required field ${field} has no property schema.` });
  }
  for (const [field, property] of Object.entries(schema.properties)) {
    if (property.default !== undefined && !validateDefault(property, property.default)) {
      context.addIssue({ code: "custom", path: ["properties", field, "default"], message: "default violates its property constraints." });
    }
  }
  for (const [index, condition] of schema.conditions.entries()) {
    for (const field of [condition.when.field, ...(condition.require ?? []), ...(condition.forbid ?? [])]) {
      if (!keys.includes(field)) context.addIssue({ code: "custom", path: ["conditions", index], message: `condition references unknown field ${field}.` });
    }
    const trigger = schema.properties[condition.when.field];
    if (trigger && !validateScalarConstraint(trigger, condition.when.equals)) {
      context.addIssue({ code: "custom", path: ["conditions", index, "when", "equals"], message: "condition value is outside the trigger field schema." });
    }
  }
});

const provenanceReferenceSchema = z.object({
  kind: z.enum(["public_catalog", "frontend_static", "official_contract", "manual_review", "live_owner"]),
  reference: z.string().min(1).max(2_000),
  sha256: sha256Schema.optional()
}).strict().superRefine((reference, context) => {
  if (["public_catalog", "frontend_static", "official_contract", "live_owner"].includes(reference.kind) && reference.sha256 === undefined) {
    context.addIssue({ code: "custom", path: ["sha256"], message: "Source evidence references require a SHA-256 binding." });
  }
});

const strictProvenanceSchema = z.object({
  settings_source_sha256: sha256Schema.nullable(),
  references: z.array(provenanceReferenceSchema).min(1).max(64),
  reviewed_at: z.iso.datetime().optional(),
  live_observed_at: z.iso.datetime().optional()
}).strict();

const contractBaseSchema = z.object({
  model_id: identifierSchema,
  operation_id: z.enum([
    "generate-image", "generate-video", "generate-audio",
    "inpaint-image", "upscale-image", "inpaint-video", "upscale-video"
  ]),
  modality: z.enum(["image", "video", "audio"]),
  route: z.enum(["design", "video", "audio"]),
  ai_name: identifierSchema,
  model_type: identifierSchema,
  status: z.enum(["discovered", "static_partial", "reviewed", "live_verified", "blocked"]),
  provenance: strictProvenanceSchema,
  parameters: generationParameterSchema,
  wire: z.object({
    prompt_field: safeFieldSchema,
    settings_fields: z.record(safeFieldSchema, safeFieldSchema).refine((fields) => Object.keys(fields).length <= 64),
    fixed_settings: z.record(safeFieldSchema, literalSchema).refine((fields) => Object.keys(fields).length <= 64)
  }).strict(),
  output: z.object({
    decoder_profile: identifierSchema,
    mime_types: z.array(z.string().regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u)).min(1).max(32)
  }).strict(),
  limits: z.object({
    max_parameters: z.number().int().min(1).max(64),
    max_value_depth: z.number().int().min(1).max(8),
    max_serialized_bytes: z.number().int().min(128).max(256 * 1024)
  }).strict()
}).strict().superRefine((contract, context) => {
  const expected = operationRoute(contract.operation_id);
  if (expected.modality !== contract.modality || expected.route !== contract.route) {
    context.addIssue({ code: "custom", path: ["route"], message: "Operation, modality and route do not agree." });
  }
  for (const [wireField, parameterField] of Object.entries(contract.wire.settings_fields)) {
    if (!Object.hasOwn(contract.parameters.properties, parameterField) || wireField === "model_type" || wireField === contract.wire.prompt_field) {
      context.addIssue({ code: "custom", path: ["wire", "settings_fields", wireField], message: "Wire field must map a declared caller field and may not override transport-owned fields." });
    }
  }
  if (!Object.hasOwn(contract.parameters.properties, contract.wire.prompt_field) || contract.wire.settings_fields[contract.wire.prompt_field] !== undefined) {
    context.addIssue({ code: "custom", path: ["wire", "prompt_field"], message: "prompt_field must be declared and separate from settings fields." });
  }
  const promptProperty = contract.parameters.properties[contract.wire.prompt_field];
  if (!promptProperty || promptProperty.type !== "string" || !contract.parameters.required.includes(contract.wire.prompt_field)) {
    context.addIssue({ code: "custom", path: ["wire", "prompt_field"], message: "prompt_field must be a required string." });
  }
  const mappedParameters = new Set([contract.wire.prompt_field, ...Object.values(contract.wire.settings_fields)]);
  if (Object.keys(contract.parameters.properties).some((field) => !mappedParameters.has(field))) {
    context.addIssue({ code: "custom", path: ["wire", "settings_fields"], message: "Every caller field must have an explicit wire mapping or be the prompt." });
  }
  if (new Set(Object.values(contract.wire.settings_fields)).size !== Object.values(contract.wire.settings_fields).length) {
    context.addIssue({ code: "custom", path: ["wire", "settings_fields"], message: "A caller field may map to only one wire field." });
  }
  for (const key of Object.keys(contract.wire.fixed_settings)) {
    if (key === "model_type" || key === contract.wire.prompt_field || Object.hasOwn(contract.wire.settings_fields, key)) {
      context.addIssue({ code: "custom", path: ["wire", "fixed_settings", key], message: "Fixed settings may not override another wire field." });
    }
  }
  const references = contract.provenance.references;
  if (contract.status === "reviewed" || contract.status === "live_verified") {
    if (!contract.provenance.settings_source_sha256 || !contract.provenance.reviewed_at || !references.some((item) => item.kind === "manual_review") ||
        !references.some((item) => (item.kind === "frontend_static" || item.kind === "official_contract") && item.sha256 !== undefined)) {
      context.addIssue({ code: "custom", path: ["provenance"], message: "Reviewed contracts require a settings hash, reviewer record and reviewed_at." });
    }
  }
  if (contract.status === "live_verified" && (!contract.provenance.live_observed_at || !references.some((item) => (item.kind === "live_owner" || item.kind === "official_contract") && item.sha256 !== undefined))) {
    context.addIssue({ code: "custom", path: ["provenance"], message: "Live contracts require live evidence and observation time." });
  }
});

const fullContractSchema = contractBaseSchema.extend({ schema_hash: sha256Schema }).strict().superRefine((contract, context) => {
  const { schema_hash: _hash, ...base } = contract;
  if (schemaHash(base) !== contract.schema_hash) context.addIssue({ code: "custom", path: ["schema_hash"], message: "Contract schema hash does not match its content." });
});

export const generationContractRegistrySchema = z.object({
  schema_version: z.literal("1.0.0"),
  catalog_version: z.string().min(1).max(200),
  source_hashes: z.object({ ai: sha256Schema, llm_models: sha256Schema, models: sha256Schema }).strict(),
  contracts: z.array(fullContractSchema).max(10_000),
  registry_sha256: sha256Schema
}).strict().superRefine((registry, context) => {
  const keys = new Set<string>();
  for (const [index, contract] of registry.contracts.entries()) {
    const key = `${contract.model_id}\u0000${contract.operation_id}`;
    if (keys.has(key)) context.addIssue({ code: "custom", path: ["contracts", index], message: "Contract model/operation pairs must be unique." });
    keys.add(key);
    const boundCatalogRef = contract.provenance.references.some((reference) =>
      reference.kind === "public_catalog" && reference.sha256 !== undefined &&
      Object.values(registry.source_hashes).includes(reference.sha256)
    );
    if (!boundCatalogRef) context.addIssue({ code: "custom", path: ["contracts", index, "provenance", "references"], message: "Each contract must reference a hash in this registry's public catalog binding." });
  }
  const { registry_sha256: _hash, ...base } = registry;
  if (schemaHash(base) !== registry.registry_sha256) context.addIssue({ code: "custom", path: ["registry_sha256"], message: "Registry hash does not match its content." });
});

export type GenerationContractStatus = z.infer<typeof contractBaseSchema>["status"];
export type GenerationContractInput = z.input<typeof contractBaseSchema>;
export type GenerationContract = z.infer<typeof fullContractSchema>;
export type GenerationContractRegistryInput = Omit<z.input<typeof generationContractRegistrySchema>, "contracts" | "registry_sha256"> & {
  contracts: GenerationContractInput[];
};
export type GenerationContractRegistry = z.infer<typeof generationContractRegistrySchema>;

export function createGenerationContractRegistry(input: GenerationContractRegistryInput): GenerationContractRegistry {
  const initial = z.object({
    schema_version: z.literal("1.0.0"),
    catalog_version: z.string().min(1).max(200),
    source_hashes: generationContractRegistrySchema.shape.source_hashes,
    contracts: z.array(contractBaseSchema).max(10_000)
  }).strict().parse(input);
  const contracts = initial.contracts
    .map((contract) => ({ ...contract, schema_hash: schemaHash(contract) }))
    .sort((left, right) => `${left.model_id}\u0000${left.operation_id}`.localeCompare(`${right.model_id}\u0000${right.operation_id}`));
  const base = { ...initial, contracts };
  return generationContractRegistrySchema.parse({ ...base, registry_sha256: schemaHash(base) });
}

export function serializeGenerationContractRegistry(registry: GenerationContractRegistry): string {
  const validated = generationContractRegistrySchema.parse(registry);
  return canonicalJson(validated);
}

export function schemaHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("GENERATION_CONTRACT_JSON_INVALID");
  return serialized;
}

export function operationRoute(operationId: string): { modality: "image" | "video" | "audio"; route: "design" | "video" | "audio" } {
  if (operationId.endsWith("-image")) return { modality: "image", route: "design" };
  if (operationId.endsWith("-video")) return { modality: "video", route: "video" };
  if (operationId === "generate-audio") return { modality: "audio", route: "audio" };
  throw new TypeError("GENERATION_CONTRACT_OPERATION_UNSUPPORTED");
}

function validateDefault(property: GenerationParameterProperty, value: unknown): boolean {
  if (property.type === "array") return Array.isArray(value) && value.length >= (property.min_items ?? 0) && value.length <= (property.max_items ?? 256) && value.every((item) => validateScalarConstraint(property.items, item));
  return validateScalarConstraint(property, value);
}

function validateScalarConstraint(property: { type: string; enum?: readonly unknown[] | undefined; minimum?: number | undefined; maximum?: number | undefined; min_length?: number | undefined; max_length?: number | undefined }, value: unknown): boolean {
  if (!matchesType(value, property.type)) return false;
  if (property.enum && !property.enum.some((candidate) => Object.is(candidate, value))) return false;
  if (typeof value === "number" && ((property.minimum !== undefined && value < property.minimum) || (property.maximum !== undefined && value > property.maximum))) return false;
  if (typeof value === "string" && ((property.min_length !== undefined && Array.from(value).length < property.min_length) || (property.max_length !== undefined && Array.from(value).length > property.max_length))) return false;
  return true;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return typeof value === "number" && Number.isSafeInteger(value);
    case "boolean": return typeof value === "boolean";
    default: return false;
  }
}
