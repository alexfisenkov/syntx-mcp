import { types } from "node:util";
import { z } from "zod/v4";
import type { AuthBinding } from "../../auth/types.js";
import { PerUserLinkService } from "../../auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../../domain/generation-principal.js";
import type { OwnerTopazAstraResult } from "./owner-topaz-astra-native-context.js";

const MODELS = new Set(["slc-1", "slf-2", "slp-2", "slp-2.5"]);
const PAGE_SIZE = 20, HISTORY_PAGE_SIZE = 10, MAX_HISTORY_PAGES = 7, MAX_MESSAGES = 64, MAX_CONTEXTS = 128;
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface OwnerTopazAstraExistingIndexInput {
  readonly attemptId: string; readonly principal: GenerationPrincipalRef; readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService; readonly page: number;
}
export interface OwnerTopazAstraExistingChatContext {
  readonly source_kind: "EXISTING_OWNER_TOPAZ_ASTRA_CHAT"; readonly chat_uuid: string; readonly provider_chat_id: string;
  readonly index_page: number; readonly attempt_id: string; readonly principal: Readonly<GenerationPrincipalRef>;
}
export interface OwnerTopazAstraExistingChatPage {
  readonly page: number; readonly page_size: typeof PAGE_SIZE; readonly total_count: number; readonly total_pages: number;
  readonly has_next: boolean; readonly has_previous: boolean; readonly chats: readonly OwnerTopazAstraExistingChatContext[];
}
export interface OwnerTopazAstraExistingResultContext {
  readonly source_kind: "EXISTING_OWNER_TOPAZ_ASTRA_RESULT"; readonly chat_uuid: string; readonly message_id: string;
  readonly model_id: "slc-1" | "slf-2" | "slp-2" | "slp-2.5"; readonly provider_chat_id: string;
  readonly message_object_ids: readonly [string]; readonly owner_echo_message_id: string; readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>; readonly provenance: "NOT_AVAILABLE";
}
export interface OwnerTopazAstraExistingCandidates {
  readonly status: "COMPLETE" | "INCOMPLETE" | "UNVERIFIED"; readonly owner_ack_status: "MATCHED" | "MISSING" | "AMBIGUOUS";
  readonly history_page_status: "COMPLETE" | "INCOMPLETE" | "UNVERIFIED"; readonly history_get_calls: number;
  readonly total_count: number | null; readonly total_pages: number | null; readonly provider_chat_id: string | null;
  readonly contexts: readonly OwnerTopazAstraExistingResultContext[]; readonly gaps: readonly string[];
}

type Get = (url: URL, signal?: AbortSignal) => Promise<unknown>;
type Method = "index" | "history" | "result";
interface ChatState { readonly client: object; readonly context: OwnerTopazAstraExistingChatContext; readonly request: Readonly<OwnerTopazAstraExistingIndexInput> }
interface ResultState { readonly client: object; readonly context: OwnerTopazAstraExistingResultContext; readonly expected: Readonly<{ chat_uuid: string; message_id: string; model_id: OwnerTopazAstraExistingResultContext["model_id"]; provider_chat_id: string; message_object_ids: readonly [string] }> }
const chats = new WeakMap<object, ChatState>(), results = new WeakMap<object, ResultState>();
const clientChats = new WeakMap<object, Map<string, ChatState>>();

const indexSchema = z.object({
  chats: z.array(z.object({ id: z.union([z.string().regex(ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]),
    uuid: z.string().regex(ID), scope: z.literal("tool_video_upscaler"), title: z.string().max(256) }).strip()).max(PAGE_SIZE),
  pagination: z.object({ page: z.number().int().min(1).max(100), page_size: z.literal(PAGE_SIZE),
    total_count: z.number().int().nonnegative().max(2_000_000), total_pages: z.number().int().nonnegative().max(100_000),
    has_next: z.boolean(), has_previous: z.boolean() }).strip()
}).strip();
const historySchema = z.object({ messages: z.array(z.unknown()).max(HISTORY_PAGE_SIZE), pagination: z.object({
  page: z.number().int().min(1).max(MAX_HISTORY_PAGES), page_size: z.literal(HISTORY_PAGE_SIZE),
  total_count: z.number().int().min(0).max(MAX_MESSAGES), total_pages: z.number().int().min(0).max(MAX_HISTORY_PAGES),
  has_next: z.boolean(), has_previous: z.boolean()
}).strip() }).strip();
const objectSchema = z.object({ id: z.union([z.string().regex(ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String),
  message_id: z.union([z.string().regex(ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String),
  object_type: z.string().max(80), model_type: z.string().max(80).nullable().optional(), completed: z.boolean().optional(),
  object_url: z.string().max(4096).optional() }).strip();
const rowSchema = z.object({ id: z.union([z.string().regex(ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String),
  chat_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), author_id: z.number().int(),
  message_object: z.array(objectSchema).max(64) }).strip();

export class OwnerTopazAstraExistingMediaError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "INDEX_UNAVAILABLE" | "HISTORY_UNAVAILABLE" | "RESULT_UNAVAILABLE" |
    "CONTEXT_INVALID" | "PRINCIPAL_NOT_LINKED" | "REQUEST_ABORTED" | "CAPACITY_EXCEEDED") {
    super("The existing owner Topaz Astra media could not be verified."); this.name = "OwnerTopazAstraExistingMediaError";
  }
}

export async function listOwnedTopazAstraExistingChats(input: unknown, packet: unknown, signal?: AbortSignal): Promise<OwnerTopazAstraExistingChatPage> {
  const { client, get } = await consume(input, packet, "index"), request = readInput(input); checkSignal(signal); await assertCurrent(request, signal);
  const url = new URL("chats", "https://api.syntx.ai/api/v1/"); url.searchParams.set("scope", "tool_video_upscaler");
  url.searchParams.set("page_size", String(PAGE_SIZE)); url.searchParams.set("page", String(request.page));
  let parsed: z.infer<typeof indexSchema>;
  try { parsed = indexSchema.parse(await get(url, signal)); await assertCurrent(request, signal); }
  catch { if (signal?.aborted) fail("REQUEST_ABORTED"); fail("INDEX_UNAVAILABLE"); }
  const p = parsed.pagination, pages = p.total_count === 0 ? 0 : Math.ceil(p.total_count / PAGE_SIZE);
  const expectedRows = Math.min(PAGE_SIZE, Math.max(0, p.total_count - (request.page - 1) * PAGE_SIZE));
  if (p.page !== request.page || p.total_pages !== pages || p.has_previous !== (request.page > 1) || p.has_next !== (request.page < pages) ||
      parsed.chats.length !== expectedRows || (pages > 0 && request.page > pages)) fail("INDEX_UNAVAILABLE");
  const seenUuid = new Set<string>(), seenProvider = new Set<string>(), owned: OwnerTopazAstraExistingChatContext[] = [];
  let states = clientChats.get(client); if (!states) { states = new Map(); clientChats.set(client, states); }
  for (const row of parsed.chats) {
    const providerId = String(row.id), match = /^owner-topaz-astra-([0-9a-f-]{36})$/u.exec(row.title);
    if (seenUuid.has(row.uuid) || seenProvider.has(providerId)) fail("INDEX_UNAVAILABLE");
    seenUuid.add(row.uuid); seenProvider.add(providerId);
    if (!match || !UUID.test(match[1]!)) continue;
    if ([...(clientChats.get(client)?.values() ?? [])].some((state) => state.request.attemptId === request.attemptId &&
        sameGenerationPrincipal(state.request.principal, request.principal) && state.context.provider_chat_id === providerId &&
        state.context.chat_uuid !== row.uuid)) fail("INDEX_UNAVAILABLE");
    const key = stateKey(request, row.uuid), prior = states.get(key);
    if (prior && (prior.context.provider_chat_id !== providerId || prior.context.index_page !== request.page)) fail("CONTEXT_INVALID");
    if (prior) { owned.push(prior.context); continue; }
    if (states.size >= MAX_CONTEXTS) fail("CAPACITY_EXCEEDED");
    const context = Object.freeze({ source_kind: "EXISTING_OWNER_TOPAZ_ASTRA_CHAT" as const, chat_uuid: row.uuid,
      provider_chat_id: providerId, index_page: request.page, attempt_id: request.attemptId, principal: request.principal });
    const state = { client, context, request }; states.set(key, state); chats.set(context, state); owned.push(context);
  }
  return Object.freeze({ ...p, chats: Object.freeze(owned) });
}

export async function listOwnedTopazAstraExistingCandidates(chatInput: unknown, packet: unknown, signal?: AbortSignal): Promise<OwnerTopazAstraExistingCandidates> {
  const { client, get } = await consume(chatInput, packet, "history"), state = chatState(client, chatInput);
  checkSignal(signal); await assertCurrent(state.request, signal);
  const rows: z.infer<typeof rowSchema>[] = [], messageIds = new Set<string>(), objectIds = new Set<string>();
  let totalCount: number | undefined, totalPages: number | undefined, providerChatId: string | undefined, calls = 0;
  try {
    for (let page = 1; page <= MAX_HISTORY_PAGES; page++) {
      await assertCurrent(state.request, signal); const url = new URL(`chats/${encodeURIComponent(state.context.chat_uuid)}/messages`, "https://api.syntx.ai/api/v1/");
      url.searchParams.set("page", String(page)); url.searchParams.set("page_size", String(HISTORY_PAGE_SIZE)); calls++;
      const raw = await get(url, signal); await assertCurrent(state.request, signal); const parsed = historySchema.parse(raw), p = parsed.pagination;
      const pages = p.total_count === 0 ? 0 : Math.ceil(p.total_count / HISTORY_PAGE_SIZE);
      const expectedRows = Math.min(HISTORY_PAGE_SIZE, Math.max(0, p.total_count - (page - 1) * HISTORY_PAGE_SIZE));
      if (p.page !== page || p.total_pages !== pages || p.has_previous !== (page > 1) || p.has_next !== (page < pages) ||
          parsed.messages.length !== expectedRows || (totalCount !== undefined && (totalCount !== p.total_count || totalPages !== p.total_pages))) throw new Error();
      totalCount ??= p.total_count; totalPages ??= p.total_pages;
      for (const rawRow of parsed.messages) {
        const row = rowSchema.parse(rawRow), id = String(row.chat_id);
        if (row.id.length === 0 || messageIds.has(row.id) || (providerChatId !== undefined && providerChatId !== id)) throw new Error();
        providerChatId ??= id; messageIds.add(row.id);
        for (const object of row.message_object) { if (object.message_id !== row.id || objectIds.has(object.id)) throw new Error(); objectIds.add(object.id); }
        rows.push(row);
      }
      if (!p.has_next) break;
      if (page === MAX_HISTORY_PAGES) throw new Error();
    }
  } catch { if (signal?.aborted) fail("REQUEST_ABORTED"); return receipt("UNVERIFIED", "MISSING", "UNVERIFIED", calls, null, null, null, [], ["HISTORY_UNVERIFIED"]); }
  if (totalCount === undefined || totalPages === undefined || rows.length !== totalCount || (totalCount > 0 && providerChatId !== state.context.provider_chat_id))
    return receipt("INCOMPLETE", "MISSING", "INCOMPLETE", calls, totalCount ?? null, totalPages ?? null, providerChatId ?? null, [], ["HISTORY_INCOMPLETE"]);
  const owners = rows.filter((row) => row.author_id > 0);
  if (owners.length !== 1) return receipt("INCOMPLETE", owners.length ? "AMBIGUOUS" : "MISSING", "COMPLETE", calls,
    totalCount, totalPages, providerChatId ?? null, [], [owners.length ? "OWNER_ACK_AMBIGUOUS" : "OWNER_ACK_MISSING"]);
  const videos = rows.flatMap((row) => row.author_id === -1 ? row.message_object.filter((object) => object.object_type === "video").map((object) => ({ row, object })) : []);
  if (videos.length !== 1) return receipt(videos.length ? "UNVERIFIED" : "INCOMPLETE", "MATCHED", "COMPLETE", calls,
    totalCount, totalPages, providerChatId!, [], [videos.length ? "BOT_RESULT_AMBIGUOUS" : "BOT_RESULT_MISSING"]);
  const { row: bot, object } = videos[0]!;
  if (object.completed !== true || !object.model_type || !MODELS.has(object.model_type) || !object.object_url || !safeMp4R2(object.object_url))
    return receipt("UNVERIFIED", "MATCHED", "COMPLETE", calls, totalCount, totalPages, providerChatId!, [], ["BOT_RESULT_INVALID"]);
  const context: OwnerTopazAstraExistingResultContext = Object.freeze({ source_kind: "EXISTING_OWNER_TOPAZ_ASTRA_RESULT",
    chat_uuid: state.context.chat_uuid, message_id: bot.id, model_id: object.model_type as OwnerTopazAstraExistingResultContext["model_id"],
    provider_chat_id: providerChatId!, message_object_ids: Object.freeze([object.id]) as readonly [string],
    owner_echo_message_id: owners[0]!.id, attempt_id: state.request.attemptId, principal: state.request.principal, provenance: "NOT_AVAILABLE" });
  const expected = Object.freeze({ chat_uuid: context.chat_uuid, message_id: context.message_id, model_id: context.model_id,
    provider_chat_id: context.provider_chat_id, message_object_ids: context.message_object_ids });
  results.set(context, { client, context, expected });
  return receipt("COMPLETE", "MATCHED", "COMPLETE", calls, totalCount, totalPages, providerChatId!, [context], []);
}

export async function getOwnedTopazAstraExistingResult(contextInput: unknown, packet: unknown, signal?: AbortSignal): Promise<OwnerTopazAstraResult> {
  const { client, get } = await consume(contextInput, packet, "result");
  if (!contextInput || typeof contextInput !== "object" || types.isProxy(contextInput)) fail("CONTEXT_INVALID");
  const state = results.get(contextInput);
  if (!state || state.client !== client || state.context !== contextInput) fail("CONTEXT_INVALID");
  const chat = [...(clientChats.get(client)?.values() ?? [])].find((item) => item.context.chat_uuid === state.context.chat_uuid &&
    item.request.attemptId === state.context.attempt_id && sameGenerationPrincipal(item.request.principal, state.context.principal));
  if (!chat) fail("CONTEXT_INVALID");
  checkSignal(signal); await assertCurrent(chat.request, signal);
  const url = new URL(`chats/${encodeURIComponent(state.expected.chat_uuid)}/${encodeURIComponent(state.expected.message_id)}`, "https://api.syntx.ai/api/v1/");
  try { const raw = await get(url, signal); await assertCurrent(chat.request, signal); return decode(raw, state.expected); }
  catch { if (signal?.aborted) fail("REQUEST_ABORTED"); fail("RESULT_UNAVAILABLE"); }
}

function decode(raw: unknown, expected: ResultState["expected"]): OwnerTopazAstraResult {
  try {
    const message = exact(raw, ["id", "chat_id", "author_id", "message_object"], ["created_at", "updated_at", "is_favorite"]);
    if (String(message.id) !== expected.message_id || String(message.chat_id) !== expected.provider_chat_id || message.author_id !== -1 ||
        !Array.isArray(message.message_object) || message.message_object.length > 64) throw new Error();
    const matches = message.message_object.filter((rawObject: unknown) => {
      try { const obj = exact(rawObject, ["id", "object_type", "object_url", "completed", "model_type", "message_id"], ["object_text", "created_at", "updated_at", "task_id", "metadata"]);
        return String(obj.id) === expected.message_object_ids[0] && String(obj.message_id) === expected.message_id && obj.object_type === "video" &&
          obj.model_type === expected.model_id && obj.completed === true && typeof obj.object_url === "string" && safeMp4R2(obj.object_url); } catch { return false; }
    });
    if (matches.length !== 1) throw new Error();
    const object = exact(matches[0], ["id", "object_type", "object_url", "completed", "model_type", "message_id"], ["object_text", "created_at", "updated_at", "task_id", "metadata"]);
    const path = new URL(object.object_url).pathname, ext = /\.([A-Za-z0-9]{1,8})$/u.exec(path)?.[1]?.toLowerCase();
    if (ext !== "mp4") throw new Error();
    const mime = "video/mp4" as const;
    return Object.freeze({ message_binding: "BOUND", model_echo: "MATCHED", ready_videos: Object.freeze([Object.freeze({ object_index: message.message_object.indexOf(matches[0]),
      message_object_id: String(object.id), object_type: "video", object_url: object.object_url, mime_type: mime, mime_source: mime === null ? "UNKNOWN" : "URL_EXTENSION" })]),
      gaps: Object.freeze([]), backend_acceptance: "UNPROVEN" });
  } catch { return Object.freeze({ message_binding: "UNVERIFIED", model_echo: "UNKNOWN", ready_videos: Object.freeze([]),
    gaps: Object.freeze(["RESULT_ENVELOPE_INVALID"]), backend_acceptance: "UNPROVEN" }); }
}
function readInput(value: unknown): Readonly<OwnerTopazAstraExistingIndexInput> {
  const f = exact(value, ["attemptId", "principal", "binding", "linkService", "page"]), b = exact(f.binding, ["tenant_id", "subject"]);
  if (typeof f.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(f.attemptId) || !Number.isSafeInteger(f.page) || (f.page as number) < 1 || (f.page as number) > 100 ||
      typeof b.tenant_id !== "string" || typeof b.subject !== "string" || !(f.linkService instanceof PerUserLinkService) ||
      types.isProxy(f.linkService) || Object.getPrototypeOf(f.linkService) !== PerUserLinkService.prototype ||
      Object.hasOwn(f.linkService, "getStatus") || Reflect.get(f.linkService, "getStatus") !== PerUserLinkService.prototype.getStatus) fail("INVALID_REQUEST");
  const principal = snapshotGenerationPrincipal(f.principal as GenerationPrincipalRef);
  if (principal.connection_id !== f.attemptId || principal.tenant_id !== b.tenant_id || principal.subject_id !== b.subject) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: f.attemptId, principal, binding: Object.freeze({ tenant_id: b.tenant_id, subject: b.subject }), linkService: f.linkService, page: f.page as number });
}
function stateKey(r: Readonly<OwnerTopazAstraExistingIndexInput>, id: string): string { return JSON.stringify([r.attemptId, r.principal.tenant_id, r.principal.subject_id, id]); }
function chatState(client: object, value: unknown): ChatState { if (!value || typeof value !== "object" || types.isProxy(value)) fail("CONTEXT_INVALID");
  const state = chats.get(value); if (!state || state.client !== client || state.context !== value || clientChats.get(client)?.get(stateKey(state.request, state.context.chat_uuid)) !== state) fail("CONTEXT_INVALID"); return state; }
async function assertCurrent(r: Readonly<OwnerTopazAstraExistingIndexInput>, signal?: AbortSignal): Promise<void> {
  checkSignal(signal); try { const current = await resolveOwnerReferencePrincipal({ binding: r.binding, attemptId: r.attemptId, linkService: r.linkService });
    if (!sameGenerationPrincipal(current, r.principal)) fail("PRINCIPAL_NOT_LINKED"); } catch { if (signal?.aborted) fail("REQUEST_ABORTED"); fail("PRINCIPAL_NOT_LINKED"); }
}
function receipt(status: OwnerTopazAstraExistingCandidates["status"], ack: OwnerTopazAstraExistingCandidates["owner_ack_status"], history: OwnerTopazAstraExistingCandidates["history_page_status"], calls: number,
  count: number | null, pages: number | null, provider: string | null, contexts: readonly OwnerTopazAstraExistingResultContext[], gaps: readonly string[]): OwnerTopazAstraExistingCandidates {
  return Object.freeze({ status, owner_ack_status: ack, history_page_status: history, history_get_calls: calls, total_count: count, total_pages: pages, provider_chat_id: provider,
    contexts: Object.freeze([...contexts]), gaps: Object.freeze([...gaps]) });
}
function safeR2(value: string): boolean { try { const u = new URL(value); return u.protocol === "https:" && u.hostname === "r2.syntx.ai" && !u.port && !u.username && !u.password && !u.hash; } catch { return false; } }
function safeMp4R2(value: string): boolean { return safeR2(value) && /\.mp4$/iu.test(new URL(value).pathname); }
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors), allowed = new Set([...required, ...optional]), proto = Object.getPrototypeOf(value);
  if ((proto !== Object.prototype && proto !== null) || required.some((k) => !Object.hasOwn(descriptors, k)) || keys.some((k) => typeof k !== "string" || !allowed.has(k) || !descriptors[k]!.enumerable || !("value" in descriptors[k]!))) fail("INVALID_REQUEST");
  const out = Object.create(null) as Record<string, any>; for (const key of keys as string[]) out[key] = descriptors[key]!.value; return out;
}
function checkSignal(signal?: AbortSignal): void { if (signal && (types.isProxy(signal) || !(signal instanceof AbortSignal))) fail("INVALID_REQUEST"); if (signal?.aborted) fail("REQUEST_ABORTED"); }
async function consume(input: unknown, packet: unknown, method: Method): Promise<Readonly<{ client: object; get: Get }>> {
  try { const nativeClient = await import("./chat-http-client.js"); return nativeClient.consumeOwnerTopazAstraExistingInvocation(input, packet, method); } catch { fail("CONTEXT_INVALID"); }
}
function fail(code: ConstructorParameters<typeof OwnerTopazAstraExistingMediaError>[0]): never { throw new OwnerTopazAstraExistingMediaError(code); }
