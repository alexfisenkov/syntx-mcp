import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import { SyntxHttpClient, SyntxHttpError } from "../adapter/syntx/http-client.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import type { OwnerElevenLabsVoiceReference } from "./owner-elevenlabs-generation-parameters.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const VOICE_REF = /^owner_elevenlabs_voice_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_VOICE_ID = /^[A-Za-z0-9._-]{1,160}$/u;
const TTL_MS = 15 * 60_000;
const MAX_REFERENCES = 128;
const MAX_ATTEMPTS = 128;
const MAX_PENDING = 4;
const NATIVE_LIST_VOICES = SyntxHttpClient.prototype.listElevenLabsVoices;
const NATIVE_LINK_STATUS = PerUserLinkService.prototype.getStatus;

export interface OwnerElevenLabsVoiceReferenceServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly now?: () => number;
}

export interface OwnerElevenLabsVoiceListRequest {
  readonly attemptId: string;
  readonly page?: 1;
  readonly page_size?: 10;
  readonly signal?: AbortSignal;
}

export interface OwnerElevenLabsAvailableVoice {
  readonly voice_ref: OwnerElevenLabsVoiceReference;
  readonly name: string;
  readonly expires_in_seconds: number;
}

export interface OwnerElevenLabsVoiceListReceipt {
  readonly status: "available";
  readonly page: 1;
  readonly page_size: 10;
  readonly total: number | null;
  readonly has_more: boolean | null;
  readonly coverage: "PARTIAL_PAGE_ONLY";
  readonly source_confidence: "CURRENT_SOURCE_ROUTE";
  readonly ownership_confidence: "UNPROVEN";
  readonly voices: readonly OwnerElevenLabsAvailableVoice[];
}

export interface OwnerElevenLabsVoiceResolverRequest {
  readonly attemptId: string;
  readonly voice_ref: OwnerElevenLabsVoiceReference;
}

/** Internal source-joined value for a future TTS/dialogue preparer; never put on an MCP/public barrel. */
export interface OwnerElevenLabsVoicePrivateResolution {
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly voice_ref: OwnerElevenLabsVoiceReference;
  readonly voice_id: string;
  readonly name: string;
  readonly expires_at: number;
  readonly epoch: number;
  readonly ownership_confidence: "UNPROVEN";
  readonly generation_permit: false;
}

export type OwnerElevenLabsVoiceReferenceServiceErrorCode =
  | "INVALID_REQUEST" | "PRINCIPAL_NOT_LINKED" | "NATIVE_CLIENT_INVALID" | "VOICE_LIST_UNAVAILABLE"
  | "VOICE_REFERENCE_UNAVAILABLE" | "VOICE_REFERENCE_EXPIRED" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED"
  | "SERVICE_CLOSED" | "REQUEST_ABORTED";

export class OwnerElevenLabsVoiceReferenceServiceError extends Error {
  constructor(readonly code: OwnerElevenLabsVoiceReferenceServiceErrorCode) {
    super("The ElevenLabs voice reference is unavailable.");
    this.name = "OwnerElevenLabsVoiceReferenceServiceError";
  }
}

interface VoiceRecord {
  readonly voice_ref: OwnerElevenLabsVoiceReference;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly voice_id: string;
  readonly name: string;
  readonly expiresAt: number;
  readonly epoch: number;
  readonly selectionKey: string;
}

interface Operation {
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly removeParentAbort: () => void;
  readonly epoch: number;
}

interface ListRequest {
  readonly attemptId: string;
  readonly signal?: AbortSignal;
}

interface ResolveRequest {
  readonly attemptId: string;
  readonly voice_ref: OwnerElevenLabsVoiceReference;
}

export class OwnerElevenLabsVoiceReferenceService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: PerUserLinkService;
  readonly #resolveClient: (attemptId: string) => unknown;
  readonly #now: () => number;
  readonly #records = new Map<string, VoiceRecord>();
  readonly #selections = new Map<string, string>();
  readonly #principals = new Map<string, Readonly<GenerationPrincipalRef>>();
  readonly #pending = new Map<string, Set<Operation>>();
  readonly #epochs = new Map<string, number>();
  readonly #listClaims = new Set<string>();
  readonly #invalidatedAttempts = new Set<string>();
  readonly #ownedResolutions = new WeakMap<object, { readonly fingerprint: string; readonly record: VoiceRecord }>();
  readonly #invalidating = new Set<string>();
  readonly #invalidations = new Map<string, Promise<void>>();
  #pendingCount = 0;
  #lastNow: number | undefined;
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(optionsInput: OwnerElevenLabsVoiceReferenceServiceOptions | unknown) {
    const fields = exactRecord(optionsInput, ["binding", "linkService", "resolveClient"], ["now"]);
    if (!fields.linkService || typeof fields.linkService !== "object" || types.isProxy(fields.linkService) ||
        !(fields.linkService instanceof PerUserLinkService) ||
        getDataMethod(fields.linkService, "getStatus") !== NATIVE_LINK_STATUS ||
        typeof fields.resolveClient !== "function" || types.isProxy(fields.resolveClient) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("INVALID_REQUEST");
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = fields.linkService;
    this.#resolveClient = fields.resolveClient as (attemptId: string) => unknown;
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
  }

  async listVoices(input: OwnerElevenLabsVoiceListRequest | unknown): Promise<OwnerElevenLabsVoiceListReceipt> {
    const request = snapshotListRequest(input);
    this.#assertOpen();
    const operation = this.#begin(request.attemptId, request.signal);
    if (this.#listClaims.has(request.attemptId)) {
      this.#finish(request.attemptId, operation);
      fail("SERVICE_BUSY");
    }
    this.#listClaims.add(request.attemptId);
    try {
      const principal = await this.#principal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation);
      if (!this.#rememberPrincipal(request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const client = snapshotNativeClient(this.#resolveClient(request.attemptId));
      this.#throwIfClosedOrAborted(operation);
      const nativePage = await Reflect.apply(NATIVE_LIST_VOICES, client, [
        Object.freeze({ page: 1, page_size: 10 }), operation.controller.signal
      ]);
      this.#throwIfClosedOrAborted(operation);
      const rows = snapshotNativeRows(nativePage);
      const current = await this.#principal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation);
      if (!sameGenerationPrincipal(principal, current)) {
        void this.#invalidate(request.attemptId);
        fail("PRINCIPAL_NOT_LINKED");
      }
      if (!this.#rememberPrincipal(request.attemptId, current)) fail("PRINCIPAL_NOT_LINKED");

      const now = this.#readNow();
      this.#prune(now);
      const epoch = this.#epochs.get(request.attemptId) ?? 0;
      const prepared = rows.voices.map((voice) => ({ ...voice,
        selectionKey: selectionKey(principal, voice.voice_id) }));
      const newKeys = new Set(prepared.filter((voice) => {
        const existingRef = this.#selections.get(voice.selectionKey);
        const existing = existingRef === undefined ? undefined : this.#records.get(existingRef);
        return !existing || existing.expiresAt <= now || existing.epoch !== epoch;
      }).map((voice) => voice.selectionKey));
      if (this.#records.size + newKeys.size > MAX_REFERENCES) fail("CAPACITY_EXCEEDED");
      if (now > Number.MAX_SAFE_INTEGER - TTL_MS) fail("SERVICE_CLOSED");
      const expiresAt = now + TTL_MS;
      const voices = prepared.map((voice) => {
        const existingRef = this.#selections.get(voice.selectionKey);
        const existing = existingRef === undefined ? undefined : this.#records.get(existingRef);
        const record = existing && existing.expiresAt > now && existing.epoch === epoch
          ? existing : this.#issueRecord(request.attemptId, principal, voice.voice_id, voice.name, expiresAt, epoch, voice.selectionKey);
        return Object.freeze({ voice_ref: record.voice_ref, name: record.name,
          expires_in_seconds: Math.floor((record.expiresAt - now) / 1000) });
      });
      if ((this.#epochs.get(request.attemptId) ?? 0) !== epoch || this.#invalidating.has(request.attemptId)) fail("VOICE_REFERENCE_UNAVAILABLE");
      return Object.freeze({ status: "available", page: 1, page_size: 10, total: rows.total,
        has_more: rows.total === null ? null : rows.total > rows.voices.length,
        coverage: "PARTIAL_PAGE_ONLY",
        source_confidence: "CURRENT_SOURCE_ROUTE", ownership_confidence: "UNPROVEN", voices: Object.freeze(voices) });
    } catch (error) {
      if (error instanceof OwnerElevenLabsVoiceReferenceServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      if (error instanceof SyntxHttpError) {
        if (error.code === "AUTH_REQUIRED" || error.code === "AUTH_OR_ACCESS_DENIED") fail("PRINCIPAL_NOT_LINKED");
        if (error.code === "UPSTREAM_REQUEST_ABORTED") fail("REQUEST_ABORTED");
        fail("VOICE_LIST_UNAVAILABLE");
      }
      if (operation.controller.signal.aborted) fail("REQUEST_ABORTED");
      fail("VOICE_LIST_UNAVAILABLE");
    } finally {
      this.#listClaims.delete(request.attemptId);
      this.#finish(request.attemptId, operation);
    }
  }

  async resolveVoice(input: OwnerElevenLabsVoiceResolverRequest | unknown): Promise<OwnerElevenLabsVoicePrivateResolution> {
    const request = snapshotResolveRequest(input);
    this.#assertOpen();
    const operation = this.#begin(request.attemptId);
    try {
      const principal = await this.#principal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation);
      if (!this.#rememberPrincipal(request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const now = this.#readNow();
      const record = this.#records.get(request.voice_ref);
      if (!record) fail("VOICE_REFERENCE_UNAVAILABLE");
      if (record.expiresAt <= now) { this.#dropRecord(record); fail("VOICE_REFERENCE_EXPIRED"); }
      const epoch = this.#epochs.get(request.attemptId) ?? 0;
      if (record.attemptId !== request.attemptId || record.epoch !== epoch ||
          !sameGenerationPrincipal(record.principal, principal)) fail("VOICE_REFERENCE_UNAVAILABLE");
      const current = await this.#principal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation);
      if (!sameGenerationPrincipal(principal, current)) {
        void this.#invalidate(request.attemptId);
        fail("PRINCIPAL_NOT_LINKED");
      }
      if (this.#records.get(record.voice_ref) !== record || record.expiresAt <= this.#readNow() ||
          (this.#epochs.get(request.attemptId) ?? 0) !== epoch || this.#invalidating.has(request.attemptId)) {
        fail("VOICE_REFERENCE_EXPIRED");
      }
      const resolution: OwnerElevenLabsVoicePrivateResolution = Object.freeze({
        attempt_id: record.attemptId, principal: record.principal, voice_ref: record.voice_ref,
        voice_id: record.voice_id, name: record.name, expires_at: record.expiresAt, epoch: record.epoch,
        ownership_confidence: "UNPROVEN", generation_permit: false
      });
      this.#ownedResolutions.set(resolution, { fingerprint: requestFingerprint(request), record });
      return resolution;
    } catch (error) {
      if (error instanceof OwnerElevenLabsVoiceReferenceServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      fail("VOICE_REFERENCE_UNAVAILABLE");
    } finally { this.#finish(request.attemptId, operation); }
  }

  isOwnedVoiceResolution(value: unknown, context: OwnerElevenLabsVoiceResolverRequest | unknown): boolean {
    try {
      const request = snapshotResolveRequest(context);
      this.#assertOpen();
      if (!value || typeof value !== "object" || types.isProxy(value)) return false;
      const owned = this.#ownedResolutions.get(value);
      const record = this.#records.get(request.voice_ref);
      return !!owned && !!record && owned.record === record && owned.fingerprint === requestFingerprint(request) &&
        record.attemptId === request.attemptId && record.expiresAt > this.#readNow() &&
        record.epoch === (this.#epochs.get(request.attemptId) ?? 0);
    } catch { return false; }
  }

  invalidateAttempt(attemptId: string): Promise<void> {
    if (typeof attemptId !== "string" || !ATTEMPT.test(attemptId)) return Promise.resolve();
    return this.#invalidate(attemptId);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    const attempts = this.#activeAttempts();
    const invalidations = [...attempts].map((attempt) => this.#invalidate(attempt));
    const pending = [...this.#pending.values()].flatMap((operations) => [...operations].map((operation) => operation.done));
    this.#closing = Promise.allSettled([...invalidations, ...pending]).then(() => {
      this.#records.clear(); this.#selections.clear(); this.#principals.clear(); this.#pending.clear();
      this.#epochs.clear(); this.#listClaims.clear(); this.#invalidatedAttempts.clear();
      this.#invalidating.clear(); this.#invalidations.clear();
    });
    return this.#closing;
  }

  #issueRecord(
    attemptId: string,
    principal: Readonly<GenerationPrincipalRef>,
    voice_id: string,
    name: string,
    expiresAt: number,
    epoch: number,
    selectionKeyValue: string
  ): VoiceRecord {
    const voice_ref = `owner_elevenlabs_voice_${randomUUID()}` as OwnerElevenLabsVoiceReference;
    const record = Object.freeze({ voice_ref, attemptId, principal, voice_id, name, expiresAt, epoch, selectionKey: selectionKeyValue });
    this.#records.set(voice_ref, record);
    this.#selections.set(selectionKeyValue, voice_ref);
    return record;
  }

  async #principal(attemptId: string, signal: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    this.#throwIfSignalAborted(signal);
    try {
      const pending = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
      return await waitForAbortable(pending, signal);
    } catch (error) {
      if (error instanceof OwnerElevenLabsVoiceReferenceServiceError) throw error;
      void this.#invalidate(attemptId);
      throw new OwnerReferencePrincipalError("REFERENCE_PRINCIPAL_NOT_LINKED");
    }
  }

  #rememberPrincipal(attemptId: string, principal: Readonly<GenerationPrincipalRef>): boolean {
    const old = this.#principals.get(attemptId);
    if (old && !sameGenerationPrincipal(old, principal)) {
      void this.#invalidate(attemptId);
      return false;
    }
    this.#principals.set(attemptId, principal);
    return true;
  }

  #begin(attemptId: string, parent?: AbortSignal): Operation {
    this.#assertOpen();
    if (this.#invalidatedAttempts.has(attemptId)) fail("PRINCIPAL_NOT_LINKED");
    if (this.#invalidating.has(attemptId)) fail("REQUEST_ABORTED");
    this.#prune(this.#readNow());
    if (this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY");
    const active = this.#activeAttempts();
    if (!active.has(attemptId) && active.size >= MAX_ATTEMPTS) fail("CAPACITY_EXCEEDED");
    const controller = new AbortController();
    const abortParent = () => controller.abort(parent?.reason);
    if (parent?.aborted) abortParent();
    else parent?.addEventListener("abort", abortParent, { once: true });
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const operation = { controller, done, finish, removeParentAbort: () => parent?.removeEventListener("abort", abortParent),
      epoch: this.#epochs.get(attemptId) ?? 0 };
    const operations = this.#pending.get(attemptId) ?? new Set<Operation>();
    operations.add(operation);
    this.#pending.set(attemptId, operations);
    this.#pendingCount += 1;
    return operation;
  }

  #finish(attemptId: string, operation: Operation): void {
    operation.removeParentAbort();
    const operations = this.#pending.get(attemptId);
    if (operations?.delete(operation)) this.#pendingCount -= 1;
    if (operations?.size === 0) this.#pending.delete(attemptId);
    operation.finish();
  }

  #invalidate(attemptId: string): Promise<void> {
    const existing = this.#invalidations.get(attemptId);
    if (existing) return existing;
    if (this.#invalidatedAttempts.has(attemptId)) return Promise.resolve();
    if (!this.#activeAttempts().has(attemptId)) return Promise.resolve();
    this.#invalidatedAttempts.add(attemptId);
    this.#invalidating.add(attemptId);
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    for (const record of [...this.#records.values()]) if (record.attemptId === attemptId) this.#dropRecord(record);
    const operations = [...(this.#pending.get(attemptId) ?? [])];
    for (const operation of operations) operation.controller.abort();
    const invalidation = Promise.allSettled(operations.map((operation) => operation.done)).then(() => {
      this.#principals.delete(attemptId);
      this.#invalidating.delete(attemptId);
      this.#invalidations.delete(attemptId);
    });
    this.#invalidations.set(attemptId, invalidation);
    return invalidation;
  }

  #dropRecord(record: VoiceRecord): void {
    if (this.#records.get(record.voice_ref) !== record) return;
    this.#records.delete(record.voice_ref);
    if (this.#selections.get(record.selectionKey) === record.voice_ref) this.#selections.delete(record.selectionKey);
  }

  #prune(now: number): void {
    for (const record of this.#records.values()) if (record.expiresAt <= now) this.#dropRecord(record);
  }

  #activeAttempts(): Set<string> {
    return new Set([...this.#principals.keys(), ...this.#pending.keys(), ...this.#invalidatedAttempts,
      ...[...this.#records.values()].map((record) => record.attemptId)]);
  }

  #readNow(): number {
    let value: unknown;
    try { value = this.#now(); } catch { fail("SERVICE_CLOSED"); }
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 ||
        (this.#lastNow !== undefined && value < this.#lastNow)) fail("SERVICE_CLOSED");
    this.#lastNow = value as number;
    return value as number;
  }

  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  #throwIfClosedOrAborted(operation: Operation): void {
    this.#assertOpen();
    if (operation.controller.signal.aborted) fail("REQUEST_ABORTED");
  }
  #throwIfSignalAborted(signal: AbortSignal): void { if (signal.aborted) fail("REQUEST_ABORTED"); }
}

function snapshotListRequest(input: unknown): ListRequest {
  const fields = exactRecord(input, ["attemptId"], ["page", "page_size", "signal"]);
  const attemptId = safeAttempt(fields.attemptId);
  if ((fields.page !== undefined && fields.page !== 1) || (fields.page_size !== undefined && fields.page_size !== 10) ||
      (fields.signal !== undefined && (!(fields.signal instanceof AbortSignal) || types.isProxy(fields.signal)))) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId, ...(fields.signal === undefined ? {} : { signal: fields.signal as AbortSignal }) });
}

function snapshotResolveRequest(input: unknown): ResolveRequest {
  const fields = exactRecord(input, ["attemptId", "voice_ref"]);
  const attemptId = safeAttempt(fields.attemptId);
  if (typeof fields.voice_ref !== "string" || !VOICE_REF.test(fields.voice_ref)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId, voice_ref: fields.voice_ref as OwnerElevenLabsVoiceReference });
}

function snapshotNativeClient(input: unknown): SyntxHttpClient {
  if (!input || typeof input !== "object" || types.isProxy(input)) fail("NATIVE_CLIENT_INVALID");
  try {
    if (Object.getPrototypeOf(input) !== SyntxHttpClient.prototype || getDataMethod(input, "listElevenLabsVoices") !== NATIVE_LIST_VOICES) {
      fail("NATIVE_CLIENT_INVALID");
    }
  } catch { fail("NATIVE_CLIENT_INVALID"); }
  return input as SyntxHttpClient;
}

function snapshotNativeRows(input: unknown): { readonly total: number | null; readonly voices: readonly { readonly voice_id: string; readonly name: string }[] } {
  const fields = exactRecord(input, ["page", "page_size", "total", "has_more", "voices"]);
  if (fields.page !== 1 || fields.page_size !== 10 ||
      !(fields.total === null || (typeof fields.total === "number" && Number.isSafeInteger(fields.total) && fields.total >= 0)) ||
      !(fields.has_more === null || typeof fields.has_more === "boolean") || !Array.isArray(fields.voices) || fields.voices.length > 100) {
    fail("VOICE_LIST_UNAVAILABLE");
  }
  if (fields.total !== null && fields.total < fields.voices.length) fail("VOICE_LIST_UNAVAILABLE");
  const seen = new Set<string>();
  const voices = fields.voices.map((value) => {
    const row = exactRecord(value, ["voice_id", "name"]);
    if (typeof row.voice_id !== "string" || !SAFE_VOICE_ID.test(row.voice_id) ||
        typeof row.name !== "string" || row.name.length < 1 || row.name.length > 256 ||
        /[\u0000-\u001f\u007f]/u.test(row.name) || /https?:\/\//iu.test(row.name) ||
        seen.has(row.voice_id)) fail("VOICE_LIST_UNAVAILABLE");
    seen.add(row.voice_id);
    return Object.freeze({ voice_id: row.voice_id, name: row.name });
  });
  return Object.freeze({ total: fields.total as number | null, voices: Object.freeze(voices) });
}

function selectionKey(principal: GenerationPrincipalRef, voiceId: string): string {
  return JSON.stringify([principal.tenant_id, principal.subject_id, principal.connection_id, voiceId]);
}

function requestFingerprint(request: ResolveRequest): string {
  return JSON.stringify([request.attemptId, request.voice_ref]);
}

function snapshotBinding(input: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(input, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || fields.tenant_id.length < 1 || fields.tenant_id.length > 256 ||
      /[\u0000-\u001f\u007f]/u.test(fields.tenant_id) || typeof fields.subject !== "string" || fields.subject.length < 1 ||
      fields.subject.length > 512 || /[\u0000-\u001f\u007f]/u.test(fields.subject)) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}

function safeAttempt(value: unknown): string {
  if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST");
  return value;
}

function exactRecord(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) fail("INVALID_REQUEST");
  let prototype: object | null, descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(input); descriptors = Object.getOwnPropertyDescriptors(input); }
  catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(descriptors), allowed = [...required, ...optional];
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) {
    fail("INVALID_REQUEST");
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function getDataMethod(target: object, key: string): unknown {
  let current: object | null = target;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function readClock(value: unknown): () => number {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return value as () => number;
}

async function waitForAbortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  let remove = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = () => reject(new OwnerElevenLabsVoiceReferenceServiceError("REQUEST_ABORTED"));
    if (signal.aborted) onAbort();
    else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); }
  });
  try { return await Promise.race([promise, aborted]); }
  finally { remove(); }
}

function fail(code: OwnerElevenLabsVoiceReferenceServiceErrorCode): never {
  throw new OwnerElevenLabsVoiceReferenceServiceError(code);
}
