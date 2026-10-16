import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import {
  SyntxChatHttpClient
} from "../adapter/syntx/chat-http-client.js";
import {
  readOwnerVeoOmniReferenceNativeDispatchStatus,
  type OwnerVeoOmniReferenceNativeChatContext,
  type OwnerVeoOmniReferenceNativeResult,
  type OwnerVeoOmniReferenceNativeResultCandidates,
  type OwnerVeoOmniReferenceNativeResultContext,
  type OwnerVeoOmniReferenceNativeVideoArtifact
} from "../adapter/syntx/owner-veo-omni-reference-native-context.js";
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
import {
  createOwnerVeoOmniT2vBudgetedModelAccessResolver,
  createOwnerVeoOmniVideoReferenceBudgetedModelAccessResolver
} from "./owner-veo-omni-t2v-budget-preflight.js";
import {
  isOwnerVeoOmniReferenceService,
  OwnerVeoOmniReferenceService
} from "./owner-veo-omni-reference-service.js";
import {
  isOwnerVeoOmniReferenceRequestPreparer,
  isOwnerVeoOmniReferencePreparedCandidate,
  OwnerVeoOmniReferenceRequestPreparer,
  type OwnerVeoOmniReferenceCandidateBinding,
  type OwnerVeoOmniReferencePreparedCandidate
} from "./owner-veo-omni-reference-request-preparer.js";
import {
  createOwnerVeoOmniReferenceOneShotPermit,
  revalidateOwnerVeoOmniReferenceOneShotPermit,
  type OwnerVeoOmniReferenceOneShotPermit,
  OwnerVeoOmniReferenceOneShotPolicyError
} from "./owner-veo-omni-reference-one-shot-policy.js";
import {
  getOwnerVeoOmniReferenceProfile,
  normalizeOwnerVeoOmniReferenceGenerationInput
} from "./owner-veo-omni-reference-profile.js";
import {
  OWNER_VEO_OMNI_REFERENCE_PROFILE_SHA256
} from "./owner-veo-omni-reference-profile.js";

const MODEL_ID = "veo_omni" as const;
const AI_NAME = "veo3" as const;
const CATALOG_VERSION = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json" as const;
const MODELS_SHA256 = "sha256:92c31dba26eb9c0ccf68cdf92a105e6e808c92b187286e4fb366debe051982e1" as const;
const CATALOG_FETCHED_AT = "2026-10-16T08:51:59.507Z" as const;
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY_PATTERN = /^veo_omni_reference_recovery_[0-9a-f-]{36}$/u;
const RECOVERY_LIMIT = 128;
const RUN_LIMIT = 4;
const PAGE_SIZE = 64;
const MAX_RESULTS = 4096;
const REQUEST_TIMEOUT_MS = 120_000;
const SERVICES = new WeakSet<object>();
const NATIVE_CREATE = SyntxChatHttpClient.prototype.createOwnerVeoOmniReferenceChat;
const NATIVE_START = SyntxChatHttpClient.prototype.startOwnerVeoOmniReferenceWithOwnedCandidate;
const NATIVE_LIST = SyntxChatHttpClient.prototype.listOwnedVeoOmniReferenceCandidates;
const NATIVE_GET = SyntxChatHttpClient.prototype.getOwnedVeoOmniReferenceResult;
const NATIVE_CHAT_CREATE = SyntxChatHttpClient.prototype.createChat;
const NATIVE_UPLOAD = SyntxChatHttpClient.prototype.uploadOwnerVeoOmniReference;
const ACCOUNT_STATUS_GET = AccountStatusService.prototype.getAccountStatus;
const MODEL_ACCESS_GET = ModelAccessService.prototype.getModelAccess;
const LINK_STATUS = PerUserLinkService.prototype.getStatus;
const PREPARER_BOUND_TO_STORE = OwnerVeoOmniReferenceRequestPreparer.prototype.isBoundToReferenceService;
const PREPARER_PREPARE = OwnerVeoOmniReferenceRequestPreparer.prototype.prepare;
const PREPARER_INSPECT = OwnerVeoOmniReferenceRequestPreparer.prototype.inspectCandidate;
const PREPARER_REVALIDATE = OwnerVeoOmniReferenceRequestPreparer.prototype.revalidateCandidate;
const PREPARER_INVALIDATE = OwnerVeoOmniReferenceRequestPreparer.prototype.invalidateAttempt;

export type OwnerVeoOmniReferenceGenerationPhase = "VALIDATE_REQUEST" | "PREFLIGHT_ONE" | "CHAT_CREATE" |
  "PREFLIGHT_TWO" | "GENERATION_POST" | "POST_ACK_KNOWN" | "HISTORY_GET" | "RESULT_GET";

export interface OwnerVeoOmniReferenceGenerationDiagnostic {
  readonly phase: OwnerVeoOmniReferenceGenerationPhase;
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

export interface OwnerVeoOmniReferenceGenerationArtifact extends OwnerVeoOmniReferenceNativeVideoArtifact {
  readonly message_id: string;
  readonly chat_uuid: string;
  readonly model_id: typeof MODEL_ID;
}

export interface OwnerVeoOmniReferenceGenerationResult {
  readonly status: "completed";
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly backend_acceptance: "UNPROVEN";
  readonly provider_terminal_status: "UNPROVEN";
  readonly cost_cap_enforced: false;
  readonly output_count: "UNKNOWN";
  readonly recovery_id: string;
  readonly model_id: typeof MODEL_ID;
  readonly source_binding: Readonly<{
    public_catalog_version: typeof CATALOG_VERSION;
    profile_sha256: typeof OWNER_VEO_OMNI_REFERENCE_PROFILE_SHA256;
    request_fingerprint: string;
    intent_fingerprint: string;
  }>;
  readonly observed_artifact_count: number;
  readonly offset: number;
  readonly page_size: typeof PAGE_SIZE;
  readonly artifacts: readonly OwnerVeoOmniReferenceGenerationArtifact[];
  readonly has_more: boolean;
  readonly next_offset: number | null;
  readonly diagnostic: OwnerVeoOmniReferenceGenerationDiagnostic;
}

export interface OwnerVeoOmniReferenceRecoveryListItem {
  readonly recovery_id: string;
  readonly created_at: string;
  readonly model_id: typeof MODEL_ID;
  readonly status: "outcome_unknown" | "completed";
  readonly observed_artifact_count: number;
  readonly diagnostic: OwnerVeoOmniReferenceGenerationDiagnostic;
}

export interface OwnerVeoOmniReferenceGenerationServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string;
  readonly preparer: OwnerVeoOmniReferenceRequestPreparer;
  readonly referenceService: OwnerVeoOmniReferenceService;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly createAccountStatusService: (attemptId: string) => AccountStatusService;
  readonly createModelAccessService: (attemptId: string) => ModelAccessService;
  readonly resolveSubscription: (attemptId: string, signal?: AbortSignal) => Promise<SyntxSubscription>;
  readonly now?: () => number;
}

export interface OwnerVeoOmniReferenceGenerateInput {
  readonly attemptId: string;
  readonly prompt: string;
  readonly input_type: "image" | "references";
  readonly upscale: 0 | 1 | 2 | 3;
  readonly aspect_ratio: "16:9" | "9:16";
  readonly video_duration: 4 | 6 | 8 | 10;
  readonly reference_handles: readonly string[];
}

export interface OwnerVeoOmniReferenceReconcileInput { readonly attemptId: string; readonly recovery_id: string; }
export interface OwnerVeoOmniReferenceRecoveryListInput { readonly attemptId: string; readonly limit?: number; }
export interface OwnerVeoOmniReferenceResultPageInput { readonly attemptId: string; readonly recovery_id: string; readonly offset?: number; }

export type OwnerVeoOmniReferenceGenerationServiceErrorCode =
  | "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH"
  | "PREFLIGHT_FAILED" | "SUBSCRIPTION_REQUIRED" | "SUBSCRIPTION_STATUS_UNVERIFIED" | "INTENT_ALREADY_CLAIMED"
  | "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND";

export class OwnerVeoOmniReferenceGenerationServiceError extends Error {
  readonly diagnostic?: OwnerVeoOmniReferenceGenerationDiagnostic;
  constructor(readonly code: OwnerVeoOmniReferenceGenerationServiceErrorCode, readonly recovery_id?: string,
    diagnostic?: OwnerVeoOmniReferenceGenerationDiagnostic) {
    super(code === "OUTCOME_UNKNOWN"
      ? "The owner Omni request may have been dispatched; use GET-only reconciliation and do not retry."
      : "The owner Veo Omni reference request could not be completed safely.");
    this.name = "OwnerVeoOmniReferenceGenerationServiceError";
    if (code === "OUTCOME_UNKNOWN" && diagnostic) this.diagnostic = diagnostic;
  }
}

interface Run { readonly attemptId: string; readonly controller: AbortController; promise: Promise<unknown>; }

interface Recovery {
  readonly recovery_id: string;
  readonly attemptId: string;
  readonly intentKey: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly created_at: string;
  readonly candidate: OwnerVeoOmniReferencePreparedCandidate;
  readonly permit: OwnerVeoOmniReferenceOneShotPermit;
  readonly chat: OwnerVeoOmniReferenceNativeChatContext;
  readonly client: SyntxChatHttpClient;
  readonly binding: Readonly<OwnerVeoOmniReferenceCandidateBinding>;
  readonly epoch: number;
  owner_echo_message_id: string | null;
  status: "outcome_unknown" | "completed";
  readonly artifacts: Map<string, OwnerVeoOmniReferenceGenerationArtifact>;
  readonly objectUrls: Map<string, string>;
  d: {
    phase: OwnerVeoOmniReferenceGenerationPhase;
    post_started: boolean;
    ack_known: boolean;
    history_status: OwnerVeoOmniReferenceGenerationDiagnostic["history_status"];
    owner_ack_status: OwnerVeoOmniReferenceGenerationDiagnostic["owner_ack_status"];
    request_echo_status: OwnerVeoOmniReferenceGenerationDiagnostic["request_echo_status"];
    history_get_calls: number;
    result_get_calls: number;
    result_status: OwnerVeoOmniReferenceGenerationDiagnostic["result_status"];
    gaps: string[];
  };
}

/** Two fresh paid-plan/quote/balance gates, one native POST, and GET-only recovery. */
export class OwnerVeoOmniReferenceGenerationService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #links: PerUserLinkService;
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #catalogVersion: typeof CATALOG_VERSION;
  readonly #preparer: OwnerVeoOmniReferenceRequestPreparer;
  readonly #referenceService: OwnerVeoOmniReferenceService;
  readonly #resolveClient: OwnerVeoOmniReferenceGenerationServiceOptions["resolveChatClient"];
  readonly #createAccount: OwnerVeoOmniReferenceGenerationServiceOptions["createAccountStatusService"];
  readonly #createAccess: OwnerVeoOmniReferenceGenerationServiceOptions["createModelAccessService"];
  readonly #resolveSubscription: OwnerVeoOmniReferenceGenerationServiceOptions["resolveSubscription"];
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

  constructor(optionsInput: OwnerVeoOmniReferenceGenerationServiceOptions | unknown) {
    const fields = exact(optionsInput, ["binding", "linkService", "catalog", "catalog_version", "preparer", "referenceService",
      "resolveChatClient", "createAccountStatusService", "createModelAccessService", "resolveSubscription"], ["now"]);
    const profile = getOwnerVeoOmniReferenceProfile();
    if (!isGenuineLinkService(fields.linkService) || !(fields.catalog instanceof DiscoveryCatalogRepository) ||
        fields.catalog_version !== CATALOG_VERSION || !isOwnerVeoOmniReferenceService(fields.referenceService) ||
        !isOwnerVeoOmniReferenceRequestPreparer(fields.preparer) ||
        !isOwnerVeoOmniReferenceRequestPreparerBound(fields.preparer, fields.referenceService) ||
        typeof fields.resolveChatClient !== "function" || types.isProxy(fields.resolveChatClient) ||
        typeof fields.createAccountStatusService !== "function" || types.isProxy(fields.createAccountStatusService) ||
        typeof fields.createModelAccessService !== "function" || types.isProxy(fields.createModelAccessService) ||
        typeof fields.resolveSubscription !== "function" || types.isProxy(fields.resolveSubscription) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now))) ||
        profile.profile_sha256 !== OWNER_VEO_OMNI_REFERENCE_PROFILE_SHA256) invalid();
    this.#binding = snapshotBinding(fields.binding);
    this.#links = fields.linkService as PerUserLinkService;
    this.#catalog = fields.catalog as DiscoveryCatalogRepository;
    this.#catalogVersion = fields.catalog_version as typeof CATALOG_VERSION;
    this.#preparer = fields.preparer as OwnerVeoOmniReferenceRequestPreparer;
    this.#referenceService = fields.referenceService as OwnerVeoOmniReferenceService;
    this.#resolveClient = fields.resolveChatClient as OwnerVeoOmniReferenceGenerationServiceOptions["resolveChatClient"];
    this.#createAccount = fields.createAccountStatusService as OwnerVeoOmniReferenceGenerationServiceOptions["createAccountStatusService"];
    this.#createAccess = fields.createModelAccessService as OwnerVeoOmniReferenceGenerationServiceOptions["createModelAccessService"];
    this.#resolveSubscription = fields.resolveSubscription as OwnerVeoOmniReferenceGenerationServiceOptions["resolveSubscription"];
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    this.#assertModel();
    SERVICES.add(this);
    Object.freeze(this);
  }

  getParametersSource() {
    this.#assertOpen();
    const profile = getOwnerVeoOmniReferenceProfile();
    if (profile.profile_sha256 !== OWNER_VEO_OMNI_REFERENCE_PROFILE_SHA256 || profile.runtime_usable !== false ||
        profile.dispatch_allowed !== false || profile.backend_acceptance !== "UNPROVEN") fail("MODEL_BINDING_MISMATCH");
    return profile;
  }

  generate(input: OwnerVeoOmniReferenceGenerateInput | unknown, signalInput?: AbortSignal): Promise<OwnerVeoOmniReferenceGenerationResult> {
    this.#assertOpen();
    const request = snapshotGenerate(input);
    const signal = exactSignal(signalInput);
    if (this.#invalidating.has(request.attemptId)) return Promise.reject(err("PRINCIPAL_NOT_LINKED"));
    return this.#run(request.attemptId, signal, (runSignal, epoch) => this.#generate(request, runSignal, epoch));
  }

  reconcile(input: OwnerVeoOmniReferenceReconcileInput | unknown, signalInput?: AbortSignal): Promise<OwnerVeoOmniReferenceGenerationResult> {
    this.#assertOpen();
    const request = snapshotRecovery(input), signal = exactSignal(signalInput);
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
        if (error instanceof OwnerVeoOmniReferenceGenerationServiceError && error.code === "RECOVERY_NOT_FOUND") throw error;
        if (error instanceof OwnerReferencePrincipalError) fail("RECOVERY_NOT_FOUND");
        throw unknown(recovery);
      } finally { deadline.close(); }
    });
  }

  listRecoveries(input: OwnerVeoOmniReferenceRecoveryListInput | unknown): Promise<readonly OwnerVeoOmniReferenceRecoveryListItem[]> {
    this.#assertOpen();
    const request = snapshotList(input);
    if (this.#invalidating.has(request.attemptId)) return Promise.reject(err("PRINCIPAL_NOT_LINKED"));
    return this.#run(request.attemptId, undefined, async (signal, epoch) => {
      const principal = await this.#principal(request.attemptId, signal);
      const client = this.#client(request.attemptId);
      await this.#checkCurrent(request.attemptId, principal, client, signal, epoch);
      return Object.freeze([...this.#recoveries.values()].filter((recovery) => recovery.attemptId === request.attemptId &&
        recovery.epoch === epoch && sameGenerationPrincipal(recovery.principal, principal) && recovery.client === client)
        .slice(0, request.limit).map(recoveryItem));
    });
  }

  getResultPage(input: OwnerVeoOmniReferenceResultPageInput | unknown): Promise<OwnerVeoOmniReferenceGenerationResult> {
    this.#assertOpen();
    const request = snapshotPage(input);
    if (this.#invalidating.has(request.attemptId)) return Promise.reject(err("RECOVERY_NOT_FOUND"));
    return this.#run(request.attemptId, undefined, async (signal, epoch) => {
      const principal = await this.#principal(request.attemptId, signal);
      const recovery = this.#owned(request.attemptId, request.recovery_id, principal);
      if (recovery.epoch !== epoch) fail("RECOVERY_NOT_FOUND");
      await this.#checkCurrent(request.attemptId, recovery.principal, recovery.client, signal, epoch);
      if (recovery.status !== "completed") throw unknown(recovery);
      return page(recovery, request.offset);
    });
  }

  invalidateAttempt(attemptIdInput: unknown): Promise<void> {
    const attemptId = readAttempt(attemptIdInput);
    const previous = this.#invalidations.get(attemptId);
    if (previous) return previous;
    this.#invalidating.add(attemptId);
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    const active = [...this.#runs].filter((run) => run.attemptId === attemptId);
    for (const run of active) run.controller.abort();
    let dependent: Promise<void>;
    try { dependent = Promise.resolve(Reflect.apply(PREPARER_INVALIDATE, this.#preparer, [attemptId])); }
    catch (error) { dependent = Promise.reject(error); }
    const complete = Promise.allSettled([dependent, ...active.map((run) => run.promise)]).then((results) => {
      this.#invalidating.delete(attemptId); this.#invalidations.delete(attemptId);
      if (results[0]?.status === "rejected") throw err("SERVICE_BUSY");
    });
    this.#invalidations.set(attemptId, complete);
    return complete;
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    const attempts = new Set([...this.#runs].map((run) => run.attemptId));
    for (const attemptId of attempts) {
      this.#invalidating.add(attemptId);
      this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    }
    for (const run of this.#runs) run.controller.abort();
    const dependent = [...attempts].map((attemptId) => {
      try { return Promise.resolve(Reflect.apply(PREPARER_INVALIDATE, this.#preparer, [attemptId])); }
      catch { return Promise.resolve(); }
    });
    this.#closing = Promise.allSettled([...dependent, ...[...this.#runs].map((run) => run.promise)]).then(() => {
      this.#recoveries.clear(); this.#reserved.clear(); this.#claimed.clear(); this.#runs.clear(); this.#clients.clear();
      this.#epochs.clear(); this.#invalidating.clear(); this.#invalidations.clear();
    });
    return this.#closing;
  }

  async #generate(request: OwnerVeoOmniReferenceGenerateInput, signal: AbortSignal, epoch: number): Promise<OwnerVeoOmniReferenceGenerationResult> {
    const deadline = new AbsoluteRequestDeadline(REQUEST_TIMEOUT_MS, signal, () => err("PRE_DISPATCH_FAILED"));
    let candidate: OwnerVeoOmniReferencePreparedCandidate | undefined;
    let permit: OwnerVeoOmniReferenceOneShotPermit | undefined;
    let binding: Readonly<OwnerVeoOmniReferenceCandidateBinding> | undefined;
    let principal: Readonly<GenerationPrincipalRef> | undefined;
    let client: SyntxChatHttpClient | undefined;
    let intentKey: string | undefined;
    let reserved = false;
    let recovery: Recovery | undefined;
    let postStarted = false;
    const release = () => {
      if (intentKey && reserved) { this.#reserved.delete(intentKey); reserved = false; }
    };

    try {
      deadline.throwIfAborted();
      this.#assertModel();
      principal = await this.#principal(request.attemptId, deadline.signal);
      client = this.#client(request.attemptId);
      await this.#checkCurrent(request.attemptId, principal, client, deadline.signal, epoch);
      candidate = await this.#await(deadline, () => Reflect.apply(PREPARER_PREPARE, this.#preparer,
        [request, deadline.signal]) as Promise<OwnerVeoOmniReferencePreparedCandidate>);
      await this.#checkCurrent(request.attemptId, principal, client, deadline.signal, epoch);
      binding = this.#candidateBinding(candidate, request, principal);
      intentKey = semanticIntentKey(principal, binding.intent_fingerprint);
      if (this.#claimed.has(intentKey) || this.#reserved.has(intentKey)) fail("INTENT_ALREADY_CLAIMED");
      if (this.#recoveries.size + this.#reserved.size >= RECOVERY_LIMIT) fail("SERVICE_BUSY");
      this.#reserved.add(intentKey);
      reserved = true;
      permit = await createOwnerVeoOmniReferenceOneShotPermit({ preparer: this.#preparer, candidate, principal, attemptId: request.attemptId });
      await this.#checkCurrent(request.attemptId, principal, client, deadline.signal, epoch);

      await this.#preflight(request, principal, client, candidate, binding, deadline, epoch);
      await this.#checkCandidateCurrent(request, principal, client, candidate, binding, permit, deadline.signal, epoch);
      const nativeInput = nativeInputFor(this.#preparer, this.#referenceService, candidate, permit, principal, request.attemptId,
        this.#links, this.#binding);

      let chat: OwnerVeoOmniReferenceNativeChatContext;
      try {
        chat = await this.#await(deadline, () => Reflect.apply(NATIVE_CREATE, client!, [nativeInput, deadline.signal]) as Promise<OwnerVeoOmniReferenceNativeChatContext>);
      } catch { fail("PRE_DISPATCH_FAILED"); }
      await this.#checkCurrent(request.attemptId, principal, client, deadline.signal, epoch);
      this.#assertChat(chat!, request, binding);

      await this.#preflight(request, principal, client, candidate, binding, deadline, epoch);
      await this.#checkCandidateCurrent(request, principal, client, candidate, binding, permit, deadline.signal, epoch);
      const currentBinding = Reflect.apply(PREPARER_INSPECT, this.#preparer, [candidate]) as OwnerVeoOmniReferenceCandidateBinding | undefined;
      if (!currentBinding || schemaHash(currentBinding) !== schemaHash(binding)) fail("PRE_DISPATCH_FAILED");

      if (this.#recoveries.size >= RECOVERY_LIMIT) fail("SERVICE_BUSY");
      recovery = this.#newRecovery(request.attemptId, principal, intentKey, candidate, permit, chat!, client, binding, epoch);
      this.#recoveries.set(recovery.recovery_id, recovery);
      recovery.d.phase = "GENERATION_POST";
      recovery.d.post_started = true;
      postStarted = true;

      let ack: Readonly<{ chat_uuid: string; message_id: string }>;
      try {
        ack = await this.#await(deadline, () => Reflect.apply(NATIVE_START, client!,
          [Object.freeze({ ...nativeInput, chat: chat! }), deadline.signal]) as Promise<Readonly<{ chat_uuid: string; message_id: string }>>);
      } catch {
        const dispatch = readOwnerVeoOmniReferenceNativeDispatchStatus(client, chat!);
        if (dispatch && !dispatch.dispatch_attempted) {
          this.#recoveries.delete(recovery.recovery_id);
          recovery = undefined;
          postStarted = false;
          release();
          fail("PRE_DISPATCH_FAILED");
        }
        this.#claimed.add(intentKey);
        release();
        throw unknown(recovery);
      }

      const dispatch = readOwnerVeoOmniReferenceNativeDispatchStatus(client, chat!);
      if (!ack || ack.chat_uuid !== chat!.chat_uuid || !safeId(ack.message_id) || !dispatch?.dispatch_attempted ||
          !dispatch.owner_ack_bound || dispatch.owner_echo_message_id !== ack.message_id || dispatch.chat_uuid !== chat!.chat_uuid ||
          dispatch.attempt_id !== request.attemptId || dispatch.model_id !== MODEL_ID) {
        if (dispatch && !dispatch.dispatch_attempted) {
          this.#recoveries.delete(recovery.recovery_id);
          recovery = undefined;
          postStarted = false;
          release();
          fail("PRE_DISPATCH_FAILED");
        }
        this.#claimed.add(intentKey);
        release();
        throw unknown(recovery);
      }

      this.#claimed.add(intentKey);
      release();
      await this.#checkCurrent(request.attemptId, principal, client, deadline.signal, epoch);
      recovery.owner_echo_message_id = ack.message_id;
      recovery.d.ack_known = true;
      recovery.d.owner_ack_status = "MATCHED";
      recovery.d.phase = "POST_ACK_KNOWN";
      return await this.#observe(recovery, deadline);
    } catch (error) {
      if (postStarted && recovery) {
        const dispatch = client && recovery.chat ? readOwnerVeoOmniReferenceNativeDispatchStatus(client, recovery.chat) : null;
        if (!dispatch || dispatch.dispatch_attempted) {
          if (intentKey) this.#claimed.add(intentKey);
          release();
          if (dispatch?.owner_ack_bound && dispatch.owner_echo_message_id) {
            recovery.owner_echo_message_id = dispatch.owner_echo_message_id;
            recovery.d.ack_known = true;
            recovery.d.owner_ack_status = "MATCHED";
            recovery.d.phase = "POST_ACK_KNOWN";
          }
          throw unknown(recovery);
        }
        this.#recoveries.delete(recovery.recovery_id);
      }
      release();
      if (error instanceof OwnerVeoOmniReferenceGenerationServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      if (error instanceof OwnerVeoOmniReferenceOneShotPolicyError && error.code === "INTENT_ALREADY_CLAIMED") fail("INTENT_ALREADY_CLAIMED");
      return fail("PRE_DISPATCH_FAILED");
    } finally {
      release();
      deadline.close();
    }
  }

  async #preflight(
    request: OwnerVeoOmniReferenceGenerateInput,
    principal: Readonly<GenerationPrincipalRef>,
    client: SyntxChatHttpClient,
    candidate: OwnerVeoOmniReferencePreparedCandidate,
    binding: Readonly<OwnerVeoOmniReferenceCandidateBinding>,
    deadline: AbsoluteRequestDeadline,
    epoch: number
  ): Promise<void> {
    const attemptId = request.attemptId;
    deadline.throwIfAborted();
    const current = Reflect.apply(PREPARER_INSPECT, this.#preparer, [candidate]) as OwnerVeoOmniReferenceCandidateBinding | undefined;
    if (!current || schemaHash(current) !== schemaHash(binding) || binding.model_id !== MODEL_ID ||
        binding.profile_sha256 !== OWNER_VEO_OMNI_REFERENCE_PROFILE_SHA256 || binding.attempt_id !== attemptId ||
        !sameGenerationPrincipal(binding.principal, principal) || binding.expires_at <= this.#readNow() ||
        (this.#epochs.get(attemptId) ?? 0) !== epoch) fail("PREFLIGHT_FAILED");
    this.#assertModel();
    this.#assertCatalogModel();

    let subscription: Readonly<SyntxSubscription>;
    try {
      await this.#checkCurrent(attemptId, principal, client, deadline.signal, epoch);
      const raw = await this.#await(deadline, () => Reflect.apply(this.#resolveSubscription, undefined, [attemptId, deadline.signal]) as Promise<SyntxSubscription>);
      await this.#checkCurrent(attemptId, principal, client, deadline.signal, epoch);
      subscription = snapshotSubscription(raw);
    } catch (error) {
      if (error instanceof OwnerVeoOmniReferenceGenerationServiceError) throw error;
      fail("SUBSCRIPTION_STATUS_UNVERIFIED");
    }
    if (subscription.active === false || (subscription.plan_type !== null && subscription.plan_type.trim().toUpperCase() === "FREE")) {
      fail("SUBSCRIPTION_REQUIRED");
    }
    if (subscription.active !== true || typeof subscription.plan_type !== "string" || !subscription.plan_type.trim()) {
      fail("SUBSCRIPTION_STATUS_UNVERIFIED");
    }

    let accountService: AccountStatusService;
    let accessService: ModelAccessService;
    try {
      accountService = Reflect.apply(this.#createAccount, undefined, [attemptId]) as AccountStatusService;
      accessService = Reflect.apply(this.#createAccess, undefined, [attemptId]) as ModelAccessService;
    } catch { fail("PREFLIGHT_FAILED"); }
    if (!genuineAccountService(accountService!) || this.#usedAccounts.has(accountService!) ||
        !genuineAccessService(accessService!) || this.#usedAccess.has(accessService!)) fail("PREFLIGHT_FAILED");
    this.#usedAccounts.add(accountService!);
    this.#usedAccess.add(accessService!);

    const hasVideoReference = binding.sources.some((source) => source.kind === "video");
    const costParameters = snapshotCostParameters(binding.cost_parameters, hasVideoReference, request);
    const resolveAccountStatus = async (_attempt: string, signal?: AbortSignal): Promise<AccountStatusResult> => {
      await this.#checkCurrent(attemptId, principal, client, signal, epoch);
      let value: AccountStatusResult;
      try { value = await Reflect.apply(ACCOUNT_STATUS_GET, accountService!, [signal]) as AccountStatusResult; }
      catch { fail("PREFLIGHT_FAILED"); }
      await this.#checkCurrent(attemptId, principal, client, signal, epoch);
      return value!;
    };
    const resolveModelAccess = async (_attempt: string, modelId: string, parameters: Readonly<Record<string, SyntxCostParameter>>,
      signal?: AbortSignal): Promise<ModelAccessResult> => {
      await this.#checkCurrent(attemptId, principal, client, signal, epoch);
      let value: ModelAccessResult;
      try { value = await Reflect.apply(MODEL_ACCESS_GET, accessService!, [{ model_id: modelId, cost_parameters: parameters }, signal]) as ModelAccessResult; }
      catch { fail("PREFLIGHT_FAILED"); }
      await this.#checkCurrent(attemptId, principal, client, signal, epoch);
      return value!;
    };
    const resolver = hasVideoReference
      ? createOwnerVeoOmniVideoReferenceBudgetedModelAccessResolver({ catalog: this.#catalog,
          resolveAccountStatus, resolveModelAccess, now: this.#now })
      : createOwnerVeoOmniT2vBudgetedModelAccessResolver({ catalog: this.#catalog,
          resolveAccountStatus, resolveModelAccess, now: this.#now });
    let access: ModelAccessResult;
    try { access = await this.#await(deadline, () => resolver(attemptId, MODEL_ID, costParameters, deadline.signal)); }
    catch { fail("PREFLIGHT_FAILED"); }
    await this.#checkCurrent(attemptId, principal, client, deadline.signal, epoch);
    if (access!.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" ||
        access!.catalog_version !== this.#modelAccessCatalogVersion() || access!.model_id !== MODEL_ID ||
        access!.ai_name !== AI_NAME || access!.model_type !== MODEL_ID || access!.account_read_live !== true ||
        access!.parameters_redacted !== true || access!.access !== true ||
        !sameStrings(access!.parameter_keys, Object.keys(costParameters).sort()) ||
        !finite(access!.discount_cost ?? access!.cost) || !fresh(access!.observed_at, this.#readNow())) fail("PREFLIGHT_FAILED");
    if ((this.#epochs.get(attemptId) ?? 0) !== epoch || binding.expires_at <= this.#readNow()) fail("PREFLIGHT_FAILED");
  }

  async #checkCandidateCurrent(request: OwnerVeoOmniReferenceGenerateInput, principal: Readonly<GenerationPrincipalRef>,
    client: SyntxChatHttpClient, candidate: OwnerVeoOmniReferencePreparedCandidate,
    binding: Readonly<OwnerVeoOmniReferenceCandidateBinding>, permit: OwnerVeoOmniReferenceOneShotPermit,
    signal: AbortSignal, epoch: number): Promise<void> {
    await this.#checkCurrent(request.attemptId, principal, client, signal, epoch);
    const current = await Reflect.apply(PREPARER_REVALIDATE, this.#preparer, [candidate, signal]) as OwnerVeoOmniReferenceCandidateBinding;
    if (schemaHash(current) !== schemaHash(binding)) fail("PRE_DISPATCH_FAILED");
    await revalidateOwnerVeoOmniReferenceOneShotPermit({ preparer: this.#preparer, candidate, permit, principal, attemptId: request.attemptId });
    await this.#checkCurrent(request.attemptId, principal, client, signal, epoch);
  }

  async #observe(recovery: Recovery, deadline: AbsoluteRequestDeadline): Promise<OwnerVeoOmniReferenceGenerationResult> {
    await this.#checkCurrent(recovery.attemptId, recovery.principal, recovery.client, deadline.signal, recovery.epoch);
    recovery.d.phase = "HISTORY_GET";
    let history: OwnerVeoOmniReferenceNativeResultCandidates;
    try {
      history = await this.#await(deadline, () => Reflect.apply(NATIVE_LIST, recovery.client, [nativeInputFor(this.#preparer,
        this.#referenceService, recovery.candidate, recovery.permit, recovery.principal, recovery.attemptId, this.#links, this.#binding, recovery.chat),
        deadline.signal]) as Promise<OwnerVeoOmniReferenceNativeResultCandidates>);
    } catch { recovery.d.history_status = "UNVERIFIED"; recovery.d.gaps = ["HISTORY_GET_UNAVAILABLE"]; throw unknown(recovery); }
    await this.#checkCurrent(recovery.attemptId, recovery.principal, recovery.client, deadline.signal, recovery.epoch);
    recovery.d.history_get_calls += history.history_get_calls;
    recovery.d.owner_ack_status = history.owner_ack_status;
    recovery.d.request_echo_status = history.request_echo_status;
    if (history.status !== "COMPLETE" || history.owner_ack_status !== "MATCHED" || history.history_binding_status !== "BOUND" ||
        history.history_page_status !== "COMPLETE" || history.owner_echo_message_id !== recovery.owner_echo_message_id ||
        history.request_echo_status === "CONTRADICTORY" || history.contexts.length < 1 || history.contexts.length > PAGE_SIZE) {
      recovery.d.history_status = history.status === "PENDING" ? "PENDING" : history.status === "UNVERIFIED" ||
        history.history_page_status === "UNPROVEN" ? "UNVERIFIED" : "INCOMPLETE";
      recovery.d.gaps = safeGaps(history.gaps);
      throw unknown(recovery);
    }
    recovery.d.history_status = "COMPLETE";
    for (const context of history.contexts) {
      if (!validNativeContext(context, recovery)) {
        recovery.d.result_status = "UNVERIFIED";
        recovery.d.gaps = ["RESULT_CONTEXT_UNBOUND"];
        throw unknown(recovery);
      }
      await this.#checkCurrent(recovery.attemptId, recovery.principal, recovery.client, deadline.signal, recovery.epoch);
      recovery.d.phase = "RESULT_GET";
      recovery.d.result_get_calls += 1;
      let result: OwnerVeoOmniReferenceNativeResult;
      try {
        result = await this.#await(deadline, () => Reflect.apply(NATIVE_GET, recovery.client, [Object.freeze({
          result_context: context, principal: recovery.principal, attemptId: recovery.attemptId,
          linkService: this.#links, binding: this.#binding
        }), deadline.signal]) as Promise<OwnerVeoOmniReferenceNativeResult>);
      } catch { recovery.d.result_status = "UNVERIFIED"; recovery.d.gaps = ["RESULT_GET_UNAVAILABLE"]; throw unknown(recovery); }
      await this.#checkCurrent(recovery.attemptId, recovery.principal, recovery.client, deadline.signal, recovery.epoch);
      if (result.message_binding !== "BOUND" || result.model_echo !== "MATCHED" || result.gaps.length !== 0 || result.artifacts.length === 0) {
        recovery.d.result_status = "UNVERIFIED";
        recovery.d.gaps = safeGaps(result.gaps.length ? result.gaps : ["RESULT_NOT_VERIFIED"]);
        throw unknown(recovery);
      }
      for (const artifact of result.artifacts) {
        if (!validArtifact(artifact, context)) {
          recovery.d.result_status = "UNVERIFIED";
          recovery.d.gaps = ["RESULT_ARTIFACT_INVALID"];
          throw unknown(recovery);
        }
        const key = `${context.message_id}:${artifact.message_object_id}`;
        const prior = recovery.artifacts.get(key);
        if (prior) {
          if (!sameArtifact(prior, artifact)) {
            recovery.d.result_status = "UNVERIFIED";
            recovery.d.gaps = ["RESULT_ARTIFACT_CONTRADICTION"];
            throw unknown(recovery);
          }
          continue;
        }
        const previousUrl = recovery.objectUrls.get(artifact.message_object_id);
        if (previousUrl !== undefined && previousUrl !== artifact.object_url) {
          recovery.d.result_status = "UNVERIFIED";
          recovery.d.gaps = ["RESULT_OBJECT_URL_CONTRADICTION"];
          throw unknown(recovery);
        }
        if (recovery.artifacts.size >= MAX_RESULTS) {
          recovery.d.result_status = "UNVERIFIED";
          recovery.d.gaps = ["RESULT_LIMIT_EXCEEDED"];
          throw unknown(recovery);
        }
        recovery.objectUrls.set(artifact.message_object_id, artifact.object_url);
        recovery.artifacts.set(key, Object.freeze({ ...artifact, message_id: context.message_id,
          chat_uuid: context.chat_uuid, model_id: MODEL_ID }));
      }
    }
    await this.#checkCurrent(recovery.attemptId, recovery.principal, recovery.client, deadline.signal, recovery.epoch);
    if (recovery.artifacts.size < 1) {
      recovery.d.result_status = "UNVERIFIED"; recovery.d.gaps = ["RESULT_NOT_OBSERVED"]; throw unknown(recovery);
    }
    recovery.d.phase = "RESULT_GET";
    recovery.d.result_status = "COMPLETE";
    recovery.d.gaps = [];
    recovery.status = "completed";
    return page(recovery, 0);
  }

  #candidateBinding(candidate: unknown, request: OwnerVeoOmniReferenceGenerateInput,
    principal: Readonly<GenerationPrincipalRef>): Readonly<OwnerVeoOmniReferenceCandidateBinding> {
    if (!isOwnerVeoOmniReferencePreparedCandidate(candidate)) fail("PRE_DISPATCH_FAILED");
    const prepared = candidate as OwnerVeoOmniReferencePreparedCandidate;
    let binding: OwnerVeoOmniReferenceCandidateBinding | undefined;
    try { binding = Reflect.apply(PREPARER_INSPECT, this.#preparer, [candidate]) as OwnerVeoOmniReferenceCandidateBinding | undefined; }
    catch { fail("PRE_DISPATCH_FAILED"); }
    if (!binding || binding.attempt_id !== request.attemptId || binding.model_id !== MODEL_ID ||
        binding.profile_sha256 !== OWNER_VEO_OMNI_REFERENCE_PROFILE_SHA256 || !sameGenerationPrincipal(binding.principal, principal) ||
        prepared.status !== "blocked" || prepared.dispatch_allowed !== false || prepared.backend_acceptance !== "UNPROVEN" ||
        prepared.profile_sha256 !== OWNER_VEO_OMNI_REFERENCE_PROFILE_SHA256 || prepared.request_fingerprint !== binding.request_fingerprint ||
        prepared.intent_fingerprint !== binding.intent_fingerprint || prepared.expires_at !== binding.expires_at ||
        binding.expires_at <= this.#readNow() || !/^sha256:[a-f0-9]{64}$/u.test(binding.request_fingerprint) ||
        !/^sha256:[a-f0-9]{64}$/u.test(binding.intent_fingerprint)) fail("PRE_DISPATCH_FAILED");
    if (binding.sources.length !== request.reference_handles.length ||
        binding.sources.some((source, index) => source.reference_handle !== request.reference_handles[index])) fail("PRE_DISPATCH_FAILED");
    return binding;
  }

  #assertChat(chat: OwnerVeoOmniReferenceNativeChatContext, request: OwnerVeoOmniReferenceGenerateInput,
    binding: Readonly<OwnerVeoOmniReferenceCandidateBinding>): void {
    if (!chat || chat.status !== "created" || !safeId(chat.chat_uuid) || chat.attempt_id !== request.attemptId ||
        chat.model_id !== MODEL_ID || chat.profile_sha256 !== binding.profile_sha256 ||
        chat.request_fingerprint !== binding.request_fingerprint || chat.intent_fingerprint !== binding.intent_fingerprint ||
        schemaHash(chat.sources) !== schemaHash(binding.sources) || chat.dispatch_allowed !== false || chat.backend_acceptance !== "UNPROVEN") {
      fail("PRE_DISPATCH_FAILED");
    }
  }

  #assertModel(): void {
    const profile = getOwnerVeoOmniReferenceProfile();
    if (profile.profile_sha256 !== OWNER_VEO_OMNI_REFERENCE_PROFILE_SHA256 ||
        profile.source_pins.public_catalog_version !== this.#catalogVersion || profile.dispatch_allowed !== false ||
        profile.runtime_usable !== false || profile.identity.model_id !== MODEL_ID || profile.identity.ai_name !== AI_NAME) fail("MODEL_BINDING_MISMATCH");
    this.#assertCatalogModel();
  }

  #assertCatalogModel(): void {
    try {
      const record = this.#catalog.getModel(MODEL_ID);
      if (this.#catalog.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || this.#catalog.runtime_usable !== false ||
          this.#catalog.fetched_at !== CATALOG_FETCHED_AT || this.#catalog.source_hashes.models !== MODELS_SHA256 ||
          record.id !== MODEL_ID || record.upstream_id !== MODEL_ID || record.ai_name !== AI_NAME || record.scope !== "video" ||
          record.active !== true || !record.settings || !Array.isArray(record.settings.get_cost_params) ||
          !record.settings.get_cost_params.includes("upscale") || !record.settings.get_cost_params.includes("video_duration") ||
          !record.settings.get_cost_params.includes("mode") || !Array.isArray(record.operations) ||
          !record.operations.some((operation) => operation.id === "generate-video" && operation.output_modality === "video")) {
        fail("MODEL_BINDING_MISMATCH");
      }
    } catch { fail("MODEL_BINDING_MISMATCH"); }
  }

  #modelAccessCatalogVersion(): string {
    return `${this.#catalog.fetched_at}.${this.#catalog.source_hashes.models.slice(7, 19)}`;
  }

  #client(attemptId: string): SyntxChatHttpClient {
    let value: unknown;
    try { value = Reflect.apply(this.#resolveClient, undefined, [attemptId]); } catch { fail("PRINCIPAL_NOT_LINKED"); }
    if (!isNativeClient(value)) fail("MODEL_BINDING_MISMATCH");
    const previous = this.#clients.get(attemptId);
    if (previous && previous !== value) fail("PRINCIPAL_NOT_LINKED");
    this.#clients.set(attemptId, value as SyntxChatHttpClient);
    return value as SyntxChatHttpClient;
  }

  async #principal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    signal?.throwIfAborted();
    if (!ATTEMPT_PATTERN.test(attemptId)) fail("INVALID_REQUEST");
    try {
      const principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#links });
      if (principal.connection_id !== attemptId || principal.tenant_id !== this.#binding.tenant_id || principal.subject_id !== this.#binding.subject) {
        fail("PRINCIPAL_NOT_LINKED");
      }
      signal?.throwIfAborted();
      return principal;
    } catch (error) {
      if (error instanceof OwnerVeoOmniReferenceGenerationServiceError) throw error;
      throw err("PRINCIPAL_NOT_LINKED");
    }
  }

  async #checkCurrent(attemptId: string, principal: Readonly<GenerationPrincipalRef>, client: SyntxChatHttpClient,
    signal?: AbortSignal, expectedEpoch?: number): Promise<void> {
    const latest = await this.#principal(attemptId, signal);
    if (this.#invalidating.has(attemptId) || (expectedEpoch !== undefined && (this.#epochs.get(attemptId) ?? 0) !== expectedEpoch) ||
        !sameGenerationPrincipal(latest, principal) || this.#client(attemptId) !== client) fail("PRINCIPAL_NOT_LINKED");
  }

  #newRecovery(attemptId: string, principal: Readonly<GenerationPrincipalRef>, intentKey: string,
    candidate: OwnerVeoOmniReferencePreparedCandidate, permit: OwnerVeoOmniReferenceOneShotPermit,
    chat: OwnerVeoOmniReferenceNativeChatContext, client: SyntxChatHttpClient,
    binding: Readonly<OwnerVeoOmniReferenceCandidateBinding>, epoch: number): Recovery {
    const now = this.#readNow();
    return { recovery_id: `veo_omni_reference_recovery_${randomUUID()}`, attemptId, intentKey, principal,
      created_at: new Date(now).toISOString(), candidate, permit, chat, client, binding, epoch,
      owner_echo_message_id: null, status: "outcome_unknown", artifacts: new Map(), objectUrls: new Map(),
      d: { phase: "CHAT_CREATE", post_started: false, ack_known: false, history_status: "NOT_READ",
        owner_ack_status: "NOT_READ", request_echo_status: "NOT_READ", history_get_calls: 0,
        result_get_calls: 0, result_status: "NOT_READ", gaps: [] } };
  }

  #owned(attemptId: string, recoveryId: string, principal: Readonly<GenerationPrincipalRef>): Recovery {
    const recovery = this.#recoveries.get(recoveryId);
    if (!recovery || recovery.recovery_id !== recoveryId || recovery.attemptId !== attemptId ||
        this.#invalidating.has(attemptId) || !sameGenerationPrincipal(recovery.principal, principal) ||
        recovery.epoch !== (this.#epochs.get(attemptId) ?? 0) ||
        this.#client(attemptId) !== recovery.client) fail("RECOVERY_NOT_FOUND");
    return recovery;
  }

  #await<T>(deadline: AbsoluteRequestDeadline, operation: () => Promise<T>): Promise<T> {
    deadline.throwIfAborted();
    return deadline.waitFor(operation());
  }

  #run<T>(attemptId: string, parent: AbortSignal | undefined,
    operation: (signal: AbortSignal, epoch: number) => Promise<T>): Promise<T> {
    if (this.#closed || !SERVICES.has(this)) return Promise.reject(err("SERVICE_CLOSED"));
    if (this.#invalidating.has(attemptId) || this.#runs.size >= RUN_LIMIT) return Promise.reject(err("SERVICE_BUSY"));
    const controller = new AbortController();
    const abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    const epoch = this.#epochs.get(attemptId) ?? 0;
    const run: Run = { attemptId, controller, promise: Promise.resolve() };
    const promise = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new OwnerVeoOmniReferenceGenerationServiceError("SERVICE_BUSY");
      return operation(controller.signal, epoch);
    }).finally(() => {
      parent?.removeEventListener("abort", abort);
      this.#runs.delete(run);
    });
    run.promise = promise;
    this.#runs.add(run);
    return promise;
  }

  #readNow(): number {
    let value: unknown;
    try { value = Reflect.apply(this.#now, undefined, []); } catch { fail("SERVICE_BUSY"); }
    if (!Number.isSafeInteger(value) || (value as number) < this.#lastNow || (value as number) < 0) fail("SERVICE_BUSY");
    this.#lastNow = value as number;
    return value as number;
  }

  #assertOpen(): void { if (this.#closed || !SERVICES.has(this)) fail("SERVICE_CLOSED"); }
}

Object.freeze(OwnerVeoOmniReferenceGenerationService.prototype);

export function isOwnerVeoOmniReferenceGenerationService(value: unknown): value is OwnerVeoOmniReferenceGenerationService {
  return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) &&
    Object.getPrototypeOf(value) === OwnerVeoOmniReferenceGenerationService.prototype && Object.isFrozen(value);
}

function snapshotGenerate(value: unknown): OwnerVeoOmniReferenceGenerateInput {
  let normalized: ReturnType<typeof normalizeOwnerVeoOmniReferenceGenerationInput>;
  try { normalized = normalizeOwnerVeoOmniReferenceGenerationInput(value); } catch { invalid(); }
  return Object.freeze({ attemptId: normalized!.attemptId, prompt: normalized!.prompt, input_type: normalized!.input_type,
    upscale: normalized!.upscale, aspect_ratio: normalized!.aspect_ratio, video_duration: normalized!.video_duration,
    reference_handles: Object.freeze([...normalized!.reference_handles]) });
}

function snapshotRecovery(value: unknown): OwnerVeoOmniReferenceReconcileInput {
  const fields = exact(value, ["attemptId", "recovery_id"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId) ||
      typeof fields.recovery_id !== "string" || !RECOVERY_PATTERN.test(fields.recovery_id)) invalid();
  return Object.freeze({ attemptId: fields.attemptId, recovery_id: fields.recovery_id });
}

function snapshotList(value: unknown): Readonly<{ attemptId: string; limit: number }> {
  const fields = exact(value, ["attemptId"], ["limit"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId)) invalid();
  return Object.freeze({ attemptId: fields.attemptId, limit: bounded(fields.limit, 1, RECOVERY_LIMIT, 20) });
}

function snapshotPage(value: unknown): Readonly<{ attemptId: string; recovery_id: string; offset: number }> {
  const fields = exact(value, ["attemptId", "recovery_id"], ["offset"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId) ||
      typeof fields.recovery_id !== "string" || !RECOVERY_PATTERN.test(fields.recovery_id)) invalid();
  return Object.freeze({ attemptId: fields.attemptId, recovery_id: fields.recovery_id, offset: bounded(fields.offset, 0, MAX_RESULTS, 0) });
}

function snapshotSubscription(value: unknown): Readonly<SyntxSubscription> {
  const fields = exact(value, ["active", "plan_type", "end_date", "end_date_kind"]);
  if (!(fields.active === true || fields.active === false || fields.active === null) ||
      !(fields.plan_type === null || typeof fields.plan_type === "string") ||
      !(fields.end_date === null || typeof fields.end_date === "string") ||
      !(fields.end_date_kind === null || ["DATE_ONLY", "LOCAL_DATETIME", "OFFSET_DATETIME"].includes(String(fields.end_date_kind)))) {
    fail("SUBSCRIPTION_STATUS_UNVERIFIED");
  }
  return Object.freeze({ active: fields.active as boolean | null, plan_type: fields.plan_type as string | null,
    end_date: fields.end_date as string | null,
    end_date_kind: fields.end_date_kind as SyntxSubscription["end_date_kind"] });
}

function snapshotCostParameters(value: unknown, hasVideo: boolean, request: OwnerVeoOmniReferenceGenerateInput): Readonly<Record<string, SyntxCostParameter>> {
  const expected = hasVideo ? ["mode", "upscale", "video_duration"] : ["upscale", "video_duration"];
  const fields = exact(value, expected);
  if (fields.upscale !== request.upscale || fields.video_duration !== request.video_duration ||
      (hasVideo && (fields.mode !== "video_ref" || request.input_type !== "references"))) fail("PREFLIGHT_FAILED");
  if (typeof fields.upscale !== "number" || !Number.isFinite(fields.upscale) || fields.upscale < 0 ||
      typeof fields.video_duration !== "number" || !Number.isFinite(fields.video_duration) || fields.video_duration < 0) fail("PREFLIGHT_FAILED");
  return Object.freeze({ upscale: fields.upscale, video_duration: fields.video_duration,
    ...(hasVideo ? { mode: "video_ref" as const } : {}) });
}

function validNativeContext(context: OwnerVeoOmniReferenceNativeResultContext, recovery: Recovery): boolean {
  return context && context.chat_uuid === recovery.chat.chat_uuid && context.attempt_id === recovery.attemptId &&
    context.model_id === MODEL_ID && context.profile_sha256 === recovery.binding.profile_sha256 &&
    context.request_fingerprint === recovery.binding.request_fingerprint && context.intent_fingerprint === recovery.binding.intent_fingerprint &&
    context.owner_echo_message_id === recovery.owner_echo_message_id && safeId(context.message_id) &&
    /^\d{1,16}$/u.test(context.provider_chat_id) && Array.isArray(context.message_object_ids) &&
    context.message_object_ids.length > 0 && context.message_object_ids.length <= PAGE_SIZE &&
    new Set(context.message_object_ids).size === context.message_object_ids.length;
}

function validArtifact(artifact: OwnerVeoOmniReferenceNativeVideoArtifact, context: OwnerVeoOmniReferenceNativeResultContext): boolean {
  return artifact.object_type === "video" && Number.isSafeInteger(artifact.object_index) && artifact.object_index >= 0 &&
    context.message_object_ids.includes(artifact.message_object_id) && safeId(artifact.message_object_id) &&
    isSafeUploadReferenceUrl(artifact.object_url) &&
    (artifact.mime_type === null || artifact.mime_type === "video/mp4" || artifact.mime_type === "video/quicktime") &&
    artifact.mime_source === (artifact.mime_type === null ? "UNKNOWN" : "URL_EXTENSION");
}

function sameArtifact(left: OwnerVeoOmniReferenceGenerationArtifact, right: OwnerVeoOmniReferenceNativeVideoArtifact): boolean {
  return left.object_index === right.object_index && left.message_object_id === right.message_object_id &&
    left.object_url === right.object_url && left.object_type === right.object_type && left.mime_type === right.mime_type &&
    left.mime_source === right.mime_source;
}

function page(recovery: Recovery, offset: number): OwnerVeoOmniReferenceGenerationResult {
  const all = [...recovery.artifacts.values()];
  const artifacts = Object.freeze(all.slice(offset, offset + PAGE_SIZE));
  const next = offset + artifacts.length;
  return Object.freeze({ status: "completed", status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", backend_acceptance: "UNPROVEN",
    provider_terminal_status: "UNPROVEN", cost_cap_enforced: false, output_count: "UNKNOWN", recovery_id: recovery.recovery_id,
    model_id: MODEL_ID, source_binding: Object.freeze({ public_catalog_version: CATALOG_VERSION,
      profile_sha256: OWNER_VEO_OMNI_REFERENCE_PROFILE_SHA256, request_fingerprint: recovery.binding.request_fingerprint,
      intent_fingerprint: recovery.binding.intent_fingerprint }), observed_artifact_count: all.length, offset, page_size: PAGE_SIZE,
    artifacts, has_more: next < all.length, next_offset: next < all.length ? next : null, diagnostic: diagnostic(recovery.d) });
}

function diagnostic(input: Recovery["d"]): OwnerVeoOmniReferenceGenerationDiagnostic {
  return Object.freeze({ ...input, gaps: Object.freeze(input.gaps.slice(0, 32)) });
}

function recoveryItem(recovery: Recovery): OwnerVeoOmniReferenceRecoveryListItem {
  return Object.freeze({ recovery_id: recovery.recovery_id, created_at: recovery.created_at, model_id: MODEL_ID,
    status: recovery.status, observed_artifact_count: recovery.artifacts.size, diagnostic: diagnostic(recovery.d) });
}

function unknown(recovery: Recovery): OwnerVeoOmniReferenceGenerationServiceError {
  return new OwnerVeoOmniReferenceGenerationServiceError("OUTCOME_UNKNOWN", recovery.recovery_id, diagnostic(recovery.d));
}

function safeGaps(input: readonly string[]): string[] {
  return [...new Set(input.filter((gap) => /^[A-Z][A-Z0-9_]{0,127}$/u.test(gap)))].slice(0, 32);
}

function nativeInputFor(preparer: OwnerVeoOmniReferenceRequestPreparer, referenceService: OwnerVeoOmniReferenceService,
  candidate: OwnerVeoOmniReferencePreparedCandidate, permit: OwnerVeoOmniReferenceOneShotPermit,
  principal: Readonly<GenerationPrincipalRef>, attemptId: string,
  linkService: PerUserLinkService, binding: Readonly<AuthBinding>, chat?: OwnerVeoOmniReferenceNativeChatContext) {
  return Object.freeze({ preparer, candidate, permit, referenceService, principal, attemptId, linkService, binding,
    ...(chat === undefined ? {} : { chat }) });
}

function isOwnerVeoOmniReferenceRequestPreparerBound(preparer: OwnerVeoOmniReferenceRequestPreparer,
  referenceService: OwnerVeoOmniReferenceService): boolean {
  try { return Reflect.apply(PREPARER_BOUND_TO_STORE, preparer, [referenceService]) === true; }
  catch { return false; }
}

function isNativeClient(value: unknown): value is SyntxChatHttpClient {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  try {
    if (Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype) return false;
    return ["createChat", "uploadOwnerVeoOmniReference", "createOwnerVeoOmniReferenceChat",
      "startOwnerVeoOmniReferenceWithOwnedCandidate", "listOwnedVeoOmniReferenceCandidates", "getOwnedVeoOmniReferenceResult"].every((name) => {
      const expected = name === "createChat" ? NATIVE_CHAT_CREATE : name === "uploadOwnerVeoOmniReference" ? NATIVE_UPLOAD :
        name === "createOwnerVeoOmniReferenceChat" ? NATIVE_CREATE : name === "startOwnerVeoOmniReferenceWithOwnedCandidate" ? NATIVE_START :
          name === "listOwnedVeoOmniReferenceCandidates" ? NATIVE_LIST : NATIVE_GET;
      return !Object.hasOwn(value, name) && SyntxChatHttpClient.prototype[name as keyof SyntxChatHttpClient] === expected &&
        getDataMethod(value, name) === expected && Reflect.get(value, name) === expected;
    });
  } catch { return false; }
}

function genuineAccountService(value: unknown): value is AccountStatusService {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === AccountStatusService.prototype &&
    !Object.hasOwn(value, "getAccountStatus") && AccountStatusService.prototype.getAccountStatus === ACCOUNT_STATUS_GET &&
    getDataMethod(value, "getAccountStatus") === ACCOUNT_STATUS_GET && Reflect.get(value, "getAccountStatus") === ACCOUNT_STATUS_GET;
}

function genuineAccessService(value: unknown): value is ModelAccessService {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === ModelAccessService.prototype &&
    !Object.hasOwn(value, "getModelAccess") && ModelAccessService.prototype.getModelAccess === MODEL_ACCESS_GET &&
    getDataMethod(value, "getModelAccess") === MODEL_ACCESS_GET && Reflect.get(value, "getModelAccess") === MODEL_ACCESS_GET;
}

function isGenuineLinkService(value: unknown): value is PerUserLinkService {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== PerUserLinkService.prototype ||
      PerUserLinkService.prototype.getStatus !== LINK_STATUS || Object.hasOwn(value, "getStatus")) return false;
  const descriptor = Object.getOwnPropertyDescriptor(PerUserLinkService.prototype, "getStatus");
  return !!descriptor && "value" in descriptor && descriptor.value === LINK_STATUS;
}

function exactSignal(signal: AbortSignal | undefined): AbortSignal | undefined {
  if (signal === undefined) return undefined;
  if (!signal || typeof signal !== "object" || types.isProxy(signal) || !(signal instanceof AbortSignal) ||
      Object.getPrototypeOf(signal) !== AbortSignal.prototype) invalid();
  return signal;
}

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exact(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || !fields.tenant_id.trim() || fields.tenant_id.length > 256 ||
      typeof fields.subject !== "string" || !fields.subject.trim() || fields.subject.length > 512 ||
      /[\u0000-\u001f\u007f]/u.test(fields.tenant_id) || /[\u0000-\u001f\u007f]/u.test(fields.subject)) invalid();
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}

function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  let prototype: object | null, descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); } catch { invalid(); }
  const keys = Reflect.ownKeys(descriptors), allowed = [...required, ...optional];
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !Object.hasOwn(descriptors[key]!, "value") ||
        descriptors[key]!.enumerable !== true)) invalid();
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) copy[key] = descriptors[key]!.value;
  return copy;
}

function semanticIntentKey(principal: Readonly<GenerationPrincipalRef>, fingerprint: string): string {
  return JSON.stringify([principal.tenant_id, principal.subject_id, fingerprint]);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function fresh(value: string, now: number): boolean {
  const parsed = Date.parse(value);
  return typeof value === "string" && Number.isFinite(parsed) && Math.abs(parsed - now) < 300_000;
}

function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }

function safeId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u.test(value); }

function bounded(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) invalid();
  return value as number;
}

function readAttempt(value: unknown): string {
  if (typeof value !== "string" || !ATTEMPT_PATTERN.test(value)) invalid();
  return value;
}

function readClock(value: unknown): () => number {
  if (typeof value !== "function" || types.isProxy(value)) invalid();
  return value as () => number;
}

function getDataMethod(target: object, key: string): unknown {
  let current: object | null = target;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function err(code: OwnerVeoOmniReferenceGenerationServiceErrorCode): OwnerVeoOmniReferenceGenerationServiceError {
  return new OwnerVeoOmniReferenceGenerationServiceError(code);
}
function fail(code: OwnerVeoOmniReferenceGenerationServiceErrorCode): never { throw err(code); }
function invalid(): never { return fail("INVALID_REQUEST"); }
