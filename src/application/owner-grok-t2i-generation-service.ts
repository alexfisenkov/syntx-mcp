import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { SyntxChatHttpClient, type GrokT2iImageBatchPendingReason, type GrokT2iImageBatchUnverifiedReason, type InternalGrokT2iImageBatchResult } from "../adapter/syntx/chat-http-client.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { correlateOwnerGrokT2iHistoryBinding, type OwnerGrokT2iHistoryBindingReason } from "./owner-grok-t2i-history-binding.js";
import { OwnerGrokT2iImageUploadService } from "./owner-grok-t2i-image-upload-service.js";
import { OWNER_GROK_T2I_MODELS, normalizeOwnerGrokT2iParameters, type OwnerGrokT2iModel } from "./owner-grok-t2i-parameters.js";
import { getOwnerGrokT2iSourceProfile, type OwnerGrokT2iSourceProfile } from "./owner-grok-t2i-source-profile.js";
import { OwnerGrokT2iRequestPreparer, type OwnerGrokT2iOwnedAssetSet, type OwnerGrokT2iPreparedCandidate } from "./owner-grok-t2i-request-preparer.js";
import { createOwnerGrokT2iOneShotPermit, OwnerGrokT2iOneShotPolicyError } from "./owner-grok-t2i-one-shot-policy.js";
import type { AccountStatusResult } from "./account-status.js";
import type { ModelAccessResult } from "./model-access.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY = /^grok_t2i_recovery_[0-9a-f-]{36}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const TTL = 15 * 60_000;
const MAX_PENDING = 4;
const MAX_HOLDS = 128;
const MAX_POLLS = 32;
const MAX_TIMEOUT = 180_000;
const MAX_DELAY = 40_000;
const NATIVE = Object.freeze({
  createChat: SyntxChatHttpClient.prototype.createChat,
  post: SyntxChatHttpClient.prototype.startGrokT2iImageWithOwnedCandidate,
  history: SyntxChatHttpClient.prototype.listMessageCandidates,
  result: SyntxChatHttpClient.prototype.getGrokT2iBatchMessage
});

export interface OwnerGrokT2iGenerationPreflightInput {
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: OwnerGrokT2iModel;
  readonly cost_inputs: Readonly<Record<string, string | number>>;
  readonly request_fingerprint: string;
  readonly catalog_version: string;
  readonly signal?: AbortSignal;
}
export interface OwnerGrokT2iGenerationPreflightResult {
  readonly account: AccountStatusResult;
  readonly model_access: ModelAccessResult;
}
export type OwnerGrokT2iGenerationPreflight = (input: Readonly<OwnerGrokT2iGenerationPreflightInput>) => Promise<OwnerGrokT2iGenerationPreflightResult>;

export interface OwnerGrokT2iGenerationServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string;
  readonly imageUploadService: OwnerGrokT2iImageUploadService;
  readonly preparer: OwnerGrokT2iRequestPreparer;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly preflight: OwnerGrokT2iGenerationPreflight;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly pollDelayMs?: number;
  readonly maxPollAttempts?: number;
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}
export interface OwnerGrokT2iGenerateInput {
  readonly attemptId: string;
  readonly model_id: OwnerGrokT2iModel;
  readonly parameters: unknown;
  readonly prompt: string;
  readonly reference_handles: readonly string[];
}
export interface OwnerGrokT2iReconcileInput { readonly attemptId: string; readonly recovery_id: string }
export interface OwnerGrokT2iRecoveryListInput { readonly attemptId: string; readonly limit?: number }
export const OWNER_GROK_T2I_GENERATION_PHASES = Object.freeze(["REQUEST_PREPARE", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST",
  "POST_ACK_KNOWN", "HISTORY_GET", "HISTORY_BINDING", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"] as const);
export type OwnerGrokT2iHistoryDiagnosticReason = OwnerGrokT2iHistoryBindingReason | "OUTPUT_BATCH_PARTIAL";
export const OWNER_GROK_T2I_HISTORY_REASONS = Object.freeze(["INVALID_INPUT", "HISTORY_SHAPE_INVALID", "HISTORY_INCOMPLETE", "HISTORY_PAGE_INVALID",
  "CHAT_SCOPE_MISMATCH", "PROVIDER_CHAT_INVALID", "HISTORY_EMPTY", "HISTORY_MESSAGE_SET_INVALID", "MESSAGE_ID_INVALID", "MESSAGE_ID_DUPLICATE",
  "MESSAGE_CHAT_MISMATCH", "OBJECT_ID_INVALID", "OBJECT_ID_DUPLICATE", "OWNER_ACK_NOT_FOUND", "OWNER_ACK_MISMATCH", "OWNER_ACK_AMBIGUOUS",
  "OWNER_REFERENCE_SET_MISMATCH", "BOT_MESSAGE_NOT_FOUND", "BOT_MESSAGE_AMBIGUOUS", "BOT_MESSAGE_BEFORE_ACK", "BOT_OUTPUT_COUNT_INVALID",
  "BOT_OUTPUT_NAMESPACE_UNVERIFIED", "OUTPUT_BATCH_PARTIAL"] as const satisfies readonly OwnerGrokT2iHistoryDiagnosticReason[]);
type MissingHistoryReason = Exclude<OwnerGrokT2iHistoryDiagnosticReason, typeof OWNER_GROK_T2I_HISTORY_REASONS[number]>;
const HISTORY_REASONS_COMPLETE: MissingHistoryReason extends never ? true : false = true;
void HISTORY_REASONS_COMPLETE;
export const OWNER_GROK_T2I_RESULT_REASONS = Object.freeze(["NO_IMAGE_OBJECTS", "RESULT_OBJECTS_PENDING", "RESPONSE_SHAPE_INVALID",
  "OUTER_MESSAGE_MISMATCH", "PROVIDER_CHAT_MISMATCH", "NOT_BOT_MESSAGE", "OUTPUT_COUNT_INVALID", "RESULT_OBJECT_SHAPE_INVALID",
  "OBJECT_ID_MISMATCH", "OBJECT_MESSAGE_MISMATCH", "OBJECT_TYPE_MISMATCH", "MODEL_TYPE_UNAVAILABLE", "MODEL_TYPE_MISMATCH",
  "RESULT_URL_UNSAFE", "RESULT_MIME_UNKNOWN", "RESULT_OBJECT_DUPLICATE", "OUTPUT_BATCH_PARTIAL"] as const satisfies readonly (GrokT2iImageBatchPendingReason | GrokT2iImageBatchUnverifiedReason | "OUTPUT_BATCH_PARTIAL")[]);
type GrokResultReason = GrokT2iImageBatchPendingReason | GrokT2iImageBatchUnverifiedReason | "OUTPUT_BATCH_PARTIAL";
type MissingGrokResultReason = Exclude<GrokResultReason, typeof OWNER_GROK_T2I_RESULT_REASONS[number]>;
const RESULT_REASONS_COMPLETE: MissingGrokResultReason extends never ? true : false = true;
void RESULT_REASONS_COMPLETE;
export type OwnerGrokT2iGenerationPhase = typeof OWNER_GROK_T2I_GENERATION_PHASES[number];
export interface OwnerGrokT2iUnknownDiagnostic {
  readonly phase: OwnerGrokT2iGenerationPhase;
  readonly post_started: boolean;
  readonly echo_ack_known: boolean;
  readonly history_status: "NONE" | "PENDING" | "READY" | "PARTIAL" | "UNVERIFIED" | "INVALID";
  readonly history_reason: OwnerGrokT2iHistoryDiagnosticReason | null;
  readonly result_status: "NOT_READ" | "PENDING" | "PARTIAL" | "COMPLETE" | "UNVERIFIED";
  readonly result_reason: GrokResultReason | null;
  readonly history_get_calls: number;
  readonly history_get_calls_saturated: boolean;
  readonly result_get_calls: number;
  readonly result_get_calls_saturated: boolean;
}
export interface OwnerGrokT2iGenerationResult {
  readonly status: "result_observed";
  readonly backend_acceptance: "UNPROVEN";
  readonly namespace_confidence: "SOURCE_SHAPED_UNVERIFIED";
  readonly ai_name: "grok_image";
  readonly model_id: OwnerGrokT2iModel;
  readonly operation_id: "generate-image";
  readonly profile_id: string;
  readonly profile_schema_hash: string;
  readonly catalog_version: string;
  readonly request_fingerprint: string;
  readonly parameters: OwnerGrokT2iPreparedCandidate["parameters"];
  readonly reference_count: number;
  readonly artifacts: readonly Readonly<{ message_object_id: string; url: string; mime_type: string; width: null; height: null; geometry_verified: false }>[];
}
export interface OwnerGrokT2iRecoveryListItem {
  readonly recovery_id: string;
  readonly created_at: string;
  readonly model_id: OwnerGrokT2iModel;
  readonly operation_id: "generate-image";
  readonly status: "OUTCOME_UNKNOWN";
  readonly diagnostic: OwnerGrokT2iUnknownDiagnostic;
}
export type OwnerGrokT2iGenerationServiceErrorCode =
  | "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "MODEL_BINDING_MISMATCH" | "PRINCIPAL_NOT_LINKED"
  | "PREFLIGHT_FAILED" | "INTENT_ALREADY_CLAIMED" | "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND";
const GENERATION_ERROR_CODE_VALUES = ["INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "MODEL_BINDING_MISMATCH",
  "PRINCIPAL_NOT_LINKED", "PREFLIGHT_FAILED", "INTENT_ALREADY_CLAIMED", "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"] as const;
const GENERATION_ERROR_CODE_VALUES_VALID: readonly OwnerGrokT2iGenerationServiceErrorCode[] = GENERATION_ERROR_CODE_VALUES;
void GENERATION_ERROR_CODE_VALUES_VALID;
export const OWNER_GROK_T2I_GENERATION_ERROR_CODES = Object.freeze(GENERATION_ERROR_CODE_VALUES);
type MissingOwnerGrokT2iGenerationErrorCode = Exclude<OwnerGrokT2iGenerationServiceErrorCode, typeof GENERATION_ERROR_CODE_VALUES[number]>;
const OWNER_GROK_T2I_GENERATION_ERROR_CODES_COMPLETE: MissingOwnerGrokT2iGenerationErrorCode extends never ? true : false = true;
void OWNER_GROK_T2I_GENERATION_ERROR_CODES_COMPLETE;
export class OwnerGrokT2iGenerationServiceError extends Error {
  readonly diagnostic: OwnerGrokT2iUnknownDiagnostic | undefined;
  constructor(readonly code: OwnerGrokT2iGenerationServiceErrorCode, readonly recovery_id?: string, diagnostic?: OwnerGrokT2iUnknownDiagnostic) {
    super(code === "OUTCOME_UNKNOWN" ? "The Grok T2I request may have been dispatched; reconcile without retrying." :
      "The owner Grok T2I request could not be completed safely.");
    this.name = "OwnerGrokT2iGenerationServiceError";
    this.diagnostic = code === "OUTCOME_UNKNOWN" && diagnostic ? diagnostic : undefined;
  }
}

interface PostDispatchWitness {
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: OwnerGrokT2iModel;
  readonly profile_schema_hash: string;
  readonly catalog_version: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly intent_key: string;
  readonly chat_uuid: string;
  readonly input_expires_at: number;
}
interface Recovery {
  readonly recovery_id: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: OwnerGrokT2iModel;
  readonly candidate: OwnerGrokT2iPreparedCandidate;
  readonly asset_set: OwnerGrokT2iOwnedAssetSet;
  readonly profile: Readonly<OwnerGrokT2iSourceProfile>;
  readonly intent_key: string;
  readonly chat_uuid: string;
  readonly created_at: string;
  expires_at: number | null;
  readonly source_expires_at: number;
  post_dispatch_witness: PostDispatchWitness | null;
  owner_echo_message_id: string | null;
  provider_chat_id: string | null;
  result_message_id: string | null;
  object_ids: readonly string[] | null;
  readonly diagnostic: MutableDiagnostic;
}
interface Claim { readonly intent_key: string; readonly created_at: number; state: "PREPARING" | "POST_STARTED" | "OUTCOME_UNKNOWN" }
interface Completed { readonly result: OwnerGrokT2iGenerationResult; readonly expires_at: number }
interface CachedAssetSet { readonly asset_set: OwnerGrokT2iOwnedAssetSet; readonly expires_at: number; readonly attemptId: string }
type MutableDiagnostic = { -readonly [K in keyof OwnerGrokT2iUnknownDiagnostic]: OwnerGrokT2iUnknownDiagnostic[K] };

/** Full-four owner-only lifecycle. Provider acceptance, billing, and restart durability remain unproven. */
export class OwnerGrokT2iGenerationService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #catalogVersion: string;
  readonly #upload: OwnerGrokT2iImageUploadService;
  readonly #preparer: OwnerGrokT2iRequestPreparer;
  readonly #resolveChatClient: OwnerGrokT2iGenerationServiceOptions["resolveChatClient"];
  readonly #preflight: OwnerGrokT2iGenerationPreflight;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #pollDelayMs: number;
  readonly #maxPollAttempts: number;
  readonly #wait: NonNullable<OwnerGrokT2iGenerationServiceOptions["wait"]>;
  readonly #profiles = new Map<OwnerGrokT2iModel, Readonly<OwnerGrokT2iSourceProfile>>();
  readonly #claims = new Map<string, Claim>();
  readonly #recoveries = new Map<string, Recovery>();
  readonly #completed = new Map<string, Completed>();
  readonly #assetSets = new Map<string, CachedAssetSet>();
  readonly #assetSetPending = new Map<string, Promise<OwnerGrokT2iOwnedAssetSet>>();
  readonly #runs = new Set<Promise<unknown>>();
  readonly #runsByAttempt = new Map<string, Set<Promise<unknown>>>();
  readonly #controllers = new Map<string, Set<AbortController>>();
  readonly #epochs = new Map<string, number>();
  readonly #invalidatingAttempts = new Set<string>();
  readonly #invalidations = new Set<Promise<void>>();
  readonly #invalidationByAttempt = new Map<string, Promise<void>>();
  #closed = false;
  #closing: Promise<void> | undefined;
  #lastNow: number | undefined;

  constructor(options: OwnerGrokT2iGenerationServiceOptions) {
    const fields = exact(options, ["binding", "linkService", "catalog", "catalog_version", "imageUploadService", "preparer", "resolveChatClient", "preflight"],
      ["now", "timeoutMs", "pollDelayMs", "maxPollAttempts", "wait"]);
    if (types.isProxy(fields.catalog) || !(fields.catalog instanceof DiscoveryCatalogRepository) ||
        types.isProxy(fields.imageUploadService) || !(fields.imageUploadService instanceof OwnerGrokT2iImageUploadService) ||
        types.isProxy(fields.preparer) || !(fields.preparer instanceof OwnerGrokT2iRequestPreparer) ||
        Object.getPrototypeOf(fields.preparer) !== OwnerGrokT2iRequestPreparer.prototype ||
        typeof fields.resolveChatClient !== "function" || types.isProxy(fields.resolveChatClient) ||
        typeof fields.preflight !== "function" || types.isProxy(fields.preflight) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now))) ||
        (fields.wait !== undefined && (typeof fields.wait !== "function" || types.isProxy(fields.wait)))) fail("INVALID_REQUEST");
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = snapshotLinkService(fields.linkService);
    this.#catalog = fields.catalog as DiscoveryCatalogRepository;
    this.#catalogVersion = readCatalogVersion(fields.catalog_version);
    this.#upload = fields.imageUploadService as OwnerGrokT2iImageUploadService;
    this.#preparer = fields.preparer as OwnerGrokT2iRequestPreparer;
    this.#resolveChatClient = fields.resolveChatClient as OwnerGrokT2iGenerationServiceOptions["resolveChatClient"];
    this.#preflight = fields.preflight as OwnerGrokT2iGenerationPreflight;
    this.#now = (fields.now as (() => number) | undefined) ?? Date.now;
    this.#timeoutMs = bounded(fields.timeoutMs, 1, MAX_TIMEOUT, MAX_TIMEOUT);
    this.#pollDelayMs = bounded(fields.pollDelayMs, 0, MAX_DELAY, 2_000);
    this.#maxPollAttempts = bounded(fields.maxPollAttempts, 1, MAX_POLLS, MAX_POLLS);
    this.#wait = (fields.wait as OwnerGrokT2iGenerationServiceOptions["wait"] | undefined) ?? waitDelay;
    for (const model of OWNER_GROK_T2I_MODELS) this.#profiles.set(model, getOwnerGrokT2iSourceProfile(model, this.#catalog, this.#catalogVersion));
  }

  generate(input: OwnerGrokT2iGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerGrokT2iGenerationResult> {
    const request = snapshotGenerate(input);
    return this.#run(request.attemptId, signal, (requestSignal) => this.#generate(request, requestSignal));
  }
  reconcile(input: OwnerGrokT2iReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerGrokT2iGenerationResult> {
    const request = snapshotReconcile(input);
    return this.#run(request.attemptId, signal, (requestSignal) => this.#reconcile(request, requestSignal));
  }
  listRecoveries(input: OwnerGrokT2iRecoveryListInput | unknown): Promise<readonly OwnerGrokT2iRecoveryListItem[]> {
    const request = snapshotRecoveryList(input);
    return this.#run(request.attemptId, undefined, async (signal) => {
      const deadline = this.#deadline(signal);
      try {
        const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
        this.#prune();
        return Object.freeze([...this.#recoveries.values()].filter((item) => item.attemptId === request.attemptId &&
          sameGenerationPrincipal(item.principal, principal)).sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, request.limit).map((item) => Object.freeze({ recovery_id: item.recovery_id, created_at: item.created_at,
            model_id: item.model_id, operation_id: "generate-image" as const, status: "OUTCOME_UNKNOWN" as const,
            diagnostic: snapshotDiagnostic(item.diagnostic) })));
      } finally { deadline.close(); }
    });
  }
  async invalidateAttempt(attemptId: string): Promise<void> {
    if (!ATTEMPT.test(attemptId)) return;
    const existing = this.#invalidationByAttempt.get(attemptId);
    if (existing) return existing;
    this.#invalidatingAttempts.add(attemptId);
    let invalidation!: Promise<void>;
    invalidation = (async () => {
      try {
        this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
        for (const controller of this.#controllers.get(attemptId) ?? []) controller.abort();
        await Promise.allSettled([...(this.#runsByAttempt.get(attemptId) ?? [])]);
        await this.#preparer.invalidateAttempt(attemptId);
        await this.#upload.invalidateAttempt(attemptId);
        for (const [key, item] of this.#assetSets) if (item.attemptId === attemptId) this.#assetSets.delete(key);
        for (const [id, item] of this.#recoveries) if (item.attemptId === attemptId) this.#recoveries.delete(id);
      } finally {
        this.#invalidatingAttempts.delete(attemptId);
        this.#invalidations.delete(invalidation);
        if (this.#invalidationByAttempt.get(attemptId) === invalidation) this.#invalidationByAttempt.delete(attemptId);
      }
    })();
    this.#invalidations.add(invalidation);
    this.#invalidationByAttempt.set(attemptId, invalidation);
    return invalidation;
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const controllers of this.#controllers.values()) for (const controller of controllers) controller.abort();
    this.#closing = (async () => {
      await Promise.allSettled([...this.#runs, ...this.#invalidations]);
      await this.#preparer.close();
      await this.#upload.close();
      this.#claims.clear(); this.#recoveries.clear(); this.#completed.clear(); this.#assetSets.clear(); this.#assetSetPending.clear();
      this.#controllers.clear(); this.#runsByAttempt.clear(); this.#epochs.clear();
      this.#invalidatingAttempts.clear(); this.#invalidations.clear();
      this.#invalidationByAttempt.clear();
    })();
    return this.#closing;
  }

  async #run<T>(attemptId: string, external: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.#closed) fail("SERVICE_CLOSED");
    if (this.#invalidatingAttempts.has(attemptId)) fail("SERVICE_BUSY");
    if (this.#runs.size >= MAX_PENDING) fail("SERVICE_BUSY");
    const controller = new AbortController();
    const signal = external ? AbortSignal.any([controller.signal, external]) : controller.signal;
    const controllers = this.#controllers.get(attemptId) ?? new Set<AbortController>(); controllers.add(controller); this.#controllers.set(attemptId, controllers);
    let run!: Promise<T>;
    run = Promise.resolve().then(() => operation(signal)).finally(() => {
      controllers.delete(controller); if (!controllers.size) this.#controllers.delete(attemptId);
      this.#runs.delete(run); const bucket = this.#runsByAttempt.get(attemptId); bucket?.delete(run); if (!bucket?.size) this.#runsByAttempt.delete(attemptId);
    });
    this.#runs.add(run); const bucket = this.#runsByAttempt.get(attemptId) ?? new Set<Promise<unknown>>(); bucket.add(run); this.#runsByAttempt.set(attemptId, bucket);
    return run;
  }

  async #generate(request: Readonly<OwnerGrokT2iGenerateInput>, signal: AbortSignal): Promise<OwnerGrokT2iGenerationResult> {
    let claim: Claim | undefined; let recovery: Recovery | undefined; let postStarted = false;
    const deadline = this.#deadline(signal, () => recovery ? unknown(recovery) : error("PRE_DISPATCH_FAILED"));
    try {
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      const profile = this.#assertProfile(request.model_id);
      const assetSet = await this.#getAssetSet(request, principal, deadline);
      const candidate = await this.#await(deadline, () => this.#preparer.prepare({ principal, attempt_id: request.attemptId, asset_set: assetSet, signal: deadline.signal }));
      if (!this.#preparer.isPreparedCandidateForPrincipal(candidate, principal, request.attemptId) || candidate.model_id !== request.model_id ||
          candidate.profile_schema_hash !== profile.profile_schema_hash || assetSet.expires_at <= this.#readNow()) fail("PRE_DISPATCH_FAILED");
      const intentKey = JSON.stringify([principal.tenant_id, principal.subject_id, candidate.intent_fingerprint]);
      this.#prune();
      const completed = this.#completed.get(intentKey);
      if (completed && completed.expires_at > this.#readNow()) return completed.result;
      if (this.#claims.has(intentKey)) fail("INTENT_ALREADY_CLAIMED");
      if (this.#claims.size >= MAX_HOLDS) fail("SERVICE_BUSY");
      claim = { intent_key: intentKey, created_at: this.#readNow(), state: "PREPARING" }; this.#claims.set(intentKey, claim);
      const client = this.#native(request.attemptId);
      claim.state = "PREPARING";
      await this.#runPreflight(request, principal, candidate, deadline);
      await this.#assertCurrent(request, principal, candidate, claim, deadline);
      const chat = await this.#await(deadline, () => client.createChat("image", `owner-grok-t2i-${randomUUID()}`, deadline.signal));
      if (!SAFE_ID.test(chat.chat_uuid)) fail("PRE_DISPATCH_FAILED");
      await this.#assertCurrent(request, principal, candidate, claim, deadline);
      await this.#runPreflight(request, principal, candidate, deadline);
      await this.#assertCurrent(request, principal, candidate, claim, deadline);
      const permit = createOwnerGrokT2iOneShotPermit({ preparer: this.#preparer, candidate, principal,
        attemptId: request.attemptId, catalog: this.#catalog, catalog_version: this.#catalogVersion, now: this.#now });
      recovery = this.#createRecovery(request.attemptId, principal, candidate, assetSet, profile, intentKey, chat.chat_uuid);
      await this.#assertCurrent(request, principal, candidate, claim, deadline);
      const inputExpiresAt = recovery.expires_at;
      if (inputExpiresAt === null) fail("PRE_DISPATCH_FAILED");
      recovery.post_dispatch_witness = Object.freeze({ attempt_id: recovery.attemptId, principal: recovery.principal,
        model_id: recovery.model_id, profile_schema_hash: recovery.profile.profile_schema_hash,
        catalog_version: recovery.profile.public_catalog_version, request_fingerprint: candidate.request_fingerprint,
        intent_fingerprint: candidate.intent_fingerprint, intent_key: recovery.intent_key, chat_uuid: recovery.chat_uuid,
        input_expires_at: inputExpiresAt });
      recovery.expires_at = null;
      claim.state = "POST_STARTED";
      postStarted = true;
      recovery.diagnostic.phase = "GENERATION_POST"; recovery.diagnostic.post_started = true;
      const receipt = await this.#await(deadline, () => client.startGrokT2iImageWithOwnedCandidate({ preparer: this.#preparer,
        candidate, permit, principal, attemptId: request.attemptId, chat_uuid: chat.chat_uuid }, deadline.signal));
      if (!receipt || receipt.chat_uuid !== chat.chat_uuid || !SAFE_ID.test(receipt.message_id)) throw unknown(recovery);
      recovery.owner_echo_message_id = receipt.message_id;
      recovery.diagnostic.phase = "POST_ACK_KNOWN"; recovery.diagnostic.echo_ack_known = true;
      claim.state = "OUTCOME_UNKNOWN";
      await this.#assertRecoveryCurrent(recovery, deadline);
      const result = await this.#observe(recovery, client, deadline);
      this.#recoveries.delete(recovery.recovery_id); this.#claims.delete(intentKey);
      this.#completed.set(intentKey, Object.freeze({ result, expires_at: recovery.source_expires_at }));
      return result;
    } catch (cause) {
      if (postStarted && recovery) { if (claim) claim.state = "OUTCOME_UNKNOWN"; throw unknown(recovery); }
      if (recovery) this.#recoveries.delete(recovery.recovery_id);
      if (claim) this.#claims.delete(claim.intent_key);
      if (cause instanceof OwnerGrokT2iGenerationServiceError) throw cause;
      if (cause instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      if (cause instanceof OwnerGrokT2iOneShotPolicyError) fail("PRE_DISPATCH_FAILED");
      fail("PRE_DISPATCH_FAILED");
    } finally { deadline.close(); }
  }

  async #reconcile(request: Readonly<OwnerGrokT2iReconcileInput>, signal: AbortSignal): Promise<OwnerGrokT2iGenerationResult> {
    this.#prune(); const recovery = this.#recoveries.get(request.recovery_id);
    if (!recovery || recovery.attemptId !== request.attemptId ||
        (recovery.expires_at !== null && recovery.expires_at <= this.#readNow())) fail("RECOVERY_NOT_FOUND");
    const deadline = this.#deadline(signal, () => unknown(recovery));
    try {
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      if (!sameGenerationPrincipal(principal, recovery.principal)) fail("RECOVERY_NOT_FOUND");
      if (!recovery.owner_echo_message_id) throw unknown(recovery);
      const result = await this.#observe(recovery, this.#native(request.attemptId), deadline);
      this.#recoveries.delete(recovery.recovery_id); this.#claims.delete(recovery.intent_key);
      this.#completed.set(recovery.intent_key, Object.freeze({ result, expires_at: recovery.source_expires_at }));
      return result;
    } catch (cause) {
      if (cause instanceof OwnerGrokT2iGenerationServiceError && cause.code === "RECOVERY_NOT_FOUND") throw cause;
      throw unknown(recovery);
    } finally { deadline.close(); }
  }

  async #observe(recovery: Recovery, client: SyntxChatHttpClient, deadline: AbsoluteRequestDeadline): Promise<OwnerGrokT2iGenerationResult> {
    if (!recovery.owner_echo_message_id) throw unknown(recovery);
    let delay = this.#pollDelayMs; const started = this.#readNow();
    for (let round = 0; round < this.#maxPollAttempts; round += 1) {
      deadline.throwIfAborted(); await this.#assertRecoveryCurrent(recovery, deadline);
      if (!recovery.result_message_id || !recovery.provider_chat_id || !recovery.object_ids) {
        recovery.diagnostic.phase = "HISTORY_GET"; increment(recovery.diagnostic, "history");
        const snapshot = await this.#await(deadline, () => client.listMessageCandidates(recovery.chat_uuid, recovery.owner_echo_message_id!, deadline.signal));
        await this.#assertRecoveryCurrent(recovery, deadline);
        recovery.diagnostic.phase = "HISTORY_BINDING";
        const binding = correlateOwnerGrokT2iHistoryBinding({ snapshot, requested_chat_uuid: recovery.chat_uuid,
          owner_echo_message_id: recovery.owner_echo_message_id, model_id: recovery.model_id,
          requested_batch_size: recovery.candidate.parameters.batch_size, expected_reference_count: recovery.candidate.reference_count,
          expected_reference_types: Array.from({ length: recovery.candidate.reference_count }, () => "image" as const),
          profile_binding: { profile_id: recovery.profile.profile_id, model_id: recovery.model_id,
            public_catalog_version: recovery.profile.public_catalog_version, profile_schema_hash: recovery.profile.profile_schema_hash } });
        recovery.diagnostic.history_status = binding.status;
        recovery.diagnostic.history_reason = binding.status === "READY" ? null : binding.reason;
        if (binding.status === "INVALID" || binding.status === "UNVERIFIED") throw unknown(recovery);
        if (binding.status !== "READY") { delay = await this.#waitNext(recovery, deadline, started, round, delay); continue; }
        recovery.provider_chat_id = binding.provider_chat_id;
        recovery.result_message_id = binding.result_message_id;
        recovery.object_ids = binding.message_object_ids;
      }
      recovery.diagnostic.phase = "RESULT_GET"; increment(recovery.diagnostic, "result");
      const result = await this.#await(deadline, () => client.getGrokT2iBatchMessage({ chat_uuid: recovery.chat_uuid,
        message_id: recovery.result_message_id!, model_id: recovery.model_id, provider_chat_id: recovery.provider_chat_id!,
        message_object_ids: recovery.object_ids!, requested_batch_size: recovery.candidate.parameters.batch_size }, deadline.signal));
      await this.#assertRecoveryCurrent(recovery, deadline);
      recovery.diagnostic.phase = "RESULT_BINDING";
      recovery.diagnostic.result_status = result.status;
      recovery.diagnostic.result_reason = result.status === "COMPLETE" ? null : result.status === "PARTIAL" ? "OUTPUT_BATCH_PARTIAL" : result.reason;
      if (result.status === "UNVERIFIED") throw unknown(recovery);
      if (result.status === "PENDING" || result.status === "PARTIAL") {
        if (result.status === "PARTIAL") recovery.diagnostic.result_reason = "OUTPUT_BATCH_PARTIAL";
        recovery.result_message_id = null; recovery.provider_chat_id = null; recovery.object_ids = null;
        delay = await this.#waitNext(recovery, deadline, started, round, delay); continue;
      }
      if (!sameResult(result, recovery)) throw unknown(recovery);
      return resultFor(recovery, result);
    }
    throw unknown(recovery);
  }

  async #waitNext(recovery: Recovery, deadline: AbsoluteRequestDeadline, started: number, round: number, previous: number): Promise<number> {
    const now = this.#readNow(); const elapsed = now - started;
    if (!Number.isSafeInteger(elapsed) || elapsed < 0 || elapsed >= this.#timeoutMs ||
        (recovery.expires_at !== null && recovery.expires_at <= now)) throw unknown(recovery);
    const recoveryRemaining = recovery.expires_at === null ? Number.MAX_SAFE_INTEGER : recovery.expires_at - now;
    const next = Math.min(MAX_DELAY, round === 0 ? this.#pollDelayMs : Math.ceil(previous * 1.2), this.#timeoutMs - elapsed, recoveryRemaining);
    recovery.diagnostic.phase = "RESULT_WAIT";
    if (next > 0) await this.#await(deadline, () => this.#wait(next, deadline.signal));
    await this.#assertRecoveryCurrent(recovery, deadline); return next;
  }

  async #runPreflight(request: Readonly<OwnerGrokT2iGenerateInput>, principal: Readonly<GenerationPrincipalRef>,
    candidate: OwnerGrokT2iPreparedCandidate, deadline: AbsoluteRequestDeadline): Promise<void> {
    const input = Object.freeze({ attemptId: request.attemptId, principal, model_id: request.model_id,
      cost_inputs: Object.freeze({ ...candidate.cost_inputs }), request_fingerprint: candidate.request_fingerprint,
      catalog_version: this.#catalogVersion, signal: deadline.signal });
    const snapshot = await this.#await(deadline, () => this.#preflight(input));
    assertPreflight(snapshot, candidate, this.#catalog, this.#readNow());
  }

  async #getAssetSet(request: Readonly<OwnerGrokT2iGenerateInput>, principal: Readonly<GenerationPrincipalRef>,
    deadline: AbsoluteRequestDeadline): Promise<OwnerGrokT2iOwnedAssetSet> {
    this.#prune();
    const key = JSON.stringify([request.attemptId, principal.tenant_id, principal.subject_id, request.model_id,
      request.prompt, request.parameters, request.reference_handles]);
    const cached = this.#assetSets.get(key);
    if (cached && cached.expires_at > this.#readNow()) return cached.asset_set;
    if (cached) this.#assetSets.delete(key);
    let pending = this.#assetSetPending.get(key);
    if (!pending) {
      if (this.#assetSets.size + this.#assetSetPending.size >= MAX_HOLDS) fail("SERVICE_BUSY");
      pending = this.#preparer.issue({ principal, attempt_id: request.attemptId, model_id: request.model_id,
        prompt: request.prompt, parameters: request.parameters, reference_handles: request.reference_handles, signal: deadline.signal });
      this.#assetSetPending.set(key, pending);
      void pending.finally(() => { if (this.#assetSetPending.get(key) === pending) this.#assetSetPending.delete(key); }).catch(() => undefined);
    }
    const assetSet = await this.#await(deadline, () => pending!);
    if (assetSet.expires_at <= this.#readNow()) fail("PRE_DISPATCH_FAILED");
    this.#prune();
    if (!this.#assetSets.has(key) && this.#assetSets.size >= MAX_HOLDS) fail("SERVICE_BUSY");
    this.#assetSets.set(key, Object.freeze({ asset_set: assetSet, expires_at: assetSet.expires_at, attemptId: request.attemptId }));
    return assetSet;
  }

  async #assertCurrent(request: Readonly<OwnerGrokT2iGenerateInput>, principal: Readonly<GenerationPrincipalRef>,
    candidate: OwnerGrokT2iPreparedCandidate, claim: Claim, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted();
    const current = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
    if (!sameGenerationPrincipal(current, principal) || !this.#preparer.isPreparedCandidateForPrincipal(candidate, principal, request.attemptId) ||
        this.#claims.get(claim.intent_key) !== claim || this.#assertProfile(request.model_id).profile_schema_hash !== candidate.profile_schema_hash ||
        candidate.expires_at <= this.#readNow()) fail("PRE_DISPATCH_FAILED");
  }
  async #assertRecoveryCurrent(recovery: Recovery, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted();
    const witness = recovery.post_dispatch_witness;
    const candidate = recovery.candidate;
    const profile = this.#assertProfile(recovery.model_id);
    const claim = this.#claims.get(recovery.intent_key);
    if ((recovery.expires_at !== null && recovery.expires_at <= this.#readNow()) || !witness ||
        witness.attempt_id !== recovery.attemptId || !sameGenerationPrincipal(witness.principal, recovery.principal) ||
        witness.model_id !== recovery.model_id || witness.profile_schema_hash !== recovery.profile.profile_schema_hash ||
        witness.catalog_version !== this.#catalogVersion || witness.catalog_version !== recovery.profile.public_catalog_version ||
        witness.request_fingerprint !== candidate.request_fingerprint || witness.intent_fingerprint !== candidate.intent_fingerprint ||
        witness.intent_key !== recovery.intent_key ||
        JSON.stringify([witness.principal.tenant_id, witness.principal.subject_id, witness.intent_fingerprint]) !== witness.intent_key ||
        claim?.intent_key !== witness.intent_key || witness.chat_uuid !== recovery.chat_uuid ||
        witness.input_expires_at !== recovery.source_expires_at || candidate.model_id !== recovery.model_id ||
        candidate.profile_schema_hash !== witness.profile_schema_hash || profile.profile_schema_hash !== witness.profile_schema_hash ||
        claim.state !== "OUTCOME_UNKNOWN") throw unknown(recovery);
    const current = await this.#await(deadline, () => this.#resolvePrincipal(recovery.attemptId));
    if (!sameGenerationPrincipal(current, recovery.principal)) throw unknown(recovery);
  }
  #createRecovery(attemptId: string, principal: Readonly<GenerationPrincipalRef>, candidate: OwnerGrokT2iPreparedCandidate,
    assetSet: OwnerGrokT2iOwnedAssetSet, profile: Readonly<OwnerGrokT2iSourceProfile>, intent_key: string, chat_uuid: string): Recovery {
    this.#prune();
    if (this.#recoveries.size >= MAX_HOLDS) fail("SERVICE_BUSY");
    const now = this.#readNow(); const expiresAt = Math.min(candidate.expires_at, assetSet.expires_at, now + TTL);
    if (expiresAt <= now) fail("PRE_DISPATCH_FAILED");
    const recovery: Recovery = { recovery_id: `grok_t2i_recovery_${randomUUID()}`, attemptId, principal, model_id: candidate.model_id,
      candidate, asset_set: assetSet, profile, intent_key, chat_uuid, created_at: new Date(now).toISOString(),
      expires_at: expiresAt, source_expires_at: expiresAt, post_dispatch_witness: null,
      owner_echo_message_id: null, provider_chat_id: null, result_message_id: null, object_ids: null, diagnostic: initialDiagnostic() };
    this.#recoveries.set(recovery.recovery_id, recovery); return recovery;
  }
  async #resolvePrincipal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    try { return await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService }); }
    catch (cause) { if (cause instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED"); fail("PRINCIPAL_NOT_LINKED"); }
  }
  #assertProfile(model: OwnerGrokT2iModel): Readonly<OwnerGrokT2iSourceProfile> {
    const expected = this.#profiles.get(model);
    if (!expected) fail("MODEL_BINDING_MISMATCH");
    try {
      const current = getOwnerGrokT2iSourceProfile(model, this.#catalog, this.#catalogVersion);
      if (current.profile_schema_hash !== expected.profile_schema_hash) fail("MODEL_BINDING_MISMATCH");
      return current;
    } catch { fail("MODEL_BINDING_MISMATCH"); }
  }
  #native(attemptId: string): SyntxChatHttpClient {
    let client: unknown; try { client = this.#resolveChatClient(attemptId); } catch { fail("MODEL_BINDING_MISMATCH"); }
    if (!client || typeof client !== "object" || types.isProxy(client) || !(client instanceof SyntxChatHttpClient) ||
        Object.getPrototypeOf(client) !== SyntxChatHttpClient.prototype || client.createChat !== NATIVE.createChat ||
        client.startGrokT2iImageWithOwnedCandidate !== NATIVE.post || client.listMessageCandidates !== NATIVE.history ||
        client.getGrokT2iBatchMessage !== NATIVE.result) fail("MODEL_BINDING_MISMATCH");
    return client as SyntxChatHttpClient;
  }
  #deadline(signal: AbortSignal, makeError?: () => Error): AbsoluteRequestDeadline {
    return new AbsoluteRequestDeadline(this.#timeoutMs, signal, () => makeError?.() ?? error("PRE_DISPATCH_FAILED"));
  }
  async #await<T>(deadline: AbsoluteRequestDeadline, operation: () => Promise<T>): Promise<T> {
    deadline.throwIfAborted(); return deadline.waitFor(Promise.resolve().then(operation));
  }
  #readNow(): number {
    let value: unknown; try { value = Reflect.apply(this.#now, undefined, []); } catch { fail("PRE_DISPATCH_FAILED"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (this.#lastNow !== undefined && (value as number) < this.#lastNow)) fail("PRE_DISPATCH_FAILED");
    this.#lastNow = value as number; return value as number;
  }
  #prune(): void {
    const now = this.#readNow();
    for (const [key, item] of this.#assetSets) if (item.expires_at <= now) this.#assetSets.delete(key);
    for (const [id, item] of this.#recoveries) if (item.expires_at !== null && item.expires_at <= now) this.#recoveries.delete(id);
    for (const [key, item] of this.#completed) if (item.expires_at <= now) this.#completed.delete(key);
    // PREPARING and OUTCOME_UNKNOWN semantic claims are intentionally never evicted.
  }
}

export function createOwnerGrokT2iGenerationService(options: OwnerGrokT2iGenerationServiceOptions): OwnerGrokT2iGenerationService {
  return new OwnerGrokT2iGenerationService(options);
}

function assertPreflight(value: OwnerGrokT2iGenerationPreflightResult, candidate: OwnerGrokT2iPreparedCandidate,
  catalog: DiscoveryCatalogRepository, now: number): void {
  const top = exact(value, ["account", "model_access"]);
  const account = exact(top.account, ["balance", "subscription", "contract_evidence", "source_build", "observed_at"]);
  const balance = exact(account.balance, ["unit", "available"]);
  const sub = exact(account.subscription, ["active", "plan_type", "end_date", "end_date_kind"]);
  const access = exact(top.model_access, ["catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live",
    "parameter_keys", "parameters_redacted", "access", "cost", "discount_cost", "free_remaining_generations", "limit", "show_warning", "observed_at"]);
  const keys = Object.keys(candidate.cost_inputs).sort();
  const observedKeys = denseStrings(access.parameter_keys);
  const catalogVersion = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
  const model = catalog.getModel(candidate.model_id);
  if (account.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || account.source_build !== ACCOUNT_SOURCE_BUILD || balance.unit !== "tokens" ||
      !(balance.available === null || validBalance(balance.available)) || !fresh(account.observed_at as string, now) || !activeSubscription(sub, now) ||
      access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || access.catalog_version !== catalogVersion ||
      access.model_id !== candidate.model_id || access.ai_name !== "grok_image" || access.model_type !== candidate.model_id ||
      access.account_read_live !== true || access.access !== true || access.parameters_redacted !== true || !same(observedKeys, keys) ||
      !fresh(access.observed_at as string, now) || !nullableFinite(access.cost) || !nullableFinite(access.discount_cost) ||
      !nullableInteger(access.free_remaining_generations) || !nullableFinite(access.limit) ||
      !(access.show_warning === null || typeof access.show_warning === "boolean") ||
      (typeof sub.plan_type === "string" && sub.plan_type.trim().toUpperCase() === "FREE" &&
        !(typeof access.free_remaining_generations === "number" && access.free_remaining_generations > 0)) ||
      model.active !== true || model.id !== candidate.model_id ||
      model.ai_name !== "grok_image" || model.upstream_id !== candidate.model_id || model.scope !== "image" || !model.modalities.includes("image") ||
      !model.operations.some((op) => op.id === "generate-image" && op.output_modality === "image")) fail("PREFLIGHT_FAILED");
}
function activeSubscription(sub: Record<string, any>, now: number): boolean {
  if (sub.active !== true || !(sub.plan_type === null || (typeof sub.plan_type === "string" && sub.plan_type.trim() !== ""))) return false;
  if (sub.end_date === null && sub.end_date_kind === null) return true;
  if (typeof sub.end_date !== "string" || sub.end_date_kind !== "OFFSET_DATETIME" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(sub.end_date)) return false;
  const expiry = Date.parse(sub.end_date);
  return Number.isFinite(expiry) && expiry > now;
}
function fresh(value: string, now: number): boolean {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) && parsed <= now && now - parsed <= 30_000 && new Date(parsed).toISOString() === value;
}
function finite(value: unknown): boolean { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function nullableFinite(value: unknown): boolean { return value === null || finite(value); }
function nullableInteger(value: unknown): boolean { return value === null || (Number.isSafeInteger(value) && (value as number) >= 0); }
function validBalance(value: unknown): boolean { return typeof value === "string" && value.length <= 128 && /^[+-]?\d+(?:\.\d+)?$/u.test(value); }
function same(a: readonly string[], b: readonly string[]): boolean { return a.length === b.length && a.every((v, i) => v === b[i]); }
function denseStrings(value: unknown): string[] {
  if (!Array.isArray(value) || types.isProxy(value) || value.length > 32 || Object.getPrototypeOf(value) !== Array.prototype) fail("PREFLIGHT_FAILED");
  return Array.from({ length: value.length }, (_, index) => { const d = Object.getOwnPropertyDescriptor(value, String(index));
    if (!d || !("value" in d) || typeof d.value !== "string") fail("PREFLIGHT_FAILED"); return d.value; });
}
function sameResult(result: InternalGrokT2iImageBatchResult, recovery: Recovery): result is Extract<InternalGrokT2iImageBatchResult, { status: "COMPLETE" }> {
  return result.status === "COMPLETE" && result.chat_uuid === recovery.chat_uuid && result.message_id === recovery.result_message_id &&
    result.provider_chat_id === recovery.provider_chat_id && result.model_id === recovery.model_id &&
    result.requested_batch_size === recovery.candidate.parameters.batch_size && result.message_object_ids.length === result.objects.length &&
    result.objects.every((object, index) => object.message_object_id === result.message_object_ids[index] && object.model_id === recovery.model_id && object.completed);
}
function resultFor(recovery: Recovery, result: Extract<InternalGrokT2iImageBatchResult, { status: "COMPLETE" }>): OwnerGrokT2iGenerationResult {
  return Object.freeze({ status: "result_observed", backend_acceptance: "UNPROVEN", namespace_confidence: result.namespace_confidence,
    ai_name: "grok_image", model_id: recovery.model_id, operation_id: "generate-image", profile_id: recovery.profile.profile_id,
    profile_schema_hash: recovery.profile.profile_schema_hash, catalog_version: recovery.profile.public_catalog_version,
    request_fingerprint: recovery.candidate.request_fingerprint, parameters: recovery.candidate.parameters,
    reference_count: recovery.candidate.reference_count,
    artifacts: Object.freeze(result.objects.map((item) => Object.freeze({ message_object_id: item.message_object_id,
      url: item.object_url, mime_type: item.mime_type, width: null, height: null, geometry_verified: false }))) });
}
function snapshotBinding(value: unknown): Readonly<AuthBinding> { const f = exact(value, ["tenant_id", "subject"]);
  if (typeof f.tenant_id !== "string" || !f.tenant_id || typeof f.subject !== "string" || !f.subject) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: f.tenant_id, subject: f.subject }); }
function snapshotLinkService(value: unknown): Pick<PerUserLinkService, "getStatus"> { if (!value || typeof value !== "object" || types.isProxy(value)) fail("INVALID_REQUEST");
  const own = Object.getOwnPropertyDescriptor(value, "getStatus"); const proto = Object.getPrototypeOf(value);
  const inherited = proto && Object.getOwnPropertyDescriptor(proto, "getStatus"); const fn = own && "value" in own ? own.value : inherited && "value" in inherited ? inherited.value : undefined;
  if (typeof fn !== "function" || types.isProxy(fn)) fail("INVALID_REQUEST");
  return Object.freeze({ getStatus: (binding, attempt) => Reflect.apply(fn, value, [binding, attempt]) }) as Pick<PerUserLinkService, "getStatus">; }
function readCatalogVersion(value: unknown): string { if (value !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION) fail("MODEL_BINDING_MISMATCH"); return value; }
function snapshotGenerate(value: unknown): Readonly<OwnerGrokT2iGenerateInput> { const f = exact(value, ["attemptId", "model_id", "parameters", "prompt", "reference_handles"]);
  if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || !OWNER_GROK_T2I_MODELS.includes(f.model_id as OwnerGrokT2iModel) ||
      typeof f.prompt !== "string" || !Array.isArray(f.reference_handles) || types.isProxy(f.reference_handles) || f.reference_handles.length > 5) fail("INVALID_REQUEST");
  const normalized = normalizeOwnerGrokT2iParameters({ model_id: f.model_id, reference_count: f.reference_handles.length, parameters: f.parameters });
  const handles = denseStrings(f.reference_handles);
  if (handles.some((h) => !/^grok_t2i_image_[0-9a-f-]{36}$/u.test(h))) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: f.attemptId, model_id: f.model_id as OwnerGrokT2iModel, parameters: normalized.parameters, prompt: f.prompt, reference_handles: Object.freeze(handles) }); }
function snapshotReconcile(value: unknown): Readonly<OwnerGrokT2iReconcileInput> { const f = exact(value, ["attemptId", "recovery_id"]);
  if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || typeof f.recovery_id !== "string" || !RECOVERY.test(f.recovery_id)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: f.attemptId, recovery_id: f.recovery_id }); }
function snapshotRecoveryList(value: unknown): Readonly<{ attemptId: string; limit: number }> { const f = exact(value, ["attemptId"], ["limit"]);
  const limit = f.limit ?? 20; if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || !Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 20) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: f.attemptId, limit: limit as number }); }
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const p = Object.getPrototypeOf(value); const d = Object.getOwnPropertyDescriptors(value); const keys = Reflect.ownKeys(d);
  if ((p !== Object.prototype && p !== null) || required.some((key) => !Object.hasOwn(d, key)) || keys.some((key) => typeof key !== "string" ||
    (!required.includes(key) && !optional.includes(key)) || !("value" in d[key]!))) fail("INVALID_REQUEST");
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>; for (const key of keys as string[]) out[key] = d[key]!.value; return out;
}
function bounded(value: unknown, min: number, max: number, fallback: number): number { if (value === undefined) return fallback; if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) fail("INVALID_REQUEST"); return value as number; }
function waitDelay(ms: number, signal: AbortSignal): Promise<void> { return new Promise((resolve, reject) => { if (signal.aborted) { reject(error("PRE_DISPATCH_FAILED")); return; }
  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms); const abort = () => { clearTimeout(timer); reject(error("PRE_DISPATCH_FAILED")); };
  signal.addEventListener("abort", abort, { once: true }); }); }
function initialDiagnostic(): MutableDiagnostic { return { phase: "REQUEST_PREPARE", post_started: false, echo_ack_known: false,
  history_status: "NONE", history_reason: null, result_status: "NOT_READ", result_reason: null,
  history_get_calls: 0, history_get_calls_saturated: false, result_get_calls: 0, result_get_calls_saturated: false }; }
function increment(diagnostic: MutableDiagnostic, which: "history" | "result"): void {
  const key = which === "history" ? "history_get_calls" : "result_get_calls";
  const saturated = which === "history" ? "history_get_calls_saturated" : "result_get_calls_saturated";
  if (diagnostic[key] >= 255) { diagnostic[saturated] = true; return; } diagnostic[key] += 1;
}
function snapshotDiagnostic(value: MutableDiagnostic): OwnerGrokT2iUnknownDiagnostic { return Object.freeze({ ...value }); }
function unknown(recovery: Recovery): OwnerGrokT2iGenerationServiceError { return error("OUTCOME_UNKNOWN", recovery.recovery_id, snapshotDiagnostic(recovery.diagnostic)); }
function error(code: OwnerGrokT2iGenerationServiceErrorCode, recoveryId?: string, diagnostic?: OwnerGrokT2iUnknownDiagnostic): OwnerGrokT2iGenerationServiceError { return new OwnerGrokT2iGenerationServiceError(code, recoveryId, diagnostic); }
function fail(code: OwnerGrokT2iGenerationServiceErrorCode): never { throw error(code); }
