import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { z } from "zod/v4";
import type { AuthBinding } from "../../auth/types.js";
import { PerUserLinkService } from "../../auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../../domain/generation-principal.js";
import { schemaHash } from "../../domain/generation-contract.js";
import {
  consumeOwnerTopazEnhanceOwnedOneShotPermit,
  revalidateOwnerTopazEnhanceOwnedOneShotPermit,
  type OwnerTopazEnhanceOwnedOneShotPermit
} from "../../application/owner-topaz-enhance-owned-one-shot-policy.js";
import {
  isOwnerTopazEnhanceOwnedPreparedCandidate,
  isOwnerTopazEnhanceOwnedRequestPreparer,
  OwnerTopazEnhanceOwnedRequestPreparer,
  type OwnerTopazEnhanceOwnedCandidateBinding,
  type OwnerTopazEnhanceOwnedPreparedCandidate,
  type OwnerTopazEnhanceOwnedRequestPreparer as OwnerTopazEnhanceOwnedRequestPreparerType
} from "../../application/owner-topaz-enhance-owned-request-preparer.js";
import {
  OwnerTopazEnhanceOriginalReferenceService,
  type OwnerTopazEnhanceOriginalResolution
} from "../../application/owner-topaz-enhance-original-reference-service.js";
import type { OwnerTopazEnhanceOriginalUploadContext } from "./topaz-enhance-original-upload.js";
import { readOwnerTopazEnhanceOriginalUploadForClient, type SyntxChatHttpClient } from "./chat-http-client.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const CHAT_LIMIT = 128, PAGE_SIZE = 10, PAGE_LIMIT = 7, MESSAGE_LIMIT = 64, BOT_AUTHOR_ID = -1;
const operations = new WeakMap<object, NativeState>();
const chatsByClient = new WeakMap<object, Map<string, NativeState>>();
const resultContexts = new WeakMap<object, ResultState>();
const usedPermits = new WeakSet<object>();
const pendingPermits = new WeakSet<object>();
const ORIGINAL_RESOLVE = OwnerTopazEnhanceOriginalReferenceService.prototype.resolveOriginal;
const ORIGINAL_CAPTURE = OwnerTopazEnhanceOriginalReferenceService.prototype.withCapturedNativeOriginal;
const ORIGINAL_GUARD = OwnerTopazEnhanceOriginalReferenceService.prototype.isOwnedOriginalResolution;
const PREPARER_METHODS = Object.freeze({
  inspect: OwnerTopazEnhanceOwnedRequestPreparer.prototype.inspectCandidate,
  request: OwnerTopazEnhanceOwnedRequestPreparer.prototype.getPrivateRequest,
  revalidate: OwnerTopazEnhanceOwnedRequestPreparer.prototype.revalidateCandidate
});

export interface OwnerTopazEnhanceNativeOperationInput {
  readonly preparer: OwnerTopazEnhanceOwnedRequestPreparerType;
  readonly candidate: OwnerTopazEnhanceOwnedPreparedCandidate;
  readonly permit: OwnerTopazEnhanceOwnedOneShotPermit;
  readonly originalReferenceService: OwnerTopazEnhanceOriginalReferenceService;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly linkService: PerUserLinkService;
  readonly binding: AuthBinding;
}

export interface OwnerTopazEnhanceNativeChatContext {
  readonly status: "created";
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly model_id: "topaz_enhance";
  readonly profile_schema_hash: string;
  readonly intent_fingerprint: string;
  readonly request_fingerprint: string;
  readonly expires_at: number;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerTopazEnhanceNativeStartAck {
  readonly chat_uuid: string;
  readonly message_id: string;
}

export interface OwnerTopazEnhanceNativeResultContext {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly model_id: "topaz_enhance";
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly string[];
  readonly attempt_id: string;
  readonly profile_schema_hash: string;
  readonly intent_fingerprint: string;
  readonly owner_echo_message_id: string;
}

export interface OwnerTopazEnhanceNativeResultCandidates {
  readonly status: "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  readonly history_binding_status: "BOUND" | "PARTIAL" | "UNVERIFIED";
  readonly history_page_status: "NOT_READ" | "COMPLETE" | "INCOMPLETE" | "UNPROVEN";
  readonly history_get_calls: number;
  readonly total_count: number | null;
  readonly total_pages: number | null;
  readonly provider_chat_id: string | null;
  readonly owner_echo_message_id: string | null;
  readonly contexts: readonly OwnerTopazEnhanceNativeResultContext[];
  readonly gaps: readonly string[];
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerTopazEnhanceNativeReadyVideo {
  readonly object_index: number;
  readonly message_object_id: string;
  readonly object_type: "video";
  readonly object_url: string;
  readonly mime_type: "video/mp4" | "video/quicktime" | null;
  readonly mime_source: "URL_EXTENSION" | "UNKNOWN";
}

export interface OwnerTopazEnhanceNativeResult {
  readonly message_binding: "BOUND" | "UNVERIFIED";
  readonly model_echo: "MATCHED" | "UNKNOWN" | "MISMATCH";
  readonly ready_videos: readonly OwnerTopazEnhanceNativeReadyVideo[];
  readonly gaps: readonly string[];
  readonly backend_acceptance: "UNPROVEN";
}

export type OwnerTopazEnhanceNativeErrorCode =
  | "INVALID_REQUEST" | "CANDIDATE_INVALID" | "CHAT_CREATE_FAILED" | "CHAT_CONTEXT_INVALID" | "CHAT_ALREADY_CREATED"
  | "CHAT_NOT_DISPATCHED" | "OUTCOME_UNKNOWN" | "HISTORY_UNAVAILABLE" | "RESULT_CONTEXT_INVALID"
  | "RESULT_GET_UNAVAILABLE" | "REQUEST_ABORTED" | "CAPACITY_EXCEEDED";

export class OwnerTopazEnhanceNativeError extends Error {
  constructor(readonly code: OwnerTopazEnhanceNativeErrorCode) {
    super("The owner Topaz Enhance native operation could not be completed safely.");
    this.name = "OwnerTopazEnhanceNativeError";
  }
}

interface NativeInput extends OwnerTopazEnhanceNativeOperationInput {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly binding: Readonly<AuthBinding>;
}
interface NativeState {
  readonly client: SyntxChatHttpClient;
  readonly input: NativeInput;
  readonly auth: NativeInput;
  readonly chat: OwnerTopazEnhanceNativeChatContext;
  readonly requestFingerprint: string;
  readonly originalSnapshot: Readonly<{
    sha256: string; size: number; mime_type: "video/mp4"; width: number; height: number;
    duration_seconds: number; frame_count: number; epoch: number; expires_at: number;
  }>;
  phase: "AVAILABLE" | "OUTCOME_UNKNOWN" | "ACKNOWLEDGED";
  ownerEcho?: string;
  readonly contexts: Map<string, OwnerTopazEnhanceNativeResultContext>;
}
interface ResultCodec {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly model_id: "topaz_enhance";
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly string[];
}
interface ResultState {
  readonly client: SyntxChatHttpClient;
  readonly state: NativeState;
  readonly context: OwnerTopazEnhanceNativeResultContext;
  readonly codec: ResultCodec;
}
interface CapturedOriginal {
  readonly client: SyntxChatHttpClient;
  readonly reference: OwnerTopazEnhanceOriginalUploadContext;
  readonly url: string;
}

const historyPageSchema = z.object({
  messages: z.array(z.unknown()).max(PAGE_SIZE),
  pagination: z.object({
    page: z.number().int().min(1).max(PAGE_LIMIT),
    page_size: z.literal(PAGE_SIZE),
    total_count: z.number().int().min(0).max(MESSAGE_LIMIT),
    total_pages: z.number().int().min(0).max(PAGE_LIMIT),
    has_next: z.boolean(),
    has_previous: z.boolean()
  }).passthrough()
}).passthrough();
const messageObjectSchema = z.object({
  id: z.union([z.string().regex(ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String),
  message_id: z.union([z.string().regex(ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String),
  object_type: z.string(), model_type: z.string().nullable().optional(), completed: z.boolean().optional(), object_url: z.string().optional()
}).passthrough();
const historyRowSchema = z.object({
  id: z.union([z.string().regex(ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String),
  chat_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  author_id: z.number().int(),
  message_object: z.array(messageObjectSchema).max(64)
}).passthrough();

export async function createOwnerTopazEnhanceNativeChat(input: unknown, packet: unknown, signal?: AbortSignal): Promise<OwnerTopazEnhanceNativeChatContext> {
  const invocation = await consumeInvocation(input, packet, "create"), client = invocation.client;
  const createChat = invocation.callback as (title: string, signal?: AbortSignal) => Promise<{ chat_uuid: string }>;
  let fields: NativeInput;
  try { fields = readOperation(input, false); } catch { fail("INVALID_REQUEST"); }
  if (signal?.aborted) fail("REQUEST_ABORTED");
  await assertCurrent(fields, signal);
  let binding: Readonly<OwnerTopazEnhanceOwnedCandidateBinding>;
  let captured: CapturedOriginal;
  let requestFingerprint: string;
  try {
    validateCandidate(fields);
    binding = fields.preparer.inspectCandidate(fields.candidate)!;
    const beforeRequest = fields.preparer.getPrivateRequest(fields.candidate);
    await fields.preparer.revalidateCandidate(fields.candidate);
    await revalidatePermit(fields);
    await assertCurrent(fields, signal);
    const freshBinding = fields.preparer.inspectCandidate(fields.candidate);
    const request = fields.preparer.getPrivateRequest(fields.candidate);
    if (!freshBinding || schemaHash(binding) !== schemaHash(freshBinding) || schemaHash(beforeRequest) !== schemaHash(request) ||
        !exactPreparedRequest(request, freshBinding)) fail("CANDIDATE_INVALID");
    captured = await captureOriginal(fields, freshBinding);
    if (captured.client !== client || request.settings.file_urls[0]?.url !== captured.url) fail("CANDIDATE_INVALID");
    requestFingerprint = schemaHash(request);
    await revalidatePermit(fields);
    await assertCurrent(fields, signal);
  } catch { fail("CANDIDATE_INVALID"); }

  if (usedPermits.has(fields.permit as object) || pendingPermits.has(fields.permit as object)) fail("CHAT_ALREADY_CREATED");
  let chats = chatsByClient.get(client);
  if (!chats) { chats = new Map(); chatsByClient.set(client, chats); }
  if (chats.size >= CHAT_LIMIT) fail("CAPACITY_EXCEEDED");
  pendingPermits.add(fields.permit as object);
  usedPermits.add(fields.permit as object);
  let receipt: { chat_uuid: string };
  try { receipt = await createChat(`owner-topaz-enhance-${randomUUID()}`, signal); }
  catch { pendingPermits.delete(fields.permit as object); fail("CHAT_CREATE_FAILED"); }
  if (signal?.aborted || !safeId(receipt.chat_uuid) || chats.has(receipt.chat_uuid)) {
    pendingPermits.delete(fields.permit as object);
    fail("CHAT_CREATE_FAILED");
  }
  try {
    await assertCurrent(fields, signal);
    await fields.preparer.revalidateCandidate(fields.candidate);
    await revalidatePermit(fields);
  } catch { pendingPermits.delete(fields.permit as object); fail("CANDIDATE_INVALID"); }
  const chat: OwnerTopazEnhanceNativeChatContext = Object.freeze({ status: "created", chat_uuid: receipt.chat_uuid,
    attempt_id: fields.attemptId, model_id: binding!.model_id, profile_schema_hash: binding!.profile_schema_hash,
    intent_fingerprint: binding!.intent_fingerprint, request_fingerprint: requestFingerprint!, expires_at: binding!.expires_at,
    dispatch_allowed: false, backend_acceptance: "UNPROVEN" });
  const state: NativeState = { client, input: fields, auth: fields, chat, requestFingerprint: requestFingerprint!,
    originalSnapshot: snapshotOriginal(binding!), phase: "AVAILABLE", contexts: new Map() };
  pendingPermits.delete(fields.permit as object);
  chats.set(chat.chat_uuid, state);
  operations.set(chat, state);
  return chat;
}

export async function startOwnerTopazEnhanceNativeGeneration(
  input: unknown, packet: unknown, signal?: AbortSignal
): Promise<OwnerTopazEnhanceNativeStartAck> {
  const invocation = await consumeInvocation(input, packet, "start"), client = invocation.client;
  const start = invocation.callback as (chatUuid: string, body: Record<string, unknown>, signal?: AbortSignal) => Promise<OwnerTopazEnhanceNativeStartAck>;
  let fields: NativeInput & { readonly chat?: OwnerTopazEnhanceNativeChatContext };
  try { fields = readOperation(input, true); } catch { fail("INVALID_REQUEST"); }
  const state = stateFor(client, fields.chat);
  if (state.phase !== "AVAILABLE" || !sameOperation(state.input, fields)) fail("CHAT_CONTEXT_INVALID");
  if (signal?.aborted) fail("REQUEST_ABORTED");
  let wireBody: Readonly<Record<string, unknown>>;
  try {
    validateCandidate(fields);
    await assertCurrent(state.auth, signal);
    const beforeBinding = fields.preparer.inspectCandidate(fields.candidate);
    const beforeRequest = fields.preparer.getPrivateRequest(fields.candidate);
    await fields.preparer.revalidateCandidate(fields.candidate);
    await assertCurrent(state.auth, signal);
    const afterBinding = fields.preparer.inspectCandidate(fields.candidate);
    const request = fields.preparer.getPrivateRequest(fields.candidate);
    if (!beforeBinding || !afterBinding || schemaHash(beforeBinding) !== schemaHash(afterBinding) ||
        schemaHash(beforeRequest) !== schemaHash(request) || schemaHash(request) !== state.requestFingerprint ||
        afterBinding.request_fingerprint !== state.chat.request_fingerprint || afterBinding.intent_fingerprint !== state.chat.intent_fingerprint ||
        !sameOriginalSnapshot(afterBinding, state.originalSnapshot) || !exactPreparedRequest(request, afterBinding)) fail("CANDIDATE_INVALID");
    const captured = await captureOriginal(fields, afterBinding);
    if (captured.client !== client || request.settings.file_urls[0]?.url !== captured.url) fail("CANDIDATE_INVALID");
    await revalidatePermit(fields);
    await assertCurrent(state.auth, signal);
    consumePermit(fields);
    wireBody = Object.freeze({ chat_id: state.chat.chat_uuid, settings: request.settings });
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

export async function listOwnerTopazEnhanceNativeCandidates(
  input: unknown, packet: unknown, signal?: AbortSignal
): Promise<OwnerTopazEnhanceNativeResultCandidates> {
  const invocation = await consumeInvocation(input, packet, "list"), client = invocation.client;
  const getPage = invocation.callback as (chatUuid: string, page: number, pageSize: number, signal?: AbortSignal) => Promise<unknown>;
  const state = stateFor(client, input);
  if (state.phase !== "ACKNOWLEDGED" && state.phase !== "OUTCOME_UNKNOWN") fail("CHAT_NOT_DISPATCHED");
  if (signal?.aborted) fail("REQUEST_ABORTED");
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
      if (!parsed.success) return emptyCandidates("UNVERIFIED", "UNPROVEN", calls, "HISTORY_PAGE_INVALID");
      const pagination = parsed.data.pagination;
      const expectedPages = pagination.total_count === 0 ? 0 : Math.ceil(pagination.total_count / PAGE_SIZE);
      const expectedRows = Math.min(PAGE_SIZE, Math.max(0, pagination.total_count - (page - 1) * PAGE_SIZE));
      if (pagination.page !== page || pagination.page_size !== PAGE_SIZE || pagination.total_pages !== expectedPages ||
          pagination.has_previous !== (page > 1) || pagination.has_next !== (page < expectedPages) ||
          parsed.data.messages.length !== expectedRows ||
          (totalCount !== undefined && (totalCount !== pagination.total_count || totalPages !== pagination.total_pages))) {
        return emptyCandidates("UNVERIFIED", "UNPROVEN", calls, "HISTORY_PAGE_INCONSISTENT");
      }
      totalCount ??= pagination.total_count;
      totalPages ??= pagination.total_pages;
      if (expectedPages === 0) return emptyCandidates("PENDING", "COMPLETE", calls, "HISTORY_EMPTY");
      for (const rawRow of parsed.data.messages) {
        const row = historyRowSchema.safeParse(rawRow);
        if (!row.success) return emptyCandidates("UNVERIFIED", "UNPROVEN", calls, "HISTORY_ROW_INVALID");
        const providerId = String(row.data.chat_id);
        if (!/^\d{1,16}$/u.test(providerId) || (providerChatId !== undefined && providerChatId !== providerId) ||
            messageIds.has(row.data.id) || row.data.message_object.some((object) => object.message_id !== row.data.id || objectIds.has(object.id))) {
          return emptyCandidates("UNVERIFIED", "UNPROVEN", calls, "HISTORY_JOIN_INVALID");
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
    return emptyCandidates("UNVERIFIED", "INCOMPLETE", calls, "HISTORY_UNAVAILABLE");
  }
  if (rows.length !== totalCount || providerChatId === undefined) return emptyCandidates("UNVERIFIED", "INCOMPLETE", calls, "HISTORY_INCOMPLETE");
  const acknowledgements = state.ownerEcho ? rows.filter((row) => row.id === state.ownerEcho && row.author_id > 0) : [];
  if (!state.ownerEcho || acknowledgements.length !== 1) {
    const gap = !state.ownerEcho ? "POST_ACK_UNKNOWN" : acknowledgements.length === 0 ? "OWNER_ACK_MISSING" : "OWNER_ACK_AMBIGUOUS";
    return Object.freeze({ ...emptyCandidates("INCOMPLETE", "COMPLETE", calls, gap),
      owner_ack_status: state.ownerEcho ? (acknowledgements.length ? "AMBIGUOUS" : "MISMATCH") : "MISSING",
      total_count: totalCount ?? 0, total_pages: totalPages ?? 0, provider_chat_id: providerChatId, owner_echo_message_id: state.ownerEcho ?? null });
  }
  const discovered: Array<Readonly<{ context: OwnerTopazEnhanceNativeResultContext; codec: ResultCodec }>> = [];
  const gaps: string[] = [];
  for (const row of rows) {
    if (row.author_id !== BOT_AUTHOR_ID) continue;
    const videos = row.message_object.filter((object) => object.object_type === "video");
    if (videos.length === 0) continue;
    const video = videos[0]!;
    if (videos.length !== 1 || video.model_type !== "topaz_enhance" || video.completed !== true ||
        typeof video.object_url !== "string" || !isSafeUploadReferenceUrl(video.object_url)) {
      gaps.push("BOT_VIDEO_MODEL_COMPLETION_OR_OBJECT_MISMATCH");
      continue;
    }
    const objectIdsForResult = Object.freeze([video.id]);
    const codec: ResultCodec = Object.freeze({ chat_uuid: state.chat.chat_uuid, message_id: row.id, model_id: "topaz_enhance",
      provider_chat_id: providerChatId, message_object_ids: objectIdsForResult });
    const context: OwnerTopazEnhanceNativeResultContext = Object.freeze({ ...codec, attempt_id: state.chat.attempt_id,
      profile_schema_hash: state.chat.profile_schema_hash, intent_fingerprint: state.chat.intent_fingerprint,
      owner_echo_message_id: state.ownerEcho });
    const previous = state.contexts.get(row.id);
    if (previous && schemaHash(previous) !== schemaHash(context)) return emptyCandidates("UNVERIFIED", "UNPROVEN", calls, "RESULT_CONTEXT_MISMATCH");
    discovered.push(Object.freeze({ context: previous ?? context, codec }));
  }
  if (gaps.length > 0) return Object.freeze({ ...emptyCandidates("UNVERIFIED", "COMPLETE", calls, gaps[0]!),
    owner_ack_status: "MATCHED", total_count: totalCount!, total_pages: totalPages!, provider_chat_id: providerChatId,
    owner_echo_message_id: state.ownerEcho, gaps: Object.freeze(gaps) });
  if (discovered.length > 1) return Object.freeze({ ...emptyCandidates("UNVERIFIED", "COMPLETE", calls, "MULTIPLE_TOPAZ_ENHANCE_RESULTS"),
    owner_ack_status: "MATCHED", total_count: totalCount!, total_pages: totalPages!, provider_chat_id: providerChatId,
    owner_echo_message_id: state.ownerEcho });
  const contexts = discovered.map(({ context, codec }) => {
    if (!state.contexts.has(context.message_id)) {
      resultContexts.set(context, { client, state, context, codec });
      state.contexts.set(context.message_id, context);
    }
    return state.contexts.get(context.message_id)!;
  });
  return Object.freeze({ status: contexts.length ? "COMPLETE" : "PENDING",
    owner_ack_status: "MATCHED", history_binding_status: "BOUND",
    history_page_status: "COMPLETE", history_get_calls: calls, total_count: totalCount!, total_pages: totalPages!,
    provider_chat_id: providerChatId, owner_echo_message_id: state.ownerEcho, contexts: Object.freeze(contexts),
    gaps: Object.freeze(contexts.length ? [] : ["BOT_RESULT_NOT_OBSERVED"]), backend_acceptance: "UNPROVEN" });
}

export async function getOwnerTopazEnhanceNativeResult(
  input: unknown, packet: unknown, signal?: AbortSignal
): Promise<OwnerTopazEnhanceNativeResult> {
  const invocation = await consumeInvocation(input, packet, "get"), client = invocation.client;
  const getMessage = invocation.callback as (chatUuid: string, messageId: string, signal?: AbortSignal) => Promise<unknown>;
  if (!input || typeof input !== "object" || types.isProxy(input)) fail("RESULT_CONTEXT_INVALID");
  const owned = resultContexts.get(input as object);
  if (!owned || owned.client !== client || owned.context !== input || owned.state.phase !== "ACKNOWLEDGED" ||
      owned.state.ownerEcho !== owned.context.owner_echo_message_id || operations.get(owned.state.chat) !== owned.state ||
      owned.state.chat.attempt_id !== owned.context.attempt_id || owned.state.chat.intent_fingerprint !== owned.context.intent_fingerprint) {
    fail("RESULT_CONTEXT_INVALID");
  }
  if (signal?.aborted) fail("REQUEST_ABORTED");
  await assertCurrent(owned.state.auth, signal);
  try {
    let raw: unknown;
    try { raw = await getMessage(owned.codec.chat_uuid, owned.codec.message_id, signal); }
    finally { await assertCurrent(owned.state.auth, signal); }
    return decodeResult(raw, owned.codec);
  } catch { if (signal?.aborted) fail("REQUEST_ABORTED"); fail("RESULT_GET_UNAVAILABLE"); }
}

function stateFor(client: SyntxChatHttpClient, value: unknown): NativeState {
  if (!value || typeof value !== "object" || types.isProxy(value)) fail("CHAT_CONTEXT_INVALID");
  const state = operations.get(value as object);
  if (!state || state.client !== client || state.chat !== value || chatsByClient.get(client)?.get(state.chat.chat_uuid) !== state) fail("CHAT_CONTEXT_INVALID");
  return state;
}

function readOperation(value: unknown, withChat: boolean): NativeInput & { readonly chat?: OwnerTopazEnhanceNativeChatContext } {
  const fields = exact(value, ["preparer", "candidate", "permit", "originalReferenceService", "principal", "attemptId", "linkService", "binding",
    ...(withChat ? ["chat"] : [])]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || !fields.candidate || typeof fields.candidate !== "object" || types.isProxy(fields.candidate) ||
      !fields.permit || typeof fields.permit !== "object" || types.isProxy(fields.permit)) fail("INVALID_REQUEST");
  const principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef);
  const bindingFields = exact(fields.binding, ["tenant_id", "subject"]);
  if (typeof bindingFields.tenant_id !== "string" || typeof bindingFields.subject !== "string") fail("INVALID_REQUEST");
  return Object.freeze({ preparer: fields.preparer as OwnerTopazEnhanceOwnedRequestPreparerType,
    candidate: fields.candidate as OwnerTopazEnhanceOwnedPreparedCandidate, permit: fields.permit as OwnerTopazEnhanceOwnedOneShotPermit,
    originalReferenceService: fields.originalReferenceService as OwnerTopazEnhanceOriginalReferenceService,
    principal, attemptId: fields.attemptId, linkService: fields.linkService as PerUserLinkService,
    binding: Object.freeze({ tenant_id: bindingFields.tenant_id, subject: bindingFields.subject }),
    ...(withChat ? { chat: fields.chat as OwnerTopazEnhanceNativeChatContext } : {}) });
}

function validateCandidate(fields: NativeInput): void {
  if (!isOwnerTopazEnhanceOwnedRequestPreparer(fields.preparer) || !isOwnerTopazEnhanceOwnedPreparedCandidate(fields.candidate) ||
      !exactClientMethods(fields.originalReferenceService) || !exactPreparerMethods(fields.preparer)) fail("CANDIDATE_INVALID");
  const binding = fields.preparer.inspectCandidate(fields.candidate);
  if (!binding || binding.attempt_id !== fields.attemptId || !sameGenerationPrincipal(binding.principal, fields.principal) ||
      binding.model_id !== "topaz_enhance" || fields.candidate.model_id !== "topaz_enhance" ||
      fields.candidate.status !== "blocked" || fields.candidate.dispatch_allowed !== false || fields.candidate.runtime_usable !== false ||
      fields.candidate.backend_acceptance !== "UNPROVEN" || fields.candidate.profile_schema_hash !== binding.profile_schema_hash ||
      fields.candidate.request_fingerprint !== binding.request_fingerprint || fields.candidate.intent_fingerprint !== binding.intent_fingerprint ||
      fields.candidate.expires_at !== binding.expires_at || fields.candidate.original.sha256 !== binding.original_sha256 ||
      fields.candidate.original.size !== binding.original_size || fields.candidate.original.mime_type !== binding.mime_type ||
      fields.candidate.original.width !== binding.width || fields.candidate.original.height !== binding.height ||
      fields.candidate.original.duration_seconds !== binding.duration_seconds || fields.candidate.original.frame_count !== binding.frame_count ||
      !sameGenerationPrincipal(fields.principal, binding.principal) || fields.principal.connection_id !== fields.attemptId ||
      !/^[a-f0-9]{64}$/u.test(binding.original_sha256) || !Number.isSafeInteger(binding.original_size) || binding.original_size < 16 ||
      !Number.isSafeInteger(binding.width) || binding.width <= 0 || !Number.isSafeInteger(binding.height) || binding.height <= 0 ||
      !Number.isFinite(binding.duration_seconds) || binding.duration_seconds < 2 || binding.duration_seconds > 26.25 ||
      !Number.isSafeInteger(binding.frame_count) || binding.frame_count <= 0 || binding.frame_count > 10_000 ||
      !/^sha256:[a-f0-9]{64}$/u.test(binding.profile_schema_hash) || !/^sha256:[a-f0-9]{64}$/u.test(binding.request_fingerprint) ||
      !/^sha256:[a-f0-9]{64}$/u.test(binding.intent_fingerprint) || binding.original_handle.length < 36 ||
      binding.source_binding.public_catalog_version !== "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json") fail("CANDIDATE_INVALID");
}

function exactPreparedRequest(value: unknown, binding: Readonly<OwnerTopazEnhanceOwnedCandidateBinding>): boolean {
  try {
    const request = exact(value, ["settings"]);
    const settings = exact(request.settings, ["model_type", "resolution", "video_duration", "width", "height", "parameters", "file_urls"]);
    const parameters = exact(settings.parameters, ["blur", "halo", "blend", "focus", "grain", "model", "noise", "details", "preblur", "promode", "upscale", "prenoise", "compression", "interpolation"]);
    const refs = settings.file_urls;
    const expected = binding.parameters;
    return settings.model_type === "topaz_enhance" && settings.resolution === String(expected.upscale) &&
      settings.video_duration === Math.round(binding.duration_seconds) && settings.width === binding.width && settings.height === binding.height &&
      parameters.blur === expected.blur && parameters.halo === expected.halo && parameters.blend === 0 && parameters.focus === expected.focus &&
      parameters.grain === expected.grain && parameters.model === expected.model && parameters.noise === expected.noise &&
      parameters.details === expected.details && parameters.preblur === expected.preblur && parameters.promode === 0 &&
      parameters.upscale === expected.upscale && parameters.prenoise === expected.prenoise && parameters.compression === expected.compression &&
      parameters.interpolation === expected.interpolation && Array.isArray(refs) && refs.length === 1 &&
      exact(refs[0], ["type", "url"]).type === "video" && typeof (refs[0] as { url?: unknown }).url === "string" &&
      isSafeUploadReferenceUrl((refs[0] as { url: string }).url);
  } catch { return false; }
}

async function consumeInvocation(input: unknown, packet: unknown, method: "create" | "start" | "list" | "get"):
  Promise<Readonly<{ client: SyntxChatHttpClient; callback: Function }>> {
  try {
    const native = await import("./chat-http-client.js");
    return native.consumeOwnerTopazEnhanceNativeInvocation(input, packet, method);
  } catch { fail("INVALID_REQUEST"); }
}

async function captureOriginal(fields: NativeInput, binding: Readonly<OwnerTopazEnhanceOwnedCandidateBinding>): Promise<CapturedOriginal> {
  const service = fields.originalReferenceService;
  if (!exactClientMethods(service) ||
      getDataMethod(service, "resolveOriginal") !== ORIGINAL_RESOLVE || getDataMethod(service, "withCapturedNativeOriginal") !== ORIGINAL_CAPTURE ||
      getDataMethod(service, "isOwnedOriginalResolution") !== ORIGINAL_GUARD) fail("CANDIDATE_INVALID");
  const resolveInput = Object.freeze({ attempt_id: fields.attemptId, topaz_original_handle: binding.original_handle });
  let resolution: OwnerTopazEnhanceOriginalResolution;
  try { resolution = await Reflect.apply(ORIGINAL_RESOLVE, service, [resolveInput]); }
  catch { fail("CANDIDATE_INVALID"); }
  if (!resolutionMatches(resolution!, binding, fields.principal) ||
      !Reflect.apply(ORIGINAL_GUARD, service, [resolution!, resolveInput])) fail("CANDIDATE_INVALID");
  try {
    return Reflect.apply(ORIGINAL_CAPTURE, service, [resolution!, resolveInput,
      (client: SyntxChatHttpClient, reference: OwnerTopazEnhanceOriginalUploadContext) => {
        const upload = readOwnerTopazEnhanceOriginalUploadForClient(client, reference);
        if (!upload || upload.model_id !== binding.model_id || upload.ai_name !== "topaz_ai" ||
            upload.source_catalog_version !== binding.source_binding.public_catalog_version || upload.source_sha256 !== binding.original_sha256 ||
            upload.source_size !== binding.original_size || upload.source_mime_type !== binding.mime_type || upload.width !== binding.width ||
            upload.height !== binding.height || upload.duration_seconds !== binding.duration_seconds || upload.frame_count !== binding.frame_count ||
            !isSafeUploadReferenceUrl(upload.url)) fail("CANDIDATE_INVALID");
        return Object.freeze({ client, reference, url: upload.url });
      }]) as CapturedOriginal;
  } catch { fail("CANDIDATE_INVALID"); }
}

function resolutionMatches(value: OwnerTopazEnhanceOriginalResolution, binding: Readonly<OwnerTopazEnhanceOwnedCandidateBinding>,
  principal: Readonly<GenerationPrincipalRef>): boolean {
  return value.role === "topaz_enhance_original" && value.wire_type === "video" && value.attempt_id === binding.attempt_id &&
    value.model_id === "topaz_enhance" && value.ai_name === "topaz_ai" && value.source_catalog_version === binding.source_binding.public_catalog_version &&
    value.profile_schema_hash === binding.profile_schema_hash && value.topaz_original_handle === binding.original_handle &&
    value.sha256 === binding.original_sha256 && value.mime_type === binding.mime_type && value.size === binding.original_size &&
    value.width === binding.width && value.height === binding.height && value.duration_seconds === binding.duration_seconds &&
    value.frame_count === binding.frame_count && value.epoch === binding.original_epoch && value.expires_at === binding.original_expires_at &&
    value.generation_permit === false && sameGenerationPrincipal(value.principal, principal);
}

async function revalidatePermit(fields: NativeInput): Promise<void> {
  await revalidateOwnerTopazEnhanceOwnedOneShotPermit({ permit: fields.permit, preparer: fields.preparer,
    candidate: fields.candidate, principal: fields.principal, attemptId: fields.attemptId });
}
function consumePermit(fields: NativeInput): void {
  consumeOwnerTopazEnhanceOwnedOneShotPermit({ permit: fields.permit, preparer: fields.preparer,
    candidate: fields.candidate, principal: fields.principal, attemptId: fields.attemptId });
}

async function assertCurrent(fields: NativeInput, signal?: AbortSignal): Promise<void> {
  if (signal && (types.isProxy(signal) || !(signal instanceof AbortSignal))) throw new Error("INVALID_ABORT_SIGNAL");
  if (signal?.aborted) fail("REQUEST_ABORTED");
  if (!(fields.linkService instanceof PerUserLinkService) || Object.getPrototypeOf(fields.linkService) !== PerUserLinkService.prototype ||
      getDataMethod(fields.linkService, "getStatus") !== PerUserLinkService.prototype.getStatus) fail("CANDIDATE_INVALID");
  const current = await resolveOwnerReferencePrincipal({ binding: fields.binding, attemptId: fields.attemptId, linkService: fields.linkService });
  if (!sameGenerationPrincipal(current, fields.principal) || signal?.aborted) fail(signal?.aborted ? "REQUEST_ABORTED" : "CANDIDATE_INVALID");
}

function sameOperation(a: NativeInput, b: NativeInput & { readonly chat?: OwnerTopazEnhanceNativeChatContext }): boolean {
  return a.preparer === b.preparer && a.candidate === b.candidate && a.permit === b.permit &&
    a.originalReferenceService === b.originalReferenceService && a.attemptId === b.attemptId && a.linkService === b.linkService &&
    sameGenerationPrincipal(a.principal, b.principal) && sameBinding(a.binding, b.binding);
}
function sameBinding(a: AuthBinding, b: AuthBinding): boolean { return a.tenant_id === b.tenant_id && a.subject === b.subject; }
function snapshotOriginal(binding: Readonly<OwnerTopazEnhanceOwnedCandidateBinding>): NativeState["originalSnapshot"] {
  return Object.freeze({ sha256: binding.original_sha256, size: binding.original_size, mime_type: binding.mime_type,
    width: binding.width, height: binding.height, duration_seconds: binding.duration_seconds, frame_count: binding.frame_count,
    epoch: binding.original_epoch, expires_at: binding.original_expires_at });
}
function sameOriginalSnapshot(binding: Readonly<OwnerTopazEnhanceOwnedCandidateBinding>, expected: NativeState["originalSnapshot"]): boolean {
  return binding.original_sha256 === expected.sha256 && binding.original_size === expected.size && binding.mime_type === expected.mime_type &&
    binding.width === expected.width && binding.height === expected.height && binding.duration_seconds === expected.duration_seconds &&
    binding.frame_count === expected.frame_count && binding.original_epoch === expected.epoch && binding.original_expires_at === expected.expires_at;
}

function decodeResult(raw: unknown, expected: ResultCodec): OwnerTopazEnhanceNativeResult {
  try {
    const message = exact(raw, ["id", "chat_id", "author_id", "message_object"], ["created_at", "updated_at", "is_favorite"]);
    if (String(message.id) !== expected.message_id || message.author_id !== BOT_AUTHOR_ID || String(message.chat_id) !== expected.provider_chat_id) {
      return Object.freeze({ message_binding: "UNVERIFIED", model_echo: "MISMATCH", ready_videos: Object.freeze([]),
        gaps: Object.freeze(["MESSAGE_BINDING_MISMATCH"]), backend_acceptance: "UNPROVEN" });
    }
    if (!Array.isArray(message.message_object) || message.message_object.length > MESSAGE_LIMIT) {
      return Object.freeze({ message_binding: "BOUND", model_echo: "UNKNOWN", ready_videos: Object.freeze([]),
        gaps: Object.freeze(["MESSAGE_OBJECT_ARRAY_INVALID"]), backend_acceptance: "UNPROVEN" });
    }
    const ready: OwnerTopazEnhanceNativeReadyVideo[] = [], gaps: string[] = [], ids = new Set<string>();
    let modelEcho: OwnerTopazEnhanceNativeResult["model_echo"] = "MATCHED";
    for (let index = 0; index < message.message_object.length; index += 1) {
      const object = exact(message.message_object[index], ["id", "object_type", "object_url", "completed", "model_type", "message_id"],
        ["object_text", "created_at", "updated_at", "task_id", "metadata"]);
      const id = String(object.id);
      if (!safeId(id) || ids.has(id)) { gaps.push("OBJECT_ID_INVALID_OR_DUPLICATE"); continue; }
      ids.add(id);
      if (!expected.message_object_ids.includes(id)) { gaps.push("OBJECT_ID_UNEXPECTED"); continue; }
      if (String(object.message_id) !== expected.message_id) { gaps.push("CHILD_MESSAGE_ID_MISMATCH"); continue; }
      if (object.object_type !== "video") { gaps.push("OBJECT_TYPE_UNSUPPORTED"); continue; }
      if (object.model_type !== "topaz_enhance") { modelEcho = object.model_type == null ? "UNKNOWN" : "MISMATCH"; gaps.push("MODEL_TYPE_MISMATCH"); continue; }
      if (object.completed !== true) { gaps.push("OBJECT_INCOMPLETE"); continue; }
      if (typeof object.object_url !== "string" || !isSafeUploadReferenceUrl(object.object_url)) { gaps.push("OBJECT_URL_UNSAFE_OR_MISSING"); continue; }
      const extension = /\.([A-Za-z0-9]{1,8})$/u.exec(new URL(object.object_url).pathname)?.[1]?.toLowerCase();
      const mime = extension === "mp4" ? "video/mp4" : extension === "mov" ? "video/quicktime" : null;
      ready.push(Object.freeze({ object_index: index, message_object_id: id, object_type: "video", object_url: object.object_url,
        mime_type: mime, mime_source: mime === null ? "UNKNOWN" : "URL_EXTENSION" }));
    }
    for (const id of expected.message_object_ids) if (!ids.has(id)) gaps.push("EXPECTED_OBJECT_ID_MISSING");
    return Object.freeze({ message_binding: "BOUND", model_echo: modelEcho,
      ready_videos: Object.freeze(gaps.length === 0 && ready.length === 1 ? ready : []),
      gaps: Object.freeze(gaps), backend_acceptance: "UNPROVEN" });
  } catch {
    return Object.freeze({ message_binding: "UNVERIFIED", model_echo: "UNKNOWN", ready_videos: Object.freeze([]),
      gaps: Object.freeze(["RESULT_ENVELOPE_INVALID"]), backend_acceptance: "UNPROVEN" });
  }
}

function emptyCandidates(status: OwnerTopazEnhanceNativeResultCandidates["status"], pageStatus: OwnerTopazEnhanceNativeResultCandidates["history_page_status"],
  calls: number, gap: string): OwnerTopazEnhanceNativeResultCandidates {
  return Object.freeze({ status, owner_ack_status: "MISSING", history_binding_status: "UNVERIFIED", history_page_status: pageStatus,
    history_get_calls: calls, total_count: null, total_pages: null, provider_chat_id: null, owner_echo_message_id: null,
    contexts: Object.freeze([]), gaps: Object.freeze([gap]), backend_acceptance: "UNPROVEN" });
}

function exactClientMethods(service: unknown): boolean {
  if (!service || typeof service !== "object" || types.isProxy(service) || Object.getPrototypeOf(service) !== OwnerTopazEnhanceOriginalReferenceService.prototype) return false;
  return ["resolveOriginal", "isOwnedOriginalResolution", "withCapturedNativeOriginal"].every((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(OwnerTopazEnhanceOriginalReferenceService.prototype, name);
    return !!descriptor && "value" in descriptor && typeof descriptor.value === "function" && getDataMethod(service, name) === descriptor.value;
  });
}
function exactPreparerMethods(preparer: OwnerTopazEnhanceOwnedRequestPreparerType): boolean {
  return isOwnerTopazEnhanceOwnedRequestPreparer(preparer) &&
    getDataMethod(preparer, "inspectCandidate") === PREPARER_METHODS.inspect &&
    getDataMethod(preparer, "getPrivateRequest") === PREPARER_METHODS.request &&
    getDataMethod(preparer, "revalidateCandidate") === PREPARER_METHODS.revalidate;
}
function getDataMethod(target: object, key: string): unknown {
  let current: object | null = target;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new TypeError("INVALID_SHAPE");
  const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(descriptors);
  const allowed = new Set([...required, ...optional]);
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      actual.some((key) => typeof key !== "string" || !allowed.has(key) || !descriptors[key]!.enumerable || !("value" in descriptors[key]!))) {
    throw new TypeError("INVALID_SHAPE");
  }
  const output = Object.create(null) as Record<string, any>;
  for (const key of actual as string[]) output[key] = descriptors[key]!.value;
  return output;
}
function safeId(value: unknown): value is string { return typeof value === "string" && ID.test(value); }
function fail(code: OwnerTopazEnhanceNativeErrorCode): never { throw new OwnerTopazEnhanceNativeError(code); }
