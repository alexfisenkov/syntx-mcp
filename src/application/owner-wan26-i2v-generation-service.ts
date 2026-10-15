import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { SyntxChatHttpClient, type MediaGenerationReceipt } from "../adapter/syntx/chat-http-client.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import type {
  OwnerWan26I2vChatContext,
  OwnerWan26I2vNativeOperationInput,
  OwnerWan26I2vNativeChatOperationInput,
  OwnerWan26I2vNativeResultOperationInput,
  OwnerWan26I2vResultCandidates,
  OwnerWan26I2vResultContext
} from "../adapter/syntx/owner-wan26-i2v-native-context.js";
import { OwnerWan26I2vNativeError } from "../adapter/syntx/owner-wan26-i2v-native-context.js";
import type { OwnerWan26I2vVideoResult, OwnerWan26I2vReadyVideo } from "../adapter/syntx/owner-wan26-i2v-video-result.js";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { DiscoveryCatalogRepository, type DiscoveryModelRecord } from "../catalog/discovery-catalog.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { AccountStatusService, type AccountStatusResult } from "./account-status.js";
import { ModelAccessService, type ModelAccessResult } from "./model-access.js";
import {
  isOwnerWan26I2vPreparedCandidate,
  isOwnerWan26I2vRequestPreparer,
  type OwnerWan26I2vPreparedCandidate,
  type OwnerWan26I2vPreparedCandidateBinding,
  type OwnerWan26I2vPreparedRequest,
  type OwnerWan26I2vRequestPreparer
} from "./owner-wan26-i2v-request-preparer.js";
import {
  createOwnerWan26I2vOneShotPermit,
  revalidateOwnerWan26I2vOneShotPermit,
  type OwnerWan26I2vOneShotPermit
} from "./owner-wan26-i2v-one-shot-policy.js";
import {
  getOwnerWan26I2vGenerationParametersSource,
  normalizeOwnerWan26I2vGenerationParameters,
  OwnerWan26I2vGenerationParametersError,
  type OwnerWan26I2vGenerationModelId,
  type OwnerWan26I2vGenerationParametersCommon
} from "./owner-wan26-i2v-generation-parameters.js";

const MODEL_IDS = Object.freeze(["wan_26_i2v", "wan_26_i2v_flash"] as const);
const MODEL_NAME = "wan_video" as const;
const MODEL_HASH = "sha256:ed71470b73f05fb23a224cfdcea1727c62e8d357ffcf09d747a26c6a57053e3a" as const;
const CATALOG_FETCHED_AT = "2026-10-15T07:17:24.901Z" as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const RECOVERY_ID = /^wan26_generation_recovery_[0-9a-f-]{36}$/u;
const MAX_RECOVERIES = 128;
const MAX_ACTIVE = 4;
const PAGE_SIZE = 64;
const MAX_ARTIFACTS = 4_096;
const DEFAULT_TIMEOUT_MS = 120_000;
const ACCOUNT_FRESHNESS_MS = 120_000;
const NATIVE_ACCOUNT = AccountStatusService.prototype.getAccountStatus;
const NATIVE_ACCESS = ModelAccessService.prototype.getModelAccess;
const NATIVE_LINK_STATUS = PerUserLinkService.prototype.getStatus;
const NATIVE_CHAT_CREATE = SyntxChatHttpClient.prototype.createOwnerWan26I2vChat;
const NATIVE_START = SyntxChatHttpClient.prototype.startOwnerWan26I2vWithOwnedCandidate;
const NATIVE_LIST = SyntxChatHttpClient.prototype.listOwnedWan26I2vCandidates;
const NATIVE_GET = SyntxChatHttpClient.prototype.getOwnedWan26I2vResult;
const NATIVE_CREATE_CHAT = SyntxChatHttpClient.prototype.createChat;
const NATIVE_IMAGE_UPLOAD = SyntxChatHttpClient.prototype.uploadWan26I2vImage;
const NATIVE_AUDIO_UPLOAD = SyntxChatHttpClient.prototype.uploadWan26I2vAudio;
const SERVICE_BRAND = new WeakSet<object>();

export const OWNER_WAN26_I2V_GENERATION_CATALOG_VERSION =
  "sha256-396de1c43fcaa64082a3b6adb4539054929ca388b5b1cf951afff0130ffe2e7e.json" as const;

export interface OwnerWan26I2vGenerationServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string;
  readonly preparer: OwnerWan26I2vRequestPreparer;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly createAccountStatusService: (attemptId: string) => AccountStatusService;
  readonly createModelAccessService: (attemptId: string) => ModelAccessService;
  /** Wall clock only; candidate expiry stays owned by the preparer monotonic clock. */
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

export interface OwnerWan26I2vGenerationRequest {
  readonly model_id: OwnerWan26I2vGenerationModelId;
  readonly image_handle: string;
  readonly audio_handle: string | null;
  readonly prompt: string;
  readonly parameters: Readonly<OwnerWan26I2vGenerationParametersCommon & { native_audio: boolean }>;
}
export interface OwnerWan26I2vGenerateInput {
  readonly attemptId: string;
  readonly request: OwnerWan26I2vGenerationRequest;
}
export interface OwnerWan26I2vReconcileInput { readonly attemptId: string; readonly recovery_id: string; }
export interface OwnerWan26I2vRecoveryListInput { readonly attemptId: string; readonly limit?: number; }
export interface OwnerWan26I2vResultPageInput { readonly attemptId: string; readonly recovery_id: string; readonly offset?: number; }

export type OwnerWan26I2vGenerationDiagnosticCode =
  | "ACCOUNT_READ_UNAVAILABLE" | "ACCOUNT_STATUS_STALE" | "MODEL_ACCESS_UNAVAILABLE" | "MODEL_ACCESS_STALE"
  | "HISTORY_UNAVAILABLE" | "HISTORY_INCOMPLETE" | "HISTORY_UNVERIFIED"
  | "OWNER_ACK_MISSING" | "OWNER_ACK_AMBIGUOUS" | "OWNER_ACK_MISMATCH"
  | "BACKEND_ERROR_OBSERVED" | "RESULT_GET_UNAVAILABLE" | "RESULT_PENDING" | "RESULT_UNVERIFIED"
  | "RESULT_MODEL_ECHO_UNAVAILABLE" | "RESULT_MODEL_ECHO_MISMATCH" | "RESULT_URL_UNSAFE"
  | "NO_VIDEO_OBSERVED" | "ARTIFACT_LIMIT_EXCEEDED";
export interface OwnerWan26I2vGenerationDiagnostic {
  readonly post_started: boolean;
  readonly ack_known: boolean;
  readonly history_status: OwnerWan26I2vResultCandidates["status"] | "NOT_READ";
  readonly owner_ack_status: OwnerWan26I2vResultCandidates["owner_ack_status"] | "NOT_READ";
  readonly history_get_calls: number;
  readonly result_get_calls: number;
  readonly backend_error_observed: boolean;
  readonly pending_object_indices: readonly number[];
  readonly gaps: readonly OwnerWan26I2vGenerationDiagnosticCode[];
}
export interface OwnerWan26I2vGenerationArtifact {
  readonly object_index: number;
  readonly message_object_id: string;
  readonly object_type: "video";
  readonly object_url: string;
  readonly mime_type: "video/mp4" | "video/webm" | null;
  readonly message_id: string;
  readonly chat_uuid: string;
  readonly model_id: OwnerWan26I2vGenerationModelId;
}
export interface OwnerWan26I2vGenerationResult {
  readonly status: "completed";
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly provider_terminal_status: "UNPROVEN";
  readonly backend_acceptance: "UNPROVEN";
  readonly cost_cap_enforced: false;
  readonly model_id: OwnerWan26I2vGenerationModelId;
  readonly recovery_id: string;
  readonly observed_artifact_count: number;
  readonly offset: number;
  readonly page_size: number;
  readonly artifacts: readonly Readonly<OwnerWan26I2vGenerationArtifact>[];
  readonly has_more: boolean;
  readonly next_offset: number | null;
  readonly diagnostic: Readonly<OwnerWan26I2vGenerationDiagnostic>;
}
export interface OwnerWan26I2vRecoveryListItem {
  readonly recovery_id: string;
  readonly created_at: string;
  readonly status: "outcome_unknown" | "completed";
  readonly model_id: OwnerWan26I2vGenerationModelId;
  readonly observed_artifact_count: number;
}
export type OwnerWan26I2vGenerationServiceErrorCode =
  | "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "PRINCIPAL_NOT_LINKED"
  | "PROFILE_BINDING_MISMATCH" | "MODEL_BINDING_MISMATCH" | "PREFLIGHT_FAILED" | "INTENT_ALREADY_CLAIMED"
  | "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND" | "REQUEST_ABORTED";

export class OwnerWan26I2vGenerationServiceError extends Error {
  constructor(readonly code: OwnerWan26I2vGenerationServiceErrorCode, readonly recovery_id?: string,
    readonly diagnostic?: Readonly<OwnerWan26I2vGenerationDiagnostic>) {
    super("The owner WAN 2.6 I2V request could not be completed safely.");
    this.name = "OwnerWan26I2vGenerationServiceError";
  }
}

interface DiagnosticState {
  post_started: boolean;
  ack_known: boolean;
  history_status: OwnerWan26I2vGenerationDiagnostic["history_status"];
  owner_ack_status: OwnerWan26I2vGenerationDiagnostic["owner_ack_status"];
  history_get_calls: number;
  result_get_calls: number;
  backend_error_observed: boolean;
  pending_object_indices: number[];
  gaps: OwnerWan26I2vGenerationDiagnosticCode[];
}
interface IntentClaim {
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly state: "reserved" | "pre_dispatch_failed" | "outcome_unknown" | "completed";
  readonly reservationId?: string;
  readonly recoveryId?: string;
}
interface RecoveryRecord {
  readonly id: string;
  readonly attemptId: string;
  readonly createdAt: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly modelId: OwnerWan26I2vGenerationModelId;
  readonly intentKey: string;
  readonly candidate: OwnerWan26I2vPreparedCandidate;
  readonly permit: OwnerWan26I2vOneShotPermit;
  readonly binding: Readonly<OwnerWan26I2vPreparedCandidateBinding>;
  readonly chat: OwnerWan26I2vChatContext;
  readonly client: SyntxChatHttpClient;
  ack: string | null;
  contexts: readonly OwnerWan26I2vResultContext[];
  status: "outcome_unknown" | "completed";
  busy: boolean;
  readonly observedArtifacts: Map<string, Readonly<OwnerWan26I2vGenerationArtifact>>;
  diagnostic: DiagnosticState;
}
interface ServiceRun {
  readonly attemptId: string;
  readonly controller: AbortController;
  readonly promise: Promise<unknown>;
}

/** Two-model WAN26 I2V owner generation with one-shot dispatch and GET-only recovery. */
export class OwnerWan26I2vGenerationService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #links: PerUserLinkService;
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #preparer: OwnerWan26I2vRequestPreparer;
  readonly #resolveChatClient: OwnerWan26I2vGenerationServiceOptions["resolveChatClient"];
  readonly #createAccount: OwnerWan26I2vGenerationServiceOptions["createAccountStatusService"];
  readonly #createAccess: OwnerWan26I2vGenerationServiceOptions["createModelAccessService"];
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #claims = new Map<string, IntentClaim>();
  readonly #recoveries = new Map<string, RecoveryRecord>();
  readonly #usedAccountServices = new WeakSet<object>();
  readonly #usedAccessServices = new WeakSet<object>();
  readonly #clients = new Map<string, SyntxChatHttpClient>();
  readonly #runs = new Set<ServiceRun>();
  readonly #runsByAttempt = new Map<string, Set<ServiceRun>>();
  readonly #invalidating = new Set<string>();
  readonly #invalidations = new Map<string, Promise<void>>();
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(input: OwnerWan26I2vGenerationServiceOptions | unknown) {
    const o = exactRecord(input, ["binding", "linkService", "catalog", "catalog_version", "preparer", "resolveChatClient",
      "createAccountStatusService", "createModelAccessService"], ["now", "timeoutMs"]);
    if (!isLinkService(o.linkService) || !(o.catalog instanceof DiscoveryCatalogRepository) ||
        o.catalog_version !== OWNER_WAN26_I2V_GENERATION_CATALOG_VERSION ||
        !isOwnerWan26I2vRequestPreparer(o.preparer) || typeof o.resolveChatClient !== "function" || types.isProxy(o.resolveChatClient) ||
        typeof o.createAccountStatusService !== "function" || types.isProxy(o.createAccountStatusService) ||
        typeof o.createModelAccessService !== "function" || types.isProxy(o.createModelAccessService) ||
        (o.now !== undefined && (typeof o.now !== "function" || types.isProxy(o.now)))) fail("INVALID_REQUEST");
    this.#binding = snapshotBinding(o.binding);
    this.#links = o.linkService;
    this.#catalog = o.catalog;
    this.#preparer = o.preparer;
    this.#resolveChatClient = o.resolveChatClient as OwnerWan26I2vGenerationServiceOptions["resolveChatClient"];
    this.#createAccount = o.createAccountStatusService as OwnerWan26I2vGenerationServiceOptions["createAccountStatusService"];
    this.#createAccess = o.createModelAccessService as OwnerWan26I2vGenerationServiceOptions["createModelAccessService"];
    this.#now = o.now as (() => number) | undefined ?? Date.now;
    this.#timeoutMs = bounded(o.timeoutMs, 1_000, 300_000, DEFAULT_TIMEOUT_MS);
    this.#assertCatalog();
    SERVICE_BRAND.add(this);
    Object.freeze(this);
  }

  generate(input: OwnerWan26I2vGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerWan26I2vGenerationResult> {
    this.#assertOpen();
    const request = snapshotGenerateInput(input);
    validateSignal(signal);
    return this.#run(request.attemptId, signal, (runSignal) => this.#generate(request, runSignal));
  }

  reconcile(input: OwnerWan26I2vReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerWan26I2vGenerationResult> {
    this.#assertOpen();
    const request = snapshotRecoveryInput(input);
    validateSignal(signal);
    return this.#run(request.attemptId, signal, (runSignal) => this.#reconcile(request, runSignal));
  }

  listRecoveries(input: OwnerWan26I2vRecoveryListInput | unknown): Promise<readonly Readonly<OwnerWan26I2vRecoveryListItem>[]> {
    this.#assertOpen();
    const request = snapshotListInput(input);
    return this.#run(request.attemptId, undefined, async (signal) => {
      const deadline = this.#deadline(signal, "PREFLIGHT_FAILED");
      try {
        const principal = await this.#wait(deadline, () => this.#principal(request.attemptId));
        const client = this.#client(request.attemptId);
        await this.#assertCurrent(request.attemptId, principal, client, deadline.signal, "PRINCIPAL_NOT_LINKED");
        return Object.freeze([...this.#recoveries.values()]
          .filter((record) => record.attemptId === request.attemptId && sameGenerationPrincipal(record.principal, principal))
          .slice(-(request.limit ?? 20)).reverse().map((record) => Object.freeze({ recovery_id: record.id, created_at: record.createdAt,
            status: record.status, model_id: record.modelId, observed_artifact_count: record.observedArtifacts.size })));
      } finally { deadline.close(); }
    });
  }

  getResultPage(input: OwnerWan26I2vResultPageInput | unknown): Promise<OwnerWan26I2vGenerationResult> {
    this.#assertOpen();
    const request = snapshotPageInput(input);
    return this.#run(request.attemptId, undefined, async (signal) => {
      const deadline = this.#deadline(signal, "OUTCOME_UNKNOWN");
      try {
        const principal = await this.#wait(deadline, () => this.#principal(request.attemptId));
        const recovery = this.#ownedRecovery(request.attemptId, request.recovery_id, principal);
        const client = this.#client(request.attemptId);
        if (client !== recovery.client) fail("RECOVERY_NOT_FOUND");
        await this.#assertCurrent(request.attemptId, principal, client, signal, "RECOVERY_NOT_FOUND");
        if (recovery.status !== "completed") throw outcomeUnknown(recovery);
        return resultPage(recovery, request.offset ?? 0);
      } finally { deadline.close(); }
    });
  }

  async invalidateAttempt(value: unknown): Promise<void> {
    const attemptId = readAttempt(value);
    const prior = this.#invalidations.get(attemptId);
    if (prior) return prior;
    this.#invalidating.add(attemptId);
    const runs = [...(this.#runsByAttempt.get(attemptId) ?? [])];
    for (const run of runs) run.controller.abort();
    const invalidation = (async () => {
      try {
        try { await this.#preparer.invalidateAttempt(attemptId); } catch { /* revoke local state below too */ }
        await Promise.allSettled(runs.map((run) => run.promise));
        this.#removeAttemptState(attemptId);
      } finally { this.#invalidating.delete(attemptId); this.#invalidations.delete(attemptId); }
    })();
    this.#invalidations.set(attemptId, invalidation);
    return invalidation;
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    const attempts = new Set([...this.#runsByAttempt.keys(), ...[...this.#recoveries.values()].map((r) => r.attemptId)]);
    const runs = [...this.#runs]; for (const run of runs) run.controller.abort();
    this.#closing = (async () => {
      const invalidations = [...attempts].map((attemptId) => this.#invalidateForClose(attemptId));
      await Promise.allSettled([...invalidations, ...runs.map((run) => run.promise)]);
      this.#recoveries.clear(); this.#claims.clear(); this.#clients.clear(); this.#runsByAttempt.clear();
      await this.#preparer.close();
    })();
    return this.#closing;
  }

  async #generate(request: Readonly<OwnerWan26I2vGenerateInput>, signal: AbortSignal): Promise<OwnerWan26I2vGenerationResult> {
    const deadline = this.#deadline(signal, "PRE_DISPATCH_FAILED");
    let intentKey: string | undefined;
    let reservationId: string | undefined;
    let permitIssued = false;
    let recovery: RecoveryRecord | undefined;
    let startInvoked = false;
    try {
      const principal = await this.#wait(deadline, () => this.#principal(request.attemptId));
      const candidate = await this.#wait(deadline, () => this.#preparer.prepare({ attempt_id: request.attemptId,
        model_id: request.request.model_id, image_handle: request.request.image_handle, audio_handle: request.request.audio_handle,
        prompt: request.request.prompt, parameters: request.request.parameters }, deadline.signal));
      const binding = this.#candidateBinding(candidate, request, principal);
      const privateRequest = this.#preparer.getPrivateRequest(candidate);
      assertPrivateRequest(privateRequest, request.request);
      intentKey = claimKey(principal, binding.intent_fingerprint);
      reservationId = this.#reserve(intentKey, request.attemptId, principal);

      await this.#preflight(request.attemptId, principal, request.request, deadline);
      const client = this.#client(request.attemptId);
      await this.#assertCurrent(request.attemptId, principal, client, deadline.signal, "PRINCIPAL_NOT_LINKED");
      await this.#revalidateCandidate(candidate, binding, principal, request.attemptId, deadline);
      const permit = await this.#wait(deadline, () => createOwnerWan26I2vOneShotPermit({
        preparer: this.#preparer, candidate, principal, attemptId: request.attemptId
      }));
      permitIssued = true;
      assertPermit(permit, binding);

      const baseInput = this.#nativeOperation(candidate, permit, principal, request.attemptId);
      const chat = await this.#wait(deadline, () => Reflect.apply(NATIVE_CHAT_CREATE, client, [baseInput, deadline.signal]) as Promise<OwnerWan26I2vChatContext>);
      assertChat(chat, request.attemptId, binding);
      await this.#assertCurrent(request.attemptId, principal, client, deadline.signal, "PRINCIPAL_NOT_LINKED");

      await this.#preflight(request.attemptId, principal, request.request, deadline);
      await this.#assertCurrent(request.attemptId, principal, client, deadline.signal, "PRINCIPAL_NOT_LINKED");
      await this.#revalidateCandidate(candidate, binding, principal, request.attemptId, deadline);
      await this.#wait(deadline, () => revalidateOwnerWan26I2vOneShotPermit({
        permit, preparer: this.#preparer, candidate, principal, attemptId: request.attemptId
      }));
      await this.#assertCurrent(request.attemptId, principal, client, deadline.signal, "PRINCIPAL_NOT_LINKED");

      recovery = this.#newRecovery(request.attemptId, principal, request.request.model_id, intentKey, candidate, permit, binding, chat, client);
      this.#recoveries.set(recovery.id, recovery);
      this.#setRecoveryClaim(intentKey, recovery);
      recovery.diagnostic.post_started = true;
      startInvoked = true;
      let ack: MediaGenerationReceipt;
      try {
        ack = await this.#wait(deadline, () => Reflect.apply(NATIVE_START, client,
          [this.#nativeChatOperation(recovery!, chat), deadline.signal]) as Promise<MediaGenerationReceipt>);
      } catch (error) {
        if (validNativePreDispatchFailure(error)) {
          this.#recoveries.delete(recovery.id);
          this.#claims.set(intentKey, Object.freeze({ attemptId: request.attemptId, principal, state: "pre_dispatch_failed" }));
          fail("PRE_DISPATCH_FAILED");
        }
        throw outcomeUnknown(recovery);
      }
      if (!validAck(ack, chat.chat_uuid)) throw outcomeUnknown(recovery);
      recovery.ack = ack.message_id;
      recovery.diagnostic.ack_known = true;
      return await this.#observe(recovery, deadline);
    } catch (error) {
      if (startInvoked && recovery) {
        if (error instanceof OwnerWan26I2vGenerationServiceError && error.code === "OUTCOME_UNKNOWN") throw error;
        throw outcomeUnknown(recovery);
      }
      if (error instanceof OwnerWan26I2vGenerationServiceError) throw error;
      throw this.#mapPreDispatchError(error);
    } finally {
      if (intentKey && reservationId) this.#releaseReservation(intentKey, reservationId, permitIssued && !recovery);
      deadline.close();
    }
  }

  async #reconcile(request: Readonly<OwnerWan26I2vReconcileInput>, signal: AbortSignal): Promise<OwnerWan26I2vGenerationResult> {
    const deadline = this.#deadline(signal, "OUTCOME_UNKNOWN");
    let recovery: RecoveryRecord | undefined;
    let ownsBusy = false;
    try {
      const principal = await this.#wait(deadline, () => this.#principal(request.attemptId));
      recovery = this.#ownedRecovery(request.attemptId, request.recovery_id, principal);
      const client = this.#client(request.attemptId);
      if (client !== recovery.client) fail("RECOVERY_NOT_FOUND");
      if (recovery.busy) fail("SERVICE_BUSY");
      recovery.busy = true;
      ownsBusy = true;
      await this.#assertCurrent(request.attemptId, principal, client, deadline.signal, "RECOVERY_NOT_FOUND");
      return await this.#observe(recovery, deadline);
    } catch (error) {
      if (recovery && !(error instanceof OwnerWan26I2vGenerationServiceError && error.code === "RECOVERY_NOT_FOUND")) {
        if (error instanceof OwnerWan26I2vGenerationServiceError && error.code === "OUTCOME_UNKNOWN") throw error;
        throw outcomeUnknown(recovery);
      }
      throw this.#mapRecoveryError(error);
    } finally {
      if (recovery && ownsBusy) recovery.busy = false;
      deadline.close();
    }
  }

  async #observe(recovery: RecoveryRecord, deadline: AbsoluteRequestDeadline): Promise<OwnerWan26I2vGenerationResult> {
    await this.#assertCurrent(recovery.attemptId, recovery.principal, recovery.client, deadline.signal, "RECOVERY_NOT_FOUND");
    let history: OwnerWan26I2vResultCandidates;
    try {
      history = await this.#wait(deadline, () => Reflect.apply(NATIVE_LIST, recovery.client,
        [this.#nativeChatOperation(recovery, recovery.chat), deadline.signal]) as Promise<OwnerWan26I2vResultCandidates>);
    } catch (error) {
      if (error instanceof OwnerWan26I2vNativeError && error.code === "PRINCIPAL_NOT_LINKED") fail("RECOVERY_NOT_FOUND");
      recovery.diagnostic.history_status = "UNVERIFIED";
      recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, ["HISTORY_UNAVAILABLE"]);
      throw outcomeUnknown(recovery);
    }
    recovery.diagnostic.history_get_calls = boundedCounter(recovery.diagnostic.history_get_calls + safeCount(history.history_get_calls, 7));
    recovery.diagnostic.history_status = history.status;
    recovery.diagnostic.owner_ack_status = history.owner_ack_status;
    if (history.bot_error_observed) {
      recovery.diagnostic.backend_error_observed = true;
      recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, ["BACKEND_ERROR_OBSERVED"]);
    }
    recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, history.gaps.map((gap) => mapHistoryGap(gap)));
    if (!historyAckMatches(recovery, history)) throw outcomeUnknown(recovery);
    if (!recovery.ack && history.owner_echo_message_id) recovery.ack = history.owner_echo_message_id;
    if (history.status !== "COMPLETE" || history.history_binding_status !== "BOUND" ||
        history.history_page_status !== "COMPLETE" || history.gaps.length !== 0 || !recovery.ack || history.contexts.length === 0) {
      if (history.status === "PENDING") recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, ["HISTORY_INCOMPLETE"]);
      else if (history.status !== "COMPLETE") recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, ["HISTORY_UNVERIFIED"]);
      throw outcomeUnknown(recovery);
    }

    recovery.contexts = Object.freeze([...history.contexts]);
    let allMessagesObserved = true;
    let readyCount = 0;
    for (const context of recovery.contexts) {
      if (!validResultContext(context, recovery)) {
        allMessagesObserved = false;
        recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, ["HISTORY_UNVERIFIED"]);
        continue;
      }
      await this.#assertCurrent(recovery.attemptId, recovery.principal, recovery.client, deadline.signal, "RECOVERY_NOT_FOUND");
      recovery.diagnostic.result_get_calls = boundedCounter(recovery.diagnostic.result_get_calls + 1);
      let result: OwnerWan26I2vVideoResult;
      try {
        result = await this.#wait(deadline, () => Reflect.apply(NATIVE_GET, recovery.client,
          [this.#nativeResultOperation(recovery, context), deadline.signal]) as Promise<OwnerWan26I2vVideoResult>);
      } catch (error) {
        if (error instanceof OwnerWan26I2vNativeError && error.code === "PRINCIPAL_NOT_LINKED") fail("RECOVERY_NOT_FOUND");
        allMessagesObserved = false;
        recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, ["RESULT_GET_UNAVAILABLE"]);
        continue;
      }
      await this.#assertCurrent(recovery.attemptId, recovery.principal, recovery.client, deadline.signal, "RECOVERY_NOT_FOUND");
      if (result.backend_error_observed) {
        recovery.diagnostic.backend_error_observed = true;
        recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, ["BACKEND_ERROR_OBSERVED"]);
      }
      if (result.message_binding !== "BOUND" || result.model_echo !== "MATCHED") {
        allMessagesObserved = false;
        recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps,
          [result.model_echo === "MISMATCH" ? "RESULT_MODEL_ECHO_MISMATCH" : "RESULT_UNVERIFIED"]);
        continue;
      }
      if (result.gaps.length > 0 || result.result_status !== "OBSERVED" || result.pending_object_indices.length > 0 ||
          result.backend_error_observed) allMessagesObserved = false;
      if (result.pending_object_indices.length > 0 || result.result_status === "PENDING") {
        recovery.diagnostic.pending_object_indices = mergePending(recovery.diagnostic.pending_object_indices, result.pending_object_indices);
        recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, ["RESULT_PENDING"]);
      }
      if (result.result_status === "BACKEND_ERROR_OBSERVED") {
        recovery.diagnostic.backend_error_observed = true;
        recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, ["BACKEND_ERROR_OBSERVED"]);
      }
      if (result.gaps.length > 0) recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, result.gaps.map((gap) => mapResultGap(gap.code)));
      const ready = result.ready_videos.filter((video) => validReadyVideo(video, context, recovery));
      if (ready.length !== result.ready_videos.length) {
        allMessagesObserved = false;
        recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, ["RESULT_URL_UNSAFE"]);
      }
      if (result.result_status === "OBSERVED" && ready.length === 0) allMessagesObserved = false;
      for (const video of ready) {
        this.#storeArtifact(recovery, context, video);
        readyCount += 1;
      }
    }
    if (recovery.observedArtifacts.size > MAX_ARTIFACTS) {
      recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, ["ARTIFACT_LIMIT_EXCEEDED"]);
      throw outcomeUnknown(recovery);
    }
    if (!allMessagesObserved || recovery.observedArtifacts.size === 0) {
      if (recovery.observedArtifacts.size === 0 && readyCount === 0) recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, ["NO_VIDEO_OBSERVED"]);
      throw outcomeUnknown(recovery);
    }
    recovery.status = "completed";
    const intentClaim = this.#claims.get(recovery.intentKey);
    if (intentClaim?.recoveryId === recovery.id) this.#claims.set(recovery.intentKey, Object.freeze({ ...intentClaim, state: "completed" }));
    recovery.diagnostic.pending_object_indices = [];
    return resultPage(recovery, 0);
  }

  async #preflight(attemptId: string, principal: Readonly<GenerationPrincipalRef>, request: OwnerWan26I2vGenerationRequest,
    deadline: AbsoluteRequestDeadline): Promise<void> {
    const chatClient = this.#client(attemptId);
    await this.#assertCurrent(attemptId, principal, chatClient, deadline.signal, "PRINCIPAL_NOT_LINKED");
    let accountService: AccountStatusService;
    let accessService: ModelAccessService;
    try {
      accountService = Reflect.apply(this.#createAccount, undefined, [attemptId]) as AccountStatusService;
      accessService = Reflect.apply(this.#createAccess, undefined, [attemptId]) as ModelAccessService;
    } catch { fail("PREFLIGHT_FAILED"); }
    if (!isExactService(accountService, AccountStatusService, "getAccountStatus", NATIVE_ACCOUNT) ||
        this.#usedAccountServices.has(accountService) || !isExactService(accessService, ModelAccessService, "getModelAccess", NATIVE_ACCESS) ||
        this.#usedAccessServices.has(accessService)) fail("PREFLIGHT_FAILED");
    this.#usedAccountServices.add(accountService); this.#usedAccessServices.add(accessService);

    let account: AccountStatusResult;
    try {
      account = await this.#wait(deadline, () => Reflect.apply(NATIVE_ACCOUNT, accountService, [deadline.signal]) as Promise<AccountStatusResult>);
    } catch { fail("PREFLIGHT_FAILED"); }
    await this.#assertCurrent(attemptId, principal, chatClient, deadline.signal, "PRINCIPAL_NOT_LINKED");

    const costParameters = costParametersFor(request);
    let access: ModelAccessResult;
    try {
      access = await this.#wait(deadline, () => Reflect.apply(NATIVE_ACCESS, accessService,
        [{ model_id: request.model_id, cost_parameters: costParameters }, deadline.signal]) as Promise<ModelAccessResult>);
    } catch { fail("PREFLIGHT_FAILED"); }
    await this.#assertCurrent(attemptId, principal, chatClient, deadline.signal, "PRINCIPAL_NOT_LINKED");
    const now = this.#readWallNow();
    if (!validAccount(account, now) || !validAccess(access, this.#catalog, request.model_id, now, costParameters)) fail("PREFLIGHT_FAILED");
  }

  #candidateBinding(candidate: OwnerWan26I2vPreparedCandidate, request: Readonly<OwnerWan26I2vGenerateInput>,
    principal: Readonly<GenerationPrincipalRef>): Readonly<OwnerWan26I2vPreparedCandidateBinding> {
    if (!isOwnerWan26I2vPreparedCandidate(candidate)) fail("PRE_DISPATCH_FAILED");
    const binding = this.#preparer.inspectCandidate(candidate);
    if (!binding || candidate.model_id !== request.request.model_id || binding.model_id !== request.request.model_id ||
        binding.attempt_id !== request.attemptId || !sameGenerationPrincipal(binding.principal, principal) ||
        candidate.status !== "prepared" || candidate.dispatch_allowed !== false || candidate.runtime_usable !== false ||
        candidate.backend_acceptance !== "UNPROVEN" || candidate.source_pins.public_catalog_version !== OWNER_WAN26_I2V_GENERATION_CATALOG_VERSION ||
        candidate.source_pins.public_catalog_fetched_at !== CATALOG_FETCHED_AT || candidate.source_pins.public_models_sha256 !== MODEL_HASH ||
        candidate.source_pins.files_mention !== false || candidate.intent_fingerprint !== binding.intent_fingerprint ||
        candidate.request_fingerprint !== binding.request_fingerprint || candidate.request_fingerprint !== binding.wire_fingerprint ||
        candidate.profile_schema_hash !== binding.profile_schema_hash || !/^sha256:[a-f0-9]{64}$/u.test(binding.intent_fingerprint)) fail("PRE_DISPATCH_FAILED");
    return binding;
  }

  async #revalidateCandidate(candidate: OwnerWan26I2vPreparedCandidate, binding: Readonly<OwnerWan26I2vPreparedCandidateBinding>,
    principal: Readonly<GenerationPrincipalRef>, attemptId: string, deadline: AbsoluteRequestDeadline): Promise<void> {
    try {
      const fresh = await this.#wait(deadline, () => this.#preparer.revalidateCandidate(candidate, deadline.signal));
      if (fresh.wire_fingerprint !== binding.wire_fingerprint || fresh.intent_fingerprint !== binding.intent_fingerprint ||
          fresh.model_id !== binding.model_id || fresh.attempt_id !== attemptId || !sameGenerationPrincipal(fresh.principal, principal)) fail("PRE_DISPATCH_FAILED");
    } catch (error) {
      if (error instanceof OwnerWan26I2vGenerationServiceError) throw error;
      fail("PRE_DISPATCH_FAILED");
    }
  }

  #reserve(key: string, attemptId: string, principal: Readonly<GenerationPrincipalRef>): string {
    const old = this.#claims.get(key);
    if (old) {
      if (old.state === "outcome_unknown" && old.recoveryId) {
        const recovery = this.#recoveries.get(old.recoveryId);
        if (recovery?.status === "outcome_unknown") throw outcomeUnknown(recovery);
      }
      fail("INTENT_ALREADY_CLAIMED");
    }
    if (this.#claims.size >= MAX_RECOVERIES || this.#recoveries.size >= MAX_RECOVERIES) fail("SERVICE_BUSY");
    const reservationId = randomUUID();
    this.#claims.set(key, Object.freeze({ attemptId, principal, state: "reserved", reservationId }));
    return reservationId;
  }

  #releaseReservation(key: string, reservationId: string, retainFailedPermit: boolean): void {
    const claim = this.#claims.get(key);
    if (!claim || claim.state !== "reserved" || claim.reservationId !== reservationId) return;
    if (retainFailedPermit) this.#claims.set(key, Object.freeze({ attemptId: claim.attemptId,
      principal: claim.principal, state: "pre_dispatch_failed" }));
    else this.#claims.delete(key);
  }

  #newRecovery(attemptId: string, principal: Readonly<GenerationPrincipalRef>, modelId: OwnerWan26I2vGenerationModelId,
    intentKey: string, candidate: OwnerWan26I2vPreparedCandidate, permit: OwnerWan26I2vOneShotPermit,
    binding: Readonly<OwnerWan26I2vPreparedCandidateBinding>, chat: OwnerWan26I2vChatContext, client: SyntxChatHttpClient): RecoveryRecord {
    if (this.#recoveries.size >= MAX_RECOVERIES) fail("SERVICE_BUSY");
    const id = `wan26_generation_recovery_${randomUUID()}`;
    return { id, attemptId, createdAt: new Date(this.#readWallNow()).toISOString(), principal, modelId, intentKey,
      candidate, permit, binding, chat, client, ack: null, contexts: Object.freeze([]), status: "outcome_unknown",
      observedArtifacts: new Map(), busy: false, diagnostic: newDiagnostic() };
  }

  #setRecoveryClaim(intentKey: string, recovery: RecoveryRecord): void {
    this.#claims.set(intentKey, Object.freeze({ attemptId: recovery.attemptId, principal: recovery.principal,
      state: "outcome_unknown", recoveryId: recovery.id }));
  }

  #nativeOperation(candidate: OwnerWan26I2vPreparedCandidate, permit: OwnerWan26I2vOneShotPermit,
    principal: Readonly<GenerationPrincipalRef>, attemptId: string): OwnerWan26I2vNativeOperationInput {
    return Object.freeze({ preparer: this.#preparer, candidate, permit, principal, attemptId,
      linkService: this.#links, binding: this.#binding });
  }
  #nativeChatOperation(recovery: RecoveryRecord, chat: OwnerWan26I2vChatContext): OwnerWan26I2vNativeChatOperationInput {
    return Object.freeze({ ...this.#nativeOperation(recovery.candidate, recovery.permit, recovery.principal, recovery.attemptId), chat });
  }
  #nativeResultOperation(recovery: RecoveryRecord, context: OwnerWan26I2vResultContext): OwnerWan26I2vNativeResultOperationInput {
    return Object.freeze({ ...this.#nativeOperation(recovery.candidate, recovery.permit, recovery.principal, recovery.attemptId), context });
  }

  #storeArtifact(recovery: RecoveryRecord, context: OwnerWan26I2vResultContext, video: OwnerWan26I2vReadyVideo): void {
    const key = schemaHash([context.message_id, video.object_index, video.message_object_id]);
    const artifact: OwnerWan26I2vGenerationArtifact = Object.freeze({ object_index: video.object_index,
      message_object_id: video.message_object_id, object_type: "video", object_url: video.object_url,
      mime_type: video.mime_type, message_id: context.message_id, chat_uuid: context.chat_uuid, model_id: recovery.modelId });
    recovery.observedArtifacts.set(key, artifact);
  }

  #ownedRecovery(attemptId: string, recoveryId: string, principal: Readonly<GenerationPrincipalRef>): RecoveryRecord {
    const recovery = this.#recoveries.get(recoveryId);
    if (!recovery || recovery.attemptId !== attemptId || !sameGenerationPrincipal(recovery.principal, principal)) fail("RECOVERY_NOT_FOUND");
    return recovery;
  }

  async #principal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    try {
      const principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#links });
      return snapshotGenerationPrincipal(principal);
    }
    catch (error) {
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      fail("PRINCIPAL_NOT_LINKED");
    }
  }

  #client(attemptId: string): SyntxChatHttpClient {
    let value: unknown;
    try { value = Reflect.apply(this.#resolveChatClient, undefined, [attemptId]); }
    catch { fail("PROFILE_BINDING_MISMATCH"); }
    const client = readExactNativeClient(value);
    const previous = this.#clients.get(attemptId);
    if (previous && previous !== client) fail("PROFILE_BINDING_MISMATCH");
    this.#clients.set(attemptId, client);
    return client;
  }

  async #assertCurrent(attemptId: string, principal: Readonly<GenerationPrincipalRef>, client: SyntxChatHttpClient,
    signal: AbortSignal, errorCode: "PRINCIPAL_NOT_LINKED" | "RECOVERY_NOT_FOUND"): Promise<void> {
    if (signal.aborted) fail("REQUEST_ABORTED");
    let latest: Readonly<GenerationPrincipalRef>;
    try { latest = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#links }); }
    catch { fail(errorCode); }
    if (signal.aborted || !sameGenerationPrincipal(principal, latest) || this.#client(attemptId) !== client) fail(errorCode);
  }

  #assertCatalog(): void {
    const pins = getOwnerWan26I2vGenerationParametersSource().source_pins;
    if (pins.public_catalog_version !== OWNER_WAN26_I2V_GENERATION_CATALOG_VERSION ||
        this.#catalog.fetched_at !== CATALOG_FETCHED_AT || this.#catalog.source_hashes.models !== MODEL_HASH) fail("MODEL_BINDING_MISMATCH");
    for (const modelId of MODEL_IDS) {
      let model: DiscoveryModelRecord;
      try { model = this.#catalog.getModel(modelId); } catch { fail("MODEL_BINDING_MISMATCH"); }
      const expectedKeys = modelId === "wan_26_i2v" ? ["resolution", "video_duration"] : ["native_audio", "resolution", "video_duration"];
      const actualKeys = model.settings?.get_cost_params;
      if (model.id !== modelId || model.upstream_id !== modelId || model.ai_name !== MODEL_NAME || model.active !== true ||
          model.settings?.files_mention !== false || !Array.isArray(actualKeys) || actualKeys.length !== expectedKeys.length ||
          schemaHash([...actualKeys].sort()) !== schemaHash(expectedKeys)) fail("MODEL_BINDING_MISMATCH");
    }
  }

  #readWallNow(): number {
    let value: unknown;
    try { value = Reflect.apply(this.#now, undefined, []); } catch { fail("PREFLIGHT_FAILED"); }
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 8.64e15) fail("PREFLIGHT_FAILED");
    return value;
  }

  #deadline(signal: AbortSignal, code: "PREFLIGHT_FAILED" | "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN"): AbsoluteRequestDeadline {
    return new AbsoluteRequestDeadline(this.#timeoutMs, signal, (source) => new OwnerWan26I2vGenerationServiceError(
      source === "external" ? "REQUEST_ABORTED" : code));
  }

  #wait<T>(deadline: AbsoluteRequestDeadline, operation: () => Promise<T>): Promise<T> { return deadline.waitFor(operation()); }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }

  #run<T>(attemptId: string, parent: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.#assertOpen();
    if (this.#invalidating.has(attemptId) || this.#runs.size >= MAX_ACTIVE) fail("SERVICE_BUSY");
    const controller = new AbortController();
    const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
    let run!: ServiceRun;
    const promise = Promise.resolve().then(() => work(signal)).finally(() => {
      this.#runs.delete(run);
      const set = this.#runsByAttempt.get(attemptId); set?.delete(run); if (!set?.size) this.#runsByAttempt.delete(attemptId);
    });
    run = { attemptId, controller, promise };
    this.#runs.add(run);
    const set = this.#runsByAttempt.get(attemptId) ?? new Set<ServiceRun>(); set.add(run); this.#runsByAttempt.set(attemptId, set);
    return promise;
  }

  async #invalidateForClose(attemptId: string): Promise<void> {
    this.#invalidating.add(attemptId);
    try { await this.#preparer.invalidateAttempt(attemptId); } catch { /* wait for all local runs */ }
    await Promise.allSettled([...(this.#runsByAttempt.get(attemptId) ?? [])].map((run) => run.promise));
    this.#removeAttemptState(attemptId);
    this.#invalidating.delete(attemptId);
  }

  #removeAttemptState(attemptId: string): void {
    for (const [id, recovery] of this.#recoveries) if (recovery.attemptId === attemptId) this.#recoveries.delete(id);
    for (const [key, claim] of this.#claims) if (claim.attemptId === attemptId) this.#claims.delete(key);
    this.#clients.delete(attemptId);
  }

  #mapPreDispatchError(error: unknown): OwnerWan26I2vGenerationServiceError {
    if (error instanceof OwnerWan26I2vGenerationServiceError) return error;
    if (error instanceof OwnerReferencePrincipalError) return new OwnerWan26I2vGenerationServiceError("PRINCIPAL_NOT_LINKED");
    if (error instanceof OwnerWan26I2vNativeError && error.code === "PRINCIPAL_NOT_LINKED") return new OwnerWan26I2vGenerationServiceError("PRINCIPAL_NOT_LINKED");
    if (error instanceof OwnerWan26I2vGenerationParametersError) return new OwnerWan26I2vGenerationServiceError("INVALID_REQUEST");
    return new OwnerWan26I2vGenerationServiceError("PRE_DISPATCH_FAILED");
  }

  #mapRecoveryError(error: unknown): OwnerWan26I2vGenerationServiceError {
    if (error instanceof OwnerWan26I2vGenerationServiceError) return error;
    if (error instanceof OwnerReferencePrincipalError) return new OwnerWan26I2vGenerationServiceError("RECOVERY_NOT_FOUND");
    return new OwnerWan26I2vGenerationServiceError("RECOVERY_NOT_FOUND");
  }
}

export function isOwnerWan26I2vGenerationService(value: unknown): value is OwnerWan26I2vGenerationService {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.isFrozen(value) && SERVICE_BRAND.has(value as object);
}

function snapshotGenerateInput(value: unknown): Readonly<OwnerWan26I2vGenerateInput> {
  const outer = exactRecord(value, ["attemptId", "request"]);
  const attemptId = readAttempt(outer.attemptId);
  const raw = exactRecord(outer.request, ["model_id", "image_handle", "audio_handle", "prompt", "parameters"]);
  if (typeof raw.model_id !== "string" || !MODEL_IDS.includes(raw.model_id as OwnerWan26I2vGenerationModelId) ||
      typeof raw.image_handle !== "string" || !/^wan26image_[0-9a-f-]{36}$/u.test(raw.image_handle) ||
      !(raw.audio_handle === null || (typeof raw.audio_handle === "string" && /^wan26audio_[0-9a-f-]{36}$/u.test(raw.audio_handle))) ||
      typeof raw.prompt !== "string") fail("INVALID_REQUEST");
  let normalized: ReturnType<typeof normalizeOwnerWan26I2vGenerationParameters>;
  try { normalized = normalizeOwnerWan26I2vGenerationParameters({ model_id: raw.model_id, prompt: raw.prompt, parameters: raw.parameters }); }
  catch { fail("INVALID_REQUEST"); }
  const request: OwnerWan26I2vGenerationRequest = Object.freeze({ model_id: normalized.intent.model_id,
    image_handle: raw.image_handle, audio_handle: raw.audio_handle as string | null, prompt: normalized.intent.prompt,
    parameters: normalized.intent.parameters });
  return Object.freeze({ attemptId, request });
}

function snapshotRecoveryInput(value: unknown): Readonly<OwnerWan26I2vReconcileInput> {
  const f = exactRecord(value, ["attemptId", "recovery_id"]);
  return Object.freeze({ attemptId: readAttempt(f.attemptId), recovery_id: readRecoveryId(f.recovery_id) });
}
function snapshotListInput(value: unknown): Readonly<OwnerWan26I2vRecoveryListInput> {
  const f = exactRecord(value, ["attemptId"], ["limit"]);
  return Object.freeze({ attemptId: readAttempt(f.attemptId), limit: bounded(f.limit, 1, 128, 20) });
}
function snapshotPageInput(value: unknown): Readonly<OwnerWan26I2vResultPageInput> {
  const f = exactRecord(value, ["attemptId", "recovery_id"], ["offset"]);
  return Object.freeze({ attemptId: readAttempt(f.attemptId), recovery_id: readRecoveryId(f.recovery_id), offset: bounded(f.offset, 0, MAX_ARTIFACTS, 0) });
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    const allowed = [...required, ...optional];
    if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
        keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch { fail("INVALID_REQUEST"); }
}

function costParametersFor(request: OwnerWan26I2vGenerationRequest): Readonly<Record<string, string | number | boolean>> {
  const { resolution, video_duration, native_audio } = request.parameters;
  return request.model_id === "wan_26_i2v"
    ? Object.freeze({ resolution, video_duration })
    : Object.freeze({ resolution, video_duration, native_audio });
}

function validAccount(value: AccountStatusResult, now: number): boolean {
  if (!isPlainObject(value)) return false;
  const balance = value.balance, subscription = value.subscription;
  if (!isPlainObject(balance) || balance.unit !== "tokens" ||
      !(balance.available === null || (typeof balance.available === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(balance.available))) ||
      !isPlainObject(subscription) || subscription.active !== true || typeof subscription.end_date !== "string" ||
      !["DATE_ONLY", "LOCAL_DATETIME", "OFFSET_DATETIME"].includes(String(subscription.end_date_kind)) ||
      value.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || value.source_build !== ACCOUNT_SOURCE_BUILD || !freshAt(value.observed_at, now)) return false;
  const expiresAt = Date.parse(subscription.end_date);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function validAccess(value: ModelAccessResult, catalog: DiscoveryCatalogRepository, modelId: OwnerWan26I2vGenerationModelId,
  now: number, costParameters: Readonly<Record<string, string | number | boolean>>): boolean {
  try {
    const model = catalog.getModel(modelId);
    const expectedKeys = Object.keys(costParameters).sort();
    return value.catalog_kind === "OFFICIAL_PUBLIC_API_SNAPSHOT" &&
      value.catalog_version === `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}` &&
      value.model_id === modelId && value.ai_name === MODEL_NAME && value.model_type === model.upstream_id &&
      value.account_read_live === true && value.access === true && value.parameters_redacted === true &&
      Array.isArray(value.parameter_keys) && value.parameter_keys.length === expectedKeys.length &&
      schemaHash([...value.parameter_keys].sort()) === schemaHash(expectedKeys) &&
      validQuoteNumber(value.cost) && validQuoteNumber(value.discount_cost) && (isFiniteQuote(value.cost) || isFiniteQuote(value.discount_cost)) &&
      freshAt(value.observed_at, now);
  } catch { return false; }
}
function validQuoteNumber(value: unknown): boolean { return value === null || isFiniteQuote(value); }
function isFiniteQuote(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function freshAt(value: unknown, now: number): boolean {
  if (typeof value !== "string") return false;
  const at = Date.parse(value);
  return Number.isFinite(at) && Math.abs(now - at) <= ACCOUNT_FRESHNESS_MS;
}

function assertPrivateRequest(value: OwnerWan26I2vPreparedRequest, expected: OwnerWan26I2vGenerationRequest): void {
  if (!isPlainObject(value) || typeof value.prompt !== "string" || value.prompt !== expected.prompt || !isPlainObject(value.settings) ||
      value.settings.model_type !== expected.model_id || value.settings.resolution !== expected.parameters.resolution ||
      value.settings.aspect_ratio !== expected.parameters.aspect_ratio || value.settings.video_duration !== expected.parameters.video_duration ||
      value.settings.prompt_extend !== expected.parameters.prompt_extend || value.settings.seed !== expected.parameters.seed ||
      value.settings.native_audio !== expected.parameters.native_audio || value.settings.shot_type !== "single" ||
      value.settings.audio_setting !== "auto" || Object.hasOwn(value.settings, "duration") || !Array.isArray(value.settings.file_urls) ||
      value.settings.file_urls.length !== (expected.audio_handle === null ? 1 : 2) || value.settings.file_urls[0]?.type !== "image" ||
      (expected.audio_handle !== null && value.settings.file_urls[1]?.type !== "audio")) fail("PRE_DISPATCH_FAILED");
}

function assertPermit(value: OwnerWan26I2vOneShotPermit, binding: Readonly<OwnerWan26I2vPreparedCandidateBinding>): void {
  if (value.status !== "nominal" || value.dispatch_allowed !== false || value.runtime_usable !== false || value.backend_acceptance !== "UNPROVEN" ||
      value.model_id !== binding.model_id || value.profile_schema_hash !== binding.profile_schema_hash ||
      value.request_fingerprint !== binding.request_fingerprint || value.intent_fingerprint !== binding.intent_fingerprint ||
      value.expires_at !== binding.expires_at) fail("PRE_DISPATCH_FAILED");
}
function assertChat(chat: OwnerWan26I2vChatContext, attemptId: string, binding: Readonly<OwnerWan26I2vPreparedCandidateBinding>): void {
  if (!chat || chat.status !== "created" || !safeId(chat.chat_uuid) || chat.attempt_id !== attemptId || chat.model_id !== binding.model_id ||
      chat.profile_schema_hash !== binding.profile_schema_hash || chat.request_fingerprint !== binding.request_fingerprint ||
      chat.intent_fingerprint !== binding.intent_fingerprint || chat.expires_at !== binding.expires_at ||
      chat.dispatch_allowed !== false || chat.backend_acceptance !== "UNPROVEN") fail("PRE_DISPATCH_FAILED");
}
function validAck(ack: MediaGenerationReceipt, chatUuid: string): boolean {
  return !!ack && ack.chat_uuid === chatUuid && typeof ack.message_id === "string" && safeId(ack.message_id);
}
function validNativePreDispatchFailure(error: unknown): boolean {
  return error instanceof OwnerWan26I2vNativeError && error.code !== "OUTCOME_UNKNOWN";
}
function historyAckMatches(recovery: RecoveryRecord, history: OwnerWan26I2vResultCandidates): boolean {
  return history.owner_ack_status === "MATCHED" && typeof history.owner_echo_message_id === "string" &&
    safeId(history.owner_echo_message_id) && (recovery.ack === null || recovery.ack === history.owner_echo_message_id);
}
function validResultContext(context: OwnerWan26I2vResultContext, recovery: RecoveryRecord): boolean {
  return !!context && context.chat_uuid === recovery.chat.chat_uuid && context.model_id === recovery.modelId &&
    context.attempt_id === recovery.attemptId && context.profile_schema_hash === recovery.binding.profile_schema_hash &&
    context.intent_fingerprint === recovery.binding.intent_fingerprint && context.owner_echo_message_id === recovery.ack &&
    safeId(context.message_id) && safeProviderChatId(context.provider_chat_id) && Array.isArray(context.message_object_ids) &&
    context.message_object_ids.length > 0 && context.message_object_ids.length <= 64 &&
    context.message_object_ids.every((id) => typeof id === "string" && safeId(id)) && new Set(context.message_object_ids).size === context.message_object_ids.length;
}
function validReadyVideo(video: OwnerWan26I2vReadyVideo, context: OwnerWan26I2vResultContext, recovery: RecoveryRecord): boolean {
  return !!video && Number.isSafeInteger(video.object_index) && video.object_index >= 0 && video.object_index < context.message_object_ids.length &&
    context.message_object_ids[video.object_index] === video.message_object_id && video.object_type === "video" &&
    isSafeUploadReferenceUrl(video.object_url) && safeVideoUrl(video.object_url) &&
    (video.mime_type === null || video.mime_type === "video/mp4" || video.mime_type === "video/webm") &&
    context.model_id === recovery.modelId;
}
function safeVideoUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && /\.(?:mp4|webm)$/iu.test(url.pathname); }
  catch { return false; }
}

function newDiagnostic(): DiagnosticState {
  return { post_started: false, ack_known: false, history_status: "NOT_READ", owner_ack_status: "NOT_READ",
    history_get_calls: 0, result_get_calls: 0, backend_error_observed: false, pending_object_indices: [], gaps: [] };
}
function snapshotDiagnostic(value: DiagnosticState): Readonly<OwnerWan26I2vGenerationDiagnostic> {
  return Object.freeze({ ...value, pending_object_indices: Object.freeze([...value.pending_object_indices]), gaps: Object.freeze([...value.gaps]) });
}
function appendGaps(current: readonly OwnerWan26I2vGenerationDiagnosticCode[], add: readonly OwnerWan26I2vGenerationDiagnosticCode[]): OwnerWan26I2vGenerationDiagnosticCode[] {
  const result = [...current];
  for (const code of add) if (!result.includes(code) && result.length < 32) result.push(code);
  return result;
}
function mapHistoryGap(code: string): OwnerWan26I2vGenerationDiagnosticCode {
  if (code === "OWNER_ACK_MISSING") return "OWNER_ACK_MISSING";
  if (code === "OWNER_ACK_AMBIGUOUS") return "OWNER_ACK_AMBIGUOUS";
  if (code === "OWNER_ACK_MISMATCH") return "OWNER_ACK_MISMATCH";
  if (code === "BOT_ERROR_OBSERVED") return "BACKEND_ERROR_OBSERVED";
  if (code === "HISTORY_INCOMPLETE" || code === "HISTORY_PAGE_LIMIT" || code === "HISTORY_MESSAGE_LIMIT") return "HISTORY_INCOMPLETE";
  return "HISTORY_UNVERIFIED";
}
function mapResultGap(code: string): OwnerWan26I2vGenerationDiagnosticCode {
  if (code === "RESULT_URL_PENDING" || code === "OBJECT_NOT_COMPLETED" || code === "RESULT_COMPLETION_FLAG_INVALID") return "RESULT_PENDING";
  if (code === "MODEL_ECHO_MISMATCH") return "RESULT_MODEL_ECHO_MISMATCH";
  if (code === "MODEL_ECHO_UNAVAILABLE") return "RESULT_MODEL_ECHO_UNAVAILABLE";
  if (code === "RESULT_URL_UNSAFE") return "RESULT_URL_UNSAFE";
  return "RESULT_UNVERIFIED";
}
function mergePending(current: readonly number[], next: readonly number[]): number[] {
  return [...new Set([...current, ...next].filter((value) => Number.isSafeInteger(value) && value >= 0 && value < 64))].slice(0, 64);
}
function safeCount(value: unknown, maximum: number): number { return Number.isSafeInteger(value) && (value as number) >= 0 ? Math.min(value as number, maximum) : 0; }
function boundedCounter(value: number): number { return Math.max(0, Math.min(10_000, value)); }

function resultPage(recovery: RecoveryRecord, offset: number): OwnerWan26I2vGenerationResult {
  const order = new Map(recovery.contexts.map((context, index) => [context.message_id, index] as const));
  const all = [...recovery.observedArtifacts.values()].sort((a, b) =>
    (order.get(a.message_id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.message_id) ?? Number.MAX_SAFE_INTEGER) ||
    a.object_index - b.object_index);
  const artifacts = all.slice(offset, offset + PAGE_SIZE);
  const hasMore = offset + artifacts.length < all.length;
  return Object.freeze({ status: "completed", status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY",
    provider_terminal_status: "UNPROVEN", backend_acceptance: "UNPROVEN", cost_cap_enforced: false,
    model_id: recovery.modelId, recovery_id: recovery.id, observed_artifact_count: all.length, offset,
    page_size: artifacts.length, artifacts: Object.freeze(artifacts), has_more: hasMore,
    next_offset: hasMore ? offset + artifacts.length : null, diagnostic: snapshotDiagnostic(recovery.diagnostic) });
}
function outcomeUnknown(recovery: RecoveryRecord): OwnerWan26I2vGenerationServiceError {
  return new OwnerWan26I2vGenerationServiceError("OUTCOME_UNKNOWN", recovery.id, snapshotDiagnostic(recovery.diagnostic));
}
function claimKey(principal: Readonly<GenerationPrincipalRef>, intent: string): string {
  return schemaHash([principal.tenant_id, principal.subject_id, principal.connection_id, intent]);
}
function readAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST"); return value; }
function readRecoveryId(value: unknown): string { if (typeof value !== "string" || !RECOVERY_ID.test(value)) fail("INVALID_REQUEST"); return value; }
function safeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function safeProviderChatId(value: unknown): value is string { return typeof value === "string" && /^\d{1,16}$/u.test(value); }
function isPlainObject(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  try { const prototype = Object.getPrototypeOf(value); return prototype === Object.prototype || prototype === null; }
  catch { return false; }
}
function isLinkService(value: unknown): value is PerUserLinkService {
  return isExactInstance(value, PerUserLinkService, "getStatus", NATIVE_LINK_STATUS);
}
function isExactService<T extends object, K extends keyof T>(value: unknown, ctor: new (...args: any[]) => T, method: K, native: unknown): value is T {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  try {
    return value instanceof ctor && Object.getPrototypeOf(value) === ctor.prototype && !Object.hasOwn(value, method) &&
      Object.getOwnPropertyDescriptor(ctor.prototype, method)?.value === native && Reflect.get(value, method) === native;
  } catch { return false; }
}
function isExactInstance<T extends object, K extends keyof T>(value: unknown, ctor: new (...args: any[]) => T, method: K, native: unknown): value is T {
  return isExactService(value, ctor, method, native);
}
function readExactNativeClient(value: unknown): SyntxChatHttpClient {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype ||
      ["createOwnerWan26I2vChat", "startOwnerWan26I2vWithOwnedCandidate", "listOwnedWan26I2vCandidates", "getOwnedWan26I2vResult",
        "createChat", "uploadWan26I2vImage", "uploadWan26I2vAudio"].some((key) => Object.hasOwn(value, key)) ||
      SyntxChatHttpClient.prototype.createOwnerWan26I2vChat !== NATIVE_CHAT_CREATE ||
      SyntxChatHttpClient.prototype.startOwnerWan26I2vWithOwnedCandidate !== NATIVE_START ||
      SyntxChatHttpClient.prototype.listOwnedWan26I2vCandidates !== NATIVE_LIST ||
      SyntxChatHttpClient.prototype.getOwnedWan26I2vResult !== NATIVE_GET ||
      SyntxChatHttpClient.prototype.createChat !== NATIVE_CREATE_CHAT ||
      SyntxChatHttpClient.prototype.uploadWan26I2vImage !== NATIVE_IMAGE_UPLOAD ||
      SyntxChatHttpClient.prototype.uploadWan26I2vAudio !== NATIVE_AUDIO_UPLOAD ||
      Reflect.get(value, "createOwnerWan26I2vChat") !== NATIVE_CHAT_CREATE ||
      Reflect.get(value, "startOwnerWan26I2vWithOwnedCandidate") !== NATIVE_START ||
      Reflect.get(value, "listOwnedWan26I2vCandidates") !== NATIVE_LIST ||
      Reflect.get(value, "getOwnedWan26I2vResult") !== NATIVE_GET) fail("PROFILE_BINDING_MISMATCH");
  return value as SyntxChatHttpClient;
}
function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const f = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof f.tenant_id !== "string" || !f.tenant_id.trim() || typeof f.subject !== "string" || !f.subject.trim()) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: f.tenant_id, subject: f.subject });
}
function validateSignal(value?: AbortSignal): void { if (value !== undefined && (!value || types.isProxy(value) || !(value instanceof AbortSignal))) fail("INVALID_REQUEST"); }
function bounded(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail("INVALID_REQUEST");
  return value;
}
function fail(code: OwnerWan26I2vGenerationServiceErrorCode): never { throw new OwnerWan26I2vGenerationServiceError(code); }
