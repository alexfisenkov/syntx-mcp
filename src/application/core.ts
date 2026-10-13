import type { UpstreamAdapter } from "../adapter/upstream-adapter.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import {
  generationPrincipalKey,
  snapshotGenerationPrincipal
} from "../domain/generation-principal.js";
import { CatalogRepository } from "../catalog/catalog.js";
import type {
  DiscoveryCatalogMetadata,
  DiscoveryCatalogRepository,
  DiscoveryModelRecord,
  DiscoveryOperationId
} from "../catalog/discovery-catalog.js";
import type {
  RuntimeCapabilityCatalog,
  RuntimeCapabilityRecord
} from "../catalog/runtime-capability-catalog.js";
import type {
  Balance,
  CatalogModel,
  GenerationEstimate,
  GenerationJob,
  GenerationRequest,
  GenerationResult,
  Modality,
  PublicSampleParametersSchema,
  UpstreamGenerationEstimate
} from "../domain/types.js";
import { ApplicationError, ComplianceBlockedError } from "../errors.js";
import type { ConfirmationStore } from "../policy/confirmation-store.js";
import {
  hashGenerationRequest,
  normalizeParameters
} from "./generation-request.js";

export interface SearchModelsRequest {
  query?: string | undefined;
  modality?: Modality | undefined;
  operation?: string | undefined;
  include_inactive?: boolean | undefined;
  cursor?: string | undefined;
  limit: number;
}

export interface SearchModelsResponse {
  catalog_version: string;
  catalog_kind: "PUBLIC_SAMPLE" | "OFFICIAL_PUBLIC_API_SNAPSHOT";
  runtime_usable: false;
  catalog_metadata?: DiscoveryCatalogMetadata;
  coverage_status: string;
  total: number;
  next_cursor: string | null;
  models: Array<{
    id: string;
    display_name: string;
    family: string;
    modalities: Modality[];
    coverage_status: string;
    active?: boolean | undefined;
    default?: boolean | undefined;
    scope?: string | null | undefined;
    type?: string | null | undefined;
    operations: Array<{ id: string; display_name: string }>;
  }>;
}

export interface GetModelResponse {
  catalog_version: string;
  catalog_kind: "PUBLIC_SAMPLE" | "OFFICIAL_PUBLIC_API_SNAPSHOT";
  runtime_usable: false;
  catalog_metadata?: DiscoveryCatalogMetadata;
  coverage_status: string;
  model:
    | CatalogModel
    | (DiscoveryModelRecord & {
        runtime_capability?: RuntimeCapabilityRecord;
      });
}

export interface StartGenerationRequest {
  model_id: string;
  operation_id: string;
  parameters: Record<string, unknown>;
  idempotency_key: string;
  confirmation_id: string;
}

export interface StartGenerationResponse {
  job: GenerationJob;
  replayed: boolean;
}

export interface CancelJobRequest {
  job_id: string;
  idempotency_key: string;
  confirmation_id?: string | undefined;
}

export interface CancelJobResponse {
  job: GenerationJob;
  replayed: boolean;
}

interface InFlightStart {
  request_hash: string;
  promise: Promise<StartAttempt>;
}

interface StartAttempt {
  job: GenerationJob;
  reconciled: boolean;
}

interface InFlightCancel {
  job_id: string;
  promise: Promise<CancelAttempt>;
}

interface CancelAttempt {
  job: GenerationJob;
  reconciled: boolean;
}

export type ExecutionProfile = "COMPLIANCE_BLOCKED" | "TEST_ONLY_MOCK";

export class ApplicationCore {
  private readonly starts = new Map<string, InFlightStart>();
  private readonly cancellations = new Map<string, InFlightCancel>();
  private readonly principal: Readonly<GenerationPrincipalRef>;

  constructor(
    readonly catalog: CatalogRepository,
    private readonly adapter: UpstreamAdapter,
    private readonly confirmations: ConfirmationStore,
    principal: GenerationPrincipalRef,
    private readonly executionProfile: ExecutionProfile,
    private readonly discoveryCatalog?: DiscoveryCatalogRepository,
    private readonly runtimeCapabilities?: RuntimeCapabilityCatalog
  ) {
    this.principal = snapshotGenerationPrincipal(principal);
  }

  searchModels(input: SearchModelsRequest): SearchModelsResponse {
    if (this.discoveryCatalog) {
      const found = this.discoveryCatalog.search({
        ...(input.query === undefined ? {} : { query: input.query }),
        ...(input.modality === undefined ? {} : { modality: input.modality }),
        ...(input.operation === undefined
          ? {}
          : { operation: input.operation as DiscoveryOperationId }),
        include_inactive: input.include_inactive ?? false,
        limit: input.limit,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor })
      });
      return {
        catalog_version: discoveryCatalogVersion(this.discoveryCatalog),
        catalog_kind: found.catalog_kind,
        runtime_usable: found.runtime_usable,
        catalog_metadata: found.catalog_metadata,
        coverage_status: "PARTIAL",
        total: found.total,
        next_cursor: found.next_cursor,
        models: found.items.map((model) => ({
          id: model.id,
          display_name: model.display_name,
          family: model.ai_name,
          modalities: model.modalities,
          coverage_status: "PARTIAL",
          active: model.active,
          default: model.default,
          scope: model.scope,
          type: model.type,
          operations: model.operations.map((operation) => ({
            id: operation.id,
            display_name: operation.display_name
          }))
        }))
      };
    }

    const found = this.catalog.search(input);
    return {
      catalog_version: this.catalog.catalog.catalog_version,
      catalog_kind: this.catalog.catalog.catalog_kind,
      runtime_usable: this.catalog.catalog.runtime_usable,
      coverage_status: this.catalog.catalog.coverage_status,
      total: found.total,
      next_cursor: null,
      models: found.models.map((model) => ({
        id: model.id,
        display_name: model.display_name,
        family: model.family,
        modalities: model.modalities,
        coverage_status: model.coverage_status,
        operations: model.operations.map((operation) => ({
          id: operation.id,
          display_name: operation.display_name
        }))
      }))
    };
  }

  getModel(modelId: string, operationId?: string): GetModelResponse {
    if (this.discoveryCatalog) {
      const model = selectDiscoveryModelOperation(
        this.discoveryCatalog,
        modelId,
        operationId
      );
      return {
        catalog_version: discoveryCatalogVersion(this.discoveryCatalog),
        catalog_kind: this.discoveryCatalog.catalog_kind,
        runtime_usable: this.discoveryCatalog.runtime_usable,
        catalog_metadata: this.discoveryCatalog.catalog_metadata,
        coverage_status: "PARTIAL",
        model: {
          ...model,
          ...(this.runtimeCapabilities
            ? { runtime_capability: this.runtimeCapabilities.get(modelId) }
            : {})
        }
      };
    }

    const model = this.catalog.getModel(modelId);
    const selected = operationId
      ? {
          ...model,
          operations: [this.catalog.getOperation(modelId, operationId)]
        }
      : model;
    return {
      catalog_version: this.catalog.catalog.catalog_version,
      catalog_kind: this.catalog.catalog.catalog_kind,
      runtime_usable: this.catalog.catalog.runtime_usable,
      coverage_status: this.catalog.catalog.coverage_status,
      model: selected
    };
  }

  getBalance(): Promise<Balance> {
    return this.adapter.getBalance(this.principal);
  }

  async estimateGeneration(input: {
    model_id: string;
    operation_id: string;
    parameters: Record<string, unknown>;
  }): Promise<GenerationEstimate> {
    this.assertTestOnlyExecution("estimate_generation");
    const request = this.buildGenerationRequest(input);
    const requestHash = hashGenerationRequest(request);
    const estimate = await this.adapter.estimateGeneration(this.principal, request);
    const normalizedEstimate: UpstreamGenerationEstimate = {
      ...estimate,
      request_hash: requestHash,
      model_id: request.model_id,
      operation_id: request.operation_id,
      catalog_version: request.catalog_version,
      normalized_parameters: request.parameters
    };
    const approval = this.confirmations.describeGenerationApproval(
      this.principal,
      normalizedEstimate
    );
    return {
      estimate_id: normalizedEstimate.estimate_id,
      request_hash: normalizedEstimate.request_hash,
      model_id: normalizedEstimate.model_id,
      operation_id: normalizedEstimate.operation_id,
      catalog_version: normalizedEstimate.catalog_version,
      parameter_keys: Object.keys(normalizedEstimate.normalized_parameters),
      parameters_redacted: true,
      parameters_valid: normalizedEstimate.parameters_valid,
      cost: normalizedEstimate.cost,
      expires_at: normalizedEstimate.expires_at,
      notes: normalizedEstimate.notes,
      approval
    };
  }

  async startGeneration(
    input: StartGenerationRequest
  ): Promise<StartGenerationResponse> {
    this.assertTestOnlyExecution("start_generation");
    const request = this.buildGenerationRequest(input);
    const requestHash = hashGenerationRequest(request);
    const idempotencyId = JSON.stringify([
      generationPrincipalKey(this.principal), input.idempotency_key
    ]);
    const existing = this.starts.get(idempotencyId);

    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw new ApplicationError(
          "IDEMPOTENCY_CONFLICT",
          "The idempotency key is already associated with another generation request."
        );
      }
      return { job: (await existing.promise).job, replayed: true };
    }

    const promise = this.startConfirmedGeneration(input, request, requestHash);
    this.starts.set(idempotencyId, { request_hash: requestHash, promise });

    try {
      const attempt = await promise;
      return { job: attempt.job, replayed: attempt.reconciled };
    } catch (error) {
      this.starts.delete(idempotencyId);
      throw error;
    }
  }

  getJob(jobId: string): Promise<GenerationJob> {
    return this.adapter.getJob({ principal: this.principal, job_id: jobId });
  }

  async cancelJob(input: CancelJobRequest): Promise<CancelJobResponse> {
    this.assertTestOnlyExecution("cancel_job");
    const idempotencyId = JSON.stringify([
      generationPrincipalKey(this.principal), input.idempotency_key
    ]);
    const existing = this.cancellations.get(idempotencyId);
    if (existing) {
      if (existing.job_id !== input.job_id) {
        throw new ApplicationError(
          "IDEMPOTENCY_CONFLICT",
          "The cancellation idempotency key is already associated with another job."
        );
      }
      return { job: (await existing.promise).job, replayed: true };
    }

    const promise = this.cancelConfirmedJob(input);
    this.cancellations.set(idempotencyId, { job_id: input.job_id, promise });
    try {
      const attempt = await promise;
      return { job: attempt.job, replayed: attempt.reconciled };
    } finally {
      // This map only coalesces calls that are still in flight. Completed
      // cancellation attempts must reconcile against the adapter's ledger:
      // an ACK may have returned queued while the paid job later succeeded.
      if (this.cancellations.get(idempotencyId)?.promise === promise) {
        this.cancellations.delete(idempotencyId);
      }
    }
  }

  getResult(jobId: string): Promise<GenerationResult> {
    return this.adapter.getResult({ principal: this.principal, job_id: jobId });
  }

  private async startConfirmedGeneration(
    input: StartGenerationRequest,
    request: GenerationRequest,
    requestHash: string
  ): Promise<StartAttempt> {
    const reconciled = await this.adapter.reconcileStart({
      principal: this.principal,
      idempotency_key: input.idempotency_key,
      request_hash: requestHash
    });
    if (reconciled) {
      return { job: reconciled, reconciled: true };
    }

    const approval = await this.confirmations.consumeGeneration({
      principal: this.principal,
      confirmation_id: input.confirmation_id,
      request_hash: requestHash
    });
    const job = await this.adapter.startGeneration(
      {
        principal: this.principal,
        idempotency_key: input.idempotency_key,
        confirmation_id: approval.confirmation_id,
        approved_max_cost_tokens: approval.approved_max_cost_tokens
      },
      request
    );
    return { job, reconciled: false };
  }

  private async cancelConfirmedJob(
    input: CancelJobRequest
  ): Promise<CancelAttempt> {
    const reconciled = await this.adapter.reconcileCancel({
      principal: this.principal,
      job_id: input.job_id,
      idempotency_key: input.idempotency_key
    });
    if (reconciled) {
      return { job: reconciled, reconciled: true };
    }
    if (!input.confirmation_id) {
      throw new ApplicationError(
        "CONFIRMATION_REQUIRED",
        "A cancellation confirmation is required for the first attempt."
      );
    }
    const approval = await this.confirmations.consumeCancellation({
      principal: this.principal,
      confirmation_id: input.confirmation_id,
      job_id: input.job_id
    });
    const job = await this.adapter.cancelJob({
      principal: this.principal,
      job_id: input.job_id,
      idempotency_key: input.idempotency_key,
      confirmation_id: approval.confirmation_id
    });
    return { job, reconciled: false };
  }

  private assertTestOnlyExecution(operation: string): void {
    if (this.executionProfile !== "TEST_ONLY_MOCK") {
      throw new ComplianceBlockedError(`${operation}_transactional_boundary`);
    }
  }

  private buildGenerationRequest(input: {
    model_id: string;
    operation_id: string;
    parameters: Record<string, unknown>;
  }): GenerationRequest {
    if (this.discoveryCatalog) {
      selectDiscoveryModelOperation(
        this.discoveryCatalog,
        input.model_id,
        input.operation_id
      );
      // Keep the same exact identity as search/get. Public settings and
      // static-client overlays are not executable contracts; never fall
      // through to a sample schema or guess an alias for a known variant.
      throw new ApplicationError(
        "GENERATION_CONTRACT_UNAVAILABLE",
        "The selected model and operation are known, but no executable generation contract is available."
      );
    }
    const operation = this.catalog.getOperation(
      input.model_id,
      input.operation_id
    );
    validateParameters(operation.parameters_schema, input.parameters);
    return {
      model_id: input.model_id,
      operation_id: input.operation_id,
      parameters: normalizeParameters(input.parameters),
      catalog_version: this.catalog.catalog.catalog_version
    };
  }
}

function selectDiscoveryModelOperation(
  catalog: DiscoveryCatalogRepository,
  modelId: string,
  operationId?: string
): DiscoveryModelRecord {
  const model = catalog.getModel(modelId);
  if (operationId === undefined) return model;
  const operation = model.operations.find((candidate) => candidate.id === operationId);
  if (!operation) {
    throw new ApplicationError(
      "OPERATION_NOT_FOUND",
      "The requested operation is not present on this public catalog model."
    );
  }
  return { ...model, operations: [operation] };
}

function discoveryCatalogVersion(
  catalog: DiscoveryCatalogRepository
): string {
  return `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
}

function validateParameters(
  schema: PublicSampleParametersSchema,
  parameters: Record<string, unknown>
): void {
  const issues: string[] = [];
  const allowed = new Set(Object.keys(schema.properties));

  for (const required of schema.required) {
    if (!(required in parameters)) {
      issues.push(`${required}: required`);
    }
  }
  for (const [name, value] of Object.entries(parameters)) {
    if (!allowed.has(name)) {
      issues.push(`${name}: unknown parameter`);
      continue;
    }
    const property = schema.properties[name];
    if (!property) continue;
    if (typeof value !== "string") {
      issues.push(`${name}: expected string`);
      continue;
    }
    if (property.minLength !== undefined && value.length < property.minLength) {
      issues.push(`${name}: shorter than ${property.minLength}`);
    }
    if (property.maxLength !== undefined && value.length > property.maxLength) {
      issues.push(`${name}: longer than ${property.maxLength}`);
    }
    if (property.enum && !property.enum.includes(value)) {
      issues.push(`${name}: unsupported value`);
    }
  }

  if (issues.length) {
    throw new ApplicationError(
      "INVALID_PARAMETERS",
      "Generation parameters do not match the catalog schema.",
      { issues }
    );
  }
}
