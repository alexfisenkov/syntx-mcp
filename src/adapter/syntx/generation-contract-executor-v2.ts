import { types } from "node:util";
import type { PreparedSyntxMediaRequest } from "./upstream-adapter.js";
import type { GenerationContractCatalogModel, GenerationContractCatalogPort } from "./generation-contract-executor.js";
import { validateGenerationParametersV2, GenerationContractValidationErrorV2 } from "../../application/generation-contract-validator-v2.js";
import {
  generationContractRegistryV2Schema,
  type GenerationContractRegistryV2,
  type GenerationContractV2
} from "../../domain/generation-contract-v2.js";

export interface GenerationContractV2Request {
  readonly model_id: string;
  readonly operation_id: string;
  readonly catalog_version: string;
  readonly variant_id?: string;
  readonly parameters: unknown;
}

export interface PreparedSyntxMediaRequestV2 extends PreparedSyntxMediaRequest {
  readonly contract_metadata: {
    readonly schema_version: "2.0.0";
    readonly operation_id: string;
    readonly dispatch_action: string;
    readonly variant_id: string;
  };
}

export type GenerationContractExecutionErrorCodeV2 =
  | "GENERATION_CONTRACT_NOT_FOUND"
  | "GENERATION_CONTRACT_NOT_REVIEWED"
  | "GENERATION_CONTRACT_CATALOG_MISMATCH"
  | "GENERATION_CONTRACT_IDENTITY_MISMATCH"
  | "GENERATION_CONTRACT_PROMPT_INVALID"
  | "GENERATION_CONTRACT_VARIANT_AMBIGUOUS"
  | "GENERATION_CONTRACT_VARIANT_NOT_FOUND"
  | "GENERATION_CONTRACT_VALIDATION_FAILED"
  | "GENERATION_CONTRACT_ACTION_UNSUPPORTED";

export class GenerationContractExecutionErrorV2 extends Error {
  constructor(
    readonly code: GenerationContractExecutionErrorCodeV2,
    readonly validationCode?: GenerationContractValidationErrorV2["code"]
  ) {
    super("The v2 generation contract could not prepare this request safely.");
    this.name = "GenerationContractExecutionErrorV2";
  }
}

/** Pure, variant-aware request preparation. It never resolves credentials or performs I/O. */
export class GenerationContractExecutorV2 {
  readonly #registry: GenerationContractRegistryV2;
  readonly #catalog: GenerationContractCatalogPort;
  readonly #byKey: ReadonlyMap<string, readonly GenerationContractV2[]>;

  constructor(registry: GenerationContractRegistryV2, catalog: GenerationContractCatalogPort) {
    this.#registry = deepFreeze(generationContractRegistryV2Schema.parse(registry));
    this.#catalog = catalog;
    const variants = new Map<string, GenerationContractV2[]>();
    for (const contract of this.#registry.contracts) {
      const key = tupleKey(contract.model_id, contract.operation_id);
      const list = variants.get(key) ?? [];
      list.push(contract);
      variants.set(key, list);
    }
    this.#byKey = new Map([...variants.entries()].map(([key, list]) => [key, Object.freeze(list)]));
  }

  availableVariantIds(modelId: string, operationId: string): readonly string[] {
    const contracts = this.#byKey.get(tupleKey(modelId, operationId)) ?? [];
    return Object.freeze(contracts.map((contract) => contract.variant_id).sort((left, right) => left.localeCompare(right)));
  }

  getContract(modelId: string, operationId: string, variantId?: string): GenerationContractV2 | null {
    const contract = this.#resolveContract(modelId, operationId, variantId);
    return contract === null ? null : cloneFrozen(contract);
  }

  listContracts(): readonly GenerationContractV2[] {
    return Object.freeze(this.#registry.contracts.map(cloneFrozen));
  }

  prepare(input: GenerationContractV2Request | unknown): PreparedSyntxMediaRequestV2 {
    const request = snapshotRequest(input);
    if (request.catalog_version !== this.#registry.catalog_version) fail("GENERATION_CONTRACT_CATALOG_MISMATCH");
    const contract = this.#resolveContract(request.model_id, request.operation_id, request.variant_id);
    if (contract === null) fail("GENERATION_CONTRACT_NOT_FOUND");
    if (contract.status !== "reviewed" && contract.status !== "live_verified") fail("GENERATION_CONTRACT_NOT_REVIEWED");
    if (!supportedAction(contract.wire.dispatch_action) || contract.wire.dispatch_action !== contract.operation_id) {
      fail("GENERATION_CONTRACT_ACTION_UNSUPPORTED");
    }

    let model: GenerationContractCatalogModel;
    try { model = this.#catalog.getModel(request.model_id); }
    catch { fail("GENERATION_CONTRACT_IDENTITY_MISMATCH"); }
    const operation = model.operations.find((candidate) => candidate.id === request.operation_id);
    const sourceRefs = contract.provenance.references.filter((reference) =>
      reference.kind === "frontend_static" || reference.kind === "official_contract"
    );
    if (model.active !== true || model.id !== contract.model_id || model.ai_name !== contract.ai_name ||
        model.upstream_id !== contract.model_type || operation === undefined || operation.output_modality !== contract.modality ||
        catalogVersionFor(model) !== this.#registry.catalog_version || !sameSourceHashes(model.source_hashes, this.#registry.source_hashes) ||
        contract.provenance.settings_source_sha256 === null ||
        !sourceRefs.some((reference) => reference.sha256 === contract.provenance.settings_source_sha256)) {
      fail("GENERATION_CONTRACT_IDENTITY_MISMATCH");
    }

    let parameters: Readonly<Record<string, unknown>>;
    try { parameters = validateGenerationParametersV2(contract, request.parameters); }
    catch (error) {
      if (error instanceof GenerationContractValidationErrorV2) {
        throw new GenerationContractExecutionErrorV2("GENERATION_CONTRACT_VALIDATION_FAILED", error.code);
      }
      fail("GENERATION_CONTRACT_VALIDATION_FAILED");
    }

    const promptField = contract.wire.prompt_field;
    const prompt = promptField === null ? undefined : parameters[promptField];
    if (typeof prompt !== "string" || prompt.trim().length === 0 ||
        Buffer.byteLength(prompt, "utf8") > contract.limits.max_serialized_bytes ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(prompt)) {
      fail("GENERATION_CONTRACT_PROMPT_INVALID");
    }

    const settings: Record<string, unknown> = structuredClone(contract.wire.fixed_settings);
    for (const [parameterField, wireField] of Object.entries(contract.wire.settings_fields)) {
      if (Object.hasOwn(parameters, parameterField)) settings[wireField] = parameters[parameterField];
    }
    settings.model_type = contract.model_type;
    return Object.freeze({
      prompt,
      settings: deepFreeze(settings),
      ai_name: contract.ai_name,
      modality: contract.modality,
      schema_hash: contract.schema_hash,
      contract_metadata: Object.freeze({
        schema_version: "2.0.0" as const,
        operation_id: contract.operation_id,
        dispatch_action: contract.wire.dispatch_action,
        variant_id: contract.variant_id
      })
    });
  }

  #resolveContract(modelId: string, operationId: string, variantId?: string): GenerationContractV2 | null {
    const contracts = this.#byKey.get(tupleKey(modelId, operationId)) ?? [];
    if (contracts.length === 0) return null;
    if (variantId === undefined) {
      if (contracts.length > 1) fail("GENERATION_CONTRACT_VARIANT_AMBIGUOUS");
      return contracts[0] ?? null;
    }
    return contracts.find((contract) => contract.variant_id === variantId) ?? fail("GENERATION_CONTRACT_VARIANT_NOT_FOUND");
  }
}

function snapshotRequest(input: unknown): GenerationContractV2Request {
  if (input === null || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) fail("GENERATION_CONTRACT_NOT_FOUND");
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) fail("GENERATION_CONTRACT_NOT_FOUND");
  const keys = Reflect.ownKeys(input);
  const allowed = new Set(["model_id", "operation_id", "catalog_version", "variant_id", "parameters"]);
  if (keys.some((key) => typeof key !== "string" || !allowed.has(key)) ||
      !["model_id", "operation_id", "catalog_version", "parameters"].every((key) => keys.includes(key)) || keys.length > 5) {
    fail("GENERATION_CONTRACT_NOT_FOUND");
  }
  const values = new Map<string, unknown>();
  for (const key of keys) {
    if (typeof key !== "string") fail("GENERATION_CONTRACT_NOT_FOUND");
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) fail("GENERATION_CONTRACT_NOT_FOUND");
    values.set(key, descriptor.value);
  }
  const modelId = values.get("model_id");
  const operationId = values.get("operation_id");
  const catalogVersion = values.get("catalog_version");
  const variantId = values.get("variant_id");
  if (!isSafeBinding(modelId) || !isSafeBinding(operationId) || !isSafeBinding(catalogVersion) ||
      (variantId !== undefined && !isSafeBinding(variantId))) fail("GENERATION_CONTRACT_NOT_FOUND");
  return Object.freeze({
    model_id: modelId,
    operation_id: operationId,
    catalog_version: catalogVersion,
    ...(variantId === undefined ? {} : { variant_id: variantId }),
    parameters: values.get("parameters")
  });
}

function catalogVersionFor(model: GenerationContractCatalogModel): string {
  return `${model.fetched_at}.${model.source_hashes.models.slice(7, 19)}`;
}

function sameSourceHashes(
  left: { readonly ai: string; readonly llm_models: string; readonly models: string },
  right: { readonly ai: string; readonly llm_models: string; readonly models: string }
): boolean {
  return left.ai === right.ai && left.llm_models === right.llm_models && left.models === right.models;
}

function supportedAction(action: string): boolean {
  return action === "generate-image" || action === "generate-video" || action === "generate-audio";
}

function isSafeBinding(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:~+-]{0,199}$/u.test(value);
}

function tupleKey(modelId: string, operationId: string): string { return `${modelId}\u0000${operationId}`; }

function fail(code: GenerationContractExecutionErrorCodeV2): never {
  throw new GenerationContractExecutionErrorV2(code);
}

function cloneFrozen<T>(value: T): T { return deepFreeze(structuredClone(value)); }

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
