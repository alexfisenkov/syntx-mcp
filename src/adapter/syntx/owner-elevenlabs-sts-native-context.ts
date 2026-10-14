import { types } from "node:util";
import type { AuthBinding } from "../../auth/types.js";
import { PerUserLinkService } from "../../auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../../domain/generation-principal.js";
import { schemaHash } from "../../domain/generation-contract.js";
import { decodeOwnerElevenLabsStsResult, type OwnerElevenLabsStsResultReadContext } from "./owner-elevenlabs-sts-result-codec.js";
import type { OwnerElevenLabsStsPreparedCandidate, OwnerElevenLabsStsRequestPreparer } from "../../application/owner-elevenlabs-sts-request-preparer.js";
import type { OwnerElevenLabsStsOneShotPermit } from "../../application/owner-elevenlabs-sts-one-shot-policy.js";
import { randomUUID } from "node:crypto";
import { z } from "zod/v4";

export interface OwnerElevenLabsStsNativePrincipalBinding {
  readonly binding: Readonly<AuthBinding>;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly linkService: PerUserLinkService;
}

export interface OwnerElevenLabsStsChatContext {
  readonly status: "created";
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly model_id: "eleven_multilingual_sts_v2";
  readonly source_sha256: string;
  readonly profile_schema_hash: string;
  readonly intent_fingerprint: string;
  readonly request_fingerprint: string;
  readonly expires_at: number;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}
export interface OwnerElevenLabsStsResultMessageContext extends OwnerElevenLabsStsResultReadContext {
  readonly attempt_id: string;
  readonly source_sha256: string;
  readonly profile_schema_hash: string;
  readonly intent_fingerprint: string;
  readonly owner_echo_message_id: string;
}
export interface OwnerElevenLabsStsResultCandidates {
  readonly status: "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  readonly history_binding_status: "BOUND" | "PARTIAL" | "UNVERIFIED";
  readonly history_page_status: "NOT_READ" | "COMPLETE" | "INCOMPLETE" | "UNPROVEN";
  readonly history_get_calls: number;
  readonly total_count: number | null;
  readonly total_pages: number | null;
  readonly provider_chat_id: string | null;
  readonly owner_echo_message_id: string | null;
  readonly contexts: readonly OwnerElevenLabsStsResultMessageContext[];
  readonly gaps: readonly string[];
  readonly backend_acceptance: "UNPROVEN";
}
export interface OwnerElevenLabsStsNativeOperationInput {
  readonly preparer: OwnerElevenLabsStsRequestPreparer;
  readonly candidate: OwnerElevenLabsStsPreparedCandidate;
  readonly permit: OwnerElevenLabsStsOneShotPermit;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly linkService: PerUserLinkService;
  readonly binding: AuthBinding;
}
export interface OwnerElevenLabsStsNativeStartInput extends OwnerElevenLabsStsNativeOperationInput {
  readonly chat: OwnerElevenLabsStsChatContext;
}
interface NativeState {
  readonly client: object;
  readonly chat: OwnerElevenLabsStsChatContext;
  readonly operation: Readonly<OwnerElevenLabsStsNativeOperationInput>;
  readonly auth: OwnerElevenLabsStsNativePrincipalBinding;
  phase: "AVAILABLE" | "OUTCOME_UNKNOWN" | "ACKNOWLEDGED" | "PRE_DISPATCH_FAILED";
  ownerEchoMessageId?: string;
  providerChatId?: string;
  readonly resultContexts: Map<string, OwnerElevenLabsStsResultMessageContext>;
  historyGetCalls: number;
}
interface NativeResultState {
  readonly client: object;
  readonly state: NativeState;
  readonly context: OwnerElevenLabsStsResultMessageContext;
  readonly codecContext: OwnerElevenLabsStsResultReadContext;
}
const CHAT_STATES = new WeakMap<object, NativeState>();
const RESULT_STATES = new WeakMap<object, NativeResultState>();
const CLIENT_CHATS = new WeakMap<object, Map<string, NativeState>>();
const USED_PERMITS = new WeakSet<object>();
const PAGE_SIZE = 10, PAGE_LIMIT = 7, MESSAGE_LIMIT = 64, BOT_AUTHOR_ID = -1;

const historyPageSchema = z.object({
  messages: z.array(z.unknown()).max(PAGE_SIZE),
  pagination: z.object({ page: z.number().int().min(1).max(PAGE_LIMIT), page_size: z.literal(PAGE_SIZE),
    total_count: z.number().int().min(0).max(MESSAGE_LIMIT), total_pages: z.number().int().min(0).max(PAGE_LIMIT),
    has_next: z.boolean(), has_previous: z.boolean() }).passthrough()
}).passthrough();
const historyObjectSchema = z.object({ id: z.union([z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u),
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String), message_id: z.union([
  z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String),
  object_type: z.string(), model_type: z.string().nullable().optional() }).strip();
const historyRowSchema = z.object({ id: z.union([z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u),
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String), chat_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  author_id: z.number().int(), message_object: z.array(historyObjectSchema).max(64) }).strip();

export class OwnerElevenLabsStsNativeError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "CHAT_CREATE_FAILED" | "CHAT_CONTEXT_INVALID" | "CHAT_ALREADY_CREATED" |
    "CHAT_NOT_DISPATCHED" | "CHAT_DISPATCH_ALREADY_STARTED" | "CANDIDATE_INVALID" | "OUTCOME_UNKNOWN" |
    "HISTORY_UNAVAILABLE" | "RESULT_CONTEXT_INVALID" | "RESULT_GET_UNAVAILABLE" | "REQUEST_ABORTED" | "CAPACITY_EXCEEDED") {
    super("The owner ElevenLabs STS native operation could not be completed safely."); this.name = "OwnerElevenLabsStsNativeError";
  }
}

export async function createOwnerElevenLabsStsNativeChat(input: unknown, invocationPacket: unknown,
  signal?: AbortSignal): Promise<OwnerElevenLabsStsChatContext> {
  const invocation = await consumeInvocation(input, invocationPacket, "create");
  const client = invocation.client;
  const createChat = invocation.callback as (scope: "audio", title: string, signal?: AbortSignal) => Promise<{ chat_uuid: string }>;
  const fields = readOperation(input, false);
  if (signal?.aborted) fail("REQUEST_ABORTED");
  const auth = readAuthBinding({ binding: fields.binding, attemptId: fields.attemptId, principal: fields.principal, linkService: fields.linkService });
  await assertOwnerElevenLabsStsAuthorizeCurrentPrincipal(auth, signal);
  const preparer = await import("../../application/owner-elevenlabs-sts-request-preparer.js");
  const policy = await import("../../application/owner-elevenlabs-sts-one-shot-policy.js");
  const permitInput = { permit: fields.permit, preparer: fields.preparer, candidate: fields.candidate,
    principal: fields.principal, attemptId: fields.attemptId };
  try {
    if (!preparer.isOwnerElevenLabsStsRequestPreparer(fields.preparer) || !preparer.isOwnerElevenLabsStsPreparedCandidate(fields.candidate)) fail("CANDIDATE_INVALID");
    const binding = fields.preparer.inspectCandidate(fields.candidate);
    validateOperationBinding(fields, binding);
    const capturedClient = fields.preparer.withCapturedNativeOriginal(fields.candidate,
      (nativeClient) => nativeClient);
    if (capturedClient !== client) fail("CANDIDATE_INVALID");
    await policy.revalidateOwnerElevenLabsStsOneShotPermit(permitInput);
    await assertOwnerElevenLabsStsAuthorizeCurrentPrincipal(auth, signal);
  } catch { fail("CANDIDATE_INVALID"); }
  if (USED_PERMITS.has(fields.permit as object)) fail("CHAT_ALREADY_CREATED");
  let chats = CLIENT_CHATS.get(client);
  if (!chats) { chats = new Map(); CLIENT_CHATS.set(client, chats); }
  if (chats.size >= 128) fail("CAPACITY_EXCEEDED");
  USED_PERMITS.add(fields.permit as object);
  let receipt: { chat_uuid: string };
  try { receipt = await createChat("audio", `owner-elevenlabs-sts-${randomUUID()}`, signal); }
  catch { fail("CHAT_CREATE_FAILED"); }
  if (signal?.aborted) fail("CHAT_CREATE_FAILED");
  if (!safeId(receipt.chat_uuid)) fail("CHAT_CREATE_FAILED");
  try {
    await policy.revalidateOwnerElevenLabsStsOneShotPermit(permitInput);
    await assertOwnerElevenLabsStsAuthorizeCurrentPrincipal(auth, signal);
  } catch { fail("CANDIDATE_INVALID"); }
  const binding = fields.preparer.inspectCandidate(fields.candidate)!;
  const chat: OwnerElevenLabsStsChatContext = Object.freeze({ status: "created", chat_uuid: receipt.chat_uuid,
    attempt_id: fields.attemptId, model_id: "eleven_multilingual_sts_v2",
    source_sha256: binding.source_sha256, profile_schema_hash: binding.profile_schema_hash,
    intent_fingerprint: binding.intent_fingerprint, request_fingerprint: binding.request_fingerprint,
    expires_at: binding.expires_at, dispatch_allowed: false, backend_acceptance: "UNPROVEN" });
  const state: NativeState = { client, chat, operation: fields, auth, phase: "AVAILABLE", resultContexts: new Map(), historyGetCalls: 0 };
  chats.set(chat.chat_uuid, state); CHAT_STATES.set(chat, state); return chat;
}

export async function startOwnerElevenLabsStsNativeGeneration(input: unknown, invocationPacket: unknown,
  signal?: AbortSignal): Promise<{ chat_uuid: string; message_id: string }> {
  const invocation = await consumeInvocation(input, invocationPacket, "start");
  const client = invocation.client;
  const start = invocation.callback as (chatUuid: string, body: Record<string, unknown>, signal?: AbortSignal) => Promise<{ chat_uuid: string; message_id: string }>;
  const fields = readOperation(input, true), chat = fields.chat as OwnerElevenLabsStsChatContext;
  const state = nativeChatState(client, chat);
  if (state.phase !== "AVAILABLE" || state.operation.candidate !== fields.candidate || state.operation.permit !== fields.permit ||
      state.operation.preparer !== fields.preparer || state.operation.attemptId !== fields.attemptId ||
      !sameGenerationPrincipal(state.operation.principal, fields.principal) || state.auth.linkService !== fields.linkService ||
      !sameBinding(state.auth.binding, fields.binding)) fail("CHAT_CONTEXT_INVALID");
  if (signal?.aborted) fail("REQUEST_ABORTED");
  state.phase = "AVAILABLE";
  const preparer = await import("../../application/owner-elevenlabs-sts-request-preparer.js");
  const policy = await import("../../application/owner-elevenlabs-sts-one-shot-policy.js");
  const permitInput = { permit: fields.permit, preparer: fields.preparer, candidate: fields.candidate,
    principal: fields.principal, attemptId: fields.attemptId };
  let request: ReturnType<typeof fields.preparer.getPrivateRequest>;
  try {
    if (!preparer.isOwnerElevenLabsStsPreparedCandidate(fields.candidate)) fail("CANDIDATE_INVALID");
    await assertOwnerElevenLabsStsAuthorizeCurrentPrincipal(state.auth, signal);
    await policy.revalidateOwnerElevenLabsStsOneShotPermit(permitInput);
    const firstBinding = fields.preparer.inspectCandidate(fields.candidate);
    const firstRequest = fields.preparer.getPrivateRequest(fields.candidate);
    request = firstRequest;
    await fields.preparer.revalidateCandidate(fields.candidate);
    const currentBinding = fields.preparer.inspectCandidate(fields.candidate);
    const currentRequest = fields.preparer.getPrivateRequest(fields.candidate);
    if (!firstBinding || schemaHash(firstBinding) !== schemaHash(currentBinding) || schemaHash(firstRequest) !== schemaHash(currentRequest) ||
        request.prompt !== "" || !exactRequestShape(request)) fail("CANDIDATE_INVALID");
    const captured = fields.preparer.withCapturedNativeOriginal(fields.candidate, (capturedClient, _reference, url) => ({ capturedClient, url }));
    if (captured.capturedClient !== client || request.settings.file_urls[0]?.url !== captured.url) fail("CANDIDATE_INVALID");
    const binding = fields.preparer.inspectCandidate(fields.candidate)!;
    if (binding.request_fingerprint !== chat.request_fingerprint || binding.source_sha256 !== chat.source_sha256 ||
        binding.profile_schema_hash !== chat.profile_schema_hash || binding.intent_fingerprint !== chat.intent_fingerprint) fail("CANDIDATE_INVALID");
    await assertOwnerElevenLabsStsAuthorizeCurrentPrincipal(state.auth, signal);
    const consumed = policy.consumeOwnerElevenLabsStsOneShotPermit(permitInput);
    if (consumed.status !== "consumed" || consumed.dispatch_allowed !== false || consumed.request_fingerprint !== chat.request_fingerprint) fail("CANDIDATE_INVALID");
  } catch { fail("CANDIDATE_INVALID"); }
  state.phase = "OUTCOME_UNKNOWN";
  try {
    const receipt = await start(chat.chat_uuid, { chat_uuid: chat.chat_uuid, prompt: "", settings: request!.settings }, signal);
    if (signal?.aborted || receipt.chat_uuid !== chat.chat_uuid || !safeId(receipt.message_id)) fail("OUTCOME_UNKNOWN");
    state.ownerEchoMessageId = receipt.message_id; state.phase = "ACKNOWLEDGED";
    return Object.freeze({ chat_uuid: chat.chat_uuid, message_id: receipt.message_id });
  } catch { state.phase = "OUTCOME_UNKNOWN"; fail("OUTCOME_UNKNOWN"); }
}

export async function listOwnerElevenLabsStsNativeCandidates(input: unknown, invocationPacket: unknown,
  signal?: AbortSignal): Promise<OwnerElevenLabsStsResultCandidates> {
  const invocation = await consumeInvocation(input, invocationPacket, "list");
  const client = invocation.client;
  const getPage = invocation.callback as (chatUuid: string, page: number, pageSize: number, signal?: AbortSignal) => Promise<unknown>;
  const chat = input;
  const state = nativeChatState(client, chat);
  if (state.phase !== "ACKNOWLEDGED" && state.phase !== "OUTCOME_UNKNOWN") fail("CHAT_NOT_DISPATCHED");
  if (signal?.aborted) fail("REQUEST_ABORTED");
  const messages: z.infer<typeof historyRowSchema>[] = [];
  const seenMessageIds = new Set<string>(), seenObjectIds = new Set<string>();
  let totalCount: number | undefined, totalPages: number | undefined, providerChatId: string | undefined, calls = 0;
  try {
    for (let page = 1; page <= PAGE_LIMIT; page += 1) {
      await assertOwnerElevenLabsStsAuthorizeCurrentPrincipal(state.auth, signal);
      calls += 1; state.historyGetCalls += 1;
      let raw: unknown;
      try { raw = await getPage(state.chat.chat_uuid, page, PAGE_SIZE, signal); }
      finally { await assertOwnerElevenLabsStsAuthorizeCurrentPrincipal(state.auth, signal); }
      const parsed = historyPageSchema.safeParse(raw);
      if (!parsed.success) return emptyCandidates("UNVERIFIED", "UNPROVEN", calls, "HISTORY_PAGE_INVALID");
      const { messages: rawRows, pagination } = parsed.data;
      const expectedPages = pagination.total_count === 0 ? 0 : Math.ceil(pagination.total_count / PAGE_SIZE);
      const expectedRows = Math.min(PAGE_SIZE, Math.max(0, pagination.total_count - (page - 1) * PAGE_SIZE));
      if (pagination.page !== page || pagination.total_pages !== expectedPages || pagination.has_previous !== (page > 1) ||
          pagination.has_next !== (page < expectedPages) || rawRows.length !== expectedRows ||
          (totalCount !== undefined && (totalCount !== pagination.total_count || totalPages !== pagination.total_pages))) {
        return emptyCandidates("UNVERIFIED", "UNPROVEN", calls, "HISTORY_PAGE_INCONSISTENT");
      }
      if (expectedPages === 0) return emptyCandidates("PENDING", "COMPLETE", calls, "HISTORY_EMPTY");
      totalCount ??= pagination.total_count; totalPages ??= pagination.total_pages;
      for (const rawRow of rawRows) {
        const row = historyRowSchema.safeParse(rawRow); if (!row.success) return emptyCandidates("UNVERIFIED", "UNPROVEN", calls, "HISTORY_ROW_INVALID");
        const rowChat = String(row.data.chat_id);
        if (providerChatId === undefined) providerChatId = rowChat;
        if (rowChat !== providerChatId) return emptyCandidates("UNVERIFIED", "UNPROVEN", calls, "HISTORY_CHAT_ID_MISMATCH");
        if (seenMessageIds.has(row.data.id) || row.data.message_object.some((object) => object.message_id !== row.data.id || seenObjectIds.has(object.id))) {
          return emptyCandidates("UNVERIFIED", "UNPROVEN", calls, "HISTORY_OBJECT_MESSAGE_MISMATCH");
        }
        seenMessageIds.add(row.data.id); for (const object of row.data.message_object) seenObjectIds.add(object.id);
        messages.push(row.data);
      }
      if (page === expectedPages) break;
    }
  } catch (error) { if (signal?.aborted) fail("REQUEST_ABORTED"); return emptyCandidates("UNVERIFIED", "UNPROVEN", calls, "HISTORY_UNAVAILABLE"); }
  if (messages.length !== totalCount || providerChatId === undefined) return emptyCandidates("UNVERIFIED", "INCOMPLETE", calls, "HISTORY_INCOMPLETE");
  const ackRows = state.ownerEchoMessageId ? messages.filter((row) => row.id === state.ownerEchoMessageId && row.author_id > 0) : [];
  if (ackRows.length !== 1) return Object.freeze({ ...emptyCandidates("INCOMPLETE", "COMPLETE", calls,
    state.ownerEchoMessageId ? "OWNER_ACK_MISSING" : "POST_ACK_UNKNOWN"), owner_ack_status: state.ownerEchoMessageId ? "MISMATCH" : "MISSING",
    total_count: totalCount ?? 0, total_pages: totalPages ?? 0, provider_chat_id: providerChatId, owner_echo_message_id: state.ownerEchoMessageId ?? null });
  const contexts: OwnerElevenLabsStsResultMessageContext[] = [], gaps: string[] = [];
  for (const row of messages) {
    if (row.author_id !== BOT_AUTHOR_ID) continue;
    const audio = row.message_object.filter((object) => object.object_type === "audio");
    if (audio.length === 0) continue;
    if (audio.length !== 1 || audio[0]!.model_type !== "eleven_multilingual_sts_v2") { gaps.push("BOT_AUDIO_MODEL_OR_OBJECT_MISMATCH"); continue; }
    const codecContext: OwnerElevenLabsStsResultReadContext = Object.freeze({ chat_uuid: state.chat.chat_uuid, message_id: row.id,
      model_id: "eleven_multilingual_sts_v2", provider_chat_id: providerChatId, message_object_ids: Object.freeze([audio[0]!.id]) as readonly [string] });
    const context: OwnerElevenLabsStsResultMessageContext = Object.freeze({ ...codecContext, attempt_id: state.chat.attempt_id,
      source_sha256: state.chat.source_sha256, profile_schema_hash: state.chat.profile_schema_hash,
      intent_fingerprint: state.chat.intent_fingerprint, owner_echo_message_id: state.ownerEchoMessageId! });
    const prior = state.resultContexts.get(row.id);
    if (prior && schemaHash(prior) !== schemaHash(context)) return emptyCandidates("UNVERIFIED", "UNPROVEN", calls, "RESULT_CONTEXT_MISMATCH");
    if (!prior) { RESULT_STATES.set(context, { client, state, context, codecContext }); state.resultContexts.set(row.id, context); contexts.push(context); }
    else contexts.push(prior);
  }
  const resultStatus = contexts.length ? "COMPLETE" : gaps.length ? "UNVERIFIED" : "PENDING";
  return Object.freeze({ status: resultStatus, owner_ack_status: "MATCHED", history_binding_status: contexts.length ? "BOUND" : gaps.length ? "PARTIAL" : "BOUND",
    history_page_status: "COMPLETE", history_get_calls: calls, total_count: totalCount!, total_pages: totalPages!, provider_chat_id: providerChatId,
    owner_echo_message_id: state.ownerEchoMessageId!, contexts: Object.freeze(contexts), gaps: Object.freeze(gaps.length ? gaps : contexts.length ? [] : ["BOT_RESULT_NOT_OBSERVED"]),
    backend_acceptance: "UNPROVEN" });
}

export async function getOwnerElevenLabsStsNativeResult(input: unknown, invocationPacket: unknown,
  signal?: AbortSignal) {
  const invocation = await consumeInvocation(input, invocationPacket, "get");
  const client = invocation.client;
  const getMessage = invocation.callback as (chatUuid: string, messageId: string, signal?: AbortSignal) => Promise<unknown>;
  if (!input || typeof input !== "object" || types.isProxy(input)) fail("RESULT_CONTEXT_INVALID");
  const owned = RESULT_STATES.get(input);
  if (!owned || owned.client !== client || owned.context !== input || owned.state.phase !== "ACKNOWLEDGED" ||
      owned.state.ownerEchoMessageId !== owned.context.owner_echo_message_id || CHAT_STATES.get(owned.state.chat) !== owned.state) fail("RESULT_CONTEXT_INVALID");
  if (signal?.aborted) fail("REQUEST_ABORTED");
  await assertOwnerElevenLabsStsAuthorizeCurrentPrincipal(owned.state.auth, signal);
  try {
    let raw: unknown;
    try { raw = await getMessage(owned.codecContext.chat_uuid, owned.codecContext.message_id, signal); }
    finally { await assertOwnerElevenLabsStsAuthorizeCurrentPrincipal(owned.state.auth, signal); }
    return decodeOwnerElevenLabsStsResult(raw, owned.codecContext);
  } catch (error) { if (signal?.aborted) fail("REQUEST_ABORTED"); fail("RESULT_GET_UNAVAILABLE"); }
}

function nativeChatState(client: object, value: unknown): NativeState {
  if (!value || typeof value !== "object" || types.isProxy(value)) fail("CHAT_CONTEXT_INVALID");
  const state = CHAT_STATES.get(value);
  if (!state || state.client !== client || state.chat !== value || CLIENT_CHATS.get(client)?.get(state.chat.chat_uuid) !== state) fail("CHAT_CONTEXT_INVALID");
  return state;
}
function readOperation(input: unknown, includeChat: boolean): Readonly<OwnerElevenLabsStsNativeOperationInput & { chat?: OwnerElevenLabsStsChatContext }> {
  const keys = ["preparer", "candidate", "permit", "principal", "attemptId", "linkService", "binding", ...(includeChat ? ["chat"] : [])];
  const row = exact(input, keys);
  if (typeof row.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(row.attemptId) ||
      !row.candidate || typeof row.candidate !== "object" || types.isProxy(row.candidate) ||
      !row.permit || typeof row.permit !== "object" || types.isProxy(row.permit)) fail("INVALID_REQUEST");
  const principal = snapshotGenerationPrincipal(row.principal as GenerationPrincipalRef);
  const binding = exact(row.binding, ["tenant_id", "subject"]);
  return Object.freeze({ preparer: row.preparer as OwnerElevenLabsStsRequestPreparer, candidate: row.candidate as OwnerElevenLabsStsPreparedCandidate,
    permit: row.permit as OwnerElevenLabsStsOneShotPermit, principal, attemptId: row.attemptId, linkService: row.linkService as PerUserLinkService,
    binding: Object.freeze({ tenant_id: binding.tenant_id as string, subject: binding.subject as string }),
    ...(includeChat ? { chat: row.chat as OwnerElevenLabsStsChatContext } : {}) });
}
function readAuthBinding(input: unknown): OwnerElevenLabsStsNativePrincipalBinding {
  return snapshotOwnerElevenLabsStsNativePrincipalBinding(input);
}
function validateOperationBinding(fields: Readonly<OwnerElevenLabsStsNativeOperationInput>, binding: ReturnType<OwnerElevenLabsStsRequestPreparer["inspectCandidate"]>): void {
  if (!binding || binding.attempt_id !== fields.attemptId || !sameGenerationPrincipal(binding.principal, fields.principal) ||
      binding.duration_projection_status !== "SOURCE_VERIFIED" || binding.duration < 5 || binding.duration > 300 ||
      !/^[a-f0-9]{64}$/u.test(binding.source_sha256) || !isSchemaHash(binding.request_fingerprint) ||
      !isSchemaHash(binding.intent_fingerprint) || !isSchemaHash(binding.profile_schema_hash)) fail("CANDIDATE_INVALID");
}
function exactRequestShape(request: unknown): boolean {
  try {
    const row = exact(request, ["prompt", "settings"]), settings = exact(row.settings, ["model_type", "mode", "voice_id", "duration", "file_urls"]);
    const refs = settings.file_urls;
    if (row.prompt !== "" || settings.model_type !== "eleven_multilingual_sts_v2" || settings.mode !== "speech_to_speech" ||
        typeof settings.voice_id !== "string" || !safeId(settings.voice_id) || !Number.isSafeInteger(settings.duration) ||
        (settings.duration as number) < 5 || (settings.duration as number) > 300 || !Array.isArray(refs) || refs.length !== 1) return false;
    const ref = exact(refs[0], ["type", "url"]);
    return ref.type === "audio" && typeof ref.url === "string" && isSafeUploadReferenceUrl(ref.url);
  } catch { return false; }
}
function emptyCandidates(status: OwnerElevenLabsStsResultCandidates["status"], page: OwnerElevenLabsStsResultCandidates["history_page_status"], calls: number, gap: string): OwnerElevenLabsStsResultCandidates {
  return Object.freeze({ status, owner_ack_status: "MISSING", history_binding_status: "UNVERIFIED", history_page_status: page,
    history_get_calls: calls, total_count: null, total_pages: null, provider_chat_id: null, owner_echo_message_id: null,
    contexts: Object.freeze([]), gaps: Object.freeze([gap]), backend_acceptance: "UNPROVEN" });
}
function sameBinding(a: AuthBinding, b: unknown): boolean { try { const row = exact(b, ["tenant_id", "subject"]); return a.tenant_id === row.tenant_id && a.subject === row.subject; } catch { return false; } }
function safeId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u.test(value); }
function isSchemaHash(value: unknown): value is string { return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value); }
function isSafeUploadReferenceUrl(value: string): boolean { try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "r2.syntx.ai" && !url.port && !url.username && !url.password && !url.hash; } catch { return false; } }
function fail(code: ConstructorParameters<typeof OwnerElevenLabsStsNativeError>[0]): never { throw new OwnerElevenLabsStsNativeError(code); }

async function consumeInvocation(input: unknown, packet: unknown, method: "create" | "start" | "list" | "get") {
  try {
    const nativeClient = await import("./chat-http-client.js");
    return nativeClient.consumeOwnerElevenLabsStsNativeInvocation(input, packet, method);
  } catch { fail("INVALID_REQUEST"); }
}

/** Captures only the concrete owner-link service and the candidate's matching principal. */
export function snapshotOwnerElevenLabsStsNativePrincipalBinding(input: unknown): OwnerElevenLabsStsNativePrincipalBinding {
  const row = exact(input, ["binding", "attemptId", "principal", "linkService"]);
  const links = row.linkService;
  if (!(links instanceof PerUserLinkService) || Object.getPrototypeOf(links) !== PerUserLinkService.prototype ||
      getDataMethod(links, "getStatus") !== PerUserLinkService.prototype.getStatus ||
      typeof row.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(row.attemptId)) throw new TypeError("STS_GET_AUTHORIZATION_INVALID");
  const principal = snapshotGenerationPrincipal(row.principal as GenerationPrincipalRef);
  const bindingRow = exact(row.binding, ["tenant_id", "subject"]);
  const binding = Object.freeze({ tenant_id: bindingRow.tenant_id as string, subject: bindingRow.subject as string });
  if (principal.connection_id !== row.attemptId || principal.tenant_id !== binding.tenant_id || principal.subject_id !== binding.subject) {
    throw new TypeError("STS_GET_AUTHORIZATION_INVALID");
  }
  return Object.freeze({ binding, attemptId: row.attemptId, principal, linkService: links as PerUserLinkService });
}

export async function assertOwnerElevenLabsStsAuthorizeCurrentPrincipal(
  context: OwnerElevenLabsStsNativePrincipalBinding, signal?: AbortSignal
): Promise<void> {
  if (signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal))) throw new TypeError("STS_GET_AUTHORIZATION_INVALID");
  if (signal?.aborted) throw new Error("REQUEST_ABORTED");
  if (!(context.linkService instanceof PerUserLinkService) || Object.getPrototypeOf(context.linkService) !== PerUserLinkService.prototype ||
      getDataMethod(context.linkService, "getStatus") !== PerUserLinkService.prototype.getStatus) throw new TypeError("STS_GET_AUTHORIZATION_INVALID");
  const current = await resolveOwnerReferencePrincipal({ binding: context.binding, attemptId: context.attemptId, linkService: context.linkService });
  if (!sameGenerationPrincipal(current, context.principal) || signal?.aborted) throw new Error(signal?.aborted ? "REQUEST_ABORTED" : "PRINCIPAL_NOT_LINKED");
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new TypeError("STS_GET_AUTHORIZATION_INVALID");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("STS_GET_AUTHORIZATION_INVALID");
  const descriptors = Object.getOwnPropertyDescriptors(value), ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) throw new TypeError("STS_GET_AUTHORIZATION_INVALID");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) { if (!Object.hasOwn(descriptors, key)) throw new TypeError("STS_GET_AUTHORIZATION_INVALID"); result[key] = descriptors[key]!.value; }
  return result;
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
