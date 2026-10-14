import { types } from "node:util";
import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import type { AuthBinding } from "../../auth/types.js";
import { PerUserLinkService } from "../../auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../../domain/generation-principal.js";
import { schemaHash } from "../../domain/generation-contract.js";
import {
  isOwnerHailuo02I2vRequestPreparer,
  type OwnerHailuo02I2vPreparedCandidate,
  type OwnerHailuo02I2vPreparedRequest,
  type OwnerHailuo02I2vRequestPreparer
} from "../../application/owner-hailuo02-i2v-request-preparer.js";
import {
  consumeOwnerHailuo02I2vOneShotPermit,
  revalidateOwnerHailuo02I2vOneShotPermit,
  type OwnerHailuo02I2vOneShotPermit
} from "../../application/owner-hailuo02-i2v-one-shot-policy.js";
import {
  OwnerHailuo02I2vImageReferenceService,
  type OwnerHailuo02I2vImageReferenceService as HailuoImageService,
  type OwnerHailuo02I2vImageResolution
} from "../../application/owner-hailuo02-i2v-image-reference-service.js";
import { SyntxChatHttpClient } from "./chat-http-client.js";
import { readOwnerHailuo02I2vUploadReferenceForClient } from "./hailuo02-i2v-upload-context.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const PAGE_SIZE = 10, PAGE_LIMIT = 7, MESSAGE_LIMIT = PAGE_SIZE * PAGE_LIMIT, BOT_AUTHOR_ID = -1;
const chats = new WeakMap<object, Map<string, NativeState>>();
const operations = new WeakMap<object, NativeState>();
const resultContexts = new WeakMap<object, ResultState>();
const reservedCandidates = new WeakSet<object>();
const usedPermits = new WeakSet<object>();
const pendingPermits = new WeakSet<object>();
const RESOLVE = OwnerHailuo02I2vImageReferenceService.prototype.resolveReference;
const CAPTURE = OwnerHailuo02I2vImageReferenceService.prototype.withCapturedNativeImage;
const OWNED = OwnerHailuo02I2vImageReferenceService.prototype.isOwnedResolution;

export interface OwnerHailuo02I2vNativeOperationInput {
  readonly preparer: OwnerHailuo02I2vRequestPreparer;
  readonly candidate: OwnerHailuo02I2vPreparedCandidate;
  readonly permit: OwnerHailuo02I2vOneShotPermit;
  readonly imageReferenceService: HailuoImageService;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly linkService: PerUserLinkService;
  readonly binding: AuthBinding;
}
export interface OwnerHailuo02I2vChatContext {
  readonly status: "created"; readonly chat_uuid: string; readonly attempt_id: string;
  readonly model_id: "hailuo-02"; readonly profile_schema_hash: string;
  readonly intent_fingerprint: string; readonly request_fingerprint: string; readonly expires_at: number;
  readonly dispatch_allowed: false; readonly backend_acceptance: "UNPROVEN";
}
export interface OwnerHailuo02I2vResultContext {
  readonly chat_uuid: string; readonly message_id: string; readonly model_id: "hailuo-02";
  readonly provider_chat_id: string; readonly message_object_ids: readonly string[];
  readonly attempt_id: string; readonly profile_schema_hash: string; readonly intent_fingerprint: string;
  readonly owner_echo_message_id: string;
}
export interface OwnerHailuo02I2vResultCandidates {
  readonly status: "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  readonly history_binding_status: "BOUND" | "PARTIAL" | "UNVERIFIED";
  readonly history_page_status: "NOT_READ" | "COMPLETE" | "INCOMPLETE" | "UNPROVEN";
  readonly history_get_calls: number; readonly total_count: number | null; readonly total_pages: number | null;
  readonly provider_chat_id: string | null; readonly owner_echo_message_id: string | null;
  readonly contexts: readonly OwnerHailuo02I2vResultContext[]; readonly gaps: readonly string[];
  readonly backend_acceptance: "UNPROVEN";
}
export interface OwnerHailuo02I2vResult {
  readonly message_binding: "BOUND" | "UNVERIFIED"; readonly model_echo: "MATCHED" | "UNKNOWN" | "MISMATCH";
  readonly ready_videos: readonly Readonly<{ object_index: number; message_object_id: string; object_type: "video";
    object_url: string; mime_type: "video/mp4" | "video/quicktime" | null; mime_source: "URL_EXTENSION" | "UNKNOWN" }>[];
  readonly gaps: readonly string[]; readonly backend_acceptance: "UNPROVEN";
}
export type OwnerHailuo02I2vNativeErrorCode = "INVALID_REQUEST" | "CANDIDATE_INVALID" | "CHAT_CREATE_FAILED" | "CHAT_CONTEXT_INVALID" |
  "CHAT_ALREADY_CREATED" | "CHAT_NOT_DISPATCHED" | "OUTCOME_UNKNOWN" | "HISTORY_UNAVAILABLE" | "RESULT_CONTEXT_INVALID" |
  "RESULT_GET_UNAVAILABLE" | "REQUEST_ABORTED" | "CAPACITY_EXCEEDED";
export class OwnerHailuo02I2vNativeError extends Error {
  constructor(readonly code: OwnerHailuo02I2vNativeErrorCode) {
    super("The owner Hailuo-02 I2V native operation could not be completed safely.");
    this.name = "OwnerHailuo02I2vNativeError";
  }
}

type NativeInput = Readonly<OwnerHailuo02I2vNativeOperationInput & { principal: Readonly<GenerationPrincipalRef>; binding: Readonly<AuthBinding> }>;
interface NativeState {
  readonly client: SyntxChatHttpClient; readonly input: NativeInput; readonly chat: OwnerHailuo02I2vChatContext;
  phase: "AVAILABLE" | "OUTCOME_UNKNOWN" | "ACKNOWLEDGED"; ownerEcho?: string;
  readonly contexts: Map<string, OwnerHailuo02I2vResultContext>;
}
interface Codec { readonly chat_uuid: string; readonly message_id: string; readonly model_id: "hailuo-02";
  readonly provider_chat_id: string; readonly message_object_ids: readonly string[] }
interface ResultState { readonly client: SyntxChatHttpClient; readonly state: NativeState;
  readonly context: OwnerHailuo02I2vResultContext; readonly codec: Codec }

const idValue = z.union([z.string().regex(ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String);
const pageSchema = z.object({ messages: z.array(z.unknown()).max(PAGE_SIZE), pagination: z.object({
  page: z.number().int().min(1).max(PAGE_LIMIT), page_size: z.literal(PAGE_SIZE), total_count: z.number().int().min(0).max(MESSAGE_LIMIT),
  total_pages: z.number().int().min(0).max(PAGE_LIMIT), has_next: z.boolean(), has_previous: z.boolean()
}).passthrough() }).passthrough();
const objectSchema = z.object({ id: idValue, message_id: idValue, object_type: z.string(), model_type: z.string().nullable().optional(),
  completed: z.boolean().optional(), object_url: z.string().optional() }).passthrough();
const rowSchema = z.object({ id: idValue, chat_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  author_id: z.number().int(), message_object: z.array(objectSchema).max(64) }).passthrough();

export async function createOwnerHailuo02I2vChat(input: unknown, packet: unknown, signal?: AbortSignal): Promise<OwnerHailuo02I2vChatContext> {
  const { client, callback } = await consume(input, packet, "create");
  const createChat = callback as (title: string, signal?: AbortSignal) => Promise<{ chat_uuid: string }>;
  const fields = readOperation(input, false);
  if (signal?.aborted) fail("REQUEST_ABORTED");
  await assertCurrent(fields, signal);
  try {
    validateCandidate(fields);
    await fields.preparer.revalidateCandidate(fields.candidate);
    await revalidatePermit(fields);
    await assertCurrent(fields, signal);
  } catch { fail("CANDIDATE_INVALID"); }
  if (reservedCandidates.has(fields.candidate as object) || usedPermits.has(fields.permit as object) || pendingPermits.has(fields.permit as object)) fail("CHAT_ALREADY_CREATED");
  const captured = await captureImage(fields);
  if (captured.client !== client) fail("CANDIDATE_INVALID");
  const perClient = chats.get(client) ?? new Map<string, NativeState>();
  if (perClient.size >= 128) fail("CAPACITY_EXCEEDED");
  reservedCandidates.add(fields.candidate as object); pendingPermits.add(fields.permit as object);
  let receipt: { chat_uuid: string };
  try { receipt = await createChat(`owner-hailuo02-i2v-${randomUUID()}`, signal); }
  catch { pendingPermits.delete(fields.permit as object); fail("CHAT_CREATE_FAILED"); }
  if (signal?.aborted || !safeId(receipt.chat_uuid) || perClient.has(receipt.chat_uuid)) { pendingPermits.delete(fields.permit as object); fail("CHAT_CREATE_FAILED"); }
  try {
    await assertCurrent(fields, signal); await fields.preparer.revalidateCandidate(fields.candidate);
    const afterCapture = await captureImage(fields);
    if (afterCapture.client !== client || afterCapture.url !== captured.url) fail("CANDIDATE_INVALID");
  }
  catch { pendingPermits.delete(fields.permit as object); fail("CANDIDATE_INVALID"); }
  const binding = fields.preparer.inspectCandidate(fields.candidate)!;
  const chat: OwnerHailuo02I2vChatContext = Object.freeze({ status: "created", chat_uuid: receipt.chat_uuid, attempt_id: fields.attemptId,
    model_id: "hailuo-02", profile_schema_hash: binding.profile_schema_hash, intent_fingerprint: binding.intent_fingerprint,
    request_fingerprint: binding.request_fingerprint, expires_at: binding.expires_at, dispatch_allowed: false, backend_acceptance: "UNPROVEN" });
  const state: NativeState = { client, input: fields, chat, phase: "AVAILABLE", contexts: new Map() };
  pendingPermits.delete(fields.permit as object); usedPermits.add(fields.permit as object); perClient.set(chat.chat_uuid, state); operations.set(chat, state);
  chats.set(client, perClient); operations.set(chat, state); return chat;
}

export async function startOwnerHailuo02I2vWithOwnedCandidate(input: unknown, packet: unknown, signal?: AbortSignal): Promise<{ chat_uuid: string; message_id: string }> {
  const { client, callback } = await consume(input, packet, "start");
  const start = callback as (chatUuid: string, body: Record<string, unknown>, signal?: AbortSignal) => Promise<{ chat_uuid: string; message_id: string }>;
  const fields = readOperation(input, true), state = stateFor(client, fields.chat);
  if (state.phase !== "AVAILABLE" || !sameOperation(state.input, fields)) fail("CHAT_CONTEXT_INVALID");
  if (signal?.aborted) fail("REQUEST_ABORTED");
  let body: Record<string, unknown>;
  try {
    validateCandidate(fields); await assertCurrent(state.input, signal);
    const beforeBinding = fields.preparer.inspectCandidate(fields.candidate), beforeRequest = fields.preparer.getPrivateRequest(fields.candidate);
    await fields.preparer.revalidateCandidate(fields.candidate); await assertCurrent(state.input, signal);
    const afterBinding = fields.preparer.inspectCandidate(fields.candidate), prepared = fields.preparer.getPrivateRequest(fields.candidate);
    if (!beforeBinding || !afterBinding || schemaHash(beforeBinding) !== schemaHash(afterBinding) || schemaHash(beforeRequest) !== schemaHash(prepared) ||
        !exactRequest(prepared) || afterBinding.request_fingerprint !== state.chat.request_fingerprint || afterBinding.intent_fingerprint !== state.chat.intent_fingerprint) fail("CANDIDATE_INVALID");
    const captured = await captureImage(fields);
    if (captured.client !== client || prepared.settings.file_urls[0]?.url !== captured.url) fail("CANDIDATE_INVALID");
    await revalidatePermit(fields); await assertCurrent(state.input, signal);
    const receipt = consumeOwnerHailuo02I2vOneShotPermit({ permit: fields.permit, preparer: fields.preparer,
      candidate: fields.candidate, principal: fields.principal, attemptId: fields.attemptId });
    if (receipt.request_fingerprint !== state.chat.request_fingerprint || schemaHash(receipt.request) !== schemaHash(prepared)) fail("CANDIDATE_INVALID");
    body = { chat_id: state.chat.chat_uuid, prompt: receipt.request.prompt, settings: receipt.request.settings };
  } catch { fail("CANDIDATE_INVALID"); }
  state.phase = "OUTCOME_UNKNOWN";
  try {
    const ack = await start(state.chat.chat_uuid, body!, signal);
    if (signal?.aborted || ack.chat_uuid !== state.chat.chat_uuid || !safeId(ack.message_id)) fail("OUTCOME_UNKNOWN");
    state.ownerEcho = ack.message_id; state.phase = "ACKNOWLEDGED"; return Object.freeze({ chat_uuid: ack.chat_uuid, message_id: ack.message_id });
  } catch { state.phase = "OUTCOME_UNKNOWN"; fail("OUTCOME_UNKNOWN"); }
}

export async function listOwnerHailuo02I2vCandidates(input: unknown, packet: unknown, signal?: AbortSignal): Promise<OwnerHailuo02I2vResultCandidates> {
  const { client, callback } = await consume(input, packet, "list");
  const getPage = callback as (chatUuid: string, page: number, size: number, signal?: AbortSignal) => Promise<unknown>;
  const state = stateFor(client, input);
  if (state.phase !== "ACKNOWLEDGED" && state.phase !== "OUTCOME_UNKNOWN") fail("CHAT_NOT_DISPATCHED");
  if (signal?.aborted) fail("REQUEST_ABORTED");
  const rows: z.infer<typeof rowSchema>[] = [], messageIds = new Set<string>(), objectIds = new Set<string>();
  let totalCount: number | undefined, totalPages: number | undefined, providerChatId: string | undefined, calls = 0;
  try {
    for (let page = 1; page <= PAGE_LIMIT; page++) {
      await assertCurrent(state.input, signal); calls++;
      let raw: unknown; try { raw = await getPage(state.chat.chat_uuid, page, PAGE_SIZE, signal); } finally { await assertCurrent(state.input, signal); }
      const parsed = pageSchema.safeParse(raw); if (!parsed.success) return empty("UNVERIFIED", "UNPROVEN", calls, "HISTORY_PAGE_INVALID");
      const p = parsed.data.pagination, pages = p.total_count === 0 ? 0 : Math.ceil(p.total_count / PAGE_SIZE);
      const expected = Math.min(PAGE_SIZE, Math.max(0, p.total_count - (page - 1) * PAGE_SIZE));
      if (p.page !== page || p.total_pages !== pages || p.has_previous !== (page > 1) || p.has_next !== (page < pages) ||
          parsed.data.messages.length !== expected || (totalCount !== undefined && (totalCount !== p.total_count || totalPages !== p.total_pages))) {
        return empty("UNVERIFIED", "UNPROVEN", calls, "HISTORY_PAGE_INCONSISTENT");
      }
      if (pages === 0) return empty("PENDING", "COMPLETE", calls, "HISTORY_EMPTY");
      totalCount ??= p.total_count; totalPages ??= p.total_pages;
      for (const rawRow of parsed.data.messages) {
        const row = rowSchema.safeParse(rawRow); if (!row.success) return empty("UNVERIFIED", "UNPROVEN", calls, "HISTORY_ROW_INVALID");
        const chatId = String(row.data.chat_id);
        if (!/^\d{1,16}$/u.test(chatId) || (providerChatId !== undefined && providerChatId !== chatId) || messageIds.has(row.data.id) ||
            row.data.message_object.some((o) => o.message_id !== row.data.id || objectIds.has(o.id))) return empty("UNVERIFIED", "UNPROVEN", calls, "HISTORY_JOIN_INVALID");
        providerChatId ??= chatId; messageIds.add(row.data.id); for (const object of row.data.message_object) objectIds.add(object.id); rows.push(row.data);
      }
      if (page === pages) break;
    }
  } catch { if (signal?.aborted) fail("REQUEST_ABORTED"); return empty("UNVERIFIED", "INCOMPLETE", calls, "HISTORY_UNAVAILABLE"); }
  if (rows.length !== totalCount || providerChatId === undefined) return empty("UNVERIFIED", "INCOMPLETE", calls, "HISTORY_INCOMPLETE");
  const acks = state.ownerEcho ? rows.filter((r) => r.id === state.ownerEcho && r.author_id > 0) : [];
  if (acks.length !== 1) return Object.freeze({ ...empty("INCOMPLETE", "COMPLETE", calls, state.ownerEcho ? "OWNER_ACK_MISSING" : "POST_ACK_UNKNOWN"),
    owner_ack_status: state.ownerEcho ? "MISMATCH" : "MISSING", total_count: totalCount ?? 0, total_pages: totalPages ?? 0,
    provider_chat_id: providerChatId, owner_echo_message_id: state.ownerEcho ?? null });
  const contexts: OwnerHailuo02I2vResultContext[] = [], gaps: string[] = [];
  for (const row of rows) {
    if (row.author_id !== BOT_AUTHOR_ID) continue;
    const videos = row.message_object.filter((o) => o.object_type === "video"); if (!videos.length) continue;
    if (videos.length !== 1 || videos[0]!.model_type !== "hailuo-02" || videos[0]!.completed !== true ||
        typeof videos[0]!.object_url !== "string" || !safeR2(videos[0]!.object_url!)) { gaps.push("BOT_VIDEO_MODEL_COMPLETION_OR_OBJECT_MISMATCH"); continue; }
    const ids = Object.freeze([videos[0]!.id]), codec: Codec = Object.freeze({ chat_uuid: state.chat.chat_uuid, message_id: row.id,
      model_id: "hailuo-02", provider_chat_id: providerChatId, message_object_ids: ids });
    const context = Object.freeze({ ...codec, attempt_id: state.chat.attempt_id, profile_schema_hash: state.chat.profile_schema_hash,
      intent_fingerprint: state.chat.intent_fingerprint, owner_echo_message_id: state.ownerEcho! });
    const old = state.contexts.get(row.id); if (old && schemaHash(old) !== schemaHash(context)) return empty("UNVERIFIED", "UNPROVEN", calls, "RESULT_CONTEXT_MISMATCH");
    if (!old) { resultContexts.set(context, { client, state, context, codec }); state.contexts.set(row.id, context); }
    contexts.push(old ?? context);
  }
  return Object.freeze({ status: contexts.length ? "COMPLETE" : gaps.length ? "UNVERIFIED" : "PENDING", owner_ack_status: "MATCHED",
    history_binding_status: contexts.length ? "BOUND" : gaps.length ? "PARTIAL" : "BOUND", history_page_status: "COMPLETE", history_get_calls: calls,
    total_count: totalCount!, total_pages: totalPages!, provider_chat_id: providerChatId, owner_echo_message_id: state.ownerEcho!,
    contexts: Object.freeze(contexts), gaps: Object.freeze(gaps.length ? gaps : contexts.length ? [] : ["BOT_RESULT_NOT_OBSERVED"]), backend_acceptance: "UNPROVEN" });
}

export async function getOwnerHailuo02I2vResult(input: unknown, packet: unknown, signal?: AbortSignal): Promise<OwnerHailuo02I2vResult> {
  const { client, callback } = await consume(input, packet, "get");
  const getMessage = callback as (chatUuid: string, messageId: string, signal?: AbortSignal) => Promise<unknown>;
  if (!input || typeof input !== "object" || types.isProxy(input)) fail("RESULT_CONTEXT_INVALID");
  const owned = resultContexts.get(input as object);
  if (!owned || owned.client !== client || owned.context !== input || owned.state.phase !== "ACKNOWLEDGED" ||
      owned.state.ownerEcho !== owned.context.owner_echo_message_id || operations.get(owned.state.chat) !== owned.state) fail("RESULT_CONTEXT_INVALID");
  if (signal?.aborted) fail("REQUEST_ABORTED"); await assertCurrent(owned.state.input, signal);
  try {
    let raw: unknown; try { raw = await getMessage(owned.codec.chat_uuid, owned.codec.message_id, signal); } finally { await assertCurrent(owned.state.input, signal); }
    return decodeResult(raw, owned.codec);
  } catch { if (signal?.aborted) fail("REQUEST_ABORTED"); fail("RESULT_GET_UNAVAILABLE"); }
}

function stateFor(client: SyntxChatHttpClient, value: unknown): NativeState {
  if (!value || typeof value !== "object" || types.isProxy(value)) fail("CHAT_CONTEXT_INVALID");
  const state = operations.get(value);
  if (!state || state.client !== client || state.chat !== value || chats.get(client)?.get(state.chat.chat_uuid) !== state) fail("CHAT_CONTEXT_INVALID");
  return state;
}
function readOperation(value: unknown, withChat: boolean): NativeInput & { readonly chat?: OwnerHailuo02I2vChatContext } {
  const f = exact(value, ["preparer", "candidate", "permit", "imageReferenceService", "principal", "attemptId", "linkService", "binding", ...(withChat ? ["chat"] : [])]);
  if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || !f.candidate || typeof f.candidate !== "object" || types.isProxy(f.candidate) ||
      !f.permit || typeof f.permit !== "object" || types.isProxy(f.permit)) fail("INVALID_REQUEST");
  const principal = snapshotGenerationPrincipal(f.principal as GenerationPrincipalRef), b = exact(f.binding, ["tenant_id", "subject"]);
  return Object.freeze({ preparer: f.preparer as OwnerHailuo02I2vRequestPreparer, candidate: f.candidate as OwnerHailuo02I2vPreparedCandidate,
    permit: f.permit as OwnerHailuo02I2vOneShotPermit, imageReferenceService: f.imageReferenceService as HailuoImageService,
    principal, attemptId: f.attemptId, linkService: f.linkService as PerUserLinkService,
    binding: Object.freeze({ tenant_id: b.tenant_id as string, subject: b.subject as string }), ...(withChat ? { chat: f.chat as OwnerHailuo02I2vChatContext } : {}) });
}
function validateCandidate(fields: NativeInput): void {
  if (!isOwnerHailuo02I2vRequestPreparer(fields.preparer)) fail("CANDIDATE_INVALID");
  const binding = fields.preparer.inspectCandidate(fields.candidate);
  if (!binding || binding.attempt_id !== fields.attemptId || !sameGenerationPrincipal(binding.principal, fields.principal) ||
      fields.candidate.status !== "blocked" || fields.candidate.dispatch_allowed !== false || fields.candidate.runtime_usable !== false ||
      fields.candidate.backend_acceptance !== "UNPROVEN" || fields.candidate.model_id !== "hailuo-02" ||
      fields.candidate.request_fingerprint !== binding.request_fingerprint || fields.candidate.intent_fingerprint !== binding.intent_fingerprint ||
      fields.candidate.profile_schema_hash !== binding.profile_schema_hash || fields.candidate.expires_at !== binding.expires_at ||
      fields.candidate.image.sha256 !== binding.image_sha256 || schemaHash(fields.candidate.source_binding) !== schemaHash(binding.source_binding)) fail("CANDIDATE_INVALID");
}
async function captureImage(fields: NativeInput): Promise<Readonly<{ client: SyntxChatHttpClient; url: string }>> {
  const service = fields.imageReferenceService;
  if (!(service instanceof OwnerHailuo02I2vImageReferenceService) || Object.getPrototypeOf(service) !== OwnerHailuo02I2vImageReferenceService.prototype ||
      getDataMethod(service, "resolveReference") !== RESOLVE || getDataMethod(service, "withCapturedNativeImage") !== CAPTURE || getDataMethod(service, "isOwnedResolution") !== OWNED) fail("CANDIDATE_INVALID");
  const binding = fields.preparer.inspectCandidate(fields.candidate); if (!binding) fail("CANDIDATE_INVALID");
  const resolveInput = Object.freeze({ attempt_id: fields.attemptId, image_handle: binding.image_handle });
  let resolution: OwnerHailuo02I2vImageResolution;
  try { resolution = await Reflect.apply(RESOLVE, service, [resolveInput]); } catch { fail("CANDIDATE_INVALID"); }
  if (!service.isOwnedResolution(resolution!, resolveInput) || resolution!.attempt_id !== fields.attemptId || resolution!.image_handle !== binding.image_handle ||
      resolution!.sha256 !== binding.image_sha256 || resolution!.epoch !== binding.image_epoch || resolution!.expires_at !== binding.image_expires_at ||
      !sameGenerationPrincipal(resolution!.principal, fields.principal)) fail("CANDIDATE_INVALID");
  try {
    return Reflect.apply(CAPTURE, service, [resolution!, resolveInput, (client: SyntxChatHttpClient, reference: unknown) => {
      const upload = readOwnerHailuo02I2vUploadReferenceForClient(client, reference);
      if (!upload || !safeR2(upload.url)) fail("CANDIDATE_INVALID");
      return Object.freeze({ client, url: upload.url });
    }]) as Readonly<{ client: SyntxChatHttpClient; url: string }>;
  } catch { fail("CANDIDATE_INVALID"); }
}
function exactRequest(value: unknown): value is OwnerHailuo02I2vPreparedRequest {
  try {
    const row = exact(value, ["prompt", "settings"]), settings = exact(row.settings, ["model_type", "resolution", "video_duration", "file_urls"]), refs = settings.file_urls;
    return typeof row.prompt === "string" && row.prompt.length > 0 && settings.model_type === "hailuo-02" &&
      typeof settings.resolution === "string" && Number.isSafeInteger(settings.video_duration) && (settings.video_duration as number) > 0 &&
      Array.isArray(refs) && refs.length === 1 && exact(refs[0], ["type", "url"]).type === "image" &&
      typeof (refs[0] as {url?:unknown}).url === "string" && safeR2((refs[0] as {url:string}).url) && !Object.hasOwn(settings, "n");
  } catch { return false; }
}
async function revalidatePermit(fields: NativeInput): Promise<void> {
  await revalidateOwnerHailuo02I2vOneShotPermit({ permit: fields.permit, preparer: fields.preparer, candidate: fields.candidate,
    principal: fields.principal, attemptId: fields.attemptId });
}
async function consume(value: unknown, packet: unknown, method: "create" | "start" | "list" | "get") {
  try { const native = await import("./chat-http-client.js"); return native.consumeOwnerHailuo02I2vNativeInvocation(value, packet, method); }
  catch { fail("INVALID_REQUEST"); }
}
async function assertCurrent(fields: NativeInput, signal?: AbortSignal): Promise<void> {
  if (signal && (types.isProxy(signal) || !(signal instanceof AbortSignal))) throw new Error("INVALID_ABORT_SIGNAL");
  if (signal?.aborted) fail("REQUEST_ABORTED");
  if (!(fields.linkService instanceof PerUserLinkService) || Object.getPrototypeOf(fields.linkService) !== PerUserLinkService.prototype ||
      getDataMethod(fields.linkService, "getStatus") !== PerUserLinkService.prototype.getStatus) fail("CANDIDATE_INVALID");
  const current = await resolveOwnerReferencePrincipal({ binding: fields.binding, attemptId: fields.attemptId, linkService: fields.linkService });
  if (!sameGenerationPrincipal(current, fields.principal) || signal?.aborted) fail(signal?.aborted ? "REQUEST_ABORTED" : "CANDIDATE_INVALID");
}
function decodeResult(raw: unknown, expected: Codec): OwnerHailuo02I2vResult {
  try {
    const message = exact(raw, ["id", "chat_id", "author_id", "message_object"], ["created_at", "updated_at", "is_favorite"]);
    if (String(message.id) !== expected.message_id || message.author_id !== BOT_AUTHOR_ID || String(message.chat_id) !== expected.provider_chat_id) {
      return result("UNVERIFIED", "MISMATCH", [], ["MESSAGE_BINDING_MISMATCH"]);
    }
    if (!Array.isArray(message.message_object) || message.message_object.length > 64) return result("BOUND", "UNKNOWN", [], ["MESSAGE_OBJECT_ARRAY_INVALID"]);
    const videos: OwnerHailuo02I2vResult["ready_videos"][number][] = [], gaps: string[] = [], ids = new Set<string>(); let model: OwnerHailuo02I2vResult["model_echo"] = "MATCHED";
    for (let i = 0; i < message.message_object.length; i++) {
      const object = exact(message.message_object[i], ["id", "object_type", "object_url", "completed", "model_type", "message_id"],
        ["object_text", "created_at", "updated_at", "task_id", "metadata"]), id = String(object.id);
      if (!safeId(id) || ids.has(id)) { gaps.push("OBJECT_ID_INVALID_OR_DUPLICATE"); continue; } ids.add(id);
      if (!expected.message_object_ids.includes(id)) { gaps.push("OBJECT_ID_UNEXPECTED"); continue; }
      if (String(object.message_id) !== expected.message_id) { gaps.push("CHILD_MESSAGE_ID_MISMATCH"); continue; }
      if (object.object_type !== "video") { gaps.push("OBJECT_TYPE_UNSUPPORTED"); continue; }
      if (object.model_type !== "hailuo-02") { model = object.model_type == null ? "UNKNOWN" : "MISMATCH"; gaps.push("MODEL_TYPE_MISMATCH"); continue; }
      if (object.completed !== true) { gaps.push("OBJECT_INCOMPLETE"); continue; }
      if (typeof object.object_url !== "string" || !safeR2(object.object_url)) { gaps.push("OBJECT_URL_UNSAFE_OR_MISSING"); continue; }
      const ext = /\.([A-Za-z0-9]{1,8})$/u.exec(new URL(object.object_url).pathname)?.[1]?.toLowerCase();
      const mime = ext === "mp4" ? "video/mp4" : ext === "mov" ? "video/quicktime" : null;
      videos.push(Object.freeze({ object_index: i, message_object_id: id, object_type: "video", object_url: object.object_url,
        mime_type: mime, mime_source: mime ? "URL_EXTENSION" : "UNKNOWN" }));
    }
    for (const id of expected.message_object_ids) if (!ids.has(id)) gaps.push("EXPECTED_OBJECT_ID_MISSING");
    return result("BOUND", model, videos, gaps);
  } catch { return result("UNVERIFIED", "UNKNOWN", [], ["RESULT_ENVELOPE_INVALID"]); }
}
function result(binding: OwnerHailuo02I2vResult["message_binding"], model: OwnerHailuo02I2vResult["model_echo"], videos: OwnerHailuo02I2vResult["ready_videos"], gaps: readonly string[]): OwnerHailuo02I2vResult {
  return Object.freeze({ message_binding: binding, model_echo: model, ready_videos: Object.freeze(videos), gaps: Object.freeze([...gaps]), backend_acceptance: "UNPROVEN" });
}
function sameOperation(a: NativeInput, b: NativeInput & { chat?: OwnerHailuo02I2vChatContext }): boolean {
  return a.preparer === b.preparer && a.candidate === b.candidate && a.permit === b.permit && a.imageReferenceService === b.imageReferenceService &&
    a.attemptId === b.attemptId && a.linkService === b.linkService && sameGenerationPrincipal(a.principal, b.principal) && sameBinding(a.binding, b.binding);
}
function sameBinding(a: AuthBinding, b: AuthBinding): boolean { return a.tenant_id === b.tenant_id && a.subject === b.subject; }
function empty(status: OwnerHailuo02I2vResultCandidates["status"], page: OwnerHailuo02I2vResultCandidates["history_page_status"], calls: number, gap: string): OwnerHailuo02I2vResultCandidates {
  return Object.freeze({ status, owner_ack_status: "MISSING", history_binding_status: "UNVERIFIED", history_page_status: page, history_get_calls: calls,
    total_count: null, total_pages: null, provider_chat_id: null, owner_echo_message_id: null, contexts: Object.freeze([]), gaps: Object.freeze([gap]), backend_acceptance: "UNPROVEN" });
}
function safeId(value: unknown): value is string { return typeof value === "string" && ID.test(value); }
function safeR2(value: string): boolean { try { const u = new URL(value); return u.protocol === "https:" && u.hostname === "r2.syntx.ai" && !u.port && !u.username && !u.password && !u.hash; } catch { return false; } }
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new TypeError("INVALID_SHAPE");
  const proto = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(descriptors), allowed = new Set([...required, ...optional]);
  if ((proto !== Object.prototype && proto !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) || actual.some((key) => typeof key !== "string" || !allowed.has(key) ||
      !descriptors[key]!.enumerable || !("value" in descriptors[key]!))) throw new TypeError("INVALID_SHAPE");
  const out = Object.create(null) as Record<string, any>; for (const key of actual as string[]) out[key] = descriptors[key]!.value; return out;
}
function getDataMethod(target: object, key: string): unknown { let current: object | null = target; while (current) { const d = Object.getOwnPropertyDescriptor(current, key); if (d) return "value" in d ? d.value : undefined; current = Object.getPrototypeOf(current) as object | null; } return undefined; }
function fail(code: OwnerHailuo02I2vNativeErrorCode): never { throw new OwnerHailuo02I2vNativeError(code); }
