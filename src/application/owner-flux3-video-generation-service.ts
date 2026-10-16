import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { readOwnerFlux3VideoNativeDispatchStatus } from "../adapter/syntx/owner-flux3-video-native-context.js";
import type {
  OwnerFlux3VideoNativeChatContext,
  OwnerFlux3VideoNativeResultCandidates,
  OwnerFlux3VideoNativeResultContext,
  OwnerFlux3VideoNativeVideoArtifact
} from "../adapter/syntx/owner-flux3-video-native-context.js";
import { OwnerFlux3VideoNativeError } from "../adapter/syntx/owner-flux3-video-native-context.js";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { resolveOwnerReferencePrincipal, OwnerReferencePrincipalError } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { AccountStatusService, type AccountStatusResult } from "./account-status.js";
import { ModelAccessService, type ModelAccessResult } from "./model-access.js";
import { OwnerFlux3MediaReferenceService } from "./owner-flux3-media-reference-service.js";
import {
  createOwnerFlux3VideoOwnedOneShotPermit,
  revalidateOwnerFlux3VideoOwnedOneShotPermit,
  type OwnerFlux3VideoOwnedOneShotPermit
} from "./owner-flux3-video-owned-one-shot-policy.js";
import {
  isOwnerFlux3VideoOwnedRequestPreparer,
  isOwnerFlux3VideoOwnedRequestPreparerBoundToReferenceService,
  OwnerFlux3VideoOwnedRequestPreparer,
  type OwnerFlux3VideoOwnedCandidateBinding,
  type OwnerFlux3VideoOwnedPreparedCandidate
} from "./owner-flux3-video-owned-request-preparer.js";
import {
  normalizeOwnerFlux3VideoParameters,
  projectOwnerFlux3VideoCostParameters,
  type OwnerFlux3VideoParameterValues,
  type OwnerFlux3VideoCostParameters
} from "./owner-flux3-video-parameters.js";
import {
  getOwnerFlux3VideoSourceProfile,
  OWNER_FLUX3_VIDEO_MODEL_IDS,
  OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION,
  type OwnerFlux3VideoModelId
} from "./owner-flux3-video-source-profile.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";

export const OWNER_FLUX3_VIDEO_GENERATION_CATALOG_VERSION = OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION;
const ACCOUNT = AccountStatusService.prototype.getAccountStatus;
const ACCESS = ModelAccessService.prototype.getModelAccess;
const CREATE = SyntxChatHttpClient.prototype.createOwnerFlux3VideoChat;
const START = SyntxChatHttpClient.prototype.startFlux3VideoWithOwnedCandidate;
const LIST = SyntxChatHttpClient.prototype.listOwnedFlux3VideoCandidates;
const GET = SyntxChatHttpClient.prototype.getOwnedFlux3VideoResult;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY = /^flux3_video_recovery_[0-9a-f-]{36}$/u;
const SERVICES = new WeakSet<object>();
const MAX_RECOVERIES = 128, MAX_RUNS = 4, PAGE_SIZE = 64;

export type OwnerFlux3VideoGenerationPhase = "VALIDATE_REQUEST" | "PREFLIGHT_ONE" | "CHAT_CREATE" |
  "PREFLIGHT_TWO" | "GENERATION_POST" | "POST_ACK_KNOWN" | "HISTORY_GET" | "RESULT_GET";
export interface OwnerFlux3VideoGenerationDiagnostic {
  readonly phase: OwnerFlux3VideoGenerationPhase;
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
export interface OwnerFlux3VideoGenerationArtifact extends OwnerFlux3VideoNativeVideoArtifact {
  readonly message_id: string;
  readonly chat_uuid: string;
  readonly model_id: OwnerFlux3VideoModelId;
}
export interface OwnerFlux3VideoGenerationResult {
  readonly status: "completed";
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly backend_acceptance: "UNPROVEN";
  readonly provider_terminal_status: "UNPROVEN";
  readonly cost_cap_enforced: false;
  readonly output_count: "UNKNOWN";
  readonly recovery_id: string;
  readonly model_id: OwnerFlux3VideoModelId;
  readonly source_binding: Readonly<{
    public_catalog_version: string;
    profile_schema_hash: string;
    request_fingerprint: string;
    intent_fingerprint: string;
  }>;
  readonly observed_artifact_count: number;
  readonly offset: number;
  readonly page_size: 64;
  readonly artifacts: readonly OwnerFlux3VideoGenerationArtifact[];
  readonly has_more: boolean;
  readonly next_offset: number | null;
  readonly diagnostic: OwnerFlux3VideoGenerationDiagnostic;
}
export interface OwnerFlux3VideoRecoveryListItem {
  readonly recovery_id: string;
  readonly created_at: string;
  readonly model_id: OwnerFlux3VideoModelId;
  readonly status: "outcome_unknown" | "completed";
  readonly observed_artifact_count: number;
  readonly diagnostic: OwnerFlux3VideoGenerationDiagnostic;
}
export interface OwnerFlux3VideoGenerationServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string;
  readonly preparer: OwnerFlux3VideoOwnedRequestPreparer;
  readonly referenceService: OwnerFlux3MediaReferenceService;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly createAccountStatusService: (attemptId: string) => AccountStatusService;
  readonly createModelAccessService: (attemptId: string) => ModelAccessService;
  readonly now?: () => number;
}
export interface OwnerFlux3VideoGenerateInput {
  readonly attemptId: string;
  readonly request: Readonly<{
    model_id: OwnerFlux3VideoModelId;
    prompt: string;
    flux3_reference_handles: readonly string[];
    parameters: OwnerFlux3VideoParameterValues;
  }>;
}
export interface OwnerFlux3VideoReconcileInput { readonly attemptId: string; readonly recovery_id: string; }
export interface OwnerFlux3VideoRecoveryListInput { readonly attemptId: string; readonly limit?: number; }
export interface OwnerFlux3VideoResultPageInput { readonly attemptId: string; readonly recovery_id: string; readonly offset?: number; }
export type OwnerFlux3VideoGenerationServiceErrorCode = "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" |
  "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH" | "PREFLIGHT_FAILED" | "INTENT_ALREADY_CLAIMED" |
  "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND";
export class OwnerFlux3VideoGenerationServiceError extends Error {
  readonly diagnostic?: OwnerFlux3VideoGenerationDiagnostic;
  constructor(readonly code: OwnerFlux3VideoGenerationServiceErrorCode, readonly recovery_id?: string,
    diagnostic?: OwnerFlux3VideoGenerationDiagnostic) {
    super("The owner Flux3 video request could not be completed safely.");
    this.name = "OwnerFlux3VideoGenerationServiceError";
    if (code === "OUTCOME_UNKNOWN" && diagnostic) this.diagnostic = diagnostic;
  }
}

interface Recovery {
  recovery_id: string;
  attemptId: string;
  semantic_key: string;
  principal: Readonly<GenerationPrincipalRef>;
  created_at: string;
  candidate: OwnerFlux3VideoOwnedPreparedCandidate;
  permit: OwnerFlux3VideoOwnedOneShotPermit;
  chat: OwnerFlux3VideoNativeChatContext;
  client: SyntxChatHttpClient;
  binding: Readonly<OwnerFlux3VideoOwnedCandidateBinding>;
  owner_echo_message_id: string | null;
  status: "outcome_unknown" | "completed";
  artifacts: readonly OwnerFlux3VideoGenerationArtifact[];
  d: {
    phase: OwnerFlux3VideoGenerationPhase;
    post_started: boolean;
    ack_known: boolean;
    history_status: OwnerFlux3VideoGenerationDiagnostic["history_status"];
    owner_ack_status: OwnerFlux3VideoGenerationDiagnostic["owner_ack_status"];
    request_echo_status: OwnerFlux3VideoGenerationDiagnostic["request_echo_status"];
    history_get_calls: number;
    result_get_calls: number;
    result_status: OwnerFlux3VideoGenerationDiagnostic["result_status"];
    gaps: string[];
  };
}
interface Run { attemptId: string; controller: AbortController; promise: Promise<unknown>; }

/** Owner-bound Flux3 orchestration. The media-reference service is borrowed; only the preparer is closed here. */
export class OwnerFlux3VideoGenerationService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #links: PerUserLinkService;
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #catalogVersion: string;
  readonly #preparer: OwnerFlux3VideoOwnedRequestPreparer;
  readonly #referenceService: OwnerFlux3MediaReferenceService;
  readonly #resolveClient: OwnerFlux3VideoGenerationServiceOptions["resolveChatClient"];
  readonly #createAccount: OwnerFlux3VideoGenerationServiceOptions["createAccountStatusService"];
  readonly #createAccess: OwnerFlux3VideoGenerationServiceOptions["createModelAccessService"];
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #recoveries = new Map<string, Recovery>();
  readonly #claims = new Set<string>();
  readonly #reserved = new Set<string>();
  readonly #runs = new Set<Run>();
  readonly #invalidating = new Set<string>();
  readonly #clients = new Map<string, SyntxChatHttpClient>();
  readonly #usedAccounts = new WeakSet<object>();
  readonly #usedAccess = new WeakSet<object>();
  #closed = false;
  #closing?: Promise<void>;
  #lastNow = -1;

  constructor(value: OwnerFlux3VideoGenerationServiceOptions | unknown) {
    const o = exact(value, ["binding", "linkService", "catalog", "catalog_version", "preparer", "referenceService",
      "resolveChatClient", "createAccountStatusService", "createModelAccessService"], ["now"]);
    if (!(o.catalog instanceof DiscoveryCatalogRepository) || o.catalog_version !== OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION ||
        !isOwnerFlux3VideoOwnedRequestPreparer(o.preparer) || !(o.referenceService instanceof OwnerFlux3MediaReferenceService) ||
        !isOwnerFlux3VideoOwnedRequestPreparerBoundToReferenceService(o.preparer, o.referenceService) ||
        !(o.linkService instanceof PerUserLinkService) || typeof o.resolveChatClient !== "function" ||
        typeof o.createAccountStatusService !== "function" || typeof o.createModelAccessService !== "function") invalid();
    this.#binding = readBinding(o.binding); this.#links = o.linkService; this.#catalog = o.catalog;
    this.#catalogVersion = o.catalog_version; this.#preparer = o.preparer; this.#referenceService = o.referenceService;
    this.#resolveClient = o.resolveChatClient; this.#createAccount = o.createAccountStatusService;
    this.#createAccess = o.createModelAccessService; this.#now = clock(o.now);
    this.#timeoutMs = 120_000; this.#assertModel(); SERVICES.add(this); Object.freeze(this);
  }

  generate(input: OwnerFlux3VideoGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerFlux3VideoGenerationResult> {
    const request = readGenerateInput(input); return this.#run(request.attemptId, signal, s => this.#generate(request, s));
  }
  reconcile(input: OwnerFlux3VideoReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerFlux3VideoGenerationResult> {
    const req = readRecoveryInput(input);
    return this.#run(req.attemptId, signal, async s => {
      const recovery = this.#owned(req.attemptId, req.recovery_id, await this.#principal(req.attemptId));
      if (recovery.status === "completed") return page(recovery, 0);
      const deadline = new AbsoluteRequestDeadline(this.#timeoutMs, s, () => unknown(recovery));
      try {
        await this.#checkPrincipal(req.attemptId, recovery.principal);
        if (this.#client(req.attemptId) !== recovery.client) fail("RECOVERY_NOT_FOUND");
        return await this.#observe(recovery, deadline);
      } catch { throw unknown(recovery); } finally { deadline.close(); }
    });
  }
  listRecoveries(input: OwnerFlux3VideoRecoveryListInput | unknown): Promise<readonly OwnerFlux3VideoRecoveryListItem[]> {
    const req = readListInput(input);
    return this.#run(req.attemptId, undefined, async () => {
      const principal = await this.#principal(req.attemptId);
      return Object.freeze([...this.#recoveries.values()].filter(r => r.attemptId === req.attemptId &&
        sameGenerationPrincipal(r.principal, principal)).slice(0, req.limit).map(item));
    });
  }
  getResultPage(input: OwnerFlux3VideoResultPageInput | unknown): Promise<OwnerFlux3VideoGenerationResult> {
    const req = readPageInput(input);
    return this.#run(req.attemptId, undefined, async () => {
      const recovery = this.#owned(req.attemptId, req.recovery_id, await this.#principal(req.attemptId));
      if (recovery.status !== "completed") throw unknown(recovery);
      return page(recovery, req.offset);
    });
  }
  async invalidateAttempt(value: unknown): Promise<void> {
    const id = attempt(value); this.#invalidating.add(id); await this.#preparer.invalidateAttempt(id);
    const active = [...this.#runs].filter(r => r.attemptId === id); active.forEach(r => r.controller.abort());
    await Promise.allSettled(active.map(r => r.promise));
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true; for (const run of this.#runs) run.controller.abort();
    const ids = new Set([...this.#runs].map(r => r.attemptId));
    this.#closing = (async () => {
      for (const id of ids) await this.#preparer.invalidateAttempt(id);
      await Promise.allSettled([...this.#runs].map(r => r.promise));
      await this.#preparer.close(); this.#runs.clear();
    })();
    return this.#closing;
  }

  async #generate(req: OwnerFlux3VideoGenerateInput, signal: AbortSignal): Promise<OwnerFlux3VideoGenerationResult> {
    const deadline = new AbsoluteRequestDeadline(this.#timeoutMs, signal, () => err("PRE_DISPATCH_FAILED"));
    let candidate: OwnerFlux3VideoOwnedPreparedCandidate | undefined, permit: OwnerFlux3VideoOwnedOneShotPermit | undefined;
    let key: string | undefined, ownsReservation = false, recovery: Recovery | undefined, post = false, client: SyntxChatHttpClient | undefined;
    const releaseReservation = () => {
      if (key && ownsReservation) { this.#reserved.delete(key); ownsReservation = false; }
    };
    try {
      deadline.throwIfAborted(); this.#assertModel();
      const principal = await this.#principal(req.attemptId);
      candidate = await this.#await(deadline, () => this.#preparer.prepare({ attemptId: req.attemptId, request: req.request }));
      const binding = this.#preparer.inspectCandidate(candidate);
      if (!binding || binding.model_id !== req.request.model_id || binding.attempt_id !== req.attemptId ||
          !sameGenerationPrincipal(binding.principal, principal)) fail("PRE_DISPATCH_FAILED");
      key = JSON.stringify([principal.tenant_id, principal.subject_id, binding.intent_fingerprint]);
      if (this.#claims.has(key) || this.#reserved.has(key)) fail("INTENT_ALREADY_CLAIMED");
      if (this.#recoveries.size + this.#reserved.size >= MAX_RECOVERIES) fail("SERVICE_BUSY");
      this.#reserved.add(key);
      ownsReservation = true;
      permit = await createOwnerFlux3VideoOwnedOneShotPermit({ preparer: this.#preparer, candidate, principal, attemptId: req.attemptId });
      await this.#preflight(req.attemptId, binding, deadline);
      client = this.#client(req.attemptId);
      const native = Object.freeze({ preparer: this.#preparer, candidate, permit, referenceService: this.#referenceService,
        principal, attemptId: req.attemptId, linkService: this.#links, binding: this.#binding });
      const chat = await this.#await(deadline, () => Reflect.apply(CREATE, client!, [native, deadline.signal]) as Promise<OwnerFlux3VideoNativeChatContext>);
      if (!chat || chat.model_id !== req.request.model_id || chat.attempt_id !== req.attemptId || chat.dispatch_allowed !== false ||
          chat.backend_acceptance !== "UNPROVEN" || chat.profile_schema_hash !== binding.profile_schema_hash ||
          chat.request_fingerprint !== binding.request_fingerprint || chat.intent_fingerprint !== binding.intent_fingerprint) fail("PRE_DISPATCH_FAILED");
      await this.#checkPrincipal(req.attemptId, principal);
      if (this.#client(req.attemptId) !== client) fail("PRINCIPAL_NOT_LINKED");
      await this.#preflight(req.attemptId, binding, deadline);
      await this.#checkPrincipal(req.attemptId, principal);
      await this.#preparer.revalidateCandidate(candidate);
      await revalidateOwnerFlux3VideoOwnedOneShotPermit({ preparer: this.#preparer, candidate, permit, principal, attemptId: req.attemptId });
      recovery = this.#new(req.attemptId, principal, key, candidate, permit, chat, client, binding);
      this.#recoveries.set(recovery.recovery_id, recovery);
      recovery.d.phase = "GENERATION_POST";
      recovery.d.post_started = true;
      post = true;
      let ack: { chat_uuid: string; message_id: string };
      try {
        ack = await this.#await(deadline, () => Reflect.apply(START, client!, [Object.freeze({ ...native, chat }), deadline.signal]) as Promise<{ chat_uuid: string; message_id: string }>);
      } catch {
        const dispatch = readOwnerFlux3VideoNativeDispatchStatus(client, chat);
        if (!dispatch?.dispatch_attempted) {
          this.#recoveries.delete(recovery.recovery_id); releaseReservation(); key = undefined;
          fail("PRE_DISPATCH_FAILED");
        }
        this.#claims.add(key); releaseReservation(); key = undefined;
        throw unknown(recovery);
      }
      if (!ack || ack.chat_uuid !== chat.chat_uuid || !safeId(ack.message_id)) {
        const dispatch = readOwnerFlux3VideoNativeDispatchStatus(client, chat);
        if (!dispatch?.dispatch_attempted) { this.#recoveries.delete(recovery.recovery_id); fail("PRE_DISPATCH_FAILED"); }
        this.#claims.add(key); releaseReservation(); key = undefined; throw unknown(recovery);
      }
      this.#claims.add(key); releaseReservation(); key = undefined;
      const nativeStatus = readOwnerFlux3VideoNativeDispatchStatus(client, chat);
      if (!nativeStatus?.owner_ack_bound || nativeStatus.owner_echo_message_id !== ack.message_id) throw unknown(recovery);
      recovery.owner_echo_message_id = ack.message_id;
      recovery.d.ack_known = true; recovery.d.owner_ack_status = "MATCHED"; recovery.d.phase = "POST_ACK_KNOWN";
      return await this.#observe(recovery, deadline);
    } catch (error) {
      if (post && recovery) {
        const dispatch = client ? readOwnerFlux3VideoNativeDispatchStatus(client, recovery.chat) : null;
        if (dispatch?.dispatch_attempted) {
          this.#claims.add(recovery.semantic_key); releaseReservation(); key = undefined;
          if (dispatch.owner_ack_bound && dispatch.owner_echo_message_id) {
            recovery.owner_echo_message_id = dispatch.owner_echo_message_id; recovery.d.ack_known = true;
            recovery.d.owner_ack_status = "MATCHED"; recovery.d.phase = "POST_ACK_KNOWN";
          }
          throw unknown(recovery);
        }
        this.#recoveries.delete(recovery.recovery_id);
      }
      releaseReservation();
      if (error instanceof OwnerFlux3VideoGenerationServiceError) throw error;
      if (error instanceof OwnerFlux3VideoNativeError && error.code === "PRINCIPAL_NOT_LINKED") fail("PRINCIPAL_NOT_LINKED");
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      return fail("PRE_DISPATCH_FAILED");
    } finally { releaseReservation(); deadline.close(); }
  }

  async #preflight(id: string, b: Readonly<OwnerFlux3VideoOwnedCandidateBinding>, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted();
    let accountService: AccountStatusService, accessService: ModelAccessService;
    try { accountService = this.#createAccount(id); accessService = this.#createAccess(id); } catch { fail("PREFLIGHT_FAILED"); }
    if (!(accountService! instanceof AccountStatusService) || this.#usedAccounts.has(accountService!) ||
        !(accessService! instanceof ModelAccessService) || this.#usedAccess.has(accessService!)) fail("PREFLIGHT_FAILED");
    this.#usedAccounts.add(accountService!); this.#usedAccess.add(accessService!);
    let account: AccountStatusResult, quote: ModelAccessResult;
    const normalized = normalizeOwnerFlux3VideoParameters({ model_id: b.model_id, parameters: b.parameters });
    const costParameters: OwnerFlux3VideoCostParameters = projectOwnerFlux3VideoCostParameters(normalized);
    try {
      account = await this.#await(deadline, () => Reflect.apply(ACCOUNT, accountService!, [deadline.signal]));
      quote = await this.#await(deadline, () => Reflect.apply(ACCESS, accessService!, [{ model_id: b.model_id, cost_parameters: costParameters }, deadline.signal]));
    } catch { fail("PREFLIGHT_FAILED"); }
    const now = this.#readNow(), model = this.#catalog.getModel(b.model_id), cost = quote!.discount_cost ?? quote!.cost;
    if (!validAccount(account!, now) || quote!.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" ||
        quote!.catalog_version !== `${this.#catalog.fetched_at}.${this.#catalog.source_hashes.models.slice(7, 19)}` ||
        quote!.model_id !== b.model_id || quote!.ai_name !== "flux3_video" || quote!.model_type !== b.model_id ||
        quote!.account_read_live !== true || quote!.access !== true || quote!.parameters_redacted !== true ||
        !sameStrings(quote!.parameter_keys, ["resolution", "video_duration"]) || !finite(cost) ||
        !finiteDecimal(account!.balance.available) || !lessThanOrEqualDecimal(String(cost), account!.balance.available) ||
        !fresh(quote!.observed_at, now) || !model.active) fail("PREFLIGHT_FAILED");
  }

  #assertModel(): true {
    try {
      const modelIds = [...OWNER_FLUX3_VIDEO_MODEL_IDS];
      if (this.#catalogVersion !== OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION) fail("MODEL_BINDING_MISMATCH");
      for (const id of modelIds) {
        const profile = getOwnerFlux3VideoSourceProfile(id), model = this.#catalog.getModel(id);
        if (!profile || profile.ai_name !== "flux3_video" || profile.catalog_scope !== "video" ||
            profile.source_pins.public_catalog_version !== this.#catalogVersion || model.id !== id ||
            model.upstream_id !== id || model.ai_name !== "flux3_video" || model.scope !== "video" || !model.active ||
            !sameStrings(model.settings?.get_cost_params ?? [], ["video_duration", "resolution", "draft"])) fail("MODEL_BINDING_MISMATCH");
      }
      return true;
    } catch { return fail("MODEL_BINDING_MISMATCH"); }
  }
  #client(id: string): SyntxChatHttpClient {
    let value: unknown; try { value = this.#resolveClient(id); } catch { fail("PRE_DISPATCH_FAILED"); }
    if (!value || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype) fail("PRE_DISPATCH_FAILED");
    const previous = this.#clients.get(id); if (previous && previous !== value) fail("PRINCIPAL_NOT_LINKED");
    this.#clients.set(id, value as SyntxChatHttpClient); return value as SyntxChatHttpClient;
  }
  async #principal(id: string): Promise<Readonly<GenerationPrincipalRef>> {
    try {
      const principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: id, linkService: this.#links });
      if (principal.connection_id !== id) fail("PRINCIPAL_NOT_LINKED"); return principal;
    } catch { return fail("PRINCIPAL_NOT_LINKED"); }
  }
  async #checkPrincipal(id: string, principal: Readonly<GenerationPrincipalRef>): Promise<void> {
    if (!sameGenerationPrincipal(await this.#principal(id), principal) || this.#invalidating.has(id)) fail("PRINCIPAL_NOT_LINKED");
  }
  #new(id: string, principal: Readonly<GenerationPrincipalRef>, semantic: string,
    candidate: OwnerFlux3VideoOwnedPreparedCandidate, permit: OwnerFlux3VideoOwnedOneShotPermit,
    chat: OwnerFlux3VideoNativeChatContext, client: SyntxChatHttpClient,
    binding: Readonly<OwnerFlux3VideoOwnedCandidateBinding>): Recovery {
    const now = this.#readNow();
    return { recovery_id: `flux3_video_recovery_${randomUUID()}`, attemptId: id, semantic_key: semantic, principal,
      created_at: new Date(now).toISOString(), candidate, permit, chat, client, binding, owner_echo_message_id: null,
      status: "outcome_unknown", artifacts: Object.freeze([]), d: { phase: "CHAT_CREATE", post_started: false,
        ack_known: false, history_status: "NOT_READ", owner_ack_status: "NOT_READ", request_echo_status: "NOT_READ",
        history_get_calls: 0, result_get_calls: 0, result_status: "NOT_READ", gaps: [] } };
  }
  #owned(id: string, recoveryId: string, principal: Readonly<GenerationPrincipalRef>): Recovery {
    const r = this.#recoveries.get(recoveryId);
    if (this.#invalidating.has(id) || !r || r.attemptId !== id || !sameGenerationPrincipal(r.principal, principal) || this.#client(id) !== r.client) fail("RECOVERY_NOT_FOUND");
    return r;
  }
  async #observe(r: Recovery, deadline: AbsoluteRequestDeadline): Promise<OwnerFlux3VideoGenerationResult> {
    await this.#checkPrincipal(r.attemptId, r.principal);
    if (this.#client(r.attemptId) !== r.client) fail("RECOVERY_NOT_FOUND");
    r.d.phase = "HISTORY_GET"; r.d.history_get_calls++;
    let history: OwnerFlux3VideoNativeResultCandidates;
    try {
      history = await this.#await(deadline, () => Reflect.apply(LIST, r.client, [Object.freeze({
        preparer: this.#preparer, candidate: r.candidate, permit: r.permit, referenceService: this.#referenceService,
        principal: r.principal, attemptId: r.attemptId, linkService: this.#links, binding: this.#binding, chat: r.chat
      }), deadline.signal]));
    } catch { r.d.history_status = "UNVERIFIED"; throw unknown(r); }
    r.d.owner_ack_status = history.owner_ack_status; r.d.request_echo_status = history.request_echo_status;
    if (history.status !== "COMPLETE" || history.owner_ack_status !== "MATCHED" || history.history_binding_status !== "BOUND" ||
        history.owner_echo_message_id !== r.owner_echo_message_id ||
        history.history_page_status !== "COMPLETE" || history.contexts.length < 1 || history.request_echo_status === "CONTRADICTORY") {
      r.d.history_status = history.status === "PENDING" ? "PENDING" :
        history.status === "UNVERIFIED" || history.history_page_status === "UNPROVEN" ? "UNVERIFIED" : "INCOMPLETE";
      r.d.gaps = [...history.gaps]; throw unknown(r);
    }
    if (history.contexts.length > PAGE_SIZE) { r.d.history_status = "UNVERIFIED"; r.d.gaps = ["RESULT_CONTEXT_LIMIT_EXCEEDED"]; throw unknown(r); }
    r.d.history_status = "COMPLETE";
    const artifacts: OwnerFlux3VideoGenerationArtifact[] = [], seen = new Set<string>();
    for (const context of history.contexts) {
      if (!validResultContext(context, r)) throw unknown(r);
      await this.#checkPrincipal(r.attemptId, r.principal);
      if (this.#client(r.attemptId) !== r.client) fail("RECOVERY_NOT_FOUND");
      r.d.phase = "RESULT_GET"; r.d.result_get_calls++;
      let result;
      try {
        result = await this.#await(deadline, () => Reflect.apply(GET, r.client, [Object.freeze({ result_context: context,
          principal: r.principal, attemptId: r.attemptId, linkService: this.#links, binding: this.#binding }), deadline.signal]));
      } catch { r.d.result_status = "UNVERIFIED"; throw unknown(r); }
      if (result.message_binding !== "BOUND" || result.model_echo !== "MATCHED" || result.artifacts.length < 1) {
        r.d.result_status = "UNVERIFIED"; r.d.gaps = [...result.gaps]; throw unknown(r);
      }
      for (const artifact of result.artifacts) {
        if (!validArtifact(artifact, context, r) || seen.has(artifact.message_object_id)) throw unknown(r);
        seen.add(artifact.message_object_id);
        artifacts.push(Object.freeze({ ...artifact, message_id: context.message_id, chat_uuid: context.chat_uuid, model_id: r.binding.model_id }));
        if (artifacts.length > PAGE_SIZE) throw unknown(r);
      }
      await this.#checkPrincipal(r.attemptId, r.principal);
      if (this.#client(r.attemptId) !== r.client) fail("RECOVERY_NOT_FOUND");
    }
    await this.#checkPrincipal(r.attemptId, r.principal);
    if (this.#client(r.attemptId) !== r.client) fail("RECOVERY_NOT_FOUND");
    r.artifacts = Object.freeze(artifacts); r.status = "completed"; r.d.result_status = "COMPLETE";
    return page(r, 0);
  }
  #await<T>(deadline: AbsoluteRequestDeadline, task: () => Promise<T>): Promise<T> { deadline.throwIfAborted(); return deadline.waitFor(task()); }
  #run<T>(id: string, parent: AbortSignal | undefined, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.#closed || !SERVICES.has(this)) return Promise.reject(err("SERVICE_CLOSED"));
    if (this.#invalidating.has(id) || this.#runs.size >= MAX_RUNS) return Promise.reject(err("SERVICE_BUSY"));
    const controller = new AbortController(), abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    const run: Run = { attemptId: id, controller, promise: Promise.resolve() };
    const promise = fn(controller.signal); run.promise = promise; this.#runs.add(run);
    return promise.finally(() => { parent?.removeEventListener("abort", abort); this.#runs.delete(run); });
  }
  #readNow(): number { const value = this.#now(); if (!Number.isSafeInteger(value) || value < this.#lastNow) fail("SERVICE_BUSY"); return this.#lastNow = value; }
}

export function createOwnerFlux3VideoGenerationService(options: OwnerFlux3VideoGenerationServiceOptions | unknown): OwnerFlux3VideoGenerationService {
  return new OwnerFlux3VideoGenerationService(options);
}
export function isOwnerFlux3VideoGenerationService(value: unknown): value is OwnerFlux3VideoGenerationService {
  return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) &&
    Object.getPrototypeOf(value) === OwnerFlux3VideoGenerationService.prototype;
}

function readGenerateInput(value: unknown): OwnerFlux3VideoGenerateInput {
  const x = exact(value, ["attemptId", "request"]), r = exact(x.request, ["model_id", "prompt", "flux3_reference_handles", "parameters"]);
  if (!(OWNER_FLUX3_VIDEO_MODEL_IDS as readonly unknown[]).includes(r.model_id) || typeof r.prompt !== "string" ||
      !Array.isArray(r.flux3_reference_handles) || r.flux3_reference_handles.length < 1 || r.flux3_reference_handles.length > 10 ||
      r.flux3_reference_handles.some(h => typeof h !== "string")) invalid();
  return Object.freeze({ attemptId: attempt(x.attemptId), request: Object.freeze({ model_id: r.model_id as OwnerFlux3VideoModelId,
    prompt: r.prompt, flux3_reference_handles: Object.freeze([...r.flux3_reference_handles] as string[]),
    parameters: r.parameters as OwnerFlux3VideoParameterValues }) });
}
function readRecoveryInput(value: unknown): OwnerFlux3VideoReconcileInput { const x = exact(value, ["attemptId", "recovery_id"]); if (typeof x.recovery_id !== "string" || !RECOVERY.test(x.recovery_id)) invalid(); return { attemptId: attempt(x.attemptId), recovery_id: x.recovery_id }; }
function readListInput(value: unknown): { attemptId: string; limit: number } { const x = exact(value, ["attemptId"], ["limit"]); return { attemptId: attempt(x.attemptId), limit: bounded(x.limit, 1, 128, 32) }; }
function readPageInput(value: unknown): { attemptId: string; recovery_id: string; offset: number } { const x = exact(value, ["attemptId", "recovery_id"], ["offset"]); if (typeof x.recovery_id !== "string" || !RECOVERY.test(x.recovery_id)) invalid(); return { attemptId: attempt(x.attemptId), recovery_id: x.recovery_id, offset: bounded(x.offset, 0, 4096, 0) }; }
function page(r: Recovery, offset: number): OwnerFlux3VideoGenerationResult {
  const artifacts = r.artifacts.slice(offset, offset + PAGE_SIZE), next = offset + artifacts.length;
  return Object.freeze({ status: "completed", status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", backend_acceptance: "UNPROVEN",
    provider_terminal_status: "UNPROVEN", cost_cap_enforced: false, output_count: "UNKNOWN", recovery_id: r.recovery_id,
    model_id: r.binding.model_id, source_binding: Object.freeze({ public_catalog_version: OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION,
      profile_schema_hash: r.binding.profile_schema_hash, request_fingerprint: r.binding.request_fingerprint, intent_fingerprint: r.binding.intent_fingerprint }),
    observed_artifact_count: r.artifacts.length, offset, page_size: PAGE_SIZE, artifacts: Object.freeze(artifacts),
    has_more: next < r.artifacts.length, next_offset: next < r.artifacts.length ? next : null, diagnostic: diag(r.d) });
}
function diag(d: Recovery["d"]): OwnerFlux3VideoGenerationDiagnostic { return Object.freeze({ ...d, gaps: Object.freeze(d.gaps.slice(0, 32)) }); }
function item(r: Recovery): OwnerFlux3VideoRecoveryListItem { return Object.freeze({ recovery_id: r.recovery_id, created_at: r.created_at,
  model_id: r.binding.model_id, status: r.status, observed_artifact_count: r.artifacts.length, diagnostic: diag(r.d) }); }
function unknown(r: Recovery): OwnerFlux3VideoGenerationServiceError { return new OwnerFlux3VideoGenerationServiceError("OUTCOME_UNKNOWN", r.recovery_id, diag(r.d)); }

function validAccount(value: AccountStatusResult, now: number): boolean {
  const s = value.subscription, b = value.balance;
  return value.contract_evidence === ACCOUNT_CONTRACT_EVIDENCE && value.source_build === ACCOUNT_SOURCE_BUILD &&
    !!b && b.unit === "tokens" && finiteDecimal(b.available) && !!s &&
    (s.active === null || typeof s.active === "boolean") && (s.plan_type === null || typeof s.plan_type === "string") &&
    (s.end_date === null || typeof s.end_date === "string") &&
    (s.end_date_kind === null || ["DATE_ONLY", "LOCAL_DATETIME", "OFFSET_DATETIME"].includes(s.end_date_kind)) && fresh(value.observed_at, now);
}
function lessThanOrEqualDecimal(left: string, right: string): boolean {
  const a = decimalParts(left), b = decimalParts(right); if (!a || !b) return false;
  const scale = Math.max(a.scale, b.scale);
  return a.digits * 10n ** BigInt(scale - a.scale) <= b.digits * 10n ** BigInt(scale - b.scale);
}
function decimalParts(value: string): { digits: bigint; scale: number } | null {
  if (value.length > 128) return null;
  const m = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/u.exec(value); if (!m) return null;
  const fraction = m[2] ?? "", exponent = Number(m[3] ?? 0); if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) return null;
  let digits: bigint; try { digits = BigInt(`${m[1]}${fraction}`); } catch { return null; }
  let scale = fraction.length - exponent; if (scale < 0) { digits *= 10n ** BigInt(-scale); scale = 0; }
  return { digits, scale };
}
function finiteDecimal(value: unknown): value is string { return typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value); }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function fresh(value: string, now: number): boolean { return typeof value === "string" && Number.isFinite(Date.parse(value)) && Math.abs(Date.parse(value) - now) < 300_000; }
function sameStrings(a: readonly string[], b: readonly string[]): boolean { const x = [...a].sort(), y = [...b].sort(); return x.length === y.length && x.every((v, i) => v === y[i]); }
function validResultContext(c: OwnerFlux3VideoNativeResultContext, r: Recovery): boolean {
  return c.chat_uuid === r.chat.chat_uuid && c.attempt_id === r.attemptId && c.model_id === r.binding.model_id &&
    c.profile_schema_hash === r.binding.profile_schema_hash && c.request_fingerprint === r.binding.request_fingerprint &&
    c.intent_fingerprint === r.binding.intent_fingerprint && c.owner_echo_message_id === r.owner_echo_message_id &&
    c.message_object_ids.length > 0 && c.message_object_ids.length <= PAGE_SIZE && /^\d{1,16}$/u.test(c.provider_chat_id);
}
function validArtifact(a: OwnerFlux3VideoNativeVideoArtifact, c: OwnerFlux3VideoNativeResultContext, r: Recovery): boolean {
  return a.object_type === "video" && c.message_object_ids.includes(a.message_object_id) &&
    typeof a.object_url === "string" && isSafeUploadReferenceUrl(a.object_url) &&
    (a.mime_type === null || a.mime_type === "video/mp4" || a.mime_type === "video/quicktime") &&
    a.mime_source === (a.mime_type === null ? "UNKNOWN" : "URL_EXTENSION") && r.binding.model_id === c.model_id;
}
function readBinding(value: unknown): Readonly<AuthBinding> { const x = exact(value, ["tenant_id", "subject"]); if (typeof x.tenant_id !== "string" || !x.tenant_id.trim() || typeof x.subject !== "string" || !x.subject.trim()) invalid(); return Object.freeze({ tenant_id: x.tenant_id, subject: x.subject }); }
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  const proto = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if ((proto !== Object.prototype && proto !== null) || keys.some(k => typeof k !== "string" || !required.includes(k) && !optional.includes(k)) ||
      required.some(k => !keys.includes(k)) || keys.some(k => { if (typeof k !== "string") return true; const d = descriptors[k]; return !d?.enumerable || !("value" in d); })) invalid();
  const out = Object.create(null) as Record<string, any>; for (const k of keys as string[]) out[k] = descriptors[k]!.value; return out;
}
function attempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) invalid(); return value; }
function safeId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u.test(value); }
function bounded(value: unknown, min: number, max: number, fallback: number): number { if (value === undefined) return fallback; if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) invalid(); return value as number; }
function clock(value: unknown): () => number { if (value === undefined) return Date.now; if (typeof value !== "function" || types.isProxy(value)) invalid(); return value as () => number; }
function err(code: OwnerFlux3VideoGenerationServiceErrorCode): OwnerFlux3VideoGenerationServiceError { return new OwnerFlux3VideoGenerationServiceError(code); }
function fail(code: OwnerFlux3VideoGenerationServiceErrorCode): never { throw err(code); }
function invalid(): never { return fail("INVALID_REQUEST"); }
