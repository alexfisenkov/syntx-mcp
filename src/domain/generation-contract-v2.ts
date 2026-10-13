import { createHash } from "node:crypto";
import { types } from "node:util";
import { z } from "zod/v4";
import {
  canonicalJson,
  schemaHash
} from "./generation-contract.js";

const MAX_REGISTRY_BYTES = 16 * 1024 * 1024;
const MAX_REGISTRY_NODES = 100_000;
const MAX_SCHEMA_NODES = 2_048;
const MAX_SCHEMA_DEPTH = 8;
const MAX_NORMALIZED_NODES = 20_000;
const MAX_TOP_LEVEL_FIELDS = 64;
const MAX_ARRAY_ITEMS = 256;
const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const identifierSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const fieldSchema = z.string().min(1).max(64).regex(/^[A-Za-z][A-Za-z0-9._-]*$/u);
const costBindingTargetSchema = fieldSchema.superRefine((field, context) => {
  if (["ai_name", "model_type", "prototype", "constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"].includes(field)) {
    context.addIssue({ code: "custom", message: "Reserved cost binding keys are not allowed." });
  }
});
const modalitySchema = z.enum(["image", "video", "audio"]);
const routeSchema = z.enum(["design", "video", "audio"]);
const operationSchema = z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const jsonScalarSchema = z.union([z.string().max(2_000), z.number().finite(), z.boolean(), z.null()]);
const costParameterBindingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("parameter"), parameter: fieldSchema }).strict(),
  z.object({ kind: z.literal("literal"), value: z.union([z.string().max(2_000), z.number().finite(), z.boolean()]) }).strict()
]);
const costParameterBindingsSchema = z.record(costBindingTargetSchema, costParameterBindingSchema)
  .superRefine((bindings, context) => {
    const count = Object.keys(bindings).length;
    if (count < 1 || count > 8) context.addIssue({ code: "custom", message: "Cost bindings must declare one through eight fields." });
  });

export type GenerationContractV2JsonValue =
  | string | number | boolean | null
  | readonly GenerationContractV2JsonValue[]
  | { readonly [key: string]: GenerationContractV2JsonValue };

export interface GenerationContractV2ScalarNode {
  readonly type: "string" | "number" | "integer" | "boolean";
  readonly nullable?: boolean | undefined;
  readonly enum?: readonly (string | number | boolean | null)[] | undefined;
  readonly default?: string | number | boolean | null | undefined;
  readonly min_length?: number | undefined;
  readonly max_length?: number | undefined;
  readonly minimum?: number | undefined;
  readonly maximum?: number | undefined;
  readonly step?: number | undefined;
}

export interface GenerationContractV2ArrayNode {
  readonly type: "array";
  readonly nullable?: boolean | undefined;
  readonly items: GenerationContractV2ParameterNode;
  readonly default?: readonly GenerationContractV2JsonValue[] | undefined;
  readonly min_items?: number | undefined;
  readonly max_items?: number | undefined;
}

export interface GenerationContractV2ObjectNode {
  readonly type: "object";
  readonly nullable?: boolean | undefined;
  readonly properties: Readonly<Record<string, GenerationContractV2ParameterNode>>;
  readonly required: readonly string[];
  readonly additional_properties: false;
  readonly default?: Readonly<Record<string, GenerationContractV2JsonValue>> | undefined;
}

export interface GenerationContractV2MediaReferenceNode {
  readonly type: "media_reference";
  readonly modality: "image" | "video";
  readonly source: "uploaded_file_id";
}

export type GenerationContractV2ParameterNode =
  | GenerationContractV2ScalarNode
  | GenerationContractV2ArrayNode
  | GenerationContractV2ObjectNode
  | GenerationContractV2MediaReferenceNode;

const jsonValueSchema: z.ZodType<GenerationContractV2JsonValue> = z.lazy(() => z.union([
  z.string().max(2_000), z.number().finite(), z.boolean(), z.null(),
  z.array(jsonValueSchema).max(MAX_ARRAY_ITEMS),
  z.record(fieldSchema, jsonValueSchema).superRefine((record, context) => {
    if (Object.keys(record).length > MAX_TOP_LEVEL_FIELDS) context.addIssue({ code: "custom", message: "Object has too many fields." });
  })
]));

const scalarNodeSchema = z.object({
  type: z.enum(["string", "number", "integer", "boolean"]),
  nullable: z.boolean().optional(),
  enum: z.array(jsonScalarSchema).min(1).max(200).optional(),
  default: jsonScalarSchema.optional(),
  min_length: z.number().int().nonnegative().max(100_000).optional(),
  max_length: z.number().int().nonnegative().max(100_000).optional(),
  minimum: z.number().finite().optional(),
  maximum: z.number().finite().optional(),
  step: z.number().finite().positive().optional()
}).strict().superRefine((node, context) => {
  const stringOnly = node.type === "string";
  const numericOnly = node.type === "number" || node.type === "integer";
  if (!stringOnly && (node.min_length !== undefined || node.max_length !== undefined)) {
    context.addIssue({ code: "custom", message: "String length bounds require a string property." });
  }
  if (!numericOnly && (node.minimum !== undefined || node.maximum !== undefined || node.step !== undefined)) {
    context.addIssue({ code: "custom", message: "Numeric bounds and step require a numeric property." });
  }
  if (node.min_length !== undefined && node.max_length !== undefined && node.min_length > node.max_length) {
    context.addIssue({ code: "custom", path: ["min_length"], message: "Minimum string length exceeds maximum." });
  }
  if (node.minimum !== undefined && node.maximum !== undefined && node.minimum > node.maximum) {
    context.addIssue({ code: "custom", path: ["minimum"], message: "Minimum numeric value exceeds maximum." });
  }
  if (node.enum !== undefined && (new Set(node.enum.map(canonicalJson)).size !== node.enum.length ||
      node.enum.some((value) => !scalarMatchesType(node.type, value, node.nullable === true)))) {
    context.addIssue({ code: "custom", path: ["enum"], message: "Enum values must be unique and match type/nullability." });
  }
  if (node.default !== undefined && !validScalarValue(node, node.default)) {
    context.addIssue({ code: "custom", path: ["default"], message: "Default violates the scalar constraints." });
  }
});

export const generationContractV2ParameterNodeSchema: z.ZodType<GenerationContractV2ParameterNode> = z.lazy(() => z.union([
  scalarNodeSchema,
  z.object({
    type: z.literal("array"),
    nullable: z.boolean().optional(),
    items: generationContractV2ParameterNodeSchema,
    default: z.array(jsonValueSchema).max(MAX_ARRAY_ITEMS).optional(),
    min_items: z.number().int().nonnegative().max(MAX_ARRAY_ITEMS).optional(),
    max_items: z.number().int().nonnegative().max(MAX_ARRAY_ITEMS).optional()
  }).strict().superRefine((node, context) => {
    if (node.min_items !== undefined && node.max_items !== undefined && node.min_items > node.max_items) {
      context.addIssue({ code: "custom", path: ["min_items"], message: "Minimum array length exceeds maximum." });
    }
    if (node.default !== undefined && !validNodeValue(node, node.default, 0)) {
      context.addIssue({ code: "custom", path: ["default"], message: "Default violates the array item schema." });
    }
  }),
  z.object({
    type: z.literal("object"),
    nullable: z.boolean().optional(),
    properties: z.record(fieldSchema, generationContractV2ParameterNodeSchema).superRefine((properties, context) => {
      if (Object.keys(properties).length > MAX_TOP_LEVEL_FIELDS) context.addIssue({ code: "custom", message: "Object schema has too many fields." });
    }),
    required: z.array(fieldSchema).max(MAX_TOP_LEVEL_FIELDS),
    additional_properties: z.literal(false),
    default: z.record(fieldSchema, jsonValueSchema).optional()
  }).strict().superRefine((node, context) => {
    const propertyKeys = Object.keys(node.properties);
    if (new Set(node.required).size !== node.required.length || node.required.some((key) => !propertyKeys.includes(key))) {
      context.addIssue({ code: "custom", path: ["required"], message: "Required nested fields must be unique declared properties." });
    }
    if (node.default !== undefined) {
      if (Object.keys(node.default).some((key) => !propertyKeys.includes(key)) ||
          node.required.some((key) => !Object.hasOwn(node.default!, key) && !Object.hasOwn(node.properties[key]!, "default"))) {
        context.addIssue({ code: "custom", path: ["default"], message: "Object default must be closed and satisfy required fields after defaults." });
      }
      for (const [key, value] of Object.entries(node.default)) {
        if (!validNodeValue(node.properties[key]!, value, 0)) {
          context.addIssue({ code: "custom", path: ["default", key], message: "Nested default violates its property schema." });
        }
      }
    }
  }),
  z.object({
    type: z.literal("media_reference"),
    modality: z.enum(["image", "video"]),
    source: z.literal("uploaded_file_id")
  }).strict()
]) as z.ZodType<GenerationContractV2ParameterNode>);

const conditionSchema = z.object({
  when: z.object({ field: fieldSchema, equals: jsonScalarSchema }).strict(),
  require: z.array(fieldSchema).max(MAX_TOP_LEVEL_FIELDS).optional(),
  forbid: z.array(fieldSchema).max(MAX_TOP_LEVEL_FIELDS).optional()
}).strict().superRefine((condition, context) => {
  const required = condition.require ?? [];
  const forbidden = condition.forbid ?? [];
  if (new Set(required).size !== required.length || new Set(forbidden).size !== forbidden.length ||
      required.some((field) => forbidden.includes(field))) {
    context.addIssue({ code: "custom", message: "Conditional field lists must be unique and disjoint." });
  }
});

const conditionalEnumSchema = z.object({
  field: fieldSchema,
  cases: z.array(z.object({
    when: z.object({ field: fieldSchema, equals: jsonScalarSchema }).strict(),
    allowed_values: z.array(jsonScalarSchema).min(1).max(200)
  }).strict()).min(1).max(32)
}).strict().superRefine((rule, context) => {
  const cases = rule.cases.map((entry) => `${entry.when.field}\u0000${canonicalJson(entry.when.equals)}`);
  if (new Set(cases).size !== cases.length || rule.cases.some((entry) =>
    new Set(entry.allowed_values.map(canonicalJson)).size !== entry.allowed_values.length)) {
    context.addIssue({ code: "custom", message: "Conditional enum branches and values must be unique." });
  }
});

const provenanceSchemaV2 = z.object({
  settings_source_sha256: hashSchema.nullable(),
  references: z.array(z.object({
    kind: z.enum(["public_catalog", "frontend_static", "official_contract", "manual_review", "live_owner"]),
    reference: z.string().min(1).max(2_000),
    sha256: hashSchema.optional()
  }).strict().superRefine((reference, context) => {
    if (["public_catalog", "frontend_static", "official_contract", "live_owner"].includes(reference.kind) && reference.sha256 === undefined) {
      context.addIssue({ code: "custom", path: ["sha256"], message: "Evidence references require a SHA-256 binding." });
    }
  })).min(1).max(64),
  reviewed_at: z.iso.datetime().optional(),
  live_observed_at: z.iso.datetime().optional()
}).strict();

const parametersSchemaV2 = z.object({
  type: z.literal("object"),
  additional_properties: z.literal(false),
  required: z.array(fieldSchema).max(MAX_TOP_LEVEL_FIELDS),
  properties: z.record(fieldSchema, generationContractV2ParameterNodeSchema).superRefine((properties, context) => {
    if (Object.keys(properties).length > MAX_TOP_LEVEL_FIELDS) context.addIssue({ code: "custom", message: "Parameter schema has too many top-level fields." });
  }),
  conditions: z.array(conditionSchema).max(64),
  conditional_enums: z.array(conditionalEnumSchema).max(64)
}).strict().superRefine((parameters, context) => {
  const fields = Object.keys(parameters.properties);
  if (new Set(parameters.required).size !== parameters.required.length || parameters.required.some((field) => !fields.includes(field))) {
    context.addIssue({ code: "custom", path: ["required"], message: "Required fields must be unique declared properties." });
  }
  const conditionalFields = parameters.conditional_enums.map((rule) => rule.field);
  if (new Set(conditionalFields).size !== conditionalFields.length) {
    context.addIssue({ code: "custom", path: ["conditional_enums"], message: "Only one conditional enum rule may target a field." });
  }
  for (const condition of parameters.conditions) {
    const controller = parameters.properties[condition.when.field];
    if (![condition.when.field, ...(condition.require ?? []), ...(condition.forbid ?? [])].every((field) => fields.includes(field)) ||
        !controller || controller.type === "array" || controller.type === "object" || controller.type === "media_reference" ||
        !validScalarValue(controller, condition.when.equals)) {
      context.addIssue({ code: "custom", path: ["conditions"], message: "Conditions may reference only declared top-level fields." });
    }
  }
  for (const rule of parameters.conditional_enums) {
    const target = parameters.properties[rule.field];
    if (!target || target.type === "array" || target.type === "object" || target.type === "media_reference") {
      context.addIssue({ code: "custom", path: ["conditional_enums"], message: "Conditional enums target scalar fields only." });
      continue;
    }
    for (const branch of rule.cases) {
      const controller = parameters.properties[branch.when.field];
      if (!controller || controller.type === "array" || controller.type === "object" || controller.type === "media_reference" ||
          !validScalarValue(controller, branch.when.equals) ||
          branch.allowed_values.some((value) => !validScalarValue(target, value))) {
        context.addIssue({ code: "custom", path: ["conditional_enums"], message: "Conditional enum fields/values must fit the declared scalar schema." });
      }
    }
  }
});

const operationIds = new Set([
  "generate-image", "generate-video", "generate-audio",
  "inpaint-image", "upscale-image", "inpaint-video", "upscale-video"
]);
const supportedDispatchActions = new Set(["generate-image", "generate-video", "generate-audio"]);
const liveStatuses = new Set(["reviewed", "live_verified"]);

const contractBaseSchemaV2 = z.object({
  variant_id: identifierSchema,
  model_id: identifierSchema,
  operation_id: operationSchema,
  modality: modalitySchema,
  route: routeSchema,
  ai_name: identifierSchema,
  model_type: identifierSchema,
  status: z.enum(["discovered", "static_partial", "reviewed", "live_verified", "blocked"]),
  provenance: provenanceSchemaV2,
  parameters: parametersSchemaV2,
  cost_parameter_bindings: costParameterBindingsSchema.optional(),
  wire: z.object({
    dispatch_action: operationSchema,
    input_kind: z.enum(["prompt", "media_only", "prompt_and_media"]),
    prompt_field: fieldSchema.nullable(),
    settings_fields: z.record(fieldSchema, fieldSchema).superRefine((fields, context) => {
      if (Object.keys(fields).length > MAX_TOP_LEVEL_FIELDS) context.addIssue({ code: "custom", message: "Wire mapping has too many fields." });
    }),
    fixed_settings: z.record(fieldSchema, jsonValueSchema).superRefine((fields, context) => {
      if (Object.keys(fields).length > MAX_TOP_LEVEL_FIELDS) context.addIssue({ code: "custom", message: "Fixed settings have too many fields." });
    }),
    media_reference_fields: z.record(fieldSchema, z.enum(["image", "video"]))
      .superRefine((fields, context) => {
        if (Object.keys(fields).length > MAX_TOP_LEVEL_FIELDS) context.addIssue({ code: "custom", message: "Media reference mapping has too many fields." });
      })
  }).strict(),
  output: z.object({
    decoder_profile: identifierSchema,
    mime_types: z.array(z.string().regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u)).min(1).max(32)
  }).strict(),
  limits: z.object({
    max_parameters: z.number().int().min(1).max(MAX_TOP_LEVEL_FIELDS),
    max_value_depth: z.number().int().min(1).max(MAX_SCHEMA_DEPTH),
    max_serialized_bytes: z.number().int().min(128).max(256 * 1024),
    max_normalized_nodes: z.number().int().min(1).max(MAX_NORMALIZED_NODES)
  }).strict()
}).strict().superRefine((contract, context) => {
  const wire = contract.wire;
  const props = contract.parameters.properties;
  const costBindings = contract.cost_parameter_bindings;
  if (costBindings !== undefined) {
    if (!liveStatuses.has(contract.status)) {
      context.addIssue({ code: "custom", path: ["cost_parameter_bindings"], message: "Cost bindings require a reviewed V2 contract." });
    }
    for (const [costKey, binding] of Object.entries(costBindings)) {
      if (binding.kind === "parameter") {
        const source = props[binding.parameter];
        if (!source || source.type === "array" || source.type === "object" || source.type === "media_reference") {
          context.addIssue({ code: "custom", path: ["cost_parameter_bindings", costKey], message: "Cost parameter bindings must target a declared scalar input." });
        }
      }
    }
  }
  const prompt = wire.prompt_field;
  const references = wire.media_reference_fields;
  const referenceFields = Object.keys(references);
  const isPromptInput = wire.input_kind === "prompt" || wire.input_kind === "prompt_and_media";
  const isMediaInput = wire.input_kind === "media_only" || wire.input_kind === "prompt_and_media";

  const schemaStats = inspectParameterSchema(props);
  if (schemaStats.nodes > MAX_SCHEMA_NODES || schemaStats.maxDepth > contract.limits.max_value_depth) {
    context.addIssue({ code: "custom", path: ["parameters", "properties"], message: "Parameter schema exceeds the declared recursive depth or node budget." });
  }

  if (wire.dispatch_action !== contract.operation_id) {
    context.addIssue({ code: "custom", path: ["wire", "dispatch_action"], message: "Dispatch action must equal the exact operation id." });
  }
  const knownOperation = operationIds.has(contract.operation_id);
  if (knownOperation) {
    const expectedModality = contract.operation_id.endsWith("-image") ? "image"
      : contract.operation_id.endsWith("-video") ? "video" : "audio";
    const expectedRoute = expectedModality === "image" ? "design" : expectedModality;
    if (contract.modality !== expectedModality || contract.route !== expectedRoute) {
      context.addIssue({ code: "custom", path: ["route"], message: "Operation, modality, and route family must agree." });
    }
  } else if (liveStatuses.has(contract.status)) {
    context.addIssue({ code: "custom", path: ["operation_id"], message: "Unknown operations cannot be reviewed or live-verified." });
  }
  if (!knownOperation && liveStatuses.has(contract.status)) {
    context.addIssue({ code: "custom", path: ["wire", "dispatch_action"], message: "Unknown actions cannot be reviewed or live-verified." });
  }
  if (liveStatuses.has(contract.status) && !supportedDispatchActions.has(wire.dispatch_action)) {
    context.addIssue({ code: "custom", path: ["wire", "dispatch_action"], message: "This action has no implemented request gateway and cannot be executable." });
  }
  if (contract.output.mime_types.some((mime) => !mime.startsWith(`${contract.modality}/`))) {
    context.addIssue({ code: "custom", path: ["output", "mime_types"], message: "Output MIME types must match the declared modality." });
  }
  if (liveStatuses.has(contract.status) && hasMediaReference(props)) {
    context.addIssue({ code: "custom", path: ["parameters", "properties"], message: "Media-reference fields cannot be executable until an upload resolver is implemented and verified." });
  }

  if (isPromptInput) {
    const promptNode = prompt === null ? undefined : props[prompt];
    if (prompt === null || !promptNode || promptNode.type !== "string" || promptNode.nullable === true ||
        !contract.parameters.required.includes(prompt)) {
      context.addIssue({ code: "custom", path: ["wire", "prompt_field"], message: "Prompt input requires one declared required non-null string field." });
    }
  } else if (prompt !== null) {
    context.addIssue({ code: "custom", path: ["wire", "prompt_field"], message: "Media-only input must not declare a prompt field." });
  }
  if (isMediaInput && referenceFields.length === 0) {
    context.addIssue({ code: "custom", path: ["wire", "media_reference_fields"], message: "Media input requires an explicit typed reference field." });
  }
  if (!isMediaInput && referenceFields.length > 0) {
    context.addIssue({ code: "custom", path: ["wire", "media_reference_fields"], message: "Prompt-only input may not declare media references." });
  }

  const mappedParameterFields = new Set<string>();
  if (prompt !== null) mappedParameterFields.add(prompt);
  const wireSettingKeys = Object.values(wire.settings_fields);
  if (new Set(wireSettingKeys).size !== wireSettingKeys.length) {
    context.addIssue({ code: "custom", path: ["wire", "settings_fields"], message: "Wire settings keys must be unique." });
  }
  for (const [parameterField, wireField] of Object.entries(wire.settings_fields)) {
    const property = props[parameterField];
    if (!property || property.type === "media_reference" || (property.type === "array" && property.items.type === "media_reference")) {
      context.addIssue({ code: "custom", path: ["wire", "settings_fields"], message: "Settings mappings must target declared non-reference fields." });
    }
    if (mappedParameterFields.has(parameterField)) context.addIssue({ code: "custom", path: ["wire", "settings_fields"], message: "Each input field has one wire role." });
    mappedParameterFields.add(parameterField);
    if (wireField === "model_type" || (prompt !== null && wireField === prompt)) {
      context.addIssue({ code: "custom", path: ["wire", "settings_fields", parameterField], message: "Mapped settings may not override model_type or prompt." });
    }
  }
  for (const [parameterField, mediaModality] of Object.entries(references)) {
    const property = props[parameterField];
    const node = property?.type === "array" ? property.items : property;
    if (!node || node.type !== "media_reference" || node.modality !== mediaModality ||
        !contract.parameters.required.includes(parameterField)) {
      context.addIssue({ code: "custom", path: ["wire", "media_reference_fields", parameterField], message: "Media mappings require a required matching opaque uploaded-file-id field." });
    }
    if (mappedParameterFields.has(parameterField)) context.addIssue({ code: "custom", path: ["wire", "media_reference_fields", parameterField], message: "Each input field has one wire role." });
    mappedParameterFields.add(parameterField);
  }
  for (const parameterField of Object.keys(props)) {
    if (!mappedParameterFields.has(parameterField)) {
      context.addIssue({ code: "custom", path: ["wire"], message: "Every caller field needs an explicit prompt, settings, or media-reference mapping." });
    }
  }
  if (wire.settings_fields.prompt_field !== undefined) {
    context.addIssue({ code: "custom", path: ["wire", "settings_fields"], message: "Prompt must remain separate from settings fields." });
  }
  for (const key of Object.keys(wire.fixed_settings)) {
    if (key === "model_type" || (prompt !== null && key === prompt) || wireSettingKeys.includes(key)) {
      context.addIssue({ code: "custom", path: ["wire", "fixed_settings", key], message: "Fixed settings may not override prompt, model_type, or mapped fields." });
    }
  }

  const referenceHashes = contract.provenance.references;
  if (liveStatuses.has(contract.status)) {
    if (!contract.provenance.settings_source_sha256 || !contract.provenance.reviewed_at ||
        !referenceHashes.some((entry) => entry.kind === "manual_review") ||
        !referenceHashes.some((entry) => (entry.kind === "frontend_static" || entry.kind === "official_contract") && entry.sha256 !== undefined)) {
      context.addIssue({ code: "custom", path: ["provenance"], message: "Reviewed v2 contracts need source hash, reviewer, and reviewed_at." });
    }
  }
  if (contract.status === "live_verified" && (!contract.provenance.live_observed_at ||
      !referenceHashes.some((entry) => (entry.kind === "live_owner" || entry.kind === "official_contract") && entry.sha256 !== undefined))) {
    context.addIssue({ code: "custom", path: ["provenance"], message: "Live v2 contracts need exact live evidence and observation time." });
  }
});

const fullContractSchemaV2 = contractBaseSchemaV2.extend({ schema_hash: hashSchema }).strict().superRefine((contract, context) => {
  const { schema_hash: _hash, ...base } = contract;
  if (schemaHash(base) !== contract.schema_hash) context.addIssue({ code: "custom", path: ["schema_hash"], message: "V2 contract hash mismatch." });
});

const sourceHashesSchema = z.object({ ai: hashSchema, llm_models: hashSchema, models: hashSchema }).strict();
const registryV2InputSchema = z.object({
  schema_version: z.literal("2.0.0"),
  catalog_version: z.string().min(1).max(200),
  source_hashes: sourceHashesSchema,
  contracts: z.array(contractBaseSchemaV2).max(10_000)
}).strict();
const registryV2BaseSchema = registryV2InputSchema.extend({ contracts: z.array(fullContractSchemaV2).max(10_000) }).strict();

export const generationContractRegistryV2Schema = registryV2BaseSchema.extend({ registry_sha256: hashSchema }).strict()
  .superRefine((registry, context) => {
    const variants = new Set<string>();
    for (const [index, contract] of registry.contracts.entries()) {
      const key = `${contract.model_id}\u0000${contract.operation_id}\u0000${contract.variant_id}`;
      if (variants.has(key)) context.addIssue({ code: "custom", path: ["contracts", index], message: "V2 model/operation/variant tuples must be unique." });
      variants.add(key);
      const hasCatalogBinding = contract.provenance.references.some((reference) =>
        reference.kind === "public_catalog" && reference.sha256 !== undefined &&
        Object.values(registry.source_hashes).includes(reference.sha256)
      );
      if (!hasCatalogBinding) context.addIssue({ code: "custom", path: ["contracts", index, "provenance", "references"], message: "Each v2 contract must bind to a registry source hash." });
    }
    const { registry_sha256: _hash, ...base } = registry;
    if (schemaHash(base) !== registry.registry_sha256) context.addIssue({ code: "custom", path: ["registry_sha256"], message: "V2 registry hash mismatch." });
  });

export type GenerationContractV2 = z.infer<typeof fullContractSchemaV2>;
export type GenerationContractV2CostParameterBinding = z.infer<typeof costParameterBindingSchema>;
export type GenerationContractRegistryV2 = z.infer<typeof generationContractRegistryV2Schema>;
export type GenerationContractV2Input = z.input<typeof contractBaseSchemaV2>;
export type GenerationContractRegistryV2Input = Omit<z.input<typeof registryV2InputSchema>, "contracts"> & {
  readonly contracts: GenerationContractV2Input[];
};

export type GenerationContractV2RegistryErrorCode = "REGISTRY_HASH_MISMATCH" | "REGISTRY_INVALID";

export class GenerationContractV2RegistryError extends Error {
  constructor(readonly code: GenerationContractV2RegistryErrorCode) {
    super("The v2 generation contract registry could not be verified.");
    this.name = "GenerationContractV2RegistryError";
  }
}

/** Build a new immutable v2 registry; historical v1 files are never rewritten. */
export function createGenerationContractRegistryV2(input: GenerationContractRegistryV2Input): GenerationContractRegistryV2 {
  const safeInput = snapshotJson(input, MAX_REGISTRY_BYTES, MAX_REGISTRY_NODES, 32);
  const initial = registryV2InputSchema.parse(safeInput);
  const contracts = initial.contracts
    .map((item) => ({ ...item, schema_hash: schemaHash(item) }))
    .sort((left, right) => `${left.model_id}\u0000${left.operation_id}\u0000${left.variant_id}`
      .localeCompare(`${right.model_id}\u0000${right.operation_id}\u0000${right.variant_id}`));
  const base = { ...initial, contracts };
  return generationContractRegistryV2Schema.parse({ ...base, registry_sha256: schemaHash(base) });
}

export function serializeGenerationContractRegistryV2(input: unknown): string {
  const registry = parseRegistryV2Object(input);
  return canonicalJson(registry);
}

/** Hash exact bytes before JSON parsing or schema validation. */
export function parseGenerationContractRegistryV2(serializedArtifact: string, expectedSha256: string): GenerationContractRegistryV2 {
  if (!/^sha256:[a-f0-9]{64}$/u.test(expectedSha256)) throw registryError("REGISTRY_HASH_MISMATCH");
  if (Buffer.byteLength(serializedArtifact, "utf8") > MAX_REGISTRY_BYTES) throw registryError("REGISTRY_INVALID");
  const actualSha256 = `sha256:${createHash("sha256").update(serializedArtifact, "utf8").digest("hex")}`;
  if (actualSha256 !== expectedSha256) throw registryError("REGISTRY_HASH_MISMATCH");
  let decoded: unknown;
  try { decoded = JSON.parse(serializedArtifact); }
  catch { throw registryError("REGISTRY_INVALID"); }
  try { return parseRegistryV2Object(decoded); }
  catch { throw registryError("REGISTRY_INVALID"); }
}

export function parseGenerationContractV2(input: unknown): GenerationContractV2 {
  try {
    return fullContractSchemaV2.parse(snapshotJson(input, MAX_REGISTRY_BYTES, MAX_REGISTRY_NODES, 32));
  } catch { throw registryError("REGISTRY_INVALID"); }
}

function parseRegistryV2Object(input: unknown): GenerationContractRegistryV2 {
  return generationContractRegistryV2Schema.parse(snapshotJson(input, MAX_REGISTRY_BYTES, MAX_REGISTRY_NODES, 32));
}

function snapshotJson(input: unknown, maxBytes: number, maxNodes: number, maxDepth: number): unknown {
  let bytes = 0;
  let nodes = 0;
  const active = new Set<object>();
  const copy = (value: unknown, depth: number): unknown => {
    if (++nodes > maxNodes || depth > maxDepth) throw registryError("REGISTRY_INVALID");
    if (value === null || typeof value === "boolean") bytes += 5;
    else if (typeof value === "string") bytes += Buffer.byteLength(value, "utf8") + 2;
    else if (typeof value === "number" && Number.isFinite(value)) bytes += 32;
    else if (typeof value !== "object" || value === null || types.isProxy(value) || active.has(value)) {
      throw registryError("REGISTRY_INVALID");
    } else {
      const array = Array.isArray(value);
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== (array ? Array.prototype : Object.prototype) && (array || prototype !== null)) throw registryError("REGISTRY_INVALID");
      const ownKeys = Reflect.ownKeys(value);
      const length = array ? Object.getOwnPropertyDescriptor(value, "length")?.value as number : 0;
      if ((array && (length > 10_000 || ownKeys.length !== length + 1)) || (!array && ownKeys.length > MAX_TOP_LEVEL_FIELDS)) {
        throw registryError("REGISTRY_INVALID");
      }
      active.add(value);
      const result: Record<string, unknown> | unknown[] = array ? [] : Object.create(null) as Record<string, unknown>;
      for (const key of ownKeys) {
        if (array && key === "length") continue;
        if (typeof key !== "string" || key === "__proto__" || key === "prototype" || key === "constructor" ||
            (array && (!/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length))) throw registryError("REGISTRY_INVALID");
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw registryError("REGISTRY_INVALID");
        bytes += Buffer.byteLength(key, "utf8") + 4;
        const child = copy(descriptor.value, depth + 1);
        if (array) (result as unknown[]).push(child);
        else Object.defineProperty(result, key, { value: child, enumerable: true, configurable: false, writable: false });
      }
      active.delete(value);
      Object.freeze(result);
      if (bytes > maxBytes) throw registryError("REGISTRY_INVALID");
      return result;
    }
    if (bytes > maxBytes) throw registryError("REGISTRY_INVALID");
    return value;
  };
  return copy(input, 0);
}

function scalarMatchesType(type: string, value: string | number | boolean | null, nullable: boolean): boolean {
  if (value === null) return nullable;
  switch (type) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return typeof value === "number" && Number.isSafeInteger(value);
    case "boolean": return typeof value === "boolean";
    default: return false;
  }
}

function validScalarValue(node: GenerationContractV2ScalarNode, value: string | number | boolean | null): boolean {
  if (!scalarMatchesType(node.type, value, node.nullable === true)) return false;
  if (node.enum && !node.enum.some((candidate) => Object.is(candidate, value))) return false;
  if (typeof value === "string" && ((node.min_length !== undefined && [...value].length < node.min_length) ||
      (node.max_length !== undefined && [...value].length > node.max_length))) return false;
  if (typeof value === "number") {
    if ((node.minimum !== undefined && value < node.minimum) || (node.maximum !== undefined && value > node.maximum)) return false;
    if (node.step !== undefined && !onStep(value, node.minimum ?? 0, node.step)) return false;
  }
  return true;
}

function inspectParameterSchema(properties: Readonly<Record<string, GenerationContractV2ParameterNode>>): { nodes: number; maxDepth: number } {
  let nodes = 0;
  let maxDepth = 0;
  const visit = (node: GenerationContractV2ParameterNode, depth: number): void => {
    nodes += 1;
    maxDepth = Math.max(maxDepth, depth);
    if (nodes > MAX_SCHEMA_NODES) return;
    if (node.type === "array") visit(node.items, depth + 1);
    else if (node.type === "object") {
      for (const child of Object.values(node.properties)) visit(child, depth + 1);
    }
  };
  for (const node of Object.values(properties)) visit(node, 1);
  return { nodes, maxDepth };
}

function hasMediaReference(properties: Readonly<Record<string, GenerationContractV2ParameterNode>>): boolean {
  const contains = (node: GenerationContractV2ParameterNode): boolean => {
    if (node.type === "media_reference") return true;
    if (node.type === "array") return contains(node.items);
    if (node.type === "object") return Object.values(node.properties).some(contains);
    return false;
  };
  return Object.values(properties).some(contains);
}

function validNodeValue(node: GenerationContractV2ParameterNode, value: GenerationContractV2JsonValue, depth: number): boolean {
  if (depth > MAX_SCHEMA_DEPTH) return false;
  if (value === null) {
    if (node.type === "media_reference") return false;
    if (node.type === "string" || node.type === "number" || node.type === "integer" || node.type === "boolean") {
      return validScalarValue(node, null);
    }
    return node.nullable === true;
  }
  if (node.type === "media_reference") return isUploadedFileId(value);
  if (node.type === "string" || node.type === "number" || node.type === "integer" || node.type === "boolean") {
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? validScalarValue(node, value)
      : false;
  }
  if (node.type === "array") {
    return Array.isArray(value) && value.length >= (node.min_items ?? 0) && value.length <= (node.max_items ?? MAX_ARRAY_ITEMS) &&
      value.every((entry) => validNodeValue(node.items, entry, depth + 1));
  }
  if (node.type !== "object") return false;
  if (!isJsonRecord(value)) return false;
  if (Object.keys(value).some((key) => !Object.hasOwn(node.properties, key))) return false;
  for (const key of node.required) {
    if (!Object.hasOwn(value, key) && !Object.hasOwn(node.properties[key]!, "default")) return false;
  }
  return Object.entries(value).every(([key, entry]) => validNodeValue(node.properties[key]!, entry, depth + 1));
}

function onStep(value: number, origin: number, step: number): boolean {
  const units = (value - origin) / step;
  return Number.isFinite(units) && Math.abs(units - Math.round(units)) <= 1e-8;
}

function isUploadedFileId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u.test(value);
}

function isJsonRecord(value: unknown): value is Record<string, GenerationContractV2JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function registryError(code: GenerationContractV2RegistryErrorCode): GenerationContractV2RegistryError {
  return new GenerationContractV2RegistryError(code);
}
