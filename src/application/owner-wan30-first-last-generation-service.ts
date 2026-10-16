import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import {
  SyntxChatHttpClient,
  type ChatMessageHistoryCandidate,
  type ChatMessageHistorySnapshot,
  type InProgressMessage,
  type MediaGenerationReceipt
} from "../adapter/syntx/chat-http-client.js";
import {
  createOwnerWan30FirstLastGenerationContext,
  releaseOwnerWan30FirstLastFrameInput,
  releaseOwnerWan30FirstLastGenerationContext,
  releaseOwnerWan30FirstLastUploadedFrame,
  validateOwnerWan30FirstLastFrameInput,
  OwnerWan30FirstLastNativeContextError,
  type OwnerWan30FirstLastFrameRole,
  type OwnerWan30FirstLastGenerationContext,
  type OwnerWan30FirstLastUploadedFrame,
  type OwnerWan30FirstLastValidatedFrame
} from "../adapter/syntx/owner-wan30-first-last-native-context.js";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../catalog/public-catalog-history.js";
import { AccountStatusService, type AccountStatusResult } from "./account-status.js";
import { ModelAccessService, type ModelAccessResult } from "./model-access.js";
import {
  getOwnerWan30FirstLastGenerationSourceContract,
  normalizeOwnerWan30FirstLastGenerationIntent,
  OwnerWan30FirstLastGenerationParametersError,
  type OwnerWan30FirstLastGenerationIntent,
  type OwnerWan30FirstLastGenerationParameters
} from "./owner-wan30-first-last-generation-parameters.js";
import type { OwnerWanT2vGenerationDiagnostic, OwnerWanT2vVideoArtifact } from "./owner-wan-t2v-generation-service.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";

const MODEL_ID = "wan_30_first_last_frame" as const;
const PUBLIC_CATALOG_VERSION = "sha256-19c882601bb8ecdba994adf819544ebf06fd2db30374335631bb6078a66e5a76.json" as const;
const PUBLIC_MODELS_SHA256 = "sha256:20b8c6482d72dbb4bf7e6500a0fbc0514eeac29bf5b7170559cd7665045583e3" as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const FRAME_HANDLE = /^wan30_frame_[0-9a-f-]{36}$/u;
const RECOVERY_ID = /^wan_t2v_recovery_[0-9a-f-]{36}$/u;
const MAX_IMAGE_BYTES = 7 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const MAX_RECOVERIES = 128;
const MAX_FRAMES = 256;
const FRAME_TTL_MS = 15 * 60_000;
const MAX_RUN_MS = 5 * 60_000;
const RESULT_PAGE_SIZE = 64;
const HISTORY_TOTAL_LIMIT = 64;
const HISTORY_PAGE_SIZE = 10;
const MAX_CLOCK_SKEW_MS = 30_000;
const PREFLIGHT_FRESH_MS = 120_000;
const POLL_DELAY_MS = 500;
const MAX_POLLS = 2;
const COST_PARAMETERS = Object.freeze({ resolution: "480P", video_duration: 2, duration: 0, rendering_speed: "basic" } as const);
const ACCOUNT_METHOD = AccountStatusService.prototype.getAccountStatus;
const ACCESS_METHOD = ModelAccessService.prototype.getModelAccess;
const CREATE_CHAT = SyntxChatHttpClient.prototype.createChat;
const UPLOAD_FRAME = SyntxChatHttpClient.prototype.uploadOwnerWan30FirstLastFrame;
const START_VIDEO = SyntxChatHttpClient.prototype.startOwnerWan30FirstLastVideoWithContext;
const HISTORY_GET = SyntxChatHttpClient.prototype.listWanT2vMessageCandidates;
const RESULT_GET = SyntxChatHttpClient.prototype.getWanT2vVideoResultMessage;
const IN_PROGRESS_GET = SyntxChatHttpClient.prototype.listInProgress;
const SERVICES = new WeakSet<object>();

export type OwnerWan30FirstLastGenerationDiagnostic = OwnerWanT2vGenerationDiagnostic;
export type OwnerWan30FirstLastVideoArtifact = OwnerWanT2vVideoArtifact;
export type OwnerWan30FirstLastRecoveryStatus = "outcome_unknown" | "partial_results";

export interface OwnerWan30FirstLastGenerationServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string;
  readonly catalogDirectory?: string;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly createAccountStatusService: (attemptId: string) => AccountStatusService;
  readonly createModelAccessService: (attemptId: string, catalog: DiscoveryCatalogRepository) => ModelAccessService;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

export interface OwnerWan30FirstLastFrameUploadInput {
  readonly attemptId: string;
  readonly role: OwnerWan30FirstLastFrameRole;
  readonly content_base64: string;
  readonly filename: string;
  readonly mime_type: string;
}

export interface OwnerWan30FirstLastFrameUploadReceipt {
  readonly status: "uploaded";
  readonly frame_handle: string;
  readonly role: OwnerWan30FirstLastFrameRole;
  readonly model_id: typeof MODEL_ID;
  readonly mime_type: "image/png" | "image/jpeg";
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly expires_in_seconds: number;
  readonly metadata_confidence: "LOCAL_STRUCTURAL_METADATA_ONLY";
  readonly upload_binding_confidence: "IMPLEMENTATION_INFERENCE_NOT_UI_MULTIPART_OBSERVED";
}

export interface OwnerWan30FirstLastGenerateInput {
  readonly attemptId: string;
  readonly input: OwnerWan30FirstLastGenerationIntent;
  readonly first_frame_handle: string;
  readonly last_frame_handle: string;
}

export interface OwnerWan30FirstLastReconcileInput { readonly attemptId: string; readonly recovery_id: string }
export interface OwnerWan30FirstLastRecoveryListInput { readonly attemptId: string; readonly limit?: number }
export interface OwnerWan30FirstLastResultPageInput { readonly attemptId: string; readonly recovery_id: string; readonly offset?: number }

export interface OwnerWan30FirstLastGenerationResult {
  readonly status: "completed" | "partial_results";
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly backend_acceptance: "UNPROVEN";
  readonly provider_terminal_status: "UNPROVEN";
  readonly model_id: typeof MODEL_ID;
  readonly parameters: OwnerWan30FirstLastGenerationParameters;
  readonly cost_inputs: typeof COST_PARAMETERS;
  readonly cost_input_confidence: "CATALOG_KEYS_NOT_UI_CALLER_JOINED";
  readonly recovery_id: string;
  readonly observed_artifact_count: number;
  readonly offset: number;
  readonly page_size: 64;
  readonly artifacts: readonly OwnerWan30FirstLastVideoArtifact[];
  readonly has_more: boolean;
  readonly next_offset: number | null;
  readonly diagnostic: OwnerWan30FirstLastGenerationDiagnostic;
}

export interface OwnerWan30FirstLastRecoveryListItem {
  readonly recovery_id: string;
  readonly created_at: string;
  readonly model_id: typeof MODEL_ID;
  readonly status: OwnerWan30FirstLastRecoveryStatus;
  readonly observed_artifact_count: number;
  readonly diagnostic: OwnerWan30FirstLastGenerationDiagnostic;
}

export interface OwnerWan30FirstLastRecoveryListResult { readonly recoveries: readonly OwnerWan30FirstLastRecoveryListItem[] }

export type OwnerWan30FirstLastGenerationServiceErrorCode =
  | "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH"
  | "PREFLIGHT_FAILED" | "UPLOAD_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN" | "REFERENCE_UNAVAILABLE"
  | "REFERENCE_EXPIRED" | "REFERENCE_ROLE_MISMATCH" | "INTENT_ALREADY_CLAIMED" | "PRE_DISPATCH_FAILED"
  | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND";

export const OWNER_WAN30_FIRST_LAST_GENERATION_ERROR_CODES = Object.freeze([
  "INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH",
  "PREFLIGHT_FAILED", "UPLOAD_REJECTED", "UPLOAD_OUTCOME_UNKNOWN", "REFERENCE_UNAVAILABLE",
  "REFERENCE_EXPIRED", "REFERENCE_ROLE_MISMATCH", "INTENT_ALREADY_CLAIMED", "PRE_DISPATCH_FAILED",
  "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"
] as const satisfies readonly OwnerWan30FirstLastGenerationServiceErrorCode[]);

export class OwnerWan30FirstLastGenerationServiceError extends Error {
  readonly diagnostic: OwnerWan30FirstLastGenerationDiagnostic | undefined;
  constructor(readonly code: OwnerWan30FirstLastGenerationServiceErrorCode, readonly recovery_id?: string,
    diagnostic?: OwnerWan30FirstLastGenerationDiagnostic) {
    super(code === "OUTCOME_UNKNOWN"
      ? "The WAN 3.0 First/Last request may have been dispatched; reconcile the same recovery and do not retry."
      : "The owner WAN 3.0 First/Last operation could not be completed safely.");
    this.name = "OwnerWan30FirstLastGenerationServiceError";
    this.diagnostic = code === "OUTCOME_UNKNOWN" && diagnostic ? diagnostic : undefined;
  }
}

interface FrameRecord {
  readonly frame_handle: string;
  readonly semantic_key: string;
  readonly profile_id: string;
  readonly source_pins: object;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly client: SyntxChatHttpClient;
  readonly context: OwnerWan30FirstLastUploadedFrame;
  readonly role: OwnerWan30FirstLastFrameRole;
  readonly expires_at: number;
}

interface Recovery {
  readonly recovery_id: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly intent: OwnerWan30FirstLastGenerationIntent;
  readonly profile_id: string;
  readonly source_pins: object;
  readonly semantic_key: string;
  readonly chat_uuid: string;
  readonly created_at: string;
  readonly first_frame_sha256: string;
  readonly last_frame_sha256: string;
  owner_echo_message_id: string | null;
  status: "outcome_unknown" | "partial_results" | "completed";
  artifacts: readonly OwnerWan30FirstLastVideoArtifact[];
  readonly diagnostic: MutableDiagnostic;
}

interface MutableDiagnostic {
  phase: OwnerWanT2vGenerationDiagnostic["phase"];
  post_started: boolean;
  ack_known: boolean;
  history_status: OwnerWanT2vGenerationDiagnostic["history_status"];
  history_reason: OwnerWanT2vGenerationDiagnostic["history_reason"];
  history_get_calls: number;
  result_get_calls: number;
  inprogress_get_calls: number;
  result_status: OwnerWanT2vGenerationDiagnostic["result_status"];
  result_reason: OwnerWanT2vGenerationDiagnostic["result_reason"];
}

interface ActiveOperation {
  readonly attemptId: string;
  readonly controller: AbortController;
  readonly promise: Promise<void>;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly finish: () => void;
  readonly removeExternal: () => void;
}

/** Owner-only First/Last workflow. Upload and generation are separate; result status is local availability only. */
export class OwnerWan30FirstLastGenerationService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #catalogVersion: string;
  readonly #catalogDirectory: string | undefined;
  #firstLastCatalog: DiscoveryCatalogRepository | undefined;
  readonly #resolveClient: OwnerWan30FirstLastGenerationServiceOptions["resolveClient"];
  readonly #createAccountStatusService: OwnerWan30FirstLastGenerationServiceOptions["createAccountStatusService"];
  readonly #createModelAccessService: OwnerWan30FirstLastGenerationServiceOptions["createModelAccessService"];
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #frames = new Map<string, FrameRecord>();
  readonly #consumedFrames = new Set<string>();
  readonly #frameBySemantic = new Map<string, string>();
  readonly #unknownUploadSemantics = new Set<string>();
  readonly #uploadSemanticAttempts = new Map<string, string>();
  readonly #pendingUploadSemantics = new Set<string>();
  readonly #semanticClaims = new Map<string, Readonly<{ attemptId: string; recovery_id: string | null }>>();
  readonly #recoveries = new Map<string, Recovery>();
  readonly #runs = new Set<ActiveOperation>();
  readonly #controllersByAttempt = new Map<string, Set<AbortController>>();
  readonly #invalidating = new Set<string>();
  readonly #epochs = new Map<string, number>();
  readonly #usedAccountServices = new WeakSet<object>();
  readonly #usedAccessServices = new WeakSet<object>();
  #closed = false;
  #closing: Promise<void> | undefined;
  #lastNow = -1;

  constructor(optionsInput: OwnerWan30FirstLastGenerationServiceOptions | unknown) {
    if (new.target !== OwnerWan30FirstLastGenerationService) invalid();
    const fields = readExactRecord(optionsInput, ["binding", "linkService", "catalog", "catalog_version", "resolveClient",
      "createAccountStatusService", "createModelAccessService"], ["catalogDirectory", "now", "timeoutMs"]);
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = snapshotLinkService(fields.linkService);
    if (!isExactInstance(fields.catalog, DiscoveryCatalogRepository) || fields.catalog_version !== PUBLIC_CATALOG_VERSION ||
        typeof fields.resolveClient !== "function" || types.isProxy(fields.resolveClient) ||
        typeof fields.createAccountStatusService !== "function" || types.isProxy(fields.createAccountStatusService) ||
        typeof fields.createModelAccessService !== "function" || types.isProxy(fields.createModelAccessService) ||
        (fields.catalogDirectory !== undefined && (typeof fields.catalogDirectory !== "string" || fields.catalogDirectory.trim() === ""))) invalid();
    this.#catalog = fields.catalog as DiscoveryCatalogRepository;
    this.#catalogVersion = fields.catalog_version as string;
    this.#catalogDirectory = fields.catalogDirectory as string | undefined;
    this.#resolveClient = fields.resolveClient as OwnerWan30FirstLastGenerationServiceOptions["resolveClient"];
    this.#createAccountStatusService = fields.createAccountStatusService as OwnerWan30FirstLastGenerationServiceOptions["createAccountStatusService"];
    this.#createModelAccessService = fields.createModelAccessService as OwnerWan30FirstLastGenerationServiceOptions["createModelAccessService"];
    this.#now = readClockFactory(fields.now);
    this.#timeoutMs = bounded(fields.timeoutMs, 1_000, MAX_RUN_MS, 120_000);
    this.#assertSourceCatalog(this.#catalog);
    Object.freeze(this);
    SERVICES.add(this);
  }

  async upload(input: OwnerWan30FirstLastFrameUploadInput | unknown, signal?: AbortSignal): Promise<OwnerWan30FirstLastFrameUploadReceipt> {
    const request = snapshotUploadInput(input, signal);
    try { return await this.#run(request.attemptId, signal, (deadline) => this.#upload(request, deadline)); }
    finally { request.bytes.fill(0); }
  }

  async #upload(request: Readonly<UploadSnapshot>, deadline: AbsoluteRequestDeadline): Promise<OwnerWan30FirstLastFrameUploadReceipt> {
    let validated: OwnerWan30FirstLastValidatedFrame | undefined;
    let provisionalFrame: OwnerWan30FirstLastUploadedFrame | undefined;
    let provisionalClient: SyntxChatHttpClient | undefined;
    let stored = false;
    let nativeInvoked = false;
    let semanticKey: string | undefined;
    let unknownOutcome = false;
    try {
      this.#assertOpen(); this.#pruneFrames(this.#readNow());
      const source = this.#assertSource();
      validated = validateOwnerWan30FirstLastFrameInput({ filename: request.filename, mime_type: request.mime_type, bytes: request.bytes });
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      const client = this.#resolveNativeClient(request.attemptId);
      semanticKey = semanticFrameKey(principal, request.attemptId, request.role, validated.sha256, validated.size, validated.mime_type, source);
      if (this.#unknownUploadSemantics.has(semanticKey)) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (this.#pendingUploadSemantics.has(semanticKey)) fail("SERVICE_BUSY");
      const priorHandle = this.#frameBySemantic.get(semanticKey);
      const prior = priorHandle ? this.#frames.get(priorHandle) : undefined;
      if (prior) {
        if (this.#frameIsCurrent(prior, request.attemptId, request.role, principal, client)) return this.#uploadReceipt(prior, validated);
        if (prior.client !== client || prior.attemptId !== request.attemptId || !sameGenerationPrincipal(prior.principal, principal)) {
          fail("MODEL_BINDING_MISMATCH");
        }
        fail("REFERENCE_UNAVAILABLE");
      }
      if (this.#frames.size + this.#unknownUploadSemantics.size + this.#pendingUploadSemantics.size >= MAX_FRAMES) fail("SERVICE_BUSY");
      this.#pendingUploadSemantics.add(semanticKey);
      const epoch = this.#attemptEpoch(request.attemptId);
      deadline.throwIfAborted();
      nativeInvoked = true;
      const pendingFrame = Promise.resolve(Reflect.apply(UPLOAD_FRAME, client,
        [validated!, request.role, deadline.signal]) as Promise<OwnerWan30FirstLastUploadedFrame>);
      let frame: OwnerWan30FirstLastUploadedFrame;
      try { frame = await this.#await(deadline, () => pendingFrame); }
      catch (error) {
        void pendingFrame.then((lateFrame) => releaseOwnerWan30FirstLastUploadedFrame(client, lateFrame), () => {});
        throw error;
      }
      provisionalFrame = frame;
      provisionalClient = client;
      deadline.throwIfAborted();
      if (!validUploadedFrame(frame, request.role, validated) || epoch !== this.#attemptEpoch(request.attemptId) || this.#invalidating.has(request.attemptId)) {
        unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      const currentPrincipal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      const currentClient = this.#resolveNativeClient(request.attemptId);
      if (!sameGenerationPrincipal(principal, currentPrincipal) || currentClient !== client) {
        unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      const now = this.#readNow();
      const handle = `wan30_frame_${randomUUID()}`;
      if (!FRAME_HANDLE.test(handle) || this.#frames.has(handle)) { unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
      const record: FrameRecord = Object.freeze({ frame_handle: handle, semantic_key: semanticKey, profile_id: source.profile_id,
        source_pins: source.source_pins, attemptId: request.attemptId, principal, client, context: frame,
        role: request.role, expires_at: now + FRAME_TTL_MS });
      const receipt = this.#uploadReceipt(record, validated);
      this.#frames.set(handle, record); this.#frameBySemantic.set(semanticKey, handle);
      this.#uploadSemanticAttempts.set(semanticKey, request.attemptId);
      stored = true;
      return receipt;
    } catch (error) {
      if (error instanceof OwnerWan30FirstLastGenerationServiceError) {
        if (nativeInvoked && error.code !== "UPLOAD_REJECTED" && error.code !== "UPLOAD_OUTCOME_UNKNOWN") {
          unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN");
        }
        if (error.code === "UPLOAD_OUTCOME_UNKNOWN") unknownOutcome ||= nativeInvoked;
        throw error;
      }
      if (error instanceof OwnerWan30FirstLastNativeContextError) {
        if (error.code === "UPLOAD_OUTCOME_UNKNOWN") { unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
        if (error.code === "INVALID_CLIENT") fail("MODEL_BINDING_MISMATCH");
        fail("INVALID_REQUEST");
      }
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      if (nativeInvoked) { unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
      if (error instanceof OwnerWan30FirstLastGenerationParametersError) fail("INVALID_REQUEST");
      return fail("INVALID_REQUEST");
    } finally {
      if (provisionalFrame && provisionalClient && !stored) releaseOwnerWan30FirstLastUploadedFrame(provisionalClient, provisionalFrame);
      releaseOwnerWan30FirstLastFrameInput(validated);
      if (unknownOutcome && semanticKey) {
        this.#unknownUploadSemantics.add(semanticKey);
        this.#uploadSemanticAttempts.set(semanticKey, request.attemptId);
      }
      if (semanticKey) this.#pendingUploadSemantics.delete(semanticKey);
      request.bytes.fill(0);
    }
  }

  async generate(input: OwnerWan30FirstLastGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerWan30FirstLastGenerationResult> {
    const request = snapshotGenerateInput(input, signal);
    return await this.#run(request.attemptId, signal, (deadline) => this.#generate(request, deadline));
  }

  async reconcile(input: OwnerWan30FirstLastReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerWan30FirstLastGenerationResult> {
    const request = snapshotReconcileInput(input, signal);
    return await this.#run(request.attemptId, signal, (deadline) => this.#reconcile(request, deadline));
  }

  async listRecoveries(input: OwnerWan30FirstLastRecoveryListInput | unknown): Promise<OwnerWan30FirstLastRecoveryListResult> {
    const request = snapshotRecoveryListInput(input);
    return await this.#run(request.attemptId, undefined, async (deadline) => {
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      const recoveries = [...this.#recoveries.values()].filter((recovery) => recovery.attemptId === request.attemptId &&
        sameGenerationPrincipal(recovery.principal, principal) && recovery.status !== "completed")
        .sort((left, right) => left.created_at.localeCompare(right.created_at)).slice(0, request.limit);
      return Object.freeze({ recoveries: Object.freeze(recoveries.map((recovery) => Object.freeze({
        recovery_id: recovery.recovery_id, created_at: recovery.created_at, model_id: MODEL_ID,
        status: recovery.status as OwnerWan30FirstLastRecoveryStatus, observed_artifact_count: recovery.artifacts.length,
        diagnostic: snapshotDiagnostic(recovery.diagnostic)
      }))) });
    });
  }

  async getResultPage(input: OwnerWan30FirstLastResultPageInput | unknown, signal?: AbortSignal): Promise<OwnerWan30FirstLastGenerationResult> {
    if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) invalid();
    const request = snapshotResultPageInput(input);
    return await this.#run(request.attemptId, signal, async (deadline) => {
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      const recovery = this.#recoveries.get(request.recovery_id);
      if (!recovery || recovery.attemptId !== request.attemptId || !sameGenerationPrincipal(recovery.principal, principal)) fail("RECOVERY_NOT_FOUND");
      const source = this.#assertSource();
      if (recovery.profile_id !== source.profile_id || !sameSourcePins(recovery.source_pins, source.source_pins)) throw unknownError(recovery);
      if (recovery.status === "outcome_unknown") throw unknownError(recovery);
      return pageResult(recovery, request.offset);
    });
  }

  async invalidateAttempt(attemptIdInput: unknown): Promise<void> {
    const attemptId = safeAttempt(attemptIdInput);
    this.#invalidating.add(attemptId);
    this.#epochs.set(attemptId, this.#attemptEpoch(attemptId) + 1);
    const active = [...this.#runs].filter((run) => run.attemptId === attemptId);
    for (const run of active) run.controller.abort();
    await Promise.allSettled(active.map((run) => run.promise));
    this.#clearAttemptFrames(attemptId);
    for (const [recoveryId, recovery] of this.#recoveries) {
      if (recovery.attemptId === attemptId) this.#recoveries.delete(recoveryId);
    }
    for (const [key, claim] of this.#semanticClaims) {
      if (claim.attemptId === attemptId) this.#semanticClaims.delete(key);
    }
    this.#epochs.delete(attemptId);
    this.#invalidating.delete(attemptId);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const run of this.#runs) run.controller.abort();
    this.#closing = (async () => {
      await Promise.allSettled([...this.#runs].map((run) => run.promise));
      for (const record of this.#frames.values()) releaseOwnerWan30FirstLastUploadedFrame(record.client, record.context);
      this.#frames.clear(); this.#frameBySemantic.clear(); this.#unknownUploadSemantics.clear();
      this.#consumedFrames.clear();
      this.#uploadSemanticAttempts.clear(); this.#pendingUploadSemantics.clear();
      this.#recoveries.clear(); this.#semanticClaims.clear(); this.#runs.clear();
      this.#controllersByAttempt.clear(); this.#invalidating.clear(); this.#epochs.clear();
    })();
    return this.#closing;
  }

  async #generate(request: Readonly<OwnerWan30FirstLastGenerateInput>, deadline: AbsoluteRequestDeadline): Promise<OwnerWan30FirstLastGenerationResult> {
    let recovery: Recovery | undefined;
    let context: OwnerWan30FirstLastGenerationContext | undefined;
    const normalized = normalizeOwnerWan30FirstLastGenerationIntent({ prompt: request.input.prompt, parameters: request.input.parameters });
    const intent = normalized.intent;
    const source = this.#assertSource();
    const initialPrincipal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
    const client = this.#resolveNativeClient(request.attemptId);
    const frames = this.#resolveFramePair(request, initialPrincipal, client);
    const semanticKey = generationSemanticKey(initialPrincipal, intent, frames[0], frames[1], source);
    const existingClaim = this.#semanticClaims.get(semanticKey);
    if (existingClaim !== undefined) {
      if (existingClaim.attemptId !== request.attemptId) fail("INTENT_ALREADY_CLAIMED");
      const existing = existingClaim.recovery_id ? this.#recoveries.get(existingClaim.recovery_id) : undefined;
      if (existing && (existing.attemptId !== request.attemptId || !sameGenerationPrincipal(existing.principal, initialPrincipal))) {
        fail("INTENT_ALREADY_CLAIMED");
      }
      if (existing?.status === "completed" || existing?.status === "partial_results") return pageResult(existing, 0);
      if (existing) throw unknownError(existing);
      fail("INTENT_ALREADY_CLAIMED");
    }
    this.#assertFramePairLive(request, frames, initialPrincipal, client);
    if (this.#semanticClaims.size >= MAX_RECOVERIES) fail("SERVICE_BUSY");
    this.#semanticClaims.set(semanticKey, Object.freeze({ attemptId: request.attemptId, recovery_id: null }));
    try {
      deadline.throwIfAborted();
      await this.#runPreflight(request.attemptId, deadline);
      const principalBeforeChat = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      if (!sameGenerationPrincipal(initialPrincipal, principalBeforeChat) || this.#resolveNativeClient(request.attemptId) !== client) {
        fail("PRINCIPAL_NOT_LINKED");
      }
      this.#assertFramePairLive(request, frames, principalBeforeChat, client);
      const chat = await this.#await(deadline, () => Reflect.apply(CREATE_CHAT, client,
        ["video", `owner-wan30-first-last-${randomUUID()}`, deadline.signal]) as Promise<{ chat_uuid: string }>);
      if (!chat || !isSafeId(chat.chat_uuid)) fail("PRE_DISPATCH_FAILED");
      const principalAfterChat = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      const clientAfterChat = this.#resolveNativeClient(request.attemptId);
      if (!sameGenerationPrincipal(initialPrincipal, principalAfterChat) || clientAfterChat !== client) fail("PRINCIPAL_NOT_LINKED");
      this.#assertFramePairLive(request, frames, principalAfterChat, client);
      await this.#runPreflight(request.attemptId, deadline);
      const principalBeforePost = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      if (!sameGenerationPrincipal(initialPrincipal, principalBeforePost) || this.#invalidating.has(request.attemptId) ||
          this.#resolveNativeClient(request.attemptId) !== client) fail("PRINCIPAL_NOT_LINKED");
      this.#assertFramePairLive(request, frames, principalBeforePost, client);

      const generationContext = createOwnerWan30FirstLastGenerationContext(client, Object.freeze({
        attempt_id: request.attemptId, principal: initialPrincipal, chat_id: chat.chat_uuid,
        intent, first_frame: frames[0].context, last_frame: frames[1].context
      }));
      context = generationContext;
      const now = this.#readNow();
      recovery = createRecovery({ attemptId: request.attemptId, principal: initialPrincipal, intent, profileId: source.profile_id,
        sourcePins: source.source_pins, chatUuid: chat.chat_uuid, createdAt: now, semanticKey,
        firstHash: frames[0].context.sha256, lastHash: frames[1].context.sha256 });
      if (this.#recoveries.size >= MAX_RECOVERIES) fail("SERVICE_BUSY");
      this.#recoveries.set(recovery.recovery_id, recovery);
      this.#semanticClaims.set(semanticKey, Object.freeze({ attemptId: request.attemptId, recovery_id: recovery.recovery_id }));
      recovery.diagnostic.phase = "GENERATION_POST";
      recovery.diagnostic.post_started = true;
      const receipt = await this.#await(deadline, () => Reflect.apply(START_VIDEO, client, [generationContext, deadline.signal]) as Promise<MediaGenerationReceipt>);
      if (!validAck(receipt, chat.chat_uuid)) throw unknownError(recovery);
      recovery.owner_echo_message_id = receipt.message_id;
      recovery.diagnostic.ack_known = true;
      recovery.diagnostic.phase = "POST_ACK_KNOWN";
      releaseOwnerWan30FirstLastGenerationContext(client, context);
      context = undefined;
      this.#removeFramePair(frames);
      return await this.#observe(recovery, client, deadline);
    } catch (error) {
      if (context) { releaseOwnerWan30FirstLastGenerationContext(client, context); this.#removeFramePair(frames); }
      if (recovery) {
        if (recovery.owner_echo_message_id) recovery.status = "outcome_unknown";
        throw unknownError(recovery);
      }
      if (error instanceof OwnerWan30FirstLastGenerationServiceError) throw error;
      if (error instanceof OwnerWan30FirstLastNativeContextError) {
        if (error.code === "INVALID_CLIENT") fail("MODEL_BINDING_MISMATCH");
        fail("REFERENCE_UNAVAILABLE");
      }
      if (error instanceof OwnerWan30FirstLastGenerationParametersError) fail("INVALID_REQUEST");
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      if (deadline.signal.aborted) fail("PRE_DISPATCH_FAILED");
      fail("PRE_DISPATCH_FAILED");
    }
  }

  async #reconcile(request: Readonly<OwnerWan30FirstLastReconcileInput>, deadline: AbsoluteRequestDeadline): Promise<OwnerWan30FirstLastGenerationResult> {
    let recovery: Recovery | undefined;
    try {
      recovery = this.#recoveries.get(request.recovery_id);
      if (!recovery || recovery.attemptId !== request.attemptId) fail("RECOVERY_NOT_FOUND");
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      if (!sameGenerationPrincipal(principal, recovery.principal) || this.#invalidating.has(request.attemptId)) throw unknownError(recovery);
      const source = this.#assertSource();
      if (recovery.profile_id !== source.profile_id || !sameSourcePins(recovery.source_pins, source.source_pins)) throw unknownError(recovery);
      if (recovery.status === "completed") return pageResult(recovery, 0);
      return await this.#observe(recovery, this.#resolveNativeClient(request.attemptId), deadline);
    } catch (error) {
      if (error instanceof OwnerWan30FirstLastGenerationServiceError && error.code === "RECOVERY_NOT_FOUND") throw error;
      if (!recovery) {
        if (error instanceof OwnerWan30FirstLastGenerationServiceError) throw error;
        fail("PRE_DISPATCH_FAILED");
      }
      throw unknownError(recovery);
    }
  }

  async #observe(recovery: Recovery, client: SyntxChatHttpClient, deadline: AbsoluteRequestDeadline): Promise<OwnerWan30FirstLastGenerationResult> {
    if (recovery.owner_echo_message_id === null) {
      recovery.diagnostic.history_status = "UNVERIFIED";
      recovery.diagnostic.history_reason = "OWNER_ACK_RECEIPT_UNKNOWN";
      recovery.diagnostic.result_status = "UNVERIFIED";
      recovery.diagnostic.result_reason = "NATIVE_RESULT_UNVERIFIED";
      throw unknownError(recovery);
    }
    let lastStatus: "pending" | "partial_results" = "pending";
    for (let poll = 0; poll < MAX_POLLS; poll += 1) {
      deadline.throwIfAborted();
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(recovery.attemptId));
      if (!sameGenerationPrincipal(principal, recovery.principal) || this.#invalidating.has(recovery.attemptId) ||
          this.#resolveNativeClient(recovery.attemptId) !== client) throw unknownError(recovery);
      recovery.diagnostic.phase = "HISTORY_GET";
      recovery.diagnostic.history_get_calls += 1;
      let snapshot: ChatMessageHistorySnapshot;
      try {
        snapshot = await this.#await(deadline, () => Reflect.apply(HISTORY_GET, client,
          [recovery.chat_uuid, recovery.owner_echo_message_id, deadline.signal]) as Promise<ChatMessageHistorySnapshot>);
      } catch {
        deadline.throwIfAborted();
        recovery.diagnostic.history_status = "UNVERIFIED";
        recovery.diagnostic.history_reason = "HISTORY_INCOMPLETE";
        recovery.diagnostic.result_status = "UNVERIFIED";
        throw unknownError(recovery);
      }
      const history = bindFirstLastHistory(snapshot, recovery);
      if (history.status === "INVALID") {
        recovery.diagnostic.history_status = "UNVERIFIED";
        recovery.diagnostic.history_reason = history.reason;
        recovery.diagnostic.result_status = "UNVERIFIED";
        throw unknownError(recovery);
      }
      recovery.diagnostic.history_status = history.status === "PENDING" ? "PENDING" : "COMPLETE";
      recovery.diagnostic.history_reason = history.status === "PENDING" ? history.reason : null;
      if (history.status === "PENDING" || history.botMessages.length === 0) {
        recovery.diagnostic.result_status = "PENDING";
        recovery.diagnostic.result_reason = "RESULT_NOT_YET_AVAILABLE";
        if (poll + 1 < MAX_POLLS) {
          recovery.diagnostic.phase = "IN_PROGRESS_GET";
          recovery.diagnostic.inprogress_get_calls += 1;
          try { await this.#await(deadline, () => Reflect.apply(IN_PROGRESS_GET, client, [recovery.chat_uuid, deadline.signal]) as Promise<InProgressMessage[]>); }
          catch { deadline.throwIfAborted(); }
          await this.#waitNext(deadline);
          continue;
        }
        throw unknownError(recovery);
      }

      const observed: OwnerWan30FirstLastVideoArtifact[] = [];
      let incomplete = false, modelEchoUnknown = false;
      const seenObjectIds = new Set<string>();
      for (const candidate of history.botMessages) {
        recovery.diagnostic.phase = "RESULT_GET";
        recovery.diagnostic.result_get_calls += 1;
        let decoded: Awaited<ReturnType<SyntxChatHttpClient["getWanT2vVideoResultMessage"]>>;
        try {
          decoded = await this.#await(deadline, () => Reflect.apply(RESULT_GET, client, [Object.freeze({
            chat_uuid: recovery!.chat_uuid, message_id: candidate.message_id, model_id: MODEL_ID,
            provider_chat_id: candidate.provider_chat_id,
            message_object_ids: Object.freeze(candidate.objects.map((object) => object.message_object_id))
          }), deadline.signal]) as Promise<Awaited<ReturnType<SyntxChatHttpClient["getWanT2vVideoResultMessage"]>>>);
        } catch {
          deadline.throwIfAborted();
          recovery.diagnostic.result_status = "UNVERIFIED";
          recovery.diagnostic.result_reason = "NATIVE_RESULT_UNVERIFIED";
          throw unknownError(recovery);
        }
        if (decoded.message_binding !== "BOUND" || decoded.model_echo === "MISMATCH") {
          recovery.diagnostic.result_status = "UNVERIFIED";
          recovery.diagnostic.result_reason = "NATIVE_RESULT_UNVERIFIED";
          throw unknownError(recovery);
        }
        if (decoded.ready_videos.length !== candidate.objects.length) incomplete = true;
        if (decoded.model_echo === "UNKNOWN") modelEchoUnknown = true;
        for (const video of decoded.ready_videos) {
          const expected = candidate.objects[video.object_index];
          if (!expected || expected.message_object_id !== video.message_object_id || video.object_type !== "video" ||
              !isSafeUploadReferenceUrl(video.object_url) || seenObjectIds.has(video.message_object_id) ||
              (video.mime_type !== null && video.mime_type !== "video/mp4" && video.mime_type !== "video/quicktime")) {
            recovery.diagnostic.result_status = "UNVERIFIED";
            recovery.diagnostic.result_reason = "NATIVE_RESULT_UNVERIFIED";
            throw unknownError(recovery);
          }
          seenObjectIds.add(video.message_object_id);
          observed.push(Object.freeze({ url: video.object_url, mime_type: video.mime_type, mime_source: video.mime_source,
            message_id: candidate.message_id, message_object_id: video.message_object_id,
            object_index: video.object_index, model_echo: decoded.model_echo, object_type: "video" }));
        }
      }
      if (new Set(observed.map((artifact) => artifact.url)).size !== observed.length) {
        recovery.diagnostic.result_status = "UNVERIFIED";
        recovery.diagnostic.result_reason = "ARTIFACT_URL_DUPLICATE";
        throw unknownError(recovery);
      }
      recovery.artifacts = Object.freeze(observed);
      recovery.diagnostic.phase = "RESULT_BINDING";
      if (observed.length > 0 && !incomplete) {
        recovery.status = "completed";
        recovery.diagnostic.result_status = "COMPLETE";
        recovery.diagnostic.result_reason = modelEchoUnknown ? "NATIVE_MODEL_ECHO_UNKNOWN" : null;
        return pageResult(recovery, 0);
      }
      if (observed.length > 0) {
        recovery.status = "partial_results";
        recovery.diagnostic.result_status = "PARTIAL";
        recovery.diagnostic.result_reason = modelEchoUnknown ? "NATIVE_MODEL_ECHO_UNKNOWN" : "NATIVE_RESULT_INCOMPLETE";
        lastStatus = "partial_results";
      } else {
        recovery.diagnostic.result_status = "PENDING";
        recovery.diagnostic.result_reason = "RESULT_NOT_YET_AVAILABLE";
      }
      if (poll + 1 < MAX_POLLS) await this.#waitNext(deadline);
    }
    if (lastStatus === "partial_results" && recovery.artifacts.length > 0) return pageResult(recovery, 0);
    throw unknownError(recovery);
  }

  async #runPreflight(attemptId: string, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted();
    let accountService: AccountStatusService, accessService: ModelAccessService;
    const catalog = this.#getFirstLastCatalog();
    try {
      accountService = Reflect.apply(this.#createAccountStatusService, undefined, [attemptId]) as AccountStatusService;
      accessService = Reflect.apply(this.#createModelAccessService, undefined, [attemptId, catalog]) as ModelAccessService;
    } catch { fail("PREFLIGHT_FAILED"); }
    if (!isExactService(accountService, AccountStatusService, ["getAccountStatus"]) || this.#usedAccountServices.has(accountService) ||
        !isExactService(accessService, ModelAccessService, ["getModelAccess"]) || this.#usedAccessServices.has(accessService)) fail("PREFLIGHT_FAILED");
    this.#usedAccountServices.add(accountService); this.#usedAccessServices.add(accessService);
    let account: AccountStatusResult, access: ModelAccessResult;
    try {
      account = await this.#await(deadline, () => Reflect.apply(ACCOUNT_METHOD, accountService, [deadline.signal]) as Promise<AccountStatusResult>);
      access = await this.#await(deadline, () => Reflect.apply(ACCESS_METHOD, accessService, [Object.freeze({
        model_id: MODEL_ID, cost_parameters: COST_PARAMETERS
      }), deadline.signal]) as Promise<ModelAccessResult>);
    } catch { fail("PREFLIGHT_FAILED"); }
    const now = this.#readNow();
    if (!freshPreflight(account, access, catalog, now)) fail("PREFLIGHT_FAILED");
  }

  #assertSourceCatalog(catalog: DiscoveryCatalogRepository): void {
    const source = getOwnerWan30FirstLastGenerationSourceContract();
    if (source.profile_id !== "owner-wan30-first-last-web-request-observed-1823" || source.model_id !== MODEL_ID ||
        source.ai_name !== "wan_video" || source.source_pins.public_catalog_version !== PUBLIC_CATALOG_VERSION ||
        source.effective_defaults !== "UNKNOWN" || source.dispatch_allowed !== false || source.backend_acceptance !== "UNPROVEN" ||
        this.#catalogVersion !== PUBLIC_CATALOG_VERSION || catalog.source_hashes.models !== PUBLIC_MODELS_SHA256) fail("MODEL_BINDING_MISMATCH");
    let model: ReturnType<DiscoveryCatalogRepository["getModel"]>;
    try { model = catalog.getModel(MODEL_ID); } catch { fail("MODEL_BINDING_MISMATCH"); }
    const costKeys = model.settings?.get_cost_params;
    if (model.id !== MODEL_ID || model.upstream_id !== MODEL_ID || model.ai_name !== "wan_video" || model.active !== true ||
        model.scope !== "video" || !model.modalities.includes("video") ||
        !model.operations.some((op) => op.id === "generate-video" && op.output_modality === "video") ||
        !sameStrings(costKeys, Object.keys(COST_PARAMETERS))) fail("MODEL_BINDING_MISMATCH");
  }

  #getFirstLastCatalog(): DiscoveryCatalogRepository {
    if (this.#firstLastCatalog) return this.#firstLastCatalog;
    let catalog: DiscoveryCatalogRepository;
    try { catalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(PUBLIC_CATALOG_VERSION, this.#catalogDirectory)); }
    catch { fail("MODEL_BINDING_MISMATCH"); }
    this.#assertSourceCatalog(catalog);
    this.#firstLastCatalog = catalog;
    return catalog;
  }

  #resolveNativeClient(attemptId: string): SyntxChatHttpClient {
    let client: unknown;
    try { client = Reflect.apply(this.#resolveClient, undefined, [attemptId]); } catch { fail("MODEL_BINDING_MISMATCH"); }
    const methods: readonly [string, Function][] = [["createChat", CREATE_CHAT], ["uploadOwnerWan30FirstLastFrame", UPLOAD_FRAME],
      ["startOwnerWan30FirstLastVideoWithContext", START_VIDEO], ["listWanT2vMessageCandidates", HISTORY_GET],
      ["getWanT2vVideoResultMessage", RESULT_GET], ["listInProgress", IN_PROGRESS_GET]];
    if (!isExactInstance<SyntxChatHttpClient>(client, SyntxChatHttpClient) || methods.some(([key, method]) =>
      Object.hasOwn(client, key) || Object.getOwnPropertyDescriptor(SyntxChatHttpClient.prototype, key)?.value !== method || Reflect.get(client, key) !== method)) {
      fail("MODEL_BINDING_MISMATCH");
    }
    return client;
  }

  async #resolvePrincipal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    this.#assertOpen();
    if (this.#invalidating.has(attemptId)) fail("PRINCIPAL_NOT_LINKED");
    try { return await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService }); }
    catch { fail("PRINCIPAL_NOT_LINKED"); }
  }

  #resolveFramePair(request: Readonly<OwnerWan30FirstLastGenerateInput>, principal: Readonly<GenerationPrincipalRef>,
    client: SyntxChatHttpClient): readonly [FrameRecord, FrameRecord] {
    const first = this.#getFrame(request.first_frame_handle), last = this.#getFrame(request.last_frame_handle);
    if (first === last || first.role !== "first_frame" || last.role !== "last_frame") fail("REFERENCE_ROLE_MISMATCH");
    if (first.attemptId !== request.attemptId || last.attemptId !== request.attemptId || first.client !== client || last.client !== client ||
        !sameGenerationPrincipal(first.principal, principal) || !sameGenerationPrincipal(last.principal, principal)) fail("REFERENCE_UNAVAILABLE");
    return Object.freeze([first, last]);
  }

  #assertFramePairLive(request: Readonly<OwnerWan30FirstLastGenerateInput>, frames: readonly [FrameRecord, FrameRecord],
    principal: Readonly<GenerationPrincipalRef>, client: SyntxChatHttpClient): void {
    if (!this.#frameIsCurrent(frames[0], request.attemptId, "first_frame", principal, client) ||
        !this.#frameIsCurrent(frames[1], request.attemptId, "last_frame", principal, client)) fail("REFERENCE_UNAVAILABLE");
  }

  #assertSource() {
    const source = getOwnerWan30FirstLastGenerationSourceContract();
    if (source.model_id !== MODEL_ID || source.ai_name !== "wan_video" || source.effective_defaults !== "UNKNOWN" ||
        source.dispatch_allowed !== false || source.backend_acceptance !== "UNPROVEN" ||
        source.controls.local_operator_allowlist_only !== true) fail("MODEL_BINDING_MISMATCH");
    this.#assertSourceCatalog(this.#getFirstLastCatalog());
    return source;
  }

  #frameIsCurrent(record: FrameRecord, attemptId: string, role: OwnerWan30FirstLastFrameRole,
    principal: Readonly<GenerationPrincipalRef>, client: SyntxChatHttpClient): boolean {
    return this.#frames.get(record.frame_handle) === record && record.expires_at > this.#readNow() &&
      !this.#consumedFrames.has(record.frame_handle) &&
      record.attemptId === attemptId && record.role === role &&
      record.client === client && sameGenerationPrincipal(record.principal, principal) &&
      record.profile_id === "owner-wan30-first-last-web-request-observed-1823" &&
      sameSourcePins(record.source_pins, getOwnerWan30FirstLastGenerationSourceContract().source_pins) &&
      record.context.model_id === MODEL_ID && record.context.role === role;
  }

  #getFrame(handle: string): FrameRecord {
    if (!FRAME_HANDLE.test(handle)) fail("INVALID_REQUEST");
    const record = this.#frames.get(handle);
    if (!record) fail("REFERENCE_UNAVAILABLE");
    if (record.expires_at <= this.#readNow()) {
      this.#releaseFrame(record); fail("REFERENCE_EXPIRED");
    }
    return record;
  }

  #uploadReceipt(record: FrameRecord, validated: OwnerWan30FirstLastValidatedFrame): OwnerWan30FirstLastFrameUploadReceipt {
    return Object.freeze({ status: "uploaded", frame_handle: record.frame_handle, role: record.role, model_id: MODEL_ID,
      mime_type: validated.mime_type, size: validated.size, sha256: validated.sha256, width: validated.width, height: validated.height,
      expires_in_seconds: Math.max(0, Math.ceil((record.expires_at - this.#readNow()) / 1000)),
      metadata_confidence: "LOCAL_STRUCTURAL_METADATA_ONLY",
      upload_binding_confidence: "IMPLEMENTATION_INFERENCE_NOT_UI_MULTIPART_OBSERVED" });
  }

  #removeFramePair(frames: readonly [FrameRecord, FrameRecord]): void {
    this.#releaseFrame(frames[0], true); this.#releaseFrame(frames[1], true);
  }
  #releaseFrame(record: FrameRecord, preserveMetadata = false): void {
    releaseOwnerWan30FirstLastUploadedFrame(record.client, record.context);
    if (!preserveMetadata) {
      this.#frames.delete(record.frame_handle);
      this.#consumedFrames.delete(record.frame_handle);
      if (this.#frameBySemantic.get(record.semantic_key) === record.frame_handle) this.#frameBySemantic.delete(record.semantic_key);
      if (!this.#unknownUploadSemantics.has(record.semantic_key)) this.#uploadSemanticAttempts.delete(record.semantic_key);
    } else this.#consumedFrames.add(record.frame_handle);
  }
  #clearAttemptFrames(attemptId: string): void {
    for (const record of this.#frames.values()) if (record.attemptId === attemptId) this.#releaseFrame(record);
    for (const key of this.#unknownUploadSemantics) if (this.#uploadSemanticAttempts.get(key) === attemptId) this.#unknownUploadSemantics.delete(key);
    for (const [key, owner] of this.#uploadSemanticAttempts) if (owner === attemptId) this.#uploadSemanticAttempts.delete(key);
  }

  #pruneFrames(now: number): void { for (const record of this.#frames.values()) if (record.expires_at <= now) this.#releaseFrame(record); }
  #attemptEpoch(attemptId: string): number { return this.#epochs.get(attemptId) ?? 0; }

  #begin(attemptId: string, external?: AbortSignal): ActiveOperation {
    this.#assertOpen();
    if (this.#invalidating.has(attemptId) || this.#runs.size >= 8) fail("SERVICE_BUSY");
    if (external !== undefined && (!(external instanceof AbortSignal) || types.isProxy(external))) fail("INVALID_REQUEST");
    const controller = new AbortController();
    const abortExternal = () => controller.abort();
    if (external?.aborted) controller.abort(); else external?.addEventListener("abort", abortExternal, { once: true });
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    const bucket = this.#controllersByAttempt.get(attemptId) ?? new Set<AbortController>();
    bucket.add(controller); this.#controllersByAttempt.set(attemptId, bucket);
    let finish!: () => void;
    const promise = new Promise<void>((resolve) => { finish = resolve; });
    const run: ActiveOperation = { attemptId, controller, promise, timer, finish,
      removeExternal: () => external?.removeEventListener("abort", abortExternal) };
    this.#runs.add(run); return run;
  }

  #finish(attemptId: string, run: ActiveOperation): void {
    clearTimeout(run.timer);
    run.removeExternal();
    const bucket = this.#controllersByAttempt.get(attemptId); bucket?.delete(run.controller);
    if (bucket?.size === 0) this.#controllersByAttempt.delete(attemptId);
    this.#runs.delete(run);
    run.finish();
  }

  async #run<T>(attemptId: string, external: AbortSignal | undefined, operation: (deadline: AbsoluteRequestDeadline) => Promise<T>): Promise<T> {
    const run = this.#begin(attemptId, external);
    const deadline = new AbsoluteRequestDeadline(this.#timeoutMs, run.controller.signal, () => serviceError("PRE_DISPATCH_FAILED"));
    return await Promise.resolve().then(() => operation(deadline)).finally(() => { deadline.close(); this.#finish(attemptId, run); });
  }

  async #await<T>(deadline: AbsoluteRequestDeadline, operation: () => Promise<T> | T): Promise<T> {
    deadline.throwIfAborted();
    return deadline.waitFor(Promise.resolve().then(operation));
  }

  async #waitNext(deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted();
    await deadline.waitFor(new Promise<void>((resolve) => setTimeout(resolve, POLL_DELAY_MS)));
  }

  #readNow(): number {
    let value: unknown;
    try { value = Reflect.apply(this.#now, undefined, []); } catch { fail("PRE_DISPATCH_FAILED"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) < this.#lastNow) fail("PRE_DISPATCH_FAILED");
    this.#lastNow = value as number; return this.#lastNow;
  }

  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
}

export function isOwnerWan30FirstLastGenerationService(value: unknown): value is OwnerWan30FirstLastGenerationService {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  return SERVICES.has(value) && Object.getPrototypeOf(value) === OwnerWan30FirstLastGenerationService.prototype &&
    Reflect.ownKeys(value).length === 0 && Object.isFrozen(value);
}

interface UploadSnapshot {
  readonly attemptId: string;
  readonly role: OwnerWan30FirstLastFrameRole;
  readonly content_base64: string;
  readonly filename: string;
  readonly mime_type: string;
  readonly bytes: Buffer;
}

function snapshotUploadInput(input: unknown, signal?: AbortSignal): Readonly<UploadSnapshot> {
  if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) invalid();
  const fields = readExactRecord(input, ["attemptId", "role", "content_base64", "filename", "mime_type"]);
  const attemptId = safeAttempt(fields.attemptId);
  if (fields.role !== "first_frame" && fields.role !== "last_frame") invalid();
  if (typeof fields.content_base64 !== "string" || fields.content_base64.length === 0 ||
      fields.content_base64.length > MAX_BASE64_CHARS || fields.content_base64.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(fields.content_base64) ||
      typeof fields.filename !== "string" || typeof fields.mime_type !== "string") invalid();
  const bytes = Buffer.from(fields.content_base64, "base64");
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_IMAGE_BYTES || bytes.toString("base64") !== fields.content_base64) {
    bytes.fill(0); invalid();
  }
  return Object.freeze({ attemptId, role: fields.role, content_base64: fields.content_base64,
    filename: fields.filename, mime_type: fields.mime_type, bytes });
}

function snapshotGenerateInput(input: unknown, signal?: AbortSignal): Readonly<OwnerWan30FirstLastGenerateInput> {
  if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) invalid();
  const fields = readExactRecord(input, ["attemptId", "input", "first_frame_handle", "last_frame_handle"]);
  const attemptId = safeAttempt(fields.attemptId);
  const intentFields = readExactRecord(fields.input, ["model_id", "prompt", "parameters"]);
  if (intentFields.model_id !== MODEL_ID) invalid();
  const normalized = normalizeOwnerWan30FirstLastGenerationIntent({ prompt: intentFields.prompt, parameters: intentFields.parameters });
  if (typeof fields.first_frame_handle !== "string" || !FRAME_HANDLE.test(fields.first_frame_handle) ||
      typeof fields.last_frame_handle !== "string" || !FRAME_HANDLE.test(fields.last_frame_handle) ||
      fields.first_frame_handle === fields.last_frame_handle) invalid();
  return Object.freeze({ attemptId, input: normalized.intent, first_frame_handle: fields.first_frame_handle,
    last_frame_handle: fields.last_frame_handle });
}

function snapshotReconcileInput(input: unknown, signal?: AbortSignal): Readonly<OwnerWan30FirstLastReconcileInput> {
  if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) invalid();
  const fields = readExactRecord(input, ["attemptId", "recovery_id"]);
  return Object.freeze({ attemptId: safeAttempt(fields.attemptId), recovery_id: safeRecovery(fields.recovery_id) });
}

function snapshotRecoveryListInput(input: unknown): Readonly<{ attemptId: string; limit: number }> {
  const fields = readExactRecord(input, ["attemptId"], ["limit"]);
  return Object.freeze({ attemptId: safeAttempt(fields.attemptId), limit: bounded(fields.limit, 1, 128, 32) });
}

function snapshotResultPageInput(input: unknown): Readonly<{ attemptId: string; recovery_id: string; offset: number }> {
  const fields = readExactRecord(input, ["attemptId", "recovery_id"], ["offset"]);
  return Object.freeze({ attemptId: safeAttempt(fields.attemptId), recovery_id: safeRecovery(fields.recovery_id),
    offset: bounded(fields.offset, 0, 4_096, 0) });
}

function createRecovery(input: {
  readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>; readonly intent: OwnerWan30FirstLastGenerationIntent;
  readonly profileId: string; readonly sourcePins: object;
  readonly chatUuid: string; readonly createdAt: number; readonly semanticKey: string;
  readonly firstHash: string; readonly lastHash: string;
}): Recovery {
  return {
    recovery_id: `wan_t2v_recovery_${randomUUID()}`,
    attemptId: input.attemptId,
    principal: input.principal,
    intent: input.intent,
    profile_id: input.profileId,
    source_pins: input.sourcePins,
    semantic_key: input.semanticKey,
    chat_uuid: input.chatUuid,
    created_at: new Date(input.createdAt).toISOString(),
    first_frame_sha256: input.firstHash,
    last_frame_sha256: input.lastHash,
    owner_echo_message_id: null,
    status: "outcome_unknown",
    artifacts: Object.freeze([]),
    diagnostic: { phase: "GENERATION_POST", post_started: false, ack_known: false,
      history_status: "NOT_READ", history_reason: null, history_get_calls: 0, result_get_calls: 0,
      inprogress_get_calls: 0, result_status: "NOT_READ", result_reason: null }
  };
}

function bindFirstLastHistory(snapshotInput: unknown, recovery: Recovery):
  | { readonly status: "BOUND"; readonly botMessages: readonly ChatMessageHistoryCandidate[] }
  | { readonly status: "PENDING"; readonly reason: "BOT_RESULT_MISSING" }
  | { readonly status: "INVALID"; readonly reason: OwnerWanT2vGenerationDiagnostic["history_reason"] & string } {
  try {
    const snapshot = readExactRecord(snapshotInput, ["complete", "page", "page_size", "total_count", "total_pages", "has_next",
      "has_previous", "requested_chat_uuid", "provider_chat_id", "messages"]);
    if (snapshot.complete !== true || snapshot.page !== 1 || snapshot.page_size !== HISTORY_PAGE_SIZE || snapshot.has_next !== false ||
        snapshot.has_previous !== false || snapshot.requested_chat_uuid !== recovery.chat_uuid ||
        typeof snapshot.provider_chat_id !== "string" || !/^\d{1,16}$/u.test(snapshot.provider_chat_id) || !Array.isArray(snapshot.messages)) {
      return { status: "INVALID", reason: snapshot.complete !== true || snapshot.has_next === true ? "HISTORY_INCOMPLETE" : "HISTORY_SHAPE_INVALID" };
    }
    if (!Number.isSafeInteger(snapshot.total_count) || (snapshot.total_count as number) < 1 ||
        (snapshot.total_count as number) > HISTORY_TOTAL_LIMIT || !Number.isSafeInteger(snapshot.total_pages) ||
        snapshot.total_pages !== Math.ceil((snapshot.total_count as number) / HISTORY_PAGE_SIZE) ||
        (snapshot.messages as unknown[]).length !== snapshot.total_count) {
      return { status: "INVALID", reason: (snapshot.total_count as number) > HISTORY_TOTAL_LIMIT ? "HISTORY_PAGE_UNSUPPORTED" : "HISTORY_INCOMPLETE" };
    }
    const rows = snapshot.messages as unknown[], messageIds = new Set<string>(), objectIds = new Set<string>();
    let ownerAckCount = 0, ownerIndex = -1, objectCount = 0;
    const botRows: Array<{ index: number; row: ChatMessageHistoryCandidate }> = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = readExactRecord(rows[index], ["message_id", "provider_chat_id", "author_role", "objects"]);
      if (!isSafeId(row.message_id) || row.provider_chat_id !== snapshot.provider_chat_id ||
          (row.author_role !== "owner" && row.author_role !== "bot" && row.author_role !== "other") || !Array.isArray(row.objects)) {
        return { status: "INVALID", reason: "HISTORY_SHAPE_INVALID" };
      }
      if (messageIds.has(row.message_id)) return { status: "INVALID", reason: "RESULT_MESSAGE_DUPLICATE" };
      messageIds.add(row.message_id);
      if (row.author_role === "other" && recovery.owner_echo_message_id !== null) return { status: "INVALID", reason: "OTHER_AUTHOR_PRESENT" };
      if (row.objects.length > 64) return { status: "INVALID", reason: "RESULT_OBJECT_LIMIT_EXCEEDED" };
      if (row.author_role === "owner" && row.objects.length !== 3) return { status: "INVALID", reason: "OWNER_ACK_MISMATCH" };
      const safeObjects: Array<{ message_object_id: string; object_type: string; model_type: string | null }> = [];
      for (let objectIndex = 0; objectIndex < (row.objects as unknown[]).length; objectIndex += 1) {
        const item = (row.objects as unknown[])[objectIndex];
        const object = readExactRecord(item, ["message_object_id", "object_type", "model_type"]);
        if (!isSafeId(object.message_object_id) || (object.model_type !== null && typeof object.model_type !== "string")) {
          return { status: "INVALID", reason: "HISTORY_SHAPE_INVALID" };
        }
        if (objectIds.has(object.message_object_id)) return { status: "INVALID", reason: "RESULT_OBJECT_DUPLICATE" };
        objectIds.add(object.message_object_id); objectCount += 1;
        if (objectCount > 4_096) return { status: "INVALID", reason: "RESULT_OBJECT_LIMIT_EXCEEDED" };
        if (row.author_role === "owner") {
          const expectedType = objectIndex === 0 ? "text" : "image";
          if (object.object_type !== expectedType) return { status: "INVALID", reason: "RESULT_OBJECT_TYPE_MISMATCH" };
        } else if (object.object_type !== "video") return { status: "INVALID", reason: "RESULT_OBJECT_TYPE_MISMATCH" };
        if (object.model_type === null) return { status: "INVALID", reason: "RESULT_MODEL_TYPE_MISSING" };
        if (object.model_type !== MODEL_ID) return { status: "INVALID", reason: "RESULT_MODEL_TYPE_MISMATCH" };
        safeObjects.push({ message_object_id: object.message_object_id as string,
          object_type: object.object_type as string, model_type: object.model_type as string | null });
      }
      if (row.author_role === "owner") {
        ownerAckCount += 1; ownerIndex = index;
        if (row.message_id !== recovery.owner_echo_message_id) return { status: "INVALID", reason: "OWNER_ACK_MISMATCH" };
      } else if (row.author_role === "bot" && safeObjects.length > 0) {
        botRows.push({ index, row: Object.freeze({ message_id: row.message_id as string,
          provider_chat_id: row.provider_chat_id as string, author_role: "bot", objects: Object.freeze(safeObjects) }) });
      }
    }
    if (ownerAckCount !== 1) return { status: "INVALID", reason: ownerAckCount === 0 ? "OWNER_ACK_MISSING" : "OWNER_ACK_AMBIGUOUS" };
    if (botRows.some(({ index, row }) => index < ownerIndex && row.objects.length > 0)) return { status: "INVALID", reason: "OWNER_ACK_MISMATCH" };
    const botMessages = botRows.filter(({ index }) => index > ownerIndex).map(({ row }) => row);
    return botMessages.length ? { status: "BOUND", botMessages: Object.freeze(botMessages) } : { status: "PENDING", reason: "BOT_RESULT_MISSING" };
  } catch { return { status: "INVALID", reason: "HISTORY_SHAPE_INVALID" }; }
}

function pageResult(recovery: Recovery, offset: number): OwnerWan30FirstLastGenerationResult {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > recovery.artifacts.length) invalid();
  const artifacts = Object.freeze(recovery.artifacts.slice(offset, offset + RESULT_PAGE_SIZE));
  const next = offset + artifacts.length;
  return Object.freeze({ status: recovery.status as "completed" | "partial_results", status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY",
    backend_acceptance: "UNPROVEN", provider_terminal_status: "UNPROVEN", model_id: MODEL_ID,
    parameters: recovery.intent.parameters, cost_inputs: COST_PARAMETERS,
    cost_input_confidence: "CATALOG_KEYS_NOT_UI_CALLER_JOINED", recovery_id: recovery.recovery_id,
    observed_artifact_count: recovery.artifacts.length, offset, page_size: RESULT_PAGE_SIZE, artifacts,
    has_more: next < recovery.artifacts.length, next_offset: next < recovery.artifacts.length ? next : null,
    diagnostic: snapshotDiagnostic(recovery.diagnostic) });
}

function snapshotDiagnostic(value: MutableDiagnostic): OwnerWan30FirstLastGenerationDiagnostic { return Object.freeze({ ...value }); }
function unknownError(recovery: Recovery): OwnerWan30FirstLastGenerationServiceError {
  return new OwnerWan30FirstLastGenerationServiceError("OUTCOME_UNKNOWN", recovery.recovery_id, snapshotDiagnostic(recovery.diagnostic));
}
function serviceError(code: OwnerWan30FirstLastGenerationServiceErrorCode): OwnerWan30FirstLastGenerationServiceError {
  return new OwnerWan30FirstLastGenerationServiceError(code);
}
function invalid(): never { throw serviceError("INVALID_REQUEST"); }
function fail(code: OwnerWan30FirstLastGenerationServiceErrorCode): never { throw serviceError(code); }

function validUploadedFrame(value: unknown, role: OwnerWan30FirstLastFrameRole,
  receipt: OwnerWan30FirstLastValidatedFrame): value is OwnerWan30FirstLastUploadedFrame {
  try {
    const fields = readExactRecord(value, ["status", "model_id", "role", "mime_type", "size", "sha256", "width", "height",
      "upload_profile_confidence", "owner_upload_binding"]);
    return Object.isFrozen(value) && fields.status === "uploaded" && fields.model_id === MODEL_ID && fields.role === role &&
      fields.mime_type === receipt.mime_type && fields.size === receipt.size && fields.sha256 === receipt.sha256 &&
      fields.width === receipt.width && fields.height === receipt.height &&
      fields.upload_profile_confidence === "OWNER_IMPLEMENTATION_INFERENCE_NOT_UI_MULTIPART_OBSERVED" &&
      fields.owner_upload_binding === "SAME_CLIENT_NATIVE_UPLOAD";
  } catch { return false; }
}

function freshPreflight(accountInput: unknown, accessInput: unknown, catalog: DiscoveryCatalogRepository, now: number): boolean {
  try {
    const account = readExactRecord(accountInput, ["balance", "subscription", "contract_evidence", "source_build", "observed_at"]);
    const balance = readExactRecord(account.balance, ["unit", "available"]);
    const subscription = readExactRecord(account.subscription, ["active", "plan_type", "end_date", "end_date_kind"]);
    const access = readExactRecord(accessInput, ["catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live",
      "parameter_keys", "parameters_redacted", "access", "cost", "discount_cost", "free_remaining_generations", "limit", "show_warning", "observed_at"]);
    const expectedVersion = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
    const actualKeys = denseStrings(access.parameter_keys).sort();
    const expectedKeys = Object.keys(COST_PARAMETERS).sort();
    if (account.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || account.source_build !== ACCOUNT_SOURCE_BUILD ||
        balance.unit !== "tokens" || typeof balance.available !== "string" || !validDecimal(balance.available) ||
        !validSubscription(subscription, now) || !isFreshIso(account.observed_at, now) ||
        access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || access.catalog_version !== expectedVersion ||
        access.model_id !== MODEL_ID || access.model_type !== MODEL_ID || access.ai_name !== "wan_video" ||
        access.account_read_live !== true || access.parameters_redacted !== true || access.access !== true ||
        actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index]) ||
        !isFreshIso(access.observed_at, now) || !nullableFinite(access.cost) || !nullableFinite(access.discount_cost) ||
        !(access.free_remaining_generations === null || nonnegativeInteger(access.free_remaining_generations)) ||
        !(access.limit === null || (typeof access.limit === "number" && Number.isFinite(access.limit) && access.limit >= 0)) ||
        !(access.show_warning === null || typeof access.show_warning === "boolean")) return false;
    const quote = typeof access.discount_cost === "number" ? access.discount_cost : access.cost;
    if (typeof quote !== "number" || !Number.isFinite(quote) || quote < 0) return false;
    return decimalLess(String(quote), balance.available);
  } catch { return false; }
}

function validSubscription(value: Record<string, unknown>, now: number): boolean {
  if (value.active !== true || !(value.plan_type === null || (typeof value.plan_type === "string" && value.plan_type.trim() !== ""))) return false;
  if (value.end_date === null) return value.end_date_kind === null;
  if (typeof value.end_date !== "string" || value.end_date_kind !== "OFFSET_DATETIME" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value.end_date)) return false;
  const expiry = Date.parse(value.end_date);
  return Number.isFinite(expiry) && expiry > now;
}

function isFreshIso(value: unknown, now: number): boolean {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= now + MAX_CLOCK_SKEW_MS && now - timestamp <= PREFLIGHT_FRESH_MS &&
    new Date(timestamp).toISOString() === value;
}

function decimalParts(value: string): { digits: bigint; scale: number } | null {
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/u.exec(value);
  if (!match) return null;
  const fraction = match[2] ?? "", exponent = Number(match[3] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) return null;
  let digits: bigint;
  try { digits = BigInt(`${match[1]}${fraction}`); } catch { return null; }
  let scale = fraction.length - exponent;
  if (scale < 0) { digits *= 10n ** BigInt(-scale); scale = 0; }
  return { digits, scale };
}
function validDecimal(value: unknown): value is string { return typeof value === "string" && decimalParts(value) !== null; }
function decimalLess(left: string, right: string): boolean {
  const a = decimalParts(left), b = decimalParts(right);
  if (!a || !b) return false;
  const scale = Math.max(a.scale, b.scale);
  return a.digits * 10n ** BigInt(scale - a.scale) < b.digits * 10n ** BigInt(scale - b.scale);
}
function nullableFinite(value: unknown): boolean { return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0); }
function nonnegativeInteger(value: unknown): boolean { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }

function semanticFrameKey(principal: Readonly<GenerationPrincipalRef>, attemptId: string, role: OwnerWan30FirstLastFrameRole,
  sha256: string, size: number, mimeType: string,
  source: ReturnType<typeof getOwnerWan30FirstLastGenerationSourceContract>): string {
  return createHash("sha256").update(JSON.stringify({ principal: { tenant_id: principal.tenant_id, subject_id: principal.subject_id },
    attempt_id: attemptId, profile_id: source.profile_id, source_pins: source.source_pins,
    role, sha256, size, mime_type: mimeType })).digest("hex");
}

function generationSemanticKey(principal: Readonly<GenerationPrincipalRef>, intent: OwnerWan30FirstLastGenerationIntent,
  first: FrameRecord, last: FrameRecord, source: ReturnType<typeof getOwnerWan30FirstLastGenerationSourceContract>): string {
  return createHash("sha256").update(JSON.stringify({ principal: { tenant_id: principal.tenant_id, subject_id: principal.subject_id },
    source: { profile_id: source.profile_id, source_pins: source.source_pins }, intent,
    references: [{ role: "first_frame", sha256: first.context.sha256 }, { role: "last_frame", sha256: last.context.sha256 }] })).digest("hex");
}

function validAck(value: unknown, chatUuid: string): value is MediaGenerationReceipt {
  try {
    const fields = readExactRecord(value, ["chat_uuid", "message_id"]);
    return fields.chat_uuid === chatUuid && isSafeId(fields.message_id);
  } catch { return false; }
}

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = readExactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || fields.tenant_id.trim() === "" || fields.tenant_id.length > 256 ||
      typeof fields.subject !== "string" || fields.subject.trim() === "" || fields.subject.length > 512 ||
      /[\u0000-\u001f\u007f]/u.test(fields.tenant_id) || /[\u0000-\u001f\u007f]/u.test(fields.subject)) invalid();
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}
function snapshotLinkService(value: unknown): Pick<PerUserLinkService, "getStatus"> {
  if (!isExactService<Pick<PerUserLinkService, "getStatus">>(value, PerUserLinkService, ["getStatus"])) invalid();
  return value as Pick<PerUserLinkService, "getStatus">;
}
function readExactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) invalid();
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !keys.includes(key)) ||
        keys.some((key) => typeof key !== "string" || (!required.includes(key) && !optional.includes(key)) ||
          !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch { return invalid(); }
}
function readClockFactory(value: unknown): () => number {
  if (value === undefined) return Date.now;
  if (typeof value !== "function" || types.isProxy(value)) invalid();
  return value as () => number;
}
function bounded(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) invalid();
  return value as number;
}
function safeAttempt(value: unknown): string {
  if (typeof value !== "string" || !ATTEMPT.test(value)) invalid();
  return value;
}
function safeRecovery(value: unknown): string {
  if (typeof value !== "string" || !RECOVERY_ID.test(value)) invalid();
  return value;
}
function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function denseStrings(value: unknown): string[] {
  if (!Array.isArray(value) || types.isProxy(value) || value.length > 32) fail("PREFLIGHT_FAILED");
  const out: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") fail("PREFLIGHT_FAILED");
    out.push(descriptor.value);
  }
  return out;
}
function sameStrings(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}
function sameSourcePins(left: object, right: object): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function isExactInstance<T extends object>(value: unknown, ctor: { prototype: object }): value is T {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === ctor.prototype;
}
function isExactService<T extends object>(value: unknown, ctor: { prototype: object }, methods: readonly string[]): value is T {
  if (!isExactInstance<T>(value, ctor)) return false;
  return methods.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(ctor.prototype, key);
    return !!descriptor && "value" in descriptor && !Object.hasOwn(value, key) && Reflect.get(value, key) === descriptor.value;
  });
}
