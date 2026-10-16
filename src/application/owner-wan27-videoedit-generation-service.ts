import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { readOwnerWan27VideoEditNativeDispatchStatus } from "../adapter/syntx/owner-wan27-videoedit-native-context.js";
import type { SyntxSubscription } from "../adapter/syntx/account-decoder.js";
import type { SyntxCostParameter } from "../adapter/syntx/http-client.js";
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
import { createOwnerWan27VideoEditBudgetedModelAccessResolver } from "./owner-wan27-videoedit-budget-preflight.js";
import { isOwnerWan27VideoEditReferenceService, OwnerWan27VideoEditReferenceService } from "./owner-wan27-videoedit-reference-service.js";
import {
  isOwnerWan27VideoEditRequestPreparer, isOwnerWan27VideoEditPreparedCandidate, OwnerWan27VideoEditRequestPreparer,
  type OwnerWan27VideoEditCandidateBinding, type OwnerWan27VideoEditPreparedCandidate, type OwnerWan27VideoEditRequestInput
} from "./owner-wan27-videoedit-request-preparer.js";
import {
  createOwnerWan27VideoEditOneShotPermit, revalidateOwnerWan27VideoEditOneShotPermit,
  type OwnerWan27VideoEditOneShotPermit, OwnerWan27VideoEditOneShotPolicyError
} from "./owner-wan27-videoedit-one-shot-policy.js";
import { getOwnerWan27VideoEditSourceProfile } from "./owner-wan27-videoedit-parameters.js";
import type {
  OwnerWan27VideoEditNativeChatContext, OwnerWan27VideoEditNativeResultCandidates,
  OwnerWan27VideoEditNativeResultContext, OwnerWan27VideoEditNativeResult
} from "../adapter/syntx/owner-wan27-videoedit-native-context.js";

const MODEL_ID = "wan_27_videoedit" as const;
const AI_NAME = "wan_video" as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY = /^wan27_videoedit_recovery_[0-9a-f-]{36}$/u;
const RECOVERY_LIMIT = 128;
const RUN_LIMIT = 4;
const PAGE_SIZE = 64;
const MAX_RESULTS = 4096;
const REQUEST_TIMEOUT_MS = 120_000;
const MODEL_CREATE = SyntxChatHttpClient.prototype.createOwnerWan27VideoEditChat;
const MODEL_START = SyntxChatHttpClient.prototype.startOwnerWan27VideoEditWithOwnedCandidate;
const MODEL_LIST = SyntxChatHttpClient.prototype.listOwnedWan27VideoEditCandidates;
const MODEL_GET = SyntxChatHttpClient.prototype.getOwnedWan27VideoEditResult;
const CHAT_CREATE = SyntxChatHttpClient.prototype.createChat;
const UPLOAD = SyntxChatHttpClient.prototype.uploadOwnerWan27VideoEditReference;
const ACCOUNT_GET = AccountStatusService.prototype.getAccountStatus;
const ACCESS_GET = ModelAccessService.prototype.getModelAccess;
const LINK_STATUS = PerUserLinkService.prototype.getStatus;
const PREPARER_BOUND = OwnerWan27VideoEditRequestPreparer.prototype.isBoundToReferenceService;
const PREPARER_PREPARE = OwnerWan27VideoEditRequestPreparer.prototype.prepare;
const PREPARER_INSPECT = OwnerWan27VideoEditRequestPreparer.prototype.inspectCandidate;
const PREPARER_REVALIDATE = OwnerWan27VideoEditRequestPreparer.prototype.revalidateCandidate;
const PREPARER_INVALIDATE = OwnerWan27VideoEditRequestPreparer.prototype.invalidateAttempt;
const SERVICES = new WeakSet<object>();

export type OwnerWan27VideoEditGenerationPhase = "VALIDATE_REQUEST" | "PREFLIGHT_ONE" | "CHAT_CREATE" | "PREFLIGHT_TWO" |
  "GENERATION_POST" | "POST_ACK_KNOWN" | "HISTORY_GET" | "RESULT_GET";
export interface OwnerWan27VideoEditGenerationDiagnostic {
  readonly phase: OwnerWan27VideoEditGenerationPhase;
  readonly post_started: boolean;
  readonly ack_known: boolean;
  readonly history_status: "NOT_READ" | "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "NOT_READ" | "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  readonly request_echo_status: "NOT_READ" | "MATCHED" | "ABSENT" | "PARTIAL_UNPROVEN" | "CONTRADICTORY";
  readonly history_get_calls: number;
  readonly result_get_calls: number;
  readonly result_status: "NOT_READ" | "COMPLETE" | "UNVERIFIED";
  readonly gaps: readonly string[];
}
export interface OwnerWan27VideoEditGenerationArtifact {
  readonly object_index: number;
  readonly message_object_id: string;
  readonly object_type: "video";
  readonly object_url: string;
  readonly mime_type: "video/mp4" | "video/quicktime" | null;
  readonly mime_source: "URL_EXTENSION" | "UNKNOWN";
  readonly message_id: string;
  readonly chat_uuid: string;
  readonly model_id: typeof MODEL_ID;
}
export interface OwnerWan27VideoEditGenerationResult {
  readonly status: "completed";
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly backend_acceptance: "UNPROVEN";
  readonly provider_terminal_status: "UNPROVEN";
  readonly cost_cap_enforced: false;
  readonly output_count: "UNKNOWN";
  readonly recovery_id: string;
  readonly model_id: typeof MODEL_ID;
  readonly source_binding: Readonly<{
    public_catalog_version: string;
    profile_sha256: string;
    request_fingerprint: string;
    intent_fingerprint: string;
  }>;
  readonly observed_artifact_count: number;
  readonly offset: number;
  readonly page_size: typeof PAGE_SIZE;
  readonly artifacts: readonly OwnerWan27VideoEditGenerationArtifact[];
  readonly has_more: boolean;
  readonly next_offset: number | null;
  readonly diagnostic: OwnerWan27VideoEditGenerationDiagnostic;
}
export interface OwnerWan27VideoEditRecoveryListItem {
  readonly recovery_id: string;
  readonly created_at: string;
  readonly model_id: typeof MODEL_ID;
  readonly status: "outcome_unknown" | "completed";
  readonly observed_artifact_count: number;
  readonly diagnostic: OwnerWan27VideoEditGenerationDiagnostic;
}
export interface OwnerWan27VideoEditGenerationServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string;
  readonly preparer: OwnerWan27VideoEditRequestPreparer;
  readonly referenceService: OwnerWan27VideoEditReferenceService;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly createAccountStatusService: (attemptId: string) => AccountStatusService;
  readonly createModelAccessService: (attemptId: string) => ModelAccessService;
  readonly resolveSubscription: (attemptId: string, signal?: AbortSignal) => Promise<SyntxSubscription>;
  readonly now?: () => number;
}
export interface OwnerWan27VideoEditGenerateInput extends OwnerWan27VideoEditRequestInput {}
export interface OwnerWan27VideoEditReconcileInput { readonly attemptId: string; readonly recovery_id: string; }
export interface OwnerWan27VideoEditRecoveryListInput { readonly attemptId: string; readonly limit?: number; }
export interface OwnerWan27VideoEditResultPageInput { readonly attemptId: string; readonly recovery_id: string; readonly offset?: number; }
export type OwnerWan27VideoEditGenerationErrorCode = "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED" |
  "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH" | "PREFLIGHT_FAILED" | "SUBSCRIPTION_REQUIRED" |
  "SUBSCRIPTION_STATUS_UNVERIFIED" | "INTENT_ALREADY_CLAIMED" | "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND";
export class OwnerWan27VideoEditGenerationServiceError extends Error {
  readonly diagnostic?: OwnerWan27VideoEditGenerationDiagnostic;
  constructor(readonly code: OwnerWan27VideoEditGenerationErrorCode, readonly recovery_id?: string,
    diagnostic?: OwnerWan27VideoEditGenerationDiagnostic) {
    super(code === "OUTCOME_UNKNOWN"
      ? "The owner WAN 2.7 Video Edit request may have been dispatched; use GET-only reconciliation and do not retry."
      : "The owner WAN 2.7 Video Edit generation could not be completed safely.");
    this.name = "OwnerWan27VideoEditGenerationServiceError";
    if (code === "OUTCOME_UNKNOWN" && diagnostic) this.diagnostic = diagnostic;
  }
}

type NativeChat = OwnerWan27VideoEditNativeChatContext;
type NativeHistory = OwnerWan27VideoEditNativeResultCandidates;
type NativeResultContext = OwnerWan27VideoEditNativeResultContext;
type NativeResult = OwnerWan27VideoEditNativeResult;
interface Run { readonly attemptId: string; readonly controller: AbortController; promise: Promise<unknown>; }
interface Recovery {
  readonly recovery_id: string;
  readonly attemptId: string;
  readonly intentKey: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly created_at: string;
  readonly candidate: OwnerWan27VideoEditPreparedCandidate;
  readonly permit: OwnerWan27VideoEditOneShotPermit;
  readonly chat: NativeChat;
  readonly client: SyntxChatHttpClient;
  readonly binding: Readonly<OwnerWan27VideoEditCandidateBinding>;
  readonly epoch: number;
  owner_echo_message_id: string | null;
  status: "outcome_unknown" | "completed";
  readonly artifacts: Map<string, OwnerWan27VideoEditGenerationArtifact>;
  readonly objectUrls: Map<string, string>;
  readonly d: {
    phase: OwnerWan27VideoEditGenerationPhase;
    post_started: boolean;
    ack_known: boolean;
    history_status: OwnerWan27VideoEditGenerationDiagnostic["history_status"];
    owner_ack_status: OwnerWan27VideoEditGenerationDiagnostic["owner_ack_status"];
    request_echo_status: OwnerWan27VideoEditGenerationDiagnostic["request_echo_status"];
    history_get_calls: number;
    result_get_calls: number;
    result_status: OwnerWan27VideoEditGenerationDiagnostic["result_status"];
    gaps: string[];
  };
}

/** Two current subscription/quote/balance gates, one native GEN attempt, then GET-only recovery. */
export class OwnerWan27VideoEditGenerationService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #links: PerUserLinkService;
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #catalogVersion: string;
  readonly #preparer: OwnerWan27VideoEditRequestPreparer;
  readonly #referenceService: OwnerWan27VideoEditReferenceService;
  readonly #resolveClient: OwnerWan27VideoEditGenerationServiceOptions["resolveChatClient"];
  readonly #createAccount: OwnerWan27VideoEditGenerationServiceOptions["createAccountStatusService"];
  readonly #createAccess: OwnerWan27VideoEditGenerationServiceOptions["createModelAccessService"];
  readonly #resolveSubscription: OwnerWan27VideoEditGenerationServiceOptions["resolveSubscription"];
  readonly #now: () => number;
  readonly #recoveries = new Map<string, Recovery>();
  readonly #reserved = new Set<string>();
  readonly #claimed = new Set<string>();
  readonly #runs = new Set<Run>();
  readonly #clients = new Map<string, SyntxChatHttpClient>();
  readonly #usedAccounts = new WeakSet<object>();
  readonly #usedAccess = new WeakSet<object>();
  readonly #epochs = new Map<string, number>();
  readonly #invalidating = new Set<string>();
  readonly #invalidations = new Map<string, Promise<void>>();
  #closed = false;
  #closing: Promise<void> | undefined;
  #lastNow = -1;

  constructor(optionsInput: OwnerWan27VideoEditGenerationServiceOptions | unknown) {
    const o = exact(optionsInput, ["binding", "linkService", "catalog", "catalog_version", "preparer", "referenceService",
      "resolveChatClient", "createAccountStatusService", "createModelAccessService", "resolveSubscription"], ["now"]);
    if (!genuineLinks(o.linkService) || !(o.catalog instanceof DiscoveryCatalogRepository) || types.isProxy(o.catalog) ||
        !isOwnerWan27VideoEditReferenceService(o.referenceService) || !isOwnerWan27VideoEditRequestPreparer(o.preparer) ||
        !Reflect.apply(PREPARER_BOUND, o.preparer as OwnerWan27VideoEditRequestPreparer, [o.referenceService]) ||
        typeof o.resolveChatClient !== "function" || types.isProxy(o.resolveChatClient) ||
        typeof o.createAccountStatusService !== "function" || types.isProxy(o.createAccountStatusService) ||
        typeof o.createModelAccessService !== "function" || types.isProxy(o.createModelAccessService) ||
        typeof o.resolveSubscription !== "function" || types.isProxy(o.resolveSubscription) ||
        (o.now !== undefined && (typeof o.now !== "function" || types.isProxy(o.now)))) invalid();
    this.#binding = snapshotBinding(o.binding);
    this.#links = o.linkService as PerUserLinkService;
    this.#catalog = o.catalog as DiscoveryCatalogRepository;
    this.#catalogVersion = o.catalog_version as string;
    this.#preparer = o.preparer as OwnerWan27VideoEditRequestPreparer;
    this.#referenceService = o.referenceService as OwnerWan27VideoEditReferenceService;
    this.#resolveClient = o.resolveChatClient as OwnerWan27VideoEditGenerationServiceOptions["resolveChatClient"];
    this.#createAccount = o.createAccountStatusService as OwnerWan27VideoEditGenerationServiceOptions["createAccountStatusService"];
    this.#createAccess = o.createModelAccessService as OwnerWan27VideoEditGenerationServiceOptions["createModelAccessService"];
    this.#resolveSubscription = o.resolveSubscription as OwnerWan27VideoEditGenerationServiceOptions["resolveSubscription"];
    this.#now = o.now === undefined ? Date.now : readClock(o.now);
    this.#assertModel();
    SERVICES.add(this);
    Object.freeze(this);
  }

  generate(value: OwnerWan27VideoEditGenerateInput | unknown, signalInput?: AbortSignal): Promise<OwnerWan27VideoEditGenerationResult> {
    this.#assertOpen();
    const request = snapshotGenerate(value), signal = exactSignal(signalInput);
    if (this.#invalidating.has(request.attemptId)) return Promise.reject(err("PRINCIPAL_NOT_LINKED"));
    return this.#run(request.attemptId, signal, (runSignal, epoch) => this.#generate(request, runSignal, epoch));
  }

  reconcile(value: OwnerWan27VideoEditReconcileInput | unknown, signalInput?: AbortSignal): Promise<OwnerWan27VideoEditGenerationResult> {
    this.#assertOpen();
    const request = snapshotRecovery(value), signal = exactSignal(signalInput);
    if (this.#invalidating.has(request.attemptId)) return Promise.reject(err("RECOVERY_NOT_FOUND"));
    return this.#run(request.attemptId, signal, async (runSignal, epoch) => {
      const principal = await this.#principal(request.attemptId, runSignal);
      const recovery = this.#owned(request.attemptId, request.recovery_id, principal);
      if (recovery.epoch !== epoch) fail("RECOVERY_NOT_FOUND");
      await this.#checkCurrent(request.attemptId, recovery.principal, recovery.client, runSignal, epoch);
      if (recovery.status === "completed") return page(recovery, 0);
      const deadline = new AbsoluteRequestDeadline(REQUEST_TIMEOUT_MS, runSignal, () => unknown(recovery));
      try {
        await this.#checkCurrent(request.attemptId, recovery.principal, recovery.client, deadline.signal, epoch);
        return await this.#observe(recovery, deadline);
      } catch (error) {
        if (error instanceof OwnerWan27VideoEditGenerationServiceError && error.code === "RECOVERY_NOT_FOUND") throw error;
        throw unknown(recovery);
      } finally { deadline.close(); }
    });
  }

  listRecoveries(value: OwnerWan27VideoEditRecoveryListInput | unknown): Promise<readonly OwnerWan27VideoEditRecoveryListItem[]> {
    this.#assertOpen();
    const request = snapshotList(value);
    if (this.#invalidating.has(request.attemptId)) return Promise.reject(err("PRINCIPAL_NOT_LINKED"));
    return this.#run(request.attemptId, undefined, async (signal, epoch) => {
      const principal = await this.#principal(request.attemptId, signal), client = this.#client(request.attemptId);
      await this.#checkCurrent(request.attemptId, principal, client, signal, epoch);
      return Object.freeze([...this.#recoveries.values()].filter((r) => r.attemptId === request.attemptId && r.epoch === epoch &&
        sameGenerationPrincipal(r.principal, principal) && r.client === client).slice(0, request.limit).map(recoveryItem));
    });
  }

  getResultPage(value: OwnerWan27VideoEditResultPageInput | unknown): Promise<OwnerWan27VideoEditGenerationResult> {
    this.#assertOpen();
    const request = snapshotPage(value);
    if (this.#invalidating.has(request.attemptId)) return Promise.reject(err("RECOVERY_NOT_FOUND"));
    return this.#run(request.attemptId, undefined, async (signal, epoch) => {
      const principal = await this.#principal(request.attemptId, signal);
      const recovery = this.#owned(request.attemptId, request.recovery_id, principal);
      if (recovery.epoch !== epoch) fail("RECOVERY_NOT_FOUND");
      await this.#checkCurrent(request.attemptId, recovery.principal, recovery.client, signal, epoch);
      if (recovery.status !== "completed") throw unknown(recovery);
      if (request.offset > recovery.artifacts.size) fail("INVALID_REQUEST");
      return page(recovery, request.offset);
    });
  }

  invalidateAttempt(value: unknown): Promise<void> {
    if (this.#closed || !SERVICES.has(this)) return Promise.reject(err("SERVICE_CLOSED"));
    const attemptId = readAttempt(value), previous = this.#invalidations.get(attemptId);
    if (previous) return previous;
    if (this.#invalidations.size >= RECOVERY_LIMIT) return Promise.reject(err("CAPACITY_EXCEEDED"));
    this.#invalidating.add(attemptId);
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    const runs = [...this.#runs].filter((run) => run.attemptId === attemptId);
    for (const run of runs) run.controller.abort();
    let dependency: Promise<void>;
    try { dependency = Promise.resolve(Reflect.apply(PREPARER_INVALIDATE, this.#preparer, [attemptId])); }
    catch (error) { dependency = Promise.reject(error); }
    const pending = Promise.allSettled([dependency, ...runs.map((run) => run.promise)]).then((results) => {
      this.#invalidating.delete(attemptId);
      this.#invalidations.delete(attemptId);
      this.#clients.delete(attemptId);
      this.#epochs.delete(attemptId);
      for (const [id, recovery] of this.#recoveries) if (recovery.attemptId === attemptId) this.#recoveries.delete(id);
      if (results[0]?.status === "rejected") throw err("SERVICE_BUSY");
    });
    this.#invalidations.set(attemptId, pending);
    return pending;
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    const attempts = new Set([...this.#runs].map((run) => run.attemptId));
    for (const attemptId of attempts) { this.#invalidating.add(attemptId); this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1); }
    for (const run of this.#runs) run.controller.abort();
    const dependencies = [...attempts].map((attemptId) => {
      try { return Promise.resolve(Reflect.apply(PREPARER_INVALIDATE, this.#preparer, [attemptId])); }
      catch { return Promise.resolve(); }
    });
    this.#closing = Promise.allSettled([...dependencies, ...this.#invalidations.values(), ...[...this.#runs].map((run) => run.promise)]).then(() => {
      this.#recoveries.clear(); this.#reserved.clear(); this.#claimed.clear(); this.#runs.clear(); this.#clients.clear();
      this.#epochs.clear(); this.#invalidating.clear(); this.#invalidations.clear();
    });
    return this.#closing;
  }

  async #generate(request: OwnerWan27VideoEditGenerateInput, signal: AbortSignal, epoch: number): Promise<OwnerWan27VideoEditGenerationResult> {
    const deadline = new AbsoluteRequestDeadline(REQUEST_TIMEOUT_MS, signal, () => err("PRE_DISPATCH_FAILED"));
    let candidate: OwnerWan27VideoEditPreparedCandidate | undefined;
    let permit: OwnerWan27VideoEditOneShotPermit | undefined;
    let binding: Readonly<OwnerWan27VideoEditCandidateBinding> | undefined;
    let principal: Readonly<GenerationPrincipalRef> | undefined;
    let client: SyntxChatHttpClient | undefined;
    let intentKey: string | undefined;
    let reserved = false;
    let recovery: Recovery | undefined;
    let postStarted = false;
    const release = () => { if (intentKey && reserved) { this.#reserved.delete(intentKey); reserved = false; } };

    try {
      deadline.throwIfAborted();
      this.#assertModel();
      principal = await this.#principal(request.attemptId, deadline.signal);
      client = this.#client(request.attemptId);
      await this.#checkCurrent(request.attemptId, principal, client, deadline.signal, epoch);
      candidate = await this.#await(deadline, () => Reflect.apply(PREPARER_PREPARE, this.#preparer,
        [request, deadline.signal]) as Promise<OwnerWan27VideoEditPreparedCandidate>);
      await this.#checkCurrent(request.attemptId, principal, client, deadline.signal, epoch);
      binding = this.#candidateBinding(candidate, request, principal);
      intentKey = semanticIntentKey(principal, binding.intent_fingerprint);
      if (this.#claimed.has(intentKey) || this.#reserved.has(intentKey)) fail("INTENT_ALREADY_CLAIMED");
      if (this.#recoveries.size + this.#reserved.size >= RECOVERY_LIMIT || this.#claimed.size >= 8192) fail("CAPACITY_EXCEEDED");
      this.#reserved.add(intentKey); reserved = true;
      permit = await createOwnerWan27VideoEditOneShotPermit({ preparer: this.#preparer, candidate, principal,
        attemptId: request.attemptId });
      await this.#checkCurrent(request.attemptId, principal, client, deadline.signal, epoch);
      await this.#preflight(request, principal, client, candidate, binding, deadline, epoch);
      await this.#checkCandidate(request, principal, client, candidate, binding, permit, deadline.signal, epoch);
      const nativeInput = nativeInputFor(this.#preparer, this.#referenceService, candidate, permit, principal,
        request.attemptId, this.#links, this.#binding);
      let chat: NativeChat;
      try { chat = await this.#await(deadline, () => Reflect.apply(MODEL_CREATE, client!, [nativeInput, deadline.signal]) as Promise<NativeChat>); }
      catch { fail("PRE_DISPATCH_FAILED"); }
      await this.#checkCurrent(request.attemptId, principal, client, deadline.signal, epoch);
      this.#assertChat(chat!, request, binding);
      await this.#preflight(request, principal, client, candidate, binding, deadline, epoch);
      await this.#checkCandidate(request, principal, client, candidate, binding, permit, deadline.signal, epoch);
      const current = Reflect.apply(PREPARER_INSPECT, this.#preparer, [candidate]) as OwnerWan27VideoEditCandidateBinding | undefined;
      if (!current || schemaHash(current) !== schemaHash(binding)) fail("PRE_DISPATCH_FAILED");
      if (this.#recoveries.size >= RECOVERY_LIMIT) fail("CAPACITY_EXCEEDED");
      recovery = this.#newRecovery(request.attemptId, principal, intentKey, candidate, permit, chat!, client, binding, epoch);
      this.#recoveries.set(recovery.recovery_id, recovery);
      recovery.d.phase = "GENERATION_POST"; recovery.d.post_started = true; postStarted = true;
      let acknowledgment: Readonly<{ chat_uuid: string; message_id: string }>;
      try {
        acknowledgment = await this.#await(deadline, () => Reflect.apply(MODEL_START, client!,
          [Object.freeze({ ...nativeInput, chat: chat! }), deadline.signal]) as Promise<Readonly<{ chat_uuid: string; message_id: string }>>);
      } catch {
        const dispatch = readOwnerWan27VideoEditNativeDispatchStatus(client, chat!);
        if (dispatch && !dispatch.dispatch_attempted) {
          this.#recoveries.delete(recovery.recovery_id); recovery = undefined; postStarted = false; release(); fail("PRE_DISPATCH_FAILED");
        }
        this.#claimed.add(intentKey); release(); throw unknown(recovery);
      }
      const dispatch = readOwnerWan27VideoEditNativeDispatchStatus(client, chat!);
      if (!acknowledgment || acknowledgment.chat_uuid !== chat!.chat_uuid || !safeId(acknowledgment.message_id) ||
          !dispatch?.dispatch_attempted || !dispatch.owner_ack_bound || dispatch.owner_echo_message_id !== acknowledgment.message_id ||
          dispatch.chat_uuid !== chat!.chat_uuid || dispatch.attempt_id !== request.attemptId || dispatch.model_id !== MODEL_ID) {
        if (dispatch && !dispatch.dispatch_attempted) {
          this.#recoveries.delete(recovery.recovery_id); recovery = undefined; postStarted = false; release(); fail("PRE_DISPATCH_FAILED");
        }
        this.#claimed.add(intentKey); release(); throw unknown(recovery);
      }
      this.#claimed.add(intentKey); release();
      await this.#checkCurrent(request.attemptId, principal, client, deadline.signal, epoch);
      recovery.owner_echo_message_id = acknowledgment.message_id; recovery.d.ack_known = true;
      recovery.d.owner_ack_status = "MATCHED"; recovery.d.phase = "POST_ACK_KNOWN";
      return await this.#observe(recovery, deadline);
    } catch (error) {
      if (postStarted && recovery) {
        const dispatch = client && recovery.chat ? readOwnerWan27VideoEditNativeDispatchStatus(client, recovery.chat) : null;
        if (!dispatch || dispatch.dispatch_attempted) {
          if (intentKey) this.#claimed.add(intentKey);
          release();
          if (dispatch?.owner_ack_bound && dispatch.owner_echo_message_id) {
            recovery.owner_echo_message_id = dispatch.owner_echo_message_id;
            recovery.d.ack_known = true; recovery.d.owner_ack_status = "MATCHED"; recovery.d.phase = "POST_ACK_KNOWN";
          }
          throw unknown(recovery);
        }
        this.#recoveries.delete(recovery.recovery_id);
      }
      release();
      if (error instanceof OwnerWan27VideoEditGenerationServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      if (error instanceof OwnerWan27VideoEditOneShotPolicyError && error.code === "INTENT_ALREADY_CLAIMED") fail("INTENT_ALREADY_CLAIMED");
      return fail("PRE_DISPATCH_FAILED");
    } finally { release(); deadline.close(); }
  }

  async #preflight(request: OwnerWan27VideoEditGenerateInput, principal: Readonly<GenerationPrincipalRef>, client: SyntxChatHttpClient,
    candidate: OwnerWan27VideoEditPreparedCandidate, binding: Readonly<OwnerWan27VideoEditCandidateBinding>,
    deadline: AbsoluteRequestDeadline, epoch: number): Promise<void> {
    deadline.throwIfAborted();
    const current = Reflect.apply(PREPARER_INSPECT, this.#preparer, [candidate]) as OwnerWan27VideoEditCandidateBinding | undefined;
    if (!current || schemaHash(current) !== schemaHash(binding) || binding.attempt_id !== request.attemptId ||
        binding.model_id !== MODEL_ID || binding.profile_sha256 !== getOwnerWan27VideoEditSourceProfile().source_sha256 ||
        !sameGenerationPrincipal(binding.principal, principal) || binding.expires_at <= this.#readNow() ||
        (this.#epochs.get(request.attemptId) ?? 0) !== epoch) fail("PREFLIGHT_FAILED");
    this.#assertModel(); this.#assertCatalogModel();

    let subscription: Readonly<SyntxSubscription>;
    try {
      await this.#checkCurrent(request.attemptId, principal, client, deadline.signal, epoch);
      const raw = await this.#await(deadline, () => Reflect.apply(this.#resolveSubscription, undefined,
        [request.attemptId, deadline.signal]) as Promise<SyntxSubscription>);
      await this.#checkCurrent(request.attemptId, principal, client, deadline.signal, epoch);
      subscription = snapshotSubscription(raw);
    } catch { fail("SUBSCRIPTION_STATUS_UNVERIFIED"); }
    if (subscription!.active === false || (subscription!.plan_type !== null && subscription!.plan_type.trim().toUpperCase() === "FREE")) {
      fail("SUBSCRIPTION_REQUIRED");
    }
    if (subscription!.active !== true || typeof subscription!.plan_type !== "string" || !subscription!.plan_type.trim()) {
      fail("SUBSCRIPTION_STATUS_UNVERIFIED");
    }

    let account: AccountStatusService, access: ModelAccessService;
    try {
      account = Reflect.apply(this.#createAccount, undefined, [request.attemptId]) as AccountStatusService;
      access = Reflect.apply(this.#createAccess, undefined, [request.attemptId]) as ModelAccessService;
    } catch { fail("PREFLIGHT_FAILED"); }
    if (!genuineAccount(account!) || this.#usedAccounts.has(account!) || !genuineAccess(access!) || this.#usedAccess.has(access!)) {
      fail("PREFLIGHT_FAILED");
    }
    this.#usedAccounts.add(account!); this.#usedAccess.add(access!);
    const costParameters = snapshotCostParameters(binding.cost_parameters, request, binding.sources);
    const resolveAccountStatus = async (_attempt: string, signal?: AbortSignal): Promise<AccountStatusResult> => {
      await this.#checkCurrent(request.attemptId, principal, client, signal, epoch);
      let value: AccountStatusResult;
      try { value = await Reflect.apply(ACCOUNT_GET, account!, [signal]) as AccountStatusResult; } catch { fail("PREFLIGHT_FAILED"); }
      await this.#checkCurrent(request.attemptId, principal, client, signal, epoch);
      return value!;
    };
    const resolveModelAccess = async (_attempt: string, model: string, parameters: Readonly<Record<string, SyntxCostParameter>>,
      signal?: AbortSignal): Promise<ModelAccessResult> => {
      await this.#checkCurrent(request.attemptId, principal, client, signal, epoch);
      let value: ModelAccessResult;
      try { value = await Reflect.apply(ACCESS_GET, access!, [{ model_id: model, cost_parameters: parameters }, signal]) as ModelAccessResult; }
      catch { fail("PREFLIGHT_FAILED"); }
      await this.#checkCurrent(request.attemptId, principal, client, signal, epoch);
      return value!;
    };
    const resolver = createOwnerWan27VideoEditBudgetedModelAccessResolver({ catalog: this.#catalog,
      resolveAccountStatus, resolveModelAccess, now: this.#now });
    let result: ModelAccessResult;
    try { result = await this.#await(deadline, () => resolver(request.attemptId, MODEL_ID, costParameters, deadline.signal)); }
    catch { fail("PREFLIGHT_FAILED"); }
    await this.#checkCurrent(request.attemptId, principal, client, deadline.signal, epoch);
    if (result!.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || result!.catalog_version !== this.#modelAccessVersion() ||
        result!.model_id !== MODEL_ID || result!.ai_name !== AI_NAME || result!.model_type !== MODEL_ID ||
        result!.account_read_live !== true || result!.parameters_redacted !== true || result!.access !== true ||
        !sameStrings(result!.parameter_keys, Object.keys(costParameters).sort()) || !finite(result!.discount_cost ?? result!.cost) ||
        !fresh(result!.observed_at, this.#readNow()) || binding.expires_at <= this.#readNow()) fail("PREFLIGHT_FAILED");
  }

  async #checkCandidate(request: OwnerWan27VideoEditGenerateInput, principal: Readonly<GenerationPrincipalRef>, client: SyntxChatHttpClient,
    candidate: OwnerWan27VideoEditPreparedCandidate, binding: Readonly<OwnerWan27VideoEditCandidateBinding>,
    permit: OwnerWan27VideoEditOneShotPermit, signal: AbortSignal, epoch: number): Promise<void> {
    await this.#checkCurrent(request.attemptId, principal, client, signal, epoch);
    const current = await Reflect.apply(PREPARER_REVALIDATE, this.#preparer, [candidate, signal]) as OwnerWan27VideoEditCandidateBinding;
    if (schemaHash(current) !== schemaHash(binding)) fail("PRE_DISPATCH_FAILED");
    await revalidateOwnerWan27VideoEditOneShotPermit({ preparer: this.#preparer, candidate, permit,
      principal, attemptId: request.attemptId });
    await this.#checkCurrent(request.attemptId, principal, client, signal, epoch);
  }

  async #observe(recovery: Recovery, deadline: AbsoluteRequestDeadline): Promise<OwnerWan27VideoEditGenerationResult> {
    await this.#checkCurrent(recovery.attemptId, recovery.principal, recovery.client, deadline.signal, recovery.epoch);
    recovery.d.phase = "HISTORY_GET";
    let history: NativeHistory;
    try {
      history = await this.#await(deadline, () => Reflect.apply(MODEL_LIST, recovery.client,
        [nativeInputFor(this.#preparer, this.#referenceService, recovery.candidate, recovery.permit, recovery.principal,
          recovery.attemptId, this.#links, this.#binding, recovery.chat), deadline.signal]) as Promise<NativeHistory>);
    } catch { recovery.d.history_status = "UNVERIFIED"; recovery.d.gaps = ["HISTORY_GET_UNAVAILABLE"]; throw unknown(recovery); }
    await this.#checkCurrent(recovery.attemptId, recovery.principal, recovery.client, deadline.signal, recovery.epoch);
    recovery.d.history_get_calls += history.history_get_calls;
    recovery.d.owner_ack_status = history.owner_ack_status;
    recovery.d.request_echo_status = history.request_echo_status;
    if (history.status === "PENDING" && history.owner_ack_status === "MATCHED" &&
        history.history_binding_status === "BOUND" && history.owner_echo_message_id === recovery.owner_echo_message_id) {
      recovery.d.history_status = "PENDING";
      recovery.d.gaps = safeGaps(history.gaps);
      throw unknown(recovery);
    }
    if (history.status !== "COMPLETE" || history.owner_ack_status !== "MATCHED" || history.history_binding_status !== "BOUND" ||
        history.history_page_status !== "COMPLETE" || history.owner_echo_message_id !== recovery.owner_echo_message_id ||
        history.request_echo_status === "CONTRADICTORY" || history.contexts.length < 1 || history.contexts.length > 64) {
      recovery.d.history_status = history.status === "PENDING" ? "PENDING" : history.status === "UNVERIFIED" ||
        history.history_page_status === "UNPROVEN" ? "UNVERIFIED" : "INCOMPLETE";
      recovery.d.gaps = safeGaps(history.gaps);
      throw unknown(recovery);
    }
    recovery.d.history_status = "COMPLETE";
    for (const context of history.contexts) {
      if (!validNativeContext(context, recovery)) {
        recovery.d.result_status = "UNVERIFIED"; recovery.d.gaps = ["RESULT_CONTEXT_UNBOUND"]; throw unknown(recovery);
      }
      await this.#checkCurrent(recovery.attemptId, recovery.principal, recovery.client, deadline.signal, recovery.epoch);
      recovery.d.phase = "RESULT_GET";
      recovery.d.result_get_calls += 1;
      let result: NativeResult;
      try {
        result = await this.#await(deadline, () => Reflect.apply(MODEL_GET, recovery.client, [Object.freeze({
          result_context: context, principal: recovery.principal, attemptId: recovery.attemptId,
          linkService: this.#links, binding: this.#binding
        }), deadline.signal]) as Promise<NativeResult>);
      } catch { recovery.d.result_status = "UNVERIFIED"; recovery.d.gaps = ["RESULT_GET_UNAVAILABLE"]; throw unknown(recovery); }
      await this.#checkCurrent(recovery.attemptId, recovery.principal, recovery.client, deadline.signal, recovery.epoch);
      if (result.message_binding !== "BOUND" || result.model_echo !== "MATCHED" || result.gaps.length || !result.artifacts.length) {
        recovery.d.result_status = "UNVERIFIED";
        recovery.d.gaps = safeGaps(result.gaps.length ? result.gaps : ["RESULT_NOT_VERIFIED"]);
        throw unknown(recovery);
      }
      for (const artifact of result.artifacts) {
        if (!validArtifact(artifact, context)) { recovery.d.result_status = "UNVERIFIED"; recovery.d.gaps = ["RESULT_ARTIFACT_INVALID"]; throw unknown(recovery); }
        const key = `${context.message_id}:${artifact.message_object_id}`;
        const previousArtifact = recovery.artifacts.get(key);
        if (previousArtifact && !sameArtifact(previousArtifact, artifact)) {
          recovery.d.result_status = "UNVERIFIED"; recovery.d.gaps = ["RESULT_ARTIFACT_CONTRADICTION"]; throw unknown(recovery);
        }
        const previousUrl = recovery.objectUrls.get(artifact.message_object_id);
        if (previousUrl !== undefined && previousUrl !== artifact.object_url) {
          recovery.d.result_status = "UNVERIFIED"; recovery.d.gaps = ["RESULT_OBJECT_URL_CONTRADICTION"]; throw unknown(recovery);
        }
        if (recovery.artifacts.size >= MAX_RESULTS) { recovery.d.result_status = "UNVERIFIED"; recovery.d.gaps = ["RESULT_LIMIT_EXCEEDED"]; throw unknown(recovery); }
        recovery.objectUrls.set(artifact.message_object_id, artifact.object_url);
        recovery.artifacts.set(key, Object.freeze({ ...artifact, message_id: context.message_id,
          chat_uuid: context.chat_uuid, model_id: MODEL_ID }));
      }
    }
    if (recovery.artifacts.size === 0) { recovery.d.result_status = "UNVERIFIED"; recovery.d.gaps = ["RESULT_NOT_OBSERVED"]; throw unknown(recovery); }
    recovery.d.phase = "RESULT_GET"; recovery.d.result_status = "COMPLETE"; recovery.d.gaps = [];
    recovery.status = "completed";
    return page(recovery, 0);
  }

  #candidateBinding(candidate: unknown, request: OwnerWan27VideoEditGenerateInput,
    principal: Readonly<GenerationPrincipalRef>): Readonly<OwnerWan27VideoEditCandidateBinding> {
    if (!isOwnerWan27VideoEditPreparedCandidate(candidate)) fail("PRE_DISPATCH_FAILED");
    const binding = Reflect.apply(PREPARER_INSPECT, this.#preparer, [candidate]) as OwnerWan27VideoEditCandidateBinding | undefined;
    if (!binding || binding.attempt_id !== request.attemptId || binding.model_id !== MODEL_ID ||
        binding.profile_sha256 !== getOwnerWan27VideoEditSourceProfile().source_sha256 ||
        !sameGenerationPrincipal(binding.principal, principal) || binding.expires_at <= this.#readNow() ||
        !/^sha256:[a-f0-9]{64}$/u.test(binding.request_fingerprint) || !/^sha256:[a-f0-9]{64}$/u.test(binding.intent_fingerprint) ||
        candidate.status !== "blocked" || candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" ||
        candidate.request_fingerprint !== binding.request_fingerprint || candidate.intent_fingerprint !== binding.intent_fingerprint ||
        candidate.profile_sha256 !== binding.profile_sha256 || candidate.expires_at !== binding.expires_at ||
        schemaHash(candidate.sources) !== schemaHash(binding.sources) || binding.sources.length !== request.reference_handles.length ||
        binding.sources.some((source, index) => source.reference_handle !== request.reference_handles[index])) fail("PRE_DISPATCH_FAILED");
    return binding;
  }

  #assertChat(chat: NativeChat, request: OwnerWan27VideoEditGenerateInput,
    binding: Readonly<OwnerWan27VideoEditCandidateBinding>): void {
    if (!chat || chat.status !== "created" || !safeId(chat.chat_uuid) || chat.attempt_id !== request.attemptId ||
        chat.model_id !== MODEL_ID || chat.profile_sha256 !== binding.profile_sha256 ||
        chat.request_fingerprint !== binding.request_fingerprint || chat.intent_fingerprint !== binding.intent_fingerprint ||
        schemaHash(chat.sources) !== schemaHash(binding.sources) || chat.dispatch_allowed !== false || chat.backend_acceptance !== "UNPROVEN") {
      fail("PRE_DISPATCH_FAILED");
    }
  }

  #assertModel(): void {
    const profile = getOwnerWan27VideoEditSourceProfile();
    if (profile.model_id !== MODEL_ID || profile.ai_name !== AI_NAME || profile.source_pins.public_catalog_version !== this.#catalogVersion ||
        profile.runtime_usable !== false || profile.dispatch_allowed !== false || profile.backend_acceptance !== "UNPROVEN" ||
        this.#catalog.source_hashes.models !== profile.source_pins.public_models_sha256) fail("MODEL_BINDING_MISMATCH");
    this.#assertCatalogModel();
  }

  #assertCatalogModel(): void {
    try {
      const record = this.#catalog.getModel(MODEL_ID), profile = getOwnerWan27VideoEditSourceProfile();
      const keys = ["duration", "resolution", "video_duration"];
      if (this.#catalog.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || this.#catalog.runtime_usable !== false ||
          record.id !== MODEL_ID || record.upstream_id !== MODEL_ID || record.ai_name !== AI_NAME || record.scope !== "video" ||
          record.active !== true || !record.settings || !keys.every((key) => record.settings!.get_cost_params?.includes(key)) ||
          !record.operations?.some((operation) => operation.id === "generate-video" && operation.output_modality === "video") ||
          profile.source_sha256.length !== 71) fail("MODEL_BINDING_MISMATCH");
    } catch { fail("MODEL_BINDING_MISMATCH"); }
  }

  #modelAccessVersion(): string { return `${this.#catalog.fetched_at}.${this.#catalog.source_hashes.models.slice(7, 19)}`; }

  #client(attemptId: string): SyntxChatHttpClient {
    let value: unknown;
    try { value = Reflect.apply(this.#resolveClient, undefined, [attemptId]); } catch { fail("PRINCIPAL_NOT_LINKED"); }
    if (!nativeClient(value)) fail("MODEL_BINDING_MISMATCH");
    const previous = this.#clients.get(attemptId);
    if (previous && previous !== value) fail("PRINCIPAL_NOT_LINKED");
    if (!previous && this.#clients.size >= RECOVERY_LIMIT) fail("CAPACITY_EXCEEDED");
    this.#clients.set(attemptId, value as SyntxChatHttpClient);
    return value as SyntxChatHttpClient;
  }

  async #principal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    signal?.throwIfAborted();
    if (!ATTEMPT.test(attemptId)) fail("INVALID_REQUEST");
    try {
      const principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#links });
      if (principal.connection_id !== attemptId || principal.tenant_id !== this.#binding.tenant_id || principal.subject_id !== this.#binding.subject) {
        fail("PRINCIPAL_NOT_LINKED");
      }
      signal?.throwIfAborted();
      return principal;
    } catch (error) {
      if (error instanceof OwnerWan27VideoEditGenerationServiceError) throw error;
      fail("PRINCIPAL_NOT_LINKED");
    }
  }

  async #checkCurrent(attemptId: string, principal: Readonly<GenerationPrincipalRef>, client: SyntxChatHttpClient,
    signal?: AbortSignal, epoch?: number): Promise<void> {
    const latest = await this.#principal(attemptId, signal);
    if (this.#invalidating.has(attemptId) || (epoch !== undefined && (this.#epochs.get(attemptId) ?? 0) !== epoch) ||
        !sameGenerationPrincipal(latest, principal) || this.#client(attemptId) !== client) fail("PRINCIPAL_NOT_LINKED");
  }

  #newRecovery(attemptId: string, principal: Readonly<GenerationPrincipalRef>, intentKey: string,
    candidate: OwnerWan27VideoEditPreparedCandidate, permit: OwnerWan27VideoEditOneShotPermit, chat: NativeChat,
    client: SyntxChatHttpClient, binding: Readonly<OwnerWan27VideoEditCandidateBinding>, epoch: number): Recovery {
    const now = this.#readNow();
    return { recovery_id: `wan27_videoedit_recovery_${randomUUID()}`, attemptId, intentKey, principal,
      created_at: new Date(now).toISOString(), candidate, permit, chat, client, binding, epoch,
      owner_echo_message_id: null, status: "outcome_unknown", artifacts: new Map(), objectUrls: new Map(),
      d: { phase: "CHAT_CREATE", post_started: false, ack_known: false, history_status: "NOT_READ", owner_ack_status: "NOT_READ",
        request_echo_status: "NOT_READ", history_get_calls: 0, result_get_calls: 0, result_status: "NOT_READ", gaps: [] } };
  }

  #owned(attemptId: string, recoveryId: string, principal: Readonly<GenerationPrincipalRef>): Recovery {
    const recovery = this.#recoveries.get(recoveryId);
    if (!recovery || recovery.recovery_id !== recoveryId || recovery.attemptId !== attemptId || this.#invalidating.has(attemptId) ||
        !sameGenerationPrincipal(recovery.principal, principal) || recovery.epoch !== (this.#epochs.get(attemptId) ?? 0) ||
        this.#client(attemptId) !== recovery.client) fail("RECOVERY_NOT_FOUND");
    return recovery;
  }

  #await<T>(deadline: AbsoluteRequestDeadline, operation: () => Promise<T>): Promise<T> {
    deadline.throwIfAborted();
    return deadline.waitFor(operation());
  }

  #run<T>(attemptId: string, parent: AbortSignal | undefined, operation: (signal: AbortSignal, epoch: number) => Promise<T>): Promise<T> {
    if (this.#closed || !SERVICES.has(this)) return Promise.reject(err("SERVICE_CLOSED"));
    if (this.#invalidating.has(attemptId) || this.#runs.size >= RUN_LIMIT) return Promise.reject(err("SERVICE_BUSY"));
    const controller = new AbortController(), abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    const epoch = this.#epochs.get(attemptId) ?? 0;
    const run: Run = { attemptId, controller, promise: Promise.resolve() };
    run.promise = Promise.resolve().then(() => {
      if (controller.signal.aborted) fail("SERVICE_BUSY");
      return operation(controller.signal, epoch);
    }).finally(() => { parent?.removeEventListener("abort", abort); this.#runs.delete(run); });
    this.#runs.add(run);
    return run.promise as Promise<T>;
  }

  #readNow(): number {
    let value: unknown;
    try { value = Reflect.apply(this.#now, undefined, []); } catch { fail("SERVICE_BUSY"); }
    if (!Number.isSafeInteger(value) || (value as number) < this.#lastNow || (value as number) < 0) fail("SERVICE_BUSY");
    this.#lastNow = value as number;
    return this.#lastNow;
  }

  #assertOpen(): void { if (this.#closed || !SERVICES.has(this)) fail("SERVICE_CLOSED"); }
}

Object.freeze(OwnerWan27VideoEditGenerationService.prototype);

export function isOwnerWan27VideoEditGenerationService(value: unknown): value is OwnerWan27VideoEditGenerationService {
  return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) &&
    Object.getPrototypeOf(value) === OwnerWan27VideoEditGenerationService.prototype && Object.isFrozen(value);
}

function snapshotGenerate(value: unknown): OwnerWan27VideoEditGenerateInput {
  const row = exact(value, ["attemptId", "model_id", "prompt", "resolution", "aspect_ratio", "audio_setting", "prompt_extend",
    "seed", "duration_mode", "reference_handles"], ["custom_video_duration"]);
  const attemptId = readAttempt(row.attemptId);
  if (row.model_id !== MODEL_ID || typeof row.prompt !== "string" || row.prompt.trim().length === 0 || row.prompt.length > 1500 ||
      !wellFormedUnicode(row.prompt) || !["720P", "1080P"].includes(String(row.resolution)) ||
      !["16:9", "9:16", "1:1", "4:3", "3:4"].includes(String(row.aspect_ratio)) ||
      !["auto", "origin"].includes(String(row.audio_setting)) || typeof row.prompt_extend !== "boolean" ||
      !(row.seed === null || Number.isSafeInteger(row.seed) && (row.seed as number) >= 0 && (row.seed as number) <= 2_147_483_647) ||
      !["preserve_input", "custom"].includes(String(row.duration_mode)) || !Array.isArray(row.reference_handles) ||
      types.isProxy(row.reference_handles) || Object.getPrototypeOf(row.reference_handles) !== Array.prototype) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(row.reference_handles);
  const length = Object.getOwnPropertyDescriptor(row.reference_handles, "length")?.value;
  if (!Number.isSafeInteger(length) || length < 1 || length > 5 || Reflect.ownKeys(descriptors).length !== length + 1) invalid();
  const handles: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "string" ||
        !/^wan27_videoedit_reference_[0-9a-f-]{36}$/u.test(descriptor.value)) invalid();
    handles.push(descriptor.value);
  }
  if (new Set(handles).size !== handles.length) invalid();
  const durationMode = row.duration_mode as OwnerWan27VideoEditGenerateInput["duration_mode"];
  const customDuration = row.custom_video_duration;
  if (durationMode === "preserve_input" ? Object.hasOwn(row, "custom_video_duration") :
      !Object.hasOwn(row, "custom_video_duration") || !Number.isSafeInteger(customDuration) ||
      (customDuration as number) < 2 || (customDuration as number) > 10) invalid();
  return Object.freeze({ attemptId, model_id: MODEL_ID, prompt: row.prompt,
    resolution: row.resolution as OwnerWan27VideoEditGenerateInput["resolution"],
    aspect_ratio: row.aspect_ratio as OwnerWan27VideoEditGenerateInput["aspect_ratio"],
    audio_setting: row.audio_setting as OwnerWan27VideoEditGenerateInput["audio_setting"],
    prompt_extend: row.prompt_extend, seed: row.seed as number | null, duration_mode: durationMode,
    reference_handles: Object.freeze(handles),
    ...(durationMode === "custom" ? { custom_video_duration: customDuration as number } : {}) });
}

function snapshotRecovery(value: unknown): OwnerWan27VideoEditReconcileInput {
  const row = exact(value, ["attemptId", "recovery_id"]);
  if (typeof row.recovery_id !== "string" || !RECOVERY.test(row.recovery_id)) invalid();
  return Object.freeze({ attemptId: readAttempt(row.attemptId), recovery_id: row.recovery_id });
}
function snapshotList(value: unknown): Readonly<{ attemptId: string; limit: number }> {
  const row = exact(value, ["attemptId"], ["limit"]);
  return Object.freeze({ attemptId: readAttempt(row.attemptId), limit: bounded(row.limit, 1, RECOVERY_LIMIT, 20) });
}
function snapshotPage(value: unknown): Readonly<{ attemptId: string; recovery_id: string; offset: number }> {
  const row = exact(value, ["attemptId", "recovery_id"], ["offset"]);
  if (typeof row.recovery_id !== "string" || !RECOVERY.test(row.recovery_id)) invalid();
  return Object.freeze({ attemptId: readAttempt(row.attemptId), recovery_id: row.recovery_id,
    offset: bounded(row.offset, 0, MAX_RESULTS, 0) });
}

function snapshotSubscription(value: unknown): Readonly<SyntxSubscription> {
  const row = exact(value, ["active", "plan_type", "end_date", "end_date_kind"]);
  if (!(row.active === true || row.active === false || row.active === null) ||
      !(row.plan_type === null || typeof row.plan_type === "string") || !(row.end_date === null || typeof row.end_date === "string") ||
      !(row.end_date_kind === null || ["DATE_ONLY", "LOCAL_DATETIME", "OFFSET_DATETIME"].includes(String(row.end_date_kind)))) {
    fail("SUBSCRIPTION_STATUS_UNVERIFIED");
  }
  return Object.freeze({ active: row.active as boolean | null, plan_type: row.plan_type as string | null,
    end_date: row.end_date as string | null, end_date_kind: row.end_date_kind as SyntxSubscription["end_date_kind"] });
}

function snapshotCostParameters(value: unknown, request: OwnerWan27VideoEditGenerateInput,
  sources: readonly OwnerWan27VideoEditCandidateBinding["sources"][number][]): Readonly<Record<string, SyntxCostParameter>> {
  const row = exact(value, ["duration", "resolution", "video_duration"]);
  const video = sources.find((source) => source.kind === "video");
  if (!video || video.duration_seconds === null || !Number.isFinite(video.duration_seconds)) fail("PREFLIGHT_FAILED");
  const sourceDuration = video.duration_seconds;
  const expectedDuration = round2(sourceDuration);
  const expectedVideoDuration = request.duration_mode === "preserve_input" ? expectedDuration : request.custom_video_duration;
  if (row.resolution !== request.resolution || row.resolution !== "720P" && row.resolution !== "1080P" ||
      typeof row.duration !== "number" || !Number.isFinite(row.duration) || row.duration !== expectedDuration ||
      typeof row.video_duration !== "number" || !Number.isFinite(row.video_duration) ||
      row.video_duration !== expectedVideoDuration || row.video_duration < 2 || row.video_duration > 10) fail("PREFLIGHT_FAILED");
  return Object.freeze({ duration: row.duration, resolution: row.resolution, video_duration: row.video_duration });
}

function validNativeContext(context: NativeResultContext, recovery: Recovery): boolean {
  return !!context && context.chat_uuid === recovery.chat.chat_uuid && context.attempt_id === recovery.attemptId &&
    context.model_id === MODEL_ID && context.profile_sha256 === recovery.binding.profile_sha256 &&
    context.request_fingerprint === recovery.binding.request_fingerprint && context.intent_fingerprint === recovery.binding.intent_fingerprint &&
    context.owner_echo_message_id === recovery.owner_echo_message_id && safeId(context.message_id) &&
    /^\d{1,16}$/u.test(context.provider_chat_id) && Array.isArray(context.message_object_ids) &&
    context.message_object_ids.length > 0 && context.message_object_ids.length <= 64 &&
    new Set(context.message_object_ids).size === context.message_object_ids.length;
}

function validArtifact(artifact: NativeResult["artifacts"][number], context: NativeResultContext): boolean {
  return artifact.object_type === "video" && Number.isSafeInteger(artifact.object_index) && artifact.object_index >= 0 &&
    context.message_object_ids.includes(artifact.message_object_id) && safeId(artifact.message_object_id) &&
    isSafeUploadReferenceUrl(artifact.object_url) &&
    (artifact.mime_type === null || artifact.mime_type === "video/mp4" || artifact.mime_type === "video/quicktime") &&
    artifact.mime_source === (artifact.mime_type === null ? "UNKNOWN" : "URL_EXTENSION");
}

function sameArtifact(previous: OwnerWan27VideoEditGenerationArtifact, next: NativeResult["artifacts"][number]): boolean {
  return previous.object_index === next.object_index && previous.message_object_id === next.message_object_id &&
    previous.object_url === next.object_url && previous.object_type === next.object_type &&
    previous.mime_type === next.mime_type && previous.mime_source === next.mime_source;
}

function page(recovery: Recovery, offset: number): OwnerWan27VideoEditGenerationResult {
  const all = [...recovery.artifacts.values()], artifacts = Object.freeze(all.slice(offset, offset + PAGE_SIZE));
  const next = offset + artifacts.length;
  return Object.freeze({ status: "completed", status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", backend_acceptance: "UNPROVEN",
    provider_terminal_status: "UNPROVEN", cost_cap_enforced: false, output_count: "UNKNOWN", recovery_id: recovery.recovery_id,
    model_id: MODEL_ID, source_binding: Object.freeze({ public_catalog_version: getOwnerWan27VideoEditSourceProfile().source_pins.public_catalog_version,
      profile_sha256: recovery.binding.profile_sha256, request_fingerprint: recovery.binding.request_fingerprint,
      intent_fingerprint: recovery.binding.intent_fingerprint }), observed_artifact_count: all.length, offset,
    page_size: PAGE_SIZE, artifacts, has_more: next < all.length, next_offset: next < all.length ? next : null,
    diagnostic: diagnostic(recovery.d) });
}

function diagnostic(value: Recovery["d"]): OwnerWan27VideoEditGenerationDiagnostic {
  return Object.freeze({ ...value, gaps: Object.freeze(value.gaps.slice(0, 32)) });
}
function recoveryItem(recovery: Recovery): OwnerWan27VideoEditRecoveryListItem {
  return Object.freeze({ recovery_id: recovery.recovery_id, created_at: recovery.created_at, model_id: MODEL_ID,
    status: recovery.status, observed_artifact_count: recovery.artifacts.size, diagnostic: diagnostic(recovery.d) });
}
function unknown(recovery: Recovery): OwnerWan27VideoEditGenerationServiceError {
  return new OwnerWan27VideoEditGenerationServiceError("OUTCOME_UNKNOWN", recovery.recovery_id, diagnostic(recovery.d));
}

function nativeInputFor(preparer: OwnerWan27VideoEditRequestPreparer, referenceService: OwnerWan27VideoEditReferenceService,
  candidate: OwnerWan27VideoEditPreparedCandidate, permit: OwnerWan27VideoEditOneShotPermit,
  principal: Readonly<GenerationPrincipalRef>, attemptId: string, linkService: PerUserLinkService,
  binding: Readonly<AuthBinding>, chat?: NativeChat) {
  return Object.freeze({ preparer, referenceService, candidate, permit, principal, attemptId, linkService, binding, ...(chat ? { chat } : {}) });
}

function nativeClient(value: unknown): value is SyntxChatHttpClient {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  try {
    return Object.getPrototypeOf(value) === SyntxChatHttpClient.prototype && [
      ["createChat", CHAT_CREATE], ["uploadOwnerWan27VideoEditReference", UPLOAD], ["createOwnerWan27VideoEditChat", MODEL_CREATE],
      ["startOwnerWan27VideoEditWithOwnedCandidate", MODEL_START], ["listOwnedWan27VideoEditCandidates", MODEL_LIST],
      ["getOwnedWan27VideoEditResult", MODEL_GET]
    ].every(([name, original]) => !Object.hasOwn(value, name as string) && typeof original === "function" &&
      getDataMethod(value, name as string) === original && Reflect.get(value, name as string) === original);
  } catch { return false; }
}

function genuineLinks(value: unknown): boolean {
  return !!value && typeof value === "object" && !types.isProxy(value) &&
    Object.getPrototypeOf(value) === PerUserLinkService.prototype && PerUserLinkService.prototype.getStatus === LINK_STATUS &&
    !Object.hasOwn(value, "getStatus");
}
function genuineAccount(value: unknown): value is AccountStatusService {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === AccountStatusService.prototype &&
    !Object.hasOwn(value, "getAccountStatus") && AccountStatusService.prototype.getAccountStatus === ACCOUNT_GET &&
    getDataMethod(value, "getAccountStatus") === ACCOUNT_GET;
}
function genuineAccess(value: unknown): value is ModelAccessService {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === ModelAccessService.prototype &&
    !Object.hasOwn(value, "getModelAccess") && ModelAccessService.prototype.getModelAccess === ACCESS_GET &&
    getDataMethod(value, "getModelAccess") === ACCESS_GET;
}

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const row = exact(value, ["tenant_id", "subject"]);
  if (typeof row.tenant_id !== "string" || !row.tenant_id.trim() || row.tenant_id.length > 256 ||
      typeof row.subject !== "string" || !row.subject.trim() || row.subject.length > 512 ||
      /[\u0000-\u001f\u007f]/u.test(row.tenant_id) || /[\u0000-\u001f\u007f]/u.test(row.subject)) invalid();
  return Object.freeze({ tenant_id: row.tenant_id, subject: row.subject });
}

function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  let prototype: object | null, descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); }
  catch { return invalid(); }
  const keys = Reflect.ownKeys(descriptors), allowed = [...required, ...optional];
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !Object.hasOwn(descriptors[key]!, "value") ||
        descriptors[key]!.enumerable !== true)) invalid();
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) output[key] = descriptors[key]!.value;
  return output;
}
function exactSignal(signal: AbortSignal | undefined): AbortSignal | undefined {
  if (signal === undefined) return undefined;
  if (!signal || typeof signal !== "object" || types.isProxy(signal) || Object.getPrototypeOf(signal) !== AbortSignal.prototype) invalid();
  return signal;
}
function semanticIntentKey(principal: Readonly<GenerationPrincipalRef>, fingerprint: string): string {
  return JSON.stringify([principal.tenant_id, principal.subject_id, fingerprint]);
}
function sameStrings(a: readonly string[], b: readonly string[]): boolean { return a.length === b.length && a.every((value, index) => value === b[index]); }
function fresh(value: string, now: number): boolean { const parsed = Date.parse(value); return Number.isFinite(parsed) && Math.abs(parsed - now) <= 300_000; }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function safeId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u.test(value); }
function safeGaps(gaps: readonly string[]): string[] { return [...new Set(gaps.filter((gap) => /^[A-Z][A-Z0-9_]{0,127}$/u.test(gap)))].slice(0, 32); }
function bounded(value: unknown, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) invalid();
  return value as number;
}
function readAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) invalid(); return value; }
function readClock(value: unknown): () => number { if (typeof value !== "function" || types.isProxy(value)) invalid(); return value as () => number; }
function getDataMethod(target: object, key: string): unknown {
  let cursor: object | null = target;
  while (cursor) {
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    cursor = Object.getPrototypeOf(cursor) as object | null;
  }
  return undefined;
}
function round2(value: number): number { return Math.round(value * 100) / 100; }
function wellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function err(code: OwnerWan27VideoEditGenerationErrorCode): OwnerWan27VideoEditGenerationServiceError {
  return new OwnerWan27VideoEditGenerationServiceError(code);
}
function fail(code: OwnerWan27VideoEditGenerationErrorCode): never { throw err(code); }
function invalid(): never { return fail("INVALID_REQUEST"); }
