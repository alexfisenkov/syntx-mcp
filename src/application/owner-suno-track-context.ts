import { randomUUID } from "node:crypto";
import { types } from "node:util";
import {
  isOwnerSunoExistingTrackResultMessageContext,
  isOwnerSunoGenerationResultMessageContext,
  SyntxChatHttpClient,
  type OwnerSunoExistingTrackResultMessageContext,
  type OwnerSunoGenerationResultMessageContext
} from "../adapter/syntx/chat-http-client.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import type { AuthBinding } from "../auth/types.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^track_[0-9a-f-]{36}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_PROVIDER_CHAT_ID = /^\d{1,16}$/u;
const PROFILE_HASH = /^sha256:[a-f0-9]{64}$/u;
const INTENT_FINGERPRINT = /^[a-f0-9]{64}$/u;
const MODELS = new Set(["V6", "V6_wild"]);
const DEFAULT_TTL_MS = 15 * 60_000;
const MAX_TTL_MS = 30 * 60_000;
const DEFAULT_MAX_RECORDS = 128;
const ABSOLUTE_MAX_RECORDS = 128;
const CONTEXT_KEYS = ["chat_uuid", "message_id", "model_id", "provider_chat_id", "message_object_ids",
  "owner_echo_message_id", "attempt_id", "principal", "intent_fingerprint", "source_profile_schema_hash", "source_pins"];
const NATIVE_TRACK_METADATA = SyntxChatHttpClient.prototype.getOwnedSunoGenerationTrackMetadata;
const NATIVE_EXISTING_TRACK_METADATA = SyntxChatHttpClient.prototype.getOwnedSunoExistingTrackMetadata;
const MIME_BY_EXTENSION = new Map<string, "audio/mpeg" | "audio/wav" | "audio/mp4">([
  ["mp3", "audio/mpeg"], ["wav", "audio/wav"], ["m4a", "audio/mp4"]
]);

export interface OwnerSunoTrackContextStoreOptions {
  readonly now?: () => number;
  readonly ttlMs?: number;
  readonly maxRecords?: number;
}

/**
 * Internal process-local handles for cover/extend track inputs. issue() accepts
 * only a result-context object branded by the native Suno client WeakMap and
 * requires the caller to bind its extracted metadata to one listed audio
 * object. It must only be called by internal owner-bound result-observation
 * code; tool input must never supply provider IDs or call issue() directly.
 * A handle conveys read-only track inputs, not generation or payment authority.
 */
export interface OwnerSunoTrackContextIssueInput {
  readonly binding: AuthBinding;
  readonly attemptId: string;
  readonly principal: GenerationPrincipalRef;
  readonly client: SyntxChatHttpClient;
  readonly resultContext: OwnerSunoGenerationResultMessageContext;
  readonly messageObjectId: string;
}

export interface OwnerSunoExistingTrackContextIssueInput {
  readonly binding: AuthBinding;
  readonly attemptId: string;
  readonly principal: GenerationPrincipalRef;
  readonly client: SyntxChatHttpClient;
  readonly resultContext: OwnerSunoExistingTrackResultMessageContext;
  readonly messageObjectId: string;
}

export interface OwnerSunoTrackContextResolveInput {
  readonly binding: AuthBinding;
  readonly attemptId: string;
  readonly principal: GenerationPrincipalRef;
  readonly trackHandle: string;
}

/** Internal-only resolved projection. MCP/public response builders must not return this object. */
export interface OwnerSunoTrackContextProjection {
  readonly track_handle: string;
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: "V6" | "V6_wild";
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly message_object_id: string;
  readonly owner_echo_message_id: string;
  readonly intent_fingerprint: string;
  readonly source_profile_schema_hash: string;
  readonly source_kind: "OWNER_GENERATION" | "EXISTING_OWNER_TRACK";
  readonly clip_id: string;
  readonly task_id: string;
  readonly expires_at: number;
  readonly artifact?: Readonly<{ url: string; mime_type: "audio/mpeg" | "audio/wav" | "audio/mp4" | null }>;
}

export type OwnerSunoTrackContextStoreErrorCode =
  | "INVALID_REQUEST" | "TRACK_CONTEXT_UNAVAILABLE" | "TRACK_CONTEXT_EXPIRED" | "CAPACITY_EXCEEDED"
  | "CLOCK_INVALID" | "SERVICE_CLOSED";

export class OwnerSunoTrackContextStoreError extends Error {
  constructor(readonly code: OwnerSunoTrackContextStoreErrorCode) {
    super("The owner Suno track context is unavailable.");
    this.name = "OwnerSunoTrackContextStoreError";
  }
}

interface StoredContext extends OwnerSunoTrackContextProjection {
  readonly tenant_id: string;
  readonly subject: string;
}

/** Bounded, read-only process-local store. Expired or invalidated handles fail closed. */
export class OwnerSunoTrackContextStore {
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #maxRecords: number;
  readonly #records = new Map<string, StoredContext>();
  #lastNow: number | undefined;
  #closed = false;

  constructor(optionsInput: OwnerSunoTrackContextStoreOptions | unknown = {}) {
    const fields = exactRecord(optionsInput, [], ["now", "ttlMs", "maxRecords"]);
    if (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now))) fail("INVALID_REQUEST");
    const ttlMs = fields.ttlMs ?? DEFAULT_TTL_MS;
    const maxRecords = fields.maxRecords ?? DEFAULT_MAX_RECORDS;
    if (!Number.isSafeInteger(ttlMs) || (ttlMs as number) < 1 || (ttlMs as number) > MAX_TTL_MS ||
        !Number.isSafeInteger(maxRecords) || (maxRecords as number) < 1 || (maxRecords as number) > ABSOLUTE_MAX_RECORDS) {
      fail("INVALID_REQUEST");
    }
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    this.#ttlMs = ttlMs as number;
    this.#maxRecords = maxRecords as number;
  }

  /**
   * Mints a non-derivable handle from trusted internal observation state. The
   * visible return value intentionally contains no provider identifiers.
   */
  issue(input: OwnerSunoTrackContextIssueInput | unknown): string {
    this.#assertOpen();
    const fields = exactRecord(input, ["binding", "attemptId", "principal", "client", "resultContext", "messageObjectId"]);
    const binding = snapshotBinding(fields.binding);
    const attemptId = validateAttempt(fields.attemptId);
    const principal = snapshotPrincipal(fields.principal);
    if (principal.tenant_id !== binding.tenant_id || principal.subject_id !== binding.subject ||
        principal.connection_id !== attemptId) fail("INVALID_REQUEST");
    if (!fields.client || typeof fields.client !== "object" || types.isProxy(fields.client) ||
        !isOwnerSunoGenerationResultMessageContext(fields.resultContext, fields.client)) fail("TRACK_CONTEXT_UNAVAILABLE");

    const context = snapshotNativeContext(fields.resultContext);
    if (context.attempt_id !== attemptId || !sameGenerationPrincipal(context.principal, principal)) {
      fail("TRACK_CONTEXT_UNAVAILABLE");
    }
    const messageObjectId = validateSafeId(fields.messageObjectId);
    if (!context.message_object_ids.includes(messageObjectId)) fail("TRACK_CONTEXT_UNAVAILABLE");
    let trackMetadata: readonly TrackMetadataSnapshot[];
    try {
      trackMetadata = snapshotTrackMetadata(Reflect.apply(NATIVE_TRACK_METADATA, fields.client, [fields.resultContext]), context);
    } catch { return fail("TRACK_CONTEXT_UNAVAILABLE"); }
    const matches = trackMetadata.filter((entry) => entry.message_object_id === messageObjectId);
    if (matches.length !== 1) fail("TRACK_CONTEXT_UNAVAILABLE");
    const { clip_id: clipId, task_id: taskId } = matches[0]!;
    return this.#issueContext({ binding, attemptId, principal, context, messageObjectId, clipId, taskId,
      sourceKind: "OWNER_GENERATION" });
  }

  /** Issues an existing-track handle only from a native-branded imported result with exact cached metadata. */
  issueExistingOwnerTrack(input: OwnerSunoExistingTrackContextIssueInput | unknown): string {
    this.#assertOpen();
    const fields = exactRecord(input, ["binding", "attemptId", "principal", "client", "resultContext", "messageObjectId"]);
    const binding = snapshotBinding(fields.binding);
    const attemptId = validateAttempt(fields.attemptId);
    const principal = snapshotPrincipal(fields.principal);
    if (principal.tenant_id !== binding.tenant_id || principal.subject_id !== binding.subject ||
        principal.connection_id !== attemptId) fail("INVALID_REQUEST");
    if (!fields.client || typeof fields.client !== "object" || types.isProxy(fields.client) ||
        Object.getPrototypeOf(fields.client) !== SyntxChatHttpClient.prototype ||
        !isOwnerSunoExistingTrackResultMessageContext(fields.resultContext, fields.client)) fail("TRACK_CONTEXT_UNAVAILABLE");

    const context = snapshotExistingNativeContext(fields.resultContext);
    if (context.attempt_id !== attemptId || !sameGenerationPrincipal(context.principal, principal)) {
      fail("TRACK_CONTEXT_UNAVAILABLE");
    }
    const messageObjectId = validateSafeId(fields.messageObjectId);
    if (!context.message_object_ids.includes(messageObjectId)) fail("TRACK_CONTEXT_UNAVAILABLE");
    let metadata: readonly ExistingTrackMetadataSnapshot[];
    try {
      metadata = snapshotExistingTrackMetadata(Reflect.apply(NATIVE_EXISTING_TRACK_METADATA, fields.client, [fields.resultContext]), context);
    } catch { return fail("TRACK_CONTEXT_UNAVAILABLE"); }
    const matches = metadata.filter((entry) => entry.message_object_id === messageObjectId);
    if (matches.length !== 1) fail("TRACK_CONTEXT_UNAVAILABLE");
    const match = matches[0]!;
    return this.#issueContext({ binding, attemptId, principal, context, messageObjectId,
      clipId: match.clip_id, taskId: match.task_id, sourceKind: "EXISTING_OWNER_TRACK",
      artifact: Object.freeze({ url: match.object_url, mime_type: mimeTypeFromUrl(match.object_url) }) });
  }

  /** Resolves only for the exact tenant, authenticated subject, link attempt, and server principal. */
  resolve(input: OwnerSunoTrackContextResolveInput | unknown): Readonly<OwnerSunoTrackContextProjection> {
    this.#assertOpen();
    const fields = exactRecord(input, ["binding", "attemptId", "principal", "trackHandle"]);
    const binding = snapshotBinding(fields.binding);
    const attemptId = validateAttempt(fields.attemptId);
    const principal = snapshotPrincipal(fields.principal);
    if (principal.tenant_id !== binding.tenant_id || principal.subject_id !== binding.subject ||
        principal.connection_id !== attemptId) fail("TRACK_CONTEXT_UNAVAILABLE");
    if (typeof fields.trackHandle !== "string" || !HANDLE.test(fields.trackHandle)) fail("TRACK_CONTEXT_UNAVAILABLE");

    const now = this.#readNow();
    const record = this.#records.get(fields.trackHandle);
    if (!record || record.tenant_id !== binding.tenant_id || record.subject !== binding.subject ||
        record.attempt_id !== attemptId || !sameGenerationPrincipal(record.principal, principal)) {
      fail("TRACK_CONTEXT_UNAVAILABLE");
    }
    if (record.expires_at <= now) {
      this.#records.delete(record.track_handle);
      fail("TRACK_CONTEXT_EXPIRED");
    }
    const { tenant_id: _tenantId, subject: _subject, ...projection } = record;
    return Object.freeze({ ...projection, principal: Object.freeze({ ...record.principal }) });
  }

  /** Removes only rows matching the exact auth binding and link attempt. */
  invalidateAttempt(bindingInput: AuthBinding | unknown, attemptInput: unknown): void {
    this.#assertOpen();
    const binding = snapshotBinding(bindingInput);
    const attemptId = validateAttempt(attemptInput);
    for (const [handle, record] of this.#records) {
      if (record.tenant_id === binding.tenant_id && record.subject === binding.subject && record.attempt_id === attemptId) {
        this.#records.delete(handle);
      }
    }
  }

  close(): void {
    this.#records.clear();
    this.#closed = true;
  }

  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }

  #issueContext(input: Readonly<{ binding: Readonly<AuthBinding>; attemptId: string;
    principal: Readonly<GenerationPrincipalRef>; context: NativeContextSnapshot; messageObjectId: string;
    clipId: string; taskId: string; sourceKind: OwnerSunoTrackContextProjection["source_kind"];
    artifact?: OwnerSunoTrackContextProjection["artifact"] }>): string {
    const now = this.#readNow();
    this.#prune(now);
    if (this.#records.size >= this.#maxRecords) fail("CAPACITY_EXCEEDED");
    if (now > Number.MAX_SAFE_INTEGER - this.#ttlMs) fail("CLOCK_INVALID");
    const handle = `track_${randomUUID()}`;
    this.#records.set(handle, Object.freeze({
      track_handle: handle, tenant_id: input.binding.tenant_id, subject: input.binding.subject,
      attempt_id: input.attemptId, principal: input.principal, model_id: input.context.model_id,
      chat_uuid: input.context.chat_uuid, message_id: input.context.message_id, message_object_id: input.messageObjectId,
      owner_echo_message_id: input.context.owner_echo_message_id, intent_fingerprint: input.context.intent_fingerprint,
      source_profile_schema_hash: input.context.source_profile_schema_hash, source_kind: input.sourceKind,
      clip_id: input.clipId, task_id: input.taskId, expires_at: now + this.#ttlMs,
      ...(input.artifact === undefined ? {} : { artifact: Object.freeze({ ...input.artifact }) })
    }));
    return handle;
  }

  #readNow(): number {
    let value: number;
    try { value = this.#now(); } catch { return fail("CLOCK_INVALID"); }
    if (!Number.isSafeInteger(value) || value < 0 || (this.#lastNow !== undefined && value < this.#lastNow)) fail("CLOCK_INVALID");
    this.#lastNow = value;
    return value;
  }

  #prune(now: number): void {
    for (const [handle, record] of this.#records) if (record.expires_at <= now) this.#records.delete(handle);
  }
}

interface NativeContextSnapshot {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly model_id: "V6" | "V6_wild";
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly string[];
  readonly owner_echo_message_id: string;
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly intent_fingerprint: string;
  readonly source_profile_schema_hash: string;
}

interface TrackMetadataSnapshot {
  readonly message_object_id: string;
  readonly clip_id: string;
  readonly task_id: string;
  readonly model_id: "V6" | "V6_wild";
}

interface ExistingNativeContextSnapshot extends NativeContextSnapshot {
  readonly source_kind: "EXISTING_OWNER_TRACK";
}

interface ExistingTrackMetadataSnapshot extends TrackMetadataSnapshot {
  readonly object_url: string;
}

function snapshotNativeContext(value: unknown): NativeContextSnapshot {
  const fields = exactRecord(value, CONTEXT_KEYS);
  const attemptId = validateAttempt(fields.attempt_id);
  const principal = snapshotPrincipal(fields.principal);
  const objectIds = snapshotSafeIdArray(fields.message_object_ids);
  if (!isModel(fields.model_id) || !isSafeProviderChatId(fields.provider_chat_id) || objectIds.length === 0 ||
      !SAFE_ID.test(String(fields.chat_uuid)) || !SAFE_ID.test(String(fields.message_id)) ||
      !SAFE_ID.test(String(fields.owner_echo_message_id)) || !INTENT_FINGERPRINT.test(String(fields.intent_fingerprint)) ||
      !PROFILE_HASH.test(String(fields.source_profile_schema_hash))) fail("TRACK_CONTEXT_UNAVAILABLE");
  return Object.freeze({ chat_uuid: fields.chat_uuid as string, message_id: fields.message_id as string,
    model_id: fields.model_id, provider_chat_id: fields.provider_chat_id, message_object_ids: objectIds,
    owner_echo_message_id: fields.owner_echo_message_id as string, attempt_id: attemptId, principal,
    intent_fingerprint: fields.intent_fingerprint as string, source_profile_schema_hash: fields.source_profile_schema_hash as string });
}

function snapshotExistingNativeContext(value: unknown): ExistingNativeContextSnapshot {
  const fields = exactRecord(value, [...CONTEXT_KEYS, "source_kind"]);
  if (fields.source_kind !== "EXISTING_OWNER_TRACK" || typeof fields.intent_fingerprint !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(fields.intent_fingerprint)) fail("TRACK_CONTEXT_UNAVAILABLE");
  const base = snapshotNativeContext(Object.freeze(Object.fromEntries(CONTEXT_KEYS.map((key) => [key,
    key === "intent_fingerprint" ? (fields.intent_fingerprint as string).slice("sha256:".length) : fields[key]
  ]))));
  return Object.freeze({ ...base, source_kind: "EXISTING_OWNER_TRACK" });
}

function snapshotExistingTrackMetadata(value: unknown, context: ExistingNativeContextSnapshot): readonly ExistingTrackMetadataSnapshot[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || !Object.isFrozen(value)) {
    fail("TRACK_CONTEXT_UNAVAILABLE");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = (descriptors["length"] as PropertyDescriptor | undefined)?.value;
  if (!Number.isSafeInteger(length) || (length as number) > 64 || Reflect.ownKeys(descriptors).length !== (length as number) + 1) {
    fail("TRACK_CONTEXT_UNAVAILABLE");
  }
  const result: ExistingTrackMetadataSnapshot[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < (length as number); index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail("TRACK_CONTEXT_UNAVAILABLE");
    const fields = exactRecord(descriptor.value, ["object_index", "message_object_id", "object_url", "clip_id", "task_id", "model_id"]);
    const messageObjectId = validateSafeId(fields.message_object_id);
    const objectUrl = fields.object_url;
    const clipId = validateTrackIdentifier(fields.clip_id);
    const taskId = validateTrackIdentifier(fields.task_id);
    if (!isModel(fields.model_id) || fields.model_id !== context.model_id ||
        !Number.isSafeInteger(fields.object_index) || (fields.object_index as number) < 0 ||
        !context.message_object_ids.includes(messageObjectId) || seen.has(messageObjectId) ||
        typeof objectUrl !== "string" || !isSafeUploadReferenceUrl(objectUrl)) fail("TRACK_CONTEXT_UNAVAILABLE");
    seen.add(messageObjectId);
    result.push(Object.freeze({ message_object_id: messageObjectId, clip_id: clipId, task_id: taskId,
      model_id: fields.model_id, object_url: objectUrl }));
  }
  return Object.freeze(result);
}

function mimeTypeFromUrl(value: string): "audio/mpeg" | "audio/wav" | "audio/mp4" | null {
  try { return MIME_BY_EXTENSION.get(/\.([A-Za-z0-9]{1,8})$/u.exec(new URL(value).pathname)?.[1]?.toLowerCase() ?? "") ?? null; }
  catch { return null; }
}

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (!isBindingString(fields.tenant_id, 256) || !isBindingString(fields.subject, 512)) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}

function snapshotPrincipal(value: unknown): Readonly<GenerationPrincipalRef> {
  const fields = exactRecord(value, ["tenant_id", "subject_id", "connection_id"]);
  try { return snapshotGenerationPrincipal({ tenant_id: fields.tenant_id as string,
    subject_id: fields.subject_id as string, connection_id: fields.connection_id as string }); }
  catch { return fail("INVALID_REQUEST"); }
}

function snapshotSafeIdArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) fail("TRACK_CONTEXT_UNAVAILABLE");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const lengthDescriptor = descriptors["length"] as PropertyDescriptor | undefined;
  const length = lengthDescriptor?.value;
  if (!Number.isSafeInteger(length) || (length as number) < 1 || (length as number) > 64 ||
      Reflect.ownKeys(descriptors).length !== (length as number) + 1) fail("TRACK_CONTEXT_UNAVAILABLE");
  const result: string[] = [];
  for (let index = 0; index < (length as number); index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor)) fail("TRACK_CONTEXT_UNAVAILABLE");
    result.push(validateSafeId(descriptor.value));
  }
  if (new Set(result).size !== result.length) fail("TRACK_CONTEXT_UNAVAILABLE");
  return Object.freeze(result);
}

function snapshotTrackMetadata(value: unknown, context: NativeContextSnapshot): readonly TrackMetadataSnapshot[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || !Object.isFrozen(value)) {
    fail("TRACK_CONTEXT_UNAVAILABLE");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = (descriptors["length"] as PropertyDescriptor | undefined)?.value;
  if (!Number.isSafeInteger(length) || (length as number) > 64 ||
      Reflect.ownKeys(descriptors).length !== (length as number) + 1) fail("TRACK_CONTEXT_UNAVAILABLE");
  const result: TrackMetadataSnapshot[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < (length as number); index += 1) {
    const entryDescriptor = descriptors[String(index)];
    if (!entryDescriptor || !("value" in entryDescriptor) || !entryDescriptor.enumerable) fail("TRACK_CONTEXT_UNAVAILABLE");
    const fields = exactRecord(entryDescriptor.value, ["message_object_id", "clip_id", "task_id", "model_id"]);
    const messageObjectId = validateSafeId(fields.message_object_id);
    const clipId = validateTrackIdentifier(fields.clip_id);
    const taskId = validateTrackIdentifier(fields.task_id);
    if (!isModel(fields.model_id) || fields.model_id !== context.model_id ||
        !context.message_object_ids.includes(messageObjectId) || seen.has(messageObjectId)) fail("TRACK_CONTEXT_UNAVAILABLE");
    seen.add(messageObjectId);
    result.push(Object.freeze({ message_object_id: messageObjectId, clip_id: clipId, task_id: taskId, model_id: fields.model_id }));
  }
  return Object.freeze(result);
}

function validateSafeId(value: unknown): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) fail("INVALID_REQUEST");
  return value;
}
function validateTrackIdentifier(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || value.trim() !== value ||
      /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value) || !isWellFormedUnicode(value)) fail("INVALID_REQUEST");
  return value;
}
function validateAttempt(value: unknown): string {
  if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST");
  return value;
}
function isModel(value: unknown): value is "V6" | "V6_wild" { return typeof value === "string" && MODELS.has(value); }
function isSafeProviderChatId(value: unknown): value is string { return typeof value === "string" && SAFE_PROVIDER_CHAT_ID.test(value); }
function isBindingString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value);
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); }
  catch { return fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(descriptors), allowed = [...required, ...optional];
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!) ||
        descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function readClock(value: unknown): () => number {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return () => Reflect.apply(value as () => number, undefined, []);
}

function fail(code: OwnerSunoTrackContextStoreErrorCode): never { throw new OwnerSunoTrackContextStoreError(code); }
