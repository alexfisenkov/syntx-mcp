import { resolve } from "node:path";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { AuthBinding } from "../auth/types.js";
import type { AuthLinkStore } from "../auth/auth-link-store.js";
import type { GenerationTransactionStore } from "../storage/generation-transaction-store.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import type { GenerationContractRegistry } from "../domain/generation-contract.js";
import { generationContractRegistrySchema } from "../domain/generation-contract.js";
import { GenerationContractExecutor } from "../adapter/syntx/generation-contract-executor.js";
import { GenerationContractExecutorV2 } from "../adapter/syntx/generation-contract-executor-v2.js";
import type { GenerationContractRegistryV2 } from "../domain/generation-contract-v2.js";
import { generationContractRegistryV2Schema } from "../domain/generation-contract-v2.js";
import { createLinkedGenerationAdapter } from "../adapter/syntx/linked-generation.js";
import type { PreparedSyntxMediaRequest } from "../adapter/syntx/upstream-adapter.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { createReviewedContractPreflight } from "../application/reviewed-contract-preflight.js";
import type { SyntxSubscription } from "../adapter/syntx/account-decoder.js";
import type { UpstreamAdapter } from "../adapter/upstream-adapter.js";
import type { Balance, GenerationJob, GenerationRequest, GenerationResult, UpstreamGenerationEstimate } from "../domain/types.js";
import { ApplicationError } from "../errors.js";
import {
  projectDurableOwnerV2PreparedRequest,
  selectDurableOwnerV2Request,
  type DurableOwnerV2VariantSelection
} from "./durable-owner-generation-v2.js";
import {
  assertBorrowedOwnerProfileLease,
  acquireOwnerProfileLease,
  assertOwnerProfileDirectory,
  type BorrowedOwnerProfileLease
} from "./private-owner-generation-profile.js";

export type DurableOwnerGenerationMode = "OFFLINE_VALIDATION_ONLY";
export type DurableOwnerContractStatus =
  | "REGISTRY_NOT_SUPPLIED"
  | "REGISTRY_CATALOG_MISMATCH"
  | "REGISTRY_VALIDATED";

export interface DurableOwnerAuthContext {
  /** Must be the same store used to construct `linkService`. */
  readonly store: AuthLinkStore;
  readonly linkService: PerUserLinkService;
  readonly binding: AuthBinding;
  /** Exact trusted local profile selection; never an MCP/tool value. */
  readonly attemptId: string;
}

export interface DurableOwnerRuntimeLease {
  assertHeld(): void;
  release(): void;
}

/** Reuse the same exclusive per-profile lock for other local owner stores. */
export function acquireLocalOwnerProfileLease(profileDirectory: string): DurableOwnerRuntimeLease {
  const resolved = resolve(profileDirectory);
  return acquireOwnerProfileLease(resolved);
}

export interface DurableOwnerGenerationRuntimeOptions {
  /** Existing private per-account directory, required to be a real 0700 directory. */
  readonly profileDirectory: string;
  /** Existing auth-profile lease borrow; child runtime never owns/releases this lease or auth store. */
  readonly borrowedOwnerProfileLease?: BorrowedOwnerProfileLease;
  /** Called only after the single-process lease is acquired. Inject the auth store with its vault/key resolver here. */
  readonly createAuthContext: (profileDirectory: string) => DurableOwnerAuthContext | Promise<DurableOwnerAuthContext>;
  /** Called only after the single-process lease is acquired; normally SQLite in the same private profile directory. */
  readonly createTransactionStore: (profileDirectory: string) => GenerationTransactionStore | Promise<GenerationTransactionStore>;
  /** The exact selected discovery snapshot for this profile. */
  readonly catalog: DiscoveryCatalogRepository;
  /** An absent registry keeps this composition offline and fails preparation closed. */
  readonly registry?: GenerationContractRegistry | GenerationContractRegistryV2 | null;
  /** Trusted local-only V2 variant selectors; never MCP input or parameter values. */
  readonly v2VariantSelections?: readonly DurableOwnerV2VariantSelection[];
  /** Explicit test-only account reader; omission disables subscription reads. */
  readonly offlineSubscriptionReader?: (attemptId: string, signal?: AbortSignal) => Promise<SyntxSubscription>;
  /** Explicit fake gateway for local tests; omission denies every outbound request. */
  readonly offlineFetchImpl?: typeof fetch;
  readonly requestTimeoutMs?: number;
  readonly now?: () => Date;
  readonly createOperationId?: () => string;
}

export interface DurableOwnerGenerationRuntime {
  readonly mode: DurableOwnerGenerationMode;
  readonly contract_status: DurableOwnerContractStatus;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly authStore: AuthLinkStore;
  readonly transactionStore: GenerationTransactionStore;
  readonly executor: GenerationContractExecutor | GenerationContractExecutorV2 | null;
  /** Internal adapter port for offline integration tests/future explicit wiring; never register it as a tool from this mode. */
  readonly adapter: UpstreamAdapter;
  /** Exact reviewed request + exact-attempt entitlement check. */
  assertGenerationAllowed(request: GenerationRequest, signal?: AbortSignal): Promise<void>;
  /** Verifies the lock is still owned before a future caller performs local work. */
  assertLeaseHeld(): void;
  close(): void;
}

/**
 * Compose existing auth, schema, adapter and journal ports for one local
 * account. This does not construct ApplicationCore, register MCP mutation
 * tools, issue approvals, or enable paid execution: mode is deliberately
 * OFFLINE_VALIDATION_ONLY until those gates receive a separate explicit design.
 */
export async function createDurableOwnerGenerationRuntime(
  options: DurableOwnerGenerationRuntimeOptions
): Promise<DurableOwnerGenerationRuntime> {
  const profileDirectory = resolve(options.profileDirectory);
  const v2VariantSelections = Object.freeze((options.v2VariantSelections ?? []).map((selection) => Object.freeze({
    model_id: selection.model_id,
    operation_id: selection.operation_id,
    variant_id: selection.variant_id
  })));
  assertOwnerProfileDirectory(profileDirectory);
  const borrowedOwnerProfileLease = options.borrowedOwnerProfileLease;
  if (borrowedOwnerProfileLease !== undefined) {
    assertBorrowedOwnerProfileLease(borrowedOwnerProfileLease, profileDirectory);
  }
  const ownedLease = borrowedOwnerProfileLease === undefined ? acquireOwnerProfileLease(profileDirectory) : null;
  const lease: Pick<DurableOwnerRuntimeLease, "assertHeld"> = ownedLease ?? Object.freeze({
    assertHeld: () => assertBorrowedOwnerProfileLease(borrowedOwnerProfileLease!, profileDirectory)
  });
  let authContext: DurableOwnerAuthContext | undefined;
  let transactionStore: GenerationTransactionStore | undefined;
  try {
    authContext = await options.createAuthContext(profileDirectory);
    if (borrowedOwnerProfileLease !== undefined) {
      assertBorrowedOwnerProfileLease(borrowedOwnerProfileLease, profileDirectory, authContext.store, authContext.binding);
    }
    lease.assertHeld();
    transactionStore = await options.createTransactionStore(profileDirectory);
    const authBinding = Object.freeze({
      tenant_id: authContext.binding.tenant_id,
      subject: authContext.binding.subject
    });

    const parsedRegistry = options.registry == null
      ? null
      : options.registry.schema_version === "2.0.0"
        ? generationContractRegistryV2Schema.parse(options.registry)
        : generationContractRegistrySchema.parse(options.registry);
    const catalogVersion = discoveryCatalogVersion(options.catalog);
    const registryMatches = parsedRegistry !== null &&
      parsedRegistry.catalog_version === catalogVersion &&
      parsedRegistry.source_hashes.ai === options.catalog.source_hashes.ai &&
      parsedRegistry.source_hashes.llm_models === options.catalog.source_hashes.llm_models &&
      parsedRegistry.source_hashes.models === options.catalog.source_hashes.models;
    const executor = !registryMatches || parsedRegistry === null
      ? null
      : parsedRegistry.schema_version === "2.0.0"
        ? new GenerationContractExecutorV2(parsedRegistry, options.catalog)
        : new GenerationContractExecutor(parsedRegistry, options.catalog);
    const contractStatus: DurableOwnerContractStatus = parsedRegistry === null
      ? "REGISTRY_NOT_SUPPLIED"
      : registryMatches
        ? "REGISTRY_VALIDATED"
        : "REGISTRY_CATALOG_MISMATCH";

    // This validates the exact local link before journal recovery or service.
    // It does not poll login and cannot choose a newer/other linked account.
    const offlineFetch: typeof fetch = async (input, init) => {
      lease.assertHeld();
      if (options.offlineFetchImpl === undefined) throw new Error("OFFLINE_NETWORK_DISABLED");
      return options.offlineFetchImpl(input, init);
    };
    const linked = await createLinkedGenerationAdapter({
      transactionStore,
      linkService: authContext.linkService,
      binding: authBinding,
      attemptId: authContext.attemptId,
      resolveAiName: (modelId) => options.catalog.getModel(modelId).ai_name,
      resolveModality: (request) => {
        const model = options.catalog.getModel(request.model_id);
        const operation = model.operations.find((candidate) => candidate.id === request.operation_id);
        if (!operation) throw new Error("GENERATION_OPERATION_NOT_IN_SELECTED_CATALOG");
        return operation.output_modality;
      },
      prepareMediaRequest: (request): PreparedSyntxMediaRequest => {
        if (executor === null) throw new Error(contractStatus === "REGISTRY_NOT_SUPPLIED"
          ? "GENERATION_CONTRACT_NOT_AVAILABLE"
          : "GENERATION_CONTRACT_CATALOG_MISMATCH");
        if (executor instanceof GenerationContractExecutorV2) {
          return projectDurableOwnerV2PreparedRequest(executor.prepare(
            selectDurableOwnerV2Request(request, v2VariantSelections)
          ));
        }
        if (v2VariantSelections.length > 0) {
          throw new Error("DURABLE_OWNER_V2_SELECTOR_REQUIRES_V2_REGISTRY");
        }
        return executor.prepare(request);
      },
      fetchImpl: offlineFetch,
      ...(options.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: options.requestTimeoutMs }),
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.createOperationId === undefined ? {} : { createOperationId: options.createOperationId })
    });

    // The lease is already held before either recovery call. Merely opening a
    // SQLite reader is not treated as proof that another process crashed.
    lease.assertHeld();
    transactionStore.recoverInterruptedOperations();
    transactionStore.recoverInterruptedCancelAttempts();

    const resolveSubscription = async (attemptId: string, signal?: AbortSignal): Promise<SyntxSubscription> => {
        lease.assertHeld();
        if (options.offlineSubscriptionReader === undefined) throw new Error("OFFLINE_SUBSCRIPTION_READ_DISABLED");
        return options.offlineSubscriptionReader(attemptId, signal);
    };
    const preflightV1 = executor instanceof GenerationContractExecutor
      ? createReviewedContractPreflight({ executor, resolveSubscription })
      : null;
    const preflightV2 = executor instanceof GenerationContractExecutorV2
      ? createReviewedContractPreflight({ executor, resolveSubscription })
      : null;
    const assertGenerationAllowed = async (request: GenerationRequest, signal?: AbortSignal): Promise<void> => {
      lease.assertHeld();
      if (executor === null) throw new Error(contractStatus === "REGISTRY_NOT_SUPPLIED"
        ? "GENERATION_CONTRACT_NOT_AVAILABLE"
        : "GENERATION_CONTRACT_CATALOG_MISMATCH");
      if (preflightV2 !== null) {
        const v2Request = selectDurableOwnerV2Request(request, v2VariantSelections);
        await preflightV2(linked.principal.connection_id, v2Request, signal);
      } else if (preflightV1 !== null) {
        if (v2VariantSelections.length > 0) throw new Error("DURABLE_OWNER_V2_SELECTOR_REQUIRES_V2_REGISTRY");
        await preflightV1(linked.principal.connection_id, request, signal);
      } else {
        throw new Error("GENERATION_CONTRACT_NOT_AVAILABLE");
      }
      lease.assertHeld();
    };
    const adapter = assertLeaseForAdapter(linked.adapter, linked.principal, lease, async (request) => {
      await assertGenerationAllowed(request);
    });
    let closed = false;
    return Object.freeze({
      mode: "OFFLINE_VALIDATION_ONLY" as const,
      contract_status: contractStatus,
      principal: linked.principal,
      authStore: authContext.store,
      transactionStore,
      executor,
      adapter,
      assertGenerationAllowed,
      assertLeaseHeld: () => lease.assertHeld(),
      close() {
        if (closed) return;
        closed = true;
        try {
          transactionStore!.close();
        } finally {
          if (ownedLease !== null) {
            try { authContext!.store.close?.(); }
            finally { ownedLease.release(); }
          }
        }
      }
    });
  } catch (error) {
    // Store factories transfer lifecycle ownership to this composition; close
    // any partial result before releasing the profile lock.
    const cleanupErrors: unknown[] = [];
    try { transactionStore?.close(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
    if (ownedLease !== null) {
      try { authContext?.store.close?.(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
      try { ownedLease.release(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError([error, ...cleanupErrors], "Owner generation composition failed and cleanup was incomplete.");
    }
    throw error;
  }
}

function assertLeaseForAdapter(
  adapter: UpstreamAdapter,
  boundPrincipal: Readonly<GenerationPrincipalRef>,
  lease: Pick<DurableOwnerRuntimeLease, "assertHeld">,
  beforeStart: (request: GenerationRequest) => Promise<void>
): UpstreamAdapter {
  return {
    async getBalance(principal: Readonly<GenerationPrincipalRef>): Promise<Balance> {
      lease.assertHeld();
      return adapter.getBalance(principal);
    },
    async estimateGeneration(principal: Readonly<GenerationPrincipalRef>, request: GenerationRequest): Promise<UpstreamGenerationEstimate> {
      lease.assertHeld();
      return adapter.estimateGeneration(principal, request);
    },
    async startGeneration(context, request): Promise<GenerationJob> {
      lease.assertHeld();
      const principal = snapshotGenerationPrincipal(context.principal);
      if (!sameGenerationPrincipal(boundPrincipal, principal)) {
        throw new ApplicationError("INVALID_PARAMETERS", "The generation principal does not match this owner profile.");
      }
      await beforeStart(request);
      lease.assertHeld();
      return adapter.startGeneration({
        principal,
        idempotency_key: context.idempotency_key,
        confirmation_id: context.confirmation_id,
        approved_max_cost_tokens: context.approved_max_cost_tokens
      }, request);
    },
    async reconcileStart(context): Promise<GenerationJob | null> {
      lease.assertHeld();
      return adapter.reconcileStart(context);
    },
    async getJob(context): Promise<GenerationJob> {
      lease.assertHeld();
      return adapter.getJob(context);
    },
    async cancelJob(context): Promise<GenerationJob> {
      lease.assertHeld();
      return adapter.cancelJob(context);
    },
    async reconcileCancel(context): Promise<GenerationJob | null> {
      lease.assertHeld();
      return adapter.reconcileCancel(context);
    },
    async getResult(context): Promise<GenerationResult> {
      lease.assertHeld();
      return adapter.getResult(context);
    }
  };
}

function discoveryCatalogVersion(catalog: DiscoveryCatalogRepository): string {
  return `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
}
