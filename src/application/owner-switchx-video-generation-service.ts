import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { isOwnerSwitchxVideoNativeClient, SyntxChatHttpClient, type MediaGenerationReceipt } from "../adapter/syntx/chat-http-client.js";
import { AccountStatusService, type AccountStatusResult } from "./account-status.js";
import { ModelAccessService, type ModelAccessResult } from "./model-access.js";
import { PerUserLinkService } from "../auth/link-service.js";
import type { AuthBinding } from "../auth/types.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import {
  createOwnerSwitchxVideoValidator,
  isValidatedOwnerSwitchxVideo,
  releaseValidatedOwnerSwitchxVideo,
  type OwnerSwitchxVideoMimeType,
  type ValidatedOwnerSwitchxVideo
} from "./owner-switchx-video-policy.js";
import {
  normalizeOwnerSwitchxVideoInput,
  OWNER_SWITCHX_VIDEO_AI_NAME,
  OWNER_SWITCHX_VIDEO_MODEL_ID,
  OWNER_SWITCHX_VIDEO_SOURCE_PROFILE,
  type OwnerSwitchxNormalizedVideoInput
} from "./owner-switchx-video-parameters.js";
import { OwnerSwitchxVideoPolicyError } from "./owner-switchx-video-policy.js";
import { readOwnerSwitchxVideoChatState, type OwnerSwitchxVideoUploadContext, type OwnerSwitchxVideoChatContext } from "../adapter/syntx/owner-switchx-video-native-context.js";

const MODEL_ID = OWNER_SWITCHX_VIDEO_MODEL_ID;
const AI_NAME = OWNER_SWITCHX_VIDEO_AI_NAME;
const CATALOG_VERSION = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json";
const CATALOG_CANONICAL_SHA256 = "sha256:92c31dba26eb9c0ccf68cdf92a105e6e808c92b187286e4fb366debe051982e1";
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY = /^switchx_video_recovery_[0-9a-f-]{36}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const MAX_RECOVERIES = 128;
const MAX_ACTIVE = 4;
const DEFAULT_TIMEOUT_MS = 180_000;
const ACCOUNT_GET = AccountStatusService.prototype.getAccountStatus;
const MODEL_ACCESS_GET = ModelAccessService.prototype.getModelAccess;
const CLIENT_UPLOAD = SyntxChatHttpClient.prototype.uploadOwnerSwitchxVideo;
const CLIENT_CREATE = SyntxChatHttpClient.prototype.createOwnerSwitchxVideoChat;
const CLIENT_START = SyntxChatHttpClient.prototype.startOwnerSwitchxVideo;
const CLIENT_INDEX = SyntxChatHttpClient.prototype.readOwnerExistingVideoIndex;
const CLIENT_HISTORY = SyntxChatHttpClient.prototype.readOwnerExistingVideoHistory;
const CLIENT_DETAIL = SyntxChatHttpClient.prototype.readOwnerExistingVideoMessage;
const SERVICES = new WeakSet<object>();

export type OwnerSwitchxVideoPhase = "VALIDATE" | "UPLOAD" | "PREFLIGHT_CHAT" | "CHAT_CREATE" | "PREFLIGHT_GENERATION" |
  "GENERATION_POST" | "ACK_KNOWN" | "HISTORY_GET" | "RESULT_GET" | "RESULT_BINDING";

export interface OwnerSwitchxVideoDiagnostic {
  readonly phase: OwnerSwitchxVideoPhase;
  readonly upload_attempted: boolean;
  readonly chat_created: boolean;
  readonly generation_post_started: boolean;
  readonly owner_ack_known: boolean;
  readonly history_get_calls: number;
  readonly result_get_calls: number;
  readonly gaps: readonly string[];
}

export interface OwnerSwitchxVideoArtifact {
  readonly url: string;
  readonly mime_type?: string;
  readonly byte_size?: number;
  readonly width?: number;
  readonly height?: number;
  readonly duration_seconds?: number;
}

export interface OwnerSwitchxVideoGenerationResult {
  readonly status: "completed";
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly backend_acceptance: "UNPROVEN";
  readonly provider_terminal_status: "UNPROVEN";
  readonly cost_cap_enforced: false;
  readonly recovery_id: string;
  readonly model_id: typeof MODEL_ID;
  readonly source_binding: Readonly<{ public_catalog_version: typeof CATALOG_VERSION; profile_sha256: string;
    source_sha256: string; input_size: number; width: number; height: number; video_duration: 5; frame_rate: 24 }>;
  readonly artifacts: readonly OwnerSwitchxVideoArtifact[];
  readonly diagnostics: OwnerSwitchxVideoDiagnostic;
}

export interface OwnerSwitchxVideoRecoveryListItem {
  readonly recovery_id: string;
  readonly model_id: typeof MODEL_ID;
  readonly status: "outcome_unknown" | "completed";
  readonly observed_artifact_count: number;
  readonly diagnostics: OwnerSwitchxVideoDiagnostic;
}

export interface OwnerSwitchxVideoGenerationServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string;
  readonly ffprobePath: string;
  readonly uploadDestination: "uploaded" | "hidden";
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly createAccountStatusService: (attemptId: string) => AccountStatusService;
  readonly createModelAccessService: (attemptId: string) => ModelAccessService;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

export interface OwnerSwitchxVideoGenerateInput {
  readonly attemptId: string;
  readonly prompt: string;
  readonly filename: string;
  readonly mime_type: OwnerSwitchxVideoMimeType;
  readonly content_base64: string;
}

export interface OwnerSwitchxVideoReconcileInput { readonly attemptId: string; readonly recovery_id: string; }
export interface OwnerSwitchxVideoListInput { readonly attemptId: string; readonly limit?: number; }

export type OwnerSwitchxVideoGenerationServiceErrorCode = "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" |
  "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH" | "PREFLIGHT_FAILED" | "INVALID_VIDEO" | "LOCAL_LIMIT_EXCEEDED" |
  "INPUT_VIDEO_NOT_IN_INITIAL_SLICE" | "INTENT_ALREADY_CLAIMED" |
  "UPLOAD_OUTCOME_UNKNOWN" | "CHAT_OUTCOME_UNKNOWN" | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND";

export class OwnerSwitchxVideoGenerationServiceError extends Error {
  constructor(readonly code: OwnerSwitchxVideoGenerationServiceErrorCode, readonly recovery_id?: string,
    readonly diagnostics?: OwnerSwitchxVideoDiagnostic) {
    super(code === "OUTCOME_UNKNOWN" ? "Switchx generation may have been dispatched; use GET-only reconciliation and do not retry."
      : code === "INPUT_VIDEO_NOT_IN_INITIAL_SLICE"
        ? "The Switchx initial source slice requires exactly 1280×720 pixels, 5 seconds, and 24 fps."
        : code === "INVALID_VIDEO"
          ? "The Switchx input could not be validated. The enabled initial slice accepts 1280×720, exactly 5 seconds, at 24 fps."
          : code === "LOCAL_LIMIT_EXCEEDED"
            ? "The Switchx input exceeds the local 10 MiB validation or upload limit."
            : "The owner Switchx video operation could not be completed safely.");
    this.name = "OwnerSwitchxVideoGenerationServiceError";
  }
}

interface MutableDiagnostic {
  phase: OwnerSwitchxVideoPhase; upload_attempted: boolean; chat_created: boolean; generation_post_started: boolean;
  owner_ack_known: boolean; history_get_calls: number; result_get_calls: number; gaps: string[];
}
interface Recovery {
  readonly recovery_id: string; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly client: SyntxChatHttpClient; readonly chat: Readonly<OwnerSwitchxVideoChatContext>;
  readonly input: Readonly<OwnerSwitchxNormalizedVideoInput>; readonly created_at: string;
  status: "outcome_unknown" | "completed"; owner_echo_message_id: string | null;
  artifacts: readonly OwnerSwitchxVideoArtifact[]; diagnostics: MutableDiagnostic;
}
interface ActiveRun { readonly attemptId: string; readonly controller: AbortController; promise: Promise<unknown>; }

/** One model-bound owner video upload/GEN flow. Uploaded URLs remain native-only and intent claims are sticky. */
export class OwnerSwitchxVideoGenerationService {
  readonly #binding: Readonly<AuthBinding>; readonly #links: PerUserLinkService; readonly #catalog: DiscoveryCatalogRepository;
  readonly #catalogVersion: string; readonly #destination: "uploaded" | "hidden";
  readonly #resolveChatClient: OwnerSwitchxVideoGenerationServiceOptions["resolveChatClient"];
  readonly #createAccount: OwnerSwitchxVideoGenerationServiceOptions["createAccountStatusService"];
  readonly #createAccess: OwnerSwitchxVideoGenerationServiceOptions["createModelAccessService"];
  readonly #validator: ReturnType<typeof createOwnerSwitchxVideoValidator>;
  readonly #now: () => number; readonly #timeoutMs: number;
  readonly #claims = new Map<string, string>(); readonly #recoveries = new Map<string, Recovery>();
  readonly #active = new Set<ActiveRun>(); readonly #clientsByAttempt = new Map<string, SyntxChatHttpClient>();
  readonly #invalidating = new Set<string>(); #closed = false; #closing: Promise<void> | undefined; #lastNow = -1;

  constructor(optionsInput: OwnerSwitchxVideoGenerationServiceOptions | unknown) {
    const options = exact(optionsInput, ["binding", "linkService", "catalog", "catalog_version", "ffprobePath", "uploadDestination",
      "resolveChatClient", "createAccountStatusService", "createModelAccessService"], ["now", "timeoutMs"]);
    if (!genuineMethods(options.linkService, PerUserLinkService, ["getStatus"]) || !(options.catalog instanceof DiscoveryCatalogRepository) ||
        options.catalog_version !== CATALOG_VERSION || typeof options.ffprobePath !== "string" || !options.ffprobePath.trim() ||
        (options.uploadDestination !== "uploaded" && options.uploadDestination !== "hidden") ||
        typeof options.resolveChatClient !== "function" || types.isProxy(options.resolveChatClient) ||
        typeof options.createAccountStatusService !== "function" || types.isProxy(options.createAccountStatusService) ||
        typeof options.createModelAccessService !== "function" || types.isProxy(options.createModelAccessService) ||
        (options.now !== undefined && (typeof options.now !== "function" || types.isProxy(options.now)))) invalid();
    this.#binding = snapshotBinding(options.binding); this.#links = options.linkService; this.#catalog = options.catalog;
    this.#catalogVersion = options.catalog_version; this.#destination = options.uploadDestination;
    this.#resolveChatClient = options.resolveChatClient; this.#createAccount = options.createAccountStatusService;
    this.#createAccess = options.createModelAccessService; this.#validator = createOwnerSwitchxVideoValidator(options.ffprobePath);
    this.#now = options.now === undefined ? Date.now : options.now;
    this.#timeoutMs = bounded(options.timeoutMs, 1_000, 300_000, DEFAULT_TIMEOUT_MS);
    this.#assertCatalog(); SERVICES.add(this); Object.freeze(this);
  }

  generate(input: OwnerSwitchxVideoGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerSwitchxVideoGenerationResult> {
    this.#assertOpen(); const request = snapshotGenerate(input);
    if (this.#invalidating.has(request.attemptId) || this.#active.size >= MAX_ACTIVE || (signal !== undefined && !isAbortSignal(signal))) {
      return Promise.reject(serviceError("SERVICE_BUSY"));
    }
    const controller = new AbortController(), combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const active: ActiveRun = { attemptId: request.attemptId, controller, promise: Promise.resolve() };
    const promise = this.#generate(request, combined).finally(() => { this.#active.delete(active); });
    active.promise = promise; this.#active.add(active); return promise;
  }

  reconcile(input: OwnerSwitchxVideoReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerSwitchxVideoGenerationResult> {
    this.#assertOpen(); const request = snapshotRecovery(input);
    if (this.#invalidating.has(request.attemptId)) throw serviceError("RECOVERY_NOT_FOUND");
    return this.#run(request.attemptId, signal, (s) => this.#reconcile(request, s));
  }

  listRecoveries(input: OwnerSwitchxVideoListInput | unknown): readonly OwnerSwitchxVideoRecoveryListItem[] {
    this.#assertOpen(); const request = snapshotList(input), recoveries = [...this.#recoveries.values()]
      .filter((row) => row.attemptId === request.attemptId).slice(0, request.limit);
    return Object.freeze(recoveries.map((row) => Object.freeze({ recovery_id: row.recovery_id, model_id: MODEL_ID,
      status: row.status, observed_artifact_count: row.artifacts.length, diagnostics: snapshotDiagnostic(row.diagnostics) })));
  }

  async invalidateAttempt(attemptInput: unknown): Promise<void> {
    const attemptId = safeAttempt(attemptInput); this.#invalidating.add(attemptId);
    const active = [...this.#active].filter((run) => run.attemptId === attemptId);
    for (const run of active) run.controller.abort();
    await Promise.allSettled(active.map((run) => run.promise));
    for (const [id, recovery] of this.#recoveries) if (recovery.attemptId === attemptId) this.#recoveries.delete(id);
    this.#clientsByAttempt.delete(attemptId); this.#invalidating.delete(attemptId);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing; this.#closed = true;
    for (const run of this.#active) run.controller.abort();
    this.#closing = (async () => {
      await Promise.allSettled([...this.#active].map((run) => run.promise));
      this.#active.clear(); this.#recoveries.clear(); this.#claims.clear(); this.#clientsByAttempt.clear();
    })();
    return this.#closing;
  }

  getSourceProfile() { this.#assertOpen(); return OWNER_SWITCHX_VIDEO_SOURCE_PROFILE; }

  async #generate(request: Readonly<OwnerSwitchxVideoGenerateInput>, signal: AbortSignal): Promise<OwnerSwitchxVideoGenerationResult> {
    const deadline = new AbsoluteRequestDeadline(this.#timeoutMs, signal, () => serviceError("OUTCOME_UNKNOWN"));
    let originalBytes: Buffer | undefined, validated: Readonly<ValidatedOwnerSwitchxVideo> | undefined;
    let semantic: string | undefined, uploadAttempted = false, chatCreated = false, generationPostStarted = false;
    let recovery: Recovery | undefined;
    try {
      deadline.throwIfAborted(); const principal = await this.#await(deadline, () => this.#principal(request.attemptId));
      originalBytes = decodeCanonicalBase64(request.content_base64);
      validated = await this.#await(deadline, () => this.#validator.validate({ filename: request.filename,
        mime_type: request.mime_type, bytes: originalBytes! }, deadline.signal));
      const input = normalizeOwnerSwitchxVideoInput({ attemptId: request.attemptId, prompt: request.prompt, video: validated });
      semantic = intentKey(principal, input);
      if (this.#claims.has(semantic)) fail("INTENT_ALREADY_CLAIMED");
      if (this.#claims.size >= MAX_RECOVERIES) fail("SERVICE_BUSY");
      this.#claims.set(semantic, "UPLOAD_PENDING");

      const client = this.#nativeClient(request.attemptId);
      const bytesForUpload = validated;
      uploadAttempted = true;
      let uploadContext: OwnerSwitchxVideoUploadContext;
      try {
        uploadContext = await this.#await(deadline, () => Reflect.apply(CLIENT_UPLOAD, client, [Object.freeze({
          attempt_id: request.attemptId, principal, destination: this.#destination, video: bytesForUpload
        }), deadline.signal]) as Promise<OwnerSwitchxVideoUploadContext>);
      } catch { fail("UPLOAD_OUTCOME_UNKNOWN"); }
      validated = undefined;

      await this.#preflight(request.attemptId, input, deadline);
      await this.#checkPrincipal(request.attemptId, principal);
      this.#claims.set(semantic, "CHAT_CREATE_PENDING");
      let chat: OwnerSwitchxVideoChatContext;
      try {
        chat = await this.#await(deadline, () => Reflect.apply(CLIENT_CREATE, client, [Object.freeze({ upload_context: uploadContext }), deadline.signal]) as Promise<OwnerSwitchxVideoChatContext>);
      } catch { fail("CHAT_OUTCOME_UNKNOWN"); }
      chatCreated = true;
      await this.#checkPrincipal(request.attemptId, principal);
      await this.#preflight(request.attemptId, input, deadline);
      await this.#checkPrincipal(request.attemptId, principal);
      recovery = this.#newRecovery(request.attemptId, principal, client, chat, input);
      this.#recoveries.set(recovery.recovery_id, recovery);
      this.#claims.set(semantic, recovery.recovery_id);
      recovery.diagnostics.phase = "GENERATION_POST"; recovery.diagnostics.generation_post_started = true; generationPostStarted = true;
      let ack: MediaGenerationReceipt;
      try {
        ack = await this.#await(deadline, () => Reflect.apply(CLIENT_START, client, [Object.freeze({ context: chat,
          attempt_id: request.attemptId, principal, prompt: request.prompt }), deadline.signal]) as Promise<MediaGenerationReceipt>);
      } catch { throw unknownError(recovery); }
      if (!validReceipt(ack, chat.chat_uuid)) throw unknownError(recovery);
      recovery.owner_echo_message_id = ack.message_id; recovery.diagnostics.owner_ack_known = true; recovery.diagnostics.phase = "ACK_KNOWN";
      return await this.#observe(recovery, deadline);
    } catch (error) {
      if (generationPostStarted && recovery) throw unknownError(recovery);
      if (semantic && !uploadAttempted) this.#claims.delete(semantic);
      if (error instanceof OwnerSwitchxVideoGenerationServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      if (error instanceof OwnerSwitchxVideoPolicyError) {
        fail(error.code === "VIDEO_METADATA_NOT_IN_INITIAL_SLICE" ? "INPUT_VIDEO_NOT_IN_INITIAL_SLICE" : error.code);
      }
      if (error instanceof OwnerSwitchxVideoGenerationServiceError) throw error;
      return fail(uploadAttempted ? (chatCreated ? "PREFLIGHT_FAILED" : "UPLOAD_OUTCOME_UNKNOWN") : "PREFLIGHT_FAILED");
    } finally {
      originalBytes?.fill(0);
      if (validated && isValidatedOwnerSwitchxVideo(validated)) releaseValidatedOwnerSwitchxVideo(validated);
      deadline.close();
    }
  }

  async #reconcile(request: Readonly<OwnerSwitchxVideoReconcileInput>, signal: AbortSignal): Promise<OwnerSwitchxVideoGenerationResult> {
    const recovery = this.#ownedRecovery(request.attemptId, request.recovery_id, await this.#principal(request.attemptId));
    if (recovery.status === "completed") return resultFromRecovery(recovery);
    const deadline = new AbsoluteRequestDeadline(this.#timeoutMs, signal, () => unknownError(recovery));
    try {
      await this.#checkPrincipal(request.attemptId, recovery.principal);
      if (this.#nativeClient(request.attemptId) !== recovery.client) fail("PRINCIPAL_NOT_LINKED");
      return await this.#observe(recovery, deadline);
    } catch (error) {
      if (error instanceof OwnerSwitchxVideoGenerationServiceError && error.code === "RECOVERY_NOT_FOUND") throw error;
      throw unknownError(recovery);
    } finally { deadline.close(); }
  }

  async #observe(recovery: Recovery, deadline: AbsoluteRequestDeadline): Promise<OwnerSwitchxVideoGenerationResult> {
    deadline.throwIfAborted(); await this.#checkPrincipal(recovery.attemptId, recovery.principal);
    if (!recovery.owner_echo_message_id) throw unknownError(recovery);
    let context: ReturnType<typeof readOwnerSwitchxVideoChatState>;
    try { context = readOwnerSwitchxVideoChatState(recovery.client, recovery.chat); }
    catch { recovery.diagnostics.gaps = ["CHAT_CONTEXT_UNVERIFIED"]; throw unknownError(recovery); }
    if (context.chat_uuid !== recovery.chat.chat_uuid || context.attempt_id !== recovery.attemptId ||
        !sameGenerationPrincipal(context.principal, recovery.principal) || !context.dispatch_attempted ||
        context.metadata.sha256 !== recovery.input.source_sha256 || context.metadata.size !== recovery.input.source_size ||
        context.metadata.width !== recovery.input.source_width || context.metadata.height !== recovery.input.source_height ||
        context.metadata.duration_seconds !== 5 || context.metadata.frame_rate !== 24) {
      recovery.diagnostics.gaps = ["CHAT_CONTEXT_BINDING_MISMATCH"]; throw unknownError(recovery);
    }

    recovery.diagnostics.phase = "HISTORY_GET";
    let rawIndex: unknown;
    try {
      rawIndex = await this.#await(deadline, () => Reflect.apply(CLIENT_INDEX, recovery.client, [deadline.signal]) as Promise<unknown>);
      await this.#checkPrincipal(recovery.attemptId, recovery.principal);
    } catch { recovery.diagnostics.gaps = ["INDEX_READ_UNVERIFIED"]; throw unknownError(recovery); }
    const providerChatId = switchxIndexChatId(rawIndex, recovery.chat.chat_uuid);
    if (!providerChatId) { recovery.diagnostics.gaps = ["INDEX_CHAT_BINDING_MISMATCH"]; throw unknownError(recovery); }

    recovery.diagnostics.history_get_calls++;
    let rawHistory: unknown;
    try {
      rawHistory = await this.#await(deadline, () => Reflect.apply(CLIENT_HISTORY, recovery.client,
        [recovery.chat.chat_uuid, deadline.signal]) as Promise<unknown>);
      await this.#checkPrincipal(recovery.attemptId, recovery.principal);
    } catch { recovery.diagnostics.gaps = ["HISTORY_READ_UNVERIFIED"]; throw unknownError(recovery); }
    const history = validateSwitchxHistory(rawHistory, recovery, providerChatId, context.reference_url_sha256);
    if (!history) { recovery.diagnostics.gaps = ["HISTORY_BINDING_UNVERIFIED"]; throw unknownError(recovery); }

    const details = [];
    for (const messageId of [recovery.owner_echo_message_id, history.provider_message_id]) {
      recovery.diagnostics.phase = "RESULT_GET"; recovery.diagnostics.result_get_calls++;
      let detail: unknown;
      try {
        await this.#checkPrincipal(recovery.attemptId, recovery.principal);
        detail = await this.#await(deadline, () => Reflect.apply(CLIENT_DETAIL, recovery.client,
          [recovery.chat.chat_uuid, messageId, deadline.signal]) as Promise<unknown>);
        await this.#checkPrincipal(recovery.attemptId, recovery.principal);
      } catch { recovery.diagnostics.gaps = ["DETAIL_READ_UNVERIFIED"]; throw unknownError(recovery); }
      details.push(detail);
    }
    const ownerDetail = validateSwitchxDetail(details[0], recovery.owner_echo_message_id, providerChatId, history.owner_author_id,
      recovery.input.prompt, context.reference_url_sha256, history.owner_objects);
    const botArtifacts = validateSwitchxBotDetail(details[1], history.provider_message_id, providerChatId, history.bot_objects);
    if (!ownerDetail || !botArtifacts) { recovery.diagnostics.gaps = ["DETAIL_BINDING_UNVERIFIED"]; throw unknownError(recovery); }
    recovery.artifacts = Object.freeze(botArtifacts.map((url) => Object.freeze({ url })));
    recovery.status = "completed"; recovery.diagnostics.phase = "RESULT_BINDING"; recovery.diagnostics.gaps = [];
    return resultFromRecovery(recovery);
  }

  async #preflight(attemptId: string, input: Readonly<OwnerSwitchxNormalizedVideoInput>, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted();
    let account: AccountStatusService, access: ModelAccessService;
    try {
      account = Reflect.apply(this.#createAccount, undefined, [attemptId]) as AccountStatusService;
      access = Reflect.apply(this.#createAccess, undefined, [attemptId]) as ModelAccessService;
    } catch { fail("PREFLIGHT_FAILED"); }
    if (!(account! instanceof AccountStatusService) || !genuineMethods(account!, AccountStatusService, ["getAccountStatus"]) ||
        !(access! instanceof ModelAccessService) || !genuineMethods(access!, ModelAccessService, ["getModelAccess"])) fail("PREFLIGHT_FAILED");
    let accountResult: AccountStatusResult, quote: ModelAccessResult;
    try {
      accountResult = await this.#await(deadline, () => Reflect.apply(ACCOUNT_GET, account!, [deadline.signal]) as Promise<AccountStatusResult>);
      quote = await this.#await(deadline, () => Reflect.apply(MODEL_ACCESS_GET, access!, [Object.freeze({ model_id: MODEL_ID,
        cost_parameters: input.cost_parameters }), deadline.signal]) as Promise<ModelAccessResult>);
    } catch { fail("PREFLIGHT_FAILED"); }
    const now = this.#readNow(), model = this.#catalog.getModel(MODEL_ID);
    const cost = quote!.discount_cost ?? quote!.cost;
    const available = accountResult!.balance.available === null ? null : Number(accountResult!.balance.available);
    if (!validAccount(accountResult!, now) || quote!.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" ||
        quote!.catalog_version !== `${this.#catalog.fetched_at}.${this.#catalog.source_hashes.models.slice(7, 19)}` ||
        quote!.model_id !== MODEL_ID || quote!.ai_name !== AI_NAME || quote!.model_type !== MODEL_ID || quote!.account_read_live !== true ||
        quote!.access !== true || quote!.parameters_redacted !== true || !sameStrings(quote!.parameter_keys, ["frame_rate", "resolution", "video_duration"]) ||
        !finiteNonnegative(cost) || available === null || !Number.isFinite(available) || available < cost || !freshIso(quote!.observed_at, now) || !model.active) {
      fail("PREFLIGHT_FAILED");
    }
  }

  #assertCatalog(): void {
    try {
      const model = this.#catalog.getModel(MODEL_ID), settings = model.settings;
      if (this.#catalogVersion !== CATALOG_VERSION || this.#catalog.source_hashes.models !== CATALOG_CANONICAL_SHA256 ||
          model.id !== MODEL_ID || model.upstream_id !== MODEL_ID || model.ai_name !== AI_NAME || model.active !== true ||
          !model.operations.some((operation) => operation.id === "generate-video" && operation.output_modality === "video") ||
          settings?.max_prompt_length !== 2_000 || settings.uploadable !== true ||
          !sameStrings(settings.get_cost_params, ["resolution", "video_duration", "frame_rate"])) fail("MODEL_BINDING_MISMATCH");
    } catch (error) { if (error instanceof OwnerSwitchxVideoGenerationServiceError) throw error; fail("MODEL_BINDING_MISMATCH"); }
  }

  #newRecovery(attemptId: string, principal: Readonly<GenerationPrincipalRef>, client: SyntxChatHttpClient,
    chat: Readonly<OwnerSwitchxVideoChatContext>, input: Readonly<OwnerSwitchxNormalizedVideoInput>): Recovery {
    if (this.#recoveries.size >= MAX_RECOVERIES) fail("SERVICE_BUSY");
    const now = this.#readNow();
    return { recovery_id: `switchx_video_recovery_${randomUUID()}`, attemptId, principal, client, chat, input,
      created_at: new Date(now).toISOString(), status: "outcome_unknown", owner_echo_message_id: null, artifacts: Object.freeze([]),
      diagnostics: { phase: "CHAT_CREATE", upload_attempted: true, chat_created: true, generation_post_started: false,
        owner_ack_known: false, history_get_calls: 0, result_get_calls: 0, gaps: [] } };
  }

  #ownedRecovery(attemptId: string, recoveryId: string, principal: Readonly<GenerationPrincipalRef>): Recovery {
    const row = this.#recoveries.get(recoveryId);
    if (!row || row.attemptId !== attemptId || !sameGenerationPrincipal(row.principal, principal) || this.#invalidating.has(attemptId)) fail("RECOVERY_NOT_FOUND");
    return row;
  }
  #nativeClient(attemptId: string): SyntxChatHttpClient {
    let value: unknown;
    try { value = Reflect.apply(this.#resolveChatClient, undefined, [attemptId]); } catch { fail("PREFLIGHT_FAILED"); }
    if (!isOwnerSwitchxVideoNativeClient(value)) fail("PREFLIGHT_FAILED");
    const previous = this.#clientsByAttempt.get(attemptId);
    if (previous && previous !== value) fail("PRINCIPAL_NOT_LINKED");
    this.#clientsByAttempt.set(attemptId, value);
    return value;
  }
  async #principal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    try {
      const principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#links });
      if (principal.connection_id !== attemptId || principal.tenant_id !== this.#binding.tenant_id || principal.subject_id !== this.#binding.subject) fail("PRINCIPAL_NOT_LINKED");
      return principal;
    } catch { fail("PRINCIPAL_NOT_LINKED"); }
  }
  async #checkPrincipal(attemptId: string, expected: Readonly<GenerationPrincipalRef>): Promise<void> {
    if (this.#invalidating.has(attemptId) || !sameGenerationPrincipal(await this.#principal(attemptId), expected)) fail("PRINCIPAL_NOT_LINKED");
  }
  #run<T>(attemptId: string, parent: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.#assertOpen();
    if (this.#invalidating.has(attemptId) || this.#active.size >= MAX_ACTIVE || (parent && !isAbortSignal(parent))) return Promise.reject(serviceError("SERVICE_BUSY"));
    const controller = new AbortController(), signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
    const active: ActiveRun = { attemptId, controller, promise: Promise.resolve() };
    const promise = operation(signal).finally(() => { this.#active.delete(active); });
    active.promise = promise; this.#active.add(active); return promise;
  }
  #await<T>(deadline: AbsoluteRequestDeadline, operation: () => Promise<T>): Promise<T> {
    deadline.throwIfAborted(); return deadline.waitFor(Promise.resolve().then(operation));
  }
  #readNow(): number {
    const value = this.#now(); if (!Number.isSafeInteger(value) || value < this.#lastNow) fail("SERVICE_BUSY");
    this.#lastNow = value; return value;
  }
  #assertOpen(): void { if (this.#closed || !SERVICES.has(this)) fail("SERVICE_CLOSED"); }
}

export function isOwnerSwitchxVideoGenerationService(value: unknown): value is OwnerSwitchxVideoGenerationService {
  return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) &&
    Object.getPrototypeOf(value) === OwnerSwitchxVideoGenerationService.prototype;
}

function snapshotGenerate(value: unknown): Readonly<OwnerSwitchxVideoGenerateInput> {
  const row = exact(value, ["attemptId", "prompt", "filename", "mime_type", "content_base64"]);
  if (typeof row.attemptId !== "string" || !ATTEMPT.test(row.attemptId) || typeof row.prompt !== "string" ||
      typeof row.filename !== "string" || typeof row.mime_type !== "string" ||
      (row.mime_type !== "video/mp4" && row.mime_type !== "video/quicktime") || typeof row.content_base64 !== "string") invalid();
  return Object.freeze({ attemptId: row.attemptId, prompt: row.prompt, filename: row.filename, mime_type: row.mime_type, content_base64: row.content_base64 });
}
function snapshotRecovery(value: unknown): Readonly<OwnerSwitchxVideoReconcileInput> {
  const row = exact(value, ["attemptId", "recovery_id"]);
  if (typeof row.attemptId !== "string" || !ATTEMPT.test(row.attemptId) || typeof row.recovery_id !== "string" || !RECOVERY.test(row.recovery_id)) invalid();
  return Object.freeze({ attemptId: row.attemptId, recovery_id: row.recovery_id });
}
function snapshotList(value: unknown): Readonly<{ attemptId: string; limit: number }> {
  const row = exact(value, ["attemptId"], ["limit"]);
  if (typeof row.attemptId !== "string" || !ATTEMPT.test(row.attemptId) || (row.limit !== undefined && (!Number.isSafeInteger(row.limit) || row.limit < 1 || row.limit > 20))) invalid();
  return Object.freeze({ attemptId: row.attemptId, limit: row.limit === undefined ? 20 : row.limit });
}
function decodeCanonicalBase64(value: string): Buffer {
  if (!value || value.length > 14_000_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) invalid();
  const bytes = Buffer.from(value, "base64"); if (bytes.length < 16 || bytes.length > 10 * 1024 * 1024 || bytes.toString("base64") !== value) {
    bytes.fill(0); fail("INVALID_REQUEST");
  }
  return bytes;
}
function intentKey(principal: Readonly<GenerationPrincipalRef>, input: Readonly<OwnerSwitchxNormalizedVideoInput>): string {
  return createHash("sha256").update(JSON.stringify([principal.tenant_id, principal.subject_id, MODEL_ID,
    input.prompt, input.source_sha256, input.source_size, "720P", "auto", 5, 24])).digest("hex");
}
function resultFromRecovery(row: Recovery): OwnerSwitchxVideoGenerationResult {
  return Object.freeze({ status: "completed", status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", backend_acceptance: "UNPROVEN",
    provider_terminal_status: "UNPROVEN", cost_cap_enforced: false, recovery_id: row.recovery_id, model_id: MODEL_ID,
    source_binding: Object.freeze({ public_catalog_version: CATALOG_VERSION, profile_sha256: OWNER_SWITCHX_VIDEO_SOURCE_PROFILE.source_pins.form_sha256,
      source_sha256: row.input.source_sha256, input_size: row.input.source_size, width: row.input.source_width, height: row.input.source_height,
      video_duration: 5, frame_rate: 24 }), artifacts: Object.freeze([...row.artifacts]), diagnostics: snapshotDiagnostic(row.diagnostics) });
}
function snapshotDiagnostic(row: MutableDiagnostic): OwnerSwitchxVideoDiagnostic {
  return Object.freeze({ phase: row.phase, upload_attempted: row.upload_attempted, chat_created: row.chat_created,
    generation_post_started: row.generation_post_started, owner_ack_known: row.owner_ack_known,
    history_get_calls: row.history_get_calls, result_get_calls: row.result_get_calls, gaps: Object.freeze([...row.gaps].slice(0, 16)) });
}
function unknownError(row: Recovery): OwnerSwitchxVideoGenerationServiceError {
  return new OwnerSwitchxVideoGenerationServiceError("OUTCOME_UNKNOWN", row.recovery_id, snapshotDiagnostic(row.diagnostics));
}
function validReceipt(value: unknown, chat: string): value is MediaGenerationReceipt {
  try { const row = exact(value, ["chat_uuid", "message_id"]); return row.chat_uuid === chat && typeof row.message_id === "string" && SAFE_ID.test(row.message_id); }
  catch { return false; }
}
interface SwitchxHistoryObject { readonly id: string; readonly message_id: string; readonly object_type: string; readonly model_type: string | null;
  readonly completed: boolean | null; readonly object_url?: string | null; readonly object_text?: string | null }
interface SwitchxHistoryProof { readonly provider_message_id: string; readonly owner_author_id: number; readonly owner_objects: readonly SwitchxHistoryObject[];
  readonly bot_objects: readonly SwitchxHistoryObject[] }
function safeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value); if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (keys.length > 80 || keys.some((key) => typeof key !== "string" || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) return null;
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch { return null; }
}
function switchxProviderId(value: unknown): string | null {
  const candidate = typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : value;
  return typeof candidate === "string" && SAFE_ID.test(candidate) ? candidate : null;
}
function safeR2ArtifactUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 4_096) return false;
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "r2.syntx.ai" && !url.username && !url.password &&
    !url.port && !url.hash; } catch { return false; }
}
function switchxObjects(value: unknown, messageId: string): readonly SwitchxHistoryObject[] | null {
  if (!Array.isArray(value) || value.length > 16) return null;
  const ids = new Set<string>(), rows: SwitchxHistoryObject[] = [];
  for (const item of value) {
    const row = safeRecord(item); if (!row) return null;
    const id = switchxProviderId(row.id), objectMessageId = switchxProviderId(row.message_id);
    if (!id || ids.has(id) || objectMessageId !== messageId || typeof row.object_type !== "string" || !SAFE_ID.test(row.object_type) ||
        !(row.model_type === "switchx" || row.model_type === null || row.model_type === undefined) ||
        !(row.completed === true || row.completed === false || row.completed === null || row.completed === undefined) ||
        (row.object_url !== undefined && row.object_url !== null && typeof row.object_url !== "string") ||
      (row.object_text !== undefined && row.object_text !== null && (typeof row.object_text !== "string" || row.object_text.length > 5_000))) return null;
    ids.add(id); rows.push(Object.freeze({ id, message_id: objectMessageId, object_type: row.object_type,
      model_type: typeof row.model_type === "string" ? row.model_type : null,
      completed: typeof row.completed === "boolean" ? row.completed : null,
      ...(Object.hasOwn(row, "object_url") ? { object_url: row.object_url as string | null } : {}),
      ...(Object.hasOwn(row, "object_text") ? { object_text: row.object_text as string | null } : {}) }));
  }
  return Object.freeze(rows);
}
function switchxIndexChatId(value: unknown, chatUuid: string): string | null {
  const index = safeRecord(value), chats = index?.chats, pagination = safeRecord(index?.pagination);
  if (!Array.isArray(chats) || chats.length > 20 || !pagination || pagination.page !== 1 || pagination.page_size !== 20 ||
      !Number.isSafeInteger(pagination.total_count) || (pagination.total_count as number) < chats.length || (pagination.total_count as number) > 2_000_000 ||
      !Number.isSafeInteger(pagination.total_pages) || (pagination.total_pages as number) > 100_000 ||
      (pagination.total_pages as number) !== Math.ceil((pagination.total_count as number) / 20) ||
      pagination.has_previous !== false || pagination.has_next !== ((pagination.total_pages as number) > 1) || chats.length !== Math.min(20, pagination.total_count as number)) return null;
  const matches = chats.map(safeRecord).filter((row): row is Record<string, unknown> => row !== null && row.uuid === chatUuid);
  if (matches.length !== 1) return null;
  const row = matches[0]!, providerChatId = switchxProviderId(row.id);
  const title = row.title;
  if (!providerChatId || row.scope !== "video" || typeof title !== "string" ||
      !/^owner-switchx-video-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(title) ||
      typeof row.created_at !== "string" || row.created_at.length > 64 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/u.test(row.created_at) ||
      !Number.isFinite(Date.parse(row.created_at))) return null;
  return providerChatId;
}
function validateSwitchxHistory(value: unknown, recovery: Recovery, providerChatId: string, referenceUrlSha256: string): SwitchxHistoryProof | null {
  const history = safeRecord(value), pagination = safeRecord(history?.pagination), messages = history?.messages;
  if (!Array.isArray(messages) || messages.length !== 2 || messages.length > 10 || !pagination || pagination.page !== 1 || pagination.page_size !== 10 ||
      pagination.total_count !== messages.length || pagination.total_pages !== 1 || pagination.has_next !== false || pagination.has_previous !== false) return null;
  const parsed = messages.map((item) => {
    const row = safeRecord(item); if (!row) return null;
    const id = switchxProviderId(row.id), chatId = switchxProviderId(row.chat_id), objects = id ? switchxObjects(row.message_object, id) : null;
    if (!id || !chatId || chatId !== providerChatId || !Number.isSafeInteger(row.author_id) || !objects) return null;
    return { id, chat_id: chatId, author_id: row.author_id as number, objects };
  });
  if (parsed.some((row) => row === null)) return null;
  const rows = parsed as Array<{ id: string; chat_id: string; author_id: number; objects: readonly SwitchxHistoryObject[] }>;
  const ownerRows = rows.filter((row) => row.id === recovery.owner_echo_message_id && row.author_id > 0);
  const botRows = rows.filter((row) => row.author_id === -1 && row.id !== recovery.owner_echo_message_id);
  if (ownerRows.length !== 1 || botRows.length !== 1 || rows.some((row) => row.id !== recovery.owner_echo_message_id && row.author_id !== -1)) return null;
  const ownerObjects = ownerRows[0]!.objects, botObjects = botRows[0]!.objects;
  if (ownerObjects.length !== 2 || botObjects.length !== 2) return null;
  const promptObjects = ownerObjects.filter((object) => object.object_type === "text"), inputObjects = ownerObjects.filter((object) => object.object_type === "video");
  if (promptObjects.length !== 1 || inputObjects.length !== 1 || ownerObjects.some((object) => object.model_type !== MODEL_ID || object.completed !== true) ||
      promptObjects[0]!.object_text !== recovery.input.prompt || !safeR2ArtifactUrl(inputObjects[0]!.object_url)) return null;
  const referenceHash = createHash("sha256").update(inputObjects[0]!.object_url!, "utf8").digest("hex");
  if (referenceHash !== referenceUrlSha256) return null;
  const botIds = botObjects.map((object) => object.id), botUrls = botObjects.map((object) => object.object_url);
  if (botObjects.some((object) => object.object_type !== "video" || object.model_type !== MODEL_ID || object.completed !== true || !safeR2ArtifactUrl(object.object_url)) ||
      new Set(botIds).size !== 2 || new Set(botUrls).size !== 2 || new Set([...ownerObjects, ...botObjects].map((object) => object.id)).size !== 4) return null;
  return Object.freeze({ provider_message_id: botRows[0]!.id, owner_author_id: ownerRows[0]!.author_id, owner_objects: ownerObjects, bot_objects: botObjects });
}
function validateSwitchxDetail(value: unknown, messageId: string, providerChatId: string, ownerAuthorId: number, prompt: string, referenceUrlSha256: string,
  historyObjects: readonly SwitchxHistoryObject[]): boolean {
  const detail = safeRecord(value); if (!detail || switchxProviderId(detail.id) !== messageId || switchxProviderId(detail.chat_id) !== providerChatId ||
      !Number.isSafeInteger(detail.author_id) || detail.author_id !== ownerAuthorId || ownerAuthorId <= 0) return false;
  const objects = switchxObjects(detail.message_object, messageId); if (!objects || objects.length !== historyObjects.length ||
      objects.some((object, index) => object.id !== historyObjects[index]!.id || object.object_type !== historyObjects[index]!.object_type ||
        object.model_type !== historyObjects[index]!.model_type || object.completed !== historyObjects[index]!.completed ||
        object.object_text !== historyObjects[index]!.object_text || object.object_url !== historyObjects[index]!.object_url)) return false;
  if (messageId === historyObjects[0]?.message_id && detail.author_id === ownerAuthorId) {
    const text = objects.filter((object) => object.object_type === "text"), video = objects.filter((object) => object.object_type === "video");
    return detail.author_id > 0 && text.length === 1 && video.length === 1 && text[0]!.object_text === prompt && safeR2ArtifactUrl(video[0]!.object_url) &&
      createHash("sha256").update(video[0]!.object_url!, "utf8").digest("hex") === referenceUrlSha256;
  }
  return false;
}
function validateSwitchxBotDetail(value: unknown, messageId: string, providerChatId: string,
  historyObjects: readonly SwitchxHistoryObject[]): readonly string[] | null {
  const detail = safeRecord(value);
  if (!detail || switchxProviderId(detail.id) !== messageId || switchxProviderId(detail.chat_id) !== providerChatId || detail.author_id !== -1) return null;
  const objects = switchxObjects(detail.message_object, messageId);
  if (!objects || objects.length !== historyObjects.length || objects.length !== 2 || objects.some((object, index) =>
      object.id !== historyObjects[index]!.id || object.object_type !== historyObjects[index]!.object_type || object.model_type !== historyObjects[index]!.model_type ||
      object.completed !== historyObjects[index]!.completed || object.object_url !== historyObjects[index]!.object_url) ||
      objects.some((object) => object.object_type !== "video" || object.model_type !== MODEL_ID || object.completed !== true || !safeR2ArtifactUrl(object.object_url))) return null;
  const urls = objects.map((object) => object.object_url as string);
  return new Set(urls).size === 2 ? Object.freeze(urls) : null;
}
function validAccount(value: AccountStatusResult, now: number): boolean {
  const balance = value.balance?.available, subscription = value.subscription;
  if (value.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || value.source_build !== ACCOUNT_SOURCE_BUILD ||
      typeof value.observed_at !== "string" || !freshIso(value.observed_at, now) || value.balance?.unit !== "tokens" ||
      typeof balance !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(balance) || subscription?.active !== true ||
      !(subscription.end_date === null || typeof subscription.end_date === "string")) return false;
  if (subscription.end_date === null) return true;
  const expiry = subscription.end_date_kind === "DATE_ONLY"
    ? Date.parse(`${subscription.end_date}T23:59:59.999Z`)
    : Date.parse(subscription.end_date);
  return Number.isFinite(expiry) && expiry >= now;
}
function freshIso(value: string, now: number): boolean { const timestamp = Date.parse(value); return Number.isFinite(timestamp) && timestamp <= now + 30_000 && timestamp >= now - 300_000; }
function finiteNonnegative(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function sameStrings(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && [...value].every((item) => typeof item === "string") &&
    [...value].sort().join("\0") === [...expected].sort().join("\0");
}
function genuineMethods<T>(value: unknown, ctor: new (...args: never[]) => T, methods: readonly string[]): value is T {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === ctor.prototype &&
    methods.every((method) => !Object.hasOwn(value, method) && Reflect.get(value, method) === Reflect.get(ctor.prototype, method)); }
  catch { return false; }
}
function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const row = exact(value, ["tenant_id", "subject"]);
  if (typeof row.tenant_id !== "string" || !row.tenant_id.trim() || typeof row.subject !== "string" || !row.subject.trim()) invalid();
  return Object.freeze({ tenant_id: row.tenant_id, subject: row.subject });
}
function safeAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) invalid(); return value; }
function bounded(value: unknown, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback; if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) invalid(); return value as number;
}
function isAbortSignal(value: unknown): value is AbortSignal {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === AbortSignal.prototype;
}
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return invalid(); }
  const actual = Reflect.ownKeys(descriptors);
  if ((Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
      required.some((key) => !Object.hasOwn(descriptors, key)) || actual.some((key) => typeof key !== "string" ||
        (!required.includes(key) && !optional.includes(key)) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
  const out = Object.create(null) as Record<string, unknown>; for (const key of actual as string[]) out[key] = descriptors[key]!.value; return out;
}
function invalid(): never { throw serviceError("INVALID_REQUEST"); }
function fail(code: OwnerSwitchxVideoGenerationServiceErrorCode): never { throw serviceError(code); }
function serviceError(code: OwnerSwitchxVideoGenerationServiceErrorCode, recoveryId?: string, diagnostics?: OwnerSwitchxVideoDiagnostic): OwnerSwitchxVideoGenerationServiceError {
  return new OwnerSwitchxVideoGenerationServiceError(code, recoveryId, diagnostics);
}
