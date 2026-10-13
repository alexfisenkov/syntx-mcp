import { randomUUID } from "node:crypto";
import { isProxy } from "node:util/types";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import {
  OwnerSoulStyleCatalogHttpClient,
  OwnerSoulStyleCatalogHttpError,
  type OwnerSoulStyleCatalogRecord,
  type OwnerSoulStyleCatalogSnapshot,
  type OwnerSoulStyleCatalogValidationSummary
} from "../adapter/syntx/owner-soul-style-catalog-http-client.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";

const MODEL_ID = "higgsfield-soul" as const;
const SOURCE_MAPPING_SHA256 = "sha256:a11bcb0b533f7f3f9f1668e5bab290ef5d0ba85410df5b78f18e361db96b9391";
const STYLE_TTL_MS = 5 * 60_000;
const MAX_STYLES_PER_ATTEMPT = 128;
const MAX_GLOBAL_STYLES = 512;
const MAX_PENDING_OPERATIONS = 4;
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const STYLE_HANDLE_PATTERN = /^soul_style_[0-9a-f-]{36}$/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

export type OwnerSoulStyleOptionsServiceErrorCode =
  | "INVALID_REQUEST"
  | "PRINCIPAL_NOT_LINKED"
  | "MODEL_BINDING_MISMATCH"
  | "SERVICE_BUSY"
  | "SERVICE_CLOSED"
  | "SNAPSHOT_SUPERSEDED"
  | "CAPACITY_EXCEEDED"
  | "SOURCE_SNAPSHOT_INVALID"
  | "OPTION_HANDLE_NOT_FOUND"
  | "OPTION_HANDLE_EXPIRED"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_REQUEST_ABORTED"
  | "UPSTREAM_PROTOCOL_ERROR";

export class OwnerSoulStyleOptionsServiceError extends Error {
  constructor(readonly code: OwnerSoulStyleOptionsServiceErrorCode) {
    super("The owner Soul style options are unavailable.");
    this.name = "OwnerSoulStyleOptionsServiceError";
  }
}

export interface ListOwnerSoulStyleOptionsInput {
  readonly attemptId: string;
  readonly signal?: AbortSignal;
}

export interface OwnerSoulStyleOptionChoice {
  readonly style_handle: string;
  readonly label: string;
}

export interface OwnerSoulStyleOptionsResult {
  readonly status: "OPTIONS_ISSUED";
  readonly model_id: typeof MODEL_ID;
  readonly catalog_version: typeof DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
  readonly confidence_scope: "owner_authenticated_source_reviewed_style_options";
  readonly source_reviewed: true;
  readonly source_mapping_sha256: typeof SOURCE_MAPPING_SHA256;
  readonly generation_allowed: false;
  readonly expires_in_seconds: 300;
  readonly options: readonly OwnerSoulStyleOptionChoice[];
  readonly summary: OwnerSoulStyleCatalogValidationSummary;
}

export interface ResolveOwnerSoulStyleHandleInput {
  readonly attemptId: string;
  readonly styleHandle: string;
  readonly signal?: AbortSignal;
}

/** Internal capability result. Do not return this object from an MCP handler. */
export interface ResolvedOwnerSoulStyleHandle {
  readonly style_id: string;
  readonly name: string;
  readonly model_id: typeof MODEL_ID;
  readonly catalog_version: typeof DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
  readonly source_mapping_sha256: typeof SOURCE_MAPPING_SHA256;
}

/** Private, non-authorizing result of checking that a cached handle still appears in one fresh source snapshot. */
export interface RevalidatedOwnerSoulStyleHandle extends ResolvedOwnerSoulStyleHandle {
  readonly style_handle: string;
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly fresh_source_snapshot: true;
  readonly verified_at_ms: number;
}

export interface OwnerSoulStyleRevalidationContext {
  readonly attemptId: string;
  readonly styleHandle: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly catalog_version: typeof DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
  readonly source_mapping_sha256: typeof SOURCE_MAPPING_SHA256;
}

export interface OwnerSoulStylePrivateRevalidationProvenance {
  readonly original_expires_at_ms: number;
  readonly catalog_version: typeof DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
  readonly source_mapping_sha256: typeof SOURCE_MAPPING_SHA256;
}

interface RevalidationState {
  readonly owner: OwnerSoulStyleOptionsService;
  readonly record: InternalStyleHandleRecord;
  readonly attemptEpoch: object;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly originalExpiresAt: number;
  readonly catalogVersion: typeof DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
  readonly sourceMappingSha256: typeof SOURCE_MAPPING_SHA256;
  lastObservedNow: number;
  invalidated: boolean;
  isLocallyCurrent: () => boolean;
}

const revalidatedStyleHandles = new WeakMap<object, RevalidationState>();
const styleServiceInstances = new WeakSet<object>();

/** Runtime brand for internal service composition; this is not a generation permit. */
export function isRevalidatedOwnerSoulStyleHandle(value: unknown): value is RevalidatedOwnerSoulStyleHandle {
  if (!value || typeof value !== "object" || isProxy(value)) return false;
  const state = revalidatedStyleHandles.get(value);
  return state !== undefined && state.isLocallyCurrent();
}

export interface OwnerSoulStyleOptionsServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: Pick<DiscoveryCatalogRepository, "getModel">;
  readonly catalogVersion: string;
  readonly resolveClient: (attemptId: string) => Pick<OwnerSoulStyleCatalogHttpClient, "listStyles">;
  readonly now?: () => number;
}

interface InternalStyleHandleRecord {
  readonly handle: string;
  readonly attemptId: string;
  readonly attemptEpoch: object;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly styleId: string;
  readonly name: string;
  readonly expiresAt: number;
  revalidated: object | null;
}

interface PendingOperation {
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly removeParentAbort: () => void;
}

export class OwnerSoulStyleOptionsService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: Pick<DiscoveryCatalogRepository, "getModel">;
  readonly #resolveClient: OwnerSoulStyleOptionsServiceOptions["resolveClient"];
  readonly #now: () => number;
  readonly #handles = new Map<string, InternalStyleHandleRecord>();
  readonly #handlesByAttempt = new Map<string, Set<string>>();
  readonly #attemptEpochs = new Map<string, object>();
  readonly #pendingByAttempt = new Map<string, Set<AbortController>>();
  readonly #listTokens = new Map<string, object>();
  readonly #operations = new Set<Promise<void>>();
  #pendingCount = 0;
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(options: OwnerSoulStyleOptionsServiceOptions) {
    if (options.catalogVersion !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION) {
      throw new OwnerSoulStyleOptionsServiceError("MODEL_BINDING_MISMATCH");
    }
    this.#assertSoulCatalog(options.catalog);
    this.#binding = snapshotBinding(options.binding);
    this.#linkService = options.linkService;
    this.#catalog = options.catalog;
    this.#resolveClient = options.resolveClient;
    this.#now = options.now ?? Date.now;
    styleServiceInstances.add(this);
  }

  async listOptions(input: ListOwnerSoulStyleOptionsInput): Promise<OwnerSoulStyleOptionsResult> {
    const snapshot = snapshotListInput(input);
    if (this.#closed) throw new OwnerSoulStyleOptionsServiceError("SERVICE_CLOSED");
    this.#assertSoulCatalog(this.#catalog);
    const operation = this.#beginOperation(snapshot.attemptId, snapshot.signal);
    const token = Object.freeze({});
    this.#listTokens.set(snapshot.attemptId, token);
    try {
      const principal = await this.#resolvePrincipal(snapshot.attemptId);
      this.#throwIfClosedOrAborted(operation.controller);
      const raw = await this.#resolveClient(snapshot.attemptId).listStyles(operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      const normalized = normalizeStyleSnapshot(raw);
      const current = await this.#resolvePrincipal(snapshot.attemptId);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!sameGenerationPrincipal(principal, current)) {
        this.#removeAttemptHandles(snapshot.attemptId);
        throw new OwnerSoulStyleOptionsServiceError("PRINCIPAL_NOT_LINKED");
      }
      if (this.#listTokens.get(snapshot.attemptId) !== token) {
        throw new OwnerSoulStyleOptionsServiceError("SNAPSHOT_SUPERSEDED");
      }

      const now = this.#safeNow();
      this.#pruneExpired(now);
      const previous = this.#handlesByAttempt.get(snapshot.attemptId);
      const previousCount = previous?.size ?? 0;
      if (this.#handles.size - previousCount + normalized.records.length > MAX_GLOBAL_STYLES) {
        throw new OwnerSoulStyleOptionsServiceError("CAPACITY_EXCEEDED");
      }

      const expiresAt = now + STYLE_TTL_MS;
      if (!Number.isSafeInteger(expiresAt)) throw new OwnerSoulStyleOptionsServiceError("INVALID_REQUEST");
      const attemptEpoch = Object.freeze({});
      const staged: InternalStyleHandleRecord[] = normalized.records.map((record) => ({
        handle: `soul_style_${randomUUID()}`,
        attemptId: snapshot.attemptId,
        attemptEpoch,
        principal,
        styleId: record.style_id,
        name: record.name,
        expiresAt,
        revalidated: null
      }));
      const stagedHandles = new Set(staged.map(({ handle }) => handle));
      if (stagedHandles.size !== staged.length || staged.some(({ handle }) => this.#handles.has(handle))) {
        throw new OwnerSoulStyleOptionsServiceError("UPSTREAM_UNAVAILABLE");
      }

      // Commit the complete new snapshot synchronously; no partial handle set is observable.
      this.#removeAttemptHandles(snapshot.attemptId);
      this.#attemptEpochs.set(snapshot.attemptId, attemptEpoch);
      const attemptHandles = new Set<string>();
      for (const record of staged) {
        this.#handles.set(record.handle, record);
        attemptHandles.add(record.handle);
      }
      this.#handlesByAttempt.set(snapshot.attemptId, attemptHandles);
      return Object.freeze({
        status: "OPTIONS_ISSUED",
        model_id: MODEL_ID,
        catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
        confidence_scope: "owner_authenticated_source_reviewed_style_options",
        source_reviewed: true,
        source_mapping_sha256: SOURCE_MAPPING_SHA256,
        generation_allowed: false,
        expires_in_seconds: STYLE_TTL_MS / 1_000 as 300,
        options: Object.freeze(staged.map((record) => Object.freeze({ style_handle: record.handle, label: record.name }))),
        summary: normalized.summary
      });
    } catch (error) {
      throw mapServiceError(error, operation.controller.signal);
    } finally {
      if (this.#listTokens.get(snapshot.attemptId) === token) this.#listTokens.delete(snapshot.attemptId);
      this.#finishOperation(snapshot.attemptId, operation);
    }
  }

  /** Internal cache lookup only: it does not re-fetch the list or authorize generation. */
  async resolveStyleHandle(input: ResolveOwnerSoulStyleHandleInput): Promise<ResolvedOwnerSoulStyleHandle> {
    const snapshot = snapshotResolveInput(input);
    if (this.#closed) throw new OwnerSoulStyleOptionsServiceError("SERVICE_CLOSED");
    const operation = this.#beginOperation(snapshot.attemptId, snapshot.signal);
    try {
      const principal = await this.#resolvePrincipal(snapshot.attemptId);
      this.#throwIfClosedOrAborted(operation.controller);
      const now = this.#safeNow();
      const record = this.#handles.get(snapshot.styleHandle);
      if (!record) throw new OwnerSoulStyleOptionsServiceError("OPTION_HANDLE_NOT_FOUND");
      if (record.expiresAt <= now) {
        this.#removeHandle(record.handle);
        throw new OwnerSoulStyleOptionsServiceError("OPTION_HANDLE_EXPIRED");
      }
      if (record.attemptId !== snapshot.attemptId || !sameGenerationPrincipal(record.principal, principal)) {
        throw new OwnerSoulStyleOptionsServiceError("OPTION_HANDLE_NOT_FOUND");
      }
      const current = await this.#resolvePrincipal(snapshot.attemptId);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!sameGenerationPrincipal(principal, current)) {
        this.#removeAttemptHandles(snapshot.attemptId);
        throw new OwnerSoulStyleOptionsServiceError("PRINCIPAL_NOT_LINKED");
      }
      return Object.freeze({
        style_id: record.styleId,
        name: record.name,
        model_id: MODEL_ID,
        catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
        source_mapping_sha256: SOURCE_MAPPING_SHA256
      });
    } catch (error) {
      throw mapServiceError(error, operation.controller.signal);
    } finally {
      this.#finishOperation(snapshot.attemptId, operation);
    }
  }

  /**
   * Re-check a cached opaque handle against one fresh fixed style-list GET.
   * Unlike listOptions(), this does not issue or replace handles. The branded
   * result is private provenance only; it does not authorize generation.
   */
  async revalidateStyleHandle(input: ResolveOwnerSoulStyleHandleInput): Promise<RevalidatedOwnerSoulStyleHandle> {
    const snapshot = snapshotResolveInput(input);
    if (this.#closed) throw new OwnerSoulStyleOptionsServiceError("SERVICE_CLOSED");
    this.#assertSoulCatalog(this.#catalog);
    const operation = this.#beginOperation(snapshot.attemptId, snapshot.signal);
    try {
      const listTokenAtStart = this.#listTokens.get(snapshot.attemptId);
      if (listTokenAtStart !== undefined) throw new OwnerSoulStyleOptionsServiceError("SNAPSHOT_SUPERSEDED");

      const principal = await this.#resolvePrincipal(snapshot.attemptId);
      this.#throwIfClosedOrAborted(operation.controller);
      const now = this.#safeNow();
      const record = this.#handles.get(snapshot.styleHandle);
      if (!record) throw new OwnerSoulStyleOptionsServiceError("OPTION_HANDLE_NOT_FOUND");
      if (record.expiresAt <= now) {
        this.#removeHandle(record.handle);
        throw new OwnerSoulStyleOptionsServiceError("OPTION_HANDLE_EXPIRED");
      }
      if (record.attemptId !== snapshot.attemptId || !sameGenerationPrincipal(record.principal, principal)) {
        throw new OwnerSoulStyleOptionsServiceError("OPTION_HANDLE_NOT_FOUND");
      }

      const raw = await this.#resolveClient(snapshot.attemptId).listStyles(operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      const fresh = normalizeStyleSnapshot(raw);
      const current = await this.#resolvePrincipal(snapshot.attemptId);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!sameGenerationPrincipal(principal, current)) {
        this.#removeAttemptHandles(snapshot.attemptId);
        throw new OwnerSoulStyleOptionsServiceError("PRINCIPAL_NOT_LINKED");
      }
      if (this.#listTokens.get(snapshot.attemptId) !== listTokenAtStart ||
          this.#handles.get(snapshot.styleHandle) !== record) {
        throw new OwnerSoulStyleOptionsServiceError("SNAPSHOT_SUPERSEDED");
      }

      const verifiedAt = this.#safeNow();
      if (record.expiresAt <= verifiedAt) {
        this.#removeHandle(record.handle);
        throw new OwnerSoulStyleOptionsServiceError("OPTION_HANDLE_EXPIRED");
      }
      if (!fresh.records.some(({ style_id }) => style_id === record.styleId)) {
        throw new OwnerSoulStyleOptionsServiceError("OPTION_HANDLE_NOT_FOUND");
      }

      const result: RevalidatedOwnerSoulStyleHandle = Object.freeze({
        style_handle: record.handle,
        attempt_id: record.attemptId,
        principal: Object.freeze({ ...principal }),
        style_id: record.styleId,
        name: record.name,
        model_id: MODEL_ID,
        catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
        source_mapping_sha256: SOURCE_MAPPING_SHA256,
        fresh_source_snapshot: true,
        verified_at_ms: verifiedAt
      });
      if (record.revalidated !== null) {
        const previous = revalidatedStyleHandles.get(record.revalidated);
        if (previous) previous.invalidated = true;
      }
      const state: RevalidationState = {
        owner: this,
        record,
        attemptEpoch: record.attemptEpoch,
        principal: Object.freeze({ ...principal }),
        originalExpiresAt: record.expiresAt,
        catalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
        sourceMappingSha256: SOURCE_MAPPING_SHA256,
        lastObservedNow: verifiedAt,
        invalidated: false,
        isLocallyCurrent: () => false
      };
      state.isLocallyCurrent = () => this.#isLocallyCurrentRevalidation(result, state);
      record.revalidated = result;
      revalidatedStyleHandles.set(result, state);
      return result;
    } catch (error) {
      throw mapServiceError(error, operation.controller.signal);
    } finally {
      this.#finishOperation(snapshot.attemptId, operation);
    }
  }

  /** Checks an internal revalidated handle against this exact issuer and its current attempt context. */
  isRevalidatedStyleForContext(value: unknown, contextInput: OwnerSoulStyleRevalidationContext | unknown): boolean {
    let context: OwnerSoulStyleRevalidationContext;
    try { context = snapshotStyleRevalidationContext(contextInput); } catch { return false; }
    if (!styleServiceInstances.has(this) || isProxy(this) || Object.getPrototypeOf(this) !== OwnerSoulStyleOptionsService.prototype ||
        !value || typeof value !== "object" || isProxy(value)) return false;
    const state = revalidatedStyleHandles.get(value);
    if (!state || state.owner !== this || !this.#matchesRevalidationContext(value, state, context) || !state.isLocallyCurrent()) return false;
    return this.#matchesRevalidationContext(value, state, context) && state.isLocallyCurrent();
  }

  #matchesRevalidationContext(value: object, state: RevalidationState, context: OwnerSoulStyleRevalidationContext): boolean {
    const result = value as RevalidatedOwnerSoulStyleHandle;
    return state.owner === this && state.record.revalidated === value && state.record.handle === context.styleHandle &&
      state.record.attemptId === context.attemptId && state.record.expiresAt === state.originalExpiresAt &&
      this.#attemptEpochs.get(context.attemptId) === state.attemptEpoch && state.record.attemptEpoch === state.attemptEpoch &&
      state.catalogVersion === context.catalog_version && state.sourceMappingSha256 === context.source_mapping_sha256 &&
      sameGenerationPrincipal(state.principal, context.principal) &&
      result.style_handle === context.styleHandle && result.attempt_id === context.attemptId &&
      sameGenerationPrincipal(result.principal, context.principal) && result.catalog_version === context.catalog_version &&
      result.source_mapping_sha256 === context.source_mapping_sha256 && result.style_id === state.record.styleId &&
      result.name === state.record.name && result.fresh_source_snapshot === true;
  }

  #isLocallyCurrentRevalidation(value: object, state: RevalidationState): boolean {
    if (!styleServiceInstances.has(this) || isProxy(this) || Object.getPrototypeOf(this) !== OwnerSoulStyleOptionsService.prototype ||
        state.owner !== this || state.invalidated || this.#closed || state.record.revalidated !== value ||
        this.#handles.get(state.record.handle) !== state.record || state.record.expiresAt !== state.originalExpiresAt ||
        this.#attemptEpochs.get(state.record.attemptId) !== state.attemptEpoch || state.record.attemptEpoch !== state.attemptEpoch ||
        state.catalogVersion !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION || state.sourceMappingSha256 !== SOURCE_MAPPING_SHA256) {
      state.invalidated = true;
      return false;
    }
    try { this.#assertSoulCatalog(this.#catalog); }
    catch {
      state.invalidated = true;
      this.#removeHandle(state.record.handle);
      return false;
    }
    let now: number;
    try { now = this.#safeNow(); }
    catch {
      state.invalidated = true;
      this.#removeHandle(state.record.handle);
      return false;
    }
    if (now < state.lastObservedNow || now >= state.originalExpiresAt) {
      state.invalidated = true;
      this.#removeHandle(state.record.handle);
      return false;
    }
    state.lastObservedNow = now;
    return true;
  }

  invalidateAttempt(attemptId: string): void {
    if (!ATTEMPT_PATTERN.test(attemptId)) return;
    this.#listTokens.delete(attemptId);
    this.#removeAttemptHandles(attemptId);
    for (const controller of this.#pendingByAttempt.get(attemptId) ?? []) controller.abort();
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const tokenAttempt of this.#listTokens.keys()) this.#listTokens.delete(tokenAttempt);
    for (const controllers of this.#pendingByAttempt.values()) for (const controller of controllers) controller.abort();
    for (const handle of this.#handles.keys()) this.#removeHandle(handle);
    this.#handles.clear();
    this.#handlesByAttempt.clear();
    this.#attemptEpochs.clear();
    this.#closing = Promise.allSettled([...this.#operations]).then(() => undefined);
    return this.#closing;
  }

  #assertSoulCatalog(catalog: Pick<DiscoveryCatalogRepository, "getModel">): void {
    try {
      const model = catalog.getModel(MODEL_ID);
      if (model.active !== true || model.id !== MODEL_ID || model.ai_name !== MODEL_ID || !model.modalities.includes("image")) {
        throw new OwnerSoulStyleOptionsServiceError("MODEL_BINDING_MISMATCH");
      }
    } catch (error) {
      if (error instanceof OwnerSoulStyleOptionsServiceError) throw error;
      throw new OwnerSoulStyleOptionsServiceError("MODEL_BINDING_MISMATCH");
    }
  }

  #beginOperation(attemptId: string, parentSignal?: AbortSignal): PendingOperation {
    if (this.#closed) throw new OwnerSoulStyleOptionsServiceError("SERVICE_CLOSED");
    if (this.#pendingCount >= MAX_PENDING_OPERATIONS) throw new OwnerSoulStyleOptionsServiceError("SERVICE_BUSY");
    const controller = new AbortController();
    const onAbort = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) onAbort();
    else parentSignal?.addEventListener("abort", onAbort, { once: true });
    const pending = this.#pendingByAttempt.get(attemptId) ?? new Set<AbortController>();
    pending.add(controller);
    this.#pendingByAttempt.set(attemptId, pending);
    this.#pendingCount += 1;
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    this.#operations.add(done);
    return { controller, done, finish, removeParentAbort: () => parentSignal?.removeEventListener("abort", onAbort) };
  }

  #finishOperation(attemptId: string, operation: PendingOperation): void {
    operation.removeParentAbort();
    const pending = this.#pendingByAttempt.get(attemptId);
    pending?.delete(operation.controller);
    if (pending?.size === 0) this.#pendingByAttempt.delete(attemptId);
    this.#pendingCount -= 1;
    operation.finish();
    this.#operations.delete(operation.done);
  }

  async #resolvePrincipal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    try {
      return await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
    } catch {
      throw new OwnerSoulStyleOptionsServiceError("PRINCIPAL_NOT_LINKED");
    }
  }

  #throwIfClosedOrAborted(controller: AbortController): void {
    if (this.#closed) throw new OwnerSoulStyleOptionsServiceError("SERVICE_CLOSED");
    if (controller.signal.aborted) throw new OwnerSoulStyleOptionsServiceError("UPSTREAM_REQUEST_ABORTED");
  }

  #safeNow(): number {
    const now = this.#now();
    if (!Number.isSafeInteger(now) || now < 0) throw new OwnerSoulStyleOptionsServiceError("INVALID_REQUEST");
    return now;
  }

  #pruneExpired(now: number): void {
    for (const record of this.#handles.values()) if (record.expiresAt <= now) this.#removeHandle(record.handle);
  }

  #removeHandle(handle: string): void {
    const record = this.#handles.get(handle);
    if (!record) return;
    if (record.revalidated !== null) {
      const state = revalidatedStyleHandles.get(record.revalidated);
      if (state) state.invalidated = true;
      record.revalidated = null;
    }
    this.#handles.delete(handle);
    const attemptHandles = this.#handlesByAttempt.get(record.attemptId);
    attemptHandles?.delete(handle);
    if (attemptHandles?.size === 0) {
      this.#handlesByAttempt.delete(record.attemptId);
      this.#attemptEpochs.delete(record.attemptId);
    }
  }

  #removeAttemptHandles(attemptId: string): void {
    for (const handle of this.#handlesByAttempt.get(attemptId) ?? []) this.#removeHandle(handle);
    this.#handlesByAttempt.delete(attemptId);
    this.#attemptEpochs.delete(attemptId);
  }
}

/** Internal application-only expiry accessor; not exported by the package barrel or an MCP tool. */
export function readOwnerSoulStyleRevalidationProvenance(
  service: unknown,
  value: unknown,
  context: OwnerSoulStyleRevalidationContext | unknown
): OwnerSoulStylePrivateRevalidationProvenance | null {
  if (!service || typeof service !== "object" || isProxy(service) || Object.getPrototypeOf(service) !== OwnerSoulStyleOptionsService.prototype ||
      !styleServiceInstances.has(service)) return null;
  const guard = OwnerSoulStyleOptionsService.prototype.isRevalidatedStyleForContext;
  let valid: boolean;
  try { valid = Reflect.apply(guard, service, [value, context]) as boolean; }
  catch { return null; }
  if (!valid || !value || typeof value !== "object" || isProxy(value)) return null;
  const state = revalidatedStyleHandles.get(value);
  if (!state || state.owner !== service || state.invalidated || state.record.revalidated !== value || !state.isLocallyCurrent()) return null;
  return Object.freeze({ original_expires_at_ms: state.originalExpiresAt,
    catalog_version: state.catalogVersion, source_mapping_sha256: state.sourceMappingSha256 });
}

export type OwnerSoulStyleOptionsServicePort = Pick<OwnerSoulStyleOptionsService, "listOptions" | "invalidateAttempt" | "close">;

function mapServiceError(error: unknown, signal: AbortSignal): OwnerSoulStyleOptionsServiceError {
  if (error instanceof OwnerSoulStyleOptionsServiceError) return error;
  if (error instanceof OwnerReferencePrincipalError) return new OwnerSoulStyleOptionsServiceError("PRINCIPAL_NOT_LINKED");
  if (error instanceof OwnerSoulStyleCatalogHttpError) {
    if (error.code === "AUTH_REQUIRED" || error.code === "AUTH_OR_ACCESS_DENIED") {
      return new OwnerSoulStyleOptionsServiceError("PRINCIPAL_NOT_LINKED");
    }
    if (error.code === "UPSTREAM_TIMEOUT") return new OwnerSoulStyleOptionsServiceError("UPSTREAM_TIMEOUT");
    if (error.code === "UPSTREAM_REQUEST_ABORTED") return new OwnerSoulStyleOptionsServiceError("UPSTREAM_REQUEST_ABORTED");
    if (error.code === "UPSTREAM_PROTOCOL_ERROR") return new OwnerSoulStyleOptionsServiceError("UPSTREAM_PROTOCOL_ERROR");
  }
  if (signal.aborted) return new OwnerSoulStyleOptionsServiceError("UPSTREAM_REQUEST_ABORTED");
  return new OwnerSoulStyleOptionsServiceError("UPSTREAM_UNAVAILABLE");
}

function normalizeStyleSnapshot(input: OwnerSoulStyleCatalogSnapshot | unknown): OwnerSoulStyleCatalogSnapshot {
  try { return decodeStyleSnapshot(input); }
  catch (error) {
    if (error instanceof OwnerSoulStyleOptionsServiceError && error.code === "SOURCE_SNAPSHOT_INVALID") throw error;
    throw new OwnerSoulStyleOptionsServiceError("SOURCE_SNAPSHOT_INVALID");
  }
}

function decodeStyleSnapshot(input: OwnerSoulStyleCatalogSnapshot | unknown): OwnerSoulStyleCatalogSnapshot {
  const snapshot = readExactRecord(input, ["records", "summary"]);
  const records = readDenseArray(snapshot.records, MAX_STYLES_PER_ATTEMPT);
  if (!records || records.length < 1) invalid("SOURCE_SNAPSHOT_INVALID");
  const normalized: OwnerSoulStyleCatalogRecord[] = [];
  const seenIds = new Set<string>();
  for (const raw of records) {
    const row = readExactRecord(raw, ["style_id", "name", "image"]);
    const styleId = boundedText(row.style_id, 256);
    const name = boundedText(row.name, 256);
    const image = boundedText(row.image, 4096);
    if (!styleId || !name || !image || seenIds.has(styleId)) invalid("SOURCE_SNAPSHOT_INVALID");
    seenIds.add(styleId);
    normalized.push(Object.freeze({ style_id: styleId, name, image }));
  }
  const summary = snapshotSummary(snapshot.summary, normalized);
  return Object.freeze({ records: Object.freeze(normalized), summary });
}

function snapshotSummary(value: unknown, records: readonly OwnerSoulStyleCatalogRecord[]): OwnerSoulStyleCatalogValidationSummary {
  const input = readExactRecord(value, ["route", "response_bytes", "record_count", "total_matches", "unique_ids",
    "fields_valid", "unknown_top_level_key_count", "unknown_item_key_count", "style_id_utf8_bytes", "name_utf8_bytes"]);
  const styleRange = readExactRecord(input.style_id_utf8_bytes, ["min", "max"]);
  const nameRange = readExactRecord(input.name_utf8_bytes, ["min", "max"]);
  const idLengths = records.map(({ style_id }) => Buffer.byteLength(style_id, "utf8"));
  const nameLengths = records.map(({ name }) => Buffer.byteLength(name, "utf8"));
  if (input.route !== "hf/lora/styles" || !boundedInt(input.response_bytes, 0, 65_536) ||
      input.record_count !== records.length || input.total_matches !== true || input.unique_ids !== true || input.fields_valid !== true ||
      !boundedInt(input.unknown_top_level_key_count, 0, 64) || !boundedInt(input.unknown_item_key_count, 0, 128 * 64) ||
      !styleRange || !nameRange || styleRange.min !== Math.min(...idLengths) || styleRange.max !== Math.max(...idLengths) ||
      nameRange.min !== Math.min(...nameLengths) || nameRange.max !== Math.max(...nameLengths)) invalid("SOURCE_SNAPSHOT_INVALID");
  return Object.freeze({
    route: "hf/lora/styles", response_bytes: input.response_bytes as number, record_count: input.record_count as number,
    total_matches: true, unique_ids: true, fields_valid: true,
    unknown_top_level_key_count: input.unknown_top_level_key_count as number,
    unknown_item_key_count: input.unknown_item_key_count as number,
    style_id_utf8_bytes: Object.freeze({ min: styleRange.min as number, max: styleRange.max as number }),
    name_utf8_bytes: Object.freeze({ min: nameRange.min as number, max: nameRange.max as number })
  });
}

function snapshotListInput(value: unknown): { attemptId: string; signal?: AbortSignal } {
  const input = readExactRecord(value, ["attemptId", "signal"], ["attemptId"]);
  return { attemptId: safeAttempt(input.attemptId), ...(input.signal === undefined ? {} : { signal: safeSignal(input.signal) }) };
}

function snapshotResolveInput(value: unknown): { attemptId: string; styleHandle: string; signal?: AbortSignal } {
  const input = readExactRecord(value, ["attemptId", "styleHandle", "signal"], ["attemptId", "styleHandle"]);
  const attemptId = safeAttempt(input.attemptId);
  if (typeof input.styleHandle !== "string" || !STYLE_HANDLE_PATTERN.test(input.styleHandle)) invalid("INVALID_REQUEST");
  return { attemptId, styleHandle: input.styleHandle, ...(input.signal === undefined ? {} : { signal: safeSignal(input.signal) }) };
}

function snapshotStyleRevalidationContext(value: unknown): OwnerSoulStyleRevalidationContext {
  const fields = readExactRecord(value, ["attemptId", "styleHandle", "principal", "catalog_version", "source_mapping_sha256"]);
  const attemptId = safeAttempt(fields.attemptId);
  if (typeof fields.styleHandle !== "string" || !STYLE_HANDLE_PATTERN.test(fields.styleHandle) ||
      fields.catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION || fields.source_mapping_sha256 !== SOURCE_MAPPING_SHA256) {
    invalid("INVALID_REQUEST");
  }
  const principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef);
  if (principal.connection_id !== attemptId) invalid("INVALID_REQUEST");
  return Object.freeze({ attemptId, styleHandle: fields.styleHandle, principal,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, source_mapping_sha256: SOURCE_MAPPING_SHA256 });
}

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const binding = readExactRecord(value, ["tenant_id", "subject"]);
  if (typeof binding.tenant_id !== "string" || typeof binding.subject !== "string" ||
      binding.tenant_id.length < 1 || binding.tenant_id.length > 256 || binding.subject.length < 1 || binding.subject.length > 512 ||
      CONTROL_CHARACTERS.test(binding.tenant_id) || CONTROL_CHARACTERS.test(binding.subject)) invalid("INVALID_REQUEST");
  return Object.freeze({ tenant_id: binding.tenant_id, subject: binding.subject });
}

function readExactRecord(value: unknown, keys: readonly string[], requiredKeys: readonly string[] = keys): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) invalid("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some((key) => typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) ||
      requiredKeys.some((key) => !Object.hasOwn(descriptors, key))) invalid("INVALID_REQUEST");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of ownKeys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function readDenseArray(value: unknown, maximum: number): unknown[] | null {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  const lengthCandidate: unknown = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : undefined;
  if (typeof lengthCandidate !== "number" || !Number.isSafeInteger(lengthCandidate) || lengthCandidate < 0 ||
      lengthCandidate > maximum || Reflect.ownKeys(descriptors).length !== lengthCandidate + 1) return null;
  const length = lengthCandidate;
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    result.push(descriptor.value);
  }
  return result;
}

function boundedText(value: unknown, maximumBytes: number): string | null {
  if (typeof value !== "string" || value.length === 0 || CONTROL_CHARACTERS.test(value)) return null;
  const bytes = Buffer.byteLength(value, "utf8");
  return bytes > 0 && bytes <= maximumBytes ? value : null;
}

function safeAttempt(value: unknown): string {
  if (typeof value !== "string" || !ATTEMPT_PATTERN.test(value)) invalid("INVALID_REQUEST");
  return value;
}

function safeSignal(value: unknown): AbortSignal {
  if (!(value instanceof AbortSignal) || isProxy(value)) invalid("INVALID_REQUEST");
  return value;
}

function boundedInt(value: unknown, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function invalid(code: OwnerSoulStyleOptionsServiceErrorCode = "INVALID_REQUEST"): never {
  throw new OwnerSoulStyleOptionsServiceError(code);
}
