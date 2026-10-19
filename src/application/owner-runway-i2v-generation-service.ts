import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { z } from "zod/v4";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { SyntxHttpClient } from "../adapter/syntx/http-client.js";
import type { OwnerRunwayI2vChatContext } from "../adapter/syntx/owner-runway-i2v-chat-context.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { AuthBinding } from "../auth/types.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { AccountStatusService } from "./account-status.js";
import { ModelAccessService } from "./model-access.js";
import { evaluateOwnerRunwayI2vBudget } from "./owner-runway-i2v-budget.js";
import { buildOwnerRunwayI2vCostParameters, loadOwnerRunwayI2vRuntimeCatalog } from "./owner-runway-i2v-cost.js";
import { normalizeOwnerRunwayI2vParameters, getOwnerRunwayI2vSourceProfile } from "./owner-runway-i2v-parameters.js";
import { buildOwnerRunwayI2vWire, type OwnerRunwayI2vWireCandidate } from "./owner-runway-i2v-wire.js";
import { OwnerRunwayI2vReferenceService, isOwnerRunwayI2vReferenceService,
  type OwnerRunwayI2vOwnedReferences } from "./owner-runway-i2v-reference-service.js";

type ModelId = "4genfirstframeimage" | "turbo4genfirstframeimage";
const MODELS = ["4genfirstframeimage", "turbo4genfirstframeimage"] as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY = /^runway_i2v_recovery_[0-9a-f-]{36}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const CLAIMS = new Set<string>(); // Sticky process-local idempotency. Never released after an uncertain POST.
const IN_FLIGHT = new Set<string>();
const OPERATIONS = new WeakMap<object, Operation>();
const RESULTS = new WeakMap<object, { op: Operation; row: HistoryRow }>();
const GENERATE = z.object({ attemptId: z.string().regex(ATTEMPT), model_id: z.enum(MODELS),
  prompt: z.string().min(1).max(1000), aspect_ratio: z.enum(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]),
  video_duration: z.union([z.literal(5), z.literal(10)]), seed: z.null(),
  reference_handle: z.string().regex(/^runway_i2v_reference_[0-9a-f-]{36}$/u) }).strict();
const id = z.union([z.string().regex(ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String);
const objectSchema = z.object({ id, message_id: id, object_type: z.string().max(128),
  object_text: z.string().max(20000).nullable().optional(), object_url: z.string().max(4096).nullable().optional(),
  model_type: z.string().max(160).nullable().optional(), completed: z.boolean().nullable().optional() }).strip();
const rowSchema = z.object({ id, chat_id: id, author_id: z.number().int().safe(),
  message_object: z.array(objectSchema).max(64) }).strip();
const historySchema = z.object({ messages: z.array(rowSchema).max(10), pagination: z.object({
  page: z.literal(1), page_size: z.literal(10), total_count: z.number().int().min(1).max(10),
  total_pages: z.literal(1), has_next: z.literal(false), has_previous: z.literal(false)
}).strip() }).strip();
type HistoryRow = z.infer<typeof rowSchema>;
type Request = z.infer<typeof GENERATE>;

export interface OwnerRunwayI2vGenerationOptions {
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly referenceService: OwnerRunwayI2vReferenceService;
  readonly catalog: DiscoveryCatalogRepository;
  readonly resolveChatClient: (attemptId: string) => SyntxChatHttpClient;
  readonly createReadClient: (attemptId: string) => SyntxHttpClient;
  readonly now: () => number;
}
export interface OwnerRunwayI2vArtifact {
  readonly object_index: number; readonly message_object_id: string; readonly object_type: "video";
  readonly object_url: string; readonly mime_type: "video/mp4" | "video/quicktime" | null;
  readonly message_id: string; readonly chat_uuid: string; readonly model_id: ModelId;
}
export interface OwnerRunwayI2vGenerationResult {
  readonly status: "completed" | "outcome_unknown"; readonly recovery_id: string; readonly model_id: ModelId;
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY"; readonly provider_terminal_status: "UNPROVEN";
  readonly backend_acceptance: "UNPROVEN"; readonly cost_cap_enforced: false; readonly durability: "PROCESS_LOCAL_ONLY";
  readonly observed_artifact_count: number; readonly artifacts: readonly OwnerRunwayI2vArtifact[]; readonly gaps: readonly string[];
}
export class OwnerRunwayI2vGenerationError extends Error {
  constructor(readonly code: string) { super("The Runway I2V operation could not be completed safely."); this.name = "OwnerRunwayI2vGenerationError"; }
}
interface Operation {
  readonly token: object; readonly request: Request; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly client: SyntxChatHttpClient; readonly refs: OwnerRunwayI2vOwnedReferences;
  readonly wire: Readonly<OwnerRunwayI2vWireCandidate>; readonly semantic: string; readonly recovery: string;
  readonly validate: (dispatch: boolean) => void;
  chat?: OwnerRunwayI2vChatContext; ack?: string;
  phase: "PREPARING" | "READY" | "POSTED"; quoteAt: number; invalid: boolean;
  responseStatus?: number; transportCode?: string;
  providerChat?: string; ownerEcho?: string;
  result: OwnerRunwayI2vGenerationResult;
}

/** Owner-scoped orchestration. Every mutation is gated; uncertain dispatch is permanently GET-only. */
export class OwnerRunwayI2vGenerationService {
  readonly #options: OwnerRunwayI2vGenerationOptions;
  readonly #records = new Map<string, Operation>();
  readonly #pending = new Map<Promise<unknown>, { attempt: string; abort: AbortController }>();
  readonly #busy = new Set<string>(); readonly #epochs = new Map<string, number>();
  #lastTime = 0; #closed = false;
  constructor(options: OwnerRunwayI2vGenerationOptions) {
    if (!options || types.isProxy(options) || !isOwnerRunwayI2vReferenceService(options.referenceService) ||
        !genuine(options.linkService, PerUserLinkService, ["getStatus"]) ||
        !genuine(options.catalog, DiscoveryCatalogRepository, ["getModel"]) ||
        typeof options.resolveChatClient !== "function" || typeof options.createReadClient !== "function" || typeof options.now !== "function") fail("INVALID_REQUEST");
    const { catalog: pinned } = loadOwnerRunwayI2vRuntimeCatalog();
    if (options.catalog.fetched_at !== pinned.fetched_at || MODELS.some(model => schemaHash(options.catalog.getModel(model)) !== schemaHash(pinned.getModel(model))) ||
        schemaHash(options.catalog.source_hashes) !== schemaHash(pinned.source_hashes)) fail("MODEL_BINDING_MISMATCH");
    this.#options = Object.freeze({ ...options, binding: Object.freeze({ ...options.binding }) });
    this.#time(); Object.freeze(this);
  }

  generate(input: unknown, signal?: AbortSignal): Promise<OwnerRunwayI2vGenerationResult> {
    let snapshot: Record<string, unknown>;
    try { snapshot = exact(input, ["attemptId", "model_id", "prompt", "aspect_ratio", "video_duration", "seed", "reference_handle"]); }
    catch (error) { return Promise.reject(error); }
    const parsed = GENERATE.safeParse(snapshot); if (!parsed.success) return Promise.reject(new OwnerRunwayI2vGenerationError("INVALID_REQUEST"));
    const request = Object.freeze(parsed.data);
    return this.#run(request.attemptId, signal, async deadline => {
      const o = this.#options, epoch = this.#epochs.get(request.attemptId) ?? 0;
      const principal = await deadline.waitFor(resolveOwnerReferencePrincipal({ binding: o.binding, attemptId: request.attemptId, linkService: o.linkService }));
      const refs = await deadline.waitFor(o.referenceService.resolveReferences({ attemptId: request.attemptId, model_id: request.model_id, aspect_ratio: request.aspect_ratio, reference_handles: [request.reference_handle] }, deadline.signal));
      if (!sameGenerationPrincipal(principal, refs.principal)) fail("PRINCIPAL_NOT_LINKED");
      const parameters = { model_id: request.model_id, prompt: request.prompt, aspect_ratio: request.aspect_ratio, video_duration: request.video_duration, seed: request.seed };
      normalizeOwnerRunwayI2vParameters(parameters);
      const captured = o.referenceService.withCapturedReferences(refs, parameters, (client, rows) => ({ client, wire: buildOwnerRunwayI2vWire(parameters, {
        url: rows[0]!.url, sha256: rows[0]!.sha256, width: rows[0]!.width, height: rows[0]!.height }) }));
      const semantic = schemaHash({ tenant: principal.tenant_id, subject: principal.subject_id, intent: captured.wire.intent_fingerprint });
      if (CLAIMS.has(semantic)) fail("INTENT_ALREADY_CLAIMED");
      if (IN_FLIGHT.has(semantic)) fail("SERVICE_BUSY");
      if (CLAIMS.size >= 8192 || this.#records.size >= 128) fail("CAPACITY_EXCEEDED");
      IN_FLIGHT.add(semantic);
      const recovery = "runway_i2v_recovery_" + randomUUID(), token = Object.freeze({ model_id: request.model_id });
      const op: Operation = { token, request, principal, client: captured.client, refs, wire: captured.wire, semantic, recovery,
        phase: "PREPARING", quoteAt: 0, invalid: false, result: unknownResult(request.model_id, recovery, ["NOT_DISPATCHED"]), validate: dispatch => {
          if (this.#closed || op.invalid || (this.#epochs.get(request.attemptId) ?? 0) !== epoch ||
              this.#options.resolveChatClient(request.attemptId) !== op.client || !genuine(op.client, SyntxChatHttpClient,
                ["createOwnerRunwayI2vChat", "isOwnerRunwayI2vChat", "startOwnerRunwayI2vOperation", "readOwnerRunwayI2vHistory", "readOwnerRunwayI2vResult"])) fail("PRINCIPAL_NOT_LINKED");
          if (op.chat && (op.chat.model_id !== request.model_id || !SyntxChatHttpClient.prototype.isOwnerRunwayI2vChat.call(op.client, op.chat, request.attemptId))) fail("PRINCIPAL_NOT_LINKED");
          if (dispatch && (!o.referenceService.isOwnedReferences(refs) || refs.expires_at <= this.#time() ||
              op.wire.profile_sha256 !== getOwnerRunwayI2vSourceProfile().source_sha256)) fail("REFERENCE_EXPIRED");
          if (dispatch && op.phase === "READY" && (this.#time() < op.quoteAt || this.#time() - op.quoteAt > 15000)) fail("PREFLIGHT_EXPIRED");
        } };
      try {
        await this.#preflight(op, deadline);
        this.#records.set(recovery, op); OPERATIONS.set(token, op);
        await this.#current(op, deadline); op.validate(true);
        try { op.chat = await deadline.waitFor(SyntxChatHttpClient.prototype.createOwnerRunwayI2vChat.call(op.client,
          { attemptId: request.attemptId, model_id: request.model_id, title: "owner-runway-i2v-" + randomUUID() }, deadline.signal)); }
        catch { CLAIMS.add(semantic); op.result = unknownResult(request.model_id, recovery, ["CHAT_CREATE_OUTCOME_UNKNOWN"]); return op.result; }
        await this.#preflight(op, deadline);
        await this.#current(op, deadline); op.validate(true); deadline.throwIfAborted();
        op.phase = "READY";
        try {
          const ack = await deadline.waitFor(SyntxChatHttpClient.prototype.startOwnerRunwayI2vOperation.call(op.client, token, deadline.signal));
          if (ack.chat_uuid !== op.chat.chat_uuid || !ID.test(ack.message_id)) fail("ACK_UNVERIFIED");
          op.ack = ack.message_id;
        } catch {
          op.result = operationUnknown(op, "GENERATION_OUTCOME_UNKNOWN");
          return op.result;
        }
        return await this.#collect(op, deadline);
      } finally { IN_FLIGHT.delete(semantic); }
    });
  }

  reconcile(input: unknown, signal?: AbortSignal): Promise<OwnerRunwayI2vGenerationResult> {
    let fields: Record<string, unknown>; try { fields = exact(input, ["attemptId", "recovery_id"]); } catch (error) { return Promise.reject(error); }
    if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || typeof fields.recovery_id !== "string" || !RECOVERY.test(fields.recovery_id)) return Promise.reject(new OwnerRunwayI2vGenerationError("INVALID_REQUEST"));
    const attempt = fields.attemptId, recovery = fields.recovery_id;
    return this.#run(attempt, signal, async deadline => {
      const op = this.#records.get(recovery); if (!op || op.request.attemptId !== attempt) fail("RECOVERY_NOT_FOUND");
      await this.#current(op, deadline); op.validate(false);
      if (op.phase !== "POSTED") return op.result;
      if (op.result.status === "completed") return op.result;
      return this.#collect(op, deadline);
    });
  }
  listRecoveries(input: unknown, signal?: AbortSignal): Promise<readonly OwnerRunwayI2vGenerationResult[]> {
    let f: Record<string, unknown>; try { f = exact(input, ["attemptId"]); } catch (error) { return Promise.reject(error); }
    if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId)) return Promise.reject(new OwnerRunwayI2vGenerationError("INVALID_REQUEST"));
    const attempt = f.attemptId;
    return this.#run(attempt, signal, async deadline => {
      const principal = await deadline.waitFor(resolveOwnerReferencePrincipal({ binding: this.#options.binding, attemptId: attempt, linkService: this.#options.linkService }));
      return Object.freeze([...this.#records.values()].filter(op => !op.invalid && op.request.attemptId === attempt && sameGenerationPrincipal(op.principal, principal)).map(op => op.result));
    });
  }
  async invalidateAttempt(attempt: string): Promise<void> {
    if (!ATTEMPT.test(attempt)) return;
    this.#epochs.set(attempt, (this.#epochs.get(attempt) ?? 0) + 1);
    for (const op of this.#records.values()) if (op.request.attemptId === attempt) { op.invalid = true; SyntxChatHttpClient.prototype.invalidateOwnerRunwayI2vChats.call(op.client, attempt); }
    const waits: Promise<unknown>[] = [];
    for (const [promise, entry] of this.#pending) if (entry.attempt === attempt) { entry.abort.abort(); waits.push(promise); }
    await Promise.allSettled(waits);
    for (const [key, op] of this.#records) if (op.request.attemptId === attempt) this.#records.delete(key);
    await this.#options.referenceService.invalidateAttempt(attempt);
  }
  async close(): Promise<void> {
    this.#closed = true;
    for (const entry of this.#pending.values()) entry.abort.abort();
    for (const op of this.#records.values()) { op.invalid = true; SyntxChatHttpClient.prototype.invalidateOwnerRunwayI2vChats.call(op.client, op.request.attemptId); }
    await Promise.allSettled([...this.#pending.keys()]); this.#records.clear();
  }

  async #preflight(op: Operation, deadline: AbsoluteRequestDeadline): Promise<void> {
    await this.#current(op, deadline); op.validate(true);
    const read = this.#options.createReadClient(op.request.attemptId);
    if (!genuine(read, SyntxHttpClient, ["getAccountBalance", "getSubscription", "getModelInfo"])) fail("PREFLIGHT_FAILED");
    const account = await deadline.waitFor(new AccountStatusService(read, () => this.#time()).getAccountStatus(deadline.signal));
    if (account.subscription.active !== true || !account.subscription.plan_type || account.subscription.plan_type.toUpperCase() === "FREE") fail("SUBSCRIPTION_REQUIRED");
    const parameters = buildOwnerRunwayI2vCostParameters({ model_id: op.request.model_id, video_duration: op.request.video_duration });
    const access = await deadline.waitFor(new ModelAccessService(this.#options.catalog, read, () => this.#time()).getModelAccess({
      model_id: op.request.model_id, cost_parameters: { ...parameters } }, deadline.signal));
    evaluateOwnerRunwayI2vBudget({ model_id: op.request.model_id, expected_catalog_version: `${this.#options.catalog.fetched_at}.${this.#options.catalog.source_hashes.models.slice(7, 19)}`,
      now: this.#time(), cost_parameters: parameters, access, account });
    op.quoteAt = Math.min(Date.parse(account.observed_at), Date.parse(access.observed_at));
    await this.#current(op, deadline); op.validate(true);
  }
  async #current(op: Operation, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted(); op.validate(false);
    const current = await deadline.waitFor(resolveOwnerReferencePrincipal({ binding: this.#options.binding, attemptId: op.request.attemptId, linkService: this.#options.linkService }));
    if (!sameGenerationPrincipal(current, op.principal)) fail("PRINCIPAL_NOT_LINKED");
    deadline.throwIfAborted(); op.validate(false);
  }
  async #collect(op: Operation, deadline: AbsoluteRequestDeadline): Promise<OwnerRunwayI2vGenerationResult> {
    try {
      await this.#current(op, deadline);
      const raw = await deadline.waitFor(SyntxChatHttpClient.prototype.readOwnerRunwayI2vHistory.call(op.client, op.token, deadline.signal));
      await this.#current(op, deadline);
      const history = historySchema.parse(raw);
      if (history.pagination.total_count !== history.messages.length) fail("HISTORY_INCOMPLETE");
      const messageIds = new Set<string>(), objectIds = new Set<string>();
      const provider = history.messages[0]!.chat_id;
      if (op.providerChat && provider !== op.providerChat) fail("HISTORY_BINDING_MISMATCH");
      for (const row of history.messages) {
        if (row.chat_id !== provider || messageIds.has(row.id)) fail("HISTORY_BINDING_MISMATCH"); messageIds.add(row.id);
        for (const object of row.message_object) { if (object.message_id !== row.id || objectIds.has(object.id)) fail("HISTORY_BINDING_MISMATCH"); objectIds.add(object.id); }
      }
      const owners = history.messages.filter(row => row.author_id > 0 && (!op.ack || row.id === op.ack) &&
        row.message_object.filter(object => object.object_type === "text").length === 1 &&
        row.message_object.some(object => object.object_type === "text" && object.object_text === op.wire.wire.prompt) &&
        row.message_object.filter(object => object.object_type === "image").length === 1 &&
        row.message_object.some(object => object.object_type === "image" && object.model_type === op.request.model_id && object.object_url === op.wire.wire.settings.file_urls[0]!.url));
      if (owners.length !== 1 || (op.ownerEcho && op.ownerEcho !== owners[0]!.id)) fail("OWNER_ECHO_UNVERIFIED");
      // Each operation creates a fresh private chat; any additional human request makes ancestry ambiguous.
      if (history.messages.filter(row => row.author_id > 0).length !== 1) fail("OWNER_ECHO_UNVERIFIED");
      op.ownerEcho = owners[0]!.id; op.providerChat = provider;
      const candidates = history.messages.filter(row => row.author_id === -1 && row.message_object.some(object => object.object_type === "video"));
      const artifacts: OwnerRunwayI2vArtifact[] = [];
      for (const row of candidates) {
        if (!row.message_object.length || row.message_object.some(object => object.object_type !== "video" || object.model_type !== op.request.model_id ||
            object.completed !== true || !object.object_url || !isSafeUploadReferenceUrl(object.object_url) || object.object_url === op.wire.wire.settings.file_urls[0]!.url)) fail("RESULT_UNVERIFIED");
        const context = Object.freeze({ model_id: op.request.model_id }); RESULTS.set(context, { op, row });
        await this.#current(op, deadline);
        const result = rowSchema.parse(await deadline.waitFor(SyntxChatHttpClient.prototype.readOwnerRunwayI2vResult.call(op.client, context, deadline.signal)));
        await this.#current(op, deadline);
        if (schemaHash(result) !== schemaHash(row)) fail("RESULT_CHANGED");
        for (const object of result.message_object) {
          if (artifacts.length >= 64 || artifacts.some(item => item.object_url === object.object_url)) fail("RESULT_UNVERIFIED");
          const path = new URL(object.object_url!).pathname.toLowerCase();
          artifacts.push(Object.freeze({ object_index: artifacts.length, message_object_id: object.id, object_type: "video",
            object_url: object.object_url!, mime_type: path.endsWith(".mp4") ? "video/mp4" : path.endsWith(".mov") ? "video/quicktime" : null,
            message_id: row.id, chat_uuid: op.chat!.chat_uuid, model_id: op.request.model_id }));
        }
      }
      if (!artifacts.length) { op.result = operationUnknown(op, "RESULT_PENDING_OR_UNVERIFIED"); return op.result; }
      op.result = Object.freeze({ ...unknownResult(op.request.model_id, op.recovery, []), status: "completed", observed_artifact_count: artifacts.length, artifacts: Object.freeze(artifacts) });
      return op.result;
    } catch { op.result = operationUnknown(op, "OWNED_HISTORY_OR_RESULT_UNVERIFIED"); return op.result; }
  }
  #run<T>(attempt: string, signal: AbortSignal | undefined, work: (deadline: AbsoluteRequestDeadline) => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new OwnerRunwayI2vGenerationError("SERVICE_CLOSED"));
    if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) return Promise.reject(new OwnerRunwayI2vGenerationError("INVALID_REQUEST"));
    if (this.#busy.has(attempt) || this.#pending.size >= 4) return Promise.reject(new OwnerRunwayI2vGenerationError("SERVICE_BUSY"));
    const abort = new AbortController(); const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
    const deadline = new AbsoluteRequestDeadline(120000, combined, () => new OwnerRunwayI2vGenerationError("REQUEST_ABORTED"));
    this.#busy.add(attempt);
    const promise = Promise.resolve().then(() => work(deadline)).finally(() => { deadline.close(); this.#busy.delete(attempt); this.#pending.delete(promise); });
    this.#pending.set(promise, { attempt, abort }); return promise;
  }
  #time(): number {
    const value = this.#options.now(); if (!Number.isSafeInteger(value) || value < this.#lastTime) fail("CLOCK_INVALID");
    this.#lastTime = value; return value;
  }
}

/** Called only by the fixed native method. A fabricated token or clone has no state/dispatch authority. */
export function consumeOwnerRunwayI2vDispatch(client: SyntxChatHttpClient, token: unknown): Readonly<{ chat_uuid: string; body: Record<string, unknown> }> {
  const op = operation(client, token); op.validate(true);
  if (op.phase !== "READY" || !op.chat || CLAIMS.has(op.semantic)) fail("INTENT_ALREADY_CLAIMED");
  // No await between final validation, permanent claim and the native POST invocation.
  CLAIMS.add(op.semantic); op.phase = "POSTED";
  return Object.freeze({ chat_uuid: op.chat.chat_uuid, body: Object.freeze({ chat_id: op.chat.chat_uuid, prompt: op.wire.wire.prompt, settings: op.wire.wire.settings }) });
}
export function readOwnerRunwayI2vHistoryRoute(client: SyntxChatHttpClient, token: unknown): string {
  const op = operation(client, token); op.validate(false); if (op.phase !== "POSTED" || !op.chat) fail("OPERATION_NOT_DISPATCHED"); return op.chat.chat_uuid;
}
export function readOwnerRunwayI2vResultRoute(client: SyntxChatHttpClient, token: unknown): Readonly<{ chat_uuid: string; message_id: string }> {
  const state = token && typeof token === "object" && !types.isProxy(token) ? RESULTS.get(token) : undefined;
  if (!state || state.op.client !== client) fail("RESULT_CONTEXT_INVALID"); state.op.validate(false);
  if (state.op.phase !== "POSTED" || !state.op.chat || !state.op.ownerEcho || !state.op.providerChat) fail("RESULT_CONTEXT_INVALID");
  return Object.freeze({ chat_uuid: state.op.chat.chat_uuid, message_id: state.row.id });
}
function operation(client: SyntxChatHttpClient, token: unknown): Operation {
  const op = token && typeof token === "object" && !types.isProxy(token) ? OPERATIONS.get(token) : undefined;
  if (!op || op.client !== client || op.token !== token || op.invalid) fail("OPERATION_CONTEXT_INVALID"); return op;
}
/** Safe metadata only. Never retains an API body, header, credential, URL or provider error text. */
export function recordOwnerRunwayI2vTransport(client: SyntxChatHttpClient, token: unknown, observed: unknown): void {
  const op = token && typeof token === "object" && !types.isProxy(token) ? OPERATIONS.get(token) : undefined;
  if (!op || op.client !== client || op.phase !== "POSTED") return;
  if (typeof observed === "number" && Number.isInteger(observed) && observed >= 100 && observed <= 599 && op.responseStatus === undefined) op.responseStatus = observed;
  if (typeof observed === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(observed) && op.transportCode === undefined) op.transportCode = observed;
}
function unknownResult(model: ModelId, recovery: string, gaps: readonly string[]): OwnerRunwayI2vGenerationResult {
  return Object.freeze({ status: "outcome_unknown", recovery_id: recovery, model_id: model, status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY",
    provider_terminal_status: "UNPROVEN", backend_acceptance: "UNPROVEN", cost_cap_enforced: false, durability: "PROCESS_LOCAL_ONLY",
    observed_artifact_count: 0, artifacts: Object.freeze([]), gaps: Object.freeze([...gaps]) });
}
function operationUnknown(op: Operation, reason: string): OwnerRunwayI2vGenerationResult {
  return unknownResult(op.request.model_id, op.recovery, [reason,
    ...(op.responseStatus === undefined ? [] : [`GENERATION_HTTP_${op.responseStatus}`]),
    ...(op.transportCode === undefined ? [] : [`GENERATION_TRANSPORT_${op.transportCode}`])]);
}
function genuine(value: unknown, ctor: { prototype: object }, methods: readonly string[]): boolean {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === ctor.prototype &&
    methods.every(method => !Object.hasOwn(value, method) && typeof Reflect.get(ctor.prototype, method) === "function" && Reflect.get(value, method) === Reflect.get(ctor.prototype, method));
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value), found = Reflect.ownKeys(descriptors);
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value)) || found.length !== keys.length ||
      keys.some(key => !descriptors[key] || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true) ||
      found.some(key => typeof key !== "string" || !keys.includes(key))) fail("INVALID_REQUEST");
  return Object.fromEntries(keys.map(key => [key, descriptors[key]!.value]));
}
function fail(code: string): never { throw new OwnerRunwayI2vGenerationError(code); }
