import { createHash } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { SyntxSubscription } from "../adapter/syntx/account-decoder.js";
import { GenerationContractExecutorV2 } from "../adapter/syntx/generation-contract-executor-v2.js";
import type { SyntxCostParameter } from "../adapter/syntx/http-client.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { serializeGenerationContractRegistryV2, type GenerationContractRegistryV2 } from "../domain/generation-contract-v2.js";
import type { ModelAccessResult } from "./model-access.js";
import { OwnerGenerationPreflightError } from "./owner-generation-preflight.js";
import {
  OWNER_HAILUO01_T2V_CONTRACT_REGISTRY_VERSION,
  isAuthenticOwnerHailuo01T2vProfile,
  type OwnerReviewedNoReferenceT2vNormalizedRequest,
  type OwnerReviewedNoReferenceT2vProfile,
  type OwnerHailuo01T2vSourceContract
} from "./owner-hailuo01-t2v-profile.js";
import {
  OWNER_HAILUO01_DIRECTOR_T2V_CONTRACT_REGISTRY_VERSION,
  isAuthenticOwnerHailuo01DirectorT2vProfile,
  type OwnerHailuo01DirectorT2vSourceContract
} from "./owner-hailuo01-director-t2v-profile.js";
import {
  OWNER_HAILUO23_T2V_CONTRACT_REGISTRY_VERSION,
  isAuthenticOwnerHailuo23T2vProfile,
  type OwnerHailuo23T2vDuration,
  type OwnerHailuo23T2vResolution,
  type OwnerHailuo23T2vSourceContract
} from "./owner-hailuo23-t2v-profile.js";
import {
  OwnerContractMediaError,
  OwnerContractMediaService,
  type OwnerContractMediaClient,
  type OwnerContractMediaContractContext,
  type OwnerContractMediaReadClient,
  type OwnerContractMediaResult
} from "./owner-contract-media.js";
import { OwnerContractMediaRecoveryStore } from "./owner-contract-media-recovery.js";
import {
  createOwnerReviewedContractCallPolicy,
  OwnerContractProbePolicyError,
  revalidateOwnerReviewedContractCall,
  type OwnerContractProbePolicyDiagnosticCode,
  type OwnerReviewedContractCallPolicy
} from "./owner-contract-probe-policy.js";

const MAX_RECOVERIES = 128;
const MAX_INTENTS = 128;
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY_ID_PATTERN = /^recovery_[0-9a-f-]{36}$/u;

export interface OwnerReviewedNoReferenceT2vServiceOptions<TSource extends object = OwnerHailuo01T2vSourceContract> {
  readonly profile: OwnerReviewedNoReferenceT2vProfile<TSource>;
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveSubscription: (attemptId: string, signal?: AbortSignal) => Promise<SyntxSubscription>;
  readonly resolveModelAccess: (
    attemptId: string,
    modelId: string,
    costParameters: Readonly<Record<string, SyntxCostParameter>>,
    signal?: AbortSignal
  ) => Promise<ModelAccessResult>;
  readonly resolveChatClient: (attemptId: string) => OwnerContractMediaClient;
  readonly now?: () => number;
  readonly wait?: (milliseconds: number) => Promise<void>;
  readonly videoTimeoutMs?: number;
}

export interface OwnerReviewedNoReferenceT2vGenerationInput {
  readonly attemptId: string;
  readonly prompt: string;
  readonly resolution: "720p";
  readonly video_duration: 6;
}

export interface OwnerHailuo23T2vGenerationInput {
  readonly attemptId: string;
  readonly prompt: string;
  readonly resolution: OwnerHailuo23T2vResolution;
  readonly video_duration: OwnerHailuo23T2vDuration;
}

export interface OwnerReviewedNoReferenceT2vGenerationOutput extends OwnerContractMediaResult {
  readonly status: "reviewed";
  readonly confidence_scope: "exact_result_only";
  readonly variant_id: string;
}

export interface OwnerReviewedNoReferenceT2vRecoveryListItem {
  readonly recovery_id: string;
  readonly model_id: string;
  readonly operation_id: "generate-video";
  readonly variant_id: string;
  readonly created_at: string;
}

export type OwnerReviewedNoReferenceT2vServiceErrorCode =
  | "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "INTENT_ALREADY_USED"
  | "PRINCIPAL_NOT_LINKED" | "SUBSCRIPTION_REQUIRED" | "SUBSCRIPTION_STATUS_UNVERIFIED"
  | "MODEL_ACCESS_UNAVAILABLE" | "RECOVERY_NOT_FOUND" | "OUTCOME_UNKNOWN";

export class OwnerReviewedNoReferenceT2vServiceError extends Error {
  constructor(
    readonly code: OwnerReviewedNoReferenceT2vServiceErrorCode,
    readonly recovery_id?: string,
    readonly diagnostic_code?: OwnerContractProbePolicyDiagnosticCode
  ) {
    super(code === "OUTCOME_UNKNOWN"
      ? "The reviewed request may have been dispatched; reconcile the same recovery handle and do not retry."
      : "The reviewed no-reference T2V request could not be completed safely.");
    this.name = "OwnerReviewedNoReferenceT2vServiceError";
  }
}

interface StoredRecovery {
  readonly recovery_id: string;
  readonly attempt_id: string;
  readonly policy: OwnerReviewedContractCallPolicy;
  readonly client: OwnerContractMediaClient;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly intent_key: string;
}

interface SemanticIntentClaim {
  readonly attempt_id: string;
  readonly created_at: number;
  state: "PREPARING" | "DISPATCH_POSSIBLE" | "RESULT_OBSERVED";
  recovery_id?: string;
}

/** Generic reviewed no-reference T2V orchestration; the Hailuo profile is fixed at construction. */
class OwnerReviewedNoReferenceT2vEngine<TSource extends object> {
  readonly #options: OwnerReviewedNoReferenceT2vServiceOptions<TSource>;
  readonly #profile: OwnerReviewedNoReferenceT2vProfile<TSource>;
  readonly #executor: GenerationContractExecutorV2;
  readonly #contract: OwnerContractMediaContractContext;
  readonly #recoveryStore: ReviewedNoReferenceT2vRecoveryStore;
  readonly #media: OwnerContractMediaService;
  readonly #recoveries = new Map<string, StoredRecovery>();
  readonly #intents = new Map<string, SemanticIntentClaim>();
  readonly #controllers = new Map<string, Set<AbortController>>();
  readonly #pending = new Set<Promise<unknown>>();
  readonly #pendingByAttempt = new Map<string, Set<Promise<unknown>>>();
  readonly #generationReservations = new Set<object>();
  readonly #attemptEpochs = new Map<string, number>();
  readonly #invalidating = new Set<string>();
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(options: OwnerReviewedNoReferenceT2vServiceOptions<TSource>) {
    this.#options = options;
    this.#profile = options.profile;
    this.#executor = new GenerationContractExecutorV2(options.profile.registry, options.profile.catalog);
    this.#contract = contractContext(this.#executor, options.profile);
    this.#recoveryStore = new ReviewedNoReferenceT2vRecoveryStore({ now: options.now ?? Date.now });
    this.#media = new OwnerContractMediaService({
      recoveryStore: this.#recoveryStore,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.wait === undefined ? {} : { wait: options.wait }),
      ...(options.videoTimeoutMs === undefined ? {} : { videoTimeoutMs: options.videoTimeoutMs })
    });
  }

  getParametersSource(): TSource { return this.#profile.source; }

  getReviewedContract() {
    const contract = this.#executor.getContract(this.#profile.modelId, this.#profile.operationId, this.#profile.variantId);
    if (contract === null) throw new OwnerReviewedNoReferenceT2vServiceError("INVALID_REQUEST");
    return contract;
  }

  generate(input: unknown, signal?: AbortSignal): Promise<OwnerReviewedNoReferenceT2vGenerationOutput> {
    this.#assertOpen();
    let request: OwnerReviewedNoReferenceT2vNormalizedRequest;
    try { request = this.#profile.normalizeGenerationInput(input); }
    catch { throw new OwnerReviewedNoReferenceT2vServiceError("INVALID_REQUEST"); }
    if (this.#invalidating.has(request.attemptId)) throw new OwnerReviewedNoReferenceT2vServiceError("PRINCIPAL_NOT_LINKED");
    if (this.#recoveryStore.size() + this.#generationReservations.size >= MAX_RECOVERIES) {
      throw new OwnerReviewedNoReferenceT2vServiceError("SERVICE_BUSY");
    }
    const reservation = Object.freeze({});
    this.#generationReservations.add(reservation);
    const controller = new AbortController();
    const controllers = this.#controllers.get(request.attemptId) ?? new Set<AbortController>();
    controllers.add(controller);
    this.#controllers.set(request.attemptId, controllers);
    const effectiveSignal = mergeSignals(signal, controller.signal);
    const epoch = this.#attemptEpochs.get(request.attemptId) ?? 0;
    const task = this.#generate(request, effectiveSignal, epoch, reservation).finally(() => {
      this.#generationReservations.delete(reservation);
      controllers.delete(controller);
      if (controllers.size === 0) this.#controllers.delete(request.attemptId);
      this.#untrack(task, request.attemptId);
    });
    this.#track(task, request.attemptId);
    return task;
  }

  reconcile(input: { readonly attemptId: string; readonly recovery_id: string } | unknown, signal?: AbortSignal): Promise<OwnerReviewedNoReferenceT2vGenerationOutput> {
    this.#assertOpen();
    const request = snapshotRecoveryInput(input);
    if (this.#invalidating.has(request.attemptId)) throw new OwnerReviewedNoReferenceT2vServiceError("PRINCIPAL_NOT_LINKED");
    return this.#run(request.attemptId, signal, (effectiveSignal) => this.#reconcile(request, effectiveSignal));
  }

  listRecoveries(attemptId: string, limit = 20): readonly OwnerReviewedNoReferenceT2vRecoveryListItem[] {
    this.#assertOpen();
    if (!ATTEMPT_PATTERN.test(attemptId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
      throw new OwnerReviewedNoReferenceT2vServiceError("INVALID_REQUEST");
    }
    return Object.freeze(this.#recoveryStore.list(attemptId, limit).filter((item) => this.#recoveries.has(item.recovery_id)).map((item) => Object.freeze({
      recovery_id: item.recovery_id, model_id: this.#profile.modelId, operation_id: this.#profile.operationId,
      variant_id: this.#profile.variantId, created_at: item.created_at
    })));
  }

  async invalidateAttempt(attemptId: string): Promise<void> {
    if (!ATTEMPT_PATTERN.test(attemptId)) return;
    this.#invalidating.add(attemptId);
    this.#attemptEpochs.set(attemptId, (this.#attemptEpochs.get(attemptId) ?? 0) + 1);
    for (const controller of this.#controllers.get(attemptId) ?? []) controller.abort();
    await Promise.allSettled([...(this.#pendingByAttempt.get(attemptId) ?? [])]);
    while (true) {
      const records = this.#recoveryStore.list(attemptId, 20);
      if (records.length === 0) break;
      for (const item of records) this.#removeRecovery(item.recovery_id, attemptId);
    }
    for (const [key, claim] of this.#intents) {
      if (claim.attempt_id === attemptId && claim.state === "PREPARING") this.#intents.delete(key);
    }
    this.#invalidating.delete(attemptId);
    this.#pendingByAttempt.delete(attemptId);
    if (!this.#controllers.has(attemptId)) this.#attemptEpochs.delete(attemptId);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const controllers of this.#controllers.values()) for (const controller of controllers) controller.abort();
    this.#closing = (async () => {
      await Promise.allSettled([...this.#pending]);
      this.#recoveryStore.close();
      this.#recoveries.clear();
      this.#controllers.clear();
      this.#attemptEpochs.clear();
      this.#invalidating.clear();
      this.#pendingByAttempt.clear();
      this.#generationReservations.clear();
    })();
    return this.#closing;
  }

  async #generate(request: OwnerReviewedNoReferenceT2vNormalizedRequest, signal: AbortSignal, epoch: number,
    reservation: object): Promise<OwnerReviewedNoReferenceT2vGenerationOutput> {
    signal.throwIfAborted();
    const parameters = request.parameters;
    const policy = createOwnerReviewedContractCallPolicy({
      registry: this.#profile.registry, registryVersion: this.#profile.registryVersion, executor: this.#executor,
      attemptId: request.attemptId, modelId: this.#profile.modelId, operationId: this.#profile.operationId,
      variantId: this.#profile.variantId, parameters,
      costParameterFields: this.#profile.costParameterFields
    });
    const prepared = this.#executor.prepare({ model_id: this.#profile.modelId, operation_id: this.#profile.operationId,
      catalog_version: this.#profile.registry.catalog_version,
      variant_id: this.#profile.variantId, parameters });
    const preflightPrincipal = await this.#resolveCurrentPrincipal(request.attemptId, signal);
    const intentKey = semanticIntentKey(preflightPrincipal, this.#profile, request);
    this.#reserveIntent(intentKey, request.attemptId);
    let finalPrincipal: Readonly<GenerationPrincipalRef> | undefined;
    let preDispatchFailure: OwnerReviewedNoReferenceT2vServiceError | undefined;
    const beforeChat = async (requestSignal: AbortSignal) => {
      try { finalPrincipal = await this.#verifyEntitlement(policy, request.attemptId, requestSignal, preflightPrincipal); }
      catch (error) { preDispatchFailure = mapError(error); throw error; }
    };
    const beforeDispatch = async (requestSignal: AbortSignal) => {
      try {
        const expected = finalPrincipal ?? preflightPrincipal;
        await this.#verifyEntitlement(policy, request.attemptId, requestSignal, expected);
        const claim = this.#intents.get(intentKey);
        if (!claim || claim.attempt_id !== request.attemptId || claim.state !== "PREPARING") throw new OwnerReviewedNoReferenceT2vServiceError("SERVICE_BUSY");
        claim.state = "DISPATCH_POSSIBLE";
        this.#generationReservations.delete(reservation);
      } catch (error) { preDispatchFailure = mapError(error); throw error; }
    };
    const nativeClient = this.#options.resolveChatClient(request.attemptId);
    const client = this.#guardClient(nativeClient, request.attemptId, preflightPrincipal);
    let mediaResult: OwnerContractMediaResult;
    try {
      mediaResult = await this.#media.generate({
        client, attemptId: request.attemptId,
        contract: this.#contract, prepared, probePolicy: policy, beforeChat, beforeDispatch, signal
      });
      const claim = this.#intents.get(intentKey);
      if (claim) claim.state = "RESULT_OBSERVED";
      return resultFromMedia(mediaResult, this.#profile);
    } catch (error) {
      if (preDispatchFailure !== undefined) { this.#releasePreDispatchIntent(intentKey); throw preDispatchFailure; }
      if ((this.#attemptEpochs.get(request.attemptId) ?? 0) !== epoch) {
        this.#releasePreDispatchIntent(intentKey);
        throw new OwnerReviewedNoReferenceT2vServiceError("PRINCIPAL_NOT_LINKED");
      }
      if (error instanceof OwnerContractMediaError && error.code === "OUTCOME_UNKNOWN" && error.recoveryId && RECOVERY_ID_PATTERN.test(error.recoveryId)) {
        const record = this.#recoveryStore.get(error.recoveryId, request.attemptId);
        if (!record) { this.#releasePreDispatchIntent(intentKey); throw new OwnerReviewedNoReferenceT2vServiceError("OUTCOME_UNKNOWN"); }
        if (this.#recoveries.size >= MAX_RECOVERIES && !this.#recoveries.has(error.recoveryId)) {
          this.#releasePreDispatchIntent(intentKey);
          this.#recoveryStore.remove(error.recoveryId, request.attemptId);
          throw new OwnerReviewedNoReferenceT2vServiceError("OUTCOME_UNKNOWN");
        }
        const principal = finalPrincipal ?? preflightPrincipal;
        this.#recoveries.set(error.recoveryId, Object.freeze({ recovery_id: error.recoveryId, attempt_id: request.attemptId,
          policy, client: nativeClient, principal, intent_key: intentKey }));
        const claim = this.#intents.get(intentKey);
        if (claim) { claim.state = "DISPATCH_POSSIBLE"; claim.recovery_id = error.recoveryId; }
        throw new OwnerReviewedNoReferenceT2vServiceError("OUTCOME_UNKNOWN", error.recoveryId);
      }
      this.#releasePreDispatchIntent(intentKey);
      throw mapError(error);
    }
  }

  async #reconcile(request: { readonly attemptId: string; readonly recovery_id: string }, signal: AbortSignal): Promise<OwnerReviewedNoReferenceT2vGenerationOutput> {
    const stored = this.#recoveries.get(request.recovery_id);
    const record = this.#recoveryStore.get(request.recovery_id, request.attemptId);
    if (!stored || !record || stored.attempt_id !== request.attemptId || stored.principal.connection_id !== request.attemptId) {
      throw new OwnerReviewedNoReferenceT2vServiceError("RECOVERY_NOT_FOUND");
    }
    let revokedDuringRead = false;
    try {
      const current = await this.#resolveCurrentPrincipal(request.attemptId, signal);
      if (!sameGenerationPrincipal(current, stored.principal)) { this.#removeRecovery(request.recovery_id, request.attemptId); throw new OwnerReviewedNoReferenceT2vServiceError("RECOVERY_NOT_FOUND"); }
      const client = stored.client;
      const checkPrincipal = async () => {
        let latest: Readonly<GenerationPrincipalRef>;
        try { latest = await this.#resolveCurrentPrincipal(request.attemptId, signal); }
        catch { revokedDuringRead = true; this.#removeRecovery(request.recovery_id, request.attemptId); throw new OwnerReviewedNoReferenceT2vServiceError("RECOVERY_NOT_FOUND"); }
        if (!sameGenerationPrincipal(latest, stored.principal)) { revokedDuringRead = true; this.#removeRecovery(request.recovery_id, request.attemptId); throw new OwnerReviewedNoReferenceT2vServiceError("RECOVERY_NOT_FOUND"); }
      };
      const readWithPrincipal = async <T>(operation: () => Promise<T>) => {
        await checkPrincipal();
        try { return await operation(); }
        finally { await checkPrincipal(); }
      };
      const readOnlyClient: OwnerContractMediaReadClient = Object.freeze({
        listInProgress: (chatUuid: string, requestSignal?: AbortSignal) => readWithPrincipal(() => client.listInProgress(chatUuid, requestSignal)),
        getMessage: (chatUuid: string, messageId: string, requestSignal?: AbortSignal) => readWithPrincipal(() => client.getMessage(chatUuid, messageId, requestSignal)),
        ...(client.listMessageCandidates === undefined ? {} : {
          listMessageCandidates: (chatUuid: string, echoId: string, requestSignal?: AbortSignal) => readWithPrincipal(() => client.listMessageCandidates!(chatUuid, echoId, requestSignal))
        })
      });
      const mediaResult = await this.#media.reconcile({
        client: readOnlyClient, attemptId: request.attemptId, recoveryId: request.recovery_id,
        contract: this.#contract, probePolicy: stored.policy, signal
      });
      const claim = this.#intents.get(stored.intent_key);
      if (claim) claim.state = "RESULT_OBSERVED";
      this.#removeRecovery(request.recovery_id, request.attemptId);
      return resultFromMedia(mediaResult, this.#profile);
    } catch (error) {
      if (revokedDuringRead || (error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "PRINCIPAL_NOT_LINKED") ||
          (error instanceof OwnerContractMediaError && error.code === "RECOVERY_NOT_FOUND")) {
        this.#removeRecovery(request.recovery_id, request.attemptId);
        throw new OwnerReviewedNoReferenceT2vServiceError("RECOVERY_NOT_FOUND");
      }
      if (error instanceof OwnerReviewedNoReferenceT2vServiceError) throw error;
      throw new OwnerReviewedNoReferenceT2vServiceError("OUTCOME_UNKNOWN", request.recovery_id);
    }
  }

  async #verifyEntitlement(policy: OwnerReviewedContractCallPolicy, attemptId: string, signal: AbortSignal,
    expected: Readonly<GenerationPrincipalRef>): Promise<Readonly<GenerationPrincipalRef>> {
    signal.throwIfAborted();
    const current = await this.#resolveCurrentPrincipal(attemptId, signal);
    if (!sameGenerationPrincipal(current, expected)) throw new OwnerReviewedNoReferenceT2vServiceError("PRINCIPAL_NOT_LINKED");
    await revalidateOwnerReviewedContractCall(policy, attemptId, this.#options.resolveSubscription, this.#options.resolveModelAccess, signal)
      .catch((error: unknown) => { throw mapError(error); });
    const after = await this.#resolveCurrentPrincipal(attemptId, signal);
    if (!sameGenerationPrincipal(after, expected)) throw new OwnerReviewedNoReferenceT2vServiceError("PRINCIPAL_NOT_LINKED");
    signal.throwIfAborted();
    return after;
  }

  async #resolveCurrentPrincipal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    signal?.throwIfAborted();
    if (!ATTEMPT_PATTERN.test(attemptId)) throw new OwnerReviewedNoReferenceT2vServiceError("INVALID_REQUEST");
    let principal: Readonly<GenerationPrincipalRef>;
    try { principal = snapshotGenerationPrincipal(await resolveOwnerReferencePrincipal({ binding: this.#options.binding, attemptId, linkService: this.#options.linkService })); }
    catch { throw new OwnerReviewedNoReferenceT2vServiceError("PRINCIPAL_NOT_LINKED"); }
    if (principal.connection_id !== attemptId || principal.tenant_id !== this.#options.binding.tenant_id || principal.subject_id !== this.#options.binding.subject) {
      throw new OwnerReviewedNoReferenceT2vServiceError("PRINCIPAL_NOT_LINKED");
    }
    signal?.throwIfAborted();
    return principal;
  }

  #guardClient(
    client: OwnerContractMediaClient,
    attemptId: string,
    expected: Readonly<GenerationPrincipalRef>
  ): OwnerContractMediaClient {
    const check = async (signal?: AbortSignal) => {
      const current = await this.#resolveCurrentPrincipal(attemptId, signal);
      if (!sameGenerationPrincipal(current, expected)) throw new OwnerReviewedNoReferenceT2vServiceError("PRINCIPAL_NOT_LINKED");
    };
    const readWithPrincipal = async <T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
      await check(signal);
      try { return await operation(); }
      finally { await check(signal); }
    };
    return Object.freeze({
      createChat: (...args: Parameters<OwnerContractMediaClient["createChat"]>) => client.createChat(...args),
      startImage: (...args: Parameters<OwnerContractMediaClient["startImage"]>) => client.startImage(...args),
      startVideo: (...args: Parameters<OwnerContractMediaClient["startVideo"]>) => client.startVideo(...args),
      listInProgress: (chatUuid: string, signal?: AbortSignal) => readWithPrincipal(() => client.listInProgress(chatUuid, signal), signal),
      getMessage: (chatUuid: string, messageId: string, signal?: AbortSignal) => readWithPrincipal(() => client.getMessage(chatUuid, messageId, signal), signal),
      ...(client.listMessageCandidates === undefined ? {} : {
        listMessageCandidates: (chatUuid: string, echoId: string, signal?: AbortSignal) =>
          readWithPrincipal(() => client.listMessageCandidates!(chatUuid, echoId, signal), signal)
      })
    });
  }

  #reserveIntent(key: string, attemptId: string): void {
    if (this.#intents.has(key)) throw new OwnerReviewedNoReferenceT2vServiceError("INTENT_ALREADY_USED");
    if (this.#intents.size >= MAX_INTENTS) throw new OwnerReviewedNoReferenceT2vServiceError("SERVICE_BUSY");
    this.#intents.set(key, { attempt_id: attemptId, created_at: readNow(this.#options.now), state: "PREPARING" });
  }

  #releasePreDispatchIntent(key: string): void { if (this.#intents.get(key)?.state === "PREPARING") this.#intents.delete(key); }
  #removeRecovery(recoveryId: string, attemptId: string): void { this.#recoveryStore.remove(recoveryId, attemptId); this.#recoveries.delete(recoveryId); }

  async #run<T>(attemptId: string, signal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const controllers = this.#controllers.get(attemptId) ?? new Set<AbortController>();
    controllers.add(controller); this.#controllers.set(attemptId, controllers);
    const effectiveSignal = mergeSignals(signal, controller.signal);
    const task = (async () => { effectiveSignal.throwIfAborted(); return operation(effectiveSignal); })().finally(() => {
      controllers.delete(controller); if (controllers.size === 0) this.#controllers.delete(attemptId); this.#untrack(task, attemptId);
    });
    this.#track(task, attemptId);
    return task;
  }

  #track(promise: Promise<unknown>, attemptId: string): void {
    this.#pending.add(promise);
    const byAttempt = this.#pendingByAttempt.get(attemptId) ?? new Set<Promise<unknown>>();
    byAttempt.add(promise); this.#pendingByAttempt.set(attemptId, byAttempt);
  }
  #untrack(promise: Promise<unknown>, attemptId: string): void {
    this.#pending.delete(promise);
    const byAttempt = this.#pendingByAttempt.get(attemptId);
    byAttempt?.delete(promise); if (byAttempt?.size === 0) this.#pendingByAttempt.delete(attemptId);
  }
  #assertOpen(): void { if (this.#closed) throw new OwnerReviewedNoReferenceT2vServiceError("SERVICE_CLOSED"); }
}

/** Hailuo-facing flat service ABI; only its authentic source-bound factory is admitted. */
export class OwnerReviewedNoReferenceT2vService extends OwnerReviewedNoReferenceT2vEngine<OwnerHailuo01T2vSourceContract> {
  constructor(options: OwnerReviewedNoReferenceT2vServiceOptions<OwnerHailuo01T2vSourceContract>) {
    if (!isAuthenticOwnerHailuo01T2vProfile(options.profile) ||
        options.profile.registryVersion !== OWNER_HAILUO01_T2V_CONTRACT_REGISTRY_VERSION ||
        contentAddressedVersion(options.profile.registry) !== OWNER_HAILUO01_T2V_CONTRACT_REGISTRY_VERSION) {
      throw new Error("OWNER_REVIEWED_T2V_PROFILE_INVALID");
    }
    super(options);
  }
}

/** Director flat service ABI over the same reviewed no-reference engine. */
export class OwnerHailuo01DirectorT2vGenerationService extends OwnerReviewedNoReferenceT2vEngine<OwnerHailuo01DirectorT2vSourceContract> {
  constructor(options: OwnerReviewedNoReferenceT2vServiceOptions<OwnerHailuo01DirectorT2vSourceContract>) {
    if (!isAuthenticOwnerHailuo01DirectorT2vProfile(options.profile) ||
        options.profile.registryVersion !== OWNER_HAILUO01_DIRECTOR_T2V_CONTRACT_REGISTRY_VERSION ||
        contentAddressedVersion(options.profile.registry) !== OWNER_HAILUO01_DIRECTOR_T2V_CONTRACT_REGISTRY_VERSION) {
      throw new Error("OWNER_REVIEWED_T2V_PROFILE_INVALID");
    }
    super(options);
  }
}

/** Thin flat Hailuo 2.3 ABI over the shared reviewed no-reference T2V engine. */
export class OwnerHailuo23T2vGenerationService {
  readonly #engine: OwnerReviewedNoReferenceT2vEngine<OwnerHailuo23T2vSourceContract>;

  constructor(options: OwnerReviewedNoReferenceT2vServiceOptions<OwnerHailuo23T2vSourceContract>) {
    if (!isAuthenticOwnerHailuo23T2vProfile(options.profile) ||
        options.profile.registryVersion !== OWNER_HAILUO23_T2V_CONTRACT_REGISTRY_VERSION ||
        contentAddressedVersion(options.profile.registry) !== OWNER_HAILUO23_T2V_CONTRACT_REGISTRY_VERSION) {
      throw new Error("OWNER_REVIEWED_T2V_PROFILE_INVALID");
    }
    this.#engine = new OwnerReviewedNoReferenceT2vEngine(options);
  }

  getParametersSource(): OwnerHailuo23T2vSourceContract { return this.#engine.getParametersSource(); }
  getReviewedContract() { return this.#engine.getReviewedContract(); }
  generate(input: OwnerHailuo23T2vGenerationInput, signal?: AbortSignal): Promise<OwnerReviewedNoReferenceT2vGenerationOutput> {
    return this.#engine.generate(input, signal);
  }
  reconcile(input: { readonly attemptId: string; readonly recovery_id: string } | unknown, signal?: AbortSignal): Promise<OwnerReviewedNoReferenceT2vGenerationOutput> {
    return this.#engine.reconcile(input, signal);
  }
  listRecoveries(attemptId: string, limit = 20): readonly OwnerReviewedNoReferenceT2vRecoveryListItem[] {
    return this.#engine.listRecoveries(attemptId, limit);
  }
  invalidateAttempt(attemptId: string): Promise<void> { return this.#engine.invalidateAttempt(attemptId); }
  close(): Promise<void> { return this.#engine.close(); }
}

class ReviewedNoReferenceT2vRecoveryStore extends OwnerContractMediaRecoveryStore {
  constructor(options: { readonly now: () => number }) { super({ maxRecords: MAX_RECOVERIES, ttlMs: Number.MAX_SAFE_INTEGER, now: options.now }); }
  override create(input: Parameters<OwnerContractMediaRecoveryStore["create"]>[0]) {
    if (this.size() >= MAX_RECOVERIES) throw new OwnerReviewedNoReferenceT2vServiceError("SERVICE_BUSY");
    return super.create(input);
  }
  hasCapacity(): boolean { return this.size() < MAX_RECOVERIES; }
}

function contractContext(
  executor: GenerationContractExecutorV2,
  profile: OwnerReviewedNoReferenceT2vProfile<object>
): OwnerContractMediaContractContext {
  const contract = executor.getContract(profile.modelId, profile.operationId, profile.variantId);
  if (contract === null || contract.status !== "reviewed" || contract.provenance.live_observed_at !== undefined ||
      !Number.isFinite(Date.parse(contract.provenance.reviewed_at ?? ""))) throw new Error("OWNER_REVIEWED_T2V_CONTRACT_MISSING");
  const expected = profile.buildContractInput(contract.provenance.reviewed_at!);
  const { schema_hash: _schemaHash, ...actual } = contract;
  if (!isDeepStrictEqual(actual, expected)) throw new Error("OWNER_REVIEWED_T2V_CONTRACT_MISMATCH");
  return Object.freeze({
    model_id: contract.model_id, operation_id: profile.operationId, modality: "video", ai_name: profile.aiName, model_type: profile.modelType,
    variant_id: contract.variant_id, schema_hash: contract.schema_hash, status: "reviewed",
    mime_types: Object.freeze([...contract.output.mime_types]), registry_version: profile.registryVersion,
    catalog_version: profile.registry.catalog_version
  });
}

function contentAddressedVersion(registry: GenerationContractRegistryV2): string {
  return `sha256-${createHash("sha256").update(serializeGenerationContractRegistryV2(registry)).digest("hex")}.json`;
}

function semanticIntentKey(
  principal: Readonly<GenerationPrincipalRef>,
  profile: OwnerReviewedNoReferenceT2vProfile<object>,
  request: OwnerReviewedNoReferenceT2vNormalizedRequest
): string {
  const normalized = stableJson({ tenant_id: principal.tenant_id, subject_id: principal.subject_id,
    model_id: profile.modelId, variant_id: profile.variantId, semantic_intent: request.semanticIntent });
  return createHash("sha256").update(normalized).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + stableJson(record[key])).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
}

function snapshotRecoveryInput(value: unknown): { readonly attemptId: string; readonly recovery_id: string } {
  if (!isPlainRecord(value) || Object.keys(value).sort().join("\0") !== ["attemptId", "recovery_id"].sort().join("\0") ||
      typeof value.attemptId !== "string" || !ATTEMPT_PATTERN.test(value.attemptId) ||
      typeof value.recovery_id !== "string" || !RECOVERY_ID_PATTERN.test(value.recovery_id)) throw new OwnerReviewedNoReferenceT2vServiceError("INVALID_REQUEST");
  return Object.freeze({ attemptId: value.attemptId, recovery_id: value.recovery_id });
}

function resultFromMedia(result: OwnerContractMediaResult, profile: OwnerReviewedNoReferenceT2vProfile<object>): OwnerReviewedNoReferenceT2vGenerationOutput {
  return Object.freeze({ status: "reviewed", confidence_scope: "exact_result_only", model_id: profile.modelId,
    operation_id: profile.operationId, modality: "video", variant_id: profile.variantId,
    artifacts: Object.freeze(result.artifacts.map((artifact) => Object.freeze({ ...artifact }))) });
}

function mapError(error: unknown): OwnerReviewedNoReferenceT2vServiceError {
  if (error instanceof OwnerReviewedNoReferenceT2vServiceError) return error;
  if (error instanceof OwnerGenerationPreflightError) return new OwnerReviewedNoReferenceT2vServiceError(
    error.code === "SUBSCRIPTION_REQUIRED" ? "SUBSCRIPTION_REQUIRED" : "SUBSCRIPTION_STATUS_UNVERIFIED");
  if (error instanceof OwnerContractProbePolicyError) return new OwnerReviewedNoReferenceT2vServiceError(
    error.code === "PROBE_MODEL_ACCESS_UNAVAILABLE" ? "MODEL_ACCESS_UNAVAILABLE" : "INVALID_REQUEST", undefined, error.diagnostic_code);
  if (error instanceof OwnerContractMediaError) {
    if (error.code === "OUTCOME_UNKNOWN") return new OwnerReviewedNoReferenceT2vServiceError("OUTCOME_UNKNOWN", error.recoveryId);
    if (error.code === "RECOVERY_NOT_FOUND") return new OwnerReviewedNoReferenceT2vServiceError("RECOVERY_NOT_FOUND");
    if (error.code === "PRE_DISPATCH_FAILED") return new OwnerReviewedNoReferenceT2vServiceError("INVALID_REQUEST");
  }
  return new OwnerReviewedNoReferenceT2vServiceError("INVALID_REQUEST");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => typeof key === "string" &&
    Object.getOwnPropertyDescriptor(value, key)?.enumerable === true && "value" in Object.getOwnPropertyDescriptor(value, key)!);
}
function readNow(now: (() => number) | undefined): number {
  const value = now?.() ?? Date.now();
  if (!Number.isSafeInteger(value) || value < 0) throw new OwnerReviewedNoReferenceT2vServiceError("INVALID_REQUEST");
  return value;
}
function mergeSignals(external: AbortSignal | undefined, internal: AbortSignal): AbortSignal {
  return external === undefined ? internal : AbortSignal.any([external, internal]);
}
