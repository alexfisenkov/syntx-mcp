import { randomUUID } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import { snapshotGenerationPrincipal, sameGenerationPrincipal } from "../domain/generation-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { schemaHash } from "../domain/generation-contract.js";
import { loadSelectedDiscoveryCatalog } from "../catalog/selected-discovery-catalog.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { AccountStatusService } from "./account-status.js";
import { ModelAccessService } from "./model-access.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { OwnerSeedream55EditorNative, type OwnerSeedream55EditorNativeObservation,
  type OwnerSeedream55EditorDispatchRequest } from "../adapter/syntx/owner-seedream55-editor-native.js";
import { validateOwnerSeedreamImageInput } from "./owner-seedream-image-input-validator.js";
import { validateOwnerSeedreamEditorDrawingInput } from "./owner-seedream-editor-drawing-input-validator.js";
import { getOwnerSeedream55EditorSourceProfile } from "./owner-seedream55-editor-source-profile.js";
import { normalizeOwnerSeedream55EditorParameters, projectOwnerSeedream55EditorCost } from "./owner-seedream55-editor-parameters.js";
import { SEEDREAM55_PUBLIC_CATALOG_VERSION } from "./owner-seedream55-image-source-profile.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const ORIGINAL = /^seedream55_editor_original_[0-9a-f-]{36}$/u;
const DRAWING = /^seedream55_editor_drawing_[0-9a-f-]{36}$/u;
const RECOVERY = /^seedream55_editor_recovery_[0-9a-f-]{36}$/u;
const RESULT = /^seedream55_editor_result_[0-9a-f-]{36}$/u;
const TTL_MS = 15 * 60_000;
const MAX_HANDLES = 128, MAX_CLAIMS = 128, MAX_RECOVERIES = 128, MAX_RESULTS = 128;
const PAGE_SIZE = 64;
const catalog = loadSelectedDiscoveryCatalog(SEEDREAM55_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const profile = getOwnerSeedream55EditorSourceProfile();
const TOKEN_BRAND: unique symbol = Symbol("OwnerSeedream55EditorDispatchToken");
export interface OwnerSeedream55EditorDispatchToken { readonly [TOKEN_BRAND]: true }
interface TokenState { readonly service: OwnerSeedream55EditorService; readonly native: OwnerSeedream55EditorNative;
  readonly request: OwnerSeedream55EditorDispatchRequest; used: boolean }
const tokens = new WeakMap<object, TokenState>();

export interface OwnerSeedream55EditorServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveNative: (attemptId: string) => OwnerSeedream55EditorNative;
  readonly createAccountStatusService: (attemptId: string) => AccountStatusService;
  readonly createModelAccessService: (attemptId: string, catalog: DiscoveryCatalogRepository) => ModelAccessService;
  readonly now?: () => number;
}
type Role = "original" | "drawing";
interface Reference {
  readonly handle: string; readonly role: Role; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly native: OwnerSeedream55EditorNative; readonly fileUrl: string; readonly sha256: string;
  readonly mimeType: string; readonly sourceMimeType: string; readonly width: number; readonly height: number;
  readonly size: number; readonly expiresAt: number; readonly originalHandle: string | null;
}
interface Recovery {
  readonly id: string; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly native: OwnerSeedream55EditorNative; readonly chatUuid: string; readonly requestFingerprint: string;
  readonly costInputs: Readonly<{ batch_size: 1 | 2; resolution: "1K" | "1.5K" | "2K" }>;
  readonly createdAt: string; status: "OUTCOME_UNKNOWN" | "COMPLETE"; resultId: string | null;
}
export interface OwnerSeedream55EditorArtifact { readonly url: string; readonly mime_type: string | null;
  readonly width: null; readonly height: null; readonly geometry_verified: false }
interface ResultRecord { readonly id: string; readonly recovery: Recovery; readonly artifacts: readonly OwnerSeedream55EditorArtifact[] }
export class OwnerSeedream55EditorServiceError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "PRINCIPAL_NOT_LINKED" | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED" |
    "UPLOAD_OUTCOME_UNKNOWN" | "PREFLIGHT_FAILED" | "SERVICE_BUSY" | "SERVICE_CLOSED" |
    "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND" | "RESULT_NOT_FOUND",
    readonly recovery_id?: string) {
    super("Seedream 5.5 Editor operation is unavailable."); this.name = "OwnerSeedream55EditorServiceError";
  }
}

export class OwnerSeedream55EditorService {
  readonly #binding: AuthBinding;
  readonly #link: Pick<PerUserLinkService, "getStatus">;
  readonly #resolveNative: OwnerSeedream55EditorServiceOptions["resolveNative"];
  readonly #createAccount: OwnerSeedream55EditorServiceOptions["createAccountStatusService"];
  readonly #createAccess: OwnerSeedream55EditorServiceOptions["createModelAccessService"];
  readonly #now: () => number;
  readonly #references = new Map<string, Reference>();
  readonly #natives = new Map<string, OwnerSeedream55EditorNative>();
  readonly #uploadKeys = new Set<string>();
  readonly #claims = new Set<string>();
  readonly #recoveries = new Map<string, Recovery>();
  readonly #results = new Map<string, ResultRecord>();
  readonly #pending = new Set<string>();
  readonly #epochs = new Map<string, number>();
  #closed = false;
  constructor(options: OwnerSeedream55EditorServiceOptions) {
    if (!options || typeof options !== "object" || types.isProxy(options) ||
        typeof options.resolveNative !== "function" || typeof options.createAccountStatusService !== "function" ||
        typeof options.createModelAccessService !== "function" || typeof options.linkService?.getStatus !== "function") fail("INVALID_REQUEST");
    this.#binding = options.binding; this.#link = options.linkService;
    this.#resolveNative = options.resolveNative; this.#createAccount = options.createAccountStatusService;
    this.#createAccess = options.createModelAccessService; this.#now = options.now ?? Date.now;
    Object.freeze(this);
  }
  async uploadOriginal(input: unknown, signal?: AbortSignal) {
    this.#assertOpen();
    const f = exact(input, ["attemptId", "content_base64", "filename", "mime_type"]);
    if (!isAttempt(f.attemptId)) fail("INVALID_REQUEST");
    const attemptId = f.attemptId;
    const epoch = this.#epochs.get(attemptId) ?? 0;
    const principal = await this.#principal(attemptId);
    const native = this.#native(attemptId);
    const validated = validateOwnerSeedreamImageInput({ variant: "seedream-5.5", content_base64: f.content_base64,
      filename: f.filename, mime_type: f.mime_type });
    const key = schemaHash({ attemptId, principal, role: "original", sha256: validated.sha256, profile: profile.profile_schema_hash });
    if (this.#uploadKeys.has(key) || this.#references.size >= MAX_HANDLES) { validated.bytes.fill(0); fail("SERVICE_BUSY"); }
    this.#uploadKeys.add(key);
    try {
      const uploaded = await native.uploadOriginal({ attemptId, bytes: validated.bytes, filename: validated.filename,
        mime_type: validated.source_mime_type }, signal);
      this.#assertEpoch(attemptId, epoch);
      if (!sameGenerationPrincipal(principal, await this.#principal(attemptId))) fail("PRINCIPAL_NOT_LINKED");
      this.#assertEpoch(attemptId, epoch);
      const handle = `seedream55_editor_original_${randomUUID()}`;
      const record: Reference = Object.freeze({ handle, role: "original", attemptId, principal, native,
        fileUrl: uploaded.url, sha256: validated.sha256, mimeType: validated.mime_type,
        sourceMimeType: validated.source_mime_type, width: validated.width, height: validated.height,
        size: validated.size, expiresAt: this.#readNow() + TTL_MS, originalHandle: null });
      this.#references.set(handle, record);
      return Object.freeze({ status: "uploaded" as const, reference_handle: handle, variant: "seedream-5.5" as const,
        original_mime_type: validated.source_mime_type, mime_type: validated.mime_type, width: validated.width,
        height: validated.height, size: validated.size, sha256: validated.sha256, expires_in_seconds: 900,
        metadata_confidence: "CONTAINER_METADATA_ONLY" as const });
    } catch { fail("UPLOAD_OUTCOME_UNKNOWN"); }
    finally { validated.bytes.fill(0); }
  }
  async uploadDrawing(input: unknown, signal?: AbortSignal) {
    this.#assertOpen();
    const f = exact(input, ["attemptId", "original_handle", "content_base64", "filename", "mime_type"]);
    if (!isAttempt(f.attemptId) || typeof f.original_handle !== "string" || !ORIGINAL.test(f.original_handle) ||
        f.mime_type !== "image/png") fail("INVALID_REQUEST");
    const attemptId = f.attemptId;
    const epoch = this.#epochs.get(attemptId) ?? 0;
    const principal = await this.#principal(attemptId), original = this.#reference(f.original_handle, "original", principal);
    const native = this.#native(attemptId);
    const validated = validateOwnerSeedreamEditorDrawingInput({ content_base64: f.content_base64,
      filename: f.filename, mime_type: "image/png" });
    if (validated.width !== original.width || validated.height !== original.height) {
      validated.bytes.fill(0); fail("REFERENCE_UNAVAILABLE");
    }
    const key = schemaHash({ attemptId, principal, role: "drawing", original: original.sha256,
      sha256: validated.sha256, profile: profile.profile_schema_hash });
    if (this.#uploadKeys.has(key) || this.#references.size >= MAX_HANDLES) { validated.bytes.fill(0); fail("SERVICE_BUSY"); }
    this.#uploadKeys.add(key);
    try {
      const uploaded = await native.uploadDrawing({ attemptId, bytes: validated.bytes, filename: validated.filename,
        mime_type: "image/png" }, signal);
      this.#assertEpoch(attemptId, epoch);
      if (!sameGenerationPrincipal(principal, await this.#principal(attemptId))) fail("PRINCIPAL_NOT_LINKED");
      this.#assertEpoch(attemptId, epoch);
      const handle = `seedream55_editor_drawing_${randomUUID()}`;
      const record: Reference = Object.freeze({ handle, role: "drawing", attemptId, principal, native,
        fileUrl: uploaded.url, sha256: validated.sha256, mimeType: "image/png",
        sourceMimeType: "image/png", width: validated.width, height: validated.height,
        size: validated.size, expiresAt: Math.min(original.expiresAt, this.#readNow() + TTL_MS), originalHandle: original.handle });
      this.#references.set(handle, record);
      return Object.freeze({ status: "uploaded" as const, reference_handle: handle, variant: "seedream-5.5" as const,
        original_handle: original.handle, mime_type: "image/png" as const, width: validated.width,
        height: validated.height, size: validated.size, sha256: validated.sha256, expires_in_seconds: 900,
        metadata_confidence: "CONTAINER_METADATA_ONLY" as const });
    } catch { fail("UPLOAD_OUTCOME_UNKNOWN"); }
    finally { validated.bytes.fill(0); }
  }
  async generate(input: unknown, signal?: AbortSignal) {
    this.#assertOpen();
    const f = exact(input, ["attemptId", "prompt", "parameters", "original_handle", "drawing_handle"]);
    if (!isAttempt(f.attemptId) || typeof f.prompt !== "string" || !safePrompt(f.prompt) ||
        typeof f.original_handle !== "string" || !ORIGINAL.test(f.original_handle) ||
        !(f.drawing_handle === null || typeof f.drawing_handle === "string" && DRAWING.test(f.drawing_handle))) fail("INVALID_REQUEST");
    const attemptId = f.attemptId, prompt = f.prompt;
    const epoch = this.#epochs.get(attemptId) ?? 0;
    const parameters = normalizeOwnerSeedream55EditorParameters(f.parameters);
    const cost = projectOwnerSeedream55EditorCost({ parameters, drawing_present: f.drawing_handle !== null });
    const principal = await this.#principal(attemptId), native = this.#native(attemptId);
    const original = this.#reference(f.original_handle, "original", principal);
    const drawing = f.drawing_handle === null ? null : this.#reference(f.drawing_handle, "drawing", principal);
    if (drawing && (drawing.originalHandle !== original.handle || drawing.fileUrl === original.fileUrl)) fail("REFERENCE_UNAVAILABLE");
    const key = schemaHash({ tenant_id: principal.tenant_id, subject_id: principal.subject_id,
      prompt, parameters, original_sha256: original.sha256,
      drawing_sha256: drawing?.sha256 ?? null, source_profile: profile.profile_schema_hash });
    if (this.#claims.has(key) || this.#pending.has(key) || this.#pending.size >= 4 || this.#recoveries.size >= MAX_RECOVERIES ||
        this.#results.size >= MAX_RESULTS || this.#claims.size >= MAX_CLAIMS) fail("SERVICE_BUSY");
    this.#pending.add(key);
    let chatUuid: string | null = null, postStarted = false, recovery: Recovery | null = null;
    try {
      await this.#preflight(attemptId, cost, signal);
      this.#assertEpoch(attemptId, epoch);
      const chat = await native.createChat({ attemptId, title: "Seedream 5.5 Editor" }, signal); chatUuid = chat.chat_uuid;
      this.#assertEpoch(attemptId, epoch);
      if (!sameGenerationPrincipal(principal, await this.#principal(attemptId))) fail("PRINCIPAL_NOT_LINKED");
      this.#assertEpoch(attemptId, epoch);
      this.#reference(original.handle, "original", principal);
      if (drawing) this.#reference(drawing.handle, "drawing", principal);
      await this.#preflight(attemptId, cost, signal);
      this.#assertEpoch(attemptId, epoch);
      const settings = Object.freeze({ stream: false as const, model_type: "seedream-5.5" as const,
        aspect_ratio: parameters.aspect_ratio, resolution: parameters.resolution, output_format: parameters.output_format,
        background: parameters.background, file_urls: Object.freeze([original, ...(drawing ? [drawing] : [])]
          .map((item) => Object.freeze({ type: "image" as const, url: item.fileUrl }))) });
      const requestFingerprint = schemaHash({ chat_uuid: chatUuid, prompt, settings, source_profile: profile.profile_schema_hash });
      const token = issueDispatchToken(this, native, { attemptId, chat_uuid: chatUuid, prompt, settings,
        profile_schema_hash: profile.profile_schema_hash, request_fingerprint: requestFingerprint });
      this.#claims.add(key); postStarted = true;
      recovery = { id: `seedream55_editor_recovery_${randomUUID()}`, attemptId, principal, native,
        chatUuid, requestFingerprint, costInputs: cost, createdAt: new Date(this.#readNow()).toISOString(),
        status: "OUTCOME_UNKNOWN", resultId: null };
      this.#recoveries.set(recovery.id, recovery);
      await native.start({ attemptId, chat_uuid: chatUuid, token }, signal);
      return await this.#observe(recovery, epoch, signal);
    } catch (error) {
      if (!postStarted) { this.#pending.delete(key); if (error instanceof OwnerSeedream55EditorServiceError) throw error; fail("PRE_DISPATCH_FAILED"); }
      throw new OwnerSeedream55EditorServiceError("OUTCOME_UNKNOWN", recovery?.id);
    } finally { this.#pending.delete(key); }
  }
  async reconcile(input: unknown, signal?: AbortSignal) {
    this.#assertOpen();
    const f = exact(input, ["attemptId", "recovery_id"]);
    if (!isAttempt(f.attemptId) || typeof f.recovery_id !== "string" || !RECOVERY.test(f.recovery_id)) fail("INVALID_REQUEST");
    const recovery = this.#recoveries.get(f.recovery_id);
    if (!recovery || recovery.attemptId !== f.attemptId || recovery.native !== this.#native(f.attemptId) ||
        !sameGenerationPrincipal(recovery.principal, await this.#principal(f.attemptId))) fail("RECOVERY_NOT_FOUND");
    const epoch = this.#epochs.get(f.attemptId) ?? 0;
    try { return await this.#observe(recovery, epoch, signal); }
    catch { throw new OwnerSeedream55EditorServiceError("OUTCOME_UNKNOWN", recovery.id); }
  }
  async listRecoveries(input: unknown) {
    this.#assertOpen(); const f = exact(input, ["attemptId", "limit"]);
    if (!isAttempt(f.attemptId) || !Number.isSafeInteger(f.limit) || (f.limit as number) < 1 || (f.limit as number) > 20) fail("INVALID_REQUEST");
    const principal = await this.#principal(f.attemptId);
    return Object.freeze([...this.#recoveries.values()].filter((r) => r.attemptId === f.attemptId && r.status === "OUTCOME_UNKNOWN" &&
      sameGenerationPrincipal(principal, r.principal)).slice(0, f.limit as number).map((r) => Object.freeze({
      recovery_id: r.id, created_at: r.createdAt, variant: "seedream-5.5" as const, status: "OUTCOME_UNKNOWN" as const })));
  }
  async getResultPage(input: unknown) {
    this.#assertOpen(); const f = exact(input, ["attemptId", "result_id", "offset", "limit"]);
    if (!isAttempt(f.attemptId) || typeof f.result_id !== "string" || !RESULT.test(f.result_id) ||
        !Number.isSafeInteger(f.offset) || (f.offset as number) < 0 ||
        !Number.isSafeInteger(f.limit) || (f.limit as number) < 1 || (f.limit as number) > PAGE_SIZE) fail("INVALID_REQUEST");
    const record = this.#results.get(f.result_id);
    if (!record || record.recovery.attemptId !== f.attemptId ||
        !sameGenerationPrincipal(record.recovery.principal, await this.#principal(f.attemptId))) fail("RESULT_NOT_FOUND");
    return page(record, f.offset as number, f.limit as number);
  }
  async invalidateAttempt(attemptId: string): Promise<void> {
    if (!isAttempt(attemptId)) fail("INVALID_REQUEST");
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    this.#natives.get(attemptId)?.invalidateAttempt(attemptId);
    for (const [key, value] of this.#references) if (value.attemptId === attemptId) this.#references.delete(key);
    for (const [key, value] of this.#recoveries) if (value.attemptId === attemptId) this.#recoveries.delete(key);
    for (const [key, value] of this.#results) if (value.recovery.attemptId === attemptId) this.#results.delete(key);
    this.#natives.delete(attemptId);
  }
  async close(): Promise<void> { this.#closed = true;
    for (const attemptId of this.#natives.keys()) this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    for (const native of this.#natives.values()) native.close();
    this.#natives.clear(); this.#references.clear(); this.#recoveries.clear(); this.#results.clear(); }
  async #observe(recovery: Recovery, epoch: number, signal?: AbortSignal) {
    const observed: OwnerSeedream55EditorNativeObservation = await recovery.native.observe({ attemptId: recovery.attemptId,
      chat_uuid: recovery.chatUuid }, signal);
    this.#assertEpoch(recovery.attemptId, epoch);
    if (!sameGenerationPrincipal(recovery.principal, await this.#principal(recovery.attemptId))) fail("PRINCIPAL_NOT_LINKED");
    this.#assertEpoch(recovery.attemptId, epoch);
    if (observed.status !== "COMPLETE" || observed.artifacts.length < 1) throw new OwnerSeedream55EditorServiceError("OUTCOME_UNKNOWN", recovery.id);
    const artifacts = Object.freeze(observed.artifacts.map((artifact): OwnerSeedream55EditorArtifact => Object.freeze({
      url: artifact.url, mime_type: artifact.mime_type, width: null, height: null, geometry_verified: false })));
    const resultId = recovery.resultId ?? `seedream55_editor_result_${randomUUID()}`;
    recovery.resultId = resultId; recovery.status = "COMPLETE";
    const record: ResultRecord = Object.freeze({ id: resultId, recovery, artifacts }); this.#results.set(resultId, record);
    const first = page(record, 0, PAGE_SIZE);
    return Object.freeze({ status: "completed" as const, variant: "seedream-5.5" as const,
      status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY" as const, backend_acceptance: "UNPROVEN" as const,
      profile_id: profile.profile_id, profile_schema_hash: profile.profile_schema_hash,
      request_fingerprint: recovery.requestFingerprint, cost_inputs: recovery.costInputs,
      result_id: resultId, ...first });
  }
  async #preflight(attemptId: string, cost: Readonly<{ batch_size: 1 | 2; resolution: "1K" | "1.5K" | "2K" }>, signal?: AbortSignal) {
    let account: AccountStatusService, access: ModelAccessService;
    try { account = this.#createAccount(attemptId); access = this.#createAccess(attemptId, catalog); }
    catch { fail("PREFLIGHT_FAILED"); }
    if (!(account instanceof AccountStatusService) || !(access instanceof ModelAccessService)) fail("PREFLIGHT_FAILED");
    let a: Awaited<ReturnType<AccountStatusService["getAccountStatus"]>>;
    let m: Awaited<ReturnType<ModelAccessService["getModelAccess"]>>;
    try { a = await account.getAccountStatus(signal); m = await access.getModelAccess({ model_id: "seedream-5.5", cost_parameters: cost }, signal); }
    catch { fail("PREFLIGHT_FAILED"); }
    const now = this.#readNow();
    const expectedVersion = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
    if (a.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || a.source_build !== ACCOUNT_SOURCE_BUILD ||
        a.balance.unit !== "tokens" || !(a.balance.available === null || typeof a.balance.available === "string") ||
        a.subscription.active !== true || !(a.subscription.plan_type === null || typeof a.subscription.plan_type === "string") ||
        !validSubscription(a.subscription, now) || !fresh(a.observed_at, now) ||
        !fresh(m.observed_at, now) || m.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" ||
        m.catalog_version !== expectedVersion || m.model_id !== "seedream-5.5" || m.ai_name !== "seedream" ||
        m.model_type !== "seedream-5.5" || m.account_read_live !== true || m.parameters_redacted !== true ||
        m.access !== true || !isDeepStrictEqual(m.parameter_keys, ["batch_size", "resolution"]) ||
        typeof m.cost !== "number" || !Number.isFinite(m.cost) || m.cost < 0 ||
        !(m.discount_cost === null || typeof m.discount_cost === "number" && Number.isFinite(m.discount_cost) && m.discount_cost >= 0) ||
        !(m.free_remaining_generations === null || Number.isSafeInteger(m.free_remaining_generations) && m.free_remaining_generations >= 0) ||
        !(m.limit === null || typeof m.limit === "number" && Number.isFinite(m.limit) && m.limit >= 0) ||
        !(m.show_warning === null || typeof m.show_warning === "boolean")) fail("PREFLIGHT_FAILED");
  }
  async #principal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    try { return snapshotGenerationPrincipal(await resolveOwnerReferencePrincipal({ binding: this.#binding,
      attemptId, linkService: this.#link })); } catch { fail("PRINCIPAL_NOT_LINKED"); }
  }
  #native(attemptId: string): OwnerSeedream55EditorNative {
    const known = this.#natives.get(attemptId); if (known) return known;
    const value = this.#resolveNative(attemptId);
    if (!(value instanceof OwnerSeedream55EditorNative) || types.isProxy(value)) fail("PRE_DISPATCH_FAILED");
    this.#natives.set(attemptId, value); return value;
  }
  #reference(handle: string, role: Role, principal: Readonly<GenerationPrincipalRef>): Reference {
    const row = this.#references.get(handle);
    if (!row || row.role !== role || row.attemptId !== principal.connection_id ||
        !sameGenerationPrincipal(row.principal, principal) || row.native !== this.#native(row.attemptId)) fail("REFERENCE_UNAVAILABLE");
    if (this.#readNow() >= row.expiresAt) fail("REFERENCE_EXPIRED");
    return row;
  }
  #readNow(): number { const value = this.#now(); if (!Number.isSafeInteger(value) || value < 0) fail("SERVICE_CLOSED"); return value; }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  #assertEpoch(attemptId: string, epoch: number): void {
    this.#assertOpen(); if ((this.#epochs.get(attemptId) ?? 0) !== epoch) fail("SERVICE_CLOSED");
  }
}

/** Consumed by the native adapter only. No public minting route exists outside a preflighted service run. */
export function consumeOwnerSeedream55EditorDispatchToken(native: OwnerSeedream55EditorNative,
  token: OwnerSeedream55EditorDispatchToken, attemptId: string, chatUuid: string): OwnerSeedream55EditorDispatchRequest {
  if (!token || typeof token !== "object" || types.isProxy(token)) fail("INVALID_REQUEST");
  const state = tokens.get(token);
  if (!state || state.used || state.native !== native || state.request.attemptId !== attemptId ||
      state.request.chat_uuid !== chatUuid || !Object.isFrozen(token)) fail("INVALID_REQUEST");
  state.used = true;
  return state.request;
}
function issueDispatchToken(service: OwnerSeedream55EditorService, native: OwnerSeedream55EditorNative,
  request: OwnerSeedream55EditorDispatchRequest): OwnerSeedream55EditorDispatchToken {
  const token = Object.create(null) as OwnerSeedream55EditorDispatchToken;
  Object.defineProperty(token, TOKEN_BRAND, { value: true }); Object.freeze(token);
  tokens.set(token, { service, native, request: Object.freeze(request), used: false });
  return token;
}

function page(record: ResultRecord, offset: number, limit: number) {
  const total = record.artifacts.length;
  if (offset > total) fail("INVALID_REQUEST");
  const artifacts = Object.freeze(record.artifacts.slice(offset, offset + limit));
  const next = offset + artifacts.length;
  return Object.freeze({ offset, limit, observed_total: total, artifacts, next_offset: next < total ? next : null,
    has_more: next < total });
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const proto = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value);
  if ((proto !== Object.prototype && proto !== null) || Reflect.ownKeys(descriptors).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(descriptors, key) || !("value" in descriptors[key]!)) ||
      Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !keys.includes(key))) fail("INVALID_REQUEST");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) result[key] = descriptors[key]!.value;
  return result;
}
function isAttempt(value: unknown): value is string { return typeof value === "string" && ATTEMPT.test(value); }
function safePrompt(value: string): boolean {
  if (value.trim().length === 0 || Buffer.byteLength(value, "utf8") > 32 * 1024 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return false; index += 1; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function fresh(value: unknown, now: number): boolean { const time = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time <= now && now - time <= 30_000 && new Date(time).toISOString() === value; }
function validSubscription(value: { end_date: string | null; end_date_kind: string | null }, now: number): boolean {
  const date = value.end_date, kind = value.end_date_kind;
  if (date === null) return kind === null;
  if (typeof date !== "string") return false;
  if (kind === "DATE_ONLY") return /^\d{4}-\d{2}-\d{2}$/u.test(date);
  if (kind === "LOCAL_DATETIME") return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/u.test(date);
  if (kind === "OFFSET_DATETIME" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(date)) {
    const expiry = Date.parse(date); return Number.isFinite(expiry) && expiry > now;
  }
  return false;
}
function fail(code: OwnerSeedream55EditorServiceError["code"]): never { throw new OwnerSeedream55EditorServiceError(code); }
