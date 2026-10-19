import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCostParameter } from "../adapter/syntx/http-client.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../catalog/public-catalog-history.js";
import { AccountStatusService, type AccountStatusResult } from "./account-status.js";
import { ModelAccessService, type ModelAccessResult } from "./model-access.js";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import type { OwnerHailuoInitialChatContext } from "../adapter/syntx/owner-hailuo-initial-native-context.js";
import { bindOwnerHailuoInitialAck, bindOwnerHailuoInitialOwnerEcho, bindOwnerHailuoInitialResultContext,
  isOwnerHailuoInitialChatContextForClient, readOwnerHailuoInitialTransport, registerOwnerHailuoInitialOperation } from "../adapter/syntx/owner-hailuo-initial-native-context.js";
import { buildOwnerHailuoInitialWire, type OwnerHailuoInitialWireCandidate } from "./owner-hailuo-media-wire.js";
import { getOwnerHailuoInitialSourceProfile, normalizeOwnerHailuoInitialParameters,
  type OwnerHailuoInitialModelId } from "./owner-hailuo-media-parameters.js";
import { isOwnerHailuoInitialImageVault, type OwnerHailuoInitialImageVault, type OwnerHailuoInitialOwnedImage } from "./owner-hailuo-initial-image-vault.js";

export const OWNER_HAILUO_INITIAL_CATALOG_VERSION = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json" as const;
const MODEL_IDS = ["hailuo-2.3-fast", "hailuo-01-live-character", "hailuo-3.0"] as const;
const AI_NAME = "hailuo-minimax" as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY = /^hailuo_initial_recovery_[0-9a-f-]{36}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const FRESH_MS = 15_000, MAX_PENDING = 4;
const SERVICES = new WeakSet<object>(), CLAIMS = new Set<string>(), IN_FLIGHT = new Set<string>();

export interface OwnerHailuoInitialGenerationOptions {
  readonly binding: AuthBinding; readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly imageVault: OwnerHailuoInitialImageVault; readonly catalog: DiscoveryCatalogRepository; readonly catalogDirectory?: string;
  readonly resolveChatClient: (attemptId: string) => unknown; readonly createReadClient: (attemptId: string) => unknown;
  readonly now: () => number; readonly timeoutMs?: number;
}
export interface OwnerHailuoInitialGenerateInput {
  readonly attemptId: string; readonly model_id: OwnerHailuoInitialModelId; readonly prompt: string; readonly resolution: string;
  readonly video_duration: number; readonly aspect_ratio?: string; readonly mode?: string; readonly reference_handle: string;
}
export interface OwnerHailuoInitialArtifact {
  readonly object_index: number; readonly message_object_id: string; readonly object_type: "video"; readonly object_url: string;
  readonly mime_type: "video/mp4" | "video/quicktime" | null; readonly message_id: string; readonly chat_uuid: string;
  readonly model_id: OwnerHailuoInitialModelId;
}
export interface OwnerHailuoInitialResult {
  readonly status: "completed" | "outcome_unknown"; readonly recovery_id: string; readonly model_id: OwnerHailuoInitialModelId;
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY"; readonly provider_terminal_status: "UNPROVEN";
  readonly backend_acceptance: "UNPROVEN"; readonly cost_cap_enforced: false; readonly durability: "PROCESS_LOCAL_ONLY";
  readonly observed_artifact_count: number; readonly artifacts: readonly OwnerHailuoInitialArtifact[]; readonly gaps: readonly string[];
}
interface Operation {
  readonly request: OwnerHailuoInitialGenerateInput; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly client: SyntxChatHttpClient; readonly reference: OwnerHailuoInitialOwnedImage; readonly wire: OwnerHailuoInitialWireCandidate;
  readonly token: object; readonly recovery: string; readonly semantic: string; readonly epoch: number;
  chat?: OwnerHailuoInitialChatContext; phase: "PREPARING" | "READY" | "POSTED" | "INVALID"; ack: string | null;
  quoteAt: number; invalid: boolean; result: OwnerHailuoInitialResult;
}
export class OwnerHailuoInitialGenerationServiceError extends Error {
  constructor(readonly code: string, readonly recovery_id?: string) {
    super(code === "OUTCOME_UNKNOWN" ? "Generation may have been dispatched. Do not retry; reconcile by GET only."
      : "The owner Hailuo initial operation could not be completed safely.");
    this.name = "OwnerHailuoInitialGenerationServiceError";
  }
}

/** One source-bound image→video operation. Native upload/chat/POST/GET methods are supplied by the root adapter patch. */
export class OwnerHailuoInitialGenerationService {
  readonly #binding: Readonly<AuthBinding>; readonly #links: Pick<PerUserLinkService, "getStatus">;
  readonly #images: OwnerHailuoInitialImageVault; readonly #catalog: DiscoveryCatalogRepository;
  readonly #resolve: (attempt: string) => unknown; readonly #readClient: (attempt: string) => unknown;
  readonly #now: () => number; readonly #timeout: number; readonly #records = new Map<string, Operation>();
  readonly #epochs = new Map<string, number>(); readonly #claims = new Set<string>(); readonly #pending = new Set<Promise<unknown>>();
  #lastNow = -1; #closed = false;
  constructor(input: OwnerHailuoInitialGenerationOptions | unknown) {
    const f = exact(input, ["binding", "linkService", "imageVault", "catalog", "resolveChatClient", "createReadClient", "now"], ["catalogDirectory", "timeoutMs"]);
    if (!genuine(f.linkService, PerUserLinkService, ["getStatus"]) || !isOwnerHailuoInitialImageVault(f.imageVault) ||
        !(f.catalog instanceof DiscoveryCatalogRepository) || typeof f.resolveChatClient !== "function" ||
        typeof f.createReadClient !== "function" || typeof f.now !== "function") fail("INVALID_REQUEST");
    this.#binding = binding(f.binding); this.#links = f.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#images = f.imageVault as OwnerHailuoInitialImageVault; this.#catalog = f.catalog as DiscoveryCatalogRepository;
    this.#resolve = f.resolveChatClient as (attempt: string) => unknown; this.#readClient = f.createReadClient as (attempt: string) => unknown;
    this.#now = f.now as () => number; this.#timeout = bounded(f.timeoutMs, 1_000, 300_000, 120_000);
    assertCatalog(this.#catalog, f.catalogDirectory as string | undefined); SERVICES.add(this); Object.freeze(this);
  }
  generate(input: OwnerHailuoInitialGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerHailuoInitialResult> {
    const request = generateRequest(input); normalizeOwnerHailuoInitialParameters(sourceParameters(request));
    return this.#run(request.attemptId, signal, d => this.#generate(request, d));
  }
  reconcile(input: unknown, signal?: AbortSignal): Promise<OwnerHailuoInitialResult> {
    const f = exact(input, ["attemptId", "recovery_id"]);
    if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || typeof f.recovery_id !== "string" || !RECOVERY.test(f.recovery_id)) fail("INVALID_REQUEST");
    return this.#run(f.attemptId, signal, async d => {
      const op = this.#records.get(f.recovery_id as string);
      if (!op || op.request.attemptId !== f.attemptId) fail("RECOVERY_NOT_FOUND");
      await this.#current(op, d); this.#validate(op, false);
      return op.phase !== "POSTED" || op.result.status === "completed" ? op.result : this.#collect(op, d);
    });
  }
  listRecoveries(input: unknown, signal?: AbortSignal): Promise<readonly OwnerHailuoInitialResult[]> {
    const f = exact(input, ["attemptId"]);
    if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId)) fail("INVALID_REQUEST");
    return this.#run(f.attemptId, signal, async d => {
      const principal = await d.waitFor(resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: f.attemptId as string,
        linkService: this.#links }));
      return Object.freeze([...this.#records.values()].filter(op => op.request.attemptId === f.attemptId &&
        sameGenerationPrincipal(op.principal, principal)).map(op => op.result));
    });
  }
  async invalidateAttempt(attempt: string): Promise<void> {
    if (!ATTEMPT.test(attempt)) return;
    this.#epochs.set(attempt, (this.#epochs.get(attempt) ?? 0) + 1);
    for (const op of this.#records.values()) if (op.request.attemptId === attempt) {
      op.invalid = true; op.phase = "INVALID"; op.client.invalidateOwnerHailuoInitialChats(attempt);
    }
    await this.#images.invalidateAttempt(attempt); await Promise.allSettled([...this.#pending]);
  }
  async close(): Promise<void> {
    this.#closed = true;
    for (const op of this.#records.values()) { op.invalid = true; op.phase = "INVALID"; op.client.invalidateOwnerHailuoInitialChats(op.request.attemptId); }
    await Promise.allSettled([...this.#pending]); this.#records.clear();
  }
  async #generate(request: OwnerHailuoInitialGenerateInput, d: AbsoluteRequestDeadline): Promise<OwnerHailuoInitialResult> {
    const principal = await d.waitFor(resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: request.attemptId, linkService: this.#links }));
    const reference = await d.waitFor(this.#images.resolveReference({ attemptId: request.attemptId, model_id: request.model_id,
      reference_handle: request.reference_handle }));
    if (!sameGenerationPrincipal(principal, reference.principal)) fail("PRINCIPAL_NOT_LINKED");
    const params = sourceParameters(request);
    const captured = this.#images.withCapturedReference(reference, (client, image) => ({
      client, wire: buildOwnerHailuoInitialWire(params, { model_id: request.model_id, url: image.url, sha256: image.sha256,
        mime_type: image.mime_type, width: image.width, height: image.height })
    }));
    const semantic = schemaHash({ tenant_id: principal.tenant_id, subject_id: principal.subject_id, intent: captured.wire.intent_fingerprint });
    if (this.#claims.has(semantic) || CLAIMS.has(semantic)) fail("INTENT_ALREADY_CLAIMED");
    if (IN_FLIGHT.has(semantic)) fail("SERVICE_BUSY");
    IN_FLIGHT.add(semantic);
    try { return await this.#submit(request, principal, reference, captured.client, captured.wire, semantic, d); }
    finally { IN_FLIGHT.delete(semantic); }
  }
  async #submit(request: OwnerHailuoInitialGenerateInput, principal: Readonly<GenerationPrincipalRef>,
    reference: OwnerHailuoInitialOwnedImage, client: SyntxChatHttpClient, wire: OwnerHailuoInitialWireCandidate,
    semantic: string, d: AbsoluteRequestDeadline): Promise<OwnerHailuoInitialResult> {
    const recovery = "hailuo_initial_recovery_" + randomUUID(), token = Object.freeze({ model_id: request.model_id });
    const op: Operation = { request, principal, client, reference, wire, token, recovery, semantic,
      epoch: this.#epochs.get(request.attemptId) ?? 0, phase: "PREPARING", ack: null, quoteAt: 0, invalid: false,
      result: unknownResult(request.model_id, recovery, ["NOT_DISPATCHED"]) };
    this.#validate(op, false); await this.#preflight(op, d); this.#validate(op, true);
    this.#records.set(recovery, op); this.#claims.add(semantic); CLAIMS.add(semantic);
    try {
      op.chat = await d.waitFor(op.client.createOwnerHailuoInitialChat({ attemptId: request.attemptId, model_id: request.model_id,
        title: "owner-hailuo-initial-" + randomUUID() }, d.signal));
    } catch {
      op.result = unknownResult(request.model_id, recovery, ["CHAT_CREATE_OUTCOME_UNKNOWN"]);
      return op.result;
    }
    if (!op.chat || !isOwnerHailuoInitialChatContextForClient(op.client, op.chat, request.attemptId) || op.chat.model_id !== request.model_id) fail("CHAT_CONTEXT_INVALID");
    op.phase = "READY";
    registerOwnerHailuoInitialOperation({ client: op.client, token, attempt_id: request.attemptId, model_id: request.model_id, chat: op.chat, wire: op.wire });
    await this.#preflight(op, d); this.#validate(op, true); d.throwIfAborted(); op.phase = "POSTED";
    try {
      const ack = await d.waitFor(op.client.startOwnerHailuoInitialOperation(token, d.signal));
      if (!ack || ack.chat_uuid !== op.chat.chat_uuid || typeof ack.message_id !== "string" || !ID.test(ack.message_id) ||
          !bindOwnerHailuoInitialAck(op.client, token, ack.message_id)) fail("OUTCOME_UNKNOWN");
      op.ack = ack.message_id;
    } catch {
      const transport = readOwnerHailuoInitialTransport(op.client, token);
      op.result = unknownResult(request.model_id, recovery, ["GENERATION_OUTCOME_UNKNOWN",
        ...(transport.status === undefined ? [] : ["GENERATION_HTTP_" + transport.status]),
        ...(transport.code === undefined ? [] : ["GENERATION_TRANSPORT_" + transport.code])]);
      return op.result;
    }
    return this.#collect(op, d);
  }
  async #preflight(op: Operation, d: AbsoluteRequestDeadline): Promise<void> {
    await this.#current(op, d); this.#validate(op, true);
    const read = this.#readClient(op.request.attemptId);
    if (!genuine(read, SyntxHttpClient, ["getAccountBalance", "getSubscription", "getModelInfo"])) fail("PREFLIGHT_FAILED");
    const account = await d.waitFor(new AccountStatusService(read as SyntxHttpClient, () => this.#time()).getAccountStatus(d.signal));
    const access = await d.waitFor(new ModelAccessService(this.#catalog, read as SyntxHttpClient, () => this.#time())
      .getModelAccess({ model_id: op.request.model_id, cost_parameters: quoteParameters(op.request) }, d.signal));
    const now = this.#time();
    validateFreshQuote(access, account, op.request.model_id, this.#catalog, now);
    op.quoteAt = Math.min(Date.parse(account.observed_at), Date.parse(access.observed_at));
    await this.#current(op, d); this.#validate(op, true);
  }
  async #current(op: Operation, d: AbsoluteRequestDeadline): Promise<void> {
    d.throwIfAborted(); this.#validate(op, false);
    const current = await d.waitFor(resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: op.request.attemptId, linkService: this.#links }));
    if (!sameGenerationPrincipal(current, op.principal)) fail("PRINCIPAL_NOT_LINKED");
    d.throwIfAborted(); this.#validate(op, false);
  }
  #validate(op: Operation, dispatch: boolean): void {
    if (this.#closed || op.invalid || (this.#epochs.get(op.request.attemptId) ?? 0) !== op.epoch ||
        this.#resolve(op.request.attemptId) !== op.client || !genuine(op.client, SyntxChatHttpClient,
          ["createOwnerHailuoInitialChat", "isOwnerHailuoInitialChat", "invalidateOwnerHailuoInitialChats",
            "startOwnerHailuoInitialOperation", "readOwnerHailuoInitialHistory", "readOwnerHailuoInitialResult"])) fail("PRINCIPAL_NOT_LINKED");
    if (op.chat && (!isOwnerHailuoInitialChatContextForClient(op.client, op.chat, op.request.attemptId) ||
        !op.client.isOwnerHailuoInitialChat(op.chat, op.request.attemptId))) fail("CHAT_CONTEXT_INVALID");
    if (dispatch && (!this.#images.isOwnedReference(op.reference) || op.reference.expires_at <= this.#time() ||
        op.wire.profile_sha256 !== getOwnerHailuoInitialSourceProfile().source_sha256)) fail("REFERENCE_EXPIRED");
    if (dispatch && op.phase === "READY" && (this.#time() < op.quoteAt || this.#time() - op.quoteAt > FRESH_MS)) fail("PREFLIGHT_EXPIRED");
  }
  async #collect(op: Operation, d: AbsoluteRequestDeadline): Promise<OwnerHailuoInitialResult> {
    try {
      await this.#current(op, d);
      const history = parseHistory(await d.waitFor(op.client.readOwnerHailuoInitialHistory(op.token, d.signal)));
      if (history.messages.length !== history.total || history.messages.length > 10) fail("HISTORY_INCOMPLETE");
      const messageIds = new Set<string>(), objectIds = new Set<string>(), chatIds = new Set<string>();
      for (const row of history.messages) {
        const chatId = String(row.chat_id);
        if (messageIds.has(row.id)) fail("HISTORY_BINDING_MISMATCH");
        messageIds.add(row.id); chatIds.add(chatId);
        for (const object of row.message_object) {
          if (typeof object.id !== "string" || !ID.test(object.id) || objectIds.has(object.id) || object.message_id !== row.id) fail("HISTORY_BINDING_MISMATCH");
          objectIds.add(object.id);
        }
      }
      if (chatIds.size > 1) fail("HISTORY_BINDING_MISMATCH");
      const uploadedUrl = op.wire.wire.settings.file_urls[0]?.url;
      const owners = history.messages.filter(row => row.author_id > 0 && (!op.ack || row.id === op.ack) &&
        row.message_object.filter(x => x.object_type === "text").length === 1 &&
        row.message_object.some(x => x.object_type === "text" && x.object_text === op.request.prompt) &&
        row.message_object.filter(x => x.object_type === "image").length === 1 &&
        row.message_object.some(x => x.object_type === "image" && x.model_type === op.request.model_id && x.object_url === uploadedUrl));
      if (owners.length !== 1) fail("OWNER_ECHO_UNVERIFIED");
      if (!bindOwnerHailuoInitialOwnerEcho(op.client, op.token, owners[0])) fail("OWNER_ECHO_UNVERIFIED");
      if (history.messages.filter(row => row.author_id > 0).length !== 1) fail("OWNER_ECHO_UNVERIFIED");
      const videos = history.messages.filter(row => row.author_id === -1 && row.message_object.some(x => x.object_type === "video"));
      if (!videos.length) { op.result = unknownResult(op.request.model_id, op.recovery, ["RESULT_PENDING_OR_UNVERIFIED"]); return op.result; }
      const artifacts: OwnerHailuoInitialArtifact[] = [];
      for (const row of videos) {
        if (row.message_object.length !== 1) fail("RESULT_UNVERIFIED");
        const item = row.message_object[0];
        if (!item || item.model_type !== op.request.model_id || item.completed !== true || typeof item.object_url !== "string" || !safeUrl(item.object_url)) fail("RESULT_UNVERIFIED");
        const context = bindOwnerHailuoInitialResultContext(op.client, op.token, row);
        if (!context) fail("RESULT_CONTEXT_INVALID");
        await this.#current(op, d);
        const detail = await d.waitFor(op.client.readOwnerHailuoInitialResult(context, d.signal));
        if (!sameResult(detail, row)) fail("RESULT_CHANGED");
        artifacts.push(Object.freeze({ object_index: artifacts.length, message_object_id: String(item.id), object_type: "video",
          object_url: item.object_url, mime_type: mime(item.object_url), message_id: row.id, chat_uuid: op.chat!.chat_uuid,
          model_id: op.request.model_id }));
      }
      if (!artifacts.length) fail("RESULT_UNVERIFIED");
      op.result = Object.freeze({ ...unknownResult(op.request.model_id, op.recovery, []), status: "completed",
        observed_artifact_count: artifacts.length, artifacts: Object.freeze(artifacts) }); return op.result;
    } catch {
      op.result = unknownResult(op.request.model_id, op.recovery, ["OWNED_HISTORY_OR_RESULT_UNVERIFIED"]); return op.result;
    }
  }
  #run<T>(attempt: string, signal: AbortSignal | undefined, work: (d: AbsoluteRequestDeadline) => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new OwnerHailuoInitialGenerationServiceError("SERVICE_CLOSED"));
    if (!ATTEMPT.test(attempt) || this.#pending.size >= MAX_PENDING) return Promise.reject(new OwnerHailuoInitialGenerationServiceError("SERVICE_BUSY"));
    if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) return Promise.reject(new OwnerHailuoInitialGenerationServiceError("INVALID_REQUEST"));
    const stop = new AbortController(), combined = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
    const d = new AbsoluteRequestDeadline(this.#timeout, combined, () => new OwnerHailuoInitialGenerationServiceError("REQUEST_ABORTED"));
    const task = Promise.resolve().then(() => work(d)).finally(() => { d.close(); this.#pending.delete(task); }); this.#pending.add(task); return task;
  }
  #time(): number {
    let value: unknown; try { value = this.#now(); } catch { return fail("CLOCK_INVALID"); }
    if (!Number.isSafeInteger(value) || (value as number) < this.#lastNow) return fail("CLOCK_INVALID"); this.#lastNow = value as number; return value as number;
  }
}
Object.freeze(OwnerHailuoInitialGenerationService.prototype);
export function isOwnerHailuoInitialGenerationService(value: unknown): value is OwnerHailuoInitialGenerationService {
  return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) &&
    Object.getPrototypeOf(value) === OwnerHailuoInitialGenerationService.prototype && Object.isFrozen(value);
}
export function loadOwnerHailuoInitialRuntimeCatalog(directory?: string): Readonly<{ catalog: DiscoveryCatalogRepository }> {
  const catalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(OWNER_HAILUO_INITIAL_CATALOG_VERSION, directory));
  assertCatalog(catalog, directory); return Object.freeze({ catalog });
}

function assertCatalog(catalog: DiscoveryCatalogRepository, directory?: string): void {
  const pinned = new DiscoveryCatalogRepository(loadPublicCatalogVersion(OWNER_HAILUO_INITIAL_CATALOG_VERSION, directory));
  if (catalog.fetched_at !== pinned.fetched_at || schemaHash(catalog.source_hashes) !== schemaHash(pinned.source_hashes)) fail("MODEL_BINDING_MISMATCH");
  const keys = { "hailuo-2.3-fast": ["resolution", "video_duration"], "hailuo-01-live-character": ["resolution", "video_duration"],
    "hailuo-3.0": ["ref_count", "resolution", "duration", "video_duration"] } as const;
  for (const model of MODEL_IDS) {
    const row = catalog.getModel(model);
    if (!row.active || row.id !== model || row.upstream_id !== model || row.ai_name !== AI_NAME ||
        schemaHash([...(row.settings?.get_cost_params ?? [])].sort()) !== schemaHash([...keys[model]].sort()) ||
        row.settings?.uploadable !== true || row.settings?.file_count_limit === undefined) fail("MODEL_BINDING_MISMATCH");
  }
}
function quoteParameters(request: OwnerHailuoInitialGenerateInput): Readonly<Record<string, SyntxCostParameter>> {
  return Object.freeze(request.model_id === "hailuo-3.0" ? { ref_count: 1, resolution: request.resolution,
    duration: request.video_duration, video_duration: request.video_duration } :
    { resolution: request.resolution, video_duration: request.video_duration });
}
function validateFreshQuote(access: ModelAccessResult, account: AccountStatusResult, model: OwnerHailuoInitialModelId,
  catalog: DiscoveryCatalogRepository, now: number): void {
  const expected = catalog.fetched_at + "." + catalog.source_hashes.models.slice(7, 19);
  const cost = access.discount_cost ?? access.cost;
  if (access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || access.catalog_version !== expected || access.model_id !== model ||
      access.model_type !== model || access.ai_name !== AI_NAME || access.account_read_live !== true || access.access !== true ||
      access.parameters_redacted !== true || schemaHash([...access.parameter_keys].sort()) !==
        schemaHash(Object.keys(model === "hailuo-3.0" ? { ref_count: 1, resolution: "", duration: 1, video_duration: 1 } :
          { resolution: "", video_duration: 1 }).sort()) ||
      !fresh(access.observed_at, now) || typeof cost !== "number" || !Number.isFinite(cost) || cost < 0 ||
      !fresh(account.observed_at, now) || account.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE ||
      account.source_build !== ACCOUNT_SOURCE_BUILD || account.balance.unit !== "tokens" || typeof account.balance.available !== "string" ||
      account.subscription.active !== true || typeof account.subscription.plan_type !== "string" || !account.subscription.plan_type ||
      account.subscription.plan_type.toUpperCase() === "FREE" ||
      !decimalAtLeast(account.balance.available, String(cost))) fail("PREFLIGHT_FAILED");
}
function generateRequest(value: unknown): OwnerHailuoInitialGenerateInput {
  const f = exact(value, ["attemptId", "model_id", "prompt", "resolution", "video_duration", "reference_handle"], ["aspect_ratio", "mode"]);
  if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || typeof f.reference_handle !== "string" ||
      !/^hailuo_initial_reference_[0-9a-f-]{36}$/u.test(f.reference_handle)) fail("INVALID_REQUEST");
  const row = { model_id: f.model_id, prompt: f.prompt, resolution: f.resolution, video_duration: f.video_duration,
    ...(Object.hasOwn(f, "aspect_ratio") ? { aspect_ratio: f.aspect_ratio } : {}), ...(Object.hasOwn(f, "mode") ? { mode: f.mode } : {}) };
  normalizeOwnerHailuoInitialParameters(row);
  return Object.freeze({ attemptId: f.attemptId, ...row, reference_handle: f.reference_handle }) as OwnerHailuoInitialGenerateInput;
}
function sourceParameters(request: OwnerHailuoInitialGenerateInput): Readonly<Record<string, unknown>> {
  return Object.freeze({ model_id: request.model_id, prompt: request.prompt, resolution: request.resolution,
    video_duration: request.video_duration, ...(request.aspect_ratio === undefined ? {} : { aspect_ratio: request.aspect_ratio }),
    ...(request.mode === undefined ? {} : { mode: request.mode }) });
}
function parseHistory(value: unknown): { messages: Array<{ id: string; chat_id: string | number; author_id: number; message_object: Array<Record<string, unknown>> }>; total: number } {
  if (!value || typeof value !== "object" || types.isProxy(value)) fail("HISTORY_UNVERIFIED");
  const source = value as Record<string, unknown>, page = source.pagination as Record<string, unknown>;
  if (!Array.isArray(source.messages) || !page || typeof page !== "object" || !Number.isSafeInteger(page.total_count) ||
      (page.total_count as number) < 0) fail("HISTORY_UNVERIFIED");
  const messages = source.messages.map(value => {
    if (!value || typeof value !== "object" || types.isProxy(value)) return fail("HISTORY_UNVERIFIED");
    const row = value as Record<string, unknown>;
    const id = normalizeProviderId(row.id), chatId = normalizeProviderId(row.chat_id);
    if (id === null || chatId === null ||
        !Number.isSafeInteger(row.author_id) || !Array.isArray(row.message_object) || row.message_object.length > 64) fail("HISTORY_UNVERIFIED");
    const messageObject = row.message_object.map(item => normalizeMessageObject(item));
    return { id, chat_id: chatId, author_id: row.author_id as number, message_object: messageObject };
  });
  return { messages, total: page.total_count as number };
}
function sameResult(a: unknown, b: unknown): boolean {
  if (!a || typeof a !== "object" || !b || typeof b !== "object") return false;
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  const xId = normalizeProviderId(x.id), yId = normalizeProviderId(y.id), xChat = normalizeProviderId(x.chat_id), yChat = normalizeProviderId(y.chat_id);
  if (xId === null || yId === null || xChat === null || yChat === null || xId !== yId || xChat !== yChat || x.author_id !== y.author_id) return false;
  try { return schemaHash(normalizeMessageObjects(x.message_object)) === schemaHash(normalizeMessageObjects(y.message_object)); }
  catch { return false; }
}
function normalizeProviderId(value: unknown): string | null {
  const id = typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : value;
  return typeof id === "string" && ID.test(id) ? id : null;
}
function normalizeMessageObjects(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length > 64) fail("RESULT_UNVERIFIED");
  return value.map(normalizeMessageObject);
}
function normalizeMessageObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("HISTORY_UNVERIFIED");
  const row = value as Record<string, unknown>, id = normalizeProviderId(row.id), messageId = normalizeProviderId(row.message_id);
  if (id === null || messageId === null) fail("HISTORY_UNVERIFIED");
  return { ...row, id, message_id: messageId };
}
function unknownResult(model: OwnerHailuoInitialModelId, recovery: string, gaps: readonly string[]): OwnerHailuoInitialResult {
  return Object.freeze({ status: "outcome_unknown", recovery_id: recovery, model_id: model, status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY",
    provider_terminal_status: "UNPROVEN", backend_acceptance: "UNPROVEN", cost_cap_enforced: false, durability: "PROCESS_LOCAL_ONLY",
    observed_artifact_count: 0, artifacts: Object.freeze([]), gaps: Object.freeze([...gaps]) });
}
function mime(url: string): "video/mp4" | "video/quicktime" | null {
  try { const p = new URL(url).pathname.toLowerCase(); return p.endsWith(".mp4") ? "video/mp4" : p.endsWith(".mov") ? "video/quicktime" : null; }
  catch { return null; }
}
function safeUrl(value: string): boolean { try { const u = new URL(value); return u.protocol === "https:" && (u.hostname === "syntx.ai" || u.hostname.endsWith(".syntx.ai")); } catch { return false; } }
function fresh(value: string, now: number): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const at = Date.parse(value);
  return Number.isFinite(at) && new Date(at).toISOString() === value && at <= now && now - at <= FRESH_MS;
}
function decimalAtLeast(balance: string, price: string): boolean {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(balance) || !/^\d+(?:\.\d+)?$/u.test(price)) return false;
  const [bi, bf = ""] = balance.split("."), [pi, pf = ""] = price.split("."), places = Math.max(bf.length, pf.length);
  return BigInt(bi! + bf.padEnd(places, "0")) >= BigInt(pi! + pf.padEnd(places, "0"));
}
function binding(value: unknown): Readonly<AuthBinding> { const f = exact(value, ["tenant_id", "subject"]);
  if (typeof f.tenant_id !== "string" || !f.tenant_id || typeof f.subject !== "string" || !f.subject) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: f.tenant_id, subject: f.subject }); }
function genuine(value: unknown, ctor: { prototype: object }, methods: readonly string[]): boolean {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === ctor.prototype &&
    methods.every(k => Reflect.get(value, k) === Reflect.get(ctor.prototype, k));
}
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const d = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(d);
  if (keys.some(k => typeof k !== "string" || (!required.includes(k) && !optional.includes(k)) ||
      !Object.hasOwn(d[k]!, "value") || d[k]!.enumerable !== true) || required.some(k => !Object.hasOwn(d, k))) fail("INVALID_REQUEST");
  const out = Object.create(null) as Record<string, unknown>; for (const k of keys as string[]) out[k] = d[k]!.value; return out;
}
function bounded(value: unknown, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback; if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) return fail("INVALID_REQUEST"); return value as number;
}
function fail(code: string): never { throw new OwnerHailuoInitialGenerationServiceError(code); }
