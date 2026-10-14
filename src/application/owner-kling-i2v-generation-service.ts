import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import { SyntxChatHttpClient, type MediaGenerationReceipt } from "../adapter/syntx/chat-http-client.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { AccountStatusService, type AccountStatusResult } from "./account-status.js";
import { ModelAccessService, type ModelAccessResult } from "./model-access.js";
import {
  OwnerKlingI2VImageReferenceService,
  type OwnerKlingI2VImageReferenceService as KlingReferenceService,
  type OwnerKlingI2VImageResolution
} from "./owner-kling-i2v-reference-service.js";
import {
  createOwnerKlingI2vGenerationContext,
  inspectOwnerKlingI2vGenerationContext,
  OwnerKlingI2vGenerationContextError
} from "./owner-kling-i2v-generation-context.js";
import {
  normalizeOwnerKlingI2vParameters,
  OWNER_KLING_I2V_SOURCE_PINS,
  type OwnerKlingI2vNormalizedParameters,
  getOwnerKlingI2vParametersSource,
  type OwnerKlingI2vParametersSource
} from "./owner-kling-i2v-parameters.js";
import {
  buildOwnerKlingI2vWireSettingsTemplate
} from "./owner-kling-i2v-wire-source.js";
import { uniqueOwnedChatBotMessageId, verifiedArtifacts } from "./owner-contract-media.js";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const RECOVERY_ID = /^kling_i2v_generation_recovery_[0-9a-f-]{36}$/u;
const MAX_CLAIMS = 128;
const MAX_RECOVERIES = 128;
const MAX_ACTIVE_RUNS = 4;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_DELAY_MS = 250;
const DEFAULT_MAX_GET_PASSES = 3;
const COST_KEYS = Object.freeze(["mode", "native_audio", "version", "video_duration"] as const);
const RESULT_CONTRACT = Object.freeze({
  // Source-reviewed result binding only; this is not a live generation contract.
  modality: "video" as const,
  model_type: "kling_image2video",
  mime_types: Object.freeze(["video/mp4"])
});

type NativeClient = SyntxChatHttpClient & {
  createOwnerKlingI2vVideoChat(signal?: AbortSignal): Promise<{ readonly chat_uuid: string }>;
  startOwnerKlingI2vVideoWithContext(context: unknown, signal?: AbortSignal): Promise<MediaGenerationReceipt>;
  listMessageCandidates(chatUuid: string, ownerEchoMessageId: string, signal?: AbortSignal): Promise<Parameters<typeof uniqueOwnedChatBotMessageId>[0]>;
  getMessage(chatUuid: string, messageId: string, signal?: AbortSignal): Promise<Parameters<typeof verifiedArtifacts>[0]>;
};

export type OwnerKlingI2vGenerationStatus = "pending" | "completed" | "unverified";
export interface OwnerKlingI2vGenerationArtifact {
  readonly url: string;
  readonly mime_type?: string;
}
export interface OwnerKlingI2vGenerationDiagnostic {
  readonly post_started: boolean;
  readonly ack_known: boolean;
  readonly history_get_calls: number;
  readonly result_get_calls: number;
  readonly gaps: readonly ("POST_ACK_UNKNOWN" | "HISTORY_UNVERIFIED" | "RESULT_UNVERIFIED" | "PRINCIPAL_CHANGED" | "POLL_BUDGET_EXHAUSTED")[];
}
export interface OwnerKlingI2vGenerationOutput {
  readonly status: OwnerKlingI2vGenerationStatus;
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly backend_acceptance: "UNPROVEN";
  readonly provider_terminal_status: "UNPROVEN";
  readonly model_id: "kling_image2video";
  readonly recovery_id: string;
  readonly observed_artifact_count: number;
  readonly artifacts: readonly OwnerKlingI2vGenerationArtifact[];
  readonly diagnostic: OwnerKlingI2vGenerationDiagnostic;
}
export interface OwnerKlingI2vGenerationRecoveryListItem {
  readonly recovery_id: string;
  readonly created_at: string;
  readonly status: OwnerKlingI2vGenerationStatus | "outcome_unknown";
  readonly observed_artifact_count: number;
}

export interface OwnerKlingI2vGenerationServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: DiscoveryCatalogRepository;
  readonly referenceService: KlingReferenceService;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly createAccountStatusService: (attemptId: string) => AccountStatusService;
  readonly createModelAccessService: (attemptId: string) => ModelAccessService;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly pollDelayMs?: number;
  readonly maxGetPasses?: number;
}

export interface OwnerKlingI2vGenerateInput {
  readonly attemptId: string;
  readonly image_handle: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly controls: Readonly<Record<string, unknown>>;
}
export interface OwnerKlingI2vReconcileInput { readonly attemptId: string; readonly recovery_id: string; }
export interface OwnerKlingI2vListInput { readonly attemptId: string; readonly limit?: number; }

export type OwnerKlingI2vGenerationServiceErrorCode =
  | "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH"
  | "PREFLIGHT_FAILED" | "INTENT_ALREADY_CLAIMED" | "CHAT_CREATE_UNKNOWN" | "PRE_DISPATCH_FAILED"
  | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND";

export class OwnerKlingI2vGenerationServiceError extends Error {
  constructor(readonly code: OwnerKlingI2vGenerationServiceErrorCode, readonly recovery_id?: string) {
    super(code === "OUTCOME_UNKNOWN"
      ? "The Kling I2V request may have been dispatched; reconcile this recovery and do not retry."
      : "The owner Kling I2V generation could not be completed safely.");
    this.name = "OwnerKlingI2vGenerationServiceError";
  }
}

interface SemanticClaim {
  readonly principalKey: string;
  readonly attemptId: string;
  state: "PREPARING" | "DISPATCH_POSSIBLE";
  recoveryId?: string;
}
interface Recovery {
  readonly recovery_id: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly client: NativeClient;
  readonly chatId: string;
  readonly createdAt: string;
  ownerEchoMessageId: string | null;
  status: OwnerKlingI2vGenerationStatus | "outcome_unknown";
  artifacts: readonly OwnerKlingI2vGenerationArtifact[];
  readonly gaps: Set<OwnerKlingI2vGenerationDiagnostic["gaps"][number]>;
  historyGetCalls: number;
  resultGetCalls: number;
  postStarted: boolean;
}
interface ActiveRun { readonly attemptId: string; readonly controller: AbortController; readonly task: Promise<unknown>; }

/** Owner-bound one-shot Kling I2V orchestration with bounded same-client GET recovery. */
export class OwnerKlingI2vGenerationService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #referenceService: KlingReferenceService;
  readonly #resolveChatClient: OwnerKlingI2vGenerationServiceOptions["resolveChatClient"];
  readonly #createAccountStatusService: OwnerKlingI2vGenerationServiceOptions["createAccountStatusService"];
  readonly #createModelAccessService: OwnerKlingI2vGenerationServiceOptions["createModelAccessService"];
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #pollDelayMs: number;
  readonly #maxGetPasses: number;
  readonly #claims = new Map<string, SemanticClaim>();
  readonly #recoveries = new Map<string, Recovery>();
  readonly #usedAccountServices = new WeakSet<object>();
  readonly #usedAccessServices = new WeakSet<object>();
  readonly #runs = new Set<ActiveRun>();
  readonly #invalidating = new Set<string>();
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(optionsInput: OwnerKlingI2vGenerationServiceOptions | unknown) {
    const options = exactRecord(optionsInput, ["binding", "linkService", "catalog", "referenceService", "resolveChatClient",
      "createAccountStatusService", "createModelAccessService"], ["now", "timeoutMs", "pollDelayMs", "maxGetPasses"]);
    if (!isExactService(options.linkService, PerUserLinkService, ["getStatus"]) ||
        !isExactService(options.catalog, DiscoveryCatalogRepository, ["getModel"]) ||
        !isReferenceService(options.referenceService) || typeof options.resolveChatClient !== "function" || types.isProxy(options.resolveChatClient) ||
        typeof options.createAccountStatusService !== "function" || types.isProxy(options.createAccountStatusService) ||
        typeof options.createModelAccessService !== "function" || types.isProxy(options.createModelAccessService)) invalid();
    this.#binding = snapshotBinding(options.binding);
    this.#linkService = options.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#catalog = options.catalog as DiscoveryCatalogRepository;
    this.#referenceService = options.referenceService as KlingReferenceService;
    this.#resolveChatClient = options.resolveChatClient as OwnerKlingI2vGenerationServiceOptions["resolveChatClient"];
    this.#createAccountStatusService = options.createAccountStatusService as OwnerKlingI2vGenerationServiceOptions["createAccountStatusService"];
    this.#createModelAccessService = options.createModelAccessService as OwnerKlingI2vGenerationServiceOptions["createModelAccessService"];
    this.#now = readClock(options.now);
    this.#timeoutMs = bounded(options.timeoutMs, 1_000, 5 * 60_000, DEFAULT_TIMEOUT_MS);
    this.#pollDelayMs = bounded(options.pollDelayMs, 0, 5_000, DEFAULT_POLL_DELAY_MS);
    this.#maxGetPasses = bounded(options.maxGetPasses, 1, 3, DEFAULT_MAX_GET_PASSES);
    this.#assertCatalogBinding();
    Object.freeze(this);
  }

  generate(input: OwnerKlingI2vGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerKlingI2vGenerationOutput> {
    this.#assertOpen();
    const request = snapshotGenerate(input);
    if (this.#invalidating.has(request.attemptId)) fail("PRINCIPAL_NOT_LINKED");
    if (this.#runs.size >= MAX_ACTIVE_RUNS) fail("SERVICE_BUSY");
    const controller = new AbortController();
    const effectiveSignal = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal]);
    const task = this.#generate(request, effectiveSignal).finally(() => this.#runs.delete(run));
    const run: ActiveRun = { attemptId: request.attemptId, controller, task };
    this.#runs.add(run);
    return task;
  }

  reconcile(input: OwnerKlingI2vReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerKlingI2vGenerationOutput> {
    this.#assertOpen();
    const request = snapshotRecovery(input);
    if (this.#invalidating.has(request.attemptId)) fail("RECOVERY_NOT_FOUND");
    return this.#run(request.attemptId, signal, async (deadline) => {
      const recovery = this.#getRecovery(request);
      const output = await this.#observe(recovery, deadline);
      if (output.status !== "completed") fail("OUTCOME_UNKNOWN", recovery.recovery_id);
      return output;
    });
  }

  list(input: OwnerKlingI2vListInput | unknown, signal?: AbortSignal): Promise<readonly OwnerKlingI2vGenerationRecoveryListItem[]> {
    this.#assertOpen();
    const request = exactRecord(input, ["attemptId"], ["limit"]);
    const attemptId = readAttempt(request.attemptId);
    const limit = request.limit === undefined ? 20 : bounded(request.limit, 1, 20, 20);
    return this.#run(attemptId, signal, async (deadline) => {
      const records = [...this.#recoveries.values()].filter((item) => item.attemptId === attemptId);
      if (records.length === 0) return Object.freeze([]);
      const principal = await this.#resolvePrincipal(attemptId, deadline.signal);
      const visible = records.filter((item) => {
        if (sameGenerationPrincipal(item.principal, principal)) return true;
        this.#removeRecovery(item);
        return false;
      });
      return Object.freeze(visible.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map((item) => Object.freeze({
        recovery_id: item.recovery_id, created_at: item.createdAt,
        status: item.status === "outcome_unknown" ? "outcome_unknown" as const : item.status,
        observed_artifact_count: item.artifacts.length
      })));
    });
  }

  async invalidateAttempt(attemptIdInput: unknown): Promise<void> {
    if (!ATTEMPT.test(String(attemptIdInput))) return;
    const attemptId = String(attemptIdInput);
    this.#invalidating.add(attemptId);
    for (const run of this.#runs) if (run.attemptId === attemptId) run.controller.abort();
    await Promise.allSettled([...this.#runs].filter((run) => run.attemptId === attemptId).map((run) => run.task));
    for (const [id, recovery] of this.#recoveries) if (recovery.attemptId === attemptId) this.#recoveries.delete(id);
    for (const [key, claim] of this.#claims) if (claim.attemptId === attemptId && claim.state === "PREPARING") this.#claims.delete(key);
    this.#invalidating.delete(attemptId);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const run of this.#runs) run.controller.abort();
    this.#closing = (async () => {
      await Promise.allSettled([...this.#runs].map((run) => run.task));
      this.#recoveries.clear();
      this.#claims.clear();
      this.#runs.clear();
    })();
    return this.#closing;
  }

  getParametersSource(): OwnerKlingI2vParametersSource { return getOwnerKlingI2vParametersSource(); }

  async #generate(request: Readonly<OwnerKlingI2vGenerateInput>, signal: AbortSignal): Promise<OwnerKlingI2vGenerationOutput> {
    const deadline = new AbsoluteRequestDeadline(this.#timeoutMs, signal,
      () => new OwnerKlingI2vGenerationServiceError("PRE_DISPATCH_FAILED"));
    let semanticKey: string | undefined;
    let claim: SemanticClaim | undefined;
    let recovery: Recovery | undefined;
    try {
      deadline.throwIfAborted();
      const parameters = normalizeOwnerKlingI2vParameters(request.parameters);
      const wire = buildOwnerKlingI2vWireSettingsTemplate({ parameters: request.parameters,
        controls: request.controls });
      const reference = Object.freeze({ attempt_id: request.attemptId, image_handle: request.image_handle });
      const resolution = await this.#await(deadline, () => this.#referenceService.resolve(reference, deadline.signal));
      const principal = await this.#resolvePrincipal(request.attemptId, deadline.signal);
      if (!sameGenerationPrincipal(principal, resolution.principal) || !this.#referenceService.isOwnedResolution(resolution, reference)) fail("PRINCIPAL_NOT_LINKED");
      semanticKey = semanticIntentKey(principal, resolution, wire.prompt, wire.settings_template);
      const existing = this.#claims.get(semanticKey);
      if (existing) {
        if (existing.principalKey !== stablePrincipalKey(principal)) fail("INTENT_ALREADY_CLAIMED");
        if (existing.attemptId !== request.attemptId) fail("INTENT_ALREADY_CLAIMED");
        const existingRecovery = existing.recoveryId ? this.#recoveries.get(existing.recoveryId) : undefined;
        if (existingRecovery?.status === "completed") return snapshotOutput(existingRecovery);
        if (existingRecovery?.status === "pending" || existingRecovery?.status === "unverified") return snapshotOutput(existingRecovery);
        if (existingRecovery) fail("OUTCOME_UNKNOWN", existingRecovery.recovery_id);
        fail("INTENT_ALREADY_CLAIMED");
      }
      if (this.#claims.size >= MAX_CLAIMS) fail("SERVICE_BUSY");
      claim = { principalKey: stablePrincipalKey(principal), attemptId: request.attemptId, state: "PREPARING" };
      this.#claims.set(semanticKey, claim);
      await this.#preflight(request.attemptId, parameters, deadline);
      const context = await this.#await(deadline, () => createOwnerKlingI2vGenerationContext({
        referenceService: this.#referenceService, resolution, reference, parameters: request.parameters, controls: request.controls,
        signal: deadline.signal
      }));
      const client = this.#resolveNativeClient(request.attemptId);
      const inspection = inspectOwnerKlingI2vGenerationContext(client, context);
      if (!inspection || inspection.model_id !== "kling_image2video" || inspection.attempt_id !== request.attemptId ||
          inspection.image_handle !== request.image_handle || inspection.reference_sha256 !== resolution.sha256 ||
          inspection.reference_epoch !== resolution.epoch || inspection.dispatch_state !== "READY" ||
          inspection.reference_expires_at <= this.#readNow()) fail("PRE_DISPATCH_FAILED");
      const beforeDispatch = await this.#resolvePrincipal(request.attemptId, deadline.signal);
      if (!sameGenerationPrincipal(beforeDispatch, principal) || this.#invalidating.has(request.attemptId)) fail("PRINCIPAL_NOT_LINKED");
      await this.#preflight(request.attemptId, parameters, deadline);
      const finalPrincipal = await this.#resolvePrincipal(request.attemptId, deadline.signal);
      if (!sameGenerationPrincipal(finalPrincipal, principal) || this.#invalidating.has(request.attemptId)) fail("PRINCIPAL_NOT_LINKED");
      recovery = createRecovery(request.attemptId, principal, client, inspection.chat_id, this.#readNow());
      if (this.#recoveries.size >= MAX_RECOVERIES) fail("SERVICE_BUSY");
      this.#recoveries.set(recovery.recovery_id, recovery);
      claim.state = "DISPATCH_POSSIBLE";
      claim.recoveryId = recovery.recovery_id;
      recovery.postStarted = true;
      let receipt: MediaGenerationReceipt;
      try {
        receipt = await this.#await(deadline, () => Reflect.apply(SyntxChatHttpClient.prototype.startOwnerKlingI2vVideoWithContext,
          client, [context, deadline.signal]) as Promise<MediaGenerationReceipt>);
      } catch {
        recovery.status = "outcome_unknown";
        recovery.gaps.add("POST_ACK_UNKNOWN");
        fail("OUTCOME_UNKNOWN", recovery.recovery_id);
      }
      if (!validReceipt(receipt, recovery.chatId)) {
        recovery.status = "outcome_unknown";
        recovery.gaps.add("POST_ACK_UNKNOWN");
        fail("OUTCOME_UNKNOWN", recovery.recovery_id);
      }
      recovery.ownerEchoMessageId = receipt.message_id;
      const output = await this.#observe(recovery, deadline);
      if (output.status !== "completed") fail("OUTCOME_UNKNOWN", recovery.recovery_id);
      return output;
    } catch (error) {
      if (error instanceof OwnerKlingI2vGenerationServiceError) {
        if (error.code === "RECOVERY_NOT_FOUND") throw error;
        if (recovery?.postStarted) {
          recovery.status = recovery.status === "completed" ? "completed" : "unverified";
          if (!recovery.ownerEchoMessageId) {
            recovery.status = "outcome_unknown";
            recovery.gaps.add("POST_ACK_UNKNOWN");
          }
          if (error.code === "OUTCOME_UNKNOWN") throw error;
          fail("OUTCOME_UNKNOWN", recovery.recovery_id);
        }
        if (!recovery && semanticKey && claim?.state === "PREPARING") this.#claims.delete(semanticKey);
        throw error;
      }
      if (recovery?.postStarted) {
        if (!recovery.ownerEchoMessageId) {
          recovery.status = "outcome_unknown";
          recovery.gaps.add("POST_ACK_UNKNOWN");
          fail("OUTCOME_UNKNOWN", recovery.recovery_id);
        }
        recovery.status = recovery.status === "completed" ? "completed" : "unverified";
        if (error instanceof OwnerReferencePrincipalError) recovery.gaps.add("PRINCIPAL_CHANGED");
        return snapshotOutput(recovery);
      }
      if (error instanceof OwnerKlingI2vGenerationContextError) {
        if (claim) claim.state = "DISPATCH_POSSIBLE";
        fail("CHAT_CREATE_UNKNOWN");
      }
      if (semanticKey && claim?.state === "PREPARING") this.#claims.delete(semanticKey);
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      fail("PRE_DISPATCH_FAILED");
    } finally { deadline.close(); }
  }

  async #observe(recovery: Recovery, deadline: AbsoluteRequestDeadline): Promise<OwnerKlingI2vGenerationOutput> {
    await this.#await(deadline, () => this.#assertCurrentPrincipal(recovery, deadline.signal));
    if (!recovery.ownerEchoMessageId) {
      recovery.status = "outcome_unknown";
      recovery.gaps.add("POST_ACK_UNKNOWN");
      fail("OUTCOME_UNKNOWN", recovery.recovery_id);
    }
    if (recovery.status === "completed") return snapshotOutput(recovery);
    if (recovery.status === "outcome_unknown") fail("OUTCOME_UNKNOWN", recovery.recovery_id);
    for (let pass = 0; pass < this.#maxGetPasses; pass += 1) {
      deadline.throwIfAborted();
      if (pass > 0) await this.#await(deadline, () => delay(this.#pollDelayMs, deadline.signal));
      let history;
      try {
        history = await this.#getWithPrincipal(recovery, deadline,
          () => Reflect.apply(SyntxChatHttpClient.prototype.listMessageCandidates, recovery.client,
            [recovery.chatId, recovery.ownerEchoMessageId, deadline.signal]) as ReturnType<NativeClient["listMessageCandidates"]>);
        recovery.historyGetCalls = saturatingIncrement(recovery.historyGetCalls);
      } catch (error) {
        if (error instanceof OwnerKlingI2vGenerationServiceError && error.code === "RECOVERY_NOT_FOUND") throw error;
        recovery.status = "unverified"; recovery.gaps.add("HISTORY_UNVERIFIED"); return snapshotOutput(recovery);
      }
      let messageId: string | null;
      try { messageId = uniqueOwnedChatBotMessageId(history, recovery.chatId, recovery.ownerEchoMessageId, RESULT_CONTRACT); }
      catch { recovery.status = "unverified"; recovery.gaps.add("HISTORY_UNVERIFIED"); return snapshotOutput(recovery); }
      if (messageId === null) { recovery.status = "pending"; continue; }
      let message;
      try {
        message = await this.#getWithPrincipal(recovery, deadline,
          () => Reflect.apply(SyntxChatHttpClient.prototype.getMessage, recovery.client,
            [recovery.chatId, messageId!, deadline.signal]) as ReturnType<NativeClient["getMessage"]>);
        recovery.resultGetCalls = saturatingIncrement(recovery.resultGetCalls);
      } catch (error) {
        if (error instanceof OwnerKlingI2vGenerationServiceError && error.code === "RECOVERY_NOT_FOUND") throw error;
        recovery.status = "unverified"; recovery.gaps.add("RESULT_UNVERIFIED"); return snapshotOutput(recovery);
      }
      const artifacts = verifiedArtifacts(message, RESULT_CONTRACT, recovery.chatId, messageId);
      if (artifacts.length > 0) {
        recovery.artifacts = Object.freeze(artifacts.map((item) => Object.freeze({ url: item.url,
          ...(item.mime_type === undefined ? {} : { mime_type: item.mime_type }) })));
        recovery.status = "completed";
        return snapshotOutput(recovery);
      }
      recovery.status = "pending";
    }
    if (recovery.status === "pending") recovery.gaps.add("POLL_BUDGET_EXHAUSTED");
    return snapshotOutput(recovery);
  }

  async #getWithPrincipal<T>(recovery: Recovery, deadline: AbsoluteRequestDeadline, get: () => Promise<T>): Promise<T> {
    await this.#assertCurrentPrincipal(recovery, deadline.signal);
    let result: T;
    try { result = await this.#await(deadline, get); }
    catch (error) {
      await this.#assertCurrentPrincipal(recovery, deadline.signal);
      throw error;
    }
    await this.#assertCurrentPrincipal(recovery, deadline.signal);
    return result;
  }

  async #assertCurrentPrincipal(recovery: Recovery, signal: AbortSignal): Promise<void> {
    if (this.#invalidating.has(recovery.attemptId)) { this.#removeRecovery(recovery); fail("RECOVERY_NOT_FOUND"); }
    if (signal.aborted) fail("OUTCOME_UNKNOWN", recovery.recovery_id);
    const current = await this.#resolvePrincipal(recovery.attemptId, signal).catch(() => {
      this.#removeRecovery(recovery); fail("RECOVERY_NOT_FOUND");
    });
    if (!sameGenerationPrincipal(current, recovery.principal)) { this.#removeRecovery(recovery); fail("RECOVERY_NOT_FOUND"); }
  }

  async #preflight(attemptId: string, parameters: OwnerKlingI2vNormalizedParameters, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted();
    let accountService: AccountStatusService; let accessService: ModelAccessService;
    try {
      accountService = Reflect.apply(this.#createAccountStatusService, undefined, [attemptId]) as AccountStatusService;
      accessService = Reflect.apply(this.#createModelAccessService, undefined, [attemptId]) as ModelAccessService;
    } catch { fail("PREFLIGHT_FAILED"); }
    if (!isExactService(accountService!, AccountStatusService, ["getAccountStatus"]) || this.#usedAccountServices.has(accountService!) ||
        !isExactService(accessService!, ModelAccessService, ["getModelAccess"]) || this.#usedAccessServices.has(accessService!)) fail("PREFLIGHT_FAILED");
    this.#usedAccountServices.add(accountService!); this.#usedAccessServices.add(accessService!);
    let account: AccountStatusResult; let access: ModelAccessResult;
    try {
      account = await this.#await(deadline, () => Reflect.apply(AccountStatusService.prototype.getAccountStatus, accountService!, [deadline.signal]) as Promise<AccountStatusResult>);
      access = await this.#await(deadline, () => Reflect.apply(ModelAccessService.prototype.getModelAccess, accessService!, [{
        model_id: "kling_image2video", cost_parameters: Object.freeze({ ...parameters.cost_query_candidate.values })
      }, deadline.signal]) as Promise<ModelAccessResult>);
    } catch { fail("PREFLIGHT_FAILED"); }
    assertPreflight(account!, access!, parameters, this.#catalog, this.#readNow());
  }

  async #resolvePrincipal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    signal?.throwIfAborted();
    try {
      const principal = snapshotGenerationPrincipal(await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService }));
      if (principal.connection_id !== attemptId || principal.tenant_id !== this.#binding.tenant_id || principal.subject_id !== this.#binding.subject) fail("PRINCIPAL_NOT_LINKED");
      signal?.throwIfAborted();
      return principal;
    } catch (error) {
      if (error instanceof OwnerKlingI2vGenerationServiceError) throw error;
      throw new OwnerKlingI2vGenerationServiceError("PRINCIPAL_NOT_LINKED");
    }
  }

  #resolveNativeClient(attemptId: string): NativeClient {
    let client: unknown;
    try { client = Reflect.apply(this.#resolveChatClient, undefined, [attemptId]); } catch { fail("PRE_DISPATCH_FAILED"); }
    if (!isNativeClient(client)) fail("PRE_DISPATCH_FAILED");
    return client;
  }

  #assertCatalogBinding(): void {
    let model;
    try { model = this.#catalog.getModel("kling_image2video"); } catch { fail("MODEL_BINDING_MISMATCH"); }
    const keys = model.settings?.get_cost_params;
    if (!model.active || model.id !== "kling_image2video" || model.upstream_id !== "kling_image2video" || model.ai_name !== "kling" ||
        !Array.isArray(keys) || keys.length !== COST_KEYS.length || COST_KEYS.some((key) => !keys.includes(key))) fail("MODEL_BINDING_MISMATCH");
    const sourceHash = this.#catalog.source_hashes.models;
    if (sourceHash !== OWNER_KLING_I2V_SOURCE_PINS.public_models_sha256) fail("MODEL_BINDING_MISMATCH");
  }

  #getRecovery(request: Readonly<OwnerKlingI2vReconcileInput>): Recovery {
    const recovery = this.#recoveries.get(request.recovery_id);
    if (!recovery || recovery.attemptId !== request.attemptId) fail("RECOVERY_NOT_FOUND");
    return recovery;
  }
  #removeRecovery(recovery: Recovery): void { this.#recoveries.delete(recovery.recovery_id); }
  #readNow(): number { const value = this.#now(); if (!Number.isSafeInteger(value) || value < 0) fail("SERVICE_BUSY"); return value; }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  async #await<T>(deadline: AbsoluteRequestDeadline, operation: () => Promise<T>): Promise<T> { return deadline.waitFor(operation()); }
  #run<T>(attemptId: string, signal: AbortSignal | undefined, operation: (deadline: AbsoluteRequestDeadline) => Promise<T>): Promise<T> {
    this.#assertOpen();
    if (this.#runs.size >= MAX_ACTIVE_RUNS) fail("SERVICE_BUSY");
    const controller = new AbortController();
    const effective = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const deadline = new AbsoluteRequestDeadline(this.#timeoutMs, effective,
      () => new OwnerKlingI2vGenerationServiceError("PRE_DISPATCH_FAILED"));
    const task = operation(deadline).finally(() => { deadline.close(); this.#runs.delete(run); });
    const run: ActiveRun = { attemptId, controller, task };
    this.#runs.add(run);
    return task;
  }
}

function createRecovery(attemptId: string, principal: Readonly<GenerationPrincipalRef>, client: NativeClient, chatId: string, now: number): Recovery {
  if (!Number.isSafeInteger(now) || now > 8_640_000_000_000_000) fail("SERVICE_BUSY");
  return { recovery_id: `kling_i2v_generation_recovery_${randomUUID()}`, attemptId, principal, client, chatId,
    createdAt: new Date(now).toISOString(), ownerEchoMessageId: null, status: "pending",
    artifacts: Object.freeze([]), gaps: new Set(), historyGetCalls: 0, resultGetCalls: 0, postStarted: false };
}
function snapshotOutput(recovery: Recovery): OwnerKlingI2vGenerationOutput {
  return Object.freeze({ status: recovery.status === "outcome_unknown" ? "unverified" : recovery.status,
    status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", backend_acceptance: "UNPROVEN", provider_terminal_status: "UNPROVEN",
    model_id: "kling_image2video", recovery_id: recovery.recovery_id, observed_artifact_count: recovery.artifacts.length,
    artifacts: Object.freeze(recovery.artifacts.map((item) => Object.freeze({ ...item }))),
    diagnostic: Object.freeze({ post_started: recovery.postStarted, ack_known: recovery.ownerEchoMessageId !== null,
      history_get_calls: recovery.historyGetCalls, result_get_calls: recovery.resultGetCalls, gaps: Object.freeze([...recovery.gaps]) }) });
}
function semanticIntentKey(principal: GenerationPrincipalRef, resolution: OwnerKlingI2VImageResolution, prompt: string, settings: unknown): string {
  return createHash("sha256").update(JSON.stringify([principal.tenant_id, principal.subject_id, resolution.sha256, prompt, settings]), "utf8").digest("hex");
}
function stablePrincipalKey(principal: GenerationPrincipalRef): string { return JSON.stringify([principal.tenant_id, principal.subject_id]); }
function snapshotGenerate(value: unknown): Readonly<OwnerKlingI2vGenerateInput> {
  const fields = exactRecord(value, ["attemptId", "image_handle", "parameters", "controls"]);
  const attemptId = readAttempt(fields.attemptId);
  if (typeof fields.image_handle !== "string" || !/^kling_i2v_image_[0-9a-f-]{36}$/u.test(fields.image_handle)) invalid();
  const parameters = exactRecord(fields.parameters, ["model_id", "prompt", "reference_count", "version", "mode", "video_duration", "native_audio"]);
  const controls = exactRecord(fields.controls, ["temperature"], ["multi_shots"]);
  return Object.freeze({ attemptId, image_handle: fields.image_handle, parameters: Object.freeze({ ...parameters }), controls: Object.freeze({ ...controls }) });
}
function snapshotRecovery(value: unknown): Readonly<OwnerKlingI2vReconcileInput> {
  const fields = exactRecord(value, ["attemptId", "recovery_id"]);
  const attemptId = readAttempt(fields.attemptId);
  if (typeof fields.recovery_id !== "string" || !RECOVERY_ID.test(fields.recovery_id)) invalid();
  return Object.freeze({ attemptId, recovery_id: fields.recovery_id });
}
function assertPreflight(accountInput: unknown, accessInput: unknown, parameters: OwnerKlingI2vNormalizedParameters,
  catalog: DiscoveryCatalogRepository, now: number): void {
  try {
    const account = exactRecord(accountInput, ["balance", "subscription", "contract_evidence", "source_build", "observed_at"]);
    const balance = exactRecord(account.balance, ["unit", "available"]);
    const subscription = exactRecord(account.subscription, ["active", "plan_type", "end_date", "end_date_kind"]);
    const access = exactRecord(accessInput, ["catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live",
      "parameter_keys", "parameters_redacted", "access", "cost", "discount_cost", "free_remaining_generations", "limit", "show_warning", "observed_at"]);
    const expectedVersion = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
    const keys = denseStrings(access.parameter_keys);
    const expectedKeys = [...COST_KEYS].sort();
    if (account.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || account.source_build !== ACCOUNT_SOURCE_BUILD || balance.unit !== "tokens" ||
        !(balance.available === null || (typeof balance.available === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(balance.available))) ||
        subscription.active !== true || typeof subscription.plan_type !== "string" || !subscription.plan_type.trim() || subscription.plan_type.trim().toUpperCase() === "FREE" ||
        !(subscription.end_date === null || typeof subscription.end_date === "string") ||
        !(subscription.end_date_kind === null || ["DATE_ONLY", "LOCAL_DATETIME", "OFFSET_DATETIME"].includes(String(subscription.end_date_kind))) ||
        subscription.end_date !== null && !validSubscriptionEnd(subscription.end_date, subscription.end_date_kind, now) ||
        !isFreshIso(account.observed_at, now) || access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || access.catalog_version !== expectedVersion ||
        access.model_id !== "kling_image2video" || access.ai_name !== "kling" || access.model_type !== "kling_image2video" ||
        access.account_read_live !== true || access.access !== true || access.parameters_redacted !== true ||
        JSON.stringify(keys) !== JSON.stringify(expectedKeys) || keys.length !== parameters.cost_query_candidate.keys.length ||
        !nullableFinite(access.cost) || !nullableFinite(access.discount_cost) ||
        !(access.free_remaining_generations === null || nonnegativeInteger(access.free_remaining_generations)) ||
        !nullableFinite(access.limit) || !(access.show_warning === null || typeof access.show_warning === "boolean") || !isFreshIso(access.observed_at, now)) fail("PREFLIGHT_FAILED");
  } catch (error) { if (error instanceof OwnerKlingI2vGenerationServiceError) throw error; fail("PREFLIGHT_FAILED"); }
}
function validReceipt(value: unknown, chatId: string): value is MediaGenerationReceipt {
  try { const fields = exactRecord(value, ["chat_uuid", "message_id"]); return fields.chat_uuid === chatId && typeof fields.message_id === "string" && SAFE_ID.test(fields.message_id); }
  catch { return false; }
}
function denseStrings(value: unknown): string[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 16) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) invalid();
  return Array.from({ length: value.length }, (_, index) => {
    const item = descriptors[String(index)]; if (!item || !("value" in item) || typeof item.value !== "string") invalid(); return item.value;
  }).sort();
}
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) invalid();
  let prototype: object | null; let descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); } catch { invalid(); }
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || (!required.includes(key) && !optional.includes(key)) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true) invalid();
    result[key] = descriptors[key]!.value;
  }
  if (required.some((key) => !Object.hasOwn(result, key))) invalid();
  return result;
}
function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || !fields.tenant_id.trim() || fields.tenant_id.length > 256 || /[\u0000-\u001f\u007f]/u.test(fields.tenant_id) ||
      typeof fields.subject !== "string" || !fields.subject.trim() || fields.subject.length > 512 || /[\u0000-\u001f\u007f]/u.test(fields.subject)) invalid();
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}
function readAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) invalid(); return value; }
function isExactService<T extends object>(value: unknown, constructor: new (...args: never[]) => T, methods: readonly string[]): value is T {
  try { return value instanceof constructor && !types.isProxy(value) && Object.getPrototypeOf(value) === constructor.prototype &&
    methods.every((method) => typeof Reflect.get(constructor.prototype, method) === "function" && !Object.hasOwn(value, method) && Reflect.get(value, method) === Reflect.get(constructor.prototype, method)); }
  catch { return false; }
}
function isReferenceService(value: unknown): value is KlingReferenceService {
  return isExactService(value, OwnerKlingI2VImageReferenceService, ["resolve", "isOwnedResolution", "withCapturedNativeImage", "invalidateAttempt", "close"]);
}
function isNativeClient(value: unknown): value is NativeClient {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === SyntxChatHttpClient.prototype &&
    typeof SyntxChatHttpClient.prototype.createOwnerKlingI2vVideoChat === "function" &&
    typeof SyntxChatHttpClient.prototype.startOwnerKlingI2vVideoWithContext === "function" &&
    typeof SyntxChatHttpClient.prototype.listMessageCandidates === "function" && typeof SyntxChatHttpClient.prototype.getMessage === "function"; }
  catch { return false; }
}
function readClock(value: unknown): () => number { if (value === undefined) return Date.now; if (typeof value !== "function" || types.isProxy(value)) invalid(); return value as () => number; }
function bounded(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (value === undefined) return fallback; if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) invalid(); return value as number;
}
function isFreshIso(value: unknown, now: number): boolean { if (typeof value !== "string") return false; const time = Date.parse(value); return Number.isFinite(time) && time <= now + 30_000 && time >= now - 5 * 60_000; }
function validSubscriptionEnd(value: string, kind: unknown, now: number): boolean {
  const normalized = kind === "DATE_ONLY" ? `${value}T23:59:59.999Z` : value;
  const time = Date.parse(normalized);
  return Number.isFinite(time) && time >= now;
}
function nullableFinite(value: unknown): boolean { return value === null || typeof value === "number" && Number.isFinite(value); }
function nonnegativeInteger(value: unknown): boolean { return Number.isSafeInteger(value) && (value as number) >= 0; }
function saturatingIncrement(value: number): number { return value < 255 ? value + 1 : 255; }
function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
  });
}
function fail(code: OwnerKlingI2vGenerationServiceErrorCode, recoveryId?: string): never { throw new OwnerKlingI2vGenerationServiceError(code, recoveryId); }
function invalid(): never { return fail("INVALID_REQUEST"); }
