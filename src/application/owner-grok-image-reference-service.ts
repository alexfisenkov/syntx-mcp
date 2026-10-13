import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import {
  getOwnerGrokImageReferenceProfile,
  validateOwnerGrokImageReferenceParameters,
  type OwnerGrokImageReferenceProfile,
  type OwnerGrokImageReferenceProfileId,
  type OwnerGrokImageReferenceProfileSet
} from "../catalog/owner-grok-image-reference-profiles.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import {
  OwnerMediaReferenceStore,
  OwnerMediaReferenceStoreError
} from "./owner-media-reference-store.js";
import { OwnerGrokImageReferencePrepareError, prepareOwnerGrokImageReferenceRequest } from "./owner-grok-image-reference-request-preparer.js";
import { createOwnerGrokImageReferenceOneShotPermit } from "./owner-grok-image-reference-one-shot-policy.js";
import { validateOwnerImageReferenceInput } from "./owner-image-reference-input-validator.js";
import {
  OwnerGrokImageReferenceLifecycle,
  type GenerateOwnerGrokImageReferenceInput,
  type ListOwnerGrokImageReferenceRecoveriesInput,
  type OwnerGrokImageReferenceDispatchClient,
  type OwnerGrokImageReferenceLifecycleOptions,
  type OwnerGrokImageReferenceLifecyclePreflight,
  type OwnerGrokImageReferenceRecoveryListItem,
  type OwnerGrokImageReferenceLifecycleResult,
  type ReconcileOwnerGrokImageReferenceInput
} from "./owner-grok-image-reference-lifecycle.js";
import { uploadOwnerGrokImageReference, type OwnerGrokImageReferenceUploadReceipt } from "./owner-grok-image-reference-upload-service.js";

const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE_PATTERN = /^reference_[0-9a-f-]{36}$/u;
const RECOVERY_PATTERN = /^recovery_[0-9a-f-]{36}$/u;
const MAX_PENDING = 8;
const PRINCIPAL_TTL_MS = 15 * 60_000;
const MAX_PRINCIPALS = 128;

export interface OwnerGrokImageReferenceServiceOptions {
  readonly profile_set: OwnerGrokImageReferenceProfileSet;
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly referenceStore?: OwnerMediaReferenceStore;
  readonly createChatClient: (attemptId: string) => OwnerGrokImageReferenceDispatchClient & Pick<SyntxChatHttpClient, "uploadFileReferences">;
  readonly preflight: OwnerGrokImageReferenceLifecyclePreflight;
  readonly now?: () => number;
  readonly lifecycleOptions?: OwnerGrokImageReferenceLifecycleOptions;
}

export interface OwnerGrokImageReferenceUploadRequest {
  readonly profile_id: OwnerGrokImageReferenceProfileId;
  readonly attemptId: string;
  readonly content_base64: string;
  readonly filename: string;
  readonly mime_type: string;
}

export interface OwnerGrokImageReferenceGenerateRequest {
  readonly profile_id: OwnerGrokImageReferenceProfileId;
  readonly attemptId: string;
  readonly reference_handles: readonly string[];
  readonly parameters: unknown;
}

export interface OwnerGrokImageReferenceReconcileRequest {
  readonly profile_id: OwnerGrokImageReferenceProfileId;
  readonly attemptId: string;
  readonly recovery_id: string;
}

export interface OwnerGrokImageReferenceRecoveryListRequest {
  readonly profile_id: OwnerGrokImageReferenceProfileId;
  readonly attemptId: string;
  readonly limit: number;
}

export interface OwnerGrokImageReferenceSchema {
  readonly profile_id: OwnerGrokImageReferenceProfileId;
  readonly schema_hash: string;
  readonly profile_set_sha256: string;
  readonly catalog_version: string;
  readonly model_id: string;
  readonly variant_id: OwnerGrokImageReferenceProfileId;
  readonly operation_id: "generate-image";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "unproven";
  readonly prompt: Readonly<{ required: true; min_length: 1; max_length: 5000 }>;
  readonly reference_count: Readonly<{ minimum: number; maximum: number }>;
  readonly resolution: Readonly<{ required: true; values: readonly ["1k", "2k"] }>;
  readonly batch_size: Readonly<{ required: true; values: readonly [1, 2, 3, 4, 5] }>;
  readonly aspect_ratio: Readonly<{ required: boolean; values: readonly string[] }>;
  readonly fixed_settings: Readonly<{ n: 1 }>;
  readonly output_policy: OwnerGrokImageReferenceProfile["output_policy"];
}

export interface OwnerGrokImageReferenceValidationResult {
  readonly profile_id: OwnerGrokImageReferenceProfileId;
  readonly schema_hash: string;
  readonly profile_set_sha256: string;
  readonly catalog_version: string;
  readonly model_id: string;
  readonly reference_count: number;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "unproven";
  readonly request: ReturnType<typeof validateOwnerGrokImageReferenceParameters>;
}

export type OwnerGrokImageReferenceServiceErrorCode =
  | "INVALID_REQUEST"
  | "PROFILE_INVALID"
  | "PROFILE_SET_INVALID"
  | "SERVICE_CLOSED"
  | "SERVICE_BUSY"
  | "PRINCIPAL_NOT_LINKED"
  | "REFERENCE_UNAVAILABLE"
  | "PREFLIGHT_FAILED"
  | "INVALID_IMAGE_INPUT"
  | "OUTCOME_UNKNOWN";

export class OwnerGrokImageReferenceServiceError extends Error {
  constructor(readonly code: OwnerGrokImageReferenceServiceErrorCode) {
    super("The owner Grok image-reference service could not complete this request safely.");
    this.name = "OwnerGrokImageReferenceServiceError";
  }
}

/** Process-local owner facade for the source-reviewed Grok profiles; never promotes backend acceptance. */
export class OwnerGrokImageReferenceService {
  readonly #profileSet: OwnerGrokImageReferenceProfileSet;
  readonly #binding: AuthBinding;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #referenceStore: OwnerMediaReferenceStore;
  readonly #createChatClient: OwnerGrokImageReferenceServiceOptions["createChatClient"];
  readonly #preflight: OwnerGrokImageReferenceLifecyclePreflight;
  readonly #now: () => number;
  readonly #lifecycle: OwnerGrokImageReferenceLifecycle;
  readonly #controllers = new Map<string, Set<AbortController>>();
  readonly #pending = new Set<Promise<unknown>>();
  readonly #pendingByAttempt = new Map<string, Set<Promise<unknown>>>();
  readonly #principals = new Map<string, Readonly<{ principal: Readonly<GenerationPrincipalRef>; expiresAt: number }>>();
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(options: OwnerGrokImageReferenceServiceOptions) {
    const fields = exactRecord(options, ["profile_set", "binding", "linkService", "referenceStore", "createChatClient", "preflight", "now", "lifecycleOptions"],
      ["profile_set", "binding", "linkService", "createChatClient", "preflight"]);
    if (typeof fields.createChatClient !== "function" || types.isProxy(fields.createChatClient) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now))) ||
        (fields.referenceStore !== undefined && (!(fields.referenceStore instanceof OwnerMediaReferenceStore) || types.isProxy(fields.referenceStore)))) {
      invalid("INVALID_REQUEST");
    }
    getProfile(fields.profile_set, "grok-i2i-reference-one-source-reviewed");
    const lifecycleOptions = snapshotLifecycleOptions(fields.lifecycleOptions);
    this.#profileSet = fields.profile_set as OwnerGrokImageReferenceProfileSet;
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = snapshotLinkService(fields.linkService);
    this.#now = fields.now as (() => number) | undefined ?? lifecycleOptions.now ?? Date.now;
    this.#referenceStore = fields.referenceStore as OwnerMediaReferenceStore | undefined ?? new OwnerMediaReferenceStore(
      { now: this.#now }
    );
    this.#createChatClient = fields.createChatClient as OwnerGrokImageReferenceServiceOptions["createChatClient"];
    this.#preflight = snapshotPreflight(fields.preflight);
    this.#lifecycle = new OwnerGrokImageReferenceLifecycle({ ...lifecycleOptions, now: this.#now });
  }

  getSchema(profileIdInput: OwnerGrokImageReferenceProfileId | string): OwnerGrokImageReferenceSchema {
    const profile = getProfile(this.#profileSet, profileIdInput);
    return Object.freeze({
      profile_id: profile.profile_id, schema_hash: profile.schema_hash,
      profile_set_sha256: this.#profileSet.profile_set_sha256, catalog_version: profile.catalog_version,
      model_id: profile.model_id, variant_id: profile.variant_id,
      operation_id: "generate-image", dispatch_allowed: false, backend_acceptance: "unproven",
      prompt: profile.prompt_schema,
      reference_count: profile.reference_bounds,
      resolution: Object.freeze({ required: true, values: profile.resolution_schema }),
      batch_size: Object.freeze({ required: true, values: Object.freeze([1, 2, 3, 4, 5]) as readonly [1, 2, 3, 4, 5] }),
      aspect_ratio: Object.freeze({ required: profile.aspect_ratio_policy.mode === "required", values: profile.aspect_ratio_policy.allowed_values }),
      fixed_settings: profile.server_contract.fixed_settings,
      output_policy: profile.output_policy
    });
  }

  validate(profileIdInput: OwnerGrokImageReferenceProfileId | string, parameters: unknown, referenceCount: number): OwnerGrokImageReferenceValidationResult {
    const profile = getProfile(this.#profileSet, profileIdInput);
    try {
      const request = validateOwnerGrokImageReferenceParameters(profile, parameters, referenceCount);
      return Object.freeze({ profile_id: profile.profile_id, schema_hash: profile.schema_hash,
        profile_set_sha256: this.#profileSet.profile_set_sha256, catalog_version: profile.catalog_version,
        model_id: profile.model_id, reference_count: referenceCount,
        dispatch_allowed: false, backend_acceptance: "unproven", request });
    } catch { invalid("INVALID_REQUEST"); }
  }

  async upload(input: OwnerGrokImageReferenceUploadRequest, signal?: AbortSignal): Promise<OwnerGrokImageReferenceUploadReceipt> {
    const request = exactRecord(input, ["profile_id", "attemptId", "content_base64", "filename", "mime_type"]);
    const profile = getProfile(this.#profileSet, request.profile_id as string);
    const attemptId = safeAttempt(request.attemptId);
    if (typeof request.content_base64 !== "string" || typeof request.filename !== "string" || typeof request.mime_type !== "string") invalid("INVALID_REQUEST");
    let image;
    try { image = validateOwnerImageReferenceInput({ content_base64: request.content_base64, filename: request.filename, mime_type: request.mime_type }); }
    catch { invalid("INVALID_IMAGE_INPUT"); }
    return this.#run(attemptId, signal, async (requestSignal) => {
      const principal = await this.#resolvePrincipal(attemptId);
      await this.#runUploadPreflight(attemptId, principal, profile.model_id, requestSignal);
      requestSignal.throwIfAborted();
      const uploadMethod = snapshotUploadMethod(this.#createChatClient(attemptId));
      let uploadInvoked = false;
      try {
        const receipt = await uploadOwnerGrokImageReference({
          profile_set: this.#profileSet, profile_id: profile.profile_id, store: this.#referenceStore,
          binding: this.#binding, attemptId, linkService: this.#linkService,
          client: Object.freeze({ uploadFileReferences: (
            upload: Parameters<SyntxChatHttpClient["uploadFileReferences"]>[0], uploadSignal?: AbortSignal
          ) => {
            uploadInvoked = true;
            return uploadMethod(upload, uploadSignal ?? requestSignal);
          } }),
          content_base64: request.content_base64, filename: image.filename, mime_type: image.mime_type, signal: requestSignal
        });
        await this.#assertPrincipal(attemptId, principal);
        return receipt;
      } catch (error) {
        if (uploadInvoked && !(error instanceof OwnerMediaReferenceStoreError && error.code === "REFERENCE_UPLOAD_REJECTED")) {
          this.#referenceStore.invalidateByPrincipal(principal);
          throw new OwnerMediaReferenceStoreError("REFERENCE_UPLOAD_OUTCOME_UNKNOWN");
        }
        if (error instanceof OwnerReferencePrincipalError) throw new OwnerGrokImageReferenceServiceError("PRINCIPAL_NOT_LINKED");
        if (error instanceof OwnerMediaReferenceStoreError) throw error;
        throw error;
      }
    });
  }

  async generate(input: OwnerGrokImageReferenceGenerateRequest, signal?: AbortSignal): Promise<OwnerGrokImageReferenceLifecycleResult> {
    const request = exactRecord(input, ["profile_id", "attemptId", "reference_handles", "parameters"]);
    const profile = getProfile(this.#profileSet, request.profile_id as string);
    const attemptId = safeAttempt(request.attemptId);
    const handles = snapshotHandles(request.reference_handles, profile.reference_bounds.maximum);
    try { validateOwnerGrokImageReferenceParameters(profile, request.parameters, handles.length); }
    catch { invalid("INVALID_REQUEST"); }
    return this.#run(attemptId, signal, async (requestSignal) => {
      const principal = await this.#resolvePrincipal(attemptId);
      let candidate;
      try {
        candidate = await prepareOwnerGrokImageReferenceRequest({
          profile_set: this.#profileSet, profile_id: profile.profile_id, store: this.#referenceStore,
          binding: this.#binding, attemptId, linkService: this.#linkService,
          reference_handles: handles, parameters: request.parameters
        });
      } catch (error) {
        if (error instanceof OwnerGrokImageReferencePrepareError) throw new OwnerGrokImageReferenceServiceError("REFERENCE_UNAVAILABLE");
        throw error;
      }
      const permit = createOwnerGrokImageReferenceOneShotPermit({
        candidate, profile_set: this.#profileSet, profile_id: profile.profile_id, principal, attemptId, now: this.#now
      });
      requestSignal.throwIfAborted();
      const client = this.#createChatClient(attemptId);
      const lifecycleInput: GenerateOwnerGrokImageReferenceInput = {
        profile_set: this.#profileSet, profile_id: profile.profile_id, candidate, permit,
        reference_handles: handles, binding: this.#binding, attemptId, linkService: this.#linkService,
        referenceStore: this.#referenceStore,
        resolveAuthPrincipal: (id) => this.#resolvePrincipal(id),
        preflight: this.#preflight, client, signal: requestSignal
      };
      return this.#lifecycle.generate(lifecycleInput);
    });
  }

  async reconcile(input: OwnerGrokImageReferenceReconcileRequest, signal?: AbortSignal): Promise<OwnerGrokImageReferenceLifecycleResult> {
    const request = exactRecord(input, ["profile_id", "attemptId", "recovery_id"]);
    const profile = getProfile(this.#profileSet, request.profile_id as string);
    const attemptId = safeAttempt(request.attemptId);
    if (typeof request.recovery_id !== "string" || !RECOVERY_PATTERN.test(request.recovery_id)) invalid("INVALID_REQUEST");
    return this.#run(attemptId, signal, async (requestSignal) => {
      await this.#resolvePrincipal(attemptId);
      const client = this.#createChatClient(attemptId);
      const lifecycleInput: ReconcileOwnerGrokImageReferenceInput = {
        profile_set: this.#profileSet, profile_id: profile.profile_id, attemptId,
        recovery_id: request.recovery_id as string, binding: this.#binding, linkService: this.#linkService,
        resolveAuthPrincipal: (id) => this.#resolvePrincipal(id), client, signal: requestSignal
      };
      return this.#lifecycle.reconcile(lifecycleInput);
    });
  }

  async listRecoveries(input: OwnerGrokImageReferenceRecoveryListRequest): Promise<readonly OwnerGrokImageReferenceRecoveryListItem[]> {
    const request = exactRecord(input, ["profile_id", "attemptId", "limit"]);
    const profile = getProfile(this.#profileSet, request.profile_id as string);
    const attemptId = safeAttempt(request.attemptId);
    if (!Number.isSafeInteger(request.limit) || (request.limit as number) < 1 || (request.limit as number) > 20) invalid("INVALID_REQUEST");
    const principal = await this.#resolvePrincipal(attemptId);
    const lifecycleRequest: ListOwnerGrokImageReferenceRecoveriesInput = {
      profile_set: this.#profileSet, profile_id: profile.profile_id, attemptId, principal, limit: request.limit as number
    };
    const recoveries = await this.#lifecycle.listRecoveries(lifecycleRequest);
    return Object.freeze(recoveries.filter((item) => item.profile_id === profile.profile_id));
  }

  async invalidateAttempt(attemptIdInput: string): Promise<void> {
    if (typeof attemptIdInput !== "string" || !ATTEMPT_PATTERN.test(attemptIdInput)) return;
    for (const controller of this.#controllers.get(attemptIdInput) ?? []) controller.abort();
    await Promise.allSettled([...(this.#pendingByAttempt.get(attemptIdInput) ?? [])]);
    await this.#lifecycle.invalidateAttempt(attemptIdInput);
    let principal = this.#principals.get(attemptIdInput)?.principal;
    if (!principal) {
      try { principal = await this.#resolvePrincipal(attemptIdInput); } catch { /* Revoked links do not disclose a principal. */ }
    }
    if (principal) this.#referenceStore.invalidateByPrincipal(principal);
    this.#principals.delete(attemptIdInput);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    this.#closing = (async () => {
      for (const controllers of this.#controllers.values()) for (const controller of controllers) controller.abort();
      await Promise.allSettled([...this.#pending]);
      await this.#lifecycle.close();
      this.#referenceStore.close();
      this.#controllers.clear(); this.#pendingByAttempt.clear(); this.#principals.clear();
    })();
    return this.#closing;
  }

  async #resolvePrincipal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    if (this.#closed) throw new OwnerGrokImageReferenceServiceError("SERVICE_CLOSED");
    try {
      const principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
      if (!this.#principals.has(attemptId) && this.#principals.size >= MAX_PRINCIPALS) {
        for (const [id, entry] of this.#principals) if (entry.expiresAt <= this.#now()) this.#principals.delete(id);
        if (this.#principals.size >= MAX_PRINCIPALS) throw new OwnerGrokImageReferenceServiceError("SERVICE_BUSY");
      }
      const now = this.#now();
      if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - PRINCIPAL_TTL_MS) invalid("SERVICE_CLOSED");
      this.#principals.set(attemptId, Object.freeze({ principal, expiresAt: now + PRINCIPAL_TTL_MS }));
      return principal;
    } catch (error) {
      if (error instanceof OwnerGrokImageReferenceServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) throw new OwnerGrokImageReferenceServiceError("PRINCIPAL_NOT_LINKED");
      throw new OwnerGrokImageReferenceServiceError("PRINCIPAL_NOT_LINKED");
    }
  }

  async #assertPrincipal(attemptId: string, expected: Readonly<GenerationPrincipalRef>): Promise<void> {
    const current = await this.#resolvePrincipal(attemptId);
    if (!sameGenerationPrincipal(current, expected)) throw new OwnerGrokImageReferenceServiceError("PRINCIPAL_NOT_LINKED");
  }

  async #runUploadPreflight(attemptId: string, principal: Readonly<GenerationPrincipalRef>, modelId: string, signal: AbortSignal): Promise<void> {
    try {
      signal.throwIfAborted();
      await this.#preflight.verifyFreshSubscription(attemptId, principal, modelId, signal);
      await this.#preflight.verifyModelAccess(attemptId, principal, modelId, signal);
      await this.#assertPrincipal(attemptId, principal);
      signal.throwIfAborted();
    } catch (error) {
      if (error instanceof OwnerGrokImageReferenceServiceError) throw error;
      if (signal.aborted) signal.throwIfAborted();
      throw new OwnerGrokImageReferenceServiceError("PREFLIGHT_FAILED");
    }
  }

  #run<T>(attemptId: string, externalSignal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new OwnerGrokImageReferenceServiceError("SERVICE_CLOSED"));
    if (externalSignal !== undefined && (!(externalSignal instanceof AbortSignal) || types.isProxy(externalSignal))) {
      return Promise.reject(new OwnerGrokImageReferenceServiceError("INVALID_REQUEST"));
    }
    if (this.#pending.size >= MAX_PENDING) return Promise.reject(new OwnerGrokImageReferenceServiceError("SERVICE_BUSY"));
    const controller = new AbortController();
    const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
    const controllers = this.#controllers.get(attemptId) ?? new Set<AbortController>();
    controllers.add(controller); this.#controllers.set(attemptId, controllers);
    const promise = Promise.resolve().then(() => operation(signal)).finally(() => {
      controllers.delete(controller);
      if (controllers.size === 0) this.#controllers.delete(attemptId);
      const pending = this.#pendingByAttempt.get(attemptId);
      pending?.delete(promise);
      if (pending?.size === 0) this.#pendingByAttempt.delete(attemptId);
      this.#pending.delete(promise);
    });
    this.#pending.add(promise);
    const pendingByAttempt = this.#pendingByAttempt.get(attemptId) ?? new Set<Promise<unknown>>();
    pendingByAttempt.add(promise); this.#pendingByAttempt.set(attemptId, pendingByAttempt);
    return promise;
  }
}

function getProfile(set: unknown, profileId: string): OwnerGrokImageReferenceProfile {
  if (typeof profileId !== "string") invalid("PROFILE_INVALID");
  try { return getOwnerGrokImageReferenceProfile(set, profileId); }
  catch { invalid("PROFILE_INVALID"); }
}

function snapshotHandles(value: unknown, maximum: number): readonly string[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) invalid("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : undefined;
  if (!Number.isSafeInteger(length) || length < 1 || length > maximum || keys.length !== length + 1 ||
      keys.some((key) => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length))) invalid("INVALID_REQUEST");
  const handles: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string" || !HANDLE_PATTERN.test(descriptor.value) || handles.includes(descriptor.value)) invalid("INVALID_REQUEST");
    handles.push(descriptor.value);
  }
  return Object.freeze(handles);
}

function safeAttempt(value: unknown): string {
  if (typeof value !== "string" || !ATTEMPT_PATTERN.test(value)) invalid("INVALID_REQUEST");
  return value;
}

function snapshotBinding(value: unknown): AuthBinding {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || typeof fields.subject !== "string") invalid("INVALID_REQUEST");
  try {
    const principal = snapshotGenerationPrincipal({ tenant_id: fields.tenant_id, subject_id: fields.subject, connection_id: "link_owner_grok_binding_snapshot_01" });
    return Object.freeze({ tenant_id: principal.tenant_id, subject: principal.subject_id });
  } catch { invalid("INVALID_REQUEST"); }
}

function snapshotLinkService(value: unknown): Pick<PerUserLinkService, "getStatus"> {
  if (!value || typeof value !== "object" || types.isProxy(value)) invalid("INVALID_REQUEST");
  const method = findMethod(value, "getStatus");
  if (typeof method !== "function") invalid("INVALID_REQUEST");
  return Object.freeze({ getStatus: (binding, attemptId) => Reflect.apply(method, value, [binding, attemptId]) as ReturnType<PerUserLinkService["getStatus"]> });
}

function snapshotPreflight(value: unknown): OwnerGrokImageReferenceLifecyclePreflight {
  const fields = exactRecord(value, ["verifyFreshSubscription", "verifyModelAccess", "authorizeCost"]);
  if (Object.values(fields).some((entry) => typeof entry !== "function" || types.isProxy(entry))) invalid("INVALID_REQUEST");
  return Object.freeze({
    ...(fields.now === undefined ? {} : { now: fields.now as () => number }),
    verifyFreshSubscription: fields.verifyFreshSubscription as OwnerGrokImageReferenceLifecyclePreflight["verifyFreshSubscription"],
    verifyModelAccess: fields.verifyModelAccess as OwnerGrokImageReferenceLifecyclePreflight["verifyModelAccess"],
    authorizeCost: fields.authorizeCost as OwnerGrokImageReferenceLifecyclePreflight["authorizeCost"]
  });
}

function snapshotLifecycleOptions(value: unknown): OwnerGrokImageReferenceLifecycleOptions {
  if (value === undefined) return {};
  const fields = exactRecord(value, ["now", "timeoutMs", "pollDelayMs", "maxPollAttempts", "wait"], []);
  for (const key of ["now", "wait"] as const) {
    if (fields[key] !== undefined && (typeof fields[key] !== "function" || types.isProxy(fields[key]))) invalid("INVALID_REQUEST");
  }
  return Object.freeze({
    ...(fields.timeoutMs === undefined ? {} : { timeoutMs: fields.timeoutMs as number }),
    ...(fields.pollDelayMs === undefined ? {} : { pollDelayMs: fields.pollDelayMs as number }),
    ...(fields.maxPollAttempts === undefined ? {} : { maxPollAttempts: fields.maxPollAttempts as number }),
    ...(fields.wait === undefined ? {} : { wait: fields.wait as NonNullable<OwnerGrokImageReferenceLifecycleOptions["wait"]> })
  });
}

function snapshotUploadMethod(value: unknown): SyntxChatHttpClient["uploadFileReferences"] {
  if (!value || typeof value !== "object" || types.isProxy(value)) invalid("INVALID_REQUEST");
  const method = findMethod(value, "uploadFileReferences");
  if (typeof method !== "function") invalid("INVALID_REQUEST");
  return method.bind(value) as SyntxChatHttpClient["uploadFileReferences"];
}

function exactRecord(value: unknown, allowed: readonly string[], required: readonly string[] = allowed): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!)) ||
      required.some((key) => !Object.hasOwn(descriptors, key))) invalid("INVALID_REQUEST");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function findMethod(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  let current: object | null = value;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function invalid(code: OwnerGrokImageReferenceServiceErrorCode): never {
  throw new OwnerGrokImageReferenceServiceError(code);
}
