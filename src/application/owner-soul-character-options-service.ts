import { randomUUID } from "node:crypto";
import { isProxy } from "node:util/types";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import {
  OwnerSoulCharacterCatalogHttpClient,
  OwnerSoulCharacterCatalogHttpError,
  type OwnerSoulCharacterCatalogSnapshot,
  type OwnerSoulCharacterCatalogValidationSummary,
  type SoulCharacterReferenceId
} from "../adapter/syntx/owner-soul-character-catalog-http-client.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import { getOwnerSoulImageSourceProfile, type OwnerSoulImageSourceProfile } from "./owner-soul-image-source-profile.js";

const MODEL_ID = "higgsfield-soul" as const;
const SOURCE_MAPPING_SHA256 = "sha256:a11bcb0b533f7f3f9f1668e5bab290ef5d0ba85410df5b78f18e361db96b9391";
const HANDLE_TTL_MS = 5 * 60_000;
const MAX_RECORDS_PER_ATTEMPT = 128;
const MAX_GLOBAL_HANDLES = 512;
const MAX_PENDING_OPERATIONS = 4;
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE_PATTERN = /^soul_character_[0-9a-f-]{36}$/u;
const SOURCE_STATUSES = ["not-ready", "in-progress", "queue", "error", "completed"] as const;
const PROFILE_METHOD = getOwnerSoulImageSourceProfile;
const NATIVE_LIST_METHOD = OwnerSoulCharacterCatalogHttpClient.prototype.listCharacters;
const RESOLUTIONS = new WeakMap<object, InternalResolutionState>();

export type OwnerSoulCharacterOptionsServiceErrorCode =
  | "INVALID_REQUEST" | "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH" | "SERVICE_BUSY" | "SERVICE_CLOSED"
  | "SNAPSHOT_SUPERSEDED" | "CAPACITY_EXCEEDED" | "SOURCE_SNAPSHOT_INVALID" | "OPTION_HANDLE_NOT_FOUND"
  | "OPTION_HANDLE_EXPIRED" | "UPSTREAM_UNAVAILABLE" | "UPSTREAM_TIMEOUT" | "UPSTREAM_REQUEST_ABORTED" | "UPSTREAM_PROTOCOL_ERROR";

export class OwnerSoulCharacterOptionsServiceError extends Error {
  constructor(readonly code: OwnerSoulCharacterOptionsServiceErrorCode) {
    super("The owner Soul Character options are unavailable.");
    this.name = "OwnerSoulCharacterOptionsServiceError";
  }
}

export interface ListOwnerSoulCharacterOptionsInput { readonly attemptId: string; readonly signal?: AbortSignal; }
export interface OwnerSoulCharacterOptionChoice {
  readonly character_handle: string | null;
  readonly label: string;
  readonly status: string;
  readonly selectable: boolean;
  readonly reference_id_type: "string" | "number" | "unavailable";
}
export interface OwnerSoulCharacterOptionsResult {
  readonly status: "OPTIONS_ISSUED" | "EMPTY_INCONCLUSIVE";
  readonly model_id: typeof MODEL_ID;
  readonly catalog_version: typeof DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
  readonly source_mapping_sha256: typeof SOURCE_MAPPING_SHA256;
  readonly confidence_scope: "AUTHENTICATED_CURRENT_ACCOUNT_LIST_MEMBERSHIP_NOT_UPSTREAM_OWNER_FILTER_OR_PROVIDER_PERMISSION";
  readonly reference_id_type_confidence: "CURRENT_ROW_VALUE_TYPE_ONLY_SERVER_TYPE_UNOBSERVED";
  readonly generation_allowed: false;
  readonly expires_in_seconds: 300;
  readonly options: readonly OwnerSoulCharacterOptionChoice[];
  readonly summary: OwnerSoulCharacterCatalogValidationSummary;
}
export interface ResolveOwnerSoulCharacterHandleInput {
  readonly attemptId: string;
  readonly character_handle: string;
  readonly signal?: AbortSignal;
}
export interface OwnerSoulCharacterResolutionContext {
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly character_handle: string;
  readonly model_id: typeof MODEL_ID;
  readonly catalog_version: typeof DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
  readonly source_mapping_sha256: typeof SOURCE_MAPPING_SHA256;
  readonly profile_schema_hash: string;
}
export interface OwnerSoulCharacterHandleResolution {
  readonly status: "CHARACTER_RESOLVED";
  readonly character_handle: string;
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: typeof MODEL_ID;
  readonly catalog_version: typeof DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
  readonly source_mapping_sha256: typeof SOURCE_MAPPING_SHA256;
  readonly profile_schema_hash: string;
  readonly record_id_type: "string" | "number";
  readonly reference_id_type: "string" | "number";
  readonly confidence_scope: "AUTHENTICATED_CURRENT_ACCOUNT_LIST_MEMBERSHIP_NOT_UPSTREAM_OWNER_FILTER_OR_PROVIDER_PERMISSION";
}
export interface RevalidatedOwnerSoulCharacterHandle extends OwnerSoulCharacterHandleResolution {
  readonly fresh_source_snapshot: true;
  readonly verified_at_ms: number;
}
export interface OwnerSoulCharacterRevalidationProvenance {
  readonly original_expires_at_ms: number;
  readonly catalog_version: typeof DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
  readonly source_mapping_sha256: typeof SOURCE_MAPPING_SHA256;
  readonly profile_schema_hash: string;
}
export interface OwnerSoulCharacterOptionsServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly now?: () => number;
}

interface InternalCharacterRecord {
  readonly character_handle: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly record_id: SoulCharacterReferenceId;
  readonly reference_id: SoulCharacterReferenceId;
  readonly title: string;
  readonly expires_at: number;
  readonly epoch: number;
  readonly profile_schema_hash: string;
  readonly catalog_version: typeof DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
  readonly list_token: object;
}
interface PendingOperation {
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly removeParentAbort: () => void;
}
interface InternalResolutionState {
  readonly kind: "CACHE" | "REVALIDATED";
  readonly owner: OwnerSoulCharacterOptionsService;
  readonly record: InternalCharacterRecord;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly verified_at_ms: number;
  readonly contextMatches: (value: unknown) => boolean;
  readonly readReferenceId: (value: unknown) => Promise<SoulCharacterReferenceId>;
}
interface SnapshotRecord {
  readonly record_id: SoulCharacterReferenceId;
  readonly reference_id: SoulCharacterReferenceId | null;
  readonly title: string;
  readonly status: string;
  readonly selectable: boolean;
}
interface DecodedSnapshot { readonly records: readonly SnapshotRecord[]; readonly summary: OwnerSoulCharacterCatalogValidationSummary; }

/** Owner-bound Character selector. Listing is provenance only; it grants neither training, ownership, nor generation. */
export class OwnerSoulCharacterOptionsService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #catalogVersion: typeof DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
  readonly #profile: Readonly<OwnerSoulImageSourceProfile>;
  readonly #resolveClient: OwnerSoulCharacterOptionsServiceOptions["resolveClient"];
  readonly #now: () => number;
  readonly #handles = new Map<string, InternalCharacterRecord>();
  readonly #handlesByAttempt = new Map<string, Set<string>>();
  readonly #listTokens = new Map<string, object>();
  readonly #epochs = new Map<string, number>();
  readonly #pendingByAttempt = new Map<string, Set<AbortController>>();
  readonly #operations = new Set<Promise<void>>();
  #pendingCount = 0;
  #closed = false;
  #closing: Promise<void> | undefined;
  #lastNow = -1;

  constructor(optionsInput: OwnerSoulCharacterOptionsServiceOptions | unknown) {
    const options = exactRecord(optionsInput, ["binding", "linkService", "catalog", "catalog_version", "resolveClient", "now"], ["now"]);
    if (!(options.catalog instanceof DiscoveryCatalogRepository) || isProxy(options.catalog) ||
        typeof options.resolveClient !== "function" || isProxy(options.resolveClient) ||
        (options.now !== undefined && (typeof options.now !== "function" || isProxy(options.now)))) invalid("INVALID_REQUEST");
    this.#binding = snapshotBinding(options.binding);
    this.#linkService = snapshotLinkService(options.linkService);
    this.#catalog = options.catalog;
    if (options.catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION) invalid("MODEL_BINDING_MISMATCH");
    this.#catalogVersion = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
    this.#resolveClient = options.resolveClient as OwnerSoulCharacterOptionsServiceOptions["resolveClient"];
    this.#now = options.now as (() => number) | undefined ?? Date.now;
    this.#profile = this.#assertSourceProfile();
  }

  async listOptions(input: ListOwnerSoulCharacterOptionsInput | unknown): Promise<OwnerSoulCharacterOptionsResult> {
    const request = snapshotListInput(input);
    const operation = this.#beginOperation(request.attemptId, request.signal);
    const token = Object.freeze({});
    this.#listTokens.set(request.attemptId, token);
    try {
      this.#assertOpen(); this.#assertCurrentProfile();
      const principal = await this.#resolvePrincipal(request.attemptId);
      this.#throwIfClosedOrAborted(operation.controller);
      const client = this.#resolveCharacterClient(request.attemptId);
      const raw = await this.#awaitSignal(client.listCharacters(operation.controller.signal), operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      const snapshot = normalizeCharacterSnapshot(raw);
      const current = await this.#resolvePrincipal(request.attemptId);
      this.#throwIfClosedOrAborted(operation.controller);
      this.#assertCurrentProfile();
      if (!sameGenerationPrincipal(principal, current)) {
        this.#removeAttemptHandles(request.attemptId);
        throw new OwnerSoulCharacterOptionsServiceError("PRINCIPAL_NOT_LINKED");
      }
      if (this.#listTokens.get(request.attemptId) !== token) throw new OwnerSoulCharacterOptionsServiceError("SNAPSHOT_SUPERSEDED");
      const now = this.#safeNow();
      this.#pruneExpired(now);
      const priorCount = this.#handlesByAttempt.get(request.attemptId)?.size ?? 0;
      const handlesToIssue = snapshot.records.filter(isSelectableRecord);
      if (handlesToIssue.length > MAX_RECORDS_PER_ATTEMPT || this.#handles.size - priorCount + handlesToIssue.length > MAX_GLOBAL_HANDLES) {
        throw new OwnerSoulCharacterOptionsServiceError("CAPACITY_EXCEEDED");
      }
      const expiresAt = now + HANDLE_TTL_MS;
      if (!Number.isSafeInteger(expiresAt)) throw new OwnerSoulCharacterOptionsServiceError("INVALID_REQUEST");
      const staged = handlesToIssue.map((record) => Object.freeze({
        character_handle: `soul_character_${randomUUID()}`,
        attemptId: request.attemptId,
        principal,
        record_id: record.record_id,
        reference_id: record.reference_id as SoulCharacterReferenceId,
        title: record.title,
        expires_at: expiresAt,
        epoch: this.#epochs.get(request.attemptId) ?? 0,
        profile_schema_hash: this.#profile.profile_schema_hash,
        catalog_version: this.#catalogVersion,
        list_token: token
      }));
      if (new Set(staged.map(({ character_handle }) => character_handle)).size !== staged.length ||
          staged.some(({ character_handle }) => this.#handles.has(character_handle))) {
        throw new OwnerSoulCharacterOptionsServiceError("UPSTREAM_UNAVAILABLE");
      }
      if ((this.#epochs.get(request.attemptId) ?? 0) !== staged[0]?.epoch && staged.length > 0) {
        throw new OwnerSoulCharacterOptionsServiceError("SNAPSHOT_SUPERSEDED");
      }
      this.#removeAttemptHandles(request.attemptId);
      const issued = new Map<SnapshotRecord, string>();
      const attemptHandles = new Set<string>();
      for (let index = 0; index < staged.length; index += 1) {
        const record = handlesToIssue[index]!; const internal = staged[index]!;
        this.#handles.set(internal.character_handle, internal); attemptHandles.add(internal.character_handle);
        issued.set(record, internal.character_handle);
      }
      if (attemptHandles.size > 0) this.#handlesByAttempt.set(request.attemptId, attemptHandles);
      return Object.freeze({
        status: snapshot.records.length === 0 ? "EMPTY_INCONCLUSIVE" : "OPTIONS_ISSUED",
        model_id: MODEL_ID,
        catalog_version: this.#catalogVersion,
        source_mapping_sha256: SOURCE_MAPPING_SHA256,
        confidence_scope: "AUTHENTICATED_CURRENT_ACCOUNT_LIST_MEMBERSHIP_NOT_UPSTREAM_OWNER_FILTER_OR_PROVIDER_PERMISSION",
        reference_id_type_confidence: "CURRENT_ROW_VALUE_TYPE_ONLY_SERVER_TYPE_UNOBSERVED",
        generation_allowed: false,
        expires_in_seconds: 300,
        options: Object.freeze(snapshot.records.map((record) => Object.freeze({
          character_handle: issued.get(record) ?? null,
          label: record.title,
          status: record.status,
          selectable: isSelectableRecord(record),
          reference_id_type: referenceIdType(record.reference_id)
        }))),
        summary: snapshot.summary
      });
    } catch (error) { throw mapServiceError(error, operation.controller.signal); }
    finally {
      if (this.#listTokens.get(request.attemptId) === token) this.#listTokens.delete(request.attemptId);
      this.#finishOperation(request.attemptId, operation);
    }
  }

  /** Local lookup is nominal and owner-scoped; it never renews the original five-minute snapshot TTL. */
  async resolveCharacterHandle(input: ResolveOwnerSoulCharacterHandleInput | unknown): Promise<OwnerSoulCharacterHandleResolution> {
    const request = snapshotResolveInput(input);
    const operation = this.#beginOperation(request.attemptId, request.signal);
    try {
      this.#assertOpen(); this.#assertCurrentProfile();
      const principal = await this.#resolvePrincipal(request.attemptId);
      this.#throwIfClosedOrAborted(operation.controller);
      const record = this.#requireHandle(request.character_handle, request.attemptId, principal);
      const current = await this.#resolvePrincipal(request.attemptId);
      this.#throwIfClosedOrAborted(operation.controller);
      this.#assertCurrentProfile();
      if (!sameGenerationPrincipal(principal, current)) {
        this.#removeAttemptHandles(request.attemptId);
        throw new OwnerSoulCharacterOptionsServiceError("PRINCIPAL_NOT_LINKED");
      }
      if (this.#handles.get(request.character_handle) !== record) throw new OwnerSoulCharacterOptionsServiceError("OPTION_HANDLE_NOT_FOUND");
      const verifiedAt = this.#safeNow();
      if (record.expires_at <= verifiedAt) { this.#removeHandle(record.character_handle); throw new OwnerSoulCharacterOptionsServiceError("OPTION_HANDLE_EXPIRED"); }
      return this.#makeResolution(record, principal, verifiedAt, "CACHE");
    } catch (error) { throw mapServiceError(error, operation.controller.signal); }
    finally { this.#finishOperation(request.attemptId, operation); }
  }

  /** Exactly one fresh Character-list read; this returns nominal membership, not provider ownership or generation permission. */
  async revalidateCharacterHandle(input: ResolveOwnerSoulCharacterHandleInput | unknown): Promise<RevalidatedOwnerSoulCharacterHandle> {
    const request = snapshotResolveInput(input);
    this.#assertOpen(); this.#assertCurrentProfile();
    const listTokenAtStart = this.#listTokens.get(request.attemptId);
    if (listTokenAtStart !== undefined) throw new OwnerSoulCharacterOptionsServiceError("SNAPSHOT_SUPERSEDED");
    const operation = this.#beginOperation(request.attemptId, request.signal);
    try {
      const principal = await this.#resolvePrincipal(request.attemptId);
      this.#throwIfClosedOrAborted(operation.controller);
      const record = this.#requireHandle(request.character_handle, request.attemptId, principal);
      const client = this.#resolveCharacterClient(request.attemptId);
      const raw = await this.#awaitSignal(client.listCharacters(operation.controller.signal), operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      const snapshot = normalizeCharacterSnapshot(raw);
      const current = await this.#resolvePrincipal(request.attemptId);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!sameGenerationPrincipal(principal, current)) {
        this.#removeAttemptHandles(request.attemptId);
        throw new OwnerSoulCharacterOptionsServiceError("PRINCIPAL_NOT_LINKED");
      }
      if (this.#listTokens.get(request.attemptId) !== listTokenAtStart || this.#handles.get(request.character_handle) !== record ||
          (this.#epochs.get(request.attemptId) ?? 0) !== record.epoch) {
        throw new OwnerSoulCharacterOptionsServiceError("SNAPSHOT_SUPERSEDED");
      }
      const currentRecord = snapshot.records.find((row) => typedIdEqual(row.record_id, record.record_id));
      if (!currentRecord || !isSelectableRecord(currentRecord) || currentRecord.title !== record.title ||
          !typedIdEqual(currentRecord.reference_id, record.reference_id)) {
        throw new OwnerSoulCharacterOptionsServiceError("OPTION_HANDLE_NOT_FOUND");
      }
      const verifiedAt = this.#safeNow();
      if (record.expires_at <= verifiedAt) {
        this.#removeHandle(record.character_handle);
        throw new OwnerSoulCharacterOptionsServiceError("OPTION_HANDLE_EXPIRED");
      }
      return this.#makeResolution(record, principal, verifiedAt, "REVALIDATED") as RevalidatedOwnerSoulCharacterHandle;
    } catch (error) { throw mapServiceError(error, operation.controller.signal); }
    finally { this.#finishOperation(request.attemptId, operation); }
  }

  /** Context guard for an internal generator; ordinary cached resolutions never pass it. */
  isRevalidatedCharacterForContext(value: unknown, contextInput: unknown): value is RevalidatedOwnerSoulCharacterHandle {
    try {
      const context = snapshotResolutionContext(contextInput);
      if (!value || typeof value !== "object" || isProxy(value)) return false;
      const state = RESOLUTIONS.get(value as object);
      if (!state || state.kind !== "REVALIDATED" || state.owner !== this || !state.contextMatches(context) || this.#closed) return false;
      const current = this.#handles.get(state.record.character_handle);
      const now = this.#safeNow(); this.#assertCurrentProfile();
      return current === state.record && state.record.expires_at > now && state.record.attemptId === context.attemptId &&
        (this.#epochs.get(context.attemptId) ?? 0) === state.record.epoch;
    } catch { return false; }
  }

  async assertCurrentRevalidatedCharacterContext(value: unknown, contextInput: unknown): Promise<void> {
    const context = snapshotResolutionContext(contextInput);
    if (!this.isRevalidatedCharacterForContext(value, context)) throw new OwnerSoulCharacterOptionsServiceError("OPTION_HANDLE_NOT_FOUND");
    const state = RESOLUTIONS.get(value as object)!;
    const currentPrincipal = await this.#resolvePrincipal(context.attemptId);
    this.#throwIfClosed();
    if (!sameGenerationPrincipal(state.principal, currentPrincipal)) throw new OwnerSoulCharacterOptionsServiceError("PRINCIPAL_NOT_LINKED");
    if (!this.isRevalidatedCharacterForContext(value, context)) throw new OwnerSoulCharacterOptionsServiceError("OPTION_HANDLE_NOT_FOUND");
  }

  invalidateAttempt(attemptId: string): void {
    if (!ATTEMPT_PATTERN.test(attemptId)) return;
    this.#listTokens.delete(attemptId);
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    this.#removeAttemptHandles(attemptId);
    for (const controller of this.#pendingByAttempt.get(attemptId) ?? []) controller.abort();
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const tokenAttempt of this.#listTokens.keys()) this.#listTokens.delete(tokenAttempt);
    for (const controllers of this.#pendingByAttempt.values()) for (const controller of controllers) controller.abort();
    this.#handles.clear(); this.#handlesByAttempt.clear(); this.#epochs.clear();
    this.#closing = Promise.allSettled([...this.#operations]).then(() => undefined);
    return this.#closing;
  }

  async #resolveReferenceIdFromResolution(value: unknown, contextInput: unknown): Promise<SoulCharacterReferenceId> {
    const context = snapshotResolutionContext(contextInput);
    if (!this.isRevalidatedCharacterForContext(value, context)) throw new OwnerSoulCharacterOptionsServiceError("OPTION_HANDLE_NOT_FOUND");
    const state = RESOLUTIONS.get(value as object)!;
    await this.assertCurrentRevalidatedCharacterContext(value, context);
    const record = this.#handles.get(context.character_handle);
    if (record !== state.record || !isSelectableRecord({ record_id: record.record_id, reference_id: record.reference_id,
      title: record.title, status: "completed", selectable: true })) throw new OwnerSoulCharacterOptionsServiceError("OPTION_HANDLE_NOT_FOUND");
    return record.reference_id;
  }

  #makeResolution(record: InternalCharacterRecord, principal: Readonly<GenerationPrincipalRef>, verifiedAt: number,
    kind: InternalResolutionState["kind"]): OwnerSoulCharacterHandleResolution {
    const value = Object.create(null) as OwnerSoulCharacterHandleResolution;
    Object.defineProperties(value, {
      status: { value: "CHARACTER_RESOLVED", enumerable: true }, character_handle: { value: record.character_handle, enumerable: true },
      attempt_id: { value: record.attemptId, enumerable: true }, principal: { value: principal, enumerable: true },
      model_id: { value: MODEL_ID, enumerable: true }, catalog_version: { value: this.#catalogVersion, enumerable: true },
      source_mapping_sha256: { value: SOURCE_MAPPING_SHA256, enumerable: true }, profile_schema_hash: { value: record.profile_schema_hash, enumerable: true },
      record_id_type: { value: typeof record.record_id, enumerable: true }, reference_id_type: { value: typeof record.reference_id, enumerable: true },
      confidence_scope: { value: "AUTHENTICATED_CURRENT_ACCOUNT_LIST_MEMBERSHIP_NOT_UPSTREAM_OWNER_FILTER_OR_PROVIDER_PERMISSION", enumerable: true },
      ...(kind === "REVALIDATED" ? { fresh_source_snapshot: { value: true, enumerable: true }, verified_at_ms: { value: verifiedAt, enumerable: true } } : {})
    });
    Object.freeze(value);
    const state: InternalResolutionState = Object.freeze({ kind, owner: this, record, principal, verified_at_ms: verifiedAt,
      contextMatches: (contextInput: unknown) => this.#contextMatches(record, principal, contextInput),
      readReferenceId: (contextInput: unknown) => this.#resolveReferenceIdFromResolution(value, contextInput) });
    RESOLUTIONS.set(value, state);
    return value as OwnerSoulCharacterHandleResolution;
  }

  #contextMatches(record: InternalCharacterRecord, principal: Readonly<GenerationPrincipalRef>, contextInput: unknown): boolean {
    try {
      const context = snapshotResolutionContext(contextInput);
      return context.attemptId === record.attemptId && context.character_handle === record.character_handle &&
        context.model_id === MODEL_ID && context.catalog_version === record.catalog_version &&
        context.source_mapping_sha256 === SOURCE_MAPPING_SHA256 && context.profile_schema_hash === record.profile_schema_hash &&
        sameGenerationPrincipal(context.principal, principal);
    } catch { return false; }
  }

  #requireHandle(handle: string, attemptId: string, principal: Readonly<GenerationPrincipalRef>): InternalCharacterRecord {
    const record = this.#handles.get(handle);
    if (!record) throw new OwnerSoulCharacterOptionsServiceError("OPTION_HANDLE_NOT_FOUND");
    const now = this.#safeNow();
    if (record.expires_at <= now) { this.#removeHandle(handle); throw new OwnerSoulCharacterOptionsServiceError("OPTION_HANDLE_EXPIRED"); }
    if (record.attemptId !== attemptId || !sameGenerationPrincipal(record.principal, principal) ||
        (this.#epochs.get(attemptId) ?? 0) !== record.epoch) throw new OwnerSoulCharacterOptionsServiceError("OPTION_HANDLE_NOT_FOUND");
    return record;
  }

  #assertSourceProfile(): Readonly<OwnerSoulImageSourceProfile> {
    let profile: Readonly<OwnerSoulImageSourceProfile>;
    try { profile = Reflect.apply(PROFILE_METHOD, undefined, [MODEL_ID, this.#catalog, this.#catalogVersion]); }
    catch { throw new OwnerSoulCharacterOptionsServiceError("MODEL_BINDING_MISMATCH"); }
    if (profile.model_id !== MODEL_ID || profile.profile_id !== "owner-soul-image-source-profile-v1" ||
        profile.public_catalog_version !== this.#catalogVersion || profile.source_binding.files.form.sha256 !== SOURCE_MAPPING_SHA256 ||
        profile.character_selection.selection_key !== "record.id" || profile.character_selection.display_label !== "record.title" ||
        profile.character_selection.selected_value_source !== "record.reference_id" ||
        profile.character_selection.selection_requires_status !== "completed" ||
        profile.character_selection.server_reference_id_type !== "UNOBSERVED_EMPTY_LIST" ||
        profile.character_selection.owned_reference_permission !== "UNPROVEN_NO_CHARACTER_UPLOAD_HANDLE" ||
        profile.character_selection.backend_acceptance !== "UNPROVEN" || profile.dispatch_allowed !== false || profile.runtime_activation !== false) {
      throw new OwnerSoulCharacterOptionsServiceError("MODEL_BINDING_MISMATCH");
    }
    return profile;
  }
  #assertCurrentProfile(): void {
    const current = this.#assertSourceProfile();
    if (current.profile_schema_hash !== this.#profile.profile_schema_hash) throw new OwnerSoulCharacterOptionsServiceError("MODEL_BINDING_MISMATCH");
  }
  #resolveCharacterClient(attemptId: string): OwnerSoulCharacterCatalogHttpClient {
    let client: unknown;
    try { client = this.#resolveClient(attemptId); } catch { throw new OwnerSoulCharacterOptionsServiceError("UPSTREAM_UNAVAILABLE"); }
    if (!(client instanceof OwnerSoulCharacterCatalogHttpClient) || isProxy(client) ||
        Object.getPrototypeOf(client) !== OwnerSoulCharacterCatalogHttpClient.prototype ||
        client.listCharacters !== NATIVE_LIST_METHOD || Object.hasOwn(client, "listCharacters")) {
      throw new OwnerSoulCharacterOptionsServiceError("MODEL_BINDING_MISMATCH");
    }
    return client;
  }
  async #resolvePrincipal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    try { return await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService }); }
    catch { throw new OwnerSoulCharacterOptionsServiceError("PRINCIPAL_NOT_LINKED"); }
  }
  #beginOperation(attemptId: string, parentSignal?: AbortSignal): PendingOperation {
    this.#assertOpen();
    if (this.#pendingCount >= MAX_PENDING_OPERATIONS) throw new OwnerSoulCharacterOptionsServiceError("SERVICE_BUSY");
    const controller = new AbortController(); const onAbort = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) onAbort(); else parentSignal?.addEventListener("abort", onAbort, { once: true });
    const pending = this.#pendingByAttempt.get(attemptId) ?? new Set<AbortController>(); pending.add(controller);
    this.#pendingByAttempt.set(attemptId, pending); this.#pendingCount += 1;
    let finish!: () => void; const done = new Promise<void>((resolve) => { finish = resolve; }); this.#operations.add(done);
    return { controller, done, finish, removeParentAbort: () => parentSignal?.removeEventListener("abort", onAbort) };
  }
  #finishOperation(attemptId: string, operation: PendingOperation): void {
    operation.removeParentAbort(); const pending = this.#pendingByAttempt.get(attemptId); pending?.delete(operation.controller);
    if (pending?.size === 0) this.#pendingByAttempt.delete(attemptId); this.#pendingCount -= 1; operation.finish(); this.#operations.delete(operation.done);
  }
  async #awaitSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw new OwnerSoulCharacterOptionsServiceError("UPSTREAM_REQUEST_ABORTED");
    return new Promise<T>((resolve, reject) => { const abort = () => reject(new OwnerSoulCharacterOptionsServiceError("UPSTREAM_REQUEST_ABORTED"));
      signal.addEventListener("abort", abort, { once: true }); promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort)); });
  }
  #throwIfClosedOrAborted(operation: AbortController): void {
    this.#assertOpen(); if (operation.signal.aborted) throw new OwnerSoulCharacterOptionsServiceError("UPSTREAM_REQUEST_ABORTED");
  }
  #throwIfClosed(): void { this.#assertOpen(); }
  #assertOpen(): void { if (this.#closed) throw new OwnerSoulCharacterOptionsServiceError("SERVICE_CLOSED"); }
  #safeNow(): number {
    let now: unknown; try { now = this.#now(); } catch { throw new OwnerSoulCharacterOptionsServiceError("INVALID_REQUEST"); }
    if (!Number.isSafeInteger(now) || (now as number) < 0 || (now as number) < this.#lastNow) throw new OwnerSoulCharacterOptionsServiceError("INVALID_REQUEST");
    this.#lastNow = now as number; return now as number;
  }
  #pruneExpired(now: number): void { for (const record of this.#handles.values()) if (record.expires_at <= now) this.#removeHandle(record.character_handle); }
  #removeHandle(handle: string): void {
    const record = this.#handles.get(handle); if (!record) return; this.#handles.delete(handle);
    const handles = this.#handlesByAttempt.get(record.attemptId); handles?.delete(handle); if (handles?.size === 0) this.#handlesByAttempt.delete(record.attemptId);
  }
  #removeAttemptHandles(attemptId: string): void {
    for (const handle of this.#handlesByAttempt.get(attemptId) ?? []) this.#handles.delete(handle);
    this.#handlesByAttempt.delete(attemptId);
  }
}

export type OwnerSoulCharacterOptionsServicePort = Pick<OwnerSoulCharacterOptionsService,
  "listOptions" | "resolveCharacterHandle" | "revalidateCharacterHandle" | "invalidateAttempt" | "close">;

export function isOwnerSoulCharacterHandleResolution(value: unknown): value is OwnerSoulCharacterHandleResolution {
  return value !== null && typeof value === "object" && RESOLUTIONS.get(value) !== undefined;
}
export function isOwnerSoulRevalidatedCharacterHandle(value: unknown): value is RevalidatedOwnerSoulCharacterHandle {
  if (value === null || typeof value !== "object") return false;
  const state = RESOLUTIONS.get(value);
  if (!state || state.kind !== "REVALIDATED") return false;
  return state.owner.isRevalidatedCharacterForContext(value, {
    attemptId: state.record.attemptId, principal: state.principal, character_handle: state.record.character_handle,
    model_id: MODEL_ID, catalog_version: state.record.catalog_version, source_mapping_sha256: SOURCE_MAPPING_SHA256,
    profile_schema_hash: state.record.profile_schema_hash
  });
}
export function isOwnerSoulRevalidatedCharacterForContext(value: unknown, context: unknown): value is RevalidatedOwnerSoulCharacterHandle {
  if (value === null || typeof value !== "object") return false;
  const state = RESOLUTIONS.get(value);
  return state?.kind === "REVALIDATED" && state.owner.isRevalidatedCharacterForContext(value, context);
}
/** Private continuation metadata; usable only for the exact live issuer context. */
export function readOwnerSoulCharacterRevalidationProvenance(
  serviceInput: unknown, value: unknown, context: unknown
): Readonly<OwnerSoulCharacterRevalidationProvenance> | null {
  if (!(serviceInput instanceof OwnerSoulCharacterOptionsService) || isProxy(serviceInput) ||
      value === null || typeof value !== "object") return null;
  const state = RESOLUTIONS.get(value);
  if (!state || state.owner !== serviceInput || state.kind !== "REVALIDATED" ||
      !serviceInput.isRevalidatedCharacterForContext(value, context)) return null;
  return Object.freeze({ original_expires_at_ms: state.record.expires_at, catalog_version: state.record.catalog_version,
    source_mapping_sha256: SOURCE_MAPPING_SHA256, profile_schema_hash: state.record.profile_schema_hash });
}
export async function getOwnerSoulCharacterReferenceId(value: unknown, context: unknown): Promise<SoulCharacterReferenceId> {
  if (value === null || typeof value !== "object") throw new OwnerSoulCharacterOptionsServiceError("OPTION_HANDLE_NOT_FOUND");
  const state = RESOLUTIONS.get(value);
  if (!state || state.kind !== "REVALIDATED") throw new OwnerSoulCharacterOptionsServiceError("OPTION_HANDLE_NOT_FOUND");
  return state.readReferenceId(context);
}

function normalizeCharacterSnapshot(input: OwnerSoulCharacterCatalogSnapshot | unknown): DecodedSnapshot {
  try { return decodeCharacterSnapshot(input); }
  catch (error) {
    if (error instanceof OwnerSoulCharacterOptionsServiceError && error.code === "SOURCE_SNAPSHOT_INVALID") throw error;
    throw new OwnerSoulCharacterOptionsServiceError("SOURCE_SNAPSHOT_INVALID");
  }
}
function decodeCharacterSnapshot(input: unknown): DecodedSnapshot {
  const snapshot = readExactRecord(input, ["records", "summary"]);
  const rows = readDenseArray(snapshot.records, MAX_RECORDS_PER_ATTEMPT);
  const summary = readCharacterSummary(snapshot.summary, rows);
  const output: SnapshotRecord[] = []; const recordIds = new Set<string>(); const referenceIds = new Set<string>();
  for (const rowInput of rows) {
    const row = readExactRecord(rowInput, ["record_id", "reference_id", "title", "status", "selectable"]);
    const recordId = parseCharacterId(row.record_id); const referenceId = parseOptionalCharacterId(row.reference_id);
    const title = boundedText(row.title, 256); const status = boundedText(row.status, 64);
    if (recordId === null || title === null || status === null || typeof row.selectable !== "boolean") invalid("SOURCE_SNAPSHOT_INVALID");
    const identity = typedIdentity(recordId); if (recordIds.has(identity)) invalid("SOURCE_SNAPSHOT_INVALID"); recordIds.add(identity);
    const selectable = status === "completed" && referenceId !== null;
    if (row.selectable !== selectable || (status === "completed" && referenceId === null)) invalid("SOURCE_SNAPSHOT_INVALID");
    if (selectable) { const referenceIdentity = typedIdentity(referenceId); if (referenceIds.has(referenceIdentity)) invalid("SOURCE_SNAPSHOT_INVALID"); referenceIds.add(referenceIdentity); }
    output.push(Object.freeze({ record_id: recordId, reference_id: referenceId, title, status, selectable }));
  }
  assertSummaryMatches(summary, output);
  return Object.freeze({ records: Object.freeze(output), summary });
}
function readCharacterSummary(value: unknown, rows: readonly unknown[]): OwnerSoulCharacterCatalogValidationSummary {
  const fields = readExactRecord(value, ["route", "response_bytes", "outcome", "record_count", "total_matches", "selectable_count", "status_counts",
    "record_id_type_counts", "reference_id_type_counts", "title_utf8_bytes", "unknown_top_level_key_count", "unknown_item_key_count"]);
  const statusCounts = readExactRecord(fields.status_counts, [...SOURCE_STATUSES, "unknown"]);
  const recordTypes = readExactRecord(fields.record_id_type_counts, ["string", "number"]);
  const referenceTypes = readExactRecord(fields.reference_id_type_counts, ["string", "number", "null", "missing"]);
  const titleRange = readExactRecord(fields.title_utf8_bytes, ["min", "max"]);
  const values = [fields.response_bytes, fields.record_count, fields.selectable_count, fields.unknown_top_level_key_count,
    fields.unknown_item_key_count, ...Object.values(statusCounts), ...Object.values(recordTypes), ...Object.values(referenceTypes), titleRange.min, titleRange.max];
  if (fields.route !== "hf/lora/list" || !values.every((value) => Number.isSafeInteger(value) && (value as number) >= 0) ||
      (fields.response_bytes as number) > 65_536 || fields.record_count !== rows.length || fields.total_matches !== true ||
      fields.outcome !== (rows.length === 0 ? "EMPTY_INCONCLUSIVE" : "SHAPE_OBSERVED")) invalid("SOURCE_SNAPSHOT_INVALID");
  return Object.freeze({ route: "hf/lora/list", response_bytes: fields.response_bytes as number,
    outcome: fields.outcome as OwnerSoulCharacterCatalogValidationSummary["outcome"], record_count: fields.record_count as number,
    total_matches: true, selectable_count: fields.selectable_count as number,
    status_counts: Object.freeze({ "not-ready": statusCounts["not-ready"] as number, "in-progress": statusCounts["in-progress"] as number,
      queue: statusCounts.queue as number, error: statusCounts.error as number, completed: statusCounts.completed as number, unknown: statusCounts.unknown as number }),
    record_id_type_counts: Object.freeze({ string: recordTypes.string as number, number: recordTypes.number as number }),
    reference_id_type_counts: Object.freeze({ string: referenceTypes.string as number, number: referenceTypes.number as number,
      null: referenceTypes.null as number, missing: referenceTypes.missing as number }),
    title_utf8_bytes: Object.freeze({ min: titleRange.min as number, max: titleRange.max as number }),
    unknown_top_level_key_count: fields.unknown_top_level_key_count as number, unknown_item_key_count: fields.unknown_item_key_count as number });
}
function assertSummaryMatches(summary: OwnerSoulCharacterCatalogValidationSummary, rows: readonly SnapshotRecord[]): void {
  const statuses: Record<string, number> = { "not-ready": 0, "in-progress": 0, queue: 0, error: 0, completed: 0, unknown: 0 };
  const recordTypes = { string: 0, number: 0 }; const referenceTypes = { string: 0, number: 0, null: 0, missing: 0 };
  const titleBytes = rows.map((row) => Buffer.byteLength(row.title, "utf8")); let selectable = 0;
  for (const row of rows) {
    const status = (SOURCE_STATUSES as readonly string[]).includes(row.status) ? row.status : "unknown";
    statuses[status] = (statuses[status] ?? 0) + 1;
    recordTypes[typeof row.record_id === "string" ? "string" : "number"] += 1;
    if (row.reference_id === null) referenceTypes.null += 1;
    else if (typeof row.reference_id === "string") referenceTypes.string += 1;
    else referenceTypes.number += 1;
    if (row.selectable) selectable += 1;
  }
  const min = titleBytes.length === 0 ? 0 : Math.min(...titleBytes); const max = titleBytes.length === 0 ? 0 : Math.max(...titleBytes);
  if (summary.selectable_count !== selectable || summary.title_utf8_bytes.min !== min || summary.title_utf8_bytes.max !== max ||
      Object.keys(statuses).some((key) => summary.status_counts[key as keyof typeof summary.status_counts] !== statuses[key]) ||
      summary.record_id_type_counts.string !== recordTypes.string || summary.record_id_type_counts.number !== recordTypes.number ||
      summary.reference_id_type_counts.string !== referenceTypes.string || summary.reference_id_type_counts.number !== referenceTypes.number ||
      summary.reference_id_type_counts.null + summary.reference_id_type_counts.missing !== referenceTypes.null ||
      summary.reference_id_type_counts.string + summary.reference_id_type_counts.number +
        summary.reference_id_type_counts.null + summary.reference_id_type_counts.missing !== rows.length) invalid("SOURCE_SNAPSHOT_INVALID");
  // The decoder intentionally normalizes missing and explicit null references alike per row;
  // preserve its separate aggregate counts without inventing a per-record missing marker.
}

function snapshotListInput(value: unknown): { attemptId: string; signal?: AbortSignal } {
  const fields = readExactRecord(value, ["attemptId", "signal"], ["attemptId"]);
  return { attemptId: safeAttempt(fields.attemptId), ...(fields.signal === undefined ? {} : { signal: safeSignal(fields.signal) }) };
}
function snapshotResolveInput(value: unknown): { attemptId: string; character_handle: string; signal?: AbortSignal } {
  const fields = readExactRecord(value, ["attemptId", "character_handle", "signal"], ["attemptId", "character_handle"]);
  const attemptId = safeAttempt(fields.attemptId);
  if (typeof fields.character_handle !== "string" || !HANDLE_PATTERN.test(fields.character_handle)) invalid("INVALID_REQUEST");
  return { attemptId, character_handle: fields.character_handle,
    ...(fields.signal === undefined ? {} : { signal: safeSignal(fields.signal) }) };
}
function snapshotResolutionContext(value: unknown): Readonly<OwnerSoulCharacterResolutionContext> {
  const fields = readExactRecord(value, ["attemptId", "principal", "character_handle", "model_id", "catalog_version", "source_mapping_sha256", "profile_schema_hash"]);
  const attemptId = safeAttempt(fields.attemptId); const principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef);
  if (typeof fields.character_handle !== "string" || !HANDLE_PATTERN.test(fields.character_handle) || fields.model_id !== MODEL_ID ||
      fields.catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION || fields.source_mapping_sha256 !== SOURCE_MAPPING_SHA256 ||
      typeof fields.profile_schema_hash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(fields.profile_schema_hash) || principal.connection_id !== attemptId) {
    invalid("INVALID_REQUEST");
  }
  return Object.freeze({ attemptId, principal, character_handle: fields.character_handle, model_id: MODEL_ID,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, source_mapping_sha256: SOURCE_MAPPING_SHA256, profile_schema_hash: fields.profile_schema_hash });
}
function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = readExactRecord(value, ["tenant_id", "subject"]);
  if (!boundedText(fields.tenant_id, 256) || !boundedText(fields.subject, 512)) invalid("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id as string, subject: fields.subject as string });
}
function snapshotLinkService(value: unknown): Pick<PerUserLinkService, "getStatus"> {
  if (!value || typeof value !== "object" || isProxy(value)) invalid("INVALID_REQUEST");
  const method = dataMethod(value, "getStatus");
  if (typeof method !== "function" || isProxy(method)) invalid("INVALID_REQUEST");
  return Object.freeze({ getStatus: (binding: AuthBinding, attemptId: string) => Reflect.apply(method, value, [binding, attemptId]) }) as Pick<PerUserLinkService, "getStatus">;
}
function readExactRecord(value: unknown, keys: readonly string[], required: readonly string[] = keys): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) invalid("INVALID_REQUEST");
  let prototype: object | null; let descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); } catch { invalid("INVALID_REQUEST"); }
  if (prototype !== Object.prototype && prototype !== null) invalid("INVALID_REQUEST");
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some((key) => typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) ||
      required.some((key) => !Object.hasOwn(descriptors, key))) invalid("INVALID_REQUEST");
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of ownKeys as string[]) output[key] = descriptors[key]!.value;
  return output;
}
function readDenseArray(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) invalid("SOURCE_SNAPSHOT_INVALID");
  const descriptors = Object.getOwnPropertyDescriptors(value); const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" && (typeof key !== "string" ||
      !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable))) {
    invalid("SOURCE_SNAPSHOT_INVALID");
  }
  return Array.from({ length: value.length }, (_, index) => descriptors[String(index)]!.value);
}
function parseCharacterId(value: unknown): SoulCharacterReferenceId | null {
  if (typeof value === "string") return boundedText(value, 256);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  return null;
}
function parseOptionalCharacterId(value: unknown): SoulCharacterReferenceId | null {
  if (value === null) return null;
  return parseCharacterId(value);
}
function boundedText(value: unknown, maxBytes: number): string | null {
  if (typeof value !== "string" || value.length === 0 || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const bytes = Buffer.byteLength(value, "utf8"); return bytes > 0 && bytes <= maxBytes ? value : null;
}
function typedIdentity(value: SoulCharacterReferenceId): string { return `${typeof value}:${typeof value === "string" ? value : value.toString(10)}`; }
function typedIdEqual(left: SoulCharacterReferenceId | null, right: SoulCharacterReferenceId | null): boolean {
  return left === null ? right === null : right !== null && typeof left === typeof right && left === right;
}
function isSelectableRecord(record: SnapshotRecord): record is SnapshotRecord & { readonly reference_id: SoulCharacterReferenceId } {
  return record.status === "completed" && record.reference_id !== null && record.selectable;
}
function referenceIdType(value: SoulCharacterReferenceId | null): "string" | "number" | "unavailable" {
  return value === null ? "unavailable" : typeof value === "string" ? "string" : "number";
}
function dataMethod(target: object, key: string): unknown {
  let current: object | null = target;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}
function safeAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT_PATTERN.test(value)) invalid("INVALID_REQUEST"); return value; }
function safeSignal(value: unknown): AbortSignal { if (!(value instanceof AbortSignal) || isProxy(value)) invalid("INVALID_REQUEST"); return value; }
function mapServiceError(error: unknown, signal: AbortSignal): OwnerSoulCharacterOptionsServiceError {
  if (error instanceof OwnerSoulCharacterOptionsServiceError) return error;
  if (error instanceof OwnerReferencePrincipalError) return new OwnerSoulCharacterOptionsServiceError("PRINCIPAL_NOT_LINKED");
  if (error instanceof OwnerSoulCharacterCatalogHttpError) {
    if (error.code === "AUTH_REQUIRED" || error.code === "AUTH_OR_ACCESS_DENIED") return new OwnerSoulCharacterOptionsServiceError("PRINCIPAL_NOT_LINKED");
    if (error.code === "UPSTREAM_TIMEOUT") return new OwnerSoulCharacterOptionsServiceError("UPSTREAM_TIMEOUT");
    if (error.code === "UPSTREAM_REQUEST_ABORTED") return new OwnerSoulCharacterOptionsServiceError("UPSTREAM_REQUEST_ABORTED");
    if (error.code === "UPSTREAM_PROTOCOL_ERROR") return new OwnerSoulCharacterOptionsServiceError("UPSTREAM_PROTOCOL_ERROR");
  }
  if (signal.aborted) return new OwnerSoulCharacterOptionsServiceError("UPSTREAM_REQUEST_ABORTED");
  return new OwnerSoulCharacterOptionsServiceError("UPSTREAM_UNAVAILABLE");
}
function invalid(code: OwnerSoulCharacterOptionsServiceErrorCode = "INVALID_REQUEST"): never { throw new OwnerSoulCharacterOptionsServiceError(code); }

function exactRecord(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  return readExactRecord(value, keys, keys.filter((key) => !optional.includes(key)));
}
