import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { SyntxChatHttpClient, type MediaGenerationReceipt } from "../adapter/syntx/chat-http-client.js";
import type { OwnerElevenLabsStsChatContext, OwnerElevenLabsStsResultCandidates,
  OwnerElevenLabsStsResultMessageContext } from "../adapter/syntx/owner-elevenlabs-sts-native-context.js";
import type { OwnerElevenLabsStsResult, OwnerElevenLabsStsReadyAudio } from "../adapter/syntx/owner-elevenlabs-sts-result-codec.js";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { AccountStatusService, type AccountStatusResult } from "./account-status.js";
import { ModelAccessService, type ModelAccessResult } from "./model-access.js";
import { OWNER_ELEVENLABS_STS_MODEL_ID, OWNER_ELEVENLABS_STS_MODE,
  type OwnerElevenLabsStsRequest } from "./owner-elevenlabs-sts-parameters.js";
import { OwnerElevenLabsStsRequestPreparer, type OwnerElevenLabsStsPreparedCandidate,
  type OwnerElevenLabsStsCandidateBinding } from "./owner-elevenlabs-sts-request-preparer.js";
import { createOwnerElevenLabsStsOneShotPermit, revalidateOwnerElevenLabsStsOneShotPermit,
  type OwnerElevenLabsStsOneShotPermit } from "./owner-elevenlabs-sts-one-shot-policy.js";

export const OWNER_ELEVENLABS_STS_PUBLIC_CATALOG_VERSION =
  "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json" as const;

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY = /^elevenlabs_sts_recovery_[0-9a-f-]{36}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const MAX_RECOVERIES = 128, MAX_RUNS = 4, RESULT_PAGE_SIZE = 64, MAX_RESULTS = 4096;
const DEFAULT_TIMEOUT_MS = 120_000;
const ACCOUNT = AccountStatusService.prototype.getAccountStatus;
const ACCESS = ModelAccessService.prototype.getModelAccess;
const CHAT = SyntxChatHttpClient.prototype.createOwnerElevenLabsStsChat;
const START = SyntxChatHttpClient.prototype.startElevenLabsStsWithOwnedCandidate;
const LIST = SyntxChatHttpClient.prototype.listOwnedElevenLabsStsCandidates;
const GET = SyntxChatHttpClient.prototype.getOwnedElevenLabsStsResult;
const SERVICES = new WeakSet<object>();

export type OwnerElevenLabsStsGenerationPhase = "VALIDATE_REQUEST" | "RESOLVE_PRINCIPAL" | "PREPARE_CANDIDATE" |
  "PREFLIGHT_ONE" | "CHAT_CREATE" | "PREFLIGHT_TWO" | "GENERATION_POST" | "POST_ACK_KNOWN" |
  "HISTORY_GET" | "RESULT_GET" | "RESULT_BINDING";
export interface OwnerElevenLabsStsGenerationDiagnostic {
  readonly phase: OwnerElevenLabsStsGenerationPhase; readonly post_started: boolean; readonly ack_known: boolean;
  readonly history_status: "NOT_READ" | "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "NOT_READ" | "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  readonly history_get_calls: number; readonly result_get_calls: number;
  readonly result_status: "NOT_READ" | "PENDING" | "COMPLETE" | "UNVERIFIED";
  readonly gaps: readonly string[];
}
export interface OwnerElevenLabsStsAudioArtifact extends OwnerElevenLabsStsReadyAudio {
  readonly message_id: string; readonly chat_uuid: string; readonly model_id: typeof OWNER_ELEVENLABS_STS_MODEL_ID;
}
export interface OwnerElevenLabsStsGenerationResult {
  readonly status: "completed"; readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly backend_acceptance: "UNPROVEN"; readonly provider_terminal_status: "UNPROVEN";
  readonly cost_cap_enforced: false; readonly recovery_id: string; readonly model_id: typeof OWNER_ELEVENLABS_STS_MODEL_ID;
  readonly source_binding: Readonly<{ public_catalog_version: typeof OWNER_ELEVENLABS_STS_PUBLIC_CATALOG_VERSION;
    profile_schema_hash: string; request_fingerprint: string; intent_fingerprint: string }>;
  readonly observed_artifact_count: number; readonly offset: number; readonly page_size: typeof RESULT_PAGE_SIZE;
  readonly artifacts: readonly OwnerElevenLabsStsAudioArtifact[]; readonly has_more: boolean; readonly next_offset: number | null;
  readonly diagnostic: OwnerElevenLabsStsGenerationDiagnostic;
}
export interface OwnerElevenLabsStsRecoveryListItem {
  readonly recovery_id: string; readonly created_at: string; readonly model_id: typeof OWNER_ELEVENLABS_STS_MODEL_ID;
  readonly status: "outcome_unknown" | "completed"; readonly observed_artifact_count: number;
  readonly diagnostic: OwnerElevenLabsStsGenerationDiagnostic;
}
export interface OwnerElevenLabsStsGenerationServiceOptions {
  readonly binding: AuthBinding; readonly linkService: PerUserLinkService; readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string; readonly preparer: OwnerElevenLabsStsRequestPreparer;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly createAccountStatusService: (attemptId: string) => AccountStatusService;
  readonly createModelAccessService: (attemptId: string) => ModelAccessService;
  readonly now?: () => number; readonly timeoutMs?: number;
}
export interface OwnerElevenLabsStsGenerateInput { readonly attemptId: string; readonly request: OwnerElevenLabsStsRequest; }
export interface OwnerElevenLabsStsReconcileInput { readonly attemptId: string; readonly recovery_id: string; }
export interface OwnerElevenLabsStsRecoveryListInput { readonly attemptId: string; readonly limit?: number; }
export interface OwnerElevenLabsStsResultPageInput { readonly attemptId: string; readonly recovery_id: string; readonly offset?: number; }
export type OwnerElevenLabsStsGenerationServiceErrorCode = "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" |
  "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH" | "PREFLIGHT_FAILED" | "INTENT_ALREADY_CLAIMED" |
  "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND";
export class OwnerElevenLabsStsGenerationServiceError extends Error {
  readonly diagnostic?: OwnerElevenLabsStsGenerationDiagnostic;
  constructor(readonly code: OwnerElevenLabsStsGenerationServiceErrorCode, readonly recovery_id?: string,
    diagnostic?: OwnerElevenLabsStsGenerationDiagnostic) {
    super(code === "OUTCOME_UNKNOWN" ? "The ElevenLabs STS request may have been dispatched; reconcile its recovery and do not retry."
      : "The owner ElevenLabs STS request could not be completed safely.");
    this.name = "OwnerElevenLabsStsGenerationServiceError";
    if (code === "OUTCOME_UNKNOWN" && diagnostic) this.diagnostic = diagnostic;
  }
}

interface MutableDiagnostic { phase: OwnerElevenLabsStsGenerationPhase; post_started: boolean; ack_known: boolean;
  history_status: OwnerElevenLabsStsGenerationDiagnostic["history_status"];
  owner_ack_status: OwnerElevenLabsStsGenerationDiagnostic["owner_ack_status"];
  history_get_calls: number; result_get_calls: number; result_status: OwnerElevenLabsStsGenerationDiagnostic["result_status"];
  gaps: string[]; }
interface Recovery {
  readonly recovery_id: string; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly created_at: string; readonly semantic_key: string; readonly candidate: OwnerElevenLabsStsPreparedCandidate;
  readonly permit: OwnerElevenLabsStsOneShotPermit; readonly chat: OwnerElevenLabsStsChatContext;
  readonly client: SyntxChatHttpClient; readonly binding: Readonly<OwnerElevenLabsStsCandidateBinding>;
  owner_echo_message_id: string | null; status: "outcome_unknown" | "completed";
  artifacts: readonly OwnerElevenLabsStsAudioArtifact[]; readonly diagnostic: MutableDiagnostic;
}
interface ActiveRun { readonly attemptId: string; readonly controller: AbortController; promise: Promise<unknown>; }

/** Owner-only single-dispatch STS v2 service; constructor transfers exclusive ownership of its preparer. */
export class OwnerElevenLabsStsGenerationService {
  readonly #binding: Readonly<AuthBinding>; readonly #linkService: PerUserLinkService;
  readonly #catalog: DiscoveryCatalogRepository; readonly #catalogVersion: string;
  readonly #preparer: OwnerElevenLabsStsRequestPreparer;
  readonly #resolveChatClient: OwnerElevenLabsStsGenerationServiceOptions["resolveChatClient"];
  readonly #createAccount: OwnerElevenLabsStsGenerationServiceOptions["createAccountStatusService"];
  readonly #createAccess: OwnerElevenLabsStsGenerationServiceOptions["createModelAccessService"];
  readonly #now: () => number; readonly #timeoutMs: number;
  readonly #recoveries = new Map<string, Recovery>(); readonly #claims = new Map<string, string>();
  readonly #reserved = new Set<string>();
  readonly #usedAccounts = new WeakSet<object>(); readonly #usedAccess = new WeakSet<object>();
  readonly #runs = new Set<ActiveRun>(); readonly #invalidating = new Set<string>();
  readonly #clientsByAttempt = new Map<string, SyntxChatHttpClient>();
  #closed = false; #closing: Promise<void> | undefined; #lastNow = -1;

  constructor(optionsInput: OwnerElevenLabsStsGenerationServiceOptions | unknown) {
    const options = exact(optionsInput, ["binding", "linkService", "catalog", "catalog_version", "preparer",
      "resolveChatClient", "createAccountStatusService", "createModelAccessService"], ["now", "timeoutMs"]);
    this.#binding = snapshotBinding(options.binding);
    if (!genuineLinkService(options.linkService) || !(options.catalog instanceof DiscoveryCatalogRepository) ||
        options.catalog_version !== OWNER_ELEVENLABS_STS_PUBLIC_CATALOG_VERSION ||
        !genuineMethods(options.preparer, OwnerElevenLabsStsRequestPreparer, ["prepare", "inspectCandidate", "getPrivateRequest", "revalidateCandidate", "withCapturedNativeOriginal", "invalidateAttempt", "close"]) ||
        typeof options.resolveChatClient !== "function" || types.isProxy(options.resolveChatClient) ||
        typeof options.createAccountStatusService !== "function" || types.isProxy(options.createAccountStatusService) ||
        typeof options.createModelAccessService !== "function" || types.isProxy(options.createModelAccessService)) invalid();
    this.#linkService = options.linkService as PerUserLinkService; this.#catalog = options.catalog;
    this.#catalogVersion = options.catalog_version as string; this.#preparer = options.preparer as OwnerElevenLabsStsRequestPreparer;
    this.#resolveChatClient = options.resolveChatClient as OwnerElevenLabsStsGenerationServiceOptions["resolveChatClient"];
    this.#createAccount = options.createAccountStatusService as OwnerElevenLabsStsGenerationServiceOptions["createAccountStatusService"];
    this.#createAccess = options.createModelAccessService as OwnerElevenLabsStsGenerationServiceOptions["createModelAccessService"];
    this.#now = readClock(options.now); this.#timeoutMs = bounded(options.timeoutMs, 1_000, 300_000, DEFAULT_TIMEOUT_MS);
    this.#assertModelBinding(); SERVICES.add(this); Object.freeze(this);
  }

  async generate(input: OwnerElevenLabsStsGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerElevenLabsStsGenerationResult> {
    const request = snapshotGenerate(input); return this.#run(request.attemptId, signal, (s) => this.#generate(request, s));
  }
  async reconcile(input: OwnerElevenLabsStsReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerElevenLabsStsGenerationResult> {
    const request = snapshotRecovery(input);
    if (this.#invalidating.has(request.attemptId)) fail("RECOVERY_NOT_FOUND");
    return this.#run(request.attemptId, signal, (s) => this.#reconcile(request, s));
  }
  async listRecoveries(input: OwnerElevenLabsStsRecoveryListInput | unknown): Promise<readonly OwnerElevenLabsStsRecoveryListItem[]> {
    const request = snapshotList(input); return this.#run(request.attemptId, undefined, async () => {
      const principal = await this.#principal(request.attemptId);
      return Object.freeze([...this.#recoveries.values()].filter((r) => r.attemptId === request.attemptId &&
        sameGenerationPrincipal(r.principal, principal)).slice(0, request.limit).map((r) => recoveryItem(r)));
    });
  }
  async getResultPage(input: OwnerElevenLabsStsResultPageInput | unknown): Promise<OwnerElevenLabsStsGenerationResult> {
    const request = snapshotPage(input); return this.#run(request.attemptId, undefined, async () => {
      const recovery = this.#ownedRecovery(request.attemptId, request.recovery_id, await this.#principal(request.attemptId));
      if (recovery.status !== "completed") throw unknownError(recovery);
      return pageResult(recovery, request.offset);
    });
  }
  async invalidateAttempt(attemptInput: unknown): Promise<void> {
    const attemptId = safeAttempt(attemptInput); this.#invalidating.add(attemptId);
    this.#preparer.invalidateAttempt(attemptId);
    const active = [...this.#runs].filter((run) => run.attemptId === attemptId);
    for (const run of active) run.controller.abort(); await Promise.allSettled(active.map((run) => run.promise));
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing; this.#closed = true;
    for (const run of this.#runs) run.controller.abort();
    const attempts = new Set([...this.#runs].map((run) => run.attemptId));
    for (const attemptId of attempts) this.#preparer.invalidateAttempt(attemptId);
    this.#closing = (async () => { await Promise.allSettled([...this.#runs].map((run) => run.promise));
      await this.#preparer.close(); this.#runs.clear(); })(); return this.#closing;
  }

  async #generate(request: Readonly<OwnerElevenLabsStsGenerateInput>, signal: AbortSignal): Promise<OwnerElevenLabsStsGenerationResult> {
    const deadline = new AbsoluteRequestDeadline(this.#timeoutMs, signal, () => serviceError("PRE_DISPATCH_FAILED"));
    let candidate: OwnerElevenLabsStsPreparedCandidate | undefined, permit: OwnerElevenLabsStsOneShotPermit | undefined;
    let semantic: string | undefined, recovery: Recovery | undefined, postStarted = false;
    try {
      deadline.throwIfAborted(); this.#assertModelBinding(); const principal = await this.#await(deadline, () => this.#principal(request.attemptId));
      candidate = await this.#await(deadline, () => this.#preparer.prepare({ attemptId: request.attemptId,
        audio_original_handle: request.request.audio_original_handle, voice_ref: request.request.voice_ref }));
      const binding = this.#preparer.inspectCandidate(candidate); if (!binding) fail("PRE_DISPATCH_FAILED");
      semantic = semanticKey(principal, candidate.intent_fingerprint);
      if (this.#claims.has(semantic) || this.#reserved.has(semantic)) fail("INTENT_ALREADY_CLAIMED");
      if (this.#claims.size + this.#reserved.size >= MAX_RECOVERIES) fail("SERVICE_BUSY");
      this.#reserved.add(semantic);
      permit = await createOwnerElevenLabsStsOneShotPermit({ candidate, attemptId: request.attemptId, principal, preparer: this.#preparer });
      await this.#preflight(request.attemptId, binding, deadline, "PREFLIGHT_ONE");
      const client = this.#nativeClient(request.attemptId); deadline.throwIfAborted();
      this.#claims.set(semantic, "CHAT_PENDING"); this.#reserved.delete(semantic);
      const nativeInput = Object.freeze({ candidate, permit, preparer: this.#preparer, principal, attemptId: request.attemptId,
        linkService: this.#linkService, binding: this.#binding });
      const chat = await this.#await(deadline, () => Reflect.apply(CHAT, client, [nativeInput, deadline.signal]) as Promise<OwnerElevenLabsStsChatContext>);
      if (!isSafeId(chat.chat_uuid)) fail("PRE_DISPATCH_FAILED");
      await this.#checkPrincipal(request.attemptId, principal);
      await this.#preflight(request.attemptId, binding, deadline, "PREFLIGHT_TWO"); await this.#checkPrincipal(request.attemptId, principal);
      await this.#preparer.revalidateCandidate(candidate);
      await revalidateOwnerElevenLabsStsOneShotPermit({ candidate, permit, attemptId: request.attemptId, principal, preparer: this.#preparer });
      recovery = this.#newRecovery(request.attemptId, principal, semantic, candidate, permit, chat, client, binding);
      this.#recoveries.set(recovery.recovery_id, recovery); this.#claims.set(semantic, recovery.recovery_id); this.#reserved.delete(semantic); semantic = undefined;
      recovery.diagnostic.phase = "GENERATION_POST"; recovery.diagnostic.post_started = true; postStarted = true;
      const receipt = await this.#await(deadline, () => Reflect.apply(START, client, [Object.freeze({ ...nativeInput, chat }), deadline.signal]) as Promise<MediaGenerationReceipt>);
      if (!validReceipt(receipt, chat.chat_uuid)) throw unknownError(recovery);
      recovery.owner_echo_message_id = receipt.message_id; recovery.diagnostic.ack_known = true;
      recovery.diagnostic.owner_ack_status = "MATCHED"; recovery.diagnostic.phase = "POST_ACK_KNOWN";
      return await this.#observe(recovery, deadline);
    } catch (error) {
      if (postStarted && recovery) throw unknownError(recovery);
      if (semantic) this.#reserved.delete(semantic);
      if (error instanceof OwnerElevenLabsStsGenerationServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      return fail("PRE_DISPATCH_FAILED");
    } finally { if (semantic) this.#reserved.delete(semantic); deadline.close(); }
  }

  async #reconcile(request: Readonly<OwnerElevenLabsStsReconcileInput>, signal: AbortSignal): Promise<OwnerElevenLabsStsGenerationResult> {
    const recovery = this.#ownedRecovery(request.attemptId, request.recovery_id, await this.#principal(request.attemptId));
    if (recovery.status === "completed") return pageResult(recovery, 0);
    const deadline = new AbsoluteRequestDeadline(this.#timeoutMs, signal, () => unknownError(recovery));
    try { await this.#checkPrincipal(request.attemptId, recovery.principal);
      if (this.#nativeClient(request.attemptId) !== recovery.client) fail("PRINCIPAL_NOT_LINKED");
      return await this.#observe(recovery, deadline);
    } catch (error) { if (error instanceof OwnerElevenLabsStsGenerationServiceError && error.code === "RECOVERY_NOT_FOUND") throw error;
      throw unknownError(recovery); } finally { deadline.close(); }
  }

  async #observe(recovery: Recovery, deadline: AbsoluteRequestDeadline): Promise<OwnerElevenLabsStsGenerationResult> {
    deadline.throwIfAborted(); await this.#checkPrincipal(recovery.attemptId, recovery.principal);
    recovery.diagnostic.phase = "HISTORY_GET"; recovery.diagnostic.history_get_calls += 1;
    let history: OwnerElevenLabsStsResultCandidates;
    try { history = await this.#await(deadline, () => Reflect.apply(LIST, recovery.client, [recovery.chat, deadline.signal]) as Promise<OwnerElevenLabsStsResultCandidates>); }
    catch { deadline.throwIfAborted(); recovery.diagnostic.history_status = "UNVERIFIED"; throw unknownError(recovery); }
    recovery.diagnostic.owner_ack_status = history.owner_ack_status;
    if (history.owner_ack_status !== "MATCHED" || history.history_binding_status !== "BOUND" ||
        history.history_page_status !== "COMPLETE" || history.status !== "COMPLETE" || history.backend_acceptance !== "UNPROVEN") {
      recovery.diagnostic.history_status = history.status === "PENDING" ? "PENDING" : history.status === "INCOMPLETE" ? "INCOMPLETE" : "UNVERIFIED";
      recovery.diagnostic.gaps = [...history.gaps].slice(0, 32); recovery.diagnostic.result_status = "PENDING"; throw unknownError(recovery);
    }
    if (history.gaps.length > 0) { recovery.diagnostic.gaps = [...history.gaps].slice(0, 32); recovery.diagnostic.result_status = "UNVERIFIED"; throw unknownError(recovery); }
    recovery.diagnostic.history_status = "COMPLETE";
    if (!recovery.owner_echo_message_id || history.owner_echo_message_id !== recovery.owner_echo_message_id || history.contexts.length === 0) {
      recovery.diagnostic.gaps = [...history.gaps, "OWNER_ACK_OR_RESULT_CONTEXT_MISSING"].slice(0, 32); throw unknownError(recovery);
    }
    const observed: OwnerElevenLabsStsAudioArtifact[] = [];
    for (const context of history.contexts) {
      if (context.chat_uuid !== recovery.chat.chat_uuid || context.model_id !== OWNER_ELEVENLABS_STS_MODEL_ID ||
          context.owner_echo_message_id !== recovery.owner_echo_message_id || context.attempt_id !== recovery.attemptId ||
          context.source_sha256 !== recovery.binding.source_sha256 || context.intent_fingerprint !== recovery.binding.intent_fingerprint) {
        recovery.diagnostic.gaps = ["RESULT_CONTEXT_BINDING_MISMATCH"]; recovery.diagnostic.result_status = "UNVERIFIED"; throw unknownError(recovery);
      }
      recovery.diagnostic.phase = "RESULT_GET"; recovery.diagnostic.result_get_calls += 1;
      let decoded: OwnerElevenLabsStsResult;
      try { decoded = await this.#await(deadline, () => Reflect.apply(GET, recovery.client, [context, deadline.signal]) as Promise<OwnerElevenLabsStsResult>); }
      catch { deadline.throwIfAborted(); recovery.diagnostic.result_status = "UNVERIFIED"; throw unknownError(recovery); }
      if (decoded.message_binding !== "BOUND" || decoded.model_echo !== "MATCHED" || decoded.backend_acceptance !== "UNPROVEN" || decoded.ready_audio.length !== 1 || decoded.gaps.length) {
        recovery.diagnostic.gaps = decoded.gaps.map((gap) => gap.code).slice(0, 32); recovery.diagnostic.result_status = "UNVERIFIED"; throw unknownError(recovery);
      }
      const audio = decoded.ready_audio[0]!;
      if (!validAudio(audio, context)) { recovery.diagnostic.gaps = ["AUDIO_PROJECTION_INVALID"]; throw unknownError(recovery); }
      observed.push(Object.freeze({ ...audio, message_id: context.message_id, chat_uuid: context.chat_uuid, model_id: OWNER_ELEVENLABS_STS_MODEL_ID }));
    }
    if (!observed.length || observed.length > MAX_RESULTS) { recovery.diagnostic.gaps = ["RESULT_LIMIT_EXCEEDED"]; throw unknownError(recovery); }
    recovery.artifacts = Object.freeze(observed); recovery.status = "completed"; recovery.diagnostic.phase = "RESULT_BINDING";
    recovery.diagnostic.result_status = "COMPLETE"; recovery.diagnostic.gaps = [...history.gaps].slice(0, 32);
    return pageResult(recovery, 0);
  }

  async #preflight(attemptId: string, binding: Readonly<OwnerElevenLabsStsCandidateBinding>, deadline: AbsoluteRequestDeadline,
    phase: "PREFLIGHT_ONE" | "PREFLIGHT_TWO"): Promise<void> {
    deadline.throwIfAborted();
    let account: AccountStatusService, access: ModelAccessService;
    try { account = Reflect.apply(this.#createAccount, undefined, [attemptId]) as AccountStatusService;
      access = Reflect.apply(this.#createAccess, undefined, [attemptId]) as ModelAccessService; } catch { fail("PREFLIGHT_FAILED"); }
    if (!genuineMethods(account, AccountStatusService, ["getAccountStatus"]) || this.#usedAccounts.has(account) ||
        !genuineMethods(access, ModelAccessService, ["getModelAccess"]) || this.#usedAccess.has(access)) fail("PREFLIGHT_FAILED");
    this.#usedAccounts.add(account); this.#usedAccess.add(access);
    let accountResult: AccountStatusResult, accessResult: ModelAccessResult;
    try {
      accountResult = await this.#await(deadline, () => Reflect.apply(ACCOUNT, account, [deadline.signal]) as Promise<AccountStatusResult>);
      accessResult = await this.#await(deadline, () => Reflect.apply(ACCESS, access, [Object.freeze({ model_id: OWNER_ELEVENLABS_STS_MODEL_ID,
        cost_parameters: Object.freeze({ mode: OWNER_ELEVENLABS_STS_MODE, duration: binding.duration }) }), deadline.signal]) as Promise<ModelAccessResult>);
    } catch { fail("PREFLIGHT_FAILED"); }
    this.#assertFreshPreflight(accountResult, accessResult, binding);
    if (phase === "PREFLIGHT_ONE") return;
  }

  #assertFreshPreflight(account: AccountStatusResult, access: ModelAccessResult, binding: Readonly<OwnerElevenLabsStsCandidateBinding>): void {
    const now = this.#readNow();
    if (!validAccount(account, now) || access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" ||
        access.catalog_version !== `${this.#catalog.fetched_at}.${this.#catalog.source_hashes.models.slice(7, 19)}` ||
        access.model_id !== OWNER_ELEVENLABS_STS_MODEL_ID || access.ai_name !== "elevenlabs" || access.model_type !== OWNER_ELEVENLABS_STS_MODEL_ID ||
        access.account_read_live !== true || access.access !== true || access.parameters_redacted !== true ||
        !Array.isArray(access.parameter_keys) || access.parameter_keys.length !== 2 || [...access.parameter_keys].sort().join(",") !== "duration,mode" ||
        !(access.cost === null || finiteNonnegative(access.cost)) ||
        !(access.discount_cost === null || finiteNonnegative(access.discount_cost)) ||
        !(finiteNonnegative(access.cost) || finiteNonnegative(access.discount_cost)) ||
        !freshIso(access.observed_at, now) || !this.#assertModelBinding() || binding.duration < 5 || binding.duration > 300) fail("PREFLIGHT_FAILED");
  }

  #assertModelBinding(): true {
    try { const model = this.#catalog.getModel(OWNER_ELEVENLABS_STS_MODEL_ID);
      if (this.#catalogVersion !== OWNER_ELEVENLABS_STS_PUBLIC_CATALOG_VERSION || !model.active ||
          model.id !== OWNER_ELEVENLABS_STS_MODEL_ID || model.upstream_id !== OWNER_ELEVENLABS_STS_MODEL_ID || model.ai_name !== "elevenlabs" ||
          !Array.isArray(model.settings?.get_cost_params) || [...model.settings.get_cost_params].sort().join(",") !== "duration,mode") fail("MODEL_BINDING_MISMATCH");
      return true;
    } catch (error) { if (error instanceof OwnerElevenLabsStsGenerationServiceError) throw error; fail("MODEL_BINDING_MISMATCH"); }
  }
  #nativeClient(attemptId: string): SyntxChatHttpClient {
    let value: unknown; try { value = Reflect.apply(this.#resolveChatClient, undefined, [attemptId]); } catch { fail("PRE_DISPATCH_FAILED"); }
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype) fail("PRE_DISPATCH_FAILED");
    const previous = this.#clientsByAttempt.get(attemptId);
    if (previous && previous !== value) fail("PRINCIPAL_NOT_LINKED");
    this.#clientsByAttempt.set(attemptId, value as SyntxChatHttpClient);
    return value as SyntxChatHttpClient;
  }
  async #principal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    try { const p = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
      if (p.connection_id !== attemptId || p.tenant_id !== this.#binding.tenant_id || p.subject_id !== this.#binding.subject) fail("PRINCIPAL_NOT_LINKED"); return p;
    } catch { fail("PRINCIPAL_NOT_LINKED"); }
  }
  async #checkPrincipal(attemptId: string, expected: Readonly<GenerationPrincipalRef>): Promise<void> {
    const current = await this.#principal(attemptId);
    if (!sameGenerationPrincipal(current, expected) || this.#invalidating.has(attemptId)) fail("PRINCIPAL_NOT_LINKED");
  }
  #newRecovery(attemptId: string, principal: Readonly<GenerationPrincipalRef>, semantic: string,
    candidate: OwnerElevenLabsStsPreparedCandidate, permit: OwnerElevenLabsStsOneShotPermit,
    chat: OwnerElevenLabsStsChatContext, client: SyntxChatHttpClient, binding: Readonly<OwnerElevenLabsStsCandidateBinding>): Recovery {
    if (this.#recoveries.size >= MAX_RECOVERIES) fail("SERVICE_BUSY"); const now = this.#readNow();
    return { recovery_id: `elevenlabs_sts_recovery_${randomUUID()}`, attemptId, principal, created_at: new Date(now).toISOString(),
      semantic_key: semantic, candidate, permit, chat, client, binding, owner_echo_message_id: null, status: "outcome_unknown", artifacts: Object.freeze([]),
      diagnostic: { phase: "CHAT_CREATE", post_started: false, ack_known: false, history_status: "NOT_READ", owner_ack_status: "NOT_READ",
        history_get_calls: 0, result_get_calls: 0, result_status: "NOT_READ", gaps: [] } };
  }
  #ownedRecovery(attemptId: string, recoveryId: string, principal: Readonly<GenerationPrincipalRef>): Recovery {
    const recovery = this.#recoveries.get(recoveryId);
    if (this.#invalidating.has(attemptId) || !recovery || recovery.attemptId !== attemptId || !sameGenerationPrincipal(recovery.principal, principal)) fail("RECOVERY_NOT_FOUND");
    return recovery;
  }
  #await<T>(deadline: AbsoluteRequestDeadline, operation: () => Promise<T>): Promise<T> {
    deadline.throwIfAborted(); return deadline.waitFor(operation());
  }
  #run<T>(attemptId: string, parent: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.#closed || !SERVICES.has(this)) return Promise.reject(serviceError("SERVICE_CLOSED"));
    if (this.#invalidating.has(attemptId) || this.#runs.size >= MAX_RUNS || (parent && (types.isProxy(parent) || !(parent instanceof AbortSignal)))) return Promise.reject(serviceError("SERVICE_BUSY"));
    const controller = new AbortController(); const abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    const run: ActiveRun = { attemptId, controller, promise: Promise.resolve() }; const p = operation(controller.signal); run.promise = p; this.#runs.add(run);
    return p.finally(() => { parent?.removeEventListener("abort", abort); this.#runs.delete(run); });
  }
  #readNow(): number { const n = this.#now(); if (!Number.isSafeInteger(n) || n < this.#lastNow) fail("SERVICE_BUSY"); this.#lastNow = n; return n; }
}

export function isOwnerElevenLabsStsGenerationService(value: unknown): value is OwnerElevenLabsStsGenerationService {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) && Object.getPrototypeOf(value) === OwnerElevenLabsStsGenerationService.prototype; } catch { return false; }
}
function snapshotGenerate(value: unknown): Readonly<OwnerElevenLabsStsGenerateInput> {
  const row = exact(value, ["attemptId", "request"]), request = exact(row.request, ["model_id", "mode", "audio_original_handle", "voice_ref"]);
  if (request.model_id !== OWNER_ELEVENLABS_STS_MODEL_ID || request.mode !== OWNER_ELEVENLABS_STS_MODE || typeof request.audio_original_handle !== "string" ||
      !/^elevenlabs_sts_original_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(request.audio_original_handle) ||
      typeof request.voice_ref !== "string" || !/^owner_elevenlabs_voice_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(request.voice_ref)) invalid();
  return Object.freeze({ attemptId: safeAttempt(row.attemptId), request: Object.freeze(request) as unknown as OwnerElevenLabsStsRequest });
}
function snapshotRecovery(value: unknown): Readonly<OwnerElevenLabsStsReconcileInput> { const r = exact(value, ["attemptId", "recovery_id"]); if (typeof r.recovery_id !== "string" || !RECOVERY.test(r.recovery_id)) invalid(); return Object.freeze({ attemptId: safeAttempt(r.attemptId), recovery_id: r.recovery_id }); }
function snapshotList(value: unknown): { attemptId: string; limit: number } { const r = exact(value, ["attemptId"], ["limit"]); return { attemptId: safeAttempt(r.attemptId), limit: bounded(r.limit, 1, 128, 32) }; }
function snapshotPage(value: unknown): { attemptId: string; recovery_id: string; offset: number } { const r = exact(value, ["attemptId", "recovery_id"], ["offset"]); if (typeof r.recovery_id !== "string" || !RECOVERY.test(r.recovery_id)) invalid(); return { attemptId: safeAttempt(r.attemptId), recovery_id: r.recovery_id, offset: bounded(r.offset, 0, MAX_RESULTS, 0) }; }
function semanticKey(principal: Readonly<GenerationPrincipalRef>, intentFingerprint: string): string { return createHash("sha256").update(JSON.stringify([principal.tenant_id, principal.subject_id, intentFingerprint])).digest("hex"); }
function pageResult(r: Recovery, offset: number): OwnerElevenLabsStsGenerationResult { if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_RESULTS) invalid(); const artifacts = r.artifacts.slice(offset, offset + RESULT_PAGE_SIZE), next = offset + artifacts.length; return Object.freeze({ status: "completed", status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", backend_acceptance: "UNPROVEN", provider_terminal_status: "UNPROVEN", cost_cap_enforced: false, recovery_id: r.recovery_id, model_id: OWNER_ELEVENLABS_STS_MODEL_ID, source_binding: Object.freeze({ public_catalog_version: OWNER_ELEVENLABS_STS_PUBLIC_CATALOG_VERSION, profile_schema_hash: r.binding.profile_schema_hash, request_fingerprint: r.binding.request_fingerprint, intent_fingerprint: r.binding.intent_fingerprint }), observed_artifact_count: r.artifacts.length, offset, page_size: RESULT_PAGE_SIZE, artifacts: Object.freeze(artifacts), has_more: next < r.artifacts.length, next_offset: next < r.artifacts.length ? next : null, diagnostic: snapshotDiagnostic(r.diagnostic) }); }
function recoveryItem(r: Recovery): OwnerElevenLabsStsRecoveryListItem { return Object.freeze({ recovery_id: r.recovery_id, created_at: r.created_at, model_id: OWNER_ELEVENLABS_STS_MODEL_ID, status: r.status, observed_artifact_count: r.artifacts.length, diagnostic: snapshotDiagnostic(r.diagnostic) }); }
function snapshotDiagnostic(d: MutableDiagnostic): OwnerElevenLabsStsGenerationDiagnostic { return Object.freeze({ phase: d.phase, post_started: d.post_started, ack_known: d.ack_known, history_status: d.history_status, owner_ack_status: d.owner_ack_status, history_get_calls: d.history_get_calls, result_get_calls: d.result_get_calls, result_status: d.result_status, gaps: Object.freeze(d.gaps.slice(0, 32)) }); }
function unknownError(r: Recovery): OwnerElevenLabsStsGenerationServiceError { return new OwnerElevenLabsStsGenerationServiceError("OUTCOME_UNKNOWN", r.recovery_id, snapshotDiagnostic(r.diagnostic)); }
function validAudio(audio: OwnerElevenLabsStsReadyAudio, context: OwnerElevenLabsStsResultMessageContext): boolean { try { const u = new URL(audio.object_url); return audio.object_type === "audio" && audio.object_index === 0 && audio.mime_type === "audio/mpeg" && audio.mime_source === "URL_EXTENSION_LOCAL_POLICY" && context.message_object_ids[0] === audio.message_object_id && u.protocol === "https:" && u.hostname === "r2.syntx.ai" && !u.port && !u.username && !u.password && !u.hash && u.pathname.toLowerCase().endsWith(".mp3"); } catch { return false; } }
function validReceipt(v: unknown, chat: string): v is MediaGenerationReceipt { try { const r = exact(v, ["chat_uuid", "message_id"]); return r.chat_uuid === chat && isSafeId(r.message_id); } catch { return false; } }
function freshIso(value: unknown, now: number): boolean { if (typeof value !== "string") return false; const t = Date.parse(value); return Number.isFinite(t) && t <= now + 30_000 && t >= now - 300_000; }
function finiteNonnegative(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function validAccount(value: AccountStatusResult, now: number): boolean {
  const account = value as unknown as Record<string, unknown>;
  const balance = account.balance as Record<string, unknown> | undefined;
  const subscription = account.subscription as Record<string, unknown> | undefined;
  if (account.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || account.source_build !== ACCOUNT_SOURCE_BUILD || !balance ||
      balance.unit !== "tokens" || !(balance.available === null || (typeof balance.available === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(balance.available))) ||
      !subscription || subscription.active !== true || !freshIso(account.observed_at, now) ||
      !(subscription.plan_type === null || typeof subscription.plan_type === "string") ||
      !(subscription.end_date === null || typeof subscription.end_date === "string") ||
      !(subscription.end_date_kind === null || ["DATE_ONLY", "LOCAL_DATETIME", "OFFSET_DATETIME"].includes(String(subscription.end_date_kind)))) return false;
  if (subscription.end_date === null) return true;
  const end = Date.parse(`${subscription.end_date_kind === "DATE_ONLY" ? `${subscription.end_date}T23:59:59.999Z` : subscription.end_date}`);
  return Number.isFinite(end) && end >= now;
}
function snapshotBinding(value: unknown): Readonly<AuthBinding> { const r = exact(value, ["tenant_id", "subject"]); if (typeof r.tenant_id !== "string" || !r.tenant_id.trim() || typeof r.subject !== "string" || !r.subject.trim()) invalid(); return Object.freeze({ tenant_id: r.tenant_id, subject: r.subject }); }
function genuineLinkService(value: unknown): value is PerUserLinkService { return genuineMethods(value, PerUserLinkService, ["getStatus"]); }
function genuineMethods<T>(value: unknown, ctor: new (...args: never[]) => T, methods: readonly string[]): value is T { try { if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== ctor.prototype) return false; return methods.every((m) => !Object.hasOwn(value, m) && Reflect.get(value, m) === Reflect.get(ctor.prototype, m)); } catch { return false; } }
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, any> { if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid(); const p = Object.getPrototypeOf(value); if (p !== Object.prototype && p !== null) invalid(); const d = Object.getOwnPropertyDescriptors(value); const keys = Reflect.ownKeys(d); if (required.some((k) => !Object.hasOwn(d, k)) || keys.some((k) => typeof k !== "string" || (!required.includes(k) && !optional.includes(k)) || !("value" in d[k]!) || d[k]!.enumerable !== true)) invalid(); const out: Record<string, any> = Object.create(null); for (const k of keys as string[]) out[k] = d[k]!.value; return out; }
function readClock(value: unknown): () => number { if (value === undefined) return Date.now; if (typeof value !== "function" || types.isProxy(value)) invalid(); return value as () => number; }
function bounded(value: unknown, min: number, max: number, fallback: number): number { if (value === undefined) return fallback; if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) invalid(); return value as number; }
function safeAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) invalid(); return value; }
function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function invalid(): never { return fail("INVALID_REQUEST"); }
function fail(code: OwnerElevenLabsStsGenerationServiceErrorCode): never { throw serviceError(code); }
function serviceError(code: OwnerElevenLabsStsGenerationServiceErrorCode): OwnerElevenLabsStsGenerationServiceError { return new OwnerElevenLabsStsGenerationServiceError(code); }
