import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { SyntxChatHttpClient, type MediaGenerationReceipt } from "../adapter/syntx/chat-http-client.js";
import { OWNER_TOPAZ_ASTRA_PUBLIC_CATALOG_VERSION, OWNER_TOPAZ_ASTRA_MODEL_IDS,
  type OwnerTopazAstraModelId } from "./owner-topaz-astra-source-profile.js";
import type { OwnerTopazAstraChatContext, OwnerTopazAstraResultCandidates,
  OwnerTopazAstraResultContext } from "../adapter/syntx/owner-topaz-astra-native-context.js";
import type { OwnerWanT2vReadyVideo } from "../adapter/syntx/owner-wan-t2v-video-result.js";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { AccountStatusService, type AccountStatusResult } from "./account-status.js";
import { ModelAccessService, type ModelAccessResult } from "./model-access.js";
import { OwnerTopazAstraOriginalReferenceService } from "./owner-topaz-astra-original-reference-service.js";
import { OwnerTopazAstraOwnedRequestPreparer, type OwnerTopazAstraOwnedPreparedCandidate,
  isOwnerTopazAstraOwnedRequestPreparer, type OwnerTopazAstraOwnedCandidateBinding } from "./owner-topaz-astra-owned-request-preparer.js";
import { createOwnerTopazAstraOwnedOneShotPermit, revalidateOwnerTopazAstraOwnedOneShotPermit,
  type OwnerTopazAstraOwnedOneShotPermit } from "./owner-topaz-astra-owned-one-shot-policy.js";

export const OWNER_TOPAZ_ASTRA_GENERATION_CATALOG_VERSION = OWNER_TOPAZ_ASTRA_PUBLIC_CATALOG_VERSION;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u, RECOVERY = /^topaz_astra_recovery_[0-9a-f-]{36}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const MAX_RECOVERIES = 128, MAX_RUNS = 4, PAGE_SIZE = 64, MAX_RESULTS = 4096, DEFAULT_TIMEOUT_MS = 120_000;
const ACCOUNT = AccountStatusService.prototype.getAccountStatus, ACCESS = ModelAccessService.prototype.getModelAccess;
const CREATE = SyntxChatHttpClient.prototype.createOwnerTopazAstraChat;
const START = SyntxChatHttpClient.prototype.startTopazAstraWithOwnedCandidate;
const LIST = SyntxChatHttpClient.prototype.listOwnedTopazAstraCandidates;
const GET = SyntxChatHttpClient.prototype.getOwnedTopazAstraResult;
const SERVICES = new WeakSet<object>();

export type OwnerTopazAstraGenerationPhase = "VALIDATE_REQUEST" | "RESOLVE_PRINCIPAL" | "PREPARE_CANDIDATE" |
  "PREFLIGHT_ONE" | "CHAT_CREATE" | "PREFLIGHT_TWO" | "GENERATION_POST" | "POST_ACK_KNOWN" | "HISTORY_GET" | "RESULT_GET" | "RESULT_BINDING";
export interface OwnerTopazAstraGenerationDiagnostic {
  readonly phase: OwnerTopazAstraGenerationPhase; readonly post_started: boolean; readonly ack_known: boolean;
  readonly history_status: "NOT_READ" | "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "NOT_READ" | "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  readonly history_get_calls: number; readonly result_get_calls: number;
  readonly result_status: "NOT_READ" | "PENDING" | "COMPLETE" | "UNVERIFIED"; readonly gaps: readonly string[];
}
export interface OwnerTopazAstraVideoArtifact extends OwnerWanT2vReadyVideo {
  readonly message_id: string; readonly chat_uuid: string; readonly model_id: OwnerTopazAstraModelId;
}
export interface OwnerTopazAstraGenerationResult {
  readonly status: "completed"; readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly backend_acceptance: "UNPROVEN"; readonly provider_terminal_status: "UNPROVEN"; readonly cost_cap_enforced: false;
  readonly recovery_id: string; readonly model_id: OwnerTopazAstraModelId;
  readonly source_binding: Readonly<{ public_catalog_version: typeof OWNER_TOPAZ_ASTRA_PUBLIC_CATALOG_VERSION;
    profile_schema_hash: string; request_fingerprint: string; intent_fingerprint: string }>;
  readonly observed_artifact_count: number; readonly offset: number; readonly page_size: typeof PAGE_SIZE;
  readonly artifacts: readonly OwnerTopazAstraVideoArtifact[]; readonly has_more: boolean; readonly next_offset: number | null;
  readonly diagnostic: OwnerTopazAstraGenerationDiagnostic;
}
export interface OwnerTopazAstraRecoveryListItem {
  readonly recovery_id: string; readonly created_at: string; readonly model_id: OwnerTopazAstraModelId;
  readonly status: "outcome_unknown" | "completed"; readonly observed_artifact_count: number;
  readonly diagnostic: OwnerTopazAstraGenerationDiagnostic;
}
export interface OwnerTopazAstraGenerationServiceOptions {
  readonly binding: AuthBinding; readonly linkService: PerUserLinkService; readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string; readonly preparer: OwnerTopazAstraOwnedRequestPreparer;
  readonly originalReferenceService: OwnerTopazAstraOriginalReferenceService;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly createAccountStatusService: (attemptId: string) => AccountStatusService;
  readonly createModelAccessService: (attemptId: string) => ModelAccessService;
  readonly now?: () => number; readonly timeoutMs?: number;
}
export interface OwnerTopazAstraGenerateInput { readonly attemptId: string; readonly request: Readonly<{
  model_id: OwnerTopazAstraModelId; topaz_original_handle: string; prompt?: string;
  parameters: Readonly<{ resolution: "1920x1080" | "3840x2160"; frame_rate: 24 | 30 | 60 | 120;
    slowmo: null | 2 | 3 | 4 | 6 | 8 | 10 | 12 | 16; creativity: "low" | "middle" | "high" }>;
}> }
export interface OwnerTopazAstraReconcileInput { readonly attemptId: string; readonly recovery_id: string; }
export interface OwnerTopazAstraRecoveryListInput { readonly attemptId: string; readonly limit?: number; }
export interface OwnerTopazAstraResultPageInput { readonly attemptId: string; readonly recovery_id: string; readonly offset?: number; }
export type OwnerTopazAstraGenerationServiceErrorCode = "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" |
  "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH" | "PREFLIGHT_FAILED" | "INTENT_ALREADY_CLAIMED" |
  "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND";
export class OwnerTopazAstraGenerationServiceError extends Error {
  readonly diagnostic?: OwnerTopazAstraGenerationDiagnostic;
  constructor(readonly code: OwnerTopazAstraGenerationServiceErrorCode, readonly recovery_id?: string,
    diagnostic?: OwnerTopazAstraGenerationDiagnostic) {
    super(code === "OUTCOME_UNKNOWN" ? "The Topaz Astra request may have been dispatched; reconcile its recovery and do not retry."
      : "The owner Topaz Astra request could not be completed safely.");
    this.name = "OwnerTopazAstraGenerationServiceError";
    if (code === "OUTCOME_UNKNOWN" && diagnostic) this.diagnostic = diagnostic;
  }
}

interface MutableDiagnostic { phase: OwnerTopazAstraGenerationPhase; post_started: boolean; ack_known: boolean;
  history_status: OwnerTopazAstraGenerationDiagnostic["history_status"]; owner_ack_status: OwnerTopazAstraGenerationDiagnostic["owner_ack_status"];
  history_get_calls: number; result_get_calls: number; result_status: OwnerTopazAstraGenerationDiagnostic["result_status"]; gaps: string[]; }
interface Recovery { readonly recovery_id: string; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly created_at: string; readonly semantic_key: string; readonly candidate: OwnerTopazAstraOwnedPreparedCandidate;
  readonly permit: OwnerTopazAstraOwnedOneShotPermit; readonly chat: OwnerTopazAstraChatContext;
  readonly client: SyntxChatHttpClient; readonly binding: Readonly<OwnerTopazAstraOwnedCandidateBinding>;
  owner_echo_message_id: string | null; status: "outcome_unknown" | "completed";
  artifacts: readonly OwnerTopazAstraVideoArtifact[]; readonly diagnostic: MutableDiagnostic; }
interface ActiveRun { readonly attemptId: string; readonly controller: AbortController; promise: Promise<unknown>; }

/** Owner-only Topaz single-dispatch service. It owns and closes its preparer; the original service is borrowed. */
export class OwnerTopazAstraGenerationService {
  readonly #binding: Readonly<AuthBinding>; readonly #linkService: PerUserLinkService; readonly #catalog: DiscoveryCatalogRepository;
  readonly #catalogVersion: string; readonly #preparer: OwnerTopazAstraOwnedRequestPreparer;
  readonly #original: OwnerTopazAstraOriginalReferenceService;
  readonly #resolveChatClient: OwnerTopazAstraGenerationServiceOptions["resolveChatClient"];
  readonly #createAccount: OwnerTopazAstraGenerationServiceOptions["createAccountStatusService"];
  readonly #createAccess: OwnerTopazAstraGenerationServiceOptions["createModelAccessService"];
  readonly #now: () => number; readonly #timeoutMs: number; readonly #recoveries = new Map<string, Recovery>();
  readonly #claims = new Map<string, string>(); readonly #reserved = new Set<string>();
  readonly #usedAccounts = new WeakSet<object>(); readonly #usedAccess = new WeakSet<object>();
  readonly #runs = new Set<ActiveRun>(); readonly #invalidating = new Set<string>(); readonly #clientsByAttempt = new Map<string, SyntxChatHttpClient>();
  #closed = false; #closing: Promise<void> | undefined; #lastNow = -1;

  constructor(optionsInput: OwnerTopazAstraGenerationServiceOptions | unknown) {
    const o = exact(optionsInput, ["binding", "linkService", "catalog", "catalog_version", "preparer", "originalReferenceService",
      "resolveChatClient", "createAccountStatusService", "createModelAccessService"], ["now", "timeoutMs"]);
    this.#binding = snapshotBinding(o.binding);
    if (!genuineMethods(o.linkService, PerUserLinkService, ["getStatus"]) || !(o.catalog instanceof DiscoveryCatalogRepository) ||
        o.catalog_version !== OWNER_TOPAZ_ASTRA_PUBLIC_CATALOG_VERSION ||
        !isOwnerTopazAstraOwnedRequestPreparer(o.preparer) ||
        !genuineMethods(o.preparer, OwnerTopazAstraOwnedRequestPreparer, ["prepare", "inspectCandidate", "getPrivateRequest", "revalidateCandidate", "invalidateAttempt", "close"]) ||
        !o.originalReferenceService || types.isProxy(o.originalReferenceService) || !(o.originalReferenceService instanceof OwnerTopazAstraOriginalReferenceService) ||
        Object.getPrototypeOf(o.originalReferenceService) !== OwnerTopazAstraOriginalReferenceService.prototype ||
        typeof o.resolveChatClient !== "function" || types.isProxy(o.resolveChatClient) ||
        typeof o.createAccountStatusService !== "function" || types.isProxy(o.createAccountStatusService) ||
        typeof o.createModelAccessService !== "function" || types.isProxy(o.createModelAccessService)) invalid();
    this.#linkService = o.linkService as PerUserLinkService; this.#catalog = o.catalog; this.#catalogVersion = o.catalog_version as string;
    this.#preparer = o.preparer as OwnerTopazAstraOwnedRequestPreparer; this.#original = o.originalReferenceService as OwnerTopazAstraOriginalReferenceService;
    this.#resolveChatClient = o.resolveChatClient as OwnerTopazAstraGenerationServiceOptions["resolveChatClient"];
    this.#createAccount = o.createAccountStatusService as OwnerTopazAstraGenerationServiceOptions["createAccountStatusService"];
    this.#createAccess = o.createModelAccessService as OwnerTopazAstraGenerationServiceOptions["createModelAccessService"];
    this.#now = readClock(o.now); this.#timeoutMs = bounded(o.timeoutMs, 1_000, 300_000, DEFAULT_TIMEOUT_MS);
    for (const id of OWNER_TOPAZ_ASTRA_MODEL_IDS) this.#assertModelBinding(id);
    SERVICES.add(this); Object.freeze(this);
  }

  async generate(input: OwnerTopazAstraGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerTopazAstraGenerationResult> {
    const request = snapshotGenerate(input); return this.#run(request.attemptId, signal, (s) => this.#generate(request, s));
  }
  async reconcile(input: OwnerTopazAstraReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerTopazAstraGenerationResult> {
    const request = snapshotRecovery(input); if (this.#invalidating.has(request.attemptId)) fail("RECOVERY_NOT_FOUND");
    return this.#run(request.attemptId, signal, (s) => this.#reconcile(request, s));
  }
  async listRecoveries(input: OwnerTopazAstraRecoveryListInput | unknown): Promise<readonly OwnerTopazAstraRecoveryListItem[]> {
    const request = snapshotList(input); return this.#run(request.attemptId, undefined, async () => {
      const principal = await this.#principal(request.attemptId);
      return Object.freeze([...this.#recoveries.values()].filter((r) => r.attemptId === request.attemptId && sameGenerationPrincipal(r.principal, principal))
        .slice(0, request.limit).map(recoveryItem));
    });
  }
  async getResultPage(input: OwnerTopazAstraResultPageInput | unknown): Promise<OwnerTopazAstraGenerationResult> {
    const request = snapshotPage(input); return this.#run(request.attemptId, undefined, async () => {
      const r = this.#ownedRecovery(request.attemptId, request.recovery_id, await this.#principal(request.attemptId));
      if (r.status !== "completed") throw unknownError(r); return pageResult(r, request.offset);
    });
  }
  async invalidateAttempt(attemptInput: unknown): Promise<void> {
    const id = safeAttempt(attemptInput); this.#invalidating.add(id); await this.#preparer.invalidateAttempt(id);
    const active = [...this.#runs].filter((r) => r.attemptId === id); for (const r of active) r.controller.abort();
    await Promise.allSettled(active.map((r) => r.promise));
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing; this.#closed = true;
    for (const run of this.#runs) run.controller.abort();
    const attempts = new Set([...this.#runs].map((r) => r.attemptId));
    this.#closing = (async () => { for (const id of attempts) await this.#preparer.invalidateAttempt(id);
      await Promise.allSettled([...this.#runs].map((r) => r.promise)); await this.#preparer.close(); this.#runs.clear(); })();
    return this.#closing;
  }

  async #generate(req: Readonly<OwnerTopazAstraGenerateInput>, signal: AbortSignal): Promise<OwnerTopazAstraGenerationResult> {
    const deadline = new AbsoluteRequestDeadline(this.#timeoutMs, signal, () => serviceError("PRE_DISPATCH_FAILED"));
    let candidate: OwnerTopazAstraOwnedPreparedCandidate | undefined, permit: OwnerTopazAstraOwnedOneShotPermit | undefined;
    let semantic: string | undefined, recovery: Recovery | undefined, postStarted = false;
    try {
      deadline.throwIfAborted(); this.#assertModelBinding(req.request.model_id);
      const principal = await this.#await(deadline, () => this.#principal(req.attemptId));
      candidate = await this.#await(deadline, () => this.#preparer.prepare({ attemptId: req.attemptId,
        topaz_original_handle: req.request.topaz_original_handle, model_id: req.request.model_id,
        ...(req.request.prompt === undefined ? {} : { prompt: req.request.prompt }), parameters: req.request.parameters }));
      const binding = this.#preparer.inspectCandidate(candidate); if (!binding || candidate.control_combination_status !== "SOURCE_UI_ENUMS_EXPLICIT_CONTROLS") fail("PRE_DISPATCH_FAILED");
      semantic = semanticKey(principal, candidate.intent_fingerprint);
      if (this.#claims.has(semantic) || this.#reserved.has(semantic)) fail("INTENT_ALREADY_CLAIMED");
      if (this.#claims.size + this.#reserved.size >= MAX_RECOVERIES) fail("SERVICE_BUSY");
      this.#reserved.add(semantic);
      permit = await createOwnerTopazAstraOwnedOneShotPermit({ candidate, attemptId: req.attemptId, principal, preparer: this.#preparer });
      await this.#preflight(req.attemptId, binding, deadline);
      const client = this.#nativeClient(req.attemptId); deadline.throwIfAborted();
      this.#claims.set(semantic, "CHAT_PENDING"); this.#reserved.delete(semantic);
      const nativeInput = Object.freeze({ candidate, permit, preparer: this.#preparer, originalReferenceService: this.#original,
        principal, attemptId: req.attemptId, linkService: this.#linkService, binding: this.#binding });
      const chat = await this.#await(deadline, () => Reflect.apply(CREATE, client, [nativeInput, deadline.signal]) as Promise<OwnerTopazAstraChatContext>);
      if (!isSafeId(chat.chat_uuid)) fail("PRE_DISPATCH_FAILED");
      await this.#checkPrincipal(req.attemptId, principal); await this.#preflight(req.attemptId, binding, deadline);
      await this.#checkPrincipal(req.attemptId, principal); await this.#preparer.revalidateCandidate(candidate);
      await revalidateOwnerTopazAstraOwnedOneShotPermit({ candidate, permit, attemptId: req.attemptId, principal, preparer: this.#preparer });
      recovery = this.#newRecovery(req.attemptId, principal, semantic, candidate, permit, chat, client, binding);
      this.#recoveries.set(recovery.recovery_id, recovery); this.#claims.set(semantic, recovery.recovery_id); semantic = undefined;
      recovery.diagnostic.phase = "GENERATION_POST"; recovery.diagnostic.post_started = true; postStarted = true;
      const receipt = await this.#await(deadline, () => Reflect.apply(START, client, [Object.freeze({ ...nativeInput, chat }), deadline.signal]) as Promise<MediaGenerationReceipt>);
      if (!validReceipt(receipt, chat.chat_uuid)) throw unknownError(recovery);
      recovery.owner_echo_message_id = receipt.message_id; recovery.diagnostic.ack_known = true;
      recovery.diagnostic.owner_ack_status = "MATCHED"; recovery.diagnostic.phase = "POST_ACK_KNOWN";
      return await this.#observe(recovery, deadline);
    } catch (error) {
      if (postStarted && recovery) throw unknownError(recovery);
      if (semantic) this.#reserved.delete(semantic);
      if (error instanceof OwnerTopazAstraGenerationServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      return fail("PRE_DISPATCH_FAILED");
    } finally { if (semantic) this.#reserved.delete(semantic); deadline.close(); }
  }

  async #reconcile(req: Readonly<OwnerTopazAstraReconcileInput>, signal: AbortSignal): Promise<OwnerTopazAstraGenerationResult> {
    const recovery = this.#ownedRecovery(req.attemptId, req.recovery_id, await this.#principal(req.attemptId));
    if (recovery.status === "completed") return pageResult(recovery, 0);
    const deadline = new AbsoluteRequestDeadline(this.#timeoutMs, signal, () => unknownError(recovery));
    try { await this.#checkPrincipal(req.attemptId, recovery.principal);
      if (this.#nativeClient(req.attemptId) !== recovery.client) fail("PRINCIPAL_NOT_LINKED"); return await this.#observe(recovery, deadline);
    } catch (error) { if (error instanceof OwnerTopazAstraGenerationServiceError && error.code === "RECOVERY_NOT_FOUND") throw error; throw unknownError(recovery); }
    finally { deadline.close(); }
  }
  async #observe(r: Recovery, deadline: AbsoluteRequestDeadline): Promise<OwnerTopazAstraGenerationResult> {
    deadline.throwIfAborted(); await this.#checkPrincipal(r.attemptId, r.principal); r.diagnostic.phase = "HISTORY_GET"; r.diagnostic.history_get_calls++;
    let history: OwnerTopazAstraResultCandidates;
    try { history = await this.#await(deadline, () => Reflect.apply(LIST, r.client, [r.chat, deadline.signal]) as Promise<OwnerTopazAstraResultCandidates>); }
    catch { deadline.throwIfAborted(); r.diagnostic.history_status = "UNVERIFIED"; throw unknownError(r); }
    r.diagnostic.owner_ack_status = history.owner_ack_status;
    if (history.owner_ack_status !== "MATCHED" || history.history_binding_status !== "BOUND" || history.history_page_status !== "COMPLETE" ||
        history.status !== "COMPLETE" || history.backend_acceptance !== "UNPROVEN" || history.gaps.length) {
      r.diagnostic.history_status = history.status === "PENDING" ? "PENDING" : history.status === "INCOMPLETE" ? "INCOMPLETE" : "UNVERIFIED";
      r.diagnostic.gaps = [...history.gaps].slice(0, 32); r.diagnostic.result_status = "PENDING"; throw unknownError(r);
    }
    r.diagnostic.history_status = "COMPLETE";
    const observed: OwnerTopazAstraVideoArtifact[] = [];
    for (const context of history.contexts) {
      if (!validContext(context, r)) { r.diagnostic.gaps = ["RESULT_CONTEXT_INVALID"]; throw unknownError(r); }
      await this.#checkPrincipal(r.attemptId, r.principal); r.diagnostic.phase = "RESULT_GET"; r.diagnostic.result_get_calls++;
      let decoded;
      try { decoded = await this.#await(deadline, () => Reflect.apply(GET, r.client, [context, deadline.signal])); }
      catch { deadline.throwIfAborted(); r.diagnostic.result_status = "UNVERIFIED"; throw unknownError(r); }
      if (decoded.message_binding !== "BOUND" || decoded.model_echo !== "MATCHED" || decoded.backend_acceptance !== "UNPROVEN" ||
          !Array.isArray(decoded.ready_videos) || decoded.ready_videos.length !== 1 || decoded.gaps.length) {
        r.diagnostic.gaps = [...decoded.gaps].slice(0, 32); r.diagnostic.result_status = "UNVERIFIED"; throw unknownError(r);
      }
      const video = decoded.ready_videos[0]!; if (!validVideo(video, context)) { r.diagnostic.gaps = ["VIDEO_PROJECTION_INVALID"]; throw unknownError(r); }
      observed.push(Object.freeze({ ...video, message_id: context.message_id, chat_uuid: context.chat_uuid, model_id: context.model_id }));
    }
    if (!observed.length || observed.length > MAX_RESULTS) { r.diagnostic.gaps = ["RESULT_LIMIT_EXCEEDED"]; throw unknownError(r); }
    r.artifacts = Object.freeze(observed); r.status = "completed"; r.diagnostic.phase = "RESULT_BINDING";
    r.diagnostic.result_status = "COMPLETE"; r.diagnostic.gaps = []; return pageResult(r, 0);
  }
  async #preflight(attemptId: string, b: Readonly<OwnerTopazAstraOwnedCandidateBinding>, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted(); let account: AccountStatusService, access: ModelAccessService;
    try { account = Reflect.apply(this.#createAccount, undefined, [attemptId]) as AccountStatusService;
      access = Reflect.apply(this.#createAccess, undefined, [attemptId]) as ModelAccessService; } catch { fail("PREFLIGHT_FAILED"); }
    if (!genuineMethods(account, AccountStatusService, ["getAccountStatus"]) || this.#usedAccounts.has(account) ||
        !genuineMethods(access, ModelAccessService, ["getModelAccess"]) || this.#usedAccess.has(access)) fail("PREFLIGHT_FAILED");
    this.#usedAccounts.add(account); this.#usedAccess.add(access);
    let a: AccountStatusResult, q: ModelAccessResult;
    try { a = await this.#await(deadline, () => Reflect.apply(ACCOUNT, account, [deadline.signal]) as Promise<AccountStatusResult>);
      q = await this.#await(deadline, () => Reflect.apply(ACCESS, access, [Object.freeze({ model_id: b.model_id,
        cost_parameters: Object.freeze({ video_duration: Math.round(b.duration_seconds), frame_rate: b.parameters.frame_rate,
          resolution: b.parameters.resolution }) }), deadline.signal]) as Promise<ModelAccessResult>); }
    catch { fail("PREFLIGHT_FAILED"); }
    const now = this.#readNow(), model = this.#catalog.getModel(b.model_id);
    if (!validAccount(a, now) || q.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" ||
        q.catalog_version !== `${this.#catalog.fetched_at}.${this.#catalog.source_hashes.models.slice(7, 19)}` ||
        q.model_id !== b.model_id || q.ai_name !== "topaz_astra" || q.model_type !== b.model_id || q.account_read_live !== true ||
        q.access !== true || q.parameters_redacted !== true || !sameStrings(q.parameter_keys, ["frame_rate", "resolution", "video_duration"]) ||
        !(q.cost === null || finiteNonnegative(q.cost)) || !(q.discount_cost === null || finiteNonnegative(q.discount_cost)) ||
        !(finiteNonnegative(q.cost) || finiteNonnegative(q.discount_cost)) || !freshIso(q.observed_at, now) || !model.active) fail("PREFLIGHT_FAILED");
  }
  #assertModelBinding(modelId?: OwnerTopazAstraModelId): true {
    try { const ids = modelId ? [modelId] : OWNER_TOPAZ_ASTRA_MODEL_IDS;
      for (const id of ids) { const m = this.#catalog.getModel(id), keys = m.settings?.get_cost_params ?? [];
        if (this.#catalogVersion !== OWNER_TOPAZ_ASTRA_PUBLIC_CATALOG_VERSION || !m.active || m.id !== id || m.upstream_id !== id || m.ai_name !== "topaz_astra" ||
            !["frame_rate", "resolution", "video_duration"].every((key) => keys.includes(key))) fail("MODEL_BINDING_MISMATCH"); }
      return true;
    } catch (error) { if (error instanceof OwnerTopazAstraGenerationServiceError) throw error; fail("MODEL_BINDING_MISMATCH"); }
  }
  #nativeClient(attemptId: string): SyntxChatHttpClient {
    let v: unknown; try { v = Reflect.apply(this.#resolveChatClient, undefined, [attemptId]); } catch { fail("PRE_DISPATCH_FAILED"); }
    if (!v || typeof v !== "object" || types.isProxy(v) || Object.getPrototypeOf(v) !== SyntxChatHttpClient.prototype) fail("PRE_DISPATCH_FAILED");
    const old = this.#clientsByAttempt.get(attemptId); if (old && old !== v) fail("PRINCIPAL_NOT_LINKED"); this.#clientsByAttempt.set(attemptId, v as SyntxChatHttpClient); return v as SyntxChatHttpClient;
  }
  async #principal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    try { const p = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
      if (p.connection_id !== attemptId || p.tenant_id !== this.#binding.tenant_id || p.subject_id !== this.#binding.subject) fail("PRINCIPAL_NOT_LINKED"); return p;
    } catch { fail("PRINCIPAL_NOT_LINKED"); }
  }
  async #checkPrincipal(attemptId: string, expected: Readonly<GenerationPrincipalRef>): Promise<void> {
    if (!sameGenerationPrincipal(await this.#principal(attemptId), expected) || this.#invalidating.has(attemptId)) fail("PRINCIPAL_NOT_LINKED");
  }
  #newRecovery(attemptId: string, principal: Readonly<GenerationPrincipalRef>, semantic: string, candidate: OwnerTopazAstraOwnedPreparedCandidate,
    permit: OwnerTopazAstraOwnedOneShotPermit, chat: OwnerTopazAstraChatContext, client: SyntxChatHttpClient,
    binding: Readonly<OwnerTopazAstraOwnedCandidateBinding>): Recovery {
    if (this.#recoveries.size >= MAX_RECOVERIES) fail("SERVICE_BUSY"); const now = this.#readNow();
    return { recovery_id: `topaz_astra_recovery_${randomUUID()}`, attemptId, principal, created_at: new Date(now).toISOString(), semantic_key: semantic,
      candidate, permit, chat, client, binding, owner_echo_message_id: null, status: "outcome_unknown", artifacts: Object.freeze([]),
      diagnostic: { phase: "CHAT_CREATE", post_started: false, ack_known: false, history_status: "NOT_READ", owner_ack_status: "NOT_READ",
        history_get_calls: 0, result_get_calls: 0, result_status: "NOT_READ", gaps: [] } };
  }
  #ownedRecovery(attemptId: string, id: string, p: Readonly<GenerationPrincipalRef>): Recovery {
    const r = this.#recoveries.get(id); if (this.#invalidating.has(attemptId) || !r || r.attemptId !== attemptId || !sameGenerationPrincipal(r.principal, p)) fail("RECOVERY_NOT_FOUND"); return r;
  }
  #await<T>(d: AbsoluteRequestDeadline, operation: () => Promise<T>): Promise<T> { d.throwIfAborted(); return d.waitFor(operation()); }
  #run<T>(attemptId: string, parent: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.#closed || !SERVICES.has(this)) return Promise.reject(serviceError("SERVICE_CLOSED"));
    if (this.#invalidating.has(attemptId) || this.#runs.size >= MAX_RUNS || (parent && (types.isProxy(parent) || !(parent instanceof AbortSignal)))) return Promise.reject(serviceError("SERVICE_BUSY"));
    const controller = new AbortController(), abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    const run: ActiveRun = { attemptId, controller, promise: Promise.resolve() }; const p = operation(controller.signal); run.promise = p; this.#runs.add(run);
    return p.finally(() => { parent?.removeEventListener("abort", abort); this.#runs.delete(run); });
  }
  #readNow(): number { const n = this.#now(); if (!Number.isSafeInteger(n) || n < this.#lastNow) fail("SERVICE_BUSY"); this.#lastNow = n; return n; }
}

export function isOwnerTopazAstraGenerationService(value: unknown): value is OwnerTopazAstraGenerationService {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) && Object.getPrototypeOf(value) === OwnerTopazAstraGenerationService.prototype; } catch { return false; }
}
function snapshotGenerate(value: unknown): Readonly<OwnerTopazAstraGenerateInput> {
  const row = exact(value, ["attemptId", "request"]), r = exact(row.request, ["model_id", "topaz_original_handle", "parameters"], ["prompt"]);
  const p = exact(r.parameters, ["resolution", "frame_rate", "slowmo", "creativity"]);
  if (typeof r.model_id !== "string" || !(OWNER_TOPAZ_ASTRA_MODEL_IDS as readonly string[]).includes(r.model_id) ||
      typeof r.topaz_original_handle !== "string" || !/^topaz_astra_original_[0-9a-f-]{36}$/u.test(r.topaz_original_handle) ||
      (r.prompt !== undefined && typeof r.prompt !== "string") || !["1920x1080", "3840x2160"].includes(String(p.resolution)) ||
      ![24, 30, 60, 120].includes(p.frame_rate as number) || ![null, 2, 3, 4, 6, 8, 10, 12, 16].includes(p.slowmo as number | null) ||
      !["low", "middle", "high"].includes(String(p.creativity))) invalid();
  return Object.freeze({ attemptId: safeAttempt(row.attemptId), request: Object.freeze({ model_id: r.model_id as OwnerTopazAstraModelId,
    topaz_original_handle: r.topaz_original_handle, ...(r.prompt === undefined ? {} : { prompt: r.prompt as string }),
    parameters: Object.freeze(p) as unknown as OwnerTopazAstraGenerateInput["request"]["parameters"] }) });
}
function snapshotRecovery(v: unknown): Readonly<OwnerTopazAstraReconcileInput> { const r = exact(v, ["attemptId", "recovery_id"]); if (typeof r.recovery_id !== "string" || !RECOVERY.test(r.recovery_id)) invalid(); return Object.freeze({ attemptId: safeAttempt(r.attemptId), recovery_id: r.recovery_id }); }
function snapshotList(v: unknown): { attemptId: string; limit: number } { const r = exact(v, ["attemptId"], ["limit"]); return { attemptId: safeAttempt(r.attemptId), limit: bounded(r.limit, 1, 128, 32) }; }
function snapshotPage(v: unknown): { attemptId: string; recovery_id: string; offset: number } { const r = exact(v, ["attemptId", "recovery_id"], ["offset"]); if (typeof r.recovery_id !== "string" || !RECOVERY.test(r.recovery_id)) invalid(); return { attemptId: safeAttempt(r.attemptId), recovery_id: r.recovery_id, offset: bounded(r.offset, 0, MAX_RESULTS, 0) }; }
function semanticKey(p: Readonly<GenerationPrincipalRef>, intent: string): string { return createHash("sha256").update(JSON.stringify([p.tenant_id, p.subject_id, intent])).digest("hex"); }
function pageResult(r: Recovery, offset: number): OwnerTopazAstraGenerationResult { if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_RESULTS) invalid(); const artifacts = r.artifacts.slice(offset, offset + PAGE_SIZE), next = offset + artifacts.length; return Object.freeze({ status: "completed", status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", backend_acceptance: "UNPROVEN", provider_terminal_status: "UNPROVEN", cost_cap_enforced: false, recovery_id: r.recovery_id, model_id: r.binding.model_id, source_binding: Object.freeze({ public_catalog_version: OWNER_TOPAZ_ASTRA_PUBLIC_CATALOG_VERSION, profile_schema_hash: r.binding.profile_schema_hash, request_fingerprint: r.binding.request_fingerprint, intent_fingerprint: r.binding.intent_fingerprint }), observed_artifact_count: r.artifacts.length, offset, page_size: PAGE_SIZE, artifacts: Object.freeze(artifacts), has_more: next < r.artifacts.length, next_offset: next < r.artifacts.length ? next : null, diagnostic: snapshotDiagnostic(r.diagnostic) }); }
function recoveryItem(r: Recovery): OwnerTopazAstraRecoveryListItem { return Object.freeze({ recovery_id: r.recovery_id, created_at: r.created_at, model_id: r.binding.model_id, status: r.status, observed_artifact_count: r.artifacts.length, diagnostic: snapshotDiagnostic(r.diagnostic) }); }
function snapshotDiagnostic(d: MutableDiagnostic): OwnerTopazAstraGenerationDiagnostic { return Object.freeze({ phase: d.phase, post_started: d.post_started, ack_known: d.ack_known, history_status: d.history_status, owner_ack_status: d.owner_ack_status, history_get_calls: d.history_get_calls, result_get_calls: d.result_get_calls, result_status: d.result_status, gaps: Object.freeze(d.gaps.slice(0, 32)) }); }
function unknownError(r: Recovery): OwnerTopazAstraGenerationServiceError { return new OwnerTopazAstraGenerationServiceError("OUTCOME_UNKNOWN", r.recovery_id, snapshotDiagnostic(r.diagnostic)); }
function validContext(c: OwnerTopazAstraResultContext, r: Recovery): boolean { return !!c && c.chat_uuid === r.chat.chat_uuid && c.attempt_id === r.attemptId && c.model_id === r.binding.model_id && c.profile_schema_hash === r.binding.profile_schema_hash && c.intent_fingerprint === r.binding.intent_fingerprint && c.owner_echo_message_id === r.owner_echo_message_id; }
function validVideo(v: OwnerWanT2vReadyVideo, c: OwnerTopazAstraResultContext): boolean { try { const u = new URL(v.object_url); return v.object_type === "video" && c.message_object_ids.includes(v.message_object_id) && v.mime_source === "URL_EXTENSION" && (v.mime_type === "video/mp4" || v.mime_type === "video/quicktime") && u.protocol === "https:" && u.hostname === "r2.syntx.ai" && !u.port && !u.username && !u.password && !u.hash && /\.(mp4|mov)$/iu.test(u.pathname); } catch { return false; } }
function validReceipt(v: unknown, chat: string): v is MediaGenerationReceipt { try { const r = exact(v, ["chat_uuid", "message_id"]); return r.chat_uuid === chat && isSafeId(r.message_id); } catch { return false; } }
function freshIso(v: unknown, now: number): boolean { if (typeof v !== "string") return false; const t = Date.parse(v); return Number.isFinite(t) && t <= now + 30_000 && t >= now - 300_000; }
function finiteNonnegative(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v) && v >= 0; }
function validAccount(v: AccountStatusResult, now: number): boolean { const a = v as unknown as Record<string, unknown>, b = a.balance as Record<string, unknown> | undefined, s = a.subscription as Record<string, unknown> | undefined; if (a.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || a.source_build !== ACCOUNT_SOURCE_BUILD || !b || b.unit !== "tokens" || !(b.available === null || (typeof b.available === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(b.available))) || !s || s.active !== true || !freshIso(a.observed_at, now) || !(s.plan_type === null || typeof s.plan_type === "string") || !(s.end_date === null || typeof s.end_date === "string") || !(s.end_date_kind === null || ["DATE_ONLY", "LOCAL_DATETIME", "OFFSET_DATETIME"].includes(String(s.end_date_kind)))) return false; if (s.end_date === null) return true; const end = Date.parse(`${s.end_date_kind === "DATE_ONLY" ? `${s.end_date}T23:59:59.999Z` : s.end_date}`); return Number.isFinite(end) && end >= now; }
function sameStrings(a: unknown, values: string[]): boolean { return Array.isArray(a) && a.length === values.length && [...a].sort().join(",") === [...values].sort().join(","); }
function snapshotBinding(v: unknown): Readonly<AuthBinding> { const r = exact(v, ["tenant_id", "subject"]); if (typeof r.tenant_id !== "string" || !r.tenant_id.trim() || typeof r.subject !== "string" || !r.subject.trim()) invalid(); return Object.freeze({ tenant_id: r.tenant_id, subject: r.subject }); }
function genuineMethods<T>(v: unknown, ctor: new (...args: never[]) => T, methods: readonly string[]): v is T { try { return !!v && typeof v === "object" && !types.isProxy(v) && Object.getPrototypeOf(v) === ctor.prototype && methods.every((m) => !Object.hasOwn(v, m) && Reflect.get(v, m) === Reflect.get(ctor.prototype, m)); } catch { return false; } }
function exact(v: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, any> { if (!v || typeof v !== "object" || Array.isArray(v) || types.isProxy(v)) invalid(); const p = Object.getPrototypeOf(v); if (p !== Object.prototype && p !== null) invalid(); const d = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(d); if (required.some((k) => !Object.hasOwn(d, k)) || keys.some((k) => typeof k !== "string" || (!required.includes(k) && !optional.includes(k)) || !("value" in d[k]!) || d[k]!.enumerable !== true)) invalid(); const out: Record<string, any> = Object.create(null); for (const k of keys as string[]) out[k] = d[k]!.value; return out; }
function readClock(v: unknown): () => number { if (v === undefined) return Date.now; if (typeof v !== "function" || types.isProxy(v)) invalid(); return v as () => number; }
function bounded(v: unknown, min: number, max: number, fallback: number): number { if (v === undefined) return fallback; if (!Number.isSafeInteger(v) || (v as number) < min || (v as number) > max) invalid(); return v as number; }
function safeAttempt(v: unknown): string { if (typeof v !== "string" || !ATTEMPT.test(v)) invalid(); return v; }
function isSafeId(v: unknown): v is string { return typeof v === "string" && SAFE_ID.test(v); }
function invalid(): never { return fail("INVALID_REQUEST"); }
function fail(code: OwnerTopazAstraGenerationServiceErrorCode): never { throw serviceError(code); }
function serviceError(code: OwnerTopazAstraGenerationServiceErrorCode): OwnerTopazAstraGenerationServiceError { return new OwnerTopazAstraGenerationServiceError(code); }
