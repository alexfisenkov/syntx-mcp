import { LinkedAttemptCredentialBroker } from "../adapter/syntx/link-credential-broker.js";
import { createLinkedGenerationAdapter } from "../adapter/syntx/linked-generation.js";
import { createOwnerUncappedGenerationAuthority, getOwnerUncappedGenerationBinding, prepareOwnerUncappedGenerationRequest } from "../adapter/syntx/owner-uncapped-authority.js";
import { GenerationContractExecutorV2 } from "../adapter/syntx/generation-contract-executor-v2.js";
import { snapshotSyntxGenerationRequest } from "../adapter/syntx/upstream-adapter.js";
import { SyntxHttpClient } from "../adapter/syntx/http-client.js";
import type { SyntxCostParameter } from "../adapter/syntx/http-client.js";
import type { GenerationContractV2Request, PreparedSyntxMediaRequestV2 } from "../adapter/syntx/generation-contract-executor-v2.js";
import type { GenerationRequest } from "../domain/types.js";
import { ModelAccessService } from "../application/model-access.js";
import { hashGenerationRequest } from "../application/generation-request.js";
import { ApplicationError } from "../errors.js";
import { createReviewedContractPreflight } from "../application/reviewed-contract-preflight.js";
import type { OwnerDurableSessionAdapterContext, OwnerDurableSessionContextFactory, OwnerDurableSessionContextFactoryInput } from "./owner-durable-session-manager.js";

export interface CreateOwnerDurableLiveContextFactoryOptions {
  /** Explicit network dependency. Composition roots must choose the fetch implementation deliberately. */
  readonly fetchImpl: typeof fetch;
}

export class OwnerDurableLiveFactoryError extends Error {
  constructor(readonly code: "OWNER_MODEL_ACCESS_UNAVAILABLE") {
    super("Current owner model access could not be verified.");
    this.name = "OwnerDurableLiveFactoryError";
  }
}

/** Builds a per-attempt live adapter; never selected by a default runtime. */
export function createOwnerDurableLiveContextFactory(
  options: CreateOwnerDurableLiveContextFactoryOptions
): OwnerDurableSessionContextFactory {
  if (typeof options?.fetchImpl !== "function") throw new TypeError("OWNER_LIVE_FETCH_REQUIRED");
  const fetchImpl = options.fetchImpl;
  return async (input) => createContext(input, fetchImpl);
}

async function createContext(
  input: OwnerDurableSessionContextFactoryInput,
  globalFetch: typeof fetch
): Promise<OwnerDurableSessionAdapterContext> {
  const assertActive = () => {
    input.assertActive();
    input.borrowedLease.assertHeld();
  };
  assertActive();
  const leaseFetch: typeof fetch = async (resource, init) => {
    assertActive();
    const response = await globalFetch(resource, init);
    try { assertActive(); }
    catch (error) {
      try { await response.body?.cancel(); } catch { /* Keep the manager's fixed close error. */ }
      throw error;
    }
    return response;
  };
  const authority = input.selection !== null && input.contract !== null && input.registry !== null
    ? createOwnerUncappedGenerationAuthority({
        principal: input.principal,
        registry: input.registry,
        selectedCatalog: input.catalog,
        model_id: input.contract.model_id,
        operation_id: input.contract.operation_id,
        variant_id: input.contract.variant_id
      })
    : null;
  const linked = await createLinkedGenerationAdapter({
    transactionStore: input.transactionStore,
    linkService: input.linkService,
    binding: input.binding,
    attemptId: input.attempt_id,
    fetchImpl: leaseFetch,
    resolveAiName: () => input.contract?.ai_name ?? failClosed(),
    resolveModality: () => input.contract?.modality ?? failClosed(),
    prepareMediaRequest: (request) => {
      if (authority === null) return failClosed();
      return prepareOwnerUncappedGenerationRequest(authority, input.principal, request);
    }
  });
  assertActive();
  const readBroker = new LinkedAttemptCredentialBroker(input.linkService, input.binding, input.attempt_id);
  const readClient = new SyntxHttpClient({ credentialBroker: readBroker, fetchImpl: leaseFetch });
  if (input.selection === null || input.contract === null || input.registry === null) {
    return readOnlyContext(linked, input);
  }

  const contract = input.contract;
  const registry = input.registry;
  const catalog = input.catalog;
  const executor = new GenerationContractExecutorV2(registry, catalog);
  const preflight = createReviewedContractPreflight({
    executor,
    resolveSubscription: (_attemptId, signal) => readClient.getSubscription(signal)
  });
  if (authority === null) return failClosed();
  const owner = Object.freeze({ tenant_id: input.principal.tenant_id, subject_id: input.principal.subject_id });
  return Object.freeze({
    executionMode: "OWNER_LIVE" as const,
    async readJob(jobId: string) {
      assertActive();
      return linked.adapter.getJob({ principal: linked.principal, job_id: jobId });
    },
    async readResult(jobId: string) {
      assertActive();
      return linked.adapter.getResult({ principal: linked.principal, job_id: jobId });
    },
    async startGeneration(request: GenerationRequest, idempotencyKey: string) {
      assertActive();
      // Accepted, terminal, and unknown intents delegate replay without fresh subscription/model-access reads.
      const existing = input.transactionStore.getByIdempotencyKey(owner, idempotencyKey);
      if (existing !== null) {
        assertExactExistingIntent(existing, linked.principal, request, idempotencyKey, authority);
        if (isNoDispatchReplayState(existing.state)) {
          return linked.adapter.startOwnerGeneration({ principal: linked.principal, idempotency_key: idempotencyKey, authority }, request);
        }
      }
      const prepared = await preflight(input.attempt_id, {
        model_id: request.model_id,
        operation_id: request.operation_id,
        catalog_version: request.catalog_version,
        variant_id: contract.variant_id,
        parameters: request.parameters
      } satisfies GenerationContractV2Request);
      assertActive();
      const costParameters = selectCostParameters(prepared, catalog.getModel(contract.model_id).settings?.get_cost_params ?? []);
      let access;
      try {
        access = await new ModelAccessService(catalog, readClient).getModelAccess({ model_id: contract.model_id, cost_parameters: costParameters });
      } catch {
        throw new OwnerDurableLiveFactoryError("OWNER_MODEL_ACCESS_UNAVAILABLE");
      }
      assertActive();
      if (access.access !== true) throw new OwnerDurableLiveFactoryError("OWNER_MODEL_ACCESS_UNAVAILABLE");
      // Force the already-minted capability to match the request before the adapter can enter its saga.
      prepareOwnerUncappedGenerationRequest(authority, linked.principal, request);
      assertActive();
      const job = await linked.adapter.startOwnerGeneration({ principal: linked.principal, idempotency_key: idempotencyKey, authority }, request);
      assertActive();
      return job;
    }
  });
}

function selectCostParameters(
  prepared: PreparedSyntxMediaRequestV2,
  declared: readonly string[]
): Readonly<Record<string, SyntxCostParameter>> {
  const selected: Record<string, SyntxCostParameter> = {};
  for (const key of declared) {
    if (key === "ai_name" || key === "model_type" || !Object.hasOwn(prepared.settings, key)) continue;
    const value = prepared.settings[key];
    if (typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
      Object.defineProperty(selected, key, { value, enumerable: true, configurable: false, writable: false });
    }
  }
  return Object.freeze(selected);
}

function readOnlyContext(
  linked: Awaited<ReturnType<typeof createLinkedGenerationAdapter>>,
  input: OwnerDurableSessionContextFactoryInput
): OwnerDurableSessionAdapterContext {
  return Object.freeze({
    async readJob(jobId: string) {
      input.assertActive();
      input.borrowedLease.assertHeld();
      return linked.adapter.getJob({ principal: linked.principal, job_id: jobId });
    },
    async readResult(jobId: string) {
      input.assertActive();
      input.borrowedLease.assertHeld();
      return linked.adapter.getResult({ principal: linked.principal, job_id: jobId });
    }
  });
}

function failClosed(): never { throw new Error("OWNER_LIVE_SELECTION_REQUIRED"); }

function assertExactExistingIntent(
  existing: import("../domain/generation-operation.js").GenerationOperationRecord,
  principal: import("../domain/generation-operation.js").GenerationPrincipalRef,
  request: import("../domain/types.js").GenerationRequest,
  idempotencyKey: string,
  authority: import("../adapter/syntx/owner-uncapped-authority.js").OwnerUncappedGenerationAuthority
): void {
  const binding = getOwnerUncappedGenerationBinding(authority, principal);
  const snapshot = snapshotSyntxGenerationRequest(request);
  if (existing.idempotency_key !== idempotencyKey || existing.principal.tenant_id !== principal.tenant_id ||
      existing.principal.subject_id !== principal.subject_id || existing.principal.connection_id !== principal.connection_id ||
      existing.request_hash !== hashGenerationRequest(snapshot) || existing.model_id !== binding.model_id ||
      existing.operation_id !== binding.operation_id || existing.catalog_version !== binding.catalog_version ||
      existing.schema_hash !== binding.schema_hash || existing.approved_max_cost !== "OWNER_UNCAPPED" ||
      existing.cost.cap_enforcement !== "UNENFORCEABLE") {
    throw new ApplicationError("IDEMPOTENCY_CONFLICT", "The idempotency key is already bound to another owner generation request.");
  }
}

function isNoDispatchReplayState(state: import("../domain/generation-operation.js").GenerationOperationState): boolean {
  return state === "CHAT_CREATE_OUTCOME_UNKNOWN" || state === "CHAT_RECONCILING" || state === "GENERATION_OUTCOME_UNKNOWN" ||
    state === "GENERATION_RECONCILING" || state === "PROVIDER_ACCEPTED" || state === "QUEUED" ||
    state === "RUNNING" || state === "SUCCEEDED" || state === "FAILED" || state === "CANCELED" ||
    state === "REJECTED_NO_COMMIT" || state === "TERMINAL_UNRESOLVED";
}
