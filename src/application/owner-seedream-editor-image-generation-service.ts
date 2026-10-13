import { randomUUID } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { SyntxChatHttpClient, type MediaGenerationReceipt, type OwnerSeedreamEditorImageResultCandidates,
  type OwnerSeedreamEditorImagePostDispatchWitness } from "../adapter/syntx/chat-http-client.js";
import type { OwnerSeedreamEditorImageResult } from "../adapter/syntx/owner-seedream-editor-image-result.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { loadSelectedDiscoveryCatalog } from "../catalog/selected-discovery-catalog.js";
import { loadMaplessSettingsInventoryVersion } from "../catalog/mapless-settings-inventory.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { AccountStatusService, type AccountStatusResult } from "./account-status.js";
import { ModelAccessService, type ModelAccessResult } from "./model-access.js";
import { OWNER_SEEDREAM_IMAGE_VARIANTS, type OwnerSeedreamImageVariant } from "./owner-seedream-image-parameters.js";
import { OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION, OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION,
  getOwnerSeedreamEditorOriginalUploadSourceProfile } from "./owner-seedream-editor-original-upload-source-profile.js";
import { getOwnerSeedreamEditorGenerationSourceProfile } from "./owner-seedream-editor-generation-source-profile.js";
import { projectOwnerSeedreamEditorCostParameters } from "./owner-seedream-editor-parameters.js";
import { createOwnerSeedreamEditorImageRequestPreparer, type OwnerSeedreamEditorImageRequestPreparer }
  from "./owner-seedream-editor-image-request-preparer.js";
import { createOwnerSeedreamEditorImageOneShotPermit } from "./owner-seedream-editor-image-one-shot-policy.js";
import { OwnerSeedreamEditorOriginalReferenceService } from "./owner-seedream-editor-original-reference-service.js";
import { OwnerSeedreamEditorDrawingReferenceService } from "./owner-seedream-editor-drawing-reference-service.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const MAX_PENDING = 4, MAX_CLAIMS = 128, MAX_RECOVERIES = 128, MAX_RESULTS = 128, MAX_PREPARERS = 128;
const MAX_ARTIFACTS = 4_096, PAGE_SIZE = 64;
const DEFAULT_TIMEOUT = 180_000, MAX_TIMEOUT = 180_000, DEFAULT_DELAY = 2_000, MAX_DELAY = 40_000;
const DEFAULT_POLLS = 8, MAX_POLLS = 32;
const CREATE_CHAT = SyntxChatHttpClient.prototype.createSeedreamEditorChat;
const START = SyntxChatHttpClient.prototype.startSeedreamEditorImageWithOwnedCandidate;
const LIST = SyntxChatHttpClient.prototype.listSeedreamEditorImageResultCandidates;
const GET_RESULT = SyntxChatHttpClient.prototype.getSeedreamEditorImageResult;
const GET_RECOVERY_WITNESS = SyntxChatHttpClient.prototype.getSeedreamEditorImagePostDispatchWitness;
const INVALIDATE_EDITOR_ATTEMPT = SyntxChatHttpClient.prototype.invalidateSeedreamEditorImageAttempt;

export type OwnerSeedreamEditorImageGenerationPhase = "REQUEST_PREPARE" | "PREFLIGHT" | "CHAT_CREATE" | "GENERATION_POST" |
  "POST_ACK_KNOWN" | "HISTORY_GET" | "HISTORY_BINDING" | "RESULT_GET" | "RESULT_BINDING" | "RESULT_WAIT";
export interface OwnerSeedreamEditorImageGenerateInput {
  readonly attemptId: string;
  readonly input: Readonly<{ variant: OwnerSeedreamImageVariant; prompt: string; parameters: unknown;
    original_handle: string; drawing_handle: string | null }>;
}
export interface OwnerSeedreamEditorImageReconcileInput { readonly attemptId: string; readonly recovery_id: string }
export interface OwnerSeedreamEditorImageRecoveryListInput { readonly attemptId: string; readonly limit?: number }
export interface OwnerSeedreamEditorImageResultPageInput {
  readonly attemptId: string; readonly result_id: string; readonly offset: number; readonly limit?: number;
}
export interface OwnerSeedreamEditorImageArtifact {
  readonly url: string; readonly mime_type: string | null; readonly width: null; readonly height: null;
  readonly geometry_verified: false; readonly message_id: string; readonly object_index: number;
  readonly message_object_id: string | null;
}
export interface OwnerSeedreamEditorImageGenerationResult {
  readonly status: "completed" | "partial_results"; readonly backend_acceptance: "UNPROVEN";
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly attempt_id: string; readonly variant: OwnerSeedreamImageVariant; readonly requested_model: OwnerSeedreamImageVariant;
  readonly model_echo: "MATCHED" | "UNKNOWN" | "MISMATCH"; readonly profile_schema_hash: string;
  readonly request_fingerprint: string; readonly cost_inputs: Readonly<Record<string, string | number>>;
  readonly cost_input_confidence: "SOURCE_JOINED_COST_QUERY_INPUTS_NOT_QUOTE_BILLING_OR_OUTPUT_COUNT";
  readonly result_id: string; readonly observed_total: number; readonly next_offset: number | null; readonly has_more: boolean;
  readonly artifacts: readonly Readonly<OwnerSeedreamEditorImageArtifact>[]; readonly diagnostics: readonly string[];
  readonly recovery_id?: string;
}
export interface OwnerSeedreamEditorImageResultPage {
  readonly result_id: string; readonly offset: number; readonly limit: number; readonly observed_total: number;
  readonly next_offset: number | null; readonly has_more: boolean; readonly artifacts: readonly Readonly<OwnerSeedreamEditorImageArtifact>[];
}
export interface OwnerSeedreamEditorImageRecoveryListItem {
  readonly recovery_id: string; readonly created_at: string; readonly variant: OwnerSeedreamImageVariant;
  readonly status: "OUTCOME_UNKNOWN"; readonly phase: OwnerSeedreamEditorImageGenerationPhase;
}
export interface OwnerSeedreamEditorImageGenerationServiceOptions {
  readonly binding: AuthBinding; readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly originalReferenceService: OwnerSeedreamEditorOriginalReferenceService;
  readonly drawingReferenceService: OwnerSeedreamEditorDrawingReferenceService;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly createAccountStatusService: (attemptId: string) => AccountStatusService;
  readonly createModelAccessService: (attemptId: string, catalog: DiscoveryCatalogRepository) => ModelAccessService;
  readonly now?: () => number; readonly timeoutMs?: number; readonly pollDelayMs?: number; readonly maxPollAttempts?: number;
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}
export interface OwnerSeedreamEditorImageGenerationService {
  generate(input: OwnerSeedreamEditorImageGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerSeedreamEditorImageGenerationResult>;
  reconcile(input: OwnerSeedreamEditorImageReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerSeedreamEditorImageGenerationResult>;
  listRecoveries(input: OwnerSeedreamEditorImageRecoveryListInput | unknown): Promise<readonly OwnerSeedreamEditorImageRecoveryListItem[]>;
  getResultPage(input: OwnerSeedreamEditorImageResultPageInput | unknown, signal?: AbortSignal): Promise<OwnerSeedreamEditorImageResultPage>;
  invalidateAttempt(attemptId: string): Promise<void>; close(): Promise<void>;
}
export const OWNER_SEEDREAM_EDITOR_IMAGE_GENERATION_ERROR_CODES = Object.freeze(["INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY",
  "PRINCIPAL_NOT_LINKED", "PREFLIGHT_FAILED", "INTENT_ALREADY_CLAIMED", "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN",
  "RECOVERY_NOT_FOUND", "RESULT_NOT_FOUND", "RESULT_PAGE_INVALID", "CLOCK_INVALID"] as const);
export type OwnerSeedreamEditorImageGenerationErrorCode = typeof OWNER_SEEDREAM_EDITOR_IMAGE_GENERATION_ERROR_CODES[number];
export class OwnerSeedreamEditorImageGenerationServiceError extends Error {
  constructor(readonly code: OwnerSeedreamEditorImageGenerationErrorCode, readonly recovery_id?: string) {
    super(code === "OUTCOME_UNKNOWN" ? "The Seedream Editor request may have been dispatched; reconcile it and do not retry."
      : "The Seedream Editor generation request could not be completed safely.");
    this.name = "OwnerSeedreamEditorImageGenerationServiceError";
  }
}

type Input = Readonly<OwnerSeedreamEditorImageGenerateInput["input"]>;
type Claim = { readonly key: string; readonly created: number; state: "RESERVED" | "UNKNOWN" | "RESOLVED" };
type Recovery = { readonly id: string; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>; readonly epoch: number;
  readonly key: string; readonly created_at: string; readonly expires: number; readonly variant: OwnerSeedreamImageVariant;
  readonly profile_hash: string; readonly fingerprint: string; readonly cost_inputs: Readonly<Record<string, string | number>>;
  readonly client: SyntxChatHttpClient; readonly chat_uuid: string; readonly witness: OwnerSeedreamEditorImagePostDispatchWitness;
  readonly ack: string | null; phase: OwnerSeedreamEditorImageGenerationPhase;
  diagnostics: readonly string[]; model_echo: "MATCHED" | "UNKNOWN" | "MISMATCH"; result_id?: string };
type ResultRecord = { readonly id: string; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>; readonly epoch: number;
  readonly expires: number; readonly recovery: Recovery; readonly artifacts: Map<string, OwnerSeedreamEditorImageArtifact>;
  status: "completed" | "partial_results"; model_echo: "MATCHED" | "UNKNOWN" | "MISMATCH"; diagnostics: readonly string[] };
const services = new WeakSet<object>();

export function createOwnerSeedreamEditorImageGenerationService(options: OwnerSeedreamEditorImageGenerationServiceOptions | unknown): OwnerSeedreamEditorImageGenerationService {
  return new OwnerSeedreamEditorImageGenerationServiceImpl(options);
}
export function isOwnerSeedreamEditorImageGenerationService(value: unknown): value is OwnerSeedreamEditorImageGenerationService {
  return !!value && typeof value === "object" && !types.isProxy(value) && services.has(value as object);
}

class OwnerSeedreamEditorImageGenerationServiceImpl implements OwnerSeedreamEditorImageGenerationService {
  readonly #binding: AuthBinding; readonly #link: Pick<PerUserLinkService, "getStatus">; readonly #catalog: DiscoveryCatalogRepository;
  readonly #settings: ReturnType<typeof loadMaplessSettingsInventoryVersion>;
  readonly #original: OwnerSeedreamEditorOriginalReferenceService; readonly #drawing: OwnerSeedreamEditorDrawingReferenceService;
  readonly #resolveClient: OwnerSeedreamEditorImageGenerationServiceOptions["resolveChatClient"];
  readonly #createAccount: OwnerSeedreamEditorImageGenerationServiceOptions["createAccountStatusService"];
  readonly #createAccess: OwnerSeedreamEditorImageGenerationServiceOptions["createModelAccessService"];
  readonly #now: () => number; readonly #wait: NonNullable<OwnerSeedreamEditorImageGenerationServiceOptions["wait"]>;
  readonly #timeout: number; readonly #delay: number; readonly #polls: number;
  readonly #preparers = new Map<string, OwnerSeedreamEditorImageRequestPreparer>(); readonly #recoveries = new Map<string, Recovery>();
  readonly #results = new Map<string, ResultRecord>(); readonly #claims = new Map<string, Claim>(); readonly #epochs = new Map<string, number>();
  readonly #runs = new Set<Promise<unknown>>(); readonly #runsByAttempt = new Map<string, Set<Promise<unknown>>>();
  readonly #controllers = new Map<string, Set<AbortController>>(); readonly #usedAccounts = new WeakSet<object>(); readonly #usedAccess = new WeakSet<object>();
  readonly #invalidating = new Set<string>(); #closed = false; #closing: Promise<void> | undefined; #lastNow: number;
  constructor(input: unknown) {
    const o = exact(input, ["binding", "linkService", "originalReferenceService", "drawingReferenceService", "resolveChatClient",
      "createAccountStatusService", "createModelAccessService"], ["now", "timeoutMs", "pollDelayMs", "maxPollAttempts", "wait"]);
    if (typeof o.resolveChatClient !== "function" || types.isProxy(o.resolveChatClient) || typeof o.createAccountStatusService !== "function" ||
        types.isProxy(o.createAccountStatusService) || typeof o.createModelAccessService !== "function" || types.isProxy(o.createModelAccessService) ||
        (o.now !== undefined && (typeof o.now !== "function" || types.isProxy(o.now))) ||
        (o.wait !== undefined && (typeof o.wait !== "function" || types.isProxy(o.wait)))) fail("INVALID_REQUEST");
    const binding = exact(o.binding, ["tenant_id", "subject"]);
    if (typeof binding.tenant_id !== "string" || !binding.tenant_id || typeof binding.subject !== "string" || !binding.subject ||
        !o.linkService || typeof o.linkService !== "object" || types.isProxy(o.linkService) || typeof o.linkService.getStatus !== "function" ||
        types.isProxy(o.linkService.getStatus)) fail("INVALID_REQUEST");
    this.#binding = Object.freeze({ tenant_id: binding.tenant_id, subject: binding.subject }) as AuthBinding;
    this.#link = o.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#catalog = loadSelectedDiscoveryCatalog(OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION).discoveryCatalog;
    this.#settings = loadMaplessSettingsInventoryVersion(OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION);
    for (const variant of OWNER_SEEDREAM_IMAGE_VARIANTS) {
      const model = this.#catalog.getModel(variant);
      if (model.id !== variant || model.upstream_id !== variant || model.ai_name !== "seedream" || model.active !== true ||
          model.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || model.runtime_usable !== false) fail("PREFLIGHT_FAILED");
      const original = getOwnerSeedreamEditorOriginalUploadSourceProfile(variant, this.#catalog,
        OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION, this.#settings, OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION);
      getOwnerSeedreamEditorGenerationSourceProfile(variant, original);
    }
    this.#original = exactService(o.originalReferenceService, OwnerSeedreamEditorOriginalReferenceService,
      ["upload", "resolveOriginal", "isOwnedOriginalResolution", "invalidateAttempt", "close"]);
    this.#drawing = exactService(o.drawingReferenceService, OwnerSeedreamEditorDrawingReferenceService,
      ["uploadDrawing", "resolveDrawing", "isOwnedDrawingResolution", "invalidateAttempt", "close"]);
    this.#resolveClient = o.resolveChatClient as OwnerSeedreamEditorImageGenerationServiceOptions["resolveChatClient"];
    this.#createAccount = o.createAccountStatusService as OwnerSeedreamEditorImageGenerationServiceOptions["createAccountStatusService"];
    this.#createAccess = o.createModelAccessService as OwnerSeedreamEditorImageGenerationServiceOptions["createModelAccessService"];
    this.#now = o.now === undefined ? Date.now : o.now as () => number; this.#lastNow = clock(this.#now);
    this.#timeout = integer(o.timeoutMs, 1, MAX_TIMEOUT, DEFAULT_TIMEOUT); this.#delay = integer(o.pollDelayMs, 0, MAX_DELAY, DEFAULT_DELAY);
    this.#polls = integer(o.maxPollAttempts, 1, MAX_POLLS, DEFAULT_POLLS); this.#wait = (o.wait ?? delay) as NonNullable<OwnerSeedreamEditorImageGenerationServiceOptions["wait"]>;
    services.add(this); Object.freeze(this);
  }
  generate(value: unknown, signal?: AbortSignal): Promise<OwnerSeedreamEditorImageGenerationResult> {
    const f = exact(value, ["attemptId", "input"]); if (!isAttempt(f.attemptId)) fail("INVALID_REQUEST");
    const input = readInput(f.input); return this.#run(f.attemptId, signal, (s) => this.#generate(f.attemptId as string, input, s));
  }
  reconcile(value: unknown, signal?: AbortSignal): Promise<OwnerSeedreamEditorImageGenerationResult> {
    const f = exact(value, ["attemptId", "recovery_id"]); if (!isAttempt(f.attemptId) || !isId(f.recovery_id)) fail("INVALID_REQUEST");
    return this.#run(f.attemptId, signal, (s) => this.#reconcile(f.attemptId as string, f.recovery_id as string, s));
  }
  listRecoveries(value: unknown): Promise<readonly OwnerSeedreamEditorImageRecoveryListItem[]> {
    const f = exact(value, ["attemptId"], ["limit"]); if (!isAttempt(f.attemptId)) fail("INVALID_REQUEST");
    const limit = integer(f.limit, 1, 128, 20);
    return this.#run(f.attemptId as string, undefined, async (signal) => {
      const principal = await this.#principal(f.attemptId as string, signal);
      return Object.freeze([...this.#recoveries.values()].filter((r) => r.attemptId === f.attemptId &&
        sameGenerationPrincipal(r.principal, principal) && (this.#epochs.get(r.attemptId) ?? 0) === r.epoch)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit).map((r) => Object.freeze({ recovery_id: r.id,
          created_at: r.created_at, variant: r.variant, status: "OUTCOME_UNKNOWN" as const, phase: r.phase })));
    });
  }
  getResultPage(value: unknown, signal?: AbortSignal): Promise<OwnerSeedreamEditorImageResultPage> {
    const f = exact(value, ["attemptId", "result_id", "offset"], ["limit"]);
    if (!isAttempt(f.attemptId) || !isId(f.result_id) || !Number.isSafeInteger(f.offset) || (f.offset as number) < 0) fail("INVALID_REQUEST");
    const limit = integer(f.limit, 1, PAGE_SIZE, PAGE_SIZE);
    return this.#run(f.attemptId as string, signal, async (runSignal) => {
      const record = this.#results.get(f.result_id as string);
      if (!record || record.attemptId !== f.attemptId || record.expires <= this.#readNow() ||
          (this.#epochs.get(record.attemptId) ?? 0) !== record.epoch) fail("RESULT_NOT_FOUND");
      const principal = await this.#principal(f.attemptId as string, runSignal);
      if (!sameGenerationPrincipal(principal, record.principal)) fail("RESULT_NOT_FOUND");
      return this.#page(record, f.offset as number, limit);
    });
  }
  async invalidateAttempt(attempt: string): Promise<void> {
    if (!isAttempt(attempt)) fail("INVALID_REQUEST"); this.#invalidating.add(attempt); this.#epochs.set(attempt, (this.#epochs.get(attempt) ?? 0) + 1);
    for (const controller of this.#controllers.get(attempt) ?? []) controller.abort();
    await Promise.allSettled([...(this.#runsByAttempt.get(attempt) ?? [])]);
    try { Reflect.apply(INVALIDATE_EDITOR_ATTEMPT, this.#client(attempt), [attempt]); } catch { /* revoked runtime clients need no further native cleanup */ }
    await this.#preparers.get(attempt)?.invalidateAttempt(attempt);
    this.#preparers.delete(attempt);
    this.#recoveries.forEach((r, id) => { if (r.attemptId === attempt) this.#recoveries.delete(id); });
    this.#results.forEach((r, id) => { if (r.attemptId === attempt) this.#results.delete(id); });
    this.#invalidating.delete(attempt);
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing; this.#closed = true;
    const attempts = new Set([...this.#preparers.keys(), ...this.#runsByAttempt.keys(), ...[...this.#recoveries.values()].map((r) => r.attemptId)]);
    for (const set of this.#controllers.values()) for (const controller of set) controller.abort();
    this.#closing = Promise.allSettled([...this.#runs]).then(async () => {
      for (const attempt of attempts) { try { Reflect.apply(INVALIDATE_EDITOR_ATTEMPT, this.#client(attempt), [attempt]); } catch { /* client may already be retired */ } }
      await Promise.allSettled([...this.#preparers.values()].map((p) => p.close())); this.#preparers.clear();
      this.#recoveries.clear(); this.#results.clear(); this.#claims.clear();
    }).then(() => undefined); return this.#closing;
  }
  async #generate(attempt: string, input: Input, signal: AbortSignal): Promise<OwnerSeedreamEditorImageGenerationResult> {
    this.#prune(); const epoch = this.#epochs.get(attempt) ?? 0; const principal = await this.#principal(attempt, signal);
    const preparer = this.#getPreparer(attempt); const profile = getOwnerSeedreamEditorGenerationSourceProfile(input.variant,
      getOwnerSeedreamEditorOriginalUploadSourceProfile(input.variant, this.#catalog, OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION,
        this.#settings, OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION));
    const cost = projectOwnerSeedreamEditorCostParameters({ variant: input.variant, parameters: input.parameters,
      can_reset: input.drawing_handle !== null });
    if (this.#recoveries.size >= MAX_RECOVERIES || this.#results.size >= MAX_RESULTS) fail("SERVICE_BUSY");
    await this.#preflight(attempt, input.variant, cost, signal);
    const candidate = await preparer.prepare({ attemptId: attempt, ...input, signal });
    const binding = preparer.inspectCandidate(candidate);
    if (!binding || !sameGenerationPrincipal(binding.principal, principal) || binding.variant !== input.variant ||
        binding.profile_schema_hash !== profile.profile_schema_hash || binding.cost_inputs === undefined ||
        !isDeepStrictEqual(binding.cost_inputs, cost)) fail("PRE_DISPATCH_FAILED");
    const key = binding.intent_fingerprint;
    this.#assertAvailable(key);
    const currentPrincipal = await this.#principal(attempt, signal);
    if (!sameGenerationPrincipal(principal, currentPrincipal)) fail("PRINCIPAL_NOT_LINKED");
    if (this.#claims.size >= MAX_CLAIMS || this.#recoveries.size >= MAX_RECOVERIES || this.#results.size >= MAX_RESULTS) fail("SERVICE_BUSY");
    this.#assertAvailable(key);
    const claim: Claim = { key, created: this.#readNow(), state: "RESERVED" }; this.#claims.set(key, claim);
    let client: SyntxChatHttpClient | undefined, chatUuid: string | undefined, recovery: Recovery | undefined, postStarted = false;
    let phase: OwnerSeedreamEditorImageGenerationPhase = "CHAT_CREATE";
    try {
      client = this.#client(attempt); const chat = await Reflect.apply(CREATE_CHAT, client, ["Seedream Editor", signal, attempt]) as { chat_uuid: string };
      chatUuid = chat.chat_uuid; this.#assertCurrent(attempt, epoch, signal);
      const latestPrincipal = await this.#principal(attempt, signal);
      if (!sameGenerationPrincipal(principal, latestPrincipal)) fail("PRINCIPAL_NOT_LINKED");
      await this.#preflight(attempt, input.variant, cost, signal);
      const permit = await createOwnerSeedreamEditorImageOneShotPermit({ preparer, candidate, principal, attemptId: attempt });
      this.#assertCurrent(attempt, epoch, signal); phase = "GENERATION_POST"; claim.state = "UNKNOWN"; postStarted = true;
      const receipt = await Reflect.apply(START, client, [{ preparer, candidate, permit, principal, attemptId: attempt, chat_uuid: chatUuid }, signal]) as MediaGenerationReceipt;
      if (!receipt || receipt.chat_uuid !== chatUuid || typeof receipt.message_id !== "string") throw new Error("ACK_UNKNOWN");
      const witness = this.#postDispatchWitness(client, attempt, chatUuid);
      if (!witness) throw new ServiceError("OUTCOME_UNKNOWN");
      phase = "POST_ACK_KNOWN"; recovery = this.#makeRecovery(attempt, principal, epoch, key, input.variant, profile.profile_schema_hash,
        binding.request_fingerprint, cost, client, chatUuid, witness, receipt.message_id, phase);
      this.#recoveries.set(recovery.id, recovery);
      const result = await this.#poll(recovery, signal); if (result) { if (result.status === "completed") claim.state = "RESOLVED"; return result; }
      throw new ServiceError("OUTCOME_UNKNOWN", recovery.id);
    } catch (error) {
      if (!postStarted) { this.#claims.delete(key); throw error; }
      claim.state = "UNKNOWN";
      if (!recovery && client && chatUuid) {
        const witness = this.#postDispatchWitness(client, attempt, chatUuid);
        if (witness) {
          recovery = this.#makeRecovery(attempt, principal, epoch, key, input.variant, profile.profile_schema_hash,
            binding.request_fingerprint, cost, client, chatUuid, witness, null, phase);
          this.#recoveries.set(recovery.id, recovery);
        }
      }
      if (error instanceof ServiceError && error.code === "OUTCOME_UNKNOWN") throw error;
      throw new ServiceError("OUTCOME_UNKNOWN", recovery?.id);
    }
  }
  async #reconcile(attempt: string, id: string, signal: AbortSignal): Promise<OwnerSeedreamEditorImageGenerationResult> {
    const r = this.#recoveries.get(id); if (!r || r.attemptId !== attempt) fail("RECOVERY_NOT_FOUND");
    const principal = await this.#principal(attempt, signal);
    if (!sameGenerationPrincipal(principal, r.principal) || (this.#epochs.get(attempt) ?? 0) !== r.epoch || this.#client(attempt) !== r.client) fail("RECOVERY_NOT_FOUND");
    const result = await this.#poll(r, signal); if (!result) { r.phase = "RESULT_WAIT"; throw new ServiceError("OUTCOME_UNKNOWN", id); }
    if (result.status === "completed") { const claim = this.#claims.get(r.key); if (claim) claim.state = "RESOLVED"; }
    return result;
  }
  async #poll(r: Recovery, signal: AbortSignal): Promise<OwnerSeedreamEditorImageGenerationResult | null> {
    const prior = r.result_id === undefined ? undefined : this.#results.get(r.result_id);
    const observed = new Map<string, OwnerSeedreamEditorImageArtifact>(prior?.artifacts), diagnostics = new Set<string>(prior?.diagnostics);
    let modelEcho: "MATCHED" | "UNKNOWN" | "MISMATCH" = "MATCHED", fullyBound = false;
    for (let n = 0; n < this.#polls; n += 1) {
      this.#assertCurrent(r.attemptId, r.epoch, signal); let listed: OwnerSeedreamEditorImageResultCandidates;
      try { r.phase = "HISTORY_GET"; listed = await Reflect.apply(LIST, r.client, [r.witness, signal]) as OwnerSeedreamEditorImageResultCandidates; }
      catch { diagnostics.add("RESULT_CANDIDATES_UNAVAILABLE"); await this.#pause(signal); continue; }
      for (const gap of listed.gaps) diagnostics.add(gap);
      if (listed.chat_uuid !== r.chat_uuid || (r.ack !== null && listed.owner_echo_message_id !== r.ack)) diagnostics.add("RESULT_CONTEXT_SCOPE_MISMATCH");
      const contexts = listed.contexts.filter((c) => c.chat_uuid === r.chat_uuid && c.variant === r.variant &&
        (r.ack === null || c.owner_echo_message_id === r.ack));
      fullyBound = listed.history_binding_status === "BOUND" && listed.history_page_status === "COMPLETE" && listed.gaps.length === 0 && contexts.length > 0;
      if (!contexts.length) { diagnostics.add("RESULT_NOT_OBSERVED"); await this.#pause(signal); continue; }
      for (const context of contexts) {
        r.phase = "RESULT_GET"; let decoded: OwnerSeedreamEditorImageResult;
        try { decoded = await Reflect.apply(GET_RESULT, r.client, [context, signal]) as OwnerSeedreamEditorImageResult; }
        catch { diagnostics.add("RESULT_READ_UNAVAILABLE"); fullyBound = false; continue; }
        r.phase = "RESULT_BINDING"; if (decoded.message_binding !== "BOUND" || decoded.chat_uuid !== r.chat_uuid || decoded.message_id !== context.message_id) {
          diagnostics.add("RESULT_MESSAGE_UNBOUND"); fullyBound = false; continue;
        }
        if (decoded.model_echo === "MISMATCH") { modelEcho = "MISMATCH"; diagnostics.add("MODEL_ECHO_MISMATCH"); fullyBound = false; }
        else if (decoded.model_echo === "UNKNOWN" && modelEcho !== "MISMATCH") modelEcho = "UNKNOWN";
        for (const gap of decoded.gaps) diagnostics.add(gap.code);
        if (decoded.gaps.length) fullyBound = false;
        for (const image of decoded.ready_images) {
          if (image.model_echo === "UNKNOWN" && modelEcho !== "MISMATCH") modelEcho = "UNKNOWN";
          const item: OwnerSeedreamEditorImageArtifact = Object.freeze({ url: image.object_url, mime_type: image.mime_type, width: null,
            height: null, geometry_verified: false, message_id: decoded.message_id, object_index: image.object_index,
            message_object_id: image.message_object_id ?? null });
          const key = `${item.message_id}\u0000${item.message_object_id ?? ""}\u0000${item.object_index}\u0000${item.url}`;
          if (!observed.has(key)) {
            if (observed.size >= MAX_ARTIFACTS) { diagnostics.add("OBSERVED_RESULT_CAPACITY_LIMIT"); fullyBound = false; }
            else observed.set(key, item);
          }
        }
      }
      if (observed.size && fullyBound) { r.model_echo = modelEcho; return this.#present(r, observed, diagnostics, "completed", modelEcho); }
      r.diagnostics = Object.freeze([...diagnostics]); r.model_echo = modelEcho; await this.#pause(signal);
    }
    if (!observed.size) return null;
    r.model_echo = modelEcho; return this.#present(r, observed, diagnostics, "partial_results", modelEcho);
  }
  #present(r: Recovery, incoming: Map<string, OwnerSeedreamEditorImageArtifact>, diagnostics: Set<string>,
    status: "completed" | "partial_results", modelEcho: "MATCHED" | "UNKNOWN" | "MISMATCH"): OwnerSeedreamEditorImageGenerationResult {
    let record = r.result_id ? this.#results.get(r.result_id) : undefined;
    if (r.result_id && !record) fail("RESULT_NOT_FOUND");
    if (!record) {
      if (this.#results.size >= MAX_RESULTS) fail("SERVICE_BUSY");
      record = { id: `seedream_editor_result_${randomUUID()}`, attemptId: r.attemptId, principal: r.principal, epoch: r.epoch,
        expires: r.expires, recovery: r, artifacts: new Map(), status, model_echo: modelEcho, diagnostics: Object.freeze([]) };
      r.result_id = record.id; this.#results.set(record.id, record);
    }
    for (const [key, artifact] of incoming) { if (!record.artifacts.has(key) && record.artifacts.size >= MAX_ARTIFACTS) fail("SERVICE_BUSY"); record.artifacts.set(key, artifact); }
    record.status = status; record.model_echo = modelEcho; record.diagnostics = Object.freeze([...diagnostics]);
    return this.#result(record);
  }
  #result(r: ResultRecord): OwnerSeedreamEditorImageGenerationResult {
    const page = this.#page(r, 0, PAGE_SIZE);
    return Object.freeze({ status: r.status, status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", backend_acceptance: "UNPROVEN",
      attempt_id: r.attemptId, variant: r.recovery.variant,
      requested_model: r.recovery.variant, model_echo: r.model_echo, profile_schema_hash: r.recovery.profile_hash,
      request_fingerprint: r.recovery.fingerprint, cost_inputs: r.recovery.cost_inputs,
      cost_input_confidence: "SOURCE_JOINED_COST_QUERY_INPUTS_NOT_QUOTE_BILLING_OR_OUTPUT_COUNT", result_id: r.id,
      observed_total: page.observed_total, next_offset: page.next_offset, has_more: page.has_more, artifacts: page.artifacts,
      diagnostics: r.diagnostics, ...(r.status === "partial_results" ? { recovery_id: r.recovery.id } : {}) });
  }
  #page(r: ResultRecord, offset: number, limit: number): OwnerSeedreamEditorImageResultPage {
    const total = r.artifacts.size; if (offset > total) fail("RESULT_PAGE_INVALID");
    const artifacts = Object.freeze([...r.artifacts.values()].slice(offset, offset + limit)), next = offset + artifacts.length;
    return Object.freeze({ result_id: r.id, offset, limit, observed_total: total, next_offset: next < total ? next : null,
      has_more: next < total, artifacts });
  }
  async #preflight(attempt: string, variant: OwnerSeedreamImageVariant, cost: Readonly<Record<string, string | number>>, signal: AbortSignal): Promise<void> {
    this.#assertCurrent(attempt, this.#epochs.get(attempt) ?? 0, signal);
    let account: AccountStatusService, access: ModelAccessService;
    try { account = this.#createAccount(attempt); access = this.#createAccess(attempt, this.#catalog); } catch { fail("PREFLIGHT_FAILED"); }
    if (!exactServiceCheck(account!, AccountStatusService, ["getAccountStatus"]) || this.#usedAccounts.has(account!) ||
        !exactServiceCheck(access!, ModelAccessService, ["getModelAccess"]) || this.#usedAccess.has(access!)) fail("PREFLIGHT_FAILED");
    this.#usedAccounts.add(account!); this.#usedAccess.add(access!);
    let a: AccountStatusResult, m: ModelAccessResult;
    try { a = await Reflect.apply(AccountStatusService.prototype.getAccountStatus, account!, [signal]);
      m = await Reflect.apply(ModelAccessService.prototype.getModelAccess, access!, [{ model_id: variant, cost_parameters: cost }, signal]); }
    catch { fail("PREFLIGHT_FAILED"); }
    const now = this.#readNow(), expectedVersion = `${this.#catalog.fetched_at}.${this.#catalog.source_hashes.models.slice(7, 19)}`;
    const model = this.#catalog.getModel(variant), expectedKeys = Object.keys(cost).sort();
    try {
      const balance = exact(a!.balance, ["unit", "available"]), sub = exact(a!.subscription, ["active", "plan_type", "end_date", "end_date_kind"]);
      const accessRecord = exact(m!, ["catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live", "parameter_keys",
        "parameters_redacted", "access", "cost", "discount_cost", "free_remaining_generations", "limit", "show_warning", "observed_at"]);
      if (a!.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || a!.source_build !== ACCOUNT_SOURCE_BUILD || balance.unit !== "tokens" ||
          !(balance.available === null || typeof balance.available === "string") || sub.active !== true ||
          !(sub.plan_type === null || typeof sub.plan_type === "string") || !validSubscription(sub, now) ||
          !fresh(a!.observed_at, now) || !fresh(m!.observed_at, now) || accessRecord.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" ||
          accessRecord.catalog_version !== expectedVersion || accessRecord.model_id !== variant || accessRecord.ai_name !== "seedream" ||
          accessRecord.model_type !== variant || accessRecord.account_read_live !== true || accessRecord.parameters_redacted !== true ||
          accessRecord.access !== true || !isDeepStrictEqual(accessRecord.parameter_keys, expectedKeys) || accessRecord.parameters_redacted !== true ||
          !nonnegative(accessRecord.cost) || !(accessRecord.discount_cost === null || nonnegative(accessRecord.discount_cost)) ||
          !(accessRecord.free_remaining_generations === null || Number.isSafeInteger(accessRecord.free_remaining_generations) && accessRecord.free_remaining_generations >= 0) ||
          !(accessRecord.limit === null || nonnegative(accessRecord.limit)) || !(accessRecord.show_warning === null || typeof accessRecord.show_warning === "boolean") ||
          model.id !== variant || model.upstream_id !== variant || model.ai_name !== "seedream" || model.active !== true || model.runtime_usable !== false) fail("PREFLIGHT_FAILED");
    } catch (e) { if (e instanceof ServiceError) throw e; fail("PREFLIGHT_FAILED"); }
  }
  #getPreparer(attempt: string): OwnerSeedreamEditorImageRequestPreparer {
    const found = this.#preparers.get(attempt); if (found) return found;
    if (this.#preparers.size >= MAX_PREPARERS) fail("SERVICE_BUSY");
    const value = createOwnerSeedreamEditorImageRequestPreparer({ binding: this.#binding, linkService: this.#link,
      originalReferenceService: this.#original, drawingReferenceService: this.#drawing, now: this.#now });
    this.#preparers.set(attempt, value); return value;
  }
  async #principal(attempt: string, signal: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    this.#assertCurrent(attempt, this.#epochs.get(attempt) ?? 0, signal);
    try { const result = snapshotGenerationPrincipal(await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: attempt, linkService: this.#link }));
      if (result.connection_id !== attempt) fail("PRINCIPAL_NOT_LINKED"); return result; }
    catch { fail("PRINCIPAL_NOT_LINKED"); }
  }
  #client(attempt: string): SyntxChatHttpClient {
    const c = this.#resolveClient(attempt);
    if (!(c instanceof SyntxChatHttpClient) || types.isProxy(c) || Object.getPrototypeOf(c) !== SyntxChatHttpClient.prototype ||
        c.createSeedreamEditorChat !== CREATE_CHAT || c.startSeedreamEditorImageWithOwnedCandidate !== START ||
        c.listSeedreamEditorImageResultCandidates !== LIST || c.getSeedreamEditorImageResult !== GET_RESULT ||
        c.getSeedreamEditorImagePostDispatchWitness !== GET_RECOVERY_WITNESS ||
        c.invalidateSeedreamEditorImageAttempt !== INVALIDATE_EDITOR_ATTEMPT) fail("PREFLIGHT_FAILED");
    return c;
  }
  #makeRecovery(attemptId: string, principal: Readonly<GenerationPrincipalRef>, epoch: number, key: string, variant: OwnerSeedreamImageVariant,
    profileHash: string, fingerprint: string, cost: Readonly<Record<string, string | number>>, client: SyntxChatHttpClient, chat: string,
    witness: OwnerSeedreamEditorImagePostDispatchWitness, ack: string | null, phase: OwnerSeedreamEditorImageGenerationPhase): Recovery {
    const now = this.#readNow();
    return { id: `seedream_editor_recovery_${randomUUID()}`, attemptId, principal, epoch, key, created_at: new Date(now).toISOString(),
      expires: Number.POSITIVE_INFINITY, variant, profile_hash: profileHash, fingerprint, cost_inputs: cost,
      client, chat_uuid: chat, witness, ack, phase, diagnostics: Object.freeze([]), model_echo: "UNKNOWN" };
  }
  #postDispatchWitness(client: SyntxChatHttpClient, attemptId: string, chat: string): OwnerSeedreamEditorImagePostDispatchWitness | undefined {
    try { return Reflect.apply(GET_RECOVERY_WITNESS, client, [{ attemptId, chat_uuid: chat }]) as OwnerSeedreamEditorImagePostDispatchWitness; }
    catch { return undefined; }
  }
  #assertAvailable(key: string): void { const claim = this.#claims.get(key); if (!claim) return;
    if (claim.state === "RESOLVED") { this.#claims.delete(key); return; } fail("INTENT_ALREADY_CLAIMED"); }
  #assertCurrent(attempt: string, epoch: number, signal: AbortSignal): void {
    if (this.#closed) fail("SERVICE_CLOSED"); if (signal.aborted || this.#invalidating.has(attempt) || (this.#epochs.get(attempt) ?? 0) !== epoch) fail("PRE_DISPATCH_FAILED");
  }
  async #run<T>(attempt: string, outer: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.#closed) fail("SERVICE_CLOSED"); if (this.#runs.size >= MAX_PENDING) fail("SERVICE_BUSY");
    const controller = new AbortController(), abort = () => controller.abort(); outer?.addEventListener("abort", abort, { once: true });
    if (outer?.aborted) controller.abort();
    const set = this.#controllers.get(attempt) ?? new Set<AbortController>(); set.add(controller); this.#controllers.set(attempt, set);
    const timeout = setTimeout(abort, this.#timeout), promise = Promise.resolve().then(() => operation(controller.signal));
    this.#runs.add(promise); const byAttempt = this.#runsByAttempt.get(attempt) ?? new Set<Promise<unknown>>(); byAttempt.add(promise); this.#runsByAttempt.set(attempt, byAttempt);
    try { return await promise; } finally { clearTimeout(timeout); outer?.removeEventListener("abort", abort); this.#runs.delete(promise); byAttempt.delete(promise);
      set.delete(controller); if (!byAttempt.size) this.#runsByAttempt.delete(attempt); if (!set.size) this.#controllers.delete(attempt); }
  }
  async #pause(signal: AbortSignal): Promise<void> { await this.#wait(this.#delay, signal); }
  #readNow(): number { const n = clock(this.#now); if (n < this.#lastNow) fail("CLOCK_INVALID"); this.#lastNow = n; return n; }
  #prune(): void { this.#readNow(); for (const [key, claim] of this.#claims) if (claim.state === "RESOLVED") this.#claims.delete(key); }
}
class ServiceError extends OwnerSeedreamEditorImageGenerationServiceError {}
function fail(code: OwnerSeedreamEditorImageGenerationErrorCode, id?: string): never { throw new ServiceError(code, id); }
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, any> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) fail("INVALID_REQUEST");
  const proto = Object.getPrototypeOf(value); if (proto !== Object.prototype && proto !== null) fail("INVALID_REQUEST");
  const d = Object.getOwnPropertyDescriptors(value), allowed = new Set([...required, ...optional]);
  if (Reflect.ownKeys(d).some((k) => typeof k !== "string" || !allowed.has(k) || !("value" in d[k]!) || !d[k]!.enumerable) ||
      required.some((k) => !Object.hasOwn(d, k))) fail("INVALID_REQUEST");
  return Object.fromEntries([...required, ...optional].filter((k) => Object.hasOwn(d, k)).map((k) => [k, d[k]!.value]));
}
function readInput(value: unknown): Input {
  const f = exact(value, ["variant", "prompt", "parameters", "original_handle", "drawing_handle"]);
  if (!OWNER_SEEDREAM_IMAGE_VARIANTS.includes(f.variant) || typeof f.prompt !== "string" || typeof f.original_handle !== "string" ||
      !(f.drawing_handle === null || typeof f.drawing_handle === "string")) fail("INVALID_REQUEST");
  exact(f.parameters, ["aspect_ratio", "resolution"]);
  return Object.freeze({ variant: f.variant, prompt: f.prompt, parameters: Object.freeze({ ...f.parameters }), original_handle: f.original_handle,
    drawing_handle: f.drawing_handle });
}
function exactService<T extends object>(value: unknown, ctor: new (...args: any[]) => T, methods: readonly string[]): T {
  if (!exactServiceCheck(value, ctor, methods)) fail("INVALID_REQUEST"); return value;
}
function exactServiceCheck<T extends object>(value: unknown, ctor: new (...args: any[]) => T, methods: readonly string[]): value is T {
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof ctor) || Object.getPrototypeOf(value) !== ctor.prototype) return false;
  return methods.every((m) => (value as Record<string, unknown>)[m] === (ctor.prototype as Record<string, unknown>)[m]);
}
function isAttempt(v: unknown): v is string { return typeof v === "string" && ATTEMPT.test(v); }
function isId(v: unknown): v is string { return typeof v === "string" && SAFE_ID.test(v); }
function integer(v: unknown, min: number, max: number, fallback: number): number { if (v === undefined) return fallback;
  if (!Number.isSafeInteger(v) || (v as number) < min || (v as number) > max) fail("INVALID_REQUEST"); return v as number; }
function clock(now: () => number): number { const value = now(); if (!Number.isSafeInteger(value) || value < 0) fail("CLOCK_INVALID"); return value; }
function fresh(value: unknown, now: number): boolean { if (typeof value !== "string") return false; const d = Date.parse(value);
  return Number.isFinite(d) && d <= now && now - d <= 30_000 && new Date(d).toISOString() === value; }
function nonnegative(v: unknown): boolean { return typeof v === "number" && Number.isFinite(v) && v >= 0; }
function validSubscription(value: Record<string, any>, now: number): boolean {
  const date = value.end_date, kind = value.end_date_kind;
  if (date === null) return kind === null;
  if (typeof date !== "string") return false;
  if (kind === "DATE_ONLY") return /^\d{4}-\d{2}-\d{2}$/u.test(date);
  if (kind === "LOCAL_DATETIME") return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/u.test(date);
  if (kind === "OFFSET_DATETIME" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(date)) {
    const expiry = Date.parse(date); return Number.isFinite(expiry) && expiry > now;
  }
  return false;
}
function delay(ms: number, signal: AbortSignal): Promise<void> { return new Promise((resolve, reject) => {
  if (signal.aborted) { reject(new Error("ABORTED")); return; } const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
  const abort = () => { clearTimeout(timer); reject(new Error("ABORTED")); }; signal.addEventListener("abort", abort, { once: true }); }); }
