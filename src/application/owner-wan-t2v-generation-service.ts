import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import {
  SyntxChatHttpClient,
  type ChatMessageHistoryCandidate,
  type ChatMessageHistorySnapshot,
  type InProgressMessage,
  type MediaGenerationReceipt
} from "../adapter/syntx/chat-http-client.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import {
  normalizeOwnerWanT2vGenerationParameters,
  projectOwnerWanT2vGenerationWireCandidate,
  OwnerWanT2vGenerationParametersError,
  getOwnerWanT2vGenerationParametersSource,
  type OwnerWanT2vGenerationIntent,
  type OwnerWanT2vGenerationModel,
  type OwnerWanT2vGenerationNormalizedIntent,
  type OwnerWanT2vGenerationWireCandidate
} from "./owner-wan-t2v-generation-parameters.js";
import { AccountStatusService, type AccountStatusResult } from "./account-status.js";
import { ModelAccessService, type ModelAccessResult } from "./model-access.js";

const MODELS = Object.freeze(["wan_26_t2v", "wan_27_t2v"] as const);
const PUBLIC_CATALOG_VERSION = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json" as const;
const PUBLIC_MODELS_SHA256 = "sha256:7ffbeff2ef1efa9d617d6e26e3e1c11e1d355cc45b34a2a427159f7e91fa4667" as const;
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const MAX_PROMPT_UTF8_BYTES = 65_536;
// Local memory bound only. This is not a provider output limit or proof that
// the native history/result reader can attribute this many outputs.
const MAX_RESULTS = 4_096;
const RESULT_PAGE_SIZE = 64;
const MAX_RECOVERIES = 128;
const MAX_RUNS = 4;
const MAX_CLOCK_SKEW_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_DELAY_MS = 500;
const DEFAULT_POLL_ATTEMPTS = 2;

const ACCOUNT_METHOD = AccountStatusService.prototype.getAccountStatus;
const ACCESS_METHOD = ModelAccessService.prototype.getModelAccess;
const CHAT_CREATE = SyntxChatHttpClient.prototype.createChat;
const VIDEO_START = SyntxChatHttpClient.prototype.startVideo;
const HISTORY_LIST = SyntxChatHttpClient.prototype.listWanT2vMessageCandidates;
const MESSAGE_READ = SyntxChatHttpClient.prototype.getWanT2vVideoResultMessage;
const IN_PROGRESS_LIST = SyntxChatHttpClient.prototype.listInProgress;
const OWNER_WAN_T2V_SERVICES = new WeakSet<object>();

export type OwnerWanT2vGenerationPhase =
  | "VALIDATE_REQUEST" | "RESOLVE_PRINCIPAL" | "PREFLIGHT" | "CHAT_CREATE" | "GENERATION_POST"
  | "POST_ACK_KNOWN" | "HISTORY_GET" | "HISTORY_BINDING" | "IN_PROGRESS_GET" | "RESULT_GET" | "RESULT_BINDING" | "RESULT_WAIT";

export const OWNER_WAN_T2V_GENERATION_PHASES = Object.freeze([
  "VALIDATE_REQUEST", "RESOLVE_PRINCIPAL", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST",
  "POST_ACK_KNOWN", "HISTORY_GET", "HISTORY_BINDING", "IN_PROGRESS_GET", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"
] as const satisfies readonly OwnerWanT2vGenerationPhase[]);

export type OwnerWanT2vGenerationResultStatus = "completed" | "partial_results";
export type OwnerWanT2vGenerationRecoveryStatus = "outcome_unknown" | "partial_results";
export type OwnerWanT2vGenerationHistoryReason =
  | "HISTORY_SHAPE_INVALID" | "HISTORY_SCOPE_MISMATCH" | "HISTORY_INCOMPLETE" | "HISTORY_PAGE_UNSUPPORTED"
  | "OWNER_ACK_MISSING" | "OWNER_ACK_MISMATCH" | "OWNER_ACK_AMBIGUOUS" | "OWNER_ACK_RECEIPT_UNKNOWN" | "OTHER_AUTHOR_PRESENT"
  | "BOT_RESULT_MISSING" | "RESULT_MESSAGE_DUPLICATE" | "RESULT_OBJECT_DUPLICATE" | "RESULT_OBJECT_LIMIT_EXCEEDED"
  | "RESULT_OBJECT_TYPE_MISMATCH" | "RESULT_MODEL_TYPE_MISSING" | "RESULT_MODEL_TYPE_MISMATCH";
export const OWNER_WAN_T2V_GENERATION_HISTORY_REASONS = Object.freeze([
  "HISTORY_SHAPE_INVALID", "HISTORY_SCOPE_MISMATCH", "HISTORY_INCOMPLETE", "HISTORY_PAGE_UNSUPPORTED",
  "OWNER_ACK_MISSING", "OWNER_ACK_MISMATCH", "OWNER_ACK_AMBIGUOUS", "OWNER_ACK_RECEIPT_UNKNOWN", "OTHER_AUTHOR_PRESENT",
  "BOT_RESULT_MISSING", "RESULT_MESSAGE_DUPLICATE", "RESULT_OBJECT_DUPLICATE", "RESULT_OBJECT_LIMIT_EXCEEDED",
  "RESULT_OBJECT_TYPE_MISMATCH", "RESULT_MODEL_TYPE_MISSING", "RESULT_MODEL_TYPE_MISMATCH"
] as const satisfies readonly OwnerWanT2vGenerationHistoryReason[]);
export type OwnerWanT2vGenerationResultReason =
  | "MESSAGE_SHAPE_INVALID" | "MESSAGE_ID_MISMATCH" | "MESSAGE_CHAT_MISMATCH" | "MESSAGE_ARTIFACTS_INVALID"
  | "MESSAGE_OBJECT_COUNT_MISMATCH" | "MESSAGE_MODEL_TYPE_MISMATCH" | "MESSAGE_TYPE_MISMATCH"
  | "ARTIFACT_URL_INVALID" | "ARTIFACT_URL_DUPLICATE" | "RESULT_NOT_YET_AVAILABLE"
  | "NATIVE_RESULT_UNVERIFIED" | "NATIVE_RESULT_INCOMPLETE" | "NATIVE_MODEL_ECHO_UNKNOWN";
export const OWNER_WAN_T2V_GENERATION_RESULT_REASONS = Object.freeze([
  "MESSAGE_SHAPE_INVALID", "MESSAGE_ID_MISMATCH", "MESSAGE_CHAT_MISMATCH", "MESSAGE_ARTIFACTS_INVALID",
  "MESSAGE_OBJECT_COUNT_MISMATCH", "MESSAGE_MODEL_TYPE_MISMATCH", "MESSAGE_TYPE_MISMATCH",
  "ARTIFACT_URL_INVALID", "ARTIFACT_URL_DUPLICATE", "RESULT_NOT_YET_AVAILABLE",
  "NATIVE_RESULT_UNVERIFIED", "NATIVE_RESULT_INCOMPLETE", "NATIVE_MODEL_ECHO_UNKNOWN"
] as const satisfies readonly OwnerWanT2vGenerationResultReason[]);

export interface OwnerWanT2vGenerationDiagnostic {
  readonly phase: OwnerWanT2vGenerationPhase;
  readonly post_started: boolean;
  readonly ack_known: boolean;
  readonly history_status: "NOT_READ" | "PENDING" | "COMPLETE" | "UNVERIFIED";
  readonly history_reason: OwnerWanT2vGenerationHistoryReason | null;
  readonly history_get_calls: number;
  readonly result_get_calls: number;
  readonly inprogress_get_calls: number;
  readonly result_status: "NOT_READ" | "PENDING" | "PARTIAL" | "COMPLETE" | "UNVERIFIED";
  readonly result_reason: OwnerWanT2vGenerationResultReason | null;
}

export interface OwnerWanT2vVideoArtifact {
  readonly url: string;
  readonly mime_type: string | null;
  readonly mime_source: "URL_EXTENSION" | "UNKNOWN";
  readonly message_id: string;
  readonly message_object_id: string;
  readonly object_index: number;
  readonly model_echo: "MATCHED" | "UNKNOWN";
  readonly object_type: "video";
}

export interface OwnerWanT2vGenerationResult {
  readonly status: OwnerWanT2vGenerationResultStatus;
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly backend_acceptance: "UNPROVEN";
  readonly provider_terminal_status: "UNPROVEN";
  readonly model_id: OwnerWanT2vGenerationModel;
  readonly parameters: OwnerWanT2vGenerationIntent["parameters"];
  readonly cost_inputs: Readonly<{ video_duration: number; resolution: string }>;
  readonly cost_input_confidence: "PUBLIC_KEYS_PLUS_EXPLICIT_VALUES_LOCAL_INTEGRATION_NOT_UI_CALLER_OR_QUOTE";
  readonly recovery_id: string;
  readonly observed_artifact_count: number;
  readonly offset: number;
  readonly page_size: 64;
  readonly artifacts: readonly OwnerWanT2vVideoArtifact[];
  readonly has_more: boolean;
  readonly next_offset: number | null;
  readonly diagnostic: OwnerWanT2vGenerationDiagnostic;
}

export interface OwnerWanT2vRecoveryListItem {
  readonly recovery_id: string;
  readonly created_at: string;
  readonly model_id: OwnerWanT2vGenerationModel;
  readonly status: OwnerWanT2vGenerationRecoveryStatus;
  readonly observed_artifact_count: number;
  readonly diagnostic: OwnerWanT2vGenerationDiagnostic;
}

export type OwnerWanT2vGenerationServiceErrorCode =
  | "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH"
  | "PREFLIGHT_FAILED" | "INTENT_ALREADY_CLAIMED" | "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND";

export const OWNER_WAN_T2V_GENERATION_ERROR_CODES = Object.freeze([
  "INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH",
  "PREFLIGHT_FAILED", "INTENT_ALREADY_CLAIMED", "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"
] as const satisfies readonly OwnerWanT2vGenerationServiceErrorCode[]);

export interface OwnerWanT2vGenerationServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly createAccountStatusService: (attemptId: string) => AccountStatusService;
  readonly createModelAccessService: (attemptId: string) => ModelAccessService;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly pollDelayMs?: number;
  readonly maxPollAttempts?: number;
}

export interface OwnerWanT2vGenerateInput {
  readonly attemptId: string;
  readonly input: OwnerWanT2vGenerationIntent;
}

export interface OwnerWanT2vReconcileInput {
  readonly attemptId: string;
  readonly recovery_id: string;
}

export interface OwnerWanT2vRecoveryListInput {
  readonly attemptId: string;
  readonly limit?: number;
}

export interface OwnerWanT2vResultPageInput {
  readonly attemptId: string;
  readonly recovery_id: string;
  readonly offset?: number;
}

export class OwnerWanT2vGenerationServiceError extends Error {
  readonly diagnostic: OwnerWanT2vGenerationDiagnostic | undefined;
  constructor(readonly code: OwnerWanT2vGenerationServiceErrorCode, readonly recovery_id?: string,
    diagnostic?: OwnerWanT2vGenerationDiagnostic) {
    super(code === "OUTCOME_UNKNOWN"
      ? "The WAN T2V request may have been dispatched; reconcile its private recovery and do not retry."
      : "The owner WAN T2V request could not be completed safely.");
    this.name = "OwnerWanT2vGenerationServiceError";
    this.diagnostic = code === "OUTCOME_UNKNOWN" && diagnostic ? diagnostic : undefined;
  }
}

interface MutableDiagnostic {
  phase: OwnerWanT2vGenerationPhase;
  post_started: boolean;
  ack_known: boolean;
  history_status: OwnerWanT2vGenerationDiagnostic["history_status"];
  history_reason: OwnerWanT2vGenerationHistoryReason | null;
  history_get_calls: number;
  result_get_calls: number;
  inprogress_get_calls: number;
  result_status: OwnerWanT2vGenerationDiagnostic["result_status"];
  result_reason: OwnerWanT2vGenerationResultReason | null;
}

interface Recovery {
  readonly recovery_id: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly intent: OwnerWanT2vGenerationIntent;
  readonly source_binding: Readonly<{ public_catalog_version: string; public_models_sha256: string; form_sha256: string }>;
  readonly semantic_key: string;
  readonly chat_uuid: string;
  readonly created_at: string;
  owner_echo_message_id: string | null;
  status: "outcome_unknown" | "partial_results" | "completed";
  artifacts: readonly OwnerWanT2vVideoArtifact[];
  readonly diagnostic: MutableDiagnostic;
}

interface ActiveRun {
  readonly attemptId: string;
  readonly controller: AbortController;
  readonly promise: Promise<unknown>;
}

/** Owner-only T2V one-shot service. Results mean local observed availability, never provider completion. */
export class OwnerWanT2vGenerationService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #catalogVersion: string;
  readonly #resolveChatClient: OwnerWanT2vGenerationServiceOptions["resolveChatClient"];
  readonly #createAccountStatusService: OwnerWanT2vGenerationServiceOptions["createAccountStatusService"];
  readonly #createModelAccessService: OwnerWanT2vGenerationServiceOptions["createModelAccessService"];
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #pollDelayMs: number;
  readonly #maxPollAttempts: number;
  readonly #recoveries = new Map<string, Recovery>();
  readonly #intentToRecovery = new Map<string, string>();
  readonly #reservedIntents = new Set<string>();
  readonly #usedAccountServices = new WeakSet<object>();
  readonly #usedAccessServices = new WeakSet<object>();
  readonly #runs = new Set<ActiveRun>();
  readonly #controllersByAttempt = new Map<string, Set<AbortController>>();
  readonly #invalidatingAttempts = new Set<string>();
  #closed = false;
  #closing: Promise<void> | undefined;
  #lastNow = -1;

  constructor(optionsInput: OwnerWanT2vGenerationServiceOptions | unknown) {
    if (new.target !== OwnerWanT2vGenerationService) invalid();
    const options = readExactRecord(optionsInput, [
      "binding", "linkService", "catalog", "catalog_version", "resolveChatClient",
      "createAccountStatusService", "createModelAccessService"
    ], ["now", "timeoutMs", "pollDelayMs", "maxPollAttempts"]);
    this.#binding = snapshotBinding(options.binding);
    this.#linkService = snapshotLinkService(options.linkService);
    if (!isExactInstance(options.catalog, DiscoveryCatalogRepository) || options.catalog_version !== PUBLIC_CATALOG_VERSION ||
        typeof options.resolveChatClient !== "function" || types.isProxy(options.resolveChatClient) ||
        typeof options.createAccountStatusService !== "function" || types.isProxy(options.createAccountStatusService) ||
        typeof options.createModelAccessService !== "function" || types.isProxy(options.createModelAccessService)) invalid();
    this.#catalog = options.catalog;
    this.#catalogVersion = options.catalog_version;
    this.#resolveChatClient = options.resolveChatClient as OwnerWanT2vGenerationServiceOptions["resolveChatClient"];
    this.#createAccountStatusService = options.createAccountStatusService as OwnerWanT2vGenerationServiceOptions["createAccountStatusService"];
    this.#createModelAccessService = options.createModelAccessService as OwnerWanT2vGenerationServiceOptions["createModelAccessService"];
    this.#now = readClockFactory(options.now);
    this.#timeoutMs = bounded(options.timeoutMs, 1_000, 5 * 60_000, DEFAULT_TIMEOUT_MS);
    this.#pollDelayMs = bounded(options.pollDelayMs, 0, 15_000, DEFAULT_POLL_DELAY_MS);
    this.#maxPollAttempts = bounded(options.maxPollAttempts, 1, 8, DEFAULT_POLL_ATTEMPTS);
    this.#assertSourceCatalog();
    Object.freeze(this);
    OWNER_WAN_T2V_SERVICES.add(this);
  }

  async generate(input: OwnerWanT2vGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerWanT2vGenerationResult> {
    const request = snapshotGenerate(input);
    return await this.#run(request.attemptId, signal, (runSignal) => this.#generate(request, runSignal));
  }

  async reconcile(input: OwnerWanT2vReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerWanT2vGenerationResult> {
    const request = snapshotReconcile(input);
    if (this.#invalidatingAttempts.has(request.attemptId)) {
      const recovery = this.#recoveries.get(request.recovery_id);
      if (recovery && recovery.attemptId === request.attemptId) throw unknownError(recovery);
      fail("RECOVERY_NOT_FOUND");
    }
    return await this.#run(request.attemptId, signal, (runSignal) => this.#reconcile(request, runSignal));
  }

  async listRecoveries(input: OwnerWanT2vRecoveryListInput | unknown): Promise<readonly OwnerWanT2vRecoveryListItem[]> {
    this.#assertOpen();
    const request = snapshotRecoveryList(input);
    const principal = await this.#resolvePrincipal(request.attemptId);
    const records = [...this.#recoveries.values()].filter((item) => item.attemptId === request.attemptId &&
      sameGenerationPrincipal(item.principal, principal) && item.status !== "completed")
      .sort((left, right) => left.created_at.localeCompare(right.created_at)).slice(0, request.limit);
    return Object.freeze(records.map((item) => Object.freeze({
      recovery_id: item.recovery_id,
      created_at: item.created_at,
      model_id: item.intent.model_id,
      status: item.status as OwnerWanT2vGenerationRecoveryStatus,
      observed_artifact_count: item.artifacts.length,
      diagnostic: snapshotDiagnostic(item.diagnostic)
    })));
  }

  async getResultPage(input: OwnerWanT2vResultPageInput | unknown): Promise<OwnerWanT2vGenerationResult> {
    this.#assertOpen();
    const request = snapshotResultPage(input);
    const principal = await this.#resolvePrincipal(request.attemptId);
    const recovery = this.#recoveries.get(request.recovery_id);
    if (!recovery || recovery.attemptId !== request.attemptId || !sameGenerationPrincipal(recovery.principal, principal)) {
      fail("RECOVERY_NOT_FOUND");
    }
    if (recovery.status === "outcome_unknown") throw unknownError(recovery);
    return pageResult(recovery, request.offset);
  }

  async invalidateAttempt(attemptIdInput: unknown): Promise<void> {
    const attemptId = safeAttempt(attemptIdInput);
    this.#invalidatingAttempts.add(attemptId);
    const active = [...this.#runs].filter((run) => run.attemptId === attemptId);
    for (const run of active) run.controller.abort();
    await Promise.allSettled(active.map((run) => run.promise));
    for (const [recoveryId, recovery] of this.#recoveries) {
      if (recovery.attemptId !== attemptId) continue;
      this.#recoveries.delete(recoveryId);
      this.#intentToRecovery.delete(recovery.semantic_key);
    }
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const run of this.#runs) run.controller.abort();
    this.#closing = (async () => {
      await Promise.allSettled([...this.#runs].map((run) => run.promise));
      this.#recoveries.clear();
      this.#intentToRecovery.clear();
      this.#reservedIntents.clear();
      this.#runs.clear();
      this.#controllersByAttempt.clear();
      this.#invalidatingAttempts.clear();
    })();
    return this.#closing;
  }

  async #generate(request: Readonly<OwnerWanT2vGenerateInput>, signal: AbortSignal): Promise<OwnerWanT2vGenerationResult> {
    let reservationKey: string | undefined;
    let recovery: Recovery | undefined;
    let postStarted = false;
    const deadline = this.#deadline(signal, () => recovery ? unknownError(recovery) : serviceError("PRE_DISPATCH_FAILED"));
    try {
      deadline.throwIfAborted();
      const normalized = normalizeOwnerWanT2vGenerationParameters(request.input);
      validateLocalPromptResourceLimit(normalized.intent.prompt);
      const source = this.#assertSourceCatalog();
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      const semanticKey = semanticIntentKey(principal, normalized);
      const existingRecoveryId = this.#intentToRecovery.get(semanticKey);
      if (existingRecoveryId) {
        const existing = this.#recoveries.get(existingRecoveryId);
        if (!existing) fail("INTENT_ALREADY_CLAIMED");
        if (existing.attemptId !== request.attemptId || !sameGenerationPrincipal(existing.principal, principal)) {
          fail("INTENT_ALREADY_CLAIMED");
        }
        if (existing.status === "outcome_unknown") fail("INTENT_ALREADY_CLAIMED");
        return pageResult(existing, 0);
      }
      if (this.#reservedIntents.has(semanticKey)) fail("SERVICE_BUSY");
      if (this.#recoveries.size + this.#reservedIntents.size >= MAX_RECOVERIES) fail("SERVICE_BUSY");
      this.#reservedIntents.add(semanticKey);
      reservationKey = semanticKey;

      this.#validateModelProfile(normalized.intent.model_id);
      await this.#runPreflight(request.attemptId, normalized, deadline);
      this.#validateModelProfile(normalized.intent.model_id);
      const client = this.#resolveNativeClient(request.attemptId);
      deadline.throwIfAborted();
      const chat = await this.#await(deadline, () => Reflect.apply(CHAT_CREATE, client,
        ["video", `owner-wan-t2v-${randomUUID()}`, deadline.signal]) as Promise<{ chat_uuid: string }>);
      if (!isSafeId(chat.chat_uuid)) fail("PRE_DISPATCH_FAILED");

      const principalAfterChat = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      if (!sameGenerationPrincipal(principal, principalAfterChat)) fail("PRINCIPAL_NOT_LINKED");
      this.#validateModelProfile(normalized.intent.model_id);
      await this.#runPreflight(request.attemptId, normalized, deadline);
      const principalBeforePost = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      if (!sameGenerationPrincipal(principal, principalBeforePost) || this.#invalidatingAttempts.has(request.attemptId)) fail("PRINCIPAL_NOT_LINKED");
      this.#validateModelProfile(normalized.intent.model_id);

      const now = this.#readNow();
      if (!Number.isFinite(new Date(now).getTime())) fail("SERVICE_BUSY");
      recovery = createRecovery({ attemptId: request.attemptId, principal, normalized, source,
        chatUuid: chat.chat_uuid, now, semanticKey });
      this.#recoveries.set(recovery.recovery_id, recovery);
      this.#intentToRecovery.set(semanticKey, recovery.recovery_id);
      this.#reservedIntents.delete(semanticKey);
      reservationKey = undefined;

      const candidate: OwnerWanT2vGenerationWireCandidate = projectOwnerWanT2vGenerationWireCandidate(normalized);
      const settings = Object.freeze({ ...candidate.settings_candidate });
      recovery.diagnostic.phase = "GENERATION_POST";
      recovery.diagnostic.post_started = true;
      postStarted = true;
      const receipt = await this.#await(deadline, () => Reflect.apply(VIDEO_START, client, [Object.freeze({
        ai_name: "wan_video",
        chat_id: chat.chat_uuid,
        prompt: normalized.intent.prompt,
        settings
      }), deadline.signal]) as Promise<MediaGenerationReceipt>);
      if (!validReceipt(receipt, chat.chat_uuid)) fail("OUTCOME_UNKNOWN");
      recovery.owner_echo_message_id = receipt.message_id;
      recovery.diagnostic.ack_known = true;
      recovery.diagnostic.phase = "POST_ACK_KNOWN";
      return await this.#observe(recovery, client, deadline);
    } catch (error) {
      if (postStarted && recovery) throw unknownError(recovery);
      if (reservationKey) this.#reservedIntents.delete(reservationKey);
      if (recovery) {
        this.#recoveries.delete(recovery.recovery_id);
        this.#intentToRecovery.delete(recovery.semantic_key);
      }
      if (error instanceof OwnerWanT2vGenerationServiceError) throw error;
      if (error instanceof OwnerWanT2vGenerationParametersError) fail("INVALID_REQUEST");
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      fail("PRE_DISPATCH_FAILED");
    } finally { deadline.close(); }
  }

  async #reconcile(request: Readonly<OwnerWanT2vReconcileInput>, signal: AbortSignal): Promise<OwnerWanT2vGenerationResult> {
    let recovery: Recovery | undefined;
    const deadline = this.#deadline(signal, () => recovery ? unknownError(recovery) : serviceError("RECOVERY_NOT_FOUND"));
    try {
      recovery = this.#recoveries.get(request.recovery_id);
      if (!recovery || recovery.attemptId !== request.attemptId) fail("RECOVERY_NOT_FOUND");
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      if (!sameGenerationPrincipal(principal, recovery.principal) || this.#invalidatingAttempts.has(request.attemptId)) throw unknownError(recovery);
      this.#validateModelProfile(recovery.intent.model_id);
      if (recovery.status === "completed") return pageResult(recovery, 0);
      return await this.#observe(recovery, this.#resolveNativeClient(request.attemptId), deadline);
    } catch (error) {
      if (error instanceof OwnerWanT2vGenerationServiceError && error.code === "RECOVERY_NOT_FOUND") throw error;
      if (!recovery) {
        if (error instanceof OwnerWanT2vGenerationServiceError) throw error;
        fail("PRE_DISPATCH_FAILED");
      }
      throw unknownError(recovery);
    } finally { deadline.close(); }
  }

  async #observe(recovery: Recovery, client: SyntxChatHttpClient, deadline: AbsoluteRequestDeadline): Promise<OwnerWanT2vGenerationResult> {
    let lastStatus: "pending" | "partial_results" = "pending";
    for (let poll = 0; poll < this.#maxPollAttempts; poll += 1) {
      deadline.throwIfAborted();
      if (this.#invalidatingAttempts.has(recovery.attemptId)) throw unknownError(recovery);
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(recovery.attemptId));
      if (!sameGenerationPrincipal(principal, recovery.principal)) throw unknownError(recovery);
      recovery.diagnostic.phase = "HISTORY_GET";
      recovery.diagnostic.history_get_calls += 1;
      let snapshot: ChatMessageHistorySnapshot;
      try {
        snapshot = await this.#await(deadline, () => Reflect.apply(HISTORY_LIST, client,
          [recovery.chat_uuid, recovery.owner_echo_message_id, deadline.signal]) as Promise<ChatMessageHistorySnapshot>);
      } catch {
        deadline.throwIfAborted();
        recovery.diagnostic.history_status = "UNVERIFIED";
        recovery.diagnostic.history_reason = "HISTORY_INCOMPLETE";
        recovery.diagnostic.result_status = "UNVERIFIED";
        throw unknownError(recovery);
      }
      recovery.diagnostic.phase = "HISTORY_BINDING";
      const history = bindT2vHistory(snapshot, recovery);
      if (history.status === "INVALID") {
        recovery.diagnostic.history_status = "UNVERIFIED";
        recovery.diagnostic.history_reason = history.reason;
        recovery.diagnostic.result_status = "UNVERIFIED";
        throw unknownError(recovery);
      }
      recovery.diagnostic.history_status = history.status === "PENDING" ? "PENDING" : "COMPLETE";
      recovery.diagnostic.history_reason = history.status === "PENDING" ? history.reason : null;
      if (history.status === "PENDING" && history.reason === "OWNER_ACK_RECEIPT_UNKNOWN") {
        recovery.diagnostic.result_status = "PENDING";
        recovery.diagnostic.result_reason = "RESULT_NOT_YET_AVAILABLE";
        throw unknownError(recovery);
      }
      if (history.status === "PENDING" || history.botMessages.length === 0) {
        recovery.diagnostic.result_status = "PENDING";
        recovery.diagnostic.result_reason = "RESULT_NOT_YET_AVAILABLE";
        if (poll + 1 < this.#maxPollAttempts) {
          recovery.diagnostic.phase = "IN_PROGRESS_GET";
          recovery.diagnostic.inprogress_get_calls += 1;
          try {
            await this.#await(deadline, () => Reflect.apply(IN_PROGRESS_LIST, client, [recovery!.chat_uuid, deadline.signal]) as Promise<InProgressMessage[]>);
          } catch { /* In-progress is ancillary; a failed GET is still no evidence of a result. */ }
          await this.#waitNext(deadline);
          continue;
        }
        throw unknownError(recovery);
      }

      const observed: OwnerWanT2vVideoArtifact[] = [];
      let incomplete = false;
      let modelEchoUnknown = false;
      const observedObjectIds = new Set<string>();
      for (const candidate of history.botMessages) {
        recovery.diagnostic.phase = "RESULT_GET";
        recovery.diagnostic.result_get_calls += 1;
        let decoded: Awaited<ReturnType<SyntxChatHttpClient["getWanT2vVideoResultMessage"]>>;
        try {
          decoded = await this.#await(deadline, () => Reflect.apply(MESSAGE_READ, client, [Object.freeze({
            chat_uuid: recovery!.chat_uuid,
            message_id: candidate.message_id,
            model_id: recovery!.intent.model_id,
            provider_chat_id: candidate.provider_chat_id,
            message_object_ids: Object.freeze(candidate.objects.map((object) => object.message_object_id))
          }), deadline.signal]) as Promise<Awaited<ReturnType<SyntxChatHttpClient["getWanT2vVideoResultMessage"]>>>);
        } catch {
          deadline.throwIfAborted();
          recovery.diagnostic.result_status = "UNVERIFIED";
          recovery.diagnostic.result_reason = "NATIVE_RESULT_UNVERIFIED";
          throw unknownError(recovery);
        }
        if (decoded.message_binding !== "BOUND") {
          recovery.diagnostic.result_status = "UNVERIFIED";
          recovery.diagnostic.result_reason = "NATIVE_RESULT_UNVERIFIED";
          throw unknownError(recovery);
        }
        if (decoded.ready_videos.length !== candidate.objects.length) incomplete = true;
        if (decoded.model_echo === "UNKNOWN") modelEchoUnknown = true;
        for (const video of decoded.ready_videos) {
          const expected = candidate.objects[video.object_index];
          if (!expected || expected.message_object_id !== video.message_object_id || video.object_type !== "video" ||
              !isSafeVideoArtifactUrl(video.object_url) || (video.mime_type !== null &&
                video.mime_type !== "video/mp4" && video.mime_type !== "video/quicktime") ||
              (video.mime_source !== "UNKNOWN" && video.mime_source !== "URL_EXTENSION") ||
              (decoded.model_echo !== "MATCHED" && decoded.model_echo !== "UNKNOWN") || observedObjectIds.has(video.message_object_id)) {
            recovery.diagnostic.result_status = "UNVERIFIED";
            recovery.diagnostic.result_reason = "NATIVE_RESULT_UNVERIFIED";
            throw unknownError(recovery);
          }
          observedObjectIds.add(video.message_object_id);
          observed.push(Object.freeze({ url: video.object_url, mime_type: video.mime_type, mime_source: video.mime_source,
            message_id: candidate.message_id, message_object_id: video.message_object_id,
            object_index: video.object_index, model_echo: decoded.model_echo, object_type: "video" }));
        }
      }
      const dedupe = new Set<string>();
      if (observed.some((artifact) => dedupe.has(artifact.url) || (dedupe.add(artifact.url), false))) {
        recovery.diagnostic.result_status = "UNVERIFIED";
        recovery.diagnostic.result_reason = "ARTIFACT_URL_DUPLICATE";
        throw unknownError(recovery);
      }
      if (observed.length > MAX_RESULTS) {
        recovery.diagnostic.result_status = "UNVERIFIED";
        recovery.diagnostic.history_reason = "RESULT_OBJECT_LIMIT_EXCEEDED";
        throw unknownError(recovery);
      }
      recovery.artifacts = Object.freeze(observed.map((artifact) => Object.freeze(artifact)));
      recovery.diagnostic.phase = "RESULT_BINDING";
      if (observed.length > 0 && !incomplete) {
        recovery.status = "completed";
        recovery.diagnostic.result_status = "COMPLETE";
        recovery.diagnostic.result_reason = modelEchoUnknown ? "NATIVE_MODEL_ECHO_UNKNOWN" : null;
        return pageResult(recovery, 0);
      }
      if (observed.length > 0) {
        recovery.status = "partial_results";
        recovery.diagnostic.result_status = "PARTIAL";
        recovery.diagnostic.result_reason = modelEchoUnknown ? "NATIVE_MODEL_ECHO_UNKNOWN" : "NATIVE_RESULT_INCOMPLETE";
        lastStatus = "partial_results";
      } else {
        recovery.diagnostic.result_status = "PENDING";
        recovery.diagnostic.result_reason = incomplete ? "NATIVE_RESULT_INCOMPLETE" : "RESULT_NOT_YET_AVAILABLE";
      }
      if (poll + 1 < this.#maxPollAttempts) {
        await this.#waitNext(deadline);
        continue;
      }
    }
    if (lastStatus === "partial_results" && recovery.artifacts.length > 0) return pageResult(recovery, 0);
    throw unknownError(recovery);
  }

  async #runPreflight(attemptId: string, normalized: OwnerWanT2vGenerationNormalizedIntent, deadline: AbsoluteRequestDeadline): Promise<void> {
    if (deadline.signal.aborted) fail("PREFLIGHT_FAILED");
    let accountService: AccountStatusService;
    let accessService: ModelAccessService;
    try {
      accountService = Reflect.apply(this.#createAccountStatusService, undefined, [attemptId]) as AccountStatusService;
      accessService = Reflect.apply(this.#createModelAccessService, undefined, [attemptId]) as ModelAccessService;
    } catch { fail("PREFLIGHT_FAILED"); }
    if (!isExactService(accountService, AccountStatusService, ["getAccountStatus"]) || this.#usedAccountServices.has(accountService) ||
        !isExactService(accessService, ModelAccessService, ["getModelAccess"]) || this.#usedAccessServices.has(accessService)) fail("PREFLIGHT_FAILED");
    this.#usedAccountServices.add(accountService);
    this.#usedAccessServices.add(accessService);
    let account: AccountStatusResult;
    let access: ModelAccessResult;
    try {
      account = await this.#await(deadline, () => Reflect.apply(ACCOUNT_METHOD, accountService, [deadline.signal]) as Promise<AccountStatusResult>);
      access = await this.#await(deadline, () => Reflect.apply(ACCESS_METHOD, accessService, [Object.freeze({
        model_id: normalized.intent.model_id,
        cost_parameters: normalized.cost_query_candidate.values
      }), deadline.signal]) as Promise<ModelAccessResult>);
    } catch { fail("PREFLIGHT_FAILED"); }
    assertFreshPreflight(account, access, normalized, this.#catalog, this.#readNow());
  }

  #assertSourceCatalog(): ReturnType<typeof getOwnerWanT2vGenerationParametersSource> {
    let source: ReturnType<typeof getOwnerWanT2vGenerationParametersSource>;
    try { source = getOwnerWanT2vGenerationParametersSource(); }
    catch { fail("MODEL_BINDING_MISMATCH"); }
    if (this.#catalogVersion !== PUBLIC_CATALOG_VERSION || this.#catalog.source_hashes.models !== PUBLIC_MODELS_SHA256 ||
        source.source_pins.public_catalog_version !== PUBLIC_CATALOG_VERSION || source.source_pins.public_models_sha256 !== PUBLIC_MODELS_SHA256 ||
        source.source_pins.settings_inventory_version !== "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json" ||
        source.runtime_usable !== false || source.dispatch_allowed !== false || source.backend_acceptance !== "UNPROVEN") fail("MODEL_BINDING_MISMATCH");
    return source;
  }

  #validateModelProfile(modelId: OwnerWanT2vGenerationModel): void {
    this.#assertSourceCatalog();
    if (!MODELS.includes(modelId)) fail("MODEL_BINDING_MISMATCH");
    const model = this.#catalog.getModel(modelId);
    const source = getOwnerWanT2vGenerationParametersSource().models.find((item) => item.model_id === modelId);
    const declaredCostKeys = model.settings?.get_cost_params;
    if (!source || model.active !== true || model.id !== modelId || model.upstream_id !== modelId || model.ai_name !== "wan_video" ||
        model.scope !== "video" || !model.modalities.includes("video") ||
        !model.operations.some((operation) => operation.id === "generate-video" && operation.output_modality === "video") ||
        !Array.isArray(declaredCostKeys) || !sameStrings(declaredCostKeys, ["video_duration", "resolution"])) fail("MODEL_BINDING_MISMATCH");
  }

  #resolveNativeClient(attemptId: string): SyntxChatHttpClient {
    let client: unknown;
    try { client = Reflect.apply(this.#resolveChatClient, undefined, [attemptId]); } catch { fail("MODEL_BINDING_MISMATCH"); }
    if (!isExactService(client, SyntxChatHttpClient, ["createChat", "startVideo", "listWanT2vMessageCandidates", "getWanT2vVideoResultMessage", "listInProgress"]) ||
        Reflect.get(client, "createChat") !== CHAT_CREATE || Reflect.get(client, "startVideo") !== VIDEO_START ||
        Reflect.get(client, "listWanT2vMessageCandidates") !== HISTORY_LIST ||
        Reflect.get(client, "getWanT2vVideoResultMessage") !== MESSAGE_READ ||
        Reflect.get(client, "listInProgress") !== IN_PROGRESS_LIST) fail("MODEL_BINDING_MISMATCH");
    return client;
  }

  async #resolvePrincipal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    this.#assertOpen();
    if (this.#invalidatingAttempts.has(attemptId)) fail("PRINCIPAL_NOT_LINKED");
    try {
      return await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
    } catch { fail("PRINCIPAL_NOT_LINKED"); }
  }

  async #waitNext(deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted();
    if (this.#pollDelayMs === 0) return;
    await this.#await(deadline, () => waitDelay(this.#pollDelayMs, deadline.signal));
  }

  #deadline(signal: AbortSignal, errorFactory?: () => Error): AbsoluteRequestDeadline {
    return new AbsoluteRequestDeadline(this.#timeoutMs, signal, () => errorFactory?.() ?? serviceError("PRE_DISPATCH_FAILED"));
  }

  async #await<T>(deadline: AbsoluteRequestDeadline, operation: () => Promise<T> | T): Promise<T> {
    deadline.throwIfAborted();
    let pending: Promise<T>;
    try { pending = Promise.resolve(operation()); } catch (error) { throw error; }
    return deadline.waitFor(pending);
  }

  #readNow(): number {
    let value: unknown;
    try { value = Reflect.apply(this.#now, undefined, []); } catch { fail("PRE_DISPATCH_FAILED"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) < this.#lastNow) fail("PRE_DISPATCH_FAILED");
    this.#lastNow = value as number;
    return value as number;
  }

  #run<T>(attemptId: string, external: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.#assertOpen();
    if (this.#invalidatingAttempts.has(attemptId) || this.#runs.size >= MAX_RUNS) fail("SERVICE_BUSY");
    if (external !== undefined && (!(external instanceof AbortSignal) || types.isProxy(external))) fail("INVALID_REQUEST");
    const controller = new AbortController();
    const signal = external ? AbortSignal.any([controller.signal, external]) : controller.signal;
    const bucket = this.#controllersByAttempt.get(attemptId) ?? new Set<AbortController>();
    bucket.add(controller);
    this.#controllersByAttempt.set(attemptId, bucket);
    let run!: ActiveRun;
    const promise = Promise.resolve().then(() => operation(signal)).finally(() => {
      bucket.delete(controller);
      if (!bucket.size) this.#controllersByAttempt.delete(attemptId);
      this.#runs.delete(run);
    });
    run = { attemptId, controller, promise };
    this.#runs.add(run);
    return promise;
  }

  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
}

/** Nominal guard for MCP composition; forged objects, subclasses and proxies are not services. */
export function isOwnerWanT2vGenerationService(value: unknown): value is OwnerWanT2vGenerationService {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  return OWNER_WAN_T2V_SERVICES.has(value) && Object.getPrototypeOf(value) === OwnerWanT2vGenerationService.prototype &&
    Reflect.ownKeys(value).length === 0 && Object.isFrozen(value);
}

function createRecovery(input: {
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly normalized: OwnerWanT2vGenerationNormalizedIntent;
  readonly source: ReturnType<typeof getOwnerWanT2vGenerationParametersSource>;
  readonly chatUuid: string;
  readonly now: number;
  readonly semanticKey: string;
}): Recovery {
  const recoveryId = `wan_t2v_recovery_${randomUUID()}`;
  return {
    recovery_id: recoveryId,
    attemptId: input.attemptId,
    principal: input.principal,
    intent: input.normalized.intent,
    source_binding: Object.freeze({ public_catalog_version: input.source.source_pins.public_catalog_version,
      public_models_sha256: input.source.source_pins.public_models_sha256, form_sha256: input.source.source_pins.form_sha256 }),
    semantic_key: input.semanticKey,
    chat_uuid: input.chatUuid,
    created_at: new Date(input.now).toISOString(),
    owner_echo_message_id: null,
    status: "outcome_unknown",
    artifacts: Object.freeze([]),
    diagnostic: {
      phase: "GENERATION_POST", post_started: false, ack_known: false,
      history_status: "NOT_READ", history_reason: null, history_get_calls: 0, result_get_calls: 0,
      inprogress_get_calls: 0, result_status: "NOT_READ", result_reason: null
    }
  };
}

function bindT2vHistory(snapshotInput: unknown, recovery: Recovery):
  | { readonly status: "BOUND"; readonly botMessages: readonly ChatMessageHistoryCandidate[] }
  | { readonly status: "PENDING"; readonly reason: "BOT_RESULT_MISSING" | "OWNER_ACK_RECEIPT_UNKNOWN" }
  | { readonly status: "INVALID"; readonly reason: OwnerWanT2vGenerationHistoryReason } {
  try {
    const snapshot = readExactRecord(snapshotInput, ["complete", "page", "page_size", "total_count", "total_pages", "has_next",
      "has_previous", "requested_chat_uuid", "provider_chat_id", "messages"]);
    if (snapshot.complete !== true || snapshot.page !== 1 || snapshot.page_size !== 10 || snapshot.has_next !== false ||
        snapshot.has_previous !== false || snapshot.requested_chat_uuid !== recovery.chat_uuid ||
        typeof snapshot.provider_chat_id !== "string" || !/^\d{1,16}$/u.test(snapshot.provider_chat_id) ||
        !Number.isSafeInteger(Number(snapshot.provider_chat_id)) || !Array.isArray(snapshot.messages)) {
      return { status: "INVALID", reason: snapshot.complete !== true || snapshot.has_next === true
        ? "HISTORY_INCOMPLETE" : "HISTORY_SHAPE_INVALID" };
    }
    if (!Number.isSafeInteger(snapshot.total_count) || (snapshot.total_count as number) < 1 ||
        (snapshot.total_count as number) > 64 || !Number.isSafeInteger(snapshot.total_pages) ||
        snapshot.total_pages !== Math.ceil((snapshot.total_count as number) / 10) ||
        (snapshot.messages as unknown[]).length !== snapshot.total_count) {
      return { status: "INVALID", reason: (snapshot.total_count as number) > 64 || (snapshot.total_pages as number) > 7
        ? "HISTORY_PAGE_UNSUPPORTED" : "HISTORY_INCOMPLETE" };
    }
    const messages = snapshot.messages as unknown[];
    const ids = new Set<string>();
    const objectIds = new Set<string>();
    let ackCount = 0;
    let ackIndex = -1;
    const botRows: Array<{ readonly index: number; readonly candidate: ChatMessageHistoryCandidate }> = [];
    let objectCount = 0;
    for (let index = 0; index < messages.length; index += 1) {
      const raw = messages[index];
      const row = readExactRecord(raw, ["message_id", "provider_chat_id", "author_role", "objects"]);
      if (!isSafeId(row.message_id) || row.provider_chat_id !== snapshot.provider_chat_id ||
          !["owner", "bot", "other"].includes(String(row.author_role)) || !Array.isArray(row.objects)) {
        return { status: "INVALID", reason: "HISTORY_SHAPE_INVALID" };
      }
      if (ids.has(row.message_id)) return { status: "INVALID", reason: "RESULT_MESSAGE_DUPLICATE" };
      ids.add(row.message_id);
      if (row.objects.length > 64) return { status: "INVALID", reason: "RESULT_OBJECT_LIMIT_EXCEEDED" };
      if (row.author_role === "other" && recovery.owner_echo_message_id !== null) {
        return { status: "INVALID", reason: "OTHER_AUTHOR_PRESENT" };
      }
      if (row.author_role === "owner") {
        ackCount += 1;
        ackIndex = index;
        if (recovery.owner_echo_message_id === null || row.message_id !== recovery.owner_echo_message_id) {
          return { status: "INVALID", reason: "OWNER_ACK_MISMATCH" };
        }
        for (const rawAckObject of row.objects as unknown[]) {
          const ackObject = readExactRecord(rawAckObject, ["message_object_id", "object_type", "model_type"]);
          if (!isSafeId(ackObject.message_object_id)) return { status: "INVALID", reason: "HISTORY_SHAPE_INVALID" };
          if (objectIds.has(ackObject.message_object_id)) return { status: "INVALID", reason: "RESULT_OBJECT_DUPLICATE" };
          if (ackObject.object_type !== "text") return { status: "INVALID", reason: "RESULT_OBJECT_TYPE_MISMATCH" };
          if (ackObject.model_type !== null && typeof ackObject.model_type !== "string") {
            return { status: "INVALID", reason: "HISTORY_SHAPE_INVALID" };
          }
          if (typeof ackObject.model_type === "string" && ackObject.model_type !== recovery.intent.model_id) {
            return { status: "INVALID", reason: "RESULT_MODEL_TYPE_MISMATCH" };
          }
          objectIds.add(ackObject.message_object_id);
        }
        continue;
      }
      const normalizedObjects = [];
      for (const rawObject of row.objects as unknown[]) {
        const object = readExactRecord(rawObject, ["message_object_id", "object_type", "model_type"]);
        if (!isSafeId(object.message_object_id)) return { status: "INVALID", reason: "HISTORY_SHAPE_INVALID" };
        if (objectIds.has(object.message_object_id)) return { status: "INVALID", reason: "RESULT_OBJECT_DUPLICATE" };
        if (object.object_type !== "video") {
          return { status: "INVALID", reason: "RESULT_OBJECT_TYPE_MISMATCH" };
        }
        if (object.model_type !== null && typeof object.model_type !== "string") return { status: "INVALID", reason: "HISTORY_SHAPE_INVALID" };
        if (typeof object.model_type === "string" && object.model_type !== recovery.intent.model_id) {
          return { status: "INVALID", reason: "RESULT_MODEL_TYPE_MISMATCH" };
        }
        objectIds.add(object.message_object_id);
        objectCount += 1;
        normalizedObjects.push(Object.freeze({ message_object_id: object.message_object_id, object_type: "video",
          model_type: typeof object.model_type === "string" ? object.model_type : null }));
      }
      if (row.author_role === "bot") botRows.push({ index, candidate: Object.freeze({ message_id: row.message_id,
        provider_chat_id: String(row.provider_chat_id), author_role: "bot", objects: Object.freeze(normalizedObjects) }) });
      if (objectCount > MAX_RESULTS) return { status: "INVALID", reason: "RESULT_OBJECT_LIMIT_EXCEEDED" };
    }
    if (recovery.owner_echo_message_id === null) return { status: "PENDING", reason: "OWNER_ACK_RECEIPT_UNKNOWN" };
    if (ackCount !== 1) return { status: "INVALID", reason: ackCount === 0 ? "OWNER_ACK_MISSING" : "OWNER_ACK_AMBIGUOUS" };
    if (botRows.some((entry) => entry.index < ackIndex && entry.candidate.objects.length > 0)) {
      return { status: "INVALID", reason: "OWNER_ACK_MISMATCH" };
    }
    const bots = botRows.filter((entry) => entry.index > ackIndex && entry.candidate.objects.length > 0)
      .map((entry) => entry.candidate);
    if (bots.length === 0) return { status: "PENDING", reason: "BOT_RESULT_MISSING" };
    return { status: "BOUND", botMessages: Object.freeze(bots) };
  } catch {
    return { status: "INVALID", reason: "HISTORY_SHAPE_INVALID" };
  }
}

function pageResult(recovery: Recovery, offset: number): OwnerWanT2vGenerationResult {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > recovery.artifacts.length) invalid();
  const page = paginateOwnerWanT2vArtifacts(recovery.artifacts, offset);
  const artifacts = page.artifacts;
  const next = page.next_offset ?? offset + artifacts.length;
  const status = recovery.status;
  return Object.freeze({
    status: status as OwnerWanT2vGenerationResultStatus,
    status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY",
    backend_acceptance: "UNPROVEN",
    provider_terminal_status: "UNPROVEN",
    model_id: recovery.intent.model_id,
    parameters: recovery.intent.parameters,
    cost_inputs: Object.freeze({ video_duration: recovery.intent.parameters.video_duration, resolution: recovery.intent.parameters.resolution }),
    cost_input_confidence: "PUBLIC_KEYS_PLUS_EXPLICIT_VALUES_LOCAL_INTEGRATION_NOT_UI_CALLER_OR_QUOTE",
    recovery_id: recovery.recovery_id,
    observed_artifact_count: recovery.artifacts.length,
    offset,
    page_size: RESULT_PAGE_SIZE,
    artifacts: Object.freeze(artifacts),
    has_more: next < recovery.artifacts.length,
    next_offset: next < recovery.artifacts.length ? next : null,
    diagnostic: snapshotDiagnostic(recovery.diagnostic)
  });
}

/** Pure local paging of already-observed artifacts; it performs no provider I/O. */
export function paginateOwnerWanT2vArtifacts(artifacts: readonly OwnerWanT2vVideoArtifact[], offset: number): {
  readonly artifacts: readonly OwnerWanT2vVideoArtifact[];
  readonly next_offset: number | null;
} {
  if (!Array.isArray(artifacts) || artifacts.length > MAX_RESULTS || !Number.isSafeInteger(offset) || offset < 0 || offset > artifacts.length) invalid();
  const page = Object.freeze(artifacts.slice(offset, offset + RESULT_PAGE_SIZE));
  const next = offset + page.length;
  return Object.freeze({ artifacts: page, next_offset: next < artifacts.length ? next : null });
}

function assertFreshPreflight(accountInput: unknown, accessInput: unknown, normalized: OwnerWanT2vGenerationNormalizedIntent,
  catalog: DiscoveryCatalogRepository, now: number): void {
  try {
    const account = readExactRecord(accountInput, ["balance", "subscription", "contract_evidence", "source_build", "observed_at"]);
    const balance = readExactRecord(account.balance, ["unit", "available"]);
    const subscription = readExactRecord(account.subscription, ["active", "plan_type", "end_date", "end_date_kind"]);
    const access = readExactRecord(accessInput, ["catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live",
      "parameter_keys", "parameters_redacted", "access", "cost", "discount_cost", "free_remaining_generations", "limit", "show_warning", "observed_at"]);
    const expectedCatalogVersion = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
    const expectedKeys = ["resolution", "video_duration"].sort();
    const keys = denseStrings(access.parameter_keys);
    if (account.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || account.source_build !== ACCOUNT_SOURCE_BUILD || balance.unit !== "tokens" ||
        !(balance.available === null || validBalance(balance.available)) || !validSubscription(subscription, now) || !isFreshIso(account.observed_at, now) ||
        access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || access.catalog_version !== expectedCatalogVersion ||
        access.model_id !== normalized.intent.model_id || access.ai_name !== "wan_video" || access.model_type !== normalized.intent.model_id ||
        access.account_read_live !== true || access.access !== true || access.parameters_redacted !== true ||
        keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index]) || !isFreshIso(access.observed_at, now) ||
        !nullableFinite(access.cost) || !nullableFinite(access.discount_cost) ||
        !(access.free_remaining_generations === null || nonnegativeInteger(access.free_remaining_generations)) ||
        !nullableFinite(access.limit) || !(access.show_warning === null || typeof access.show_warning === "boolean")) fail("PREFLIGHT_FAILED");
  } catch (error) { if (error instanceof OwnerWanT2vGenerationServiceError) throw error; fail("PREFLIGHT_FAILED"); }
}

function validateLocalPromptResourceLimit(prompt: string): void {
  if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_UTF8_BYTES) invalid();
}

function semanticIntentKey(principal: Readonly<GenerationPrincipalRef>, normalized: OwnerWanT2vGenerationNormalizedIntent): string {
  const payload = JSON.stringify({ principal: { tenant_id: principal.tenant_id, subject_id: principal.subject_id },
    source: { public_catalog_version: PUBLIC_CATALOG_VERSION, public_models_sha256: PUBLIC_MODELS_SHA256 }, intent: normalized.intent });
  return createHash("sha256").update(payload).digest("hex");
}

function isSafeVideoArtifactUrl(value: string): boolean {
  if (value.length === 0 || value.length > 8_192) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "r2.syntx.ai" && url.port === "" && url.username === "" &&
      url.password === "" && url.hash === "";
  } catch { return false; }
}

function validReceipt(value: unknown, chatUuid: string): value is MediaGenerationReceipt {
  try {
    const row = readExactRecord(value, ["chat_uuid", "message_id"]);
    return row.chat_uuid === chatUuid && isSafeId(row.message_id);
  } catch { return false; }
}

function isExactService<T extends object>(value: unknown, ctor: new (...args: never[]) => T, methods: readonly string[]): value is T {
  if (!isExactInstance(value, ctor)) return false;
  return methods.every((method) => typeof Reflect.get(ctor.prototype, method) === "function" &&
    !Object.hasOwn(value, method) && Reflect.get(value, method) === Reflect.get(ctor.prototype, method));
}

function isExactInstance<T extends object>(value: unknown, ctor: new (...args: never[]) => T): value is T {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  try { return value instanceof ctor && Object.getPrototypeOf(value) === ctor.prototype; } catch { return false; }
}

function snapshotGenerate(value: unknown): Readonly<OwnerWanT2vGenerateInput> {
  try {
    const row = readExactRecord(value, ["attemptId", "input"]);
    const attemptId = safeAttempt(row.attemptId);
    const normalized = normalizeOwnerWanT2vGenerationParameters(row.input);
    validateLocalPromptResourceLimit(normalized.intent.prompt);
    return Object.freeze({ attemptId, input: normalized.intent });
  } catch (error) {
    if (error instanceof OwnerWanT2vGenerationServiceError) throw error;
    if (error instanceof OwnerWanT2vGenerationParametersError) fail("INVALID_REQUEST");
    fail("INVALID_REQUEST");
  }
}

function snapshotReconcile(value: unknown): Readonly<OwnerWanT2vReconcileInput> {
  const row = readExactRecord(value, ["attemptId", "recovery_id"]);
  const attemptId = safeAttempt(row.attemptId);
  if (!isRecoveryId(row.recovery_id)) invalid();
  return Object.freeze({ attemptId, recovery_id: row.recovery_id });
}

function snapshotRecoveryList(value: unknown): Readonly<{ attemptId: string; limit: number }> {
  const row = readExactRecord(value, ["attemptId"], ["limit"]);
  const attemptId = safeAttempt(row.attemptId);
  return Object.freeze({ attemptId, limit: bounded(row.limit, 1, 128, 32) });
}

function snapshotResultPage(value: unknown): Readonly<{ attemptId: string; recovery_id: string; offset: number }> {
  const row = readExactRecord(value, ["attemptId", "recovery_id"], ["offset"]);
  const attemptId = safeAttempt(row.attemptId);
  if (!isRecoveryId(row.recovery_id)) invalid();
  return Object.freeze({ attemptId, recovery_id: row.recovery_id, offset: bounded(row.offset, 0, MAX_RESULTS, 0) });
}

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const row = readExactRecord(value, ["tenant_id", "subject"]);
  if (typeof row.tenant_id !== "string" || row.tenant_id.trim() === "" || row.tenant_id.length > 256 ||
      typeof row.subject !== "string" || row.subject.trim() === "" || row.subject.length > 512 ||
      /[\u0000-\u001f\u007f]/u.test(row.tenant_id) || /[\u0000-\u001f\u007f]/u.test(row.subject)) invalid();
  return Object.freeze({ tenant_id: row.tenant_id, subject: row.subject });
}

function snapshotLinkService(value: unknown): Pick<PerUserLinkService, "getStatus"> {
  if (!isExactService(value, PerUserLinkService, ["getStatus"])) invalid();
  return value;
}

function readExactRecord(value: unknown, requiredKeys: readonly string[], optionalKeys: readonly string[] = []): Record<string, unknown> {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) invalid();
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); } catch { invalid(); }
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const keys = Reflect.ownKeys(descriptors);
  if (requiredKeys.some((key) => !keys.includes(key)) ||
      keys.some((key) => typeof key !== "string" || (!requiredKeys.includes(key) && !optionalKeys.includes(key)))) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) invalid();
    result[key] = descriptor.value;
  }
  return result;
}

function readClockFactory(value: unknown): () => number {
  if (value === undefined) return Date.now;
  if (typeof value !== "function" || types.isProxy(value)) invalid();
  return value as () => number;
}

function bounded(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) invalid();
  return value as number;
}

function safeAttempt(value: unknown): string {
  if (typeof value !== "string" || !ATTEMPT_PATTERN.test(value)) invalid();
  return value;
}

function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function isRecoveryId(value: unknown): value is string { return typeof value === "string" && /^wan_t2v_recovery_[A-Za-z0-9-]{20,80}$/u.test(value); }
function sameStrings(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}
function denseStrings(value: unknown): string[] {
  if (!Array.isArray(value) || types.isProxy(value) || value.length > 32) fail("PREFLIGHT_FAILED");
  const result: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") fail("PREFLIGHT_FAILED");
    result.push(descriptor.value);
  }
  return result;
}
function validBalance(value: unknown): boolean { return typeof value === "string" && value.length <= 128 && /^[+-]?\d+(?:\.\d+)?$/u.test(value); }
function nullableFinite(value: unknown): boolean { return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0); }
function nonnegativeInteger(value: unknown): boolean { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function isFreshIso(value: unknown, now: number): boolean {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= MAX_CLOCK_SKEW_MS && new Date(timestamp).toISOString() === value;
}
function validSubscription(value: Record<string, unknown>, now: number): boolean {
  if (value.active !== true || !(value.plan_type === null || (typeof value.plan_type === "string" && value.plan_type.trim() !== ""))) return false;
  if (value.end_date === null) return value.end_date_kind === null;
  if (typeof value.end_date !== "string" || value.end_date_kind !== "OFFSET_DATETIME" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value.end_date)) return false;
  const expiry = Date.parse(value.end_date);
  return Number.isFinite(expiry) && expiry > now;
}

function snapshotDiagnostic(value: MutableDiagnostic): OwnerWanT2vGenerationDiagnostic { return Object.freeze({ ...value }); }
function unknownError(recovery: Recovery): OwnerWanT2vGenerationServiceError {
  return new OwnerWanT2vGenerationServiceError("OUTCOME_UNKNOWN", recovery.recovery_id, snapshotDiagnostic(recovery.diagnostic));
}
function serviceError(code: OwnerWanT2vGenerationServiceErrorCode): OwnerWanT2vGenerationServiceError {
  return new OwnerWanT2vGenerationServiceError(code);
}
function invalid(): never { throw serviceError("INVALID_REQUEST"); }
function fail(code: OwnerWanT2vGenerationServiceErrorCode): never { throw serviceError(code); }

function waitDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(serviceError("PRE_DISPATCH_FAILED")); return; }
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    const abort = () => { clearTimeout(timer); reject(serviceError("PRE_DISPATCH_FAILED")); };
    signal.addEventListener("abort", abort, { once: true });
  });
}
