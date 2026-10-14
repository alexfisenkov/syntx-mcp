import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import {
  SyntxChatHttpClient,
  OwnerSunoTrackOperationNativeError,
  isOwnerSunoTrackOperationChatContext,
  isOwnerSunoTrackOperationResultMessageContext,
  type MediaGenerationReceipt,
  type OwnerSunoTrackOperationChatContext,
  type OwnerSunoTrackOperationNativeGap,
  type OwnerSunoTrackOperationResultCandidates,
  type OwnerSunoTrackOperationResultMessageContext
} from "../adapter/syntx/chat-http-client.js";
import type { OwnerSunoAudioResult, OwnerSunoAudioResultGapCode, OwnerSunoReadyAudio } from "../adapter/syntx/owner-suno-audio-result.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { AccountStatusService, type AccountStatusResult } from "./account-status.js";
import { ModelAccessService, type ModelAccessResult } from "./model-access.js";
import {
  OWNER_SUNO_TRACK_OPERATION_MODEL_IDS,
  OWNER_SUNO_TRACK_OPERATION_PUBLIC_VERSION,
  OWNER_SUNO_TRACK_OPERATION_SETTINGS_VERSION,
  getOwnerSunoTrackOperationParameterSource,
  normalizeOwnerSunoTrackOperationParameters,
  OwnerSunoTrackOperationParametersError,
  type OwnerSunoTrackOperationModel,
  type OwnerSunoTrackOperationMode,
  type OwnerSunoTrackOperationParameterSource,
  type OwnerSunoTrackOperationRequest,
  type OwnerSunoNormalizedTrackOperationParameters
} from "./owner-suno-track-operation-parameters.js";
import {
  OwnerSunoTrackOperationRequestPreparer,
  OwnerSunoTrackOperationRequestPreparerError,
  type OwnerSunoTrackOperationPreparedCandidate
} from "./owner-suno-track-operation-request-preparer.js";
import {
  OwnerSunoTrackOperationOneShotPolicy,
  OwnerSunoTrackOperationOneShotPolicyError
} from "./owner-suno-track-operation-one-shot-policy.js";
import { OwnerSunoTrackContextStore } from "./owner-suno-track-context.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const RECOVERY_ID = /^suno_track_operation_recovery_[0-9a-f-]{36}$/u;
const MAX_RECOVERIES = 128;
const MAX_CLIENTS = 128;
const MAX_ACTIVE_RUNS = 4;
const MAX_RESULTS = 4_096;
const RESULT_PAGE_SIZE = 64;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_DELAY_MS = 250;
const DEFAULT_MAX_POLL_ATTEMPTS = 3;
const COUNTER_MAX = 255;
const SERVICE_GAPS: readonly OwnerSunoTrackOperationServiceGapCode[] = Object.freeze([
  "HISTORY_UNVERIFIED", "HISTORY_INCOMPLETE", "HISTORY_EMPTY", "BOT_ERROR_OBSERVED", "OWNER_ACK_MISSING", "OWNER_ACK_MISMATCH",
  "OWNER_ACK_AMBIGUOUS", "BOT_RESULT_NOT_OBSERVED", "AUDIO_OBJECT_IDS_INVALID", "AUDIO_MODEL_ECHO_MISMATCH",
  "ENVELOPE_SHAPE_INVALID", "OUTER_MESSAGE_ID_MISMATCH", "NOT_BOT_MESSAGE", "PROVIDER_CHAT_ID_MISMATCH",
  "UNRECOGNIZED_MESSAGE_FIELDS", "MESSAGE_OBJECT_ARRAY_INVALID", "MESSAGE_OBJECT_ARRAY_EMPTY", "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT",
  "UNRECOGNIZED_OBJECT_FIELDS", "OBJECT_ENTRY_INVALID", "OBJECT_ID_UNAVAILABLE", "OBJECT_ID_DUPLICATE", "OBJECT_ID_UNEXPECTED",
  "EXPECTED_OBJECT_ID_MISSING", "OBJECT_MESSAGE_ID_MISMATCH", "OBJECT_TYPE_UNSUPPORTED", "OBJECT_INCOMPLETE",
  "OBJECT_COMPLETION_UNKNOWN", "OBJECT_URL_MISSING", "OBJECT_URL_INVALID", "OBJECT_URL_UNSAFE", "MIME_TYPE_UNKNOWN",
  "MODEL_TYPE_UNAVAILABLE", "MODEL_TYPE_MISMATCH", "AUDIO_RESULT_UNVERIFIED", "RESULT_GET_UNAVAILABLE", "RESULT_LIMIT_EXCEEDED"
]);
const ACCOUNT_METHOD = AccountStatusService.prototype.getAccountStatus;
const ACCESS_METHOD = ModelAccessService.prototype.getModelAccess;
const CHAT_CREATE_METHOD_NAME = "createOwnerSunoTrackOperationChat";
const OPERATION_START_METHOD_NAME = "startSunoTrackOperationWithOwnedCandidate";
const HISTORY_METHOD_NAME = "listOwnedSunoTrackOperationCandidates";
const RESULT_METHOD_NAME = "getOwnedSunoTrackOperationResult";
const NATIVE_CLIENT = SyntxChatHttpClient.prototype as unknown as Record<string, unknown>;
const CHAT_CREATE = NATIVE_CLIENT[CHAT_CREATE_METHOD_NAME] as NativeClient["createOwnerSunoTrackOperationChat"] | undefined;
const OPERATION_START = NATIVE_CLIENT[OPERATION_START_METHOD_NAME] as NativeClient["startSunoTrackOperationWithOwnedCandidate"] | undefined;
const HISTORY_LIST = NATIVE_CLIENT[HISTORY_METHOD_NAME] as NativeClient["listOwnedSunoTrackOperationCandidates"] | undefined;
const AUDIO_RESULT = NATIVE_CLIENT[RESULT_METHOD_NAME] as NativeClient["getOwnedSunoTrackOperationResult"] | undefined;
const SERVICE_INSTANCES = new WeakSet<object>();

type NativeClient = SyntxChatHttpClient & {
  createOwnerSunoTrackOperationChat(input: unknown, signal?: AbortSignal): Promise<OwnerSunoTrackOperationChatContext>;
  startSunoTrackOperationWithOwnedCandidate(input: unknown, signal?: AbortSignal): Promise<MediaGenerationReceipt>;
  listOwnedSunoTrackOperationCandidates(chat: OwnerSunoTrackOperationChatContext, signal?: AbortSignal): Promise<OwnerSunoTrackOperationResultCandidates>;
  getOwnedSunoTrackOperationResult(context: OwnerSunoTrackOperationResultMessageContext, signal?: AbortSignal): Promise<OwnerSunoAudioResult>;
};

export type OwnerSunoTrackOperationServicePhase =
  | "VALIDATE_REQUEST" | "RESOLVE_PRINCIPAL" | "PREPARE_CANDIDATE" | "PREFLIGHT" | "CHAT_CREATE"
  | "GENERATION_POST" | "POST_ACK_KNOWN" | "HISTORY_GET" | "RESULT_GET" | "RESULT_BINDING";

export type OwnerSunoTrackOperationServiceGapCode = OwnerSunoTrackOperationNativeGap | OwnerSunoAudioResultGapCode |
  "BOT_ERROR_OBSERVED" | "AUDIO_RESULT_UNVERIFIED" | "RESULT_GET_UNAVAILABLE" | "RESULT_LIMIT_EXCEEDED";

export interface OwnerSunoTrackOperationDiagnostic {
  readonly phase: OwnerSunoTrackOperationServicePhase;
  readonly post_started: boolean;
  readonly ack_known: boolean;
  readonly history_status: "NOT_READ" | "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "NOT_READ" | "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  readonly history_get_calls: number;
  readonly result_get_calls: number;
  readonly result_status: "NOT_READ" | "PENDING" | "PARTIAL" | "COMPLETE" | "UNVERIFIED";
  readonly gaps: readonly OwnerSunoTrackOperationServiceGapCode[];
  readonly counters_saturated: boolean;
}

export interface OwnerSunoTrackOperationArtifact {
  readonly url: string;
  readonly mime_type: OwnerSunoReadyAudio["mime_type"];
  readonly mime_source: OwnerSunoReadyAudio["mime_source"];
  readonly object_type: "audio";
  readonly model_echo: "MATCHED" | "UNKNOWN";
}

export interface OwnerSunoTrackOperationResult {
  readonly status: "completed" | "partial_results";
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly backend_acceptance: "UNPROVEN";
  readonly provider_terminal_status: "UNPROVEN";
  readonly mode: OwnerSunoTrackOperationMode;
  readonly model_id: OwnerSunoTrackOperationModel;
  readonly source_binding: Readonly<{
    profile_id: OwnerSunoTrackOperationParameterSource["profile_id"];
    source_pins: OwnerSunoTrackOperationParameterSource["source_pins"];
  }>;
  readonly recovery_id: string;
  readonly observed_artifact_count: number;
  readonly offset: number;
  readonly page_size: 64;
  readonly artifacts: readonly OwnerSunoTrackOperationArtifact[];
  readonly has_more: boolean;
  readonly next_offset: number | null;
  readonly diagnostic: OwnerSunoTrackOperationDiagnostic;
}

export interface OwnerSunoTrackOperationRecoveryListItem {
  readonly recovery_id: string;
  readonly created_at: string;
  readonly mode: OwnerSunoTrackOperationMode;
  readonly model_id: OwnerSunoTrackOperationModel;
  readonly status: "outcome_unknown" | "partial_results" | "upstream_error_observed";
  readonly observed_artifact_count: number;
  readonly diagnostic: OwnerSunoTrackOperationDiagnostic;
}

export type OwnerSunoTrackOperationServiceErrorCode =
  | "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH"
  | "PREFLIGHT_FAILED" | "INTENT_ALREADY_CLAIMED" | "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN"
  | "UPSTREAM_OPERATION_ERROR" | "RECOVERY_NOT_FOUND";

export class OwnerSunoTrackOperationServiceError extends Error {
  readonly diagnostic?: OwnerSunoTrackOperationDiagnostic;
  constructor(readonly code: OwnerSunoTrackOperationServiceErrorCode, readonly recovery_id?: string,
    diagnostic?: OwnerSunoTrackOperationDiagnostic) {
    super(code === "OUTCOME_UNKNOWN"
      ? "The Suno track operation may have been dispatched; reconcile its private recovery and do not retry."
      : code === "UPSTREAM_OPERATION_ERROR"
        ? "A Suno error response was observed; reconcile its private recovery before taking further action."
        : "The owner Suno track operation could not be completed safely.");
    this.name = "OwnerSunoTrackOperationServiceError";
    if ((code === "OUTCOME_UNKNOWN" || code === "UPSTREAM_OPERATION_ERROR") && diagnostic) this.diagnostic = diagnostic;
  }
}

export interface OwnerSunoTrackOperationGenerationServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly createAccountStatusService: (attemptId: string) => AccountStatusService;
  readonly createModelAccessService: (attemptId: string) => ModelAccessService;
  readonly trackContextStore: OwnerSunoTrackContextStore;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly pollDelayMs?: number;
  readonly maxPollAttempts?: number;
}

export interface OwnerSunoTrackOperationGenerateInput {
  readonly attemptId: string;
  readonly request: OwnerSunoTrackOperationRequest;
}
export interface OwnerSunoTrackOperationReconcileInput { readonly attemptId: string; readonly recovery_id: string; }
export interface OwnerSunoTrackOperationRecoveryListInput { readonly attemptId: string; readonly limit?: number; }
export interface OwnerSunoTrackOperationResultPageInput { readonly attemptId: string; readonly recovery_id: string; readonly offset?: number; }

interface MutableDiagnostic {
  phase: OwnerSunoTrackOperationServicePhase;
  post_started: boolean;
  ack_known: boolean;
  history_status: OwnerSunoTrackOperationDiagnostic["history_status"];
  owner_ack_status: OwnerSunoTrackOperationDiagnostic["owner_ack_status"];
  history_get_calls: number;
  result_get_calls: number;
  result_status: OwnerSunoTrackOperationDiagnostic["result_status"];
  gaps: OwnerSunoTrackOperationServiceGapCode[];
  counters_saturated: boolean;
}
interface ObservedArtifact {
  readonly message_id: string;
  readonly message_object_id: string;
  readonly artifact: OwnerSunoTrackOperationArtifact;
}
interface Recovery {
  readonly recovery_id: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly source_profile: OwnerSunoTrackOperationParameterSource;
  readonly source_profile_schema_hash: string;
  readonly semantic_key: string;
  readonly created_at: string;
  readonly chat: OwnerSunoTrackOperationChatContext;
  readonly model_id: OwnerSunoTrackOperationModel;
  readonly mode: OwnerSunoTrackOperationMode;
  owner_echo_message_id: string | null;
  status: "outcome_unknown" | "upstream_error_observed" | "partial_results" | "completed";
  artifacts: readonly ObservedArtifact[];
  readonly resultContexts: Map<string, OwnerSunoTrackOperationResultMessageContext>;
  readonly diagnostic: MutableDiagnostic;
}
interface ActiveRun { readonly attemptId: string; readonly controller: AbortController; promise: Promise<unknown>; }

/** Cover/extend operations over handles already minted by the owner's generation chain. */
export class OwnerSunoTrackOperationGenerationService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #catalogVersion: string;
  readonly #resolveChatClient: OwnerSunoTrackOperationGenerationServiceOptions["resolveChatClient"];
  readonly #createAccountStatusService: OwnerSunoTrackOperationGenerationServiceOptions["createAccountStatusService"];
  readonly #createModelAccessService: OwnerSunoTrackOperationGenerationServiceOptions["createModelAccessService"];
  readonly #trackContextStore: OwnerSunoTrackContextStore;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #pollDelayMs: number;
  readonly #maxPollAttempts: number;
  readonly #preparer: OwnerSunoTrackOperationRequestPreparer;
  readonly #oneShotPolicy: OwnerSunoTrackOperationOneShotPolicy;
  readonly #recoveries = new Map<string, Recovery>();
  readonly #intentToRecovery = new Map<string, string>();
  readonly #reservedIntentKeys = new Set<string>();
  readonly #clientsByAttempt = new Map<string, SyntxChatHttpClient>();
  readonly #usedAccountServices = new WeakSet<object>();
  readonly #usedAccessServices = new WeakSet<object>();
  readonly #runs = new Set<ActiveRun>();
  readonly #invalidatingAttempts = new Set<string>();
  #closed = false;
  #closing: Promise<void> | undefined;
  #lastNow = -1;

  constructor(optionsInput: OwnerSunoTrackOperationGenerationServiceOptions | unknown) {
    const options = exactRecord(optionsInput, ["binding", "linkService", "catalog", "catalog_version", "resolveChatClient",
      "createAccountStatusService", "createModelAccessService", "trackContextStore"], ["now", "timeoutMs", "pollDelayMs", "maxPollAttempts"]);
    if (new.target !== OwnerSunoTrackOperationGenerationService || !isExactInstance(options.catalog, DiscoveryCatalogRepository) ||
        !isExactPerUserLinkService(options.linkService) || !isExactInstance(options.trackContextStore, OwnerSunoTrackContextStore) ||
        typeof options.resolveChatClient !== "function" || types.isProxy(options.resolveChatClient) ||
        typeof options.createAccountStatusService !== "function" || types.isProxy(options.createAccountStatusService) ||
        typeof options.createModelAccessService !== "function" || types.isProxy(options.createModelAccessService)) invalid();
    this.#binding = snapshotBinding(options.binding);
    this.#linkService = options.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#catalog = options.catalog;
    this.#catalogVersion = options.catalog_version as string;
    this.#resolveChatClient = options.resolveChatClient as OwnerSunoTrackOperationGenerationServiceOptions["resolveChatClient"];
    this.#createAccountStatusService = options.createAccountStatusService as OwnerSunoTrackOperationGenerationServiceOptions["createAccountStatusService"];
    this.#createModelAccessService = options.createModelAccessService as OwnerSunoTrackOperationGenerationServiceOptions["createModelAccessService"];
    this.#trackContextStore = options.trackContextStore;
    this.#now = readClockFactory(options.now);
    this.#timeoutMs = bounded(options.timeoutMs, 1_000, 5 * 60_000, DEFAULT_TIMEOUT_MS);
    this.#pollDelayMs = bounded(options.pollDelayMs, 0, 5_000, DEFAULT_POLL_DELAY_MS);
    this.#maxPollAttempts = bounded(options.maxPollAttempts, 1, 8, DEFAULT_MAX_POLL_ATTEMPTS);
    if (this.#catalogVersion !== OWNER_SUNO_TRACK_OPERATION_PUBLIC_VERSION) fail("MODEL_BINDING_MISMATCH");
    this.#assertSourceBinding();
    this.#preparer = new OwnerSunoTrackOperationRequestPreparer({ binding: this.#binding,
      linkService: this.#linkService as PerUserLinkService, trackContextStore: this.#trackContextStore, now: this.#now });
    this.#oneShotPolicy = new OwnerSunoTrackOperationOneShotPolicy({ preparer: this.#preparer, now: this.#now });
    SERVICE_INSTANCES.add(this);
    Object.freeze(this);
  }

  getTrackOperationParametersSource(): OwnerSunoTrackOperationParameterSource {
    this.#assertOpen();
    return this.#assertSourceBinding();
  }

  async generateTrackOperation(input: OwnerSunoTrackOperationGenerateInput | unknown,
    signal?: AbortSignal): Promise<OwnerSunoTrackOperationResult> {
    const request = snapshotGenerate(input);
    return await this.#run(request.attemptId, signal, (runSignal) => this.#generate(request, runSignal));
  }

  async reconcileTrackOperation(input: OwnerSunoTrackOperationReconcileInput | unknown,
    signal?: AbortSignal): Promise<OwnerSunoTrackOperationResult> {
    const request = snapshotReconcile(input);
    if (this.#invalidatingAttempts.has(request.attemptId)) {
      const recovery = this.#recoveries.get(request.recovery_id);
      if (recovery?.attemptId === request.attemptId && recovery.status === "outcome_unknown") throw unknownError(recovery);
      fail("RECOVERY_NOT_FOUND");
    }
    return await this.#run(request.attemptId, signal, (runSignal) => this.#reconcile(request, runSignal));
  }

  async listTrackOperationRecoveries(input: OwnerSunoTrackOperationRecoveryListInput | unknown): Promise<readonly OwnerSunoTrackOperationRecoveryListItem[]> {
    this.#assertOpen();
    const request = snapshotRecoveryList(input);
    return await this.#run(request.attemptId, undefined, async () => {
      const principal = await this.#resolvePrincipal(request.attemptId);
      if (this.#invalidatingAttempts.has(request.attemptId)) fail("PRINCIPAL_NOT_LINKED");
      return Object.freeze([...this.#recoveries.values()].filter((item) => item.attemptId === request.attemptId &&
        sameGenerationPrincipal(item.principal, principal) && item.status !== "completed")
        .sort((left, right) => left.created_at.localeCompare(right.created_at)).slice(0, request.limit)
        .map((item) => Object.freeze({ recovery_id: item.recovery_id, created_at: item.created_at, mode: item.mode,
          model_id: item.model_id, status: item.status as "outcome_unknown" | "partial_results" | "upstream_error_observed",
          observed_artifact_count: item.artifacts.length, diagnostic: snapshotDiagnostic(item.diagnostic) })));
    });
  }

  async getTrackOperationResultPage(input: OwnerSunoTrackOperationResultPageInput | unknown): Promise<OwnerSunoTrackOperationResult> {
    this.#assertOpen();
    const request = snapshotResultPage(input);
    return await this.#run(request.attemptId, undefined, async () => {
      const principal = await this.#resolvePrincipal(request.attemptId);
      const recovery = this.#recoveries.get(request.recovery_id);
      if (this.#invalidatingAttempts.has(request.attemptId) || !recovery || recovery.attemptId !== request.attemptId ||
          !sameGenerationPrincipal(recovery.principal, principal)) fail("RECOVERY_NOT_FOUND");
      this.#assertRecoverySourceBinding(recovery);
      if (recovery.status === "outcome_unknown") throw unknownError(recovery);
      return pageResult(recovery, request.offset);
    });
  }

  /** Parent owns shared-track invalidation and store lifetime; this engine only drains its own runs. */
  async invalidateAttempt(attemptIdInput: unknown): Promise<void> {
    const attemptId = readAttempt(attemptIdInput);
    this.#invalidatingAttempts.add(attemptId);
    this.#preparer.invalidateAttempt(attemptId);
    this.#oneShotPolicy.invalidateAttempt(attemptId);
    for (const run of this.#runs) if (run.attemptId === attemptId) run.controller.abort();
    const pending = [...this.#runs].filter((run) => run.attemptId === attemptId).map((run) => run.promise);
    await Promise.allSettled(pending);
    this.#clientsByAttempt.delete(attemptId);
    for (const recovery of this.#recoveries.values()) if (recovery.attemptId === attemptId) recovery.resultContexts.clear();
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    const attempts = new Set([...this.#runs].map((run) => run.attemptId));
    this.#closing = (async () => {
      await Promise.all([...attempts].map((attempt) => this.invalidateAttempt(attempt)));
      this.#oneShotPolicy.close();
      this.#preparer.close();
      for (const recovery of this.#recoveries.values()) recovery.resultContexts.clear();
      this.#clientsByAttempt.clear();
    })();
    return this.#closing;
  }

  async #generate(request: Readonly<OwnerSunoTrackOperationGenerateInput>, signal: AbortSignal): Promise<OwnerSunoTrackOperationResult> {
    const deadline = this.#deadline(signal);
    let semanticKey: string | undefined;
    let recovery: Recovery | undefined;
    let postStarted = false;
    try {
      deadline.throwIfAborted();
      const normalized = normalizeOwnerSunoTrackOperationParameters(request.request);
      const source = this.#assertSourceBinding();
      this.#validateModelBinding(normalized.model_id, source);
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      semanticKey = semanticIntentKey(principal, normalized, schemaHash(source), normalized.track_handle);
      const existingId = this.#intentToRecovery.get(semanticKey);
      if (existingId) {
        const existing = this.#recoveries.get(existingId);
        if (!existing || existing.attemptId !== request.attemptId || !sameGenerationPrincipal(existing.principal, principal)) fail("INTENT_ALREADY_CLAIMED");
        this.#assertRecoverySourceBinding(existing);
        if (existing.status === "outcome_unknown") throw unknownError(existing);
        if (existing.status === "upstream_error_observed") throw upstreamError(existing);
        return pageResult(existing, 0);
      }
      if (this.#reservedIntentKeys.has(semanticKey) || this.#recoveries.size + this.#reservedIntentKeys.size >= MAX_RECOVERIES) fail("SERVICE_BUSY");
      this.#reservedIntentKeys.add(semanticKey);
      const candidate = await this.#await(deadline, () => this.#preparer.prepare({ attemptId: request.attemptId,
        normalized: normalized as OwnerSunoNormalizedTrackOperationParameters }));
      const binding = this.#preparer.inspectCandidate(candidate);
      if (!binding || binding.attempt_id !== request.attemptId || !sameGenerationPrincipal(binding.principal, principal) ||
          binding.model_id !== normalized.model_id || binding.mode !== normalized.mode) fail("PRE_DISPATCH_FAILED");
      await this.#runPreflight(request.attemptId, normalized, deadline);
      const permit = this.#oneShotPolicy.createPermit({ candidate, attemptId: request.attemptId, principal });
      this.#oneShotPolicy.revalidate({ candidate, permit, attemptId: request.attemptId, principal });
      const client = this.#resolveNativeClient(request.attemptId);
      deadline.throwIfAborted();
      const chat = await this.#await(deadline, () => Reflect.apply(CHAT_CREATE! as Function, client, [Object.freeze({ candidate, permit,
        preparer: this.#preparer, oneShotPolicy: this.#oneShotPolicy, principal, attemptId: request.attemptId }), deadline.signal]) as Promise<OwnerSunoTrackOperationChatContext>);
      this.#assertChatBinding(chat, client, candidate, request.attemptId, principal);
      const principalAfterChat = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      if (!sameGenerationPrincipal(principal, principalAfterChat) || this.#invalidatingAttempts.has(request.attemptId)) fail("PRINCIPAL_NOT_LINKED");
      this.#validateModelBinding(normalized.model_id, this.#assertSourceBinding());
      await this.#runPreflight(request.attemptId, normalized, deadline);
      const principalBeforePost = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      if (!sameGenerationPrincipal(principal, principalBeforePost) || this.#invalidatingAttempts.has(request.attemptId)) fail("PRINCIPAL_NOT_LINKED");
      this.#preparer.revalidateCandidate({ candidate, attemptId: request.attemptId, principal });
      this.#oneShotPolicy.revalidate({ candidate, permit, attemptId: request.attemptId, principal });

      recovery = createRecovery({ attemptId: request.attemptId, principal, normalized, source, semanticKey, chat, now: this.#readNow() });
      this.#recoveries.set(recovery.recovery_id, recovery);
      this.#intentToRecovery.set(semanticKey, recovery.recovery_id);
      this.#reservedIntentKeys.delete(semanticKey); semanticKey = undefined;
      recovery.diagnostic.phase = "GENERATION_POST";
      recovery.diagnostic.post_started = true;
      postStarted = true;
      let receipt: MediaGenerationReceipt;
      try {
        receipt = await this.#await(deadline, () => Reflect.apply(OPERATION_START! as Function, client, [Object.freeze({ chat, candidate,
          permit, preparer: this.#preparer, oneShotPolicy: this.#oneShotPolicy, principal, attemptId: request.attemptId }), deadline.signal]) as Promise<MediaGenerationReceipt>);
      } catch (error) {
        if (isOperationNativeError(error, "OUTCOME_UNKNOWN")) throw unknownError(recovery);
        if (error instanceof OwnerSunoTrackOperationNativeError) {
          postStarted = false;
          this.#recoveries.delete(recovery.recovery_id);
          if (this.#intentToRecovery.get(recovery.semantic_key) === recovery.recovery_id) this.#intentToRecovery.delete(recovery.semantic_key);
        }
        throw error;
      }
      if (!validReceipt(receipt, chat.chat_uuid)) throw unknownError(recovery);
      recovery.owner_echo_message_id = receipt.message_id;
      recovery.diagnostic.ack_known = true;
      recovery.diagnostic.phase = "POST_ACK_KNOWN";
      return await this.#observe(recovery, client, deadline);
    } catch (error) {
      if (postStarted && recovery) {
        if (error instanceof OwnerSunoTrackOperationServiceError && error.code === "RECOVERY_NOT_FOUND") throw error;
        if (error instanceof OwnerSunoTrackOperationServiceError && error.code === "UPSTREAM_OPERATION_ERROR") throw error;
        if (recovery.status === "outcome_unknown") throw unknownError(recovery);
        if (recovery.status === "upstream_error_observed") throw upstreamError(recovery);
        return pageResult(recovery, 0);
      }
      if (semanticKey) this.#reservedIntentKeys.delete(semanticKey);
      if (error instanceof OwnerSunoTrackOperationServiceError) throw error;
      if (error instanceof OwnerSunoTrackOperationParametersError) invalid();
      if (error instanceof OwnerSunoTrackOperationNativeError) {
        fail(error.code === "REQUEST_ABORTED" ? "PRE_DISPATCH_FAILED" : "PRE_DISPATCH_FAILED");
      }
      if (error instanceof OwnerSunoTrackOperationRequestPreparerError) fail(mapPreparerCode(error.code));
      if (error instanceof OwnerSunoTrackOperationOneShotPolicyError) fail(mapOneShotCode(error.code));
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      return fail("PRE_DISPATCH_FAILED");
    } finally { if (semanticKey) this.#reservedIntentKeys.delete(semanticKey); deadline.close(); }
  }

  async #reconcile(request: Readonly<OwnerSunoTrackOperationReconcileInput>, signal: AbortSignal): Promise<OwnerSunoTrackOperationResult> {
    const recovery = this.#recoveries.get(request.recovery_id);
    if (!recovery || recovery.attemptId !== request.attemptId) fail("RECOVERY_NOT_FOUND");
    const deadline = this.#deadline(signal);
    try {
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      if (!sameGenerationPrincipal(principal, recovery.principal) || this.#invalidatingAttempts.has(request.attemptId)) throw unknownError(recovery);
      this.#assertRecoverySourceBinding(recovery);
      if (recovery.status === "completed") return pageResult(recovery, 0);
      const client = this.#resolveNativeClient(request.attemptId);
      return await this.#observe(recovery, client, deadline);
    } catch (error) {
      if (error instanceof OwnerSunoTrackOperationServiceError &&
          (error.code === "RECOVERY_NOT_FOUND" || error.code === "UPSTREAM_OPERATION_ERROR")) throw error;
      throw unknownError(recovery);
    } finally { deadline.close(); }
  }

  async #observe(recovery: Recovery, client: NativeClient, deadline: AbsoluteRequestDeadline): Promise<OwnerSunoTrackOperationResult> {
    let lastResult: OwnerSunoTrackOperationResult | undefined;
    for (let poll = 0; poll < this.#maxPollAttempts; poll += 1) {
      deadline.throwIfAborted();
      recovery.diagnostic.gaps = [];
      if (this.#invalidatingAttempts.has(recovery.attemptId)) throw unknownError(recovery);
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(recovery.attemptId));
      if (!sameGenerationPrincipal(principal, recovery.principal)) throw unknownError(recovery);
      recovery.diagnostic.phase = "HISTORY_GET";
      let history: OwnerSunoTrackOperationResultCandidates;
      try {
        history = await this.#await(deadline, () => Reflect.apply(HISTORY_LIST! as Function, client, [recovery.chat, deadline.signal]) as Promise<OwnerSunoTrackOperationResultCandidates>);
      } catch {
        deadline.throwIfAborted();
        incrementCounter(recovery.diagnostic, "history_get_calls", 1);
        recovery.diagnostic.history_status = "UNVERIFIED";
        recovery.diagnostic.result_status = "UNVERIFIED";
        addGaps(recovery.diagnostic, ["HISTORY_UNVERIFIED"]);
        throw unknownError(recovery);
      }
      incrementCounter(recovery.diagnostic, "history_get_calls", history.history_get_calls);
      recovery.diagnostic.owner_ack_status = history.owner_ack_status;
      const pageComplete = history.history_page_status === "COMPLETE";
      if (history.backend_acceptance !== "UNPROVEN" || history.owner_ack_status !== "MATCHED" ||
          history.history_binding_status !== "BOUND" || !pageComplete || !history.provider_chat_id ||
          !isSafeProviderChatId(history.provider_chat_id)) {
        recovery.diagnostic.history_status = history.status === "PENDING" ? "PENDING" :
          history.status === "INCOMPLETE" ? "INCOMPLETE" : "UNVERIFIED";
        recovery.diagnostic.result_status = "PENDING";
        addGaps(recovery.diagnostic, history.gaps);
        const safelyPollablePending = history.status === "PENDING" && history.owner_ack_status === "MATCHED" && pageComplete &&
          history.history_binding_status === "BOUND";
        if (!safelyPollablePending) throw unknownError(recovery);
        if (poll + 1 < this.#maxPollAttempts) await delay(this.#pollDelayMs, deadline.signal);
        continue;
      }
      recovery.owner_echo_message_id = history.owner_echo_message_id;
      recovery.diagnostic.ack_known = true;
      recovery.diagnostic.history_status = history.status;
      recovery.diagnostic.phase = "RESULT_GET";
      if (isObservedErrorOnlyHistory(history) && recovery.artifacts.length === 0) {
        recovery.status = "upstream_error_observed";
        recovery.diagnostic.phase = "RESULT_BINDING";
        recovery.diagnostic.result_status = "UNVERIFIED";
        addGaps(recovery.diagnostic, history.gaps);
        throw upstreamError(recovery);
      }
      if (history.status === "PENDING" && history.contexts.length === 0) {
        recovery.diagnostic.result_status = "PENDING";
        addGaps(recovery.diagnostic, history.gaps);
        if (poll + 1 < this.#maxPollAttempts) await delay(this.#pollDelayMs, deadline.signal);
        continue;
      }
      if (history.status !== "COMPLETE" || history.contexts.length === 0) {
        recovery.diagnostic.result_status = "UNVERIFIED";
        addGaps(recovery.diagnostic, history.gaps.length ? history.gaps : ["BOT_RESULT_NOT_OBSERVED"]);
        throw unknownError(recovery);
      }
      const artifactsById = new Map<string, ObservedArtifact>();
      const urlsToId = new Map<string, string>();
      let incomplete = history.gaps.length > 0;
      addGaps(recovery.diagnostic, history.gaps);
      for (const context of history.contexts) {
        deadline.throwIfAborted();
        if (!isOwnerSunoTrackOperationResultMessageContext(context, client) || !this.#contextMatches(recovery, context)) {
          incomplete = true; addGaps(recovery.diagnostic, ["AUDIO_RESULT_UNVERIFIED"]); continue;
        }
        recovery.resultContexts.set(context.message_id, context);
        let result: OwnerSunoAudioResult;
        try {
          result = await this.#await(deadline, () => Reflect.apply(AUDIO_RESULT! as Function, client, [context, deadline.signal]) as Promise<OwnerSunoAudioResult>);
        } catch {
          deadline.throwIfAborted();
          incrementCounter(recovery.diagnostic, "result_get_calls", 1);
          incomplete = true; addGaps(recovery.diagnostic, ["RESULT_GET_UNAVAILABLE"]); continue;
        }
        incrementCounter(recovery.diagnostic, "result_get_calls", 1);
        if (result.backend_acceptance !== "UNPROVEN" || result.message_binding !== "BOUND" || result.model_echo === "MISMATCH") {
          incomplete = true; addGaps(recovery.diagnostic, ["AUDIO_RESULT_UNVERIFIED", ...result.gaps.map((gap) => gap.code)]); continue;
        }
        if (result.gaps.length > 0) incomplete = true;
        addGaps(recovery.diagnostic, result.gaps.map((gap) => gap.code));
        for (const ready of result.ready_audio) {
          if (!isSafeAudioResult(ready) || !context.message_object_ids.includes(ready.message_object_id)) {
            incomplete = true; addGaps(recovery.diagnostic, ["AUDIO_RESULT_UNVERIFIED"]); continue;
          }
          const artifact: OwnerSunoTrackOperationArtifact = Object.freeze({ url: ready.object_url,
            mime_type: ready.mime_type, mime_source: ready.mime_source, object_type: "audio",
            model_echo: result.model_echo === "MATCHED" ? "MATCHED" : "UNKNOWN" });
          const previous = artifactsById.get(ready.message_object_id);
          if (previous) {
            if (!isDeepStrictEqual(previous.artifact, artifact)) { incomplete = true; addGaps(recovery.diagnostic, ["AUDIO_RESULT_UNVERIFIED"]); }
            continue;
          }
          const priorIdForUrl = urlsToId.get(artifact.url);
          if (priorIdForUrl && priorIdForUrl !== ready.message_object_id) {
            incomplete = true; addGaps(recovery.diagnostic, ["AUDIO_RESULT_UNVERIFIED"]); continue;
          }
          artifactsById.set(ready.message_object_id, Object.freeze({ message_id: context.message_id,
            message_object_id: ready.message_object_id, artifact }));
          urlsToId.set(artifact.url, ready.message_object_id);
          if (artifactsById.size > MAX_RESULTS) {
            recovery.diagnostic.result_status = "PARTIAL";
            addGaps(recovery.diagnostic, ["RESULT_LIMIT_EXCEEDED"]);
            throw unknownError(recovery);
          }
        }
      }
      recovery.artifacts = Object.freeze([...artifactsById.values()]);
      recovery.status = incomplete ? "partial_results" : "completed";
      recovery.diagnostic.phase = "RESULT_BINDING";
      recovery.diagnostic.result_status = recovery.status === "completed" ? "COMPLETE" : "PARTIAL";
      lastResult = pageResult(recovery, 0);
      if (!incomplete) return lastResult;
      if (poll + 1 < this.#maxPollAttempts) await delay(this.#pollDelayMs, deadline.signal);
    }
    if (recovery.artifacts.length === 0) {
      recovery.status = "outcome_unknown";
      throw unknownError(recovery);
    }
    return lastResult ?? pageResult(recovery, 0);
  }

  #contextMatches(recovery: Recovery, context: OwnerSunoTrackOperationResultMessageContext): boolean {
    return context.chat_uuid === recovery.chat.chat_uuid && context.attempt_id === recovery.attemptId &&
      sameGenerationPrincipal(context.principal, recovery.principal) && context.model_id === recovery.model_id &&
      context.mode === recovery.mode && context.owner_echo_message_id === recovery.owner_echo_message_id &&
      context.intent_fingerprint === recovery.chat.intent_fingerprint &&
      context.source_profile_schema_hash === recovery.chat.source_profile_schema_hash &&
      isDeepStrictEqual(context.source_pins, recovery.chat.source_pins) &&
      context.track_context_fingerprint === recovery.chat.track_context_fingerprint;
  }

  async #runPreflight(attemptId: string, normalized: OwnerSunoNormalizedTrackOperationParameters,
    deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted();
    let accountService: AccountStatusService; let accessService: ModelAccessService;
    try {
      accountService = Reflect.apply(this.#createAccountStatusService, undefined, [attemptId]) as AccountStatusService;
      accessService = Reflect.apply(this.#createModelAccessService, undefined, [attemptId]) as ModelAccessService;
    } catch { fail("PREFLIGHT_FAILED"); }
    if (!isExactService(accountService, AccountStatusService, ["getAccountStatus"]) || this.#usedAccountServices.has(accountService) ||
        !isExactService(accessService, ModelAccessService, ["getModelAccess"]) || this.#usedAccessServices.has(accessService)) fail("PREFLIGHT_FAILED");
    this.#usedAccountServices.add(accountService); this.#usedAccessServices.add(accessService);
    let account: AccountStatusResult; let access: ModelAccessResult;
    try {
      account = await this.#await(deadline, () => Reflect.apply(ACCOUNT_METHOD, accountService, [deadline.signal]) as Promise<AccountStatusResult>);
      access = await this.#await(deadline, () => Reflect.apply(ACCESS_METHOD, accessService, [Object.freeze({
        model_id: normalized.model_id, cost_parameters: Object.freeze({})
      }), deadline.signal]) as Promise<ModelAccessResult>);
    } catch { fail("PREFLIGHT_FAILED"); }
    assertFreshPreflight(account, access, normalized, this.#catalog, this.#readNow());
  }

  #assertSourceBinding(): OwnerSunoTrackOperationParameterSource {
    let source: OwnerSunoTrackOperationParameterSource;
    try { source = getOwnerSunoTrackOperationParameterSource() as OwnerSunoTrackOperationParameterSource; }
    catch { fail("MODEL_BINDING_MISMATCH"); }
    if (this.#catalogVersion !== OWNER_SUNO_TRACK_OPERATION_PUBLIC_VERSION ||
        source.source_pins.public_catalog_version !== OWNER_SUNO_TRACK_OPERATION_PUBLIC_VERSION ||
        source.source_pins.settings_inventory_version !== OWNER_SUNO_TRACK_OPERATION_SETTINGS_VERSION ||
        source.runtime_usable !== false || source.dispatch_allowed !== false || source.backend_acceptance !== "UNPROVEN" ||
        !sameArray(source.model_ids, OWNER_SUNO_TRACK_OPERATION_MODEL_IDS)) fail("MODEL_BINDING_MISMATCH");
    return source;
  }

  #validateModelBinding(modelId: OwnerSunoTrackOperationModel, source: OwnerSunoTrackOperationParameterSource): void {
    if (!(OWNER_SUNO_TRACK_OPERATION_MODEL_IDS as readonly string[]).includes(modelId) || !source.models[modelId]) fail("MODEL_BINDING_MISMATCH");
    let model;
    try { model = this.#catalog.getModel(modelId); } catch { fail("MODEL_BINDING_MISMATCH"); }
    if (!model.active || model.id !== modelId || model.upstream_id !== modelId || model.ai_name !== "suno") fail("MODEL_BINDING_MISMATCH");
  }

  #assertChatBinding(chat: OwnerSunoTrackOperationChatContext, client: NativeClient,
    candidate: OwnerSunoTrackOperationPreparedCandidate, attemptId: string, principal: Readonly<GenerationPrincipalRef>): void {
    const binding = this.#preparer.inspectCandidate(candidate);
    if (!isOwnerSunoTrackOperationChatContext(chat, client) || chat.status !== "created" || chat.attempt_id !== attemptId ||
        chat.model_id !== candidate.model_id || chat.mode !== candidate.mode || chat.intent_fingerprint !== candidate.intent_fingerprint ||
        chat.source_profile_schema_hash !== candidate.source_profile_schema_hash || !isDeepStrictEqual(chat.source_pins, candidate.source_pins) ||
        !binding || chat.track_context_fingerprint !== binding.track_context_fingerprint || !sameGenerationPrincipal(chat.principal, principal) ||
        chat.dispatch_allowed !== false || chat.backend_acceptance !== "UNPROVEN") fail("PRE_DISPATCH_FAILED");
  }

  #resolveNativeClient(attemptId: string): NativeClient {
    const existing = this.#clientsByAttempt.get(attemptId);
    if (existing) return existing as NativeClient;
    if (this.#clientsByAttempt.size >= MAX_CLIENTS) fail("SERVICE_BUSY");
    let client: unknown;
    try { client = Reflect.apply(this.#resolveChatClient, undefined, [attemptId]); } catch { fail("PRE_DISPATCH_FAILED"); }
    if (!isNativeClient(client)) fail("PRE_DISPATCH_FAILED");
    this.#clientsByAttempt.set(attemptId, client);
    return client;
  }

  async #resolvePrincipal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    try {
      const principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
      if (principal.connection_id !== attemptId || principal.tenant_id !== this.#binding.tenant_id ||
          principal.subject_id !== this.#binding.subject) fail("PRINCIPAL_NOT_LINKED");
      return principal;
    } catch { fail("PRINCIPAL_NOT_LINKED"); }
  }

  #deadline(signal: AbortSignal): AbsoluteRequestDeadline {
    this.#assertOpen();
    return new AbsoluteRequestDeadline(this.#timeoutMs, signal, () => serviceError("PRE_DISPATCH_FAILED"));
  }
  async #await<T>(deadline: AbsoluteRequestDeadline, operation: () => Promise<T>): Promise<T> {
    deadline.throwIfAborted();
    try { return await deadline.waitFor(operation()); } catch (error) { deadline.throwIfAborted(); throw error; }
  }
  async #run<T>(attemptId: string, parent: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.#assertOpen();
    if (this.#invalidatingAttempts.has(attemptId)) fail("PRINCIPAL_NOT_LINKED");
    if (this.#runs.size >= MAX_ACTIVE_RUNS) fail("SERVICE_BUSY");
    if (parent !== undefined && (types.isProxy(parent) || !(parent instanceof AbortSignal))) invalid();
    const controller = new AbortController();
    const abortParent = () => controller.abort(parent?.reason);
    if (parent?.aborted) abortParent(); else parent?.addEventListener("abort", abortParent, { once: true });
    const run: ActiveRun = { attemptId, controller, promise: Promise.resolve() };
    const promise = operation(controller.signal); run.promise = promise; this.#runs.add(run);
    try { return await promise; }
    finally { parent?.removeEventListener("abort", abortParent); this.#runs.delete(run); }
  }
  #readNow(): number {
    let value: unknown;
    try { value = this.#now(); } catch { fail("SERVICE_BUSY"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) < this.#lastNow) fail("SERVICE_BUSY");
    this.#lastNow = value as number;
    return this.#lastNow;
  }
  #assertOpen(): void { if (this.#closed || !SERVICE_INSTANCES.has(this)) fail("SERVICE_CLOSED"); }
  #assertRecoverySourceBinding(recovery: Recovery): void {
    const source = this.#assertSourceBinding();
    if (schemaHash(source) !== recovery.source_profile_schema_hash ||
        !isDeepStrictEqual(source.source_pins, recovery.chat.source_pins)) fail("RECOVERY_NOT_FOUND");
  }
}

export function isOwnerSunoTrackOperationGenerationService(value: unknown): value is OwnerSunoTrackOperationGenerationService {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && SERVICE_INSTANCES.has(value) &&
    Object.getPrototypeOf(value) === OwnerSunoTrackOperationGenerationService.prototype && Reflect.ownKeys(value).length === 0 && Object.isFrozen(value); }
  catch { return false; }
}

function createRecovery(input: { attemptId: string; principal: Readonly<GenerationPrincipalRef>;
  normalized: OwnerSunoNormalizedTrackOperationParameters; source: OwnerSunoTrackOperationParameterSource; semanticKey: string;
  chat: OwnerSunoTrackOperationChatContext; now: number }): Recovery {
  if (!Number.isSafeInteger(input.now) || input.now > 8_640_000_000_000_000) fail("SERVICE_BUSY");
  const recovery_id = `suno_track_operation_recovery_${randomUUID()}`;
  const diagnostic: MutableDiagnostic = { phase: "CHAT_CREATE", post_started: false, ack_known: false,
    history_status: "NOT_READ", owner_ack_status: "NOT_READ", history_get_calls: 0, result_get_calls: 0,
    result_status: "NOT_READ", gaps: [], counters_saturated: false };
  return { recovery_id, attemptId: input.attemptId, principal: input.principal,
    source_profile: input.source, source_profile_schema_hash: schemaHash(input.source), semantic_key: input.semanticKey,
    created_at: new Date(input.now).toISOString(), chat: input.chat,
    model_id: input.normalized.model_id, mode: input.normalized.mode, owner_echo_message_id: null, status: "outcome_unknown",
    artifacts: Object.freeze([]), resultContexts: new Map(), diagnostic };
}

function pageResult(recovery: Recovery, offset: number): OwnerSunoTrackOperationResult {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_RESULTS) invalid();
  if (recovery.status === "outcome_unknown") throw unknownError(recovery);
  if (recovery.status === "upstream_error_observed") throw upstreamError(recovery);
  const page = recovery.artifacts.slice(offset, offset + RESULT_PAGE_SIZE);
  const next = offset + page.length;
  return Object.freeze({ status: recovery.status, status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY",
    backend_acceptance: "UNPROVEN", provider_terminal_status: "UNPROVEN", mode: recovery.mode, model_id: recovery.model_id,
    source_binding: Object.freeze({ profile_id: recovery.source_profile.profile_id, source_pins: recovery.source_profile.source_pins }),
    recovery_id: recovery.recovery_id, observed_artifact_count: recovery.artifacts.length, offset, page_size: RESULT_PAGE_SIZE,
    artifacts: Object.freeze(page.map((item) => item.artifact)), has_more: next < recovery.artifacts.length,
    next_offset: next < recovery.artifacts.length ? next : null, diagnostic: snapshotDiagnostic(recovery.diagnostic) });
}

function snapshotDiagnostic(input: MutableDiagnostic): OwnerSunoTrackOperationDiagnostic {
  return Object.freeze({ phase: input.phase, post_started: input.post_started, ack_known: input.ack_known,
    history_status: input.history_status, owner_ack_status: input.owner_ack_status,
    history_get_calls: input.history_get_calls, result_get_calls: input.result_get_calls,
    result_status: input.result_status, gaps: Object.freeze(input.gaps.slice(0, 128)), counters_saturated: input.counters_saturated });
}
function unknownError(recovery: Recovery): OwnerSunoTrackOperationServiceError {
  return serviceError("OUTCOME_UNKNOWN", recovery.recovery_id, snapshotDiagnostic(recovery.diagnostic));
}
function upstreamError(recovery: Recovery): OwnerSunoTrackOperationServiceError {
  return serviceError("UPSTREAM_OPERATION_ERROR", recovery.recovery_id, snapshotDiagnostic(recovery.diagnostic));
}
function serviceError(code: OwnerSunoTrackOperationServiceErrorCode, recoveryId?: string,
  diagnostic?: OwnerSunoTrackOperationDiagnostic): OwnerSunoTrackOperationServiceError {
  return new OwnerSunoTrackOperationServiceError(code, recoveryId, diagnostic);
}
function fail(code: OwnerSunoTrackOperationServiceErrorCode): never { throw serviceError(code); }
function invalid(): never { return fail("INVALID_REQUEST"); }

function snapshotGenerate(value: unknown): Readonly<OwnerSunoTrackOperationGenerateInput> {
  const fields = exactRecord(value, ["attemptId", "request"]);
  const attemptId = readAttempt(fields.attemptId);
  try {
    const normalized = normalizeOwnerSunoTrackOperationParameters(fields.request);
    const settings = normalized.settings_candidate;
    return Object.freeze({ attemptId, request: Object.freeze({ model_id: normalized.model_id, mode: normalized.mode,
      track_handle: normalized.track_handle, prompt: normalized.prompt, is_custom_mode: settings.is_custom_mode,
      is_instrumental: settings.is_instrumental, negative_tags: settings.negative_tags, styles: settings.styles,
      title: settings.title, ...(settings.mode === "extend" ? { continue_at: settings.continue_at } : {}) }) as OwnerSunoTrackOperationRequest });
  } catch { invalid(); }
}
function snapshotReconcile(value: unknown): Readonly<OwnerSunoTrackOperationReconcileInput> {
  const fields = exactRecord(value, ["attemptId", "recovery_id"]);
  const attemptId = readAttempt(fields.attemptId);
  if (typeof fields.recovery_id !== "string" || !RECOVERY_ID.test(fields.recovery_id)) invalid();
  return Object.freeze({ attemptId, recovery_id: fields.recovery_id });
}
function snapshotRecoveryList(value: unknown): Readonly<Required<OwnerSunoTrackOperationRecoveryListInput>> {
  const fields = exactRecord(value, ["attemptId"], ["limit"]);
  const attemptId = readAttempt(fields.attemptId);
  const limit = fields.limit === undefined ? 64 : bounded(fields.limit, 1, 128, 64);
  return Object.freeze({ attemptId, limit });
}
function snapshotResultPage(value: unknown): Readonly<Required<OwnerSunoTrackOperationResultPageInput>> {
  const fields = exactRecord(value, ["attemptId", "recovery_id"], ["offset"]);
  const attemptId = readAttempt(fields.attemptId);
  if (typeof fields.recovery_id !== "string" || !RECOVERY_ID.test(fields.recovery_id)) invalid();
  const offset = fields.offset === undefined ? 0 : bounded(fields.offset, 0, MAX_RESULTS, 0);
  return Object.freeze({ attemptId, recovery_id: fields.recovery_id, offset });
}
function readAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) invalid(); return value; }
function semanticIntentKey(principal: Readonly<GenerationPrincipalRef>, normalized: OwnerSunoNormalizedTrackOperationParameters,
  profileHash: string, trackHandle: string): string {
  const settings = normalized.settings_candidate;
  return createHash("sha256").update(JSON.stringify(["owner-suno-track-operation-intent-v1",
    [principal.tenant_id, principal.subject_id], profileHash, trackHandle, normalized.model_id, normalized.mode,
    normalized.prompt, settings.is_custom_mode, settings.is_instrumental, settings.negative_tags, settings.styles,
    settings.title, settings.mode === "extend" ? settings.continue_at : null]), "utf8").digest("hex");
}
function assertFreshPreflight(accountInput: unknown, accessInput: unknown, normalized: OwnerSunoNormalizedTrackOperationParameters,
  catalog: DiscoveryCatalogRepository, now: number): void {
  try {
    const account = exactRecord(accountInput, ["balance", "subscription", "contract_evidence", "source_build", "observed_at"]);
    const balance = exactRecord(account.balance, ["unit", "available"]);
    const subscription = exactRecord(account.subscription, ["active", "plan_type", "end_date", "end_date_kind"]);
    const access = exactRecord(accessInput, ["catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live",
      "parameter_keys", "parameters_redacted", "access", "cost", "discount_cost", "free_remaining_generations", "limit", "show_warning", "observed_at"]);
    const expectedVersion = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
    const keys = denseStrings(access.parameter_keys);
    if (account.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || account.source_build !== ACCOUNT_SOURCE_BUILD || balance.unit !== "tokens" ||
        !(balance.available === null || validBalance(balance.available)) || !validSubscription(subscription, now) || !isFreshIso(account.observed_at, now) ||
        access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || access.catalog_version !== expectedVersion ||
        access.model_id !== normalized.model_id || access.ai_name !== "suno" || access.model_type !== normalized.model_id ||
        access.account_read_live !== true || access.access !== true || access.parameters_redacted !== true || keys.length !== 0 ||
        typeof access.cost !== "number" || !Number.isFinite(access.cost) || !nullableFinite(access.discount_cost) ||
        !(access.free_remaining_generations === null || nonnegativeInteger(access.free_remaining_generations)) ||
        !nullableFinite(access.limit) || !(access.show_warning === null || typeof access.show_warning === "boolean") || !isFreshIso(access.observed_at, now)) fail("PREFLIGHT_FAILED");
  } catch (error) { if (error instanceof OwnerSunoTrackOperationServiceError) throw error; fail("PREFLIGHT_FAILED"); }
}
function validSubscription(value: Record<string, unknown>, now: number): boolean {
  if (!(value.active === null || typeof value.active === "boolean") || !(value.plan_type === null || typeof value.plan_type === "string") ||
      !(value.end_date === null || typeof value.end_date === "string") ||
      !(value.end_date_kind === null || ["DATE_ONLY", "LOCAL_DATETIME", "OFFSET_DATETIME"].includes(String(value.end_date_kind)))) return false;
  if (value.active !== true) return false;
  if (value.end_date === null) return true;
  const time = Date.parse(`${value.end_date_kind === "DATE_ONLY" ? `${value.end_date}T23:59:59.999Z` : value.end_date}`);
  return Number.isFinite(time) && time >= now;
}
function isFreshIso(value: unknown, now: number): boolean {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= now + 30_000 && time >= now - 5 * 60_000;
}
function validBalance(value: unknown): boolean { return typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value); }
function nullableFinite(value: unknown): boolean { return value === null || (typeof value === "number" && Number.isFinite(value)); }
function nonnegativeInteger(value: unknown): boolean { return Number.isSafeInteger(value) && (value as number) >= 0; }
function denseStrings(value: unknown): string[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 16) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) invalid();
  return Array.from({ length: value.length }, (_, index) => {
    const item = descriptors[String(index)];
    if (!item || !("value" in item) || typeof item.value !== "string") invalid();
    return item.value;
  }).sort();
}
function incrementCounter(diagnostic: MutableDiagnostic, key: "history_get_calls" | "result_get_calls", amount: number): void {
  if (!Number.isSafeInteger(amount) || amount < 0) { diagnostic.counters_saturated = true; diagnostic[key] = COUNTER_MAX; return; }
  const room = COUNTER_MAX - diagnostic[key];
  if (amount > room) diagnostic.counters_saturated = true;
  diagnostic[key] = Math.min(COUNTER_MAX, diagnostic[key] + amount);
}
function addGaps(diagnostic: MutableDiagnostic, values: readonly string[]): void {
  for (const value of values) {
    const safe = (SERVICE_GAPS as readonly string[]).includes(value) ? value as OwnerSunoTrackOperationServiceGapCode : "AUDIO_RESULT_UNVERIFIED";
    if (!diagnostic.gaps.includes(safe) && diagnostic.gaps.length < 128) diagnostic.gaps.push(safe);
  }
}
function validReceipt(value: unknown, chatUuid: string): value is MediaGenerationReceipt {
  try { const fields = exactRecord(value, ["chat_uuid", "message_id"]); return fields.chat_uuid === chatUuid && isSafeId(fields.message_id); }
  catch { return false; }
}
function isObservedErrorOnlyHistory(history: OwnerSunoTrackOperationResultCandidates): boolean {
  return history.status === "INCOMPLETE" && history.owner_ack_status === "MATCHED" &&
    history.history_binding_status === "BOUND" && history.history_page_status === "COMPLETE" &&
    history.backend_acceptance === "UNPROVEN" && isSafeProviderChatId(history.provider_chat_id) &&
    typeof history.owner_echo_message_id === "string" && SAFE_ID.test(history.owner_echo_message_id) &&
    history.contexts.length === 0 && history.gaps.includes("BOT_ERROR_OBSERVED");
}
function isSafeAudioResult(value: OwnerSunoReadyAudio): boolean {
  if (!value || typeof value !== "object" || types.isProxy(value) || value.object_type !== "audio" ||
      typeof value.object_url !== "string" || value.object_url.length === 0 || value.object_url.length > 4_096 ||
      (value.mime_type !== null && !["audio/mpeg", "audio/wav", "audio/mp4"].includes(value.mime_type)) ||
      !["URL_EXTENSION_LOCAL_POLICY", "UNKNOWN"].includes(value.mime_source)) return false;
  try {
    const url = new URL(value.object_url);
    return url.protocol === "https:" && url.hostname === "r2.syntx.ai" && url.port.length === 0 &&
      url.username.length === 0 && url.password.length === 0 && url.hash.length === 0;
  } catch { return false; }
}
function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function isSafeProviderChatId(value: unknown): boolean { return typeof value === "string" && /^\d{1,16}$/u.test(value); }
function sameArray(left: readonly unknown[], right: readonly unknown[]): boolean { return left.length === right.length && left.every((item, i) => item === right[i]); }
function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds <= 0) { if (signal.aborted) return Promise.reject(new Error("aborted")); return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new Error("aborted")); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) invalid();
  let prototype: object | null; let descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); } catch { invalid(); }
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || (!required.includes(key) && !optional.includes(key)) ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true) invalid();
    result[key] = descriptors[key]!.value;
  }
  if (required.some((key) => !Object.hasOwn(result, key))) invalid();
  return result;
}
function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || !fields.tenant_id.trim() || fields.tenant_id.length > 256 ||
      typeof fields.subject !== "string" || !fields.subject.trim() || fields.subject.length > 512 ||
      /[\u0000-\u001f\u007f]/u.test(fields.tenant_id) || /[\u0000-\u001f\u007f]/u.test(fields.subject)) invalid();
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}
function isNativeClient(value: unknown): value is NativeClient {
  try {
    if (!isExactInstance(value, SyntxChatHttpClient)) return false;
    return getDataMethod(value, CHAT_CREATE_METHOD_NAME) === CHAT_CREATE &&
      getDataMethod(value, OPERATION_START_METHOD_NAME) === OPERATION_START &&
      getDataMethod(value, HISTORY_METHOD_NAME) === HISTORY_LIST && getDataMethod(value, RESULT_METHOD_NAME) === AUDIO_RESULT &&
      typeof CHAT_CREATE === "function" && typeof OPERATION_START === "function" && typeof HISTORY_LIST === "function" && typeof AUDIO_RESULT === "function";
  } catch { return false; }
}
function isExactPerUserLinkService(value: unknown): value is PerUserLinkService {
  return isExactService(value, PerUserLinkService, ["getStatus"]);
}
function isExactService<T extends object>(value: unknown, constructor: new (...args: never[]) => T, methods: readonly string[]): value is T {
  if (!isExactInstance(value, constructor)) return false;
  return methods.every((method) => typeof Reflect.get(constructor.prototype, method) === "function" &&
    !Object.hasOwn(value, method) && Reflect.get(value, method) === Reflect.get(constructor.prototype, method));
}
function isExactInstance<T extends object>(value: unknown, constructor: new (...args: never[]) => T): value is T {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && value instanceof constructor && Object.getPrototypeOf(value) === constructor.prototype; }
  catch { return false; }
}
function getDataMethod(value: object, key: string): unknown {
  let current: object | null = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}
function mapPreparerCode(code: string): OwnerSunoTrackOperationServiceErrorCode {
  if (code === "PRINCIPAL_NOT_LINKED" || code === "PRINCIPAL_MISMATCH") return "PRINCIPAL_NOT_LINKED";
  if (code === "SOURCE_EVIDENCE_UNAVAILABLE" || code === "SOURCE_EVIDENCE_CHANGED") return "MODEL_BINDING_MISMATCH";
  if (code === "SERVICE_CLOSED") return "SERVICE_CLOSED";
  if (code === "CAPACITY_EXCEEDED") return "SERVICE_BUSY";
  if (code === "INVALID_REQUEST" || code === "NORMALIZED_CANDIDATE_INVALID" || code === "TRACK_CONTEXT_EXPIRED" ||
      code === "TRACK_MODEL_MISMATCH" || code === "TRACK_CONTEXT_UNAVAILABLE") return "INVALID_REQUEST";
  return "PRE_DISPATCH_FAILED";
}
function mapOneShotCode(code: string): OwnerSunoTrackOperationServiceErrorCode {
  if (code === "PRINCIPAL_MISMATCH" || code === "ATTEMPT_INVALIDATED") return "PRINCIPAL_NOT_LINKED";
  if (code === "INTENT_ALREADY_CLAIMED") return "INTENT_ALREADY_CLAIMED";
  if (code === "CAPACITY_EXCEEDED") return "SERVICE_BUSY";
  if (code === "POLICY_CLOSED") return "SERVICE_CLOSED";
  if (code === "CANDIDATE_EXPIRED" || code === "CANDIDATE_UNBOUND" || code === "TRACK_CONTEXT_EXPIRED" ||
      code === "TRACK_CONTEXT_UNAVAILABLE") return "INVALID_REQUEST";
  return "PRE_DISPATCH_FAILED";
}
function isOperationNativeError(error: unknown, code: string): boolean {
  return error instanceof OwnerSunoTrackOperationNativeError && error.code === code;
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
