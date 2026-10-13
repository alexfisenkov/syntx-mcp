import { join, resolve } from "node:path";
import { isProxy } from "node:util/types";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { PrivateOwnerAuthProfile } from "../auth/private-owner-auth-profile.js";
import type { AuthBinding } from "../auth/types.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationOperationRecord, GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import type { GenerationContractV2, GenerationContractRegistryV2 } from "../domain/generation-contract-v2.js";
import { generationContractRegistryV2Schema } from "../domain/generation-contract-v2.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import type { GenerationJob, GenerationRequest, GenerationResult } from "../domain/types.js";
import { ApplicationError } from "../errors.js";
import type { GenerationTransactionStore } from "../storage/generation-transaction-store.js";
import { SqliteGenerationTransactionStore } from "../storage/sqlite-generation-transaction-store.js";
import { createLinkedGenerationAdapter } from "../adapter/syntx/linked-generation.js";
import {
  assertBorrowedOwnerProfileLease,
  type BorrowedOwnerProfileLease
} from "./private-owner-generation-profile.js";

const MAX_CONTEXTS = 128;
const LINK_ATTEMPT_ID = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SAFE_SELECTION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const SAFE_JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const managerInitializations = new WeakMap<object, ManagerInitialization>();
const defaultStoreFactory = (profileDirectory: string): GenerationTransactionStore =>
  new SqliteGenerationTransactionStore(join(profileDirectory, "generation.sqlite"));

export interface OwnerDurableSessionSelection {
  readonly model_id: string;
  readonly operation_id: string;
  readonly variant_id: string;
}

export interface OwnerDurableSessionContextFactoryInput {
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly selection: Readonly<OwnerDurableSessionSelection> | null;
  readonly contract: GenerationContractV2 | null;
  readonly catalog: DiscoveryCatalogRepository;
  readonly registry: GenerationContractRegistryV2 | null;
  readonly linkService: PerUserLinkService;
  readonly binding: Readonly<AuthBinding>;
  /** A close-blocked facade over the manager-owned singleton store. */
  readonly transactionStore: GenerationTransactionStore;
  /** Borrowed, assertion-only lease; it has no release method. */
  readonly borrowedLease: BorrowedOwnerProfileLease;
  /** Always a deny-network fetch unless an explicit offline test fake is injected. */
  readonly offlineFetchImpl: typeof fetch;
  /** Manager-bound assertion invalidated synchronously when close() starts. */
  readonly assertActive: () => void;
}

export interface OwnerDurableSessionAdapterContext {
  readJob(jobId: string): Promise<GenerationJob>;
  readResult(jobId: string): Promise<GenerationResult>;
  /** Present only when an explicit trusted internal factory supplies the owner start port. */
  startGeneration?(request: GenerationRequest, idempotencyKey: string): Promise<GenerationJob>;
  /** Fake adapters must identify themselves as TEST_FAKE; only reviewed wiring may declare OWNER_LIVE. */
  executionMode?: "OWNER_LIVE" | "TEST_FAKE";
  close?(): void | Promise<void>;
}

export type OwnerDurableSessionContextFactory = (
  input: OwnerDurableSessionContextFactoryInput
) => Promise<OwnerDurableSessionAdapterContext> | OwnerDurableSessionAdapterContext;

export interface OwnerDurableSessionManagerOptions {
  /** Ownership transfers to the manager on the first create call. */
  readonly authProfile: PrivateOwnerAuthProfile;
  readonly linkService: PerUserLinkService;
  readonly catalog: DiscoveryCatalogRepository;
  readonly registry?: GenerationContractRegistryV2 | null;
  readonly createTransactionStore?: (profileDirectory: string) => GenerationTransactionStore | Promise<GenerationTransactionStore>;
  readonly createContext?: OwnerDurableSessionContextFactory;
  /** Test-only fake gateway; absent always denies network. */
  readonly offlineFetchImpl?: typeof fetch;
}

export interface OwnerDurableSessionContext {
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly selection: Readonly<OwnerDurableSessionSelection>;
  readonly mode: "OFFLINE_VALIDATION_ONLY" | "OWNER_LIVE" | "TEST_FAKE";
  readJob(jobId: string): Promise<GenerationJob>;
  readResult(jobId: string): Promise<GenerationResult>;
  startGeneration?(request: GenerationRequest, idempotencyKey: string): Promise<GenerationJob>;
}

export interface OwnerDurableSessionManager {
  getContext(attemptId: string, selection: OwnerDurableSessionSelection): Promise<OwnerDurableSessionContext>;
  readJob(attemptId: string, jobId: string): Promise<GenerationJob>;
  readResult(attemptId: string, jobId: string): Promise<GenerationResult>;
  close(): Promise<void>;
}

export type OwnerDurableSessionManagerErrorCode =
  | "INVALID_SESSION_REQUEST"
  | "OWNER_SESSION_NOT_LINKED"
  | "OWNER_SESSION_SELECTION_UNAVAILABLE"
  | "OWNER_SESSION_CATALOG_MISMATCH"
  | "OWNER_SESSION_CONTEXT_UNAVAILABLE"
  | "OWNER_SESSION_NOT_FOUND"
  | "OWNER_SESSION_CLOSED"
  | "OWNER_SESSION_CAPACITY_REACHED"
  | "OWNER_SESSION_INITIALIZATION_CONFLICT";

export class OwnerDurableSessionManagerError extends Error {
  constructor(readonly code: OwnerDurableSessionManagerErrorCode) {
    super("The private owner session is unavailable.");
    this.name = "OwnerDurableSessionManagerError";
  }
}

interface NormalizedOptions {
  readonly authProfile: PrivateOwnerAuthProfile;
  readonly linkService: PerUserLinkService;
  readonly catalog: DiscoveryCatalogRepository;
  readonly registry: GenerationContractRegistryV2 | null;
  readonly createTransactionStore: (profileDirectory: string) => GenerationTransactionStore | Promise<GenerationTransactionStore>;
  readonly createContext: OwnerDurableSessionContextFactory;
  readonly offlineFetchImpl: typeof fetch;
}

interface ManagerInitialization {
  readonly options: NormalizedOptions;
  readonly promise: Promise<OwnerDurableSessionManager>;
}

/**
 * Owns one private auth-profile lifetime and one generation journal. Per-attempt
 * contexts borrow both and are never allowed to close either shared resource.
 */
export function createOwnerDurableSessionManager(
  input: OwnerDurableSessionManagerOptions
): Promise<OwnerDurableSessionManager> {
  const options = snapshotOptions(input);
  const profileKey = options.authProfile as object;
  const existing = managerInitializations.get(profileKey);
  if (existing) {
    if (!sameInitialization(existing.options, options)) {
      return Promise.reject(new OwnerDurableSessionManagerError("OWNER_SESSION_INITIALIZATION_CONFLICT"));
    }
    return existing.promise;
  }
  const promise = Promise.resolve().then(() => initializeManager(options));
  managerInitializations.set(profileKey, Object.freeze({ options, promise }));
  return promise;
}

async function initializeManager(options: NormalizedOptions): Promise<OwnerDurableSessionManager> {
  const authProfile = options.authProfile;
  const profileDirectory = authProfile.profileDirectory;
  let borrowedLease: BorrowedOwnerProfileLease | undefined;
  let transactionStore: GenerationTransactionStore | undefined;
  try {
    if (typeof profileDirectory !== "string" || resolve(profileDirectory) !== profileDirectory) {
      throw new OwnerDurableSessionManagerError("INVALID_SESSION_REQUEST");
    }
    borrowedLease = authProfile.borrowGenerationLease();
    assertBorrowedOwnerProfileLease(borrowedLease, profileDirectory, authProfile.store, authProfile.binding);
    borrowedLease.assertHeld();
    transactionStore = await options.createTransactionStore(profileDirectory);
    borrowedLease.assertHeld();
    transactionStore.recoverInterruptedOperations();
    transactionStore.recoverInterruptedCancelAttempts();
    borrowedLease.assertHeld();
    const sharedStore = transactionStore;
    return new OwnerDurableSessionManagerImpl(options, borrowedLease, sharedStore);
  } catch {
    const cleanupErrors: unknown[] = [];
    try { transactionStore?.close(); } catch (error) { cleanupErrors.push(error); }
    try { authProfile.close(); } catch (error) { cleanupErrors.push(error); }
    if (cleanupErrors.length > 0) {
      throw new OwnerDurableSessionManagerError("OWNER_SESSION_CONTEXT_UNAVAILABLE");
    }
    throw new OwnerDurableSessionManagerError("OWNER_SESSION_CONTEXT_UNAVAILABLE");
  }
}

class OwnerDurableSessionManagerImpl implements OwnerDurableSessionManager {
  readonly #options: NormalizedOptions;
  readonly #borrowedLease: BorrowedOwnerProfileLease;
  readonly #transactionStore: GenerationTransactionStore;
  readonly #borrowedStore: GenerationTransactionStore;
  readonly #contexts = new Map<string, Promise<OwnerDurableSessionAdapterContext>>();
  #closed = false;
  #childCloseFailed = false;
  #closePromise: Promise<void> | undefined;

  constructor(
    options: NormalizedOptions,
    borrowedLease: BorrowedOwnerProfileLease,
    transactionStore: GenerationTransactionStore
  ) {
    this.#options = options;
    this.#borrowedLease = borrowedLease;
    this.#transactionStore = transactionStore;
    this.#borrowedStore = closeBlockedStore(transactionStore);
  }

  async getContext(attemptId: string, selectionInput: OwnerDurableSessionSelection): Promise<OwnerDurableSessionContext> {
    this.#assertOpen();
    const safeAttemptId = snapshotAttemptId(attemptId);
    const selection = snapshotSelection(selectionInput);
    const principal = await this.#requireLinkedPrincipal(safeAttemptId);
    const contract = this.#resolveLiveSelection(selection);
    const port = await this.#getOrCreateContext(principal, safeAttemptId, selection, contract);
    this.#assertOpen();
    const currentPrincipal = await this.#requireLinkedPrincipal(safeAttemptId);
    if (!sameGenerationPrincipal(principal, currentPrincipal)) {
      throw new OwnerDurableSessionManagerError("OWNER_SESSION_NOT_LINKED");
    }
    const manager = this;
    const publicContext: OwnerDurableSessionContext = {
      attempt_id: safeAttemptId,
      principal,
      selection,
      mode: typeof port.startGeneration === "function" ? port.executionMode! : "OFFLINE_VALIDATION_ONLY",
      readJob(jobId: string) { return manager.readJob(safeAttemptId, jobId); },
      readResult(jobId: string) { return manager.readResult(safeAttemptId, jobId); }
    };
    if (typeof port.startGeneration === "function") {
      Object.assign(publicContext, {
        startGeneration(request: GenerationRequest, idempotencyKey: string) {
          return manager.#startGeneration(safeAttemptId, selection, principal, request, idempotencyKey, port.startGeneration!);
        }
      });
    }
    return Object.freeze(publicContext);
  }

  async readJob(attemptId: string, jobId: string): Promise<GenerationJob> {
    return this.#readPersisted("job", attemptId, jobId) as Promise<GenerationJob>;
  }

  async readResult(attemptId: string, jobId: string): Promise<GenerationResult> {
    return this.#readPersisted("result", attemptId, jobId) as Promise<GenerationResult>;
  }

  async #startGeneration(
    attemptId: string,
    selection: Readonly<OwnerDurableSessionSelection>,
    expectedPrincipal: Readonly<GenerationPrincipalRef>,
    requestInput: GenerationRequest,
    idempotencyKeyInput: string,
    start: NonNullable<OwnerDurableSessionAdapterContext["startGeneration"]>
  ): Promise<GenerationJob> {
    this.#assertOpen();
    this.#borrowedLease.assertHeld();
    const request = snapshotGenerationRequest(requestInput, selection, discoveryCatalogVersion(this.#options.catalog));
    const idempotencyKey = snapshotIdempotencyKey(idempotencyKeyInput);
    const principal = await this.#requireLinkedPrincipal(attemptId);
    this.#assertOpen();
    this.#borrowedLease.assertHeld();
    if (!sameGenerationPrincipal(principal, expectedPrincipal)) {
      throw new OwnerDurableSessionManagerError("OWNER_SESSION_NOT_LINKED");
    }
    this.#resolveLiveSelection(selection);
    this.#assertOpen();
    this.#borrowedLease.assertHeld();
    try { return await start(request, idempotencyKey); }
    catch (error) {
      if (error instanceof OwnerDurableSessionManagerError) throw error;
      if (error instanceof ApplicationError &&
          (error.code === "UPSTREAM_OUTCOME_UNKNOWN" || error.code === "IDEMPOTENCY_CONFLICT")) throw error;
      throw new OwnerDurableSessionManagerError("OWNER_SESSION_CONTEXT_UNAVAILABLE");
    }
  }

  close(): Promise<void> {
    if (this.#closePromise !== undefined) return this.#closePromise;
    this.#closed = true;
    const pending = [...this.#contexts.values()];
    this.#contexts.clear();
    this.#closePromise = this.#closeResources(pending);
    return this.#closePromise;
  }

  async #readPersisted(kind: "job" | "result", attemptInput: string, jobInput: string): Promise<GenerationJob | GenerationResult> {
    this.#assertOpen();
    const attemptId = snapshotAttemptId(attemptInput);
    const jobId = snapshotJobId(jobInput);
    const principal = await this.#requireLinkedPrincipal(attemptId);
    const record = this.#getOwnedRecord(principal, attemptId, jobId);
    const context = await this.#getOrCreateContext(principal, attemptId, null, null);
    this.#assertOpen();
    this.#borrowedLease.assertHeld();
    const currentPrincipal = await this.#requireLinkedPrincipal(attemptId);
    const currentRecord = this.#getOwnedRecord(currentPrincipal, attemptId, jobId);
    if (record.id !== currentRecord.id || record.revision !== currentRecord.revision) {
      throw new OwnerDurableSessionManagerError("OWNER_SESSION_NOT_FOUND");
    }
    try {
      return kind === "job" ? await context.readJob(jobId) : await context.readResult(jobId);
    } catch {
      throw new OwnerDurableSessionManagerError("OWNER_SESSION_CONTEXT_UNAVAILABLE");
    }
  }

  #getOwnedRecord(principal: Readonly<GenerationPrincipalRef>, attemptId: string, jobId: string): GenerationOperationRecord {
    this.#borrowedLease.assertHeld();
    let record: GenerationOperationRecord | null;
    try {
      record = this.#transactionStore.getById({ tenant_id: principal.tenant_id, subject_id: principal.subject_id }, jobId);
    } catch {
      throw new OwnerDurableSessionManagerError("OWNER_SESSION_NOT_FOUND");
    }
    if (record === null || !sameGenerationPrincipal(record.principal, principal) ||
        record.principal.connection_id !== attemptId) {
      throw new OwnerDurableSessionManagerError("OWNER_SESSION_NOT_FOUND");
    }
    return record;
  }

  async #requireLinkedPrincipal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    this.#assertOpen();
    this.#borrowedLease.assertHeld();
    try {
      const principal = await resolveOwnerReferencePrincipal({
        binding: this.#options.authProfile.binding,
        attemptId,
        linkService: this.#options.linkService
      });
      this.#borrowedLease.assertHeld();
      const stored = await this.#options.authProfile.store.getSnapshot(this.#options.authProfile.binding, attemptId);
      if (stored.attempt_id !== attemptId || stored.status !== "LINKED" || !stored.linked) {
        throw new OwnerDurableSessionManagerError("OWNER_SESSION_NOT_LINKED");
      }
      this.#borrowedLease.assertHeld();
      return principal;
    } catch {
      throw new OwnerDurableSessionManagerError("OWNER_SESSION_NOT_LINKED");
    }
  }

  #resolveLiveSelection(selection: Readonly<OwnerDurableSessionSelection>): GenerationContractV2 {
    const registry = this.#options.registry;
    if (registry === null) throw new OwnerDurableSessionManagerError("OWNER_SESSION_SELECTION_UNAVAILABLE");
    const model = this.#options.catalog.getModel(selection.model_id);
    const catalogVersion = `${this.#options.catalog.fetched_at}.${this.#options.catalog.source_hashes.models.slice(7, 19)}`;
    if (!model.active || registry.catalog_version !== catalogVersion ||
        registry.source_hashes.ai !== this.#options.catalog.source_hashes.ai ||
        registry.source_hashes.llm_models !== this.#options.catalog.source_hashes.llm_models ||
        registry.source_hashes.models !== this.#options.catalog.source_hashes.models) {
      throw new OwnerDurableSessionManagerError("OWNER_SESSION_CATALOG_MISMATCH");
    }
    const contract = registry.contracts.find((candidate) => candidate.model_id === selection.model_id &&
      candidate.operation_id === selection.operation_id && candidate.variant_id === selection.variant_id);
    const operation = model.operations.find((item) => item.id === selection.operation_id);
    if (!contract || contract.status !== "live_verified" || !operation || operation.output_modality !== contract.modality ||
        contract.model_type !== model.upstream_id || contract.ai_name !== model.ai_name) {
      throw new OwnerDurableSessionManagerError("OWNER_SESSION_SELECTION_UNAVAILABLE");
    }
    return contract;
  }

  async #getOrCreateContext(
    principal: Readonly<GenerationPrincipalRef>,
    attemptId: string,
    selection: Readonly<OwnerDurableSessionSelection> | null,
    contract: GenerationContractV2 | null
  ): Promise<OwnerDurableSessionAdapterContext> {
    this.#assertOpen();
    const key = contextKey(principal, selection);
    const existing = this.#contexts.get(key);
    if (existing) return existing;
    if (this.#contexts.size >= MAX_CONTEXTS) throw new OwnerDurableSessionManagerError("OWNER_SESSION_CAPACITY_REACHED");
    const epoch = this.#closePromise;
    const pending = Promise.resolve().then(() => this.#options.createContext({
      attempt_id: attemptId,
      principal,
      selection,
      contract,
      catalog: this.#options.catalog,
      registry: this.#options.registry,
      linkService: this.#options.linkService,
      binding: this.#options.authProfile.binding,
      transactionStore: this.#borrowedStore,
      borrowedLease: this.#borrowedLease,
      offlineFetchImpl: this.#options.offlineFetchImpl,
      assertActive: () => {
        this.#assertOpen();
        this.#borrowedLease.assertHeld();
      }
    })).then(async (context) => {
      assertContextPort(context);
      if (this.#closed || this.#closePromise !== epoch) {
        try { await closeContext(context); }
        catch { this.#childCloseFailed = true; }
        throw new OwnerDurableSessionManagerError("OWNER_SESSION_CLOSED");
      }
      return context;
    }).catch((error) => {
      if (this.#contexts.get(key) === pending) this.#contexts.delete(key);
      if (error instanceof OwnerDurableSessionManagerError) throw error;
      throw new OwnerDurableSessionManagerError("OWNER_SESSION_CONTEXT_UNAVAILABLE");
    });
    this.#contexts.set(key, pending);
    return pending;
  }

  async #closeResources(pendingContexts: readonly Promise<OwnerDurableSessionAdapterContext>[]): Promise<void> {
    const cleanupErrors: unknown[] = [];
    const results = await Promise.allSettled(pendingContexts);
    if (this.#childCloseFailed) cleanupErrors.push(true);
    const contexts = new Set<OwnerDurableSessionAdapterContext>();
    for (const result of results) if (result.status === "fulfilled") contexts.add(result.value);
    for (const context of contexts) {
      try { await closeContext(context); } catch (error) { cleanupErrors.push(error); }
    }
    try { this.#transactionStore.close(); } catch (error) { cleanupErrors.push(error); }
    try { this.#options.authProfile.close(); } catch (error) { cleanupErrors.push(error); }
    if (cleanupErrors.length > 0) throw new OwnerDurableSessionManagerError("OWNER_SESSION_CONTEXT_UNAVAILABLE");
  }

  #assertOpen(): void {
    if (this.#closed) throw new OwnerDurableSessionManagerError("OWNER_SESSION_CLOSED");
  }
}

async function defaultContextFactory(input: OwnerDurableSessionContextFactoryInput): Promise<OwnerDurableSessionAdapterContext> {
  input.borrowedLease.assertHeld();
  const linked = await createLinkedGenerationAdapter({
    transactionStore: input.transactionStore,
    linkService: input.linkService,
    binding: input.binding,
    attemptId: input.attempt_id,
    resolveAiName: () => { throw new Error("OWNER_SESSION_MUTATION_UNAVAILABLE"); },
    resolveModality: () => { throw new Error("OWNER_SESSION_MUTATION_UNAVAILABLE"); },
    prepareMediaRequest: () => { throw new Error("OWNER_SESSION_MUTATION_UNAVAILABLE"); },
    fetchImpl: input.offlineFetchImpl
  });
  input.borrowedLease.assertHeld();
  if (!sameGenerationPrincipal(linked.principal, input.principal)) {
    throw new Error("OWNER_SESSION_PRINCIPAL_MISMATCH");
  }
  return Object.freeze({
    async readJob(jobId: string) {
      input.borrowedLease.assertHeld();
      return linked.adapter.getJob({ principal: linked.principal, job_id: jobId });
    },
    async readResult(jobId: string) {
      input.borrowedLease.assertHeld();
      return linked.adapter.getResult({ principal: linked.principal, job_id: jobId });
    }
  });
}

function snapshotOptions(input: OwnerDurableSessionManagerOptions): NormalizedOptions {
  const fields = readPlainDataRecord(input, [
    "authProfile", "linkService", "catalog", "registry", "createTransactionStore", "createContext", "offlineFetchImpl"
  ]);
  const authProfile = fields.authProfile as PrivateOwnerAuthProfile;
  const linkService = fields.linkService as PerUserLinkService;
  const catalog = fields.catalog as DiscoveryCatalogRepository;
  if (!authProfile || typeof authProfile !== "object" || !linkService || typeof linkService !== "object" ||
      !catalog || typeof catalog !== "object") {
    throw new OwnerDurableSessionManagerError("INVALID_SESSION_REQUEST");
  }
  let registry: GenerationContractRegistryV2 | null = null;
  if (fields.registry !== undefined && fields.registry !== null) {
    try { registry = generationContractRegistryV2Schema.parse(fields.registry); }
    catch { throw new OwnerDurableSessionManagerError("INVALID_SESSION_REQUEST"); }
  }
  const customStoreFactory = fields.createTransactionStore;
  const customContextFactory = fields.createContext;
  const offlineFetchImpl = fields.offlineFetchImpl;
  if ((customStoreFactory !== undefined && typeof customStoreFactory !== "function") ||
      (customContextFactory !== undefined && typeof customContextFactory !== "function") ||
      (offlineFetchImpl !== undefined && typeof offlineFetchImpl !== "function")) {
    throw new OwnerDurableSessionManagerError("INVALID_SESSION_REQUEST");
  }
  return Object.freeze({
    authProfile,
    linkService,
    catalog,
    registry,
    createTransactionStore: (customStoreFactory as NormalizedOptions["createTransactionStore"] | undefined) ?? defaultStoreFactory,
    createContext: (customContextFactory as OwnerDurableSessionContextFactory | undefined) ?? defaultContextFactory,
    offlineFetchImpl: (offlineFetchImpl as typeof fetch | undefined) ?? denyNetworkFetch
  });
}

function sameInitialization(left: NormalizedOptions, right: NormalizedOptions): boolean {
  return left.authProfile === right.authProfile && left.linkService === right.linkService &&
    left.catalog === right.catalog && JSON.stringify(left.registry) === JSON.stringify(right.registry) &&
    left.createTransactionStore === right.createTransactionStore && left.createContext === right.createContext &&
    left.offlineFetchImpl === right.offlineFetchImpl;
}

function snapshotIdempotencyKey(value: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value)) {
    throw new OwnerDurableSessionManagerError("INVALID_SESSION_REQUEST");
  }
  return value;
}

function discoveryCatalogVersion(catalog: DiscoveryCatalogRepository): string {
  return `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
}

function snapshotGenerationRequest(
  input: GenerationRequest,
  selection: Readonly<OwnerDurableSessionSelection>,
  catalogVersion: string
): GenerationRequest {
  const fields = readPlainDataRecord(input, ["model_id", "operation_id", "parameters", "catalog_version"]);
  if (fields.model_id !== selection.model_id || fields.operation_id !== selection.operation_id ||
      fields.catalog_version !== catalogVersion) {
    throw new OwnerDurableSessionManagerError("OWNER_SESSION_SELECTION_UNAVAILABLE");
  }
  const parameters = snapshotJsonObject(fields.parameters, 0);
  return Object.freeze({ model_id: selection.model_id, operation_id: selection.operation_id, catalog_version: catalogVersion, parameters });
}

function snapshotJsonObject(value: unknown, depth: number): Record<string, unknown> {
  if (depth > 8 || value === null || typeof value !== "object" || Array.isArray(value) || isProxy(value)) {
    throw new OwnerDurableSessionManagerError("INVALID_SESSION_REQUEST");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new OwnerDurableSessionManagerError("INVALID_SESSION_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length > 64 || keys.some((key) => typeof key !== "string" || !("value" in descriptors[key]!))) {
    throw new OwnerDurableSessionManagerError("INVALID_SESSION_REQUEST");
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = snapshotJsonValue(descriptors[key]!.value, depth + 1);
  return Object.freeze(result);
}

function snapshotJsonValue(value: unknown, depth: number): unknown {
  if (depth > 8) throw new OwnerDurableSessionManagerError("INVALID_SESSION_REQUEST");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || isProxy(value)) throw new OwnerDurableSessionManagerError("INVALID_SESSION_REQUEST");
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new OwnerDurableSessionManagerError("INVALID_SESSION_REQUEST");
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
    const length = descriptors.length?.value;
    const keys = Reflect.ownKeys(descriptors);
    if (!Number.isSafeInteger(length) || (length as number) > 256 || keys.length !== (length as number) + 1 ||
        keys.some((key) => typeof key !== "string" || (key !== "length" &&
          (!/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= (length as number))) ||
          !("value" in descriptors[key]!)) ||
        Array.from({ length: length as number }, (_, index) => Object.hasOwn(descriptors, String(index))).some((present) => !present)) {
      throw new OwnerDurableSessionManagerError("INVALID_SESSION_REQUEST");
    }
    return Object.freeze(Array.from({ length: length as number }, (_, index) =>
      snapshotJsonValue(descriptors[String(index)]!.value, depth + 1)));
  }
  return snapshotJsonObject(value, depth);
}

function snapshotAttemptId(value: string): string {
  if (typeof value !== "string" || !LINK_ATTEMPT_ID.test(value)) {
    throw new OwnerDurableSessionManagerError("INVALID_SESSION_REQUEST");
  }
  return value;
}

function snapshotSelection(input: OwnerDurableSessionSelection): Readonly<OwnerDurableSessionSelection> {
  const fields = readPlainDataRecord(input, ["model_id", "operation_id", "variant_id"]);
  if (typeof fields.model_id !== "string" || !SAFE_SELECTION_ID.test(fields.model_id) ||
      typeof fields.operation_id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(fields.operation_id) ||
      typeof fields.variant_id !== "string" || !SAFE_SELECTION_ID.test(fields.variant_id)) {
    throw new OwnerDurableSessionManagerError("INVALID_SESSION_REQUEST");
  }
  return Object.freeze({ model_id: fields.model_id, operation_id: fields.operation_id, variant_id: fields.variant_id });
}

function snapshotJobId(value: string): string {
  if (typeof value !== "string" || !SAFE_JOB_ID.test(value)) {
    throw new OwnerDurableSessionManagerError("OWNER_SESSION_NOT_FOUND");
  }
  return value;
}

function contextKey(principal: Readonly<GenerationPrincipalRef>, selection: Readonly<OwnerDurableSessionSelection> | null): string {
  return JSON.stringify([principal.tenant_id, principal.subject_id, principal.connection_id,
    selection?.model_id ?? null, selection?.operation_id ?? null, selection?.variant_id ?? null]);
}

function denyNetworkFetch(): Promise<Response> {
  return Promise.reject(new Error("OFFLINE_NETWORK_DISABLED"));
}

function closeContext(context: OwnerDurableSessionAdapterContext): void | Promise<void> {
  return context.close?.();
}

function assertContextPort(value: unknown): asserts value is OwnerDurableSessionAdapterContext {
  if (value === null || typeof value !== "object" || typeof (value as OwnerDurableSessionAdapterContext).readJob !== "function" ||
      typeof (value as OwnerDurableSessionAdapterContext).readResult !== "function" ||
      (typeof (value as OwnerDurableSessionAdapterContext).startGeneration === "function" &&
        (value as OwnerDurableSessionAdapterContext).executionMode !== "OWNER_LIVE" &&
        (value as OwnerDurableSessionAdapterContext).executionMode !== "TEST_FAKE") ||
      (typeof (value as OwnerDurableSessionAdapterContext).startGeneration !== "function" &&
        (value as OwnerDurableSessionAdapterContext).executionMode === "OWNER_LIVE")) {
    throw new OwnerDurableSessionManagerError("OWNER_SESSION_CONTEXT_UNAVAILABLE");
  }
}

function readPlainDataRecord(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || isProxy(value)) {
    throw new OwnerDurableSessionManagerError("INVALID_SESSION_REQUEST");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new OwnerDurableSessionManagerError("INVALID_SESSION_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length > allowedKeys.length || keys.some((key) =>
    typeof key !== "string" || !allowedKeys.includes(key) || !("value" in descriptors[key]!))) {
    throw new OwnerDurableSessionManagerError("INVALID_SESSION_REQUEST");
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function closeBlockedStore(store: GenerationTransactionStore): GenerationTransactionStore {
  return new Proxy(store, {
    get(target, property) {
      if (property === "close") return () => { throw new Error("OWNER_SESSION_SHARED_STORE_CLOSE_FORBIDDEN"); };
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}
