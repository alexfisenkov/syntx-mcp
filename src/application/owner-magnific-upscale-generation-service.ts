import { randomUUID } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import {
  SyntxChatHttpClient,
  type InternalMagnificUpscaleResult,
  type MagnificUpscaleResultPendingReason,
  type MagnificUpscaleResultUnverifiedReason
} from "../adapter/syntx/chat-http-client.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import type { AccountStatusResult } from "./account-status.js";
import type { ModelAccessResult } from "./model-access.js";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import type { OwnerMagnificUpscaleVariant, OwnerMagnificUpscaleScaleFactor } from "./owner-magnific-upscale-parameters.js";
import {
  OwnerMagnificUpscaleUploadService,
  OwnerMagnificUpscaleUploadServiceError
} from "./owner-magnific-upscale-upload-service.js";
import {
  getOwnerMagnificUpscaleSourceProfile,
  OwnerMagnificUpscalePrepareError,
  prepareOwnerMagnificUpscaleRequest,
  type OwnerMagnificUpscaleOwnedImageBindingIssuer,
  type OwnerMagnificUpscalePreparedCandidate
} from "./owner-magnific-upscale-request-preparer.js";
import { createOwnerMagnificUpscaleOneShotPermit } from "./owner-magnific-upscale-one-shot-policy.js";
import {
  correlateOwnerMagnificUpscaleHistoryBinding,
  type OwnerMagnificHistoryBindingInvalidReason
} from "./owner-magnific-upscale-history-binding.js";
import {
  createOwnerClarityUpscaleCompletionPolicy,
  decideOwnerClarityUpscaleCompletion,
  OWNER_CLARITY_COMPLETION_LIMITS,
  type OwnerClarityUpscaleCompletionPolicyState
} from "./owner-clarity-upscale-completion-policy.js";

export interface OwnerMagnificUpscalePreflightInput {
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly variant: OwnerMagnificUpscaleVariant;
  readonly cost_inputs: Readonly<{
    width: number;
    height: number;
    scale_factor: OwnerMagnificUpscaleScaleFactor;
  }>;
  readonly request_fingerprint: string;
  readonly signal?: AbortSignal;
}

export interface OwnerMagnificUpscalePreflightResult {
  readonly account: AccountStatusResult;
  readonly model_access: ModelAccessResult;
}

export type OwnerMagnificUpscalePreflight = (
  input: Readonly<OwnerMagnificUpscalePreflightInput>
) => Promise<OwnerMagnificUpscalePreflightResult>;

export interface OwnerMagnificUpscaleGenerationServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalogVersion: string;
  readonly uploadService: OwnerMagnificUpscaleUploadService;
  readonly resolveChatClient: (attemptId: string) => OwnerMagnificUpscaleNativeChatClient;
  readonly preflight: OwnerMagnificUpscalePreflight;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly pollDelayMs?: number;
  readonly maxPollAttempts?: number;
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export type OwnerMagnificUpscaleNativeChatClient = Pick<SyntxChatHttpClient,
  "createImageUpscalerChat" | "startMagnificUpscaleWithOwnedCandidate" | "listMessageCandidates" |
  "listInProgress" | "getMagnificUpscaleResult">;

export interface OwnerMagnificUpscaleGenerateInput {
  readonly attemptId: string;
  readonly variant: OwnerMagnificUpscaleVariant;
  readonly image_handle: string;
  readonly parameters: unknown;
  readonly prompt?: string | undefined;
}

export interface OwnerMagnificUpscaleReconcileInput {
  readonly attemptId: string;
  readonly recovery_id: string;
}

export interface OwnerMagnificUpscaleRecoveryListInput {
  readonly attemptId: string;
  readonly limit: number;
}

export const OWNER_MAGNIFIC_GENERATION_PHASES = Object.freeze([
  "GENERATION_POST",
  "POST_ACK_KNOWN",
  "HISTORY_GET",
  "HISTORY_BINDING",
  "IN_PROGRESS_GET",
  "RESULT_GET",
  "RESULT_BINDING",
  "RESULT_WAIT"
] as const);

export type OwnerMagnificUpscaleGenerationPhase = typeof OWNER_MAGNIFIC_GENERATION_PHASES[number];
export type OwnerMagnificUpscaleResultReason = MagnificUpscaleResultPendingReason | MagnificUpscaleResultUnverifiedReason;

export interface OwnerMagnificUpscaleUnknownDiagnostic {
  readonly phase: OwnerMagnificUpscaleGenerationPhase;
  readonly post_started: boolean;
  readonly echo_ack_known: boolean;
  readonly history_binding: "NONE" | "PENDING" | "READY" | "INVALID";
  readonly history_binding_reason: OwnerMagnificHistoryBindingInvalidReason | null;
  readonly history_get_calls: number;
  readonly history_get_calls_saturated: boolean;
  readonly inprogress_get_calls: number;
  readonly inprogress_get_calls_saturated: boolean;
  readonly result_get_calls: number;
  readonly result_get_calls_saturated: boolean;
  readonly result_status: "NOT_READ" | "PENDING" | "COMPLETE" | "UNVERIFIED";
  readonly result_reason: OwnerMagnificUpscaleResultReason | null;
  readonly model_eq_requested?: boolean;
  readonly model_eq_family?: boolean;
}

export interface OwnerMagnificUpscaleArtifact {
  readonly url: string;
  readonly mime_type: string;
  readonly mime_source: "URL_EXTENSION";
}

export interface OwnerMagnificUpscaleGenerationResult {
  readonly status: "result_observed";
  readonly backend_acceptance: "unproven";
  readonly ai_name: "magnific";
  readonly model_id: OwnerMagnificUpscaleVariant;
  readonly variant: OwnerMagnificUpscaleVariant;
  readonly operation_id: "upscale-image";
  readonly profile_id: "magnific-upscale-source-reviewed-v1";
  readonly profile_schema_hash: string;
  readonly catalog_version: string;
  readonly request_fingerprint: string;
  readonly requested_scale_factor: OwnerMagnificUpscaleScaleFactor;
  readonly input_image: Readonly<{
    mime_type: string;
    width: number;
    height: number;
    size: number;
    sha256: string;
    metadata_confidence: "CONTAINER_METADATA_ONLY";
  }>;
  readonly expected_output_geometry: null;
  readonly actual_image: Readonly<{ mime_type: string; width: null; height: null }>;
  readonly geometry_verified: false;
  readonly artifact: OwnerMagnificUpscaleArtifact;
}

export interface OwnerMagnificUpscaleRecoveryListItem {
  readonly recovery_id: string;
  readonly created_at: string;
  readonly model_id: OwnerMagnificUpscaleVariant;
  readonly operation_id: "upscale-image";
  readonly status: "OUTCOME_UNKNOWN";
  readonly diagnostic: OwnerMagnificUpscaleUnknownDiagnostic;
}

export type OwnerMagnificUpscaleGenerationServiceErrorCode =
  | "INVALID_REQUEST"
  | "SERVICE_CLOSED"
  | "SERVICE_BUSY"
  | "PRINCIPAL_NOT_LINKED"
  | "MODEL_BINDING_MISMATCH"
  | "IMAGE_HANDLE_UNAVAILABLE"
  | "IMAGE_HANDLE_ALREADY_USED"
  | "PREFLIGHT_FAILED"
  | "PRE_DISPATCH_FAILED"
  | "OUTCOME_UNKNOWN"
  | "RECOVERY_NOT_FOUND";

export class OwnerMagnificUpscaleGenerationServiceError extends Error {
  readonly diagnostic: OwnerMagnificUpscaleUnknownDiagnostic | undefined;

  constructor(
    readonly code: OwnerMagnificUpscaleGenerationServiceErrorCode,
    readonly recovery_id?: string,
    diagnostic?: OwnerMagnificUpscaleUnknownDiagnostic
  ) {
    super(code === "OUTCOME_UNKNOWN"
      ? "The Magnific upscaler request may have been dispatched; reconcile with the same recovery handle and do not retry."
      : "The owner Magnific upscaler request could not be completed safely.");
    this.name = "OwnerMagnificUpscaleGenerationServiceError";
    this.diagnostic = code === "OUTCOME_UNKNOWN" ? diagnostic : undefined;
  }
}

const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const IMAGE_HANDLE_PATTERN = /^magnific_image_[0-9a-f-]{36}$/u;
const RECOVERY_PATTERN = /^magnific_recovery_[0-9a-f-]{36}$/u;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const PROMPT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const MAX_PROMPT_BYTES = 5_000;
const PARAMETER_FIELDS = Object.freeze(["scale_factor", "optimized_for", "engine", "creativity", "hdr", "resemblance", "fractality", "sharpen", "smart_grain", "ultra_detail", "flavor"] as const);
const RECOVERY_TTL_MS = 15 * 60_000;
const MAX_RECOVERIES = 128;
const MAX_CLAIMS = 128;
const MAX_PRINCIPALS = 128;
const MAX_PRINCIPAL_LOOKUPS = 128;
const MAX_PENDING = 4;
const DEFAULT_TIMEOUT_MS = OWNER_CLARITY_COMPLETION_LIMITS.operationTimeoutMs;
const DEFAULT_POLL_DELAY_MS = OWNER_CLARITY_COMPLETION_LIMITS.initialDelayMs;
const MAX_POLL_ATTEMPTS = OWNER_CLARITY_COMPLETION_LIMITS.maximumRounds;
const MAX_CLOCK_SKEW_MS = 30_000;
const E551_FETCHED_AT = "2026-10-08T13:18:39.393Z";
const E551_SOURCE_HASHES = Object.freeze({
  ai: "sha256:ad66f71c5ace9bb2c2670eb3ccddfbd013882928b398a100d0c757cd2895d609",
  llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
  models: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444"
});
const COST_PARAMETER_KEYS = Object.freeze(["height", "scale_factor", "width"] as const);
const MAGNIFIC_VARIANTS = Object.freeze(["creative", "precision_v1", "precision_v2"] as const);
const MODEL_OPERATION = "upscale-image" as const;
const NATIVE_CHAT_METHODS = Object.freeze({
  createChat: SyntxChatHttpClient.prototype.createImageUpscalerChat,
  startGeneration: SyntxChatHttpClient.prototype.startMagnificUpscaleWithOwnedCandidate,
  listHistory: SyntxChatHttpClient.prototype.listMessageCandidates,
  listInProgress: SyntxChatHttpClient.prototype.listInProgress,
  getResult: SyntxChatHttpClient.prototype.getMagnificUpscaleResult
});
interface MagnificRecoveryRecord {
  readonly recovery_id: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly image_handle: string;
  readonly variant: OwnerMagnificUpscaleVariant;
  readonly chat_uuid: string;
  readonly profile_id: "magnific-upscale-source-reviewed-v1";
  readonly profile_schema_hash: string;
  readonly catalog_version: string;
  readonly created_at: string;
  readonly expires_at: number;
  readonly request_fingerprint: string;
  readonly requested_scale_factor: OwnerMagnificUpscaleScaleFactor;
  readonly input_image: OwnerMagnificUpscaleGenerationResult["input_image"];
  readonly claim: MagnificHandleClaim;
  owner_echo_message_id: string | null;
  provider_chat_id: string | null;
  pending_bot_message_id: string | null;
  bound_bot_message_id: string | null;
  bound_object_id: string | null;
  completion_state: OwnerClarityUpscaleCompletionPolicyState;
  status: "POST_STARTED" | "OUTCOME_UNKNOWN";
  diagnostic: MutableMagnificDiagnostic;
}

interface MagnificHandleClaim {
  readonly image_handle: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly variant: OwnerMagnificUpscaleVariant;
  readonly request_fingerprint: string;
  readonly expires_at: number;
  status: "PREPARING" | "POST_STARTED" | "COMPLETED";
}

interface MutableMagnificDiagnostic {
  phase: OwnerMagnificUpscaleGenerationPhase;
  post_started: boolean;
  echo_ack_known: boolean;
  history_binding: OwnerMagnificUpscaleUnknownDiagnostic["history_binding"];
  history_binding_reason: OwnerMagnificHistoryBindingInvalidReason | null;
  history_get_calls: number;
  history_get_calls_saturated: boolean;
  inprogress_get_calls: number;
  inprogress_get_calls_saturated: boolean;
  result_get_calls: number;
  result_get_calls_saturated: boolean;
  result_status: OwnerMagnificUpscaleUnknownDiagnostic["result_status"];
  result_reason: OwnerMagnificUpscaleResultReason | null;
  model_eq_requested?: boolean;
  model_eq_family?: boolean;
}

interface CompletionRun {
  state: OwnerClarityUpscaleCompletionPolicyState;
  readonly persist: boolean;
}

/** Owner-only process-local Magnific lifecycle; it never grants public or runtime dispatch authority. */
export class OwnerMagnificUpscaleGenerationService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #catalogVersion: string;
  readonly #uploadService: OwnerMagnificUpscaleUploadService;
  readonly #issuer: OwnerMagnificUpscaleOwnedImageBindingIssuer;
  readonly #resolveChatClient: OwnerMagnificUpscaleGenerationServiceOptions["resolveChatClient"];
  readonly #preflight: OwnerMagnificUpscalePreflight;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #pollDelayMs: number;
  readonly #maxPollAttempts: number;
  readonly #pollWait: NonNullable<OwnerMagnificUpscaleGenerationServiceOptions["wait"]>;
  readonly #recoveries = new Map<string, MagnificRecoveryRecord>();
  readonly #claims = new Map<string, MagnificHandleClaim>();
  readonly #controllers = new Map<string, Set<AbortController>>();
  readonly #pendingByAttempt = new Map<string, Set<Promise<unknown>>>();
  readonly #pending = new Set<Promise<unknown>>();
  readonly #principals = new Map<string, Readonly<{ principal: Readonly<GenerationPrincipalRef>; expiresAt: number }>>();
  readonly #attemptEpochs = new Map<string, number>();
  readonly #principalLookups = new Map<string, number>();
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(options: OwnerMagnificUpscaleGenerationServiceOptions) {
    const fields = readExactRecord(options,
      ["binding", "linkService", "catalog", "catalogVersion", "uploadService", "resolveChatClient", "preflight",
        "now", "timeoutMs", "pollDelayMs", "maxPollAttempts", "wait"],
      ["now", "timeoutMs", "pollDelayMs", "maxPollAttempts", "wait"]);
    if (typeof fields.catalogVersion !== "string" ||
        !(fields.uploadService instanceof OwnerMagnificUpscaleUploadService) || types.isProxy(fields.uploadService) ||
        typeof fields.resolveChatClient !== "function" || types.isProxy(fields.resolveChatClient) ||
        typeof fields.preflight !== "function" || types.isProxy(fields.preflight) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now))) ||
        (fields.wait !== undefined && (typeof fields.wait !== "function" || types.isProxy(fields.wait))) ||
        !(fields.catalog instanceof DiscoveryCatalogRepository) || types.isProxy(fields.catalog)) {
      invalidGeneration("INVALID_REQUEST");
    }
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = snapshotLinkService(fields.linkService);
    this.#catalog = fields.catalog as DiscoveryCatalogRepository;
    this.#catalogVersion = fields.catalogVersion;
    this.#uploadService = fields.uploadService as OwnerMagnificUpscaleUploadService;
    this.#issuer = this.#uploadService.createOwnedImageBindingIssuer();
    this.#resolveChatClient = fields.resolveChatClient as OwnerMagnificUpscaleGenerationServiceOptions["resolveChatClient"];
    this.#preflight = fields.preflight as OwnerMagnificUpscalePreflight;
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    this.#timeoutMs = boundedInt(fields.timeoutMs, 1, DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    this.#pollDelayMs = boundedInt(fields.pollDelayMs, 0, DEFAULT_POLL_DELAY_MS, DEFAULT_POLL_DELAY_MS);
    this.#maxPollAttempts = boundedInt(fields.maxPollAttempts, 1, MAX_POLL_ATTEMPTS, MAX_POLL_ATTEMPTS);
    this.#pollWait = fields.wait === undefined ? waitDelay : readWait(fields.wait);
    for (const variant of MAGNIFIC_VARIANTS) validateSelectedMagnificModel(this.#catalog, this.#catalogVersion, variant);
  }

  generate(input: OwnerMagnificUpscaleGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerMagnificUpscaleGenerationResult> {
    const request = snapshotGenerateInput(input);
    return this.#run(request.attemptId, signal, (requestSignal) => this.#generate(request, requestSignal));
  }

  reconcile(input: OwnerMagnificUpscaleReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerMagnificUpscaleGenerationResult> {
    const request = snapshotReconcileInput(input);
    return this.#run(request.attemptId, signal, (requestSignal) => this.#reconcile(request, requestSignal));
  }

  async listRecoveries(input: OwnerMagnificUpscaleRecoveryListInput | unknown): Promise<readonly OwnerMagnificUpscaleRecoveryListItem[]> {
    this.#assertOpen();
    const fields = readExactRecord(input, ["attemptId", "limit"]);
    const attemptId = safeAttempt(fields.attemptId);
    if (!Number.isSafeInteger(fields.limit) || (fields.limit as number) < 1 || (fields.limit as number) > 20) {
      invalidGeneration("INVALID_REQUEST");
    }
    const principal = await this.#resolvePrincipal(attemptId);
    this.#prune();
    return Object.freeze([...this.#recoveries.values()]
      .filter((record) => record.attemptId === attemptId && sameGenerationPrincipal(record.principal, principal))
      .filter((record) => record.status === "OUTCOME_UNKNOWN")
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, fields.limit as number)
      .map((record) => Object.freeze({
        recovery_id: record.recovery_id,
        created_at: record.created_at,
        model_id: record.variant,
        operation_id: MODEL_OPERATION,
        status: "OUTCOME_UNKNOWN" as const,
        diagnostic: snapshotDiagnostic(record.diagnostic)
      })));
  }

  async invalidateAttempt(attemptIdInput: string): Promise<void> {
    if (typeof attemptIdInput !== "string" || !ATTEMPT_PATTERN.test(attemptIdInput)) return;
    if ((this.#principalLookups.get(attemptIdInput) ?? 0) > 0) {
      this.#attemptEpochs.set(attemptIdInput, (this.#attemptEpochs.get(attemptIdInput) ?? 0) + 1);
    }
    for (const controller of this.#controllers.get(attemptIdInput) ?? []) controller.abort();
    await Promise.allSettled([...(this.#pendingByAttempt.get(attemptIdInput) ?? [])]);
    this.#clearAttempt(attemptIdInput);
    this.#issuer.invalidateAttempt(attemptIdInput);
    this.#uploadService.invalidateAttempt(attemptIdInput);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const controllers of this.#controllers.values()) for (const controller of controllers) controller.abort();
    this.#issuer.close();
    this.#closing = (async () => {
      await Promise.allSettled([...this.#pending]);
      const attempts = new Set([
        ...this.#controllers.keys(), ...this.#principals.keys(),
        ...[...this.#claims.values()].map((claim) => claim.attemptId),
        ...[...this.#recoveries.values()].map((record) => record.attemptId)
      ]);
      for (const attempt of attempts) this.#uploadService.invalidateAttempt(attempt);
      await this.#uploadService.close();
      this.#recoveries.clear();
      this.#claims.clear();
      this.#principals.clear();
      this.#attemptEpochs.clear();
      this.#principalLookups.clear();
      this.#controllers.clear();
      this.#pendingByAttempt.clear();
    })();
    return this.#closing;
  }

  async #run<T>(attemptId: string, externalSignal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.#assertOpen();
    if (this.#pending.size >= MAX_PENDING) throw generationError("SERVICE_BUSY");
    const controller = new AbortController();
    const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
    const controllers = this.#controllers.get(attemptId) ?? new Set<AbortController>();
    controllers.add(controller); this.#controllers.set(attemptId, controllers);
    const promise = Promise.resolve().then(() => operation(signal)).finally(() => {
      controllers.delete(controller); if (controllers.size === 0) this.#controllers.delete(attemptId);
      this.#pending.delete(promise); this.#pendingByAttempt.get(attemptId)?.delete(promise);
      if (this.#pendingByAttempt.get(attemptId)?.size === 0) this.#pendingByAttempt.delete(attemptId);
    });
    this.#pending.add(promise);
    const byAttempt = this.#pendingByAttempt.get(attemptId) ?? new Set<Promise<unknown>>();
    byAttempt.add(promise); this.#pendingByAttempt.set(attemptId, byAttempt);
    return promise;
  }

  async #generate(request: ReturnType<typeof snapshotGenerateInput>, signal: AbortSignal): Promise<OwnerMagnificUpscaleGenerationResult> {
    let recovery: MagnificRecoveryRecord | undefined;
    let claim: MagnificHandleClaim | undefined;
    let dispatched = false;
    const deadline = new AbsoluteRequestDeadline(this.#timeoutMs, signal, () => generationError("OUTCOME_UNKNOWN", recovery?.recovery_id));
    try {
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      const candidate0 = await this.#await(deadline, () => this.#prepare(request, principal, deadline.signal));
      const reservedClaim = this.#reserve(request, principal, candidate0.request_fingerprint, candidate0.expires_at);
      claim = reservedClaim;
      const input = this.#preflightInput(request, principal, candidate0, deadline.signal);
      const first = await this.#await(deadline, () => this.#preflight(input)).catch(() => { throw generationError("PREFLIGHT_FAILED"); });
      this.#assertPreflight(first, request.variant, candidate0);
      await this.#assertPrincipalCurrent(request.attemptId, principal, deadline);
      const client = this.#resolveNativeClient(request.attemptId);
      const chat = await this.#await(deadline, () => client.createImageUpscalerChat(`owner-magnific-${randomUUID()}`, deadline.signal));
      if (!isRecord(chat) || !safeIdentifier(chat.chat_uuid)) throw generationError("PRE_DISPATCH_FAILED");
      await this.#assertPrincipalCurrent(request.attemptId, principal, deadline);
      const candidate = await this.#await(deadline, () => this.#prepare(request, principal, deadline.signal));
      if (candidate.request_fingerprint !== candidate0.request_fingerprint || !isDeepStrictEqual(candidate.request, candidate0.request)) throw generationError("PRE_DISPATCH_FAILED");
      const second = await this.#await(deadline, () => this.#preflight(this.#preflightInput(request, principal, candidate, deadline.signal)))
        .catch(() => { throw generationError("PREFLIGHT_FAILED"); });
      this.#assertPreflight(second, request.variant, candidate);
      await this.#assertPrincipalCurrent(request.attemptId, principal, deadline);
      const permit = createOwnerMagnificUpscaleOneShotPermit({ candidate, principal, attemptId: request.attemptId, catalog: this.#catalog, now: this.#now });
      recovery = this.#createRecovery(request, principal, chat.chat_uuid, candidate, reservedClaim);
      const receipt = await this.#await(deadline, () => {
        reservedClaim.status = "POST_STARTED";
        dispatched = true;
        recovery!.diagnostic.phase = "GENERATION_POST";
        recovery!.diagnostic.post_started = true;
        return client.startMagnificUpscaleWithOwnedCandidate({ candidate, permit, principal, attemptId: request.attemptId, chat_uuid: chat.chat_uuid }, deadline.signal);
      });
      if (!isRecord(receipt) || receipt.chat_uuid !== chat.chat_uuid || !safeIdentifier(receipt.message_id)) throw generationError("OUTCOME_UNKNOWN", recovery.recovery_id);
      recovery.owner_echo_message_id = receipt.message_id;
      recovery.diagnostic.echo_ack_known = true;
      recovery.diagnostic.phase = "POST_ACK_KNOWN";
      return await this.#observe(recovery, client, deadline);
    } catch (error) {
      if (dispatched && recovery) {
        recovery.status = "OUTCOME_UNKNOWN";
        if (claim && this.#claims.get(request.image_handle) === claim) claim.status = "POST_STARTED";
        throw unknownGenerationError(recovery, error);
      }
      this.#recoveries.delete(recovery?.recovery_id ?? "");
      if (claim && this.#claims.get(request.image_handle) === claim) this.#claims.delete(request.image_handle);
      if (error instanceof OwnerMagnificUpscaleGenerationServiceError) throw error;
      if (error instanceof OwnerMagnificUpscalePrepareError) {
        throw generationError(error.code === "PARAMETERS_INVALID" ? "INVALID_REQUEST" : "IMAGE_HANDLE_UNAVAILABLE");
      }
      throw error instanceof OwnerMagnificUpscaleUploadServiceError
        ? generationError("IMAGE_HANDLE_UNAVAILABLE") : generationError("PRE_DISPATCH_FAILED");
    } finally { deadline.close(); }
  }

  async #reconcile(request: ReturnType<typeof snapshotReconcileInput>, signal: AbortSignal): Promise<OwnerMagnificUpscaleGenerationResult> {
    const deadline = new AbsoluteRequestDeadline(this.#timeoutMs, signal, () => generationError("OUTCOME_UNKNOWN", request.recovery_id));
    let recovery: MagnificRecoveryRecord | undefined;
    try {
      recovery = this.#getRecovery(request.recovery_id, request.attemptId);
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      if (!sameGenerationPrincipal(principal, recovery.principal)) throw generationError("RECOVERY_NOT_FOUND");
      if (recovery.owner_echo_message_id === null) throw unknownGenerationError(recovery);
      return await this.#observe(recovery, this.#resolveNativeClient(request.attemptId), deadline,
        { state: createOwnerClarityUpscaleCompletionPolicy({ startedAtMs: this.#readNow(), initialDelayMs: this.#pollDelayMs, maxRounds: this.#maxPollAttempts }), persist: false });
    } catch (error) {
      if (error instanceof OwnerMagnificUpscaleGenerationServiceError && error.code === "RECOVERY_NOT_FOUND") throw error;
      if (!recovery) throw error instanceof OwnerMagnificUpscaleGenerationServiceError ? error : generationError("PRE_DISPATCH_FAILED");
      recovery.status = "OUTCOME_UNKNOWN";
      throw unknownGenerationError(recovery, error);
    } finally { deadline.close(); }
  }

  async #observe(recovery: MagnificRecoveryRecord, client: SyntxChatHttpClient, deadline: AbsoluteRequestDeadline,
    run: CompletionRun = { state: recovery.completion_state, persist: true }): Promise<OwnerMagnificUpscaleGenerationResult> {
    if (recovery.owner_echo_message_id === null) throw unknownGenerationError(recovery);
    for (let round = 0; round < this.#maxPollAttempts; round += 1) {
      deadline.throwIfAborted();
      if (run.persist && recovery.expires_at <= this.#readNow()) throw unknownGenerationError(recovery);
      if (this.#readNow() - run.state.startedAtMs >= this.#timeoutMs || run.state.rounds >= run.state.maxRounds) break;
      if (recovery.bound_bot_message_id === null || recovery.bound_object_id === null) {
        recovery.diagnostic.phase = "HISTORY_GET";
        incrementDiagnostic(recovery.diagnostic, "history");
        const snapshot = await this.#await(deadline, () => client.listMessageCandidates(recovery.chat_uuid, recovery.owner_echo_message_id!, deadline.signal));
        recovery.diagnostic.phase = "HISTORY_BINDING";
        const binding = correlateOwnerMagnificUpscaleHistoryBinding({ snapshot, requested_chat_uuid: recovery.chat_uuid,
          owner_echo_message_id: recovery.owner_echo_message_id, variant: recovery.variant });
        recovery.diagnostic.history_binding = binding.kind;
        recovery.diagnostic.history_binding_reason = binding.kind === "INVALID" ? binding.reason : null;
        if (binding.kind === "INVALID") throw unknownGenerationError(recovery);
        recovery.provider_chat_id = binding.provider_chat_id;
        if (binding.kind === "READY") {
          recovery.bound_bot_message_id = binding.bot_message_id;
          recovery.bound_object_id = binding.object_id;
        } else {
          recovery.pending_bot_message_id = binding.bot_message_id;
          recovery.diagnostic.phase = "IN_PROGRESS_GET";
          incrementDiagnostic(recovery.diagnostic, "inprogress");
          const queue = await this.#await(deadline, () => client.listInProgress(recovery.chat_uuid, deadline.signal));
          if (!Array.isArray(queue) || queue.length > 10) throw unknownGenerationError(recovery);
          await this.#waitNext(deadline, run, recovery, queue.length === 0 ? "EMPTY" : "PENDING");
          continue;
        }
      }
      if (!recovery.provider_chat_id || !recovery.bound_bot_message_id || !recovery.bound_object_id) throw unknownGenerationError(recovery);
      recovery.diagnostic.phase = "RESULT_GET";
      incrementDiagnostic(recovery.diagnostic, "result");
      const result = await this.#await(deadline, () => client.getMagnificUpscaleResult({
        chat_uuid: recovery.chat_uuid, message_id: recovery.bound_bot_message_id!, variant: recovery.variant,
        provider_chat_id: recovery.provider_chat_id!, message_object_id: recovery.bound_object_id!
      }, deadline.signal));
      deadline.throwIfAborted();
      if (run.persist && recovery.expires_at <= this.#readNow()) throw unknownGenerationError(recovery);
      await this.#assertPrincipalCurrent(recovery.attemptId, recovery.principal, deadline);
      deadline.throwIfAborted();
      if ((run.persist && recovery.expires_at <= this.#readNow()) || this.#claims.get(recovery.image_handle) !== recovery.claim) throw unknownGenerationError(recovery);
      recovery.diagnostic.phase = "RESULT_BINDING";
      recovery.diagnostic.result_status = result.status;
      if (result.status === "UNVERIFIED") {
        recovery.diagnostic.result_reason = result.reason;
        if (result.model_eq_requested !== undefined) recovery.diagnostic.model_eq_requested = result.model_eq_requested;
        if (result.model_eq_family !== undefined) recovery.diagnostic.model_eq_family = result.model_eq_family;
        throw unknownGenerationError(recovery);
      }
      if (result.status === "PENDING") {
        recovery.diagnostic.result_reason = result.reason;
        recovery.diagnostic.phase = "RESULT_WAIT";
        await this.#waitNext(deadline, run, recovery);
        continue;
      }
      if (result.chat_uuid !== recovery.chat_uuid || result.message_id !== recovery.bound_bot_message_id ||
          result.provider_chat_id !== recovery.provider_chat_id || result.message_object_id !== recovery.bound_object_id ||
          result.model_type !== recovery.variant || !result.completed || !isSafeUploadReferenceUrl(result.artifact.url)) throw unknownGenerationError(recovery);
      if (this.#claims.get(recovery.image_handle) !== recovery.claim) throw unknownGenerationError(recovery);
      this.#recoveries.delete(recovery.recovery_id);
      recovery.claim.status = "COMPLETED";
      return resultFor(recovery, result);
    }
    throw unknownGenerationError(recovery);
  }

  async #prepare(request: ReturnType<typeof snapshotGenerateInput>, principal: Readonly<GenerationPrincipalRef>, signal: AbortSignal): Promise<OwnerMagnificUpscalePreparedCandidate> {
    signal.throwIfAborted();
    const image_binding = await this.#issuer.issue({ principal, attempt_id: request.attemptId, variant: request.variant, opaque_image_handle: request.image_handle });
    signal.throwIfAborted();
    return prepareOwnerMagnificUpscaleRequest({ principal, attempt_id: request.attemptId, variant: request.variant,
      parameters: request.parameters, image_binding, ...(request.prompt === undefined ? {} : { prompt: request.prompt }) }, { now: this.#now });
  }

  #preflightInput(request: ReturnType<typeof snapshotGenerateInput>, principal: Readonly<GenerationPrincipalRef>, candidate: OwnerMagnificUpscalePreparedCandidate, signal: AbortSignal): OwnerMagnificUpscalePreflightInput {
    return Object.freeze({ attemptId: request.attemptId, principal, variant: request.variant,
      cost_inputs: Object.freeze({ width: candidate.image.width, height: candidate.image.height,
        scale_factor: candidate.request.settings.scale_factor as OwnerMagnificUpscaleScaleFactor }), request_fingerprint: candidate.request_fingerprint, signal });
  }

  #assertPreflight(value: OwnerMagnificUpscalePreflightResult, variant: OwnerMagnificUpscaleVariant, candidate: OwnerMagnificUpscalePreparedCandidate): void {
    const top = readExactRecord(value, ["account", "model_access"], [], "PREFLIGHT_FAILED");
    const account = readExactRecord(top.account, ["balance", "subscription", "contract_evidence", "source_build", "observed_at"], [], "PREFLIGHT_FAILED");
    const balance = readExactRecord(account.balance, ["unit", "available"], [], "PREFLIGHT_FAILED");
    const subscription = readExactRecord(account.subscription, ["active", "plan_type", "end_date", "end_date_kind"], [], "PREFLIGHT_FAILED");
    const access = readExactRecord(top.model_access, ["catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live",
      "parameter_keys", "parameters_redacted", "access", "cost", "discount_cost", "free_remaining_generations", "limit", "show_warning", "observed_at"], [], "PREFLIGHT_FAILED");
    const now = this.#readNow();
    const model = this.#catalog.getModel(variant);
    if (account.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || account.source_build !== ACCOUNT_SOURCE_BUILD ||
        balance.unit !== "tokens" || !(balance.available === null || typeof balance.available === "string") || !validPaidSubscription(subscription, now) ||
        !freshTimestamp(Date.parse(String(account.observed_at)), now) || access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" ||
        access.catalog_version !== `${this.#catalog.fetched_at}.${this.#catalog.source_hashes.models.slice(7, 19)}` ||
        access.model_id !== variant || access.ai_name !== "magnific" || access.model_type !== variant ||
        access.account_read_live !== true || access.access !== true || access.parameters_redacted !== true ||
        !isDeepStrictEqual(snapshotArray(access.parameter_keys, 16).sort(), COST_PARAMETER_KEYS) ||
        !freshTimestamp(Date.parse(String(access.observed_at)), now) || !finiteNonnegative(access.cost) ||
        model.id !== variant || model.upstream_id !== variant || model.ai_name !== "magnific" || model.active !== true ||
        model.scope !== "tool_image_upscaler" || !model.modalities.includes("image") ||
        !model.operations.some((operation) => operation.id === MODEL_OPERATION && operation.output_modality === "image") ||
        candidate.variant !== variant || candidate.model_id !== variant) throw generationError("PREFLIGHT_FAILED");
  }

  #reserve(request: ReturnType<typeof snapshotGenerateInput>, principal: Readonly<GenerationPrincipalRef>, fingerprint: string, candidateExpiresAt: number): MagnificHandleClaim {
    this.#prune();
    if (this.#claims.has(request.image_handle)) throw generationError("IMAGE_HANDLE_ALREADY_USED");
    if (this.#claims.size >= MAX_CLAIMS) throw generationError("SERVICE_BUSY");
    const expiresAt = Math.min(this.#readNow() + RECOVERY_TTL_MS, candidateExpiresAt);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= this.#readNow()) throw generationError("IMAGE_HANDLE_UNAVAILABLE");
    const claim: MagnificHandleClaim = { image_handle: request.image_handle, attemptId: request.attemptId, principal, variant: request.variant,
      request_fingerprint: fingerprint, expires_at: expiresAt, status: "PREPARING" };
    this.#claims.set(request.image_handle, claim); return claim;
  }

  #createRecovery(request: ReturnType<typeof snapshotGenerateInput>, principal: Readonly<GenerationPrincipalRef>, chat_uuid: string,
    candidate: OwnerMagnificUpscalePreparedCandidate, claim: MagnificHandleClaim): MagnificRecoveryRecord {
    this.#prune(); if (this.#recoveries.size >= MAX_RECOVERIES) throw generationError("SERVICE_BUSY");
    const now = this.#readNow();
    const expiresAt = Math.min(now + RECOVERY_TTL_MS, candidate.expires_at);
    if (expiresAt <= now) throw generationError("IMAGE_HANDLE_UNAVAILABLE");
    const recovery: MagnificRecoveryRecord = { recovery_id: `magnific_recovery_${randomUUID()}`, attemptId: request.attemptId,
      principal, image_handle: request.image_handle, variant: request.variant, chat_uuid, profile_id: candidate.profile_id,
      profile_schema_hash: candidate.profile_schema_hash, catalog_version: this.#catalogVersion, created_at: new Date(now).toISOString(),
      expires_at: expiresAt, request_fingerprint: candidate.request_fingerprint,
      requested_scale_factor: candidate.request.settings.scale_factor as OwnerMagnificUpscaleScaleFactor,
      input_image: Object.freeze({ ...candidate.image }), claim, owner_echo_message_id: null, provider_chat_id: null,
      pending_bot_message_id: null, bound_bot_message_id: null, bound_object_id: null,
      completion_state: createOwnerClarityUpscaleCompletionPolicy({ startedAtMs: now, initialDelayMs: this.#pollDelayMs, maxRounds: this.#maxPollAttempts }),
      status: "POST_STARTED", diagnostic: initialDiagnostic() };
    this.#recoveries.set(recovery.recovery_id, recovery); return recovery;
  }

  async #resolvePrincipal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    this.#assertOpen();
    const activeLookups = this.#principalLookups.get(attemptId) ?? 0;
    if ((activeLookups === 0 && this.#principalLookups.size >= MAX_PRINCIPALS) || activeLookups >= MAX_PRINCIPAL_LOOKUPS) {
      throw generationError("SERVICE_BUSY");
    }
    const epoch = this.#attemptEpochs.get(attemptId) ?? 0;
    this.#principalLookups.set(attemptId, activeLookups + 1);
    let principal: Readonly<GenerationPrincipalRef>;
    try {
      try { principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService }); }
      catch { throw generationError("PRINCIPAL_NOT_LINKED"); }
      if (this.#closed || (this.#attemptEpochs.get(attemptId) ?? 0) !== epoch) throw generationError("PRINCIPAL_NOT_LINKED");
      if (principal.connection_id !== attemptId) throw generationError("PRINCIPAL_NOT_LINKED");
      const snapshot = snapshotGenerationPrincipal(principal);
      this.#prune();
      if (!this.#principals.has(attemptId) && this.#principals.size >= MAX_PRINCIPALS) throw generationError("SERVICE_BUSY");
      this.#principals.set(attemptId, Object.freeze({ principal: snapshot, expiresAt: this.#readNow() + RECOVERY_TTL_MS }));
      return snapshot;
    } finally {
      const remaining = (this.#principalLookups.get(attemptId) ?? 1) - 1;
      if (remaining <= 0) {
        this.#principalLookups.delete(attemptId);
        this.#attemptEpochs.delete(attemptId);
      } else this.#principalLookups.set(attemptId, remaining);
    }
  }

  async #assertPrincipalCurrent(attemptId: string, expected: Readonly<GenerationPrincipalRef>, deadline: AbsoluteRequestDeadline): Promise<void> {
    const current = await this.#await(deadline, () => this.#resolvePrincipal(attemptId));
    if (!sameGenerationPrincipal(expected, current)) throw generationError("PRINCIPAL_NOT_LINKED");
  }

  #resolveNativeClient(attemptId: string): SyntxChatHttpClient {
    const client = this.#resolveChatClient(attemptId);
    if (!(client instanceof SyntxChatHttpClient) || types.isProxy(client) || client.createImageUpscalerChat !== NATIVE_CHAT_METHODS.createChat ||
        client.startMagnificUpscaleWithOwnedCandidate !== NATIVE_CHAT_METHODS.startGeneration ||
        client.listMessageCandidates !== NATIVE_CHAT_METHODS.listHistory || client.listInProgress !== NATIVE_CHAT_METHODS.listInProgress ||
        client.getMagnificUpscaleResult !== NATIVE_CHAT_METHODS.getResult) throw generationError("MODEL_BINDING_MISMATCH");
    return client;
  }

  #getRecovery(id: string, attemptId: string): MagnificRecoveryRecord {
    this.#prune(); const item = this.#recoveries.get(id);
    if (!item || item.attemptId !== attemptId || item.status !== "OUTCOME_UNKNOWN") throw generationError("RECOVERY_NOT_FOUND");
    return item;
  }

  async #waitNext(deadline: AbsoluteRequestDeadline, run: CompletionRun, recovery: MagnificRecoveryRecord,
    queueState: "EMPTY" | "PENDING" | "UNKNOWN" = "UNKNOWN"): Promise<void> {
    const decision = decideOwnerClarityUpscaleCompletion({ state: run.state, nowMs: this.#readNow(), aborted: deadline.signal.aborted,
      echoAckKnown: recovery.diagnostic.echo_ack_known, exactBotMessageBound: recovery.bound_bot_message_id !== null,
      historyBinding: recovery.diagnostic.history_binding === "READY" ? "VALID" : recovery.diagnostic.history_binding === "INVALID" ? "INVALID" :
        recovery.bound_bot_message_id === null ? "NONE" : "VALID",
      queueState, resultState: recovery.diagnostic.result_status === "PENDING" ? "PENDING" : "NOT_READ", unverifiedReason: null });
    if (decision.decision !== "WAIT") throw unknownGenerationError(recovery);
    run.state = decision.state; if (run.persist) recovery.completion_state = decision.state;
    if (decision.nextDelayMs > 0) await deadline.waitFor(this.#pollWait(decision.nextDelayMs, deadline.signal));
    else deadline.throwIfAborted();
  }

  #prune(): void {
    const now = this.#readNow();
    for (const [handle, claim] of this.#claims) if (claim.status === "PREPARING" && claim.expires_at <= now) this.#claims.delete(handle);
    for (const [attempt, principal] of this.#principals) if (principal.expiresAt <= now) this.#principals.delete(attempt);
  }
  #clearAttempt(attemptId: string): void {
    for (const [id, recovery] of this.#recoveries) if (recovery.attemptId === attemptId) this.#recoveries.delete(id);
    for (const [handle, claim] of this.#claims) if (claim.attemptId === attemptId) this.#claims.delete(handle);
    this.#principals.delete(attemptId);
  }
  #readNow(): number { const value = this.#now(); if (!Number.isSafeInteger(value) || value < 0) throw generationError("PRE_DISPATCH_FAILED"); return value; }
  #assertOpen(): void { if (this.#closed) throw generationError("SERVICE_CLOSED"); }
  async #await<T>(deadline: AbsoluteRequestDeadline, operation: () => Promise<T>): Promise<T> {
    deadline.throwIfAborted();
    return deadline.waitFor(Promise.resolve().then(() => { deadline.throwIfAborted(); return operation(); }));
  }
}

function snapshotGenerateInput(value: unknown): { attemptId: string; variant: OwnerMagnificUpscaleVariant; image_handle: string; parameters: unknown; prompt?: string } {
  const fields = readExactRecord(value, ["attemptId", "variant", "image_handle", "parameters"], ["prompt"]);
  const attemptId = safeAttempt(fields.attemptId);
  if (!MAGNIFIC_VARIANTS.includes(fields.variant as OwnerMagnificUpscaleVariant) || typeof fields.image_handle !== "string" ||
      !IMAGE_HANDLE_PATTERN.test(fields.image_handle) || (fields.prompt !== undefined && (typeof fields.prompt !== "string" ||
      Buffer.byteLength(fields.prompt, "utf8") > MAX_PROMPT_BYTES || PROMPT_CONTROL.test(fields.prompt)))) invalidGeneration("INVALID_REQUEST");
  const parameters = readExactRecord(fields.parameters, PARAMETER_FIELDS);
  return Object.freeze({ attemptId, variant: fields.variant as OwnerMagnificUpscaleVariant, image_handle: fields.image_handle,
    parameters: Object.freeze({ ...parameters }), ...(fields.prompt === undefined || fields.prompt === "" ? {} : { prompt: fields.prompt as string }) });
}

function snapshotReconcileInput(value: unknown): { attemptId: string; recovery_id: string } {
  const fields = readExactRecord(value, ["attemptId", "recovery_id"]);
  return Object.freeze({ attemptId: safeAttempt(fields.attemptId), recovery_id: safeRecovery(fields.recovery_id) });
}

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = readExactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || typeof fields.subject !== "string") invalidGeneration("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}

function snapshotLinkService(value: unknown): Pick<PerUserLinkService, "getStatus"> {
  if (!isRecord(value) || types.isProxy(value)) invalidGeneration("INVALID_REQUEST");
  const method = findMethod(value, "getStatus");
  if (typeof method !== "function") invalidGeneration("INVALID_REQUEST");
  return Object.freeze({ getStatus: (binding: AuthBinding, attemptId: string) => Reflect.apply(method, value, [binding, attemptId]) });
}

function readExactRecord(value: unknown, required: readonly string[], optional: readonly string[] = [],
  failureCode: OwnerMagnificUpscaleGenerationServiceErrorCode = "INVALID_REQUEST"): Record<string, unknown> {
  if (!isRecord(value) || types.isProxy(value)) invalidGeneration(failureCode);
  let prototype: object | null; let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); }
  catch { invalidGeneration(failureCode); }
  if (prototype !== Object.prototype && prototype !== null) invalidGeneration(failureCode);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || !required.includes(key) && !optional.includes(key) ||
      !descriptors[key]?.enumerable || !("value" in descriptors[key]!)) ||
      required.some((key) => !optional.includes(key) && !Object.hasOwn(descriptors, key))) invalidGeneration(failureCode);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function snapshotArray(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value) || types.isProxy(value)) throw generationError("PREFLIGHT_FAILED");
  let keys: PropertyKey[]; let length: unknown;
  try { keys = Reflect.ownKeys(value); length = Object.getOwnPropertyDescriptor(value, "length")?.value; }
  catch { throw generationError("PREFLIGHT_FAILED"); }
  if (Object.getPrototypeOf(value) !== Array.prototype || !Number.isSafeInteger(length) || (length as number) < 0 ||
      (length as number) > maximum || keys.length !== (length as number) + 1) throw generationError("PREFLIGHT_FAILED");
  const result: string[] = [];
  for (let index = 0; index < (length as number); index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor) || typeof descriptor.value !== "string") throw generationError("PREFLIGHT_FAILED");
    result.push(descriptor.value);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, any> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function safeAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT_PATTERN.test(value)) invalidGeneration("INVALID_REQUEST"); return value; }
function safeRecovery(value: unknown): string { if (typeof value !== "string" || !RECOVERY_PATTERN.test(value)) invalidGeneration("INVALID_REQUEST"); return value; }
function safeIdentifier(value: unknown): value is string { return typeof value === "string" && SAFE_IDENTIFIER.test(value); }
function finiteNonnegative(value: unknown): boolean { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function freshTimestamp(time: number, now: number): boolean { return Number.isFinite(time) && time <= now && now - time <= MAX_CLOCK_SKEW_MS; }
function validPaidSubscription(subscription: Record<string, any>, _now: number): boolean {
  if (subscription.active !== true || typeof subscription.plan_type !== "string" || subscription.plan_type.trim() === "" ||
      subscription.plan_type.trim().toLocaleUpperCase("en-US") === "FREE") return false;
  // A fresh account snapshot's active flag is authoritative; don't infer a timezone for local/date-only fields.
  return true;
}

function validateSelectedMagnificModel(catalog: DiscoveryCatalogRepository, version: string, variant: OwnerMagnificUpscaleVariant): void {
  const profile = getOwnerMagnificUpscaleSourceProfile(variant);
  if (version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION || version !== profile.public_catalog_version ||
      catalog.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || catalog.runtime_usable !== false ||
      catalog.fetched_at !== E551_FETCHED_AT || catalog.source_hashes.models !== E551_SOURCE_HASHES.models) invalidGeneration("INVALID_REQUEST");
  const model = catalog.getModel(variant);
  if (model.id !== variant || model.upstream_id !== variant || model.ai_name !== "magnific" || model.scope !== "tool_image_upscaler" ||
      model.active !== true || !model.modalities.includes("image") || !model.operations.some((item) => item.id === MODEL_OPERATION && item.output_modality === "image")) invalidGeneration("INVALID_REQUEST");
}

function initialDiagnostic(): MutableMagnificDiagnostic {
  return { phase: "GENERATION_POST", post_started: false, echo_ack_known: false, history_binding: "NONE", history_binding_reason: null,
    history_get_calls: 0, history_get_calls_saturated: false, inprogress_get_calls: 0, inprogress_get_calls_saturated: false,
    result_get_calls: 0, result_get_calls_saturated: false, result_status: "NOT_READ", result_reason: null };
}

function snapshotDiagnostic(value: MutableMagnificDiagnostic): OwnerMagnificUpscaleUnknownDiagnostic {
  return Object.freeze({ ...value });
}

function incrementDiagnostic(diagnostic: MutableMagnificDiagnostic, kind: "history" | "inprogress" | "result"): void {
  const key = kind === "history" ? "history_get_calls" : kind === "inprogress" ? "inprogress_get_calls" : "result_get_calls";
  const saturated = kind === "history" ? "history_get_calls_saturated" : kind === "inprogress" ? "inprogress_get_calls_saturated" : "result_get_calls_saturated";
  if (diagnostic[key] >= 99) { diagnostic[saturated] = true; return; }
  diagnostic[key] += 1;
}

function resultFor(recovery: MagnificRecoveryRecord, result: Extract<InternalMagnificUpscaleResult, { status: "COMPLETE" }>): OwnerMagnificUpscaleGenerationResult {
  return Object.freeze({ status: "result_observed", backend_acceptance: "unproven", ai_name: "magnific", model_id: recovery.variant,
    variant: recovery.variant, operation_id: MODEL_OPERATION, profile_id: recovery.profile_id, profile_schema_hash: recovery.profile_schema_hash,
    catalog_version: recovery.catalog_version, request_fingerprint: recovery.request_fingerprint,
    requested_scale_factor: recovery.requested_scale_factor, input_image: recovery.input_image, expected_output_geometry: null,
    actual_image: Object.freeze({ mime_type: result.artifact.mime_type, width: null, height: null }), geometry_verified: false,
    artifact: Object.freeze({ url: result.artifact.url, mime_type: result.artifact.mime_type, mime_source: "URL_EXTENSION" }) });
}

function unknownGenerationError(recovery: MagnificRecoveryRecord, _cause?: unknown): OwnerMagnificUpscaleGenerationServiceError {
  recovery.diagnostic.post_started = true;
  return new OwnerMagnificUpscaleGenerationServiceError("OUTCOME_UNKNOWN", recovery.recovery_id, snapshotDiagnostic(recovery.diagnostic));
}

function generationError(code: OwnerMagnificUpscaleGenerationServiceErrorCode, recoveryId?: string): OwnerMagnificUpscaleGenerationServiceError {
  return new OwnerMagnificUpscaleGenerationServiceError(code, recoveryId);
}

function invalidGeneration(code: OwnerMagnificUpscaleGenerationServiceErrorCode): never { throw generationError(code); }

function boundedInt(value: unknown, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) invalidGeneration("INVALID_REQUEST");
  return value;
}

function readClock(value: unknown): () => number { if (typeof value !== "function") invalidGeneration("INVALID_REQUEST"); return value as () => number; }
function readWait(value: unknown): NonNullable<OwnerMagnificUpscaleGenerationServiceOptions["wait"]> {
  if (typeof value !== "function") invalidGeneration("INVALID_REQUEST"); return value as NonNullable<OwnerMagnificUpscaleGenerationServiceOptions["wait"]>;
}
function waitDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error("ABORTED"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new Error("ABORTED")); };
    signal.addEventListener("abort", abort, { once: true });
  });
}
function findMethod(target: object, name: string): unknown {
  let current: object | null = target;
  while (current) { const d = Object.getOwnPropertyDescriptor(current, name); if (d) return "value" in d ? d.value : undefined; current = Object.getPrototypeOf(current) as object | null; }
  return undefined;
}
