import { randomUUID } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { SyntxChatHttpClient, type MediaGenerationReceipt } from "../adapter/syntx/chat-http-client.js";
import type { InternalOwnerFluxImageResult, OwnerFluxImageResultPendingReason, OwnerFluxImageResultUnverifiedReason } from "../adapter/syntx/flux-image-result.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import type { AccountStatusResult } from "./account-status.js";
import type { ModelAccessResult } from "./model-access.js";
import { OwnerFluxImageAssetService, OwnerFluxImageAssetServiceError } from "./owner-flux-image-asset-service.js";
import type { OwnerFluxImageAssetSet } from "./owner-flux-image-request-preparer.js";
import { prepareOwnerFluxImageRequest, isOwnerFluxImagePreparedCandidateForPrincipal, getOwnerFluxImagePreparedCandidateState,
  observeOwnerFluxImageCandidateClock, type OwnerFluxImagePreparedCandidate } from "./owner-flux-image-request-preparer.js";
import { getOwnerFluxImageSourceProfile, type OwnerFluxImageSourceProfile } from "./owner-flux-image-source-profile.js";
import { OWNER_FLUX_IMAGE_MODELS, type OwnerFluxImageModel } from "./owner-flux-image-parameters.js";
import { createOwnerFluxImageOneShotPermit, OwnerFluxImageOneShotPolicyError } from "./owner-flux-image-one-shot-policy.js";
import { correlateOwnerFluxImageHistoryBinding, type OwnerFluxImageHistoryBindingReason } from "./owner-flux-image-history-binding.js";

type ClaimState = "PREPARING" | "POST_STARTED" | "OUTCOME_UNKNOWN";
interface Claim { readonly key: string; attemptId: string | null; state: ClaimState; }
interface PostDispatchWitness {
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: OwnerFluxImageModel;
  readonly profile_schema_hash: string;
  readonly catalog_version: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly claim_key: string;
  readonly chat_uuid: string;
}
interface Recovery {
  readonly recovery_id: string; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: OwnerFluxImageModel; readonly candidate: OwnerFluxImagePreparedCandidate; readonly created_at: string;
  expires_at: number | null; readonly claimKey: string; readonly chat_uuid: string; readonly catalog_version: string;
  post_dispatch_witness: PostDispatchWitness | null;
  owner_echo_message_id: string | null; provider_chat_id: string | null; result_message_id: string | null;
  message_object_ids: readonly [string] | null; readonly diagnostic: MutableDiagnostic;
}
type MutableDiagnostic = { -readonly [K in keyof OwnerFluxImageGenerationDiagnostic]: OwnerFluxImageGenerationDiagnostic[K] };
interface CachedPrincipal { readonly principal: Readonly<GenerationPrincipalRef>; readonly expiresAt: number; }
interface CachedAssetSet { readonly set: OwnerFluxImageAssetSet; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>; readonly expiresAt: number; }
interface PendingAssetSet { readonly attemptId: string; readonly promise: Promise<OwnerFluxImageAssetSet>; }
interface Request { readonly attemptId: string; readonly model_id: OwnerFluxImageModel; readonly prompt: string;
  readonly image_reference_handle?: string; readonly parameters: OwnerFluxImageGenerationParameters; }
export interface OwnerFluxImageGenerationParameters {
  readonly resolution: string; readonly cfg: number; readonly steps: number; readonly image_strength: number;
  readonly workflow_type: "default" | "civitai"; readonly raw: false | null;
  readonly civitai_loras: readonly Readonly<{ handle: string; strength_model: number; strength_clip: number }>[];
}

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const IMAGE_HANDLE = /^flux_image_[0-9a-f-]{36}$/u;
const LORA_HANDLE = /^flux_lora_[0-9a-f-]{36}$/u;
const RECOVERY = /^flux_image_recovery_[0-9a-f-]{36}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const TTL = 15 * 60_000;
const MAX_PENDING = 4;
const MAX_STATES = 128;
const MAX_TIMEOUT = 180_000;
const MAX_POLLS = 32;
const MAX_COUNTER = 255;
const MAX_SKEW = 30_000;
const OPERATION = "generate-image" as const;
const DEFAULT_DELAY = 2_000;
const MAX_DELAY = 40_000;
const METHODS = Object.freeze({ createChat: SyntxChatHttpClient.prototype.createChat,
  start: SyntxChatHttpClient.prototype.startFluxImageWithOwnedCandidate,
  history: SyntxChatHttpClient.prototype.listMessageCandidates,
  result: SyntxChatHttpClient.prototype.getFluxImageResult });

export interface OwnerFluxImageGenerationPreflightInput {
  readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>; readonly variant: OwnerFluxImageModel;
  readonly catalog_version: string; readonly cost_inputs: Readonly<Record<string, never>>;
  readonly request_fingerprint: string; readonly signal?: AbortSignal;
}
export interface OwnerFluxImageGenerationPreflightResult { readonly account: AccountStatusResult; readonly model_access: ModelAccessResult; }
export type OwnerFluxImageGenerationPreflight = (input: Readonly<OwnerFluxImageGenerationPreflightInput>) => Promise<OwnerFluxImageGenerationPreflightResult>;
export interface OwnerFluxImageGenerationServiceOptions {
  readonly binding: AuthBinding; readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: DiscoveryCatalogRepository; readonly catalog_version: string;
  readonly assetService: OwnerFluxImageAssetService; readonly resolveChatClient: (attemptId: string) => unknown;
  readonly preflight: OwnerFluxImageGenerationPreflight; readonly now?: () => number; readonly timeoutMs?: number;
  readonly pollDelayMs?: number; readonly maxPollAttempts?: number; readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}
export interface OwnerFluxImageGenerateInput {
  readonly attemptId: string; readonly model_id: OwnerFluxImageModel; readonly prompt: string;
  readonly image_reference_handle?: string; readonly parameters: OwnerFluxImageGenerationParameters;
}
export interface OwnerFluxImageReconcileInput { readonly attemptId: string; readonly recovery_id: string; }
export interface OwnerFluxImageRecoveryListInput { readonly attemptId: string; readonly limit?: number; }

export const OWNER_FLUX_IMAGE_GENERATION_PHASES = Object.freeze([
  "REQUEST_PREPARE", "PRINCIPAL", "ASSET_BINDING", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST",
  "POST_ACK_KNOWN", "HISTORY_GET", "HISTORY_BINDING", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"
] as const);
export const OWNER_FLUX_IMAGE_GENERATION_ERROR_CODES = Object.freeze([
  "INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH",
  "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED", "REFERENCE_ALREADY_CLAIMED", "PREFLIGHT_FAILED",
  "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"
] as const);
export type OwnerFluxImageGenerationPhase = typeof OWNER_FLUX_IMAGE_GENERATION_PHASES[number];
export type OwnerFluxImageGenerationResultReason = OwnerFluxImageResultPendingReason | OwnerFluxImageResultUnverifiedReason;
export const OWNER_FLUX_IMAGE_GENERATION_HISTORY_REASONS = Object.freeze([
  "INVALID_INPUT", "HISTORY_INCOMPLETE", "HISTORY_SHAPE_INVALID", "HISTORY_PAGE_INVALID", "CHAT_SCOPE_MISMATCH",
  "PROVIDER_CHAT_INVALID", "HISTORY_EMPTY", "HISTORY_MESSAGE_SET_INVALID", "MESSAGE_ID_INVALID", "MESSAGE_ID_DUPLICATE",
  "MESSAGE_CHAT_MISMATCH", "OBJECT_ID_INVALID", "OBJECT_ID_DUPLICATE", "OWNER_ACK_NOT_FOUND", "OWNER_ACK_MISMATCH",
  "OWNER_ACK_AMBIGUOUS", "OWNER_OBJECTS_INVALID", "BOT_MESSAGE_NOT_FOUND", "BOT_MESSAGE_AMBIGUOUS",
  "BOT_MESSAGE_BEFORE_ACK", "BOT_OBJECTS_INVALID", "BOT_MODEL_MISMATCH"
] as const satisfies readonly OwnerFluxImageHistoryBindingReason[]);
export const OWNER_FLUX_IMAGE_GENERATION_RESULT_REASONS = Object.freeze([
  "NO_RESULT_OBJECTS", "RESULT_NOT_COMPLETED", "RESPONSE_SHAPE_INVALID", "OUTER_MESSAGE_MISMATCH", "PROVIDER_CHAT_MISMATCH",
  "NOT_BOT_MESSAGE", "RESULT_OBJECT_CARDINALITY_INVALID", "RESULT_OBJECT_SHAPE_INVALID", "OBJECT_ID_MISMATCH",
  "OBJECT_MESSAGE_MISMATCH", "OBJECT_TYPE_MISMATCH", "MODEL_TYPE_UNAVAILABLE", "MODEL_TYPE_MISMATCH", "RESULT_URL_UNSAFE"
] as const satisfies readonly OwnerFluxImageGenerationResultReason[]);
const HISTORY_EXACT: [Exclude<OwnerFluxImageHistoryBindingReason, typeof OWNER_FLUX_IMAGE_GENERATION_HISTORY_REASONS[number]>,
  Exclude<typeof OWNER_FLUX_IMAGE_GENERATION_HISTORY_REASONS[number], OwnerFluxImageHistoryBindingReason>] extends [never, never] ? true : never = true;
const RESULT_EXACT: [Exclude<OwnerFluxImageGenerationResultReason, typeof OWNER_FLUX_IMAGE_GENERATION_RESULT_REASONS[number]>,
  Exclude<typeof OWNER_FLUX_IMAGE_GENERATION_RESULT_REASONS[number], OwnerFluxImageGenerationResultReason>] extends [never, never] ? true : never = true;
void HISTORY_EXACT; void RESULT_EXACT;

export interface OwnerFluxImageGenerationDiagnostic {
  readonly phase: OwnerFluxImageGenerationPhase; readonly post_started: boolean; readonly echo_ack_known: boolean;
  readonly history_binding: "NONE" | "PENDING" | "READY" | "INVALID"; readonly history_binding_reason: OwnerFluxImageHistoryBindingReason | null;
  readonly history_get_calls: number; readonly history_get_calls_saturated: boolean; readonly result_get_calls: number;
  readonly result_get_calls_saturated: boolean; readonly result_status: "NOT_READ" | "PENDING" | "COMPLETE" | "UNVERIFIED";
  readonly result_reason: OwnerFluxImageGenerationResultReason | null;
}
export interface OwnerFluxImageGenerationResult {
  readonly status: "result_observed"; readonly namespace_confidence: "SOURCE_SHAPED_UNVERIFIED"; readonly backend_acceptance: "UNPROVEN";
  readonly ai_name: "flux"; readonly model_id: OwnerFluxImageModel; readonly variant: OwnerFluxImageModel; readonly operation_id: "generate-image";
  readonly profile_id: string; readonly profile_schema_hash: string; readonly catalog_version: string; readonly request_fingerprint: string;
  readonly parameters: OwnerFluxImagePreparedCandidate["parameters"]; readonly cost_inputs: Readonly<Record<string, never>>;
  readonly cost_input_confidence: string; readonly reference_count: number;
  readonly input_references: OwnerFluxImagePreparedCandidate["references"];
  readonly lora_assets: OwnerFluxImagePreparedCandidate["lora_assets"];
  readonly actual_image: Readonly<{ mime_type: string | null; width: null; height: null }>;
  readonly geometry_verified: false;
  readonly artifact: Readonly<{ url: string; mime_type: string | null; mime_source: "URL_EXTENSION" | "UNKNOWN"; width: null; height: null; geometry_verified: false }>;
  readonly legal_approval: "NOT_ESTABLISHED"; readonly license_compatibility: "UNPROVEN";
}
export interface OwnerFluxImageRecoveryListItem {
  readonly recovery_id: string; readonly created_at: string; readonly model_id: OwnerFluxImageModel;
  readonly operation_id: "generate-image"; readonly status: "OUTCOME_UNKNOWN"; readonly diagnostic: OwnerFluxImageGenerationDiagnostic;
}
export type OwnerFluxImageGenerationServiceErrorCode = typeof OWNER_FLUX_IMAGE_GENERATION_ERROR_CODES[number];
export class OwnerFluxImageGenerationServiceError extends Error {
  readonly diagnostic: OwnerFluxImageGenerationDiagnostic | undefined;
  constructor(readonly code: OwnerFluxImageGenerationServiceErrorCode, readonly recovery_id?: string, diagnostic?: OwnerFluxImageGenerationDiagnostic) {
    super(code === "OUTCOME_UNKNOWN" ? "The Flux image request may have been dispatched; reconcile with the same recovery handle and do not retry."
      : "The owner Flux image request could not be completed safely.");
    this.name = "OwnerFluxImageGenerationServiceError"; this.diagnostic = code === "OUTCOME_UNKNOWN" ? diagnostic : undefined;
  }
}
export interface OwnerFluxImageGenerationService {
  generate(input: OwnerFluxImageGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerFluxImageGenerationResult>;
  reconcile(input: OwnerFluxImageReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerFluxImageGenerationResult>;
  listRecoveries(input: OwnerFluxImageRecoveryListInput | unknown): Promise<readonly OwnerFluxImageRecoveryListItem[]>;
  invalidateAttempt(attemptId: string): Promise<void>; close(): Promise<void>;
}

function initialDiagnostic(): MutableDiagnostic { return { phase: "REQUEST_PREPARE", post_started: false, echo_ack_known: false,
  history_binding: "NONE", history_binding_reason: null, history_get_calls: 0, history_get_calls_saturated: false,
  result_get_calls: 0, result_get_calls_saturated: false, result_status: "NOT_READ", result_reason: null }; }
function increment(d: MutableDiagnostic, kind: "history" | "result"): void {
  const key = kind === "history" ? "history_get_calls" : "result_get_calls";
  const saturated = kind === "history" ? "history_get_calls_saturated" : "result_get_calls_saturated";
  if (d[key] >= MAX_COUNTER) d[saturated] = true; else d[key] += 1;
}
function sameResult(result: InternalOwnerFluxImageResult, recovery: Recovery): boolean {
  return result.chat_uuid === recovery.chat_uuid && result.message_id === recovery.result_message_id && result.variant === recovery.model_id &&
    result.provider_chat_id === recovery.provider_chat_id && isDeepStrictEqual(result.message_object_ids, recovery.message_object_ids);
}

export class OwnerFluxImageGenerationService implements OwnerFluxImageGenerationService {
  readonly #binding: Readonly<AuthBinding>; readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: DiscoveryCatalogRepository; readonly #catalogVersion: string; readonly #assetService: OwnerFluxImageAssetService;
  readonly #resolveChatClient: OwnerFluxImageGenerationServiceOptions["resolveChatClient"];
  readonly #preflight: OwnerFluxImageGenerationPreflight; readonly #now: () => number;
  readonly #timeoutMs: number; readonly #pollDelayMs: number; readonly #maxPollAttempts: number;
  readonly #wait: NonNullable<OwnerFluxImageGenerationServiceOptions["wait"]>;
  readonly #profiles = new Map<OwnerFluxImageModel, Readonly<OwnerFluxImageSourceProfile>>();
  readonly #recoveries = new Map<string, Recovery>(); readonly #claims = new Map<string, Claim>();
  readonly #assetSets = new Map<string, CachedAssetSet>(); readonly #pendingAssetSets = new Map<string, PendingAssetSet>();
  readonly #principals = new Map<string, CachedPrincipal>(); readonly #epochs = new Map<string, number>();
  readonly #runs = new Set<Promise<unknown>>(); readonly #runsByAttempt = new Map<string, Set<Promise<unknown>>>();
  readonly #controllersByAttempt = new Map<string, Set<AbortController>>(); readonly #invalidating = new Set<string>();
  #closed = false; #closing: Promise<void> | undefined; #lastNow = -1;

  constructor(options: OwnerFluxImageGenerationServiceOptions | unknown) {
    const fields = exact(options, ["binding", "linkService", "catalog", "catalog_version", "assetService", "resolveChatClient", "preflight"],
      ["now", "timeoutMs", "pollDelayMs", "maxPollAttempts", "wait"]);
    if (!(fields.assetService instanceof OwnerFluxImageAssetService) || types.isProxy(fields.assetService) ||
        Object.getPrototypeOf(fields.assetService) !== OwnerFluxImageAssetService.prototype ||
        !(fields.catalog instanceof DiscoveryCatalogRepository) || types.isProxy(fields.catalog) ||
        typeof fields.resolveChatClient !== "function" || types.isProxy(fields.resolveChatClient) ||
        typeof fields.preflight !== "function" || types.isProxy(fields.preflight) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now))) ||
        (fields.wait !== undefined && (typeof fields.wait !== "function" || types.isProxy(fields.wait)))) fail("INVALID_REQUEST");
    this.#binding = snapshotBinding(fields.binding); this.#linkService = snapshotLinkService(fields.linkService);
    this.#catalog = fields.catalog as DiscoveryCatalogRepository; this.#catalogVersion = readCatalogVersion(fields.catalog_version);
    this.#assetService = fields.assetService as OwnerFluxImageAssetService;
    this.#resolveChatClient = fields.resolveChatClient as OwnerFluxImageGenerationServiceOptions["resolveChatClient"];
    this.#preflight = fields.preflight as OwnerFluxImageGenerationPreflight;
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    this.#timeoutMs = bounded(fields.timeoutMs, 1, MAX_TIMEOUT, MAX_TIMEOUT);
    this.#pollDelayMs = bounded(fields.pollDelayMs, 0, MAX_DELAY, DEFAULT_DELAY);
    this.#maxPollAttempts = bounded(fields.maxPollAttempts, 1, MAX_POLLS, MAX_POLLS);
    this.#wait = fields.wait === undefined ? waitDelay : readWait(fields.wait);
    try { for (const model of OWNER_FLUX_IMAGE_MODELS) this.#profiles.set(model, getOwnerFluxImageSourceProfile(model, this.#catalog, this.#catalogVersion)); }
    catch { fail("MODEL_BINDING_MISMATCH"); }
  }

  generate(value: OwnerFluxImageGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerFluxImageGenerationResult> {
    const request = snapshotGenerate(value, this.#profiles);
    return this.#run(request.attemptId, signal, (requestSignal) => this.#generate(request, requestSignal));
  }

  reconcile(value: OwnerFluxImageReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerFluxImageGenerationResult> {
    const request = snapshotReconcile(value);
    return this.#run(request.attemptId, signal, (requestSignal) => this.#reconcile(request, requestSignal));
  }

  listRecoveries(value: OwnerFluxImageRecoveryListInput | unknown): Promise<readonly OwnerFluxImageRecoveryListItem[]> {
    const request = snapshotList(value);
    return this.#run(request.attemptId, undefined, async (signal) => {
      const principal = await this.#resolvePrincipal(request.attemptId, signal); this.#prune();
      return Object.freeze([...this.#recoveries.values()].filter((r) => r.attemptId === request.attemptId && sameGenerationPrincipal(r.principal, principal))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, request.limit)
        .map((r) => Object.freeze({ recovery_id: r.recovery_id, created_at: r.created_at, model_id: r.model_id,
          operation_id: OPERATION, status: "OUTCOME_UNKNOWN" as const, diagnostic: Object.freeze({ ...r.diagnostic }) })));
    });
  }

  async invalidateAttempt(attemptId: string): Promise<void> {
    if (!ATTEMPT.test(attemptId) || this.#closed || this.#invalidating.has(attemptId)) return;
    this.#invalidating.add(attemptId); this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    for (const controller of this.#controllersByAttempt.get(attemptId) ?? []) controller.abort();
    this.#clearPrivateAttempt(attemptId);
    try { await Promise.allSettled([...(this.#runsByAttempt.get(attemptId) ?? [])]); await this.#assetService.invalidateAttempt(attemptId); }
    finally { this.#invalidating.delete(attemptId); this.#releaseEpoch(attemptId); }
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing; this.#closed = true;
    for (const bucket of this.#controllersByAttempt.values()) for (const controller of bucket) controller.abort();
    this.#closing = (async () => { await Promise.allSettled([...this.#runs]); await this.#assetService.close(); this.#recoveries.clear();
      this.#assetSets.clear(); this.#pendingAssetSets.clear(); this.#principals.clear(); this.#epochs.clear(); this.#claims.clear(); })(); return this.#closing;
  }

  async #run<T>(attemptId: string, external: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.#assertOpen(); if (this.#invalidating.has(attemptId) || this.#runs.size >= MAX_PENDING) fail("SERVICE_BUSY");
    const controller = new AbortController(); const parentAbort = () => controller.abort();
    if (external?.aborted) controller.abort(); else external?.addEventListener("abort", parentAbort, { once: true });
    const controllers = this.#controllersByAttempt.get(attemptId) ?? new Set<AbortController>(); controllers.add(controller); this.#controllersByAttempt.set(attemptId, controllers);
    let pending!: Promise<T>; pending = Promise.resolve().then(() => operation(controller.signal));
    const tracked = pending.finally(() => { external?.removeEventListener("abort", parentAbort); controllers.delete(controller);
      if (!controllers.size) this.#controllersByAttempt.delete(attemptId); this.#runs.delete(tracked);
      const bucket = this.#runsByAttempt.get(attemptId); bucket?.delete(tracked); if (!bucket?.size) this.#runsByAttempt.delete(attemptId);
      this.#releaseEpoch(attemptId); });
    this.#runs.add(tracked); const bucket = this.#runsByAttempt.get(attemptId) ?? new Set<Promise<unknown>>(); bucket.add(tracked); this.#runsByAttempt.set(attemptId, bucket);
    return tracked;
  }

  async #generate(request: Request, signal: AbortSignal): Promise<OwnerFluxImageGenerationResult> {
    let recovery: Recovery | undefined; let claim: Claim | undefined; let postStarted = false;
    const deadline = this.#deadline(signal, () => recovery ? unknown(recovery) : error("PRE_DISPATCH_FAILED"));
    try {
      const principal = await this.#resolvePrincipal(request.attemptId, deadline.signal);
      const profile = this.#assertProfile(request.model_id);
      const assetSet = await this.#getAssetSet(request, principal, deadline);
      const loras = request.parameters.civitai_loras;
      if (assetSet.model_id !== request.model_id || assetSet.image_reference_count !== (request.image_reference_handle ? 1 : 0) ||
          assetSet.lora_count !== loras.length || assetSet.expires_at <= this.#readNow()) fail("REFERENCE_EXPIRED");
      const confirmed = await this.#resolvePrincipal(request.attemptId, deadline.signal);
      if (!sameGenerationPrincipal(principal, confirmed)) { await this.#invalidateState(request.attemptId); fail("PRINCIPAL_NOT_LINKED"); }
      const candidate0 = this.#prepare(request, principal, assetSet, profile);
      claim = this.#reserve(candidate0);
      const client = this.#resolveNative(request.attemptId);
      const first = await this.#await(deadline, () => this.#runPreflight(request, principal, candidate0, deadline.signal)).catch(() => fail("PREFLIGHT_FAILED"));
      this.#assertPreflight(first, candidate0);
      await this.#assertCurrent(request, principal, candidate0, assetSet, claim, deadline);
      const chat = await this.#await(deadline, () => client.createChat("image", `owner-flux-${randomUUID()}`, deadline.signal));
      if (!SAFE_ID.test(chat.chat_uuid)) fail("PRE_DISPATCH_FAILED");
      await this.#assertCurrent(request, principal, candidate0, assetSet, claim, deadline);
      const candidate = this.#prepare(request, principal, assetSet, profile);
      if (!sameCandidate(candidate0, candidate)) fail("PRE_DISPATCH_FAILED");
      const final = await this.#await(deadline, () => this.#runPreflight(request, principal, candidate, deadline.signal)).catch(() => fail("PREFLIGHT_FAILED"));
      this.#assertPreflight(final, candidate);
      await this.#assertCurrent(request, principal, candidate, assetSet, claim, deadline);
      this.#assertSynchronousCurrent(request, principal, candidate, assetSet, claim, deadline);
      this.#ensureCapacity(); recovery = this.#createRecovery(request, principal, candidate, assetSet.expires_at, chat.chat_uuid, claim);
      let permit;
      try { permit = createOwnerFluxImageOneShotPermit({ candidate, principal, attemptId: request.attemptId,
        catalog: this.#catalog, catalog_version: this.#catalogVersion, now: this.#now }); }
      catch (e) { this.#recoveries.delete(recovery.recovery_id); recovery = undefined; throw e; }
      this.#assertSynchronousCurrent(request, principal, candidate, assetSet, claim, deadline, recovery);
      // Input/candidate expiry still gates this point. Once the native call may
      // have dispatched, its recovery lifetime is owned by the retained witness,
      // not by the now-expiring source handles.
      recovery.post_dispatch_witness = Object.freeze({ attempt_id: recovery.attemptId, principal: recovery.principal,
        model_id: recovery.model_id, profile_schema_hash: candidate.profile_schema_hash, catalog_version: recovery.catalog_version,
        request_fingerprint: candidate.request_fingerprint, intent_fingerprint: candidate.intent_fingerprint,
        claim_key: claim.key, chat_uuid: recovery.chat_uuid });
      recovery.expires_at = null;
      recovery.diagnostic.phase = "GENERATION_POST"; recovery.diagnostic.post_started = true; claim.state = "POST_STARTED"; claim.attemptId = null; postStarted = true;
      const receipt = await this.#await(deadline, () => client.startFluxImageWithOwnedCandidate({ candidate, permit, principal,
        attemptId: request.attemptId, chat_uuid: chat.chat_uuid }, deadline.signal));
      if (!validAck(receipt, chat.chat_uuid)) fail("OUTCOME_UNKNOWN");
      recovery.owner_echo_message_id = receipt.message_id; recovery.diagnostic.echo_ack_known = true;
      recovery.diagnostic.phase = "POST_ACK_KNOWN"; claim.state = "OUTCOME_UNKNOWN";
      await this.#assertRecoveryCurrent(recovery, deadline);
      return await this.#observe(recovery, client, deadline);
    } catch (e) {
      if (postStarted && recovery) { if (claim) claim.state = "OUTCOME_UNKNOWN"; throw unknown(recovery); }
      if (recovery) this.#recoveries.delete(recovery.recovery_id);
      if (claim) this.#claims.delete(claim.key);
      if (e instanceof OwnerFluxImageGenerationServiceError) throw e;
      if (e instanceof OwnerFluxImageAssetServiceError) {
        if (e.code === "SERVICE_BUSY" || e.code === "CAPACITY_EXCEEDED") fail("SERVICE_BUSY");
        if (e.code === "REFERENCE_EXPIRED") fail("REFERENCE_EXPIRED");
        if (e.code === "PRINCIPAL_NOT_LINKED") fail("PRINCIPAL_NOT_LINKED");
        if (e.code === "MODEL_BINDING_MISMATCH") fail("MODEL_BINDING_MISMATCH");
        fail("REFERENCE_UNAVAILABLE");
      }
      if (e instanceof OwnerFluxImageOneShotPolicyError) {
        if (e.code === "CATALOG_BINDING_MISMATCH") fail("MODEL_BINDING_MISMATCH");
        if (e.code === "PERMIT_EXPIRED" || e.code === "CANDIDATE_EXPIRED") fail("REFERENCE_EXPIRED");
      }
      if (e instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      fail("PRE_DISPATCH_FAILED");
    } finally { deadline.close(); }
  }

  async #reconcile(request: Readonly<OwnerFluxImageReconcileInput>, signal: AbortSignal): Promise<OwnerFluxImageGenerationResult> {
    const deadline = this.#deadline(signal, () => { const item = this.#recoveries.get(request.recovery_id); return item ? unknown(item) : error("RECOVERY_NOT_FOUND"); });
    let item: Recovery | undefined;
    try { this.#prune(); item = this.#recoveries.get(request.recovery_id);
      if (!item || item.attemptId !== request.attemptId || (item.expires_at !== null && item.expires_at <= this.#readNow())) fail("RECOVERY_NOT_FOUND");
      const principal = await this.#resolvePrincipal(request.attemptId, deadline.signal);
      if (!sameGenerationPrincipal(principal, item.principal) || !item.owner_echo_message_id) throw unknown(item);
      const client = this.#resolveNative(request.attemptId); return await this.#observe(item, client, deadline);
    } catch (e) { if (e instanceof OwnerFluxImageGenerationServiceError && e.code === "RECOVERY_NOT_FOUND") throw e;
      if (!item) { if (e instanceof OwnerFluxImageGenerationServiceError) throw e; fail("PRE_DISPATCH_FAILED"); } throw unknown(item);
    } finally { deadline.close(); }
  }

  async #observe(item: Recovery, client: SyntxChatHttpClient, deadline: AbsoluteRequestDeadline): Promise<OwnerFluxImageGenerationResult> {
    if (!item.owner_echo_message_id) throw unknown(item);
    const started = this.#readNow(); let delay = this.#pollDelayMs;
    for (let round = 0; round < this.#maxPollAttempts; round++) {
      deadline.throwIfAborted(); if (item.expires_at !== null && item.expires_at <= this.#readNow()) throw unknown(item);
      if (!item.result_message_id || !item.provider_chat_id || !item.message_object_ids) {
        item.diagnostic.phase = "HISTORY_GET"; increment(item.diagnostic, "history");
        const snapshot = await this.#await(deadline, () => client.listMessageCandidates(item.chat_uuid, item.owner_echo_message_id!, deadline.signal));
        await this.#assertRecoveryCurrent(item, deadline); item.diagnostic.phase = "HISTORY_BINDING";
        const binding = correlateOwnerFluxImageHistoryBinding({ snapshot, requested_chat_uuid: item.chat_uuid,
          owner_echo_message_id: item.owner_echo_message_id, variant: item.model_id, requested_reference_count: item.candidate.reference_count,
          requested_output_count: 1 });
        item.diagnostic.history_binding = binding.status; item.diagnostic.history_binding_reason = binding.status === "INVALID" ? binding.reason : null;
        if (binding.status === "INVALID") throw unknown(item);
        if (binding.status === "READY") { item.provider_chat_id = binding.provider_chat_id; item.result_message_id = binding.result_message_id;
          item.message_object_ids = binding.message_object_ids; }
        else { delay = await this.#waitNext(item, deadline, started, round, delay); continue; }
      }
      item.diagnostic.phase = "RESULT_GET"; increment(item.diagnostic, "result");
      const result = await this.#await(deadline, () => client.getFluxImageResult({ chat_uuid: item.chat_uuid, message_id: item.result_message_id!,
        variant: item.model_id, provider_chat_id: item.provider_chat_id!, message_object_ids: item.message_object_ids! }, deadline.signal));
      await this.#assertRecoveryCurrent(item, deadline); item.diagnostic.phase = "RESULT_BINDING";
      item.diagnostic.result_status = result.status === "COMPLETE" ? "COMPLETE" : result.status;
      if (result.status === "UNVERIFIED") { item.diagnostic.result_reason = result.reason; throw unknown(item); }
      if (result.status === "PENDING") { item.diagnostic.result_reason = result.reason; delay = await this.#waitNext(item, deadline, started, round, delay); continue; }
      if (!sameResult(result, item) || this.#claims.get(item.claimKey)?.state !== "OUTCOME_UNKNOWN") throw unknown(item);
      this.#recoveries.delete(item.recovery_id); this.#claims.delete(item.claimKey); return resultFor(item, result);
    }
    throw unknown(item);
  }

  async #waitNext(item: Recovery, deadline: AbsoluteRequestDeadline, started: number, round: number, previous: number): Promise<number> {
    const now = this.#readNow(); const elapsed = now - started;
    if (!Number.isSafeInteger(elapsed) || elapsed < 0 || elapsed >= this.#timeoutMs ||
        (item.expires_at !== null && item.expires_at <= now)) throw unknown(item);
    const recoveryRemaining = item.expires_at === null ? Number.MAX_SAFE_INTEGER : item.expires_at - now;
    const next = Math.min(MAX_DELAY, round === 0 ? this.#pollDelayMs : Math.ceil(previous * 1.2), this.#timeoutMs - elapsed, recoveryRemaining);
    item.diagnostic.phase = "RESULT_WAIT"; if (next > 0) await this.#await(deadline, () => this.#wait(next, deadline.signal));
    await this.#assertRecoveryCurrent(item, deadline); return next;
  }

  async #runPreflight(request: Request, principal: Readonly<GenerationPrincipalRef>, candidate: OwnerFluxImagePreparedCandidate, signal: AbortSignal) {
    return this.#preflight(Object.freeze({ attemptId: request.attemptId, principal, variant: request.model_id,
      catalog_version: this.#catalogVersion, cost_inputs: Object.freeze({}), request_fingerprint: candidate.request_fingerprint, signal }));
  }
  async #getAssetSet(request: Request, principal: Readonly<GenerationPrincipalRef>, deadline: AbsoluteRequestDeadline): Promise<OwnerFluxImageAssetSet> {
    this.#prune();
    const loras = request.parameters.civitai_loras.map((item) => Object.freeze({ handle: item.handle,
      strength_model: item.strength_model, strength_clip: item.strength_clip }));
    const key = schemaHash({ attempt_id: request.attemptId, principal: { tenant_id: principal.tenant_id, subject_id: principal.subject_id },
      model_id: request.model_id, image_reference_handle: request.image_reference_handle ?? null, lora_references: loras });
    const cached = this.#assetSets.get(key);
    if (cached) {
      if (cached.expiresAt <= this.#readNow() || cached.attemptId !== request.attemptId || !sameGenerationPrincipal(cached.principal, principal)) {
        this.#assetSets.delete(key); fail("REFERENCE_EXPIRED");
      }
      return cached.set;
    }
    let pending = this.#pendingAssetSets.get(key)?.promise;
    if (!pending) {
      if (this.#assetSets.size + this.#pendingAssetSets.size >= MAX_STATES) fail("SERVICE_BUSY");
      pending = this.#assetService.issueAssets({ attemptId: request.attemptId, model_id: request.model_id,
        ...(request.image_reference_handle === undefined ? {} : { image_reference_handle: request.image_reference_handle }), lora_references: loras });
      this.#pendingAssetSets.set(key, { attemptId: request.attemptId, promise: pending });
      void pending.finally(() => { if (this.#pendingAssetSets.get(key)?.promise === pending) this.#pendingAssetSets.delete(key); }).catch(() => undefined);
    }
    const set = await this.#await(deadline, () => pending!);
    if (set.model_id !== request.model_id || set.image_reference_count !== (request.image_reference_handle ? 1 : 0) ||
        set.lora_count !== loras.length || set.expires_at <= this.#readNow()) fail("REFERENCE_EXPIRED");
    this.#prune();
    if (!this.#assetSets.has(key) && this.#assetSets.size >= MAX_STATES) fail("SERVICE_BUSY");
    this.#assetSets.set(key, Object.freeze({ set, attemptId: request.attemptId, principal, expiresAt: set.expires_at }));
    return set;
  }
  #prepare(request: Request, principal: Readonly<GenerationPrincipalRef>, assetSet: OwnerFluxImageAssetSet,
    _profile: Readonly<OwnerFluxImageSourceProfile>): OwnerFluxImagePreparedCandidate {
    return prepareOwnerFluxImageRequest({ principal, attempt_id: request.attemptId, model_id: request.model_id,
      parameters: request.parameters, asset_set: assetSet, prompt: request.prompt },
    { catalog: this.#catalog, catalog_version: this.#catalogVersion, now: this.#now });
  }
  #reserve(candidate: OwnerFluxImagePreparedCandidate): Claim {
    this.#prune(); const state = getOwnerFluxImagePreparedCandidateState(candidate);
    if (!state || state.intent_fingerprint !== candidate.intent_fingerprint || state.request_fingerprint !== candidate.request_fingerprint) fail("PRE_DISPATCH_FAILED");
    const key = state.intent_fingerprint; if (this.#claims.has(key)) fail("REFERENCE_ALREADY_CLAIMED");
    if (this.#claims.size >= MAX_STATES || this.#recoveries.size >= MAX_STATES) fail("SERVICE_BUSY");
    const claim: Claim = { key, attemptId: state.attempt_id, state: "PREPARING" }; this.#claims.set(key, claim); return claim;
  }
  #createRecovery(request: Request, principal: Readonly<GenerationPrincipalRef>, candidate: OwnerFluxImagePreparedCandidate,
    assetExpiry: number, chat: string, claim: Claim): Recovery {
    this.#ensureCapacity(); const now = this.#readNow(); const expiry = Math.min(candidate.expires_at, assetExpiry, now + TTL);
    if (!Number.isSafeInteger(expiry) || expiry <= now) fail("REFERENCE_EXPIRED");
    const item: Recovery = { recovery_id: `flux_image_recovery_${randomUUID()}`, attemptId: request.attemptId, principal,
      model_id: request.model_id, candidate, created_at: new Date(now).toISOString(), expires_at: expiry, claimKey: claim.key,
      chat_uuid: chat, catalog_version: this.#catalogVersion, post_dispatch_witness: null,
      owner_echo_message_id: null, provider_chat_id: null, result_message_id: null, message_object_ids: null,
      diagnostic: initialDiagnostic() };
    this.#recoveries.set(item.recovery_id, item); return item;
  }
  async #assertCurrent(request: Request, principal: Readonly<GenerationPrincipalRef>, candidate: OwnerFluxImagePreparedCandidate,
    assetSet: { readonly expires_at: number }, claim: Claim, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted(); const current = await this.#resolvePrincipal(request.attemptId, deadline.signal);
    if (!sameGenerationPrincipal(current, principal)) { this.#invalidateState(request.attemptId); fail("PRINCIPAL_NOT_LINKED"); }
    this.#assertSynchronousCurrent(request, principal, candidate, assetSet, claim, deadline);
  }
  #assertSynchronousCurrent(request: Request, principal: Readonly<GenerationPrincipalRef>, candidate: OwnerFluxImagePreparedCandidate,
    assetSet: { readonly expires_at: number }, claim: Claim, deadline: AbsoluteRequestDeadline, recovery?: Recovery): void {
    deadline.throwIfAborted(); const now = this.#readNow(); const cached = this.#principals.get(request.attemptId);
    const profile = this.#assertProfile(request.model_id);
    if (this.#closed || this.#invalidating.has(request.attemptId) || !cached || cached.expiresAt <= now || !sameGenerationPrincipal(cached.principal, principal) ||
        profile.profile_schema_hash !== candidate.profile_schema_hash || candidate.expires_at <= now || assetSet.expires_at <= now ||
        !isOwnerFluxImagePreparedCandidateForPrincipal(candidate, principal, request.attemptId, now) || !observeOwnerFluxImageCandidateClock(candidate, now) ||
        this.#claims.get(claim.key) !== claim || (recovery && (recovery.expires_at === null || recovery.expires_at <= now ||
          this.#recoveries.get(recovery.recovery_id) !== recovery))) fail("REFERENCE_UNAVAILABLE");
  }
  async #assertRecoveryCurrent(item: Recovery, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted(); const current = await this.#resolvePrincipal(item.attemptId, deadline.signal);
    const profile = this.#assertProfile(item.model_id);
    const now = this.#readNow();
    const candidateState = getOwnerFluxImagePreparedCandidateState(item.candidate);
    const witness = item.post_dispatch_witness;
    if (!sameGenerationPrincipal(current, item.principal) || this.#closed || this.#invalidating.has(item.attemptId) ||
        (item.expires_at !== null && item.expires_at <= now) || !candidateState || candidateState.attempt_id !== item.attemptId ||
        !sameGenerationPrincipal(candidateState.principal, item.principal) ||
        !witness || witness.attempt_id !== item.attemptId || !sameGenerationPrincipal(witness.principal, item.principal) ||
        witness.model_id !== item.model_id || witness.profile_schema_hash !== item.candidate.profile_schema_hash ||
        witness.catalog_version !== item.catalog_version || witness.catalog_version !== this.#catalogVersion ||
        witness.request_fingerprint !== item.candidate.request_fingerprint || witness.intent_fingerprint !== item.candidate.intent_fingerprint ||
        witness.intent_fingerprint !== item.claimKey || witness.claim_key !== item.claimKey || witness.chat_uuid !== item.chat_uuid ||
        item.candidate.model_id !== item.model_id || profile.profile_schema_hash !== witness.profile_schema_hash ||
        candidateState.request_fingerprint !== witness.request_fingerprint || candidateState.intent_fingerprint !== witness.intent_fingerprint ||
        this.#claims.get(item.claimKey)?.state !== "OUTCOME_UNKNOWN" || this.#recoveries.get(item.recovery_id) !== item) throw unknown(item);
  }
  #assertProfile(model: OwnerFluxImageModel): Readonly<OwnerFluxImageSourceProfile> {
    let current: Readonly<OwnerFluxImageSourceProfile>; try { current = getOwnerFluxImageSourceProfile(model, this.#catalog, this.#catalogVersion); }
    catch { fail("MODEL_BINDING_MISMATCH"); }
    if (current.profile_schema_hash !== this.#profiles.get(model)?.profile_schema_hash || current.public_catalog_version !== this.#catalogVersion) fail("MODEL_BINDING_MISMATCH");
    return current;
  }
  #assertPreflight(value: unknown, candidate: OwnerFluxImagePreparedCandidate): void {
    let top: Record<string, unknown>; let account: Record<string, unknown>; let balance: Record<string, unknown>; let sub: Record<string, unknown>; let access: Record<string, unknown>;
    try { top = exact(value, ["account", "model_access"]); account = exact(top.account, ["balance", "subscription", "contract_evidence", "source_build", "observed_at"]);
      balance = exact(account.balance, ["unit", "available"]); sub = exact(account.subscription, ["active", "plan_type", "end_date", "end_date_kind"]);
      access = exact(top.model_access, ["catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live", "parameter_keys",
        "parameters_redacted", "access", "cost", "discount_cost", "free_remaining_generations", "limit", "show_warning", "observed_at"]); }
    catch { fail("PREFLIGHT_FAILED"); }
    const now = this.#readNow(); let model: ReturnType<DiscoveryCatalogRepository["getModel"]>; try { model = this.#catalog.getModel(candidate.variant); } catch { fail("PREFLIGHT_FAILED"); }
    const subValid = validSubscription(sub, now);
    const expectedVersion = `${this.#catalog.fetched_at}.${this.#catalog.source_hashes.models.slice(7, 19)}`;
    if (account.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || account.source_build !== ACCOUNT_SOURCE_BUILD || balance.unit !== "tokens" ||
        !(balance.available === null || typeof balance.available === "string") || !subValid || !isFresh(account.observed_at, now) ||
        access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || access.catalog_version !== expectedVersion || access.model_id !== candidate.variant ||
        access.ai_name !== "flux" || access.model_type !== candidate.variant || access.account_read_live !== true || access.access !== true || access.parameters_redacted !== true ||
        !sameStrings(access.parameter_keys, []) || !isFresh(access.observed_at, now) || !nonnegative(access.cost) ||
        !(access.discount_cost === null || nonnegative(access.discount_cost)) || !(access.free_remaining_generations === null || integer(access.free_remaining_generations)) ||
        !(access.limit === null || nonnegative(access.limit)) || !(access.show_warning === null || typeof access.show_warning === "boolean") ||
        model.id !== candidate.variant || model.upstream_id !== candidate.variant || model.ai_name !== "flux" || model.active !== true || model.scope !== "image" ||
        !model.modalities.includes("image") || !model.operations.some((op) => op.id === OPERATION && op.output_modality === "image")) fail("PREFLIGHT_FAILED");
  }
  #resolveNative(attemptId: string): SyntxChatHttpClient {
    const client = this.#resolveChatClient(attemptId);
    if (!(client instanceof SyntxChatHttpClient) || types.isProxy(client) || Object.getPrototypeOf(client) !== SyntxChatHttpClient.prototype ||
        client.createChat !== METHODS.createChat || client.startFluxImageWithOwnedCandidate !== METHODS.start ||
        client.listMessageCandidates !== METHODS.history || client.getFluxImageResult !== METHODS.result) fail("MODEL_BINDING_MISMATCH");
    return client;
  }
  async #resolvePrincipal(attemptId: string, signal: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    this.#assertOpen(); if (this.#invalidating.has(attemptId)) fail("PRINCIPAL_NOT_LINKED"); this.#prune();
    try {
      const promise = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
      const principal = await this.#awaitSignal(promise, signal); const cached = this.#principals.get(attemptId);
      if (cached && !sameGenerationPrincipal(cached.principal, principal)) { this.#invalidateState(attemptId); fail("PRINCIPAL_NOT_LINKED"); }
      if (!cached) {
        if (this.#principals.size >= MAX_STATES) fail("SERVICE_BUSY");
        this.#principals.set(attemptId, Object.freeze({ principal, expiresAt: this.#readNow() + TTL }));
      }
      return principal;
    } catch (e) {
      if (e instanceof OwnerReferencePrincipalError) this.#invalidateState(attemptId);
      if (e instanceof OwnerFluxImageGenerationServiceError) throw e;
      fail("PRINCIPAL_NOT_LINKED");
    }
  }
  #await<T>(deadline: AbsoluteRequestDeadline, operation: () => Promise<T> | T): Promise<T> { deadline.throwIfAborted(); return deadline.waitFor(Promise.resolve().then(operation)); }
  #awaitSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(new Error("ABORTED"));
    return new Promise<T>((resolve, reject) => { const abort = () => reject(new Error("ABORTED")); signal.addEventListener("abort", abort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort)); });
  }
  #deadline(signal: AbortSignal, makeError?: () => Error): AbsoluteRequestDeadline { return new AbsoluteRequestDeadline(this.#timeoutMs, signal, () => makeError?.() ?? error("PRE_DISPATCH_FAILED")); }
  #readNow(): number { let n: unknown; try { n = this.#now(); } catch { fail("PRE_DISPATCH_FAILED"); }
    if (!Number.isSafeInteger(n) || (n as number) < 0 || (n as number) < this.#lastNow) fail("PRE_DISPATCH_FAILED"); this.#lastNow = n as number; return n as number; }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  #ensureCapacity(): void { this.#prune(); if (this.#recoveries.size >= MAX_STATES) fail("SERVICE_BUSY"); }
  #prune(): void { const now = this.#readNow(); for (const [id, item] of this.#recoveries) if (item.expires_at !== null && item.expires_at <= now) this.#recoveries.delete(id);
    for (const [key, item] of this.#assetSets) if (item.expiresAt <= now) this.#assetSets.delete(key);
    for (const [id, principal] of this.#principals) if (principal.expiresAt <= now && ![...this.#recoveries.values()].some((r) => r.attemptId === id)) this.#principals.delete(id); }
  #invalidateState(attemptId: string): void { this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    for (const controller of this.#controllersByAttempt.get(attemptId) ?? []) controller.abort(); this.#clearPrivateAttempt(attemptId); }
  #clearPrivateAttempt(attemptId: string): void { this.#principals.delete(attemptId);
    for (const [key, item] of this.#assetSets) if (item.attemptId === attemptId) this.#assetSets.delete(key);
    for (const [key, item] of this.#pendingAssetSets) if (item.attemptId === attemptId) this.#pendingAssetSets.delete(key);
    for (const [id, r] of this.#recoveries) if (r.attemptId === attemptId) this.#recoveries.delete(id);
    for (const [key, claim] of this.#claims) if (claim.attemptId === attemptId) {
      if (claim.state === "PREPARING") this.#claims.delete(key); else claim.attemptId = null;
    } }
  #releaseEpoch(attemptId: string): void { if (!this.#runsByAttempt.has(attemptId) && !this.#principals.has(attemptId) && ![...this.#recoveries.values()].some((r) => r.attemptId === attemptId) && !this.#invalidating.has(attemptId)) this.#epochs.delete(attemptId); }
}

function snapshotGenerate(value: unknown, profiles: ReadonlyMap<OwnerFluxImageModel, Readonly<OwnerFluxImageSourceProfile>>): Request {
  const f = exact(value, ["attemptId", "model_id", "prompt", "parameters"], ["image_reference_handle"]);
  if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || typeof f.model_id !== "string" ||
      !(OWNER_FLUX_IMAGE_MODELS as readonly string[]).includes(f.model_id) || typeof f.prompt !== "string") fail("INVALID_REQUEST");
  const model = f.model_id as OwnerFluxImageModel; const profile = profiles.get(model); if (!profile) fail("MODEL_BINDING_MISMATCH");
  if (f.image_reference_handle !== undefined && (typeof f.image_reference_handle !== "string" || !IMAGE_HANDLE.test(f.image_reference_handle))) fail("INVALID_REQUEST");
  const p = exact(f.parameters, ["resolution", "cfg", "steps", "image_strength", "workflow_type", "raw", "civitai_loras"]);
  const loras = denseArray(p.civitai_loras, 3).map((item) => { const x = exact(item, ["handle", "strength_model", "strength_clip"]);
    if (typeof x.handle !== "string" || !LORA_HANDLE.test(x.handle) || typeof x.strength_model !== "number" || !Number.isFinite(x.strength_model) ||
        x.strength_clip !== x.strength_model) fail("INVALID_REQUEST"); return Object.freeze({ handle: x.handle, strength_model: x.strength_model, strength_clip: x.strength_clip }); });
  return Object.freeze({ attemptId: f.attemptId, model_id: model, prompt: f.prompt,
    ...(f.image_reference_handle === undefined ? {} : { image_reference_handle: f.image_reference_handle as string }),
    parameters: Object.freeze({ resolution: p.resolution, cfg: p.cfg, steps: p.steps, image_strength: p.image_strength,
      workflow_type: p.workflow_type, raw: p.raw, civitai_loras: Object.freeze(loras) }) as OwnerFluxImageGenerationParameters });
}
function snapshotReconcile(v: unknown): Readonly<OwnerFluxImageReconcileInput> { const f = exact(v, ["attemptId", "recovery_id"]);
  if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || typeof f.recovery_id !== "string" || !RECOVERY.test(f.recovery_id)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: f.attemptId, recovery_id: f.recovery_id }); }
function snapshotList(v: unknown): Readonly<{attemptId:string;limit:number}> { const f = exact(v, ["attemptId"], ["limit"]);
  const limit = f.limit === undefined ? 20 : f.limit; if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: f.attemptId, limit }); }
function sameCandidate(a: OwnerFluxImagePreparedCandidate, b: OwnerFluxImagePreparedCandidate): boolean { return a.request_fingerprint === b.request_fingerprint && a.intent_fingerprint === b.intent_fingerprint &&
  isDeepStrictEqual(a.request, b.request) && isDeepStrictEqual(a.parameters, b.parameters) && isDeepStrictEqual(a.cost_inputs, b.cost_inputs) &&
  isDeepStrictEqual(a.references, b.references) && isDeepStrictEqual(a.lora_assets, b.lora_assets); }
function resultFor(r: Recovery, result: Extract<InternalOwnerFluxImageResult,{status:"COMPLETE"}>): OwnerFluxImageGenerationResult {
  const artifact = Object.freeze({ url: result.artifact.url, mime_type: result.artifact.mime_type, mime_source: result.artifact.mime_source,
    width: null, height: null, geometry_verified: false as const });
  return Object.freeze({ status: "result_observed", namespace_confidence: "SOURCE_SHAPED_UNVERIFIED", backend_acceptance: "UNPROVEN",
    ai_name: "flux", model_id: r.model_id, variant: r.model_id, operation_id: OPERATION, profile_id: r.candidate.profile_id,
    profile_schema_hash: r.candidate.profile_schema_hash, catalog_version: r.catalog_version,
    request_fingerprint: r.candidate.request_fingerprint, parameters: r.candidate.parameters, cost_inputs: Object.freeze({}),
    cost_input_confidence: r.candidate.cost_input_confidence, reference_count: r.candidate.reference_count,
    input_references: r.candidate.references, lora_assets: r.candidate.lora_assets,
    actual_image: Object.freeze({ mime_type: artifact.mime_type, width: null, height: null }), geometry_verified: false, artifact,
    legal_approval: "NOT_ESTABLISHED", license_compatibility: "UNPROVEN" }); }
function validAck(v: unknown, chat: string): v is MediaGenerationReceipt { try { const f = exact(v, ["chat_uuid", "message_id"]); return f.chat_uuid === chat && typeof f.message_id === "string" && SAFE_ID.test(f.message_id); } catch { return false; } }
function isFresh(v: unknown, now: number): boolean { if (typeof v !== "string") return false; const parsed = Date.parse(v); return Number.isFinite(parsed) && parsed <= now && now - parsed <= MAX_SKEW && new Date(parsed).toISOString() === v; }
function validSubscription(v: Record<string, unknown>, now: number): boolean {
  if (v.active !== true || !(v.plan_type === null || typeof v.plan_type === "string")) return false;
  if (v.end_date === null) return v.end_date_kind === null;
  if (typeof v.end_date !== "string" || v.end_date_kind !== "OFFSET_DATETIME" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(v.end_date)) return false;
  const expiry = Date.parse(v.end_date); return Number.isFinite(expiry) && expiry > now;
}
function sameStrings(v: unknown, expected: readonly string[]): boolean { return Array.isArray(v) && v.length === expected.length && v.every((x, i) => x === expected[i]); }
function nonnegative(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v) && v >= 0; }
function integer(v: unknown): v is number { return typeof v === "number" && Number.isSafeInteger(v) && v >= 0; }
function exact(v: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, any> {
  if (!v || typeof v !== "object" || Array.isArray(v) || types.isProxy(v)) fail("INVALID_REQUEST"); let proto: object | null; let desc: PropertyDescriptorMap;
  try { proto = Object.getPrototypeOf(v); desc = Object.getOwnPropertyDescriptors(v); } catch { fail("INVALID_REQUEST"); }
  if (proto !== Object.prototype && proto !== null) fail("INVALID_REQUEST"); const keys = Reflect.ownKeys(desc); const allowed = [...required, ...optional];
  if (required.some((k) => !Object.hasOwn(desc, k)) || keys.some((k) => typeof k !== "string" || !allowed.includes(k) || !("value" in desc[k]!) || !desc[k]!.enumerable)) fail("INVALID_REQUEST");
  const out = Object.create(null) as Record<string, any>; for (const k of keys as string[]) out[k] = desc[k]!.value; return out; }
function denseArray(v: unknown, max: number): unknown[] { if (!Array.isArray(v) || types.isProxy(v) || Object.getPrototypeOf(v) !== Array.prototype || v.length > max) fail("INVALID_REQUEST");
  const d = Object.getOwnPropertyDescriptors(v); const keys = Reflect.ownKeys(d); if (keys.length !== v.length + 1 || keys.some((k) => k !== "length" && (typeof k !== "string" || !/^(?:0|[1-9]\d*)$/u.test(k)))) fail("INVALID_REQUEST");
  return Array.from({length:v.length},(_,i)=>{const x=d[String(i)];if(!x||!("value" in x)||!x.enumerable)fail("INVALID_REQUEST");return x.value;}); }
function snapshotBinding(v: unknown): Readonly<AuthBinding> { const f=exact(v,["tenant_id","subject"]);
  if(typeof f.tenant_id!=="string"||f.tenant_id.length<1||f.tenant_id.length>256||/[\u0000-\u001f\u007f]/u.test(f.tenant_id)||
     typeof f.subject!=="string"||f.subject.length<1||f.subject.length>512||/[\u0000-\u001f\u007f]/u.test(f.subject))fail("INVALID_REQUEST");
  return Object.freeze({tenant_id:f.tenant_id,subject:f.subject}); }
function snapshotLinkService(v: unknown): Pick<PerUserLinkService,"getStatus"> { if(!v||typeof v!=="object"||types.isProxy(v))fail("INVALID_REQUEST");let cur:object|null=v;let method:unknown;
  while(cur){const d=Object.getOwnPropertyDescriptor(cur,"getStatus");if(d){method="value" in d?d.value:undefined;break;}cur=Object.getPrototypeOf(cur) as object|null;}
  if(typeof method!=="function"||types.isProxy(method))fail("INVALID_REQUEST");return Object.freeze({getStatus:(binding:AuthBinding,id:string)=>Reflect.apply(method as Function,v,[binding,id])}) as Pick<PerUserLinkService,"getStatus">; }
function readCatalogVersion(v: unknown): string { if(v!==DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION)fail("MODEL_BINDING_MISMATCH");return v; }
function bounded(v:unknown,min:number,max:number,fallback:number):number {if(v===undefined)return fallback;if(typeof v!=="number"||!Number.isSafeInteger(v)||v<min||v>max)fail("INVALID_REQUEST");return v;}
function readClock(v:unknown):()=>number {if(typeof v!=="function"||types.isProxy(v))fail("INVALID_REQUEST");return()=>{const n=Reflect.apply(v,undefined,[]);if(!Number.isSafeInteger(n)||n<0)fail("PRE_DISPATCH_FAILED");return n as number;};}
function readWait(v:unknown):NonNullable<OwnerFluxImageGenerationServiceOptions["wait"]> {if(typeof v!=="function"||types.isProxy(v))fail("INVALID_REQUEST");return v as NonNullable<OwnerFluxImageGenerationServiceOptions["wait"]>;}
function waitDelay(ms:number,signal:AbortSignal):Promise<void>{if(signal.aborted)return Promise.reject(new Error("ABORTED"));return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{signal.removeEventListener("abort",abort);resolve();},ms);const abort=()=>{clearTimeout(timer);signal.removeEventListener("abort",abort);reject(new Error("ABORTED"));};signal.addEventListener("abort",abort,{once:true});});}
function fail(code:OwnerFluxImageGenerationServiceErrorCode):never{throw error(code);}
function error(code:OwnerFluxImageGenerationServiceErrorCode,recoveryId?:string,diagnostic?:OwnerFluxImageGenerationDiagnostic):OwnerFluxImageGenerationServiceError{return new OwnerFluxImageGenerationServiceError(code,recoveryId,diagnostic);}
function unknown(r:Recovery):OwnerFluxImageGenerationServiceError{return error("OUTCOME_UNKNOWN",r.recovery_id,Object.freeze({...r.diagnostic}));}
