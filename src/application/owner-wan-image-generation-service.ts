import { randomUUID } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import {
  SyntxChatHttpClient,
  type InProgressMessage,
  type InternalWanImageResult,
  type MediaGenerationReceipt,
  type WanImageResultPendingReason,
  type WanImageResultUnverifiedReason
} from "../adapter/syntx/chat-http-client.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import type { AccountStatusResult } from "./account-status.js";
import type { ModelAccessResult } from "./model-access.js";
import {
  OwnerWanImageUploadService,
  OwnerWanImageUploadServiceError
} from "./owner-wan-image-upload-service.js";
import {
  prepareOwnerWanImageRequest,
  isOwnerWanImagePreparedCandidateForPrincipal,
  OwnerWanImagePrepareError,
  type OwnerWanImageBboxCoordinatePolicy,
  type OwnerWanImageInputImageMetadata,
  type OwnerWanImageOwnedReferenceSet,
  type OwnerWanImagePreparedCandidate
} from "./owner-wan-image-request-preparer.js";
import { getOwnerWanImageSourceProfile } from "./owner-wan-image-source-profile.js";
import {
  normalizeOwnerWanImageParameters,
  OwnerWanImageParametersError,
  type OwnerWanImageParameters,
  type OwnerWanImageVariant
} from "./owner-wan-image-parameters.js";
import { OwnerWanImagePromptError } from "./owner-wan-image-prompt.js";
import {
  createOwnerWanImageOneShotPermit,
  OwnerWanImageOneShotPolicyError
} from "./owner-wan-image-one-shot-policy.js";
import {
  correlateOwnerWanImageHistoryBinding,
  type OwnerWanImageHistoryBindingReason
} from "./owner-wan-image-history-binding.js";
import { normalizeOwnerWanImagePrompt } from "./owner-wan-image-prompt.js";

export interface OwnerWanImageGenerationPreflightInput {
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly variant: OwnerWanImageVariant;
  readonly catalog_version: string;
  readonly cost_inputs: Readonly<{ batch_size: number }>;
  readonly request_fingerprint: string;
  readonly signal?: AbortSignal;
}

export interface OwnerWanImageGenerationPreflightResult {
  readonly account: AccountStatusResult;
  readonly model_access: ModelAccessResult;
}

export type OwnerWanImageGenerationPreflight = (
  input: Readonly<OwnerWanImageGenerationPreflightInput>
) => Promise<OwnerWanImageGenerationPreflightResult>;

export interface OwnerWanImageGenerationServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string;
  readonly uploadService: OwnerWanImageUploadService;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly preflight: OwnerWanImageGenerationPreflight;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly pollDelayMs?: number;
  readonly maxPollAttempts?: number;
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export type OwnerWanImageNativeChatClient = Pick<SyntxChatHttpClient,
  "createChat" | "startWanImageWithOwnedCandidate" | "listMessageCandidates" | "listInProgress" | "getWanImageResult">;

export interface OwnerWanImageGenerateInput {
  readonly attemptId: string;
  readonly variant: OwnerWanImageVariant;
  readonly reference_handles: readonly string[];
  readonly parameters: OwnerWanImageParameters;
  readonly prompt: string;
  readonly bbox_coordinate_policy: OwnerWanImageBboxCoordinatePolicy | null;
}

export interface OwnerWanImageReconcileInput {
  readonly attemptId: string;
  readonly recovery_id: string;
}

export interface OwnerWanImageRecoveryListInput {
  readonly attemptId: string;
  readonly limit?: number;
}

export const OWNER_WAN_IMAGE_GENERATION_PHASES = Object.freeze([
  "REQUEST_PREPARE", "PRINCIPAL", "REFERENCE_BINDING", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST",
  "POST_ACK_KNOWN", "HISTORY_GET", "HISTORY_BINDING", "IN_PROGRESS_GET", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"
] as const);

export const OWNER_WAN_IMAGE_GENERATION_ERROR_CODES = Object.freeze([
  "INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH",
  "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED", "REFERENCE_ALREADY_CLAIMED", "PREFLIGHT_FAILED",
  "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"
] as const);

export const OWNER_WAN_IMAGE_GENERATION_RESULT_REASONS = Object.freeze([
  "NO_RESULT_OBJECTS", "RESULT_NOT_COMPLETED", "RESULT_BATCH_PENDING", "RESPONSE_SHAPE_INVALID",
  "OUTER_MESSAGE_MISMATCH", "PROVIDER_CHAT_MISMATCH", "NOT_BOT_MESSAGE", "RESULT_OBJECT_CARDINALITY_INVALID",
  "RESULT_OBJECT_SHAPE_INVALID", "OBJECT_ID_MISMATCH", "OBJECT_MESSAGE_MISMATCH", "OBJECT_TYPE_MISMATCH",
  "MODEL_TYPE_UNAVAILABLE", "MODEL_TYPE_MISMATCH", "RESULT_URL_UNSAFE", "RESULT_OBJECT_DUPLICATE"
] as const);

export const OWNER_WAN_IMAGE_HISTORY_BINDING_REASONS = Object.freeze([
  "INVALID_INPUT", "HISTORY_INCOMPLETE", "HISTORY_SHAPE_INVALID", "HISTORY_PAGE_INVALID", "CHAT_SCOPE_MISMATCH",
  "PROVIDER_CHAT_INVALID", "HISTORY_EMPTY", "HISTORY_MESSAGE_SET_INVALID", "MESSAGE_ID_INVALID", "MESSAGE_ID_DUPLICATE",
  "MESSAGE_CHAT_MISMATCH", "OBJECT_ID_INVALID", "OBJECT_ID_DUPLICATE", "OWNER_ACK_NOT_FOUND", "OWNER_ACK_MISMATCH",
  "OWNER_ACK_AMBIGUOUS", "OWNER_OBJECTS_INVALID", "BOT_MESSAGE_NOT_FOUND", "BOT_MESSAGE_AMBIGUOUS", "BOT_OBJECTS_INVALID",
  "BOT_MODEL_MISMATCH", "BOT_BATCH_EXCEEDS_REQUEST", "BOT_BATCH_PENDING"
] as const);

export type OwnerWanImageGenerationPhase = typeof OWNER_WAN_IMAGE_GENERATION_PHASES[number];
export type OwnerWanImageGenerationResultReason = WanImageResultPendingReason | WanImageResultUnverifiedReason;

export interface OwnerWanImageUnknownDiagnostic {
  readonly phase: OwnerWanImageGenerationPhase;
  readonly post_started: boolean;
  readonly echo_ack_known: boolean;
  readonly history_binding: "NONE" | "PENDING" | "READY" | "INVALID";
  readonly history_binding_reason: OwnerWanImageHistoryBindingReason | null;
  readonly history_get_calls: number;
  readonly history_get_calls_saturated: boolean;
  readonly inprogress_get_calls: number;
  readonly inprogress_get_calls_saturated: boolean;
  readonly result_get_calls: number;
  readonly result_get_calls_saturated: boolean;
  readonly result_status: "NOT_READ" | "PENDING" | "COMPLETE" | "UNVERIFIED";
  readonly result_reason: OwnerWanImageGenerationResultReason | null;
}

export interface OwnerWanImagePublicInputMetadata {
  readonly mime_type: OwnerWanImageInputImageMetadata["mime_type"];
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
}

export interface OwnerWanImageArtifact {
  readonly url: string;
  readonly mime_type: string | null;
  readonly mime_source: "URL_EXTENSION" | "UNKNOWN";
  readonly width: null;
  readonly height: null;
  readonly geometry_verified: false;
}

export interface OwnerWanImageGenerationResult {
  readonly status: "result_observed";
  readonly backend_acceptance: "unproven";
  readonly ai_name: "wan_image";
  readonly model_id: OwnerWanImageVariant;
  readonly variant: OwnerWanImageVariant;
  readonly operation_id: "generate-image";
  readonly profile_id: "wan-image-source-reviewed-v1";
  readonly profile_schema_hash: string;
  readonly catalog_version: string;
  readonly request_fingerprint: string;
  readonly parameters: OwnerWanImageParameters;
  readonly cost_inputs: Readonly<{ batch_size: number }>;
  readonly cost_input_confidence: "SOURCE_JOINED_BATCH_SIZE_ONLY";
  readonly requested_batch_size: number;
  readonly bbox_coordinate_policy: OwnerWanImageBboxCoordinatePolicy | null;
  readonly reference_count: number;
  readonly input_images: readonly OwnerWanImagePublicInputMetadata[];
  readonly artifacts: readonly OwnerWanImageArtifact[];
  readonly expected_output_geometry: null;
  readonly geometry_verified: false;
}

export interface OwnerWanImageRecoveryListItem {
  readonly recovery_id: string;
  readonly created_at: string;
  readonly model_id: OwnerWanImageVariant;
  readonly operation_id: "generate-image";
  readonly status: "OUTCOME_UNKNOWN";
  readonly diagnostic: OwnerWanImageUnknownDiagnostic;
}

export type OwnerWanImageGenerationServiceErrorCode = typeof OWNER_WAN_IMAGE_GENERATION_ERROR_CODES[number];

export class OwnerWanImageGenerationServiceError extends Error {
  readonly diagnostic: OwnerWanImageUnknownDiagnostic | undefined;

  constructor(readonly code: OwnerWanImageGenerationServiceErrorCode, readonly recovery_id?: string,
    diagnostic?: OwnerWanImageUnknownDiagnostic) {
    super(code === "OUTCOME_UNKNOWN"
      ? "The WAN image request may have been dispatched; reconcile with the same recovery handle and do not retry."
      : "The owner WAN image request could not be completed safely.");
    this.name = "OwnerWanImageGenerationServiceError";
    this.diagnostic = code === "OUTCOME_UNKNOWN" ? diagnostic : undefined;
  }
}

export interface OwnerWanImageGenerationService {
  generate(input: OwnerWanImageGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerWanImageGenerationResult>;
  reconcile(input: OwnerWanImageReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerWanImageGenerationResult>;
  listRecoveries(input: OwnerWanImageRecoveryListInput | unknown): Promise<readonly OwnerWanImageRecoveryListItem[]>;
  invalidateAttempt(attemptId: string): Promise<void>;
  close(): Promise<void>;
}

const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE_PATTERN = /^wan_image_[0-9a-f-]{36}$/u;
const RECOVERY_PATTERN = /^wan_image_recovery_[0-9a-f-]{36}$/u;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const VARIANTS = Object.freeze(["wan_25_i2i_preview", "wan_26_image", "wan_27_image", "wan_27_image_pro"] as const);
const PROFILE_TTL_MS = 15 * 60_000;
const MAX_PENDING = 4;
const MAX_STATES = 128;
const MAX_REFERENCE_HANDLES = 128;
const MAX_TIMEOUT_MS = 180_000;
const MAX_POLL_ROUNDS = 32;
const MAX_DIAGNOSTIC_COUNT = 255;
const DEFAULT_POLL_DELAY_MS = 2_000;
const MAX_POLL_DELAY_MS = 40_000;
const MAX_CLOCK_SKEW_MS = 30_000;
const MODEL_OPERATION = "generate-image" as const;
const SOURCE_FETCHED_AT = "2026-10-08T13:18:39.393Z";
const SOURCE_MODEL_HASH = "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444";
const PENDING_DELAY_MULTIPLIER = 1.2;
const NATIVE_METHODS = Object.freeze({
  createChat: SyntxChatHttpClient.prototype.createChat,
  start: SyntxChatHttpClient.prototype.startWanImageWithOwnedCandidate,
  history: SyntxChatHttpClient.prototype.listMessageCandidates,
  inProgress: SyntxChatHttpClient.prototype.listInProgress,
  result: SyntxChatHttpClient.prototype.getWanImageResult
});

interface MutableDiagnostic {
  phase: OwnerWanImageGenerationPhase;
  post_started: boolean;
  echo_ack_known: boolean;
  history_binding: OwnerWanImageUnknownDiagnostic["history_binding"];
  history_binding_reason: OwnerWanImageUnknownDiagnostic["history_binding_reason"];
  history_get_calls: number;
  history_get_calls_saturated: boolean;
  inprogress_get_calls: number;
  inprogress_get_calls_saturated: boolean;
  result_get_calls: number;
  result_get_calls_saturated: boolean;
  result_status: OwnerWanImageUnknownDiagnostic["result_status"];
  result_reason: OwnerWanImageUnknownDiagnostic["result_reason"];
}

type ClaimState = "PREPARING" | "POST_STARTED" | "OUTCOME_UNKNOWN";
interface GenerationClaim {
  readonly claimKey: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly variant: OwnerWanImageVariant;
  readonly handles: readonly string[];
  readonly request_fingerprint: string;
  readonly expires_at: number;
  state: ClaimState;
}

interface GenerationRecovery {
  readonly recovery_id: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly variant: OwnerWanImageVariant;
  readonly candidate: OwnerWanImagePreparedCandidate;
  readonly referenceSet: OwnerWanImageOwnedReferenceSet;
  readonly request_fingerprint: string;
  readonly catalog_version: string;
  readonly created_at: string;
  readonly expires_at: number;
  readonly claimKey: string;
  readonly chat_uuid: string;
  owner_echo_message_id: string | null;
  provider_chat_id: string | null;
  bot_message_id: string | null;
  message_object_ids: readonly string[] | null;
  readonly diagnostic: MutableDiagnostic;
}

interface CachedPrincipal {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly expiresAt: number;
}

export class OwnerWanImageGenerationService implements OwnerWanImageGenerationService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #catalogVersion: string;
  readonly #uploadService: OwnerWanImageUploadService;
  readonly #issuer: ReturnType<OwnerWanImageUploadService["createOwnedReferenceBindingIssuer"]>;
  readonly #resolveChatClient: OwnerWanImageGenerationServiceOptions["resolveChatClient"];
  readonly #preflight: OwnerWanImageGenerationPreflight;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #pollDelayMs: number;
  readonly #maxPollAttempts: number;
  readonly #wait: NonNullable<OwnerWanImageGenerationServiceOptions["wait"]>;
  readonly #profiles = new Map<OwnerWanImageVariant, ReturnType<typeof getOwnerWanImageSourceProfile>>();
  readonly #recoveries = new Map<string, GenerationRecovery>();
  readonly #claimsByIntent = new Map<string, GenerationClaim>();
  readonly #claimsByHandle = new Map<string, GenerationClaim>();
  readonly #principals = new Map<string, CachedPrincipal>();
  readonly #epochs = new Map<string, number>();
  readonly #runs = new Set<Promise<unknown>>();
  readonly #runsByAttempt = new Map<string, Set<Promise<unknown>>>();
  readonly #controllersByAttempt = new Map<string, Set<AbortController>>();
  readonly #invalidatingAttempts = new Set<string>();
  #closed = false;
  #closing: Promise<void> | undefined;
  #lastObservedNow = -1;

  constructor(options: OwnerWanImageGenerationServiceOptions) {
    const fields = exactRecord(options,
      ["binding", "linkService", "catalog", "catalog_version", "uploadService", "resolveChatClient", "preflight"],
      ["now", "timeoutMs", "pollDelayMs", "maxPollAttempts", "wait"]);
    if (!(fields.uploadService instanceof OwnerWanImageUploadService) || types.isProxy(fields.uploadService) ||
        !(fields.catalog instanceof DiscoveryCatalogRepository) || types.isProxy(fields.catalog) ||
        typeof fields.resolveChatClient !== "function" || types.isProxy(fields.resolveChatClient) ||
        typeof fields.preflight !== "function" || types.isProxy(fields.preflight) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now))) ||
        (fields.wait !== undefined && (typeof fields.wait !== "function" || types.isProxy(fields.wait)))) fail("INVALID_REQUEST");
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = snapshotLinkService(fields.linkService);
    this.#catalog = fields.catalog as DiscoveryCatalogRepository;
    this.#catalogVersion = readCatalogVersion(fields.catalog_version);
    this.#uploadService = fields.uploadService as OwnerWanImageUploadService;
    this.#issuer = this.#uploadService.createOwnedReferenceBindingIssuer();
    this.#resolveChatClient = fields.resolveChatClient as OwnerWanImageGenerationServiceOptions["resolveChatClient"];
    this.#preflight = fields.preflight as OwnerWanImageGenerationPreflight;
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    this.#timeoutMs = boundedInt(fields.timeoutMs, 1, MAX_TIMEOUT_MS, MAX_TIMEOUT_MS);
    this.#pollDelayMs = boundedInt(fields.pollDelayMs, 0, MAX_POLL_DELAY_MS, DEFAULT_POLL_DELAY_MS);
    this.#maxPollAttempts = boundedInt(fields.maxPollAttempts, 1, MAX_POLL_ROUNDS, MAX_POLL_ROUNDS);
    this.#wait = fields.wait === undefined ? waitDelay : readWait(fields.wait);
    for (const variant of VARIANTS) {
      const profile = getOwnerWanImageSourceProfile(variant, this.#catalog, this.#catalogVersion);
      if (this.#catalog.fetched_at !== SOURCE_FETCHED_AT || this.#catalog.source_hashes.models !== SOURCE_MODEL_HASH) fail("MODEL_BINDING_MISMATCH");
      this.#profiles.set(variant, profile);
    }
  }

  generate(input: OwnerWanImageGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerWanImageGenerationResult> {
    const request = snapshotGenerateInput(input);
    return this.#run(request.attemptId, signal, (requestSignal) => this.#generate(request, requestSignal));
  }

  reconcile(input: OwnerWanImageReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerWanImageGenerationResult> {
    const request = snapshotReconcileInput(input);
    return this.#run(request.attemptId, signal, (requestSignal) => this.#reconcile(request, requestSignal));
  }

  listRecoveries(input: OwnerWanImageRecoveryListInput | unknown): Promise<readonly OwnerWanImageRecoveryListItem[]> {
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
            model_id: recovery.variant, operation_id: MODEL_OPERATION, status: "OUTCOME_UNKNOWN" as const,
            diagnostic: snapshotDiagnostic(recovery.diagnostic) })));
      } finally { deadline.close(); }
    });
  }

  async invalidateAttempt(attemptId: string): Promise<void> {
    if (typeof attemptId !== "string" || !ATTEMPT_PATTERN.test(attemptId) || this.#invalidatingAttempts.has(attemptId)) return;
    if (!this.#hasAttemptState(attemptId)) {
      this.#issuer.invalidateAttempt(attemptId);
      await this.#uploadService.invalidateAttempt(attemptId);
      return;
    }
    this.#invalidatingAttempts.add(attemptId);
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    for (const controller of this.#controllersByAttempt.get(attemptId) ?? []) controller.abort();
    this.#issuer.invalidateAttempt(attemptId);
    this.#clearAttempt(attemptId);
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
        ...[...this.#claimsByIntent.values()].map((claim) => claim.attemptId)
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

  async #generate(request: Readonly<OwnerWanImageGenerateInput>, signal: AbortSignal): Promise<OwnerWanImageGenerationResult> {
    let claim: GenerationClaim | undefined;
    let recovery: GenerationRecovery | undefined;
    let postStarted = false;
    const deadline = this.#deadline(signal, () => recovery ? unknownError(recovery) : generationError("PRE_DISPATCH_FAILED"));
    try {
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline));
      this.#assertProfile(request.variant);
      const referenceSet = await this.#await(deadline, () => this.#issuer.issue({ principal, attempt_id: request.attemptId,
        variant: request.variant, reference_handles: request.reference_handles }));
      if (referenceSet.expires_at <= this.#readNow()) throw generationError("REFERENCE_EXPIRED");
      const resolvedPrincipal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline));
      if (!sameGenerationPrincipal(resolvedPrincipal, principal)) throw generationError("PRINCIPAL_NOT_LINKED");
      const candidate0 = this.#prepareCandidate(request, principal, referenceSet);
      claim = this.#reserve(request, principal, candidate0);
      const native = this.#resolveNativeClient(request.attemptId);

      // First fresh gate is deliberately before chat creation so a denied account cannot mutate chat state.
      this.#setClaimPhase(claim, "PREFLIGHT");
      const first = await this.#await(deadline, () => this.#runPreflight(request, principal, candidate0, deadline.signal))
        .catch(() => { throw generationError("PREFLIGHT_FAILED"); });
      this.#assertPreflight(first, request.variant);
      this.#assertSynchronousCurrent(request, principal, candidate0, claim, deadline);

      this.#setClaimPhase(claim, "CHAT_CREATE");
      const chat = await this.#await(deadline, () => native.createChat("image", `owner-wan-${randomUUID()}`, deadline.signal));
      if (!isSafeIdentifier(chat.chat_uuid)) throw generationError("PRE_DISPATCH_FAILED");

      // Complete all awaited identity checks before the final admission read.
      await this.#assertCurrent(request, principal, candidate0, claim, deadline);
      const candidate = this.#prepareCandidate(request, principal, referenceSet);
      if (candidate.request_fingerprint !== candidate0.request_fingerprint ||
          !isDeepStrictEqual(candidatePrivateRequest(candidate), candidatePrivateRequest(candidate0)) ||
          !isDeepStrictEqual(candidate.input_images, candidate0.input_images)) {
        throw generationError("PRE_DISPATCH_FAILED");
      }
      this.#setClaimPhase(claim, "PREFLIGHT");
      // This must be the last awaited admission before synchronous rechecks and the one-shot POST.
      const finalPreflight = await this.#await(deadline, () => this.#runPreflight(request, principal, candidate, deadline.signal))
        .catch(() => { throw generationError("PREFLIGHT_FAILED"); });
      this.#assertPreflight(finalPreflight, request.variant);
      this.#assertSynchronousCurrent(request, principal, candidate, claim, deadline);
      this.#ensureRecoveryCapacity();

      recovery = this.#createRecovery(request, principal, candidate, referenceSet, chat.chat_uuid, claim);
      let permit;
      try {
        permit = createOwnerWanImageOneShotPermit({ candidate, principal, attemptId: request.attemptId,
          catalog: this.#catalog, catalog_version: this.#catalogVersion, now: this.#now });
      } catch (error) {
        this.#recoveries.delete(recovery.recovery_id);
        recovery = undefined;
        throw error;
      }
      this.#setClaimPhase(claim, "GENERATION_POST", recovery);
      recovery.diagnostic.post_started = true;
      claim.state = "POST_STARTED";
      postStarted = true;
      const receipt = await this.#await(deadline, () => native.startWanImageWithOwnedCandidate({
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
      if (error instanceof OwnerWanImageGenerationServiceError) throw error;
      if (error instanceof OwnerWanImageUploadServiceError) {
        if (error.code === "SERVICE_BUSY" || error.code === "CAPACITY_EXCEEDED") throw generationError("SERVICE_BUSY");
        if (error.code === "REFERENCE_EXPIRED") throw generationError("REFERENCE_EXPIRED");
        throw generationError("REFERENCE_UNAVAILABLE");
      }
      if (error instanceof OwnerWanImagePrepareError) {
        if (error.code === "PROFILE_BINDING_MISMATCH") throw generationError("MODEL_BINDING_MISMATCH");
        if (error.code === "REFERENCE_EXPIRED") throw generationError("REFERENCE_EXPIRED");
        if (error.code === "REFERENCE_UNAVAILABLE") throw generationError("REFERENCE_UNAVAILABLE");
        throw generationError("INVALID_REQUEST");
      }
      if (error instanceof OwnerWanImageParametersError || error instanceof OwnerWanImagePromptError) throw generationError("INVALID_REQUEST");
      if (error instanceof OwnerWanImageOneShotPolicyError) {
        if (error.code === "CATALOG_BINDING_MISMATCH") throw generationError("MODEL_BINDING_MISMATCH");
        if (error.code === "PERMIT_EXPIRED" || error.code === "CANDIDATE_EXPIRED") throw generationError("REFERENCE_EXPIRED");
        throw generationError("PRE_DISPATCH_FAILED");
      }
      if (error instanceof OwnerReferencePrincipalError) throw generationError("PRINCIPAL_NOT_LINKED");
      throw generationError("PRE_DISPATCH_FAILED");
    } finally { deadline.close(); }
  }

  async #reconcile(request: Readonly<OwnerWanImageReconcileInput>, signal: AbortSignal): Promise<OwnerWanImageGenerationResult> {
    const deadline = this.#deadline(signal, () => {
      const current = this.#recoveries.get(request.recovery_id);
      return current ? unknownError(current) : generationError("RECOVERY_NOT_FOUND");
    });
    let recovery: GenerationRecovery | undefined;
    try {
      this.#prune();
      recovery = this.#recoveries.get(request.recovery_id);
      if (!recovery || recovery.attemptId !== request.attemptId || recovery.expires_at <= this.#readNow()) {
        throw generationError("RECOVERY_NOT_FOUND");
      }
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline));
      if (!sameGenerationPrincipal(principal, recovery.principal)) throw generationError("RECOVERY_NOT_FOUND");
      if (!recovery.owner_echo_message_id) throw unknownError(recovery);
      const client = this.#resolveNativeClient(request.attemptId);
      return await this.#observe(recovery, client, deadline);
    } catch (error) {
      if (error instanceof OwnerWanImageGenerationServiceError && error.code === "RECOVERY_NOT_FOUND") throw error;
      if (!recovery) throw error instanceof OwnerWanImageGenerationServiceError ? error : generationError("PRE_DISPATCH_FAILED");
      throw unknownError(recovery);
    } finally { deadline.close(); }
  }

  async #observe(recovery: GenerationRecovery, client: SyntxChatHttpClient,
    deadline: AbsoluteRequestDeadline): Promise<OwnerWanImageGenerationResult> {
    if (!recovery.owner_echo_message_id) throw unknownError(recovery);
    const runStartedAt = this.#readNow();
    let previousDelay = this.#pollDelayMs;
    for (let round = 0; round < this.#maxPollAttempts; round += 1) {
      deadline.throwIfAborted();
      if (recovery.expires_at <= this.#readNow()) throw unknownError(recovery);
      if (!recovery.bot_message_id || !recovery.provider_chat_id || !recovery.message_object_ids) {
        recovery.diagnostic.phase = "HISTORY_GET";
        incrementDiagnostic(recovery.diagnostic, "history");
        const snapshot = await this.#await(deadline, () => client.listMessageCandidates(
          recovery.chat_uuid, recovery.owner_echo_message_id!, deadline.signal));
        await this.#assertRecoveryCurrent(recovery, deadline);
        recovery.diagnostic.phase = "HISTORY_BINDING";
        const binding = correlateOwnerWanImageHistoryBinding({ snapshot,
          requested_chat_uuid: recovery.chat_uuid, owner_echo_message_id: recovery.owner_echo_message_id,
          scope: "image", variant: recovery.variant, requested_reference_count: recovery.referenceSet.reference_count,
          requested_batch_size: recovery.candidate.cost_inputs.batch_size });
        recovery.diagnostic.history_binding = binding.status;
        recovery.diagnostic.history_binding_reason = binding.status === "INVALID" ? binding.reason : null;
        if (binding.status === "INVALID") throw unknownError(recovery);
        if (binding.status === "READY") {
          recovery.provider_chat_id = binding.provider_chat_id;
          recovery.bot_message_id = binding.message_id;
          recovery.message_object_ids = binding.message_object_ids;
        } else {
          recovery.diagnostic.phase = "IN_PROGRESS_GET";
          incrementDiagnostic(recovery.diagnostic, "inprogress");
          const queue: readonly InProgressMessage[] = await this.#await(deadline,
            () => client.listInProgress(recovery.chat_uuid, deadline.signal));
          await this.#assertRecoveryCurrent(recovery, deadline);
          if (!Array.isArray(queue) || queue.length > 256) throw unknownError(recovery);
          previousDelay = await this.#waitForNext(recovery, deadline, runStartedAt, round, previousDelay);
          continue;
        }
      }

      recovery.diagnostic.phase = "RESULT_GET";
      incrementDiagnostic(recovery.diagnostic, "result");
      const result: InternalWanImageResult = await this.#await(deadline, () => client.getWanImageResult({
        chat_uuid: recovery.chat_uuid, message_id: recovery.bot_message_id!, variant: recovery.variant,
        provider_chat_id: recovery.provider_chat_id!, message_object_ids: recovery.message_object_ids!,
        requested_batch_size: recovery.candidate.cost_inputs.batch_size
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
        previousDelay = await this.#waitForNext(recovery, deadline, runStartedAt, round, previousDelay);
        continue;
      }
      if (!sameWanResultContext(result, recovery) || !isCompleteArtifactBatch(result, recovery) ||
          this.#claimsByIntent.get(recovery.claimKey)?.state !== "OUTCOME_UNKNOWN") throw unknownError(recovery);
      this.#recoveries.delete(recovery.recovery_id);
      this.#releaseClaimByKey(recovery.claimKey);
      return resultFor(recovery, result);
    }
    throw unknownError(recovery);
  }

  async #waitForNext(recovery: GenerationRecovery, deadline: AbsoluteRequestDeadline, startedAt: number,
    round: number, previousDelay: number): Promise<number> {
    const now = this.#readNow();
    const elapsed = now - startedAt;
    if (!Number.isSafeInteger(elapsed) || elapsed < 0 || elapsed >= this.#timeoutMs || recovery.expires_at <= now) {
      throw unknownError(recovery);
    }
    const delay = Math.min(MAX_POLL_DELAY_MS, round === 0 ? this.#pollDelayMs : Math.ceil(previousDelay * PENDING_DELAY_MULTIPLIER),
      this.#timeoutMs - elapsed, recovery.expires_at - now);
    recovery.diagnostic.phase = "RESULT_WAIT";
    if (delay > 0) await this.#await(deadline, () => this.#wait(delay, deadline.signal));
    await this.#assertRecoveryCurrent(recovery, deadline);
    return delay;
  }

  async #runPreflight(request: Readonly<OwnerWanImageGenerateInput>, principal: Readonly<GenerationPrincipalRef>,
    candidate: OwnerWanImagePreparedCandidate, signal: AbortSignal): Promise<OwnerWanImageGenerationPreflightResult> {
    return this.#preflight(Object.freeze({ attemptId: request.attemptId, principal, variant: request.variant,
      catalog_version: this.#catalogVersion, cost_inputs: Object.freeze({ batch_size: candidate.cost_inputs.batch_size }),
      request_fingerprint: candidate.request_fingerprint, signal }));
  }

  #prepareCandidate(request: Readonly<OwnerWanImageGenerateInput>, principal: Readonly<GenerationPrincipalRef>,
    referenceSet: OwnerWanImageOwnedReferenceSet): OwnerWanImagePreparedCandidate {
    this.#assertProfile(request.variant);
    return prepareOwnerWanImageRequest({ principal, attempt_id: request.attemptId, variant: request.variant,
      parameters: request.parameters, reference_set: referenceSet, prompt: request.prompt,
      bbox_coordinate_policy: request.bbox_coordinate_policy },
    { catalog: this.#catalog, catalog_version: this.#catalogVersion, now: this.#now });
  }

  #reserve(request: Readonly<OwnerWanImageGenerateInput>, principal: Readonly<GenerationPrincipalRef>,
    candidate: OwnerWanImagePreparedCandidate): GenerationClaim {
    this.#prune();
    const key = JSON.stringify([request.attemptId, principal.tenant_id, principal.subject_id, request.variant, candidate.request_fingerprint]);
    if (this.#claimsByIntent.has(key)) throw generationError("REFERENCE_ALREADY_CLAIMED");
    if (this.#claimsByIntent.size >= MAX_STATES || this.#recoveries.size >= MAX_STATES ||
        this.#claimsByHandle.size + request.reference_handles.length > MAX_REFERENCE_HANDLES) throw generationError("SERVICE_BUSY");
    if (request.reference_handles.some((handle) => this.#claimsByHandle.has(handle))) throw generationError("REFERENCE_ALREADY_CLAIMED");
    const expiresAt = Math.min(candidate.expires_at, this.#readNow() + PROFILE_TTL_MS);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= this.#readNow()) throw generationError("REFERENCE_EXPIRED");
    const claim: GenerationClaim = { claimKey: key, attemptId: request.attemptId, principal, variant: request.variant,
      handles: request.reference_handles, request_fingerprint: candidate.request_fingerprint,
      expires_at: expiresAt, state: "PREPARING" };
    this.#claimsByIntent.set(key, claim);
    for (const handle of request.reference_handles) this.#claimsByHandle.set(handle, claim);
    return claim;
  }

  #createRecovery(request: Readonly<OwnerWanImageGenerateInput>, principal: Readonly<GenerationPrincipalRef>,
    candidate: OwnerWanImagePreparedCandidate, referenceSet: OwnerWanImageOwnedReferenceSet, chatUuid: string,
    claim: GenerationClaim): GenerationRecovery {
    this.#prune();
    this.#ensureRecoveryCapacity();
    const now = this.#readNow();
    const expiresAt = Math.min(candidate.expires_at, referenceSet.expires_at, now + PROFILE_TTL_MS);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) throw generationError("REFERENCE_EXPIRED");
    const recovery: GenerationRecovery = {
      recovery_id: `wan_image_recovery_${randomUUID()}`, attemptId: request.attemptId, principal, variant: request.variant,
      candidate, referenceSet, request_fingerprint: candidate.request_fingerprint, catalog_version: this.#catalogVersion,
      created_at: new Date(now).toISOString(), expires_at: expiresAt, claimKey: claim.claimKey, chat_uuid: chatUuid,
      owner_echo_message_id: null, provider_chat_id: null, bot_message_id: null, message_object_ids: null,
      diagnostic: initialDiagnostic()
    };
    this.#recoveries.set(recovery.recovery_id, recovery);
    return recovery;
  }

  async #assertCurrent(request: Readonly<OwnerWanImageGenerateInput>, expectedPrincipal: Readonly<GenerationPrincipalRef>,
    candidate: OwnerWanImagePreparedCandidate, claim: GenerationClaim, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted();
    const current = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline));
    if (!sameGenerationPrincipal(current, expectedPrincipal)) {
      this.#invalidateAttemptState(request.attemptId);
      throw generationError("PRINCIPAL_NOT_LINKED");
    }
    this.#assertSynchronousCurrent(request, expectedPrincipal, candidate, claim, deadline);
  }

  #assertSynchronousCurrent(request: Readonly<OwnerWanImageGenerateInput>, expectedPrincipal: Readonly<GenerationPrincipalRef>,
    candidate: OwnerWanImagePreparedCandidate, claim: GenerationClaim, deadline: AbsoluteRequestDeadline,
    recovery?: GenerationRecovery): void {
    deadline.throwIfAborted();
    const now = this.#readNow();
    const cached = this.#principals.get(request.attemptId);
    const profile = this.#assertProfile(request.variant);
    if (this.#closed || this.#invalidatingAttempts.has(request.attemptId) || !cached || cached.expiresAt <= now ||
        !sameGenerationPrincipal(cached.principal, expectedPrincipal) || profile.profile_schema_hash !== candidate.profile_schema_hash ||
        candidate.expires_at <= now || !isOwnerWanImagePreparedCandidateForPrincipal(candidate, expectedPrincipal, request.attemptId, now) ||
        this.#claimsByIntent.get(claim.claimKey) !== claim ||
        request.reference_handles.some((handle) => this.#claimsByHandle.get(handle) !== claim) ||
        (recovery && (recovery.expires_at <= now || this.#recoveries.get(recovery.recovery_id) !== recovery))) {
      throw generationError("REFERENCE_UNAVAILABLE");
    }
  }

  async #assertRecoveryCurrent(recovery: GenerationRecovery, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted();
    const current = await this.#await(deadline, () => this.#resolvePrincipal(recovery.attemptId, deadline));
    const profile = this.#assertProfile(recovery.variant);
    if (!sameGenerationPrincipal(current, recovery.principal) || this.#closed || this.#invalidatingAttempts.has(recovery.attemptId) ||
        profile.profile_schema_hash !== recovery.candidate.profile_schema_hash || recovery.expires_at <= this.#readNow() ||
        !isOwnerWanImagePreparedCandidateForPrincipal(recovery.candidate, recovery.principal, recovery.attemptId, this.#readNow()) ||
        this.#claimsByIntent.get(recovery.claimKey)?.state !== "OUTCOME_UNKNOWN" || this.#recoveries.get(recovery.recovery_id) !== recovery) {
      throw unknownError(recovery);
    }
  }

  #assertProfile(variant: OwnerWanImageVariant): ReturnType<typeof getOwnerWanImageSourceProfile> {
    const pinned = this.#profiles.get(variant);
    if (!pinned) throw generationError("MODEL_BINDING_MISMATCH");
    let current: ReturnType<typeof getOwnerWanImageSourceProfile>;
    try { current = getOwnerWanImageSourceProfile(variant, this.#catalog, this.#catalogVersion); }
    catch { throw generationError("MODEL_BINDING_MISMATCH"); }
    if (current.profile_schema_hash !== pinned.profile_schema_hash || current.public_catalog_version !== this.#catalogVersion) {
      throw generationError("MODEL_BINDING_MISMATCH");
    }
    return current;
  }

  #assertPreflight(value: OwnerWanImageGenerationPreflightResult, variant: OwnerWanImageVariant): void {
    const top = exactRecord(value, ["account", "model_access"]);
    const account = exactRecord(top.account, ["balance", "subscription", "contract_evidence", "source_build", "observed_at"]);
    const balance = exactRecord(account.balance, ["unit", "available"]);
    const subscription = exactRecord(account.subscription, ["active", "plan_type", "end_date", "end_date_kind"]);
    const access = exactRecord(top.model_access, ["catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live",
      "parameter_keys", "parameters_redacted", "access", "cost", "discount_cost", "free_remaining_generations", "limit", "show_warning", "observed_at"]);
    const now = this.#readNow();
    const expectedCatalogVersion = `${this.#catalog.fetched_at}.${this.#catalog.source_hashes.models.slice(7, 19)}`;
    const model = this.#catalog.getModel(variant);
    if (account.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || account.source_build !== ACCOUNT_SOURCE_BUILD ||
        balance.unit !== "tokens" || !(balance.available === null || typeof balance.available === "string") ||
        !validPaidSubscription(subscription, now) || !isFreshIso(account.observed_at, now) ||
        access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || access.catalog_version !== expectedCatalogVersion ||
        access.model_id !== variant || access.ai_name !== "wan_image" || access.model_type !== variant ||
        access.account_read_live !== true || access.access !== true || access.parameters_redacted !== true ||
        !sameStringArray(access.parameter_keys, ["batch_size"]) || !isFreshIso(access.observed_at, now) ||
        !finiteNonnegative(access.cost) || model.id !== variant || model.upstream_id !== variant ||
        model.ai_name !== "wan_image" || model.active !== true || model.scope !== "image" ||
        !model.modalities.includes("image") || !model.operations.some((operation) => operation.id === MODEL_OPERATION && operation.output_modality === "image")) {
      throw generationError("PREFLIGHT_FAILED");
    }
  }

  #resolveNativeClient(attemptId: string): SyntxChatHttpClient {
    const client = this.#resolveChatClient(attemptId);
    if (!(client instanceof SyntxChatHttpClient) || types.isProxy(client) || Object.getPrototypeOf(client) !== SyntxChatHttpClient.prototype ||
        client.createChat !== NATIVE_METHODS.createChat || client.startWanImageWithOwnedCandidate !== NATIVE_METHODS.start ||
        client.listMessageCandidates !== NATIVE_METHODS.history || client.listInProgress !== NATIVE_METHODS.inProgress ||
        client.getWanImageResult !== NATIVE_METHODS.result) throw generationError("MODEL_BINDING_MISMATCH");
    return client;
  }

  async #resolvePrincipal(attemptId: string, deadline: AbsoluteRequestDeadline): Promise<Readonly<GenerationPrincipalRef>> {
    this.#assertOpen();
    this.#prune();
    if (this.#invalidatingAttempts.has(attemptId)) throw generationError("PRINCIPAL_NOT_LINKED");
    const activeRuns = this.#runsByAttempt.get(attemptId)?.size ?? 0;
    if (activeRuns > MAX_PENDING || (!this.#principals.has(attemptId) && this.#principals.size >= MAX_STATES)) throw generationError("SERVICE_BUSY");
    const epoch = this.#epochs.get(attemptId) ?? 0;
    let principal: Readonly<GenerationPrincipalRef>;
    try {
      principal = await this.#await(deadline, () => resolveOwnerReferencePrincipal({
        binding: this.#binding, attemptId, linkService: this.#linkService
      }));
    } catch (error) {
      if (error instanceof OwnerWanImageGenerationServiceError) throw error;
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
    this.#prune();
    if (!this.#principals.has(attemptId) && this.#principals.size >= MAX_STATES) throw generationError("SERVICE_BUSY");
    this.#principals.set(attemptId, Object.freeze({ principal: snapshot, expiresAt: this.#readNow() + PROFILE_TTL_MS }));
    return snapshot;
  }

  #setClaimPhase(claim: GenerationClaim, phase: OwnerWanImageGenerationPhase, recovery?: GenerationRecovery): void {
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
    for (const [id, recovery] of this.#recoveries) if (recovery.expires_at <= now) {
      this.#recoveries.delete(id); this.#releaseClaimByKey(recovery.claimKey);
    }
    for (const claim of this.#claimsByIntent.values()) if (claim.expires_at <= now) this.#releaseClaim(claim);
    for (const [attemptId, cached] of this.#principals) {
      const active = this.#runsByAttempt.has(attemptId) || this.#controllersByAttempt.has(attemptId) ||
        [...this.#claimsByIntent.values()].some((claim) => claim.attemptId === attemptId) ||
        [...this.#recoveries.values()].some((recovery) => recovery.attemptId === attemptId);
      if (cached.expiresAt <= now && !active) { this.#principals.delete(attemptId); this.#releaseEpoch(attemptId); }
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
    this.#issuer.invalidateAttempt(attemptId);
    this.#clearAttempt(attemptId);
  }

  #clearAttempt(attemptId: string): void {
    this.#principals.delete(attemptId);
    for (const [id, recovery] of this.#recoveries) if (recovery.attemptId === attemptId) this.#recoveries.delete(id);
    for (const claim of this.#claimsByIntent.values()) if (claim.attemptId === attemptId) this.#releaseClaim(claim);
  }

  #clearAll(): void {
    this.#recoveries.clear(); this.#claimsByIntent.clear(); this.#claimsByHandle.clear();
    this.#principals.clear(); this.#epochs.clear(); this.#runsByAttempt.clear(); this.#controllersByAttempt.clear();
    this.#invalidatingAttempts.clear();
  }

  #releaseEpoch(attemptId: string): void {
    if (!this.#runsByAttempt.has(attemptId) && !this.#principals.has(attemptId) &&
        ![...this.#claimsByIntent.values()].some((claim) => claim.attemptId === attemptId) &&
        ![...this.#recoveries.values()].some((recovery) => recovery.attemptId === attemptId) &&
        !this.#invalidatingAttempts.has(attemptId)) this.#epochs.delete(attemptId);
  }

  #deadline(signal: AbortSignal, makeError?: () => Error): AbsoluteRequestDeadline {
    return new AbsoluteRequestDeadline(this.#timeoutMs, signal,
      () => makeError?.() ?? generationError("PRE_DISPATCH_FAILED"));
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
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) < this.#lastObservedNow) {
      throw generationError("PRE_DISPATCH_FAILED");
    }
    this.#lastObservedNow = value as number;
    return value as number;
  }
}

function snapshotGenerateInput(value: unknown): Readonly<OwnerWanImageGenerateInput> {
  const fields = exactRecord(value, ["attemptId", "variant", "reference_handles", "parameters", "prompt", "bbox_coordinate_policy"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId) || !isVariant(fields.variant) ||
      typeof fields.prompt !== "string" || !(fields.bbox_coordinate_policy === null ||
        fields.bbox_coordinate_policy === "LOCAL_HEADER_ORIENTATION_PROJECTION_UNVERIFIED_BROWSER")) fail("INVALID_REQUEST");
  const handles = denseStringArray(fields.reference_handles, 9);
  if (handles.some((handle) => !HANDLE_PATTERN.test(handle)) || new Set(handles).size !== handles.length) fail("INVALID_REQUEST");
  let normalized: ReturnType<typeof normalizeOwnerWanImageParameters>;
  try { normalized = normalizeOwnerWanImageParameters({ variant: fields.variant, reference_count: handles.length, parameters: fields.parameters }); }
  catch { fail("INVALID_REQUEST"); }
  try { normalizeOwnerWanImagePrompt({ variant: fields.variant, prompt: fields.prompt }); }
  catch { fail("INVALID_REQUEST"); }
  const anyBox = normalized.parameters.bbox_list.some((referenceBoxes) => referenceBoxes.length > 0);
  if ((anyBox && fields.bbox_coordinate_policy !== "LOCAL_HEADER_ORIENTATION_PROJECTION_UNVERIFIED_BROWSER") ||
      (!anyBox && fields.bbox_coordinate_policy !== null)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId as string, variant: fields.variant,
    reference_handles: Object.freeze(handles), parameters: normalized.parameters, prompt: fields.prompt,
    bbox_coordinate_policy: fields.bbox_coordinate_policy as OwnerWanImageBboxCoordinatePolicy | null });
}

function snapshotReconcileInput(value: unknown): Readonly<OwnerWanImageReconcileInput> {
  const fields = exactRecord(value, ["attemptId", "recovery_id"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId) || typeof fields.recovery_id !== "string" ||
      !RECOVERY_PATTERN.test(fields.recovery_id)) fail("INVALID_REQUEST");
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

function readWait(value: unknown): NonNullable<OwnerWanImageGenerationServiceOptions["wait"]> {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return value as NonNullable<OwnerWanImageGenerationServiceOptions["wait"]>;
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

function isFreshIso(value: unknown, now: number): boolean {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= now && now - parsed <= MAX_CLOCK_SKEW_MS && new Date(parsed).toISOString() === value;
}

function finiteNonnegative(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function sameStringArray(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
}
function isSafeIdentifier(value: unknown): value is string { return typeof value === "string" && SAFE_IDENTIFIER.test(value); }
function isVariant(value: unknown): value is OwnerWanImageVariant { return typeof value === "string" && VARIANTS.includes(value as OwnerWanImageVariant); }

function initialDiagnostic(): MutableDiagnostic {
  return { phase: "REQUEST_PREPARE", post_started: false, echo_ack_known: false, history_binding: "NONE",
    history_binding_reason: null, history_get_calls: 0, history_get_calls_saturated: false,
    inprogress_get_calls: 0, inprogress_get_calls_saturated: false, result_get_calls: 0,
    result_get_calls_saturated: false, result_status: "NOT_READ", result_reason: null };
}

function incrementDiagnostic(diagnostic: MutableDiagnostic, kind: "history" | "inprogress" | "result"): void {
  const countKey = kind === "history" ? "history_get_calls" : kind === "inprogress" ? "inprogress_get_calls" : "result_get_calls";
  const saturatedKey = kind === "history" ? "history_get_calls_saturated" : kind === "inprogress" ? "inprogress_get_calls_saturated" : "result_get_calls_saturated";
  if (diagnostic[countKey] >= MAX_DIAGNOSTIC_COUNT) { diagnostic[saturatedKey] = true; return; }
  diagnostic[countKey] += 1;
}

function snapshotDiagnostic(value: MutableDiagnostic): OwnerWanImageUnknownDiagnostic { return Object.freeze({ ...value }); }

function sameWanResultContext(result: InternalWanImageResult, recovery: GenerationRecovery): boolean {
  return result.chat_uuid === recovery.chat_uuid && result.message_id === recovery.bot_message_id &&
    result.variant === recovery.variant && result.provider_chat_id === recovery.provider_chat_id &&
    result.requested_batch_size === recovery.candidate.cost_inputs.batch_size &&
    isDeepStrictEqual(result.message_object_ids, recovery.message_object_ids);
}

function isCompleteArtifactBatch(result: Extract<InternalWanImageResult, { status: "COMPLETE" }>, recovery: GenerationRecovery): boolean {
  const expected = recovery.message_object_ids;
  if (!expected || result.completed !== true || result.model_type !== recovery.variant ||
      result.artifacts.length !== recovery.candidate.cost_inputs.batch_size || result.artifacts.length !== expected.length) return false;
  const ids = new Set<string>();
  const urls = new Set<string>();
  for (let index = 0; index < expected.length; index += 1) {
    const artifact = result.artifacts[index];
    if (!artifact || artifact.message_object_id !== expected[index] || artifact.message_id !== recovery.bot_message_id ||
        artifact.object_type !== "image" || artifact.model_type !== recovery.variant || artifact.completed !== true ||
        !isSafeUploadReferenceUrl(artifact.url) || ids.has(artifact.message_object_id) || urls.has(artifact.url) ||
        (artifact.mime_source === "UNKNOWN" ? artifact.mime_type !== null : artifact.mime_source !== "URL_EXTENSION" || typeof artifact.mime_type !== "string")) return false;
    ids.add(artifact.message_object_id); urls.add(artifact.url);
  }
  return true;
}

function resultFor(recovery: GenerationRecovery, result: Extract<InternalWanImageResult, { status: "COMPLETE" }>): OwnerWanImageGenerationResult {
  const publicImages = recovery.candidate.input_images.map((image) => Object.freeze({ mime_type: image.mime_type,
    width: image.width, height: image.height, size: image.size, sha256: image.sha256, metadata_confidence: image.metadata_confidence }));
  const artifacts = result.artifacts.map((artifact) => Object.freeze({ url: artifact.url, mime_type: artifact.mime_type,
    mime_source: artifact.mime_source, width: null, height: null, geometry_verified: false as const }));
  return Object.freeze({ status: "result_observed", backend_acceptance: "unproven", ai_name: "wan_image",
    model_id: recovery.variant, variant: recovery.variant, operation_id: MODEL_OPERATION,
    profile_id: recovery.candidate.profile_id, profile_schema_hash: recovery.candidate.profile_schema_hash,
    catalog_version: recovery.catalog_version, request_fingerprint: recovery.request_fingerprint,
    parameters: snapshotPublicParameters(candidatePrivateRequest(recovery.candidate).settings),
    cost_inputs: Object.freeze({ batch_size: recovery.candidate.cost_inputs.batch_size }),
    cost_input_confidence: "SOURCE_JOINED_BATCH_SIZE_ONLY", requested_batch_size: recovery.candidate.cost_inputs.batch_size,
    bbox_coordinate_policy: recovery.candidate.bbox_coordinate_policy, reference_count: recovery.referenceSet.reference_count,
    input_images: Object.freeze(publicImages), artifacts: Object.freeze(artifacts), expected_output_geometry: null, geometry_verified: false });
}

function candidatePrivateRequest(candidate: OwnerWanImagePreparedCandidate): Readonly<{ prompt: string; settings: unknown }> {
  const value = (candidate as OwnerWanImagePreparedCandidate & { readonly request?: unknown }).request;
  const request = exactRecord(value, ["prompt", "settings"]);
  if (typeof request.prompt !== "string") fail("MODEL_BINDING_MISMATCH");
  return Object.freeze({ prompt: request.prompt, settings: request.settings });
}

function snapshotPublicParameters(value: unknown): OwnerWanImageParameters {
  const settings = exactRecord(value, ["n", "model_type", "aspect_ratio", "resolution", "batch_size", "prompt_extend", "seed", "color_palette", "bbox_list", "file_urls"]);
  const result = normalizeOwnerWanImageParameters({ variant: settings.model_type,
    reference_count: Array.isArray(settings.file_urls) ? settings.file_urls.length : -1,
    parameters: { aspect_ratio: settings.aspect_ratio, resolution: settings.resolution, batch_size: settings.batch_size,
      prompt_extend: settings.prompt_extend, seed: settings.seed, color_palette: settings.color_palette, bbox_list: settings.bbox_list } });
  return result.parameters;
}

function unknownError(recovery: GenerationRecovery): OwnerWanImageGenerationServiceError {
  recovery.diagnostic.post_started = true;
  return generationError("OUTCOME_UNKNOWN", recovery.recovery_id, snapshotDiagnostic(recovery.diagnostic));
}

function generationError(code: OwnerWanImageGenerationServiceErrorCode, recoveryId?: string,
  diagnostic?: OwnerWanImageUnknownDiagnostic): OwnerWanImageGenerationServiceError {
  return new OwnerWanImageGenerationServiceError(code, recoveryId, diagnostic);
}

function fail(code: OwnerWanImageGenerationServiceErrorCode): never { throw generationError(code); }
