import { types } from "node:util";
import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import type { AuthBinding } from "../../auth/types.js";
import { PerUserLinkService } from "../../auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../../domain/generation-principal.js";
import { schemaHash } from "../../domain/generation-contract.js";
import type { OwnerTopazAstraOwnedPreparedCandidate, OwnerTopazAstraOwnedRequestPreparer } from "../../application/owner-topaz-astra-owned-request-preparer.js";
import type { OwnerTopazAstraOwnedOneShotPermit } from "../../application/owner-topaz-astra-owned-one-shot-policy.js";
import { OwnerTopazAstraOriginalReferenceService, type OwnerTopazAstraOriginalResolution } from "../../application/owner-topaz-astra-original-reference-service.js";
import type { OwnerTopazAstraOriginalUploadContext } from "./topaz-astra-original-upload.js";
import { readOwnerTopazAstraOriginalUploadForClient } from "./chat-http-client.js";
import type { OwnerWanT2vReadyVideo } from "./owner-wan-t2v-video-result.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const models = ["slc-1", "slf-2", "slp-2", "slp-2.5"] as const;
const MODEL_SET = new Set<string>(models);
const CHAT_LIMIT = 128, PAGE_SIZE = 10, PAGE_LIMIT = 7, MESSAGE_LIMIT = 64, BOT_AUTHOR_ID = -1;
const operations = new WeakMap<object, NativeState>();
const chatsByClient = new WeakMap<object, Map<string, NativeState>>();
const results = new WeakMap<object, ResultState>();
const usedPermits = new WeakSet<object>();
const pendingPermits = new WeakSet<object>();

export interface OwnerTopazAstraNativeOperationInput {
  readonly preparer: OwnerTopazAstraOwnedRequestPreparer;
  readonly candidate: OwnerTopazAstraOwnedPreparedCandidate;
  readonly permit: OwnerTopazAstraOwnedOneShotPermit;
  readonly originalReferenceService: OwnerTopazAstraOriginalReferenceService;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly linkService: PerUserLinkService;
  readonly binding: AuthBinding;
}
export interface OwnerTopazAstraChatContext {
  readonly status: "created"; readonly chat_uuid: string; readonly attempt_id: string;
  readonly model_id: typeof models[number]; readonly profile_schema_hash: string;
  readonly intent_fingerprint: string; readonly request_fingerprint: string; readonly expires_at: number;
  readonly dispatch_allowed: false; readonly backend_acceptance: "UNPROVEN";
}
export interface OwnerTopazAstraResultContext {
  readonly chat_uuid: string; readonly message_id: string; readonly model_id: typeof models[number];
  readonly provider_chat_id: string; readonly message_object_ids: readonly string[];
  readonly attempt_id: string; readonly profile_schema_hash: string;
  readonly intent_fingerprint: string; readonly owner_echo_message_id: string;
}
export interface OwnerTopazAstraResultCandidates {
  readonly status: "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  readonly history_binding_status: "BOUND" | "PARTIAL" | "UNVERIFIED";
  readonly history_page_status: "NOT_READ" | "COMPLETE" | "INCOMPLETE" | "UNPROVEN";
  readonly history_get_calls: number; readonly total_count: number | null; readonly total_pages: number | null;
  readonly provider_chat_id: string | null; readonly owner_echo_message_id: string | null;
  readonly contexts: readonly OwnerTopazAstraResultContext[]; readonly gaps: readonly string[];
  readonly backend_acceptance: "UNPROVEN";
}
export interface OwnerTopazAstraResult {
  readonly message_binding: "BOUND" | "UNVERIFIED"; readonly model_echo: "MATCHED" | "UNKNOWN" | "MISMATCH";
  readonly ready_videos: readonly Readonly<OwnerWanT2vReadyVideo>[]; readonly gaps: readonly string[];
  readonly backend_acceptance: "UNPROVEN";
}
type NativeInput = Readonly<OwnerTopazAstraNativeOperationInput & { principal: Readonly<GenerationPrincipalRef>; binding: Readonly<AuthBinding> }>;
interface NativeState {
  readonly client: object; readonly input: NativeInput; readonly auth: NativeInput;
  readonly chat: OwnerTopazAstraChatContext; phase: "AVAILABLE" | "OUTCOME_UNKNOWN" | "ACKNOWLEDGED";
  ownerEcho?: string; readonly contexts: Map<string, OwnerTopazAstraResultContext>;
}
interface ResultState { readonly client: object; readonly state: NativeState; readonly context: OwnerTopazAstraResultContext;
  readonly codec: Readonly<{ chat_uuid: string; message_id: string; model_id: typeof models[number]; provider_chat_id: string; message_object_ids: readonly string[] }> }

const pageSchema = z.object({ messages: z.array(z.unknown()).max(PAGE_SIZE), pagination: z.object({
  page: z.number().int().min(1).max(PAGE_LIMIT), page_size: z.literal(PAGE_SIZE), total_count: z.number().int().min(0).max(MESSAGE_LIMIT),
  total_pages: z.number().int().min(0).max(PAGE_LIMIT), has_next: z.boolean(), has_previous: z.boolean()
}).passthrough() }).passthrough();
const objectSchema = z.object({ id: z.union([z.string().regex(ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String),
  message_id: z.union([z.string().regex(ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String),
  object_type: z.string(), model_type: z.string().nullable().optional(), completed: z.boolean().optional(), object_url: z.string().optional() }).passthrough();
const rowSchema = z.object({ id: z.union([z.string().regex(ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String),
  chat_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), author_id: z.number().int(), message_object: z.array(objectSchema).max(64) }).passthrough();
const ORIGINAL_RESOLVE = OwnerTopazAstraOriginalReferenceService.prototype.resolveOriginal;
const ORIGINAL_CAPTURE = OwnerTopazAstraOriginalReferenceService.prototype.withCapturedNativeOriginal;

export class OwnerTopazAstraNativeError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "CANDIDATE_INVALID" | "CHAT_CREATE_FAILED" | "CHAT_CONTEXT_INVALID" | "CHAT_ALREADY_CREATED" |
    "CHAT_NOT_DISPATCHED" | "OUTCOME_UNKNOWN" | "HISTORY_UNAVAILABLE" | "RESULT_CONTEXT_INVALID" | "RESULT_GET_UNAVAILABLE" |
    "REQUEST_ABORTED" | "CAPACITY_EXCEEDED") {
    super("The owner Topaz Astra native operation could not be completed safely."); this.name = "OwnerTopazAstraNativeError";
  }
}

export async function createOwnerTopazAstraNativeChat(input: unknown, packet: unknown, signal?: AbortSignal): Promise<OwnerTopazAstraChatContext> {
  const inv = await consume(input, packet, "create"), client = inv.client;
  const createChat = inv.callback as (title: string, signal?: AbortSignal) => Promise<{ chat_uuid: string }>;
  const fields = readOperation(input, false);
  if (signal?.aborted) fail("REQUEST_ABORTED");
  const auth = fields;
  await assertCurrent(auth, signal);
  try { validateCandidate(fields); await fields.preparer.revalidateCandidate(fields.candidate); await revalidatePermit(fields); await assertCurrent(auth, signal); }
  catch { fail("CANDIDATE_INVALID"); }
  if (usedPermits.has(fields.permit as object) || pendingPermits.has(fields.permit as object)) fail("CHAT_ALREADY_CREATED");
  const captured = await capturedOriginal(fields);
  if (captured.client !== client) fail("CANDIDATE_INVALID");
  let chats = chatsByClient.get(client); if (!chats) { chats = new Map(); chatsByClient.set(client, chats); }
  if (chats.size >= CHAT_LIMIT) fail("CAPACITY_EXCEEDED");
  pendingPermits.add(fields.permit as object);
  usedPermits.add(fields.permit as object);
  let receipt: { chat_uuid: string };
  try { receipt = await createChat(`owner-topaz-astra-${randomUUID()}`, signal); }
  catch { pendingPermits.delete(fields.permit as object); fail("CHAT_CREATE_FAILED"); }
  if (signal?.aborted || !safeId(receipt.chat_uuid) || chats.has(receipt.chat_uuid)) { pendingPermits.delete(fields.permit as object); fail("CHAT_CREATE_FAILED"); }
  try { await assertCurrent(auth, signal); await fields.preparer.revalidateCandidate(fields.candidate); }
  catch { pendingPermits.delete(fields.permit as object); fail("CANDIDATE_INVALID"); }
  const binding = fields.preparer.inspectCandidate(fields.candidate)!;
  const chat: OwnerTopazAstraChatContext = Object.freeze({ status: "created", chat_uuid: receipt.chat_uuid, attempt_id: fields.attemptId,
    model_id: binding.model_id, profile_schema_hash: binding.profile_schema_hash,
    intent_fingerprint: binding.intent_fingerprint, request_fingerprint: binding.request_fingerprint,
    expires_at: binding.expires_at, dispatch_allowed: false, backend_acceptance: "UNPROVEN" });
  const state: NativeState = { client, input: fields, auth, chat, phase: "AVAILABLE", contexts: new Map() };
  pendingPermits.delete(fields.permit as object);
  chats.set(chat.chat_uuid, state); operations.set(chat, state); return chat;
}

export async function startOwnerTopazAstraNativeGeneration(input: unknown, packet: unknown, signal?: AbortSignal): Promise<{ chat_uuid: string; message_id: string }> {
  const inv = await consume(input, packet, "start"), client = inv.client;
  const start = inv.callback as (chatUuid: string, body: Record<string, unknown>, signal?: AbortSignal) => Promise<{ chat_uuid: string; message_id: string }>;
  const fields = readOperation(input, true), state = stateFor(client, fields.chat);
  if (state.phase !== "AVAILABLE" || !sameOperation(state.input, fields)) fail("CHAT_CONTEXT_INVALID");
  if (signal?.aborted) fail("REQUEST_ABORTED");
  let wireBody: Readonly<Record<string, unknown>>;
  try {
    validateCandidate(fields); await assertCurrent(state.auth, signal);
    const beforeBinding = fields.preparer.inspectCandidate(fields.candidate), beforeRequest = fields.preparer.getPrivateRequest(fields.candidate);
    await fields.preparer.revalidateCandidate(fields.candidate); await assertCurrent(state.auth, signal);
    const afterBinding = fields.preparer.inspectCandidate(fields.candidate), request = fields.preparer.getPrivateRequest(fields.candidate);
    if (!beforeBinding || schemaHash(beforeBinding) !== schemaHash(afterBinding) || schemaHash(beforeRequest) !== schemaHash(request) || !exactRequest(request)) fail("CANDIDATE_INVALID");
    const captured = await capturedOriginal(fields);
    if (captured.client !== client || request.settings.file_urls[0]?.url !== captured.url ||
        afterBinding!.request_fingerprint !== state.chat.request_fingerprint || afterBinding!.intent_fingerprint !== state.chat.intent_fingerprint) fail("CANDIDATE_INVALID");
    wireBody = Object.freeze({ chat_id: state.chat.chat_uuid, ...(request.prompt === undefined ? {} : { prompt: request.prompt }), settings: request.settings });
    await revalidatePermit(fields); await assertCurrent(state.auth, signal);
    consumePermit(fields);
  } catch { fail("CANDIDATE_INVALID"); }
  state.phase = "OUTCOME_UNKNOWN";
  try {
    const ack = await start(state.chat.chat_uuid, wireBody!, signal);
    if (signal?.aborted || ack.chat_uuid !== state.chat.chat_uuid || !safeId(ack.message_id)) fail("OUTCOME_UNKNOWN");
    state.ownerEcho = ack.message_id; state.phase = "ACKNOWLEDGED";
    return Object.freeze({ chat_uuid: ack.chat_uuid, message_id: ack.message_id });
  } catch { state.phase = "OUTCOME_UNKNOWN"; fail("OUTCOME_UNKNOWN"); }
}

export async function listOwnerTopazAstraNativeCandidates(input: unknown, packet: unknown, signal?: AbortSignal): Promise<OwnerTopazAstraResultCandidates> {
  const inv = await consume(input, packet, "list"), client = inv.client;
  const getPage = inv.callback as (chatUuid: string, page: number, size: number, signal?: AbortSignal) => Promise<unknown>;
  const state = stateFor(client, input);
  if (state.phase !== "ACKNOWLEDGED" && state.phase !== "OUTCOME_UNKNOWN") fail("CHAT_NOT_DISPATCHED");
  if (signal?.aborted) fail("REQUEST_ABORTED");
  const rows: z.infer<typeof rowSchema>[] = [], msgIds = new Set<string>(), objIds = new Set<string>();
  let totalCount: number | undefined, totalPages: number | undefined, providerChatId: string | undefined, calls = 0;
  try {
    for (let page = 1; page <= PAGE_LIMIT; page++) {
      await assertCurrent(state.auth, signal); calls++;
      let raw: unknown; try { raw = await getPage(state.chat.chat_uuid, page, PAGE_SIZE, signal); } finally { await assertCurrent(state.auth, signal); }
      const parsed = pageSchema.safeParse(raw); if (!parsed.success) return empty("UNVERIFIED", "UNPROVEN", calls, "HISTORY_PAGE_INVALID");
      const p = parsed.data.pagination, pages = p.total_count === 0 ? 0 : Math.ceil(p.total_count / PAGE_SIZE), expected = Math.min(PAGE_SIZE, Math.max(0, p.total_count - (page - 1) * PAGE_SIZE));
      if (p.page !== page || p.total_pages !== pages || p.has_previous !== (page > 1) || p.has_next !== (page < pages) ||
          parsed.data.messages.length !== expected || (totalCount !== undefined && (totalCount !== p.total_count || totalPages !== p.total_pages))) {
        return empty("UNVERIFIED", "UNPROVEN", calls, "HISTORY_PAGE_INCONSISTENT");
      }
      if (pages === 0) return empty("PENDING", "COMPLETE", calls, "HISTORY_EMPTY");
      totalCount ??= p.total_count; totalPages ??= p.total_pages;
      for (const rawRow of parsed.data.messages) {
        const row = rowSchema.safeParse(rawRow); if (!row.success) return empty("UNVERIFIED", "UNPROVEN", calls, "HISTORY_ROW_INVALID");
        const providerId = String(row.data.chat_id);
        if (!/^\d{1,16}$/u.test(providerId) || (providerChatId !== undefined && providerChatId !== providerId) || msgIds.has(row.data.id) ||
            row.data.message_object.some((o) => o.message_id !== row.data.id || objIds.has(o.id))) return empty("UNVERIFIED", "UNPROVEN", calls, "HISTORY_JOIN_INVALID");
        providerChatId ??= providerId; msgIds.add(row.data.id); for (const o of row.data.message_object) objIds.add(o.id); rows.push(row.data);
      }
      if (page === pages) break;
    }
  } catch { if (signal?.aborted) fail("REQUEST_ABORTED"); return empty("UNVERIFIED", "INCOMPLETE", calls, "HISTORY_UNAVAILABLE"); }
  if (rows.length !== totalCount || providerChatId === undefined) return empty("UNVERIFIED", "INCOMPLETE", calls, "HISTORY_INCOMPLETE");
  const acks = state.ownerEcho ? rows.filter((r) => r.id === state.ownerEcho && r.author_id > 0) : [];
  if (acks.length !== 1) return Object.freeze({ ...empty("INCOMPLETE", "COMPLETE", calls, state.ownerEcho ? "OWNER_ACK_MISSING" : "POST_ACK_UNKNOWN"),
    owner_ack_status: state.ownerEcho ? "MISMATCH" : "MISSING", total_count: totalCount ?? 0, total_pages: totalPages ?? 0,
    provider_chat_id: providerChatId, owner_echo_message_id: state.ownerEcho ?? null });
  const contexts: OwnerTopazAstraResultContext[] = [], gaps: string[] = [];
  for (const row of rows) {
    if (row.author_id !== BOT_AUTHOR_ID) continue;
    const vids = row.message_object.filter((o) => o.object_type === "video"); if (!vids.length) continue;
    if (vids.length !== 1 || !MODEL_SET.has(vids[0]!.model_type ?? "") || vids[0]!.model_type !== state.chat.model_id || vids[0]!.completed !== true ||
        typeof vids[0]!.object_url !== "string" || !safeR2(vids[0]!.object_url!)) { gaps.push("BOT_VIDEO_MODEL_COMPLETION_OR_OBJECT_MISMATCH"); continue; }
    const ids = Object.freeze([vids[0]!.id]);
    const codec = Object.freeze({ chat_uuid: state.chat.chat_uuid, message_id: row.id, model_id: state.chat.model_id,
      provider_chat_id: providerChatId, message_object_ids: ids });
    const context = Object.freeze({ ...codec, attempt_id: state.chat.attempt_id,
      profile_schema_hash: state.chat.profile_schema_hash, intent_fingerprint: state.chat.intent_fingerprint, owner_echo_message_id: state.ownerEcho! });
    const old = state.contexts.get(row.id); if (old && schemaHash(old) !== schemaHash(context)) return empty("UNVERIFIED", "UNPROVEN", calls, "RESULT_CONTEXT_MISMATCH");
    if (!old) { results.set(context, { client, state, context, codec }); state.contexts.set(row.id, context); }
    contexts.push(old ?? context);
  }
  return Object.freeze({ status: contexts.length ? "COMPLETE" : gaps.length ? "UNVERIFIED" : "PENDING", owner_ack_status: "MATCHED",
    history_binding_status: contexts.length ? "BOUND" : gaps.length ? "PARTIAL" : "BOUND", history_page_status: "COMPLETE", history_get_calls: calls,
    total_count: totalCount!, total_pages: totalPages!, provider_chat_id: providerChatId, owner_echo_message_id: state.ownerEcho!, contexts: Object.freeze(contexts),
    gaps: Object.freeze(gaps.length ? gaps : contexts.length ? [] : ["BOT_RESULT_NOT_OBSERVED"]), backend_acceptance: "UNPROVEN" });
}

export async function getOwnerTopazAstraNativeResult(input: unknown, packet: unknown, signal?: AbortSignal): Promise<OwnerTopazAstraResult> {
  const inv = await consume(input, packet, "get"), client = inv.client;
  const getMessage = inv.callback as (chatUuid: string, messageId: string, signal?: AbortSignal) => Promise<unknown>;
  if (!input || typeof input !== "object" || types.isProxy(input)) fail("RESULT_CONTEXT_INVALID");
  const owned = results.get(input as object);
  if (!owned || owned.client !== client || owned.context !== input || owned.state.phase !== "ACKNOWLEDGED" ||
      owned.state.ownerEcho !== owned.context.owner_echo_message_id || operations.get(owned.state.chat) !== owned.state) fail("RESULT_CONTEXT_INVALID");
  if (signal?.aborted) fail("REQUEST_ABORTED");
  await assertCurrent(owned.state.auth, signal);
  try { let raw: unknown; try { raw = await getMessage(owned.codec.chat_uuid, owned.codec.message_id, signal); } finally { await assertCurrent(owned.state.auth, signal); }
    return decodeTopazResult(raw, owned.codec);
  } catch { if (signal?.aborted) fail("REQUEST_ABORTED"); fail("RESULT_GET_UNAVAILABLE"); }
}

function stateFor(client: object, value: unknown): NativeState {
  if (!value || typeof value !== "object" || types.isProxy(value)) fail("CHAT_CONTEXT_INVALID");
  const state = operations.get(value); if (!state || state.client !== client || state.chat !== value || chatsByClient.get(client)?.get(state.chat.chat_uuid) !== state) fail("CHAT_CONTEXT_INVALID"); return state;
}
function readOperation(value: unknown, withChat: boolean): NativeInput & { readonly chat?: OwnerTopazAstraChatContext } {
  const f = exact(value, ["preparer", "candidate", "permit", "originalReferenceService", "principal", "attemptId", "linkService", "binding", ...(withChat ? ["chat"] : [])]);
  if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || !f.candidate || typeof f.candidate !== "object" || types.isProxy(f.candidate) ||
      !f.permit || typeof f.permit !== "object" || types.isProxy(f.permit)) fail("INVALID_REQUEST");
  const principal = snapshotGenerationPrincipal(f.principal as GenerationPrincipalRef), b = exact(f.binding, ["tenant_id", "subject"]);
  return Object.freeze({ preparer: f.preparer as OwnerTopazAstraOwnedRequestPreparer, candidate: f.candidate as OwnerTopazAstraOwnedPreparedCandidate,
    permit: f.permit as OwnerTopazAstraOwnedOneShotPermit, originalReferenceService: f.originalReferenceService as OwnerTopazAstraOriginalReferenceService,
    principal, attemptId: f.attemptId, linkService: f.linkService as PerUserLinkService,
    binding: Object.freeze({ tenant_id: b.tenant_id as string, subject: b.subject as string }), ...(withChat ? { chat: f.chat as OwnerTopazAstraChatContext } : {}) });
}
function validateCandidate(f: NativeInput): void {
  const b = f.preparer.inspectCandidate(f.candidate);
  if (!b || b.attempt_id !== f.attemptId || !sameGenerationPrincipal(b.principal, f.principal) ||
      f.candidate.status !== "blocked" || f.candidate.dispatch_allowed !== false || f.candidate.runtime_usable !== false || f.candidate.backend_acceptance !== "UNPROVEN" ||
      f.candidate.control_combination_status !== "SOURCE_UI_ENUMS_EXPLICIT_CONTROLS" || f.candidate.model_id !== b.model_id ||
      !MODEL_SET.has(b.model_id) || f.candidate.request_fingerprint !== b.request_fingerprint || f.candidate.intent_fingerprint !== b.intent_fingerprint ||
      f.candidate.profile_schema_hash !== b.profile_schema_hash || !sameGenerationPrincipal(f.principal, b.principal)) fail("CANDIDATE_INVALID");
}
async function capturedOriginal(f: NativeInput): Promise<Readonly<{ client: object; url: string }>> {
  const service = f.originalReferenceService;
  if (!(service instanceof OwnerTopazAstraOriginalReferenceService) || Object.getPrototypeOf(service) !== OwnerTopazAstraOriginalReferenceService.prototype ||
      getDataMethod(service, "resolveOriginal") !== ORIGINAL_RESOLVE || getDataMethod(service, "withCapturedNativeOriginal") !== ORIGINAL_CAPTURE ||
      getDataMethod(service, "isOwnedOriginalResolution") !== OwnerTopazAstraOriginalReferenceService.prototype.isOwnedOriginalResolution) fail("CANDIDATE_INVALID");
  const binding = f.preparer.inspectCandidate(f.candidate); if (!binding) fail("CANDIDATE_INVALID");
  const context = Object.freeze({ attempt_id: f.attemptId, topaz_original_handle: binding.original_handle });
  let resolution: OwnerTopazAstraOriginalResolution;
  try { resolution = await Reflect.apply(ORIGINAL_RESOLVE, service, [context]); } catch { fail("CANDIDATE_INVALID"); }
  if (resolution!.attempt_id !== f.attemptId || resolution!.topaz_original_handle !== binding.original_handle || resolution!.model_id !== binding.model_id ||
      resolution!.sha256 !== binding.original_sha256 || resolution!.size !== binding.original_size || resolution!.duration_seconds !== binding.duration_seconds ||
      resolution!.decoded_frame_count !== binding.decoded_frame_count || resolution!.profile_schema_hash !== binding.profile_schema_hash ||
      resolution!.expires_at !== binding.original_expires_at || resolution!.epoch !== binding.original_epoch ||
      !sameGenerationPrincipal(resolution!.principal, f.principal)) fail("CANDIDATE_INVALID");
  try {
    return Reflect.apply(ORIGINAL_CAPTURE, service, [resolution!, context, (client: object, reference: OwnerTopazAstraOriginalUploadContext) => {
      const upload = readOwnerTopazAstraOriginalUploadForClient(client, reference);
      if (!upload || upload.model_id !== binding.model_id || upload.source_sha256 !== binding.original_sha256 || upload.source_size !== binding.original_size ||
          upload.duration_seconds !== binding.duration_seconds || upload.decoded_frame_count !== binding.decoded_frame_count || !safeR2(upload.url)) fail("CANDIDATE_INVALID");
      return Object.freeze({ client, url: upload.url });
    }]) as Readonly<{ client: object; url: string }>;
  } catch { fail("CANDIDATE_INVALID"); }
}
function exactRequest(value: unknown): value is Readonly<{ prompt?: string; settings: Readonly<Record<string, unknown>> }> {
  try {
    const row = exact(value, ["settings"], ["prompt"]), s = exact(row.settings, ["model_type", "resolution", "frame_rate", "slowmo", "video_duration", "file_urls"], ["creativity"]);
    const url = s.resolution as Record<string, unknown>, refs = s.file_urls;
    return (row.prompt === undefined || (typeof row.prompt === "string" && row.prompt.length > 0)) && MODEL_SET.has(String(s.model_type)) &&
      !!url && typeof url === "object" && ((url.width === 1920 && url.height === 1080) || (url.width === 3840 && url.height === 2160)) &&
      Number.isSafeInteger(s.frame_rate) && [24, 30, 60, 120].includes(s.frame_rate as number) &&
      (s.slowmo === null || (Number.isSafeInteger(s.slowmo) && [2, 3, 4, 6, 8, 10, 12, 16].includes(s.slowmo as number))) &&
      Number.isSafeInteger(s.video_duration) && (s.video_duration as number) > 0 && Array.isArray(refs) && refs.length === 1 &&
      exact(refs[0], ["type", "url"]).type === "video" && typeof (refs[0] as {url?:unknown}).url === "string" && safeR2((refs[0] as {url:string}).url) &&
      ((s.model_type === "slc-1" || s.model_type === "slp-2.5") ? ["low", "middle", "high"].includes(String(s.creativity)) : !Object.hasOwn(s, "creativity"));
  } catch { return false; }
}
async function revalidatePermit(f: NativeInput): Promise<void> { const p = await import("../../application/owner-topaz-astra-owned-one-shot-policy.js");
  await p.revalidateOwnerTopazAstraOwnedOneShotPermit({ permit: f.permit, preparer: f.preparer, candidate: f.candidate, principal: f.principal, attemptId: f.attemptId }); }
function consumePermit(f: NativeInput): void { const p = requireTopazPolicy(); p.consumeOwnerTopazAstraOwnedOneShotPermit({ permit: f.permit, preparer: f.preparer, candidate: f.candidate, principal: f.principal, attemptId: f.attemptId }); }
function requireTopazPolicy(): typeof import("../../application/owner-topaz-astra-owned-one-shot-policy.js") { return topazPolicy; }
import * as topazPolicy from "../../application/owner-topaz-astra-owned-one-shot-policy.js";
async function consume(value: unknown, packet: unknown, method: "create" | "start" | "list" | "get") {
  try { const native = await import("./chat-http-client.js"); return native.consumeOwnerTopazAstraNativeInvocation(value, packet, method); }
  catch { fail("INVALID_REQUEST"); }
}
async function assertCurrent(f: NativeInput, signal?: AbortSignal): Promise<void> {
  if (signal && (types.isProxy(signal) || !(signal instanceof AbortSignal))) throw new Error("INVALID_ABORT_SIGNAL");
  if (signal?.aborted) fail("REQUEST_ABORTED");
  if (!(f.linkService instanceof PerUserLinkService) || Object.getPrototypeOf(f.linkService) !== PerUserLinkService.prototype ||
      getDataMethod(f.linkService, "getStatus") !== PerUserLinkService.prototype.getStatus) fail("CANDIDATE_INVALID");
  const current = await resolveOwnerReferencePrincipal({ binding: f.binding, attemptId: f.attemptId, linkService: f.linkService });
  if (!sameGenerationPrincipal(current, f.principal) || signal?.aborted) fail(signal?.aborted ? "REQUEST_ABORTED" : "CANDIDATE_INVALID");
}
function decodeTopazResult(raw: unknown, expected: ResultState["codec"]): OwnerTopazAstraResult {
  try {
    const message = exact(raw, ["id", "chat_id", "author_id", "message_object"], ["created_at", "updated_at", "is_favorite"]);
    if (String(message.id) !== expected.message_id || message.author_id !== BOT_AUTHOR_ID || String(message.chat_id) !== expected.provider_chat_id) {
      return Object.freeze({ message_binding: "UNVERIFIED", model_echo: "MISMATCH", ready_videos: Object.freeze([]), gaps: Object.freeze(["MESSAGE_BINDING_MISMATCH"]), backend_acceptance: "UNPROVEN" });
    }
    if (!Array.isArray(message.message_object) || message.message_object.length > 64) return Object.freeze({ message_binding: "BOUND", model_echo: "UNKNOWN", ready_videos: Object.freeze([]), gaps: Object.freeze(["MESSAGE_OBJECT_ARRAY_INVALID"]), backend_acceptance: "UNPROVEN" });
    const ready: OwnerWanT2vReadyVideo[] = [], gaps: string[] = [], ids = new Set<string>(); let modelEcho: OwnerTopazAstraResult["model_echo"] = "MATCHED";
    for (let i = 0; i < message.message_object.length; i++) {
      const object = exact(message.message_object[i], ["id", "object_type", "object_url", "completed", "model_type", "message_id"], ["object_text", "created_at", "updated_at", "task_id", "metadata"]);
      const id = String(object.id);
      if (!safeId(id) || ids.has(id)) { gaps.push("OBJECT_ID_INVALID_OR_DUPLICATE"); continue; }
      ids.add(id);
      if (!expected.message_object_ids.includes(id)) { gaps.push("OBJECT_ID_UNEXPECTED"); continue; }
      if (String(object.message_id) !== expected.message_id) { gaps.push("CHILD_MESSAGE_ID_MISMATCH"); continue; }
      if (object.object_type !== "video") { gaps.push("OBJECT_TYPE_UNSUPPORTED"); continue; }
      if (object.model_type !== expected.model_id) { modelEcho = object.model_type == null ? "UNKNOWN" : "MISMATCH"; gaps.push("MODEL_TYPE_MISMATCH"); continue; }
      if (object.completed !== true) { gaps.push("OBJECT_INCOMPLETE"); continue; }
      if (typeof object.object_url !== "string" || !safeR2(object.object_url)) { gaps.push("OBJECT_URL_UNSAFE_OR_MISSING"); continue; }
      const pathname = new URL(object.object_url).pathname, ext = /\.([A-Za-z0-9]{1,8})$/u.exec(pathname)?.[1]?.toLowerCase();
      const mime = ext === "mp4" ? "video/mp4" : ext === "mov" ? "video/quicktime" : null;
      ready.push(Object.freeze({ object_index: i, message_object_id: id, object_type: "video", object_url: object.object_url,
        mime_type: mime, mime_source: mime === null ? "UNKNOWN" : "URL_EXTENSION" }));
    }
    for (const id of expected.message_object_ids) if (!ids.has(id)) gaps.push("EXPECTED_OBJECT_ID_MISSING");
    return Object.freeze({ message_binding: "BOUND", model_echo: modelEcho, ready_videos: Object.freeze(ready), gaps: Object.freeze(gaps), backend_acceptance: "UNPROVEN" });
  } catch { return Object.freeze({ message_binding: "UNVERIFIED", model_echo: "UNKNOWN", ready_videos: Object.freeze([]), gaps: Object.freeze(["RESULT_ENVELOPE_INVALID"]), backend_acceptance: "UNPROVEN" }); }
}
function sameOperation(a: NativeInput, b: NativeInput & {chat?: OwnerTopazAstraChatContext}): boolean {
  return a.preparer === b.preparer && a.candidate === b.candidate && a.permit === b.permit && a.originalReferenceService === b.originalReferenceService && a.attemptId === b.attemptId &&
    a.linkService === b.linkService && sameGenerationPrincipal(a.principal, b.principal) && sameBinding(a.binding, b.binding);
}
function sameBinding(a: AuthBinding, b: AuthBinding): boolean { return a.tenant_id === b.tenant_id && a.subject === b.subject; }
function empty(status: OwnerTopazAstraResultCandidates["status"], page: OwnerTopazAstraResultCandidates["history_page_status"], calls: number, gap: string): OwnerTopazAstraResultCandidates {
  return Object.freeze({ status, owner_ack_status: "MISSING", history_binding_status: "UNVERIFIED", history_page_status: page, history_get_calls: calls,
    total_count: null, total_pages: null, provider_chat_id: null, owner_echo_message_id: null, contexts: Object.freeze([]), gaps: Object.freeze([gap]), backend_acceptance: "UNPROVEN" });
}
function safeId(value: unknown): value is string { return typeof value === "string" && ID.test(value); }
function safeR2(value: string): boolean { try { const u = new URL(value); return u.protocol === "https:" && u.hostname === "r2.syntx.ai" && !u.port && !u.username && !u.password && !u.hash; } catch { return false; } }
function exact(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new TypeError("INVALID_SHAPE");
  const proto = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(descriptors), allowed = new Set([...keys, ...optional]);
  if ((proto !== Object.prototype && proto !== null) || keys.some((key) => !Object.hasOwn(descriptors, key)) || actual.some((key) => typeof key !== "string" || !allowed.has(key) ||
      !descriptors[key]!.enumerable || !("value" in descriptors[key]!))) throw new TypeError("INVALID_SHAPE");
  const out = Object.create(null) as Record<string, any>; for (const key of actual as string[]) out[key] = descriptors[key]!.value; return out;
}
function getDataMethod(target: object, key: string): unknown { let current: object | null = target; while (current) { const d = Object.getOwnPropertyDescriptor(current, key); if (d) return "value" in d ? d.value : undefined; current = Object.getPrototypeOf(current) as object | null; } return undefined; }
function fail(code: ConstructorParameters<typeof OwnerTopazAstraNativeError>[0]): never { throw new OwnerTopazAstraNativeError(code); }
