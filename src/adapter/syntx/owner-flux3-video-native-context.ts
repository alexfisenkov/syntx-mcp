import { randomUUID, createHash } from "node:crypto";
import { types } from "node:util";
import { z } from "zod/v4";
import type { AuthBinding } from "../../auth/types.js";
import { PerUserLinkService } from "../../auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../../domain/generation-principal.js";
import { schemaHash } from "../../domain/generation-contract.js";
import { OwnerFlux3MediaReferenceService } from "../../application/owner-flux3-media-reference-service.js";
import {
  consumeOwnerFlux3VideoOwnedOneShotPermit,
  revalidateOwnerFlux3VideoOwnedOneShotPermit,
  type OwnerFlux3VideoOwnedOneShotPermit
} from "../../application/owner-flux3-video-owned-one-shot-policy.js";
import {
  isOwnerFlux3VideoOwnedPreparedCandidate,
  isOwnerFlux3VideoOwnedRequestPreparer,
  isOwnerFlux3VideoOwnedRequestPreparerBoundToReferenceService,
  readOwnerFlux3VideoOwnedCandidateBinding,
  OwnerFlux3VideoOwnedRequestPreparer,
  type OwnerFlux3VideoOwnedCandidateBinding,
  type OwnerFlux3VideoOwnedPreparedCandidate,
  type OwnerFlux3VideoOwnedPreparedRequest,
} from "../../application/owner-flux3-video-owned-request-preparer.js";
import {
  getOwnerFlux3VideoSourceProfile,
  type OwnerFlux3VideoModelId,
  type OwnerFlux3VideoSourceProfile
} from "../../application/owner-flux3-video-source-profile.js";
import {
  normalizeOwnerFlux3VideoParameters,
  projectOwnerFlux3VideoWireSettings,
  type OwnerFlux3VideoParameterValues
} from "../../application/owner-flux3-video-parameters.js";
import { readOwnerFlux3UploadReferenceForClient, SyntxChatHttpClient } from "./chat-http-client.js";
import type {
  OwnerFlux3UploadContext,
  OwnerFlux3I2vImageUploadContext,
  OwnerFlux3V2vOriginalUploadContext
} from "./flux3-media-upload.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const PAGE_SIZE = 10, PAGE_LIMIT = 7, MESSAGE_LIMIT = 64, MAX_RESULT_VIDEOS = 64, BOT_AUTHOR_ID = -1, CHAT_LIMIT = 128;
const operations = new WeakMap<object, NativeState>();
const chatsByClient = new WeakMap<object, Map<string, NativeState>>();
const resultContexts = new WeakMap<object, ResultState>();
const issuedPermits = new WeakSet<object>();
const pendingPermits = new WeakSet<object>();
const NATIVE_REFERENCE_METHODS = Object.freeze({
  upload: OwnerFlux3MediaReferenceService.prototype.uploadReference,
  resolve: OwnerFlux3MediaReferenceService.prototype.resolveReference,
  guard: OwnerFlux3MediaReferenceService.prototype.isOwnedReferenceResolution,
  capture: OwnerFlux3MediaReferenceService.prototype.withCapturedNativeReference,
  invalidate: OwnerFlux3MediaReferenceService.prototype.invalidateAttempt,
  close: OwnerFlux3MediaReferenceService.prototype.close
});
const NATIVE_PREPARER_METHODS = Object.freeze({
  prepare: OwnerFlux3VideoOwnedRequestPreparer.prototype.prepare,
  inspect: OwnerFlux3VideoOwnedRequestPreparer.prototype.inspectCandidate,
  request: OwnerFlux3VideoOwnedRequestPreparer.prototype.getPrivateRequest,
  capture: OwnerFlux3VideoOwnedRequestPreparer.prototype.withCapturedNativeReferences,
  bound: OwnerFlux3VideoOwnedRequestPreparer.prototype.isBoundToReferenceService,
  revalidate: OwnerFlux3VideoOwnedRequestPreparer.prototype.revalidateCandidate,
  invalidate: OwnerFlux3VideoOwnedRequestPreparer.prototype.invalidateAttempt,
  close: OwnerFlux3VideoOwnedRequestPreparer.prototype.close
});
const NATIVE_LINK_STATUS = PerUserLinkService.prototype.getStatus;
const NATIVE_CLIENT_METHODS = Object.freeze({
  createChat: SyntxChatHttpClient.prototype.createChat,
  uploadFlux3I2vImage: SyntxChatHttpClient.prototype.uploadFlux3I2vImage,
  uploadFlux3V2vOriginal: SyntxChatHttpClient.prototype.uploadFlux3V2vOriginal,
  create: SyntxChatHttpClient.prototype.createOwnerFlux3VideoChat,
  start: SyntxChatHttpClient.prototype.startFlux3VideoWithOwnedCandidate,
  list: SyntxChatHttpClient.prototype.listOwnedFlux3VideoCandidates,
  get: SyntxChatHttpClient.prototype.getOwnedFlux3VideoResult
});

export interface OwnerFlux3VideoNativeOperationInput {
  readonly preparer: OwnerFlux3VideoOwnedRequestPreparer;
  readonly candidate: OwnerFlux3VideoOwnedPreparedCandidate;
  readonly permit: OwnerFlux3VideoOwnedOneShotPermit;
  readonly referenceService: OwnerFlux3MediaReferenceService;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly linkService: PerUserLinkService;
  readonly binding: AuthBinding;
}

export interface OwnerFlux3VideoNativeChatContext {
  readonly status: "created";
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly model_id: OwnerFlux3VideoModelId;
  readonly profile_schema_hash: string;
  readonly source_binding: OwnerFlux3VideoSourceProfile["source_pins"];
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly sources: readonly OwnerFlux3VideoOwnedCandidateBinding["sources"][number][];
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerFlux3VideoNativeStartAck {
  readonly chat_uuid: string;
  readonly message_id: string;
}

export interface OwnerFlux3VideoNativeDispatchStatus {
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly model_id: OwnerFlux3VideoModelId;
  readonly phase: "AVAILABLE" | "OUTCOME_UNKNOWN" | "ACKNOWLEDGED";
  readonly dispatch_attempted: boolean;
  readonly owner_ack_bound: boolean;
  readonly owner_echo_message_id: string | null;
}

export type OwnerFlux3VideoNativeRequestEchoStatus = "MATCHED" | "ABSENT" | "PARTIAL_UNPROVEN" | "CONTRADICTORY";

export interface OwnerFlux3VideoNativeResultContext {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly model_id: OwnerFlux3VideoModelId;
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly string[];
  readonly attempt_id: string;
  readonly profile_schema_hash: string;
  readonly source_binding: OwnerFlux3VideoSourceProfile["source_pins"];
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly owner_echo_message_id: string;
}

export interface OwnerFlux3VideoNativeResultCandidates {
  readonly status: "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  readonly request_echo_status: OwnerFlux3VideoNativeRequestEchoStatus;
  readonly history_binding_status: "BOUND" | "UNVERIFIED";
  readonly history_page_status: "NOT_READ" | "COMPLETE" | "INCOMPLETE" | "UNPROVEN";
  readonly history_get_calls: number;
  readonly total_count: number | null;
  readonly total_pages: number | null;
  readonly provider_chat_id: string | null;
  readonly owner_echo_message_id: string | null;
  readonly contexts: readonly OwnerFlux3VideoNativeResultContext[];
  readonly gaps: readonly string[];
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerFlux3VideoNativeVideoArtifact {
  readonly object_index: number;
  readonly message_object_id: string;
  readonly object_type: "video";
  readonly object_url: string;
  readonly mime_type: "video/mp4" | "video/quicktime" | null;
  readonly mime_source: "URL_EXTENSION" | "UNKNOWN";
}

export interface OwnerFlux3VideoNativeResult {
  readonly message_binding: "BOUND" | "UNVERIFIED";
  readonly model_echo: "MATCHED" | "UNKNOWN" | "MISMATCH";
  readonly provider_terminal_status: "UNPROVEN";
  readonly artifacts: readonly OwnerFlux3VideoNativeVideoArtifact[];
  readonly gaps: readonly string[];
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerFlux3VideoNativeResultReadInput {
  readonly result_context: OwnerFlux3VideoNativeResultContext;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly linkService: PerUserLinkService;
  readonly binding: AuthBinding;
}

export type OwnerFlux3VideoNativeErrorCode =
  | "INVALID_REQUEST" | "CANDIDATE_INVALID" | "CHAT_CREATE_FAILED" | "CHAT_CREATE_OUTCOME_UNKNOWN"
  | "CHAT_CONTEXT_INVALID" | "CHAT_ALREADY_CREATED" | "CHAT_NOT_DISPATCHED" | "OUTCOME_UNKNOWN"
  | "HISTORY_UNAVAILABLE" | "RESULT_CONTEXT_INVALID" | "RESULT_GET_UNAVAILABLE" | "REQUEST_ABORTED"
  | "CAPACITY_EXCEEDED" | "PRINCIPAL_NOT_LINKED";

export class OwnerFlux3VideoNativeError extends Error {
  constructor(readonly code: OwnerFlux3VideoNativeErrorCode) {
    super("The owner Flux3 video native operation could not be completed safely.");
    this.name = "OwnerFlux3VideoNativeError";
  }
}

interface NativeInput extends OwnerFlux3VideoNativeOperationInput {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly binding: Readonly<AuthBinding>;
}
interface CapturedSource {
  readonly wire_type: "image" | "video";
  readonly url: string;
  readonly metadata: OwnerFlux3VideoOwnedCandidateBinding["sources"][number];
}
interface RequestSnapshot {
  readonly model_id: OwnerFlux3VideoModelId;
  readonly prompt: string;
  readonly settings: Readonly<OwnerFlux3VideoOwnedPreparedRequest["settings"]>;
  readonly sources: readonly CapturedSource[];
}
interface NativeState {
  readonly client: SyntxChatHttpClient;
  readonly input: NativeInput;
  readonly auth: NativeInput;
  readonly chat: OwnerFlux3VideoNativeChatContext;
  readonly binding: Readonly<OwnerFlux3VideoOwnedCandidateBinding>;
  readonly requestFingerprint: string;
  readonly preDispatchSnapshot: RequestSnapshot;
  phase: "AVAILABLE" | "OUTCOME_UNKNOWN" | "ACKNOWLEDGED";
  dispatchSnapshot?: RequestSnapshot;
  ownerEcho?: string;
  readonly contexts: Map<string, OwnerFlux3VideoNativeResultContext>;
}
interface ResultCodec {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly model_id: OwnerFlux3VideoModelId;
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly string[];
}
interface ResultState {
  readonly client: SyntxChatHttpClient;
  readonly state: NativeState;
  readonly context: OwnerFlux3VideoNativeResultContext;
  readonly codec: ResultCodec;
}
interface Invocation {
  readonly client: SyntxChatHttpClient;
  readonly method: "create" | "start" | "list" | "get";
  readonly input: unknown;
  readonly callback: Function;
}
const invocations = new WeakMap<object, Invocation>();

export async function createOwnerFlux3VideoNativeChat(
  input: unknown, packet: unknown, signal?: AbortSignal
): Promise<OwnerFlux3VideoNativeChatContext> {
  const invocation = await consumeInvocation(input, packet, "create"), client = invocation.client;
  const createChat = invocation.callback as (title: string, signal?: AbortSignal) => Promise<{ chat_uuid: string }>;
  let fields: NativeInput;
  try { fields = readOperation(input, false); } catch { fail("INVALID_REQUEST"); }
  if (signal?.aborted) fail("REQUEST_ABORTED");
  let binding: Readonly<OwnerFlux3VideoOwnedCandidateBinding>;
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
  try { receipt = await createChat(`owner-flux3-video-${randomUUID()}`, signal); }
  catch { pendingPermits.delete(fields.permit as object); fail("CHAT_CREATE_OUTCOME_UNKNOWN"); }
  pendingPermits.delete(fields.permit as object);
  if (signal?.aborted || !safeId(receipt.chat_uuid) || chats.has(receipt.chat_uuid)) fail("CHAT_CREATE_OUTCOME_UNKNOWN");
  try {
    await assertCurrent(fields, signal);
    await fields.preparer.revalidateCandidate(fields.candidate);
    await revalidatePermit(fields);
    await assertCurrent(fields, signal);
    const latestBinding = currentBinding(fields);
    const latestSnapshot = captureRequest(fields, client, latestBinding);
    if (schemaHash(latestBinding) !== schemaHash(binding!) || schemaHash(latestSnapshot) !== schemaHash(snapshot!)) fail("CANDIDATE_INVALID");
  } catch { fail("CANDIDATE_INVALID"); }
  const chat: OwnerFlux3VideoNativeChatContext = Object.freeze({ status: "created", chat_uuid: receipt!.chat_uuid,
    attempt_id: fields.attemptId, model_id: binding!.model_id, profile_schema_hash: binding!.profile_schema_hash,
    source_binding: binding!.source_binding, request_fingerprint: binding!.request_fingerprint,
    intent_fingerprint: binding!.intent_fingerprint, sources: binding!.sources,
    dispatch_allowed: false, backend_acceptance: "UNPROVEN" });
  const state: NativeState = { client, input: fields, auth: fields, chat, requestFingerprint: requestFingerprint!,
    binding: binding!, preDispatchSnapshot: snapshot!, phase: "AVAILABLE", contexts: new Map() };
  chats.set(chat.chat_uuid, state);
  chatsByClient.set(client, chats);
  operations.set(chat, state);
  return chat;
}

export async function startOwnerFlux3VideoWithOwnedCandidate(
  input: unknown, packet: unknown, signal?: AbortSignal
): Promise<OwnerFlux3VideoNativeStartAck> {
  const invocation = await consumeInvocation(input, packet, "start"), client = invocation.client;
  const start = invocation.callback as (chatUuid: string, body: Record<string, unknown>, signal?: AbortSignal) => Promise<OwnerFlux3VideoNativeStartAck>;
  let fields: NativeInput & { readonly chat?: OwnerFlux3VideoNativeChatContext };
  try { fields = readOperation(input, true); } catch { fail("INVALID_REQUEST"); }
  const state = stateFor(client, fields.chat);
  if (state.phase !== "AVAILABLE" || !sameOperation(state.input, fields)) fail("CHAT_CONTEXT_INVALID");
  if (signal?.aborted) fail("REQUEST_ABORTED");
  let snapshot: RequestSnapshot;
  let wireBody: Readonly<Record<string, unknown>>;
  try {
    await validateCandidate(fields);
    await assertCurrent(state.auth, signal);
    await fields.preparer.revalidateCandidate(fields.candidate);
    await assertCurrent(state.auth, signal);
    const binding = currentBinding(fields), request = fields.preparer.getPrivateRequest(fields.candidate);
    if (schemaHash(binding) !== schemaHash(state.binding) ||
        schemaHash(request) !== state.requestFingerprint || !exactPreparedRequest(request, binding)) fail("CANDIDATE_INVALID");
    snapshot = captureRequest(fields, client, binding);
    if (snapshot.model_id !== state.chat.model_id || schemaHash(snapshot) !== schemaHash(state.preDispatchSnapshot)) fail("CANDIDATE_INVALID");
    await revalidatePermit(fields);
    await assertCurrent(state.auth, signal);
    consumePermit(fields);
    state.dispatchSnapshot = snapshot;
    wireBody = Object.freeze({ chat_id: state.chat.chat_uuid, prompt: snapshot.prompt,
      settings: snapshot.settings });
  } catch { fail("CANDIDATE_INVALID"); }

  state.phase = "OUTCOME_UNKNOWN";
  try {
    const ack = await start(state.chat.chat_uuid, wireBody!, signal);
    await assertCurrent(state.auth, signal);
    if (signal?.aborted || ack.chat_uuid !== state.chat.chat_uuid || !safeId(ack.message_id)) fail("OUTCOME_UNKNOWN");
    state.ownerEcho = ack.message_id;
    state.phase = "ACKNOWLEDGED";
    return Object.freeze({ chat_uuid: ack.chat_uuid, message_id: ack.message_id });
  } catch { state.phase = "OUTCOME_UNKNOWN"; fail("OUTCOME_UNKNOWN"); }
}

export async function listOwnerFlux3VideoNativeCandidates(
  input: unknown, packet: unknown, signal?: AbortSignal
): Promise<OwnerFlux3VideoNativeResultCandidates> {
  const invocation = await consumeInvocation(input, packet, "list"), client = invocation.client;
  const getPage = invocation.callback as (chatUuid: string, page: number, pageSize: number, signal?: AbortSignal) => Promise<unknown>;
  const fields = readOperation(input, true), state = stateFor(client, fields.chat);
  if (!sameOperation(state.input, fields)) fail("CHAT_CONTEXT_INVALID");
  if (state.phase !== "ACKNOWLEDGED") {
    return emptyCandidates("UNVERIFIED", "MISSING", "ABSENT", "UNPROVEN", 0, "POST_ACK_UNAVAILABLE");
  }
  if (!state.dispatchSnapshot || !state.ownerEcho || signal?.aborted) fail(signal?.aborted ? "REQUEST_ABORTED" : "CHAT_NOT_DISPATCHED");
  await assertCurrent(state.auth, signal);
  await assertCurrent(state.auth, signal);
  const rows: z.infer<typeof historyRowSchema>[] = [];
  const messageIds = new Set<string>(), objectIds = new Set<string>();
  let totalCount: number | undefined, totalPages: number | undefined, providerChatId: string | undefined, calls = 0;
  try {
    for (let page = 1; page <= PAGE_LIMIT; page += 1) {
      await assertCurrent(state.auth, signal);
      calls += 1;
      let raw: unknown;
      try { raw = await getPage(state.chat.chat_uuid, page, PAGE_SIZE, signal); }
      finally { await assertCurrent(state.auth, signal); }
      const parsed = historyPageSchema.safeParse(raw);
      if (!parsed.success) return emptyCandidates("UNVERIFIED", "MISSING", "ABSENT", "UNPROVEN", calls, "HISTORY_PAGE_INVALID");
      const pagination = parsed.data.pagination;
      const expectedPages = pagination.total_count === 0 ? 0 : Math.ceil(pagination.total_count / PAGE_SIZE);
      const expectedRows = Math.min(PAGE_SIZE, Math.max(0, pagination.total_count - (page - 1) * PAGE_SIZE));
      if (pagination.page !== page || pagination.page_size !== PAGE_SIZE || pagination.total_pages !== expectedPages ||
          pagination.has_previous !== (page > 1) || pagination.has_next !== (page < expectedPages) ||
          parsed.data.messages.length !== expectedRows ||
          (totalCount !== undefined && (totalCount !== pagination.total_count || totalPages !== pagination.total_pages))) {
        return emptyCandidates("UNVERIFIED", "MISSING", "ABSENT", "INCOMPLETE", calls, "HISTORY_PAGE_INCONSISTENT");
      }
      totalCount ??= pagination.total_count;
      totalPages ??= pagination.total_pages;
      if (expectedPages === 0) return emptyCandidates("PENDING", "MISSING", "ABSENT", "COMPLETE", calls, "HISTORY_EMPTY");
      for (const rawRow of parsed.data.messages) {
        const row = historyRowSchema.safeParse(rawRow);
        if (!row.success) return emptyCandidates("UNVERIFIED", "MISSING", "ABSENT", "INCOMPLETE", calls, "HISTORY_ROW_INVALID");
        const providerId = String(row.data.chat_id);
        if (!/^\d{1,16}$/u.test(providerId) || (providerChatId !== undefined && providerChatId !== providerId) ||
            messageIds.has(row.data.id) || row.data.message_object.some((object) => object.message_id !== row.data.id || objectIds.has(object.id))) {
          return emptyCandidates("UNVERIFIED", "MISSING", "ABSENT", "INCOMPLETE", calls, "HISTORY_JOIN_INVALID");
        }
        providerChatId ??= providerId;
        messageIds.add(row.data.id);
        for (const object of row.data.message_object) objectIds.add(object.id);
        rows.push(row.data);
      }
      if (page === expectedPages) break;
    }
  } catch {
    if (signal?.aborted) fail("REQUEST_ABORTED");
    return emptyCandidates("UNVERIFIED", "MISSING", "ABSENT", "INCOMPLETE", calls, "HISTORY_UNAVAILABLE");
  }
  if (rows.length !== totalCount || providerChatId === undefined) return emptyCandidates("UNVERIFIED", "MISSING", "ABSENT", "INCOMPLETE", calls, "HISTORY_INCOMPLETE");
  const acknowledgements = rows.filter((row) => row.id === state.ownerEcho && row.author_id > 0);
  if (acknowledgements.length !== 1) {
    const owner = acknowledgements.length > 1 ? "AMBIGUOUS" : "MISSING";
    return Object.freeze({ ...emptyCandidates("INCOMPLETE", owner, "ABSENT", "COMPLETE", calls,
      owner === "AMBIGUOUS" ? "OWNER_ACK_AMBIGUOUS" : "OWNER_ACK_MISSING"),
      total_count: totalCount ?? 0, total_pages: totalPages ?? 0, provider_chat_id: providerChatId,
      owner_echo_message_id: state.ownerEcho ?? null });
  }
  const ackEcho = inspectRequestEcho(acknowledgements[0]!, state.dispatchSnapshot);
  if (ackEcho === "CONTRADICTORY") return Object.freeze({ ...emptyCandidates("UNVERIFIED", "MATCHED", ackEcho,
      "COMPLETE", calls, "OWNER_REQUEST_ECHO_CONTRADICTORY"), total_count: totalCount!, total_pages: totalPages!,
      provider_chat_id: providerChatId, owner_echo_message_id: state.ownerEcho! });

  const discovered: Array<Readonly<{ context: OwnerFlux3VideoNativeResultContext; codec: ResultCodec }>> = [];
  const gaps: string[] = [];
  let discoveredVideoCount = 0;
  for (const row of rows) {
    if (row.author_id !== BOT_AUTHOR_ID) continue;
    const videos = row.message_object.filter((object) => object.object_type === "video");
    if (videos.length === 0) continue;
    if (videos.length > MAX_RESULT_VIDEOS || videos.some((video) => video.model_type !== state.chat.model_id ||
        video.completed !== true || typeof video.object_url !== "string" || !isSafeUploadReferenceUrl(video.object_url))) {
      gaps.push("BOT_VIDEO_MODEL_COMPLETION_OR_OBJECT_MISMATCH");
      continue;
    }
    if (discoveredVideoCount + videos.length > MAX_RESULT_VIDEOS) {
      gaps.push("RESULT_VIDEO_LIMIT_EXCEEDED");
      continue;
    }
    discoveredVideoCount += videos.length;
    const ids = Object.freeze(videos.map((video) => video.id));
    const codec: ResultCodec = Object.freeze({ chat_uuid: state.chat.chat_uuid, message_id: row.id,
      model_id: state.chat.model_id, provider_chat_id: providerChatId, message_object_ids: ids });
    const context: OwnerFlux3VideoNativeResultContext = Object.freeze({ ...codec, attempt_id: state.chat.attempt_id,
      profile_schema_hash: state.chat.profile_schema_hash, source_binding: state.chat.source_binding,
      request_fingerprint: state.chat.request_fingerprint, intent_fingerprint: state.chat.intent_fingerprint,
      owner_echo_message_id: state.ownerEcho! });
    const previous = state.contexts.get(row.id);
    if (previous && schemaHash(previous) !== schemaHash(context)) return emptyCandidates("UNVERIFIED", "MATCHED", ackEcho,
      "UNPROVEN", calls, "RESULT_CONTEXT_MISMATCH");
    discovered.push(Object.freeze({ context: previous ?? context, codec }));
  }
  if (gaps.length > 0) return Object.freeze({ ...emptyCandidates("UNVERIFIED", "MATCHED", ackEcho,
      "COMPLETE", calls, gaps[0]!), total_count: totalCount!, total_pages: totalPages!,
      provider_chat_id: providerChatId, owner_echo_message_id: state.ownerEcho, gaps: Object.freeze(gaps) });
  const contexts = discovered.map(({ context, codec }) => {
    if (!state.contexts.has(context.message_id)) {
      resultContexts.set(context, { client, state, context, codec });
      state.contexts.set(context.message_id, context);
    }
    return state.contexts.get(context.message_id)!;
  });
  return Object.freeze({ status: contexts.length ? "COMPLETE" : "PENDING", owner_ack_status: "MATCHED",
    request_echo_status: ackEcho, history_binding_status: "BOUND", history_page_status: "COMPLETE",
    history_get_calls: calls, total_count: totalCount!, total_pages: totalPages!, provider_chat_id: providerChatId,
    owner_echo_message_id: state.ownerEcho, contexts: Object.freeze(contexts),
    gaps: Object.freeze(contexts.length ? [] : ["BOT_RESULT_NOT_OBSERVED"]), backend_acceptance: "UNPROVEN" });
}

export async function getOwnerFlux3VideoNativeResult(
  input: unknown, packet: unknown, signal?: AbortSignal
): Promise<OwnerFlux3VideoNativeResult> {
  const invocation = await consumeInvocation(input, packet, "get"), client = invocation.client;
  const getMessage = invocation.callback as (chatUuid: string, messageId: string, signal?: AbortSignal) => Promise<unknown>;
  if (!input || typeof input !== "object" || types.isProxy(input)) fail("RESULT_CONTEXT_INVALID");
  const fields = readResultReadInput(input), owned = resultContexts.get(fields.result_context as object);
  if (!owned || owned.client !== client || owned.context !== fields.result_context || owned.state.phase !== "ACKNOWLEDGED" ||
      owned.state.ownerEcho !== owned.context.owner_echo_message_id || operations.get(owned.state.chat) !== owned.state ||
      owned.state.chat.attempt_id !== fields.attemptId || owned.state.chat.intent_fingerprint !== owned.context.intent_fingerprint ||
      owned.state.client !== client || !sameGenerationPrincipal(fields.principal, owned.state.auth.principal) ||
      !sameBinding(fields.binding, owned.state.auth.binding) || fields.linkService !== owned.state.auth.linkService) fail("RESULT_CONTEXT_INVALID");
  if (signal?.aborted) fail("REQUEST_ABORTED");
  await assertCurrent(owned.state.auth, signal);
  try {
    let raw: unknown;
    try { raw = await getMessage(owned.codec.chat_uuid, owned.codec.message_id, signal); }
    finally { await assertCurrent(owned.state.auth, signal); }
    return decodeResult(raw, owned.codec);
  } catch { if (signal?.aborted) fail("REQUEST_ABORTED"); fail("RESULT_GET_UNAVAILABLE"); }
}

/** Internal owner-service proof of POST attempt/ACK; the chat context alone carries neither state. */
export function readOwnerFlux3VideoNativeDispatchStatus(
  client: unknown,
  chatInput: unknown
): OwnerFlux3VideoNativeDispatchStatus | null {
  if (!isExactNativeClient(client) || !chatInput || typeof chatInput !== "object" || types.isProxy(chatInput)) return null;
  const state = operations.get(chatInput as object);
  if (!state || state.client !== client || state.chat !== chatInput ||
      chatsByClient.get(state.client)?.get(state.chat.chat_uuid) !== state) return null;
  return Object.freeze({ chat_uuid: state.chat.chat_uuid, attempt_id: state.chat.attempt_id, model_id: state.chat.model_id,
    phase: state.phase, dispatch_attempted: state.phase !== "AVAILABLE", owner_ack_bound: state.phase === "ACKNOWLEDGED" && !!state.ownerEcho,
    owner_echo_message_id: state.phase === "ACKNOWLEDGED" ? state.ownerEcho ?? null : null });
}

export function consumeOwnerFlux3VideoNativeInvocation(
  input: unknown, packet: unknown, method: "create" | "start" | "list" | "get"
): Readonly<{ client: SyntxChatHttpClient; callback: Function }> {
  if (!packet || typeof packet !== "object" || types.isProxy(packet)) fail("INVALID_REQUEST");
  const invocation = invocations.get(packet as object);
  if (!invocation || invocation.input !== input || invocation.method !== method || !isExactNativeClient(invocation.client)) fail("INVALID_REQUEST");
  invocations.delete(packet as object);
  return Object.freeze({ client: invocation.client, callback: invocation.callback });
}

async function consumeInvocation(input: unknown, packet: unknown, method: "create" | "start" | "list" | "get") {
  try {
    const native = await import("./chat-http-client.js");
    return native.consumeOwnerFlux3VideoNativeInvocation(input, packet, method);
  } catch { fail("INVALID_REQUEST"); }
}

async function validateCandidate(fields: NativeInput): Promise<Readonly<OwnerFlux3VideoOwnedCandidateBinding>> {
  if (!isOwnerFlux3VideoOwnedRequestPreparerBoundToReferenceService(fields.preparer, fields.referenceService) ||
      !isOwnerFlux3VideoOwnedPreparedCandidate(fields.candidate) ||
      !isNativeReferenceService(fields.referenceService) || !isNativePreparer(fields.preparer)) fail("CANDIDATE_INVALID");
  const binding = currentBinding(fields);
  assertCandidateBindings(fields, binding);
  const request = fields.preparer.getPrivateRequest(fields.candidate);
  if (!exactPreparedRequest(request, binding)) fail("CANDIDATE_INVALID");
  return binding;
}

function assertCandidateBindings(fields: NativeInput, binding: Readonly<OwnerFlux3VideoOwnedCandidateBinding>): void {
  const candidate = fields.candidate;
  const profile = getOwnerFlux3VideoSourceProfile(binding.model_id);
  if (!profile || profile.status !== "SOURCE_REVIEWED_STATIC_ONLY" || profile.runtime_usable !== false ||
      profile.dispatch_allowed !== false || profile.backend_acceptance !== "UNPROVEN" ||
      binding.attempt_id !== fields.attemptId || !sameGenerationPrincipal(binding.principal, fields.principal) ||
      fields.principal.connection_id !== fields.attemptId || binding.profile_schema_hash !== schemaHash(profile) ||
      schemaHash(binding.source_binding) !== schemaHash(profile.source_pins) ||
      candidate.model_id !== binding.model_id || candidate.status !== "blocked" || candidate.runtime_usable !== false ||
      candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" ||
      candidate.profile_schema_hash !== binding.profile_schema_hash || candidate.request_fingerprint !== binding.request_fingerprint ||
      candidate.intent_fingerprint !== binding.intent_fingerprint || candidate.expires_at !== binding.expires_at ||
      schemaHash(candidate.sources) !== schemaHash(binding.sources) ||
      binding.control_combination_status !== "SOURCE_ENUMS_EXPLICIT_CONDITIONAL_COMBINATIONS_UNPROVEN" ||
      !/^[a-f0-9]{64}$/u.test(binding.prompt_sha256) || !Number.isSafeInteger(binding.prompt_utf8_bytes) ||
      binding.prompt_utf8_bytes < 0 || binding.prompt_utf8_bytes > 64 * 1024 ||
      !Number.isSafeInteger(binding.expires_at) || binding.expires_at <= 0 ||
      !/^sha256:[a-f0-9]{64}$/u.test(binding.profile_schema_hash) ||
      !/^sha256:[a-f0-9]{64}$/u.test(binding.request_fingerprint) || !/^sha256:[a-f0-9]{64}$/u.test(binding.intent_fingerprint) ||
      candidate.expires_at !== binding.expires_at) fail("CANDIDATE_INVALID");
  if (binding.sources.length < 1 || binding.sources.length > (binding.model_id === "flux3_i2v" ? 10 : 1) ||
      binding.source_sha256s.length !== binding.sources.length ||
      binding.sources.some((source, index) => source.sha256 !== binding.source_sha256s[index] ||
        !/^[a-f0-9]{64}$/u.test(source.sha256) || !Number.isSafeInteger(source.size) || source.size < 1 ||
        source.size > profile.input.max_file_size_bytes ||
        !Number.isSafeInteger(source.width) || source.width < 1 || !Number.isSafeInteger(source.height) || source.height < 1 ||
        source.wire_type !== (binding.model_id === "flux3_i2v" ? "image" : "video") ||
        !sourceMimeAllowed(binding.model_id, source.mime_type) ||
        source.input_confidence !== (binding.model_id === "flux3_i2v" ? "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED" : "LOCAL_FFPROBE_METADATA_ONLY_NO_DECODE") ||
        (source.wire_type === "image" ? source.duration_seconds !== null : typeof source.duration_seconds !== "number" || !Number.isFinite(source.duration_seconds) || source.duration_seconds <= 0))) {
    fail("CANDIDATE_INVALID");
  }
}

function exactPreparedRequest(value: unknown, binding: Readonly<OwnerFlux3VideoOwnedCandidateBinding>): boolean {
  try {
    const request = exact(value, ["prompt", "settings"]);
    const settings = exact(request.settings, ["model_type", "video_duration", "resolution", "aspect_ratio", "generate_audio", "file_urls"]);
    if (typeof request.prompt !== "string" || Buffer.byteLength(request.prompt, "utf8") !== binding.prompt_utf8_bytes ||
        createHash("sha256").update(request.prompt, "utf8").digest("hex") !== binding.prompt_sha256) return false;
    const params: OwnerFlux3VideoParameterValues = binding.parameters;
    const expected = projectOwnerFlux3VideoWireSettings(normalizeOwnerFlux3VideoParameters({ model_id: binding.model_id, parameters: params }));
    const projected = Object.freeze({ model_type: settings.model_type, video_duration: settings.video_duration,
      resolution: settings.resolution, aspect_ratio: settings.aspect_ratio, generate_audio: settings.generate_audio });
    if (schemaHash(expected) !== schemaHash(projected) ||
        !Array.isArray(settings.file_urls) || settings.file_urls.length !== binding.sources.length) return false;
    const urls = settings.file_urls as unknown[];
    return urls.every((item, index) => {
      const file = exact(item, ["type", "url"]);
      const source = binding.sources[index]!;
      return file.type === source.wire_type && typeof file.url === "string" && isSafeUploadReferenceUrl(file.url);
    }) && schemaHash(request) === binding.request_fingerprint;
  } catch { return false; }
}

function captureRequest(fields: NativeInput, client: SyntxChatHttpClient,
  binding: Readonly<OwnerFlux3VideoOwnedCandidateBinding>): RequestSnapshot {
  const request = fields.preparer.getPrivateRequest(fields.candidate);
  let snapshot: RequestSnapshot | undefined;
  try {
    snapshot = fields.preparer.withCapturedNativeReferences(fields.candidate, (capturedClient, contexts) => {
      if (capturedClient !== client || contexts.length < 1 || contexts.length > 10) fail("CANDIDATE_INVALID");
      const all: CapturedSource[] = [];
      const seen = new Map<string, string>();
      const sourceHashByUrl = new Map<string, string>();
      for (const context of contexts) {
        const reference = readOwnerFlux3UploadReferenceForClient(client, context);
        if (!reference) fail("CANDIDATE_INVALID");
        const metadata = contextMetadata(context);
        if (metadata.wire_type !== (binding.model_id === "flux3_i2v" ? "image" : "video")) fail("CANDIDATE_INVALID");
        const key = `${metadata.wire_type}\u0000${reference.url}`;
        const sourceHash = sourceHashByUrl.get(reference.url);
        if (sourceHash !== undefined && sourceHash !== metadata.sha256) fail("CANDIDATE_INVALID");
        sourceHashByUrl.set(reference.url, metadata.sha256);
        const metadataHash = schemaHash(metadata);
        const prior = seen.get(key);
        if (prior !== undefined) {
          if (prior !== metadataHash) fail("CANDIDATE_INVALID");
          continue;
        }
        seen.set(key, metadataHash);
        all.push(Object.freeze({ wire_type: metadata.wire_type, url: reference.url, metadata }));
      }
      if (all.length !== binding.sources.length || all.some((source, index) => schemaHash(source.metadata) !== schemaHash(binding.sources[index]))) fail("CANDIDATE_INVALID");
      const expectedFiles = request.settings.file_urls;
      if (expectedFiles.length !== all.length || expectedFiles.some((file, index) =>
          file.type !== all[index]!.wire_type || file.url !== all[index]!.url)) fail("CANDIDATE_INVALID");
      return Object.freeze({ model_id: binding.model_id, prompt: request.prompt,
        settings: deepFreeze({ ...request.settings, file_urls: all.map(({ wire_type, url }) => Object.freeze({ type: wire_type, url })) }),
        sources: Object.freeze(all) });
    });
  } catch { fail("CANDIDATE_INVALID"); }
  if (!snapshot || snapshot.model_id !== binding.model_id || snapshot.prompt !== request.prompt ||
      schemaHash(snapshot.settings) !== schemaHash(request.settings)) fail("CANDIDATE_INVALID");
  return snapshot;
}

function contextMetadata(context: OwnerFlux3UploadContext): OwnerFlux3VideoOwnedCandidateBinding["sources"][number] {
  if (context.model_id === "flux3_i2v" && context.status === "OWNER_FLUX3_I2V_IMAGE_UPLOADED") {
    const image = context as OwnerFlux3I2vImageUploadContext;
    return Object.freeze({ wire_type: "image", mime_type: image.mime_type, size: image.size, sha256: image.sha256,
      width: image.width, height: image.height, duration_seconds: null, input_confidence: image.metadata_confidence });
  }
  if (context.model_id === "flux3_v2v" && context.status === "OWNER_FLUX3_V2V_ORIGINAL_UPLOADED") {
    const video = context as OwnerFlux3V2vOriginalUploadContext;
    return Object.freeze({ wire_type: "video", mime_type: video.mime_type, size: video.size, sha256: video.sha256,
      width: video.metadata.video.width, height: video.metadata.video.height,
      duration_seconds: video.metadata.video.duration_seconds, input_confidence: video.metadata.inspection });
  }
  return fail("CANDIDATE_INVALID");
}

function currentBinding(fields: NativeInput): Readonly<OwnerFlux3VideoOwnedCandidateBinding> {
  const binding = readOwnerFlux3VideoOwnedCandidateBinding(fields.preparer, fields.candidate, fields.referenceService);
  if (!binding) fail("CANDIDATE_INVALID");
  return binding;
}

function revalidatePermit(fields: NativeInput): Promise<void> {
  return revalidateOwnerFlux3VideoOwnedOneShotPermit({ permit: fields.permit, preparer: fields.preparer,
    candidate: fields.candidate, principal: fields.principal, attemptId: fields.attemptId });
}
function consumePermit(fields: NativeInput): void {
  consumeOwnerFlux3VideoOwnedOneShotPermit({ permit: fields.permit, preparer: fields.preparer,
    candidate: fields.candidate, principal: fields.principal, attemptId: fields.attemptId });
}

async function assertCurrent(fields: NativeInput, signal?: AbortSignal): Promise<void> {
  if (signal && (types.isProxy(signal) || !(signal instanceof AbortSignal))) fail("INVALID_REQUEST");
  if (signal?.aborted) fail("REQUEST_ABORTED");
  if (!(fields.linkService instanceof PerUserLinkService) || Object.getPrototypeOf(fields.linkService) !== PerUserLinkService.prototype ||
      getDataMethod(fields.linkService, "getStatus") !== NATIVE_LINK_STATUS ||
      PerUserLinkService.prototype.getStatus !== NATIVE_LINK_STATUS) fail("CANDIDATE_INVALID");
  const current = await resolveOwnerReferencePrincipal({ binding: fields.binding, attemptId: fields.attemptId, linkService: fields.linkService });
  if (!sameGenerationPrincipal(current, fields.principal) || signal?.aborted) fail(signal?.aborted ? "REQUEST_ABORTED" : "PRINCIPAL_NOT_LINKED");
}

function stateFor(client: SyntxChatHttpClient, value: unknown): NativeState {
  if (!value || typeof value !== "object" || types.isProxy(value)) fail("CHAT_CONTEXT_INVALID");
  const state = operations.get(value as object);
  if (!state || state.client !== client || state.chat !== value || chatsByClient.get(client)?.get(state.chat.chat_uuid) !== state) fail("CHAT_CONTEXT_INVALID");
  return state;
}

function readOperation(value: unknown, withChat: boolean): NativeInput & { readonly chat?: OwnerFlux3VideoNativeChatContext } {
  const fields = exact(value, ["preparer", "candidate", "permit", "referenceService", "principal", "attemptId", "linkService", "binding",
    ...(withChat ? ["chat"] : [])]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || !fields.candidate || typeof fields.candidate !== "object" || types.isProxy(fields.candidate) ||
      !fields.permit || typeof fields.permit !== "object" || types.isProxy(fields.permit)) fail("INVALID_REQUEST");
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); } catch { fail("INVALID_REQUEST"); }
  const binding = exact(fields.binding, ["tenant_id", "subject"]);
  if (typeof binding.tenant_id !== "string" || typeof binding.subject !== "string" || principal.connection_id !== fields.attemptId) fail("INVALID_REQUEST");
  if (!isNativeReferenceService(fields.referenceService) || !isNativePreparer(fields.preparer) ||
      !isOwnerFlux3VideoOwnedRequestPreparerBoundToReferenceService(fields.preparer, fields.referenceService)) fail("INVALID_REQUEST");
  return Object.freeze({ preparer: fields.preparer as OwnerFlux3VideoOwnedRequestPreparer,
    candidate: fields.candidate as OwnerFlux3VideoOwnedPreparedCandidate,
    permit: fields.permit as OwnerFlux3VideoOwnedOneShotPermit,
    referenceService: fields.referenceService as OwnerFlux3MediaReferenceService,
    principal, attemptId: fields.attemptId, linkService: fields.linkService as PerUserLinkService,
    binding: Object.freeze({ tenant_id: binding.tenant_id, subject: binding.subject }),
    ...(withChat ? { chat: fields.chat as OwnerFlux3VideoNativeChatContext } : {}) });
}

function readResultReadInput(value: unknown): Readonly<OwnerFlux3VideoNativeResultReadInput & {
  readonly principal: Readonly<GenerationPrincipalRef>; readonly binding: Readonly<AuthBinding>
}> {
  const fields = exact(value, ["result_context", "principal", "attemptId", "linkService", "binding"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId)) fail("RESULT_CONTEXT_INVALID");
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); } catch { fail("RESULT_CONTEXT_INVALID"); }
  const binding = exact(fields.binding, ["tenant_id", "subject"]);
  if (typeof binding.tenant_id !== "string" || typeof binding.subject !== "string" || principal.connection_id !== fields.attemptId ||
      !fields.result_context || typeof fields.result_context !== "object" || types.isProxy(fields.result_context)) fail("RESULT_CONTEXT_INVALID");
  return Object.freeze({ result_context: fields.result_context as OwnerFlux3VideoNativeResultContext, principal,
    attemptId: fields.attemptId, linkService: fields.linkService as PerUserLinkService,
    binding: Object.freeze({ tenant_id: binding.tenant_id, subject: binding.subject }) });
}

function sameOperation(a: NativeInput, b: NativeInput & { readonly chat?: OwnerFlux3VideoNativeChatContext }): boolean {
  return a.preparer === b.preparer && a.candidate === b.candidate && a.permit === b.permit &&
    a.referenceService === b.referenceService && a.attemptId === b.attemptId && a.linkService === b.linkService &&
    sameGenerationPrincipal(a.principal, b.principal) && sameBinding(a.binding, b.binding);
}
function sameBinding(a: AuthBinding, b: AuthBinding): boolean { return a.tenant_id === b.tenant_id && a.subject === b.subject; }

function inspectRequestEcho(row: z.infer<typeof historyRowSchema>, snapshot: RequestSnapshot): OwnerFlux3VideoNativeRequestEchoStatus {
  const objects = row.message_object;
  let hasEcho = false;
  let unprovenModelEcho = false;
  const textObjects = objects.filter((object) => object.object_type === "text" && typeof object.object_text === "string");
  if (textObjects.length > 1 || textObjects.some((object) => object.object_text !== snapshot.prompt)) return "CONTRADICTORY";
  const textMatched = textObjects.length === 1 && textObjects[0]!.object_text === snapshot.prompt;
  if (textObjects.length) hasEcho = true;
  const mediaObjects = objects.filter((object) => object.object_type === "image" || object.object_type === "video");
  const seen = new Set<string>();
  for (const object of mediaObjects) {
    const modelEchoPresent = typeof object.model_type === "string";
    const urlEchoPresent = typeof object.object_url === "string";
    if (!modelEchoPresent && !urlEchoPresent) continue;
    hasEcho = true;
    if (modelEchoPresent && object.model_type !== snapshot.model_id) unprovenModelEcho = true;
    if (!urlEchoPresent) continue;
    if (!isSafeUploadReferenceUrl(object.object_url!)) return "CONTRADICTORY";
    const source = snapshot.sources.find((entry) => entry.url === object.object_url && entry.wire_type === object.object_type);
    if (!source || seen.has(`${source.wire_type}\u0000${source.url}`)) return "CONTRADICTORY";
    seen.add(`${source.wire_type}\u0000${source.url}`);
  }
  if (!hasEcho) return "ABSENT";
  return textMatched && seen.size === snapshot.sources.length && !unprovenModelEcho ? "MATCHED" : "PARTIAL_UNPROVEN";
}

function decodeResult(raw: unknown, expected: ResultCodec): OwnerFlux3VideoNativeResult {
  try {
    const message = exact(raw, ["id", "chat_id", "author_id", "message_object"], ["created_at", "updated_at", "is_favorite"]);
    if (String(message.id) !== expected.message_id || message.author_id !== BOT_AUTHOR_ID || String(message.chat_id) !== expected.provider_chat_id) {
      return Object.freeze({ message_binding: "UNVERIFIED", model_echo: "MISMATCH", provider_terminal_status: "UNPROVEN",
        artifacts: Object.freeze([]), gaps: Object.freeze(["MESSAGE_BINDING_MISMATCH"]), backend_acceptance: "UNPROVEN" });
    }
    if (!Array.isArray(message.message_object) || message.message_object.length > MESSAGE_LIMIT) return resultGap("BOUND", "UNKNOWN", "MESSAGE_OBJECT_ARRAY_INVALID");
    const artifacts: OwnerFlux3VideoNativeVideoArtifact[] = [], gaps: string[] = [], seen = new Set<string>();
    const expectedIds = new Set(expected.message_object_ids);
    let modelEcho: OwnerFlux3VideoNativeResult["model_echo"] = "MATCHED";
    for (let index = 0; index < message.message_object.length; index += 1) {
      const rawObject = message.message_object[index];
      const object = exact(rawObject, ["id", "object_type", "message_id"],
        ["object_url", "completed", "model_type", "object_text", "created_at", "updated_at", "task_id", "metadata"]);
      const id = String(object.id);
      if (!safeId(id) || seen.has(id)) { gaps.push("OBJECT_ID_INVALID_OR_DUPLICATE"); continue; }
      seen.add(id);
      if (String(object.message_id) !== expected.message_id) { gaps.push("OBJECT_MESSAGE_BINDING_MISMATCH"); continue; }
      if (object.object_type !== "video") {
        if (expectedIds.has(id)) gaps.push("OBJECT_TYPE_MISMATCH");
        continue;
      }
      if (!expectedIds.has(id)) { gaps.push("OBJECT_ID_UNEXPECTED"); continue; }
      if (object.model_type !== expected.model_id) { modelEcho = object.model_type == null ? "UNKNOWN" : "MISMATCH"; gaps.push("MODEL_TYPE_MISMATCH"); continue; }
      if (object.completed !== true || typeof object.object_url !== "string" || !isSafeUploadReferenceUrl(object.object_url)) {
        gaps.push("VIDEO_NOT_READY_OR_URL_INVALID"); continue;
      }
      const parsed = safeVideoMime(object.object_url);
      artifacts.push(Object.freeze({ object_index: index, message_object_id: id, object_type: "video",
        object_url: object.object_url, mime_type: parsed, mime_source: parsed ? "URL_EXTENSION" : "UNKNOWN" }));
    }
    if (artifacts.length < 1) gaps.push("NO_READY_MODEL_VIDEO");
    if (artifacts.length !== expected.message_object_ids.length) gaps.push("RESULT_OBJECT_SET_MISMATCH");
    return Object.freeze({ message_binding: "BOUND", model_echo: modelEcho, provider_terminal_status: "UNPROVEN",
      artifacts: Object.freeze(gaps.length === 0 ? artifacts : []), gaps: Object.freeze(gaps), backend_acceptance: "UNPROVEN" });
  } catch { return resultGap("UNVERIFIED", "UNKNOWN", "RESULT_SHAPE_INVALID"); }
}

const historyPageSchema = z.object({
  messages: z.array(z.unknown()).max(PAGE_SIZE),
  pagination: z.object({ page: z.number().int().min(1).max(PAGE_LIMIT), page_size: z.literal(PAGE_SIZE),
    total_count: z.number().int().min(0).max(MESSAGE_LIMIT), total_pages: z.number().int().min(0).max(PAGE_LIMIT),
    has_next: z.boolean(), has_previous: z.boolean() }).passthrough()
}).passthrough();
const messageObjectSchema = z.object({
  id: z.union([z.string().regex(ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String),
  message_id: z.union([z.string().regex(ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String),
  object_type: z.string(), model_type: z.string().nullable().optional(), completed: z.boolean().optional(),
  object_url: z.string().nullable().optional(), object_text: z.string().nullable().optional()
}).passthrough();
const historyRowSchema = z.object({
  id: z.union([z.string().regex(ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String),
  chat_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), author_id: z.number().int(),
  message_object: z.array(messageObjectSchema).max(64)
}).passthrough();

function emptyCandidates(status: OwnerFlux3VideoNativeResultCandidates["status"], owner: OwnerFlux3VideoNativeResultCandidates["owner_ack_status"],
  echo: OwnerFlux3VideoNativeRequestEchoStatus, page: OwnerFlux3VideoNativeResultCandidates["history_page_status"], calls: number, gap: string): OwnerFlux3VideoNativeResultCandidates {
  return Object.freeze({ status, owner_ack_status: owner, request_echo_status: echo, history_binding_status: "UNVERIFIED",
    history_page_status: page, history_get_calls: calls, total_count: null, total_pages: null, provider_chat_id: null,
    owner_echo_message_id: null, contexts: Object.freeze([]), gaps: Object.freeze([gap]), backend_acceptance: "UNPROVEN" });
}
function resultGap(binding: OwnerFlux3VideoNativeResult["message_binding"], model: OwnerFlux3VideoNativeResult["model_echo"], gap: string): OwnerFlux3VideoNativeResult {
  return Object.freeze({ message_binding: binding, model_echo: model, provider_terminal_status: "UNPROVEN",
    artifacts: Object.freeze([]), gaps: Object.freeze([gap]), backend_acceptance: "UNPROVEN" });
}
function sourceMimeAllowed(model: OwnerFlux3VideoModelId, mime: string): boolean {
  return model === "flux3_i2v" ? ["image/jpeg", "image/png", "image/webp"].includes(mime) : mime === "video/mp4";
}
function safeVideoMime(url: string): OwnerFlux3VideoNativeVideoArtifact["mime_type"] {
  const path = new URL(url).pathname.toLowerCase();
  if (path.endsWith(".mp4")) return "video/mp4";
  if (path.endsWith(".mov")) return "video/quicktime";
  return null;
}
function safeId(value: unknown): value is string { return typeof value === "string" && ID.test(value); }
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(descriptors);
  const allowed = new Set([...required, ...optional]);
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      actual.some((key) => typeof key !== "string" || !allowed.has(key) || !("value" in descriptors[key]!))) fail("INVALID_REQUEST");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}
function isNativeReferenceService(value: unknown): value is OwnerFlux3MediaReferenceService {
  return !!value && typeof value === "object" && !types.isProxy(value) && value instanceof OwnerFlux3MediaReferenceService &&
    Object.getPrototypeOf(value) === OwnerFlux3MediaReferenceService.prototype &&
    OwnerFlux3MediaReferenceService.prototype.uploadReference === NATIVE_REFERENCE_METHODS.upload &&
    OwnerFlux3MediaReferenceService.prototype.resolveReference === NATIVE_REFERENCE_METHODS.resolve &&
    OwnerFlux3MediaReferenceService.prototype.isOwnedReferenceResolution === NATIVE_REFERENCE_METHODS.guard &&
    OwnerFlux3MediaReferenceService.prototype.withCapturedNativeReference === NATIVE_REFERENCE_METHODS.capture &&
    OwnerFlux3MediaReferenceService.prototype.invalidateAttempt === NATIVE_REFERENCE_METHODS.invalidate &&
    OwnerFlux3MediaReferenceService.prototype.close === NATIVE_REFERENCE_METHODS.close &&
    getDataMethod(value, "resolveReference") === NATIVE_REFERENCE_METHODS.resolve &&
    getDataMethod(value, "isOwnedReferenceResolution") === NATIVE_REFERENCE_METHODS.guard &&
    getDataMethod(value, "withCapturedNativeReference") === NATIVE_REFERENCE_METHODS.capture;
}
function isNativePreparer(value: unknown): value is OwnerFlux3VideoOwnedRequestPreparer {
  return isOwnerFlux3VideoOwnedRequestPreparer(value) &&
    OwnerFlux3VideoOwnedRequestPreparer.prototype.prepare === NATIVE_PREPARER_METHODS.prepare &&
    OwnerFlux3VideoOwnedRequestPreparer.prototype.inspectCandidate === NATIVE_PREPARER_METHODS.inspect &&
    OwnerFlux3VideoOwnedRequestPreparer.prototype.getPrivateRequest === NATIVE_PREPARER_METHODS.request &&
    OwnerFlux3VideoOwnedRequestPreparer.prototype.withCapturedNativeReferences === NATIVE_PREPARER_METHODS.capture &&
    OwnerFlux3VideoOwnedRequestPreparer.prototype.isBoundToReferenceService === NATIVE_PREPARER_METHODS.bound &&
    OwnerFlux3VideoOwnedRequestPreparer.prototype.revalidateCandidate === NATIVE_PREPARER_METHODS.revalidate &&
    OwnerFlux3VideoOwnedRequestPreparer.prototype.invalidateAttempt === NATIVE_PREPARER_METHODS.invalidate &&
    OwnerFlux3VideoOwnedRequestPreparer.prototype.close === NATIVE_PREPARER_METHODS.close &&
    ["prepare", "inspectCandidate", "getPrivateRequest", "withCapturedNativeReferences", "isBoundToReferenceService", "revalidateCandidate", "invalidateAttempt", "close"]
      .every((key) => getDataMethod(value, key) === getDataMethod(OwnerFlux3VideoOwnedRequestPreparer.prototype, key));
}
function getDataMethod(target: object, key: string): unknown {
  let current: object | null = target;
  while (current !== null) { const descriptor = Object.getOwnPropertyDescriptor(current, key); if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null; }
  return undefined;
}
function isExactNativeClient(client: unknown): client is SyntxChatHttpClient {
  try {
    return !!client && typeof client === "object" && !types.isProxy(client) && Object.getPrototypeOf(client) === SyntxChatHttpClient.prototype &&
      !["uploadFlux3I2vImage", "uploadFlux3V2vOriginal", "createOwnerFlux3VideoChat", "startFlux3VideoWithOwnedCandidate",
        "listOwnedFlux3VideoCandidates", "getOwnedFlux3VideoResult"].some((key) => Object.hasOwn(client, key)) &&
      SyntxChatHttpClient.prototype.createChat === NATIVE_CLIENT_METHODS.createChat &&
      SyntxChatHttpClient.prototype.uploadFlux3I2vImage === NATIVE_CLIENT_METHODS.uploadFlux3I2vImage &&
      SyntxChatHttpClient.prototype.uploadFlux3V2vOriginal === NATIVE_CLIENT_METHODS.uploadFlux3V2vOriginal &&
      SyntxChatHttpClient.prototype.createOwnerFlux3VideoChat === NATIVE_CLIENT_METHODS.create &&
      SyntxChatHttpClient.prototype.startFlux3VideoWithOwnedCandidate === NATIVE_CLIENT_METHODS.start &&
      SyntxChatHttpClient.prototype.listOwnedFlux3VideoCandidates === NATIVE_CLIENT_METHODS.list &&
      SyntxChatHttpClient.prototype.getOwnedFlux3VideoResult === NATIVE_CLIENT_METHODS.get &&
      Object.keys(NATIVE_CLIENT_METHODS).every((key) => getDataMethod(client, key === "create" ? "createOwnerFlux3VideoChat" :
        key === "start" ? "startFlux3VideoWithOwnedCandidate" : key === "list" ? "listOwnedFlux3VideoCandidates" :
          key === "get" ? "getOwnedFlux3VideoResult" : key) === NATIVE_CLIENT_METHODS[key as keyof typeof NATIVE_CLIENT_METHODS]);
  } catch { return false; }
}
function fail(code: OwnerFlux3VideoNativeErrorCode): never { throw new OwnerFlux3VideoNativeError(code); }
