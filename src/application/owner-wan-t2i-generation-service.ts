import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import {
  SyntxChatHttpClient,
  type ChatMessageHistorySnapshot,
  type MediaGenerationReceipt
} from "../adapter/syntx/chat-http-client.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { AccountStatusService, type AccountStatusResult } from "./account-status.js";
import { ModelAccessService, type ModelAccessResult } from "./model-access.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import {
  normalizeOwnerWanT2iParameters,
  OwnerWanT2iParametersError,
  type OwnerWanT2iModel,
  type OwnerWanT2iParametersInput
} from "./owner-wan-t2i-parameters.js";
import {
  OwnerWanT2iRequestPreparer,
  OwnerWanT2iRequestPrepareError,
  type OwnerWanT2iPreparedCandidate
} from "./owner-wan-t2i-request-preparer.js";
import {
  getOwnerWanT2iSourceProfile,
  OwnerWanT2iSourceProfileError,
  type OwnerWanT2iSourceProfile
} from "./owner-wan-t2i-source-profile.js";
import {
  createOwnerWanT2iOneShotPermit,
  OwnerWanT2iOneShotPolicyError
} from "./owner-wan-t2i-one-shot-policy.js";
import {
  correlateOwnerWanT2iHistoryBinding,
  type OwnerWanT2iHistoryBindingReason,
  type OwnerWanT2iHistoryProfileBinding,
  type OwnerWanT2iResultReadContext
} from "./owner-wan-t2i-history-binding.js";
import type {
  InternalOwnerWanT2iImageArtifact,
  InternalOwnerWanT2iImageResult,
  OwnerWanT2iImageResultUnverifiedReason
} from "../adapter/syntx/owner-wan-t2i-result.js";

const MODEL_IDS = Object.freeze(["wan_25_t2i_preview", "wan_26_t2i"] as const);
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MAX_RUNS = 4;
const MAX_STATE_ENTRIES = 128;
const RECOVERY_TTL_MS = 15 * 60_000;
const MAX_CLOCK_SKEW_MS = 30_000;
const ACCOUNT_METHOD = AccountStatusService.prototype.getAccountStatus;
const ACCESS_METHOD = ModelAccessService.prototype.getModelAccess;
const CHAT_CREATE = SyntxChatHttpClient.prototype.createChat;
const NATIVE_START = SyntxChatHttpClient.prototype.startWanT2iImageWithOwnedCandidate;
const NATIVE_HISTORY = SyntxChatHttpClient.prototype.listMessageCandidates;
const NATIVE_RESULT = SyntxChatHttpClient.prototype.getWanT2iImageResult;
const PREPARE = OwnerWanT2iRequestPreparer.prototype.prepare;
const CANDIDATE_GUARD = OwnerWanT2iRequestPreparer.prototype.isPreparedCandidateForPrincipal;
const PREPARER_INVALIDATE = OwnerWanT2iRequestPreparer.prototype.invalidateAttempt;
const PREPARER_CLOSE = OwnerWanT2iRequestPreparer.prototype.close;

export type OwnerWanT2iGenerationPhase =
  | "REQUEST_PREPARE" | "PREFLIGHT" | "CHAT_CREATE" | "GENERATION_POST" | "POST_ACK_KNOWN"
  | "HISTORY_GET" | "HISTORY_BINDING" | "RESULT_GET" | "RESULT_BINDING" | "RESULT_WAIT";
export const OWNER_WAN_T2I_GENERATION_PHASES = Object.freeze([
  "REQUEST_PREPARE", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST", "POST_ACK_KNOWN",
  "HISTORY_GET", "HISTORY_BINDING", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"
] as const satisfies readonly OwnerWanT2iGenerationPhase[]);
type MissingPhase = Exclude<OwnerWanT2iGenerationPhase, typeof OWNER_WAN_T2I_GENERATION_PHASES[number]>;
const ALL_PHASES_PRESENT: MissingPhase extends never ? true : false = true;
void ALL_PHASES_PRESENT;

export type OwnerWanT2iHistoryDiagnosticReason = OwnerWanT2iHistoryBindingReason | "OUTPUT_BATCH_PARTIAL" |
  "RESULT_MESSAGE_NOT_FOUND" | "RESULT_OBJECT_IDS_NOT_OBSERVED";
export const OWNER_WAN_T2I_GENERATION_HISTORY_REASONS = Object.freeze([
  "INVALID_INPUT", "PROFILE_BINDING_INVALID", "HISTORY_SHAPE_INVALID", "HISTORY_INCOMPLETE", "CHAT_SCOPE_MISMATCH",
  "PROVIDER_CHAT_INVALID", "HISTORY_MESSAGE_SET_INVALID", "MESSAGE_ID_INVALID", "MESSAGE_ID_DUPLICATE",
  "MESSAGE_CHAT_MISMATCH", "OBJECT_ID_INVALID", "OBJECT_ID_DUPLICATE", "OWNER_ACK_NOT_FOUND", "OWNER_ACK_AMBIGUOUS",
  "OWNER_MEDIA_REFERENCES_NOT_SUPPORTED", "RESULT_OBJECTS_INVALID", "RESULT_OBJECTS_OVER_LIMIT", "REQUESTED_BATCH_INVALID",
  "OUTPUT_BATCH_PARTIAL", "RESULT_MESSAGE_NOT_FOUND", "RESULT_OBJECT_IDS_NOT_OBSERVED"
] as const satisfies readonly OwnerWanT2iHistoryDiagnosticReason[]);
type MissingHistoryReason = Exclude<OwnerWanT2iHistoryDiagnosticReason, typeof OWNER_WAN_T2I_GENERATION_HISTORY_REASONS[number]>;
const ALL_HISTORY_REASONS_PRESENT: MissingHistoryReason extends never ? true : false = true;
void ALL_HISTORY_REASONS_PRESENT;

export type OwnerWanT2iResultDiagnosticReason = OwnerWanT2iImageResultUnverifiedReason |
  "NO_RESULT_OBJECTS" | "NO_COMPLETED_RESULT_OBJECTS" | "OBSERVED_RESULTS_PARTIAL" | "RESULT_URI_PENDING" | "RESULT_OBJECTS_PENDING" |
  "OUTPUT_BATCH_PARTIAL";
export const OWNER_WAN_T2I_GENERATION_RESULT_REASONS = Object.freeze([
  "RESPONSE_SHAPE_INVALID", "OUTER_MESSAGE_MISMATCH", "PROVIDER_CHAT_MISMATCH", "NOT_BOT_MESSAGE", "OBJECT_ID_MISMATCH",
  "DUPLICATE_RESULT_OBJECT_ID", "OBJECT_MESSAGE_MISMATCH", "OBJECT_TYPE_MISMATCH", "MODEL_TYPE_UNAVAILABLE",
  "MODEL_TYPE_MISMATCH", "RESULT_COMPLETED_FLAG_INVALID", "RESULT_URL_UNSAFE", "EXTRANEOUS_RESULT_OBJECTS",
  "NO_RESULT_OBJECTS", "NO_COMPLETED_RESULT_OBJECTS", "OBSERVED_RESULTS_PARTIAL", "RESULT_URI_PENDING", "RESULT_OBJECTS_PENDING",
  "OUTPUT_BATCH_PARTIAL"
] as const satisfies readonly OwnerWanT2iResultDiagnosticReason[]);
type MissingResultReason = Exclude<OwnerWanT2iResultDiagnosticReason, typeof OWNER_WAN_T2I_GENERATION_RESULT_REASONS[number]>;
const ALL_RESULT_REASONS_PRESENT: MissingResultReason extends never ? true : false = true;
void ALL_RESULT_REASONS_PRESENT;

export interface OwnerWanT2iGenerationDiagnostic {
  readonly phase: OwnerWanT2iGenerationPhase;
  readonly post_started: boolean;
  readonly echo_ack_known: boolean;
  readonly history_status: "NONE" | "PENDING" | "READY" | "UNVERIFIED";
  readonly history_reason: OwnerWanT2iHistoryDiagnosticReason | null;
  readonly result_status: "NOT_READ" | "PENDING" | "PARTIAL" | "COMPLETE" | "UNVERIFIED";
  readonly result_reason: OwnerWanT2iResultDiagnosticReason | null;
  readonly history_get_calls: number;
  readonly history_get_calls_saturated: boolean;
  readonly result_get_calls: number;
  readonly result_get_calls_saturated: boolean;
}

export interface OwnerWanT2iGenerationResult {
  readonly status: "result_observed" | "partial_results";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly provider_execution: false;
  readonly model_id: OwnerWanT2iModel;
  readonly profile_id: OwnerWanT2iSourceProfile["profile_id"];
  readonly profile_schema_hash: string;
  readonly catalog_version: OwnerWanT2iSourceProfile["public_catalog_version"];
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly parameters: OwnerWanT2iPreparedCandidate["parameters"];
  readonly cost_routing: OwnerWanT2iPreparedCandidate["cost_routing"];
  readonly cost_inputs: OwnerWanT2iPreparedCandidate["cost_inputs"];
  readonly cost_input_confidence: OwnerWanT2iPreparedCandidate["cost_input_confidence"];
  readonly source_projection_confidence: OwnerWanT2iPreparedCandidate["source_projection_confidence"];
  readonly requested_batch_size: OwnerWanT2iPreparedCandidate["parameters"]["batch_size"];
  readonly actual_result_count: number;
  readonly count_confidence: "CURRENT_MESSAGE_MATCHES_EXPLICIT_BATCH_NOT_PROVIDER_TERMINAL" | "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL";
  readonly provider_terminal_confidence: "UNPROVEN";
  readonly artifacts: readonly Readonly<InternalOwnerWanT2iImageArtifact>[];
  readonly recovery_id?: string;
}

export interface OwnerWanT2iRecoveryListItem {
  readonly recovery_id: string;
  readonly created_at: string;
  readonly model_id: OwnerWanT2iModel;
  readonly status: "OUTCOME_UNKNOWN";
  readonly diagnostic: OwnerWanT2iGenerationDiagnostic;
}

export type OwnerWanT2iGenerationServiceErrorCode =
  | "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "MODEL_BINDING_MISMATCH" | "PRINCIPAL_NOT_LINKED"
  | "PREFLIGHT_FAILED" | "INTENT_ALREADY_CLAIMED" | "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND";
export const OWNER_WAN_T2I_GENERATION_ERROR_CODES = Object.freeze([
  "INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "MODEL_BINDING_MISMATCH", "PRINCIPAL_NOT_LINKED",
  "PREFLIGHT_FAILED", "INTENT_ALREADY_CLAIMED", "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"
] as const satisfies readonly OwnerWanT2iGenerationServiceErrorCode[]);
type MissingError = Exclude<OwnerWanT2iGenerationServiceErrorCode, typeof OWNER_WAN_T2I_GENERATION_ERROR_CODES[number]>;
const ALL_ERROR_CODES_PRESENT: MissingError extends never ? true : false = true;
void ALL_ERROR_CODES_PRESENT;

export interface OwnerWanT2iGenerationServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string;
  readonly preparer: OwnerWanT2iRequestPreparer;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly createAccountStatusService: (attemptId: string) => AccountStatusService;
  readonly createModelAccessService: (attemptId: string) => ModelAccessService;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly pollDelayMs?: number;
  readonly maxPollAttempts?: number;
}
export interface OwnerWanT2iGenerateInput { readonly attemptId: string; readonly input: OwnerWanT2iParametersInput }
export interface OwnerWanT2iReconcileInput { readonly attemptId: string; readonly recovery_id: string }
export interface OwnerWanT2iRecoveryListInput { readonly attemptId: string; readonly limit?: number }

export class OwnerWanT2iGenerationServiceError extends Error {
  readonly diagnostic: OwnerWanT2iGenerationDiagnostic | undefined;
  constructor(readonly code: OwnerWanT2iGenerationServiceErrorCode, readonly recovery_id?: string,
    diagnostic?: OwnerWanT2iGenerationDiagnostic) {
    super(code === "OUTCOME_UNKNOWN" ? "The WAN T2I request may have been dispatched; reconcile its recovery and do not retry."
      : "The owner WAN T2I request could not be completed safely.");
    this.name = "OwnerWanT2iGenerationServiceError";
    this.diagnostic = code === "OUTCOME_UNKNOWN" && diagnostic ? diagnostic : undefined;
  }
}

interface MutableDiagnostic {
  phase: OwnerWanT2iGenerationPhase; post_started: boolean; echo_ack_known: boolean;
  history_status: OwnerWanT2iGenerationDiagnostic["history_status"];
  history_reason: OwnerWanT2iHistoryDiagnosticReason | null;
  result_status: OwnerWanT2iGenerationDiagnostic["result_status"];
  result_reason: OwnerWanT2iResultDiagnosticReason | null;
  history_get_calls: number; history_get_calls_saturated: boolean;
  result_get_calls: number; result_get_calls_saturated: boolean;
}
interface Recovery {
  readonly recovery_id: string; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly candidate: OwnerWanT2iPreparedCandidate; readonly profile: Readonly<OwnerWanT2iSourceProfile>;
  readonly chat_uuid: string; readonly created_at: string; readonly expires_at: number; readonly semantic_key: string;
  owner_echo_message_id: string | null; result_context: Readonly<OwnerWanT2iResultReadContext> | null;
  readonly observed_artifacts: Map<string, Readonly<InternalOwnerWanT2iImageArtifact>>; readonly diagnostic: MutableDiagnostic;
}
interface CachedResult { readonly result: OwnerWanT2iGenerationResult; readonly expires_at: number }
interface RunRequest { readonly attemptId: string; readonly input: Readonly<OwnerWanT2iParametersInput> }
interface Run { readonly attemptId: string; readonly controller: AbortController; readonly promise: Promise<unknown> }

/** One owner-bound source-shaped T2I request with two account reads and exactly one nominal native POST. */
export class OwnerWanT2iGenerationService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #catalogVersion: string;
  readonly #preparer: OwnerWanT2iRequestPreparer;
  readonly #resolveChatClient: OwnerWanT2iGenerationServiceOptions["resolveChatClient"];
  readonly #createAccountStatusService: OwnerWanT2iGenerationServiceOptions["createAccountStatusService"];
  readonly #createModelAccessService: OwnerWanT2iGenerationServiceOptions["createModelAccessService"];
  readonly #now: () => number; readonly #timeoutMs: number; readonly #pollDelayMs: number; readonly #maxPollAttempts: number;
  readonly #recoveries = new Map<string, Recovery>();
  readonly #unknownIntents = new Set<string>();
  readonly #reservedIntents = new Map<string, object>();
  readonly #successCache = new Map<string, CachedResult>();
  readonly #usedAccountServices = new WeakSet<object>(); readonly #usedAccessServices = new WeakSet<object>();
  readonly #runs = new Set<Run>(); readonly #controllersByAttempt = new Map<string, Set<AbortController>>();
  readonly #invalidatingAttempts = new Set<string>();
  #closed = false; #closing: Promise<void> | undefined; #lastNow = -1;

  constructor(optionsInput: OwnerWanT2iGenerationServiceOptions | unknown) {
    const options = exactRecord(optionsInput,
      ["binding", "linkService", "catalog", "catalog_version", "preparer", "resolveChatClient", "createAccountStatusService", "createModelAccessService"],
      ["now", "timeoutMs", "pollDelayMs", "maxPollAttempts"]);
    if (!(options.catalog instanceof DiscoveryCatalogRepository) || types.isProxy(options.catalog) ||
        Object.getPrototypeOf(options.catalog) !== DiscoveryCatalogRepository.prototype ||
        !isExactService(options.preparer, OwnerWanT2iRequestPreparer, ["prepare", "isPreparedCandidateForPrincipal", "invalidateAttempt", "close"]) ||
        typeof options.resolveChatClient !== "function" || types.isProxy(options.resolveChatClient) ||
        typeof options.createAccountStatusService !== "function" || types.isProxy(options.createAccountStatusService) ||
        typeof options.createModelAccessService !== "function" || types.isProxy(options.createModelAccessService) ||
        (options.now !== undefined && (typeof options.now !== "function" || types.isProxy(options.now)))) fail("INVALID_REQUEST");
    this.#binding = snapshotBinding(options.binding); this.#linkService = snapshotLinkService(options.linkService);
    if (options.catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION) fail("MODEL_BINDING_MISMATCH");
    this.#catalog = options.catalog; this.#catalogVersion = options.catalog_version; this.#preparer = options.preparer;
    this.#resolveChatClient = options.resolveChatClient as OwnerWanT2iGenerationServiceOptions["resolveChatClient"];
    this.#createAccountStatusService = options.createAccountStatusService as OwnerWanT2iGenerationServiceOptions["createAccountStatusService"];
    this.#createModelAccessService = options.createModelAccessService as OwnerWanT2iGenerationServiceOptions["createModelAccessService"];
    const clock = options.now === undefined ? Date.now : readClockFactory(options.now);
    this.#now = () => this.#readNowFrom(clock);
    this.#timeoutMs = bounded(options.timeoutMs, 1, 60_000, 30_000);
    this.#pollDelayMs = bounded(options.pollDelayMs, 0, 5_000, 250);
    this.#maxPollAttempts = bounded(options.maxPollAttempts, 1, 30, 8);
    this.#assertProfile("wan_25_t2i_preview"); this.#assertProfile("wan_26_t2i");
  }

  generate(input: OwnerWanT2iGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerWanT2iGenerationResult> {
    const request = snapshotGenerate(input);
    return this.#run(request.attemptId, signal, (runSignal) => this.#generate(request, runSignal));
  }

  reconcile(input: OwnerWanT2iReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerWanT2iGenerationResult> {
    const request = snapshotReconcile(input);
    return this.#run(request.attemptId, signal, (runSignal) => this.#reconcile(request, runSignal));
  }

  listRecoveries(input: OwnerWanT2iRecoveryListInput | unknown): Promise<readonly OwnerWanT2iRecoveryListItem[]> {
    const request = snapshotRecoveryList(input);
    return this.#run(request.attemptId, undefined, async (signal) => {
      const deadline = this.#deadline(signal);
      try {
        const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline.signal));
        this.#pruneRecoveries(this.#readNow());
        return Object.freeze([...this.#recoveries.values()]
          .filter((entry) => entry.attemptId === request.attemptId && sameGenerationPrincipal(entry.principal, principal))
          .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, request.limit)
          .map((entry) => Object.freeze({ recovery_id: entry.recovery_id, created_at: entry.created_at,
            model_id: entry.candidate.model_id, status: "OUTCOME_UNKNOWN" as const, diagnostic: snapshotDiagnostic(entry.diagnostic) })));
      } finally { deadline.close(); }
    });
  }

  async invalidateAttempt(attemptIdInput: unknown): Promise<void> {
    if (typeof attemptIdInput !== "string" || !ATTEMPT.test(attemptIdInput) || this.#closed || this.#invalidatingAttempts.has(attemptIdInput)) return;
    const attemptId = attemptIdInput; this.#invalidatingAttempts.add(attemptId);
    try {
      for (const controller of this.#controllersByAttempt.get(attemptId) ?? []) controller.abort();
      await Promise.allSettled([...this.#runs].filter((run) => run.attemptId === attemptId).map((run) => run.promise));
      await Reflect.apply(PREPARER_INVALIDATE, this.#preparer, [attemptId]);
      for (const [id, recovery] of this.#recoveries) if (recovery.attemptId === attemptId) this.#recoveries.delete(id);
      // Unknown semantic holds survive relink, recovery expiry, and candidate expiry until verified completion or close.
    } finally { this.#invalidatingAttempts.delete(attemptId); }
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const run of this.#runs) run.controller.abort();
    this.#closing = (async () => {
      await Promise.allSettled([...this.#runs].map((run) => run.promise));
      await Reflect.apply(PREPARER_CLOSE, this.#preparer, []);
      this.#recoveries.clear(); this.#successCache.clear(); this.#reservedIntents.clear(); this.#unknownIntents.clear();
      this.#runs.clear(); this.#controllersByAttempt.clear(); this.#invalidatingAttempts.clear();
    })();
    return this.#closing;
  }

  async #generate(request: RunRequest, signal: AbortSignal): Promise<OwnerWanT2iGenerationResult> {
    let semanticKey: string | undefined; let reservation: object | undefined; let recovery: Recovery | undefined; let postStarted = false;
    const deadline = this.#deadline(signal, () => recovery ? unknownError(recovery) : serviceError("PRE_DISPATCH_FAILED"));
    try {
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline.signal));
      const profile = this.#assertProfile(request.input.model_id);
      semanticKey = semanticIntentKey(principal, request.input, profile);
      const observedNow = this.#readNow(); this.#pruneSuccess(observedNow); this.#pruneRecoveries(observedNow);
      if (this.#unknownIntents.has(semanticKey)) fail("INTENT_ALREADY_CLAIMED");
      const cached = this.#successCache.get(semanticKey);
      if (cached && cached.expires_at > this.#readNow()) return cached.result;
      if (this.#reservedIntents.has(semanticKey)) fail("SERVICE_BUSY");
      if (this.#unknownIntents.size + this.#reservedIntents.size >= MAX_STATE_ENTRIES) fail("SERVICE_BUSY");
      reservation = Object.freeze({}); this.#reservedIntents.set(semanticKey, reservation);

      const candidate = await this.#prepareCandidate(request, principal, deadline);
      this.#assertCandidate(candidate, principal, request.attemptId, profile);
      if (candidate.intent_fingerprint !== semanticIntentFingerprint(principal, request.input, profile)) fail("PRE_DISPATCH_FAILED");
      await this.#runPreflight(request.attemptId, candidate, deadline.signal);
      this.#assertCandidate(candidate, principal, request.attemptId, profile);
      const chatClient = this.#resolveNativeClient(request.attemptId);
      deadline.throwIfAborted();
      const chat = await this.#await(deadline, () => Reflect.apply(CHAT_CREATE, chatClient,
        ["image", "owner-wan-t2i", deadline.signal]) as Promise<{ chat_uuid: string }>);
      if (!safeId(chat.chat_uuid)) fail("PRE_DISPATCH_FAILED");
      const currentPrincipal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline.signal));
      if (!sameGenerationPrincipal(currentPrincipal, principal)) fail("PRINCIPAL_NOT_LINKED");
      const currentProfile = this.#assertCandidate(candidate, principal, request.attemptId, profile);
      if (currentProfile.profile_schema_hash !== profile.profile_schema_hash) fail("PRE_DISPATCH_FAILED");
      await this.#runPreflight(request.attemptId, candidate, deadline.signal);
      this.#assertCandidate(candidate, principal, request.attemptId, profile);
      const dispatchPrincipal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline.signal));
      if (!sameGenerationPrincipal(dispatchPrincipal, principal)) fail("PRINCIPAL_NOT_LINKED");
      this.#assertSynchronousCurrent(candidate, principal, request.attemptId, profile);
      const now = this.#readNow();
      if (now > Number.MAX_SAFE_INTEGER - RECOVERY_TTL_MS || this.#recoveries.size >= MAX_STATE_ENTRIES) fail("SERVICE_BUSY");
      const recoveryId = `wan_t2i_recovery_${randomUUID()}`;
      recovery = { recovery_id: recoveryId, attemptId: request.attemptId, principal, candidate, profile, chat_uuid: chat.chat_uuid,
        created_at: new Date(now).toISOString(), expires_at: now + RECOVERY_TTL_MS, semantic_key: semanticKey,
        owner_echo_message_id: null, result_context: null, observed_artifacts: new Map(), diagnostic: initialDiagnostic() };
      this.#recoveries.set(recoveryId, recovery);
      const permit = createOwnerWanT2iOneShotPermit({ preparer: this.#preparer, candidate, principal,
        attemptId: request.attemptId, catalog: this.#catalog, catalog_version: this.#catalogVersion, now: () => this.#readNow() });
      this.#assertSynchronousCurrent(candidate, principal, request.attemptId, profile);
      if (this.#reservedIntents.get(semanticKey) !== reservation) fail("PRE_DISPATCH_FAILED");
      this.#reservedIntents.delete(semanticKey); reservation = undefined;
      this.#unknownIntents.add(semanticKey);
      recovery.diagnostic.phase = "GENERATION_POST"; recovery.diagnostic.post_started = true; postStarted = true;
      const nativeInput = Object.freeze({ preparer: this.#preparer, candidate, permit, principal,
        attemptId: request.attemptId, chat_uuid: chat.chat_uuid });
      const receipt = await this.#await(deadline, () => Reflect.apply(NATIVE_START, chatClient,
        [nativeInput, deadline.signal]) as Promise<MediaGenerationReceipt>);
      if (!validReceipt(receipt, chat.chat_uuid)) fail("OUTCOME_UNKNOWN");
      recovery.owner_echo_message_id = receipt.message_id;
      recovery.diagnostic.echo_ack_known = true; recovery.diagnostic.phase = "POST_ACK_KNOWN";
      return await this.#observe(recovery, chatClient, deadline);
    } catch (caught) {
      if (postStarted && recovery) throw unknownError(recovery);
      if (semanticKey && reservation && this.#reservedIntents.get(semanticKey) === reservation) this.#reservedIntents.delete(semanticKey);
      if (recovery) this.#recoveries.delete(recovery.recovery_id);
      if (caught instanceof OwnerWanT2iGenerationServiceError) throw caught;
      if (caught instanceof OwnerWanT2iRequestPrepareError) {
        if (caught.code === "PRINCIPAL_NOT_LINKED") fail("PRINCIPAL_NOT_LINKED");
        if (caught.code === "SERVICE_BUSY" || caught.code === "CAPACITY_EXCEEDED") fail("SERVICE_BUSY");
        if (caught.code === "PROFILE_BINDING_MISMATCH") fail("MODEL_BINDING_MISMATCH");
        fail("PRE_DISPATCH_FAILED");
      }
      if (caught instanceof OwnerWanT2iOneShotPolicyError) fail(caught.code === "CATALOG_BINDING_MISMATCH" ? "MODEL_BINDING_MISMATCH" : "PRE_DISPATCH_FAILED");
      if (caught instanceof OwnerWanT2iSourceProfileError) fail("MODEL_BINDING_MISMATCH");
      if (caught instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      if (caught instanceof OwnerWanT2iParametersError) fail("INVALID_REQUEST");
      fail("PRE_DISPATCH_FAILED");
    } finally { deadline.close(); }
  }

  async #reconcile(request: Readonly<OwnerWanT2iReconcileInput>, signal: AbortSignal): Promise<OwnerWanT2iGenerationResult> {
    const deadline = this.#deadline(signal, () => { const item = this.#recoveries.get(request.recovery_id);
      return item ? unknownError(item) : serviceError("RECOVERY_NOT_FOUND"); });
    let recovery: Recovery | undefined;
    try {
      recovery = this.#recoveries.get(request.recovery_id);
      if (!recovery || recovery.attemptId !== request.attemptId || recovery.expires_at <= this.#readNow()) fail("RECOVERY_NOT_FOUND");
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline.signal));
      if (!sameGenerationPrincipal(principal, recovery.principal) || !recovery.owner_echo_message_id) throw unknownError(recovery);
      return await this.#observe(recovery, this.#resolveNativeClient(request.attemptId), deadline);
    } catch (caught) {
      if (caught instanceof OwnerWanT2iGenerationServiceError && caught.code === "RECOVERY_NOT_FOUND") throw caught;
      if (!recovery) { if (caught instanceof OwnerWanT2iGenerationServiceError) throw caught; fail("PRE_DISPATCH_FAILED"); }
      throw unknownError(recovery);
    } finally { deadline.close(); }
  }

  async #observe(recovery: Recovery, client: SyntxChatHttpClient, deadline: AbsoluteRequestDeadline): Promise<OwnerWanT2iGenerationResult> {
    if (!recovery.owner_echo_message_id) throw unknownError(recovery);
    const startedAt = this.#readNow();
    for (let round = 0; round < this.#maxPollAttempts; round += 1) {
      deadline.throwIfAborted();
      if (recovery.expires_at <= this.#readNow()) throw unknownError(recovery);
      await this.#assertRecoveryPrincipal(recovery, deadline);
      if (!recovery.result_context || recovery.result_context.message_object_ids.length < recovery.candidate.parameters.batch_size) {
        recovery.diagnostic.phase = "HISTORY_GET"; incrementDiagnostic(recovery.diagnostic, "history");
        const snapshot = await this.#await(deadline, () => Reflect.apply(NATIVE_HISTORY, client,
          [recovery.chat_uuid, recovery.owner_echo_message_id!, deadline.signal]) as Promise<ChatMessageHistorySnapshot>);
        await this.#assertRecoveryPrincipal(recovery, deadline);
        recovery.diagnostic.phase = "HISTORY_BINDING";
        const binding = correlateOwnerWanT2iHistoryBinding({ snapshot, requested_chat_uuid: recovery.chat_uuid,
          owner_echo_message_id: recovery.owner_echo_message_id, requested_batch_size: recovery.candidate.parameters.batch_size,
          profile_binding: historyProfileBinding(recovery) });
        if (binding.status === "UNVERIFIED") {
          recovery.diagnostic.history_status = "UNVERIFIED"; recovery.diagnostic.history_reason = binding.reason;
          throw unknownError(recovery);
        }
        if (binding.status === "PENDING") {
          if (recovery.result_context) {
            recovery.diagnostic.history_status = "UNVERIFIED"; recovery.diagnostic.history_reason = "HISTORY_MESSAGE_SET_INVALID";
            throw unknownError(recovery);
          }
          recovery.diagnostic.history_status = "PENDING"; recovery.diagnostic.history_reason = binding.reason;
          if (round + 1 >= this.#maxPollAttempts) throw unknownError(recovery);
          await this.#waitNext(recovery, deadline, startedAt); continue;
        }
        const next = binding.read_context; const previous = recovery.result_context;
        if (previous && (next.provider_chat_id !== previous.provider_chat_id || next.message_id !== previous.message_id ||
            next.message_object_ids.length < previous.message_object_ids.length ||
            !isOrderedSubsequence(previous.message_object_ids, next.message_object_ids))) {
          recovery.diagnostic.history_status = "UNVERIFIED"; recovery.diagnostic.history_reason = "HISTORY_MESSAGE_SET_INVALID";
          throw unknownError(recovery);
        }
        recovery.diagnostic.history_status = "READY"; recovery.diagnostic.history_reason = null;
        recovery.result_context = next;
      }

      recovery.diagnostic.phase = "RESULT_GET"; incrementDiagnostic(recovery.diagnostic, "result");
      const result = await this.#await(deadline, () => Reflect.apply(NATIVE_RESULT, client,
        [recovery.result_context!, deadline.signal]) as Promise<InternalOwnerWanT2iImageResult>);
      await this.#assertRecoveryPrincipal(recovery, deadline);
      recovery.diagnostic.phase = "RESULT_BINDING"; recovery.diagnostic.result_status = result.status;
      if (result.status === "UNVERIFIED") {
        recovery.diagnostic.result_reason = result.reason;
        if (result.reason === "EXTRANEOUS_RESULT_OBJECTS" && recovery.result_context!.message_object_ids.length < recovery.candidate.parameters.batch_size) {
          if (round + 1 < this.#maxPollAttempts) { await this.#waitNext(recovery, deadline, startedAt); continue; }
        }
        throw unknownError(recovery);
      }
      this.#mergeObservedArtifacts(recovery, result);
      if (result.status === "PENDING" || result.status === "PARTIAL") {
        recovery.diagnostic.result_reason = result.status === "PARTIAL" && result.reason === "OBSERVED_RESULTS_PARTIAL"
          ? "OUTPUT_BATCH_PARTIAL" : result.reason;
        if (round + 1 >= this.#maxPollAttempts) {
          if (recovery.observed_artifacts.size > 0) return resultFor(recovery, result, recovery.recovery_id);
          throw unknownError(recovery);
        }
        await this.#waitNext(recovery, deadline, startedAt); continue;
      }
      if (!isExactCompleteResult(result, recovery)) {
        recovery.diagnostic.result_status = "UNVERIFIED"; recovery.diagnostic.result_reason = "OUTPUT_BATCH_PARTIAL";
        throw unknownError(recovery);
      }
      const completedAt = this.#readNow();
      const observed = resultFor(recovery, result);
      if (this.#successCache.size < MAX_STATE_ENTRIES && recovery.candidate.expires_at_ms > completedAt) {
        this.#successCache.set(recovery.semantic_key, { result: observed, expires_at: recovery.candidate.expires_at_ms });
      }
      this.#recoveries.delete(recovery.recovery_id); this.#unknownIntents.delete(recovery.semantic_key);
      return observed;
    }
    throw unknownError(recovery);
  }

  async #runPreflight(attemptId: string, candidate: OwnerWanT2iPreparedCandidate, signal: AbortSignal): Promise<void> {
    if (signal.aborted) fail("PRE_DISPATCH_FAILED");
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
      account = await this.#awaitSignal(Reflect.apply(ACCOUNT_METHOD, accountService, [signal]) as Promise<AccountStatusResult>, signal);
      access = await this.#awaitSignal(Reflect.apply(ACCESS_METHOD, accessService, [Object.freeze({
        model_id: candidate.model_id, cost_parameters: candidate.cost_inputs
      }), signal]) as Promise<ModelAccessResult>, signal);
    } catch { fail("PREFLIGHT_FAILED"); }
    assertPreflight(account, access, candidate, this.#catalog, this.#readNow());
  }

  #assertCandidate(candidate: OwnerWanT2iPreparedCandidate, principal: Readonly<GenerationPrincipalRef>, attemptId: string,
    expectedProfile?: Readonly<OwnerWanT2iSourceProfile>): Readonly<OwnerWanT2iSourceProfile> {
    if (!this.#candidateGuard(candidate, attemptId, principal) || candidate.status !== "PREPARED_SOURCE_SHAPED" ||
        candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" || candidate.provider_execution !== false ||
        candidate.ai_name !== "wan_image" || candidate.scope !== "image" || candidate.operation_id !== "generate-image" ||
        !isWanT2iModel(candidate.model_id) ||
        candidate.catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION || candidate.source_projection_confidence !==
          "EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY" || candidate.defaults_injected !== false ||
        !SHA256.test(candidate.profile_schema_hash) || !SHA256.test(candidate.request_fingerprint) || !SHA256.test(candidate.intent_fingerprint) ||
        !Number.isSafeInteger(candidate.expires_at_ms) || candidate.expires_at_ms <= this.#readNow()) fail("PRE_DISPATCH_FAILED");
    const profile = this.#assertProfile(candidate.model_id);
    if (candidate.profile_id !== profile.profile_id || candidate.profile_schema_hash !== profile.profile_schema_hash ||
        candidate.catalog_version !== profile.public_catalog_version || !isDeepStrictEqual(candidate.source_binding, profile.source_binding) ||
        (expectedProfile && expectedProfile.profile_schema_hash !== profile.profile_schema_hash)) fail("MODEL_BINDING_MISMATCH");
    return profile;
  }

  #assertProfile(modelId: OwnerWanT2iModel): Readonly<OwnerWanT2iSourceProfile> {
    let profile: Readonly<OwnerWanT2iSourceProfile>;
    try { profile = getOwnerWanT2iSourceProfile(modelId, this.#catalog, this.#catalogVersion); }
    catch { fail("MODEL_BINDING_MISMATCH"); }
    const model = this.#catalog.getModel(modelId);
    if (profile.model_id !== modelId || profile.ai_name !== "wan_image" || profile.model_type !== modelId ||
        profile.dispatch_allowed !== false || profile.runtime_activation !== false || profile.backend_acceptance !== "UNPROVEN" ||
        model.active !== true || model.id !== modelId || model.upstream_id !== modelId || model.ai_name !== "wan_image" ||
        model.scope !== "image" || !model.modalities.includes("image") ||
        !model.operations.some((operation) => operation.id === "generate-image" && operation.output_modality === "image")) fail("MODEL_BINDING_MISMATCH");
    return profile;
  }

  #assertSynchronousCurrent(candidate: OwnerWanT2iPreparedCandidate, principal: Readonly<GenerationPrincipalRef>, attemptId: string,
    profile: Readonly<OwnerWanT2iSourceProfile>): void {
    this.#assertOpen();
    if (this.#invalidatingAttempts.has(attemptId) || !this.#candidateGuard(candidate, attemptId, principal)) fail("PRE_DISPATCH_FAILED");
    if (this.#assertProfile(candidate.model_id).profile_schema_hash !== profile.profile_schema_hash) fail("MODEL_BINDING_MISMATCH");
  }

  #candidateGuard(candidate: unknown, attemptId: string, principal: Readonly<GenerationPrincipalRef>): boolean {
    try { return Reflect.apply(CANDIDATE_GUARD, this.#preparer, [candidate, { attemptId, principal }]) === true; }
    catch { return false; }
  }

  #prepareCandidate(request: RunRequest, principal: Readonly<GenerationPrincipalRef>, deadline: AbsoluteRequestDeadline): Promise<OwnerWanT2iPreparedCandidate> {
    return this.#await(deadline, () => Reflect.apply(PREPARE, this.#preparer,
      [{ attemptId: request.attemptId, principal, input: request.input, signal: deadline.signal }]) as Promise<OwnerWanT2iPreparedCandidate>);
  }

  #resolveNativeClient(attemptId: string): SyntxChatHttpClient {
    let client: unknown;
    try { client = Reflect.apply(this.#resolveChatClient, undefined, [attemptId]); } catch { fail("MODEL_BINDING_MISMATCH"); }
    if (!isExactService(client, SyntxChatHttpClient, ["createChat", "startWanT2iImageWithOwnedCandidate", "listMessageCandidates", "getWanT2iImageResult"]) ||
        Reflect.get(client, "createChat") !== CHAT_CREATE || Reflect.get(client, "startWanT2iImageWithOwnedCandidate") !== NATIVE_START ||
        Reflect.get(client, "listMessageCandidates") !== NATIVE_HISTORY || Reflect.get(client, "getWanT2iImageResult") !== NATIVE_RESULT) fail("MODEL_BINDING_MISMATCH");
    return client;
  }

  async #resolvePrincipal(attemptId: string, signal: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    this.#assertOpen(); if (signal.aborted || this.#invalidatingAttempts.has(attemptId)) fail("PRINCIPAL_NOT_LINKED");
    try { return await this.#awaitSignal(resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService }), signal); }
    catch (error) { if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED"); throw error; }
  }

  async #assertRecoveryPrincipal(recovery: Recovery, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted();
    const principal = await this.#await(deadline, () => this.#resolvePrincipal(recovery.attemptId, deadline.signal));
    if (!sameGenerationPrincipal(principal, recovery.principal) || this.#closed || this.#invalidatingAttempts.has(recovery.attemptId) ||
        recovery.expires_at <= this.#readNow() || this.#assertProfile(recovery.candidate.model_id).profile_schema_hash !== recovery.profile.profile_schema_hash) {
      throw unknownError(recovery);
    }
  }

  #mergeObservedArtifacts(recovery: Recovery, result: InternalOwnerWanT2iImageResult): void {
    if (!recovery.result_context) throw unknownError(recovery);
    const expected = new Set(recovery.result_context.message_object_ids);
    for (const artifact of result.artifacts) {
      if (!expected.has(artifact.message_object_id)) {
        recovery.diagnostic.result_status = "UNVERIFIED"; recovery.diagnostic.result_reason = "OBJECT_ID_MISMATCH";
        throw unknownError(recovery);
      }
      const previous = recovery.observed_artifacts.get(artifact.message_object_id);
      if (previous && (previous.message_id !== artifact.message_id || previous.object_type !== artifact.object_type ||
          previous.model_type !== artifact.model_type || previous.completed !== artifact.completed)) {
        recovery.diagnostic.result_status = "UNVERIFIED"; recovery.diagnostic.result_reason = "EXTRANEOUS_RESULT_OBJECTS";
        throw unknownError(recovery);
      }
      recovery.observed_artifacts.set(artifact.message_object_id, artifact);
    }
  }

  async #waitNext(recovery: Recovery, deadline: AbsoluteRequestDeadline, startedAt: number): Promise<void> {
    const elapsed = this.#readNow() - startedAt;
    if (elapsed >= this.#timeoutMs) return;
    recovery.diagnostic.phase = "RESULT_WAIT";
    await this.#await(deadline, () => waitDelay(Math.min(this.#pollDelayMs, this.#timeoutMs - elapsed), deadline.signal));
  }

  #deadline(signal: AbortSignal, errorFactory?: () => Error): AbsoluteRequestDeadline {
    return new AbsoluteRequestDeadline(this.#timeoutMs, signal, () => errorFactory?.() ?? serviceError("PRE_DISPATCH_FAILED"));
  }
  async #await<T>(deadline: AbsoluteRequestDeadline, operation: () => Promise<T> | T): Promise<T> {
    deadline.throwIfAborted(); let pending: Promise<T>;
    try { pending = Promise.resolve(operation()); } catch (error) { throw error; }
    return deadline.waitFor(pending);
  }
  async #awaitSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) fail("PRE_DISPATCH_FAILED");
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(serviceError("PRE_DISPATCH_FAILED"));
      signal.addEventListener("abort", abort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }
  #readNowFrom(clock: () => number): number {
    let now: unknown; try { now = Reflect.apply(clock, undefined, []); } catch { fail("PRE_DISPATCH_FAILED"); }
    if (!Number.isSafeInteger(now) || (now as number) < 0 || (now as number) < this.#lastNow) fail("PRE_DISPATCH_FAILED");
    this.#lastNow = now as number; return now as number;
  }
  #pruneSuccess(now: number): void { for (const [key, cached] of this.#successCache) if (cached.expires_at <= now) this.#successCache.delete(key); }
  #pruneRecoveries(now: number): void { for (const [key, item] of this.#recoveries) if (item.expires_at <= now) this.#recoveries.delete(key); }
  #run<T>(attemptId: string, external: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.#assertOpen();
    if (this.#invalidatingAttempts.has(attemptId) || this.#runs.size >= MAX_RUNS) fail("SERVICE_BUSY");
    if (external !== undefined && (!(external instanceof AbortSignal) || types.isProxy(external))) fail("INVALID_REQUEST");
    const controller = new AbortController(); const signal = external ? AbortSignal.any([controller.signal, external]) : controller.signal;
    const bucket = this.#controllersByAttempt.get(attemptId) ?? new Set<AbortController>(); bucket.add(controller);
    this.#controllersByAttempt.set(attemptId, bucket);
    let run!: Run;
    const promise = Promise.resolve().then(() => operation(signal)).finally(() => {
      bucket.delete(controller); if (!bucket.size) this.#controllersByAttempt.delete(attemptId); this.#runs.delete(run);
    });
    run = { attemptId, controller, promise }; this.#runs.add(run); return promise;
  }
  #readNow(): number { return this.#now(); }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
}

function assertPreflight(accountInput: unknown, accessInput: unknown, candidate: OwnerWanT2iPreparedCandidate,
  catalog: DiscoveryCatalogRepository, now: number): void {
  try {
    const account = exactRecord(accountInput, ["balance", "subscription", "contract_evidence", "source_build", "observed_at"]);
    const balance = exactRecord(account.balance, ["unit", "available"]);
    const subscription = exactRecord(account.subscription, ["active", "plan_type", "end_date", "end_date_kind"]);
    const access = exactRecord(accessInput, ["catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live",
      "parameter_keys", "parameters_redacted", "access", "cost", "discount_cost", "free_remaining_generations", "limit", "show_warning", "observed_at"]);
    const model = catalog.getModel(candidate.model_id);
    const expectedKeys = Object.keys(candidate.cost_inputs).sort();
    const actualKeys = denseStrings(access.parameter_keys);
    const currentCatalogVersion = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
    if (account.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || account.source_build !== ACCOUNT_SOURCE_BUILD || balance.unit !== "tokens" ||
        !(balance.available === null || validBalance(balance.available)) || !validSubscription(subscription, now) || !isFreshIso(account.observed_at, now) ||
        access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || access.catalog_version !== currentCatalogVersion ||
        access.model_id !== candidate.model_id || access.ai_name !== "wan_image" || access.model_type !== candidate.model_id ||
        access.account_read_live !== true || access.access !== true || access.parameters_redacted !== true ||
        actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index]) || !isFreshIso(access.observed_at, now) ||
        !nullableFinite(access.cost) || !nullableFinite(access.discount_cost) ||
        !(access.free_remaining_generations === null || nonnegativeInteger(access.free_remaining_generations)) ||
        !nullableFinite(access.limit) || !(access.show_warning === null || typeof access.show_warning === "boolean") ||
        model.active !== true || model.id !== candidate.model_id || model.upstream_id !== candidate.model_id || model.ai_name !== "wan_image" ||
        model.scope !== "image" || !model.modalities.includes("image") ||
        !model.operations.some((operation) => operation.id === "generate-image" && operation.output_modality === "image")) fail("PREFLIGHT_FAILED");
  } catch (error) { if (error instanceof OwnerWanT2iGenerationServiceError) throw error; fail("PREFLIGHT_FAILED"); }
}

function validSubscription(value: Record<string, unknown>, now: number): boolean {
  if (value.active !== true || !(value.plan_type === null || (typeof value.plan_type === "string" && value.plan_type.trim() !== ""))) return false;
  if (value.end_date === null) return value.end_date_kind === null;
  if (typeof value.end_date !== "string" || value.end_date_kind !== "OFFSET_DATETIME" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value.end_date)) return false;
  const expiry = Date.parse(value.end_date);
  return Number.isFinite(expiry) && expiry > now;
}
function validBalance(value: unknown): value is string {
  return typeof value === "string" && value.length <= 128 && /^[+-]?\d+(?:\.\d+)?$/u.test(value);
}
function finiteNonnegative(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function nullableFinite(value: unknown): boolean { return value === null || finiteNonnegative(value); }
function nonnegativeInteger(value: unknown): boolean { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function isFreshIso(value: unknown, now: number): boolean {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= now && now - parsed <= MAX_CLOCK_SKEW_MS && new Date(parsed).toISOString() === value;
}

function historyProfileBinding(recovery: Recovery): OwnerWanT2iHistoryProfileBinding {
  return Object.freeze({ profile_id: recovery.profile.profile_id, model_id: recovery.candidate.model_id,
    ai_name: "wan_image", model_type: recovery.candidate.model_id, catalog_version: recovery.profile.public_catalog_version,
    profile_schema_hash: recovery.profile.profile_schema_hash, request_fingerprint: recovery.candidate.request_fingerprint,
    intent_fingerprint: recovery.candidate.intent_fingerprint });
}
function isExactCompleteResult(result: InternalOwnerWanT2iImageResult, recovery: Recovery): boolean {
  const count = recovery.candidate.parameters.batch_size; const ids = recovery.result_context?.message_object_ids;
  return result.status === "COMPLETE" && ids !== undefined && result.requested_batch_size === count && result.actual_result_count === count &&
    ids.length === count && result.message_object_ids.length === count && result.artifacts.length === count &&
    result.artifacts.every((artifact, index) => artifact.message_object_id === ids[index] && artifact.model_type === recovery.candidate.model_id && artifact.completed);
}
function resultFor(recovery: Recovery, result: InternalOwnerWanT2iImageResult,
  recoveryId?: string): OwnerWanT2iGenerationResult {
  const partial = result.status !== "COMPLETE" || recoveryId !== undefined;
  const ordered = recovery.result_context?.message_object_ids.flatMap((id) => {
    const artifact = recovery.observed_artifacts.get(id); return artifact ? [Object.freeze({ ...artifact })] : [];
  }) ?? [];
  return Object.freeze({ status: partial ? "partial_results" : "result_observed", dispatch_allowed: false, backend_acceptance: "UNPROVEN",
    provider_execution: false, model_id: recovery.candidate.model_id, profile_id: recovery.profile.profile_id,
    profile_schema_hash: recovery.profile.profile_schema_hash, catalog_version: recovery.profile.public_catalog_version,
    request_fingerprint: recovery.candidate.request_fingerprint, intent_fingerprint: recovery.candidate.intent_fingerprint,
    parameters: recovery.candidate.parameters, cost_routing: recovery.candidate.cost_routing, cost_inputs: recovery.candidate.cost_inputs,
    cost_input_confidence: recovery.candidate.cost_input_confidence,
    source_projection_confidence: recovery.candidate.source_projection_confidence,
    requested_batch_size: recovery.candidate.parameters.batch_size,
    actual_result_count: Math.max(result.actual_result_count, recovery.observed_artifacts.size),
    count_confidence: partial ? "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL" : "CURRENT_MESSAGE_MATCHES_EXPLICIT_BATCH_NOT_PROVIDER_TERMINAL",
    provider_terminal_confidence: "UNPROVEN", artifacts: Object.freeze(ordered), ...(recoveryId ? { recovery_id: recoveryId } : {}) });
}
function initialDiagnostic(): MutableDiagnostic {
  return { phase: "REQUEST_PREPARE", post_started: false, echo_ack_known: false, history_status: "NONE", history_reason: null,
    result_status: "NOT_READ", result_reason: null, history_get_calls: 0, history_get_calls_saturated: false,
    result_get_calls: 0, result_get_calls_saturated: false };
}
function snapshotDiagnostic(value: MutableDiagnostic): OwnerWanT2iGenerationDiagnostic { return Object.freeze({ ...value }); }
function incrementDiagnostic(value: MutableDiagnostic, target: "history" | "result"): void {
  const count = target === "history" ? "history_get_calls" : "result_get_calls";
  const saturated = target === "history" ? "history_get_calls_saturated" : "result_get_calls_saturated";
  if (value[count] >= 255) { value[saturated] = true; return; }
  value[count] += 1;
}
function unknownError(recovery: Recovery): OwnerWanT2iGenerationServiceError {
  return serviceError("OUTCOME_UNKNOWN", recovery.recovery_id, snapshotDiagnostic(recovery.diagnostic));
}
function serviceError(code: OwnerWanT2iGenerationServiceErrorCode, recoveryId?: string,
  diagnostic?: OwnerWanT2iGenerationDiagnostic): OwnerWanT2iGenerationServiceError {
  return new OwnerWanT2iGenerationServiceError(code, recoveryId, diagnostic);
}
function fail(code: OwnerWanT2iGenerationServiceErrorCode): never { throw serviceError(code); }

function semanticIntentFingerprint(principal: Readonly<GenerationPrincipalRef>, input: OwnerWanT2iParametersInput,
  profile: Readonly<OwnerWanT2iSourceProfile>): string {
  const intent = normalizeOwnerWanT2iParameters(input).source_bound_intent;
  const parameters = intent.parameters;
  const request = { prompt: intent.prompt, settings: { n: 1, model_type: intent.model_id, aspect_ratio: parameters.aspect_ratio,
    resolution: parameters.resolution, batch_size: parameters.batch_size, prompt_extend: parameters.prompt_extend,
    seed: parameters.seed, color_palette: null, bbox_list: [], file_urls: [] } };
  return schemaHash({ tenant_id: principal.tenant_id, subject_id: principal.subject_id, model_id: intent.model_id,
    profile_schema_hash: profile.profile_schema_hash, source_binding: profile.source_binding, request });
}
function semanticIntentKey(principal: Readonly<GenerationPrincipalRef>, input: OwnerWanT2iParametersInput,
  profile: Readonly<OwnerWanT2iSourceProfile>): string {
  const fingerprint = semanticIntentFingerprint(principal, input, profile);
  return createHash("sha256").update(JSON.stringify([principal.tenant_id, principal.subject_id, input.model_id, fingerprint])).digest("hex");
}

function snapshotGenerate(value: unknown): Readonly<RunRequest> {
  const fields = exactRecord(value, ["attemptId", "input"]); const attemptId = safeAttempt(fields.attemptId);
  let input: OwnerWanT2iParametersInput;
  try { input = normalizeOwnerWanT2iParameters(fields.input).source_bound_intent; }
  catch (error) { if (error instanceof OwnerWanT2iParametersError) fail("INVALID_REQUEST"); fail("INVALID_REQUEST"); }
  return Object.freeze({ attemptId, input });
}
function snapshotReconcile(value: unknown): Readonly<OwnerWanT2iReconcileInput> {
  const fields = exactRecord(value, ["attemptId", "recovery_id"]); const attemptId = safeAttempt(fields.attemptId);
  if (typeof fields.recovery_id !== "string" || !/^wan_t2i_recovery_[0-9a-f-]{36}$/u.test(fields.recovery_id)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId, recovery_id: fields.recovery_id });
}
function snapshotRecoveryList(value: unknown): Readonly<OwnerWanT2iRecoveryListInput> {
  const fields = exactRecord(value, ["attemptId"], ["limit"]); const attemptId = safeAttempt(fields.attemptId);
  const limit = bounded(fields.limit, 1, 20, 20);
  return Object.freeze({ attemptId, limit });
}
function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || fields.tenant_id.length < 1 || fields.tenant_id.length > 256 ||
      /[\u0000-\u001f\u007f]/u.test(fields.tenant_id) || typeof fields.subject !== "string" || fields.subject.length < 1 ||
      fields.subject.length > 512 || /[\u0000-\u001f\u007f]/u.test(fields.subject)) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}
function snapshotLinkService(value: unknown): Pick<PerUserLinkService, "getStatus"> {
  if (!value || typeof value !== "object" || types.isProxy(value)) fail("INVALID_REQUEST");
  const own = Object.getOwnPropertyDescriptor(value, "getStatus"); const proto = Object.getPrototypeOf(value);
  const inherited = proto && Object.getOwnPropertyDescriptor(proto, "getStatus");
  const method = own && "value" in own ? own.value : inherited && "value" in inherited ? inherited.value : undefined;
  if (typeof method !== "function" || types.isProxy(method)) fail("INVALID_REQUEST");
  return Object.freeze({ getStatus: (binding, attemptId) => Reflect.apply(method, value, [binding, attemptId]) }) as Pick<PerUserLinkService, "getStatus">;
}
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const proto = Object.getPrototypeOf(value); if (proto !== Object.prototype && proto !== null) fail("INVALID_REQUEST");
  let descriptors: PropertyDescriptorMap; try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(descriptors); const allowed = [...required, ...optional];
  if (required.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) => typeof key !== "string" || !allowed.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) output[key] = descriptors[key]!.value;
  return output;
}
function denseStrings(value: unknown): string[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 16) fail("PREFLIGHT_FAILED");
  const descriptors = Object.getOwnPropertyDescriptors(value); const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || !keys.includes("length")) fail("PREFLIGHT_FAILED");
  return Array.from({ length: value.length }, (_, index) => {
    const item = descriptors[String(index)]; if (!item || !("value" in item) || typeof item.value !== "string") fail("PREFLIGHT_FAILED");
    return item.value;
  });
}
function safeAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST"); return value; }
function safeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function isWanT2iModel(value: unknown): value is OwnerWanT2iModel { return (MODEL_IDS as readonly unknown[]).includes(value); }
function isOrderedSubsequence(previous: readonly string[], current: readonly string[]): boolean {
  let index = 0; for (const id of current) if (id === previous[index]) index += 1; return index === previous.length;
}
function validReceipt(value: unknown, chatUuid: string): value is MediaGenerationReceipt {
  try { const fields = exactRecord(value, ["chat_uuid", "message_id"]); return fields.chat_uuid === chatUuid && safeId(fields.message_id); }
  catch { return false; }
}
function isExactService<T extends object>(value: unknown, ctor: new (...args: never[]) => T, methods: readonly string[]): value is T {
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof ctor) || Object.getPrototypeOf(value) !== ctor.prototype) return false;
  return methods.every((method) => {
    const native = Reflect.get(ctor.prototype, method);
    return typeof native === "function" && !types.isProxy(native) && !Object.hasOwn(value, method) && Reflect.get(value, method) === native;
  });
}
function bounded(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) fail("INVALID_REQUEST");
  return value as number;
}
function readClockFactory(value: unknown): () => number {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST"); return value as () => number;
}
function waitDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(serviceError("PRE_DISPATCH_FAILED")); return; }
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    const abort = () => { clearTimeout(timer); reject(serviceError("PRE_DISPATCH_FAILED")); };
    signal.addEventListener("abort", abort, { once: true });
  });
}
