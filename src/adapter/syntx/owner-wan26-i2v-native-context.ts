import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../../auth/types.js";
import { PerUserLinkService } from "../../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../../domain/generation-principal.js";
import { schemaHash } from "../../domain/generation-contract.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";
import { SyntxChatHttpClient, consumeOwnerWan26I2vNativeInvocation, type MediaGenerationReceipt } from "./chat-http-client.js";
import { readOwnerWan26I2vUploadReferenceForClient, type OwnerWan26I2vUploadContext } from "./wan26-i2v-upload-context.js";
import {
  isOwnerWan26I2vPreparedCandidate, isOwnerWan26I2vRequestPreparer,
  readOwnerWan26I2vNativeBindingForClient,
  type OwnerWan26I2vPreparedCandidate, type OwnerWan26I2vPreparedCandidateBinding,
  type OwnerWan26I2vPreparedRequest, type OwnerWan26I2vRequestPreparer
} from "../../application/owner-wan26-i2v-request-preparer.js";
import {
  consumeOwnerWan26I2vOneShotPermit as consumeOneShot, revalidateOwnerWan26I2vOneShotPermit,
  OwnerWan26I2vOneShotPolicyError, type OwnerWan26I2vOneShotPermit
} from "../../application/owner-wan26-i2v-one-shot-policy.js";
import { bindOwnerWan26I2vHistory, type OwnerWan26I2vHistoryWitness } from "./owner-wan26-i2v-history.js";
import { decodeOwnerWan26I2vVideoResult, type OwnerWan26I2vVideoResult } from "./owner-wan26-i2v-video-result.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const PAGE_SIZE = 10, PAGE_LIMIT = 7, MAX_CONTEXTS = 128;
const NATIVE_LINK_GET_STATUS = PerUserLinkService.prototype.getStatus;
const chats = new WeakMap<object, Map<string, NativeState>>();
const operations = new WeakMap<object, NativeState>();
const resultContexts = new WeakMap<object, ResultState>();
const reservedCandidates = new WeakSet<object>();
const createClaims = new WeakSet<object>();
const pendingCreates = new WeakMap<object, number>();
const unknownCreateReservations = new WeakMap<object, number>();
const pendingStarts = new WeakSet<object>();

export type OwnerWan26I2vNativeModelId = "wan_26_i2v" | "wan_26_i2v_flash";
export interface OwnerWan26I2vNativeOperationInput {
  readonly preparer: OwnerWan26I2vRequestPreparer;
  readonly candidate: OwnerWan26I2vPreparedCandidate;
  readonly permit: OwnerWan26I2vOneShotPermit;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly linkService: PerUserLinkService;
  readonly binding: AuthBinding;
}
export interface OwnerWan26I2vChatContext {
  readonly status: "created";
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly model_id: OwnerWan26I2vNativeModelId;
  readonly profile_schema_hash: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly expires_at: number;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}
export interface OwnerWan26I2vNativeChatOperationInput extends OwnerWan26I2vNativeOperationInput {
  readonly chat: OwnerWan26I2vChatContext;
}
export interface OwnerWan26I2vResultContext {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly string[];
  readonly model_id: OwnerWan26I2vNativeModelId;
  readonly attempt_id: string;
  readonly profile_schema_hash: string;
  readonly intent_fingerprint: string;
  readonly owner_echo_message_id: string;
}
export interface OwnerWan26I2vNativeResultOperationInput extends OwnerWan26I2vNativeOperationInput {
  readonly context: OwnerWan26I2vResultContext;
}
export type OwnerWan26I2vResultCandidates = Omit<OwnerWan26I2vHistoryWitness, "gaps"> & {
  readonly history_get_calls: number;
  readonly total_count: number | null;
  readonly total_pages: number | null;
  readonly contexts: readonly OwnerWan26I2vResultContext[];
  readonly gaps: readonly (OwnerWan26I2vHistoryWitness["gaps"][number] | "RESULT_CONTEXT_MISMATCH")[];
};
export type OwnerWan26I2vNativeErrorCode =
  | "INVALID_REQUEST" | "CANDIDATE_INVALID" | "PRINCIPAL_NOT_LINKED" | "CHAT_CREATE_FAILED"
  | "CHAT_CONTEXT_INVALID" | "CHAT_ALREADY_CREATED" | "CHAT_NOT_DISPATCHED" | "CHAT_DISPATCH_ALREADY_STARTED"
  | "OUTCOME_UNKNOWN" | "HISTORY_UNAVAILABLE" | "RESULT_CONTEXT_INVALID" | "RESULT_GET_UNAVAILABLE"
  | "REQUEST_ABORTED" | "CAPACITY_EXCEEDED";
export class OwnerWan26I2vNativeError extends Error {
  constructor(readonly code: OwnerWan26I2vNativeErrorCode) {
    super("The owner WAN 2.6 I2V native operation could not be completed safely.");
    this.name = "OwnerWan26I2vNativeError";
  }
}

type NativeInput = Readonly<OwnerWan26I2vNativeOperationInput & {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly binding: Readonly<AuthBinding>;
}>;
interface NativeState {
  readonly client: SyntxChatHttpClient;
  readonly input: NativeInput;
  readonly chat: OwnerWan26I2vChatContext;
  readonly request: OwnerWan26I2vPreparedRequest;
  readonly references: readonly OwnerWan26I2vUploadContext[];
  phase: "AVAILABLE" | "OUTCOME_UNKNOWN" | "ACKNOWLEDGED";
  ownerEcho?: string;
  readonly contexts: Map<string, OwnerWan26I2vResultContext>;
}
interface ResultState { readonly client: SyntxChatHttpClient; readonly state: NativeState; readonly context: OwnerWan26I2vResultContext }

export async function createOwnerWan26I2vChat(input: unknown, packet: unknown, signal?: AbortSignal): Promise<OwnerWan26I2vChatContext> {
  const { client, callback } = consume(input, packet, "create");
  const create = callback as (title: string, signal?: AbortSignal) => Promise<{ chat_uuid: string }>;
  const fields = readOperation(input), reservation = fields.candidate as object;
  validateSignal(signal);
  if (!isExactNativeClient(client)) fail("CANDIDATE_INVALID");
  if (reservedCandidates.has(reservation) || createClaims.has(reservation)) fail("CHAT_ALREADY_CREATED");
  let perClient = chats.get(client);
  if (!perClient) { perClient = new Map<string, NativeState>(); chats.set(client, perClient); }
  const pending = pendingCreates.get(client) ?? 0;
  const unknown = unknownCreateReservations.get(client) ?? 0;
  if (perClient.size + pending + unknown >= MAX_CONTEXTS) fail("CAPACITY_EXCEEDED");
  const captured = captureCandidate(client, fields);
  reservedCandidates.add(reservation); pendingCreates.set(client, pending + 1);
  let createAttempted = false, contextStored = false;
  try {
    await assertCurrent(fields, signal);
    await validateCandidate(fields, signal);
    await revalidatePermit(fields);
    createAttempted = true; createClaims.add(reservation);
    const receipt = await create(`owner-wan26-i2v-${randomUUID()}`, signal);
    if (signal?.aborted || !isSafeId(receipt?.chat_uuid) || perClient.has(receipt.chat_uuid)) fail("CHAT_CREATE_FAILED");
    await assertCurrent(fields, signal);
    await validateCandidate(fields, signal);
    await revalidatePermit(fields);
    const binding = fields.preparer.inspectCandidate(fields.candidate);
    if (!binding || captured.requestFingerprint !== binding.request_fingerprint) fail("CANDIDATE_INVALID");
    const chat: OwnerWan26I2vChatContext = Object.freeze({ status: "created", chat_uuid: receipt.chat_uuid,
      attempt_id: fields.attemptId, model_id: captured.modelId, profile_schema_hash: binding.profile_schema_hash,
      request_fingerprint: binding.request_fingerprint, intent_fingerprint: binding.intent_fingerprint,
      expires_at: binding.expires_at, dispatch_allowed: false, backend_acceptance: "UNPROVEN" });
    const state: NativeState = { client, input: fields, chat, request: captured.request,
      references: captured.references, phase: "AVAILABLE", contexts: new Map() };
    perClient.set(chat.chat_uuid, state); operations.set(chat, state); contextStored = true;
    return chat;
  } catch (error) {
    if (createAttempted && !contextStored) {
      unknownCreateReservations.set(client, (unknownCreateReservations.get(client) ?? 0) + 1);
      fail("OUTCOME_UNKNOWN");
    }
    throw translate(error, "CHAT_CREATE_FAILED");
  }
  finally {
    reservedCandidates.delete(reservation);
    const left = (pendingCreates.get(client) ?? 1) - 1;
    if (left > 0) pendingCreates.set(client, left); else pendingCreates.delete(client);
  }
}

export async function startOwnerWan26I2vWithOwnedCandidate(input: unknown, packet: unknown,
  signal?: AbortSignal): Promise<MediaGenerationReceipt> {
  const { client, callback } = consume(input, packet, "start");
  const start = callback as (chatUuid: string, body: Record<string, unknown>, signal?: AbortSignal) => Promise<MediaGenerationReceipt>;
  const fields = readOperation(input, "chat"), state = stateFor(client, fields.chat!);
  if (!sameOperation(state.input, fields) || state.phase !== "AVAILABLE") fail("CHAT_CONTEXT_INVALID");
  if (pendingStarts.has(state.chat)) fail("CHAT_DISPATCH_ALREADY_STARTED");
  validateSignal(signal); if (signal?.aborted) fail("REQUEST_ABORTED");
  pendingStarts.add(state.chat); let dispatched = false;
  try {
    await assertCurrent(fields, signal);
    await validateCandidate(fields, signal);
    await revalidatePermit(fields);
    const current = captureCandidate(client, fields);
    if (current.requestFingerprint !== state.chat.request_fingerprint || schemaHash(current.request) !== schemaHash(state.request) ||
        schemaHash(current.references) !== schemaHash(state.references)) fail("CANDIDATE_INVALID");
    await assertCurrent(fields, signal);
    await revalidatePermit(fields);
    const consumed = consumeOwnerWan26I2vOneShotPermit(fields);
    if (consumed.request_fingerprint !== state.chat.request_fingerprint || schemaHash(consumed.request) !== schemaHash(state.request)) fail("CANDIDATE_INVALID");
    const body = { chat_id: state.chat.chat_uuid, prompt: consumed.request.prompt,
      settings: { ...consumed.request.settings, file_urls: consumed.request.settings.file_urls.map((file) => ({ type: file.type, url: file.url })) } };
    dispatched = true; state.phase = "OUTCOME_UNKNOWN";
    const ack = await start(state.chat.chat_uuid, body, signal);
    if (signal?.aborted || ack.chat_uuid !== state.chat.chat_uuid || !isSafeId(ack.message_id)) fail("OUTCOME_UNKNOWN");
    state.ownerEcho = ack.message_id; state.phase = "ACKNOWLEDGED";
    return ack;
  } catch (error) {
    if (dispatched || state.phase !== "AVAILABLE") fail("OUTCOME_UNKNOWN");
    throw translate(error, "CANDIDATE_INVALID");
  } finally { pendingStarts.delete(state.chat); }
}

export async function listOwnedWan26I2vCandidates(input: unknown, packet: unknown,
  signal?: AbortSignal): Promise<OwnerWan26I2vResultCandidates> {
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
    const needed = Math.max(1, totalPages);
    for (let page = 2; page <= needed && page <= PAGE_LIMIT; page += 1) {
      pages.push(await readPage(getPage, state, page, signal)); calls += 1;
    }
  } catch (error) {
    if (signal?.aborted) fail("REQUEST_ABORTED");
    if (error instanceof OwnerWan26I2vNativeError && error.code === "PRINCIPAL_NOT_LINKED") throw error;
    return emptyCandidates("UNVERIFIED", "MISSING", "INCOMPLETE", calls, "HISTORY_UNAVAILABLE");
  }
  const witness = bindOwnerWan26I2vHistory({ pages, expected: { chat_uuid: state.chat.chat_uuid,
    owner_echo_message_id: state.ownerEcho ?? null, prompt: state.request.prompt, model_id: state.chat.model_id } });
  const contexts: OwnerWan26I2vResultContext[] = [];
  if (witness.history_page_status === "COMPLETE" && witness.owner_ack_status === "MATCHED" && witness.provider_chat_id &&
      invalidateMissingContexts(state, witness)) {
    return emptyCandidates("UNVERIFIED", "MISMATCH", "COMPLETE", calls, "RESULT_CONTEXT_MISMATCH");
  }
  if (witness.status === "COMPLETE" && witness.gaps.length === 0 && witness.owner_ack_status === "MATCHED" &&
      witness.history_binding_status === "BOUND" && witness.history_page_status === "COMPLETE" &&
      witness.owner_echo_message_id && witness.provider_chat_id) {
    state.ownerEcho = witness.owner_echo_message_id; state.phase = "ACKNOWLEDGED";
    for (const row of witness.candidate_messages) {
      const next: OwnerWan26I2vResultContext = Object.freeze({ chat_uuid: state.chat.chat_uuid, message_id: row.message_id,
        model_id: state.chat.model_id, provider_chat_id: witness.provider_chat_id,
        message_object_ids: Object.freeze([...row.message_object_ids]), attempt_id: state.chat.attempt_id,
        profile_schema_hash: state.chat.profile_schema_hash, intent_fingerprint: state.chat.intent_fingerprint,
        owner_echo_message_id: witness.owner_echo_message_id });
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
  return Object.freeze({ ...witness, history_get_calls: calls, total_count: totalCount, total_pages: totalPages,
    contexts: Object.freeze(contexts) });
}

export async function getOwnedWan26I2vResult(input: unknown, packet: unknown,
  signal?: AbortSignal): Promise<OwnerWan26I2vVideoResult> {
  const { client, callback } = consume(input, packet, "get");
  const getMessage = callback as (chatUuid: string, messageId: string, signal?: AbortSignal) => Promise<unknown>;
  const fields = readOperation(input, "context"), owned = fields.context && resultContexts.get(fields.context as object);
  if (!owned || owned.client !== client || owned.context !== fields.context || owned.state.client !== client ||
      owned.state.phase !== "ACKNOWLEDGED" || owned.state.ownerEcho !== owned.context.owner_echo_message_id ||
      owned.state.contexts.get(owned.context.message_id) !== owned.context || !sameOperation(owned.state.input, fields)) fail("RESULT_CONTEXT_INVALID");
  validateSignal(signal); if (signal?.aborted) fail("REQUEST_ABORTED");
  await assertCurrent(owned.state.input, signal);
  try {
    const raw = await getMessage(owned.context.chat_uuid, owned.context.message_id, signal);
    await assertCurrent(owned.state.input, signal);
    return decodeOwnerWan26I2vVideoResult(raw, { chat_uuid: owned.context.chat_uuid, message_id: owned.context.message_id,
      model_id: owned.context.model_id, provider_chat_id: owned.context.provider_chat_id,
      message_object_ids: owned.context.message_object_ids });
  } catch (error) {
    if (signal?.aborted) fail("REQUEST_ABORTED");
    if (error instanceof OwnerWan26I2vNativeError && error.code === "PRINCIPAL_NOT_LINKED") throw error;
    fail("RESULT_GET_UNAVAILABLE");
  }
}

function readOperation(value: unknown, extra?: "chat" | "context"): NativeInput & { readonly chat?: OwnerWan26I2vChatContext; readonly context?: OwnerWan26I2vResultContext } {
  const f = exact(value, ["preparer", "candidate", "permit", "principal", "attemptId", "linkService", "binding", ...(extra ? [extra] : [])]);
  if (!isOwnerWan26I2vRequestPreparer(f.preparer) || !f.candidate || typeof f.candidate !== "object" || types.isProxy(f.candidate) ||
      !f.permit || typeof f.permit !== "object" || types.isProxy(f.permit) || typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId)) fail("INVALID_REQUEST");
  const principal = snapshotPrincipal(f.principal as GenerationPrincipalRef, f.attemptId), binding = snapshotBinding(f.binding);
  if (!isLinkService(f.linkService)) fail("PRINCIPAL_NOT_LINKED");
  if (extra && (!f[extra] || typeof f[extra] !== "object" || types.isProxy(f[extra]))) fail("INVALID_REQUEST");
  return Object.freeze({ preparer: f.preparer, candidate: f.candidate as OwnerWan26I2vPreparedCandidate,
    permit: f.permit as OwnerWan26I2vOneShotPermit, principal, attemptId: f.attemptId,
    linkService: f.linkService as PerUserLinkService, binding, ...(extra ? { [extra]: f[extra] } : {}) }) as NativeInput &
      { readonly chat?: OwnerWan26I2vChatContext; readonly context?: OwnerWan26I2vResultContext };
}

function captureCandidate(client: SyntxChatHttpClient, fields: NativeInput): {
  readonly modelId: OwnerWan26I2vNativeModelId; readonly request: OwnerWan26I2vPreparedRequest;
  readonly references: readonly OwnerWan26I2vUploadContext[]; readonly requestFingerprint: string;
} {
  if (!isOwnerWan26I2vPreparedCandidate(fields.candidate)) fail("CANDIDATE_INVALID");
  const binding = fields.preparer.inspectCandidate(fields.candidate), request = fields.preparer.getPrivateRequest(fields.candidate);
  if (!binding) fail("CANDIDATE_INVALID");
  assertCandidate(fields.candidate, binding, fields.principal, fields.attemptId, request);
  const token = fields.preparer.getNativeBindingForClient(client, fields.candidate);
  const references = readOwnerWan26I2vNativeBindingForClient(client, token);
  if (!references || references.length !== fields.candidate.input_references.length || references.length < 1 || references.length > 2) fail("CANDIDATE_INVALID");
  const files: { type: "image" | "audio"; url: string }[] = [];
  for (let i = 0; i < references.length; i += 1) {
    const context = references[i]!, expected = fields.candidate.input_references[i]!;
    const ref = readOwnerWan26I2vUploadReferenceForClient(client, context);
    if (!ref || !isSafeUploadReferenceUrl(ref.url) || context.status !== "uploaded" || context.model_id !== fields.candidate.model_id ||
        context.media_type !== expected.media_type || context.mime_type !== expected.mime_type || context.size !== expected.size || context.sha256 !== expected.sha256 ||
        (expected.media_type === "image" && (context.media_type !== "image" || context.width !== expected.width || context.height !== expected.height)) ||
        (expected.media_type === "audio" && (context.media_type !== "audio" || context.measured_duration_seconds !== expected.duration_seconds))) fail("CANDIDATE_INVALID");
    files.push({ type: context.media_type, url: ref.url });
  }
  if (references[0]?.media_type !== "image" || (references.length === 2 && references[1]?.media_type !== "audio") ||
      schemaHash(files) !== schemaHash(request.settings.file_urls)) fail("CANDIDATE_INVALID");
  return Object.freeze({ modelId: binding.model_id, request, references: Object.freeze([...references]), requestFingerprint: binding.request_fingerprint });
}

async function validateCandidate(fields: NativeInput, signal?: AbortSignal): Promise<Readonly<OwnerWan26I2vPreparedCandidateBinding>> {
  try { await fields.preparer.revalidateCandidate(fields.candidate, signal); } catch { fail("CANDIDATE_INVALID"); }
  const binding = fields.preparer.inspectCandidate(fields.candidate);
  if (!binding) fail("CANDIDATE_INVALID");
  assertCandidate(fields.candidate, binding, fields.principal, fields.attemptId, fields.preparer.getPrivateRequest(fields.candidate));
  return binding;
}
function assertCandidate(candidate: OwnerWan26I2vPreparedCandidate, binding: Readonly<OwnerWan26I2vPreparedCandidateBinding>,
  principal: Readonly<GenerationPrincipalRef>, attemptId: string, request: OwnerWan26I2vPreparedRequest): void {
  if (candidate.model_id !== binding.model_id || !["wan_26_i2v", "wan_26_i2v_flash"].includes(candidate.model_id) ||
      candidate.status !== "prepared" || candidate.dispatch_allowed !== false || candidate.runtime_usable !== false ||
      candidate.backend_acceptance !== "UNPROVEN" || candidate.request_fingerprint !== binding.request_fingerprint ||
      candidate.request_fingerprint !== binding.wire_fingerprint || candidate.intent_fingerprint !== binding.intent_fingerprint ||
      candidate.profile_schema_hash !== binding.profile_schema_hash || candidate.expires_at !== binding.expires_at ||
      binding.attempt_id !== attemptId || !sameGenerationPrincipal(binding.principal, principal) ||
      schemaHash(request) !== binding.wire_fingerprint || request.settings.model_type !== binding.model_id ||
      request.settings.shot_type !== "single" || request.settings.audio_setting !== "auto" || Object.hasOwn(request.settings, "duration")) fail("CANDIDATE_INVALID");
}

async function revalidatePermit(fields: NativeInput): Promise<void> {
  try { await revalidateOwnerWan26I2vOneShotPermit({ permit: fields.permit, preparer: fields.preparer,
    candidate: fields.candidate, principal: fields.principal, attemptId: fields.attemptId }); }
  catch { fail("CANDIDATE_INVALID"); }
}
function consumeOwnerWan26I2vOneShotPermit(fields: NativeInput) {
  try { return consumeOneShot({ permit: fields.permit, preparer: fields.preparer,
    candidate: fields.candidate, principal: fields.principal, attemptId: fields.attemptId }); }
  catch { fail("CANDIDATE_INVALID"); }
}

async function readPage(getPage: (chatUuid: string, page: number, pageSize: number, signal?: AbortSignal) => Promise<unknown>,
  state: NativeState, page: number, signal?: AbortSignal): Promise<unknown> {
  await assertCurrent(state.input, signal);
  const raw = await getPage(state.chat.chat_uuid, page, PAGE_SIZE, signal);
  await assertCurrent(state.input, signal);
  return raw;
}
async function assertCurrent(fields: NativeInput, signal?: AbortSignal): Promise<void> {
  validateSignal(signal); if (signal?.aborted) fail("REQUEST_ABORTED");
  if (!isLinkService(fields.linkService)) fail("PRINCIPAL_NOT_LINKED");
  try {
    const principal = await resolveOwnerReferencePrincipal({ binding: fields.binding, attemptId: fields.attemptId, linkService: fields.linkService });
    if (!sameGenerationPrincipal(principal, fields.principal) || signal?.aborted) fail(signal?.aborted ? "REQUEST_ABORTED" : "PRINCIPAL_NOT_LINKED");
  } catch (error) {
    if (error instanceof OwnerWan26I2vNativeError) throw error;
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
function sameOperation(a: NativeInput, b: NativeInput): boolean {
  return a.preparer === b.preparer && a.candidate === b.candidate && a.permit === b.permit && a.attemptId === b.attemptId &&
    a.linkService === b.linkService && sameGenerationPrincipal(a.principal, b.principal) &&
    a.binding.tenant_id === b.binding.tenant_id && a.binding.subject === b.binding.subject;
}
function sameIdentity(a: OwnerWan26I2vResultContext, b: OwnerWan26I2vResultContext): boolean {
  return a.chat_uuid === b.chat_uuid && a.message_id === b.message_id && a.provider_chat_id === b.provider_chat_id &&
    a.model_id === b.model_id && a.attempt_id === b.attempt_id && a.profile_schema_hash === b.profile_schema_hash &&
    a.intent_fingerprint === b.intent_fingerprint && a.owner_echo_message_id === b.owner_echo_message_id;
}
function orderedSuperset(oldIds: readonly string[], nextIds: readonly string[]): boolean {
  if (nextIds.length <= oldIds.length) return false;
  let offset = 0; for (const id of nextIds) if (id === oldIds[offset]) offset += 1;
  return offset === oldIds.length;
}
function invalidateContext(context: OwnerWan26I2vResultContext): void { resultContexts.delete(context); }
function invalidateMissingContexts(state: NativeState, witness: OwnerWan26I2vHistoryWitness): boolean {
  const rows = new Map(witness.candidate_messages.map((row) => [row.message_id, row.message_object_ids]));
  let mismatch = false;
  for (const old of state.contexts.values()) {
    const nextIds = rows.get(old.message_id);
    if (!nextIds || old.provider_chat_id !== witness.provider_chat_id || old.model_id !== state.chat.model_id ||
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
function emptyCandidates(status: OwnerWan26I2vResultCandidates["status"], owner: OwnerWan26I2vHistoryWitness["owner_ack_status"],
  pageStatus: OwnerWan26I2vHistoryWitness["history_page_status"], calls: number, gap: string): OwnerWan26I2vResultCandidates {
  return Object.freeze({ status, owner_ack_status: owner, history_binding_status: "UNVERIFIED", history_page_status: pageStatus,
    provider_chat_id: null, owner_echo_message_id: null, candidate_messages: Object.freeze([]), bot_error_observed: false,
    gaps: Object.freeze([gap as OwnerWan26I2vResultCandidates["gaps"][number]]), backend_acceptance: "UNPROVEN",
    history_get_calls: calls, total_count: null, total_pages: null, contexts: Object.freeze([]) });
}
function isLinkService(value: unknown): value is PerUserLinkService {
  try { const d = value && Object.getOwnPropertyDescriptor(PerUserLinkService.prototype, "getStatus");
    return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === PerUserLinkService.prototype &&
      !Object.hasOwn(value as object, "getStatus") && !!d && "value" in (d as PropertyDescriptor) &&
      (d as PropertyDescriptor).value === NATIVE_LINK_GET_STATUS && Reflect.get(value, "getStatus") === NATIVE_LINK_GET_STATUS;
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
  try { const proto = Object.getPrototypeOf(value), d = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(d);
    if ((proto !== Object.prototype && proto !== null) || own.length !== keys.length || own.some((key) => typeof key !== "string" ||
      !keys.includes(key) || !d[key]!.enumerable || !("value" in d[key]!))) fail("INVALID_REQUEST");
    const out = Object.create(null); for (const key of keys) out[key] = d[key]!.value; return out;
  } catch { return fail("INVALID_REQUEST"); }
}
function isSafeId(value: unknown): value is string { return typeof value === "string" && ID.test(value); }
function fail(code: OwnerWan26I2vNativeErrorCode): never { throw new OwnerWan26I2vNativeError(code); }
function translate(error: unknown, fallback: OwnerWan26I2vNativeErrorCode): OwnerWan26I2vNativeError {
  if (error instanceof OwnerWan26I2vNativeError) return error;
  if (error instanceof OwnerWan26I2vOneShotPolicyError) return new OwnerWan26I2vNativeError(error.code === "PRINCIPAL_MISMATCH" ? "PRINCIPAL_NOT_LINKED" : "CANDIDATE_INVALID");
  if (error instanceof OwnerReferencePrincipalError) return new OwnerWan26I2vNativeError("PRINCIPAL_NOT_LINKED");
  return new OwnerWan26I2vNativeError(fallback);
}
function consume(input: unknown, packet: unknown, method: "create" | "start" | "list" | "get") {
  try { return consumeOwnerWan26I2vNativeInvocation(input, packet, method); }
  catch { fail("INVALID_REQUEST"); }
}
function isExactNativeClient(client: unknown): client is SyntxChatHttpClient {
  try { const native = requireNativeMethods(); return !!client && typeof client === "object" && !types.isProxy(client) &&
    Object.getPrototypeOf(client) === SyntxChatHttpClient.prototype &&
    !["createOwnerWan26I2vChat", "startOwnerWan26I2vWithOwnedCandidate", "listOwnedWan26I2vCandidates", "getOwnedWan26I2vResult",
      "createChat", "uploadWan26I2vImage", "uploadWan26I2vAudio"].some((key) => Object.hasOwn(client, key)) &&
    Object.entries(native).every(([key, value]) => getDataMethod(client, key) === value && Reflect.get(client, key) === value &&
      getDataMethod(SyntxChatHttpClient.prototype, key) === value);
  } catch { return false; }
}
function getDataMethod(target: object, key: string): unknown { let p: object | null = target; while (p) { const d = Object.getOwnPropertyDescriptor(p, key); if (d) return "value" in d ? d.value : undefined; p = Object.getPrototypeOf(p) as object | null; } return undefined; }
function requireNativeMethods(): Record<string, unknown> {
  return { createChat: NATIVE_CREATE_CHAT, uploadWan26I2vImage: NATIVE_IMAGE_UPLOAD, uploadWan26I2vAudio: NATIVE_AUDIO_UPLOAD,
    createOwnerWan26I2vChat: NATIVE_CREATE, startOwnerWan26I2vWithOwnedCandidate: NATIVE_START,
    listOwnedWan26I2vCandidates: NATIVE_LIST, getOwnedWan26I2vResult: NATIVE_GET };
}
const NATIVE_CREATE_CHAT = SyntxChatHttpClient.prototype.createChat;
const NATIVE_IMAGE_UPLOAD = SyntxChatHttpClient.prototype.uploadWan26I2vImage;
const NATIVE_AUDIO_UPLOAD = SyntxChatHttpClient.prototype.uploadWan26I2vAudio;
const NATIVE_CREATE = SyntxChatHttpClient.prototype.createOwnerWan26I2vChat;
const NATIVE_START = SyntxChatHttpClient.prototype.startOwnerWan26I2vWithOwnedCandidate;
const NATIVE_LIST = SyntxChatHttpClient.prototype.listOwnedWan26I2vCandidates;
const NATIVE_GET = SyntxChatHttpClient.prototype.getOwnedWan26I2vResult;
