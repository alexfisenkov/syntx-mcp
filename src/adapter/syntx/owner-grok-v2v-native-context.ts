import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../../auth/owner-reference-principal.js";
import { PerUserLinkService } from "../../auth/link-service.js";
import type { AuthBinding } from "../../auth/types.js";
import type { GenerationPrincipalRef } from "../../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../../domain/generation-principal.js";
import { schemaHash } from "../../domain/generation-contract.js";
import { OwnerGrokV2vOriginalReferenceService } from "../../application/owner-grok-v2v-original-reference-service.js";
import {
  consumeOwnerGrokV2vOwnedOneShotPermit,
  revalidateOwnerGrokV2vOwnedOneShotPermit,
  type OwnerGrokV2vOwnedOneShotPermit
} from "../../application/owner-grok-v2v-owned-one-shot-policy.js";
import {
  isOwnerGrokV2vOwnedPreparedCandidate,
  isOwnerGrokV2vOwnedRequestPreparer,
  isOwnerGrokV2vOwnedRequestPreparerBoundToReferenceService,
  readOwnerGrokV2vOwnedCandidateBinding,
  OwnerGrokV2vOwnedRequestPreparer,
  type OwnerGrokV2vOwnedCandidateBinding,
  type OwnerGrokV2vOwnedPreparedCandidate,
  type OwnerGrokV2vOwnedPreparedRequest,
  type OwnerGrokV2vOwnedSourceMetadata
} from "../../application/owner-grok-v2v-owned-request-preparer.js";
import {
  getOwnerGrokV2vSourceProfile,
  OWNER_GROK_V2V_MODEL_ID,
  type OwnerGrokV2vSourceProfile
} from "../../application/owner-grok-v2v-source-profile.js";
import {
  readOwnerGrokV2vUploadReferenceForClient,
  SyntxChatHttpClient
} from "./chat-http-client.js";
import type { OwnerGrokV2vUploadContext } from "./grok-v2v-media-upload.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";

const MODEL_ID = OWNER_GROK_V2V_MODEL_ID;
const AI_NAME = "grok_video" as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const PAGE_SIZE = 10;
const PAGE_LIMIT = 7;
const MESSAGE_LIMIT = 64;
const MAX_VIDEO_OBJECTS = 64;
const BOT_AUTHOR_ID = -1;
const CHAT_LIMIT = 128;
const operations = new WeakMap<object, NativeState>();
const chatsByClient = new WeakMap<object, Map<string, NativeState>>();
const resultContexts = new WeakMap<object, ResultState>();
const issuedPermits = new WeakSet<object>();
const pendingPermits = new WeakSet<object>();
const NATIVE_LINK_STATUS = PerUserLinkService.prototype.getStatus;
const NATIVE_REFERENCE_METHODS = Object.freeze({
  resolve: OwnerGrokV2vOriginalReferenceService.prototype.resolveReference,
  guard: OwnerGrokV2vOriginalReferenceService.prototype.isOwnedReferenceResolution,
  capture: OwnerGrokV2vOriginalReferenceService.prototype.withCapturedNativeReference,
  invalidate: OwnerGrokV2vOriginalReferenceService.prototype.invalidateAttempt,
  close: OwnerGrokV2vOriginalReferenceService.prototype.close
});
const NATIVE_PREPARER_METHODS = Object.freeze({
  prepare: OwnerGrokV2vOwnedRequestPreparer.prototype.prepare,
  inspect: OwnerGrokV2vOwnedRequestPreparer.prototype.inspectCandidate,
  request: OwnerGrokV2vOwnedRequestPreparer.prototype.getPrivateRequest,
  revalidate: OwnerGrokV2vOwnedRequestPreparer.prototype.revalidateCandidate,
  capture: OwnerGrokV2vOwnedRequestPreparer.prototype.withCapturedNativeReference,
  bound: OwnerGrokV2vOwnedRequestPreparer.prototype.isBoundToReferenceService,
  invalidate: OwnerGrokV2vOwnedRequestPreparer.prototype.invalidateAttempt,
  close: OwnerGrokV2vOwnedRequestPreparer.prototype.close
});
const NATIVE_CLIENT_METHODS = Object.freeze({
  createChat: SyntxChatHttpClient.prototype.createChat,
  upload: SyntxChatHttpClient.prototype.uploadGrokV2vOriginal,
  create: SyntxChatHttpClient.prototype.createOwnerGrokV2vChat,
  start: SyntxChatHttpClient.prototype.startGrokV2vWithOwnedCandidate,
  list: SyntxChatHttpClient.prototype.listOwnedGrokV2vCandidates,
  get: SyntxChatHttpClient.prototype.getOwnedGrokV2vResult
});

export interface OwnerGrokV2vNativeOperationInput {
  readonly preparer: OwnerGrokV2vOwnedRequestPreparer;
  readonly candidate: OwnerGrokV2vOwnedPreparedCandidate;
  readonly permit: OwnerGrokV2vOwnedOneShotPermit;
  readonly referenceService: OwnerGrokV2vOriginalReferenceService;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly linkService: PerUserLinkService;
  readonly binding: AuthBinding;
}

export interface OwnerGrokV2vNativeChatContext {
  readonly status: "created";
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly model_id: typeof MODEL_ID;
  readonly profile_schema_hash: string;
  readonly source_binding: OwnerGrokV2vSourceProfile["source_pins"];
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly sources: readonly OwnerGrokV2vOwnedCandidateBinding["sources"][number][];
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerGrokV2vNativeStartAck { readonly chat_uuid: string; readonly message_id: string; }

export interface OwnerGrokV2vNativeDispatchStatus {
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly model_id: typeof MODEL_ID;
  readonly phase: "AVAILABLE" | "OUTCOME_UNKNOWN" | "ACKNOWLEDGED";
  readonly dispatch_attempted: boolean;
  readonly owner_ack_bound: boolean;
  readonly owner_echo_message_id: string | null;
}

export type OwnerGrokV2vNativeRequestEchoStatus = "MATCHED" | "ABSENT" | "PARTIAL_UNPROVEN" | "CONTRADICTORY";

export interface OwnerGrokV2vNativeResultContext {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly model_id: typeof MODEL_ID;
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly string[];
  readonly attempt_id: string;
  readonly profile_schema_hash: string;
  readonly source_binding: OwnerGrokV2vSourceProfile["source_pins"];
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly owner_echo_message_id: string;
}

export interface OwnerGrokV2vNativeResultCandidates {
  readonly status: "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  readonly request_echo_status: OwnerGrokV2vNativeRequestEchoStatus;
  readonly history_binding_status: "BOUND" | "UNVERIFIED";
  readonly history_page_status: "NOT_READ" | "COMPLETE" | "INCOMPLETE" | "UNPROVEN";
  readonly history_get_calls: number;
  readonly total_count: number | null;
  readonly total_pages: number | null;
  readonly provider_chat_id: string | null;
  readonly owner_echo_message_id: string | null;
  readonly contexts: readonly OwnerGrokV2vNativeResultContext[];
  readonly gaps: readonly string[];
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerGrokV2vNativeVideoArtifact {
  readonly object_index: number;
  readonly message_object_id: string;
  readonly object_type: "video";
  readonly object_url: string;
  readonly mime_type: "video/mp4" | "video/quicktime" | null;
  readonly mime_source: "URL_EXTENSION" | "UNKNOWN";
}

export interface OwnerGrokV2vNativeResult {
  readonly message_binding: "BOUND" | "UNVERIFIED";
  readonly model_echo: "MATCHED" | "UNKNOWN" | "MISMATCH";
  readonly provider_terminal_status: "UNPROVEN";
  readonly artifacts: readonly OwnerGrokV2vNativeVideoArtifact[];
  readonly gaps: readonly string[];
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerGrokV2vNativeResultReadInput {
  readonly result_context: OwnerGrokV2vNativeResultContext;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly linkService: PerUserLinkService;
  readonly binding: AuthBinding;
}

export type OwnerGrokV2vNativeErrorCode =
  | "INVALID_REQUEST" | "CANDIDATE_INVALID" | "CHAT_CREATE_FAILED" | "CHAT_CREATE_OUTCOME_UNKNOWN"
  | "CHAT_CONTEXT_INVALID" | "CHAT_ALREADY_CREATED" | "CHAT_NOT_DISPATCHED" | "OUTCOME_UNKNOWN"
  | "HISTORY_UNAVAILABLE" | "RESULT_CONTEXT_INVALID" | "RESULT_GET_UNAVAILABLE" | "REQUEST_ABORTED"
  | "CAPACITY_EXCEEDED" | "PRINCIPAL_NOT_LINKED";

export class OwnerGrokV2vNativeError extends Error {
  constructor(readonly code: OwnerGrokV2vNativeErrorCode) {
    super("The owner Grok V2V native operation could not be completed safely.");
    this.name = "OwnerGrokV2vNativeError";
  }
}

interface NativeInput extends OwnerGrokV2vNativeOperationInput {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly binding: Readonly<AuthBinding>;
}
interface CapturedSource {
  readonly wire_type: "video";
  readonly url: string;
  readonly metadata: OwnerGrokV2vOwnedSourceMetadata;
}
interface RequestSnapshot {
  readonly model_id: typeof MODEL_ID;
  readonly prompt: string;
  readonly settings: OwnerGrokV2vOwnedPreparedRequest["settings"];
  readonly source: CapturedSource;
}
interface NativeState {
  readonly client: SyntxChatHttpClient;
  readonly input: NativeInput;
  readonly auth: NativeInput;
  readonly chat: OwnerGrokV2vNativeChatContext;
  readonly binding: Readonly<OwnerGrokV2vOwnedCandidateBinding>;
  readonly requestFingerprint: string;
  readonly preDispatchSnapshot: RequestSnapshot;
  phase: "AVAILABLE" | "OUTCOME_UNKNOWN" | "ACKNOWLEDGED";
  dispatchSnapshot?: RequestSnapshot;
  ownerEcho?: string;
  readonly contexts: Map<string, OwnerGrokV2vNativeResultContext>;
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
  readonly context: OwnerGrokV2vNativeResultContext;
  readonly codec: ResultCodec;
}
interface Invocation { readonly client: SyntxChatHttpClient; readonly callback: Function; }

export async function createOwnerGrokV2vNativeChat(
  input: unknown, packet: unknown, signal?: AbortSignal
): Promise<OwnerGrokV2vNativeChatContext> {
  const invocation = await consumeInvocation(input, packet, "create"), client = invocation.client;
  const createChat = invocation.callback as (title: string, signal?: AbortSignal) => Promise<{ chat_uuid: string }>;
  let fields: NativeInput;
  try { fields = readOperation(input, false); } catch { fail("INVALID_REQUEST"); }
  if (aborted(signal)) fail("REQUEST_ABORTED");
  let binding: Readonly<OwnerGrokV2vOwnedCandidateBinding>;
  let snapshot: RequestSnapshot;
  let requestFingerprint: string;
  try {
    binding = await validateCandidate(fields);
    await assertCurrent(fields, signal);
    await fields.preparer.revalidateCandidate(fields.candidate);
    await revalidatePermit(fields);
    await assertCurrent(fields, signal);
    binding = currentBinding(fields);
    snapshot = captureRequest(fields, client, binding);
    requestFingerprint = schemaHash(fields.preparer.getPrivateRequest(fields.candidate));
    await revalidatePermit(fields);
    await assertCurrent(fields, signal);
    if (requestFingerprint !== binding.request_fingerprint || snapshot.model_id !== binding.model_id) fail("CANDIDATE_INVALID");
  } catch { fail("CANDIDATE_INVALID"); }

  const chats = chatsByClient.get(client) ?? new Map<string, NativeState>();
  if (chats.size >= CHAT_LIMIT) fail("CAPACITY_EXCEEDED");
  if (issuedPermits.has(fields.permit as object) || pendingPermits.has(fields.permit as object)) fail("CHAT_ALREADY_CREATED");
  pendingPermits.add(fields.permit as object);
  issuedPermits.add(fields.permit as object);
  let receipt: { chat_uuid: string };
  try { receipt = await createChat(`owner-grok-v2v-${randomUUID()}`, signal); }
  catch { pendingPermits.delete(fields.permit as object); fail("CHAT_CREATE_OUTCOME_UNKNOWN"); }
  pendingPermits.delete(fields.permit as object);
  if (aborted(signal) || !safeId(receipt.chat_uuid) || chats.has(receipt.chat_uuid)) fail("CHAT_CREATE_OUTCOME_UNKNOWN");
  try {
    await assertCurrent(fields, signal);
    await fields.preparer.revalidateCandidate(fields.candidate);
    await revalidatePermit(fields);
    await assertCurrent(fields, signal);
    const latestBinding = currentBinding(fields), latestSnapshot = captureRequest(fields, client, latestBinding);
    if (schemaHash(latestBinding) !== schemaHash(binding!) || schemaHash(latestSnapshot) !== schemaHash(snapshot!)) fail("CANDIDATE_INVALID");
  } catch { fail("CANDIDATE_INVALID"); }
  const chat: OwnerGrokV2vNativeChatContext = Object.freeze({ status: "created", chat_uuid: receipt!.chat_uuid,
    attempt_id: fields.attemptId, model_id: MODEL_ID, profile_schema_hash: binding!.profile_schema_hash,
    source_binding: binding!.source_binding, request_fingerprint: binding!.request_fingerprint,
    intent_fingerprint: binding!.intent_fingerprint, sources: binding!.sources,
    dispatch_allowed: false, backend_acceptance: "UNPROVEN" });
  const state: NativeState = { client, input: fields, auth: fields, chat, binding: binding!,
    requestFingerprint: requestFingerprint!, preDispatchSnapshot: snapshot!, phase: "AVAILABLE", contexts: new Map() };
  chats.set(chat.chat_uuid, state);
  chatsByClient.set(client, chats);
  operations.set(chat, state);
  return chat;
}

export async function startOwnerGrokV2vWithOwnedCandidate(
  input: unknown, packet: unknown, signal?: AbortSignal
): Promise<OwnerGrokV2vNativeStartAck> {
  const invocation = await consumeInvocation(input, packet, "start"), client = invocation.client;
  const start = invocation.callback as (chatUuid: string, body: Record<string, unknown>, signal?: AbortSignal) => Promise<OwnerGrokV2vNativeStartAck>;
  let fields: NativeInput & { readonly chat?: OwnerGrokV2vNativeChatContext };
  try { fields = readOperation(input, true); } catch { fail("INVALID_REQUEST"); }
  const state = stateFor(client, fields.chat);
  if (!sameOperation(state.input, fields)) fail("CHAT_CONTEXT_INVALID");
  if (state.phase !== "AVAILABLE") fail("CHAT_NOT_DISPATCHED");
  if (aborted(signal)) fail("REQUEST_ABORTED");

  let snapshot: RequestSnapshot;
  let body: Readonly<Record<string, unknown>>;
  try {
    await validateCandidate(fields);
    await assertCurrent(state.auth, signal);
    await fields.preparer.revalidateCandidate(fields.candidate);
    await assertCurrent(state.auth, signal);
    const binding = currentBinding(fields), request = fields.preparer.getPrivateRequest(fields.candidate);
    if (schemaHash(binding) !== schemaHash(state.binding) || schemaHash(request) !== state.requestFingerprint ||
        !exactPreparedRequest(request, binding)) fail("CANDIDATE_INVALID");
    snapshot = captureRequest(fields, client, binding);
    if (schemaHash(snapshot) !== schemaHash(state.preDispatchSnapshot)) fail("CANDIDATE_INVALID");
    await revalidatePermit(fields);
    await assertCurrent(state.auth, signal);
    consumePermit(fields);
    state.dispatchSnapshot = snapshot;
    body = Object.freeze({ chat_id: state.chat.chat_uuid, prompt: snapshot.prompt, settings: snapshot.settings });
  } catch { fail("CANDIDATE_INVALID"); }

  state.phase = "OUTCOME_UNKNOWN";
  try {
    const ack = await start(state.chat.chat_uuid, body!, signal);
    if (aborted(signal) || ack.chat_uuid !== state.chat.chat_uuid || !safeId(ack.message_id)) fail("OUTCOME_UNKNOWN");
    state.ownerEcho = ack.message_id;
    state.phase = "ACKNOWLEDGED";
    await assertCurrent(state.auth, signal);
    return Object.freeze({ chat_uuid: ack.chat_uuid, message_id: ack.message_id });
  } catch { state.phase = "OUTCOME_UNKNOWN"; fail("OUTCOME_UNKNOWN"); }
}

export async function listOwnerGrokV2vNativeCandidates(
  input: unknown, packet: unknown, signal?: AbortSignal
): Promise<OwnerGrokV2vNativeResultCandidates> {
  const invocation = await consumeInvocation(input, packet, "list"), client = invocation.client;
  const getPage = invocation.callback as (chatUuid: string, page: number, pageSize: number, signal?: AbortSignal) => Promise<unknown>;
  let fields: NativeInput & { readonly chat?: OwnerGrokV2vNativeChatContext };
  try { fields = readOperation(input, true); } catch { fail("INVALID_REQUEST"); }
  const state = stateFor(client, fields.chat);
  if (!sameOperation(state.input, fields)) fail("CHAT_CONTEXT_INVALID");
  if (state.phase !== "ACKNOWLEDGED" || !state.dispatchSnapshot || !state.ownerEcho) {
    return emptyCandidates("UNVERIFIED", "MISSING", "ABSENT", "NOT_READ", 0, "POST_ACK_UNAVAILABLE");
  }
  if (aborted(signal)) fail("REQUEST_ABORTED");
  await assertCurrent(state.auth, signal);

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
        if (row.chat_id !== undefined && providerChatId !== undefined && row.chat_id !== providerChatId) {
          return emptyCandidates("UNVERIFIED", "MISSING", "ABSENT", "INCOMPLETE", calls, "HISTORY_JOIN_INVALID");
        }
        if (row.chat_id !== undefined) providerChatId = row.chat_id;
        if (messageIds.has(row.id) || row.message_object.some((object) => object.message_id !== row.id || objectIds.has(object.id))) {
          return emptyCandidates("UNVERIFIED", "MISSING", "ABSENT", "INCOMPLETE", calls, "HISTORY_JOIN_INVALID");
        }
        messageIds.add(row.id);
        for (const object of row.message_object) objectIds.add(object.id);
        rows.push(row);
      }
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
  const ownerRequestRows = rows.filter((row) => row.author_id > 0 &&
    row.message_object.some((object) => object.object_type === "text" || object.object_type === "video"));
  if (ownerRequestRows.length !== 1 || ownerRequestRows[0]?.id !== state.ownerEcho) {
    return Object.freeze({ ...emptyCandidates("UNVERIFIED", "MATCHED", "PARTIAL_UNPROVEN", "COMPLETE", calls,
      "HISTORY_ADDITIONAL_OWNER_REQUEST"), total_count: totalCount, total_pages: totalPages,
      provider_chat_id: providerChatId, owner_echo_message_id: state.ownerEcho });
  }
  const echo = inspectRequestEcho(ackRows[0]!, state.dispatchSnapshot);
  if (echo === "CONTRADICTORY") {
    return Object.freeze({ ...emptyCandidates("UNVERIFIED", "MATCHED", echo, "COMPLETE", calls, "OWNER_REQUEST_ECHO_CONTRADICTORY"),
      total_count: totalCount, total_pages: totalPages, provider_chat_id: providerChatId,
      owner_echo_message_id: state.ownerEcho });
  }

  const found: Array<Readonly<{ context: OwnerGrokV2vNativeResultContext; codec: ResultCodec }>> = [];
  const gaps: string[] = [];
  let foundVideoCount = 0;
  for (const row of rows) {
    if (row.author_id !== BOT_AUTHOR_ID) continue;
    const videos = row.message_object.filter((object) => object.object_type === "video");
    if (videos.length === 0) continue;
    if (videos.length > MAX_VIDEO_OBJECTS || videos.some((video) => video.model_type !== MODEL_ID || video.completed !== true ||
        typeof video.object_url !== "string" || !isSafeUploadReferenceUrl(video.object_url))) {
      gaps.push("BOT_VIDEO_MODEL_COMPLETION_OR_OBJECT_MISMATCH");
      continue;
    }
    if (foundVideoCount + videos.length > MAX_VIDEO_OBJECTS) { gaps.push("RESULT_VIDEO_LIMIT_EXCEEDED"); continue; }
    foundVideoCount += videos.length;
    const ids = Object.freeze(videos.map((video) => video.id));
    const codec: ResultCodec = Object.freeze({ chat_uuid: state.chat.chat_uuid, message_id: row.id,
      model_id: MODEL_ID, provider_chat_id: providerChatId, message_object_ids: ids });
    const context: OwnerGrokV2vNativeResultContext = Object.freeze({ ...codec, attempt_id: state.chat.attempt_id,
      profile_schema_hash: state.chat.profile_schema_hash, source_binding: state.chat.source_binding,
      request_fingerprint: state.chat.request_fingerprint, intent_fingerprint: state.chat.intent_fingerprint,
      owner_echo_message_id: state.ownerEcho });
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

export async function getOwnerGrokV2vNativeResult(
  input: unknown, packet: unknown, signal?: AbortSignal
): Promise<OwnerGrokV2vNativeResult> {
  const invocation = await consumeInvocation(input, packet, "get"), client = invocation.client;
  const getMessage = invocation.callback as (chatUuid: string, messageId: string, signal?: AbortSignal) => Promise<unknown>;
  let fields: Readonly<OwnerGrokV2vNativeResultReadInput & { readonly principal: Readonly<GenerationPrincipalRef>; readonly binding: Readonly<AuthBinding> }>;
  try { fields = readResultReadInput(input); } catch { fail("RESULT_CONTEXT_INVALID"); }
  const owned = resultContexts.get(fields.result_context as object);
  if (!owned || owned.client !== client || owned.context !== fields.result_context || owned.state.phase !== "ACKNOWLEDGED" ||
      owned.state.ownerEcho !== owned.context.owner_echo_message_id || operations.get(owned.state.chat) !== owned.state ||
      owned.state.chat.attempt_id !== fields.attemptId || owned.state.chat.intent_fingerprint !== owned.context.intent_fingerprint ||
      owned.state.client !== client || !sameGenerationPrincipal(fields.principal, owned.state.auth.principal) ||
      !sameBinding(fields.binding, owned.state.auth.binding) || fields.linkService !== owned.state.auth.linkService ||
      owned.state.chat.profile_schema_hash !== owned.context.profile_schema_hash ||
      schemaHash(owned.state.chat.source_binding) !== schemaHash(owned.context.source_binding)) fail("RESULT_CONTEXT_INVALID");
  if (aborted(signal)) fail("REQUEST_ABORTED");
  await assertCurrent(owned.state.auth, signal);
  try {
    let raw: unknown;
    try { raw = await getMessage(owned.codec.chat_uuid, owned.codec.message_id, signal); }
    finally { await assertCurrent(owned.state.auth, signal); }
    return decodeResult(raw, owned.codec);
  } catch { if (aborted(signal)) fail("REQUEST_ABORTED"); fail("RESULT_GET_UNAVAILABLE"); }
}

export function readOwnerGrokV2vNativeDispatchStatus(client: unknown, chatInput: unknown): OwnerGrokV2vNativeDispatchStatus | null {
  if (!isExactNativeClient(client) || !chatInput || typeof chatInput !== "object" || types.isProxy(chatInput)) return null;
  const state = operations.get(chatInput as object);
  if (!state || state.client !== client || state.chat !== chatInput || chatsByClient.get(state.client)?.get(state.chat.chat_uuid) !== state) return null;
  return Object.freeze({ chat_uuid: state.chat.chat_uuid, attempt_id: state.chat.attempt_id, model_id: MODEL_ID,
    phase: state.phase, dispatch_attempted: state.phase !== "AVAILABLE",
    owner_ack_bound: state.phase === "ACKNOWLEDGED" && !!state.ownerEcho,
    owner_echo_message_id: state.phase === "ACKNOWLEDGED" ? state.ownerEcho ?? null : null });
}

async function consumeInvocation(input: unknown, packet: unknown, method: "create" | "start" | "list" | "get"): Promise<Invocation> {
  try {
    const native = await import("./chat-http-client.js");
    return native.consumeOwnerGrokV2vNativeInvocation(input, packet, method);
  } catch { fail("INVALID_REQUEST"); }
}

function validateCandidate(fields: NativeInput): Promise<Readonly<OwnerGrokV2vOwnedCandidateBinding>> {
  return validateCandidateAsync();
  async function validateCandidateAsync(): Promise<Readonly<OwnerGrokV2vOwnedCandidateBinding>> {
    if (!isOwnerGrokV2vOwnedRequestPreparerBoundToReferenceService(fields.preparer, fields.referenceService) ||
        !isOwnerGrokV2vOwnedPreparedCandidate(fields.candidate) || !isNativeReferenceService(fields.referenceService) ||
        !isNativePreparer(fields.preparer)) fail("CANDIDATE_INVALID");
    const binding = currentBinding(fields);
    assertCandidateBindings(fields, binding);
    const request = fields.preparer.getPrivateRequest(fields.candidate);
    if (!exactPreparedRequest(request, binding)) fail("CANDIDATE_INVALID");
    await fields.preparer.revalidateCandidate(fields.candidate);
    return binding;
  }
}

function assertCandidateBindings(fields: NativeInput, binding: Readonly<OwnerGrokV2vOwnedCandidateBinding>): void {
  const profile = getOwnerGrokV2vSourceProfile(MODEL_ID), candidate = fields.candidate;
  const source = binding.sources[0];
  const candidateRecord = exact(candidate, ["status", "dispatch_allowed", "runtime_usable", "backend_acceptance", "model_id",
    "profile_schema_hash", "source_binding", "request_fingerprint", "intent_fingerprint", "sources", "expires_at"]);
  if (!profile || profile.status !== "SOURCE_REVIEWED_STATIC_ONLY" || profile.runtime_usable !== false || profile.dispatch_allowed !== false ||
      profile.backend_acceptance !== "UNPROVEN" || profile.model_id !== MODEL_ID || profile.ai_name !== AI_NAME ||
      binding.attempt_id !== fields.attemptId || !sameGenerationPrincipal(binding.principal, fields.principal) ||
      fields.principal.connection_id !== fields.attemptId || binding.model_id !== MODEL_ID || candidateRecord.model_id !== MODEL_ID ||
      candidateRecord.status !== "blocked" || candidateRecord.dispatch_allowed !== false || candidateRecord.runtime_usable !== false ||
      candidateRecord.backend_acceptance !== "UNPROVEN" || binding.profile_schema_hash !== schemaHash(profile) ||
      candidateRecord.profile_schema_hash !== binding.profile_schema_hash ||
      schemaHash(binding.source_binding) !== schemaHash(profile.source_pins) ||
      schemaHash(candidateRecord.source_binding) !== schemaHash(profile.source_pins) ||
      candidateRecord.request_fingerprint !== binding.request_fingerprint || candidateRecord.intent_fingerprint !== binding.intent_fingerprint ||
      candidateRecord.expires_at !== binding.expires_at || schemaHash(candidateRecord.sources) !== schemaHash(binding.sources) ||
      !/^sha256:[a-f0-9]{64}$/u.test(binding.profile_schema_hash) || !/^sha256:[a-f0-9]{64}$/u.test(binding.request_fingerprint) ||
      !/^sha256:[a-f0-9]{64}$/u.test(binding.intent_fingerprint) || !Number.isSafeInteger(binding.expires_at) ||
      !Number.isSafeInteger(binding.reference_expires_at) || binding.reference_expires_at < binding.expires_at ||
      !Number.isSafeInteger(binding.reference_epoch) || binding.reference_epoch < 0 ||
      !/^[a-f0-9]{64}$/u.test(binding.prompt_sha256) || !Number.isSafeInteger(binding.prompt_utf8_bytes) ||
      binding.prompt_utf8_bytes < 1 || binding.prompt_utf8_bytes > profile.prompt.max_length_utf16 * 4 ||
      !/^grok_v2v_reference_[0-9a-f-]{36}$/u.test(binding.grok_reference_handle)) fail("CANDIDATE_INVALID");
  if (binding.sources.length !== 1 || candidate.sources.length !== 1 || !source || source.wire_type !== "video" ||
      (source.mime_type !== "video/mp4" && source.mime_type !== "video/quicktime") ||
      !/^[a-f0-9]{64}$/u.test(binding.source_sha256) || source.sha256 !== binding.source_sha256 ||
      !Number.isSafeInteger(binding.source_size) || binding.source_size < 16 || binding.source_size > profile.input.max_file_size_bytes ||
      source.size !== binding.source_size ||
      !positiveInteger(binding.source_width) || !positiveInteger(binding.source_height) ||
      source.width !== binding.source_width || source.height !== binding.source_height ||
      !/^[a-z0-9_+-]{1,64}$/iu.test(source.video_codec) ||
      (source.mime_type === "video/mp4" && source.container !== "ISO_BMFF_MP4") ||
      (source.mime_type === "video/quicktime" && source.container !== "QUICKTIME_MOV") ||
      !finiteWithin(binding.source_duration_seconds, profile.input.total_duration_seconds.minimum, profile.input.total_duration_seconds.maximum) ||
      source.duration_seconds !== binding.source_duration_seconds ||
      source.input_confidence !== "LOCAL_FFPROBE_METADATA_ONLY_NO_DECODE" ||
      source.duration_confidence !== "CONTAINER_DURATION_SECONDS_LOCAL_POLICY") fail("CANDIDATE_INVALID");
  const pixelCount = binding.source_width * binding.source_height;
  if (!Number.isSafeInteger(pixelCount)) fail("CANDIDATE_INVALID");
  const duration = Number(Number(binding.source_duration_seconds).toFixed(2));
  const resolution = pixelCount >= profile.settings_projection.resolution.threshold_pixels_inclusive ? "720p" : "480p";
  if (binding.settings.aspect_ratio !== null || binding.settings.video_duration !== duration || binding.settings.resolution !== resolution ||
      binding.cost_parameters.video_duration !== duration || binding.cost_parameters.resolution !== resolution) fail("CANDIDATE_INVALID");
}

function exactPreparedRequest(value: unknown, binding: Readonly<OwnerGrokV2vOwnedCandidateBinding>): boolean {
  try {
    const request = exact(value, ["prompt", "settings", "cost_parameters"]);
    const settings = exact(request.settings, ["model_type", "aspect_ratio", "video_duration", "resolution", "file_urls"]);
    const cost = exact(request.cost_parameters, ["video_duration", "resolution"]);
    if (typeof request.prompt !== "string" || Buffer.byteLength(request.prompt, "utf8") !== binding.prompt_utf8_bytes ||
        createHash("sha256").update(request.prompt, "utf8").digest("hex") !== binding.prompt_sha256 ||
        settings.model_type !== MODEL_ID || settings.aspect_ratio !== null || settings.video_duration !== binding.settings.video_duration ||
        settings.resolution !== binding.settings.resolution || cost.video_duration !== binding.cost_parameters.video_duration ||
        cost.resolution !== binding.cost_parameters.resolution || !Array.isArray(settings.file_urls) || settings.file_urls.length !== 1) return false;
    const file = exact(settings.file_urls[0], ["type", "url"]);
    return file.type === "video" && typeof file.url === "string" && isSafeUploadReferenceUrl(file.url) &&
      schemaHash(request) === binding.request_fingerprint;
  } catch { return false; }
}

function captureRequest(fields: NativeInput, client: SyntxChatHttpClient,
  binding: Readonly<OwnerGrokV2vOwnedCandidateBinding>): RequestSnapshot {
  const request = fields.preparer.getPrivateRequest(fields.candidate);
  let snapshot: RequestSnapshot | undefined;
  try {
    snapshot = fields.preparer.withCapturedNativeReference(fields.candidate, (capturedClient, context) => {
      if (capturedClient !== client || context.model_id !== MODEL_ID || context.status !== "OWNER_GROK_V2V_ORIGINAL_UPLOADED") fail("CANDIDATE_INVALID");
      const witness = readOwnerGrokV2vUploadReferenceForClient(client, context);
      if (!witness || !isSafeUploadReferenceUrl(witness.url)) fail("CANDIDATE_INVALID");
      const metadata = sourceMeta(context);
      if (!binding.sources[0] || !sameSource(metadata, binding.sources[0])) fail("CANDIDATE_INVALID");
      const files = request.settings.file_urls;
      if (files.length !== 1 || files[0]?.type !== "video" || files[0]?.url !== witness.url) fail("CANDIDATE_INVALID");
      return Object.freeze({ model_id: MODEL_ID, prompt: request.prompt,
        settings: deepFreeze({ ...request.settings, file_urls: [Object.freeze({ type: "video" as const, url: witness.url })] }),
        source: Object.freeze({ wire_type: "video", url: witness.url, metadata }) });
    });
  } catch { fail("CANDIDATE_INVALID"); }
  if (!snapshot || snapshot.model_id !== MODEL_ID || snapshot.prompt !== request.prompt ||
      schemaHash(snapshot.settings) !== schemaHash(request.settings)) fail("CANDIDATE_INVALID");
  return snapshot;
}

function currentBinding(fields: NativeInput): Readonly<OwnerGrokV2vOwnedCandidateBinding> {
  const binding = readOwnerGrokV2vOwnedCandidateBinding(fields.preparer, fields.candidate, fields.referenceService);
  if (!binding) fail("CANDIDATE_INVALID");
  return binding;
}

async function revalidatePermit(fields: NativeInput): Promise<void> {
  await revalidateOwnerGrokV2vOwnedOneShotPermit({ permit: fields.permit, preparer: fields.preparer,
    candidate: fields.candidate, principal: fields.principal, attemptId: fields.attemptId });
}
function consumePermit(fields: NativeInput): void {
  consumeOwnerGrokV2vOwnedOneShotPermit({ permit: fields.permit, preparer: fields.preparer,
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
    if (error instanceof OwnerGrokV2vNativeError) throw error;
    if (aborted(signal)) fail("REQUEST_ABORTED");
    if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
    fail("PRINCIPAL_NOT_LINKED");
  }
}

function stateFor(client: SyntxChatHttpClient, value: unknown): NativeState {
  if (!value || typeof value !== "object" || types.isProxy(value)) fail("CHAT_CONTEXT_INVALID");
  const state = operations.get(value as object);
  if (!state || state.client !== client || state.chat !== value || chatsByClient.get(client)?.get(state.chat.chat_uuid) !== state) fail("CHAT_CONTEXT_INVALID");
  return state;
}

function readOperation(value: unknown, withChat: boolean): NativeInput & { readonly chat?: OwnerGrokV2vNativeChatContext } {
  const fields = exact(value, ["preparer", "candidate", "permit", "referenceService", "principal", "attemptId", "linkService", "binding",
    ...(withChat ? ["chat"] : [])]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || !fields.candidate || typeof fields.candidate !== "object" ||
      types.isProxy(fields.candidate) || !fields.permit || typeof fields.permit !== "object" || types.isProxy(fields.permit)) fail("INVALID_REQUEST");
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); } catch { fail("INVALID_REQUEST"); }
  const binding = exact(fields.binding, ["tenant_id", "subject"]);
  if (typeof binding.tenant_id !== "string" || typeof binding.subject !== "string" || principal.connection_id !== fields.attemptId) fail("INVALID_REQUEST");
  if (!isNativeReferenceService(fields.referenceService) || !isNativePreparer(fields.preparer) ||
      !isOwnerGrokV2vOwnedRequestPreparerBoundToReferenceService(fields.preparer, fields.referenceService)) fail("INVALID_REQUEST");
  return Object.freeze({ preparer: fields.preparer as OwnerGrokV2vOwnedRequestPreparer,
    candidate: fields.candidate as OwnerGrokV2vOwnedPreparedCandidate, permit: fields.permit as OwnerGrokV2vOwnedOneShotPermit,
    referenceService: fields.referenceService as OwnerGrokV2vOriginalReferenceService, principal, attemptId: fields.attemptId,
    linkService: fields.linkService as PerUserLinkService,
    binding: Object.freeze({ tenant_id: binding.tenant_id, subject: binding.subject }),
    ...(withChat ? { chat: fields.chat as OwnerGrokV2vNativeChatContext } : {}) });
}

function readResultReadInput(value: unknown): Readonly<OwnerGrokV2vNativeResultReadInput & {
  readonly principal: Readonly<GenerationPrincipalRef>; readonly binding: Readonly<AuthBinding>
}> {
  const fields = exact(value, ["result_context", "principal", "attemptId", "linkService", "binding"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId)) fail("RESULT_CONTEXT_INVALID");
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); } catch { fail("RESULT_CONTEXT_INVALID"); }
  const binding = exact(fields.binding, ["tenant_id", "subject"]);
  if (typeof binding.tenant_id !== "string" || typeof binding.subject !== "string" || principal.connection_id !== fields.attemptId ||
      !fields.result_context || typeof fields.result_context !== "object" || types.isProxy(fields.result_context)) fail("RESULT_CONTEXT_INVALID");
  return Object.freeze({ result_context: fields.result_context as OwnerGrokV2vNativeResultContext, principal,
    attemptId: fields.attemptId, linkService: fields.linkService as PerUserLinkService,
    binding: Object.freeze({ tenant_id: binding.tenant_id, subject: binding.subject }) });
}

function sameOperation(a: NativeInput, b: NativeInput & { readonly chat?: OwnerGrokV2vNativeChatContext }): boolean {
  return a.preparer === b.preparer && a.candidate === b.candidate && a.permit === b.permit &&
    a.referenceService === b.referenceService && a.attemptId === b.attemptId && a.linkService === b.linkService &&
    sameGenerationPrincipal(a.principal, b.principal) && sameBinding(a.binding, b.binding);
}
function sameBinding(a: AuthBinding, b: AuthBinding): boolean { return a.tenant_id === b.tenant_id && a.subject === b.subject; }

function inspectRequestEcho(row: HistoryRow, snapshot: RequestSnapshot): OwnerGrokV2vNativeRequestEchoStatus {
  const texts = row.message_object.filter((object) => object.object_type === "text" && typeof object.object_text === "string");
  if (texts.length > 1 || texts.some((object) => object.object_text !== snapshot.prompt)) return "CONTRADICTORY";
  const media = row.message_object.filter((object) => object.object_type === "video");
  const matchingUrls = new Set<string>();
  let hasEcho = texts.length > 0;
  for (const item of media) {
    const hasModel = item.model_type !== undefined && item.model_type !== null;
    const hasUrl = item.object_url !== undefined && item.object_url !== null;
    if (!hasModel && !hasUrl) continue;
    hasEcho = true;
    if (hasModel && item.model_type !== MODEL_ID) return "CONTRADICTORY";
    if (hasUrl) {
      if (typeof item.object_url !== "string" || !isSafeUploadReferenceUrl(item.object_url) ||
          item.object_url !== snapshot.source.url || matchingUrls.has(item.object_url)) return "CONTRADICTORY";
      matchingUrls.add(item.object_url);
    }
  }
  if (!hasEcho) return "ABSENT";
  return texts.length === 1 && matchingUrls.size === 1 && media.some((item) => item.model_type === MODEL_ID) ? "MATCHED" : "PARTIAL_UNPROVEN";
}

function decodeResult(raw: unknown, expected: ResultCodec): OwnerGrokV2vNativeResult {
  try {
    const message = dataRecord(raw);
    if (!message || normalizeId(message.id) !== expected.message_id || message.author_id !== BOT_AUTHOR_ID ||
        normalizeChatId(message.chat_id) !== expected.provider_chat_id) return resultGap("UNVERIFIED", "MISMATCH", "MESSAGE_BINDING_MISMATCH");
    if (!Array.isArray(message.message_object) || types.isProxy(message.message_object) || message.message_object.length > 64) {
      return resultGap("BOUND", "UNKNOWN", "MESSAGE_OBJECT_ARRAY_INVALID");
    }
    const artifacts: OwnerGrokV2vNativeVideoArtifact[] = [], gaps: string[] = [], seen = new Set<string>();
    const expectedIds = new Set(expected.message_object_ids);
    let modelEcho: OwnerGrokV2vNativeResult["model_echo"] = "MATCHED";
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

interface HistoryObject {
  readonly id: string;
  readonly message_id: string;
  readonly object_type: string;
  readonly object_text?: string | null;
  readonly object_url?: string | null;
  readonly model_type?: string | null;
  readonly completed?: boolean;
}
interface HistoryRow { readonly id: string; readonly chat_id?: string; readonly author_id: number; readonly message_object: readonly HistoryObject[]; }
interface HistoryPage { readonly messages: readonly HistoryRow[]; readonly page: number; readonly page_size: number;
  readonly total_count: number; readonly total_pages: number; readonly has_next: boolean; readonly has_previous: boolean; }

function parseHistoryPage(raw: unknown, expectedPage: number): HistoryPage | undefined {
  const page = dataRecord(raw), pagination = page ? dataRecord(page.pagination) : undefined;
  const pageNumber = pagination?.page, pageSize = pagination?.page_size;
  const totalCount = pagination?.total_count, totalPages = pagination?.total_pages;
  if (!page || !pagination || !Array.isArray(page.messages) || types.isProxy(page.messages) || page.messages.length > PAGE_SIZE ||
      typeof pageNumber !== "number" || !Number.isSafeInteger(pageNumber) || pageNumber !== expectedPage || pageSize !== PAGE_SIZE ||
      typeof totalCount !== "number" || !Number.isSafeInteger(totalCount) || totalCount < 0 || totalCount > MESSAGE_LIMIT ||
      typeof totalPages !== "number" || !Number.isSafeInteger(totalPages) || totalPages < 0 || totalPages > PAGE_LIMIT ||
      typeof pagination.has_next !== "boolean" || typeof pagination.has_previous !== "boolean") return undefined;
  if ((totalCount === 0 && totalPages !== 0) || (totalCount > 0 && totalPages !== Math.ceil(totalCount / PAGE_SIZE)) ||
      pagination.has_next !== (expectedPage < totalPages) || pagination.has_previous !== (expectedPage > 1)) return undefined;
  const messages: HistoryRow[] = [];
  for (const rawRow of page.messages) {
    const row = dataRecord(rawRow);
    const id = row && normalizeId(row.id), chatId = row && normalizeChatId(row.chat_id);
    if (!row || !id || !Number.isSafeInteger(row.author_id) || !Array.isArray(row.message_object) || types.isProxy(row.message_object) ||
        row.message_object.length > 64) return undefined;
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
    messages.push(Object.freeze({ id, ...(chatId ? { chat_id: chatId } : {}), author_id: row.author_id as number,
      message_object: Object.freeze(objects) }));
  }
  return Object.freeze({ messages: Object.freeze(messages), page: expectedPage, page_size: PAGE_SIZE,
    total_count: totalCount, total_pages: totalPages, has_next: pagination.has_next, has_previous: pagination.has_previous });
}

function emptyCandidates(status: OwnerGrokV2vNativeResultCandidates["status"], owner: OwnerGrokV2vNativeResultCandidates["owner_ack_status"],
  echo: OwnerGrokV2vNativeRequestEchoStatus, page: OwnerGrokV2vNativeResultCandidates["history_page_status"], calls: number, gap: string): OwnerGrokV2vNativeResultCandidates {
  return Object.freeze({ status, owner_ack_status: owner, request_echo_status: echo, history_binding_status: "UNVERIFIED",
    history_page_status: page, history_get_calls: calls, total_count: null, total_pages: null, provider_chat_id: null,
    owner_echo_message_id: null, contexts: Object.freeze([]), gaps: Object.freeze([gap]), backend_acceptance: "UNPROVEN" });
}
function resultGap(binding: OwnerGrokV2vNativeResult["message_binding"], model: OwnerGrokV2vNativeResult["model_echo"], gap: string): OwnerGrokV2vNativeResult {
  return Object.freeze({ message_binding: binding, model_echo: model, provider_terminal_status: "UNPROVEN",
    artifacts: Object.freeze([]), gaps: Object.freeze([gap]), backend_acceptance: "UNPROVEN" });
}
function safeVideoMime(url: string): OwnerGrokV2vNativeVideoArtifact["mime_type"] {
  try { const path = new URL(url).pathname.toLowerCase(); if (path.endsWith(".mp4")) return "video/mp4"; if (path.endsWith(".mov")) return "video/quicktime"; }
  catch { return null; }
  return null;
}

function sourceMeta(context: OwnerGrokV2vUploadContext): OwnerGrokV2vOwnedSourceMetadata {
  if (context.model_id !== MODEL_ID || context.status !== "OWNER_GROK_V2V_ORIGINAL_UPLOADED" || context.ai_name !== AI_NAME) fail("CANDIDATE_INVALID");
  return Object.freeze({ wire_type: "video", mime_type: context.mime_type, size: context.size, sha256: context.sha256,
    width: context.metadata.video.width, height: context.metadata.video.height,
    duration_seconds: context.metadata.duration_seconds, container: context.metadata.container,
    video_codec: context.metadata.video.codec_name, duration_confidence: context.metadata.duration_confidence,
    input_confidence: "LOCAL_FFPROBE_METADATA_ONLY_NO_DECODE" });
}
function sameSource(a: OwnerGrokV2vOwnedSourceMetadata, b: OwnerGrokV2vOwnedSourceMetadata): boolean {
  return schemaHash(a) === schemaHash(b);
}
function positiveInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function finiteWithin(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}
function safeId(value: unknown): value is string { return typeof value === "string" && ID.test(value); }
function normalizeId(value: unknown): string | undefined {
  const id = typeof value === "string" ? value : typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined;
  return id && ID.test(id) ? id : undefined;
}
function normalizeChatId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return typeof value === "string" && /^\d{1,16}$/u.test(value) ? value : undefined;
}
function aborted(signal?: AbortSignal): boolean {
  return !!signal && (types.isProxy(signal) || !(signal instanceof AbortSignal) || signal.aborted);
}

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
    const proto = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (proto !== Object.prototype && proto !== null) return undefined;
    if (keys.some((key) => typeof key !== "string" || !Object.hasOwn(descriptors[key]!, "value"))) return undefined;
    const out = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) out[key] = descriptors[key]!.value;
    return out;
  } catch { return undefined; }
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
function isNativeReferenceService(value: unknown): value is OwnerGrokV2vOriginalReferenceService {
  return !!value && typeof value === "object" && !types.isProxy(value) && value instanceof OwnerGrokV2vOriginalReferenceService &&
    Object.getPrototypeOf(value) === OwnerGrokV2vOriginalReferenceService.prototype &&
    OwnerGrokV2vOriginalReferenceService.prototype.resolveReference === NATIVE_REFERENCE_METHODS.resolve &&
    OwnerGrokV2vOriginalReferenceService.prototype.isOwnedReferenceResolution === NATIVE_REFERENCE_METHODS.guard &&
    OwnerGrokV2vOriginalReferenceService.prototype.withCapturedNativeReference === NATIVE_REFERENCE_METHODS.capture &&
    OwnerGrokV2vOriginalReferenceService.prototype.invalidateAttempt === NATIVE_REFERENCE_METHODS.invalidate &&
    OwnerGrokV2vOriginalReferenceService.prototype.close === NATIVE_REFERENCE_METHODS.close &&
    getDataMethod(value, "resolveReference") === NATIVE_REFERENCE_METHODS.resolve &&
    getDataMethod(value, "isOwnedReferenceResolution") === NATIVE_REFERENCE_METHODS.guard &&
    getDataMethod(value, "withCapturedNativeReference") === NATIVE_REFERENCE_METHODS.capture;
}
function isNativePreparer(value: unknown): value is OwnerGrokV2vOwnedRequestPreparer {
  return isOwnerGrokV2vOwnedRequestPreparer(value) &&
    OwnerGrokV2vOwnedRequestPreparer.prototype.prepare === NATIVE_PREPARER_METHODS.prepare &&
    OwnerGrokV2vOwnedRequestPreparer.prototype.inspectCandidate === NATIVE_PREPARER_METHODS.inspect &&
    OwnerGrokV2vOwnedRequestPreparer.prototype.getPrivateRequest === NATIVE_PREPARER_METHODS.request &&
    OwnerGrokV2vOwnedRequestPreparer.prototype.revalidateCandidate === NATIVE_PREPARER_METHODS.revalidate &&
    OwnerGrokV2vOwnedRequestPreparer.prototype.withCapturedNativeReference === NATIVE_PREPARER_METHODS.capture &&
    OwnerGrokV2vOwnedRequestPreparer.prototype.isBoundToReferenceService === NATIVE_PREPARER_METHODS.bound &&
    OwnerGrokV2vOwnedRequestPreparer.prototype.invalidateAttempt === NATIVE_PREPARER_METHODS.invalidate &&
    OwnerGrokV2vOwnedRequestPreparer.prototype.close === NATIVE_PREPARER_METHODS.close &&
    ["prepare", "inspectCandidate", "getPrivateRequest", "revalidateCandidate", "withCapturedNativeReference", "isBoundToReferenceService", "invalidateAttempt", "close"]
      .every((key) => getDataMethod(value, key) === getDataMethod(OwnerGrokV2vOwnedRequestPreparer.prototype, key));
}
function isExactNativeClient(client: unknown): client is SyntxChatHttpClient {
  try {
    const names = ["createChat", "uploadGrokV2vOriginal", "createOwnerGrokV2vChat", "startGrokV2vWithOwnedCandidate",
      "listOwnedGrokV2vCandidates", "getOwnedGrokV2vResult"];
    return !!client && typeof client === "object" && !types.isProxy(client) && Object.getPrototypeOf(client) === SyntxChatHttpClient.prototype &&
      !names.some((name) => Object.hasOwn(client, name)) &&
      getDataMethod(client, "createChat") === NATIVE_CLIENT_METHODS.createChat &&
      getDataMethod(client, "uploadGrokV2vOriginal") === NATIVE_CLIENT_METHODS.upload &&
      getDataMethod(client, "createOwnerGrokV2vChat") === NATIVE_CLIENT_METHODS.create &&
      getDataMethod(client, "startGrokV2vWithOwnedCandidate") === NATIVE_CLIENT_METHODS.start &&
      getDataMethod(client, "listOwnedGrokV2vCandidates") === NATIVE_CLIENT_METHODS.list &&
      getDataMethod(client, "getOwnedGrokV2vResult") === NATIVE_CLIENT_METHODS.get;
  } catch { return false; }
}
function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}
function fail(code: OwnerGrokV2vNativeErrorCode): never { throw new OwnerGrokV2vNativeError(code); }
