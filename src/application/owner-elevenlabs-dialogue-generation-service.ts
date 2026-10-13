import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { OwnerElevenLabsVoiceReferenceService } from "./owner-elevenlabs-voice-reference-service.js";
import { AccountStatusService, type AccountStatusResult } from "./account-status.js";
import { ModelAccessService, type ModelAccessResult } from "./model-access.js";
import { OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION, normalizeOwnerElevenLabsGenerationParameters,
  type OwnerElevenLabsDialogueModel, type OwnerElevenLabsGenerationSettingsCandidate } from "./owner-elevenlabs-generation-parameters.js";
import { OwnerElevenLabsDialogueRequestPreparer, getOwnerElevenLabsDialogueSourceProfile,
  type OwnerElevenLabsDialoguePreparedCandidate } from "./owner-elevenlabs-dialogue-request-preparer.js";
import { OwnerElevenLabsDialogueOneShotPolicy, type OwnerElevenLabsDialogueOneShotPermit } from "./owner-elevenlabs-dialogue-one-shot-policy.js";
import { decodeOwnerElevenLabsDialogueHistory, decodeOwnerElevenLabsDialogueResult,
  type OwnerElevenLabsDialogueDecodedHistory, type OwnerElevenLabsDialogueDecodedResult,
  type OwnerElevenLabsDialogueHistoryExpectation } from "./owner-elevenlabs-dialogue-history-result-codec.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY = /^elevenlabs_dialogue_recovery_[0-9a-f-]{36}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const MAX_RECOVERIES = 128;
const MAX_RUNS = 4;
const MAX_RESULTS = 4_096;
const PAGE_SIZE = 64;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_PROMPT_BYTES = 65_536;
const SERVICES = new WeakSet<object>();
const NATIVE_NAMES = Object.freeze({ create: "createOwnerElevenLabsDialogueChat",
  start: "startOwnerElevenLabsDialogueWithOwnedCandidate", history: "listOwnedElevenLabsDialogueCandidates",
  result: "getOwnedElevenLabsDialogueResult" });
const CHAT_PROTO = SyntxChatHttpClient.prototype as unknown as Record<string, unknown>;
const NATIVE_METHODS = Object.freeze({ create: CHAT_PROTO[NATIVE_NAMES.create], start: CHAT_PROTO[NATIVE_NAMES.start],
  history: CHAT_PROTO[NATIVE_NAMES.history], result: CHAT_PROTO[NATIVE_NAMES.result] });

type NativeChat = Readonly<{ status: "created"; chat_uuid: string; attempt_id: string; principal: Readonly<GenerationPrincipalRef>;
  model_id: OwnerElevenLabsDialogueModel; voice_epoch: number; intent_fingerprint: string;
  profile_schema_hash: string; profile_id: string; source_profile_schema_hash: string;
  dispatch_allowed: false; backend_acceptance: "UNPROVEN" }>;
type NativeAck = Readonly<{ chat_uuid: string; message_id: string }>;
type NativeMethods = Readonly<{ create: Function; start: Function; history: Function; result: Function }>;

export interface OwnerElevenLabsDialogueGenerationServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string;
  readonly voiceReferenceService: OwnerElevenLabsVoiceReferenceService;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly createAccountStatusService: (attemptId: string) => AccountStatusService;
  readonly createModelAccessService: (attemptId: string) => ModelAccessService;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}
export interface OwnerElevenLabsDialogueGenerateInput { readonly attemptId: string; readonly request: unknown; }
export interface OwnerElevenLabsDialogueReconcileInput { readonly attemptId: string; readonly recovery_id: string; }
export interface OwnerElevenLabsDialogueRecoveryListInput { readonly attemptId: string; readonly limit?: number; }
export interface OwnerElevenLabsDialogueResultPageInput { readonly attemptId: string; readonly recovery_id: string; readonly offset?: number; }
export interface OwnerElevenLabsDialogueArtifact { readonly url: string; readonly mime_type: null; readonly mime_source: "UNKNOWN";
  readonly message_id: string; readonly message_object_id: string; readonly object_index: number; readonly object_type: "audio";
  readonly model_echo: "MATCHED" | "UNKNOWN"; }
export interface OwnerElevenLabsDialogueDiagnostic { readonly phase: "VALIDATE_REQUEST" | "RESOLVE_PRINCIPAL" | "PREPARE_CANDIDATE" |
  "PREFLIGHT" | "CHAT_CREATE" | "GENERATION_POST" | "POST_ACK_KNOWN" | "HISTORY_GET" | "RESULT_GET" | "RESULT_BINDING";
  readonly post_started: boolean; readonly ack_known: boolean; readonly owner_ack_status: "NOT_READ" | "MATCHED" | "UNKNOWN" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  readonly history_get_calls: number; readonly result_get_calls: number; readonly gaps: readonly string[]; }
export interface OwnerElevenLabsDialogueGenerationResult {
  readonly status: "observed_results" | "partial_results"; readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly backend_acceptance: "UNPROVEN"; readonly provider_terminal_status: "UNPROVEN";
  readonly model_id: OwnerElevenLabsDialogueModel; readonly parameters: Readonly<{ mode: "text_to_dialogue"; chars_count: number; line_count: number }>;
  readonly recovery_id: string; readonly observed_artifact_count: number; readonly offset: number; readonly page_size: 64;
  readonly artifacts: readonly OwnerElevenLabsDialogueArtifact[]; readonly has_more: boolean; readonly next_offset: number | null;
  readonly diagnostic: OwnerElevenLabsDialogueDiagnostic;
}
export interface OwnerElevenLabsDialogueRecoveryListItem { readonly recovery_id: string; readonly created_at: string;
  readonly model_id: OwnerElevenLabsDialogueModel; readonly status: "outcome_unknown" | "partial_results";
  readonly observed_artifact_count: number; readonly diagnostic: OwnerElevenLabsDialogueDiagnostic; }
export type OwnerElevenLabsDialogueGenerationServiceErrorCode = "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" |
  "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH" | "PREFLIGHT_FAILED" | "INTENT_ALREADY_CLAIMED" |
  "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND";
export class OwnerElevenLabsDialogueGenerationServiceError extends Error {
  readonly diagnostic?: OwnerElevenLabsDialogueDiagnostic;
  constructor(readonly code: OwnerElevenLabsDialogueGenerationServiceErrorCode, readonly recovery_id?: string,
    diagnostic?: OwnerElevenLabsDialogueDiagnostic) {
    super(code === "OUTCOME_UNKNOWN" ? "The ElevenLabs dialogue request may have been dispatched; reconcile its private recovery and do not retry."
      : "The owner ElevenLabs dialogue request could not be completed safely.");
    this.name = "OwnerElevenLabsDialogueGenerationServiceError";
    if (code === "OUTCOME_UNKNOWN" && diagnostic) this.diagnostic = diagnostic;
  }
}
interface MutableDiagnostic { phase: OwnerElevenLabsDialogueDiagnostic["phase"]; post_started: boolean; ack_known: boolean;
  owner_ack_status: OwnerElevenLabsDialogueDiagnostic["owner_ack_status"]; history_get_calls: number; result_get_calls: number; gaps: string[]; }
interface RecoveryEntry { readonly recovery_id: string; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly created_at: string; readonly model_id: OwnerElevenLabsDialogueModel; readonly parameters: Readonly<{ mode: "text_to_dialogue"; chars_count: number; line_count: number }>;
  readonly semantic_key: string; readonly input_key: string; readonly chat: NativeChat; readonly candidate: OwnerElevenLabsDialoguePreparedCandidate;
  readonly permit: OwnerElevenLabsDialogueOneShotPermit; owner_ack_message_id: string | null;
  status: "outcome_unknown" | "partial_results" | "observed_results"; artifacts: readonly OwnerElevenLabsDialogueArtifact[]; readonly diagnostic: MutableDiagnostic; }
interface ActiveRun { readonly attemptId: string; readonly controller: AbortController; promise: Promise<unknown>; }

/** Separate owner-only dialogue flow. Native methods are a narrow extension seam and are required at runtime. */
export class OwnerElevenLabsDialogueGenerationService {
  readonly #binding: Readonly<AuthBinding>; readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: DiscoveryCatalogRepository; readonly #catalogVersion: string;
  readonly #voiceService: OwnerElevenLabsVoiceReferenceService; readonly #resolveClient: OwnerElevenLabsDialogueGenerationServiceOptions["resolveChatClient"];
  readonly #createAccount: OwnerElevenLabsDialogueGenerationServiceOptions["createAccountStatusService"];
  readonly #createAccess: OwnerElevenLabsDialogueGenerationServiceOptions["createModelAccessService"];
  readonly #now: () => number; readonly #timeout: number; readonly #preparer: OwnerElevenLabsDialogueRequestPreparer;
  readonly #policy: OwnerElevenLabsDialogueOneShotPolicy; readonly #recoveries = new Map<string, RecoveryEntry>();
  readonly #inputClaims = new Map<string, string>(); readonly #semanticClaims = new Map<string, string>();
  readonly #reservedInputs = new Set<string>(); readonly #reservedSemantics = new Set<string>();
  readonly #clients = new Map<string, SyntxChatHttpClient>(); readonly #usedAccounts = new WeakSet<object>(); readonly #usedAccess = new WeakSet<object>();
  readonly #runs = new Set<ActiveRun>(); readonly #invalidating = new Set<string>(); #closed = false; #closing: Promise<void> | undefined; #lastNow = -1;

  constructor(input: OwnerElevenLabsDialogueGenerationServiceOptions | unknown) {
    if (new.target !== OwnerElevenLabsDialogueGenerationService) fail("INVALID_REQUEST");
    const row = exactRecord(input, ["binding", "linkService", "catalog", "catalog_version", "voiceReferenceService", "resolveChatClient",
      "createAccountStatusService", "createModelAccessService"], ["now", "timeoutMs"]);
    this.#binding = snapshotBinding(row.binding);
    if (!isExactService(row.linkService, PerUserLinkService, ["getStatus"])) fail("INVALID_REQUEST");
    if (!isExactInstance(row.catalog, DiscoveryCatalogRepository) || row.catalog_version !== OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION ||
        !isExactService(row.voiceReferenceService, OwnerElevenLabsVoiceReferenceService,
          ["listVoices", "resolveVoice", "isOwnedVoiceResolution", "invalidateAttempt", "close"]) ||
        typeof row.resolveChatClient !== "function" || types.isProxy(row.resolveChatClient) ||
        typeof row.createAccountStatusService !== "function" || types.isProxy(row.createAccountStatusService) ||
        typeof row.createModelAccessService !== "function" || types.isProxy(row.createModelAccessService)) fail("INVALID_REQUEST");
    this.#linkService = row.linkService; this.#catalog = row.catalog; this.#catalogVersion = row.catalog_version as string;
    this.#voiceService = row.voiceReferenceService; this.#resolveClient = row.resolveChatClient as OwnerElevenLabsDialogueGenerationServiceOptions["resolveChatClient"];
    this.#createAccount = row.createAccountStatusService as OwnerElevenLabsDialogueGenerationServiceOptions["createAccountStatusService"];
    this.#createAccess = row.createModelAccessService as OwnerElevenLabsDialogueGenerationServiceOptions["createModelAccessService"];
    this.#now = clockFactory(row.now); this.#timeout = bounded(row.timeoutMs, 1_000, 5 * 60_000, DEFAULT_TIMEOUT_MS);
    this.#assertSource();
    this.#preparer = new OwnerElevenLabsDialogueRequestPreparer({ voiceReferenceService: this.#voiceService, now: this.#now });
    this.#policy = new OwnerElevenLabsDialogueOneShotPolicy({ preparer: this.#preparer, now: this.#now });
    SERVICES.add(this); Object.freeze(this);
  }

  async generate(input: OwnerElevenLabsDialogueGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerElevenLabsDialogueGenerationResult> {
    const request = snapshotGenerate(input); return await this.#run(request.attemptId, signal, (s) => this.#generate(request, s));
  }
  async reconcile(input: OwnerElevenLabsDialogueReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerElevenLabsDialogueGenerationResult> {
    const request = snapshotReconcile(input);
    return await this.#run(request.attemptId, signal, (s) => this.#reconcile(request, s));
  }
  async listRecoveries(input: OwnerElevenLabsDialogueRecoveryListInput | unknown): Promise<readonly OwnerElevenLabsDialogueRecoveryListItem[]> {
    this.#assertOpen(); const request = snapshotList(input);
    return await this.#run(request.attemptId, undefined, async () => {
      const principal = await this.#resolvePrincipal(request.attemptId);
      if (this.#invalidating.has(request.attemptId)) fail("PRINCIPAL_NOT_LINKED");
      return Object.freeze([...this.#recoveries.values()].filter((entry) => entry.attemptId === request.attemptId &&
        sameGenerationPrincipal(entry.principal, principal) && entry.status !== "observed_results")
        .sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, request.limit).map((entry) => Object.freeze({
          recovery_id: entry.recovery_id, created_at: entry.created_at, model_id: entry.model_id,
          status: entry.status as "outcome_unknown" | "partial_results", observed_artifact_count: entry.artifacts.length,
          diagnostic: snapshotDiagnostic(entry.diagnostic) })));
    });
  }
  async getResultPage(input: OwnerElevenLabsDialogueResultPageInput | unknown): Promise<OwnerElevenLabsDialogueGenerationResult> {
    this.#assertOpen(); const request = snapshotPage(input);
    return await this.#run(request.attemptId, undefined, async () => {
      const principal = await this.#resolvePrincipal(request.attemptId); const entry = this.#recoveries.get(request.recovery_id);
      if (!entry || entry.attemptId !== request.attemptId || !sameGenerationPrincipal(entry.principal, principal) || this.#invalidating.has(request.attemptId)) fail("RECOVERY_NOT_FOUND");
      if (entry.status === "outcome_unknown") throw unknown(entry);
      return page(entry, request.offset);
    });
  }
  async invalidateAttempt(attemptIdInput: unknown): Promise<void> {
    const attemptId = safeAttempt(attemptIdInput); this.#invalidating.add(attemptId); this.#preparer.invalidateAttempt(attemptId); this.#policy.invalidateAttempt(attemptId);
    const runs = [...this.#runs].filter((run) => run.attemptId === attemptId); for (const run of runs) run.controller.abort();
    await Promise.allSettled(runs.map((run) => run.promise));
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing; this.#closed = true;
    for (const run of this.#runs) run.controller.abort();
    for (const id of new Set([...this.#runs].map((run) => run.attemptId))) { this.#preparer.invalidateAttempt(id); this.#policy.invalidateAttempt(id); }
    this.#closing = (async () => { await Promise.allSettled([...this.#runs].map((run) => run.promise));
      this.#policy.close(); this.#preparer.close(); this.#reservedInputs.clear(); this.#reservedSemantics.clear(); this.#clients.clear();
      this.#runs.clear(); this.#invalidating.clear(); })(); return this.#closing;
  }

  async #generate(request: Readonly<OwnerElevenLabsDialogueGenerateInput>, parent: AbortSignal): Promise<OwnerElevenLabsDialogueGenerationResult> {
    const deadline = this.#deadline(parent, () => serviceError("PRE_DISPATCH_FAILED"));
    let inputKey: string | undefined; let semanticKey: string | undefined; let candidate: OwnerElevenLabsDialoguePreparedCandidate | undefined;
    let permit: OwnerElevenLabsDialogueOneShotPermit | undefined; let recovery: RecoveryEntry | undefined; let postStarted = false;
    try {
      deadline.throwIfAborted(); const { normalized, preparerRequest, prompt } = normalizeDialogueRequest(request.request);
      this.#assertSource(); const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      inputKey = intentHash(principal, normalized.model_id, prompt, normalized.settings_candidate);
      const oldId = this.#inputClaims.get(inputKey);
      if (oldId) { const old = this.#recoveries.get(oldId); if (!old || old.status === "outcome_unknown") fail("INTENT_ALREADY_CLAIMED"); return page(old, 0); }
      if (this.#reservedInputs.has(inputKey) || this.#recoveries.size + this.#reservedInputs.size >= MAX_RECOVERIES) fail("SERVICE_BUSY");
      this.#reservedInputs.add(inputKey);
      candidate = await this.#await(deadline, () => this.#preparer.prepare({ attemptId: request.attemptId, principal, request: preparerRequest }));
      semanticKey = semanticHash(principal, candidate.intent_fingerprint);
      const prior = this.#semanticClaims.get(semanticKey);
      if (prior) { const old = this.#recoveries.get(prior); if (!old || old.status === "outcome_unknown") fail("INTENT_ALREADY_CLAIMED"); return page(old, 0); }
      if (this.#reservedSemantics.has(semanticKey)) fail("SERVICE_BUSY"); this.#reservedSemantics.add(semanticKey);
      permit = this.#policy.createPermit({ candidate, attemptId: request.attemptId, principal });
      await this.#runPreflight(request.attemptId, normalized.model_id, normalized.settings_candidate.chars_count, deadline);
      const client = this.#resolveNativeClient(request.attemptId); deadline.throwIfAborted();
      const methods = this.#nativeMethods(client);
      const chatRaw = await this.#await(deadline, () => Reflect.apply(methods.create, client, [Object.freeze({ candidate, permit,
        preparer: this.#preparer, oneShotPolicy: this.#policy, principal, attemptId: request.attemptId }), deadline.signal]) as Promise<unknown>);
      const chat = readChat(chatRaw, candidate, principal, request.attemptId);
      const principalAfterChat = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      if (!sameGenerationPrincipal(principal, principalAfterChat) || this.#invalidating.has(request.attemptId)) fail("PRINCIPAL_NOT_LINKED");
      await this.#runPreflight(request.attemptId, normalized.model_id, normalized.settings_candidate.chars_count, deadline);
      const principalBeforePost = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      if (!sameGenerationPrincipal(principal, principalBeforePost) || this.#invalidating.has(request.attemptId)) fail("PRINCIPAL_NOT_LINKED");
      this.#preparer.revalidateCandidate({ candidate, attemptId: request.attemptId, principal });
      this.#policy.revalidate({ candidate, permit, attemptId: request.attemptId, principal });
      const now = this.#readNow(); recovery = makeRecovery({ request, principal, normalized: normalized.settings_candidate,
        modelId: normalized.model_id, semanticKey, inputKey, chat, candidate, permit, now });
      this.#recoveries.set(recovery.recovery_id, recovery); this.#semanticClaims.set(semanticKey, recovery.recovery_id); this.#inputClaims.set(inputKey, recovery.recovery_id);
      this.#reservedInputs.delete(inputKey); inputKey = undefined; this.#reservedSemantics.delete(semanticKey); semanticKey = undefined;
      recovery.diagnostic.phase = "GENERATION_POST"; recovery.diagnostic.post_started = true; postStarted = true;
      const ackRaw = await this.#await(deadline, () => Reflect.apply(methods.start, client, [Object.freeze({ chat, candidate: candidate!, permit: permit!,
        preparer: this.#preparer, oneShotPolicy: this.#policy, principal, attemptId: request.attemptId }), deadline.signal]) as Promise<unknown>);
      const ack = readAck(ackRaw, chat);
      recovery.owner_ack_message_id = ack.message_id; recovery.diagnostic.ack_known = true; recovery.diagnostic.owner_ack_status = "MATCHED";
      recovery.diagnostic.phase = "POST_ACK_KNOWN";
      return await this.#observe(recovery, client, methods, deadline);
    } catch (error) {
      if (postStarted && recovery) throw unknown(recovery);
      if (inputKey) this.#reservedInputs.delete(inputKey); if (semanticKey) this.#reservedSemantics.delete(semanticKey);
      if (permit && candidate) { try { this.#policy.release({ candidate, permit, attemptId: request.attemptId, principal: candidate.principal }); } catch { /* consumed permits stay reserved */ } }
      if (error instanceof OwnerElevenLabsDialogueGenerationServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      return fail("PRE_DISPATCH_FAILED");
    } finally { if (inputKey) this.#reservedInputs.delete(inputKey); if (semanticKey) this.#reservedSemantics.delete(semanticKey); deadline.close(); }
  }

  async #reconcile(request: Readonly<OwnerElevenLabsDialogueReconcileInput>, signal: AbortSignal): Promise<OwnerElevenLabsDialogueGenerationResult> {
    const recovery = this.#recoveries.get(request.recovery_id);
    if (!recovery || recovery.attemptId !== request.attemptId) fail("RECOVERY_NOT_FOUND");
    const deadline = this.#deadline(signal, () => unknown(recovery));
    try {
      const principal = await this.#await(deadline, () => this.#resolvePrincipal(request.attemptId));
      if (!sameGenerationPrincipal(principal, recovery.principal) || this.#invalidating.has(request.attemptId)) throw unknown(recovery);
      if (recovery.status === "observed_results") return page(recovery, 0);
      const client = this.#resolveNativeClient(request.attemptId);
      return await this.#observe(recovery, client, this.#nativeMethods(client), deadline);
    } catch (error) { if (error instanceof OwnerElevenLabsDialogueGenerationServiceError && error.code === "RECOVERY_NOT_FOUND") throw error; throw unknown(recovery); }
    finally { deadline.close(); }
  }

  async #observe(entry: RecoveryEntry, client: SyntxChatHttpClient, methods: NativeMethods, deadline: AbsoluteRequestDeadline): Promise<OwnerElevenLabsDialogueGenerationResult> {
    deadline.throwIfAborted(); if (this.#invalidating.has(entry.attemptId)) throw unknown(entry);
    const principal = await this.#await(deadline, () => this.#resolvePrincipal(entry.attemptId));
    if (!sameGenerationPrincipal(principal, entry.principal)) throw unknown(entry);
    entry.diagnostic.phase = "HISTORY_GET"; entry.diagnostic.history_get_calls += 1;
    let rawHistory: unknown;
    try { rawHistory = await this.#await(deadline, () => Reflect.apply(methods.history, client, [entry.chat, deadline.signal]) as Promise<unknown>); }
    catch { deadline.throwIfAborted(); entry.diagnostic.owner_ack_status = "UNKNOWN"; addGap(entry, "HISTORY_GET_UNVERIFIED"); throw unknown(entry); }
    entry.diagnostic.phase = "RESULT_BINDING";
    const expectation: OwnerElevenLabsDialogueHistoryExpectation = Object.freeze({ chat_uuid: entry.chat.chat_uuid, attempt_id: entry.attemptId,
      principal: entry.principal, model_id: entry.model_id, owner_echo_message_id: entry.owner_ack_message_id!, voice_epoch: entry.candidate.voice_epoch,
      intent_fingerprint: entry.candidate.intent_fingerprint, profile_schema_hash: entry.candidate.profile_schema_hash,
      source_profile_schema_hash: entry.chat.source_profile_schema_hash });
    let history: OwnerElevenLabsDialogueDecodedHistory;
    try { history = decodeOwnerElevenLabsDialogueHistory(rawHistory, expectation); }
    catch { history = Object.freeze({ availability: "UNVERIFIED", owner_ack_status: "UNKNOWN", history_get_calls: 0,
      owner_echo_message_id: null, contexts: Object.freeze([]), gaps: Object.freeze(["HISTORY_CODEC_REJECTED"]), backend_acceptance: "UNPROVEN" }); }
    entry.diagnostic.owner_ack_status = history.owner_ack_status; entry.diagnostic.gaps.push(...history.gaps);
    if (history.availability !== "BOUND" || history.contexts.length === 0) throw unknown(entry);
    const artifacts: OwnerElevenLabsDialogueArtifact[] = []; const seenIds = new Set<string>(); const seenUrls = new Set<string>(); let partial = history.gaps.length > 0;
    for (const context of history.contexts) {
      deadline.throwIfAborted(); if (this.#invalidating.has(entry.attemptId)) throw unknown(entry);
      entry.diagnostic.phase = "RESULT_GET"; entry.diagnostic.result_get_calls += 1;
      let rawResult: unknown;
      try { rawResult = await this.#await(deadline, () => Reflect.apply(methods.result, client, [context, deadline.signal]) as Promise<unknown>); }
      catch { deadline.throwIfAborted(); addGap(entry, "RESULT_GET_UNVERIFIED"); throw unknown(entry); }
      let decoded: OwnerElevenLabsDialogueDecodedResult;
      try { decoded = decodeOwnerElevenLabsDialogueResult(rawResult, context); }
      catch { addGap(entry, "RESULT_CODEC_REJECTED"); throw unknown(entry); }
      if (decoded.availability === "UNVERIFIED") { entry.diagnostic.gaps.push(...decoded.gaps); throw unknown(entry); }
      if (decoded.availability !== "OBSERVED") partial = true;
      if (decoded.model_echo === "UNKNOWN") partial = true;
      entry.diagnostic.gaps.push(...decoded.gaps);
      for (const artifact of decoded.artifacts) {
        if (seenIds.has(artifact.message_object_id) || seenUrls.has(artifact.url)) { addGap(entry, "DUPLICATE_RESULT_OBJECT"); throw unknown(entry); }
        seenIds.add(artifact.message_object_id); seenUrls.add(artifact.url);
        artifacts.push(Object.freeze({ ...artifact, model_echo: decoded.model_echo }));
      }
      if (artifacts.length > MAX_RESULTS) { addGap(entry, "RESULT_LIMIT"); throw unknown(entry); }
    }
    if (!artifacts.length) throw unknown(entry);
    entry.artifacts = Object.freeze(artifacts); entry.status = partial ? "partial_results" : "observed_results";
    entry.diagnostic.phase = "RESULT_BINDING"; return page(entry, 0);
  }

  async #runPreflight(attemptId: string, modelId: OwnerElevenLabsDialogueModel, charsCount: number, deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted(); let accountService: AccountStatusService; let accessService: ModelAccessService;
    try { accountService = Reflect.apply(this.#createAccount, undefined, [attemptId]); accessService = Reflect.apply(this.#createAccess, undefined, [attemptId]); }
    catch { fail("PREFLIGHT_FAILED"); }
    if (!isExactService(accountService, AccountStatusService, ["getAccountStatus"]) || this.#usedAccounts.has(accountService) ||
        !isExactService(accessService, ModelAccessService, ["getModelAccess"]) || this.#usedAccess.has(accessService)) fail("PREFLIGHT_FAILED");
    this.#usedAccounts.add(accountService); this.#usedAccess.add(accessService);
    let account: AccountStatusResult; let access: ModelAccessResult;
    try {
      account = await this.#await(deadline, () => Reflect.apply(AccountStatusService.prototype.getAccountStatus, accountService, [deadline.signal]));
      access = await this.#await(deadline, () => Reflect.apply(ModelAccessService.prototype.getModelAccess, accessService,
        [{ model_id: modelId, cost_parameters: { chars_count: charsCount, mode: "text_to_dialogue" } }, deadline.signal]));
    } catch { fail("PREFLIGHT_FAILED"); }
    assertFreshPreflight(account, access, modelId, this.#catalog, this.#readNow());
  }
  #assertSource(): void {
    let source: ReturnType<typeof getOwnerElevenLabsDialogueSourceProfile>;
    try { source = getOwnerElevenLabsDialogueSourceProfile(); } catch { fail("MODEL_BINDING_MISMATCH"); }
    if (this.#catalogVersion !== OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION || source.generation_allowed !== false ||
        source.dispatch_allowed !== false || source.backend_acceptance !== "UNPROVEN" || source.runtime_usable !== false ||
        source.source_binding.build_id !== "1791904852" || source.source_binding.audio_route_module.sha256 !==
          "sha256:4a0b37bbf45cb8e2c5e8eb01794cd59b00f437a9f5b23b26c0da07a00eb79ba2") fail("MODEL_BINDING_MISMATCH");
  }
  #resolveNativeClient(attemptId: string): SyntxChatHttpClient {
    const previous = this.#clients.get(attemptId); if (previous) { this.#nativeMethods(previous); return previous; }
    if (this.#clients.size >= 128) fail("SERVICE_BUSY");
    let client: unknown; try { client = Reflect.apply(this.#resolveClient, undefined, [attemptId]); } catch { fail("PRE_DISPATCH_FAILED"); }
    if (!isExactInstance(client, SyntxChatHttpClient)) fail("PRE_DISPATCH_FAILED");
    this.#nativeMethods(client); this.#clients.set(attemptId, client); return client;
  }
  #nativeMethods(client: SyntxChatHttpClient): NativeMethods {
    if (Object.getPrototypeOf(client) !== SyntxChatHttpClient.prototype || Object.hasOwn(client, NATIVE_NAMES.create) ||
        Object.hasOwn(client, NATIVE_NAMES.start) || Object.hasOwn(client, NATIVE_NAMES.history) || Object.hasOwn(client, NATIVE_NAMES.result)) fail("PRE_DISPATCH_FAILED");
    if (Object.values(NATIVE_METHODS).some((method) => typeof method !== "function") ||
        Object.entries(NATIVE_NAMES).some(([key, name]) => CHAT_PROTO[name] !== NATIVE_METHODS[key as keyof NativeMethods])) fail("PRE_DISPATCH_FAILED");
    return NATIVE_METHODS as NativeMethods;
  }
  async #resolvePrincipal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    try { const principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
      if (principal.connection_id !== attemptId || principal.tenant_id !== this.#binding.tenant_id || principal.subject_id !== this.#binding.subject) fail("PRINCIPAL_NOT_LINKED");
      return principal; } catch { fail("PRINCIPAL_NOT_LINKED"); }
  }
  #deadline(signal: AbortSignal, onAbort: () => Error): AbsoluteRequestDeadline { this.#assertOpen(); return new AbsoluteRequestDeadline(this.#timeout, signal, onAbort); }
  async #await<T>(deadline: AbsoluteRequestDeadline, operation: () => Promise<T>): Promise<T> { deadline.throwIfAborted();
    try { return await deadline.waitFor(operation()); } catch (error) { deadline.throwIfAborted(); throw error; } }
  async #run<T>(attemptId: string, parent: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.#assertOpen(); if (this.#invalidating.has(attemptId)) fail("PRINCIPAL_NOT_LINKED"); if (this.#runs.size >= MAX_RUNS) fail("SERVICE_BUSY");
    if (parent !== undefined && (types.isProxy(parent) || !(parent instanceof AbortSignal))) fail("INVALID_REQUEST");
    const controller = new AbortController(); const abortParent = () => controller.abort(parent?.reason);
    if (parent?.aborted) abortParent(); else parent?.addEventListener("abort", abortParent, { once: true });
    const run: ActiveRun = { attemptId, controller, promise: Promise.resolve() }; const promise = operation(controller.signal); run.promise = promise; this.#runs.add(run);
    try { return await promise; } finally { parent?.removeEventListener("abort", abortParent); this.#runs.delete(run); }
  }
  #readNow(): number { let value: number; try { value = this.#now(); } catch { return fail("SERVICE_BUSY"); }
    if (!Number.isSafeInteger(value) || value < 0 || value < this.#lastNow) fail("SERVICE_BUSY"); this.#lastNow = value; return value; }
  #assertOpen(): void { if (this.#closed || !SERVICES.has(this)) fail("SERVICE_CLOSED"); }
}

export function isOwnerElevenLabsDialogueGenerationService(value: unknown): value is OwnerElevenLabsDialogueGenerationService {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) &&
    Object.getPrototypeOf(value) === OwnerElevenLabsDialogueGenerationService.prototype; } catch { return false; }
}

function normalizeDialogueRequest(value: unknown): { normalized: { model_id: OwnerElevenLabsDialogueModel; settings_candidate: OwnerElevenLabsGenerationSettingsCandidate };
  preparerRequest: unknown; prompt: string } {
  const row = exactRecord(value, ["model_id", "mode", "prompt", "inputs", "stability", "similarity_boost"], ["language_code"]);
  if (typeof row.prompt !== "string" || Buffer.byteLength(row.prompt, "utf8") > MAX_PROMPT_BYTES) fail("INVALID_REQUEST");
  const request = Object.freeze({ model_id: row.model_id, mode: row.mode, inputs: row.inputs, stability: row.stability,
    similarity_boost: row.similarity_boost, ...(row.language_code === undefined ? {} : { language_code: row.language_code }) });
  try { const normalized = normalizeOwnerElevenLabsGenerationParameters(request);
    if (normalized.mode !== "text_to_dialogue") fail("INVALID_REQUEST");
    return { normalized: { model_id: normalized.model_id, settings_candidate: normalized.settings_candidate },
      preparerRequest: Object.freeze({ ...request, prompt: row.prompt }), prompt: row.prompt };
  } catch { return fail("INVALID_REQUEST"); }
}
function snapshotGenerate(value: unknown): Readonly<OwnerElevenLabsDialogueGenerateInput> { const row = exactRecord(value, ["attemptId", "request"]);
  return Object.freeze({ attemptId: safeAttempt(row.attemptId), request: row.request }); }
function snapshotReconcile(value: unknown): Readonly<OwnerElevenLabsDialogueReconcileInput> { const row = exactRecord(value, ["attemptId", "recovery_id"]);
  const attemptId = safeAttempt(row.attemptId); if (typeof row.recovery_id !== "string" || !RECOVERY.test(row.recovery_id)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId, recovery_id: row.recovery_id }); }
function snapshotList(value: unknown): { attemptId: string; limit: number } { const row = exactRecord(value, ["attemptId"], ["limit"]);
  return { attemptId: safeAttempt(row.attemptId), limit: bounded(row.limit, 1, MAX_RECOVERIES, 32) }; }
function snapshotPage(value: unknown): { attemptId: string; recovery_id: string; offset: number } { const row = exactRecord(value, ["attemptId", "recovery_id"], ["offset"]);
  const attemptId = safeAttempt(row.attemptId); if (typeof row.recovery_id !== "string" || !RECOVERY.test(row.recovery_id)) fail("INVALID_REQUEST");
  return { attemptId, recovery_id: row.recovery_id, offset: bounded(row.offset, 0, MAX_RESULTS, 0) }; }
function makeRecovery(input: { request: OwnerElevenLabsDialogueGenerateInput; principal: Readonly<GenerationPrincipalRef>;
  normalized: OwnerElevenLabsGenerationSettingsCandidate; modelId: OwnerElevenLabsDialogueModel; semanticKey: string; inputKey: string;
  chat: NativeChat; candidate: OwnerElevenLabsDialoguePreparedCandidate; permit: OwnerElevenLabsDialogueOneShotPermit; now: number }): RecoveryEntry {
  if (!Number.isSafeInteger(input.now) || input.now > 8_640_000_000_000_000) fail("SERVICE_BUSY");
  const diagnostic: MutableDiagnostic = { phase: "CHAT_CREATE", post_started: false, ack_known: false, owner_ack_status: "NOT_READ",
    history_get_calls: 0, result_get_calls: 0, gaps: [] };
  return { recovery_id: `elevenlabs_dialogue_recovery_${randomUUID()}`, attemptId: input.request.attemptId, principal: input.principal,
    created_at: new Date(input.now).toISOString(), model_id: input.modelId, parameters: Object.freeze({ mode: "text_to_dialogue",
      chars_count: input.normalized.chars_count, line_count: input.normalized.inputs?.length ?? 0 }), semantic_key: input.semanticKey,
    input_key: input.inputKey, chat: input.chat, candidate: input.candidate, permit: input.permit, owner_ack_message_id: null,
    status: "outcome_unknown", artifacts: Object.freeze([]), diagnostic };
}
function readChat(value: unknown, candidate: OwnerElevenLabsDialoguePreparedCandidate, principal: Readonly<GenerationPrincipalRef>, attemptId: string): NativeChat {
  const row = exactRecord(value, ["status", "chat_uuid", "attempt_id", "principal", "model_id", "voice_epoch", "intent_fingerprint",
    "profile_schema_hash", "profile_id", "source_profile_schema_hash", "dispatch_allowed", "backend_acceptance"]);
  if (!Object.isFrozen(value) || row.status !== "created" || !isSafeId(row.chat_uuid) || row.attempt_id !== attemptId || row.model_id !== candidate.model_id ||
      row.voice_epoch !== candidate.voice_epoch || row.intent_fingerprint !== candidate.intent_fingerprint || row.profile_schema_hash !== candidate.profile_schema_hash ||
      row.profile_id !== candidate.profile_id || row.source_profile_schema_hash !== candidate.profile_schema_hash ||
      row.dispatch_allowed !== false || row.backend_acceptance !== "UNPROVEN" ||
      !isHash(row.source_profile_schema_hash) || !sameGenerationPrincipal(row.principal as GenerationPrincipalRef, principal)) fail("PRE_DISPATCH_FAILED");
  return value as NativeChat;
}
function readAck(value: unknown, chat: NativeChat): NativeAck { const row = exactRecord(value, ["chat_uuid", "message_id"]);
  if (!Object.isFrozen(value) || row.chat_uuid !== chat.chat_uuid || !isSafeId(row.message_id)) fail("PRE_DISPATCH_FAILED"); return value as NativeAck; }
function assertFreshPreflight(accountInput: unknown, accessInput: unknown, modelId: OwnerElevenLabsDialogueModel,
  catalog: DiscoveryCatalogRepository, now: number): void {
  try {
    const account = exactRecord(accountInput, ["balance", "subscription", "contract_evidence", "source_build", "observed_at"]);
    const balance = exactRecord(account.balance, ["unit", "available"]);
    const sub = exactRecord(account.subscription, ["active", "plan_type", "end_date", "end_date_kind"]);
    const access = exactRecord(accessInput, ["catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live",
      "parameter_keys", "parameters_redacted", "access", "cost", "discount_cost", "free_remaining_generations", "limit", "show_warning", "observed_at"]);
    const expected = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
    const keys = denseStrings(access.parameter_keys);
    const end = sub.end_date === null ? null : Date.parse(sub.end_date_kind === "DATE_ONLY" ? `${sub.end_date}T23:59:59.999Z` : String(sub.end_date));
    if (account.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || account.source_build !== ACCOUNT_SOURCE_BUILD || balance.unit !== "tokens" ||
        !(balance.available === null || (typeof balance.available === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(balance.available))) ||
        sub.active !== true || !(sub.plan_type === null || typeof sub.plan_type === "string") || !(sub.end_date === null || typeof sub.end_date === "string") ||
        !(sub.end_date_kind === null || ["DATE_ONLY", "LOCAL_DATETIME", "OFFSET_DATETIME"].includes(String(sub.end_date_kind))) ||
        (end !== null && (!Number.isFinite(end) || end < now)) || !freshIso(account.observed_at, now) ||
        access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || access.catalog_version !== expected || access.model_id !== modelId ||
        access.ai_name !== "elevenlabs" || access.model_type !== modelId || access.account_read_live !== true || access.access !== true ||
        access.parameters_redacted !== true || keys[0] !== "chars_count" || keys[1] !== "mode" || keys.length !== 2 || !freshIso(access.observed_at, now) ||
        !nullableFinite(access.cost) || !nullableFinite(access.discount_cost) || !(access.free_remaining_generations === null || nonnegative(access.free_remaining_generations)) ||
        !nullableFinite(access.limit) || !(access.show_warning === null || typeof access.show_warning === "boolean")) fail("PREFLIGHT_FAILED");
  } catch { fail("PREFLIGHT_FAILED"); }
}
function page(entry: RecoveryEntry, offset: number): OwnerElevenLabsDialogueGenerationResult {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_RESULTS) fail("INVALID_REQUEST");
  if (entry.status === "outcome_unknown") throw unknown(entry);
  const artifacts = entry.artifacts.slice(offset, offset + PAGE_SIZE); const next = offset + artifacts.length;
  return Object.freeze({ status: entry.status, status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", backend_acceptance: "UNPROVEN",
    provider_terminal_status: "UNPROVEN", model_id: entry.model_id, parameters: entry.parameters, recovery_id: entry.recovery_id,
    observed_artifact_count: entry.artifacts.length, offset, page_size: PAGE_SIZE, artifacts: Object.freeze(artifacts),
    has_more: next < entry.artifacts.length, next_offset: next < entry.artifacts.length ? next : null, diagnostic: snapshotDiagnostic(entry.diagnostic) });
}
function snapshotDiagnostic(d: MutableDiagnostic): OwnerElevenLabsDialogueDiagnostic { return Object.freeze({ phase: d.phase,
  post_started: d.post_started, ack_known: d.ack_known, owner_ack_status: d.owner_ack_status,
  history_get_calls: d.history_get_calls, result_get_calls: d.result_get_calls, gaps: Object.freeze([...new Set(d.gaps)].slice(0, 32)) }); }
function unknown(entry: RecoveryEntry): OwnerElevenLabsDialogueGenerationServiceError { return serviceError("OUTCOME_UNKNOWN", entry.recovery_id, snapshotDiagnostic(entry.diagnostic)); }
function serviceError(code: OwnerElevenLabsDialogueGenerationServiceErrorCode, id?: string, diagnostic?: OwnerElevenLabsDialogueDiagnostic) {
  return new OwnerElevenLabsDialogueGenerationServiceError(code, id, diagnostic);
}
function intentHash(principal: Readonly<GenerationPrincipalRef>, modelId: OwnerElevenLabsDialogueModel, prompt: string, settings: OwnerElevenLabsGenerationSettingsCandidate): string {
  return hash(JSON.stringify([principal.tenant_id, principal.subject_id, modelId, prompt, settings.inputs?.map((line) => [line.name, line.text, line.voice_ref]),
    settings.chars_count, settings.stability, settings.similarity_boost, settings.language_code ?? null]));
}
function semanticHash(principal: Readonly<GenerationPrincipalRef>, fingerprint: string): string { return hash(JSON.stringify([principal.tenant_id, principal.subject_id, fingerprint])); }
function hash(input: string): string { return createHash("sha256").update(input, "utf8").digest("hex"); }
function addGap(entry: RecoveryEntry, gap: string): void { if (entry.diagnostic.gaps.length < 32) entry.diagnostic.gaps.push(gap); }
function snapshotBinding(value: unknown): Readonly<AuthBinding> { const row = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof row.tenant_id !== "string" || !row.tenant_id.trim() || row.tenant_id.length > 256 || typeof row.subject !== "string" || !row.subject.trim() || row.subject.length > 512) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: row.tenant_id, subject: row.subject }); }
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const proto = Object.getPrototypeOf(value); const desc = Object.getOwnPropertyDescriptors(value);
  if ((proto !== Object.prototype && proto !== null) || required.some((key) => !Object.hasOwn(desc, key)) || Reflect.ownKeys(desc).some((key) =>
    typeof key !== "string" || (!required.includes(key) && !optional.includes(key)) || !("value" in desc[key]!) || desc[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const row = Object.create(null) as Record<string, any>; for (const key of Reflect.ownKeys(desc) as string[]) row[key] = desc[key]!.value; return row;
}
function isExactInstance<T extends object>(value: unknown, ctor: new (...args: never[]) => T): value is T {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && value instanceof ctor && Object.getPrototypeOf(value) === ctor.prototype; } catch { return false; }
}
function isExactService<T extends object>(value: unknown, ctor: new (...args: never[]) => T, methods: readonly string[]): value is T {
  return isExactInstance(value, ctor) && methods.every((key) => typeof Reflect.get(ctor.prototype, key) === "function" &&
    !Object.hasOwn(value, key) && Reflect.get(value, key) === Reflect.get(ctor.prototype, key));
}
function clockFactory(value: unknown): () => number { if (value === undefined) return Date.now; if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST"); return value as () => number; }
function bounded(value: unknown, min: number, max: number, fallback: number): number { if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) fail("INVALID_REQUEST"); return value as number; }
function safeAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST"); return value; }
function freshIso(value: unknown, now: number): boolean { if (typeof value !== "string") return false; const time = Date.parse(value); return Number.isFinite(time) && time <= now + 30_000 && time >= now - 5 * 60_000; }
function nullableFinite(value: unknown): boolean { return value === null || (typeof value === "number" && Number.isFinite(value)); }
function nonnegative(value: unknown): boolean { return Number.isSafeInteger(value) && (value as number) >= 0; }
function denseStrings(value: unknown): string[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 16) fail("PREFLIGHT_FAILED");
  const d = Object.getOwnPropertyDescriptors(value); if (Reflect.ownKeys(d).length !== value.length + 1) fail("PREFLIGHT_FAILED");
  const values = Array.from({ length: value.length }, (_, i) => { const item = d[String(i)]; if (!item || !("value" in item) || typeof item.value !== "string") fail("PREFLIGHT_FAILED"); return item.value; });
  return values.sort();
}
function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function isHash(value: unknown): value is string { return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value); }
function fail(code: OwnerElevenLabsDialogueGenerationServiceErrorCode): never { throw serviceError(code); }
