import { randomUUID, createHash } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import type { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { AccountStatusService } from "./account-status.js";
import { ModelAccessService } from "./model-access.js";
import { getOwnerHeygen4Parameters, OWNER_HEYGEN4_SOURCE_PROFILE, normalizeOwnerHeygen4Intent } from "./owner-heygen4-parameters.js";
import { isOwnerHeygen4ReferenceService, type OwnerHeygen4ReferenceService, type OwnerHeygen4OwnedReference } from "./owner-heygen4-reference-service.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u; const RECOVERY = /^heygen4_recovery_[0-9a-f-]{36}$/u;
const FRESH_MS = 30_000; const MAX_CLAIMS = 8_192; const SERVICES = new WeakSet<object>(); const CLAIMS = new Set<string>();
export interface OwnerHeygen4GenerationOptions { readonly binding: AuthBinding; readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: DiscoveryCatalogRepository; readonly catalog_version: string; readonly referenceService: OwnerHeygen4ReferenceService;
  readonly resolveChatClient: (attemptId: string) => SyntxChatHttpClient; readonly createAccountStatusService: (attemptId: string) => AccountStatusService;
  readonly createModelAccessService: (attemptId: string) => ModelAccessService; readonly now: () => number; }
export interface OwnerHeygen4GenerationResult { readonly status: "completed" | "outcome_unknown"; readonly recovery_id: string;
  readonly model_id: "heygen4"; readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY"; readonly provider_terminal_status: "UNPROVEN";
  readonly backend_acceptance: "UNPROVEN"; readonly cost_cap_enforced: false; readonly durability: "PROCESS_LOCAL_ONLY";
  readonly artifacts: readonly Readonly<{ message_object_id: string; message_id: string; object_type: "video"; url: string; mime_type: string | null }>[];
  readonly diagnostics: Readonly<{ phase: string; generation_post_started: boolean; history_get_calls: number; result_get_calls: number;
    gaps: readonly string[] }>;
}
type NormalizedIntent = ReturnType<typeof normalizeOwnerHeygen4Intent>;
interface Operation { readonly attemptId: string; readonly input: NormalizedIntent; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly client: SyntxChatHttpClient; readonly image: OwnerHeygen4OwnedReference; readonly audio: OwnerHeygen4OwnedReference;
  readonly recovery: string; chatId?: string; ackId?: string; posted: boolean; result: OwnerHeygen4GenerationResult; }
export class OwnerHeygen4GenerationServiceError extends Error {
  constructor(readonly code: string, readonly recovery_id?: string) { super("The owner HeyGen 4 generation could not be completed safely."); this.name = "OwnerHeygen4GenerationServiceError"; }
}

/** Bounded process-local HeyGen 4 flow: two quote passes, one generation POST, then owned GET reads only. */
export class OwnerHeygen4GenerationService {
  readonly #options: OwnerHeygen4GenerationOptions; readonly #records = new Map<string, Operation>(); readonly #busy = new Set<string>(); #closed = false;
  constructor(options: OwnerHeygen4GenerationOptions | unknown) {
    const row = exact(options, ["binding", "linkService", "catalog", "catalog_version", "referenceService", "resolveChatClient",
      "createAccountStatusService", "createModelAccessService", "now"]);
    if (!isOwnerHeygen4ReferenceService(row.referenceService) || typeof row.resolveChatClient !== "function" ||
        typeof row.createAccountStatusService !== "function" || typeof row.createModelAccessService !== "function" ||
        typeof row.now !== "function" || types.isProxy(row.now) || typeof row.catalog_version !== "string" || !row.catalog_version) fail("INVALID_REQUEST");
    this.#options = Object.freeze({ ...row, binding: snapshotBinding(row.binding) }) as OwnerHeygen4GenerationOptions;
    SERVICES.add(this); Object.freeze(this);
  }
  getSourceProfile(): Readonly<Record<string, unknown>> { return OWNER_HEYGEN4_SOURCE_PROFILE; }
  getParameters(): Readonly<Record<string, unknown>> { return getOwnerHeygen4Parameters(); }
  async generate(input: unknown, signal?: AbortSignal): Promise<OwnerHeygen4GenerationResult> {
    if (this.#closed) fail("SERVICE_CLOSED");
    const row = exact(input, ["attemptId", "prompt", "image_handle", "audio_handle"]);
    const refs = this.#options.referenceService.resolvePair({ attemptId: row.attemptId, image_handle: row.image_handle, audio_handle: row.audio_handle });
    if (!this.#options.referenceService.isOwned(refs.image) || !this.#options.referenceService.isOwned(refs.audio) ||
        refs.image.client !== refs.audio.client || typeof refs.audio.duration_seconds !== "number") fail("REFERENCE_NOT_FOUND");
    const normalized = normalizeOwnerHeygen4Intent({ attemptId: row.attemptId, prompt: row.prompt,
      image_sha256: refs.image.sha256, image_file_id: refs.image.file_id, audio_sha256: refs.audio.sha256,
      audio_file_id: refs.audio.file_id, duration: refs.audio.duration_seconds });
    if (this.#busy.has(normalized.attemptId)) fail("SERVICE_BUSY"); this.#busy.add(normalized.attemptId);
    try {
      const options = this.#options; const principal = await resolveOwnerReferencePrincipal({ binding: options.binding,
        attemptId: normalized.attemptId, linkService: options.linkService });
      if (!sameGenerationPrincipal(principal, refs.image.principal) || !sameGenerationPrincipal(principal, refs.audio.principal)) fail("PRINCIPAL_NOT_LINKED");
      const client = options.resolveChatClient(normalized.attemptId); if (client !== refs.image.client) fail("PRINCIPAL_NOT_LINKED");
      const semantic = createHash("sha256").update(`${principal.tenant_id}\n${principal.subject_id}\n${normalized.intent_fingerprint}`).digest("hex");
      if (CLAIMS.has(semantic)) fail("INTENT_ALREADY_CLAIMED");
      if (CLAIMS.size >= MAX_CLAIMS) fail("CAPACITY_EXCEEDED");
      if (this.#records.size >= 128) fail("CAPACITY_EXCEEDED");
      await this.#preflight(normalized, signal);
      CLAIMS.add(semantic);
      const recovery = `heygen4_recovery_${randomUUID()}`;
      const operation: Operation = { attemptId: normalized.attemptId, input: normalized, principal, client, image: refs.image, audio: refs.audio,
        recovery, posted: false, result: result("outcome_unknown", recovery, "PREPARED", false, 0, 0, ["NOT_DISPATCHED"]) };
      this.#records.set(recovery, operation);
      await this.#current(operation, signal);
      try { operation.chatId = (await client.createChat("video", `owner-heygen4-${randomUUID()}`, signal)).chat_uuid; }
      catch { operation.result = result("outcome_unknown", recovery, "CHAT_CREATE_OUTCOME_UNKNOWN", false, 0, 0, ["CHAT_CREATE_OUTCOME_UNKNOWN"]); return operation.result; }
      await this.#preflight(normalized, signal);
      await this.#current(operation, signal);
      operation.posted = true;
      try { const ack = await client.startOwnerHeygen4Video({ chat_id: operation.chatId, prompt: normalized.prompt,
          duration: normalized.duration, image: refs.image.context, audio: refs.audio.context }, signal);
        operation.ackId = ack.message_id; }
      catch { operation.result = result("outcome_unknown", recovery, "GENERATION_POST_OUTCOME_UNKNOWN", true, 0, 0, ["GENERATION_POST_OUTCOME_UNKNOWN"]); return operation.result; }
      return await this.#collect(operation, signal);
    } finally { this.#busy.delete(normalized.attemptId); }
  }
  async reconcile(input: unknown, signal?: AbortSignal): Promise<OwnerHeygen4GenerationResult> {
    const row = exact(input, ["attemptId", "recovery_id"]);
    if (typeof row.attemptId !== "string" || !ATTEMPT.test(row.attemptId) || typeof row.recovery_id !== "string" || !RECOVERY.test(row.recovery_id)) fail("INVALID_REQUEST");
    const operation = this.#records.get(row.recovery_id); if (!operation || operation.attemptId !== row.attemptId) fail("RECOVERY_NOT_FOUND");
    if (!operation.posted || operation.result.status === "completed") return operation.result;
    if (this.#busy.has(operation.attemptId)) fail("SERVICE_BUSY"); this.#busy.add(operation.attemptId);
    try { await this.#current(operation, signal); return await this.#collect(operation, signal); } finally { this.#busy.delete(operation.attemptId); }
  }
  listRecoveries(input: unknown): readonly OwnerHeygen4GenerationResult[] {
    const row = exact(input, ["attemptId"]); if (typeof row.attemptId !== "string" || !ATTEMPT.test(row.attemptId)) fail("INVALID_REQUEST");
    return Object.freeze([...this.#records.values()].filter(item => item.attemptId === row.attemptId).map(item => item.result));
  }
  async invalidateAttempt(attemptId: string): Promise<void> { for (const [id, item] of this.#records) if (item.attemptId === attemptId) this.#records.delete(id); }
  async close(): Promise<void> { this.#closed = true; this.#records.clear(); }
  async #preflight(input: NormalizedIntent, signal?: AbortSignal): Promise<void> {
    const account = await this.#options.createAccountStatusService(input.attemptId).getAccountStatus(signal);
    const access = await this.#options.createModelAccessService(input.attemptId).getModelAccess({ model_id: "heygen4",
      cost_parameters: { duration: String(input.duration) } }, signal);
    const time = safeNow(this.#options.now), accountAt = Date.parse(account.observed_at), accessAt = Date.parse(access.observed_at);
    const expectedVersion = `${this.#options.catalog.fetched_at}.${this.#options.catalog.source_hashes.models.slice(7, 19)}`;
    const price = access.discount_cost ?? access.cost;
    const balance = account.balance.available;
    if (access.access !== true || access.model_id !== "heygen4" || access.ai_name !== "heygen" || access.model_type !== "heygen4" ||
        access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || access.catalog_version !== expectedVersion || access.account_read_live !== true ||
        access.parameters_redacted !== true || access.parameter_keys.length !== 1 || access.parameter_keys[0] !== "duration" ||
        account.balance.unit !== "tokens" || typeof balance !== "string" || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(balance) ||
        account.subscription.active !== true || typeof account.subscription.plan_type !== "string" || !account.subscription.plan_type ||
        account.subscription.plan_type.toUpperCase() === "FREE" ||
        !Number.isFinite(accountAt) || !Number.isFinite(accessAt) || Math.abs(time - accountAt) > FRESH_MS || Math.abs(time - accessAt) > FRESH_MS ||
        time < accountAt || time < accessAt || typeof price !== "number" || !Number.isFinite(price) || price < 0 ||
        !Number.isSafeInteger(access.free_remaining_generations) && access.free_remaining_generations !== null ||
        !decimalLte(String(price), balance)) fail("PREFLIGHT_FAILED");
  }
  async #current(operation: Operation, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) fail("REQUEST_ABORTED");
    const principal = await resolveOwnerReferencePrincipal({ binding: this.#options.binding, attemptId: operation.attemptId, linkService: this.#options.linkService });
    if (!sameGenerationPrincipal(principal, operation.principal) || this.#options.resolveChatClient(operation.attemptId) !== operation.client ||
        !this.#options.referenceService.isOwned(operation.image) || !this.#options.referenceService.isOwned(operation.audio) ||
        operation.image.expires_at <= safeNow(this.#options.now) || operation.audio.expires_at <= safeNow(this.#options.now)) fail("PRINCIPAL_NOT_LINKED");
  }
  async #collect(operation: Operation, signal?: AbortSignal): Promise<OwnerHeygen4GenerationResult> {
    try {
      if (!operation.chatId) return operation.result;
      const raw = await operation.client.readOwnerHeygen4History(operation.chatId, signal);
      const history = historySchema(raw); const owners = history.messages.filter(row => row.author_id > 0 && row.id === operation.ackId);
      const results = history.messages.filter(row => row.author_id === -1 && row.message_object.some(object => object.object_type === "video"));
      const messageIds = new Set(history.messages.map(row => row.id));
      const chatIds = new Set(history.messages.map(row => String(row.chat_id)));
      if (history.total_count !== history.messages.length || messageIds.size !== history.messages.length || chatIds.size !== 1 ||
          history.messages.filter(row => row.author_id > 0).length !== 1 || owners.length !== 1 || results.length !== 1) throw new Error("HISTORY_UNVERIFIED");
      const row = results[0]!; if (!row.message_object.length || row.message_object.length !== 1) throw new Error("RESULT_UNVERIFIED");
      const video = row.message_object[0]!; if (String(row.chat_id) !== String(history.messages[0]!.chat_id) || video.message_id !== row.id ||
          video.model_type !== "heygen4" || video.completed !== true || !video.object_url || !isSafeUploadReferenceUrl(video.object_url)) throw new Error("RESULT_UNVERIFIED");
      const detail = rowSchema(await operation.client.readOwnerHeygen4Result(operation.chatId, row.id, signal));
      if (detail.id !== row.id || detail.chat_id !== row.chat_id || detail.author_id !== row.author_id || detail.message_object.length !== 1 ||
          detail.message_object[0]?.id !== video.id || detail.message_object[0]?.message_id !== row.id ||
          detail.message_object[0]?.object_url !== video.object_url || detail.message_object[0]?.completed !== true ||
          detail.message_object[0]?.model_type !== "heygen4") throw new Error("RESULT_CHANGED");
      operation.result = Object.freeze({ ...result("completed", operation.recovery, "RECONCILED", true, 1, 1, []),
        artifacts: Object.freeze([Object.freeze({ message_object_id: video.id, message_id: row.id, object_type: "video" as const,
          url: video.object_url, mime_type: mime(video.object_url) })]) }); return operation.result;
    } catch { operation.result = result("outcome_unknown", operation.recovery, "OWNED_HISTORY_OR_RESULT_UNVERIFIED", true, 1, 1, ["OWNED_HISTORY_OR_RESULT_UNVERIFIED"]); return operation.result; }
  }
}
Object.freeze(OwnerHeygen4GenerationService.prototype);
export function isOwnerHeygen4GenerationService(value: unknown): value is OwnerHeygen4GenerationService { return !!value && typeof value === "object" && !types.isProxy(value) &&
  SERVICES.has(value) && Object.getPrototypeOf(value) === OwnerHeygen4GenerationService.prototype && Object.isFrozen(value); }

function historySchema(value: unknown): { messages: ReturnType<typeof rowSchema>[]; total_count: number } {
  const root = record(value); if (!root || !Array.isArray(root.messages)) throw new Error("BAD_HISTORY");
  const pagination = record(root.pagination); if (!pagination || pagination.page !== 1 || pagination.page_size !== 10 || pagination.total_pages !== 1 ||
      pagination.has_next !== false || !Number.isSafeInteger(pagination.total_count)) throw new Error("BAD_HISTORY");
  return { messages: root.messages.map(rowSchema), total_count: pagination.total_count as number };
}
function rowSchema(value: unknown): { id: string; chat_id: string | number; author_id: number; message_object: { id: string; message_id?: string; object_type: string; object_url?: string; completed?: boolean; model_type?: string }[] } {
  const row = record(value); if (!row || (typeof row.id !== "string" && typeof row.id !== "number") ||
      (typeof row.chat_id !== "string" && typeof row.chat_id !== "number") || typeof row.author_id !== "number" || !Array.isArray(row.message_object)) throw new Error("BAD_MESSAGE");
  return { id: String(row.id), chat_id: row.chat_id, author_id: row.author_id, message_object: row.message_object.map(item => {
    const object = record(item); if (!object || (typeof object.id !== "string" && typeof object.id !== "number") || typeof object.object_type !== "string") throw new Error("BAD_OBJECT");
    return { id: String(object.id), ...(typeof object.message_id === "string" || typeof object.message_id === "number" ? { message_id: String(object.message_id) } : {}),
      object_type: object.object_type, ...(typeof object.object_url === "string" ? { object_url: object.object_url } : {}),
      ...(typeof object.completed === "boolean" ? { completed: object.completed } : {}), ...(typeof object.model_type === "string" ? { model_type: object.model_type } : {}) };
  }) };
}
function result(status: OwnerHeygen4GenerationResult["status"], recovery_id: string, phase: string, generation_post_started: boolean,
  history_get_calls: number, result_get_calls: number, gaps: readonly string[]): OwnerHeygen4GenerationResult { return Object.freeze({ status, recovery_id,
  model_id: "heygen4", status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", provider_terminal_status: "UNPROVEN", backend_acceptance: "UNPROVEN",
  cost_cap_enforced: false, durability: "PROCESS_LOCAL_ONLY", artifacts: Object.freeze([]), diagnostics: Object.freeze({ phase,
    generation_post_started, history_get_calls, result_get_calls, gaps: Object.freeze([...gaps]) }) }); }
function mime(url: string): string | null { const path = new URL(url).pathname.toLowerCase(); return path.endsWith(".mp4") ? "video/mp4" : path.endsWith(".mov") ? "video/quicktime" : null; }
function record(value: unknown): Record<string, any> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : undefined; }
function exact(value: unknown, keys: readonly string[]): Record<string, any> { const row = record(value); if (!row || types.isProxy(value)) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value); if ((Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
    Reflect.ownKeys(descriptors).length !== keys.length || Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || !keys.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  return row; }
function snapshotBinding(value: unknown): Readonly<AuthBinding> { const row = exact(value, ["tenant_id", "subject"]); if (typeof row.tenant_id !== "string" || !row.tenant_id ||
    typeof row.subject !== "string" || !row.subject) fail("INVALID_REQUEST"); return Object.freeze({ tenant_id: row.tenant_id, subject: row.subject }); }
function safeNow(clock: () => number): number { const value = clock(); if (!Number.isSafeInteger(value) || value < 0) fail("PREFLIGHT_FAILED"); return value; }
function decimalLte(left: string, right: string): boolean { const parse = (value: string) => { const [whole = "0", fraction = ""] = value.split(".");
  return { whole: whole.replace(/^0+(?=\d)/u, ""), fraction: fraction.replace(/0+$/u, "") }; };
  const a = parse(left), b = parse(right); if (a.whole.length !== b.whole.length) return a.whole.length < b.whole.length;
  if (a.whole !== b.whole) return a.whole < b.whole; const width = Math.max(a.fraction.length, b.fraction.length);
  return a.fraction.padEnd(width, "0") <= b.fraction.padEnd(width, "0"); }
function fail(code: string): never { throw new OwnerHeygen4GenerationServiceError(code); }
