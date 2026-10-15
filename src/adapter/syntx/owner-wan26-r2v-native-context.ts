import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { z } from "zod/v4";
import type { AuthBinding } from "../../auth/types.js";
import { PerUserLinkService } from "../../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../../domain/generation-principal.js";
import { schemaHash } from "../../domain/generation-contract.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";
import { SyntxChatHttpClient, type MediaGenerationReceipt } from "./chat-http-client.js";
import { SyntxHttpError, type SyntxHttpErrorCode } from "./http-client.js";
import { readOwnerWan26R2vUploadReferenceForClient, type OwnerWan26R2vImageUploadContext } from "./wan26-r2v-upload-context.js";
import { readOwnerWan26R2vVideoUploadReferenceForClient, type OwnerWan26R2vSelectedVideoUploadContext } from "./wan26-r2v-video-upload-context.js";
import { consumeOwnerWan26R2vOneShotPermit, revalidateOwnerWan26R2vOneShotPermit,
  OwnerWan26R2vOneShotPolicyError, type OwnerWan26R2vOneShotPermit } from "../../application/owner-wan26-r2v-one-shot-policy.js";
import { isOwnerWan26R2vPreparedCandidate, isOwnerWan26R2vRequestPreparer, type OwnerWan26R2vPreparedCandidate,
  type OwnerWan26R2vPreparedCandidateBinding, type OwnerWan26R2vPreparedRequest,
  type OwnerWan26R2vRequestPreparer, OwnerWan26R2vRequestPreparerError } from "../../application/owner-wan26-r2v-request-preparer.js";
import { OwnerWan26R2vReferenceService, type OwnerWan26R2vReferenceService as ReferenceService,
  OwnerWan26R2vReferenceServiceError } from "../../application/owner-wan26-r2v-reference-service.js";
import { bindOwnerWan26R2vHistory, type OwnerWan26R2vHistoryWitness } from "./owner-wan26-r2v-history.js";
import { decodeOwnerWan26R2vVideoResult, type OwnerWan26R2vVideoResult } from "./owner-wan26-r2v-video-result.js";
import { projectOwnerWanI2vHistoryPageEvidence, projectOwnerWanI2vResultEnvelopeEvidence } from "./wan-i2v-wire-evidence.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const PAGE_SIZE = 10;
const PAGE_LIMIT = 7;
const MAX_CHAT_STATES = 128;
const SAFE_START_ERROR_CLASSES = new Set<SyntxHttpErrorCode>([
  "INVALID_REQUEST", "AUTH_REQUIRED", "AUTH_OR_ACCESS_DENIED", "UPSTREAM_RATE_LIMITED",
  "UPSTREAM_UNAVAILABLE", "UPSTREAM_TIMEOUT", "UPSTREAM_REQUEST_ABORTED", "UPSTREAM_PROTOCOL_ERROR"
]);
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const LINK_GET_STATUS = PerUserLinkService.prototype.getStatus;
const RESOLVE = OwnerWan26R2vReferenceService.prototype.resolveManifest;
const CAPTURE = OwnerWan26R2vReferenceService.prototype.withCapturedNativeReferences;
const REFERENCE_INVALIDATE = OwnerWan26R2vReferenceService.prototype.invalidateAttempt;
const REFERENCE_CLOSE = OwnerWan26R2vReferenceService.prototype.close;
const NATIVE_CLIENT_CREATE = SyntxChatHttpClient.prototype.createOwnerWan26R2vChat;
const NATIVE_CLIENT_START = SyntxChatHttpClient.prototype.startOwnerWan26R2vWithOwnedCandidate;
const NATIVE_CLIENT_LIST = SyntxChatHttpClient.prototype.listOwnedWan26R2vCandidates;
const NATIVE_CLIENT_GET = SyntxChatHttpClient.prototype.getOwnedWan26R2vResult;
const clientStores = new WeakMap<object, ClientStore>();
const chatStates = new WeakMap<object, State>();
const resultContexts = new WeakMap<object, ResultState>();
const pendingCandidates = new WeakSet<object>();
const createdCandidates = new WeakSet<object>();
const pendingStarts = new WeakSet<object>();

interface ClientStore {
  readonly chats: Map<string, State>;
  readonly attemptEpochs: Map<string, number>;
  readonly pendingByAttempt: Map<string, number>;
  pendingCreates: number;
  closed: boolean;
}

export interface OwnerWan26R2vNativeOperationInput {
  readonly preparer: OwnerWan26R2vRequestPreparer; readonly candidate: OwnerWan26R2vPreparedCandidate;
  readonly permit: OwnerWan26R2vOneShotPermit; readonly referenceService: ReferenceService;
  readonly principal: GenerationPrincipalRef; readonly attemptId: string; readonly linkService: PerUserLinkService;
  readonly binding: AuthBinding; readonly chat?: OwnerWan26R2vChatContext;
}
export interface OwnerWan26R2vChatContext {
  readonly status: "created"; readonly chat_uuid: string; readonly attempt_id: string;
  readonly model_id: "wan_26_r2v" | "wan_26_r2v_flash"; readonly profile_schema_hash: string;
  readonly request_fingerprint: string; readonly intent_fingerprint: string; readonly expires_at: number;
  readonly dispatch_allowed: false; readonly backend_acceptance: "UNPROVEN";
}
export interface OwnerWan26R2vResultContext {
  readonly chat_uuid: string; readonly message_id: string; readonly model_id: OwnerWan26R2vChatContext["model_id"];
  readonly provider_chat_id: string; readonly message_object_ids: readonly string[]; readonly attempt_id: string;
  readonly request_fingerprint: string; readonly intent_fingerprint: string; readonly owner_echo_message_id: string;
}
export interface OwnerWan26R2vResultCandidates extends OwnerWan26R2vHistoryWitness {
  readonly history_page_status: "NOT_READ" | "COMPLETE" | "INCOMPLETE" | "UNPROVEN";
  readonly history_get_calls: number; readonly total_count: number | null; readonly total_pages: number | null;
  readonly contexts: readonly OwnerWan26R2vResultContext[];
}
export interface OwnerWan26R2vNativeHistory extends OwnerWan26R2vHistoryWitness {
  readonly history_page_status: OwnerWan26R2vResultCandidates["history_page_status"];
  readonly history_get_calls: number; readonly total_count: number | null; readonly total_pages: number | null;
  readonly contexts: readonly OwnerWan26R2vResultContext[];
}
export type OwnerWan26R2vResult = OwnerWan26R2vVideoResult;
export type OwnerWan26R2vNativeErrorCode = "INVALID_REQUEST" | "CANDIDATE_INVALID" | "PRINCIPAL_NOT_LINKED" |
  "CHAT_CREATE_FAILED" | "CHAT_CONTEXT_INVALID" | "CHAT_ALREADY_CREATED" | "CHAT_NOT_DISPATCHED" |
  "CHAT_DISPATCH_ALREADY_STARTED" | "OUTCOME_UNKNOWN" | "HISTORY_UNAVAILABLE" | "RESULT_CONTEXT_INVALID" |
  "RESULT_GET_UNAVAILABLE" | "REQUEST_ABORTED" | "CAPACITY_EXCEEDED";
export class OwnerWan26R2vNativeError extends Error {
  readonly start_error_class: SyntxHttpErrorCode | null;
  constructor(readonly code: OwnerWan26R2vNativeErrorCode, startErrorClass: unknown = null) {
    super("The owner WAN 2.6 R2V native operation could not be completed safely.");
    this.name = "OwnerWan26R2vNativeError";
    this.start_error_class = canonicalStartErrorClass(startErrorClass);
    Object.defineProperty(this, "start_error_class", { writable: false, configurable: false });
  }
}
type Contexts = readonly (OwnerWan26R2vImageUploadContext | OwnerWan26R2vSelectedVideoUploadContext)[];
type Input = Readonly<OwnerWan26R2vNativeOperationInput & {
  principal: Readonly<GenerationPrincipalRef>;
  binding: Readonly<AuthBinding>;
  permit: OwnerWan26R2vOneShotPermit;
}>;
interface State { readonly client: SyntxChatHttpClient; readonly input: Input; readonly chat: OwnerWan26R2vChatContext;
  readonly contexts: Contexts; readonly request: OwnerWan26R2vPreparedRequest; readonly binding: Readonly<OwnerWan26R2vPreparedCandidateBinding>;
  readonly nativeEpoch: number; invalidated: boolean; phase: "AVAILABLE" | "OUTCOME_UNKNOWN" | "ACKNOWLEDGED";
  ownerEcho?: string; readonly results: Map<string, OwnerWan26R2vResultContext>; }
interface ResultState { readonly client: SyntxChatHttpClient; readonly state: State; readonly context: OwnerWan26R2vResultContext; }

export async function createOwnerWan26R2vChat(input: unknown, packet: unknown, signal?: AbortSignal): Promise<OwnerWan26R2vChatContext> {
  const { client, callback } = await consume(input, packet, "create");
  const create = callback as (title: string, signal?: AbortSignal) => Promise<{ chat_uuid: string }>;
  const fields = readInput(input, false);
  checkSignal(signal);
  if (isSignalAborted(signal)) fail("REQUEST_ABORTED");

  const store = getClientStore(client);
  assertStoreOpen(store);
  if (createdCandidates.has(fields.candidate) || pendingCandidates.has(fields.candidate)) fail("CHAT_ALREADY_CREATED");
  pruneExpiredChats(store);
  if (store.chats.size + store.pendingCreates >= MAX_CHAT_STATES) fail("CAPACITY_EXCEEDED");

  if (!store.attemptEpochs.has(fields.attemptId)) store.attemptEpochs.set(fields.attemptId, 0);
  const nativeEpoch = attemptEpoch(store, fields.attemptId);
  store.pendingCreates += 1;
  store.pendingByAttempt.set(fields.attemptId, (store.pendingByAttempt.get(fields.attemptId) ?? 0) + 1);
  pendingCandidates.add(fields.candidate);
  try {
    assertAttemptEpoch(store, fields.attemptId, nativeEpoch);
    await assertCurrent(fields, signal);
    const binding = await validateCandidate(fields, signal);
    try {
      await revalidateOwnerWan26R2vOneShotPermit(permitInput(fields), signal);
    } catch {
      fail("CANDIDATE_INVALID");
    }

    const captured = await fields.preparer.withCapturedNativeReferences(fields.candidate, async (capturedClient, contexts, request) => {
      assertAttemptEpoch(store, fields.attemptId, nativeEpoch);
      if (capturedClient !== client) fail("CANDIDATE_INVALID");
      createdCandidates.add(fields.candidate);
      await assertCurrent(fields, signal);
      assertCaptured(capturedClient, fields.candidate, binding, contexts, request);

      const created = await create(`owner-wan26-r2v-${randomUUID()}`, signal);
      assertAttemptEpoch(store, fields.attemptId, nativeEpoch);
      if (isSignalAborted(signal) || !safeId(created?.chat_uuid) || store.chats.has(created.chat_uuid)) fail("CHAT_CREATE_FAILED");
      await assertCurrent(fields, signal);
      return { chat_uuid: created.chat_uuid, contexts: Object.freeze([...contexts]), request };
    }, signal);

    assertAttemptEpoch(store, fields.attemptId, nativeEpoch);
    await revalidateOwnerWan26R2vOneShotPermit(permitInput(fields), signal);
    await assertCurrent(fields, signal);
    const fresh = fields.preparer.inspectCandidate(fields.candidate);
    if (!fresh || !sameBinding(binding, fresh)) fail("CANDIDATE_INVALID");

    const chat: OwnerWan26R2vChatContext = Object.freeze({ status: "created", chat_uuid: captured.chat_uuid,
      attempt_id: fields.attemptId, model_id: fields.candidate.model_id, profile_schema_hash: binding.profile_schema_hash,
      request_fingerprint: binding.private_request_fingerprint, intent_fingerprint: binding.intent_fingerprint,
      expires_at: binding.expires_at, dispatch_allowed: false, backend_acceptance: "UNPROVEN" });
    const state: State = { client, input: fields, chat, contexts: captured.contexts, request: captured.request, binding,
      nativeEpoch, invalidated: false, phase: "AVAILABLE", results: new Map() };
    assertAttemptEpoch(store, fields.attemptId, nativeEpoch);
    store.chats.set(chat.chat_uuid, state);
    chatStates.set(chat, state);
    return chat;
  } catch (error) {
    throw translate(error, "CHAT_CREATE_FAILED");
  } finally {
    store.pendingCreates -= 1;
    const pendingForAttempt = (store.pendingByAttempt.get(fields.attemptId) ?? 1) - 1;
    if (pendingForAttempt > 0) store.pendingByAttempt.set(fields.attemptId, pendingForAttempt);
    else store.pendingByAttempt.delete(fields.attemptId);
    cleanupAttemptEpoch(store, fields.attemptId);
    pendingCandidates.delete(fields.candidate);
  }
}

export async function startOwnerWan26R2vWithOwnedCandidate(input: unknown, packet: unknown, signal?: AbortSignal): Promise<MediaGenerationReceipt> {
  const { client, callback } = await consume(input, packet, "start");
  const start = callback as (chatId: string, body: Record<string, unknown>, signal?: AbortSignal) => Promise<MediaGenerationReceipt>;
  const fields = readInput(input, true), state = stateFor(client, fields.chat!);
  if (state.phase === "OUTCOME_UNKNOWN") fail("OUTCOME_UNKNOWN");
  if (state.phase !== "AVAILABLE" || !sameOperation(state.input, fields)) fail("CHAT_CONTEXT_INVALID");
  if (pendingStarts.has(state.chat)) fail("CHAT_DISPATCH_ALREADY_STARTED");
  checkSignal(signal);
  if (isSignalAborted(signal)) fail("REQUEST_ABORTED");
  pendingStarts.add(state.chat); let enteredPost = false;
  try {
    const binding = await validateCandidate(fields, signal);
    await assertStateCurrent(state, signal);
    const result = await fields.preparer.withCapturedNativeReferences(fields.candidate, async (capturedClient, contexts, currentRequest) => {
      if (capturedClient !== client) fail("CANDIDATE_INVALID");
      await assertStateCurrent(state, signal);
      assertCaptured(client, fields.candidate, binding, contexts, currentRequest);
      await revalidateOwnerWan26R2vOneShotPermit(permitInput(fields), signal);
      await assertStateCurrent(state, signal);
      const consumed = consumeOwnerWan26R2vOneShotPermit(permitInput(fields));
      if (consumed.status !== "consumed" || consumed.dispatch_allowed !== false || consumed.backend_acceptance !== "UNPROVEN" ||
          consumed.request_fingerprint !== binding.private_request_fingerprint || consumed.request_fingerprint !== state.chat.request_fingerprint ||
          schemaHash(consumed.request) !== schemaHash(state.request)) fail("CANDIDATE_INVALID");
      const body = { chat_id: state.chat.chat_uuid, prompt: consumed.request.prompt, settings: consumed.request.settings };
      enteredPost = true; state.phase = "OUTCOME_UNKNOWN";
      const receipt = await start(state.chat.chat_uuid, body, signal);
      if (isSignalAborted(signal) || receipt.chat_uuid !== state.chat.chat_uuid || !safeId(receipt.message_id)) {
        fail("OUTCOME_UNKNOWN");
      }
      state.ownerEcho = receipt.message_id; state.phase = "ACKNOWLEDGED";
      await assertStateCurrent(state, signal);
      return receipt;
    }, signal);
    if (result.chat_uuid !== state.chat.chat_uuid || !state.ownerEcho || result.message_id !== state.ownerEcho) fail("OUTCOME_UNKNOWN");
    return result;
  } catch (error) {
    if (enteredPost || state.phase !== "AVAILABLE") {
      const startErrorClass = error instanceof OwnerWan26R2vNativeError
        ? error.start_error_class
        : readSyntxHttpErrorClass(error);
      throw new OwnerWan26R2vNativeError("OUTCOME_UNKNOWN", startErrorClass);
    }
    throw translate(error, "CANDIDATE_INVALID");
  }
  finally { pendingStarts.delete(state.chat); }
}

export async function listOwnerWan26R2vCandidates(input: unknown, packet: unknown, signal?: AbortSignal): Promise<OwnerWan26R2vResultCandidates> {
  const { client, callback } = await consume(input, packet, "list");
  const getPage = callback as (chatId: string, page: number, pageSize: number, signal?: AbortSignal) => Promise<unknown>;
  const state = stateFor(client, input);
  if (state.phase !== "ACKNOWLEDGED" && state.phase !== "OUTCOME_UNKNOWN") fail("CHAT_NOT_DISPATCHED");
  checkSignal(signal);
  if (isSignalAborted(signal)) fail("REQUEST_ABORTED");

  const pages: unknown[] = [];
  let calls = 0;
  let totalCount: number | null = null;
  let totalPages: number | null = null;
  try {
    for (let page = 1; page <= PAGE_LIMIT; page += 1) {
      await assertStateCurrent(state, signal);
      assertStateReferences(state);
      calls += 1;
      const raw = await getPage(state.chat.chat_uuid, page, PAGE_SIZE, signal);
      await assertStateCurrent(state, signal);
      assertStateReferences(state);

      const projection = projectOwnerWanI2vHistoryPageEvidence(raw);
      if (projection.status !== "PROJECTED") {
        return historyOutput(bindOwnerWan26R2vHistory({ pages: [...pages, raw], expected: expected(state) }),
          "UNPROVEN", calls, totalCount, totalPages);
      }
      const parsed = historyPage.safeParse(projection.value);
      if (!parsed.success) {
        return historyOutput(bindOwnerWan26R2vHistory({ pages: [...pages, projection.value], expected: expected(state) }),
          "UNPROVEN", calls, totalCount, totalPages);
      }

      const p = parsed.data.pagination;
      const pageCount = p.total_count === 0 ? 0 : Math.ceil(p.total_count / PAGE_SIZE);
      const expectedRows = Math.min(PAGE_SIZE, Math.max(0, p.total_count - (page - 1) * PAGE_SIZE));
      if (p.page !== page || p.page_size !== PAGE_SIZE || p.total_pages !== pageCount || p.has_previous !== (page > 1) ||
          p.has_next !== (page < pageCount) || parsed.data.messages.length !== expectedRows ||
          (totalCount !== null && (totalCount !== p.total_count || totalPages !== p.total_pages))) {
        return historyOutput(bindOwnerWan26R2vHistory({ pages: [...pages, projection.value], expected: expected(state) }),
          "INCOMPLETE", calls, totalCount, totalPages);
      }
      totalCount = p.total_count;
      totalPages = p.total_pages;
      pages.push(projection.value);
      if (page === pageCount || pageCount === 0) break;
    }
  } catch (error) {
    if (isSignalAborted(signal)) fail("REQUEST_ABORTED");
    if (error instanceof OwnerWan26R2vNativeError && error.code === "PRINCIPAL_NOT_LINKED") throw error;
    if (error instanceof OwnerWan26R2vNativeError && error.code === "CHAT_CONTEXT_INVALID") throw error;
    return historyOutput(bindOwnerWan26R2vHistory({ pages, expected: expected(state) }),
      "INCOMPLETE", calls, totalCount, totalPages);
  }

  const witness = bindOwnerWan26R2vHistory({ pages, expected: expected(state) });
  const completeBinding = witness.status === "COMPLETE" && witness.history_binding_status === "BOUND" &&
    witness.owner_ack_status === "MATCHED" && witness.owner_echo_message_id !== null &&
    witness.provider_chat_id !== null && witness.gaps.length === 0;
  if (completeBinding && witness.owner_echo_message_id && state.phase === "OUTCOME_UNKNOWN") {
    state.ownerEcho = witness.owner_echo_message_id;
    state.phase = "ACKNOWLEDGED";
  }

  const contexts: OwnerWan26R2vResultContext[] = [];
  if (completeBinding && witness.provider_chat_id && witness.owner_echo_message_id) {
    for (const candidate of witness.candidate_messages) {
      const context: OwnerWan26R2vResultContext = Object.freeze({ chat_uuid: state.chat.chat_uuid, message_id: candidate.message_id,
        model_id: state.chat.model_id, provider_chat_id: witness.provider_chat_id, message_object_ids: Object.freeze([...candidate.message_object_ids]),
        attempt_id: state.chat.attempt_id, request_fingerprint: state.chat.request_fingerprint,
        intent_fingerprint: state.chat.intent_fingerprint, owner_echo_message_id: witness.owner_echo_message_id });
      const previous = state.results.get(context.message_id);
      if (previous && schemaHash(previous) !== schemaHash(context)) {
        const mismatched = { ...witness, status: "UNVERIFIED" as const,
          gaps: Object.freeze([...witness.gaps, "HISTORY_INPUT_INVALID" as const]) };
        return historyOutput(mismatched, "UNPROVEN", calls, totalCount, totalPages);
      }
      if (!previous) { resultContexts.set(context, { client, state, context }); state.results.set(context.message_id, context); }
      contexts.push(previous ?? context);
    }
  }
  return Object.freeze({ ...witness, history_page_status: "COMPLETE", history_get_calls: calls, total_count: totalCount, total_pages: totalPages,
    contexts: Object.freeze(contexts) });
}

export async function getOwnerWan26R2vResult(input: unknown, packet: unknown, signal?: AbortSignal): Promise<OwnerWan26R2vResult> {
  const { client, callback } = await consume(input, packet, "get");
  const getMessage = callback as (chatId: string, messageId: string, signal?: AbortSignal) => Promise<unknown>;
  if (!input || typeof input !== "object" || types.isProxy(input)) fail("RESULT_CONTEXT_INVALID");
  const result = resultContexts.get(input as object);
  if (!result || result.client !== client || result.context !== input || result.state.phase !== "ACKNOWLEDGED" ||
      result.state.ownerEcho !== result.context.owner_echo_message_id ||
      clientStores.get(client)?.chats.get(result.state.chat.chat_uuid) !== result.state) fail("RESULT_CONTEXT_INVALID");
  checkSignal(signal);
  if (isSignalAborted(signal)) fail("REQUEST_ABORTED");

  try {
    await assertStateCurrent(result.state, signal);
    assertStateReferences(result.state);
    const raw = await getMessage(result.context.chat_uuid, result.context.message_id, signal);
    await assertStateCurrent(result.state, signal);
    assertStateReferences(result.state);
    const projection = projectOwnerWanI2vResultEnvelopeEvidence(raw);
    return decodeOwnerWan26R2vVideoResult(projection.status === "PROJECTED" ? projection.value : raw, {
      chat_uuid: result.context.chat_uuid,
      message_id: result.context.message_id,
      provider_chat_id: result.context.provider_chat_id,
      message_object_ids: result.context.message_object_ids,
      model_id: result.context.model_id
    });
  } catch (error) {
    if (isSignalAborted(signal)) fail("REQUEST_ABORTED");
    if (error instanceof OwnerWan26R2vNativeError && error.code === "PRINCIPAL_NOT_LINKED") throw error;
    if (error instanceof OwnerWan26R2vNativeError && error.code === "CHAT_CONTEXT_INVALID") throw error;
    fail("RESULT_GET_UNAVAILABLE");
  }
}

/** Invalidates this client's native contexts for one attempt without closing borrowed clients or auth services. */
export function invalidateOwnerWan26R2vNativeAttempt(clientInput: SyntxChatHttpClient, attemptId: string): void {
  const store = getClientStore(clientInput);
  if (typeof attemptId !== "string" || !ATTEMPT.test(attemptId)) fail("INVALID_REQUEST");
  if (store.closed) return;

  const hasState = [...store.chats.values()].some((state) => state.chat.attempt_id === attemptId);
  const hasPending = store.pendingByAttempt.has(attemptId);
  if (!hasState && !hasPending) return;
  store.attemptEpochs.set(attemptId, attemptEpoch(store, attemptId) + 1);
  for (const state of store.chats.values()) {
    if (state.chat.attempt_id === attemptId) invalidateState(store, state);
  }
  cleanupAttemptEpoch(store, attemptId);
}

/** Clears this client's native contexts; ownership of the HTTP client and link service stays with the caller. */
export function closeOwnerWan26R2vNativeContextsForClient(clientInput: SyntxChatHttpClient): void {
  const store = getClientStore(clientInput);
  if (store.closed) return;
  store.closed = true;

  for (const state of store.chats.values()) invalidateState(store, state);
  store.chats.clear();
  store.attemptEpochs.clear();
  store.pendingByAttempt.clear();
}

function readInput(value: unknown, withChat: boolean): Input {
  const required = ["preparer", "candidate", "permit", "referenceService", "principal", "attemptId", "linkService", "binding",
    ...(withChat ? ["chat"] : [])];
  const fields = exact(value, required);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || !isOwnerWan26R2vRequestPreparer(fields.preparer) ||
      !isOwnerWan26R2vPreparedCandidate(fields.candidate) || !isNativeReferenceService(fields.referenceService) || !isLinkService(fields.linkService) ||
      !fields.permit || typeof fields.permit !== "object" || types.isProxy(fields.permit)) fail("CANDIDATE_INVALID");
  const binding = snapshotBinding(fields.binding);
  const principal = snapshotPrincipal(fields.principal as GenerationPrincipalRef, fields.attemptId);
  const candidate = fields.candidate as OwnerWan26R2vPreparedCandidate;
  const permit = fields.permit as OwnerWan26R2vOneShotPermit;
  if (withChat && (!fields.chat || typeof fields.chat !== "object" || types.isProxy(fields.chat))) fail("INVALID_REQUEST");
  return Object.freeze({
    preparer: fields.preparer as OwnerWan26R2vRequestPreparer,
    candidate,
    referenceService: fields.referenceService as ReferenceService,
    principal,
    attemptId: fields.attemptId,
    linkService: fields.linkService as PerUserLinkService,
    binding,
    permit,
    ...(withChat ? { chat: fields.chat as OwnerWan26R2vChatContext } : {})
  }) as Input;
}
function permitInput(fields: Input): {
  preparer: OwnerWan26R2vRequestPreparer;
  candidate: OwnerWan26R2vPreparedCandidate;
  principal: Readonly<GenerationPrincipalRef>;
  attemptId: string;
  permit?: OwnerWan26R2vOneShotPermit;
} {
  return { preparer: fields.preparer, candidate: fields.candidate, principal: fields.principal, attemptId: fields.attemptId, permit: fields.permit };
}
async function validateCandidate(fields: Input, signal?: AbortSignal): Promise<Readonly<OwnerWan26R2vPreparedCandidateBinding>> {
  await assertCurrent(fields, signal);
  try {
    await fields.preparer.revalidateCandidate(fields.candidate, signal);
  } catch {
    fail("CANDIDATE_INVALID");
  }
  const binding = fields.preparer.inspectCandidate(fields.candidate);
  if (!binding) fail("CANDIDATE_INVALID");
  const request = fields.preparer.getPrivateRequest(fields.candidate);
  if (fields.candidate.status !== "prepared" || fields.candidate.dispatch_allowed !== false || fields.candidate.backend_acceptance !== "UNPROVEN" ||
      fields.candidate.model_id !== binding.model_id || fields.candidate.request_fingerprint !== binding.request_fingerprint ||
      fields.candidate.intent_fingerprint !== binding.intent_fingerprint || fields.candidate.profile_schema_hash !== binding.profile_schema_hash ||
      fields.candidate.expires_at !== binding.expires_at || binding.attempt_id !== fields.attemptId ||
      !sameGenerationPrincipal(binding.principal, fields.principal) ||
      schemaHash(request) !== binding.private_request_fingerprint || request.settings.model_type !== binding.model_id) fail("CANDIDATE_INVALID");
  await assertCurrent(fields, signal);
  return binding;
}
function assertCaptured(client: SyntxChatHttpClient, candidate: OwnerWan26R2vPreparedCandidate, binding: OwnerWan26R2vPreparedCandidateBinding,
  contexts: Contexts, request: OwnerWan26R2vPreparedRequest): void {
  if (contexts.length !== candidate.input_references.length || contexts.length < 1 || contexts.length > 5) fail("CANDIDATE_INVALID");
  const urls: { type: "image" | "video"; url: string }[] = [];
  for (let i = 0; i < contexts.length; i += 1) {
    const context = contexts[i]!;
    const metadata = candidate.input_references[i]!;
    if (context.status !== "uploaded" || context.model_id !== binding.model_id || context.media_type !== metadata.media_type ||
        context.mime_type !== metadata.mime_type || context.size !== metadata.size || context.sha256 !== metadata.sha256 ||
        context.width !== metadata.width || context.height !== metadata.height) fail("CANDIDATE_INVALID");
    if (context.media_type === "selected_video" &&
        (context.source_sha256 !== metadata.source_sha256 || context.selected_duration_seconds !== metadata.selected_duration_seconds ||
          context.video_duration_seconds !== metadata.video_duration_seconds)) fail("CANDIDATE_INVALID");
    const reference = context.media_type === "image"
      ? readOwnerWan26R2vUploadReferenceForClient(client, context)
      : readOwnerWan26R2vVideoUploadReferenceForClient(client, context);
    if (!reference || !isSafeUploadReferenceUrl(reference.url)) fail("CANDIDATE_INVALID");
    const type = context.media_type === "image" ? "image" : "video";
    if (!urls.some(item => item.type === type && item.url === reference.url)) urls.push({ type, url: reference.url });
  }
  if (binding.request_fingerprint !== candidate.request_fingerprint || schemaHash(request) !== binding.private_request_fingerprint ||
      schemaHash(urls) !== schemaHash(request.settings.file_urls)) fail("CANDIDATE_INVALID");
}
async function assertCurrent(fields: Input, signal?: AbortSignal): Promise<void> {
  checkSignal(signal);
  if (isSignalAborted(signal)) fail("REQUEST_ABORTED");

  try {
    const current = await resolveOwnerReferencePrincipal({ binding: fields.binding, attemptId: fields.attemptId, linkService: fields.linkService });
    if (!sameGenerationPrincipal(current, fields.principal)) fail("PRINCIPAL_NOT_LINKED");
    if (isSignalAborted(signal)) fail("REQUEST_ABORTED");
  } catch (error) {
    if (error instanceof OwnerWan26R2vNativeError) throw error;
    if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
    fail("PRINCIPAL_NOT_LINKED");
  }
}

async function assertStateCurrent(state: State, signal?: AbortSignal): Promise<void> {
  const store = clientStores.get(state.client);
  assertStateRegistered(state, store);
  await assertCurrent(state.input, signal);
  assertStateRegistered(state, store);
}

function assertStateRegistered(state: State, store: ClientStore | undefined): asserts store is ClientStore {
  if (!store || store.closed || state.invalidated || attemptEpoch(store, state.chat.attempt_id) !== state.nativeEpoch ||
      store.chats.get(state.chat.chat_uuid) !== state) fail("CHAT_CONTEXT_INVALID");
}

function assertStateReferences(state: State): void {
  assertCaptured(state.client, state.input.candidate, state.binding, state.contexts, state.request);
}

function stateFor(client: SyntxChatHttpClient, chat: unknown): State {
  if (!chat || typeof chat !== "object" || types.isProxy(chat)) fail("CHAT_CONTEXT_INVALID");
  const state = chatStates.get(chat as object);
  if (!state || state.client !== client || state.chat !== chat) fail("CHAT_CONTEXT_INVALID");
  assertStateRegistered(state, clientStores.get(client));
  return state;
}

function getClientStore(clientInput: unknown): ClientStore {
  assertNativeClient(clientInput);
  const client = clientInput;
  const existing = clientStores.get(client);
  if (existing) return existing;

  const store: ClientStore = { chats: new Map(), attemptEpochs: new Map(), pendingByAttempt: new Map(), pendingCreates: 0, closed: false };
  clientStores.set(client, store);
  return store;
}

function assertNativeClient(value: unknown): asserts value is SyntxChatHttpClient {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) ||
        Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype ||
        Object.hasOwn(value, "createOwnerWan26R2vChat") || Object.hasOwn(value, "startOwnerWan26R2vWithOwnedCandidate") ||
        Object.hasOwn(value, "listOwnedWan26R2vCandidates") || Object.hasOwn(value, "getOwnedWan26R2vResult") ||
        Reflect.get(value, "createOwnerWan26R2vChat") !== NATIVE_CLIENT_CREATE ||
        Reflect.get(value, "startOwnerWan26R2vWithOwnedCandidate") !== NATIVE_CLIENT_START ||
        Reflect.get(value, "listOwnedWan26R2vCandidates") !== NATIVE_CLIENT_LIST ||
        Reflect.get(value, "getOwnedWan26R2vResult") !== NATIVE_CLIENT_GET) fail("INVALID_REQUEST");
  } catch (error) {
    if (error instanceof OwnerWan26R2vNativeError) throw error;
    fail("INVALID_REQUEST");
  }
}

function attemptEpoch(store: ClientStore, attemptId: string): number {
  return store.attemptEpochs.get(attemptId) ?? 0;
}

function cleanupAttemptEpoch(store: ClientStore, attemptId: string): void {
  if (store.pendingByAttempt.has(attemptId)) return;
  for (const state of store.chats.values()) {
    if (state.chat.attempt_id === attemptId) return;
  }
  store.attemptEpochs.delete(attemptId);
}

function assertStoreOpen(store: ClientStore): void {
  if (store.closed) fail("CHAT_CONTEXT_INVALID");
}

function assertAttemptEpoch(store: ClientStore, attemptId: string, expectedEpoch: number): void {
  if (store.closed || attemptEpoch(store, attemptId) !== expectedEpoch) fail("CHAT_CONTEXT_INVALID");
}

function pruneExpiredChats(store: ClientStore): void {
  for (const [chatId, state] of store.chats) {
    if (state.phase !== "AVAILABLE" || isOwnerWan26R2vPreparedCandidate(state.input.candidate)) continue;
    invalidateState(store, state);
    store.chats.delete(chatId);
    cleanupAttemptEpoch(store, state.chat.attempt_id);
  }
}

function invalidateState(store: ClientStore, state: State): void {
  state.invalidated = true;
  chatStates.delete(state.chat);
  for (const context of state.results.values()) resultContexts.delete(context);
  state.results.clear();
  store.chats.delete(state.chat.chat_uuid);
}
function sameOperation(a: Input, b: Input): boolean {
  return a.candidate === b.candidate && a.preparer === b.preparer && a.referenceService === b.referenceService &&
    a.permit === b.permit && a.linkService === b.linkService && a.attemptId === b.attemptId &&
    sameGenerationPrincipal(a.principal, b.principal) && a.binding.tenant_id === b.binding.tenant_id &&
    a.binding.subject === b.binding.subject;
}

function sameBinding(a: OwnerWan26R2vPreparedCandidateBinding, b: OwnerWan26R2vPreparedCandidateBinding): boolean {
  return a.private_request_fingerprint === b.private_request_fingerprint && a.request_fingerprint === b.request_fingerprint &&
    a.expires_at === b.expires_at && a.attempt_id === b.attempt_id && sameGenerationPrincipal(a.principal, b.principal);
}

function snapshotPrincipal(value: GenerationPrincipalRef, attemptId: string): Readonly<GenerationPrincipalRef> {
  try {
    const principal = snapshotGenerationPrincipal(value);
    if (principal.connection_id !== attemptId) fail("PRINCIPAL_NOT_LINKED");
    return principal;
  } catch {
    return fail("INVALID_REQUEST");
  }
}

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exact(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || !fields.tenant_id.trim() ||
      typeof fields.subject !== "string" || !fields.subject.trim()) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}

function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) ||
        keys.some((key) => typeof key !== "string" || (!required.includes(key) && !optional.includes(key)) ||
          !descriptors[key]!.enumerable || !("value" in descriptors[key]!)) ||
        required.some((key) => !Object.hasOwn(descriptors, key))) fail("INVALID_REQUEST");
    const output = Object.create(null) as Record<string, any>;
    for (const key of [...required, ...optional]) {
      if (Object.hasOwn(descriptors, key)) output[key] = descriptors[key]!.value;
    }
    return output;
  } catch {
    return fail("INVALID_REQUEST");
  }
}

function isLinkService(value: unknown): value is PerUserLinkService {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(PerUserLinkService.prototype, "getStatus");
    return !!value && typeof value === "object" && !types.isProxy(value) &&
      Object.getPrototypeOf(value) === PerUserLinkService.prototype && !Object.hasOwn(value, "getStatus") &&
      !!descriptor && "value" in descriptor && descriptor.value === LINK_GET_STATUS &&
      Reflect.get(value, "getStatus") === LINK_GET_STATUS;
  } catch {
    return false;
  }
}

function isNativeReferenceService(value: unknown): value is ReferenceService {
  try {
    return !!value && typeof value === "object" && !types.isProxy(value) &&
      Object.getPrototypeOf(value) === OwnerWan26R2vReferenceService.prototype &&
      OwnerWan26R2vReferenceService.prototype.resolveManifest === RESOLVE &&
      OwnerWan26R2vReferenceService.prototype.withCapturedNativeReferences === CAPTURE &&
      OwnerWan26R2vReferenceService.prototype.invalidateAttempt === REFERENCE_INVALIDATE &&
      OwnerWan26R2vReferenceService.prototype.close === REFERENCE_CLOSE;
  } catch {
    return false;
  }
}

function expected(state: State) {
  return { chat_uuid: state.chat.chat_uuid, owner_echo_message_id: state.ownerEcho ?? null,
    prompt: state.request.prompt, model_id: state.chat.model_id };
}

function historyOutput(witness: OwnerWan26R2vHistoryWitness, status: OwnerWan26R2vNativeHistory["history_page_status"],
  calls: number, totalCount: number | null, totalPages: number | null): OwnerWan26R2vResultCandidates {
  return Object.freeze({ ...witness, history_page_status: status, history_get_calls: calls, total_count: totalCount,
    total_pages: totalPages, contexts: Object.freeze([]) });
}

const historyPage = z.object({
  messages: z.array(z.unknown()).max(PAGE_SIZE),
  pagination: z.object({
    page: z.number().int().min(1).max(PAGE_LIMIT),
    page_size: z.literal(PAGE_SIZE),
    total_count: z.number().int().min(0).max(64),
    total_pages: z.number().int().min(0).max(PAGE_LIMIT),
    has_next: z.boolean(),
    has_previous: z.boolean()
  }).passthrough()
}).passthrough();

function safeId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

function checkSignal(signal?: AbortSignal): void {
  if (signal === undefined) return;
  try {
    if (!signal || types.isProxy(signal) || Object.getPrototypeOf(signal) !== AbortSignal.prototype || !ABORTED_GETTER) {
      fail("INVALID_REQUEST");
    }
    Reflect.apply(ABORTED_GETTER!, signal, []);
  } catch {
    fail("INVALID_REQUEST");
  }
}

function isSignalAborted(signal?: AbortSignal): boolean {
  if (signal === undefined) return false;
  checkSignal(signal);
  try {
    return Reflect.apply(ABORTED_GETTER!, signal, []) === true;
  } catch {
    return fail("INVALID_REQUEST");
  }
}

function translate(error: unknown, fallback: OwnerWan26R2vNativeErrorCode): OwnerWan26R2vNativeError {
  if (error instanceof OwnerWan26R2vNativeError) return error;
  if (error instanceof OwnerWan26R2vOneShotPolicyError) {
    return new OwnerWan26R2vNativeError(error.code === "PRINCIPAL_MISMATCH" ? "PRINCIPAL_NOT_LINKED" : "CANDIDATE_INVALID");
  }
  if (error instanceof OwnerWan26R2vRequestPreparerError) {
    if (error.code === "PRINCIPAL_NOT_LINKED") return new OwnerWan26R2vNativeError("PRINCIPAL_NOT_LINKED");
    if (error.code === "REQUEST_ABORTED") return new OwnerWan26R2vNativeError("REQUEST_ABORTED");
  }
  if (error instanceof OwnerWan26R2vReferenceServiceError) {
    if (error.code === "PRINCIPAL_NOT_LINKED") return new OwnerWan26R2vNativeError("PRINCIPAL_NOT_LINKED");
    if (error.code === "REQUEST_ABORTED") return new OwnerWan26R2vNativeError("REQUEST_ABORTED");
  }
  if (error instanceof OwnerReferencePrincipalError) return new OwnerWan26R2vNativeError("PRINCIPAL_NOT_LINKED");
  return new OwnerWan26R2vNativeError(fallback);
}

async function consume(input: unknown, packet: unknown, method: "create" | "start" | "list" | "get") {
  try {
    const native = await import("./chat-http-client.js");
    return native.consumeOwnerWan26R2vNativeInvocation(input, packet, method);
  } catch {
    fail("INVALID_REQUEST");
  }
}

function fail(code: OwnerWan26R2vNativeErrorCode): never {
  throw new OwnerWan26R2vNativeError(code);
}

function readSyntxHttpErrorClass(error: unknown): SyntxHttpErrorCode | null {
  try {
    if (!error || typeof error !== "object" || types.isProxy(error) || Object.getPrototypeOf(error) !== SyntxHttpError.prototype) return null;
    return canonicalStartErrorClass(Object.getOwnPropertyDescriptor(error, "code")?.value);
  } catch { return null; }
}
function canonicalStartErrorClass(value: unknown): SyntxHttpErrorCode | null {
  return typeof value === "string" && SAFE_START_ERROR_CLASSES.has(value as SyntxHttpErrorCode)
    ? value as SyntxHttpErrorCode : null;
}
