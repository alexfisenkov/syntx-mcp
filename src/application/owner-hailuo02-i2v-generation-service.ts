import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { SyntxChatHttpClient, type MediaGenerationReceipt } from "../adapter/syntx/chat-http-client.js";
import type { OwnerHailuo02I2vChatContext, OwnerHailuo02I2vResult, OwnerHailuo02I2vResultCandidates,
  OwnerHailuo02I2vResultContext } from "../adapter/syntx/owner-hailuo02-i2v-native-context.js";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { AccountStatusService, type AccountStatusResult } from "./account-status.js";
import { ModelAccessService, type ModelAccessResult } from "./model-access.js";
import { OwnerHailuo02I2vImageReferenceService } from "./owner-hailuo02-i2v-image-reference-service.js";
import { OwnerHailuo02I2vRequestPreparer, isOwnerHailuo02I2vRequestPreparer,
  type OwnerHailuo02I2vCandidateBinding, type OwnerHailuo02I2vPreparedCandidate } from "./owner-hailuo02-i2v-request-preparer.js";
import { createOwnerHailuo02I2vOneShotPermit, revalidateOwnerHailuo02I2vOneShotPermit,
  type OwnerHailuo02I2vOneShotPermit } from "./owner-hailuo02-i2v-one-shot-policy.js";
import { OWNER_HAILUO02_I2V_SOURCE_PROFILE } from "./owner-hailuo02-i2v-source-profile.js";

export const OWNER_HAILUO02_I2V_GENERATION_CATALOG_VERSION = OWNER_HAILUO02_I2V_SOURCE_PROFILE.source_pins.public_catalog_version;
const CATALOG_VERSION = OWNER_HAILUO02_I2V_GENERATION_CATALOG_VERSION;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u, RECOVERY = /^hailuo02_i2v_recovery_[0-9a-f-]{36}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const MAX_RECOVERIES = 128, MAX_RUNS = 4, PAGE_SIZE = 64, MAX_RESULTS = 4096, DEFAULT_TIMEOUT_MS = 120_000;
const ACCOUNT = AccountStatusService.prototype.getAccountStatus, ACCESS = ModelAccessService.prototype.getModelAccess;
const CREATE = SyntxChatHttpClient.prototype.createOwnerHailuo02I2vChat;
const START = SyntxChatHttpClient.prototype.startOwnerHailuo02I2vWithOwnedCandidate;
const LIST = SyntxChatHttpClient.prototype.listOwnedHailuo02I2vCandidates;
const GET = SyntxChatHttpClient.prototype.getOwnedHailuo02I2vResult;
const SERVICES = new WeakSet<object>();

export type OwnerHailuo02I2vGenerationPhase = "VALIDATE_REQUEST" | "RESOLVE_PRINCIPAL" | "PREPARE_CANDIDATE" |
  "PREFLIGHT_ONE" | "CHAT_CREATE" | "PREFLIGHT_TWO" | "GENERATION_POST" | "POST_ACK_KNOWN" | "HISTORY_GET" | "RESULT_GET" | "RESULT_BINDING";
export interface OwnerHailuo02I2vGenerationDiagnostic {
  readonly phase: OwnerHailuo02I2vGenerationPhase; readonly post_started: boolean; readonly ack_known: boolean;
  readonly history_status: "NOT_READ" | "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "NOT_READ" | "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  readonly history_get_calls: number; readonly result_get_calls: number;
  readonly result_status: "NOT_READ" | "PENDING" | "COMPLETE" | "UNVERIFIED"; readonly gaps: readonly string[];
}
export interface OwnerHailuo02I2vVideoArtifact {
  readonly object_index: number; readonly message_object_id: string; readonly object_type: "video";
  readonly object_url: string; readonly mime_type: "video/mp4" | "video/quicktime";
  readonly mime_source: "URL_EXTENSION_LOCAL_POLICY"; readonly message_id: string; readonly chat_uuid: string; readonly model_id: "hailuo-02";
}
export interface OwnerHailuo02I2vGenerationResult {
  readonly status: "completed"; readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly backend_acceptance: "UNPROVEN"; readonly provider_terminal_status: "UNPROVEN"; readonly cost_cap_enforced: false;
  readonly recovery_id: string; readonly model_id: "hailuo-02";
  readonly source_binding: Readonly<{ public_catalog_version: typeof CATALOG_VERSION; profile_schema_hash: string;
    request_fingerprint: string; intent_fingerprint: string }>;
  readonly observed_artifact_count: number; readonly offset: number; readonly page_size: typeof PAGE_SIZE;
  readonly artifacts: readonly OwnerHailuo02I2vVideoArtifact[]; readonly has_more: boolean; readonly next_offset: number | null;
  readonly diagnostic: OwnerHailuo02I2vGenerationDiagnostic;
}
export interface OwnerHailuo02I2vRecoveryListItem {
  readonly recovery_id: string; readonly created_at: string; readonly model_id: "hailuo-02";
  readonly status: "outcome_unknown" | "completed"; readonly observed_artifact_count: number;
  readonly diagnostic: OwnerHailuo02I2vGenerationDiagnostic;
}
export interface OwnerHailuo02I2vGenerationServiceOptions {
  readonly binding: AuthBinding; readonly linkService: PerUserLinkService; readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string; readonly preparer: OwnerHailuo02I2vRequestPreparer;
  readonly imageReferenceService: OwnerHailuo02I2vImageReferenceService;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly createAccountStatusService: (attemptId: string) => AccountStatusService;
  readonly createModelAccessService: (attemptId: string) => ModelAccessService;
  readonly now?: () => number; readonly timeoutMs?: number;
}
export interface OwnerHailuo02I2vGenerateInput { readonly attemptId: string; readonly request: Readonly<{
  model_id: "hailuo-02"; prompt: string; resolution: string; video_duration: number; image_handle: string;
}> }
export interface OwnerHailuo02I2vReconcileInput { readonly attemptId: string; readonly recovery_id: string; }
export interface OwnerHailuo02I2vRecoveryListInput { readonly attemptId: string; readonly limit?: number; }
export interface OwnerHailuo02I2vResultPageInput { readonly attemptId: string; readonly recovery_id: string; readonly offset?: number; }
export type OwnerHailuo02I2vGenerationServiceErrorCode = "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" |
  "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH" | "PREFLIGHT_FAILED" | "INTENT_ALREADY_CLAIMED" |
  "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND";
export class OwnerHailuo02I2vGenerationServiceError extends Error {
  readonly diagnostic?: OwnerHailuo02I2vGenerationDiagnostic;
  constructor(readonly code: OwnerHailuo02I2vGenerationServiceErrorCode, readonly recovery_id?: string,
    diagnostic?: OwnerHailuo02I2vGenerationDiagnostic) {
    super(code === "OUTCOME_UNKNOWN" ? "The Hailuo-02 I2V request may have been dispatched; reconcile its recovery and do not retry."
      : "The owner Hailuo-02 I2V request could not be completed safely.");
    this.name = "OwnerHailuo02I2vGenerationServiceError";
    if (code === "OUTCOME_UNKNOWN" && diagnostic) this.diagnostic = diagnostic;
  }
}

interface MutableDiagnostic { phase: OwnerHailuo02I2vGenerationPhase; post_started: boolean; ack_known: boolean;
  history_status: OwnerHailuo02I2vGenerationDiagnostic["history_status"]; owner_ack_status: OwnerHailuo02I2vGenerationDiagnostic["owner_ack_status"];
  history_get_calls: number; result_get_calls: number; result_status: OwnerHailuo02I2vGenerationDiagnostic["result_status"]; gaps: string[]; }
interface Recovery { readonly recovery_id: string; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly created_at: string; readonly semantic_key: string; readonly candidate: OwnerHailuo02I2vPreparedCandidate;
  readonly permit: OwnerHailuo02I2vOneShotPermit; readonly chat: OwnerHailuo02I2vChatContext;
  readonly client: SyntxChatHttpClient; readonly binding: Readonly<OwnerHailuo02I2vCandidateBinding>;
  owner_echo_message_id: string | null; status: "outcome_unknown" | "completed";
  artifacts: readonly OwnerHailuo02I2vVideoArtifact[]; readonly diagnostic: MutableDiagnostic; }
interface ActiveRun { readonly attemptId: string; readonly controller: AbortController; promise: Promise<unknown>; }

/** Owner-only Hailuo-02 I2V one-shot service; it owns its preparer and borrows the image lifecycle. */
export class OwnerHailuo02I2vGenerationService {
  readonly #binding: Readonly<AuthBinding>; readonly #linkService: PerUserLinkService; readonly #catalog: DiscoveryCatalogRepository;
  readonly #catalogVersion: string; readonly #preparer: OwnerHailuo02I2vRequestPreparer;
  readonly #images: OwnerHailuo02I2vImageReferenceService;
  readonly #resolveChatClient: OwnerHailuo02I2vGenerationServiceOptions["resolveChatClient"];
  readonly #createAccount: OwnerHailuo02I2vGenerationServiceOptions["createAccountStatusService"];
  readonly #createAccess: OwnerHailuo02I2vGenerationServiceOptions["createModelAccessService"];
  readonly #now: () => number; readonly #timeoutMs: number; readonly #recoveries = new Map<string, Recovery>();
  readonly #claims = new Map<string, string>(); readonly #reserved = new Set<string>();
  readonly #usedAccounts = new WeakSet<object>(); readonly #usedAccess = new WeakSet<object>();
  readonly #runs = new Set<ActiveRun>(); readonly #invalidating = new Set<string>(); readonly #clientsByAttempt = new Map<string, SyntxChatHttpClient>();
  #closed = false; #closing: Promise<void> | undefined; #lastNow = -1;

  constructor(optionsInput: OwnerHailuo02I2vGenerationServiceOptions | unknown) {
    const o = exact(optionsInput, ["binding", "linkService", "catalog", "catalog_version", "preparer", "imageReferenceService",
      "resolveChatClient", "createAccountStatusService", "createModelAccessService"], ["now", "timeoutMs"]);
    this.#binding = snapshotBinding(o.binding);
    if (!genuineMethods(o.linkService, PerUserLinkService, ["getStatus"]) || !(o.catalog instanceof DiscoveryCatalogRepository) ||
        o.catalog_version !== CATALOG_VERSION ||
        !isOwnerHailuo02I2vRequestPreparer(o.preparer) || !genuineMethods(o.preparer, OwnerHailuo02I2vRequestPreparer,
          ["prepare", "inspectCandidate", "getPrivateRequest", "revalidateCandidate", "invalidateAttempt", "close"]) ||
        !o.imageReferenceService || types.isProxy(o.imageReferenceService) || !(o.imageReferenceService instanceof OwnerHailuo02I2vImageReferenceService) ||
        Object.getPrototypeOf(o.imageReferenceService) !== OwnerHailuo02I2vImageReferenceService.prototype ||
        typeof o.resolveChatClient !== "function" || types.isProxy(o.resolveChatClient) ||
        typeof o.createAccountStatusService !== "function" || types.isProxy(o.createAccountStatusService) ||
        typeof o.createModelAccessService !== "function" || types.isProxy(o.createModelAccessService)) invalid();
    this.#linkService = o.linkService as PerUserLinkService; this.#catalog = o.catalog; this.#catalogVersion = o.catalog_version as string;
    this.#preparer = o.preparer as OwnerHailuo02I2vRequestPreparer; this.#images = o.imageReferenceService as OwnerHailuo02I2vImageReferenceService;
    this.#resolveChatClient = o.resolveChatClient as OwnerHailuo02I2vGenerationServiceOptions["resolveChatClient"];
    this.#createAccount = o.createAccountStatusService as OwnerHailuo02I2vGenerationServiceOptions["createAccountStatusService"];
    this.#createAccess = o.createModelAccessService as OwnerHailuo02I2vGenerationServiceOptions["createModelAccessService"];
    this.#now = readClock(o.now); this.#timeoutMs = bounded(o.timeoutMs, 1_000, 300_000, DEFAULT_TIMEOUT_MS);
    this.#assertModelBinding(); SERVICES.add(this); Object.freeze(this);
  }

  async generate(input: OwnerHailuo02I2vGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerHailuo02I2vGenerationResult> {
    const request = snapshotGenerate(input); return this.#run(request.attemptId, signal, (s) => this.#generate(request, s));
  }
  async reconcile(input: OwnerHailuo02I2vReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerHailuo02I2vGenerationResult> {
    const request = snapshotRecovery(input); if (this.#invalidating.has(request.attemptId)) fail("RECOVERY_NOT_FOUND");
    return this.#run(request.attemptId, signal, (s) => this.#reconcile(request, s));
  }
  async listRecoveries(input: OwnerHailuo02I2vRecoveryListInput | unknown): Promise<readonly OwnerHailuo02I2vRecoveryListItem[]> {
    const request = snapshotList(input); return this.#run(request.attemptId, undefined, async () => {
      const principal = await this.#principal(request.attemptId);
      return Object.freeze([...this.#recoveries.values()].filter((r) => r.attemptId === request.attemptId && sameGenerationPrincipal(r.principal, principal))
        .slice(0, request.limit).map(recoveryItem));
    });
  }
  async getResultPage(input: OwnerHailuo02I2vResultPageInput | unknown): Promise<OwnerHailuo02I2vGenerationResult> {
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
    for (const run of this.#runs) run.controller.abort(); const attempts = new Set([...this.#runs].map((r) => r.attemptId));
    this.#closing = (async () => { for (const id of attempts) await this.#preparer.invalidateAttempt(id);
      await Promise.allSettled([...this.#runs].map((r) => r.promise)); await this.#preparer.close(); this.#runs.clear(); })();
    return this.#closing;
  }

  async #generate(req: Readonly<OwnerHailuo02I2vGenerateInput>, signal: AbortSignal): Promise<OwnerHailuo02I2vGenerationResult> {
    const deadline = new AbsoluteRequestDeadline(this.#timeoutMs, signal, () => serviceError("PRE_DISPATCH_FAILED"));
    let candidate: OwnerHailuo02I2vPreparedCandidate | undefined, permit: OwnerHailuo02I2vOneShotPermit | undefined;
    let semantic: string | undefined, recovery: Recovery | undefined, postStarted = false;
    try {
      deadline.throwIfAborted(); const principal = await this.#await(deadline, () => this.#principal(req.attemptId));
      candidate = await this.#await(deadline, () => this.#preparer.prepare({ attemptId: req.attemptId, model_id: req.request.model_id,
        prompt: req.request.prompt, resolution: req.request.resolution, video_duration: req.request.video_duration, image_handle: req.request.image_handle }));
      const binding = this.#preparer.inspectCandidate(candidate); if (!binding || candidate.model_id !== "hailuo-02") fail("PRE_DISPATCH_FAILED");
      semantic = semanticKey(principal, binding.intent_fingerprint);
      if (this.#claims.has(semantic) || this.#reserved.has(semantic)) fail("INTENT_ALREADY_CLAIMED");
      if (this.#claims.size + this.#reserved.size >= MAX_RECOVERIES) fail("SERVICE_BUSY"); this.#reserved.add(semantic);
      permit = await createOwnerHailuo02I2vOneShotPermit({ candidate, attemptId: req.attemptId, principal, preparer: this.#preparer });
      await this.#preflight(req.attemptId, binding, deadline);
      const client = this.#nativeClient(req.attemptId); deadline.throwIfAborted();
      this.#claims.set(semantic, "CHAT_PENDING"); this.#reserved.delete(semantic);
      const nativeInput = Object.freeze({ candidate, permit, preparer: this.#preparer, imageReferenceService: this.#images,
        principal, attemptId: req.attemptId, linkService: this.#linkService, binding: this.#binding });
      const chat = await this.#await(deadline, () => Reflect.apply(CREATE, client, [nativeInput, deadline.signal]) as Promise<OwnerHailuo02I2vChatContext>);
      if (!isSafeId(chat.chat_uuid)) fail("PRE_DISPATCH_FAILED");
      await this.#checkPrincipal(req.attemptId, principal); await this.#preflight(req.attemptId, binding, deadline);
      await this.#checkPrincipal(req.attemptId, principal); await this.#preparer.revalidateCandidate(candidate);
      await revalidateOwnerHailuo02I2vOneShotPermit({ candidate, permit, attemptId: req.attemptId, principal, preparer: this.#preparer });
      recovery = this.#newRecovery(req.attemptId, principal, semantic, candidate, permit, chat, client, binding);
      this.#recoveries.set(recovery.recovery_id, recovery); this.#claims.set(semantic, recovery.recovery_id); semantic = undefined;
      recovery.diagnostic.phase = "GENERATION_POST"; recovery.diagnostic.post_started = true; postStarted = true;
      const receipt = await this.#await(deadline, () => Reflect.apply(START, client, [Object.freeze({ ...nativeInput, chat }), deadline.signal]) as Promise<MediaGenerationReceipt>);
      if (!validReceipt(receipt, chat.chat_uuid)) throw unknownError(recovery);
      recovery.owner_echo_message_id = receipt.message_id; recovery.diagnostic.ack_known = true; recovery.diagnostic.owner_ack_status = "MATCHED";
      recovery.diagnostic.phase = "POST_ACK_KNOWN"; return await this.#observe(recovery, deadline);
    } catch (error) {
      if (postStarted && recovery) throw unknownError(recovery);
      if (semantic) this.#reserved.delete(semantic);
      if (error instanceof OwnerHailuo02I2vGenerationServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED"); return fail("PRE_DISPATCH_FAILED");
    } finally { if (semantic) this.#reserved.delete(semantic); deadline.close(); }
  }

  async #reconcile(req: Readonly<OwnerHailuo02I2vReconcileInput>, signal: AbortSignal): Promise<OwnerHailuo02I2vGenerationResult> {
    const recovery = this.#ownedRecovery(req.attemptId, req.recovery_id, await this.#principal(req.attemptId));
    if (recovery.status === "completed") return pageResult(recovery, 0);
    const deadline = new AbsoluteRequestDeadline(this.#timeoutMs, signal, () => unknownError(recovery));
    try { await this.#checkPrincipal(req.attemptId, recovery.principal);
      if (this.#nativeClient(req.attemptId) !== recovery.client) fail("PRINCIPAL_NOT_LINKED");
      return await this.#observe(recovery, deadline);
    } catch (error) { if (error instanceof OwnerHailuo02I2vGenerationServiceError && error.code === "RECOVERY_NOT_FOUND") throw error; throw unknownError(recovery); }
    finally { deadline.close(); }
  }
  async #observe(r: Recovery, deadline: AbsoluteRequestDeadline): Promise<OwnerHailuo02I2vGenerationResult> {
    deadline.throwIfAborted(); await this.#checkPrincipal(r.attemptId, r.principal); r.diagnostic.phase = "HISTORY_GET"; r.diagnostic.history_get_calls++;
    let history: OwnerHailuo02I2vResultCandidates;
    try { history = await this.#await(deadline, () => Reflect.apply(LIST, r.client, [r.chat, deadline.signal]) as Promise<OwnerHailuo02I2vResultCandidates>); }
    catch { deadline.throwIfAborted(); r.diagnostic.history_status = "UNVERIFIED"; throw unknownError(r); }
    r.diagnostic.owner_ack_status = history.owner_ack_status;
    if (history.owner_ack_status !== "MATCHED" || history.history_binding_status !== "BOUND" || history.history_page_status !== "COMPLETE" ||
        history.status !== "COMPLETE" || history.backend_acceptance !== "UNPROVEN" || history.gaps.length) {
      r.diagnostic.history_status = history.status === "PENDING" ? "PENDING" : history.status === "INCOMPLETE" ? "INCOMPLETE" : "UNVERIFIED";
      r.diagnostic.gaps = [...history.gaps].slice(0, 32); r.diagnostic.result_status = "PENDING"; throw unknownError(r);
    }
    r.diagnostic.history_status = "COMPLETE"; const observed: OwnerHailuo02I2vVideoArtifact[] = [];
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
      observed.push(Object.freeze({ ...video, object_index: observed.length, mime_type: video.mime_type!, mime_source: "URL_EXTENSION_LOCAL_POLICY",
        message_id: context.message_id, chat_uuid: context.chat_uuid, model_id: context.model_id }));
      if (observed.length > MAX_RESULTS) { r.diagnostic.gaps = ["RESULT_LIMIT_EXCEEDED"]; throw unknownError(r); }
    }
    if (!observed.length) { r.diagnostic.gaps = ["NO_READY_VIDEO_OBSERVED"]; r.diagnostic.result_status = "PENDING"; throw unknownError(r); }
    r.artifacts = Object.freeze(observed); r.status = "completed"; r.diagnostic.phase = "RESULT_BINDING";
    r.diagnostic.result_status = "COMPLETE"; r.diagnostic.gaps = []; return pageResult(r, 0);
  }
  async #preflight(attemptId: string, b: Readonly<OwnerHailuo02I2vCandidateBinding>, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted(); let account: AccountStatusService, access: ModelAccessService;
    try { account = Reflect.apply(this.#createAccount, undefined, [attemptId]) as AccountStatusService;
      access = Reflect.apply(this.#createAccess, undefined, [attemptId]) as ModelAccessService; } catch { fail("PREFLIGHT_FAILED"); }
    if (!genuineMethods(account, AccountStatusService, ["getAccountStatus"]) || this.#usedAccounts.has(account) ||
        !genuineMethods(access, ModelAccessService, ["getModelAccess"]) || this.#usedAccess.has(access)) fail("PREFLIGHT_FAILED");
    this.#usedAccounts.add(account); this.#usedAccess.add(access); let a: AccountStatusResult, q: ModelAccessResult;
    try { a = await this.#await(deadline, () => Reflect.apply(ACCOUNT, account, [deadline.signal]) as Promise<AccountStatusResult>);
      q = await this.#await(deadline, () => Reflect.apply(ACCESS, access, [Object.freeze({ model_id: "hailuo-02",
        cost_parameters: Object.freeze({ resolution: b.intent.resolution, video_duration: b.intent.video_duration }) }), deadline.signal]) as Promise<ModelAccessResult>); }
    catch { fail("PREFLIGHT_FAILED"); }
    const now = this.#readNow(), model = this.#catalog.getModel("hailuo-02");
    if (!validAccount(a, now) || q.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" ||
        q.catalog_version !== `${this.#catalog.fetched_at}.${this.#catalog.source_hashes.models.slice(7, 19)}` ||
        q.model_id !== "hailuo-02" || q.ai_name !== "hailuo-minimax" || q.model_type !== "hailuo-02" || q.account_read_live !== true ||
        q.access !== true || q.parameters_redacted !== true || !sameStrings(q.parameter_keys, ["resolution", "video_duration"]) ||
        !(q.cost === null || finiteNonnegative(q.cost)) || !(q.discount_cost === null || finiteNonnegative(q.discount_cost)) ||
        !(finiteNonnegative(q.cost) || finiteNonnegative(q.discount_cost)) || !freshIso(q.observed_at, now) || !model.active) fail("PREFLIGHT_FAILED");
  }
  #assertModelBinding(): void {
    try { const m = this.#catalog.getModel("hailuo-02"), keys = m.settings?.get_cost_params ?? [];
      if (this.#catalogVersion !== CATALOG_VERSION || !m.active || m.id !== "hailuo-02" || m.upstream_id !== "hailuo-02" ||
          m.ai_name !== "hailuo-minimax" || !["resolution", "video_duration"].every((key) => keys.includes(key))) fail("MODEL_BINDING_MISMATCH");
    } catch (error) { if (error instanceof OwnerHailuo02I2vGenerationServiceError) throw error; fail("MODEL_BINDING_MISMATCH"); }
  }
  #nativeClient(attemptId: string): SyntxChatHttpClient {
    let v: unknown; try { v = Reflect.apply(this.#resolveChatClient, undefined, [attemptId]); } catch { fail("PRE_DISPATCH_FAILED"); }
    if (!v || typeof v !== "object" || types.isProxy(v) || Object.getPrototypeOf(v) !== SyntxChatHttpClient.prototype) fail("PRE_DISPATCH_FAILED");
    const old = this.#clientsByAttempt.get(attemptId); if (old && old !== v) fail("PRINCIPAL_NOT_LINKED");
    this.#clientsByAttempt.set(attemptId, v as SyntxChatHttpClient); return v as SyntxChatHttpClient;
  }
  async #principal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    try { const p = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
      if (p.connection_id !== attemptId || p.tenant_id !== this.#binding.tenant_id || p.subject_id !== this.#binding.subject) fail("PRINCIPAL_NOT_LINKED"); return p;
    } catch { fail("PRINCIPAL_NOT_LINKED"); }
  }
  async #checkPrincipal(attemptId: string, expected: Readonly<GenerationPrincipalRef>): Promise<void> {
    if (!sameGenerationPrincipal(await this.#principal(attemptId), expected) || this.#invalidating.has(attemptId)) fail("PRINCIPAL_NOT_LINKED");
  }
  #newRecovery(attemptId: string, principal: Readonly<GenerationPrincipalRef>, semantic: string, candidate: OwnerHailuo02I2vPreparedCandidate,
    permit: OwnerHailuo02I2vOneShotPermit, chat: OwnerHailuo02I2vChatContext, client: SyntxChatHttpClient,
    binding: Readonly<OwnerHailuo02I2vCandidateBinding>): Recovery {
    if (this.#recoveries.size >= MAX_RECOVERIES) fail("SERVICE_BUSY"); const now = this.#readNow();
    return { recovery_id: `hailuo02_i2v_recovery_${randomUUID()}`, attemptId, principal, created_at: new Date(now).toISOString(),
      semantic_key: semantic, candidate, permit, chat, client, binding, owner_echo_message_id: null, status: "outcome_unknown", artifacts: Object.freeze([]),
      diagnostic: { phase: "CHAT_CREATE", post_started: false, ack_known: false, history_status: "NOT_READ", owner_ack_status: "NOT_READ",
        history_get_calls: 0, result_get_calls: 0, result_status: "NOT_READ", gaps: [] } };
  }
  #ownedRecovery(attemptId: string, id: string, principal: Readonly<GenerationPrincipalRef>): Recovery {
    const r = this.#recoveries.get(id);
    if (this.#invalidating.has(attemptId) || !r || r.attemptId !== attemptId || !sameGenerationPrincipal(r.principal, principal)) fail("RECOVERY_NOT_FOUND");
    return r;
  }
  #await<T>(deadline: AbsoluteRequestDeadline, operation: () => Promise<T>): Promise<T> { deadline.throwIfAborted(); return deadline.waitFor(operation()); }
  #run<T>(attemptId: string, parent: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.#closed || !SERVICES.has(this)) return Promise.reject(serviceError("SERVICE_CLOSED"));
    if (this.#invalidating.has(attemptId) || this.#runs.size >= MAX_RUNS || (parent && (types.isProxy(parent) || !(parent instanceof AbortSignal))))
      return Promise.reject(serviceError("SERVICE_BUSY"));
    const controller = new AbortController(), abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    const run: ActiveRun = { attemptId, controller, promise: Promise.resolve() }, promise = operation(controller.signal); run.promise = promise; this.#runs.add(run);
    return promise.finally(() => { parent?.removeEventListener("abort", abort); this.#runs.delete(run); });
  }
  #readNow(): number { const n = this.#now(); if (!Number.isSafeInteger(n) || n < this.#lastNow) fail("SERVICE_BUSY"); this.#lastNow = n; return n; }
}

export function isOwnerHailuo02I2vGenerationService(value: unknown): value is OwnerHailuo02I2vGenerationService {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) &&
    Object.getPrototypeOf(value) === OwnerHailuo02I2vGenerationService.prototype; } catch { return false; }
}
function snapshotGenerate(value: unknown): Readonly<OwnerHailuo02I2vGenerateInput> {
  const row = exact(value, ["attemptId", "request"]), r = exact(row.request, ["model_id", "prompt", "resolution", "video_duration", "image_handle"]);
  if (r.model_id !== "hailuo-02" || typeof r.prompt !== "string" || typeof r.resolution !== "string" || typeof r.video_duration !== "number" ||
      typeof r.image_handle !== "string") invalid();
  return Object.freeze({ attemptId: safeAttempt(row.attemptId), request: Object.freeze({ model_id: "hailuo-02", prompt: r.prompt,
    resolution: r.resolution, video_duration: r.video_duration, image_handle: r.image_handle }) });
}
function snapshotRecovery(v: unknown): Readonly<OwnerHailuo02I2vReconcileInput> { const r = exact(v, ["attemptId", "recovery_id"]); if (typeof r.recovery_id !== "string" || !RECOVERY.test(r.recovery_id)) invalid(); return Object.freeze({ attemptId: safeAttempt(r.attemptId), recovery_id: r.recovery_id }); }
function snapshotList(v: unknown): { attemptId: string; limit: number } { const r = exact(v, ["attemptId"], ["limit"]); return { attemptId: safeAttempt(r.attemptId), limit: bounded(r.limit, 1, 128, 32) }; }
function snapshotPage(v: unknown): { attemptId: string; recovery_id: string; offset: number } { const r = exact(v, ["attemptId", "recovery_id"], ["offset"]); if (typeof r.recovery_id !== "string" || !RECOVERY.test(r.recovery_id)) invalid(); return { attemptId: safeAttempt(r.attemptId), recovery_id: r.recovery_id, offset: bounded(r.offset, 0, MAX_RESULTS, 0) }; }
function semanticKey(p: Readonly<GenerationPrincipalRef>, intent: string): string { return createHash("sha256").update(JSON.stringify([p.tenant_id, p.subject_id, intent])).digest("hex"); }
function pageResult(r: Recovery, offset: number): OwnerHailuo02I2vGenerationResult {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_RESULTS) invalid(); const artifacts = r.artifacts.slice(offset, offset + PAGE_SIZE), next = offset + artifacts.length;
  return Object.freeze({ status: "completed", status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", backend_acceptance: "UNPROVEN",
    provider_terminal_status: "UNPROVEN", cost_cap_enforced: false, recovery_id: r.recovery_id, model_id: "hailuo-02",
    source_binding: Object.freeze({ public_catalog_version: CATALOG_VERSION, profile_schema_hash: r.binding.profile_schema_hash,
      request_fingerprint: r.binding.request_fingerprint, intent_fingerprint: r.binding.intent_fingerprint }),
    observed_artifact_count: r.artifacts.length, offset, page_size: PAGE_SIZE, artifacts: Object.freeze(artifacts),
    has_more: next < r.artifacts.length, next_offset: next < r.artifacts.length ? next : null, diagnostic: snapshotDiagnostic(r.diagnostic) });
}
function recoveryItem(r: Recovery): OwnerHailuo02I2vRecoveryListItem { return Object.freeze({ recovery_id: r.recovery_id, created_at: r.created_at,
  model_id: "hailuo-02", status: r.status, observed_artifact_count: r.artifacts.length, diagnostic: snapshotDiagnostic(r.diagnostic) }); }
function snapshotDiagnostic(d: MutableDiagnostic): OwnerHailuo02I2vGenerationDiagnostic { return Object.freeze({ phase: d.phase,
  post_started: d.post_started, ack_known: d.ack_known, history_status: d.history_status, owner_ack_status: d.owner_ack_status,
  history_get_calls: d.history_get_calls, result_get_calls: d.result_get_calls, result_status: d.result_status, gaps: Object.freeze(d.gaps.slice(0, 32)) }); }
function unknownError(r: Recovery): OwnerHailuo02I2vGenerationServiceError { return new OwnerHailuo02I2vGenerationServiceError("OUTCOME_UNKNOWN", r.recovery_id, snapshotDiagnostic(r.diagnostic)); }
function validContext(c: OwnerHailuo02I2vResultContext, r: Recovery): boolean { return !!c && c.chat_uuid === r.chat.chat_uuid && c.attempt_id === r.attemptId &&
  c.model_id === "hailuo-02" && c.profile_schema_hash === r.binding.profile_schema_hash && c.intent_fingerprint === r.binding.intent_fingerprint &&
  c.owner_echo_message_id === r.owner_echo_message_id; }
function validVideo(v: OwnerHailuo02I2vResult["ready_videos"][number], c: OwnerHailuo02I2vResultContext): boolean {
  try { const u = new URL(v.object_url); return v.object_type === "video" && c.message_object_ids.includes(v.message_object_id) &&
    v.object_index >= 0 && Number.isSafeInteger(v.object_index) && v.mime_source === "URL_EXTENSION" &&
    (v.mime_type === "video/mp4" || v.mime_type === "video/quicktime") && u.protocol === "https:" && u.hostname === "r2.syntx.ai" &&
    !u.port && !u.username && !u.password && !u.hash && /\.(mp4|mov)$/iu.test(u.pathname); } catch { return false; }
}
function validReceipt(v: unknown, chat: string): v is MediaGenerationReceipt { try { const r = exact(v, ["chat_uuid", "message_id"]); return r.chat_uuid === chat && isSafeId(r.message_id); } catch { return false; } }
function freshIso(v: unknown, now: number): boolean { if (typeof v !== "string") return false; const t = Date.parse(v); return Number.isFinite(t) && t <= now + 30_000 && t >= now - 300_000; }
function finiteNonnegative(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v) && v >= 0; }
function validAccount(v: AccountStatusResult, now: number): boolean {
  const a = v as unknown as Record<string, unknown>, b = a.balance as Record<string, unknown> | undefined, s = a.subscription as Record<string, unknown> | undefined;
  if (a.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || a.source_build !== ACCOUNT_SOURCE_BUILD || !b || b.unit !== "tokens" ||
      !(b.available === null || (typeof b.available === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(b.available))) || !s || s.active !== true ||
      !freshIso(a.observed_at, now) || !(s.plan_type === null || typeof s.plan_type === "string") || !(s.end_date === null || typeof s.end_date === "string") ||
      !(s.end_date_kind === null || ["DATE_ONLY", "LOCAL_DATETIME", "OFFSET_DATETIME"].includes(String(s.end_date_kind)))) return false;
  if (s.end_date === null) return true; const end = Date.parse(`${s.end_date_kind === "DATE_ONLY" ? `${s.end_date}T23:59:59.999Z` : s.end_date}`);
  return Number.isFinite(end) && end >= now;
}
function sameStrings(a: unknown, values: string[]): boolean { return Array.isArray(a) && a.length === values.length && [...a].sort().join(",") === [...values].sort().join(","); }
function snapshotBinding(v: unknown): Readonly<AuthBinding> { const r = exact(v, ["tenant_id", "subject"]); if (typeof r.tenant_id !== "string" || !r.tenant_id.trim() || typeof r.subject !== "string" || !r.subject.trim()) invalid(); return Object.freeze({ tenant_id: r.tenant_id, subject: r.subject }); }
function genuineMethods<T>(v: unknown, ctor: new (...args: never[]) => T, methods: readonly string[]): v is T { try { return !!v && typeof v === "object" && !types.isProxy(v) && Object.getPrototypeOf(v) === ctor.prototype && methods.every((m) => !Object.hasOwn(v, m) && Reflect.get(v, m) === Reflect.get(ctor.prototype, m)); } catch { return false; } }
function exact(v: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, any> { if (!v || typeof v !== "object" || Array.isArray(v) || types.isProxy(v)) invalid(); const p = Object.getPrototypeOf(v); if (p !== Object.prototype && p !== null) invalid(); const d = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(d); if (required.some((k) => !Object.hasOwn(d, k)) || keys.some((k) => typeof k !== "string" || (!required.includes(k) && !optional.includes(k)) || !("value" in d[k]!) || d[k]!.enumerable !== true)) invalid(); const out: Record<string, any> = Object.create(null); for (const k of keys as string[]) out[k] = d[k]!.value; return out; }
function readClock(v: unknown): () => number { if (v === undefined) return Date.now; if (typeof v !== "function" || types.isProxy(v)) invalid(); return v as () => number; }
function bounded(v: unknown, min: number, max: number, fallback: number): number { if (v === undefined) return fallback; if (!Number.isSafeInteger(v) || (v as number) < min || (v as number) > max) invalid(); return v as number; }
function safeAttempt(v: unknown): string { if (typeof v !== "string" || !ATTEMPT.test(v)) invalid(); return v; }
function isSafeId(v: unknown): v is string { return typeof v === "string" && SAFE_ID.test(v); }
function invalid(): never { return fail("INVALID_REQUEST"); }
function fail(code: OwnerHailuo02I2vGenerationServiceErrorCode): never { throw serviceError(code); }
function serviceError(code: OwnerHailuo02I2vGenerationServiceErrorCode): OwnerHailuo02I2vGenerationServiceError { return new OwnerHailuo02I2vGenerationServiceError(code); }
