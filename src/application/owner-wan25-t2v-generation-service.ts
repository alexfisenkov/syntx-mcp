import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { z } from "zod/v4";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import type { OwnerWan25T2vChatContext } from "../adapter/syntx/owner-wan25-t2v-chat-context.js";
import { SyntxHttpClient } from "../adapter/syntx/http-client.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { AuthBinding } from "../auth/types.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { AccountStatusService, type AccountStatusResult } from "./account-status.js";
import { ModelAccessService, type ModelAccessResult } from "./model-access.js";
import {
  loadOwnerWan25T2vRuntimeCatalog,
  normalizeOwnerWan25T2vParameters,
  OWNER_WAN25_T2V_MODEL_ID,
  OWNER_WAN25_T2V_PROFILE,
  type OwnerWan25T2vParameters
} from "./owner-wan25-t2v-parameters.js";

const MODEL_ID = OWNER_WAN25_T2V_MODEL_ID;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY = /^wan25_t2v_recovery_[0-9a-f-]{36}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const CLAIMS = new Set<string>();
const IN_FLIGHT = new Set<string>();
const OPERATIONS = new WeakMap<object, Operation>();
const RESULTS = new WeakMap<object, { readonly op: Operation; readonly row: HistoryRow }>();
const FRESHNESS_MS = 5 * 60_000;
const DISPATCH_QUOTE_MS = 15_000;

const OBJECT = z.object({
  id: z.union([z.string().regex(ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String),
  message_id: z.union([z.string().regex(ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String),
  object_type: z.string().max(128),
  object_text: z.string().max(20_000).nullable().optional(),
  object_url: z.string().max(4096).nullable().optional(),
  model_type: z.string().max(160).nullable().optional(),
  completed: z.boolean().nullable().optional()
}).strip();
const ROW = z.object({
  id: z.union([z.string().regex(ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String),
  chat_id: z.union([z.string().regex(ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String),
  author_id: z.number().int().safe(),
  message_object: z.array(OBJECT).max(64)
}).strip();
const HISTORY = z.object({
  messages: z.array(ROW).max(10),
  pagination: z.object({
    page: z.literal(1), page_size: z.literal(10), total_count: z.number().int().min(1).max(10),
    total_pages: z.literal(1), has_next: z.literal(false), has_previous: z.literal(false)
  }).strip()
}).strip();
type HistoryRow = z.infer<typeof ROW>;

export interface OwnerWan25T2vGenerationOptions {
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly catalog: DiscoveryCatalogRepository;
  readonly resolveChatClient: (attemptId: string) => SyntxChatHttpClient;
  readonly createReadClient: (attemptId: string) => SyntxHttpClient;
  readonly now: () => number;
}

export interface OwnerWan25T2vArtifact {
  readonly object_index: number;
  readonly message_object_id: string;
  readonly object_type: "video";
  readonly object_url: string;
  readonly mime_type: "video/mp4" | "video/quicktime" | null;
  readonly message_id: string;
  readonly chat_uuid: string;
  readonly model_id: typeof MODEL_ID;
}

export interface OwnerWan25T2vGenerationResult {
  readonly status: "completed" | "outcome_unknown";
  readonly recovery_id: string;
  readonly model_id: typeof MODEL_ID;
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly provider_terminal_status: "UNPROVEN";
  readonly backend_acceptance: "UNPROVEN";
  readonly cost_cap_enforced: false;
  readonly durability: "PROCESS_LOCAL_ONLY";
  readonly observed_artifact_count: number;
  readonly artifacts: readonly OwnerWan25T2vArtifact[];
  readonly gaps: readonly string[];
}

export class OwnerWan25T2vGenerationServiceError extends Error {
  constructor(readonly code: string) {
    super("The Wan 2.5 T2V operation could not be completed safely.");
    this.name = "OwnerWan25T2vGenerationServiceError";
  }
}

interface Request {
  readonly attemptId: string;
  readonly intent: Readonly<OwnerWan25T2vParameters>;
  readonly settings: Readonly<{
    model_type: typeof MODEL_ID;
    resolution: OwnerWan25T2vParameters["resolution"];
    aspect_ratio: OwnerWan25T2vParameters["aspect_ratio"];
    video_duration: 5 | 10;
    prompt_extend: boolean;
    seed: null;
    file_urls: readonly [];
  }>;
  readonly intent_fingerprint: string;
  readonly profile_sha256: string;
}

type Phase = "PREPARING" | "PREPARED" | "READY" | "POSTED" | "CHAT_UNKNOWN";
interface Operation {
  readonly token: object;
  readonly request: Request;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly client: SyntxChatHttpClient;
  readonly semantic: string;
  readonly recovery: string;
  readonly epoch: number;
  readonly validate: (dispatch: boolean) => void;
  chat?: OwnerWan25T2vChatContext;
  ack?: string;
  phase: Phase;
  quoteAt: number;
  invalid: boolean;
  responseStatus?: number;
  transportCode?: string;
  providerChat?: string;
  ownerEcho?: string;
  result: OwnerWan25T2vGenerationResult;
}

/** One exact text-only model profile, guarded by fresh account reads and GET-only recovery. */
export class OwnerWan25T2vGenerationService {
  readonly #options: OwnerWan25T2vGenerationOptions;
  readonly #records = new Map<string, Operation>();
  readonly #pending = new Map<Promise<unknown>, { readonly attempt: string; readonly abort: AbortController }>();
  readonly #busy = new Set<string>();
  readonly #epochs = new Map<string, number>();
  #lastTime = 0;
  #closed = false;

  constructor(options: OwnerWan25T2vGenerationOptions) {
    if (!options || types.isProxy(options) || !genuine(options.linkService, PerUserLinkService, ["getStatus"]) ||
        !genuine(options.catalog, DiscoveryCatalogRepository, ["getModel"]) ||
        typeof options.resolveChatClient !== "function" || typeof options.createReadClient !== "function" || typeof options.now !== "function") fail("INVALID_REQUEST");
    const { catalog: pinned } = loadOwnerWan25T2vRuntimeCatalog();
    if (options.catalog.fetched_at !== pinned.fetched_at ||
        schemaHash(options.catalog.getModel(MODEL_ID)) !== schemaHash(pinned.getModel(MODEL_ID)) ||
        schemaHash(options.catalog.source_hashes) !== schemaHash(pinned.source_hashes)) fail("MODEL_BINDING_MISMATCH");
    this.#options = Object.freeze({ ...options, binding: Object.freeze({ ...options.binding }) });
    this.#time();
    Object.freeze(this);
  }

  generate(input: unknown, signal?: AbortSignal): Promise<OwnerWan25T2vGenerationResult> {
    let fields: Record<string, unknown>;
    try { fields = exact(input, ["attemptId", "model_id", "prompt", "resolution", "aspect_ratio", "video_duration", "prompt_extend", "seed"]); }
    catch (error) { return Promise.reject(error); }
    const attemptId = fields.attemptId;
    if (typeof attemptId !== "string" || !ATTEMPT.test(attemptId)) return Promise.reject(new OwnerWan25T2vGenerationServiceError("INVALID_REQUEST"));
    let normalized: ReturnType<typeof normalizeOwnerWan25T2vParameters>;
    try {
      normalized = normalizeOwnerWan25T2vParameters({ model_id: fields.model_id, prompt: fields.prompt,
        resolution: fields.resolution, aspect_ratio: fields.aspect_ratio, video_duration: fields.video_duration,
        prompt_extend: fields.prompt_extend, seed: fields.seed });
    } catch { return Promise.reject(new OwnerWan25T2vGenerationServiceError("VALIDATION_REJECTED")); }
    const request: Request = Object.freeze({ attemptId, intent: normalized.intent, settings: normalized.settings,
      intent_fingerprint: normalized.intent_fingerprint, profile_sha256: normalized.profile_sha256 });

    return this.#run(attemptId, signal, async deadline => {
      const epoch = this.#epochs.get(attemptId) ?? 0;
      const principal = await deadline.waitFor(resolveOwnerReferencePrincipal({ binding: this.#options.binding, attemptId, linkService: this.#options.linkService }));
      const client = this.#options.resolveChatClient(attemptId);
      if (!genuine(client, SyntxChatHttpClient, ["createOwnerWan25T2vChat", "isOwnerWan25T2vChat", "invalidateOwnerWan25T2vChats",
        "startOwnerWan25T2vOperation", "readOwnerWan25T2vHistory", "readOwnerWan25T2vResult"])) fail("PRINCIPAL_NOT_LINKED");
      const semantic = schemaHash({ tenant: principal.tenant_id, subject: principal.subject_id, intent: request.intent_fingerprint });
      if (CLAIMS.has(semantic)) fail("INTENT_ALREADY_CLAIMED");
      if (IN_FLIGHT.has(semantic)) fail("SERVICE_BUSY");
      if (CLAIMS.size >= 8192 || this.#records.size >= 128) fail("CAPACITY_EXCEEDED");
      IN_FLIGHT.add(semantic);
      const recovery = `wan25_t2v_recovery_${randomUUID()}`;
      const token = Object.freeze({ model_id: MODEL_ID });
      const op: Operation = {
        token, request, principal, client, semantic, recovery, epoch, phase: "PREPARING", quoteAt: 0, invalid: false,
        result: unknownResult(recovery, ["NOT_DISPATCHED"]),
        validate: dispatch => {
          if (this.#closed || op.invalid || (this.#epochs.get(attemptId) ?? 0) !== epoch ||
              this.#options.resolveChatClient(attemptId) !== client || !genuine(client, SyntxChatHttpClient,
                ["createOwnerWan25T2vChat", "isOwnerWan25T2vChat", "invalidateOwnerWan25T2vChats", "startOwnerWan25T2vOperation",
                  "readOwnerWan25T2vHistory", "readOwnerWan25T2vResult"])) fail("PRINCIPAL_NOT_LINKED");
          if (op.chat && (op.chat.model_id !== MODEL_ID || op.chat.attempt_id !== attemptId ||
              !SyntxChatHttpClient.prototype.isOwnerWan25T2vChat.call(client, op.chat, attemptId))) fail("PRINCIPAL_NOT_LINKED");
          if (dispatch && request.profile_sha256 !== OWNER_WAN25_T2V_PROFILE.source_sha256) fail("MODEL_BINDING_MISMATCH");
          if (dispatch && op.phase === "READY" && (this.#time() < op.quoteAt || this.#time() - op.quoteAt > DISPATCH_QUOTE_MS)) fail("PREFLIGHT_EXPIRED");
        }
      };
      try {
        await this.#preflight(op, deadline);
        this.#records.set(recovery, op);
        OPERATIONS.set(token, op);
        await this.#current(op, deadline);
        op.validate(true);
        try {
          op.chat = await deadline.waitFor(SyntxChatHttpClient.prototype.createOwnerWan25T2vChat.call(client,
            { attemptId, title: `owner-wan25-t2v-${randomUUID()}` }, deadline.signal));
          op.validate(false);
        } catch {
          CLAIMS.add(semantic);
          op.phase = "CHAT_UNKNOWN";
          op.result = unknownResult(recovery, ["CHAT_CREATE_OUTCOME_UNKNOWN"]);
          return op.result;
        }
        const createdChat = op.chat;
        if (!createdChat) fail("PRINCIPAL_NOT_LINKED");

        await this.#preflight(op, deadline);
        await this.#current(op, deadline);
        op.validate(true);
        deadline.throwIfAborted();
        op.phase = "READY";
        try {
          const ack = await deadline.waitFor(SyntxChatHttpClient.prototype.startOwnerWan25T2vOperation.call(client, token, deadline.signal));
          if (ack !== undefined && ack !== null) {
            if (typeof ack !== "object" || types.isProxy(ack)) fail("ACK_UNVERIFIED");
            const ackRow = ack as { readonly chat_uuid?: unknown; readonly message_id?: unknown };
            if (ackRow.chat_uuid !== undefined && ackRow.chat_uuid !== null && ackRow.chat_uuid !== createdChat.chat_uuid) fail("ACK_UNVERIFIED");
            if (ackRow.message_id !== undefined && ackRow.message_id !== null) {
              if (typeof ackRow.message_id !== "string" || !ID.test(ackRow.message_id)) fail("ACK_UNVERIFIED");
              op.ack = ackRow.message_id;
            }
          }
        } catch {
          CLAIMS.add(semantic);
          op.phase = "POSTED";
          op.result = operationUnknown(op, "GENERATION_OUTCOME_UNKNOWN");
          return op.result;
        }
        return await this.#collect(op, deadline);
      } finally { IN_FLIGHT.delete(semantic); }
    });
  }

  reconcile(input: unknown, signal?: AbortSignal): Promise<OwnerWan25T2vGenerationResult> {
    let fields: Record<string, unknown>;
    try { fields = exact(input, ["attemptId", "recovery_id"]); } catch (error) { return Promise.reject(error); }
    if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) ||
        typeof fields.recovery_id !== "string" || !RECOVERY.test(fields.recovery_id)) return Promise.reject(new OwnerWan25T2vGenerationServiceError("INVALID_REQUEST"));
    const attempt = fields.attemptId, recovery = fields.recovery_id;
    return this.#run(attempt, signal, async deadline => {
      const op = this.#records.get(recovery);
      if (!op || op.request.attemptId !== attempt) fail("RECOVERY_NOT_FOUND");
      await this.#current(op, deadline);
      op.validate(false);
      if (op.phase !== "POSTED" || op.result.status === "completed") return op.result;
      return this.#collect(op, deadline);
    });
  }

  listRecoveries(input: unknown, signal?: AbortSignal): Promise<readonly OwnerWan25T2vGenerationResult[]> {
    let fields: Record<string, unknown>;
    try { fields = exact(input, ["attemptId"]); } catch (error) { return Promise.reject(error); }
    if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId)) return Promise.reject(new OwnerWan25T2vGenerationServiceError("INVALID_REQUEST"));
    const attempt = fields.attemptId;
    return this.#run(attempt, signal, async deadline => {
      const principal = await deadline.waitFor(resolveOwnerReferencePrincipal({ binding: this.#options.binding, attemptId: attempt, linkService: this.#options.linkService }));
      return Object.freeze([...this.#records.values()].filter(op => !op.invalid && op.request.attemptId === attempt &&
        sameGenerationPrincipal(op.principal, principal)).map(op => op.result));
    });
  }

  async invalidateAttempt(attemptId: string): Promise<void> {
    if (!ATTEMPT.test(attemptId)) return;
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    for (const op of this.#records.values()) if (op.request.attemptId === attemptId) {
      op.invalid = true;
      SyntxChatHttpClient.prototype.invalidateOwnerWan25T2vChats.call(op.client, attemptId);
    }
    const waits: Promise<unknown>[] = [];
    for (const [promise, entry] of this.#pending) if (entry.attempt === attemptId) { entry.abort.abort(); waits.push(promise); }
    await Promise.allSettled(waits);
    for (const [key, op] of this.#records) if (op.request.attemptId === attemptId) this.#records.delete(key);
  }

  async close(): Promise<void> {
    this.#closed = true;
    for (const entry of this.#pending.values()) entry.abort.abort();
    for (const op of this.#records.values()) {
      op.invalid = true;
      SyntxChatHttpClient.prototype.invalidateOwnerWan25T2vChats.call(op.client, op.request.attemptId);
    }
    await Promise.allSettled([...this.#pending.keys()]);
    this.#records.clear();
  }

  async #preflight(op: Operation, deadline: AbsoluteRequestDeadline): Promise<void> {
    await this.#current(op, deadline);
    op.validate(false);
    const read = this.#options.createReadClient(op.request.attemptId);
    if (!genuine(read, SyntxHttpClient, ["getAccountBalance", "getSubscription", "getModelInfo"])) fail("PREFLIGHT_FAILED");
    const account = await deadline.waitFor(new AccountStatusService(read, () => this.#time()).getAccountStatus(deadline.signal));
    if (account.subscription.active !== true || !account.subscription.plan_type || account.subscription.plan_type.toUpperCase() === "FREE") fail("SUBSCRIPTION_REQUIRED");
    const access = await deadline.waitFor(new ModelAccessService(this.#options.catalog, read, () => this.#time()).getModelAccess({
      model_id: MODEL_ID, cost_parameters: {
        resolution: op.request.intent.resolution, video_duration: op.request.intent.video_duration
      }
    }, deadline.signal));
    const quoteAt = assertFreshAffordableQuote(access, account, this.#options.catalog, this.#time());
    op.quoteAt = quoteAt;
    await this.#current(op, deadline);
    op.validate(false);
  }

  async #current(op: Operation, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted();
    op.validate(false);
    const principal = await deadline.waitFor(resolveOwnerReferencePrincipal({ binding: this.#options.binding,
      attemptId: op.request.attemptId, linkService: this.#options.linkService }));
    if (!sameGenerationPrincipal(principal, op.principal)) fail("PRINCIPAL_NOT_LINKED");
    deadline.throwIfAborted();
    op.validate(false);
  }

  async #collect(op: Operation, deadline: AbsoluteRequestDeadline): Promise<OwnerWan25T2vGenerationResult> {
    try {
      await this.#current(op, deadline);
      const raw = await deadline.waitFor(SyntxChatHttpClient.prototype.readOwnerWan25T2vHistory.call(op.client, op.token, deadline.signal));
      await this.#current(op, deadline);
      const history = HISTORY.parse(raw);
      if (history.pagination.total_count !== history.messages.length) fail("HISTORY_INCOMPLETE");
      const messageIds = new Set<string>(), objectIds = new Set<string>();
      const providerChat = history.messages[0]!.chat_id;
      if (op.providerChat && providerChat !== op.providerChat) fail("HISTORY_BINDING_MISMATCH");
      for (const row of history.messages) {
        if (row.chat_id !== providerChat || messageIds.has(row.id)) fail("HISTORY_BINDING_MISMATCH");
        messageIds.add(row.id);
        for (const object of row.message_object) {
          if (object.message_id !== row.id || objectIds.has(object.id)) fail("HISTORY_BINDING_MISMATCH");
          objectIds.add(object.id);
        }
      }
      const owners = history.messages.filter(row => row.author_id > 0 && (!op.ack || row.id === op.ack) &&
        row.message_object.filter(object => object.object_type === "text").length === 1 &&
        row.message_object.some(object => object.object_type === "text" && object.object_text === op.request.intent.prompt));
      if (owners.length !== 1 || (op.ownerEcho && owners[0]!.id !== op.ownerEcho) ||
          history.messages.filter(row => row.author_id > 0).length !== 1) fail("OWNER_ECHO_UNVERIFIED");
      op.ownerEcho = owners[0]!.id;
      op.providerChat = providerChat;
      const candidateRows = history.messages.filter(row => row.author_id === -1 && row.message_object.some(object => object.object_type === "video"));
      if (candidateRows.length === 0) {
        op.result = operationUnknown(op, "RESULT_PENDING_OR_UNVERIFIED");
        return op.result;
      }
      const artifacts: OwnerWan25T2vArtifact[] = [];
      for (const row of candidateRows) {
        if (row.message_object.length === 0 || row.message_object.some(object => object.object_type !== "video" ||
            object.model_type !== MODEL_ID || object.completed !== true || typeof object.object_url !== "string" ||
            !isSafeUploadReferenceUrl(object.object_url))) fail("RESULT_UNVERIFIED");
        const context = Object.freeze({ model_id: MODEL_ID });
        RESULTS.set(context, { op, row });
        await this.#current(op, deadline);
        const result = ROW.parse(await deadline.waitFor(SyntxChatHttpClient.prototype.readOwnerWan25T2vResult.call(op.client, context, deadline.signal)));
        await this.#current(op, deadline);
        if (schemaHash(result) !== schemaHash(row)) fail("RESULT_CHANGED");
        for (const object of result.message_object) {
          if (artifacts.length >= 64 || artifacts.some(artifact => artifact.object_url === object.object_url)) fail("RESULT_UNVERIFIED");
          const path = new URL(object.object_url!).pathname.toLowerCase();
          artifacts.push(Object.freeze({ object_index: artifacts.length, message_object_id: object.id, object_type: "video",
            object_url: object.object_url!, mime_type: path.endsWith(".mp4") ? "video/mp4" : path.endsWith(".mov") ? "video/quicktime" : null,
            message_id: row.id, chat_uuid: op.chat!.chat_uuid, model_id: MODEL_ID }));
        }
      }
      if (artifacts.length === 0) fail("RESULT_UNVERIFIED");
      op.result = Object.freeze({ ...unknownResult(op.recovery, []), status: "completed",
        observed_artifact_count: artifacts.length, artifacts: Object.freeze(artifacts) });
      return op.result;
    } catch {
      op.result = operationUnknown(op, "OWNED_HISTORY_OR_RESULT_UNVERIFIED");
      return op.result;
    }
  }

  #run<T>(attemptId: string, signal: AbortSignal | undefined, work: (deadline: AbsoluteRequestDeadline) => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new OwnerWan25T2vGenerationServiceError("SERVICE_CLOSED"));
    if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) return Promise.reject(new OwnerWan25T2vGenerationServiceError("INVALID_REQUEST"));
    if (this.#busy.has(attemptId) || this.#pending.size >= 4) return Promise.reject(new OwnerWan25T2vGenerationServiceError("SERVICE_BUSY"));
    const abort = new AbortController();
    const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
    const deadline = new AbsoluteRequestDeadline(120_000, combined, () => new OwnerWan25T2vGenerationServiceError("REQUEST_ABORTED"));
    this.#busy.add(attemptId);
    const promise = Promise.resolve().then(() => work(deadline)).finally(() => {
      deadline.close(); this.#busy.delete(attemptId); this.#pending.delete(promise);
    });
    this.#pending.set(promise, { attempt: attemptId, abort });
    return promise;
  }

  #time(): number {
    const value = this.#options.now();
    if (!Number.isSafeInteger(value) || value < this.#lastTime) fail("CLOCK_INVALID");
    this.#lastTime = value;
    return value;
  }
}

/** Called only by the native adapter's single POST method; context tokens are unforgeable. */
export function consumeOwnerWan25T2vDispatch(client: SyntxChatHttpClient, token: unknown): Readonly<{ chat_uuid: string; body: Record<string, unknown> }> {
  const op = operation(client, token);
  op.validate(true);
  if (op.phase !== "READY" || !op.chat || CLAIMS.has(op.semantic)) fail("INTENT_ALREADY_CLAIMED");
  CLAIMS.add(op.semantic);
  op.phase = "POSTED";
  return Object.freeze({ chat_uuid: op.chat.chat_uuid, body: Object.freeze({ chat_id: op.chat.chat_uuid,
    prompt: op.request.intent.prompt, settings: op.request.settings }) });
}

export function readOwnerWan25T2vHistoryRoute(client: SyntxChatHttpClient, token: unknown): string {
  const op = operation(client, token);
  op.validate(false);
  if (op.phase !== "POSTED" || !op.chat) fail("OPERATION_NOT_DISPATCHED");
  return op.chat.chat_uuid;
}

export function readOwnerWan25T2vResultRoute(client: SyntxChatHttpClient, token: unknown): Readonly<{ chat_uuid: string; message_id: string }> {
  const row = token && typeof token === "object" && !types.isProxy(token) ? RESULTS.get(token) : undefined;
  if (!row || row.op.client !== client) fail("RESULT_CONTEXT_INVALID");
  row.op.validate(false);
  if (row.op.phase !== "POSTED" || !row.op.chat || !row.op.ownerEcho || !row.op.providerChat) fail("RESULT_CONTEXT_INVALID");
  return Object.freeze({ chat_uuid: row.op.chat.chat_uuid, message_id: row.row.id });
}

/** Retains only allowlisted transport metadata, never response bodies or provider text. */
export function recordOwnerWan25T2vTransport(client: SyntxChatHttpClient, token: unknown, value: unknown): void {
  const op = token && typeof token === "object" && !types.isProxy(token) ? OPERATIONS.get(token) : undefined;
  if (!op || op.client !== client || op.phase !== "POSTED") return;
  if (typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 && op.responseStatus === undefined) op.responseStatus = value;
  if (typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(value) && op.transportCode === undefined) op.transportCode = value;
}

function operation(client: SyntxChatHttpClient, token: unknown): Operation {
  const op = token && typeof token === "object" && !types.isProxy(token) ? OPERATIONS.get(token) : undefined;
  if (!op || op.client !== client || op.token !== token || op.invalid) fail("OPERATION_CONTEXT_INVALID");
  return op;
}

function unknownResult(recovery: string, gaps: readonly string[]): OwnerWan25T2vGenerationResult {
  return Object.freeze({ status: "outcome_unknown", recovery_id: recovery, model_id: MODEL_ID,
    status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", provider_terminal_status: "UNPROVEN", backend_acceptance: "UNPROVEN",
    cost_cap_enforced: false, durability: "PROCESS_LOCAL_ONLY", observed_artifact_count: 0,
    artifacts: Object.freeze([]), gaps: Object.freeze([...gaps]) });
}
function operationUnknown(op: Operation, reason: string): OwnerWan25T2vGenerationResult {
  return unknownResult(op.recovery, [reason,
    ...(op.responseStatus === undefined ? [] : [`GENERATION_HTTP_${op.responseStatus}`]),
    ...(op.transportCode === undefined ? [] : [`GENERATION_TRANSPORT_${op.transportCode}`])]);
}

function assertFreshAffordableQuote(access: ModelAccessResult, account: AccountStatusResult,
  catalog: DiscoveryCatalogRepository, now: number): number {
  const expectedVersion = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
  const keys = [...access.parameter_keys].sort();
  if (access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || access.catalog_version !== expectedVersion ||
      access.model_id !== MODEL_ID || access.model_type !== MODEL_ID || access.ai_name !== "wan_video" ||
      access.account_read_live !== true || access.parameters_redacted !== true || access.access !== true ||
      keys.length !== 2 || keys[0] !== "resolution" || keys[1] !== "video_duration" ||
      !freshIso(access.observed_at, now) || !nullablePrice(access.cost) || !nullablePrice(access.discount_cost)) fail("PREFLIGHT_FAILED");
  const price = access.discount_cost ?? access.cost;
  const balance = account.balance.available;
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0 || account.balance.unit !== "tokens" ||
      typeof balance !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(balance) || !freshIso(account.observed_at, now) ||
      account.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || account.source_build !== ACCOUNT_SOURCE_BUILD || account.subscription.active !== true ||
      !account.subscription.plan_type || account.subscription.plan_type.toUpperCase() === "FREE" ||
      !decimalLte(String(price), balance)) fail("PREFLIGHT_FAILED");
  const stamp = Math.min(Date.parse(access.observed_at), Date.parse(account.observed_at));
  if (!Number.isFinite(stamp)) fail("PREFLIGHT_FAILED");
  return stamp;
}

function freshIso(value: unknown, now: number): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) && new Date(stamp).toISOString() === value && stamp <= now && now - stamp <= FRESHNESS_MS;
}
function nullablePrice(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}
function decimalLte(left: string, right: string): boolean {
  const parse = (value: string): { digits: bigint; scale: number } | null => {
    if (value.length > 128) return null;
    const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu.exec(value);
    if (!match) return null;
    const fraction = match[2] ?? "", exponent = Number(match[3] ?? 0);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) return null;
    let digits = BigInt(match[1]! + fraction), scale = fraction.length - exponent;
    if (scale < 0) { digits *= 10n ** BigInt(-scale); scale = 0; }
    return { digits, scale };
  };
  const a = parse(left), b = parse(right);
  if (!a || !b) return false;
  const scale = Math.max(a.scale, b.scale);
  return a.digits * 10n ** BigInt(scale - a.scale) <= b.digits * 10n ** BigInt(scale - b.scale);
}

function genuine(value: unknown, ctor: { prototype: object }, methods: readonly string[]): boolean {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === ctor.prototype &&
    methods.every(method => !Object.hasOwn(value, method) && typeof Reflect.get(ctor.prototype, method) === "function" &&
      Reflect.get(value, method) === Reflect.get(ctor.prototype, method));
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value), found = Reflect.ownKeys(descriptors);
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)) || found.length !== keys.length ||
        keys.some(key => !descriptors[key] || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true) ||
        found.some(key => typeof key !== "string" || !keys.includes(key))) fail("INVALID_REQUEST");
    return Object.fromEntries(keys.map(key => [key, descriptors[key]!.value]));
  } catch { return fail("INVALID_REQUEST"); }
}
function fail(code: string): never { throw new OwnerWan25T2vGenerationServiceError(code); }
