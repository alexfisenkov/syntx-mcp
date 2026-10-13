import { randomUUID } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import {
  SyntxChatHttpClient,
  OwnerVideo2AudioNativeError,
  type OwnerVideo2AudioAuthorizeGet,
  type OwnerVideo2AudioNativeErrorCode,
  type MediaGenerationReceipt,
  type OwnerVideo2AudioChatContext,
  type OwnerVideo2AudioResultCandidates,
  type OwnerVideo2AudioResultMessageContext
} from "../adapter/syntx/chat-http-client.js";
import type { OwnerVideo2AudioReadyArtifact, OwnerVideo2AudioResult, OwnerVideo2AudioHistoryGapCode,
  OwnerVideo2AudioResultGapCode } from "./owner-video2audio-result-codec.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import type { AccountStatusResult } from "./account-status.js";
import type { ModelAccessResult } from "./model-access.js";
import {
  isAuthenticOwnerVideo2AudioSourceProfile,
  type OwnerVideo2AudioSourceProfile
} from "./owner-video2audio-source-profile.js";
import {
  isOwnerVideo2AudioRequestPreparer,
  OwnerVideo2AudioRequestPreparerError,
  type OwnerVideo2AudioCandidateBinding,
  type OwnerVideo2AudioPreparedCandidate,
  type OwnerVideo2AudioRequestPreparer
} from "./owner-video2audio-request-preparer.js";
import {
  createOwnerVideo2AudioOneShotPermit,
  isOwnerVideo2AudioOneShotPermit,
  OwnerVideo2AudioOneShotPolicyError
} from "./owner-video2audio-one-shot-policy.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY_ID = /^video2audio_generation_recovery_[0-9a-f-]{36}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_PROVIDER_CHAT_ID = /^\d{1,16}$/u;
const MAX_INTENTS = 128;
const MAX_RECOVERIES = 128;
const MAX_NATIVE_CLIENTS = 128;
const MAX_ACTIVE_RUNS = 4;
const MAX_ARTIFACTS = 4096;
const RESULT_PAGE_SIZE = 64;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_DELAY_MS = 250;
const DEFAULT_MAX_POLL_ATTEMPTS = 3;
const DIAGNOSTIC_COUNTER_MAX = 255;
const VIDEO2AUDIO_MODEL_ID = "video2audio" as const;
const SERVICE_INSTANCES = new WeakSet<object>();

export type OwnerVideo2AudioServicePhase =
  | "VALIDATE_REQUEST" | "PREPARE_CANDIDATE" | "RESOLVE_PRINCIPAL" | "PREFLIGHT_ONE" | "CHAT_CREATE"
  | "PREFLIGHT_TWO" | "GENERATION_POST" | "POST_ACK_KNOWN" | "HISTORY_GET" | "RESULT_GET" | "RESULT_BINDING";

export type OwnerVideo2AudioServiceGapCode =
  | OwnerVideo2AudioHistoryGapCode | OwnerVideo2AudioResultGapCode | "POST_ACK_UNKNOWN" | "HISTORY_UNAVAILABLE"
  | "RESULT_CONTEXT_INVALID" | "RESULT_GET_UNAVAILABLE" | "GET_AUTHORIZATION_FAILED" | "RESULT_LIMIT_EXCEEDED"
  | "VIDEO2AUDIO_RESULT_UNVERIFIED" | "CHAT_CREATE_UNKNOWN";

const SERVICE_GAPS = new Set<string>([
  "POST_ACK_UNKNOWN", "HISTORY_UNAVAILABLE", "RESULT_CONTEXT_INVALID", "RESULT_GET_UNAVAILABLE", "GET_AUTHORIZATION_FAILED",
  "RESULT_LIMIT_EXCEEDED", "VIDEO2AUDIO_RESULT_UNVERIFIED", "CHAT_CREATE_UNKNOWN",
  "HISTORY_INPUT_INVALID", "HISTORY_PAGES_MISSING", "HISTORY_PAGE_INVALID", "HISTORY_PAGE_LIMIT", "HISTORY_PAGE_INCONSISTENT",
  "HISTORY_MESSAGE_LIMIT", "HISTORY_ROW_INVALID", "HISTORY_ROW_CHAT_MISMATCH", "HISTORY_ROW_DUPLICATE", "HISTORY_OBJECTS_INVALID",
  "HISTORY_OBJECT_ID_INVALID", "HISTORY_OBJECT_ID_DUPLICATE", "HISTORY_OBJECT_MESSAGE_MISMATCH", "OWNER_ACK_MISSING",
  "OWNER_ACK_MISMATCH", "OWNER_ACK_AMBIGUOUS", "RESULT_OBJECT_IDS_INVALID", "RESULT_OBJECT_MODEL_MISMATCH", "BOT_RESULT_NOT_OBSERVED",
  "ENVELOPE_SHAPE_INVALID", "OUTER_MESSAGE_ID_MISMATCH", "NOT_BOT_MESSAGE", "PROVIDER_CHAT_ID_MISMATCH",
  "UNRECOGNIZED_MESSAGE_FIELDS", "MESSAGE_OBJECT_ARRAY_INVALID", "MESSAGE_OBJECT_ARRAY_EMPTY", "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT",
  "UNRECOGNIZED_OBJECT_FIELDS", "OBJECT_ENTRY_INVALID", "OBJECT_ID_UNAVAILABLE", "OBJECT_ID_DUPLICATE", "OBJECT_ID_UNEXPECTED",
  "EXPECTED_OBJECT_ID_MISSING", "OBJECT_MESSAGE_ID_MISMATCH", "OBJECT_TYPE_UNSUPPORTED", "OBJECT_INCOMPLETE",
  "OBJECT_COMPLETION_UNKNOWN", "OBJECT_URL_MISSING", "OBJECT_URL_INVALID", "OBJECT_URL_UNSAFE", "MIME_TYPE_UNKNOWN",
  "MODEL_TYPE_UNAVAILABLE", "MODEL_TYPE_MISMATCH"
]);

export interface OwnerVideo2AudioDiagnostic {
  readonly phase: OwnerVideo2AudioServicePhase;
  readonly post_started: boolean;
  readonly ack_known: boolean;
  readonly history_status: "NOT_READ" | "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "NOT_READ" | "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  readonly history_get_calls: number;
  readonly result_get_calls: number;
  readonly result_status: "NOT_READ" | "PENDING" | "PARTIAL" | "COMPLETE" | "UNVERIFIED";
  readonly gaps: readonly OwnerVideo2AudioServiceGapCode[];
  readonly counters_saturated: boolean;
}

export interface OwnerVideo2AudioGenerationArtifact {
  readonly url: string;
  readonly mime_type: OwnerVideo2AudioReadyArtifact["mime_type"];
  readonly mime_source: OwnerVideo2AudioReadyArtifact["mime_source"];
  readonly object_type: OwnerVideo2AudioReadyArtifact["object_type"];
  readonly object_index: number;
  readonly model_echo: OwnerVideo2AudioReadyArtifact["model_echo"];
}

export interface OwnerVideo2AudioGenerationResult {
  readonly status: "PENDING" | "PARTIAL" | "COMPLETE" | "UNVERIFIED";
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly backend_acceptance: "UNPROVEN";
  readonly provider_terminal_status: "UNPROVEN";
  readonly model_id: typeof VIDEO2AUDIO_MODEL_ID;
  readonly source_binding: Readonly<{
    public_catalog_version: OwnerVideo2AudioSourceProfile["source"]["source_pins"]["public_catalog_version"];
    settings_inventory_version: OwnerVideo2AudioSourceProfile["source"]["source_pins"]["settings_inventory_version"];
    form_sha256: OwnerVideo2AudioSourceProfile["source"]["source_pins"]["form_sha256"];
  }>;
  readonly recovery_id: string;
  readonly observed_artifact_count: number;
  readonly offset: number;
  readonly page_size: typeof RESULT_PAGE_SIZE;
  readonly artifacts: readonly OwnerVideo2AudioGenerationArtifact[];
  readonly has_more: boolean;
  readonly next_offset: number | null;
  readonly diagnostic: OwnerVideo2AudioDiagnostic;
}

export interface OwnerVideo2AudioRecoveryListItem {
  readonly recovery_id: string;
  readonly created_at: string;
  readonly model_id: typeof VIDEO2AUDIO_MODEL_ID;
  readonly status: "outcome_unknown" | "pending" | "partial_results" | "completed";
  readonly observed_artifact_count: number;
  readonly diagnostic: OwnerVideo2AudioDiagnostic;
}

export interface OwnerVideo2AudioGenerationServiceOptions {
  readonly profile: OwnerVideo2AudioSourceProfile;
  readonly preparer: OwnerVideo2AudioRequestPreparer;
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveCurrentAccountLimits: (attemptId: string, signal?: AbortSignal) => Promise<AccountStatusResult>;
  readonly resolveModelAccess: (attemptId: string, request: Readonly<{
    model_id: typeof VIDEO2AUDIO_MODEL_ID;
    cost_parameters: Readonly<Record<string, never>>;
  }>, signal?: AbortSignal) => Promise<ModelAccessResult>;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly pollDelayMs?: number;
  readonly maxPollAttempts?: number;
}

export interface OwnerVideo2AudioGenerateInput {
  readonly attemptId: string;
  readonly prompt: string;
  readonly video_original_handle: string;
}
export interface OwnerVideo2AudioReconcileInput { readonly attemptId: string; readonly recovery_id: string; }
export interface OwnerVideo2AudioRecoveryListInput { readonly attemptId: string; readonly limit?: number; }
export interface OwnerVideo2AudioResultPageInput { readonly attemptId: string; readonly recovery_id: string; readonly offset?: number; }

export type OwnerVideo2AudioGenerationServiceErrorCode =
  | "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH"
  | "SUBSCRIPTION_REQUIRED" | "PREFLIGHT_FAILED" | "INTENT_ALREADY_CLAIMED" | "CAPACITY_EXCEEDED"
  | "CHAT_CREATE_UNKNOWN" | "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND";

export class OwnerVideo2AudioGenerationServiceError extends Error {
  readonly diagnostic?: OwnerVideo2AudioDiagnostic;
  constructor(readonly code: OwnerVideo2AudioGenerationServiceErrorCode, readonly recovery_id?: string,
    diagnostic?: OwnerVideo2AudioDiagnostic) {
    super(code === "OUTCOME_UNKNOWN"
      ? "The Video2Audio generation may have been dispatched; reconcile this recovery and do not retry."
      : "The owner Video2Audio generation could not be completed safely.");
    this.name = "OwnerVideo2AudioGenerationServiceError";
    if ((code === "OUTCOME_UNKNOWN" || code === "CHAT_CREATE_UNKNOWN") && diagnostic) this.diagnostic = diagnostic;
  }
}

interface MutableDiagnostic {
  phase: OwnerVideo2AudioServicePhase;
  post_started: boolean;
  ack_known: boolean;
  history_status: OwnerVideo2AudioDiagnostic["history_status"];
  owner_ack_status: OwnerVideo2AudioDiagnostic["owner_ack_status"];
  history_get_calls: number;
  result_get_calls: number;
  result_status: OwnerVideo2AudioDiagnostic["result_status"];
  gaps: OwnerVideo2AudioServiceGapCode[];
  counters_saturated: boolean;
}

interface InternalArtifact extends OwnerVideo2AudioGenerationArtifact {
  readonly message_object_id: string;
}

type ClaimStatus = "RESERVED" | "CHAT_CREATED_NO_DISPATCH" | "CHAT_CREATE_UNKNOWN" | "OUTCOME_UNKNOWN"
  | "PENDING" | "PARTIAL_RESULTS" | "COMPLETE" | "INVALIDATED";
interface SemanticClaim {
  readonly owner_key: string;
  readonly intent_fingerprint: string;
  status: ClaimStatus;
}

interface Recovery {
  readonly recovery_id: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly source_profile_schema_hash: string;
  readonly intent_fingerprint: string;
  readonly semantic_key: string;
  readonly created_at: string;
  readonly source_binding: OwnerVideo2AudioSourceProfile["source"]["source_pins"];
  readonly client: NativeClient;
  readonly chat: OwnerVideo2AudioChatContext;
  readonly diagnostic: MutableDiagnostic;
  owner_echo_message_id: string | null;
  status: "outcome_unknown" | "pending" | "partial_results" | "completed";
  artifacts: readonly InternalArtifact[];
}

interface NativeClient extends SyntxChatHttpClient {
  createVideo2AudioChat(input: unknown, signal?: AbortSignal): Promise<OwnerVideo2AudioChatContext>;
  startVideo2AudioWithOwnedCandidate(input: unknown, signal?: AbortSignal): Promise<MediaGenerationReceipt>;
  listOwnedVideo2AudioResultCandidates(input: unknown, signal?: AbortSignal): Promise<OwnerVideo2AudioResultCandidates>;
  getOwnedVideo2AudioResult(input: unknown, signal?: AbortSignal): Promise<OwnerVideo2AudioResult>;
  invalidateVideo2AudioAttempt(attemptId: string): number;
}

interface ActiveRun { readonly attemptId: string; readonly controller: AbortController; readonly done: Promise<void>; promise: Promise<unknown>; }

const NATIVE_CLIENT_PROTO = SyntxChatHttpClient.prototype;
const NATIVE_CREATE = NATIVE_CLIENT_PROTO.createVideo2AudioChat;
const NATIVE_START = NATIVE_CLIENT_PROTO.startVideo2AudioWithOwnedCandidate;
const NATIVE_HISTORY = NATIVE_CLIENT_PROTO.listOwnedVideo2AudioResultCandidates;
const NATIVE_RESULT = NATIVE_CLIENT_PROTO.getOwnedVideo2AudioResult;
const NATIVE_INVALIDATE = NATIVE_CLIENT_PROTO.invalidateVideo2AudioAttempt;
const RECOVERY_READ_CONTEXT_MAX = 64;

/** Single-dispatch owner Video2Audio service with process-local GET-only recovery. */
export class OwnerVideo2AudioGenerationService {
  readonly #profile: OwnerVideo2AudioSourceProfile;
  readonly #preparer: OwnerVideo2AudioRequestPreparer;
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #resolveCurrentAccountLimits: OwnerVideo2AudioGenerationServiceOptions["resolveCurrentAccountLimits"];
  readonly #resolveModelAccess: OwnerVideo2AudioGenerationServiceOptions["resolveModelAccess"];
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #pollDelayMs: number;
  readonly #maxPollAttempts: number;
  readonly #claims = new Map<string, SemanticClaim>();
  readonly #activeRecoveryByIntent = new Map<string, string>();
  readonly #recoveries = new Map<string, Recovery>();
  readonly #clientsByAttempt = new Map<string, Set<NativeClient>>();
  readonly #runs = new Set<ActiveRun>();
  readonly #invalidating = new Set<string>();
  readonly #invalidation = new Map<string, Promise<void>>();
  #lastNow = -1;
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(optionsInput: OwnerVideo2AudioGenerationServiceOptions | unknown) {
    const fields = exactRecord(optionsInput, ["profile", "preparer", "binding", "linkService", "resolveCurrentAccountLimits", "resolveModelAccess"],
      ["now", "timeoutMs", "pollDelayMs", "maxPollAttempts"]);
    if (new.target !== OwnerVideo2AudioGenerationService || !isAuthenticOwnerVideo2AudioSourceProfile(fields.profile) ||
        !isOwnerVideo2AudioRequestPreparer(fields.preparer) || !isExactPerUserLinkService(fields.linkService) ||
        typeof fields.resolveCurrentAccountLimits !== "function" || types.isProxy(fields.resolveCurrentAccountLimits) ||
        typeof fields.resolveModelAccess !== "function" || types.isProxy(fields.resolveModelAccess)) invalid();
    this.#profile = fields.profile;
    this.#preparer = fields.preparer;
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = fields.linkService;
    this.#resolveCurrentAccountLimits = fields.resolveCurrentAccountLimits as OwnerVideo2AudioGenerationServiceOptions["resolveCurrentAccountLimits"];
    this.#resolveModelAccess = fields.resolveModelAccess as OwnerVideo2AudioGenerationServiceOptions["resolveModelAccess"];
    this.#now = readClockFactory(fields.now);
    this.#timeoutMs = bounded(fields.timeoutMs, 1_000, 210_000, DEFAULT_TIMEOUT_MS);
    this.#pollDelayMs = bounded(fields.pollDelayMs, 0, 5_000, DEFAULT_POLL_DELAY_MS);
    this.#maxPollAttempts = bounded(fields.maxPollAttempts, 1, 5, DEFAULT_MAX_POLL_ATTEMPTS);
    this.#assertProfileBinding();
    SERVICE_INSTANCES.add(this);
    Object.freeze(this);
  }

  async generate(input: OwnerVideo2AudioGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerVideo2AudioGenerationResult> {
    const request = snapshotGenerate(input);
    return this.#run(request.attemptId, signal, (runSignal) => this.#generate(request, runSignal));
  }

  async reconcile(input: OwnerVideo2AudioReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerVideo2AudioGenerationResult> {
    const request = snapshotReconcile(input);
    const recovery = this.#recoveries.get(request.recovery_id);
    if (!recovery || recovery.attemptId !== request.attemptId) fail("RECOVERY_NOT_FOUND");
    return this.#run(request.attemptId, signal, async (runSignal) => {
      const deadline = this.#deadline(runSignal);
      try {
        const principal = await this.#resolvePrincipal(request.attemptId, runSignal);
        if (!sameGenerationPrincipal(principal, recovery.principal) || this.#invalidating.has(request.attemptId)) {
          throw unknownError(recovery);
        }
        if (recovery.status === "completed") return pageResult(recovery, 0);
        return await this.#observe(recovery, deadline);
      } finally {
        deadline.close();
      }
    });
  }

  async listRecoveries(input: OwnerVideo2AudioRecoveryListInput | unknown, signal?: AbortSignal): Promise<readonly OwnerVideo2AudioRecoveryListItem[]> {
    const request = snapshotRecoveryList(input);
    return this.#run(request.attemptId, signal, async (runSignal) => {
      const principal = await this.#resolvePrincipal(request.attemptId, runSignal);
      if (this.#invalidating.has(request.attemptId)) fail("PRINCIPAL_NOT_LINKED");
      return Object.freeze([...this.#recoveries.values()].filter((item) => item.attemptId === request.attemptId &&
        sameGenerationPrincipal(item.principal, principal))
        .sort((left, right) => left.created_at.localeCompare(right.created_at)).slice(0, request.limit)
        .map((item) => Object.freeze({ recovery_id: item.recovery_id, created_at: item.created_at, model_id: VIDEO2AUDIO_MODEL_ID,
          status: item.status, observed_artifact_count: item.artifacts.length,
          diagnostic: snapshotDiagnostic(item.diagnostic) })));
    });
  }

  async getResultPage(input: OwnerVideo2AudioResultPageInput | unknown, signal?: AbortSignal): Promise<OwnerVideo2AudioGenerationResult> {
    const request = snapshotResultPage(input);
    return this.#run(request.attemptId, signal, async (runSignal) => {
      const principal = await this.#resolvePrincipal(request.attemptId, runSignal);
      const recovery = this.#recoveries.get(request.recovery_id);
      if (this.#invalidating.has(request.attemptId) || !recovery || recovery.attemptId !== request.attemptId ||
          !sameGenerationPrincipal(recovery.principal, principal)) fail("RECOVERY_NOT_FOUND");
      if (recovery.status === "outcome_unknown") throw unknownError(recovery);
      return pageResult(recovery, request.offset);
    });
  }

  async invalidateAttempt(attemptIdInput: unknown): Promise<void> {
    const attemptId = readAttempt(attemptIdInput);
    return this.#invalidateAttempt(attemptId);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    const attempts = new Set([...this.#runs].map((run) => run.attemptId));
    for (const attemptId of this.#clientsByAttempt.keys()) attempts.add(attemptId);
    for (const recovery of this.#recoveries.values()) attempts.add(recovery.attemptId);
    this.#closing = (async () => {
      await Promise.all([...attempts].map((attemptId) => this.#invalidateAttempt(attemptId)));
      await this.#preparer.close();
      this.#claims.clear(); this.#activeRecoveryByIntent.clear(); this.#recoveries.clear(); this.#clientsByAttempt.clear();
      this.#invalidation.clear();
    })();
    return this.#closing;
  }

  async #generate(request: Readonly<OwnerVideo2AudioGenerateInput>, signal: AbortSignal): Promise<OwnerVideo2AudioGenerationResult> {
    const deadline = this.#deadline(signal);
    let semanticKey: string | undefined;
    let claim: SemanticClaim | undefined;
    let recovery: Recovery | undefined;
    let candidate: OwnerVideo2AudioPreparedCandidate | undefined;
    let candidateBinding: Readonly<OwnerVideo2AudioCandidateBinding> | undefined;
    let nativeClient: NativeClient | undefined;
    let chatCreated = false;
    let generationMethodStarted = false;
    try {
      deadline.throwIfAborted();
      this.#assertProfileBinding();
      const principal = await this.#resolvePrincipal(request.attemptId, deadline.signal);
      candidate = await this.#await(deadline, () => this.#preparer.prepare({ attemptId: request.attemptId,
        prompt: request.prompt, video_original_handle: request.video_original_handle }, deadline.signal));
      candidateBinding = this.#preparer.inspectCandidate(candidate);
      if (!candidateBinding || candidateBinding.attempt_id !== request.attemptId ||
          !sameGenerationPrincipal(candidateBinding.principal, principal) ||
          candidateBinding.profile_schema_hash !== this.#profile.profileSchemaHash ||
          candidateBinding.source_binding.public_catalog_version !== this.#profile.source.source_pins.public_catalog_version ||
          candidateBinding.source_binding.settings_inventory_version !== this.#profile.source.source_pins.settings_inventory_version ||
          candidateBinding.expires_at <= this.#readNow()) fail("MODEL_BINDING_MISMATCH");
      semanticKey = semanticIntentKey(principal, candidateBinding.intent_fingerprint);
      const existing = this.#claim(semanticKey, principal, candidateBinding.intent_fingerprint);
      claim = existing.claim;
      if (existing.existingRecovery) {
        if (existing.existingRecovery.status === "outcome_unknown") throw unknownError(existing.existingRecovery);
        return pageResult(existing.existingRecovery, 0);
      }
      if (!existing.isNew) fail("INTENT_ALREADY_CLAIMED");

      await this.#runPreflight(request.attemptId, principal, deadline, "PREFLIGHT_ONE");
      if (this.#invalidating.has(request.attemptId)) fail("PRINCIPAL_NOT_LINKED");
      nativeClient = requireNativeClient(candidateBinding.captured_client);
      this.#rememberClient(request.attemptId, nativeClient);

      let chat: OwnerVideo2AudioChatContext;
      try {
        chat = await this.#await(deadline, () => Reflect.apply(NATIVE_CREATE, nativeClient!, [{ preparer: this.#preparer,
          candidate: candidate!, principal, attemptId: request.attemptId }, deadline.signal]) as Promise<OwnerVideo2AudioChatContext>);
      } catch (error) {
        if (error instanceof OwnerVideo2AudioNativeError && error.code === "CHAT_CREATE_UNKNOWN") {
          claim.status = "CHAT_CREATE_UNKNOWN";
          semanticKey = undefined;
          fail("CHAT_CREATE_UNKNOWN");
        }
        throw error;
      }
      chatCreated = true;
      claim.status = "CHAT_CREATED_NO_DISPATCH";
      this.#assertChatBinding(chat, nativeClient, request.attemptId, principal, candidateBinding);

      const principalAfterChat = await this.#resolvePrincipal(request.attemptId, deadline.signal);
      if (!sameGenerationPrincipal(principal, principalAfterChat) || this.#invalidating.has(request.attemptId)) fail("PRINCIPAL_NOT_LINKED");
      await this.#runPreflight(request.attemptId, principal, deadline, "PREFLIGHT_TWO");
      const principalBeforeDispatch = await this.#resolvePrincipal(request.attemptId, deadline.signal);
      if (!sameGenerationPrincipal(principal, principalBeforeDispatch) || this.#invalidating.has(request.attemptId)) fail("PRINCIPAL_NOT_LINKED");
      await this.#await(deadline, () => this.#preparer.revalidateCandidate(candidate!, deadline.signal));
      const currentBinding = this.#preparer.inspectCandidate(candidate);
      assertSameCandidateBinding(candidateBinding, currentBinding);
      const permit = await this.#await(deadline, () => createOwnerVideo2AudioOneShotPermit({ preparer: this.#preparer,
        candidate: candidate!, principal, attemptId: request.attemptId }));
      if (!isOwnerVideo2AudioOneShotPermit(permit)) fail("PRE_DISPATCH_FAILED");

      recovery = createRecovery({ attemptId: request.attemptId, principal, profile: this.#profile, semanticKey,
        intentFingerprint: candidateBinding.intent_fingerprint, chat, client: nativeClient, now: this.#readNow() });
      this.#recoveries.set(recovery.recovery_id, recovery);
      this.#activeRecoveryByIntent.set(semanticKey, recovery.recovery_id);
      claim.status = "OUTCOME_UNKNOWN";
      recovery.diagnostic.phase = "GENERATION_POST";
      recovery.diagnostic.post_started = true;
      generationMethodStarted = true;
      const receipt = await this.#await(deadline, () => Reflect.apply(NATIVE_START, nativeClient!, [{ preparer: this.#preparer,
        candidate: candidate!, principal, attemptId: request.attemptId, permit, chat }, deadline.signal]) as Promise<MediaGenerationReceipt>);
      if (!validReceipt(receipt, chat.chat_uuid)) throw unknownError(recovery);
      recovery.owner_echo_message_id = receipt.message_id;
      recovery.diagnostic.ack_known = true;
      recovery.diagnostic.phase = "POST_ACK_KNOWN";
      return await this.#observe(recovery, deadline);
    } catch (error) {
      if (generationMethodStarted && recovery) {
        if (error instanceof OwnerVideo2AudioNativeError && isKnownPreDispatchNativeError(error.code)) {
          this.#removeRecovery(recovery);
          recovery = undefined;
          if (claim) claim.status = "CHAT_CREATED_NO_DISPATCH";
          fail("PRE_DISPATCH_FAILED");
        }
        if (claim) claim.status = "OUTCOME_UNKNOWN";
        throw unknownError(recovery);
      }
      if (claim && semanticKey && !chatCreated && claim.status === "RESERVED") this.#claims.delete(semanticKey);
      if (claim && chatCreated && claim.status === "CHAT_CREATED_NO_DISPATCH") {
        // The native chat is already consumed for this candidate; do not create another for the same semantic intent.
        claim.status = "CHAT_CREATED_NO_DISPATCH";
      }
      if (error instanceof OwnerVideo2AudioGenerationServiceError) throw error;
      if (error instanceof OwnerVideo2AudioNativeError) {
        if (error.code === "CHAT_CREATE_UNKNOWN") fail("CHAT_CREATE_UNKNOWN");
        fail("PRE_DISPATCH_FAILED");
      }
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      if (error instanceof OwnerVideo2AudioRequestPreparerError) fail(mapPreparerCode(error.code));
      if (error instanceof OwnerVideo2AudioOneShotPolicyError) fail(mapOneShotCode(error.code));
      return fail("PRE_DISPATCH_FAILED");
    } finally {
      deadline.close();
    }
  }

  async #runPreflight(attemptId: string, principal: Readonly<GenerationPrincipalRef>, deadline: AbsoluteRequestDeadline,
    phase: "PREFLIGHT_ONE" | "PREFLIGHT_TWO"): Promise<void> {
    deadline.throwIfAborted();
    const before = await this.#resolvePrincipal(attemptId, deadline.signal);
    if (!sameGenerationPrincipal(before, principal)) fail("PRINCIPAL_NOT_LINKED");
    let account: AccountStatusResult; let access: ModelAccessResult;
    try {
      account = await this.#await(deadline, () => Reflect.apply(this.#resolveCurrentAccountLimits, undefined, [attemptId, deadline.signal]));
      const modelRequest = Object.freeze({ model_id: VIDEO2AUDIO_MODEL_ID, cost_parameters: Object.freeze({}) as Readonly<Record<string, never>> });
      access = await this.#await(deadline, () => Reflect.apply(this.#resolveModelAccess, undefined, [attemptId, modelRequest, deadline.signal]));
    } catch {
      const current = await this.#resolvePrincipal(attemptId, deadline.signal).catch(() => undefined);
      if (!current || !sameGenerationPrincipal(current, principal) || this.#invalidating.has(attemptId)) fail("PRINCIPAL_NOT_LINKED");
      fail("PREFLIGHT_FAILED");
    }
    assertFreshPreflight(account!, access!, this.#profile, this.#readNow());
    const after = await this.#resolvePrincipal(attemptId, deadline.signal);
    if (!sameGenerationPrincipal(after, principal) || this.#invalidating.has(attemptId)) fail("PRINCIPAL_NOT_LINKED");
    deadline.throwIfAborted();
    void phase;
  }

  async #observe(recovery: Recovery, deadline: AbsoluteRequestDeadline): Promise<OwnerVideo2AudioGenerationResult> {
    let lastResult: OwnerVideo2AudioGenerationResult | undefined;
    for (let attempt = 0; attempt < this.#maxPollAttempts; attempt += 1) {
      deadline.throwIfAborted();
      if (this.#invalidating.has(recovery.attemptId)) throw unknownError(recovery);
      const principal = await this.#resolvePrincipal(recovery.attemptId, deadline.signal);
      if (!sameGenerationPrincipal(principal, recovery.principal)) throw unknownError(recovery);
      recovery.diagnostic.phase = "HISTORY_GET";
      const authorizeGet: OwnerVideo2AudioAuthorizeGet = (nativeSignal) => this.#authorizeRecoveryGet(recovery, deadline, nativeSignal);
      let history: OwnerVideo2AudioResultCandidates;
      try {
        history = await this.#await(deadline, () => Reflect.apply(NATIVE_HISTORY, recovery.client,
          [{ chat: recovery.chat, authorizeGet }, deadline.signal]) as Promise<OwnerVideo2AudioResultCandidates>);
      } catch (error) {
        deadline.throwIfAborted();
        incrementCounter(recovery.diagnostic, "history_get_calls", 1);
        recovery.diagnostic.history_status = "UNVERIFIED";
        recovery.diagnostic.result_status = "UNVERIFIED";
        if (error instanceof OwnerVideo2AudioNativeError && error.code === "GET_AUTHORIZATION_FAILED") {
          addGaps(recovery.diagnostic, ["GET_AUTHORIZATION_FAILED"]);
        } else addGaps(recovery.diagnostic, ["HISTORY_UNVERIFIED"]);
        throw unknownError(recovery);
      }
      incrementCounter(recovery.diagnostic, "history_get_calls", history.history_get_calls);
      recovery.diagnostic.owner_ack_status = history.owner_ack_status;
      if (history.backend_acceptance !== "UNPROVEN" || history.history_page_status !== "COMPLETE" ||
          history.owner_ack_status !== "MATCHED" || history.status !== "COMPLETE" || !history.owner_echo_message_id ||
          !SAFE_PROVIDER_CHAT_ID.test(history.provider_chat_id ?? "")) {
        recovery.diagnostic.history_status = history.status === "PENDING" ? "PENDING" :
          history.status === "INCOMPLETE" ? "INCOMPLETE" : "UNVERIFIED";
        recovery.diagnostic.result_status = "PENDING";
        addGaps(recovery.diagnostic, history.gaps);
        if (history.owner_ack_status === "MISSING" && history.gaps.includes("POST_ACK_UNKNOWN")) {
          recovery.status = "outcome_unknown";
          recovery.diagnostic.owner_ack_status = "MISSING";
          return pageResult(recovery, 0, "PENDING");
        }
        if (history.status === "PENDING" && history.owner_ack_status === "MATCHED" && history.history_page_status === "COMPLETE") {
          recovery.status = "pending";
          lastResult = pageResult(recovery, 0, "PENDING");
          if (attempt + 1 < this.#maxPollAttempts) await deadline.waitFor(delay(this.#pollDelayMs, deadline.signal));
          continue;
        }
        recovery.status = "outcome_unknown";
        return pageResult(recovery, 0, "UNVERIFIED");
      }
      if (recovery.owner_echo_message_id && recovery.owner_echo_message_id !== history.owner_echo_message_id) {
        recovery.diagnostic.history_status = "UNVERIFIED";
        recovery.diagnostic.result_status = "UNVERIFIED";
        addGaps(recovery.diagnostic, ["OWNER_ACK_MISMATCH"]);
        throw unknownError(recovery);
      }
      recovery.owner_echo_message_id = history.owner_echo_message_id;
      recovery.diagnostic.ack_known = true;
      recovery.diagnostic.owner_ack_status = "MATCHED";
      recovery.diagnostic.history_status = "COMPLETE";
      addGaps(recovery.diagnostic, history.gaps);
      if (history.contexts.length === 0) {
        recovery.status = "pending";
        recovery.diagnostic.result_status = "PENDING";
        addGaps(recovery.diagnostic, ["BOT_RESULT_NOT_OBSERVED"]);
        lastResult = pageResult(recovery, 0, "PENDING");
        if (attempt + 1 < this.#maxPollAttempts) await deadline.waitFor(delay(this.#pollDelayMs, deadline.signal));
        continue;
      }
      if (history.contexts.length > RECOVERY_READ_CONTEXT_MAX) {
        recovery.diagnostic.result_status = "UNVERIFIED";
        addGaps(recovery.diagnostic, ["RESULT_LIMIT_EXCEEDED"]);
        throw unknownError(recovery);
      }

      const byObjectId = new Map(recovery.artifacts.map((artifact) => [artifact.message_object_id, artifact]));
      const urls = new Map(recovery.artifacts.map((artifact) => [artifact.url, artifact.message_object_id]));
      let incomplete = history.gaps.length > 0;
      for (const context of history.contexts) {
        if (!validNativeResultContext(context, recovery)) {
          recovery.diagnostic.result_status = "UNVERIFIED";
          addGaps(recovery.diagnostic, ["VIDEO2AUDIO_RESULT_UNVERIFIED"]);
          throw unknownError(recovery);
        }
        recovery.diagnostic.phase = "RESULT_GET";
        const authorizeResultGet: OwnerVideo2AudioAuthorizeGet = (nativeSignal) => this.#authorizeRecoveryGet(recovery, deadline, nativeSignal);
        let decoded: OwnerVideo2AudioResult;
        try {
          decoded = await this.#await(deadline, () => Reflect.apply(NATIVE_RESULT, recovery.client,
            [{ context, authorizeGet: authorizeResultGet }, deadline.signal]) as Promise<OwnerVideo2AudioResult>);
        } catch (error) {
          deadline.throwIfAborted();
          incrementCounter(recovery.diagnostic, "result_get_calls", 1);
          recovery.diagnostic.result_status = "UNVERIFIED";
          addGaps(recovery.diagnostic, [error instanceof OwnerVideo2AudioNativeError && error.code === "GET_AUTHORIZATION_FAILED"
            ? "GET_AUTHORIZATION_FAILED" : "RESULT_GET_UNAVAILABLE"]);
          throw unknownError(recovery);
        }
        incrementCounter(recovery.diagnostic, "result_get_calls", 1);
        if (decoded.message_binding !== "BOUND" || decoded.model_echo === "MISMATCH" || decoded.backend_acceptance !== "UNPROVEN") {
          recovery.diagnostic.result_status = "UNVERIFIED";
          addGaps(recovery.diagnostic, decoded.gaps.map((item) => item.code));
          addGaps(recovery.diagnostic, ["VIDEO2AUDIO_RESULT_UNVERIFIED"]);
          throw unknownError(recovery);
        }
        if (decoded.gaps.length > 0 || decoded.model_echo === "UNKNOWN") incomplete = true;
        addGaps(recovery.diagnostic, decoded.gaps.map((item) => item.code));
        const expectedIds = new Set(context.message_object_ids);
        for (const artifact of decoded.ready_artifacts) {
          if (!expectedIds.has(artifact.message_object_id)) {
            incomplete = true; addGaps(recovery.diagnostic, ["VIDEO2AUDIO_RESULT_UNVERIFIED"]); continue;
          }
          const observed: InternalArtifact = Object.freeze({ url: artifact.object_url, mime_type: artifact.mime_type,
            mime_source: artifact.mime_source, object_type: artifact.object_type, object_index: artifact.object_index,
            model_echo: artifact.model_echo, message_object_id: artifact.message_object_id });
          const previous = byObjectId.get(observed.message_object_id);
          if (previous) {
            if (!isDeepStrictEqual(previous, observed)) { incomplete = true; addGaps(recovery.diagnostic, ["VIDEO2AUDIO_RESULT_UNVERIFIED"]); }
            continue;
          }
          const previousId = urls.get(observed.url);
          if (previousId && previousId !== observed.message_object_id) {
            incomplete = true; addGaps(recovery.diagnostic, ["VIDEO2AUDIO_RESULT_UNVERIFIED"]); continue;
          }
          byObjectId.set(observed.message_object_id, observed);
          urls.set(observed.url, observed.message_object_id);
          if (byObjectId.size > MAX_ARTIFACTS) {
            recovery.diagnostic.result_status = "PARTIAL";
            addGaps(recovery.diagnostic, ["RESULT_LIMIT_EXCEEDED"]);
            throw unknownError(recovery);
          }
        }
      }
      recovery.artifacts = Object.freeze([...byObjectId.values()]);
      recovery.status = incomplete ? "partial_results" : "completed";
      recovery.diagnostic.phase = "RESULT_BINDING";
      recovery.diagnostic.result_status = incomplete ? "PARTIAL" : "COMPLETE";
      if (claimStatus(this.#claims.get(recovery.semantic_key))) {
        const claim = this.#claims.get(recovery.semantic_key)!;
        claim.status = recovery.status === "completed" ? "COMPLETE" : "PARTIAL_RESULTS";
      }
      lastResult = pageResult(recovery, 0, incomplete ? "PARTIAL" : "COMPLETE");
      if (!incomplete) return lastResult;
      if (attempt + 1 < this.#maxPollAttempts) await deadline.waitFor(delay(this.#pollDelayMs, deadline.signal));
    }
    return lastResult ?? pageResult(recovery, 0, recovery.status === "outcome_unknown" ? "PENDING" : "PARTIAL");
  }

  async #authorizeRecoveryGet(recovery: Recovery, deadline: AbsoluteRequestDeadline, signal?: AbortSignal): Promise<void> {
    deadline.throwIfAborted();
    if (signal?.aborted || this.#invalidating.has(recovery.attemptId)) fail("PRINCIPAL_NOT_LINKED");
    const current = await this.#resolvePrincipal(recovery.attemptId, deadline.signal);
    if (!sameGenerationPrincipal(current, recovery.principal) || this.#invalidating.has(recovery.attemptId)) fail("PRINCIPAL_NOT_LINKED");
  }

  async #resolvePrincipal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    try {
      const principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
      if (principal.connection_id !== attemptId || principal.tenant_id !== this.#binding.tenant_id ||
          principal.subject_id !== this.#binding.subject || signal?.aborted) fail("PRINCIPAL_NOT_LINKED");
      return principal;
    } catch { fail("PRINCIPAL_NOT_LINKED"); }
  }

  #claim(semanticKey: string, principal: Readonly<GenerationPrincipalRef>, fingerprint: string): {
    readonly claim: SemanticClaim; readonly isNew: boolean; readonly existingRecovery?: Recovery;
  } {
    const existing = this.#claims.get(semanticKey);
    if (existing) {
      const recoveryId = this.#activeRecoveryByIntent.get(semanticKey);
      const recovery = recoveryId === undefined ? undefined : this.#recoveries.get(recoveryId);
      if (recovery && recovery.attemptId === principal.connection_id && sameGenerationPrincipal(recovery.principal, principal)) {
        return { claim: existing, isNew: false, existingRecovery: recovery };
      }
      fail("INTENT_ALREADY_CLAIMED");
    }
    if (this.#claims.size >= MAX_INTENTS || this.#recoveries.size >= MAX_RECOVERIES) fail("CAPACITY_EXCEEDED");
    const claim = { owner_key: stableOwnerKey(principal), intent_fingerprint: fingerprint, status: "RESERVED" as const };
    this.#claims.set(semanticKey, claim);
    return { claim, isNew: true };
  }

  #removeRecovery(recovery: Recovery): void {
    this.#recoveries.delete(recovery.recovery_id);
    if (this.#activeRecoveryByIntent.get(recovery.semantic_key) === recovery.recovery_id) {
      this.#activeRecoveryByIntent.delete(recovery.semantic_key);
    }
  }

  #rememberClient(attemptId: string, client: NativeClient): void {
    let clients = this.#clientsByAttempt.get(attemptId);
    if (!clients) {
      if (this.#clientsByAttempt.size >= MAX_NATIVE_CLIENTS) fail("SERVICE_BUSY");
      clients = new Set<NativeClient>(); this.#clientsByAttempt.set(attemptId, clients);
    }
    clients.add(client);
  }

  #assertChatBinding(chat: OwnerVideo2AudioChatContext, client: NativeClient, attemptId: string,
    principal: Readonly<GenerationPrincipalRef>, binding: Readonly<OwnerVideo2AudioCandidateBinding>): void {
    if (chat.status !== "created" || chat.attempt_id !== attemptId || chat.chat_uuid.length === 0 || chat.model_id !== VIDEO2AUDIO_MODEL_ID ||
        chat.source_profile_schema_hash !== this.#profile.profileSchemaHash || chat.intent_fingerprint !== binding.intent_fingerprint ||
        chat.request_fingerprint !== binding.request_fingerprint || chat.original_sha256 !== binding.original_sha256 ||
        chat.original_size !== binding.original_size || chat.duration_seconds !== binding.duration_seconds ||
        !sameGenerationPrincipal(chat.principal, principal) || chat.dispatch_allowed !== false || chat.backend_acceptance !== "UNPROVEN" ||
        !isNativeClient(client)) fail("PRE_DISPATCH_FAILED");
  }

  async #invalidateAttempt(attemptId: string): Promise<void> {
    if (this.#invalidating.has(attemptId)) {
      await this.#invalidation.get(attemptId);
      return;
    }
    this.#invalidating.add(attemptId);
    for (const run of this.#runs) if (run.attemptId === attemptId) run.controller.abort();
    const active = [...this.#runs].filter((run) => run.attemptId === attemptId);
    const preparerDrain = this.#preparer.invalidateAttempt(attemptId);
    const invalidation = Promise.allSettled([...active.map((run) => run.promise), preparerDrain]).then(() => {
      const clients = this.#clientsByAttempt.get(attemptId);
      if (clients) for (const client of clients) {
        try { Reflect.apply(NATIVE_INVALIDATE, client, [attemptId]); } catch { /* only local cleanup; never expose native details */ }
      }
      for (const [recoveryId, recovery] of this.#recoveries) {
        if (recovery.attemptId !== attemptId) continue;
        this.#recoveries.delete(recoveryId);
        if (this.#activeRecoveryByIntent.get(recovery.semantic_key) === recoveryId) this.#activeRecoveryByIntent.delete(recovery.semantic_key);
      }
      for (const [semanticKey, recoveryId] of this.#activeRecoveryByIntent) {
        const recovery = this.#recoveries.get(recoveryId);
        if (recovery?.attemptId === attemptId) this.#activeRecoveryByIntent.delete(semanticKey);
      }
      this.#clientsByAttempt.delete(attemptId);
      this.#invalidating.delete(attemptId);
      this.#invalidation.delete(attemptId);
    });
    this.#invalidation.set(attemptId, invalidation);
    await invalidation;
  }

  #assertProfileBinding(): void {
    if (!isAuthenticOwnerVideo2AudioSourceProfile(this.#profile) || this.#profile.source.dispatch_allowed !== false ||
        this.#profile.source.runtime_usable !== false || this.#profile.source.backend_acceptance !== "UNPROVEN" ||
        this.#profile.source.identity.model_id !== VIDEO2AUDIO_MODEL_ID || this.#profile.profileSchemaHash.length === 0 ||
        this.#profile.catalog.getModel(VIDEO2AUDIO_MODEL_ID).active !== true) fail("MODEL_BINDING_MISMATCH");
  }

  #assertOpen(): void { if (this.#closed || !SERVICE_INSTANCES.has(this)) fail("SERVICE_CLOSED"); }
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
    if (this.#invalidating.has(attemptId)) fail("PRINCIPAL_NOT_LINKED");
    if (this.#runs.size >= MAX_ACTIVE_RUNS) fail("SERVICE_BUSY");
    if (parent !== undefined && (types.isProxy(parent) || !(parent instanceof AbortSignal))) invalid();
    const controller = new AbortController();
    const abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const run: ActiveRun = { attemptId, controller, done, promise: Promise.resolve() };
    const promise = Promise.resolve().then(() => operation(controller.signal));
    run.promise = promise;
    this.#runs.add(run);
    try { return await promise; }
    finally { parent?.removeEventListener("abort", abort); this.#runs.delete(run); finish(); }
  }
  #readNow(): number {
    let value: unknown;
    try { value = this.#now(); } catch { fail("SERVICE_BUSY"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) < this.#lastNow) fail("SERVICE_BUSY");
    this.#lastNow = value as number;
    return this.#lastNow;
  }
}

export function isOwnerVideo2AudioGenerationService(value: unknown): value is OwnerVideo2AudioGenerationService {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && SERVICE_INSTANCES.has(value) &&
    Object.getPrototypeOf(value) === OwnerVideo2AudioGenerationService.prototype && Reflect.ownKeys(value).length === 0 && Object.isFrozen(value); }
  catch { return false; }
}

function createRecovery(input: { attemptId: string; principal: Readonly<GenerationPrincipalRef>; profile: OwnerVideo2AudioSourceProfile;
  semanticKey: string; intentFingerprint: string; chat: OwnerVideo2AudioChatContext; client: NativeClient; now: number }): Recovery {
  if (!Number.isSafeInteger(input.now) || input.now < 0) fail("SERVICE_BUSY");
  const diagnostic: MutableDiagnostic = { phase: "CHAT_CREATE", post_started: false, ack_known: false,
    history_status: "NOT_READ", owner_ack_status: "NOT_READ", history_get_calls: 0, result_get_calls: 0,
    result_status: "NOT_READ", gaps: [], counters_saturated: false };
  return { recovery_id: `video2audio_generation_recovery_${randomUUID()}`, attemptId: input.attemptId,
    principal: input.principal, source_profile_schema_hash: input.profile.profileSchemaHash,
    intent_fingerprint: input.intentFingerprint, semantic_key: input.semanticKey,
    created_at: new Date(input.now).toISOString(), source_binding: input.profile.source.source_pins,
    client: input.client, chat: input.chat, diagnostic,
    owner_echo_message_id: null, status: "outcome_unknown", artifacts: Object.freeze([]) };
}

function pageResult(recovery: Recovery, offset: number, status?: OwnerVideo2AudioGenerationResult["status"]): OwnerVideo2AudioGenerationResult {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_ARTIFACTS) invalid();
  if (recovery.status === "outcome_unknown" && status === undefined) throw unknownError(recovery);
  const start = offset, artifacts = recovery.artifacts.slice(offset, offset + RESULT_PAGE_SIZE), next = offset + artifacts.length;
  return Object.freeze({ status: status ?? (recovery.status === "completed" ? "COMPLETE" : recovery.status === "partial_results" ? "PARTIAL" : "PENDING"),
    status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", backend_acceptance: "UNPROVEN", provider_terminal_status: "UNPROVEN",
    model_id: VIDEO2AUDIO_MODEL_ID,
    source_binding: Object.freeze({ public_catalog_version: recovery.source_binding.public_catalog_version,
      settings_inventory_version: recovery.source_binding.settings_inventory_version, form_sha256: recovery.source_binding.form_sha256 }),
    recovery_id: recovery.recovery_id, observed_artifact_count: recovery.artifacts.length, offset: start, page_size: RESULT_PAGE_SIZE,
    artifacts: Object.freeze(artifacts.map(publicArtifact)), has_more: next < recovery.artifacts.length,
    next_offset: next < recovery.artifacts.length ? next : null, diagnostic: snapshotDiagnostic(recovery.diagnostic) });
}

function publicArtifact(value: InternalArtifact): OwnerVideo2AudioGenerationArtifact {
  return Object.freeze({ url: value.url, mime_type: value.mime_type, mime_source: value.mime_source,
    object_type: value.object_type, object_index: value.object_index, model_echo: value.model_echo });
}

function snapshotDiagnostic(value: MutableDiagnostic): OwnerVideo2AudioDiagnostic {
  return Object.freeze({ phase: value.phase, post_started: value.post_started, ack_known: value.ack_known,
    history_status: value.history_status, owner_ack_status: value.owner_ack_status,
    history_get_calls: value.history_get_calls, result_get_calls: value.result_get_calls,
    result_status: value.result_status, gaps: Object.freeze(value.gaps.slice(0, 128)), counters_saturated: value.counters_saturated });
}

function unknownError(recovery: Recovery): OwnerVideo2AudioGenerationServiceError {
  return serviceError("OUTCOME_UNKNOWN", recovery.recovery_id, snapshotDiagnostic(recovery.diagnostic));
}

function serviceError(code: OwnerVideo2AudioGenerationServiceErrorCode, recoveryId?: string,
  diagnostic?: OwnerVideo2AudioDiagnostic): OwnerVideo2AudioGenerationServiceError {
  return new OwnerVideo2AudioGenerationServiceError(code, recoveryId, diagnostic);
}

function semanticIntentKey(principal: Readonly<GenerationPrincipalRef>, fingerprint: string): string {
  return schemaHash({ namespace: "owner-video2audio-generation-v1", tenant_id: principal.tenant_id,
    subject_id: principal.subject_id, intent_fingerprint: fingerprint });
}

function stableOwnerKey(principal: Readonly<GenerationPrincipalRef>): string {
  return schemaHash({ tenant_id: principal.tenant_id, subject_id: principal.subject_id });
}

function assertSameCandidateBinding(expected: Readonly<OwnerVideo2AudioCandidateBinding>, actual: OwnerVideo2AudioCandidateBinding | undefined): void {
  if (!actual || !isDeepStrictEqual(expected, actual) || expected.captured_client !== actual.captured_client ||
      expected.captured_reference !== actual.captured_reference) fail("MODEL_BINDING_MISMATCH");
}

function assertFreshPreflight(accountInput: unknown, accessInput: unknown, profile: OwnerVideo2AudioSourceProfile, now: number): void {
  try {
    const account = exactRecord(accountInput, ["balance", "subscription", "contract_evidence", "source_build", "observed_at"]);
    const balance = exactRecord(account.balance, ["unit", "available"]);
    const subscription = exactRecord(account.subscription, ["active", "plan_type", "end_date", "end_date_kind"]);
    const access = exactRecord(accessInput, ["catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live",
      "parameter_keys", "parameters_redacted", "access", "cost", "discount_cost", "free_remaining_generations", "limit", "show_warning", "observed_at"]);
    const model = profile.catalog.getModel(VIDEO2AUDIO_MODEL_ID);
    const expectedCatalogVersion = `${profile.catalog.fetched_at}.${profile.catalog.source_hashes.models.slice(7, 19)}`;
    if (subscription.active === false || subscriptionExpired(subscription, now)) fail("SUBSCRIPTION_REQUIRED");
    if (account.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || account.source_build !== ACCOUNT_SOURCE_BUILD ||
        balance.unit !== "tokens" || !(balance.available === null || typeof balance.available === "string") ||
        !validSubscription(subscription, now) || !freshObservation(account.observed_at, now) ||
        access.catalog_kind !== profile.catalog.catalog_kind || access.catalog_version !== expectedCatalogVersion ||
        access.model_id !== VIDEO2AUDIO_MODEL_ID || access.ai_name !== profile.source.identity.ai_name ||
        access.model_type !== profile.source.identity.model_type || access.account_read_live !== true || access.access !== true ||
        access.parameters_redacted !== true || !emptyStringArray(access.parameter_keys) ||
        !nullableFinite(access.cost) || !nullableFinite(access.discount_cost) ||
        !(access.free_remaining_generations === null || nonnegativeInteger(access.free_remaining_generations)) ||
        !nullableFinite(access.limit) || !(access.show_warning === null || typeof access.show_warning === "boolean") ||
        !freshObservation(access.observed_at, now) || model.active !== true || model.id !== VIDEO2AUDIO_MODEL_ID ||
        model.ai_name !== profile.source.identity.ai_name || model.upstream_id !== profile.source.identity.model_type) fail("PREFLIGHT_FAILED");
  } catch (error) { if (error instanceof OwnerVideo2AudioGenerationServiceError) throw error; fail("PREFLIGHT_FAILED"); }
}

function validSubscription(value: Record<string, unknown>, now: number): boolean {
  if (value.active !== true || !(value.plan_type === null || typeof value.plan_type === "string") ||
      !(value.end_date === null || typeof value.end_date === "string") ||
      !(value.end_date_kind === null || ["DATE_ONLY", "LOCAL_DATETIME", "OFFSET_DATETIME"].includes(String(value.end_date_kind)))) return false;
  if (value.end_date === null) return true;
  const date = value.end_date_kind === "DATE_ONLY" ? `${value.end_date}T23:59:59.999Z` : value.end_date;
  const end = Date.parse(date);
  return Number.isFinite(end) && end >= now;
}

function subscriptionExpired(value: Record<string, unknown>, now: number): boolean {
  if (typeof value.end_date !== "string" || !["DATE_ONLY", "LOCAL_DATETIME", "OFFSET_DATETIME"].includes(String(value.end_date_kind))) return false;
  const date = value.end_date_kind === "DATE_ONLY" ? `${value.end_date}T23:59:59.999Z` : value.end_date;
  const end = Date.parse(date);
  return Number.isFinite(end) && end < now;
}

function freshObservation(value: unknown, now: number): boolean {
  if (typeof value !== "string") return false;
  const observed = Date.parse(value);
  return Number.isFinite(observed) && observed <= now + 30_000 && observed >= now - 5 * 60_000;
}

function emptyStringArray(value: unknown): boolean {
  return Array.isArray(value) && !types.isProxy(value) && Object.getPrototypeOf(value) === Array.prototype && value.length === 0;
}

function nullableFinite(value: unknown): boolean { return value === null || (typeof value === "number" && Number.isFinite(value)); }
function nonnegativeInteger(value: unknown): boolean { return Number.isSafeInteger(value) && (value as number) >= 0; }

function validNativeResultContext(context: OwnerVideo2AudioResultMessageContext, recovery: Recovery): boolean {
  return context.chat_uuid === recovery.chat.chat_uuid && context.model_id === VIDEO2AUDIO_MODEL_ID &&
    context.attempt_id === recovery.attemptId && sameGenerationPrincipal(context.principal, recovery.principal) &&
    context.source_profile_schema_hash === recovery.source_profile_schema_hash && context.intent_fingerprint === recovery.intent_fingerprint &&
    context.owner_echo_message_id === recovery.owner_echo_message_id && SAFE_PROVIDER_CHAT_ID.test(context.provider_chat_id) &&
    Array.isArray(context.message_object_ids) && context.message_object_ids.length > 0 && context.message_object_ids.length <= 64;
}

function isKnownPreDispatchNativeError(code: OwnerVideo2AudioNativeErrorCode): boolean {
  return code === "REQUEST_ABORTED" || code === "CANDIDATE_INVALID" || code === "CHAT_CONTEXT_INVALID" ||
    code === "CHAT_DISPATCH_ALREADY_STARTED" || code === "CHAT_NOT_DISPATCHED" || code === "INVALID_REQUEST";
}

function mapPreparerCode(code: string): OwnerVideo2AudioGenerationServiceErrorCode {
  if (code === "PRINCIPAL_NOT_LINKED" || code === "PRINCIPAL_MISMATCH") return "PRINCIPAL_NOT_LINKED";
  if (code === "SERVICE_CLOSED") return "SERVICE_CLOSED";
  if (code === "CAPACITY_EXCEEDED" || code === "SERVICE_BUSY") return "SERVICE_BUSY";
  if (code === "PROFILE_BINDING_MISMATCH") return "MODEL_BINDING_MISMATCH";
  if (code === "PROMPT_INVALID" || code === "INVALID_REQUEST") return "INVALID_REQUEST";
  return "PRE_DISPATCH_FAILED";
}

function mapOneShotCode(code: string): OwnerVideo2AudioGenerationServiceErrorCode {
  if (code === "PRINCIPAL_MISMATCH") return "PRINCIPAL_NOT_LINKED";
  if (code === "CAPACITY_EXCEEDED") return "SERVICE_BUSY";
  if (code === "CANDIDATE_EXPIRED" || code === "CANDIDATE_UNBOUND") return "INVALID_REQUEST";
  return "PRE_DISPATCH_FAILED";
}

function isExactPerUserLinkService(value: unknown): value is PerUserLinkService {
  try { return isExactInstance(value, PerUserLinkService) && !Object.hasOwn(value, "getStatus") &&
    Reflect.get(value, "getStatus") === PerUserLinkService.prototype.getStatus; } catch { return false; }
}

function isExactInstance<T extends object>(value: unknown, constructor: new (...args: never[]) => T): value is T {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && value instanceof constructor && Object.getPrototypeOf(value) === constructor.prototype; }
  catch { return false; }
}

function requireNativeClient(value: unknown): NativeClient {
  if (!isNativeClient(value)) fail("PRE_DISPATCH_FAILED");
  return value;
}

function isNativeClient(value: unknown): value is NativeClient {
  if (!isExactInstance(value, SyntxChatHttpClient)) return false;
  return getDataMethod(value, "createVideo2AudioChat") === NATIVE_CREATE && getDataMethod(value, "startVideo2AudioWithOwnedCandidate") === NATIVE_START &&
    getDataMethod(value, "listOwnedVideo2AudioResultCandidates") === NATIVE_HISTORY && getDataMethod(value, "getOwnedVideo2AudioResult") === NATIVE_RESULT &&
    getDataMethod(value, "invalidateVideo2AudioAttempt") === NATIVE_INVALIDATE;
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

function snapshotGenerate(value: unknown): Readonly<OwnerVideo2AudioGenerateInput> {
  const fields = exactRecord(value, ["attemptId", "prompt", "video_original_handle"]);
  const attemptId = readAttempt(fields.attemptId);
  if (typeof fields.prompt !== "string" || typeof fields.video_original_handle !== "string" ||
      !/^video2audio_original_[0-9a-f-]{36}$/u.test(fields.video_original_handle)) invalid();
  return Object.freeze({ attemptId, prompt: fields.prompt, video_original_handle: fields.video_original_handle });
}

function snapshotReconcile(value: unknown): Readonly<OwnerVideo2AudioReconcileInput> {
  const fields = exactRecord(value, ["attemptId", "recovery_id"]);
  const attemptId = readAttempt(fields.attemptId);
  if (typeof fields.recovery_id !== "string" || !RECOVERY_ID.test(fields.recovery_id)) invalid();
  return Object.freeze({ attemptId, recovery_id: fields.recovery_id });
}

function snapshotRecoveryList(value: unknown): Readonly<Required<OwnerVideo2AudioRecoveryListInput>> {
  const fields = exactRecord(value, ["attemptId"], ["limit"]);
  const attemptId = readAttempt(fields.attemptId);
  const limit = fields.limit === undefined ? 64 : bounded(fields.limit, 1, 128, 64);
  return Object.freeze({ attemptId, limit });
}

function snapshotResultPage(value: unknown): Readonly<Required<OwnerVideo2AudioResultPageInput>> {
  const fields = exactRecord(value, ["attemptId", "recovery_id"], ["offset"]);
  const attemptId = readAttempt(fields.attemptId);
  if (typeof fields.recovery_id !== "string" || !RECOVERY_ID.test(fields.recovery_id)) invalid();
  const offset = fields.offset === undefined ? 0 : bounded(fields.offset, 0, MAX_ARTIFACTS, 0);
  return Object.freeze({ attemptId, recovery_id: fields.recovery_id, offset });
}

function readAttempt(value: unknown): string {
  if (typeof value !== "string" || !ATTEMPT.test(value)) invalid();
  return value;
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  let prototype: object | null; let descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); } catch { invalid(); }
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const result = Object.create(null) as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !allowed.has(key) || !descriptors[key]!.enumerable || !("value" in descriptors[key]!)) invalid();
    result[key] = descriptors[key]!.value;
  }
  if (required.some((key) => !Object.hasOwn(result, key))) invalid();
  return result;
}

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || !fields.tenant_id.trim() || fields.tenant_id.length > 256 ||
      typeof fields.subject !== "string" || !fields.subject.trim() || fields.subject.length > 512) invalid();
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
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

function incrementCounter(diagnostic: MutableDiagnostic, key: "history_get_calls" | "result_get_calls", amount: number): void {
  if (!Number.isSafeInteger(amount) || amount < 0) { diagnostic[key] = DIAGNOSTIC_COUNTER_MAX; diagnostic.counters_saturated = true; return; }
  const room = DIAGNOSTIC_COUNTER_MAX - diagnostic[key];
  if (amount > room) diagnostic.counters_saturated = true;
  diagnostic[key] = Math.min(DIAGNOSTIC_COUNTER_MAX, diagnostic[key] + amount);
}

function addGaps(diagnostic: MutableDiagnostic, values: readonly string[]): void {
  for (const value of values) {
    const safe = SERVICE_GAPS.has(value) ? value as OwnerVideo2AudioServiceGapCode : "VIDEO2AUDIO_RESULT_UNVERIFIED";
    if (!diagnostic.gaps.includes(safe) && diagnostic.gaps.length < 128) diagnostic.gaps.push(safe);
  }
}

function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }

function validReceipt(value: unknown, chatUuid: string): value is MediaGenerationReceipt {
  try {
    const fields = exactRecord(value, ["chat_uuid", "message_id"]);
    return fields.chat_uuid === chatUuid && isSafeId(fields.message_id);
  } catch { return false; }
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

function claimStatus(value: SemanticClaim | undefined): boolean { return value !== undefined; }
function fail(code: OwnerVideo2AudioGenerationServiceErrorCode): never { throw serviceError(code); }
function invalid(): never { return fail("INVALID_REQUEST"); }
