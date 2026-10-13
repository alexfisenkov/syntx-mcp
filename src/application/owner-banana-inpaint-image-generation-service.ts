import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { resolveOwnerReferencePrincipal, OwnerReferencePrincipalError } from "../auth/owner-reference-principal.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { types } from "node:util";
import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../catalog/public-catalog-history.js";
import { loadMaplessSettingsInventoryVersion, type MaplessSettingsInventory } from "../catalog/mapless-settings-inventory.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { SyntxChatHttpClient, type MediaGenerationReceipt, type OwnerBananaInpaintImageResultCandidates,
  type OwnerBananaInpaintImageResultMessageContext } from "../adapter/syntx/chat-http-client.js";
import { OwnerBananaInpaintOriginalReferenceService } from "./owner-banana-inpaint-original-reference-service.js";
import { OwnerBananaInpaintPaintedCompositeReferenceService } from "./owner-banana-inpaint-painted-composite-reference-service.js";
import { OwnerBananaInpaintAuxiliaryReferenceService } from "./owner-banana-inpaint-auxiliary-reference-service.js";
import { createOwnerBananaInpaintImageRequestPreparer,
  type OwnerBananaInpaintImageRequestPreparer, type OwnerBananaInpaintImagePreparedCandidate,
  type OwnerBananaInpaintImageCandidateBinding }
  from "./owner-banana-inpaint-image-request-preparer.js";
import { createOwnerBananaInpaintImageOneShotPermit } from "./owner-banana-inpaint-image-one-shot-policy.js";
import { OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
  OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS, getOwnerBananaInpaintOriginalUploadSourceProfile }
  from "./owner-banana-inpaint-original-upload-source-profile.js";
import { getOwnerBananaInpaintPaintedCompositeSourceProfile } from "./owner-banana-inpaint-painted-composite-source-profile.js";
import { getOwnerBananaInpaintAuxiliarySourceProfile } from "./owner-banana-inpaint-auxiliary-source-profile.js";
import { getOwnerBananaInpaintImageSourceProfile, normalizeOwnerBananaInpaintPrompt } from "./owner-banana-inpaint-image-source-profile.js";
import { getOwnerBananaInpaintSourceParameters, projectOwnerBananaInpaintCostParameters,
  normalizeOwnerBananaInpaintParameters } from "./owner-banana-inpaint-parameters.js";
import { AccountStatusService, type AccountStatusResult } from "./account-status.js";
import { ModelAccessService, type ModelAccessResult } from "./model-access.js";
import type { OwnerBananaInpaintImageVariant } from "./owner-banana-inpaint-image-source-profile.js";
import type { OwnerBananaInpaintImageResult } from "../adapter/syntx/owner-banana-inpaint-image-result.js";

export type OwnerBananaInpaintImageGenerationPhase = typeof OWNER_BANANA_INPAINT_IMAGE_GENERATION_PHASES[number];
export const OWNER_BANANA_INPAINT_IMAGE_GENERATION_PHASES = Object.freeze([
  "REQUEST_PREPARE", "PRINCIPAL", "REFERENCE_BINDING", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST",
  "POST_ACK_KNOWN", "HISTORY_GET", "HISTORY_BINDING", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"
] as const);

export interface OwnerBananaInpaintImageGenerateInput {
  readonly attemptId: string;
  readonly variant: OwnerBananaInpaintImageVariant;
  readonly prompt: string;
  readonly image_size: string | null;
  readonly original_handle: string;
  readonly painted_handle: string;
  readonly auxiliary_reference_handle: string | null;
}
export interface OwnerBananaInpaintImageReconcileInput { readonly attemptId: string; readonly recovery_id: string }
export interface OwnerBananaInpaintImageRecoveryListInput { readonly attemptId: string; readonly limit?: number }
export interface OwnerBananaInpaintImageResultPageInput {
  readonly attemptId: string;
  readonly result_id: string;
  readonly offset: number;
  readonly limit: number;
}

export interface OwnerBananaInpaintImageGenerationArtifact {
  readonly url: string;
  readonly mime_type: null;
  readonly width: null;
  readonly height: null;
  readonly geometry_verified: false;
  readonly message_id: string;
  readonly object_index: number;
}
export interface OwnerBananaInpaintImageGenerationResult {
  readonly status: "result_observed" | "partial_results";
  readonly backend_acceptance: "UNPROVEN";
  readonly provider_execution: false;
  readonly attempt_id: string;
  readonly variant: OwnerBananaInpaintImageVariant;
  readonly ai_name: "banana";
  readonly model_type: OwnerBananaInpaintImageVariant;
  readonly cost_inputs: Readonly<Record<string, string>>;
  readonly cost_input_confidence: "SOURCE_JOINED_COST2_QUERY_KEYS_NOT_QUOTE_BILLING_OR_HARDCAP";
  readonly profile_schema_hash: string;
  readonly request_fingerprint: string;
  readonly result_id: string;
  readonly observed_total: number;
  readonly next_offset: number | null;
  readonly has_more: boolean;
  readonly artifacts: readonly Readonly<OwnerBananaInpaintImageGenerationArtifact>[];
  readonly diagnostics: readonly string[];
  readonly recovery_id?: string;
}
export interface OwnerBananaInpaintImageResultPage {
  readonly result_id: string;
  readonly offset: number;
  readonly limit: number;
  readonly observed_total: number;
  readonly next_offset: number | null;
  readonly has_more: boolean;
  readonly artifacts: readonly Readonly<OwnerBananaInpaintImageGenerationArtifact>[];
}
export interface OwnerBananaInpaintImageRecoveryListItem {
  readonly recovery_id: string;
  readonly created_at: string;
  readonly variant: OwnerBananaInpaintImageVariant;
  readonly status: "OUTCOME_UNKNOWN";
  readonly phase: OwnerBananaInpaintImageGenerationPhase;
}
export type OwnerBananaInpaintImageGenerationPreflightInput = Readonly<{
  attemptId: string; principal: Readonly<GenerationPrincipalRef>; variant: OwnerBananaInpaintImageVariant;
  catalog_version: string; cost_inputs: Readonly<Record<string, string>>; request_fingerprint: string; signal?: AbortSignal;
}>;
export type OwnerBananaInpaintImageGenerationPreflight = (input: OwnerBananaInpaintImageGenerationPreflightInput) => Promise<{
  account: AccountStatusResult; model_access: ModelAccessResult;
}>;
export const OWNER_BANANA_INPAINT_IMAGE_GENERATION_ERROR_CODES = Object.freeze([
  "INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "MODEL_BINDING_MISMATCH", "PRINCIPAL_NOT_LINKED",
  "PREFLIGHT_FAILED", "INTENT_ALREADY_CLAIMED", "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND",
  "RESULT_NOT_FOUND", "RESULT_PAGE_INVALID", "CLOCK_INVALID"
] as const);
export type OwnerBananaInpaintImageGenerationErrorCode = typeof OWNER_BANANA_INPAINT_IMAGE_GENERATION_ERROR_CODES[number];
export type OwnerBananaInpaintImageGenerationServiceErrorCode = OwnerBananaInpaintImageGenerationErrorCode;
export class OwnerBananaInpaintImageGenerationServiceError extends Error {
  constructor(readonly code: OwnerBananaInpaintImageGenerationErrorCode, readonly recovery_id?: string,
    readonly diagnostic?: readonly string[]) {
    super(code === "OUTCOME_UNKNOWN" ? "The Banana Inpaint outcome is unknown; reconcile the recovery and do not retry." :
      "The Banana Inpaint generation request could not be completed safely.");
    this.name = "OwnerBananaInpaintImageGenerationServiceError";
  }
}

export interface OwnerBananaInpaintImageGenerationServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly originalReferenceService: unknown;
  readonly paintedCompositeReferenceService: unknown;
  readonly auxiliaryReferenceService: unknown;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly createAccountStatusService: (attemptId: string) => AccountStatusService;
  readonly createModelAccessService: (attemptId: string, catalog: DiscoveryCatalogRepository) => ModelAccessService;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly pollDelayMs?: number;
  readonly maxPollAttempts?: number;
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export interface OwnerBananaInpaintImageGenerationService {
  generate(input: OwnerBananaInpaintImageGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerBananaInpaintImageGenerationResult>;
  reconcile(input: OwnerBananaInpaintImageReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerBananaInpaintImageGenerationResult>;
  listRecoveries(input: OwnerBananaInpaintImageRecoveryListInput | unknown): Promise<readonly OwnerBananaInpaintImageRecoveryListItem[]>;
  getResultPage(input: OwnerBananaInpaintImageResultPageInput | unknown, signal?: AbortSignal): Promise<OwnerBananaInpaintImageResultPage>;
  invalidateAttempt(attemptId: string): Promise<void>;
  close(): Promise<void>;
}

export function createOwnerBananaInpaintImageGenerationService(
  options: OwnerBananaInpaintImageGenerationServiceOptions | unknown
): OwnerBananaInpaintImageGenerationService {
  return new OwnerBananaInpaintImageGenerationServiceImpl(options);
}
export function isOwnerBananaInpaintImageGenerationService(value: unknown): value is OwnerBananaInpaintImageGenerationService {
  return Boolean(value && typeof value === "object" && ownedServices.has(value));
}

// Keeps the result schema directly visible to downstream service consumers.
export type OwnerBananaInpaintDecodedImageResult = OwnerBananaInpaintImageResult;

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const MAX_RUNS = 4;
const MAX_STATE = 128;
const MAX_RECOVERIES = 64;
const MAX_RESULT_RECORDS = 128;
const MAX_OBSERVED_ARTIFACTS = 256 * 64 * 32;
const RESULT_PAGE_SIZE = 64;
const RESULT_ID = /^banana_inpaint_result_[0-9a-f-]{36}$/u;
const DEFAULT_POLL_DELAY = 2_000;
const MAX_POLL_DELAY = 15_000;
const DEFAULT_POLL_ATTEMPTS = 8;
const MAX_POLL_ATTEMPTS = 32;
const MAX_TIMEOUT = 180_000;
const RECOVERY_TTL_MS = 15 * 60_000;
const ACCOUNT = AccountStatusService.prototype.getAccountStatus;
const ACCESS = ModelAccessService.prototype.getModelAccess;
const START = SyntxChatHttpClient.prototype.startBananaInpaintImageWithOwnedCandidate;
const LIST = SyntxChatHttpClient.prototype.listBananaInpaintImageResultCandidates;
const GET_RESULT = SyntxChatHttpClient.prototype.getBananaInpaintImageResult;
const CREATE_CHAT = SyntxChatHttpClient.prototype.createImageInpaintChat;
type Recovery = {
  readonly id: string; readonly created_at: string; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly epoch: number; readonly intent_key: string; readonly request_fingerprint: string; readonly variant: OwnerBananaInpaintImageVariant;
  readonly preparer: OwnerBananaInpaintImageRequestPreparer; readonly candidate: OwnerBananaInpaintImagePreparedCandidate;
  readonly chat_uuid: string; readonly client: SyntxChatHttpClient; ack_message_id: string | null; expires_at: number | null;
  post_dispatch_witness: Readonly<{
    attempt_id: string; principal: Readonly<GenerationPrincipalRef>; epoch: number; intent_key: string;
    variant: OwnerBananaInpaintImageVariant; profile_schema_hash: string; request_fingerprint: string;
    candidate_binding: Readonly<OwnerBananaInpaintImageCandidateBinding>; chat_uuid: string;
  }> | null;
  readonly cost_inputs: Readonly<Record<string, string>>;
  result_id?: string;
  phase: OwnerBananaInpaintImageGenerationPhase; diagnostic: readonly string[];
};
type ResultRecord = {
  readonly result_id: string; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly epoch: number; readonly intent_key: string; readonly variant: OwnerBananaInpaintImageVariant;
  readonly profile_schema_hash: string; readonly request_fingerprint: string; readonly expires_at: number;
  readonly cost_inputs: Readonly<Record<string, string>>;
  readonly artifacts: Map<string, OwnerBananaInpaintImageGenerationArtifact>;
  status: "result_observed" | "partial_results"; diagnostics: readonly string[]; recovery_id?: string;
};
type Claim = { readonly intent_key: string; readonly created_at: number; result_slot_reserved: boolean;
  state: "RESERVED" | "UNKNOWN" | "RESOLVED" };
const ownedServices = new WeakSet<object>();

class OwnerBananaInpaintImageGenerationServiceImpl implements OwnerBananaInpaintImageGenerationService {
  readonly #binding: AuthBinding;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #settings: MaplessSettingsInventory;
  readonly #profiles: Map<OwnerBananaInpaintImageVariant, Readonly<ReturnType<typeof getOwnerBananaInpaintImageSourceProfile>>>;
  readonly #original: OwnerBananaInpaintOriginalReferenceService;
  readonly #painted: OwnerBananaInpaintPaintedCompositeReferenceService;
  readonly #auxiliary: OwnerBananaInpaintAuxiliaryReferenceService;
  readonly #resolveClient: OwnerBananaInpaintImageGenerationServiceOptions["resolveChatClient"];
  readonly #createAccount: OwnerBananaInpaintImageGenerationServiceOptions["createAccountStatusService"];
  readonly #createAccess: OwnerBananaInpaintImageGenerationServiceOptions["createModelAccessService"];
  readonly #now: () => number;
  readonly #wait: NonNullable<OwnerBananaInpaintImageGenerationServiceOptions["wait"]>;
  readonly #pollDelay: number;
  readonly #pollAttempts: number;
  readonly #timeout: number;
  readonly #recoveries = new Map<string, Recovery>();
  readonly #results = new Map<string, ResultRecord>();
  readonly #claims = new Map<string, Claim>();
  readonly #preparers = new Map<string, OwnerBananaInpaintImageRequestPreparer>();
  readonly #epochs = new Map<string, number>();
  readonly #runs = new Set<Promise<unknown>>();
  readonly #runsByAttempt = new Map<string, Set<Promise<unknown>>>();
  readonly #controllers = new Map<string, Set<AbortController>>();
  readonly #invalidating = new Set<string>();
  readonly #usedAccounts = new WeakSet<object>();
  readonly #usedAccess = new WeakSet<object>();
  #closed = false;
  #closing: Promise<void> | undefined;
  #lastNow: number;
  #reservedResultSlots = 0;

  constructor(optionsInput: unknown) {
    const options = exact(optionsInput, ["binding", "linkService", "originalReferenceService",
      "paintedCompositeReferenceService", "auxiliaryReferenceService", "resolveChatClient", "createAccountStatusService", "createModelAccessService"],
      ["now", "timeoutMs", "pollDelayMs", "maxPollAttempts", "wait"]);
    if (typeof options.resolveChatClient !== "function" || types.isProxy(options.resolveChatClient) ||
        typeof options.createAccountStatusService !== "function" || types.isProxy(options.createAccountStatusService) ||
        typeof options.createModelAccessService !== "function" || types.isProxy(options.createModelAccessService) ||
        (options.now !== undefined && (typeof options.now !== "function" || types.isProxy(options.now))) ||
        (options.wait !== undefined && (typeof options.wait !== "function" || types.isProxy(options.wait)))) fail("INVALID_REQUEST");
    let catalog: DiscoveryCatalogRepository;
    let settings: MaplessSettingsInventory;
    try {
      ({ catalog, settings } = loadPinnedCatalogPair());
    } catch { fail("MODEL_BINDING_MISMATCH"); }
    if (catalog.fetched_at !== "2026-10-11T12:04:10.638Z" || catalog.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" ||
        catalog.runtime_usable !== false || catalog.source_hashes.models !== "sha256:16735c498e3743b67fb384ccee44de34ffd3ac8debaeb46033a5723938191a58") fail("MODEL_BINDING_MISMATCH");
    const profiles = new Map<OwnerBananaInpaintImageVariant, Readonly<ReturnType<typeof getOwnerBananaInpaintImageSourceProfile>>>();
    for (const variant of OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS) {
      const model = catalog.getModel(variant);
      if (model.id !== variant || model.upstream_id !== variant || model.ai_name !== "banana" || model.active !== true ||
          model.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || model.fetched_at !== catalog.fetched_at ||
          model.source_hashes.models !== catalog.source_hashes.models) fail("MODEL_BINDING_MISMATCH");
      const originalProfile = getOwnerBananaInpaintOriginalUploadSourceProfile(variant, catalog,
        OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, settings, OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION);
      const paintedProfile = getOwnerBananaInpaintPaintedCompositeSourceProfile(variant, originalProfile);
      const controlsProfile = getOwnerBananaInpaintSourceParameters(variant, originalProfile);
      const profile = getOwnerBananaInpaintImageSourceProfile(variant, originalProfile, paintedProfile, controlsProfile);
      const auxiliaryProfile = getOwnerBananaInpaintAuxiliarySourceProfile(variant, originalProfile);
      if (profile.source_binding.auxiliary_upload_source_profile_id !== auxiliaryProfile.profile_id) fail("MODEL_BINDING_MISMATCH");
      profiles.set(variant, profile);
    }
    if (!options.binding || typeof options.binding !== "object" || types.isProxy(options.binding) ||
        !options.linkService || typeof options.linkService !== "object" || types.isProxy(options.linkService) ||
        typeof options.linkService.getStatus !== "function" || types.isProxy(options.linkService.getStatus)) fail("INVALID_REQUEST");
    this.#binding = Object.freeze({ ...options.binding }) as AuthBinding;
    this.#linkService = options.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#catalog = catalog;
    this.#settings = settings;
    this.#profiles = profiles;
    this.#original = exactService(options.originalReferenceService, OwnerBananaInpaintOriginalReferenceService,
      ["upload", "resolveOriginal", "invalidateAttempt", "close"]);
    this.#painted = exactService(options.paintedCompositeReferenceService, OwnerBananaInpaintPaintedCompositeReferenceService,
      ["uploadPaintedComposite", "resolvePaintedComposite", "invalidateAttempt", "close"]);
    this.#auxiliary = exactService(options.auxiliaryReferenceService, OwnerBananaInpaintAuxiliaryReferenceService,
      ["upload", "resolveReference", "invalidateAttempt", "close"]);
    this.#resolveClient = options.resolveChatClient as OwnerBananaInpaintImageGenerationServiceOptions["resolveChatClient"];
    this.#createAccount = options.createAccountStatusService as OwnerBananaInpaintImageGenerationServiceOptions["createAccountStatusService"];
    this.#createAccess = options.createModelAccessService as OwnerBananaInpaintImageGenerationServiceOptions["createModelAccessService"];
    this.#now = options.now === undefined ? Date.now : options.now as () => number;
    this.#lastNow = readNow(this.#now);
    this.#timeout = boundedInt(options.timeoutMs, 1, MAX_TIMEOUT, MAX_TIMEOUT);
    this.#pollDelay = boundedInt(options.pollDelayMs, 0, MAX_POLL_DELAY, DEFAULT_POLL_DELAY);
    this.#pollAttempts = boundedInt(options.maxPollAttempts, 1, MAX_POLL_ATTEMPTS, DEFAULT_POLL_ATTEMPTS);
    this.#wait = (options.wait ?? delay) as NonNullable<OwnerBananaInpaintImageGenerationServiceOptions["wait"]>;
    ownedServices.add(this);
  }

  generate(input: unknown, signal?: AbortSignal): Promise<OwnerBananaInpaintImageGenerationResult> {
    const request = readGenerate(input);
    return this.#run(request.attemptId, signal, (s) => this.#generate(request, s));
  }
  reconcile(input: unknown, signal?: AbortSignal): Promise<OwnerBananaInpaintImageGenerationResult> {
    const request = exact(input, ["attemptId", "recovery_id"]);
    if (!isAttempt(request.attemptId) || !isId(request.recovery_id)) fail("INVALID_REQUEST");
    return this.#run(request.attemptId, signal, (s) => this.#reconcile(request.attemptId, request.recovery_id, s));
  }
  listRecoveries(input: unknown): Promise<readonly OwnerBananaInpaintImageRecoveryListItem[]> {
    const request = exact(input, ["attemptId"], ["limit"]);
    if (!isAttempt(request.attemptId)) fail("INVALID_REQUEST");
    const limit = boundedInt(request.limit, 1, MAX_RECOVERIES, 20);
    return this.#run(request.attemptId, undefined, async (signal) => {
      this.#pruneResultStorage();
      const principal = await this.#principal(request.attemptId, signal);
      return Object.freeze([...this.#recoveries.values()].filter((r) => r.attemptId === request.attemptId &&
        sameGenerationPrincipal(r.principal, principal) && (r.expires_at === null || r.expires_at > this.#readNow()) &&
        r.epoch === (this.#epochs.get(request.attemptId) ?? 0) && !this.#invalidating.has(request.attemptId))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit).map((r) => Object.freeze({
          recovery_id: r.id, created_at: r.created_at, variant: r.variant, status: "OUTCOME_UNKNOWN" as const, phase: r.phase
        })));
    });
  }
  getResultPage(input: unknown, signal?: AbortSignal): Promise<OwnerBananaInpaintImageResultPage> {
    const request = exact(input, ["attemptId", "result_id", "offset", "limit"]);
    if (!isAttempt(request.attemptId) || typeof request.result_id !== "string" || !RESULT_ID.test(request.result_id) ||
        !Number.isSafeInteger(request.offset) || request.offset < 0 || request.offset > MAX_OBSERVED_ARTIFACTS ||
        !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > RESULT_PAGE_SIZE) fail("RESULT_PAGE_INVALID");
    return this.#run(request.attemptId, signal, async (pageSignal) => {
      this.#pruneResultStorage();
      const principal = await this.#principal(request.attemptId, pageSignal);
      this.#assertCurrent(request.attemptId, this.#epochs.get(request.attemptId) ?? 0, pageSignal);
      const result = this.#results.get(request.result_id);
      if (!result || result.attemptId !== request.attemptId || result.expires_at <= this.#readNow() ||
          result.epoch !== (this.#epochs.get(request.attemptId) ?? 0) || !sameGenerationPrincipal(result.principal, principal) ||
          this.#profiles.get(result.variant)?.profile_schema_hash !== result.profile_schema_hash) {
        fail("RESULT_NOT_FOUND");
      }
      if (request.offset > result.artifacts.size) fail("RESULT_PAGE_INVALID");
      return this.#resultPage(result, request.offset, request.limit);
    });
  }
  async invalidateAttempt(attemptId: string): Promise<void> {
    if (!isAttempt(attemptId) || this.#invalidating.has(attemptId)) return;
    this.#invalidating.add(attemptId);
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    for (const controller of this.#controllers.get(attemptId) ?? []) controller.abort();
    const preparer = this.#preparers.get(attemptId);
    try {
      await Promise.allSettled([...(this.#runsByAttempt.get(attemptId) ?? [])]);
      for (const recovery of this.#recoveries.values()) {
        if (recovery.attemptId !== attemptId || recovery.result_id !== undefined) continue;
        const claim = this.#claims.get(recovery.intent_key);
        if (claim) this.#releaseResultSlot(claim);
      }
      const invalidations: Promise<void>[] = [this.#original.invalidateAttempt(attemptId),
        this.#painted.invalidateAttempt(attemptId), this.#auxiliary.invalidateAttempt(attemptId)];
      if (preparer) invalidations.push(preparer.invalidateAttempt(attemptId));
      await Promise.allSettled(invalidations);
    } finally { this.#invalidating.delete(attemptId); }
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const controllers of this.#controllers.values()) for (const controller of controllers) controller.abort();
    this.#closing = (async () => {
      await Promise.allSettled([...this.#runs]);
      for (const preparer of this.#preparers.values()) await preparer.close().catch(() => undefined);
      await Promise.allSettled([this.#original.close(), this.#painted.close(), this.#auxiliary.close()]);
    })();
    return this.#closing;
  }

  async #generate(request: Readonly<OwnerBananaInpaintImageGenerateInput>, signal: AbortSignal): Promise<OwnerBananaInpaintImageGenerationResult> {
    this.#pruneResultStorage();
    const epoch = this.#epochs.get(request.attemptId) ?? 0;
    const principal = await this.#principal(request.attemptId, signal);
    const profile = this.#profiles.get(request.variant)!;
    const cost = projectOwnerBananaInpaintCostParameters({ variant: request.variant, image_size: request.image_size });
    if (this.#recoveries.size >= MAX_RECOVERIES || this.#results.size + this.#reservedResultSlots >= MAX_RESULT_RECORDS) fail("SERVICE_BUSY");
    const preparer = this.#getPreparer(request.attemptId);
    this.#assertCurrent(request.attemptId, epoch, signal);
    await this.#preflight(request.attemptId, request.variant, cost.cost_inputs, signal);
    const candidate = await preparer.prepare({ variant: request.variant, prompt: request.prompt, image_size: request.image_size,
      original_handle: request.original_handle, painted_handle: request.painted_handle,
      auxiliary_reference_handle: request.auxiliary_reference_handle });
    const binding = preparer.inspectCandidate(candidate);
    if (!binding || !sameGenerationPrincipal(binding.principal, principal) || binding.attempt_id !== request.attemptId ||
        binding.variant !== request.variant || binding.profile_schema_hash !== profile.profile_schema_hash) fail("PRE_DISPATCH_FAILED");
    const pairKey = this.#intentKey(principal, request, { original: binding.original_sha256, painted: binding.painted_sha256,
      auxiliary: binding.auxiliary_sha256 ?? "" });
    this.#assertAvailable(pairKey);
    const claim = this.#reserve(pairKey);
    let chatUuid: string | undefined;
    let client: SyntxChatHttpClient | undefined;
    let recovery: Recovery | undefined;
    let postStarted = false;
    let phase: OwnerBananaInpaintImageGenerationPhase = "REQUEST_PREPARE";
    try {
      phase = "CHAT_CREATE";
      client = this.#client(request.attemptId);
      const chat = await Reflect.apply(CREATE_CHAT, client, ["Banana Inpaint", signal]) as { chat_uuid: string };
      chatUuid = chat.chat_uuid;
      this.#assertCurrent(request.attemptId, epoch, signal);
      phase = "PREFLIGHT";
      const currentPrincipal = await this.#principal(request.attemptId, signal);
      if (!sameGenerationPrincipal(currentPrincipal, principal)) fail("PRINCIPAL_NOT_LINKED");
      await this.#preflight(request.attemptId, request.variant, cost.cost_inputs, signal);
      const permit = await createOwnerBananaInpaintImageOneShotPermit({ preparer, candidate, principal, attemptId: request.attemptId });
      this.#assertCurrent(request.attemptId, epoch, signal);
      const postBinding = preparer.inspectCandidate(candidate);
      if (!postBinding || postBinding.attempt_id !== request.attemptId || !sameGenerationPrincipal(postBinding.principal, principal) ||
          postBinding.variant !== request.variant || postBinding.profile_schema_hash !== profile.profile_schema_hash ||
          postBinding.request_fingerprint !== candidate.request_fingerprint) fail("PRE_DISPATCH_FAILED");
      recovery = this.#makeRecovery(request, cost.cost_inputs, principal, epoch, pairKey, candidate, preparer, client, chatUuid, postBinding, null, "GENERATION_POST");
      recovery.post_dispatch_witness = Object.freeze({ attempt_id: request.attemptId, principal, epoch, intent_key: pairKey,
        variant: request.variant, profile_schema_hash: profile.profile_schema_hash,
        request_fingerprint: candidate.request_fingerprint, candidate_binding: postBinding, chat_uuid: chatUuid });
      recovery.expires_at = null;
      this.#recoveries.set(recovery.id, recovery);
      phase = "GENERATION_POST";
      recovery.phase = phase;
      postStarted = true;
      claim.state = "UNKNOWN";
      const receipt = await Reflect.apply(START, client, [{ preparer, candidate, permit, principal,
        attemptId: request.attemptId, chat_uuid: chatUuid }, signal]) as MediaGenerationReceipt;
      if (!receipt || receipt.chat_uuid !== chatUuid || typeof receipt.message_id !== "string") fail("OUTCOME_UNKNOWN");
      phase = "POST_ACK_KNOWN";
      recovery.ack_message_id = receipt.message_id;
      recovery.phase = phase;
      const result = await this.#poll(recovery, client, signal);
      if (result) {
        if (result.status === "result_observed") { claim.state = "RESOLVED"; this.#recoveries.delete(recovery.id); }
        return result;
      }
      recovery.phase = "RESULT_WAIT";
      throw new ServiceError("OUTCOME_UNKNOWN", recovery.id, recovery.diagnostic);
    } catch (error) {
      if (!postStarted) {
        this.#claims.delete(claim.intent_key);
        this.#releaseResultSlot(claim);
        throw error;
      }
      claim.state = "UNKNOWN";
      if (error instanceof ServiceError && error.code === "OUTCOME_UNKNOWN") throw error;
      throw new ServiceError("OUTCOME_UNKNOWN", recovery?.id, recovery?.diagnostic ?? Object.freeze([phase]));
    }
  }

  async #reconcile(attemptId: string, id: string, signal: AbortSignal): Promise<OwnerBananaInpaintImageGenerationResult> {
    const recovery = this.#recoveries.get(id);
    if (!recovery || recovery.attemptId !== attemptId ||
        (recovery.expires_at !== null && recovery.expires_at <= this.#readNow())) fail("RECOVERY_NOT_FOUND");
    const principal = await this.#principal(attemptId, signal);
    if (!sameGenerationPrincipal(principal, recovery.principal) || (this.#epochs.get(attemptId) ?? 0) !== recovery.epoch) fail("RECOVERY_NOT_FOUND");
    const witness = recovery.post_dispatch_witness;
    const profile = this.#profiles.get(recovery.variant);
    const claim = this.#claims.get(recovery.intent_key);
    const binding = witness?.candidate_binding;
    if (!witness || !binding || (recovery.expires_at !== null && recovery.expires_at <= this.#readNow()) ||
        witness.attempt_id !== attemptId || !sameGenerationPrincipal(witness.principal, principal) ||
        witness.epoch !== recovery.epoch || witness.intent_key !== recovery.intent_key ||
        witness.variant !== recovery.variant || witness.profile_schema_hash !== profile?.profile_schema_hash ||
        witness.request_fingerprint !== recovery.request_fingerprint || witness.request_fingerprint !== recovery.candidate.request_fingerprint ||
        witness.chat_uuid !== recovery.chat_uuid || binding.attempt_id !== attemptId || !sameGenerationPrincipal(binding.principal, principal) ||
        binding.variant !== recovery.variant || binding.profile_schema_hash !== witness.profile_schema_hash ||
        binding.request_fingerprint !== witness.request_fingerprint ||
        recovery.candidate.variant !== witness.variant || recovery.candidate.profile_schema_hash !== witness.profile_schema_hash ||
        !this.#isExactChatClient(recovery.client) || !claim || claim.intent_key !== witness.intent_key || claim.state !== "UNKNOWN" ||
        this.#recoveries.get(id) !== recovery) fail("RECOVERY_NOT_FOUND");
    const result = await this.#poll(recovery, recovery.client, signal);
    if (!result) { recovery.phase = "RESULT_WAIT"; throw new ServiceError("OUTCOME_UNKNOWN", id, recovery.diagnostic); }
    if (result.status === "result_observed") {
      const claim = this.#claims.get(recovery.intent_key);
      if (claim) claim.state = "RESOLVED";
      this.#recoveries.delete(id);
    }
    return result;
  }

  async #poll(recovery: Recovery, client: SyntxChatHttpClient, signal: AbortSignal): Promise<OwnerBananaInpaintImageGenerationResult | null> {
    const urls = new Map<string, OwnerBananaInpaintImageGenerationArtifact>();
    const diagnostics = new Set<string>();
    for (let index = 0; index < this.#pollAttempts; index += 1) {
      this.#assertCurrent(recovery.attemptId, recovery.epoch, signal);
      let candidates: OwnerBananaInpaintImageResultCandidates;
      try {
        recovery.phase = "HISTORY_GET";
        candidates = await Reflect.apply(LIST, client, [{ preparer: recovery.preparer, candidate: recovery.candidate,
          principal: recovery.principal, attemptId: recovery.attemptId, chat_uuid: recovery.chat_uuid }, signal]) as OwnerBananaInpaintImageResultCandidates;
      } catch { diagnostics.add("RESULT_CANDIDATES_UNAVAILABLE"); await this.#pause(signal); continue; }
      recovery.phase = "HISTORY_BINDING";
      for (const gap of candidates.gaps) diagnostics.add(gap);
      const boundContexts: OwnerBananaInpaintImageResultMessageContext[] = [];
      for (const context of candidates.contexts) {
        if (context.chat_uuid !== recovery.chat_uuid || recovery.ack_message_id !== null &&
            context.owner_echo_message_id !== recovery.ack_message_id) {
          diagnostics.add("RESULT_CONTEXT_NOT_BOUND"); continue;
        }
        boundContexts.push(context);
      }
      if (!boundContexts.length) { await this.#pause(signal); continue; }
      let unresolved = candidates.history_binding_status !== "BOUND" || candidates.history_page_status !== "COMPLETE" || candidates.gaps.length > 0;
      for (const context of boundContexts) {
        recovery.phase = "RESULT_GET";
        let decoded: OwnerBananaInpaintImageResult;
        try { decoded = await Reflect.apply(GET_RESULT, client, [context, signal]) as OwnerBananaInpaintImageResult; }
        catch { diagnostics.add("RESULT_READ_UNAVAILABLE"); unresolved = true; continue; }
        recovery.phase = "RESULT_BINDING";
        if (decoded.message_binding !== "BOUND" || decoded.chat_uuid !== recovery.chat_uuid || decoded.message_id !== context.message_id) {
          diagnostics.add("RESULT_MESSAGE_UNBOUND"); unresolved = true; continue;
        }
        for (const gap of decoded.gaps) diagnostics.add(gap.code);
        if (decoded.gaps.length) unresolved = true;
        for (const item of decoded.ready_images) urls.set(`${decoded.message_id}:${item.object_index}`, Object.freeze({ url: item.object_url,
          mime_type: null, width: null, height: null, geometry_verified: false, message_id: decoded.message_id, object_index: item.object_index }));
      }
      if (urls.size && !unresolved) {
        return this.#presentResult(recovery, [...urls.values()], [...diagnostics], "result_observed");
      }
      recovery.diagnostic = Object.freeze([...diagnostics]);
      await this.#pause(signal);
    }
    recovery.diagnostic = Object.freeze([...diagnostics]);
    return urls.size ? this.#presentResult(recovery, [...urls.values()], [...diagnostics], "partial_results") : null;
  }

  #presentResult(recovery: Recovery, artifacts: OwnerBananaInpaintImageGenerationArtifact[], diagnostics: string[],
    status: "result_observed" | "partial_results"): OwnerBananaInpaintImageGenerationResult {
    const profile = this.#profiles.get(recovery.variant)!;
    let record = recovery.result_id === undefined ? undefined : this.#results.get(recovery.result_id);
    if (recovery.result_id !== undefined && !record) fail("RESULT_NOT_FOUND");
    if (!record) {
      const claim = this.#claims.get(recovery.intent_key);
      if (this.#results.size >= MAX_RESULT_RECORDS || !claim?.result_slot_reserved) fail("SERVICE_BUSY");
      record = { result_id: `banana_inpaint_result_${randomUUID()}`, attemptId: recovery.attemptId,
        principal: recovery.principal, epoch: recovery.epoch, intent_key: recovery.intent_key, variant: recovery.variant,
        profile_schema_hash: profile.profile_schema_hash, request_fingerprint: recovery.request_fingerprint,
        expires_at: recovery.expires_at ?? this.#readNow() + RECOVERY_TTL_MS, cost_inputs: recovery.cost_inputs, artifacts: new Map(), status,
        diagnostics: Object.freeze([]) };
      recovery.result_id = record.result_id;
      this.#results.set(record.result_id, record);
      this.#releaseResultSlot(claim);
    }
    for (const artifact of artifacts) {
      const key = `${artifact.message_id}:${artifact.object_index}`;
      if (!record.artifacts.has(key) && record.artifacts.size >= MAX_OBSERVED_ARTIFACTS) fail("SERVICE_BUSY");
      record.artifacts.set(key, artifact);
    }
    record.status = status;
    record.diagnostics = Object.freeze([...diagnostics]);
    if (status === "partial_results") record.recovery_id = recovery.id;
    else delete record.recovery_id;
    return this.#generationResult(record, 0, RESULT_PAGE_SIZE);
  }

  #generationResult(record: ResultRecord, offset: number, limit: number): OwnerBananaInpaintImageGenerationResult {
    const page = this.#resultPage(record, offset, limit);
    return Object.freeze({ status: record.status, backend_acceptance: "UNPROVEN" as const, provider_execution: false as const,
      attempt_id: record.attemptId, variant: record.variant, ai_name: "banana" as const, model_type: record.variant,
      cost_inputs: record.cost_inputs, cost_input_confidence: "SOURCE_JOINED_COST2_QUERY_KEYS_NOT_QUOTE_BILLING_OR_HARDCAP" as const,
      profile_schema_hash: record.profile_schema_hash, request_fingerprint: record.request_fingerprint,
      result_id: record.result_id, observed_total: page.observed_total, next_offset: page.next_offset,
      has_more: page.has_more, artifacts: page.artifacts, diagnostics: record.diagnostics,
      ...(record.status === "partial_results" ? { recovery_id: record.recovery_id } : {}) });
  }

  #resultPage(record: ResultRecord, offset: number, limit: number): OwnerBananaInpaintImageResultPage {
    const observedTotal = record.artifacts.size;
    if (offset > observedTotal) fail("RESULT_PAGE_INVALID");
    const selected: OwnerBananaInpaintImageGenerationArtifact[] = [];
    let index = 0;
    for (const artifact of record.artifacts.values()) {
      if (index >= offset && selected.length < limit) selected.push(artifact);
      index += 1;
      if (selected.length === limit) break;
    }
    const artifacts = Object.freeze(selected);
    const nextOffset = offset + artifacts.length;
    const hasMore = nextOffset < observedTotal;
    return Object.freeze({ result_id: record.result_id, offset, limit, observed_total: observedTotal,
      next_offset: hasMore ? nextOffset : null, has_more: hasMore, artifacts });
  }

  #pruneResultStorage(): void {
    const now = this.#readNow();
    for (const [id, record] of this.#results) if (record.expires_at <= now) this.#results.delete(id);
    for (const [id, recovery] of this.#recoveries) {
      if (recovery.expires_at === null || recovery.expires_at > now) continue;
      this.#recoveries.delete(id);
      if (recovery.result_id === undefined) {
        const claim = this.#claims.get(recovery.intent_key);
        if (claim) this.#releaseResultSlot(claim);
      }
    }
  }

  #releaseResultSlot(claim: Claim): void {
    if (!claim.result_slot_reserved) return;
    claim.result_slot_reserved = false;
    this.#reservedResultSlots = Math.max(0, this.#reservedResultSlots - 1);
  }

  #makeRecovery(request: Readonly<OwnerBananaInpaintImageGenerateInput>, costInputs: Readonly<Record<string, string>>,
    principal: Readonly<GenerationPrincipalRef>, epoch: number,
    intentKey: string, candidate: OwnerBananaInpaintImagePreparedCandidate, preparer: OwnerBananaInpaintImageRequestPreparer,
    client: SyntxChatHttpClient, chatUuid: string, binding: Readonly<OwnerBananaInpaintImageCandidateBinding>,
    ack: string | null, phase: OwnerBananaInpaintImageGenerationPhase): Recovery {
    return { id: `banana_inpaint_recovery_${randomUUID()}`, created_at: new Date(this.#readNow()).toISOString(),
      attemptId: request.attemptId, principal, epoch, intent_key: intentKey, request_fingerprint: candidate.request_fingerprint,
      variant: request.variant, preparer, candidate, chat_uuid: chatUuid, client, ack_message_id: ack,
      expires_at: binding.expires_at, post_dispatch_witness: null, cost_inputs: costInputs, phase, diagnostic: Object.freeze([]) };
  }

  async #preflight(attemptId: string, variant: OwnerBananaInpaintImageVariant,
    costInputs: Readonly<Record<string, string>>, signal: AbortSignal): Promise<void> {
    let account: AccountStatusService; let access: ModelAccessService;
    try {
      account = this.#createAccount(attemptId);
      access = this.#createAccess(attemptId, this.#catalog);
    } catch { fail("PREFLIGHT_FAILED"); }
    if (!isExactService(account, AccountStatusService, ["getAccountStatus"]) || this.#usedAccounts.has(account) ||
        !isExactService(access, ModelAccessService, ["getModelAccess"]) || this.#usedAccess.has(access)) fail("PREFLIGHT_FAILED");
    this.#usedAccounts.add(account); this.#usedAccess.add(access);
    let accountResult: AccountStatusResult; let accessResult: ModelAccessResult;
    try {
      accountResult = await Reflect.apply(ACCOUNT, account, [signal]) as AccountStatusResult;
      accessResult = await Reflect.apply(ACCESS, access, [{ model_id: variant, cost_parameters: costInputs }, signal]) as ModelAccessResult;
    } catch { fail("PREFLIGHT_FAILED"); }
    assertPreflight(accountResult, accessResult, this.#catalog, variant, catalogAccessVersion(this.#catalog), costInputs, this.#readNow());
  }

  #getPreparer(attemptId: string): OwnerBananaInpaintImageRequestPreparer {
    const found = this.#preparers.get(attemptId);
    if (found) return found;
    const value = createOwnerBananaInpaintImageRequestPreparer({ attemptId, originalReferenceService: this.#original,
      paintedCompositeReferenceService: this.#painted, auxiliaryReferenceService: this.#auxiliary,
      profiles: [...this.#profiles.values()].map((imageProfile) => {
        const originalProfile = getOwnerBananaInpaintOriginalUploadSourceProfile(imageProfile.variant, this.#catalog,
          OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, this.#settings,
          OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION);
        return { originalProfile, paintedProfile: getOwnerBananaInpaintPaintedCompositeSourceProfile(imageProfile.variant, originalProfile),
          controlsProfile: getOwnerBananaInpaintSourceParameters(imageProfile.variant, originalProfile), imageProfile };
      }), now: this.#now });
    this.#preparers.set(attemptId, value);
    return value;
  }

  async #principal(attemptId: string, signal: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    this.#assertCurrent(attemptId, this.#epochs.get(attemptId) ?? 0, signal);
    try {
      const principal = snapshotGenerationPrincipal(await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService }));
      if (principal.connection_id !== attemptId) fail("PRINCIPAL_NOT_LINKED");
      return principal;
    } catch (error) { if (error instanceof ServiceError) throw error; if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED"); fail("PRINCIPAL_NOT_LINKED"); }
  }

  #client(attemptId: string): SyntxChatHttpClient {
    const client = this.#resolveClient(attemptId);
    if (!this.#isExactChatClient(client)) fail("MODEL_BINDING_MISMATCH");
    return client;
  }
  #isExactChatClient(client: unknown): client is SyntxChatHttpClient {
    return client instanceof SyntxChatHttpClient && !types.isProxy(client) &&
      Object.getPrototypeOf(client) === SyntxChatHttpClient.prototype &&
      client.createImageInpaintChat === CREATE_CHAT && client.startBananaInpaintImageWithOwnedCandidate === START &&
      client.listBananaInpaintImageResultCandidates === LIST && client.getBananaInpaintImageResult === GET_RESULT;
  }
  #reserve(intentKey: string): Claim {
    if (this.#results.size + this.#reservedResultSlots >= MAX_RESULT_RECORDS) fail("SERVICE_BUSY");
    if (this.#claims.size >= MAX_STATE) {
      const completed = [...this.#claims.values()].filter((entry) => entry.state === "RESOLVED")
        .sort((left, right) => left.created_at - right.created_at)[0];
      if (!completed) fail("SERVICE_BUSY");
      this.#claims.delete(completed.intent_key);
    }
    const claim: Claim = { intent_key: intentKey, created_at: this.#readNow(), result_slot_reserved: true, state: "RESERVED" };
    this.#reservedResultSlots += 1;
    this.#claims.set(intentKey, claim); return claim;
  }
  #assertAvailable(intentKey: string): void {
    const claim = this.#claims.get(intentKey);
    if (!claim) return;
    if (claim.state === "RESOLVED") { this.#claims.delete(intentKey); return; }
    fail("INTENT_ALREADY_CLAIMED");
  }
  #intentKey(principal: Readonly<GenerationPrincipalRef>, request: Readonly<OwnerBananaInpaintImageGenerateInput>,
    contentShaByRole: Readonly<{ original: string; painted: string; auxiliary: string }>): string {
    const normalized = normalizeOwnerBananaInpaintPrompt({ variant: request.variant, prompt: request.prompt });
    return schemaHash({ principal: { tenant_id: principal.tenant_id, subject_id: principal.subject_id },
      operation: "banana-inpaint", variant: request.variant, prompt: normalized.prompt, image_size: request.image_size,
      ordered_inputs: [
        { role: "original", sha256: contentShaByRole.original },
        { role: "painted_composite", sha256: contentShaByRole.painted },
        ...(contentShaByRole.auxiliary ? [{ role: "auxiliary_reference", sha256: contentShaByRole.auxiliary }] : [])
      ] });
  }
  #assertCurrent(attemptId: string, epoch: number, signal: AbortSignal): void {
    if (this.#closed) fail("SERVICE_CLOSED");
    if (signal.aborted || this.#invalidating.has(attemptId) || (this.#epochs.get(attemptId) ?? 0) !== epoch) fail("PRE_DISPATCH_FAILED");
  }
  async #run<T>(attemptId: string, outer: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.#closed) fail("SERVICE_CLOSED");
    if (this.#runs.size >= MAX_RUNS) fail("SERVICE_BUSY");
    const controller = new AbortController();
    const abort = () => controller.abort();
    outer?.addEventListener("abort", abort, { once: true });
    const set = this.#controllers.get(attemptId) ?? new Set<AbortController>(); set.add(controller); this.#controllers.set(attemptId, set);
    const timeout = setTimeout(() => controller.abort(), this.#timeout);
    const promise = Promise.resolve().then(() => operation(controller.signal));
    this.#runs.add(promise); const runs = this.#runsByAttempt.get(attemptId) ?? new Set<Promise<unknown>>(); runs.add(promise); this.#runsByAttempt.set(attemptId, runs);
    try { return await promise; } finally {
      clearTimeout(timeout); outer?.removeEventListener("abort", abort); this.#runs.delete(promise); runs.delete(promise); set.delete(controller);
      if (!runs.size) this.#runsByAttempt.delete(attemptId); if (!set.size) this.#controllers.delete(attemptId);
    }
  }
  async #pause(signal: AbortSignal): Promise<void> { await this.#wait(this.#pollDelay, signal); }
  #readNow(): number { const now = readNow(this.#now); if (now < this.#lastNow) fail("CLOCK_INVALID"); this.#lastNow = now; return now; }
}

type ServiceErrorCode = OwnerBananaInpaintImageGenerationErrorCode;
class ServiceError extends OwnerBananaInpaintImageGenerationServiceError {}
function loadPinnedCatalogPair(): { catalog: DiscoveryCatalogRepository; settings: MaplessSettingsInventory } {
  return { catalog: new DiscoveryCatalogRepository(loadPublicCatalogVersion(OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION)),
    settings: loadMaplessSettingsInventoryVersion(OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION) };
}
function fail(code: ServiceErrorCode, recoveryId?: string, diagnostic?: readonly string[]): never {
  throw new ServiceError(code, recoveryId, diagnostic);
}
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const allowed = new Set([...required, ...optional]);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !allowed.has(key) ||
      !Object.hasOwn(descriptors[key as string]!, "value") || !descriptors[key as string]!.enumerable) ||
      required.some((key) => !Object.hasOwn(descriptors, key))) fail("INVALID_REQUEST");
  return Object.fromEntries([...required, ...optional].filter((key) => Object.hasOwn(descriptors, key))
    .map((key) => [key, descriptors[key]!.value]));
}
function readGenerate(value: unknown): Readonly<OwnerBananaInpaintImageGenerateInput> {
  const data = exact(value, ["attemptId", "variant", "prompt", "image_size", "original_handle", "painted_handle", "auxiliary_reference_handle"]);
  if (!isAttempt(data.attemptId) || !OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS.includes(data.variant) ||
      typeof data.prompt !== "string" || !(data.image_size === null || typeof data.image_size === "string") ||
      typeof data.original_handle !== "string" || typeof data.painted_handle !== "string" ||
      !(data.auxiliary_reference_handle === null || typeof data.auxiliary_reference_handle === "string")) fail("INVALID_REQUEST");
  try { normalizeOwnerBananaInpaintPrompt({ variant: data.variant, prompt: data.prompt });
    normalizeOwnerBananaInpaintParameters({ variant: data.variant, image_size: data.image_size }); }
  catch { fail("INVALID_REQUEST"); }
  return Object.freeze(data) as Readonly<OwnerBananaInpaintImageGenerateInput>;
}
function isExactService<T extends object>(value: unknown, ctor: new (...args: any[]) => T, methods: readonly string[]): value is T {
  if (!(value instanceof ctor) || types.isProxy(value) || Object.getPrototypeOf(value) !== ctor.prototype) return false;
  return methods.every((name) => typeof (value as Record<string, unknown>)[name] === "function" &&
    (value as Record<string, unknown>)[name] === (ctor.prototype as Record<string, unknown>)[name]);
}
function exactService<T extends object>(value: unknown, ctor: new (...args: any[]) => T, methods: readonly string[]): T {
  if (!isExactService(value, ctor, methods)) fail("INVALID_REQUEST");
  return value;
}
function assertPreflight(accountInput: AccountStatusResult, accessInput: ModelAccessResult, catalog: DiscoveryCatalogRepository,
  variant: OwnerBananaInpaintImageVariant, expectedVersion: string, costInputs: Readonly<Record<string, string>>, now: number): void {
  const account = exact(accountInput, ["balance", "subscription", "contract_evidence", "source_build", "observed_at"]);
  const balance = exact(account.balance, ["unit", "available"]);
  const subscription = exact(account.subscription, ["active", "plan_type", "end_date", "end_date_kind"]);
  const access = exact(accessInput, ["catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live",
    "parameter_keys", "parameters_redacted", "access", "cost", "discount_cost", "free_remaining_generations", "limit", "show_warning", "observed_at"]);
  const model = catalog.getModel(variant);
  const expectedCatalogVersion = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
  const parameterKeys = Object.keys(costInputs).sort();
  if (account.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || account.source_build !== ACCOUNT_SOURCE_BUILD ||
      !validObservedAt(account.observed_at, now) || balance.unit !== "tokens" ||
      !(balance.available === null || typeof balance.available === "string") || subscription.active !== true ||
      !(subscription.plan_type === null || typeof subscription.plan_type === "string") || !validAccessSubscription(subscription, now) ||
      access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || access.catalog_version !== expectedCatalogVersion ||
      expectedCatalogVersion !== expectedVersion || access.model_id !== variant || access.ai_name !== "banana" ||
      access.model_type !== variant || access.account_read_live !== true || access.access !== true || access.parameters_redacted !== true ||
      !Array.isArray(access.parameter_keys) || !isDeepStrictEqual(access.parameter_keys, parameterKeys) || !validObservedAt(access.observed_at, now) ||
      !finiteNonnegative(access.cost) || !(access.discount_cost === null || finiteNonnegative(access.discount_cost)) ||
      !(access.free_remaining_generations === null || Number.isSafeInteger(access.free_remaining_generations) && access.free_remaining_generations >= 0) ||
      !(access.limit === null || finiteNonnegative(access.limit)) || !(access.show_warning === null || typeof access.show_warning === "boolean") ||
      model.id !== variant || model.upstream_id !== variant || model.ai_name !== "banana" || model.active !== true ||
      model.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || model.runtime_usable !== false) fail("PREFLIGHT_FAILED");
}
function validObservedAt(value: unknown, now: number): boolean {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= now && now - parsed <= 30_000 && new Date(parsed).toISOString() === value;
}
function validAccessSubscription(value: Record<string, any>, now: number): boolean {
  const date = value.end_date;
  const kind = value.end_date_kind;
  if (date === null) return kind === null;
  if (typeof date !== "string") return false;
  if (kind === "DATE_ONLY") return /^\d{4}-\d{2}-\d{2}$/u.test(date);
  if (kind === "LOCAL_DATETIME") return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/u.test(date);
  if (kind === "OFFSET_DATETIME" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(date)) {
    const expiry = Date.parse(date);
    return Number.isFinite(expiry) && expiry > now;
  }
  return false;
}
function finiteNonnegative(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function catalogAccessVersion(catalog: DiscoveryCatalogRepository): string {
  return `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
}
function isAttempt(value: unknown): value is string { return typeof value === "string" && ATTEMPT.test(value); }
function isId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u.test(value); }
function boundedInt(value: unknown, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) fail("INVALID_REQUEST");
  return value as number;
}
function readNow(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) fail("CLOCK_INVALID");
  return value;
}
function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error("ABORTED")); return; }
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    const abort = () => { clearTimeout(timer); reject(new Error("ABORTED")); };
    signal.addEventListener("abort", abort, { once: true });
  });
}
