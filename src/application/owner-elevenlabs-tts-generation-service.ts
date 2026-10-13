import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import {
  SyntxChatHttpClient,
  type MediaGenerationReceipt,
  type OwnerElevenLabsTtsChatContext,
  type OwnerElevenLabsTtsMessageCandidates
} from "../adapter/syntx/chat-http-client.js";
import type { OwnerElevenLabsAudioResult } from "../adapter/syntx/owner-elevenlabs-audio-result.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { AccountStatusService, type AccountStatusResult } from "./account-status.js";
import { ModelAccessService, type ModelAccessResult } from "./model-access.js";
import {
  OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION,
  OWNER_ELEVENLABS_GENERATION_SETTINGS_VERSION,
  OWNER_ELEVENLABS_TTS_MODEL_IDS,
  getOwnerElevenLabsGenerationParameterProfile,
  normalizeOwnerElevenLabsGenerationParameters,
  OwnerElevenLabsGenerationParametersError,
  type OwnerElevenLabsNormalizedTtsCandidate,
  type OwnerElevenLabsTtsModel,
  type OwnerElevenLabsTtsRequest
} from "./owner-elevenlabs-generation-parameters.js";
import { OwnerElevenLabsVoiceReferenceService } from "./owner-elevenlabs-voice-reference-service.js";
import { OwnerElevenLabsTtsRequestPreparer } from "./owner-elevenlabs-tts-request-preparer.js";
import { OwnerElevenLabsTtsOneShotPolicy } from "./owner-elevenlabs-tts-one-shot-policy.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_RECOVERY = /^elevenlabs_tts_recovery_[0-9a-f-]{36}$/u;
const MAX_PROMPT_UTF8_BYTES = 65_536;
const MAX_RECOVERIES = 128;
const MAX_CLIENTS = 128;
const MAX_RUNS = 4;
const MAX_RESULTS = 4_096;
const RESULT_PAGE_SIZE = 64;
const DEFAULT_TIMEOUT_MS = 120_000;
const ACCOUNT_METHOD = AccountStatusService.prototype.getAccountStatus;
const ACCESS_METHOD = ModelAccessService.prototype.getModelAccess;
const CHAT_CREATE = SyntxChatHttpClient.prototype.createOwnerElevenLabsTtsChat;
const TTS_START = SyntxChatHttpClient.prototype.startElevenLabsTtsWithOwnedCandidate;
const HISTORY_LIST = SyntxChatHttpClient.prototype.listOwnedElevenLabsTtsCandidates;
const AUDIO_RESULT = SyntxChatHttpClient.prototype.getOwnedElevenLabsTtsResult;
const TTS_SERVICES = new WeakSet<object>();

export type OwnerElevenLabsTtsGenerationPhase =
  | "VALIDATE_REQUEST" | "RESOLVE_PRINCIPAL" | "PREPARE_CANDIDATE" | "PREFLIGHT" | "CHAT_CREATE"
  | "GENERATION_POST" | "POST_ACK_KNOWN" | "HISTORY_GET" | "RESULT_GET" | "RESULT_BINDING";

export interface OwnerElevenLabsTtsGenerationDiagnostic {
  readonly phase: OwnerElevenLabsTtsGenerationPhase;
  readonly post_started: boolean;
  readonly ack_known: boolean;
  readonly history_status: "NOT_READ" | "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly history_get_calls: number;
  readonly result_get_calls: number;
  readonly result_status: "NOT_READ" | "PENDING" | "PARTIAL" | "COMPLETE" | "UNVERIFIED";
  readonly result_gaps: readonly string[];
}

export interface OwnerElevenLabsTtsAudioArtifact {
  readonly url: string;
  readonly mime_type: "audio/mpeg" | "audio/wav" | "audio/mp4" | null;
  readonly mime_source: "URL_EXTENSION_LOCAL_POLICY" | "UNKNOWN";
  readonly message_id: string;
  readonly message_object_id: string;
  readonly object_index: number;
  readonly object_type: "audio";
  readonly model_echo: "MATCHED" | "UNKNOWN";
}

export interface OwnerElevenLabsTtsGenerationResult {
  readonly status: "completed" | "partial_results";
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly backend_acceptance: "UNPROVEN";
  readonly provider_terminal_status: "UNPROVEN";
  readonly model_id: OwnerElevenLabsTtsModel;
  readonly parameters: Readonly<{ mode: "text_to_speech"; chars_count: number; stability: number;
    similarity_boost: number; language_code?: "auto" }>;
  readonly source_binding: Readonly<{ public_catalog_version: typeof OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION;
    settings_inventory_version: typeof OWNER_ELEVENLABS_GENERATION_SETTINGS_VERSION }>;
  readonly recovery_id: string;
  readonly observed_artifact_count: number;
  readonly offset: number;
  readonly page_size: 64;
  readonly artifacts: readonly OwnerElevenLabsTtsAudioArtifact[];
  readonly has_more: boolean;
  readonly next_offset: number | null;
  readonly diagnostic: OwnerElevenLabsTtsGenerationDiagnostic;
}

export interface OwnerElevenLabsTtsRecoveryListItem {
  readonly recovery_id: string;
  readonly created_at: string;
  readonly model_id: OwnerElevenLabsTtsModel;
  readonly status: "outcome_unknown" | "partial_results";
  readonly observed_artifact_count: number;
  readonly diagnostic: OwnerElevenLabsTtsGenerationDiagnostic;
}

export type OwnerElevenLabsTtsGenerationServiceErrorCode =
  | "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH"
  | "PREFLIGHT_FAILED" | "INTENT_ALREADY_CLAIMED" | "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND";

export class OwnerElevenLabsTtsGenerationServiceError extends Error {
  readonly diagnostic?: OwnerElevenLabsTtsGenerationDiagnostic;
  constructor(readonly code: OwnerElevenLabsTtsGenerationServiceErrorCode, readonly recovery_id?: string,
    diagnostic?: OwnerElevenLabsTtsGenerationDiagnostic) {
    super(code === "OUTCOME_UNKNOWN"
      ? "The ElevenLabs TTS request may have been dispatched; reconcile its private recovery and do not retry."
      : "The owner ElevenLabs TTS request could not be completed safely.");
    this.name = "OwnerElevenLabsTtsGenerationServiceError";
    if (code === "OUTCOME_UNKNOWN" && diagnostic) this.diagnostic = diagnostic;
  }
}

export interface OwnerElevenLabsTtsGenerationServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string;
  readonly voiceReferenceService: OwnerElevenLabsVoiceReferenceService;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly createAccountStatusService: (attemptId: string) => AccountStatusService;
  readonly createModelAccessService: (attemptId: string) => ModelAccessService;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

export interface OwnerElevenLabsTtsGenerateInput { readonly attemptId: string; readonly request: OwnerElevenLabsTtsRequest; }
export interface OwnerElevenLabsTtsReconcileInput { readonly attemptId: string; readonly recovery_id: string; }
export interface OwnerElevenLabsTtsRecoveryListInput { readonly attemptId: string; readonly limit?: number; }
export interface OwnerElevenLabsTtsResultPageInput { readonly attemptId: string; readonly recovery_id: string; readonly offset?: number; }

interface MutableDiagnostic {
  phase: OwnerElevenLabsTtsGenerationPhase; post_started: boolean; ack_known: boolean;
  history_status: OwnerElevenLabsTtsGenerationDiagnostic["history_status"]; history_get_calls: number;
  result_get_calls: number; result_status: OwnerElevenLabsTtsGenerationDiagnostic["result_status"]; result_gaps: string[];
}
interface Recovery {
  readonly recovery_id: string; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly normalized: OwnerElevenLabsNormalizedTtsCandidate; readonly semantic_key: string; readonly input_key: string;
  readonly created_at: string; readonly chat: OwnerElevenLabsTtsChatContext; readonly candidate: object; readonly permit: object;
  readonly model_id: OwnerElevenLabsTtsModel; owner_echo_message_id: string | null;
  status: "outcome_unknown" | "partial_results" | "completed"; artifacts: readonly OwnerElevenLabsTtsAudioArtifact[];
  readonly diagnostic: MutableDiagnostic;
}
interface ActiveRun { readonly attemptId: string; readonly controller: AbortController; promise: Promise<unknown>; }

/** Owner-only TTS dispatch with one-shot POST and process-local, GET-only recovery. */
export class OwnerElevenLabsTtsGenerationService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #catalogVersion: string;
  readonly #voiceReferenceService: OwnerElevenLabsVoiceReferenceService;
  readonly #resolveChatClient: OwnerElevenLabsTtsGenerationServiceOptions["resolveChatClient"];
  readonly #createAccountStatusService: OwnerElevenLabsTtsGenerationServiceOptions["createAccountStatusService"];
  readonly #createModelAccessService: OwnerElevenLabsTtsGenerationServiceOptions["createModelAccessService"];
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #preparer: OwnerElevenLabsTtsRequestPreparer;
  readonly #oneShotPolicy: OwnerElevenLabsTtsOneShotPolicy;
  readonly #recoveries = new Map<string, Recovery>();
  readonly #intentToRecovery = new Map<string, string>();
  readonly #inputToRecovery = new Map<string, string>();
  readonly #reservedIntentKeys = new Set<string>();
  readonly #reservedInputKeys = new Set<string>();
  readonly #clientsByAttempt = new Map<string, SyntxChatHttpClient>();
  readonly #usedAccountServices = new WeakSet<object>();
  readonly #usedAccessServices = new WeakSet<object>();
  readonly #runs = new Set<ActiveRun>();
  readonly #invalidatingAttempts = new Set<string>();
  #closed = false;
  #closing: Promise<void> | undefined;
  #lastNow = -1;

  constructor(optionsInput: OwnerElevenLabsTtsGenerationServiceOptions | unknown) {
    if (new.target !== OwnerElevenLabsTtsGenerationService) invalid();
    const options = exactRecord(optionsInput, ["binding", "linkService", "catalog", "catalog_version", "voiceReferenceService",
      "resolveChatClient", "createAccountStatusService", "createModelAccessService"], ["now", "timeoutMs"]);
    this.#binding = snapshotBinding(options.binding);
    this.#linkService = snapshotLinkService(options.linkService);
    if (!isExactInstance(options.catalog, DiscoveryCatalogRepository) ||
        options.catalog_version !== OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION ||
        !isExactService(options.voiceReferenceService, OwnerElevenLabsVoiceReferenceService,
          ["listVoices", "resolveVoice", "isOwnedVoiceResolution", "invalidateAttempt", "close"]) ||
        typeof options.resolveChatClient !== "function" || types.isProxy(options.resolveChatClient) ||
        typeof options.createAccountStatusService !== "function" || types.isProxy(options.createAccountStatusService) ||
        typeof options.createModelAccessService !== "function" || types.isProxy(options.createModelAccessService)) invalid();
    this.#catalog = options.catalog;
    this.#catalogVersion = options.catalog_version;
    this.#voiceReferenceService = options.voiceReferenceService as OwnerElevenLabsVoiceReferenceService;
    this.#resolveChatClient = options.resolveChatClient as OwnerElevenLabsTtsGenerationServiceOptions["resolveChatClient"];
    this.#createAccountStatusService = options.createAccountStatusService as OwnerElevenLabsTtsGenerationServiceOptions["createAccountStatusService"];
    this.#createModelAccessService = options.createModelAccessService as OwnerElevenLabsTtsGenerationServiceOptions["createModelAccessService"];
    this.#now = readClockFactory(options.now);
    this.#timeoutMs = bounded(options.timeoutMs, 1_000, 5 * 60_000, DEFAULT_TIMEOUT_MS);
    this.#assertSourceBinding();
    this.#preparer = new OwnerElevenLabsTtsRequestPreparer({ voiceReferenceService: this.#voiceReferenceService, now: this.#now });
    this.#oneShotPolicy = new OwnerElevenLabsTtsOneShotPolicy({ preparer: this.#preparer, now: this.#now });
    TTS_SERVICES.add(this);
    Object.freeze(this);
  }

  async generate(input: OwnerElevenLabsTtsGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerElevenLabsTtsGenerationResult> {
    const request = snapshotGenerate(input);
    return await this.#run(request.attemptId, signal, (runSignal) => this.#generate(request, runSignal));
  }

  async reconcile(input: OwnerElevenLabsTtsReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerElevenLabsTtsGenerationResult> {
    const request = snapshotReconcile(input);
    if (this.#invalidatingAttempts.has(request.attemptId)) {
      const recovery = this.#recoveries.get(request.recovery_id);
      if (recovery?.attemptId === request.attemptId && recovery.status === "outcome_unknown") throw unknownError(recovery);
      fail("RECOVERY_NOT_FOUND");
    }
    return await this.#run(request.attemptId, signal, (runSignal) => this.#reconcile(request, runSignal));
  }

  async listRecoveries(input: OwnerElevenLabsTtsRecoveryListInput | unknown): Promise<readonly OwnerElevenLabsTtsRecoveryListItem[]> {
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

  async getResultPage(input: OwnerElevenLabsTtsResultPageInput | unknown): Promise<OwnerElevenLabsTtsGenerationResult> {
    this.#assertOpen();
    const request = snapshotResultPage(input);
    return await this.#run(request.attemptId, undefined, async () => {
      const principal = await this.#resolvePrincipal(request.attemptId);
      const recovery = this.#recoveries.get(request.recovery_id);
      if (this.#invalidatingAttempts.has(request.attemptId) || !recovery || recovery.attemptId !== request.attemptId ||
          !sameGenerationPrincipal(recovery.principal, principal)) fail("RECOVERY_NOT_FOUND");
      if (recovery.status === "outcome_unknown") throw unknownError(recovery);
      return pageResult(recovery, request.offset);
    });
  }

  async invalidateAttempt(attemptIdInput: unknown): Promise<void> {
    const attemptId = safeAttempt(attemptIdInput);
    this.#invalidatingAttempts.add(attemptId);
    this.#preparer.invalidateAttempt(attemptId);
    this.#oneShotPolicy.invalidateAttempt(attemptId);
    const active = [...this.#runs].filter((run) => run.attemptId === attemptId);
    for (const run of active) run.controller.abort();
    await Promise.allSettled(active.map((run) => run.promise));
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const run of this.#runs) run.controller.abort();
    for (const attemptId of new Set([...this.#runs].map((run) => run.attemptId))) {
      this.#preparer.invalidateAttempt(attemptId);
      this.#oneShotPolicy.invalidateAttempt(attemptId);
    }
    this.#closing = (async () => {
      await Promise.allSettled([...this.#runs].map((run) => run.promise));
      this.#oneShotPolicy.close();
      this.#preparer.close();
      // Keep dispatch ledgers and semantic claims intact; closing the service is not evidence that an unknown POST was absent.
      this.#reservedIntentKeys.clear(); this.#reservedInputKeys.clear(); this.#clientsByAttempt.clear();
      this.#runs.clear(); this.#invalidatingAttempts.clear();
    })();
    return this.#closing;
  }

  async #generate(request: Readonly<OwnerElevenLabsTtsGenerateInput>, signal: AbortSignal): Promise<OwnerElevenLabsTtsGenerationResult> {
    const deadline = this.#deadline(signal, () => serviceError("PRE_DISPATCH_FAILED"));
    let inputKey: string | undefined;
    let semanticKey: string | undefined;
    let recovery: Recovery | undefined;
    let postStarted = false;
    let candidate: Awaited<ReturnType<OwnerElevenLabsTtsRequestPreparer["prepare"]>> | undefined;
    let permit: ReturnType<OwnerElevenLabsTtsOneShotPolicy["createPermit"]> | undefined;
    try {
      deadline.throwIfAborted();
      const normalized = normalizeOwnerElevenLabsGenerationParameters(request.request);
      if (normalized.mode !== "text_to_speech") invalid();
      validateLocalPromptResourceLimit(normalized.prompt);
      this.#validateModelProfile(normalized.model_id);
      this.#assertSourceBinding();
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      inputKey = inputIntentKey(principal, normalized);
      const oldId = this.#inputToRecovery.get(inputKey);
      if (oldId) {
        const old = this.#recoveries.get(oldId);
        if (!old) fail("INTENT_ALREADY_CLAIMED");
        if (old.attemptId !== request.attemptId || !sameGenerationPrincipal(old.principal, principal)) fail("INTENT_ALREADY_CLAIMED");
        if (old.status === "outcome_unknown") fail("INTENT_ALREADY_CLAIMED");
        return pageResult(old, 0);
      }
      if (this.#reservedInputKeys.has(inputKey)) fail("SERVICE_BUSY");
      if (this.#recoveries.size + this.#reservedInputKeys.size >= MAX_RECOVERIES) fail("SERVICE_BUSY");
      this.#reservedInputKeys.add(inputKey);

      candidate = await this.#await(deadline, () => this.#preparer.prepare({ attemptId: request.attemptId, principal,
        request: normalizedRequest(normalized) }));
      semanticKey = semanticIntentKey(principal, candidate.intent_fingerprint);
      const existingId = this.#intentToRecovery.get(semanticKey);
      if (existingId) {
        const existing = this.#recoveries.get(existingId);
        if (!existing) fail("INTENT_ALREADY_CLAIMED");
        if (existing.attemptId !== request.attemptId || !sameGenerationPrincipal(existing.principal, principal)) fail("INTENT_ALREADY_CLAIMED");
        if (existing.status === "outcome_unknown") fail("INTENT_ALREADY_CLAIMED");
        return pageResult(existing, 0);
      }
      if (this.#reservedIntentKeys.has(semanticKey)) fail("SERVICE_BUSY");
      this.#reservedIntentKeys.add(semanticKey);
      permit = this.#oneShotPolicy.createPermit({ candidate, attemptId: request.attemptId, principal });
      await this.#runPreflight(request.attemptId, normalized, deadline);
      const client = this.#resolveNativeClient(request.attemptId);
      deadline.throwIfAborted();
      const chat = await this.#await(deadline, () => {
        return (Reflect.apply(CHAT_CREATE, client, [Object.freeze({ candidate, permit, preparer: this.#preparer,
          oneShotPolicy: this.#oneShotPolicy, principal, attemptId: request.attemptId }), deadline.signal]) as Promise<OwnerElevenLabsTtsChatContext>);
      });
      if (!isSafeId(chat.chat_uuid)) fail("PRE_DISPATCH_FAILED");

      const principalAfterChat = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      if (!sameGenerationPrincipal(principal, principalAfterChat) || this.#invalidatingAttempts.has(request.attemptId)) fail("PRINCIPAL_NOT_LINKED");
      this.#validateModelProfile(normalized.model_id);
      await this.#runPreflight(request.attemptId, normalized, deadline);
      const principalBeforePost = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      if (!sameGenerationPrincipal(principal, principalBeforePost) || this.#invalidatingAttempts.has(request.attemptId)) fail("PRINCIPAL_NOT_LINKED");
      this.#preparer.revalidateCandidate({ candidate, attemptId: request.attemptId, principal });
      this.#oneShotPolicy.revalidate({ candidate, permit, attemptId: request.attemptId, principal });

      const now = this.#readNow();
      recovery = createRecovery({ attemptId: request.attemptId, principal, normalized, semanticKey,
        inputKey, chat, candidate, permit, now });
      this.#recoveries.set(recovery.recovery_id, recovery);
      this.#intentToRecovery.set(semanticKey, recovery.recovery_id);
      this.#inputToRecovery.set(inputKey, recovery.recovery_id);
      this.#reservedIntentKeys.delete(semanticKey); semanticKey = undefined;
      this.#reservedInputKeys.delete(inputKey); inputKey = undefined;

      recovery.diagnostic.phase = "GENERATION_POST";
      recovery.diagnostic.post_started = true;
      postStarted = true;
      const receipt = await this.#await(deadline, () => {
        return (Reflect.apply(TTS_START, client, [Object.freeze({ chat, candidate: candidate!, permit: permit!,
          preparer: this.#preparer, oneShotPolicy: this.#oneShotPolicy, principal, attemptId: request.attemptId }), deadline.signal]) as Promise<MediaGenerationReceipt>);
      });
      if (!validReceipt(receipt, chat.chat_uuid)) throw unknownError(recovery);
      recovery.owner_echo_message_id = receipt.message_id;
      recovery.diagnostic.ack_known = true;
      recovery.diagnostic.phase = "POST_ACK_KNOWN";
      return await this.#observe(recovery, client, deadline);
    } catch (error) {
      if (postStarted && recovery) throw unknownError(recovery);
      if (inputKey) this.#reservedInputKeys.delete(inputKey);
      if (semanticKey) this.#reservedIntentKeys.delete(semanticKey);
      if (permit && candidate) {
        try { this.#oneShotPolicy.release({ candidate, permit, attemptId: request.attemptId,
          principal: candidate.principal }); } catch { /* A consumed or expired reservation is never made replayable here. */ }
      }
      if (error instanceof OwnerElevenLabsTtsGenerationServiceError) throw error;
      if (error instanceof OwnerElevenLabsGenerationParametersError) invalid();
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      return fail("PRE_DISPATCH_FAILED");
    } finally {
      if (inputKey) this.#reservedInputKeys.delete(inputKey);
      if (semanticKey) this.#reservedIntentKeys.delete(semanticKey);
      deadline.close();
    }
  }

  async #reconcile(request: Readonly<OwnerElevenLabsTtsReconcileInput>, signal: AbortSignal): Promise<OwnerElevenLabsTtsGenerationResult> {
    const recovery = this.#recoveries.get(request.recovery_id);
    if (!recovery || recovery.attemptId !== request.attemptId) fail("RECOVERY_NOT_FOUND");
    const deadline = this.#deadline(signal, () => unknownError(recovery));
    try {
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      if (!sameGenerationPrincipal(principal, recovery.principal) || this.#invalidatingAttempts.has(request.attemptId)) throw unknownError(recovery);
      if (recovery.status === "completed") return pageResult(recovery, 0);
      return await this.#observe(recovery, this.#resolveNativeClient(request.attemptId), deadline);
    } catch (error) {
      if (error instanceof OwnerElevenLabsTtsGenerationServiceError && error.code === "RECOVERY_NOT_FOUND") throw error;
      throw unknownError(recovery);
    } finally { deadline.close(); }
  }

  async #observe(recovery: Recovery, client: SyntxChatHttpClient, deadline: AbsoluteRequestDeadline): Promise<OwnerElevenLabsTtsGenerationResult> {
    deadline.throwIfAborted();
    if (this.#invalidatingAttempts.has(recovery.attemptId)) throw unknownError(recovery);
    const principal = await this.#await(deadline, () => this.#resolvePrincipal(recovery.attemptId));
    if (!sameGenerationPrincipal(principal, recovery.principal)) throw unknownError(recovery);
    recovery.diagnostic.phase = "HISTORY_GET";
    recovery.diagnostic.history_get_calls += 1;
    let history: OwnerElevenLabsTtsMessageCandidates;
    try {
      history = await this.#await(deadline, () => {
        return Reflect.apply(HISTORY_LIST, client, [recovery.chat, deadline.signal]) as Promise<OwnerElevenLabsTtsMessageCandidates>;
      });
    } catch { deadline.throwIfAborted(); recovery.diagnostic.history_status = "UNVERIFIED"; throw unknownError(recovery); }
    recovery.diagnostic.phase = "RESULT_BINDING";
    recovery.owner_echo_message_id = history.owner_echo_message_id ?? recovery.owner_echo_message_id;
    if (history.backend_acceptance !== "UNPROVEN" || history.owner_ack_status !== "MATCHED" ||
        history.history_binding_status !== "BOUND" || history.history_page_status !== "COMPLETE" ||
        history.status !== "COMPLETE") {
      recovery.diagnostic.history_status = history.status === "PENDING" ? "PENDING" :
        history.status === "INCOMPLETE" ? "INCOMPLETE" : "UNVERIFIED";
      recovery.diagnostic.result_status = "PENDING";
      recovery.diagnostic.result_gaps = [...history.gaps].slice(0, 32);
      throw unknownError(recovery);
    }
    recovery.diagnostic.history_status = "COMPLETE";
    if (history.contexts.length === 0) {
      recovery.diagnostic.result_status = "PENDING";
      recovery.diagnostic.result_gaps = [...history.gaps, "AUDIO_RESULT_NOT_YET_OBSERVED"].slice(0, 32);
      throw unknownError(recovery);
    }

    const observed: OwnerElevenLabsTtsAudioArtifact[] = [];
    let incomplete = history.gaps.length > 0;
    let modelEchoUnknown = false;
    const objectIds = new Set<string>();
    const urls = new Set<string>();
    for (const context of history.contexts) {
      recovery.diagnostic.phase = "RESULT_GET";
      recovery.diagnostic.result_get_calls += 1;
      let decoded: OwnerElevenLabsAudioResult;
      try {
        decoded = await this.#await(deadline, () => {
          return Reflect.apply(AUDIO_RESULT, client, [context, deadline.signal]) as Promise<OwnerElevenLabsAudioResult>;
        });
      } catch { deadline.throwIfAborted(); recovery.diagnostic.result_status = "UNVERIFIED"; throw unknownError(recovery); }
      if (decoded.message_binding !== "BOUND" || decoded.model_echo === "MISMATCH" || decoded.backend_acceptance !== "UNPROVEN") {
        recovery.diagnostic.result_status = "UNVERIFIED";
        recovery.diagnostic.result_gaps = [...decoded.gaps.map((gap) => gap.code), "AUDIO_RESULT_BINDING_UNVERIFIED"].slice(0, 32);
        throw unknownError(recovery);
      }
      if (decoded.model_echo === "UNKNOWN") modelEchoUnknown = true;
      const expectedIds = new Set(context.message_object_ids);
      if (decoded.ready_audio.length !== expectedIds.size) incomplete = true;
      for (const audio of decoded.ready_audio) {
        if (audio.object_type !== "audio" || !expectedIds.has(audio.message_object_id) ||
            context.message_object_ids[audio.object_index] !== audio.message_object_id ||
            !isSafeAudioArtifactUrl(audio.object_url) ||
            (audio.mime_type !== null && !["audio/mpeg", "audio/wav", "audio/mp4"].includes(audio.mime_type)) ||
            (audio.mime_source !== "UNKNOWN" && audio.mime_source !== "URL_EXTENSION_LOCAL_POLICY") ||
            objectIds.has(audio.message_object_id) || urls.has(audio.object_url)) {
          recovery.diagnostic.result_status = "UNVERIFIED";
          recovery.diagnostic.result_gaps = ["AUDIO_RESULT_PROJECTION_INVALID"];
          throw unknownError(recovery);
        }
        objectIds.add(audio.message_object_id); urls.add(audio.object_url);
        observed.push(Object.freeze({ url: audio.object_url, mime_type: audio.mime_type, mime_source: audio.mime_source,
          message_id: context.message_id, message_object_id: audio.message_object_id, object_index: audio.object_index,
          object_type: "audio", model_echo: decoded.model_echo === "MATCHED" ? "MATCHED" : "UNKNOWN" }));
      }
      const nonMimeGaps = decoded.gaps.filter((gap) => gap.code !== "MIME_TYPE_UNKNOWN");
      if (nonMimeGaps.length > 0) incomplete = true;
      recovery.diagnostic.result_gaps.push(...decoded.gaps.map((gap) => gap.code));
    }
    if (observed.length === 0 || observed.length > MAX_RESULTS) {
      recovery.diagnostic.result_status = observed.length > MAX_RESULTS ? "UNVERIFIED" : "PENDING";
      throw unknownError(recovery);
    }
    recovery.artifacts = Object.freeze(observed);
    recovery.status = incomplete || modelEchoUnknown ? "partial_results" : "completed";
    recovery.diagnostic.phase = "RESULT_BINDING";
    recovery.diagnostic.result_status = recovery.status === "completed" ? "COMPLETE" : "PARTIAL";
    recovery.diagnostic.result_gaps = recovery.diagnostic.result_gaps.slice(0, 32);
    return pageResult(recovery, 0);
  }

  async #runPreflight(attemptId: string, normalized: OwnerElevenLabsNormalizedTtsCandidate,
    deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted();
    let accountService: AccountStatusService;
    let accessService: ModelAccessService;
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
        model_id: normalized.model_id,
        cost_parameters: Object.freeze({ chars_count: normalized.settings_candidate.chars_count, mode: "text_to_speech" })
      }), deadline.signal]) as Promise<ModelAccessResult>);
    } catch { fail("PREFLIGHT_FAILED"); }
    assertFreshPreflight(account, access, normalized, this.#catalog, this.#readNow());
  }

  #assertSourceBinding(): ReturnType<typeof getOwnerElevenLabsGenerationParameterProfile> {
    let profile: ReturnType<typeof getOwnerElevenLabsGenerationParameterProfile>;
    try { profile = getOwnerElevenLabsGenerationParameterProfile(); } catch { fail("MODEL_BINDING_MISMATCH"); }
    if (this.#catalogVersion !== OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION ||
        profile.source_binding.public_catalog_version !== OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION ||
        profile.source_binding.settings_inventory_version !== OWNER_ELEVENLABS_GENERATION_SETTINGS_VERSION ||
        profile.source_binding.source_catalog_runtime_usable !== false || profile.runtime_usable !== false ||
        profile.dispatch_allowed !== false || profile.backend_acceptance !== "UNPROVEN") fail("MODEL_BINDING_MISMATCH");
    return profile;
  }

  #validateModelProfile(modelId: OwnerElevenLabsTtsModel): void {
    this.#assertSourceBinding();
    if (!(OWNER_ELEVENLABS_TTS_MODEL_IDS as readonly string[]).includes(modelId)) fail("MODEL_BINDING_MISMATCH");
    let model;
    try { model = this.#catalog.getModel(modelId); } catch { fail("MODEL_BINDING_MISMATCH"); }
    if (!model.active || model.id !== modelId || model.upstream_id !== modelId || model.ai_name !== "elevenlabs" ||
        !model.settings?.get_cost_params?.includes("chars_count") || !model.settings.get_cost_params.includes("mode")) fail("MODEL_BINDING_MISMATCH");
  }

  #resolveNativeClient(attemptId: string): SyntxChatHttpClient {
    const existing = this.#clientsByAttempt.get(attemptId);
    if (existing) return existing;
    if (this.#clientsByAttempt.size >= MAX_CLIENTS) fail("SERVICE_BUSY");
    let client: unknown;
    try { client = Reflect.apply(this.#resolveChatClient, undefined, [attemptId]); } catch { fail("PRE_DISPATCH_FAILED"); }
    if (!isExactInstance(client, SyntxChatHttpClient)) fail("PRE_DISPATCH_FAILED");
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

  #deadline(signal: AbortSignal, onAbort: () => Error): AbsoluteRequestDeadline {
    this.#assertOpen();
    return new AbsoluteRequestDeadline(this.#timeoutMs, signal, onAbort);
  }
  async #await<T>(deadline: AbsoluteRequestDeadline, operation: () => Promise<T>): Promise<T> {
    deadline.throwIfAborted();
    try { return await deadline.waitFor(operation()); } catch (error) { deadline.throwIfAborted(); throw error; }
  }
  async #run<T>(attemptId: string, parent: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.#assertOpen();
    if (this.#invalidatingAttempts.has(attemptId)) fail("PRINCIPAL_NOT_LINKED");
    if (this.#runs.size >= MAX_RUNS) fail("SERVICE_BUSY");
    if (parent !== undefined && (types.isProxy(parent) || !(parent instanceof AbortSignal))) invalid();
    const controller = new AbortController();
    const abortParent = () => controller.abort(parent?.reason);
    if (parent?.aborted) abortParent(); else parent?.addEventListener("abort", abortParent, { once: true });
    const run: ActiveRun = { attemptId, controller, promise: Promise.resolve() };
    const promise = operation(controller.signal);
    run.promise = promise;
    this.#runs.add(run);
    try { return await promise; }
    finally { parent?.removeEventListener("abort", abortParent); this.#runs.delete(run); }
  }
  #readNow(): number {
    let value: unknown;
    try { value = this.#now(); } catch { fail("SERVICE_BUSY"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) < this.#lastNow) fail("SERVICE_BUSY");
    this.#lastNow = value as number;
    return value as number;
  }
  #assertOpen(): void { if (this.#closed || !TTS_SERVICES.has(this)) fail("SERVICE_CLOSED"); }
}

export function isOwnerElevenLabsTtsGenerationService(value: unknown): value is OwnerElevenLabsTtsGenerationService {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && TTS_SERVICES.has(value) &&
    Object.getPrototypeOf(value) === OwnerElevenLabsTtsGenerationService.prototype; } catch { return false; }
}

function createRecovery(input: { attemptId: string; principal: Readonly<GenerationPrincipalRef>; normalized: OwnerElevenLabsNormalizedTtsCandidate;
  semanticKey: string; inputKey: string; chat: OwnerElevenLabsTtsChatContext; candidate: object; permit: object; now: number }): Recovery {
  if (!Number.isSafeInteger(input.now) || input.now > 8_640_000_000_000_000) fail("SERVICE_BUSY");
  const recoveryId = `elevenlabs_tts_recovery_${randomUUID()}`;
  const diagnostic: MutableDiagnostic = { phase: "CHAT_CREATE", post_started: false, ack_known: false,
    history_status: "NOT_READ", history_get_calls: 0, result_get_calls: 0, result_status: "NOT_READ", result_gaps: [] };
  return { recovery_id: recoveryId, attemptId: input.attemptId, principal: input.principal, normalized: input.normalized,
    semantic_key: input.semanticKey, input_key: input.inputKey, created_at: new Date(input.now).toISOString(), chat: input.chat,
    candidate: input.candidate, permit: input.permit, model_id: input.normalized.model_id, owner_echo_message_id: null,
    status: "outcome_unknown", artifacts: Object.freeze([]), diagnostic };
}

function pageResult(recovery: Recovery, offset: number): OwnerElevenLabsTtsGenerationResult {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_RESULTS) invalid();
  if (recovery.status === "outcome_unknown") throw unknownError(recovery);
  const artifacts = recovery.artifacts.slice(offset, offset + RESULT_PAGE_SIZE);
  const next = offset + artifacts.length;
  const params = recovery.normalized.settings_candidate;
  return Object.freeze({ status: recovery.status, status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", backend_acceptance: "UNPROVEN",
    provider_terminal_status: "UNPROVEN", model_id: recovery.model_id,
    parameters: Object.freeze({ mode: "text_to_speech", chars_count: params.chars_count, stability: params.stability,
      similarity_boost: params.similarity_boost, ...(params.language_code ? { language_code: params.language_code } : {}) }),
    source_binding: Object.freeze({ public_catalog_version: OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION,
      settings_inventory_version: OWNER_ELEVENLABS_GENERATION_SETTINGS_VERSION }),
    recovery_id: recovery.recovery_id, observed_artifact_count: recovery.artifacts.length, offset, page_size: RESULT_PAGE_SIZE,
    artifacts: Object.freeze(artifacts), has_more: next < recovery.artifacts.length, next_offset: next < recovery.artifacts.length ? next : null,
    diagnostic: snapshotDiagnostic(recovery.diagnostic) });
}

function snapshotDiagnostic(input: MutableDiagnostic): OwnerElevenLabsTtsGenerationDiagnostic {
  return Object.freeze({ phase: input.phase, post_started: input.post_started, ack_known: input.ack_known,
    history_status: input.history_status, history_get_calls: input.history_get_calls, result_get_calls: input.result_get_calls,
    result_status: input.result_status, result_gaps: Object.freeze(input.result_gaps.slice(0, 32)) });
}
function unknownError(recovery: Recovery): OwnerElevenLabsTtsGenerationServiceError {
  return serviceError("OUTCOME_UNKNOWN", recovery.recovery_id, snapshotDiagnostic(recovery.diagnostic));
}
function serviceError(code: OwnerElevenLabsTtsGenerationServiceErrorCode, recoveryId?: string,
  diagnostic?: OwnerElevenLabsTtsGenerationDiagnostic): OwnerElevenLabsTtsGenerationServiceError {
  return new OwnerElevenLabsTtsGenerationServiceError(code, recoveryId, diagnostic);
}

function snapshotGenerate(value: unknown): Readonly<OwnerElevenLabsTtsGenerateInput> {
  const fields = exactRecord(value, ["attemptId", "request"]);
  const attemptId = safeAttempt(fields.attemptId);
  try {
    const normalized = normalizeOwnerElevenLabsGenerationParameters(fields.request);
    if (normalized.mode !== "text_to_speech") invalid();
    return Object.freeze({ attemptId, request: normalizedRequest(normalized) });
  } catch (error) { if (error instanceof OwnerElevenLabsTtsGenerationServiceError) throw error; invalid(); }
}
function snapshotReconcile(value: unknown): Readonly<OwnerElevenLabsTtsReconcileInput> {
  const fields = exactRecord(value, ["attemptId", "recovery_id"]);
  const attemptId = safeAttempt(fields.attemptId);
  if (typeof fields.recovery_id !== "string" || !SAFE_RECOVERY.test(fields.recovery_id)) invalid();
  return Object.freeze({ attemptId, recovery_id: fields.recovery_id });
}
function snapshotRecoveryList(value: unknown): { attemptId: string; limit: number } {
  const fields = exactRecord(value, ["attemptId"], ["limit"]);
  return { attemptId: safeAttempt(fields.attemptId), limit: bounded(fields.limit, 1, MAX_RECOVERIES, 32) };
}
function snapshotResultPage(value: unknown): { attemptId: string; recovery_id: string; offset: number } {
  const fields = exactRecord(value, ["attemptId", "recovery_id"], ["offset"]);
  const attemptId = safeAttempt(fields.attemptId);
  if (typeof fields.recovery_id !== "string" || !SAFE_RECOVERY.test(fields.recovery_id)) invalid();
  return { attemptId, recovery_id: fields.recovery_id, offset: bounded(fields.offset, 0, MAX_RESULTS, 0) };
}
function normalizedRequest(normalized: OwnerElevenLabsNormalizedTtsCandidate): OwnerElevenLabsTtsRequest {
  const settings = normalized.settings_candidate;
  if (typeof settings.voice_ref !== "string") invalid();
  return Object.freeze({ model_id: normalized.model_id, mode: "text_to_speech", prompt: normalized.prompt,
    voice_ref: settings.voice_ref as OwnerElevenLabsTtsRequest["voice_ref"], stability: settings.stability,
    similarity_boost: settings.similarity_boost, ...(settings.language_code ? { language_code: settings.language_code } : {}) });
}
function inputIntentKey(principal: Readonly<GenerationPrincipalRef>, normalized: OwnerElevenLabsNormalizedTtsCandidate): string {
  const settings = normalized.settings_candidate;
  return hash(JSON.stringify([principal.tenant_id, principal.subject_id, normalized.model_id, normalized.prompt,
    settings.voice_ref, settings.stability, settings.similarity_boost, settings.language_code ?? null]));
}
function semanticIntentKey(principal: Readonly<GenerationPrincipalRef>, fingerprint: string): string {
  return hash(JSON.stringify([principal.tenant_id, principal.subject_id, fingerprint]));
}
function hash(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function validateLocalPromptResourceLimit(prompt: string): void { if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_UTF8_BYTES) invalid(); }
function validReceipt(value: unknown, chatUuid: string): value is MediaGenerationReceipt {
  try { const row = exactRecord(value, ["chat_uuid", "message_id"]); return row.chat_uuid === chatUuid && isSafeId(row.message_id); }
  catch { return false; }
}
function assertFreshPreflight(accountInput: unknown, accessInput: unknown, normalized: OwnerElevenLabsNormalizedTtsCandidate,
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
        access.model_id !== normalized.model_id || access.ai_name !== "elevenlabs" || access.model_type !== normalized.model_id ||
        access.account_read_live !== true || access.access !== true || access.parameters_redacted !== true ||
        keys.length !== 2 || keys[0] !== "chars_count" || keys[1] !== "mode" || !isFreshIso(access.observed_at, now) ||
        !nullableFinite(access.cost) || !nullableFinite(access.discount_cost) ||
        !(access.free_remaining_generations === null || nonnegativeInteger(access.free_remaining_generations)) ||
        !nullableFinite(access.limit) || !(access.show_warning === null || typeof access.show_warning === "boolean")) fail("PREFLIGHT_FAILED");
  } catch (error) { if (error instanceof OwnerElevenLabsTtsGenerationServiceError) throw error; fail("PREFLIGHT_FAILED"); }
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
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= now + 30_000 && parsed >= now - 5 * 60_000;
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
function isSafeAudioArtifactUrl(value: string): boolean {
  if (!value || value.length > 8_192) return false;
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "r2.syntx.ai" && !url.port &&
    !url.username && !url.password && !url.hash; } catch { return false; }
}
function isExactService<T extends object>(value: unknown, ctor: new (...args: never[]) => T, methods: readonly string[]): value is T {
  if (!isExactInstance(value, ctor)) return false;
  return methods.every((method) => typeof Reflect.get(ctor.prototype, method) === "function" &&
    !Object.hasOwn(value, method) && Reflect.get(value, method) === Reflect.get(ctor.prototype, method));
}
function isExactInstance<T extends object>(value: unknown, ctor: new (...args: never[]) => T): value is T {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && value instanceof ctor && Object.getPrototypeOf(value) === ctor.prototype; }
  catch { return false; }
}
function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || !fields.tenant_id.trim() || fields.tenant_id.length > 256 ||
      typeof fields.subject !== "string" || !fields.subject.trim() || fields.subject.length > 512 ||
      /[\u0000-\u001f\u007f]/u.test(fields.tenant_id) || /[\u0000-\u001f\u007f]/u.test(fields.subject)) invalid();
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}
function snapshotLinkService(value: unknown): Pick<PerUserLinkService, "getStatus"> {
  if (!isExactService(value, PerUserLinkService, ["getStatus"])) invalid();
  return value;
}
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  let proto: object | null; let descriptors: PropertyDescriptorMap;
  try { proto = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); } catch { invalid(); }
  if (proto !== Object.prototype && proto !== null) invalid();
  const keys = Reflect.ownKeys(descriptors);
  if (required.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) => typeof key !== "string" ||
      (!required.includes(key) && !optional.includes(key)) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
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
function safeAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) invalid(); return value; }
function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function invalid(): never { fail("INVALID_REQUEST"); }
function fail(code: OwnerElevenLabsTtsGenerationServiceErrorCode): never { throw serviceError(code); }
