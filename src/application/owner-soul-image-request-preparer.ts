import { isProxy } from "node:util/types";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import {
  OwnerSoulCharacterOptionsService,
  OwnerSoulCharacterOptionsServiceError,
  getOwnerSoulCharacterReferenceId,
  readOwnerSoulCharacterRevalidationProvenance,
  type OwnerSoulCharacterResolutionContext,
  type RevalidatedOwnerSoulCharacterHandle
} from "./owner-soul-character-options-service.js";
import {
  OwnerSoulStyleOptionsService,
  OwnerSoulStyleOptionsServiceError,
  readOwnerSoulStyleRevalidationProvenance,
  type OwnerSoulStyleRevalidationContext,
  type RevalidatedOwnerSoulStyleHandle
} from "./owner-soul-style-options-service.js";
import {
  OwnerSoulGenerationParametersError,
  normalizeOwnerSoulGenerationParameters,
  type OwnerSoulGenerationParametersInput,
  type OwnerSoulGenerationQuality,
  type OwnerSoulGenerationResolution
} from "./owner-soul-generation-parameters.js";
import { projectOwnerSoulImageCostParameters } from "./owner-soul-image-cost-parameters.js";
import {
  getOwnerSoulImageSourceProfile,
  type OwnerSoulImageCatalogPort,
  type OwnerSoulImageSourceProfile
} from "./owner-soul-image-source-profile.js";

const MODEL_ID = "higgsfield-soul" as const;
const SOURCE_MAPPING_SHA256 = "sha256:a11bcb0b533f7f3f9f1668e5bab290ef5d0ba85410df5b78f18e361db96b9391" as const;
const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const NONE_TTL_MS = 15 * 60_000;
const MAX_ACTIVE = 128;
const MAX_PENDING = 4;
const NATIVE_STYLE_REVALIDATE = OwnerSoulStyleOptionsService.prototype.revalidateStyleHandle;
const NATIVE_STYLE_GUARD = OwnerSoulStyleOptionsService.prototype.isRevalidatedStyleForContext;
const NATIVE_CHARACTER_REVALIDATE = OwnerSoulCharacterOptionsService.prototype.revalidateCharacterHandle;
const NATIVE_CHARACTER_GUARD = OwnerSoulCharacterOptionsService.prototype.isRevalidatedCharacterForContext;

export type OwnerSoulImageRequestPrepareErrorCode =
  | "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH" | "PRINCIPAL_NOT_LINKED" | "PRINCIPAL_MISMATCH"
  | "STYLE_UNAVAILABLE" | "CHARACTER_UNAVAILABLE" | "HANDLE_EXPIRED" | "SERVICE_BUSY"
  | "CAPACITY_EXCEEDED" | "REQUEST_ABORTED" | "SERVICE_CLOSED";

export class OwnerSoulImageRequestPrepareError extends Error {
  constructor(readonly code: OwnerSoulImageRequestPrepareErrorCode) {
    super("The owner Soul image request could not be prepared safely.");
    this.name = "OwnerSoulImageRequestPrepareError";
  }
}

export interface OwnerSoulImageRequestPreparerOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly styleOptionsService: OwnerSoulStyleOptionsService;
  readonly characterOptionsService: OwnerSoulCharacterOptionsService;
  readonly catalog: OwnerSoulImageCatalogPort;
  readonly catalog_version: string;
  readonly now?: () => number;
}

export interface PrepareOwnerSoulImageRequestInput {
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly input: OwnerSoulGenerationParametersInput;
  readonly signal?: AbortSignal;
}

export interface OwnerSoulImagePreparedRequest {
  readonly prompt: string;
  readonly settings: Readonly<Record<string, unknown>>;
}

export interface OwnerSoulImagePreparedCandidate {
  readonly status: "PREPARED_SOURCE_SHAPED";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly provider_execution: false;
  readonly profile_id: OwnerSoulImageSourceProfile["profile_id"];
  readonly profile_schema_hash: string;
  readonly source_binding: OwnerSoulImageSourceProfile["source_binding"];
  readonly model_id: typeof MODEL_ID;
  readonly ai_name: typeof MODEL_ID;
  readonly model_type: typeof MODEL_ID;
  readonly catalog_version: typeof CATALOG_VERSION;
  readonly parameters: Readonly<{
    quality: OwnerSoulGenerationQuality;
    resolution: OwnerSoulGenerationResolution;
    batch_size: 1 | 4;
    enhance_prompt: boolean;
    seed: number | null;
    style: Readonly<{ kind: "none" } | { kind: "selected"; strength: number }>;
    character: Readonly<{ kind: "none" } | { kind: "selected" }>;
  }>;
  readonly selection: Readonly<{ style: "none" | "selected"; character: "none" | "selected" }>;
  readonly cost_routing: Readonly<{ ai_name: typeof MODEL_ID; model_type: typeof MODEL_ID }>;
  readonly cost_inputs: Readonly<{ quality: OwnerSoulGenerationQuality; resolution: OwnerSoulGenerationResolution; batch_size: 1 | 4 }>;
  readonly cost_confidence: "SOURCE_JOINED_COST2_QUERY_FIELDS_NOT_QUOTE_BILLING_OR_HARDCAP";
  readonly source_projection_confidence: "EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY";
  readonly reference_strength: "UNRESOLVED_UNCONTROLLED_WIRE_FIELD";
  readonly expires_at_ms: number;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly request: OwnerSoulImagePreparedRequest;
}

interface PreparedState {
  readonly owner: OwnerSoulImageRequestPreparer;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
  readonly epoch: number;
  readonly profile: Readonly<OwnerSoulImageSourceProfile>;
  readonly expiresAt: number;
  readonly style?: { readonly handle: string; readonly value: RevalidatedOwnerSoulStyleHandle; readonly context: OwnerSoulStyleRevalidationContext };
  readonly character?: { readonly handle: string; readonly value: RevalidatedOwnerSoulCharacterHandle; readonly context: OwnerSoulCharacterResolutionContext };
  readonly requestFingerprint: string;
}

interface Operation { readonly attemptId: string; readonly controller: AbortController; readonly done: Promise<void>; readonly finish: () => void; readonly removeAbort: () => void; }
const CANDIDATES = new WeakMap<object, PreparedState>();
const REVOKED = new WeakSet<object>();

/** Builds an explicit, private Soul request projection; this does not dispatch or grant provider acceptance. */
export class OwnerSoulImageRequestPreparer {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #styles: OwnerSoulStyleOptionsService;
  readonly #characters: OwnerSoulCharacterOptionsService;
  readonly #catalog: OwnerSoulImageCatalogPort;
  readonly #now: () => number;
  readonly #candidates = new Set<object>();
  readonly #epochs = new Map<string, number>();
  readonly #operations = new Set<Operation>();
  #pending = 0;
  #closed = false;
  #lastNow = -1;
  #closing: Promise<void> | undefined;

  constructor(optionsInput: OwnerSoulImageRequestPreparerOptions | unknown) {
    const fields = exactRecord(optionsInput, ["binding", "linkService", "styleOptionsService", "characterOptionsService", "catalog", "catalog_version", "now"], ["now"]);
    if (fields.catalog_version !== CATALOG_VERSION || !isLinkServicePort(fields.linkService) ||
        !(fields.catalog instanceof DiscoveryCatalogRepository) || isProxy(fields.catalog) ||
        Object.getPrototypeOf(fields.catalog) !== DiscoveryCatalogRepository.prototype ||
        (fields.now !== undefined && (typeof fields.now !== "function" || isProxy(fields.now))) ||
        !isNativeService(fields.styleOptionsService, OwnerSoulStyleOptionsService, ["revalidateStyleHandle", "isRevalidatedStyleForContext"]) ||
        !isNativeService(fields.characterOptionsService, OwnerSoulCharacterOptionsService, ["revalidateCharacterHandle", "isRevalidatedCharacterForContext"])) fail("PROFILE_BINDING_MISMATCH");
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = fields.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#styles = fields.styleOptionsService as OwnerSoulStyleOptionsService;
    this.#characters = fields.characterOptionsService as OwnerSoulCharacterOptionsService;
    this.#catalog = fields.catalog as OwnerSoulImageCatalogPort;
    this.#now = fields.now as (() => number) | undefined ?? Date.now;
    this.#profile();
  }

  async prepare(input: PrepareOwnerSoulImageRequestInput | unknown): Promise<OwnerSoulImagePreparedCandidate> {
    const request = snapshotPrepareInput(input);
    this.#assertOpen();
    if (request.signal?.aborted) fail("REQUEST_ABORTED");
    if (this.#pending >= MAX_PENDING) fail("SERVICE_BUSY");
    this.#pruneExpired(this.#readNow());
    if (this.#candidates.size >= MAX_ACTIVE) fail("CAPACITY_EXCEEDED");
    const profile = this.#profile();
    const normalized = normalizeIntent(request.input);
    const operation = this.#begin(request.attemptId, request.signal);
    const epoch = this.#epochs.get(request.attemptId) ?? 0;
    try {
      const principal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfAborted(operation.controller.signal);
      if (!sameGenerationPrincipal(principal, request.principal)) fail("PRINCIPAL_MISMATCH");
      const freshStyle = normalized.style.kind === "selected"
        ? await this.#revalidateStyle(request.attemptId, principal, normalized.style.style_handle, operation.controller.signal)
        : undefined;
      this.#throwIfAborted(operation.controller.signal);
      const freshCharacter = normalized.character.kind === "selected"
        ? await this.#revalidateCharacter(request.attemptId, principal, normalized.character.character_handle, profile, operation.controller.signal)
        : undefined;
      this.#throwIfAborted(operation.controller.signal);
      const currentPrincipal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfAborted(operation.controller.signal);
      if (!sameGenerationPrincipal(principal, currentPrincipal) || !sameGenerationPrincipal(principal, request.principal)) fail("PRINCIPAL_NOT_LINKED");
      if ((this.#epochs.get(request.attemptId) ?? 0) !== epoch) fail("HANDLE_EXPIRED");
      const currentProfile = this.#profile();
      if (currentProfile.profile_schema_hash !== profile.profile_schema_hash || currentProfile.public_catalog_version !== profile.public_catalog_version) fail("PROFILE_BINDING_MISMATCH");
      if (freshStyle && !this.#styleGuard(freshStyle.value, freshStyle.context)) fail("STYLE_UNAVAILABLE");
      if (freshCharacter && !this.#characterGuard(freshCharacter.value, freshCharacter.context)) fail("CHARACTER_UNAVAILABLE");
      const now = this.#readNow();
      if (now > Number.MAX_SAFE_INTEGER - NONE_TTL_MS) fail("INVALID_REQUEST");
      const expiresAt = Math.min(now + NONE_TTL_MS,
        ...(freshStyle ? [freshStyle.provenance.original_expires_at_ms] : []),
        ...(freshCharacter ? [freshCharacter.provenance.original_expires_at_ms] : []));
      if (expiresAt <= now) fail("HANDLE_EXPIRED");
      const styleId = freshStyle?.value.style_id ?? "";
      let characterId: string | number = "";
      if (freshCharacter) {
        try { characterId = await getOwnerSoulCharacterReferenceId(freshCharacter.value, freshCharacter.context); }
        catch (error) { fail(mapSelectorError(error, "CHARACTER_UNAVAILABLE")); }
        if ((typeof characterId === "number" && (!Number.isSafeInteger(characterId) || characterId < 0)) ||
            (typeof characterId === "string" && (characterId.length === 0 || characterId.length > 512 || /[\u0000-\u001f\u007f]/u.test(characterId))) ||
            (typeof characterId !== "number" && typeof characterId !== "string")) fail("CHARACTER_UNAVAILABLE");
      }
      this.#throwIfAborted(operation.controller.signal);
      if (freshCharacter && !this.#characterGuard(freshCharacter.value, freshCharacter.context)) fail("CHARACTER_UNAVAILABLE");
      if (freshStyle && !this.#styleGuard(freshStyle.value, freshStyle.context)) fail("STYLE_UNAVAILABLE");
      const settings = Object.freeze({ n: 1, model_type: MODEL_ID, quality: normalized.quality, resolution: normalized.resolution,
        batch_size: normalized.batch_size, enhance_prompt: normalized.enhance_prompt, seed: normalized.seed,
        style_id: styleId, ...(normalized.style.kind === "selected" ? { style_strength: normalized.style.strength } : {}),
        reference_id: characterId, file_urls: Object.freeze([]) });
      const nativeRequest = Object.freeze({ prompt: normalized.prompt, settings });
      const cost = projectOwnerSoulImageCostParameters(normalized);
      const safeParameters = Object.freeze({ quality: normalized.quality, resolution: normalized.resolution, batch_size: normalized.batch_size,
        enhance_prompt: normalized.enhance_prompt, seed: normalized.seed,
        style: Object.freeze(normalized.style.kind === "selected" ? { kind: "selected" as const, strength: normalized.style.strength } : { kind: "none" as const }),
        character: Object.freeze(normalized.character.kind === "selected" ? { kind: "selected" as const } : { kind: "none" as const }) });
      const selection = Object.freeze({ style: normalized.style.kind, character: normalized.character.kind });
      const intentFingerprint = schemaHash({ tenant_id: principal.tenant_id, subject_id: principal.subject_id, model_id: MODEL_ID,
        profile_schema_hash: profile.profile_schema_hash,
        intent: { prompt: normalized.prompt, parameters: safeParameters, private_source_ids: { style_id: styleId, character_id: characterId } } });
      const requestFingerprint = schemaHash({ tenant_id: principal.tenant_id, subject_id: principal.subject_id,
        connection_id: principal.connection_id, attempt_id: request.attemptId, profile_schema_hash: profile.profile_schema_hash,
        request: nativeRequest, expires_at_ms: expiresAt });
      const candidateRecord: Record<string, unknown> = {
        status: "PREPARED_SOURCE_SHAPED", dispatch_allowed: false, backend_acceptance: "UNPROVEN", provider_execution: false,
        profile_id: profile.profile_id, profile_schema_hash: profile.profile_schema_hash, source_binding: profile.source_binding,
        model_id: MODEL_ID, ai_name: profile.ai_name, model_type: profile.model_type, catalog_version: profile.public_catalog_version,
        parameters: safeParameters, selection, cost_routing: cost.routing, cost_inputs: cost.cost_inputs,
        cost_confidence: cost.cost_inputs_confidence,
        source_projection_confidence: "EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY",
        reference_strength: "UNRESOLVED_UNCONTROLLED_WIRE_FIELD", expires_at_ms: expiresAt,
        request_fingerprint: requestFingerprint, intent_fingerprint: intentFingerprint
      };
      Object.defineProperty(candidateRecord, "request", { value: nativeRequest, enumerable: false, writable: false, configurable: false });
      Object.freeze(candidateRecord);
      const candidate = candidateRecord as unknown as OwnerSoulImagePreparedCandidate;
      CANDIDATES.set(candidate, Object.freeze({ owner: this, principal, attemptId: request.attemptId, epoch, profile, expiresAt,
        ...(freshStyle ? { style: { handle: freshStyle.handle, value: freshStyle.value, context: freshStyle.context } } : {}),
        ...(freshCharacter ? { character: { handle: freshCharacter.handle, value: freshCharacter.value, context: freshCharacter.context } } : {}),
        requestFingerprint }));
      this.#candidates.add(candidate);
      return candidate;
    } finally { this.#finish(operation); }
  }

  isPreparedCandidateForPrincipal(candidate: unknown, contextInput: unknown): candidate is OwnerSoulImagePreparedCandidate {
    try {
      const context = exactRecord(contextInput, ["attemptId", "principal"]);
      const attemptId = safeAttempt(context.attemptId);
      const principal = snapshotGenerationPrincipal(context.principal as GenerationPrincipalRef);
      if (!candidate || typeof candidate !== "object" || isProxy(candidate) || this.#closed ||
          Object.getPrototypeOf(this) !== OwnerSoulImageRequestPreparer.prototype) return false;
      const state = CANDIDATES.get(candidate as object);
      if (!state || state.owner !== this || REVOKED.has(candidate as object) || state.attemptId !== attemptId ||
          !sameGenerationPrincipal(state.principal, principal)) return false;
      const now = this.#readNow();
      if (state.expiresAt <= now || (this.#epochs.get(attemptId) ?? 0) !== state.epoch ||
          this.#profile().profile_schema_hash !== state.profile.profile_schema_hash) return false;
      if (state.style && !this.#styleGuard(state.style.value, state.style.context)) return false;
      if (state.character && !this.#characterGuard(state.character.value, state.character.context)) return false;
      const value = candidate as OwnerSoulImagePreparedCandidate;
      return value.dispatch_allowed === false && value.request_fingerprint === state.requestFingerprint &&
        value.profile_schema_hash === state.profile.profile_schema_hash && Object.isFrozen(value) && Object.isFrozen(value.request);
    } catch { return false; }
  }

  invalidateAttempt(attemptIdInput: unknown): void {
    if (typeof attemptIdInput !== "string" || !ATTEMPT_PATTERN.test(attemptIdInput)) return;
    const attemptId = attemptIdInput;
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    for (const candidate of this.#candidates) {
      const state = CANDIDATES.get(candidate);
      if (state?.attemptId === attemptId) { REVOKED.add(candidate); this.#candidates.delete(candidate); }
    }
    for (const operation of this.#operations) if (operation.attemptId === attemptId) operation.controller.abort();
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const candidate of this.#candidates) REVOKED.add(candidate);
    for (const operation of this.#operations) operation.controller.abort();
    this.#closing = Promise.allSettled([...this.#operations].map(({ done }) => done)).then(() => { this.#candidates.clear(); this.#epochs.clear(); this.#operations.clear(); });
    return this.#closing;
  }

  async #revalidateStyle(attemptId: string, principal: Readonly<GenerationPrincipalRef>, handle: string, signal: AbortSignal) {
    try {
      const value = await Reflect.apply(NATIVE_STYLE_REVALIDATE, this.#styles, [{ attemptId, styleHandle: handle, signal }]) as RevalidatedOwnerSoulStyleHandle;
      const context: OwnerSoulStyleRevalidationContext = Object.freeze({ attemptId, styleHandle: handle, principal,
        catalog_version: CATALOG_VERSION, source_mapping_sha256: SOURCE_MAPPING_SHA256 });
      if (!this.#styleGuard(value, context)) fail("STYLE_UNAVAILABLE");
      const provenance = readOwnerSoulStyleRevalidationProvenance(this.#styles, value, context);
      if (!provenance) fail("STYLE_UNAVAILABLE");
      return { handle, value, context, provenance };
    } catch (error) { if (error instanceof OwnerSoulImageRequestPrepareError) throw error; fail(mapSelectorError(error, "STYLE_UNAVAILABLE")); }
  }

  async #revalidateCharacter(attemptId: string, principal: Readonly<GenerationPrincipalRef>, handle: string,
    profile: Readonly<OwnerSoulImageSourceProfile>, signal: AbortSignal) {
    try {
      const value = await Reflect.apply(NATIVE_CHARACTER_REVALIDATE, this.#characters, [{ attemptId, character_handle: handle, signal }]) as RevalidatedOwnerSoulCharacterHandle;
      const context: OwnerSoulCharacterResolutionContext = Object.freeze({ attemptId, principal, character_handle: handle,
        model_id: MODEL_ID, catalog_version: CATALOG_VERSION, source_mapping_sha256: SOURCE_MAPPING_SHA256,
        profile_schema_hash: profile.profile_schema_hash });
      if (!this.#characterGuard(value, context)) fail("CHARACTER_UNAVAILABLE");
      const provenance = readOwnerSoulCharacterRevalidationProvenance(this.#characters, value, context);
      if (!provenance) fail("CHARACTER_UNAVAILABLE");
      return { handle, value, context, provenance };
    } catch (error) { if (error instanceof OwnerSoulImageRequestPrepareError) throw error; fail(mapSelectorError(error, "CHARACTER_UNAVAILABLE")); }
  }

  #styleGuard(value: unknown, context: OwnerSoulStyleRevalidationContext): boolean {
    try { return Reflect.apply(NATIVE_STYLE_GUARD, this.#styles, [value, context]) === true; } catch { return false; }
  }
  #characterGuard(value: unknown, context: OwnerSoulCharacterResolutionContext): boolean {
    try { return Reflect.apply(NATIVE_CHARACTER_GUARD, this.#characters, [value, context]) === true; } catch { return false; }
  }
  #profile(): Readonly<OwnerSoulImageSourceProfile> {
    try { return getOwnerSoulImageSourceProfile(MODEL_ID, this.#catalog, CATALOG_VERSION); }
    catch { fail("PROFILE_BINDING_MISMATCH"); }
  }
  async #resolvePrincipal(attemptId: string, signal: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal.aborted) fail("REQUEST_ABORTED");
    const promise = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
    let remove = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(new OwnerSoulImageRequestPrepareError("REQUEST_ABORTED"));
      if (signal.aborted) onAbort(); else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); }
    });
    try { return await Promise.race([promise, aborted]); }
    catch (error) {
      if (error instanceof OwnerSoulImageRequestPrepareError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      fail("PRINCIPAL_NOT_LINKED");
    } finally { remove(); }
  }
  #begin(attemptId: string, parent?: AbortSignal): Operation {
    this.#assertOpen();
    if (this.#pending >= MAX_PENDING) fail("SERVICE_BUSY");
    const controller = new AbortController();
    const abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const operation: Operation = { attemptId, controller, done, finish, removeAbort: () => parent?.removeEventListener("abort", abort) };
    this.#pending += 1; this.#operations.add(operation);
    return operation;
  }
  #finish(operation: Operation): void { operation.removeAbort(); this.#pending -= 1; operation.finish(); this.#operations.delete(operation); }
  #throwIfAborted(signal: AbortSignal): void { if (this.#closed) fail("SERVICE_CLOSED"); if (signal.aborted) fail("REQUEST_ABORTED"); }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  #readNow(): number {
    let now: unknown; try { now = this.#now(); } catch { fail("INVALID_REQUEST"); }
    if (!Number.isSafeInteger(now) || (now as number) < 0 || (now as number) < this.#lastNow) fail("INVALID_REQUEST");
    this.#lastNow = now as number; return now as number;
  }
  #pruneExpired(now: number): void {
    for (const candidate of this.#candidates) {
      const state = CANDIDATES.get(candidate);
      if (!state || state.expiresAt <= now || !this.#stateGuards(state)) { REVOKED.add(candidate); this.#candidates.delete(candidate); }
    }
  }
  #stateGuards(state: PreparedState): boolean {
    return (!state.style || this.#styleGuard(state.style.value, state.style.context)) &&
      (!state.character || this.#characterGuard(state.character.value, state.character.context));
  }
}

function normalizeIntent(input: unknown): Readonly<OwnerSoulGenerationParametersInput> {
  try { return normalizeOwnerSoulGenerationParameters(input).intent; }
  catch (error) { if (error instanceof OwnerSoulGenerationParametersError) fail("INVALID_REQUEST"); fail("INVALID_REQUEST"); }
}
function snapshotPrepareInput(input: unknown): Readonly<{ attemptId: string; principal: Readonly<GenerationPrincipalRef>;
  input: Readonly<OwnerSoulGenerationParametersInput>; signal?: AbortSignal }> {
  const fields = exactRecord(input, ["attemptId", "principal", "input", "signal"], ["signal"]);
  const attemptId = safeAttempt(fields.attemptId);
  const principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef);
  if (principal.connection_id !== attemptId) fail("INVALID_REQUEST");
  const normalized = normalizeIntent(fields.input);
  const signal = fields.signal === undefined ? undefined : safeSignal(fields.signal);
  return Object.freeze({ attemptId, principal, input: normalized, ...(signal ? { signal } : {}) });
}
function exactRecord(input: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input) || isProxy(input)) fail("INVALID_REQUEST");
  let descriptors: PropertyDescriptorMap; try { descriptors = Object.getOwnPropertyDescriptors(input); } catch { fail("INVALID_REQUEST"); }
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !keys.includes(key)) ||
      keys.some((key) => !optional.includes(key) && !Object.hasOwn(descriptors, key))) fail("INVALID_REQUEST");
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor) continue;
    if (!("value" in descriptor) || descriptor.get || descriptor.set) fail("INVALID_REQUEST");
    output[key] = descriptor.value;
  }
  return output;
}
function safeAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT_PATTERN.test(value)) fail("INVALID_REQUEST"); return value; }
function safeSignal(value: unknown): AbortSignal { if (isProxy(value) || !(value instanceof AbortSignal)) fail("INVALID_REQUEST"); return value; }
function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || !fields.tenant_id || typeof fields.subject !== "string" || !fields.subject) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}
function isLinkServicePort(value: unknown): boolean {
  if (!value || typeof value !== "object" || isProxy(value)) return false;
  let current: object | null = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, "getStatus");
    if (descriptor) return "value" in descriptor && typeof descriptor.value === "function" && !isProxy(descriptor.value);
    current = Object.getPrototypeOf(current) as object | null;
  }
  return false;
}
function isNativeService<T extends object>(value: unknown, ctor: new (...args: never[]) => T, methods: readonly string[]): value is T {
  if (!value || typeof value !== "object" || isProxy(value) || !(value instanceof ctor) || Object.getPrototypeOf(value) !== ctor.prototype) return false;
  return methods.every((method) => !Object.hasOwn(value, method) && typeof Reflect.get(ctor.prototype, method) === "function");
}
function mapSelectorError(error: unknown, fallback: "STYLE_UNAVAILABLE" | "CHARACTER_UNAVAILABLE"): OwnerSoulImageRequestPrepareErrorCode {
  if (error instanceof OwnerSoulStyleOptionsServiceError || error instanceof OwnerSoulCharacterOptionsServiceError) {
    if (error.code === "OPTION_HANDLE_EXPIRED") return "HANDLE_EXPIRED";
    if (error.code === "PRINCIPAL_NOT_LINKED") return "PRINCIPAL_NOT_LINKED";
    if (error.code === "SERVICE_CLOSED") return "SERVICE_CLOSED";
    if (error.code === "SERVICE_BUSY") return "SERVICE_BUSY";
  }
  return fallback;
}
function fail(code: OwnerSoulImageRequestPrepareErrorCode): never { throw new OwnerSoulImageRequestPrepareError(code); }
