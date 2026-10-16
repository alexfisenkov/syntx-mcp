import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../../auth/owner-reference-principal.js";
import { PerUserLinkService } from "../../auth/link-service.js";
import type { AuthBinding } from "../../auth/types.js";
import type { GenerationPrincipalRef } from "../../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../../domain/generation-principal.js";
import { schemaHash } from "../../domain/generation-contract.js";
import {
  consumeOwnerVeoOmniReferenceOneShotPermit,
  revalidateOwnerVeoOmniReferenceOneShotPermit,
  type OwnerVeoOmniReferenceOneShotPermit
} from "../../application/owner-veo-omni-reference-one-shot-policy.js";
import {
  isOwnerVeoOmniReferencePreparedCandidate,
  isOwnerVeoOmniReferenceRequestPreparer,
  OwnerVeoOmniReferenceRequestPreparer,
  type OwnerVeoOmniReferencePreparedCandidate,
} from "../../application/owner-veo-omni-reference-request-preparer.js";
import {
  isOwnerVeoOmniReferenceService,
  OwnerVeoOmniReferenceService,
} from "../../application/owner-veo-omni-reference-service.js";
import { getOwnerVeoOmniReferenceProfile } from "../../application/owner-veo-omni-reference-profile.js";
import type { OwnerVeoOmniReferenceWireCandidate, OwnerVeoOmniReferenceWireFile } from "../../application/owner-veo-omni-reference-wire.js";
import { SyntxChatHttpClient } from "./chat-http-client.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";

const MODEL_ID = "veo_omni" as const;
const AI_NAME = "veo3" as const;
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
  resolve: OwnerVeoOmniReferenceService.prototype.resolveReferences,
  guard: OwnerVeoOmniReferenceService.prototype.isOwnedReferences,
  capture: OwnerVeoOmniReferenceService.prototype.withCapturedReferences,
  invalidate: OwnerVeoOmniReferenceService.prototype.invalidateAttempt,
  close: OwnerVeoOmniReferenceService.prototype.close
});
const NATIVE_PREPARER_METHODS = Object.freeze({
  prepare: OwnerVeoOmniReferenceRequestPreparer.prototype.prepare,
  inspect: OwnerVeoOmniReferenceRequestPreparer.prototype.inspectCandidate,
  request: OwnerVeoOmniReferenceRequestPreparer.prototype.getPrivateRequest,
  revalidate: OwnerVeoOmniReferenceRequestPreparer.prototype.revalidateCandidate,
  capture: OwnerVeoOmniReferenceRequestPreparer.prototype.withCapturedReferences,
  bound: OwnerVeoOmniReferenceRequestPreparer.prototype.isBoundToReferenceService,
  invalidate: OwnerVeoOmniReferenceRequestPreparer.prototype.invalidateAttempt,
  close: OwnerVeoOmniReferenceRequestPreparer.prototype.close
});
const NATIVE_CLIENT_METHODS = Object.freeze({
  createChat: SyntxChatHttpClient.prototype.createChat,
  upload: SyntxChatHttpClient.prototype.uploadOwnerVeoOmniReference,
  create: SyntxChatHttpClient.prototype.createOwnerVeoOmniReferenceChat,
  start: SyntxChatHttpClient.prototype.startOwnerVeoOmniReferenceWithOwnedCandidate,
  list: SyntxChatHttpClient.prototype.listOwnedVeoOmniReferenceCandidates,
  get: SyntxChatHttpClient.prototype.getOwnedVeoOmniReferenceResult
});
const PROFILE_SHA256 = getOwnerVeoOmniReferenceProfile().profile_sha256;

type CandidateBinding = NonNullable<ReturnType<OwnerVeoOmniReferenceRequestPreparer["inspectCandidate"]>>;
type CandidateSource = CandidateBinding["sources"][number];

export interface OwnerVeoOmniReferenceNativeOperationInput {
  readonly preparer: OwnerVeoOmniReferenceRequestPreparer;
  readonly candidate: OwnerVeoOmniReferencePreparedCandidate;
  readonly permit: OwnerVeoOmniReferenceOneShotPermit;
  readonly referenceService: OwnerVeoOmniReferenceService;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly linkService: PerUserLinkService;
  readonly binding: AuthBinding;
}

export interface OwnerVeoOmniReferenceNativeChatContext {
  readonly status: "created";
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly model_id: typeof MODEL_ID;
  readonly profile_sha256: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly sources: readonly CandidateSource[];
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerVeoOmniReferenceNativeStartAck { readonly chat_uuid: string; readonly message_id: string; }

export interface OwnerVeoOmniReferenceNativeDispatchStatus {
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly model_id: typeof MODEL_ID;
  readonly phase: "AVAILABLE" | "OUTCOME_UNKNOWN" | "ACKNOWLEDGED";
  readonly dispatch_attempted: boolean;
  readonly owner_ack_bound: boolean;
  readonly owner_echo_message_id: string | null;
}

export type OwnerVeoOmniReferenceNativeRequestEchoStatus = "MATCHED" | "ABSENT" | "PARTIAL_UNPROVEN" | "CONTRADICTORY";

export interface OwnerVeoOmniReferenceNativeResultContext {
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

export interface OwnerVeoOmniReferenceNativeResultCandidates {
  readonly status: "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  readonly request_echo_status: OwnerVeoOmniReferenceNativeRequestEchoStatus;
  readonly history_binding_status: "BOUND" | "UNVERIFIED";
  readonly history_page_status: "NOT_READ" | "COMPLETE" | "INCOMPLETE" | "UNPROVEN";
  readonly history_get_calls: number;
  readonly total_count: number | null;
  readonly total_pages: number | null;
  readonly provider_chat_id: string | null;
  readonly owner_echo_message_id: string | null;
  readonly contexts: readonly OwnerVeoOmniReferenceNativeResultContext[];
  readonly gaps: readonly string[];
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerVeoOmniReferenceNativeVideoArtifact {
  readonly object_index: number;
  readonly message_object_id: string;
  readonly object_type: "video";
  readonly object_url: string;
  readonly mime_type: "video/mp4" | "video/quicktime" | null;
  readonly mime_source: "URL_EXTENSION" | "UNKNOWN";
}

export interface OwnerVeoOmniReferenceNativeResult {
  readonly message_binding: "BOUND" | "UNVERIFIED";
  readonly model_echo: "MATCHED" | "UNKNOWN" | "MISMATCH";
  readonly provider_terminal_status: "UNPROVEN";
  readonly artifacts: readonly OwnerVeoOmniReferenceNativeVideoArtifact[];
  readonly gaps: readonly string[];
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerVeoOmniReferenceNativeResultReadInput {
  readonly result_context: OwnerVeoOmniReferenceNativeResultContext;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly linkService: PerUserLinkService;
  readonly binding: AuthBinding;
}

export type OwnerVeoOmniReferenceNativeErrorCode =
  | "INVALID_REQUEST" | "CANDIDATE_INVALID" | "CHAT_CREATE_OUTCOME_UNKNOWN" | "CHAT_CONTEXT_INVALID"
  | "CHAT_ALREADY_CREATED" | "CHAT_NOT_DISPATCHED" | "OUTCOME_UNKNOWN" | "HISTORY_UNAVAILABLE"
  | "RESULT_CONTEXT_INVALID" | "RESULT_GET_UNAVAILABLE" | "REQUEST_ABORTED" | "CAPACITY_EXCEEDED"
  | "PRINCIPAL_NOT_LINKED";

export class OwnerVeoOmniReferenceNativeError extends Error {
  constructor(readonly code: OwnerVeoOmniReferenceNativeErrorCode) {
    super("The owner Veo Omni native operation could not be completed safely.");
    this.name = "OwnerVeoOmniReferenceNativeError";
  }
}

type NativePhase = "AVAILABLE" | "OUTCOME_UNKNOWN" | "ACKNOWLEDGED";
interface NativeInput extends OwnerVeoOmniReferenceNativeOperationInput {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly binding: Readonly<AuthBinding>;
}
interface WireSnapshot {
  readonly wire: OwnerVeoOmniReferenceWireCandidate;
  readonly wireFingerprint: string;
}
interface NativeState {
  readonly client: SyntxChatHttpClient;
  readonly input: NativeInput;
  readonly auth: NativeInput;
  readonly chat: OwnerVeoOmniReferenceNativeChatContext;
  readonly binding: Readonly<CandidateBinding>;
  readonly preDispatchSnapshot: WireSnapshot;
  phase: NativePhase;
  dispatchSnapshot?: WireSnapshot;
  ownerEcho?: string;
  readonly contexts: Map<string, OwnerVeoOmniReferenceNativeResultContext>;
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
  readonly context: OwnerVeoOmniReferenceNativeResultContext;
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

export async function createOwnerVeoOmniReferenceNativeChat(
  input: unknown, packet: unknown, signal?: AbortSignal
): Promise<OwnerVeoOmniReferenceNativeChatContext> {
  const invocation = await consumeInvocation(input, packet, "create"), client = invocation.client;
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
    snapshot = captureWire(fields, client, binding);
    await revalidatePermit(fields);
    await assertCurrent(fields, signal);
    const current = captureWire(fields, client, inspectCandidate(fields));
    if (schemaHash(current) !== schemaHash(snapshot)) fail("CANDIDATE_INVALID");
  } catch { fail("CANDIDATE_INVALID"); }

  const chats = chatsByClient.get(client) ?? new Map<string, NativeState>();
  if (chats.size >= CHAT_LIMIT) fail("CAPACITY_EXCEEDED");
  if (issuedPermits.has(fields.permit as object) || pendingPermits.has(fields.permit as object)) fail("CHAT_ALREADY_CREATED");
  pendingPermits.add(fields.permit as object);
  issuedPermits.add(fields.permit as object);
  let receipt: { chat_uuid: string };
  try { receipt = await createChat(`owner-veo-omni-reference-${randomUUID()}`, signal); }
  catch { pendingPermits.delete(fields.permit as object); fail("CHAT_CREATE_OUTCOME_UNKNOWN"); }
  pendingPermits.delete(fields.permit as object);
  if (aborted(signal) || !safeId(receipt.chat_uuid) || chats.has(receipt.chat_uuid)) fail("CHAT_CREATE_OUTCOME_UNKNOWN");
  try {
    await assertCurrent(fields, signal);
    await fields.preparer.revalidateCandidate(fields.candidate, signal);
    await assertCurrent(fields, signal);
    await revalidatePermit(fields);
    await assertCurrent(fields, signal);
    const latestBinding = inspectCandidate(fields), latestSnapshot = captureWire(fields, client, latestBinding);
    if (schemaHash(latestBinding) !== schemaHash(binding!) || schemaHash(latestSnapshot) !== schemaHash(snapshot!)) fail("CANDIDATE_INVALID");
  } catch { fail("CANDIDATE_INVALID"); }

  const chat: OwnerVeoOmniReferenceNativeChatContext = Object.freeze({ status: "created", chat_uuid: receipt!.chat_uuid,
    attempt_id: fields.attemptId, model_id: MODEL_ID, profile_sha256: binding!.profile_sha256,
    request_fingerprint: binding!.request_fingerprint, intent_fingerprint: binding!.intent_fingerprint,
    sources: deepFreeze(binding!.sources.map((source) => ({ ...source }))), dispatch_allowed: false, backend_acceptance: "UNPROVEN" });
  const state: NativeState = { client, input: fields, auth: fields, chat, binding: binding!, preDispatchSnapshot: snapshot!,
    phase: "AVAILABLE", contexts: new Map() };
  chats.set(chat.chat_uuid, state);
  chatsByClient.set(client, chats);
  operations.set(chat, state);
  return chat;
}

export async function startOwnerVeoOmniReferenceWithOwnedCandidate(
  input: unknown, packet: unknown, signal?: AbortSignal
): Promise<OwnerVeoOmniReferenceNativeStartAck> {
  const invocation = await consumeInvocation(input, packet, "start"), client = invocation.client;
  const start = invocation.callback as (chatUuid: string, body: Record<string, unknown>, signal?: AbortSignal) => Promise<OwnerVeoOmniReferenceNativeStartAck>;
  let fields: NativeInput & { readonly chat?: OwnerVeoOmniReferenceNativeChatContext };
  try { fields = readOperation(input, true); } catch { fail("INVALID_REQUEST"); }
  const state = stateFor(client, fields.chat);
  if (!sameOperation(state.input, fields)) fail("CHAT_CONTEXT_INVALID");
  if (state.phase !== "AVAILABLE") fail("CHAT_NOT_DISPATCHED");
  if (aborted(signal)) fail("REQUEST_ABORTED");

  let snapshot: WireSnapshot;
  let body: Readonly<Record<string, unknown>>;
  try {
    inspectCandidate(fields);
    await assertCurrent(state.auth, signal);
    await fields.preparer.revalidateCandidate(fields.candidate, signal);
    await assertCurrent(state.auth, signal);
    const binding = inspectCandidate(fields), current = captureWire(fields, client, binding);
    if (schemaHash(binding) !== schemaHash(state.binding) || schemaHash(current) !== schemaHash(state.preDispatchSnapshot)) fail("CANDIDATE_INVALID");
    snapshot = current;
    await revalidatePermit(fields);
    await assertCurrent(state.auth, signal);
    consumePermit(fields);
    state.dispatchSnapshot = snapshot;
    body = Object.freeze({ chat_id: state.chat.chat_uuid, prompt: snapshot.wire.prompt, settings: snapshot.wire.settings });
  } catch { fail("CANDIDATE_INVALID"); }

  state.phase = "OUTCOME_UNKNOWN";
  try {
    const ack = await start(state.chat.chat_uuid, body!, signal);
    const parsed = exact(ack, ["chat_uuid", "message_id"]);
    if (aborted(signal) || parsed.chat_uuid !== state.chat.chat_uuid || !safeId(parsed.message_id)) fail("OUTCOME_UNKNOWN");
    await assertCurrent(state.auth, signal);
    state.ownerEcho = parsed.message_id as string;
    state.phase = "ACKNOWLEDGED";
    return Object.freeze({ chat_uuid: parsed.chat_uuid as string, message_id: parsed.message_id as string });
  } catch { state.phase = "OUTCOME_UNKNOWN"; fail("OUTCOME_UNKNOWN"); }
}

export async function listOwnerVeoOmniReferenceNativeCandidates(
  input: unknown, packet: unknown, signal?: AbortSignal
): Promise<OwnerVeoOmniReferenceNativeResultCandidates> {
  const invocation = await consumeInvocation(input, packet, "list"), client = invocation.client;
  const getPage = invocation.callback as (chatUuid: string, page: number, pageSize: number, signal?: AbortSignal) => Promise<unknown>;
  let fields: NativeInput & { readonly chat?: OwnerVeoOmniReferenceNativeChatContext };
  try { fields = readOperation(input, true); } catch { fail("INVALID_REQUEST"); }
  const state = stateFor(client, fields.chat);
  if (!sameOperation(state.input, fields)) fail("CHAT_CONTEXT_INVALID");
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
      totalCount ??= parsed.total_count;
      totalPages ??= parsed.total_pages;
      if (parsed.total_count !== totalCount || parsed.total_pages !== totalPages || page > parsed.total_pages) {
        return emptyCandidates("UNVERIFIED", "MISSING", "ABSENT", "INCOMPLETE", calls, "HISTORY_PAGINATION_CHANGED");
      }
      for (const row of parsed.messages) {
        if (row.chat_id !== providerChatId && providerChatId !== undefined) {
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
  const otherOwnerRequestRows = rows.filter((row) => row.author_id > 0 && row.id !== state.ownerEcho && row.message_object.length > 0);
  if (otherOwnerRequestRows.length > 0) {
    return Object.freeze({ ...emptyCandidates("UNVERIFIED", "MATCHED", "PARTIAL_UNPROVEN", "COMPLETE", calls,
      "HISTORY_ADDITIONAL_OWNER_REQUEST"), total_count: totalCount, total_pages: totalPages,
      provider_chat_id: providerChatId, owner_echo_message_id: state.ownerEcho });
  }
  const echo = inspectRequestEcho(ackRows[0]!, state.dispatchSnapshot.wire);
  if (echo === "CONTRADICTORY") {
    return Object.freeze({ ...emptyCandidates("UNVERIFIED", "MATCHED", echo, "COMPLETE", calls, "OWNER_REQUEST_ECHO_CONTRADICTORY"),
      total_count: totalCount, total_pages: totalPages, provider_chat_id: providerChatId,
      owner_echo_message_id: state.ownerEcho });
  }

  const found: Array<Readonly<{ context: OwnerVeoOmniReferenceNativeResultContext; codec: ResultCodec }>> = [];
  const gaps: string[] = [];
  let foundVideoCount = 0;
  for (const row of rows) {
    if (row.author_id !== BOT_AUTHOR_ID) continue;
    const videos = row.message_object.filter((object) => object.object_type === "video");
    if (videos.length === 0) continue;
    if (videos.length > OBJECT_LIMIT || videos.some((video) => video.model_type !== MODEL_ID || video.completed !== true ||
        typeof video.object_url !== "string" || !isSafeUploadReferenceUrl(video.object_url))) {
      gaps.push("BOT_VIDEO_MODEL_COMPLETION_OR_OBJECT_MISMATCH");
      continue;
    }
    if (foundVideoCount + videos.length > OBJECT_LIMIT) { gaps.push("RESULT_VIDEO_LIMIT_EXCEEDED"); continue; }
    foundVideoCount += videos.length;
    const ids = Object.freeze(videos.map((video) => video.id));
    const codec: ResultCodec = Object.freeze({ chat_uuid: state.chat.chat_uuid, message_id: row.id,
      model_id: MODEL_ID, provider_chat_id: providerChatId, message_object_ids: ids });
    const context: OwnerVeoOmniReferenceNativeResultContext = Object.freeze({ ...codec, attempt_id: state.chat.attempt_id,
      profile_sha256: state.chat.profile_sha256, request_fingerprint: state.chat.request_fingerprint,
      intent_fingerprint: state.chat.intent_fingerprint, owner_echo_message_id: state.ownerEcho });
    const previous = state.contexts.get(row.id);
    if (previous && schemaHash(previous) !== schemaHash(context)) return emptyCandidates("UNVERIFIED", "MATCHED", echo,
      "UNPROVEN", calls, "RESULT_CONTEXT_MISMATCH");
    found.push(Object.freeze({ context: previous ?? context, codec }));
  }
  if (gaps.length) return Object.freeze({ ...emptyCandidates("UNVERIFIED", "MATCHED", echo, "COMPLETE", calls, gaps[0]!),
    total_count: totalCount, total_pages: totalPages, provider_chat_id: providerChatId,
    owner_echo_message_id: state.ownerEcho, gaps: Object.freeze(gaps) });
  const contexts = found.map(({ context, codec }) => {
    if (!state.contexts.has(context.message_id)) {
      resultContexts.set(context, { client, state, context, codec });
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

export async function getOwnerVeoOmniReferenceNativeResult(
  input: unknown, packet: unknown, signal?: AbortSignal
): Promise<OwnerVeoOmniReferenceNativeResult> {
  const invocation = await consumeInvocation(input, packet, "get"), client = invocation.client;
  const getMessage = invocation.callback as (chatUuid: string, messageId: string, signal?: AbortSignal) => Promise<unknown>;
  let fields: Readonly<OwnerVeoOmniReferenceNativeResultReadInput & {
    readonly principal: Readonly<GenerationPrincipalRef>; readonly binding: Readonly<AuthBinding>
  }>;
  try { fields = readResultReadInput(input); } catch { fail("RESULT_CONTEXT_INVALID"); }
  const owned = resultContexts.get(fields.result_context as object);
  if (!owned || owned.client !== client || owned.context !== fields.result_context || owned.state.phase !== "ACKNOWLEDGED" ||
      owned.state.ownerEcho !== owned.context.owner_echo_message_id || operations.get(owned.state.chat) !== owned.state ||
      owned.state.chat.attempt_id !== fields.attemptId || owned.state.chat.intent_fingerprint !== owned.context.intent_fingerprint ||
      owned.state.client !== client || !sameGenerationPrincipal(fields.principal, owned.state.auth.principal) ||
      !sameBinding(fields.binding, owned.state.auth.binding) || fields.linkService !== owned.state.auth.linkService ||
      owned.state.chat.profile_sha256 !== owned.context.profile_sha256) fail("RESULT_CONTEXT_INVALID");
  if (aborted(signal)) fail("REQUEST_ABORTED");
  await assertCurrent(owned.state.auth, signal);
  try {
    let raw: unknown;
    try { raw = await getMessage(owned.codec.chat_uuid, owned.codec.message_id, signal); }
    finally { await assertCurrent(owned.state.auth, signal); }
    return decodeResult(raw, owned.codec);
  } catch { if (aborted(signal)) fail("REQUEST_ABORTED"); fail("RESULT_GET_UNAVAILABLE"); }
}

export function readOwnerVeoOmniReferenceNativeDispatchStatus(client: unknown, chatInput: unknown): OwnerVeoOmniReferenceNativeDispatchStatus | null {
  if (!isExactNativeClient(client) || !chatInput || typeof chatInput !== "object" || types.isProxy(chatInput)) return null;
  const state = operations.get(chatInput as object);
  if (!state || state.client !== client || state.chat !== chatInput || chatsByClient.get(state.client)?.get(state.chat.chat_uuid) !== state) return null;
  return Object.freeze({ chat_uuid: state.chat.chat_uuid, attempt_id: state.chat.attempt_id, model_id: MODEL_ID,
    phase: state.phase, dispatch_attempted: state.phase !== "AVAILABLE",
    owner_ack_bound: state.phase === "ACKNOWLEDGED" && !!state.ownerEcho,
    owner_echo_message_id: state.phase === "ACKNOWLEDGED" ? state.ownerEcho ?? null : null });
}

function inspectCandidate(fields: NativeInput): Readonly<CandidateBinding> {
  if (!fields.preparer.isBoundToReferenceService(fields.referenceService) ||
      !isOwnerVeoOmniReferencePreparedCandidate(fields.candidate) || !isNativeReferenceService(fields.referenceService) ||
      !isNativePreparer(fields.preparer)) fail("CANDIDATE_INVALID");
  const binding = fields.preparer.inspectCandidate(fields.candidate);
  if (!binding) fail("CANDIDATE_INVALID");
  assertCandidateBindings(fields, binding);
  const wire = fields.preparer.getPrivateRequest(fields.candidate);
  if (!validWire(wire, binding)) fail("CANDIDATE_INVALID");
  return binding;
}

function assertCandidateBindings(fields: NativeInput, binding: Readonly<CandidateBinding>): void {
  const candidate = exact(fields.candidate, ["status", "dispatch_allowed", "backend_acceptance", "model_id", "profile_sha256",
    "request_fingerprint", "intent_fingerprint", "expires_at", "sources"]);
  if (binding.attempt_id !== fields.attemptId || !sameGenerationPrincipal(binding.principal, fields.principal) ||
      fields.principal.connection_id !== fields.attemptId || binding.model_id !== MODEL_ID || candidate.model_id !== MODEL_ID ||
      candidate.status !== "blocked" || candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" ||
      binding.profile_sha256 !== PROFILE_SHA256 || candidate.profile_sha256 !== PROFILE_SHA256 ||
      candidate.request_fingerprint !== binding.request_fingerprint || candidate.intent_fingerprint !== binding.intent_fingerprint ||
      candidate.expires_at !== binding.expires_at || schemaHash(candidate.sources) !== schemaHash(binding.sources) ||
      !/^sha256:[a-f0-9]{64}$/u.test(binding.request_fingerprint) || !/^sha256:[a-f0-9]{64}$/u.test(binding.intent_fingerprint) ||
      !Number.isSafeInteger(binding.expires_at) || !Number.isSafeInteger(binding.reference_epoch) || binding.reference_epoch < 0 ||
      binding.sources.length < 1 || binding.sources.length > 7 || binding.sources.some((source) => !validSource(source))) fail("CANDIDATE_INVALID");
}

function validSource(source: CandidateSource): boolean {
  try {
    const fields = exact(source, ["reference_handle", "kind", "mime_type", "size", "sha256", "width", "height", "duration_seconds"]);
    return typeof fields.reference_handle === "string" && /^veo_omni_reference_[0-9a-f-]{36}$/u.test(fields.reference_handle) &&
      (fields.kind === "image" || fields.kind === "video") && typeof fields.mime_type === "string" &&
      Number.isSafeInteger(fields.size) && (fields.size as number) > 0 && /^[a-f0-9]{64}$/u.test(String(fields.sha256)) &&
      Number.isSafeInteger(fields.width) && (fields.width as number) > 0 &&
      Number.isSafeInteger(fields.height) && (fields.height as number) > 0 &&
      (fields.kind === "image" ? fields.duration_seconds === null :
        typeof fields.duration_seconds === "number" && Number.isFinite(fields.duration_seconds) && fields.duration_seconds > 0 && fields.duration_seconds <= 10.2);
  } catch { return false; }
}

function validWire(value: unknown, binding: Readonly<CandidateBinding>): value is OwnerVeoOmniReferenceWireCandidate {
  try {
    const wire = exact(value, ["status", "profile_sha256", "ai_name", "prompt", "settings", "cost_parameters", "input_reference_count",
      "wire_reference_count", "wire_fingerprint", "generation_permit"]);
    const settings = exact(wire.settings, ["model_type", "type", "upscale", "aspect_ratio", "video_duration", "file_urls"]);
    const cost = exact(wire.cost_parameters, ["upscale", "video_duration"], ["mode"]);
    const bindingCost = exact(binding.cost_parameters, ["upscale", "video_duration"], ["mode"]);
    if (schemaHash(cost) !== schemaHash(bindingCost)) return false;
    const sources = binding.sources;
    if (wire.status !== "SOURCE_BOUND_REFERENCE_WIRE_CANDIDATE" || wire.profile_sha256 !== PROFILE_SHA256 || wire.ai_name !== AI_NAME ||
        typeof wire.prompt !== "string" || !isWellFormedUnicode(wire.prompt) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(wire.prompt) ||
        settings.model_type !== MODEL_ID || (settings.type !== "image" && settings.type !== "references") ||
        ![0, 1, 2, 3].includes(settings.upscale as number) || !["16:9", "9:16"].includes(settings.aspect_ratio as string) ||
        ![4, 6, 8, 10].includes(settings.video_duration as number) || wire.generation_permit !== false ||
        !Number.isSafeInteger(wire.input_reference_count) || wire.input_reference_count !== sources.length ||
        !Array.isArray(settings.file_urls) || types.isProxy(settings.file_urls) || settings.file_urls.length < 1 || settings.file_urls.length > 7 ||
        wire.wire_reference_count !== settings.file_urls.length || !/^sha256:[a-f0-9]{64}$/u.test(String(wire.wire_fingerprint))) return false;
    const imageCount = sources.filter((source) => source.kind === "image").length;
    const videoCount = sources.length - imageCount;
    if (settings.type === "image" ? imageCount < 1 || imageCount > 2 || videoCount !== 0 :
        !((videoCount === 0 && imageCount >= 1 && imageCount <= 7) || (videoCount === 1 && imageCount <= 5))) return false;
    const expectedMode = settings.type === "references" && videoCount === 1 ? "video_ref" : undefined;
    if (cost.upscale !== settings.upscale || cost.video_duration !== settings.video_duration ||
        (expectedMode === undefined ? Object.hasOwn(cost, "mode") : cost.mode !== expectedMode)) return false;
    const files: OwnerVeoOmniReferenceWireFile[] = [];
    for (const value of settings.file_urls) {
      const file = exact(value, ["type", "url"]);
      if ((file.type !== "image" && file.type !== "video") || typeof file.url !== "string" || !isSafeUploadReferenceUrl(file.url)) return false;
      files.push(Object.freeze({ type: file.type, url: file.url }));
    }
    if (new Set(files.map((file) => JSON.stringify([file.type, file.url]))).size !== files.length) return false;
    const snapshot = snapshotWire(wire as unknown as OwnerVeoOmniReferenceWireCandidate, Object.freeze(files));
    return snapshot.wire.wire_fingerprint === fingerprintWire(snapshot.wire);
  } catch { return false; }
}

function captureWire(fields: NativeInput, client: SyntxChatHttpClient, binding: Readonly<CandidateBinding>): WireSnapshot {
  const request = fields.preparer.getPrivateRequest(fields.candidate);
  if (!validWire(request, binding)) fail("CANDIDATE_INVALID");
  let snapshot: WireSnapshot | undefined;
  try {
    snapshot = fields.preparer.withCapturedReferences(fields.candidate, (capturedClient, wire) => {
      if (capturedClient !== client || !validWire(wire, binding) || schemaHash(wire) !== schemaHash(request)) fail("CANDIDATE_INVALID");
      return snapshotWire(wire, wire.settings.file_urls);
    });
  } catch { fail("CANDIDATE_INVALID"); }
  if (!snapshot || snapshot.wire.profile_sha256 !== PROFILE_SHA256 || snapshot.wire.wire_fingerprint !== request.wire_fingerprint) fail("CANDIDATE_INVALID");
  return snapshot;
}

function snapshotWire(wire: OwnerVeoOmniReferenceWireCandidate, fileUrls: readonly OwnerVeoOmniReferenceWireFile[]): WireSnapshot {
  const settings = Object.freeze({ model_type: MODEL_ID, type: wire.settings.type, upscale: wire.settings.upscale,
    aspect_ratio: wire.settings.aspect_ratio, video_duration: wire.settings.video_duration, file_urls: Object.freeze([...fileUrls]) });
  const cost = Object.freeze({ upscale: wire.cost_parameters.upscale, video_duration: wire.cost_parameters.video_duration,
    ...(wire.cost_parameters.mode === "video_ref" ? { mode: "video_ref" as const } : {}) });
  const snapshot: OwnerVeoOmniReferenceWireCandidate = Object.freeze({ status: "SOURCE_BOUND_REFERENCE_WIRE_CANDIDATE",
    profile_sha256: PROFILE_SHA256, ai_name: AI_NAME, prompt: wire.prompt, settings, cost_parameters: cost,
    input_reference_count: wire.input_reference_count, wire_reference_count: fileUrls.length,
    wire_fingerprint: wire.wire_fingerprint, generation_permit: false });
  return Object.freeze({ wire: snapshot, wireFingerprint: snapshot.wire_fingerprint });
}

function fingerprintWire(wire: OwnerVeoOmniReferenceWireCandidate): string {
  const layout = ["owner-veo-omni-reference-wire-v1", wire.profile_sha256,
    { ai_name: wire.ai_name, prompt: wire.prompt, settings: wire.settings }, wire.cost_parameters];
  return `sha256:${createHash("sha256").update(JSON.stringify(layout), "utf8").digest("hex")}`;
}

async function revalidatePermit(fields: NativeInput): Promise<void> {
  await revalidateOwnerVeoOmniReferenceOneShotPermit({ permit: fields.permit, preparer: fields.preparer,
    candidate: fields.candidate, principal: fields.principal, attemptId: fields.attemptId });
}
function consumePermit(fields: NativeInput): void {
  consumeOwnerVeoOmniReferenceOneShotPermit({ permit: fields.permit, preparer: fields.preparer,
    candidate: fields.candidate, principal: fields.principal, attemptId: fields.attemptId });
}

async function assertCurrent(fields: NativeInput, signal?: AbortSignal): Promise<void> {
  if (signal && (types.isProxy(signal) || !(signal instanceof AbortSignal))) fail("INVALID_REQUEST");
  if (aborted(signal)) fail("REQUEST_ABORTED");
  if (!isNativeLinkService(fields.linkService)) fail("CANDIDATE_INVALID");
  try {
    const current = await resolveOwnerReferencePrincipal({ binding: fields.binding, attemptId: fields.attemptId, linkService: fields.linkService });
    if (!sameGenerationPrincipal(current, fields.principal) || aborted(signal)) fail(aborted(signal) ? "REQUEST_ABORTED" : "PRINCIPAL_NOT_LINKED");
  } catch (error) {
    if (error instanceof OwnerVeoOmniReferenceNativeError) throw error;
    if (aborted(signal)) fail("REQUEST_ABORTED");
    if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
    fail("PRINCIPAL_NOT_LINKED");
  }
}

async function consumeInvocation(input: unknown, packet: unknown, method: "create" | "start" | "list" | "get"): Promise<Invocation> {
  try {
    const native = await import("./chat-http-client.js");
    return native.consumeOwnerVeoOmniReferenceNativeInvocation(input, packet, method);
  } catch { fail("INVALID_REQUEST"); }
}

function stateFor(client: SyntxChatHttpClient, chatValue: unknown): NativeState {
  if (!chatValue || typeof chatValue !== "object" || types.isProxy(chatValue)) fail("CHAT_CONTEXT_INVALID");
  const state = operations.get(chatValue as object);
  if (!state || state.client !== client || state.chat !== chatValue || chatsByClient.get(client)?.get(state.chat.chat_uuid) !== state) fail("CHAT_CONTEXT_INVALID");
  return state;
}

function readOperation(value: unknown, withChat: boolean): NativeInput & { readonly chat?: OwnerVeoOmniReferenceNativeChatContext } {
  const fields = exact(value, ["preparer", "candidate", "permit", "referenceService", "principal", "attemptId", "linkService", "binding",
    ...(withChat ? ["chat"] : [])]);
  if (typeof fields.attemptId !== "string" || !isExactMatch(ATTEMPT, fields.attemptId) || !fields.candidate || typeof fields.candidate !== "object" ||
      types.isProxy(fields.candidate) || !fields.permit || typeof fields.permit !== "object" || types.isProxy(fields.permit)) fail("INVALID_REQUEST");
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); } catch { fail("INVALID_REQUEST"); }
  const binding = exact(fields.binding, ["tenant_id", "subject"]);
  if (typeof binding.tenant_id !== "string" || typeof binding.subject !== "string" || principal.connection_id !== fields.attemptId) fail("INVALID_REQUEST");
  if (!isNativeReferenceService(fields.referenceService) || !isNativePreparer(fields.preparer) ||
      !fields.preparer.isBoundToReferenceService(fields.referenceService)) fail("INVALID_REQUEST");
  return Object.freeze({ preparer: fields.preparer as OwnerVeoOmniReferenceRequestPreparer,
    candidate: fields.candidate as OwnerVeoOmniReferencePreparedCandidate, permit: fields.permit as OwnerVeoOmniReferenceOneShotPermit,
    referenceService: fields.referenceService as OwnerVeoOmniReferenceService, principal, attemptId: fields.attemptId,
    linkService: fields.linkService as PerUserLinkService, binding: Object.freeze({ tenant_id: binding.tenant_id, subject: binding.subject }),
    ...(withChat ? { chat: fields.chat as OwnerVeoOmniReferenceNativeChatContext } : {}) });
}

function readResultReadInput(value: unknown): Readonly<OwnerVeoOmniReferenceNativeResultReadInput & {
  readonly principal: Readonly<GenerationPrincipalRef>; readonly binding: Readonly<AuthBinding>
}> {
  const fields = exact(value, ["result_context", "principal", "attemptId", "linkService", "binding"]);
  if (typeof fields.attemptId !== "string" || !isExactMatch(ATTEMPT, fields.attemptId)) fail("RESULT_CONTEXT_INVALID");
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); } catch { fail("RESULT_CONTEXT_INVALID"); }
  const binding = exact(fields.binding, ["tenant_id", "subject"]);
  if (typeof binding.tenant_id !== "string" || typeof binding.subject !== "string" || principal.connection_id !== fields.attemptId ||
      !fields.result_context || typeof fields.result_context !== "object" || types.isProxy(fields.result_context)) fail("RESULT_CONTEXT_INVALID");
  return Object.freeze({ result_context: fields.result_context as OwnerVeoOmniReferenceNativeResultContext, principal,
    attemptId: fields.attemptId, linkService: fields.linkService as PerUserLinkService,
    binding: Object.freeze({ tenant_id: binding.tenant_id, subject: binding.subject }) });
}

function sameOperation(a: NativeInput, b: NativeInput & { readonly chat?: OwnerVeoOmniReferenceNativeChatContext }): boolean {
  return a.preparer === b.preparer && a.candidate === b.candidate && a.permit === b.permit &&
    a.referenceService === b.referenceService && a.attemptId === b.attemptId && a.linkService === b.linkService &&
    sameGenerationPrincipal(a.principal, b.principal) && sameBinding(a.binding, b.binding);
}
function sameBinding(a: AuthBinding, b: AuthBinding): boolean { return a.tenant_id === b.tenant_id && a.subject === b.subject; }

function inspectRequestEcho(row: HistoryRow, wire: OwnerVeoOmniReferenceWireCandidate): OwnerVeoOmniReferenceNativeRequestEchoStatus {
  const textObjects = row.message_object.filter((object) => object.object_type === "text");
  if (textObjects.length > 1 || textObjects.some((object) => object.object_text !== wire.prompt)) return "CONTRADICTORY";
  const expected = wire.settings.file_urls;
  const observed: OwnerVeoOmniReferenceWireFile[] = [];
  const observedKeys = new Set<string>();
  let sawEvidence = textObjects.length > 0;
  let fullyTyped = true;
  for (const object of row.message_object) {
    if (object.model_type != null && object.model_type !== MODEL_ID) return "CONTRADICTORY";
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
    if (object.model_type !== MODEL_ID) fullyTyped = false;
  }
  if (!sawEvidence) return "ABSENT";
  if (observed.length === expected.length && observed.some((file, index) =>
      file.type !== expected[index]?.type || file.url !== expected[index]?.url)) return "CONTRADICTORY";
  if (textObjects.length === 1 && observed.length === expected.length && fullyTyped) return "MATCHED";
  return "PARTIAL_UNPROVEN";
}

function decodeResult(raw: unknown, expected: ResultCodec): OwnerVeoOmniReferenceNativeResult {
  try {
    const message = dataRecord(raw);
    if (!message || normalizeId(message.id) !== expected.message_id || message.author_id !== BOT_AUTHOR_ID ||
        normalizeChatId(message.chat_id) !== expected.provider_chat_id) return resultGap("UNVERIFIED", "MISMATCH", "MESSAGE_BINDING_MISMATCH");
    if (!Array.isArray(message.message_object) || types.isProxy(message.message_object) || message.message_object.length > OBJECT_LIMIT) {
      return resultGap("BOUND", "UNKNOWN", "MESSAGE_OBJECT_ARRAY_INVALID");
    }
    const artifacts: OwnerVeoOmniReferenceNativeVideoArtifact[] = [], gaps: string[] = [], seen = new Set<string>();
    const expectedIds = new Set(expected.message_object_ids);
    let modelEcho: OwnerVeoOmniReferenceNativeResult["model_echo"] = "MATCHED";
    for (let index = 0; index < message.message_object.length; index += 1) {
      const object = dataRecord(message.message_object[index]);
      if (!object) { gaps.push("OBJECT_SHAPE_INVALID"); continue; }
      const id = normalizeId(object.id);
      if (!id || seen.has(id)) { gaps.push("OBJECT_ID_INVALID_OR_DUPLICATE"); continue; }
      seen.add(id);
      if (normalizeId(object.message_id) !== expected.message_id) { gaps.push("OBJECT_MESSAGE_BINDING_MISMATCH"); continue; }
      if (object.object_type !== "video") {
        if (expectedIds.has(id)) gaps.push("OBJECT_TYPE_MISMATCH");
        continue;
      }
      if (!expectedIds.has(id)) { gaps.push("OBJECT_ID_UNEXPECTED"); continue; }
      if (object.model_type !== MODEL_ID) { modelEcho = object.model_type == null ? "UNKNOWN" : "MISMATCH"; gaps.push("MODEL_TYPE_MISMATCH"); continue; }
      if (object.completed !== true || typeof object.object_url !== "string" || !isSafeUploadReferenceUrl(object.object_url)) {
        gaps.push("VIDEO_NOT_READY_OR_URL_INVALID"); continue;
      }
      const mime = safeVideoMime(object.object_url);
      artifacts.push(Object.freeze({ object_index: index, message_object_id: id, object_type: "video",
        object_url: object.object_url, mime_type: mime, mime_source: mime ? "URL_EXTENSION" : "UNKNOWN" }));
    }
    if (artifacts.length < 1) gaps.push("NO_READY_MODEL_VIDEO");
    if (artifacts.length !== expected.message_object_ids.length) gaps.push("RESULT_OBJECT_SET_MISMATCH");
    return Object.freeze({ message_binding: "BOUND", model_echo: modelEcho, provider_terminal_status: "UNPROVEN",
      artifacts: Object.freeze(gaps.length ? [] : artifacts), gaps: Object.freeze(gaps), backend_acceptance: "UNPROVEN" });
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
  return Object.freeze({ messages: Object.freeze(messages), page: expectedPage, page_size: PAGE_SIZE, total_count: totalCount,
    total_pages: totalPages, has_next: pagination.has_next, has_previous: pagination.has_previous });
}

function emptyCandidates(status: OwnerVeoOmniReferenceNativeResultCandidates["status"], owner: OwnerVeoOmniReferenceNativeResultCandidates["owner_ack_status"],
  echo: OwnerVeoOmniReferenceNativeRequestEchoStatus, page: OwnerVeoOmniReferenceNativeResultCandidates["history_page_status"], calls: number, gap: string): OwnerVeoOmniReferenceNativeResultCandidates {
  return Object.freeze({ status, owner_ack_status: owner, request_echo_status: echo, history_binding_status: "UNVERIFIED",
    history_page_status: page, history_get_calls: calls, total_count: null, total_pages: null, provider_chat_id: null,
    owner_echo_message_id: null, contexts: Object.freeze([]), gaps: Object.freeze([gap]), backend_acceptance: "UNPROVEN" });
}
function resultGap(binding: OwnerVeoOmniReferenceNativeResult["message_binding"], model: OwnerVeoOmniReferenceNativeResult["model_echo"], gap: string): OwnerVeoOmniReferenceNativeResult {
  return Object.freeze({ message_binding: binding, model_echo: model, provider_terminal_status: "UNPROVEN",
    artifacts: Object.freeze([]), gaps: Object.freeze([gap]), backend_acceptance: "UNPROVEN" });
}
function safeVideoMime(url: string): OwnerVeoOmniReferenceNativeVideoArtifact["mime_type"] {
  try { const path = new URL(url).pathname.toLowerCase(); if (path.endsWith(".mp4")) return "video/mp4"; if (path.endsWith(".mov")) return "video/quicktime"; }
  catch { return null; }
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
function aborted(signal?: AbortSignal): boolean { return !!signal && (types.isProxy(signal) || !(signal instanceof AbortSignal) || signal.aborted); }

function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const fields = dataRecord(value);
  if (!fields) fail("INVALID_REQUEST");
  const keys = Object.keys(fields), allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.hasOwn(fields, key)) || keys.some((key) => !allowed.has(key))) fail("INVALID_REQUEST");
  return fields;
}
function dataRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    if (keys.some((key) => typeof key !== "string" || !Object.hasOwn(descriptors[key]!, "value"))) return undefined;
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
function getDataMethod(target: object, key: string): unknown {
  let current: object | null = target;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}
function isNativeLinkService(value: unknown): value is PerUserLinkService {
  return !!value && typeof value === "object" && !types.isProxy(value) && value instanceof PerUserLinkService &&
    Object.getPrototypeOf(value) === PerUserLinkService.prototype && getDataMethod(value, "getStatus") === NATIVE_LINK_STATUS &&
    PerUserLinkService.prototype.getStatus === NATIVE_LINK_STATUS;
}
function isNativeReferenceService(value: unknown): value is OwnerVeoOmniReferenceService {
  return isOwnerVeoOmniReferenceService(value) && Object.getPrototypeOf(value) === OwnerVeoOmniReferenceService.prototype &&
    OwnerVeoOmniReferenceService.prototype.resolveReferences === NATIVE_REFERENCE_METHODS.resolve &&
    OwnerVeoOmniReferenceService.prototype.isOwnedReferences === NATIVE_REFERENCE_METHODS.guard &&
    OwnerVeoOmniReferenceService.prototype.withCapturedReferences === NATIVE_REFERENCE_METHODS.capture &&
    OwnerVeoOmniReferenceService.prototype.invalidateAttempt === NATIVE_REFERENCE_METHODS.invalidate &&
    OwnerVeoOmniReferenceService.prototype.close === NATIVE_REFERENCE_METHODS.close &&
    getDataMethod(value as object, "resolveReferences") === NATIVE_REFERENCE_METHODS.resolve &&
    getDataMethod(value as object, "isOwnedReferences") === NATIVE_REFERENCE_METHODS.guard &&
    getDataMethod(value as object, "withCapturedReferences") === NATIVE_REFERENCE_METHODS.capture;
}
function isNativePreparer(value: unknown): value is OwnerVeoOmniReferenceRequestPreparer {
  return isOwnerVeoOmniReferenceRequestPreparer(value) &&
    OwnerVeoOmniReferenceRequestPreparer.prototype.prepare === NATIVE_PREPARER_METHODS.prepare &&
    OwnerVeoOmniReferenceRequestPreparer.prototype.inspectCandidate === NATIVE_PREPARER_METHODS.inspect &&
    OwnerVeoOmniReferenceRequestPreparer.prototype.getPrivateRequest === NATIVE_PREPARER_METHODS.request &&
    OwnerVeoOmniReferenceRequestPreparer.prototype.revalidateCandidate === NATIVE_PREPARER_METHODS.revalidate &&
    OwnerVeoOmniReferenceRequestPreparer.prototype.withCapturedReferences === NATIVE_PREPARER_METHODS.capture &&
    OwnerVeoOmniReferenceRequestPreparer.prototype.isBoundToReferenceService === NATIVE_PREPARER_METHODS.bound &&
    OwnerVeoOmniReferenceRequestPreparer.prototype.invalidateAttempt === NATIVE_PREPARER_METHODS.invalidate &&
    OwnerVeoOmniReferenceRequestPreparer.prototype.close === NATIVE_PREPARER_METHODS.close &&
    ["prepare", "inspectCandidate", "getPrivateRequest", "revalidateCandidate", "withCapturedReferences", "isBoundToReferenceService", "invalidateAttempt", "close"]
      .every((key) => getDataMethod(value as object, key) === getDataMethod(OwnerVeoOmniReferenceRequestPreparer.prototype, key));
}
function isExactNativeClient(client: unknown): client is SyntxChatHttpClient {
  try {
    const names = ["createChat", "uploadOwnerVeoOmniReference", "createOwnerVeoOmniReferenceChat", "startOwnerVeoOmniReferenceWithOwnedCandidate",
      "listOwnedVeoOmniReferenceCandidates", "getOwnedVeoOmniReferenceResult"];
    return !!client && typeof client === "object" && !types.isProxy(client) && Object.getPrototypeOf(client) === SyntxChatHttpClient.prototype &&
      !names.some((name) => Object.hasOwn(client, name)) &&
      getDataMethod(client, "createChat") === NATIVE_CLIENT_METHODS.createChat &&
      getDataMethod(client, "uploadOwnerVeoOmniReference") === NATIVE_CLIENT_METHODS.upload &&
      getDataMethod(client, "createOwnerVeoOmniReferenceChat") === NATIVE_CLIENT_METHODS.create &&
      getDataMethod(client, "startOwnerVeoOmniReferenceWithOwnedCandidate") === NATIVE_CLIENT_METHODS.start &&
      getDataMethod(client, "listOwnedVeoOmniReferenceCandidates") === NATIVE_CLIENT_METHODS.list &&
      getDataMethod(client, "getOwnedVeoOmniReferenceResult") === NATIVE_CLIENT_METHODS.get;
  } catch { return false; }
}
function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}
function fail(code: OwnerVeoOmniReferenceNativeErrorCode): never { throw new OwnerVeoOmniReferenceNativeError(code); }
