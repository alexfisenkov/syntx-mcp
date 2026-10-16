import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../../auth/owner-reference-principal.js";
import { PerUserLinkService } from "../../auth/link-service.js";
import type { AuthBinding } from "../../auth/types.js";
import type { GenerationPrincipalRef } from "../../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../../domain/generation-principal.js";
import { schemaHash } from "../../domain/generation-contract.js";
import {
  consumeOwnerKling4OneShotPermit,
  revalidateOwnerKling4OneShotPermit,
  type OwnerKling4OneShotPermit
} from "../../application/owner-kling4-one-shot-policy.js";
import {
  isOwnerKling4PreparedCandidate,
  isOwnerKling4RequestPreparer,
  OwnerKling4RequestPreparer,
  type OwnerKling4CandidateBinding,
  type OwnerKling4PreparedCandidate,
  type OwnerKling4SourceMetadata
} from "../../application/owner-kling4-request-preparer.js";
import {
  isOwnerKling4ReferenceService,
  OwnerKling4ReferenceService
} from "../../application/owner-kling4-reference-service.js";
import { getOwnerKling4SourceProfile, type OwnerKling4ParametersModelId } from "../../application/owner-kling4-parameters.js";
import type { OwnerKling4WireCandidate, OwnerKling4WireFile } from "../../application/owner-kling4-wire.js";
import { SyntxChatHttpClient } from "./chat-http-client.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";

const MODEL_IDS = Object.freeze(["kling_4_keyframes", "kling_4_omni"] as const);
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const PAGE_SIZE = 10;
const PAGE_LIMIT = 7;
const MESSAGE_LIMIT = 64;
const OBJECT_LIMIT = 64;
const BOT_AUTHOR_ID = -1;
const CHAT_LIMIT = 128;
const operations = new WeakMap<object, NativeState>();
const chatsByClient = new WeakMap<object, Map<string, NativeState>>();
const resultContexts = new WeakMap<object, ResultState>();
const issuedPermits = new WeakSet<object>();
const pendingPermits = new WeakSet<object>();
const NATIVE_LINK_STATUS = PerUserLinkService.prototype.getStatus;
const NATIVE_REFERENCE_METHODS = Object.freeze({
  resolve: OwnerKling4ReferenceService.prototype.resolveReferences,
  guard: OwnerKling4ReferenceService.prototype.isOwnedReferences,
  capture: OwnerKling4ReferenceService.prototype.withCapturedReferences,
  invalidate: OwnerKling4ReferenceService.prototype.invalidateAttempt,
  close: OwnerKling4ReferenceService.prototype.close
});
const NATIVE_PREPARER_METHODS = Object.freeze({
  prepare: OwnerKling4RequestPreparer.prototype.prepare,
  inspect: OwnerKling4RequestPreparer.prototype.inspectCandidate,
  request: OwnerKling4RequestPreparer.prototype.getPrivateRequest,
  revalidate: OwnerKling4RequestPreparer.prototype.revalidateCandidate,
  capture: OwnerKling4RequestPreparer.prototype.withCapturedReferences,
  bound: OwnerKling4RequestPreparer.prototype.isBoundToReferenceService,
  invalidate: OwnerKling4RequestPreparer.prototype.invalidateAttempt,
  close: OwnerKling4RequestPreparer.prototype.close
});
const CLIENT_METHODS = Object.freeze({
  createChat: SyntxChatHttpClient.prototype.createChat,
  upload: methodOnClient("uploadOwnerKling4Reference"),
  create: methodOnClient("createOwnerKling4Chat"),
  start: methodOnClient("startOwnerKling4WithOwnedCandidate"),
  list: methodOnClient("listOwnedKling4Candidates"),
  get: methodOnClient("getOwnedKling4Result")
});

type CandidateBinding = OwnerKling4CandidateBinding;
type CandidateSource = OwnerKling4SourceMetadata;
type InvocationMethod = "create" | "start" | "list" | "get";

export interface OwnerKling4NativeOperationInput {
  readonly preparer: OwnerKling4RequestPreparer;
  readonly candidate: OwnerKling4PreparedCandidate;
  readonly permit: OwnerKling4OneShotPermit;
  readonly referenceService: OwnerKling4ReferenceService;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly linkService: PerUserLinkService;
  readonly binding: AuthBinding;
}

export interface OwnerKling4NativeChatContext {
  readonly status: "created";
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly model_id: OwnerKling4ParametersModelId;
  readonly profile_sha256: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly sources: readonly CandidateSource[];
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerKling4NativeStartAck { readonly chat_uuid: string; readonly message_id: string; }

export interface OwnerKling4NativeDispatchStatus {
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly model_id: OwnerKling4ParametersModelId;
  readonly phase: "AVAILABLE" | "OUTCOME_UNKNOWN" | "ACKNOWLEDGED";
  readonly dispatch_attempted: boolean;
  readonly owner_ack_bound: boolean;
  readonly owner_echo_message_id: string | null;
}

export type OwnerKling4NativeRequestEchoStatus = "MATCHED" | "ABSENT" | "PARTIAL_UNPROVEN" | "CONTRADICTORY";

export interface OwnerKling4NativeResultContext {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly model_id: OwnerKling4ParametersModelId;
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly string[];
  readonly attempt_id: string;
  readonly profile_sha256: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly owner_echo_message_id: string;
}

export interface OwnerKling4NativeResultCandidates {
  readonly status: "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  readonly request_echo_status: OwnerKling4NativeRequestEchoStatus;
  readonly history_binding_status: "BOUND" | "UNVERIFIED";
  readonly history_page_status: "NOT_READ" | "COMPLETE" | "INCOMPLETE" | "UNPROVEN";
  readonly history_get_calls: number;
  readonly total_count: number | null;
  readonly total_pages: number | null;
  readonly provider_chat_id: string | null;
  readonly owner_echo_message_id: string | null;
  readonly contexts: readonly OwnerKling4NativeResultContext[];
  readonly gaps: readonly string[];
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerKling4NativeVideoArtifact {
  readonly object_index: number;
  readonly message_object_id: string;
  readonly object_type: "video";
  readonly object_url: string;
  readonly mime_type: "video/mp4" | "video/quicktime" | null;
  readonly mime_source: "URL_EXTENSION" | "UNKNOWN";
}

export interface OwnerKling4NativeResult {
  readonly message_binding: "BOUND" | "UNVERIFIED";
  readonly model_echo: "MATCHED" | "UNKNOWN" | "MISMATCH";
  readonly provider_terminal_status: "UNPROVEN";
  readonly artifacts: readonly OwnerKling4NativeVideoArtifact[];
  readonly gaps: readonly string[];
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerKling4NativeResultReadInput {
  readonly result_context: OwnerKling4NativeResultContext;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly linkService: PerUserLinkService;
  readonly binding: AuthBinding;
}

export type OwnerKling4NativeErrorCode =
  | "INVALID_REQUEST" | "CANDIDATE_INVALID" | "CHAT_CREATE_OUTCOME_UNKNOWN" | "CHAT_CONTEXT_INVALID"
  | "CHAT_ALREADY_CREATED" | "CHAT_NOT_DISPATCHED" | "OUTCOME_UNKNOWN" | "HISTORY_UNAVAILABLE"
  | "RESULT_CONTEXT_INVALID" | "RESULT_GET_UNAVAILABLE" | "REQUEST_ABORTED" | "CAPACITY_EXCEEDED"
  | "PRINCIPAL_NOT_LINKED";

export class OwnerKling4NativeError extends Error {
  constructor(readonly code: OwnerKling4NativeErrorCode) {
    super("The owner Kling 4 native operation could not be completed safely.");
    this.name = "OwnerKling4NativeError";
  }
}

type NativePhase = "AVAILABLE" | "OUTCOME_UNKNOWN" | "ACKNOWLEDGED";
interface NativeInput extends OwnerKling4NativeOperationInput {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly binding: Readonly<AuthBinding>;
}
interface NativeInputWithChat extends NativeInput { readonly chat: OwnerKling4NativeChatContext; }
interface WireSnapshot { readonly wire: OwnerKling4WireCandidate; readonly wireHash: string; }
interface NativeState {
  readonly client: SyntxChatHttpClient;
  readonly input: NativeInput;
  readonly auth: NativeInput;
  readonly chat: OwnerKling4NativeChatContext;
  readonly binding: Readonly<CandidateBinding>;
  readonly preDispatchSnapshot: WireSnapshot;
  phase: NativePhase;
  dispatchSnapshot?: WireSnapshot;
  ownerEcho?: string;
  readonly contexts: Map<string, OwnerKling4NativeResultContext>;
}
interface ResultCodec {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly model_id: OwnerKling4ParametersModelId;
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly string[];
}
interface ResultState {
  readonly client: SyntxChatHttpClient;
  readonly state: NativeState;
  readonly context: OwnerKling4NativeResultContext;
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
interface HistoryRow { readonly id: string; readonly chat_id: string; readonly author_id: number; readonly message_object: readonly HistoryObject[]; }
interface HistoryPage {
  readonly messages: readonly HistoryRow[];
  readonly page: number;
  readonly page_size: number;
  readonly total_count: number;
  readonly total_pages: number;
  readonly has_next: boolean;
  readonly has_previous: boolean;
}

/** Creates one private video chat from a current owner-bound K4 candidate. */
export async function createOwnerKling4NativeChat(
  input: unknown, packet: unknown, signal?: AbortSignal
): Promise<OwnerKling4NativeChatContext> {
  const invocation = await consumeInvocation(input, packet, "create");
  const createChat = invocation.callback as (title: string, signal?: AbortSignal) => Promise<{ chat_uuid: string }>;
  let fields: NativeInput;
  try { fields = readOperation(input, false); } catch { fail("INVALID_REQUEST"); }
  if (aborted(signal)) fail("REQUEST_ABORTED");

  let binding: Readonly<CandidateBinding>;
  let snapshot: WireSnapshot;
  try {
    binding = inspectCandidate(fields);
    await assertCurrent(fields, signal);
    await fields.preparer.revalidateCandidate(fields.candidate, signal);
    await assertCurrent(fields, signal);
    await revalidatePermit(fields);
    await assertCurrent(fields, signal);
    binding = inspectCandidate(fields);
    snapshot = captureWire(fields, invocation.client, binding);
    await revalidatePermit(fields);
    await assertCurrent(fields, signal);
    if (captureWire(fields, invocation.client, inspectCandidate(fields)).wireHash !== snapshot.wireHash) fail("CANDIDATE_INVALID");
  } catch (error) {
    if (error instanceof OwnerKling4NativeError) throw error;
    if (aborted(signal)) fail("REQUEST_ABORTED");
    fail("CANDIDATE_INVALID");
  }

  const chats = chatsByClient.get(invocation.client) ?? new Map<string, NativeState>();
  if (chats.size >= CHAT_LIMIT) fail("CAPACITY_EXCEEDED");
  if (issuedPermits.has(fields.permit as object) || pendingPermits.has(fields.permit as object)) fail("CHAT_ALREADY_CREATED");
  pendingPermits.add(fields.permit as object);
  issuedPermits.add(fields.permit as object);
  let receipt: Record<string, unknown>;
  try { receipt = exact(await createChat(`owner-kling4-native-${randomUUID()}`, signal), ["chat_uuid"]); }
  catch { pendingPermits.delete(fields.permit as object); fail("CHAT_CREATE_OUTCOME_UNKNOWN"); }
  pendingPermits.delete(fields.permit as object);
  const chatUuid = receipt!.chat_uuid;
  if (aborted(signal) || !safeId(chatUuid) || chats.has(chatUuid)) fail("CHAT_CREATE_OUTCOME_UNKNOWN");
  try {
    await assertCurrent(fields, signal);
    await fields.preparer.revalidateCandidate(fields.candidate, signal);
    await assertCurrent(fields, signal);
    await revalidatePermit(fields);
    await assertCurrent(fields, signal);
    const latestBinding = inspectCandidate(fields);
    const latestSnapshot = captureWire(fields, invocation.client, latestBinding);
    if (schemaHash(latestBinding) !== schemaHash(binding!) || latestSnapshot.wireHash !== snapshot!.wireHash) fail("CANDIDATE_INVALID");
  } catch { fail("CHAT_CREATE_OUTCOME_UNKNOWN"); }

  const chat: OwnerKling4NativeChatContext = Object.freeze({ status: "created", chat_uuid: chatUuid as string,
    attempt_id: fields.attemptId, model_id: binding!.model_id, profile_sha256: binding!.profile_sha256,
    request_fingerprint: binding!.request_fingerprint, intent_fingerprint: binding!.intent_fingerprint,
    sources: safeSources(binding!.sources), dispatch_allowed: false, backend_acceptance: "UNPROVEN" });
  const state: NativeState = { client: invocation.client, input: fields, auth: fields, chat, binding: binding!,
    preDispatchSnapshot: snapshot!, phase: "AVAILABLE", contexts: new Map() };
  chats.set(chat.chat_uuid, state);
  chatsByClient.set(invocation.client, chats);
  operations.set(chat, state);
  return chat;
}

/** Consumes one nominal K4 permit before the only generation POST. */
export async function startOwnerKling4WithOwnedCandidate(
  input: unknown, packet: unknown, signal?: AbortSignal
): Promise<OwnerKling4NativeStartAck> {
  const invocation = await consumeInvocation(input, packet, "start");
  const start = invocation.callback as (chatUuid: string, body: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
  let fields: NativeInputWithChat;
  try { fields = readOperation(input, true); } catch { fail("INVALID_REQUEST"); }
  const state = stateFor(invocation.client, fields.chat);
  if (!sameOperation(state.input, fields)) fail("CHAT_CONTEXT_INVALID");
  if (state.phase !== "AVAILABLE") fail("CHAT_NOT_DISPATCHED");
  if (aborted(signal)) fail("REQUEST_ABORTED");

  let snapshot: WireSnapshot;
  try {
    inspectCandidate(fields);
    await assertCurrent(state.auth, signal);
    await fields.preparer.revalidateCandidate(fields.candidate, signal);
    await assertCurrent(state.auth, signal);
    const binding = inspectCandidate(fields);
    const current = captureWire(fields, invocation.client, binding);
    if (schemaHash(binding) !== schemaHash(state.binding) || current.wireHash !== state.preDispatchSnapshot.wireHash) fail("CANDIDATE_INVALID");
    snapshot = current;
    await revalidatePermit(fields);
    await assertCurrent(state.auth, signal);
    if (schemaHash(captureWire(fields, invocation.client, inspectCandidate(fields))) !== schemaHash(snapshot)) fail("CANDIDATE_INVALID");
    consumePermit(fields);
    state.dispatchSnapshot = snapshot;
    state.phase = "OUTCOME_UNKNOWN";
  } catch (error) {
    if (error instanceof OwnerKling4NativeError) throw error;
    if (aborted(signal)) fail("REQUEST_ABORTED");
    fail("CANDIDATE_INVALID");
  }

  const body = Object.freeze({ chat_id: state.chat.chat_uuid, prompt: snapshot!.wire.prompt, settings: snapshot!.wire.settings });
  try {
    const rawAck = await start(state.chat.chat_uuid, body, signal);
    const ack = exact(rawAck, ["chat_uuid", "message_id"]);
    if (aborted(signal) || ack.chat_uuid !== state.chat.chat_uuid || !safeId(ack.message_id)) fail("OUTCOME_UNKNOWN");
    await assertCurrent(state.auth, signal);
    if (state.dispatchSnapshot !== snapshot || state.dispatchSnapshot.wireHash !== state.preDispatchSnapshot.wireHash) fail("OUTCOME_UNKNOWN");
    state.ownerEcho = ack.message_id as string;
    state.phase = "ACKNOWLEDGED";
    return Object.freeze({ chat_uuid: ack.chat_uuid as string, message_id: ack.message_id as string });
  } catch { state.phase = "OUTCOME_UNKNOWN"; fail("OUTCOME_UNKNOWN"); }
}

/** Reads bounded owner history after dispatch; expired input references are not needed for GET. */
export async function listOwnerKling4NativeCandidates(
  input: unknown, packet: unknown, signal?: AbortSignal
): Promise<OwnerKling4NativeResultCandidates> {
  const invocation = await consumeInvocation(input, packet, "list");
  const getPage = invocation.callback as (chatUuid: string, page: number, pageSize: number, signal?: AbortSignal) => Promise<unknown>;
  let fields: NativeInputWithChat;
  try { fields = readOperation(input, true); } catch { fail("INVALID_REQUEST"); }
  const state = stateFor(invocation.client, fields.chat);
  if (!sameOperation(state.input, fields)) fail("CHAT_CONTEXT_INVALID");
  if (aborted(signal)) fail("REQUEST_ABORTED");
  await assertCurrent(state.auth, signal);
  if (state.phase !== "ACKNOWLEDGED" || !state.dispatchSnapshot || !state.ownerEcho) {
    return emptyCandidates("UNVERIFIED", "MISSING", "ABSENT", "NOT_READ", 0, "POST_ACK_UNAVAILABLE");
  }

  const rows: HistoryRow[] = [];
  const messageIds = new Set<string>(), objectIds = new Set<string>();
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
      totalCount ??= parsed.total_count;
      totalPages ??= parsed.total_pages;
      if (parsed.total_count !== totalCount || parsed.total_pages !== totalPages || page > parsed.total_pages) {
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
      if (page === parsed.total_pages) break;
      if (page === PAGE_LIMIT) return emptyCandidates("UNVERIFIED", "MISSING", "ABSENT", "INCOMPLETE", calls, "HISTORY_PAGE_LIMIT_EXCEEDED");
    }
  } catch {
    if (aborted(signal)) fail("REQUEST_ABORTED");
    return emptyCandidates("UNVERIFIED", "MISSING", "ABSENT", "INCOMPLETE", calls, "HISTORY_UNAVAILABLE");
  }

  if (totalCount === undefined || totalPages === undefined || rows.length !== totalCount || providerChatId === undefined) {
    return emptyCandidates("UNVERIFIED", "MISSING", "ABSENT", "INCOMPLETE", calls, "HISTORY_INCOMPLETE");
  }
  const ackRows = rows.filter((row) => row.id === state.ownerEcho && row.author_id > 0);
  if (ackRows.length !== 1) {
    return Object.freeze({ ...emptyCandidates("INCOMPLETE", ackRows.length > 1 ? "AMBIGUOUS" : "MISSING", "ABSENT", "COMPLETE", calls,
      ackRows.length > 1 ? "OWNER_ACK_AMBIGUOUS" : "OWNER_ACK_MISSING"), total_count: totalCount, total_pages: totalPages,
      provider_chat_id: providerChatId, owner_echo_message_id: state.ownerEcho });
  }
  const otherOwnerRows = rows.filter((row) => row.author_id > 0 && row.id !== state.ownerEcho && row.message_object.length > 0);
  if (otherOwnerRows.length > 0) {
    return Object.freeze({ ...emptyCandidates("UNVERIFIED", "MATCHED", "PARTIAL_UNPROVEN", "COMPLETE", calls,
      "HISTORY_ADDITIONAL_OWNER_REQUEST"), total_count: totalCount, total_pages: totalPages,
      provider_chat_id: providerChatId, owner_echo_message_id: state.ownerEcho });
  }
  const echo = inspectRequestEcho(ackRows[0]!, state.dispatchSnapshot.wire);
  if (echo === "ABSENT" || echo === "CONTRADICTORY") {
    return Object.freeze({ ...emptyCandidates("UNVERIFIED", "MATCHED", echo, "COMPLETE", calls,
      echo === "CONTRADICTORY" ? "OWNER_REQUEST_ECHO_CONTRADICTORY" : "OWNER_REQUEST_ECHO_UNPROVEN"),
      total_count: totalCount, total_pages: totalPages, provider_chat_id: providerChatId, owner_echo_message_id: state.ownerEcho });
  }

  const found: Array<Readonly<{ context: OwnerKling4NativeResultContext; codec: ResultCodec }>> = [];
  const gaps: string[] = [];
  let videoCount = 0;
  for (const row of rows) {
    if (row.author_id !== BOT_AUTHOR_ID) continue;
    const videos = row.message_object.filter((object) => object.object_type === "video");
    if (videos.length === 0) continue;
    if (videos.length > OBJECT_LIMIT || videos.some((video) => video.model_type !== state.chat.model_id || video.completed !== true ||
        typeof video.object_url !== "string" || !isSafeUploadReferenceUrl(video.object_url))) {
      gaps.push("BOT_VIDEO_MODEL_COMPLETION_OR_OBJECT_MISMATCH");
      continue;
    }
    if (videoCount + videos.length > OBJECT_LIMIT) { gaps.push("RESULT_VIDEO_LIMIT_EXCEEDED"); continue; }
    videoCount += videos.length;
    const messageObjectIds = Object.freeze(videos.map((video) => video.id));
    const codec: ResultCodec = Object.freeze({ chat_uuid: state.chat.chat_uuid, message_id: row.id,
      model_id: state.chat.model_id, provider_chat_id: providerChatId, message_object_ids: messageObjectIds });
    const context: OwnerKling4NativeResultContext = Object.freeze({ ...codec, attempt_id: state.chat.attempt_id,
      profile_sha256: state.chat.profile_sha256, request_fingerprint: state.chat.request_fingerprint,
      intent_fingerprint: state.chat.intent_fingerprint, owner_echo_message_id: state.ownerEcho });
    const previous = state.contexts.get(row.id);
    if (previous && schemaHash(previous) !== schemaHash(context)) {
      return emptyCandidates("UNVERIFIED", "MATCHED", echo, "UNPROVEN", calls, "RESULT_CONTEXT_MISMATCH");
    }
    found.push(Object.freeze({ context: previous ?? context, codec }));
  }
  if (gaps.length > 0) {
    return Object.freeze({ ...emptyCandidates("UNVERIFIED", "MATCHED", echo, "COMPLETE", calls, gaps[0]!),
      total_count: totalCount, total_pages: totalPages, provider_chat_id: providerChatId,
      owner_echo_message_id: state.ownerEcho, gaps: Object.freeze(gaps) });
  }
  const contexts = found.map(({ context, codec }) => {
    if (!state.contexts.has(context.message_id)) {
      resultContexts.set(context, { client: invocation.client, state, context, codec });
      state.contexts.set(context.message_id, context);
    }
    return state.contexts.get(context.message_id)!;
  });
  return Object.freeze({ status: contexts.length ? "COMPLETE" : "PENDING", owner_ack_status: "MATCHED", request_echo_status: echo,
    history_binding_status: "BOUND", history_page_status: "COMPLETE", history_get_calls: calls,
    total_count: totalCount, total_pages: totalPages, provider_chat_id: providerChatId,
    owner_echo_message_id: state.ownerEcho, contexts: Object.freeze(contexts),
    gaps: Object.freeze(contexts.length ? [] : ["BOT_RESULT_NOT_OBSERVED"]), backend_acceptance: "UNPROVEN" });
}

/** Retrieves only a nominal result context; input-reference expiry does not gate this GET. */
export async function getOwnerKling4NativeResult(
  input: unknown, packet: unknown, signal?: AbortSignal
): Promise<OwnerKling4NativeResult> {
  const invocation = await consumeInvocation(input, packet, "get");
  const getMessage = invocation.callback as (chatUuid: string, messageId: string, signal?: AbortSignal) => Promise<unknown>;
  let fields: Readonly<OwnerKling4NativeResultReadInput & { readonly principal: Readonly<GenerationPrincipalRef>; readonly binding: Readonly<AuthBinding> }>;
  try { fields = readResultReadInput(input); } catch { fail("RESULT_CONTEXT_INVALID"); }
  const owned = resultContexts.get(fields.result_context as object);
  if (!owned || owned.client !== invocation.client || owned.context !== fields.result_context || owned.state.phase !== "ACKNOWLEDGED" ||
      owned.state.ownerEcho !== owned.context.owner_echo_message_id || operations.get(owned.state.chat) !== owned.state ||
      owned.state.chat.attempt_id !== fields.attemptId || owned.state.chat.model_id !== owned.context.model_id ||
      owned.state.chat.intent_fingerprint !== owned.context.intent_fingerprint || owned.state.client !== invocation.client ||
      !sameGenerationPrincipal(fields.principal, owned.state.auth.principal) || !sameBinding(fields.binding, owned.state.auth.binding) ||
      fields.linkService !== owned.state.auth.linkService || owned.state.chat.profile_sha256 !== owned.context.profile_sha256) fail("RESULT_CONTEXT_INVALID");
  if (aborted(signal)) fail("REQUEST_ABORTED");
  await assertCurrent(owned.state.auth, signal);
  try {
    let raw: unknown;
    try { raw = await getMessage(owned.codec.chat_uuid, owned.codec.message_id, signal); }
    finally { await assertCurrent(owned.state.auth, signal); }
    return decodeResult(raw, owned.codec);
  } catch { if (aborted(signal)) fail("REQUEST_ABORTED"); fail("RESULT_GET_UNAVAILABLE"); }
}

export function readOwnerKling4NativeDispatchStatus(client: unknown, chatInput: unknown): OwnerKling4NativeDispatchStatus | null {
  if (!isExactNativeClient(client) || !chatInput || typeof chatInput !== "object" || types.isProxy(chatInput)) return null;
  const state = operations.get(chatInput as object);
  if (!state || state.client !== client || state.chat !== chatInput || chatsByClient.get(state.client)?.get(state.chat.chat_uuid) !== state) return null;
  return Object.freeze({ chat_uuid: state.chat.chat_uuid, attempt_id: state.chat.attempt_id, model_id: state.chat.model_id,
    phase: state.phase, dispatch_attempted: state.phase !== "AVAILABLE", owner_ack_bound: state.phase === "ACKNOWLEDGED" && !!state.ownerEcho,
    owner_echo_message_id: state.phase === "ACKNOWLEDGED" ? state.ownerEcho ?? null : null });
}

function inspectCandidate(fields: NativeInput): Readonly<CandidateBinding> {
  if (!isOwnerKling4RequestPreparer(fields.preparer) || !isOwnerKling4PreparedCandidate(fields.candidate)) fail("CANDIDATE_INVALID");
  const binding = fields.preparer.inspectCandidate(fields.candidate);
  if (!binding || !isModelId(binding.model_id) || binding.attempt_id !== fields.attemptId ||
      !sameGenerationPrincipal(binding.principal, fields.principal) || !validateSourceProfile(binding) ||
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
      captured = snapshotWire(wire);
      return captured;
    });
    if (!captured || returned !== captured) fail("CANDIDATE_INVALID");
  } catch { fail("CANDIDATE_INVALID"); }
  if (captured!.wire.profile_sha256 !== binding.profile_sha256 || captured!.wire.wire_fingerprint !== request.wire_fingerprint) fail("CANDIDATE_INVALID");
  return captured!;
}

function validWire(value: unknown, binding: Readonly<CandidateBinding>): value is OwnerKling4WireCandidate {
  try {
    const wire = exact(value, ["status", "profile_sha256", "ai_name", "prompt", "settings", "cost_parameters",
      "input_reference_count", "wire_reference_count", "wire_fingerprint", "intent_fingerprint", "runtime_usable",
      "dispatch_allowed", "provider_acceptance", "generation_permit"]);
    if (wire.status !== "SOURCE_ONLY_KLING4_WIRE_CANDIDATE" || wire.profile_sha256 !== binding.profile_sha256 ||
        wire.ai_name !== "kling" || typeof wire.prompt !== "string" || !isWellFormedUnicode(wire.prompt) ||
        !safeFingerprint(wire.wire_fingerprint) || !safeFingerprint(wire.intent_fingerprint) ||
        wire.intent_fingerprint !== binding.intent_fingerprint ||
        wire.input_reference_count !== binding.sources.length || !nonnegativeInt(wire.input_reference_count, 15) ||
        wire.runtime_usable !== false || wire.dispatch_allowed !== false || wire.generation_permit !== false ||
        wire.provider_acceptance !== "UNPROVEN") return false;
    const modelId = binding.model_id;
    const settings = exact(wire.settings, ["model_type", "version", "mode", "aspect_ratio", "video_duration", "native_audio", "file_urls"]);
    if (settings.model_type !== modelId || settings.version !== "4.0" || !["standart", "hd"].includes(String(settings.mode)) ||
        !["16:9", "1:1", "9:16", "21:9"].includes(String(settings.aspect_ratio)) ||
        !Number.isSafeInteger(settings.video_duration) || Number(settings.video_duration) < 3 || Number(settings.video_duration) > 30 ||
        typeof settings.native_audio !== "boolean" || (modelId === "kling_4_keyframes" && settings.native_audio !== true) ||
        !Array.isArray(settings.file_urls) || types.isProxy(settings.file_urls) || !Object.isFrozen(settings.file_urls) ||
        settings.file_urls.length > 15 || settings.file_urls.length !== wire.wire_reference_count || !nonnegativeInt(wire.wire_reference_count, 15)) return false;
    const files: OwnerKling4WireFile[] = [];
    for (const raw of settings.file_urls) {
      const file = exact(raw, ["type", "url"]);
      if ((file.type !== "image" && file.type !== "video") || typeof file.url !== "string" || !isSafeUploadReferenceUrl(file.url)) return false;
      files.push(Object.freeze({ type: file.type, url: file.url }));
    }
    if (new Set(files.map((file) => JSON.stringify([file.type, file.url]))).size !== files.length) return false;
    if (modelId === "kling_4_keyframes") {
      if (binding.sources.some((source) => source.kind !== "image") ||
          binding.sources.length > Math.min(Number(settings.video_duration) + 1, 10) || files.some((file) => file.type !== "image")) return false;
    } else {
      const images = binding.sources.filter((source) => source.kind === "image").length;
      const videos = binding.sources.filter((source) => source.kind === "video");
      const duration = videos.reduce((sum, source) => sum + (source.input_cost_duration_seconds ?? Number.NaN), 0);
      if (images > 10 || videos.length > 5 || !Number.isFinite(duration) || duration > 30) return false;
    }
    const cost = exact(wire.cost_parameters, modelId === "kling_4_keyframes"
      ? ["mode", "version", "video_duration"] : ["duration", "mode", "version", "video_duration"]);
    if (cost.mode !== settings.mode || cost.version !== settings.version || cost.video_duration !== settings.video_duration ||
        schemaHash(cost) !== schemaHash(binding.cost_parameters)) return false;
    if (modelId === "kling_4_omni") {
      const videoCost = binding.sources.filter((source) => source.kind === "video")
        .reduce((sum, source) => sum + (source.input_cost_duration_seconds ?? 0), 0);
      const expectedDuration = videoCost === 0 ? 0 : videoCost.toFixed(2);
      if (cost.duration !== expectedDuration) return false;
    }
    return wire.wire_fingerprint === fingerprintWire(wire as unknown as OwnerKling4WireCandidate, Object.freeze(files));
  } catch { return false; }
}

function snapshotWire(wire: OwnerKling4WireCandidate): WireSnapshot {
  const fileUrls = Object.freeze(wire.settings.file_urls.map((file) => Object.freeze({ type: file.type, url: file.url })));
  const settings = Object.freeze({ model_type: wire.settings.model_type, version: wire.settings.version, mode: wire.settings.mode,
    aspect_ratio: wire.settings.aspect_ratio, video_duration: wire.settings.video_duration, native_audio: wire.settings.native_audio,
    file_urls: fileUrls });
  const cost = Object.freeze({ ...wire.cost_parameters });
  const snapshot: OwnerKling4WireCandidate = Object.freeze({ status: wire.status, profile_sha256: wire.profile_sha256,
    ai_name: wire.ai_name, prompt: wire.prompt, settings, cost_parameters: cost, input_reference_count: wire.input_reference_count,
    wire_reference_count: wire.wire_reference_count, wire_fingerprint: wire.wire_fingerprint,
    intent_fingerprint: wire.intent_fingerprint, runtime_usable: false, dispatch_allowed: false,
    provider_acceptance: "UNPROVEN", generation_permit: false });
  return Object.freeze({ wire: snapshot, wireHash: schemaHash(snapshot) });
}

function fingerprintWire(wire: OwnerKling4WireCandidate, files: readonly OwnerKling4WireFile[]): string {
  const layout = ["owner-kling4-reference-wire-v1", wire.profile_sha256,
    { ai_name: wire.ai_name, prompt: wire.prompt, settings: { ...wire.settings, file_urls: files } }, wire.cost_parameters];
  return `sha256:${createHash("sha256").update(JSON.stringify(layout), "utf8").digest("hex")}`;
}

function validateSourceProfile(binding: Readonly<CandidateBinding>): boolean {
  if (!isModelId(binding.model_id) || getOwnerKling4SourceProfile(binding.model_id).source_sha256 !== binding.profile_sha256 ||
      !Array.isArray(binding.sources) || types.isProxy(binding.sources) || binding.sources.length > 15) return false;
  let images = 0, videos = 0, totalCost = 0;
  for (const source of binding.sources) {
    if (!source || typeof source !== "object" || types.isProxy(source) ||
        typeof source.reference_handle !== "string" || !/^kling4_reference_[0-9a-f-]{36}$/u.test(source.reference_handle) ||
        (source.kind !== "image" && source.kind !== "video") || !/^[a-f0-9]{64}$/u.test(source.sha256)) return false;
    if (source.kind === "image") {
      images += 1;
      if (source.duration_seconds !== null || source.input_cost_duration_seconds !== null) return false;
    } else {
      videos += 1;
      if (binding.model_id !== "kling_4_omni" || typeof source.duration_seconds !== "number" || !Number.isFinite(source.duration_seconds) ||
          source.duration_seconds < 3 || source.duration_seconds > 30 || typeof source.input_cost_duration_seconds !== "number" ||
          !Number.isFinite(source.input_cost_duration_seconds) || source.input_cost_duration_seconds < 3 || source.input_cost_duration_seconds > 30) return false;
      totalCost += source.input_cost_duration_seconds;
    }
  }
  if (binding.model_id === "kling_4_keyframes") return videos === 0 && images === binding.sources.length;
  return images <= 10 && videos <= 5 && Number.isFinite(totalCost) && totalCost <= 30;
}

function safeSources(sources: readonly CandidateSource[]): readonly CandidateSource[] {
  if (!Array.isArray(sources) || types.isProxy(sources) || !Object.isFrozen(sources)) fail("CANDIDATE_INVALID");
  return Object.freeze(sources.map((source) => {
    const fields = exact(source, ["reference_handle", "kind", "mime_type", "size", "sha256", "width", "height",
      "duration_seconds", "input_cost_duration_seconds"]);
    if (typeof fields.reference_handle !== "string" || !/^kling4_reference_[0-9a-f-]{36}$/u.test(fields.reference_handle) ||
        (fields.kind !== "image" && fields.kind !== "video") || typeof fields.mime_type !== "string" ||
        typeof fields.size !== "number" || !Number.isSafeInteger(fields.size) || fields.size < 1 ||
        typeof fields.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(fields.sha256)) fail("CANDIDATE_INVALID");
    return Object.freeze({ ...fields }) as unknown as CandidateSource;
  }));
}

async function revalidatePermit(fields: NativeInput): Promise<void> {
  await revalidateOwnerKling4OneShotPermit({ permit: fields.permit, preparer: fields.preparer,
    candidate: fields.candidate, principal: fields.principal, attemptId: fields.attemptId });
}

function consumePermit(fields: NativeInput): void {
  consumeOwnerKling4OneShotPermit({ permit: fields.permit, preparer: fields.preparer,
    candidate: fields.candidate, principal: fields.principal, attemptId: fields.attemptId });
}

async function assertCurrent(fields: NativeInput, signal?: AbortSignal): Promise<void> {
  if (signal !== undefined && (!signal || types.isProxy(signal) || !(signal instanceof AbortSignal) || Object.getPrototypeOf(signal) !== AbortSignal.prototype)) {
    fail("INVALID_REQUEST");
  }
  if (aborted(signal)) fail("REQUEST_ABORTED");
  if (!isNativeLinkService(fields.linkService)) fail("CANDIDATE_INVALID");
  try {
    const current = await resolveOwnerReferencePrincipal({ binding: fields.binding, attemptId: fields.attemptId, linkService: fields.linkService });
    if (!sameGenerationPrincipal(current, fields.principal) || aborted(signal)) {
      fail(aborted(signal) ? "REQUEST_ABORTED" : "PRINCIPAL_NOT_LINKED");
    }
  } catch (error) {
    if (error instanceof OwnerKling4NativeError) throw error;
    if (aborted(signal)) fail("REQUEST_ABORTED");
    if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
    fail("PRINCIPAL_NOT_LINKED");
  }
}

async function consumeInvocation(input: unknown, packet: unknown, method: InvocationMethod): Promise<Invocation> {
  try {
    const native = await import("./chat-http-client.js") as unknown as {
      consumeOwnerKling4NativeInvocation(value: unknown, token: unknown, kind: InvocationMethod): Invocation;
    };
    const value = Reflect.apply(native.consumeOwnerKling4NativeInvocation, undefined, [input, packet, method]);
    if (!value || typeof value !== "object" || types.isProxy(value)) fail("INVALID_REQUEST");
    const fields = exact(value, ["client", "callback"]);
    if (!isExactNativeClient(fields.client) || typeof fields.callback !== "function" || types.isProxy(fields.callback)) fail("INVALID_REQUEST");
    return Object.freeze({ client: fields.client, callback: fields.callback });
  } catch { fail("INVALID_REQUEST"); }
}

function stateFor(client: SyntxChatHttpClient, chatValue: unknown): NativeState {
  if (!chatValue || typeof chatValue !== "object" || types.isProxy(chatValue)) fail("CHAT_CONTEXT_INVALID");
  const state = operations.get(chatValue as object);
  if (!state || state.client !== client || state.chat !== chatValue || chatsByClient.get(client)?.get(state.chat.chat_uuid) !== state) fail("CHAT_CONTEXT_INVALID");
  return state;
}

function readOperation(value: unknown, withChat: false): NativeInput;
function readOperation(value: unknown, withChat: true): NativeInputWithChat;
function readOperation(value: unknown, withChat: boolean): NativeInput | NativeInputWithChat {
  const fields = exact(value, ["preparer", "candidate", "permit", "referenceService", "principal", "attemptId", "linkService", "binding",
    ...(withChat ? ["chat"] : [])]);
  if (typeof fields.attemptId !== "string" || !isExactMatch(ATTEMPT, fields.attemptId) ||
      !fields.candidate || typeof fields.candidate !== "object" || types.isProxy(fields.candidate) ||
      !fields.permit || typeof fields.permit !== "object" || types.isProxy(fields.permit)) fail("INVALID_REQUEST");
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); } catch { fail("INVALID_REQUEST"); }
  const binding = exact(fields.binding, ["tenant_id", "subject"]);
  if (typeof binding.tenant_id !== "string" || typeof binding.subject !== "string" || principal.connection_id !== fields.attemptId) fail("INVALID_REQUEST");
  if (!isNativeReferenceService(fields.referenceService) || !isNativePreparer(fields.preparer) ||
      !fields.preparer.isBoundToReferenceService(fields.referenceService)) fail("INVALID_REQUEST");
  if (!isNativeLinkService(fields.linkService)) fail("INVALID_REQUEST");
  const common: NativeInput = Object.freeze({ preparer: fields.preparer,
    candidate: fields.candidate as OwnerKling4PreparedCandidate, permit: fields.permit as OwnerKling4OneShotPermit,
    referenceService: fields.referenceService, principal, attemptId: fields.attemptId,
    linkService: fields.linkService, binding: Object.freeze({ tenant_id: binding.tenant_id, subject: binding.subject }) });
  if (!withChat) return common;
  if (!fields.chat || typeof fields.chat !== "object" || types.isProxy(fields.chat)) fail("INVALID_REQUEST");
  return Object.freeze({ ...common, chat: fields.chat as OwnerKling4NativeChatContext });
}

function readResultReadInput(value: unknown): Readonly<OwnerKling4NativeResultReadInput & {
  readonly principal: Readonly<GenerationPrincipalRef>; readonly binding: Readonly<AuthBinding>
}> {
  const fields = exact(value, ["result_context", "principal", "attemptId", "linkService", "binding"]);
  if (typeof fields.attemptId !== "string" || !isExactMatch(ATTEMPT, fields.attemptId) ||
      !fields.result_context || typeof fields.result_context !== "object" || types.isProxy(fields.result_context)) fail("RESULT_CONTEXT_INVALID");
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); } catch { fail("RESULT_CONTEXT_INVALID"); }
  const binding = exact(fields.binding, ["tenant_id", "subject"]);
  if (typeof binding.tenant_id !== "string" || typeof binding.subject !== "string" || principal.connection_id !== fields.attemptId ||
      !isNativeLinkService(fields.linkService)) fail("RESULT_CONTEXT_INVALID");
  return Object.freeze({ result_context: fields.result_context as OwnerKling4NativeResultContext, principal,
    attemptId: fields.attemptId, linkService: fields.linkService,
    binding: Object.freeze({ tenant_id: binding.tenant_id, subject: binding.subject }) });
}

function sameOperation(a: NativeInput, b: NativeInputWithChat): boolean {
  return a.preparer === b.preparer && a.candidate === b.candidate && a.permit === b.permit &&
    a.referenceService === b.referenceService && a.attemptId === b.attemptId && a.linkService === b.linkService &&
    sameGenerationPrincipal(a.principal, b.principal) && sameBinding(a.binding, b.binding);
}

function sameBinding(a: AuthBinding, b: AuthBinding): boolean { return a.tenant_id === b.tenant_id && a.subject === b.subject; }

function inspectRequestEcho(row: HistoryRow, wire: OwnerKling4WireCandidate): OwnerKling4NativeRequestEchoStatus {
  const modelId = wire.settings.model_type;
  const textObjects = row.message_object.filter((object) => object.object_type === "text");
  if (textObjects.length > 1 || textObjects.some((object) => object.object_text !== wire.prompt)) return "CONTRADICTORY";
  const expected = wire.settings.file_urls;
  const observed: OwnerKling4WireFile[] = [];
  const observedKeys = new Set<string>();
  let sawEvidence = textObjects.length > 0;
  let fullyTyped = true;
  for (const object of row.message_object) {
    if (object.model_type != null && object.model_type !== modelId) return "CONTRADICTORY";
    if (object.object_type !== "image" && object.object_type !== "video") {
      if (object.object_type === "audio") return "CONTRADICTORY";
      continue;
    }
    sawEvidence = true;
    if (typeof object.object_url !== "string") { fullyTyped = false; continue; }
    if (!isSafeUploadReferenceUrl(object.object_url)) return "CONTRADICTORY";
    const key = JSON.stringify([object.object_type, object.object_url]);
    if (!expected.some((file) => file.type === object.object_type && file.url === object.object_url) || observedKeys.has(key)) return "CONTRADICTORY";
    observedKeys.add(key);
    observed.push(Object.freeze({ type: object.object_type, url: object.object_url }));
    if (object.model_type !== modelId) fullyTyped = false;
  }
  if (!sawEvidence) return "ABSENT";
  if (observed.length === expected.length && observed.some((file, index) =>
    file.type !== expected[index]?.type || file.url !== expected[index]?.url)) return "CONTRADICTORY";
  if (textObjects.length === 1 && observed.length === expected.length && fullyTyped) return "MATCHED";
  return "PARTIAL_UNPROVEN";
}

function decodeResult(raw: unknown, expected: ResultCodec): OwnerKling4NativeResult {
  try {
    const message = dataRecord(raw);
    if (!message || normalizeId(message.id) !== expected.message_id || message.author_id !== BOT_AUTHOR_ID ||
        normalizeChatId(message.chat_id) !== expected.provider_chat_id) return resultGap("UNVERIFIED", "MISMATCH", "MESSAGE_BINDING_MISMATCH");
    if (!Array.isArray(message.message_object) || types.isProxy(message.message_object) || message.message_object.length > OBJECT_LIMIT) {
      return resultGap("BOUND", "UNKNOWN", "MESSAGE_OBJECT_ARRAY_INVALID");
    }
    const artifacts: OwnerKling4NativeVideoArtifact[] = [], gaps: string[] = [], seenObjects = new Set<string>();
    const expectedIds = new Set(expected.message_object_ids);
    const seenExpectedVideos = new Set<string>();
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
      seenExpectedVideos.add(objectId);
      sawVideo = true;
      if (item.model_type !== expected.model_id) {
        if (item.model_type === undefined || item.model_type === null) {
          modelMissing = true;
          gaps.push("MODEL_ECHO_MISSING");
        } else {
          modelMismatch = true;
          gaps.push("MODEL_ECHO_MISMATCH");
        }
        continue;
      }
      if (item.completed !== true || typeof item.object_url !== "string" || !isSafeUploadReferenceUrl(item.object_url)) {
        gaps.push("VIDEO_COMPLETION_OR_URL_UNPROVEN");
        continue;
      }
      const mime = safeVideoMime(item.object_url);
      artifacts.push(Object.freeze({ object_index: index, message_object_id: objectId, object_type: "video",
        object_url: item.object_url, mime_type: mime, mime_source: mime === null ? "UNKNOWN" : "URL_EXTENSION" }));
    }
    if (seenExpectedVideos.size !== expectedIds.size) gaps.push("EXPECTED_RESULT_OBJECT_MISSING");
    const modelEcho: OwnerKling4NativeResult["model_echo"] = modelMismatch ? "MISMATCH" : modelMissing || !sawVideo ? "UNKNOWN" : "MATCHED";
    const bound = artifacts.length > 0 && gaps.length === 0 && seenExpectedVideos.size === expectedIds.size && modelEcho === "MATCHED";
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

function emptyCandidates(
  status: OwnerKling4NativeResultCandidates["status"],
  owner: OwnerKling4NativeResultCandidates["owner_ack_status"],
  echo: OwnerKling4NativeRequestEchoStatus,
  page: OwnerKling4NativeResultCandidates["history_page_status"],
  calls: number,
  gap: string
): OwnerKling4NativeResultCandidates {
  return Object.freeze({ status, owner_ack_status: owner, request_echo_status: echo, history_binding_status: "UNVERIFIED",
    history_page_status: page, history_get_calls: calls, total_count: null, total_pages: null, provider_chat_id: null,
    owner_echo_message_id: null, contexts: Object.freeze([]), gaps: Object.freeze([gap]), backend_acceptance: "UNPROVEN" });
}

function resultGap(
  binding: OwnerKling4NativeResult["message_binding"],
  model: OwnerKling4NativeResult["model_echo"],
  gap: string
): OwnerKling4NativeResult {
  return Object.freeze({ message_binding: binding, model_echo: model, provider_terminal_status: "UNPROVEN",
    artifacts: Object.freeze([]), gaps: Object.freeze([gap]), backend_acceptance: "UNPROVEN" });
}

function safeVideoMime(url: string): OwnerKling4NativeVideoArtifact["mime_type"] {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith(".mp4")) return "video/mp4";
    if (path.endsWith(".mov")) return "video/quicktime";
  } catch { return null; }
  return null;
}

function safeId(value: unknown): value is string { return typeof value === "string" && ID.test(value); }
function isExactMatch(pattern: RegExp, value: string): boolean { const match = pattern.exec(value); return match?.[0] === value; }
function normalizeId(value: unknown): string | undefined {
  const id = typeof value === "string" ? value : typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined;
  return id && ID.test(id) ? id : undefined;
}
function normalizeChatId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return typeof value === "string" && /^\d{1,16}$/u.test(value) ? value : undefined;
}
function isModelId(value: unknown): value is OwnerKling4ParametersModelId {
  return typeof value === "string" && MODEL_IDS.includes(value as OwnerKling4ParametersModelId);
}
function safeFingerprint(value: unknown): value is string { return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value); }
function nonnegativeInt(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}
function aborted(signal?: AbortSignal): boolean { return !!signal && (types.isProxy(signal) || !(signal instanceof AbortSignal) || signal.aborted); }

function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const fields = dataRecord(value);
  if (!fields) fail("INVALID_REQUEST");
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(fields);
  if (required.some((key) => !Object.hasOwn(fields, key)) || keys.some((key) => !allowed.has(key))) fail("INVALID_REQUEST");
  return fields;
}

function dataRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    if (keys.some((key) => typeof key !== "string" || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) return undefined;
    const out = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) out[key] = descriptors[key]!.value;
    return out;
  } catch { return undefined; }
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const current = value.charCodeAt(index);
    if (current >= 0xd800 && current <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (current >= 0xdc00 && current <= 0xdfff) return false;
  }
  return true;
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

function isNativeReferenceService(value: unknown): value is OwnerKling4ReferenceService {
  return isOwnerKling4ReferenceService(value) && Object.getPrototypeOf(value) === OwnerKling4ReferenceService.prototype &&
    OwnerKling4ReferenceService.prototype.resolveReferences === NATIVE_REFERENCE_METHODS.resolve &&
    OwnerKling4ReferenceService.prototype.isOwnedReferences === NATIVE_REFERENCE_METHODS.guard &&
    OwnerKling4ReferenceService.prototype.withCapturedReferences === NATIVE_REFERENCE_METHODS.capture &&
    OwnerKling4ReferenceService.prototype.invalidateAttempt === NATIVE_REFERENCE_METHODS.invalidate &&
    OwnerKling4ReferenceService.prototype.close === NATIVE_REFERENCE_METHODS.close &&
    ["resolveReferences", "isOwnedReferences", "withCapturedReferences", "invalidateAttempt", "close"]
      .every((key) => getDataMethod(value as object, key) === getDataMethod(OwnerKling4ReferenceService.prototype, key));
}

function isNativePreparer(value: unknown): value is OwnerKling4RequestPreparer {
  return isOwnerKling4RequestPreparer(value) &&
    OwnerKling4RequestPreparer.prototype.prepare === NATIVE_PREPARER_METHODS.prepare &&
    OwnerKling4RequestPreparer.prototype.inspectCandidate === NATIVE_PREPARER_METHODS.inspect &&
    OwnerKling4RequestPreparer.prototype.getPrivateRequest === NATIVE_PREPARER_METHODS.request &&
    OwnerKling4RequestPreparer.prototype.revalidateCandidate === NATIVE_PREPARER_METHODS.revalidate &&
    OwnerKling4RequestPreparer.prototype.withCapturedReferences === NATIVE_PREPARER_METHODS.capture &&
    OwnerKling4RequestPreparer.prototype.isBoundToReferenceService === NATIVE_PREPARER_METHODS.bound &&
    OwnerKling4RequestPreparer.prototype.invalidateAttempt === NATIVE_PREPARER_METHODS.invalidate &&
    OwnerKling4RequestPreparer.prototype.close === NATIVE_PREPARER_METHODS.close &&
    ["prepare", "inspectCandidate", "getPrivateRequest", "revalidateCandidate", "withCapturedReferences",
      "isBoundToReferenceService", "invalidateAttempt", "close"]
      .every((key) => getDataMethod(value as object, key) === getDataMethod(OwnerKling4RequestPreparer.prototype, key));
}

function isExactNativeClient(value: unknown): value is SyntxChatHttpClient {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype) return false;
  return ([
    ["createChat", CLIENT_METHODS.createChat], ["uploadOwnerKling4Reference", CLIENT_METHODS.upload],
    ["createOwnerKling4Chat", CLIENT_METHODS.create], ["startOwnerKling4WithOwnedCandidate", CLIENT_METHODS.start],
    ["listOwnedKling4Candidates", CLIENT_METHODS.list], ["getOwnedKling4Result", CLIENT_METHODS.get]
  ] as const).every(([key, method]) => typeof method === "function" && !Object.hasOwn(value, key) &&
    getDataMethod(value, key) === method && getDataMethod(SyntxChatHttpClient.prototype, key) === method);
}

function fail(code: OwnerKling4NativeErrorCode): never { throw new OwnerKling4NativeError(code); }
