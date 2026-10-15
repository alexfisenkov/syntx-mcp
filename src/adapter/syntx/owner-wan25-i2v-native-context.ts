import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../../auth/types.js";
import { PerUserLinkService } from "../../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../../domain/generation-principal.js";
import { schemaHash } from "../../domain/generation-contract.js";
import { consumeOwnerWan25I2vNativeInvocation } from "./chat-http-client.js";
import type { SyntxChatHttpClient, MediaGenerationReceipt } from "./chat-http-client.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";
import {
  isOwnerWan25I2vImageUploadContext, readOwnerWan25I2vUploadReferenceForClient,
  type OwnerWan25I2vImageUploadContext
} from "./wan25-i2v-upload-context.js";
import {
  isOwnerWan25I2vPreparedCandidate, isOwnerWan25I2vRequestPreparer,
  readOwnerWan25I2vNativeBindingForClient,
  type OwnerWan25I2vPreparedCandidate, type OwnerWan25I2vPreparedCandidateBinding,
  type OwnerWan25I2vPreparedRequest, type OwnerWan25I2vRequestPreparer
} from "../../application/owner-wan25-i2v-request-preparer.js";
import {
  consumeOwnerWan25I2vOneShotPermit, revalidateOwnerWan25I2vOneShotPermit,
  OwnerWan25I2vOneShotPolicyError, type OwnerWan25I2vOneShotPermit
} from "../../application/owner-wan25-i2v-one-shot-policy.js";
import { bindOwnerWan25I2vHistory, type OwnerWan25I2vHistoryGapCode, type OwnerWan25I2vHistoryWitness } from "./owner-wan25-i2v-history.js";
import { decodeOwnerWan25I2vVideoResult, type OwnerWan25I2vVideoResult,
  type OwnerWan25I2vVideoResultContext as CodecResultContext } from "./owner-wan25-i2v-video-result.js";
import { projectOwnerWanI2vHistoryPageEvidence, projectOwnerWanI2vResultEnvelopeEvidence } from "./wan-i2v-wire-evidence.js";

const MODEL_ID = "wan_25_i2v_preview" as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const PAGE_SIZE = 10, PAGE_LIMIT = 7, MAX_CONTEXTS = 128;
const NATIVE_LINK_GET_STATUS = PerUserLinkService.prototype.getStatus;
const chats = new WeakMap<object, Map<string, NativeState>>();
const operations = new WeakMap<object, NativeState>();
const resultContexts = new WeakMap<object, ResultState>();
const reservations = new WeakSet<object>();
const createClaims = new WeakSet<object>();
const pendingCreates = new WeakMap<object, number>();
const unknownCreateReservations = new WeakMap<object, number>();
const pendingStarts = new WeakSet<object>();

export type OwnerWan25I2vNativeMethod = "create" | "start" | "list" | "get";
export interface OwnerWan25I2vNativeOperationInput {
  readonly preparer: OwnerWan25I2vRequestPreparer;
  readonly candidate: OwnerWan25I2vPreparedCandidate;
  readonly permit: OwnerWan25I2vOneShotPermit;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly linkService: PerUserLinkService;
  readonly binding: AuthBinding;
}
export interface OwnerWan25I2vChatContext {
  readonly status: "created";
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly model_id: typeof MODEL_ID;
  readonly profile_schema_hash: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly expires_at: number;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}
export interface OwnerWan25I2vNativeChatOperationInput extends OwnerWan25I2vNativeOperationInput {
  readonly chat: OwnerWan25I2vChatContext;
}
export type OwnerWan25I2vResultContext = Omit<CodecResultContext, "model_id"> & Readonly<{
  model_id: typeof MODEL_ID;
  attempt_id: string;
  profile_schema_hash: string;
  intent_fingerprint: string;
  owner_echo_message_id: string;
}>;
export interface OwnerWan25I2vNativeResultOperationInput extends OwnerWan25I2vNativeOperationInput {
  readonly context: OwnerWan25I2vResultContext;
}
export type OwnerWan25I2vNativeGapCode = OwnerWan25I2vHistoryGapCode | "HISTORY_UNAVAILABLE" | "RESULT_CONTEXT_MISMATCH";
export type OwnerWan25I2vResultCandidates = Omit<OwnerWan25I2vHistoryWitness, "gaps"> & Readonly<{
  history_get_calls: number;
  total_count: number | null;
  total_pages: number | null;
  gaps: readonly OwnerWan25I2vNativeGapCode[];
  contexts: readonly OwnerWan25I2vResultContext[];
}>;
export type OwnerWan25I2vNativeErrorCode =
  | "INVALID_REQUEST" | "CANDIDATE_INVALID" | "PRINCIPAL_NOT_LINKED" | "CHAT_CREATE_FAILED" | "CHAT_CONTEXT_INVALID"
  | "CHAT_ALREADY_CREATED" | "CHAT_NOT_DISPATCHED" | "CHAT_DISPATCH_ALREADY_STARTED" | "OUTCOME_UNKNOWN"
  | "HISTORY_UNAVAILABLE" | "RESULT_CONTEXT_INVALID" | "RESULT_GET_UNAVAILABLE" | "REQUEST_ABORTED" | "CAPACITY_EXCEEDED";
export class OwnerWan25I2vNativeError extends Error {
  constructor(readonly code: OwnerWan25I2vNativeErrorCode) {
    super("The owner WAN 2.5 I2V preview native operation could not be completed safely.");
    this.name = "OwnerWan25I2vNativeError";
  }
}

type NativeInput = Readonly<OwnerWan25I2vNativeOperationInput & {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly binding: Readonly<AuthBinding>;
}>;
interface NativeState {
  readonly client: SyntxChatHttpClient;
  readonly input: NativeInput;
  readonly chat: OwnerWan25I2vChatContext;
  readonly request: OwnerWan25I2vPreparedRequest;
  readonly imageContext: OwnerWan25I2vImageUploadContext;
  phase: "AVAILABLE" | "OUTCOME_UNKNOWN" | "ACKNOWLEDGED";
  ownerEcho?: string;
  readonly contexts: Map<string, OwnerWan25I2vResultContext>;
}
interface ResultState { readonly client: SyntxChatHttpClient; readonly state: NativeState; readonly context: OwnerWan25I2vResultContext }
interface CapturedCandidate {
  readonly binding: Readonly<OwnerWan25I2vPreparedCandidateBinding>;
  readonly request: OwnerWan25I2vPreparedRequest;
  readonly imageContext: OwnerWan25I2vImageUploadContext;
}

export async function createOwnerWan25I2vChat(input: unknown, packet: unknown, signal?: AbortSignal): Promise<OwnerWan25I2vChatContext> {
  const { client, callback } = consume(input, packet, "create");
  const create = callback as (title: string, signal?: AbortSignal) => Promise<{ chat_uuid: string }>;
  const fields = readOperation(input), reservation = fields.candidate as object;
  validateSignal(signal);
  if (reservations.has(reservation) || createClaims.has(reservation)) fail("CHAT_ALREADY_CREATED");
  let perClient = chats.get(client);
  if (!perClient) { perClient = new Map<string, NativeState>(); chats.set(client, perClient); }
  const pending = pendingCreates.get(client) ?? 0, unknown = unknownCreateReservations.get(client) ?? 0;
  if (perClient.size + pending + unknown >= MAX_CONTEXTS) fail("CAPACITY_EXCEEDED");
  const captured = captureCandidate(client, fields);
  reservations.add(reservation); pendingCreates.set(client, pending + 1);
  let createAttempted = false, contextStored = false;
  try {
    await assertCurrent(fields, signal); await validateCandidate(fields, signal); await revalidatePermit(fields);
    createAttempted = true; createClaims.add(reservation);
    const receipt = await create(`owner-wan25-i2v-${randomUUID()}`, signal);
    if (signal?.aborted || !isSafeId(receipt?.chat_uuid) || perClient.has(receipt.chat_uuid)) fail("CHAT_CREATE_FAILED");
    await assertCurrent(fields, signal); await validateCandidate(fields, signal); await revalidatePermit(fields);
    const binding = fields.preparer.inspectCandidate(fields.candidate);
    if (!binding || binding.model_id !== MODEL_ID || captured.binding.request_fingerprint !== binding.request_fingerprint) fail("CANDIDATE_INVALID");
    const chat: OwnerWan25I2vChatContext = Object.freeze({ status: "created", chat_uuid: receipt.chat_uuid,
      attempt_id: fields.attemptId, model_id: MODEL_ID, profile_schema_hash: binding.profile_schema_hash,
      request_fingerprint: binding.request_fingerprint, intent_fingerprint: binding.intent_fingerprint,
      expires_at: binding.expires_at, dispatch_allowed: false, backend_acceptance: "UNPROVEN" });
    const state: NativeState = { client, input: fields, chat, request: captured.request, imageContext: captured.imageContext,
      phase: "AVAILABLE", contexts: new Map() };
    perClient.set(chat.chat_uuid, state); operations.set(chat, state); contextStored = true;
    return chat;
  } catch (error) {
    if (createAttempted && !contextStored) {
      unknownCreateReservations.set(client, (unknownCreateReservations.get(client) ?? 0) + 1); fail("OUTCOME_UNKNOWN");
    }
    throw translate(error, "CHAT_CREATE_FAILED");
  } finally {
    reservations.delete(reservation); const left = (pendingCreates.get(client) ?? 1) - 1;
    if (left > 0) pendingCreates.set(client, left); else pendingCreates.delete(client);
  }
}

export async function startOwnerWan25I2vWithOwnedCandidate(input: unknown, packet: unknown,
  signal?: AbortSignal): Promise<MediaGenerationReceipt> {
  const { client, callback } = consume(input, packet, "start");
  const start = callback as (chatUuid: string, body: Record<string, unknown>, signal?: AbortSignal) => Promise<MediaGenerationReceipt>;
  const fields = readOperation(input, "chat"), state = stateFor(client, fields.chat!);
  if (!sameOperation(state.input, fields) || state.phase !== "AVAILABLE") fail("CHAT_CONTEXT_INVALID");
  if (pendingStarts.has(state.chat)) fail("CHAT_DISPATCH_ALREADY_STARTED");
  validateSignal(signal); if (signal?.aborted) fail("REQUEST_ABORTED");
  pendingStarts.add(state.chat); let dispatched = false;
  try {
    await assertCurrent(fields, signal); await validateCandidate(fields, signal); await revalidatePermit(fields);
    const current = captureCandidate(client, fields);
    if (current.binding.request_fingerprint !== state.chat.request_fingerprint || schemaHash(current.request) !== schemaHash(state.request) ||
        current.imageContext !== state.imageContext) fail("CANDIDATE_INVALID");
    await assertCurrent(fields, signal); await revalidatePermit(fields);
    const consumed = consumeOwnerWan25I2vOneShotPermit({ permit: fields.permit, preparer: fields.preparer,
      candidate: fields.candidate, principal: fields.principal, attemptId: fields.attemptId });
    if (consumed.request_fingerprint !== state.chat.request_fingerprint || schemaHash(consumed.request) !== schemaHash(state.request)) fail("CANDIDATE_INVALID");
    const body = { chat_id: state.chat.chat_uuid, prompt: consumed.request.prompt,
      settings: { ...consumed.request.settings, file_urls: consumed.request.settings.file_urls.map(({ type, url }) => ({ type, url })) } };
    dispatched = true; state.phase = "OUTCOME_UNKNOWN";
    const ack = await start(state.chat.chat_uuid, body, signal);
    if (signal?.aborted || ack.chat_uuid !== state.chat.chat_uuid || !isSafeId(ack.message_id)) fail("OUTCOME_UNKNOWN");
    state.ownerEcho = ack.message_id; state.phase = "ACKNOWLEDGED"; return ack;
  } catch (error) {
    if (dispatched || state.phase !== "AVAILABLE") fail("OUTCOME_UNKNOWN");
    throw translate(error, "CANDIDATE_INVALID");
  } finally { pendingStarts.delete(state.chat); }
}

export async function listOwnedWan25I2vCandidates(input: unknown, packet: unknown,
  signal?: AbortSignal): Promise<OwnerWan25I2vResultCandidates> {
  const { client, callback } = consume(input, packet, "list");
  const getPage = callback as (chatUuid: string, page: number, pageSize: number, signal?: AbortSignal) => Promise<unknown>;
  const fields = readOperation(input, "chat"), state = stateFor(client, fields.chat!);
  if (!sameOperation(state.input, fields)) fail("CHAT_CONTEXT_INVALID");
  if (state.phase !== "ACKNOWLEDGED" && state.phase !== "OUTCOME_UNKNOWN") fail("CHAT_NOT_DISPATCHED");
  validateSignal(signal); if (signal?.aborted) fail("REQUEST_ABORTED");
  let calls = 0, totalCount: number | null = null, totalPages: number | null = null;
  const pages: unknown[] = [];
  try {
    await assertCurrent(state.input, signal);
    const first = await readPage(getPage, state, 1, signal); calls += 1; pages.push(first);
    const totals = readPagination(first);
    if (!totals) return emptyCandidates("UNVERIFIED", "MISSING", "INCOMPLETE", calls, "HISTORY_PAGE_INVALID");
    totalCount = totals.total_count; totalPages = totals.total_pages;
    for (let page = 2; page <= Math.max(1, totalPages) && page <= PAGE_LIMIT; page += 1) {
      pages.push(await readPage(getPage, state, page, signal)); calls += 1;
    }
  } catch (error) {
    if (signal?.aborted) fail("REQUEST_ABORTED");
    if (error instanceof OwnerWan25I2vNativeError && error.code === "PRINCIPAL_NOT_LINKED") throw error;
    return emptyCandidates("UNVERIFIED", "MISSING", "INCOMPLETE", calls, "HISTORY_UNAVAILABLE");
  }
  const witness = bindOwnerWan25I2vHistory({ pages, expected: { chat_uuid: state.chat.chat_uuid,
    owner_echo_message_id: state.ownerEcho ?? null, prompt: state.request.prompt, model_id: MODEL_ID } });
  const contexts: OwnerWan25I2vResultContext[] = [];
  if (witness.history_page_status === "COMPLETE" && witness.owner_ack_status === "MATCHED" && witness.provider_chat_id &&
      invalidateMissingContexts(state, witness)) {
    return emptyCandidates("UNVERIFIED", "MISMATCH", "COMPLETE", calls, "RESULT_CONTEXT_MISMATCH");
  }
  if (witness.status === "COMPLETE" && witness.gaps.length === 0 && witness.owner_ack_status === "MATCHED" &&
      witness.history_binding_status === "BOUND" && witness.history_page_status === "COMPLETE" &&
      witness.owner_echo_message_id && witness.provider_chat_id) {
    state.ownerEcho = witness.owner_echo_message_id; state.phase = "ACKNOWLEDGED";
    for (const row of witness.candidate_messages) {
      const next: OwnerWan25I2vResultContext = Object.freeze({ chat_uuid: state.chat.chat_uuid, message_id: row.message_id,
        model_id: MODEL_ID, provider_chat_id: witness.provider_chat_id, message_object_ids: Object.freeze([...row.message_object_ids]),
        attempt_id: state.chat.attempt_id, profile_schema_hash: state.chat.profile_schema_hash,
        intent_fingerprint: state.chat.intent_fingerprint, owner_echo_message_id: witness.owner_echo_message_id });
      const old = state.contexts.get(next.message_id);
      if (old && !sameIdentity(old, next)) {
        invalidateContext(old); state.contexts.delete(old.message_id);
        return emptyCandidates("UNVERIFIED", "MISMATCH", "COMPLETE", calls, "RESULT_CONTEXT_MISMATCH");
      }
      if (old && schemaHash(old.message_object_ids) !== schemaHash(next.message_object_ids) &&
          !orderedSuperset(old.message_object_ids, next.message_object_ids)) {
        invalidateContext(old); state.contexts.delete(old.message_id);
        return emptyCandidates("UNVERIFIED", "MISMATCH", "COMPLETE", calls, "RESULT_CONTEXT_MISMATCH");
      }
      const context = old && schemaHash(old.message_object_ids) === schemaHash(next.message_object_ids) ? old : next;
      if (old && old !== context) invalidateContext(old);
      if (old !== context) { state.contexts.set(context.message_id, context); resultContexts.set(context, { client, state, context }); }
      contexts.push(context);
    }
  }
  return Object.freeze({ ...witness, history_get_calls: calls, total_count: totalCount, total_pages: totalPages, contexts: Object.freeze(contexts) });
}

export async function getOwnedWan25I2vResult(input: unknown, packet: unknown,
  signal?: AbortSignal): Promise<OwnerWan25I2vVideoResult> {
  const { client, callback } = consume(input, packet, "get");
  const getMessage = callback as (chatUuid: string, messageId: string, signal?: AbortSignal) => Promise<unknown>;
  const fields = readOperation(input, "context"), owned = fields.context && resultContexts.get(fields.context as object);
  if (!owned || owned.client !== client || owned.context !== fields.context || owned.state.phase !== "ACKNOWLEDGED" ||
      owned.state.ownerEcho !== owned.context.owner_echo_message_id || owned.state.contexts.get(owned.context.message_id) !== owned.context ||
      !sameOperation(owned.state.input, fields)) fail("RESULT_CONTEXT_INVALID");
  validateSignal(signal); if (signal?.aborted) fail("REQUEST_ABORTED");
  await assertCurrent(owned.state.input, signal);
  try {
    const raw = await getMessage(owned.context.chat_uuid, owned.context.message_id, signal);
    await assertCurrent(owned.state.input, signal);
    const evidence = projectOwnerWanI2vResultEnvelopeEvidence(raw);
    if (evidence.status !== "PROJECTED") fail("RESULT_GET_UNAVAILABLE");
    const result = decodeOwnerWan25I2vVideoResult(evidence.value, { chat_uuid: owned.context.chat_uuid, message_id: owned.context.message_id,
      provider_chat_id: owned.context.provider_chat_id, message_object_ids: owned.context.message_object_ids, model_id: MODEL_ID });
    if (result.message_binding !== "BOUND" || result.model_echo !== "MATCHED" || result.result_status !== "OBSERVED" ||
        result.gaps.length !== 0 || result.pending_object_indices.length !== 0 || result.backend_error_observed || !result.ready_videos.length) {
      fail("RESULT_GET_UNAVAILABLE");
    }
    return result;
  } catch (error) {
    if (signal?.aborted) fail("REQUEST_ABORTED");
    if (error instanceof OwnerWan25I2vNativeError && error.code === "PRINCIPAL_NOT_LINKED") throw error;
    if (error instanceof OwnerWan25I2vNativeError && error.code === "RESULT_GET_UNAVAILABLE") throw error;
    fail("RESULT_GET_UNAVAILABLE");
  }
}

function captureCandidate(client: SyntxChatHttpClient, fields: NativeInput): CapturedCandidate {
  if (!isOwnerWan25I2vPreparedCandidate(fields.candidate)) fail("CANDIDATE_INVALID");
  const binding = fields.preparer.inspectCandidate(fields.candidate), request = fields.preparer.getPrivateRequest(fields.candidate);
  if (!binding) fail("CANDIDATE_INVALID");
  assertCandidate(fields.candidate, binding, fields.principal, fields.attemptId, request);
  const token = fields.preparer.getNativeBindingForClient(client, fields.candidate);
  const tuple = readOwnerWan25I2vNativeBindingForClient(client, token);
  if (!tuple || tuple.length !== 1 || tuple[0]?.model_id !== MODEL_ID || !isOwnerWan25I2vImageUploadContext(tuple[0])) fail("CANDIDATE_INVALID");
  const imageContext = tuple[0], ref = readOwnerWan25I2vUploadReferenceForClient(client, imageContext);
  const expected = fields.candidate.input_references[0], file = request.settings.file_urls[0];
  if (!ref || !isSafeUploadReferenceUrl(ref.url) || !expected || expected.media_type !== "image" || !file ||
      request.settings.file_urls.length !== 1 || file.type !== "image" || file.url !== ref.url ||
      imageContext.status !== "uploaded" || imageContext.model_id !== MODEL_ID || imageContext.media_type !== "image" ||
      imageContext.mime_type !== expected.mime_type || imageContext.size !== expected.size || imageContext.sha256 !== expected.sha256 ||
      imageContext.width !== expected.width || imageContext.height !== expected.height) fail("CANDIDATE_INVALID");
  return Object.freeze({ binding, request, imageContext });
}

async function validateCandidate(fields: NativeInput, signal?: AbortSignal): Promise<Readonly<OwnerWan25I2vPreparedCandidateBinding>> {
  try { await fields.preparer.revalidateCandidate(fields.candidate, signal); } catch { fail("CANDIDATE_INVALID"); }
  const binding = fields.preparer.inspectCandidate(fields.candidate);
  if (!binding) fail("CANDIDATE_INVALID");
  assertCandidate(fields.candidate, binding, fields.principal, fields.attemptId, fields.preparer.getPrivateRequest(fields.candidate));
  return binding;
}

function assertCandidate(candidate: OwnerWan25I2vPreparedCandidate, binding: Readonly<OwnerWan25I2vPreparedCandidateBinding>,
  principal: Readonly<GenerationPrincipalRef>, attemptId: string, request: OwnerWan25I2vPreparedRequest): void {
  if (candidate.model_id !== MODEL_ID || binding.model_id !== MODEL_ID || candidate.status !== "prepared" ||
      candidate.dispatch_allowed !== false || candidate.runtime_usable !== false || candidate.backend_acceptance !== "UNPROVEN" ||
      candidate.audio_reference_count !== 0 || candidate.native_audio_status !== "UNPROVEN_NOT_ENABLED" ||
      candidate.audio_gap !== "OPTIONAL_AUDIO_UI_NOT_JOINED_TO_NATIVE_CONTEXT" || candidate.request_fingerprint !== binding.request_fingerprint ||
      candidate.request_fingerprint !== binding.wire_fingerprint || candidate.intent_fingerprint !== binding.intent_fingerprint ||
      candidate.profile_schema_hash !== binding.profile_schema_hash || candidate.expires_at !== binding.expires_at || binding.attempt_id !== attemptId ||
      !sameGenerationPrincipal(binding.principal, principal) || schemaHash(request) !== binding.wire_fingerprint ||
      request.settings.model_type !== MODEL_ID || request.settings.native_audio !== false || request.settings.shot_type !== "single" ||
      request.settings.audio_setting !== "auto" || Object.hasOwn(request.settings, "duration") ||
      !(request.settings.resolution === "480P" || request.settings.resolution === "720P" || request.settings.resolution === "1080P") ||
      !(request.settings.video_duration === 5 || request.settings.video_duration === 10)) fail("CANDIDATE_INVALID");
}

async function revalidatePermit(fields: NativeInput): Promise<void> {
  try { await revalidateOwnerWan25I2vOneShotPermit({ permit: fields.permit, preparer: fields.preparer,
    candidate: fields.candidate, principal: fields.principal, attemptId: fields.attemptId }); }
  catch { fail("CANDIDATE_INVALID"); }
}

async function assertCurrent(fields: NativeInput, signal?: AbortSignal): Promise<void> {
  validateSignal(signal); if (signal?.aborted) fail("REQUEST_ABORTED");
  if (!isLinkService(fields.linkService)) fail("PRINCIPAL_NOT_LINKED");
  try {
    const principal = await resolveOwnerReferencePrincipal({ binding: fields.binding, attemptId: fields.attemptId, linkService: fields.linkService });
    if (!sameGenerationPrincipal(principal, fields.principal) || signal?.aborted) fail(signal?.aborted ? "REQUEST_ABORTED" : "PRINCIPAL_NOT_LINKED");
  } catch (error) {
    if (error instanceof OwnerWan25I2vNativeError) throw error;
    if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
    fail("PRINCIPAL_NOT_LINKED");
  }
}

async function readPage(getPage: (chatUuid: string, page: number, size: number, signal?: AbortSignal) => Promise<unknown>,
  state: NativeState, page: number, signal?: AbortSignal): Promise<unknown> {
  await assertCurrent(state.input, signal);
  const raw = await getPage(state.chat.chat_uuid, page, PAGE_SIZE, signal);
  await assertCurrent(state.input, signal);
  const evidence = projectOwnerWanI2vHistoryPageEvidence(raw);
  return evidence.status === "PROJECTED" ? evidence.value : null;
}

function readOperation(value: unknown, extra?: "chat" | "context"): NativeInput & { readonly chat?: OwnerWan25I2vChatContext; readonly context?: OwnerWan25I2vResultContext } {
  const f = exact(value, ["preparer", "candidate", "permit", "principal", "attemptId", "linkService", "binding", ...(extra ? [extra] : [])]);
  if (!isOwnerWan25I2vRequestPreparer(f.preparer) || !f.candidate || typeof f.candidate !== "object" || types.isProxy(f.candidate) ||
      !f.permit || typeof f.permit !== "object" || types.isProxy(f.permit) || typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId)) fail("INVALID_REQUEST");
  const principal = snapshotPrincipal(f.principal as GenerationPrincipalRef, f.attemptId), binding = snapshotBinding(f.binding);
  if (!isLinkService(f.linkService)) fail("PRINCIPAL_NOT_LINKED");
  if (extra && (!f[extra] || typeof f[extra] !== "object" || types.isProxy(f[extra]))) fail("INVALID_REQUEST");
  return Object.freeze({ preparer: f.preparer, candidate: f.candidate as OwnerWan25I2vPreparedCandidate,
    permit: f.permit as OwnerWan25I2vOneShotPermit, principal, attemptId: f.attemptId,
    linkService: f.linkService as PerUserLinkService, binding, ...(extra ? { [extra]: f[extra] } : {}) }) as NativeInput &
      { readonly chat?: OwnerWan25I2vChatContext; readonly context?: OwnerWan25I2vResultContext };
}

function stateFor(client: SyntxChatHttpClient, value: unknown): NativeState {
  if (!value || typeof value !== "object" || types.isProxy(value)) fail("CHAT_CONTEXT_INVALID");
  const state = operations.get(value as object);
  if (!state || state.client !== client || state.chat !== value || chats.get(client)?.get(state.chat.chat_uuid) !== state) fail("CHAT_CONTEXT_INVALID");
  return state;
}
function sameOperation(a: NativeInput, b: NativeInput): boolean {
  return a.preparer === b.preparer && a.candidate === b.candidate && a.permit === b.permit && a.attemptId === b.attemptId &&
    a.linkService === b.linkService && sameGenerationPrincipal(a.principal, b.principal) &&
    a.binding.tenant_id === b.binding.tenant_id && a.binding.subject === b.binding.subject;
}
function sameIdentity(a: OwnerWan25I2vResultContext, b: OwnerWan25I2vResultContext): boolean {
  return a.chat_uuid === b.chat_uuid && a.message_id === b.message_id && a.provider_chat_id === b.provider_chat_id &&
    a.model_id === b.model_id && a.attempt_id === b.attempt_id && a.profile_schema_hash === b.profile_schema_hash &&
    a.intent_fingerprint === b.intent_fingerprint && a.owner_echo_message_id === b.owner_echo_message_id;
}
function orderedSuperset(oldIds: readonly string[], nextIds: readonly string[]): boolean {
  if (nextIds.length <= oldIds.length) return false;
  let offset = 0; for (const id of nextIds) if (id === oldIds[offset]) offset += 1;
  return offset === oldIds.length;
}
function invalidateContext(context: OwnerWan25I2vResultContext): void { resultContexts.delete(context); }
function invalidateMissingContexts(state: NativeState, witness: OwnerWan25I2vHistoryWitness): boolean {
  const rows = new Map(witness.candidate_messages.map((row) => [row.message_id, row.message_object_ids])); let mismatch = false;
  for (const old of state.contexts.values()) {
    const nextIds = rows.get(old.message_id);
    if (!nextIds || old.provider_chat_id !== witness.provider_chat_id || old.model_id !== MODEL_ID ||
        old.owner_echo_message_id !== witness.owner_echo_message_id || !orderedEqualOrSuperset(old.message_object_ids, nextIds)) {
      invalidateContext(old); state.contexts.delete(old.message_id); mismatch = true;
    }
  }
  return mismatch;
}
function orderedEqualOrSuperset(oldIds: readonly string[], nextIds: readonly string[]): boolean {
  return schemaHash(oldIds) === schemaHash(nextIds) || orderedSuperset(oldIds, nextIds);
}
function readPagination(raw: unknown): { total_count: number; total_pages: number } | null {
  try {
    if (!raw || typeof raw !== "object" || types.isProxy(raw)) return null;
    const pagination = Object.getOwnPropertyDescriptor(raw, "pagination")?.value;
    if (!pagination || typeof pagination !== "object" || types.isProxy(pagination)) return null;
    const count = Object.getOwnPropertyDescriptor(pagination, "total_count")?.value;
    const pages = Object.getOwnPropertyDescriptor(pagination, "total_pages")?.value;
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(pages) || pages < 0 ||
        pages !== (count === 0 ? 0 : Math.ceil(count / PAGE_SIZE))) return null;
    return { total_count: count, total_pages: pages };
  } catch { return null; }
}
function emptyCandidates(status: OwnerWan25I2vResultCandidates["status"], owner: OwnerWan25I2vHistoryWitness["owner_ack_status"],
  pageStatus: OwnerWan25I2vHistoryWitness["history_page_status"], calls: number, gap: string): OwnerWan25I2vResultCandidates {
  return Object.freeze({ status, owner_ack_status: owner, history_binding_status: "UNVERIFIED", history_page_status: pageStatus,
    provider_chat_id: null, owner_echo_message_id: null, candidate_messages: Object.freeze([]), bot_error_observed: false,
    gaps: Object.freeze([gap as OwnerWan25I2vNativeGapCode]), backend_acceptance: "UNPROVEN",
    history_get_calls: calls, total_count: null, total_pages: null, contexts: Object.freeze([]) });
}
function isLinkService(value: unknown): value is PerUserLinkService {
  try {
    const descriptor = value && Object.getOwnPropertyDescriptor(PerUserLinkService.prototype, "getStatus");
    return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === PerUserLinkService.prototype &&
      !Object.hasOwn(value as object, "getStatus") && !!descriptor && "value" in (descriptor as PropertyDescriptor) &&
      (descriptor as PropertyDescriptor).value === NATIVE_LINK_GET_STATUS && Reflect.get(value, "getStatus") === NATIVE_LINK_GET_STATUS;
  } catch { return false; }
}
function snapshotPrincipal(value: GenerationPrincipalRef, attemptId: string): Readonly<GenerationPrincipalRef> {
  let principal: Readonly<GenerationPrincipalRef>; try { principal = snapshotGenerationPrincipal(value); } catch { fail("INVALID_REQUEST"); }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_NOT_LINKED"); return principal;
}
function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const f = exact(value, ["tenant_id", "subject"]);
  if (typeof f.tenant_id !== "string" || !f.tenant_id.trim() || typeof f.subject !== "string" || !f.subject.trim()) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: f.tenant_id, subject: f.subject });
}
function validateSignal(signal?: AbortSignal): void { if (signal !== undefined && (!signal || types.isProxy(signal) || !(signal instanceof AbortSignal))) fail("INVALID_REQUEST"); }
function exact(value: unknown, keys: readonly string[]): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try { const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || own.length !== keys.length || own.some((key) => typeof key !== "string" ||
      !keys.includes(key) || !descriptors[key]!.enumerable || !("value" in descriptors[key]!))) fail("INVALID_REQUEST");
    const result = Object.create(null); for (const key of keys) result[key] = descriptors[key]!.value; return result;
  } catch { return fail("INVALID_REQUEST"); }
}
function translate(error: unknown, fallback: OwnerWan25I2vNativeErrorCode): OwnerWan25I2vNativeError {
  if (error instanceof OwnerWan25I2vNativeError) return error;
  if (error instanceof OwnerWan25I2vOneShotPolicyError) return new OwnerWan25I2vNativeError(error.code === "PRINCIPAL_MISMATCH" ? "PRINCIPAL_NOT_LINKED" : "CANDIDATE_INVALID");
  if (error instanceof OwnerReferencePrincipalError) return new OwnerWan25I2vNativeError("PRINCIPAL_NOT_LINKED");
  return new OwnerWan25I2vNativeError(fallback);
}
function fail(code: OwnerWan25I2vNativeErrorCode): never { throw new OwnerWan25I2vNativeError(code); }
function isSafeId(value: unknown): value is string { return typeof value === "string" && ID.test(value); }

function consume(input: unknown, packet: unknown, method: OwnerWan25I2vNativeMethod): Readonly<{ client: SyntxChatHttpClient; callback: Function }> {
  try { return consumeOwnerWan25I2vNativeInvocation(input, packet, method); }
  catch { fail("INVALID_REQUEST"); }
}
