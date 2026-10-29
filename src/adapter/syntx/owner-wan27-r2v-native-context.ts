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
import {
  SyntxChatHttpClient,
  type MediaGenerationReceipt
} from "./chat-http-client.js";
import {
  readOwnerWan27R2vUploadReferenceForClient,
  type OwnerWan27R2vUploadContext
} from "./wan27-r2v-upload-context.js";
import {
  isOwnerWan27R2vRequestPreparer,
  isOwnerWan27R2vPreparedCandidate,
  type OwnerWan27R2vPreparedCandidate,
  type OwnerWan27R2vPreparedCandidateBinding,
  type OwnerWan27R2vPreparedRequest,
  type OwnerWan27R2vRequestPreparer
} from "../../application/owner-wan27-r2v-request-preparer.js";
import {
  consumeOwnerWan27R2vOneShotPermit,
  revalidateOwnerWan27R2vOneShotPermit,
  OwnerWan27R2vOneShotPolicyError,
  type OwnerWan27R2vOneShotPermit
} from "../../application/owner-wan27-r2v-one-shot-policy.js";
import {
  isOwnerWan27R2vReferenceService,
  OwnerWan27R2vReferenceService,
  OwnerWan27R2vReferenceServiceError,
  type OwnerWan27R2vReferenceService as ReferenceService
} from "../../application/owner-wan27-r2v-reference-service.js";
import { OwnerWan27R2vRequestPreparerError } from "../../application/owner-wan27-r2v-request-preparer.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const PAGE_SIZE = 10, PAGE_LIMIT = 7, MESSAGE_LIMIT = 64, BOT_AUTHOR_ID = -1;
const NATIVE_LINK_GET_STATUS = PerUserLinkService.prototype.getStatus;
const NATIVE_REFERENCE_RESOLVE = OwnerWan27R2vReferenceService.prototype.resolveManifest;
const NATIVE_REFERENCE_IS_OWNED = OwnerWan27R2vReferenceService.prototype.isOwnedManifest;
const NATIVE_REFERENCE_CAPTURE = OwnerWan27R2vReferenceService.prototype.withCapturedNativeReferences;
const chats = new WeakMap<object, Map<string, NativeState>>();
const operations = new WeakMap<object, NativeState>();
const resultContexts = new WeakMap<object, ResultState>();
const reservedCandidates = new WeakSet<object>();
const pendingCreates = new WeakSet<object>();
const pendingStarts = new WeakSet<object>();

export interface OwnerWan27R2vNativeOperationInput {
  readonly preparer: OwnerWan27R2vRequestPreparer;
  readonly candidate: OwnerWan27R2vPreparedCandidate;
  readonly permit: OwnerWan27R2vOneShotPermit;
  readonly referenceService: ReferenceService;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly linkService: PerUserLinkService;
  readonly binding: AuthBinding;
}
export interface OwnerWan27R2vChatContext {
  readonly status: "created";
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly model_id: "wan_27_r2v";
  readonly profile_schema_hash: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly expires_at: number;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}
export interface OwnerWan27R2vResultContext {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly model_id: "wan_27_r2v";
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly string[];
  readonly attempt_id: string;
  readonly profile_schema_hash: string;
  readonly intent_fingerprint: string;
  readonly owner_echo_message_id: string;
}
export interface OwnerWan27R2vResultCandidates {
  readonly status: "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  readonly history_binding_status: "BOUND" | "PARTIAL" | "UNVERIFIED";
  readonly history_page_status: "NOT_READ" | "COMPLETE" | "INCOMPLETE" | "UNPROVEN";
  readonly history_get_calls: number;
  readonly total_count: number | null;
  readonly total_pages: number | null;
  readonly provider_chat_id: string | null;
  readonly owner_echo_message_id: string | null;
  readonly contexts: readonly OwnerWan27R2vResultContext[];
  readonly gaps: readonly string[];
  readonly backend_acceptance: "UNPROVEN";
}
export interface OwnerWan27R2vResult {
  readonly message_binding: "BOUND" | "UNVERIFIED";
  readonly model_echo: "MATCHED" | "UNKNOWN" | "MISMATCH";
  readonly ready_videos: readonly Readonly<{
    readonly object_index: number;
    readonly message_object_id: string;
    readonly object_type: "video";
    readonly object_url: string;
    readonly mime_type: "video/mp4" | "video/quicktime" | null;
    readonly mime_source: "URL_EXTENSION" | "UNKNOWN";
  }>[];
  readonly gaps: readonly string[];
  readonly backend_acceptance: "UNPROVEN";
}
export type OwnerWan27R2vNativeErrorCode =
  | "INVALID_REQUEST" | "CANDIDATE_INVALID" | "PRINCIPAL_NOT_LINKED" | "CHAT_CREATE_FAILED"
  | "CHAT_CONTEXT_INVALID" | "CHAT_ALREADY_CREATED" | "CHAT_NOT_DISPATCHED" | "CHAT_DISPATCH_ALREADY_STARTED"
  | "OUTCOME_UNKNOWN" | "HISTORY_UNAVAILABLE" | "RESULT_CONTEXT_INVALID" | "RESULT_GET_UNAVAILABLE"
  | "REQUEST_ABORTED" | "CAPACITY_EXCEEDED";
export class OwnerWan27R2vNativeError extends Error {
  constructor(readonly code: OwnerWan27R2vNativeErrorCode) {
    super("The owner WAN 2.7 R2V native operation could not be completed safely.");
    this.name = "OwnerWan27R2vNativeError";
  }
}

type NativeInput = Readonly<OwnerWan27R2vNativeOperationInput & {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly binding: Readonly<AuthBinding>;
}>;
interface NativeState {
  readonly client: SyntxChatHttpClient;
  readonly input: NativeInput;
  readonly chat: OwnerWan27R2vChatContext;
  readonly references: readonly OwnerWan27R2vUploadContext[];
  readonly request: OwnerWan27R2vPreparedRequest;
  phase: "AVAILABLE" | "OUTCOME_UNKNOWN" | "ACKNOWLEDGED";
  ownerEcho?: string;
  readonly contexts: Map<string, OwnerWan27R2vResultContext>;
}
interface ResultState {
  readonly client: SyntxChatHttpClient;
  readonly state: NativeState;
  readonly context: OwnerWan27R2vResultContext;
}
const idValue = z.union([z.string().regex(ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String);
const historyPageSchema = z.object({
  messages: z.array(z.unknown()).max(PAGE_SIZE),
  pagination: z.object({
    page: z.number().int().min(1).max(PAGE_LIMIT), page_size: z.literal(PAGE_SIZE),
    total_count: z.number().int().min(0).max(MESSAGE_LIMIT), total_pages: z.number().int().min(0).max(PAGE_LIMIT),
    has_next: z.boolean(), has_previous: z.boolean()
  }).passthrough()
}).passthrough();
const objectSchema = z.object({ id: idValue, message_id: idValue, object_type: z.string(), model_type: z.string().nullable().optional() }).passthrough();
const rowSchema = z.object({ id: idValue, chat_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  author_id: z.number().int(), message_object: z.array(objectSchema).max(64) }).passthrough();
type HistoryRow = z.infer<typeof rowSchema>;

export async function createOwnerWan27R2vChat(input: unknown, packet: unknown, signal?: AbortSignal): Promise<OwnerWan27R2vChatContext> {
  const { client, callback } = await consume(input, packet, "create");
  const createChat = callback as (title: string, signal?: AbortSignal) => Promise<{ chat_uuid: string }>;
  const fields = readOperation(input, false);
  validateSignal(signal);
  if (signal?.aborted) fail("REQUEST_ABORTED");
  await assertCurrent(fields, signal);
  await validateCandidate(fields, signal);
  try {
    await revalidateOwnerWan27R2vOneShotPermit({ permit: fields.permit, preparer: fields.preparer,
      candidate: fields.candidate, principal: fields.principal, attemptId: fields.attemptId });
  } catch { fail("CANDIDATE_INVALID"); }
  if (reservedCandidates.has(fields.candidate as object) || pendingCreates.has(fields.candidate as object)) fail("CHAT_ALREADY_CREATED");
  const perClient = chats.get(client) ?? new Map<string, NativeState>();
  if (perClient.size >= 128) fail("CAPACITY_EXCEEDED");
  try {
    const captured = await capture(fields, client, async () => {
      if (reservedCandidates.has(fields.candidate as object) || pendingCreates.has(fields.candidate as object)) fail("CHAT_ALREADY_CREATED");
      reservedCandidates.add(fields.candidate as object);
      pendingCreates.add(fields.candidate as object);
      await assertCurrent(fields, signal);
      const receipt = await createChat(`owner-wan27-r2v-${cryptoRandomUuid()}`, signal);
      if (signal?.aborted || !isSafeId(receipt?.chat_uuid) || perClient.has(receipt.chat_uuid)) fail("CHAT_CREATE_FAILED");
      await assertCurrent(fields, signal);
      return { chatUuid: receipt.chat_uuid };
    }, signal);
    await revalidateOwnerWan27R2vOneShotPermit({ permit: fields.permit, preparer: fields.preparer,
      candidate: fields.candidate, principal: fields.principal, attemptId: fields.attemptId });
    await assertCurrent(fields, signal);
    const binding = fields.preparer.inspectCandidate(fields.candidate);
    if (!binding || captured.client !== client) fail("CANDIDATE_INVALID");
    const chat: OwnerWan27R2vChatContext = Object.freeze({ status: "created", chat_uuid: captured.value.chatUuid,
      attempt_id: fields.attemptId, model_id: "wan_27_r2v", profile_schema_hash: binding.profile_schema_hash,
      request_fingerprint: binding.request_fingerprint, intent_fingerprint: binding.intent_fingerprint,
      expires_at: binding.expires_at, dispatch_allowed: false, backend_acceptance: "UNPROVEN" });
    const state: NativeState = { client, input: fields, chat, references: captured.contexts, request: captured.request,
      phase: "AVAILABLE", contexts: new Map() };
    perClient.set(chat.chat_uuid, state); operations.set(chat, state); chats.set(client, perClient);
    return chat;
  } catch (error) { throw translate(error, "CHAT_CREATE_FAILED"); }
  finally { pendingCreates.delete(fields.candidate as object); }
}

export async function startOwnerWan27R2vWithOwnedCandidate(input: unknown, packet: unknown,
  signal?: AbortSignal): Promise<Readonly<{ chat_uuid: string; message_id: string }>> {
  const { client, callback } = await consume(input, packet, "start");
  const start = callback as (chatUuid: string, body: Record<string, unknown>, signal?: AbortSignal) => Promise<MediaGenerationReceipt>;
  const fields = readOperation(input, true), state = stateFor(client, fields.chat);
  if (state.phase !== "AVAILABLE" || !sameOperation(state.input, fields)) fail("CHAT_CONTEXT_INVALID");
  if (pendingStarts.has(state.chat)) fail("CHAT_DISPATCH_ALREADY_STARTED");
  validateSignal(signal);
  if (signal?.aborted) fail("REQUEST_ABORTED");
  pendingStarts.add(state.chat);
  let postStarted = false;
  try {
    await validateCandidate(fields, signal);
    await assertCurrent(state.input, signal);
    const result = await capture(fields, client, async () => {
      await assertCurrent(state.input, signal);
      await revalidateOwnerWan27R2vOneShotPermit({ permit: fields.permit, preparer: fields.preparer,
        candidate: fields.candidate, principal: fields.principal, attemptId: fields.attemptId });
      await assertCurrent(state.input, signal);
      const receipt = consumeOwnerWan27R2vOneShotPermit({ permit: fields.permit, preparer: fields.preparer,
        candidate: fields.candidate, principal: fields.principal, attemptId: fields.attemptId });
      if (receipt.request_fingerprint !== state.chat.request_fingerprint || schemaHash(receipt.request) !== schemaHash(state.request)) fail("CANDIDATE_INVALID");
      const body = { chat_id: state.chat.chat_uuid, prompt: receipt.request.prompt, settings: receipt.request.settings };
      postStarted = true; state.phase = "OUTCOME_UNKNOWN";
      const ack = await start(state.chat.chat_uuid, body, signal);
      if (ack.chat_uuid !== state.chat.chat_uuid || !isSafeId(ack.message_id)) fail("OUTCOME_UNKNOWN");
      state.ownerEcho = ack.message_id; state.phase = "ACKNOWLEDGED";
      if (signal?.aborted) fail("OUTCOME_UNKNOWN");
      return { chat_uuid: ack.chat_uuid, message_id: ack.message_id };
    }, signal);
    if (result.value.chat_uuid !== state.chat.chat_uuid || !state.ownerEcho || result.value.message_id !== state.ownerEcho) fail("OUTCOME_UNKNOWN");
    return Object.freeze({ chat_uuid: result.value.chat_uuid, message_id: result.value.message_id });
  } catch (error) {
    if (postStarted || isPostDispatched(state)) fail("OUTCOME_UNKNOWN");
    throw translate(error, "CANDIDATE_INVALID");
  } finally { pendingStarts.delete(state.chat); }
}

export async function listOwnerWan27R2vCandidates(input: unknown, packet: unknown, signal?: AbortSignal): Promise<OwnerWan27R2vResultCandidates> {
  const { client, callback } = await consume(input, packet, "list");
  const getPage = callback as (chatUuid: string, page: number, pageSize: number, signal?: AbortSignal) => Promise<unknown>;
  const state = stateFor(client, input);
  if (state.phase !== "ACKNOWLEDGED" && state.phase !== "OUTCOME_UNKNOWN") fail("CHAT_NOT_DISPATCHED");
  validateSignal(signal);
  if (signal?.aborted) fail("REQUEST_ABORTED");
  const rows: HistoryRow[] = [], messageIds = new Set<string>(), objectIds = new Set<string>();
  let providerChatId: string | undefined, totalCount: number | undefined, totalPages: number | undefined, calls = 0;
  try {
    for (let page = 1; page <= PAGE_LIMIT; page += 1) {
      await assertCurrent(state.input, signal); calls += 1;
      let raw: unknown;
      try { raw = await getPage(state.chat.chat_uuid, page, PAGE_SIZE, signal); }
      finally { await assertCurrent(state.input, signal); }
      const parsed = historyPageSchema.safeParse(raw);
      if (!parsed.success) return emptyCandidates("UNVERIFIED", "UNPROVEN", calls, "HISTORY_PAGE_INVALID");
      const p = parsed.data.pagination, pages = p.total_count === 0 ? 0 : Math.ceil(p.total_count / PAGE_SIZE);
      const expectedRows = Math.min(PAGE_SIZE, Math.max(0, p.total_count - (page - 1) * PAGE_SIZE));
      if (p.page !== page || p.total_pages !== pages || p.has_previous !== (page > 1) || p.has_next !== (page < pages) ||
          parsed.data.messages.length !== expectedRows || (totalCount !== undefined && (totalCount !== p.total_count || totalPages !== p.total_pages))) {
        return emptyCandidates("UNVERIFIED", "UNPROVEN", calls, "HISTORY_PAGE_INCONSISTENT");
      }
      if (pages === 0) return emptyCandidates("PENDING", "COMPLETE", calls, "HISTORY_EMPTY");
      totalCount ??= p.total_count; totalPages ??= p.total_pages;
      for (const rawRow of parsed.data.messages) {
        const parsedRow = rowSchema.safeParse(rawRow);
        if (!parsedRow.success) return emptyCandidates("UNVERIFIED", "UNPROVEN", calls, "HISTORY_ROW_INVALID");
        const row = parsedRow.data, rowChatId = String(row.chat_id);
        if (!/^\d{1,16}$/u.test(rowChatId) || (providerChatId !== undefined && providerChatId !== rowChatId) || messageIds.has(row.id) ||
            row.message_object.some((object) => object.message_id !== row.id || objectIds.has(object.id))) {
          return emptyCandidates("UNVERIFIED", "UNPROVEN", calls, "HISTORY_JOIN_INVALID");
        }
        providerChatId ??= rowChatId; messageIds.add(row.id);
        for (const object of row.message_object) objectIds.add(object.id);
        rows.push(row);
      }
      if (page === pages) break;
    }
  } catch (error) {
    if (signal?.aborted) fail("REQUEST_ABORTED");
    if (error instanceof OwnerWan27R2vNativeError && error.code === "PRINCIPAL_NOT_LINKED") throw error;
    return emptyCandidates("UNVERIFIED", "INCOMPLETE", calls, "HISTORY_UNAVAILABLE");
  }
  if (rows.length !== totalCount || providerChatId === undefined) return emptyCandidates("UNVERIFIED", "INCOMPLETE", calls, "HISTORY_INCOMPLETE");
  const acks = state.ownerEcho ? rows.filter((row) => row.id === state.ownerEcho && row.author_id > 0) : [];
  if (acks.length !== 1) return Object.freeze({ ...emptyCandidates("INCOMPLETE", "COMPLETE", calls,
    state.ownerEcho ? "OWNER_ACK_MISSING" : "POST_ACK_UNKNOWN"),
    owner_ack_status: state.ownerEcho ? "MISMATCH" : "MISSING", total_count: totalCount ?? 0, total_pages: totalPages ?? 0,
    provider_chat_id: providerChatId, owner_echo_message_id: state.ownerEcho ?? null });
  const contexts: OwnerWan27R2vResultContext[] = [], gaps: string[] = [];
  for (const row of rows) {
    if (row.author_id !== BOT_AUTHOR_ID) continue;
    const videos = row.message_object.filter((object) => object.object_type === "video");
    if (!videos.length) continue;
    const matched = videos.filter((video) => video.model_type === "wan_27_r2v");
    if (matched.length !== videos.length) { gaps.push("BOT_VIDEO_MODEL_MISMATCH"); continue; }
    const ids = Object.freeze(matched.map((video) => video.id));
    const context: OwnerWan27R2vResultContext = Object.freeze({ chat_uuid: state.chat.chat_uuid, message_id: row.id,
      model_id: "wan_27_r2v", provider_chat_id: providerChatId, message_object_ids: ids,
      attempt_id: state.chat.attempt_id, profile_schema_hash: state.chat.profile_schema_hash,
      intent_fingerprint: state.chat.intent_fingerprint, owner_echo_message_id: state.ownerEcho! });
    const previous = state.contexts.get(row.id);
    if (previous && schemaHash(previous) !== schemaHash(context)) return emptyCandidates("UNVERIFIED", "UNPROVEN", calls, "RESULT_CONTEXT_MISMATCH");
    if (!previous) { resultContexts.set(context, { client, state, context }); state.contexts.set(row.id, context); }
    contexts.push(previous ?? context);
  }
  return Object.freeze({ status: contexts.length ? "COMPLETE" : gaps.length ? "UNVERIFIED" : "PENDING",
    owner_ack_status: "MATCHED", history_binding_status: contexts.length ? "BOUND" : gaps.length ? "PARTIAL" : "BOUND",
    history_page_status: "COMPLETE", history_get_calls: calls, total_count: totalCount!, total_pages: totalPages!,
    provider_chat_id: providerChatId, owner_echo_message_id: state.ownerEcho!, contexts: Object.freeze(contexts),
    gaps: Object.freeze(gaps.length ? gaps : contexts.length ? [] : ["BOT_RESULT_NOT_OBSERVED"]), backend_acceptance: "UNPROVEN" });
}

export async function getOwnerWan27R2vResult(input: unknown, packet: unknown, signal?: AbortSignal): Promise<OwnerWan27R2vResult> {
  const { client, callback } = await consume(input, packet, "get");
  const getMessage = callback as (chatUuid: string, messageId: string, signal?: AbortSignal) => Promise<unknown>;
  if (!input || typeof input !== "object" || types.isProxy(input)) fail("RESULT_CONTEXT_INVALID");
  const owned = resultContexts.get(input as object);
  if (!owned || owned.client !== client || owned.context !== input || owned.state.phase !== "ACKNOWLEDGED" ||
      owned.state.ownerEcho !== owned.context.owner_echo_message_id || operations.get(owned.state.chat) !== owned.state) fail("RESULT_CONTEXT_INVALID");
  validateSignal(signal);
  if (signal?.aborted) fail("REQUEST_ABORTED");
  await assertCurrent(owned.state.input, signal);
  try {
    let raw: unknown;
    try { raw = await getMessage(owned.context.chat_uuid, owned.context.message_id, signal); }
    finally { await assertCurrent(owned.state.input, signal); }
    return decodeResult(raw, owned.context);
  } catch (error) {
    if (signal?.aborted) fail("REQUEST_ABORTED");
    if (error instanceof OwnerWan27R2vNativeError && error.code === "PRINCIPAL_NOT_LINKED") throw error;
    fail("RESULT_GET_UNAVAILABLE");
  }
}

function readOperation(value: unknown, withChat: boolean): NativeInput & { readonly chat?: OwnerWan27R2vChatContext } {
  const fields = exact(value, ["preparer", "candidate", "permit", "referenceService", "principal", "attemptId", "linkService", "binding",
    ...(withChat ? ["chat"] : [])]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || !fields.candidate || typeof fields.candidate !== "object" || types.isProxy(fields.candidate) ||
      !fields.permit || typeof fields.permit !== "object" || types.isProxy(fields.permit)) fail("INVALID_REQUEST");
  if (!isOwnerWan27R2vRequestPreparer(fields.preparer) || !isOwnerWan27R2vPreparedCandidate(fields.candidate) ||
      !isOwnerWan27R2vReferenceService(fields.referenceService) || !isNativeReferenceService(fields.referenceService)) fail("CANDIDATE_INVALID");
  const attemptId = fields.attemptId;
  const principal = snapshotPrincipal(fields.principal as GenerationPrincipalRef, attemptId);
  const binding = snapshotBinding(fields.binding);
  if (!(fields.permit as OwnerWan27R2vOneShotPermit).model_id ||
      (withChat && (!fields.chat || typeof fields.chat !== "object" || types.isProxy(fields.chat)))) fail("INVALID_REQUEST");
  return Object.freeze({ preparer: fields.preparer as OwnerWan27R2vRequestPreparer,
    candidate: fields.candidate as OwnerWan27R2vPreparedCandidate, permit: fields.permit as OwnerWan27R2vOneShotPermit,
    referenceService: fields.referenceService as ReferenceService, principal, attemptId,
    linkService: fields.linkService as PerUserLinkService, binding,
    ...(withChat ? { chat: fields.chat as OwnerWan27R2vChatContext } : {}) });
}

async function validateCandidate(fields: NativeInput, signal?: AbortSignal): Promise<Readonly<OwnerWan27R2vPreparedCandidateBinding>> {
  await assertCurrent(fields, signal);
  try { await fields.preparer.revalidateCandidate(fields.candidate, signal); }
  catch { fail("CANDIDATE_INVALID"); }
  const binding = fields.preparer.inspectCandidate(fields.candidate), request = fields.preparer.getPrivateRequest(fields.candidate);
  if (!binding) fail("CANDIDATE_INVALID");
  assertCandidate(fields.candidate, binding, fields.principal, fields.attemptId, request);
  await assertCurrent(fields, signal);
  return binding;
}

function assertCandidate(candidate: OwnerWan27R2vPreparedCandidate, binding: Readonly<OwnerWan27R2vPreparedCandidateBinding>,
  principal: Readonly<GenerationPrincipalRef>, attemptId: string, request: OwnerWan27R2vPreparedRequest): void {
  if (candidate.status !== "prepared" || candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" ||
      candidate.model_id !== "wan_27_r2v" || candidate.intent_fingerprint !== binding.intent_fingerprint ||
      candidate.request_fingerprint !== binding.request_fingerprint || candidate.request_fingerprint !== binding.wire_fingerprint ||
      candidate.profile_schema_hash !== binding.profile_schema_hash || candidate.expires_at !== binding.expires_at ||
      binding.attempt_id !== attemptId || !sameGenerationPrincipal(binding.principal, principal) ||
      schemaHash(request) !== binding.wire_fingerprint || Object.hasOwn(request.settings, "n") ||
      request.settings.model_type !== "wan_27_r2v" || request.settings.shot_type !== "single" || request.settings.audio_setting !== "auto") fail("CANDIDATE_INVALID");
}

async function capture<T>(fields: NativeInput, expectedClient: SyntxChatHttpClient,
  consume: (client: SyntxChatHttpClient, contexts: readonly OwnerWan27R2vUploadContext[], request: OwnerWan27R2vPreparedRequest) => T | Promise<T>,
  signal?: AbortSignal): Promise<{ readonly value: T; readonly client: SyntxChatHttpClient;
    readonly contexts: readonly OwnerWan27R2vUploadContext[]; readonly request: OwnerWan27R2vPreparedRequest }> {
  const result = await fields.preparer.withCapturedNativeReferences(fields.candidate, async (client, contexts, request) => {
    if (client !== expectedClient) fail("CANDIDATE_INVALID");
    const binding = fields.preparer.inspectCandidate(fields.candidate);
    if (!binding) fail("CANDIDATE_INVALID");
    assertCandidate(fields.candidate, binding, fields.principal, fields.attemptId, request);
    assertCapturedReferences(client, fields.candidate, contexts, request);
    const value = await consume(client, contexts, request);
    return { value, client, contexts: Object.freeze([...contexts]), request };
  }, signal);
  return result;
}

function assertCapturedReferences(client: SyntxChatHttpClient, candidate: OwnerWan27R2vPreparedCandidate,
  contexts: readonly OwnerWan27R2vUploadContext[], request: OwnerWan27R2vPreparedRequest): void {
  if (contexts.length !== candidate.input_references.length || contexts.length < 1 || contexts.length > 6 ||
      candidate.image_reference_count > 6 || candidate.selected_video_reference_count > 5 ||
      (candidate.selected_video_reference_count > 0 && contexts.length > 5) ||
      candidate.image_reference_count + candidate.selected_video_reference_count !== contexts.length) fail("CANDIDATE_INVALID");
  const expectedFiles: { type: "image" | "video"; url: string }[] = [], seen = new Set<string>();
  for (let index = 0; index < contexts.length; index += 1) {
    const context = contexts[index]!, expected = candidate.input_references[index]!;
    if (context.status !== "uploaded" || context.model_id !== "wan_27_r2v" || context.media_type !== expected.media_type ||
        context.mime_type !== expected.mime_type || context.size !== expected.size || context.sha256 !== expected.sha256 ||
        context.width !== expected.width || context.height !== expected.height) fail("CANDIDATE_INVALID");
    const file = context.media_type === "image" ? "image" : "video";
    if (context.media_type === "selected_video") {
      if (context.source_sha256 !== expected.source_sha256 || context.selected_duration_seconds !== expected.selected_duration_seconds ||
          context.video_duration_seconds !== expected.video_duration_seconds) fail("CANDIDATE_INVALID");
    }
    const reference = readOwnerWan27R2vUploadReferenceForClient(client, context);
    if (!reference || !isSafeUploadReferenceUrl(reference.url)) fail("CANDIDATE_INVALID");
    const key = JSON.stringify([file, reference.url]);
    if (!seen.has(key)) { seen.add(key); expectedFiles.push({ type: file, url: reference.url }); }
  }
  if (schemaHash(expectedFiles) !== schemaHash(request.settings.file_urls)) fail("CANDIDATE_INVALID");
}

async function assertCurrent(fields: NativeInput, signal?: AbortSignal): Promise<void> {
  validateSignal(signal);
  if (signal?.aborted) fail("REQUEST_ABORTED");
  if (!isLinkService(fields.linkService)) fail("PRINCIPAL_NOT_LINKED");
  try {
    const current = await resolveOwnerReferencePrincipal({ binding: fields.binding, attemptId: fields.attemptId, linkService: fields.linkService });
    if (!sameGenerationPrincipal(current, fields.principal) || signal?.aborted) fail(signal?.aborted ? "REQUEST_ABORTED" : "PRINCIPAL_NOT_LINKED");
  } catch (error) {
    if (error instanceof OwnerWan27R2vNativeError) throw error;
    if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
    fail("PRINCIPAL_NOT_LINKED");
  }
}

function stateFor(client: SyntxChatHttpClient, value: unknown): NativeState {
  if (!value || typeof value !== "object" || types.isProxy(value)) fail("CHAT_CONTEXT_INVALID");
  const state = operations.get(value as object);
  if (!state || state.client !== client || state.chat !== value || chats.get(client)?.get(state.chat.chat_uuid) !== state) fail("CHAT_CONTEXT_INVALID");
  return state;
}
function isPostDispatched(state: NativeState): boolean { return state.phase === "OUTCOME_UNKNOWN" || state.phase === "ACKNOWLEDGED"; }
function sameOperation(a: NativeInput, b: NativeInput): boolean {
  return a.preparer === b.preparer && a.candidate === b.candidate && a.permit === b.permit && a.referenceService === b.referenceService &&
    a.attemptId === b.attemptId && a.linkService === b.linkService && sameGenerationPrincipal(a.principal, b.principal) &&
    a.binding.tenant_id === b.binding.tenant_id && a.binding.subject === b.binding.subject;
}
function isNativeReferenceService(value: ReferenceService): boolean {
  return Object.getPrototypeOf(value) === OwnerWan27R2vReferenceService.prototype &&
    OwnerWan27R2vReferenceService.prototype.resolveManifest === NATIVE_REFERENCE_RESOLVE &&
    OwnerWan27R2vReferenceService.prototype.isOwnedManifest === NATIVE_REFERENCE_IS_OWNED &&
    OwnerWan27R2vReferenceService.prototype.withCapturedNativeReferences === NATIVE_REFERENCE_CAPTURE;
}
function isLinkService(value: unknown): value is PerUserLinkService {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(PerUserLinkService.prototype, "getStatus");
    return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === PerUserLinkService.prototype &&
      !Object.hasOwn(value, "getStatus") && !!descriptor && "value" in descriptor && descriptor.value === NATIVE_LINK_GET_STATUS &&
      Reflect.get(value, "getStatus") === NATIVE_LINK_GET_STATUS;
  } catch { return false; }
}
function snapshotPrincipal(value: GenerationPrincipalRef, attemptId: string): Readonly<GenerationPrincipalRef> {
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value); } catch { fail("INVALID_REQUEST"); }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_NOT_LINKED");
  return principal;
}
function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exact(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || !fields.tenant_id.trim() || typeof fields.subject !== "string" || !fields.subject.trim()) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}
function validateSignal(signal?: AbortSignal): void {
  if (signal !== undefined && (!signal || types.isProxy(signal) || !(signal instanceof AbortSignal))) fail("INVALID_REQUEST");
}
function safeR2(value: unknown): value is string {
  if (typeof value !== "string" || !isSafeUploadReferenceUrl(value)) return false;
  try {
    const url = new URL(value);
    return url.hostname === "r2.syntx.ai" && /\.(?:mp4|mov)$/iu.test(url.pathname);
  } catch { return false; }
}
function decodeResult(rawInput: unknown, context: OwnerWan27R2vResultContext): OwnerWan27R2vResult {
  try {
    const message = z.object({ id: idValue, chat_id: idValue, author_id: z.number().int(), message_object: z.array(z.unknown()).max(64) }).passthrough().safeParse(rawInput);
    if (!message.success || message.data.id !== context.message_id || message.data.chat_id !== context.provider_chat_id ||
        message.data.author_id !== BOT_AUTHOR_ID) return unverified("MESSAGE_BINDING_MISMATCH");
    const ready: OwnerWan27R2vResult["ready_videos"][number][] = [], gaps: string[] = [], seen = new Set<string>();
    for (let index = 0; index < message.data.message_object.length; index += 1) {
      const parsed = z.object({ id: idValue, message_id: idValue, object_type: z.string(), model_type: z.string().nullable().optional(),
        completed: z.boolean().optional(), object_url: z.string().optional() }).passthrough().safeParse(message.data.message_object[index]);
      if (!parsed.success) { gaps.push("RESULT_OBJECT_INVALID"); continue; }
      const object = parsed.data;
      if (!context.message_object_ids.includes(object.id)) { gaps.push("OBJECT_ID_UNEXPECTED"); continue; }
      if (object.message_id !== context.message_id) { gaps.push("CHILD_MESSAGE_ID_MISMATCH"); continue; }
      if (seen.has(object.id)) { gaps.push("OBJECT_ID_DUPLICATE"); continue; }
      seen.add(object.id);
      if (object.object_type !== "video") { gaps.push("OBJECT_TYPE_UNSUPPORTED"); continue; }
      if (object.model_type !== "wan_27_r2v") { gaps.push("MODEL_TYPE_MISMATCH"); continue; }
      if (object.completed !== true) { gaps.push("OBJECT_INCOMPLETE"); continue; }
      if (!safeR2(object.object_url)) { gaps.push("OBJECT_URL_UNSAFE_OR_MISSING"); continue; }
      const extension = /\.([A-Za-z0-9]{1,8})$/u.exec(new URL(object.object_url).pathname)?.[1]?.toLowerCase();
      const mime = extension === "mp4" ? "video/mp4" : extension === "mov" ? "video/quicktime" : null;
      ready.push(Object.freeze({ object_index: index, message_object_id: object.id, object_type: "video", object_url: object.object_url,
        mime_type: mime, mime_source: mime ? "URL_EXTENSION" : "UNKNOWN" }));
    }
    for (const expected of context.message_object_ids) if (!seen.has(expected)) gaps.push("EXPECTED_OBJECT_ID_MISSING");
    return Object.freeze({ message_binding: "BOUND", model_echo: gaps.includes("MODEL_TYPE_MISMATCH") ? "MISMATCH" : "MATCHED",
      ready_videos: Object.freeze(ready), gaps: Object.freeze(gaps), backend_acceptance: "UNPROVEN" });
  } catch { return unverified("RESULT_ENVELOPE_INVALID"); }
}
function unverified(code: string): OwnerWan27R2vResult {
  return Object.freeze({ message_binding: "UNVERIFIED", model_echo: "UNKNOWN", ready_videos: Object.freeze([]),
    gaps: Object.freeze([code]), backend_acceptance: "UNPROVEN" });
}
function emptyCandidates(status: OwnerWan27R2vResultCandidates["status"], pageStatus: OwnerWan27R2vResultCandidates["history_page_status"],
  calls: number, gap: string): OwnerWan27R2vResultCandidates {
  return Object.freeze({ status, owner_ack_status: "MISSING", history_binding_status: "UNVERIFIED", history_page_status: pageStatus,
    history_get_calls: calls, total_count: null, total_pages: null, provider_chat_id: null, owner_echo_message_id: null,
    contexts: Object.freeze([]), gaps: Object.freeze([gap]), backend_acceptance: "UNPROVEN" });
}
function exact(value: unknown, required: readonly string[]): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== required.length ||
        keys.some((key) => typeof key !== "string" || !required.includes(key) || !descriptors[key]!.enumerable || !("value" in descriptors[key]!))) fail("INVALID_REQUEST");
    const result = Object.create(null) as Record<string, any>;
    for (const key of required) result[key] = descriptors[key]!.value;
    return result;
  } catch { return fail("INVALID_REQUEST"); }
}
function isSafeId(value: unknown): value is string { return typeof value === "string" && ID.test(value); }
function translate(error: unknown, fallback: OwnerWan27R2vNativeErrorCode): OwnerWan27R2vNativeError {
  if (error instanceof OwnerWan27R2vNativeError) return error;
  if (error instanceof OwnerWan27R2vOneShotPolicyError) {
    return new OwnerWan27R2vNativeError(error.code === "PRINCIPAL_MISMATCH" ? "PRINCIPAL_NOT_LINKED" : "CANDIDATE_INVALID");
  }
  if (error instanceof OwnerWan27R2vRequestPreparerError) {
    if (error.code === "PRINCIPAL_NOT_LINKED") return new OwnerWan27R2vNativeError("PRINCIPAL_NOT_LINKED");
    if (error.code === "REQUEST_ABORTED") return new OwnerWan27R2vNativeError("REQUEST_ABORTED");
  }
  if (error instanceof OwnerWan27R2vReferenceServiceError) {
    if (error.code === "PRINCIPAL_NOT_LINKED") return new OwnerWan27R2vNativeError("PRINCIPAL_NOT_LINKED");
    if (error.code === "REQUEST_ABORTED") return new OwnerWan27R2vNativeError("REQUEST_ABORTED");
  }
  if (error instanceof OwnerReferencePrincipalError) return new OwnerWan27R2vNativeError("PRINCIPAL_NOT_LINKED");
  return new OwnerWan27R2vNativeError(fallback);
}
function cryptoRandomUuid(): string { return randomUUID(); }
function fail(code: OwnerWan27R2vNativeErrorCode): never { throw new OwnerWan27R2vNativeError(code); }

async function consume(input: unknown, packet: unknown, method: "create" | "start" | "list" | "get") {
  try {
    const native = await import("./chat-http-client.js");
    return native.consumeOwnerWan27R2vNativeInvocation(input, packet, method);
  } catch { fail("INVALID_REQUEST"); }
}
