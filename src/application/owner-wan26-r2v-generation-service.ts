import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { SyntxChatHttpClient, type MediaGenerationReceipt } from "../adapter/syntx/chat-http-client.js";
import type { SyntxHttpErrorCode } from "../adapter/syntx/http-client.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import {
  closeOwnerWan26R2vNativeContextsForClient,
  invalidateOwnerWan26R2vNativeAttempt,
  OwnerWan26R2vNativeError,
  type OwnerWan26R2vChatContext,
  type OwnerWan26R2vNativeOperationInput,
  type OwnerWan26R2vResultCandidates,
  type OwnerWan26R2vResultContext,
  type OwnerWan26R2vResult
} from "../adapter/syntx/owner-wan26-r2v-native-context.js";
import type { OwnerWan26R2vReadyVideo } from "../adapter/syntx/owner-wan26-r2v-video-result.js";
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
  isOwnerWan26R2vPreparedCandidate,
  isOwnerWan26R2vRequestPreparer,
  type OwnerWan26R2vPreparedCandidate,
  type OwnerWan26R2vPreparedCandidateBinding,
  type OwnerWan26R2vPreparedRequest,
  type OwnerWan26R2vRequestPreparer
} from "./owner-wan26-r2v-request-preparer.js";
import {
  createOwnerWan26R2vOneShotPermit,
  revalidateOwnerWan26R2vOneShotPermit,
  type OwnerWan26R2vOneShotPermit
} from "./owner-wan26-r2v-one-shot-policy.js";
import {
  getOwnerWan26R2vGenerationParametersSource,
  normalizeOwnerWan26R2vGenerationParameters,
  type OwnerWan26R2vGenerationModelId,
  type OwnerWan26R2vGenerationParameters
} from "./owner-wan26-r2v-generation-parameters.js";
import { OwnerWan26R2vReferenceService } from "./owner-wan26-r2v-reference-service.js";

const MODEL_IDS = ["wan_26_r2v", "wan_26_r2v_flash"] as const;
const MODEL_NAME = "wan_video" as const;
const CATALOG_VERSION = "sha256-396de1c43fcaa64082a3b6adb4539054929ca388b5b1cf951afff0130ffe2e7e.json" as const;
const CATALOG_FETCHED_AT = "2026-10-15T07:17:24.901Z" as const;
const MODEL_HASH = "sha256:ed71470b73f05fb23a224cfdcea1727c62e8d357ffcf09d747a26c6a57053e3a" as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const RECOVERY_ID = /^wan26_r2v_recovery_[0-9a-f-]{36}$/u;
const MAX_RECOVERIES = 128;
const MAX_ACTIVE = 4;
const PAGE_SIZE = 64;
const MAX_ARTIFACTS = 4_096;
const DEFAULT_TIMEOUT_MS = 120_000;
const ACCOUNT_FRESHNESS_MS = 120_000;
const SAFE_START_ERROR_CLASSES = new Set<SyntxHttpErrorCode>([
  "INVALID_REQUEST", "AUTH_REQUIRED", "AUTH_OR_ACCESS_DENIED", "UPSTREAM_RATE_LIMITED",
  "UPSTREAM_UNAVAILABLE", "UPSTREAM_TIMEOUT", "UPSTREAM_REQUEST_ABORTED", "UPSTREAM_PROTOCOL_ERROR"
]);
const LINK_STATUS = PerUserLinkService.prototype.getStatus;
const ACCOUNT_READ = AccountStatusService.prototype.getAccountStatus;
const ACCESS_READ = ModelAccessService.prototype.getModelAccess;
const CHAT_CREATE = SyntxChatHttpClient.prototype.createOwnerWan26R2vChat;
const CHAT_START = SyntxChatHttpClient.prototype.startOwnerWan26R2vWithOwnedCandidate;
const HISTORY_LIST = SyntxChatHttpClient.prototype.listOwnedWan26R2vCandidates;
const RESULT_GET = SyntxChatHttpClient.prototype.getOwnedWan26R2vResult;
const SERVICE_BRAND = new WeakSet<object>();

export const OWNER_WAN26_R2V_GENERATION_CATALOG_VERSION = CATALOG_VERSION;

export interface OwnerWan26R2vGenerationServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string;
  readonly preparer: OwnerWan26R2vRequestPreparer;
  readonly referenceService: OwnerWan26R2vReferenceService;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly createAccountStatusService: (attemptId: string) => AccountStatusService;
  readonly createModelAccessService: (attemptId: string) => ModelAccessService;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

export interface OwnerWan26R2vGenerateInput {
  readonly attemptId: string;
  readonly request: Readonly<{
    readonly model_id: OwnerWan26R2vGenerationModelId;
    readonly prompt: string;
    readonly parameters: OwnerWan26R2vGenerationParameters;
    readonly reference_handles: readonly string[];
  }>;
}
export interface OwnerWan26R2vReconcileInput { readonly attemptId: string; readonly recovery_id: string; }
export interface OwnerWan26R2vRecoveryListInput { readonly attemptId: string; readonly limit?: number; }
export interface OwnerWan26R2vResultPageInput { readonly attemptId: string; readonly recovery_id: string; readonly offset?: number; }

export type OwnerWan26R2vGenerationDiagnosticCode =
  | "ACCOUNT_READ_UNAVAILABLE" | "ACCOUNT_STATUS_STALE" | "MODEL_ACCESS_UNAVAILABLE" | "MODEL_ACCESS_STALE"
  | "HISTORY_UNAVAILABLE" | "HISTORY_INCOMPLETE" | "HISTORY_UNVERIFIED" | "OWNER_ACK_MISSING"
  | "OWNER_ACK_AMBIGUOUS" | "OWNER_ACK_MISMATCH" | "BACKEND_ERROR_OBSERVED" | "RESULT_GET_UNAVAILABLE"
  | "RESULT_PENDING" | "RESULT_UNVERIFIED" | "RESULT_MODEL_ECHO_UNAVAILABLE" | "RESULT_MODEL_ECHO_MISMATCH"
  | "RESULT_URL_UNSAFE" | "NO_VIDEO_OBSERVED" | "ARTIFACT_LIMIT_EXCEEDED";

export interface OwnerWan26R2vGenerationDiagnostic {
  readonly post_started: boolean;
  readonly ack_known: boolean;
  readonly history_status: OwnerWan26R2vResultCandidates["status"] | "NOT_READ";
  readonly owner_ack_status: OwnerWan26R2vResultCandidates["owner_ack_status"] | "NOT_READ";
  readonly history_get_calls: number;
  readonly result_get_calls: number;
  readonly backend_error_observed: boolean;
  readonly start_error_class?: SyntxHttpErrorCode | null;
  readonly pending_object_indices: readonly number[];
  readonly gaps: readonly OwnerWan26R2vGenerationDiagnosticCode[];
}
export interface OwnerWan26R2vGenerationArtifact {
  readonly object_index: number;
  readonly message_object_id: string;
  readonly object_type: "video";
  readonly object_url: string;
  readonly mime_type: "video/mp4" | "video/webm" | null;
  readonly message_id: string;
  readonly chat_uuid: string;
  readonly model_id: OwnerWan26R2vGenerationModelId;
}
export interface OwnerWan26R2vGenerationResult {
  readonly status: "completed";
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly provider_terminal_status: "UNPROVEN";
  readonly backend_acceptance: "UNPROVEN";
  readonly cost_cap_enforced: false;
  readonly source_binding: Readonly<{
    readonly public_catalog_version: string;
    readonly profile_schema_hash: string;
    readonly request_fingerprint: string;
    readonly intent_fingerprint: string;
    readonly source_readiness: "PARTIAL_SOURCE_EXPLICIT_SETTINGS";
  }>;
  readonly model_id: OwnerWan26R2vGenerationModelId;
  readonly recovery_id: string;
  readonly observed_artifact_count: number;
  readonly offset: number;
  readonly page_size: number;
  readonly artifacts: readonly Readonly<OwnerWan26R2vGenerationArtifact>[];
  readonly has_more: boolean;
  readonly next_offset: number | null;
  readonly diagnostic: Readonly<OwnerWan26R2vGenerationDiagnostic>;
}
export interface OwnerWan26R2vRecoveryListItem {
  readonly recovery_id: string;
  readonly created_at: string;
  readonly status: "outcome_unknown" | "completed";
  readonly model_id: OwnerWan26R2vGenerationModelId;
  readonly observed_artifact_count: number;
}
export type OwnerWan26R2vGenerationServiceErrorCode =
  | "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "PRINCIPAL_NOT_LINKED"
  | "MODEL_BINDING_MISMATCH" | "PREFLIGHT_FAILED" | "INTENT_ALREADY_CLAIMED"
  | "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND" | "REQUEST_ABORTED";
export class OwnerWan26R2vGenerationServiceError extends Error {
  constructor(readonly code: OwnerWan26R2vGenerationServiceErrorCode, readonly recovery_id?: string,
    readonly diagnostic?: Readonly<OwnerWan26R2vGenerationDiagnostic>) {
    super("The owner WAN 2.6 R2V request could not be completed safely.");
    this.name = "OwnerWan26R2vGenerationServiceError";
  }
}

interface DiagnosticState {
  post_started: boolean; ack_known: boolean;
  history_status: OwnerWan26R2vGenerationDiagnostic["history_status"];
  owner_ack_status: OwnerWan26R2vGenerationDiagnostic["owner_ack_status"];
  history_get_calls: number; result_get_calls: number; backend_error_observed: boolean;
  start_error_class: SyntxHttpErrorCode | null;
  pending_object_indices: number[]; gaps: OwnerWan26R2vGenerationDiagnosticCode[];
}
interface Claim { readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>; readonly reservationId: string; }
interface Recovery {
  readonly id: string; readonly attemptId: string; readonly createdAt: string;
  readonly principal: Readonly<GenerationPrincipalRef>; readonly intentKey: string;
  readonly modelId: OwnerWan26R2vGenerationModelId; readonly candidate: OwnerWan26R2vPreparedCandidate;
  readonly permit: OwnerWan26R2vOneShotPermit; readonly binding: Readonly<OwnerWan26R2vPreparedCandidateBinding>;
  readonly chat: OwnerWan26R2vChatContext; readonly client: SyntxChatHttpClient;
  ack: string | null; contexts: readonly OwnerWan26R2vResultContext[];
  status: "outcome_unknown" | "completed"; busy: boolean;
  readonly artifacts: Map<string, Readonly<OwnerWan26R2vGenerationArtifact>>; diagnostic: DiagnosticState;
}
interface Run { readonly attemptId: string; readonly controller: AbortController; readonly promise: Promise<unknown>; }

/** Owner-only WAN26 R2V generation, finite per-call preflight, one-shot POST and GET-only process-local recovery. */
export class OwnerWan26R2vGenerationService {
  readonly #binding: Readonly<AuthBinding>; readonly #links: PerUserLinkService;
  readonly #catalog: DiscoveryCatalogRepository; readonly #preparer: OwnerWan26R2vRequestPreparer;
  readonly #references: OwnerWan26R2vReferenceService;
  readonly #resolve: OwnerWan26R2vGenerationServiceOptions["resolveChatClient"];
  readonly #createAccount: OwnerWan26R2vGenerationServiceOptions["createAccountStatusService"];
  readonly #createAccess: OwnerWan26R2vGenerationServiceOptions["createModelAccessService"];
  readonly #now: () => number; readonly #timeoutMs: number;
  readonly #claims = new Map<string, Claim>(); readonly #recoveries = new Map<string, Recovery>();
  readonly #dispatchedIntents = new Set<string>();
  readonly #usedAccounts = new WeakSet<object>(); readonly #usedAccess = new WeakSet<object>();
  readonly #clients = new Map<string, SyntxChatHttpClient>();
  readonly #runs = new Set<Run>(); readonly #runsByAttempt = new Map<string, Set<Run>>();
  readonly #invalidating = new Set<string>(); readonly #invalidations = new Map<string, Promise<void>>();
  #closed = false; #closing: Promise<void> | undefined;

  constructor(input: OwnerWan26R2vGenerationServiceOptions | unknown) {
    const o = exact(input, ["binding", "linkService", "catalog", "catalog_version", "preparer", "referenceService", "resolveChatClient",
      "createAccountStatusService", "createModelAccessService"], ["now", "timeoutMs"]);
    if (!isLinkService(o.linkService) || !(o.catalog instanceof DiscoveryCatalogRepository) || o.catalog_version !== CATALOG_VERSION ||
        !isOwnerWan26R2vRequestPreparer(o.preparer) || !exactReferenceService(o.referenceService) ||
        typeof o.resolveChatClient !== "function" || types.isProxy(o.resolveChatClient) ||
        typeof o.createAccountStatusService !== "function" || types.isProxy(o.createAccountStatusService) ||
        typeof o.createModelAccessService !== "function" || types.isProxy(o.createModelAccessService) ||
        (o.now !== undefined && (typeof o.now !== "function" || types.isProxy(o.now)))) fail("INVALID_REQUEST");
    this.#binding = snapshotBinding(o.binding); this.#links = o.linkService; this.#catalog = o.catalog;
    this.#preparer = o.preparer; this.#references = o.referenceService;
    this.#resolve = o.resolveChatClient as OwnerWan26R2vGenerationServiceOptions["resolveChatClient"];
    this.#createAccount = o.createAccountStatusService as OwnerWan26R2vGenerationServiceOptions["createAccountStatusService"];
    this.#createAccess = o.createModelAccessService as OwnerWan26R2vGenerationServiceOptions["createModelAccessService"];
    this.#now = (o.now as (() => number) | undefined) ?? Date.now;
    this.#timeoutMs = bounded(o.timeoutMs, 1_000, 300_000, DEFAULT_TIMEOUT_MS);
    this.#assertCatalog(); SERVICE_BRAND.add(this); Object.freeze(this);
  }

  generate(input: OwnerWan26R2vGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerWan26R2vGenerationResult> {
    this.#assertOpen(); const request = snapshotGenerate(input); validateSignal(signal);
    return this.#run(request.attemptId, signal, (s) => this.#generate(request, s));
  }
  reconcile(input: OwnerWan26R2vReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerWan26R2vGenerationResult> {
    this.#assertOpen(); const request = snapshotRecovery(input); validateSignal(signal);
    return this.#run(request.attemptId, signal, (s) => this.#reconcile(request, s));
  }
  listRecoveries(input: OwnerWan26R2vRecoveryListInput | unknown): Promise<readonly Readonly<OwnerWan26R2vRecoveryListItem>[]> {
    this.#assertOpen(); const request = snapshotList(input);
    return this.#run(request.attemptId, undefined, async (signal) => {
      const deadline = this.#deadline(signal, "PREFLIGHT_FAILED");
      try {
        const principal = await this.#wait(deadline, () => this.#principal(request.attemptId));
        const client = this.#client(request.attemptId);
        await this.#assertCurrent(request.attemptId, principal, client, deadline.signal, "PRINCIPAL_NOT_LINKED");
        return Object.freeze([...this.#recoveries.values()].filter((r) => r.attemptId === request.attemptId &&
          sameGenerationPrincipal(r.principal, principal)).slice(-(request.limit ?? 20)).reverse().map((r) => Object.freeze({
          recovery_id: r.id, created_at: r.createdAt, status: r.status, model_id: r.modelId, observed_artifact_count: r.artifacts.size
        })));
      } finally { deadline.close(); }
    });
  }
  getResultPage(input: OwnerWan26R2vResultPageInput | unknown): Promise<OwnerWan26R2vGenerationResult> {
    this.#assertOpen(); const request = snapshotPage(input);
    return this.#run(request.attemptId, undefined, async (signal) => {
      const deadline = this.#deadline(signal, "OUTCOME_UNKNOWN");
      try {
        const principal = await this.#wait(deadline, () => this.#principal(request.attemptId));
        const recovery = this.#owned(request.attemptId, request.recovery_id, principal);
        const client = this.#client(request.attemptId);
        if (client !== recovery.client) fail("RECOVERY_NOT_FOUND");
        await this.#assertCurrent(request.attemptId, principal, client, deadline.signal, "RECOVERY_NOT_FOUND");
        if (recovery.status !== "completed") throw recoveryUnknown(recovery);
        return page(recovery, request.offset ?? 0);
      } finally { deadline.close(); }
    });
  }

  invalidateAttempt(value: unknown): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.#assertOpen();
    const attempt = readAttempt(value), prior = this.#invalidations.get(attempt); if (prior) return prior;
    if (!this.#hasAttemptState(attempt)) return Promise.resolve();
    this.#invalidating.add(attempt); const runs = [...(this.#runsByAttempt.get(attempt) ?? [])];
    for (const run of runs) run.controller.abort();
    let operation!: Promise<void>;
    operation = (async () => {
      await Promise.allSettled(runs.map((run) => run.promise));
      const client = this.#clients.get(attempt);
      try { if (client) invalidateOwnerWan26R2vNativeAttempt(client, attempt); } catch { /* continue private-state cleanup */ }
      try { await this.#preparer.invalidateAttempt(attempt); } catch { /* local state is cleared below */ }
      this.#removeAttempt(attempt);
    })().finally(() => {
      if (this.#invalidations.get(attempt) === operation) this.#invalidations.delete(attempt);
      this.#invalidating.delete(attempt);
    });
    this.#invalidations.set(attempt, operation); return operation;
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    const attempts = new Set([...this.#runsByAttempt.keys(), ...this.#clients.keys(),
      ...[...this.#claims.values()].map((claim) => claim.attemptId), ...[...this.#recoveries.values()].map((r) => r.attemptId),
      ...this.#invalidations.keys()]);
    const invalidations = [...this.#invalidations.values()];
    const clients = [...this.#clients.values()];
    const runs = [...this.#runs]; for (const run of runs) run.controller.abort();
    this.#closing = (async () => {
      await Promise.allSettled(invalidations);
      const remaining = [...attempts].filter((attempt) => this.#hasAttemptState(attempt));
      await Promise.allSettled([...remaining.map((attempt) => this.#invalidateForClose(attempt)), ...runs.map((run) => run.promise)]);
      for (const client of clients) closeOwnerWan26R2vNativeContextsForClient(client);
      this.#clients.clear(); this.#recoveries.clear(); this.#claims.clear(); this.#dispatchedIntents.clear();
      this.#runsByAttempt.clear(); this.#invalidating.clear(); this.#invalidations.clear();
      await this.#preparer.close();
    })(); return this.#closing;
  }

  async #generate(input: Readonly<OwnerWan26R2vGenerateInput>, signal: AbortSignal): Promise<OwnerWan26R2vGenerationResult> {
    const d = this.#deadline(signal, "PRE_DISPATCH_FAILED"); let key: string | undefined; let reservationId: string | undefined;
    let recovery: Recovery | undefined; let startCalled = false;
    try {
      const principal = await this.#wait(d, () => this.#principal(input.attemptId));
      const candidate = await this.#wait(d, () => this.#preparer.prepare({ attemptId: input.attemptId, ...input.request }, d.signal));
      const binding = this.#candidateBinding(candidate, input, principal);
      const privateRequest = this.#preparer.getPrivateRequest(candidate);
      assertPrivateRequest(privateRequest, input.request, candidate);
      key = claimKey(principal, binding.intent_fingerprint); reservationId = this.#reserve(key, input.attemptId, principal);
      await this.#preflight(input.attemptId, principal, privateRequest, d);
      const client = this.#client(input.attemptId);
      await this.#assertCurrent(input.attemptId, principal, client, d.signal, "PRINCIPAL_NOT_LINKED");
      await this.#revalidateCandidate(candidate, binding, principal, input.attemptId, d);
      const permit = await this.#wait(d, () => createOwnerWan26R2vOneShotPermit({
        preparer: this.#preparer, candidate, principal, attemptId: input.attemptId
      }));
      assertPermit(permit, binding);
      const base = this.#nativeOperation(candidate, permit, principal, input.attemptId);
      const chat = await this.#wait(d, () => Reflect.apply(CHAT_CREATE, client, [base, d.signal]) as Promise<OwnerWan26R2vChatContext>);
      assertChat(chat, input.attemptId, binding);
      await this.#assertCurrent(input.attemptId, principal, client, d.signal, "PRINCIPAL_NOT_LINKED");
      await this.#preflight(input.attemptId, principal, privateRequest, d);
      await this.#assertCurrent(input.attemptId, principal, client, d.signal, "PRINCIPAL_NOT_LINKED");
      await this.#revalidateCandidate(candidate, binding, principal, input.attemptId, d);
      await this.#wait(d, () => revalidateOwnerWan26R2vOneShotPermit({ permit, preparer: this.#preparer,
        candidate, principal, attemptId: input.attemptId }, d.signal));
      await this.#assertCurrent(input.attemptId, principal, client, d.signal, "PRINCIPAL_NOT_LINKED");

      recovery = this.#newRecovery(input.attemptId, principal, key, candidate, permit, binding, chat, client);
      if (this.#dispatchedIntents.size >= MAX_RECOVERIES) fail("SERVICE_BUSY");
      this.#claims.delete(key); this.#dispatchedIntents.add(key); this.#recoveries.set(recovery.id, recovery);
      recovery.diagnostic.post_started = true; startCalled = true;
      let ack: MediaGenerationReceipt;
      try {
        ack = await this.#wait(d, () => Reflect.apply(CHAT_START, client, [Object.freeze({ ...base, chat }), d.signal]) as Promise<MediaGenerationReceipt>);
      } catch (error) {
        if (error instanceof OwnerWan26R2vNativeError && error.code !== "OUTCOME_UNKNOWN") {
          recovery.diagnostic.post_started = false;
          this.#recoveries.delete(recovery.id); this.#dispatchedIntents.delete(key); recovery = undefined;
          fail("PRE_DISPATCH_FAILED");
        }
        if (error instanceof OwnerWan26R2vNativeError && error.code === "OUTCOME_UNKNOWN") {
          recovery.diagnostic.start_error_class = canonicalStartErrorClass(error.start_error_class);
        }
        throw recoveryUnknown(recovery);
      }
      if (!validAck(ack, chat.chat_uuid)) throw recoveryUnknown(recovery);
      recovery.ack = ack.message_id; recovery.diagnostic.ack_known = true;
      return await this.#observe(recovery, d);
    } catch (error) {
      if (startCalled && recovery) {
        if (error instanceof OwnerWan26R2vGenerationServiceError && error.code === "OUTCOME_UNKNOWN") throw error;
        throw recoveryUnknown(recovery);
      }
      if (error instanceof OwnerWan26R2vGenerationServiceError) throw error;
      throw this.#mapPreDispatch(error);
    } finally {
      if (recovery) recovery.busy = false;
      if (key && reservationId && !recovery && this.#claims.get(key)?.reservationId === reservationId) this.#claims.delete(key);
      d.close();
    }
  }

  async #reconcile(input: Readonly<OwnerWan26R2vReconcileInput>, signal: AbortSignal): Promise<OwnerWan26R2vGenerationResult> {
    const d = this.#deadline(signal, "OUTCOME_UNKNOWN"); let recovery: Recovery | undefined; let ownsBusy = false;
    try {
      const principal = await this.#wait(d, () => this.#principal(input.attemptId));
      recovery = this.#owned(input.attemptId, input.recovery_id, principal);
      const client = this.#client(input.attemptId); if (client !== recovery.client) fail("RECOVERY_NOT_FOUND");
      if (recovery.busy) fail("SERVICE_BUSY"); recovery.busy = true; ownsBusy = true;
      await this.#assertCurrent(input.attemptId, principal, client, d.signal, "RECOVERY_NOT_FOUND");
      return await this.#observe(recovery, d);
    } catch (error) {
      if (recovery && !(error instanceof OwnerWan26R2vGenerationServiceError && error.code === "RECOVERY_NOT_FOUND")) {
        if (error instanceof OwnerWan26R2vGenerationServiceError &&
            (error.code === "OUTCOME_UNKNOWN" || error.code === "SERVICE_BUSY" || error.code === "REQUEST_ABORTED")) throw error;
        throw recoveryUnknown(recovery);
      }
      throw this.#mapRecovery(error);
    } finally { if (recovery && ownsBusy) recovery.busy = false; d.close(); }
  }

  async #observe(recovery: Recovery, d: AbsoluteRequestDeadline): Promise<OwnerWan26R2vGenerationResult> {
    await this.#assertCurrent(recovery.attemptId, recovery.principal, recovery.client, d.signal, "RECOVERY_NOT_FOUND");
    recovery.diagnostic.history_status = "NOT_READ";
    recovery.diagnostic.owner_ack_status = "NOT_READ";
    recovery.diagnostic.backend_error_observed = false;
    recovery.diagnostic.pending_object_indices = [];
    recovery.diagnostic.gaps = [];
    let history: OwnerWan26R2vResultCandidates;
    try { history = await this.#wait(d, () => Reflect.apply(HISTORY_LIST, recovery.client, [recovery.chat, d.signal]) as Promise<OwnerWan26R2vResultCandidates>); }
    catch { recovery.diagnostic.history_status = "UNVERIFIED"; addGap(recovery, "HISTORY_UNAVAILABLE"); throw recoveryUnknown(recovery); }
    recovery.diagnostic.history_get_calls = Math.min(10_000, recovery.diagnostic.history_get_calls +
      (Number.isSafeInteger(history.history_get_calls) && history.history_get_calls >= 0 ? history.history_get_calls : 0));
    recovery.diagnostic.history_status = history.status; recovery.diagnostic.owner_ack_status = history.owner_ack_status;
    if (history.bot_error_observed) { recovery.diagnostic.backend_error_observed = true; addGap(recovery, "BACKEND_ERROR_OBSERVED"); }
    for (const gap of history.gaps) addGap(recovery, mapHistoryGap(gap));
    if (history.owner_ack_status !== "MATCHED" || !history.owner_echo_message_id ||
        (recovery.ack !== null && recovery.ack !== history.owner_echo_message_id)) {
      addGap(recovery, history.owner_ack_status === "AMBIGUOUS" ? "OWNER_ACK_AMBIGUOUS" :
        history.owner_ack_status === "MISMATCH" ? "OWNER_ACK_MISMATCH" : "OWNER_ACK_MISSING");
      throw recoveryUnknown(recovery);
    }
    if (history.status !== "COMPLETE" || history.history_binding_status !== "BOUND" || history.history_page_status !== "COMPLETE" ||
        history.gaps.length > 0 || history.contexts.length === 0) {
      addGap(recovery, history.status === "PENDING" || history.history_page_status === "INCOMPLETE" ? "HISTORY_INCOMPLETE" : "HISTORY_UNVERIFIED");
      throw recoveryUnknown(recovery);
    }
    recovery.ack ??= history.owner_echo_message_id; recovery.diagnostic.ack_known = true;
    recovery.contexts = Object.freeze([...history.contexts]); let fullyObserved = true; let readyCount = 0;
    for (const context of recovery.contexts) {
      if (!validContext(context, recovery)) { fullyObserved = false; addGap(recovery, "HISTORY_UNVERIFIED"); continue; }
      await this.#assertCurrent(recovery.attemptId, recovery.principal, recovery.client, d.signal, "RECOVERY_NOT_FOUND");
      recovery.diagnostic.result_get_calls += 1;
      let result: OwnerWan26R2vResult;
      try { result = await this.#wait(d, () => Reflect.apply(RESULT_GET, recovery.client, [context, d.signal]) as Promise<OwnerWan26R2vResult>); }
      catch { fullyObserved = false; addGap(recovery, "RESULT_GET_UNAVAILABLE"); continue; }
      await this.#assertCurrent(recovery.attemptId, recovery.principal, recovery.client, d.signal, "RECOVERY_NOT_FOUND");
      if (result.message_binding !== "BOUND" || result.model_echo !== "MATCHED") {
        fullyObserved = false; addGap(recovery, result.model_echo === "MISMATCH" ? "RESULT_MODEL_ECHO_MISMATCH" :
          result.model_echo === "UNKNOWN" ? "RESULT_MODEL_ECHO_UNAVAILABLE" : "RESULT_UNVERIFIED"); continue;
      }
      if (result.result_status !== "OBSERVED" || result.pending_object_indices.length || result.gaps.length) fullyObserved = false;
      if (result.pending_object_indices.length || result.result_status === "PENDING") {
        recovery.diagnostic.pending_object_indices = [...new Set([...recovery.diagnostic.pending_object_indices,
          ...result.pending_object_indices.filter((index) => Number.isSafeInteger(index) && index >= 0 && index < 64)])].slice(0, 64);
        addGap(recovery, "RESULT_PENDING");
      }
      for (const gap of result.gaps) addGap(recovery, mapResultGap(gap.code));
      const ready = result.ready_videos.filter((video) => validReady(video, context, recovery));
      if (ready.length !== result.ready_videos.length) { fullyObserved = false; addGap(recovery, "RESULT_URL_UNSAFE"); }
      if (result.result_status === "OBSERVED" && ready.length === 0) fullyObserved = false;
      for (const video of ready) {
        if (!this.#storeArtifact(recovery, context, video)) { addGap(recovery, "ARTIFACT_LIMIT_EXCEEDED"); throw recoveryUnknown(recovery); }
        readyCount += 1;
      }
    }
    if (recovery.artifacts.size > MAX_ARTIFACTS) { addGap(recovery, "ARTIFACT_LIMIT_EXCEEDED"); throw recoveryUnknown(recovery); }
    if (!fullyObserved || recovery.artifacts.size === 0) {
      if (!readyCount && !recovery.artifacts.size) addGap(recovery, "NO_VIDEO_OBSERVED");
      throw recoveryUnknown(recovery);
    }
    recovery.status = "completed"; recovery.diagnostic.pending_object_indices = [];
    return page(recovery, 0);
  }

  async #preflight(attemptId: string, principal: Readonly<GenerationPrincipalRef>, request: OwnerWan26R2vPreparedRequest,
    d: AbsoluteRequestDeadline): Promise<void> {
    const client = this.#client(attemptId); await this.#assertCurrent(attemptId, principal, client, d.signal, "PRINCIPAL_NOT_LINKED");
    let accountService: AccountStatusService; let accessService: ModelAccessService;
    try { accountService = Reflect.apply(this.#createAccount, undefined, [attemptId]) as AccountStatusService;
      accessService = Reflect.apply(this.#createAccess, undefined, [attemptId]) as ModelAccessService; }
    catch { fail("PREFLIGHT_FAILED"); }
    if (!exactInstance(accountService, AccountStatusService, "getAccountStatus", ACCOUNT_READ) || this.#usedAccounts.has(accountService) ||
        !exactInstance(accessService, ModelAccessService, "getModelAccess", ACCESS_READ) || this.#usedAccess.has(accessService)) fail("PREFLIGHT_FAILED");
    this.#usedAccounts.add(accountService); this.#usedAccess.add(accessService);
    let account: AccountStatusResult;
    try { account = await this.#wait(d, () => Reflect.apply(ACCOUNT_READ, accountService, [d.signal]) as Promise<AccountStatusResult>); }
    catch { fail("PREFLIGHT_FAILED"); }
    await this.#assertCurrent(attemptId, principal, client, d.signal, "PRINCIPAL_NOT_LINKED");
    const modelId = request.settings.model_type, cost = costParameters(request);
    let access: ModelAccessResult;
    try { access = await this.#wait(d, () => Reflect.apply(ACCESS_READ, accessService,
      [{ model_id: modelId, cost_parameters: cost }, d.signal]) as Promise<ModelAccessResult>); }
    catch { fail("PREFLIGHT_FAILED"); }
    await this.#assertCurrent(attemptId, principal, client, d.signal, "PRINCIPAL_NOT_LINKED");
    const now = this.#readNow();
    if (!validAccount(account, now) || !validAccess(access, this.#catalog, modelId, now, cost)) fail("PREFLIGHT_FAILED");
  }

  #candidateBinding(candidate: OwnerWan26R2vPreparedCandidate, request: Readonly<OwnerWan26R2vGenerateInput>,
    principal: Readonly<GenerationPrincipalRef>): Readonly<OwnerWan26R2vPreparedCandidateBinding> {
    if (!isOwnerWan26R2vPreparedCandidate(candidate)) fail("PRE_DISPATCH_FAILED");
    const binding = this.#preparer.inspectCandidate(candidate);
    if (!binding || binding.model_id !== request.request.model_id || candidate.model_id !== binding.model_id ||
        binding.attempt_id !== request.attemptId || !sameGenerationPrincipal(binding.principal, principal) ||
        candidate.status !== "prepared" || candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" ||
        candidate.source_readiness !== "PARTIAL_SOURCE_EXPLICIT_SETTINGS" || candidate.prompt_readiness !== "CURRENT_PROMPT_RULES_NOT_ESTABLISHED" ||
        candidate.settings_readiness !== "FULL_CURRENT_SETTINGS_NOT_ESTABLISHED" || candidate.intent_fingerprint !== binding.intent_fingerprint ||
        candidate.request_fingerprint !== binding.request_fingerprint || candidate.profile_schema_hash !== binding.profile_schema_hash ||
        candidate.expires_at !== binding.expires_at || !/^sha256:[a-f0-9]{64}$/u.test(binding.private_request_fingerprint)) fail("PRE_DISPATCH_FAILED");
    return binding;
  }
  async #revalidateCandidate(candidate: OwnerWan26R2vPreparedCandidate, original: Readonly<OwnerWan26R2vPreparedCandidateBinding>,
    principal: Readonly<GenerationPrincipalRef>, attempt: string, d: AbsoluteRequestDeadline): Promise<void> {
    try {
      const fresh = await this.#wait(d, () => this.#preparer.revalidateCandidate(candidate, d.signal));
      const current = this.#preparer.inspectCandidate(candidate);
      if (!current || schemaHash(current) !== schemaHash(original) || schemaHash(fresh) !== schemaHash(original) ||
          fresh.attempt_id !== attempt || !sameGenerationPrincipal(fresh.principal, principal)) fail("PRE_DISPATCH_FAILED");
    } catch (error) { if (error instanceof OwnerWan26R2vGenerationServiceError) throw error; fail("PRE_DISPATCH_FAILED"); }
  }
  #reserve(key: string, attemptId: string, principal: Readonly<GenerationPrincipalRef>): string {
    if (this.#claims.has(key) || this.#dispatchedIntents.has(key)) fail("INTENT_ALREADY_CLAIMED");
    if (this.#claims.size + this.#dispatchedIntents.size >= MAX_RECOVERIES || this.#recoveries.size >= MAX_RECOVERIES) fail("SERVICE_BUSY");
    const reservationId = randomUUID();
    this.#claims.set(key, Object.freeze({ attemptId, principal, reservationId }));
    return reservationId;
  }
  #newRecovery(attemptId: string, principal: Readonly<GenerationPrincipalRef>, intentKey: string,
    candidate: OwnerWan26R2vPreparedCandidate, permit: OwnerWan26R2vOneShotPermit,
    binding: Readonly<OwnerWan26R2vPreparedCandidateBinding>, chat: OwnerWan26R2vChatContext,
    client: SyntxChatHttpClient): Recovery {
    if (this.#recoveries.size >= MAX_RECOVERIES) fail("SERVICE_BUSY");
    return { id: `wan26_r2v_recovery_${randomUUID()}`, attemptId, createdAt: new Date(this.#readNow()).toISOString(), principal,
      intentKey, modelId: binding.model_id, candidate, permit, binding, chat, client, ack: null,
      contexts: Object.freeze([]), status: "outcome_unknown", busy: true, artifacts: new Map(), diagnostic: newDiagnostic() };
  }
  #nativeOperation(candidate: OwnerWan26R2vPreparedCandidate, permit: OwnerWan26R2vOneShotPermit,
    principal: Readonly<GenerationPrincipalRef>, attemptId: string): OwnerWan26R2vNativeOperationInput {
    return Object.freeze({ preparer: this.#preparer, candidate, permit, referenceService: this.#references,
      principal, attemptId, linkService: this.#links, binding: this.#binding });
  }
  #storeArtifact(recovery: Recovery, context: OwnerWan26R2vResultContext, video: OwnerWan26R2vReadyVideo): boolean {
    const key = schemaHash([context.message_id, video.object_index, video.message_object_id]);
    if (recovery.artifacts.has(key)) return true;
    if (recovery.artifacts.size >= MAX_ARTIFACTS) return false;
    recovery.artifacts.set(key, Object.freeze({ object_index: video.object_index, message_object_id: video.message_object_id,
      object_type: "video", object_url: video.object_url, mime_type: video.mime_type, message_id: context.message_id,
      chat_uuid: context.chat_uuid, model_id: recovery.modelId }));
    return true;
  }
  #owned(attempt: string, id: string, principal: Readonly<GenerationPrincipalRef>): Recovery {
    const recovery = this.#recoveries.get(id);
    if (!recovery || recovery.attemptId !== attempt || !sameGenerationPrincipal(recovery.principal, principal)) fail("RECOVERY_NOT_FOUND");
    return recovery;
  }
  async #principal(attempt: string): Promise<Readonly<GenerationPrincipalRef>> {
    try {
      const principal = snapshotGenerationPrincipal(await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: attempt, linkService: this.#links }));
      if (principal.connection_id !== attempt || principal.tenant_id !== this.#binding.tenant_id || principal.subject_id !== this.#binding.subject) fail("PRINCIPAL_NOT_LINKED");
      return principal;
    } catch { fail("PRINCIPAL_NOT_LINKED"); }
  }
  #client(attempt: string): SyntxChatHttpClient {
    if (this.#closed) fail("SERVICE_CLOSED");
    if (this.#invalidating.has(attempt)) fail("REQUEST_ABORTED");
    let value: unknown; try { value = Reflect.apply(this.#resolve, undefined, [attempt]); } catch { fail("MODEL_BINDING_MISMATCH"); }
    const client = nativeClient(value), previous = this.#clients.get(attempt);
    if (this.#closed || this.#invalidating.has(attempt)) fail(this.#closed ? "SERVICE_CLOSED" : "REQUEST_ABORTED");
    if (!previous && this.#clients.size >= MAX_RECOVERIES) fail("SERVICE_BUSY");
    if (previous && previous !== client) fail("MODEL_BINDING_MISMATCH"); this.#clients.set(attempt, client); return client;
  }
  async #assertCurrent(attempt: string, principal: Readonly<GenerationPrincipalRef>, client: SyntxChatHttpClient,
    signal: AbortSignal, code: "PRINCIPAL_NOT_LINKED" | "RECOVERY_NOT_FOUND"): Promise<void> {
    if (signal.aborted || this.#invalidating.has(attempt)) fail("REQUEST_ABORTED");
    try { const latest = await this.#principal(attempt);
      if (signal.aborted || this.#invalidating.has(attempt) || !sameGenerationPrincipal(principal, latest) || this.#client(attempt) !== client) fail(code);
    } catch { fail(code); }
  }
  #assertCatalog(): void {
    const pins = getOwnerWan26R2vGenerationParametersSource().source_pins;
    if (pins.public_catalog_version !== CATALOG_VERSION || pins.public_catalog_fetched_at !== CATALOG_FETCHED_AT ||
        pins.public_models_sha256 !== MODEL_HASH || this.#catalog.fetched_at !== CATALOG_FETCHED_AT || this.#catalog.source_hashes.models !== MODEL_HASH) fail("MODEL_BINDING_MISMATCH");
    for (const id of MODEL_IDS) {
      let model: DiscoveryModelRecord; try { model = this.#catalog.getModel(id); } catch { fail("MODEL_BINDING_MISMATCH"); }
      const keys = id === "wan_26_r2v" ? ["duration", "resolution", "video_duration"] : ["duration", "native_audio", "resolution", "video_duration"];
      if (model.id !== id || model.upstream_id !== id || model.ai_name !== MODEL_NAME || model.active !== true ||
          !Array.isArray(model.settings?.get_cost_params) || schemaHash([...model.settings.get_cost_params].sort()) !== schemaHash(keys)) fail("MODEL_BINDING_MISMATCH");
    }
  }
  #readNow(): number { let value: unknown; try { value = Reflect.apply(this.#now, undefined, []); } catch { fail("PREFLIGHT_FAILED"); }
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 8.64e15) fail("PREFLIGHT_FAILED"); return value; }
  #deadline(signal: AbortSignal, code: "PREFLIGHT_FAILED" | "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN"): AbsoluteRequestDeadline {
    return new AbsoluteRequestDeadline(this.#timeoutMs, signal, (source) => new OwnerWan26R2vGenerationServiceError(source === "external" ? "REQUEST_ABORTED" : code));
  }
  #wait<T>(d: AbsoluteRequestDeadline, operation: () => Promise<T>): Promise<T> { d.throwIfAborted(); return d.waitFor(operation()); }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  #run<T>(attempt: string, parent: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.#assertOpen(); if (this.#invalidating.has(attempt) || this.#runs.size >= MAX_ACTIVE) fail("SERVICE_BUSY");
    const controller = new AbortController(), signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
    let run!: Run; const promise = Promise.resolve().then(() => work(signal)).finally(() => {
      this.#runs.delete(run); const set = this.#runsByAttempt.get(attempt); set?.delete(run); if (!set?.size) this.#runsByAttempt.delete(attempt);
    });
    run = { attemptId: attempt, controller, promise }; this.#runs.add(run);
    const set = this.#runsByAttempt.get(attempt) ?? new Set<Run>(); set.add(run); this.#runsByAttempt.set(attempt, set); return promise;
  }
  async #invalidateForClose(attempt: string): Promise<void> {
    if (!this.#hasAttemptState(attempt)) return;
    this.#invalidating.add(attempt); const runs = [...(this.#runsByAttempt.get(attempt) ?? [])]; for (const run of runs) run.controller.abort();
    try {
      await Promise.allSettled(runs.map((run) => run.promise)); const client = this.#clients.get(attempt);
      try { if (client) invalidateOwnerWan26R2vNativeAttempt(client, attempt); } catch { /* continue private-state cleanup */ }
      try { await this.#preparer.invalidateAttempt(attempt); } catch { /* local state is cleared below */ }
      this.#removeAttempt(attempt);
    } finally { this.#invalidating.delete(attempt); }
  }
  #removeAttempt(attempt: string): void {
    for (const [id, recovery] of this.#recoveries) if (recovery.attemptId === attempt) this.#recoveries.delete(id);
    for (const [key, claim] of this.#claims) if (claim.attemptId === attempt) this.#claims.delete(key);
    this.#clients.delete(attempt);
  }
  #hasAttemptState(attempt: string): boolean {
    return this.#clients.has(attempt) || this.#runsByAttempt.has(attempt) ||
      [...this.#claims.values()].some((claim) => claim.attemptId === attempt) ||
      [...this.#recoveries.values()].some((recovery) => recovery.attemptId === attempt);
  }
  #mapPreDispatch(error: unknown): OwnerWan26R2vGenerationServiceError {
    if (error instanceof OwnerWan26R2vGenerationServiceError) return error;
    if (error instanceof OwnerReferencePrincipalError) return new OwnerWan26R2vGenerationServiceError("PRINCIPAL_NOT_LINKED");
    if (error instanceof OwnerWan26R2vNativeError && error.code === "PRINCIPAL_NOT_LINKED") return new OwnerWan26R2vGenerationServiceError("PRINCIPAL_NOT_LINKED");
    return new OwnerWan26R2vGenerationServiceError("PRE_DISPATCH_FAILED");
  }
  #mapRecovery(error: unknown): OwnerWan26R2vGenerationServiceError {
    return error instanceof OwnerWan26R2vGenerationServiceError ? error : new OwnerWan26R2vGenerationServiceError("RECOVERY_NOT_FOUND");
  }
}

export function isOwnerWan26R2vGenerationService(value: unknown): value is OwnerWan26R2vGenerationService {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.isFrozen(value) && SERVICE_BRAND.has(value as object);
}

function snapshotGenerate(value: unknown): Readonly<OwnerWan26R2vGenerateInput> {
  const outer = exact(value, ["attemptId", "request"]), attemptId = readAttempt(outer.attemptId);
  const raw = exact(outer.request, ["model_id", "prompt", "parameters", "reference_handles"]);
  if (typeof raw.model_id !== "string" || !MODEL_IDS.includes(raw.model_id as OwnerWan26R2vGenerationModelId) || typeof raw.prompt !== "string" ||
      !Array.isArray(raw.reference_handles) || types.isProxy(raw.reference_handles) || raw.reference_handles.length < 1 || raw.reference_handles.length > 5 ||
      Object.getPrototypeOf(raw.reference_handles) !== Array.prototype) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(raw.reference_handles);
  const descriptorKeys = Reflect.ownKeys(descriptors);
  if (Object.getOwnPropertyDescriptor(raw.reference_handles, "length")?.value !== raw.reference_handles.length ||
      descriptorKeys.length !== raw.reference_handles.length + 1 || descriptorKeys.some((key) => key !== "length" &&
        (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= raw.reference_handles.length))) fail("INVALID_REQUEST");
  const handles: string[] = [];
  for (let i = 0; i < raw.reference_handles.length; i += 1) {
    const d = descriptors[String(i)]; if (!d || !("value" in d) || !d.enumerable || typeof d.value !== "string" || !/^wan26ref_[0-9a-f]{32}$/u.test(d.value)) fail("INVALID_REQUEST");
    handles.push(d.value);
  }
  if (new Set(handles).size !== handles.length) fail("INVALID_REQUEST");
  let normalized: ReturnType<typeof normalizeOwnerWan26R2vGenerationParameters>;
  try { normalized = normalizeOwnerWan26R2vGenerationParameters({ model_id: raw.model_id, prompt: raw.prompt, parameters: raw.parameters }); }
  catch { fail("INVALID_REQUEST"); }
  return Object.freeze({ attemptId, request: Object.freeze({ ...normalized.intent, reference_handles: Object.freeze(handles) }) as OwnerWan26R2vGenerateInput["request"] });
}
function snapshotRecovery(v: unknown): Readonly<OwnerWan26R2vReconcileInput> { const f = exact(v, ["attemptId", "recovery_id"]); return Object.freeze({ attemptId: readAttempt(f.attemptId), recovery_id: readRecoveryId(f.recovery_id) }); }
function snapshotList(v: unknown): Readonly<OwnerWan26R2vRecoveryListInput> { const f = exact(v, ["attemptId"], ["limit"]); return Object.freeze({ attemptId: readAttempt(f.attemptId), limit: bounded(f.limit, 1, 128, 20) }); }
function snapshotPage(v: unknown): Readonly<OwnerWan26R2vResultPageInput> { const f = exact(v, ["attemptId", "recovery_id"], ["offset"]); return Object.freeze({ attemptId: readAttempt(f.attemptId), recovery_id: readRecoveryId(f.recovery_id), offset: bounded(f.offset, 0, MAX_ARTIFACTS, 0) }); }
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try { const p = Object.getPrototypeOf(value), ds = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(ds), allowed = [...required, ...optional];
    if ((p !== Object.prototype && p !== null) || required.some((key) => !Object.hasOwn(ds, key)) ||
        keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in ds[key]!) || !ds[key]!.enumerable)) fail("INVALID_REQUEST");
    const out: Record<string, any> = Object.create(null); for (const key of keys as string[]) out[key] = ds[key]!.value; return out;
  } catch { fail("INVALID_REQUEST"); }
}
function costParameters(request: OwnerWan26R2vPreparedRequest): Readonly<Record<string, string | number | boolean>> {
  const settings = request.settings; return settings.model_type === "wan_26_r2v"
    ? Object.freeze({ resolution: settings.resolution, video_duration: settings.video_duration, duration: settings.duration })
    : Object.freeze({ resolution: settings.resolution, video_duration: settings.video_duration, duration: settings.duration, native_audio: settings.native_audio! });
}
function assertPrivateRequest(value: OwnerWan26R2vPreparedRequest, expected: OwnerWan26R2vGenerateInput["request"],
  candidate: OwnerWan26R2vPreparedCandidate): void {
  const selected = candidate.input_references.filter((reference) => reference.media_type === "selected_video");
  const duration = Math.round(selected.reduce((total, reference) => total + (reference.selected_duration_seconds ?? Number.NaN), 0) * 100) / 100;
  if (!plain(value) || value.prompt !== expected.prompt || !plain(value.settings) || value.settings.model_type !== expected.model_id ||
      value.settings.resolution !== expected.parameters.resolution || value.settings.aspect_ratio !== expected.parameters.aspect_ratio ||
      value.settings.video_duration !== expected.parameters.video_duration || value.settings.seed !== expected.parameters.seed ||
      (expected.model_id === "wan_26_r2v_flash" && value.settings.native_audio !== expected.parameters.native_audio) ||
      (expected.model_id === "wan_26_r2v" && Object.hasOwn(value.settings, "native_audio")) ||
      !Number.isFinite(duration) || value.settings.duration !== duration || !Array.isArray(value.settings.file_urls) ||
      value.settings.file_urls.length < 1 || value.settings.file_urls.length > expected.reference_handles.length || value.settings.file_urls.some((file) => !file ||
        (file.type !== "image" && file.type !== "video") || !isSafeUploadReferenceUrl(file.url))) fail("PRE_DISPATCH_FAILED");
}
function assertPermit(permit: OwnerWan26R2vOneShotPermit, binding: Readonly<OwnerWan26R2vPreparedCandidateBinding>): void {
  if (permit.status !== "nominal" || permit.dispatch_allowed !== false || permit.backend_acceptance !== "UNPROVEN" ||
      permit.source_readiness !== "PARTIAL_SOURCE_EXPLICIT_SETTINGS" || permit.prompt_readiness !== "CURRENT_PROMPT_RULES_NOT_ESTABLISHED" ||
      permit.settings_readiness !== "FULL_CURRENT_SETTINGS_NOT_ESTABLISHED" || permit.model_id !== binding.model_id ||
      permit.profile_schema_hash !== binding.profile_schema_hash || permit.request_fingerprint !== binding.request_fingerprint ||
      permit.intent_fingerprint !== binding.intent_fingerprint || permit.expires_at !== binding.expires_at) fail("PRE_DISPATCH_FAILED");
}
function assertChat(chat: OwnerWan26R2vChatContext, attempt: string, binding: Readonly<OwnerWan26R2vPreparedCandidateBinding>): void {
  if (!chat || chat.status !== "created" || !safeId(chat.chat_uuid) || chat.attempt_id !== attempt || chat.model_id !== binding.model_id ||
      chat.profile_schema_hash !== binding.profile_schema_hash || chat.request_fingerprint !== binding.private_request_fingerprint ||
      chat.intent_fingerprint !== binding.intent_fingerprint || chat.expires_at !== binding.expires_at || chat.dispatch_allowed !== false ||
      chat.backend_acceptance !== "UNPROVEN") fail("PRE_DISPATCH_FAILED");
}
function validAck(value: unknown, chat: string): value is MediaGenerationReceipt { return plain(value) && value.chat_uuid === chat && safeId(value.message_id); }
function validContext(c: OwnerWan26R2vResultContext, r: Recovery): boolean {
  return !!c && c.chat_uuid === r.chat.chat_uuid && c.attempt_id === r.attemptId && c.model_id === r.modelId &&
    c.request_fingerprint === r.binding.private_request_fingerprint && c.intent_fingerprint === r.binding.intent_fingerprint &&
    c.owner_echo_message_id === r.ack && safeId(c.message_id) && /^\d{1,16}$/u.test(c.provider_chat_id) &&
    Array.isArray(c.message_object_ids) && c.message_object_ids.length > 0 && c.message_object_ids.length <= 64 &&
    c.message_object_ids.every(safeId) && new Set(c.message_object_ids).size === c.message_object_ids.length;
}
function validReady(v: OwnerWan26R2vReadyVideo, c: OwnerWan26R2vResultContext, r: Recovery): boolean {
  return !!v && Number.isSafeInteger(v.object_index) && v.object_index >= 0 && v.object_index < c.message_object_ids.length &&
    c.message_object_ids[v.object_index] === v.message_object_id && v.object_type === "video" && isSafeUploadReferenceUrl(v.object_url) &&
    safeVideoUrl(v.object_url) && (v.mime_type === null || v.mime_type === "video/mp4" || v.mime_type === "video/webm") && c.model_id === r.modelId;
}
function safeVideoUrl(value: string): boolean { try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password && /\.(?:mp4|webm)$/iu.test(u.pathname); } catch { return false; } }
function validAccount(v: AccountStatusResult, now: number): boolean {
  if (!plain(v) || !plain(v.balance) || v.balance.unit !== "tokens" || !(v.balance.available === null ||
      (typeof v.balance.available === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(v.balance.available))) || !plain(v.subscription) ||
      v.subscription.active !== true || typeof v.subscription.end_date !== "string" ||
      !["DATE_ONLY", "LOCAL_DATETIME", "OFFSET_DATETIME"].includes(String(v.subscription.end_date_kind)) ||
      v.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || v.source_build !== ACCOUNT_SOURCE_BUILD || !freshAt(v.observed_at, now)) return false;
  const expiration = Date.parse(v.subscription.end_date); return Number.isFinite(expiration) && expiration > now;
}
function validAccess(v: ModelAccessResult, catalog: DiscoveryCatalogRepository, id: OwnerWan26R2vGenerationModelId, now: number,
  cost: Readonly<Record<string, string | number | boolean>>): boolean {
  try { const model = catalog.getModel(id), keys = Object.keys(cost).sort();
    return v.catalog_kind === "OFFICIAL_PUBLIC_API_SNAPSHOT" && v.catalog_version === `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}` &&
      v.model_id === id && v.ai_name === MODEL_NAME && v.model_type === model.upstream_id && v.account_read_live === true && v.access === true &&
      v.parameters_redacted === true && Array.isArray(v.parameter_keys) && schemaHash([...v.parameter_keys].sort()) === schemaHash(keys) &&
      (v.cost === null || finite(v.cost)) && (v.discount_cost === null || finite(v.discount_cost)) &&
      (finite(v.cost) || finite(v.discount_cost)) && freshAt(v.observed_at, now);
  } catch { return false; }
}
function freshAt(v: unknown, now: number): boolean { const at = typeof v === "string" ? Date.parse(v) : NaN; return Number.isFinite(at) && Math.abs(now - at) <= ACCOUNT_FRESHNESS_MS; }
function mapHistoryGap(v: string): OwnerWan26R2vGenerationDiagnosticCode {
  if (v === "OWNER_ACK_MISSING") return "OWNER_ACK_MISSING"; if (v === "OWNER_ACK_AMBIGUOUS") return "OWNER_ACK_AMBIGUOUS";
  if (v === "OWNER_ACK_MISMATCH") return "OWNER_ACK_MISMATCH"; if (v === "BOT_ERROR_OBSERVED") return "BACKEND_ERROR_OBSERVED";
  if (v === "HISTORY_INCOMPLETE") return "HISTORY_INCOMPLETE"; return "HISTORY_UNVERIFIED";
}
function mapResultGap(v: string): OwnerWan26R2vGenerationDiagnosticCode {
  if (v === "RESULT_URL_PENDING" || v === "OBJECT_NOT_COMPLETED" || v === "RESULT_COMPLETION_FLAG_INVALID") return "RESULT_PENDING";
  if (v === "MODEL_ECHO_MISMATCH") return "RESULT_MODEL_ECHO_MISMATCH"; if (v === "MODEL_ECHO_UNAVAILABLE") return "RESULT_MODEL_ECHO_UNAVAILABLE";
  if (v === "RESULT_URL_UNSAFE") return "RESULT_URL_UNSAFE"; return "RESULT_UNVERIFIED";
}
function newDiagnostic(): DiagnosticState { return { post_started: false, ack_known: false, history_status: "NOT_READ", owner_ack_status: "NOT_READ",
  history_get_calls: 0, result_get_calls: 0, backend_error_observed: false, start_error_class: null, pending_object_indices: [], gaps: [] }; }
function diagnostic(r: Recovery): Readonly<OwnerWan26R2vGenerationDiagnostic> { return Object.freeze({ ...r.diagnostic,
  pending_object_indices: Object.freeze([...r.diagnostic.pending_object_indices]), gaps: Object.freeze([...r.diagnostic.gaps]) }); }
function addGap(r: Recovery, code: OwnerWan26R2vGenerationDiagnosticCode): void { if (!r.diagnostic.gaps.includes(code) && r.diagnostic.gaps.length < 32) r.diagnostic.gaps.push(code); }
function canonicalStartErrorClass(value: unknown): SyntxHttpErrorCode | null {
  return typeof value === "string" && SAFE_START_ERROR_CLASSES.has(value as SyntxHttpErrorCode)
    ? value as SyntxHttpErrorCode : null;
}
function page(r: Recovery, offset: number): OwnerWan26R2vGenerationResult {
  const order = new Map(r.contexts.map((c, i) => [c.message_id, i] as const));
  const all = [...r.artifacts.values()].sort((a, b) => (order.get(a.message_id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.message_id) ?? Number.MAX_SAFE_INTEGER) || a.object_index - b.object_index);
  const artifacts = all.slice(offset, offset + PAGE_SIZE), next = offset + artifacts.length, more = next < all.length;
  return Object.freeze({ status: "completed", status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", provider_terminal_status: "UNPROVEN",
    backend_acceptance: "UNPROVEN", cost_cap_enforced: false, model_id: r.modelId, recovery_id: r.id, observed_artifact_count: all.length,
    source_binding: Object.freeze({ public_catalog_version: CATALOG_VERSION, profile_schema_hash: r.binding.profile_schema_hash,
      request_fingerprint: r.binding.request_fingerprint, intent_fingerprint: r.binding.intent_fingerprint, source_readiness: "PARTIAL_SOURCE_EXPLICIT_SETTINGS" }),
    offset, page_size: PAGE_SIZE, artifacts: Object.freeze(artifacts), has_more: more, next_offset: more ? next : null, diagnostic: diagnostic(r) });
}
function recoveryUnknown(r: Recovery): OwnerWan26R2vGenerationServiceError { return new OwnerWan26R2vGenerationServiceError("OUTCOME_UNKNOWN", r.id, diagnostic(r)); }
function claimKey(principal: Readonly<GenerationPrincipalRef>, intent: string): string { return schemaHash([principal.tenant_id, principal.subject_id, intent]); }
function readAttempt(v: unknown): string { if (typeof v !== "string" || !ATTEMPT.test(v)) fail("INVALID_REQUEST"); return v; }
function readRecoveryId(v: unknown): string { if (typeof v !== "string" || !RECOVERY_ID.test(v)) fail("INVALID_REQUEST"); return v; }
function safeId(v: unknown): v is string { return typeof v === "string" && SAFE_ID.test(v); }
function finite(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v) && v >= 0; }
function plain(v: unknown): v is Record<string, any> { if (!v || typeof v !== "object" || Array.isArray(v) || types.isProxy(v)) return false; try { const p = Object.getPrototypeOf(v); return p === Object.prototype || p === null; } catch { return false; } }
function nativeClient(v: unknown): SyntxChatHttpClient {
  if (!v || typeof v !== "object" || types.isProxy(v) || Object.getPrototypeOf(v) !== SyntxChatHttpClient.prototype ||
      ["createOwnerWan26R2vChat", "startOwnerWan26R2vWithOwnedCandidate", "listOwnedWan26R2vCandidates", "getOwnedWan26R2vResult"].some((k) => Object.hasOwn(v, k)) ||
      SyntxChatHttpClient.prototype.createOwnerWan26R2vChat !== CHAT_CREATE || SyntxChatHttpClient.prototype.startOwnerWan26R2vWithOwnedCandidate !== CHAT_START ||
      SyntxChatHttpClient.prototype.listOwnedWan26R2vCandidates !== HISTORY_LIST || SyntxChatHttpClient.prototype.getOwnedWan26R2vResult !== RESULT_GET ||
      Reflect.get(v, "createOwnerWan26R2vChat") !== CHAT_CREATE || Reflect.get(v, "startOwnerWan26R2vWithOwnedCandidate") !== CHAT_START ||
      Reflect.get(v, "listOwnedWan26R2vCandidates") !== HISTORY_LIST || Reflect.get(v, "getOwnedWan26R2vResult") !== RESULT_GET) fail("MODEL_BINDING_MISMATCH");
  return v as SyntxChatHttpClient;
}
function isLinkService(v: unknown): v is PerUserLinkService { return exactInstance(v, PerUserLinkService, "getStatus", LINK_STATUS); }
function exactReferenceService(v: unknown): v is OwnerWan26R2vReferenceService {
  try { return !!v && typeof v === "object" && !types.isProxy(v) && Object.getPrototypeOf(v) === OwnerWan26R2vReferenceService.prototype &&
    v instanceof OwnerWan26R2vReferenceService; } catch { return false; }
}
function exactInstance<T extends object, K extends keyof T>(v: unknown, ctor: new (...args: any[]) => T, method: K, native: unknown): v is T {
  try { return !!v && typeof v === "object" && !types.isProxy(v) && v instanceof ctor && Object.getPrototypeOf(v) === ctor.prototype &&
    !Object.hasOwn(v, method) && Reflect.get(v, method) === native; } catch { return false; }
}
function snapshotBinding(v: unknown): Readonly<AuthBinding> { const o = exact(v, ["tenant_id", "subject"]);
  if (typeof o.tenant_id !== "string" || !o.tenant_id.trim() || typeof o.subject !== "string" || !o.subject.trim()) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: o.tenant_id, subject: o.subject }); }
function validateSignal(v?: AbortSignal): void { if (v !== undefined && (!v || types.isProxy(v) || !(v instanceof AbortSignal))) fail("INVALID_REQUEST"); }
function bounded(v: unknown, min: number, max: number, fallback: number): number { if (v === undefined) return fallback;
  if (!Number.isSafeInteger(v) || (v as number) < min || (v as number) > max) fail("INVALID_REQUEST"); return v as number; }
function fail(code: OwnerWan26R2vGenerationServiceErrorCode): never { throw new OwnerWan26R2vGenerationServiceError(code); }
