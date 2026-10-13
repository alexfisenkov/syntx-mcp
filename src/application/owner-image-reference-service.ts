import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationContractCatalogPort } from "../adapter/syntx/generation-contract-executor.js";
import { GenerationContractExecutorV2 } from "../adapter/syntx/generation-contract-executor-v2.js";
import type { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { DiscoveryCatalogRepository, type DiscoveryModelRecord } from "../catalog/discovery-catalog.js";
import { generationContractRegistryV2Schema } from "../domain/generation-contract-v2.js";
import type { OwnerImageReferenceDispatchClient, OwnerContractMediaReadClient, OwnerContractMediaResult, OwnerImageReferenceLifecyclePreflight, OwnerContractMediaContractContext, OwnerContractMediaService as OwnerContractMediaLifecycle } from "./owner-contract-media.js";
import { OwnerContractMediaError, OwnerContractMediaService } from "./owner-contract-media.js";
import { OwnerContractMediaRecoveryStore } from "./owner-contract-media-recovery.js";
import { OwnerMediaReferenceStore, OwnerMediaReferenceStoreError, type OwnerMediaReferencePublicReceipt } from "./owner-media-reference-store.js";
import { createOwnerImageReferenceOneShotPermit } from "./owner-image-reference-one-shot-policy.js";
import { prepareOwnerImageReferenceRequest } from "./owner-image-reference-request-preparer.js";
import { uploadOwnerImageReference } from "./owner-image-reference-upload-service.js";
import { getOwnerImageReferenceCandidateStoreBinding } from "./owner-image-reference-request-preparer.js";
import { OwnerImageReferenceInputError, validateOwnerImageReferenceInput } from "./owner-image-reference-input-validator.js";
import type { GenerationContractRegistryV2 } from "../domain/generation-contract-v2.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { types } from "node:util";

const REGISTRY_VERSION = "sha256-0e5b7a6ab56a4fc5103c025690293297b49258c1c876d7a0a663ff7959099d39.json";
const BASE_VARIANT = "banana21-image-1k-minimal-square";
const SAFE_ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SAFE_HANDLE = /^reference_[0-9a-f-]{36}$/u;
const SAFE_RECOVERY = /^recovery_[0-9a-f-]{36}$/u;
const PROMPT_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const MAX_LOCAL_PRINCIPAL_BINDINGS = 128;
const REFERENCE_TTL_MS = 15 * 60_000;
const MAX_PENDING_OPERATIONS = 8;

export type OwnerImageReferenceDispatchAndUploadClient = OwnerImageReferenceDispatchClient & Pick<SyntxChatHttpClient, "uploadFileReferences">;

export interface OwnerImageReferenceServiceOptions {
  readonly binding: AuthBinding;
  readonly registry: GenerationContractRegistryV2;
  readonly catalog: DiscoveryCatalogRepository;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly referenceStore?: OwnerMediaReferenceStore;
  readonly createChatClient: (attemptId: string) => OwnerImageReferenceDispatchAndUploadClient;
  readonly createReadClient: (attemptId: string) => OwnerContractMediaReadClient;
  readonly preflightFactory: (
    attemptId: string,
    principal: GenerationPrincipalRef,
    candidate: Parameters<OwnerContractMediaLifecycle["generateImageReferenceCandidate"]>[0]["candidate"]
  ) => OwnerImageReferenceLifecyclePreflight;
  readonly now?: () => number;
}

export interface OwnerImageReferenceUploadRequest {
  readonly link_attempt_id: string;
  readonly content_base64: string;
  readonly filename: string;
  readonly mime_type: string;
}

export interface OwnerImageReferenceGenerateRequest {
  readonly link_attempt_id: string;
  readonly reference_handle: string;
  readonly prompt: string;
}

export interface OwnerImageReferenceRecoveryRequest {
  readonly link_attempt_id: string;
  readonly recovery_id: string;
}

export interface OwnerImageReferenceServicePort {
  upload(input: OwnerImageReferenceUploadRequest, signal?: AbortSignal): Promise<OwnerImageReferenceUploadResult>;
  generate(input: OwnerImageReferenceGenerateRequest, signal?: AbortSignal): Promise<OwnerImageReferenceGenerateResult>;
  reconcile(input: OwnerImageReferenceRecoveryRequest, signal?: AbortSignal): Promise<OwnerImageReferenceGenerateResult>;
  listRecoveries(input: { readonly link_attempt_id: string; readonly limit: number }): Promise<OwnerImageReferenceRecoveryListResult>;
  invalidateAttempt(attemptId: string): Promise<void>;
  close(): Promise<void>;
}

export interface OwnerImageReferenceEvidence {
  readonly confidence_scope: "root126_exact_owner_reference_path";
  readonly backend_acceptance: "one_observed_png_reference_on_exact_tuple";
  readonly profile: Readonly<{ model_id: "banana-2.1"; variant_id: typeof BASE_VARIANT; image_size: "1K"; thinking_level: "minimal"; aspect_ratio: "1:1"; n: 1 }>;
  readonly limits: readonly [
    "Only one PNG input MIME was exercised live; JPEG and WebP are locally validated upload formats, not live-verified generation-reference formats.",
    "This does not establish visual similarity, causal reference strength, multiple-reference behavior, masks, URL retention, or restart-safe recovery."
  ];
}

export interface OwnerImageReferenceUploadResult extends OwnerMediaReferencePublicReceipt {
  readonly image: Readonly<{ mime_type: "image/jpeg" | "image/png" | "image/webp"; width: number; height: number; sha256: string }>;
  readonly expires_in_seconds: 900;
  readonly confidence_scope: "input_bytes_sniffed_and_dimensions_checked";
}

export interface OwnerImageReferenceGenerateResult {
  readonly model_id: "banana-2.1";
  readonly operation_id: "generate-image";
  readonly variant_id: typeof BASE_VARIANT;
  readonly status: "result_observed";
  readonly confidence: OwnerImageReferenceEvidence;
  readonly artifacts: OwnerContractMediaResult["artifacts"];
}

export interface OwnerImageReferenceRecoveryListResult {
  readonly recoveries: readonly Readonly<{ recovery_id: string; model_id: "banana-2.1"; operation_id: "generate-image"; created_at: string; variant_id: typeof BASE_VARIANT }>[];
  readonly confidence_scope: "process_local_get_only_recovery";
  readonly expires_in_seconds: 900;
}

/** Default-off, process-local owner reference workflow. It never exposes the stored URL. */
export class OwnerImageReferenceService implements OwnerImageReferenceServicePort {
  readonly #binding: AuthBinding;
  readonly #registry: GenerationContractRegistryV2;
  readonly #catalog: GenerationContractCatalogPort;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #referenceStore: OwnerMediaReferenceStore;
  readonly #recoveryStore: OwnerContractMediaRecoveryStore;
  readonly #lifecycle: OwnerContractMediaService;
  readonly #createChatClient: OwnerImageReferenceServiceOptions["createChatClient"];
  readonly #createReadClient: OwnerImageReferenceServiceOptions["createReadClient"];
  readonly #preflightFactory: OwnerImageReferenceServiceOptions["preflightFactory"];
  readonly #now: () => number;
  readonly #controllers = new Map<string, Set<AbortController>>();
  readonly #principals = new Map<string, Readonly<{ principal: Readonly<GenerationPrincipalRef>; expiresAt: number }>>();
  readonly #pending = new Set<Promise<unknown>>();
  readonly #pendingByAttempt = new Map<string, Set<Promise<unknown>>>();
  readonly #recoveryIdsByAttempt = new Map<string, Set<string>>();
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(options: OwnerImageReferenceServiceOptions) {
    const input = snapshotOptions(options);
    this.#binding = input.binding;
    this.#registry = input.registry;
    this.#catalog = input.catalog;
    this.#linkService = input.linkService;
    this.#referenceStore = input.referenceStore ?? new OwnerMediaReferenceStore({ now: input.now });
    this.#now = input.now;
    this.#createChatClient = input.createChatClient;
    this.#createReadClient = input.createReadClient;
    this.#preflightFactory = input.preflightFactory;
    this.#recoveryStore = new OwnerContractMediaRecoveryStore({ now: this.#now });
    this.#lifecycle = new OwnerContractMediaService({ recoveryStore: this.#recoveryStore, now: this.#now });
  }

  async upload(input: OwnerImageReferenceUploadRequest, signal?: AbortSignal): Promise<OwnerImageReferenceUploadResult> {
    const request = exactRequest(input, ["link_attempt_id", "content_base64", "filename", "mime_type"]);
    const attempt = safeAttempt(request.link_attempt_id);
    return this.#run(attempt, signal, async (requestSignal) => {
      const principal = await this.#resolvePrincipal(attempt);
      const image = validateOwnerImageReferenceInput({
        content_base64: request.content_base64, filename: request.filename, mime_type: request.mime_type
      });
      requestSignal.throwIfAborted();
      let uploadInvoked = false;
      const client = this.#createChatClient(attempt);
      const uploadClient = Object.freeze({
        uploadFileReferences: (upload: Parameters<SyntxChatHttpClient["uploadFileReferences"]>[0]) => {
          uploadInvoked = true;
          return client.uploadFileReferences(upload, requestSignal);
        }
      });
      try {
        const receipt = await uploadOwnerImageReference({
          registry: this.#registry,
          catalog: this.#catalog,
          store: this.#referenceStore,
          binding: this.#binding,
          attemptId: attempt,
          linkService: this.#linkService,
          client: uploadClient,
          filename: image.filename,
          mime_type: image.mime_type,
          bytes: image.bytes
        });
        requestSignal.throwIfAborted();
        await this.#assertPrincipal(attempt, principal);
        return Object.freeze({
          ...receipt,
          image: Object.freeze({ mime_type: image.mime_type, width: image.width, height: image.height, sha256: image.sha256 }),
          expires_in_seconds: 900 as const,
          confidence_scope: "input_bytes_sniffed_and_dimensions_checked" as const
        });
      } catch (error) {
        if (uploadInvoked && !(error instanceof OwnerMediaReferenceStoreError && error.code === "REFERENCE_UPLOAD_REJECTED")) {
          throw new OwnerMediaReferenceStoreError("REFERENCE_UPLOAD_OUTCOME_UNKNOWN");
        }
        throw error;
      }
    });
  }

  async generate(input: OwnerImageReferenceGenerateRequest, signal?: AbortSignal): Promise<OwnerImageReferenceGenerateResult> {
    const request = exactRequest(input, ["link_attempt_id", "reference_handle", "prompt"]);
    const attempt = safeAttempt(request.link_attempt_id);
    const referenceHandle = request.reference_handle;
    const prompt = request.prompt;
    if (typeof referenceHandle !== "string" || !SAFE_HANDLE.test(referenceHandle) ||
        typeof prompt !== "string" || prompt.trim().length < 1 || prompt.length > 4096 || PROMPT_CONTROLS.test(prompt)) invalid();
    return this.#run(attempt, signal, async (requestSignal) => {
      const principal = await this.#resolvePrincipal(attempt);
      const candidate = await prepareOwnerImageReferenceRequest({
        registry: this.#registry,
        catalog: this.#catalog,
        store: this.#referenceStore,
        binding: this.#binding,
        attemptId: attempt,
        linkService: this.#linkService,
        reference_handle: referenceHandle,
        parameters: { prompt: prompt.trim() }
      });
      const permit = createOwnerImageReferenceOneShotPermit({
        candidate, registry: this.#registry, catalog: this.#catalog, principal, attemptId: attempt, now: this.#now
      });
      const contract = this.#baseContract();
      const preflight = this.#preflightFactory(attempt, principal, candidate);
      requestSignal.throwIfAborted();
      try {
        const result = await this.#lifecycle.generateImageReferenceCandidate({
          client: this.#createChatClient(attempt),
          attemptId: attempt,
          contract,
          candidate,
          permit,
          resolveAuthPrincipal: (attemptId) => this.#resolvePrincipal(attemptId),
          preflight,
          binding: this.#binding,
          linkService: this.#linkService,
          referenceStore: this.#referenceStore,
          referenceHandle,
          signal: requestSignal
        });
        return resultFor(result);
      } catch (error) {
        if (error instanceof OwnerContractMediaError && error.code === "OUTCOME_UNKNOWN" && error.recoveryId) {
          this.#rememberRecovery(attempt, error.recoveryId);
        }
        throw error;
      }
    });
  }

  async reconcile(input: OwnerImageReferenceRecoveryRequest, signal?: AbortSignal): Promise<OwnerImageReferenceGenerateResult> {
    const request = exactRequest(input, ["link_attempt_id", "recovery_id"]);
    const attempt = safeAttempt(request.link_attempt_id);
    const recoveryId = request.recovery_id;
    if (typeof recoveryId !== "string" || !SAFE_RECOVERY.test(recoveryId)) invalid();
    return this.#run(attempt, signal, async (requestSignal) => {
      const principal = await this.#resolvePrincipal(attempt);
      await this.#assertPrincipal(attempt, principal);
      const readClient = this.#createReadClient(attempt);
      const result = await this.#lifecycle.reconcile({
        client: readClient,
        attemptId: attempt,
        recoveryId,
        contract: this.#baseContract(),
        signal: requestSignal
      });
      return resultFor(result);
    });
  }

  async listRecoveries(input: { readonly link_attempt_id: string; readonly limit: number }): Promise<OwnerImageReferenceRecoveryListResult> {
    if (this.#closed) invalid();
    const request = exactRequest(input, ["link_attempt_id", "limit"]);
    const attempt = safeAttempt(request.link_attempt_id);
    if (!Number.isSafeInteger(request.limit) || (request.limit as number) < 1 || (request.limit as number) > 20) invalid();
    await this.#resolvePrincipal(attempt);
    const recoveries = this.#lifecycle.listRecoveries(attempt, request.limit as number)
      .filter((item) => item.model_id === "banana-2.1" && item.operation_id === "generate-image")
      .map((item) => Object.freeze({
        recovery_id: item.recovery_id,
        model_id: "banana-2.1" as const,
        operation_id: "generate-image" as const,
        created_at: item.created_at,
        variant_id: BASE_VARIANT as typeof BASE_VARIANT
      }));
    return Object.freeze({ recoveries: Object.freeze(recoveries), confidence_scope: "process_local_get_only_recovery", expires_in_seconds: 900 });
  }

  invalidateAttempt(attemptId: string): Promise<void> {
    if (!SAFE_ATTEMPT.test(attemptId)) return Promise.resolve();
    return this.#invalidate(attemptId);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    this.#closing = (async () => {
      for (const controllers of this.#controllers.values()) for (const controller of controllers) controller.abort();
      const attempts = new Set([...this.#controllers.keys(), ...this.#principals.keys(), ...this.#recoveryIdsByAttempt.keys()]);
      await Promise.all([...attempts].map((attempt) => this.#invalidate(attempt)));
      await Promise.allSettled([...this.#pending]);
      this.#referenceStore.close();
      this.#recoveryStore.close();
      this.#controllers.clear();
      this.#principals.clear();
    })();
    return this.#closing;
  }

  async #resolvePrincipal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    if (this.#closed) invalid();
    this.#prunePrincipals();
    const principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
    if (!this.#principals.has(attemptId) && this.#principals.size >= MAX_LOCAL_PRINCIPAL_BINDINGS) {
      throw new OwnerImageReferenceServiceError("REFERENCE_UNAVAILABLE");
    }
    const now = this.#now();
    if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - REFERENCE_TTL_MS) {
      throw new OwnerImageReferenceServiceError("REFERENCE_UNAVAILABLE");
    }
    this.#principals.set(attemptId, Object.freeze({ principal, expiresAt: now + REFERENCE_TTL_MS }));
    return principal;
  }

  async #assertPrincipal(attemptId: string, expected: Readonly<GenerationPrincipalRef>): Promise<void> {
    const current = await this.#resolvePrincipal(attemptId);
    if (current.tenant_id !== expected.tenant_id || current.subject_id !== expected.subject_id || current.connection_id !== expected.connection_id) invalid();
  }

  async #invalidate(attemptId: string): Promise<void> {
    const controllers = this.#controllers.get(attemptId);
    if (controllers) for (const controller of controllers) controller.abort();
    await Promise.allSettled([...(this.#pendingByAttempt.get(attemptId) ?? [])]);
    let principal = this.#principals.get(attemptId)?.principal;
    if (!principal) {
      try { principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService }); }
      catch { /* A revoked link cannot resolve; no private principal is inferred from the attempt id. */ }
    }
    if (principal) this.#referenceStore.invalidateByPrincipal(principal);
    for (const recoveryId of this.#recoveryIdsByAttempt.get(attemptId) ?? []) this.#recoveryStore.remove(recoveryId, attemptId);
    for (const recovery of this.#lifecycle.listRecoveries(attemptId, 20)) this.#recoveryStore.remove(recovery.recovery_id, attemptId);
    this.#recoveryIdsByAttempt.delete(attemptId);
    this.#principals.delete(attemptId);
  }

  #rememberRecovery(attemptId: string, recoveryId: string): void {
    const ids = this.#recoveryIdsByAttempt.get(attemptId) ?? new Set<string>();
    ids.add(recoveryId);
    this.#recoveryIdsByAttempt.set(attemptId, ids);
  }

  #prunePrincipals(): void {
    const now = this.#now();
    if (!Number.isFinite(now)) return;
    for (const [attemptId, entry] of this.#principals) {
      if (entry.expiresAt <= now) this.#principals.delete(attemptId);
    }
  }

  #run<T>(attempt: string, externalSignal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new OwnerImageReferenceServiceError("SERVICE_CLOSED"));
    if (this.#pending.size >= MAX_PENDING_OPERATIONS) return Promise.reject(new OwnerImageReferenceServiceError("SERVICE_BUSY"));
    const controller = new AbortController();
    const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
    const set = this.#controllers.get(attempt) ?? new Set<AbortController>();
    set.add(controller);
    this.#controllers.set(attempt, set);
    const promise = Promise.resolve().then(() => operation(signal)).finally(() => {
      set.delete(controller);
      if (set.size === 0) this.#controllers.delete(attempt);
      const byAttempt = this.#pendingByAttempt.get(attempt);
      byAttempt?.delete(promise);
      if (byAttempt?.size === 0) this.#pendingByAttempt.delete(attempt);
    });
    this.#pending.add(promise);
    const byAttempt = this.#pendingByAttempt.get(attempt) ?? new Set<Promise<unknown>>();
    byAttempt.add(promise);
    this.#pendingByAttempt.set(attempt, byAttempt);
    void promise.finally(() => this.#pending.delete(promise)).catch(() => undefined);
    return promise;
  }

  #baseContract(): OwnerContractMediaContractContext {
    const contract = new GenerationContractExecutorV2(this.#registry, this.#catalog)
      .getContract("banana-2.1", "generate-image", BASE_VARIANT);
    if (!contract || contract.status !== "live_verified" || contract.schema_hash !== "sha256:7f413ab9269b958508ccfaeb07bd05cab03f90e6f0ff809d447139aac0296e5d" ||
        contract.output.mime_types.length !== 1 || contract.output.mime_types[0] !== "image/jpeg") invalid();
    return Object.freeze({
      model_id: contract.model_id,
      operation_id: "generate-image",
      modality: "image",
      ai_name: contract.ai_name,
      model_type: contract.model_type,
      variant_id: contract.variant_id,
      schema_hash: contract.schema_hash,
      status: "live_verified",
      mime_types: Object.freeze(["image/jpeg"]),
      registry_version: REGISTRY_VERSION,
      catalog_version: this.#registry.catalog_version
    });
  }
}

export class OwnerImageReferenceServiceError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "REFERENCE_UNAVAILABLE" | "OUTCOME_UNKNOWN") {
    super("The owner image-reference operation is unavailable or could not be completed safely.");
    this.name = "OwnerImageReferenceServiceError";
  }
}

function snapshotOptions(options: OwnerImageReferenceServiceOptions) {
  const fields = readDataRecord(options, ["binding", "registry", "catalog", "linkService", "referenceStore", "createChatClient", "createReadClient", "preflightFactory", "now"],
    ["binding", "registry", "catalog", "linkService", "createChatClient", "createReadClient", "preflightFactory"]);
  if (typeof fields.createChatClient !== "function" || typeof fields.createReadClient !== "function" ||
      typeof fields.preflightFactory !== "function" || (fields.now !== undefined && typeof fields.now !== "function") ||
      (fields.referenceStore !== undefined && (!(fields.referenceStore instanceof OwnerMediaReferenceStore) || types.isProxy(fields.referenceStore)))) invalid();
  const bindingFields = readDataRecord(fields.binding, ["tenant_id", "subject"], ["tenant_id", "subject"]);
  if (typeof bindingFields.tenant_id !== "string" || typeof bindingFields.subject !== "string") invalid();
  let binding: AuthBinding;
  try {
    const principal = snapshotGenerationPrincipal({
      tenant_id: bindingFields.tenant_id,
      subject_id: bindingFields.subject,
      connection_id: "link_owner_reference_binding_snapshot_01"
    });
    binding = Object.freeze({ tenant_id: principal.tenant_id, subject: principal.subject_id });
  } catch { return invalid(); }

  let registry: GenerationContractRegistryV2;
  try { registry = freezeTree(generationContractRegistryV2Schema.parse(fields.registry)); }
  catch { return invalid(); }
  if (registry.registry_sha256 !== "sha256:2f8cf81a41efece59008a919924975cbd2e379569784565b7643f2a225a017fd") invalid();

  const sourceCatalog = fields.catalog;
  if (!(sourceCatalog instanceof DiscoveryCatalogRepository) || types.isProxy(sourceCatalog) ||
      Object.getPrototypeOf(sourceCatalog) !== DiscoveryCatalogRepository.prototype || Object.hasOwn(sourceCatalog, "getModel")) invalid();
  let bananaModel: DiscoveryModelRecord;
  try { bananaModel = freezeTree(sourceCatalog.getModel("banana-2.1")); }
  catch { return invalid(); }
  const catalog: GenerationContractCatalogPort = Object.freeze({
    getModel(modelId: string) {
      if (modelId !== "banana-2.1") invalid();
      return bananaModel;
    }
  });
  try {
    getOwnerImageReferenceCandidateStoreBinding(registry, catalog);
    const base = new GenerationContractExecutorV2(registry, catalog).getContract("banana-2.1", "generate-image", BASE_VARIANT);
    if (!base || base.status !== "live_verified" || base.schema_hash !== "sha256:7f413ab9269b958508ccfaeb07bd05cab03f90e6f0ff809d447139aac0296e5d") invalid();
  } catch { return invalid(); }

  const linkSource = fields.linkService;
  if (!linkSource || typeof linkSource !== "object" || types.isProxy(linkSource)) invalid();
  const getStatus = findDataMethod(linkSource, "getStatus");
  if (typeof getStatus !== "function") invalid();
  const linkService: Pick<PerUserLinkService, "getStatus"> = Object.freeze({
    getStatus: (ownerBinding, attemptId) => Reflect.apply(getStatus, linkSource, [ownerBinding, attemptId]) as ReturnType<PerUserLinkService["getStatus"]>
  });

  return {
    binding,
    registry,
    catalog,
    linkService,
    ...(fields.referenceStore === undefined ? {} : { referenceStore: fields.referenceStore as OwnerMediaReferenceStore }),
    createChatClient: fields.createChatClient as OwnerImageReferenceServiceOptions["createChatClient"],
    createReadClient: fields.createReadClient as OwnerImageReferenceServiceOptions["createReadClient"],
    preflightFactory: fields.preflightFactory as OwnerImageReferenceServiceOptions["preflightFactory"],
    now: fields.now as (() => number) | undefined ?? Date.now
  };
}

function readDataRecord(value: unknown, allowedKeys: readonly string[], requiredKeys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key) || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) ||
      requiredKeys.some((key) => !Object.hasOwn(descriptors, key))) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function findDataMethod(target: object, name: string): unknown {
  let current: object | null = target;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, name);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function freezeTree<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) freezeTree((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}

function exactRequest(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!))) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function safeAttempt(value: unknown): string {
  if (typeof value !== "string" || !SAFE_ATTEMPT.test(value)) invalid();
  return value;
}

function resultFor(result: OwnerContractMediaResult): OwnerImageReferenceGenerateResult {
  if (result.model_id !== "banana-2.1" || result.operation_id !== "generate-image" || result.modality !== "image" || result.artifacts.length !== 1 ||
      result.artifacts[0]?.mime_type !== "image/jpeg") throw new OwnerImageReferenceServiceError("OUTCOME_UNKNOWN");
  return Object.freeze({
    model_id: "banana-2.1",
    operation_id: "generate-image",
    variant_id: BASE_VARIANT,
    status: "result_observed",
    confidence: Object.freeze({
      confidence_scope: "root126_exact_owner_reference_path",
      backend_acceptance: "one_observed_png_reference_on_exact_tuple",
      profile: Object.freeze({ model_id: "banana-2.1", variant_id: BASE_VARIANT, image_size: "1K", thinking_level: "minimal", aspect_ratio: "1:1", n: 1 }),
      limits: Object.freeze([
        "Only one PNG input MIME was exercised live; JPEG and WebP are locally validated upload formats, not live-verified generation-reference formats.",
        "This does not establish visual similarity, causal reference strength, multiple-reference behavior, masks, URL retention, or restart-safe recovery."
      ] as const)
    }),
    artifacts: Object.freeze([...result.artifacts])
  });
}

function invalid(): never { throw new OwnerImageReferenceInputError("INVALID_IMAGE_INPUT"); }
