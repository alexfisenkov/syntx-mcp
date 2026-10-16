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
  createOwnerWan30OmniGenerationContext,
  inspectOwnerWan30OmniGenerationContext,
  readOwnerWan30OmniPrivateWireBinding,
  releaseOwnerWan30OmniGenerationContext,
  releaseOwnerWan30OmniImageInput,
  releaseOwnerWan30OmniUploadedImage,
  uploadOwnerWan30OmniImage,
  validateOwnerWan30OmniImageInput,
  OwnerWan30OmniNativeContextError,
  type OwnerWan30OmniOwnerAckBinding,
  type OwnerWan30OmniGenerationContext,
  type OwnerWan30OmniUploadedImage,
  type OwnerWan30OmniValidatedImage
} from "../adapter/syntx/owner-wan30-omni-native-context.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../catalog/public-catalog-history.js";
import { AccountStatusService, type AccountStatusResult } from "./account-status.js";
import { ModelAccessService, type ModelAccessResult } from "./model-access.js";
import {
  getOwnerWan30OmniGenerationSourceContract,
  normalizeOwnerWan30OmniGenerationIntent,
  OwnerWan30OmniGenerationParametersError,
  type OwnerWan30OmniGenerationIntent,
  type OwnerWan30OmniGenerationParameters
} from "./owner-wan30-omni-generation-parameters.js";
import type { OwnerWanT2vGenerationDiagnostic, OwnerWanT2vVideoArtifact } from "./owner-wan-t2v-generation-service.js";

const MODEL_ID = "wan_30_omni" as const;
const CATALOG_VERSION = "sha256-19c882601bb8ecdba994adf819544ebf06fd2db30374335631bb6078a66e5a76.json" as const;
const MODELS_SHA256 = "sha256:20b8c6482d72dbb4bf7e6500a0fbc0514eeac29bf5b7170559cd7665045583e3" as const;
const PROFILE_ID = "owner-wan30-omni-web-request-observed-1874" as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const IMAGE_HANDLE = /^wan30_omni_image_[0-9a-f-]{36}$/u;
const RECOVERY_ID = /^wan_omni_recovery_[0-9a-f-]{36}$/u;
const MAX_IMAGE_BYTES = 7 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const MAX_HANDLES = 128;
const MAX_RECOVERIES = 128;
const HANDLE_TTL_MS = 15 * 60_000;
const MAX_TIMEOUT_MS = 5 * 60_000;
const PAGE_SIZE = 64;
const HISTORY_LIMIT = 64;
const HISTORY_PAGE_SIZE = 10;
const MAX_CLOCK_SKEW_MS = 30_000;
const PREFLIGHT_FRESH_MS = 120_000;
const MAX_POLLS = 2;
const POLL_DELAY_MS = 500;
const COST_INPUTS = Object.freeze({ resolution: "480P", video_duration: 2, duration: 0, rendering_speed: "basic" } as const);

const ACCOUNT_GET = AccountStatusService.prototype.getAccountStatus;
const ACCESS_GET = ModelAccessService.prototype.getModelAccess;
const CHAT_CREATE = SyntxChatHttpClient.prototype.createChat;
const IMAGE_UPLOAD = SyntxChatHttpClient.prototype.uploadWan30OmniImage;
const VIDEO_GENERATE = SyntxChatHttpClient.prototype.generateWan30OmniVideo;
const HISTORY_GET = SyntxChatHttpClient.prototype.listWanT2vMessageCandidates;
const RESULT_GET = SyntxChatHttpClient.prototype.getWanT2vVideoResultMessage;
const IN_PROGRESS_GET = SyntxChatHttpClient.prototype.listInProgress;
const OWNER_ACK_BIND = Reflect.get(SyntxChatHttpClient.prototype, "getWan30OmniOwnerAckBinding") as Function | undefined;
const SERVICES = new WeakSet<object>();

export type OwnerWan30OmniGenerationDiagnostic = OwnerWanT2vGenerationDiagnostic;
export type OwnerWan30OmniVideoArtifact = OwnerWanT2vVideoArtifact;
export type OwnerWan30OmniRecoveryStatus = "outcome_unknown" | "partial_results";

export interface OwnerWan30OmniGenerationServiceOptions {
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

export interface OwnerWan30OmniImageUploadInput {
  readonly attemptId: string;
  readonly content_base64: string;
  readonly filename: string;
  readonly mime_type: string;
}
export interface OwnerWan30OmniImageUploadReceipt {
  readonly status: "uploaded";
  readonly image_handle: string;
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
export interface OwnerWan30OmniGenerateInput {
  readonly attemptId: string;
  readonly input: OwnerWan30OmniGenerationIntent;
  readonly image_handle: string;
}
export interface OwnerWan30OmniReconcileInput { readonly attemptId: string; readonly recovery_id: string }
export interface OwnerWan30OmniRecoveryListInput { readonly attemptId: string; readonly limit?: number }
export interface OwnerWan30OmniResultPageInput { readonly attemptId: string; readonly recovery_id: string; readonly offset?: number }

export interface OwnerWan30OmniGenerationResult {
  readonly status: "completed" | "partial_results";
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly backend_acceptance: "UNPROVEN";
  readonly provider_terminal_status: "UNPROVEN";
  readonly model_id: typeof MODEL_ID;
  readonly parameters: OwnerWan30OmniGenerationParameters;
  readonly cost_inputs: typeof COST_INPUTS;
  readonly cost_input_confidence: "UI_QUOTE_CALLER_OBSERVED_SINGLE_TUPLE_NOT_BILLING";
  readonly recovery_id: string;
  readonly observed_artifact_count: number;
  readonly offset: number;
  readonly page_size: 64;
  readonly artifacts: readonly OwnerWan30OmniVideoArtifact[];
  readonly has_more: boolean;
  readonly next_offset: number | null;
  readonly diagnostic: OwnerWan30OmniGenerationDiagnostic;
}
export interface OwnerWan30OmniRecoveryListItem {
  readonly recovery_id: string;
  readonly created_at: string;
  readonly model_id: typeof MODEL_ID;
  readonly status: OwnerWan30OmniRecoveryStatus;
  readonly observed_artifact_count: number;
  readonly diagnostic: OwnerWan30OmniGenerationDiagnostic;
}
export interface OwnerWan30OmniRecoveryListResult { readonly recoveries: readonly OwnerWan30OmniRecoveryListItem[] }

export type OwnerWan30OmniGenerationServiceErrorCode =
  | "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH"
  | "PREFLIGHT_FAILED" | "UPLOAD_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN" | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED"
  | "INTENT_ALREADY_CLAIMED" | "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND";
export const OWNER_WAN30_OMNI_GENERATION_ERROR_CODES = Object.freeze([
  "INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH",
  "PREFLIGHT_FAILED", "UPLOAD_REJECTED", "UPLOAD_OUTCOME_UNKNOWN", "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED",
  "INTENT_ALREADY_CLAIMED", "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"
] as const satisfies readonly OwnerWan30OmniGenerationServiceErrorCode[]);

export class OwnerWan30OmniGenerationServiceError extends Error {
  readonly diagnostic: OwnerWan30OmniGenerationDiagnostic | undefined;
  constructor(readonly code: OwnerWan30OmniGenerationServiceErrorCode, readonly recovery_id?: string,
    diagnostic?: OwnerWan30OmniGenerationDiagnostic) {
    super(code === "OUTCOME_UNKNOWN"
      ? "The WAN 3.0 Omni request may have been dispatched; reconcile its recovery and do not retry."
      : "The owner WAN 3.0 Omni operation could not be completed safely.");
    this.name = "OwnerWan30OmniGenerationServiceError";
    this.diagnostic = code === "OUTCOME_UNKNOWN" && diagnostic ? diagnostic : undefined;
  }
}

interface ImageRecord {
  readonly image_handle: string;
  readonly semantic_key: string;
  readonly profile_id: string;
  readonly source_pins: object;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly client: SyntxChatHttpClient;
  readonly image: OwnerWan30OmniUploadedImage;
  readonly expires_at: number;
  retained_recovery: boolean;
  consumed: boolean;
}
interface Recovery {
  readonly recovery_id: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly intent: OwnerWan30OmniGenerationIntent;
  readonly semantic_key: string;
  readonly chat_uuid: string;
  readonly created_at: string;
  readonly source_pins: object;
  readonly image_sha256: string;
  readonly context: OwnerWan30OmniGenerationContext;
  readonly client: SyntxChatHttpClient;
  owner_echo_message_id: string | null;
  status: OwnerWan30OmniRecoveryStatus | "completed";
  artifacts: readonly OwnerWan30OmniVideoArtifact[];
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
interface ActiveRun {
  readonly attemptId: string;
  readonly controller: AbortController;
  readonly promise: Promise<void>;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly finish: () => void;
  readonly removeExternal: () => void;
}
interface UploadSnapshot { readonly attemptId: string; readonly filename: string; readonly mime_type: string; readonly bytes: Buffer }

/** Process-local owner-bound one-image Omni service; model/profile semantics remain separate from Reference. */
export class OwnerWan30OmniGenerationService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #catalogDirectory: string | undefined;
  readonly #resolveClient: OwnerWan30OmniGenerationServiceOptions["resolveClient"];
  readonly #createAccount: OwnerWan30OmniGenerationServiceOptions["createAccountStatusService"];
  readonly #createAccess: OwnerWan30OmniGenerationServiceOptions["createModelAccessService"];
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #images = new Map<string, ImageRecord>();
  readonly #imageBySemantic = new Map<string, string>();
  readonly #unknownUploads = new Map<string, string>();
  readonly #pendingUploads = new Map<string, string>();
  readonly #claims = new Map<string, Readonly<{ attemptId: string; recovery_id: string | null }>>();
  readonly #recoveries = new Map<string, Recovery>();
  readonly #runs = new Set<ActiveRun>();
  readonly #invalidating = new Set<string>();
  readonly #epochs = new Map<string, number>();
  readonly #usedAccounts = new WeakSet<object>();
  readonly #usedAccess = new WeakSet<object>();
  #omniCatalog: DiscoveryCatalogRepository | undefined;
  #closed = false;
  #closing: Promise<void> | undefined;
  #lastNow = -1;

  constructor(optionsInput: OwnerWan30OmniGenerationServiceOptions | unknown) {
    if (new.target !== OwnerWan30OmniGenerationService) invalid();
    const fields = exact(optionsInput, ["binding", "linkService", "catalog", "catalog_version", "resolveClient",
      "createAccountStatusService", "createModelAccessService"], ["catalogDirectory", "now", "timeoutMs"]);
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = snapshotLinkService(fields.linkService);
    if (!isExactInstance(fields.catalog, DiscoveryCatalogRepository) || fields.catalog_version !== CATALOG_VERSION ||
        typeof fields.resolveClient !== "function" || types.isProxy(fields.resolveClient) ||
        typeof fields.createAccountStatusService !== "function" || types.isProxy(fields.createAccountStatusService) ||
        typeof fields.createModelAccessService !== "function" || types.isProxy(fields.createModelAccessService) ||
        (fields.catalogDirectory !== undefined && (typeof fields.catalogDirectory !== "string" || !fields.catalogDirectory.trim()))) invalid();
    this.#catalog = fields.catalog as DiscoveryCatalogRepository;
    this.#catalogDirectory = fields.catalogDirectory as string | undefined;
    this.#resolveClient = fields.resolveClient as OwnerWan30OmniGenerationServiceOptions["resolveClient"];
    this.#createAccount = fields.createAccountStatusService as OwnerWan30OmniGenerationServiceOptions["createAccountStatusService"];
    this.#createAccess = fields.createModelAccessService as OwnerWan30OmniGenerationServiceOptions["createModelAccessService"];
    this.#now = clockFactory(fields.now);
    this.#timeoutMs = bounded(fields.timeoutMs, 1_000, MAX_TIMEOUT_MS, 120_000);
    this.#assertCatalog(this.#catalog);
    Object.freeze(this);
    SERVICES.add(this);
  }

  async uploadOmniImage(input: OwnerWan30OmniImageUploadInput | unknown, signal?: AbortSignal): Promise<OwnerWan30OmniImageUploadReceipt> {
    const request = snapshotUpload(input, signal);
    try { return await this.#run(request.attemptId, signal, (deadline) => this.#upload(request, deadline)); }
    finally { request.bytes.fill(0); }
  }
  async generate(input: OwnerWan30OmniGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerWan30OmniGenerationResult> {
    const request = snapshotGenerate(input, signal);
    return await this.#run(request.attemptId, signal, (deadline) => this.#generate(request, deadline));
  }
  async reconcile(input: OwnerWan30OmniReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerWan30OmniGenerationResult> {
    const request = snapshotRecovery(input, signal);
    return await this.#run(request.attemptId, signal, (deadline) => this.#reconcile(request, deadline));
  }
  async listRecoveries(input: OwnerWan30OmniRecoveryListInput | unknown): Promise<OwnerWan30OmniRecoveryListResult> {
    const request = snapshotRecoveryList(input);
    return await this.#run(request.attemptId, undefined, async (deadline) => {
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      const rows = [...this.#recoveries.values()].filter((row) => row.attemptId === request.attemptId &&
        sameGenerationPrincipal(row.principal, principal) && row.status !== "completed")
        .sort((left, right) => left.created_at.localeCompare(right.created_at)).slice(0, request.limit);
      return Object.freeze({ recoveries: Object.freeze(rows.map((row) => Object.freeze({ recovery_id: row.recovery_id,
        created_at: row.created_at, model_id: MODEL_ID, status: row.status as OwnerWan30OmniRecoveryStatus,
        observed_artifact_count: row.artifacts.length, diagnostic: freezeDiagnostic(row.diagnostic) }))) });
    });
  }
  async getResultPage(input: OwnerWan30OmniResultPageInput | unknown, signal?: AbortSignal): Promise<OwnerWan30OmniGenerationResult> {
    const request = snapshotResultPage(input, signal);
    return await this.#run(request.attemptId, signal, async (deadline) => {
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      const recovery = this.#recoveries.get(request.recovery_id);
      if (!recovery || recovery.attemptId !== request.attemptId || !sameGenerationPrincipal(recovery.principal, principal)) fail("RECOVERY_NOT_FOUND");
      const source = this.#assertSource();
      if (!samePins(recovery.source_pins, source.source_pins)) throw unknown(recovery);
      if (recovery.status === "outcome_unknown") throw unknown(recovery);
      return page(recovery, request.offset);
    });
  }
  async invalidateAttempt(attemptInput: unknown): Promise<void> {
    const attemptId = safeAttempt(attemptInput);
    this.#invalidating.add(attemptId);
    this.#epochs.set(attemptId, this.#epoch(attemptId) + 1);
    const active = [...this.#runs].filter((run) => run.attemptId === attemptId);
    for (const run of active) run.controller.abort();
    await Promise.allSettled(active.map((run) => run.promise));
    this.#clearAttempt(attemptId);
    this.#epochs.delete(attemptId); this.#invalidating.delete(attemptId);
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const run of this.#runs) run.controller.abort();
    this.#closing = (async () => {
      await Promise.allSettled([...this.#runs].map((run) => run.promise));
      for (const image of this.#images.values()) releaseOwnerWan30OmniUploadedImage(image.client, image.image);
      for (const recovery of this.#recoveries.values()) releaseOwnerWan30OmniGenerationContext(recovery.client, recovery.context);
      this.#images.clear(); this.#imageBySemantic.clear(); this.#unknownUploads.clear(); this.#pendingUploads.clear();
      this.#claims.clear(); this.#recoveries.clear(); this.#runs.clear(); this.#epochs.clear(); this.#invalidating.clear();
    })();
    return this.#closing;
  }

  async #upload(request: Readonly<UploadSnapshot>, deadline: AbsoluteRequestDeadline): Promise<OwnerWan30OmniImageUploadReceipt> {
    let validated: OwnerWan30OmniValidatedImage | undefined;
    let provisional: OwnerWan30OmniUploadedImage | undefined;
    let provisionalClient: SyntxChatHttpClient | undefined;
    let stored = false, nativeInvoked = false, unknownOutcome = false;
    let semanticKey: string | undefined;
    try {
      this.#prune(this.#readNow());
      const source = this.#assertSource();
      validated = validateOwnerWan30OmniImageInput({ filename: request.filename, mime_type: request.mime_type, bytes: request.bytes });
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      const client = this.#resolveNativeClient(request.attemptId);
      semanticKey = semanticUploadKey(request.attemptId, principal, validated, source);
      if (this.#unknownUploads.has(semanticKey)) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (this.#pendingUploads.has(semanticKey)) fail("SERVICE_BUSY");
      const previous = this.#imageBySemantic.get(semanticKey);
      const prior = previous ? this.#images.get(previous) : undefined;
      if (prior) {
        if (this.#liveImage(prior, request.attemptId, principal, client)) return uploadReceipt(prior, this.#readNow());
        fail("REFERENCE_UNAVAILABLE");
      }
      if (this.#images.size + this.#unknownUploads.size + this.#pendingUploads.size >= MAX_HANDLES) fail("SERVICE_BUSY");
      this.#pendingUploads.set(semanticKey, request.attemptId);
      const epoch = this.#epoch(request.attemptId);
      deadline.throwIfAborted(); nativeInvoked = true;
      const pending = Promise.resolve(uploadOwnerWan30OmniImage(client, validated, deadline.signal));
      try { provisional = await this.#await(deadline, () => pending); }
      catch (error) { void pending.then((late) => releaseOwnerWan30OmniUploadedImage(client, late), () => {}); throw error; }
      provisionalClient = client;
      deadline.throwIfAborted();
      if (!validUploaded(provisional, validated) || epoch !== this.#epoch(request.attemptId) || this.#invalidating.has(request.attemptId)) {
        unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      const currentPrincipal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      if (!sameGenerationPrincipal(principal, currentPrincipal) || this.#resolveNativeClient(request.attemptId) !== client) {
        unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      const expires = this.#readNow() + HANDLE_TTL_MS;
      const handle = `wan30_omni_image_${randomUUID()}`;
      if (!IMAGE_HANDLE.test(handle)) { unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
      const record: ImageRecord = { image_handle: handle, semantic_key: semanticKey, profile_id: source.profile_id,
        source_pins: source.source_pins, attemptId: request.attemptId, principal, client,
        image: provisional, expires_at: expires, retained_recovery: false, consumed: false };
      this.#images.set(handle, record); this.#imageBySemantic.set(semanticKey, handle); stored = true;
      return uploadReceipt(record, this.#readNow());
    } catch (error) {
      if (error instanceof OwnerWan30OmniGenerationServiceError) {
        if (error.code === "UPLOAD_OUTCOME_UNKNOWN") unknownOutcome ||= nativeInvoked;
        else if (nativeInvoked && error.code !== "UPLOAD_REJECTED") { unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
        throw error;
      }
      if (error instanceof OwnerWan30OmniNativeContextError) {
        if (error.code === "UPLOAD_OUTCOME_UNKNOWN") { unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
        if (error.code === "INVALID_CLIENT") fail("MODEL_BINDING_MISMATCH");
        fail("UPLOAD_REJECTED");
      }
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      if (error instanceof OwnerWan30OmniGenerationParametersError) fail("INVALID_REQUEST");
      if (nativeInvoked) { unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
      return fail("INVALID_REQUEST");
    } finally {
      if (provisional && provisionalClient && !stored) releaseOwnerWan30OmniUploadedImage(provisionalClient, provisional);
      releaseOwnerWan30OmniImageInput(validated);
      if (unknownOutcome && semanticKey) this.#unknownUploads.set(semanticKey, request.attemptId);
      if (semanticKey) this.#pendingUploads.delete(semanticKey);
      request.bytes.fill(0);
    }
  }

  async #generate(request: Readonly<OwnerWan30OmniGenerateInput>, deadline: AbsoluteRequestDeadline): Promise<OwnerWan30OmniGenerationResult> {
    let context: OwnerWan30OmniGenerationContext | undefined;
    let recovery: Recovery | undefined;
    const normalized = normalizeOwnerWan30OmniGenerationIntent({ prompt: request.input.prompt, parameters: request.input.parameters });
    const intent = normalized.intent, source = this.#assertSource();
    const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
    const client = this.#resolveNativeClient(request.attemptId);
    const image = this.#getImageRecord(request.image_handle);
    this.#assertImageBinding(image, request.attemptId, principal, client);
    const semanticKey = semanticGenerationKey(principal, intent, image, source);
    const claim = this.#claims.get(semanticKey);
    if (claim !== undefined) {
      if (claim.attemptId !== request.attemptId) fail("INTENT_ALREADY_CLAIMED");
      const found = claim.recovery_id ? this.#recoveries.get(claim.recovery_id) : undefined;
      if (found && (found.attemptId !== request.attemptId || !sameGenerationPrincipal(found.principal, principal) || found.client !== client)) {
        fail("INTENT_ALREADY_CLAIMED");
      }
      if (found?.status === "completed" || found?.status === "partial_results") return page(found, 0);
      if (found) throw unknown(found);
      fail("INTENT_ALREADY_CLAIMED");
    }
    this.#assertImage(request, image, principal, client);
    if (this.#claims.size >= MAX_RECOVERIES) fail("SERVICE_BUSY");
    this.#claims.set(semanticKey, Object.freeze({ attemptId: request.attemptId, recovery_id: null }));
    try {
      await this.#preflight(request.attemptId, deadline);
      await this.#assertOwnerAndImage(request, image, principal, client, deadline);
      const chat = await this.#await(deadline, () => Reflect.apply(CHAT_CREATE, client,
        ["video", `owner-wan30-omni-${randomUUID()}`, deadline.signal]) as Promise<{ chat_uuid: string }>);
      if (!chat || !safeId(chat.chat_uuid)) fail("PRE_DISPATCH_FAILED");
      await this.#assertOwnerAndImage(request, image, principal, client, deadline);
      await this.#preflight(request.attemptId, deadline);
      await this.#assertOwnerAndImage(request, image, principal, client, deadline);
      context = createOwnerWan30OmniGenerationContext(client, Object.freeze({ attempt_id: request.attemptId,
        principal, chat_id: chat.chat_uuid, intent, reference_image: image.image }));
      const binding = readOwnerWan30OmniPrivateWireBinding(client, context);
      if (!binding || binding.prompt !== `<<<${binding.reference_url}>>> ${intent.prompt} ` || !isSafeUploadReferenceUrl(binding.reference_url)) {
        fail("PRE_DISPATCH_FAILED");
      }
      recovery = createRecovery({ attemptId: request.attemptId, principal, intent, semanticKey, chatUuid: chat.chat_uuid,
        createdAt: this.#readNow(), sourcePins: source.source_pins, imageHash: image.image.sha256, context, client });
      if (this.#recoveries.size >= MAX_RECOVERIES) fail("SERVICE_BUSY");
      this.#recoveries.set(recovery.recovery_id, recovery);
      this.#claims.set(semanticKey, Object.freeze({ attemptId: request.attemptId, recovery_id: recovery.recovery_id }));
      image.retained_recovery = true;
      recovery.diagnostic.phase = "GENERATION_POST"; recovery.diagnostic.post_started = true;
      const ack = await this.#await(deadline, () => Reflect.apply(VIDEO_GENERATE, client, [context!, deadline.signal]) as Promise<MediaGenerationReceipt>);
      if (!validAck(ack, chat.chat_uuid)) throw unknown(recovery);
      recovery.owner_echo_message_id = ack.message_id;
      recovery.diagnostic.ack_known = true; recovery.diagnostic.phase = "POST_ACK_KNOWN";
      return await this.#observe(recovery, client, deadline);
    } catch (error) {
      if (!recovery && context) releaseOwnerWan30OmniGenerationContext(client, context);
      if (recovery) throw unknown(recovery);
      if (error instanceof OwnerWan30OmniGenerationServiceError) throw error;
      if (error instanceof OwnerWan30OmniNativeContextError) {
        if (error.code === "INVALID_CLIENT") fail("MODEL_BINDING_MISMATCH");
        fail("REFERENCE_UNAVAILABLE");
      }
      if (error instanceof OwnerWan30OmniGenerationParametersError) fail("INVALID_REQUEST");
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      fail("PRE_DISPATCH_FAILED");
    }
  }

  async #reconcile(request: Readonly<OwnerWan30OmniReconcileInput>, deadline: AbsoluteRequestDeadline): Promise<OwnerWan30OmniGenerationResult> {
    const recovery = this.#recoveries.get(request.recovery_id);
    if (!recovery || recovery.attemptId !== request.attemptId) fail("RECOVERY_NOT_FOUND");
    try {
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      if (!sameGenerationPrincipal(principal, recovery.principal) || this.#invalidating.has(request.attemptId)) throw unknown(recovery);
      const source = this.#assertSource();
      if (!samePins(recovery.source_pins, source.source_pins)) throw unknown(recovery);
      if (recovery.status === "completed") return page(recovery, 0);
      return await this.#observe(recovery, this.#resolveNativeClient(request.attemptId), deadline);
    } catch (error) {
      if (error instanceof OwnerWan30OmniGenerationServiceError && error.code === "RECOVERY_NOT_FOUND") throw error;
      throw unknown(recovery);
    }
  }

  async #observe(recovery: Recovery, client: SyntxChatHttpClient, deadline: AbsoluteRequestDeadline): Promise<OwnerWan30OmniGenerationResult> {
    if (!OWNER_ACK_BIND) throw unknown(recovery);
    if (recovery.owner_echo_message_id && !await this.#bindOwnerAck(recovery, client, recovery.owner_echo_message_id, deadline)) throw unknown(recovery);
    let lastPartial = false;
    for (let poll = 0; poll < MAX_POLLS; poll += 1) {
      deadline.throwIfAborted();
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(recovery.attemptId));
      if (!sameGenerationPrincipal(principal, recovery.principal) || this.#resolveNativeClient(recovery.attemptId) !== client ||
          this.#invalidating.has(recovery.attemptId)) throw unknown(recovery);
      recovery.diagnostic.phase = "HISTORY_GET"; recovery.diagnostic.history_get_calls += 1;
      let snapshot: ChatMessageHistorySnapshot;
      try {
        snapshot = await this.#await(deadline, () => Reflect.apply(HISTORY_GET, client,
          [recovery.chat_uuid, recovery.owner_echo_message_id, deadline.signal]) as Promise<ChatMessageHistorySnapshot>);
      } catch {
        deadline.throwIfAborted(); recovery.diagnostic.history_status = "UNVERIFIED";
        recovery.diagnostic.history_reason = "HISTORY_INCOMPLETE"; throw unknown(recovery);
      }
      await this.#assertRecoveryOwnerLive(recovery, client, deadline);
      const bound = bindHistory(snapshot, recovery);
      if (bound.status === "INVALID") {
        recovery.diagnostic.history_status = "UNVERIFIED"; recovery.diagnostic.history_reason = bound.reason; throw unknown(recovery);
      }
      if (!recovery.owner_echo_message_id) {
        if (!await this.#bindOwnerAck(recovery, client, bound.owner_echo_message_id, deadline)) throw unknown(recovery);
        recovery.owner_echo_message_id = bound.owner_echo_message_id; recovery.diagnostic.ack_known = true;
      }
      recovery.diagnostic.history_status = bound.status === "PENDING" ? "PENDING" : "COMPLETE";
      recovery.diagnostic.history_reason = bound.status === "PENDING" ? bound.reason : null;
      if (bound.status === "PENDING") {
        recovery.diagnostic.result_status = "PENDING"; recovery.diagnostic.result_reason = "RESULT_NOT_YET_AVAILABLE";
        if (poll + 1 < MAX_POLLS) {
          recovery.diagnostic.phase = "IN_PROGRESS_GET"; recovery.diagnostic.inprogress_get_calls += 1;
          try { await this.#await(deadline, () => Reflect.apply(IN_PROGRESS_GET, client,
            [recovery.chat_uuid, deadline.signal]) as Promise<InProgressMessage[]>); }
          catch { deadline.throwIfAborted(); }
          await this.#assertRecoveryOwnerLive(recovery, client, deadline);
          await this.#wait(deadline); continue;
        }
        throw unknown(recovery);
      }

      const videos: OwnerWan30OmniVideoArtifact[] = [];
      let incomplete = false, modelUnknown = false;
      for (const candidate of bound.botMessages) {
        recovery.diagnostic.phase = "RESULT_GET"; recovery.diagnostic.result_get_calls += 1;
        const decoded = await this.#await(deadline, () => Reflect.apply(RESULT_GET, client, [Object.freeze({
          chat_uuid: recovery.chat_uuid, message_id: candidate.message_id, model_id: MODEL_ID,
          provider_chat_id: candidate.provider_chat_id,
          message_object_ids: Object.freeze(candidate.objects.map((object) => object.message_object_id))
        }), deadline.signal]) as Promise<Awaited<ReturnType<SyntxChatHttpClient["getWanT2vVideoResultMessage"]>>>);
        await this.#assertRecoveryOwnerLive(recovery, client, deadline);
        if (decoded.message_binding !== "BOUND" || decoded.model_echo === "MISMATCH") throw unknown(recovery);
        if (decoded.ready_videos.length !== candidate.objects.length) incomplete = true;
        if (decoded.model_echo === "UNKNOWN") modelUnknown = true;
        for (const video of decoded.ready_videos) {
          const expected = candidate.objects[video.object_index];
          if (!expected || expected.message_object_id !== video.message_object_id || video.object_type !== "video" ||
              !isSafeUploadReferenceUrl(video.object_url) || (video.mime_type !== null && video.mime_type !== "video/mp4" && video.mime_type !== "video/quicktime")) throw unknown(recovery);
          videos.push(Object.freeze({ url: video.object_url, mime_type: video.mime_type, mime_source: video.mime_source,
            message_id: candidate.message_id, message_object_id: video.message_object_id, object_index: video.object_index,
            model_echo: decoded.model_echo, object_type: "video" }));
        }
      }
      if (new Set(videos.map((video) => video.message_object_id)).size !== videos.length ||
          new Set(videos.map((video) => video.url)).size !== videos.length) throw unknown(recovery);
      await this.#assertRecoveryOwnerLive(recovery, client, deadline);
      recovery.artifacts = Object.freeze(videos); recovery.diagnostic.phase = "RESULT_BINDING";
      if (videos.length > 0 && !incomplete) {
        recovery.status = "completed"; recovery.diagnostic.result_status = "COMPLETE";
        recovery.diagnostic.result_reason = modelUnknown ? "NATIVE_MODEL_ECHO_UNKNOWN" : null;
        releaseOwnerWan30OmniGenerationContext(client, recovery.context);
        this.#releaseImageForRecovery(recovery);
        return page(recovery, 0);
      }
      if (videos.length) {
        recovery.status = "partial_results"; recovery.diagnostic.result_status = "PARTIAL";
        recovery.diagnostic.result_reason = modelUnknown ? "NATIVE_MODEL_ECHO_UNKNOWN" : "NATIVE_RESULT_INCOMPLETE"; lastPartial = true;
      } else {
        recovery.diagnostic.result_status = "PENDING"; recovery.diagnostic.result_reason = "RESULT_NOT_YET_AVAILABLE";
      }
      if (poll + 1 < MAX_POLLS) await this.#wait(deadline);
    }
    if (lastPartial && recovery.artifacts.length) return page(recovery, 0);
    throw unknown(recovery);
  }

  async #bindOwnerAck(recovery: Recovery, client: SyntxChatHttpClient, ownerMessageId: string,
    deadline: AbsoluteRequestDeadline): Promise<boolean> {
    if (!OWNER_ACK_BIND || !safeId(ownerMessageId)) return false;
    recovery.diagnostic.phase = "HISTORY_GET"; recovery.diagnostic.history_get_calls += 1;
    let binding: OwnerWan30OmniOwnerAckBinding;
    try {
      binding = await this.#await(deadline, () => Reflect.apply(OWNER_ACK_BIND, client,
        [recovery.context, ownerMessageId, deadline.signal]) as Promise<OwnerWan30OmniOwnerAckBinding>);
    } catch {
      deadline.throwIfAborted(); recovery.diagnostic.history_status = "UNVERIFIED";
      recovery.diagnostic.history_reason = "HISTORY_INCOMPLETE"; return false;
    }
    await this.#assertRecoveryOwnerLive(recovery, client, deadline);
    if (binding.status !== "BOUND") {
      recovery.diagnostic.history_status = "UNVERIFIED"; recovery.diagnostic.history_reason = "OWNER_ACK_MISMATCH";
      recovery.diagnostic.result_status = "UNVERIFIED"; recovery.diagnostic.result_reason = "NATIVE_RESULT_UNVERIFIED";
      return false;
    }
    recovery.diagnostic.history_status = "COMPLETE"; recovery.diagnostic.history_reason = null;
    return true;
  }

  async #assertRecoveryOwnerLive(recovery: Recovery, client: SyntxChatHttpClient, deadline: AbsoluteRequestDeadline): Promise<void> {
    const principal = await this.#await(deadline, () => this.#resolvePrincipal(recovery.attemptId));
    const native = inspectOwnerWan30OmniGenerationContext(client, recovery.context);
    if (!sameGenerationPrincipal(principal, recovery.principal) || this.#resolveNativeClient(recovery.attemptId) !== client ||
        this.#invalidating.has(recovery.attemptId) || !native || native.attempt_id !== recovery.attemptId ||
        native.chat_id !== recovery.chat_uuid || native.dispatch_state !== "RESERVED" ||
        !sameGenerationPrincipal(native.principal, recovery.principal)) throw unknown(recovery);
  }

  async #preflight(attemptId: string, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted();
    const catalog = this.#getOmniCatalog();
    let accountService: AccountStatusService, accessService: ModelAccessService;
    try {
      accountService = Reflect.apply(this.#createAccount, undefined, [attemptId]) as AccountStatusService;
      accessService = Reflect.apply(this.#createAccess, undefined, [attemptId, catalog]) as ModelAccessService;
    } catch { fail("PREFLIGHT_FAILED"); }
    if (!isExactService(accountService, AccountStatusService, ["getAccountStatus"]) || this.#usedAccounts.has(accountService) ||
        !isExactService(accessService, ModelAccessService, ["getModelAccess"]) || this.#usedAccess.has(accessService)) fail("PREFLIGHT_FAILED");
    this.#usedAccounts.add(accountService); this.#usedAccess.add(accessService);
    let account: AccountStatusResult, access: ModelAccessResult;
    try {
      account = await this.#await(deadline, () => Reflect.apply(ACCOUNT_GET, accountService, [deadline.signal]) as Promise<AccountStatusResult>);
      access = await this.#await(deadline, () => Reflect.apply(ACCESS_GET, accessService, [Object.freeze({ model_id: MODEL_ID,
        cost_parameters: COST_INPUTS }), deadline.signal]) as Promise<ModelAccessResult>);
    } catch { fail("PREFLIGHT_FAILED"); }
    if (!freshPreflight(account, access, catalog, this.#readNow())) fail("PREFLIGHT_FAILED");
  }

  #assertCatalog(catalog: DiscoveryCatalogRepository): void {
    const source = getOwnerWan30OmniGenerationSourceContract();
    if (source.profile_id !== PROFILE_ID || source.model_id !== MODEL_ID || source.ai_name !== "wan_video" ||
        source.source_pins.public_catalog_version !== CATALOG_VERSION || source.dispatch_allowed !== false ||
        source.backend_acceptance !== "UNPROVEN" || source.effective_defaults !== "UNKNOWN" ||
        catalog.source_hashes.models !== MODELS_SHA256) fail("MODEL_BINDING_MISMATCH");
    let model: ReturnType<DiscoveryCatalogRepository["getModel"]>;
    try { model = catalog.getModel(MODEL_ID); } catch { fail("MODEL_BINDING_MISMATCH"); }
    if (model.id !== MODEL_ID || model.upstream_id !== MODEL_ID || model.ai_name !== "wan_video" || model.active !== true ||
        model.scope !== "video" || !model.modalities.includes("video") ||
        !model.operations.some((operation) => operation.id === "generate-video" && operation.output_modality === "video") ||
        !sameStrings(model.settings?.get_cost_params, Object.keys(COST_INPUTS))) fail("MODEL_BINDING_MISMATCH");
  }
  #getOmniCatalog(): DiscoveryCatalogRepository {
    if (this.#omniCatalog) return this.#omniCatalog;
    let catalog: DiscoveryCatalogRepository;
    try { catalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(CATALOG_VERSION, this.#catalogDirectory)); }
    catch { fail("MODEL_BINDING_MISMATCH"); }
    this.#assertCatalog(catalog); this.#omniCatalog = catalog; return catalog;
  }
  #assertSource() {
    const source = getOwnerWan30OmniGenerationSourceContract();
    this.#assertCatalog(this.#getOmniCatalog());
    return source;
  }
  #resolveNativeClient(attemptId: string): SyntxChatHttpClient {
    let client: unknown;
    try { client = Reflect.apply(this.#resolveClient, undefined, [attemptId]); }
    catch { fail("MODEL_BINDING_MISMATCH"); }
    const methods: readonly [string, Function][] = [["createChat", CHAT_CREATE], ["uploadWan30OmniImage", IMAGE_UPLOAD],
      ["generateWan30OmniVideo", VIDEO_GENERATE], ["listWanT2vMessageCandidates", HISTORY_GET],
      ["getWanT2vVideoResultMessage", RESULT_GET], ["listInProgress", IN_PROGRESS_GET]];
    if (!isExactInstance<SyntxChatHttpClient>(client, SyntxChatHttpClient) || methods.some(([key, method]) =>
      Object.hasOwn(client, key) || Object.getOwnPropertyDescriptor(SyntxChatHttpClient.prototype, key)?.value !== method ||
      Reflect.get(client, key) !== method)) fail("MODEL_BINDING_MISMATCH");
    if (OWNER_ACK_BIND && (Object.hasOwn(client, "getWan30OmniOwnerAckBinding") ||
        Object.getOwnPropertyDescriptor(SyntxChatHttpClient.prototype, "getWan30OmniOwnerAckBinding")?.value !== OWNER_ACK_BIND ||
        Reflect.get(client, "getWan30OmniOwnerAckBinding") !== OWNER_ACK_BIND)) fail("MODEL_BINDING_MISMATCH");
    return client;
  }
  async #resolvePrincipal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    this.#assertOpen();
    if (this.#invalidating.has(attemptId)) fail("PRINCIPAL_NOT_LINKED");
    try { return await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService }); }
    catch { fail("PRINCIPAL_NOT_LINKED"); }
  }
  #getImageRecord(handle: string): ImageRecord {
    if (!IMAGE_HANDLE.test(handle)) invalid();
    const image = this.#images.get(handle);
    if (!image) fail("REFERENCE_UNAVAILABLE");
    return image;
  }
  #liveImage(image: ImageRecord, attemptId: string, principal: Readonly<GenerationPrincipalRef>, client: SyntxChatHttpClient): boolean {
    return this.#images.get(image.image_handle) === image && !image.retained_recovery && !image.consumed &&
      image.expires_at > this.#readNow() && image.attemptId === attemptId && image.client === client &&
      sameGenerationPrincipal(image.principal, principal) && image.profile_id === PROFILE_ID &&
      samePins(image.source_pins, getOwnerWan30OmniGenerationSourceContract().source_pins) &&
      image.image.model_id === MODEL_ID && image.image.reference_type === "image";
  }
  #assertImageBinding(image: ImageRecord, attemptId: string, principal: Readonly<GenerationPrincipalRef>, client: SyntxChatHttpClient): void {
    if (this.#images.get(image.image_handle) !== image || image.attemptId !== attemptId || image.client !== client ||
        !sameGenerationPrincipal(image.principal, principal) || image.profile_id !== PROFILE_ID ||
        !samePins(image.source_pins, getOwnerWan30OmniGenerationSourceContract().source_pins) ||
        image.image.model_id !== MODEL_ID || image.image.reference_type !== "image") fail("REFERENCE_UNAVAILABLE");
  }
  #assertImage(request: Readonly<OwnerWan30OmniGenerateInput>, image: ImageRecord,
    principal: Readonly<GenerationPrincipalRef>, client: SyntxChatHttpClient): void {
    this.#assertImageBinding(image, request.attemptId, principal, client);
    if (image.retained_recovery || image.consumed) fail("REFERENCE_UNAVAILABLE");
    if (image.expires_at <= this.#readNow()) { this.#releaseImage(image); fail("REFERENCE_EXPIRED"); }
  }
  async #assertOwnerAndImage(request: Readonly<OwnerWan30OmniGenerateInput>, image: ImageRecord,
    principal: Readonly<GenerationPrincipalRef>, client: SyntxChatHttpClient, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted();
    const current = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
    if (!sameGenerationPrincipal(principal, current) || this.#resolveNativeClient(request.attemptId) !== client || this.#invalidating.has(request.attemptId)) {
      fail("PRINCIPAL_NOT_LINKED");
    }
    this.#assertImage(request, image, current, client);
  }
  #releaseImage(image: ImageRecord): void {
    releaseOwnerWan30OmniUploadedImage(image.client, image.image);
    this.#images.delete(image.image_handle);
    if (this.#imageBySemantic.get(image.semantic_key) === image.image_handle) this.#imageBySemantic.delete(image.semantic_key);
  }
  #releaseImageForRecovery(recovery: Recovery): void {
    for (const image of this.#images.values()) if (image.attemptId === recovery.attemptId && image.client === recovery.client &&
      image.image.sha256 === recovery.image_sha256) image.consumed = true;
  }
  #clearAttempt(attemptId: string): void {
    for (const image of this.#images.values()) if (image.attemptId === attemptId) this.#releaseImage(image);
    for (const [id, recovery] of this.#recoveries) if (recovery.attemptId === attemptId) {
      releaseOwnerWan30OmniGenerationContext(recovery.client, recovery.context); this.#recoveries.delete(id);
    }
    for (const [key, claim] of this.#claims) if (claim.attemptId === attemptId) this.#claims.delete(key);
    for (const [key, owner] of this.#unknownUploads) if (owner === attemptId) this.#unknownUploads.delete(key);
    for (const [key, owner] of this.#pendingUploads) if (owner === attemptId) this.#pendingUploads.delete(key);
  }
  #prune(now: number): void {
    for (const image of this.#images.values()) if (!image.retained_recovery && !image.consumed && image.expires_at <= now) this.#releaseImage(image);
  }
  #epoch(attemptId: string): number { return this.#epochs.get(attemptId) ?? 0; }
  #begin(attemptId: string, external?: AbortSignal): ActiveRun {
    this.#assertOpen();
    if (this.#invalidating.has(attemptId) || this.#runs.size >= 8) fail("SERVICE_BUSY");
    if (external !== undefined && (!(external instanceof AbortSignal) || types.isProxy(external))) invalid();
    const controller = new AbortController(), abort = () => controller.abort();
    if (external?.aborted) controller.abort(); else external?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, this.#timeoutMs); let finish!: () => void;
    const promise = new Promise<void>((resolve) => { finish = resolve; });
    const run: ActiveRun = { attemptId, controller, promise, timer, finish,
      removeExternal: () => external?.removeEventListener("abort", abort) };
    this.#runs.add(run); return run;
  }
  #finish(run: ActiveRun): void { clearTimeout(run.timer); run.removeExternal(); this.#runs.delete(run); run.finish(); }
  async #run<T>(attemptId: string, external: AbortSignal | undefined, work: (deadline: AbsoluteRequestDeadline) => Promise<T>): Promise<T> {
    const run = this.#begin(attemptId, external);
    const deadline = new AbsoluteRequestDeadline(this.#timeoutMs, run.controller.signal, () => serviceError("PRE_DISPATCH_FAILED"));
    return await Promise.resolve().then(() => work(deadline)).finally(() => { deadline.close(); this.#finish(run); });
  }
  async #await<T>(deadline: AbsoluteRequestDeadline, action: () => Promise<T> | T): Promise<T> {
    deadline.throwIfAborted(); return deadline.waitFor(Promise.resolve().then(action));
  }
  async #wait(deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted(); await deadline.waitFor(new Promise<void>((resolve) => setTimeout(resolve, POLL_DELAY_MS)));
  }
  #readNow(): number {
    let value: unknown; try { value = Reflect.apply(this.#now, undefined, []); } catch { fail("PRE_DISPATCH_FAILED"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) < this.#lastNow) fail("PRE_DISPATCH_FAILED");
    this.#lastNow = value as number; return this.#lastNow;
  }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
}

export function createOwnerWan30OmniGenerationService(options: OwnerWan30OmniGenerationServiceOptions | unknown): OwnerWan30OmniGenerationService {
  return new OwnerWan30OmniGenerationService(options);
}
export function isOwnerWan30OmniGenerationService(value: unknown): value is OwnerWan30OmniGenerationService {
  return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) &&
    Object.getPrototypeOf(value) === OwnerWan30OmniGenerationService.prototype && Reflect.ownKeys(value).length === 0 && Object.isFrozen(value);
}

function snapshotUpload(input: unknown, signal?: AbortSignal): Readonly<UploadSnapshot> {
  if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) invalid();
  const row = exact(input, ["attemptId", "content_base64", "filename", "mime_type"]);
  const attemptId = safeAttempt(row.attemptId);
  if (typeof row.content_base64 !== "string" || !row.content_base64 || row.content_base64.length > MAX_BASE64_CHARS ||
      row.content_base64.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(row.content_base64) ||
      typeof row.filename !== "string" || typeof row.mime_type !== "string") invalid();
  const bytes = Buffer.from(row.content_base64, "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64") !== row.content_base64) { bytes.fill(0); invalid(); }
  return Object.freeze({ attemptId, filename: row.filename, mime_type: row.mime_type, bytes });
}

function snapshotGenerate(input: unknown, signal?: AbortSignal): Readonly<OwnerWan30OmniGenerateInput> {
  if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) invalid();
  const row = exact(input, ["attemptId", "input", "image_handle"]);
  const attemptId = safeAttempt(row.attemptId);
  const intentFields = exact(row.input, ["model_id", "prompt", "parameters"]);
  if (intentFields.model_id !== MODEL_ID || typeof row.image_handle !== "string" || !IMAGE_HANDLE.test(row.image_handle)) invalid();
  const normalized = normalizeOwnerWan30OmniGenerationIntent({ prompt: intentFields.prompt, parameters: intentFields.parameters });
  return Object.freeze({ attemptId, input: normalized.intent, image_handle: row.image_handle });
}

function snapshotRecovery(input: unknown, signal?: AbortSignal): Readonly<OwnerWan30OmniReconcileInput> {
  if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) invalid();
  const row = exact(input, ["attemptId", "recovery_id"]);
  return Object.freeze({ attemptId: safeAttempt(row.attemptId), recovery_id: safeRecovery(row.recovery_id) });
}
function snapshotRecoveryList(input: unknown): Readonly<{ attemptId: string; limit: number }> {
  const row = exact(input, ["attemptId"], ["limit"]);
  return Object.freeze({ attemptId: safeAttempt(row.attemptId), limit: bounded(row.limit, 1, 128, 32) });
}
function snapshotResultPage(input: unknown, signal?: AbortSignal): Readonly<{ attemptId: string; recovery_id: string; offset: number }> {
  if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) invalid();
  const row = exact(input, ["attemptId", "recovery_id"], ["offset"]);
  return Object.freeze({ attemptId: safeAttempt(row.attemptId), recovery_id: safeRecovery(row.recovery_id), offset: bounded(row.offset, 0, 4096, 0) });
}

function semanticUploadKey(attemptId: string, principal: Readonly<GenerationPrincipalRef>, image: OwnerWan30OmniValidatedImage,
  source: ReturnType<typeof getOwnerWan30OmniGenerationSourceContract>): string {
  return createHash("sha256").update(JSON.stringify({ attemptId, tenant_id: principal.tenant_id, subject_id: principal.subject_id,
    profile_id: source.profile_id, source_pins: source.source_pins, sha256: image.sha256, size: image.size, mime_type: image.mime_type })).digest("hex");
}
function semanticGenerationKey(principal: Readonly<GenerationPrincipalRef>, intent: OwnerWan30OmniGenerationIntent,
  image: ImageRecord, source: ReturnType<typeof getOwnerWan30OmniGenerationSourceContract>): string {
  return createHash("sha256").update(JSON.stringify({ tenant_id: principal.tenant_id, subject_id: principal.subject_id,
    profile_id: source.profile_id, source_pins: source.source_pins, intent, reference_sha256: image.image.sha256 })).digest("hex");
}
function uploadReceipt(record: ImageRecord, now: number): OwnerWan30OmniImageUploadReceipt {
  return Object.freeze({ status: "uploaded", image_handle: record.image_handle, model_id: MODEL_ID,
    mime_type: record.image.mime_type, size: record.image.size, sha256: record.image.sha256,
    width: record.image.width, height: record.image.height,
    expires_in_seconds: Math.max(0, Math.ceil((record.expires_at - now) / 1000)),
    metadata_confidence: "LOCAL_STRUCTURAL_METADATA_ONLY",
    upload_binding_confidence: "IMPLEMENTATION_INFERENCE_NOT_UI_MULTIPART_OBSERVED" });
}
function createRecovery(input: { attemptId: string; principal: Readonly<GenerationPrincipalRef>; intent: OwnerWan30OmniGenerationIntent;
  semanticKey: string; chatUuid: string; createdAt: number; sourcePins: object; imageHash: string;
  context: OwnerWan30OmniGenerationContext; client: SyntxChatHttpClient }): Recovery {
  return { recovery_id: `wan_omni_recovery_${randomUUID()}`, attemptId: input.attemptId, principal: input.principal,
    intent: input.intent, semantic_key: input.semanticKey, chat_uuid: input.chatUuid,
    created_at: new Date(input.createdAt).toISOString(), source_pins: input.sourcePins, image_sha256: input.imageHash,
    context: input.context, client: input.client, owner_echo_message_id: null, status: "outcome_unknown",
    artifacts: Object.freeze([]), diagnostic: { phase: "GENERATION_POST", post_started: false, ack_known: false,
      history_status: "NOT_READ", history_reason: null, history_get_calls: 0, result_get_calls: 0,
      inprogress_get_calls: 0, result_status: "NOT_READ", result_reason: null } };
}

function bindHistory(input: unknown, recovery: Recovery):
  | { status: "BOUND"; owner_echo_message_id: string; botMessages: readonly ChatMessageHistoryCandidate[] }
  | { status: "PENDING"; owner_echo_message_id: string; reason: "BOT_RESULT_MISSING" }
  | { status: "INVALID"; reason: OwnerWanT2vGenerationDiagnostic["history_reason"] & string } {
  try {
    const snapshot = exact(input, ["complete", "page", "page_size", "total_count", "total_pages", "has_next", "has_previous",
      "requested_chat_uuid", "provider_chat_id", "messages"]);
    if (snapshot.complete !== true || snapshot.page !== 1 || snapshot.page_size !== HISTORY_PAGE_SIZE || snapshot.has_next !== false ||
        snapshot.has_previous !== false || snapshot.requested_chat_uuid !== recovery.chat_uuid || typeof snapshot.provider_chat_id !== "string" ||
        !/^\d{1,16}$/u.test(snapshot.provider_chat_id) || !Array.isArray(snapshot.messages)) return { status: "INVALID", reason: "HISTORY_INCOMPLETE" };
    const messages = snapshot.messages as unknown[];
    if (!Number.isSafeInteger(snapshot.total_count) || snapshot.total_count !== messages.length || (snapshot.total_count as number) < 1 ||
        (snapshot.total_count as number) > HISTORY_LIMIT || snapshot.total_pages !== Math.ceil((snapshot.total_count as number) / HISTORY_PAGE_SIZE)) {
      return { status: "INVALID", reason: "HISTORY_INCOMPLETE" };
    }
    let owner: ChatMessageHistoryCandidate | undefined, ownerIndex = -1;
    const possibleOwners: Array<{ index: number; row: ChatMessageHistoryCandidate; shape: boolean }> = [];
    const bots: Array<{ index: number; row: ChatMessageHistoryCandidate }> = [];
    const messageIds = new Set<string>(), objectIds = new Set<string>();
    for (let index = 0; index < messages.length; index += 1) {
      const message = exact(messages[index], ["message_id", "provider_chat_id", "author_role", "objects"]);
      if (!safeId(message.message_id) || message.provider_chat_id !== snapshot.provider_chat_id || !Array.isArray(message.objects) ||
          message.objects.length > 64 || !["owner", "bot", "other"].includes(String(message.author_role)) || messageIds.has(message.message_id)) {
        return { status: "INVALID", reason: "HISTORY_SHAPE_INVALID" };
      }
      messageIds.add(message.message_id);
      if (message.author_role === "owner") {
        if (owner || !recovery.owner_echo_message_id || message.message_id !== recovery.owner_echo_message_id || message.objects.length !== 2) {
          return { status: "INVALID", reason: "OWNER_ACK_MISMATCH" };
        }
        ownerIndex = index;
      }
      const parsed: Array<{ message_object_id: string; object_type: string; model_type: string | null }> = [];
      let ackShape = message.objects.length === 2;
      const ackObjectTypes: string[] = [];
      for (let objectIndex = 0; objectIndex < message.objects.length; objectIndex += 1) {
        const object = exact(message.objects[objectIndex], ["message_object_id", "object_type", "model_type"]);
        const isCandidateOther = recovery.owner_echo_message_id === null && message.author_role === "other";
        if (!safeId(object.message_object_id) || objectIds.has(object.message_object_id) ||
            (!isCandidateOther && message.author_role !== "other" && message.author_role !== "owner" &&
              (object.object_type !== "video" || object.model_type !== MODEL_ID)) ||
            (message.author_role === "other" && recovery.owner_echo_message_id !== null &&
              (object.object_type !== "video" || object.model_type !== MODEL_ID)) ||
            (message.author_role === "owner" && ((object.object_type !== "text" && object.object_type !== "image") || object.model_type !== MODEL_ID))) {
          return { status: "INVALID", reason: "RESULT_OBJECT_TYPE_MISMATCH" };
        }
        if (isCandidateOther) {
          if ((object.object_type !== "text" && object.object_type !== "image") || object.model_type !== MODEL_ID) ackShape = false;
          ackObjectTypes.push(object.object_type);
        }
        if (message.author_role === "owner") ackObjectTypes.push(object.object_type);
        objectIds.add(object.message_object_id);
        parsed.push({ message_object_id: object.message_object_id, object_type: object.object_type, model_type: object.model_type });
      }
      if ((message.author_role === "owner" || recovery.owner_echo_message_id === null && message.author_role === "other") &&
          (ackObjectTypes.length !== 2 || ackObjectTypes.filter((type) => type === "text").length !== 1 ||
            ackObjectTypes.filter((type) => type === "image").length !== 1)) {
        if (message.author_role === "owner") return { status: "INVALID", reason: "RESULT_OBJECT_TYPE_MISMATCH" };
        ackShape = false;
      }
      const candidate: ChatMessageHistoryCandidate = Object.freeze({ message_id: message.message_id,
        provider_chat_id: message.provider_chat_id, author_role: message.author_role as "owner" | "bot" | "other",
        objects: Object.freeze(parsed) });
      if (message.author_role === "owner") owner = candidate;
      else if (message.author_role === "other") {
        if (recovery.owner_echo_message_id !== null) return { status: "INVALID", reason: "OTHER_AUTHOR_PRESENT" };
        possibleOwners.push({ index, row: candidate, shape: ackShape });
      } else if (parsed.length) bots.push({ index, row: candidate });
    }
    let ownerId: string;
    if (recovery.owner_echo_message_id === null) {
      if (possibleOwners.length !== 1) return { status: "INVALID", reason: possibleOwners.length ? "OWNER_ACK_AMBIGUOUS" : "OWNER_ACK_MISSING" };
      const selected = possibleOwners[0]!;
      if (!selected.shape) return { status: "INVALID", reason: "OWNER_ACK_MISMATCH" };
      ownerIndex = selected.index; ownerId = selected.row.message_id;
    } else {
      if (!owner) return { status: "INVALID", reason: "OWNER_ACK_MISSING" };
      ownerId = owner.message_id;
    }
    if (bots.some((bot) => bot.index < ownerIndex)) return { status: "INVALID", reason: "OWNER_ACK_MISMATCH" };
    const botMessages = bots.filter((bot) => bot.index > ownerIndex).map((bot) => bot.row);
    return botMessages.length ? { status: "BOUND", owner_echo_message_id: ownerId, botMessages: Object.freeze(botMessages) } :
      { status: "PENDING", owner_echo_message_id: ownerId, reason: "BOT_RESULT_MISSING" };
  } catch { return { status: "INVALID", reason: "HISTORY_SHAPE_INVALID" }; }
}

function page(recovery: Recovery, offset: number): OwnerWan30OmniGenerationResult {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > recovery.artifacts.length) invalid();
  const artifacts = Object.freeze(recovery.artifacts.slice(offset, offset + PAGE_SIZE)), next = offset + artifacts.length;
  return Object.freeze({ status: recovery.status as "completed" | "partial_results", status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY",
    backend_acceptance: "UNPROVEN", provider_terminal_status: "UNPROVEN", model_id: MODEL_ID, parameters: recovery.intent.parameters,
    cost_inputs: COST_INPUTS, cost_input_confidence: "UI_QUOTE_CALLER_OBSERVED_SINGLE_TUPLE_NOT_BILLING",
    recovery_id: recovery.recovery_id, observed_artifact_count: recovery.artifacts.length, offset, page_size: PAGE_SIZE, artifacts,
    has_more: next < recovery.artifacts.length, next_offset: next < recovery.artifacts.length ? next : null,
    diagnostic: freezeDiagnostic(recovery.diagnostic) });
}

function freezeDiagnostic(diagnostic: MutableDiagnostic): OwnerWan30OmniGenerationDiagnostic { return Object.freeze({ ...diagnostic }); }
function unknown(recovery: Recovery): OwnerWan30OmniGenerationServiceError {
  return new OwnerWan30OmniGenerationServiceError("OUTCOME_UNKNOWN", recovery.recovery_id, freezeDiagnostic(recovery.diagnostic));
}
function serviceError(code: OwnerWan30OmniGenerationServiceErrorCode): OwnerWan30OmniGenerationServiceError { return new OwnerWan30OmniGenerationServiceError(code); }
function invalid(): never { throw serviceError("INVALID_REQUEST"); }
function fail(code: OwnerWan30OmniGenerationServiceErrorCode): never { throw serviceError(code); }

function validAck(value: unknown, chatUuid: string): value is MediaGenerationReceipt {
  try { const fields = exact(value, ["chat_uuid", "message_id"]); return fields.chat_uuid === chatUuid && safeId(fields.message_id); }
  catch { return false; }
}
function validUploaded(value: unknown, receipt: OwnerWan30OmniValidatedImage): value is OwnerWan30OmniUploadedImage {
  try {
    const fields = exact(value, ["status", "model_id", "reference_type", "mime_type", "size", "sha256", "width", "height",
      "upload_profile_confidence", "owner_upload_binding"]);
    return Object.isFrozen(value) && fields.status === "uploaded" && fields.model_id === MODEL_ID && fields.reference_type === "image" &&
      fields.mime_type === receipt.mime_type && fields.size === receipt.size && fields.sha256 === receipt.sha256 &&
      fields.width === receipt.width && fields.height === receipt.height &&
      fields.upload_profile_confidence === "OWNER_IMPLEMENTATION_INFERENCE_NOT_UI_MULTIPART_OBSERVED" &&
      fields.owner_upload_binding === "SAME_CLIENT_NATIVE_UPLOAD";
  } catch { return false; }
}

function freshPreflight(accountInput: unknown, accessInput: unknown, catalog: DiscoveryCatalogRepository, now: number): boolean {
  try {
    const account = exact(accountInput, ["balance", "subscription", "contract_evidence", "source_build", "observed_at"]);
    const balance = exact(account.balance, ["unit", "available"]);
    const subscription = exact(account.subscription, ["active", "plan_type", "end_date", "end_date_kind"]);
    const access = exact(accessInput, ["catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live",
      "parameter_keys", "parameters_redacted", "access", "cost", "discount_cost", "free_remaining_generations", "limit", "show_warning", "observed_at"]);
    const expectedVersion = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
    const keys = denseStrings(access.parameter_keys).sort(), expectedKeys = Object.keys(COST_INPUTS).sort();
    if (account.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || account.source_build !== ACCOUNT_SOURCE_BUILD ||
        balance.unit !== "tokens" || typeof balance.available !== "string" || !decimalParts(balance.available) ||
        !validSubscription(subscription, now) || !freshIso(account.observed_at, now) ||
        access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || access.catalog_version !== expectedVersion ||
        access.model_id !== MODEL_ID || access.model_type !== MODEL_ID || access.ai_name !== "wan_video" ||
        access.account_read_live !== true || access.parameters_redacted !== true || access.access !== true ||
        keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index]) || !freshIso(access.observed_at, now) ||
        !nullableFinite(access.cost) || !nullableFinite(access.discount_cost) ||
        !(access.free_remaining_generations === null || nonnegativeInt(access.free_remaining_generations)) ||
        !(access.limit === null || (typeof access.limit === "number" && Number.isFinite(access.limit) && access.limit >= 0)) ||
        !(access.show_warning === null || typeof access.show_warning === "boolean")) return false;
    const quote = typeof access.discount_cost === "number" ? access.discount_cost : access.cost;
    return typeof quote === "number" && quote >= 0 && decimalLess(String(quote), balance.available);
  } catch { return false; }
}
function validSubscription(value: Record<string, unknown>, now: number): boolean {
  if (value.active !== true || !(value.plan_type === null || (typeof value.plan_type === "string" && value.plan_type.trim()))) return false;
  if (value.end_date === null) return value.end_date_kind === null;
  if (typeof value.end_date !== "string" || value.end_date_kind !== "OFFSET_DATETIME" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value.end_date)) return false;
  const expires = Date.parse(value.end_date); return Number.isFinite(expires) && expires > now;
}
function freshIso(value: unknown, now: number): boolean {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= now + MAX_CLOCK_SKEW_MS && now - time <= PREFLIGHT_FRESH_MS && new Date(time).toISOString() === value;
}
function decimalParts(value: unknown): { digits: bigint; scale: number } | null {
  if (typeof value !== "string") return null;
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
function decimalLess(left: string, right: string): boolean {
  const a = decimalParts(left), b = decimalParts(right); if (!a || !b) return false;
  const scale = Math.max(a.scale, b.scale);
  return a.digits * 10n ** BigInt(scale - a.scale) < b.digits * 10n ** BigInt(scale - b.scale);
}
function nullableFinite(value: unknown): boolean { return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0); }
function nonnegativeInt(value: unknown): boolean { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function denseStrings(value: unknown): string[] {
  if (!Array.isArray(value) || types.isProxy(value) || value.length > 32) fail("PREFLIGHT_FAILED");
  const output: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") fail("PREFLIGHT_FAILED");
    output.push(descriptor.value);
  }
  return output;
}

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const row = exact(value, ["tenant_id", "subject"]);
  if (typeof row.tenant_id !== "string" || !row.tenant_id.trim() || row.tenant_id.length > 256 ||
      typeof row.subject !== "string" || !row.subject.trim() || row.subject.length > 512 ||
      /[\u0000-\u001f\u007f]/u.test(row.tenant_id) || /[\u0000-\u001f\u007f]/u.test(row.subject)) invalid();
  return Object.freeze({ tenant_id: row.tenant_id, subject: row.subject });
}
function snapshotLinkService(value: unknown): Pick<PerUserLinkService, "getStatus"> {
  if (!isExactService<Pick<PerUserLinkService, "getStatus">>(value, PerUserLinkService, ["getStatus"])) invalid();
  return value as Pick<PerUserLinkService, "getStatus">;
}
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !keys.includes(key)) ||
        keys.some((key) => typeof key !== "string" || (!required.includes(key) && !optional.includes(key)) ||
          !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
    const output = Object.create(null) as Record<string, any>;
    for (const key of keys as string[]) output[key] = descriptors[key]!.value;
    return output;
  } catch { return invalid(); }
}
function clockFactory(value: unknown): () => number { if (value === undefined) return Date.now; if (typeof value !== "function" || types.isProxy(value)) invalid(); return value as () => number; }
function bounded(value: unknown, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) invalid();
  return value as number;
}
function safeAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) invalid(); return value; }
function safeRecovery(value: unknown): string { if (typeof value !== "string" || !RECOVERY_ID.test(value)) invalid(); return value; }
function safeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function sameStrings(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}
function samePins(left: object, right: object): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function isExactInstance<T extends object>(value: unknown, ctor: { prototype: object }): value is T {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === ctor.prototype;
}
function isExactService<T extends object>(value: unknown, ctor: { prototype: object }, methods: readonly string[]): value is T {
  return isExactInstance<T>(value, ctor) && methods.every((key) => { const descriptor = Object.getOwnPropertyDescriptor(ctor.prototype, key);
    return !!descriptor && "value" in descriptor && !Object.hasOwn(value, key) && Reflect.get(value, key) === descriptor.value; });
}
