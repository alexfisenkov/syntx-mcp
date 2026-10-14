import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import type { OwnerTopazAstraExistingCandidates, OwnerTopazAstraExistingChatContext, OwnerTopazAstraExistingChatPage,
  OwnerTopazAstraExistingResultContext } from "../adapter/syntx/owner-topaz-astra-existing-media.js";
import type { OwnerTopazAstraResult } from "../adapter/syntx/owner-topaz-astra-native-context.js";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u, HANDLE = /^existing_topaz_astra_[0-9a-f-]{36}$/u;
const MODELS = new Set(["slc-1", "slf-2", "slp-2", "slp-2.5"]);
const PAGE_SIZE = 20 as const, MAX_PAGE = 100, HANDLE_TTL_MS = 15 * 60_000, MAX_HANDLES = 128, MAX_RUNS = 4;
const DEFAULT_TIMEOUT_MS = 120_000;
const INDEX = SyntxChatHttpClient.prototype.listOwnedTopazAstraExistingChats;
const HISTORY = SyntxChatHttpClient.prototype.listOwnedTopazAstraExistingCandidates;
const RESULT = SyntxChatHttpClient.prototype.getOwnedTopazAstraExistingResult;
const SERVICES = new WeakSet<object>();

export interface OwnerTopazAstraExistingMediaServiceOptions {
  readonly binding: AuthBinding; readonly genuinePerUserLinkService: PerUserLinkService;
  readonly resolveChatClient: (attemptId: string) => unknown; readonly now?: () => number; readonly timeoutMs?: number;
}
export interface OwnerTopazAstraExistingMediaListInput { readonly attemptId: string; readonly page: number }
export interface OwnerTopazAstraExistingMediaProof {
  readonly owner: "CURRENT_LINK_REVALIDATED"; readonly index: "CURRENT_OWNER_TOPAZ_ASTRA_INDEX_AND_TITLE";
  readonly history: "COMPLETE_UNIQUE_OWNER_ACK_AND_BOT_VIDEO_RESULT"; readonly model: "MATCHED_TOPAZ_ASTRA_ALLOWLIST";
  readonly result: "COMPLETED_EXACT_MP4_VIDEO_OBJECT"; readonly source_provenance: "NOT_AVAILABLE"; readonly provider_terminal_status: "UNPROVEN";
}
export interface OwnerTopazAstraExistingMediaListItem { readonly result_handle: string; readonly expires_in_seconds: number;
  readonly model_id: OwnerTopazAstraExistingResultContext["model_id"]; readonly proof: OwnerTopazAstraExistingMediaProof }
export interface OwnerTopazAstraExistingMediaList { readonly page: number; readonly page_size: typeof PAGE_SIZE; readonly total_count: number;
  readonly total_pages: number; readonly has_next: boolean; readonly has_previous: boolean; readonly results: readonly OwnerTopazAstraExistingMediaListItem[] }
export interface OwnerTopazAstraExistingMediaArtifact { readonly model_id: OwnerTopazAstraExistingResultContext["model_id"];
  readonly object_url: string; readonly mime_type: "video/mp4"; readonly output_identity: "UNHASHED_URL_REFERENCE"; readonly proof: OwnerTopazAstraExistingMediaProof }
export type OwnerTopazAstraExistingMediaServiceErrorCode = "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "PRINCIPAL_NOT_LINKED" |
  "INDEX_UNAVAILABLE" | "HISTORY_UNAVAILABLE" | "RESULT_UNAVAILABLE" | "RESULT_HANDLE_EXPIRED" | "CAPACITY_EXCEEDED" | "REQUEST_ABORTED";
export class OwnerTopazAstraExistingMediaServiceError extends Error {
  constructor(readonly code: OwnerTopazAstraExistingMediaServiceErrorCode) {
    super("Existing owner Topaz Astra media could not be verified safely."); this.name = "OwnerTopazAstraExistingMediaServiceError";
  }
}

interface HandleState { readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly client: SyntxChatHttpClient; readonly context: OwnerTopazAstraExistingResultContext; readonly objectKey: string; readonly issuedAt: number }
interface ActiveRun { readonly attemptId: string; readonly controller: AbortController; promise: Promise<unknown> }
const PROOF: OwnerTopazAstraExistingMediaProof = Object.freeze({ owner: "CURRENT_LINK_REVALIDATED",
  index: "CURRENT_OWNER_TOPAZ_ASTRA_INDEX_AND_TITLE", history: "COMPLETE_UNIQUE_OWNER_ACK_AND_BOT_VIDEO_RESULT",
  model: "MATCHED_TOPAZ_ASTRA_ALLOWLIST", result: "COMPLETED_EXACT_MP4_VIDEO_OBJECT", source_provenance: "NOT_AVAILABLE", provider_terminal_status: "UNPROVEN" });

/** Read-only discovery of already-completed owner Topaz Astra video results. */
export class OwnerTopazAstraExistingMediaService {
  readonly #binding: Readonly<AuthBinding>; readonly #links: PerUserLinkService;
  readonly #resolveChatClient: OwnerTopazAstraExistingMediaServiceOptions["resolveChatClient"];
  readonly #now: () => number; readonly #timeoutMs: number; readonly #handles = new Map<string, HandleState>();
  readonly #handleByObject = new Map<string, string>(); readonly #runs = new Set<ActiveRun>();
  readonly #activeAttempts = new Set<string>(); readonly #invalidating = new Set<string>();
  #closed = false; #closing: Promise<void> | undefined;

  constructor(optionsInput: OwnerTopazAstraExistingMediaServiceOptions | unknown) {
    const options = exact(optionsInput, ["binding", "genuinePerUserLinkService", "resolveChatClient"], ["now", "timeoutMs"]);
    this.#binding = snapshotBinding(options.binding);
    if (!genuineMethods(options.genuinePerUserLinkService, PerUserLinkService, ["getStatus", "useCredential"]) ||
        typeof options.resolveChatClient !== "function" || types.isProxy(options.resolveChatClient) ||
        (options.now !== undefined && (typeof options.now !== "function" || types.isProxy(options.now)))) invalid();
    this.#links = options.genuinePerUserLinkService as PerUserLinkService;
    this.#resolveChatClient = options.resolveChatClient as OwnerTopazAstraExistingMediaServiceOptions["resolveChatClient"];
    this.#now = readClock(options.now); this.#timeoutMs = bounded(options.timeoutMs, 1_000, 300_000, DEFAULT_TIMEOUT_MS);
    SERVICES.add(this); Object.freeze(this);
  }

  async listExistingResults(input: OwnerTopazAstraExistingMediaListInput | unknown, signal?: AbortSignal): Promise<OwnerTopazAstraExistingMediaList> {
    const request = snapshotListInput(input); return await this.#run(request.attemptId, signal, (s) => this.#list(request, s));
  }
  async getExistingResult(input: Readonly<{ attemptId: string; result_handle: string }> | unknown, signal?: AbortSignal): Promise<OwnerTopazAstraExistingMediaArtifact> {
    const request = snapshotHandleInput(input); return await this.#run(request.attemptId, signal, (s) => this.#get(request, s));
  }
  async invalidateAttempt(value: unknown): Promise<void> {
    const attemptId = validateAttempt(value); this.#invalidating.add(attemptId);
    const active = [...this.#runs].filter((run) => run.attemptId === attemptId); for (const run of active) run.controller.abort();
    await Promise.allSettled(active.map((run) => run.promise)); this.#dropAttempt(attemptId);
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing; this.#closed = true;
    for (const run of this.#runs) run.controller.abort();
    this.#closing = (async () => { await Promise.allSettled([...this.#runs].map((run) => run.promise)); this.#handles.clear(); this.#handleByObject.clear(); })();
    return this.#closing;
  }

  async #list(request: Readonly<OwnerTopazAstraExistingMediaListInput>, parent: AbortSignal): Promise<OwnerTopazAstraExistingMediaList> {
    const deadline = new AbsoluteRequestDeadline(this.#timeoutMs, parent, () => fail("REQUEST_ABORTED"));
    try {
      const principal = await this.#await(deadline, () => this.#principal(request.attemptId)), client = this.#resolveNativeClient(request.attemptId);
      let page: OwnerTopazAstraExistingChatPage;
      try {
        page = await this.#await(deadline, () => Reflect.apply(INDEX, client, [{ attemptId: request.attemptId, principal, binding: this.#binding,
          linkService: this.#links, page: request.page }, deadline.signal]) as Promise<OwnerTopazAstraExistingChatPage>);
        await this.#await(deadline, () => this.#assertPrincipal(request.attemptId, principal));
      } catch { deadline.throwIfAborted(); return fail("INDEX_UNAVAILABLE"); }
      if (!validPage(page, request.page)) fail("INDEX_UNAVAILABLE");
      const results: OwnerTopazAstraExistingMediaListItem[] = [];
      for (const chat of page.chats) {
        deadline.throwIfAborted(); if (!validChat(chat, request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
        let candidates: OwnerTopazAstraExistingCandidates;
        try {
          candidates = await this.#await(deadline, () => Reflect.apply(HISTORY, client, [chat, deadline.signal]) as Promise<OwnerTopazAstraExistingCandidates>);
          await this.#await(deadline, () => this.#assertPrincipal(request.attemptId, principal));
        } catch { deadline.throwIfAborted(); return fail("HISTORY_UNAVAILABLE"); }
        if (candidates.status !== "COMPLETE" || candidates.owner_ack_status !== "MATCHED" || candidates.history_page_status !== "COMPLETE") continue;
        if (!Array.isArray(candidates.contexts) || candidates.contexts.length !== 1) fail("HISTORY_UNAVAILABLE");
        const context = candidates.contexts[0]!; if (!validResultContext(context, request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
        let verified: OwnerTopazAstraResult;
        try {
          verified = await this.#await(deadline, () => Reflect.apply(RESULT, client, [context, deadline.signal]) as Promise<OwnerTopazAstraResult>);
          await this.#await(deadline, () => this.#assertPrincipal(request.attemptId, principal));
        } catch { deadline.throwIfAborted(); return fail("RESULT_UNAVAILABLE"); }
        if (verified.message_binding !== "BOUND" || verified.model_echo !== "MATCHED" || verified.ready_videos.length !== 1) continue;
        const video = verified.ready_videos[0]!;
        if (video.object_type !== "video" || video.mime_type !== "video/mp4" || video.message_object_id !== context.message_object_ids[0]) continue;
        results.push(this.#issueOrReuse(request.attemptId, principal, client, context, video.message_object_id, context.model_id));
      }
      deadline.throwIfAborted(); await this.#assertPrincipal(request.attemptId, principal);
      return Object.freeze({ page: page.page, page_size: PAGE_SIZE, total_count: page.total_count, total_pages: page.total_pages,
        has_next: page.has_next, has_previous: page.has_previous, results: Object.freeze(results) });
    } finally { deadline.close(); }
  }

  async #get(request: Readonly<{ attemptId: string; resultHandle: string }>, parent: AbortSignal): Promise<OwnerTopazAstraExistingMediaArtifact> {
    const deadline = new AbsoluteRequestDeadline(this.#timeoutMs, parent, () => fail("REQUEST_ABORTED"));
    try {
      const principal = await this.#await(deadline, () => this.#principal(request.attemptId)), state = this.#handles.get(request.resultHandle);
      if (!state || state.attemptId !== request.attemptId || !sameGenerationPrincipal(state.principal, principal)) fail("RESULT_HANDLE_EXPIRED");
      if (this.#readNow() - state.issuedAt >= HANDLE_TTL_MS) { this.#removeHandle(request.resultHandle, state); fail("RESULT_HANDLE_EXPIRED"); }
      const client = this.#resolveNativeClient(request.attemptId); if (client !== state.client) fail("RESULT_UNAVAILABLE");
      let verified: OwnerTopazAstraResult;
      try {
        verified = await this.#await(deadline, () => Reflect.apply(RESULT, client, [state.context, deadline.signal]) as Promise<OwnerTopazAstraResult>);
        await this.#await(deadline, () => this.#assertPrincipal(request.attemptId, principal));
      } catch { deadline.throwIfAborted(); return fail("RESULT_UNAVAILABLE"); }
      deadline.throwIfAborted();
      if (this.#closed || this.#invalidating.has(request.attemptId) || this.#handles.get(request.resultHandle) !== state ||
          this.#readNow() - state.issuedAt >= HANDLE_TTL_MS) fail("RESULT_HANDLE_EXPIRED");
      if (!validResult(state.context, verified)) fail("RESULT_UNAVAILABLE");
      const video = verified.ready_videos[0]!;
      return Object.freeze({ model_id: state.context.model_id, object_url: video.object_url, mime_type: "video/mp4",
        output_identity: "UNHASHED_URL_REFERENCE", proof: PROOF });
    } finally { deadline.close(); }
  }

  #issueOrReuse(attemptId: string, principal: Readonly<GenerationPrincipalRef>, client: SyntxChatHttpClient,
    context: OwnerTopazAstraExistingResultContext, objectId: string, modelId: OwnerTopazAstraExistingResultContext["model_id"]): OwnerTopazAstraExistingMediaListItem {
    const key = JSON.stringify([attemptId, principal.tenant_id, principal.subject_id, context.chat_uuid, context.message_id, objectId, modelId]);
    const priorHandle = this.#handleByObject.get(key), prior = priorHandle ? this.#handles.get(priorHandle) : undefined, now = this.#readNow();
    if (priorHandle && prior && prior.client === client && now - prior.issuedAt < HANDLE_TTL_MS) return listItem(priorHandle, prior.issuedAt, now, modelId);
    if (priorHandle) this.#removeHandle(priorHandle, prior); this.#purgeExpired(now);
    if (this.#handles.size >= MAX_HANDLES) fail("CAPACITY_EXCEEDED");
    const handle = `existing_topaz_astra_${randomUUID()}`, state = Object.freeze({ attemptId, principal, client, context, objectKey: key, issuedAt: now });
    this.#handles.set(handle, state); this.#handleByObject.set(key, handle); return listItem(handle, now, now, modelId);
  }
  #resolveNativeClient(attemptId: string): SyntxChatHttpClient {
    if (this.#invalidating.has(attemptId)) fail("PRINCIPAL_NOT_LINKED");
    let value: unknown; try { value = Reflect.apply(this.#resolveChatClient, undefined, [attemptId]); } catch { fail("INDEX_UNAVAILABLE"); }
    if (!isNativeClient(value)) fail("INDEX_UNAVAILABLE"); return value;
  }
  async #principal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    try {
      const principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#links });
      if (principal.connection_id !== attemptId || principal.tenant_id !== this.#binding.tenant_id || principal.subject_id !== this.#binding.subject ||
          this.#invalidating.has(attemptId)) fail("PRINCIPAL_NOT_LINKED"); return principal;
    } catch { fail("PRINCIPAL_NOT_LINKED"); }
  }
  async #assertPrincipal(attemptId: string, expected: Readonly<GenerationPrincipalRef>): Promise<void> {
    if (!sameGenerationPrincipal(await this.#principal(attemptId), expected)) fail("PRINCIPAL_NOT_LINKED");
  }
  #readNow(): number { let now: number; try { now = this.#now(); } catch { fail("SERVICE_BUSY"); }
    if (!Number.isSafeInteger(now) || now < 0) fail("SERVICE_BUSY"); return now; }
  #purgeExpired(now: number): void { for (const [handle, state] of this.#handles) if (now - state.issuedAt >= HANDLE_TTL_MS) this.#removeHandle(handle, state); }
  #removeHandle(handle: string, state: HandleState | undefined): void {
    this.#handles.delete(handle); if (state && this.#handleByObject.get(state.objectKey) === handle) this.#handleByObject.delete(state.objectKey);
  }
  #dropAttempt(attemptId: string): void { for (const [handle, state] of this.#handles) if (state.attemptId === attemptId) this.#removeHandle(handle, state); }
  async #await<T>(deadline: AbsoluteRequestDeadline, operation: () => Promise<T>): Promise<T> {
    deadline.throwIfAborted(); try { return await deadline.waitFor(operation()); } catch (error) { deadline.throwIfAborted(); throw error; }
  }
  async #run<T>(attemptId: string, parent: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.#closed || !SERVICES.has(this)) fail("SERVICE_CLOSED");
    if (this.#invalidating.has(attemptId) || this.#runs.size >= MAX_RUNS || this.#activeAttempts.has(attemptId)) fail("SERVICE_BUSY");
    if (parent !== undefined && (types.isProxy(parent) || !(parent instanceof AbortSignal))) invalid();
    const controller = new AbortController(), abortParent = () => controller.abort(parent?.reason);
    if (parent?.aborted) abortParent(); else parent?.addEventListener("abort", abortParent, { once: true });
    const run: ActiveRun = { attemptId, controller, promise: Promise.resolve() }, promise = Promise.resolve().then(() => operation(controller.signal));
    run.promise = promise; this.#runs.add(run); this.#activeAttempts.add(attemptId);
    try { return await promise; } finally { parent?.removeEventListener("abort", abortParent); this.#runs.delete(run); this.#activeAttempts.delete(attemptId); }
  }
}

const SERVICE_METHODS = Object.freeze({ listExistingResults: OwnerTopazAstraExistingMediaService.prototype.listExistingResults,
  getExistingResult: OwnerTopazAstraExistingMediaService.prototype.getExistingResult, invalidateAttempt: OwnerTopazAstraExistingMediaService.prototype.invalidateAttempt,
  close: OwnerTopazAstraExistingMediaService.prototype.close });
export function isOwnerTopazAstraExistingMediaService(value: unknown): value is OwnerTopazAstraExistingMediaService {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) &&
    Object.getPrototypeOf(value) === OwnerTopazAstraExistingMediaService.prototype && Object.entries(SERVICE_METHODS).every(([key, method]) => Reflect.get(value, key) === method); }
  catch { return false; }
}
function listItem(handle: string, issuedAt: number, now: number, modelId: OwnerTopazAstraExistingResultContext["model_id"]): OwnerTopazAstraExistingMediaListItem {
  return Object.freeze({ result_handle: handle, expires_in_seconds: Math.max(1, Math.ceil((issuedAt + HANDLE_TTL_MS - now) / 1_000)),
    model_id: modelId, proof: PROOF });
}
function validPage(page: OwnerTopazAstraExistingChatPage, requested: number): boolean {
  if (!page || page.page !== requested || page.page_size !== PAGE_SIZE || !Array.isArray(page.chats) || page.chats.length > PAGE_SIZE ||
      !Number.isSafeInteger(page.total_count) || page.total_count < 0) return false;
  const pages = page.total_count === 0 ? 0 : Math.ceil(page.total_count / PAGE_SIZE), rows = Math.min(PAGE_SIZE, Math.max(0, page.total_count - (requested - 1) * PAGE_SIZE));
  return page.total_pages === pages && page.has_previous === (requested > 1) && page.has_next === (requested < pages) && page.chats.length <= rows &&
    (pages === 0 || requested <= pages);
}
function validChat(value: OwnerTopazAstraExistingChatContext, attempt: string, principal: Readonly<GenerationPrincipalRef>): boolean {
  return !!value && value.source_kind === "EXISTING_OWNER_TOPAZ_ASTRA_CHAT" && value.attempt_id === attempt && sameGenerationPrincipal(value.principal, principal);
}
function validResultContext(value: OwnerTopazAstraExistingResultContext, attempt: string, principal: Readonly<GenerationPrincipalRef>): boolean {
  return !!value && value.source_kind === "EXISTING_OWNER_TOPAZ_ASTRA_RESULT" && MODELS.has(value.model_id) && value.attempt_id === attempt &&
    value.provenance === "NOT_AVAILABLE" && sameGenerationPrincipal(value.principal, principal) && Array.isArray(value.message_object_ids) && value.message_object_ids.length === 1;
}
function validResult(context: OwnerTopazAstraExistingResultContext, result: OwnerTopazAstraResult): boolean {
  try { const video = result.ready_videos[0]!, url = new URL(video.object_url);
    return result.message_binding === "BOUND" && result.model_echo === "MATCHED" && result.ready_videos.length === 1 &&
      video.object_type === "video" && video.object_index >= 0 && video.mime_type === "video/mp4" &&
      video.message_object_id === context.message_object_ids[0] && url.protocol === "https:" && url.hostname === "r2.syntx.ai" &&
      !url.port && !url.username && !url.password && !url.hash && url.pathname.toLowerCase().endsWith(".mp4") && MODELS.has(context.model_id);
  } catch { return false; }
}
function isNativeClient(value: unknown): value is SyntxChatHttpClient {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === SyntxChatHttpClient.prototype &&
    Reflect.get(value, "listOwnedTopazAstraExistingChats") === INDEX && Reflect.get(value, "listOwnedTopazAstraExistingCandidates") === HISTORY &&
    Reflect.get(value, "getOwnedTopazAstraExistingResult") === RESULT; } catch { return false; }
}
function genuineMethods(value: unknown, ctor: { prototype: object }, names: readonly string[]): boolean {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === ctor.prototype &&
    names.every((name) => !Object.hasOwn(value, name) && Reflect.get(value, name) === Reflect.get(ctor.prototype, name)); } catch { return false; }
}
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  let proto: object | null, descriptors: PropertyDescriptorMap;
  try { proto = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); } catch { return invalid(); }
  const keys = Reflect.ownKeys(descriptors), allowed = new Set([...required, ...optional]);
  if ((proto !== Object.prototype && proto !== null) || required.some((k) => !Object.hasOwn(descriptors, k)) ||
      keys.some((k) => typeof k !== "string" || !allowed.has(k) || !descriptors[k]!.enumerable || !("value" in descriptors[k]!))) invalid();
  const out = Object.create(null) as Record<string, unknown>; for (const key of keys as string[]) out[key] = descriptors[key]!.value; return out;
}
function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const b = exact(value, ["tenant_id", "subject"]);
  if (typeof b.tenant_id !== "string" || !b.tenant_id || b.tenant_id.length > 256 || typeof b.subject !== "string" || !b.subject || b.subject.length > 512) invalid();
  return Object.freeze({ tenant_id: b.tenant_id, subject: b.subject });
}
function snapshotListInput(value: unknown): Readonly<OwnerTopazAstraExistingMediaListInput> {
  const r = exact(value, ["attemptId", "page"]), attemptId = validateAttempt(r.attemptId);
  if (!Number.isSafeInteger(r.page) || (r.page as number) < 1 || (r.page as number) > MAX_PAGE) invalid();
  return Object.freeze({ attemptId, page: r.page as number });
}
function snapshotHandleInput(value: unknown): Readonly<{ attemptId: string; resultHandle: string }> {
  const r = exact(value, ["attemptId", "result_handle"]), attemptId = validateAttempt(r.attemptId);
  if (typeof r.result_handle !== "string" || !HANDLE.test(r.result_handle)) invalid(); return Object.freeze({ attemptId, resultHandle: r.result_handle });
}
function validateAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) invalid(); return value; }
function bounded(value: unknown, min: number, max: number, fallback: number): number {
  const n = value ?? fallback; if (!Number.isSafeInteger(n) || (n as number) < min || (n as number) > max) invalid(); return n as number;
}
function readClock(value: unknown): () => number { if (value === undefined) return Date.now;
  if (typeof value !== "function" || types.isProxy(value)) invalid(); return () => Reflect.apply(value as () => number, undefined, []); }
function invalid(): never { throw new OwnerTopazAstraExistingMediaServiceError("INVALID_REQUEST"); }
function fail(code: OwnerTopazAstraExistingMediaServiceErrorCode): never { throw new OwnerTopazAstraExistingMediaServiceError(code); }
