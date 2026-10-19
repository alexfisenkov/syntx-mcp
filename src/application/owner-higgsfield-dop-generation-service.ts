import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { z } from "zod/v4";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { SyntxHttpClient } from "../adapter/syntx/http-client.js";
import type { OwnerHiggsfieldDopChatContext } from "../adapter/syntx/owner-higgsfield-dop-chat-context.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { AuthBinding } from "../auth/types.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../catalog/public-catalog-history.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { AccountStatusService } from "./account-status.js";
import { ModelAccessService } from "./model-access.js";
import { buildOwnerHiggsfieldDopWire, type OwnerHiggsfieldDopWireCandidate } from "./owner-higgsfield-dop-wire.js";
import { normalizeOwnerHiggsfieldDopParameters, getOwnerHiggsfieldDopSourceProfile,
  type OwnerHiggsfieldDopModelId, type OwnerHiggsfieldDopMotionSelection } from "./owner-higgsfield-dop-parameters.js";
import { isOwnerHiggsfieldDopReferenceService, type OwnerHiggsfieldDopOwnedReference,
  type OwnerHiggsfieldDopReferenceService } from "./owner-higgsfield-dop-reference-service.js";

const MODEL_IDS = ["dop-lite", "dop-turbo"] as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY = /^higgsfield_dop_recovery_[0-9a-f-]{36}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const PROMPT_MAX_UTF16 = 1_000;
const OBSERVATION_FRESHNESS_MS = 15_000;
const MAX_DECIMAL_BYTES = 128;
const MAX_DECIMAL_EXPONENT = 64;
const MAX_OPERATIONS = 128;
const MAX_PENDING = 4;
const CLAIMS = new Set<string>();
const IN_FLIGHT = new Set<string>();
const OPERATIONS = new WeakMap<object, Operation>();
const RESULTS = new WeakMap<object, { op: Operation; row: HistoryRow }>();
const SERVICES = new WeakSet<object>();
const PARAMETERS = Object.freeze({});

export const OWNER_HIGGSFIELD_DOP_RUNTIME_CATALOG_VERSION =
  "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json" as const;
const AI_NAME = "higgsfield" as const;
const SCOPE = "video" as const;
const FORM_ID = "higgsfield" as const;

const motionId = z.union([z.string().min(1).max(160).refine(value => !/[\u0000-\u001f\u007f]/u.test(value)),
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]);
const motionSelection = z.object({ id: motionId, label: z.string().min(1).max(256), strength: z.literal(1) }).strict();
const GENERATE = z.object({ attemptId: z.string().regex(ATTEMPT), model_id: z.enum(MODEL_IDS), prompt: z.string().min(1).max(PROMPT_MAX_UTF16),
  enhance_prompt: z.literal(false), motions: z.array(motionSelection).min(1).max(2),
  reference_handle: z.string().regex(/^higgsfield_dop_reference_[0-9a-f-]{36}$/u) }).strict();
const id = z.union([z.string().regex(ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String);
const objectSchema = z.object({ id, message_id: id, object_type: z.string().max(128), object_text: z.string().max(20_000).nullable().optional(),
  object_url: z.string().max(4_096).nullable().optional(), model_type: z.string().max(160).nullable().optional(),
  completed: z.boolean().nullable().optional() }).strip();
const rowSchema = z.object({ id, chat_id: id, author_id: z.number().int().safe(), message_object: z.array(objectSchema).max(64) }).strip();
const historySchema = z.object({ messages: z.array(rowSchema).max(10), pagination: z.object({ page: z.literal(1), page_size: z.literal(10),
  total_count: z.number().int().min(1).max(10), total_pages: z.literal(1), has_next: z.literal(false), has_previous: z.literal(false) }).strip() }).strip();
type HistoryRow = z.infer<typeof rowSchema>;
type Request = Omit<z.infer<typeof GENERATE>, "motions"> & { readonly motions: readonly OwnerHiggsfieldDopMotionSelection[] };

export interface OwnerHiggsfieldDopCostBinding {
  readonly model_id: OwnerHiggsfieldDopModelId;
  readonly model_type: OwnerHiggsfieldDopModelId;
  readonly ai_name: typeof AI_NAME;
  readonly form_id: typeof FORM_ID;
  readonly scope: typeof SCOPE;
  readonly cost_keys: readonly [];
}
export interface OwnerHiggsfieldDopRuntimeCatalog {
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: typeof OWNER_HIGGSFIELD_DOP_RUNTIME_CATALOG_VERSION;
  readonly cost_bindings: readonly Readonly<OwnerHiggsfieldDopCostBinding>[];
}
export interface OwnerHiggsfieldDopGenerationOptions {
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly referenceService: OwnerHiggsfieldDopReferenceService;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalogDirectory?: string;
  readonly resolveChatClient: (attemptId: string) => SyntxChatHttpClient;
  readonly createReadClient: (attemptId: string) => SyntxHttpClient;
  readonly now: () => number;
}
export interface OwnerHiggsfieldDopArtifact {
  readonly object_index: number;
  readonly message_object_id: string;
  readonly object_type: "video";
  readonly object_url: string;
  readonly mime_type: "video/mp4" | "video/quicktime" | null;
  readonly message_id: string;
  readonly chat_uuid: string;
  readonly model_id: OwnerHiggsfieldDopModelId;
}
export interface OwnerHiggsfieldDopGenerationResult {
  readonly status: "completed" | "outcome_unknown";
  readonly recovery_id: string;
  readonly model_id: OwnerHiggsfieldDopModelId;
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly provider_terminal_status: "UNPROVEN";
  readonly backend_acceptance: "UNPROVEN";
  readonly cost_cap_enforced: false;
  readonly durability: "PROCESS_LOCAL_ONLY";
  readonly observed_artifact_count: number;
  readonly artifacts: readonly OwnerHiggsfieldDopArtifact[];
  readonly gaps: readonly string[];
}
export class OwnerHiggsfieldDopGenerationError extends Error {
  constructor(readonly code: string) { super("The owner Higgsfield DOP operation could not be completed safely."); this.name = "OwnerHiggsfieldDopGenerationError"; }
}
export class OwnerHiggsfieldDopCatalogBindingError extends Error {
  constructor(readonly code: "MODEL_BINDING_MISMATCH") {
    super("The pinned Higgsfield DOP catalog binding is invalid.");
    this.name = "OwnerHiggsfieldDopCatalogBindingError";
  }
}

interface Operation {
  readonly token: object;
  readonly request: Request;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly client: SyntxChatHttpClient;
  readonly reference: OwnerHiggsfieldDopOwnedReference;
  readonly wire: Readonly<OwnerHiggsfieldDopWireCandidate>;
  readonly semantic: string;
  readonly recovery: string;
  readonly validate: (dispatch: boolean) => void;
  chat?: OwnerHiggsfieldDopChatContext;
  ack?: string;
  phase: "PREPARING" | "READY" | "POSTED";
  quoteAt: number;
  invalid: boolean;
  responseStatus?: number;
  transportCode?: string;
  providerChat?: string;
  ownerEcho?: string;
  result: OwnerHiggsfieldDopGenerationResult;
}

/** Process-local owner generation flow. Every uncertain generation POST remains sticky and GET-only. */
export class OwnerHiggsfieldDopGenerationService {
  readonly #options: OwnerHiggsfieldDopGenerationOptions;
  readonly #records = new Map<string, Operation>();
  readonly #pending = new Map<Promise<unknown>, { attempt: string; abort: AbortController }>();
  readonly #busy = new Set<string>();
  readonly #epochs = new Map<string, number>();
  #lastTime = 0;
  #closed = false;

  constructor(options: OwnerHiggsfieldDopGenerationOptions) {
    if (!options || types.isProxy(options) || !isOwnerHiggsfieldDopReferenceService(options.referenceService) ||
        !genuine(options.linkService, PerUserLinkService, ["getStatus"]) ||
        !genuine(options.catalog, DiscoveryCatalogRepository, ["getModel"]) ||
        typeof options.resolveChatClient !== "function" || typeof options.createReadClient !== "function" || typeof options.now !== "function") fail("INVALID_REQUEST");
    const pinned = loadOwnerHiggsfieldDopRuntimeCatalog(options.catalogDirectory);
    if (options.catalog.fetched_at !== pinned.catalog.fetched_at || MODEL_IDS.some(model => schemaHash(options.catalog.getModel(model)) !== schemaHash(pinned.catalog.getModel(model))) ||
        schemaHash(options.catalog.source_hashes) !== schemaHash(pinned.catalog.source_hashes)) fail("MODEL_BINDING_MISMATCH");
    this.#options = Object.freeze({ ...options, binding: snapshotBinding(options.binding) });
    this.#time(); SERVICES.add(this); Object.freeze(this);
  }

  generate(input: unknown, signal?: AbortSignal): Promise<OwnerHiggsfieldDopGenerationResult> {
    let snapshot: Record<string, unknown>;
    try { snapshot = exact(input, ["attemptId", "model_id", "prompt", "enhance_prompt", "motions", "reference_handle"]); }
    catch (error) { return Promise.reject(error); }
    const parsed = GENERATE.safeParse(snapshot);
    if (!parsed.success) return Promise.reject(new OwnerHiggsfieldDopGenerationError("INVALID_REQUEST"));
    let normalized: ReturnType<typeof normalizeOwnerHiggsfieldDopParameters>;
    try { normalized = normalizeOwnerHiggsfieldDopParameters({model_id:parsed.data.model_id,prompt:parsed.data.prompt,
      enhance_prompt:parsed.data.enhance_prompt,motions:parsed.data.motions}); }
    catch { return Promise.reject(new OwnerHiggsfieldDopGenerationError("INVALID_REQUEST")); }
    const request = Object.freeze({ ...parsed.data, motions: normalized.intent.motions });
    return this.#run(request.attemptId, signal, async deadline => {
      const options = this.#options, epoch = this.#epochs.get(request.attemptId) ?? 0;
      const principal = await deadline.waitFor(resolveOwnerReferencePrincipal({ binding: options.binding, attemptId: request.attemptId, linkService: options.linkService }));
      const reference = await deadline.waitFor(options.referenceService.resolveReference({ attemptId: request.attemptId,
        model_id: request.model_id, reference_handle: request.reference_handle }, deadline.signal));
      if (!sameGenerationPrincipal(principal, reference.principal)) fail("PRINCIPAL_NOT_LINKED");
      const parameters = { model_id: request.model_id, prompt: request.prompt, enhance_prompt: request.enhance_prompt, motions: request.motions };
      const captured = options.referenceService.withCapturedReference(reference, { model_id: request.model_id }, (client, image) => ({
        client, wire: buildOwnerHiggsfieldDopWire(parameters, { url: image.url, sha256: image.sha256, width: image.width, height: image.height })
      }));
      const semantic = schemaHash({ tenant_id: principal.tenant_id, subject_id: principal.subject_id, intent: captured.wire.intent_fingerprint });
      if (CLAIMS.has(semantic)) fail("INTENT_ALREADY_CLAIMED");
      if (IN_FLIGHT.has(semantic)) fail("SERVICE_BUSY");
      if (CLAIMS.size >= 8_192 || this.#records.size >= MAX_OPERATIONS) fail("CAPACITY_EXCEEDED");
      IN_FLIGHT.add(semantic);
      const recovery = `higgsfield_dop_recovery_${randomUUID()}`, token = Object.freeze({ model_id: request.model_id });
      const operation: Operation = { token, request, principal, client: captured.client, reference, wire: captured.wire, semantic, recovery,
        phase: "PREPARING", quoteAt: 0, invalid: false, result: unknownResult(request.model_id, recovery, ["NOT_DISPATCHED"]), validate: dispatch => {
          if (this.#closed || operation.invalid || (this.#epochs.get(request.attemptId) ?? 0) !== epoch ||
              this.#options.resolveChatClient(request.attemptId) !== operation.client || !genuine(operation.client, SyntxChatHttpClient,
                ["createOwnerHiggsfieldDopChat", "isOwnerHiggsfieldDopChat", "invalidateOwnerHiggsfieldDopChats",
                  "startOwnerHiggsfieldDopOperation", "readOwnerHiggsfieldDopHistory", "readOwnerHiggsfieldDopResult"])) fail("PRINCIPAL_NOT_LINKED");
          if (operation.chat && (operation.chat.model_id !== request.model_id ||
              !SyntxChatHttpClient.prototype.isOwnerHiggsfieldDopChat.call(operation.client, operation.chat, request.attemptId))) fail("PRINCIPAL_NOT_LINKED");
          if (dispatch && (!this.#options.referenceService.isOwnedReference(reference) || reference.expires_at <= this.#time() ||
              operation.wire.profile_sha256 !== getOwnerHiggsfieldDopSourceProfile().source_sha256)) fail("REFERENCE_EXPIRED");
          if (dispatch && operation.phase === "READY" && (this.#time() < operation.quoteAt || this.#time() - operation.quoteAt > OBSERVATION_FRESHNESS_MS)) fail("PREFLIGHT_EXPIRED");
        } };
      try {
        await this.#preflight(operation, deadline);
        this.#records.set(recovery, operation); OPERATIONS.set(token, operation);
        await this.#current(operation, deadline); operation.validate(true);
        try {
          operation.chat = await deadline.waitFor(SyntxChatHttpClient.prototype.createOwnerHiggsfieldDopChat.call(operation.client,
            { attemptId: request.attemptId, model_id: request.model_id, title: `owner-higgsfield-dop-${randomUUID()}` }, deadline.signal));
        } catch {
          CLAIMS.add(semantic); operation.result = unknownResult(request.model_id, recovery, ["CHAT_CREATE_OUTCOME_UNKNOWN"]); return operation.result;
        }
        await this.#preflight(operation, deadline);
        await this.#current(operation, deadline); operation.validate(true); deadline.throwIfAborted();
        operation.phase = "READY";
        try {
          const ack = await deadline.waitFor(SyntxChatHttpClient.prototype.startOwnerHiggsfieldDopOperation.call(operation.client, token, deadline.signal));
          if (ack.chat_uuid !== operation.chat.chat_uuid || !ID.test(ack.message_id)) fail("ACK_UNVERIFIED");
          operation.ack = ack.message_id;
        } catch {
          operation.result = operationUnknown(operation, "GENERATION_OUTCOME_UNKNOWN"); return operation.result;
        }
        return await this.#collect(operation, deadline);
      } finally { IN_FLIGHT.delete(semantic); }
    });
  }

  reconcile(input: unknown, signal?: AbortSignal): Promise<OwnerHiggsfieldDopGenerationResult> {
    let fields: Record<string, unknown>;
    try { fields = exact(input, ["attemptId", "recovery_id"]); } catch (error) { return Promise.reject(error); }
    if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || typeof fields.recovery_id !== "string" || !RECOVERY.test(fields.recovery_id)) {
      return Promise.reject(new OwnerHiggsfieldDopGenerationError("INVALID_REQUEST"));
    }
    const attempt = fields.attemptId, recovery = fields.recovery_id;
    return this.#run(attempt, signal, async deadline => {
      const operation = this.#records.get(recovery);
      if (!operation || operation.request.attemptId !== attempt) fail("RECOVERY_NOT_FOUND");
      await this.#current(operation, deadline); operation.validate(false);
      if (operation.phase !== "POSTED" || operation.result.status === "completed") return operation.result;
      return this.#collect(operation, deadline);
    });
  }

  listRecoveries(input: unknown, signal?: AbortSignal): Promise<readonly OwnerHiggsfieldDopGenerationResult[]> {
    let fields: Record<string, unknown>;
    try { fields = exact(input, ["attemptId"]); } catch (error) { return Promise.reject(error); }
    if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId)) return Promise.reject(new OwnerHiggsfieldDopGenerationError("INVALID_REQUEST"));
    const attempt = fields.attemptId;
    return this.#run(attempt, signal, async deadline => {
      const principal = await deadline.waitFor(resolveOwnerReferencePrincipal({ binding: this.#options.binding, attemptId: attempt, linkService: this.#options.linkService }));
      const rows = [...this.#records.values()].filter(operation => operation.request.attemptId === attempt && sameGenerationPrincipal(operation.principal, principal));
      return Object.freeze(rows.map(operation => operation.result));
    });
  }

  async invalidateAttempt(attempt: string): Promise<void> {
    if (!ATTEMPT.test(attempt)) return;
    this.#epochs.set(attempt, (this.#epochs.get(attempt) ?? 0) + 1);
    for (const operation of this.#records.values()) if (operation.request.attemptId === attempt) {
      operation.invalid = true;
      try { SyntxChatHttpClient.prototype.invalidateOwnerHiggsfieldDopChats.call(operation.client, attempt); } catch { /* fence local state regardless */ }
    }
    await this.#options.referenceService.invalidateAttempt(attempt);
    const pending = [...this.#pending].filter(([, value]) => value.attempt === attempt);
    for (const [, value] of pending) value.abort.abort();
    await Promise.allSettled(pending.map(([promise]) => promise));
  }

  async close(): Promise<void> {
    this.#closed = true;
    for (const entry of this.#pending.values()) entry.abort.abort();
    for (const operation of this.#records.values()) {
      operation.invalid = true;
      try { SyntxChatHttpClient.prototype.invalidateOwnerHiggsfieldDopChats.call(operation.client, operation.request.attemptId); } catch { /* closing */ }
    }
    await Promise.allSettled([...this.#pending.keys()]); this.#records.clear();
  }

  async #preflight(operation: Operation, deadline: AbsoluteRequestDeadline): Promise<void> {
    await this.#current(operation, deadline); operation.validate(true);
    const read = this.#options.createReadClient(operation.request.attemptId);
    if (!genuine(read, SyntxHttpClient, ["getAccountBalance", "getSubscription", "getModelInfo", "listOwnerHiggsfieldDopMotions"])) fail("PREFLIGHT_FAILED");
    const account = await deadline.waitFor(new AccountStatusService(read, () => this.#time()).getAccountStatus(deadline.signal));
    const access = await deadline.waitFor(new ModelAccessService(this.#options.catalog, read, () => this.#time()).getModelAccess({
      model_id: operation.request.model_id, cost_parameters: PARAMETERS }, deadline.signal));
    const motions = await deadline.waitFor(SyntxHttpClient.prototype.listOwnerHiggsfieldDopMotions.call(read, deadline.signal));
    assertRequestedMotions(operation.request.motions, motions);
    const expectedVersion = `${this.#options.catalog.fetched_at}.${this.#options.catalog.source_hashes.models.slice(7, 19)}`;
    const now = this.#time();
    validateFreshAffordableModelAccess(access, account, operation.request.model_id, expectedVersion, now);
    operation.quoteAt = Math.min(Date.parse(account.observed_at), Date.parse(access.observed_at));
    await this.#current(operation, deadline); operation.validate(true);
  }

  async #current(operation: Operation, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted(); operation.validate(false);
    const current = await deadline.waitFor(resolveOwnerReferencePrincipal({ binding: this.#options.binding,
      attemptId: operation.request.attemptId, linkService: this.#options.linkService }));
    if (!sameGenerationPrincipal(current, operation.principal)) fail("PRINCIPAL_NOT_LINKED");
    deadline.throwIfAborted(); operation.validate(false);
  }

  async #collect(operation: Operation, deadline: AbsoluteRequestDeadline): Promise<OwnerHiggsfieldDopGenerationResult> {
    try {
      await this.#current(operation, deadline);
      const raw = await deadline.waitFor(SyntxChatHttpClient.prototype.readOwnerHiggsfieldDopHistory.call(operation.client, operation.token, deadline.signal));
      await this.#current(operation, deadline);
      const history = historySchema.parse(raw);
      if (history.pagination.total_count !== history.messages.length) fail("HISTORY_INCOMPLETE");
      const messageIds = new Set<string>(), objectIds = new Set<string>();
      const providerChat = history.messages[0]!.chat_id;
      if (operation.providerChat && providerChat !== operation.providerChat) fail("HISTORY_BINDING_MISMATCH");
      for (const row of history.messages) {
        if (row.chat_id !== providerChat || messageIds.has(row.id)) fail("HISTORY_BINDING_MISMATCH"); messageIds.add(row.id);
        for (const object of row.message_object) { if (object.message_id !== row.id || objectIds.has(object.id)) fail("HISTORY_BINDING_MISMATCH"); objectIds.add(object.id); }
      }
      const imageUrl = operation.wire.wire.settings.file_urls[0]!.url;
      const owners = history.messages.filter(row => row.author_id > 0 && (!operation.ack || row.id === operation.ack) &&
        row.message_object.filter(object => object.object_type === "text").length === 1 &&
        row.message_object.some(object => object.object_type === "text" && object.object_text === operation.request.prompt) &&
        row.message_object.filter(object => object.object_type === "image").length === 1 &&
        row.message_object.some(object => object.object_type === "image" && object.model_type === operation.request.model_id && object.object_url === imageUrl));
      if (owners.length !== 1 || (operation.ownerEcho && operation.ownerEcho !== owners[0]!.id) ||
          history.messages.filter(row => row.author_id > 0).length !== 1) fail("OWNER_ECHO_UNVERIFIED");
      operation.ownerEcho = owners[0]!.id; operation.providerChat = providerChat;
      const candidates = history.messages.filter(row => row.author_id === -1 && row.message_object.some(object => object.object_type === "video"));
      const artifacts: OwnerHiggsfieldDopArtifact[] = [];
      for (const row of candidates) {
        if (!row.message_object.length || row.message_object.some(object => object.object_type !== "video" || object.model_type !== operation.request.model_id ||
            object.completed !== true || !object.object_url || !isSafeUploadReferenceUrl(object.object_url) || object.object_url === imageUrl)) fail("RESULT_UNVERIFIED");
        const context = Object.freeze({ model_id: operation.request.model_id }); RESULTS.set(context, { op: operation, row });
        await this.#current(operation, deadline);
        const result = rowSchema.parse(await deadline.waitFor(SyntxChatHttpClient.prototype.readOwnerHiggsfieldDopResult.call(operation.client, context, deadline.signal)));
        await this.#current(operation, deadline);
        if (schemaHash(result) !== schemaHash(row)) fail("RESULT_CHANGED");
        for (const object of result.message_object) {
          if (artifacts.length >= 64 || artifacts.some(artifact => artifact.object_url === object.object_url)) fail("RESULT_UNVERIFIED");
          const path = new URL(object.object_url!).pathname.toLowerCase();
          artifacts.push(Object.freeze({ object_index: artifacts.length, message_object_id: object.id, object_type: "video",
            object_url: object.object_url!, mime_type: path.endsWith(".mp4") ? "video/mp4" : path.endsWith(".mov") ? "video/quicktime" : null,
            message_id: row.id, chat_uuid: operation.chat!.chat_uuid, model_id: operation.request.model_id }));
        }
      }
      if (!artifacts.length) { operation.result = operationUnknown(operation, "RESULT_PENDING_OR_UNVERIFIED"); return operation.result; }
      operation.result = Object.freeze({ ...unknownResult(operation.request.model_id, operation.recovery, []), status: "completed",
        observed_artifact_count: artifacts.length, artifacts: Object.freeze(artifacts) });
      return operation.result;
    } catch { operation.result = operationUnknown(operation, "OWNED_HISTORY_OR_RESULT_UNVERIFIED"); return operation.result; }
  }

  #run<T>(attempt: string, signal: AbortSignal | undefined, work: (deadline: AbsoluteRequestDeadline) => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new OwnerHiggsfieldDopGenerationError("SERVICE_CLOSED"));
    if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) return Promise.reject(new OwnerHiggsfieldDopGenerationError("INVALID_REQUEST"));
    if (this.#busy.has(attempt) || this.#pending.size >= MAX_PENDING) return Promise.reject(new OwnerHiggsfieldDopGenerationError("SERVICE_BUSY"));
    const abort = new AbortController(), combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
    const deadline = new AbsoluteRequestDeadline(120_000, combined, () => new OwnerHiggsfieldDopGenerationError("REQUEST_ABORTED"));
    this.#busy.add(attempt);
    const promise = Promise.resolve().then(() => work(deadline)).finally(() => {
      deadline.close(); this.#busy.delete(attempt); this.#pending.delete(promise);
    });
    this.#pending.set(promise, { attempt, abort }); return promise;
  }
  #time(): number {
    let value: unknown; try { value = this.#options.now(); } catch { fail("CLOCK_INVALID"); }
    if (!Number.isSafeInteger(value) || (value as number) < this.#lastTime) fail("CLOCK_INVALID");
    this.#lastTime = value as number; return value as number;
  }
}
Object.freeze(OwnerHiggsfieldDopGenerationService.prototype);

export function isOwnerHiggsfieldDopGenerationService(value: unknown): value is OwnerHiggsfieldDopGenerationService {
  return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) &&
    Object.getPrototypeOf(value) === OwnerHiggsfieldDopGenerationService.prototype && Object.isFrozen(value);
}

/** Loads the exact local public snapshot and binds both DOP IDs to the empty cost-parameter set. */
export function loadOwnerHiggsfieldDopRuntimeCatalog(catalogDirectory?: string): Readonly<OwnerHiggsfieldDopRuntimeCatalog> {
  try {
    const snapshot = loadPublicCatalogVersion(OWNER_HIGGSFIELD_DOP_RUNTIME_CATALOG_VERSION, catalogDirectory);
    const catalog = new DiscoveryCatalogRepository(snapshot), ai = snapshot.ai.find(item => item.value === AI_NAME);
    if (!ai?.active || ai.scope !== SCOPE) return invalidCatalog();
    const bindings = MODEL_IDS.map(modelId => {
      const model = catalog.getModel(modelId), settings = model.settings, acceptedFileTypes = model.settings?.accepted_file_types;
      if (!model.active || model.id !== modelId || model.upstream_id !== modelId || model.ai_name !== AI_NAME ||
          !settings || !Array.isArray(settings.get_cost_params) || settings.get_cost_params.length !== 0 ||
          !Array.isArray(settings.allowed_media_types) || !settings.allowed_media_types.includes("images") || settings.file_count_limit !== 1 ||
          settings.uploadable !== true || !Array.isArray(acceptedFileTypes) ||
          !["image/jpeg", "image/jpg", "image/avif", "image/webp", "image/png"].every(type => acceptedFileTypes.includes(type))) return invalidCatalog();
      return Object.freeze({ model_id: modelId, model_type: modelId, ai_name: AI_NAME, form_id: FORM_ID, scope: SCOPE,
        cost_keys: Object.freeze([] as const) });
    });
    return Object.freeze({ catalog, catalog_version: OWNER_HIGGSFIELD_DOP_RUNTIME_CATALOG_VERSION, cost_bindings: Object.freeze(bindings) });
  } catch (error) { if (error instanceof OwnerHiggsfieldDopCatalogBindingError) throw error; return invalidCatalog(); }
}

export function consumeOwnerHiggsfieldDopDispatch(client: SyntxChatHttpClient, token: unknown): Readonly<{ chat_uuid: string; body: Record<string, unknown> }> {
  const operation = getOperation(client, token); operation.validate(true);
  if (operation.phase !== "READY" || !operation.chat || CLAIMS.has(operation.semantic)) fail("INTENT_ALREADY_CLAIMED");
  CLAIMS.add(operation.semantic); operation.phase = "POSTED";
  return Object.freeze({ chat_uuid: operation.chat.chat_uuid,
    body: Object.freeze({ chat_id: operation.chat.chat_uuid, prompt: operation.wire.wire.prompt, settings: operation.wire.wire.settings }) });
}
export function readOwnerHiggsfieldDopHistoryRoute(client: SyntxChatHttpClient, token: unknown): string {
  const operation = getOperation(client, token);
  operation.validate(false); if (operation.phase !== "POSTED" || !operation.chat) fail("OPERATION_NOT_DISPATCHED"); return operation.chat.chat_uuid;
}
export function readOwnerHiggsfieldDopResultRoute(client: SyntxChatHttpClient, token: unknown): Readonly<{ chat_uuid: string; message_id: string }> {
  const state = token && typeof token === "object" && !types.isProxy(token) ? RESULTS.get(token) : undefined;
  if (!state || state.op.client !== client) fail("RESULT_CONTEXT_INVALID"); state.op.validate(false);
  if (state.op.phase !== "POSTED" || !state.op.chat || !state.op.ownerEcho || !state.op.providerChat) fail("RESULT_CONTEXT_INVALID");
  return Object.freeze({ chat_uuid: state.op.chat.chat_uuid, message_id: state.row.id });
}
export function recordOwnerHiggsfieldDopTransport(client: SyntxChatHttpClient, token: unknown, observed: unknown): void {
  const operation = token && typeof token === "object" && !types.isProxy(token) ? OPERATIONS.get(token) : undefined;
  if (!operation || operation.client !== client || operation.phase !== "POSTED") return;
  if (typeof observed === "number" && Number.isInteger(observed) && observed >= 100 && observed <= 599 && operation.responseStatus === undefined) operation.responseStatus = observed;
  if (typeof observed === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(observed) && operation.transportCode === undefined) operation.transportCode = observed;
}

function validateFreshAffordableModelAccess(access: unknown, account: unknown, modelId: OwnerHiggsfieldDopModelId,
  expectedCatalogVersion: string, now: number): number {
  const a = exactRecord(access, ["catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live", "parameter_keys",
    "parameters_redacted", "access", "cost", "discount_cost", "free_remaining_generations", "limit", "show_warning", "observed_at"]);
  if (a.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || a.catalog_version !== expectedCatalogVersion || a.model_id !== modelId ||
      a.model_type !== modelId || a.ai_name !== AI_NAME || a.account_read_live !== true || a.parameters_redacted !== true || a.access !== true ||
      !exactEmptyStrings(a.parameter_keys) || !fresh(a.observed_at, now) || !nullableFinite(a.cost) || !nullableFinite(a.discount_cost) ||
      !(a.free_remaining_generations === null || nonnegativeInteger(a.free_remaining_generations)) || !nullableFinite(a.limit) ||
      !(a.show_warning === null || typeof a.show_warning === "boolean")) fail("PREFLIGHT_FAILED");
  const price = a.discount_cost ?? a.cost;
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0) fail("PREFLIGHT_FAILED");
  const row = exactRecord(account, ["balance", "subscription", "contract_evidence", "source_build", "observed_at"]);
  const balance = exactRecord(row.balance, ["unit", "available"]), subscription = exactRecord(row.subscription,
    ["active", "plan_type", "end_date", "end_date_kind"]);
  if (row.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || row.source_build !== ACCOUNT_SOURCE_BUILD || !fresh(row.observed_at, now) ||
      balance.unit !== "tokens" || typeof balance.available !== "string" || balance.available.length > MAX_DECIMAL_BYTES ||
      !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(balance.available) || subscription.active !== true ||
      typeof subscription.plan_type !== "string" || !subscription.plan_type || subscription.plan_type.toUpperCase() === "FREE" ||
      !(subscription.end_date === null || typeof subscription.end_date === "string") ||
      !(subscription.end_date_kind === null || ["DATE_ONLY", "LOCAL_DATETIME", "OFFSET_DATETIME"].includes(subscription.end_date_kind as string)) ||
      !decimalLte(String(price), balance.available)) fail("PREFLIGHT_FAILED");
  return price;
}

function getOperation(client: SyntxChatHttpClient, token: unknown): Operation {
  const operation = token && typeof token === "object" && !types.isProxy(token) ? OPERATIONS.get(token) : undefined;
  if (!operation || operation.client !== client || operation.token !== token || operation.invalid) fail("OPERATION_CONTEXT_INVALID");
  return operation;
}
function unknownResult(modelId: OwnerHiggsfieldDopModelId, recovery: string, gaps: readonly string[]): OwnerHiggsfieldDopGenerationResult {
  return Object.freeze({ status: "outcome_unknown", recovery_id: recovery, model_id: modelId, status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY",
    provider_terminal_status: "UNPROVEN", backend_acceptance: "UNPROVEN", cost_cap_enforced: false, durability: "PROCESS_LOCAL_ONLY",
    observed_artifact_count: 0, artifacts: Object.freeze([]), gaps: Object.freeze([...gaps]) });
}
function operationUnknown(operation: Operation, reason: string): OwnerHiggsfieldDopGenerationResult {
  return unknownResult(operation.request.model_id, operation.recovery, [reason,
    ...(operation.responseStatus === undefined ? [] : [`GENERATION_HTTP_${operation.responseStatus}`]),
    ...(operation.transportCode === undefined ? [] : [`GENERATION_TRANSPORT_${operation.transportCode}`])]);
}
function assertRequestedMotions(requested: readonly { readonly id: string | number; readonly label: string; readonly strength: 1 }[],
  catalogue: readonly { readonly id: string | number; readonly title: string }[]): void {
  if (requested.length < 1 || requested.length > 2 || requested.some(selection => selection.strength !== 1 ||
      !catalogue.some(row => typeof row.id === typeof selection.id && row.id === selection.id && row.title === selection.label))) {
    fail("PREFLIGHT_FAILED");
  }
}
function genuine(value: unknown, constructor: { prototype: object }, methods: readonly string[]): boolean {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === constructor.prototype &&
    methods.every(method => !Object.hasOwn(value, method) && typeof Reflect.get(constructor.prototype, method) === "function" &&
      Reflect.get(value, method) === Reflect.get(constructor.prototype, method));
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  return exactRecord(value, keys);
}
function exactRecord(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== required.length ||
        required.some(key => !Object.hasOwn(descriptors, key)) || keys.some(key => typeof key !== "string" || !required.includes(key) ||
          !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) output[key] = descriptors[key]!.value;
    return output;
  } catch { return fail("INVALID_REQUEST"); }
}
function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || !fields.tenant_id || fields.tenant_id.length > 256 ||
      typeof fields.subject !== "string" || !fields.subject || fields.subject.length > 512 ||
      /[\u0000-\u001f\u007f]/u.test(fields.tenant_id) || /[\u0000-\u001f\u007f]/u.test(fields.subject)) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}
function fresh(value: unknown, now: number): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value && timestamp <= now && now - timestamp <= OBSERVATION_FRESHNESS_MS;
}
function nullableFinite(value: unknown): boolean { return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0); }
function nonnegativeInteger(value: unknown): boolean { return Number.isSafeInteger(value) && (value as number) >= 0; }
function exactEmptyStrings(value: unknown): boolean {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap, length = descriptors.length;
    if (Reflect.ownKeys(descriptors).length !== 1 || !length || !Object.hasOwn(length, "value")) return false;
    return length.value === 0 && length.enumerable === false;
  } catch { return false; }
}
function decimalLte(left: string, right: string): boolean {
  const parse = (value: string): { digits: bigint; scale: number } | null => {
    if (value.length > MAX_DECIMAL_BYTES) return null;
    const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu.exec(value); if (!match) return null;
    const fraction = match[2] ?? "", exponent = Number(match[3] ?? 0);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_DECIMAL_EXPONENT) return null;
    let digits = BigInt(match[1]! + fraction), scale = fraction.length - exponent;
    if (scale < 0) { digits *= 10n ** BigInt(-scale); scale = 0; }
    return { digits, scale };
  };
  const a = parse(left), b = parse(right); if (!a || !b) return false;
  const scale = Math.max(a.scale, b.scale);
  return a.digits * 10n ** BigInt(scale - a.scale) <= b.digits * 10n ** BigInt(scale - b.scale);
}
function fail(code: string): never { throw new OwnerHiggsfieldDopGenerationError(code); }
function invalidCatalog(): never { throw new OwnerHiggsfieldDopCatalogBindingError("MODEL_BINDING_MISMATCH"); }
