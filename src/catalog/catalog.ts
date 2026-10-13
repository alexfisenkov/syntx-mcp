import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import { ApplicationError } from "../errors.js";
import { MODALITIES } from "../domain/types.js";
import type {
  CatalogModel,
  CatalogOperation,
  ModelCatalog,
  Modality,
  PublicSampleParametersSchema
} from "../domain/types.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const idSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const coverageSchema = z.enum(["FULL", "PARTIAL", "OPEN", "REMOVED"]);
const modalitySchema = z.enum(MODALITIES);

const parameterPropertySchema = z
  .object({
    type: z.literal("string"),
    description: z.string().min(1).max(300),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().optional(),
    enum: z.array(z.string().min(1)).min(1).optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.minLength !== undefined &&
      value.maxLength !== undefined &&
      value.minLength > value.maxLength
    ) {
      context.addIssue({
        code: "custom",
        message: "minLength cannot exceed maxLength"
      });
    }
  });

export const parametersSchema = z
  .object({
    $schema: z.literal("https://json-schema.org/draft/2020-12/schema"),
    type: z.literal("object"),
    additionalProperties: z.literal(false),
    properties: z.record(z.string().min(1), parameterPropertySchema),
    required: z.array(z.string().min(1))
  })
  .strict()
  .superRefine((value, context) => {
    for (const requiredName of value.required) {
      if (!(requiredName in value.properties)) {
        context.addIssue({
          code: "custom",
          path: ["required"],
          message: `Required property ${requiredName} is not defined.`
        });
      }
    }
  });

const operationSchema = z
  .object({
    id: idSchema,
    display_name: z.string().min(1).max(120),
    input_modalities: z.array(modalitySchema).min(1),
    output_modality: modalitySchema,
    coverage_status: coverageSchema,
    runtime_status: z.literal("UNVERIFIED"),
    runtime_provenance_status: z.literal("UNKNOWN"),
    cost_status: z.literal("UNKNOWN"),
    plan_status: z.literal("UNKNOWN"),
    parameters_schema_profile: z.literal("PUBLIC_SAMPLE_STRING_ONLY"),
    schema_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    parameters_schema: parametersSchema
  })
  .strict();

const modelSchema = z
  .object({
    id: idSchema,
    upstream_id: z.string().min(1).nullable(),
    upstream_id_status: z.literal("UNKNOWN"),
    display_name: z.string().min(1).max(120),
    family: z.string().min(1).max(120),
    modalities: z.array(modalitySchema).min(1),
    coverage_status: coverageSchema,
    first_seen: dateSchema,
    last_seen: dateSchema,
    removed_at: dateSchema.nullable(),
    source: z
      .object({
        url: z.url(),
        kind: z.enum([
          "public_documentation",
          "official_contract",
          "runtime_evidence"
        ]),
        checked_at: dateSchema,
        coverage_status: coverageSchema
      })
      .strict(),
    operations: z.array(operationSchema).min(1)
  })
  .strict();

export const modelCatalogSchema = z
  .object({
    schema_version: z.string().regex(/^\d+\.\d+\.\d+$/),
    catalog_version: z.string().min(1).max(120),
    catalog_kind: z.literal("PUBLIC_SAMPLE"),
    runtime_usable: z.literal(false),
    coverage_status: coverageSchema,
    checked_at: dateSchema,
    models: z.array(modelSchema).min(1)
  })
  .strict()
  .superRefine((catalog, context) => {
    const ids = new Set<string>();
    for (const [modelIndex, model] of catalog.models.entries()) {
      if (ids.has(model.id)) {
        context.addIssue({
          code: "custom",
          path: ["models", modelIndex, "id"],
          message: `Duplicate model id ${model.id}.`
        });
      }
      ids.add(model.id);

      const operationIds = new Set<string>();
      for (const [operationIndex, operation] of model.operations.entries()) {
        if (operationIds.has(operation.id)) {
          context.addIssue({
            code: "custom",
            path: ["models", modelIndex, "operations", operationIndex, "id"],
            message: `Duplicate operation id ${operation.id}.`
          });
        }
        operationIds.add(operation.id);

        const expectedHash = hashParametersSchema(operation.parameters_schema);
        if (operation.schema_hash !== expectedHash) {
          context.addIssue({
            code: "custom",
            path: [
              "models",
              modelIndex,
              "operations",
              operationIndex,
              "schema_hash"
            ],
            message: `Schema hash mismatch; expected ${expectedHash}.`
          });
        }
      }
    }
  });

export interface SearchModelsInput {
  query?: string | undefined;
  modality?: Modality | undefined;
  operation?: string | undefined;
  limit: number;
}

export class CatalogRepository {
  constructor(readonly catalog: ModelCatalog) {}

  search(input: SearchModelsInput): { total: number; models: CatalogModel[] } {
    const queryParts = input.query
      ?.toLocaleLowerCase()
      .split(/\s+/u)
      .filter(Boolean);

    const matches = this.catalog.models.filter((model) => {
      if (input.modality && !model.modalities.includes(input.modality)) {
        return false;
      }
      if (
        input.operation &&
        !model.operations.some((operation) => operation.id === input.operation)
      ) {
        return false;
      }
      if (queryParts?.length) {
        const haystack = [
          model.id,
          model.display_name,
          model.family,
          ...model.operations.flatMap((operation) => [
            operation.id,
            operation.display_name
          ])
        ]
          .join(" ")
          .toLocaleLowerCase();
        return queryParts.every((part) => haystack.includes(part));
      }
      return true;
    });

    return { total: matches.length, models: matches.slice(0, input.limit) };
  }

  getModel(modelId: string): CatalogModel {
    const model = this.catalog.models.find((candidate) => candidate.id === modelId);
    if (!model) {
      throw new ApplicationError(
        "MODEL_NOT_FOUND",
        `Model ${modelId} is not present in catalog ${this.catalog.catalog_version}.`
      );
    }
    return model;
  }

  getOperation(modelId: string, operationId: string): CatalogOperation {
    const model = this.getModel(modelId);
    const operation = model.operations.find(
      (candidate) => candidate.id === operationId
    );
    if (!operation) {
      throw new ApplicationError(
        "OPERATION_NOT_FOUND",
        `Operation ${operationId} is not documented for model ${modelId}.`
      );
    }
    return operation;
  }
}

export function loadCatalog(path?: string): ModelCatalog {
  const catalogPath = path ?? findDefaultCatalogPath();
  const raw: unknown = JSON.parse(readFileSync(catalogPath, "utf8"));
  return modelCatalogSchema.parse(raw) as ModelCatalog;
}

export function hashParametersSchema(
  schema: PublicSampleParametersSchema
): string {
  const digest = createHash("sha256")
    .update(canonicalJson(schema))
    .digest("hex");
  return `sha256:${digest}`;
}

function findDefaultCatalogPath(): string {
  const candidates = [
    fileURLToPath(new URL("../../catalog/v1/public-samples.json", import.meta.url)),
    fileURLToPath(new URL("../../../catalog/v1/public-samples.json", import.meta.url))
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("Versioned public sample catalog was not found.");
  }
  return found;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
