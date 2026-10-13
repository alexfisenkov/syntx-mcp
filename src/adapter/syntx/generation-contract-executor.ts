import { snapshotSyntxGenerationRequest, type PreparedSyntxMediaRequest } from "./upstream-adapter.js";
import type { GenerationRequest } from "../../domain/types.js";
import {
  generationContractRegistrySchema,
  type GenerationContract,
  type GenerationContractRegistry
} from "../../domain/generation-contract.js";
import { validateGenerationParameters } from "../../application/generation-contract-validator.js";

export interface GenerationContractCatalogModel {
  readonly id: string;
  readonly upstream_id: string;
  readonly ai_name: string;
  readonly active: boolean;
  readonly operations: readonly { readonly id: string; readonly output_modality: string }[];
  readonly fetched_at: string;
  readonly source_hashes: { readonly ai: string; readonly llm_models: string; readonly models: string };
}

export interface GenerationContractCatalogPort {
  getModel(modelId: string): GenerationContractCatalogModel;
}

export type GenerationContractExecutionErrorCode =
  | "GENERATION_CONTRACT_NOT_FOUND"
  | "GENERATION_CONTRACT_NOT_REVIEWED"
  | "GENERATION_CONTRACT_CATALOG_MISMATCH"
  | "GENERATION_CONTRACT_IDENTITY_MISMATCH"
  | "GENERATION_CONTRACT_PROMPT_INVALID";

export class GenerationContractExecutionError extends Error {
  constructor(readonly code: GenerationContractExecutionErrorCode) {
    super("The generation contract could not prepare this request safely.");
    this.name = "GenerationContractExecutionError";
  }
}

/** Pure offline request preparation. It never resolves credentials or performs I/O. */
export class GenerationContractExecutor {
  readonly #registry: GenerationContractRegistry;
  readonly #catalog: GenerationContractCatalogPort;
  readonly #byKey: ReadonlyMap<string, GenerationContract>;

  constructor(registry: GenerationContractRegistry, catalog: GenerationContractCatalogPort) {
    this.#registry = generationContractRegistrySchema.parse(registry);
    this.#catalog = catalog;
    this.#byKey = new Map(this.#registry.contracts.map((contract) => [keyOf(contract.model_id, contract.operation_id), contract]));
  }

  getContract(modelId: string, operationId: string): GenerationContract | null {
    const contract = this.#byKey.get(keyOf(modelId, operationId));
    return contract === undefined ? null : cloneFrozen(contract);
  }

  listContracts(): readonly GenerationContract[] {
    return Object.freeze(this.#registry.contracts.map(cloneFrozen));
  }

  prepare(request: GenerationRequest): PreparedSyntxMediaRequest {
    let safeRequest: GenerationRequest;
    try { safeRequest = snapshotSyntxGenerationRequest(request); }
    catch { throw executionError("GENERATION_CONTRACT_NOT_FOUND"); }
    if (safeRequest.catalog_version !== this.#registry.catalog_version) throw executionError("GENERATION_CONTRACT_CATALOG_MISMATCH");
    const contract = this.#byKey.get(keyOf(safeRequest.model_id, safeRequest.operation_id));
    if (!contract) throw executionError("GENERATION_CONTRACT_NOT_FOUND");
    if (contract.status !== "reviewed" && contract.status !== "live_verified") throw executionError("GENERATION_CONTRACT_NOT_REVIEWED");

    let model: GenerationContractCatalogModel;
    try { model = this.#catalog.getModel(safeRequest.model_id); }
    catch { throw executionError("GENERATION_CONTRACT_IDENTITY_MISMATCH"); }
    const operation = model.operations.find((candidate) => candidate.id === request.operation_id);
    if (!model.active || model.id !== contract.model_id || model.ai_name !== contract.ai_name ||
        model.upstream_id !== contract.model_type || !operation || operation.output_modality !== contract.modality ||
        `${model.fetched_at}.${model.source_hashes.models.slice(7, 19)}` !== this.#registry.catalog_version ||
        !sameSourceHashes(model.source_hashes, this.#registry.source_hashes)) {
      throw executionError("GENERATION_CONTRACT_IDENTITY_MISMATCH");
    }

    const parameters = validateGenerationParameters(contract, safeRequest.parameters);
    const prompt = parameters[contract.wire.prompt_field];
    if (typeof prompt !== "string" || prompt.trim().length === 0 ||
        Buffer.byteLength(prompt, "utf8") > contract.limits.max_serialized_bytes ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(prompt)) {
      throw executionError("GENERATION_CONTRACT_PROMPT_INVALID");
    }

    const settings: Record<string, unknown> = { ...contract.wire.fixed_settings };
    for (const [wireField, parameterField] of Object.entries(contract.wire.settings_fields)) {
      if (Object.hasOwn(parameters, parameterField)) settings[wireField] = parameters[parameterField];
    }
    settings.model_type = contract.model_type;
    return Object.freeze({
      prompt,
      settings: Object.freeze(settings),
      ai_name: contract.ai_name,
      modality: contract.modality,
      schema_hash: contract.schema_hash
    });
  }
}

function keyOf(modelId: string, operationId: string): string { return `${modelId}\u0000${operationId}`; }

function sameSourceHashes(
  left: { readonly ai: string; readonly llm_models: string; readonly models: string },
  right: { readonly ai: string; readonly llm_models: string; readonly models: string }
): boolean {
  return left.ai === right.ai && left.llm_models === right.llm_models && left.models === right.models;
}

function executionError(code: GenerationContractExecutionErrorCode): GenerationContractExecutionError {
  return new GenerationContractExecutionError(code);
}

function cloneFrozen<T>(value: T): T {
  const copy = structuredClone(value);
  return deepFreeze(copy);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
