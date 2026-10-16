import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import {
  OwnerGrokV2vNativeError,
  readOwnerGrokV2vNativeDispatchStatus,
  type OwnerGrokV2vNativeChatContext,
  type OwnerGrokV2vNativeResultCandidates,
  type OwnerGrokV2vNativeResultContext,
  type OwnerGrokV2vNativeVideoArtifact
} from "../adapter/syntx/owner-grok-v2v-native-context.js";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { AccountStatusService, type AccountStatusResult } from "./account-status.js";
import { ModelAccessService, type ModelAccessResult } from "./model-access.js";
import {
  OwnerGrokV2vOriginalReferenceService
} from "./owner-grok-v2v-original-reference-service.js";
import {
  createOwnerGrokV2vOwnedOneShotPermit,
  revalidateOwnerGrokV2vOwnedOneShotPermit,
  type OwnerGrokV2vOwnedOneShotPermit,
  OwnerGrokV2vOwnedOneShotPolicyError
} from "./owner-grok-v2v-owned-one-shot-policy.js";
import {
  isOwnerGrokV2vOwnedPreparedCandidate,
  isOwnerGrokV2vOwnedRequestPreparer,
  isOwnerGrokV2vOwnedRequestPreparerBoundToReferenceService,
  OwnerGrokV2vOwnedRequestPreparer,
  type OwnerGrokV2vOwnedCandidateBinding,
  type OwnerGrokV2vOwnedPreparedCandidate
} from "./owner-grok-v2v-owned-request-preparer.js";
import {
  isOwnerGrokV2vMeasuredSettingsCandidate,
  isOwnerGrokV2vNormalizedParameters,
  normalizeOwnerGrokV2vParameters,
  projectOwnerGrokV2vMeasuredSettings,
} from "./owner-grok-v2v-parameters.js";
import {
  getOwnerGrokV2vSourceProfile,
  OWNER_GROK_V2V_MODEL_ID,
  OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION,
  type OwnerGrokV2vSourceProfile
} from "./owner-grok-v2v-source-profile.js";

export const OWNER_GROK_V2V_GENERATION_CATALOG_VERSION = OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION;
const MODEL_ID = OWNER_GROK_V2V_MODEL_ID;
const AI_NAME = "grok_video" as const;
const ACCOUNT = AccountStatusService.prototype.getAccountStatus;
const ACCESS = ModelAccessService.prototype.getModelAccess;
const CREATE = SyntxChatHttpClient.prototype.createOwnerGrokV2vChat;
const START = SyntxChatHttpClient.prototype.startGrokV2vWithOwnedCandidate;
const LIST = SyntxChatHttpClient.prototype.listOwnedGrokV2vCandidates;
const GET = SyntxChatHttpClient.prototype.getOwnedGrokV2vResult;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY = /^grok_v2v_recovery_[0-9a-f-]{36}$/u;
const SERVICES = new WeakSet<object>();
const MAX_RECOVERIES = 128;
const MAX_RUNS = 4;
const PAGE_SIZE = 64;
const TIMEOUT_MS = 120_000;

export type OwnerGrokV2vGenerationPhase = "VALIDATE_REQUEST" | "PREFLIGHT_ONE" | "CHAT_CREATE" | "PREFLIGHT_TWO" |
  "GENERATION_POST" | "POST_ACK_KNOWN" | "HISTORY_GET" | "RESULT_GET";

export interface OwnerGrokV2vGenerationDiagnostic {
  readonly phase: OwnerGrokV2vGenerationPhase;
  readonly post_started: boolean;
  readonly ack_known: boolean;
  readonly history_status: "NOT_READ" | "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "NOT_READ" | "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  readonly request_echo_status: "NOT_READ" | "MATCHED" | "ABSENT" | "PARTIAL_UNPROVEN" | "CONTRADICTORY";
  readonly history_get_calls: number;
  readonly result_get_calls: number;
  readonly result_status: "NOT_READ" | "COMPLETE" | "UNVERIFIED";
  readonly gaps: readonly string[];
}

export interface OwnerGrokV2vGenerationArtifact extends OwnerGrokV2vNativeVideoArtifact {
  readonly message_id: string;
  readonly chat_uuid: string;
  readonly model_id: typeof MODEL_ID;
}

export interface OwnerGrokV2vGenerationResult {
  readonly status: "completed";
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly backend_acceptance: "UNPROVEN";
  readonly provider_terminal_status: "UNPROVEN";
  readonly cost_cap_enforced: false;
  readonly output_count: "UNKNOWN";
  readonly recovery_id: string;
  readonly model_id: typeof MODEL_ID;
  readonly source_binding: Readonly<{
    public_catalog_version: string;
    profile_schema_hash: string;
    request_fingerprint: string;
    intent_fingerprint: string;
  }>;
  readonly observed_artifact_count: number;
  readonly offset: number;
  readonly page_size: 64;
  readonly artifacts: readonly OwnerGrokV2vGenerationArtifact[];
  readonly has_more: boolean;
  readonly next_offset: number | null;
  readonly diagnostic: OwnerGrokV2vGenerationDiagnostic;
}

export interface OwnerGrokV2vRecoveryListItem {
  readonly recovery_id: string;
  readonly created_at: string;
  readonly model_id: typeof MODEL_ID;
  readonly status: "outcome_unknown" | "completed";
  readonly observed_artifact_count: number;
  readonly diagnostic: OwnerGrokV2vGenerationDiagnostic;
}

export interface OwnerGrokV2vGenerationServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string;
  readonly preparer: OwnerGrokV2vOwnedRequestPreparer;
  readonly referenceService: OwnerGrokV2vOriginalReferenceService;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly createAccountStatusService: (attemptId: string) => AccountStatusService;
  readonly createModelAccessService: (attemptId: string) => ModelAccessService;
  readonly now?: () => number;
}

export interface OwnerGrokV2vGenerateInput {
  readonly attemptId: string;
  readonly request: Readonly<{
    model_id: typeof MODEL_ID;
    prompt: string;
    grok_reference_handle: string;
  }>;
}
export interface OwnerGrokV2vReconcileInput { readonly attemptId: string; readonly recovery_id: string }
export interface OwnerGrokV2vRecoveryListInput { readonly attemptId: string; readonly limit?: number }
export interface OwnerGrokV2vResultPageInput { readonly attemptId: string; readonly recovery_id: string; readonly offset?: number }

export type OwnerGrokV2vGenerationServiceErrorCode =
  | "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH"
  | "PREFLIGHT_FAILED" | "INTENT_ALREADY_CLAIMED" | "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND";

export class OwnerGrokV2vGenerationServiceError extends Error {
  readonly diagnostic?: OwnerGrokV2vGenerationDiagnostic;
  constructor(readonly code: OwnerGrokV2vGenerationServiceErrorCode, readonly recovery_id?: string,
    diagnostic?: OwnerGrokV2vGenerationDiagnostic) {
    super("The owner Grok V2V request could not be completed safely.");
    this.name = "OwnerGrokV2vGenerationServiceError";
    if (code === "OUTCOME_UNKNOWN" && diagnostic) this.diagnostic = diagnostic;
  }
}

interface Recovery {
  readonly recovery_id: string;
  readonly attemptId: string;
  readonly semantic_key: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly created_at: string;
  readonly candidate: OwnerGrokV2vOwnedPreparedCandidate;
  readonly permit: OwnerGrokV2vOwnedOneShotPermit;
  readonly chat: OwnerGrokV2vNativeChatContext;
  readonly client: SyntxChatHttpClient;
  readonly binding: Readonly<OwnerGrokV2vOwnedCandidateBinding>;
  owner_echo_message_id: string | null;
  status: "outcome_unknown" | "completed";
  artifacts: readonly OwnerGrokV2vGenerationArtifact[];
  d: {
    phase: OwnerGrokV2vGenerationPhase;
    post_started: boolean;
    ack_known: boolean;
    history_status: OwnerGrokV2vGenerationDiagnostic["history_status"];
    owner_ack_status: OwnerGrokV2vGenerationDiagnostic["owner_ack_status"];
    request_echo_status: OwnerGrokV2vGenerationDiagnostic["request_echo_status"];
    history_get_calls: number;
    result_get_calls: number;
    result_status: OwnerGrokV2vGenerationDiagnostic["result_status"];
    gaps: string[];
  };
}

interface Run { readonly attemptId: string; readonly controller: AbortController; promise: Promise<unknown> }

/** Owner-bound single-model Grok V2V orchestration; all upstream terminal and billing claims remain unproven. */
export class OwnerGrokV2vGenerationService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #links: PerUserLinkService;
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #catalogVersion: string;
  readonly #preparer: OwnerGrokV2vOwnedRequestPreparer;
  readonly #referenceService: OwnerGrokV2vOriginalReferenceService;
  readonly #resolveClient: OwnerGrokV2vGenerationServiceOptions["resolveChatClient"];
  readonly #createAccount: OwnerGrokV2vGenerationServiceOptions["createAccountStatusService"];
  readonly #createAccess: OwnerGrokV2vGenerationServiceOptions["createModelAccessService"];
  readonly #now: () => number;
  readonly #profileHash: string;
  readonly #recoveries = new Map<string, Recovery>();
  readonly #claims = new Set<string>();
  readonly #reserved = new Set<string>();
  readonly #runs = new Set<Run>();
  readonly #invalidating = new Set<string>();
  readonly #clients = new Map<string, SyntxChatHttpClient>();
  readonly #usedAccounts = new WeakSet<object>();
  readonly #usedAccess = new WeakSet<object>();
  #closed = false;
  #closing: Promise<void> | undefined;
  #lastNow = -1;

  constructor(value: OwnerGrokV2vGenerationServiceOptions | unknown) {
    const o = exact(value, ["binding", "linkService", "catalog", "catalog_version", "preparer", "referenceService",
      "resolveChatClient", "createAccountStatusService", "createModelAccessService"], ["now"]);
    if (!(o.catalog instanceof DiscoveryCatalogRepository) || o.catalog_version !== OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION ||
        !isOwnerGrokV2vOwnedRequestPreparer(o.preparer) || !(o.referenceService instanceof OwnerGrokV2vOriginalReferenceService) ||
        !isOwnerGrokV2vOwnedRequestPreparerBoundToReferenceService(o.preparer, o.referenceService) ||
        !(o.linkService instanceof PerUserLinkService) || typeof o.resolveChatClient !== "function" || types.isProxy(o.resolveChatClient) ||
        typeof o.createAccountStatusService !== "function" || types.isProxy(o.createAccountStatusService) ||
        typeof o.createModelAccessService !== "function" || types.isProxy(o.createModelAccessService)) invalid();
    this.#binding = readBinding(o.binding);
    this.#links = o.linkService;
    this.#catalog = o.catalog;
    this.#catalogVersion = o.catalog_version;
    this.#preparer = o.preparer;
    this.#referenceService = o.referenceService;
    this.#resolveClient = o.resolveChatClient as OwnerGrokV2vGenerationServiceOptions["resolveChatClient"];
    this.#createAccount = o.createAccountStatusService as OwnerGrokV2vGenerationServiceOptions["createAccountStatusService"];
    this.#createAccess = o.createModelAccessService as OwnerGrokV2vGenerationServiceOptions["createModelAccessService"];
    this.#now = clock(o.now);
    const profile = this.#assertModel();
    this.#profileHash = schemaHash(profile);
    SERVICES.add(this);
    Object.freeze(this);
  }

  /** Returns the source-reviewed static profile only; it performs no account or network reads. */
  getParametersSource(): OwnerGrokV2vSourceProfile {
    this.#assertOpen();
    const profile = getOwnerGrokV2vSourceProfile(MODEL_ID);
    if (!profile || schemaHash(profile) !== this.#profileHash) fail("MODEL_BINDING_MISMATCH");
    return profile;
  }

  generate(input: OwnerGrokV2vGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerGrokV2vGenerationResult> {
    const request = readGenerateInput(input);
    return this.#run(request.attemptId, signal, (runSignal) => this.#generate(request, runSignal));
  }

  reconcile(input: OwnerGrokV2vReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerGrokV2vGenerationResult> {
    const request = readRecoveryInput(input);
    return this.#run(request.attemptId, signal, async (runSignal) => {
      const recovery = this.#owned(request.attemptId, request.recovery_id, await this.#principal(request.attemptId));
      if (recovery.status === "completed") return page(recovery, 0);
      const deadline = new AbsoluteRequestDeadline(TIMEOUT_MS, runSignal, () => unknown(recovery));
      try {
        await this.#checkPrincipal(request.attemptId, recovery.principal);
        if (this.#client(request.attemptId) !== recovery.client) fail("RECOVERY_NOT_FOUND");
        return await this.#observe(recovery, deadline);
      } catch { throw unknown(recovery); }
      finally { deadline.close(); }
    });
  }

  listRecoveries(input: OwnerGrokV2vRecoveryListInput | unknown): Promise<readonly OwnerGrokV2vRecoveryListItem[]> {
    const request = readListInput(input);
    return this.#run(request.attemptId, undefined, async () => {
      const principal = await this.#principal(request.attemptId);
      return Object.freeze([...this.#recoveries.values()].filter((recovery) => recovery.attemptId === request.attemptId &&
        sameGenerationPrincipal(recovery.principal, principal)).slice(0, request.limit).map(item));
    });
  }

  getResultPage(input: OwnerGrokV2vResultPageInput | unknown): Promise<OwnerGrokV2vGenerationResult> {
    const request = readPageInput(input);
    return this.#run(request.attemptId, undefined, async () => {
      const recovery = this.#owned(request.attemptId, request.recovery_id, await this.#principal(request.attemptId));
      if (recovery.status !== "completed") throw unknown(recovery);
      return page(recovery, request.offset);
    });
  }

  async invalidateAttempt(value: unknown): Promise<void> {
    const id = attempt(value);
    this.#invalidating.add(id);
    await this.#preparer.invalidateAttempt(id);
    const active = [...this.#runs].filter((run) => run.attemptId === id);
    active.forEach((run) => run.controller.abort());
    await Promise.allSettled(active.map((run) => run.promise));
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const run of this.#runs) run.controller.abort();
    const attempts = new Set([...this.#runs].map((run) => run.attemptId));
    this.#closing = (async () => {
      for (const id of attempts) await this.#preparer.invalidateAttempt(id);
      await Promise.allSettled([...this.#runs].map((run) => run.promise));
      await this.#preparer.close();
      this.#runs.clear();
      this.#clients.clear();
    })();
    return this.#closing;
  }

  async #generate(request: OwnerGrokV2vGenerateInput, signal: AbortSignal): Promise<OwnerGrokV2vGenerationResult> {
    const deadline = new AbsoluteRequestDeadline(TIMEOUT_MS, signal, () => err("PRE_DISPATCH_FAILED"));
    let candidate: OwnerGrokV2vOwnedPreparedCandidate | undefined;
    let permit: OwnerGrokV2vOwnedOneShotPermit | undefined;
    let semanticKey: string | undefined;
    let ownsReservation = false;
    let recovery: Recovery | undefined;
    let post = false;
    let client: SyntxChatHttpClient | undefined;
    const releaseReservation = () => {
      if (semanticKey && ownsReservation) { this.#reserved.delete(semanticKey); ownsReservation = false; }
    };

    try {
      deadline.throwIfAborted();
      this.#assertModel();
      const principal = await this.#principal(request.attemptId);
      candidate = await this.#await(deadline, () => this.#preparer.prepare({ attemptId: request.attemptId, request: request.request }));
      const binding = this.#preparer.inspectCandidate(candidate);
      if (!binding) fail("PRE_DISPATCH_FAILED");
      this.#assertCandidate(request, candidate, binding, principal);
      await this.#checkPrincipal(request.attemptId, principal);
      semanticKey = JSON.stringify([principal.tenant_id, principal.subject_id, binding.intent_fingerprint]);
      if (this.#claims.has(semanticKey) || this.#reserved.has(semanticKey)) fail("INTENT_ALREADY_CLAIMED");
      if (this.#recoveries.size + this.#reserved.size >= MAX_RECOVERIES) fail("SERVICE_BUSY");
      this.#reserved.add(semanticKey);
      ownsReservation = true;
      permit = await createOwnerGrokV2vOwnedOneShotPermit({ preparer: this.#preparer, candidate, principal, attemptId: request.attemptId });

      client = this.#client(request.attemptId);
      await this.#preflight(request.attemptId, candidate, binding, deadline);
      await this.#checkPrincipal(request.attemptId, principal);
      if (this.#client(request.attemptId) !== client) fail("PRINCIPAL_NOT_LINKED");
      const nativeInput = Object.freeze({ preparer: this.#preparer, candidate, permit,
        referenceService: this.#referenceService, principal, attemptId: request.attemptId,
        linkService: this.#links, binding: this.#binding });
      const chat = await this.#await(deadline, () => Reflect.apply(CREATE, client!, [nativeInput, deadline.signal]) as Promise<OwnerGrokV2vNativeChatContext>);
      this.#assertChat(chat, request, binding);

      await this.#checkPrincipal(request.attemptId, principal);
      if (this.#client(request.attemptId) !== client) fail("PRINCIPAL_NOT_LINKED");
      await this.#preflight(request.attemptId, candidate, binding, deadline);
      await this.#checkPrincipal(request.attemptId, principal);
      if (this.#client(request.attemptId) !== client) fail("PRINCIPAL_NOT_LINKED");
      await this.#preparer.revalidateCandidate(candidate);
      await revalidateOwnerGrokV2vOwnedOneShotPermit({ preparer: this.#preparer, candidate, permit, principal, attemptId: request.attemptId });
      await this.#checkPrincipal(request.attemptId, principal);
      if (this.#client(request.attemptId) !== client) fail("PRINCIPAL_NOT_LINKED");
      const currentBinding = this.#preparer.inspectCandidate(candidate);
      if (!currentBinding || schemaHash(currentBinding) !== schemaHash(binding)) fail("PRE_DISPATCH_FAILED");

      recovery = this.#newRecovery(request.attemptId, principal, semanticKey, candidate, permit, chat, client, binding);
      this.#recoveries.set(recovery.recovery_id, recovery);
      recovery.d.phase = "GENERATION_POST";
      recovery.d.post_started = true;
      post = true;

      let ack: Readonly<{ chat_uuid: string; message_id: string }>;
      try {
        ack = await this.#await(deadline, () => Reflect.apply(START, client!, [Object.freeze({ ...nativeInput, chat }), deadline.signal]) as Promise<Readonly<{ chat_uuid: string; message_id: string }>>);
      } catch {
        const dispatch = readOwnerGrokV2vNativeDispatchStatus(client, chat);
        if (!dispatch?.dispatch_attempted) {
          this.#recoveries.delete(recovery.recovery_id);
          releaseReservation();
          semanticKey = undefined;
          fail("PRE_DISPATCH_FAILED");
        }
        this.#claims.add(semanticKey);
        releaseReservation();
        semanticKey = undefined;
        throw unknown(recovery);
      }

      if (!ack || ack.chat_uuid !== chat.chat_uuid || !safeId(ack.message_id)) {
        const dispatch = readOwnerGrokV2vNativeDispatchStatus(client, chat);
        if (!dispatch?.dispatch_attempted) {
          this.#recoveries.delete(recovery.recovery_id);
          releaseReservation();
          semanticKey = undefined;
          fail("PRE_DISPATCH_FAILED");
        }
        this.#claims.add(semanticKey);
        releaseReservation();
        semanticKey = undefined;
        throw unknown(recovery);
      }

      this.#claims.add(semanticKey);
      releaseReservation();
      semanticKey = undefined;
      const dispatch = readOwnerGrokV2vNativeDispatchStatus(client, chat);
      if (!dispatch?.dispatch_attempted || !dispatch.owner_ack_bound || dispatch.owner_echo_message_id !== ack.message_id ||
          dispatch.chat_uuid !== chat.chat_uuid || dispatch.attempt_id !== request.attemptId || dispatch.model_id !== MODEL_ID) {
        throw unknown(recovery);
      }
      recovery.owner_echo_message_id = ack.message_id;
      recovery.d.ack_known = true;
      recovery.d.owner_ack_status = "MATCHED";
      recovery.d.phase = "POST_ACK_KNOWN";
      return await this.#observe(recovery, deadline);
    } catch (error) {
      if (post && recovery) {
        const dispatch = client ? readOwnerGrokV2vNativeDispatchStatus(client, recovery.chat) : null;
        if (dispatch?.dispatch_attempted) {
          this.#claims.add(recovery.semantic_key);
          releaseReservation();
          semanticKey = undefined;
          if (dispatch.owner_ack_bound && dispatch.owner_echo_message_id) {
            recovery.owner_echo_message_id = dispatch.owner_echo_message_id;
            recovery.d.ack_known = true;
            recovery.d.owner_ack_status = "MATCHED";
            recovery.d.phase = "POST_ACK_KNOWN";
          }
          throw unknown(recovery);
        }
        this.#recoveries.delete(recovery.recovery_id);
      }
      releaseReservation();
      if (error instanceof OwnerGrokV2vGenerationServiceError) throw error;
      if (error instanceof OwnerGrokV2vNativeError && error.code === "PRINCIPAL_NOT_LINKED") fail("PRINCIPAL_NOT_LINKED");
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      if (error instanceof OwnerGrokV2vOwnedOneShotPolicyError && error.code === "INTENT_ALREADY_CLAIMED") fail("INTENT_ALREADY_CLAIMED");
      return fail("PRE_DISPATCH_FAILED");
    } finally {
      releaseReservation();
      deadline.close();
    }
  }

  async #preflight(
    attemptId: string,
    candidate: OwnerGrokV2vOwnedPreparedCandidate,
    binding: Readonly<OwnerGrokV2vOwnedCandidateBinding>,
    deadline: AbsoluteRequestDeadline
  ): Promise<void> {
    deadline.throwIfAborted();
    let accountService: AccountStatusService;
    let accessService: ModelAccessService;
    try {
      accountService = this.#createAccount(attemptId);
      accessService = this.#createAccess(attemptId);
    } catch { fail("PREFLIGHT_FAILED"); }
    if (!(accountService! instanceof AccountStatusService) || this.#usedAccounts.has(accountService!) ||
        !(accessService! instanceof ModelAccessService) || this.#usedAccess.has(accessService!)) fail("PREFLIGHT_FAILED");
    this.#usedAccounts.add(accountService!);
    this.#usedAccess.add(accessService!);

    let account: AccountStatusResult;
    let quote: ModelAccessResult;
    const privateRequest = this.#preparer.getPrivateRequest(candidate);
    const normalized = normalizeOwnerGrokV2vParameters({ model_id: MODEL_ID, prompt: privateRequest.prompt });
    if (!isOwnerGrokV2vNormalizedParameters(normalized)) fail("PREFLIGHT_FAILED");
    const measured = projectOwnerGrokV2vMeasuredSettings({ duration_seconds: binding.source_duration_seconds,
      width: binding.source_width, height: binding.source_height });
    if (!isOwnerGrokV2vMeasuredSettingsCandidate(measured)) fail("PREFLIGHT_FAILED");
    const projectedSettings = Object.freeze({ ...measured.settings_candidate });
    if (schemaHash(projectedSettings) !== schemaHash(binding.settings) ||
        schemaHash(measured.cost_parameters_candidate) !== schemaHash(binding.cost_parameters) ||
        privateRequest.settings.model_type !== MODEL_ID || privateRequest.settings.aspect_ratio !== null ||
        privateRequest.settings.video_duration !== measured.settings_candidate.video_duration ||
        privateRequest.settings.resolution !== measured.settings_candidate.resolution ||
        privateRequest.settings.file_urls.length !== 1 || privateRequest.settings.file_urls[0]?.type !== "video" ||
        binding.prompt_sha256 !== createHash("sha256").update(normalized.intent.prompt, "utf8").digest("hex")) fail("PREFLIGHT_FAILED");

    try {
      const costParameters = measured.cost_parameters_candidate;
      account = await this.#await(deadline, () => Reflect.apply(ACCOUNT, accountService!, [deadline.signal]));
      quote = await this.#await(deadline, () => Reflect.apply(ACCESS, accessService!, [{ model_id: MODEL_ID, cost_parameters: costParameters }, deadline.signal]));
    } catch { fail("PREFLIGHT_FAILED"); }
    const now = this.#readNow();
    const model = this.#catalog.getModel(MODEL_ID);
    const cost = quote!.discount_cost ?? quote!.cost;
    if (!validAccount(account!, now) || quote!.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" ||
        quote!.catalog_version !== `${this.#catalog.fetched_at}.${this.#catalog.source_hashes.models.slice(7, 19)}` ||
        quote!.model_id !== MODEL_ID || quote!.ai_name !== AI_NAME || quote!.model_type !== MODEL_ID ||
        quote!.account_read_live !== true || quote!.access !== true || quote!.parameters_redacted !== true ||
        !sameStrings(quote!.parameter_keys, ["video_duration", "resolution"]) || !finite(cost) ||
        !finiteDecimal(account!.balance.available) || !lessThanOrEqualDecimal(String(cost), account!.balance.available) ||
        !fresh(quote!.observed_at, now) || !model.active) fail("PREFLIGHT_FAILED");
  }

  #assertCandidate(
    request: OwnerGrokV2vGenerateInput,
    candidate: unknown,
    binding: Readonly<OwnerGrokV2vOwnedCandidateBinding> | undefined,
    principal: Readonly<GenerationPrincipalRef>
  ): asserts candidate is OwnerGrokV2vOwnedPreparedCandidate {
    if (!binding || !isOwnerGrokV2vOwnedPreparedCandidate(candidate) || binding.model_id !== MODEL_ID ||
        binding.attempt_id !== request.attemptId || !sameGenerationPrincipal(binding.principal, principal) ||
        binding.grok_reference_handle !== request.request.grok_reference_handle ||
        binding.source_binding.public_catalog_version !== this.#catalogVersion || binding.profile_schema_hash !== this.#profileHash ||
        candidate.model_id !== MODEL_ID || candidate.status !== "blocked" || candidate.dispatch_allowed !== false ||
        candidate.runtime_usable !== false || candidate.backend_acceptance !== "UNPROVEN" ||
        candidate.profile_schema_hash !== this.#profileHash || candidate.source_binding !== binding.source_binding ||
        candidate.request_fingerprint !== binding.request_fingerprint || candidate.intent_fingerprint !== binding.intent_fingerprint ||
        candidate.expires_at !== binding.expires_at || binding.prompt_sha256 !== createHash("sha256").update(request.request.prompt, "utf8").digest("hex")) {
      fail("PRE_DISPATCH_FAILED");
    }
  }

  #assertChat(
    chat: OwnerGrokV2vNativeChatContext,
    request: OwnerGrokV2vGenerateInput,
    binding: Readonly<OwnerGrokV2vOwnedCandidateBinding>
  ): void {
    if (!chat || chat.status !== "created" || !safeId(chat.chat_uuid) || chat.model_id !== MODEL_ID ||
        chat.attempt_id !== request.attemptId || chat.profile_schema_hash !== binding.profile_schema_hash ||
        schemaHash(chat.source_binding) !== schemaHash(binding.source_binding) ||
        chat.request_fingerprint !== binding.request_fingerprint || chat.intent_fingerprint !== binding.intent_fingerprint ||
        schemaHash(chat.sources) !== schemaHash(binding.sources) || chat.dispatch_allowed !== false ||
        chat.backend_acceptance !== "UNPROVEN") fail("PRE_DISPATCH_FAILED");
  }

  #assertModel(): OwnerGrokV2vSourceProfile {
    const profile = getOwnerGrokV2vSourceProfile(MODEL_ID);
    try {
      const model = this.#catalog.getModel(MODEL_ID);
      if (this.#catalogVersion !== OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION || !profile ||
          profile.status !== "SOURCE_REVIEWED_STATIC_ONLY" || profile.model_id !== MODEL_ID || profile.ai_name !== AI_NAME ||
          profile.source_pins.public_catalog_version !== this.#catalogVersion || profile.runtime_usable !== false ||
          profile.dispatch_allowed !== false || model.id !== MODEL_ID || model.upstream_id !== MODEL_ID ||
          model.ai_name !== AI_NAME || model.scope !== "video" || !model.active ||
          !sameStrings(model.settings?.get_cost_params ?? [], ["video_duration", "resolution"])) fail("MODEL_BINDING_MISMATCH");
      return profile;
    } catch { return fail("MODEL_BINDING_MISMATCH"); }
  }

  #client(attemptId: string): SyntxChatHttpClient {
    let value: unknown;
    try { value = this.#resolveClient(attemptId); } catch { fail("PRE_DISPATCH_FAILED"); }
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype ||
        !nativeClientMethodsIntact(value)) fail("PRE_DISPATCH_FAILED");
    const previous = this.#clients.get(attemptId);
    if (previous && previous !== value) fail("PRINCIPAL_NOT_LINKED");
    this.#clients.set(attemptId, value as SyntxChatHttpClient);
    return value as SyntxChatHttpClient;
  }

  async #principal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    try {
      const principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#links });
      if (principal.connection_id !== attemptId) fail("PRINCIPAL_NOT_LINKED");
      return principal;
    } catch { return fail("PRINCIPAL_NOT_LINKED"); }
  }

  async #checkPrincipal(attemptId: string, principal: Readonly<GenerationPrincipalRef>): Promise<void> {
    if (!sameGenerationPrincipal(await this.#principal(attemptId), principal) || this.#invalidating.has(attemptId)) fail("PRINCIPAL_NOT_LINKED");
  }

  #newRecovery(
    attemptId: string,
    principal: Readonly<GenerationPrincipalRef>,
    semanticKey: string,
    candidate: OwnerGrokV2vOwnedPreparedCandidate,
    permit: OwnerGrokV2vOwnedOneShotPermit,
    chat: OwnerGrokV2vNativeChatContext,
    client: SyntxChatHttpClient,
    binding: Readonly<OwnerGrokV2vOwnedCandidateBinding>
  ): Recovery {
    const now = this.#readNow();
    return { recovery_id: `grok_v2v_recovery_${randomUUID()}`, attemptId, semantic_key: semanticKey, principal,
      created_at: new Date(now).toISOString(), candidate, permit, chat, client, binding,
      owner_echo_message_id: null, status: "outcome_unknown", artifacts: Object.freeze([]),
      d: { phase: "CHAT_CREATE", post_started: false, ack_known: false, history_status: "NOT_READ",
        owner_ack_status: "NOT_READ", request_echo_status: "NOT_READ", history_get_calls: 0,
        result_get_calls: 0, result_status: "NOT_READ", gaps: [] } };
  }

  #owned(attemptId: string, recoveryId: string, principal: Readonly<GenerationPrincipalRef>): Recovery {
    const recovery = this.#recoveries.get(recoveryId);
    if (this.#invalidating.has(attemptId) || !recovery || recovery.attemptId !== attemptId ||
        !sameGenerationPrincipal(recovery.principal, principal)) fail("RECOVERY_NOT_FOUND");
    let client: SyntxChatHttpClient;
    try { client = this.#client(attemptId); } catch { fail("RECOVERY_NOT_FOUND"); }
    if (client! !== recovery.client) fail("RECOVERY_NOT_FOUND");
    return recovery;
  }

  async #observe(recovery: Recovery, deadline: AbsoluteRequestDeadline): Promise<OwnerGrokV2vGenerationResult> {
    await this.#checkPrincipal(recovery.attemptId, recovery.principal);
    if (this.#client(recovery.attemptId) !== recovery.client) fail("RECOVERY_NOT_FOUND");
    recovery.d.phase = "HISTORY_GET";
    recovery.d.history_get_calls++;
    let history: OwnerGrokV2vNativeResultCandidates;
    try {
      history = await this.#await(deadline, () => Reflect.apply(LIST, recovery.client, [Object.freeze({
        preparer: this.#preparer, candidate: recovery.candidate, permit: recovery.permit,
        referenceService: this.#referenceService, principal: recovery.principal, attemptId: recovery.attemptId,
        linkService: this.#links, binding: this.#binding, chat: recovery.chat
      }), deadline.signal]) as Promise<OwnerGrokV2vNativeResultCandidates>);
    } catch { recovery.d.history_status = "UNVERIFIED"; throw unknown(recovery); }
    recovery.d.owner_ack_status = history.owner_ack_status;
    recovery.d.request_echo_status = history.request_echo_status;
    if (history.status !== "COMPLETE" || history.owner_ack_status !== "MATCHED" || history.history_binding_status !== "BOUND" ||
        history.owner_echo_message_id !== recovery.owner_echo_message_id || history.history_page_status !== "COMPLETE" ||
        history.contexts.length < 1 || history.request_echo_status === "CONTRADICTORY") {
      recovery.d.history_status = history.status === "PENDING" ? "PENDING" : history.status === "UNVERIFIED" ||
        history.history_page_status === "UNPROVEN" ? "UNVERIFIED" : "INCOMPLETE";
      recovery.d.gaps = [...history.gaps];
      throw unknown(recovery);
    }
    if (history.contexts.length > PAGE_SIZE) {
      recovery.d.history_status = "UNVERIFIED";
      recovery.d.gaps = ["RESULT_CONTEXT_LIMIT_EXCEEDED"];
      throw unknown(recovery);
    }
    recovery.d.history_status = "COMPLETE";
    const artifacts: OwnerGrokV2vGenerationArtifact[] = [];
    const seenObjects = new Set<string>();
    const seenIndexes = new Set<string>();
    for (const context of history.contexts) {
      if (!validResultContext(context, recovery)) throw unknown(recovery);
      await this.#checkPrincipal(recovery.attemptId, recovery.principal);
      if (this.#client(recovery.attemptId) !== recovery.client) fail("RECOVERY_NOT_FOUND");
      recovery.d.phase = "RESULT_GET";
      recovery.d.result_get_calls++;
      let result;
      try {
        result = await this.#await(deadline, () => Reflect.apply(GET, recovery.client, [Object.freeze({
          result_context: context, principal: recovery.principal, attemptId: recovery.attemptId,
          linkService: this.#links, binding: this.#binding
        }), deadline.signal]));
      } catch { recovery.d.result_status = "UNVERIFIED"; throw unknown(recovery); }
      if (result.message_binding !== "BOUND" || result.model_echo !== "MATCHED" || result.artifacts.length < 1 ||
          result.gaps.length !== 0) {
        recovery.d.result_status = "UNVERIFIED";
        recovery.d.gaps = [...result.gaps];
        throw unknown(recovery);
      }
      for (const artifact of result.artifacts) {
        const objectKey = `${context.message_id}:${artifact.object_index}`;
        if (!validArtifact(artifact, context, recovery) || seenObjects.has(artifact.message_object_id) || seenIndexes.has(objectKey)) throw unknown(recovery);
        seenObjects.add(artifact.message_object_id);
        seenIndexes.add(objectKey);
        artifacts.push(Object.freeze({ ...artifact, message_id: context.message_id, chat_uuid: context.chat_uuid, model_id: MODEL_ID }));
        if (artifacts.length > PAGE_SIZE) { recovery.d.result_status = "UNVERIFIED"; throw unknown(recovery); }
      }
      await this.#checkPrincipal(recovery.attemptId, recovery.principal);
      if (this.#client(recovery.attemptId) !== recovery.client) fail("RECOVERY_NOT_FOUND");
    }
    await this.#checkPrincipal(recovery.attemptId, recovery.principal);
    if (this.#client(recovery.attemptId) !== recovery.client) fail("RECOVERY_NOT_FOUND");
    recovery.artifacts = Object.freeze(artifacts);
    recovery.d.gaps = [];
    recovery.status = "completed";
    recovery.d.result_status = "COMPLETE";
    return page(recovery, 0);
  }

  #await<T>(deadline: AbsoluteRequestDeadline, task: () => Promise<T>): Promise<T> {
    deadline.throwIfAborted();
    return deadline.waitFor(task());
  }

  #run<T>(attemptId: string, parent: AbortSignal | undefined, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.#closed || !SERVICES.has(this)) return Promise.reject(err("SERVICE_CLOSED"));
    if (this.#invalidating.has(attemptId) || this.#runs.size >= MAX_RUNS) return Promise.reject(err("SERVICE_BUSY"));
    const controller = new AbortController();
    const abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    const run: Run = { attemptId, controller, promise: Promise.resolve() };
    const promise = fn(controller.signal);
    run.promise = promise;
    this.#runs.add(run);
    return promise.finally(() => { parent?.removeEventListener("abort", abort); this.#runs.delete(run); });
  }

  #assertOpen(): void { if (this.#closed || !SERVICES.has(this)) fail("SERVICE_CLOSED"); }

  #readNow(): number {
    let value: unknown;
    try { value = this.#now(); } catch { fail("SERVICE_BUSY"); }
    if (!Number.isSafeInteger(value) || (value as number) < this.#lastNow) fail("SERVICE_BUSY");
    this.#lastNow = value as number;
    return value as number;
  }
}

export function isOwnerGrokV2vGenerationService(value: unknown): value is OwnerGrokV2vGenerationService {
  return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) &&
    Object.getPrototypeOf(value) === OwnerGrokV2vGenerationService.prototype && Object.isFrozen(value);
}

function readGenerateInput(value: unknown): OwnerGrokV2vGenerateInput {
  const fields = exact(value, ["attemptId", "request"]);
  const request = exact(fields.request, ["model_id", "prompt", "grok_reference_handle"]);
  if (request.model_id !== MODEL_ID || typeof request.prompt !== "string" || typeof request.grok_reference_handle !== "string" ||
      !/^grok_v2v_reference_[0-9a-f-]{36}$/u.test(request.grok_reference_handle)) invalid();
  return Object.freeze({ attemptId: attempt(fields.attemptId), request: Object.freeze({ model_id: MODEL_ID,
    prompt: request.prompt, grok_reference_handle: request.grok_reference_handle }) });
}

function readRecoveryInput(value: unknown): OwnerGrokV2vReconcileInput {
  const fields = exact(value, ["attemptId", "recovery_id"]);
  if (typeof fields.recovery_id !== "string" || !RECOVERY.test(fields.recovery_id)) invalid();
  return Object.freeze({ attemptId: attempt(fields.attemptId), recovery_id: fields.recovery_id });
}

function readListInput(value: unknown): Readonly<{ attemptId: string; limit: number }> {
  const fields = exact(value, ["attemptId"], ["limit"]);
  return Object.freeze({ attemptId: attempt(fields.attemptId), limit: bounded(fields.limit, 1, MAX_RECOVERIES, 32) });
}

function readPageInput(value: unknown): Readonly<{ attemptId: string; recovery_id: string; offset: number }> {
  const fields = exact(value, ["attemptId", "recovery_id"], ["offset"]);
  if (typeof fields.recovery_id !== "string" || !RECOVERY.test(fields.recovery_id)) invalid();
  return Object.freeze({ attemptId: attempt(fields.attemptId), recovery_id: fields.recovery_id, offset: bounded(fields.offset, 0, 4096, 0) });
}

function page(recovery: Recovery, offset: number): OwnerGrokV2vGenerationResult {
  const artifacts = recovery.artifacts.slice(offset, offset + PAGE_SIZE);
  const nextOffset = offset + artifacts.length;
  return Object.freeze({ status: "completed", status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", backend_acceptance: "UNPROVEN",
    provider_terminal_status: "UNPROVEN", cost_cap_enforced: false, output_count: "UNKNOWN", recovery_id: recovery.recovery_id,
    model_id: MODEL_ID, source_binding: Object.freeze({ public_catalog_version: OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION,
      profile_schema_hash: recovery.binding.profile_schema_hash, request_fingerprint: recovery.binding.request_fingerprint,
      intent_fingerprint: recovery.binding.intent_fingerprint }), observed_artifact_count: recovery.artifacts.length,
    offset, page_size: PAGE_SIZE, artifacts: Object.freeze(artifacts), has_more: nextOffset < recovery.artifacts.length,
    next_offset: nextOffset < recovery.artifacts.length ? nextOffset : null, diagnostic: diagnostic(recovery.d) });
}

function diagnostic(value: Recovery["d"]): OwnerGrokV2vGenerationDiagnostic {
  return Object.freeze({ ...value, gaps: Object.freeze(value.gaps.slice(0, 32)) });
}

function item(recovery: Recovery): OwnerGrokV2vRecoveryListItem {
  return Object.freeze({ recovery_id: recovery.recovery_id, created_at: recovery.created_at, model_id: MODEL_ID,
    status: recovery.status, observed_artifact_count: recovery.artifacts.length, diagnostic: diagnostic(recovery.d) });
}

function unknown(recovery: Recovery): OwnerGrokV2vGenerationServiceError {
  return new OwnerGrokV2vGenerationServiceError("OUTCOME_UNKNOWN", recovery.recovery_id, diagnostic(recovery.d));
}

function validAccount(value: AccountStatusResult, now: number): boolean {
  const subscription = value.subscription, balance = value.balance;
  return value.contract_evidence === ACCOUNT_CONTRACT_EVIDENCE && value.source_build === ACCOUNT_SOURCE_BUILD &&
    !!balance && balance.unit === "tokens" && finiteDecimal(balance.available) && !!subscription &&
    (subscription.active === null || typeof subscription.active === "boolean") &&
    (subscription.plan_type === null || typeof subscription.plan_type === "string") &&
    (subscription.end_date === null || typeof subscription.end_date === "string") &&
    (subscription.end_date_kind === null || ["DATE_ONLY", "LOCAL_DATETIME", "OFFSET_DATETIME"].includes(subscription.end_date_kind)) &&
    fresh(value.observed_at, now);
}

function lessThanOrEqualDecimal(left: string, right: string): boolean {
  const a = decimalParts(left), b = decimalParts(right);
  if (!a || !b) return false;
  const scale = Math.max(a.scale, b.scale);
  return a.digits * 10n ** BigInt(scale - a.scale) <= b.digits * 10n ** BigInt(scale - b.scale);
}

function decimalParts(value: string): Readonly<{ digits: bigint; scale: number }> | null {
  if (value.length > 128) return null;
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/u.exec(value);
  if (!match) return null;
  const fraction = match[2] ?? "", exponent = Number(match[3] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) return null;
  let digits: bigint;
  try { digits = BigInt(`${match[1]}${fraction}`); } catch { return null; }
  let scale = fraction.length - exponent;
  if (scale < 0) { digits *= 10n ** BigInt(-scale); scale = 0; }
  return Object.freeze({ digits, scale });
}

function finiteDecimal(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value);
}
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function fresh(value: string, now: number): boolean {
  const parsed = Date.parse(value);
  return typeof value === "string" && Number.isFinite(parsed) && Math.abs(parsed - now) < 300_000;
}
function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  const a = [...left].sort(), b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function validResultContext(context: OwnerGrokV2vNativeResultContext, recovery: Recovery): boolean {
  return context.chat_uuid === recovery.chat.chat_uuid && context.attempt_id === recovery.attemptId && context.model_id === MODEL_ID &&
    context.profile_schema_hash === recovery.binding.profile_schema_hash &&
    context.request_fingerprint === recovery.binding.request_fingerprint && context.intent_fingerprint === recovery.binding.intent_fingerprint &&
    context.owner_echo_message_id === recovery.owner_echo_message_id && Array.isArray(context.message_object_ids) &&
    context.message_object_ids.length > 0 && context.message_object_ids.length <= PAGE_SIZE &&
    new Set(context.message_object_ids).size === context.message_object_ids.length && /^\d{1,16}$/u.test(context.provider_chat_id);
}

function validArtifact(
  artifact: OwnerGrokV2vNativeVideoArtifact,
  context: OwnerGrokV2vNativeResultContext,
  recovery: Recovery
): boolean {
  return artifact.object_type === "video" && context.message_object_ids.includes(artifact.message_object_id) &&
    typeof artifact.object_url === "string" && isSafeUploadReferenceUrl(artifact.object_url) &&
    (artifact.mime_type === null || artifact.mime_type === "video/mp4" || artifact.mime_type === "video/quicktime") &&
    artifact.mime_source === (artifact.mime_type === null ? "UNKNOWN" : "URL_EXTENSION") && context.model_id === MODEL_ID &&
    recovery.binding.model_id === MODEL_ID;
}

function readBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exact(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || !fields.tenant_id.trim() || typeof fields.subject !== "string" || !fields.subject.trim()) invalid();
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}

function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); }
  catch { return invalid(); }
  const keys = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || keys.some((key) => typeof key !== "string" ||
      (!required.includes(key) && !optional.includes(key))) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !descriptors[key]!.enumerable || !Object.hasOwn(descriptors[key]!, "value"))) invalid();
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) copy[key] = descriptors[key]!.value;
  return copy;
}

function attempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) invalid(); return value; }
function safeId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u.test(value); }
function bounded(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) invalid();
  return value as number;
}
function clock(value: unknown): () => number {
  if (value === undefined) return Date.now;
  if (typeof value !== "function" || types.isProxy(value)) invalid();
  return value as () => number;
}

function nativeClientMethodsIntact(client: object): boolean {
  const methods = ["createOwnerGrokV2vChat", "startGrokV2vWithOwnedCandidate", "listOwnedGrokV2vCandidates", "getOwnedGrokV2vResult"] as const;
  return methods.every((name) => {
    const original = name === "createOwnerGrokV2vChat" ? CREATE : name === "startGrokV2vWithOwnedCandidate" ? START :
      name === "listOwnedGrokV2vCandidates" ? LIST : GET;
    return !Object.hasOwn(client, name) && SyntxChatHttpClient.prototype[name] === original &&
      getDataMethod(client, name) === original && Reflect.get(client, name) === original;
  });
}

function getDataMethod(target: object, key: string): unknown {
  let current: object | null = target;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function err(code: OwnerGrokV2vGenerationServiceErrorCode): OwnerGrokV2vGenerationServiceError {
  return new OwnerGrokV2vGenerationServiceError(code);
}
function fail(code: OwnerGrokV2vGenerationServiceErrorCode): never { throw err(code); }
function invalid(): never { return fail("INVALID_REQUEST"); }
