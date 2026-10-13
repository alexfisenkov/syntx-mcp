import { randomUUID } from "node:crypto";
import { isProxy } from "node:util/types";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import { snapshotGenerationPrincipal, sameGenerationPrincipal } from "../domain/generation-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { schemaHash } from "../domain/generation-contract.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import {
  normalizeOwnerWanT2iParameters,
  OwnerWanT2iParametersError,
  type OwnerWanT2iModel,
  type OwnerWanT2iParameters,
  type OwnerWanT2iParametersInput
} from "./owner-wan-t2i-parameters.js";
import {
  getOwnerWanT2iSourceProfile,
  OwnerWanT2iSourceProfileError,
  type OwnerWanT2iSourceProfile
} from "./owner-wan-t2i-source-profile.js";
import {
  projectOwnerWanT2iCostParameters,
  type OwnerWanT2iCostParameters
} from "./owner-wan-t2i-cost-parameters.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const MAX_PENDING = 4;
const MAX_CANDIDATES = 128;
const CANDIDATE_TTL_MS = 15 * 60_000;

export interface OwnerWanT2iRequestPreparerOptions {
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string;
  readonly now?: () => number;
}

export interface PrepareOwnerWanT2iRequestInput {
  readonly attemptId: string;
  readonly principal: GenerationPrincipalRef;
  readonly input: OwnerWanT2iParametersInput;
  readonly signal?: AbortSignal;
}

export interface OwnerWanT2iPreparedCandidate {
  readonly status: "PREPARED_SOURCE_SHAPED";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly provider_execution: false;
  readonly profile_id: "owner-wan-t2i-source-profile-v1";
  readonly profile_schema_hash: string;
  readonly source_binding: OwnerWanT2iSourceProfile["source_binding"];
  readonly model_id: OwnerWanT2iModel;
  readonly ai_name: "wan_image";
  readonly scope: "image";
  readonly operation_id: "generate-image";
  readonly catalog_version: OwnerWanT2iSourceProfile["public_catalog_version"];
  readonly parameters: OwnerWanT2iParameters;
  readonly cost_routing: OwnerWanT2iCostParameters["routing"];
  readonly cost_inputs: OwnerWanT2iCostParameters["cost_inputs"];
  readonly cost_input_confidence: OwnerWanT2iCostParameters["confidence"];
  readonly source_projection_confidence: "EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY";
  readonly defaults_injected: false;
  readonly expires_at_ms: number;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  /** Private fixed request; non-enumerable and only retained for exact-class consumer checks. */
  readonly request: Readonly<{
    prompt: string;
    settings: Readonly<{
      n: 1;
      model_type: OwnerWanT2iModel;
      aspect_ratio: OwnerWanT2iParameters["aspect_ratio"];
      resolution: OwnerWanT2iParameters["resolution"];
      batch_size: OwnerWanT2iParameters["batch_size"];
      prompt_extend: boolean;
      seed: number | null;
      color_palette: null;
      bbox_list: readonly [];
      file_urls: readonly [];
    }>;
  }>;
}

export type OwnerWanT2iRequestPrepareErrorCode =
  | "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED" | "REQUEST_ABORTED"
  | "PRINCIPAL_NOT_LINKED" | "PRINCIPAL_MISMATCH" | "PROFILE_BINDING_MISMATCH" | "CANDIDATE_EXPIRED" |
  "CLOCK_INVALID" | "ATTEMPT_INVALIDATING";

export class OwnerWanT2iRequestPrepareError extends Error {
  constructor(readonly code: OwnerWanT2iRequestPrepareErrorCode) {
    super("The owner WAN T2I request candidate could not be prepared safely.");
    this.name = "OwnerWanT2iRequestPrepareError";
  }
}

interface PrepareRequest {
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly input: OwnerWanT2iParametersInput;
  readonly signal?: AbortSignal;
}
interface ActiveOperation {
  readonly attemptId: string;
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly removeParentAbort: () => void;
}
interface PreparedState {
  readonly owner: OwnerWanT2iRequestPreparer;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly epoch: number;
  readonly profile: Readonly<OwnerWanT2iSourceProfile>;
  readonly expiresAt: number;
  readonly request: OwnerWanT2iPreparedCandidate["request"];
  readonly requestFingerprint: string;
  readonly intentFingerprint: string;
}

const preparedStates = new WeakMap<object, PreparedState>();
const revokedCandidates = new WeakSet<object>();

/** Builds one owner-bound private T2I request shape; it neither issues references nor grants dispatch. */
export class OwnerWanT2iRequestPreparer {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: PerUserLinkService;
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #catalogVersion: string;
  readonly #now: () => number;
  readonly #candidates = new Set<object>();
  readonly #epochs = new Map<string, number>();
  readonly #invalidatingAttempts = new Set<string>();
  readonly #invalidations = new Map<string, Promise<void>>();
  readonly #operationsByAttempt = new Map<string, Set<ActiveOperation>>();
  readonly #operations = new Set<ActiveOperation>();
  #pending = 0;
  #closed = false;
  #lastNow: number | undefined;
  #clockRollbackDetected = false;
  #closing: Promise<void> | undefined;

  constructor(optionsInput: OwnerWanT2iRequestPreparerOptions | unknown) {
    const fields = exactRecord(optionsInput, ["binding", "linkService", "catalog", "catalog_version", "now"], ["now"]);
    if (!(fields.linkService instanceof PerUserLinkService) || isProxy(fields.linkService) ||
        Object.getPrototypeOf(fields.linkService) !== PerUserLinkService.prototype ||
        !(fields.catalog instanceof DiscoveryCatalogRepository) || isProxy(fields.catalog) ||
        Object.getPrototypeOf(fields.catalog) !== DiscoveryCatalogRepository.prototype ||
        fields.catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION ||
        (fields.now !== undefined && (typeof fields.now !== "function" || isProxy(fields.now)))) fail("PROFILE_BINDING_MISMATCH");
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = fields.linkService;
    this.#catalog = fields.catalog;
    this.#catalogVersion = fields.catalog_version;
    this.#now = fields.now as (() => number) | undefined ?? Date.now;
    this.#profile("wan_25_t2i_preview");
    this.#profile("wan_26_t2i");
  }

  async prepare(inputValue: PrepareOwnerWanT2iRequestInput | unknown): Promise<OwnerWanT2iPreparedCandidate> {
    const request = snapshotPrepareInput(inputValue);
    this.#assertOpen();
    this.#throwIfAborted(request.signal);
    if (this.#invalidatingAttempts.has(request.attemptId)) fail("ATTEMPT_INVALIDATING");
    if (this.#pending >= MAX_PENDING) fail("SERVICE_BUSY");
    this.#pruneExpired(this.#readNow());
    if (this.#candidates.size >= MAX_CANDIDATES) fail("CAPACITY_EXCEEDED");
    const normalized = normalizeOwnerWanT2iParameters(request.input);
    const cost = projectOwnerWanT2iCostParameters(request.input);
    const profile = this.#profile(request.input.model_id);
    const startedAt = this.#readNow();
    if (startedAt > Number.MAX_SAFE_INTEGER - CANDIDATE_TTL_MS) fail("CLOCK_INVALID");
    const expiresAt = startedAt + CANDIDATE_TTL_MS;
    const operation = this.#begin(request.attemptId, request.signal);
    const epoch = this.#epochs.get(request.attemptId) ?? 0;
    try {
      const initialPrincipal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfAborted(operation.controller.signal);
      if (!sameGenerationPrincipal(initialPrincipal, request.principal)) fail("PRINCIPAL_MISMATCH");
      const currentProfile = this.#profile(request.input.model_id);
      if (currentProfile.profile_schema_hash !== profile.profile_schema_hash ||
          currentProfile.public_catalog_version !== profile.public_catalog_version) fail("PROFILE_BINDING_MISMATCH");
      const currentPrincipal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfAborted(operation.controller.signal);
      if (!sameGenerationPrincipal(initialPrincipal, currentPrincipal) ||
          !sameGenerationPrincipal(initialPrincipal, request.principal)) fail("PRINCIPAL_NOT_LINKED");
      if ((this.#epochs.get(request.attemptId) ?? 0) !== epoch) fail("CANDIDATE_EXPIRED");
      const checkedAt = this.#readNow();
      if (expiresAt <= checkedAt) fail("CANDIDATE_EXPIRED");

      const parameters = normalized.source_bound_intent.parameters;
      const settings = deepFreeze({
        n: 1 as const,
        model_type: request.input.model_id,
        aspect_ratio: parameters.aspect_ratio,
        resolution: parameters.resolution,
        batch_size: parameters.batch_size,
        prompt_extend: parameters.prompt_extend,
        seed: parameters.seed,
        color_palette: null as null,
        bbox_list: [] as const,
        file_urls: [] as const
      });
      const privateRequest = deepFreeze({ prompt: normalized.source_bound_intent.prompt, settings });
      const intentFingerprint = schemaHash({ tenant_id: initialPrincipal.tenant_id, subject_id: initialPrincipal.subject_id,
        model_id: request.input.model_id, profile_schema_hash: profile.profile_schema_hash,
        source_binding: profile.source_binding, request: privateRequest });
      const nonce = randomUUID();
      const requestFingerprint = schemaHash({ nonce, attempt_id: request.attemptId, principal: initialPrincipal,
        profile_schema_hash: profile.profile_schema_hash, source_binding: profile.source_binding,
        request: privateRequest, expires_at_ms: expiresAt });
      const record: Record<string, unknown> = {
        status: "PREPARED_SOURCE_SHAPED",
        dispatch_allowed: false,
        backend_acceptance: "UNPROVEN",
        provider_execution: false,
        profile_id: profile.profile_id,
        profile_schema_hash: profile.profile_schema_hash,
        source_binding: profile.source_binding,
        model_id: request.input.model_id,
        ai_name: profile.ai_name,
        scope: profile.scope,
        operation_id: profile.operation_id,
        catalog_version: profile.public_catalog_version,
        parameters,
        cost_routing: cost.routing,
        cost_inputs: cost.cost_inputs,
        cost_input_confidence: cost.confidence,
        source_projection_confidence: "EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY",
        defaults_injected: false,
        expires_at_ms: expiresAt,
        request_fingerprint: requestFingerprint,
        intent_fingerprint: intentFingerprint
      };
      Object.defineProperty(record, "request", { value: privateRequest, enumerable: false, writable: false, configurable: false });
      Object.freeze(record);
      const candidate = record as unknown as OwnerWanT2iPreparedCandidate;
      preparedStates.set(candidate, Object.freeze({ owner: this, attemptId: request.attemptId, principal: initialPrincipal,
        epoch, profile, expiresAt, request: privateRequest, requestFingerprint, intentFingerprint }));
      this.#candidates.add(candidate);
      return candidate;
    } finally { this.#finish(operation); }
  }

  isPreparedCandidateForPrincipal(candidate: unknown, contextInput: unknown): candidate is OwnerWanT2iPreparedCandidate {
    try {
      const context = exactRecord(contextInput, ["attemptId", "principal"]);
      const attemptId = validateAttempt(context.attemptId);
      const principal = snapshotGenerationPrincipal(context.principal as GenerationPrincipalRef);
      if (principal.connection_id !== attemptId || !candidate || typeof candidate !== "object" || Array.isArray(candidate) ||
          isProxy(candidate) || this.#closed || Object.getPrototypeOf(this) !== OwnerWanT2iRequestPreparer.prototype) return false;
      const state = preparedStates.get(candidate as object);
      if (!state || state.owner !== this || revokedCandidates.has(candidate as object) || state.attemptId !== attemptId ||
          this.#invalidatingAttempts.has(attemptId) || !sameGenerationPrincipal(state.principal, principal) ||
          (this.#epochs.get(attemptId) ?? 0) !== state.epoch) return false;
      const now = this.#readNow();
      if (state.expiresAt <= now) return false;
      const profile = this.#profile(state.profile.model_id);
      if (profile.profile_schema_hash !== state.profile.profile_schema_hash ||
          profile.public_catalog_version !== state.profile.public_catalog_version) return false;
      const value = candidate as OwnerWanT2iPreparedCandidate;
      const requestDescriptor = Object.getOwnPropertyDescriptor(candidate, "request");
      return value.dispatch_allowed === false && value.request_fingerprint === state.requestFingerprint &&
        value.intent_fingerprint === state.intentFingerprint && value.profile_schema_hash === state.profile.profile_schema_hash &&
        requestDescriptor !== undefined && "value" in requestDescriptor && requestDescriptor.enumerable === false &&
        requestDescriptor.value === state.request && Object.isFrozen(value) && Object.isFrozen(state.request) &&
        Object.isFrozen(state.request.settings);
    } catch { return false; }
  }

  async invalidateAttempt(attemptIdInput: unknown): Promise<void> {
    let attemptId: string;
    try { attemptId = validateAttempt(attemptIdInput); } catch { return; }
    const existing = this.#invalidations.get(attemptId);
    if (existing) { await existing; return; }
    this.#invalidatingAttempts.add(attemptId);
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    for (const candidate of this.#candidates) {
      const state = preparedStates.get(candidate);
      if (state?.attemptId === attemptId) { revokedCandidates.add(candidate); this.#candidates.delete(candidate); }
    }
    const operations = [...(this.#operationsByAttempt.get(attemptId) ?? [])];
    const drain = Promise.allSettled(operations.map((operation) => operation.done)).then(() => undefined);
    this.#invalidations.set(attemptId, drain);
    for (const operation of operations) operation.controller.abort();
    try { await drain; }
    finally {
      this.#operationsByAttempt.delete(attemptId);
      this.#invalidatingAttempts.delete(attemptId);
      if (this.#invalidations.get(attemptId) === drain) this.#invalidations.delete(attemptId);
    }
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const candidate of this.#candidates) revokedCandidates.add(candidate);
    for (const operation of this.#operations) operation.controller.abort();
    this.#closing = Promise.allSettled([
      ...[...this.#operations].map((operation) => operation.done), ...this.#invalidations.values()
    ]).then(() => {
      this.#candidates.clear(); this.#epochs.clear(); this.#operationsByAttempt.clear(); this.#operations.clear();
      this.#invalidations.clear(); this.#invalidatingAttempts.clear();
    });
    return this.#closing;
  }

  #profile(modelId: OwnerWanT2iModel): Readonly<OwnerWanT2iSourceProfile> {
    try { return getOwnerWanT2iSourceProfile(modelId, this.#catalog, this.#catalogVersion); }
    catch (error) {
      if (error instanceof OwnerWanT2iSourceProfileError) fail(error.code === "INVALID_REQUEST" ? "INVALID_REQUEST" : "PROFILE_BINDING_MISMATCH");
      fail("PROFILE_BINDING_MISMATCH");
    }
  }

  async #resolvePrincipal(attemptId: string, signal: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    this.#throwIfAborted(signal);
    const pending = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
    let removeAbort = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(new OwnerWanT2iRequestPrepareError("REQUEST_ABORTED"));
      if (signal.aborted) onAbort();
      else { signal.addEventListener("abort", onAbort, { once: true }); removeAbort = () => signal.removeEventListener("abort", onAbort); }
    });
    try { return await Promise.race([pending, aborted]); }
    catch (error) {
      if (error instanceof OwnerWanT2iRequestPrepareError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      fail("PRINCIPAL_NOT_LINKED");
    } finally { removeAbort(); }
  }

  #begin(attemptId: string, parentSignal?: AbortSignal): ActiveOperation {
    this.#assertOpen();
    if (this.#invalidatingAttempts.has(attemptId)) fail("ATTEMPT_INVALIDATING");
    if (this.#pending >= MAX_PENDING) fail("SERVICE_BUSY");
    const controller = new AbortController();
    const abort = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) abort(); else parentSignal?.addEventListener("abort", abort, { once: true });
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const operation: ActiveOperation = { attemptId, controller, done, finish,
      removeParentAbort: () => parentSignal?.removeEventListener("abort", abort) };
    this.#pending += 1;
    this.#operations.add(operation);
    const attempts = this.#operationsByAttempt.get(attemptId) ?? new Set<ActiveOperation>();
    attempts.add(operation); this.#operationsByAttempt.set(attemptId, attempts);
    return operation;
  }

  #finish(operation: ActiveOperation): void {
    operation.removeParentAbort();
    this.#pending -= 1;
    operation.finish();
    this.#operations.delete(operation);
    const attempts = this.#operationsByAttempt.get(operation.attemptId);
    attempts?.delete(operation);
    if (attempts?.size === 0) this.#operationsByAttempt.delete(operation.attemptId);
  }

  #pruneExpired(now: number): void {
    for (const candidate of this.#candidates) {
      const state = preparedStates.get(candidate);
      if (!state || state.expiresAt <= now || (this.#epochs.get(state.attemptId) ?? 0) !== state.epoch) {
        revokedCandidates.add(candidate); this.#candidates.delete(candidate);
      }
    }
  }

  #readNow(): number {
    if (this.#clockRollbackDetected) fail("CLOCK_INVALID");
    let value: unknown;
    try { value = Reflect.apply(this.#now, undefined, []); } catch { fail("CLOCK_INVALID"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0) fail("CLOCK_INVALID");
    if (this.#lastNow !== undefined && (value as number) < this.#lastNow) {
      this.#clockRollbackDetected = true;
      fail("CLOCK_INVALID");
    }
    this.#lastNow = value as number;
    return value as number;
  }

  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  #throwIfAborted(signal?: AbortSignal): void {
    if (this.#closed) fail("SERVICE_CLOSED");
    if (signal?.aborted) fail("REQUEST_ABORTED");
  }
}

function snapshotPrepareInput(value: unknown): PrepareRequest {
  const fields = exactRecord(value, ["attemptId", "principal", "input", "signal"], ["signal"]);
  const attemptId = validateAttempt(fields.attemptId);
  const principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef);
  if (principal.connection_id !== attemptId) fail("INVALID_REQUEST");
  if (fields.signal !== undefined && (!(fields.signal instanceof AbortSignal) || isProxy(fields.signal))) fail("INVALID_REQUEST");
  let normalized: OwnerWanT2iParametersInput;
  try { normalized = normalizeOwnerWanT2iParameters(fields.input).source_bound_intent; }
  catch (error) {
    if (error instanceof OwnerWanT2iParametersError) fail("INVALID_REQUEST");
    throw error;
  }
  return { attemptId, principal, input: normalized, ...(fields.signal === undefined ? {} : { signal: fields.signal as AbortSignal }) };
}

function exactRecord(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.some((key) => typeof key !== "string" || !keys.includes(key)) ||
      keys.some((key) => !optional.includes(key) && !Object.hasOwn(descriptors, key))) fail("INVALID_REQUEST");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail("INVALID_REQUEST");
    result[key] = descriptor.value;
  }
  return result;
}

function validateAttempt(value: unknown): string {
  if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST");
  return value;
}

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || fields.tenant_id.length === 0 || fields.tenant_id.length > 256 ||
      /[\u0000-\u001f\u007f]/u.test(fields.tenant_id) || typeof fields.subject !== "string" ||
      fields.subject.length === 0 || fields.subject.length > 512 || /[\u0000-\u001f\u007f]/u.test(fields.subject)) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function fail(code: OwnerWanT2iRequestPrepareErrorCode): never { throw new OwnerWanT2iRequestPrepareError(code); }
