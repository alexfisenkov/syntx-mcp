import { createHash } from "node:crypto";
import { types } from "node:util";
import { z } from "zod/v4";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PAGE_SIZE = 20;
const HISTORY_PAGE_SIZE = 10;
const MAX_TARGETS = 6;
const MAX_CONCURRENT = 2;
const MODEL_PREFIX = Object.freeze({
  "dop-lite": "owner-higgsfield-dop-", "dop-turbo": "owner-higgsfield-dop-",
  "hailuo-2.3-fast": "owner-hailuo-initial-", "hailuo-01-live-character": "owner-hailuo-initial-", "hailuo-3.0": "owner-hailuo-initial-",
  "kling_elements": "owner-kling-media-", "kling_o1_image2video": "owner-kling-media-",
  "kling_4_keyframes": "owner-kling4-native-", "kling_4_omni": "owner-kling4-native-",
  acttwo: "owner-acttwo-",
  "wan_27_i2v": "owner-wan27-i2v-", "gen4.5i2v": "owner-runway-i2v-",
  "seedance-2.5": "owner-contract-video-", switchx: "owner-switchx-video-"
} as const);
const MODEL_IDS = Object.keys(MODEL_PREFIX) as [keyof typeof MODEL_PREFIX, ...Array<keyof typeof MODEL_PREFIX>];
const services = new WeakSet<object>();
const modelSchema = z.enum(MODEL_IDS);
const targetSchema = z.object({ model_id: modelSchema, chat_uuid: z.string().regex(UUID), owner_message_id: z.string().regex(SAFE_ID),
  provider_message_id: z.string().regex(SAFE_ID), expected_prompt: z.string().max(10_000) }).strict().superRefine((target, context) => {
    if (target.model_id === "acttwo" ? target.expected_prompt !== "" : target.expected_prompt.length === 0) {
      context.addIssue({ code: "custom", path: ["expected_prompt"], message: "The expected prompt shape is not supported for this model." });
    }
  });
const inputSchema = z.object({ attemptId: z.string().regex(ATTEMPT), targets: z.array(targetSchema).min(1).max(MAX_TARGETS) }).strict();
const providerId = z.union([z.string().regex(SAFE_ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String);
const indexChatSchema = z.object({ id: providerId, uuid: z.string().regex(UUID), scope: z.literal("video").optional(), title: z.string().min(1).max(256),
  created_at: z.string().min(1).max(64) }).strip();
const indexSchema = z.object({ chats: z.array(indexChatSchema).max(PAGE_SIZE),
  pagination: z.object({ page: z.literal(1), page_size: z.literal(PAGE_SIZE), total_count: z.number().int().nonnegative().max(2_000_000),
    total_pages: z.number().int().nonnegative().max(100_000), has_next: z.boolean(), has_previous: z.boolean() }).passthrough() }).passthrough();
const historyObjectSchema = z.object({ id: providerId, message_id: providerId, object_type: z.string().regex(SAFE_ID),
  model_type: z.string().regex(SAFE_ID).nullable().optional(), object_text: z.string().max(100_000).nullable().optional(),
  object_url: z.string().max(4096).nullable().optional(), completed: z.boolean().nullable().optional() }).strip();
const historyMessageSchema = z.object({ id: providerId, chat_id: providerId, author_id: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  message_object: z.array(historyObjectSchema).max(64) }).strip();
const historySchema = z.object({ messages: z.array(historyMessageSchema).max(HISTORY_PAGE_SIZE),
  pagination: z.object({ page: z.literal(1), page_size: z.literal(HISTORY_PAGE_SIZE), total_count: z.number().int().nonnegative().max(20),
    total_pages: z.number().int().nonnegative().max(2), has_next: z.boolean(), has_previous: z.boolean() }).passthrough() }).passthrough();
const detailObjectSchema = z.object({ id: providerId, message_id: providerId, object_type: z.string().regex(SAFE_ID),
  model_type: z.string().regex(SAFE_ID).nullable().optional(), object_text: z.string().max(100_000).nullable().optional(), object_url: z.string().max(4096).nullable().optional(),
  completed: z.boolean().nullable().optional() }).strip();
const detailSchema = z.object({ id: providerId, chat_id: providerId, author_id: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  message_object: z.array(detailObjectSchema).max(64) }).strip();

export type OwnerExistingVideoModelId = keyof typeof MODEL_PREFIX;
export interface OwnerExistingVideoTarget { readonly model_id: OwnerExistingVideoModelId; readonly chat_uuid: string; readonly owner_message_id: string;
  readonly provider_message_id: string; readonly expected_prompt: string }
export interface OwnerExistingVideoArtifact { readonly object_url: string; readonly mime_type: "video/mp4" | "video/quicktime" | null }
export interface OwnerExistingVideoResult { readonly model_id: OwnerExistingVideoModelId; readonly status: "video_available" | "provider_error" | "unverified";
  readonly provider_error_code: "PROVIDER_ERROR_OBJECT_OBSERVED" | null; readonly object_url: string | null; readonly mime_type: "video/mp4" | "video/quicktime" | null;
  readonly artifacts?: readonly OwnerExistingVideoArtifact[];
  readonly proof: "CURRENT_LINK_INDEX_HISTORY_DETAIL_BOUND" | "UNVERIFIED"; readonly gaps: readonly string[] }
export interface OwnerExistingVideoRecoveryList { readonly status: "complete" | "partial"; readonly index_page: 1; readonly index_page_size: 20;
  readonly results: readonly OwnerExistingVideoResult[]; readonly provider_terminal_status: "UNPROVEN";
  readonly read_counts: Readonly<{ index_gets: 1; history_gets: number; detail_gets: number }> }
export interface OwnerExistingVideoRecoveryServiceOptions { readonly binding: AuthBinding; readonly linkService: PerUserLinkService;
  readonly resolveChatClient: (attemptId: string) => unknown; readonly now?: () => number; readonly timeoutMs?: number }
export class OwnerExistingVideoRecoveryError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "PRINCIPAL_NOT_LINKED" | "INDEX_UNAVAILABLE" |
    "HISTORY_UNAVAILABLE" | "DETAIL_UNAVAILABLE" | "NATIVE_METHOD_UNAVAILABLE" | "REQUEST_ABORTED") {
    super("Existing owner video results could not be read safely."); this.name = "OwnerExistingVideoRecoveryError";
  }
}
interface ActiveRun { readonly attempt: string; readonly abort: AbortController; promise: Promise<unknown> }
type Target = z.infer<typeof targetSchema>;
type HistoryBotObject = Readonly<{ id: string; object_type: "video" | "error"; object_url?: string | null }>;

/** GET-only result reader. Caller targets are strictly owner supplied; no account/user-specific job IDs are embedded in this module. */
export class OwnerExistingVideoRecoveryService {
  readonly #binding: Readonly<AuthBinding>; readonly #links: PerUserLinkService; readonly #resolve: OwnerExistingVideoRecoveryServiceOptions["resolveChatClient"];
  readonly #now: () => number; readonly #timeoutMs: number; readonly #active = new Set<ActiveRun>(); readonly #busy = new Set<string>();
  #closed = false; #lastTime = 0;
  constructor(options: OwnerExistingVideoRecoveryServiceOptions) {
    if (!options || types.isProxy(options) || !isLinkService(options.linkService) || typeof options.resolveChatClient !== "function" ||
        types.isProxy(options.resolveChatClient) || (options.now !== undefined && (typeof options.now !== "function" || types.isProxy(options.now)))) fail("INVALID_REQUEST");
    this.#binding = Object.freeze({ ...options.binding }); this.#links = options.linkService; this.#resolve = options.resolveChatClient;
    this.#now = options.now ?? Date.now; this.#timeoutMs = Number.isSafeInteger(options.timeoutMs) && (options.timeoutMs as number) >= 1_000 && (options.timeoutMs as number) <= 120_000
      ? options.timeoutMs as number : 60_000;
    this.#time(); services.add(this); Object.freeze(this);
  }
  readExistingVideos(input: unknown, signal?: AbortSignal): Promise<OwnerExistingVideoRecoveryList> {
    let request: z.infer<typeof inputSchema>;
    try { request = inputSchema.parse(input); validateUniqueTargets(request.targets); } catch { return Promise.reject(new OwnerExistingVideoRecoveryError("INVALID_REQUEST")); }
    return this.#run(request.attemptId, signal, deadline => this.#read(request.attemptId, request.targets, deadline));
  }
  async invalidateAttempt(attempt: string): Promise<void> { if (!ATTEMPT.test(attempt)) return; const runs = [...this.#active].filter(run => run.attempt === attempt);
    for (const run of runs) run.abort.abort(); await Promise.allSettled(runs.map(run => run.promise)); }
  async close(): Promise<void> { if (this.#closed) return; this.#closed = true; for (const run of this.#active) run.abort.abort();
    await Promise.allSettled([...this.#active].map(run => run.promise)); }
  async #read(attempt: string, targets: readonly Target[], deadline: AbsoluteRequestDeadline): Promise<OwnerExistingVideoRecoveryList> {
    try {
      const principal = await deadline.waitFor(resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: attempt, linkService: this.#links }));
      const client = this.#client(attempt); await this.#assertCurrent(attempt, principal, deadline);
      let rawIndex: unknown; try { rawIndex = await deadline.waitFor(client.readOwnerExistingVideoIndex(deadline.signal)); }
      catch { deadline.throwIfAborted(); fail("INDEX_UNAVAILABLE"); }
      await this.#assertCurrent(attempt, principal, deadline);
      const chats = parseIndex(rawIndex), results: OwnerExistingVideoResult[] = []; let historyGets = 0, detailGets = 0;
      for (const target of targets) {
        deadline.throwIfAborted(); const matches = chats.filter(row => row.uuid === target.chat_uuid);
        if (matches.length !== 1) { results.push(unverified(target.model_id, matches.length ? "INDEX_TARGET_AMBIGUOUS" : "TARGET_NOT_IN_CURRENT_INDEX")); continue; }
        const chat = matches[0]!;
        if (!indexRowMatchesTarget(chat, target)) { results.push(unverified(target.model_id, "INDEX_MEMBERSHIP_MISMATCH")); continue; }
        historyGets++;
        let rawHistory: unknown; try { rawHistory = await deadline.waitFor(client.readOwnerExistingVideoHistory(chat.uuid, deadline.signal)); }
        catch { deadline.throwIfAborted(); results.push(unverified(target.model_id, "HISTORY_UNAVAILABLE")); continue; }
        await this.#assertCurrent(attempt, principal, deadline);
        const history = validateTargetHistory(rawHistory, target, chat.id);
        if (typeof history === "string") { results.push(unverified(target.model_id, history)); continue; }
        detailGets++;
        let rawDetail: unknown; try { rawDetail = await deadline.waitFor(client.readOwnerExistingVideoMessage(chat.uuid, target.provider_message_id, deadline.signal)); }
        catch { deadline.throwIfAborted(); results.push(unverified(target.model_id, "DETAIL_UNAVAILABLE")); continue; }
        await this.#assertCurrent(attempt, principal, deadline);
        results.push(validateTargetDetail(rawDetail, target, chat.id, history));
      }
      return Object.freeze({ status: results.every(row => row.status !== "unverified") ? "complete" : "partial", index_page: 1, index_page_size: PAGE_SIZE,
        results: Object.freeze(results), provider_terminal_status: "UNPROVEN", read_counts: Object.freeze({ index_gets: 1, history_gets: historyGets, detail_gets: detailGets }) });
    } catch (error) { if (error instanceof OwnerExistingVideoRecoveryError) throw error; fail("REQUEST_ABORTED"); }
  }
  #client(attempt: string): SyntxChatHttpClient {
    let value: unknown; try { value = this.#resolve(attempt); } catch { fail("PRINCIPAL_NOT_LINKED"); }
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype ||
        Reflect.get(value, "readOwnerExistingVideoIndex") !== SyntxChatHttpClient.prototype.readOwnerExistingVideoIndex ||
        Reflect.get(value, "readOwnerExistingVideoHistory") !== SyntxChatHttpClient.prototype.readOwnerExistingVideoHistory ||
        Reflect.get(value, "readOwnerExistingVideoMessage") !== SyntxChatHttpClient.prototype.readOwnerExistingVideoMessage) fail("PRINCIPAL_NOT_LINKED");
    return value as SyntxChatHttpClient;
  }
  async #assertCurrent(attempt: string, expected: Readonly<GenerationPrincipalRef>, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted(); const current = await deadline.waitFor(resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: attempt, linkService: this.#links }));
    if (!sameGenerationPrincipal(expected, current)) fail("PRINCIPAL_NOT_LINKED"); deadline.throwIfAborted();
  }
  #run<T>(attempt: string, signal: AbortSignal | undefined, work: (deadline: AbsoluteRequestDeadline) => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new OwnerExistingVideoRecoveryError("SERVICE_CLOSED"));
    if (!ATTEMPT.test(attempt) || this.#busy.has(attempt) || this.#active.size >= MAX_CONCURRENT) return Promise.reject(new OwnerExistingVideoRecoveryError("SERVICE_BUSY"));
    if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) return Promise.reject(new OwnerExistingVideoRecoveryError("INVALID_REQUEST"));
    const abort = new AbortController(), combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
    const deadline = new AbsoluteRequestDeadline(this.#timeoutMs, combined, () => new OwnerExistingVideoRecoveryError("REQUEST_ABORTED"));
    this.#busy.add(attempt); const run: ActiveRun = { attempt, abort, promise: Promise.resolve() };
    const promise = Promise.resolve().then(() => work(deadline)).finally(() => { deadline.close(); this.#busy.delete(attempt); this.#active.delete(run); });
    run.promise = promise; this.#active.add(run); return promise;
  }
  #time(): number { let now: unknown; try { now = this.#now(); } catch { return fail("INVALID_REQUEST"); }
    if (!Number.isSafeInteger(now) || (now as number) < this.#lastTime) return fail("INVALID_REQUEST"); this.#lastTime = now as number; return now as number; }
}
Object.freeze(OwnerExistingVideoRecoveryService.prototype);
export function isOwnerExistingVideoRecoveryService(value: unknown): value is OwnerExistingVideoRecoveryService {
  return !!value && typeof value === "object" && !types.isProxy(value) && services.has(value) && Object.getPrototypeOf(value) === OwnerExistingVideoRecoveryService.prototype && Object.isFrozen(value);
}

function validateUniqueTargets(targets: readonly Target[]): void {
  const models = new Set<string>(), chats = new Set<string>(), messages = new Set<string>();
  for (const row of targets) {
    if (models.has(row.model_id) || chats.has(row.chat_uuid) || messages.has(`${row.chat_uuid}/${row.owner_message_id}`) || messages.has(`${row.chat_uuid}/${row.provider_message_id}`) ||
        row.owner_message_id === row.provider_message_id) fail("INVALID_REQUEST");
    models.add(row.model_id); chats.add(row.chat_uuid); messages.add(`${row.chat_uuid}/${row.owner_message_id}`); messages.add(`${row.chat_uuid}/${row.provider_message_id}`);
  }
}
function parseIndex(value: unknown): readonly z.infer<typeof indexChatSchema>[] {
  const parsed = indexSchema.safeParse(value); if (!parsed.success) fail("INDEX_UNAVAILABLE");
  const page = parsed.data.pagination, pages = page.total_count === 0 ? 0 : Math.ceil(page.total_count / PAGE_SIZE);
  if (page.total_pages !== pages || page.has_previous !== false || page.has_next !== (pages > 1) || parsed.data.chats.length !== Math.min(PAGE_SIZE, page.total_count)) fail("INDEX_UNAVAILABLE");
  const uuids = new Set<string>(); for (const row of parsed.data.chats) { if (uuids.has(row.uuid) || !safeTimestamp(row.created_at)) fail("INDEX_UNAVAILABLE"); uuids.add(row.uuid); }
  return parsed.data.chats;
}
function indexRowMatchesTarget(row: z.infer<typeof indexChatSchema>, target: Target): boolean {
  const prefix = MODEL_PREFIX[target.model_id];
  const titleUuid = row.title.startsWith(prefix) ? row.title.slice(prefix.length) : "";
  return row.uuid === target.chat_uuid && (row.scope === undefined || row.scope === "video") && UUID.test(titleUuid);
}
function validateTargetHistory(value: unknown, target: Target, providerChatId: string): string | readonly HistoryBotObject[] {
  const parsed = historySchema.safeParse(value); if (!parsed.success) return "HISTORY_SHAPE_INVALID";
  const { messages, pagination } = parsed.data;
  if (pagination.page !== 1 || pagination.page_size !== HISTORY_PAGE_SIZE || pagination.total_count !== messages.length || pagination.total_pages !== 1 ||
      pagination.has_next !== false || pagination.has_previous !== false || messages.length !== 2) return "HISTORY_INCOMPLETE";
  const owner = messages.filter(row => row.id === target.owner_message_id && row.author_id > 0);
  const bot = messages.filter(row => row.id === target.provider_message_id && row.author_id === -1);
  if (owner.length !== 1 || bot.length !== 1 || messages.some(row => row.chat_id !== providerChatId)) return "MESSAGE_ID_OR_AUTHOR_MISMATCH";
  const ownerObjects = owner[0]!.message_object;
  if (target.model_id === "kling_4_keyframes" || target.model_id === "kling_4_omni") {
    if (ownerObjects.length !== 1 || ownerObjects[0]!.message_id !== target.owner_message_id || ownerObjects[0]!.object_type !== "text" ||
        ownerObjects[0]!.model_type !== target.model_id || ownerObjects[0]!.completed !== true ||
        ownerObjects[0]!.object_url !== undefined && ownerObjects[0]!.object_url !== null && ownerObjects[0]!.object_url !== "") {
      return "OWNER_MODEL_OR_REFERENCE_MISMATCH";
    }
    if (typeof ownerObjects[0]!.object_text !== "string" || promptDigest(ownerObjects[0]!.object_text) !== promptDigest(target.expected_prompt)) {
      return "OWNER_PROMPT_MISMATCH";
    }
  } else if (target.model_id === "acttwo") {
    if (ownerObjects.length < 2 || ownerObjects.length > 3 || ownerObjects.some(row => row.message_id !== target.owner_message_id ||
        row.model_type != null && row.model_type !== "acttwo")) return "OWNER_MODEL_OR_REFERENCE_MISMATCH";
    const videos = ownerObjects.filter(row => row.object_type === "video"), images = ownerObjects.filter(row => row.object_type === "image");
    const texts = ownerObjects.filter(row => row.object_type === "text");
    if (videos.length !== 1 || images.length !== 1 || texts.length > 1 || ownerObjects.length !== 2 + texts.length ||
        !ownerObjects.some(row => (row.object_type === "video" || row.object_type === "image") && row.model_type === "acttwo")) return "OWNER_MODEL_OR_REFERENCE_MISMATCH";
    if (texts.length === 1 && texts[0]!.object_text != null && texts[0]!.object_text !== "") return "OWNER_PROMPT_MISMATCH";
  } else if (target.model_id === "seedance-2.5") {
    if (ownerObjects.length !== 1 || ownerObjects[0]!.message_id !== target.owner_message_id || ownerObjects[0]!.object_type !== "text" ||
        ownerObjects[0]!.model_type !== target.model_id || ownerObjects[0]!.completed !== true ||
        ownerObjects[0]!.object_url !== undefined && ownerObjects[0]!.object_url !== null && ownerObjects[0]!.object_url !== "") return "OWNER_MODEL_OR_REFERENCE_MISMATCH";
    if (typeof ownerObjects[0]!.object_text !== "string" || promptDigest(ownerObjects[0]!.object_text) !== promptDigest(target.expected_prompt)) {
      return "OWNER_PROMPT_MISMATCH";
    }
  } else if (target.model_id === "switchx") {
    if (ownerObjects.length !== 2 || ownerObjects.some(row => row.message_id !== target.owner_message_id || row.model_type !== target.model_id || row.completed !== true)) {
      return "OWNER_MODEL_OR_REFERENCE_MISMATCH";
    }
    const prompts = ownerObjects.filter(row => row.object_type === "text" && typeof row.object_text === "string" &&
      promptDigest(row.object_text) === promptDigest(target.expected_prompt));
    const videos = ownerObjects.filter(row => row.object_type === "video" && typeof row.object_url === "string" && isSafeUploadReferenceUrl(row.object_url));
    if (prompts.length !== 1) return "OWNER_PROMPT_MISMATCH";
    if (videos.length !== 1) return "OWNER_MODEL_OR_REFERENCE_MISMATCH";
  } else {
    if (ownerObjects.length !== 2 || ownerObjects.some(row => row.message_id !== target.owner_message_id ||
        row.model_type != null && row.model_type !== target.model_id) ||
        ownerObjects.filter(row => row.object_type === "image" && row.model_type === target.model_id).length !== 1) return "OWNER_MODEL_OR_REFERENCE_MISMATCH";
    const expectedPromptDigest = promptDigest(target.expected_prompt);
    const prompts = ownerObjects.filter(row => row.object_type === "text" && typeof row.object_text === "string" && promptDigest(row.object_text) === expectedPromptDigest);
    if (prompts.length !== 1) return "OWNER_PROMPT_MISMATCH";
  }
  const botObjects = bot[0]!.message_object;
  if (target.model_id === "switchx") {
    if (botObjects.length !== 2 || botObjects.some(row => row.message_id !== target.provider_message_id || row.model_type !== target.model_id ||
        row.object_type !== "video" || row.completed !== true || typeof row.object_url !== "string" || !isSafeUploadReferenceUrl(row.object_url))) {
      return "BOT_MODEL_OR_TYPE_MISMATCH";
    }
    const ids = botObjects.map(row => row.id), urls = botObjects.map(row => row.object_url!);
    if (new Set(ids).size !== 2 || new Set(urls).size !== 2) return "BOT_MODEL_OR_TYPE_MISMATCH";
    return Object.freeze(botObjects.map(row => Object.freeze({ id: row.id, object_type: "video" as const, object_url: row.object_url! })));
  }
  if (target.model_id === "kling_4_keyframes" || target.model_id === "kling_4_omni") {
    if (botObjects.length !== 1 || botObjects[0]!.message_id !== target.provider_message_id || botObjects[0]!.model_type !== target.model_id ||
        (botObjects[0]!.object_type !== "video" && botObjects[0]!.object_type !== "error") || botObjects[0]!.completed !== true) {
      return "BOT_MODEL_OR_TYPE_MISMATCH";
    }
    const object = botObjects[0]!;
    if (object.object_type === "video" && (typeof object.object_url !== "string" || !isSafeUploadReferenceUrl(object.object_url)) ||
        object.object_type === "error" && object.object_url != null && object.object_url !== "") return "BOT_MODEL_OR_TYPE_MISMATCH";
    return Object.freeze([Object.freeze({ id: object.id, object_type: object.object_type as "video" | "error",
      ...(object.object_url === undefined ? {} : { object_url: object.object_url }) })]);
  }
  if (botObjects.length !== 1 || botObjects[0]!.message_id !== target.provider_message_id || botObjects[0]!.model_type !== target.model_id ||
      (botObjects[0]!.object_type !== "video" && botObjects[0]!.object_type !== "error") || botObjects[0]!.completed !== true) return "BOT_MODEL_OR_TYPE_MISMATCH";
  return Object.freeze([Object.freeze({ id: botObjects[0]!.id, object_type: botObjects[0]!.object_type,
    ...(botObjects[0]!.object_url === undefined ? {} : { object_url: botObjects[0]!.object_url }) })]);
}
function validateTargetDetail(value: unknown, target: Target, providerChatId: string,
  history: readonly HistoryBotObject[]): OwnerExistingVideoResult {
  const parsed = detailSchema.safeParse(value); if (!parsed.success) return unverified(target.model_id, "DETAIL_SHAPE_INVALID");
  const detail = parsed.data;
  if (detail.id !== target.provider_message_id || detail.chat_id !== providerChatId || detail.author_id !== -1 || detail.message_object.length !== history.length) {
    return unverified(target.model_id, "DETAIL_BINDING_MISMATCH");
  }
  if (target.model_id === "switchx") {
    if (history.length !== 2 || detail.message_object.some((object, index) => {
      const observed = history[index];
      return !observed || object.id !== observed.id || object.message_id !== target.provider_message_id || object.model_type !== target.model_id ||
        object.object_type !== "video" || object.completed !== true || typeof object.object_url !== "string" ||
        !isSafeUploadReferenceUrl(object.object_url) || object.object_url !== observed.object_url;
    })) return unverified(target.model_id, "DETAIL_OBJECT_MISMATCH");
    const artifacts = Object.freeze(detail.message_object.map(object => Object.freeze({ object_url: object.object_url!, mime_type: null })));
    if (new Set(artifacts.map(item => item.object_url)).size !== 2) return unverified(target.model_id, "DETAIL_OBJECT_MISMATCH");
    return Object.freeze({ model_id: target.model_id, status: "video_available", provider_error_code: null,
      object_url: artifacts[0]!.object_url, mime_type: null, artifacts,
      proof: "CURRENT_LINK_INDEX_HISTORY_DETAIL_BOUND", gaps: Object.freeze([]) });
  }
  if (target.model_id === "kling_4_keyframes" || target.model_id === "kling_4_omni") {
    if (history.length !== 1) return unverified(target.model_id, "DETAIL_BINDING_MISMATCH");
    const expected = history[0]!, object = detail.message_object[0]!;
    if (object.id !== expected.id || object.message_id !== target.provider_message_id || object.model_type !== target.model_id ||
        object.object_type !== expected.object_type || object.completed !== true) return unverified(target.model_id, "DETAIL_OBJECT_MISMATCH");
    if (expected.object_type === "error") {
      if (expected.object_url != null && expected.object_url !== "" || object.object_url != null && object.object_url !== "") {
        return unverified(target.model_id, "DETAIL_OBJECT_MISMATCH");
      }
      return Object.freeze({ model_id: target.model_id, status: "provider_error", provider_error_code: "PROVIDER_ERROR_OBJECT_OBSERVED",
        object_url: null, mime_type: null, proof: "CURRENT_LINK_INDEX_HISTORY_DETAIL_BOUND", gaps: Object.freeze([]) });
    }
    if (typeof expected.object_url !== "string" || typeof object.object_url !== "string" || !isSafeUploadReferenceUrl(expected.object_url) ||
        !isSafeUploadReferenceUrl(object.object_url) || object.object_url !== expected.object_url) {
      return unverified(target.model_id, "DETAIL_OBJECT_MISMATCH");
    }
    return Object.freeze({ model_id: target.model_id, status: "video_available", provider_error_code: null, object_url: object.object_url,
      mime_type: null, proof: "CURRENT_LINK_INDEX_HISTORY_DETAIL_BOUND", gaps: Object.freeze([]) });
  }
  if (history.length !== 1) return unverified(target.model_id, "DETAIL_BINDING_MISMATCH");
  const expected = history[0]!, kind = expected.object_type, object = detail.message_object[0]!;
  if (object.id !== expected.id || object.message_id !== target.provider_message_id || object.model_type !== target.model_id ||
      object.object_type !== kind || object.completed !== true) return unverified(target.model_id, "DETAIL_OBJECT_MISMATCH");
  if (kind === "error") return Object.freeze({ model_id: target.model_id, status: "provider_error", provider_error_code: "PROVIDER_ERROR_OBJECT_OBSERVED",
    object_url: null, mime_type: null, proof: "CURRENT_LINK_INDEX_HISTORY_DETAIL_BOUND", gaps: Object.freeze([]) });
  if (typeof object.object_url !== "string" || !isSafeUploadReferenceUrl(object.object_url)) return unverified(target.model_id, "RESULT_URL_NOT_ALLOWLISTED");
  return Object.freeze({ model_id: target.model_id, status: "video_available", provider_error_code: null, object_url: object.object_url,
    mime_type: null, proof: "CURRENT_LINK_INDEX_HISTORY_DETAIL_BOUND", gaps: Object.freeze([]) });
}
function promptDigest(prompt: string): string { return createHash("sha256").update(prompt, "utf8").digest("hex"); }
function unverified(model_id: OwnerExistingVideoModelId, gap: string): OwnerExistingVideoResult { return Object.freeze({ model_id, status: "unverified",
  provider_error_code: null, object_url: null, mime_type: null, proof: "UNVERIFIED", gaps: Object.freeze([gap]) }); }
function safeTimestamp(value: string): boolean { const rfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u;
  return rfc3339.test(value) && Number.isFinite(Date.parse(value)); }
function isLinkService(value: unknown): value is PerUserLinkService { try { return !!value && typeof value === "object" && !types.isProxy(value) &&
  Object.getPrototypeOf(value) === PerUserLinkService.prototype && Reflect.get(value, "getStatus") === PerUserLinkService.prototype.getStatus; } catch { return false; } }
function fail(code: OwnerExistingVideoRecoveryError["code"]): never { throw new OwnerExistingVideoRecoveryError(code); }
