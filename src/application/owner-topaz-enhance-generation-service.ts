import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import type { OwnerTopazEnhanceNativeChatContext, OwnerTopazEnhanceNativeResultCandidates, } from "../adapter/syntx/owner-topaz-enhance-native-context.js";
import { OwnerTopazEnhanceNativeError } from "../adapter/syntx/owner-topaz-enhance-native-context.js";
import type { OwnerTopazEnhanceNativeReadyVideo } from "../adapter/syntx/owner-topaz-enhance-native-context.js";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { resolveOwnerReferencePrincipal, OwnerReferencePrincipalError } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { AccountStatusService, type AccountStatusResult } from "./account-status.js";
import { ModelAccessService, type ModelAccessResult } from "./model-access.js";
import { OwnerTopazEnhanceOriginalReferenceService } from "./owner-topaz-enhance-original-reference-service.js";
import { OwnerTopazEnhanceOwnedRequestPreparer, isOwnerTopazEnhanceOwnedRequestPreparer, type OwnerTopazEnhanceOwnedCandidateBinding, type OwnerTopazEnhanceOwnedPreparedCandidate } from "./owner-topaz-enhance-owned-request-preparer.js";
import { createOwnerTopazEnhanceOwnedOneShotPermit, revalidateOwnerTopazEnhanceOwnedOneShotPermit, type OwnerTopazEnhanceOwnedOneShotPermit } from "./owner-topaz-enhance-owned-one-shot-policy.js";
import { getOwnerTopazEnhanceSourceProfile, OWNER_TOPAZ_ENHANCE_MODEL_ID, OWNER_TOPAZ_ENHANCE_PUBLIC_CATALOG_VERSION, type OwnerTopazEnhanceModelId } from "./owner-topaz-enhance-source-profile.js";
import type { OwnerTopazEnhanceParameterValues } from "./owner-topaz-enhance-parameters.js";
export const OWNER_TOPAZ_ENHANCE_GENERATION_CATALOG_VERSION = OWNER_TOPAZ_ENHANCE_PUBLIC_CATALOG_VERSION;
const ACCOUNT = AccountStatusService.prototype.getAccountStatus, ACCESS = ModelAccessService.prototype.getModelAccess;
const CREATE = SyntxChatHttpClient.prototype.createOwnerTopazEnhanceChat;
const START = SyntxChatHttpClient.prototype.startTopazEnhanceWithOwnedCandidate;
const LIST = SyntxChatHttpClient.prototype.listOwnedTopazEnhanceCandidates;
const GET = SyntxChatHttpClient.prototype.getOwnedTopazEnhanceResult;
const SERVICES = new WeakSet<object>(), ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY = /^topaz_enhance_recovery_[0-9a-f-]{36}$/u, MAX_RECOVERIES = 128, MAX_RUNS = 4, PAGE_SIZE = 64;
export type OwnerTopazEnhanceGenerationPhase = "VALIDATE_REQUEST" | "PREFLIGHT_ONE" | "CHAT_CREATE" | "PREFLIGHT_TWO" | "GENERATION_POST" | "POST_ACK_KNOWN" | "HISTORY_GET" | "RESULT_GET";
export interface OwnerTopazEnhanceGenerationDiagnostic {
    readonly phase: OwnerTopazEnhanceGenerationPhase;
    readonly post_started: boolean;
    readonly ack_known: boolean;
    readonly history_status: "NOT_READ" | "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
    readonly owner_ack_status: "NOT_READ" | "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
    readonly history_get_calls: number;
    readonly result_get_calls: number;
    readonly result_status: "NOT_READ" | "PENDING" | "COMPLETE" | "UNVERIFIED";
    readonly gaps: readonly string[];
}
export interface OwnerTopazEnhanceVideoArtifact extends OwnerTopazEnhanceNativeReadyVideo {
    readonly message_id: string;
    readonly chat_uuid: string;
    readonly model_id: "topaz_enhance";
}
export interface OwnerTopazEnhanceGenerationResult {
    readonly status: "completed";
    readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
    readonly backend_acceptance: "UNPROVEN";
    readonly provider_terminal_status: "UNPROVEN";
    readonly cost_cap_enforced: false;
    readonly recovery_id: string;
    readonly model_id: "topaz_enhance";
    readonly source_binding: Readonly<{
        public_catalog_version: string;
        profile_schema_hash: string;
        request_fingerprint: string;
        intent_fingerprint: string;
    }>;
    readonly observed_artifact_count: number;
    readonly offset: number;
    readonly page_size: 64;
    readonly artifacts: readonly OwnerTopazEnhanceVideoArtifact[];
    readonly has_more: boolean;
    readonly next_offset: number | null;
    readonly diagnostic: OwnerTopazEnhanceGenerationDiagnostic;
}
export interface OwnerTopazEnhanceRecoveryListItem {
    readonly recovery_id: string;
    readonly created_at: string;
    readonly model_id: "topaz_enhance";
    readonly status: "outcome_unknown" | "completed";
    readonly observed_artifact_count: number;
    readonly diagnostic: OwnerTopazEnhanceGenerationDiagnostic;
}
export interface OwnerTopazEnhanceGenerationServiceOptions {
    readonly binding: AuthBinding;
    readonly linkService: PerUserLinkService;
    readonly catalog: DiscoveryCatalogRepository;
    readonly catalog_version: string;
    readonly preparer: OwnerTopazEnhanceOwnedRequestPreparer;
    readonly originalReferenceService: OwnerTopazEnhanceOriginalReferenceService;
    readonly resolveChatClient: (attemptId: string) => unknown;
    readonly createAccountStatusService: (attemptId: string) => AccountStatusService;
    readonly createModelAccessService: (attemptId: string) => ModelAccessService;
    readonly now?: () => number;
    readonly timeoutMs?: number;
}
export interface OwnerTopazEnhanceGenerateInput {
    readonly attemptId: string;
    readonly request: Readonly<{
        model_id: OwnerTopazEnhanceModelId;
        topaz_original_handle: string;
        parameters: OwnerTopazEnhanceParameterValues;
    }>;
}
export interface OwnerTopazEnhanceReconcileInput {
    readonly attemptId: string;
    readonly recovery_id: string;
}
export interface OwnerTopazEnhanceRecoveryListInput {
    readonly attemptId: string;
    readonly limit?: number;
}
export interface OwnerTopazEnhanceResultPageInput {
    readonly attemptId: string;
    readonly recovery_id: string;
    readonly offset?: number;
}
export type OwnerTopazEnhanceGenerationServiceErrorCode = "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH" | "PREFLIGHT_FAILED" | "INTENT_ALREADY_CLAIMED" | "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND";
export class OwnerTopazEnhanceGenerationServiceError extends Error {
    readonly diagnostic?: OwnerTopazEnhanceGenerationDiagnostic;
    constructor(readonly code: OwnerTopazEnhanceGenerationServiceErrorCode, readonly recovery_id?: string, diagnostic?: OwnerTopazEnhanceGenerationDiagnostic) { super("The owner Topaz Enhance request could not be completed safely."); this.name = "OwnerTopazEnhanceGenerationServiceError"; if (code === "OUTCOME_UNKNOWN" && diagnostic)
        this.diagnostic = diagnostic; }
}
interface Recovery {
    recovery_id: string;
    attemptId: string;
    semantic_key: string;
    principal: Readonly<GenerationPrincipalRef>;
    created_at: string;
    candidate: OwnerTopazEnhanceOwnedPreparedCandidate;
    permit: OwnerTopazEnhanceOwnedOneShotPermit;
    chat: OwnerTopazEnhanceNativeChatContext;
    client: SyntxChatHttpClient;
    binding: Readonly<OwnerTopazEnhanceOwnedCandidateBinding>;
    owner_echo_message_id: string | null;
    status: "outcome_unknown" | "completed";
    artifacts: readonly OwnerTopazEnhanceVideoArtifact[];
    d: {
        phase: OwnerTopazEnhanceGenerationPhase;
        post_started: boolean;
        ack_known: boolean;
        history_status: OwnerTopazEnhanceGenerationDiagnostic["history_status"];
        owner_ack_status: OwnerTopazEnhanceGenerationDiagnostic["owner_ack_status"];
        history_get_calls: number;
        result_get_calls: number;
        result_status: OwnerTopazEnhanceGenerationDiagnostic["result_status"];
        gaps: string[];
    };
}
interface Run {
    attemptId: string;
    controller: AbortController;
    promise: Promise<unknown>;
}
/** Owner-only, single-dispatch Topaz Enhance orchestration. The original-reference service is borrowed. */
export class OwnerTopazEnhanceGenerationService {
    readonly #binding: Readonly<AuthBinding>;
    readonly #links: PerUserLinkService;
    readonly #catalog: DiscoveryCatalogRepository;
    readonly #catalogVersion: string;
    readonly #preparer: OwnerTopazEnhanceOwnedRequestPreparer;
    readonly #original: OwnerTopazEnhanceOriginalReferenceService;
    readonly #resolveClient: OwnerTopazEnhanceGenerationServiceOptions["resolveChatClient"];
    readonly #createAccount: OwnerTopazEnhanceGenerationServiceOptions["createAccountStatusService"];
    readonly #createAccess: OwnerTopazEnhanceGenerationServiceOptions["createModelAccessService"];
    readonly #now: () => number;
    readonly #timeoutMs: number;
    readonly #recoveries = new Map<string, Recovery>();
    readonly #claims = new Set<string>();
    readonly #reserved = new Set<string>();
    readonly #runs = new Set<Run>();
    readonly #invalidating = new Set<string>();
    readonly #clients = new Map<string, SyntxChatHttpClient>();
    readonly #usedAccounts = new WeakSet<object>();
    readonly #usedAccess = new WeakSet<object>();
    #closed = false;
    #closing?: Promise<void>;
    #lastNow = -1;
    constructor(value: OwnerTopazEnhanceGenerationServiceOptions | unknown) { const o = exact(value, ["binding", "linkService", "catalog", "catalog_version", "preparer", "originalReferenceService", "resolveChatClient", "createAccountStatusService", "createModelAccessService"], ["now", "timeoutMs"]); if (!(o.catalog instanceof DiscoveryCatalogRepository) || o.catalog_version !== OWNER_TOPAZ_ENHANCE_PUBLIC_CATALOG_VERSION || !isOwnerTopazEnhanceOwnedRequestPreparer(o.preparer) || !(o.originalReferenceService instanceof OwnerTopazEnhanceOriginalReferenceService) || !(o.linkService instanceof PerUserLinkService) || typeof o.resolveChatClient !== "function" || typeof o.createAccountStatusService !== "function" || typeof o.createModelAccessService !== "function")
        invalid(); this.#binding = binding(o.binding); this.#links = o.linkService; this.#catalog = o.catalog; this.#catalogVersion = o.catalog_version; this.#preparer = o.preparer; this.#original = o.originalReferenceService; this.#resolveClient = o.resolveChatClient; this.#createAccount = o.createAccountStatusService; this.#createAccess = o.createModelAccessService; this.#now = clock(o.now); this.#timeoutMs = bounded(o.timeoutMs, 1000, 300000, 120000); this.#assertModel(); SERVICES.add(this); Object.freeze(this); }
    generate(input: OwnerTopazEnhanceGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerTopazEnhanceGenerationResult> { const req = generateInput(input); return this.#run(req.attemptId, signal, s => this.#generate(req, s)); }
    reconcile(input: OwnerTopazEnhanceReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerTopazEnhanceGenerationResult> { const req = recoveryInput(input); return this.#run(req.attemptId, signal, async (s) => { const r = this.#owned(req.attemptId, req.recovery_id, await this.#principal(req.attemptId)); if (r.status === "completed")
        return page(r, 0); const d = new AbsoluteRequestDeadline(this.#timeoutMs, s, () => unknown(r)); try {
        await this.#checkPrincipal(req.attemptId, r.principal);
        if (this.#client(req.attemptId) !== r.client)
            fail("RECOVERY_NOT_FOUND");
        return await this.#observe(r, d);
    }
    catch {
        throw unknown(r);
    }
    finally {
        d.close();
    } }); }
    listRecoveries(input: OwnerTopazEnhanceRecoveryListInput | unknown): Promise<readonly OwnerTopazEnhanceRecoveryListItem[]> { const r = listInput(input); return this.#run(r.attemptId, undefined, async () => { const p = await this.#principal(r.attemptId); return Object.freeze([...this.#recoveries.values()].filter(x => x.attemptId === r.attemptId && sameGenerationPrincipal(x.principal, p)).slice(0, r.limit).map(item)); }); }
    getResultPage(input: OwnerTopazEnhanceResultPageInput | unknown): Promise<OwnerTopazEnhanceGenerationResult> { const req = pageInput(input); return this.#run(req.attemptId, undefined, async () => { const r = this.#owned(req.attemptId, req.recovery_id, await this.#principal(req.attemptId)); if (r.status !== "completed")
        throw unknown(r); return page(r, req.offset); }); }
    async invalidateAttempt(value: unknown): Promise<void> { const id = attempt(value); this.#invalidating.add(id); await this.#preparer.invalidateAttempt(id); await this.#original.invalidateAttempt(id); const active = [...this.#runs].filter(r => r.attemptId === id); active.forEach(r => r.controller.abort()); await Promise.allSettled(active.map(r => r.promise)); }
    close(): Promise<void> { if (this.#closing)
        return this.#closing; this.#closed = true; for (const r of this.#runs)
        r.controller.abort(); const ids = new Set([...this.#runs].map(r => r.attemptId)); this.#closing = (async () => { for (const id of ids) {
        await this.#preparer.invalidateAttempt(id);
        await this.#original.invalidateAttempt(id);
    } await Promise.allSettled([...this.#runs].map(r => r.promise)); await this.#preparer.close(); this.#runs.clear(); })(); return this.#closing; }
    async #generate(req: OwnerTopazEnhanceGenerateInput, signal: AbortSignal): Promise<OwnerTopazEnhanceGenerationResult> { const d = new AbsoluteRequestDeadline(this.#timeoutMs, signal, () => serviceFail("PRE_DISPATCH_FAILED")); let candidate: OwnerTopazEnhanceOwnedPreparedCandidate | undefined, permit: OwnerTopazEnhanceOwnedOneShotPermit | undefined, key: string | undefined, post = false, r: Recovery | undefined; try {
        d.throwIfAborted();
        this.#assertModel();
        const principal = await this.#principal(req.attemptId);
        candidate = await this.#await(d, () => this.#preparer.prepare({ attemptId: req.attemptId, topaz_original_handle: req.request.topaz_original_handle, model_id: OWNER_TOPAZ_ENHANCE_MODEL_ID, parameters: req.request.parameters }));
        const b = this.#preparer.inspectCandidate(candidate);
        if (!b || b.control_combination_status !== "SOURCE_ENUMS_EXPLICIT_CONDITIONAL_COMBINATIONS_UNPROVEN")
            fail("PRE_DISPATCH_FAILED");
        key = JSON.stringify([principal.tenant_id, principal.subject_id, b.intent_fingerprint]);
        if (this.#claims.has(key) || this.#reserved.has(key))
            fail("INTENT_ALREADY_CLAIMED");
        if (this.#recoveries.size + this.#reserved.size >= MAX_RECOVERIES)
            fail("SERVICE_BUSY");
        this.#reserved.add(key);
        permit = await createOwnerTopazEnhanceOwnedOneShotPermit({ preparer: this.#preparer, candidate, principal, attemptId: req.attemptId });
        await this.#preflight(req.attemptId, b, d);
        const client = this.#client(req.attemptId);
        const native = Object.freeze({ preparer: this.#preparer, candidate, permit, originalReferenceService: this.#original, principal, attemptId: req.attemptId, linkService: this.#links, binding: this.#binding });
        const chat = await this.#await(d, () => Reflect.apply(CREATE, client, [native, d.signal]) as Promise<OwnerTopazEnhanceNativeChatContext>);
        if (!chat || chat.model_id !== OWNER_TOPAZ_ENHANCE_MODEL_ID || chat.attempt_id !== req.attemptId || chat.dispatch_allowed !== false)
            fail("PRE_DISPATCH_FAILED");
        await this.#checkPrincipal(req.attemptId, principal);
        await this.#preflight(req.attemptId, b, d);
        await this.#checkPrincipal(req.attemptId, principal);
        await this.#preparer.revalidateCandidate(candidate);
        await revalidateOwnerTopazEnhanceOwnedOneShotPermit({ preparer: this.#preparer, candidate, permit, principal, attemptId: req.attemptId });
        r = this.#new(req.attemptId, principal, key, candidate, permit, chat, client, b);
        this.#recoveries.set(r.recovery_id, r);
        r.d.phase = "GENERATION_POST";
        r.d.post_started = true;
        post = true;
        const ack = await this.#await(d, () => Reflect.apply(START, client, [Object.freeze({ ...native, chat }), d.signal]) as Promise<{
            chat_uuid: string;
            message_id: string;
        }>);
        if (!ack || ack.chat_uuid !== chat.chat_uuid || !safeId(ack.message_id))
            throw unknown(r);
        this.#claims.add(r.semantic_key);
        this.#reserved.delete(r.semantic_key);
        key = undefined;
        r.owner_echo_message_id = ack.message_id;
        r.d.ack_known = true;
        r.d.owner_ack_status = "MATCHED";
        r.d.phase = "POST_ACK_KNOWN";
        return await this.#observe(r, d);
    }
    catch (e) {
        if (post && r) {
            if (e instanceof OwnerTopazEnhanceNativeError && ["INVALID_REQUEST", "CANDIDATE_INVALID", "CHAT_CONTEXT_INVALID", "REQUEST_ABORTED", "CHAT_NOT_DISPATCHED"].includes(e.code)) {
                this.#recoveries.delete(r.recovery_id);
                this.#reserved.delete(r.semantic_key);
                key = undefined;
                throw err("PRE_DISPATCH_FAILED");
            }
            this.#claims.add(r.semantic_key);
            this.#reserved.delete(r.semantic_key);
            key = undefined;
            throw unknown(r);
        }
        if (key)
            this.#reserved.delete(key);
        if (e instanceof OwnerTopazEnhanceGenerationServiceError)
            throw e;
        if (e instanceof OwnerReferencePrincipalError)
            return fail("PRINCIPAL_NOT_LINKED");
        return fail("PRE_DISPATCH_FAILED");
    }
    finally {
        if (key)
            this.#reserved.delete(key);
        d.close();
    } }
    async #preflight(id: string, b: Readonly<OwnerTopazEnhanceOwnedCandidateBinding>, d: AbsoluteRequestDeadline): Promise<void> { d.throwIfAborted(); let aS: AccountStatusService, qS: ModelAccessService; try {
        aS = this.#createAccount(id);
        qS = this.#createAccess(id);
    }
    catch {
        fail("PREFLIGHT_FAILED");
    } if (!(aS instanceof AccountStatusService) || this.#usedAccounts.has(aS) || !(qS instanceof ModelAccessService) || this.#usedAccess.has(qS))
        fail("PREFLIGHT_FAILED"); this.#usedAccounts.add(aS); this.#usedAccess.add(qS); let a: AccountStatusResult, q: ModelAccessResult; try {
        a = await this.#await(d, () => Reflect.apply(ACCOUNT, aS, [d.signal]));
        q = await this.#await(d, () => Reflect.apply(ACCESS, qS, [{ model_id: b.model_id, cost_parameters: Object.freeze({ resolution: String(b.parameters.upscale), video_duration: Math.round(b.duration_seconds) }) }, d.signal]));
    }
    catch {
        fail("PREFLIGHT_FAILED");
    } const now = this.#readNow(), m = this.#catalog.getModel(b.model_id), cost = q.discount_cost ?? q.cost; if (!validAccount(a, now) || q.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || q.catalog_version !== `${this.#catalog.fetched_at}.${this.#catalog.source_hashes.models.slice(7, 19)}` || q.model_id !== b.model_id || q.ai_name !== "topaz_ai" || q.model_type !== b.model_id || q.account_read_live !== true || q.access !== true || q.parameters_redacted !== true || !sameStrings(q.parameter_keys, ["resolution", "video_duration"]) || !finite(cost) || !finiteDecimal(a.balance.available) || !lessDecimal(cost, a.balance.available) || !fresh(q.observed_at, now) || !m.active)
        fail("PREFLIGHT_FAILED"); }
    #assertModel(): true { try {
        const p = getOwnerTopazEnhanceSourceProfile(OWNER_TOPAZ_ENHANCE_MODEL_ID), m = this.#catalog.getModel(OWNER_TOPAZ_ENHANCE_MODEL_ID), k = m.settings?.get_cost_params ?? [];
        if (this.#catalogVersion !== OWNER_TOPAZ_ENHANCE_PUBLIC_CATALOG_VERSION || !p || p.ai_name !== "topaz_ai" || p.catalog_scope !== "tool_video_upscaler" || !m.active || m.id !== OWNER_TOPAZ_ENHANCE_MODEL_ID || m.upstream_id !== OWNER_TOPAZ_ENHANCE_MODEL_ID || m.ai_name !== "topaz_ai" || m.scope !== "tool_video_upscaler" || !sameStrings(k, ["resolution", "video_duration"]))
            fail("MODEL_BINDING_MISMATCH");
        return true;
    }
    catch {
        return fail("MODEL_BINDING_MISMATCH");
    } }
    #client(id: string): SyntxChatHttpClient { let v: unknown; try {
        v = this.#resolveClient(id);
    }
    catch {
        fail("PRE_DISPATCH_FAILED");
    } if (!v || types.isProxy(v) || Object.getPrototypeOf(v) !== SyntxChatHttpClient.prototype)
        fail("PRE_DISPATCH_FAILED"); const old = this.#clients.get(id); if (old && old !== v)
        fail("PRINCIPAL_NOT_LINKED"); this.#clients.set(id, v as SyntxChatHttpClient); return v as SyntxChatHttpClient; }
    async #principal(id: string): Promise<Readonly<GenerationPrincipalRef>> { try {
        const p = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: id, linkService: this.#links });
        if (p.connection_id !== id)
            fail("PRINCIPAL_NOT_LINKED");
        return p;
    }
    catch {
        return fail("PRINCIPAL_NOT_LINKED");
    } }
    async #checkPrincipal(id: string, p: Readonly<GenerationPrincipalRef>): Promise<void> { if (!sameGenerationPrincipal(await this.#principal(id), p) || this.#invalidating.has(id))
        fail("PRINCIPAL_NOT_LINKED"); }
    #new(id: string, p: Readonly<GenerationPrincipalRef>, semantic: string, candidate: OwnerTopazEnhanceOwnedPreparedCandidate, permit: OwnerTopazEnhanceOwnedOneShotPermit, chat: OwnerTopazEnhanceNativeChatContext, client: SyntxChatHttpClient, b: Readonly<OwnerTopazEnhanceOwnedCandidateBinding>): Recovery { const now = this.#readNow(); return { recovery_id: `topaz_enhance_recovery_${randomUUID()}`, attemptId: id, semantic_key: semantic, principal: p, created_at: new Date(now).toISOString(), candidate, permit, chat, client, binding: b, owner_echo_message_id: null, status: "outcome_unknown", artifacts: Object.freeze([]), d: { phase: "CHAT_CREATE", post_started: false, ack_known: false, history_status: "NOT_READ", owner_ack_status: "NOT_READ", history_get_calls: 0, result_get_calls: 0, result_status: "NOT_READ", gaps: [] } }; }
    #owned(id: string, rid: string, p: Readonly<GenerationPrincipalRef>): Recovery { const r = this.#recoveries.get(rid); if (this.#invalidating.has(id) || !r || r.attemptId !== id || !sameGenerationPrincipal(r.principal, p) || this.#client(id) !== r.client)
        fail("RECOVERY_NOT_FOUND"); return r; }
    async #observe(r: Recovery, d: AbsoluteRequestDeadline): Promise<OwnerTopazEnhanceGenerationResult> { await this.#checkPrincipal(r.attemptId, r.principal); if (this.#client(r.attemptId) !== r.client)
        fail("RECOVERY_NOT_FOUND"); r.d.phase = "HISTORY_GET"; r.d.history_get_calls++; let h: OwnerTopazEnhanceNativeResultCandidates; try {
        h = await this.#await(d, () => Reflect.apply(LIST, r.client, [r.chat, d.signal]));
    }
    catch {
        r.d.history_status = "UNVERIFIED";
        throw unknown(r);
    } r.d.owner_ack_status = h.owner_ack_status; if (h.status !== "COMPLETE" || h.owner_ack_status !== "MATCHED" || h.history_binding_status !== "BOUND" || h.history_page_status !== "COMPLETE" || h.contexts.length !== 1) {
        r.d.history_status = h.status === "PENDING" ? "PENDING" : "INCOMPLETE";
        r.d.gaps = [...h.gaps];
        throw unknown(r);
    } r.d.history_status = "COMPLETE"; const c = h.contexts[0]!; if (c.chat_uuid !== r.chat.chat_uuid || c.attempt_id !== r.attemptId || c.model_id !== r.binding.model_id || c.profile_schema_hash !== r.binding.profile_schema_hash || c.intent_fingerprint !== r.binding.intent_fingerprint || c.owner_echo_message_id !== r.owner_echo_message_id)
        throw unknown(r); await this.#checkPrincipal(r.attemptId, r.principal); if (this.#client(r.attemptId) !== r.client)
        fail("RECOVERY_NOT_FOUND"); r.d.phase = "RESULT_GET"; r.d.result_get_calls++; let v; try {
        v = await this.#await(d, () => Reflect.apply(GET, r.client, [c, d.signal]));
    }
    catch {
        r.d.result_status = "UNVERIFIED";
        throw unknown(r);
    } if (v.message_binding !== "BOUND" || v.model_echo !== "MATCHED" || v.ready_videos.length !== 1) {
        r.d.result_status = "UNVERIFIED";
        r.d.gaps = [...v.gaps];
        throw unknown(r);
    } const artifact = v.ready_videos[0]!; if (artifact.object_type !== "video" || artifact.mime_type !== "video/mp4" || !safeResultUrl(artifact.object_url) || !c.message_object_ids.includes(artifact.message_object_id))
        throw unknown(r); r.artifacts = Object.freeze([Object.freeze({ ...artifact, message_id: c.message_id, chat_uuid: c.chat_uuid, model_id: r.binding.model_id })]); r.status = "completed"; r.d.result_status = "COMPLETE"; return page(r, 0); }
    #await<T>(d: AbsoluteRequestDeadline, f: () => Promise<T>): Promise<T> { d.throwIfAborted(); return d.waitFor(f()); }
    #run<T>(id: string, parent: AbortSignal | undefined, fn: (s: AbortSignal) => Promise<T>): Promise<T> { if (this.#closed || !SERVICES.has(this))
        return Promise.reject(err("SERVICE_CLOSED")); if (this.#invalidating.has(id) || this.#runs.size >= MAX_RUNS)
        return Promise.reject(err("SERVICE_BUSY")); const c = new AbortController(), abort = () => c.abort(parent?.reason); if (parent?.aborted)
        abort();
    else
        parent?.addEventListener("abort", abort, { once: true }); const r: Run = { attemptId: id, controller: c, promise: Promise.resolve() }; const p = fn(c.signal); r.promise = p; this.#runs.add(r); return p.finally(() => { parent?.removeEventListener("abort", abort); this.#runs.delete(r); }); }
    #readNow(): number { const n = this.#now(); if (!Number.isSafeInteger(n) || n < this.#lastNow)
        fail("SERVICE_BUSY"); return this.#lastNow = n; }
}
export function isOwnerTopazEnhanceGenerationService(v: unknown): v is OwnerTopazEnhanceGenerationService { return !!v && typeof v === "object" && !types.isProxy(v) && SERVICES.has(v) && Object.getPrototypeOf(v) === OwnerTopazEnhanceGenerationService.prototype; }
function generateInput(v: unknown): OwnerTopazEnhanceGenerateInput { const x = exact(v, ["attemptId", "request"]), r = exact(x.request, ["model_id", "topaz_original_handle", "parameters"]); if (r.model_id !== OWNER_TOPAZ_ENHANCE_MODEL_ID || typeof r.topaz_original_handle !== "string")
    invalid(); return { attemptId: attempt(x.attemptId), request: { model_id: r.model_id, topaz_original_handle: r.topaz_original_handle, parameters: r.parameters as OwnerTopazEnhanceParameterValues } }; }
function recoveryInput(v: unknown): OwnerTopazEnhanceReconcileInput { const x = exact(v, ["attemptId", "recovery_id"]); if (typeof x.recovery_id !== "string" || !RECOVERY.test(x.recovery_id))
    invalid(); return { attemptId: attempt(x.attemptId), recovery_id: x.recovery_id }; }
function listInput(v: unknown): {
    attemptId: string;
    limit: number;
} { const x = exact(v, ["attemptId"], ["limit"]); return { attemptId: attempt(x.attemptId), limit: bounded(x.limit, 1, 128, 32) }; }
function pageInput(v: unknown): {
    attemptId: string;
    recovery_id: string;
    offset: number;
} { const x = exact(v, ["attemptId", "recovery_id"], ["offset"]); if (typeof x.recovery_id !== "string" || !RECOVERY.test(x.recovery_id))
    invalid(); return { attemptId: attempt(x.attemptId), recovery_id: x.recovery_id, offset: bounded(x.offset, 0, 4096, 0) }; }
function page(r: Recovery, offset: number): OwnerTopazEnhanceGenerationResult { const artifacts = r.artifacts.slice(offset, offset + PAGE_SIZE), next = offset + artifacts.length; return Object.freeze({ status: "completed", status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", backend_acceptance: "UNPROVEN", provider_terminal_status: "UNPROVEN", cost_cap_enforced: false, recovery_id: r.recovery_id, model_id: OWNER_TOPAZ_ENHANCE_MODEL_ID, source_binding: { public_catalog_version: OWNER_TOPAZ_ENHANCE_PUBLIC_CATALOG_VERSION, profile_schema_hash: r.binding.profile_schema_hash, request_fingerprint: r.binding.request_fingerprint, intent_fingerprint: r.binding.intent_fingerprint }, observed_artifact_count: r.artifacts.length, offset, page_size: PAGE_SIZE, artifacts: Object.freeze(artifacts), has_more: next < r.artifacts.length, next_offset: next < r.artifacts.length ? next : null, diagnostic: diag(r.d) }); }
function diag(d: Recovery["d"]): OwnerTopazEnhanceGenerationDiagnostic { return Object.freeze({ ...d, gaps: Object.freeze(d.gaps.slice(0, 32)) }); }
function item(r: Recovery): OwnerTopazEnhanceRecoveryListItem { return Object.freeze({ recovery_id: r.recovery_id, created_at: r.created_at, model_id: OWNER_TOPAZ_ENHANCE_MODEL_ID, status: r.status, observed_artifact_count: r.artifacts.length, diagnostic: diag(r.d) }); }
function unknown(r: Recovery): OwnerTopazEnhanceGenerationServiceError { return new OwnerTopazEnhanceGenerationServiceError("OUTCOME_UNKNOWN", r.recovery_id, diag(r.d)); }
function validAccount(a: AccountStatusResult, n: number): boolean {
    const s = a.subscription, b = a.balance;
    if (a.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || a.source_build !== ACCOUNT_SOURCE_BUILD || b.unit !== "tokens" ||
        !finiteDecimal(b.available) || s.active !== true || !(s.plan_type === null || typeof s.plan_type === "string") ||
        !(s.end_date === null || typeof s.end_date === "string") ||
        !(s.end_date_kind === null || ["DATE_ONLY", "LOCAL_DATETIME", "OFFSET_DATETIME"].includes(s.end_date_kind)) ||
        !fresh(a.observed_at, n)) return false;
    if (s.end_date === null) return s.end_date_kind === null;
    if (s.end_date_kind === null) return false;
    const end = Date.parse(s.end_date_kind === "DATE_ONLY" ? `${s.end_date}T23:59:59.999Z` : s.end_date);
    return Number.isFinite(end) && end > n;
}
function lessDecimal(a: number, b: string): boolean {
    const left = decimalParts(String(a)), right = decimalParts(b);
    if (!left || !right) return false;
    const scale = Math.max(left.scale, right.scale);
    return left.digits * 10n ** BigInt(scale - left.scale) < right.digits * 10n ** BigInt(scale - right.scale);
}
function decimalParts(value: unknown): { digits: bigint; scale: number } | null {
    if (typeof value !== "string" || value.length > 128) return null;
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
function finiteDecimal(v: unknown): v is string { return typeof v === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(v); }
function fresh(v: string, n: number): boolean { return typeof v === "string" && Number.isFinite(Date.parse(v)) && Math.abs(Date.parse(v) - n) < 300000; }
function safeResultUrl(v: string): boolean { try {
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname === "r2.syntx.ai" && !u.port && !u.username && !u.password && !u.search && !u.hash && /\.mp4$/iu.test(u.pathname);
}
catch {
    return false;
} }
function sameStrings(a: readonly string[], b: readonly string[]): boolean { return a.length === b.length && a.slice().sort().every((v, i) => v === b.slice().sort()[i]); }
function binding(v: unknown): Readonly<AuthBinding> { const x = exact(v, ["tenant_id", "subject"]); if (typeof x.tenant_id !== "string" || !x.tenant_id.trim() || typeof x.subject !== "string" || !x.subject.trim())
    invalid(); return Object.freeze({ tenant_id: x.tenant_id, subject: x.subject }); }
function exact(v: unknown, required: string[], optional: string[] = []): Record<string, any> { if (!v || typeof v !== "object" || Array.isArray(v) || types.isProxy(v))
    invalid(); const keys = Reflect.ownKeys(v); if (keys.some(k => typeof k !== "string" || !required.includes(k) && !optional.includes(k)) || required.some(k => !keys.includes(k)) || keys.some(k => { const d = Object.getOwnPropertyDescriptor(v, k); return !d || !("value" in d); }))
    invalid(); return v as Record<string, any>; }
function attempt(v: unknown): string { if (typeof v !== "string" || !ATTEMPT.test(v))
    invalid(); return v; }
function safeId(v: string): boolean { return typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u.test(v); }
function bounded(v: unknown, min: number, max: number, def: number): number { if (v === undefined)
    return def; if (!Number.isSafeInteger(v) || (v as number) < min || (v as number) > max)
    invalid(); return v as number; }
function clock(v: unknown): () => number { if (v === undefined)
    return Date.now; if (typeof v !== "function" || types.isProxy(v))
    invalid(); return v as () => number; }
function finite(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v) && v >= 0; }
function err(c: OwnerTopazEnhanceGenerationServiceErrorCode): OwnerTopazEnhanceGenerationServiceError { return new OwnerTopazEnhanceGenerationServiceError(c); }
function serviceFail(c: OwnerTopazEnhanceGenerationServiceErrorCode): never { throw err(c); }
function fail(c: OwnerTopazEnhanceGenerationServiceErrorCode): never { throw err(c); }
function invalid(): never { throw err("INVALID_REQUEST"); }
