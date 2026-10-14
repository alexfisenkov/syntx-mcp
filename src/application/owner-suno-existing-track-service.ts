import { types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import {
  isOwnerSunoExistingTrackChatContext,
  isOwnerSunoExistingTrackResultMessageContext,
  SyntxChatHttpClient,
  type OwnerSunoExistingTrackChatPage,
  type OwnerSunoExistingTrackCandidates,
  type OwnerSunoExistingTrackResultMessageContext,
  type OwnerSunoExistingTrackVerifiedResult
} from "../adapter/syntx/chat-http-client.js";
import { OWNER_SUNO_EXISTING_INDEX_MAX_PAGE, OWNER_SUNO_EXISTING_INDEX_PAGE_SIZE } from "../adapter/syntx/owner-suno-existing-track.js";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { OwnerSunoTrackContextStore, OwnerSunoTrackContextStoreError } from "./owner-suno-track-context.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_RUNS = 4;
const MAX_HANDLES_PER_PAGE = 128;
const NATIVE_INDEX = SyntxChatHttpClient.prototype.listOwnedSunoExistingTrackChats;
const NATIVE_HISTORY = SyntxChatHttpClient.prototype.listOwnedSunoExistingTrackCandidates;
const NATIVE_RESULT = SyntxChatHttpClient.prototype.getOwnedSunoExistingTrackResult;

export interface OwnerSunoExistingTrackServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly trackContextStore: OwnerSunoTrackContextStore;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

export interface OwnerSunoExistingTrackInputListInput {
  readonly attemptId: string;
  readonly page: number;
}

export interface OwnerSunoExistingTrackInput {
  readonly track_handle: string;
  readonly model_id: "V6" | "V6_wild";
  readonly expires_in_seconds: number;
  readonly artifact: Readonly<{ url: string; mime_type: "audio/mpeg" | "audio/wav" | "audio/mp4" | null }>;
}

export interface OwnerSunoExistingTrackInputList {
  readonly status: "AVAILABLE" | "UNAVAILABLE";
  readonly page: number;
  readonly page_size: typeof OWNER_SUNO_EXISTING_INDEX_PAGE_SIZE;
  readonly total_count: number;
  readonly total_pages: number;
  readonly has_next: boolean;
  readonly has_previous: boolean;
  readonly unavailable_reason?: "NO_TRACKS_AVAILABLE" | "TRACK_INPUT_CAPACITY_REACHED";
  readonly tracks: readonly OwnerSunoExistingTrackInput[];
}

export type OwnerSunoExistingTrackServiceErrorCode = "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" |
  "PRINCIPAL_NOT_LINKED" | "INDEX_UNAVAILABLE" | "HISTORY_UNAVAILABLE" | "RESULT_UNAVAILABLE" |
  "TRACK_CONTEXT_UNAVAILABLE" | "CAPACITY_EXCEEDED" | "REQUEST_ABORTED";

export class OwnerSunoExistingTrackServiceError extends Error {
  constructor(readonly code: OwnerSunoExistingTrackServiceErrorCode) {
    super("The existing owner Suno tracks could not be listed safely.");
    this.name = "OwnerSunoExistingTrackServiceError";
  }
}

interface ActiveRun {
  readonly attemptId: string;
  readonly controller: AbortController;
  promise: Promise<unknown>;
}

interface ArtifactBinding {
  readonly object_index: number;
  readonly message_object_id: string;
  readonly object_url: string;
}

export class OwnerSunoExistingTrackService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: PerUserLinkService;
  readonly #trackContextStore: OwnerSunoTrackContextStore;
  readonly #resolveChatClient: OwnerSunoExistingTrackServiceOptions["resolveChatClient"];
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #handleByObject = new Map<string, string>();
  readonly #runs = new Set<ActiveRun>();
  readonly #activeAttempts = new Set<string>();
  readonly #invalidatingAttempts = new Set<string>();
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(optionsInput: OwnerSunoExistingTrackServiceOptions | unknown) {
    if (new.target !== OwnerSunoExistingTrackService) invalid();
    const options = exactRecord(optionsInput, ["binding", "linkService", "trackContextStore", "resolveChatClient"], ["now", "timeoutMs"]);
    this.#binding = snapshotBinding(options.binding);
    if (!isExactService(options.linkService, PerUserLinkService, ["getStatus"]) ||
        !isExactService(options.trackContextStore, OwnerSunoTrackContextStore, ["issue", "issueExistingOwnerTrack", "resolve", "invalidateAttempt", "close"]) ||
        typeof options.resolveChatClient !== "function" || types.isProxy(options.resolveChatClient) ||
        (options.now !== undefined && (typeof options.now !== "function" || types.isProxy(options.now)))) invalid();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 5 * 60_000) invalid();
    this.#linkService = options.linkService as PerUserLinkService;
    this.#trackContextStore = options.trackContextStore as OwnerSunoTrackContextStore;
    this.#resolveChatClient = options.resolveChatClient as OwnerSunoExistingTrackServiceOptions["resolveChatClient"];
    this.#now = options.now === undefined ? Date.now : readClock(options.now);
    this.#timeoutMs = timeoutMs as number;
    Object.freeze(this);
  }

  async listExistingTracks(input: OwnerSunoExistingTrackInputListInput | unknown,
    signal?: AbortSignal): Promise<OwnerSunoExistingTrackInputList> {
    const request = snapshotListInput(input);
    return await this.#run(request.attemptId, signal, (runSignal) => this.#list(request, runSignal));
  }

  async invalidateAttempt(attemptIdInput: unknown): Promise<void> {
    const attemptId = validateAttempt(attemptIdInput);
    this.#invalidatingAttempts.add(attemptId);
    for (const run of this.#runs) if (run.attemptId === attemptId) run.controller.abort();
    const pending = [...this.#runs].filter((run) => run.attemptId === attemptId).map((run) => run.promise);
    await Promise.allSettled(pending);
    this.#dropHandles(attemptId);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const run of this.#runs) run.controller.abort();
    this.#closing = (async () => {
      await Promise.allSettled([...this.#runs].map((run) => run.promise));
      this.#handleByObject.clear();
    })();
    return this.#closing;
  }

  async #list(request: Readonly<OwnerSunoExistingTrackInputListInput>, signal: AbortSignal): Promise<OwnerSunoExistingTrackInputList> {
    const deadline = new AbsoluteRequestDeadline(this.#timeoutMs, signal, () => serviceError("REQUEST_ABORTED"));
    try {
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      const client = this.#resolveNativeClient(request.attemptId);
      let page: OwnerSunoExistingTrackChatPage;
      try {
        page = await this.#await(deadline, () => Reflect.apply(NATIVE_INDEX, client, [
          { attemptId: request.attemptId, principal, page: request.page }, deadline.signal
        ]) as Promise<OwnerSunoExistingTrackChatPage>);
      } catch { deadline.throwIfAborted(); return fail("INDEX_UNAVAILABLE"); }
      if (page.page !== request.page || page.page_size !== OWNER_SUNO_EXISTING_INDEX_PAGE_SIZE ||
          !Array.isArray(page.chats) || page.chats.length > OWNER_SUNO_EXISTING_INDEX_PAGE_SIZE ||
          page.total_count < 0 || page.total_pages < 0) fail("INDEX_UNAVAILABLE");

      const tracks: OwnerSunoExistingTrackInput[] = [];
      for (const chat of page.chats) {
        deadline.throwIfAborted();
        if (this.#invalidatingAttempts.has(request.attemptId) ||
            !isOwnerSunoExistingTrackChatContext(chat, client) || chat.attempt_id !== request.attemptId ||
            !sameGenerationPrincipal(chat.principal, principal)) fail("PRINCIPAL_NOT_LINKED");
        let candidates: OwnerSunoExistingTrackCandidates;
        try {
          candidates = await this.#await(deadline, () => Reflect.apply(NATIVE_HISTORY, client, [chat, deadline.signal]) as Promise<OwnerSunoExistingTrackCandidates>);
        } catch { deadline.throwIfAborted(); return fail("HISTORY_UNAVAILABLE"); }
        if (candidates.status !== "COMPLETE" || candidates.owner_ack_status !== "MATCHED") continue;
        for (const context of candidates.contexts) {
          deadline.throwIfAborted();
          if (!isOwnerSunoExistingTrackResultMessageContext(context, client) || context.attempt_id !== request.attemptId ||
              !sameGenerationPrincipal(context.principal, principal)) fail("PRINCIPAL_NOT_LINKED");
          let verified: OwnerSunoExistingTrackVerifiedResult;
          try {
            verified = await this.#await(deadline, () => Reflect.apply(NATIVE_RESULT, client, [context, deadline.signal]) as Promise<OwnerSunoExistingTrackVerifiedResult>);
          } catch { deadline.throwIfAborted(); return fail("RESULT_UNAVAILABLE"); }
          if (verified.audio_result.message_binding !== "BOUND" || verified.audio_result.model_echo !== "MATCHED") continue;
          const ready = new Map(verified.audio_result.ready_audio.map((entry) => [entry.message_object_id, entry]));
          const artifacts = new Map<string, ArtifactBinding>();
          for (const item of verified.artifacts) {
            const resultObject = ready.get(item.message_object_id);
            if (!resultObject || item.object_url !== resultObject.object_url || item.model_id !== context.model_id ||
                item.object_index !== resultObject.object_index || artifacts.has(item.message_object_id)) continue;
            artifacts.set(item.message_object_id, Object.freeze({ object_index: item.object_index,
              message_object_id: item.message_object_id, object_url: item.object_url }));
          }
          for (const objectId of context.message_object_ids) {
            const artifact = artifacts.get(objectId);
            if (!artifact) continue;
            if (tracks.length >= MAX_HANDLES_PER_PAGE) return trackPage(page, tracks, "TRACK_INPUT_CAPACITY_REACHED");
            try {
              tracks.push(this.#issueOrReuse({ attemptId: request.attemptId, principal, client, context,
                objectId, artifact }));
            } catch (error) {
              if (error instanceof OwnerSunoTrackContextStoreError && error.code === "CAPACITY_EXCEEDED") {
                return trackPage(page, tracks, "TRACK_INPUT_CAPACITY_REACHED");
              }
              if (error instanceof OwnerSunoTrackContextStoreError && error.code === "TRACK_CONTEXT_UNAVAILABLE") return fail("TRACK_CONTEXT_UNAVAILABLE");
              if (error instanceof OwnerSunoTrackContextStoreError && error.code === "TRACK_CONTEXT_EXPIRED") return fail("TRACK_CONTEXT_UNAVAILABLE");
              return fail(error instanceof OwnerSunoTrackContextStoreError && error.code === "SERVICE_CLOSED" ? "SERVICE_CLOSED" : "SERVICE_BUSY");
            }
          }
        }
      }
      if (this.#invalidatingAttempts.has(request.attemptId)) fail("PRINCIPAL_NOT_LINKED");
      return trackPage(page, tracks);
    } finally { deadline.close(); }
  }

  #issueOrReuse(input: Readonly<{ attemptId: string; principal: Readonly<GenerationPrincipalRef>; client: SyntxChatHttpClient;
    context: OwnerSunoExistingTrackResultMessageContext; objectId: string; artifact: ArtifactBinding }>): OwnerSunoExistingTrackInput {
    const key = JSON.stringify([input.attemptId, input.context.chat_uuid, input.context.message_id, input.objectId]);
    let handle = this.#handleByObject.get(key);
    if (handle) {
      try {
        const projection = this.#trackContextStore.resolve({ binding: this.#binding, attemptId: input.attemptId,
          principal: input.principal, trackHandle: handle });
        if (projection.source_kind === "EXISTING_OWNER_TRACK" && projection.message_object_id === input.objectId &&
            projection.artifact?.url === input.artifact.object_url) return toTrackInput(projection, this.#readNow());
      } catch { /* expired or invalidated; issue a fresh, short-lived handle from the same native brand */ }
      this.#handleByObject.delete(key);
      handle = undefined;
    }
    handle = this.#trackContextStore.issueExistingOwnerTrack({ binding: this.#binding, attemptId: input.attemptId,
      principal: input.principal, client: input.client, resultContext: input.context, messageObjectId: input.objectId });
    this.#handleByObject.set(key, handle);
    const projection = this.#trackContextStore.resolve({ binding: this.#binding, attemptId: input.attemptId,
      principal: input.principal, trackHandle: handle });
    if (projection.source_kind !== "EXISTING_OWNER_TRACK" || projection.artifact?.url !== input.artifact.object_url) {
      this.#handleByObject.delete(key);
      return fail("TRACK_CONTEXT_UNAVAILABLE");
    }
    return toTrackInput(projection, this.#readNow());
  }

  #dropHandles(attemptId: string): void {
    const prefix = `["${attemptId}",`;
    for (const key of this.#handleByObject.keys()) if (key.startsWith(prefix)) this.#handleByObject.delete(key);
  }

  #resolveNativeClient(attemptId: string): SyntxChatHttpClient {
    if (this.#invalidatingAttempts.has(attemptId)) fail("PRINCIPAL_NOT_LINKED");
    let client: unknown;
    try { client = Reflect.apply(this.#resolveChatClient, undefined, [attemptId]); } catch { fail("INDEX_UNAVAILABLE"); }
    if (!isNativeClient(client)) fail("INDEX_UNAVAILABLE");
    return client;
  }

  async #resolvePrincipal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    try {
      const principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
      if (principal.connection_id !== attemptId || principal.tenant_id !== this.#binding.tenant_id ||
          principal.subject_id !== this.#binding.subject || this.#invalidatingAttempts.has(attemptId)) fail("PRINCIPAL_NOT_LINKED");
      return principal;
    } catch { fail("PRINCIPAL_NOT_LINKED"); }
  }

  #readNow(): number {
    let now: number;
    try { now = this.#now(); } catch { return fail("SERVICE_BUSY"); }
    if (!Number.isSafeInteger(now) || now < 0) fail("SERVICE_BUSY");
    return now;
  }

  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }

  async #await<T>(deadline: AbsoluteRequestDeadline, operation: () => Promise<T>): Promise<T> {
    deadline.throwIfAborted();
    try { return await deadline.waitFor(operation()); }
    catch (error) { deadline.throwIfAborted(); throw error; }
  }

  async #run<T>(attemptId: string, parent: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.#assertOpen();
    if (this.#invalidatingAttempts.has(attemptId)) fail("PRINCIPAL_NOT_LINKED");
    if (this.#runs.size >= MAX_RUNS || this.#activeAttempts.has(attemptId)) fail("SERVICE_BUSY");
    if (parent !== undefined && (types.isProxy(parent) || !(parent instanceof AbortSignal))) invalid();
    const controller = new AbortController();
    const abortParent = () => controller.abort(parent?.reason);
    if (parent?.aborted) abortParent(); else parent?.addEventListener("abort", abortParent, { once: true });
    const run: ActiveRun = { attemptId, controller, promise: Promise.resolve() };
    const promise = operation(controller.signal);
    run.promise = promise;
    this.#runs.add(run);
    this.#activeAttempts.add(attemptId);
    try { return await promise; }
    finally {
      parent?.removeEventListener("abort", abortParent);
      this.#runs.delete(run);
      this.#activeAttempts.delete(attemptId);
    }
  }
}

function toTrackInput(projection: ReturnType<OwnerSunoTrackContextStore["resolve"]>, now: number): OwnerSunoExistingTrackInput {
  if (projection.source_kind !== "EXISTING_OWNER_TRACK" || !projection.artifact) return fail("TRACK_CONTEXT_UNAVAILABLE");
  const expiresIn = Math.max(1, Math.min(1_800, Math.floor((projection.expires_at - now) / 1_000)));
  return Object.freeze({ track_handle: projection.track_handle, model_id: projection.model_id,
    expires_in_seconds: expiresIn, artifact: Object.freeze({ ...projection.artifact }) });
}

function trackPage(page: OwnerSunoExistingTrackChatPage, tracks: readonly OwnerSunoExistingTrackInput[],
  capacityLimited: false | "TRACK_INPUT_CAPACITY_REACHED" = false): OwnerSunoExistingTrackInputList {
  return Object.freeze({ status: tracks.length > 0 ? "AVAILABLE" : "UNAVAILABLE",
    page: page.page, page_size: page.page_size, total_count: page.total_count, total_pages: page.total_pages,
    has_next: page.has_next, has_previous: page.has_previous,
    ...(capacityLimited === "TRACK_INPUT_CAPACITY_REACHED" ? { unavailable_reason: "TRACK_INPUT_CAPACITY_REACHED" as const }
      : tracks.length === 0 ? { unavailable_reason: "NO_TRACKS_AVAILABLE" as const } : {}),
    tracks: Object.freeze([...tracks]) });
}

function snapshotListInput(value: unknown): Readonly<OwnerSunoExistingTrackInputListInput> {
  const fields = exactRecord(value, ["attemptId", "page"]);
  const attemptId = validateAttempt(fields.attemptId);
  if (!Number.isSafeInteger(fields.page) || (fields.page as number) < 1 ||
      (fields.page as number) > OWNER_SUNO_EXISTING_INDEX_MAX_PAGE) invalid();
  return Object.freeze({ attemptId, page: fields.page as number });
}

function isNativeClient(value: unknown): value is SyntxChatHttpClient {
  try {
    return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === SyntxChatHttpClient.prototype &&
      Reflect.get(value, "listOwnedSunoExistingTrackChats") === NATIVE_INDEX &&
      Reflect.get(value, "listOwnedSunoExistingTrackCandidates") === NATIVE_HISTORY &&
      Reflect.get(value, "getOwnedSunoExistingTrackResult") === NATIVE_RESULT;
  } catch { return false; }
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); }
  catch { return invalid(); }
  const keys = Reflect.ownKeys(descriptors), allowed = [...required, ...optional];
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!) ||
        descriptors[key]!.enumerable !== true)) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || fields.tenant_id.length === 0 || fields.tenant_id.length > 256 ||
      typeof fields.subject !== "string" || fields.subject.length === 0 || fields.subject.length > 512) invalid();
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}

function validateAttempt(value: unknown): string {
  if (typeof value !== "string" || !ATTEMPT.test(value)) invalid();
  return value;
}

function isExactInstance<T extends object>(value: unknown, constructor: new (...args: never[]) => T): value is T {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === constructor.prototype; }
  catch { return false; }
}

function isExactService<T extends object>(value: unknown, constructor: new (...args: never[]) => T, methods: readonly string[]): value is T {
  return isExactInstance(value, constructor) && methods.every((method) =>
    typeof Reflect.get(constructor.prototype, method) === "function" && !Object.hasOwn(value, method) &&
    Reflect.get(value, method) === Reflect.get(constructor.prototype, method));
}

function readClock(value: unknown): () => number {
  if (typeof value !== "function" || types.isProxy(value)) invalid();
  return () => Reflect.apply(value as () => number, undefined, []);
}

function invalid(): never { throw serviceError("INVALID_REQUEST"); }
function fail(code: OwnerSunoExistingTrackServiceErrorCode): never { throw serviceError(code); }
function serviceError(code: OwnerSunoExistingTrackServiceErrorCode): OwnerSunoExistingTrackServiceError {
  return new OwnerSunoExistingTrackServiceError(code);
}
