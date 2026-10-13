import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import {
  SyntxChatHttpClient,
  type MediaGenerationReceipt,
  type ChatMessageHistorySnapshot,
  type StartSoulImageWithOwnedCandidateInput
} from "../adapter/syntx/chat-http-client.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { AccountStatusService, type AccountStatusResult } from "./account-status.js";
import { ModelAccessService, type ModelAccessResult } from "./model-access.js";
import { OwnerSoulImageRequestPreparer, OwnerSoulImageRequestPrepareError,
  type OwnerSoulImagePreparedCandidate } from "./owner-soul-image-request-preparer.js";
import { OwnerSoulStyleOptionsService } from "./owner-soul-style-options-service.js";
import { OwnerSoulCharacterOptionsService } from "./owner-soul-character-options-service.js";
import {
  createOwnerSoulImageOneShotPermit,
  OwnerSoulImageOneShotPolicyError,
} from "./owner-soul-image-one-shot-policy.js";
import {
  correlateOwnerSoulImageHistoryBinding,
  type OwnerSoulImageHistoryBindingReason,
  type OwnerSoulImageHistoryProfileBinding
} from "./owner-soul-image-history-binding.js";
import type { OwnerSoulImageResultReadContext, InternalOwnerSoulImageResult, InternalOwnerSoulImageResultArtifact,
  OwnerSoulImageResultUnverifiedReason } from "../adapter/syntx/owner-soul-image-result.js";
import { getOwnerSoulImageSourceProfile, type OwnerSoulImageSourceProfile } from "./owner-soul-image-source-profile.js";
import { normalizeOwnerSoulGenerationParameters, type OwnerSoulGenerationParametersInput } from "./owner-soul-generation-parameters.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";

const MODEL_ID = "higgsfield-soul" as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MAX_PENDING_RUNS = 4;
const MAX_STATE_ENTRIES = 128;
const RECOVERY_TTL_MS = 15 * 60_000;
const MAX_CLOCK_SKEW_MS = 30_000;
const ACCOUNT_METHOD = AccountStatusService.prototype.getAccountStatus;
const ACCESS_METHOD = ModelAccessService.prototype.getModelAccess;
const CHAT_CREATE = SyntxChatHttpClient.prototype.createChat;
const NATIVE_START = SyntxChatHttpClient.prototype.startSoulImageWithOwnedCandidate;
const NATIVE_HISTORY = SyntxChatHttpClient.prototype.listMessageCandidates;
const NATIVE_RESULT = SyntxChatHttpClient.prototype.getSoulImageBatchResult;
const PREPARER_PREPARE = OwnerSoulImageRequestPreparer.prototype.prepare;
const PREPARER_GUARD = OwnerSoulImageRequestPreparer.prototype.isPreparedCandidateForPrincipal;
const PREPARER_INVALIDATE = OwnerSoulImageRequestPreparer.prototype.invalidateAttempt;
const PREPARER_CLOSE = OwnerSoulImageRequestPreparer.prototype.close;
const STYLE_INVALIDATE = OwnerSoulStyleOptionsService.prototype.invalidateAttempt;
const STYLE_CLOSE = OwnerSoulStyleOptionsService.prototype.close;
const CHARACTER_INVALIDATE = OwnerSoulCharacterOptionsService.prototype.invalidateAttempt;
const CHARACTER_CLOSE = OwnerSoulCharacterOptionsService.prototype.close;

export type OwnerSoulImageGenerationPhase =
  | "REQUEST_PREPARE" | "PREFLIGHT" | "CHAT_CREATE" | "GENERATION_POST" | "POST_ACK_KNOWN"
  | "HISTORY_GET" | "HISTORY_BINDING" | "RESULT_GET" | "RESULT_BINDING" | "RESULT_WAIT";

export const OWNER_SOUL_IMAGE_GENERATION_PHASES = Object.freeze([
  "REQUEST_PREPARE", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST", "POST_ACK_KNOWN",
  "HISTORY_GET", "HISTORY_BINDING", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"
] as const satisfies readonly OwnerSoulImageGenerationPhase[]);
type MissingPhase = Exclude<OwnerSoulImageGenerationPhase, typeof OWNER_SOUL_IMAGE_GENERATION_PHASES[number]>;
const PHASES_COMPLETE: MissingPhase extends never ? true : false = true;
void PHASES_COMPLETE;

export type OwnerSoulImageHistoryDiagnosticReason = OwnerSoulImageHistoryBindingReason |
  "RESULT_MESSAGE_NOT_FOUND" | "RESULT_OBJECT_IDS_NOT_OBSERVED" | "OUTPUT_BATCH_PARTIAL";
export const OWNER_SOUL_IMAGE_GENERATION_HISTORY_REASONS = Object.freeze([
  "HISTORY_SHAPE_INVALID", "CHAT_SCOPE_MISMATCH", "OWNER_ACK_NOT_FOUND", "OWNER_ACK_AMBIGUOUS",
  "OWNER_MEDIA_REFERENCES_NOT_SUPPORTED", "HISTORY_MESSAGE_SET_INVALID", "RESULT_OBJECTS_INVALID",
  "RESULT_OBJECTS_OVER_LIMIT", "PROFILE_BINDING_INVALID", "REQUESTED_BATCH_INVALID",
  "RESULT_MESSAGE_NOT_FOUND", "RESULT_OBJECT_IDS_NOT_OBSERVED", "OUTPUT_BATCH_PARTIAL"
] as const satisfies readonly OwnerSoulImageHistoryDiagnosticReason[]);
type MissingHistoryReason = Exclude<OwnerSoulImageHistoryDiagnosticReason, typeof OWNER_SOUL_IMAGE_GENERATION_HISTORY_REASONS[number]>;
const HISTORY_REASONS_COMPLETE: MissingHistoryReason extends never ? true : false = true;
void HISTORY_REASONS_COMPLETE;

export type OwnerSoulImageResultDiagnosticReason = OwnerSoulImageResultUnverifiedReason | "NO_RESULT_OBJECTS" |
  "NO_COMPLETED_RESULT_OBJECTS" | "OBSERVED_RESULTS_PARTIAL" | "RESULT_URI_PENDING" | "RESULT_OBJECTS_PENDING" | "OUTPUT_BATCH_PARTIAL";
export const OWNER_SOUL_IMAGE_GENERATION_RESULT_REASONS = Object.freeze([
  "RESPONSE_SHAPE_INVALID", "OUTER_MESSAGE_MISMATCH", "PROVIDER_CHAT_MISMATCH", "NOT_BOT_MESSAGE", "OBJECT_ID_MISMATCH",
  "DUPLICATE_RESULT_OBJECT_ID", "OBJECT_MESSAGE_MISMATCH", "OBJECT_TYPE_MISMATCH", "MODEL_TYPE_UNAVAILABLE",
  "MODEL_TYPE_MISMATCH", "RESULT_COMPLETED_FLAG_INVALID", "RESULT_URL_UNSAFE", "EXTRANEOUS_RESULT_OBJECTS",
  "NO_RESULT_OBJECTS", "NO_COMPLETED_RESULT_OBJECTS", "OBSERVED_RESULTS_PARTIAL", "RESULT_URI_PENDING",
  "RESULT_OBJECTS_PENDING", "OUTPUT_BATCH_PARTIAL"
] as const satisfies readonly OwnerSoulImageResultDiagnosticReason[]);
type MissingResultReason = Exclude<OwnerSoulImageResultDiagnosticReason, typeof OWNER_SOUL_IMAGE_GENERATION_RESULT_REASONS[number]>;
const RESULT_REASONS_COMPLETE: MissingResultReason extends never ? true : false = true;
void RESULT_REASONS_COMPLETE;

export interface OwnerSoulImageGenerationDiagnostic {
  readonly phase: OwnerSoulImageGenerationPhase;
  readonly post_started: boolean;
  readonly echo_ack_known: boolean;
  readonly history_status: "NONE" | "PENDING" | "READY" | "UNVERIFIED";
  readonly history_reason: OwnerSoulImageHistoryDiagnosticReason | null;
  readonly result_status: "NOT_READ" | "PENDING" | "PARTIAL" | "COMPLETE" | "UNVERIFIED";
  readonly result_reason: OwnerSoulImageResultDiagnosticReason | null;
  readonly history_get_calls: number;
  readonly history_get_calls_saturated: boolean;
  readonly result_get_calls: number;
  readonly result_get_calls_saturated: boolean;
}

export interface OwnerSoulImageGenerationResult {
  readonly status: "result_observed" | "partial_results";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly provider_execution: false;
  readonly model_id: typeof MODEL_ID;
  readonly profile_id: OwnerSoulImageSourceProfile["profile_id"];
  readonly profile_schema_hash: string;
  readonly catalog_version: typeof DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly parameters: OwnerSoulImagePreparedCandidate["parameters"];
  readonly selection: OwnerSoulImagePreparedCandidate["selection"];
  readonly cost_routing: OwnerSoulImagePreparedCandidate["cost_routing"];
  readonly cost_inputs: OwnerSoulImagePreparedCandidate["cost_inputs"];
  readonly source_projection_confidence: OwnerSoulImagePreparedCandidate["source_projection_confidence"];
  readonly reference_strength: OwnerSoulImagePreparedCandidate["reference_strength"];
  readonly requested_batch_size: 1 | 4;
  readonly actual_result_count: number;
  readonly count_confidence: "CURRENT_VERIFIED_MESSAGE_MATCHES_EXPLICIT_BATCH_SIZE" | "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL";
  readonly artifacts: readonly Readonly<InternalOwnerSoulImageResultArtifact>[];
  readonly recovery_id?: string;
}

export interface OwnerSoulImageRecoveryListItem {
  readonly recovery_id: string;
  readonly created_at: string;
  readonly model_id: typeof MODEL_ID;
  readonly status: "OUTCOME_UNKNOWN";
  readonly diagnostic: OwnerSoulImageGenerationDiagnostic;
}

export type OwnerSoulImageGenerationServiceErrorCode =
  | "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "MODEL_BINDING_MISMATCH" | "PRINCIPAL_NOT_LINKED"
  | "PREFLIGHT_FAILED" | "INTENT_ALREADY_CLAIMED" | "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND";
export const OWNER_SOUL_IMAGE_GENERATION_ERROR_CODES = Object.freeze([
  "INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "MODEL_BINDING_MISMATCH", "PRINCIPAL_NOT_LINKED",
  "PREFLIGHT_FAILED", "INTENT_ALREADY_CLAIMED", "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"
] as const satisfies readonly OwnerSoulImageGenerationServiceErrorCode[]);
type MissingServiceError = Exclude<OwnerSoulImageGenerationServiceErrorCode, typeof OWNER_SOUL_IMAGE_GENERATION_ERROR_CODES[number]>;
const ERROR_CODES_COMPLETE: MissingServiceError extends never ? true : false = true;
void ERROR_CODES_COMPLETE;

export interface OwnerSoulImageGenerationServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string;
  readonly preparer: OwnerSoulImageRequestPreparer;
  readonly styleOptionsService: OwnerSoulStyleOptionsService;
  readonly characterOptionsService: OwnerSoulCharacterOptionsService;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly createAccountStatusService: (attemptId: string) => AccountStatusService;
  readonly createModelAccessService: (attemptId: string) => ModelAccessService;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly pollDelayMs?: number;
  readonly maxPollAttempts?: number;
}

export interface OwnerSoulImageGenerateInput {
  readonly attemptId: string;
  readonly input: OwnerSoulGenerationParametersInput;
}
export interface OwnerSoulImageReconcileInput { readonly attemptId: string; readonly recovery_id: string }
export interface OwnerSoulImageRecoveryListInput { readonly attemptId: string; readonly limit?: number }

export class OwnerSoulImageGenerationServiceError extends Error {
  readonly diagnostic: OwnerSoulImageGenerationDiagnostic | undefined;
  constructor(readonly code: OwnerSoulImageGenerationServiceErrorCode, readonly recovery_id?: string,
    diagnostic?: OwnerSoulImageGenerationDiagnostic) {
    super(code === "OUTCOME_UNKNOWN" ? "The Soul image request may have been dispatched; reconcile the existing recovery and do not retry."
      : "The owner Soul image request could not be completed safely.");
    this.name = "OwnerSoulImageGenerationServiceError";
    this.diagnostic = code === "OUTCOME_UNKNOWN" && diagnostic ? diagnostic : undefined;
  }
}

interface MutableDiagnostic {
  phase: OwnerSoulImageGenerationPhase;
  post_started: boolean;
  echo_ack_known: boolean;
  history_status: OwnerSoulImageGenerationDiagnostic["history_status"];
  history_reason: OwnerSoulImageHistoryDiagnosticReason | null;
  result_status: OwnerSoulImageGenerationDiagnostic["result_status"];
  result_reason: OwnerSoulImageResultDiagnosticReason | null;
  history_get_calls: number;
  history_get_calls_saturated: boolean;
  result_get_calls: number;
  result_get_calls_saturated: boolean;
}
interface Recovery {
  readonly recovery_id: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly candidate: OwnerSoulImagePreparedCandidate;
  readonly profile: Readonly<OwnerSoulImageSourceProfile>;
  readonly chat_uuid: string;
  readonly created_at: string;
  expires_at: number | null;
  readonly semantic_key: string;
  owner_echo_message_id: string | null;
  result_context: Readonly<OwnerSoulImageResultReadContext> | null;
  readonly observed_artifacts: Map<string, InternalOwnerSoulImageResultArtifact>;
  readonly diagnostic: MutableDiagnostic;
}
interface CachedResult { readonly result: OwnerSoulImageGenerationResult; readonly expires_at: number; }
interface RunRequest { readonly attemptId: string; readonly input: Readonly<OwnerSoulGenerationParametersInput>; }
interface Run { readonly attemptId: string; readonly controller: AbortController; readonly promise: Promise<unknown>; }

export class OwnerSoulImageGenerationService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #preparer: OwnerSoulImageRequestPreparer;
  readonly #styleOptions: OwnerSoulStyleOptionsService;
  readonly #characterOptions: OwnerSoulCharacterOptionsService;
  readonly #resolveChatClient: OwnerSoulImageGenerationServiceOptions["resolveChatClient"];
  readonly #createAccountStatusService: OwnerSoulImageGenerationServiceOptions["createAccountStatusService"];
  readonly #createModelAccessService: OwnerSoulImageGenerationServiceOptions["createModelAccessService"];
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #pollDelayMs: number;
  readonly #maxPollAttempts: number;
  readonly #recoveries = new Map<string, Recovery>();
  readonly #unknownIntents = new Set<string>();
  readonly #reservedIntents = new Map<string, object>();
  readonly #successCache = new Map<string, CachedResult>();
  readonly #usedAccountServices = new WeakSet<object>();
  readonly #usedAccessServices = new WeakSet<object>();
  readonly #runs = new Set<Run>();
  readonly #controllersByAttempt = new Map<string, Set<AbortController>>();
  readonly #invalidatingAttempts = new Set<string>();
  #closed = false;
  #closing: Promise<void> | undefined;
  #lastNow = -1;

  constructor(optionsInput: OwnerSoulImageGenerationServiceOptions | unknown) {
    const options = exactRecord(optionsInput,
      ["binding", "linkService", "catalog", "catalog_version", "preparer", "styleOptionsService", "characterOptionsService",
        "resolveChatClient", "createAccountStatusService", "createModelAccessService"],
      ["now", "timeoutMs", "pollDelayMs", "maxPollAttempts"]);
    if (!(options.catalog instanceof DiscoveryCatalogRepository) || types.isProxy(options.catalog) ||
        Object.getPrototypeOf(options.catalog) !== DiscoveryCatalogRepository.prototype ||
        !isExactService(options.preparer, OwnerSoulImageRequestPreparer, ["prepare", "isPreparedCandidateForPrincipal", "invalidateAttempt", "close"]) ||
        !isExactService(options.styleOptionsService, OwnerSoulStyleOptionsService, ["revalidateStyleHandle", "isRevalidatedStyleForContext", "invalidateAttempt", "close"]) ||
        !isExactService(options.characterOptionsService, OwnerSoulCharacterOptionsService, ["revalidateCharacterHandle", "isRevalidatedCharacterForContext", "invalidateAttempt", "close"]) ||
        typeof options.resolveChatClient !== "function" || types.isProxy(options.resolveChatClient) ||
        typeof options.createAccountStatusService !== "function" || types.isProxy(options.createAccountStatusService) ||
        typeof options.createModelAccessService !== "function" || types.isProxy(options.createModelAccessService) ||
        (options.now !== undefined && (typeof options.now !== "function" || types.isProxy(options.now)))) fail("INVALID_REQUEST");
    this.#binding = snapshotBinding(options.binding);
    this.#linkService = snapshotLinkService(options.linkService);
    if (options.catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION) fail("MODEL_BINDING_MISMATCH");
    this.#catalog = options.catalog;
    this.#preparer = options.preparer;
    this.#styleOptions = options.styleOptionsService;
    this.#characterOptions = options.characterOptionsService;
    this.#resolveChatClient = options.resolveChatClient as OwnerSoulImageGenerationServiceOptions["resolveChatClient"];
    this.#createAccountStatusService = options.createAccountStatusService as OwnerSoulImageGenerationServiceOptions["createAccountStatusService"];
    this.#createModelAccessService = options.createModelAccessService as OwnerSoulImageGenerationServiceOptions["createModelAccessService"];
    const clock = options.now === undefined ? Date.now : readClockFactory(options.now);
    this.#now = () => this.#readNowFrom(clock);
    this.#timeoutMs = bounded(options.timeoutMs, 1, 60_000, 30_000);
    this.#pollDelayMs = bounded(options.pollDelayMs, 0, 5_000, 250);
    this.#maxPollAttempts = bounded(options.maxPollAttempts, 1, 30, 8);
    this.#assertProfile();
  }

  generate(input: OwnerSoulImageGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerSoulImageGenerationResult> {
    const request = snapshotGenerate(input);
    return this.#run(request.attemptId, signal, (runSignal) => this.#generate(request, runSignal));
  }

  reconcile(input: OwnerSoulImageReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerSoulImageGenerationResult> {
    const request = snapshotReconcile(input);
    return this.#run(request.attemptId, signal, (runSignal) => this.#reconcile(request, runSignal));
  }

  listRecoveries(input: OwnerSoulImageRecoveryListInput | unknown): Promise<readonly OwnerSoulImageRecoveryListItem[]> {
    const request = snapshotRecoveryList(input);
    return this.#run(request.attemptId, undefined, async (signal) => {
      const deadline = this.#deadline(signal);
      try {
        const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline.signal));
        const now = this.#readNow(); this.#pruneSuccess(now); this.#pruneRecoveries(now);
        return Object.freeze([...this.#recoveries.values()]
          .filter((entry) => entry.attemptId === request.attemptId && sameGenerationPrincipal(entry.principal, principal))
          .sort((left, right) => right.created_at.localeCompare(left.created_at)).slice(0, request.limit)
          .map((entry) => Object.freeze({ recovery_id: entry.recovery_id, created_at: entry.created_at, model_id: MODEL_ID,
            status: "OUTCOME_UNKNOWN" as const, diagnostic: snapshotDiagnostic(entry.diagnostic) })));
      } finally { deadline.close(); }
    });
  }

  async invalidateAttempt(attemptIdInput: unknown): Promise<void> {
    if (typeof attemptIdInput !== "string" || !ATTEMPT.test(attemptIdInput) || this.#closed || this.#invalidatingAttempts.has(attemptIdInput)) return;
    const attemptId = attemptIdInput;
    this.#invalidatingAttempts.add(attemptId);
    try {
      for (const controller of this.#controllersByAttempt.get(attemptId) ?? []) controller.abort();
      await Promise.allSettled([...this.#runs].filter((run) => run.attemptId === attemptId).map((run) => run.promise));
      Reflect.apply(PREPARER_INVALIDATE, this.#preparer, [attemptId]);
      Reflect.apply(STYLE_INVALIDATE, this.#styleOptions, [attemptId]);
      Reflect.apply(CHARACTER_INVALIDATE, this.#characterOptions, [attemptId]);
      for (const [id, recovery] of this.#recoveries) if (recovery.attemptId === attemptId) this.#recoveries.delete(id);
      // Unknown intent holds intentionally survive relink/attempt invalidation and selector TTL expiry.
    } finally { this.#invalidatingAttempts.delete(attemptId); }
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const run of this.#runs) run.controller.abort();
    this.#closing = (async () => {
      await Promise.allSettled([...this.#runs].map((run) => run.promise));
      await Reflect.apply(PREPARER_CLOSE, this.#preparer, []);
      await Reflect.apply(STYLE_CLOSE, this.#styleOptions, []);
      await Reflect.apply(CHARACTER_CLOSE, this.#characterOptions, []);
      this.#recoveries.clear(); this.#successCache.clear(); this.#reservedIntents.clear(); this.#unknownIntents.clear();
      this.#runs.clear(); this.#controllersByAttempt.clear(); this.#invalidatingAttempts.clear();
    })();
    return this.#closing;
  }

  async #generate(request: RunRequest, signal: AbortSignal): Promise<OwnerSoulImageGenerationResult> {
    let semanticKey: string | undefined;
    let reservation: object | undefined;
    let recovery: Recovery | undefined;
    let postStarted = false;
    const deadline = this.#deadline(signal, () => recovery ? unknownError(recovery) : generationError("PRE_DISPATCH_FAILED"));
    try {
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline.signal));
      const profile = this.#assertProfile();
      const candidate = await this.#prepareCandidate(request, principal, deadline);
      this.#assertCandidate(candidate, principal, request.attemptId, profile);
      semanticKey = semanticIntentKey(principal, candidate);
      const pruneNow = this.#readNow(); this.#pruneSuccess(pruneNow); this.#pruneRecoveries(pruneNow);
      if (this.#unknownIntents.has(semanticKey)) fail("INTENT_ALREADY_CLAIMED");
      const cached = this.#successCache.get(semanticKey);
      if (cached && cached.expires_at > this.#readNow()) return cached.result;
      if (this.#reservedIntents.has(semanticKey)) fail("SERVICE_BUSY");
      if (this.#unknownIntents.size + this.#reservedIntents.size >= MAX_STATE_ENTRIES) fail("SERVICE_BUSY");
      reservation = Object.freeze({});
      this.#reservedIntents.set(semanticKey, reservation);

      await this.#runPreflight(request.attemptId, candidate, deadline.signal);
      this.#assertCandidate(candidate, principal, request.attemptId, profile);
      const chatClient = this.#resolveNativeClient(request.attemptId);
      deadline.throwIfAborted();
      const chat = await this.#await(deadline, () => Reflect.apply(CHAT_CREATE, chatClient, ["image", "owner-soul-image", deadline.signal]) as Promise<{ chat_uuid: string }>);
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
      const recoveryId = `soul_image_recovery_${randomUUID()}`;
      recovery = { recovery_id: recoveryId, attemptId: request.attemptId, principal, candidate, profile: currentProfile,
        chat_uuid: chat.chat_uuid, created_at: new Date(now).toISOString(), expires_at: now + RECOVERY_TTL_MS,
        semantic_key: semanticKey, owner_echo_message_id: null, result_context: null, observed_artifacts: new Map(), diagnostic: initialDiagnostic() };
      this.#recoveries.set(recoveryId, recovery);
      const permit = createOwnerSoulImageOneShotPermit({ preparer: this.#preparer, candidate, principal,
        attemptId: request.attemptId, catalog: this.#catalog, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
        now: () => this.#readNow() });
      this.#assertSynchronousCurrent(candidate, principal, request.attemptId, profile);
      if (this.#reservedIntents.get(semanticKey) !== reservation) fail("PRE_DISPATCH_FAILED");
      this.#reservedIntents.delete(semanticKey); reservation = undefined;
      this.#unknownIntents.add(semanticKey);
      recovery.expires_at = null;
      recovery.diagnostic.phase = "GENERATION_POST"; recovery.diagnostic.post_started = true; postStarted = true;
      const nativeInput: StartSoulImageWithOwnedCandidateInput = Object.freeze({ preparer: this.#preparer, candidate, permit,
        principal, attemptId: request.attemptId, chat_uuid: chat.chat_uuid });
      const receipt = await this.#await(deadline, () => Reflect.apply(NATIVE_START, chatClient, [nativeInput, deadline.signal]) as Promise<MediaGenerationReceipt>);
      if (!validReceipt(receipt, chat.chat_uuid)) fail("OUTCOME_UNKNOWN");
      recovery.owner_echo_message_id = receipt.message_id;
      recovery.diagnostic.echo_ack_known = true; recovery.diagnostic.phase = "POST_ACK_KNOWN";
      return await this.#observe(recovery, chatClient, deadline);
    } catch (caught) {
      if (postStarted && recovery) throw unknownError(recovery);
      if (semanticKey && reservation && this.#reservedIntents.get(semanticKey) === reservation) this.#reservedIntents.delete(semanticKey);
      if (recovery) this.#recoveries.delete(recovery.recovery_id);
      if (caught instanceof OwnerSoulImageGenerationServiceError) throw caught;
      if (caught instanceof OwnerSoulImageRequestPrepareError) {
        if (caught.code === "PRINCIPAL_NOT_LINKED") fail("PRINCIPAL_NOT_LINKED");
        if (caught.code === "SERVICE_BUSY" || caught.code === "CAPACITY_EXCEEDED") fail("SERVICE_BUSY");
        if (caught.code === "PROFILE_BINDING_MISMATCH") fail("MODEL_BINDING_MISMATCH");
        fail("PRE_DISPATCH_FAILED");
      }
      if (caught instanceof OwnerSoulImageOneShotPolicyError) fail(caught.code === "CATALOG_BINDING_MISMATCH" ? "MODEL_BINDING_MISMATCH" : "PRE_DISPATCH_FAILED");
      if (caught instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      fail("PRE_DISPATCH_FAILED");
    } finally { deadline.close(); }
  }

  async #reconcile(request: Readonly<OwnerSoulImageReconcileInput>, signal: AbortSignal): Promise<OwnerSoulImageGenerationResult> {
    const deadline = this.#deadline(signal, () => {
      const item = this.#recoveries.get(request.recovery_id); return item ? unknownError(item) : generationError("RECOVERY_NOT_FOUND");
    });
    let recovery: Recovery | undefined;
    try {
      this.#pruneRecoveries(this.#readNow());
      recovery = this.#recoveries.get(request.recovery_id);
      if (!recovery || recovery.attemptId !== request.attemptId ||
          (recovery.expires_at !== null && recovery.expires_at <= this.#readNow())) fail("RECOVERY_NOT_FOUND");
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline.signal));
      if (!sameGenerationPrincipal(principal, recovery.principal) || !recovery.owner_echo_message_id) throw unknownError(recovery);
      return await this.#observe(recovery, this.#resolveNativeClient(request.attemptId), deadline);
    } catch (caught) {
      if (caught instanceof OwnerSoulImageGenerationServiceError && caught.code === "RECOVERY_NOT_FOUND") throw caught;
      if (!recovery) { if (caught instanceof OwnerSoulImageGenerationServiceError) throw caught; fail("PRE_DISPATCH_FAILED"); }
      throw unknownError(recovery);
    } finally { deadline.close(); }
  }

  async #observe(recovery: Recovery, client: SyntxChatHttpClient, deadline: AbsoluteRequestDeadline): Promise<OwnerSoulImageGenerationResult> {
    if (!recovery.owner_echo_message_id) throw unknownError(recovery);
    const startedAt = this.#readNow();
    for (let round = 0; round < this.#maxPollAttempts; round += 1) {
      deadline.throwIfAborted();
      if (recovery.expires_at !== null && recovery.expires_at <= this.#readNow()) throw unknownError(recovery);
      await this.#assertRecoveryPrincipal(recovery, deadline);
      if (!recovery.result_context || recovery.result_context.message_object_ids.length < recovery.candidate.parameters.batch_size) {
        recovery.diagnostic.phase = "HISTORY_GET"; incrementDiagnostic(recovery.diagnostic, "history");
        const snapshot: ChatMessageHistorySnapshot = await this.#await(deadline, () =>
          Reflect.apply(NATIVE_HISTORY, client, [recovery.chat_uuid, recovery.owner_echo_message_id!, deadline.signal]) as Promise<ChatMessageHistorySnapshot>);
        await this.#assertRecoveryPrincipal(recovery, deadline);
        recovery.diagnostic.phase = "HISTORY_BINDING";
        const binding = correlateOwnerSoulImageHistoryBinding({ snapshot, requested_chat_uuid: recovery.chat_uuid,
          owner_echo_message_id: recovery.owner_echo_message_id, requested_batch_size: recovery.candidate.parameters.batch_size,
          profile_binding: historyProfileBinding(recovery) });
        if (binding.status === "UNVERIFIED") {
          recovery.diagnostic.history_status = "UNVERIFIED"; recovery.diagnostic.history_reason = binding.reason; throw unknownError(recovery);
        }
        if (binding.status === "PENDING") {
          if (recovery.result_context) {
            recovery.diagnostic.history_status = "UNVERIFIED";
            recovery.diagnostic.history_reason = "HISTORY_MESSAGE_SET_INVALID";
            throw unknownError(recovery);
          }
          recovery.diagnostic.history_status = "PENDING"; recovery.diagnostic.history_reason = binding.reason;
          await this.#waitNext(recovery, deadline, startedAt, round); continue;
        }
        const nextContext = binding.read_context;
        const previousContext = recovery.result_context;
        if (previousContext && (nextContext.provider_chat_id !== previousContext.provider_chat_id ||
            nextContext.message_id !== previousContext.message_id || nextContext.message_object_ids.length < previousContext.message_object_ids.length ||
            !isOrderedSubsequence(previousContext.message_object_ids, nextContext.message_object_ids))) {
          recovery.diagnostic.history_status = "UNVERIFIED";
          recovery.diagnostic.history_reason = "HISTORY_MESSAGE_SET_INVALID";
          throw unknownError(recovery);
        }
        recovery.diagnostic.history_status = "READY"; recovery.diagnostic.history_reason = null;
        recovery.result_context = nextContext;
      }

      recovery.diagnostic.phase = "RESULT_GET"; incrementDiagnostic(recovery.diagnostic, "result");
      const result = await this.#await(deadline, () =>
        Reflect.apply(NATIVE_RESULT, client, [recovery.result_context!, deadline.signal]) as Promise<InternalOwnerSoulImageResult>);
      await this.#assertRecoveryPrincipal(recovery, deadline);
      recovery.diagnostic.phase = "RESULT_BINDING"; recovery.diagnostic.result_status = result.status;
      if (result.status === "UNVERIFIED") {
        recovery.diagnostic.result_reason = result.reason;
        if (result.reason === "EXTRANEOUS_RESULT_OBJECTS" &&
            recovery.result_context!.message_object_ids.length < recovery.candidate.parameters.batch_size) {
          await this.#waitNext(recovery, deadline, startedAt, round); continue;
        }
        throw unknownError(recovery);
      }
      this.#mergeObservedArtifacts(recovery, result);
      if (result.status === "PENDING") {
        recovery.diagnostic.result_reason = result.reason;
        if (recovery.observed_artifacts.size > 0 &&
            recovery.result_context!.message_object_ids.length >= recovery.candidate.parameters.batch_size) {
          return resultFor(recovery, result, recovery.recovery_id);
        }
        if (recovery.observed_artifacts.size > 0 && round + 1 >= this.#maxPollAttempts) {
          return resultFor(recovery, result, recovery.recovery_id);
        }
        await this.#waitNext(recovery, deadline, startedAt, round); continue;
      }
      if (result.status === "PARTIAL") {
        recovery.diagnostic.result_reason = result.reason === "OBSERVED_RESULTS_PARTIAL" ? "OUTPUT_BATCH_PARTIAL" : result.reason;
        if (recovery.result_context!.message_object_ids.length < recovery.candidate.parameters.batch_size) {
          if (recovery.observed_artifacts.size > 0 && round + 1 >= this.#maxPollAttempts) {
            return resultFor(recovery, result, recovery.recovery_id);
          }
          await this.#waitNext(recovery, deadline, startedAt, round); continue;
        }
        if (recovery.observed_artifacts.size > 0) return resultFor(recovery, result, recovery.recovery_id);
        await this.#waitNext(recovery, deadline, startedAt, round); continue;
      }
      if (!isExactCompleteResult(result, recovery)) {
        recovery.diagnostic.result_status = "UNVERIFIED"; recovery.diagnostic.result_reason = "OUTPUT_BATCH_PARTIAL"; throw unknownError(recovery);
      }
      const observed = resultFor(recovery, result);
      this.#recoveries.delete(recovery.recovery_id);
      this.#unknownIntents.delete(recovery.semantic_key);
      if (this.#successCache.size < MAX_STATE_ENTRIES && recovery.candidate.expires_at_ms > this.#readNow()) {
        this.#successCache.set(recovery.semantic_key, { result: observed, expires_at: recovery.candidate.expires_at_ms });
      }
      return observed;
    }
    throw unknownError(recovery);
  }

  async #runPreflight(attemptId: string, candidate: OwnerSoulImagePreparedCandidate, signal: AbortSignal): Promise<void> {
    if (signal.aborted) fail("PRE_DISPATCH_FAILED");
    let accountService: AccountStatusService; let accessService: ModelAccessService;
    try {
      accountService = Reflect.apply(this.#createAccountStatusService, undefined, [attemptId]) as AccountStatusService;
      accessService = Reflect.apply(this.#createModelAccessService, undefined, [attemptId]) as ModelAccessService;
    } catch { fail("PREFLIGHT_FAILED"); }
      if (!isExactService(accountService, AccountStatusService, ["getAccountStatus"]) || this.#usedAccountServices.has(accountService) ||
        !isExactService(accessService, ModelAccessService, ["getModelAccess"]) || this.#usedAccessServices.has(accessService)) fail("PREFLIGHT_FAILED");
    this.#usedAccountServices.add(accountService);
    this.#usedAccessServices.add(accessService);
    let account: AccountStatusResult; let modelAccess: ModelAccessResult;
    try {
      account = await this.#awaitSignal(Reflect.apply(ACCOUNT_METHOD, accountService, [signal]) as Promise<AccountStatusResult>, signal);
      modelAccess = await this.#awaitSignal(Reflect.apply(ACCESS_METHOD, accessService, [Object.freeze({
        model_id: MODEL_ID, cost_parameters: candidate.cost_inputs
      }), signal]) as Promise<ModelAccessResult>, signal);
    } catch { fail("PREFLIGHT_FAILED"); }
    assertPreflight(account, modelAccess, candidate, this.#catalog, this.#readNow());
  }

  #assertCandidate(candidate: OwnerSoulImagePreparedCandidate, principal: Readonly<GenerationPrincipalRef>, attemptId: string,
    expectedProfile?: Readonly<OwnerSoulImageSourceProfile>): Readonly<OwnerSoulImageSourceProfile> {
    if (!this.#candidateGuard(candidate, attemptId, principal) ||
        candidate.status !== "PREPARED_SOURCE_SHAPED" || candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" ||
        candidate.provider_execution !== false || candidate.model_id !== MODEL_ID || candidate.ai_name !== MODEL_ID || candidate.model_type !== MODEL_ID ||
        candidate.catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION || candidate.source_projection_confidence !==
          "EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY" ||
        candidate.reference_strength !== "UNRESOLVED_UNCONTROLLED_WIRE_FIELD" || !SHA256.test(candidate.profile_schema_hash) ||
        !SHA256.test(candidate.request_fingerprint) || !SHA256.test(candidate.intent_fingerprint) ||
        !Number.isSafeInteger(candidate.expires_at_ms) || candidate.expires_at_ms <= this.#readNow()) fail("PRE_DISPATCH_FAILED");
    let profile: Readonly<OwnerSoulImageSourceProfile>;
    try { profile = getOwnerSoulImageSourceProfile(MODEL_ID, this.#catalog, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION); }
    catch { fail("MODEL_BINDING_MISMATCH"); }
    if (candidate.profile_id !== profile.profile_id || candidate.profile_schema_hash !== profile.profile_schema_hash ||
        candidate.catalog_version !== profile.public_catalog_version || profile.dispatch_allowed !== false || profile.runtime_activation !== false ||
        profile.backend_acceptance !== "UNPROVEN" || (expectedProfile && expectedProfile.profile_schema_hash !== profile.profile_schema_hash)) fail("MODEL_BINDING_MISMATCH");
    return profile;
  }

  #assertSynchronousCurrent(candidate: OwnerSoulImagePreparedCandidate, principal: Readonly<GenerationPrincipalRef>, attemptId: string,
    profile: Readonly<OwnerSoulImageSourceProfile>): void {
    this.#assertOpen();
    if (this.#invalidatingAttempts.has(attemptId) || !this.#candidateGuard(candidate, attemptId, principal)) fail("PRE_DISPATCH_FAILED");
    const current = this.#assertProfile();
    if (current.profile_schema_hash !== profile.profile_schema_hash) fail("MODEL_BINDING_MISMATCH");
  }

  #assertProfile(): Readonly<OwnerSoulImageSourceProfile> {
    let profile: Readonly<OwnerSoulImageSourceProfile>;
    try { profile = getOwnerSoulImageSourceProfile(MODEL_ID, this.#catalog, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION); }
    catch { fail("MODEL_BINDING_MISMATCH"); }
    const model = this.#catalog.getModel(MODEL_ID);
    if (profile.model_id !== MODEL_ID || profile.ai_name !== MODEL_ID || profile.model_type !== MODEL_ID || model.active !== true ||
        model.id !== MODEL_ID || model.ai_name !== MODEL_ID || model.upstream_id !== MODEL_ID || model.scope !== "image" ||
        !model.modalities.includes("image") || !model.operations.some((operation) => operation.id === "generate-image" && operation.output_modality === "image")) {
      fail("MODEL_BINDING_MISMATCH");
    }
    return profile;
  }

  #resolveNativeClient(attemptId: string): SyntxChatHttpClient {
    let client: unknown;
    try { client = Reflect.apply(this.#resolveChatClient, undefined, [attemptId]); } catch { fail("MODEL_BINDING_MISMATCH"); }
    if (!isExactService(client, SyntxChatHttpClient, ["createChat", "startSoulImageWithOwnedCandidate", "listMessageCandidates", "getSoulImageBatchResult"]) ||
        Reflect.get(client, "createChat") !== CHAT_CREATE || Reflect.get(client, "startSoulImageWithOwnedCandidate") !== NATIVE_START ||
        Reflect.get(client, "listMessageCandidates") !== NATIVE_HISTORY || Reflect.get(client, "getSoulImageBatchResult") !== NATIVE_RESULT) fail("MODEL_BINDING_MISMATCH");
    return client;
  }

  async #prepareCandidate(request: RunRequest, principal: Readonly<GenerationPrincipalRef>, deadline: AbsoluteRequestDeadline): Promise<OwnerSoulImagePreparedCandidate> {
    return await this.#await(deadline, () => Reflect.apply(PREPARER_PREPARE, this.#preparer,
      [{ attemptId: request.attemptId, principal, input: request.input, signal: deadline.signal }]) as Promise<OwnerSoulImagePreparedCandidate>);
  }

  #candidateGuard(candidate: unknown, attemptId: string, principal: Readonly<GenerationPrincipalRef>): boolean {
    try { return Reflect.apply(PREPARER_GUARD, this.#preparer, [candidate, { attemptId, principal }]) === true; }
    catch { return false; }
  }

  async #resolvePrincipal(attemptId: string, signal: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    this.#assertOpen(); if (signal.aborted || this.#invalidatingAttempts.has(attemptId)) fail("PRINCIPAL_NOT_LINKED");
    try { return await this.#awaitSignal(resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService }), signal); }
    catch (caught) { if (caught instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED"); throw caught; }
  }

  async #assertRecoveryPrincipal(recovery: Recovery, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted();
    const principal = await this.#await(deadline, () => this.#resolvePrincipal(recovery.attemptId, deadline.signal));
    if (!sameGenerationPrincipal(principal, recovery.principal) || this.#closed || this.#invalidatingAttempts.has(recovery.attemptId) ||
        (recovery.expires_at !== null && recovery.expires_at <= this.#readNow())) throw unknownError(recovery);
    const profile = this.#assertProfile();
    if (profile.profile_schema_hash !== recovery.profile.profile_schema_hash) throw unknownError(recovery);
  }

  #mergeObservedArtifacts(recovery: Recovery, result: InternalOwnerSoulImageResult): void {
    if (!recovery.result_context) throw unknownError(recovery);
    const expected = new Set(recovery.result_context.message_object_ids);
    for (const artifact of result.artifacts) {
      if (!expected.has(artifact.message_object_id)) {
        recovery.diagnostic.result_status = "UNVERIFIED"; recovery.diagnostic.result_reason = "OBJECT_ID_MISMATCH";
        throw unknownError(recovery);
      }
      const existing = recovery.observed_artifacts.get(artifact.message_object_id);
      if (existing && (existing.message_id !== artifact.message_id || existing.object_type !== artifact.object_type ||
          existing.model_type !== artifact.model_type || existing.completed !== artifact.completed)) {
        recovery.diagnostic.result_status = "UNVERIFIED"; recovery.diagnostic.result_reason = "OUTPUT_BATCH_PARTIAL";
        throw unknownError(recovery);
      }
      // The exact history-bound object ID is stable evidence; an allowlisted result URL may rotate between GETs.
      recovery.observed_artifacts.set(artifact.message_object_id, artifact);
    }
  }

  async #waitNext(recovery: Recovery, deadline: AbsoluteRequestDeadline, startedAt: number, round: number): Promise<void> {
    const now = this.#readNow();
    if (round + 1 >= this.#maxPollAttempts || now - startedAt >= this.#timeoutMs || this.#pollDelayMs === 0) {
      if (this.#pollDelayMs === 0 && round + 1 < this.#maxPollAttempts && now - startedAt < this.#timeoutMs) return;
      throw unknownError(recovery);
    }
    recovery.diagnostic.phase = "RESULT_WAIT";
    await this.#await(deadline, () => waitDelay(Math.min(this.#pollDelayMs, Math.max(0, this.#timeoutMs - (now - startedAt))), deadline.signal));
  }

  #deadline(signal: AbortSignal, errorFactory?: () => Error): AbsoluteRequestDeadline {
    return new AbsoluteRequestDeadline(this.#timeoutMs, signal, () => errorFactory?.() ?? generationError("PRE_DISPATCH_FAILED"));
  }
  async #await<T>(deadline: AbsoluteRequestDeadline, operation: () => Promise<T> | T): Promise<T> {
    deadline.throwIfAborted(); let pending: Promise<T>; try { pending = Promise.resolve(operation()); } catch (error) { throw error; }
    return deadline.waitFor(pending);
  }
  async #awaitSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw generationError("PRE_DISPATCH_FAILED");
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(generationError("PRE_DISPATCH_FAILED"));
      signal.addEventListener("abort", abort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }
  #readNowFrom(clock: () => number): number {
    let now: unknown; try { now = Reflect.apply(clock, undefined, []); } catch { fail("PRE_DISPATCH_FAILED"); }
    if (!Number.isSafeInteger(now) || (now as number) < 0 || (now as number) < this.#lastNow) fail("PRE_DISPATCH_FAILED");
    this.#lastNow = now as number; return now as number;
  }
  #readNow(): number { return this.#now(); }
  #pruneSuccess(now: number): void {
    for (const [key, cached] of this.#successCache) if (cached.expires_at <= now) this.#successCache.delete(key);
  }
  #pruneRecoveries(now: number): void {
    for (const [key, recovery] of this.#recoveries) {
      if (recovery.expires_at !== null && recovery.expires_at <= now) this.#recoveries.delete(key);
    }
  }
  #run<T>(attemptId: string, externalSignal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.#assertOpen();
    if (this.#invalidatingAttempts.has(attemptId) || this.#runs.size >= MAX_PENDING_RUNS) fail("SERVICE_BUSY");
    if (externalSignal !== undefined && (types.isProxy(externalSignal) || !(externalSignal instanceof AbortSignal))) fail("INVALID_REQUEST");
    const controller = new AbortController();
    const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
    const bucket = this.#controllersByAttempt.get(attemptId) ?? new Set<AbortController>(); bucket.add(controller);
    this.#controllersByAttempt.set(attemptId, bucket);
    let run!: Run;
    const promise = Promise.resolve().then(() => operation(signal)).finally(() => {
      bucket.delete(controller); if (!bucket.size) this.#controllersByAttempt.delete(attemptId);
      this.#runs.delete(run);
    });
    run = { attemptId, controller, promise };
    this.#runs.add(run);
    return promise;
  }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
}

function assertPreflight(accountInput: unknown, accessInput: unknown, candidate: OwnerSoulImagePreparedCandidate,
  catalog: DiscoveryCatalogRepository, now: number): void {
  try {
    const account = exactRecord(accountInput, ["balance", "subscription", "contract_evidence", "source_build", "observed_at"]);
    const balance = exactRecord(account.balance, ["unit", "available"]);
    const subscription = exactRecord(account.subscription, ["active", "plan_type", "end_date", "end_date_kind"]);
    const access = exactRecord(accessInput, ["catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live",
      "parameter_keys", "parameters_redacted", "access", "cost", "discount_cost", "free_remaining_generations", "limit", "show_warning", "observed_at"]);
    const expectedKeys = Object.keys(candidate.cost_inputs).sort();
    const actualKeys = denseStrings(access.parameter_keys);
    const model = catalog.getModel(MODEL_ID);
    const currentCatalogVersion = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
    if (account.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || account.source_build !== ACCOUNT_SOURCE_BUILD || balance.unit !== "tokens" ||
        !(balance.available === null || validBalance(balance.available)) || !validSubscription(subscription, now) ||
        !isFreshIso(account.observed_at, now) || access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" ||
        access.catalog_version !== currentCatalogVersion || access.model_id !== MODEL_ID || access.ai_name !== MODEL_ID ||
        access.model_type !== MODEL_ID || access.account_read_live !== true || access.access !== true || access.parameters_redacted !== true ||
        actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index]) ||
        !isFreshIso(access.observed_at, now) || !nullableFinite(access.cost) || !nullableFinite(access.discount_cost) ||
        !(access.free_remaining_generations === null || nonnegativeInteger(access.free_remaining_generations)) ||
        !nullableFinite(access.limit) || !(access.show_warning === null || typeof access.show_warning === "boolean") ||
        model.active !== true || model.id !== MODEL_ID || model.upstream_id !== MODEL_ID || model.ai_name !== MODEL_ID ||
        model.scope !== "image" || !model.modalities.includes("image") ||
        !model.operations.some((operation) => operation.id === "generate-image" && operation.output_modality === "image")) fail("PREFLIGHT_FAILED");
  } catch (caught) { if (caught instanceof OwnerSoulImageGenerationServiceError) throw caught; fail("PREFLIGHT_FAILED"); }
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
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= MAX_CLOCK_SKEW_MS && new Date(timestamp).toISOString() === value;
}
function historyProfileBinding(recovery: Recovery): OwnerSoulImageHistoryProfileBinding {
  return Object.freeze({ profile_id: recovery.profile.profile_id, model_id: MODEL_ID, catalog_version: recovery.profile.public_catalog_version,
    profile_schema_hash: recovery.profile.profile_schema_hash, request_fingerprint: recovery.candidate.request_fingerprint,
    intent_fingerprint: recovery.candidate.intent_fingerprint });
}
function isExactCompleteResult(result: InternalOwnerSoulImageResult, recovery: Recovery): result is Extract<InternalOwnerSoulImageResult, { status: "COMPLETE" }> {
  const count = recovery.candidate.parameters.batch_size;
  const ids = recovery.result_context?.message_object_ids;
  return result.status === "COMPLETE" && ids !== undefined && result.requested_batch_size === count && result.actual_result_count === count &&
    ids.length === count && result.message_object_ids.length === count && result.artifacts.length === count &&
    result.artifacts.every((artifact, index) => artifact.message_object_id === ids[index] && artifact.model_type === MODEL_ID && artifact.completed);
}
function resultFor(recovery: Recovery, result: InternalOwnerSoulImageResult,
  recoveryId?: string): OwnerSoulImageGenerationResult {
  const partial = result.status !== "COMPLETE" || recoveryId !== undefined;
  const orderedArtifacts = recovery.result_context?.message_object_ids.flatMap((id) => {
    const artifact = recovery.observed_artifacts.get(id);
    return artifact ? [Object.freeze({ ...artifact })] : [];
  }) ?? [];
  return Object.freeze({ status: partial ? "partial_results" : "result_observed", dispatch_allowed: false, backend_acceptance: "UNPROVEN",
    provider_execution: false, model_id: MODEL_ID, profile_id: recovery.profile.profile_id,
    profile_schema_hash: recovery.profile.profile_schema_hash, catalog_version: recovery.profile.public_catalog_version,
    request_fingerprint: recovery.candidate.request_fingerprint, intent_fingerprint: recovery.candidate.intent_fingerprint,
    parameters: recovery.candidate.parameters, selection: recovery.candidate.selection, cost_routing: recovery.candidate.cost_routing,
    cost_inputs: recovery.candidate.cost_inputs, source_projection_confidence: recovery.candidate.source_projection_confidence,
    reference_strength: recovery.candidate.reference_strength, requested_batch_size: recovery.candidate.parameters.batch_size,
    actual_result_count: Math.max(result.actual_result_count, recovery.observed_artifacts.size),
    count_confidence: partial ? "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL" : "CURRENT_VERIFIED_MESSAGE_MATCHES_EXPLICIT_BATCH_SIZE",
    artifacts: Object.freeze(orderedArtifacts),
    ...(recoveryId ? { recovery_id: recoveryId } : {}) });
}
function snapshotDiagnostic(value: MutableDiagnostic): OwnerSoulImageGenerationDiagnostic { return Object.freeze({ ...value }); }
function initialDiagnostic(): MutableDiagnostic {
  return { phase: "REQUEST_PREPARE", post_started: false, echo_ack_known: false, history_status: "NONE", history_reason: null,
    result_status: "NOT_READ", result_reason: null, history_get_calls: 0, history_get_calls_saturated: false,
    result_get_calls: 0, result_get_calls_saturated: false };
}
function incrementDiagnostic(diagnostic: MutableDiagnostic, target: "history" | "result"): void {
  const countKey = target === "history" ? "history_get_calls" : "result_get_calls";
  const saturatedKey = target === "history" ? "history_get_calls_saturated" : "result_get_calls_saturated";
  if (diagnostic[countKey] >= 255) { diagnostic[saturatedKey] = true; return; }
  diagnostic[countKey] += 1;
}
function unknownError(recovery: Recovery): OwnerSoulImageGenerationServiceError {
  return generationError("OUTCOME_UNKNOWN", recovery.recovery_id, snapshotDiagnostic(recovery.diagnostic));
}
function generationError(code: OwnerSoulImageGenerationServiceErrorCode, recoveryId?: string,
  diagnostic?: OwnerSoulImageGenerationDiagnostic): OwnerSoulImageGenerationServiceError {
  return new OwnerSoulImageGenerationServiceError(code, recoveryId, diagnostic);
}
function semanticIntentKey(principal: Readonly<GenerationPrincipalRef>, candidate: OwnerSoulImagePreparedCandidate): string {
  return createHash("sha256").update(JSON.stringify([principal.tenant_id, principal.subject_id, MODEL_ID, candidate.intent_fingerprint])).digest("hex");
}
function snapshotGenerate(value: unknown): Readonly<RunRequest> {
  const fields = exactRecord(value, ["attemptId", "input"]);
  const attemptId = safeAttempt(fields.attemptId);
  let input: Readonly<OwnerSoulGenerationParametersInput>;
  try { input = normalizeOwnerSoulGenerationParameters(fields.input).intent; }
  catch { fail("INVALID_REQUEST"); }
  return Object.freeze({ attemptId, input });
}
function snapshotReconcile(value: unknown): Readonly<OwnerSoulImageReconcileInput> {
  const fields = exactRecord(value, ["attemptId", "recovery_id"]);
  const attemptId = safeAttempt(fields.attemptId);
  if (typeof fields.recovery_id !== "string" || !/^soul_image_recovery_[0-9a-f-]{36}$/u.test(fields.recovery_id)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId, recovery_id: fields.recovery_id });
}
function snapshotRecoveryList(value: unknown): Readonly<OwnerSoulImageRecoveryListInput> {
  const fields = exactRecord(value, ["attemptId"], ["limit"]);
  const attemptId = safeAttempt(fields.attemptId);
  const limit = fields.limit === undefined ? 20 : bounded(fields.limit, 1, 20, 20);
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
  const own = Object.getOwnPropertyDescriptor(value, "getStatus");
  const proto = Object.getPrototypeOf(value); const inherited = proto && Object.getOwnPropertyDescriptor(proto, "getStatus");
  const method = own && "value" in own ? own.value : inherited && "value" in inherited ? inherited.value : undefined;
  if (typeof method !== "function" || types.isProxy(method)) fail("INVALID_REQUEST");
  return Object.freeze({ getStatus: (binding, attemptId) => Reflect.apply(method, value, [binding, attemptId]) }) as Pick<PerUserLinkService, "getStatus">;
}
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
  let descriptors: PropertyDescriptorMap; try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(descriptors); const allowed = [...required, ...optional];
  if (required.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) => typeof key !== "string" || !allowed.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function denseStrings(value: unknown): string[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 16) fail("PREFLIGHT_FAILED");
  const descriptors = Object.getOwnPropertyDescriptors(value); const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || !keys.includes("length")) fail("PREFLIGHT_FAILED");
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") fail("PREFLIGHT_FAILED");
    return descriptor.value;
  });
}
function safeAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST"); return value; }
function safeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function isOrderedSubsequence(previous: readonly string[], current: readonly string[]): boolean {
  let previousIndex = 0;
  for (const id of current) if (id === previous[previousIndex]) previousIndex += 1;
  return previousIndex === previous.length;
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
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return value as () => number;
}
function waitDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(generationError("PRE_DISPATCH_FAILED")); return; }
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    const abort = () => { clearTimeout(timer); reject(generationError("PRE_DISPATCH_FAILED")); };
    signal.addEventListener("abort", abort, { once: true });
  });
}
function fail(code: OwnerSoulImageGenerationServiceErrorCode): never { throw generationError(code); }
