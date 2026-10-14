import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import { isDeepStrictEqual } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import {
  SyntxChatHttpClient,
  OwnerSunoGenerationNativeError,
  isOwnerSunoGenerationChatContext,
  isOwnerSunoGenerationResultMessageContext,
  type MediaGenerationReceipt,
  type OwnerSunoGenerationChatContext,
  type OwnerSunoGenerationNativeGap,
  type OwnerSunoGenerationResultCandidates,
  type OwnerSunoGenerationResultMessageContext
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
  OWNER_SUNO_GENERATION_PUBLIC_VERSION,
  OWNER_SUNO_GENERATION_SETTINGS_VERSION,
  OWNER_SUNO_GENERATION_MODEL_IDS,
  getOwnerSunoGenerationParameterSource,
  normalizeOwnerSunoGenerationParameters,
  OwnerSunoGenerationParametersError,
  type OwnerSunoGenerationModel,
  type OwnerSunoGenerationParameterSource,
  type OwnerSunoGenerationRequest,
  type OwnerSunoNormalizedGenerationParameters
} from "./owner-suno-generation-parameters.js";
import {
  OwnerSunoGenerationRequestPreparer,
  OwnerSunoGenerationRequestPreparerError,
  type OwnerSunoGenerationPreparedCandidate
} from "./owner-suno-generation-request-preparer.js";
import { OwnerSunoGenerationOneShotPolicy, OwnerSunoGenerationOneShotPolicyError,
  type OwnerSunoGenerationOneShotPermit } from "./owner-suno-generation-one-shot-policy.js";
import { OwnerSunoTrackContextStore, OwnerSunoTrackContextStoreError } from "./owner-suno-track-context.js";
import {
  OwnerSunoTrackOperationGenerationService,
  type OwnerSunoTrackOperationGenerateInput,
  type OwnerSunoTrackOperationRecoveryListInput,
  type OwnerSunoTrackOperationReconcileInput,
  type OwnerSunoTrackOperationResult,
  type OwnerSunoTrackOperationResultPageInput,
  type OwnerSunoTrackOperationRecoveryListItem
} from "./owner-suno-track-operation-generation-service.js";
import type { OwnerSunoTrackOperationParameterSource } from "./owner-suno-track-operation-parameters.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_PROVIDER_CHAT_ID = /^\d{1,16}$/u;
const RECOVERY_ID = /^suno_generation_recovery_[0-9a-f-]{36}$/u;
const MAX_RECOVERIES = 128;
const MAX_CLIENTS = 128;
const MAX_ACTIVE_RUNS = 4;
const MAX_RESULTS = 4_096;
const MAX_CONTEXTS_PER_HISTORY = 64;
const RESULT_PAGE_SIZE = 64;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_DELAY_MS = 250;
const DEFAULT_MAX_POLL_ATTEMPTS = 3;
const COUNTER_MAX = 255;
const SERVICE_GAPS: readonly OwnerSunoGenerationServiceGapCode[] = Object.freeze([
  "HISTORY_UNVERIFIED", "HISTORY_INCOMPLETE", "HISTORY_EMPTY", "OWNER_ACK_MISSING", "OWNER_ACK_MISMATCH",
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
const CHAT_CREATE_METHOD_NAME = "createOwnerSunoGenerationChat";
const GENERATION_METHOD_NAME = "startSunoWithOwnedCandidate";
const HISTORY_METHOD_NAME = "listOwnedSunoGenerationCandidates";
const RESULT_METHOD_NAME = "getOwnedSunoGenerationResult";
const TRACK_METADATA_METHOD_NAME = "getOwnedSunoGenerationTrackMetadata";
const NATIVE_SUNO_CLIENT = SyntxChatHttpClient.prototype as unknown as Record<string, unknown>;
const CHAT_CREATE = NATIVE_SUNO_CLIENT[CHAT_CREATE_METHOD_NAME] as NativeClient["createOwnerSunoGenerationChat"] | undefined;
const GENERATION_START = NATIVE_SUNO_CLIENT[GENERATION_METHOD_NAME] as NativeClient["startSunoWithOwnedCandidate"] | undefined;
const HISTORY_LIST = NATIVE_SUNO_CLIENT[HISTORY_METHOD_NAME] as NativeClient["listOwnedSunoGenerationCandidates"] | undefined;
const AUDIO_RESULT = NATIVE_SUNO_CLIENT[RESULT_METHOD_NAME] as NativeClient["getOwnedSunoGenerationResult"] | undefined;
const TRACK_METADATA = NATIVE_SUNO_CLIENT[TRACK_METADATA_METHOD_NAME] as NativeClient["getOwnedSunoGenerationTrackMetadata"] | undefined;
const SERVICE_INSTANCES = new WeakSet<object>();

type NativeClient = SyntxChatHttpClient & {
  createOwnerSunoGenerationChat(input: unknown, signal?: AbortSignal): Promise<OwnerSunoGenerationChatContext>;
  startSunoWithOwnedCandidate(input: unknown, signal?: AbortSignal): Promise<MediaGenerationReceipt>;
  listOwnedSunoGenerationCandidates(chat: OwnerSunoGenerationChatContext, signal?: AbortSignal): Promise<OwnerSunoGenerationResultCandidates>;
  getOwnedSunoGenerationResult(context: OwnerSunoGenerationResultMessageContext, signal?: AbortSignal): Promise<OwnerSunoAudioResult>;
  getOwnedSunoGenerationTrackMetadata(context: OwnerSunoGenerationResultMessageContext): readonly unknown[];
};

export type OwnerSunoGenerationServicePhase =
  | "VALIDATE_REQUEST" | "RESOLVE_PRINCIPAL" | "PREPARE_CANDIDATE" | "PREFLIGHT" | "CHAT_CREATE"
  | "GENERATION_POST" | "POST_ACK_KNOWN" | "HISTORY_GET" | "RESULT_GET" | "RESULT_BINDING";

export type OwnerSunoGenerationServiceGapCode = OwnerSunoGenerationNativeGap | OwnerSunoAudioResultGapCode |
  "AUDIO_RESULT_UNVERIFIED" | "RESULT_GET_UNAVAILABLE" | "RESULT_LIMIT_EXCEEDED";

export interface OwnerSunoGenerationDiagnostic {
  readonly phase: OwnerSunoGenerationServicePhase;
  readonly post_started: boolean;
  readonly ack_known: boolean;
  readonly history_status: "NOT_READ" | "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "NOT_READ" | "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  readonly history_get_calls: number;
  readonly result_get_calls: number;
  readonly result_status: "NOT_READ" | "PENDING" | "PARTIAL" | "COMPLETE" | "UNVERIFIED";
  readonly gaps: readonly OwnerSunoGenerationServiceGapCode[];
  readonly counters_saturated: boolean;
}

export interface OwnerSunoGenerationArtifact {
  readonly url: string;
  readonly mime_type: OwnerSunoReadyAudio["mime_type"];
  readonly mime_source: OwnerSunoReadyAudio["mime_source"];
  readonly message_id: string;
  readonly message_object_id: string;
  readonly object_index: number;
  readonly object_type: "audio";
  readonly model_echo: "MATCHED" | "UNKNOWN";
}

export interface OwnerSunoGenerationResult {
  readonly status: "completed" | "partial_results";
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly backend_acceptance: "UNPROVEN";
  readonly provider_terminal_status: "UNPROVEN";
  readonly model_id: OwnerSunoGenerationModel;
  readonly parameters: Readonly<{ mode: "generate"; is_custom_mode: boolean; is_instrumental: boolean }>;
  readonly source_binding: Readonly<{
    public_catalog_version: typeof OWNER_SUNO_GENERATION_PUBLIC_VERSION;
    settings_inventory_version: typeof OWNER_SUNO_GENERATION_SETTINGS_VERSION;
    form_sha256: OwnerSunoGenerationParameterSource["source_pins"]["form_sha256"];
  }>;
  readonly cost_inputs: Readonly<{ version: OwnerSunoGenerationModel }>;
  readonly cost_input_confidence: "PUBLIC_VERSION_KEY_LOCAL_PROJECTION_NOT_UI_QUOTE_OR_CAP";
  readonly recovery_id: string;
  readonly observed_artifact_count: number;
  readonly offset: number;
  readonly page_size: 64;
  readonly artifacts: readonly OwnerSunoGenerationArtifact[];
  readonly has_more: boolean;
  readonly next_offset: number | null;
  readonly diagnostic: OwnerSunoGenerationDiagnostic;
}

export interface OwnerSunoGenerationRecoveryListItem {
  readonly recovery_id: string;
  readonly created_at: string;
  readonly model_id: OwnerSunoGenerationModel;
  readonly status: "outcome_unknown" | "partial_results";
  readonly observed_artifact_count: number;
  readonly diagnostic: OwnerSunoGenerationDiagnostic;
}

export type OwnerSunoGenerationServiceErrorCode =
  | "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH"
  | "PREFLIGHT_FAILED" | "INTENT_ALREADY_CLAIMED" | "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND";

export class OwnerSunoGenerationServiceError extends Error {
  readonly diagnostic?: OwnerSunoGenerationDiagnostic;
  constructor(readonly code: OwnerSunoGenerationServiceErrorCode, readonly recovery_id?: string,
    diagnostic?: OwnerSunoGenerationDiagnostic) {
    super(code === "OUTCOME_UNKNOWN"
      ? "The Suno generation may have been dispatched; reconcile its private recovery and do not retry."
      : "The owner Suno generation could not be completed safely.");
    this.name = "OwnerSunoGenerationServiceError";
    if (code === "OUTCOME_UNKNOWN" && diagnostic) this.diagnostic = diagnostic;
  }
}

export interface OwnerSunoGenerationServiceOptions {
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
export interface OwnerSunoGenerateInput { readonly attemptId: string; readonly request: OwnerSunoGenerationRequest; }
export interface OwnerSunoReconcileInput { readonly attemptId: string; readonly recovery_id: string; }
export interface OwnerSunoRecoveryListInput { readonly attemptId: string; readonly limit?: number; }
export interface OwnerSunoResultPageInput { readonly attemptId: string; readonly recovery_id: string; readonly offset?: number; }
export interface OwnerSunoTrackInputListInput { readonly attemptId: string; readonly recovery_id: string; }
export interface OwnerSunoTrackInput {
  readonly track_handle: string;
  readonly model_id: OwnerSunoGenerationModel;
  readonly expires_in_seconds: number;
}
export interface OwnerSunoTrackInputList {
  readonly recovery_id: string;
  readonly status: "AVAILABLE" | "UNAVAILABLE";
  readonly unavailable_reason?: "TRACK_METADATA_UNAVAILABLE" | "TRACK_INPUT_CAPACITY_REACHED";
  readonly tracks: readonly OwnerSunoTrackInput[];
}

interface MutableDiagnostic {
  phase: OwnerSunoGenerationServicePhase;
  post_started: boolean;
  ack_known: boolean;
  history_status: OwnerSunoGenerationDiagnostic["history_status"];
  owner_ack_status: OwnerSunoGenerationDiagnostic["owner_ack_status"];
  history_get_calls: number;
  result_get_calls: number;
  result_status: OwnerSunoGenerationDiagnostic["result_status"];
  gaps: OwnerSunoGenerationServiceGapCode[];
  counters_saturated: boolean;
}
interface Recovery {
  readonly recovery_id: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly normalized: OwnerSunoNormalizedGenerationParameters;
  readonly source_profile: OwnerSunoGenerationParameterSource;
  readonly source_profile_schema_hash: string;
  readonly semantic_key: string;
  readonly created_at: string;
  readonly chat: OwnerSunoGenerationChatContext;
  readonly candidate: OwnerSunoGenerationPreparedCandidate;
  readonly permit: OwnerSunoGenerationOneShotPermit;
  readonly model_id: OwnerSunoGenerationModel;
  owner_echo_message_id: string | null;
  status: "outcome_unknown" | "partial_results" | "completed";
  artifacts: readonly OwnerSunoGenerationArtifact[];
  readonly observedTrackContexts: Array<Readonly<{ client: SyntxChatHttpClient; resultContext: OwnerSunoGenerationResultMessageContext }>>;
  readonly trackHandleByObject: Map<string, string>;
  readonly diagnostic: MutableDiagnostic;
}
interface ActiveRun { readonly attemptId: string; readonly controller: AbortController; promise: Promise<unknown>; }
/** Owner-only Suno generation with one native POST and private GET-only recovery. */
export class OwnerSunoGenerationService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #catalogVersion: string;
  readonly #resolveChatClient: OwnerSunoGenerationServiceOptions["resolveChatClient"];
  readonly #createAccountStatusService: OwnerSunoGenerationServiceOptions["createAccountStatusService"];
  readonly #createModelAccessService: OwnerSunoGenerationServiceOptions["createModelAccessService"];
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #pollDelayMs: number;
  readonly #maxPollAttempts: number;
  readonly #preparer: OwnerSunoGenerationRequestPreparer;
  readonly #oneShotPolicy: OwnerSunoGenerationOneShotPolicy;
  readonly #trackContextStore: OwnerSunoTrackContextStore;
  readonly #trackOperationService: OwnerSunoTrackOperationGenerationService;
  readonly #recoveries = new Map<string, Recovery>();
  readonly #intentToRecovery = new Map<string, string>();
  readonly #reservedIntentKeys = new Set<string>();
  readonly #clientsByAttempt = new Map<string, SyntxChatHttpClient>();
  readonly #usedAccountServices = new WeakSet<object>();
  readonly #usedAccessServices = new WeakSet<object>();
  readonly #runs = new Set<ActiveRun>();
  readonly #invalidatingAttempts = new Set<string>();
  readonly #invalidations = new Map<string, Promise<void>>();
  #closed = false;
  #closing: Promise<void> | undefined;
  #lastNow = -1;

  constructor(optionsInput: OwnerSunoGenerationServiceOptions | unknown) {
    const options = exactRecord(optionsInput, ["binding", "linkService", "catalog", "catalog_version", "resolveChatClient",
      "createAccountStatusService", "createModelAccessService"], ["now", "timeoutMs", "pollDelayMs", "maxPollAttempts"]);
    if (new.target !== OwnerSunoGenerationService || !isExactInstance(options.catalog, DiscoveryCatalogRepository) ||
        !isExactPerUserLinkService(options.linkService) ||
        typeof options.resolveChatClient !== "function" || types.isProxy(options.resolveChatClient) ||
        typeof options.createAccountStatusService !== "function" || types.isProxy(options.createAccountStatusService) ||
        typeof options.createModelAccessService !== "function" || types.isProxy(options.createModelAccessService)) invalid();
    this.#binding = snapshotBinding(options.binding);
    this.#linkService = options.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#catalog = options.catalog;
    this.#catalogVersion = options.catalog_version as string;
    this.#resolveChatClient = options.resolveChatClient as OwnerSunoGenerationServiceOptions["resolveChatClient"];
    this.#createAccountStatusService = options.createAccountStatusService as OwnerSunoGenerationServiceOptions["createAccountStatusService"];
    this.#createModelAccessService = options.createModelAccessService as OwnerSunoGenerationServiceOptions["createModelAccessService"];
    this.#now = readClockFactory(options.now);
    this.#timeoutMs = bounded(options.timeoutMs, 1_000, 5 * 60_000, DEFAULT_TIMEOUT_MS);
    this.#pollDelayMs = bounded(options.pollDelayMs, 0, 5_000, DEFAULT_POLL_DELAY_MS);
    this.#maxPollAttempts = bounded(options.maxPollAttempts, 1, 8, DEFAULT_MAX_POLL_ATTEMPTS);
    if (this.#catalogVersion !== OWNER_SUNO_GENERATION_PUBLIC_VERSION) fail("MODEL_BINDING_MISMATCH");
    this.#assertSourceBinding();
    this.#preparer = new OwnerSunoGenerationRequestPreparer({ binding: this.#binding, linkService: this.#linkService, now: this.#now });
    this.#oneShotPolicy = new OwnerSunoGenerationOneShotPolicy({ preparer: this.#preparer, now: this.#now });
    this.#trackContextStore = new OwnerSunoTrackContextStore({ now: this.#now });
    this.#trackOperationService = new OwnerSunoTrackOperationGenerationService({ binding: this.#binding,
      linkService: this.#linkService as PerUserLinkService, catalog: this.#catalog, catalog_version: OWNER_SUNO_GENERATION_PUBLIC_VERSION,
      resolveChatClient: this.#resolveChatClient, createAccountStatusService: this.#createAccountStatusService,
      createModelAccessService: this.#createModelAccessService, trackContextStore: this.#trackContextStore, now: this.#now,
      timeoutMs: this.#timeoutMs, pollDelayMs: this.#pollDelayMs, maxPollAttempts: this.#maxPollAttempts });
    SERVICE_INSTANCES.add(this);
    Object.freeze(this);
  }

  async generate(input: OwnerSunoGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerSunoGenerationResult> {
    const request = snapshotGenerate(input);
    return await this.#run(request.attemptId, signal, (runSignal) => this.#generate(request, runSignal));
  }

  async reconcile(input: OwnerSunoReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerSunoGenerationResult> {
    const request = snapshotReconcile(input);
    if (this.#invalidatingAttempts.has(request.attemptId)) {
      const recovery = this.#recoveries.get(request.recovery_id);
      if (recovery?.attemptId === request.attemptId && recovery.status === "outcome_unknown") throw unknownError(recovery);
      fail("RECOVERY_NOT_FOUND");
    }
    return await this.#run(request.attemptId, signal, (runSignal) => this.#reconcile(request, runSignal));
  }

  async listRecoveries(input: OwnerSunoRecoveryListInput | unknown): Promise<readonly OwnerSunoGenerationRecoveryListItem[]> {
    this.#assertOpen();
    const request = snapshotRecoveryList(input);
    return await this.#run(request.attemptId, undefined, async () => {
      const principal = await this.#resolvePrincipal(request.attemptId);
      if (this.#invalidatingAttempts.has(request.attemptId)) fail("PRINCIPAL_NOT_LINKED");
      return Object.freeze([...this.#recoveries.values()].filter((item) => item.attemptId === request.attemptId &&
        sameGenerationPrincipal(item.principal, principal) && item.status !== "completed")
        .sort((left, right) => left.created_at.localeCompare(right.created_at)).slice(0, request.limit)
        .map((item) => Object.freeze({ recovery_id: item.recovery_id, created_at: item.created_at, model_id: item.model_id,
          status: item.status as "outcome_unknown" | "partial_results", observed_artifact_count: item.artifacts.length,
          diagnostic: snapshotDiagnostic(item.diagnostic) })));
    });
  }

  async getResultPage(input: OwnerSunoResultPageInput | unknown): Promise<OwnerSunoGenerationResult> {
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

  /** Lists opaque read-only handles derived only from already-read owner result contexts. */
  async listTrackInputs(input: OwnerSunoTrackInputListInput | unknown): Promise<OwnerSunoTrackInputList> {
    this.#assertOpen();
    const request = snapshotTrackInputList(input);
    return await this.#run(request.attemptId, undefined, async () => {
      const principal = await this.#resolvePrincipal(request.attemptId);
      const recovery = this.#recoveries.get(request.recovery_id);
      if (this.#invalidatingAttempts.has(request.attemptId) || !recovery || recovery.attemptId !== request.attemptId ||
          !sameGenerationPrincipal(recovery.principal, principal)) fail("RECOVERY_NOT_FOUND");
      this.#assertRecoverySourceBinding(recovery);
      if (recovery.status === "outcome_unknown") return trackInputList(request.recovery_id, [], "TRACK_METADATA_UNAVAILABLE");
      return this.#listObservedTrackInputs(recovery);
    });
  }

  getTrackOperationParametersSource(): OwnerSunoTrackOperationParameterSource {
    this.#assertOpen();
    return this.#trackOperationService.getTrackOperationParametersSource();
  }

  async generateTrackOperation(input: OwnerSunoTrackOperationGenerateInput | unknown,
    signal?: AbortSignal): Promise<OwnerSunoTrackOperationResult> {
    this.#assertOpen();
    return await this.#trackOperationService.generateTrackOperation(input, signal);
  }

  async reconcileTrackOperation(input: OwnerSunoTrackOperationReconcileInput | unknown,
    signal?: AbortSignal): Promise<OwnerSunoTrackOperationResult> {
    this.#assertOpen();
    return await this.#trackOperationService.reconcileTrackOperation(input, signal);
  }

  async listTrackOperationRecoveries(input: OwnerSunoTrackOperationRecoveryListInput | unknown): Promise<readonly OwnerSunoTrackOperationRecoveryListItem[]> {
    this.#assertOpen();
    return await this.#trackOperationService.listTrackOperationRecoveries(input);
  }

  async getTrackOperationResultPage(input: OwnerSunoTrackOperationResultPageInput | unknown): Promise<OwnerSunoTrackOperationResult> {
    this.#assertOpen();
    return await this.#trackOperationService.getTrackOperationResultPage(input);
  }

  async invalidateAttempt(attemptIdInput: unknown): Promise<void> {
    const attemptId = safeAttempt(attemptIdInput);
    if (!this.#invalidatingAttempts.has(attemptId)) this.#invalidatingAttempts.add(attemptId);
    await this.#trackOperationService.invalidateAttempt(attemptId);
    this.#preparer.invalidateAttempt(attemptId);
    this.#oneShotPolicy.invalidateAttempt(attemptId);
    this.#trackContextStore.invalidateAttempt(this.#binding, attemptId);
    for (const run of this.#runs) if (run.attemptId === attemptId) run.controller.abort();
    const pending = [...this.#runs].filter((run) => run.attemptId === attemptId).map((run) => run.promise);
    const invalidation = Promise.allSettled(pending).then(() => {
      this.#clientsByAttempt.delete(attemptId);
      for (const recovery of this.#recoveries.values()) if (recovery.attemptId === attemptId) {
        recovery.observedTrackContexts.length = 0;
        recovery.trackHandleByObject.clear();
      }
    });
    this.#invalidations.set(attemptId, invalidation);
    await invalidation;
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    const attempts = new Set([...this.#runs].map((run) => run.attemptId));
    this.#closing = (async () => {
      await this.#trackOperationService.close();
      await Promise.all([...attempts].map((attempt) => this.invalidateAttempt(attempt)));
      this.#oneShotPolicy.close();
      this.#preparer.close();
      for (const recovery of this.#recoveries.values()) {
        recovery.observedTrackContexts.length = 0;
        recovery.trackHandleByObject.clear();
      }
      this.#trackContextStore.close();
      this.#clientsByAttempt.clear();
      this.#invalidations.clear();
    })();
    return this.#closing;
  }

  async #generate(request: Readonly<OwnerSunoGenerateInput>, signal: AbortSignal): Promise<OwnerSunoGenerationResult> {
    const deadline = this.#deadline(signal);
    let semanticKey: string | undefined;
    let recovery: Recovery | undefined;
    let candidate: OwnerSunoGenerationPreparedCandidate | undefined;
    let permit: OwnerSunoGenerationOneShotPermit | undefined;
    let postStarted = false;
    try {
      deadline.throwIfAborted();
      const normalized = normalizeOwnerSunoGenerationParameters(request.request);
      const source = this.#assertSourceBinding();
      this.#validateModelBinding(normalized.model_id, source);
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      semanticKey = semanticIntentKey(principal, normalized, schemaHash(source));
      const existingId = this.#intentToRecovery.get(semanticKey);
      if (existingId) {
        const existing = this.#recoveries.get(existingId);
        if (!existing || existing.attemptId !== request.attemptId || !sameGenerationPrincipal(existing.principal, principal)) fail("INTENT_ALREADY_CLAIMED");
        this.#assertRecoverySourceBinding(existing);
        if (existing.status === "outcome_unknown") throw unknownError(existing);
        return pageResult(existing, 0);
      }
      if (this.#reservedIntentKeys.has(semanticKey)) fail("SERVICE_BUSY");
      if (this.#recoveries.size + this.#reservedIntentKeys.size >= MAX_RECOVERIES) fail("SERVICE_BUSY");
      this.#reservedIntentKeys.add(semanticKey);

      candidate = await this.#await(deadline, () => this.#preparer.prepare({ attemptId: request.attemptId,
        normalized: normalized as OwnerSunoNormalizedGenerationParameters }));
      permit = this.#oneShotPolicy.createPermit({ candidate, attemptId: request.attemptId, principal });
      await this.#runPreflight(request.attemptId, normalized, deadline);
      const client = this.#resolveNativeClient(request.attemptId);
      deadline.throwIfAborted();
      const chat = await this.#await(deadline, () => Reflect.apply(CHAT_CREATE! as Function, client, [Object.freeze({ candidate, permit,
        preparer: this.#preparer, oneShotPolicy: this.#oneShotPolicy, principal, attemptId: request.attemptId }), deadline.signal]) as Promise<OwnerSunoGenerationChatContext>);
      this.#assertChatBinding(chat, client, candidate, request.attemptId, principal);

      const principalAfterChat = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      if (!sameGenerationPrincipal(principal, principalAfterChat) || this.#invalidatingAttempts.has(request.attemptId)) fail("PRINCIPAL_NOT_LINKED");
      this.#validateModelBinding(normalized.model_id, this.#assertSourceBinding());
      await this.#runPreflight(request.attemptId, normalized, deadline);
      const principalBeforePost = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      if (!sameGenerationPrincipal(principal, principalBeforePost) || this.#invalidatingAttempts.has(request.attemptId)) fail("PRINCIPAL_NOT_LINKED");
      this.#preparer.revalidateCandidate({ candidate, attemptId: request.attemptId, principal });
      this.#oneShotPolicy.revalidate({ candidate, permit, attemptId: request.attemptId, principal });

      recovery = createRecovery({ attemptId: request.attemptId, principal, normalized, source, semanticKey, chat, candidate, permit,
        now: this.#readNow() });
      this.#recoveries.set(recovery.recovery_id, recovery);
      this.#intentToRecovery.set(semanticKey, recovery.recovery_id);
      this.#reservedIntentKeys.delete(semanticKey); semanticKey = undefined;

      recovery.diagnostic.phase = "GENERATION_POST";
      recovery.diagnostic.post_started = true;
      postStarted = true;
      const receipt = await this.#await(deadline, () => Reflect.apply(GENERATION_START! as Function, client, [Object.freeze({ chat, candidate: candidate!,
        permit: permit!, preparer: this.#preparer, oneShotPolicy: this.#oneShotPolicy, principal, attemptId: request.attemptId }), deadline.signal]) as Promise<MediaGenerationReceipt>);
      if (!validReceipt(receipt, chat.chat_uuid)) throw unknownError(recovery);
      recovery.owner_echo_message_id = receipt.message_id;
      recovery.diagnostic.ack_known = true;
      recovery.diagnostic.phase = "POST_ACK_KNOWN";
      return await this.#observe(recovery, client, deadline);
    } catch (error) {
      if (postStarted && recovery) throw unknownError(recovery);
      if (semanticKey) this.#reservedIntentKeys.delete(semanticKey);
      if (error instanceof OwnerSunoGenerationServiceError) throw error;
      if (error instanceof OwnerSunoGenerationParametersError) invalid();
      if (error instanceof OwnerSunoGenerationNativeError) {
        if (error.code === "OUTCOME_UNKNOWN" && recovery) throw unknownError(recovery);
        fail(error.code === "REQUEST_ABORTED" ? "PRE_DISPATCH_FAILED" : "PRE_DISPATCH_FAILED");
      }
      if (error instanceof OwnerSunoGenerationRequestPreparerError) fail(mapPreparerCode(error.code));
      if (error instanceof OwnerSunoGenerationOneShotPolicyError) fail(mapOneShotCode(error.code));
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      return fail("PRE_DISPATCH_FAILED");
    } finally {
      if (semanticKey) this.#reservedIntentKeys.delete(semanticKey);
      deadline.close();
    }
  }

  async #reconcile(request: Readonly<OwnerSunoReconcileInput>, signal: AbortSignal): Promise<OwnerSunoGenerationResult> {
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
      if (error instanceof OwnerSunoGenerationServiceError && error.code === "RECOVERY_NOT_FOUND") throw error;
      throw unknownError(recovery);
    } finally { deadline.close(); }
  }

  async #observe(recovery: Recovery, client: NativeClient, deadline: AbsoluteRequestDeadline): Promise<OwnerSunoGenerationResult> {
    let lastResult: OwnerSunoGenerationResult | undefined;
    for (let poll = 0; poll < this.#maxPollAttempts; poll += 1) {
      deadline.throwIfAborted();
      recovery.diagnostic.gaps = [];
      if (this.#invalidatingAttempts.has(recovery.attemptId)) throw unknownError(recovery);
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(recovery.attemptId));
      if (!sameGenerationPrincipal(principal, recovery.principal)) throw unknownError(recovery);
      recovery.diagnostic.phase = "HISTORY_GET";
      let history: OwnerSunoGenerationResultCandidates;
      try {
        history = await this.#await(deadline, () => Reflect.apply(HISTORY_LIST! as Function, client, [recovery.chat, deadline.signal]) as Promise<OwnerSunoGenerationResultCandidates>);
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
      if (history.backend_acceptance !== "UNPROVEN" || history.owner_ack_status !== "MATCHED" ||
          history.history_binding_status !== "BOUND" || history.history_page_status !== "COMPLETE" ||
          history.status !== "COMPLETE" || !history.provider_chat_id || !SAFE_PROVIDER_CHAT_ID.test(history.provider_chat_id) ||
          !isSafeId(history.owner_echo_message_id)) {
        recovery.diagnostic.history_status = history.status === "PENDING" ? "PENDING" :
          history.status === "INCOMPLETE" ? "INCOMPLETE" : "UNVERIFIED";
        recovery.diagnostic.result_status = "PENDING";
        addGaps(recovery.diagnostic, history.gaps);
        const safelyPollablePending = history.status === "PENDING" && history.owner_ack_status === "MATCHED" &&
          history.history_page_status === "COMPLETE" && history.history_binding_status !== "UNVERIFIED";
        if (!safelyPollablePending) {
          throw unknownError(recovery);
        }
        recovery.status = "partial_results";
        lastResult = pageResult(recovery, 0);
        if (poll + 1 < this.#maxPollAttempts) await delay(this.#pollDelayMs, deadline.signal);
        continue;
      }
      if (recovery.owner_echo_message_id && recovery.owner_echo_message_id !== history.owner_echo_message_id) {
        recovery.diagnostic.history_status = "UNVERIFIED";
        recovery.diagnostic.result_status = "UNVERIFIED";
        addGaps(recovery.diagnostic, ["OWNER_ACK_MISMATCH"]);
        throw unknownError(recovery);
      }
      recovery.owner_echo_message_id = history.owner_echo_message_id;
      recovery.diagnostic.ack_known = true;
      recovery.diagnostic.history_status = "COMPLETE";
      addGaps(recovery.diagnostic, history.gaps);
      if (history.contexts.length === 0) {
        recovery.diagnostic.result_status = "PENDING";
        addGaps(recovery.diagnostic, history.gaps.length ? history.gaps : ["BOT_RESULT_NOT_OBSERVED"]);
        recovery.status = "partial_results";
        lastResult = pageResult(recovery, 0);
        if (poll + 1 < this.#maxPollAttempts) await delay(this.#pollDelayMs, deadline.signal);
        continue;
      }
      if (history.contexts.length > MAX_CONTEXTS_PER_HISTORY) {
        recovery.diagnostic.result_status = "UNVERIFIED";
        addGaps(recovery.diagnostic, ["RESULT_LIMIT_EXCEEDED"]);
        throw unknownError(recovery);
      }

      const artifactsById = new Map(recovery.artifacts.map((artifact) => [artifact.message_object_id, artifact]));
      const urlsToId = new Map(recovery.artifacts.map((artifact) => [artifact.url, artifact.message_object_id]));
      let incomplete = history.gaps.length > 0;
      for (const context of history.contexts) {
        if (!isOwnerSunoGenerationResultMessageContext(context, client) || context.attempt_id !== recovery.attemptId ||
            context.chat_uuid !== recovery.chat.chat_uuid || context.model_id !== recovery.model_id ||
            context.owner_echo_message_id !== recovery.owner_echo_message_id || !sameGenerationPrincipal(context.principal, recovery.principal) ||
            context.intent_fingerprint !== recovery.candidate.intent_fingerprint ||
            context.source_profile_schema_hash !== recovery.chat.source_profile_schema_hash ||
            !isDeepStrictEqual(context.source_pins, recovery.chat.source_pins) || context.provider_chat_id !== history.provider_chat_id) {
          recovery.diagnostic.result_status = "UNVERIFIED";
          addGaps(recovery.diagnostic, ["AUDIO_RESULT_UNVERIFIED"]);
          throw unknownError(recovery);
        }
        recovery.diagnostic.phase = "RESULT_GET";
        let decoded: OwnerSunoAudioResult;
        try {
          decoded = await this.#await(deadline, () => Reflect.apply(AUDIO_RESULT! as Function, client, [context, deadline.signal]) as Promise<OwnerSunoAudioResult>);
        } catch {
          deadline.throwIfAborted();
          incrementCounter(recovery.diagnostic, "result_get_calls", 1);
          recovery.diagnostic.result_status = "UNVERIFIED";
          addGaps(recovery.diagnostic, ["RESULT_GET_UNAVAILABLE"]);
          throw unknownError(recovery);
        }
        incrementCounter(recovery.diagnostic, "result_get_calls", 1);
        if (decoded.message_binding !== "BOUND" || decoded.model_echo === "MISMATCH" || decoded.backend_acceptance !== "UNPROVEN") {
          recovery.diagnostic.result_status = "UNVERIFIED";
          addGaps(recovery.diagnostic, decoded.gaps.map((item) => item.code));
          addGaps(recovery.diagnostic, ["AUDIO_RESULT_UNVERIFIED"]);
          throw unknownError(recovery);
        }
        if (!recovery.observedTrackContexts.some((item) => item.resultContext === context) &&
            recovery.observedTrackContexts.length < MAX_CONTEXTS_PER_HISTORY) {
          recovery.observedTrackContexts.push(Object.freeze({ client, resultContext: context }));
        }
        if (decoded.gaps.length > 0 || decoded.model_echo === "UNKNOWN") incomplete = true;
        addGaps(recovery.diagnostic, decoded.gaps.map((item) => item.code));
        const expectedIds = new Set(context.message_object_ids);
        for (const audio of decoded.ready_audio) {
          if (!expectedIds.has(audio.message_object_id)) {
            incomplete = true; addGaps(recovery.diagnostic, ["AUDIO_RESULT_UNVERIFIED"]); continue;
          }
          const artifact: OwnerSunoGenerationArtifact = Object.freeze({ url: audio.object_url, mime_type: audio.mime_type, mime_source: audio.mime_source,
            message_id: context.message_id, message_object_id: audio.message_object_id, object_index: audio.object_index,
            object_type: "audio", model_echo: decoded.model_echo });
          const previous = artifactsById.get(artifact.message_object_id);
          if (previous) {
            if (!isDeepStrictEqual(previous, artifact)) { incomplete = true; addGaps(recovery.diagnostic, ["AUDIO_RESULT_UNVERIFIED"]); }
            continue;
          }
          const priorIdForUrl = urlsToId.get(artifact.url);
          if (priorIdForUrl && priorIdForUrl !== artifact.message_object_id) {
            incomplete = true; addGaps(recovery.diagnostic, ["AUDIO_RESULT_UNVERIFIED"]); continue;
          }
          artifactsById.set(artifact.message_object_id, artifact);
          urlsToId.set(artifact.url, artifact.message_object_id);
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

  #listObservedTrackInputs(recovery: Recovery): OwnerSunoTrackInputList {
    const tracks: OwnerSunoTrackInput[] = [];
    let capacityReached = false;
    for (const observed of recovery.observedTrackContexts) {
      const contextObjectIds = observed.resultContext.message_object_ids;
      if (!isOwnerSunoGenerationResultMessageContext(observed.resultContext, observed.client)) continue;
      for (const artifact of recovery.artifacts) {
        if (artifact.message_id !== observed.resultContext.message_id || !contextObjectIds.includes(artifact.message_object_id)) continue;
        const cacheKey = JSON.stringify([observed.resultContext.message_id, artifact.message_object_id]);
        let handle = recovery.trackHandleByObject.get(cacheKey);
        let expiresAt: number | undefined;
        if (handle) {
          try {
            expiresAt = this.#trackContextStore.resolve({ binding: this.#binding, attemptId: recovery.attemptId,
              principal: recovery.principal, trackHandle: handle }).expires_at;
          } catch (error) {
            if (error instanceof OwnerSunoTrackContextStoreError && error.code === "TRACK_CONTEXT_EXPIRED") {
              recovery.trackHandleByObject.delete(cacheKey);
              handle = undefined;
            } else if (error instanceof OwnerSunoTrackContextStoreError && error.code === "TRACK_CONTEXT_UNAVAILABLE") {
              continue;
            } else {
              fail(error instanceof OwnerSunoTrackContextStoreError && error.code === "SERVICE_CLOSED" ? "SERVICE_CLOSED" : "SERVICE_BUSY");
            }
          }
        }
        if (!handle) {
          try {
            handle = this.#trackContextStore.issue({ binding: this.#binding, attemptId: recovery.attemptId,
              principal: recovery.principal, client: observed.client, resultContext: observed.resultContext,
              messageObjectId: artifact.message_object_id });
            recovery.trackHandleByObject.set(cacheKey, handle);
            expiresAt = this.#trackContextStore.resolve({ binding: this.#binding, attemptId: recovery.attemptId,
              principal: recovery.principal, trackHandle: handle }).expires_at;
          } catch (error) {
            if (error instanceof OwnerSunoTrackContextStoreError && error.code === "CAPACITY_EXCEEDED") {
              capacityReached = true;
              break;
            }
            if (error instanceof OwnerSunoTrackContextStoreError && error.code === "TRACK_CONTEXT_UNAVAILABLE") continue;
            fail(error instanceof OwnerSunoTrackContextStoreError && error.code === "SERVICE_CLOSED" ? "SERVICE_CLOSED" : "SERVICE_BUSY");
          }
        }
        if (tracks.length >= 128) { capacityReached = true; break; }
        const expiresIn = Math.max(1, Math.min(1_800, Math.floor((expiresAt! - this.#readNow()) / 1_000)));
        tracks.push(Object.freeze({ track_handle: handle, model_id: recovery.model_id, expires_in_seconds: expiresIn }));
      }
      if (capacityReached) break;
    }
    const reason = capacityReached ? "TRACK_INPUT_CAPACITY_REACHED" : tracks.length === 0 ? "TRACK_METADATA_UNAVAILABLE" : undefined;
    return trackInputList(recovery.recovery_id, tracks, reason);
  }

  async #runPreflight(attemptId: string, normalized: OwnerSunoNormalizedGenerationParameters, deadline: AbsoluteRequestDeadline): Promise<void> {
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
        model_id: normalized.model_id, cost_parameters: Object.freeze({ version: normalized.model_id })
      }), deadline.signal]) as Promise<ModelAccessResult>);
    } catch { fail("PREFLIGHT_FAILED"); }
    assertFreshPreflight(account, access, normalized, this.#catalog, this.#readNow());
  }

  #assertSourceBinding(): OwnerSunoGenerationParameterSource {
    let source: OwnerSunoGenerationParameterSource;
    try { source = getOwnerSunoGenerationParameterSource() as OwnerSunoGenerationParameterSource; }
    catch { fail("MODEL_BINDING_MISMATCH"); }
    if (this.#catalogVersion !== OWNER_SUNO_GENERATION_PUBLIC_VERSION ||
        source.source_pins.public_catalog_version !== OWNER_SUNO_GENERATION_PUBLIC_VERSION ||
        source.source_pins.settings_inventory_version !== OWNER_SUNO_GENERATION_SETTINGS_VERSION ||
        source.runtime_usable !== false || source.dispatch_allowed !== false || source.backend_acceptance !== "UNPROVEN" ||
        !sameArray(source.model_ids, OWNER_SUNO_GENERATION_MODEL_IDS)) fail("MODEL_BINDING_MISMATCH");
    return source;
  }

  #validateModelBinding(modelId: OwnerSunoGenerationModel, source: OwnerSunoGenerationParameterSource): void {
    if (!(OWNER_SUNO_GENERATION_MODEL_IDS as readonly string[]).includes(modelId) || !source.models[modelId]) fail("MODEL_BINDING_MISMATCH");
    let model;
    try { model = this.#catalog.getModel(modelId); } catch { fail("MODEL_BINDING_MISMATCH"); }
    if (!model.active || model.id !== modelId || model.upstream_id !== modelId || model.ai_name !== "suno" ||
        !model.settings?.get_cost_params?.includes("version")) fail("MODEL_BINDING_MISMATCH");
  }

  #assertChatBinding(chat: OwnerSunoGenerationChatContext, client: NativeClient, candidate: OwnerSunoGenerationPreparedCandidate,
    attemptId: string, principal: Readonly<GenerationPrincipalRef>): void {
    if (!isOwnerSunoGenerationChatContext(chat, client) || chat.status !== "created" || chat.attempt_id !== attemptId ||
        chat.model_id !== candidate.model_id || chat.intent_fingerprint !== candidate.intent_fingerprint ||
        chat.source_profile_schema_hash !== candidate.source_profile_schema_hash ||
        !isDeepStrictEqual(chat.source_pins, candidate.source_pins) || !sameGenerationPrincipal(chat.principal, principal) ||
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
  async #run<T>(attemptId: string, parent: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
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

export function isOwnerSunoGenerationService(value: unknown): value is OwnerSunoGenerationService {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && SERVICE_INSTANCES.has(value) &&
    Object.getPrototypeOf(value) === OwnerSunoGenerationService.prototype && Reflect.ownKeys(value).length === 0 && Object.isFrozen(value); }
  catch { return false; }
}

function createRecovery(input: { attemptId: string; principal: Readonly<GenerationPrincipalRef>;
  normalized: OwnerSunoNormalizedGenerationParameters; source: OwnerSunoGenerationParameterSource; semanticKey: string;
  chat: OwnerSunoGenerationChatContext; candidate: OwnerSunoGenerationPreparedCandidate; permit: OwnerSunoGenerationOneShotPermit; now: number }): Recovery {
  if (!Number.isSafeInteger(input.now) || input.now > 8_640_000_000_000_000) fail("SERVICE_BUSY");
  const recovery_id = `suno_generation_recovery_${randomUUID()}`;
  const diagnostic: MutableDiagnostic = { phase: "CHAT_CREATE", post_started: false, ack_known: false,
    history_status: "NOT_READ", owner_ack_status: "NOT_READ", history_get_calls: 0, result_get_calls: 0,
    result_status: "NOT_READ", gaps: [], counters_saturated: false };
  return { recovery_id, attemptId: input.attemptId, principal: input.principal, normalized: input.normalized,
    source_profile: input.source, source_profile_schema_hash: schemaHash(input.source), semantic_key: input.semanticKey,
    created_at: new Date(input.now).toISOString(), chat: input.chat, candidate: input.candidate, permit: input.permit,
    model_id: input.normalized.model_id, owner_echo_message_id: null, status: "outcome_unknown",
    artifacts: Object.freeze([]), observedTrackContexts: [], trackHandleByObject: new Map(), diagnostic };
}

function pageResult(recovery: Recovery, offset: number): OwnerSunoGenerationResult {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_RESULTS) invalid();
  if (recovery.status === "outcome_unknown") throw unknownError(recovery);
  const artifacts = recovery.artifacts.slice(offset, offset + RESULT_PAGE_SIZE);
  const next = offset + artifacts.length;
  return Object.freeze({ status: recovery.status, status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY",
    backend_acceptance: "UNPROVEN", provider_terminal_status: "UNPROVEN", model_id: recovery.model_id,
    parameters: Object.freeze({ mode: "generate", is_custom_mode: recovery.normalized.settings_candidate.is_custom_mode,
      is_instrumental: recovery.normalized.settings_candidate.is_instrumental }),
    source_binding: Object.freeze({ public_catalog_version: recovery.source_profile.source_pins.public_catalog_version,
      settings_inventory_version: recovery.source_profile.source_pins.settings_inventory_version,
      form_sha256: recovery.source_profile.source_pins.form_sha256 }),
    cost_inputs: Object.freeze({ version: recovery.model_id }),
    cost_input_confidence: "PUBLIC_VERSION_KEY_LOCAL_PROJECTION_NOT_UI_QUOTE_OR_CAP",
    recovery_id: recovery.recovery_id, observed_artifact_count: recovery.artifacts.length, offset, page_size: RESULT_PAGE_SIZE,
    artifacts: Object.freeze(artifacts), has_more: next < recovery.artifacts.length,
    next_offset: next < recovery.artifacts.length ? next : null, diagnostic: snapshotDiagnostic(recovery.diagnostic) });
}

function snapshotDiagnostic(input: MutableDiagnostic): OwnerSunoGenerationDiagnostic {
  return Object.freeze({ phase: input.phase, post_started: input.post_started, ack_known: input.ack_known,
    history_status: input.history_status, owner_ack_status: input.owner_ack_status,
    history_get_calls: input.history_get_calls, result_get_calls: input.result_get_calls,
    result_status: input.result_status, gaps: Object.freeze(input.gaps.slice(0, 128)), counters_saturated: input.counters_saturated });
}

function unknownError(recovery: Recovery): OwnerSunoGenerationServiceError {
  return serviceError("OUTCOME_UNKNOWN", recovery.recovery_id, snapshotDiagnostic(recovery.diagnostic));
}
function serviceError(code: OwnerSunoGenerationServiceErrorCode, recoveryId?: string,
  diagnostic?: OwnerSunoGenerationDiagnostic): OwnerSunoGenerationServiceError {
  return new OwnerSunoGenerationServiceError(code, recoveryId, diagnostic);
}
function fail(code: OwnerSunoGenerationServiceErrorCode): never { throw serviceError(code); }
function invalid(): never { return fail("INVALID_REQUEST"); }

function snapshotGenerate(value: unknown): Readonly<OwnerSunoGenerateInput> {
  const fields = exactRecord(value, ["attemptId", "request"]);
  const attemptId = readAttempt(fields.attemptId);
  try {
    const normalized = normalizeOwnerSunoGenerationParameters(fields.request);
    const settings = normalized.settings_candidate;
    return Object.freeze({ attemptId, request: Object.freeze({ model_id: normalized.model_id, mode: normalized.mode,
      prompt: normalized.prompt, is_custom_mode: settings.is_custom_mode, is_instrumental: settings.is_instrumental,
      negative_tags: settings.negative_tags, styles: settings.styles, title: settings.title }) as OwnerSunoGenerationRequest });
  } catch { invalid(); }
}
function snapshotReconcile(value: unknown): Readonly<OwnerSunoReconcileInput> {
  const fields = exactRecord(value, ["attemptId", "recovery_id"]);
  const attemptId = readAttempt(fields.attemptId);
  if (typeof fields.recovery_id !== "string" || !RECOVERY_ID.test(fields.recovery_id)) invalid();
  return Object.freeze({ attemptId, recovery_id: fields.recovery_id });
}
function snapshotRecoveryList(value: unknown): Readonly<Required<OwnerSunoRecoveryListInput>> {
  const fields = exactRecord(value, ["attemptId"], ["limit"]);
  const attemptId = readAttempt(fields.attemptId);
  const limit = fields.limit === undefined ? 64 : bounded(fields.limit, 1, 128, 64);
  return Object.freeze({ attemptId, limit });
}
function snapshotResultPage(value: unknown): Readonly<Required<OwnerSunoResultPageInput>> {
  const fields = exactRecord(value, ["attemptId", "recovery_id"], ["offset"]);
  const attemptId = readAttempt(fields.attemptId);
  if (typeof fields.recovery_id !== "string" || !RECOVERY_ID.test(fields.recovery_id)) invalid();
  const offset = fields.offset === undefined ? 0 : bounded(fields.offset, 0, MAX_RESULTS, 0);
  return Object.freeze({ attemptId, recovery_id: fields.recovery_id, offset });
}
function snapshotTrackInputList(value: unknown): Readonly<OwnerSunoTrackInputListInput> {
  const fields = exactRecord(value, ["attemptId", "recovery_id"]);
  const attemptId = readAttempt(fields.attemptId);
  if (typeof fields.recovery_id !== "string" || !RECOVERY_ID.test(fields.recovery_id)) invalid();
  return Object.freeze({ attemptId, recovery_id: fields.recovery_id });
}
function trackInputList(recoveryId: string, input: readonly OwnerSunoTrackInput[],
  reason?: OwnerSunoTrackInputList["unavailable_reason"]): OwnerSunoTrackInputList {
  const tracks = Object.freeze(input.slice(0, 128));
  const unavailableReason = reason ?? (tracks.length === 0 ? "TRACK_METADATA_UNAVAILABLE" : undefined);
  const status = tracks.length > 0 ? "AVAILABLE" : "UNAVAILABLE";
  return Object.freeze({ recovery_id: recoveryId, status,
    ...(unavailableReason === undefined ? {} : { unavailable_reason: unavailableReason }), tracks });
}
function readAttempt(value: unknown): string {
  if (typeof value !== "string" || !ATTEMPT.test(value)) invalid();
  return value;
}
function safeAttempt(value: unknown): string { return readAttempt(value); }

function semanticIntentKey(principal: Readonly<GenerationPrincipalRef>, normalized: OwnerSunoNormalizedGenerationParameters,
  profileHash: string): string {
  const stablePrincipal = [principal.tenant_id, principal.subject_id];
  const request = normalized.settings_candidate;
  return createHash("sha256").update(JSON.stringify(["owner-suno-intent-v1", stablePrincipal, profileHash,
    normalized.model_id, normalized.mode, normalized.prompt, request.is_custom_mode, request.is_instrumental,
    request.negative_tags, request.styles, request.title]), "utf8").digest("hex");
}

function assertFreshPreflight(accountInput: unknown, accessInput: unknown, normalized: OwnerSunoNormalizedGenerationParameters,
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
        access.account_read_live !== true || access.access !== true || access.parameters_redacted !== true ||
        !sameArray(keys, ["version"]) || !nullableFinite(access.cost) || !nullableFinite(access.discount_cost) ||
        !(access.free_remaining_generations === null || nonnegativeInteger(access.free_remaining_generations)) ||
        !nullableFinite(access.limit) || !(access.show_warning === null || typeof access.show_warning === "boolean") ||
        !isFreshIso(access.observed_at, now)) fail("PREFLIGHT_FAILED");
  } catch (error) { if (error instanceof OwnerSunoGenerationServiceError) throw error; fail("PREFLIGHT_FAILED"); }
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

function validReceipt(value: unknown, chatUuid: string): value is MediaGenerationReceipt {
  try { const fields = exactRecord(value, ["chat_uuid", "message_id"]); return fields.chat_uuid === chatUuid && isSafeId(fields.message_id); }
  catch { return false; }
}
function isNativeClient(value: unknown): value is NativeClient {
  try {
    if (!isExactInstance(value, SyntxChatHttpClient)) return false;
    return getDataMethod(value, CHAT_CREATE_METHOD_NAME) === CHAT_CREATE &&
      getDataMethod(value, GENERATION_METHOD_NAME) === GENERATION_START &&
      getDataMethod(value, HISTORY_METHOD_NAME) === HISTORY_LIST && getDataMethod(value, RESULT_METHOD_NAME) === AUDIO_RESULT &&
      getDataMethod(value, TRACK_METADATA_METHOD_NAME) === TRACK_METADATA &&
      typeof CHAT_CREATE === "function" && typeof GENERATION_START === "function" && typeof HISTORY_LIST === "function" &&
      typeof AUDIO_RESULT === "function" && typeof TRACK_METADATA === "function";
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

function mapPreparerCode(code: string): OwnerSunoGenerationServiceErrorCode {
  if (code === "PRINCIPAL_NOT_LINKED" || code === "PRINCIPAL_MISMATCH") return "PRINCIPAL_NOT_LINKED";
  if (code === "SOURCE_EVIDENCE_UNAVAILABLE" || code === "SOURCE_EVIDENCE_CHANGED") return "MODEL_BINDING_MISMATCH";
  if (code === "SERVICE_CLOSED") return "SERVICE_CLOSED";
  if (code === "CAPACITY_EXCEEDED") return "SERVICE_BUSY";
  if (code === "INVALID_REQUEST" || code === "NORMALIZED_CANDIDATE_INVALID") return "INVALID_REQUEST";
  return "PRE_DISPATCH_FAILED";
}
function mapOneShotCode(code: string): OwnerSunoGenerationServiceErrorCode {
  if (code === "PRINCIPAL_MISMATCH" || code === "ATTEMPT_INVALIDATED") return "PRINCIPAL_NOT_LINKED";
  if (code === "INTENT_ALREADY_CLAIMED") return "INTENT_ALREADY_CLAIMED";
  if (code === "CAPACITY_EXCEEDED" || code === "POLICY_CLOSED") return code === "POLICY_CLOSED" ? "SERVICE_CLOSED" : "SERVICE_BUSY";
  if (code === "CANDIDATE_EXPIRED" || code === "CANDIDATE_UNBOUND") return "INVALID_REQUEST";
  return "PRE_DISPATCH_FAILED";
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
function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || !fields.tenant_id.trim() || fields.tenant_id.length > 256 ||
      typeof fields.subject !== "string" || !fields.subject.trim() || fields.subject.length > 512 ||
      /[\u0000-\u001f\u007f]/u.test(fields.tenant_id) || /[\u0000-\u001f\u007f]/u.test(fields.subject)) invalid();
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) invalid();
  let prototype: object | null; let descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); }
  catch { invalid(); }
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

function incrementCounter(diagnostic: MutableDiagnostic, key: "history_get_calls" | "result_get_calls", amount: number): void {
  if (!Number.isSafeInteger(amount) || amount < 0) { diagnostic.counters_saturated = true; diagnostic[key] = COUNTER_MAX; return; }
  const room = COUNTER_MAX - diagnostic[key];
  if (amount > room) diagnostic.counters_saturated = true;
  diagnostic[key] = Math.min(COUNTER_MAX, diagnostic[key] + amount);
}
function addGaps(diagnostic: MutableDiagnostic, values: readonly string[]): void {
  for (const value of values) {
    const safe = (SERVICE_GAPS as readonly string[]).includes(value) ? value as OwnerSunoGenerationServiceGapCode : "AUDIO_RESULT_UNVERIFIED";
    if (!diagnostic.gaps.includes(safe) && diagnostic.gaps.length < 128) diagnostic.gaps.push(safe);
  }
}
function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function sameArray(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}
function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds <= 0) { if (signal.aborted) return Promise.reject(new Error("aborted")); return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new Error("aborted")); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
