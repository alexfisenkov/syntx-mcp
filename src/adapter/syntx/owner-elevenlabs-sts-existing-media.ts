import { types } from "node:util";
import { z } from "zod/v4";
import { PerUserLinkService } from "../../auth/link-service.js";
import type { AuthBinding } from "../../auth/types.js";
import { resolveOwnerReferencePrincipal } from "../../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../../domain/generation-principal.js";
import { decodeOwnerElevenLabsStsResult, type OwnerElevenLabsStsResult } from "./owner-elevenlabs-sts-result-codec.js";

const MODEL = "eleven_multilingual_sts_v2" as const;
const PAGE_SIZE = 20 as const;
const MAX_PAGE = 100;
const HISTORY_PAGE_SIZE = 10;
const MAX_HISTORY_PAGES = 7;
const MAX_MESSAGES = 64;
const MAX_CONTEXTS = 128;
const BOT_AUTHOR_ID = -1;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface OwnerElevenLabsStsExistingChatContext {
  readonly source_kind: "EXISTING_OWNER_STS_CHAT";
  readonly chat_uuid: string;
  readonly provider_chat_id: string;
  readonly index_page: number;
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
}
export interface OwnerElevenLabsStsExistingChatPage {
  readonly page: number;
  readonly page_size: typeof PAGE_SIZE;
  readonly total_count: number;
  readonly total_pages: number;
  readonly has_next: boolean;
  readonly has_previous: boolean;
  readonly chats: readonly Readonly<OwnerElevenLabsStsExistingChatContext>[];
}
export interface OwnerElevenLabsStsExistingResultContext {
  readonly source_kind: "EXISTING_OWNER_STS_RESULT";
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly model_id: typeof MODEL;
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly [string];
  readonly owner_echo_message_id: string;
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
}
export interface OwnerElevenLabsStsExistingCandidates {
  readonly status: "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "MATCHED" | "MISSING" | "AMBIGUOUS";
  readonly history_page_status: "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly history_get_calls: number;
  readonly total_count: number | null;
  readonly total_pages: number | null;
  readonly provider_chat_id: string | null;
  readonly contexts: readonly Readonly<OwnerElevenLabsStsExistingResultContext>[];
  readonly gaps: readonly string[];
}
export interface OwnerElevenLabsStsExistingIndexInput {
  readonly attemptId: string;
  readonly principal: GenerationPrincipalRef;
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly page: number;
}

type ChatGet = (url: URL, signal?: AbortSignal) => Promise<unknown>;
interface Invocation { readonly input: unknown; readonly client: object; readonly method: "index" | "history" | "result"; readonly get: ChatGet }
const CHATS = new WeakMap<object, ChatState>();
const RESULTS = new WeakMap<object, ResultState>();
const CLIENT_CHATS = new WeakMap<object, Map<string, ChatState>>();
interface ChatState {
  readonly client: object; readonly context: OwnerElevenLabsStsExistingChatContext;
  readonly linkService: PerUserLinkService; readonly binding: Readonly<AuthBinding>;
  readonly principal: Readonly<GenerationPrincipalRef>; readonly attemptId: string;
  candidates?: OwnerElevenLabsStsExistingCandidates;
}
interface ResultState {
  readonly client: object; readonly chat: ChatState; readonly context: OwnerElevenLabsStsExistingResultContext;
  readonly resultContext: Readonly<{ chat_uuid: string; message_id: string; model_id: typeof MODEL; provider_chat_id: string; message_object_ids: readonly [string] }>;
}

const indexSchema = z.object({
  chats: z.array(z.object({ id: z.union([z.string().regex(SAFE_ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]),
    uuid: z.string().regex(SAFE_ID), scope: z.literal("audio"), title: z.string().max(256) }).strip()).max(PAGE_SIZE),
  pagination: z.object({ page: z.number().int().min(1).max(MAX_PAGE), page_size: z.literal(PAGE_SIZE),
    total_count: z.number().int().nonnegative().max(2_000_000), total_pages: z.number().int().nonnegative().max(100_000),
    has_next: z.boolean(), has_previous: z.boolean() }).strip()
}).strip();
const historySchema = z.object({ messages: z.array(z.unknown()).max(HISTORY_PAGE_SIZE), pagination: z.object({
  page: z.number().int().min(1).max(MAX_HISTORY_PAGES), page_size: z.literal(HISTORY_PAGE_SIZE),
  total_count: z.number().int().min(0).max(MAX_MESSAGES), total_pages: z.number().int().min(0).max(MAX_HISTORY_PAGES),
  has_next: z.boolean(), has_previous: z.boolean()
}).strip() }).strip();
const objectSchema = z.object({ id: z.union([z.string().regex(SAFE_ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String),
  message_id: z.union([z.string().regex(SAFE_ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String),
  object_type: z.string().max(80), model_type: z.string().max(80).nullable().optional(), object_text: z.string().max(5000).optional(),
  completed: z.boolean().optional() }).strip();
const rowSchema = z.object({ id: z.union([z.string().regex(SAFE_ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String),
  chat_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), author_id: z.number().int(),
  message_object: z.array(objectSchema).max(64) }).strip();

export class OwnerElevenLabsStsExistingMediaError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "INDEX_UNAVAILABLE" | "HISTORY_UNAVAILABLE" | "RESULT_UNAVAILABLE" |
    "CONTEXT_INVALID" | "PRINCIPAL_NOT_LINKED" | "REQUEST_ABORTED" | "CAPACITY_EXCEEDED") {
    super("The existing owner ElevenLabs STS media could not be verified."); this.name = "OwnerElevenLabsStsExistingMediaError";
  }
}

export async function listOwnedElevenLabsStsExistingChats(input: unknown, packet: unknown, signal?: AbortSignal): Promise<OwnerElevenLabsStsExistingChatPage> {
  const { client, get } = await consumeInvocation(input, packet, "index");
  const request = readIndexInput(input); checkSignal(signal);
  await assertCurrent(request, signal);
  const url = new URL("chats", "https://api.syntx.ai/api/v1/"); url.searchParams.set("scope", "audio");
  url.searchParams.set("page", String(request.page)); url.searchParams.set("page_size", String(PAGE_SIZE));
  let parsed: z.infer<typeof indexSchema>;
  try { parsed = indexSchema.parse(await get(url, signal)); await assertCurrent(request, signal); }
  catch (error) { if (signal?.aborted) fail("REQUEST_ABORTED"); fail("INDEX_UNAVAILABLE"); }
  const p = parsed.pagination, expectedPages = p.total_count === 0 ? 0 : Math.ceil(p.total_count / PAGE_SIZE);
  const expectedRows = Math.min(PAGE_SIZE, Math.max(0, p.total_count - (request.page - 1) * PAGE_SIZE));
  if (p.page !== request.page || p.total_pages !== expectedPages || p.has_previous !== (request.page > 1) ||
      p.has_next !== (request.page < expectedPages) || parsed.chats.length !== expectedRows || (expectedPages > 0 && request.page > expectedPages)) {
    fail("INDEX_UNAVAILABLE");
  }
  const seen = new Set<string>(), chats: OwnerElevenLabsStsExistingChatContext[] = [];
  const seenProviderIds = new Set<string>();
  let states = CLIENT_CHATS.get(client); if (!states) { states = new Map(); CLIENT_CHATS.set(client, states); }
  for (const row of parsed.chats) {
    const id = String(row.id), match = /^owner-elevenlabs-sts-([0-9a-f-]{36})$/u.exec(row.title);
    if (seen.has(row.uuid) || seenProviderIds.has(id)) fail("INDEX_UNAVAILABLE");
    seen.add(row.uuid); seenProviderIds.add(id);
    if (row.scope !== "audio" || !match || !UUID.test(match[1]!)) continue;
    const key = chatStateKey(request.attemptId, request.principal, row.uuid);
    if ([...states.values()].some((state) => state.attemptId === request.attemptId && sameGenerationPrincipal(state.principal, request.principal) &&
        state.context.provider_chat_id === id && state.context.chat_uuid !== row.uuid)) fail("INDEX_UNAVAILABLE");
    const prior = states.get(key);
    if (prior) {
      if (prior.context.provider_chat_id !== id || prior.context.index_page !== request.page || prior.attemptId !== request.attemptId ||
          !sameGenerationPrincipal(prior.principal, request.principal)) fail("CONTEXT_INVALID");
      chats.push(prior.context); continue;
    }
    if (states.size >= MAX_CONTEXTS) fail("CAPACITY_EXCEEDED");
    const context = Object.freeze({ source_kind: "EXISTING_OWNER_STS_CHAT" as const, chat_uuid: row.uuid,
      provider_chat_id: id, index_page: request.page, attempt_id: request.attemptId, principal: request.principal });
    const state: ChatState = { client, context, linkService: request.linkService, binding: request.binding,
      principal: request.principal, attemptId: request.attemptId };
    states.set(key, state); CHATS.set(context, state); chats.push(context);
  }
  return Object.freeze({ ...p, chats: Object.freeze(chats) });
}

export async function listOwnedElevenLabsStsExistingCandidates(chatInput: unknown, packet: unknown, signal?: AbortSignal): Promise<OwnerElevenLabsStsExistingCandidates> {
  const { client, get } = await consumeInvocation(chatInput, packet, "history");
  const chat = chatState(client, chatInput); checkSignal(signal); await assertCurrent(chat, signal); if (chat.candidates) return chat.candidates;
  const messages: z.infer<typeof rowSchema>[] = [], seenMessages = new Set<string>(), seenObjects = new Set<string>();
  let totalCount: number | undefined, totalPages: number | undefined, providerChatId: string | undefined, calls = 0;
  try {
    for (let page = 1; page <= MAX_HISTORY_PAGES; page += 1) {
      await assertCurrent(chat, signal); const url = new URL(`chats/${encodeURIComponent(chat.context.chat_uuid)}/messages`, "https://api.syntx.ai/api/v1/");
      url.searchParams.set("page", String(page)); url.searchParams.set("page_size", String(HISTORY_PAGE_SIZE)); calls += 1;
      const raw = await get(url, signal); await assertCurrent(chat, signal);
      const parsed = historySchema.parse(raw), p = parsed.pagination;
      const pages = p.total_count === 0 ? 0 : Math.ceil(p.total_count / HISTORY_PAGE_SIZE);
      const expectedRows = Math.min(HISTORY_PAGE_SIZE, Math.max(0, p.total_count - (page - 1) * HISTORY_PAGE_SIZE));
      if (p.page !== page || p.total_pages !== pages || p.has_previous !== (page > 1) || p.has_next !== (page < pages) ||
          parsed.messages.length !== expectedRows || (totalCount !== undefined && (totalCount !== p.total_count || totalPages !== p.total_pages))) throw new Error();
      totalCount ??= p.total_count; totalPages ??= p.total_pages;
      for (const rawRow of parsed.messages) {
        const row = rowSchema.parse(rawRow), messageId = row.id, rowChatId = String(row.chat_id);
        if (providerChatId === undefined) providerChatId = rowChatId;
        if (rowChatId !== chat.context.provider_chat_id || rowChatId !== providerChatId || seenMessages.has(messageId)) throw new Error();
        seenMessages.add(messageId);
        for (const object of row.message_object) {
          if (object.message_id !== messageId || seenObjects.has(object.id)) throw new Error(); seenObjects.add(object.id);
        }
        messages.push(row); if (messages.length > MAX_MESSAGES) throw new Error();
      }
      if (!p.has_next) break;
      if (page === MAX_HISTORY_PAGES) throw new Error();
    }
  } catch { if (signal?.aborted) fail("REQUEST_ABORTED"); return candidates("UNVERIFIED", "MISSING", "UNVERIFIED", calls, null, null, null, [], ["HISTORY_UNVERIFIED"]); }
  if (totalCount === undefined || totalPages === undefined || messages.length !== totalCount || (totalCount > 0 && providerChatId === undefined))
    return candidates("INCOMPLETE", "MISSING", "INCOMPLETE", calls, totalCount ?? null, totalPages ?? null, providerChatId ?? null, [], ["HISTORY_INCOMPLETE"]);
  const ownerRows = messages.filter((row) => row.author_id > 0 && row.message_object.length > 0 && row.message_object.some((obj) =>
    (obj.object_type === "text" && obj.model_type === MODEL && typeof obj.object_text === "string") ||
    (obj.object_type === "audio" && obj.model_type === MODEL) || (obj.object_type === "input_audio" && obj.model_type === MODEL)));
  if (ownerRows.length !== 1) return candidates("INCOMPLETE", ownerRows.length ? "AMBIGUOUS" : "MISSING", "COMPLETE", calls,
    totalCount, totalPages, providerChatId ?? null, [], [ownerRows.length ? "OWNER_ACK_AMBIGUOUS" : "OWNER_ACK_MISSING"]);
  const owner = ownerRows[0]!;
  const botRows = messages.filter((row) => row.author_id === BOT_AUTHOR_ID && row.message_object.length === 1 &&
    row.message_object[0]!.object_type === "audio" && row.message_object[0]!.model_type === MODEL && row.message_object[0]!.completed === true);
  if (botRows.length !== 1) return candidates("INCOMPLETE", "MATCHED", "COMPLETE", calls, totalCount, totalPages, providerChatId!, [],
    [botRows.length ? "BOT_RESULT_AMBIGUOUS" : "BOT_RESULT_MISSING"]);
  const bot = botRows[0]!, object = bot.message_object[0]!;
  const context: OwnerElevenLabsStsExistingResultContext = Object.freeze({ source_kind: "EXISTING_OWNER_STS_RESULT",
    chat_uuid: chat.context.chat_uuid, message_id: bot.id, model_id: MODEL, provider_chat_id: providerChatId!,
    message_object_ids: Object.freeze([object.id]) as readonly [string], owner_echo_message_id: owner.id,
    attempt_id: chat.attemptId, principal: chat.principal });
  const resultContext = Object.freeze({ chat_uuid: chat.context.chat_uuid, message_id: bot.id, model_id: MODEL,
    provider_chat_id: providerChatId!, message_object_ids: context.message_object_ids });
  RESULTS.set(context, { client, chat, context, resultContext });
  const result = candidates("COMPLETE", "MATCHED", "COMPLETE", calls, totalCount, totalPages, providerChatId!, [context], []);
  chat.candidates = result; return result;
}

export async function getOwnedElevenLabsStsExistingResult(contextInput: unknown, packet: unknown, signal?: AbortSignal): Promise<OwnerElevenLabsStsResult> {
  const { client, get } = await consumeInvocation(contextInput, packet, "result");
  if (!contextInput || typeof contextInput !== "object" || types.isProxy(contextInput)) fail("CONTEXT_INVALID");
  const state = RESULTS.get(contextInput);
  if (!state || state.client !== client || state.context !== contextInput || CHATS.get(state.chat.context) !== state.chat) fail("CONTEXT_INVALID");
  checkSignal(signal); await assertCurrent(state.chat, signal);
  const url = new URL(`chats/${encodeURIComponent(state.context.chat_uuid)}/${encodeURIComponent(state.context.message_id)}`, "https://api.syntx.ai/api/v1/");
  try {
    const raw = await get(url, signal); await assertCurrent(state.chat, signal);
    return decodeOwnerElevenLabsStsResult(raw, state.resultContext);
  } catch { if (signal?.aborted) fail("REQUEST_ABORTED"); fail("RESULT_UNAVAILABLE"); }
}

function readIndexInput(value: unknown): Readonly<OwnerElevenLabsStsExistingIndexInput> {
  const row = exact(value, ["attemptId", "principal", "binding", "linkService", "page"]);
  if (typeof row.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(row.attemptId) || !Number.isSafeInteger(row.page) ||
      (row.page as number) < 1 || (row.page as number) > MAX_PAGE) fail("INVALID_REQUEST");
  const bindingRow = exact(row.binding, ["tenant_id", "subject"]);
  if (typeof bindingRow.tenant_id !== "string" || typeof bindingRow.subject !== "string" ||
      !(row.linkService instanceof PerUserLinkService) || Object.getPrototypeOf(row.linkService) !== PerUserLinkService.prototype ||
      Object.getOwnPropertyDescriptor(row.linkService, "getStatus") !== undefined) fail("INVALID_REQUEST");
  const principal = snapshotGenerationPrincipal(row.principal as GenerationPrincipalRef);
  if (principal.connection_id !== row.attemptId || principal.tenant_id !== bindingRow.tenant_id || principal.subject_id !== bindingRow.subject) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: row.attemptId, principal, binding: Object.freeze({ tenant_id: bindingRow.tenant_id, subject: bindingRow.subject }),
    linkService: row.linkService, page: row.page as number });
}
function exact(value: unknown, keys: readonly string[]): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const proto = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), ownKeys = Reflect.ownKeys(descriptors);
  if ((proto !== Object.prototype && proto !== null) || ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  return Object.fromEntries(keys.map((key) => [key, descriptors[key]!.value]));
}
async function assertCurrent(context: Readonly<{ linkService: PerUserLinkService; binding: Readonly<AuthBinding>; attemptId: string; principal: Readonly<GenerationPrincipalRef> }>, signal?: AbortSignal): Promise<void> {
  checkSignal(signal);
  try {
    const current = await resolveOwnerReferencePrincipal({ binding: context.binding, attemptId: context.attemptId, linkService: context.linkService });
    if (!sameGenerationPrincipal(current, context.principal)) fail("PRINCIPAL_NOT_LINKED");
  } catch { if (signal?.aborted) fail("REQUEST_ABORTED"); fail("PRINCIPAL_NOT_LINKED"); }
}
function chatState(client: object, value: unknown): ChatState {
  if (!value || typeof value !== "object" || types.isProxy(value)) fail("CONTEXT_INVALID");
  const state = CHATS.get(value); if (!state || state.client !== client || state.context !== value ||
      CLIENT_CHATS.get(client)?.get(chatStateKey(state.attemptId, state.principal, state.context.chat_uuid)) !== state) fail("CONTEXT_INVALID");
  return state;
}
function chatStateKey(attemptId: string, principal: Readonly<GenerationPrincipalRef>, chatUuid: string): string {
  return JSON.stringify([attemptId, principal.tenant_id, principal.subject_id, chatUuid]);
}
function candidates(status: OwnerElevenLabsStsExistingCandidates["status"], ack: OwnerElevenLabsStsExistingCandidates["owner_ack_status"],
  history: OwnerElevenLabsStsExistingCandidates["history_page_status"], calls: number, count: number | null, pages: number | null,
  provider: string | null, contexts: readonly OwnerElevenLabsStsExistingResultContext[], gaps: readonly string[]): OwnerElevenLabsStsExistingCandidates {
  return Object.freeze({ status, owner_ack_status: ack, history_page_status: history, history_get_calls: calls, total_count: count,
    total_pages: pages, provider_chat_id: provider, contexts: Object.freeze([...contexts]), gaps: Object.freeze([...gaps]) });
}
function checkSignal(signal?: AbortSignal): void { if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) fail("INVALID_REQUEST"); if (signal?.aborted) fail("REQUEST_ABORTED"); }
async function consumeInvocation(input: unknown, packet: unknown, method: Invocation["method"]): Promise<Readonly<{ client: object; get: ChatGet }>> {
  try { const nativeClient = await import("./chat-http-client.js"); return nativeClient.consumeOwnerElevenLabsStsExistingInvocation(input, packet, method); }
  catch { fail("CONTEXT_INVALID"); }
}
function fail(code: ConstructorParameters<typeof OwnerElevenLabsStsExistingMediaError>[0]): never { throw new OwnerElevenLabsStsExistingMediaError(code); }
