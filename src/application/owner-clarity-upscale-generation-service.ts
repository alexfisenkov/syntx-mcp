import { randomUUID } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { type ChatMessageHistorySnapshot, type InProgressMessage, type InternalClarityUpscaleResult, type SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import type { AccountStatusResult } from "./account-status.js";
import type { ModelAccessResult } from "./model-access.js";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import {
  incrementClarityDiagnosticGet,
  initialClarityUnknownDiagnostic,
  safeClarityUpstreamErrorCode,
  snapshotClarityUnknownDiagnostic,
  OWNER_CLARITY_UNKNOWN_UNVERIFIED_REASONS,
  OWNER_CLARITY_UNKNOWN_HISTORY_BINDING_REASONS,
  type MutableOwnerClarityUpscaleUnknownDiagnostic,
  type OwnerClarityUpscaleUnknownDiagnostic
} from "./owner-clarity-upscale-diagnostics.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import {
  createOwnerClarityUpscaleCompletionPolicy,
  decideOwnerClarityUpscaleCompletion,
  OWNER_CLARITY_COMPLETION_LIMITS,
  type OwnerClarityUpscaleCompletionPolicyState
} from "./owner-clarity-upscale-completion-policy.js";
import { createOwnerClarityUpscaleOneShotPermit } from "./owner-clarity-upscale-one-shot-policy.js";
import {
  OwnerClarityUpscalePrepareError,
  prepareOwnerClarityUpscaleRequest,
  type OwnerClarityUpscalePreparedCandidate
} from "./owner-clarity-upscale-request-preparer.js";
import {
  OwnerClarityUpscaleUploadService,
  OwnerClarityUpscaleUploadServiceError
} from "./owner-clarity-upscale-upload-service.js";

const MODEL_ID = "clarity" as const;
const OPERATION_ID = "upscale-image" as const;
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const IMAGE_HANDLE_PATTERN = /^clarity_image_[0-9a-f-]{36}$/u;
const RECOVERY_PATTERN = /^clarity_recovery_[0-9a-f-]{36}$/u;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const MIME_PATTERN = /^image\/[a-z0-9.+-]{1,64}$/u;
const CLARITY_UNVERIFIED_REASONS = new Set([
  "OUTER_MESSAGE_MISMATCH", "NOT_BOT_MESSAGE", "NO_IMAGE_OBJECTS", "RESULT_COUNT_OUT_OF_RANGE",
  "RESULT_OBJECT_INCOMPLETE", "RESULT_OBJECT_MISMATCH", "RESULT_URL_UNSAFE", "RESULT_MIME_UNKNOWN"
]);
const PROMPT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const MAX_PROMPT_BYTES = 5_000;
const LOCAL_BINDING_TTL_MS = 15 * 60_000;
const MAX_RECOVERIES = 128;
const MAX_PENDING = 4;
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_POLL_DELAY_MS = OWNER_CLARITY_COMPLETION_LIMITS.initialDelayMs;
const MAX_POLL_ATTEMPTS = OWNER_CLARITY_COMPLETION_LIMITS.maximumRounds;
const MAX_LOCAL_CLAIMS = 128;
const MAX_PRINCIPAL_BINDINGS = 128;
const MAX_CLOCK_SKEW_MS = 30_000;

type ChatClient = Pick<SyntxChatHttpClient,
  "createImageUpscalerChat" | "startClarityUpscaleWithOwnedCandidate" | "listMessageCandidates" |
  "listInProgress" | "getClarityUpscaleResult">;

export interface OwnerClarityUpscalePreflightResult {
  readonly account: AccountStatusResult;
  readonly model_access: ModelAccessResult;
}

export type OwnerClarityUpscalePreflight = (
  attemptId: string,
  principal: Readonly<GenerationPrincipalRef>,
  signal?: AbortSignal
) => Promise<OwnerClarityUpscalePreflightResult>;

export interface OwnerClarityUpscaleGenerationServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalogVersion: string;
  readonly uploadService: OwnerClarityUpscaleUploadService;
  readonly resolveChatClient: (attemptId: string) => ChatClient;
  readonly preflight: OwnerClarityUpscalePreflight;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly pollDelayMs?: number;
  readonly maxPollAttempts?: number;
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export interface OwnerClarityUpscaleGenerateInput {
  readonly attemptId: string;
  readonly image_handle: string;
  readonly parameters: unknown;
  readonly prompt?: string | undefined;
}

export interface OwnerClarityUpscaleReconcileInput {
  readonly attemptId: string;
  readonly recovery_id: string;
}

export interface OwnerClarityUpscaleRecoveryListInput {
  readonly attemptId: string;
  readonly limit: number;
}

export interface OwnerClarityUpscaleArtifact {
  readonly url: string;
  readonly mime_type: string | null;
  readonly mime_confidence: "URL_EXTENSION_ONLY" | "UNKNOWN";
}

export interface OwnerClarityUpscaleGenerationResult {
  readonly status: "result_observed";
  readonly backend_acceptance: "unproven";
  readonly model_id: typeof MODEL_ID;
  readonly operation_id: typeof OPERATION_ID;
  readonly profile_id: string;
  readonly profile_schema_hash: string;
  readonly catalog_version: string;
  readonly request_fingerprint: string;
  readonly requested_scale_factor: number;
  readonly input_image: Readonly<{ mime_type: string; width: number; height: number }>;
  readonly expected_output_geometry: Readonly<{ width: number; height: number }> | null;
  readonly actual_image: Readonly<{ mime_type: string | null; width: null; height: null }>;
  readonly geometry_verified: false;
  readonly artifact: OwnerClarityUpscaleArtifact;
}

export interface OwnerClarityUpscaleRecoveryListItem {
  readonly recovery_id: string;
  readonly created_at: string;
  readonly model_id: typeof MODEL_ID;
  readonly operation_id: typeof OPERATION_ID;
  readonly status: "OUTCOME_UNKNOWN";
  readonly diagnostic: OwnerClarityUpscaleUnknownDiagnostic;
}

export type OwnerClarityUpscaleGenerationServiceErrorCode =
  | "INVALID_REQUEST"
  | "SERVICE_CLOSED"
  | "SERVICE_BUSY"
  | "PRINCIPAL_NOT_LINKED"
  | "IMAGE_HANDLE_UNAVAILABLE"
  | "IMAGE_HANDLE_ALREADY_USED"
  | "PREFLIGHT_FAILED"
  | "PRE_DISPATCH_FAILED"
  | "OUTCOME_UNKNOWN"
  | "RECOVERY_NOT_FOUND";

export class OwnerClarityUpscaleGenerationServiceError extends Error {
  readonly diagnostic: OwnerClarityUpscaleUnknownDiagnostic | undefined;

  constructor(readonly code: OwnerClarityUpscaleGenerationServiceErrorCode, readonly recovery_id?: string,
    diagnostic?: unknown) {
    super(code === "OUTCOME_UNKNOWN"
      ? "The Clarity upscaler request may have been dispatched; do not retry. Reconcile with the same recovery handle."
      : "The owner Clarity upscaler request could not be completed safely.");
    this.name = "OwnerClarityUpscaleGenerationServiceError";
    this.diagnostic = code === "OUTCOME_UNKNOWN" && diagnostic !== undefined
      ? snapshotClarityUnknownDiagnostic(diagnostic)
      : undefined;
  }
}

interface RecoveryRecord {
  readonly recovery_id: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly image_handle: string;
  readonly chat_uuid: string;
  readonly profile_schema_hash: string;
  readonly catalog_version: string;
  readonly created_at: string;
  readonly profile_id: string;
  readonly request_fingerprint: string;
  readonly requested_scale_factor: number;
  readonly input_image: Readonly<{ mime_type: string; width: number; height: number }>;
  readonly expected_output_geometry: Readonly<{ width: number; height: number }> | null;
  echo_message_id: string | null;
  bound_bot_message_id: string | null;
  bound_object_id: string | null;
  pending_history_bot_message_id: string | null;
  completion_state: OwnerClarityUpscaleCompletionPolicyState;
  status: "POST_STARTED" | "OUTCOME_UNKNOWN";
  diagnostic: MutableOwnerClarityUpscaleUnknownDiagnostic;
}

interface ImageClaim {
  readonly image_handle: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly expires_at: number;
  request_fingerprint: string;
  status: "PREPARING" | "POST_STARTED" | "COMPLETED";
}

interface CompletionRun {
  state: OwnerClarityUpscaleCompletionPolicyState;
  readonly persist: boolean;
}

/** Process-local Clarity owner lifecycle; no fallback dispatch and no durable recovery claim. */
export class OwnerClarityUpscaleGenerationService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #catalogVersion: string;
  readonly #uploadService: OwnerClarityUpscaleUploadService;
  readonly #resolveChatClient: OwnerClarityUpscaleGenerationServiceOptions["resolveChatClient"];
  readonly #preflight: OwnerClarityUpscalePreflight;
  readonly #issuer: ReturnType<OwnerClarityUpscaleUploadService["createOwnedImageBindingIssuer"]>;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #pollDelayMs: number;
  readonly #maxPollAttempts: number;
  readonly #pollWait: NonNullable<OwnerClarityUpscaleGenerationServiceOptions["wait"]>;
  readonly #recoveries = new Map<string, RecoveryRecord>();
  readonly #claims = new Map<string, ImageClaim>();
  readonly #controllers = new Map<string, Set<AbortController>>();
  readonly #pendingByAttempt = new Map<string, Set<Promise<unknown>>>();
  readonly #pending = new Set<Promise<unknown>>();
  readonly #principals = new Map<string, Readonly<{ principal: Readonly<GenerationPrincipalRef>; expiresAt: number }>>();
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(options: OwnerClarityUpscaleGenerationServiceOptions) {
    const fields = readExactRecord(options, ["binding", "linkService", "catalog", "catalogVersion", "uploadService",
      "resolveChatClient", "preflight", "now", "timeoutMs", "pollDelayMs", "maxPollAttempts", "wait"],
    ["now", "timeoutMs", "pollDelayMs", "maxPollAttempts", "wait"]);
    if (typeof fields.catalogVersion !== "string" || fields.catalogVersion !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION ||
        !(fields.uploadService instanceof OwnerClarityUpscaleUploadService) || types.isProxy(fields.uploadService) ||
        typeof fields.resolveChatClient !== "function" || types.isProxy(fields.resolveChatClient) ||
        typeof fields.preflight !== "function" || types.isProxy(fields.preflight) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now))) ||
        (fields.wait !== undefined && (typeof fields.wait !== "function" || types.isProxy(fields.wait))) ||
        !(fields.catalog instanceof DiscoveryCatalogRepository) || types.isProxy(fields.catalog) ||
        (fields.catalog as DiscoveryCatalogRepository).catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" ||
        (fields.catalog as DiscoveryCatalogRepository).runtime_usable !== false) invalid("INVALID_REQUEST");
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = snapshotLinkService(fields.linkService);
    this.#catalog = fields.catalog as DiscoveryCatalogRepository;
    this.#catalogVersion = fields.catalogVersion;
    this.#uploadService = fields.uploadService as OwnerClarityUpscaleUploadService;
    this.#issuer = this.#uploadService.createOwnedImageBindingIssuer();
    this.#resolveChatClient = fields.resolveChatClient as OwnerClarityUpscaleGenerationServiceOptions["resolveChatClient"];
    this.#preflight = fields.preflight as OwnerClarityUpscalePreflight;
    this.#now = fields.now as (() => number) | undefined ?? Date.now;
    this.#timeoutMs = boundedInt(fields.timeoutMs, 1, DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    this.#pollDelayMs = boundedInt(fields.pollDelayMs, 0, DEFAULT_POLL_DELAY_MS, DEFAULT_POLL_DELAY_MS);
    this.#maxPollAttempts = boundedInt(fields.maxPollAttempts, 1, MAX_POLL_ATTEMPTS, MAX_POLL_ATTEMPTS);
    this.#pollWait = fields.wait as OwnerClarityUpscaleGenerationServiceOptions["wait"] ?? waitDelay;
    validateSelectedClarityModel(this.#catalog, this.#catalogVersion);
  }

  generate(input: OwnerClarityUpscaleGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerClarityUpscaleGenerationResult> {
    const request = snapshotGenerateInput(input);
    return this.#run(request.attemptId, signal, (requestSignal) => this.#generate(request, requestSignal));
  }

  reconcile(input: OwnerClarityUpscaleReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerClarityUpscaleGenerationResult> {
    const request = snapshotReconcileInput(input);
    return this.#run(request.attemptId, signal, (requestSignal) => this.#reconcile(request, requestSignal));
  }

  async listRecoveries(input: OwnerClarityUpscaleRecoveryListInput): Promise<readonly OwnerClarityUpscaleRecoveryListItem[]> {
    this.#assertOpen();
    const request = readExactRecord(input, ["attemptId", "limit"]);
    const attemptId = safeAttempt(request.attemptId);
    if (!Number.isSafeInteger(request.limit) || (request.limit as number) < 1 || (request.limit as number) > 20) invalid();
    const principal = await this.#resolvePrincipal(attemptId);
    this.#prune();
    return Object.freeze([...this.#recoveries.values()]
      .filter((record) => record.attemptId === attemptId && sameGenerationPrincipal(record.principal, principal))
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, request.limit as number)
      .map((record) => Object.freeze({
        recovery_id: record.recovery_id, created_at: record.created_at, model_id: MODEL_ID,
        operation_id: OPERATION_ID, status: "OUTCOME_UNKNOWN" as const,
        diagnostic: snapshotClarityUnknownDiagnostic(record.diagnostic)
      })));
  }

  async invalidateAttempt(attemptIdInput: string): Promise<void> {
    if (typeof attemptIdInput !== "string" || !ATTEMPT_PATTERN.test(attemptIdInput)) return;
    for (const controller of this.#controllers.get(attemptIdInput) ?? []) controller.abort();
    await Promise.allSettled([...(this.#pendingByAttempt.get(attemptIdInput) ?? [])]);
    this.#clearAttempt(attemptIdInput);
    this.#uploadService.invalidateAttempt(attemptIdInput);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const controllers of this.#controllers.values()) for (const controller of controllers) controller.abort();
    this.#closing = (async () => {
      await Promise.allSettled([...this.#pending]);
      const attempts = new Set([...this.#controllers.keys(), ...this.#principals.keys(),
        ...[...this.#claims.values()].map((claim) => claim.attemptId), ...[...this.#recoveries.values()].map((record) => record.attemptId)]);
      for (const attempt of attempts) this.#uploadService.invalidateAttempt(attempt);
      await this.#uploadService.close();
      this.#recoveries.clear();
      this.#claims.clear();
      this.#principals.clear();
      this.#controllers.clear();
      this.#pendingByAttempt.clear();
    })();
    return this.#closing;
  }

  async #generate(request: ReturnType<typeof snapshotGenerateInput>, signal: AbortSignal): Promise<OwnerClarityUpscaleGenerationResult> {
    if (signal.aborted) throw generationError("PRE_DISPATCH_FAILED");
    const principal = await this.#resolvePrincipal(request.attemptId);
    if (signal.aborted) throw generationError("PRE_DISPATCH_FAILED");
    let candidate: OwnerClarityUpscalePreparedCandidate;
    try { candidate = await this.#prepareCandidate(request, principal, signal); }
    catch (error) {
      if (signal.aborted) throw generationError("PRE_DISPATCH_FAILED");
      if (error instanceof OwnerClarityUpscalePrepareError) throw mapPrepareError(error);
      if (error instanceof OwnerClarityUpscaleUploadServiceError) throw mapUploadError(error);
      throw generationError("IMAGE_HANDLE_UNAVAILABLE");
    }
    const claim = this.#reserveImage(request.image_handle, request.attemptId, principal, candidate.request_fingerprint);
    let recovery: RecoveryRecord | null = null;
    let dispatchPossible = false;
    let passedPreflight = false;
    const deadline = new AbsoluteRequestDeadline(this.#timeoutMs, signal,
      () => generationError("OUTCOME_UNKNOWN", recovery?.recovery_id));
    try {
      this.#assertNotAborted(deadline);
      let preflight: OwnerClarityUpscalePreflightResult;
      try { preflight = await this.#await(deadline, () => this.#preflight(request.attemptId, principal, deadline.signal)); }
      catch { throw generationError("PREFLIGHT_FAILED"); }
      this.#assertFreshPreflight(preflight);
      passedPreflight = true;
      await this.#assertPrincipal(request.attemptId, principal, deadline);
      const client = this.#resolveChatClient(request.attemptId);
      const chat = await this.#await(deadline, () => client.createImageUpscalerChat(`owner-clarity-upscale-${randomUUID()}`, deadline.signal));
      const chatUuid = safeIdentifier(chat?.chat_uuid) ? chat.chat_uuid : null;
      if (chatUuid === null) throw generationError("PRE_DISPATCH_FAILED");
      await this.#assertPrincipal(request.attemptId, principal, deadline);
      const refreshedCandidate = await this.#prepareCandidate(request, principal, deadline.signal);
      assertSamePreparedIntent(candidate, refreshedCandidate);
      candidate = refreshedCandidate;
      this.#assertFreshPreflight(preflight);
      await this.#assertPrincipal(request.attemptId, principal, deadline);
      const permit = createOwnerClarityUpscaleOneShotPermit({
        candidate, principal, attemptId: request.attemptId, catalog: this.#catalog, now: this.#now
      });
      recovery = this.#createRecovery(request.attemptId, principal, request.image_handle, chatUuid, candidate);
      claim.status = "POST_STARTED";
      dispatchPossible = true;
      const receipt = await this.#await(deadline, () => client.startClarityUpscaleWithOwnedCandidate({
        candidate, permit, principal, attemptId: request.attemptId, chat_uuid: chatUuid
      }, deadline.signal));
      if (!validReceipt(receipt, chatUuid)) throw generationError("OUTCOME_UNKNOWN", recovery.recovery_id);
      recovery.echo_message_id = receipt.message_id;
      recovery.diagnostic.echo_ack_known = true;
      recovery.diagnostic.history_get_eligible = true;
      recovery.diagnostic.phase = "POST_ACK_KNOWN";
      return await this.#observeResult(recovery, client, deadline);
    } catch (error) {
      if (dispatchPossible && recovery) {
        recovery.status = "OUTCOME_UNKNOWN";
        claim.status = "POST_STARTED";
        throw unknownGenerationError(recovery, error);
      }
      if (recovery) this.#recoveries.delete(recovery.recovery_id);
      this.#claims.delete(request.image_handle);
      if (error instanceof OwnerClarityUpscaleGenerationServiceError) throw error;
      if (error instanceof OwnerClarityUpscaleUploadServiceError) {
        throw mapUploadError(error);
      }
      if (error instanceof OwnerClarityUpscalePrepareError) throw mapPrepareError(error);
      if (deadline.abortSource !== null || signal.aborted) throw generationError("PRE_DISPATCH_FAILED");
      throw generationError(passedPreflight ? "PRE_DISPATCH_FAILED" : "PREFLIGHT_FAILED");
    } finally { deadline.close(); }
  }

  async #reconcile(request: ReturnType<typeof snapshotReconcileInput>, signal: AbortSignal): Promise<OwnerClarityUpscaleGenerationResult> {
    const recovery = this.#getRecovery(request.recovery_id, request.attemptId);
    const principal = await this.#resolvePrincipal(request.attemptId);
    if (!sameGenerationPrincipal(principal, recovery.principal)) throw generationError("RECOVERY_NOT_FOUND");
    if (recovery.echo_message_id === null) throw unknownGenerationError(recovery);
    const deadline = new AbsoluteRequestDeadline(this.#timeoutMs, signal,
      () => generationError("OUTCOME_UNKNOWN", recovery.recovery_id));
    try {
      const completionRun: CompletionRun = {
        state: createOwnerClarityUpscaleCompletionPolicy({
          startedAtMs: this.#readNow(), initialDelayMs: this.#pollDelayMs, maxRounds: MAX_POLL_ATTEMPTS
        }),
        persist: false
      };
      const result = await this.#observeResult(recovery, this.#resolveChatClient(request.attemptId), deadline, completionRun);
      this.#recoveries.delete(recovery.recovery_id);
      const claim = this.#claims.get(recovery.image_handle);
      if (claim && claim.attemptId === request.attemptId) claim.status = "COMPLETED";
      return result;
    } catch (error) {
      if (error instanceof OwnerClarityUpscaleGenerationServiceError && error.code === "RECOVERY_NOT_FOUND") throw error;
      recovery.status = "OUTCOME_UNKNOWN";
      throw unknownGenerationError(recovery, error);
    } finally { deadline.close(); }
  }

  async #observeResult(
    recovery: RecoveryRecord,
    client: ChatClient,
    deadline: AbsoluteRequestDeadline,
    completionRun: CompletionRun = { state: recovery.completion_state, persist: true }
  ): Promise<OwnerClarityUpscaleGenerationResult> {
    if (recovery.echo_message_id === null) throw unknownGenerationError(recovery);
    for (let round = 0; round < this.#maxPollAttempts; round += 1) {
      deadline.throwIfAborted();
      this.#assertCompletionWindow(recovery, completionRun.state);
      if (recovery.bound_bot_message_id === null || recovery.bound_object_id === null) {
        const binding = await this.#readAndBindHistory(recovery, client, deadline, completionRun);
        if (binding === "INVALID") throw unknownGenerationError(recovery);
        if (binding !== "BOUND") {
          const queue = await this.#readInProgress(recovery, client, deadline);
          if (queue.status === "INVALID") throw unknownGenerationError(recovery);
          if (recovery.pending_history_bot_message_id !== null) {
            const match = classifyPendingQueueBinding(queue.entries, recovery.pending_history_bot_message_id);
            if (match.status === "INVALID") throw unknownGenerationError(recovery);
            if (match.status === "BOUND") {
              recovery.bound_bot_message_id = recovery.pending_history_bot_message_id;
              recovery.bound_object_id = match.object_id;
              recovery.diagnostic.history_binding = "VALID";
            }
          }
          if (recovery.bound_bot_message_id === null || recovery.bound_object_id === null) {
            const decision = this.#decideCompletion(recovery, deadline, completionRun, {
              exactBotMessageBound: false, historyBinding: "NONE",
              queueState: queue.status === "UNKNOWN" ? "UNKNOWN" : queue.status === "EMPTY" ? "EMPTY" : "PENDING",
              resultState: "NOT_READ", unverifiedReason: null
            });
            if (decision.decision !== "WAIT" || decision.nextRead !== "HISTORY_AND_IN_PROGRESS") throw unknownGenerationError(recovery);
            await this.#pause(deadline, decision.nextDelayMs);
            continue;
          }
        }
      }

      const botMessageId = recovery.bound_bot_message_id;
      const expectedObjectId = recovery.bound_object_id;
      if (botMessageId === null || expectedObjectId === null) throw unknownGenerationError(recovery);
      let envelope: InternalClarityUpscaleResult;
      recovery.diagnostic.phase = "RESULT_GET";
      incrementClarityDiagnosticGet(recovery.diagnostic, "result");
      try {
        envelope = await this.#await(deadline, () => client.getClarityUpscaleResult(recovery.chat_uuid, botMessageId, deadline.signal));
        recovery.diagnostic.upstream_error_code = null;
      } catch (error) {
        captureClarityUpstreamError(recovery, error);
        this.#decideCompletion(recovery, deadline, completionRun, {
          exactBotMessageBound: true, historyBinding: "VALID", queueState: "UNKNOWN",
          resultState: "PENDING", unverifiedReason: recovery.diagnostic.unverified_reason
        });
        throw unknownGenerationError(recovery, error);
      }
      recovery.diagnostic.phase = "RESULT_BINDING";
      const artifact = validateClarityResultEnvelope(envelope, recovery, botMessageId, expectedObjectId);
      if (artifact) {
        const completeDecision = this.#decideCompletion(recovery, deadline, completionRun, {
          exactBotMessageBound: true, historyBinding: "VALID", queueState: "UNKNOWN",
          resultState: "COMPLETE", unverifiedReason: null
        });
        if (completeDecision.decision !== "COMPLETE") throw unknownGenerationError(recovery);
        this.#recoveries.delete(recovery.recovery_id);
        const claim = this.#claims.get(recovery.image_handle);
        if (claim && claim.attemptId === recovery.attemptId) claim.status = "COMPLETED";
        return resultFor(recovery, artifact);
      }
      recovery.diagnostic.unverified_reason = readClarityUnverifiedReason(envelope);
      const reason = recovery.diagnostic.unverified_reason;
      if (reason !== "NO_IMAGE_OBJECTS" && reason !== "RESULT_OBJECT_INCOMPLETE") {
        this.#decideCompletion(recovery, deadline, completionRun, {
          exactBotMessageBound: true, historyBinding: "VALID", queueState: "UNKNOWN",
          resultState: "INVALID", unverifiedReason: reason
        });
        throw unknownGenerationError(recovery);
      }
      const queue = await this.#readInProgress(recovery, client, deadline);
      const queueBinding = queue.status === "INVALID" ? "INVALID" : classifyBoundQueue(queue.entries, botMessageId, expectedObjectId);
      if (queueBinding === "INVALID") {
        this.#decideCompletion(recovery, deadline, completionRun, {
          exactBotMessageBound: true, historyBinding: "VALID", queueState: "UNKNOWN",
          resultState: "INVALID", unverifiedReason: null
        });
        throw unknownGenerationError(recovery);
      }
      const queueState = queue.status === "UNKNOWN" ? "UNKNOWN" : queueBinding;
      recovery.diagnostic.phase = "RESULT_WAIT";
      const decision = this.#decideCompletion(recovery, deadline, completionRun, {
        exactBotMessageBound: true, historyBinding: "VALID", queueState,
        resultState: "PENDING", unverifiedReason: reason
      });
      if (decision.decision !== "WAIT" || decision.nextRead !== "EXACT_RESULT") throw unknownGenerationError(recovery);
      await this.#pause(deadline, decision.nextDelayMs);
    }
    throw unknownGenerationError(recovery);
  }

  async #readAndBindHistory(
    recovery: RecoveryRecord,
    client: ChatClient,
    deadline: AbsoluteRequestDeadline,
    completionRun: CompletionRun
  ): Promise<"BOUND" | "PENDING" | "INVALID"> {
    recovery.diagnostic.phase = "HISTORY_GET";
    recovery.diagnostic.history_binding_reason = null;
    incrementClarityDiagnosticGet(recovery.diagnostic, "history");
    let snapshot: ChatMessageHistorySnapshot;
    try {
      snapshot = await this.#await(deadline, () => client.listMessageCandidates(recovery.chat_uuid, recovery.echo_message_id!, deadline.signal));
      recovery.diagnostic.upstream_error_code = null;
    } catch (error) {
      captureClarityUpstreamError(recovery, error);
      this.#decideCompletion(recovery, deadline, completionRun, {
        exactBotMessageBound: false, historyBinding: "NONE", queueState: "UNKNOWN",
        resultState: "NOT_READ", unverifiedReason: null
      });
      throw unknownGenerationError(recovery, error);
    }
    recovery.diagnostic.phase = "HISTORY_BINDING";
    recovery.diagnostic.history_binding_reason = null;
    let correlation: ReturnType<typeof findClarityResultMessage>;
    try { correlation = findClarityResultMessage(snapshot, recovery.chat_uuid, recovery.echo_message_id!); }
    catch {
      recovery.diagnostic.history_binding = "INVALID";
      recovery.diagnostic.history_binding_reason = "SNAPSHOT_PARSE_FAILED";
      return "INVALID";
    }
    if (correlation.kind === "INVALID") {
      recovery.diagnostic.history_binding = "INVALID";
      recovery.diagnostic.history_binding_reason = correlation.reason;
      return "INVALID";
    }
    if (correlation.kind === "READY") {
      if ((recovery.bound_bot_message_id !== null && recovery.bound_bot_message_id !== correlation.bot_message_id) ||
          (recovery.bound_object_id !== null && recovery.bound_object_id !== correlation.object_id)) {
        recovery.diagnostic.history_binding = "INVALID";
        return "INVALID";
      }
      recovery.bound_bot_message_id = correlation.bot_message_id;
      recovery.bound_object_id = correlation.object_id;
      recovery.pending_history_bot_message_id = correlation.bot_message_id;
      recovery.diagnostic.history_binding = "VALID";
      return "BOUND";
    }
    if (correlation.bot_message_id !== null) {
      if (recovery.bound_bot_message_id !== null && recovery.bound_bot_message_id !== correlation.bot_message_id) {
        recovery.diagnostic.history_binding = "INVALID";
        return "INVALID";
      }
      if (recovery.bound_bot_message_id !== null && recovery.bound_object_id !== null) {
        recovery.pending_history_bot_message_id = correlation.bot_message_id;
        recovery.diagnostic.history_binding = "VALID";
        return "BOUND";
      }
      recovery.pending_history_bot_message_id = correlation.bot_message_id;
      recovery.diagnostic.history_binding = "PENDING";
      return "PENDING";
    }
    recovery.pending_history_bot_message_id = null;
    recovery.diagnostic.history_binding = "PENDING";
    return "PENDING";
  }

  async #readInProgress(
    recovery: RecoveryRecord,
    client: ChatClient,
    deadline: AbsoluteRequestDeadline
  ): Promise<{ readonly status: "EMPTY" | "PENDING" | "UNKNOWN" | "INVALID"; readonly entries: readonly InProgressMessage[] }> {
    recovery.diagnostic.phase = "IN_PROGRESS_GET";
    try {
      const result = await this.#await(deadline, () => client.listInProgress(recovery.chat_uuid, deadline.signal));
      recovery.diagnostic.upstream_error_code = null;
      const entries = snapshotInProgress(result);
      return Object.freeze({ status: entries.length === 0 ? "EMPTY" : "PENDING", entries });
    } catch (error) {
      captureClarityUpstreamError(recovery, error);
      if (error instanceof OwnerClarityUpscaleGenerationServiceError && error.code === "OUTCOME_UNKNOWN") {
        return Object.freeze({ status: "INVALID", entries: Object.freeze([]) });
      }
      return Object.freeze({ status: "UNKNOWN", entries: Object.freeze([]) });
    }
  }

  #decideCompletion(
    recovery: RecoveryRecord,
    deadline: AbsoluteRequestDeadline,
    completionRun: CompletionRun,
    observation: {
      exactBotMessageBound: boolean;
      historyBinding: "NONE" | "PENDING" | "VALID" | "INVALID";
      queueState: "EMPTY" | "MATCHED" | "UNKNOWN" | "PENDING";
      resultState: "NOT_READ" | "PENDING" | "COMPLETE" | "INVALID";
      unverifiedReason: string | null;
    }
  ): ReturnType<typeof decideOwnerClarityUpscaleCompletion> {
    const decision = decideOwnerClarityUpscaleCompletion({
      state: completionRun.state, nowMs: this.#readNow(), aborted: deadline.signal.aborted,
      echoAckKnown: recovery.diagnostic.echo_ack_known, ...observation
    });
    if (decision.decision === "WAIT") {
      completionRun.state = decision.state;
      if (completionRun.persist) recovery.completion_state = decision.state;
    }
    return decision;
  }

  #assertCompletionWindow(recovery: RecoveryRecord, state: OwnerClarityUpscaleCompletionPolicyState): void {
    const now = this.#readNow();
    if (now < state.lastObservedAtMs || now - state.startedAtMs >= OWNER_CLARITY_COMPLETION_LIMITS.operationTimeoutMs ||
        state.rounds >= state.maxRounds) {
      throw unknownGenerationError(recovery);
    }
  }

  async #pause(deadline: AbsoluteRequestDeadline, milliseconds: number): Promise<void> {
    if (milliseconds === 0) { deadline.throwIfAborted(); return; }
    await deadline.waitFor(this.#pollWait(milliseconds, deadline.signal));
  }

  #reserveImage(imageHandle: string, attemptId: string, principal: Readonly<GenerationPrincipalRef>, requestFingerprint: string): ImageClaim {
    this.#prune();
    if (this.#claims.has(imageHandle)) throw generationError("IMAGE_HANDLE_ALREADY_USED");
    if (this.#claims.size >= MAX_LOCAL_CLAIMS) throw generationError("SERVICE_BUSY");
    const now = this.#readNow();
    if (now > Number.MAX_SAFE_INTEGER - LOCAL_BINDING_TTL_MS) throw generationError("PRE_DISPATCH_FAILED");
    const claim: ImageClaim = {
      image_handle: imageHandle, attemptId, principal, expires_at: now + LOCAL_BINDING_TTL_MS,
      request_fingerprint: requestFingerprint, status: "PREPARING"
    };
    this.#claims.set(imageHandle, claim);
    return claim;
  }

  #createRecovery(
    attemptId: string,
    principal: Readonly<GenerationPrincipalRef>,
    imageHandle: string,
    chatUuid: string,
    candidate: OwnerClarityUpscalePreparedCandidate
  ): RecoveryRecord {
    this.#prune();
    if (this.#recoveries.size >= MAX_RECOVERIES) throw generationError("SERVICE_BUSY");
    const now = this.#readNow();
    const record: RecoveryRecord = {
      recovery_id: `clarity_recovery_${randomUUID()}`,
      attemptId, principal, image_handle: imageHandle, chat_uuid: chatUuid,
      profile_schema_hash: candidate.profile_schema_hash, catalog_version: this.#catalogVersion,
      created_at: new Date(now).toISOString(),
      profile_id: candidate.profile_id,
      request_fingerprint: candidate.request_fingerprint,
      requested_scale_factor: requestedScaleFactor(candidate),
      input_image: Object.freeze({ mime_type: candidate.image.mime_type, width: candidate.image.width, height: candidate.image.height }),
      expected_output_geometry: expectedGeometry(candidate.image.width, candidate.image.height, requestedScaleFactor(candidate)),
      echo_message_id: null, bound_bot_message_id: null, bound_object_id: null,
      pending_history_bot_message_id: null,
      completion_state: createOwnerClarityUpscaleCompletionPolicy({
        startedAtMs: now, initialDelayMs: this.#pollDelayMs, maxRounds: MAX_POLL_ATTEMPTS
      }),
      status: "POST_STARTED", diagnostic: initialClarityUnknownDiagnostic()
    };
    this.#recoveries.set(record.recovery_id, record);
    return record;
  }

  async #prepareCandidate(
    request: ReturnType<typeof snapshotGenerateInput>,
    principal: Readonly<GenerationPrincipalRef>,
    signal?: AbortSignal
  ): Promise<OwnerClarityUpscalePreparedCandidate> {
    const binding = await this.#issuer.issue({ principal, attempt_id: request.attemptId, opaque_image_handle: request.image_handle });
    signal?.throwIfAborted();
    return prepareOwnerClarityUpscaleRequest({
      principal, attempt_id: request.attemptId,
      ...(request.prompt === undefined ? {} : { prompt: request.prompt }),
      parameters: request.parameters, image_binding: binding
    });
  }

  #assertFreshPreflight(value: OwnerClarityUpscalePreflightResult): void {
    const fields = readExactRecord(value, ["account", "model_access"], [], "PREFLIGHT_FAILED");
    const account = readExactRecord(fields.account, ["balance", "subscription", "contract_evidence", "source_build", "observed_at"], [], "PREFLIGHT_FAILED");
    const balance = readExactRecord(account.balance, ["unit", "available"], [], "PREFLIGHT_FAILED");
    const subscription = readExactRecord(account.subscription, ["active", "plan_type", "end_date", "end_date_kind"], [], "PREFLIGHT_FAILED");
    const access = readExactRecord(fields.model_access, ["catalog_kind", "catalog_version", "model_id", "ai_name", "model_type",
      "account_read_live", "parameter_keys", "parameters_redacted", "access", "cost", "discount_cost",
      "free_remaining_generations", "limit", "show_warning", "observed_at"], [], "PREFLIGHT_FAILED");
    const now = this.#readNow();
    if (balance.unit !== "tokens" || !(balance.available === null || typeof balance.available === "string") ||
        !validPaidSubscription(subscription, now) ||
        account.contract_evidence !== "PUBLIC_FRONTEND_OBSERVED" || account.source_build !== "1789134564" ||
        access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" ||
        access.catalog_version !== `${this.#catalog.fetched_at}.${this.#catalog.source_hashes.models.slice(7, 19)}` ||
        access.model_id !== MODEL_ID || access.ai_name !== MODEL_ID || access.model_type !== MODEL_ID ||
        access.account_read_live !== true || !Array.isArray(access.parameter_keys) || access.parameter_keys.length !== 0 ||
        access.parameters_redacted !== true || access.access !== true ||
        !isFiniteNonnegative(access.cost) && !isFiniteNonnegative(access.discount_cost)) throw generationError("PREFLIGHT_FAILED");
    if (!isFreshTimestamp(account.observed_at, now) || !isFreshTimestamp(access.observed_at, now)) throw generationError("PREFLIGHT_FAILED");
  }

  async #resolvePrincipal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    this.#assertOpen();
    let principal: Readonly<GenerationPrincipalRef>;
    try {
      principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
    } catch { throw generationError("PRINCIPAL_NOT_LINKED"); }
    if (principal.connection_id !== attemptId) throw generationError("PRINCIPAL_NOT_LINKED");
    this.#prune();
    if (!this.#principals.has(attemptId) && this.#principals.size >= MAX_PRINCIPAL_BINDINGS) throw generationError("SERVICE_BUSY");
    this.#principals.set(attemptId, Object.freeze({ principal, expiresAt: this.#readNow() + LOCAL_BINDING_TTL_MS }));
    return principal;
  }

  async #assertPrincipal(attemptId: string, expected: Readonly<GenerationPrincipalRef>, deadline: AbsoluteRequestDeadline): Promise<void> {
    const current = await this.#await(deadline, () => this.#resolvePrincipal(attemptId));
    if (!sameGenerationPrincipal(expected, current)) throw generationError("PRINCIPAL_NOT_LINKED");
  }

  async #run<T>(attemptId: string, externalSignal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.#assertOpen();
    if (this.#pending.size >= MAX_PENDING) throw generationError("SERVICE_BUSY");
    const controller = new AbortController();
    const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
    const controllers = this.#controllers.get(attemptId) ?? new Set<AbortController>();
    controllers.add(controller);
    this.#controllers.set(attemptId, controllers);
    const promise = Promise.resolve().then(() => operation(signal)).finally(() => {
      controllers.delete(controller);
      if (controllers.size === 0) this.#controllers.delete(attemptId);
      this.#pending.delete(promise);
      const byAttempt = this.#pendingByAttempt.get(attemptId);
      byAttempt?.delete(promise);
      if (byAttempt?.size === 0) this.#pendingByAttempt.delete(attemptId);
    });
    this.#pending.add(promise);
    const byAttempt = this.#pendingByAttempt.get(attemptId) ?? new Set<Promise<unknown>>();
    byAttempt.add(promise);
    this.#pendingByAttempt.set(attemptId, byAttempt);
    return promise;
  }

  #getRecovery(recoveryId: string, attemptId: string): RecoveryRecord {
    this.#prune();
    const record = this.#recoveries.get(recoveryId);
    if (!record || record.attemptId !== attemptId) throw generationError("RECOVERY_NOT_FOUND");
    return record;
  }

  #prune(): void {
    const now = this.#now();
    if (!Number.isSafeInteger(now) || now < 0) return;
    // A dispatched request may still be running after its input handle expires.
    // Keep GET-only recovery until completion/invalidation/close. Consumed
    // claims remain until explicit invalidation/close; both maps are bounded.
    for (const [handle, claim] of this.#claims) {
      if (claim.status === "PREPARING" && claim.expires_at <= now) this.#claims.delete(handle);
    }
    for (const [attempt, value] of this.#principals) if (value.expiresAt <= now) this.#principals.delete(attempt);
  }

  #clearAttempt(attemptId: string): void {
    for (const [id, record] of this.#recoveries) if (record.attemptId === attemptId) this.#recoveries.delete(id);
    for (const [handle, claim] of this.#claims) if (claim.attemptId === attemptId) this.#claims.delete(handle);
    this.#principals.delete(attemptId);
  }

  #readNow(): number {
    const now = this.#now();
    if (!Number.isSafeInteger(now) || now < 0) throw generationError("PREFLIGHT_FAILED");
    return now;
  }

  #assertOpen(): void { if (this.#closed) throw generationError("SERVICE_CLOSED"); }

  #assertNotAborted(deadline: AbsoluteRequestDeadline): void {
    try { deadline.throwIfAborted(); } catch { throw generationError("PRE_DISPATCH_FAILED"); }
  }

  async #await<T>(deadline: AbsoluteRequestDeadline, operation: () => Promise<T>): Promise<T> {
    this.#assertNotAborted(deadline);
    try { return await deadline.waitFor(Promise.resolve().then(operation)); }
    catch (error) {
      if (deadline.abortSource !== null) throw generationError("PRE_DISPATCH_FAILED");
      throw error;
    }
  }
}

function validateSelectedClarityModel(catalog: DiscoveryCatalogRepository, catalogVersion: string): void {
  if (catalogVersion !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION || catalog.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" ||
      catalog.runtime_usable !== false || catalog.fetched_at !== "2026-10-08T13:18:39.393Z" ||
      catalog.source_hashes.models !== "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444") {
    throw generationError("INVALID_REQUEST");
  }
  const model = catalog.getModel(MODEL_ID);
  if (model.id !== MODEL_ID || model.ai_name !== MODEL_ID || model.upstream_id !== MODEL_ID || model.scope !== "tool_image_upscaler" ||
      model.active !== true || !model.modalities.includes("image") || !model.operations.some((operation) => operation.id === OPERATION_ID && operation.output_modality === "image")) {
    throw generationError("INVALID_REQUEST");
  }
}

function snapshotGenerateInput(value: unknown): { attemptId: string; image_handle: string; prompt?: string; parameters: unknown } {
  const fields = readExactRecord(value, ["attemptId", "image_handle", "parameters"], ["prompt"]);
  const attemptId = safeAttempt(fields.attemptId);
  if (typeof fields.image_handle !== "string" || !IMAGE_HANDLE_PATTERN.test(fields.image_handle) ||
      (fields.prompt !== undefined && (typeof fields.prompt !== "string" ||
        Buffer.byteLength(fields.prompt, "utf8") > MAX_PROMPT_BYTES || PROMPT_CONTROL.test(fields.prompt)))) invalid();
  const prompt = fields.prompt === "" ? undefined : fields.prompt;
  return Object.freeze({ attemptId, image_handle: fields.image_handle,
    ...(prompt === undefined ? {} : { prompt }), parameters: fields.parameters });
}

function snapshotReconcileInput(value: unknown): { attemptId: string; recovery_id: string } {
  const fields = readExactRecord(value, ["attemptId", "recovery_id"]);
  return Object.freeze({ attemptId: safeAttempt(fields.attemptId), recovery_id: safeRecovery(fields.recovery_id) });
}

type ClarityHistoryBindingReason = typeof OWNER_CLARITY_UNKNOWN_HISTORY_BINDING_REASONS[number];

function findClarityResultMessage(value: ChatMessageHistorySnapshot | unknown, chatUuid: string, echoId: string):
  { kind: "INVALID"; reason: ClarityHistoryBindingReason } |
  { kind: "PENDING"; bot_message_id: string | null } |
  { kind: "READY"; bot_message_id: string; object_id: string } {
  const snapshot = readExactRecord(value, ["complete", "page", "page_size", "total_count", "total_pages", "has_next",
    "has_previous", "requested_chat_uuid", "provider_chat_id", "messages"], [], "OUTCOME_UNKNOWN");
  let messages: unknown[];
  try { messages = snapshotArray(snapshot.messages, 10, "OUTCOME_UNKNOWN"); }
  catch { return invalidClarityHistory("MESSAGE_LIST_SHAPE_OR_LIMIT_INVALID"); }
  if (snapshot.complete !== true || snapshot.page !== 1 || snapshot.page_size !== 10 || snapshot.has_next !== false ||
      snapshot.has_previous !== false) return invalidClarityHistory("PAGE_INCOMPLETE");
  if (snapshot.requested_chat_uuid !== chatUuid) return invalidClarityHistory("REQUESTED_CHAT_MISMATCH");
  if (!/^\d+$/u.test(String(snapshot.provider_chat_id))) return invalidClarityHistory("PROVIDER_CHAT_ID_INVALID");
  if (snapshot.total_count !== messages.length) return invalidClarityHistory("TOTAL_COUNT_MISMATCH");
  if (snapshot.total_pages !== 1) return invalidClarityHistory("TOTAL_PAGES_MISMATCH");
  const rows = messages.map((entry) => readExactRecord(entry, ["message_id", "provider_chat_id", "author_role", "objects"], [], "OUTCOME_UNKNOWN"));
  let objectRows: unknown[][];
  try { objectRows = rows.map((row) => snapshotArray(row.objects, 64, "OUTCOME_UNKNOWN")); }
  catch { return invalidClarityHistory("ROW_OBJECTS_SHAPE_OR_LIMIT_INVALID"); }
  const normalizedMessages: Array<Record<string, unknown>> = rows.map((row, index) => ({ ...row, objects: objectRows[index]! }));
  for (const row of normalizedMessages) {
    if (!safeIdentifier(row.message_id)) return invalidClarityHistory("MESSAGE_ID_INVALID");
    if (row.provider_chat_id !== snapshot.provider_chat_id) return invalidClarityHistory("PROVIDER_CHAT_MISMATCH");
    if (!["owner", "bot", "other"].includes(String(row.author_role))) return invalidClarityHistory("AUTHOR_ROLE_INVALID");
  }
  const echoRows = normalizedMessages.filter((row) => row.message_id === echoId);
  if (echoRows.some((row) => row.author_role !== "owner")) return invalidClarityHistory("OWNER_ECHO_AUTHOR_MISMATCH");
  const owners = normalizedMessages.filter((row) => row.author_role === "owner" && row.message_id === echoId);
  if (owners.length === 0) return invalidClarityHistory("OWNER_ECHO_MISSING");
  if (owners.length > 1) return invalidClarityHistory("OWNER_ECHO_AMBIGUOUS");
  const ownerObjects = owners[0]!.objects as unknown[];
  let ownerImageCount = 0;
  let ownerTextCount = 0;
  for (const value of ownerObjects) {
    const object = readExactRecord(value, ["message_object_id", "object_type", "model_type"]);
    if (!safeIdentifier(object.message_object_id)) return invalidClarityHistory("OWNER_ECHO_OBJECT_INVALID");
    if (object.object_type === "image") {
      ownerImageCount += 1;
      if (ownerImageCount > 1 || (object.model_type !== null && object.model_type !== MODEL_ID)) {
        return invalidClarityHistory("OWNER_ECHO_OBJECT_INVALID");
      }
    } else if (object.object_type === "text") {
      ownerTextCount += 1;
      if (ownerTextCount > 1 || (object.model_type !== null && object.model_type !== MODEL_ID)) {
        return invalidClarityHistory("OWNER_ECHO_OBJECT_INVALID");
      }
    } else {
      return invalidClarityHistory("OWNER_ECHO_OBJECT_INVALID");
    }
  }
  if (normalizedMessages.length === 1) return { kind: "PENDING", bot_message_id: null };
  if (normalizedMessages.length !== 2) return invalidClarityHistory("MESSAGE_CARDINALITY_INVALID");
  const bots = normalizedMessages.filter((row) => row.author_role === "bot");
  if (bots.length !== 1) return invalidClarityHistory("BOT_CANDIDATE_CARDINALITY_INVALID");
  const bot = bots[0]!;
  const objects = bot.objects as unknown[];
  if (objects.length === 0) return { kind: "PENDING", bot_message_id: bot.message_id as string };
  if (objects.length !== 1) return invalidClarityHistory("BOT_OBJECT_INVALID");
  const object = readExactRecord(objects[0], ["message_object_id", "object_type", "model_type"]);
  if (!safeIdentifier(object.message_object_id) || object.object_type !== "image" || object.model_type !== MODEL_ID) {
    return invalidClarityHistory("BOT_OBJECT_INVALID");
  }
  return { kind: "READY", bot_message_id: bot.message_id as string, object_id: object.message_object_id as string };
}

function invalidClarityHistory(reason: ClarityHistoryBindingReason): { kind: "INVALID"; reason: ClarityHistoryBindingReason } {
  return { kind: "INVALID", reason };
}

function validateClarityResultEnvelope(
  value: InternalClarityUpscaleResult | unknown,
  recovery: RecoveryRecord,
  expectedMessageId: string,
  expectedObjectId: string | undefined
): OwnerClarityUpscaleArtifact | null {
  const fields = readExactRecord(value, ["status", "chat_uuid", "message_id", "message_object_id", "object_type", "model_type",
    "completed", "artifact", "reason", "objects"], ["message_object_id", "object_type", "completed", "artifact", "reason", "objects"]);
  if (fields.status === "UNVERIFIED") {
    const unverified = readExactRecord(value, ["status", "chat_uuid", "message_id", "model_type", "reason", "objects"], [], "OUTCOME_UNKNOWN");
    if (unverified.chat_uuid !== recovery.chat_uuid || unverified.message_id !== expectedMessageId || unverified.model_type !== MODEL_ID ||
        typeof unverified.reason !== "string" || !CLARITY_UNVERIFIED_REASONS.has(unverified.reason) ||
        snapshotArray(unverified.objects, 0, "OUTCOME_UNKNOWN").length !== 0) {
      throw generationError("OUTCOME_UNKNOWN", recovery.recovery_id);
    }
    return null;
  }
  const exact = readExactRecord(value, ["status", "chat_uuid", "message_id", "message_object_id", "object_type", "model_type", "completed", "artifact"]);
  const artifact = readExactRecord(exact.artifact, ["url", "mime_type", "mime_source"]);
  if (exact.status !== "COMPLETE" || exact.chat_uuid !== recovery.chat_uuid || exact.message_id !== expectedMessageId ||
      !safeIdentifier(exact.message_object_id) || (expectedObjectId !== undefined && exact.message_object_id !== expectedObjectId) ||
      exact.object_type !== "image" || exact.model_type !== MODEL_ID || exact.completed !== true ||
      typeof artifact.url !== "string" || !isSafeUploadReferenceUrl(artifact.url) || artifact.mime_source !== "URL_EXTENSION" ||
      !(artifact.mime_type === null || typeof artifact.mime_type === "string" && MIME_PATTERN.test(artifact.mime_type))) {
    throw generationError("OUTCOME_UNKNOWN", recovery.recovery_id);
  }
  return Object.freeze({
    url: artifact.url,
    mime_type: typeof artifact.mime_type === "string" ? artifact.mime_type : null,
    mime_confidence: artifact.mime_type === null ? "UNKNOWN" : "URL_EXTENSION_ONLY"
  });
}

function snapshotInProgress(value: unknown): readonly InProgressMessage[] {
  const entries = snapshotArray(value, 10, "OUTCOME_UNKNOWN");
  return Object.freeze(entries.map((entry) => {
    const fields = readExactRecord(entry, ["message_id", "message_object_id", "object_type", "model_type"], [], "OUTCOME_UNKNOWN");
    if (!safeIdentifier(fields.message_id) ||
        !(fields.message_object_id === null || safeIdentifier(fields.message_object_id)) ||
        typeof fields.object_type !== "string" || typeof fields.model_type !== "string") invalid("OUTCOME_UNKNOWN");
    return Object.freeze({ message_id: fields.message_id, message_object_id: fields.message_object_id as string | null,
      object_type: fields.object_type, model_type: fields.model_type });
  }));
}

function classifyPendingQueueBinding(
  entries: readonly InProgressMessage[],
  messageId: string
): { readonly status: "BOUND"; readonly object_id: string } | { readonly status: "PENDING" | "INVALID" } {
  const matches = entries.filter((entry) => entry.message_id === messageId);
  if (matches.length === 0) return Object.freeze({ status: "PENDING" });
  if (matches.length !== 1) return Object.freeze({ status: "INVALID" });
  const entry = matches[0]!;
  if (entry.object_type !== "image" || entry.model_type !== MODEL_ID) return Object.freeze({ status: "INVALID" });
  if (!safeIdentifier(entry.message_object_id)) return Object.freeze({ status: "PENDING" });
  return Object.freeze({ status: "BOUND", object_id: entry.message_object_id });
}

function classifyBoundQueue(
  entries: readonly InProgressMessage[],
  messageId: string,
  objectId: string
): "EMPTY" | "MATCHED" | "PENDING" | "INVALID" {
  const matches = entries.filter((entry) => entry.message_id === messageId);
  if (matches.length === 0) return entries.length === 0 ? "EMPTY" : "PENDING";
  if (matches.length !== 1) return "INVALID";
  const entry = matches[0]!;
  if (entry.object_type !== "image" || entry.model_type !== MODEL_ID ||
      entry.message_object_id !== null && entry.message_object_id !== objectId) return "INVALID";
  return "MATCHED";
}

function resultFor(recovery: RecoveryRecord, artifact: OwnerClarityUpscaleArtifact): OwnerClarityUpscaleGenerationResult {
  return Object.freeze({
    status: "result_observed", backend_acceptance: "unproven", model_id: MODEL_ID, operation_id: OPERATION_ID,
    profile_id: recovery.profile_id, profile_schema_hash: recovery.profile_schema_hash,
    catalog_version: recovery.catalog_version, request_fingerprint: recovery.request_fingerprint,
    requested_scale_factor: recovery.requested_scale_factor,
    input_image: recovery.input_image,
    expected_output_geometry: recovery.expected_output_geometry,
    actual_image: Object.freeze({ mime_type: artifact.mime_type, width: null, height: null }),
    geometry_verified: false,
    artifact
  });
}

function expectedGeometry(width: number, height: number, factor: number): Readonly<{ width: number; height: number }> | null {
  const outputWidth = width * factor;
  const outputHeight = height * factor;
  if (!Number.isSafeInteger(outputWidth) || !Number.isSafeInteger(outputHeight)) return null;
  return Object.freeze({ width: outputWidth, height: outputHeight });
}

function requestedScaleFactor(candidate: OwnerClarityUpscalePreparedCandidate): number {
  return Math.round((candidate.request.settings.scale as number) * 4 * 100) / 100;
}

function assertSamePreparedIntent(left: OwnerClarityUpscalePreparedCandidate, right: OwnerClarityUpscalePreparedCandidate): void {
  if (left.model_id !== right.model_id || left.profile_schema_hash !== right.profile_schema_hash ||
      left.request.prompt !== right.request.prompt || left.query.ai_name !== right.query.ai_name ||
      !isDeepStrictEqual(left.image, right.image) ||
      !isDeepStrictEqual(withoutFileUrls(left.request.settings), withoutFileUrls(right.request.settings))) {
    throw generationError("IMAGE_HANDLE_UNAVAILABLE");
  }
}

function withoutFileUrls(settings: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const { file_urls: _fileUrls, ...rest } = settings;
  return rest;
}

function isFreshTimestamp(value: unknown, now: number): boolean {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= now && now - time <= MAX_CLOCK_SKEW_MS;
}

function validPaidSubscription(subscription: Record<string, unknown>, now: number): boolean {
  if (subscription.active !== true || typeof subscription.plan_type !== "string" ||
      subscription.plan_type.trim().length === 0 || subscription.plan_type.trim().toLocaleUpperCase("en-US") === "FREE") return false;
  if (subscription.end_date === null && subscription.end_date_kind === null) return true;
  if (typeof subscription.end_date !== "string") return false;
  let expiresAt: number;
  if (subscription.end_date_kind === "DATE_ONLY") {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(subscription.end_date)) return false;
    const todayUtc = new Date(now).toISOString().slice(0, 10);
    return subscription.end_date >= todayUtc;
  } else if (subscription.end_date_kind === "OFFSET_DATETIME") {
    if (!/(?:Z|[+-]\d{2}:\d{2})$/u.test(subscription.end_date)) return false;
    expiresAt = Date.parse(subscription.end_date);
  } else {
    // A local datetime has no timezone source; do not guess whether it has expired.
    return false;
  }
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function isFiniteNonnegative(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validReceipt(value: unknown, chatUuid: string): value is Readonly<{ chat_uuid: string; message_id: string }> {
  try {
    const fields = readExactRecord(value, ["chat_uuid", "message_id"]);
    return fields.chat_uuid === chatUuid && safeIdentifier(fields.message_id);
  } catch { return false; }
}

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = readExactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || typeof fields.subject !== "string") invalid("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}

function snapshotLinkService(value: unknown): Pick<PerUserLinkService, "getStatus"> {
  if (!value || typeof value !== "object" || types.isProxy(value)) invalid("INVALID_REQUEST");
  const method = findMethod(value, "getStatus");
  if (typeof method !== "function") invalid("INVALID_REQUEST");
  return Object.freeze({ getStatus: (binding: AuthBinding, attemptId: string) => Reflect.apply(method, value, [binding, attemptId]) });
}

function readExactRecord(
  value: unknown,
  keys: readonly string[],
  optionalKeys: readonly string[] = [],
  failureCode: OwnerClarityUpscaleGenerationServiceErrorCode = "INVALID_REQUEST"
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid(failureCode);
  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<PropertyKey, PropertyDescriptor>; }
  catch { invalid(failureCode); }
  if (prototype !== Object.prototype && prototype !== null) invalid(failureCode);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.some((key) => typeof key !== "string" || !keys.includes(key) && !optionalKeys.includes(key) ||
      !descriptors[key]?.enumerable || !("value" in descriptors[key]!)) ||
      keys.some((key) => !optionalKeys.includes(key) && !Object.hasOwn(descriptors, key))) invalid(failureCode);
  const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) record[key] = descriptors[key]!.value;
  return record;
}

function snapshotArray(value: unknown, maximum: number, failureCode: OwnerClarityUpscaleGenerationServiceErrorCode): unknown[] {
  if (!Array.isArray(value) || types.isProxy(value)) invalid(failureCode);
  let prototype: object | null;
  let ownKeys: PropertyKey[];
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    prototype = Object.getPrototypeOf(value);
    ownKeys = Reflect.ownKeys(value);
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  }
  catch { invalid(failureCode); }
  if (prototype !== Array.prototype) invalid(failureCode);
  const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : -1;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum || ownKeys.length !== length + 1) invalid(failureCode);
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) invalid(failureCode);
    result.push(descriptor.value);
  }
  return result;
}

function safeAttempt(value: unknown): string {
  if (typeof value !== "string" || !ATTEMPT_PATTERN.test(value)) invalid();
  return value;
}

function safeRecovery(value: unknown): string {
  if (typeof value !== "string" || !RECOVERY_PATTERN.test(value)) invalid();
  return value;
}

function safeIdentifier(value: unknown): value is string { return typeof value === "string" && SAFE_IDENTIFIER.test(value); }

function boundedInt(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) invalid("INVALID_REQUEST");
  return value;
}

function findMethod(target: object, key: string): unknown {
  let current: object | null = target;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function waitDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error("ABORTED"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new Error("ABORTED")); };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function generationError(code: OwnerClarityUpscaleGenerationServiceErrorCode, recoveryId?: string): OwnerClarityUpscaleGenerationServiceError {
  return new OwnerClarityUpscaleGenerationServiceError(code, recoveryId);
}

function unknownGenerationError(recovery: RecoveryRecord, cause?: unknown): OwnerClarityUpscaleGenerationServiceError {
  captureClarityUpstreamError(recovery, cause);
  return new OwnerClarityUpscaleGenerationServiceError("OUTCOME_UNKNOWN", recovery.recovery_id, recovery.diagnostic);
}

function captureClarityUpstreamError(recovery: RecoveryRecord, error: unknown): void {
  const code = safeClarityUpstreamErrorCode(error);
  if (code !== null) recovery.diagnostic.upstream_error_code = code;
}

function readClarityUnverifiedReason(value: unknown): MutableOwnerClarityUpscaleUnknownDiagnostic["unverified_reason"] {
  try {
    const fields = readExactRecord(value, ["status", "chat_uuid", "message_id", "model_type", "reason", "objects"], [], "OUTCOME_UNKNOWN");
    return fields.status === "UNVERIFIED" && typeof fields.reason === "string" &&
      (OWNER_CLARITY_UNKNOWN_UNVERIFIED_REASONS as readonly string[]).includes(fields.reason)
      ? fields.reason as MutableOwnerClarityUpscaleUnknownDiagnostic["unverified_reason"]
      : null;
  } catch { return null; }
}

function mapUploadError(error: OwnerClarityUpscaleUploadServiceError): OwnerClarityUpscaleGenerationServiceError {
  if (error.code === "PRINCIPAL_NOT_LINKED") return generationError("PRINCIPAL_NOT_LINKED");
  if (error.code === "SERVICE_BUSY" || error.code === "CAPACITY_EXCEEDED") return generationError("SERVICE_BUSY");
  if (error.code === "SERVICE_CLOSED") return generationError("SERVICE_CLOSED");
  return generationError("IMAGE_HANDLE_UNAVAILABLE");
}

function mapPrepareError(error: OwnerClarityUpscalePrepareError): OwnerClarityUpscaleGenerationServiceError {
  if (error.code === "PARAMETERS_INVALID" || error.code === "INVALID_REQUEST") return generationError("INVALID_REQUEST");
  if (error.code === "PRINCIPAL_MISMATCH") return generationError("IMAGE_HANDLE_UNAVAILABLE");
  return generationError("IMAGE_HANDLE_UNAVAILABLE");
}

function invalid(code: OwnerClarityUpscaleGenerationServiceErrorCode = "INVALID_REQUEST"): never { throw generationError(code); }
