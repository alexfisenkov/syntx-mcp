import { randomBytes } from "node:crypto";
import {
  copyAndFreezeObservedEstimate,
  createObservedRequestBinding,
  OBSERVED_ESTIMATE_REASON,
  OBSERVED_ESTIMATE_STATE,
  observedRequestBindingMatches,
  validateLocalRetentionExpiry,
  validateCreateObservedGenerationEstimateInput,
  validateObservedEstimateId,
  validateObservedEstimatePrincipal,
  type CreateObservedGenerationEstimateInput,
  type ObservedEstimatePrincipalRef,
  type ObservedGenerationEstimate,
  type ObservedGenerationRequestBindingInput
} from "../domain/observed-generation-estimate.js";

const DEFAULT_LOCAL_RETENTION_MS = 15 * 60_000;
const MAXIMUM_LOCAL_RETENTION_MS = 24 * 60 * 60_000;

export type InMemoryGenerationEstimateStoreErrorCode =
  | "STORE_CLOSED"
  | "INVALID_HMAC_SECRET"
  | "INVALID_LOCAL_RETENTION"
  | "ESTIMATE_REPLAY_REJECTED"
  | "ESTIMATE_ID_CONFLICT"
  | "ESTIMATE_NOT_FOUND"
  | "REQUEST_BINDING_MISMATCH"
  | "STORE_CAPACITY_EXCEEDED"
  | "PRINCIPAL_CAPACITY_EXCEEDED"
  | "INVALID_CAPACITY"
  | "INVALID_CODEC_RESOLVER"
  | "INVALID_COMMIT_VALIDATOR";

export class InMemoryGenerationEstimateStoreError extends Error {
  constructor(
    readonly code: InMemoryGenerationEstimateStoreErrorCode,
    message: string
  ) {
    super(message);
    this.name = "InMemoryGenerationEstimateStoreError";
  }
}

export interface InMemoryGenerationEstimateStoreOptions {
  /** Local memory-retention window only; it is not an upstream quote TTL. */
  readonly localRetentionMs?: number;
  readonly now?: () => Date;
  readonly estimateIdGenerator?: () => string;
  /** Bound process-lifetime spent-id retention; restart loses this history. */
  readonly maximumSeenEstimateIds?: number;
  /** Bound process-lifetime quota for one tenant+subject+connection. */
  readonly maximumSeenEstimateIdsPerPrincipal?: number;
  /** Server-owned codec lookup. It must never be populated from tool input. */
  readonly resolveAllowedParameterKeys: (
    binding: Readonly<{
      model_id: string;
      operation_id: string;
      catalog_version: string;
      schema_hash: string;
    }>
  ) => readonly string[];
}

/**
 * Process-local observation store. It deliberately cannot mutate an estimate
 * or turn it into start authorization.
 */
export class InMemoryGenerationEstimateStore {
  readonly #records = new Map<string, ObservedGenerationEstimate>();
  readonly #seenEstimateIds = new Set<string>();
  readonly #seenByPrincipal = new Map<string, number>();
  readonly #hmacSecret: Buffer;
  readonly #localRetentionMs: number;
  readonly #now: () => Date;
  readonly #estimateIdGenerator: () => string;
  readonly #maximumSeenEstimateIds: number;
  readonly #maximumSeenEstimateIdsPerPrincipal: number;
  readonly #resolveAllowedParameterKeys: InMemoryGenerationEstimateStoreOptions["resolveAllowedParameterKeys"];
  #closed = false;

  constructor(
    hmacSecret: Uint8Array,
    options: InMemoryGenerationEstimateStoreOptions
  ) {
    if (!(hmacSecret instanceof Uint8Array) || hmacSecret.byteLength < 32) {
      throw new InMemoryGenerationEstimateStoreError(
        "INVALID_HMAC_SECRET",
        "A request-binding secret of at least 32 bytes is required."
      );
    }
    if (!options || typeof options.resolveAllowedParameterKeys !== "function") {
      throw new InMemoryGenerationEstimateStoreError(
        "INVALID_CODEC_RESOLVER",
        "A server-owned parameter codec resolver is required."
      );
    }
    const localRetentionMs =
      options.localRetentionMs ?? DEFAULT_LOCAL_RETENTION_MS;
    if (
      !Number.isSafeInteger(localRetentionMs) ||
      localRetentionMs < 1_000 ||
      localRetentionMs > MAXIMUM_LOCAL_RETENTION_MS
    ) {
      throw new InMemoryGenerationEstimateStoreError(
        "INVALID_LOCAL_RETENTION",
        "The local estimate-retention policy is invalid."
      );
    }

    this.#hmacSecret = Buffer.from(hmacSecret);
    this.#localRetentionMs = localRetentionMs;
    this.#now = options.now ?? (() => new Date());
    this.#estimateIdGenerator =
      options.estimateIdGenerator ??
      (() => `estimate_obs_${randomBytes(24).toString("base64url")}`);
    this.#resolveAllowedParameterKeys = options.resolveAllowedParameterKeys;
    const maximumSeenEstimateIds = options.maximumSeenEstimateIds ?? 10_000;
    if (
      !Number.isSafeInteger(maximumSeenEstimateIds) ||
      maximumSeenEstimateIds < 1 ||
      maximumSeenEstimateIds > 1_000_000
    ) {
      throw new InMemoryGenerationEstimateStoreError(
        "INVALID_CAPACITY",
        "The process-local estimate-id capacity is invalid."
      );
    }
    this.#maximumSeenEstimateIds = maximumSeenEstimateIds;
    const maximumSeenEstimateIdsPerPrincipal =
      options.maximumSeenEstimateIdsPerPrincipal ??
      Math.min(1_000, maximumSeenEstimateIds);
    if (
      !Number.isSafeInteger(maximumSeenEstimateIdsPerPrincipal) ||
      maximumSeenEstimateIdsPerPrincipal < 1 ||
      maximumSeenEstimateIdsPerPrincipal > maximumSeenEstimateIds
    ) {
      throw new InMemoryGenerationEstimateStoreError(
        "INVALID_CAPACITY",
        "The process-local per-principal estimate-id capacity is invalid."
      );
    }
    this.#maximumSeenEstimateIdsPerPrincipal =
      maximumSeenEstimateIdsPerPrincipal;
  }

  create(
    input: CreateObservedGenerationEstimateInput
  ): ObservedGenerationEstimate {
    let accepted: ObservedGenerationEstimate | undefined;
    this.createValidated(input, (candidate) => {
      accepted = candidate;
    });
    if (accepted === undefined) {
      throw new InMemoryGenerationEstimateStoreError(
        "INVALID_COMMIT_VALIDATOR",
        "The observation commit validator did not accept a candidate."
      );
    }
    return copyAndFreezeObservedEstimate(accepted);
  }

  createValidated(
    input: CreateObservedGenerationEstimateInput,
    validateBeforeCommit: (candidate: ObservedGenerationEstimate) => void
  ): void {
    this.#assertOpen();
    if (typeof validateBeforeCommit !== "function") {
      throw new InMemoryGenerationEstimateStoreError(
        "INVALID_COMMIT_VALIDATOR",
        "A pre-commit observation validator is required."
      );
    }
    const now = requireValidNow(this.#now());
    this.#purgeExpired(now.getTime());

    const estimateId = validateObservedEstimateId(
      this.#estimateIdGenerator()
    );
    const safeInput = validateCreateObservedGenerationEstimateInput(input);
    const bindingInput = safeInput.binding;
    const principal = safeInput.principal;
    const metadata = safeInput.metadata;
    const codecRef = Object.freeze({
      model_id: bindingInput.model_id,
      operation_id: bindingInput.operation_id,
      catalog_version: bindingInput.catalog_version,
      schema_hash: bindingInput.schema_hash
    });
    const allowedParameterKeys = this.#resolveAllowedParameterKeys(codecRef);
    const binding = createObservedRequestBinding(
      {
        model_id: bindingInput.model_id,
        operation_id: bindingInput.operation_id,
        catalog_version: bindingInput.catalog_version,
        schema_hash: bindingInput.schema_hash,
        parameters: bindingInput.parameters
      },
      this.#hmacSecret,
      { allowed_parameter_keys: allowedParameterKeys }
    );

    const existing = this.#records.get(estimateId);
    if (existing) {
      const same =
        samePrincipal(existing.principal, principal) &&
        existing.request_binding === binding.request_binding &&
        existing.cost === metadata.cost &&
        existing.discount_cost === metadata.discount_cost &&
        existing.observed_at === now.toISOString();
      throw new InMemoryGenerationEstimateStoreError(
        same ? "ESTIMATE_REPLAY_REJECTED" : "ESTIMATE_ID_CONFLICT",
        same
          ? "An observation estimate id cannot be replayed."
          : "An observation estimate id is already bound to other evidence."
      );
    }
    if (this.#seenEstimateIds.has(estimateId)) {
      throw new InMemoryGenerationEstimateStoreError(
        "ESTIMATE_ID_CONFLICT",
        "An observation estimate id cannot be reused."
      );
    }
    const principalKey = encodePrincipalKey(principal);
    const principalSeen = this.#seenByPrincipal.get(principalKey) ?? 0;
    if (principalSeen >= this.#maximumSeenEstimateIdsPerPrincipal) {
      throw new InMemoryGenerationEstimateStoreError(
        "PRINCIPAL_CAPACITY_EXCEEDED",
        "The process-local observation capacity for this principal is exhausted."
      );
    }
    if (this.#seenEstimateIds.size >= this.#maximumSeenEstimateIds) {
      throw new InMemoryGenerationEstimateStoreError(
        "STORE_CAPACITY_EXCEEDED",
        "The process-local observation estimate-id capacity is exhausted."
      );
    }

    const localRetentionExpiresAt = validateLocalRetentionExpiry(
      new Date(now.getTime() + this.#localRetentionMs).toISOString()
    );
    const estimate = copyAndFreezeObservedEstimate({
      estimate_id: estimateId,
      principal,
      state: OBSERVED_ESTIMATE_STATE,
      start_eligible: false,
      reason: OBSERVED_ESTIMATE_REASON,
      model_id: bindingInput.model_id,
      operation_id: bindingInput.operation_id,
      catalog_version: bindingInput.catalog_version,
      schema_hash: bindingInput.schema_hash,
      parameter_keys: binding.parameter_keys,
      request_binding: binding.request_binding,
      cost: metadata.cost,
      discount_cost: metadata.discount_cost,
      unit: null,
      expires_at: null,
      observed_at: now.toISOString(),
      local_retention_expires_at: localRetentionExpiresAt
    });
    validateBeforeCommit(copyAndFreezeObservedEstimate(estimate));
    this.#records.set(estimateId, estimate);
    this.#seenEstimateIds.add(estimateId);
    this.#seenByPrincipal.set(principalKey, principalSeen + 1);
  }

  get(
    principal: ObservedEstimatePrincipalRef,
    estimateId: string
  ): ObservedGenerationEstimate | null {
    this.#assertOpen();
    const safePrincipal = validateObservedEstimatePrincipal(principal);
    const safeEstimateId = validateObservedEstimateId(estimateId);
    this.#purgeExpired(requireValidNow(this.#now()).getTime());
    const estimate = this.#records.get(safeEstimateId);
    if (!estimate || !samePrincipal(estimate.principal, safePrincipal)) {
      return null;
    }
    return copyAndFreezeObservedEstimate(estimate);
  }

  assertRequestBinding(
    principal: ObservedEstimatePrincipalRef,
    estimateId: string,
    request: ObservedGenerationRequestBindingInput
  ): ObservedGenerationEstimate {
    this.#assertOpen();
    const safePrincipal = validateObservedEstimatePrincipal(principal);
    const estimate = this.get(safePrincipal, estimateId);
    if (!estimate) {
      throw new InMemoryGenerationEstimateStoreError(
        "ESTIMATE_NOT_FOUND",
        "The observation estimate does not exist for this principal."
      );
    }
    if (
      !observedRequestBindingMatches(
        estimate.request_binding,
        request,
        this.#hmacSecret,
        { allowed_parameter_keys: estimate.parameter_keys }
      )
    ) {
      throw new InMemoryGenerationEstimateStoreError(
        "REQUEST_BINDING_MISMATCH",
        "The generation request differs from the observed estimate binding."
      );
    }
    return copyAndFreezeObservedEstimate(estimate);
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#records.clear();
    this.#seenEstimateIds.clear();
    this.#seenByPrincipal.clear();
    this.#hmacSecret.fill(0);
    this.#closed = true;
  }

  #purgeExpired(nowMs: number): void {
    for (const [estimateId, estimate] of this.#records) {
      if (Date.parse(estimate.local_retention_expires_at) <= nowMs) {
        this.#records.delete(estimateId);
      }
    }
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new InMemoryGenerationEstimateStoreError(
        "STORE_CLOSED",
        "The observation estimate store is closed."
      );
    }
  }
}

function encodePrincipalKey(principal: ObservedEstimatePrincipalRef): string {
  return JSON.stringify([
    principal.tenant_id,
    principal.subject_id,
    principal.connection_id
  ]);
}

function samePrincipal(
  left: ObservedEstimatePrincipalRef,
  right: ObservedEstimatePrincipalRef
): boolean {
  return (
    left.tenant_id === right.tenant_id &&
    left.subject_id === right.subject_id &&
    left.connection_id === right.connection_id
  );
}

function requireValidNow(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new InMemoryGenerationEstimateStoreError(
      "INVALID_LOCAL_RETENTION",
      "The local estimate-retention clock is invalid."
    );
  }
  return value;
}
