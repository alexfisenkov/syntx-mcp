import { randomUUID } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import {
  SyntxChatHttpClient,
  type InternalKontextImageResult,
  type InProgressMessage,
  type MediaGenerationReceipt
} from "../adapter/syntx/chat-http-client.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import { getOwnerKontextImageSourceProfile, prepareOwnerKontextImageRequest, OwnerKontextImagePrepareError,
  isOwnerKontextImagePreparedCandidateForPrincipal, type OwnerKontextImagePreparedCandidate,
  type OwnerKontextImageOwnedReferenceSet, type OwnerKontextImageInputImageMetadata } from "./owner-kontext-image-request-preparer.js";
import { normalizeOwnerKontextImageParameters, OwnerKontextImageParametersError } from "./owner-kontext-image-parameters.js";
import { createOwnerKontextImageOneShotPermit, OwnerKontextImageOneShotPolicyError } from "./owner-kontext-image-one-shot-policy.js";
import { correlateOwnerKontextImageHistoryBinding, OWNER_KONTEXT_IMAGE_HISTORY_INVALID_REASONS } from "./owner-kontext-image-history-binding.js";
import { OwnerKontextImageUploadService, OwnerKontextImageUploadServiceError } from "./owner-kontext-image-upload-service.js";
import type { AccountStatusResult } from "./account-status.js";
import type { ModelAccessResult } from "./model-access.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import type { OwnerKontextImageHistoryBindingInvalidReason } from "./owner-kontext-image-history-binding.js";
import type {
  OwnerKontextImageVariant,
  OwnerKontextImageParameters,
  OwnerKontextImageResolution
} from "./owner-kontext-image-parameters.js";
import type { OwnerKontextImageWorkflowPolicy } from "./owner-kontext-image-request-preparer.js";
import type {
  KontextImageResultPendingReason,
  KontextImageResultUnverifiedReason
} from "../adapter/syntx/chat-http-client.js";

export interface OwnerKontextImageGenerationPreflightInput {
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly variant: OwnerKontextImageVariant;
  readonly cost_inputs: Readonly<Record<never, never>>;
  readonly request_fingerprint: string;
  readonly catalog_version: string;
  readonly signal?: AbortSignal;
}

export interface OwnerKontextImageGenerationPreflightResult {
  readonly account: AccountStatusResult;
  readonly model_access: ModelAccessResult;
}

export type OwnerKontextImageGenerationPreflight = (
  input: Readonly<OwnerKontextImageGenerationPreflightInput>
) => Promise<OwnerKontextImageGenerationPreflightResult>;

export interface OwnerKontextImageGenerationServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string;
  readonly uploadService: OwnerKontextImageUploadService;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly preflight: OwnerKontextImageGenerationPreflight;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly pollDelayMs?: number;
  readonly maxPollAttempts?: number;
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export type OwnerKontextImageNativeChatClient = Pick<SyntxChatHttpClient,
  "createChat" | "startKontextImageWithOwnedCandidate" | "listMessageCandidates" | "listInProgress" | "getKontextImageResult">;

export interface OwnerKontextImageGenerateInput {
  readonly attemptId: string;
  readonly variant: OwnerKontextImageVariant;
  readonly reference_handles: readonly string[];
  readonly parameters: OwnerKontextImageParameters;
  readonly prompt: string;
  readonly workflow_policy: OwnerKontextImageWorkflowPolicy;
}

export interface OwnerKontextImageReconcileInput {
  readonly attemptId: string;
  readonly recovery_id: string;
}

export interface OwnerKontextImageRecoveryListInput {
  readonly attemptId: string;
  readonly limit?: number;
}

export const OWNER_KONTEXT_IMAGE_GENERATION_PHASES = Object.freeze([
  "REQUEST_PREPARE", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST", "POST_ACK_KNOWN",
  "HISTORY_GET", "HISTORY_BINDING", "IN_PROGRESS_GET", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"
] as const);
export const OWNER_KONTEXT_IMAGE_GENERATION_ERROR_CODES = Object.freeze([
  "INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH",
  "REFERENCE_UNAVAILABLE", "REFERENCE_ALREADY_CLAIMED", "PREFLIGHT_FAILED", "PRE_DISPATCH_FAILED",
  "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"
] as const);
export const OWNER_KONTEXT_IMAGE_GENERATION_RESULT_REASONS = Object.freeze([
  "NO_RESULT_OBJECTS", "RESULT_NOT_COMPLETED", "RESPONSE_SHAPE_INVALID", "OUTER_MESSAGE_MISMATCH",
  "PROVIDER_CHAT_MISMATCH", "NOT_BOT_MESSAGE", "RESULT_OBJECT_CARDINALITY_INVALID", "RESULT_OBJECT_SHAPE_INVALID",
  "OBJECT_ID_MISMATCH", "OBJECT_MESSAGE_MISMATCH", "OBJECT_TYPE_MISMATCH", "MODEL_TYPE_UNAVAILABLE",
  "MODEL_TYPE_MISMATCH", "RESULT_URL_UNSAFE", "RESULT_MIME_UNKNOWN"
] as const);
export { OWNER_KONTEXT_IMAGE_HISTORY_INVALID_REASONS };

export type OwnerKontextImageGenerationPhase = typeof OWNER_KONTEXT_IMAGE_GENERATION_PHASES[number];
export type OwnerKontextImageGenerationResultReason = KontextImageResultPendingReason | KontextImageResultUnverifiedReason;

export interface OwnerKontextImageUnknownDiagnostic {
  readonly phase: OwnerKontextImageGenerationPhase;
  readonly post_started: boolean;
  readonly echo_ack_known: boolean;
  readonly history_binding: "NONE" | "PENDING" | "READY" | "INVALID";
  readonly history_binding_reason: OwnerKontextImageHistoryBindingInvalidReason | null;
  readonly history_get_calls: number;
  readonly history_get_calls_saturated: boolean;
  readonly inprogress_get_calls: number;
  readonly inprogress_get_calls_saturated: boolean;
  readonly result_get_calls: number;
  readonly result_get_calls_saturated: boolean;
  readonly result_status: "NOT_READ" | "PENDING" | "COMPLETE" | "UNVERIFIED";
  readonly result_reason: OwnerKontextImageGenerationResultReason | null;
  readonly model_eq_requested?: boolean;
  readonly model_eq_family?: boolean;
}

export interface OwnerKontextImageArtifact {
  readonly url: string;
  readonly mime_type: string;
  readonly mime_source: "URL_EXTENSION";
}

export type OwnerKontextImageInputMetadata = OwnerKontextImageInputImageMetadata;

export interface OwnerKontextImageGenerationResult {
  readonly status: "result_observed";
  readonly backend_acceptance: "unproven";
  readonly ai_name: "flux";
  readonly model_id: OwnerKontextImageVariant;
  readonly variant: OwnerKontextImageVariant;
  readonly operation_id: "generate-image";
  readonly profile_id: "flux-kontext-source-reviewed-v1";
  readonly profile_schema_hash: string;
  readonly catalog_version: string;
  readonly request_fingerprint: string;
  readonly parameters: OwnerKontextImageParameters;
  readonly requested_resolution: OwnerKontextImageResolution;
  readonly workflow_policy: OwnerKontextImageWorkflowPolicy;
  readonly reference_count: number;
  readonly input_images: readonly OwnerKontextImageInputMetadata[];
  readonly expected_output_geometry: null;
  readonly actual_image: Readonly<{ mime_type: string; width: null; height: null }>;
  readonly geometry_verified: false;
  readonly artifact: OwnerKontextImageArtifact;
}

export interface OwnerKontextImageRecoveryListItem {
  readonly recovery_id: string;
  readonly created_at: string;
  readonly model_id: OwnerKontextImageVariant;
  readonly operation_id: "generate-image";
  readonly status: "OUTCOME_UNKNOWN";
  readonly diagnostic: OwnerKontextImageUnknownDiagnostic;
}

export type OwnerKontextImageGenerationServiceErrorCode = typeof OWNER_KONTEXT_IMAGE_GENERATION_ERROR_CODES[number];

export class OwnerKontextImageGenerationServiceError extends Error {
  readonly diagnostic: OwnerKontextImageUnknownDiagnostic | undefined;

  constructor(readonly code: OwnerKontextImageGenerationServiceErrorCode, readonly recovery_id?: string,
    diagnostic?: OwnerKontextImageUnknownDiagnostic) {
    super(code === "OUTCOME_UNKNOWN"
      ? "The Kontext image request may have been dispatched; reconcile with the same recovery handle and do not retry."
      : "The owner Kontext image request could not be completed safely.");
    this.name = "OwnerKontextImageGenerationServiceError";
    this.diagnostic = code === "OUTCOME_UNKNOWN" ? diagnostic : undefined;
  }
}

export interface OwnerKontextImageGenerationService {
  generate(input: OwnerKontextImageGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerKontextImageGenerationResult>;
  reconcile(input: OwnerKontextImageReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerKontextImageGenerationResult>;
  listRecoveries(input: OwnerKontextImageRecoveryListInput | unknown): Promise<readonly OwnerKontextImageRecoveryListItem[]>;
  invalidateAttempt(attemptId: string): Promise<void>;
  close(): Promise<void>;
}

const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY_PATTERN = /^kontext_recovery_[0-9a-f-]{36}$/u;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const PROFILE_TTL_MS = 15 * 60_000;
const MAX_PENDING = 4;
const MAX_STATES = 128;
const MAX_REFERENCE_HANDLES = 128;
const MAX_TIMEOUT_MS = 180_000;
const MAX_POLL_ROUNDS = 32;
const MAX_DIAGNOSTIC_COUNT = 99;
const DEFAULT_POLL_DELAY_MS = 2_000;
const MAX_POLL_DELAY_MS = 40_000;
const MAX_CLOCK_SKEW_MS = 30_000;
const MODEL_OPERATION = "generate-image" as const;
const KONTEXT_VARIANTS = Object.freeze(["flux-kontext-pro", "flux-kontext-max", "flux-kontext-multi"] as const);
const SOURCE_FETCHED_AT = "2026-10-08T13:18:39.393Z";
const SOURCE_MODEL_HASH = "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444";
const NATIVE_METHODS = Object.freeze({
  createChat: SyntxChatHttpClient.prototype.createChat,
  start: SyntxChatHttpClient.prototype.startKontextImageWithOwnedCandidate,
  history: SyntxChatHttpClient.prototype.listMessageCandidates,
  inProgress: SyntxChatHttpClient.prototype.listInProgress,
  result: SyntxChatHttpClient.prototype.getKontextImageResult
});
const PENDING_DELAY_MULTIPLIER = 1.2;

interface MutableDiagnostic {
  phase: OwnerKontextImageGenerationPhase;
  post_started: boolean;
  echo_ack_known: boolean;
  history_binding: OwnerKontextImageUnknownDiagnostic["history_binding"];
  history_binding_reason: OwnerKontextImageUnknownDiagnostic["history_binding_reason"];
  history_get_calls: number;
  history_get_calls_saturated: boolean;
  inprogress_get_calls: number;
  inprogress_get_calls_saturated: boolean;
  result_get_calls: number;
  result_get_calls_saturated: boolean;
  result_status: OwnerKontextImageUnknownDiagnostic["result_status"];
  result_reason: OwnerKontextImageUnknownDiagnostic["result_reason"];
  model_eq_requested?: boolean;
  model_eq_family?: boolean;
}

interface GenerationRecovery {
  readonly recovery_id: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly variant: OwnerKontextImageVariant;
  readonly candidate: OwnerKontextImagePreparedCandidate;
  readonly referenceSet: OwnerKontextImageOwnedReferenceSet;
  readonly request_fingerprint: string;
  readonly catalog_version: string;
  readonly created_at: string;
  expires_at: number | null;
  readonly claimKey: string;
  post_dispatch_witness: Readonly<{
    attempt_id: string;
    principal: Readonly<GenerationPrincipalRef>;
    variant: OwnerKontextImageVariant;
    profile_schema_hash: string;
    source_binding: OwnerKontextImagePreparedCandidate["source_binding"];
    catalog_version: string;
    request_fingerprint: string;
    reference_count: number;
    claim_key: string;
    chat_uuid: string;
  }> | null;
  chat_uuid: string;
  owner_echo_message_id: string | null;
  provider_chat_id: string | null;
  bot_message_id: string | null;
  object_id: string | null;
  readonly diagnostic: MutableDiagnostic;
}

interface GenerationClaim {
  readonly claimKey: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly variant: OwnerKontextImageVariant;
  readonly handles: readonly string[];
  readonly request_fingerprint: string;
  expires_at: number | null;
  state: "PREPARING" | "POST_STARTED" | "OUTCOME_UNKNOWN";
}

interface CachedReferenceSet {
  readonly set: OwnerKontextImageOwnedReferenceSet;
  readonly expires_at: number;
}

/** Owner-only process-local full Kontext lifecycle; it never grants public dispatch authority. */
export class OwnerKontextImageGenerationService implements OwnerKontextImageGenerationService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #catalogVersion: string;
  readonly #uploadService: OwnerKontextImageUploadService;
  readonly #issuer: ReturnType<OwnerKontextImageUploadService["createOwnedReferenceBindingIssuer"]>;
  readonly #resolveChatClient: OwnerKontextImageGenerationServiceOptions["resolveChatClient"];
  readonly #preflight: OwnerKontextImageGenerationPreflight;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #pollDelayMs: number;
  readonly #maxPollAttempts: number;
  readonly #wait: NonNullable<OwnerKontextImageGenerationServiceOptions["wait"]>;
  readonly #profiles = new Map<OwnerKontextImageVariant, ReturnType<typeof getOwnerKontextImageSourceProfile>>();
  readonly #recoveries = new Map<string, GenerationRecovery>();
  readonly #claimsByIntent = new Map<string, GenerationClaim>();
  readonly #claimsByHandle = new Map<string, GenerationClaim>();
  readonly #referenceSets = new Map<string, CachedReferenceSet>();
  readonly #referenceSetPending = new Map<string, Promise<OwnerKontextImageOwnedReferenceSet>>();
  readonly #principals = new Map<string, Readonly<{ principal: Readonly<GenerationPrincipalRef>; expiresAt: number }>>();
  readonly #epochs = new Map<string, number>();
  readonly #runs = new Set<Promise<unknown>>();
  readonly #runsByAttempt = new Map<string, Set<Promise<unknown>>>();
  readonly #controllersByAttempt = new Map<string, Set<AbortController>>();
  #closed = false;
  #closing: Promise<void> | undefined;
  #lastObservedNow = -1;

  constructor(options: OwnerKontextImageGenerationServiceOptions) {
    const fields = exactRecord(options,
      ["binding", "linkService", "catalog", "catalog_version", "uploadService", "resolveChatClient", "preflight"],
      ["now", "timeoutMs", "pollDelayMs", "maxPollAttempts", "wait"]);
    if (!(fields.uploadService instanceof OwnerKontextImageUploadService) || types.isProxy(fields.uploadService) ||
        !(fields.catalog instanceof DiscoveryCatalogRepository) || types.isProxy(fields.catalog) ||
        typeof fields.resolveChatClient !== "function" || types.isProxy(fields.resolveChatClient) ||
        typeof fields.preflight !== "function" || types.isProxy(fields.preflight) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now))) ||
        (fields.wait !== undefined && (typeof fields.wait !== "function" || types.isProxy(fields.wait)))) fail("INVALID_REQUEST");
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = snapshotLinkService(fields.linkService);
    this.#catalog = fields.catalog as DiscoveryCatalogRepository;
    this.#catalogVersion = readCatalogVersion(fields.catalog_version);
    this.#uploadService = fields.uploadService as OwnerKontextImageUploadService;
    this.#issuer = this.#uploadService.createOwnedReferenceBindingIssuer();
    this.#resolveChatClient = fields.resolveChatClient as OwnerKontextImageGenerationServiceOptions["resolveChatClient"];
    this.#preflight = fields.preflight as OwnerKontextImageGenerationPreflight;
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    this.#timeoutMs = boundedInt(fields.timeoutMs, 1, MAX_TIMEOUT_MS, MAX_TIMEOUT_MS);
    this.#pollDelayMs = boundedInt(fields.pollDelayMs, 0, MAX_POLL_DELAY_MS, DEFAULT_POLL_DELAY_MS);
    this.#maxPollAttempts = boundedInt(fields.maxPollAttempts, 1, MAX_POLL_ROUNDS, MAX_POLL_ROUNDS);
    this.#wait = fields.wait === undefined ? waitDelay : readWait(fields.wait);
    for (const variant of KONTEXT_VARIANTS) {
      const profile = getOwnerKontextImageSourceProfile(variant, this.#catalog, this.#catalogVersion);
      if (this.#catalog.fetched_at !== SOURCE_FETCHED_AT || this.#catalog.source_hashes.models !== SOURCE_MODEL_HASH) fail("MODEL_BINDING_MISMATCH");
      this.#profiles.set(variant, profile);
    }
  }

  generate(input: OwnerKontextImageGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerKontextImageGenerationResult> {
    const request = snapshotGenerateInput(input);
    return this.#run(request.attemptId, signal, (requestSignal) => this.#generate(request, requestSignal));
  }

  reconcile(input: OwnerKontextImageReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerKontextImageGenerationResult> {
    const request = snapshotReconcileInput(input);
    return this.#run(request.attemptId, signal, (requestSignal) => this.#reconcile(request, requestSignal));
  }

  listRecoveries(input: OwnerKontextImageRecoveryListInput | unknown): Promise<readonly OwnerKontextImageRecoveryListItem[]> {
    const fields = snapshotRecoveryListInput(input);
    return this.#run(fields.attemptId, undefined, async (signal) => {
      const deadline = this.#deadline(signal);
      try {
        const principal = await this.#await(deadline, () => this.#resolvePrincipal(fields.attemptId, deadline));
        this.#prune();
        return Object.freeze([...this.#recoveries.values()]
          .filter((item) => item.attemptId === fields.attemptId && sameGenerationPrincipal(item.principal, principal))
          .sort((left, right) => right.created_at.localeCompare(left.created_at))
          .slice(0, fields.limit)
          .map((item) => Object.freeze({ recovery_id: item.recovery_id, created_at: item.created_at,
            model_id: item.variant, operation_id: MODEL_OPERATION, status: "OUTCOME_UNKNOWN" as const,
            diagnostic: snapshotDiagnostic(item.diagnostic) })));
      } finally { deadline.close(); }
    });
  }

  async invalidateAttempt(attemptId: string): Promise<void> {
    if (typeof attemptId !== "string" || !ATTEMPT_PATTERN.test(attemptId)) return;
    if (!this.#hasAttemptState(attemptId)) return;
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    for (const controller of this.#controllersByAttempt.get(attemptId) ?? []) controller.abort();
    this.#issuer.invalidateAttempt(attemptId);
    this.#clearAttempt(attemptId);
    await Promise.allSettled([...(this.#runsByAttempt.get(attemptId) ?? [])]);
    await this.#uploadService.invalidateAttempt(attemptId);
    this.#releaseEpoch(attemptId);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const controllers of this.#controllersByAttempt.values()) for (const controller of controllers) controller.abort();
    this.#issuer.close();
    this.#closing = (async () => {
      await Promise.allSettled([...this.#runs]);
      const attempts = new Set([
        ...this.#controllersByAttempt.keys(), ...this.#principals.keys(),
        ...[...this.#recoveries.values()].map((item) => item.attemptId),
        ...[...this.#claimsByIntent.values()].map((item) => item.attemptId)
      ]);
      for (const attemptId of attempts) await this.#uploadService.invalidateAttempt(attemptId);
      await this.#uploadService.close();
      this.#clearAll();
    })();
    return this.#closing;
  }

  async #run<T>(attemptId: string, externalSignal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.#assertOpen();
    if (this.#runs.size >= MAX_PENDING) fail("SERVICE_BUSY");
    const controller = new AbortController();
    const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
    const controllers = this.#controllersByAttempt.get(attemptId) ?? new Set<AbortController>();
    controllers.add(controller); this.#controllersByAttempt.set(attemptId, controllers);
    const promise = Promise.resolve().then(() => operation(signal)).finally(() => {
      controllers.delete(controller); if (controllers.size === 0) this.#controllersByAttempt.delete(attemptId);
      this.#runs.delete(promise); this.#runsByAttempt.get(attemptId)?.delete(promise);
      if (this.#runsByAttempt.get(attemptId)?.size === 0) this.#runsByAttempt.delete(attemptId);
      this.#releaseEpoch(attemptId);
    });
    this.#runs.add(promise);
    const byAttempt = this.#runsByAttempt.get(attemptId) ?? new Set<Promise<unknown>>();
    byAttempt.add(promise); this.#runsByAttempt.set(attemptId, byAttempt);
    return promise;
  }

  async #generate(request: ReturnType<typeof snapshotGenerateInput>, signal: AbortSignal): Promise<OwnerKontextImageGenerationResult> {
    let recovery: GenerationRecovery | undefined;
    let claim: GenerationClaim | undefined;
    let postStarted = false;
    const deadline = this.#deadline(signal, () => recovery ? unknownError(recovery) : generationError("PRE_DISPATCH_FAILED"));
    try {
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline));
      this.#assertProfile(request.variant);
      const referenceSet = await this.#await(deadline, () => this.#getReferenceSet(request, principal, deadline));
      const candidate0 = this.#prepareCandidate(request, principal, referenceSet);
      claim = this.#reserve(request, principal, candidate0);
      const native = this.#resolveNativeClient(request.attemptId);
      this.#setPhase(claim, "PREFLIGHT");
      const first = await this.#await(deadline, () => this.#preflight({ attemptId: request.attemptId, principal,
        variant: request.variant, cost_inputs: Object.freeze({}), request_fingerprint: candidate0.request_fingerprint,
        catalog_version: this.#catalogVersion,
        signal: deadline.signal })).catch(() => { throw generationError("PREFLIGHT_FAILED"); });
      this.#assertPreflight(first, request.variant);
      await this.#assertCurrent(request, principal, candidate0, claim, deadline);
      this.#assertPreflight(first, request.variant);
      this.#setPhase(claim, "CHAT_CREATE");
      const chat = await this.#await(deadline, () => native.createChat("image", `owner-kontext-${randomUUID()}`, deadline.signal));
      if (!isSafeIdentifier(chat.chat_uuid)) throw generationError("PRE_DISPATCH_FAILED");
      await this.#assertCurrent(request, principal, candidate0, claim, deadline);
      const candidate = this.#prepareCandidate(request, principal, referenceSet);
      if (candidate.request_fingerprint !== candidate0.request_fingerprint ||
          !isDeepStrictEqual(candidate.request, candidate0.request) || !isDeepStrictEqual(candidate.input_images, candidate0.input_images)) {
        throw generationError("PRE_DISPATCH_FAILED");
      }
      this.#setPhase(claim, "PREFLIGHT");
      const second = await this.#await(deadline, () => this.#preflight({ attemptId: request.attemptId, principal,
        variant: request.variant, cost_inputs: Object.freeze({}), request_fingerprint: candidate.request_fingerprint,
        catalog_version: this.#catalogVersion,
        signal: deadline.signal })).catch(() => { throw generationError("PREFLIGHT_FAILED"); });
      this.#assertPreflight(second, request.variant);
      await this.#assertCurrent(request, principal, candidate, claim, deadline);
      this.#assertPreflight(second, request.variant);
      const permit = createOwnerKontextImageOneShotPermit({ candidate, principal, attemptId: request.attemptId,
        catalog: this.#catalog, catalog_version: this.#catalogVersion, now: this.#now });
      recovery = this.#createRecovery(request, principal, candidate, referenceSet, chat.chat_uuid, claim);
      recovery.post_dispatch_witness = Object.freeze({ attempt_id: recovery.attemptId, principal: recovery.principal,
        variant: recovery.variant, profile_schema_hash: candidate.profile_schema_hash, source_binding: candidate.source_binding,
        catalog_version: recovery.catalog_version, request_fingerprint: candidate.request_fingerprint,
        reference_count: candidate.reference_count, claim_key: claim.claimKey, chat_uuid: recovery.chat_uuid });
      recovery.expires_at = null;
      claim.expires_at = null;
      this.#setPhase(claim, "GENERATION_POST", recovery);
      recovery.diagnostic.post_started = true;
      postStarted = true;
      claim.state = "POST_STARTED";
      const receipt = await this.#await(deadline, () => native.startKontextImageWithOwnedCandidate({
        candidate, permit, principal, attemptId: request.attemptId, chat_uuid: chat.chat_uuid
      }, deadline.signal));
      if (!validAck(receipt, chat.chat_uuid)) throw generationError("OUTCOME_UNKNOWN", recovery.recovery_id, snapshotDiagnostic(recovery.diagnostic));
      recovery.owner_echo_message_id = receipt.message_id;
      recovery.diagnostic.echo_ack_known = true;
      recovery.diagnostic.phase = "POST_ACK_KNOWN";
      claim.state = "OUTCOME_UNKNOWN";
      await this.#assertCurrent(request, principal, candidate, claim, deadline, recovery);
      return await this.#observe(recovery, native, deadline);
    } catch (error) {
      if (postStarted && recovery) {
        recovery.diagnostic.post_started = true;
        claim!.state = "OUTCOME_UNKNOWN";
        throw unknownError(recovery);
      }
      if (claim) this.#releaseClaim(claim);
      if (error instanceof OwnerKontextImageGenerationServiceError) throw error;
      if (error instanceof OwnerKontextImageUploadServiceError) throw generationError("REFERENCE_UNAVAILABLE");
      if (error instanceof OwnerKontextImagePrepareError || error instanceof OwnerKontextImageParametersError ||
          error instanceof OwnerKontextImageOneShotPolicyError) throw generationError("INVALID_REQUEST");
      if (error instanceof OwnerReferencePrincipalError) throw generationError("PRINCIPAL_NOT_LINKED");
      throw generationError("PRE_DISPATCH_FAILED");
    } finally { deadline.close(); }
  }

  async #reconcile(request: ReturnType<typeof snapshotReconcileInput>, signal: AbortSignal): Promise<OwnerKontextImageGenerationResult> {
    const deadline = this.#deadline(signal, () => {
      const current = this.#recoveries.get(request.recovery_id);
      return current ? unknownError(current) : generationError("RECOVERY_NOT_FOUND");
    });
    let recovery: GenerationRecovery | undefined;
    try {
      this.#prune();
      recovery = this.#recoveries.get(request.recovery_id);
      if (!recovery || recovery.attemptId !== request.attemptId ||
          (recovery.expires_at !== null && recovery.expires_at <= this.#readNow())) {
        throw generationError("RECOVERY_NOT_FOUND");
      }
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline));
      if (!sameGenerationPrincipal(principal, recovery.principal)) throw generationError("RECOVERY_NOT_FOUND");
      if (!recovery.owner_echo_message_id) throw unknownError(recovery);
      const client = this.#resolveNativeClient(request.attemptId);
      return await this.#observe(recovery, client, deadline);
    } catch (error) {
      if (error instanceof OwnerKontextImageGenerationServiceError && error.code === "RECOVERY_NOT_FOUND") throw error;
      if (!recovery) throw error instanceof OwnerKontextImageGenerationServiceError ? error : generationError("PRE_DISPATCH_FAILED");
      throw unknownError(recovery);
    } finally { deadline.close(); }
  }

  async #observe(
    recovery: GenerationRecovery,
    client: SyntxChatHttpClient,
    deadline: AbsoluteRequestDeadline
  ): Promise<OwnerKontextImageGenerationResult> {
    if (!recovery.owner_echo_message_id) throw unknownError(recovery);
    const runStartedAt = this.#readNow();
    let previousDelay = this.#pollDelayMs;
    for (let round = 0; round < this.#maxPollAttempts; round += 1) {
      deadline.throwIfAborted();
      if (recovery.expires_at !== null && recovery.expires_at <= this.#readNow()) throw unknownError(recovery);
      if (!recovery.bot_message_id || !recovery.object_id || !recovery.provider_chat_id) {
        recovery.diagnostic.phase = "HISTORY_GET";
        incrementDiagnostic(recovery.diagnostic, "history");
        const readStartedAt = this.#readNow();
        const snapshot = await this.#await(deadline, () => client.listMessageCandidates(
          recovery.chat_uuid, recovery.owner_echo_message_id!, deadline.signal));
        await this.#assertRecoveryCurrent(recovery, deadline, readStartedAt);
        recovery.diagnostic.phase = "HISTORY_BINDING";
        const binding = correlateOwnerKontextImageHistoryBinding({ snapshot,
          requested_chat_uuid: recovery.chat_uuid, owner_echo_message_id: recovery.owner_echo_message_id,
          variant: recovery.variant, requested_reference_count: recovery.referenceSet.reference_count });
        recovery.diagnostic.history_binding = binding.kind;
        recovery.diagnostic.history_binding_reason = binding.kind === "INVALID" ? binding.reason : null;
        if (binding.kind === "INVALID") throw unknownError(recovery);
        recovery.provider_chat_id = binding.provider_chat_id;
        if (binding.kind === "READY") {
          recovery.bot_message_id = binding.bot_message_id;
          recovery.object_id = binding.object_id;
        } else {
          recovery.bot_message_id = binding.bot_message_id;
          recovery.diagnostic.phase = "IN_PROGRESS_GET";
          incrementDiagnostic(recovery.diagnostic, "inprogress");
          const readStartedAt = this.#readNow();
          const queue: readonly InProgressMessage[] = await this.#await(deadline,
            () => client.listInProgress(recovery.chat_uuid, deadline.signal));
          await this.#assertRecoveryCurrent(recovery, deadline, readStartedAt);
          if (!Array.isArray(queue) || queue.length > 256) throw unknownError(recovery);
          previousDelay = await this.#waitForNext(recovery, deadline, runStartedAt, round, previousDelay);
          continue;
        }
      }
      recovery.diagnostic.phase = "RESULT_GET";
      incrementDiagnostic(recovery.diagnostic, "result");
      const readStartedAt = this.#readNow();
      const result: InternalKontextImageResult = await this.#await(deadline, () => client.getKontextImageResult({
        chat_uuid: recovery.chat_uuid, message_id: recovery.bot_message_id!, variant: recovery.variant,
        provider_chat_id: recovery.provider_chat_id!, message_object_id: recovery.object_id!
      }, deadline.signal));
      await this.#assertRecoveryCurrent(recovery, deadline, readStartedAt);
      recovery.diagnostic.phase = "RESULT_BINDING";
      recovery.diagnostic.result_status = result.status;
      if (result.status === "UNVERIFIED") {
        recovery.diagnostic.result_reason = result.reason;
        if (result.model_eq_requested !== undefined) recovery.diagnostic.model_eq_requested = result.model_eq_requested;
        if (result.model_eq_family !== undefined) recovery.diagnostic.model_eq_family = result.model_eq_family;
        throw unknownError(recovery);
      }
      if (result.status === "PENDING") {
        recovery.diagnostic.result_reason = result.reason;
        previousDelay = await this.#waitForNext(recovery, deadline, runStartedAt, round, previousDelay);
        continue;
      }
      if (result.chat_uuid !== recovery.chat_uuid || result.message_id !== recovery.bot_message_id ||
          result.provider_chat_id !== recovery.provider_chat_id || result.message_object_id !== recovery.object_id ||
          result.model_type !== recovery.variant || !result.completed || !isSafeUploadReferenceUrl(result.artifact.url) ||
          this.#claimsByIntent.get(recovery.claimKey)?.state !== "OUTCOME_UNKNOWN") throw unknownError(recovery);
      this.#recoveries.delete(recovery.recovery_id);
      this.#releaseClaimByKey(recovery.claimKey);
      return resultFor(recovery, result);
    }
    throw unknownError(recovery);
  }

  async #waitForNext(
    recovery: GenerationRecovery,
    deadline: AbsoluteRequestDeadline,
    startedAt: number,
    round: number,
    previousDelay: number
  ): Promise<number> {
    const elapsed = this.#readNow() - startedAt;
    if (!Number.isSafeInteger(elapsed) || elapsed < 0 || elapsed >= this.#timeoutMs ||
        (recovery.expires_at !== null && recovery.expires_at <= this.#readNow())) {
      throw unknownError(recovery);
    }
    const recoveryBudget = recovery.expires_at === null ? MAX_TIMEOUT_MS : recovery.expires_at - this.#readNow();
    const delay = Math.min(MAX_POLL_DELAY_MS, round === 0 ? this.#pollDelayMs : Math.ceil(previousDelay * PENDING_DELAY_MULTIPLIER),
      this.#timeoutMs - elapsed, recoveryBudget);
    recovery.diagnostic.phase = "RESULT_WAIT";
    if (delay > 0) await this.#await(deadline, () => this.#wait(delay, deadline.signal));
    await this.#assertRecoveryCurrent(recovery, deadline);
    return delay;
  }

  async #getReferenceSet(
    request: ReturnType<typeof snapshotGenerateInput>,
    principal: Readonly<GenerationPrincipalRef>,
    deadline: AbsoluteRequestDeadline
  ): Promise<OwnerKontextImageOwnedReferenceSet> {
    const key = JSON.stringify([request.attemptId, principal.tenant_id, principal.subject_id, request.variant, request.reference_handles]);
    const cached = this.#referenceSets.get(key);
    if (cached) {
      if (cached.expires_at <= this.#readNow()) throw generationError("REFERENCE_UNAVAILABLE");
      return cached.set;
    }
    let pending = this.#referenceSetPending.get(key);
    if (!pending) {
      pending = this.#issuer.issue({ principal, attempt_id: request.attemptId, variant: request.variant,
        reference_handles: request.reference_handles });
      this.#referenceSetPending.set(key, pending);
      void pending.finally(() => {
        if (this.#referenceSetPending.get(key) === pending) this.#referenceSetPending.delete(key);
      }).catch(() => undefined);
    }
    const referenceSet = await this.#await(deadline, () => pending!);
    if (referenceSet.expires_at <= this.#readNow()) throw generationError("REFERENCE_UNAVAILABLE");
    if (this.#referenceSets.size >= MAX_STATES) this.#prune();
    if (this.#referenceSets.size >= MAX_STATES) throw generationError("SERVICE_BUSY");
    this.#referenceSets.set(key, Object.freeze({ set: referenceSet, expires_at: referenceSet.expires_at }));
    return referenceSet;
  }

  #prepareCandidate(
    request: ReturnType<typeof snapshotGenerateInput>,
    principal: Readonly<GenerationPrincipalRef>,
    referenceSet: OwnerKontextImageOwnedReferenceSet
  ): OwnerKontextImagePreparedCandidate {
    this.#assertProfile(request.variant);
    return prepareOwnerKontextImageRequest({ principal, attempt_id: request.attemptId, variant: request.variant,
      parameters: request.parameters, reference_set: referenceSet, workflow_policy: request.workflow_policy,
      prompt: request.prompt }, { catalog: this.#catalog, catalog_version: this.#catalogVersion, now: this.#now });
  }

  #reserve(
    request: ReturnType<typeof snapshotGenerateInput>,
    principal: Readonly<GenerationPrincipalRef>,
    candidate: OwnerKontextImagePreparedCandidate
  ): GenerationClaim {
    this.#prune();
    const intentKey = JSON.stringify([request.attemptId, principal.tenant_id, principal.subject_id,
      request.variant, candidate.request_fingerprint]);
    if (this.#claimsByIntent.has(intentKey)) throw generationError("REFERENCE_ALREADY_CLAIMED");
    if (this.#claimsByIntent.size >= MAX_STATES) throw generationError("SERVICE_BUSY");
    if (this.#claimsByHandle.size + request.reference_handles.length > MAX_REFERENCE_HANDLES) throw generationError("SERVICE_BUSY");
    if (request.reference_handles.some((handle) => this.#claimsByHandle.has(handle))) throw generationError("REFERENCE_ALREADY_CLAIMED");
    const expiresAt = Math.min(candidate.expires_at, this.#readNow() + PROFILE_TTL_MS);
    if (expiresAt <= this.#readNow()) throw generationError("REFERENCE_UNAVAILABLE");
    const claim: GenerationClaim = { claimKey: intentKey, attemptId: request.attemptId, principal, variant: request.variant,
      handles: request.reference_handles, request_fingerprint: candidate.request_fingerprint, expires_at: expiresAt, state: "PREPARING" };
    this.#claimsByIntent.set(intentKey, claim);
    for (const handle of request.reference_handles) this.#claimsByHandle.set(handle, claim);
    return claim;
  }

  #createRecovery(
    request: ReturnType<typeof snapshotGenerateInput>,
    principal: Readonly<GenerationPrincipalRef>,
    candidate: OwnerKontextImagePreparedCandidate,
    referenceSet: OwnerKontextImageOwnedReferenceSet,
    chatUuid: string,
    claim: GenerationClaim
  ): GenerationRecovery {
    this.#prune();
    if (this.#recoveries.size >= MAX_STATES) throw generationError("SERVICE_BUSY");
    const now = this.#readNow();
    const expiresAt = Math.min(candidate.expires_at, referenceSet.expires_at, now + PROFILE_TTL_MS);
    if (expiresAt <= now) throw generationError("REFERENCE_UNAVAILABLE");
    const recovery: GenerationRecovery = {
      recovery_id: `kontext_recovery_${randomUUID()}`, attemptId: request.attemptId, principal, variant: request.variant,
      candidate, referenceSet, request_fingerprint: candidate.request_fingerprint,
      catalog_version: this.#catalogVersion,
      created_at: new Date(now).toISOString(), expires_at: expiresAt, claimKey: claim.claimKey, post_dispatch_witness: null, chat_uuid: chatUuid,
      owner_echo_message_id: null, provider_chat_id: null, bot_message_id: null, object_id: null, diagnostic: initialDiagnostic()
    };
    this.#recoveries.set(recovery.recovery_id, recovery);
    return recovery;
  }

  async #assertCurrent(
    request: ReturnType<typeof snapshotGenerateInput>,
    expectedPrincipal: Readonly<GenerationPrincipalRef>,
    candidate: OwnerKontextImagePreparedCandidate,
    claim: GenerationClaim,
    deadline: AbsoluteRequestDeadline,
    recovery?: GenerationRecovery
  ): Promise<void> {
    deadline.throwIfAborted();
    const current = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline));
    if (!sameGenerationPrincipal(current, expectedPrincipal)) {
      this.#invalidateAttemptState(request.attemptId);
      throw generationError("PRINCIPAL_NOT_LINKED");
    }
    const profile = this.#assertProfile(request.variant);
    if (profile.profile_schema_hash !== candidate.profile_schema_hash || candidate.expires_at <= this.#readNow() ||
        !isOwnerKontextImagePreparedCandidateForPrincipal(candidate, expectedPrincipal, request.attemptId, this.#readNow()) ||
        this.#claimsByIntent.get(claim.claimKey) !== claim ||
        request.reference_handles.some((handle) => this.#claimsByHandle.get(handle) !== claim) ||
        (recovery && ((recovery.expires_at !== null && recovery.expires_at <= this.#readNow()) ||
          this.#recoveries.get(recovery.recovery_id) !== recovery))) {
      throw generationError("REFERENCE_UNAVAILABLE");
    }
  }

  async #assertRecoveryCurrent(recovery: GenerationRecovery, deadline: AbsoluteRequestDeadline, readStartedAt?: number): Promise<void> {
    deadline.throwIfAborted();
    const current = await this.#await(deadline, () => this.#resolvePrincipal(recovery.attemptId, deadline));
    if (!sameGenerationPrincipal(current, recovery.principal)) throw generationError("PRINCIPAL_NOT_LINKED");
    const profile = this.#assertProfile(recovery.variant);
    const witness = recovery.post_dispatch_witness;
    const claim = this.#claimsByIntent.get(recovery.claimKey);
    const now = this.#readNow();
    if (!witness || (recovery.expires_at !== null && recovery.expires_at <= now) ||
        (readStartedAt !== undefined && readStartedAt < recovery.candidate.expires_at && now >= recovery.candidate.expires_at) ||
        witness.attempt_id !== recovery.attemptId || !sameGenerationPrincipal(witness.principal, recovery.principal) ||
        witness.variant !== recovery.variant || witness.profile_schema_hash !== profile.profile_schema_hash ||
        !isDeepStrictEqual(witness.source_binding, profile.source_binding) ||
        witness.catalog_version !== this.#catalogVersion || witness.catalog_version !== recovery.catalog_version ||
        witness.request_fingerprint !== recovery.request_fingerprint || witness.request_fingerprint !== recovery.candidate.request_fingerprint ||
        witness.reference_count !== recovery.referenceSet.reference_count || witness.claim_key !== recovery.claimKey ||
        witness.chat_uuid !== recovery.chat_uuid || recovery.candidate.model_id !== recovery.variant ||
        recovery.candidate.variant !== recovery.variant || recovery.candidate.profile_schema_hash !== witness.profile_schema_hash ||
        !isDeepStrictEqual(recovery.candidate.source_binding, witness.source_binding) ||
        !claim || claim.claimKey !== witness.claim_key || claim.attemptId !== witness.attempt_id ||
        !sameGenerationPrincipal(claim.principal, witness.principal) || claim.variant !== witness.variant ||
        claim.request_fingerprint !== witness.request_fingerprint || recovery.expires_at === null && claim.expires_at !== null ||
        claim.state !== "OUTCOME_UNKNOWN" ||
        this.#recoveries.get(recovery.recovery_id) !== recovery) throw unknownError(recovery);
  }

  #assertProfile(variant: OwnerKontextImageVariant): ReturnType<typeof getOwnerKontextImageSourceProfile> {
    const pinned = this.#profiles.get(variant);
    if (!pinned) throw generationError("MODEL_BINDING_MISMATCH");
    let current: ReturnType<typeof getOwnerKontextImageSourceProfile>;
    try { current = getOwnerKontextImageSourceProfile(variant, this.#catalog, this.#catalogVersion); }
    catch { throw generationError("MODEL_BINDING_MISMATCH"); }
    if (current.profile_schema_hash !== pinned.profile_schema_hash || this.#catalogVersion !== current.public_catalog_version) {
      throw generationError("MODEL_BINDING_MISMATCH");
    }
    return current;
  }

  #assertPreflight(value: OwnerKontextImageGenerationPreflightResult, variant: OwnerKontextImageVariant): void {
    const top = exactRecord(value, ["account", "model_access"], []);
    const account = exactRecord(top.account, ["balance", "subscription", "contract_evidence", "source_build", "observed_at"], []);
    const balance = exactRecord(account.balance, ["unit", "available"], []);
    const subscription = exactRecord(account.subscription, ["active", "plan_type", "end_date", "end_date_kind"], []);
    const access = exactRecord(top.model_access, ["catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live",
      "parameter_keys", "parameters_redacted", "access", "cost", "discount_cost", "free_remaining_generations", "limit", "show_warning", "observed_at"], []);
    const now = this.#readNow();
    const catalogVersion = `${this.#catalog.fetched_at}.${this.#catalog.source_hashes.models.slice(7, 19)}`;
    const model = this.#catalog.getModel(variant);
    if (account.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || account.source_build !== ACCOUNT_SOURCE_BUILD ||
        balance.unit !== "tokens" || !(balance.available === null || typeof balance.available === "string") ||
        !validPaidSubscription(subscription, now) || !isFreshIso(account.observed_at, now) ||
        access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || access.catalog_version !== catalogVersion ||
        access.model_id !== variant || access.ai_name !== "flux" || access.model_type !== variant || access.account_read_live !== true ||
        access.access !== true || access.parameters_redacted !== true || !sameStringArray(access.parameter_keys, []) ||
        !isFreshIso(access.observed_at, now) || !finiteNonnegative(access.cost) || model.id !== variant || model.upstream_id !== variant ||
        model.ai_name !== "flux" || model.active !== true || model.scope !== "image" || !model.modalities.includes("image") ||
        !model.operations.some((op) => op.id === MODEL_OPERATION && op.output_modality === "image")) throw generationError("PREFLIGHT_FAILED");
  }

  #resolveNativeClient(attemptId: string): SyntxChatHttpClient {
    const client = this.#resolveChatClient(attemptId);
    if (!(client instanceof SyntxChatHttpClient) || types.isProxy(client) || Object.getPrototypeOf(client) !== SyntxChatHttpClient.prototype ||
        client.createChat !== NATIVE_METHODS.createChat || client.startKontextImageWithOwnedCandidate !== NATIVE_METHODS.start ||
        client.listMessageCandidates !== NATIVE_METHODS.history || client.listInProgress !== NATIVE_METHODS.inProgress ||
        client.getKontextImageResult !== NATIVE_METHODS.result) throw generationError("MODEL_BINDING_MISMATCH");
    return client;
  }

  async #resolvePrincipal(attemptId: string, deadline: AbsoluteRequestDeadline): Promise<Readonly<GenerationPrincipalRef>> {
    this.#assertOpen();
    this.#prune();
    const current = [...this.#runsByAttempt.get(attemptId) ?? []].length;
    const otherLookups = [...this.#principals.keys()].length;
    if (!this.#principals.has(attemptId) && otherLookups >= MAX_STATES || current > MAX_PENDING) throw generationError("SERVICE_BUSY");
    const epoch = this.#epochs.get(attemptId) ?? 0;
    let principal: Readonly<GenerationPrincipalRef>;
    try {
      principal = await this.#await(deadline, () => resolveOwnerReferencePrincipal({
        binding: this.#binding, attemptId, linkService: this.#linkService
      }));
    } catch (error) {
      if (error instanceof OwnerKontextImageGenerationServiceError) throw error;
      throw generationError("PRINCIPAL_NOT_LINKED");
    }
    deadline.throwIfAborted();
    if (this.#closed || (this.#epochs.get(attemptId) ?? 0) !== epoch || principal.connection_id !== attemptId) {
      throw generationError("PRINCIPAL_NOT_LINKED");
    }
    const snapshot = snapshotGenerationPrincipal(principal);
    const previous = this.#principals.get(attemptId);
    if (previous && !sameGenerationPrincipal(previous.principal, snapshot)) {
      this.#invalidateAttemptState(attemptId);
      throw generationError("PRINCIPAL_NOT_LINKED");
    }
    this.#prune();
    if (!this.#principals.has(attemptId) && this.#principals.size >= MAX_STATES) throw generationError("SERVICE_BUSY");
    this.#principals.set(attemptId, Object.freeze({ principal: snapshot, expiresAt: this.#readNow() + PROFILE_TTL_MS }));
    return snapshot;
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

  #setPhase(claim: GenerationClaim, phase: OwnerKontextImageGenerationPhase, recovery?: GenerationRecovery): void {
    if (recovery) recovery.diagnostic.phase = phase;
    if (claim.state === "PREPARING" && phase === "GENERATION_POST") claim.state = "POST_STARTED";
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
    for (const [id, recovery] of this.#recoveries) if (recovery.expires_at !== null && recovery.expires_at <= now) {
      this.#recoveries.delete(id);
      this.#releaseClaimByKey(recovery.claimKey);
    }
    for (const claim of this.#claimsByIntent.values()) if (claim.expires_at !== null && claim.expires_at <= now) this.#releaseClaim(claim);
    for (const [key, cached] of this.#referenceSets) if (cached.expires_at <= now) this.#referenceSets.delete(key);
    for (const [attemptId, value] of this.#principals) {
      const activeWork = this.#runsByAttempt.has(attemptId) || this.#controllersByAttempt.has(attemptId) ||
        [...this.#claimsByIntent.values()].some((claim) => claim.attemptId === attemptId) ||
        [...this.#recoveries.values()].some((recovery) => recovery.attemptId === attemptId);
      if (value.expiresAt <= now && !activeWork) {
        this.#principals.delete(attemptId);
        this.#releaseEpoch(attemptId);
      }
    }
  }

  #hasAttemptState(attemptId: string): boolean {
    return this.#principals.has(attemptId) || this.#runsByAttempt.has(attemptId) ||
      [...this.#claimsByIntent.values()].some((claim) => claim.attemptId === attemptId) ||
      [...this.#recoveries.values()].some((recovery) => recovery.attemptId === attemptId);
  }

  #invalidateAttemptState(attemptId: string): void {
    if (!this.#hasAttemptState(attemptId)) return;
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    for (const controller of this.#controllersByAttempt.get(attemptId) ?? []) controller.abort();
    this.#clearAttempt(attemptId);
  }

  #clearAttempt(attemptId: string): void {
    this.#principals.delete(attemptId);
    for (const [id, recovery] of this.#recoveries) if (recovery.attemptId === attemptId) this.#recoveries.delete(id);
    for (const claim of this.#claimsByIntent.values()) if (claim.attemptId === attemptId) this.#releaseClaim(claim);
    for (const key of this.#referenceSets.keys()) if (key.startsWith(`["${attemptId}"`)) this.#referenceSets.delete(key);
  }

  #clearAll(): void {
    this.#recoveries.clear(); this.#claimsByIntent.clear(); this.#claimsByHandle.clear();
    this.#referenceSets.clear(); this.#referenceSetPending.clear(); this.#principals.clear(); this.#epochs.clear();
    this.#runsByAttempt.clear(); this.#controllersByAttempt.clear();
  }

  #releaseEpoch(attemptId: string): void {
    if (!this.#runsByAttempt.has(attemptId) && !this.#principals.has(attemptId) &&
        ![...this.#claimsByIntent.values()].some((claim) => claim.attemptId === attemptId) &&
        ![...this.#recoveries.values()].some((recovery) => recovery.attemptId === attemptId)) this.#epochs.delete(attemptId);
  }

  #assertOpen(): void { if (this.#closed) throw generationError("SERVICE_CLOSED"); }

  #readNow(): number {
    const value = this.#now();
    if (!Number.isSafeInteger(value) || value < 0 || value < this.#lastObservedNow) throw generationError("PRE_DISPATCH_FAILED");
    this.#lastObservedNow = value;
    return value;
  }
}

function snapshotGenerateInput(value: unknown): Readonly<OwnerKontextImageGenerateInput> {
  const fields = exactRecord(value, ["attemptId", "variant", "reference_handles", "parameters", "prompt", "workflow_policy"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId) ||
      typeof fields.variant !== "string" || !(KONTEXT_VARIANTS as readonly string[]).includes(fields.variant) ||
      typeof fields.prompt !== "string" || fields.prompt.trim().length === 0 ||
      !isValidPrompt(fields.prompt) || fields.workflow_policy !== "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA") fail("INVALID_REQUEST");
  const variant = fields.variant as OwnerKontextImageVariant;
  let normalized: ReturnType<typeof normalizeOwnerKontextImageParameters>;
  try { normalized = normalizeOwnerKontextImageParameters({ variant, parameters: fields.parameters }); }
  catch { fail("INVALID_REQUEST"); }
  const handles = denseStringArray(fields.reference_handles, 4);
  const policy = normalized.reference_count;
  if (handles.length < policy.minimum || handles.length > policy.maximum || new Set(handles).size !== handles.length ||
      handles.some((handle) => !/^kontext_image_[0-9a-f-]{36}$/u.test(handle))) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, variant, reference_handles: Object.freeze(handles),
    parameters: normalized.parameters, prompt: fields.prompt, workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA" });
}

function snapshotReconcileInput(value: unknown): Readonly<OwnerKontextImageReconcileInput> {
  const fields = exactRecord(value, ["attemptId", "recovery_id"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId) ||
      typeof fields.recovery_id !== "string" || !RECOVERY_PATTERN.test(fields.recovery_id)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, recovery_id: fields.recovery_id });
}

function snapshotRecoveryListInput(value: unknown): Readonly<{ attemptId: string; limit: number }> {
  const fields = exactRecord(value, ["attemptId"], ["limit"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId)) fail("INVALID_REQUEST");
  const limit = fields.limit === undefined ? 20 : fields.limit;
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, limit });
}

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || fields.tenant_id.length === 0 ||
      typeof fields.subject !== "string" || fields.subject.length === 0) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}

function snapshotLinkService(value: unknown): Pick<PerUserLinkService, "getStatus"> {
  if (!value || typeof value !== "object" || types.isProxy(value)) fail("INVALID_REQUEST");
  const method = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(value), "getStatus");
  const own = Object.getOwnPropertyDescriptor(value, "getStatus");
  const getStatus = own && "value" in own ? own.value : method && "value" in method ? method.value : undefined;
  if (typeof getStatus !== "function" || types.isProxy(getStatus)) fail("INVALID_REQUEST");
  return Object.freeze({ getStatus: (binding, attemptId) => Reflect.apply(getStatus, value, [binding, attemptId]) }) as Pick<PerUserLinkService, "getStatus">;
}

function readCatalogVersion(value: unknown): string {
  if (value !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION) fail("MODEL_BINDING_MISMATCH");
  return value;
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); }
  catch { fail("INVALID_REQUEST"); }
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
  const keys = Reflect.ownKeys(descriptors);
  const allowed = [...required, ...optional];
  if (required.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) => typeof key !== "string" ||
      !allowed.includes(key) || !("value" in descriptors[key]!))) fail("INVALID_REQUEST");
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
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(0|[1-9]\d*)$/u.test(key)))) fail("INVALID_REQUEST");
  const result: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor) || typeof descriptor.value !== "string") fail("INVALID_REQUEST");
    result.push(descriptor.value);
  }
  return result;
}

function isValidPrompt(value: string): boolean {
  if (Buffer.byteLength(value, "utf8") > 65_536 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

function boundedInt(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail("INVALID_REQUEST");
  return value;
}

function readClock(value: unknown): () => number {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return () => {
    let result: unknown;
    try { result = Reflect.apply(value, undefined, []); }
    catch { fail("PRE_DISPATCH_FAILED"); }
    if (!Number.isSafeInteger(result) || (result as number) < 0) fail("PRE_DISPATCH_FAILED");
    return result as number;
  };
}

function readWait(value: unknown): NonNullable<OwnerKontextImageGenerationServiceOptions["wait"]> {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return value as NonNullable<OwnerKontextImageGenerationServiceOptions["wait"]>;
}

function waitDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error("ABORTED"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new Error("ABORTED")); };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function validAck(value: unknown, chatUuid: string): value is MediaGenerationReceipt {
  try {
    const fields = exactRecord(value, ["chat_uuid", "message_id"]);
    return fields.chat_uuid === chatUuid && isSafeIdentifier(fields.message_id);
  } catch { return false; }
}

function isSafeIdentifier(value: unknown): value is string { return typeof value === "string" && SAFE_IDENTIFIER.test(value); }
function finiteNonnegative(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function isFreshIso(value: unknown, now: number): boolean {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= now && now - parsed <= MAX_CLOCK_SKEW_MS && new Date(parsed).toISOString() === value;
}
function validPaidSubscription(subscription: Record<string, any>, now: number): boolean {
  if (subscription.active !== true || typeof subscription.plan_type !== "string" || subscription.plan_type.trim() === "" ||
      subscription.plan_type.trim().toLocaleUpperCase("en-US") === "FREE") return false;
  const date = subscription.end_date;
  const kind = subscription.end_date_kind;
  if (date === null || kind === null) return date === null && kind === null;
  if (typeof date !== "string") return false;
  if (kind === "OFFSET_DATETIME") {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(date)) return false;
    const instant = Date.parse(date);
    return Number.isFinite(instant) && instant > now;
  }
  if (kind === "DATE_ONLY") return /^\d{4}-\d{2}-\d{2}$/u.test(date);
  if (kind === "LOCAL_DATETIME") return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/u.test(date);
  return false;
}
function sameStringArray(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
}

function initialDiagnostic(): MutableDiagnostic {
  return { phase: "REQUEST_PREPARE", post_started: false, echo_ack_known: false,
    history_binding: "NONE", history_binding_reason: null, history_get_calls: 0, history_get_calls_saturated: false,
    inprogress_get_calls: 0, inprogress_get_calls_saturated: false, result_get_calls: 0,
    result_get_calls_saturated: false, result_status: "NOT_READ", result_reason: null };
}

function incrementDiagnostic(diagnostic: MutableDiagnostic, kind: "history" | "inprogress" | "result"): void {
  const key = kind === "history" ? "history_get_calls" : kind === "inprogress" ? "inprogress_get_calls" : "result_get_calls";
  const saturated = kind === "history" ? "history_get_calls_saturated" : kind === "inprogress" ? "inprogress_get_calls_saturated" : "result_get_calls_saturated";
  if (diagnostic[key] >= MAX_DIAGNOSTIC_COUNT) { diagnostic[saturated] = true; return; }
  diagnostic[key] += 1;
}

function snapshotDiagnostic(value: MutableDiagnostic): OwnerKontextImageUnknownDiagnostic {
  return Object.freeze({ ...value });
}

function resultFor(recovery: GenerationRecovery, result: Extract<InternalKontextImageResult, { status: "COMPLETE" }>): OwnerKontextImageGenerationResult {
  const settings = recovery.candidate.request.settings;
  return Object.freeze({ status: "result_observed", backend_acceptance: "unproven", ai_name: "flux",
    model_id: recovery.variant, variant: recovery.variant, operation_id: MODEL_OPERATION,
    profile_id: recovery.candidate.profile_id, profile_schema_hash: recovery.candidate.profile_schema_hash,
    catalog_version: recovery.catalog_version,
    request_fingerprint: recovery.request_fingerprint,
    parameters: Object.freeze({ resolution: settings.resolution, cfg: settings.cfg, steps: settings.steps, image_strength: settings.image_strength }),
    requested_resolution: settings.resolution, workflow_policy: recovery.candidate.workflow_policy,
    reference_count: recovery.referenceSet.reference_count, input_images: recovery.candidate.input_images,
    expected_output_geometry: null, actual_image: Object.freeze({ mime_type: result.artifact.mime_type, width: null, height: null }),
    geometry_verified: false, artifact: Object.freeze({ url: result.artifact.url, mime_type: result.artifact.mime_type, mime_source: "URL_EXTENSION" }) });
}

function unknownError(recovery: GenerationRecovery): OwnerKontextImageGenerationServiceError {
  recovery.diagnostic.post_started = true;
  return generationError("OUTCOME_UNKNOWN", recovery.recovery_id, snapshotDiagnostic(recovery.diagnostic));
}

function generationError(code: OwnerKontextImageGenerationServiceErrorCode, recoveryId?: string,
  diagnostic?: OwnerKontextImageUnknownDiagnostic): OwnerKontextImageGenerationServiceError {
  return new OwnerKontextImageGenerationServiceError(code, recoveryId, diagnostic);
}

function fail(code: OwnerKontextImageGenerationServiceErrorCode): never { throw generationError(code); }
