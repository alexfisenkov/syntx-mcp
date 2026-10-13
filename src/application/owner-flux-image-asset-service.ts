import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import { CivitaiPublicModelFileAttestor, CivitaiPublicModelFileAttestorError,
  snapshotCivitaiVerifiedModelFileWitness, type CivitaiVerifiedModelFileSnapshot } from "../adapter/civitai/public-model-file-attestor.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import {
  createOwnerFluxImageAssetBindingIssuer,
  type OwnerFluxAssetResolverContext,
  type OwnerFluxImageAssetSet,
  type OwnerFluxLoraRequest,
  type OwnerFluxLoraResolution,
  type ResolveOwnerFluxLora
} from "./owner-flux-image-request-preparer.js";
import { getOwnerFluxImageSourceProfile, type OwnerFluxImageCatalogPort, type OwnerFluxImageSourceProfile } from "./owner-flux-image-source-profile.js";
import { OWNER_FLUX_IMAGE_MODELS, type OwnerFluxImageModel } from "./owner-flux-image-parameters.js";
import { OwnerFluxImageUploadService } from "./owner-flux-image-upload-service.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const LORA_HANDLE = /^flux_lora_[0-9a-f-]{36}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const TTL_MS = 15 * 60_000;
const MAX_RECORDS = 128;
const MAX_ACTIVE_ATTEMPTS = 128;
const MAX_PENDING = 4;
const SOURCE_FIELDS = ["principal", "attempt_id", "model_id", "ai_name", "scope", "operation_id", "catalog_version", "profile_schema_hash"] as const;
const NATIVE_ATTEST = CivitaiPublicModelFileAttestor.prototype.attest;

export interface OwnerFluxImageAssetServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: OwnerFluxImageCatalogPort;
  readonly catalog_version: string;
  readonly uploadService: OwnerFluxImageUploadService;
  readonly loraAttestor: CivitaiPublicModelFileAttestor;
  readonly now?: () => number;
}
export interface OwnerFluxPublicLoraRegistrationInput {
  readonly attemptId: string;
  readonly model_id: "flux-1";
  readonly model_id_source?: number;
  readonly model_version_id: number;
  readonly file_id: number;
  readonly signal?: AbortSignal;
}
export interface OwnerFluxPublicLoraReceipt {
  readonly status: "verified";
  readonly reference_handle: string;
  readonly model_id: "flux-1";
  readonly source_model_id: number;
  readonly model_version_id: number;
  readonly file_id: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly expires_in_seconds: number;
  readonly content_confidence: "STREAMED_SHA256_AND_SAFETENSORS_STRUCTURE";
  readonly legal_approval: "NOT_ESTABLISHED";
  readonly license_compatibility: "UNPROVEN";
  readonly backend_acceptance: "UNPROVEN";
}
export interface OwnerFluxImageAssetIssueInput {
  readonly attemptId: string;
  readonly model_id: OwnerFluxImageModel;
  readonly image_reference_handle?: string;
  readonly lora_references: readonly OwnerFluxLoraRequest[];
}
export type OwnerFluxImageAssetServiceErrorCode =
  | "INVALID_REQUEST" | "MODEL_BINDING_MISMATCH" | "PRINCIPAL_NOT_LINKED" | "SOURCE_MISMATCH"
  | "ATTESTATION_FAILED" | "CAPACITY_EXCEEDED" | "SERVICE_BUSY" | "SERVICE_CLOSED"
  | "REQUEST_ABORTED" | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED" | "CLOCK_INVALID";
export class OwnerFluxImageAssetServiceError extends Error {
  constructor(readonly code: OwnerFluxImageAssetServiceErrorCode) {
    super("The owner Flux image asset is unavailable.");
    this.name = "OwnerFluxImageAssetServiceError";
  }
}

interface LoraRecord {
  readonly handle: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly sourceModelId: number;
  readonly modelVersionId: number;
  readonly fileId: number;
  readonly url: string;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly expiresAt: number;
  readonly catalogVersion: string;
  readonly profileSchemaHash: string;
  readonly epoch: number;
}
interface Pending {
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly removeParentAbort: () => void;
  readonly epoch: number;
  readonly reservesRecord: boolean;
}
interface IssuedAssetSet { readonly set: OwnerFluxImageAssetSet; readonly expiresAt: number; }

/** Joins actual owner-uploaded Flux images and actual attested public Civitai LoRAs into the nominal 623 issuer. */
export class OwnerFluxImageAssetService {
  readonly resolveLora: ResolveOwnerFluxLora;
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: OwnerFluxImageCatalogPort;
  readonly #catalogVersion: string;
  readonly #uploadService: OwnerFluxImageUploadService;
  readonly #loraAttestor: CivitaiPublicModelFileAttestor;
  readonly #profile: Readonly<OwnerFluxImageSourceProfile>;
  readonly #now: () => number;
  readonly #records = new Map<string, LoraRecord>();
  readonly #handlesByAttempt = new Map<string, Set<string>>();
  readonly #assetSetsByAttempt = new Map<string, Set<IssuedAssetSet>>();
  readonly #principalByAttempt = new Map<string, Readonly<GenerationPrincipalRef>>();
  readonly #pendingByAttempt = new Map<string, Set<Pending>>();
  readonly #invalidationsByAttempt = new Map<string, Promise<void>>();
  readonly #epochs = new Map<string, number>();
  readonly #allOperations = new Set<Promise<void>>();
  readonly #issuer: ReturnType<typeof createOwnerFluxImageAssetBindingIssuer>;
  #pendingCount = 0;
  #pendingRegistrations = 0;
  #closing: Promise<void> | undefined;
  #lastObservedNow: number | undefined;
  #closed = false;

  constructor(optionsInput: OwnerFluxImageAssetServiceOptions | unknown) {
    const fields = exactRecord(optionsInput, ["binding", "linkService", "catalog", "catalog_version", "uploadService", "loraAttestor"], ["now"]);
    if (fields.catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION || !isPlainObject(fields.linkService) ||
        !isPlainObject(fields.catalog) || !isExactUploadService(fields.uploadService) || !isExactAttestor(fields.loraAttestor) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("MODEL_BINDING_MISMATCH");
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = fields.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#catalog = fields.catalog as OwnerFluxImageCatalogPort;
    this.#catalogVersion = fields.catalog_version as string;
    this.#uploadService = fields.uploadService as OwnerFluxImageUploadService;
    this.#loraAttestor = fields.loraAttestor as CivitaiPublicModelFileAttestor;
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    try { this.#profile = getOwnerFluxImageSourceProfile("flux-1", this.#catalog, this.#catalogVersion); }
    catch { fail("MODEL_BINDING_MISMATCH"); }
    this.resolveLora = (context) => this.#resolveLora(context);
    try {
      this.#issuer = createOwnerFluxImageAssetBindingIssuer({ resolveImage: this.#uploadService.resolveImage,
        resolveLora: this.resolveLora }, { catalog: this.#catalog, catalog_version: this.#catalogVersion, now: this.#now });
    } catch { fail("MODEL_BINDING_MISMATCH"); }
    Object.freeze(this);
  }

  async registerPublicLora(inputInput: OwnerFluxPublicLoraRegistrationInput | unknown): Promise<OwnerFluxPublicLoraReceipt> {
    const input = snapshotRegistration(inputInput);
    this.#assertOpen(); this.#assertProfile();
    this.#prune(this.#readNow());
    this.#assertNotDuplicate(input.attemptId, input.model_version_id, input.file_id);
    const operation = this.#begin(input.attemptId, input.signal, true);
    let principal: Readonly<GenerationPrincipalRef> | undefined;
    try {
      const issuedAt = this.#readNow();
      if (issuedAt > Number.MAX_SAFE_INTEGER - TTL_MS) fail("CLOCK_INVALID");
      const expiresAt = issuedAt + TTL_MS;
      principal = await this.#resolvePrincipal(input.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation);
      if (!this.#rememberPrincipal(input.attemptId, principal)) {
        this.#invalidateAttemptState(input.attemptId); fail("PRINCIPAL_NOT_LINKED");
      }
      const epoch = operation.epoch;
      let witness: object;
      try { witness = await Reflect.apply(NATIVE_ATTEST, this.#loraAttestor, [{
        ...(input.model_id_source === undefined ? {} : { model_id: input.model_id_source }),
        model_version_id: input.model_version_id, file_id: input.file_id
      }, operation.controller.signal]); }
      catch (error) {
        if (operation.controller.signal.aborted) fail("REQUEST_ABORTED");
        if (error instanceof CivitaiPublicModelFileAttestorError && error.code === "REQUEST_ABORTED") fail("REQUEST_ABORTED");
        fail("ATTESTATION_FAILED");
      }
      this.#throwIfClosedOrAborted(operation);
      let snapshot: Readonly<CivitaiVerifiedModelFileSnapshot>;
      try { snapshot = snapshotCivitaiVerifiedModelFileWitness(witness); }
      catch { fail("ATTESTATION_FAILED"); }
      if (!isVerifiedSnapshot(snapshot, input) || expiresAt <= this.#readNow()) fail("ATTESTATION_FAILED");
      const current = await this.#resolvePrincipal(input.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation);
      this.#assertProfile();
      if (!sameGenerationPrincipal(principal, current) || !this.#rememberPrincipal(input.attemptId, current)) {
        this.#invalidateAttemptState(input.attemptId); fail("PRINCIPAL_NOT_LINKED");
      }
      if ((this.#epochs.get(input.attemptId) ?? 0) !== epoch || expiresAt <= this.#readNow()) fail("REQUEST_ABORTED");
      this.#prune(this.#readNow());
      if (this.#records.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      this.#assertNotDuplicate(input.attemptId, snapshot.model_version_id, snapshot.file_id);
      const handle = `flux_lora_${randomUUID()}`;
      if (!LORA_HANDLE.test(handle) || this.#records.has(handle)) fail("ATTESTATION_FAILED");
      const record: LoraRecord = Object.freeze({ handle, attemptId: input.attemptId, principal,
        sourceModelId: snapshot.model_id, modelVersionId: snapshot.model_version_id, fileId: snapshot.file_id,
        url: snapshot.canonical_download_url, size: snapshot.size, sha256: snapshot.sha256,
        expiresAt, catalogVersion: this.#profile.public_catalog_version, profileSchemaHash: this.#profile.profile_schema_hash, epoch });
      this.#records.set(handle, record);
      const handles = this.#handlesByAttempt.get(input.attemptId) ?? new Set<string>();
      handles.add(handle); this.#handlesByAttempt.set(input.attemptId, handles);
      return Object.freeze({ status: "verified", reference_handle: handle, model_id: "flux-1", source_model_id: record.sourceModelId,
        model_version_id: record.modelVersionId, file_id: record.fileId, size: record.size, sha256: record.sha256,
        expires_in_seconds: Math.max(0, Math.ceil((expiresAt - this.#readNow()) / 1000)),
        content_confidence: snapshot.content_confidence, legal_approval: "NOT_ESTABLISHED", license_compatibility: "UNPROVEN",
        backend_acceptance: "UNPROVEN" });
    } catch (error) {
      if (error instanceof OwnerFluxImageAssetServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) {
        this.#invalidateAttemptState(input.attemptId); fail("PRINCIPAL_NOT_LINKED");
      }
      fail("ATTESTATION_FAILED");
    } finally { this.#finish(input.attemptId, operation); }
  }

  async issueAssets(inputInput: OwnerFluxImageAssetIssueInput | unknown): Promise<OwnerFluxImageAssetSet> {
    const input = snapshotIssueInput(inputInput);
    this.#assertOpen(); this.#assertProfile();
    if (input.model_id !== "flux-1" && (input.image_reference_handle !== undefined || input.lora_references.length > 0)) fail("INVALID_REQUEST");
    const operation = this.#begin(input.attemptId);
    try {
      this.#prune(this.#readNow());
      const principal = await this.#resolvePrincipal(input.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation);
      if (!this.#rememberPrincipal(input.attemptId, principal)) { this.#invalidateAttemptState(input.attemptId); fail("PRINCIPAL_NOT_LINKED"); }
      const set = await this.#issuer.issue({ principal, attempt_id: input.attemptId, model_id: input.model_id,
        ...(input.image_reference_handle === undefined ? {} : { image_reference_handle: input.image_reference_handle }),
        lora_references: input.lora_references });
      this.#throwIfClosedOrAborted(operation);
      this.#assertProfile();
      const current = await this.#resolvePrincipal(input.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation);
      if (!sameGenerationPrincipal(principal, current) || !this.#rememberPrincipal(input.attemptId, current) ||
          (this.#epochs.get(input.attemptId) ?? 0) !== operation.epoch) {
        this.#invalidateAttemptState(input.attemptId); fail("PRINCIPAL_NOT_LINKED");
      }
      const activeSets = this.#assetSetsByAttempt.get(input.attemptId) ?? new Set<IssuedAssetSet>();
      activeSets.add(Object.freeze({ set, expiresAt: set.expires_at })); this.#assetSetsByAttempt.set(input.attemptId, activeSets);
      return set;
    } catch (error) {
      if (error instanceof OwnerFluxImageAssetServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) { this.#invalidateAttemptState(input.attemptId); fail("PRINCIPAL_NOT_LINKED"); }
      if (operation.controller.signal.aborted) fail("REQUEST_ABORTED");
      fail("REFERENCE_UNAVAILABLE");
    } finally { this.#finish(input.attemptId, operation); }
  }

  async invalidateAttempt(attemptIdInput: unknown): Promise<void> {
    if (typeof attemptIdInput !== "string" || !ATTEMPT.test(attemptIdInput)) return;
    if (this.#closed) return;
    const existing = this.#invalidationsByAttempt.get(attemptIdInput);
    if (existing) return await existing;
    this.#invalidateAttemptState(attemptIdInput);
    const pending = [...(this.#pendingByAttempt.get(attemptIdInput) ?? [])].map((entry) => entry.done);
    const invalidation = Promise.allSettled(pending).then(async () => {
      await this.#uploadService.invalidateAttempt(attemptIdInput);
      this.#maybeReleaseAttempt(attemptIdInput);
    }).finally(() => {
      if (this.#invalidationsByAttempt.get(attemptIdInput) === invalidation) this.#invalidationsByAttempt.delete(attemptIdInput);
    });
    this.#invalidationsByAttempt.set(attemptIdInput, invalidation);
    await invalidation;
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true; this.#issuer.close();
    for (const bucket of this.#pendingByAttempt.values()) for (const operation of bucket) operation.controller.abort();
    this.#records.clear(); this.#handlesByAttempt.clear(); this.#assetSetsByAttempt.clear(); this.#principalByAttempt.clear(); this.#epochs.clear();
    this.#closing = Promise.allSettled([...this.#allOperations]).then(async () => {
      await Promise.allSettled([...this.#invalidationsByAttempt.values()]);
      await this.#uploadService.close();
    });
    return this.#closing;
  }

  async #resolveLora(contextInput: OwnerFluxAssetResolverContext | unknown): Promise<OwnerFluxLoraResolution> {
    const context = snapshotResolverContext(contextInput);
    this.#assertOpen(); this.#assertProfile();
    if (context.model_id !== "flux-1" || context.ai_name !== "flux" || context.scope !== "image" ||
        context.operation_id !== "generate-image" || context.catalog_version !== this.#profile.public_catalog_version ||
        context.profile_schema_hash !== this.#profile.profile_schema_hash || context.principal.connection_id !== context.attempt_id) fail("MODEL_BINDING_MISMATCH");
    const operation = this.#begin(context.attempt_id, undefined, false, false);
    try {
      const record = this.#records.get(context.asset_handle);
      if (!record) fail("REFERENCE_UNAVAILABLE");
      if (record.expiresAt <= this.#readNow()) { this.#removeHandle(record.handle); fail("REFERENCE_EXPIRED"); }
      this.#prune(this.#readNow());
      const epoch = this.#epochs.get(context.attempt_id) ?? 0;
      if (record.epoch !== epoch || record.attemptId !== context.attempt_id || record.catalogVersion !== context.catalog_version ||
          record.profileSchemaHash !== context.profile_schema_hash || !isCanonicalDownloadUrl(record.url, record.modelVersionId, record.fileId) ||
          !sameGenerationPrincipal(record.principal, context.principal)) fail("REFERENCE_UNAVAILABLE");
      const current = await this.#resolvePrincipal(context.attempt_id, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation);
      if (!sameGenerationPrincipal(current, context.principal) || (this.#epochs.get(context.attempt_id) ?? 0) !== epoch) {
        this.#invalidateAttemptState(context.attempt_id); fail("PRINCIPAL_NOT_LINKED");
      }
      this.#assertProfile();
      if (record.expiresAt <= this.#readNow() || this.#records.get(record.handle) !== record) fail("REFERENCE_EXPIRED");
      return Object.freeze({ ...context, asset_role: "lora", provenance: "public_civitai_verified", provenance_verified: true,
        asset_id: String(record.modelVersionId), canonical_url: record.url, sha256: record.sha256, size: record.size, expires_at: record.expiresAt });
    } catch (error) {
      if (error instanceof OwnerFluxImageAssetServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) { this.#invalidateAttemptState(context.attempt_id); fail("PRINCIPAL_NOT_LINKED"); }
      fail("REFERENCE_UNAVAILABLE");
    } finally { this.#finish(context.attempt_id, operation); }
  }

  async #resolvePrincipal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal?.aborted) fail("REQUEST_ABORTED");
    const principal = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
    if (!signal) return await principal;
    let remove = () => {};
    try {
      const aborted = new Promise<never>((_resolve, reject) => {
        const onAbort = () => reject(new OwnerFluxImageAssetServiceError("REQUEST_ABORTED"));
        if (signal.aborted) onAbort(); else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); }
      });
      return await Promise.race([principal, aborted]);
    } finally { remove(); }
  }
  #begin(attemptId: string, parentSignal?: AbortSignal, reservesRecord = false, prune = true): Pending {
    this.#assertOpen(); if (prune) this.#prune(this.#readNow());
    if (this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY");
    const active = this.#activeAttempts();
    if (!active.has(attemptId) && active.size >= MAX_ACTIVE_ATTEMPTS) fail("CAPACITY_EXCEEDED");
    if (reservesRecord && this.#records.size + this.#pendingRegistrations >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
    const controller = new AbortController(); const abort = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) abort(); else parentSignal?.addEventListener("abort", abort, { once: true });
    let finish!: () => void; const done = new Promise<void>((resolve) => { finish = resolve; });
    const bucket = this.#pendingByAttempt.get(attemptId) ?? new Set<Pending>();
    const pending = { controller, done, finish, removeParentAbort: () => parentSignal?.removeEventListener("abort", abort),
      epoch: this.#epochs.get(attemptId) ?? 0, reservesRecord };
    bucket.add(pending); this.#pendingByAttempt.set(attemptId, bucket); this.#allOperations.add(done); this.#pendingCount++;
    if (reservesRecord) this.#pendingRegistrations++;
    return pending;
  }
  #finish(attemptId: string, operation: Pending): void {
    operation.removeParentAbort();
    const bucket = this.#pendingByAttempt.get(attemptId); bucket?.delete(operation); if (bucket?.size === 0) this.#pendingByAttempt.delete(attemptId);
    this.#pendingCount--; if (operation.reservesRecord) this.#pendingRegistrations--;
    operation.finish(); this.#allOperations.delete(operation.done); this.#maybeReleaseAttempt(attemptId);
  }
  #rememberPrincipal(attemptId: string, principal: Readonly<GenerationPrincipalRef>): boolean {
    const prior = this.#principalByAttempt.get(attemptId);
    if (prior && !sameGenerationPrincipal(prior, principal)) return false;
    this.#principalByAttempt.set(attemptId, principal); return true;
  }
  #invalidateAttemptState(attemptId: string): void {
    if (!this.#hasAttemptState(attemptId)) return;
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    this.#issuer.invalidateAttempt(attemptId);
    for (const handle of this.#handlesByAttempt.get(attemptId) ?? []) this.#records.delete(handle);
    this.#handlesByAttempt.delete(attemptId); this.#assetSetsByAttempt.delete(attemptId); this.#principalByAttempt.delete(attemptId);
    for (const operation of this.#pendingByAttempt.get(attemptId) ?? []) operation.controller.abort();
  }
  #prune(now: number): void {
    for (const [handle, record] of this.#records) if (record.expiresAt <= now) this.#removeHandle(handle);
    for (const [attempt, set] of this.#assetSetsByAttempt) {
      for (const entry of set) if (entry.expiresAt <= now) set.delete(entry);
      if (set.size === 0) this.#assetSetsByAttempt.delete(attempt);
      this.#maybeReleaseAttempt(attempt);
    }
    for (const attempt of this.#epochs.keys()) if (!this.#hasAttemptState(attempt)) this.#epochs.delete(attempt);
  }
  #removeHandle(handle: string): void {
    const record = this.#records.get(handle); if (!record) return;
    this.#records.delete(handle); const handles = this.#handlesByAttempt.get(record.attemptId); handles?.delete(handle);
    if (handles?.size === 0) this.#handlesByAttempt.delete(record.attemptId); this.#maybeReleaseAttempt(record.attemptId);
  }
  #assertNotDuplicate(attemptId: string, versionId: number, fileId: number): void {
    for (const record of this.#records.values()) {
      if (record.attemptId === attemptId && record.modelVersionId === versionId && record.fileId === fileId) fail("REFERENCE_UNAVAILABLE");
    }
  }
  #hasAttemptState(attemptId: string): boolean { return this.#activeAttempts().has(attemptId); }
  #activeAttempts(): Set<string> { return new Set([...this.#handlesByAttempt.keys(), ...this.#assetSetsByAttempt.keys(), ...this.#principalByAttempt.keys(), ...this.#pendingByAttempt.keys()]); }
  #maybeReleaseAttempt(attemptId: string): void {
    if (this.#handlesByAttempt.has(attemptId) || this.#assetSetsByAttempt.has(attemptId) || this.#pendingByAttempt.has(attemptId)) return;
    this.#epochs.delete(attemptId); this.#principalByAttempt.delete(attemptId);
  }
  #assertProfile(): void {
    this.#assertOpen();
    try { const current = getOwnerFluxImageSourceProfile("flux-1", this.#catalog, this.#catalogVersion);
      if (current.profile_schema_hash !== this.#profile.profile_schema_hash || current.public_catalog_version !== this.#profile.public_catalog_version) fail("MODEL_BINDING_MISMATCH");
    } catch { fail("MODEL_BINDING_MISMATCH"); }
  }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  #throwIfClosedOrAborted(operation: Pending): void { if (this.#closed) fail("SERVICE_CLOSED"); if (operation.controller.signal.aborted) fail("REQUEST_ABORTED"); }
  #readNow(): number {
    const value = this.#now();
    if (!Number.isSafeInteger(value) || value < 0 || (this.#lastObservedNow !== undefined && value < this.#lastObservedNow)) fail("CLOCK_INVALID");
    this.#lastObservedNow = value; return value;
  }
}

function snapshotRegistration(value: unknown): Readonly<OwnerFluxPublicLoraRegistrationInput> {
  const fields = exactRecord(value, ["attemptId", "model_id", "model_version_id", "file_id"], ["model_id_source", "signal"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || fields.model_id !== "flux-1" ||
      !positiveInteger(fields.model_version_id) || !positiveInteger(fields.file_id) ||
      (fields.model_id_source !== undefined && !positiveInteger(fields.model_id_source))) fail("INVALID_REQUEST");
  if (fields.signal !== undefined && (types.isProxy(fields.signal) || !(fields.signal instanceof AbortSignal))) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, model_id: "flux-1", model_version_id: fields.model_version_id as number,
    file_id: fields.file_id as number, ...(fields.model_id_source === undefined ? {} : { model_id_source: fields.model_id_source as number }),
    ...(fields.signal === undefined ? {} : { signal: fields.signal as AbortSignal }) });
}
function snapshotIssueInput(value: unknown): Readonly<OwnerFluxImageAssetIssueInput> {
  const fields = exactRecord(value, ["attemptId", "model_id", "lora_references"], ["image_reference_handle"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || !OWNER_MODELS.has(fields.model_id as OwnerFluxImageModel)) fail("INVALID_REQUEST");
  if (fields.image_reference_handle !== undefined && (typeof fields.image_reference_handle !== "string" ||
      !/^flux_image_[0-9a-f-]{36}$/u.test(fields.image_reference_handle))) fail("INVALID_REQUEST");
  const refs = snapshotLoraRequests(fields.lora_references);
  if (refs.length > 3 || (fields.model_id !== "flux-1" && (refs.length > 0 || fields.image_reference_handle !== undefined))) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, model_id: fields.model_id as OwnerFluxImageModel,
    ...(fields.image_reference_handle === undefined ? {} : { image_reference_handle: fields.image_reference_handle as string }), lora_references: refs });
}
function snapshotLoraRequests(value: unknown): readonly OwnerFluxLoraRequest[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value); const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length || !("value" in descriptors[key]!)))) fail("INVALID_REQUEST");
  const result: OwnerFluxLoraRequest[] = [];
  for (let i = 0; i < value.length; i++) {
    const fields = exactRecord(descriptors[String(i)]?.value, ["handle", "strength_model", "strength_clip"]);
    if (typeof fields.handle !== "string" || !LORA_HANDLE.test(fields.handle) || !inRange(fields.strength_model, 0, 1.5) ||
        fields.strength_clip !== fields.strength_model) fail("INVALID_REQUEST");
    result.push(Object.freeze({ handle: fields.handle, strength_model: fields.strength_model as number, strength_clip: fields.strength_clip as number }));
  }
  if (new Set(result.map((item) => item.handle)).size !== result.length) fail("INVALID_REQUEST");
  return Object.freeze(result);
}
function snapshotResolverContext(value: unknown): Readonly<OwnerFluxAssetResolverContext> {
  const fields = exactRecord(value, [...SOURCE_FIELDS, "asset_handle", "asset_role"]);
  if (fields.model_id !== "flux-1" || fields.ai_name !== "flux" || fields.scope !== "image" || fields.operation_id !== "generate-image" ||
      fields.asset_role !== "lora" || typeof fields.attempt_id !== "string" || !ATTEMPT.test(fields.attempt_id) ||
      typeof fields.asset_handle !== "string" || !LORA_HANDLE.test(fields.asset_handle) ||
      fields.catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION || typeof fields.profile_schema_hash !== "string" || !SHA256.test(fields.profile_schema_hash)) fail("INVALID_REQUEST");
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); } catch { fail("INVALID_REQUEST"); }
  if (principal.connection_id !== fields.attempt_id) fail("INVALID_REQUEST");
  return Object.freeze({ ...fields, principal: fields.principal as Readonly<GenerationPrincipalRef> }) as unknown as OwnerFluxAssetResolverContext;
}
function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || !fields.tenant_id || typeof fields.subject !== "string" || !fields.subject) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  let prototype: object | null, descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); } catch { fail("INVALID_REQUEST"); }
  const allowed = [...required, ...optional], keys = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!))) fail("INVALID_REQUEST");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function isPlainObject(value: unknown): boolean { return !!value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value); }
function isExactAttestor(value: unknown): value is CivitaiPublicModelFileAttestor {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== CivitaiPublicModelFileAttestor.prototype) return false;
  const descriptor = Object.getOwnPropertyDescriptor(CivitaiPublicModelFileAttestor.prototype, "attest");
  return !!descriptor && "value" in descriptor && descriptor.value === NATIVE_ATTEST && !types.isProxy(NATIVE_ATTEST) &&
    !Object.getOwnPropertyDescriptor(value, "attest");
}
function isExactUploadService(value: unknown): value is OwnerFluxImageUploadService {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== OwnerFluxImageUploadService.prototype) return false;
  for (const name of ["upload", "invalidateAttempt", "close"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(OwnerFluxImageUploadService.prototype, name);
    const own = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function" || types.isProxy(descriptor.value) ||
        (own !== undefined && (! ("value" in own) || own.value !== descriptor.value))) return false;
  }
  const resolver = Object.getOwnPropertyDescriptor(value, "resolveImage");
  return !!resolver && "value" in resolver && typeof resolver.value === "function" && !types.isProxy(resolver.value);
}
function isVerifiedSnapshot(value: Readonly<CivitaiVerifiedModelFileSnapshot>, input: Readonly<OwnerFluxPublicLoraRegistrationInput>): boolean {
  return value.metadata_status === "VERIFIED" && value.model_type === "LORA" && value.version_status === "Published" &&
    value.model_availability === "Public" && (value.version_availability === "Public" || value.version_availability === "NOT_REPORTED") &&
    value.usage_control === "Download" && value.file_type === "Model" && value.format === "SafeTensor" &&
    value.legal_approval === "NOT_ESTABLISHED" && value.license_compatibility === "UNPROVEN" && value.backend_acceptance === "UNPROVEN" &&
    value.model_version_id === input.model_version_id && value.file_id === input.file_id &&
    (input.model_id_source === undefined || value.model_id === input.model_id_source) && positiveInteger(value.model_id) &&
    positiveInteger(value.size) && SHA256.test(value.sha256) && value.content_confidence === "STREAMED_SHA256_AND_SAFETENSORS_STRUCTURE" &&
    isCanonicalDownloadUrl(value.canonical_download_url, input.model_version_id, input.file_id);
}
function isCanonicalDownloadUrl(value: string, versionId: number, fileId: number): boolean {
  return value === `https://civitai.com/api/download/models/${versionId}?fileId=${fileId}`;
}
function positiveInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function inRange(value: unknown, minimum: number, maximum: number): value is number { return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum; }
function readClock(value: unknown): () => number {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return () => { let now: unknown; try { now = Reflect.apply(value, undefined, []); } catch { fail("CLOCK_INVALID"); }
    if (!Number.isSafeInteger(now) || (now as number) < 0) fail("CLOCK_INVALID"); return now as number; };
}
function fail(code: OwnerFluxImageAssetServiceErrorCode): never { throw new OwnerFluxImageAssetServiceError(code); }
const OWNER_MODELS = new Set<string>(OWNER_FLUX_IMAGE_MODELS);
