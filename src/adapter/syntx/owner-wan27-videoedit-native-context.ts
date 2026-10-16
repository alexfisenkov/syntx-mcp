import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../../auth/owner-reference-principal.js";
import { PerUserLinkService } from "../../auth/link-service.js";
import type { AuthBinding } from "../../auth/types.js";
import type { GenerationPrincipalRef } from "../../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../../domain/generation-principal.js";
import { schemaHash } from "../../domain/generation-contract.js";
import {
  consumeOwnerWan27VideoEditOneShotPermit,
  revalidateOwnerWan27VideoEditOneShotPermit,
  type OwnerWan27VideoEditOneShotPermit
} from "../../application/owner-wan27-videoedit-one-shot-policy.js";
import {
  isOwnerWan27VideoEditPreparedCandidate,
  isOwnerWan27VideoEditRequestPreparer,
  OwnerWan27VideoEditRequestPreparer,
  type OwnerWan27VideoEditCandidateBinding,
  type OwnerWan27VideoEditPreparedCandidate
} from "../../application/owner-wan27-videoedit-request-preparer.js";
import {
  isOwnerWan27VideoEditReferenceService,
  OwnerWan27VideoEditReferenceService
} from "../../application/owner-wan27-videoedit-reference-service.js";
import { getOwnerWan27VideoEditSourceProfile } from "../../application/owner-wan27-videoedit-parameters.js";
import type { OwnerWan27VideoEditWireCandidate } from "../../application/owner-wan27-videoedit-wire.js";
import { SyntxChatHttpClient } from "./chat-http-client.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";

const MODEL_ID = "wan_27_videoedit" as const;
const AI_NAME = "wan_video" as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const HANDLE = /^wan27_videoedit_reference_[0-9a-f-]{36}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const CHAT_LIMIT = 128;
const PAGE_SIZE = 10;
const PAGE_LIMIT = 7;
const MESSAGE_LIMIT = 64;
const OBJECT_LIMIT = 64;
const BOT_AUTHOR_ID = -1;

const operations = new WeakMap<object, NativeState>();
const chatsByClient = new WeakMap<object, Map<string, NativeState>>();
const resultContexts = new WeakMap<object, ResultState>();
const issuedPermits = new WeakSet<object>();
const pendingCreates = new WeakSet<object>();
const pendingStarts = new WeakSet<object>();
const NATIVE_LINK_STATUS = PerUserLinkService.prototype.getStatus;
const NATIVE_REFERENCE_METHODS = Object.freeze({
  resolve: OwnerWan27VideoEditReferenceService.prototype.resolveReferences,
  guard: OwnerWan27VideoEditReferenceService.prototype.isOwnedReferences,
  capture: OwnerWan27VideoEditReferenceService.prototype.withCapturedReferences,
  invalidate: OwnerWan27VideoEditReferenceService.prototype.invalidateAttempt,
  close: OwnerWan27VideoEditReferenceService.prototype.close
});
const NATIVE_PREPARER_METHODS = Object.freeze({
  prepare: OwnerWan27VideoEditRequestPreparer.prototype.prepare,
  inspect: OwnerWan27VideoEditRequestPreparer.prototype.inspectCandidate,
  request: OwnerWan27VideoEditRequestPreparer.prototype.getPrivateRequest,
  revalidate: OwnerWan27VideoEditRequestPreparer.prototype.revalidateCandidate,
  capture: OwnerWan27VideoEditRequestPreparer.prototype.withCapturedReferences,
  bound: OwnerWan27VideoEditRequestPreparer.prototype.isBoundToReferenceService,
  invalidate: OwnerWan27VideoEditRequestPreparer.prototype.invalidateAttempt,
  close: OwnerWan27VideoEditRequestPreparer.prototype.close
});
const CLIENT_METHODS = Object.freeze({
  createChat: SyntxChatHttpClient.prototype.createChat,
  upload: methodOnClient("uploadOwnerWan27VideoEditReference"),
  create: methodOnClient("createOwnerWan27VideoEditChat"),
  start: methodOnClient("startOwnerWan27VideoEditWithOwnedCandidate"),
  list: methodOnClient("listOwnedWan27VideoEditCandidates"),
  get: methodOnClient("getOwnedWan27VideoEditResult")
});

type CandidateBinding = OwnerWan27VideoEditCandidateBinding;
type SourceMetadata = OwnerWan27VideoEditPreparedCandidate["sources"][number];
type InvocationMethod = "create" | "start" | "list" | "get";

export interface OwnerWan27VideoEditNativeOperationInput {
  readonly preparer: OwnerWan27VideoEditRequestPreparer;
  readonly candidate: OwnerWan27VideoEditPreparedCandidate;
  readonly permit: OwnerWan27VideoEditOneShotPermit;
  readonly referenceService: OwnerWan27VideoEditReferenceService;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly linkService: PerUserLinkService;
  readonly binding: AuthBinding;
}

export interface OwnerWan27VideoEditNativeChatContext {
  readonly status: "created";
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly model_id: typeof MODEL_ID;
  readonly profile_sha256: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly sources: readonly SourceMetadata[];
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerWan27VideoEditNativeStartAck {
  readonly chat_uuid: string;
  readonly message_id: string;
}

export interface OwnerWan27VideoEditNativeDispatchStatus {
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly model_id: typeof MODEL_ID;
  readonly phase: NativePhase;
  readonly dispatch_attempted: boolean;
  readonly owner_ack_bound: boolean;
  readonly owner_echo_message_id: string | null;
}

export type OwnerWan27VideoEditNativeRequestEchoStatus = "MATCHED" | "ABSENT" | "PARTIAL_UNPROVEN" | "CONTRADICTORY";

export interface OwnerWan27VideoEditNativeResultContext {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly model_id: typeof MODEL_ID;
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly string[];
  readonly attempt_id: string;
  readonly profile_sha256: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly owner_echo_message_id: string;
}

export interface OwnerWan27VideoEditNativeResultCandidates {
  readonly status: "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  readonly request_echo_status: OwnerWan27VideoEditNativeRequestEchoStatus;
  readonly history_binding_status: "BOUND" | "UNVERIFIED";
  readonly history_page_status: "NOT_READ" | "COMPLETE" | "INCOMPLETE" | "UNPROVEN";
  readonly history_get_calls: number;
  readonly total_count: number | null;
  readonly total_pages: number | null;
  readonly provider_chat_id: string | null;
  readonly owner_echo_message_id: string | null;
  readonly contexts: readonly OwnerWan27VideoEditNativeResultContext[];
  readonly gaps: readonly string[];
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerWan27VideoEditNativeVideoArtifact {
  readonly object_index: number;
  readonly message_object_id: string;
  readonly object_type: "video";
  readonly object_url: string;
  readonly mime_type: "video/mp4" | "video/quicktime" | null;
  readonly mime_source: "URL_EXTENSION" | "UNKNOWN";
}

export interface OwnerWan27VideoEditNativeResult {
  readonly message_binding: "BOUND" | "UNVERIFIED";
  readonly model_echo: "MATCHED" | "UNKNOWN" | "MISMATCH";
  readonly provider_terminal_status: "UNPROVEN";
  readonly artifacts: readonly OwnerWan27VideoEditNativeVideoArtifact[];
  readonly gaps: readonly string[];
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerWan27VideoEditNativeResultReadInput {
  readonly result_context: OwnerWan27VideoEditNativeResultContext;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly linkService: PerUserLinkService;
  readonly binding: AuthBinding;
}

export type OwnerWan27VideoEditNativeErrorCode =
  | "INVALID_REQUEST" | "CANDIDATE_INVALID" | "CHAT_CREATE_OUTCOME_UNKNOWN" | "CHAT_CONTEXT_INVALID"
  | "CHAT_ALREADY_CREATED" | "CHAT_NOT_DISPATCHED" | "OUTCOME_UNKNOWN" | "HISTORY_UNAVAILABLE"
  | "RESULT_CONTEXT_INVALID" | "RESULT_GET_UNAVAILABLE" | "REQUEST_ABORTED" | "CAPACITY_EXCEEDED"
  | "PRINCIPAL_NOT_LINKED";

export class OwnerWan27VideoEditNativeError extends Error {
  constructor(readonly code: OwnerWan27VideoEditNativeErrorCode) {
    super("The owner WAN 2.7 Video Edit native operation could not be completed safely.");
    this.name = "OwnerWan27VideoEditNativeError";
  }
}

type NativePhase = "AVAILABLE" | "OUTCOME_UNKNOWN" | "ACKNOWLEDGED";
interface NativeInput extends OwnerWan27VideoEditNativeOperationInput {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly binding: Readonly<AuthBinding>;
}
interface NativeInputWithChat extends NativeInput { readonly chat: OwnerWan27VideoEditNativeChatContext; }
interface WireSnapshot { readonly wire: OwnerWan27VideoEditWireCandidate; readonly wireHash: string; }
interface NativeState {
  readonly client: SyntxChatHttpClient;
  readonly input: NativeInput;
  readonly auth: NativeInput;
  readonly chat: OwnerWan27VideoEditNativeChatContext;
  readonly binding: Readonly<CandidateBinding>;
  readonly preDispatchSnapshot: WireSnapshot;
  phase: NativePhase;
  dispatchSnapshot?: WireSnapshot;
  ownerEcho?: string;
  readonly contexts: Map<string, OwnerWan27VideoEditNativeResultContext>;
}
interface ResultCodec {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly model_id: typeof MODEL_ID;
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly string[];
}
interface ResultState {
  readonly client: SyntxChatHttpClient;
  readonly state: NativeState;
  readonly context: OwnerWan27VideoEditNativeResultContext;
  readonly codec: ResultCodec;
}
interface Invocation { readonly client: SyntxChatHttpClient; readonly callback: Function; }
interface HistoryObject {
  readonly id: string;
  readonly message_id: string;
  readonly object_type: string;
  readonly object_text?: string | null;
  readonly object_url?: string | null;
  readonly model_type?: string | null;
  readonly completed?: boolean;
}
interface HistoryRow {
  readonly id: string;
  readonly chat_id: string;
  readonly author_id: number;
  readonly message_object: readonly HistoryObject[];
}
interface HistoryPage {
  readonly messages: readonly HistoryRow[];
  readonly page: number;
  readonly page_size: number;
  readonly total_count: number;
  readonly total_pages: number;
  readonly has_next: boolean;
  readonly has_previous: boolean;
}

/** Creates one private WAN27 Video Edit chat from its exact nominal candidate. */
export async function createOwnerWan27VideoEditNativeChat(
  input: unknown, packet: unknown, signal?: AbortSignal
): Promise<OwnerWan27VideoEditNativeChatContext> {
  const invocation = await consumeInvocation(input, packet, "create");
  const createChat = invocation.callback as (title: string, signal?: AbortSignal) => Promise<{ chat_uuid: string }>;
  const fields = readOperation(input, false);
  validateSignal(signal);
  if (aborted(signal)) fail("REQUEST_ABORTED");
  await assertCurrent(fields, signal);
  await revalidateCandidate(fields, signal);
  await revalidatePermit(fields);
  await assertCurrent(fields, signal);
  const binding = inspectCandidate(fields);
  const snapshot = captureWire(fields, invocation.client, binding);

  const chats = chatsByClient.get(invocation.client) ?? new Map<string, NativeState>();
  if (chats.size >= CHAT_LIMIT) fail("CAPACITY_EXCEEDED");
  if (issuedPermits.has(fields.permit as object) || pendingCreates.has(fields.permit as object)) fail("CHAT_ALREADY_CREATED");
  pendingCreates.add(fields.permit as object);
  issuedPermits.add(fields.permit as object);

  let chatUuid: string;
  try {
    const receipt = exact(await createChat(`owner-wan27-videoedit-${cryptoRandomUuid()}`, signal), ["chat_uuid"]);
    if (aborted(signal) || !safeId(receipt.chat_uuid) || chats.has(receipt.chat_uuid)) fail("CHAT_CREATE_OUTCOME_UNKNOWN");
    chatUuid = receipt.chat_uuid;
  } catch {
    pendingCreates.delete(fields.permit as object);
    if (aborted(signal)) fail("REQUEST_ABORTED");
    fail("CHAT_CREATE_OUTCOME_UNKNOWN");
  }
  pendingCreates.delete(fields.permit as object);

  try {
    await assertCurrent(fields, signal);
    await revalidateCandidate(fields, signal);
    await revalidatePermit(fields);
    await assertCurrent(fields, signal);
    const current = captureWire(fields, invocation.client, inspectCandidate(fields));
    if (current.wireHash !== snapshot.wireHash || schemaHash(inspectCandidate(fields)) !== schemaHash(binding)) {
      fail("CHAT_CREATE_OUTCOME_UNKNOWN");
    }
  } catch { fail("CHAT_CREATE_OUTCOME_UNKNOWN"); }

  const chat: OwnerWan27VideoEditNativeChatContext = Object.freeze({
    status: "created", chat_uuid: chatUuid!, attempt_id: fields.attemptId, model_id: MODEL_ID,
    profile_sha256: binding.profile_sha256, request_fingerprint: binding.request_fingerprint,
    intent_fingerprint: binding.intent_fingerprint, sources: safeSources(binding.sources),
    dispatch_allowed: false, backend_acceptance: "UNPROVEN"
  });
  const state: NativeState = { client: invocation.client, input: fields, auth: fields, chat, binding,
    preDispatchSnapshot: snapshot, phase: "AVAILABLE", contexts: new Map() };
  chats.set(chat.chat_uuid, state);
  chatsByClient.set(invocation.client, chats);
  operations.set(chat, state);
  return chat;
}

/** Revalidates and consumes one WAN27 Video Edit one-shot permit before its sole generation POST. */
export async function startOwnerWan27VideoEditWithOwnedCandidate(
  input: unknown, packet: unknown, signal?: AbortSignal
): Promise<OwnerWan27VideoEditNativeStartAck> {
  const invocation = await consumeInvocation(input, packet, "start");
  const start = invocation.callback as (chatUuid: string, body: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
  const fields = readOperation(input, true);
  const state = stateFor(invocation.client, fields.chat);
  if (!sameOperation(state.input, fields)) fail("CHAT_CONTEXT_INVALID");
  if (state.phase !== "AVAILABLE") fail("CHAT_NOT_DISPATCHED");
  validateSignal(signal);
  if (aborted(signal)) fail("REQUEST_ABORTED");
  if (pendingStarts.has(state.chat)) fail("CHAT_NOT_DISPATCHED");
  pendingStarts.add(state.chat);
  let postStarted = false;
  try {
    inspectCandidate(fields);
    await assertCurrent(state.auth, signal);
    await revalidateCandidate(fields, signal);
    await assertCurrent(state.auth, signal);
    const current = captureWire(fields, invocation.client, inspectCandidate(fields));
    if (schemaHash(inspectCandidate(fields)) !== schemaHash(state.binding) ||
        current.wireHash !== state.preDispatchSnapshot.wireHash) fail("CANDIDATE_INVALID");
    await revalidatePermit(fields);
    await assertCurrent(state.auth, signal);
    const finalSnapshot = captureWire(fields, invocation.client, inspectCandidate(fields));
    if (finalSnapshot.wireHash !== current.wireHash) fail("CANDIDATE_INVALID");
    consumePermit(fields);
    state.dispatchSnapshot = finalSnapshot;
    state.phase = "OUTCOME_UNKNOWN";

    const body = Object.freeze({ chat_id: state.chat.chat_uuid, prompt: finalSnapshot.wire.wire.prompt,
      settings: finalSnapshot.wire.wire.settings });
    postStarted = true;
    const raw = await start(state.chat.chat_uuid, body, signal);
    const ack = exact(raw, ["chat_uuid", "message_id"]);
    if (aborted(signal) || ack.chat_uuid !== state.chat.chat_uuid || !safeId(ack.message_id)) fail("OUTCOME_UNKNOWN");
    await assertCurrent(state.auth, signal);
    if (state.dispatchSnapshot !== finalSnapshot || state.dispatchSnapshot.wireHash !== state.preDispatchSnapshot.wireHash) fail("OUTCOME_UNKNOWN");
    state.ownerEcho = ack.message_id;
    state.phase = "ACKNOWLEDGED";
    return Object.freeze({ chat_uuid: ack.chat_uuid, message_id: ack.message_id });
  } catch (error) {
    if (postStarted || state.phase !== "AVAILABLE") { state.phase = "OUTCOME_UNKNOWN"; fail("OUTCOME_UNKNOWN"); }
    if (error instanceof OwnerWan27VideoEditNativeError) throw error;
    if (aborted(signal)) fail("REQUEST_ABORTED");
    fail("CANDIDATE_INVALID");
  } finally { pendingStarts.delete(state.chat); }
}

/** Bounded GET-only owner history. A missing ACK is never reconstructed or replayed. */
export async function listOwnerWan27VideoEditNativeCandidates(
  input: unknown, packet: unknown, signal?: AbortSignal
): Promise<OwnerWan27VideoEditNativeResultCandidates> {
  const invocation = await consumeInvocation(input, packet, "list");
  const getPage = invocation.callback as (chatUuid: string, page: number, pageSize: number, signal?: AbortSignal) => Promise<unknown>;
  const fields = readOperation(input, true);
  const state = stateFor(invocation.client, fields.chat);
  if (!sameOperation(state.input, fields)) fail("CHAT_CONTEXT_INVALID");
  validateSignal(signal);
  if (aborted(signal)) fail("REQUEST_ABORTED");
  await assertCurrent(state.auth, signal);
  if (state.phase !== "ACKNOWLEDGED" || !state.dispatchSnapshot || !state.ownerEcho) {
    return emptyCandidates("UNVERIFIED", "MISSING", "ABSENT", "NOT_READ", 0, "POST_ACK_UNAVAILABLE");
  }

  const rows: HistoryRow[] = [], messageIds = new Set<string>(), objectIds = new Set<string>();
  let totalCount: number | undefined, totalPages: number | undefined, providerChatId: string | undefined, calls = 0;
  try {
    for (let page = 1; page <= PAGE_LIMIT; page += 1) {
      await assertCurrent(state.auth, signal);
      calls += 1;
      let raw: unknown;
      try { raw = await getPage(state.chat.chat_uuid, page, PAGE_SIZE, signal); }
      finally { await assertCurrent(state.auth, signal); }
      const parsed = parseHistoryPage(raw, page);
      if (!parsed) return emptyCandidates("UNVERIFIED", "MISSING", "ABSENT", "INCOMPLETE", calls, "HISTORY_PAGE_INVALID");
      totalCount ??= parsed.total_count; totalPages ??= parsed.total_pages;
      if (parsed.total_count !== totalCount || parsed.total_pages !== totalPages || page > Math.max(1, parsed.total_pages)) {
        return emptyCandidates("UNVERIFIED", "MISSING", "ABSENT", "INCOMPLETE", calls, "HISTORY_PAGINATION_CHANGED");
      }
      for (const row of parsed.messages) {
        if (providerChatId !== undefined && row.chat_id !== providerChatId) {
          return emptyCandidates("UNVERIFIED", "MISSING", "ABSENT", "INCOMPLETE", calls, "HISTORY_JOIN_INVALID");
        }
        providerChatId ??= row.chat_id;
        if (messageIds.has(row.id) || row.message_object.some((object) => object.message_id !== row.id || objectIds.has(object.id))) {
          return emptyCandidates("UNVERIFIED", "MISSING", "ABSENT", "INCOMPLETE", calls, "HISTORY_JOIN_INVALID");
        }
        messageIds.add(row.id);
        for (const object of row.message_object) objectIds.add(object.id);
        rows.push(row);
      }
      if (rows.length > MESSAGE_LIMIT) return emptyCandidates("INCOMPLETE", "MISSING", "ABSENT", "INCOMPLETE", calls, "HISTORY_MESSAGE_LIMIT_EXCEEDED");
      if (page >= parsed.total_pages) break;
      if (page === PAGE_LIMIT) return emptyCandidates("UNVERIFIED", "MISSING", "ABSENT", "INCOMPLETE", calls, "HISTORY_PAGE_LIMIT_EXCEEDED");
    }
  } catch {
    if (aborted(signal)) fail("REQUEST_ABORTED");
    return emptyCandidates("UNVERIFIED", "MISSING", "ABSENT", "INCOMPLETE", calls, "HISTORY_UNAVAILABLE");
  }

  if (totalCount === undefined || totalPages === undefined || rows.length !== totalCount) {
    return emptyCandidates("UNVERIFIED", "MISSING", "ABSENT", "INCOMPLETE", calls, "HISTORY_INCOMPLETE");
  }
  if (rows.length === 0 || providerChatId === undefined) {
    return historyResult("PENDING", "MISSING", "ABSENT", "BOUND", "COMPLETE", calls,
      totalCount, totalPages, providerChatId ?? null, state.ownerEcho, [], ["OWNER_ACK_MISSING"]);
  }

  const ackRows = rows.filter((row) => row.id === state.ownerEcho && row.author_id > 0);
  if (ackRows.length !== 1) {
    const status = ackRows.length > 1 ? "AMBIGUOUS" : "MISSING";
    return historyResult("INCOMPLETE", status, "ABSENT", "BOUND", "COMPLETE", calls,
      totalCount, totalPages, providerChatId, state.ownerEcho, [], [ackRows.length > 1 ? "OWNER_ACK_AMBIGUOUS" : "OWNER_ACK_MISSING"]);
  }
  if (rows.some((row) => row.author_id > 0 && row.id !== state.ownerEcho && row.message_object.length > 0)) {
    return historyResult("UNVERIFIED", "MATCHED", "PARTIAL_UNPROVEN", "BOUND", "COMPLETE", calls,
      totalCount, totalPages, providerChatId, state.ownerEcho, [], ["HISTORY_ADDITIONAL_OWNER_REQUEST"]);
  }

  const echo = inspectRequestEcho(ackRows[0]!, state.dispatchSnapshot.wire);
  if (echo !== "MATCHED") {
    const gap = echo === "ABSENT" ? "OWNER_REQUEST_ECHO_ABSENT" : echo === "CONTRADICTORY"
      ? "OWNER_REQUEST_ECHO_CONTRADICTORY" : "OWNER_REQUEST_ECHO_PARTIAL_UNPROVEN";
    return historyResult("UNVERIFIED", "MATCHED", echo, "BOUND", "COMPLETE", calls,
      totalCount, totalPages, providerChatId, state.ownerEcho, [], [gap]);
  }

  const found: Array<Readonly<{ context: OwnerWan27VideoEditNativeResultContext; codec: ResultCodec }>> = [];
  const gaps: string[] = [];
  let videoCount = 0;
  for (const row of rows) {
    if (row.author_id !== BOT_AUTHOR_ID) continue;
    const videos = row.message_object.filter((object) => object.object_type === "video");
    if (videos.length === 0) continue;
    if (videos.length > OBJECT_LIMIT || videos.some((video) => video.model_type !== MODEL_ID || video.completed !== true ||
        typeof video.object_url !== "string" || !isSafeUploadReferenceUrl(video.object_url))) {
      gaps.push("BOT_VIDEO_MODEL_COMPLETION_OR_OBJECT_MISMATCH"); continue;
    }
    if (videoCount + videos.length > OBJECT_LIMIT) { gaps.push("RESULT_VIDEO_LIMIT_EXCEEDED"); continue; }
    videoCount += videos.length;
    const ids = Object.freeze(videos.map((video) => video.id));
    const codec: ResultCodec = Object.freeze({ chat_uuid: state.chat.chat_uuid, message_id: row.id,
      model_id: MODEL_ID, provider_chat_id: providerChatId, message_object_ids: ids });
    const context: OwnerWan27VideoEditNativeResultContext = Object.freeze({ ...codec,
      attempt_id: state.chat.attempt_id, profile_sha256: state.chat.profile_sha256,
      request_fingerprint: state.chat.request_fingerprint, intent_fingerprint: state.chat.intent_fingerprint,
      owner_echo_message_id: state.ownerEcho });
    const existing = state.contexts.get(row.id);
    if (existing && schemaHash(existing) !== schemaHash(context)) {
      return historyResult("UNVERIFIED", "MATCHED", echo, "UNVERIFIED", "UNPROVEN", calls,
        totalCount, totalPages, providerChatId, state.ownerEcho, [], ["RESULT_CONTEXT_MISMATCH"]);
    }
    found.push(Object.freeze({ context: existing ?? context, codec }));
  }
  if (gaps.length > 0) return historyResult("UNVERIFIED", "MATCHED", echo, "BOUND", "COMPLETE", calls,
    totalCount, totalPages, providerChatId, state.ownerEcho, [], gaps);
  const contexts = found.map(({ context, codec }) => {
    if (!state.contexts.has(context.message_id)) {
      resultContexts.set(context, { client: invocation.client, state, context, codec });
      state.contexts.set(context.message_id, context);
    }
    return state.contexts.get(context.message_id)!;
  });
  return historyResult(contexts.length > 0 ? "COMPLETE" : "PENDING", "MATCHED", echo, "BOUND", "COMPLETE", calls,
    totalCount, totalPages, providerChatId, state.ownerEcho, contexts, contexts.length > 0 ? [] : ["BOT_RESULT_NOT_OBSERVED"]);
}

/** GETs one nominal result context; upload/preparer TTL does not gate post-ACK reads. */
export async function getOwnerWan27VideoEditNativeResult(
  input: unknown, packet: unknown, signal?: AbortSignal
): Promise<OwnerWan27VideoEditNativeResult> {
  const invocation = await consumeInvocation(input, packet, "get");
  const getMessage = invocation.callback as (chatUuid: string, messageId: string, signal?: AbortSignal) => Promise<unknown>;
  const fields = readResultReadInput(input), owned = resultContexts.get(fields.result_context as object);
  if (!owned || owned.client !== invocation.client || owned.context !== fields.result_context || owned.state.phase !== "ACKNOWLEDGED" ||
      owned.state.ownerEcho !== owned.context.owner_echo_message_id || operations.get(owned.state.chat) !== owned.state ||
      owned.state.chat.attempt_id !== fields.attemptId || owned.state.chat.model_id !== MODEL_ID ||
      owned.state.chat.intent_fingerprint !== owned.context.intent_fingerprint || owned.state.client !== invocation.client ||
      !sameGenerationPrincipal(fields.principal, owned.state.auth.principal) || !sameBinding(fields.binding, owned.state.auth.binding) ||
      fields.linkService !== owned.state.auth.linkService || owned.state.chat.profile_sha256 !== owned.context.profile_sha256) fail("RESULT_CONTEXT_INVALID");
  validateSignal(signal);
  if (aborted(signal)) fail("REQUEST_ABORTED");
  await assertCurrent(owned.state.auth, signal);
  try {
    let raw: unknown;
    try { raw = await getMessage(owned.codec.chat_uuid, owned.codec.message_id, signal); }
    finally { await assertCurrent(owned.state.auth, signal); }
    return decodeResult(raw, owned.codec);
  } catch { if (aborted(signal)) fail("REQUEST_ABORTED"); fail("RESULT_GET_UNAVAILABLE"); }
}

/** Read-only local status for the exact client-owned chat capability. */
export function readOwnerWan27VideoEditNativeDispatchStatus(client: unknown, chatInput: unknown): OwnerWan27VideoEditNativeDispatchStatus | null {
  if (!isExactNativeClient(client) || !chatInput || typeof chatInput !== "object" || types.isProxy(chatInput)) return null;
  const state = operations.get(chatInput as object);
  if (!state || state.client !== client || state.chat !== chatInput || chatsByClient.get(state.client)?.get(state.chat.chat_uuid) !== state) return null;
  return Object.freeze({ chat_uuid: state.chat.chat_uuid, attempt_id: state.chat.attempt_id, model_id: MODEL_ID,
    phase: state.phase, dispatch_attempted: state.phase !== "AVAILABLE",
    owner_ack_bound: state.phase === "ACKNOWLEDGED" && state.ownerEcho !== undefined,
    owner_echo_message_id: state.phase === "ACKNOWLEDGED" ? state.ownerEcho ?? null : null });
}

function inspectCandidate(fields: NativeInput): Readonly<CandidateBinding> {
  if (!isNativePreparer(fields.preparer) || !isOwnerWan27VideoEditPreparedCandidate(fields.candidate)) fail("CANDIDATE_INVALID");
  const binding = fields.preparer.inspectCandidate(fields.candidate);
  if (!binding || binding.model_id !== MODEL_ID || binding.profile_sha256 !== getOwnerWan27VideoEditSourceProfile().source_sha256 ||
      binding.attempt_id !== fields.attemptId || !sameGenerationPrincipal(binding.principal, fields.principal) ||
      fields.candidate.model_id !== binding.model_id || fields.candidate.profile_sha256 !== binding.profile_sha256 ||
      fields.candidate.request_fingerprint !== binding.request_fingerprint || fields.candidate.intent_fingerprint !== binding.intent_fingerprint ||
      fields.candidate.expires_at !== binding.expires_at || fields.candidate.status !== "blocked" ||
      fields.candidate.dispatch_allowed !== false || fields.candidate.backend_acceptance !== "UNPROVEN" ||
      schemaHash(fields.candidate.sources) !== schemaHash(binding.sources)) fail("CANDIDATE_INVALID");
  return binding;
}

function captureWire(fields: NativeInput, client: SyntxChatHttpClient, binding: Readonly<CandidateBinding>): WireSnapshot {
  const request = fields.preparer.getPrivateRequest(fields.candidate);
  if (!validWire(request, binding)) fail("CANDIDATE_INVALID");
  let captured: WireSnapshot | undefined;
  try {
    const returned = fields.preparer.withCapturedReferences(fields.candidate, (actualClient, wire) => {
      if (actualClient !== client || !validWire(wire, binding) || schemaHash(wire) !== schemaHash(request)) fail("CANDIDATE_INVALID");
      const metadata = fields.preparer.inspectCandidate(fields.candidate);
      if (!metadata || schemaHash(metadata) !== schemaHash(binding)) fail("CANDIDATE_INVALID");
      captured = Object.freeze({ wire, wireHash: schemaHash(wire) });
      return captured;
    });
    if (!captured || returned !== captured) fail("CANDIDATE_INVALID");
  } catch { fail("CANDIDATE_INVALID"); }
  if (captured!.wire.profile_sha256 !== binding.profile_sha256 ||
      captured!.wire.intent_fingerprint !== binding.intent_fingerprint ||
      captured!.wire.wire_fingerprint !== schemaHash(captured!.wire.wire)) fail("CANDIDATE_INVALID");
  return captured!;
}

function validWire(value: unknown, binding: Readonly<CandidateBinding>): value is OwnerWan27VideoEditWireCandidate {
  try {
    const wire = exact(value, ["status", "model_id", "profile_sha256", "wire", "cost_parameters", "files_mention",
      "source_input_duration_context", "intent_fingerprint", "wire_fingerprint", "reference_binding", "dispatch_allowed", "backend_acceptance"]);
    if (wire.status !== "SOURCE_ONLY_WIRE_CANDIDATE_NOT_DISPATCH_AUTHORITY" || wire.model_id !== MODEL_ID ||
        wire.profile_sha256 !== binding.profile_sha256 || wire.files_mention !== false || wire.dispatch_allowed !== false ||
        wire.backend_acceptance !== "UNPROVEN" || wire.reference_binding !== "SOURCE_ROWS_ONLY_NOT_NOMINAL" ||
        !safeFingerprint(wire.intent_fingerprint) || wire.intent_fingerprint !== binding.intent_fingerprint ||
        !safeFingerprint(wire.wire_fingerprint) || !Object.isFrozen(value)) return false;
    const body = exact(wire.wire, ["ai_name", "prompt", "settings"]);
    if (body.ai_name !== AI_NAME || typeof body.prompt !== "string" || !Object.isFrozen(body.settings)) return false;
    const settings = exact(body.settings, ["model_type", "resolution", "aspect_ratio", "video_duration", "audio_setting",
      "prompt_extend", "seed", "native_audio", "shot_type", "duration", "rendering_speed", "file_urls"]);
    if (settings.model_type !== MODEL_ID || settings.native_audio !== false || settings.shot_type !== "single" ||
        settings.rendering_speed !== "basic" || !Number.isFinite(settings.video_duration) || !Number.isFinite(settings.duration) ||
        !Array.isArray(settings.file_urls) || types.isProxy(settings.file_urls) || !Object.isFrozen(settings.file_urls) ||
        settings.file_urls.length !== binding.sources.length || settings.file_urls.length < 1 || settings.file_urls.length > 5) return false;
    const costs = exact(wire.cost_parameters, ["resolution", "video_duration", "duration"]);
    if (costs.resolution !== settings.resolution || costs.video_duration !== settings.video_duration || costs.duration !== settings.duration) return false;
    for (const [index, row] of settings.file_urls.entries()) {
      const file = exact(row, ["type", "url"]), source = binding.sources[index]!;
      if (file.type !== source.kind || typeof file.url !== "string" || !isSafeUploadReferenceUrl(file.url)) return false;
    }
    return true;
  } catch { return false; }
}

async function revalidateCandidate(fields: NativeInput, signal?: AbortSignal): Promise<Readonly<CandidateBinding>> {
  try {
    const binding = await fields.preparer.revalidateCandidate(fields.candidate, signal);
    if (schemaHash(binding) !== schemaHash(inspectCandidate(fields))) fail("CANDIDATE_INVALID");
    return binding;
  } catch { fail(aborted(signal) ? "REQUEST_ABORTED" : "CANDIDATE_INVALID"); }
}

async function revalidatePermit(fields: NativeInput): Promise<void> {
  try { await revalidateOwnerWan27VideoEditOneShotPermit({ permit: fields.permit, preparer: fields.preparer,
    candidate: fields.candidate, principal: fields.principal, attemptId: fields.attemptId }); }
  catch { fail("CANDIDATE_INVALID"); }
}

function consumePermit(fields: NativeInput): void {
  try { consumeOwnerWan27VideoEditOneShotPermit({ permit: fields.permit, preparer: fields.preparer,
    candidate: fields.candidate, principal: fields.principal, attemptId: fields.attemptId }); }
  catch { fail("CANDIDATE_INVALID"); }
}

async function assertCurrent(fields: NativeInput, signal?: AbortSignal): Promise<void> {
  validateSignal(signal);
  if (aborted(signal)) fail("REQUEST_ABORTED");
  if (!isNativeLinkService(fields.linkService)) fail("CANDIDATE_INVALID");
  try {
    const current = await resolveOwnerReferencePrincipal({ binding: fields.binding, attemptId: fields.attemptId,
      linkService: fields.linkService });
    if (!sameGenerationPrincipal(current, fields.principal) || aborted(signal)) {
      fail(aborted(signal) ? "REQUEST_ABORTED" : "PRINCIPAL_NOT_LINKED");
    }
  } catch (error) {
    if (error instanceof OwnerWan27VideoEditNativeError) throw error;
    if (aborted(signal)) fail("REQUEST_ABORTED");
    if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
    fail("PRINCIPAL_NOT_LINKED");
  }
}

async function consumeInvocation(input: unknown, packet: unknown, method: InvocationMethod): Promise<Invocation> {
  try {
    const native = await import("./chat-http-client.js") as unknown as {
      consumeOwnerWan27VideoEditNativeInvocation(value: unknown, token: unknown, kind: InvocationMethod): unknown;
    };
    const value = Reflect.apply(native.consumeOwnerWan27VideoEditNativeInvocation, undefined, [input, packet, method]);
    const fields = exact(value, ["client", "callback"]);
    if (!isExactNativeClient(fields.client) || typeof fields.callback !== "function" || types.isProxy(fields.callback)) fail("INVALID_REQUEST");
    return Object.freeze({ client: fields.client, callback: fields.callback });
  } catch { fail("INVALID_REQUEST"); }
}

function readOperation(value: unknown, withChat: false): NativeInput;
function readOperation(value: unknown, withChat: true): NativeInputWithChat;
function readOperation(value: unknown, withChat: boolean): NativeInput | NativeInputWithChat {
  const fields = exact(value, ["preparer", "candidate", "permit", "referenceService", "principal", "attemptId", "linkService", "binding",
    ...(withChat ? ["chat"] : [])]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) ||
      !fields.candidate || typeof fields.candidate !== "object" || types.isProxy(fields.candidate) ||
      !fields.permit || typeof fields.permit !== "object" || types.isProxy(fields.permit)) fail("INVALID_REQUEST");
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); } catch { fail("INVALID_REQUEST"); }
  const binding = exact(fields.binding, ["tenant_id", "subject"]);
  if (typeof binding.tenant_id !== "string" || typeof binding.subject !== "string" ||
      principal.connection_id !== fields.attemptId || principal.tenant_id !== binding.tenant_id || principal.subject_id !== binding.subject) fail("INVALID_REQUEST");
  if (!isNativeReferenceService(fields.referenceService) || !isNativePreparer(fields.preparer) ||
      !fields.preparer.isBoundToReferenceService(fields.referenceService) || !isNativeLinkService(fields.linkService)) fail("INVALID_REQUEST");
  const common: NativeInput = Object.freeze({ preparer: fields.preparer as OwnerWan27VideoEditRequestPreparer,
    candidate: fields.candidate as OwnerWan27VideoEditPreparedCandidate, permit: fields.permit as OwnerWan27VideoEditOneShotPermit,
    referenceService: fields.referenceService as OwnerWan27VideoEditReferenceService, principal, attemptId: fields.attemptId,
    linkService: fields.linkService as PerUserLinkService,
    binding: Object.freeze({ tenant_id: binding.tenant_id, subject: binding.subject }) });
  if (!withChat) return common;
  if (!fields.chat || typeof fields.chat !== "object" || types.isProxy(fields.chat)) fail("INVALID_REQUEST");
  return Object.freeze({ ...common, chat: fields.chat as OwnerWan27VideoEditNativeChatContext });
}

function readResultReadInput(value: unknown): Readonly<OwnerWan27VideoEditNativeResultReadInput & {
  readonly principal: Readonly<GenerationPrincipalRef>; readonly binding: Readonly<AuthBinding>
}> {
  const fields = exact(value, ["result_context", "principal", "attemptId", "linkService", "binding"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) ||
      !fields.result_context || typeof fields.result_context !== "object" || types.isProxy(fields.result_context)) fail("RESULT_CONTEXT_INVALID");
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); } catch { fail("RESULT_CONTEXT_INVALID"); }
  const binding = exact(fields.binding, ["tenant_id", "subject"]);
  if (typeof binding.tenant_id !== "string" || typeof binding.subject !== "string" || principal.connection_id !== fields.attemptId ||
      principal.tenant_id !== binding.tenant_id || principal.subject_id !== binding.subject || !isNativeLinkService(fields.linkService)) {
    fail("RESULT_CONTEXT_INVALID");
  }
  return Object.freeze({ result_context: fields.result_context as OwnerWan27VideoEditNativeResultContext, principal,
    attemptId: fields.attemptId, linkService: fields.linkService, binding: Object.freeze({ tenant_id: binding.tenant_id, subject: binding.subject }) });
}

function sameOperation(a: NativeInput, b: NativeInputWithChat): boolean {
  return a.preparer === b.preparer && a.candidate === b.candidate && a.permit === b.permit &&
    a.referenceService === b.referenceService && a.attemptId === b.attemptId && a.linkService === b.linkService &&
    sameGenerationPrincipal(a.principal, b.principal) && sameBinding(a.binding, b.binding);
}

function sameBinding(a: AuthBinding, b: AuthBinding): boolean { return a.tenant_id === b.tenant_id && a.subject === b.subject; }

function inspectRequestEcho(row: HistoryRow, wire: OwnerWan27VideoEditWireCandidate): OwnerWan27VideoEditNativeRequestEchoStatus {
  const textObjects = row.message_object.filter((object) => object.object_type === "text");
  if (textObjects.length > 1 || textObjects.some((object) => object.object_text !== wire.wire.prompt)) return "CONTRADICTORY";
  const expected = wire.wire.settings.file_urls;
  const observedIndexes = new Set<number>();
  let lastIndex = -1, sawEvidence = textObjects.length > 0, fullyTyped = true;
  for (const object of row.message_object) {
    if (object.model_type != null && object.model_type !== MODEL_ID) return "CONTRADICTORY";
    if (object.object_type !== "image" && object.object_type !== "video") {
      if (object.object_type === "audio") return "CONTRADICTORY";
      continue;
    }
    sawEvidence = true;
    if (typeof object.object_url !== "string") { fullyTyped = false; continue; }
    if (!isSafeUploadReferenceUrl(object.object_url)) return "CONTRADICTORY";
    const index = expected.findIndex((file, candidate) => candidate > lastIndex && file.type === object.object_type && file.url === object.object_url);
    if (index < 0 || observedIndexes.has(index)) return "CONTRADICTORY";
    if (index !== lastIndex + 1) fullyTyped = false;
    observedIndexes.add(index); lastIndex = index;
    if (object.model_type !== MODEL_ID) fullyTyped = false;
  }
  if (!sawEvidence) return "ABSENT";
  if (observedIndexes.size === expected.length && [...observedIndexes].some((index, position) => index !== position)) return "CONTRADICTORY";
  if (textObjects.length === 1 && observedIndexes.size === expected.length && fullyTyped) return "MATCHED";
  return "PARTIAL_UNPROVEN";
}

function decodeResult(raw: unknown, expected: ResultCodec): OwnerWan27VideoEditNativeResult {
  try {
    const message = dataRecord(raw);
    if (!message || normalizeId(message.id) !== expected.message_id || message.author_id !== BOT_AUTHOR_ID ||
        normalizeChatId(message.chat_id) !== expected.provider_chat_id) return resultGap("UNVERIFIED", "MISMATCH", "MESSAGE_BINDING_MISMATCH");
    if (!Array.isArray(message.message_object) || types.isProxy(message.message_object) || message.message_object.length > OBJECT_LIMIT) {
      return resultGap("UNVERIFIED", "UNKNOWN", "MESSAGE_OBJECT_ARRAY_INVALID");
    }
    const expectedIds = new Set(expected.message_object_ids), seenObjects = new Set<string>(), seenVideos = new Set<string>();
    const artifacts: OwnerWan27VideoEditNativeVideoArtifact[] = [], gaps: string[] = [];
    let sawVideo = false, modelMissing = false, modelMismatch = false;
    for (let index = 0; index < message.message_object.length; index += 1) {
      const item = dataRecord(message.message_object[index]);
      if (!item) { gaps.push("MESSAGE_OBJECT_INVALID"); continue; }
      const objectId = normalizeId(item.id);
      if (!objectId || seenObjects.has(objectId) || normalizeId(item.message_id) !== expected.message_id) {
        gaps.push("MESSAGE_OBJECT_BINDING_INVALID"); continue;
      }
      seenObjects.add(objectId);
      if (item.object_type !== "video") {
        if (expectedIds.has(objectId)) gaps.push("EXPECTED_VIDEO_TYPE_MISMATCH");
        continue;
      }
      if (!expectedIds.has(objectId)) { gaps.push("UNEXPECTED_VIDEO_OBJECT"); continue; }
      seenVideos.add(objectId); sawVideo = true;
      if (item.model_type !== MODEL_ID) {
        if (item.model_type === undefined || item.model_type === null) { modelMissing = true; gaps.push("MODEL_ECHO_MISSING"); }
        else { modelMismatch = true; gaps.push("MODEL_ECHO_MISMATCH"); }
        continue;
      }
      if (item.completed !== true || typeof item.object_url !== "string" || !isSafeUploadReferenceUrl(item.object_url)) {
        gaps.push("VIDEO_COMPLETION_OR_URL_UNPROVEN"); continue;
      }
      const mime = safeVideoMime(item.object_url);
      artifacts.push(Object.freeze({ object_index: index, message_object_id: objectId, object_type: "video",
        object_url: item.object_url, mime_type: mime, mime_source: mime === null ? "UNKNOWN" : "URL_EXTENSION" }));
    }
    if (seenVideos.size !== expectedIds.size) gaps.push("EXPECTED_RESULT_OBJECT_MISSING");
    const modelEcho: OwnerWan27VideoEditNativeResult["model_echo"] = modelMismatch ? "MISMATCH" : modelMissing || !sawVideo ? "UNKNOWN" : "MATCHED";
    const bound = gaps.length === 0 && artifacts.length > 0 && seenVideos.size === expectedIds.size && modelEcho === "MATCHED";
    return Object.freeze({ message_binding: bound ? "BOUND" : "UNVERIFIED", model_echo: modelEcho,
      provider_terminal_status: "UNPROVEN", artifacts: Object.freeze(bound ? artifacts : []),
      gaps: Object.freeze(gaps), backend_acceptance: "UNPROVEN" });
  } catch { return resultGap("UNVERIFIED", "UNKNOWN", "RESULT_SHAPE_INVALID"); }
}

function parseHistoryPage(raw: unknown, expectedPage: number): HistoryPage | undefined {
  const page = dataRecord(raw), pagination = page ? dataRecord(page.pagination) : undefined;
  const pageNumber = pagination?.page, pageSize = pagination?.page_size, totalCount = pagination?.total_count, totalPages = pagination?.total_pages;
  if (!page || !pagination || !Array.isArray(page.messages) || types.isProxy(page.messages) || page.messages.length > PAGE_SIZE ||
      typeof pageNumber !== "number" || !Number.isSafeInteger(pageNumber) || pageNumber !== expectedPage || pageSize !== PAGE_SIZE ||
      typeof totalCount !== "number" || !Number.isSafeInteger(totalCount) || totalCount < 0 || totalCount > MESSAGE_LIMIT ||
      typeof totalPages !== "number" || !Number.isSafeInteger(totalPages) || totalPages < 0 || totalPages > PAGE_LIMIT ||
      typeof pagination.has_next !== "boolean" || typeof pagination.has_previous !== "boolean") return undefined;
  if ((totalCount === 0 && totalPages !== 0) || (totalCount > 0 && totalPages !== Math.ceil(totalCount / PAGE_SIZE)) ||
      pagination.has_next !== (expectedPage < totalPages) || pagination.has_previous !== (expectedPage > 1)) return undefined;
  const messages: HistoryRow[] = [];
  for (const rawRow of page.messages) {
    const row = dataRecord(rawRow), id = row && normalizeId(row.id), chatId = row && normalizeChatId(row.chat_id);
    if (!row || !id || !chatId || !Number.isSafeInteger(row.author_id) || !Array.isArray(row.message_object) ||
        types.isProxy(row.message_object) || row.message_object.length > OBJECT_LIMIT) return undefined;
    const objects: HistoryObject[] = [];
    for (const rawObject of row.message_object) {
      const object = dataRecord(rawObject), objectId = object && normalizeId(object.id), messageId = object && normalizeId(object.message_id);
      if (!object || !objectId || messageId !== id || typeof object.object_type !== "string" || object.object_type.length > 24 ||
          (object.object_text !== undefined && object.object_text !== null && typeof object.object_text !== "string") ||
          (object.object_url !== undefined && object.object_url !== null && typeof object.object_url !== "string") ||
          (object.model_type !== undefined && object.model_type !== null && typeof object.model_type !== "string") ||
          (object.completed !== undefined && typeof object.completed !== "boolean")) return undefined;
      objects.push(Object.freeze({ id: objectId, message_id: messageId, object_type: object.object_type,
        ...(Object.hasOwn(object, "object_text") ? { object_text: object.object_text as string | null } : {}),
        ...(Object.hasOwn(object, "object_url") ? { object_url: object.object_url as string | null } : {}),
        ...(Object.hasOwn(object, "model_type") ? { model_type: object.model_type as string | null } : {}),
        ...(Object.hasOwn(object, "completed") ? { completed: object.completed as boolean } : {}) }));
    }
    messages.push(Object.freeze({ id, chat_id: chatId, author_id: row.author_id as number, message_object: Object.freeze(objects) }));
  }
  return Object.freeze({ messages: Object.freeze(messages), page: expectedPage, page_size: PAGE_SIZE,
    total_count: totalCount, total_pages: totalPages, has_next: pagination.has_next, has_previous: pagination.has_previous });
}

function emptyCandidates(status: OwnerWan27VideoEditNativeResultCandidates["status"], owner: OwnerWan27VideoEditNativeResultCandidates["owner_ack_status"],
  echo: OwnerWan27VideoEditNativeRequestEchoStatus, page: OwnerWan27VideoEditNativeResultCandidates["history_page_status"], calls: number,
  gap: string): OwnerWan27VideoEditNativeResultCandidates {
  return Object.freeze({ status, owner_ack_status: owner, request_echo_status: echo, history_binding_status: "UNVERIFIED",
    history_page_status: page, history_get_calls: calls, total_count: null, total_pages: null, provider_chat_id: null,
    owner_echo_message_id: null, contexts: Object.freeze([]), gaps: Object.freeze([gap]), backend_acceptance: "UNPROVEN" });
}

function historyResult(status: OwnerWan27VideoEditNativeResultCandidates["status"], owner: OwnerWan27VideoEditNativeResultCandidates["owner_ack_status"],
  echo: OwnerWan27VideoEditNativeRequestEchoStatus, binding: OwnerWan27VideoEditNativeResultCandidates["history_binding_status"],
  page: OwnerWan27VideoEditNativeResultCandidates["history_page_status"], calls: number, totalCount: number, totalPages: number,
  providerChatId: string | null, ownerEcho: string, contexts: readonly OwnerWan27VideoEditNativeResultContext[], gaps: readonly string[]): OwnerWan27VideoEditNativeResultCandidates {
  return Object.freeze({ status, owner_ack_status: owner, request_echo_status: echo, history_binding_status: binding,
    history_page_status: page, history_get_calls: calls, total_count: totalCount, total_pages: totalPages,
    provider_chat_id: providerChatId, owner_echo_message_id: ownerEcho, contexts: Object.freeze([...contexts]),
    gaps: Object.freeze([...gaps]), backend_acceptance: "UNPROVEN" });
}

function resultGap(binding: OwnerWan27VideoEditNativeResult["message_binding"], model: OwnerWan27VideoEditNativeResult["model_echo"],
  gap: string): OwnerWan27VideoEditNativeResult {
  return Object.freeze({ message_binding: binding, model_echo: model, provider_terminal_status: "UNPROVEN",
    artifacts: Object.freeze([]), gaps: Object.freeze([gap]), backend_acceptance: "UNPROVEN" });
}

function safeVideoMime(url: string): OwnerWan27VideoEditNativeVideoArtifact["mime_type"] {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith(".mp4")) return "video/mp4";
    if (path.endsWith(".mov")) return "video/quicktime";
  } catch { return null; }
  return null;
}

function safeSources(sources: readonly SourceMetadata[]): readonly SourceMetadata[] {
  if (!Array.isArray(sources) || types.isProxy(sources) || !Object.isFrozen(sources) || sources.length < 1 || sources.length > 5) {
    fail("CANDIDATE_INVALID");
  }
  let videoCount = 0, imageCount = 0;
  const handles = new Set<string>(), hashes = new Set<string>();
  const safe = sources.map((source) => {
    const fields = exact(source, ["reference_handle", "kind", "mime_type", "size", "sha256", "width", "height",
      "duration_seconds", "input_cost_duration_seconds"]);
    if (typeof fields.reference_handle !== "string" || !HANDLE.test(fields.reference_handle) ||
        (fields.kind !== "image" && fields.kind !== "video") || typeof fields.mime_type !== "string" ||
        typeof fields.size !== "number" || !Number.isSafeInteger(fields.size) || fields.size < 1 || fields.size > 100 * 1024 * 1024 ||
        typeof fields.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(fields.sha256) ||
        typeof fields.width !== "number" || !Number.isSafeInteger(fields.width) || fields.width < 240 || fields.width > 4096 ||
        typeof fields.height !== "number" || !Number.isSafeInteger(fields.height) || fields.height < 240 || fields.height > 4096) fail("CANDIDATE_INVALID");
    if (handles.has(fields.reference_handle) || hashes.has(fields.sha256)) fail("CANDIDATE_INVALID");
    handles.add(fields.reference_handle); hashes.add(fields.sha256);
    if (fields.kind === "image") {
      imageCount += 1;
      if (fields.duration_seconds !== null || fields.input_cost_duration_seconds !== null ||
          !["image/jpeg", "image/png", "image/bmp", "image/webp"].includes(fields.mime_type)) fail("CANDIDATE_INVALID");
    } else {
      videoCount += 1;
      if (typeof fields.duration_seconds !== "number" || !Number.isFinite(fields.duration_seconds) ||
          fields.duration_seconds < 2 || fields.duration_seconds > 10 ||
          typeof fields.input_cost_duration_seconds !== "number" || !Number.isFinite(fields.input_cost_duration_seconds) ||
          fields.input_cost_duration_seconds < 2 || fields.input_cost_duration_seconds > 10 ||
          (fields.mime_type !== "video/mp4" && fields.mime_type !== "video/quicktime")) fail("CANDIDATE_INVALID");
    }
    return Object.freeze({ ...fields }) as unknown as SourceMetadata;
  });
  if (videoCount !== 1 || imageCount > 4) fail("CANDIDATE_INVALID");
  return Object.freeze(safe);
}

function cryptoRandomUuid(): string { return randomUUID(); }

function stateFor(client: SyntxChatHttpClient, chatInput: unknown): NativeState {
  if (!chatInput || typeof chatInput !== "object" || types.isProxy(chatInput)) fail("CHAT_CONTEXT_INVALID");
  const state = operations.get(chatInput as object);
  if (!state || state.client !== client || state.chat !== chatInput || chatsByClient.get(client)?.get(state.chat.chat_uuid) !== state) fail("CHAT_CONTEXT_INVALID");
  return state;
}

function validateSignal(signal?: AbortSignal): void {
  if (signal !== undefined && (!signal || typeof signal !== "object" || types.isProxy(signal) ||
      !(signal instanceof AbortSignal) || Object.getPrototypeOf(signal) !== AbortSignal.prototype)) fail("INVALID_REQUEST");
}
function aborted(signal?: AbortSignal): boolean { return !!signal && signal.aborted; }
function safeId(value: unknown): value is string { return typeof value === "string" && ID.test(value); }
function normalizeId(value: unknown): string | undefined {
  if (typeof value === "string" && ID.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return undefined;
}
function normalizeChatId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return typeof value === "string" && /^\d{1,16}$/u.test(value) ? value : undefined;
}
function safeFingerprint(value: unknown): value is string { return typeof value === "string" && SHA256.test(value); }

function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const fields = dataRecord(value);
  if (!fields) fail("INVALID_REQUEST");
  const allowed = new Set([...required, ...optional]), keys = Object.keys(fields);
  if (required.some((key) => !Object.hasOwn(fields, key)) || keys.some((key) => !allowed.has(key))) fail("INVALID_REQUEST");
  return fields;
}

function dataRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    if (keys.some((key) => typeof key !== "string" || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) return undefined;
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) output[key] = descriptors[key]!.value;
    return output;
  } catch { return undefined; }
}

function methodOnClient(name: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(SyntxChatHttpClient.prototype, name);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}
function getDataMethod(target: object, key: string): unknown {
  let current: object | null = target;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}
function isNativeLinkService(value: unknown): value is PerUserLinkService {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === PerUserLinkService.prototype &&
    getDataMethod(value, "getStatus") === NATIVE_LINK_STATUS && PerUserLinkService.prototype.getStatus === NATIVE_LINK_STATUS;
}
function isNativeReferenceService(value: unknown): value is OwnerWan27VideoEditReferenceService {
  return isOwnerWan27VideoEditReferenceService(value) && Object.getPrototypeOf(value) === OwnerWan27VideoEditReferenceService.prototype &&
    OwnerWan27VideoEditReferenceService.prototype.resolveReferences === NATIVE_REFERENCE_METHODS.resolve &&
    OwnerWan27VideoEditReferenceService.prototype.isOwnedReferences === NATIVE_REFERENCE_METHODS.guard &&
    OwnerWan27VideoEditReferenceService.prototype.withCapturedReferences === NATIVE_REFERENCE_METHODS.capture &&
    OwnerWan27VideoEditReferenceService.prototype.invalidateAttempt === NATIVE_REFERENCE_METHODS.invalidate &&
    OwnerWan27VideoEditReferenceService.prototype.close === NATIVE_REFERENCE_METHODS.close &&
    ["resolveReferences", "isOwnedReferences", "withCapturedReferences", "invalidateAttempt", "close"]
      .every((name) => getDataMethod(value, name) === getDataMethod(OwnerWan27VideoEditReferenceService.prototype, name));
}
function isNativePreparer(value: unknown): value is OwnerWan27VideoEditRequestPreparer {
  return isOwnerWan27VideoEditRequestPreparer(value) &&
    OwnerWan27VideoEditRequestPreparer.prototype.prepare === NATIVE_PREPARER_METHODS.prepare &&
    OwnerWan27VideoEditRequestPreparer.prototype.inspectCandidate === NATIVE_PREPARER_METHODS.inspect &&
    OwnerWan27VideoEditRequestPreparer.prototype.getPrivateRequest === NATIVE_PREPARER_METHODS.request &&
    OwnerWan27VideoEditRequestPreparer.prototype.revalidateCandidate === NATIVE_PREPARER_METHODS.revalidate &&
    OwnerWan27VideoEditRequestPreparer.prototype.withCapturedReferences === NATIVE_PREPARER_METHODS.capture &&
    OwnerWan27VideoEditRequestPreparer.prototype.isBoundToReferenceService === NATIVE_PREPARER_METHODS.bound &&
    OwnerWan27VideoEditRequestPreparer.prototype.invalidateAttempt === NATIVE_PREPARER_METHODS.invalidate &&
    OwnerWan27VideoEditRequestPreparer.prototype.close === NATIVE_PREPARER_METHODS.close &&
    ["prepare", "inspectCandidate", "getPrivateRequest", "revalidateCandidate", "withCapturedReferences",
      "isBoundToReferenceService", "invalidateAttempt", "close"]
      .every((name) => getDataMethod(value as object, name) === getDataMethod(OwnerWan27VideoEditRequestPreparer.prototype, name));
}
function isExactNativeClient(value: unknown): value is SyntxChatHttpClient {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype) return false;
  return ([
    ["createChat", CLIENT_METHODS.createChat], ["uploadOwnerWan27VideoEditReference", CLIENT_METHODS.upload],
    ["createOwnerWan27VideoEditChat", CLIENT_METHODS.create], ["startOwnerWan27VideoEditWithOwnedCandidate", CLIENT_METHODS.start],
    ["listOwnedWan27VideoEditCandidates", CLIENT_METHODS.list], ["getOwnedWan27VideoEditResult", CLIENT_METHODS.get]
  ] as const).every(([key, method]) => typeof method === "function" && !Object.hasOwn(value, key) &&
    getDataMethod(value, key) === method && getDataMethod(SyntxChatHttpClient.prototype, key) === method);
}

function fail(code: OwnerWan27VideoEditNativeErrorCode): never { throw new OwnerWan27VideoEditNativeError(code); }
