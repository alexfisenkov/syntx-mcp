import { randomUUID } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { SyntxChatHttpClient, type MediaGenerationReceipt } from "../adapter/syntx/chat-http-client.js";
import type {
  InternalOwnerIdeogramImageResult,
  OwnerIdeogramImageResultPendingReason,
  OwnerIdeogramImageResultPartialReason,
  OwnerIdeogramImageResultUnverifiedReason
} from "../adapter/syntx/ideogram-image-result.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { schemaHash } from "../domain/generation-contract.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import type { AccountStatusResult } from "./account-status.js";
import type { ModelAccessResult } from "./model-access.js";
import { OwnerIdeogramImageUploadService, OwnerIdeogramImageUploadServiceError } from "./owner-ideogram-image-upload-service.js";
import { OwnerIdeogramImageMaskUploadService, OwnerIdeogramImageMaskUploadServiceError,
  type OwnerIdeogramPrivateMaskResolution } from "./owner-ideogram-image-mask-upload-service.js";
import {
  createOwnerIdeogramImageAssetBindingIssuer,
  prepareOwnerIdeogramImageRequest,
  isOwnerIdeogramImagePreparedCandidateForPrincipal,
  getOwnerIdeogramImagePreparedCandidateState,
  observeOwnerIdeogramImageCandidateClock,
  OwnerIdeogramImageRequestPreparerError,
  type OwnerIdeogramImageAssetBindingIssuer,
  type OwnerIdeogramImageAssetSet,
  type OwnerIdeogramImagePreparedCandidate
} from "./owner-ideogram-image-request-preparer.js";
import { getOwnerIdeogramImageSourceProfile, type OwnerIdeogramImageSourceProfile } from "./owner-ideogram-image-source-profile.js";
import {
  OWNER_IDEOGRAM_IMAGE_CONTEXTS,
  normalizeOwnerIdeogramImageParameters,
  type OwnerIdeogramImageMode,
  type OwnerIdeogramImageModelId,
  type OwnerIdeogramImageNormalizedParameters
} from "./owner-ideogram-image-parameters.js";
import { createOwnerIdeogramImageOneShotPermit, OwnerIdeogramImageOneShotPolicyError } from "./owner-ideogram-image-one-shot-policy.js";
import {
  correlateOwnerIdeogramImageHistoryBinding,
  type OwnerIdeogramImageHistoryBindingReason
} from "./owner-ideogram-image-history-binding.js";

type ClaimState = "PREPARING" | "POST_STARTED" | "OUTCOME_UNKNOWN";
interface Claim {
  readonly key: string;
  readonly assetSetKey: string;
  attemptId: string | null;
  principal: Readonly<GenerationPrincipalRef> | null;
  readonly handles: Set<string>;
  readonly private_expires_at: number;
  readonly maskIntentKey?: string;
  state: ClaimState;
}
interface Recovery {
  readonly recovery_id: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: OwnerIdeogramImageModelId;
  readonly mode: OwnerIdeogramImageMode;
  readonly candidate: OwnerIdeogramImagePreparedCandidate;
  readonly assetSet: OwnerIdeogramImageAssetSet;
  readonly catalog_version: string;
  readonly created_at: string;
  expires_at: number | null;
  readonly claimKey: string;
  readonly chat_uuid: string;
  readonly output_count: number;
  readonly mask_present: boolean;
  owner_echo_message_id: string | null;
  provider_chat_id: string | null;
  result_message_id: string | null;
  message_object_ids: readonly string[] | null;
  readonly diagnostic: MutableDiagnostic;
}
interface CachedPrincipal { readonly principal: Readonly<GenerationPrincipalRef>; readonly expiresAt: number; }
interface CachedAssetSet {
  readonly set: OwnerIdeogramImageAssetSet;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly expiresAt: number;
}
interface PendingAssetSet { readonly attemptId: string; readonly promise: Promise<OwnerIdeogramImageAssetSet>; }
type MutableDiagnostic = { -readonly [K in keyof OwnerIdeogramImageGenerationDiagnostic]: OwnerIdeogramImageGenerationDiagnostic[K] };
interface GenerateRequest {
  readonly attemptId: string;
  readonly model_id: OwnerIdeogramImageModelId;
  readonly mode: OwnerIdeogramImageMode;
  readonly prompt: string | null;
  readonly reference_handles: readonly string[];
  readonly mask_handle?: string;
  readonly normalized: OwnerIdeogramImageNormalizedParameters;
}

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const IMAGE_HANDLE = /^ideogram_image_[0-9a-f-]{36}$/u;
const MASK_HANDLE = /^ideogram_mask_[0-9a-f-]{36}$/u;
const RECOVERY = /^ideogram_image_recovery_[0-9a-f-]{36}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const TTL_MS = 15 * 60_000;
const MAX_PENDING = 4;
const MAX_STATES = 128;
const MAX_TIMEOUT_MS = 180_000;
const MAX_POLL_ROUNDS = 32;
const MAX_POLL_DELAY_MS = 40_000;
const MAX_DIAGNOSTIC_COUNT = 255;
const DEFAULT_POLL_DELAY_MS = 2_000;
const MAX_CLOCK_SKEW_MS = 30_000;
const OPERATION = "generate-image" as const;
const NATIVE_METHODS = Object.freeze({ createChat: SyntxChatHttpClient.prototype.createChat,
  start: SyntxChatHttpClient.prototype.startIdeogramImageWithOwnedCandidate,
  history: SyntxChatHttpClient.prototype.listMessageCandidates,
  result: SyntxChatHttpClient.prototype.getIdeogramImageResult });
const MASK_RESOLVE_METHOD = OwnerIdeogramImageMaskUploadService.prototype.resolveMask;

export interface OwnerIdeogramImageGenerationPreflightInput {
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: OwnerIdeogramImageModelId;
  readonly mode: OwnerIdeogramImageMode;
  readonly catalog_version: string;
  readonly cost_inputs: Readonly<Record<string, string | number>>;
  readonly request_fingerprint: string;
  readonly signal?: AbortSignal;
}
export interface OwnerIdeogramImageGenerationPreflightResult { readonly account: AccountStatusResult; readonly model_access: ModelAccessResult; }
export type OwnerIdeogramImageGenerationPreflight = (input: Readonly<OwnerIdeogramImageGenerationPreflightInput>) => Promise<OwnerIdeogramImageGenerationPreflightResult>;
export interface OwnerIdeogramImageGenerationServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string;
  readonly uploadService: OwnerIdeogramImageUploadService;
  readonly maskUploadService?: OwnerIdeogramImageMaskUploadService;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly preflight: OwnerIdeogramImageGenerationPreflight;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly pollDelayMs?: number;
  readonly maxPollAttempts?: number;
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}
export interface OwnerIdeogramImageGenerateInput {
  readonly attemptId: string;
  readonly model_id: OwnerIdeogramImageModelId;
  readonly mode: OwnerIdeogramImageMode;
  readonly prompt: string | null;
  readonly reference_handles: readonly string[];
  readonly mask_handle?: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}
export interface OwnerIdeogramImageReconcileInput { readonly attemptId: string; readonly recovery_id: string; }
export interface OwnerIdeogramImageRecoveryListInput { readonly attemptId: string; readonly limit?: number; }

export const OWNER_IDEOGRAM_IMAGE_GENERATION_PHASES = Object.freeze([
  "REQUEST_PREPARE", "PRINCIPAL", "ASSET_BINDING", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST", "POST_ACK_KNOWN",
  "HISTORY_GET", "HISTORY_BINDING", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"
] as const);
export const OWNER_IDEOGRAM_IMAGE_GENERATION_ERROR_CODES = Object.freeze([
  "INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH",
  "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED", "REFERENCE_ALREADY_CLAIMED", "PREFLIGHT_FAILED",
  "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"
] as const);
export type OwnerIdeogramImageGenerationPhase = typeof OWNER_IDEOGRAM_IMAGE_GENERATION_PHASES[number];
export type OwnerIdeogramImageGenerationResultReason = OwnerIdeogramImageResultPendingReason | OwnerIdeogramImageResultPartialReason | OwnerIdeogramImageResultUnverifiedReason;
export const OWNER_IDEOGRAM_IMAGE_GENERATION_HISTORY_REASONS = Object.freeze([
  "INVALID_INPUT", "HISTORY_INCOMPLETE", "HISTORY_SHAPE_INVALID", "HISTORY_PAGE_INVALID", "CHAT_SCOPE_MISMATCH",
  "PROVIDER_CHAT_INVALID", "HISTORY_EMPTY", "HISTORY_MESSAGE_SET_INVALID", "MESSAGE_ID_INVALID", "MESSAGE_ID_DUPLICATE",
  "MESSAGE_CHAT_MISMATCH", "OBJECT_ID_INVALID", "OBJECT_ID_DUPLICATE", "OWNER_ACK_NOT_FOUND", "OWNER_ACK_MISMATCH",
  "OWNER_ACK_AMBIGUOUS", "BOT_MESSAGE_NOT_FOUND", "BOT_MESSAGE_AMBIGUOUS", "BOT_MESSAGE_BEFORE_ACK", "BOT_MODEL_MISMATCH",
  "BOT_OUTPUT_COUNT_INVALID", "OUTPUT_BATCH_PARTIAL", "MASK_ROLE_ECHO_NOT_SOURCE_BOUND"
] as const satisfies readonly OwnerIdeogramImageHistoryBindingReason[]);
export const OWNER_IDEOGRAM_IMAGE_GENERATION_RESULT_REASONS = Object.freeze([
  "NO_RESULT_OBJECTS", "RESULT_NOT_COMPLETED", "OUTPUT_BATCH_PARTIAL", "SOME_RESULTS_NOT_COMPLETED", "RESPONSE_SHAPE_INVALID",
  "OUTER_MESSAGE_MISMATCH", "PROVIDER_CHAT_MISMATCH", "NOT_BOT_MESSAGE", "OUTPUT_COUNT_INVALID", "RESULT_OBJECT_SHAPE_INVALID",
  "OBJECT_ID_MISMATCH", "OBJECT_MESSAGE_MISMATCH", "OBJECT_TYPE_MISMATCH", "MODEL_TYPE_UNAVAILABLE", "MODEL_TYPE_MISMATCH", "RESULT_URL_UNSAFE"
] as const satisfies readonly OwnerIdeogramImageGenerationResultReason[]);
const HISTORY_REASONS_EXACT: [Exclude<OwnerIdeogramImageHistoryBindingReason, typeof OWNER_IDEOGRAM_IMAGE_GENERATION_HISTORY_REASONS[number]>,
  Exclude<typeof OWNER_IDEOGRAM_IMAGE_GENERATION_HISTORY_REASONS[number], OwnerIdeogramImageHistoryBindingReason>] extends [never, never] ? true : never = true;
const RESULT_REASONS_EXACT: [Exclude<OwnerIdeogramImageGenerationResultReason, typeof OWNER_IDEOGRAM_IMAGE_GENERATION_RESULT_REASONS[number]>,
  Exclude<typeof OWNER_IDEOGRAM_IMAGE_GENERATION_RESULT_REASONS[number], OwnerIdeogramImageGenerationResultReason>] extends [never, never] ? true : never = true;
void HISTORY_REASONS_EXACT; void RESULT_REASONS_EXACT;

export interface OwnerIdeogramImageGenerationDiagnostic {
  readonly phase: OwnerIdeogramImageGenerationPhase;
  readonly post_started: boolean;
  readonly echo_ack_known: boolean;
  readonly history_binding: "NONE" | "PENDING" | "PARTIAL" | "READY" | "INVALID" | "NOT_VERIFIABLE";
  readonly history_binding_reason: OwnerIdeogramImageHistoryBindingReason | null;
  readonly history_get_calls: number;
  readonly history_get_calls_saturated: boolean;
  readonly result_get_calls: number;
  readonly result_get_calls_saturated: boolean;
  readonly result_status: "NOT_READ" | "PENDING" | "PARTIAL" | "COMPLETE" | "UNVERIFIED";
  readonly result_reason: OwnerIdeogramImageGenerationResultReason | null;
}
export interface OwnerIdeogramImageArtifact {
  readonly url: string;
  readonly mime_type: string | null;
  readonly mime_source: "URL_EXTENSION" | "UNKNOWN";
  readonly width: null;
  readonly height: null;
  readonly geometry_verified: false;
}
export interface OwnerIdeogramImageGenerationResult {
  readonly status: "result_observed";
  readonly namespace_confidence: "SOURCE_SHAPED_UNVERIFIED";
  readonly backend_acceptance: "UNPROVEN";
  readonly mode_confidence: "PRIVATE_REQUEST_CONTEXT_NOT_PROVIDER_ECHO";
  readonly ai_name: "ideogram";
  readonly model_id: OwnerIdeogramImageModelId;
  readonly mode: OwnerIdeogramImageMode;
  readonly operation_id: "generate-image";
  readonly profile_id: string;
  readonly profile_schema_hash: string;
  readonly catalog_version: string;
  readonly reference_count: number;
  readonly mask_present: boolean;
  readonly mask_acceptance: "UNPROVEN" | "NOT_REQUESTED";
  readonly output_count: number;
  readonly cost_input_confidence: string;
  readonly artifacts: readonly OwnerIdeogramImageArtifact[];
}
export interface OwnerIdeogramImageRecoveryListItem {
  readonly recovery_id: string;
  readonly created_at: string;
  readonly model_id: OwnerIdeogramImageModelId;
  readonly mode: OwnerIdeogramImageMode;
  readonly mask_present: boolean;
  readonly mask_acceptance: "UNPROVEN" | "NOT_REQUESTED";
  readonly status: "OUTCOME_UNKNOWN";
  readonly diagnostic: OwnerIdeogramImageGenerationDiagnostic;
}
export type OwnerIdeogramImageGenerationServiceErrorCode = typeof OWNER_IDEOGRAM_IMAGE_GENERATION_ERROR_CODES[number];
export class OwnerIdeogramImageGenerationServiceError extends Error {
  readonly diagnostic: OwnerIdeogramImageGenerationDiagnostic | undefined;
  constructor(readonly code: OwnerIdeogramImageGenerationServiceErrorCode, readonly recovery_id?: string, diagnostic?: OwnerIdeogramImageGenerationDiagnostic) {
    super(code === "OUTCOME_UNKNOWN" ? "The Ideogram image request may have been dispatched; reconcile with the same recovery handle and do not retry."
      : "The owner Ideogram image request could not be completed safely.");
    this.name = "OwnerIdeogramImageGenerationServiceError";
    this.diagnostic = code === "OUTCOME_UNKNOWN" ? diagnostic : undefined;
  }
}
export interface OwnerIdeogramImageGenerationService {
  generate(input: OwnerIdeogramImageGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerIdeogramImageGenerationResult>;
  reconcile(input: OwnerIdeogramImageReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerIdeogramImageGenerationResult>;
  listRecoveries(input: OwnerIdeogramImageRecoveryListInput | unknown): Promise<readonly OwnerIdeogramImageRecoveryListItem[]>;
  invalidateAttempt(attemptId: string): Promise<void>;
  close(): Promise<void>;
}

function initialDiagnostic(): MutableDiagnostic {
  return { phase: "REQUEST_PREPARE", post_started: false, echo_ack_known: false, history_binding: "NONE", history_binding_reason: null,
    history_get_calls: 0, history_get_calls_saturated: false, result_get_calls: 0, result_get_calls_saturated: false,
    result_status: "NOT_READ", result_reason: null };
}
function incrementDiagnostic(diagnostic: MutableDiagnostic, kind: "history" | "result"): void {
  const key = kind === "history" ? "history_get_calls" : "result_get_calls";
  const saturated = kind === "history" ? "history_get_calls_saturated" : "result_get_calls_saturated";
  if (diagnostic[key] >= MAX_DIAGNOSTIC_COUNT) { diagnostic[saturated] = true; return; }
  diagnostic[key] += 1;
}
function sameCandidate(left: OwnerIdeogramImagePreparedCandidate, right: OwnerIdeogramImagePreparedCandidate): boolean {
  return left.request_fingerprint === right.request_fingerprint && left.intent_fingerprint === right.intent_fingerprint &&
    isDeepStrictEqual(left.request, right.request) && isDeepStrictEqual(left.parameters, right.parameters) &&
    isDeepStrictEqual(left.cost_inputs, right.cost_inputs) && isDeepStrictEqual(left.references, right.references) &&
    left.prompt === right.prompt && left.mode === right.mode && left.model_id === right.model_id &&
    left.mask_present === right.mask_present && isDeepStrictEqual(left.mask_binding, right.mask_binding);
}
function sameAssetSetMask(set: OwnerIdeogramImageAssetSet, mask?: OwnerIdeogramPrivateMaskResolution): boolean {
  if (mask === undefined) return set.mask_present === false && set.mask_binding === undefined;
  const binding = set.mask_binding;
  return set.mask_present === true && binding !== undefined && binding.role === "mask" &&
    binding.mask_handle === mask.mask_handle && binding.base_reference_handle === mask.base_reference_handle &&
    binding.base_sha256 === mask.base_sha256 && binding.pair_sha256 === mask.pair_sha256 &&
    binding.normal_sha256 === mask.normal_sha256 && binding.inverse_sha256 === mask.inverse_sha256 &&
    binding.width === mask.width && binding.height === mask.height && binding.expires_at === mask.expires_at &&
    binding.epoch === mask.epoch && binding.base_epoch === mask.base_epoch &&
    binding.geometry_verified === false && binding.confidence_scope === "LOCAL_MASK_BYTES_ONLY_NOT_PROVIDER_ACCEPTANCE";
}
function sameResult(result: InternalOwnerIdeogramImageResult, recovery: Recovery): boolean {
  return result.chat_uuid === recovery.chat_uuid && result.message_id === recovery.result_message_id &&
    result.model_id === recovery.model_id && result.mode === recovery.mode && result.requested_mask_present === recovery.mask_present &&
    result.provider_chat_id === recovery.provider_chat_id && result.output_count === recovery.output_count &&
    result.status === "COMPLETE" && result.artifacts.length === recovery.output_count &&
    isDeepStrictEqual(result.message_object_ids, recovery.message_object_ids);
}

export class OwnerIdeogramImageGenerationService implements OwnerIdeogramImageGenerationService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #catalogVersion: string;
  readonly #uploadService: OwnerIdeogramImageUploadService;
  readonly #maskUploadService: OwnerIdeogramImageMaskUploadService | undefined;
  readonly #assetIssuer: OwnerIdeogramImageAssetBindingIssuer;
  readonly #resolveChatClient: OwnerIdeogramImageGenerationServiceOptions["resolveChatClient"];
  readonly #preflight: OwnerIdeogramImageGenerationPreflight;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #pollDelayMs: number;
  readonly #maxPollAttempts: number;
  readonly #wait: NonNullable<OwnerIdeogramImageGenerationServiceOptions["wait"]>;
  readonly #profiles = new Map<string, Readonly<OwnerIdeogramImageSourceProfile>>();
  readonly #recoveries = new Map<string, Recovery>();
  readonly #claimsByIntent = new Map<string, Claim>();
  readonly #claimsByHandle = new Map<string, Claim>();
  readonly #claimsByAssetSetKey = new Map<string, Claim>();
  readonly #claimsByMaskIntent = new Map<string, Claim>();
  readonly #assetSets = new Map<string, CachedAssetSet>();
  readonly #expiredAssetSetKeys = new Set<string>();
  readonly #assetSetPending = new Map<string, PendingAssetSet>();
  readonly #principals = new Map<string, CachedPrincipal>();
  readonly #epochs = new Map<string, number>();
  readonly #runs = new Set<Promise<unknown>>();
  readonly #runsByAttempt = new Map<string, Set<Promise<unknown>>>();
  readonly #controllersByAttempt = new Map<string, Set<AbortController>>();
  readonly #candidatePreparationsByAttempt = new Map<string, Set<Promise<OwnerIdeogramImagePreparedCandidate>>>();
  readonly #invalidatingAttempts = new Set<string>();
  #closed = false;
  #closing: Promise<void> | undefined;
  #lastObservedNow = -1;

  constructor(options: OwnerIdeogramImageGenerationServiceOptions | unknown) {
    const fields = exactRecord(options, ["binding", "linkService", "catalog", "catalog_version", "uploadService", "resolveChatClient", "preflight"],
      ["now", "timeoutMs", "pollDelayMs", "maxPollAttempts", "wait", "maskUploadService"]);
    if (!(fields.uploadService instanceof OwnerIdeogramImageUploadService) || types.isProxy(fields.uploadService) ||
        Object.getPrototypeOf(fields.uploadService) !== OwnerIdeogramImageUploadService.prototype ||
        !(fields.catalog instanceof DiscoveryCatalogRepository) || types.isProxy(fields.catalog) ||
        typeof fields.resolveChatClient !== "function" || types.isProxy(fields.resolveChatClient) ||
        typeof fields.preflight !== "function" || types.isProxy(fields.preflight) ||
        (fields.maskUploadService !== undefined && !isTrustedMaskUploadService(fields.maskUploadService)) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now))) ||
        (fields.wait !== undefined && (typeof fields.wait !== "function" || types.isProxy(fields.wait)))) fail("INVALID_REQUEST");
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = snapshotLinkService(fields.linkService);
    this.#catalog = fields.catalog as DiscoveryCatalogRepository;
    this.#catalogVersion = readCatalogVersion(fields.catalog_version);
    this.#uploadService = fields.uploadService as OwnerIdeogramImageUploadService;
    this.#maskUploadService = fields.maskUploadService as OwnerIdeogramImageMaskUploadService | undefined;
    this.#resolveChatClient = fields.resolveChatClient as OwnerIdeogramImageGenerationServiceOptions["resolveChatClient"];
    this.#preflight = fields.preflight as OwnerIdeogramImageGenerationPreflight;
    const clock = fields.now === undefined ? Date.now : readClock(fields.now);
    this.#now = () => { const value = clock(); if (!Number.isSafeInteger(value) || value < 0 || value < this.#lastObservedNow) fail("PRE_DISPATCH_FAILED"); this.#lastObservedNow = value; return value; };
    this.#timeoutMs = boundedInt(fields.timeoutMs, 1, MAX_TIMEOUT_MS, MAX_TIMEOUT_MS);
    this.#pollDelayMs = boundedInt(fields.pollDelayMs, 0, MAX_POLL_DELAY_MS, DEFAULT_POLL_DELAY_MS);
    this.#maxPollAttempts = boundedInt(fields.maxPollAttempts, 1, MAX_POLL_ROUNDS, MAX_POLL_ROUNDS);
    this.#wait = fields.wait === undefined ? waitDelay : readWait(fields.wait);
    this.#assetIssuer = createOwnerIdeogramImageAssetBindingIssuer(this.#uploadService, {
      catalog: this.#catalog, catalog_version: this.#catalogVersion, now: () => this.#readNow(),
      ...(this.#maskUploadService === undefined ? {} : { maskService: this.#maskUploadService })
    });
    try {
      for (const context of OWNER_IDEOGRAM_IMAGE_CONTEXTS) {
        const key = contextKey(context.model_id, context.mode);
        this.#profiles.set(key, getOwnerIdeogramImageSourceProfile(context.model_id, context.mode, this.#catalog, this.#catalogVersion));
      }
    } catch { fail("MODEL_BINDING_MISMATCH"); }
  }

  generate(input: OwnerIdeogramImageGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerIdeogramImageGenerationResult> {
    const request = snapshotGenerateInput(input, this.#profiles);
    return this.#run(request.attemptId, signal, (runSignal) => this.#generate(request, runSignal));
  }

  reconcile(input: OwnerIdeogramImageReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerIdeogramImageGenerationResult> {
    const request = snapshotReconcileInput(input);
    return this.#run(request.attemptId, signal, (runSignal) => this.#reconcile(request, runSignal));
  }

  listRecoveries(input: OwnerIdeogramImageRecoveryListInput | unknown): Promise<readonly OwnerIdeogramImageRecoveryListItem[]> {
    const request = snapshotRecoveryListInput(input);
    return this.#run(request.attemptId, undefined, async (signal) => {
      const deadline = this.#deadline(signal);
      try {
        const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline.signal));
        this.#prune();
        return Object.freeze([...this.#recoveries.values()]
          .filter((recovery) => recovery.attemptId === request.attemptId && sameGenerationPrincipal(recovery.principal, principal))
          .sort((left, right) => right.created_at.localeCompare(left.created_at)).slice(0, request.limit)
          .map((recovery) => Object.freeze({ recovery_id: recovery.recovery_id, created_at: recovery.created_at,
            model_id: recovery.model_id, mode: recovery.mode, mask_present: recovery.mask_present,
            mask_acceptance: recovery.mask_present ? "UNPROVEN" as const : "NOT_REQUESTED" as const, status: "OUTCOME_UNKNOWN" as const,
            diagnostic: snapshotDiagnostic(recovery.diagnostic) })));
      } finally { deadline.close(); }
    });
  }

  async invalidateAttempt(attemptId: string): Promise<void> {
    if (!isAttemptId(attemptId) || this.#closed || this.#invalidatingAttempts.has(attemptId)) return;
    this.#invalidatingAttempts.add(attemptId);
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    for (const controller of this.#controllersByAttempt.get(attemptId) ?? []) controller.abort();
    this.#clearAttemptPrivateState(attemptId);
    try {
      await Promise.allSettled([...(this.#runsByAttempt.get(attemptId) ?? [])]);
      await this.#assetIssuer.invalidateAttempt(attemptId);
      await Promise.allSettled([...(this.#candidatePreparationsByAttempt.get(attemptId) ?? [])]);
    } finally { this.#invalidatingAttempts.delete(attemptId); this.#releaseEpoch(attemptId); }
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
      for (const controllers of this.#controllersByAttempt.values()) for (const controller of controllers) controller.abort();
    this.#closing = (async () => {
      await Promise.allSettled([...this.#runs]);
      await this.#assetIssuer.close();
      await Promise.allSettled([...this.#candidatePreparationsByAttempt.values()].flatMap((set) => [...set]));
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
      controllers.delete(controller); if (!controllers.size) this.#controllersByAttempt.delete(attemptId);
      const attemptRuns = this.#runsByAttempt.get(attemptId); attemptRuns?.delete(tracked); if (!attemptRuns?.size) this.#runsByAttempt.delete(attemptId);
      this.#runs.delete(tracked); this.#releaseEpoch(attemptId);
    });
    this.#runs.add(tracked);
    const attemptRuns = this.#runsByAttempt.get(attemptId) ?? new Set<Promise<unknown>>();
    attemptRuns.add(tracked); this.#runsByAttempt.set(attemptId, attemptRuns);
    return tracked;
  }

  async #generate(request: GenerateRequest, signal: AbortSignal): Promise<OwnerIdeogramImageGenerationResult> {
    let claim: Claim | undefined; let recovery: Recovery | undefined; let postStarted = false;
    const deadline = this.#deadline(signal, () => recovery ? unknownError(recovery) : generationError("PRE_DISPATCH_FAILED"));
    try {
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline.signal));
      this.#assertProfile(request.model_id, request.mode);
      const maskResolution = await this.#resolveRequestedMask(request, principal, deadline);
      const maskIntentKey = maskResolution ? this.#maskIntentKey(principal, maskResolution) : undefined;
      if (maskIntentKey && this.#claimsByMaskIntent.get(maskIntentKey)?.state === "OUTCOME_UNKNOWN") fail("REFERENCE_ALREADY_CLAIMED");
      const assetSetKey = this.#assetSetKey(request, principal, maskResolution);
      if (this.#claimsByAssetSetKey.get(assetSetKey)?.state === "OUTCOME_UNKNOWN") fail("REFERENCE_ALREADY_CLAIMED");
      const assetSet = await this.#getAssetSet(request, principal, deadline, assetSetKey, maskResolution);
      if (assetSet.model_id !== request.model_id || assetSet.mode !== request.mode || assetSet.reference_count !== request.reference_handles.length ||
          assetSet.mask_present !== (request.mask_handle !== undefined) || assetSet.generation_permit !== false ||
          assetSet.expires_at <= this.#readNow() || !sameAssetSetMask(assetSet, maskResolution)) fail("REFERENCE_EXPIRED");
      const currentPrincipal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline.signal));
      if (!sameGenerationPrincipal(currentPrincipal, principal)) { this.#invalidateAttemptState(request.attemptId); fail("PRINCIPAL_NOT_LINKED"); }
      const candidate0 = await this.#prepareCandidate(request, principal, assetSet, deadline);
      claim = this.#reserve(request, principal, candidate0, assetSet.expires_at, assetSetKey, maskIntentKey);
      const native = this.#resolveNativeClient(request.attemptId);
      const firstPreflight = await this.#await(deadline, () => this.#runPreflight(request, principal, candidate0, deadline.signal))
        .catch(() => { throw generationError("PREFLIGHT_FAILED"); });
      this.#assertPreflight(firstPreflight, candidate0);
      await this.#assertCurrent(request, principal, candidate0, assetSet, claim, deadline);

      const chat = await this.#await(deadline, () => native.createChat("image", "owner-ideogram-image", deadline.signal));
      if (!SAFE_ID.test(chat.chat_uuid)) fail("PRE_DISPATCH_FAILED");
      await this.#assertCurrent(request, principal, candidate0, assetSet, claim, deadline);
      const candidate = await this.#prepareCandidate(request, principal, assetSet, deadline);
      if (!sameCandidate(candidate0, candidate)) fail("PRE_DISPATCH_FAILED");
      const secondPreflight = await this.#await(deadline, () => this.#runPreflight(request, principal, candidate, deadline.signal))
        .catch(() => { throw generationError("PREFLIGHT_FAILED"); });
      this.#assertPreflight(secondPreflight, candidate);
      await this.#assertCurrent(request, principal, candidate, assetSet, claim, deadline);
      this.#assertSynchronousCurrent(request, principal, candidate, assetSet, claim, deadline);
      this.#ensureRecoveryCapacity();
      recovery = this.#createRecovery(request, principal, candidate, assetSet, chat.chat_uuid, claim);
      let permit;
      try {
        permit = createOwnerIdeogramImageOneShotPermit({ candidate, principal, attemptId: request.attemptId,
          catalog: this.#catalog, catalog_version: this.#catalogVersion, now: () => this.#readNow() });
      } catch (error) { this.#recoveries.delete(recovery.recovery_id); recovery = undefined; throw error; }
      this.#assertSynchronousCurrent(request, principal, candidate, assetSet, claim, deadline, recovery);
      recovery.expires_at = null;
      recovery.diagnostic.phase = "GENERATION_POST"; recovery.diagnostic.post_started = true;
      claim.state = "POST_STARTED"; postStarted = true;
      const receipt = await this.#await(deadline, () => native.startIdeogramImageWithOwnedCandidate({
        candidate, permit, principal, attemptId: request.attemptId, chat_uuid: chat.chat_uuid
      }, deadline.signal));
      if (!validAck(receipt, chat.chat_uuid)) fail("OUTCOME_UNKNOWN");
      recovery.owner_echo_message_id = receipt.message_id; recovery.diagnostic.echo_ack_known = true;
      recovery.diagnostic.phase = "POST_ACK_KNOWN"; claim.state = "OUTCOME_UNKNOWN";
      await this.#assertRecoveryCurrent(recovery, deadline);
      return await this.#observe(recovery, native, deadline);
    } catch (caught) {
      if (postStarted && recovery) {
        if (claim) claim.state = "OUTCOME_UNKNOWN";
        if (this.#recoveries.get(recovery.recovery_id) === recovery) throw unknownError(recovery);
        throw generationError("OUTCOME_UNKNOWN");
      }
      if (recovery) this.#recoveries.delete(recovery.recovery_id);
      if (claim) this.#releaseClaim(claim);
      if (caught instanceof OwnerIdeogramImageGenerationServiceError) throw caught;
      if (caught instanceof OwnerIdeogramImageUploadServiceError) mapUploadError(caught);
      if (caught instanceof OwnerIdeogramImageRequestPreparerError) mapPreparerError(caught);
      if (caught instanceof OwnerIdeogramImageOneShotPolicyError) {
        if (caught.code === "CATALOG_BINDING_MISMATCH") fail("MODEL_BINDING_MISMATCH");
        if (caught.code === "PERMIT_EXPIRED" || caught.code === "CANDIDATE_EXPIRED") fail("REFERENCE_EXPIRED");
        fail("PRE_DISPATCH_FAILED");
      }
      if (caught instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      fail("PRE_DISPATCH_FAILED");
    } finally { deadline.close(); }
  }

  async #reconcile(request: Readonly<OwnerIdeogramImageReconcileInput>, signal: AbortSignal): Promise<OwnerIdeogramImageGenerationResult> {
    const deadline = this.#deadline(signal, () => { const recovery = this.#recoveries.get(request.recovery_id); return recovery ? unknownError(recovery) : generationError("RECOVERY_NOT_FOUND"); });
    let recovery: Recovery | undefined;
    try {
      this.#prune(); recovery = this.#recoveries.get(request.recovery_id);
      if (!recovery || recovery.attemptId !== request.attemptId || (recovery.expires_at !== null && recovery.expires_at <= this.#readNow())) fail("RECOVERY_NOT_FOUND");
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline.signal));
      if (!sameGenerationPrincipal(principal, recovery.principal) || !recovery.owner_echo_message_id) throw unknownError(recovery);
      const client = this.#resolveNativeClient(request.attemptId);
      return await this.#observe(recovery, client, deadline);
    } catch (caught) {
      if (caught instanceof OwnerIdeogramImageGenerationServiceError && caught.code === "RECOVERY_NOT_FOUND") throw caught;
      if (!recovery) { if (caught instanceof OwnerIdeogramImageGenerationServiceError) throw caught; fail("PRE_DISPATCH_FAILED"); }
      throw unknownError(recovery);
    } finally { deadline.close(); }
  }

  async #observe(recovery: Recovery, client: SyntxChatHttpClient, deadline: AbsoluteRequestDeadline): Promise<OwnerIdeogramImageGenerationResult> {
    if (!recovery.owner_echo_message_id) throw unknownError(recovery);
    const startedAt = this.#readNow(); let previousDelay = this.#pollDelayMs;
    for (let round = 0; round < this.#maxPollAttempts; round += 1) {
      deadline.throwIfAborted(); if (recovery.expires_at !== null && recovery.expires_at <= this.#readNow()) throw unknownError(recovery);
      if (!recovery.result_message_id || !recovery.provider_chat_id || !recovery.message_object_ids) {
        recovery.diagnostic.phase = "HISTORY_GET"; incrementDiagnostic(recovery.diagnostic, "history");
        const snapshot = await this.#await(deadline, () => client.listMessageCandidates(recovery.chat_uuid, recovery.owner_echo_message_id!, deadline.signal));
        await this.#assertRecoveryCurrent(recovery, deadline);
        recovery.diagnostic.phase = "HISTORY_BINDING";
        const binding = correlateOwnerIdeogramImageHistoryBinding({ snapshot, requested_chat_uuid: recovery.chat_uuid,
          owner_echo_message_id: recovery.owner_echo_message_id, model_id: recovery.model_id, mode: recovery.mode,
          requested_mask_present: recovery.mask_present, output_count: recovery.output_count });
        recovery.diagnostic.history_binding = binding.status;
        recovery.diagnostic.history_binding_reason = binding.status === "INVALID" || binding.status === "PENDING" ||
          binding.status === "NOT_VERIFIABLE" || binding.status === "PARTIAL" ? binding.reason : null;
        if (binding.status === "INVALID" || binding.status === "NOT_VERIFIABLE") throw unknownError(recovery);
        if (binding.status === "READY") {
          recovery.provider_chat_id = binding.provider_chat_id; recovery.result_message_id = binding.result_message_id;
          recovery.message_object_ids = binding.message_object_ids;
        } else {
          previousDelay = await this.#waitForNext(recovery, deadline, startedAt, round, previousDelay); continue;
        }
      }
      recovery.diagnostic.phase = "RESULT_GET"; incrementDiagnostic(recovery.diagnostic, "result");
      const result = await this.#await(deadline, () => client.getIdeogramImageResult({ chat_uuid: recovery.chat_uuid,
        message_id: recovery.result_message_id!, model_id: recovery.model_id, mode: recovery.mode, requested_mask_present: recovery.mask_present,
        provider_chat_id: recovery.provider_chat_id!, message_object_ids: recovery.message_object_ids!, output_count: recovery.output_count }, deadline.signal));
      await this.#assertRecoveryCurrent(recovery, deadline);
      recovery.diagnostic.phase = "RESULT_BINDING"; recovery.diagnostic.result_status = result.status;
      if (result.status === "UNVERIFIED") { recovery.diagnostic.result_reason = result.reason; throw unknownError(recovery); }
      if (result.status === "PENDING" || result.status === "PARTIAL") {
        recovery.diagnostic.result_reason = result.reason;
        previousDelay = await this.#waitForNext(recovery, deadline, startedAt, round, previousDelay); continue;
      }
      if (!sameResult(result, recovery) || this.#claimsByIntent.get(recovery.claimKey)?.state !== "OUTCOME_UNKNOWN") throw unknownError(recovery);
      this.#recoveries.delete(recovery.recovery_id); this.#releaseClaimByKey(recovery.claimKey);
      return resultFor(recovery, result);
    }
    throw unknownError(recovery);
  }

  async #waitForNext(recovery: Recovery, deadline: AbsoluteRequestDeadline, startedAt: number, round: number, previousDelay: number): Promise<number> {
    const now = this.#readNow(); const elapsed = now - startedAt;
    if (!Number.isSafeInteger(elapsed) || elapsed < 0 || elapsed >= this.#timeoutMs ||
        (recovery.expires_at !== null && recovery.expires_at <= now)) throw unknownError(recovery);
    const delay = Math.min(MAX_POLL_DELAY_MS, round === 0 ? this.#pollDelayMs : Math.ceil(previousDelay * 1.2),
      this.#timeoutMs - elapsed, recovery.expires_at === null ? Number.POSITIVE_INFINITY : recovery.expires_at - now);
    recovery.diagnostic.phase = "RESULT_WAIT";
    if (delay > 0) await this.#await(deadline, () => this.#wait(delay, deadline.signal));
    await this.#assertRecoveryCurrent(recovery, deadline); return delay;
  }

  #assetSetKey(request: GenerateRequest, principal: Readonly<GenerationPrincipalRef>, mask?: OwnerIdeogramPrivateMaskResolution): string {
    return schemaHash({ attemptId: request.attemptId, principal: { tenant_id: principal.tenant_id, subject_id: principal.subject_id },
      model_id: request.model_id, mode: request.mode, prompt: request.prompt, parameters: request.normalized.parameters,
      reference_handles: request.reference_handles,
      mask: mask ? { handle: request.mask_handle, base_reference_handle: mask.base_reference_handle,
        base_sha256: mask.base_sha256, pair_sha256: mask.pair_sha256 } : null });
  }

  async #resolveRequestedMask(request: GenerateRequest, principal: Readonly<GenerationPrincipalRef>,
    deadline: AbsoluteRequestDeadline): Promise<OwnerIdeogramPrivateMaskResolution | undefined> {
    if (request.mask_handle === undefined) return undefined;
    const baseHandle = request.reference_handles[0];
    if (!this.#maskUploadService || !baseHandle || request.model_id !== "ideogram_45" || request.mode !== "precise_edit") fail("REFERENCE_UNAVAILABLE");
    let value: OwnerIdeogramPrivateMaskResolution;
    try {
      value = await this.#await(deadline, () => Reflect.apply(MASK_RESOLVE_METHOD, this.#maskUploadService!, [Object.freeze({
        attemptId: request.attemptId, mask_handle: request.mask_handle!, base_reference_handle: baseHandle, signal: deadline.signal
      })]));
    } catch (caught) {
      if (caught instanceof OwnerIdeogramImageMaskUploadServiceError) {
        if (caught.code === "MASK_HANDLE_EXPIRED" || caught.code === "BASE_REFERENCE_EXPIRED") fail("REFERENCE_EXPIRED");
        if (caught.code === "PRINCIPAL_NOT_LINKED") fail("PRINCIPAL_NOT_LINKED");
        if (caught.code === "SERVICE_BUSY" || caught.code === "CAPACITY_EXCEEDED") fail("SERVICE_BUSY");
        if (caught.code === "MODEL_BINDING_MISMATCH") fail("MODEL_BINDING_MISMATCH");
      }
      fail("REFERENCE_UNAVAILABLE");
    }
    const profile = this.#assertProfile(request.model_id, request.mode);
    const now = this.#readNow();
    if (!value || types.isProxy(value) || !Object.isFrozen(value) || value.role !== "mask" || value.mask_handle !== request.mask_handle ||
        value.base_reference_handle !== baseHandle || value.attempt_id !== request.attemptId || value.model_id !== "ideogram_45" ||
        value.mode !== "precise_edit" || value.catalog_version !== this.#catalogVersion || value.profile_schema_hash !== profile.profile_schema_hash ||
        !sameGenerationPrincipal(value.principal, principal) || !/^sha256:[a-f0-9]{64}$/u.test(value.base_sha256) ||
        !/^sha256:[a-f0-9]{64}$/u.test(value.pair_sha256) || !/^sha256:[a-f0-9]{64}$/u.test(value.normal_sha256) ||
        !/^sha256:[a-f0-9]{64}$/u.test(value.inverse_sha256) || value.normal_sha256 === value.inverse_sha256 ||
        !isSafeUploadReferenceUrl(value.normal_url) || !isSafeUploadReferenceUrl(value.inverse_url) ||
        value.normal_url === value.inverse_url || value.primary_url !== value.normal_url ||
        !Number.isSafeInteger(value.base_width) || value.base_width < 1 || !Number.isSafeInteger(value.base_height) || value.base_height < 1 ||
        value.width !== value.base_width || value.height !== value.base_height || value.expires_at <= now ||
        !Number.isSafeInteger(value.epoch) || value.epoch < 0 || !Number.isSafeInteger(value.base_epoch) || value.base_epoch < 0 ||
        value.metadata_confidence !== "CONTAINER_METADATA_ONLY" || value.geometry_verified !== false || value.generation_permit !== false) {
      fail("REFERENCE_UNAVAILABLE");
    }
    return value;
  }

  #maskIntentKey(principal: Readonly<GenerationPrincipalRef>, mask: OwnerIdeogramPrivateMaskResolution): string {
    return schemaHash({ tenant_id: principal.tenant_id, subject_id: principal.subject_id, model_id: "ideogram_45", mode: "precise_edit",
      base_sha256: mask.base_sha256, pair_sha256: mask.pair_sha256 });
  }

  async #getAssetSet(request: GenerateRequest, principal: Readonly<GenerationPrincipalRef>, deadline: AbsoluteRequestDeadline,
    key: string, mask?: OwnerIdeogramPrivateMaskResolution): Promise<OwnerIdeogramImageAssetSet> {
    this.#prune();
    if (this.#expiredAssetSetKeys.has(key)) fail("REFERENCE_EXPIRED");
    const cached = this.#assetSets.get(key);
    if (cached) {
      if (cached.expiresAt <= this.#readNow()) fail("REFERENCE_EXPIRED");
      if (cached.attemptId !== request.attemptId || !sameGenerationPrincipal(cached.principal, principal)) fail("REFERENCE_UNAVAILABLE");
      if (!sameAssetSetMask(cached.set, mask)) fail("REFERENCE_UNAVAILABLE");
      return cached.set;
    }
    let pending = this.#assetSetPending.get(key)?.promise;
    if (!pending) {
      if (this.#assetSets.size + this.#assetSetPending.size + this.#expiredAssetSetKeys.size >= MAX_STATES) fail("SERVICE_BUSY");
      pending = this.#assetIssuer.issue({ principal, attempt_id: request.attemptId, model_id: request.model_id, mode: request.mode,
        reference_handles: request.reference_handles, prompt: request.prompt, parameters: request.normalized.parameters,
        ...(request.mask_handle === undefined ? {} : { mask_handle: request.mask_handle }), signal: deadline.signal });
      this.#assetSetPending.set(key, { attemptId: request.attemptId, promise: pending });
      void pending.finally(() => { if (this.#assetSetPending.get(key)?.promise === pending) this.#assetSetPending.delete(key); }).catch(() => undefined);
    }
    const set = await this.#await(deadline, () => pending!);
    if (set.model_id !== request.model_id || set.mode !== request.mode || set.reference_count !== request.reference_handles.length ||
        set.mask_present !== (request.mask_handle !== undefined) || set.generation_permit !== false || set.expires_at <= this.#readNow() ||
        !sameAssetSetMask(set, mask)) fail("REFERENCE_EXPIRED");
    if (!this.#assetSets.has(key) && this.#assetSets.size + this.#expiredAssetSetKeys.size >= MAX_STATES) fail("SERVICE_BUSY");
    this.#assetSets.set(key, Object.freeze({ set, attemptId: request.attemptId, principal, expiresAt: set.expires_at }));
    return set;
  }

  async #prepareCandidate(request: GenerateRequest, principal: Readonly<GenerationPrincipalRef>, assetSet: OwnerIdeogramImageAssetSet,
    deadline: AbsoluteRequestDeadline): Promise<OwnerIdeogramImagePreparedCandidate> {
    this.#assertProfile(request.model_id, request.mode);
    const preparation = prepareOwnerIdeogramImageRequest({ principal, attempt_id: request.attemptId, asset_set: assetSet },
      { catalog: this.#catalog, catalog_version: this.#catalogVersion, now: () => this.#readNow() });
    this.#trackCandidatePreparation(request.attemptId, preparation);
    const candidate = await this.#await(deadline, () => preparation);
    const state = getOwnerIdeogramImagePreparedCandidateState(candidate);
    if (!state || state.assetSet !== assetSet || state.promptIntent !== request.prompt || state.attemptId !== request.attemptId ||
        !sameGenerationPrincipal(state.principal, principal) || candidate.model_id !== request.model_id || candidate.mode !== request.mode ||
        candidate.mask_present !== (request.mask_handle !== undefined) || candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" ||
        (request.mask_handle === undefined ? state.maskHandle !== undefined || candidate.mask_binding !== undefined
          : state.maskHandle !== request.mask_handle || candidate.mask_binding?.mask_handle !== request.mask_handle ||
            candidate.mask_binding?.base_sha256 !== assetSet.mask_binding?.base_sha256 ||
            candidate.mask_binding?.pair_sha256 !== assetSet.mask_binding?.pair_sha256) ||
        !isDeepStrictEqual(candidate.parameters, request.normalized.parameters) || !isDeepStrictEqual(candidate.cost_inputs, request.normalized.cost_inputs)) fail("PRE_DISPATCH_FAILED");
    return candidate;
  }

  #reserve(request: GenerateRequest, principal: Readonly<GenerationPrincipalRef>, candidate: OwnerIdeogramImagePreparedCandidate,
    expiresAt: number, assetSetKey: string, maskIntentKey?: string): Claim {
    this.#prune();
    const state = getOwnerIdeogramImagePreparedCandidateState(candidate);
    if (!state || state.attemptId !== request.attemptId || !sameGenerationPrincipal(state.principal, principal) ||
        state.intentFingerprint !== candidate.intent_fingerprint || state.requestFingerprint !== candidate.request_fingerprint) fail("PRE_DISPATCH_FAILED");
    const key = state.intentFingerprint;
    if (this.#claimsByIntent.has(key) || this.#claimsByAssetSetKey.has(assetSetKey) ||
        (maskIntentKey !== undefined && this.#claimsByMaskIntent.has(maskIntentKey)) ||
        request.reference_handles.some((handle) => this.#claimsByHandle.has(handle))) fail("REFERENCE_ALREADY_CLAIMED");
    if (this.#claimsByIntent.size >= MAX_STATES || this.#recoveries.size >= MAX_STATES) fail("SERVICE_BUSY");
    const claimExpiry = Math.min(candidate.expires_at, expiresAt, this.#readNow() + TTL_MS);
    if (!Number.isSafeInteger(claimExpiry) || claimExpiry <= this.#readNow()) fail("REFERENCE_EXPIRED");
    const claim: Claim = { key, assetSetKey, attemptId: request.attemptId, principal, handles: new Set(request.reference_handles),
      private_expires_at: claimExpiry, state: "PREPARING", ...(maskIntentKey === undefined ? {} : { maskIntentKey }) };
    this.#claimsByIntent.set(key, claim); this.#claimsByAssetSetKey.set(assetSetKey, claim);
    if (maskIntentKey !== undefined) this.#claimsByMaskIntent.set(maskIntentKey, claim);
    for (const handle of claim.handles) this.#claimsByHandle.set(handle, claim);
    return claim;
  }

  #createRecovery(request: GenerateRequest, principal: Readonly<GenerationPrincipalRef>, candidate: OwnerIdeogramImagePreparedCandidate,
    assetSet: OwnerIdeogramImageAssetSet, chatUuid: string, claim: Claim): Recovery {
    this.#ensureRecoveryCapacity(); const now = this.#readNow();
    const expiresAt = Math.min(candidate.expires_at, assetSet.expires_at, now + TTL_MS);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) fail("REFERENCE_EXPIRED");
    const recovery: Recovery = { recovery_id: `ideogram_image_recovery_${randomUUID()}`, attemptId: request.attemptId,
      principal, model_id: request.model_id, mode: request.mode, candidate, assetSet, catalog_version: this.#catalogVersion, created_at: new Date(now).toISOString(),
      expires_at: expiresAt, claimKey: claim.key, chat_uuid: chatUuid, output_count: Number(request.normalized.parameters.num_images),
      mask_present: request.mask_handle !== undefined,
      owner_echo_message_id: null, provider_chat_id: null, result_message_id: null, message_object_ids: null, diagnostic: initialDiagnostic() };
    this.#recoveries.set(recovery.recovery_id, recovery); return recovery;
  }

  async #assertCurrent(request: GenerateRequest, principal: Readonly<GenerationPrincipalRef>, candidate: OwnerIdeogramImagePreparedCandidate,
    assetSet: OwnerIdeogramImageAssetSet, claim: Claim, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted();
    const current = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId, deadline.signal));
    if (!sameGenerationPrincipal(current, principal)) { this.#invalidateAttemptState(request.attemptId); fail("PRINCIPAL_NOT_LINKED"); }
    this.#assertSynchronousCurrent(request, principal, candidate, assetSet, claim, deadline);
  }

  #assertSynchronousCurrent(request: GenerateRequest, principal: Readonly<GenerationPrincipalRef>, candidate: OwnerIdeogramImagePreparedCandidate,
    assetSet: OwnerIdeogramImageAssetSet, claim: Claim, deadline: AbsoluteRequestDeadline, recovery?: Recovery): void {
    deadline.throwIfAborted(); const now = this.#readNow(); const cached = this.#principals.get(request.attemptId);
    const profile = this.#assertProfile(request.model_id, request.mode);
    if (this.#closed || this.#invalidatingAttempts.has(request.attemptId) || !cached || cached.expiresAt <= now ||
        !sameGenerationPrincipal(cached.principal, principal) || profile.profile_schema_hash !== candidate.profile_schema_hash ||
        candidate.expires_at <= now || assetSet.expires_at <= now ||
        assetSet.mask_present !== (request.mask_handle !== undefined) || candidate.mask_present !== (request.mask_handle !== undefined) ||
        !isDeepStrictEqual(assetSet.mask_binding, candidate.mask_binding) ||
        !isOwnerIdeogramImagePreparedCandidateForPrincipal(candidate, principal, request.attemptId, now) ||
        !observeOwnerIdeogramImageCandidateClock(candidate, now) || this.#claimsByIntent.get(claim.key) !== claim ||
        [...claim.handles].some((handle) => this.#claimsByHandle.get(handle) !== claim) ||
        (recovery && ((recovery.expires_at !== null && recovery.expires_at <= now) || this.#recoveries.get(recovery.recovery_id) !== recovery))) fail("REFERENCE_UNAVAILABLE");
  }

  async #assertRecoveryCurrent(recovery: Recovery, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted();
    const current = await this.#await(deadline, () => this.#resolvePrincipal(recovery.attemptId, deadline.signal));
    const profile = this.#assertProfile(recovery.model_id, recovery.mode); const now = this.#readNow();
    const candidateState = getOwnerIdeogramImagePreparedCandidateState(recovery.candidate);
    if (!sameGenerationPrincipal(current, recovery.principal) || this.#closed || this.#invalidatingAttempts.has(recovery.attemptId) ||
        profile.profile_schema_hash !== recovery.candidate.profile_schema_hash ||
        (recovery.expires_at !== null && recovery.expires_at <= now) || !candidateState ||
        candidateState.candidate !== recovery.candidate || candidateState.assetSet !== recovery.assetSet ||
        candidateState.attemptId !== recovery.attemptId || !sameGenerationPrincipal(candidateState.principal, recovery.principal) ||
        candidateState.catalogVersion !== recovery.catalog_version || candidateState.requestFingerprint !== recovery.candidate.request_fingerprint ||
        candidateState.intentFingerprint !== recovery.candidate.intent_fingerprint || candidateState.expired ||
        this.#claimsByIntent.get(recovery.claimKey)?.state !== "OUTCOME_UNKNOWN" || this.#recoveries.get(recovery.recovery_id) !== recovery) throw unknownError(recovery);
  }

  async #runPreflight(request: GenerateRequest, principal: Readonly<GenerationPrincipalRef>, candidate: OwnerIdeogramImagePreparedCandidate,
    signal: AbortSignal): Promise<OwnerIdeogramImageGenerationPreflightResult> {
    const costInputs = Object.freeze({ ...candidate.cost_inputs });
    return this.#preflight(Object.freeze({ attemptId: request.attemptId, principal, model_id: request.model_id, mode: request.mode,
      catalog_version: this.#catalogVersion, cost_inputs: costInputs, request_fingerprint: candidate.request_fingerprint, signal }));
  }

  #assertPreflight(value: OwnerIdeogramImageGenerationPreflightResult, candidate: OwnerIdeogramImagePreparedCandidate): void {
    let top: Record<string, unknown>; let account: Record<string, unknown>; let balance: Record<string, unknown>;
    let subscription: Record<string, unknown>; let access: Record<string, unknown>;
    try {
      top = exactRecord(value, ["account", "model_access"]);
      account = exactRecord(top.account, ["balance", "subscription", "contract_evidence", "source_build", "observed_at"]);
      balance = exactRecord(account.balance, ["unit", "available"]);
      subscription = exactRecord(account.subscription, ["active", "plan_type", "end_date", "end_date_kind"]);
      access = exactRecord(top.model_access, ["catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live",
        "parameter_keys", "parameters_redacted", "access", "cost", "discount_cost", "free_remaining_generations", "limit", "show_warning", "observed_at"]);
    } catch { fail("PREFLIGHT_FAILED"); }
    const now = this.#readNow();
    let model: ReturnType<DiscoveryCatalogRepository["getModel"]>;
    try { model = this.#catalog.getModel(candidate.model_id); } catch { fail("PREFLIGHT_FAILED"); }
    const costKeys = Object.keys(candidate.cost_inputs);
    if (account.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || account.source_build !== ACCOUNT_SOURCE_BUILD || balance.unit !== "tokens" ||
        !(balance.available === null || typeof balance.available === "string") || !validSubscription(subscription, now) || !isFreshIso(account.observed_at, now) ||
        access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || access.catalog_version !== currentCatalogVersion(this.#catalog) ||
        access.model_id !== candidate.model_id || access.ai_name !== "ideogram" || access.model_type !== candidate.model_id ||
        access.account_read_live !== true || access.access !== true || access.parameters_redacted !== true ||
        !sameStringArray(access.parameter_keys, [...costKeys].sort()) || !isFreshIso(access.observed_at, now) || !finiteNonnegative(access.cost) ||
        !(access.discount_cost === null || finiteNonnegative(access.discount_cost)) ||
        !(access.free_remaining_generations === null || nonnegativeInteger(access.free_remaining_generations)) ||
        !(access.limit === null || finiteNonnegative(access.limit)) || !(access.show_warning === null || typeof access.show_warning === "boolean") ||
        model.id !== candidate.model_id || model.upstream_id !== candidate.model_id || model.ai_name !== "ideogram" || model.active !== true ||
        model.scope !== "image" || !model.modalities.includes("image") ||
        !model.operations.some((operation) => operation.id === OPERATION && operation.output_modality === "image")) fail("PREFLIGHT_FAILED");
  }

  #resolveNativeClient(attemptId: string): SyntxChatHttpClient {
    const client = this.#resolveChatClient(attemptId);
    if (!(client instanceof SyntxChatHttpClient) || types.isProxy(client) || Object.getPrototypeOf(client) !== SyntxChatHttpClient.prototype ||
        client.createChat !== NATIVE_METHODS.createChat || client.startIdeogramImageWithOwnedCandidate !== NATIVE_METHODS.start ||
        client.listMessageCandidates !== NATIVE_METHODS.history || client.getIdeogramImageResult !== NATIVE_METHODS.result) fail("MODEL_BINDING_MISMATCH");
    return client;
  }

  async #resolvePrincipal(attemptId: string, signal: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    this.#assertOpen(); this.#prune();
    if (this.#invalidatingAttempts.has(attemptId)) fail("PRINCIPAL_NOT_LINKED");
    if ((this.#runsByAttempt.get(attemptId)?.size ?? 0) > MAX_PENDING || (!this.#principals.has(attemptId) && this.#principals.size >= MAX_STATES)) fail("SERVICE_BUSY");
    const epoch = this.#epochs.get(attemptId) ?? 0;
    let principal: Readonly<GenerationPrincipalRef>;
    try { principal = await this.#awaitSignal(resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService }), signal); }
    catch (caught) { if (caught instanceof OwnerReferencePrincipalError) this.#invalidateAttemptState(attemptId); fail("PRINCIPAL_NOT_LINKED"); }
    if (this.#closed || this.#invalidatingAttempts.has(attemptId) || (this.#epochs.get(attemptId) ?? 0) !== epoch || principal.connection_id !== attemptId) fail("PRINCIPAL_NOT_LINKED");
    const snapshot = snapshotGenerationPrincipal(principal); const previous = this.#principals.get(attemptId);
    if (previous && !sameGenerationPrincipal(previous.principal, snapshot)) { this.#invalidateAttemptState(attemptId); fail("PRINCIPAL_NOT_LINKED"); }
    this.#prune();
    if (!this.#principals.has(attemptId) && this.#principals.size >= MAX_STATES) fail("SERVICE_BUSY");
    this.#principals.set(attemptId, Object.freeze({ principal: snapshot, expiresAt: this.#readNow() + TTL_MS }));
    return snapshot;
  }

  #assertProfile(model_id: OwnerIdeogramImageModelId, mode: OwnerIdeogramImageMode): Readonly<OwnerIdeogramImageSourceProfile> {
    const profile = this.#profiles.get(contextKey(model_id, mode));
    let current: Readonly<OwnerIdeogramImageSourceProfile>;
    try { current = getOwnerIdeogramImageSourceProfile(model_id, mode, this.#catalog, this.#catalogVersion); }
    catch { fail("MODEL_BINDING_MISMATCH"); }
    if (!profile || profile.profile_schema_hash !== current.profile_schema_hash || current.public_catalog_version !== this.#catalogVersion) fail("MODEL_BINDING_MISMATCH");
    return current;
  }

  #ensureRecoveryCapacity(): void { this.#prune(); if (this.#recoveries.size >= MAX_STATES || this.#claimsByIntent.size > MAX_STATES) fail("SERVICE_BUSY"); }
  #releaseClaim(claim: Claim): void {
    if (this.#claimsByIntent.get(claim.key) !== claim) return;
    this.#claimsByIntent.delete(claim.key);
    if (this.#claimsByAssetSetKey.get(claim.assetSetKey) === claim) this.#claimsByAssetSetKey.delete(claim.assetSetKey);
    if (claim.maskIntentKey && this.#claimsByMaskIntent.get(claim.maskIntentKey) === claim) this.#claimsByMaskIntent.delete(claim.maskIntentKey);
    for (const handle of claim.handles) if (this.#claimsByHandle.get(handle) === claim) this.#claimsByHandle.delete(handle);
  }
  #releaseClaimByKey(key: string): void { const claim = this.#claimsByIntent.get(key); if (claim) this.#releaseClaim(claim); }
  #clearClaimPrivateState(claim: Claim): void {
    for (const handle of claim.handles) if (this.#claimsByHandle.get(handle) === claim) this.#claimsByHandle.delete(handle);
    claim.handles.clear(); claim.attemptId = null; claim.principal = null;
  }
  #prune(): void {
    const now = this.#readNow();
    for (const [key, entry] of this.#assetSets) if (entry.expiresAt <= now) {
      this.#assetSets.delete(key);
      if (this.#claimsByAssetSetKey.has(key)) this.#expiredAssetSetKeys.add(key);
    }
    for (const [recoveryId, recovery] of this.#recoveries) if (recovery.expires_at !== null && recovery.expires_at <= now) {
      this.#recoveries.delete(recoveryId);
      const claim = this.#claimsByIntent.get(recovery.claimKey); if (claim?.state === "OUTCOME_UNKNOWN") this.#clearClaimPrivateState(claim);
    }
    for (const claim of [...this.#claimsByIntent.values()]) if (claim.private_expires_at <= now) {
      if (claim.state === "PREPARING") this.#releaseClaim(claim); else this.#clearClaimPrivateState(claim);
    }
    for (const key of this.#expiredAssetSetKeys) if (!this.#claimsByAssetSetKey.has(key)) this.#expiredAssetSetKeys.delete(key);
    for (const [attemptId, principal] of this.#principals) {
      const active = this.#runsByAttempt.has(attemptId) || [...this.#claimsByIntent.values()].some((claim) => claim.attemptId === attemptId) ||
        [...this.#recoveries.values()].some((recovery) => recovery.attemptId === attemptId);
      if (principal.expiresAt <= now && !active) { this.#principals.delete(attemptId); this.#releaseEpoch(attemptId); }
    }
  }
  #invalidateAttemptState(attemptId: string): void {
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    for (const controller of this.#controllersByAttempt.get(attemptId) ?? []) controller.abort();
    this.#clearAttemptPrivateState(attemptId);
  }
  #clearAttemptPrivateState(attemptId: string): void {
    this.#principals.delete(attemptId);
    for (const [key, entry] of this.#assetSets) if (entry.attemptId === attemptId) this.#assetSets.delete(key);
    for (const [key, pending] of this.#assetSetPending) if (pending.attemptId === attemptId) this.#assetSetPending.delete(key);
    for (const [recoveryId, recovery] of this.#recoveries) if (recovery.attemptId === attemptId) this.#recoveries.delete(recoveryId);
    for (const claim of [...this.#claimsByIntent.values()]) {
      if (claim.attemptId !== attemptId) continue;
      if (claim.state === "PREPARING") this.#releaseClaim(claim); else this.#clearClaimPrivateState(claim);
    }
  }
  #clearAll(): void {
    this.#recoveries.clear(); this.#claimsByIntent.clear(); this.#claimsByHandle.clear(); this.#claimsByAssetSetKey.clear();
    this.#claimsByMaskIntent.clear(); this.#principals.clear();
    this.#assetSets.clear(); this.#expiredAssetSetKeys.clear(); this.#assetSetPending.clear(); this.#epochs.clear(); this.#runsByAttempt.clear();
    this.#controllersByAttempt.clear(); this.#candidatePreparationsByAttempt.clear(); this.#invalidatingAttempts.clear();
  }
  #trackCandidatePreparation(attemptId: string, preparation: Promise<OwnerIdeogramImagePreparedCandidate>): void {
    const bucket = this.#candidatePreparationsByAttempt.get(attemptId) ?? new Set<Promise<OwnerIdeogramImagePreparedCandidate>>();
    bucket.add(preparation); this.#candidatePreparationsByAttempt.set(attemptId, bucket);
    void preparation.finally(() => {
      bucket.delete(preparation); if (!bucket.size && this.#candidatePreparationsByAttempt.get(attemptId) === bucket) this.#candidatePreparationsByAttempt.delete(attemptId);
    }).catch(() => undefined);
  }
  #releaseEpoch(attemptId: string): void {
    if (!this.#runsByAttempt.has(attemptId) && !this.#principals.has(attemptId) &&
        ![...this.#assetSets.values()].some((entry) => entry.attemptId === attemptId) &&
        ![...this.#claimsByIntent.values()].some((claim) => claim.attemptId === attemptId) &&
        ![...this.#recoveries.values()].some((recovery) => recovery.attemptId === attemptId) &&
        !this.#candidatePreparationsByAttempt.has(attemptId) && !this.#invalidatingAttempts.has(attemptId)) this.#epochs.delete(attemptId);
  }
  #deadline(signal: AbortSignal, makeError?: () => Error): AbsoluteRequestDeadline {
    return new AbsoluteRequestDeadline(this.#timeoutMs, signal, () => makeError?.() ?? generationError("PRE_DISPATCH_FAILED"));
  }
  async #await<T>(deadline: AbsoluteRequestDeadline, operation: () => Promise<T> | T): Promise<T> {
    deadline.throwIfAborted(); let pending: Promise<T>; try { pending = Promise.resolve(operation()); } catch (caught) { throw caught; }
    return deadline.waitFor(pending);
  }
  async #awaitSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw new Error("ABORTED");
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new Error("ABORTED")); signal.addEventListener("abort", abort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }
  #readNow(): number {
    let value: unknown; try { value = this.#now(); } catch { fail("PRE_DISPATCH_FAILED"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) < this.#lastObservedNow) fail("PRE_DISPATCH_FAILED");
    this.#lastObservedNow = value as number; return value as number;
  }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
}

function snapshotGenerateInput(value: unknown, profiles: ReadonlyMap<string, Readonly<OwnerIdeogramImageSourceProfile>>): GenerateRequest {
  const fields = exactRecord(value, ["attemptId", "model_id", "mode", "prompt", "reference_handles", "parameters"], ["mask_handle"]);
  if (!isAttemptId(fields.attemptId) || typeof fields.model_id !== "string" || typeof fields.mode !== "string" ||
      !isSupportedContext(fields.model_id, fields.mode) || !profiles.has(contextKey(fields.model_id, fields.mode))) fail("INVALID_REQUEST");
  const handles = denseStringArray(fields.reference_handles, 5);
  if (handles.some((handle) => !IMAGE_HANDLE.test(handle)) || new Set(handles).size !== handles.length) fail("INVALID_REQUEST");
  if (fields.mask_handle !== undefined && (typeof fields.mask_handle !== "string" || !MASK_HANDLE.test(fields.mask_handle) ||
      fields.model_id !== "ideogram_45" || fields.mode !== "precise_edit" || handles.length === 0)) fail("INVALID_REQUEST");
  let normalized: OwnerIdeogramImageNormalizedParameters;
  try {
    normalized = normalizeOwnerIdeogramImageParameters({ model_id: fields.model_id, mode: fields.mode,
      reference_count: handles.length, mask_present: fields.mask_handle !== undefined, prompt: fields.prompt, parameters: fields.parameters });
  } catch { fail("INVALID_REQUEST"); }
  return Object.freeze({ attemptId: fields.attemptId, model_id: normalized.model_id, mode: normalized.mode,
    prompt: fields.prompt as string | null, reference_handles: Object.freeze(handles),
    ...(fields.mask_handle === undefined ? {} : { mask_handle: fields.mask_handle as string }), normalized });
}

function snapshotReconcileInput(value: unknown): Readonly<OwnerIdeogramImageReconcileInput> {
  const fields = exactRecord(value, ["attemptId", "recovery_id"]);
  if (!isAttemptId(fields.attemptId) || typeof fields.recovery_id !== "string" || !RECOVERY.test(fields.recovery_id)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, recovery_id: fields.recovery_id });
}

function snapshotRecoveryListInput(value: unknown): Readonly<{ attemptId: string; limit: number }> {
  const fields = exactRecord(value, ["attemptId"], ["limit"]);
  if (!isAttemptId(fields.attemptId)) fail("INVALID_REQUEST");
  const limit = fields.limit === undefined ? 20 : fields.limit;
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) fail("INVALID_REQUEST");
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
  let current: object | null = value; let method: unknown;
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
  let prototype: object | null; let descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); } catch { fail("INVALID_REQUEST"); }
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
  const keys = Reflect.ownKeys(descriptors); const allowed = [...required, ...optional];
  if (required.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) => typeof key !== "string" || !allowed.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function denseStringArray(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" && (typeof key !== "string" ||
      !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable))) fail("INVALID_REQUEST");
  const result: string[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const descriptor = descriptors[String(i)];
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") fail("INVALID_REQUEST");
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
  return () => { let current: unknown; try { current = Reflect.apply(value, undefined, []); } catch { fail("PRE_DISPATCH_FAILED"); }
    if (!Number.isSafeInteger(current) || (current as number) < 0) fail("PRE_DISPATCH_FAILED"); return current as number; };
}
function readWait(value: unknown): NonNullable<OwnerIdeogramImageGenerationServiceOptions["wait"]> {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return value as NonNullable<OwnerIdeogramImageGenerationServiceOptions["wait"]>;
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
  try { const fields = exactRecord(value, ["chat_uuid", "message_id"]); return fields.chat_uuid === chatUuid && isSafeIdentifier(fields.message_id); }
  catch { return false; }
}
function validSubscription(subscription: Record<string, unknown>, now: number): boolean {
  if (subscription.active !== true || !(subscription.plan_type === null || typeof subscription.plan_type === "string")) return false;
  const date = subscription.end_date; const kind = subscription.end_date_kind;
  if (date === null) return kind === null;
  if (typeof date !== "string" || kind !== "OFFSET_DATETIME" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(date)) return false;
  const expiry = Date.parse(date); return Number.isFinite(expiry) && expiry > now;
}
function isFreshIso(value: unknown, now: number): boolean {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= now && now - parsed <= MAX_CLOCK_SKEW_MS && new Date(parsed).toISOString() === value;
}
function finiteNonnegative(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function nonnegativeInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function sameStringArray(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
}
function currentCatalogVersion(catalog: DiscoveryCatalogRepository): string {
  return `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
}
function isTrustedMaskUploadService(value: unknown): value is OwnerIdeogramImageMaskUploadService {
  if (!(value instanceof OwnerIdeogramImageMaskUploadService) || types.isProxy(value) ||
      Object.getPrototypeOf(value) !== OwnerIdeogramImageMaskUploadService.prototype || Object.hasOwn(value, "resolveMask")) return false;
  const descriptor = Object.getOwnPropertyDescriptor(OwnerIdeogramImageMaskUploadService.prototype, "resolveMask");
  return descriptor !== undefined && "value" in descriptor && descriptor.value === MASK_RESOLVE_METHOD;
}
function contextKey(model_id: string, mode: string): string { return `${model_id}\u0000${mode}`; }
function isAttemptId(value: unknown): value is string { return typeof value === "string" && ATTEMPT.test(value); }
function isSafeIdentifier(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function isSupportedContext(model: string, mode: string): boolean {
  return OWNER_IDEOGRAM_IMAGE_CONTEXTS.some((context) => context.model_id === model && context.mode === mode);
}
function snapshotDiagnostic(value: MutableDiagnostic): OwnerIdeogramImageGenerationDiagnostic { return Object.freeze({ ...value }); }
function resultFor(recovery: Recovery, result: Extract<InternalOwnerIdeogramImageResult, { status: "COMPLETE" }>): OwnerIdeogramImageGenerationResult {
  const artifacts = Object.freeze(result.artifacts.map((artifact) => Object.freeze({ url: artifact.url, mime_type: artifact.mime_type,
    mime_source: artifact.mime_source, width: null, height: null, geometry_verified: false as const })));
  return Object.freeze({ status: "result_observed", namespace_confidence: "SOURCE_SHAPED_UNVERIFIED", backend_acceptance: "UNPROVEN",
    mode_confidence: "PRIVATE_REQUEST_CONTEXT_NOT_PROVIDER_ECHO", ai_name: "ideogram", model_id: recovery.model_id, mode: recovery.mode,
    operation_id: OPERATION, profile_id: recovery.candidate.profile_id, profile_schema_hash: recovery.candidate.profile_schema_hash,
    catalog_version: recovery.catalog_version,
    reference_count: recovery.candidate.reference_count, mask_present: recovery.mask_present,
    mask_acceptance: recovery.mask_present ? "UNPROVEN" : "NOT_REQUESTED", output_count: recovery.output_count,
    cost_input_confidence: recovery.candidate.cost_input_confidence, artifacts });
}
function unknownError(recovery: Recovery): OwnerIdeogramImageGenerationServiceError {
  return generationError("OUTCOME_UNKNOWN", recovery.recovery_id, snapshotDiagnostic(recovery.diagnostic));
}
function generationError(code: OwnerIdeogramImageGenerationServiceErrorCode, recoveryId?: string,
  diagnostic?: OwnerIdeogramImageGenerationDiagnostic): OwnerIdeogramImageGenerationServiceError {
  return new OwnerIdeogramImageGenerationServiceError(code, recoveryId, diagnostic);
}
function mapUploadError(error: OwnerIdeogramImageUploadServiceError): never {
  if (error.code === "SERVICE_BUSY" || error.code === "CAPACITY_EXCEEDED") fail("SERVICE_BUSY");
  if (error.code === "REFERENCE_EXPIRED") fail("REFERENCE_EXPIRED");
  if (error.code === "PRINCIPAL_NOT_LINKED") fail("PRINCIPAL_NOT_LINKED");
  if (error.code === "MODEL_BINDING_MISMATCH") fail("MODEL_BINDING_MISMATCH");
  fail("REFERENCE_UNAVAILABLE");
}
function mapPreparerError(error: OwnerIdeogramImageRequestPreparerError): never {
  if (error.code === "SERVICE_BUSY" || error.code === "CAPACITY_EXCEEDED") fail("SERVICE_BUSY");
  if (error.code === "REFERENCE_EXPIRED" || error.code === "CANDIDATE_EXPIRED") fail("REFERENCE_EXPIRED");
  if (error.code === "MODEL_BINDING_MISMATCH") fail("MODEL_BINDING_MISMATCH");
  if (error.code === "PRINCIPAL_MISMATCH") fail("PRINCIPAL_NOT_LINKED");
  if (error.code === "INVALID_REQUEST" || error.code === "PARAMETERS_INVALID") fail("INVALID_REQUEST");
  fail("REFERENCE_UNAVAILABLE");
}
function fail(code: OwnerIdeogramImageGenerationServiceErrorCode): never { throw generationError(code); }
