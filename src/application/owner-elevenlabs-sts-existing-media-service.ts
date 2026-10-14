import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import type { OwnerElevenLabsStsExistingCandidates, OwnerElevenLabsStsExistingChatContext,
  OwnerElevenLabsStsExistingChatPage, OwnerElevenLabsStsExistingResultContext } from "../adapter/syntx/owner-elevenlabs-sts-existing-media.js";
import type { OwnerElevenLabsStsResult } from "../adapter/syntx/owner-elevenlabs-sts-result-codec.js";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const MODEL = "eleven_multilingual_sts_v2" as const;
const PAGE_SIZE = 20 as const;
const MAX_PAGE = 100;
const HANDLE_TTL_MS = 15 * 60_000;
const MAX_HANDLES = 128;
const MAX_RUNS = 4;
const DEFAULT_TIMEOUT_MS = 120_000;
const INDEX = SyntxChatHttpClient.prototype.listOwnedElevenLabsStsExistingChats;
const HISTORY = SyntxChatHttpClient.prototype.listOwnedElevenLabsStsExistingCandidates;
const RESULT = SyntxChatHttpClient.prototype.getOwnedElevenLabsStsExistingResult;

export interface OwnerElevenLabsStsExistingMediaServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}
export interface OwnerElevenLabsStsExistingMediaListInput { readonly attemptId: string; readonly page: number }
export interface OwnerElevenLabsStsExistingMediaProof {
  readonly owner: "CURRENT_LINK_REVALIDATED";
  readonly index: "CURRENT_OWNER_AUDIO_INDEX_AND_STS_TITLE";
  readonly history: "COMPLETE_UNIQUE_OWNER_ACK_AND_BOT_RESULT";
  readonly model: "MATCHED_ELEVENLABS_STS_V2";
  readonly result: "COMPLETED_EXACT_AUDIO_OBJECT";
  readonly source_provenance: "NOT_AVAILABLE";
  readonly provider_terminal_status: "UNPROVEN";
}
export interface OwnerElevenLabsStsExistingMediaListItem {
  readonly result_handle: string;
  readonly expires_in_seconds: number;
  readonly model_id: typeof MODEL;
  readonly proof: OwnerElevenLabsStsExistingMediaProof;
}
export interface OwnerElevenLabsStsExistingMediaList {
  readonly page: number;
  readonly page_size: typeof PAGE_SIZE;
  readonly total_count: number;
  readonly total_pages: number;
  readonly has_next: boolean;
  readonly has_previous: boolean;
  readonly results: readonly OwnerElevenLabsStsExistingMediaListItem[];
}
export interface OwnerElevenLabsStsExistingMediaArtifact {
  readonly model_id: typeof MODEL;
  readonly object_url: string;
  readonly mime_type: "audio/mpeg";
  readonly output_identity: "UNHASHED_URL_REFERENCE";
  readonly proof: OwnerElevenLabsStsExistingMediaProof;
}
export type OwnerElevenLabsStsExistingMediaServiceErrorCode = "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" |
  "PRINCIPAL_NOT_LINKED" | "INDEX_UNAVAILABLE" | "HISTORY_UNAVAILABLE" | "RESULT_UNAVAILABLE" |
  "RESULT_HANDLE_EXPIRED" | "CAPACITY_EXCEEDED" | "REQUEST_ABORTED";
export class OwnerElevenLabsStsExistingMediaServiceError extends Error {
  constructor(readonly code: OwnerElevenLabsStsExistingMediaServiceErrorCode) {
    super("Existing owner ElevenLabs STS media could not be verified safely.");
    this.name = "OwnerElevenLabsStsExistingMediaServiceError";
  }
}

interface HandleState {
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly client: SyntxChatHttpClient;
  readonly context: OwnerElevenLabsStsExistingResultContext;
  readonly objectKey: string;
  readonly issuedAt: number;
}
interface ActiveRun { readonly attemptId: string; readonly controller: AbortController; promise: Promise<unknown> }
const PROOF: OwnerElevenLabsStsExistingMediaProof = Object.freeze({ owner: "CURRENT_LINK_REVALIDATED",
  index: "CURRENT_OWNER_AUDIO_INDEX_AND_STS_TITLE", history: "COMPLETE_UNIQUE_OWNER_ACK_AND_BOT_RESULT",
  model: "MATCHED_ELEVENLABS_STS_V2", result: "COMPLETED_EXACT_AUDIO_OBJECT", source_provenance: "NOT_AVAILABLE",
  provider_terminal_status: "UNPROVEN" });

/** Read-only discovery for completed, pre-existing owner STS media. */
export class OwnerElevenLabsStsExistingMediaService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: PerUserLinkService;
  readonly #resolveChatClient: OwnerElevenLabsStsExistingMediaServiceOptions["resolveChatClient"];
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #handles = new Map<string, HandleState>();
  readonly #handleByObject = new Map<string, string>();
  readonly #runs = new Set<ActiveRun>();
  readonly #activeAttempts = new Set<string>();
  readonly #invalidating = new Set<string>();
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(optionsInput: OwnerElevenLabsStsExistingMediaServiceOptions | unknown) {
    const options = exactRecord(optionsInput, ["binding", "linkService", "resolveChatClient"], ["now", "timeoutMs"]);
    this.#binding = snapshotBinding(options.binding);
    if (!isExactLinkService(options.linkService) || typeof options.resolveChatClient !== "function" || types.isProxy(options.resolveChatClient) ||
        (options.now !== undefined && (typeof options.now !== "function" || types.isProxy(options.now)))) invalid();
    this.#linkService = options.linkService as PerUserLinkService;
    this.#resolveChatClient = options.resolveChatClient as OwnerElevenLabsStsExistingMediaServiceOptions["resolveChatClient"];
    this.#now = readClock(options.now);
    this.#timeoutMs = bounded(options.timeoutMs, 1_000, 300_000, DEFAULT_TIMEOUT_MS);
    Object.freeze(this);
  }

  async listExistingResults(input: OwnerElevenLabsStsExistingMediaListInput | unknown,
    signal?: AbortSignal): Promise<OwnerElevenLabsStsExistingMediaList> {
    const request = snapshotListInput(input);
    return await this.#run(request.attemptId, signal, (runSignal) => this.#list(request, runSignal));
  }

  async getExistingResult(input: Readonly<{ attemptId: string; result_handle: string }> | unknown,
    signal?: AbortSignal): Promise<OwnerElevenLabsStsExistingMediaArtifact> {
    const request = snapshotHandleInput(input);
    return await this.#run(request.attemptId, signal, (runSignal) => this.#get(request, runSignal));
  }

  async invalidateAttempt(attemptInput: unknown): Promise<void> {
    const attemptId = validateAttempt(attemptInput);
    this.#invalidating.add(attemptId);
    const active = [...this.#runs].filter((run) => run.attemptId === attemptId);
    for (const run of active) run.controller.abort();
    await Promise.allSettled(active.map((run) => run.promise));
    this.#dropAttempt(attemptId);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const run of this.#runs) run.controller.abort();
    this.#closing = (async () => {
      await Promise.allSettled([...this.#runs].map((run) => run.promise));
      this.#handles.clear(); this.#handleByObject.clear();
    })();
    return this.#closing;
  }

  async #list(request: Readonly<OwnerElevenLabsStsExistingMediaListInput>, parent: AbortSignal): Promise<OwnerElevenLabsStsExistingMediaList> {
    const deadline = new AbsoluteRequestDeadline(this.#timeoutMs, parent, () => fail("REQUEST_ABORTED"));
    try {
      const principal = await this.#await(deadline, () => this.#principal(request.attemptId));
      const client = this.#resolveNativeClient(request.attemptId);
      let page: OwnerElevenLabsStsExistingChatPage;
      try {
        page = await this.#await(deadline, () => Reflect.apply(INDEX, client, [
          { attemptId: request.attemptId, principal, binding: this.#binding, linkService: this.#linkService, page: request.page }, deadline.signal
        ]) as Promise<OwnerElevenLabsStsExistingChatPage>);
        await this.#await(deadline, () => this.#assertPrincipal(request.attemptId, principal));
      } catch { deadline.throwIfAborted(); return fail("INDEX_UNAVAILABLE"); }
      if (page.page !== request.page || page.page_size !== PAGE_SIZE || !Array.isArray(page.chats) || page.chats.length > PAGE_SIZE ||
          !validPage(page, request.page)) fail("INDEX_UNAVAILABLE");
      const results: OwnerElevenLabsStsExistingMediaListItem[] = [];
      for (const chat of page.chats) {
        deadline.throwIfAborted();
        if (!validChat(chat, request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
        let candidates: OwnerElevenLabsStsExistingCandidates;
        try {
          candidates = await this.#await(deadline, () => Reflect.apply(HISTORY, client, [chat, deadline.signal]) as Promise<OwnerElevenLabsStsExistingCandidates>);
          await this.#await(deadline, () => this.#assertPrincipal(request.attemptId, principal));
        } catch { deadline.throwIfAborted(); return fail("HISTORY_UNAVAILABLE"); }
        if (candidates.status !== "COMPLETE" || candidates.owner_ack_status !== "MATCHED" || candidates.history_page_status !== "COMPLETE") continue;
        if (!Array.isArray(candidates.contexts) || candidates.contexts.length !== 1) fail("HISTORY_UNAVAILABLE");
        const context = candidates.contexts[0]!;
        if (!validResultContext(context, request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
        let verified: OwnerElevenLabsStsResult;
        try {
          verified = await this.#await(deadline, () => Reflect.apply(RESULT, client, [context, deadline.signal]) as Promise<OwnerElevenLabsStsResult>);
          await this.#await(deadline, () => this.#assertPrincipal(request.attemptId, principal));
        } catch { deadline.throwIfAborted(); return fail("RESULT_UNAVAILABLE"); }
        if (verified.message_binding !== "BOUND" || verified.model_echo !== "MATCHED" || verified.ready_audio.length !== 1) continue;
        const object = verified.ready_audio[0]!;
        if (object.object_type !== "audio" || object.mime_type !== "audio/mpeg" || object.message_object_id !== context.message_object_ids[0]) continue;
        const item = this.#issueOrReuse(request.attemptId, principal, client, context, object.message_object_id);
        results.push(item);
      }
      deadline.throwIfAborted();
      await this.#assertPrincipal(request.attemptId, principal);
      return Object.freeze({ page: page.page, page_size: PAGE_SIZE, total_count: page.total_count, total_pages: page.total_pages,
        has_next: page.has_next, has_previous: page.has_previous, results: Object.freeze(results) });
    } finally { deadline.close(); }
  }

  async #get(request: Readonly<{ attemptId: string; resultHandle: string }>, parent: AbortSignal): Promise<OwnerElevenLabsStsExistingMediaArtifact> {
    const deadline = new AbsoluteRequestDeadline(this.#timeoutMs, parent, () => fail("REQUEST_ABORTED"));
    try {
      const principal = await this.#await(deadline, () => this.#principal(request.attemptId));
      const state = this.#handles.get(request.resultHandle);
      if (!state || state.attemptId !== request.attemptId || !sameGenerationPrincipal(state.principal, principal)) fail("RESULT_HANDLE_EXPIRED");
      if (this.#readNow() - state.issuedAt >= HANDLE_TTL_MS) { this.#removeHandle(request.resultHandle, state); fail("RESULT_HANDLE_EXPIRED"); }
      const client = this.#resolveNativeClient(request.attemptId);
      if (client !== state.client) fail("RESULT_UNAVAILABLE");
      let verified: OwnerElevenLabsStsResult;
      try {
        verified = await this.#await(deadline, () => Reflect.apply(RESULT, client, [state.context, deadline.signal]) as Promise<OwnerElevenLabsStsResult>);
        await this.#await(deadline, () => this.#assertPrincipal(request.attemptId, principal));
      } catch { deadline.throwIfAborted(); return fail("RESULT_UNAVAILABLE"); }
      deadline.throwIfAborted();
      if (this.#closed || this.#invalidating.has(request.attemptId) || this.#handles.get(request.resultHandle) !== state ||
          this.#readNow() - state.issuedAt >= HANDLE_TTL_MS) fail("RESULT_HANDLE_EXPIRED");
      if (verified.message_binding !== "BOUND" || verified.model_echo !== "MATCHED" || verified.ready_audio.length !== 1) fail("RESULT_UNAVAILABLE");
      const audio = verified.ready_audio[0]!;
      if (audio.object_type !== "audio" || audio.mime_type !== "audio/mpeg" || audio.message_object_id !== state.context.message_object_ids[0]) fail("RESULT_UNAVAILABLE");
      return Object.freeze({ model_id: MODEL, object_url: audio.object_url, mime_type: "audio/mpeg",
        output_identity: "UNHASHED_URL_REFERENCE", proof: PROOF });
    } finally { deadline.close(); }
  }

  #issueOrReuse(attemptId: string, principal: Readonly<GenerationPrincipalRef>, client: SyntxChatHttpClient,
    context: OwnerElevenLabsStsExistingResultContext, objectId: string): OwnerElevenLabsStsExistingMediaListItem {
    const objectKey = JSON.stringify([attemptId, principal.tenant_id, principal.subject_id, context.chat_uuid, context.message_id, objectId]);
    const priorHandle = this.#handleByObject.get(objectKey), prior = priorHandle ? this.#handles.get(priorHandle) : undefined;
    const now = this.#readNow();
    if (priorHandle && prior && now - prior.issuedAt < HANDLE_TTL_MS) return listItem(priorHandle, prior.issuedAt, now);
    if (priorHandle) this.#removeHandle(priorHandle, prior);
    this.#purgeExpired(now);
    if (this.#handles.size >= MAX_HANDLES) fail("CAPACITY_EXCEEDED");
    const handle = `existing_elevenlabs_sts_${randomUUID()}`;
    const state = Object.freeze({ attemptId, principal, client, context, objectKey, issuedAt: now });
    this.#handles.set(handle, state); this.#handleByObject.set(objectKey, handle);
    return listItem(handle, now, now);
  }

  #resolveNativeClient(attemptId: string): SyntxChatHttpClient {
    if (this.#invalidating.has(attemptId)) fail("PRINCIPAL_NOT_LINKED");
    let client: unknown;
    try { client = Reflect.apply(this.#resolveChatClient, undefined, [attemptId]); } catch { fail("INDEX_UNAVAILABLE"); }
    if (!isNativeClient(client)) fail("INDEX_UNAVAILABLE");
    return client;
  }
  async #principal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    try {
      const principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
      if (principal.connection_id !== attemptId || principal.tenant_id !== this.#binding.tenant_id || principal.subject_id !== this.#binding.subject ||
          this.#invalidating.has(attemptId)) fail("PRINCIPAL_NOT_LINKED");
      return principal;
    } catch { fail("PRINCIPAL_NOT_LINKED"); }
  }
  async #assertPrincipal(attemptId: string, expected: Readonly<GenerationPrincipalRef>): Promise<void> {
    const current = await this.#principal(attemptId);
    if (!sameGenerationPrincipal(current, expected)) fail("PRINCIPAL_NOT_LINKED");
  }
  #readNow(): number {
    let value: number; try { value = this.#now(); } catch { fail("SERVICE_BUSY"); }
    if (!Number.isSafeInteger(value) || value < 0) fail("SERVICE_BUSY"); return value;
  }
  #purgeExpired(now: number): void { for (const [handle, state] of this.#handles) if (now - state.issuedAt >= HANDLE_TTL_MS) this.#removeHandle(handle, state); }
  #removeHandle(handle: string, state: HandleState | undefined): void {
    this.#handles.delete(handle); if (state && this.#handleByObject.get(state.objectKey) === handle) this.#handleByObject.delete(state.objectKey);
  }
  #dropAttempt(attemptId: string): void { for (const [handle, state] of this.#handles) if (state.attemptId === attemptId) this.#removeHandle(handle, state); }
  async #await<T>(deadline: AbsoluteRequestDeadline, operation: () => Promise<T>): Promise<T> {
    deadline.throwIfAborted(); try { return await deadline.waitFor(operation()); } catch (error) { deadline.throwIfAborted(); throw error; }
  }
  async #run<T>(attemptId: string, parent: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.#closed) fail("SERVICE_CLOSED");
    if (this.#invalidating.has(attemptId)) fail("PRINCIPAL_NOT_LINKED");
    if (this.#runs.size >= MAX_RUNS || this.#activeAttempts.has(attemptId)) fail("SERVICE_BUSY");
    if (parent !== undefined && (types.isProxy(parent) || !(parent instanceof AbortSignal))) invalid();
    const controller = new AbortController(), abortParent = () => controller.abort(parent?.reason);
    if (parent?.aborted) abortParent(); else parent?.addEventListener("abort", abortParent, { once: true });
    const run: ActiveRun = { attemptId, controller, promise: Promise.resolve() };
    const promise = Promise.resolve().then(() => operation(controller.signal)); run.promise = promise;
    this.#runs.add(run); this.#activeAttempts.add(attemptId);
    try { return await promise; } finally { parent?.removeEventListener("abort", abortParent); this.#runs.delete(run); this.#activeAttempts.delete(attemptId); }
  }
}

function listItem(handle: string, issuedAt: number, now: number): OwnerElevenLabsStsExistingMediaListItem {
  return Object.freeze({ result_handle: handle, expires_in_seconds: Math.max(1, Math.ceil((issuedAt + HANDLE_TTL_MS - now) / 1_000)), model_id: MODEL, proof: PROOF });
}
function validPage(page: OwnerElevenLabsStsExistingChatPage, requested: number): boolean {
  const pages = page.total_count === 0 ? 0 : Math.ceil(page.total_count / PAGE_SIZE);
  const rows = Math.min(PAGE_SIZE, Math.max(0, page.total_count - (requested - 1) * PAGE_SIZE));
  return Number.isSafeInteger(page.total_count) && page.total_count >= 0 && page.total_pages === pages &&
    page.has_previous === (requested > 1) && page.has_next === (requested < pages) && page.chats.length <= rows &&
    (pages === 0 || requested <= pages);
}
function validChat(value: OwnerElevenLabsStsExistingChatContext, attempt: string, principal: Readonly<GenerationPrincipalRef>): boolean {
  return value?.source_kind === "EXISTING_OWNER_STS_CHAT" && value.attempt_id === attempt && sameGenerationPrincipal(value.principal, principal);
}
function validResultContext(value: OwnerElevenLabsStsExistingResultContext, attempt: string, principal: Readonly<GenerationPrincipalRef>): boolean {
  return value?.source_kind === "EXISTING_OWNER_STS_RESULT" && value.model_id === MODEL && value.attempt_id === attempt &&
    sameGenerationPrincipal(value.principal, principal) && Array.isArray(value.message_object_ids) && value.message_object_ids.length === 1;
}
function isNativeClient(value: unknown): value is SyntxChatHttpClient {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === SyntxChatHttpClient.prototype &&
    Reflect.get(value, "listOwnedElevenLabsStsExistingChats") === INDEX && Reflect.get(value, "listOwnedElevenLabsStsExistingCandidates") === HISTORY &&
    Reflect.get(value, "getOwnedElevenLabsStsExistingResult") === RESULT; } catch { return false; }
}
function isExactLinkService(value: unknown): value is PerUserLinkService {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === PerUserLinkService.prototype &&
    !Object.hasOwn(value, "getStatus") && Reflect.get(value, "getStatus") === PerUserLinkService.prototype.getStatus; } catch { return false; }
}
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  let prototype: object | null; let descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); } catch { return invalid(); }
  const keys = Reflect.ownKeys(descriptors), allowed = [...required, ...optional];
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value; return result;
}
function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || !fields.tenant_id || fields.tenant_id.length > 256 ||
      typeof fields.subject !== "string" || !fields.subject || fields.subject.length > 512) invalid();
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}
function snapshotListInput(value: unknown): Readonly<OwnerElevenLabsStsExistingMediaListInput> {
  const fields = exactRecord(value, ["attemptId", "page"]), attemptId = validateAttempt(fields.attemptId);
  if (!Number.isSafeInteger(fields.page) || (fields.page as number) < 1 || (fields.page as number) > MAX_PAGE) invalid();
  return Object.freeze({ attemptId, page: fields.page as number });
}
function snapshotHandleInput(value: unknown): Readonly<{ attemptId: string; resultHandle: string }> {
  const fields = exactRecord(value, ["attemptId", "result_handle"]), attemptId = validateAttempt(fields.attemptId);
  if (typeof fields.result_handle !== "string" || !/^existing_elevenlabs_sts_[0-9a-f-]{36}$/u.test(fields.result_handle)) invalid();
  return Object.freeze({ attemptId, resultHandle: fields.result_handle });
}
function validateAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) invalid(); return value; }
function bounded(value: unknown, min: number, max: number, fallback: number): number {
  const result = value ?? fallback; if (!Number.isSafeInteger(result) || (result as number) < min || (result as number) > max) invalid(); return result as number;
}
function readClock(value: unknown): () => number {
  if (value === undefined) return Date.now;
  if (typeof value !== "function" || types.isProxy(value)) invalid(); return () => Reflect.apply(value as () => number, undefined, []);
}
function invalid(): never { throw new OwnerElevenLabsStsExistingMediaServiceError("INVALID_REQUEST"); }
function fail(code: OwnerElevenLabsStsExistingMediaServiceErrorCode): never { throw new OwnerElevenLabsStsExistingMediaServiceError(code); }
