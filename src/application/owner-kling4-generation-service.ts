import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import type { SyntxSubscription } from "../adapter/syntx/account-decoder.js";
import type { SyntxCostParameter } from "../adapter/syntx/http-client.js";
import { readOwnerKling4NativeDispatchStatus } from "../adapter/syntx/owner-kling4-native-context.js";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { AccountStatusService, type AccountStatusResult } from "./account-status.js";
import { ModelAccessService, type ModelAccessResult } from "./model-access.js";
import { createOwnerKling4BudgetedModelAccessResolver } from "./owner-kling4-budget-preflight.js";
import { isOwnerKling4ReferenceService, OwnerKling4ReferenceService } from "./owner-kling4-reference-service.js";
import {
  isOwnerKling4RequestPreparer, isOwnerKling4PreparedCandidate, OwnerKling4RequestPreparer,
  type OwnerKling4CandidateBinding, type OwnerKling4PreparedCandidate
} from "./owner-kling4-request-preparer.js";
import {
  createOwnerKling4OneShotPermit, revalidateOwnerKling4OneShotPermit, type OwnerKling4OneShotPermit,
  OwnerKling4OneShotPolicyError
} from "./owner-kling4-one-shot-policy.js";
import { getOwnerKling4SourceProfile, normalizeOwnerKling4Parameters, type OwnerKling4ParametersModelId } from "./owner-kling4-parameters.js";

const MODEL_IDS = Object.freeze(["kling_4_keyframes", "kling_4_omni"] as const);
const AI_NAME = "kling" as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY = /^kling4_recovery_[0-9a-f-]{36}$/u;
const RECOVERY_LIMIT = 128;
const RUN_LIMIT = 4;
const PAGE_SIZE = 64;
const MAX_RESULTS = 4096;
const REQUEST_TIMEOUT_MS = 120_000;
const MODEL_CREATE = SyntxChatHttpClient.prototype.createOwnerKling4Chat;
const MODEL_START = SyntxChatHttpClient.prototype.startOwnerKling4WithOwnedCandidate;
const MODEL_LIST = SyntxChatHttpClient.prototype.listOwnedKling4Candidates;
const MODEL_GET = SyntxChatHttpClient.prototype.getOwnedKling4Result;
const CHAT_CREATE = SyntxChatHttpClient.prototype.createChat;
const ACCOUNT_GET = AccountStatusService.prototype.getAccountStatus;
const ACCESS_GET = ModelAccessService.prototype.getModelAccess;
const LINK_STATUS = PerUserLinkService.prototype.getStatus;
const PREPARER_BOUND = OwnerKling4RequestPreparer.prototype.isBoundToReferenceService;
const PREPARER_PREPARE = OwnerKling4RequestPreparer.prototype.prepare;
const PREPARER_INSPECT = OwnerKling4RequestPreparer.prototype.inspectCandidate;
const PREPARER_REVALIDATE = OwnerKling4RequestPreparer.prototype.revalidateCandidate;
const PREPARER_INVALIDATE = OwnerKling4RequestPreparer.prototype.invalidateAttempt;
const SERVICES = new WeakSet<object>();

export type OwnerKling4GenerationPhase = "VALIDATE_REQUEST" | "PREFLIGHT_ONE" | "CHAT_CREATE" | "PREFLIGHT_TWO" |
  "GENERATION_POST" | "POST_ACK_KNOWN" | "HISTORY_GET" | "RESULT_GET";
export interface OwnerKling4GenerationDiagnostic {
  readonly phase: OwnerKling4GenerationPhase; readonly post_started: boolean; readonly ack_known: boolean;
  readonly history_status: "NOT_READ" | "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "NOT_READ" | "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  readonly request_echo_status: "NOT_READ" | "MATCHED" | "ABSENT" | "PARTIAL_UNPROVEN" | "CONTRADICTORY";
  readonly history_get_calls: number; readonly result_get_calls: number;
  readonly result_status: "NOT_READ" | "COMPLETE" | "UNVERIFIED"; readonly gaps: readonly string[];
}
export interface OwnerKling4GenerationArtifact {
  readonly object_index: number; readonly message_object_id: string; readonly object_type: "video"; readonly object_url: string;
  readonly mime_type: "video/mp4" | "video/quicktime" | null; readonly mime_source: "URL_EXTENSION" | "UNKNOWN";
  readonly message_id: string; readonly chat_uuid: string; readonly model_id: OwnerKling4ParametersModelId;
}
export interface OwnerKling4GenerationResult {
  readonly status: "completed"; readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY"; readonly backend_acceptance: "UNPROVEN";
  readonly provider_terminal_status: "UNPROVEN"; readonly cost_cap_enforced: false; readonly output_count: "UNKNOWN";
  readonly recovery_id: string; readonly model_id: OwnerKling4ParametersModelId;
  readonly source_binding: Readonly<{ public_catalog_version: string; profile_sha256: string; request_fingerprint: string; intent_fingerprint: string }>;
  readonly observed_artifact_count: number; readonly offset: number; readonly page_size: typeof PAGE_SIZE;
  readonly artifacts: readonly OwnerKling4GenerationArtifact[]; readonly has_more: boolean; readonly next_offset: number | null;
  readonly diagnostic: OwnerKling4GenerationDiagnostic;
}
export interface OwnerKling4RecoveryListItem {
  readonly recovery_id: string; readonly created_at: string; readonly model_id: OwnerKling4ParametersModelId;
  readonly status: "outcome_unknown" | "completed"; readonly observed_artifact_count: number; readonly diagnostic: OwnerKling4GenerationDiagnostic;
}
export interface OwnerKling4GenerationServiceOptions {
  readonly binding: AuthBinding; readonly linkService: PerUserLinkService; readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string; readonly preparer: OwnerKling4RequestPreparer; readonly referenceService: OwnerKling4ReferenceService;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly createAccountStatusService: (attemptId: string) => AccountStatusService;
  readonly createModelAccessService: (attemptId: string) => ModelAccessService;
  readonly resolveSubscription: (attemptId: string, signal?: AbortSignal) => Promise<SyntxSubscription>;
  readonly now?: () => number;
}
export interface OwnerKling4GenerateInput {
  readonly attemptId: string; readonly model_id: OwnerKling4ParametersModelId; readonly prompt: string; readonly version: "4.0";
  readonly mode: "standart" | "hd"; readonly aspect_ratio: "16:9" | "1:1" | "9:16" | "21:9";
  readonly video_duration: number; readonly native_audio: boolean; readonly reference_handles: readonly string[];
}
export interface OwnerKling4ReconcileInput { readonly attemptId: string; readonly recovery_id: string; }
export interface OwnerKling4RecoveryListInput { readonly attemptId: string; readonly limit?: number; }
export interface OwnerKling4ResultPageInput { readonly attemptId: string; readonly recovery_id: string; readonly offset?: number; }
export type OwnerKling4GenerationErrorCode = "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED" |
  "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH" | "PREFLIGHT_FAILED" | "SUBSCRIPTION_REQUIRED" |
  "SUBSCRIPTION_STATUS_UNVERIFIED" | "INTENT_ALREADY_CLAIMED" | "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND";
export class OwnerKling4GenerationServiceError extends Error {
  readonly diagnostic?: OwnerKling4GenerationDiagnostic;
  constructor(readonly code: OwnerKling4GenerationErrorCode, readonly recovery_id?: string, diagnostic?: OwnerKling4GenerationDiagnostic) {
    super(code === "OUTCOME_UNKNOWN" ? "The owner Kling 4 request may have been dispatched; use GET-only reconciliation and do not retry."
      : "The owner Kling 4 generation could not be completed safely.");
    this.name = "OwnerKling4GenerationServiceError";
    if (code === "OUTCOME_UNKNOWN" && diagnostic) this.diagnostic = diagnostic;
  }
}

type NativeChat = Readonly<{ status: "created"; chat_uuid: string; attempt_id: string; model_id: OwnerKling4ParametersModelId;
  profile_sha256: string; request_fingerprint: string; intent_fingerprint: string; sources: OwnerKling4CandidateBinding["sources"];
  dispatch_allowed: false; backend_acceptance: "UNPROVEN" }>;
type NativeHistory = Readonly<{ status: "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED"; owner_ack_status: "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  request_echo_status: OwnerKling4GenerationDiagnostic["request_echo_status"]; history_binding_status: "BOUND" | "UNVERIFIED";
  history_page_status: "NOT_READ" | "COMPLETE" | "INCOMPLETE" | "UNPROVEN"; history_get_calls: number;
  owner_echo_message_id: string | null; contexts: readonly NativeResultContext[]; gaps: readonly string[] }>;
type NativeResultContext = Readonly<{ chat_uuid: string; message_id: string; model_id: OwnerKling4ParametersModelId; provider_chat_id: string;
  message_object_ids: readonly string[]; attempt_id: string; profile_sha256: string; request_fingerprint: string; intent_fingerprint: string;
  owner_echo_message_id: string }>;
type NativeResult = Readonly<{ message_binding: "BOUND" | "UNVERIFIED"; model_echo: "MATCHED" | "UNKNOWN" | "MISMATCH";
  provider_terminal_status: "UNPROVEN"; artifacts: readonly Omit<OwnerKling4GenerationArtifact, "message_id" | "chat_uuid" | "model_id">[]; gaps: readonly string[] }>;
interface Run { readonly attemptId: string; readonly controller: AbortController; promise: Promise<unknown>; }
interface Recovery {
  readonly recovery_id: string; readonly attemptId: string; readonly intentKey: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly created_at: string; readonly model_id: OwnerKling4ParametersModelId; readonly candidate: OwnerKling4PreparedCandidate;
  readonly permit: OwnerKling4OneShotPermit; readonly chat: NativeChat; readonly client: SyntxChatHttpClient;
  readonly binding: Readonly<OwnerKling4CandidateBinding>; readonly epoch: number; owner_echo_message_id: string | null;
  status: "outcome_unknown" | "completed"; readonly artifacts: Map<string, OwnerKling4GenerationArtifact>; readonly objectUrls: Map<string, string>;
  d: { phase: OwnerKling4GenerationPhase; post_started: boolean; ack_known: boolean; history_status: OwnerKling4GenerationDiagnostic["history_status"];
    owner_ack_status: OwnerKling4GenerationDiagnostic["owner_ack_status"]; request_echo_status: OwnerKling4GenerationDiagnostic["request_echo_status"];
    history_get_calls: number; result_get_calls: number; result_status: OwnerKling4GenerationDiagnostic["result_status"]; gaps: string[] };
}

/** Two live paid-plan/quote/balance gates, one native GEN attempt, then GET-only recovery. */
export class OwnerKling4GenerationService {
  readonly #binding: Readonly<AuthBinding>; readonly #links: PerUserLinkService; readonly #catalog: DiscoveryCatalogRepository;
  readonly #catalogVersion: string; readonly #preparer: OwnerKling4RequestPreparer; readonly #referenceService: OwnerKling4ReferenceService;
  readonly #resolveClient: OwnerKling4GenerationServiceOptions["resolveChatClient"];
  readonly #createAccount: OwnerKling4GenerationServiceOptions["createAccountStatusService"];
  readonly #createAccess: OwnerKling4GenerationServiceOptions["createModelAccessService"];
  readonly #resolveSubscription: OwnerKling4GenerationServiceOptions["resolveSubscription"]; readonly #now: () => number;
  readonly #recoveries = new Map<string, Recovery>(); readonly #reserved = new Set<string>(); readonly #claimed = new Set<string>();
  readonly #runs = new Set<Run>(); readonly #clients = new Map<string, SyntxChatHttpClient>(); readonly #usedAccounts = new WeakSet<object>();
  readonly #usedAccess = new WeakSet<object>(); readonly #epochs = new Map<string, number>(); readonly #invalidating = new Set<string>();
  readonly #invalidations = new Map<string, Promise<void>>(); #closed = false; #closing: Promise<void> | undefined; #lastNow = -1;

  constructor(optionsInput: OwnerKling4GenerationServiceOptions | unknown) {
    const o = exact(optionsInput, ["binding", "linkService", "catalog", "catalog_version", "preparer", "referenceService", "resolveChatClient",
      "createAccountStatusService", "createModelAccessService", "resolveSubscription"], ["now"]);
    if (!genuineLinks(o.linkService) || !(o.catalog instanceof DiscoveryCatalogRepository) || types.isProxy(o.catalog) ||
        !isOwnerKling4ReferenceService(o.referenceService) || !isOwnerKling4RequestPreparer(o.preparer) ||
        !Reflect.apply(PREPARER_BOUND, o.preparer as OwnerKling4RequestPreparer, [o.referenceService]) ||
        typeof o.resolveChatClient !== "function" || types.isProxy(o.resolveChatClient) ||
        typeof o.createAccountStatusService !== "function" || types.isProxy(o.createAccountStatusService) ||
        typeof o.createModelAccessService !== "function" || types.isProxy(o.createModelAccessService) ||
        typeof o.resolveSubscription !== "function" || types.isProxy(o.resolveSubscription) ||
        (o.now !== undefined && (typeof o.now !== "function" || types.isProxy(o.now)))) invalid();
    this.#binding = snapshotBinding(o.binding); this.#links = o.linkService as PerUserLinkService;
    this.#catalog = o.catalog as DiscoveryCatalogRepository; this.#catalogVersion = o.catalog_version as string;
    this.#preparer = o.preparer as OwnerKling4RequestPreparer; this.#referenceService = o.referenceService as OwnerKling4ReferenceService;
    this.#resolveClient = o.resolveChatClient as OwnerKling4GenerationServiceOptions["resolveChatClient"];
    this.#createAccount = o.createAccountStatusService as OwnerKling4GenerationServiceOptions["createAccountStatusService"];
    this.#createAccess = o.createModelAccessService as OwnerKling4GenerationServiceOptions["createModelAccessService"];
    this.#resolveSubscription = o.resolveSubscription as OwnerKling4GenerationServiceOptions["resolveSubscription"];
    this.#now = o.now === undefined ? Date.now : readClock(o.now); this.#assertModel(); SERVICES.add(this); Object.freeze(this);
  }

  generate(value: OwnerKling4GenerateInput | unknown, signalInput?: AbortSignal): Promise<OwnerKling4GenerationResult> {
    this.#assertOpen(); const request = snapshotGenerate(value), signal = exactSignal(signalInput);
    if (this.#invalidating.has(request.attemptId)) return Promise.reject(err("PRINCIPAL_NOT_LINKED"));
    return this.#run(request.attemptId, signal, (runSignal, epoch) => this.#generate(request, runSignal, epoch));
  }
  reconcile(value: OwnerKling4ReconcileInput | unknown, signalInput?: AbortSignal): Promise<OwnerKling4GenerationResult> {
    this.#assertOpen(); const request = snapshotRecovery(value), signal = exactSignal(signalInput);
    if (this.#invalidating.has(request.attemptId)) return Promise.reject(err("RECOVERY_NOT_FOUND"));
    return this.#run(request.attemptId, signal, async (runSignal, epoch) => {
      const principal = await this.#principal(request.attemptId, runSignal), recovery = this.#owned(request.attemptId, request.recovery_id, principal);
      if (recovery.epoch !== epoch) fail("RECOVERY_NOT_FOUND");
      await this.#checkCurrent(request.attemptId, recovery.principal, recovery.client, runSignal, epoch);
      if (recovery.status === "completed") return page(recovery, 0);
      const deadline = new AbsoluteRequestDeadline(REQUEST_TIMEOUT_MS, runSignal, () => unknown(recovery));
      try { await this.#checkCurrent(request.attemptId, recovery.principal, recovery.client, deadline.signal, epoch); return await this.#observe(recovery, deadline); }
      catch (e) { if (e instanceof OwnerKling4GenerationServiceError && e.code === "RECOVERY_NOT_FOUND") throw e; throw unknown(recovery); }
      finally { deadline.close(); }
    });
  }
  listRecoveries(value: OwnerKling4RecoveryListInput | unknown): Promise<readonly OwnerKling4RecoveryListItem[]> {
    this.#assertOpen(); const req = snapshotList(value);
    if (this.#invalidating.has(req.attemptId)) return Promise.reject(err("PRINCIPAL_NOT_LINKED"));
    return this.#run(req.attemptId, undefined, async (signal, epoch) => {
      const principal = await this.#principal(req.attemptId, signal), client = this.#client(req.attemptId);
      await this.#checkCurrent(req.attemptId, principal, client, signal, epoch);
      return Object.freeze([...this.#recoveries.values()].filter(r => r.attemptId === req.attemptId && r.epoch === epoch &&
        sameGenerationPrincipal(r.principal, principal) && r.client === client).slice(0, req.limit).map(recoveryItem));
    });
  }
  getResultPage(value: OwnerKling4ResultPageInput | unknown): Promise<OwnerKling4GenerationResult> {
    this.#assertOpen(); const req = snapshotPage(value);
    if (this.#invalidating.has(req.attemptId)) return Promise.reject(err("RECOVERY_NOT_FOUND"));
    return this.#run(req.attemptId, undefined, async (signal, epoch) => {
      const principal = await this.#principal(req.attemptId, signal), recovery = this.#owned(req.attemptId, req.recovery_id, principal);
      if (recovery.epoch !== epoch) fail("RECOVERY_NOT_FOUND");
      await this.#checkCurrent(req.attemptId, recovery.principal, recovery.client, signal, epoch);
      if (recovery.status !== "completed") throw unknown(recovery);
      if (req.offset > recovery.artifacts.size) fail("INVALID_REQUEST");
      return page(recovery, req.offset);
    });
  }
  invalidateAttempt(value: unknown): Promise<void> {
    if (this.#closed || !SERVICES.has(this)) return Promise.reject(err("SERVICE_CLOSED"));
    const attempt = readAttempt(value), previous = this.#invalidations.get(attempt); if (previous) return previous;
    if (this.#invalidations.size >= 128) return Promise.reject(err("CAPACITY_EXCEEDED"));
    this.#invalidating.add(attempt); this.#epochs.set(attempt, (this.#epochs.get(attempt) ?? 0) + 1);
    const runs = [...this.#runs].filter(r => r.attemptId === attempt); for (const run of runs) run.controller.abort();
    let dep: Promise<void>; try { dep = Promise.resolve(Reflect.apply(PREPARER_INVALIDATE, this.#preparer, [attempt])); }
    catch (e) { dep = Promise.reject(e); }
    const pending = Promise.allSettled([dep, ...runs.map(r => r.promise)]).then(results => {
      this.#invalidating.delete(attempt); this.#invalidations.delete(attempt); this.#clients.delete(attempt); this.#epochs.delete(attempt);
      for (const [id, recovery] of this.#recoveries) if (recovery.attemptId === attempt) this.#recoveries.delete(id);
      if (results[0]?.status === "rejected") throw err("SERVICE_BUSY");
    }); this.#invalidations.set(attempt, pending); return pending;
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing; this.#closed = true;
    const attempts = new Set([...this.#runs].map(r => r.attemptId));
    for (const attempt of attempts) { this.#invalidating.add(attempt); this.#epochs.set(attempt, (this.#epochs.get(attempt) ?? 0) + 1); }
    for (const run of this.#runs) run.controller.abort();
    const deps = [...attempts].map(attempt => { try { return Promise.resolve(Reflect.apply(PREPARER_INVALIDATE, this.#preparer, [attempt])); } catch { return Promise.resolve(); } });
    this.#closing = Promise.allSettled([...deps, ...this.#invalidations.values(), ...[...this.#runs].map(r => r.promise)]).then(() => {
      this.#recoveries.clear(); this.#reserved.clear(); this.#claimed.clear(); this.#runs.clear(); this.#clients.clear();
      this.#epochs.clear(); this.#invalidating.clear(); this.#invalidations.clear();
    }); return this.#closing;
  }

  async #generate(req: OwnerKling4GenerateInput, signal: AbortSignal, epoch: number): Promise<OwnerKling4GenerationResult> {
    const deadline = new AbsoluteRequestDeadline(REQUEST_TIMEOUT_MS, signal, () => err("PRE_DISPATCH_FAILED"));
    let candidate: OwnerKling4PreparedCandidate | undefined, permit: OwnerKling4OneShotPermit | undefined;
    let binding: Readonly<OwnerKling4CandidateBinding> | undefined, principal: Readonly<GenerationPrincipalRef> | undefined;
    let client: SyntxChatHttpClient | undefined, intentKey: string | undefined, reserved = false, recovery: Recovery | undefined, postStarted = false;
    const release = () => { if (intentKey && reserved) { this.#reserved.delete(intentKey); reserved = false; } };
    try {
      deadline.throwIfAborted(); this.#assertModel(); principal = await this.#principal(req.attemptId, deadline.signal);
      client = this.#client(req.attemptId); await this.#checkCurrent(req.attemptId, principal, client, deadline.signal, epoch);
      candidate = await this.#await(deadline, () => Reflect.apply(PREPARER_PREPARE, this.#preparer, [req, deadline.signal]) as Promise<OwnerKling4PreparedCandidate>);
      await this.#checkCurrent(req.attemptId, principal, client, deadline.signal, epoch);
      binding = this.#candidateBinding(candidate, req, principal); intentKey = semanticIntentKey(principal, binding.intent_fingerprint);
      if (this.#claimed.has(intentKey) || this.#reserved.has(intentKey)) fail("INTENT_ALREADY_CLAIMED");
      if (this.#recoveries.size + this.#reserved.size >= RECOVERY_LIMIT) fail("CAPACITY_EXCEEDED");
      this.#reserved.add(intentKey); reserved = true;
      if (this.#claimed.size >= 8192) fail("CAPACITY_EXCEEDED");
      permit = await createOwnerKling4OneShotPermit({ preparer: this.#preparer, candidate, principal, attemptId: req.attemptId });
      await this.#checkCurrent(req.attemptId, principal, client, deadline.signal, epoch);
      await this.#preflight(req, principal, client, candidate, binding, deadline, epoch);
      await this.#checkCandidate(req, principal, client, candidate, binding, permit, deadline.signal, epoch);
      const nativeInput = nativeInputFor(this.#preparer, this.#referenceService, candidate, permit, principal, req.attemptId, this.#links, this.#binding);
      let chat: NativeChat;
      try { chat = await this.#await(deadline, () => Reflect.apply(MODEL_CREATE, client!, [nativeInput, deadline.signal]) as Promise<NativeChat>); }
      catch { fail("PRE_DISPATCH_FAILED"); }
      await this.#checkCurrent(req.attemptId, principal, client, deadline.signal, epoch); this.#assertChat(chat!, req, binding);
      await this.#preflight(req, principal, client, candidate, binding, deadline, epoch);
      await this.#checkCandidate(req, principal, client, candidate, binding, permit, deadline.signal, epoch);
      const current = Reflect.apply(PREPARER_INSPECT, this.#preparer, [candidate]) as OwnerKling4CandidateBinding | undefined;
      if (!current || schemaHash(current) !== schemaHash(binding)) fail("PRE_DISPATCH_FAILED");
      if (this.#recoveries.size >= RECOVERY_LIMIT) fail("CAPACITY_EXCEEDED");
      recovery = this.#newRecovery(req.attemptId, principal, intentKey, req.model_id, candidate, permit, chat!, client, binding, epoch);
      this.#recoveries.set(recovery.recovery_id, recovery); recovery.d.phase = "GENERATION_POST"; recovery.d.post_started = true; postStarted = true;
      let ack: Readonly<{ chat_uuid: string; message_id: string }>;
      try { ack = await this.#await(deadline, () => Reflect.apply(MODEL_START, client!, [Object.freeze({ ...nativeInput, chat: chat! }), deadline.signal]) as Promise<Readonly<{ chat_uuid: string; message_id: string }>>); }
      catch {
        const dispatch = readOwnerKling4NativeDispatchStatus(client, chat!);
        if (dispatch && !dispatch.dispatch_attempted) { this.#recoveries.delete(recovery.recovery_id); recovery = undefined; postStarted = false; release(); fail("PRE_DISPATCH_FAILED"); }
        this.#claimed.add(intentKey); release(); throw unknown(recovery);
      }
      const dispatch = readOwnerKling4NativeDispatchStatus(client, chat!);
      if (!ack || ack.chat_uuid !== chat!.chat_uuid || !safeId(ack.message_id) || !dispatch?.dispatch_attempted || !dispatch.owner_ack_bound ||
          dispatch.owner_echo_message_id !== ack.message_id || dispatch.chat_uuid !== chat!.chat_uuid || dispatch.attempt_id !== req.attemptId ||
          dispatch.model_id !== req.model_id) {
        if (dispatch && !dispatch.dispatch_attempted) { this.#recoveries.delete(recovery.recovery_id); recovery = undefined; postStarted = false; release(); fail("PRE_DISPATCH_FAILED"); }
        this.#claimed.add(intentKey); release(); throw unknown(recovery);
      }
      this.#claimed.add(intentKey); release(); await this.#checkCurrent(req.attemptId, principal, client, deadline.signal, epoch);
      recovery.owner_echo_message_id = ack.message_id; recovery.d.ack_known = true; recovery.d.owner_ack_status = "MATCHED"; recovery.d.phase = "POST_ACK_KNOWN";
      return await this.#observe(recovery, deadline);
    } catch (error) {
      if (postStarted && recovery) {
        const dispatch = client && recovery.chat ? readOwnerKling4NativeDispatchStatus(client, recovery.chat) : null;
        if (!dispatch || dispatch.dispatch_attempted) {
          if (intentKey) this.#claimed.add(intentKey); release();
          if (dispatch?.owner_ack_bound && dispatch.owner_echo_message_id) {
            recovery.owner_echo_message_id = dispatch.owner_echo_message_id; recovery.d.ack_known = true;
            recovery.d.owner_ack_status = "MATCHED"; recovery.d.phase = "POST_ACK_KNOWN";
          }
          throw unknown(recovery);
        }
        this.#recoveries.delete(recovery.recovery_id);
      }
      release(); if (error instanceof OwnerKling4GenerationServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      if (error instanceof OwnerKling4OneShotPolicyError && error.code === "INTENT_ALREADY_CLAIMED") fail("INTENT_ALREADY_CLAIMED");
      return fail("PRE_DISPATCH_FAILED");
    } finally { release(); deadline.close(); }
  }

  async #preflight(req: OwnerKling4GenerateInput, principal: Readonly<GenerationPrincipalRef>, client: SyntxChatHttpClient,
    candidate: OwnerKling4PreparedCandidate, binding: Readonly<OwnerKling4CandidateBinding>, deadline: AbsoluteRequestDeadline, epoch: number): Promise<void> {
    deadline.throwIfAborted(); const current = Reflect.apply(PREPARER_INSPECT, this.#preparer, [candidate]) as OwnerKling4CandidateBinding | undefined;
    if (!current || schemaHash(current) !== schemaHash(binding) || binding.attempt_id !== req.attemptId || binding.model_id !== req.model_id ||
        binding.profile_sha256 !== getOwnerKling4SourceProfile(req.model_id).source_sha256 || !sameGenerationPrincipal(binding.principal, principal) ||
        binding.expires_at <= this.#readNow() || (this.#epochs.get(req.attemptId) ?? 0) !== epoch) fail("PREFLIGHT_FAILED");
    this.#assertModel(); this.#assertCatalogModel(req.model_id);
    let sub: Readonly<SyntxSubscription>;
    try {
      await this.#checkCurrent(req.attemptId, principal, client, deadline.signal, epoch);
      const raw = await this.#await(deadline, () => Reflect.apply(this.#resolveSubscription, undefined, [req.attemptId, deadline.signal]) as Promise<SyntxSubscription>);
      await this.#checkCurrent(req.attemptId, principal, client, deadline.signal, epoch); sub = snapshotSubscription(raw);
    } catch { fail("SUBSCRIPTION_STATUS_UNVERIFIED"); }
    if (sub!.active === false || (sub!.plan_type !== null && sub!.plan_type.trim().toUpperCase() === "FREE")) fail("SUBSCRIPTION_REQUIRED");
    if (sub!.active !== true || typeof sub!.plan_type !== "string" || !sub!.plan_type.trim()) fail("SUBSCRIPTION_STATUS_UNVERIFIED");
    let account: AccountStatusService, access: ModelAccessService;
    try { account = Reflect.apply(this.#createAccount, undefined, [req.attemptId]) as AccountStatusService;
      access = Reflect.apply(this.#createAccess, undefined, [req.attemptId]) as ModelAccessService; }
    catch { fail("PREFLIGHT_FAILED"); }
    if (!genuineAccount(account!) || this.#usedAccounts.has(account!) || !genuineAccess(access!) || this.#usedAccess.has(access!)) fail("PREFLIGHT_FAILED");
    this.#usedAccounts.add(account!); this.#usedAccess.add(access!);
    const costParameters = snapshotCostParameters(binding.cost_parameters, req);
    const resolveAccountStatus = async (_id: string, signal?: AbortSignal): Promise<AccountStatusResult> => {
      await this.#checkCurrent(req.attemptId, principal, client, signal, epoch);
      let value: AccountStatusResult; try { value = await Reflect.apply(ACCOUNT_GET, account!, [signal]) as AccountStatusResult; } catch { fail("PREFLIGHT_FAILED"); }
      await this.#checkCurrent(req.attemptId, principal, client, signal, epoch); return value!;
    };
    const resolveModelAccess = async (_id: string, model: string, params: Readonly<Record<string, SyntxCostParameter>>, signal?: AbortSignal): Promise<ModelAccessResult> => {
      await this.#checkCurrent(req.attemptId, principal, client, signal, epoch);
      let value: ModelAccessResult; try { value = await Reflect.apply(ACCESS_GET, access!, [{ model_id: model, cost_parameters: params }, signal]) as ModelAccessResult; }
      catch { fail("PREFLIGHT_FAILED"); } await this.#checkCurrent(req.attemptId, principal, client, signal, epoch); return value!;
    };
    const resolver = createOwnerKling4BudgetedModelAccessResolver({ catalog: this.#catalog, resolveAccountStatus, resolveModelAccess, now: this.#now });
    let result: ModelAccessResult; try { result = await this.#await(deadline, () => resolver(req.attemptId, req.model_id, costParameters, deadline.signal)); }
    catch { fail("PREFLIGHT_FAILED"); }
    await this.#checkCurrent(req.attemptId, principal, client, deadline.signal, epoch);
    if (result!.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || result!.catalog_version !== this.#modelAccessVersion() || result!.model_id !== req.model_id ||
        result!.ai_name !== AI_NAME || result!.model_type !== req.model_id || result!.account_read_live !== true || result!.parameters_redacted !== true ||
        result!.access !== true || !sameStrings(result!.parameter_keys, Object.keys(costParameters).sort()) ||
        !finite(result!.discount_cost ?? result!.cost) || !fresh(result!.observed_at, this.#readNow()) || binding.expires_at <= this.#readNow()) fail("PREFLIGHT_FAILED");
  }

  async #checkCandidate(req: OwnerKling4GenerateInput, principal: Readonly<GenerationPrincipalRef>, client: SyntxChatHttpClient,
    candidate: OwnerKling4PreparedCandidate, binding: Readonly<OwnerKling4CandidateBinding>, permit: OwnerKling4OneShotPermit,
    signal: AbortSignal, epoch: number): Promise<void> {
    await this.#checkCurrent(req.attemptId, principal, client, signal, epoch);
    const current = await Reflect.apply(PREPARER_REVALIDATE, this.#preparer, [candidate, signal]) as OwnerKling4CandidateBinding;
    if (schemaHash(current) !== schemaHash(binding)) fail("PRE_DISPATCH_FAILED");
    await revalidateOwnerKling4OneShotPermit({ preparer: this.#preparer, candidate, permit, principal, attemptId: req.attemptId });
    await this.#checkCurrent(req.attemptId, principal, client, signal, epoch);
  }

  async #observe(recovery: Recovery, deadline: AbsoluteRequestDeadline): Promise<OwnerKling4GenerationResult> {
    await this.#checkCurrent(recovery.attemptId, recovery.principal, recovery.client, deadline.signal, recovery.epoch); recovery.d.phase = "HISTORY_GET";
    let history: NativeHistory;
    try { history = await this.#await(deadline, () => Reflect.apply(MODEL_LIST, recovery.client,
      [nativeInputFor(this.#preparer, this.#referenceService, recovery.candidate, recovery.permit, recovery.principal,
        recovery.attemptId, this.#links, this.#binding, recovery.chat), deadline.signal]) as Promise<NativeHistory>); }
    catch { recovery.d.history_status = "UNVERIFIED"; recovery.d.gaps = ["HISTORY_GET_UNAVAILABLE"]; throw unknown(recovery); }
    await this.#checkCurrent(recovery.attemptId, recovery.principal, recovery.client, deadline.signal, recovery.epoch);
    recovery.d.history_get_calls += history.history_get_calls; recovery.d.owner_ack_status = history.owner_ack_status;
    recovery.d.request_echo_status = history.request_echo_status;
    if (history.status !== "COMPLETE" || history.owner_ack_status !== "MATCHED" || history.history_binding_status !== "BOUND" ||
        history.history_page_status !== "COMPLETE" || history.owner_echo_message_id !== recovery.owner_echo_message_id ||
        history.request_echo_status === "CONTRADICTORY" || history.contexts.length < 1 || history.contexts.length > PAGE_SIZE) {
      recovery.d.history_status = history.status === "PENDING" ? "PENDING" : history.status === "UNVERIFIED" || history.history_page_status === "UNPROVEN" ? "UNVERIFIED" : "INCOMPLETE";
      recovery.d.gaps = safeGaps(history.gaps); throw unknown(recovery);
    }
    recovery.d.history_status = "COMPLETE";
    for (const context of history.contexts) {
      if (!validNativeContext(context, recovery)) { recovery.d.result_status = "UNVERIFIED"; recovery.d.gaps = ["RESULT_CONTEXT_UNBOUND"]; throw unknown(recovery); }
      await this.#checkCurrent(recovery.attemptId, recovery.principal, recovery.client, deadline.signal, recovery.epoch);
      recovery.d.phase = "RESULT_GET"; recovery.d.result_get_calls += 1;
      let result: NativeResult;
      try { result = await this.#await(deadline, () => Reflect.apply(MODEL_GET, recovery.client, [Object.freeze({ result_context: context,
        principal: recovery.principal, attemptId: recovery.attemptId, linkService: this.#links, binding: this.#binding }), deadline.signal]) as Promise<NativeResult>); }
      catch { recovery.d.result_status = "UNVERIFIED"; recovery.d.gaps = ["RESULT_GET_UNAVAILABLE"]; throw unknown(recovery); }
      await this.#checkCurrent(recovery.attemptId, recovery.principal, recovery.client, deadline.signal, recovery.epoch);
      if (result.message_binding !== "BOUND" || result.model_echo !== "MATCHED" || result.gaps.length || !result.artifacts.length) {
        recovery.d.result_status = "UNVERIFIED"; recovery.d.gaps = safeGaps(result.gaps.length ? result.gaps : ["RESULT_NOT_VERIFIED"]); throw unknown(recovery);
      }
      for (const artifact of result.artifacts) {
        if (!validArtifact(artifact, context)) { recovery.d.result_status = "UNVERIFIED"; recovery.d.gaps = ["RESULT_ARTIFACT_INVALID"]; throw unknown(recovery); }
        const key = `${context.message_id}:${artifact.message_object_id}`, prior = recovery.artifacts.get(key);
        if (prior && !sameArtifact(prior, artifact)) { recovery.d.result_status = "UNVERIFIED"; recovery.d.gaps = ["RESULT_ARTIFACT_CONTRADICTION"]; throw unknown(recovery); }
        const previous = recovery.objectUrls.get(artifact.message_object_id);
        if (previous !== undefined && previous !== artifact.object_url) { recovery.d.result_status = "UNVERIFIED"; recovery.d.gaps = ["RESULT_OBJECT_URL_CONTRADICTION"]; throw unknown(recovery); }
        if (recovery.artifacts.size >= MAX_RESULTS) { recovery.d.result_status = "UNVERIFIED"; recovery.d.gaps = ["RESULT_LIMIT_EXCEEDED"]; throw unknown(recovery); }
        recovery.objectUrls.set(artifact.message_object_id, artifact.object_url);
        recovery.artifacts.set(key, Object.freeze({ ...artifact, message_id: context.message_id, chat_uuid: context.chat_uuid, model_id: recovery.model_id }));
      }
    }
    if (!recovery.artifacts.size) { recovery.d.result_status = "UNVERIFIED"; recovery.d.gaps = ["RESULT_NOT_OBSERVED"]; throw unknown(recovery); }
    recovery.d.phase = "RESULT_GET"; recovery.d.result_status = "COMPLETE"; recovery.d.gaps = []; recovery.status = "completed"; return page(recovery, 0);
  }

  #candidateBinding(candidate: unknown, req: OwnerKling4GenerateInput, principal: Readonly<GenerationPrincipalRef>): Readonly<OwnerKling4CandidateBinding> {
    if (!isOwnerKling4PreparedCandidate(candidate)) fail("PRE_DISPATCH_FAILED");
    const b = Reflect.apply(PREPARER_INSPECT, this.#preparer, [candidate]) as OwnerKling4CandidateBinding | undefined;
    if (!b || b.attempt_id !== req.attemptId || b.model_id !== req.model_id || b.profile_sha256 !== getOwnerKling4SourceProfile(req.model_id).source_sha256 ||
        !sameGenerationPrincipal(b.principal, principal) || b.expires_at <= this.#readNow() || !/^sha256:[a-f0-9]{64}$/u.test(b.request_fingerprint) ||
        !/^sha256:[a-f0-9]{64}$/u.test(b.intent_fingerprint) || candidate.status !== "blocked" || candidate.dispatch_allowed !== false ||
        candidate.backend_acceptance !== "UNPROVEN" || candidate.request_fingerprint !== b.request_fingerprint || candidate.intent_fingerprint !== b.intent_fingerprint ||
        candidate.profile_sha256 !== b.profile_sha256 || candidate.expires_at !== b.expires_at || schemaHash(candidate.sources) !== schemaHash(b.sources) ||
        b.sources.length !== req.reference_handles.length || b.sources.some((s, i) => s.reference_handle !== req.reference_handles[i])) fail("PRE_DISPATCH_FAILED");
    return b;
  }
  #assertChat(chat: NativeChat, req: OwnerKling4GenerateInput, b: Readonly<OwnerKling4CandidateBinding>): void {
    if (!chat || chat.status !== "created" || !safeId(chat.chat_uuid) || chat.attempt_id !== req.attemptId || chat.model_id !== req.model_id ||
        chat.profile_sha256 !== b.profile_sha256 || chat.request_fingerprint !== b.request_fingerprint || chat.intent_fingerprint !== b.intent_fingerprint ||
        schemaHash(chat.sources) !== schemaHash(b.sources) || chat.dispatch_allowed !== false || chat.backend_acceptance !== "UNPROVEN") fail("PRE_DISPATCH_FAILED");
  }
  #assertModel(): void {
    for (const modelId of MODEL_IDS) {
      const p = getOwnerKling4SourceProfile(modelId), pin = p.source_bindings.public_catalog;
      if (p.model_id !== modelId || p.source_catalog_version !== this.#catalogVersion || p.runtime_usable !== false || p.dispatch_allowed !== false ||
          p.provider_acceptance !== "UNPROVEN" || this.#catalog.source_hashes.models !== pin.models_sha256) fail("MODEL_BINDING_MISMATCH");
    }
    this.#assertCatalogModel("kling_4_keyframes"); this.#assertCatalogModel("kling_4_omni");
  }
  #assertCatalogModel(modelId: OwnerKling4ParametersModelId): void {
    try {
      const p = getOwnerKling4SourceProfile(modelId), record = this.#catalog.getModel(modelId);
      const keys = modelId === "kling_4_keyframes" ? ["mode", "version", "video_duration"] : ["duration", "mode", "version", "video_duration"];
      if (this.#catalog.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || this.#catalog.runtime_usable !== false || record.id !== modelId ||
          record.upstream_id !== modelId || record.ai_name !== AI_NAME || record.scope !== "video" || record.active !== true || !record.settings ||
          !keys.every(k => record.settings!.get_cost_params?.includes(k)) || !record.operations?.some(op => op.id === "generate-video" && op.output_modality === "video") ||
          p.model_id !== modelId || p.source_sha256.length !== 71) fail("MODEL_BINDING_MISMATCH");
    } catch { fail("MODEL_BINDING_MISMATCH"); }
  }
  #modelAccessVersion(): string { return `${this.#catalog.fetched_at}.${this.#catalog.source_hashes.models.slice(7, 19)}`; }
  #client(attemptId: string): SyntxChatHttpClient {
    let value: unknown; try { value = Reflect.apply(this.#resolveClient, undefined, [attemptId]); } catch { fail("PRINCIPAL_NOT_LINKED"); }
    if (!nativeClient(value)) fail("MODEL_BINDING_MISMATCH"); const prior = this.#clients.get(attemptId);
    if (prior && prior !== value) fail("PRINCIPAL_NOT_LINKED"); if (!prior && this.#clients.size >= 128) fail("CAPACITY_EXCEEDED");
    this.#clients.set(attemptId, value as SyntxChatHttpClient); return value as SyntxChatHttpClient;
  }
  async #principal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    signal?.throwIfAborted(); if (!ATTEMPT.test(attemptId)) fail("INVALID_REQUEST");
    try { const p = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#links });
      if (p.connection_id !== attemptId || p.tenant_id !== this.#binding.tenant_id || p.subject_id !== this.#binding.subject) fail("PRINCIPAL_NOT_LINKED");
      signal?.throwIfAborted(); return p;
    } catch (e) { if (e instanceof OwnerKling4GenerationServiceError) throw e; fail("PRINCIPAL_NOT_LINKED"); }
  }
  async #checkCurrent(attempt: string, principal: Readonly<GenerationPrincipalRef>, client: SyntxChatHttpClient, signal?: AbortSignal, epoch?: number): Promise<void> {
    const latest = await this.#principal(attempt, signal);
    if (this.#invalidating.has(attempt) || epoch !== undefined && (this.#epochs.get(attempt) ?? 0) !== epoch ||
        !sameGenerationPrincipal(latest, principal) || this.#client(attempt) !== client) fail("PRINCIPAL_NOT_LINKED");
  }
  #newRecovery(attemptId: string, principal: Readonly<GenerationPrincipalRef>, intentKey: string, modelId: OwnerKling4ParametersModelId,
    candidate: OwnerKling4PreparedCandidate, permit: OwnerKling4OneShotPermit, chat: NativeChat, client: SyntxChatHttpClient,
    binding: Readonly<OwnerKling4CandidateBinding>, epoch: number): Recovery {
    const now = this.#readNow(); return { recovery_id: `kling4_recovery_${randomUUID()}`, attemptId, intentKey, principal,
      created_at: new Date(now).toISOString(), model_id: modelId, candidate, permit, chat, client, binding, epoch,
      owner_echo_message_id: null, status: "outcome_unknown", artifacts: new Map(), objectUrls: new Map(),
      d: { phase: "CHAT_CREATE", post_started: false, ack_known: false, history_status: "NOT_READ", owner_ack_status: "NOT_READ",
        request_echo_status: "NOT_READ", history_get_calls: 0, result_get_calls: 0, result_status: "NOT_READ", gaps: [] } };
  }
  #owned(attempt: string, id: string, principal: Readonly<GenerationPrincipalRef>): Recovery {
    const r = this.#recoveries.get(id); if (!r || r.recovery_id !== id || r.attemptId !== attempt || this.#invalidating.has(attempt) ||
      !sameGenerationPrincipal(r.principal, principal) || r.epoch !== (this.#epochs.get(attempt) ?? 0) || this.#client(attempt) !== r.client) fail("RECOVERY_NOT_FOUND");
    return r;
  }
  #await<T>(d: AbsoluteRequestDeadline, f: () => Promise<T>): Promise<T> { d.throwIfAborted(); return d.waitFor(f()); }
  #run<T>(attempt: string, parent: AbortSignal | undefined, operation: (s: AbortSignal, epoch: number) => Promise<T>): Promise<T> {
    if (this.#closed || !SERVICES.has(this)) return Promise.reject(err("SERVICE_CLOSED"));
    if (this.#invalidating.has(attempt) || this.#runs.size >= RUN_LIMIT) return Promise.reject(err("SERVICE_BUSY"));
    const controller = new AbortController(), abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    const epoch = this.#epochs.get(attempt) ?? 0, run: Run = { attemptId: attempt, controller, promise: Promise.resolve() };
    run.promise = Promise.resolve().then(() => { if (controller.signal.aborted) fail("SERVICE_BUSY"); return operation(controller.signal, epoch); })
      .finally(() => { parent?.removeEventListener("abort", abort); this.#runs.delete(run); }); this.#runs.add(run); return run.promise as Promise<T>;
  }
  #readNow(): number { let v: unknown; try { v = Reflect.apply(this.#now, undefined, []); } catch { fail("SERVICE_BUSY"); }
    if (!Number.isSafeInteger(v) || (v as number) < this.#lastNow || (v as number) < 0) fail("SERVICE_BUSY"); this.#lastNow = v as number; return v as number; }
  #assertOpen(): void { if (this.#closed || !SERVICES.has(this)) fail("SERVICE_CLOSED"); }
}
Object.freeze(OwnerKling4GenerationService.prototype);
export function isOwnerKling4GenerationService(v: unknown): v is OwnerKling4GenerationService {
  return !!v && typeof v === "object" && !types.isProxy(v) && SERVICES.has(v) && Object.getPrototypeOf(v) === OwnerKling4GenerationService.prototype && Object.isFrozen(v);
}

function snapshotGenerate(v: unknown): OwnerKling4GenerateInput {
  let n: ReturnType<typeof normalizeOwnerKling4Parameters>; try { n = normalizeOwnerKling4Parameters(v); } catch { invalid(); }
  return Object.freeze({ attemptId: n!.attemptId, model_id: n!.model_id, prompt: n!.prompt, version: n!.version, mode: n!.mode,
    aspect_ratio: n!.aspect_ratio, video_duration: n!.video_duration, native_audio: n!.native_audio, reference_handles: Object.freeze([...n!.reference_handles]) });
}
function snapshotRecovery(v: unknown): OwnerKling4ReconcileInput { const f=exact(v,["attemptId","recovery_id"]);
  if(typeof f.attemptId!=="string"||!ATTEMPT.test(f.attemptId)||typeof f.recovery_id!=="string"||!RECOVERY.test(f.recovery_id))invalid();return Object.freeze({attemptId:f.attemptId,recovery_id:f.recovery_id}); }
function snapshotList(v: unknown): Readonly<{attemptId:string;limit:number}>{const f=exact(v,["attemptId"],["limit"]);if(typeof f.attemptId!=="string"||!ATTEMPT.test(f.attemptId))invalid();return Object.freeze({attemptId:f.attemptId,limit:bounded(f.limit,1,RECOVERY_LIMIT,20)});}
function snapshotPage(v: unknown): Readonly<{attemptId:string;recovery_id:string;offset:number}>{const f=exact(v,["attemptId","recovery_id"],["offset"]);if(typeof f.attemptId!=="string"||!ATTEMPT.test(f.attemptId)||typeof f.recovery_id!=="string"||!RECOVERY.test(f.recovery_id))invalid();return Object.freeze({attemptId:f.attemptId,recovery_id:f.recovery_id,offset:bounded(f.offset,0,MAX_RESULTS,0)});}
function snapshotSubscription(v: unknown): Readonly<SyntxSubscription>{const f=exact(v,["active","plan_type","end_date","end_date_kind"]);if(!(f.active===true||f.active===false||f.active===null)||!(f.plan_type===null||typeof f.plan_type==="string")||!(f.end_date===null||typeof f.end_date==="string")||!(f.end_date_kind===null||["DATE_ONLY","LOCAL_DATETIME","OFFSET_DATETIME"].includes(String(f.end_date_kind))))fail("SUBSCRIPTION_STATUS_UNVERIFIED");return Object.freeze({active:f.active as boolean|null,plan_type:f.plan_type as string|null,end_date:f.end_date as string|null,end_date_kind:f.end_date_kind as SyntxSubscription["end_date_kind"]});}
function snapshotCostParameters(value: unknown, req: OwnerKling4GenerateInput): Readonly<Record<string,SyntxCostParameter>>{const keys=req.model_id===MODEL_IDS[0]?["mode","version","video_duration"]:["duration","mode","version","video_duration"];const f=exact(value,keys);if(f.mode!==req.mode||f.version!==req.version||f.video_duration!==req.video_duration||typeof f.video_duration!=="number"||!Number.isSafeInteger(f.video_duration)||f.video_duration<3||f.video_duration>30)fail("PREFLIGHT_FAILED");if(req.model_id===MODEL_IDS[1]&&!(f.duration===0||typeof f.duration==="string"&&/^(?:0|[1-9][0-9]*)\.[0-9]{2}$/u.test(f.duration)))fail("PREFLIGHT_FAILED");return Object.freeze(Object.fromEntries(keys.map(k=>[k,f[k]])) as Record<string,SyntxCostParameter>);}
function validNativeContext(c: NativeResultContext, r: Recovery): boolean {return !!c&&c.chat_uuid===r.chat.chat_uuid&&c.attempt_id===r.attemptId&&c.model_id===r.model_id&&c.profile_sha256===r.binding.profile_sha256&&c.request_fingerprint===r.binding.request_fingerprint&&c.intent_fingerprint===r.binding.intent_fingerprint&&c.owner_echo_message_id===r.owner_echo_message_id&&safeId(c.message_id)&&/^\d{1,16}$/u.test(c.provider_chat_id)&&Array.isArray(c.message_object_ids)&&c.message_object_ids.length>0&&c.message_object_ids.length<=PAGE_SIZE&&new Set(c.message_object_ids).size===c.message_object_ids.length;}
function validArtifact(a: NativeResult["artifacts"][number], c: NativeResultContext): boolean{return a.object_type==="video"&&Number.isSafeInteger(a.object_index)&&a.object_index>=0&&c.message_object_ids.includes(a.message_object_id)&&safeId(a.message_object_id)&&isSafeUploadReferenceUrl(a.object_url)&&(a.mime_type===null||a.mime_type==="video/mp4"||a.mime_type==="video/quicktime")&&a.mime_source===(a.mime_type===null?"UNKNOWN":"URL_EXTENSION");}
function sameArtifact(a: OwnerKling4GenerationArtifact,b: NativeResult["artifacts"][number]):boolean{return a.object_index===b.object_index&&a.message_object_id===b.message_object_id&&a.object_url===b.object_url&&a.object_type===b.object_type&&a.mime_type===b.mime_type&&a.mime_source===b.mime_source;}
function page(r:Recovery,offset:number):OwnerKling4GenerationResult{const all=[...r.artifacts.values()],artifacts=Object.freeze(all.slice(offset,offset+PAGE_SIZE)),next=offset+artifacts.length;return Object.freeze({status:"completed",status_semantics:"LOCAL_OBSERVED_AVAILABILITY_ONLY",backend_acceptance:"UNPROVEN",provider_terminal_status:"UNPROVEN",cost_cap_enforced:false,output_count:"UNKNOWN",recovery_id:r.recovery_id,model_id:r.model_id,source_binding:Object.freeze({public_catalog_version:getOwnerKling4SourceProfile(r.model_id).source_catalog_version,profile_sha256:r.binding.profile_sha256,request_fingerprint:r.binding.request_fingerprint,intent_fingerprint:r.binding.intent_fingerprint}),observed_artifact_count:all.length,offset,page_size:PAGE_SIZE,artifacts,has_more:next<all.length,next_offset:next<all.length?next:null,diagnostic:diagnostic(r.d)});}
function diagnostic(d:Recovery["d"]):OwnerKling4GenerationDiagnostic{return Object.freeze({...d,gaps:Object.freeze(d.gaps.slice(0,32))});}
function recoveryItem(r:Recovery):OwnerKling4RecoveryListItem{return Object.freeze({recovery_id:r.recovery_id,created_at:r.created_at,model_id:r.model_id,status:r.status,observed_artifact_count:r.artifacts.size,diagnostic:diagnostic(r.d)});}
function unknown(r:Recovery):OwnerKling4GenerationServiceError{return new OwnerKling4GenerationServiceError("OUTCOME_UNKNOWN",r.recovery_id,diagnostic(r.d));}
function nativeInputFor(preparer:OwnerKling4RequestPreparer,referenceService:OwnerKling4ReferenceService,candidate:OwnerKling4PreparedCandidate,permit:OwnerKling4OneShotPermit,principal:Readonly<GenerationPrincipalRef>,attemptId:string,linkService:PerUserLinkService,binding:Readonly<AuthBinding>,chat?:NativeChat){return Object.freeze({preparer,referenceService,candidate,permit,principal,attemptId,linkService,binding,...(chat?{chat}:{})});}
function nativeClient(v:unknown):v is SyntxChatHttpClient{if(!v||typeof v!=="object"||types.isProxy(v))return false;try{return Object.getPrototypeOf(v)===SyntxChatHttpClient.prototype&&[["createChat",CHAT_CREATE],["uploadOwnerKling4Reference",SyntxChatHttpClient.prototype.uploadOwnerKling4Reference],["createOwnerKling4Chat",MODEL_CREATE],["startOwnerKling4WithOwnedCandidate",MODEL_START],["listOwnedKling4Candidates",MODEL_LIST],["getOwnedKling4Result",MODEL_GET]].every(([key,expected])=>!Object.hasOwn(v,key as string)&&getDataMethod(v,key as string)===expected&&Reflect.get(v,key as string)===expected);}catch{return false;}}
function genuineLinks(v:unknown):boolean{return !!v&&typeof v==="object"&&!types.isProxy(v)&&Object.getPrototypeOf(v)===PerUserLinkService.prototype&&PerUserLinkService.prototype.getStatus===LINK_STATUS&&!Object.hasOwn(v,"getStatus");}
function genuineAccount(v:unknown):v is AccountStatusService{return !!v&&typeof v==="object"&&!types.isProxy(v)&&Object.getPrototypeOf(v)===AccountStatusService.prototype&&!Object.hasOwn(v,"getAccountStatus")&&AccountStatusService.prototype.getAccountStatus===ACCOUNT_GET&&getDataMethod(v,"getAccountStatus")===ACCOUNT_GET;}
function genuineAccess(v:unknown):v is ModelAccessService{return !!v&&typeof v==="object"&&!types.isProxy(v)&&Object.getPrototypeOf(v)===ModelAccessService.prototype&&!Object.hasOwn(v,"getModelAccess")&&ModelAccessService.prototype.getModelAccess===ACCESS_GET&&getDataMethod(v,"getModelAccess")===ACCESS_GET;}
function snapshotBinding(v:unknown):Readonly<AuthBinding>{const f=exact(v,["tenant_id","subject"]);if(typeof f.tenant_id!=="string"||!f.tenant_id.trim()||f.tenant_id.length>256||typeof f.subject!=="string"||!f.subject.trim()||f.subject.length>512||/[\u0000-\u001f\u007f]/u.test(f.tenant_id)||/[\u0000-\u001f\u007f]/u.test(f.subject))invalid();return Object.freeze({tenant_id:f.tenant_id,subject:f.subject});}
function exact(v:unknown,required:readonly string[],optional:readonly string[]=[]):Record<string,any>{if(!v||typeof v!=="object"||Array.isArray(v)||types.isProxy(v))invalid();let p:object|null,d:PropertyDescriptorMap;try{p=Object.getPrototypeOf(v);d=Object.getOwnPropertyDescriptors(v);}catch{invalid();}const keys=Reflect.ownKeys(d!),allowed=[...required,...optional];if((p!==Object.prototype&&p!==null)||required.some(k=>!Object.hasOwn(d!,k))||keys.some(k=>typeof k!=="string"||!allowed.includes(k)||!Object.hasOwn(d![k]!,"value")||d![k]!.enumerable!==true))invalid();const out=Object.create(null) as Record<string,any>;for(const k of keys as string[])out[k]=d![k]!.value;return out;}
function exactSignal(s:AbortSignal|undefined):AbortSignal|undefined{if(s===undefined)return undefined;if(!s||typeof s!=="object"||types.isProxy(s)||!(s instanceof AbortSignal)||Object.getPrototypeOf(s)!==AbortSignal.prototype)invalid();return s;}
function semanticIntentKey(p:Readonly<GenerationPrincipalRef>,f:string):string{return JSON.stringify([p.tenant_id,p.subject_id,f]);}
function sameStrings(a:readonly string[],b:readonly string[]):boolean{return a.length===b.length&&a.every((x,i)=>x===b[i]);}
function fresh(v:string,now:number):boolean{const n=Date.parse(v);return typeof v==="string"&&Number.isFinite(n)&&Math.abs(n-now)<=300_000;}
function finite(v:unknown):v is number{return typeof v==="number"&&Number.isFinite(v)&&v>=0;}
function safeId(v:unknown):v is string{return typeof v==="string"&&/^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u.test(v);}
function safeGaps(g:readonly string[]):string[]{return [...new Set(g.filter(x=>/^[A-Z][A-Z0-9_]{0,127}$/u.test(x)))].slice(0,32);}
function bounded(v:unknown,min:number,max:number,fallback:number):number{if(v===undefined)return fallback;if(!Number.isSafeInteger(v)||(v as number)<min||(v as number)>max)invalid();return v as number;}
function readAttempt(v:unknown):string{if(typeof v!=="string"||!ATTEMPT.test(v))invalid();return v;}
function readClock(v:unknown):()=>number{if(typeof v!=="function"||types.isProxy(v))invalid();return v as ()=>number;}
function getDataMethod(target:object,key:string):unknown{let c:object|null=target;while(c){const d=Object.getOwnPropertyDescriptor(c,key);if(d)return "value" in d?d.value:undefined;c=Object.getPrototypeOf(c) as object|null;}return undefined;}
function err(code:OwnerKling4GenerationErrorCode):OwnerKling4GenerationServiceError{return new OwnerKling4GenerationServiceError(code);}
function fail(code:OwnerKling4GenerationErrorCode):never{throw err(code);}
function invalid():never{return fail("INVALID_REQUEST");}
