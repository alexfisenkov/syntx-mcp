import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { z } from "zod/v4";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { SyntxHttpClient } from "../adapter/syntx/http-client.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { AuthBinding } from "../auth/types.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import type { OwnerActTwoChatContext } from "../adapter/syntx/owner-acttwo-chat-context.js";
import { AccountStatusService } from "./account-status.js";
import { ModelAccessService } from "./model-access.js";
import type { AccountStatusResult } from "./account-status.js";
import type { ModelAccessResult } from "./model-access.js";
import { isOwnerActTwoImageReferenceService, OwnerActTwoImageReferenceService,
  type OwnerActTwoOwnedCharacterImage } from "./owner-acttwo-image-reference-service.js";
import { isOwnerActTwoPerformanceVideoReferenceService, OwnerActTwoPerformanceVideoReferenceService,
  type OwnerActTwoOwnedPerformanceVideo } from "./owner-acttwo-video-reference-service.js";
import { buildOwnerActTwoCostParameters, loadOwnerActTwoRuntimeCatalog } from "./owner-acttwo-cost.js";
import { evaluateOwnerActTwoBudget, OwnerActTwoBudgetError } from "./owner-acttwo-budget.js";
import { buildOwnerActTwoWire, type OwnerActTwoWireCandidate } from "./owner-acttwo-wire.js";
import { getOwnerActTwoSourceProfile, normalizeOwnerActTwoParameters } from "./owner-acttwo-parameters.js";

const MODEL_ID = "acttwo" as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY = /^acttwo_recovery_[0-9a-f-]{36}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const FRESH_MS = 15_000;
const MAX_OPERATIONS = 128;
const CLAIMED = new Set<string>();
const IN_FLIGHT = new Set<string>();
const DISPATCHED = new Set<string>();
const OPERATIONS = new WeakMap<object, Operation>();
const RESULTS = new WeakMap<object, { readonly operation: Operation; readonly row: HistoryRow }>();
const SERVICES = new WeakSet<object>();

const GENERATE = z.object({ attemptId: z.string().regex(ATTEMPT), model_id: z.literal(MODEL_ID), aspect_ratio: z.literal("1:1"),
  seed: z.null(), expression: z.literal(3), character_image_handle: z.string().regex(/^acttwo_character_image_[0-9a-f-]{36}$/u),
  performance_video_handle: z.string().regex(/^acttwo_performance_video_[0-9a-f-]{36}$/u) }).strict();
const id = z.union([z.string().regex(SAFE_ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String);
const objectSchema = z.object({ id, message_id: id, object_type: z.string().max(128), object_text: z.string().max(20_000).nullable().optional(),
  object_url: z.string().max(4096).nullable().optional(), model_type: z.string().max(160).nullable().optional(), completed: z.boolean().nullable().optional() }).strip();
const rowSchema = z.object({ id, chat_id: id, author_id: z.number().int().safe(), message_object: z.array(objectSchema).max(64) }).strip();
const historySchema = z.object({ messages: z.array(rowSchema).max(10), pagination: z.object({ page: z.literal(1), page_size: z.literal(10),
  total_count: z.number().int().min(1).max(10), total_pages: z.literal(1), has_next: z.literal(false), has_previous: z.literal(false) }).strip() }).strip();
type Request = z.infer<typeof GENERATE>;
type HistoryRow = z.infer<typeof rowSchema>;

export interface OwnerActTwoRuntimeCatalog { readonly catalog: DiscoveryCatalogRepository; readonly catalog_version: string }
export interface OwnerActTwoGenerationOptions {
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly imageReferenceService: OwnerActTwoImageReferenceService;
  readonly videoReferenceService: OwnerActTwoPerformanceVideoReferenceService;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalogDirectory?: string;
  readonly createReadClient: (attemptId: string) => SyntxHttpClient;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly now: () => number;
}
export interface OwnerActTwoArtifact {
  readonly message_object_id: string;
  readonly object_type: "video";
  readonly object_url: string;
  readonly mime_type: "video/mp4" | "video/quicktime" | null;
  readonly message_id: string;
  readonly chat_uuid: string;
  readonly model_id: "acttwo";
}
export interface OwnerActTwoGenerationResult {
  readonly status: "completed" | "outcome_unknown";
  readonly recovery_id: string;
  readonly model_id: "acttwo";
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly provider_terminal_status: "UNPROVEN";
  readonly backend_acceptance: "UNPROVEN";
  readonly cost_cap_enforced: false;
  readonly durability: "PROCESS_LOCAL_ONLY";
  readonly observed_artifact_count: number;
  readonly artifacts: readonly OwnerActTwoArtifact[];
  readonly gaps: readonly string[];
}
export class OwnerActTwoGenerationError extends Error {
  constructor(readonly code: string) {
    super("The owner Runway ActTwo generation could not be completed safely.");
    this.name = "OwnerActTwoGenerationError";
  }
}
interface Operation {
  readonly token: object;
  readonly request: Request;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly client: SyntxChatHttpClient;
  readonly image: OwnerActTwoOwnedCharacterImage;
  readonly video: OwnerActTwoOwnedPerformanceVideo;
  readonly wire: Readonly<OwnerActTwoWireCandidate>;
  readonly recoveryId: string;
  readonly semantic: string;
  readonly epoch: number;
  validate: (dispatch: boolean) => void;
  chat?: OwnerActTwoChatContext;
  phase: "PREPARING" | "READY" | "POSTED";
  quoteAt: number;
  invalid: boolean;
  ack?: string;
  ownerEcho?: string;
  providerChat?: string;
  responseStatus?: number;
  transportCode?: string;
  result: OwnerActTwoGenerationResult;
}

/** Loads the exact ActTwo public row; no live catalog fetch or selector promotion occurs here. */
export function loadOwnerActTwoGenerationCatalog(catalogDirectory?: string): Readonly<OwnerActTwoRuntimeCatalog> {
  const loaded = loadOwnerActTwoRuntimeCatalog(catalogDirectory);
  return Object.freeze({ catalog: loaded.catalog, catalog_version: loaded.catalog_version });
}

export class OwnerActTwoGenerationService {
  readonly #options: Readonly<OwnerActTwoGenerationOptions>;
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #records = new Map<string, Operation>();
  readonly #busy = new Set<string>();
  readonly #pending = new Map<Promise<unknown>, { readonly attemptId: string; readonly abort: AbortController }>();
  readonly #epochs = new Map<string, number>();
  #closed = false;
  #lastNow = -1;

  constructor(options: OwnerActTwoGenerationOptions) {
    if (!options || types.isProxy(options) || !genuine(options.linkService, PerUserLinkService, ["getStatus"]) ||
        !isOwnerActTwoImageReferenceService(options.imageReferenceService) ||
        !isOwnerActTwoPerformanceVideoReferenceService(options.videoReferenceService) ||
        !genuine(options.catalog, DiscoveryCatalogRepository, ["getModel"]) || typeof options.createReadClient !== "function" ||
        types.isProxy(options.createReadClient) || typeof options.resolveChatClient !== "function" || types.isProxy(options.resolveChatClient) ||
        typeof options.now !== "function" || types.isProxy(options.now)) fail("INVALID_REQUEST");
    const pinned = loadOwnerActTwoRuntimeCatalog(options.catalogDirectory).catalog;
    if (options.catalog.fetched_at !== pinned.fetched_at ||
        schemaHash(options.catalog.getModel(MODEL_ID)) !== schemaHash(pinned.getModel(MODEL_ID)) ||
        schemaHash(options.catalog.source_hashes) !== schemaHash(pinned.source_hashes)) fail("MODEL_BINDING_MISMATCH");
    this.#catalog = pinned;
    this.#options = Object.freeze({ ...options, binding: Object.freeze({ ...options.binding }) });
    this.#time(); SERVICES.add(this); Object.freeze(this);
  }

  generate(input: unknown, signalInput?: AbortSignal): Promise<OwnerActTwoGenerationResult> {
    let fields: Record<string, unknown>;
    try { fields = exact(input, ["attemptId", "model_id", "aspect_ratio", "seed", "expression", "character_image_handle", "performance_video_handle"]); }
    catch (error) { return Promise.reject(error); }
    const parsed = GENERATE.safeParse(fields);
    if (!parsed.success) return Promise.reject(new OwnerActTwoGenerationError("INVALID_REQUEST"));
    const signal = exactSignal(signalInput);
    return this.#run(parsed.data.attemptId, signal, deadline => this.#generate(parsed.data, deadline));
  }

  reconcile(input: unknown, signalInput?: AbortSignal): Promise<OwnerActTwoGenerationResult> {
    let fields: Record<string, unknown>;
    try { fields = exact(input, ["attemptId", "recovery_id"]); }
    catch (error) { return Promise.reject(error); }
    if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || typeof fields.recovery_id !== "string" ||
        !RECOVERY.test(fields.recovery_id)) return Promise.reject(new OwnerActTwoGenerationError("INVALID_REQUEST"));
    const attemptId = fields.attemptId, recoveryId = fields.recovery_id, signal = exactSignal(signalInput);
    return this.#run(attemptId, signal, async deadline => {
      const operation = this.#records.get(recoveryId);
      if (!operation || operation.request.attemptId !== attemptId) fail("RECOVERY_NOT_FOUND");
      await this.#current(operation, deadline); operation.validate(false);
      if (operation.phase !== "POSTED" || operation.result.status === "completed") return operation.result;
      return this.#collect(operation, deadline);
    });
  }

  listRecoveries(input: unknown, signalInput?: AbortSignal): Promise<readonly OwnerActTwoGenerationResult[]> {
    let fields: Record<string, unknown>;
    try { fields = exact(input, ["attemptId"]); }
    catch (error) { return Promise.reject(error); }
    if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId)) return Promise.reject(new OwnerActTwoGenerationError("INVALID_REQUEST"));
    const attemptId = fields.attemptId, signal = exactSignal(signalInput);
    return this.#run(attemptId, signal, async deadline => {
      const principal = await deadline.waitFor(resolveOwnerReferencePrincipal({ binding: this.#options.binding, attemptId,
        linkService: this.#options.linkService }));
      return Object.freeze([...this.#records.values()].filter(operation => !operation.invalid && operation.request.attemptId === attemptId &&
        sameGenerationPrincipal(operation.principal, principal)).map(operation => operation.result));
    });
  }

  async invalidateAttempt(attemptId: string): Promise<void> {
    if (!ATTEMPT.test(attemptId)) return;
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    const pending = [...this.#pending].filter(([, state]) => state.attemptId === attemptId);
    for (const [, state] of pending) state.abort.abort();
    const errors: unknown[] = [];
    for (const operation of this.#records.values()) if (operation.request.attemptId === attemptId) {
      operation.invalid = true;
      try { SyntxChatHttpClient.prototype.invalidateOwnerActTwoChats.call(operation.client, attemptId); }
      catch (error) { errors.push(error); }
    }
    try { await this.#options.imageReferenceService.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
    try { await this.#options.videoReferenceService.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
    await Promise.allSettled(pending.map(([promise]) => promise));
    for (const operation of this.#records.values()) if (operation.request.attemptId === attemptId) operation.invalid = true;
    for (const [recovery, operation] of this.#records) if (operation.request.attemptId === attemptId) this.#records.delete(recovery);
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "ActTwo attempt invalidation was incomplete.");
  }

  async close(): Promise<void> {
    this.#closed = true;
    for (const state of this.#pending.values()) state.abort.abort();
    const errors: unknown[] = [];
    const tasks = [
      () => this.#options.imageReferenceService.close(),
      () => this.#options.videoReferenceService.close(),
      async () => { for (const operation of this.#records.values()) {
        operation.invalid = true;
        try { SyntxChatHttpClient.prototype.invalidateOwnerActTwoChats.call(operation.client, operation.request.attemptId); }
        catch (error) { errors.push(error); }
      } }
    ];
    const settled = await Promise.allSettled(tasks.map(task => task()));
    errors.push(...settled.flatMap(result => result.status === "rejected" ? [result.reason] : []));
    await Promise.allSettled([...this.#pending.keys()]);
    this.#records.clear();
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "ActTwo generation service cleanup was incomplete.");
  }

  async #generate(request: Request, deadline: AbsoluteRequestDeadline): Promise<OwnerActTwoGenerationResult> {
    const epoch = this.#epochs.get(request.attemptId) ?? 0;
    const principal = await deadline.waitFor(resolveOwnerReferencePrincipal({ binding: this.#options.binding,
      attemptId: request.attemptId, linkService: this.#options.linkService }));
    const image = await deadline.waitFor(this.#options.imageReferenceService.resolveCharacterImage({ attemptId: request.attemptId,
      reference_handle: request.character_image_handle }, deadline.signal));
    const video = await deadline.waitFor(this.#options.videoReferenceService.resolvePerformanceVideo({ attemptId: request.attemptId,
      reference_handle: request.performance_video_handle }, deadline.signal));
    if (!sameGenerationPrincipal(principal, image.principal) || !sameGenerationPrincipal(principal, video.principal) ||
        video.performance_video.measured_duration_seconds !== 5) fail("PRINCIPAL_NOT_LINKED");
    const parameters = Object.freeze({ model_id: request.model_id, aspect_ratio: request.aspect_ratio,
      video_duration: video.performance_video.measured_duration_seconds, seed: request.seed, expression: request.expression });
    normalizeOwnerActTwoParameters(parameters);
    const characterCaptured = this.#options.imageReferenceService.withCapturedCharacterImage(image, (_client, media) => media);
    const videoCaptured = this.#options.videoReferenceService.withCapturedPerformanceVideo(video, (_client, media) => media);
    const client = this.#options.imageReferenceService.withCapturedCharacterImage(image, imageClient => imageClient);
    const videoClient = this.#options.videoReferenceService.withCapturedPerformanceVideo(video, videoClientValue => videoClientValue);
    if (client !== videoClient) fail("REFERENCE_UNAVAILABLE");
    const wire = buildOwnerActTwoWire(parameters, { character_image: characterCaptured, performance_video: videoCaptured });
    const semantic = schemaHash({ tenant: principal.tenant_id, subject: principal.subject_id, intent: wire.intent_fingerprint });
    if (CLAIMED.has(semantic)) fail("INTENT_ALREADY_CLAIMED");
    if (IN_FLIGHT.has(semantic)) fail("SERVICE_BUSY");
    if (this.#records.size >= MAX_OPERATIONS) fail("CAPACITY_EXCEEDED");
    IN_FLIGHT.add(semantic);
    const recoveryId = `acttwo_recovery_${randomUUID()}`, token = Object.freeze({});
    let operation: Operation | undefined;
    try {
      operation = { token, request, principal, client, image, video, wire, recoveryId, semantic, epoch,
        validate: () => undefined, phase: "PREPARING", quoteAt: 0, invalid: false, result: unknownResult(recoveryId, []) };
      operation.validate = dispatch => {
        if (this.#closed || operation!.invalid || (this.#epochs.get(request.attemptId) ?? 0) !== epoch ||
            this.#options.resolveChatClient(request.attemptId) !== client ||
            !genuine(client, SyntxChatHttpClient, ["createOwnerActTwoChat", "isOwnerActTwoChat", "invalidateOwnerActTwoChats",
              "startOwnerActTwoOperation", "readOwnerActTwoHistory", "readOwnerActTwoResult"])) fail("PRINCIPAL_NOT_LINKED");
        if (operation!.chat && (operation!.chat.model_id !== "acttwo" ||
            !SyntxChatHttpClient.prototype.isOwnerActTwoChat.call(client, operation!.chat, request.attemptId))) fail("PRINCIPAL_NOT_LINKED");
        if (dispatch && (!this.#options.imageReferenceService.isOwnedCharacterImage(image) ||
            !this.#options.videoReferenceService.isOwnedPerformanceVideo(video) || image.expires_at <= this.#time() ||
            video.expires_at <= this.#time() || wire.profile_sha256 !== getOwnerActTwoSourceProfile().source_sha256)) fail("REFERENCE_EXPIRED");
        if (dispatch && operation!.phase === "READY" && (this.#time() < operation!.quoteAt || this.#time() - operation!.quoteAt > FRESH_MS)) fail("PREFLIGHT_EXPIRED");
      };
      await this.#preflight(operation, deadline);
      operation.validate(true);
      if (CLAIMED.has(semantic)) fail("INTENT_ALREADY_CLAIMED");
      CLAIMED.add(semantic);
      this.#records.set(recoveryId, operation); OPERATIONS.set(token, operation);
      const chat = await deadline.waitFor(this.#createChat(client, request, deadline.signal));
      operation.chat = chat;
      await this.#preflight(operation, deadline);
      await this.#current(operation, deadline); operation.validate(true); deadline.throwIfAborted(); operation.phase = "READY";
      try {
        const ack = await deadline.waitFor(SyntxChatHttpClient.prototype.startOwnerActTwoOperation.call(client, token, deadline.signal));
        if (ack.chat_uuid !== chat.chat_uuid || !SAFE_ID.test(ack.message_id)) fail("ACK_UNVERIFIED");
        operation.ack = ack.message_id;
      } catch {
        operation.result = operationUnknown(operation, "GENERATION_OUTCOME_UNKNOWN");
        return operation.result;
      }
      return await this.#collect(operation, deadline);
    } catch (error) {
      if (operation && CLAIMED.has(semantic)) {
        operation.result = operationUnknown(operation, operation.chat ? "CHAT_OR_GENERATION_OUTCOME_UNKNOWN" : "CHAT_CREATE_OUTCOME_UNKNOWN");
        return operation.result;
      }
      if (error instanceof OwnerActTwoGenerationError) throw error;
      if (error instanceof OwnerActTwoBudgetError) fail("PREFLIGHT_FAILED");
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      throw error;
    } finally { IN_FLIGHT.delete(semantic); }
  }

  async #createChat(client: SyntxChatHttpClient, request: Request, signal: AbortSignal): Promise<OwnerActTwoChatContext> {
    let result: unknown;
    try { result = await SyntxChatHttpClient.prototype.createOwnerActTwoChat.call(client,
      { attemptId: request.attemptId, model_id: "acttwo", title: `owner-acttwo-${randomUUID()}` }, signal); }
    catch { fail("CHAT_CREATE_OUTCOME_UNKNOWN"); }
    if (!SyntxChatHttpClient.prototype.isOwnerActTwoChat.call(client, result, request.attemptId)) fail("CHAT_CONTEXT_INVALID");
    return result as OwnerActTwoChatContext;
  }

  async #preflight(operation: Operation, deadline: AbsoluteRequestDeadline): Promise<void> {
    await this.#current(operation, deadline); operation.validate(true);
    const readClient = this.#options.createReadClient(operation.request.attemptId);
    if (!genuine(readClient, SyntxHttpClient, ["getAccountBalance", "getSubscription", "getModelInfo"])) fail("PREFLIGHT_FAILED");
    const account = await deadline.waitFor(new AccountStatusService(readClient, () => this.#time()).getAccountStatus(deadline.signal));
    const costParameters = buildOwnerActTwoCostParameters({ model_id: "acttwo", video_duration: operation.video.performance_video.measured_duration_seconds });
    const access = await deadline.waitFor(new ModelAccessService(this.#catalog, readClient, () => this.#time()).getModelAccess({
      model_id: "acttwo", cost_parameters: { ...costParameters }
    }, deadline.signal));
    const catalogVersion = `${this.#catalog.fetched_at}.${this.#catalog.source_hashes.models.slice(7, 19)}`;
    evaluateOwnerActTwoBudget({ expected_catalog_version: catalogVersion, now: this.#time(), cost_parameters: costParameters, access, account });
    operation.quoteAt = Math.min(Date.parse((account as AccountStatusResult).observed_at), Date.parse((access as ModelAccessResult).observed_at));
    await this.#current(operation, deadline); operation.validate(true);
  }

  async #current(operation: Operation, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted(); operation.validate(false);
    const principal = await deadline.waitFor(resolveOwnerReferencePrincipal({ binding: this.#options.binding,
      attemptId: operation.request.attemptId, linkService: this.#options.linkService }));
    if (!sameGenerationPrincipal(principal, operation.principal)) fail("PRINCIPAL_NOT_LINKED");
    deadline.throwIfAborted(); operation.validate(false);
  }

  async #collect(operation: Operation, deadline: AbsoluteRequestDeadline): Promise<OwnerActTwoGenerationResult> {
    try {
      await this.#current(operation, deadline);
      const history = historySchema.parse(await deadline.waitFor(SyntxChatHttpClient.prototype.readOwnerActTwoHistory.call(
        operation.client, operation.token, deadline.signal)));
      await this.#current(operation, deadline);
      if (history.pagination.total_count !== history.messages.length || history.messages.length < 2) fail("HISTORY_INCOMPLETE");
      const providerChatId = history.messages[0]!.chat_id, messageIds = new Set<string>(), objectIds = new Set<string>();
      for (const row of history.messages) {
        if (row.chat_id !== providerChatId || messageIds.has(row.id)) fail("HISTORY_BINDING_MISMATCH");
        messageIds.add(row.id);
        for (const object of row.message_object) { if (object.message_id !== row.id || objectIds.has(object.id)) fail("HISTORY_BINDING_MISMATCH"); objectIds.add(object.id); }
      }
      const ownerRows = history.messages.filter(row => row.author_id > 0);
      if (ownerRows.length !== 1 || (operation.ack && ownerRows[0]!.id !== operation.ack) ||
          history.messages.filter(row => row.author_id > 0).length !== 1) fail("OWNER_ECHO_UNVERIFIED");
      const owner = ownerRows[0]!, media = owner.message_object.filter(item => item.object_type === "video" || item.object_type === "image");
      const videos = media.filter(item => item.object_type === "video"), images = media.filter(item => item.object_type === "image");
      const text = owner.message_object.filter(item => item.object_type === "text");
      if (text.length > 1 || text.some(item => (item.object_text ?? "") !== "") || media.length !== 2 || videos.length !== 1 || images.length !== 1 ||
          videos[0]!.object_url !== operation.wire.wire.settings.file_urls[0]!.url ||
          images[0]!.object_url !== operation.wire.wire.settings.file_urls[1]!.url ||
          media.some(item => item.model_type !== undefined && item.model_type !== "acttwo")) fail("OWNER_ECHO_UNVERIFIED");
      operation.ownerEcho = owner.id; operation.providerChat = providerChatId;
      const candidateRows = history.messages.filter(row => row.author_id === -1 && row.message_object.some(item => item.object_type === "video"));
      if (candidateRows.length !== 1) { operation.result = operationUnknown(operation, "RESULT_PENDING_OR_UNVERIFIED"); return operation.result; }
      const row = candidateRows[0]!, objects = row.message_object.filter(item => item.object_type === "video");
      if (objects.length !== 1 || row.message_object.length !== 1) fail("RESULT_UNVERIFIED");
      const object = objects[0]!;
      if (object.model_type !== "acttwo" || object.completed !== true || typeof object.object_url !== "string" ||
          !isSafeUploadReferenceUrl(object.object_url) || operation.wire.wire.settings.file_urls.some(file => file.url === object.object_url)) fail("RESULT_UNVERIFIED");
      const resultContext = Object.freeze({}); RESULTS.set(resultContext, { operation, row });
      await this.#current(operation, deadline);
      const detail = rowSchema.parse(await deadline.waitFor(SyntxChatHttpClient.prototype.readOwnerActTwoResult.call(operation.client,
        resultContext, deadline.signal)));
      await this.#current(operation, deadline);
      if (schemaHash(detail) !== schemaHash(row)) fail("RESULT_CHANGED");
      const path = new URL(object.object_url).pathname.toLowerCase();
      const artifact = Object.freeze({ message_object_id: object.id, object_type: "video" as const, object_url: object.object_url,
        mime_type: path.endsWith(".mp4") ? "video/mp4" as const : path.endsWith(".mov") ? "video/quicktime" as const : null,
        message_id: row.id, chat_uuid: operation.chat!.chat_uuid, model_id: "acttwo" as const });
      operation.result = Object.freeze({ ...unknownResult(operation.recoveryId, []), status: "completed", observed_artifact_count: 1,
        artifacts: Object.freeze([artifact]) });
      return operation.result;
    } catch {
      operation.result = operationUnknown(operation, "OWNED_HISTORY_OR_RESULT_UNVERIFIED");
      return operation.result;
    }
  }

  #run<T>(attemptId: string, signal: AbortSignal | undefined, work: (deadline: AbsoluteRequestDeadline) => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new OwnerActTwoGenerationError("SERVICE_CLOSED"));
    if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) return Promise.reject(new OwnerActTwoGenerationError("INVALID_REQUEST"));
    if (this.#busy.has(attemptId) || this.#pending.size >= 4) return Promise.reject(new OwnerActTwoGenerationError("SERVICE_BUSY"));
    const abort = new AbortController(), combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
    const deadline = new AbsoluteRequestDeadline(120_000, combined, () => new OwnerActTwoGenerationError("REQUEST_ABORTED"));
    this.#busy.add(attemptId);
    const promise = Promise.resolve().then(() => work(deadline)).finally(() => { deadline.close(); this.#busy.delete(attemptId); this.#pending.delete(promise); });
    this.#pending.set(promise, { attemptId, abort }); return promise;
  }
  #time(): number { const value = this.#options.now(); if (!Number.isSafeInteger(value) || value < this.#lastNow) fail("CLOCK_INVALID"); this.#lastNow = value; return value; }
}

export function isOwnerActTwoGenerationService(value: unknown): value is OwnerActTwoGenerationService {
  return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) &&
    Object.getPrototypeOf(value) === OwnerActTwoGenerationService.prototype && Object.isFrozen(value);
}

/** The native fixed-route method calls this synchronously immediately before its only GEN POST. */
export function consumeOwnerActTwoDispatch(client: SyntxChatHttpClient, token: unknown): Readonly<{ chat_uuid: string; body: Record<string, unknown> }> {
  const operation = readOperation(client, token); operation.validate(true);
  if (operation.phase !== "READY" || !operation.chat || DISPATCHED.has(operation.semantic)) fail("INTENT_ALREADY_CLAIMED");
  DISPATCHED.add(operation.semantic); operation.phase = "POSTED";
  return Object.freeze({ chat_uuid: operation.chat.chat_uuid, body: Object.freeze({ chat_id: operation.chat.chat_uuid,
    prompt: operation.wire.wire.prompt, settings: operation.wire.wire.settings }) });
}
export function readOwnerActTwoHistoryRoute(client: SyntxChatHttpClient, token: unknown): string {
  const operation = readOperation(client, token); operation.validate(false);
  if (operation.phase !== "POSTED" || !operation.chat) fail("OPERATION_NOT_DISPATCHED"); return operation.chat.chat_uuid;
}
export function readOwnerActTwoResultRoute(client: SyntxChatHttpClient, token: unknown): Readonly<{ chat_uuid: string; message_id: string }> {
  const state = token && typeof token === "object" && !types.isProxy(token) ? RESULTS.get(token) : undefined;
  if (!state || state.operation.client !== client) fail("RESULT_CONTEXT_INVALID"); state.operation.validate(false);
  if (state.operation.phase !== "POSTED" || !state.operation.chat || !state.operation.ownerEcho || !state.operation.providerChat) fail("RESULT_CONTEXT_INVALID");
  return Object.freeze({ chat_uuid: state.operation.chat.chat_uuid, message_id: state.row.id });
}
export function recordOwnerActTwoTransport(client: SyntxChatHttpClient, token: unknown, observed: unknown): void {
  const operation = token && typeof token === "object" && !types.isProxy(token) ? OPERATIONS.get(token) : undefined;
  if (!operation || operation.client !== client || operation.phase !== "POSTED") return;
  if (typeof observed === "number" && Number.isInteger(observed) && observed >= 100 && observed <= 599 && operation.responseStatus === undefined) operation.responseStatus = observed;
  if (typeof observed === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(observed) && operation.transportCode === undefined) operation.transportCode = observed;
}

function readOperation(client: SyntxChatHttpClient, token: unknown): Operation {
  const operation = token && typeof token === "object" && !types.isProxy(token) ? OPERATIONS.get(token) : undefined;
  if (!operation || operation.client !== client || operation.token !== token || operation.invalid) fail("OPERATION_CONTEXT_INVALID");
  return operation;
}
function unknownResult(recoveryId: string, gaps: readonly string[]): OwnerActTwoGenerationResult {
  return Object.freeze({ status: "outcome_unknown", recovery_id: recoveryId, model_id: "acttwo", status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY",
    provider_terminal_status: "UNPROVEN", backend_acceptance: "UNPROVEN", cost_cap_enforced: false, durability: "PROCESS_LOCAL_ONLY",
    observed_artifact_count: 0, artifacts: Object.freeze([]), gaps: Object.freeze([...gaps]) });
}
function operationUnknown(operation: Operation, reason: string): OwnerActTwoGenerationResult {
  return unknownResult(operation.recoveryId, [reason, ...(operation.responseStatus === undefined ? [] : [`GENERATION_HTTP_${operation.responseStatus}`]),
    ...(operation.transportCode === undefined ? [] : [`GENERATION_TRANSPORT_${operation.transportCode}`])]);
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || own.length !== keys.length ||
        keys.some(key => !Object.hasOwn(descriptors, key)) || own.some(key => typeof key !== "string" || !keys.includes(key) ||
          !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of own as string[]) out[key] = descriptors[key]!.value; return out;
  } catch { return fail("INVALID_REQUEST"); }
}
function exactSignal(value: unknown): AbortSignal | undefined { if (value === undefined) return undefined; if (!(value instanceof AbortSignal) || types.isProxy(value)) fail("INVALID_REQUEST"); return value; }
function genuine(value: unknown, ctor: { prototype: object }, methods: readonly string[]): boolean {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === ctor.prototype &&
    methods.every(method => !Object.hasOwn(value, method) && typeof Reflect.get(ctor.prototype, method) === "function" &&
      Reflect.get(value, method) === Reflect.get(ctor.prototype, method));
}
function fail(code: string): never { throw new OwnerActTwoGenerationError(code); }
