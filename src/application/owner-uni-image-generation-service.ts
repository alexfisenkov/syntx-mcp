import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { SyntxChatHttpClient, type MediaGenerationReceipt } from "../adapter/syntx/chat-http-client.js";
import type { InternalOwnerUniImageResult, OwnerUniImageResultPendingReason,
  OwnerUniImageResultPartialReason, OwnerUniImageResultUnverifiedReason } from "../adapter/syntx/owner-uni-image-result.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import type { AccountStatusResult } from "./account-status.js";
import type { ModelAccessResult } from "./model-access.js";
import { OwnerUniImageOneShotPolicyError, createOwnerUniImageOneShotPermit } from "./owner-uni-image-one-shot-policy.js";
import { OwnerUniImageRequestPreparer, OwnerUniImageRequestPrepareError,
  type OwnerUniImageOwnedAssetSet, type OwnerUniImagePreparedCandidate } from "./owner-uni-image-request-preparer.js";
import { getOwnerUniImageSourceProfile, type OwnerUniImageSourceProfile } from "./owner-uni-image-source-profile.js";
import { OWNER_UNI_IMAGE_MODELS, type OwnerUniImageModel, type OwnerUniImageParametersInput } from "./owner-uni-image-parameters.js";
import { correlateOwnerUniImageHistoryBinding, type OwnerUniImageHistoryBindingReason } from "./owner-uni-image-history-binding.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY = /^uni_image_recovery_[0-9a-f-]{36}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const TTL_MS = 15 * 60_000;
const MAX_PENDING = 4;
const MAX_STATES = 128;
const MAX_TIMEOUT_MS = 180_000;
const MAX_POLL_DELAY_MS = 40_000;
const MAX_POLL_ROUNDS = 32;
const MAX_DIAGNOSTIC_COUNT = 255;
const DEFAULT_POLL_DELAY_MS = 2_000;
const MAX_CLOCK_SKEW_MS = 30_000;
const OPERATION = "generate-image" as const;
const NATIVE = Object.freeze({ createChat: SyntxChatHttpClient.prototype.createChat,
  start: SyntxChatHttpClient.prototype.startUniImageWithOwnedCandidate,
  history: SyntxChatHttpClient.prototype.listMessageCandidates,
  result: SyntxChatHttpClient.prototype.getUniImageResult });

export interface OwnerUniImageGenerationPreflightInput {
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: OwnerUniImageModel;
  readonly catalog_version: string;
  readonly cost_inputs: Readonly<Record<string, string | number>>;
  readonly request_fingerprint: string;
  readonly signal?: AbortSignal;
}
export interface OwnerUniImageGenerationPreflightResult { readonly account: AccountStatusResult; readonly model_access: ModelAccessResult; }
export type OwnerUniImageGenerationPreflight = (input: Readonly<OwnerUniImageGenerationPreflightInput>) => Promise<OwnerUniImageGenerationPreflightResult>;

export interface OwnerUniImageGenerationServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string;
  readonly preparer: OwnerUniImageRequestPreparer;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly preflight: OwnerUniImageGenerationPreflight;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly pollDelayMs?: number;
  readonly maxPollAttempts?: number;
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}
export interface OwnerUniImageGenerateInput extends OwnerUniImageParametersInput { readonly attemptId: string; }
export interface OwnerUniImageReconcileInput { readonly attemptId: string; readonly recovery_id: string; }
export interface OwnerUniImageRecoveryListInput { readonly attemptId: string; readonly limit?: number; }

export const OWNER_UNI_IMAGE_GENERATION_PHASES = Object.freeze([
  "REQUEST_PREPARE", "PRINCIPAL", "ASSET_ISSUE", "CANDIDATE_PREPARE", "PREFLIGHT", "CHAT_CREATE",
  "GENERATION_POST", "POST_ACK_KNOWN", "HISTORY_GET", "HISTORY_BINDING", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"
] as const);
export const OWNER_UNI_IMAGE_GENERATION_ERROR_CODES = Object.freeze([
  "INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH", "REFERENCE_ALREADY_CLAIMED",
  "ASSET_UNAVAILABLE", "PREFLIGHT_FAILED", "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"
] as const);
export type OwnerUniImageGenerationPhase = typeof OWNER_UNI_IMAGE_GENERATION_PHASES[number];
export type OwnerUniImageGenerationResultReason = OwnerUniImageResultPendingReason | OwnerUniImageResultPartialReason | OwnerUniImageResultUnverifiedReason;
export const OWNER_UNI_IMAGE_GENERATION_HISTORY_REASONS = Object.freeze([
  "HISTORY_SHAPE_INVALID", "CHAT_SCOPE_MISMATCH", "OWNER_ACK_NOT_FOUND", "OWNER_ACK_AMBIGUOUS", "OWNER_INPUT_OBJECTS_MISMATCH",
  "HISTORY_MESSAGE_SET_INVALID", "RESULT_MESSAGE_NOT_FOUND", "RESULT_MESSAGE_AMBIGUOUS", "RESULT_OBJECTS_INVALID",
  "RESULT_OBJECTS_OVER_LIMIT", "PROFILE_BINDING_INVALID"
] as const satisfies readonly OwnerUniImageHistoryBindingReason[]);
export const OWNER_UNI_IMAGE_GENERATION_RESULT_REASONS = Object.freeze([
  "NO_RESULT_OBJECTS", "NO_COMPLETED_RESULT_OBJECTS", "OBSERVED_RESULT_OBJECTS_PARTIAL", "SOME_RESULTS_NOT_COMPLETED",
  "RESPONSE_SHAPE_INVALID", "OUTER_MESSAGE_MISMATCH", "PROVIDER_CHAT_MISMATCH", "NOT_BOT_MESSAGE",
  "RESULT_OBJECT_SHAPE_INVALID", "OBJECT_ID_MISMATCH", "OBJECT_MESSAGE_MISMATCH", "OBJECT_TYPE_MISMATCH",
  "MODEL_TYPE_UNAVAILABLE", "MODEL_TYPE_MISMATCH", "RESULT_URL_UNSAFE", "EXTRANEOUS_RESULT_OBJECTS", "DUPLICATE_RESULT_OBJECT_ID"
] as const satisfies readonly OwnerUniImageGenerationResultReason[]);
const HISTORY_REASON_EXACT: [Exclude<OwnerUniImageHistoryBindingReason, typeof OWNER_UNI_IMAGE_GENERATION_HISTORY_REASONS[number]>,
  Exclude<typeof OWNER_UNI_IMAGE_GENERATION_HISTORY_REASONS[number], OwnerUniImageHistoryBindingReason>] extends [never, never] ? true : never = true;
const RESULT_REASON_EXACT: [Exclude<OwnerUniImageGenerationResultReason, typeof OWNER_UNI_IMAGE_GENERATION_RESULT_REASONS[number]>,
  Exclude<typeof OWNER_UNI_IMAGE_GENERATION_RESULT_REASONS[number], OwnerUniImageGenerationResultReason>] extends [never, never] ? true : never = true;
void HISTORY_REASON_EXACT; void RESULT_REASON_EXACT;

export interface OwnerUniImageGenerationDiagnostic {
  readonly phase: OwnerUniImageGenerationPhase;
  readonly post_started: boolean;
  readonly echo_ack_known: boolean;
  readonly history_binding: "NONE" | "PENDING" | "READY" | "UNVERIFIED";
  readonly history_binding_reason: OwnerUniImageHistoryBindingReason | null;
  readonly history_get_calls: number;
  readonly history_get_calls_saturated: boolean;
  readonly result_get_calls: number;
  readonly result_get_calls_saturated: boolean;
  readonly result_status: "NOT_READ" | "PENDING" | "PARTIAL" | "COMPLETE" | "UNVERIFIED";
  readonly result_reason: OwnerUniImageGenerationResultReason | null;
}
export interface OwnerUniImageGenerationArtifact {
  readonly message_object_id: string;
  readonly message_id: string;
  readonly url: string;
  readonly mime_type: string | null;
  readonly mime_source: "URL_EXTENSION" | "UNKNOWN";
  readonly geometry_verified: false;
}
export interface OwnerUniImageGenerationResult {
  readonly status: "result_observed";
  readonly observation_status: InternalOwnerUniImageResult["status"];
  readonly observation_reason: OwnerUniImageGenerationResultReason | null;
  readonly namespace_confidence: "SOURCE_SHAPED_UNVERIFIED";
  readonly backend_acceptance: "UNPROVEN";
  readonly model_confidence: "PRIVATE_PROFILE_CONTEXT_NOT_PROVIDER_PROOF";
  readonly model_id: OwnerUniImageModel;
  readonly ai_name: "luma_image";
  readonly operation_id: "generate-image";
  readonly profile_id: string;
  readonly profile_schema_hash: string;
  readonly catalog_version: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly reference_count: number;
  readonly actual_result_count: number;
  readonly result_count_confidence: "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL";
  readonly recovery_id: string | null;
  readonly artifacts: readonly OwnerUniImageGenerationArtifact[];
}
export interface OwnerUniImageRecoveryListItem {
  readonly recovery_id: string;
  readonly created_at: string;
  readonly model_id: OwnerUniImageModel;
  readonly status: "OUTCOME_UNKNOWN";
  readonly diagnostic: OwnerUniImageGenerationDiagnostic;
}
export type OwnerUniImageGenerationServiceErrorCode = typeof OWNER_UNI_IMAGE_GENERATION_ERROR_CODES[number];
export class OwnerUniImageGenerationServiceError extends Error {
  readonly diagnostic: OwnerUniImageGenerationDiagnostic | undefined;
  constructor(readonly code: OwnerUniImageGenerationServiceErrorCode, readonly recovery_id?: string,
    diagnostic?: OwnerUniImageGenerationDiagnostic) {
    super(code === "OUTCOME_UNKNOWN" ? "The Uni image request may have been dispatched; reconcile with the same recovery handle and do not retry."
      : "The owner Uni image request could not be completed safely.");
    this.name = "OwnerUniImageGenerationServiceError";
    this.diagnostic = code === "OUTCOME_UNKNOWN" ? diagnostic : undefined;
  }
}
export interface OwnerUniImageGenerationServiceContract {
  generate(input: OwnerUniImageGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerUniImageGenerationResult>;
  reconcile(input: OwnerUniImageReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerUniImageGenerationResult>;
  listRecoveries(input: OwnerUniImageRecoveryListInput | unknown): Promise<readonly OwnerUniImageRecoveryListItem[]>;
  invalidateAttempt(attemptId: string): Promise<void>;
  close(): Promise<void>;
}

type MutableDiagnostic = { -readonly [K in keyof OwnerUniImageGenerationDiagnostic]: OwnerUniImageGenerationDiagnostic[K] };
interface Recovery {
  readonly recovery_id: string; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly candidate: OwnerUniImagePreparedCandidate; readonly profile: Readonly<OwnerUniImageSourceProfile>;
  readonly asset_set: OwnerUniImageOwnedAssetSet; readonly chat_uuid: string; readonly created_at: string;
  expires_at: number | null; readonly semantic_key: string; owner_echo_message_id: string | null;
  provider_chat_id: string | null; result_message_id: string | null; message_object_ids: readonly string[] | null;
  readonly diagnostic: MutableDiagnostic;
}
interface CachedResult {
  readonly result: OwnerUniImageGenerationResult;
  readonly expires_at: number;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly client: SyntxChatHttpClient;
}
interface RunRequest { readonly attemptId: string; readonly variant: OwnerUniImageModel; readonly prompt: string;
  readonly parameters: OwnerUniImageParametersInput["parameters"]; readonly image_reference_handles: readonly string[];
  readonly main_image_reference_handle: string | null; }

export class OwnerUniImageGenerationService implements OwnerUniImageGenerationServiceContract {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #catalogVersion: string;
  readonly #preparer: OwnerUniImageRequestPreparer;
  readonly #resolveChatClient: OwnerUniImageGenerationServiceOptions["resolveChatClient"];
  readonly #preflight: OwnerUniImageGenerationPreflight;
  readonly #profiles = new Map<OwnerUniImageModel, Readonly<OwnerUniImageSourceProfile>>();
  readonly #recoveries = new Map<string, Recovery>();
  readonly #unknownIntents = new Set<string>();
  readonly #reservedIntents = new Set<string>();
  readonly #successCache = new Map<string, CachedResult>();
  readonly #runs = new Set<Promise<unknown>>();
  readonly #runsByAttempt = new Map<string, Set<Promise<unknown>>>();
  readonly #controllersByAttempt = new Map<string, Set<AbortController>>();
  readonly #invalidatingAttempts = new Set<string>();
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #pollDelayMs: number;
  readonly #maxPollAttempts: number;
  readonly #wait: NonNullable<OwnerUniImageGenerationServiceOptions["wait"]>;
  #closed = false;
  #closing: Promise<void> | undefined;
  #lastNow = -1;

  constructor(optionsInput: OwnerUniImageGenerationServiceOptions | unknown) {
    const options = exactRecord(optionsInput, ["binding", "linkService", "catalog", "catalog_version", "preparer", "resolveChatClient", "preflight"],
      ["now", "timeoutMs", "pollDelayMs", "maxPollAttempts", "wait"]);
    if (!(options.catalog instanceof DiscoveryCatalogRepository) || types.isProxy(options.catalog) ||
        !(options.preparer instanceof OwnerUniImageRequestPreparer) || types.isProxy(options.preparer) ||
        Object.getPrototypeOf(options.preparer) !== OwnerUniImageRequestPreparer.prototype ||
        typeof options.resolveChatClient !== "function" || types.isProxy(options.resolveChatClient) ||
        typeof options.preflight !== "function" || types.isProxy(options.preflight) ||
        (options.now !== undefined && (typeof options.now !== "function" || types.isProxy(options.now))) ||
        (options.wait !== undefined && (typeof options.wait !== "function" || types.isProxy(options.wait)))) fail("INVALID_REQUEST");
    this.#binding = snapshotBinding(options.binding);
    this.#linkService = snapshotLinkService(options.linkService);
    this.#catalog = options.catalog;
    this.#catalogVersion = readCatalogVersion(options.catalog_version);
    this.#preparer = options.preparer;
    this.#resolveChatClient = options.resolveChatClient as OwnerUniImageGenerationServiceOptions["resolveChatClient"];
    this.#preflight = options.preflight as OwnerUniImageGenerationPreflight;
    const clock = options.now === undefined ? Date.now : readClock(options.now);
    this.#now = () => { const value = clock(); if (!Number.isSafeInteger(value) || value < 0 || value < this.#lastNow) fail("PRE_DISPATCH_FAILED"); this.#lastNow = value; return value; };
    this.#timeoutMs = boundedInt(options.timeoutMs, 1, MAX_TIMEOUT_MS, MAX_TIMEOUT_MS);
    this.#pollDelayMs = boundedInt(options.pollDelayMs, 0, MAX_POLL_DELAY_MS, DEFAULT_POLL_DELAY_MS);
    this.#maxPollAttempts = boundedInt(options.maxPollAttempts, 1, MAX_POLL_ROUNDS, MAX_POLL_ROUNDS);
    this.#wait = options.wait === undefined ? waitDelay : readWait(options.wait);
    try { for (const model of OWNER_UNI_IMAGE_MODELS) this.#profiles.set(model, getOwnerUniImageSourceProfile(model, this.#catalog, this.#catalogVersion)); }
    catch { fail("MODEL_BINDING_MISMATCH"); }
  }

  generate(input: OwnerUniImageGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerUniImageGenerationResult> {
    const request = snapshotGenerateInput(input);
    return this.#run(request.attemptId, signal, (runSignal) => this.#generate(request, runSignal));
  }

  reconcile(input: OwnerUniImageReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerUniImageGenerationResult> {
    const request = snapshotReconcileInput(input);
    return this.#run(request.attemptId, signal, (runSignal) => this.#reconcile(request, runSignal));
  }

  listRecoveries(input: OwnerUniImageRecoveryListInput | unknown): Promise<readonly OwnerUniImageRecoveryListItem[]> {
    const request = snapshotRecoveryListInput(input);
    return this.#run(request.attemptId, undefined, async (signal) => {
      const deadline = this.#deadline(signal);
      try {
        const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline.signal));
        const now = this.#readNow(); this.#pruneSuccess(now);
        return Object.freeze([...this.#recoveries.values()].filter((entry) => entry.attemptId === request.attemptId &&
          sameGenerationPrincipal(entry.principal, principal)).sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, request.limit).map((entry) => Object.freeze({ recovery_id: entry.recovery_id, created_at: entry.created_at,
            model_id: entry.candidate.model_id, status: "OUTCOME_UNKNOWN" as const, diagnostic: snapshotDiagnostic(entry.diagnostic) })));
      } finally { deadline.close(); }
    });
  }

  async invalidateAttempt(attemptId: string): Promise<void> {
    if (!isAttempt(attemptId) || this.#closed || this.#invalidatingAttempts.has(attemptId)) return;
    this.#invalidatingAttempts.add(attemptId);
    try {
      for (const controller of this.#controllersByAttempt.get(attemptId) ?? []) controller.abort();
      await Promise.allSettled([...(this.#runsByAttempt.get(attemptId) ?? [])]);
      await this.#preparer.invalidateAttempt(attemptId);
      this.#recoveries.forEach((recovery, id) => { if (recovery.attemptId === attemptId) this.#recoveries.delete(id); });
      // Unknown semantic intent holds intentionally survive attempt invalidation/relink/expiry.
    } finally { this.#invalidatingAttempts.delete(attemptId); }
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const controllers of this.#controllersByAttempt.values()) for (const controller of controllers) controller.abort();
    this.#closing = (async () => {
      await Promise.allSettled([...this.#runs]);
      await this.#preparer.close();
      this.#recoveries.clear(); this.#successCache.clear(); this.#reservedIntents.clear(); this.#unknownIntents.clear();
      this.#runsByAttempt.clear(); this.#controllersByAttempt.clear(); this.#invalidatingAttempts.clear();
    })();
    return this.#closing;
  }

  async #run<T>(attemptId: string, externalSignal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.#assertOpen();
    if (this.#invalidatingAttempts.has(attemptId) || this.#runs.size >= MAX_PENDING) fail("SERVICE_BUSY");
    const controller = new AbortController();
    const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
    const bucket = this.#controllersByAttempt.get(attemptId) ?? new Set<AbortController>(); bucket.add(controller);
    this.#controllersByAttempt.set(attemptId, bucket);
    let tracked: Promise<T>;
    tracked = Promise.resolve().then(() => operation(signal)).finally(() => {
      bucket.delete(controller); if (!bucket.size) this.#controllersByAttempt.delete(attemptId);
      const attemptRuns = this.#runsByAttempt.get(attemptId); attemptRuns?.delete(tracked); if (!attemptRuns?.size) this.#runsByAttempt.delete(attemptId);
      this.#runs.delete(tracked);
    });
    this.#runs.add(tracked); const attemptRuns = this.#runsByAttempt.get(attemptId) ?? new Set<Promise<unknown>>();
    attemptRuns.add(tracked); this.#runsByAttempt.set(attemptId, attemptRuns); return tracked;
  }

  async #generate(request: RunRequest, signal: AbortSignal): Promise<OwnerUniImageGenerationResult> {
    let semanticKey: string | undefined; let reservedByThisRun = false; let recovery: Recovery | undefined; let postStarted = false;
    const deadline = this.#deadline(signal, () => recovery ? unknownError(recovery) : generationError("PRE_DISPATCH_FAILED"));
    try {
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline.signal));
      this.#assertProfile(request.variant);
      const assetSet = await this.#await(deadline, () => this.#preparer.issue({ variant: request.variant, prompt: request.prompt,
        parameters: request.parameters, image_reference_handles: request.image_reference_handles,
        main_image_reference_handle: request.main_image_reference_handle, principal, attempt_id: request.attemptId, signal: deadline.signal }));
      const firstCandidate = await this.#prepareCandidate(request, principal, assetSet, deadline);
      const profile = this.#assertCandidate(firstCandidate, principal, request.attemptId);
      semanticKey = this.#semanticKey(principal, firstCandidate);
      this.#pruneSuccess(this.#readNow());
      if (this.#unknownIntents.has(semanticKey)) fail("REFERENCE_ALREADY_CLAIMED");
      const cached = this.#successCache.get(semanticKey);
      if (cached && cached.expires_at > this.#readNow()) {
        if (cached.attemptId !== request.attemptId || !sameGenerationPrincipal(cached.principal, principal)) {
          fail("REFERENCE_ALREADY_CLAIMED");
        }
        if (cached.client !== this.#resolveNativeClient(request.attemptId)) fail("REFERENCE_ALREADY_CLAIMED");
        return cached.result;
      }
      if (this.#reservedIntents.has(semanticKey)) fail("SERVICE_BUSY");
      if (this.#unknownIntents.size + this.#reservedIntents.size >= MAX_STATES) fail("SERVICE_BUSY");
      this.#reservedIntents.add(semanticKey); reservedByThisRun = true;
      const firstPreflight = await this.#await(deadline, () => this.#runPreflight(request, principal, firstCandidate, deadline.signal))
        .catch(() => { throw generationError("PREFLIGHT_FAILED"); });
      this.#assertPreflight(firstPreflight, firstCandidate);
      await this.#assertCurrent(request, principal, assetSet, firstCandidate, deadline);
      const native = this.#resolveNativeClient(request.attemptId);
      const chat = await this.#await(deadline, () => native.createChat("image", "owner-uni-image", deadline.signal));
      if (!SAFE_ID.test(chat.chat_uuid)) fail("PRE_DISPATCH_FAILED");
      await this.#assertCurrent(request, principal, assetSet, firstCandidate, deadline);
      const candidate = await this.#prepareCandidate(request, principal, assetSet, deadline);
      const currentProfile = this.#assertCandidate(candidate, principal, request.attemptId);
      if (!sameCandidate(firstCandidate, candidate) || currentProfile.profile_schema_hash !== profile.profile_schema_hash) fail("PRE_DISPATCH_FAILED");
      const secondPreflight = await this.#await(deadline, () => this.#runPreflight(request, principal, candidate, deadline.signal))
        .catch(() => { throw generationError("PREFLIGHT_FAILED"); });
      this.#assertPreflight(secondPreflight, candidate);
      await this.#assertCurrent(request, principal, assetSet, candidate, deadline);
      this.#assertSynchronousCurrent(request, principal, assetSet, candidate, deadline);
      if (this.#unknownIntents.size + this.#reservedIntents.size > MAX_STATES) fail("SERVICE_BUSY");
      const recoveryId = `uni_image_recovery_${randomUUID()}`;
      const now = this.#readNow();
      recovery = { recovery_id: recoveryId, attemptId: request.attemptId, principal, candidate, profile: currentProfile,
        asset_set: assetSet, chat_uuid: chat.chat_uuid, created_at: new Date(now).toISOString(),
        expires_at: Math.min(candidate.expires_at, now + TTL_MS), semantic_key: semanticKey, owner_echo_message_id: null,
        provider_chat_id: null, result_message_id: null, message_object_ids: null, diagnostic: initialDiagnostic() };
      if (recovery.expires_at === null || recovery.expires_at <= now || this.#recoveries.size >= MAX_STATES) fail("SERVICE_BUSY");
      this.#recoveries.set(recoveryId, recovery);
      const permit = createOwnerUniImageOneShotPermit({ preparer: this.#preparer, candidate, principal,
        attemptId: request.attemptId, catalog: this.#catalog, catalog_version: this.#catalogVersion, now: () => this.#readNow() });
      this.#assertSynchronousCurrent(request, principal, assetSet, candidate, deadline);
      recovery.expires_at = null;
      this.#reservedIntents.delete(semanticKey); reservedByThisRun = false;
      this.#unknownIntents.add(semanticKey);
      recovery.diagnostic.phase = "GENERATION_POST"; recovery.diagnostic.post_started = true; postStarted = true;
      const receipt = await this.#await(deadline, () => native.startUniImageWithOwnedCandidate({ preparer: this.#preparer,
        candidate, permit, principal, attemptId: request.attemptId, chat_uuid: chat.chat_uuid }, deadline.signal));
      if (!validAck(receipt, chat.chat_uuid)) fail("OUTCOME_UNKNOWN");
      recovery.owner_echo_message_id = receipt.message_id; recovery.diagnostic.echo_ack_known = true; recovery.diagnostic.phase = "POST_ACK_KNOWN";
      await this.#assertRecoveryCurrent(recovery, deadline);
      return await this.#observe(recovery, native, deadline);
    } catch (caught) {
      if (postStarted && recovery) throw unknownError(recovery);
      if (semanticKey && reservedByThisRun) this.#reservedIntents.delete(semanticKey);
      if (recovery) this.#recoveries.delete(recovery.recovery_id);
      if (caught instanceof OwnerUniImageGenerationServiceError) throw caught;
      if (caught instanceof OwnerUniImageRequestPrepareError) {
        if (caught.code === "SERVICE_BUSY" || caught.code === "CAPACITY_EXCEEDED") fail("SERVICE_BUSY");
        if (caught.code === "PRINCIPAL_NOT_LINKED") fail("PRINCIPAL_NOT_LINKED");
        if (caught.code === "PROFILE_BINDING_MISMATCH") fail("MODEL_BINDING_MISMATCH");
        fail("ASSET_UNAVAILABLE");
      }
      if (caught instanceof OwnerUniImageOneShotPolicyError) fail(caught.code === "CATALOG_BINDING_MISMATCH" ? "MODEL_BINDING_MISMATCH" : "PRE_DISPATCH_FAILED");
      if (caught instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      fail("PRE_DISPATCH_FAILED");
    } finally { deadline.close(); }
  }

  async #reconcile(request: Readonly<OwnerUniImageReconcileInput>, signal: AbortSignal): Promise<OwnerUniImageGenerationResult> {
    const deadline = this.#deadline(signal, () => { const item = this.#recoveries.get(request.recovery_id); return item ? unknownError(item) : generationError("RECOVERY_NOT_FOUND"); });
    let recovery: Recovery | undefined;
    try {
      recovery = this.#recoveries.get(request.recovery_id);
      if (!recovery || recovery.attemptId !== request.attemptId || (recovery.expires_at !== null && recovery.expires_at <= this.#readNow())) fail("RECOVERY_NOT_FOUND");
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline.signal));
      if (!sameGenerationPrincipal(principal, recovery.principal) || !recovery.owner_echo_message_id) throw unknownError(recovery);
      return await this.#observe(recovery, this.#resolveNativeClient(request.attemptId), deadline);
    } catch (caught) {
      if (caught instanceof OwnerUniImageGenerationServiceError && caught.code === "RECOVERY_NOT_FOUND") throw caught;
      if (!recovery) { if (caught instanceof OwnerUniImageGenerationServiceError) throw caught; fail("PRE_DISPATCH_FAILED"); }
      throw unknownError(recovery);
    } finally { deadline.close(); }
  }

  async #observe(recovery: Recovery, client: SyntxChatHttpClient, deadline: AbsoluteRequestDeadline): Promise<OwnerUniImageGenerationResult> {
    if (!recovery.owner_echo_message_id) throw unknownError(recovery);
    const start = this.#readNow();
    for (let round = 0; round < this.#maxPollAttempts; round += 1) {
      deadline.throwIfAborted(); if (recovery.expires_at !== null && recovery.expires_at <= this.#readNow()) throw unknownError(recovery);
      if (!recovery.result_message_id || !recovery.provider_chat_id || !recovery.message_object_ids) {
        recovery.diagnostic.phase = "HISTORY_GET"; incrementDiagnostic(recovery.diagnostic, "history");
        const snapshot = await this.#await(deadline, () => client.listMessageCandidates(recovery.chat_uuid, recovery.owner_echo_message_id!, deadline.signal));
        await this.#assertRecoveryCurrent(recovery, deadline); recovery.diagnostic.phase = "HISTORY_BINDING";
        const binding = correlateOwnerUniImageHistoryBinding({ snapshot, requested_chat_uuid: recovery.chat_uuid,
          owner_echo_message_id: recovery.owner_echo_message_id, model_id: recovery.candidate.model_id,
          expected_reference_count: recovery.candidate.reference_count, expected_reference_types: recovery.candidate.references.map(() => "image"),
          profile_binding: { profile_id: recovery.profile.profile_id, model_id: recovery.profile.model_id,
            catalog_version: recovery.profile.public_catalog_version, profile_schema_hash: recovery.profile.profile_schema_hash,
            request_fingerprint: recovery.candidate.request_fingerprint, intent_fingerprint: recovery.candidate.intent_fingerprint } });
        recovery.diagnostic.history_binding = binding.status;
        recovery.diagnostic.history_binding_reason = binding.status === "UNVERIFIED" ? binding.reason : null;
        if (binding.status === "UNVERIFIED") throw unknownError(recovery);
        if (binding.status === "READY") {
          recovery.provider_chat_id = binding.read_context.provider_chat_id; recovery.result_message_id = binding.read_context.message_id;
          recovery.message_object_ids = binding.read_context.message_object_ids;
        } else { await this.#waitNext(recovery, deadline, start, round); continue; }
      }
      recovery.diagnostic.phase = "RESULT_GET"; incrementDiagnostic(recovery.diagnostic, "result");
      const result = await this.#await(deadline, () => client.getUniImageResult({ chat_uuid: recovery.chat_uuid,
        provider_chat_id: recovery.provider_chat_id!, owner_echo_message_id: recovery.owner_echo_message_id!,
        message_id: recovery.result_message_id!, model_id: recovery.candidate.model_id, message_object_ids: recovery.message_object_ids!,
        profile_id: recovery.profile.profile_id, catalog_version: recovery.profile.public_catalog_version,
        profile_schema_hash: recovery.profile.profile_schema_hash, request_fingerprint: recovery.candidate.request_fingerprint,
        intent_fingerprint: recovery.candidate.intent_fingerprint }, deadline.signal));
      await this.#assertRecoveryCurrent(recovery, deadline); recovery.diagnostic.phase = "RESULT_BINDING";
      recovery.diagnostic.result_status = result.status;
      if (result.status === "UNVERIFIED") { recovery.diagnostic.result_reason = result.reason; throw unknownError(recovery); }
      if (result.status === "COMPLETE") {
        const output = toResult(recovery, result, null);
        this.#recoveries.delete(recovery.recovery_id); this.#unknownIntents.delete(recovery.semantic_key);
        this.#successCache.set(recovery.semantic_key, { result: output, expires_at: recovery.candidate.expires_at,
          attemptId: recovery.attemptId, principal: recovery.principal, client });
        return output;
      }
      recovery.diagnostic.result_reason = result.reason;
      const output = toResult(recovery, result, recovery.recovery_id);
      if (result.status === "PARTIAL") return output;
      await this.#waitNext(recovery, deadline, start, round);
    }
    throw unknownError(recovery);
  }

  async #waitNext(recovery: Recovery, deadline: AbsoluteRequestDeadline, startedAt: number, round: number): Promise<void> {
    const now = this.#readNow();
    if (now - startedAt >= this.#timeoutMs || (recovery.expires_at !== null && recovery.expires_at <= now)) throw unknownError(recovery);
    const delay = Math.min(this.#pollDelayMs, Math.max(0, this.#timeoutMs - (now - startedAt)),
      recovery.expires_at === null ? Number.POSITIVE_INFINITY : recovery.expires_at - now);
    if (delay <= 0) throw unknownError(recovery);
    recovery.diagnostic.phase = "RESULT_WAIT";
    await this.#await(deadline, () => this.#wait(delay, deadline.signal));
    if (round + 1 >= this.#maxPollAttempts) throw unknownError(recovery);
  }

  async #prepareCandidate(request: RunRequest, principal: Readonly<GenerationPrincipalRef>, assetSet: OwnerUniImageOwnedAssetSet,
    deadline: AbsoluteRequestDeadline): Promise<OwnerUniImagePreparedCandidate> {
    return this.#await(deadline, () => this.#preparer.prepare({ principal, attempt_id: request.attemptId, asset_set: assetSet,
      signal: deadline.signal }));
  }
  #assertCandidate(candidate: OwnerUniImagePreparedCandidate, principal: Readonly<GenerationPrincipalRef>, attemptId: string): Readonly<OwnerUniImageSourceProfile> {
    if (!this.#preparer.isPreparedCandidateForPrincipal(candidate, principal, attemptId) || candidate.dispatch_allowed !== false ||
        candidate.backend_acceptance !== "UNPROVEN" || candidate.operation_id !== OPERATION || candidate.scope !== "image" ||
        candidate.ai_name !== "luma_image" || candidate.model_type !== candidate.model_id ||
        candidate.cost_input_confidence !== "ROUTING_ONLY_NOT_QUOTE_BILLING_OR_ADMISSION" || Object.keys(candidate.cost_inputs).length !== 0 ||
        candidate.defaults_injected !== false || !SHA256.test(candidate.request_fingerprint) || !SHA256.test(candidate.intent_fingerprint)) fail("MODEL_BINDING_MISMATCH");
    const profile = this.#assertProfile(candidate.model_id);
    if (profile.profile_schema_hash !== candidate.profile_schema_hash || profile.public_catalog_version !== this.#catalogVersion ||
        candidate.source_mapping_confidence !== profile.source_binding.confidence) fail("MODEL_BINDING_MISMATCH");
    return profile;
  }
  async #assertCurrent(request: RunRequest, principal: Readonly<GenerationPrincipalRef>, assetSet: OwnerUniImageOwnedAssetSet,
    candidate: OwnerUniImagePreparedCandidate, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted();
    const current = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline.signal));
    if (!sameGenerationPrincipal(current, principal)) fail("PRINCIPAL_NOT_LINKED");
    const now = this.#readNow(); this.#assertCandidate(candidate, principal, request.attemptId);
    if (assetSet.expires_at <= now || candidate.expires_at <= now || !this.#profiles.get(candidate.model_id) || this.#closed ||
        this.#invalidatingAttempts.has(request.attemptId)) fail("ASSET_UNAVAILABLE");
  }
  #assertSynchronousCurrent(request: RunRequest, principal: Readonly<GenerationPrincipalRef>, assetSet: OwnerUniImageOwnedAssetSet,
    candidate: OwnerUniImagePreparedCandidate, deadline: AbsoluteRequestDeadline): void {
    deadline.throwIfAborted(); const now = this.#readNow();
    if (this.#closed || this.#invalidatingAttempts.has(request.attemptId) || !sameGenerationPrincipal(principal, {
      tenant_id: this.#binding.tenant_id, subject_id: this.#binding.subject, connection_id: request.attemptId }) ||
      assetSet.expires_at <= now || candidate.expires_at <= now || !this.#preparer.isPreparedCandidateForPrincipal(candidate, principal, request.attemptId)) fail("PRE_DISPATCH_FAILED");
    this.#assertCandidate(candidate, principal, request.attemptId);
  }
  async #assertRecoveryCurrent(recovery: Recovery, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted();
    const principal = await this.#await(deadline, () => this.#resolvePrincipal(recovery.attemptId, deadline.signal));
    if (!sameGenerationPrincipal(principal, recovery.principal) || this.#closed || this.#invalidatingAttempts.has(recovery.attemptId) ||
        (recovery.expires_at !== null && recovery.expires_at <= this.#readNow()) ||
        this.#recoveries.get(recovery.recovery_id) !== recovery || !this.#unknownIntents.has(recovery.semantic_key) ||
        !isCapturedRecoveryCandidate(recovery)) throw unknownError(recovery);
    const profile = this.#assertProfile(recovery.candidate.model_id);
    if (profile.profile_schema_hash !== recovery.profile.profile_schema_hash ||
        profile.profile_id !== recovery.profile.profile_id || profile.public_catalog_version !== recovery.profile.public_catalog_version) {
      throw unknownError(recovery);
    }
  }
  async #runPreflight(request: RunRequest, principal: Readonly<GenerationPrincipalRef>, candidate: OwnerUniImagePreparedCandidate,
    signal: AbortSignal): Promise<OwnerUniImageGenerationPreflightResult> {
    return this.#preflight(Object.freeze({ attemptId: request.attemptId, principal, model_id: candidate.model_id,
      catalog_version: this.#catalogVersion, cost_inputs: Object.freeze({}), request_fingerprint: candidate.request_fingerprint, signal }));
  }
  #assertPreflight(input: OwnerUniImageGenerationPreflightResult, candidate: OwnerUniImagePreparedCandidate): void {
    let top: Record<string, unknown>; let account: Record<string, unknown>; let access: Record<string, unknown>;
    try {
      top = exactRecord(input, ["account", "model_access"]);
      account = exactRecord(top.account, ["balance", "subscription", "contract_evidence", "source_build", "observed_at"]);
      exactRecord(account.balance, ["unit", "available"]);
      const subscription = exactRecord(account.subscription, ["active", "plan_type", "end_date", "end_date_kind"]);
      access = exactRecord(top.model_access, ["catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live",
        "parameter_keys", "parameters_redacted", "access", "cost", "discount_cost", "free_remaining_generations", "limit", "show_warning", "observed_at"]);
      const balance = account.balance as Record<string, unknown>; const now = this.#readNow();
      if (account.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || account.source_build !== ACCOUNT_SOURCE_BUILD ||
          balance.unit !== "tokens" || !(balance.available === null || typeof balance.available === "string") ||
          !validSubscription(subscription, now) || !isFreshIso(account.observed_at, now) ||
          access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || access.catalog_version !== currentCatalogVersion(this.#catalog) ||
          access.model_id !== candidate.model_id || access.ai_name !== "luma_image" || access.model_type !== candidate.model_id ||
          access.account_read_live !== true || access.access !== true || access.parameters_redacted !== true ||
          !sameStringArray(access.parameter_keys, []) || !isFreshIso(access.observed_at, now) ||
          !(access.cost === null || finiteNonnegative(access.cost)) || !(access.discount_cost === null || finiteNonnegative(access.discount_cost)) ||
          !(access.free_remaining_generations === null || nonnegativeInteger(access.free_remaining_generations)) ||
          !(access.limit === null || finiteNonnegative(access.limit)) || !(access.show_warning === null || typeof access.show_warning === "boolean")) fail("PREFLIGHT_FAILED");
      const model = this.#catalog.getModel(candidate.model_id);
      if (!model.active || model.id !== candidate.model_id || model.upstream_id !== candidate.model_id || model.ai_name !== "luma_image" ||
          model.scope !== "image" || !model.modalities.includes("image") ||
          !model.operations.some((operation) => operation.id === OPERATION && operation.output_modality === "image")) fail("PREFLIGHT_FAILED");
    } catch (caught) { if (caught instanceof OwnerUniImageGenerationServiceError) throw caught; fail("PREFLIGHT_FAILED"); }
  }
  #resolveNativeClient(attemptId: string): SyntxChatHttpClient {
    const client = this.#resolveChatClient(attemptId);
    if (!(client instanceof SyntxChatHttpClient) || types.isProxy(client) || Object.getPrototypeOf(client) !== SyntxChatHttpClient.prototype ||
        client.createChat !== NATIVE.createChat || client.startUniImageWithOwnedCandidate !== NATIVE.start ||
        client.listMessageCandidates !== NATIVE.history || client.getUniImageResult !== NATIVE.result) fail("MODEL_BINDING_MISMATCH");
    return client;
  }
  async #resolvePrincipal(attemptId: string, signal: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    this.#assertOpen(); if (this.#invalidatingAttempts.has(attemptId)) fail("PRINCIPAL_NOT_LINKED");
    try { return await this.#awaitSignal(resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService }), signal); }
    catch (caught) { if (caught instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED"); throw caught; }
  }
  #assertProfile(model: OwnerUniImageModel): Readonly<OwnerUniImageSourceProfile> {
    let profile: Readonly<OwnerUniImageSourceProfile>;
    try { profile = getOwnerUniImageSourceProfile(model, this.#catalog, this.#catalogVersion); }
    catch { fail("MODEL_BINDING_MISMATCH"); }
    const original = this.#profiles.get(model);
    if (!original || profile.profile_schema_hash !== original.profile_schema_hash || profile.public_catalog_version !== this.#catalogVersion) fail("MODEL_BINDING_MISMATCH");
    return profile;
  }
  #semanticKey(principal: Readonly<GenerationPrincipalRef>, candidate: OwnerUniImagePreparedCandidate): string {
    return createHash("sha256").update(JSON.stringify([principal.tenant_id, principal.subject_id, candidate.model_id, candidate.intent_fingerprint])).digest("hex");
  }
  #pruneSuccess(now: number): void { for (const [key, entry] of this.#successCache) if (entry.expires_at <= now) this.#successCache.delete(key); }
  #deadline(signal: AbortSignal, makeError?: () => Error): AbsoluteRequestDeadline {
    return new AbsoluteRequestDeadline(this.#timeoutMs, signal, () => makeError?.() ?? generationError("PRE_DISPATCH_FAILED"));
  }
  async #await<T>(deadline: AbsoluteRequestDeadline, operation: () => Promise<T> | T): Promise<T> {
    deadline.throwIfAborted(); let pending: Promise<T>; try { pending = Promise.resolve(operation()); } catch (error) { throw error; }
    return deadline.waitFor(pending);
  }
  async #awaitSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw new Error("ABORTED");
    return new Promise<T>((resolve, reject) => { const abort = () => reject(new Error("ABORTED"));
      signal.addEventListener("abort", abort, { once: true }); promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort)); });
  }
  #readNow(): number { let value: unknown; try { value = this.#now(); } catch { fail("PRE_DISPATCH_FAILED"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) < this.#lastNow) fail("PRE_DISPATCH_FAILED");
    this.#lastNow = value as number; return value as number; }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
}

export function createOwnerUniImageGenerationService(options: OwnerUniImageGenerationServiceOptions | unknown): OwnerUniImageGenerationService {
  return new OwnerUniImageGenerationService(options);
}

function snapshotGenerateInput(value: unknown): RunRequest {
  const fields = exactRecord(value, ["attemptId", "variant", "prompt", "parameters", "image_reference_handles", "main_image_reference_handle"]);
  if (!isAttempt(fields.attemptId) || !isUniModel(fields.variant) || typeof fields.prompt !== "string") fail("INVALID_REQUEST");
  const handles = denseStringArray(fields.image_reference_handles, 9);
  if (handles.some((handle) => !/^uni_image_[0-9a-f-]{36}$/u.test(handle)) || new Set(handles).size !== handles.length ||
      !(fields.main_image_reference_handle === null || typeof fields.main_image_reference_handle === "string")) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, variant: fields.variant, prompt: fields.prompt,
    parameters: fields.parameters as OwnerUniImageParametersInput["parameters"], image_reference_handles: Object.freeze(handles),
    main_image_reference_handle: fields.main_image_reference_handle as string | null });
}
function snapshotReconcileInput(value: unknown): Readonly<OwnerUniImageReconcileInput> {
  const fields = exactRecord(value, ["attemptId", "recovery_id"]);
  if (!isAttempt(fields.attemptId) || typeof fields.recovery_id !== "string" || !RECOVERY.test(fields.recovery_id)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, recovery_id: fields.recovery_id });
}
function snapshotRecoveryListInput(value: unknown): Readonly<{ attemptId: string; limit: number }> {
  const fields = exactRecord(value, ["attemptId"], ["limit"]); if (!isAttempt(fields.attemptId)) fail("INVALID_REQUEST");
  const limit = fields.limit ?? 20; if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, limit });
}
function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || !fields.tenant_id || fields.tenant_id.length > 256 || /[\u0000-\u001f\u007f]/u.test(fields.tenant_id) ||
      typeof fields.subject !== "string" || !fields.subject || fields.subject.length > 512 || /[\u0000-\u001f\u007f]/u.test(fields.subject)) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}
function snapshotLinkService(value: unknown): Pick<PerUserLinkService, "getStatus"> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const method = getDataMethod(value, "getStatus"); if (typeof method !== "function" || types.isProxy(method)) fail("INVALID_REQUEST");
  return Object.freeze({ getStatus: (binding: AuthBinding, attemptId: string) => Reflect.apply(method, value, [binding, attemptId]) }) as Pick<PerUserLinkService, "getStatus">;
}
function readCatalogVersion(value: unknown): string { if (value !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION) fail("MODEL_BINDING_MISMATCH"); return value; }
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  let prototype: object | null; let descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); } catch { fail("INVALID_REQUEST"); }
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
  const keys = Reflect.ownKeys(descriptors); const allowed = [...required, ...optional];
  if (required.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) => typeof key !== "string" || !allowed.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const output = Object.create(null) as Record<string, unknown>; for (const key of keys as string[]) output[key] = descriptors[key]!.value; return output;
}
function denseStringArray(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value); const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) ||
      Number(key) >= value.length || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) fail("INVALID_REQUEST");
  const values = Array.from({ length: value.length }, (_, index) => descriptors[String(index)]!.value);
  if (values.some((entry) => typeof entry !== "string")) fail("INVALID_REQUEST"); return values as string[];
}
function boundedInt(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (value === undefined) return fallback; if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail("INVALID_REQUEST"); return value;
}
function readClock(value: unknown): () => number { if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST"); return value as () => number; }
function readWait(value: unknown): NonNullable<OwnerUniImageGenerationServiceOptions["wait"]> {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST"); return value as NonNullable<OwnerUniImageGenerationServiceOptions["wait"]>;
}
function waitDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => { const timer = setTimeout(() => { cleanup(); resolve(); }, milliseconds);
    const abort = () => { clearTimeout(timer); cleanup(); reject(new Error("ABORTED")); };
    const cleanup = () => signal.removeEventListener("abort", abort); if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true }); });
}
function validAck(value: unknown, chatUuid: string): value is MediaGenerationReceipt {
  try { const fields = exactRecord(value, ["chat_uuid", "message_id"]); return fields.chat_uuid === chatUuid && isSafeId(fields.message_id); } catch { return false; }
}
function validSubscription(value: Record<string, unknown>, now: number): boolean {
  if (value.active !== true || !(value.plan_type === null || typeof value.plan_type === "string")) return false;
  if (value.end_date === null) return value.end_date_kind === null;
  if (typeof value.end_date !== "string" || value.end_date_kind !== "OFFSET_DATETIME" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value.end_date)) return false;
  const expiry = Date.parse(value.end_date); return Number.isFinite(expiry) && expiry > now;
}
function isFreshIso(value: unknown, now: number): boolean {
  if (typeof value !== "string") return false; const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= MAX_CLOCK_SKEW_MS && new Date(timestamp).toISOString() === value;
}
function finiteNonnegative(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function nonnegativeInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function sameStringArray(value: unknown, expected: readonly string[]): boolean {
  try { const entries = denseStringArray(value, expected.length); return entries.length === expected.length && entries.every((entry, index) => entry === expected[index]); }
  catch { return false; }
}
function currentCatalogVersion(catalog: DiscoveryCatalogRepository): string { return `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`; }
function isAttempt(value: unknown): value is string { return typeof value === "string" && ATTEMPT.test(value); }
function isUniModel(value: unknown): value is OwnerUniImageModel { return typeof value === "string" && OWNER_UNI_IMAGE_MODELS.includes(value as OwnerUniImageModel); }
function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function getDataMethod(target: object, name: string): unknown {
  let current: object | null = target; while (current) { const descriptor = Object.getOwnPropertyDescriptor(current, name);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined; current = Object.getPrototypeOf(current) as object | null; } return undefined;
}
function sameCandidate(a: OwnerUniImagePreparedCandidate, b: OwnerUniImagePreparedCandidate): boolean {
  return a.request_fingerprint === b.request_fingerprint && a.intent_fingerprint === b.intent_fingerprint &&
    a.model_id === b.model_id && isDeepStrictEqual(a.parameters, b.parameters) && isDeepStrictEqual(a.request, b.request) &&
    isDeepStrictEqual(a.references, b.references) && isDeepStrictEqual(a.cost_inputs, b.cost_inputs);
}
function isCapturedRecoveryCandidate(recovery: Recovery): boolean {
  const candidate = recovery.candidate; const assetSet = recovery.asset_set;
  return Object.isFrozen(candidate) && Object.isFrozen(assetSet) && candidate.status === "blocked" &&
    candidate.dispatch_allowed === false && candidate.backend_acceptance === "UNPROVEN" && candidate.ai_name === "luma_image" &&
    candidate.model_type === candidate.model_id && candidate.scope === "image" && candidate.operation_id === OPERATION &&
    candidate.defaults_injected === false && candidate.cost_input_confidence === "ROUTING_ONLY_NOT_QUOTE_BILLING_OR_ADMISSION" &&
    Object.keys(candidate.cost_inputs).length === 0 && SHA256.test(candidate.request_fingerprint) && SHA256.test(candidate.intent_fingerprint) &&
    Number.isSafeInteger(candidate.expires_at) && candidate.expires_at > 0 &&
    assetSet.status === "nominal" && assetSet.model_id === candidate.model_id && assetSet.expires_at === candidate.expires_at &&
    assetSet.reference_count === candidate.reference_count && candidate.reference_count === candidate.references.length &&
    isDeepStrictEqual(candidate.references, assetSet.references) &&
    candidate.profile_id === recovery.profile.profile_id && candidate.profile_schema_hash === recovery.profile.profile_schema_hash &&
    assetSet.catalog_version === recovery.profile.public_catalog_version && assetSet.profile_schema_hash === recovery.profile.profile_schema_hash &&
    candidate.source_mapping_confidence === recovery.profile.source_binding.confidence &&
    isDeepStrictEqual(candidate.source_binding, recovery.profile.source_binding);
}
function initialDiagnostic(): MutableDiagnostic { return { phase: "REQUEST_PREPARE", post_started: false, echo_ack_known: false,
  history_binding: "NONE", history_binding_reason: null, history_get_calls: 0, history_get_calls_saturated: false,
  result_get_calls: 0, result_get_calls_saturated: false, result_status: "NOT_READ", result_reason: null }; }
function incrementDiagnostic(diagnostic: MutableDiagnostic, kind: "history" | "result"): void {
  const key = kind === "history" ? "history_get_calls" : "result_get_calls";
  const saturated = kind === "history" ? "history_get_calls_saturated" : "result_get_calls_saturated";
  if (diagnostic[key] >= MAX_DIAGNOSTIC_COUNT) { diagnostic[saturated] = true; return; } diagnostic[key] += 1;
}
function snapshotDiagnostic(value: MutableDiagnostic): OwnerUniImageGenerationDiagnostic { return Object.freeze({ ...value }); }
function toResult(recovery: Recovery, result: InternalOwnerUniImageResult, recoveryId: string | null): OwnerUniImageGenerationResult {
  return Object.freeze({ status: "result_observed", observation_status: result.status, observation_reason: "reason" in result ? result.reason : null,
    namespace_confidence: "SOURCE_SHAPED_UNVERIFIED", backend_acceptance: "UNPROVEN", model_confidence: "PRIVATE_PROFILE_CONTEXT_NOT_PROVIDER_PROOF",
    model_id: recovery.candidate.model_id, ai_name: "luma_image", operation_id: OPERATION, profile_id: recovery.profile.profile_id,
    profile_schema_hash: recovery.profile.profile_schema_hash, catalog_version: recovery.profile.public_catalog_version,
    request_fingerprint: recovery.candidate.request_fingerprint, intent_fingerprint: recovery.candidate.intent_fingerprint,
    reference_count: recovery.candidate.reference_count, actual_result_count: result.actual_result_count,
    result_count_confidence: result.result_count_confidence, recovery_id: recoveryId,
    artifacts: Object.freeze(result.artifacts.map((artifact) => Object.freeze({ message_object_id: artifact.message_object_id,
      message_id: artifact.message_id, url: artifact.url, mime_type: artifact.mime_type, mime_source: artifact.mime_source, geometry_verified: false as const }))) });
}
function unknownError(recovery: Recovery): OwnerUniImageGenerationServiceError {
  return generationError("OUTCOME_UNKNOWN", recovery.recovery_id, snapshotDiagnostic(recovery.diagnostic));
}
function generationError(code: OwnerUniImageGenerationServiceErrorCode, recoveryId?: string, diagnostic?: OwnerUniImageGenerationDiagnostic): OwnerUniImageGenerationServiceError {
  return new OwnerUniImageGenerationServiceError(code, recoveryId, diagnostic);
}
function fail(code: OwnerUniImageGenerationServiceErrorCode): never { throw generationError(code); }
