import { randomUUID } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import {
  SyntxChatHttpClient,
  type InternalStandardImageResult,
  type MediaGenerationReceipt
} from "../adapter/syntx/chat-http-client.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { OwnerStandardImageUploadService, OwnerStandardImageUploadServiceError } from "./owner-standard-image-upload-service.js";
import {
  getOwnerStandardImageSourceProfile,
  isOwnerStandardImagePreparedCandidateForPrincipal,
  prepareOwnerStandardImageRequest,
  OwnerStandardImagePrepareError,
  type OwnerStandardImageOwnedReferenceSet,
  type OwnerStandardImagePreparedCandidate,
  type OwnerStandardImageSourceProfile,
  type OwnerStandardImageVariant
} from "./owner-standard-image-request-preparer.js";
import { OWNER_STANDARD_IMAGE_VARIANTS, type OwnerStandardImageReferenceMediaKind } from "./owner-standard-image-request-preparer.js";
import { OwnerBananaImageParametersError } from "./owner-banana-image-parameters.js";
import { OwnerGptImageParametersError } from "./owner-gpt-image-parameters.js";
import { createOwnerStandardImageOneShotPermit, OwnerStandardImageOneShotPolicyError } from "./owner-standard-image-one-shot-policy.js";
import {
  correlateOwnerStandardImageHistoryBinding
} from "./owner-standard-image-history-binding.js";
import type { OwnerStandardImageReferenceBindingIssuer, OwnerStandardImageInputReferenceMetadata } from "./owner-standard-image-request-preparer.js";
import type { AccountStatusResult } from "./account-status.js";
import type { ModelAccessResult } from "./model-access.js";
import type { StandardImageResultPendingReason, StandardImageResultUnverifiedReason } from "../adapter/syntx/chat-http-client.js";

type ClaimState = "PREPARING" | "POST_STARTED" | "OUTCOME_UNKNOWN";

interface PostDispatchWitness {
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly variant: OwnerStandardImageVariant;
  readonly profile_schema_hash: string;
  readonly catalog_version: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly claim_key: string;
  readonly chat_uuid: string;
  readonly input_expires_at: number;
}

interface GenerationClaim {
  readonly claimKey: string;
  attemptId: string | null;
  principal: Readonly<GenerationPrincipalRef> | null;
  readonly variant: OwnerStandardImageVariant;
  readonly handles: Set<string>;
  request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly private_expires_at: number;
  state: ClaimState;
}

interface Recovery {
  readonly recovery_id: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly variant: OwnerStandardImageVariant;
  readonly candidate: OwnerStandardImagePreparedCandidate;
  readonly referenceSet: OwnerStandardImageOwnedReferenceSet;
  readonly request_fingerprint: string;
  readonly catalog_version: string;
  readonly created_at: string;
  expires_at: number | null;
  post_dispatch_witness: PostDispatchWitness | null;
  readonly claimKey: string;
  readonly chat_uuid: string;
  owner_echo_message_id: string | null;
  provider_chat_id: string | null;
  bot_message_id: string | null;
  message_object_ids: readonly [string] | null;
  readonly diagnostic: MutableDiagnostic;
}

interface CachedPrincipal {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly expiresAt: number;
}

type MutableDiagnostic = {
  -readonly [K in keyof OwnerStandardImageGenerationDiagnostic]: OwnerStandardImageGenerationDiagnostic[K]
};

const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE_PATTERN = /^standard_image_[0-9a-f-]{36}$/u;
const RECOVERY_PATTERN = /^standard_image_recovery_[0-9a-f-]{36}$/u;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const PROFILE_TTL_MS = 15 * 60_000;
const MAX_PENDING = 4;
const MAX_STATES = 128;
const MAX_REFERENCE_HANDLES = 34;
const MAX_DIAGNOSTIC_COUNT = 99;
const MAX_TIMEOUT_MS = 180_000;
const MAX_POLL_ROUNDS = 32;
const MAX_POLL_DELAY_MS = 40_000;
const DEFAULT_POLL_DELAY_MS = 2_000;
const PENDING_DELAY_MULTIPLIER = 1.5;
const MAX_CLOCK_SKEW_MS = 30_000;
const MODEL_OPERATION = "generate-image" as const;
const NATIVE_METHODS = Object.freeze({
  createChat: SyntxChatHttpClient.prototype.createChat,
  start: SyntxChatHttpClient.prototype.startStandardImageWithOwnedCandidate,
  history: SyntxChatHttpClient.prototype.listMessageCandidates,
  inProgress: SyntxChatHttpClient.prototype.listInProgress,
  result: SyntxChatHttpClient.prototype.getStandardImageResult
});

export interface OwnerStandardImageGenerationPreflightInput {
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly variant: OwnerStandardImageVariant;
  readonly catalog_version: string;
  readonly cost_inputs: Readonly<Record<string, string | number>>;
  readonly request_fingerprint: string;
  readonly signal?: AbortSignal;
}

export interface OwnerStandardImageGenerationPreflightResult {
  readonly account: AccountStatusResult;
  readonly model_access: ModelAccessResult;
}

export type OwnerStandardImageGenerationPreflight = (
  input: Readonly<OwnerStandardImageGenerationPreflightInput>
) => Promise<OwnerStandardImageGenerationPreflightResult>;

export interface OwnerStandardImageGenerationServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string;
  readonly uploadService: OwnerStandardImageUploadService;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly preflight: OwnerStandardImageGenerationPreflight;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly pollDelayMs?: number;
  readonly maxPollAttempts?: number;
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export type OwnerStandardImageNativeChatClient = Pick<SyntxChatHttpClient,
  "createChat" | "startStandardImageWithOwnedCandidate" | "listMessageCandidates" | "listInProgress" | "getStandardImageResult">;

export interface OwnerStandardImageGenerateInput {
  readonly attemptId: string;
  readonly variant: OwnerStandardImageVariant;
  readonly reference_handles: readonly string[];
  readonly parameters: unknown;
  readonly prompt: string;
}

export interface OwnerStandardImageReconcileInput {
  readonly attemptId: string;
  readonly recovery_id: string;
}

export interface OwnerStandardImageRecoveryListInput {
  readonly attemptId: string;
  readonly limit?: number;
}

export const OWNER_STANDARD_IMAGE_GENERATION_PHASES = Object.freeze([
  "REQUEST_PREPARE", "PRINCIPAL", "REFERENCE_BINDING", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST",
  "POST_ACK_KNOWN", "HISTORY_GET", "HISTORY_BINDING", "IN_PROGRESS_GET", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"
] as const);

export const OWNER_STANDARD_IMAGE_GENERATION_ERROR_CODES = Object.freeze([
  "INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH",
  "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED", "REFERENCE_ALREADY_CLAIMED", "PREFLIGHT_FAILED",
  "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"
] as const);

export const OWNER_STANDARD_IMAGE_GENERATION_RESULT_REASONS = Object.freeze([
  "NO_RESULT_OBJECTS", "RESULT_NOT_COMPLETED", "RESPONSE_SHAPE_INVALID", "OUTER_MESSAGE_MISMATCH",
  "PROVIDER_CHAT_MISMATCH", "NOT_BOT_MESSAGE", "RESULT_OBJECT_CARDINALITY_INVALID", "RESULT_OBJECT_SHAPE_INVALID",
  "OBJECT_ID_MISMATCH", "OBJECT_MESSAGE_MISMATCH", "OBJECT_TYPE_MISMATCH", "MODEL_TYPE_UNAVAILABLE",
  "MODEL_TYPE_MISMATCH", "RESULT_URL_UNSAFE"
] as const);

export const OWNER_STANDARD_IMAGE_GENERATION_HISTORY_REASONS = Object.freeze([
  "INVALID_INPUT", "HISTORY_INCOMPLETE", "HISTORY_SHAPE_INVALID", "HISTORY_PAGE_INVALID", "CHAT_SCOPE_MISMATCH",
  "PROVIDER_CHAT_INVALID", "HISTORY_EMPTY", "HISTORY_MESSAGE_SET_INVALID", "MESSAGE_ID_INVALID", "MESSAGE_ID_DUPLICATE",
  "MESSAGE_CHAT_MISMATCH", "OBJECT_ID_INVALID", "OBJECT_ID_DUPLICATE", "OWNER_ACK_NOT_FOUND", "OWNER_ACK_MISMATCH",
  "OWNER_ACK_AMBIGUOUS", "OWNER_OBJECTS_INVALID", "BOT_MESSAGE_NOT_FOUND", "BOT_MESSAGE_AMBIGUOUS",
  "BOT_MESSAGE_BEFORE_ACK", "BOT_OBJECTS_INVALID", "BOT_MODEL_MISMATCH"
] as const);

export type OwnerStandardImageGenerationPhase = typeof OWNER_STANDARD_IMAGE_GENERATION_PHASES[number];
export type OwnerStandardImageGenerationResultReason = StandardImageResultPendingReason | StandardImageResultUnverifiedReason;
export type OwnerStandardImageGenerationHistoryReason = typeof OWNER_STANDARD_IMAGE_GENERATION_HISTORY_REASONS[number];

export interface OwnerStandardImageGenerationDiagnostic {
  readonly phase: OwnerStandardImageGenerationPhase;
  readonly post_started: boolean;
  readonly echo_ack_known: boolean;
  readonly history_binding: "NONE" | "PENDING" | "READY" | "INVALID";
  readonly history_binding_reason: OwnerStandardImageGenerationHistoryReason | null;
  readonly history_get_calls: number;
  readonly history_get_calls_saturated: boolean;
  readonly inprogress_get_calls: number;
  readonly inprogress_get_calls_saturated: boolean;
  readonly result_get_calls: number;
  readonly result_get_calls_saturated: boolean;
  readonly result_status: "NOT_READ" | "PENDING" | "COMPLETE" | "UNVERIFIED";
  readonly result_reason: OwnerStandardImageGenerationResultReason | null;
}

export interface OwnerStandardImageGenerationArtifact {
  readonly url: string;
  readonly mime_type: string | null;
  readonly mime_source: "URL_EXTENSION" | "UNKNOWN";
  readonly width: null;
  readonly height: null;
  readonly geometry_verified: false;
}

export interface OwnerStandardImageGenerationResult {
  readonly status: "result_observed";
  readonly backend_acceptance: "unproven";
  readonly ai_name: "banana" | "sora-images";
  readonly model_id: OwnerStandardImageVariant;
  readonly variant: OwnerStandardImageVariant;
  readonly operation_id: "generate-image";
  readonly profile_id: string;
  readonly profile_schema_hash: string;
  readonly catalog_version: string;
  readonly request_fingerprint: string;
  readonly parameters: Readonly<Record<string, string | null>>;
  readonly cost_inputs: Readonly<Record<string, string | number>>;
  readonly cost_input_confidence: string;
  readonly reference_count: number;
  readonly total_reference_count: number;
  readonly counts_by_kind: Readonly<Record<OwnerStandardImageReferenceMediaKind, number>>;
  readonly input_references: readonly OwnerStandardImageInputReferenceMetadata[];
  readonly actual_image: Readonly<{ mime_type: string | null; width: null; height: null }>;
  readonly geometry_verified: false;
  readonly artifact: OwnerStandardImageGenerationArtifact;
}

export interface OwnerStandardImageRecoveryListItem {
  readonly recovery_id: string;
  readonly created_at: string;
  readonly model_id: OwnerStandardImageVariant;
  readonly operation_id: "generate-image";
  readonly status: "OUTCOME_UNKNOWN";
  readonly diagnostic: OwnerStandardImageGenerationDiagnostic;
}

export type OwnerStandardImageGenerationServiceErrorCode = typeof OWNER_STANDARD_IMAGE_GENERATION_ERROR_CODES[number];

export class OwnerStandardImageGenerationServiceError extends Error {
  readonly diagnostic: OwnerStandardImageGenerationDiagnostic | undefined;

  constructor(readonly code: OwnerStandardImageGenerationServiceErrorCode, readonly recovery_id?: string,
    diagnostic?: OwnerStandardImageGenerationDiagnostic) {
    super(code === "OUTCOME_UNKNOWN"
      ? "The standard image request may have been dispatched; reconcile with the same recovery handle and do not retry."
      : "The owner standard image request could not be completed safely.");
    this.name = "OwnerStandardImageGenerationServiceError";
    this.diagnostic = code === "OUTCOME_UNKNOWN" ? diagnostic : undefined;
  }
}

export interface OwnerStandardImageGenerationService {
  generate(input: OwnerStandardImageGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerStandardImageGenerationResult>;
  reconcile(input: OwnerStandardImageReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerStandardImageGenerationResult>;
  listRecoveries(input: OwnerStandardImageRecoveryListInput | unknown): Promise<readonly OwnerStandardImageRecoveryListItem[]>;
  invalidateAttempt(attemptId: string): Promise<void>;
  close(): Promise<void>;
}

export class OwnerStandardImageGenerationService implements OwnerStandardImageGenerationService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #catalogVersion: string;
  readonly #uploadService: OwnerStandardImageUploadService;
  readonly #issuer: OwnerStandardImageReferenceBindingIssuer;
  readonly #resolveChatClient: OwnerStandardImageGenerationServiceOptions["resolveChatClient"];
  readonly #preflight: OwnerStandardImageGenerationPreflight;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #pollDelayMs: number;
  readonly #maxPollAttempts: number;
  readonly #wait: NonNullable<OwnerStandardImageGenerationServiceOptions["wait"]>;
  readonly #profiles = new Map<OwnerStandardImageVariant, Readonly<OwnerStandardImageSourceProfile>>();
  readonly #recoveries = new Map<string, Recovery>();
  readonly #claimsByIntent = new Map<string, GenerationClaim>();
  readonly #claimsByHandle = new Map<string, GenerationClaim>();
  readonly #referenceSets = new Map<string, Readonly<{ set: OwnerStandardImageOwnedReferenceSet; expires_at: number; attemptId: string }>>();
  readonly #referenceSetPending = new Map<string, Promise<OwnerStandardImageOwnedReferenceSet>>();
  readonly #principals = new Map<string, CachedPrincipal>();
  readonly #epochs = new Map<string, number>();
  readonly #runs = new Set<Promise<unknown>>();
  readonly #runsByAttempt = new Map<string, Set<Promise<unknown>>>();
  readonly #controllersByAttempt = new Map<string, Set<AbortController>>();
  readonly #invalidatingAttempts = new Set<string>();
  #closed = false;
  #closing: Promise<void> | undefined;
  #lastObservedNow = -1;

  constructor(optionsInput: OwnerStandardImageGenerationServiceOptions | unknown) {
    const fields = exactRecord(optionsInput,
      ["binding", "linkService", "catalog", "catalog_version", "uploadService", "resolveChatClient", "preflight"],
      ["now", "timeoutMs", "pollDelayMs", "maxPollAttempts", "wait"]);
    if (!(fields.uploadService instanceof OwnerStandardImageUploadService) || types.isProxy(fields.uploadService) ||
        !(fields.catalog instanceof DiscoveryCatalogRepository) || types.isProxy(fields.catalog) ||
        typeof fields.resolveChatClient !== "function" || types.isProxy(fields.resolveChatClient) ||
        typeof fields.preflight !== "function" || types.isProxy(fields.preflight) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now))) ||
        (fields.wait !== undefined && (typeof fields.wait !== "function" || types.isProxy(fields.wait)))) fail("INVALID_REQUEST");
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = snapshotLinkService(fields.linkService);
    this.#catalog = fields.catalog;
    this.#catalogVersion = readCatalogVersion(fields.catalog_version);
    this.#uploadService = fields.uploadService;
    this.#issuer = this.#uploadService.createOwnedReferenceBindingIssuer();
    this.#resolveChatClient = fields.resolveChatClient as OwnerStandardImageGenerationServiceOptions["resolveChatClient"];
    this.#preflight = fields.preflight as OwnerStandardImageGenerationPreflight;
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    this.#timeoutMs = boundedInt(fields.timeoutMs, 1, MAX_TIMEOUT_MS, MAX_TIMEOUT_MS);
    this.#pollDelayMs = boundedInt(fields.pollDelayMs, 0, MAX_POLL_DELAY_MS, DEFAULT_POLL_DELAY_MS);
    this.#maxPollAttempts = boundedInt(fields.maxPollAttempts, 1, MAX_POLL_ROUNDS, MAX_POLL_ROUNDS);
    this.#wait = fields.wait === undefined ? waitDelay : readWait(fields.wait);
    for (const variant of OWNER_STANDARD_IMAGE_VARIANTS) {
      const profile = getOwnerStandardImageSourceProfile(variant, this.#catalog, this.#catalogVersion);
      this.#profiles.set(variant, profile);
    }
  }

  generate(input: OwnerStandardImageGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerStandardImageGenerationResult> {
    const request = snapshotGenerateInput(input);
    return this.#run(request.attemptId, signal, (requestSignal) => this.#generate(request, requestSignal));
  }

  reconcile(input: OwnerStandardImageReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerStandardImageGenerationResult> {
    const request = snapshotReconcileInput(input);
    return this.#run(request.attemptId, signal, (requestSignal) => this.#reconcile(request, requestSignal));
  }

  listRecoveries(input: OwnerStandardImageRecoveryListInput | unknown): Promise<readonly OwnerStandardImageRecoveryListItem[]> {
    const request = snapshotRecoveryListInput(input);
    return this.#run(request.attemptId, undefined, async (signal) => {
      const deadline = this.#deadline(signal);
      try {
        const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline));
        this.#prune();
        return Object.freeze([...this.#recoveries.values()]
          .filter((recovery) => recovery.attemptId === request.attemptId && sameGenerationPrincipal(recovery.principal, principal))
          .sort((left, right) => right.created_at.localeCompare(left.created_at))
          .slice(0, request.limit)
          .map((recovery) => Object.freeze({ recovery_id: recovery.recovery_id, created_at: recovery.created_at,
            model_id: recovery.variant, operation_id: "generate-image" as const, status: "OUTCOME_UNKNOWN" as const,
            diagnostic: snapshotDiagnostic(recovery.diagnostic) })));
      } finally { deadline.close(); }
    });
  }

  async invalidateAttempt(attemptId: string): Promise<void> {
    if (!isAttemptId(attemptId) || this.#invalidatingAttempts.has(attemptId)) return;
    this.#invalidatingAttempts.add(attemptId);
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    for (const controller of this.#controllersByAttempt.get(attemptId) ?? []) controller.abort();
    this.#issuer.invalidateAttempt(attemptId);
    this.#clearAttemptPrivateState(attemptId);
    try {
      await Promise.allSettled([...(this.#runsByAttempt.get(attemptId) ?? [])]);
      await this.#uploadService.invalidateAttempt(attemptId);
    } finally {
      this.#invalidatingAttempts.delete(attemptId);
      this.#releaseEpoch(attemptId);
    }
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const controllers of this.#controllersByAttempt.values()) for (const controller of controllers) controller.abort();
    this.#issuer.close();
    this.#closing = (async () => {
      await Promise.allSettled([...this.#runs]);
      const attempts = new Set([
        ...this.#controllersByAttempt.keys(), ...this.#principals.keys(), ...this.#invalidatingAttempts,
        ...[...this.#recoveries.values()].map((recovery) => recovery.attemptId),
        ...[...this.#claimsByIntent.values()].map((claim) => claim.attemptId).filter((attemptId): attemptId is string => attemptId !== null)
      ]);
      for (const attemptId of attempts) await this.#uploadService.invalidateAttempt(attemptId);
      await this.#uploadService.close();
      this.#clearAll();
    })();
    return this.#closing;
  }

  async #run<T>(attemptId: string, externalSignal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.#assertOpen();
    if (this.#invalidatingAttempts.has(attemptId) || this.#runs.size >= MAX_PENDING) fail("SERVICE_BUSY");
    const controller = new AbortController();
    const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
    const controllers = this.#controllersByAttempt.get(attemptId) ?? new Set<AbortController>();
    controllers.add(controller); this.#controllersByAttempt.set(attemptId, controllers);
    let tracked: Promise<T>;
    tracked = Promise.resolve().then(() => operation(signal)).finally(() => {
      controllers.delete(controller); if (controllers.size === 0) this.#controllersByAttempt.delete(attemptId);
      const attemptRuns = this.#runsByAttempt.get(attemptId);
      attemptRuns?.delete(tracked); if (attemptRuns?.size === 0) this.#runsByAttempt.delete(attemptId);
      this.#runs.delete(tracked); this.#releaseEpoch(attemptId);
    });
    this.#runs.add(tracked);
    const attemptRuns = this.#runsByAttempt.get(attemptId) ?? new Set<Promise<unknown>>();
    attemptRuns.add(tracked); this.#runsByAttempt.set(attemptId, attemptRuns);
    return tracked;
  }

  async #generate(request: Readonly<OwnerStandardImageGenerateInput>, signal: AbortSignal): Promise<OwnerStandardImageGenerationResult> {
    let claim: GenerationClaim | undefined;
    let recovery: Recovery | undefined;
    let postStarted = false;
    const deadline = this.#deadline(signal, () => recovery ? unknownError(recovery) : generationError("PRE_DISPATCH_FAILED"));
    try {
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline));
      this.#assertProfile(request.variant);
      const referenceSet = await this.#getReferenceSet(request, principal, deadline);
      if (referenceSet.expires_at <= this.#readNow()) throw generationError("REFERENCE_EXPIRED");
      const currentPrincipal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline));
      if (!sameGenerationPrincipal(currentPrincipal, principal)) throw generationError("PRINCIPAL_NOT_LINKED");
      const candidate0 = this.#prepareCandidate(request, principal, referenceSet);
      claim = this.#reserve(request, principal, candidate0, referenceSet.expires_at);
      const native = this.#resolveNativeClient(request.attemptId);

      this.#setClaimPhase(claim, "PREFLIGHT");
      const first = await this.#await(deadline, () => this.#runPreflight(request, principal, candidate0, deadline.signal))
        .catch(() => { throw generationError("PREFLIGHT_FAILED"); });
      this.#assertPreflight(first, candidate0);
      this.#assertSynchronousCurrent(request, principal, candidate0, referenceSet, claim, deadline);

      this.#setClaimPhase(claim, "CHAT_CREATE");
      const chat = await this.#await(deadline, () => native.createChat("image", `owner-standard-image-${randomUUID()}`, deadline.signal));
      if (!isSafeIdentifier(chat.chat_uuid)) throw generationError("PRE_DISPATCH_FAILED");

      await this.#assertCurrent(request, principal, candidate0, referenceSet, claim, deadline);
      const candidate = this.#prepareCandidate(request, principal, referenceSet);
      if (candidate.request_fingerprint !== candidate0.request_fingerprint || candidate.intent_fingerprint !== candidate0.intent_fingerprint ||
          !isDeepStrictEqual(candidate.request, candidate0.request) || !isDeepStrictEqual(candidate.parameters, candidate0.parameters) ||
          !isDeepStrictEqual(candidate.references, candidate0.references)) throw generationError("PRE_DISPATCH_FAILED");

      this.#setClaimPhase(claim, "PREFLIGHT");
      const finalPreflight = await this.#await(deadline, () => this.#runPreflight(request, principal, candidate, deadline.signal))
        .catch(() => { throw generationError("PREFLIGHT_FAILED"); });
      this.#assertPreflight(finalPreflight, candidate);
      this.#assertSynchronousCurrent(request, principal, candidate, referenceSet, claim, deadline);
      this.#ensureRecoveryCapacity();

      recovery = this.#createRecovery(request, principal, candidate, referenceSet, chat.chat_uuid, claim);
      let permit;
      try {
        permit = createOwnerStandardImageOneShotPermit({ candidate, principal, attemptId: request.attemptId,
          catalog: this.#catalog, catalog_version: this.#catalogVersion, now: this.#now });
      } catch (error) {
        this.#recoveries.delete(recovery.recovery_id);
        recovery = undefined;
        throw error;
      }
      await this.#assertCurrent(request, principal, candidate, referenceSet, claim, deadline);
      this.#assertSynchronousCurrent(request, principal, candidate, referenceSet, claim, deadline, recovery);
      const inputExpiresAt = recovery.expires_at;
      if (inputExpiresAt === null) throw generationError("PRE_DISPATCH_FAILED");
      this.#setClaimPhase(claim, "GENERATION_POST", recovery);
      recovery.post_dispatch_witness = Object.freeze({ attempt_id: recovery.attemptId, principal: recovery.principal,
        variant: recovery.variant, profile_schema_hash: candidate.profile_schema_hash, catalog_version: recovery.catalog_version,
        request_fingerprint: recovery.request_fingerprint, intent_fingerprint: candidate.intent_fingerprint,
        claim_key: recovery.claimKey, chat_uuid: recovery.chat_uuid, input_expires_at: inputExpiresAt });
      recovery.expires_at = null;
      recovery.diagnostic.post_started = true;
      claim.state = "POST_STARTED";
      postStarted = true;
      const receipt = await this.#await(deadline, () => native.startStandardImageWithOwnedCandidate({
        candidate, permit, principal, attemptId: request.attemptId, chat_uuid: chat.chat_uuid
      }, deadline.signal));
      if (!validAck(receipt, chat.chat_uuid)) throw generationError("OUTCOME_UNKNOWN", recovery.recovery_id,
        snapshotDiagnostic(recovery.diagnostic));
      recovery.owner_echo_message_id = receipt.message_id;
      recovery.diagnostic.echo_ack_known = true;
      recovery.diagnostic.phase = "POST_ACK_KNOWN";
      claim.state = "OUTCOME_UNKNOWN";
      await this.#assertRecoveryCurrent(recovery, deadline);
      return await this.#observe(recovery, native, deadline);
    } catch (error) {
      if (postStarted && recovery) {
        recovery.diagnostic.post_started = true;
        if (claim) claim.state = "OUTCOME_UNKNOWN";
        throw unknownError(recovery);
      }
      if (recovery) this.#recoveries.delete(recovery.recovery_id);
      if (claim) this.#releaseClaim(claim);
      if (error instanceof OwnerStandardImageGenerationServiceError) throw error;
      if (error instanceof OwnerStandardImageUploadServiceError) {
        if (error.code === "SERVICE_BUSY" || error.code === "CAPACITY_EXCEEDED") throw generationError("SERVICE_BUSY");
        if (error.code === "REFERENCE_EXPIRED") throw generationError("REFERENCE_EXPIRED");
        if (error.code === "SERVICE_CLOSED") throw generationError("SERVICE_CLOSED");
        if (error.code === "MODEL_BINDING_MISMATCH") throw generationError("MODEL_BINDING_MISMATCH");
        if (error.code === "PRINCIPAL_NOT_LINKED") throw generationError("PRINCIPAL_NOT_LINKED");
        throw generationError("REFERENCE_UNAVAILABLE");
      }
      if (error instanceof OwnerStandardImagePrepareError) {
        if (error.code === "PROFILE_BINDING_MISMATCH") throw generationError("MODEL_BINDING_MISMATCH");
        if (error.code === "REFERENCE_EXPIRED") throw generationError("REFERENCE_EXPIRED");
        if (error.code === "REFERENCE_UNAVAILABLE") throw generationError("REFERENCE_UNAVAILABLE");
        throw generationError("INVALID_REQUEST");
      }
      if (error instanceof OwnerBananaImageParametersError || error instanceof OwnerGptImageParametersError) throw generationError("INVALID_REQUEST");
      if (error instanceof OwnerStandardImageOneShotPolicyError) {
        if (error.code === "CATALOG_BINDING_MISMATCH") throw generationError("MODEL_BINDING_MISMATCH");
        if (error.code === "PERMIT_EXPIRED" || error.code === "CANDIDATE_EXPIRED") throw generationError("REFERENCE_EXPIRED");
        throw generationError("PRE_DISPATCH_FAILED");
      }
      if (error instanceof OwnerReferencePrincipalError) throw generationError("PRINCIPAL_NOT_LINKED");
      throw generationError("PRE_DISPATCH_FAILED");
    } finally { deadline.close(); }
  }

  async #reconcile(request: Readonly<OwnerStandardImageReconcileInput>, signal: AbortSignal): Promise<OwnerStandardImageGenerationResult> {
    const deadline = this.#deadline(signal, () => {
      const current = this.#recoveries.get(request.recovery_id);
      return current ? unknownError(current) : generationError("RECOVERY_NOT_FOUND");
    });
    let recovery: Recovery | undefined;
    try {
      this.#prune();
      recovery = this.#recoveries.get(request.recovery_id);
      if (!recovery || recovery.attemptId !== request.attemptId ||
          (recovery.expires_at !== null && recovery.expires_at <= this.#readNow())) throw generationError("RECOVERY_NOT_FOUND");
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline));
      if (!sameGenerationPrincipal(principal, recovery.principal)) throw generationError("RECOVERY_NOT_FOUND");
      if (!recovery.owner_echo_message_id) throw unknownError(recovery);
      const client = this.#resolveNativeClient(request.attemptId);
      return await this.#observe(recovery, client, deadline);
    } catch (error) {
      if (error instanceof OwnerStandardImageGenerationServiceError && error.code === "RECOVERY_NOT_FOUND") throw error;
      if (!recovery) throw error instanceof OwnerStandardImageGenerationServiceError ? error : generationError("PRE_DISPATCH_FAILED");
      throw unknownError(recovery);
    } finally { deadline.close(); }
  }

  async #observe(recovery: Recovery, client: SyntxChatHttpClient, deadline: AbsoluteRequestDeadline): Promise<OwnerStandardImageGenerationResult> {
    if (!recovery.owner_echo_message_id) throw unknownError(recovery);
    const startedAt = this.#readNow();
    let previousDelay = this.#pollDelayMs;
    for (let round = 0; round < this.#maxPollAttempts; round += 1) {
      deadline.throwIfAborted();
      if (recovery.expires_at !== null && recovery.expires_at <= this.#readNow()) throw unknownError(recovery);
      if (!recovery.bot_message_id || !recovery.provider_chat_id || !recovery.message_object_ids) {
        recovery.diagnostic.phase = "HISTORY_GET";
        incrementDiagnostic(recovery.diagnostic, "history");
        const snapshot = await this.#await(deadline, () => client.listMessageCandidates(
          recovery.chat_uuid, recovery.owner_echo_message_id!, deadline.signal));
        await this.#assertRecoveryCurrent(recovery, deadline);
        recovery.diagnostic.phase = "HISTORY_BINDING";
        const binding = correlateOwnerStandardImageHistoryBinding({ snapshot, requested_chat_uuid: recovery.chat_uuid,
          owner_echo_message_id: recovery.owner_echo_message_id, variant: recovery.variant, profile_id: recovery.candidate.profile_id,
          profile_schema_hash: recovery.candidate.profile_schema_hash,
          requested_reference_kinds: recovery.candidate.references.map((reference) => reference.kind) });
        recovery.diagnostic.history_binding = binding.status;
        recovery.diagnostic.history_binding_reason = binding.status === "INVALID" ? binding.reason : null;
        if (binding.status === "INVALID") throw unknownError(recovery);
        if (binding.status === "READY") {
          recovery.provider_chat_id = binding.provider_chat_id;
          recovery.bot_message_id = binding.result_message_id;
          recovery.message_object_ids = Object.freeze([...binding.message_object_ids]) as readonly [string];
        } else {
          recovery.diagnostic.phase = "IN_PROGRESS_GET";
          incrementDiagnostic(recovery.diagnostic, "inprogress");
          const inProgress = await this.#await(deadline, () => client.listInProgress(recovery.chat_uuid, deadline.signal));
          await this.#assertRecoveryCurrent(recovery, deadline);
          if (!Array.isArray(inProgress) || inProgress.length > 256) throw unknownError(recovery);
          previousDelay = await this.#waitForNext(recovery, deadline, startedAt, round, previousDelay);
          continue;
        }
      }

      recovery.diagnostic.phase = "RESULT_GET";
      incrementDiagnostic(recovery.diagnostic, "result");
      const result = await this.#await(deadline, () => client.getStandardImageResult({
        chat_uuid: recovery.chat_uuid, message_id: recovery.bot_message_id!, variant: recovery.variant,
        provider_chat_id: recovery.provider_chat_id!, message_object_ids: recovery.message_object_ids!
      }, deadline.signal));
      await this.#assertRecoveryCurrent(recovery, deadline);
      recovery.diagnostic.phase = "RESULT_BINDING";
      recovery.diagnostic.result_status = result.status;
      if (result.status === "UNVERIFIED") {
        recovery.diagnostic.result_reason = result.reason;
        throw unknownError(recovery);
      }
      if (result.status === "PENDING") {
        recovery.diagnostic.result_reason = result.reason;
        previousDelay = await this.#waitForNext(recovery, deadline, startedAt, round, previousDelay);
        continue;
      }
      if (!sameStandardImageResultContext(result, recovery) || !isSafeUploadReferenceUrl(result.artifact.url) ||
          !(result.artifact.mime_type === null || result.artifact.mime_type.startsWith("image/")) ||
          this.#claimsByIntent.get(recovery.claimKey)?.state !== "OUTCOME_UNKNOWN") throw unknownError(recovery);
      this.#recoveries.delete(recovery.recovery_id);
      this.#releaseClaimByKey(recovery.claimKey);
      return resultFor(recovery, result);
    }
    throw unknownError(recovery);
  }

  async #waitForNext(recovery: Recovery, deadline: AbsoluteRequestDeadline, startedAt: number, round: number,
    previousDelay: number): Promise<number> {
    const now = this.#readNow();
    const elapsed = now - startedAt;
    if (!Number.isSafeInteger(elapsed) || elapsed < 0 || elapsed >= this.#timeoutMs ||
        (recovery.expires_at !== null && recovery.expires_at <= now)) throw unknownError(recovery);
    const recoveryRemaining = recovery.expires_at === null ? Number.MAX_SAFE_INTEGER : recovery.expires_at - now;
    const delay = Math.min(this.#pollDelayMs, this.#timeoutMs - elapsed, recoveryRemaining,
      round === 0 ? this.#pollDelayMs : Math.ceil(previousDelay * PENDING_DELAY_MULTIPLIER));
    recovery.diagnostic.phase = "RESULT_WAIT";
    if (delay > 0) await this.#await(deadline, () => this.#wait(delay, deadline.signal));
    await this.#assertRecoveryCurrent(recovery, deadline);
    return delay;
  }

  async #runPreflight(request: Readonly<OwnerStandardImageGenerateInput>, principal: Readonly<GenerationPrincipalRef>,
    candidate: OwnerStandardImagePreparedCandidate, signal: AbortSignal): Promise<OwnerStandardImageGenerationPreflightResult> {
    return this.#preflight(Object.freeze({ attemptId: request.attemptId, principal, variant: request.variant,
      catalog_version: this.#catalogVersion, cost_inputs: Object.freeze({ ...candidate.cost_inputs }),
      request_fingerprint: candidate.request_fingerprint, signal }));
  }

  async #getReferenceSet(request: Readonly<OwnerStandardImageGenerateInput>, principal: Readonly<GenerationPrincipalRef>,
    deadline: AbsoluteRequestDeadline): Promise<OwnerStandardImageOwnedReferenceSet> {
    this.#prune();
    const key = JSON.stringify([request.attemptId, principal.tenant_id, principal.subject_id, request.variant, request.reference_handles]);
    const cached = this.#referenceSets.get(key);
    if (cached) {
      if (cached.expires_at <= this.#readNow()) throw generationError("REFERENCE_EXPIRED");
      return cached.set;
    }
    let pending = this.#referenceSetPending.get(key);
    if (!pending) {
      pending = this.#issuer.issue({ principal, attempt_id: request.attemptId,
        variant: request.variant, reference_handles: request.reference_handles });
      this.#referenceSetPending.set(key, pending);
      void pending.finally(() => {
        if (this.#referenceSetPending.get(key) === pending) this.#referenceSetPending.delete(key);
      }).catch(() => undefined);
    }
    const referenceSet = await this.#await(deadline, () => pending!);
    if (referenceSet.expires_at <= this.#readNow()) throw generationError("REFERENCE_EXPIRED");
    this.#prune();
    if (this.#referenceSets.size >= MAX_STATES) throw generationError("SERVICE_BUSY");
    this.#referenceSets.set(key, Object.freeze({ set: referenceSet, expires_at: referenceSet.expires_at, attemptId: request.attemptId }));
    return referenceSet;
  }

  #prepareCandidate(request: Readonly<OwnerStandardImageGenerateInput>, principal: Readonly<GenerationPrincipalRef>,
    referenceSet: OwnerStandardImageOwnedReferenceSet): OwnerStandardImagePreparedCandidate {
    this.#assertProfile(request.variant);
    return prepareOwnerStandardImageRequest({ principal, attempt_id: request.attemptId, variant: request.variant,
      parameters: request.parameters, reference_set: referenceSet, prompt: request.prompt },
    { catalog: this.#catalog, catalog_version: this.#catalogVersion, now: this.#now });
  }

  #reserve(request: Readonly<OwnerStandardImageGenerateInput>, principal: Readonly<GenerationPrincipalRef>,
    candidate: OwnerStandardImagePreparedCandidate, referenceExpiresAt: number): GenerationClaim {
    this.#prune();
    const key = JSON.stringify([principal.tenant_id, principal.subject_id, request.variant, candidate.intent_fingerprint]);
    if (this.#claimsByIntent.has(key)) throw generationError("REFERENCE_ALREADY_CLAIMED");
    if (this.#claimsByIntent.size >= MAX_STATES || this.#recoveries.size >= MAX_STATES ||
        this.#claimsByHandle.size + request.reference_handles.length > MAX_REFERENCE_HANDLES) throw generationError("SERVICE_BUSY");
    if (request.reference_handles.some((handle) => this.#claimsByHandle.has(handle))) throw generationError("REFERENCE_ALREADY_CLAIMED");
    const expiresAt = Math.min(candidate.expires_at, referenceExpiresAt, this.#readNow() + PROFILE_TTL_MS);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= this.#readNow()) throw generationError("REFERENCE_EXPIRED");
    const claim: GenerationClaim = { claimKey: key, attemptId: request.attemptId, principal, variant: request.variant,
      handles: new Set(request.reference_handles), request_fingerprint: candidate.request_fingerprint,
      intent_fingerprint: candidate.intent_fingerprint, private_expires_at: expiresAt, state: "PREPARING" };
    this.#claimsByIntent.set(key, claim);
    for (const handle of claim.handles) this.#claimsByHandle.set(handle, claim);
    return claim;
  }

  #createRecovery(request: Readonly<OwnerStandardImageGenerateInput>, principal: Readonly<GenerationPrincipalRef>,
    candidate: OwnerStandardImagePreparedCandidate, referenceSet: OwnerStandardImageOwnedReferenceSet, chatUuid: string,
    claim: GenerationClaim): Recovery {
    this.#prune();
    this.#ensureRecoveryCapacity();
    const now = this.#readNow();
    const expiresAt = Math.min(candidate.expires_at, referenceSet.expires_at, now + PROFILE_TTL_MS);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) throw generationError("REFERENCE_EXPIRED");
    const recovery: Recovery = {
      recovery_id: `standard_image_recovery_${randomUUID()}`, attemptId: request.attemptId, principal,
      variant: request.variant, candidate, referenceSet, request_fingerprint: candidate.request_fingerprint,
      catalog_version: this.#catalogVersion, created_at: new Date(now).toISOString(), expires_at: expiresAt,
      claimKey: claim.claimKey, chat_uuid: chatUuid, post_dispatch_witness: null, owner_echo_message_id: null, provider_chat_id: null,
      bot_message_id: null, message_object_ids: null, diagnostic: initialDiagnostic()
    };
    this.#recoveries.set(recovery.recovery_id, recovery);
    return recovery;
  }

  async #assertCurrent(request: Readonly<OwnerStandardImageGenerateInput>, expectedPrincipal: Readonly<GenerationPrincipalRef>,
    candidate: OwnerStandardImagePreparedCandidate, referenceSet: OwnerStandardImageOwnedReferenceSet,
    claim: GenerationClaim, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted();
    const current = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline));
    if (!sameGenerationPrincipal(current, expectedPrincipal)) {
      this.#invalidateAttemptState(request.attemptId);
      throw generationError("PRINCIPAL_NOT_LINKED");
    }
    this.#assertSynchronousCurrent(request, expectedPrincipal, candidate, referenceSet, claim, deadline);
  }

  #assertSynchronousCurrent(request: Readonly<OwnerStandardImageGenerateInput>, principal: Readonly<GenerationPrincipalRef>,
    candidate: OwnerStandardImagePreparedCandidate, referenceSet: OwnerStandardImageOwnedReferenceSet,
    claim: GenerationClaim, deadline: AbsoluteRequestDeadline, recovery?: Recovery): void {
    deadline.throwIfAborted();
    const now = this.#readNow();
    const cached = this.#principals.get(request.attemptId);
    const profile = this.#assertProfile(request.variant);
    if (this.#closed || this.#invalidatingAttempts.has(request.attemptId) || !cached || cached.expiresAt <= now ||
        !sameGenerationPrincipal(cached.principal, principal) || profile.profile_schema_hash !== candidate.profile_schema_hash ||
        candidate.expires_at <= now || referenceSet.expires_at <= now ||
        !isOwnerStandardImagePreparedCandidateForPrincipal(candidate, principal, request.attemptId, now) ||
        this.#claimsByIntent.get(claim.claimKey) !== claim ||
        [...claim.handles].some((handle) => this.#claimsByHandle.get(handle) !== claim) ||
        (recovery && (recovery.expires_at === null || recovery.expires_at <= now || this.#recoveries.get(recovery.recovery_id) !== recovery))) {
      throw generationError("REFERENCE_UNAVAILABLE");
    }
  }

  async #assertRecoveryCurrent(recovery: Recovery, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted();
    const current = await this.#await(deadline, () => this.#resolvePrincipal(recovery.attemptId, deadline));
    const profile = this.#assertProfile(recovery.variant);
    const witness = recovery.post_dispatch_witness;
    const candidate = recovery.candidate;
    const claim = this.#claimsByIntent.get(recovery.claimKey);
    if (!sameGenerationPrincipal(current, recovery.principal) || this.#closed || this.#invalidatingAttempts.has(recovery.attemptId) ||
        (recovery.expires_at !== null && recovery.expires_at <= this.#readNow()) || !witness ||
        witness.attempt_id !== recovery.attemptId || !sameGenerationPrincipal(witness.principal, recovery.principal) ||
        witness.variant !== recovery.variant || witness.profile_schema_hash !== candidate.profile_schema_hash ||
        witness.catalog_version !== recovery.catalog_version || witness.catalog_version !== this.#catalogVersion ||
        witness.request_fingerprint !== recovery.request_fingerprint || witness.request_fingerprint !== candidate.request_fingerprint ||
        witness.intent_fingerprint !== candidate.intent_fingerprint || witness.claim_key !== recovery.claimKey ||
        witness.chat_uuid !== recovery.chat_uuid || !Number.isSafeInteger(witness.input_expires_at) ||
        witness.input_expires_at <= 0 || candidate.variant !== recovery.variant ||
        profile.profile_schema_hash !== witness.profile_schema_hash ||
        !claim || claim.claimKey !== witness.claim_key || claim.intent_fingerprint !== witness.intent_fingerprint ||
        claim.state !== "OUTCOME_UNKNOWN" || this.#recoveries.get(recovery.recovery_id) !== recovery) {
      throw unknownError(recovery);
    }
  }

  #assertProfile(variant: OwnerStandardImageVariant): Readonly<OwnerStandardImageSourceProfile> {
    const pinned = this.#profiles.get(variant);
    if (!pinned) throw generationError("MODEL_BINDING_MISMATCH");
    let current: Readonly<OwnerStandardImageSourceProfile>;
    try { current = getOwnerStandardImageSourceProfile(variant, this.#catalog, this.#catalogVersion); }
    catch { throw generationError("MODEL_BINDING_MISMATCH"); }
    if (current.profile_schema_hash !== pinned.profile_schema_hash || current.public_catalog_version !== this.#catalogVersion) {
      throw generationError("MODEL_BINDING_MISMATCH");
    }
    return current;
  }

  #assertPreflight(value: OwnerStandardImageGenerationPreflightResult, candidate: OwnerStandardImagePreparedCandidate): void {
    let top: Record<string, unknown>;
    let account: Record<string, unknown>;
    let balance: Record<string, unknown>;
    let subscription: Record<string, unknown>;
    let access: Record<string, unknown>;
    try {
      top = exactRecord(value, ["account", "model_access"]);
      account = exactRecord(top.account, ["balance", "subscription", "contract_evidence", "source_build", "observed_at"]);
      balance = exactRecord(account.balance, ["unit", "available"]);
      subscription = exactRecord(account.subscription, ["active", "plan_type", "end_date", "end_date_kind"]);
      access = exactRecord(top.model_access, ["catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live",
        "parameter_keys", "parameters_redacted", "access", "cost", "discount_cost", "free_remaining_generations", "limit", "show_warning", "observed_at"]);
    } catch { throw generationError("PREFLIGHT_FAILED"); }
    const now = this.#readNow();
    const expectedKeys = Object.keys(candidate.cost_inputs).sort();
    let model: ReturnType<DiscoveryCatalogRepository["getModel"]>;
    try { model = this.#catalog.getModel(candidate.variant); }
    catch { throw generationError("PREFLIGHT_FAILED"); }
    const validSubscription = subscription.active === true &&
      (subscription.plan_type === null || typeof subscription.plan_type === "string") &&
      validCurrentSubscriptionDates(subscription, now);
    if (account.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || account.source_build !== ACCOUNT_SOURCE_BUILD ||
        !validAccountObservation(account.observed_at, now) || balance.unit !== "tokens" ||
        !(balance.available === null || typeof balance.available === "string") || !validSubscription ||
        access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || access.catalog_version !== currentCatalogVersion(this.#catalog) ||
        access.model_id !== candidate.variant || access.ai_name !== candidate.ai_name || access.model_type !== candidate.variant ||
        access.account_read_live !== true || access.access !== true || access.parameters_redacted !== true ||
        !sameStringArray(access.parameter_keys, expectedKeys) || !validAccessObservation(access.observed_at, now) ||
        !finiteNonnegative(access.cost) || !(access.discount_cost === null || finiteNonnegative(access.discount_cost)) ||
        !(access.free_remaining_generations === null || nonnegativeInteger(access.free_remaining_generations)) ||
        !(access.limit === null || finiteNonnegative(access.limit)) ||
        !(access.show_warning === null || typeof access.show_warning === "boolean") ||
        model.id !== candidate.variant || model.upstream_id !== candidate.variant || model.ai_name !== candidate.ai_name ||
        model.active !== true || !model.modalities.includes("image") ||
        !model.operations.some((operation) => operation.id === "generate-image" && operation.output_modality === "image")) {
      throw generationError("PREFLIGHT_FAILED");
    }
  }

  #resolveNativeClient(attemptId: string): SyntxChatHttpClient {
    const client = this.#resolveChatClient(attemptId);
    if (!(client instanceof SyntxChatHttpClient) || types.isProxy(client) || Object.getPrototypeOf(client) !== SyntxChatHttpClient.prototype ||
        client.createChat !== NATIVE_METHODS.createChat || client.startStandardImageWithOwnedCandidate !== NATIVE_METHODS.start ||
        client.listMessageCandidates !== NATIVE_METHODS.history || client.listInProgress !== NATIVE_METHODS.inProgress ||
        client.getStandardImageResult !== NATIVE_METHODS.result) throw generationError("MODEL_BINDING_MISMATCH");
    return client;
  }

  async #resolvePrincipal(attemptId: string, deadline: AbsoluteRequestDeadline): Promise<Readonly<GenerationPrincipalRef>> {
    this.#assertOpen(); this.#prune();
    if (!this.#principals.has(attemptId) && this.#principals.size >= MAX_STATES) throw generationError("SERVICE_BUSY");
    const epoch = this.#epochs.get(attemptId) ?? 0;
    let principal: Readonly<GenerationPrincipalRef>;
    try {
      principal = await this.#await(deadline, () => resolveOwnerReferencePrincipal({
        binding: this.#binding, attemptId, linkService: this.#linkService
      }));
    } catch (error) {
      if (error instanceof OwnerStandardImageGenerationServiceError) throw error;
      throw generationError("PRINCIPAL_NOT_LINKED");
    }
    deadline.throwIfAborted();
    if (this.#closed || this.#invalidatingAttempts.has(attemptId) || (this.#epochs.get(attemptId) ?? 0) !== epoch ||
        principal.connection_id !== attemptId) throw generationError("PRINCIPAL_NOT_LINKED");
    const snapshot = snapshotGenerationPrincipal(principal);
    const previous = this.#principals.get(attemptId);
    if (previous && !sameGenerationPrincipal(previous.principal, snapshot)) {
      this.#invalidateAttemptState(attemptId);
      throw generationError("PRINCIPAL_NOT_LINKED");
    }
    this.#principals.set(attemptId, Object.freeze({ principal: snapshot, expiresAt: this.#readNow() + PROFILE_TTL_MS }));
    return snapshot;
  }

  #setClaimPhase(claim: GenerationClaim, phase: OwnerStandardImageGenerationPhase, recovery?: Recovery): void {
    if (recovery) recovery.diagnostic.phase = phase;
    if (claim.state === "PREPARING" && phase === "GENERATION_POST") claim.state = "POST_STARTED";
  }

  #ensureRecoveryCapacity(): void {
    this.#prune();
    if (this.#recoveries.size >= MAX_STATES) throw generationError("SERVICE_BUSY");
  }

  #releaseClaim(claim: GenerationClaim): void {
    if (this.#claimsByIntent.get(claim.claimKey) !== claim) return;
    this.#claimsByIntent.delete(claim.claimKey);
    for (const handle of claim.handles) if (this.#claimsByHandle.get(handle) === claim) this.#claimsByHandle.delete(handle);
  }

  #releaseClaimByKey(key: string): void {
    const claim = this.#claimsByIntent.get(key);
    if (claim) this.#releaseClaim(claim);
  }

  #prune(): void {
    const now = this.#readNow();
    for (const [key, entry] of this.#referenceSets) if (entry.expires_at <= now) this.#referenceSets.delete(key);
    for (const [id, recovery] of this.#recoveries) if (recovery.expires_at !== null && recovery.expires_at <= now) this.#recoveries.delete(id);
    for (const claim of this.#claimsByIntent.values()) if (claim.private_expires_at <= now) {
      if (claim.state === "PREPARING") this.#releaseClaim(claim);
      else this.#clearClaimPrivateState(claim);
    }
    for (const [attemptId, cached] of this.#principals) {
      const active = this.#runsByAttempt.has(attemptId) || [...this.#claimsByIntent.values()].some((claim) => claim.attemptId === attemptId) ||
        [...this.#recoveries.values()].some((recovery) => recovery.attemptId === attemptId);
      if (cached.expiresAt <= now && !active) this.#principals.delete(attemptId);
    }
  }

  #invalidateAttemptState(attemptId: string): void {
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    for (const controller of this.#controllersByAttempt.get(attemptId) ?? []) controller.abort();
    this.#issuer.invalidateAttempt(attemptId);
    this.#clearAttemptPrivateState(attemptId);
  }

  #clearAttemptPrivateState(attemptId: string): void {
    this.#principals.delete(attemptId);
    for (const [key, entry] of this.#referenceSets) if (entry.attemptId === attemptId) this.#referenceSets.delete(key);
    for (const key of this.#referenceSetPending.keys()) if (key.startsWith(`[\"${attemptId}\"`)) this.#referenceSetPending.delete(key);
    for (const [id, recovery] of this.#recoveries) if (recovery.attemptId === attemptId) this.#recoveries.delete(id);
    for (const claim of [...this.#claimsByIntent.values()]) {
      if (claim.attemptId !== attemptId) continue;
      if (claim.state === "PREPARING") this.#releaseClaim(claim);
      else this.#clearClaimPrivateState(claim);
    }
  }

  #clearClaimPrivateState(claim: GenerationClaim): void {
    for (const handle of claim.handles) if (this.#claimsByHandle.get(handle) === claim) this.#claimsByHandle.delete(handle);
    claim.handles.clear();
    claim.attemptId = null;
    claim.principal = null;
    claim.request_fingerprint = "";
  }

  #clearAll(): void {
    this.#recoveries.clear(); this.#claimsByIntent.clear(); this.#claimsByHandle.clear(); this.#principals.clear(); this.#epochs.clear();
    this.#referenceSets.clear(); this.#referenceSetPending.clear();
    this.#runsByAttempt.clear(); this.#controllersByAttempt.clear(); this.#invalidatingAttempts.clear();
  }

  #releaseEpoch(attemptId: string): void {
    if (!this.#runsByAttempt.has(attemptId) && !this.#principals.has(attemptId) &&
        ![...this.#claimsByIntent.values()].some((claim) => claim.attemptId === attemptId) &&
        ![...this.#recoveries.values()].some((recovery) => recovery.attemptId === attemptId) &&
        !this.#invalidatingAttempts.has(attemptId)) this.#epochs.delete(attemptId);
  }

  #deadline(signal: AbortSignal, makeError?: () => Error): AbsoluteRequestDeadline {
    return new AbsoluteRequestDeadline(this.#timeoutMs, signal, () => makeError?.() ?? generationError("PRE_DISPATCH_FAILED"));
  }

  async #await<T>(deadline: AbsoluteRequestDeadline, operation: () => Promise<T> | T): Promise<T> {
    deadline.throwIfAborted();
    let pending: Promise<T>;
    try { pending = Promise.resolve(operation()); }
    catch (error) { throw error; }
    return deadline.waitFor(pending);
  }

  #assertOpen(): void { if (this.#closed) throw generationError("SERVICE_CLOSED"); }

  #readNow(): number {
    let value: unknown;
    try { value = this.#now(); } catch { throw generationError("PRE_DISPATCH_FAILED"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) < this.#lastObservedNow) throw generationError("PRE_DISPATCH_FAILED");
    this.#lastObservedNow = value as number;
    return value as number;
  }
}

function snapshotGenerateInput(value: unknown): Readonly<OwnerStandardImageGenerateInput> {
  const fields = exactRecord(value, ["attemptId", "variant", "reference_handles", "parameters", "prompt"]);
  if (!isAttemptId(fields.attemptId) || !isVariant(fields.variant) || typeof fields.prompt !== "string") fail("INVALID_REQUEST");
  const handles = denseStringArray(fields.reference_handles, MAX_REFERENCE_HANDLES);
  if (handles.some((handle) => !HANDLE_PATTERN.test(handle)) || new Set(handles).size !== handles.length) fail("INVALID_REQUEST");
  const parameterKeys = fields.variant.startsWith("banana")
    ? ["aspect_ratio", "image_size", "thinking_level"]
    : ["aspect_ratio", "quality", "details_quality"];
  const rawParameters = exactRecord(fields.parameters, parameterKeys);
  if (parameterKeys.some((key) => !(rawParameters[key] === null || typeof rawParameters[key] === "string"))) fail("INVALID_REQUEST");
  const parameters = Object.freeze(Object.fromEntries(parameterKeys.map((key) => [key, rawParameters[key]])) as Record<string, string | null>);
  return Object.freeze({ attemptId: fields.attemptId, variant: fields.variant,
    reference_handles: Object.freeze(handles), parameters, prompt: fields.prompt });
}

function snapshotReconcileInput(value: unknown): Readonly<OwnerStandardImageReconcileInput> {
  const fields = exactRecord(value, ["attemptId", "recovery_id"]);
  if (!isAttemptId(fields.attemptId) || typeof fields.recovery_id !== "string" || !RECOVERY_PATTERN.test(fields.recovery_id)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, recovery_id: fields.recovery_id });
}

function snapshotRecoveryListInput(value: unknown): Readonly<{ attemptId: string; limit: number }> {
  const fields = exactRecord(value, ["attemptId"], ["limit"]);
  if (!isAttemptId(fields.attemptId)) fail("INVALID_REQUEST");
  const limit = fields.limit === undefined ? 20 : fields.limit;
  if (!Number.isSafeInteger(limit) || typeof limit !== "number" || limit < 1 || limit > 20) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, limit });
}

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || fields.tenant_id.length < 1 || fields.tenant_id.length > 256 ||
      /[\u0000-\u001f\u007f]/u.test(fields.tenant_id) || typeof fields.subject !== "string" ||
      fields.subject.length < 1 || fields.subject.length > 512 || /[\u0000-\u001f\u007f]/u.test(fields.subject)) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}

function snapshotLinkService(value: unknown): Pick<PerUserLinkService, "getStatus"> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  let current: object | null = value;
  let method: unknown;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, "getStatus");
    if (descriptor) { method = "value" in descriptor ? descriptor.value : undefined; break; }
    current = Object.getPrototypeOf(current) as object | null;
  }
  if (typeof method !== "function" || types.isProxy(method)) fail("INVALID_REQUEST");
  return Object.freeze({ getStatus: (binding: AuthBinding, attemptId: string) => Reflect.apply(method as Function, value, [binding, attemptId]) }) as
    Pick<PerUserLinkService, "getStatus">;
}

function readCatalogVersion(value: unknown): string {
  if (value !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION) fail("MODEL_BINDING_MISMATCH");
  return value;
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); }
  catch { fail("INVALID_REQUEST"); }
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
  const keys = Reflect.ownKeys(descriptors);
  const allowed = [...required, ...optional];
  if (required.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) => typeof key !== "string" ||
      !allowed.includes(key) || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable)) fail("INVALID_REQUEST");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function denseStringArray(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) fail("INVALID_REQUEST");
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap; }
  catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key !== "string" ||
      (key !== "length" && !/^(0|[1-9]\d*)$/u.test(key)))) fail("INVALID_REQUEST");
  const result: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor) || typeof descriptor.value !== "string") fail("INVALID_REQUEST");
    result.push(descriptor.value);
  }
  return result;
}

function readClock(value: unknown): () => number {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return value as () => number;
}

function boundedInt(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail("INVALID_REQUEST");
  return value;
}

function readWait(value: unknown): NonNullable<OwnerStandardImageGenerationServiceOptions["wait"]> {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return value as NonNullable<OwnerStandardImageGenerationServiceOptions["wait"]>;
}

function isAttemptId(value: unknown): value is string { return typeof value === "string" && ATTEMPT_PATTERN.test(value); }
function isVariant(value: unknown): value is OwnerStandardImageVariant {
  return typeof value === "string" && (OWNER_STANDARD_IMAGE_VARIANTS as readonly string[]).includes(value);
}
function isSafeIdentifier(value: unknown): value is string { return typeof value === "string" && SAFE_IDENTIFIER.test(value); }
function finiteNonnegative(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function nonnegativeInteger(value: unknown): value is number { return Number.isSafeInteger(value) && typeof value === "number" && value >= 0; }
function sameStringArray(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
}

function currentCatalogVersion(catalog: DiscoveryCatalogRepository): string {
  return `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
}

function validAccountObservation(value: unknown, now: number): boolean { return validFreshIso(value, now); }
function validAccessObservation(value: unknown, now: number): boolean { return validFreshIso(value, now); }
function validFreshIso(value: unknown, now: number): boolean {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= now && now - parsed <= MAX_CLOCK_SKEW_MS && new Date(parsed).toISOString() === value;
}

function validCurrentSubscriptionDates(subscription: Record<string, unknown>, now: number): boolean {
  const date = subscription.end_date;
  const kind = subscription.end_date_kind;
  if (date === null) return kind === null;
  if (typeof date !== "string") return false;
  if (kind === "DATE_ONLY") return /^\d{4}-\d{2}-\d{2}$/u.test(date);
  if (kind === "LOCAL_DATETIME") return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/u.test(date);
  if (kind === "OFFSET_DATETIME") {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(date)) return false;
    const expiry = Date.parse(date);
    return Number.isFinite(expiry) && expiry > now;
  }
  return false;
}

function validAck(value: unknown, chatUuid: string): value is MediaGenerationReceipt {
  try {
    const fields = exactRecord(value, ["chat_uuid", "message_id"]);
    return fields.chat_uuid === chatUuid && isSafeIdentifier(fields.message_id);
  } catch { return false; }
}

function initialDiagnostic(): MutableDiagnostic {
  return {
    phase: "REQUEST_PREPARE", post_started: false, echo_ack_known: false, history_binding: "NONE", history_binding_reason: null,
    history_get_calls: 0, history_get_calls_saturated: false, inprogress_get_calls: 0, inprogress_get_calls_saturated: false,
    result_get_calls: 0, result_get_calls_saturated: false, result_status: "NOT_READ", result_reason: null
  };
}

function incrementDiagnostic(diagnostic: MutableDiagnostic, kind: "history" | "inprogress" | "result"): void {
  const key = kind === "history" ? "history_get_calls" : kind === "inprogress" ? "inprogress_get_calls" : "result_get_calls";
  const saturated = kind === "history" ? "history_get_calls_saturated" : kind === "inprogress" ? "inprogress_get_calls_saturated" : "result_get_calls_saturated";
  if (diagnostic[key] >= MAX_DIAGNOSTIC_COUNT) diagnostic[saturated] = true;
  else diagnostic[key] += 1;
}

function snapshotDiagnostic(value: MutableDiagnostic): OwnerStandardImageGenerationDiagnostic {
  return Object.freeze({ ...value });
}

function sameStandardImageResultContext(result: InternalStandardImageResult, recovery: Recovery): boolean {
  if (result.status !== "COMPLETE") return false;
  const objectId = recovery.message_object_ids?.[0];
  return Boolean(objectId) && result.chat_uuid === recovery.chat_uuid && result.message_id === recovery.bot_message_id &&
    result.provider_chat_id === recovery.provider_chat_id && result.variant === recovery.variant && result.model_type === recovery.variant &&
    result.completed === true && result.message_object_ids.length === 1 && result.message_object_ids[0] === objectId &&
    result.artifact.message_object_id === objectId && result.artifact.message_id === recovery.bot_message_id &&
    result.artifact.object_type === "image" && result.artifact.model_type === recovery.variant && result.artifact.completed === true &&
    result.artifact.width === null && result.artifact.height === null && result.artifact.geometry_verified === false &&
    (result.artifact.mime_type === null || result.artifact.mime_type.startsWith("image/")) &&
    (result.artifact.mime_source === "UNKNOWN" ? result.artifact.mime_type === null : result.artifact.mime_source === "URL_EXTENSION");
}

function resultFor(recovery: Recovery, result: Extract<InternalStandardImageResult, { status: "COMPLETE" }>): OwnerStandardImageGenerationResult {
  return Object.freeze({
    status: "result_observed", backend_acceptance: "unproven", ai_name: recovery.candidate.ai_name,
    model_id: recovery.variant, variant: recovery.variant, operation_id: MODEL_OPERATION,
    profile_id: recovery.candidate.profile_id, profile_schema_hash: recovery.candidate.profile_schema_hash,
    catalog_version: recovery.catalog_version, request_fingerprint: recovery.request_fingerprint,
    parameters: recovery.candidate.parameters, cost_inputs: recovery.candidate.cost_inputs,
    cost_input_confidence: recovery.candidate.cost_input_confidence,
    reference_count: recovery.candidate.reference_count, total_reference_count: recovery.candidate.total_reference_count,
    counts_by_kind: recovery.candidate.counts_by_kind,
    input_references: Object.freeze(recovery.candidate.references.map((reference) => Object.freeze({ ...reference }))),
    actual_image: Object.freeze({ mime_type: result.artifact.mime_type, width: null, height: null }),
    geometry_verified: false,
    artifact: Object.freeze({ url: result.artifact.url, mime_type: result.artifact.mime_type,
      mime_source: result.artifact.mime_source, width: null, height: null, geometry_verified: false })
  });
}

function unknownError(recovery: Recovery): OwnerStandardImageGenerationServiceError {
  return generationError("OUTCOME_UNKNOWN", recovery.recovery_id, snapshotDiagnostic(recovery.diagnostic));
}

function generationError(code: OwnerStandardImageGenerationServiceErrorCode, recoveryId?: string,
  diagnostic?: OwnerStandardImageGenerationDiagnostic): OwnerStandardImageGenerationServiceError {
  return new OwnerStandardImageGenerationServiceError(code, recoveryId, diagnostic);
}

function fail(code: OwnerStandardImageGenerationServiceErrorCode): never { throw generationError(code); }

function waitDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(generationError("PRE_DISPATCH_FAILED")); return; }
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(generationError("PRE_DISPATCH_FAILED")); };
    signal.addEventListener("abort", abort, { once: true });
  });
}
