import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type {
  ChatMessageHistorySnapshot,
  CreateChatReceipt,
  InProgressMessage,
  MediaGenerationReceipt,
  RedactedMessageEnvelope,
  SafeArtifactMetadata,
  StartImageRequest,
  StartVideoRequest
} from "../adapter/syntx/chat-http-client.js";
import type { InternalUploadReference } from "../adapter/syntx/upload-reference-bridge.js";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import type { PreparedSyntxMediaRequest } from "../adapter/syntx/upstream-adapter.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import type { GenerationContractStatus } from "../domain/generation-contract.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import {
  consumeOwnerImageReferenceOneShotPermit,
  type OwnerImageReferenceOneShotPermit
} from "./owner-image-reference-one-shot-policy.js";
import {
  isOwnerImageReferencePreparedCandidateForPrincipal,
  type OwnerImageReferencePreparedCandidate
} from "./owner-image-reference-request-preparer.js";
import { OwnerMediaReferenceStore, type OwnerMediaReferenceContractBinding } from "./owner-media-reference-store.js";
import type {
  OwnerContractMediaRecoveryListItem,
  OwnerContractMediaRecoveryRecord,
  OwnerContractMediaRecoveryStoreLike
} from "./owner-contract-media-recovery.js";
import {
  consumeOwnerReviewedContractProbePolicy,
  ownerReviewedContractProbePolicyAllowsDispatch,
  ownerReviewedContractProbePolicyBindsRecovery,
  type OwnerReviewedContractMediaPolicy
} from "./owner-contract-probe-policy.js";

const DEFAULT_IMAGE_TIMEOUT_MS = 180_000;
const MAX_IMAGE_TIMEOUT_MS = 180_000;
const DEFAULT_VIDEO_TIMEOUT_MS = 420_000;
const MAX_VIDEO_TIMEOUT_MS = 420_000;
const START_POLL_ATTEMPTS = 20;
const START_POLL_DELAY_MS = 2_000;
const RESULT_POLL_DELAY_MS = 3_000;
const TERMINAL_RECONCILIATION_ATTEMPTS = 2;
const TERMINAL_RECONCILIATION_DELAY_MS = 1_000;
const MAX_RECOVERY_CANDIDATES = 8;
const MAX_RETURNED_ARTIFACTS = 16;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_CONTRACT_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const SAFE_PROMPT_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const SAFE_REFERENCE_HANDLE = /^reference_[0-9a-f-]{36}$/u;
const REFERENCE_REGISTRY_VERSION = "sha256-0e5b7a6ab56a4fc5103c025690293297b49258c1c876d7a0a663ff7959099d39.json";

export interface OwnerContractMediaContractContext {
  readonly model_id: string;
  readonly operation_id: "generate-image" | "generate-video";
  readonly modality: "image" | "video";
  readonly ai_name: string;
  readonly model_type: string;
  readonly variant_id?: string;
  readonly schema_hash: string;
  readonly status: GenerationContractStatus;
  readonly mime_types: readonly string[];
  readonly registry_version?: string;
  readonly catalog_version?: string;
}

/** Read-only port used by unknown-outcome recovery; it cannot dispatch or delete. */
export interface OwnerContractMediaReadClient {
  listInProgress(chatUuid: string, signal?: AbortSignal): Promise<InProgressMessage[]>;
  getMessage(chatUuid: string, messageId: string, signal?: AbortSignal): Promise<RedactedMessageEnvelope>;
  /** Optional bounded native history port; used only when this saga has its known ACK. */
  listMessageCandidates?(
    chatUuid: string,
    ownerEchoMessageId: string,
    signal?: AbortSignal
  ): Promise<ChatMessageHistorySnapshot>;
}

/** Narrow dispatch port: there is intentionally no delete or retry method. */
export interface OwnerContractMediaClient extends OwnerContractMediaReadClient {
  createChat(scope: "image" | "video", title: string, signal?: AbortSignal): Promise<CreateChatReceipt>;
  startImage(request: StartImageRequest, signal?: AbortSignal): Promise<MediaGenerationReceipt>;
  startVideo(request: StartVideoRequest, signal?: AbortSignal): Promise<MediaGenerationReceipt>;
}

/** Exact image-reference dispatch port; it cannot fall back to ordinary startImage. */
export interface OwnerImageReferenceDispatchClient extends OwnerContractMediaReadClient {
  createChat(scope: "image", title: string, signal?: AbortSignal): Promise<CreateChatReceipt>;
  startImageWithInternalReferences(
    request: StartImageRequest,
    references: readonly InternalUploadReference[],
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt>;
}

export interface OwnerContractMediaResult {
  readonly model_id: string;
  readonly operation_id: "generate-image" | "generate-video";
  readonly modality: "image" | "video";
  readonly artifacts: readonly SafeArtifactMetadata[];
}

export type OwnerContractMediaErrorCode =
  | "PREPARED_REQUEST_MISMATCH"
  | "PRE_DISPATCH_FAILED"
  | "OUTCOME_UNKNOWN"
  | "RECOVERY_NOT_FOUND";

export class OwnerContractMediaError extends Error {
  readonly recoveryId: string | undefined;

  constructor(readonly code: OwnerContractMediaErrorCode, recoveryId?: string) {
    super(ownerContractMediaErrorMessage(code));
    this.name = "OwnerContractMediaError";
    this.recoveryId = recoveryId;
  }
}

export interface OwnerContractMediaServiceOptions {
  readonly recoveryStore: OwnerContractMediaRecoveryStoreLike;
  /** Injectable only for local tests; production callers use bounded timers. */
  readonly wait?: (milliseconds: number) => Promise<void>;
  readonly now?: () => number;
  /** Test/runtime overrides may shorten, but never extend, observed modality bounds. */
  readonly imageTimeoutMs?: number;
  readonly videoTimeoutMs?: number;
}

export interface GenerateOwnerContractMediaInput {
  readonly client: OwnerContractMediaClient;
  readonly attemptId: string;
  readonly contract: OwnerContractMediaContractContext;
  /** Must already be returned by GenerationContractExecutor.prepare(). */
  readonly prepared: PreparedSyntxMediaRequest;
  /** Optional source-only one-shot authorization for a single reviewed exact tuple. */
  readonly probePolicy?: OwnerReviewedContractMediaPolicy;
  /** Optional exact-attempt gates; called before chat creation and again before entering dispatch. */
  readonly beforeChat?: (signal: AbortSignal) => Promise<void>;
  readonly beforeDispatch?: (signal: AbortSignal) => Promise<void>;
  readonly signal?: AbortSignal;
}

export interface OwnerImageReferenceLifecyclePreflight {
  readonly verifyFreshSubscription: (attemptId: string, principal: GenerationPrincipalRef, signal?: AbortSignal) => Promise<void>;
  readonly verifyModelAccess: (attemptId: string, principal: GenerationPrincipalRef, modelId: string, signal?: AbortSignal) => Promise<void>;
  readonly authorizeCost: (attemptId: string, principal: GenerationPrincipalRef, candidate: OwnerImageReferencePreparedCandidate, signal?: AbortSignal) => Promise<void>;
}

export interface GenerateOwnerImageReferenceCandidateInput {
  readonly client: OwnerImageReferenceDispatchClient;
  readonly attemptId: string;
  /** The separately live-verified base profile; the reference candidate remains blocked. */
  readonly contract: OwnerContractMediaContractContext;
  readonly candidate: OwnerImageReferencePreparedCandidate;
  readonly permit: OwnerImageReferenceOneShotPermit;
  readonly resolveAuthPrincipal: (attemptId: string, signal?: AbortSignal) => Promise<GenerationPrincipalRef>;
  readonly preflight: OwnerImageReferenceLifecyclePreflight;
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly referenceStore: OwnerMediaReferenceStore;
  readonly referenceHandle: string;
  readonly signal?: AbortSignal;
}

export interface ReconcileOwnerContractMediaInput {
  readonly client: OwnerContractMediaReadClient;
  readonly attemptId: string;
  readonly recoveryId: string;
  readonly contract: OwnerContractMediaContractContext;
  readonly probePolicy?: OwnerReviewedContractMediaPolicy;
  readonly signal?: AbortSignal;
}

/**
 * Owner-only prepared-media lifecycle. Contract validation, catalog binding,
 * and subscription preflight belong before this service. This layer accepts
 * only the immutable prepared payload and exact live contract context.
 */
export class OwnerContractMediaService {
  readonly #recoveryStore: OwnerContractMediaRecoveryStoreLike;
  readonly #wait: (milliseconds: number) => Promise<void>;
  readonly #now: () => number;
  readonly #imageTimeoutMs: number;
  readonly #videoTimeoutMs: number;

  constructor(options: OwnerContractMediaServiceOptions) {
    this.#recoveryStore = options.recoveryStore;
    this.#wait = options.wait ?? delay;
    this.#now = options.now ?? Date.now;
    this.#imageTimeoutMs = boundedTimeout(options.imageTimeoutMs, DEFAULT_IMAGE_TIMEOUT_MS, MAX_IMAGE_TIMEOUT_MS);
    this.#videoTimeoutMs = boundedTimeout(options.videoTimeoutMs, DEFAULT_VIDEO_TIMEOUT_MS, MAX_VIDEO_TIMEOUT_MS);
  }

  async generate(input: GenerateOwnerContractMediaInput): Promise<OwnerContractMediaResult> {
    const liveRequest = matchesPreparedContract(input.prepared, input.contract);
    const reviewedRequest = input.probePolicy !== undefined && ownerReviewedContractProbePolicyAllowsDispatch(
      input.probePolicy, input.attemptId, input.contract, input.prepared
    );
    if ((!liveRequest && !reviewedRequest) ||
        !validAttemptId(input.attemptId) ||
        hasExternalReference(input.prepared.settings)) {
      throw mediaError("PREPARED_REQUEST_MISMATCH");
    }

    const timeoutMs = this.timeoutFor(input.contract.modality);
    const deadline = new AbsoluteRequestDeadline(timeoutMs, input.signal, () => new Error("OWNER_CONTRACT_MEDIA_DEADLINE"));
    let chatUuid: string | null = null;
    let recoveryId: string | null = null;
    let dispatchPossible = false;
    try {
      deadline.throwIfAborted();
      if (input.beforeChat !== undefined) {
        await waitWithDeadline(deadline, () => input.beforeChat!(deadline.signal));
      }
      if (input.contract.status === "reviewed" && (input.probePolicy === undefined || !consumeOwnerReviewedContractProbePolicy(
        input.probePolicy, input.attemptId, input.contract, input.prepared
      ))) throw mediaError("PREPARED_REQUEST_MISMATCH");
      const chat = await waitWithDeadline(deadline, () => input.client.createChat(
        input.contract.modality,
        `owner-contract-${input.contract.modality}-${randomUUID()}`,
        deadline.signal
      ));
      if (!isSafeIdentifier(chat?.chat_uuid)) throw mediaError("PRE_DISPATCH_FAILED");
      const createdChatUuid = chat.chat_uuid;
      chatUuid = createdChatUuid;

      // Reserve the opaque handle before the single dispatch so recovery-store
      // capacity/validation failures cannot happen after a possibly paid POST.
      recoveryId = this.#recoveryStore.create({
        attemptId: input.attemptId,
        chatUuid: createdChatUuid,
        messageId: null,
        contract: input.contract,
        ...(input.probePolicy === undefined ? {} : { probePolicy: input.probePolicy }),
        now: this.#now()
      }).recovery_id;
      deadline.throwIfAborted();
      if (input.beforeDispatch !== undefined) {
        await waitWithDeadline(deadline, () => input.beforeDispatch!(deadline.signal));
      }
      deadline.throwIfAborted();
      dispatchPossible = true;
      const dispatch = await waitWithDeadline(deadline, () => this.dispatch(input.client, input.prepared, createdChatUuid, deadline.signal));
      const echoedMessageId = isSafeIdentifier(dispatch?.message_id) ? dispatch.message_id : null;
      if (echoedMessageId === null || dispatch.chat_uuid !== createdChatUuid) throw mediaError("OUTCOME_UNKNOWN");
      this.#recoveryStore.updateMessageId(recoveryId, input.attemptId, echoedMessageId);

      // The dispatch receipt id may already address a completed bot message.
      // If it is only the caller echo, strict DTO identity/MIME checks reject
      // it and the normal bot-message discovery continues below.
      try {
        const receiptMessage = await waitWithDeadline(deadline, () => input.client.getMessage(createdChatUuid, echoedMessageId, deadline.signal));
        const receiptArtifacts = verifiedArtifacts(receiptMessage, input.contract, createdChatUuid, echoedMessageId);
        if (receiptArtifacts.length > 0) {
          try { this.#recoveryStore.remove(recoveryId, input.attemptId); } catch { /* TTL bounds an unused private handle. */ }
          return resultFor(input.contract, receiptArtifacts);
        }
      } catch {
        deadline.throwIfAborted();
      }

      const historyMessageId = input.client.listMessageCandidates === undefined
        ? null
        : await this.resolveHistoryMessageId(input.client, input.contract, chatUuid, echoedMessageId, deadline);
      const botMessageId = historyMessageId ?? await this.waitForBotMessageId(
        input.client, input.contract, chatUuid, echoedMessageId, deadline
      );
      const artifacts = await this.waitForArtifacts(
        input.client,
        input.contract,
        chatUuid,
        botMessageId,
        Math.ceil(timeoutMs / RESULT_POLL_DELAY_MS),
        deadline
      );
      if (artifacts.length === 0) throw mediaError("OUTCOME_UNKNOWN");
      try { this.#recoveryStore.remove(recoveryId, input.attemptId); } catch { /* TTL bounds an unused private handle. */ }
      return resultFor(input.contract, artifacts);
    } catch (error) {
      if (!dispatchPossible) {
        if (recoveryId !== null) {
          try { this.#recoveryStore.remove(recoveryId, input.attemptId); } catch { /* Best-effort cleanup before dispatch. */ }
        }
        if (error instanceof OwnerContractMediaError) throw error;
        throw mediaError("PRE_DISPATCH_FAILED");
      }
      if (error instanceof OwnerContractMediaError && error.code === "OUTCOME_UNKNOWN" && error.recoveryId) throw error;
      if (recoveryId === null) throw mediaError("OUTCOME_UNKNOWN");
      throw mediaError("OUTCOME_UNKNOWN", recoveryId);
    } finally {
      deadline.close();
    }
  }

  /** Explicit source-only Banana reference path. It never admits references to ordinary generate(). */
  async generateImageReferenceCandidate(input: GenerateOwnerImageReferenceCandidateInput): Promise<OwnerContractMediaResult> {
    const candidate = input.candidate;
    const contract = snapshotContractContextForReference(input.contract);
    const binding = snapshotAuthBinding(input.binding);
    const attemptId = input.attemptId;
    const referenceHandle = input.referenceHandle;
    const resolveAuthPrincipal = input.resolveAuthPrincipal;
    const preflight = snapshotReferencePreflight(input.preflight);
    const referenceStore = input.referenceStore;
    const linkService = input.linkService;
    if (!validAttemptId(attemptId) || !validContractContext(contract) || contract.status !== "live_verified" ||
        contract.modality !== "image" || contract.operation_id !== "generate-image" ||
        contract.model_id !== "banana-2.1" || contract.model_type !== "banana-2.1" || contract.ai_name !== "banana" ||
        !SAFE_REFERENCE_HANDLE.test(referenceHandle) || !(referenceStore instanceof OwnerMediaReferenceStore) ||
        !input.client || typeof input.client.startImageWithInternalReferences !== "function" ||
        typeof resolveAuthPrincipal !== "function" || preflight === null) {
      throw mediaError("PREPARED_REQUEST_MISMATCH");
    }

    const timeoutMs = this.timeoutFor("image");
    const deadline = new AbsoluteRequestDeadline(timeoutMs, input.signal, () => new Error("OWNER_CONTRACT_MEDIA_DEADLINE"));
    let chatUuid: string | null = null;
    let recoveryId: string | null = null;
    let dispatchPossible = false;
    try {
      deadline.throwIfAborted();
      const principal = snapshotGenerationPrincipal(await waitWithDeadline(deadline, () => resolveAuthPrincipal(attemptId, deadline.signal)));
      if (!isOwnerImageReferencePreparedCandidateForPrincipal(candidate, principal, attemptId) ||
          contract.variant_id !== candidate.base_variant_id || contract.schema_hash !== candidate.base_schema_hash ||
          contract.mime_types.length !== 1 || contract.mime_types[0] !== "image/jpeg" ||
          (contract.registry_version !== undefined && contract.registry_version !== REFERENCE_REGISTRY_VERSION) ||
          (contract.catalog_version !== undefined && contract.catalog_version !== candidate.catalog_version)) {
        throw mediaError("PREPARED_REQUEST_MISMATCH");
      }
      const referenceUrl = candidateReferenceUrl(candidate);
      if (referenceUrl === null) throw mediaError("PREPARED_REQUEST_MISMATCH");
      const bindingPrincipal = snapshotGenerationPrincipal({
        tenant_id: binding.tenant_id,
        subject_id: binding.subject,
        connection_id: attemptId
      });
      if (!sameGenerationPrincipal(principal, bindingPrincipal)) throw mediaError("PREPARED_REQUEST_MISMATCH");

      // Consume only the exact owner/contract/URL handle. It is local cleanup,
      // not evidence that the upstream hidden upload was deleted.
      const referenceContract: OwnerMediaReferenceContractBinding = Object.freeze({
        schema_hash: candidate.candidate_schema_hash,
        catalog_version: `sha256-${candidate.registry_sha256.slice("sha256:".length)}.json`,
        model_id: candidate.model_id,
        model_type: candidate.model_type,
        operation_id: candidate.operation_id,
        modality: "image",
        variant_id: candidate.candidate_variant_id
      });
      await referenceStore.consumeImageReference({
        binding,
        attemptId,
        linkService,
        contract: referenceContract,
        reference_handles: [referenceHandle],
        reference_handle: referenceHandle,
        expected_url: referenceUrl
      });

      await waitWithDeadline(deadline, () => preflight.verifyFreshSubscription(attemptId, principal, deadline.signal));
      await waitWithDeadline(deadline, () => preflight.verifyModelAccess(attemptId, principal, contract.model_id, deadline.signal));
      await waitWithDeadline(deadline, () => preflight.authorizeCost(attemptId, principal, candidate, deadline.signal));
      await this.assertCurrentPrincipal(resolveAuthPrincipal, attemptId, principal, deadline);
      consumeOwnerImageReferenceOneShotPermit({
        permit: input.permit,
        candidate,
        principal,
        attemptId
      });

      const chat = await waitWithDeadline(deadline, () => input.client.createChat(
        "image", `owner-contract-image-${randomUUID()}`, deadline.signal
      ));
      if (!isSafeIdentifier(chat?.chat_uuid)) throw mediaError("PRE_DISPATCH_FAILED");
      chatUuid = chat.chat_uuid;
      recoveryId = this.#recoveryStore.create({
        attemptId,
        chatUuid,
        messageId: null,
        contract,
        imageReferenceCandidate: Object.freeze({
          candidate_schema_hash: candidate.candidate_schema_hash,
          status: "blocked",
          dispatch_allowed: false,
          backend_acceptance: "unproven"
        }),
        now: this.#now()
      }).recovery_id;
      deadline.throwIfAborted();
      await this.assertCurrentPrincipal(resolveAuthPrincipal, attemptId, principal, deadline);
      deadline.throwIfAborted();
      dispatchPossible = true;
      const dispatchSettings = Object.freeze({ ...candidate.request.settings, file_urls: Object.freeze([]) });
      const dispatch = await waitWithDeadline(deadline, () => input.client.startImageWithInternalReferences({
        ai_name: contract.ai_name,
        prompt: candidate.request.prompt,
        settings: dispatchSettings,
        chat_uuid: chat!.chat_uuid
      }, Object.freeze([{ url: referenceUrl }]), deadline.signal));
      const echoedMessageId = isSafeIdentifier(dispatch?.message_id) ? dispatch.message_id : null;
      if (echoedMessageId === null || dispatch.chat_uuid !== chatUuid) throw mediaError("OUTCOME_UNKNOWN");
      this.#recoveryStore.updateMessageId(recoveryId, attemptId, echoedMessageId);

      try {
        const receiptMessage = await waitWithDeadline(deadline, () => input.client.getMessage(chatUuid!, echoedMessageId, deadline.signal));
        const receiptArtifacts = verifiedArtifacts(receiptMessage, contract, chatUuid, echoedMessageId);
        if (receiptArtifacts.length > 0) {
          try { this.#recoveryStore.remove(recoveryId, attemptId); } catch { /* TTL bounds an unused private handle. */ }
          return resultFor(contract, receiptArtifacts);
        }
      } catch { deadline.throwIfAborted(); }

      const historyMessageId = input.client.listMessageCandidates === undefined
        ? null
        : await this.resolveHistoryMessageId(input.client, contract, chatUuid, echoedMessageId, deadline);
      const botMessageId = historyMessageId ?? await this.waitForBotMessageId(
        input.client, contract, chatUuid, echoedMessageId, deadline
      );
      const artifacts = await this.waitForArtifacts(
        input.client, contract, chatUuid, botMessageId,
        Math.ceil(timeoutMs / RESULT_POLL_DELAY_MS), deadline
      );
      if (artifacts.length === 0) throw mediaError("OUTCOME_UNKNOWN");
      try { this.#recoveryStore.remove(recoveryId, attemptId); } catch { /* TTL bounds an unused private handle. */ }
      return resultFor(contract, artifacts);
    } catch (error) {
      if (!dispatchPossible) {
        if (recoveryId !== null) {
          try { this.#recoveryStore.remove(recoveryId, attemptId); } catch { /* Best-effort pre-dispatch cleanup. */ }
        }
        if (error instanceof OwnerContractMediaError) throw error;
        throw mediaError("PRE_DISPATCH_FAILED");
      }
      if (error instanceof OwnerContractMediaError && error.code === "OUTCOME_UNKNOWN" && error.recoveryId) throw error;
      if (recoveryId === null) throw mediaError("OUTCOME_UNKNOWN");
      throw mediaError("OUTCOME_UNKNOWN", recoveryId);
    } finally {
      deadline.close();
    }
  }

  async reconcile(input: ReconcileOwnerContractMediaInput): Promise<OwnerContractMediaResult> {
    const liveContract = validContractContext(input.contract);
    const reviewedRecovery = input.contract.status === "reviewed" && ownerReviewedContractProbePolicyBindsRecovery(
      input.probePolicy, input.attemptId, input.contract
    );
    if (!validAttemptId(input.attemptId) || !validRecoveryId(input.recoveryId) ||
        (!liveContract && !reviewedRecovery)) throw mediaError("RECOVERY_NOT_FOUND");
    const record = this.#recoveryStore.get(input.recoveryId, input.attemptId);
    if (!record || !sameRecoveryContract(record, input.contract)) throw mediaError("RECOVERY_NOT_FOUND");

    const deadline = new AbsoluteRequestDeadline(this.timeoutFor(input.contract.modality), input.signal, () => mediaError("OUTCOME_UNKNOWN", input.recoveryId));
    try {
      let artifacts: SafeArtifactMetadata[] = [];
      if (record.message_id !== null) {
        try {
          const message = await waitWithDeadline(deadline, () => input.client.getMessage(record.chat_uuid, record.message_id!, deadline.signal));
          artifacts = verifiedArtifacts(message, input.contract, record.chat_uuid, record.message_id);
        } catch {
          deadline.throwIfAborted();
        }
      }
      if (artifacts.length === 0) {
        if (record.message_id !== null && input.client.listMessageCandidates !== undefined) {
          const history = await waitWithDeadline(deadline, () => input.client.listMessageCandidates!(
            record.chat_uuid, record.message_id!, deadline.signal
          ));
          const historyMessageId = uniqueOwnedChatBotMessageId(history, record.chat_uuid, record.message_id, input.contract);
          if (historyMessageId !== null) {
            const message = await waitWithDeadline(deadline, () => input.client.getMessage(
              record.chat_uuid, historyMessageId, deadline.signal
            ));
            artifacts = verifiedArtifacts(message, input.contract, record.chat_uuid, historyMessageId);
          }
        }
      }
      if (artifacts.length === 0) {
        const entries = await waitWithDeadline(deadline, () => input.client.listInProgress(record.chat_uuid, deadline.signal));
        const candidates = entries
          .filter((entry) => isSafeIdentifier(entry.message_id) && matchesInProgress(entry, input.contract))
          .slice(0, MAX_RECOVERY_CANDIDATES);
        for (const entry of candidates) {
          deadline.throwIfAborted();
          const message = await waitWithDeadline(deadline, () => input.client.getMessage(record.chat_uuid, entry.message_id, deadline.signal));
          artifacts = verifiedArtifacts(message, input.contract, record.chat_uuid, entry.message_id);
          if (artifacts.length > 0) break;
        }
      }
      if (artifacts.length === 0) throw mediaError("OUTCOME_UNKNOWN", record.recovery_id);
      return resultFor(input.contract, artifacts);
    } catch (error) {
      if (error instanceof OwnerContractMediaError && error.code === "RECOVERY_NOT_FOUND") throw error;
      throw mediaError("OUTCOME_UNKNOWN", record.recovery_id);
    } finally {
      deadline.close();
    }
  }

  /** Bounded local-only lookup after a client may have lost an unknown-outcome handle. */
  listRecoveries(attemptId: string, limit = 20): readonly OwnerContractMediaRecoveryListItem[] {
    return this.#recoveryStore.list(attemptId, limit);
  }

  private dispatch(
    client: OwnerContractMediaClient,
    prepared: PreparedSyntxMediaRequest,
    chatUuid: string,
    signal: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    if (prepared.modality === "image") {
      return client.startImage({
        ai_name: prepared.ai_name,
        prompt: prepared.prompt,
        settings: prepared.settings,
        chat_uuid: chatUuid
      }, signal);
    }
    if (prepared.modality === "video") {
      return client.startVideo({
        ai_name: prepared.ai_name,
        prompt: prepared.prompt,
        settings: prepared.settings,
        chat_id: chatUuid
      }, signal);
    }
    throw mediaError("PREPARED_REQUEST_MISMATCH");
  }

  private async assertCurrentPrincipal(
    resolveAuthPrincipal: GenerateOwnerImageReferenceCandidateInput["resolveAuthPrincipal"],
    attemptId: string,
    initialPrincipal: GenerationPrincipalRef,
    deadline: AbsoluteRequestDeadline
  ): Promise<void> {
    const current = snapshotGenerationPrincipal(await waitWithDeadline(
      deadline,
      () => resolveAuthPrincipal(attemptId, deadline.signal)
    ));
    if (!sameGenerationPrincipal(initialPrincipal, current)) throw mediaError("PRE_DISPATCH_FAILED");
  }

  private async waitForBotMessageId(
    client: OwnerContractMediaReadClient,
    contract: OwnerContractMediaContractContext,
    chatUuid: string,
    echoedMessageId: string,
    deadline: AbsoluteRequestDeadline
  ): Promise<string> {
    for (let attempt = 0; attempt < START_POLL_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await waitWithDeadline(deadline, () => this.#wait(START_POLL_DELAY_MS));
      const entries = await waitWithDeadline(deadline, () => client.listInProgress(chatUuid, deadline.signal));
      const candidate = entries.find((entry) => entry.message_id !== echoedMessageId && matchesInProgress(entry, contract));
      if (candidate && isSafeIdentifier(candidate.message_id)) return candidate.message_id;
    }
    throw mediaError("OUTCOME_UNKNOWN");
  }

  private async resolveHistoryMessageId(
    client: OwnerContractMediaReadClient,
    contract: OwnerContractMediaContractContext,
    chatUuid: string,
    echoedMessageId: string,
    deadline: AbsoluteRequestDeadline
  ): Promise<string | null> {
    const history = await waitWithDeadline(deadline, () => client.listMessageCandidates!(
      chatUuid, echoedMessageId, deadline.signal
    ));
    return uniqueOwnedChatBotMessageId(history, chatUuid, echoedMessageId, contract);
  }

  private async waitForArtifacts(
    client: OwnerContractMediaReadClient,
    contract: OwnerContractMediaContractContext,
    chatUuid: string,
    messageId: string,
    maxAttempts: number,
    deadline: AbsoluteRequestDeadline
  ): Promise<SafeArtifactMetadata[]> {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (attempt > 0) await waitWithDeadline(deadline, () => this.#wait(RESULT_POLL_DELAY_MS));
      const message = await waitWithDeadline(deadline, () => client.getMessage(chatUuid, messageId, deadline.signal));
      const artifacts = verifiedArtifacts(message, contract, chatUuid, messageId);
      if (artifacts.length > 0) return artifacts;
      const inProgress = await waitWithDeadline(deadline, () => client.listInProgress(chatUuid, deadline.signal));
      const stillInProgress = inProgress.some((entry) => entry.message_id === messageId && matchesInProgress(entry, contract));
      if (!stillInProgress) {
        for (let reconciliation = 0; reconciliation < TERMINAL_RECONCILIATION_ATTEMPTS; reconciliation += 1) {
          await waitWithDeadline(deadline, () => this.#wait(TERMINAL_RECONCILIATION_DELAY_MS));
          const reconciled = await waitWithDeadline(deadline, () => client.getMessage(chatUuid, messageId, deadline.signal));
          const lateArtifacts = verifiedArtifacts(reconciled, contract, chatUuid, messageId);
          if (lateArtifacts.length > 0) return lateArtifacts;
        }
        throw mediaError("OUTCOME_UNKNOWN");
      }
    }
    throw mediaError("OUTCOME_UNKNOWN");
  }

  private timeoutFor(modality: "image" | "video"): number {
    return modality === "image" ? this.#imageTimeoutMs : this.#videoTimeoutMs;
  }
}

function matchesPreparedContract(
  prepared: PreparedSyntxMediaRequest,
  contract: OwnerContractMediaContractContext
): boolean {
  if (!validContractContext(contract) || contract.status !== "live_verified" ||
      prepared.ai_name !== contract.ai_name || prepared.modality !== contract.modality ||
      prepared.schema_hash !== contract.schema_hash || prepared.prompt.trim().length === 0 ||
      Buffer.byteLength(prepared.prompt, "utf8") > 128 * 1024 || SAFE_PROMPT_CONTROLS.test(prepared.prompt)) return false;
  if (!isPlainRecord(prepared.settings) || prepared.settings.model_type !== contract.model_type ||
      hasExternalReference(prepared.settings)) return false;
  return true;
}

function validContractContext(context: OwnerContractMediaContractContext): boolean {
  const operation = context.modality === "image" ? "generate-image"
    : context.modality === "video" ? "generate-video" : null;
  return context.status === "live_verified" && operation !== null && context.operation_id === operation &&
    SAFE_CONTRACT_IDENTIFIER.test(context.model_id) && SAFE_CONTRACT_IDENTIFIER.test(context.ai_name) && SAFE_CONTRACT_IDENTIFIER.test(context.model_type) &&
    (context.variant_id === undefined || SAFE_CONTRACT_IDENTIFIER.test(context.variant_id)) &&
    /^sha256:[a-f0-9]{64}$/u.test(context.schema_hash) && Array.isArray(context.mime_types) &&
    context.mime_types.length > 0 && context.mime_types.length <= 32 &&
    context.mime_types.every((mime) => typeof mime === "string" && mime.startsWith(`${context.modality}/`) && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u.test(mime));
}

function matchesInProgress(entry: InProgressMessage, contract: OwnerContractMediaContractContext): boolean {
  return entry.object_type === contract.modality && entry.model_type === contract.model_type;
}

function uniqueOwnedChatBotMessageId(
  history: ChatMessageHistorySnapshot,
  chatUuid: string,
  echoedMessageId: string,
  contract: OwnerContractMediaContractContext
): string | null {
  if (!isSafeIdentifier(chatUuid) || !isSafeIdentifier(echoedMessageId) ||
      history?.complete !== true || history.page !== 1 || history.page_size !== 10 ||
      history.has_next !== false || history.has_previous !== false ||
      !Number.isSafeInteger(history.total_count) || history.total_count !== history.messages?.length ||
      (history.total_count !== 1 && history.total_count !== 2) || history.total_pages !== 1 ||
      !/^\d+$/u.test(history.provider_chat_id) || !Array.isArray(history.messages)) {
    throw mediaError("OUTCOME_UNKNOWN");
  }
  const ownerRows = history.messages.filter((entry) => entry.message_id === echoedMessageId && entry.author_role === "owner");
  if (history.total_count === 1 && ownerRows.length === 1 &&
      ownerRows[0]!.provider_chat_id === history.provider_chat_id && Array.isArray(ownerRows[0]!.objects)) return null;
  const botRows = history.messages.filter((entry) => entry.author_role === "bot");
  if (ownerRows.length !== 1 || botRows.length !== 1 || history.messages.length !== 2 ||
      history.messages.some((entry) => !isSafeIdentifier(entry.message_id) || entry.provider_chat_id !== history.provider_chat_id) ||
      new Set(history.messages.map((entry) => entry.message_id)).size !== 2 ||
      !Array.isArray(ownerRows[0]!.objects) || !Array.isArray(botRows[0]!.objects) || botRows[0]!.objects.length !== 1) {
    throw mediaError("OUTCOME_UNKNOWN");
  }
  const bot = botRows[0]!;
  if (bot.message_id === echoedMessageId) throw mediaError("OUTCOME_UNKNOWN");
  const [object] = bot.objects;
  if (!object || !isSafeIdentifier(object.message_object_id) ||
      object.object_type !== contract.modality || object.model_type !== contract.model_type) {
    throw mediaError("OUTCOME_UNKNOWN");
  }
  return bot.message_id;
}

function verifiedArtifacts(
  message: RedactedMessageEnvelope,
  contract: OwnerContractMediaContractContext,
  chatUuid: string,
  messageId: string
): SafeArtifactMetadata[] {
  if (message.chat_uuid !== chatUuid || message.message_id !== messageId ||
      message.object_type !== contract.modality || message.model_type !== contract.model_type ||
      !Array.isArray(message.artifacts)) return [];
  return message.artifacts
    .filter((artifact) => isVerifiedArtifact(artifact, contract.mime_types))
    .slice(0, MAX_RETURNED_ARTIFACTS)
    .map((artifact) => structuredClone(artifact));
}

function isVerifiedArtifact(artifact: SafeArtifactMetadata, allowedMimeTypes: readonly string[]): boolean {
  if (typeof artifact.url !== "string" || typeof artifact.mime_type !== "string" || !allowedMimeTypes.includes(artifact.mime_type)) return false;
  try {
    const url = new URL(artifact.url);
    return url.protocol === "https:" && url.hostname === "r2.syntx.ai" && url.username === "" &&
      url.password === "" && url.port === "" && url.hash === "";
  } catch { return false; }
}

function hasExternalReference(settings: Readonly<Record<string, unknown>>): boolean {
  const fileUrls = settings.file_urls;
  if (fileUrls !== undefined && (!Array.isArray(fileUrls) || fileUrls.length !== 0)) return true;
  const stack: unknown[] = [settings];
  while (stack.length > 0) {
    const value = stack.pop();
    if (typeof value === "string") {
      if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)) return true;
      continue;
    }
    if (Array.isArray(value)) { stack.push(...value); continue; }
    if (isPlainRecord(value)) {
      for (const [key, child] of Object.entries(value)) {
        const name = key.toLowerCase();
        if ((name === "url" || name.endsWith("_url") || name.endsWith("_urls")) &&
            child !== null && child !== "" && !(Array.isArray(child) && child.length === 0)) return true;
        stack.push(child);
      }
    }
  }
  return false;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && SAFE_IDENTIFIER.test(value);
}

function validAttemptId(value: unknown): value is string {
  return typeof value === "string" && /^link_[A-Za-z0-9_-]{20,120}$/u.test(value);
}

function validRecoveryId(value: unknown): value is string {
  return typeof value === "string" && /^recovery_[0-9a-f-]{36}$/u.test(value);
}

function resultFor(contract: OwnerContractMediaContractContext, artifacts: SafeArtifactMetadata[]): OwnerContractMediaResult {
  return Object.freeze({
    model_id: contract.model_id,
    operation_id: contract.operation_id,
    modality: contract.modality,
    artifacts: Object.freeze(artifacts.map((artifact) => Object.freeze({ ...artifact })))
  });
}

function candidateReferenceUrl(candidate: OwnerImageReferencePreparedCandidate): string | null {
  if (candidate.status !== "blocked" || candidate.dispatch_allowed !== false ||
      candidate.backend_acceptance !== "unproven" || candidate.candidate_variant_id !== "banana21-image-1k-minimal-square-reference-candidate" ||
      !/^sha256:[a-f0-9]{64}$/u.test(candidate.candidate_schema_hash) ||
      !Array.isArray(candidate.request.settings.file_urls) || candidate.request.settings.file_urls.length !== 1) return null;
  const [entry] = candidate.request.settings.file_urls;
  if (!entry || typeof entry !== "object" || Array.isArray(entry) || entry.type !== "image" ||
      typeof entry.url !== "string" || !isSafeUploadReferenceUrl(entry.url)) return null;
  return entry.url;
}

function snapshotContractContextForReference(value: unknown): OwnerContractMediaContractContext {
  const fields = readStrictDataRecord(value,
    ["model_id", "operation_id", "modality", "ai_name", "model_type", "schema_hash", "status", "mime_types"],
    ["variant_id", "registry_version", "catalog_version"]);
  const mimeTypes = snapshotStringArray(fields.mime_types);
  return Object.freeze({
    model_id: fields.model_id as string,
    operation_id: fields.operation_id as "generate-image" | "generate-video",
    modality: fields.modality as "image" | "video",
    ai_name: fields.ai_name as string,
    model_type: fields.model_type as string,
    ...(fields.variant_id === undefined ? {} : { variant_id: fields.variant_id as string }),
    schema_hash: fields.schema_hash as string,
    status: fields.status as GenerationContractStatus,
    mime_types: mimeTypes,
    ...(fields.registry_version === undefined ? {} : { registry_version: fields.registry_version as string }),
    ...(fields.catalog_version === undefined ? {} : { catalog_version: fields.catalog_version as string })
  });
}

function snapshotStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || types.isProxy(value)) throw mediaError("PREPARED_REQUEST_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || !Object.hasOwn(descriptors, "length")) throw mediaError("PREPARED_REQUEST_MISMATCH");
  const result: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || typeof descriptor.value !== "string") {
      throw mediaError("PREPARED_REQUEST_MISMATCH");
    }
    result.push(descriptor.value);
  }
  if (keys.some((key) => key !== "length" && (typeof key !== "string" || !/^\d+$/u.test(key) || Number(key) >= value.length))) {
    throw mediaError("PREPARED_REQUEST_MISMATCH");
  }
  return Object.freeze(result);
}

function snapshotAuthBinding(value: unknown): AuthBinding {
  const fields = readStrictDataRecord(value, ["tenant_id", "subject"], []);
  if (typeof fields.tenant_id !== "string" || typeof fields.subject !== "string") throw mediaError("PREPARED_REQUEST_MISMATCH");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}

function snapshotReferencePreflight(value: unknown): OwnerImageReferenceLifecyclePreflight | null {
  try {
    const fields = readStrictDataRecord(value,
      ["verifyFreshSubscription", "verifyModelAccess", "authorizeCost"], []);
    if (Object.values(fields).some((method) => typeof method !== "function")) return null;
    return Object.freeze({
      verifyFreshSubscription: fields.verifyFreshSubscription as OwnerImageReferenceLifecyclePreflight["verifyFreshSubscription"],
      verifyModelAccess: fields.verifyModelAccess as OwnerImageReferenceLifecyclePreflight["verifyModelAccess"],
      authorizeCost: fields.authorizeCost as OwnerImageReferenceLifecyclePreflight["authorizeCost"]
    });
  } catch { return null; }
}

function readStrictDataRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[]
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) {
    throw mediaError("PREPARED_REQUEST_MISMATCH");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw mediaError("PREPARED_REQUEST_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (requiredKeys.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) =>
    typeof key !== "string" || (!requiredKeys.includes(key) && !optionalKeys.includes(key)) ||
    !("value" in descriptors[key]!) || !descriptors[key]!.enumerable
  )) throw mediaError("PREPARED_REQUEST_MISMATCH");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function boundedTimeout(value: number | undefined, fallback: number, maximum: number): number {
  const timeout = value ?? fallback;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > maximum) {
    throw new Error("OWNER_CONTRACT_MEDIA_TIMEOUT_INVALID");
  }
  return timeout;
}

function waitWithDeadline<T>(deadline: AbsoluteRequestDeadline, operation: () => Promise<T>): Promise<T> {
  deadline.throwIfAborted();
  return deadline.waitFor(operation());
}

function sameRecoveryContract(record: OwnerContractMediaRecoveryRecord, contract: OwnerContractMediaContractContext): boolean {
  const contractValid = contract.status === "live_verified"
    ? validContractContext(contract)
    : contract.status === "reviewed" && validContractContext({ ...contract, status: "live_verified" });
  return contractValid && record.status === contract.status && record.model_id === contract.model_id &&
    record.operation_id === contract.operation_id && record.modality === contract.modality &&
    record.ai_name === contract.ai_name && record.model_type === contract.model_type &&
    record.variant_id === contract.variant_id &&
    record.schema_hash === contract.schema_hash && record.registry_version === contract.registry_version &&
    record.catalog_version === contract.catalog_version && record.mime_types.length === contract.mime_types.length &&
    record.mime_types.every((mime, index) => mime === contract.mime_types[index]);
}

function ownerContractMediaErrorMessage(code: OwnerContractMediaErrorCode): string {
  switch (code) {
    case "PREPARED_REQUEST_MISMATCH": return "The prepared owner contract request is unavailable.";
    case "PRE_DISPATCH_FAILED": return "The owner media request did not reach generation dispatch.";
    case "OUTCOME_UNKNOWN": return "The owner media request may have been dispatched; do not retry automatically.";
    case "RECOVERY_NOT_FOUND": return "The owner media recovery handle is unavailable.";
  }
}

function mediaError(code: OwnerContractMediaErrorCode, recoveryId?: string): OwnerContractMediaError {
  return new OwnerContractMediaError(code, recoveryId);
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
